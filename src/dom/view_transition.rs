//! <https://drafts.csswg.org/css-view-transitions-2/>

use core::cell::RefCell;
use std::rc::Rc;

use crate::abi::{self, Item, Matrix, Rect};
use crate::boxes::{BoxId, VIEWPORT};
use crate::document::Document;
use crate::geometry::translation;
use crate::inline::ItemKind;
use crate::name::{Name, Set, name};
use crate::paint::{Painter, Picture, Space, square};
use crate::properties::{Id, Style};
use crate::rules::Level;
use crate::selector::{Pseudo, TransitionPart as Part};
use crate::sheet::{AtKind, Block, Defined, Keyframe};
use crate::svg::scaling;
use crate::tree::{BACKDROP, DOCUMENT, Data, Element, Flags, Namespace, NodeId, Replaced, State};
use crate::types::{Blend, IDENTITY, ObjectFit, invert, multiply};
use crate::values::{Out, ident, parse_all, text, write_ident};

/// With the index of the group, times two, and one more for the new image.
const SNAPSHOT: u32 = 1 << 30;
const GROUP_ANIMATION: &str = "-ua-view-transition-group-anim-";

#[derive(Clone, PartialEq)]
struct Placement {
    size: [f32; 2],
    /// From the border box of the group that it is in, or of the viewport.
    matrix: Matrix,
    /// Relative to the border box.
    ink: Rect,
    /// What is left when the translation is snapped.
    fraction: [f32; 2],
    border: [f32; 4],
    styles: Out,
    backdrop_filter: Out,
}

struct Group {
    name: String,
    classes: Vec<Name>,
    /// The name of the group that it is in.
    container: Option<String>,
    old: Option<(Placement, Picture)>,
    /// With the captured element.
    new: Option<(Placement, NodeId)>,
    keyframes: Option<Rc<[Keyframe]>>,
    /// By `Part`.
    parts: [NodeId; 6],
}

#[derive(Default)]
pub(crate) struct ViewTransition {
    groups: Vec<Group>,
    /// They are not painted where they are.
    captured: Set<NodeId>,
    /// The snapshot containing block
    root: NodeId,
    size: [f32; 2],
    canvas: u32,
    was_composited: bool,
}

thread_local! {
    /// What documents have captured for the ones that replace them.
    static OUTBOUND: RefCell<Vec<(u32, Box<ViewTransition>)>> = const { RefCell::new(Vec::new()) };
}

struct Named {
    node: NodeId,
    name: String,
    container: Option<(String, NodeId)>,
}

pub(crate) fn is_snapshot(image: u32) -> bool {
    image >> 30 == 1
}

impl Document {
    /// Unless it is about another tree.
    fn scoped_names(&self, node: NodeId, property: Id) -> Vec<String> {
        let is_scoped = |_: &&str| match self.level_of_declaration(node, property) {
            Some(Level::Inner(_)) => false,
            level => self.tree[node].scope == DOCUMENT || matches!(level, Some(Level::Outer(_))),
        };
        let names = self
            .tree
            .style(node)
            .and_then(|it| it.other_if_set(property))
            .filter(|it| *it != "none")
            .filter(is_scoped);
        let names = parse_all(names.unwrap_or_default().as_bytes(), |p| {
            Some(
                core::iter::from_fn(|| ident(p))
                    .map(<[u8]>::to_vec)
                    .collect::<Vec<_>>(),
            )
        });
        names
            .into_iter()
            .flatten()
            .map(|it| text(&it).to_owned())
            .collect()
    }

    /// The box that the border box is relative to.
    fn captured_box(&self, node: NodeId) -> Option<(BoxId, Rect)> {
        let rects = self.local_rects(node);
        let (first, is_inline) = (rects.first()?.0, self.own_box(node).is_none());
        (rects.len() == 1 || is_inline && rects.iter().all(|it| it.0 == first)).then_some(())?;
        Some((
            first,
            rects.iter().map(|it| it.1).reduce(|a, b| a.union(&b))?,
        ))
    }

    fn transition_name(&self, node: NodeId) -> Option<String> {
        let name = self.scoped_names(node, Id::ViewTransitionName).pop()?;
        self.captured_box(node)?;
        Some(match name {
            _ if name != "match-element" => name,
            _ if self.tree.is_root(node) => "root".into(),
            _ => format!("-ua-auto-{node}"),
        })
    }

    fn containing_group(&self, node: NodeId) -> Option<(String, NodeId)> {
        let of = |node| {
            self.scoped_names(node, Id::ViewTransitionGroup)
                .pop()
                .unwrap_or_default()
        };
        (of(node) != "none").then_some(())?;
        let mut named = self
            .tree
            .flat_ancestors(node)
            .filter_map(|it| Some((self.transition_name(it)?, it)));
        let explicit = named
            .by_ref()
            .find(|it| of(node) == "nearest" || it.0 == of(node));
        explicit.or_else(|| {
            self.tree
                .flat_ancestors(node)
                .filter(|it| of(*it) == "contain")
                .find_map(|it| Some((self.transition_name(it)?, it)))
        })
    }

    /// An inline one has no box.
    fn stacking_contexts_in(&self, id: BoxId, out: &mut Vec<(i32, NodeId, BoxId)>) {
        if !bun_core::StackCheck::init().is_safe_to_recurse()
            || self.skips_contents(self.boxes[id].node)
        {
            return;
        }
        let items = self.boxes[id].inline.iter().flat_map(|it| &it.items);
        out.extend(
            items
                .filter(|it| matches!(it.kind, ItemKind::Open(_)) && it.style.has_transition_name())
                .map(|it| (0, it.node, 0)),
        );
        for child in &self.boxes[id].children {
            match self.stack_level(*child) {
                Some(level) => out.push((level, self.boxes[*child].node, *child)),
                None => self.stacking_contexts_in(*child, out),
            }
        }
    }

    /// In paint order.
    fn named_in(&self, node: NodeId, id: BoxId, out: &mut Vec<Named>) {
        out.extend(self.transition_name(node).map(|name| Named {
            node,
            name,
            container: self.containing_group(node),
        }));
        let mut inside = Vec::new();
        if id != 0 {
            self.stacking_contexts_in(id, &mut inside);
        }
        inside.sort_by_key(|it| it.0);
        inside
            .into_iter()
            .for_each(|it| self.named_in(it.1, it.2, out));
    }

    /// `None` if two have the same name.
    fn named_elements(&mut self) -> Option<Vec<Named>> {
        self.update_layout();
        let (mut all, mut names) = (Vec::new(), Set::default());
        self.boxes[VIEWPORT]
            .children
            .iter()
            .for_each(|it| self.named_in(self.boxes[*it].node, *it, &mut all));
        all.iter()
            .all(|it| names.insert(Name::new(it.name.as_bytes())))
            .then_some(all)
    }

    fn snapshot_size(&self) -> [f32; 2] {
        self.boxes[VIEWPORT].size()
    }

    /// What is outside of its ink, because a box around it places it.
    fn ink_of_escapees(&self, id: BoxId, from_viewport: &Matrix) -> impl Iterator<Item = Rect> {
        let parents = move |id: BoxId| {
            core::iter::successors(Some(self.boxes[id].parent), |it| {
                Some(self.boxes[*it].parent)
            })
            .take_while(|it| *it != 0)
        };
        let hoisted = parents(id)
            .flat_map(|it| &self.boxes[it].hoisted)
            .filter(move |it| parents(**it).any(|it| it == id));
        hoisted.map(move |it| {
            self.ink(*it)
                .transformed(&multiply(from_viewport, &self.to_viewport(*it)))
        })
    }

    fn placement(&mut self, node: NodeId, container: Option<NodeId>) -> Option<Placement> {
        let (id, rect) = self.captured_box(node)?;
        let mut styles = Out::new();
        for property in [
            "writing-mode",
            "direction",
            "text-orientation",
            "mix-blend-mode",
            "color-scheme",
        ] {
            styles.extend(
                [
                    property.as_bytes(),
                    b":",
                    &self.computed_style(node, b"", property.as_bytes(), true),
                    b";",
                ]
                .concat(),
            );
        }
        let backdrop_filter = self.computed_style(node, b"", b"backdrop-filter", true);
        if self.tree.is_root(node) {
            let [width, height] = self.snapshot_size();
            let ink = Rect::new([0.0, 0.0, width, height]);
            return Some(Placement {
                size: [width, height],
                matrix: IDENTITY,
                ink,
                fraction: [0.0; 2],
                border: [0.0; 4],
                styles,
                backdrop_filter,
            });
        }
        let to_viewport =
            |id, rect: Rect| multiply(&self.to_viewport(id), &translation([rect.x, rect.y]));
        let (style, mut matrix, scale) = (
            self.tree.style(node)?,
            to_viewport(id, rect),
            self.environment.scale,
        );
        let is_snapped = matrix[..4] == IDENTITY[..4] && !style.has_transform();
        let fraction = [matrix[4], matrix[5]].map(|it| {
            if is_snapped {
                it - (it * scale + 0.5).floor() / scale
            } else {
                0.0
            }
        });
        let from_viewport = invert(&self.to_viewport(id)).unwrap_or(IDENTITY);
        let ink = self
            .ink_of_escapees(id, &from_viewport)
            .fold(self.ink(id), |a, b| a.union(&b));
        let ink = self
            .filtered(node, style, ink, rect)
            .moved([fraction[0] - rect.x, fraction[1] - rect.y]);
        let ([left, top], [right, bottom]) = (
            [ink.x, ink.y].map(|it| (it * scale).floor() / scale),
            [ink.right(), ink.bottom()].map(|it| (it * scale).ceil() / scale),
        );
        if let Some((around, rect)) = container
            .filter(|it| !self.tree.is_root(*it))
            .and_then(|it| self.captured_box(it))
        {
            matrix = multiply(
                &invert(&to_viewport(around, rect)).unwrap_or(IDENTITY),
                &matrix,
            );
            let [top, .., left] = container
                .and_then(|it| self.tree.style(it))
                .map_or([0.0; 4], |it| it.border());
            matrix = multiply(&translation([-left, -top]), &matrix);
        }
        let ink = Rect::new([left, top, right - left, bottom - top]);
        Some(Placement {
            size: [rect.width, rect.height],
            matrix,
            ink,
            fraction,
            border: style.border(),
            styles,
            backdrop_filter,
        })
    }

    fn classes_of(&self, node: NodeId) -> Vec<Name> {
        self.scoped_names(node, Id::ViewTransitionClass)
            .iter()
            .map(|it| Name::new(it.as_bytes()))
            .collect()
    }

    pub(crate) fn capture_old_state(&mut self, canvas: u32) -> bool {
        self.end_view_transition();
        let was_composited = self.stop_compositing();
        self.view_transition = Some(Box::new(ViewTransition {
            canvas,
            was_composited,
            ..Default::default()
        }));
        let Some(named) = self.named_elements() else {
            return false;
        };
        self.update_picture();
        let (captured, size) = (
            named.iter().map(|it| it.node).collect(),
            self.snapshot_size(),
        );
        if let Some(it) = &mut self.view_transition {
            (it.captured, it.size) = (captured, size);
        }
        let mut groups = Vec::new();
        for Named {
            node,
            name,
            container,
        } in named
        {
            let Some(placement) = self.placement(node, container.as_ref().map(|it| it.1)) else {
                continue;
            };
            let (picture, classes) = (
                Painter::capture(self, node, &placement, placement.ink),
                self.classes_of(node),
            );
            let (old, container) = (Some((placement, picture)), container.map(|it| it.0));
            groups.push(Group {
                name,
                classes,
                container,
                old,
                new: None,
                keyframes: None,
                parts: [0; 6],
            });
        }
        if let Some(it) = &mut self.view_transition {
            (it.groups, it.captured) = (groups, Set::default());
        }
        true
    }

    pub(crate) fn hand_over_old_state(&mut self, ticket: u32) {
        OUTBOUND.with_borrow_mut(|all| {
            all.drain(..all.len().saturating_sub(3));
            all.extend(self.view_transition.take().map(|it| (ticket, it)));
        });
    }

    pub(crate) fn take_over_old_state(&mut self, ticket: u32) -> bool {
        let Some((_, mut transition)) =
            OUTBOUND.with_borrow_mut(|all| all.extract_if(.., |it| it.0 == ticket).next())
        else {
            return false;
        };
        self.end_view_transition();
        transition.was_composited = self.stop_compositing();
        self.view_transition = Some(transition);
        true
    }

    /// The types, or `none` if navigations have no transition.
    pub(crate) fn navigation_transition(&mut self) -> Out {
        self.update_style();
        let Some((Defined::Descriptors(all), _)) =
            self.find_defined(DOCUMENT, AtKind::ViewTransition, "")
        else {
            return b"none".into();
        };
        let value = |name: &str| {
            all.iter()
                .rfind(|it| &*it.0 == name)
                .map_or("none", |it| &it.1)
        };
        match (value("navigation"), value("types")) {
            ("auto", "none") => Out::new(),
            ("auto", types) => types.into(),
            _ => b"none".into(),
        }
    }

    fn add_pseudo(&mut self, parent: NodeId, pseudo: Pseudo, classes: &[Name]) -> NodeId {
        let mut element = Element::new(name!(""), Namespace::Html);
        (element.pseudo, element.originator) = (pseudo, self.tree.root_element());
        element.custom_states.extend_from_slice(classes);
        let node = self.tree.create(Data::Element(Box::new(element)));
        self.tree.link(parent, node, 0);
        self.tree[node].scope = DOCUMENT;
        self.tree[node].set(Flags::REMATCH);
        node
    }

    fn add_part(&mut self, parent: NodeId, part: Part, group: &mut Group) -> NodeId {
        group.parts[part as usize] = self.add_pseudo(
            parent,
            Pseudo::Transition(part, Name::new(group.name.as_bytes())),
            &group.classes,
        );
        group.parts[part as usize]
    }

    fn declare(&mut self, node: NodeId, source: &[u8]) {
        let block = Rc::new(Block::parse(source, Default::default(), &self.base_url));
        self.tree
            .element_mut(node)
            .into_iter()
            .for_each(|it| it.hints = Some(Rc::clone(&block)));
        self.tree.mark_style(node, Flags::REMATCH);
    }

    fn geometry(&self, it: &Placement) -> Out {
        let zoom = self.zoom_of(self.tree.root_element());
        let center = it.size.map(|it| it / 2.0);
        let [a, b, c, d, e, f] = multiply(
            &multiply(&translation(center.map(|it| -it)), &it.matrix),
            &translation(center),
        );
        let [width, height, e, f] = [it.size[0], it.size[1], e, f].map(|it| it / zoom);
        let geometry = format!(
            "width:{width}px;height:{height}px;transform:matrix({a},{b},{c},{d},{e},{f});backdrop-filter:"
        );
        [geometry.as_bytes(), &it.backdrop_filter, b";"].concat()
    }

    fn style_group(&mut self, index: usize, group: &Group) {
        let Some(placement) = group
            .new
            .as_ref()
            .map(|it| &it.0)
            .or(group.old.as_ref().map(|it| &it.0))
        else {
            return;
        };
        let mut source = [self.geometry(placement), placement.styles.clone()].concat();
        if group.keyframes.is_some() {
            source.extend(format!("animation-name:{GROUP_ANIMATION}").bytes());
            write_ident(group.name.as_bytes(), &mut source);
        }
        self.declare(group.parts[Part::Group as usize], &source);
        let zoom = self.zoom_of(self.tree.root_element());
        if group.parts[Part::Children as usize] != 0 {
            let [top, right, bottom, left] = placement.border.map(|it| it / zoom);
            self.declare(
                group.parts[Part::Children as usize],
                format!("border-width:{top}px {right}px {bottom}px {left}px").as_bytes(),
            );
        }
        let images = [
            (Part::Old, group.old.as_ref().map(|it| it.0.size)),
            (Part::New, group.new.as_ref().map(|it| it.0.size)),
        ];
        for (is_new, (part, size)) in images.into_iter().enumerate() {
            let (node, Some([width, height])) = (group.parts[part as usize], size) else {
                continue;
            };
            let (image, ratio) = (
                SNAPSHOT | (index * 2 + is_new) as u32,
                Some(width / height).filter(|it| it.is_normal()),
            );
            self.set_replaced(
                node,
                Some(Replaced {
                    image,
                    size: [Some(width / zoom), Some(height / zoom)],
                    ratio,
                }),
            );
        }
    }

    pub(crate) fn capture_new_state(&mut self) -> bool {
        let Some(named) = self.named_elements() else {
            return false;
        };
        let (root, size) = (self.tree.root_element(), self.snapshot_size());
        if self.tree.style(root).is_none()
            || self
                .view_transition
                .as_ref()
                .is_none_or(|it| it.size != size)
        {
            return false;
        }
        let Some(mut transition) = self.view_transition.take() else {
            return false;
        };
        for Named {
            node,
            name,
            container,
        } in named
        {
            let Some(placement) = self.placement(node, container.as_ref().map(|it| it.1)) else {
                continue;
            };
            let known = transition
                .groups
                .iter()
                .position(|it| it.name == name)
                .unwrap_or_else(|| {
                    transition.groups.push(Group {
                        name,
                        classes: Vec::new(),
                        container: None,
                        old: None,
                        new: None,
                        keyframes: None,
                        parts: [0; 6],
                    });
                    transition.groups.len() - 1
                });
            let group = &mut transition.groups[known];
            (group.new, group.classes, group.container) = (
                Some((placement, node)),
                self.classes_of(node),
                container.map(|it| it.0),
            );
            transition.captured.insert(node);
            self.boxes.mark_ink(self.tree[node].layout_box);
        }
        let mut element = Element::new(name!(""), Namespace::Html);
        (element.pseudo, element.originator) = (Pseudo::Transition(Part::Block, Name::NONE), root);
        transition.root = self.tree.create(Data::Element(Box::new(element)));
        self.tree[transition.root].scope = DOCUMENT;
        let old = self.tree.element_mut(root).map_or(0, |it| {
            core::mem::replace(&mut it.generated[BACKDROP], transition.root)
        });
        if old != 0 {
            self.free_subtree(old);
        }
        let (zoom, [top, .., left]) = (self.zoom_of(root), self.gutters(VIEWPORT));
        let [left, top, width, height] = [-left, -top, size[0], size[1]].map(|it| it / zoom);
        self.declare(transition.root, format!("display:block;position:fixed;left:{left}px;top:{top}px;width:{width}px;height:{height}px").as_bytes());
        let (groups, tree) = (
            &mut transition.groups,
            self.add_pseudo(
                transition.root,
                Pseudo::Transition(Part::Root, Name::NONE),
                &[],
            ),
        );
        for group in groups.iter_mut() {
            let node = self.add_part(tree, Part::Group, group);
            let pair = self.add_part(node, Part::Pair, group);
            let has_both = group.old.is_some() && group.new.is_some();
            let blend = if has_both {
                ",-ua-mix-blend-mode-plus-lighter"
            } else {
                ""
            };
            for (part, fade) in [(Part::Old, "out"), (Part::New, "in")] {
                if if part == Part::Old {
                    group.old.is_some()
                } else {
                    group.new.is_some()
                } {
                    let image = self.add_part(pair, part, group);
                    self.declare(
                        image,
                        format!("animation-name:-ua-view-transition-fade-{fade}{blend}").as_bytes(),
                    );
                }
            }
            if let Some((old, _)) = group.old.as_ref().filter(|_| has_both) {
                self.declare(pair, b"isolation:isolate");
                let block = Rc::new(Block::parse(
                    &self.geometry(old),
                    Default::default(),
                    &self.base_url,
                ));
                group.keyframes = Some(Rc::new([Keyframe {
                    offset: 0.0,
                    block,
                    easing: None,
                    adds: None,
                    range: Default::default(),
                }]));
            }
        }
        for index in 0..groups.len() {
            let container = groups
                .iter()
                .position(|it| Some(&it.name) == groups[index].container.as_ref());
            let node = groups[index].parts[Part::Group as usize];
            let is_outside = |it: &usize| {
                core::iter::once(node)
                    .chain(self.tree.descendants(node))
                    .all(|node| node != groups[*it].parts[Part::Group as usize])
            };
            let Some(container) = container.filter(is_outside).map(|it| &mut groups[it]) else {
                continue;
            };
            let children = match container.parts[Part::Children as usize] {
                0 => self.add_part(
                    container.parts[Part::Group as usize],
                    Part::Children,
                    container,
                ),
                children => children,
            };
            self.tree.unlink(node);
            self.tree.link(children, node, 0);
        }
        groups
            .iter()
            .enumerate()
            .for_each(|(index, group)| self.style_group(index, group));
        let parts: Vec<_> = core::iter::once(transition.root)
            .chain(self.tree.descendants(transition.root))
            .collect();
        for part in parts {
            let is_only_child = self.tree[part].previous == 0 && self.tree[part].next == 0;
            self.tree
                .element_mut(part)
                .into_iter()
                .for_each(|it| it.state.set(State::DEFAULT, is_only_child));
        }
        self.tree.mark_style(transition.root, Flags::REMATCH);
        self.view_transition = Some(transition);
        self.mark_rebuild(DOCUMENT);
        self.pictures.discard();
        self.update_layout();
        true
    }

    /// Follows the captured elements. `None` if that is not possible, or else whether something is still animated.
    pub(crate) fn update_view_transition(&mut self) -> Option<bool> {
        self.update_layout();
        let (root, transition) = (self.transition_root()?, self.view_transition.as_ref()?);
        (transition.size == self.snapshot_size()).then_some(())?;
        let captured = |name: &String| {
            Some(
                transition
                    .groups
                    .iter()
                    .find(|it| it.name == *name)?
                    .new
                    .as_ref()?
                    .1,
            )
        };
        let followed = transition
            .groups
            .iter()
            .enumerate()
            .filter_map(|(index, it)| {
                Some((
                    index,
                    it.new.as_ref()?.1,
                    it.container.as_ref().and_then(captured),
                ))
            });
        let mut placements = Vec::new();
        for (index, node, container) in followed.collect::<Vec<_>>() {
            self.is_captured(node).then_some(())?;
            placements.push((index, self.placement(node, container)?));
        }
        let mut transition = self.view_transition.take()?;
        for (index, placement) in placements {
            let group = &mut transition.groups[index];
            if let Some(new) = group.new.as_mut().filter(|it| it.0 != placement) {
                new.0 = placement;
                self.style_group(index, group);
                self.boxes
                    .mark_ink(self.tree[group.parts[Part::New as usize]].layout_box);
            }
        }
        self.view_transition = Some(transition);
        self.pictures.discard();
        self.update_layout();
        Some(
            core::iter::once(root)
                .chain(self.tree.descendants(root))
                .any(|it| self.is_still_animated(it)),
        )
    }

    pub(crate) fn end_view_transition(&mut self) {
        let Some(transition) = self.view_transition.take() else {
            return;
        };
        self.compositor.is_on = transition.was_composited;
        transition
            .captured
            .iter()
            .for_each(|it| self.boxes.mark_ink(self.tree[*it].layout_box));
        let root = self
            .tree
            .element(transition.root)
            .map_or(0, |it| it.originator);
        if let Some(root) = self
            .tree
            .element_mut(root)
            .filter(|it| it.generated[BACKDROP] == transition.root)
        {
            root.generated[BACKDROP] = 0;
            self.free_subtree(transition.root);
            self.mark_rebuild(DOCUMENT);
        }
        self.pictures.discard();
        self.needs_frame = true;
    }

    /// Once there is something to show.
    pub(crate) fn transition_root(&self) -> Option<NodeId> {
        let root = self.view_transition.as_ref()?.root;
        matches!(
            self.tree.element(root)?.pseudo,
            Pseudo::Transition(Part::Block, _)
        )
        .then_some(root)
    }

    pub(crate) fn is_captured(&self, node: NodeId) -> bool {
        self.view_transition
            .as_ref()
            .is_some_and(|it| it.captured.contains(&node))
    }

    pub(crate) fn captured_node_freed(&mut self, node: NodeId) {
        self.view_transition
            .iter_mut()
            .for_each(|it| _ = it.captured.remove(&node));
    }

    pub(crate) fn transition_keyframes(&self, name: &str) -> Option<Rc<[Keyframe]>> {
        let name = name.strip_prefix(GROUP_ANIMATION)?;
        self.view_transition
            .as_ref()?
            .groups
            .iter()
            .find(|it| it.name == name)?
            .keyframes
            .clone()
    }

    pub(crate) fn transition_part(&self, pseudo: Pseudo) -> Option<NodeId> {
        let root = self.transition_root()?;
        core::iter::once(root)
            .chain(self.tree.descendants(root))
            .find(|it| self.tree.element(*it).is_some_and(|it| it.pseudo == pseudo))
    }

    /// As in `::view-transition-group(name)`
    pub(crate) fn name_of_part(&self, node: NodeId, part: Part) -> String {
        let group = self
            .view_transition
            .iter()
            .flat_map(|it| &it.groups)
            .find(|it| it.parts[part as usize] == node);
        group.map_or(format!("::{}", part.name()), |it| {
            format!("::{}({})", part.name(), it.name)
        })
    }

    /// The opacity that gives the same result without blending, where the image that fades in is opaque.
    pub(crate) fn opacity_in_cross_fade(&self, node: NodeId) -> Option<f32> {
        let transition = self.view_transition.as_ref()?;
        let group = transition
            .groups
            .iter()
            .find(|it| it.new.as_ref().is_some_and(|it| self.tree.is_root(it.1)))?;
        let parts = [Part::Old, Part::New].map(|it| group.parts[it as usize]);
        let [old, new] = parts
            .contains(&node)
            .then(|| parts.map(|it| self.own_box(it)))?;
        let [old, new] = [old?, new?].map(|it| {
            (
                self.to_viewport(it),
                self.border_box(it),
                &self.boxes[it].style,
            )
        });
        let is_plain = |it: &Style| {
            let e = &it.effects;
            it.is_visible()
                && e.blend == Blend::PlusLighter
                && e.filter.0.is_empty()
                && e.clip_path.0.is_none()
                && !it.has_mask()
                && e.object_fit == ObjectFit::Fill
        };
        let [from, to] = [old.2, new.2].map(|it| it.effects.opacity.0);
        let is_simple = (old.0, old.1) == (new.0, new.1)
            && is_plain(old.2)
            && is_plain(new.2)
            && (from + to - 1.0).abs() < 0.002;
        (is_simple && group.old.as_ref()?.0.ink == group.new.as_ref()?.0.ink)
            .then_some(if node == parts[0] { 1.0 } else { to })
    }

    fn captured_image(&self, image: u32) -> Option<(&Group, &Placement)> {
        let group = self
            .view_transition
            .as_ref()?
            .groups
            .get((image & !SNAPSHOT) as usize / 2)?;
        Some((
            group,
            if image & 1 == 0 {
                &group.old.as_ref()?.0
            } else {
                &group.new.as_ref()?.0
            },
        ))
    }

    fn snapshot_matrix(placement: &Placement, rect: Rect) -> Matrix {
        let scale = |to: f32, from: f32| if from > 0.0 { to / from } else { 1.0 };
        let scale = scaling(
            scale(rect.width, placement.size[0]),
            scale(rect.height, placement.size[1]),
        );
        multiply(&translation([rect.x, rect.y]), &scale)
    }

    /// If its border box is shown in `rect`.
    pub(crate) fn snapshot_ink(&self, image: u32, rect: Rect) -> Rect {
        self.captured_image(image).map_or(rect, |(_, it)| {
            it.ink.transformed(&Self::snapshot_matrix(it, rect))
        })
    }
}

impl Painter<'_> {
    pub(crate) fn snapshot(&mut self, image: u32, rect: Rect, space: &Space) {
        let document = self.document;
        self.depends_on_outside();
        let Some((group, placement)) = document.captured_image(image) else {
            return;
        };
        let matrix = multiply(
            &translation([self.snap(rect.x) - rect.x, self.snap(rect.y) - rect.y]),
            &Document::snapshot_matrix(placement, rect),
        );
        let Some(inverse) = invert(&matrix) else {
            return;
        };
        let visible = placement
            .ink
            .intersection(&space.visible.transformed(&inverse));
        let fresh = group
            .new
            .as_ref()
            .filter(|_| image & 1 == 1)
            .map(|it| Painter::capture(document, it.1, placement, visible));
        let Some(picture) = fresh.as_ref().or(group.old.as_ref().map(|it| &it.1)) else {
            return;
        };
        self.out.seen.extend(fresh.iter().flat_map(|it| &it.seen));
        if !self.is_hidden {
            let mut inside = Space { visible, ..*space };
            self.link(Item::PushTransform(matrix), &mut inside);
            self.clip(square(placement.ink), &mut inside);
            self.enter(inside.link);
            self.out.append(picture);
        }
    }

    /// With the origin in the corner of the border box.
    fn capture(document: &Document, node: NodeId, placement: &Placement, visible: Rect) -> Picture {
        let (Some(transition), Some((id, rect))) =
            (&document.view_transition, document.captured_box(node))
        else {
            return Picture::default();
        };
        let mut painter = Painter::new(document, None, Picture::default(), Default::default());
        let [x, y] = placement.fraction;
        let space = Space {
            origin: [x - rect.x, y - rect.y],
            link: 0,
            scroller: abi::NO_SCROLLER,
            visible,
        };
        (painter.is_copy, painter.captures, painter.out.canvas_source) =
            (true, node, document.canvas_source());
        if document.tree.is_root(node) {
            painter.fill(square(visible), transition.canvas, &space);
            painter.page();
        } else {
            painter.enter_from_viewport(id, space.origin);
            match document.own_box(node) {
                Some(_) => painter.placed_stacking_context(id, space, true),
                None => {
                    let mut items = document.boxes[id].inline.iter().flat_map(|it| &it.items);
                    let index = items
                        .position(|it| it.node == node && matches!(it.kind, ItemKind::Open(_)));
                    index
                        .into_iter()
                        .for_each(|it| painter.inline_layer(id, it, &space));
                }
            }
        }
        painter.enter(0);
        painter.out
    }
}

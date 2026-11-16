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

/// With the slot of the transition, the index of the group, and a bit for the new image.
const SNAPSHOT: u32 = 1 << 30;
const SLOT_SHIFT: u32 = 20;
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
    /// More declarations for what has the groups in it.
    of_children: Out,
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
    /// The element that it is limited to, or 0.
    scope: NodeId,
    slot: u32,
    /// What the scope shows until the new state is captured.
    frozen: Option<(Placement, Picture)>,
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
    static OUTBOUND: RefCell<Vec<(u32, ViewTransition)>> = const { RefCell::new(Vec::new()) };
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
    fn scoped_names(&self, node: NodeId, property: Id, scope: NodeId) -> Vec<String> {
        let is_scoped = |_: &&str| match self.level_of_declaration(node, property) {
            Some(Level::Inner(_)) => false,
            level => {
                self.tree[node].scope
                    == if scope == 0 {
                        DOCUMENT
                    } else {
                        self.tree[scope].scope
                    }
                    || matches!(level, Some(Level::Outer(_)))
            }
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

    fn transition_name(&self, node: NodeId, scope: NodeId) -> Option<String> {
        let name = self
            .scoped_names(node, Id::ViewTransitionName, scope)
            .pop()?;
        self.captured_box(node)?;
        Some(match name {
            _ if name != "match-element" => name,
            _ if self.tree.is_root(node) => "root".into(),
            _ => format!("-ua-auto-{node}"),
        })
    }

    fn ancestors_in(&self, node: NodeId, scope: NodeId) -> impl Iterator<Item = NodeId> {
        core::iter::once(node)
            .chain(self.tree.flat_ancestors(node))
            .take_while(move |it| *it != scope)
            .map(|it| self.tree.flat_parent(it))
    }

    fn containing_group(&self, node: NodeId, scope: NodeId) -> Option<(String, NodeId)> {
        let of = |node| {
            self.scoped_names(node, Id::ViewTransitionGroup, scope)
                .pop()
                .unwrap_or_default()
        };
        (self.tree.style(node)?.other_if_set(Id::ViewTransitionGroup) != Some("none"))
            .then_some(())?;
        let mut named = self
            .ancestors_in(node, scope)
            .filter_map(|it| Some((self.transition_name(it, scope)?, it)));
        let explicit = named
            .by_ref()
            .find(|it| of(node) == "nearest" || it.0 == of(node));
        explicit.or_else(|| {
            self.ancestors_in(node, scope)
                .filter(|it| of(*it) == "contain")
                .find_map(|it| Some((self.transition_name(it, scope)?, it)))
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
    fn named_in(&self, node: NodeId, id: BoxId, scope: NodeId, out: &mut Vec<Named>) {
        let hides = |it: NodeId| {
            !self.tree.is_root(it)
                && self
                    .tree
                    .style(it)
                    .is_some_and(|it| it.other_if_set(Id::ViewTransitionScope) == Some("all"))
        };
        let is_found = |_: &String| {
            !core::iter::once(node)
                .chain(self.tree.flat_ancestors(node))
                .take_while(|it| *it != scope)
                .any(hides)
        };
        out.extend(
            self.transition_name(node, scope)
                .filter(is_found)
                .map(|name| Named {
                    node,
                    name,
                    container: self.containing_group(node, scope),
                }),
        );
        let mut inside = Vec::new();
        if id != 0 {
            self.stacking_contexts_in(id, &mut inside);
        }
        inside.sort_by_key(|it| it.0);
        inside
            .into_iter()
            .for_each(|it| self.named_in(it.1, it.2, scope, out));
    }

    /// `None` if two have the same name, or one is in another transition.
    fn named_elements(&mut self, scope: NodeId) -> Option<Vec<Named>> {
        self.update_layout();
        let (mut all, mut names) = (Vec::new(), Set::default());
        match scope {
            0 => self.boxes[VIEWPORT]
                .children
                .iter()
                .for_each(|it| self.named_in(self.boxes[*it].node, *it, 0, &mut all)),
            _ => self.named_in(scope, self.scope_box(scope)?, scope, &mut all),
        }
        all.iter()
            .all(|it| names.insert(Name::new(it.name.as_bytes())) && !self.is_captured(it.node))
            .then_some(all)
    }

    fn scope_box(&self, scope: NodeId) -> Option<BoxId> {
        self.own_box(scope)
            .filter(|it| !self.boxes[*it].is_replaced() && self.pieces(*it).is_none())
    }

    fn transition(&self, scope: NodeId) -> Option<&ViewTransition> {
        self.view_transitions.iter().find(|it| it.scope == scope)
    }

    fn take_transition(&mut self, scope: NodeId) -> Option<ViewTransition> {
        Some(
            self.view_transitions.remove(
                self.view_transitions
                    .iter()
                    .position(|it| it.scope == scope)?,
            ),
        )
    }

    /// One of them turns compositing on again.
    fn add_transition(&mut self, mut transition: ViewTransition) -> bool {
        let Some(slot) = (0..SNAPSHOT >> SLOT_SHIFT)
            .find(|slot| self.view_transitions.iter().all(|it| it.slot != *slot))
        else {
            return false;
        };
        (transition.slot, transition.was_composited) = (slot, self.stop_compositing());
        self.view_transitions.push(transition);
        true
    }

    fn size_scoped_root(&mut self, scope: NodeId, root: NodeId) -> Option<[f32; 2]> {
        let (id, zoom) = (self.scope_box(scope)?, self.zoom_of(scope));
        let inside = self.border_box(id).shrunk(self.boxes[id].border());
        let [width, height] = [inside.width / zoom, inside.height / zoom];
        self.declare(
            root,
            format!("display:block;position:fixed;left:0;top:0;width:{width}px;height:{height}px")
                .as_bytes(),
        );
        Some([inside.width, inside.height])
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

    fn placement(
        &mut self,
        node: NodeId,
        container: Option<NodeId>,
        scope: NodeId,
    ) -> Option<Placement> {
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
                of_children: Out::new(),
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
        let container = container.or_else(|| (scope != 0).then_some(scope));
        if let Some((around, rect)) = container
            .filter(|it| !self.tree.is_root(*it))
            .and_then(|it| self.captured_box(it))
        {
            matrix = if node == scope {
                IDENTITY
            } else {
                multiply(
                    &invert(&to_viewport(around, rect)).unwrap_or(IDENTITY),
                    &matrix,
                )
            };
            let [top, .., left] = container
                .and_then(|it| self.tree.style(it))
                .map_or([0.0; 4], |it| it.border());
            matrix = multiply(&translation([-left, -top]), &matrix);
        }
        let ink = Rect::new([left, top, right - left, bottom - top]);
        let (border, mut of_children) = (style.border(), Out::new());
        for property in ["top-left", "top-right", "bottom-right", "bottom-left"]
            .into_iter()
            .flat_map(|it| [format!("border-{it}-radius"), format!("corner-{it}-shape")])
        {
            of_children.extend(
                [
                    property.as_bytes(),
                    b":",
                    &self.computed_style(node, b"", property.as_bytes(), true),
                    b";",
                ]
                .concat(),
            );
        }
        if node == scope
            && !self.boxes[id]
                .overflow
                .contains(&crate::types::Overflow::Visible)
        {
            of_children.extend(b"overflow:clip");
        }
        Some(Placement {
            size: [rect.width, rect.height],
            matrix,
            ink,
            fraction,
            border,
            of_children,
            styles,
            backdrop_filter,
        })
    }

    fn classes_of(&self, node: NodeId, scope: NodeId) -> Vec<Name> {
        self.scoped_names(node, Id::ViewTransitionClass, scope)
            .iter()
            .map(|it| Name::new(it.as_bytes()))
            .collect()
    }

    pub(crate) fn capture_old_state(&mut self, scope: NodeId, canvas: u32) -> bool {
        self.end_view_transition(scope);
        if !self.add_transition(ViewTransition {
            scope,
            canvas,
            ..Default::default()
        }) {
            return false;
        }
        self.boxes.mark_ink(self.own_box(scope).unwrap_or(0));
        let Some(named) = self.named_elements(scope) else {
            return false;
        };
        self.update_picture();
        let frozen = if scope == 0 {
            None
        } else {
            self.placement(scope, None, scope)
        };
        let frozen = frozen.map(|it| (Painter::capture(self, scope, &it, it.ink), it));
        let (captured, size) = (
            named.iter().map(|it| it.node).collect(),
            self.snapshot_size(),
        );
        if let Some(it) = self.view_transitions.last_mut() {
            (it.captured, it.size) = (captured, size);
        }
        let mut groups = Vec::new();
        for Named {
            node,
            name,
            container,
        } in named
        {
            let Some(placement) = self.placement(node, container.as_ref().map(|it| it.1), scope)
            else {
                continue;
            };
            let (picture, classes) = (
                Painter::capture(self, node, &placement, placement.ink),
                self.classes_of(node, scope),
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
        if let Some(it) = self.view_transitions.last_mut() {
            (it.groups, it.captured, it.frozen) =
                (groups, Set::default(), frozen.map(|it| (it.1, it.0)));
        }
        if scope != 0 {
            self.pictures.discard();
        }
        true
    }

    pub(crate) fn hand_over_old_state(&mut self, ticket: u32) {
        let transition = self.take_transition(0);
        OUTBOUND.with_borrow_mut(|all| {
            all.drain(..all.len().saturating_sub(3));
            all.extend(transition.map(|it| (ticket, it)));
        });
    }

    pub(crate) fn take_over_old_state(&mut self, ticket: u32) -> bool {
        let Some((_, transition)) =
            OUTBOUND.with_borrow_mut(|all| all.extract_if(.., |it| it.0 == ticket).next())
        else {
            return false;
        };
        self.end_view_transition(0);
        self.add_transition(transition)
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
        (element.pseudo, element.originator) = (
            pseudo,
            self.tree.element(parent).map_or(0, |it| it.originator),
        );
        element.custom_states.extend_from_slice(classes);
        let node = self.tree.create(Data::Element(Box::new(element)));
        self.tree.link(parent, node, 0);
        self.tree[node].scope = self.tree[parent].scope;
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

    fn geometry(&self, it: &Placement, zoom: f32) -> Out {
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

    fn style_group(&mut self, slot: u32, index: usize, group: &Group) {
        let zoom = self.zoom_of(
            self.tree
                .element(group.parts[Part::Group as usize])
                .map_or(0, |it| it.originator),
        );
        let Some(placement) = group
            .new
            .as_ref()
            .map(|it| &it.0)
            .or_else(|| group.old.as_ref().map(|it| &it.0))
        else {
            return;
        };
        let mut source = [self.geometry(placement, zoom), placement.styles.clone()].concat();
        if group.keyframes.is_some() {
            source.extend(format!("animation-name:{GROUP_ANIMATION}").bytes());
            write_ident(group.name.as_bytes(), &mut source);
        }
        self.declare(group.parts[Part::Group as usize], &source);
        if group.parts[Part::Children as usize] != 0 {
            let [top, right, bottom, left] = placement.border.map(|it| it / zoom);
            let widths = format!("border-width:{top}px {right}px {bottom}px {left}px;");
            self.declare(
                group.parts[Part::Children as usize],
                &[widths.as_bytes(), &placement.of_children].concat(),
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
                SNAPSHOT | slot << SLOT_SHIFT | (index * 2 + is_new) as u32,
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

    pub(crate) fn capture_new_state(&mut self, scope: NodeId) -> bool {
        let Some(named) = self.named_elements(scope) else {
            return false;
        };
        let (root, size) = (
            if scope == 0 {
                self.tree.root_element()
            } else {
                scope
            },
            self.snapshot_size(),
        );
        if self.tree.style(root).is_none()
            || self
                .transition(scope)
                .is_none_or(|it| scope == 0 && it.size != size)
        {
            return false;
        }
        let Some(mut transition) = self.take_transition(scope) else {
            return false;
        };
        transition.frozen = None;
        for Named {
            node,
            name,
            container,
        } in named
        {
            let Some(placement) = self.placement(node, container.as_ref().map(|it| it.1), scope)
            else {
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
                self.classes_of(node, scope),
                container.map(|it| it.0),
            );
            transition.captured.insert(node);
            self.boxes.mark_ink(self.tree[node].layout_box);
        }
        let mut element = Element::new(name!(""), Namespace::Html);
        (element.pseudo, element.originator) = (Pseudo::Transition(Part::Block, Name::NONE), root);
        transition.root = self.tree.create(Data::Element(Box::new(element)));
        self.tree[transition.root].scope = self.tree[root].scope;
        let old = self.tree.element_mut(root).map_or(0, |it| {
            core::mem::replace(&mut it.generated[BACKDROP], transition.root)
        });
        if old != 0 {
            self.free_subtree(old);
        }
        let (zoom, [top, .., left]) = (self.zoom_of(root), self.gutters(VIEWPORT));
        let [left, top, width, height] = [-left, -top, size[0], size[1]].map(|it| it / zoom);
        self.declare(transition.root, format!("display:block;position:fixed;left:{left}px;top:{top}px;width:{width}px;height:{height}px").as_bytes());
        transition.size = self
            .size_scoped_root(scope, transition.root)
            .unwrap_or(size);
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
                    &self.geometry(old, zoom),
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
            .for_each(|(index, group)| self.style_group(transition.slot, index, group));
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
        self.view_transitions.push(transition);
        self.mark_rebuild(DOCUMENT);
        self.pictures.discard();
        self.update_layout();
        true
    }

    /// Follows the captured elements. `None` if that is not possible, or else whether something is still animated.
    pub(crate) fn update_view_transition(&mut self, scope: NodeId) -> Option<bool> {
        self.update_layout();
        let transition = self
            .transition(scope)
            .filter(|it| self.is_transition_root(it.root))?;
        let root = transition.root;
        (if scope == 0 {
            transition.size == self.snapshot_size()
        } else {
            self.scope_box(scope).is_some()
        })
        .then_some(())?;
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
        let followed: Vec<_> = followed.collect();
        for (index, node, container) in followed {
            self.is_captured(node).then_some(())?;
            placements.push((index, self.placement(node, container, scope)?));
        }
        let mut transition = self.take_transition(scope)?;
        if let Some(inside) = self
            .scope_box(scope)
            .map(|it| self.border_box(it).shrunk(self.boxes[it].border()))
            && transition.size != [inside.width, inside.height]
        {
            transition.size = self.size_scoped_root(scope, root).unwrap_or_default();
        }
        for (index, placement) in placements {
            let group = &mut transition.groups[index];
            if let Some(new) = group.new.as_mut().filter(|it| it.0 != placement) {
                new.0 = placement;
                self.style_group(transition.slot, index, group);
                self.boxes
                    .mark_ink(self.tree[group.parts[Part::New as usize]].layout_box);
            }
        }
        self.view_transitions.push(transition);
        self.pictures.discard();
        self.update_layout();
        Some(
            core::iter::once(root)
                .chain(self.tree.descendants(root))
                .any(|it| self.is_still_animated(it)),
        )
    }

    pub(crate) fn end_view_transition(&mut self, scope: NodeId) {
        let Some(transition) = self.take_transition(scope) else {
            return;
        };
        self.forget_transition(&transition);
        self.boxes.mark_ink(self.own_box(scope).unwrap_or(0));
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

    fn forget_transition(&mut self, transition: &ViewTransition) {
        match self.view_transitions.first_mut() {
            Some(other) => other.was_composited |= transition.was_composited,
            None => self.compositor.is_on = transition.was_composited,
        }
    }

    /// Once there is something to show.
    pub(crate) fn transition_roots(&self) -> impl Iterator<Item = NodeId> {
        self.view_transitions
            .iter()
            .map(|it| it.root)
            .filter(|it| self.is_transition_root(*it))
    }

    pub(crate) fn transition_root(&self, scope: NodeId) -> Option<NodeId> {
        Some(self.transition(scope)?.root).filter(|it| self.is_transition_root(*it))
    }

    pub(crate) fn is_transition_root(&self, node: NodeId) -> bool {
        !self.view_transitions.is_empty()
            && self
                .tree
                .element(node)
                .is_some_and(|it| matches!(it.pseudo, Pseudo::Transition(Part::Block, _)))
    }

    pub(crate) fn is_transition_scope(&self, node: NodeId) -> bool {
        node != 0 && self.transition(node).is_some()
    }

    pub(crate) fn is_captured(&self, node: NodeId) -> bool {
        self.view_transitions
            .iter()
            .any(|it| it.captured.contains(&node))
    }

    pub(crate) fn captured_node_freed(&mut self, node: NodeId) {
        self.view_transitions
            .iter_mut()
            .for_each(|it| _ = it.captured.remove(&node));
        if let Some(transition) = self.take_transition(node) {
            self.forget_transition(&transition);
        }
    }

    pub(crate) fn transition_keyframes(&self, node: NodeId, name: &str) -> Option<Rc<[Keyframe]>> {
        let name = name.strip_prefix(GROUP_ANIMATION)?;
        let originator = self.tree.element(node).map_or(0, |it| it.originator);
        self.transition(originator)
            .or_else(|| self.transition(0))?
            .groups
            .iter()
            .find(|it| it.name == name)?
            .keyframes
            .clone()
    }

    pub(crate) fn transition_part(&self, originator: NodeId, pseudo: Pseudo) -> Option<NodeId> {
        let root = self.transition_roots().find(|it| {
            self.tree
                .element(*it)
                .is_some_and(|it| it.originator == originator)
        })?;
        core::iter::once(root)
            .chain(self.tree.descendants(root))
            .find(|it| self.tree.element(*it).is_some_and(|it| it.pseudo == pseudo))
    }

    /// As in `::view-transition-group(name)`
    pub(crate) fn name_of_part(&self, node: NodeId, part: Part) -> String {
        let group = self
            .view_transitions
            .iter()
            .flat_map(|it| &it.groups)
            .find(|it| it.parts[part as usize] == node);
        group.map_or_else(
            || format!("::{}", part.name()),
            |it| format!("::{}({})", part.name(), it.name),
        )
    }

    /// The opacity that gives the same result without blending, where the image that fades in is opaque.
    pub(crate) fn opacity_in_cross_fade(&self, node: NodeId) -> Option<f32> {
        let transition = self.transition(0)?;
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
        let transition = self
            .view_transitions
            .iter()
            .find(|it| it.slot == (image & !SNAPSHOT) >> SLOT_SHIFT)?;
        let group = transition
            .groups
            .get(image as usize % (1 << SLOT_SHIFT) / 2)?;
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
        let Some(picture) = fresh
            .as_ref()
            .or_else(|| group.old.as_ref().map(|it| &it.1))
        else {
            return;
        };
        self.out.seen.extend(fresh.iter().flat_map(|it| &it.seen));
        if !self.is_hidden {
            let mut inside = Space { visible, ..*space };
            self.link(&Item::PushTransform(matrix), &mut inside);
            self.clip(square(placement.ink), &mut inside);
            self.enter(inside.link);
            self.out.append(picture);
        }
    }

    /// Whether the box has been shown as it was.
    pub(crate) fn frozen_scope(&mut self, id: BoxId, space: &Space) -> bool {
        let Some((placement, picture)) = self
            .document
            .transition(self.document.boxes[id].node)
            .and_then(|it| it.frozen.as_ref())
        else {
            return false;
        };
        let mut inside = *space;
        self.link(
            &Item::PushTransform(translation(
                [0, 1].map(|it| self.snap(space.origin[it] - placement.fraction[it])),
            )),
            &mut inside,
        );
        self.enter(inside.link);
        self.out.append(picture);
        true
    }

    /// The pseudo-elements, which are laid out in the corner of the viewport.
    pub(crate) fn scoped_transition(&mut self, id: BoxId, space: &Space) {
        let (document, it) = (self.document, &self.document.boxes[id]);
        let Some(root) = document
            .transition_root(it.node)
            .filter(|_| it.node != self.captures)
            .and_then(|it| document.own_box(it))
        else {
            return;
        };
        let [top, .., left] = it.border();
        self.depends_on_outside();
        self.stacking_context(
            root,
            Space {
                origin: [space.origin[0] + left, space.origin[1] + top],
                ..*space
            },
        );
    }

    /// With the origin in the corner of the border box.
    fn capture(document: &Document, node: NodeId, placement: &Placement, visible: Rect) -> Picture {
        let Some((id, rect)) = document
            .captured_box(node)
            .filter(|it| invert(&document.to_viewport(it.0)).is_some())
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
            painter.fill(
                square(visible),
                document.transition(0).map_or(0, |it| it.canvas),
                &space,
            );
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

//! What `getComputedStyle` answers.

use std::rc::Rc;

use crate::boxes::Kind;
use crate::document::Document;
use crate::grammar::Mode;
use crate::name::{is_name, name};
use crate::properties::{Id, Prop, Style, Value};
use crate::selector::Pseudo;
use crate::svg_values::PathData;
use crate::tree::{DOCUMENT, Data, Element, Flags, Namespace, NodeId};
use crate::types::*;
use crate::values::{
    Css, Ctx, Lp, Out, Pair, Position, Time, parse_all, with_current_color, with_zoom, write_list,
    write_px, write_string,
};

fn depends_on_layout(style: &Style, id: Id) -> bool {
    match style.get(id) {
        _ if matches!(style.display(), Display::None | Display::Contents) => false,
        Value::MarginTop(it)
        | Value::MarginRight(it)
        | Value::MarginBottom(it)
        | Value::MarginLeft(it) => !matches!(it.0, Some(Lp::Px(_))),
        Value::PaddingTop(it)
        | Value::PaddingRight(it)
        | Value::PaddingBottom(it)
        | Value::PaddingLeft(it) => !matches!(it.0, Lp::Px(_)),
        Value::Top(_) | Value::Right(_) | Value::Bottom(_) | Value::Left(_) => {
            style.layout.position != PositionKind::Static
        }
        _ => true,
    }
}

fn may_depend_on_layout(id: Id) -> bool {
    matches!(
        id,
        Id::Width
            | Id::Height
            | Id::MinWidth
            | Id::MinHeight
            | Id::GridTemplateRows
            | Id::GridTemplateColumns
    ) || matches!(
        id,
        Id::Transform | Id::TransformOrigin | Id::PerspectiveOrigin
    ) || (Id::MarginTop as u16..=Id::Left as u16).contains(&(id as u16))
}

fn write_computed(style: &Style, id: Id, out: &mut Out) {
    const CONTENT: Contain = Contain::LAYOUT.union(Contain::PAINT).union(Contain::STYLE);
    match id {
        Id::Interactivity if style.ink.interactivity != Interactivity::Auto => out.extend(b"inert"),
        Id::Display if style.clamps_lines() => out.extend(
            if style.display().is_inline_level() {
                "inline-block"
            } else {
                "flow-root"
            }
            .bytes(),
        ),
        Id::Contain if style.layout.contain == CONTENT => out.extend(b"content"),
        Id::Contain if style.layout.contain == CONTENT | Contain::SIZE => out.extend(b"strict"),
        Id::PositionArea if !style.rare.position_area.is_empty() => {
            crate::anchor::write_area(&style.rare.position_area, out)
        }
        Id::WordSpacing => style.text.word_spacing.0.write(out),
        Id::ScrollbarColor if let Some(Pair(thumb, track)) = &style.ink.scrollbar_color.0 => {
            write_list(&[thumb, track], " ", out, |it, out| it.write(out))
        }
        Id::FontFeatureSettings if !style.font.features.is_empty() => {
            write_list(&style.font.features, ", ", out, |it, out| match it.value {
                1.0 => write_string(&it.tag, out),
                _ => it.write(out),
            })
        }
        Id::CaretColor if style.ink.caret_color.0.is_none() => style.ink.color.write(out),
        _ => style.get(id).write(out),
    }
}

impl Document {
    /// Leaves for later what the style of the node does not depend on.
    pub(crate) fn update_style_of(&mut self, node: NodeId) {
        let has_above = |it: &Document, flags| {
            core::iter::once(node)
                .chain(it.tree.flat_ancestors(node))
                .any(|at| it.tree[at].has(flags))
        };
        let is_dirty = |it: &Document| {
            it.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS) && has_above(it, Flags::STYLE_DIRTY)
        };
        let is_skipped = self.is_in_skipped_contents(node);
        if !self.prepare_restyle()
            || self.tree.style(node).is_none()
            || is_skipped
            || is_dirty(self)
        {
            self.force(node, Document::update_style);
        }
        let is_laid_out = !is_skipped
            && !self.needs_layout
            && self.moved_boxes.is_empty()
            && !self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS);
        if !(self.containers.is_empty() && self.anchored.is_empty())
            && !is_laid_out
            && (self.tree.style(node).is_none()
                || has_above(self, Flags::QUERIES_CONTAINER | Flags::MEASURES_CONTAINER))
        {
            self.force(node, Document::update_forced_layout);
        }
    }

    /// With the node that has it, if there is one.
    fn style_of_pseudo(&mut self, id: NodeId, pseudo: Pseudo) -> Option<(NodeId, Rc<Style>)> {
        if pseudo == Pseudo::None {
            return Some((id, self.style_on_demand(id)?));
        }
        let is_highlight =
            |name| crate::name::is_name!(name, "spelling-error" | "grammar-error" | "search-text");
        if matches!(pseudo, Pseudo::Selection | Pseudo::Highlight(_))
            || matches!(pseudo, Pseudo::Part(name) if is_highlight(name))
        {
            return Some((0, Rc::new(self.computed_highlight(id, pseudo)?)));
        }
        let (element, pseudo) = (self.tree.element(id)?, self.complete_pseudo(id, pseudo));
        let is_it = |it: &NodeId| self.tree.element(*it).is_some_and(|it| it.pseudo == pseudo);
        let found = element
            .generated
            .into_iter()
            .chain(self.carousels.parts_of(id))
            .chain(self.tree.descendants(element.shadow_root))
            .find(is_it);
        let found = found.or_else(|| self.transition_part(id, pseudo));
        if let Some(found) = found {
            return Some((found, self.style_on_demand(found)?));
        }
        let is_missing = pseudo == Pseudo::Part(name!("picker(select)"))
            && crate::theme::Look::of(element) != crate::theme::Look::MenuList;
        let mut stand_in = Element::new(name!(""), Namespace::Html);
        (stand_in.pseudo, stand_in.originator) = (
            if is_missing {
                Pseudo::Part(crate::name::Name::NONE)
            } else {
                pseudo
            },
            id,
        );
        let stand_in = self.tree.create(Data::Element(Box::new(stand_in)));
        let style = self.style_on_demand(stand_in);
        self.tree.free(stand_in);
        Some((0, style?))
    }

    fn used_length(&self, node: NodeId, style: &Style, id: Id) -> Option<f32> {
        let own = self
            .own_box(node)
            .filter(|_| may_depend_on_layout(id) && depends_on_layout(style, id))?;
        let (layout, [.., width, height], gutters) = (
            &self.boxes[own].layout,
            self.content_box(own),
            self.gutters(own),
        );
        let is_border_box = style.layout.box_sizing == BoxSizing::BorderBox;
        let (l, side) = (
            &style.layout,
            (id as usize).wrapping_sub(Id::Top as usize) % 4,
        );
        let insets = [&l.top, &l.right, &l.bottom, &l.left];
        let inset = || {
            if let Inset::Length(length) = insets[side] {
                Some(length)
            } else {
                None
            }
        };
        Some(match id {
            Id::Width if is_border_box => layout.size.width,
            Id::Height if is_border_box => layout.size.height,
            Id::Width => width + gutters[1] + gutters[3],
            Id::Height => height + gutters[2],
            Id::MarginTop => layout.margin.top,
            Id::MarginRight => layout.margin.right,
            Id::MarginBottom => layout.margin.bottom,
            Id::MarginLeft => layout.margin.left,
            Id::PaddingTop => layout.padding.top,
            Id::PaddingRight => layout.padding.right,
            Id::PaddingBottom => layout.padding.bottom,
            Id::PaddingLeft => layout.padding.left,
            Id::Top | Id::Right | Id::Bottom | Id::Left if style.is_out_of_flow() => {
                let anchored = self.boxes[own].anchored.as_deref();
                let block = self
                    .anchored
                    .get(&node)
                    .map_or_else(|| self.client_box(self.boxes[own].container), |it| it.block);
                let block = block.shrunk(anchored.and_then(|it| it.area).unwrap_or_default());
                match insets[side] {
                    Inset::Length(length) => length.resolve([block.height, block.width][side % 2]),
                    _ if anchored.is_some_and(|it| {
                        it.area.is_some() || it.center[1 - side % 2].is_some()
                    }) =>
                    {
                        0.0
                    }
                    _ => [
                        layout.location.y - layout.margin.top - block.y,
                        block.right() - layout.location.x - layout.size.width - layout.margin.right,
                        block.bottom()
                            - layout.location.y
                            - layout.size.height
                            - layout.margin.bottom,
                        layout.location.x - layout.margin.left - block.x,
                    ][side],
                }
            }
            Id::Top | Id::Right | Id::Bottom | Id::Left
                if style.layout.position == PositionKind::Relative =>
            {
                let [.., width, height] = self.content_box(self.boxes[own].parent);
                let [x, y] = crate::lines::relative_offset(style, width, Some(height));
                inset().map_or([y, -x, -y, x][side] + 0.0, |it| {
                    it.resolve([height, width][side % 2])
                })
            }
            Id::Top | Id::Right | Id::Bottom | Id::Left
                if style.layout.position == PositionKind::Sticky =>
            {
                let scroller = self
                    .boxes
                    .containers(own)
                    .find(|it| self.boxes[*it].scrolls())
                    .unwrap_or(crate::boxes::VIEWPORT);
                let [.., width, height] = self.content_box(scroller);
                inset()?.resolve([height, width][side % 2])
            }
            _ => return None,
        })
    }

    fn write_resolved(&self, node: NodeId, style: &Style, id: Id, out: &mut Out) {
        match id {
            Id::Float => return style.computed_sides.0.write(out),
            Id::Clear => return style.computed_sides.1.write(out),
            _ => {}
        }
        if let Some(length) = self.used_length(node, style, id) {
            return write_px(length, out);
        }
        let own = self.own_box(node);
        let size = own.map_or_else(Default::default, |it| self.boxes[it].layout.size);
        match id {
            Id::LineHeight if style.font.line_height != LineHeight::Normal => {
                write_px(style.line_height(), out)
            }
            Id::FontSize => write_px(style.font.size.0, out),
            Id::D
                if style.shape.d == PathData::Attribute
                    && let Some(path) =
                        self.tree.element(node).filter(|it| it.tag == name!("path")) =>
            {
                let data = path
                    .attribute(name!("d"))
                    .and_then(crate::path::normalize)
                    .filter(|it| !it.is_empty());
                data.map_or(PathData::None, |it| PathData::Path(it.into()))
                    .write(out);
            }
            Id::Width | Id::Height
                if style.display() != Display::None
                    && let Some(shape) = self
                        .svg_node(node)
                        .filter(|it| is_name!(it.tag, "rect" | "image" | "foreignObject")) =>
            {
                write_px(
                    shape.specified_size()[usize::from(id == Id::Height)].unwrap_or(0.0)
                        * style.zoom,
                    out,
                );
            }
            Id::Transform if own.is_none() && style.display() == Display::None => {
                out.extend(b"none")
            }
            Id::Transform if !style.effects.transform.0.is_empty() => {
                crate::transform::write_matrix(
                    &style.effects.transform.matrix_3d(size.width, size.height),
                    out,
                );
            }
            Id::TransformOrigin if own.is_some() => {
                let [x, y] = style
                    .effects
                    .origin
                    .0
                    .resolve(size.width, size.height)
                    .map(Lp::Px);
                TransformOrigin(Position(x, y), style.effects.origin.1).write(out);
            }
            Id::GridTemplateRows | Id::GridTemplateColumns
                if let Some(info) = own.and_then(|it| self.boxes[it].grid.as_ref()) =>
            {
                info.write(usize::from(id == Id::GridTemplateRows), out);
            }
            Id::MinWidth | Id::MinHeight
                if [&style.layout.min_width, &style.layout.min_height]
                    [usize::from(id == Id::MinHeight)]
                    == &crate::values::Size::Auto
                    && !own.is_some_and(|it| {
                        matches!(
                            self.boxes[self.boxes[it].parent].kind,
                            Kind::Flex | Kind::Grid
                        ) && !style.is_out_of_flow()
                    }) =>
            {
                out.extend(b"0px");
            }
            Id::Content
                if style.rare.content == Content::Normal && self.tree.element(node).is_none() =>
            {
                out.extend(b"none")
            }
            Id::BorderTopWidth
            | Id::BorderRightWidth
            | Id::BorderBottomWidth
            | Id::BorderLeftWidth => {
                write_px(
                    style.border()[id as usize - Id::BorderTopWidth as usize],
                    out,
                );
            }
            Id::PerspectiveOrigin if own.is_some() => {
                let origin = parse_all(style.other(id).as_bytes(), |p| {
                    Position::parse(
                        p,
                        &Ctx {
                            zoom: style.zoom,
                            ..Ctx::dummy()
                        },
                    )
                });
                origin.iter().for_each(|it| {
                    write_list(&it.resolve(size.width, size.height), " ", out, |it, out| {
                        write_px(*it, out)
                    })
                });
            }
            Id::AnimationDuration
                if style
                    .animation
                    .timeline
                    .iter()
                    .all(|it| *it == Timeline::Auto) =>
            {
                write_list(&style.animation.duration, ", ", out, |it, out| {
                    Time(it.0.max(0.0)).write(out)
                });
            }
            Id::Content
                if style.rare.content == Content::None
                    && self.tree.element(node).is_some_and(|it| !it.is_generated()) =>
            {
                out.extend(b"normal")
            }
            Id::BackgroundImage
            | Id::MaskImage
            | Id::BorderImageSource
            | Id::ListStyleImage
            | Id::Content
            | Id::ShapeOutside
            | Id::AnimationRangeStart
            | Id::AnimationRangeEnd
            | Id::PositionArea
            | Id::PositionTryFallbacks
            | Id::TouchAction => {
                write_computed(style, id, out);
                if bun_core::strings::contains_char(out, b' ')
                    || bun_core::strings::contains_char(out, b',')
                {
                    let respelled = self.with_context(node, style, style, |cx| {
                        id.syntax().write(out, Mode::Computed(cx))
                    });
                    respelled.into_iter().for_each(|it| *out = it);
                }
            }
            Id::BackgroundPositionX
            | Id::BackgroundPositionY
            | Id::BackgroundSize
            | Id::BackgroundRepeat
            | Id::BackgroundAttachment
            | Id::BackgroundOrigin
            | Id::BackgroundClip => {
                write_computed(style, id, out);
                let all = crate::grammar::split_list(out);
                *out = all[..all.len().min(style.background.image.len())].join(&b", "[..]);
            }
            _ => write_computed(style, id, out),
        }
    }

    pub(crate) fn computed_style(
        &mut self,
        node: NodeId,
        pseudo: &[u8],
        property: &[u8],
        resolves: bool,
    ) -> Out {
        let out = Out::new();
        let Some(prop) = Prop::from_name(property) else {
            return out;
        };
        let generated = self
            .tree
            .element(node)
            .filter(|_| !pseudo.is_empty())
            .map_or([0; 4], |it| it.generated);
        generated
            .into_iter()
            .chain([node])
            .for_each(|it| self.stop_lagging(it));
        match pseudo.is_empty() {
            true if self.is_in_skipped_contents(node) => {
                self.update_skipped_values(node, prop.longhands(crate::values::Flow::DEFAULT))
            }
            true => self.update_style_of(node),
            false => self.force(node, Document::update_style),
        }
        let is_used = |style: &Rc<Style>| {
            prop.longhands(style.flow())
                .iter()
                .any(|it| may_depend_on_layout(*it) && depends_on_layout(style, *it))
        };
        if !pseudo.is_empty()
            || self.anchored.contains_key(&node)
            || self.tree.style(node).is_some_and(is_used)
        {
            self.force(node, Document::update_forced_layout);
        }
        let Some((node, style)) = self.style_of_pseudo(node, Pseudo::from_name(pseudo)) else {
            return out;
        };
        if let Prop::Custom(name) = prop {
            return style
                .customs
                .get(name, &self.styles.registry)
                .map_or(out, |it| crate::custom::untainted(it).to_vec());
        }
        let written = |write: &dyn Fn(&mut Out)| {
            let mut out = Out::new();
            write(&mut out);
            out
        };
        with_current_color(style.ink.color, || {
            let resolved = |id: &Id| {
                with_zoom(style.zoom, || {
                    written(&|out| {
                        if resolves {
                            self.write_resolved(node, &style, *id, out)
                        } else {
                            write_computed(&style, *id, out)
                        }
                    })
                })
            };
            let mut values: Vec<_> = prop.longhands(style.flow()).iter().map(resolved).collect();
            match prop {
                Prop::Short(index) => crate::shorthand::get(index).join(
                    &values.iter().map(|it| &it[..]).collect::<Vec<_>>(),
                    Some(&|id| written(&|out| self.styles.initial.get(id).write(out))),
                ),
                Prop::All => out,
                _ => values.pop().unwrap_or_default(),
            }
        })
    }

    /// Twice, and then the part of the registered syntax that it matches.
    pub(crate) fn computed_value(&mut self, node: NodeId, property: &[u8]) -> Option<Vec<Out>> {
        let value = self.computed_style(node, b"", property, false);
        let Prop::Custom(name) = Prop::from_name(property)? else {
            return Some(vec![value.clone(), value]);
        };
        self.style_on_demand(node)?
            .customs
            .get(name, &self.styles.registry)?;
        let syntax = self
            .styles
            .registry
            .get(&name)
            .map(|it| it.syntax.component_for(&value));
        Some(vec![value.clone(), value, syntax.unwrap_or_default()])
    }

    pub(crate) fn custom_property_names(&mut self, node: NodeId, pseudo: &[u8]) -> Vec<Out> {
        self.update_layout();
        let Some((_, style)) = self.style_of_pseudo(node, Pseudo::from_name(pseudo)) else {
            return Vec::new();
        };
        let all = style
            .customs
            .names()
            .into_iter()
            .chain(self.styles.registry.keys().copied());
        let mut names: Vec<_> = all
            .filter(|it| style.customs.get(*it, &self.styles.registry).is_some())
            .map(crate::custom::spelling)
            .collect();
        names.sort_unstable();
        names.dedup();
        names.iter().map(|it| it.as_bytes().to_vec()).collect()
    }

    pub(crate) fn style_bits(&self, node: NodeId, wanted: u32) -> u32 {
        let hides =
            |it: NodeId| self.tree[it].has(Flags::SKIPPED) && !self.auto_visible.contains_key(&it);
        if self.is_in_skipped_contents(node) && self.tree.flat_ancestors(node).any(hides) {
            return 1 << 8 | 1 << 14;
        }
        let element = if self.tree[node].text().is_some() {
            self.tree.flat_parent(node)
        } else {
            node
        };
        let Some(style) = self
            .tree
            .style(element)
            .filter(|it| it.display() != Display::None)
        else {
            return 0;
        };
        let above = || {
            self.tree
                .flat_ancestors(node)
                .filter_map(|it| Some((it, self.tree.style(it)?)))
        };
        let own = self.own_box(node).filter(|_| wanted & 1 << 5 != 0);
        let scrolls = own.is_some_and(|it| {
            let range = self.scroll_range(it);
            (0..2).any(|axis| {
                matches!(
                    self.boxes[it].overflow[axis],
                    Overflow::Auto | Overflow::Scroll
                ) && range[axis] != [0.0; 2]
            })
        });
        let is_in_svg = self
            .tree
            .element(element)
            .is_some_and(|it| it.namespace == Namespace::Svg);
        let is_skipped = self.is_in_skipped_contents(node);
        let is_option = matches!(self.tree.html_tag(element), tag if tag == name!("option") || tag == name!("optgroup"));
        let bits = [
            self.tree[node].layout_box != 0
                || is_in_svg
                || is_option
                || is_skipped && style.display() != Display::Contents,
            style.is_visible(),
            style.is_editable(),
            style.text.user_modify == UserModify::PlaintextOnly,
            style.ink.interactivity != Interactivity::Auto,
            scrolls,
            style.display() == Display::Contents,
            style.effects.opacity.0 == 0.0
                || wanted & 1 << 7 != 0 && above().any(|it| it.1.effects.opacity.0 == 0.0),
            is_skipped,
            style.ink.user_select == UserSelect::None,
            style.ink.user_select == UserSelect::All,
            !style.display().is_inline_level() && style.display() != Display::Contents,
            style.is_rtl(),
            style.text.collapse.preserves_spaces(),
            false,
            style.text.collapse != WhiteSpaceCollapse::Collapse,
            style.other_if_set(Id::ReadingFlow).is_some(),
            style.dark,
            !style.ink.color_scheme.is_empty() || !self.environment.color_scheme.is_empty(),
            wanted & 1 << 19 != 0
                && style.scrolls()
                && self.own_box(node).is_some()
                && self.overflow_source() != node,
        ];
        bits.iter()
            .rev()
            .fold(0, |all, bit| all << 1 | u32::from(*bit))
    }
}

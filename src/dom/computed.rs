//! What `getComputedStyle` answers.

use std::rc::{Rc, Weak};

use crate::api::core::DomString;
use crate::boxes::Kind;
use crate::color::Rgba;
use crate::color::writes_current_color;
use crate::document::Document;
use crate::grammar::Mode;
use crate::name::{Name, is_name, name};
use crate::order::Order as _;
use crate::prelude::written;
use crate::properties::{Id, Prop, Style, Value};
use crate::selector::Pseudo;
use crate::svg_values::PathData;
use crate::tree::{DOCUMENT, Data, Element, Flags, Namespace, NodeId};
use crate::types::*;
use crate::values::{
    Css, Ctx, Lp, Out, Pair, Position, Time, parse_all, text, with_current_color, with_zoom,
    write_list, write_px, write_string,
};

fn depends_on_layout(style: &Style, id: Id) -> bool {
    let (it, side) = (&style.layout, |first: Id| id as usize - first as usize);
    match id {
        _ if matches!(style.display(), Display::None | Display::Contents) => false,
        Id::MarginTop | Id::MarginRight | Id::MarginBottom | Id::MarginLeft => !matches!(
            [
                &it.margin_top,
                &it.margin_right,
                &it.margin_bottom,
                &it.margin_left
            ][side(Id::MarginTop)]
            .0,
            Some(Lp::Px(_))
        ),
        Id::PaddingTop | Id::PaddingRight | Id::PaddingBottom | Id::PaddingLeft => !matches!(
            [
                &it.padding_top,
                &it.padding_right,
                &it.padding_bottom,
                &it.padding_left
            ][side(Id::PaddingTop)]
            .0,
            Lp::Px(_)
        ),
        Id::Top | Id::Right | Id::Bottom | Id::Left => it.position != PositionKind::Static,
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

/// Whether the resolved value is the same for all that have the style.
fn follows_from_style(style: &Style, id: Id) -> bool {
    match id {
        Id::D
        | Id::Content
        | Id::BackgroundImage
        | Id::MaskImage
        | Id::BorderImageSource
        | Id::ListStyleImage
        | Id::ShapeOutside => false,
        Id::AnimationRangeStart
        | Id::AnimationRangeEnd
        | Id::PositionArea
        | Id::PositionTryFallbacks
        | Id::TouchAction => false,
        _ if (Id::MarginTop as u16..=Id::Left as u16).contains(&(id as u16)) => {
            !depends_on_layout(style, id)
        }
        _ => !may_depend_on_layout(id),
    }
}

/// Whether `write_unusual_resolved` leaves it alone, if it follows from the style.
fn is_usual(style: &Style, id: Id) -> bool {
    match id {
        Id::Display => !style.clamps_lines(),
        Id::Float
        | Id::Clear
        | Id::LineHeight
        | Id::FontSize
        | Id::AnimationDuration
        | Id::Interactivity
        | Id::Contain
        | Id::WordSpacing
        | Id::ScrollSnapType => false,
        Id::BorderTopWidth
        | Id::BorderRightWidth
        | Id::BorderBottomWidth
        | Id::BorderLeftWidth
        | Id::ScrollbarColor
        | Id::FontFeatureSettings
        | Id::CaretColor => false,
        Id::BackgroundPositionX
        | Id::BackgroundPositionY
        | Id::BackgroundSize
        | Id::BackgroundRepeat
        | Id::BackgroundAttachment
        | Id::BackgroundOrigin
        | Id::BackgroundClip => false,
        _ => true,
    }
}

/// What was asked for lately.
#[derive(Default)]
pub(crate) struct Resolved {
    /// The weak reference keeps the address from being used again.
    by_style: Vec<(Weak<Style>, Id, DomString)>,
    /// With the current color, if it matters, and the zoom.
    by_value: Vec<Option<(Value, Option<Rgba>, f32, DomString)>>,
}

impl Resolved {
    const SLOTS: usize = 256;

    fn find(&self, style: &Style, id: Id) -> Option<&DomString> {
        let (value, color, zoom, written) =
            self.by_value.get(id as usize % Resolved::SLOTS)?.as_ref()?;
        (value.id() == id
            && style.has(value)
            && color.is_none_or(|it| it == style.ink.color)
            && *zoom == style.zoom)
            .then_some(written)
    }
}

fn write_computed(style: &Style, id: Id, out: &mut Out) {
    if !write_unusual_computed(style, id, out) {
        style.get(id).write(out);
    }
}

/// False if it is what the value says by itself.
fn write_unusual_computed(style: &Style, id: Id, out: &mut Out) -> bool {
    const CONTENT: Contain = Contain::LAYOUT.union(Contain::PAINT).union(Contain::STYLE);
    match id {
        Id::Interactivity if style.ink.interactivity == Interactivity::AutoInInertSubtree => {
            out.extend(b"auto")
        }
        Id::Interactivity if style.ink.interactivity != Interactivity::Auto => out.extend(b"inert"),
        Id::ScrollSnapType => (style.scroll.snap_type - ScrollSnapType::PROXIMITY).write(out),
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
        _ => return false,
    }
    true
}

bitflags::bitflags! {
    /// Of `style_bits`
    #[derive(Clone, Copy)]
    pub(crate) struct Visibility: u32 {
        const HIDDEN = 1 << 1;
        const TRANSPARENT = 1 << 7;
        const SKIPPED = 1 << 8;
        const LOCKED = 1 << 14;
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

    #[inline]
    fn has_nothing_put_off(&self) -> bool {
        self.animations.lagging.is_empty()
            && self.locks.missed.is_empty()
            && self.marks.is_empty()
            && self.top_layer.is_empty()
    }

    /// Whether `update_style` would do nothing for any node.
    #[inline]
    pub(crate) fn has_current_styles(&mut self) -> bool {
        self.has_nothing_put_off()
            && self.prepare_restyle()
            && !self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS)
    }

    /// Whether styles and boxes can be read as they are.
    #[inline]
    pub(crate) fn is_at_rest(&self) -> bool {
        let is_dirty = self.needs_layout
            || self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS)
            || self.animations.has_throttled
            || !self.moved_boxes.is_empty();
        !is_dirty
            && self.has_nothing_put_off()
            && !self.has_unmarked_changes()
            && !self.styles.dependencies.borrow().has_pending()
    }

    /// With the node that has it, if there is one.
    pub(crate) fn style_of_pseudo(
        &mut self,
        id: NodeId,
        pseudo: Pseudo,
    ) -> Option<(NodeId, Rc<Style>)> {
        if pseudo == Pseudo::None {
            return Some((id, self.animated_on_demand(id)?));
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
        stand_in.set_pseudo(
            if is_missing {
                Pseudo::Part(crate::name::Name::NONE)
            } else {
                pseudo
            },
            id,
        );
        let was_as_found = self.tree.is_as_found();
        let stand_in = self.tree.create(Data::Element(Box::new(stand_in)));
        self.tree.keep_found(was_as_found);
        let style = self.style_on_demand(stand_in);
        let was_as_found = self.tree.is_as_found();
        self.tree.free(stand_in);
        self.tree.keep_found(was_as_found);
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
                    .map(|it| it.block)
                    .or_else(|| self.containing_parts.get(&own).copied());
                let block = block.unwrap_or_else(|| self.client_box(self.boxes[own].container));
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
        if !self.write_unusual_resolved(node, style, id, out) {
            style.get(id).write(out);
        }
    }

    /// False if it is what the value says by itself.
    fn write_unusual_resolved(&self, node: NodeId, style: &Style, id: Id, out: &mut Out) -> bool {
        let own = if may_depend_on_layout(id) {
            self.own_box(node)
        } else {
            None
        };
        let shape = (own.is_none() && matches!(id, Id::Transform | Id::TransformOrigin))
            .then(|| self.rendered_node(node))
            .flatten();
        let reference = shape.map(|it| self.svg_transform_reference(&it));
        let size = own.map_or_else(
            || {
                reference
                    .map(|it| [it.width, it.height].map(|it| it * style.zoom))
                    .unwrap_or_default()
            },
            |it| {
                [
                    self.boxes[it].layout.size.width,
                    self.boxes[it].layout.size.height,
                ]
            },
        );
        match id {
            Id::Float => style.computed_sides.0.write(out),
            Id::Clear => style.computed_sides.1.write(out),
            _ if own.is_some()
                && let Some(length) = self.used_length(node, style, id) =>
            {
                write_px(length, out)
            }
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
                    && let Some(shape) = self.svg_node(node).filter(|it| {
                        is_name!(it.tag, "rect" | "image" | "foreignObject")
                            && (own.is_some() || it.tag != name!("foreignObject"))
                    }) =>
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
                    style.effects.transform.matrix_3d(size[0], size[1]),
                    out,
                );
            }
            Id::TransformOrigin if own.is_some() || reference.is_some() => {
                let [x, y] = style.effects.origin.0.resolve(size[0], size[1]).map(Lp::Px);
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
                if style.rare.content == Content::Normal
                    && self
                        .tree
                        .element(node)
                        .is_none_or(|it| matches!(it.pseudo, Pseudo::Before | Pseudo::After)) =>
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
                    write_list(&it.resolve(size[0], size[1]), " ", out, |it, out| {
                        write_px(*it, out)
                    })
                });
            }
            Id::AnimationDuration if style.animation.timeline[..] == [Timeline::Auto] => {
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
            _ => return write_unusual_computed(style, id, out),
        }
        true
    }

    /// If nothing has to be updated, and the style is all that `prop` depends on.
    #[inline]
    fn current_style_for(
        &mut self,
        node: NodeId,
        pseudo: Pseudo,
        prop: Prop,
    ) -> Option<(Rc<Style>, Id)> {
        let needs_no_layout = self.containers.is_empty() && self.anchored.is_empty()
            || !self.needs_layout && self.moved_boxes.is_empty();
        (pseudo == Pseudo::None && needs_no_layout && self.has_current_styles()).then_some(())?;
        let style = self.animated_on_demand(node)?;
        prop.id(style.flow())
            .filter(|it| follows_from_style(&style, *it))
            .map(|it| (style, it))
    }

    /// With all that `prop` depends on up to date.
    fn style_for(
        &mut self,
        node: NodeId,
        pseudo: Pseudo,
        prop: Prop,
    ) -> Option<(NodeId, Rc<Style>)> {
        self.current_style_for(node, pseudo, prop)
            .map(|it| (node, it.0))
            .or_else(|| self.updated_style_for(node, pseudo, prop))
    }

    fn updated_style_for(
        &mut self,
        node: NodeId,
        pseudo: Pseudo,
        prop: Prop,
    ) -> Option<(NodeId, Rc<Style>)> {
        let is_pseudo = pseudo != Pseudo::None;
        let generated = self
            .tree
            .element(node)
            .filter(|_| is_pseudo)
            .map_or([0; 4], |it| it.generated);
        generated
            .into_iter()
            .filter(|it| *it != 0)
            .chain([node])
            .for_each(|it| self.stop_lagging(it));
        let forced = generated
            .into_iter()
            .find(|it| self.tree.element(*it).is_some_and(|it| it.pseudo == pseudo))
            .unwrap_or(node);
        match is_pseudo {
            false if self.is_in_skipped_contents(node) => {
                self.update_skipped_values(node, prop.longhands(crate::values::Flow::DEFAULT))
            }
            false => self.update_style_of(node),
            true => self.force(forced, Document::update_style),
        }
        let forced = if self
            .tree
            .element(node)
            .is_some_and(|it| it.generated.contains(&forced))
        {
            forced
        } else {
            node
        };
        let is_used = |style: &Rc<Style>| {
            prop.longhands(style.flow())
                .iter()
                .any(|it| may_depend_on_layout(*it) && depends_on_layout(style, *it))
        };
        if is_pseudo
            || self.anchored.contains_key(&node)
            || self.tree.style(node).is_some_and(is_used)
        {
            self.force(forced, Document::update_forced_layout);
        }
        self.style_of_pseudo(node, pseudo)
    }

    fn serialize(&self, node: NodeId, style: &Style, prop: Prop, resolves: bool) -> Out {
        if let Prop::Custom(name) = prop {
            return style
                .customs
                .get(name, &self.styles.registry)
                .map_or(Out::new(), |it| crate::custom::untainted(it).to_vec());
        }
        with_current_color(style.ink.color, || {
            let resolved = |id: &Id| {
                with_zoom(style.zoom, || {
                    written(|out| {
                        if resolves {
                            self.write_resolved(node, style, *id, out)
                        } else {
                            write_computed(style, *id, out)
                        }
                    })
                })
            };
            match (prop, prop.longhands(style.flow())) {
                (Prop::Short(index), longhands) => crate::shorthand::get(index).join(
                    &longhands
                        .iter()
                        .map(resolved)
                        .collect::<Vec<_>>()
                        .iter()
                        .map(|it| &it[..])
                        .collect::<Vec<_>>(),
                    Some(&|id| written(|out| self.styles.initial.get(id).write(out))),
                ),
                (Prop::All, _) | (_, []) => Out::new(),
                (_, [.., id]) => resolved(id),
            }
        })
    }

    /// <https://drafts.csswg.org/cssom/#resolved-values>
    pub(crate) fn resolved_value(&mut self, node: NodeId, pseudo: Pseudo, prop: Prop) -> DomString {
        if let Some((style, id)) = self.current_style_for(node, pseudo, prop) {
            return self.resolved_by_style(node, &style, id);
        }
        let Some((node, style)) = self.updated_style_for(node, pseudo, prop) else {
            return DomString::default();
        };
        if (pseudo, prop) == (Pseudo::Marker, Prop::Long(Id::Content))
            && style.rare.content == Content::Normal
        {
            return DomString::from_utf8("normal");
        }
        match prop
            .id(style.flow())
            .filter(|it| follows_from_style(&style, *it))
        {
            Some(id) => self.resolved_by_style(node, &style, id),
            None => DomString::from_utf8(text(&self.serialize(node, &style, prop, true))),
        }
    }

    /// If there is nothing to work out.
    #[inline]
    pub(crate) fn known_resolved_value(&self, node: NodeId, prop: Prop) -> Option<DomString> {
        self.anticipate_reads(node);
        (self.is_at_rest() && self.offset_when_displayed.is_none()).then_some(())?;
        let find = |style: &Style| {
            self.resolved
                .find(
                    style,
                    prop.id(style.flow())
                        .filter(|it| is_usual(style, *it) && follows_from_style(style, *it))?,
                )
                .cloned()
        };
        match self.tree.style(node) {
            Some(style) => find(style),
            None if self.tree[node].has(Flags::ANIMATED) => None,
            None => self.recall_hidden(node, |it| find(&it.style))?,
        }
    }

    fn resolved_by_style(&mut self, node: NodeId, style: &Rc<Style>, id: Id) -> DomString {
        if self.resolved.by_style.is_empty() {
            self.resolved
                .by_style
                .resize_with(Resolved::SLOTS, || (Weak::new(), id, DomString::default()));
            self.resolved.by_value.resize_with(Resolved::SLOTS, || None);
        }
        let (color, zoom, mut out) = (style.ink.color, style.zoom, Out::new());
        if is_usual(style, id) {
            debug_assert!(!self.write_unusual_resolved(node, style, id, &mut out));
            if let Some(known) = self.resolved.find(style, id) {
                return known.clone();
            }
            let (value, known) = (
                style.get(id),
                &mut self.resolved.by_value[id as usize % Resolved::SLOTS],
            );
            let needs_color = with_current_color(color, || {
                with_zoom(zoom, || writes_current_color(|| value.write(&mut out)))
            });
            return known
                .insert((
                    value,
                    needs_color.then_some(color),
                    zoom,
                    DomString::from_utf8(text(&out)),
                ))
                .3
                .clone();
        }
        let slot = ((Rc::as_ptr(style) as usize >> 4) ^ (id as usize * 7)) % Resolved::SLOTS;
        if let Some(known) = Some(&self.resolved.by_style[slot])
            .filter(|it| it.1 == id && it.0.as_ptr() == Rc::as_ptr(style))
        {
            return known.2.clone();
        }
        with_current_color(color, || {
            with_zoom(zoom, || self.write_resolved(node, style, id, &mut out))
        });
        let resolved = DomString::from_utf8(text(&out));
        self.resolved.by_style[slot] = (Rc::downgrade(style), id, resolved.clone());
        resolved
    }

    pub(crate) fn computed_style(
        &mut self,
        node: NodeId,
        pseudo: Pseudo,
        prop: Prop,
        resolves: bool,
    ) -> Out {
        self.style_for(node, pseudo, prop)
            .map_or(Out::new(), |(node, style)| {
                self.serialize(node, &style, prop, resolves)
            })
    }

    /// With the part of the registered syntax that it matches.
    pub(crate) fn computed_value(&mut self, node: NodeId, prop: Prop) -> Option<(Out, Out)> {
        let value = self.computed_style(node, Pseudo::None, prop, false);
        let Prop::Custom(name) = prop else {
            return Some((value, Out::new()));
        };
        self.style_on_demand(node)?
            .customs
            .get(name, &self.styles.registry)?;
        let syntax = self
            .styles
            .registry
            .get(&name)
            .map(|it| it.syntax.component_for(&value));
        Some((value, syntax.unwrap_or_default()))
    }

    /// In the order of their spellings.
    pub(crate) fn custom_property_names(&mut self, node: NodeId, pseudo: Pseudo) -> Rc<[Name]> {
        self.update_layout();
        let Some((_, style)) = self.style_of_pseudo(node, pseudo) else {
            return Rc::default();
        };
        if let Some((_, names)) = self
            .listed_customs
            .as_ref()
            .filter(|it| it.0.is_same(&style.customs))
        {
            return Rc::clone(names);
        }
        let all = style
            .customs
            .names()
            .into_iter()
            .chain(self.styles.registry.keys().copied());
        let mut names: Vec<_> = all
            .filter(|it| style.customs.get(*it, &self.styles.registry).is_some())
            .collect();
        names.order_by_cached_key(|it| {
            crate::custom::spelling(*it)
                .encode_utf16()
                .collect::<Vec<_>>()
        });
        names.dedup();
        Rc::clone(
            &self
                .listed_customs
                .insert((style.customs.clone(), names.into()))
                .1,
        )
    }

    pub(crate) fn has_box(&self, node: NodeId) -> bool {
        self.style_bits(node, 0) & 1 != 0
    }

    pub(crate) fn is_displayed(&mut self, node: NodeId) -> bool {
        const HAS_BOX_OR_IS_CONTENTS: u32 = 1 | 1 << 6;
        self.update_boxes_of(node);
        self.style_bits(node, 0) & HAS_BOX_OR_IS_CONTENTS != 0
    }

    pub(crate) fn update_boxes_of(&mut self, node: NodeId) {
        self.update_layout();
        if !self.auto_visible.is_empty()
            && self.style_bits(node, 0) & Visibility::LOCKED.bits() == 0
            && self.is_in_skipped_contents(node)
        {
            self.force_leaves(node);
        }
    }

    /// <https://drafts.csswg.org/cssom-view/#dom-element-checkvisibility>
    pub(crate) fn check_visibility(&mut self, node: NodeId, hidden_by: Visibility) -> bool {
        self.update_boxes_of(node);
        let bits = self.style_bits(node, hidden_by.bits());
        bits & 1 != 0
            && !Visibility::from_bits_truncate(bits ^ Visibility::HIDDEN.bits())
                .intersects(hidden_by | Visibility::LOCKED)
    }

    pub(crate) fn scrolls_by_itself(&self, node: NodeId) -> bool {
        self.tree.style(node).is_some_and(|it| it.scrolls())
            && self.own_box(node).is_some()
            && self.overflow_source() != node
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
        ];
        bits.iter()
            .rev()
            .fold(0, |all, bit| all << 1 | u32::from(*bit))
    }
}

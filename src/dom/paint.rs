//! The display list, and what is under the pointer.

use core::fmt::Write as _;
use core::ops::Range;
use std::rc::Rc;

use crate::abi::{
    self, BlendMode, Item, LineStyle, Matrix, PathVerb, Radii, Rect, RoundedRect, Slice, Source,
    Span,
};
use crate::background::Frame;
use crate::boxes::{BoxId, Kind, VIEWPORT};
use crate::compositor::{Timeline, corners, interpolate, simplify};
use crate::contour::{Contour, Edge};
use crate::document::Document;
use crate::effects::{Areas, Effects, Subject};
use crate::geometry::translation;
use crate::inline::ItemKind;
use crate::lines::FragmentKind;
use crate::name::{Map, is_name};
use crate::path::Path;
use crate::properties::{Id, Style, WillChange};
use crate::scroll::Part;
use crate::segments::{Layers, Painted, Segments};
use crate::selector::Pseudo;
use crate::theme::Look;
use crate::tree::{Flags, NodeId, State};
use crate::types::*;
use crate::values::{Lp, mix_colors};
use crate::view_transition::is_snapshot;

/// A clip or a transform, inside of those of `parent`.
#[derive(Clone, Copy)]
pub(crate) struct Link {
    pub(crate) parent: u32,
    pub(crate) depth: u32,
    pub(crate) item: Item,
    /// The box whose contents are in it.
    pub(crate) owner: BoxId,
    /// To the viewport.
    pub(crate) matrix: Matrix,
    pub(crate) driver: Option<(Source, Span)>,
}

#[derive(Clone, Copy)]
pub(crate) struct Space {
    /// Of the border box.
    pub(crate) origin: [f32; 2],
    pub(crate) link: u32,
    /// The index of the nearest one that the renderer knows.
    pub(crate) scroller: u32,
    /// What can be seen.
    pub(crate) visible: Rect,
}

#[derive(Clone, Copy)]
enum Target {
    Node(NodeId),
    InSvg(NodeId),
    Scrollbar(BoxId, usize),
}

#[derive(Clone, Copy)]
pub(crate) struct Hit {
    target: Target,
    pub(crate) shape: RoundedRect,
    pub(crate) link: u32,
}

#[derive(Default)]
pub(crate) struct Picture {
    pub(crate) items: Vec<Item>,
    pub(crate) glyphs: Vec<abi::Glyph>,
    pub(crate) stops: Vec<abi::GradientStop>,
    pub(crate) filters: Vec<abi::Filter>,
    pub(crate) verbs: Vec<PathVerb>,
    /// Those that are in a `PushVector`.
    pub(crate) local_verbs: Vec<Span>,
    pub(crate) bytes: Vec<u8>,
    pub(crate) regions: Vec<abi::Region>,
    pub(crate) region_nodes: Vec<NodeId>,
    pub(crate) links: Vec<Link>,
    pub(crate) hits: Vec<Hit>,
    pub(crate) scrollers: Vec<abi::Scroller>,
    pub(crate) scroller_nodes: Vec<NodeId>,
    pub(crate) drivers: Vec<abi::Driver>,
    pub(crate) numbers: Vec<f32>,
    pub(crate) wheel_hits: Vec<abi::Hit>,
    /// The boxes in `Animations::watched` that can be seen.
    pub(crate) seen: Vec<BoxId>,
    /// The elements whose animations have drivers.
    pub(crate) driven: Vec<NodeId>,
    /// The `Painter::contents` that have links of their own and layers in them.
    pub(crate) clips: Vec<(BoxId, Space)>,
    /// The ones before it are under a modal dialog.
    pub(crate) first_hit: usize,
    pub(crate) canvas_source: NodeId,
    pub(crate) caret: Option<(BoxId, Rect)>,
    pub(crate) is_submitted: bool,
}

#[derive(Clone, Copy)]
enum Layer {
    StackingContext(BoxId),
    Atomic(BoxId),
    Positioned(BoxId),
    Inside(BoxId),
    /// An inline element, from the item on in the lines of the box.
    Inline(BoxId, usize),
    /// A block in inline elements that are stacking contexts.
    InInline(BoxId),
}

fn object_rect(style: &Style, image: crate::tree::Replaced, content: Rect) -> Rect {
    let (image, view) = image.viewed(style);
    let (area, natural) = (
        [content.width, content.height],
        image.size.map(|it| Some(it? * style.zoom)),
    );
    let fitted = |cover| crate::background::fitted(area, image.ratio, cover);
    let unscaled = || crate::background::concrete_size([None; 2], natural, image.ratio, area);
    let [width, height] = match style.effects.object_fit {
        ObjectFit::Fill => area,
        ObjectFit::Contain => fitted(false),
        ObjectFit::Cover => fitted(true),
        ObjectFit::None => unscaled(),
        ObjectFit::ScaleDown => {
            if unscaled()[0] < fitted(false)[0] {
                unscaled()
            } else {
                fitted(false)
            }
        }
    };
    let [x, y] = style
        .effects
        .object_position
        .resolve(area[0] - width, area[1] - height);
    let [width, height] = [width / view.width, height / view.height];
    Rect::new([
        content.x + x - view.x * width,
        content.y + y - view.y * height,
        width,
        height,
    ])
}

fn collapsed_style(style: BorderStyle) -> LineStyle {
    match style {
        BorderStyle::Inset => LineStyle::Ridge,
        BorderStyle::Outset => LineStyle::Groove,
        other => line_style(other),
    }
}

fn inline_z_index(style: &Style) -> i32 {
    style
        .paint
        .z_index
        .0
        .filter(|_| style.is_positioned())
        .unwrap_or(0)
}

type LayerList = smallvec::SmallVec<[(i32, Layer, Space); 4]>;

enum Foreground {
    Atomic,
    Lines,
    Replaced,
    Copy,
    Math,
}

#[derive(Default)]
struct Phases {
    floats: Vec<(BoxId, Space)>,
    foreground: Vec<(Foreground, BoxId, Space)>,
    outlines: Vec<(BoxId, Space)>,
}

pub(crate) struct Painter<'a> {
    pub(crate) document: &'a Document,
    pub(crate) out: Picture,
    pub(crate) old: Option<&'a Picture>,
    pub(crate) segments: Segments,
    pub(crate) outside: u32,
    current: u32,
    /// The link that the innermost group was pushed in.
    base: u32,
    /// The link of what does not scroll with the viewport.
    fixed: u32,
    /// In something that is transparent, but can be hit.
    pub(crate) is_hidden: bool,
    pub(crate) is_copy: bool,
    pub(crate) contents: Map<BoxId, Space>,
    pub(crate) svg: crate::svg_paint::Vector<'a>,
    /// It has painted something that changes by itself.
    pub(crate) is_volatile: bool,
    /// The last one whose box was begun, or 0 for the canvas.
    pub(crate) painted_node: NodeId,
    /// For a view transition.
    pub(crate) captures: NodeId,
}

pub(crate) fn alpha(color: u32) -> u32 {
    color & 0xff
}

pub(crate) fn square(rect: Rect) -> RoundedRect {
    RoundedRect {
        rect,
        radii: Radii::default(),
    }
}

pub(crate) fn fit(rect: Rect, mut radii: Radii) -> RoundedRect {
    let ratio = |side: f32, a: f32, b: f32| if a + b > side { side / (a + b) } else { 1.0 };
    let scale = (ratio(rect.width, radii[0][0], radii[1][0]).min(ratio(
        rect.width,
        radii[3][0],
        radii[2][0],
    )))
    .min(ratio(rect.height, radii[0][1], radii[3][1]).min(ratio(
        rect.height,
        radii[1][1],
        radii[2][1],
    )));
    for radius in &mut radii {
        *radius = if radius[0] > 0.0 && radius[1] > 0.0 {
            radius.map(|it| it * scale)
        } else {
            [0.0; 2]
        };
    }
    RoundedRect { rect, radii }
}

pub(crate) fn with_corners(rect: Rect, basis: [f32; 2], corners: [&Corner; 4]) -> RoundedRect {
    fit(
        rect,
        corners.map(|it| [it.0.0.resolve(basis[0]), it.1.0.resolve(basis[1])]),
    )
}

pub(crate) fn rounded(rect: Rect, style: &Style) -> RoundedRect {
    if style.is_bare() {
        return square(rect);
    }
    let p = &style.paint;
    with_corners(
        rect,
        [rect.width, rect.height],
        [&p.top_left, &p.top_right, &p.bottom_right, &p.bottom_left],
    )
}

impl RoundedRect {
    pub(crate) fn shrunk(&self, [top, right, bottom, left]: [f32; 4]) -> RoundedRect {
        let by = [[left, top], [right, top], [right, bottom], [left, bottom]];
        let radii = [0, 1, 2, 3].map(|corner| {
            [0, 1].map(|axis| (self.radii[corner][axis] - by[corner][axis]).max(0.0))
        });
        fit(self.rect.shrunk([top, right, bottom, left]), radii)
    }

    /// Sharp corners stay sharp.
    pub(crate) fn outset(&self, [top, right, bottom, left]: [f32; 4]) -> RoundedRect {
        let grow = |radius: f32, by: f32, coverage: f32| match radius / by {
            _ if by <= 0.0 => (radius + by).max(0.0),
            ratio if ratio < 1.0 && coverage < 1.0 => {
                radius + by * (1.0 - (1.0 - ratio).powi(3) * (1.0 - coverage.powi(3)))
            }
            _ => radius + by,
        };
        let coverage = self.radii.map(|[x, y]| {
            2.0 * (x / self.rect.width.max(1e-6)).min(y / self.rect.height.max(1e-6))
        });
        let by = [[left, top], [right, top], [right, bottom], [left, bottom]];
        let radii = [0, 1, 2, 3].map(|corner| {
            [0, 1].map(|axis| grow(self.radii[corner][axis], by[corner][axis], coverage[corner]))
        });
        fit(self.rect.shrunk([-top, -right, -bottom, -left]), radii)
    }

    pub(crate) fn spread(&self, by: f32) -> RoundedRect {
        self.outset([by; 4])
    }

    fn contains(&self, point: [f32; 2]) -> bool {
        let (rect, [x, y]) = (&self.rect, point);
        let inward = [
            [x - rect.x, y - rect.y],
            [rect.right() - x, y - rect.y],
            [rect.right() - x, rect.bottom() - y],
            [x - rect.x, rect.bottom() - y],
        ];
        rect.contains(point)
            && inward.iter().zip(&self.radii).all(|([x, y], [rx, ry])| {
                x >= rx || y >= ry || (1.0 - x / rx).powi(2) + (1.0 - y / ry).powi(2) <= 1.0
            })
    }
}

fn line_style(style: BorderStyle) -> LineStyle {
    match style {
        BorderStyle::None | BorderStyle::Hidden => LineStyle::None,
        BorderStyle::Solid => LineStyle::Solid,
        BorderStyle::Dotted => LineStyle::Dotted,
        BorderStyle::Dashed => LineStyle::Dashed,
        BorderStyle::Double => LineStyle::Double,
        BorderStyle::Groove => LineStyle::Groove,
        BorderStyle::Ridge => LineStyle::Ridge,
        BorderStyle::Inset => LineStyle::Inset,
        BorderStyle::Outset => LineStyle::Outset,
    }
}

pub(crate) fn blend_mode(blend: Blend) -> BlendMode {
    macro_rules! same {
        ($($name:ident)+) => { match blend { $(Blend::$name => BlendMode::$name,)+ } };
    }
    same!(Normal Multiply Screen Overlay Darken Lighten ColorDodge ColorBurn HardLight SoftLight Difference Exclusion
        Hue Saturation Color Luminosity PlusLighter)
}

pub(crate) fn shadow_extent(shadows: &Shadows) -> f32 {
    let outer = shadows.0.iter().filter(|it| !it.inset);
    outer
        .map(|it| it.offset[0].abs().max(it.offset[1].abs()) + it.blur + it.spread)
        .fold(0.0, f32::max)
}

fn filter_extent(style: &Style) -> f32 {
    let extents = style.effects.filter.0.iter().map(|filter| match filter {
        Filter::Amount(FilterName::Blur, radius) => radius * 3.0,
        Filter::DropShadow(it) => it.offset[0].abs().max(it.offset[1].abs()) + it.blur * 3.0,
        _ => 0.0,
    });
    extents.sum()
}

fn decoration_extent(style: &Style) -> f32 {
    if style.is_bare() {
        return 1.0;
    }
    let outline = (style.outline_width() + style.paint.outline_offset.0).max(0.0);
    let outsets = crate::nine_pieces::outsets(style, Id::BorderImageOutset, style.border());
    outsets.into_iter().fold(
        shadow_extent(&style.paint.box_shadow).max(outline),
        f32::max,
    ) + 1.0
}

impl Document {
    /// The style of an item may be older than the last change that only needed a repaint.
    pub(crate) fn current_style<'a>(&'a self, item: &'a crate::inline::Item) -> &'a Rc<Style> {
        if item.has_own_style {
            return &item.style;
        }
        let node = if item.kind == ItemKind::Text {
            self.tree.flat_parent(item.node)
        } else {
            item.node
        };
        self.tree.style(node).unwrap_or(&item.style)
    }

    /// Of the element that an anonymous box inherits from.
    pub(crate) fn inherited_style(&self, mut id: BoxId) -> &Rc<Style> {
        while self.boxes[id].node == 0 && id != 0 {
            id = self.boxes[id].parent;
        }
        &self.boxes[id].style
    }

    pub(crate) fn ink(&self, id: BoxId) -> Rect {
        let it = &self.boxes[id];
        if let Some(ink) = it.ink.get() {
            return ink;
        }
        let mut contents = self.extent(id);
        if !it.scrolls() {
            let own = it
                .children
                .iter()
                .filter(|child| !self.boxes[**child].style.is_out_of_flow());
            for child in own
                .chain(&it.hoisted)
                .chain((it.outside_marker != 0).then_some(&it.outside_marker))
                .filter(|it| !self.is_plane(**it))
            {
                let at = self.boxes[*child].layout.location;
                contents = contents.union(&self.outer_ink(*child).moved([at.x, at.y]));
            }
            for (inline, fragment) in it.inline.iter().flat_map(|it| {
                it.lines
                    .fragments
                    .iter()
                    .map(move |fragment| (it, fragment))
            }) {
                let style = self.current_style(&inline.items[fragment.item as usize]);
                let extent = match fragment.kind {
                    FragmentKind::Box(..) => decoration_extent(style) + filter_extent(style),
                    _ => {
                        style.font.size.0.max(self.decoration_reach)
                            + style.text_stroke_width()
                            + shadow_extent(&style.ink.text_shadow.0)
                    }
                };
                contents = contents.union(&self.from_lines(id, fragment.rect()).grown(extent));
            }
            if it.kind == Kind::Svg && it.overflow == [Overflow::Visible; 2] {
                contents = contents.union(&self.svg_ink(it.node).unwrap_or_default());
            }
            if let Some(image) = self
                .tree
                .element(it.node)
                .and_then(|it| it.replaced)
                .filter(|_| it.kind == Kind::Replaced)
            {
                let rect = object_rect(&it.style, image, Rect::new(self.content_box(id)));
                contents = contents.union(&if is_snapshot(image.image) {
                    self.snapshot_ink(image.image, rect)
                } else {
                    rect
                });
            }
            contents = self
                .overflow_clip(id)
                .map_or(contents, |clip| contents.intersection(&clip));
        }
        if it.has_legend {
            let at = self.boxes[it.children[0]].layout.location;
            contents = contents.union(&self.outer_ink(it.children[0]).moved([at.x, at.y]));
        }
        let ink = contents.union(&self.decorated(id, self.extent(id)).grown(it.border()[0]));
        it.ink.set(Some(ink));
        ink
    }

    fn rounded_overflow_clip(&self, id: BoxId, outline: RoundedRect) -> RoundedRect {
        let it = &self.boxes[id];
        let (ClipMargin(area, margin), padding, inside) = (
            it.style.effects.clip_margin,
            it.layout.padding,
            outline.shrunk(it.border()),
        );
        match area {
            _ if it.scrolls() && !it.is_replaced() => inside,
            BoxArea::BorderBox => inside.outset(it.border().map(|it| margin + it)),
            BoxArea::ContentBox => inside.outset(
                [padding.top, padding.right, padding.bottom, padding.left].map(|it| margin - it),
            ),
            _ => inside.spread(margin),
        }
    }

    pub(crate) fn outer_ink(&self, id: BoxId) -> Rect {
        if self.is_in_depth(id) {
            return crate::three_d::EVERYWHERE;
        }
        let ink = self.filtered(
            self.boxes[id].node,
            &self.boxes[id].style,
            self.ink(id),
            self.border_box(id),
        );
        let swept = self.tree[self.boxes[id].node]
            .has(Flags::ANIMATED)
            .then(|| self.swept(id, &ink))
            .flatten();
        swept.unwrap_or_else(|| {
            self.own_transform(id)
                .map_or(ink, |matrix| ink.transformed(&matrix))
        })
    }

    /// What the decorations cover. `rect` is where the border box is.
    fn decorated(&self, id: BoxId, rect: Rect) -> Rect {
        let style = &self.boxes[id].style;
        match style
            .other_if_set(Id::BorderShape)
            .map(|_| self.frame_of(id, rect))
            .and_then(|it| Some((Contour::of(style, &it)?, it)))
        {
            Some((contour, frame)) => contour
                .bounds(&frame, decoration_extent(style))
                .union(&rect),
            None => rect.grown(decoration_extent(style)),
        }
    }

    /// `rect` is where the border box is.
    pub(crate) fn frame_of(&self, id: BoxId, rect: Rect) -> Frame {
        let (it, padding) = (&self.boxes[id], self.boxes[id].layout.padding);
        Frame {
            shape: rounded(rect, &it.style),
            border: it.border(),
            padding: [padding.top, padding.right, padding.bottom, padding.left],
            scrolled: None,
            whole: None,
        }
    }

    fn z_index_applies(&self, id: BoxId) -> bool {
        let it = &self.boxes[id];
        it.style.is_positioned() || matches!(self.boxes[it.parent].kind, Kind::Flex | Kind::Grid)
    }

    pub(crate) fn layers(&self, id: BoxId) -> Layers {
        let it = &self.boxes[id];
        if it.painted.layers.get().contains(Layers::KNOWN) {
            return it.painted.layers.get();
        }
        let (mut layers, z_index_applies) = (Layers::KNOWN, self.z_index_applies(id));
        let around = self.split_stacking_contexts(id).last().map(|it| it.1);
        layers.set(
            Layers::IS_STACKING_CONTEXT,
            around.is_some()
                || self.is_captured(it.node)
                || self.is_transition_scope(it.node)
                || it.parent == VIEWPORT
                || it.style.is_stacking_context(z_index_applies)
                || self.is_plane(id)
                || it.style.effects.clip.0.is_some() && it.style.is_out_of_flow(),
        );
        let parent = &self.boxes[it.parent];
        let inline_ancestors = || {
            self.tree
                .flat_ancestors(it.node)
                .take_while(|it| self.own_box(*it).is_none())
                .filter_map(|it| self.tree.style(it))
        };
        let is_in_layer = parent.splits_layers
            && self.split_elements_around(id, it.parent).next().is_some()
            || parent.inline.as_ref().is_some_and(|it| it.has_layers)
                && it.style.is_floating()
                && inline_ancestors().any(|it| crate::inline::is_layer(it));
        layers.set(
            Layers::IS_LAYER,
            is_in_layer || it.style.is_positioned() || layers.contains(Layers::IS_STACKING_CONTEXT),
        );
        layers.set(
            Layers::IS_STICKY,
            it.style.layout.position == PositionKind::Sticky,
        );
        layers.set(
            Layers::IS_RAISED,
            around.map_or_else(
                || z_index_applies && it.style.paint.z_index.0.is_some_and(|it| it != 0),
                |it| inline_z_index(it) != 0,
            ),
        );
        layers.set(Layers::BLENDS, it.style.effects.blend != Blend::Normal);
        layers.set(Layers::SCROLLS, it.scrolls());
        let moves =
            (it.style.effects.will_change.0 | it.style.animates).contains(WillChange::TRANSFORM);
        layers.set(
            Layers::SNAPS,
            moves || it.style.contain().contains(Contain::PAINT),
        );
        for item in it
            .inline
            .iter()
            .filter(|it| it.has_layers)
            .flat_map(|it| &it.items)
        {
            if matches!(item.kind, ItemKind::Open(_)) && crate::inline::is_layer(&item.style) {
                let is_raised = item.style.is_positioned()
                    && self
                        .current_style(item)
                        .paint
                        .z_index
                        .0
                        .is_some_and(|it| it != 0);
                layers |= if is_raised {
                    Layers::HAS_RAISED
                } else {
                    Layers::HAS_LEVEL
                };
            }
        }
        let blends = |style: &Rc<Style>| style.effects.blend != Blend::Normal;
        let inline = it
            .inline
            .iter()
            .filter(|it| it.has_layers)
            .flat_map(|it| &it.items);
        let in_svg = || {
            self.tree
                .descendants(it.node)
                .filter_map(|it| self.tree.style(it))
                .any(blends)
        };
        let has_blend = inline
            .filter(|it| matches!(it.kind, ItemKind::Open(_)))
            .any(|it| blends(self.current_style(it)))
            || it.kind == Kind::Svg && self.blends_in_svg.get() && in_svg()
            || it.children.iter().any(|it| blends(&self.boxes[*it].style));
        layers.set(Layers::HAS_BLEND, has_blend);
        layers.set(
            Layers::HAS_BACKDROP,
            it.children
                .iter()
                .any(|it| !self.boxes[*it].style.effects.backdrop_filter.0.is_empty()),
        );
        for child in it
            .children
            .iter()
            .filter(|_| it.kind != Kind::Svg)
            .map(|it| self.layers(*it))
        {
            layers |= child & Layers::HAS_BACKDROP;
            if child.contains(Layers::IS_LAYER) {
                layers |= if child.contains(Layers::IS_RAISED) {
                    Layers::HAS_RAISED
                } else {
                    Layers::HAS_LEVEL
                };
            }
            if !child.contains(Layers::IS_STACKING_CONTEXT) {
                layers |= child & (Layers::HAS_LEVEL | Layers::HAS_RAISED | Layers::HAS_BLEND);
            }
        }
        it.painted.layers.set(layers);
        layers
    }

    /// If the table paints the borders, and not its cells.
    fn lattice(&self, id: BoxId) -> Option<&crate::table::Lattice> {
        let it = &self.boxes[id];
        it.collapsed.as_ref().filter(|_| {
            it.kind == Kind::Table
                && !it.mode.is_vertical()
                && !it.turned.is_vertical()
                && self.pieces(id).is_none()
        })?;
        self.boxes.lattices.get(&id)
    }

    /// Of a stacking context.
    pub(crate) fn stack_level(&self, id: BoxId) -> Option<i32> {
        let (layers, z_index) = (self.layers(id), self.boxes[id].style.paint.z_index.0);
        layers.contains(Layers::IS_STACKING_CONTEXT).then(|| {
            z_index
                .filter(|_| layers.contains(Layers::IS_RAISED))
                .unwrap_or(0)
        })
    }

    /// From the inside out.
    fn split_stacking_contexts(&self, id: BoxId) -> impl Iterator<Item = (NodeId, &Rc<Style>)> {
        let parent = self.boxes[id].parent;
        let around = self.boxes[parent]
            .splits_layers
            .then(|| self.split_elements_around(id, parent));
        around
            .into_iter()
            .flatten()
            .filter(|it| it.1.is_stacking_context(it.1.is_positioned()))
    }

    fn is_layer(&self, id: BoxId) -> bool {
        self.layers(id).contains(Layers::IS_LAYER)
    }

    pub(crate) fn update_picture(&mut self) -> &mut Picture {
        self.update_layout();
        if self.pictures.current().is_none() {
            self.update_marks();
            self.prepare_animations();
            let caret = self.caret_to_paint();
            if let Some(old) = self
                .pictures
                .outdated()
                .map(|it| it.caret)
                .filter(|it| *it != caret)
            {
                old.into_iter()
                    .chain(caret)
                    .for_each(|it| self.repaint_box(it.0));
            }
            self.paint(self.canvas_source(), caret);
            let is_behind = self.throttle_animations();
            if is_behind {
                return self.update_picture();
            }
        }
        self.pictures.current_mut().expect("is not none")
    }

    pub(crate) fn canvas_source(&self) -> NodeId {
        let root = self.tree.root_element();
        if self.tree.style(root).is_some_and(|it| it.has_background())
            || !self.propagates_from_body()
        {
            root
        } else {
            self.tree.body()
        }
    }

    pub(crate) fn submit(&mut self, surface: u32) {
        let (zoom, is_composited) = (self.environment.zoom, self.compositor.is_on);
        if self.update_picture().is_submitted {
            return;
        }
        let regions = self.regions_in_tree_order();
        let picture = self.update_picture();
        picture.is_submitted = true;
        if let Some(renderer) = crate::platform::renderer() {
            let list = abi::DisplayList {
                regions: Slice::new(&regions),
                ..picture.list(zoom)
            };
            let compositing = abi::Compositing {
                scrollers: Slice::new(&picture.scrollers),
                drivers: Slice::new(&picture.drivers),
                numbers: Slice::new(&picture.numbers),
                hits: Slice::new(&picture.wheel_hits),
            };
            // SAFETY: the picture outlives the call.
            unsafe {
                match is_composited {
                    true => (renderer.submit_composited)(
                        surface,
                        &raw const list,
                        &raw const compositing,
                    ),
                    false => (renderer.submit)(surface, &raw const list),
                }
            }
            let scrollers = picture.scrollers.clone();
            self.compositor.keep_scrollers(&scrollers);
        }
    }

    /// Only those that decide about dragging.
    fn regions_in_tree_order(&self) -> Vec<abi::Region> {
        let Some(picture) = self.pictures.current() else {
            return Vec::new();
        };
        let overlap = |a: &abi::Rect, b: &abi::Rect| {
            a.x < b.x + b.width
                && b.x < a.x + a.width
                && a.y < b.y + b.height
                && b.y < a.y + a.height
        };
        let drags: Vec<_> = picture.regions.iter().filter(|it| it.drag).collect();
        let all = picture.regions.iter().zip(&picture.region_nodes);
        let mut found: Vec<_> = all
            .filter(|(region, _)| drags.iter().any(|it| overlap(&it.rect, &region.rect)))
            .collect();
        found.sort_by_cached_key(|(_, node)| {
            let ancestors =
                core::iter::successors(Some(**node), |it| Some(self.tree.parent_or_host(*it)))
                    .take_while(|it| *it != 0 && self.tree.contains(*it));
            let mut path: Vec<_> = ancestors
                .map(|it| self.tree.previous_elements(it).count())
                .collect();
            path.reverse();
            path
        });
        found.into_iter().map(|it| *it.0).collect()
    }

    /// Moves what can be hit to where the renderer shows it.
    pub(crate) fn update_hits(&mut self) {
        self.update_picture();
        if self
            .pictures
            .current()
            .is_none_or(|it| it.drivers.is_empty() && it.scrollers.is_empty())
        {
            return;
        }
        let now = crate::platform::now();
        if self
            .pictures
            .links_are_for
            .is_some_and(|(version, time)| version == self.layout_version && now < time)
        {
            return;
        }
        let Some(mut picture) = self.pictures.lend() else {
            return;
        };
        let follows_time = picture
            .links
            .iter()
            .any(|it| matches!(it.driver, Some((Source::Time { .. }, _))));
        self.pictures.links_are_for = Some((
            self.layout_version,
            if follows_time {
                now + 4.0
            } else {
                f64::INFINITY
            },
        ));
        for index in 1..picture.links.len() {
            let link = &picture.links[index];
            let offset =
                |scroller: u32| self.scroll_offset(picture.scroller_nodes[scroller as usize]);
            let own = match (link.driver, link.item) {
                (Some((Source::Scroll { scroller }, _)), _) => {
                    let (painted, shown) = (
                        picture.scrollers[scroller as usize].offset,
                        offset(scroller),
                    );
                    translation([painted[0] - shown[0], painted[1] - shown[1]])
                }
                (Some((Source::Offset { scroller, axis }, samples)), _) => interpolate(
                    &picture.numbers[samples.range()],
                    offset(scroller)[usize::from(axis)],
                ),
                (
                    Some((
                        Source::Time {
                            start,
                            cycle,
                            cycles,
                        },
                        samples,
                    )),
                    _,
                ) => {
                    let elapsed = ((now - start) / cycle).min(cycles).max(0.0);
                    let position = if elapsed == cycles && elapsed % 1.0 == 0.0 {
                        1.0
                    } else {
                        elapsed % 1.0
                    };
                    interpolate(&picture.numbers[samples.range()], position as f32)
                }
                (None, Item::PushTransform(matrix) | Item::PushVector(matrix)) => matrix,
                (None, _) => IDENTITY,
            };
            let matrix = multiply(&picture.links[link.parent as usize].matrix, &own);
            if core::mem::replace(&mut picture.links[index].matrix, matrix) != matrix {
                self.pictures.last_hit.set(None);
            }
        }
        self.pictures.give_back(picture);
    }

    fn hits(&self, point: [f32; 2]) -> impl Iterator<Item = Target> + '_ {
        self.pictures
            .current()
            .into_iter()
            .flat_map(move |picture| {
                let local = move |link: &Link| match self.has_depth.get() {
                    true => picture.to_local(link, point),
                    false => Some(apply(&invert(&link.matrix)?, point)),
                };
                let mut last = (u32::MAX, None);
                let mut is_hit = move |hit: &Hit| {
                    let mut link = &picture.links[hit.link as usize];
                    if last.0 != hit.link {
                        last = (hit.link, local(link));
                    }
                    if !last.1.is_some_and(|it| hit.shape.contains(it)) {
                        return false;
                    }
                    while link.depth > 0 {
                        let is_inside = |point| match &link.item {
                            Item::PushClip(clip) => clip.contains(point),
                            Item::PushClipOutline(it) => {
                                Path::from(&picture.verbs[it.verbs.range()]).covers(it, point)
                            }
                            _ => true,
                        };
                        if !local(link).is_some_and(is_inside) {
                            return false;
                        }
                        link = &picture.links[link.parent as usize];
                    }
                    true
                };
                let (hits, known) = (
                    &picture.hits[picture.first_hit..],
                    self.pictures.last_hit.get().filter(|it| it.0 == point),
                );
                let end = known.map_or_else(
                    || hits.iter().rposition(&mut is_hit).map_or(0, |it| it + 1),
                    |it| it.1,
                );
                self.pictures.last_hit.set(Some((point, end)));
                hits.get(..end)
                    .unwrap_or(hits)
                    .iter()
                    .rev()
                    .filter(move |it| is_hit(it))
                    .map(|hit| hit.target)
            })
    }

    /// From the top, with the generated ones.
    pub(crate) fn nodes_at(&self, point: [f32; 2]) -> impl Iterator<Item = NodeId> + '_ {
        self.hits(point).flat_map(move |target| match target {
            Target::Node(node) => vec![node],
            Target::InSvg(node) => self.svg_elements_at(node, point),
            Target::Scrollbar(id, _) => vec![self.scrollbar_owner(id)],
        })
    }

    /// <https://w3c.github.io/IntersectionObserver/v2/#calculate-visibility-algo>
    pub(crate) fn is_unobscured(&self, node: NodeId) -> bool {
        let styles = |id: NodeId| {
            core::iter::once(id)
                .chain(self.tree.flat_ancestors(id))
                .filter_map(|it| Some((it, self.tree.style(it)?)))
        };
        let (Some(picture), Some((own, _))) = (
            self.pictures.current(),
            self.local_rects(node).first().copied(),
        ) else {
            return false;
        };
        let [a, b, c, d, ..] = self.to_viewport(own);
        if (b, c) != (0.0, 0.0)
            || a != d
            || a < 1.0
            || styles(node).any(|(_, it)| {
                it.effects.opacity.0 < 1.0
                    || !it.effects.filter.0.is_empty()
                    || it.effects.blend != Blend::Normal
            })
        {
            return false;
        }
        let shown = self
            .bounding_rect(node)
            .intersection(&self.border_box(VIEWPORT));
        let covers = |hit: &&Hit| {
            let (Target::Node(other) | Target::InSvg(other)) = hit.target else {
                return false;
            };
            let shadows = match self.tree[other].text() {
                Some(_) => self
                    .tree
                    .style(self.tree.flat_parent(other))
                    .map(|it| &*it.ink.text_shadow.0.0),
                None => self.tree.style(other).map(|it| &*it.paint.box_shadow.0),
            };
            let cast = shadows
                .unwrap_or_default()
                .iter()
                .filter(|it| !it.inset)
                .map(|it| hit.shape.rect.moved(it.offset).grown(it.spread + it.blur));
            let ink = styles(other).fold(
                cast.fold(hit.shape.rect, |a, b| a.union(&b)),
                |ink, (id, style)| self.filtered(id, style, ink, hit.shape.rect),
            );
            let mut link = &picture.links[hit.link as usize];
            let mut rect = ink.transformed(&link.matrix).intersection(&shown);
            while link.depth > 0 {
                if let Item::PushClip(clip) = &link.item {
                    rect = rect.intersection(&clip.rect.transformed(&link.matrix));
                }
                link = &picture.links[link.parent as usize];
            }
            !rect.is_empty() && styles(other).all(|it| it.1.effects.opacity.0 > 0.0)
        };
        let top = picture.hits.iter().rev().find(covers).map(|it| it.target);
        matches!(top, Some(Target::Node(it) | Target::InSvg(it)) if it == node || self.tree.flat_ancestors(it).any(|it| it == node))
    }

    pub(crate) fn scrollbar_at(&self, point: [f32; 2]) -> Option<(BoxId, usize)> {
        match self.hits(point).next()? {
            Target::Scrollbar(id, axis) => Some((id, axis)),
            _ => None,
        }
    }
}

impl Picture {
    pub(crate) fn dump(&self) -> String {
        let mut out = String::new();
        self.items.iter().for_each(|it| _ = writeln!(out, "{it:?}"));
        self.scrollers
            .iter()
            .for_each(|it| _ = writeln!(out, "{it:?}"));
        self.drivers
            .iter()
            .for_each(|it| _ = writeln!(out, "{it:?} {:?}", &self.numbers[it.samples.range()]));
        self.wheel_hits
            .iter()
            .for_each(|it| _ = writeln!(out, "{it:?}"));
        self.regions
            .iter()
            .for_each(|it| _ = writeln!(out, "{it:?}"));
        self.verbs
            .iter()
            .for_each(|it| _ = writeln!(out, "Verb {it:?}"));
        out
    }

    pub(crate) fn list(&self, zoom: f32) -> abi::DisplayList {
        abi::DisplayList {
            zoom,
            items: Slice::new(&self.items),
            glyphs: Slice::new(&self.glyphs),
            stops: Slice::new(&self.stops),
            filters: Slice::new(&self.filters),
            verbs: Slice::new(&self.verbs),
            bytes: Slice::new(&self.bytes),
            regions: Slice::new(&self.regions),
        }
    }

    fn to_local(&self, link: &Link, point: [f32; 2]) -> Option<[f32; 2]> {
        let mut chain = core::iter::successors(Some(link), |it| {
            (it.depth > 0).then(|| &self.links[it.parent as usize])
        });
        let projected = chain.find_map(|it| {
            if let Item::PushProjection(matrix) = &it.item {
                Some((it, matrix))
            } else {
                None
            }
        });
        let Some((outer, matrix)) = projected else {
            return Some(apply(&invert(&link.matrix)?, point));
        };
        let flat = crate::three_d::unproject(
            matrix,
            self.to_local(&self.links[outer.parent as usize], point)?,
        )?;
        Some(apply(&invert(&link.matrix)?, apply(&outer.matrix, flat)))
    }

    /// If the renderer scrolls it.
    pub(crate) fn painted_offset(&self, node: NodeId) -> Option<[f32; 2]> {
        let scroller = &self.scrollers[self.scroller_nodes.iter().position(|it| *it == node)?];
        (scroller.flags & abi::SCROLLED_BY_ENGINE == 0).then_some(scroller.offset)
    }
}

impl<'a> Painter<'a> {
    pub(crate) fn new(
        document: &'a Document,
        old: Option<&'a Picture>,
        mut out: Picture,
        segments: Segments,
    ) -> Self {
        out.links.push(Link {
            parent: 0,
            depth: 0,
            item: Item::Pop,
            owner: 0,
            matrix: IDENTITY,
            driver: None,
        });
        let (contents, svg) = Default::default();
        Painter {
            document,
            out,
            old,
            segments,
            outside: 0,
            current: 0,
            base: 0,
            fixed: 0,
            is_hidden: false,
            is_copy: false,
            contents,
            svg,
            is_volatile: false,
            painted_node: 0,
            captures: 0,
        }
    }

    pub(crate) fn resume(
        document: &'a Document,
        old: &'a Picture,
        out: Picture,
        segments: Segments,
        current: u32,
    ) -> Self {
        let (contents, svg, old) = (Map::default(), Default::default(), Some(old));
        Painter {
            document,
            out,
            old,
            segments,
            outside: 0,
            current,
            base: 0,
            fixed: 0,
            is_hidden: false,
            is_copy: false,
            contents,
            svg,
            is_volatile: false,
            painted_node: 0,
            captures: 0,
        }
    }

    pub(crate) fn paint(
        document: &'a Document,
        old: Option<&'a Picture>,
        out: Picture,
        segments: Segments,
    ) -> (Picture, Segments) {
        let mut painter = Painter::new(document, old, out, segments);
        painter.page();
        painter.enter(0);
        (painter.out, painter.segments)
    }

    pub(crate) fn page(&mut self) {
        let document = self.document;
        let (root, viewport) = (document.tree.root_element(), document.border_box(VIEWPORT));
        let space = Space {
            origin: [0.0; 2],
            link: 0,
            scroller: abi::NO_SCROLLER,
            visible: viewport,
        };
        let (transition, is_shown) = (
            document.transition_root(0),
            self.captures == root || !document.is_captured(root),
        );
        self.out.hits.push(Hit {
            target: Target::Node(root),
            shape: square(viewport),
            link: 0,
        });
        if let (Some(style), Some(root)) = (
            document.tree.style(self.out.canvas_source),
            document
                .own_box(root)
                .filter(|it| is_shown && !self.has_canvas(*it)),
        ) {
            let frame = document.frame_of(
                root,
                document
                    .border_box(root)
                    .moved(document.offset_in_container(root)),
            );
            self.canvas_background(style, viewport, &frame, &space);
        }
        let contents = self.content_space(VIEWPORT, &space);
        self.wheel_hit(root, viewport, contents.scroller, &space);
        let (first, top_layer) = document.boxes[VIEWPORT]
            .children
            .split_at(document.own_box(root).iter().len());
        first
            .iter()
            .for_each(|id| self.stacking_context(*id, self.place(*id, &contents)));
        if self.captures == 0 && transition.is_none() {
            self.scrollbars(VIEWPORT, &space);
        }
        for id in top_layer
            .iter()
            .filter(|it| !document.is_hidden_by_anchor(**it))
        {
            let node = document.boxes[*id].node;
            if Some(node) == transition {
                if self.captures == 0 {
                    let first = self.out.hits.len();
                    self.stacking_context(*id, space);
                    let own = self.out.hits[first..]
                        .iter_mut()
                        .filter(|it| matches!(it.target, Target::Node(it) if it == node));
                    own.for_each(|it| it.shape = RoundedRect::default());
                    self.scrollbars(VIEWPORT, &space);
                }
                continue;
            } else if !is_shown || document.is_transition_root(node) {
                continue;
            }
            if document
                .tree
                .element(node)
                .is_some_and(|it| it.state.contains(State::MODAL))
            {
                self.out.first_hit = self.out.hits.len();
                let has_backdrop = document.tree.element(node).is_some_and(|it| {
                    document.tree[it.generated[crate::tree::BACKDROP]].layout_box != 0
                });
                let around = if has_backdrop {
                    node
                } else {
                    document.tree.root_element()
                };
                self.out.hits.push(Hit {
                    target: Target::Node(around),
                    shape: square(viewport),
                    link: 0,
                });
                self.wheel_hit(node, viewport, abi::NO_SCROLLER, &space);
            }
            self.stacking_context(*id, self.place(*id, &contents));
        }
    }

    /// For what is in the box, but is placed by a box around it.
    pub(crate) fn enter_from_viewport(&mut self, id: BoxId, origin: [f32; 2]) {
        let document = self.document;
        let inverse = multiply(
            &translation(origin),
            &invert(&document.to_viewport(id)).unwrap_or(IDENTITY),
        );
        let around = core::iter::successors(Some(document.boxes[id].parent), |it| {
            Some(document.boxes[*it].parent)
        })
        .take_while(|it| *it != 0);
        for container in
            around.filter(|it| !document.boxes[*it].hoisted.is_empty() || *it == VIEWPORT)
        {
            let mut space = Space {
                origin: [0.0; 2],
                link: 0,
                scroller: abi::NO_SCROLLER,
                visible: crate::three_d::EVERYWHERE,
            };
            self.link(
                &Item::PushTransform(multiply(&inverse, &document.to_viewport(container))),
                &mut space,
            );
            self.contents.insert(container, space);
            self.fixed = space.link;
        }
    }

    /// Whether it is the root, and what happens to it happens to the background of the canvas.
    fn has_canvas(&self, id: BoxId) -> bool {
        let (document, style) = (self.document, &self.document.boxes[id].style);
        let is_opaque =
            |it: &Rc<Style>| alpha(it.paint.background_color.resolve(it.color())) == 0xff;
        document.tree.is_root(document.boxes[id].node)
            && (style.has_effects() && !style.has_transform()
                || document.layers(id).contains(Layers::HAS_BLEND)
                    && !document
                        .tree
                        .style(self.out.canvas_source)
                        .is_some_and(is_opaque))
    }

    pub(crate) fn snap(&self, value: f32) -> f32 {
        let scale = self.document.environment.scale;
        if self.svg.is_on {
            value
        } else {
            (value * scale).round() / scale
        }
    }

    pub(crate) fn snap_rect(&self, rect: Rect) -> Rect {
        Rect::from_edges(
            self.snap(rect.x),
            self.snap(rect.y),
            self.snap(rect.right()),
            self.snap(rect.bottom()),
        )
    }

    pub(crate) fn enter(&mut self, target: u32) {
        let (links, mut to, mut pushes) = (
            &self.out.links,
            target,
            smallvec::SmallVec::<[u32; 8]>::new(),
        );
        while self.current != to {
            if links[self.current as usize].depth >= links[to as usize].depth {
                let last = self.out.items.len() as u32 - 1;
                if matches!(
                    self.out.items[last as usize],
                    Item::PushClip(_)
                        | Item::PushClipOutline(_)
                        | Item::PushTransform(_)
                        | Item::PushVector(_)
                ) && self.out.wheel_hits.last().is_none_or(|it| it.item <= last)
                {
                    self.out.items.pop();
                    self.out.drivers.pop_if(|it| it.item == last);
                } else {
                    self.out.items.push(Item::Pop);
                }
                self.current = links[self.current as usize].parent;
            } else {
                pushes.push(to);
                to = links[to as usize].parent;
            }
        }
        for link in pushes.iter().rev().map(|it| &links[*it as usize]) {
            if let Some((source, samples)) = link.driver {
                self.out.drivers.push(abi::Driver {
                    item: self.out.items.len() as u32,
                    source,
                    samples,
                });
            }
            self.out.items.push(link.item);
        }
        self.current = target;
    }

    pub(crate) fn emit(&mut self, item: &Item, space: &Space) {
        if !self.is_hidden {
            self.enter(space.link);
            self.out.items.push(*item);
        }
    }

    pub(crate) fn fill(&mut self, shape: RoundedRect, color: u32, space: &Space) {
        if alpha(color) > 0 && !shape.rect.is_empty() {
            self.emit(&Item::Fill { shape, color }, space);
        }
    }

    pub(crate) fn link(&mut self, item: &Item, space: &mut Space) {
        let parent = &self.out.links[space.link as usize];
        let matrix = match item {
            Item::PushTransform(matrix)
            | Item::PushVector(matrix)
            | Item::PushPattern { matrix, .. } => multiply(&parent.matrix, matrix),
            _ => parent.matrix,
        };
        let depth = parent.depth + 1;
        self.out.links.push(Link {
            parent: space.link,
            depth,
            item: *item,
            owner: 0,
            matrix,
            driver: None,
        });
        space.link = self.out.links.len() as u32 - 1;
    }

    /// For what is in the coordinates of the fragments.
    pub(crate) fn along_lines(&mut self, id: BoxId, space: &Space) -> Space {
        self.document
            .line_matrix(id)
            .map_or(*space, |matrix| self.transformed(&matrix, space))
    }

    /// With the origin at zero.
    pub(crate) fn transformed(&mut self, matrix: &Matrix, space: &Space) -> Space {
        let (matrix, mut inside) = (multiply(&translation(space.origin), matrix), *space);
        self.link(&Item::PushTransform(matrix), &mut inside);
        Space {
            origin: [0.0; 2],
            visible: space
                .visible
                .transformed(&invert(&matrix).unwrap_or(IDENTITY)),
            ..inside
        }
    }

    fn samples<const N: usize>(
        &mut self,
        samples: impl IntoIterator<Item = (f32, [f32; N])>,
    ) -> Span {
        let start = self.out.numbers.len() as u32;
        self.out.numbers.extend(
            samples
                .into_iter()
                .flat_map(|(at, value)| core::iter::once(at).chain(value)),
        );
        let end = self.out.numbers.len() as u32;
        if start == end {
            Span::default()
        } else {
            Span { start, end }
        }
    }

    fn driven(
        &mut self,
        matrix: Matrix,
        source: Source,
        samples: impl IntoIterator<Item = (f32, Matrix)>,
        space: &mut Space,
    ) {
        let samples = self.samples(samples);
        self.link(&Item::PushTransform(matrix), space);
        self.out.links[space.link as usize].driver = Some((source, samples));
    }

    fn scroller_of(&self, node: NodeId) -> Option<u32> {
        self.out
            .scroller_nodes
            .iter()
            .position(|it| *it == node)
            .map(|it| it as u32)
    }

    pub(crate) fn leave_scrolling_to_engine(&mut self, space: &Space) {
        self.depends_on_outside();
        let mut at = space.scroller;
        while let Some(scroller) = self.out.scrollers.get_mut(at as usize) {
            scroller.flags |= abi::SCROLLED_BY_ENGINE;
            at = scroller.parent;
        }
    }

    fn wheel_hit(&mut self, node: NodeId, rect: Rect, scroller: u32, space: &Space) {
        if self.document.compositor.is_on {
            let kind = if self.document.blocks_wheel(node) {
                abi::HIT_BLOCKING
            } else {
                abi::HIT_CONTENT
            };
            self.enter(space.link);
            self.out.wheel_hits.push(abi::Hit {
                item: self.out.items.len() as u32,
                rect,
                scroller,
                kind,
                ratio: 0.0,
            });
        }
    }

    fn stick(&mut self, id: BoxId, space: &mut Space) {
        let document = self.document;
        let Some(container) = document
            .boxes
            .containers(id)
            .find(|it| document.boxes[*it].scrolls())
        else {
            return;
        };
        let Some(scroller) = self.scroller_of(document.boxes[container].node) else {
            return;
        };
        let (
            abi::Scroller {
                offset, min, max, ..
            },
            overscan,
        ) = (
            self.out.scrollers[scroller as usize],
            document.overscan(container),
        );
        let sticky = document.sticky(id, None).0;
        let mut between = document
            .boxes
            .containers(id)
            .take_while(|it| *it != container);
        let is_nested = between.any(|it| document.layers(it).contains(Layers::IS_STICKY));
        for axis in (0..2).filter(|it| max[*it] > min[*it]) {
            let value = |at| {
                let mut scroll = offset;
                scroll[axis] = at;
                let sticky_there = if is_nested {
                    document.sticky(id, Some(scroll)).0
                } else {
                    sticky
                };
                sticky_there[axis].offset(at) - sticky[axis].offset(offset[axis])
            };
            let [from, to] = [
                (offset[axis] - overscan[axis]).max(min[axis]),
                (offset[axis] + overscan[axis]).min(max[axis]),
            ];
            let mut points = vec![(from, [value(from)])];
            corners((from, points[0].1[0]), (to, value(to)), &value, &mut points);
            if points.iter().any(|it| it.1 != [0.0]) {
                let along = |by: f32| translation(if axis == 0 { [by, 0.0] } else { [0.0, by] });
                let points = simplify(&points, [0.01])
                    .into_iter()
                    .map(|(at, [by])| (at, along(by)));
                self.driven(
                    IDENTITY,
                    Source::Offset {
                        scroller,
                        axis: axis as u8,
                    },
                    points,
                    space,
                );
                space.visible = space.visible.grown(overscan[axis]);
            }
        }
    }

    fn source(&self, timeline: Timeline) -> Option<Source> {
        Some(match timeline {
            Timeline::Time {
                start,
                cycle,
                cycles,
            } => Source::Time {
                start: start + self.document.compositor.clock_offset,
                cycle,
                cycles,
            },
            Timeline::Offset(node, axis) => Source::Offset {
                scroller: self.scroller_of(node)?,
                axis: axis as u8,
            },
        })
    }

    pub(crate) fn clip(&mut self, shape: RoundedRect, space: &mut Space) {
        space.visible = space.visible.intersection(&shape.rect);
        self.link(&Item::PushClip(shape), space);
    }

    pub(crate) fn polygon(&mut self, points: &[[f32; 2]], color: u32, space: &Space) {
        let outline = self.outline_of(
            &Path::polygon(points.iter().copied(), true),
            FillRule::Nonzero,
        );
        self.emit(&Item::Path { outline, color }, space);
    }

    pub(crate) fn hit(&mut self, node: NodeId, style: &Style, shape: RoundedRect, space: &Space) {
        if style.ink.pointer_events != PointerEvents::None
            && style.ink.interactivity == Interactivity::Auto
        {
            self.out.hits.push(Hit {
                target: Target::Node(node),
                shape,
                link: space.link,
            });
        }
    }

    pub(crate) fn begin_group(
        &mut self,
        bounds: Rect,
        opacity: f32,
        blend: BlendMode,
        filters: Span,
        space: &Space,
    ) -> u32 {
        self.emit(
            &Item::PushLayer {
                bounds,
                opacity,
                blend,
                filters,
            },
            space,
        );
        core::mem::replace(&mut self.base, space.link)
    }

    /// Ends a part of the group.
    pub(crate) fn marker(&mut self, item: &Item) {
        if !self.is_hidden {
            self.enter(self.base);
            self.out.items.push(*item);
        }
    }

    pub(crate) fn end_group(&mut self, outer_base: u32) {
        if !self.is_hidden {
            self.enter(self.base);
            let last = self.out.items.len() as u32 - 1;
            if matches!(self.out.items[last as usize], Item::PushLayer { filters, blend, .. }
                if filters.start == filters.end && !matches!(blend, BlendMode::SourceIn | BlendMode::SourceOut | BlendMode::DestinationIn))
                && self.out.wheel_hits.last().is_none_or(|it| it.item <= last)
            {
                self.out.items.pop();
                self.out.drivers.pop_if(|it| it.item == last);
            } else {
                self.out.items.push(Item::Pop);
            }
        }
        self.base = outer_base;
    }

    /// `contents` is the space of the contents of its parent.
    pub(crate) fn place(&self, id: BoxId, contents: &Space) -> Space {
        let it = &self.document.boxes[id];
        let container = self
            .contents
            .get(&it.container)
            .filter(|_| it.container != it.parent)
            .unwrap_or(contents);
        let offset = self.document.offset_in_container(id);
        if self.document.is_fixed_to_viewport(id) {
            let visible = self.document.client_box(VIEWPORT);
            return Space {
                origin: offset,
                link: self.fixed,
                scroller: container.scroller,
                visible,
            };
        }
        Space {
            origin: [
                container.origin[0] + offset[0],
                container.origin[1] + offset[1],
            ],
            ..*container
        }
    }

    fn is_out_of_sight(&self, id: BoxId, space: &Space) -> bool {
        !self
            .document
            .outer_ink(id)
            .moved(space.origin)
            .touches(&space.visible)
            && !self.document.boxes[id].cache.has_escapees()
    }

    fn content_space(&mut self, id: BoxId, space: &Space) -> Space {
        let (document, mut contents) = (self.document, *space);
        let it = &document.boxes[id];
        let clip = document.overflow_clip(id);
        if clip.is_none() && it.hoisted.is_empty() {
            return contents;
        }
        if let Some(known) = self.contents.get(&id) {
            return *known;
        }
        if let Some((clip, pieces)) = clip
            .and_then(|_| document.pieces(id))
            .and_then(|it| document.whole_overflow_clip(id).zip(Some(it)))
        {
            let rects = pieces.iter().map(|it| {
                self.snap_rect(
                    clip.moved(it.shift)
                        .intersection(&it.clip)
                        .moved(space.origin),
                )
            });
            let verbs: Vec<_> = rects.flat_map(|it| Path::rect(it).verbs).collect();
            self.clip_to(
                crate::shapes::Resolved::Path(Path::from(&verbs[..]), FillRule::Nonzero),
                &mut contents,
            );
        } else if let Some(clip) = clip {
            let clip = if id == VIEWPORT && self.captures != 0 {
                document.border_box(id)
            } else {
                clip
            };
            let is_image = document.is_embedded && (id == VIEWPORT || it.parent == VIEWPORT);
            let rect = if is_image {
                clip.moved(space.origin)
            } else {
                self.snap_rect(clip.moved(space.origin))
            };
            let outline = rounded(
                self.snap_rect(document.border_box(id).moved(space.origin)),
                &it.style,
            );
            let frame = document.frame_of(id, outline.rect);
            let follows_corners = !it.overflow.contains(&Overflow::Visible)
                || it.style.contain().contains(Contain::PAINT);
            if let Some(contour) = Contour::of(&it.style, &frame).filter(|_| follows_corners) {
                let edge = match it.style.effects.clip_margin {
                    _ if document.covers_contents(id, &contour) => Edge::Within(0.5),
                    _ if it.scrolls() && !it.is_replaced() => Edge::Inner(0.0),
                    ClipMargin(BoxArea::ContentBox, _) => Edge::Content,
                    ClipMargin(BoxArea::BorderBox, margin) => Edge::Outer(margin),
                    ClipMargin(_, margin) => Edge::Inner(-margin),
                };
                self.clip_inside(&contour, &frame, edge, &mut contents);
            } else if outline.radii != Radii::default() && follows_corners {
                self.clip(document.rounded_overflow_clip(id, outline), &mut contents);
            }
            let scroller = document.composited_scroller(id, space.scroller);
            if scroller.is_some() || contents.visible.intersection(&rect) != contents.visible {
                self.clip(square(rect), &mut contents);
            }
            if id == VIEWPORT {
                self.fixed = contents.link;
            }
            if let Some(
                scroller @ abi::Scroller {
                    offset, min, max, ..
                },
            ) = scroller
            {
                contents.scroller = self.out.scrollers.len() as u32;
                self.out.scrollers.push(scroller);
                self.out.scroller_nodes.push(it.node);
                if min != max {
                    self.driven(
                        IDENTITY,
                        Source::Scroll {
                            scroller: contents.scroller,
                        },
                        [],
                        &mut contents,
                    );
                }
                let overscan = document.overscan(id);
                let before = [0, 1].map(|it| {
                    offset[it]
                        - (((offset[it] - overscan[it]) / 256.0).floor() * 256.0).max(min[it])
                });
                let after = [0, 1].map(|it| {
                    (((offset[it] + overscan[it]) / 256.0).ceil() * 256.0).min(max[it]) - offset[it]
                });
                if !contents.visible.is_empty() {
                    contents.visible = contents
                        .visible
                        .shrunk([-before[1], -after[0], -after[1], -before[0]]);
                }
            }
        }
        if contents.link != space.link {
            self.out.links[contents.link as usize].owner = id;
            if document
                .layers(id)
                .intersects(Layers::HAS_LEVEL | Layers::HAS_RAISED)
            {
                self.out.clips.push((id, contents));
            }
        }
        self.contents.insert(id, contents);
        contents
    }

    /// `wanted` is `HAS_LEVEL`, `HAS_RAISED` or both.
    fn collect_layers(&mut self, id: BoxId, space: &Space, wanted: Layers, out: &mut LayerList) {
        let document = self.document;
        let it = &document.boxes[id];
        if !document.layers(id).intersects(wanted) {
            return;
        }
        let contents = self.content_space(id, space);
        match &it.inline {
            Some(inline) => {
                self.collect_inline_layers(id, 0..inline.items.len(), &contents, wanted, out)
            }
            None => it
                .children
                .iter()
                .for_each(|child| self.collect_layer(id, *child, [space, &contents], wanted, out)),
        }
    }

    fn collect_layer(
        &mut self,
        id: BoxId,
        child: BoxId,
        [space, contents]: [&Space; 2],
        wanted: Layers,
        out: &mut LayerList,
    ) {
        let document = self.document;
        let it = &document.boxes[id];
        let layers = document.layers(child);
        let is_wanted = layers.contains(Layers::IS_LAYER)
            && wanted.contains(if layers.contains(Layers::IS_RAISED) {
                Layers::HAS_RAISED
            } else {
                Layers::HAS_LEVEL
            });
        let mut inside = if layers.contains(Layers::IS_STACKING_CONTEXT) {
            Layers::empty()
        } else {
            layers & wanted
        };
        if !is_wanted && inside.is_empty() || document.is_hidden_by_anchor(child) {
            return;
        }
        if layers.contains(Layers::IS_STICKY) {
            self.layers_depend_on_scroller(id);
        }
        let space = self.place(
            child,
            if document.is_legend(child) {
                space
            } else {
                contents
            },
        );
        if self.is_out_of_sight(child, &space) {
            return;
        }
        let own = &document.boxes[child];
        let defers = inside.contains(Layers::HAS_LEVEL)
            && (is_wanted || it.children.len() > 1)
            && !own.cache.has_escapees();
        if defers {
            inside.remove(Layers::HAS_LEVEL);
        }
        match (is_wanted, defers) {
            (true, _) if let Some(around) = document.split_stacking_contexts(child).last() => {
                out.push((inline_z_index(around.1), Layer::InInline(child), space))
            }
            (true, _) if layers.contains(Layers::IS_STACKING_CONTEXT) => {
                let z_index = own
                    .style
                    .paint
                    .z_index
                    .0
                    .filter(|_| layers.contains(Layers::IS_RAISED));
                out.push((z_index.unwrap_or(0), Layer::StackingContext(child), space));
            }
            (true, true) => out.push((0, Layer::Positioned(child), space)),
            (true, false) => out.push((0, Layer::Atomic(child), space)),
            (false, true) => out.push((0, Layer::Inside(child), space)),
            (false, false) => {}
        }
        self.collect_layers(child, &space, inside, out);
    }

    fn collect_inline_layers(
        &mut self,
        id: BoxId,
        mut range: Range<usize>,
        contents: &Space,
        wanted: Layers,
        out: &mut LayerList,
    ) {
        let document = self.document;
        let Some(inline) = &document.boxes[id].inline else {
            return;
        };
        while let Some(index) = range.next() {
            let item = &inline.items[index];
            if let Some(child) = item.kind.embedded() {
                self.collect_layer(id, child, [contents; 2], wanted, out);
            } else if matches!(item.kind, ItemKind::Open(_)) && crate::inline::is_layer(&item.style)
            {
                let style = document.current_style(item);
                let z_index = inline_z_index(style);
                if wanted.contains(if z_index == 0 {
                    Layers::HAS_LEVEL
                } else {
                    Layers::HAS_RAISED
                }) {
                    out.push((z_index, Layer::Inline(id, index), *contents));
                }
                if style.is_stacking_context(style.is_positioned()) {
                    range.start = inline.inside(index).end;
                }
            }
        }
    }

    pub(crate) fn stacking_context(&mut self, id: BoxId, mut space: Space) {
        let document = self.document;
        let node = document.boxes[id].node;
        if document.is_captured(node)
            && node != self.captures
            && !document.is_transition_scope(node)
        {
            return;
        }
        let layers = document.layers(id);
        if layers.contains(Layers::SNAPS) {
            space.origin = space.origin.map(|it| self.snap(it));
        }
        if layers.contains(Layers::IS_STICKY) {
            self.stick(id, &mut space);
        }
        self.paint_segment(id, Painted::StackingContext, space);
    }

    pub(crate) fn paint_segment(&mut self, id: BoxId, kind: Painted, space: Space) {
        self.segment(id, kind, &space, |painter| match kind {
            Painted::StackingContext => painter.placed_stacking_context(id, space, false),
            Painted::Lines => painter.lines(id, 0, &space),
            Painted::Inside => painter.level_layers(id, &space),
            Painted::Atomic | Painted::Positioned => {
                painter.decorations(id, &space);
                painter.flow(id, &space);
                if kind == Painted::Positioned {
                    painter.level_layers(id, &space);
                }
            }
        });
    }

    pub(crate) fn placed_stacking_context(
        &mut self,
        id: BoxId,
        mut space: Space,
        is_transformed: bool,
    ) {
        let document = self.document;
        if !is_transformed && document.is_in_depth(id) {
            return self.in_depth(id, &space);
        }
        let it = &document.boxes[id];
        let (style, was_hidden) = (&it.style, self.is_hidden);
        let sampled = document.tree[it.node]
            .has(Flags::ANIMATED)
            .then(|| document.compositor.sampled.get(&it.node))
            .flatten();
        if sampled.is_some_and(|it| matches!(it.timeline, Timeline::Offset(..))) {
            self.depends_on_outside();
        }
        let sampled = sampled.and_then(|it| Some((it, self.source(it.timeline)?)));
        let items_before = self.out.items.len();
        self.see(id, was_hidden);
        if let Some((sampled, source)) = sampled.filter(|it| !it.0.transforms.is_empty()) {
            space.origin = space.origin.map(|it| self.snap(it));
            let (there, back) = (
                translation(space.origin),
                translation(space.origin.map(|it| -it)),
            );
            let placed = |own: &Matrix| multiply(&multiply(&there, own), &back);
            let seen = sampled
                .transforms
                .iter()
                .map(|it| Some(space.visible.transformed(&invert(&placed(&it.1))?)));
            let seen = seen.reduce(|a, b| Some(a?.union(&b?))).flatten();
            space.visible = seen.unwrap_or_else(|| document.ink(id).moved(space.origin));
            let now = placed(&document.own_transform(id).unwrap_or(IDENTITY));
            self.driven(
                now,
                source,
                sampled.transforms.iter().map(|it| (it.0, placed(&it.1))),
                &mut space,
            );
        } else if let Some(own) = document.own_transform(id).filter(|_| !is_transformed) {
            if own[..4] == IDENTITY[..4] && !document.tree[it.node].has(Flags::ANIMATED) {
                space.origin = [
                    space.origin[0] + self.snap(own[4] + 0.001),
                    space.origin[1] + self.snap(own[5] + 0.001),
                ];
            } else {
                space.origin = space.origin.map(|it| self.snap(it));
                let matrix = multiply(
                    &multiply(&translation(space.origin), &own),
                    &translation(space.origin.map(|it| -it)),
                );
                let Some(inverse) = invert(&matrix) else {
                    return;
                };
                space.visible = space.visible.transformed(&inverse);
                self.link(&Item::PushTransform(matrix), &mut space);
            }
        }
        let is_scope = document.is_transition_scope(it.node);
        if is_scope && it.node != self.captures {
            if document.is_captured(it.node) {
                return self.scoped_transition(id, &space);
            } else if self.frozen_scope(id, &space) {
                return;
            }
        }
        let (e, has_escapees) = (&style.effects, it.cache.has_escapees());
        let subject = self.subject(id, &space);
        let clips_with_mask = self.clip_subject(&subject, has_escapees, &mut space);
        if sampled.is_some() {
            self.out.driven.push(it.node);
        }
        if space.visible.is_empty() && !has_escapees {
            return;
        }
        let fades = sampled.filter(|it| !it.0.opacities.is_empty());
        self.is_hidden |= document
            .opacity_in_cross_fade(it.node)
            .unwrap_or(e.opacity.0)
            == 0.0
            && fades.is_none();
        if !e.backdrop_filter.0.is_empty()
            && style.is_visible()
            && it.node != self.captures
            && !document.tree.is_root(it.node)
        {
            let mut filters = self.filters(&e.backdrop_filter, &subject).0;
            if e.filter
                .0
                .iter()
                .all(|it| matches!(it, Filter::Amount(name, _) if *name != FilterName::Blur))
            {
                filters.end = self.filters(&e.filter, &subject).0.end;
            }
            let (frame, mut inside) = (
                document.frame_of(id, subject.area(BoxArea::BorderBox).rect),
                space,
            );
            let masked = (style.has_mask() || clips_with_mask).then(|| {
                self.begin_group(
                    frame.shape.rect,
                    1.0,
                    BlendMode::FromBackdrop,
                    Span::default(),
                    &space,
                )
            });
            let contour = Contour::of(style, &frame)
                .inspect(|it| self.clip_inside(it, &frame, Edge::Outer(0.0), &mut inside));
            self.emit(
                &Item::Backdrop {
                    shape: if contour.is_some() {
                        square(frame.shape.rect)
                    } else {
                        frame.shape
                    },
                    filters,
                    opacity: e.opacity.0,
                },
                &inside,
            );
            if let Some((sampled, source)) = fades.filter(|_| !self.is_hidden) {
                let samples = self.samples(sampled.opacities.iter().copied());
                self.out.drivers.push(abi::Driver {
                    item: self.out.items.len() as u32 - 1,
                    source,
                    samples,
                });
            }
            if let Some(base) = masked {
                if style.has_mask() || clips_with_mask {
                    self.marker(&Item::Mask { luminance: false });
                }
                let both = (style.has_mask() && clips_with_mask).then(|| {
                    self.begin_group(
                        frame.shape.rect,
                        1.0,
                        BlendMode::Normal,
                        Span::default(),
                        &space,
                    )
                });
                if style.has_mask() {
                    self.mask_layers(&subject, &space, &space);
                }
                if both.is_some() {
                    self.marker(&Item::Mask { luminance: false });
                }
                if clips_with_mask {
                    self.clip_mask(&subject, &space);
                }
                both.into_iter()
                    .chain([base])
                    .for_each(|it| self.end_group(it));
            }
        }
        let (clipped, mut outer, mut layers) = (space, space, LayerList::new());
        space.visible = match e.filter.0.iter().any(|it| matches!(it, Filter::Url(_))) {
            true => document.ink(id).moved(space.origin).union(&space.visible),
            false => space.visible.grown(filter_extent(style)),
        };
        let has_canvas = self.has_canvas(id);
        let is_backdrop_root = document.layers(id).contains(Layers::HAS_BACKDROP)
            && style.is_backdrop_root()
            && !document.tree.is_root(it.node);
        let isolates = fades.is_some()
            || is_backdrop_root
            || (has_canvas || !document.tree.is_root(it.node))
                && document.layers(id).contains(Layers::HAS_BLEND);
        let effects = (isolates
            || clips_with_mask
            || e.opacity.0 < 1.0
            || e.blend != Blend::Normal
            || !e.filter.0.is_empty()
            || style.has_mask())
        .then(|| {
            let mut bounds = if has_canvas {
                space.visible
            } else {
                document
                    .ink(id)
                    .moved(space.origin)
                    .intersection(&space.visible)
            };
            if has_escapees && !self.is_hidden {
                self.depends_on_outside();
                let inverse =
                    invert(&self.out.links[self.base as usize].matrix).unwrap_or(IDENTITY);
                (outer.link, bounds) = (
                    self.base,
                    document.border_box(VIEWPORT).transformed(&inverse),
                );
            }
            let effects = self.begin_effects(
                &subject,
                clips_with_mask,
                e.opacity.0,
                isolates,
                bounds,
                &outer,
            );
            if let Some((sampled, source)) = fades.filter(|_| !self.is_hidden) {
                let (samples, is_nested) = (
                    self.samples(sampled.opacities.iter().copied()),
                    effects.is_nested(),
                );
                self.out.drivers.push(abi::Driver {
                    item: self.out.items.len() as u32 - 1 - u32::from(is_nested),
                    source,
                    samples,
                });
            }
            effects
        });
        if let Some(style) = document
            .tree
            .style(self.out.canvas_source)
            .filter(|_| has_canvas)
        {
            self.depends_on_outside();
            self.canvas_background(
                style,
                space.visible,
                &document.frame_of(id, document.border_box(id).moved(space.origin)),
                &space,
            );
        }
        self.collect_layers(
            id,
            &space,
            Layers::HAS_LEVEL | Layers::HAS_RAISED,
            &mut layers,
        );
        layers.sort_by_key(|it| it.0);
        let (below, above) = layers.split_at(layers.partition_point(|it| it.0 < 0));
        self.decorations(id, &space);
        below.iter().for_each(|it| self.layer(it.1, it.2));
        self.flow(id, &space);
        above.iter().for_each(|it| self.layer(it.1, it.2));
        if is_scope {
            self.scoped_transition(id, &space);
        }
        effects
            .into_iter()
            .for_each(|it| self.end_effects(&subject, &it, &[], &clipped));
        self.is_hidden = was_hidden;
        let paints = |it: &Item| {
            !matches!(
                it,
                Item::Pop
                    | Item::PushClip(_)
                    | Item::PushClipOutline(_)
                    | Item::PushTransform(_)
                    | Item::PushVector(_)
            )
        };
        if !style.is_visible() && document.animations.watched.contains(&id) {
            self.depends_on_contents();
        }
        if !style.is_visible()
            && self.out.seen.contains(&id)
            && !self.out.items[items_before..].iter().any(paints)
        {
            self.out
                .seen
                .iter_mut()
                .filter(|it| **it == id)
                .for_each(|it| *it = 0);
        }
    }

    fn see(&mut self, id: BoxId, was_hidden: bool) {
        if !was_hidden && self.document.animations.watched.contains(&id) {
            self.out.seen.push(id);
        }
    }

    fn layer(&mut self, layer: Layer, space: Space) {
        match layer {
            Layer::StackingContext(id) => self.stacking_context(id, space),
            Layer::Atomic(id) => self.atomic(id, &space),
            Layer::Positioned(id) => self.paint_segment(id, Painted::Positioned, space),
            Layer::Inside(id) => self.paint_segment(id, Painted::Inside, space),
            Layer::Inline(id, item) => self.inline_layer(id, item, &space),
            Layer::InInline(id) => self.block_in_inline(
                id,
                self.document.split_stacking_contexts(id).collect(),
                space,
            ),
        }
    }

    fn level_layers(&mut self, id: BoxId, space: &Space) {
        let mut layers = LayerList::new();
        self.collect_layers(id, space, Layers::HAS_LEVEL, &mut layers);
        layers.iter().for_each(|it| self.layer(it.1, it.2));
    }

    fn block_in_inline(
        &mut self,
        id: BoxId,
        mut around: Vec<(NodeId, &'a Rc<Style>)>,
        space: Space,
    ) {
        let Some((node, style)) = around.pop() else {
            return self.stacking_context(id, space);
        };
        let subject = Subject {
            node,
            style,
            ..self.subject(id, &space)
        };
        let bounds = self
            .document
            .outer_ink(id)
            .moved(space.origin)
            .grown(filter_extent(style));
        let (was_hidden, has_escapees) =
            (self.is_hidden, self.document.boxes[id].cache.has_escapees());
        let effects = self.begin_inline_effects(&subject, false, bounds, has_escapees, space);
        self.block_in_inline(id, around, space);
        self.end_effects(&subject, &effects, &[], &space);
        self.is_hidden = was_hidden;
    }

    fn begin_inline_effects(
        &mut self,
        subject: &Subject<'a, '_>,
        clips_with_mask: bool,
        mut bounds: Rect,
        has_escapees: bool,
        mut space: Space,
    ) -> Effects<'a> {
        let (document, node, e) = (self.document, subject.node, &subject.style.effects);
        let is_root = subject.style.is_backdrop_root()
            && document
                .layers(document.nearest_box(node))
                .contains(Layers::HAS_BACKDROP);
        let fades = document.tree[node]
            .has(Flags::ANIMATED)
            .then(|| document.compositor.sampled.get(&node))
            .flatten();
        let fades = fades.and_then(|it| Some((it, self.source(it.timeline)?)));
        self.is_hidden |= e.opacity.0 == 0.0 && fades.is_none();
        let groups = fades.is_some()
            || is_root
            || clips_with_mask
            || e.opacity.0 < 1.0
            || e.blend != Blend::Normal
            || !e.filter.0.is_empty()
            || subject.style.has_mask();
        if has_escapees && groups && !self.is_hidden {
            self.depends_on_outside();
            let inverse = invert(&self.out.links[self.base as usize].matrix).unwrap_or(IDENTITY);
            (space.link, bounds) = (
                self.base,
                document.border_box(VIEWPORT).transformed(&inverse),
            );
        }
        let effects = self.begin_effects(
            subject,
            clips_with_mask,
            e.opacity.0,
            fades.is_some() || is_root,
            bounds,
            &space,
        );
        if let Some((sampled, source)) = fades {
            self.out.driven.push(node);
            if !self.is_hidden {
                let samples = self.samples(sampled.opacities.iter().copied());
                let item = self.out.items.len() as u32 - 1 - u32::from(effects.is_nested());
                self.out.drivers.push(abi::Driver {
                    item,
                    source,
                    samples,
                });
            }
        }
        effects
    }

    pub(crate) fn inline_layer(&mut self, id: BoxId, index: usize, space: &Space) {
        let document = self.document;
        let Some(inline) = &document.boxes[id].inline else {
            return;
        };
        let (node, inside) = (inline.items[index].node, inline.inside(index));
        let Some(style) = document
            .tree
            .style(node)
            .filter(|_| node == self.captures || !document.is_captured(node))
        else {
            return;
        };
        let is_stacking_context = style.is_stacking_context(style.is_positioned());
        let own = inline.lines.fragments.iter().filter(|it| {
            it.layer == node || is_stacking_context && inside.contains(&(it.item as usize))
        });
        let own = own
            .map(|it| document.from_lines(id, it.rect()))
            .reduce(|a, b| a.union(&b));
        let mut bounds = own.map(|it| {
            it.moved(space.origin)
                .grown(style.font.size.0 + decoration_extent(style))
        });
        let mut has_escapees = false;
        for child in inline.items[inside.clone()]
            .iter()
            .filter_map(|it| it.kind.embedded())
        {
            let (it, ink) = (
                &document.boxes[child],
                document
                    .outer_ink(child)
                    .moved(self.place(child, space).origin),
            );
            bounds = Some(bounds.map_or(ink, |it| it.union(&ink)));
            has_escapees |= is_stacking_context
                && (!(it.out_of_flow() - it.claimed_by_inline).is_empty()
                    || it.cache.has_escapees());
        }
        let Some(bounds) = bounds
            .map(|it| it.grown(filter_extent(style)))
            .filter(|it| has_escapees || it.touches(&space.visible))
        else {
            return;
        };
        let (was_hidden, mut space, mut layers) = (self.is_hidden, *space, LayerList::new());
        let is_own = |it: &&crate::lines::Fragment| {
            matches!(it.kind, FragmentKind::Box(..)) && inline.items[it.item as usize].node == node
        };
        let basis = document.content_box(id)[2];
        let subject = |rect| {
            let frame = Frame {
                shape: rounded(rect, style),
                border: style.border(),
                padding: resolve_padding(style, basis),
                scrolled: None,
                whole: None,
            };
            let l = &style.layout;
            let margin = [
                &l.margin_top,
                &l.margin_right,
                &l.margin_bottom,
                &l.margin_left,
            ]
            .map(|it| it.0.as_ref().map_or(0.0, |it| it.resolve(basis)));
            Subject {
                document,
                node,
                style,
                areas: Areas::Css(frame, margin),
            }
        };
        let rects = || {
            inline
                .lines
                .fragments
                .iter()
                .filter(is_own)
                .map(|it| document.from_lines(id, it.rect()).moved(space.origin))
        };
        let (first, mut pieces): (_, Vec<_>) = (
            subject(rects().next().unwrap_or_default()),
            rects().map(subject).collect(),
        );
        if style.rare.decoration_break == DecorationBreak::Slice
            && !document.boxes[id].mode.is_vertical()
        {
            let (total, mut before) = (rects().map(|it| it.width).sum::<f32>(), 0.0);
            for piece in &mut pieces {
                let Areas::Css(frame, _) = &mut piece.areas else {
                    continue;
                };
                let rect = frame.shape.rect;
                let x = if style.is_rtl() {
                    rect.right() + before - total
                } else {
                    rect.x - before
                };
                (frame.whole, before) = (
                    Some((
                        Rect {
                            x,
                            width: total,
                            ..rect
                        },
                        frame.border,
                        frame.padding,
                    )),
                    before + rect.width,
                );
            }
        }
        let whole = subject(rects().reduce(|a, b| a.union(&b)).unwrap_or_default());
        for rect in
            rects().filter(|_| !style.effects.backdrop_filter.0.is_empty() && style.is_visible())
        {
            let filters = self.filters(&style.effects.backdrop_filter, &first).0;
            self.emit(
                &Item::Backdrop {
                    shape: rounded(self.snap_rect(rect), style),
                    filters,
                    opacity: style.effects.opacity.0,
                },
                &space,
            );
        }
        let clips_with_mask = self.clip_subject(&first, false, &mut space);
        let effects =
            self.begin_inline_effects(&whole, clips_with_mask, bounds, has_escapees, space);
        if is_stacking_context {
            self.collect_inline_layers(
                id,
                inside,
                &space,
                Layers::HAS_LEVEL | Layers::HAS_RAISED,
                &mut layers,
            );
            layers.sort_by_key(|it| it.0);
        }
        let (below, above) = layers.split_at(layers.partition_point(|it| it.0 < 0));
        below.iter().for_each(|it| self.layer(it.1, it.2));
        self.lines(id, node, &space);
        above.iter().for_each(|it| self.layer(it.1, it.2));
        self.end_effects(&first, &effects, &pieces, &space);
        self.is_hidden = was_hidden;
    }

    fn subject(&self, id: BoxId, space: &Space) -> Subject<'a, 'a> {
        let (it, margin) = (
            &self.document.boxes[id],
            self.document.boxes[id].layout.margin,
        );
        let frame = self.document.frame_of(
            id,
            self.snap_rect(self.document.border_box(id).moved(space.origin)),
        );
        Subject {
            document: self.document,
            node: it.node,
            style: &it.style,
            areas: Areas::Css(
                frame,
                [margin.top, margin.right, margin.bottom, margin.left],
            ),
        }
    }

    /// As if it were a stacking context, without the layers in it.
    pub(crate) fn atomic(&mut self, id: BoxId, space: &Space) {
        self.paint_segment(id, Painted::Atomic, *space);
    }

    pub(crate) fn embedded(&mut self, id: BoxId, contents: &Space) {
        let space = self.place(id, contents);
        if !self.document.is_layer(id) && !self.is_out_of_sight(id, &space) {
            self.atomic(id, &space);
        }
    }

    fn flow(&mut self, id: BoxId, space: &Space) {
        let mut phases = Phases::default();
        match self.document.boxes[id].is_replaced() {
            true => self.replaced(id, space),
            false => self.backgrounds(id, space, &mut phases),
        }
        phases
            .floats
            .iter()
            .for_each(|(id, space)| self.atomic(*id, space));
        for (kind, id, space) in &phases.foreground {
            match kind {
                Foreground::Atomic => self.atomic(*id, space),
                Foreground::Lines => self.paint_segment(*id, Painted::Lines, *space),
                Foreground::Replaced => self.replaced(*id, space),
                Foreground::Copy => {
                    let (contents, was_copy) = (
                        core::mem::take(&mut self.contents),
                        core::mem::replace(&mut self.is_copy, true),
                    );
                    self.placed_stacking_context(*id, *space, false);
                    (self.contents, self.is_copy) = (contents, was_copy);
                }
                Foreground::Math => self.math(*id, space),
            }
        }
        self.scrollbars(id, space);
        self.resizer(id, space);
        for (id, space) in phases.outlines.iter().chain([&(id, *space)]) {
            let style = &self.document.boxes[*id].style;
            if style.other_if_set(Id::BorderShape).is_some() {
                self.border_over_contents(*id, *space);
            }
            match self.document.pieces(*id) {
                Some(pieces) => pieces
                    .iter()
                    .for_each(|it| self.outline(style, it.rect.moved(space.origin), space)),
                None => self.outline(
                    style,
                    self.document.border_box(*id).moved(space.origin),
                    space,
                ),
            }
        }
    }

    fn border_over_contents(&mut self, id: BoxId, mut space: Space) {
        let (document, style) = (self.document, &self.document.boxes[id].style);
        let frame = document.frame_of(
            id,
            self.snap_rect(document.border_box(id).moved(space.origin)),
        );
        if let Some(contour) =
            Contour::of(style, &frame).filter(|it| document.covers_contents(id, it))
        {
            self.clip_inside(&contour, &frame, Edge::Within(0.5), &mut space);
            self.border(style, &frame, &space);
        }
    }

    fn backgrounds(&mut self, id: BoxId, space: &Space, phases: &mut Phases) {
        let document = self.document;
        let it = &document.boxes[id];
        let contents = self.content_space(id, space);
        if it.outside_marker != 0 {
            let space = if it.style.contain().contains(Contain::PAINT) {
                &contents
            } else {
                space
            };
            phases.foreground.push((
                Foreground::Atomic,
                it.outside_marker,
                self.place(it.outside_marker, space),
            ));
        }
        if it.kind == Kind::Lines {
            phases.foreground.push((Foreground::Lines, id, contents));
        }
        if let Some(math) = it
            .style
            .display()
            .is_math()
            .then(|| document.boxes.math.get(&id))
            .flatten()
        {
            phases.foreground.push((Foreground::Math, id, contents));
            if it.kind == Kind::Block && math.glyphs.is_some() {
                return;
            }
        }
        for child in it.children.iter().copied() {
            let (own, space) = (
                &document.boxes[child],
                self.place(
                    child,
                    if it.has_legend && child == it.children[0] {
                        space
                    } else {
                        &contents
                    },
                ),
            );
            if own.kind == Kind::RowGroup {
                let moved = |[x, y]: &[f32; 2]| Space {
                    origin: [space.origin[0] + x, space.origin[1] + y],
                    ..space
                };
                phases.foreground.extend(
                    document
                        .boxes
                        .copies
                        .get(&child)
                        .into_iter()
                        .flatten()
                        .map(|it| (Foreground::Copy, child, moved(it))),
                );
            }
            if own.is_in_inline {
                let [x, _, width, _] = document.content_box(id);
                let rect = Rect::new([
                    contents.origin[0] + x,
                    space.origin[1],
                    width,
                    own.layout.size.height,
                ]);
                let around: Vec<_> = document
                    .tree
                    .flat_ancestors(own.node)
                    .take_while(|it| document.own_box(*it).is_none())
                    .collect();
                for (node, style) in around
                    .into_iter()
                    .rev()
                    .filter_map(|it| Some((it, document.tree.style(it)?)))
                {
                    if style.display() != Display::Contents && style.is_visible() {
                        self.hit(node, style, square(rect), &contents);
                    }
                }
            }
            if document.is_layer(child)
                || own.kind == Kind::Column
                || self.is_out_of_sight(child, &space)
            {
                continue;
            }
            if own.style.is_floating() {
                phases.floats.push((child, space));
            } else if it.kind == Kind::Lines {
            } else if own.kind == Kind::Lines {
                self.backgrounds(child, &space, phases);
            } else if matches!(it.kind, Kind::Flex | Kind::Grid | Kind::Math) || own.scrolls() {
                phases.foreground.push((Foreground::Atomic, child, space));
            } else {
                self.decorations(child, &space);
                match own.is_replaced() {
                    true => phases.foreground.push((Foreground::Replaced, child, space)),
                    false => self.backgrounds(child, &space, phases),
                }
                if own.style.outline_width() > 0.0
                    || own.overflow[0] != Overflow::Visible
                        && own.style.other_if_set(Id::BorderShape).is_some()
                {
                    phases.outlines.push((child, space));
                }
            }
        }
        if let Some(lattice) = document.lattice(id).filter(|_| it.style.is_visible()) {
            let row_rect = |row: BoxId| {
                document
                    .border_box(row)
                    .moved(document.offset_in(row, id))
                    .moved(space.origin)
            };
            lattice.pieces(row_rect, space.visible, |rect, edge, is_horizontal| {
                let shape = square(self.snap_rect(rect));
                if !edge.style.is_none()
                    && alpha(edge.color) > 0
                    && !shape.rect.is_empty()
                    && shape.rect.touches(&space.visible)
                {
                    let (mut widths, side) = (
                        [0.0; 4],
                        if is_horizontal {
                            0
                        } else if it.style.is_rtl() {
                            1
                        } else {
                            3
                        },
                    );
                    widths[side] = if is_horizontal {
                        shape.rect.height
                    } else {
                        shape.rect.width
                    };
                    self.emit(
                        &Item::Border {
                            shape,
                            widths,
                            colors: [edge.color; 4],
                            styles: [collapsed_style(edge.style); 4],
                        },
                        space,
                    );
                }
            });
        }
    }

    fn math(&mut self, id: BoxId, space: &Space) {
        let (math, style) = (
            &self.document.boxes.math[&id],
            &self.document.boxes[id].style,
        );
        if !style.is_visible() {
            return;
        }
        self.fill(
            square(self.snap_rect(math.bar.moved(space.origin))),
            style.color(),
            space,
        );
        if let Some((face, all)) = &math.glyphs {
            let start = self.out.glyphs.len() as u32;
            self.out.glyphs.extend(all);
            let (glyphs, bounds) = (
                Span {
                    start,
                    end: self.out.glyphs.len() as u32,
                },
                self.document.border_box(id).grown(face.size),
            );
            self.emit(
                &Item::Text {
                    origin: space.origin,
                    bounds: bounds.moved(space.origin),
                    face: face.id,
                    size: face.size,
                    glyphs,
                    color: style.color(),
                    blur: 0.0,
                },
                space,
            );
        }
    }

    fn decorations(&mut self, id: BoxId, space: &Space) {
        let (document, it) = (self.document, &self.document.boxes[id]);
        match document.pieces(id) {
            None => self.decorate(id, document.border_box(id), space),
            Some(pieces) if it.style.rare.decoration_break == DecorationBreak::Clone => {
                pieces
                    .iter()
                    .for_each(|it| self.decorate(id, it.rect, space));
            }
            Some(pieces) => {
                for piece in pieces {
                    let mut space = *space;
                    self.clip(
                        square(self.snap_rect(piece.clip.moved(space.origin))),
                        &mut space,
                    );
                    self.decorate(id, document.border_box(id).moved(piece.shift), &space);
                }
            }
        }
        if it.kind == Kind::Columns && it.style.is_visible() {
            self.column_rules(id, space);
        }
    }

    fn column_rules(&mut self, id: BoxId, space: &Space) {
        let (document, it) = (self.document, &self.document.boxes[id]);
        let (rare, is_vertical) = (&it.style.rare, it.mode.is_vertical());
        let Some(flow) = it
            .children
            .first()
            .copied()
            .filter(|_| !rare.rule_style.is_none())
        else {
            return;
        };
        let width = crate::cascade::snap_border(rare.rule_width.0, document.environment.scale);
        let style = match rare.rule_style {
            BorderStyle::Inset => BorderStyle::Ridge,
            BorderStyle::Outset => BorderStyle::Groove,
            style => style,
        };
        let contents = self.content_space(id, space);
        let space = self.place(flow, &contents);
        let (colors, styles) = (
            [rare.rule_color.resolve(it.style.color()); 4],
            [line_style(style); 4],
        );
        for line in document
            .pieces(flow)
            .unwrap_or_default()
            .iter()
            .map(|it| it.clip)
            .filter(|it| it.width + it.height > 0.0)
        {
            let widths = if is_vertical {
                [width, 0.0, 0.0, 0.0]
            } else {
                [0.0, 0.0, 0.0, width]
            };
            let rect = line.shrunk(if is_vertical {
                [-width / 2.0, 0.0, -width / 2.0, 0.0]
            } else {
                [0.0, -width / 2.0, 0.0, -width / 2.0]
            });
            self.emit(
                &Item::Border {
                    shape: square(self.snap_rect(rect.moved(space.origin))),
                    widths,
                    colors,
                    styles,
                },
                &space,
            );
        }
    }

    fn decorate(&mut self, id: BoxId, border_box: Rect, space: &Space) {
        let document = self.document;
        let it = &document.boxes[id];
        self.see(
            id,
            self.is_hidden || it.children.is_empty() && !it.style.is_visible(),
        );
        let [above, below] = it.caption_heights;
        let (mut rect, mut border, mut gap) = (
            border_box
                .moved(space.origin)
                .shrunk([above, 0.0, below, 0.0]),
            it.border(),
            None,
        );
        if it.has_legend {
            let (legend, start, axis) = (
                &document.boxes[it.children[0]],
                it.mode.sides()[0],
                it.block_axis(),
            );
            border = it.style.border();
            let (mut inset, mut cut, thickness) =
                ([0.0; 4], [0.0; 4], legend.size()[axis].max(border[start]));
            (inset[start], cut[(start + 2) % 4]) = (
                (thickness - border[start]) / 2.0,
                it.size()[axis] - thickness,
            );
            let offset = crate::lines::relative_offset(
                &legend.style,
                document.content_box(id)[2],
                Some(document.content_box(id)[3]),
            );
            let from =
                [legend.layout.location.x, legend.layout.location.y][1 - axis] - offset[1 - axis];
            (cut[[0, 3][axis]], cut[[2, 1][axis]]) =
                (from, it.size()[1 - axis] - from - legend.size()[1 - axis]);
            (gap, rect) = (Some(self.snap_rect(rect.shrunk(cut))), rect.shrunk(inset));
        }
        if it.node == 0 && it.style.is_floating() && it.style.is_visible() {
            let padding = it.layout.padding;
            let frame = Frame {
                shape: rounded(self.snap_rect(rect), &it.style),
                border,
                padding: [padding.top, padding.right, padding.bottom, padding.left],
                scrolled: None,
                whole: None,
            };
            self.frame(&it.style, &frame, true, space, &mut |painter| {
                painter.text_mask(id, space)
            });
            return self.border(&it.style, &frame, space);
        }
        if it.node == 0
            || !it.style.is_visible()
            || !document.decorated(id, rect).touches(&space.visible)
        {
            return;
        }
        self.painted_node = it.node;
        let shape = rounded(self.snap_rect(rect), &it.style);
        if matches!(it.kind, Kind::Row | Kind::RowGroup) {
        } else if [
            Id::BorderShape,
            Id::CornerTopLeftShape,
            Id::CornerTopRightShape,
            Id::CornerBottomRightShape,
            Id::CornerBottomLeftShape,
        ]
        .iter()
        .all(|id| it.style.other_if_set(*id).is_none())
        {
            self.hit(it.node, &it.style, shape, space);
        } else {
            let (frame, mut inside) = (document.frame_of(id, shape.rect), *space);
            match Contour::of(&it.style, &frame) {
                Some(contour) => {
                    self.clip_inside(&contour, &frame, Edge::Outer(0.0), &mut inside);
                    self.hit(it.node, &it.style, square(inside.visible), &inside);
                }
                None => self.hit(it.node, &it.style, shape, space),
            }
        }
        if document.compositor.is_on
            && it.style.ink.pointer_events != PointerEvents::None
            && it.style.ink.interactivity == Interactivity::Auto
        {
            if is_name!(it.tag, "iframe" | "webview") {
                self.leave_scrolling_to_engine(space);
                self.wheel_hit(it.node, shape.rect, space.scroller, space);
                self.out
                    .wheel_hits
                    .last_mut()
                    .into_iter()
                    .for_each(|it| it.kind = abi::HIT_BLOCKING);
            } else if it.scrolls()
                || document.is_layer(id)
                || document.compositor.wheel_blockers.contains(&it.node)
            {
                let scroller = self.content_space(id, space).scroller;
                self.wheel_hit(it.node, shape.rect, scroller, space);
            }
        }
        if it.style.ink.app_region != AppRegion::None {
            let rect = rect
                .intersection(&space.visible)
                .transformed(&self.out.links[space.link as usize].matrix);
            self.out.regions.push(abi::Region {
                rect,
                drag: it.style.ink.app_region == AppRegion::Drag,
            });
            self.out.region_nodes.push(it.node);
        }
        let padding = it.layout.padding;
        let frame = Frame {
            shape,
            border,
            padding: [padding.top, padding.right, padding.bottom, padding.left],
            scrolled: it.scrolls().then_some(id),
            whole: None,
        };
        let has_background = it.node != self.out.canvas_source && !document.tree.is_root(it.node);
        let (is_native, is_part) = (
            it.style.look.is_painted(),
            matches!(it.kind, Kind::Row | Kind::RowGroup),
        );
        let mut behind = *space;
        if it.collapsed.is_some()
            && it.kind != Kind::Table
            && (document.is_layer(id) || document.is_layer(it.parent))
        {
            self.clip(square(self.snap_rect(rect.shrunk(border))), &mut behind);
        }
        self.frame(
            &it.style,
            &frame,
            has_background && !is_native && !is_part,
            &behind,
            &mut |painter| painter.text_mask(id, space),
        );
        if is_part && has_background {
            self.behind_cells(id, id, space);
        } else if it.kind == Kind::Table {
            let groups = it
                .children
                .iter()
                .filter(|it| document.boxes[**it].kind == Kind::Column);
            groups
                .clone()
                .chain(groups.flat_map(|it| &document.boxes[*it].children))
                .for_each(|it| self.behind_cells(*it, id, space));
        }
        match &it.collapsed {
            _ if is_native => self.native_control(id, shape.rect, space),
            None if matches!(it.kind, Kind::Row | Kind::RowGroup) => {}
            None => {
                let mut space = *space;
                if let Some(gap) = gap {
                    let verbs = [
                        shape
                            .rect
                            .union(&gap)
                            .grown(decoration_extent(&it.style) + 1.0),
                        gap,
                    ]
                    .map(|it| Path::rect(it).verbs)
                    .concat();
                    self.clip_to(
                        crate::shapes::Resolved::Path(Path::from(&verbs[..]), FillRule::Evenodd),
                        &mut space,
                    );
                }
                self.border(&it.style, &frame, &space);
            }
            Some(_)
                if it.kind == Kind::Table
                    || document
                        .boxes
                        .containers(id)
                        .nth(2)
                        .is_some_and(|it| document.lattice(it).is_some()) => {}
            Some(edges) => {
                let [top, right, bottom, left] = edges.map(|it| it.width);
                let scale = document.environment.scale;
                let half = |it: f32| (it * scale).round() / 2.0;
                let outside = [
                    half(top).floor(),
                    half(right).ceil(),
                    half(bottom).ceil(),
                    half(left).floor(),
                ]
                .map(|it| it / scale);
                let [x, y] = [rect.x, rect.y].map(|it| self.snap(it - 0.01));
                let snapped = Rect::from_edges(
                    x,
                    y,
                    self.snap(rect.right() - 0.01),
                    self.snap(rect.bottom() - 0.01),
                );
                let shape = square(snapped.shrunk(outside.map(|it| -it)));
                let (colors, styles) = (
                    edges.map(|it| it.color),
                    edges.map(|it| collapsed_style(it.style)),
                );
                self.emit(
                    &Item::Border {
                        shape,
                        widths: [top, right, bottom, left],
                        colors,
                        styles,
                    },
                    space,
                );
            }
        }
        if matches!(it.style.look, Look::MenuList | Look::MenuListButton) {
            self.menu_arrow(&it.style, shape.rect, space);
        }
        if it.children.is_empty() {
            self.caret_in(id, space);
        }
    }

    /// The background of a row, a column or a group of them. The space is that of `around`, which has the cells.
    fn behind_cells(&mut self, part: BoxId, around: BoxId, space: &Space) {
        let document = self.document;
        let (style, rect_of) = (&document.boxes[part].style, |id| {
            document
                .border_box(id)
                .moved(document.offset_in(id, around))
                .moved(space.origin)
        });
        if !style.has_background() || !style.is_visible() {
            return;
        }
        let (whole, mut cells, axis) = (
            rect_of(part),
            vec![around],
            1 - document.boxes[around].block_axis(),
        );
        while cells.iter().any(|it| !document.boxes[*it].is_cell()) {
            let is_inside = |it: &BoxId| {
                matches!(document.boxes[*it].kind, Kind::Row | Kind::RowGroup)
                    || document.boxes[*it].is_cell()
            };
            cells = cells
                .iter()
                .flat_map(|it| &document.boxes[*it].children)
                .copied()
                .filter(is_inside)
                .collect();
        }
        let ([from, to], is_rtl) = (whole.span(axis), document.boxes[around].style.is_rtl());
        for (cell, rect) in cells
            .into_iter()
            .map(|it| (&document.boxes[it], rect_of(it)))
        {
            let start = if is_rtl {
                rect.span(axis)[1] - 0.01
            } else {
                rect.span(axis)[0] + 0.01
            };
            if (part == around || (from..to).contains(&start))
                && cell.style.is_visible()
                && rect.touches(&space.visible)
            {
                let whole = Some((self.snap_rect(whole), [0.0; 4], [0.0; 4]));
                let frame = Frame {
                    shape: square(self.snap_rect(rect)),
                    border: [0.0; 4],
                    padding: [0.0; 4],
                    scrolled: None,
                    whole,
                };
                self.background(style, &frame, None, space, &mut |_| {});
            }
        }
    }

    pub(crate) fn caret_in(&mut self, id: BoxId, space: &Space) {
        if let Some((_, rect)) = self.out.caret.filter(|it| it.0 == id) {
            let style = self.document.inherited_style(id);
            let color = style
                .ink
                .caret_color
                .0
                .map_or_else(|| style.color(), |it| it.resolve(style.color()));
            let is_block = style.other_if_set(Id::CaretShape) == Some("block");
            let color = if is_block && style.ink.caret_color.0.is_none() {
                color & !0xff | alpha(color).div_ceil(2)
            } else {
                color
            };
            let rect = match is_block {
                true => self.snap_rect(rect.moved(space.origin)),
                false => Rect {
                    width: rect.width,
                    ..self.snap_rect(
                        Rect {
                            x: self.snap(rect.x),
                            ..rect
                        }
                        .moved(space.origin),
                    )
                },
            };
            match style.other_if_set(Id::CaretAnimation) {
                Some(_) => self.fill(square(rect), color, space),
                None => self.emit(&Item::Caret { rect, color }, space),
            }
        }
    }

    pub(crate) fn border(&mut self, style: &Style, frame: &Frame, space: &Space) {
        if style.is_bare() && frame.border == [0.0; 4] {
            return;
        }
        let p = &style.paint;
        let (l, is_table) = (
            &style.layout,
            matches!(
                style.display(),
                Display::Table | Display::InlineTable | Display::TableCell
            ),
        );
        let sides = [
            (p.border_top, l.border_top_style),
            (p.border_right, l.border_right_style),
            (p.border_bottom, l.border_bottom_style),
            (p.border_left, l.border_left_style),
        ];
        let colors = sides.map(|it| match it {
            (
                crate::color::Color::Current,
                BorderStyle::Inset | BorderStyle::Outset | BorderStyle::Ridge | BorderStyle::Groove,
            ) if !is_table => 0xeeee_eeff,
            (color, _) => color.resolve(style.color()),
        });
        let image = style
            .background
            .border_image
            .0
            .as_ref()
            .filter(|_| style.other_if_set(Id::BorderShape).is_none());
        if !image
            .is_some_and(|it| self.nine_pieces(it, crate::nine_pieces::BORDER, style, frame, space))
        {
            self.border_in(style, frame, colors, space);
        }
    }

    pub(crate) fn border_in(
        &mut self,
        style: &Style,
        frame: &Frame,
        colors: [u32; 4],
        space: &Space,
    ) {
        let (
            l,
            Frame {
                shape,
                border: widths,
                ..
            },
        ) = (&style.layout, *frame);
        let styles = || {
            [
                l.border_top_style,
                l.border_right_style,
                l.border_bottom_style,
                l.border_left_style,
            ]
            .map(line_style)
        };
        if let Some(contour) = Contour::of(style, frame) {
            self.contoured_border(&contour, frame, style, colors, styles(), space);
        } else if (0..4).any(|side| widths[side] > 0.0 && alpha(colors[side]) > 0) {
            self.emit(
                &Item::Border {
                    shape,
                    widths,
                    colors,
                    styles: styles(),
                },
                space,
            );
        }
    }

    pub(crate) fn outline(&mut self, style: &Style, rect: Rect, space: &Space) {
        let p = &style.paint;
        let (mut width, mut offset, color) = (
            style.outline_width(),
            p.outline_offset.0,
            p.outline_color.resolve(style.color()),
        );
        if width <= 0.0 || alpha(color) == 0 || !style.is_visible() {
            return;
        }
        let mut shape = rounded(self.snap_rect(rect), style);
        let frame = Frame {
            shape,
            border: style.border(),
            padding: [0.0; 4],
            scrolled: None,
            whole: None,
        };
        let is_hard_to_stroke = |it: &RoundedRect| {
            p.outline_style == OutlineStyle::Auto
                || 2.0 * (offset + width) > it.rect.width.min(it.rect.height)
        };
        let simple = crate::contour::rounded_border_shape(style, &frame)
            .filter(is_hard_to_stroke)
            .inspect(|it| shape = *it);
        let contour = Contour::of(style, &frame).filter(|_| simple.is_none());
        let ring = |painter: &mut Self,
                    shape: RoundedRect,
                    offset: f32,
                    width: f32,
                    line: LineStyle,
                    color: u32| match &contour {
            Some(contour) => {
                painter.contoured_outline(contour, &frame, offset, width, line, color, space)
            }
            None if offset < 0.0 && -2.0 * offset > shape.rect.width.min(shape.rect.height) => {
                let [x, y] =
                    [shape.rect.width, shape.rect.height].map(|it| offset.max(-it / 2.0) + width);
                painter.emit(
                    &Item::Border {
                        shape: shape.outset([y, x, y, x]),
                        widths: [width; 4],
                        colors: [color; 4],
                        styles: [line; 4],
                    },
                    space,
                );
            }
            None if line == LineStyle::Solid
                && shape
                    .radii
                    .as_flattened()
                    .iter()
                    .any(|it| *it > 0.0 && *it < offset + width) =>
            {
                let [outer, inner] = [offset + width, offset].map(|it| {
                    crate::shapes::Resolved::Rounded(shape.spread(it))
                        .into_path()
                        .0
                        .verbs
                });
                let outline = painter
                    .outline_of(&Path::from(&[outer, inner].concat()[..]), FillRule::Evenodd);
                painter.emit(&Item::Path { outline, color }, space);
            }
            None => painter.emit(
                &Item::Border {
                    shape: shape.spread(offset + width),
                    widths: [width; 4],
                    colors: [color; 4],
                    styles: [line; 4],
                },
                space,
            ),
        };
        let line = match p.outline_style {
            OutlineStyle::Auto => {
                (width, offset) = (2.0 * style.zoom, offset - style.zoom);
                shape = fit(
                    shape.rect,
                    shape.radii.map(|it| it.map(|it| it.max(2.0 * style.zoom))),
                );
                ring(
                    self,
                    shape,
                    offset + width,
                    style.zoom,
                    LineStyle::Solid,
                    if style.dark { 0x1010_10ff } else { 0xffff_ffff },
                );
                LineStyle::Solid
            }
            other => line_style(
                BorderStyle::from_name(other.name().as_bytes()).unwrap_or(BorderStyle::Solid),
            ),
        };
        ring(self, shape, offset, width, line, color);
    }

    fn replaced(&mut self, id: BoxId, space: &Space) {
        let document = self.document;
        let it = &document.boxes[id];
        let (style, content) = (
            &it.style,
            Rect::new(document.content_box(id)).moved(space.origin),
        );
        if let Some(image) = document
            .tree
            .element(it.node)
            .and_then(|it| it.replaced)
            .filter(|it| is_snapshot(it.image))
        {
            let contents = self.content_space(id, space);
            return if style.is_visible() {
                self.snapshot(image.image, object_rect(style, image, content), &contents)
            };
        }
        if it.is_skipped || it.kind != Kind::Svg && (!style.is_visible() || content.is_empty()) {
            return;
        }
        if it.kind == Kind::Bullet {
            return self.bullet(id, content, space);
        }
        self.painted_node = it.node;
        let inset = it.layout.border + it.layout.padding;
        let outline = rounded(
            self.snap_rect(document.border_box(id).moved(space.origin)),
            style,
        );
        let mut clip = outline.shrunk([inset.top, inset.right, inset.bottom, inset.left]);
        if it.kind == Kind::Svg {
            let contents = self.content_space(id, space);
            if style.ink.interactivity == Interactivity::Auto {
                self.out.hits.push(Hit {
                    target: Target::InSvg(it.node),
                    shape: square(document.ink(id).moved(space.origin)),
                    link: contents.link,
                });
            }
            return self.svg_root(id, &contents);
        }
        let Some(image) = document
            .tree
            .element(it.node)
            .and_then(|it| it.replaced)
            .filter(|it| it.image != 0)
        else {
            let Some(ready) = document
                .drawn_images
                .get(&it.node)
                .and_then(|it| document.ready(it, style))
            else {
                return;
            };
            return self.draw(
                &ready,
                clip,
                abi::Tile {
                    rect: clip.rect,
                    step: [0.0; 2],
                },
                style,
                space,
            );
        };
        let rect = self.snap_rect(object_rect(style, image, content));
        if document.overflow_clip(id).is_none() {
            clip = square(rect);
        } else if style.effects.clip_margin != ClipMargin(BoxArea::ContentBox, 0.0) {
            clip = document.rounded_overflow_clip(id, outline);
        }
        let (frame, mut space) = (document.frame_of(id, outline.rect), *space);
        let contour =
            Contour::of(style, &frame).filter(|_| !it.overflow.contains(&Overflow::Visible));
        let goes_under = contour
            .as_ref()
            .is_some_and(|it| frame.padding == [0.0; 4] && it.is_hidden_by_border(style));
        contour.iter().for_each(|it| {
            self.clip_inside(
                it,
                &frame,
                if goes_under {
                    Edge::Within(0.5)
                } else {
                    Edge::Content
                },
                &mut space,
            )
        });
        let (clip, space) = (
            if contour.is_some() {
                square(clip.rect)
            } else {
                clip
            },
            &space,
        );
        self.draw_image(
            clip,
            abi::Tile {
                rect,
                step: [0.0; 2],
            },
            image.image,
            style,
            space,
        );
        if goes_under {
            self.border(style, &frame, space);
        }
    }

    fn bullet(&mut self, id: BoxId, content: Rect, space: &Space) {
        let style = &self.document.boxes[id].style;
        let (color, ascent, is_rtl) = (
            style.ink.text_fill_color.resolve(style.color()),
            style.metrics.ascent,
            style.is_rtl(),
        );
        let ListStyleType::Named(name) = &style.text.list_type else {
            return;
        };
        if crate::counters::is_disclosure(style) {
            let size = style.font.size.0 * 0.66;
            let [x, y] = [
                if is_rtl {
                    content.right() - size
                } else {
                    content.x
                },
                content.y + ascent - size,
            ];
            let points = match (&**name == "disclosure-open", is_rtl) {
                (true, _) => [[0.0, 0.07], [0.5, 0.93], [1.0, 0.07]],
                (false, false) => [[0.0, 0.0], [0.86, 0.5], [0.0, 1.0]],
                (false, true) => [[1.0, 0.0], [0.14, 0.5], [1.0, 1.0]],
            };
            return self.polygon(
                &points.map(|it| [x + it[0] * size, y + it[1] * size]),
                color,
                space,
            );
        }
        let scale = self.document.environment.scale;
        let (size, ascent) = (
            crate::counters::bullet_size(style, scale),
            (ascent * scale).round(),
        );
        let y = content.y + (3.0 * (ascent - (ascent * 2.0 / 3.0).floor()) / 2.0).floor() / scale;
        let rect = Rect::new([
            self.snap(if is_rtl {
                content.right() - size
            } else {
                content.x
            }),
            self.snap(y),
            size,
            size,
        ]);
        let round = RoundedRect {
            rect,
            radii: [[size / 2.0; 2]; 4],
        };
        match &**name {
            "square" => self.fill(square(rect), color, space),
            "circle" => {
                let (shape, widths) = (round.spread(0.5 / scale), [1.0 / scale; 4]);
                self.emit(
                    &Item::Border {
                        shape,
                        widths,
                        colors: [color; 4],
                        styles: [LineStyle::Solid; 4],
                    },
                    space,
                );
            }
            _ => self.fill(round, color, space),
        }
    }

    fn styled_part(&mut self, style: Option<&Style>, rect: Rect, space: &Space) {
        if let Some(style) = style.filter(|it| it.display() != Display::None && it.is_visible()) {
            let (shape, border) = (rounded(self.snap_rect(rect), style), style.border());
            let frame = Frame {
                shape,
                border,
                padding: [0.0; 4],
                scrolled: None,
                whole: None,
            };
            self.frame(style, &frame, true, space, &mut |_| {});
            self.border(style, &frame, space);
        }
    }

    fn resizer(&mut self, id: BoxId, space: &Space) {
        let (document, style) = (self.document, &self.document.boxes[id].style);
        let Some(rect) = document.resizer(id).filter(|_| style.is_visible()) else {
            return;
        };
        let rect = self.snap_rect(rect.moved(space.origin));
        if style.ink.pointer_events != PointerEvents::None {
            self.out.hits.push(Hit {
                target: Target::Scrollbar(id, crate::scroll::RESIZER),
                shape: square(rect),
                link: space.link,
            });
        }
        match document.pseudo_style(
            document.boxes[id].node,
            Pseudo::Part(crate::name::name!("-webkit-resizer")),
            crate::tree::State::empty(),
        ) {
            Some(style) => self.styled_part(Some(&style), rect, space),
            None => self.grip(rect, style.is_rtl(), space),
        }
    }

    fn scrollbars(&mut self, id: BoxId, space: &Space) {
        let document = self.document;
        let it = &document.boxes[id];
        let Some(style) = document
            .tree
            .style(document.scrollbar_owner(id))
            .filter(|_| it.scrollbars != [false; 2])
        else {
            return;
        };
        if !style.is_visible() {
            return;
        }
        let mut space = *space;
        let outline = rounded(
            self.snap_rect(document.border_box(id).moved(space.origin)),
            &it.style,
        );
        if outline.radii != Radii::default() {
            self.clip(outline.shrunk(it.border()), &mut space);
        }
        let (default_thumb, default_track) = match (cfg!(target_os = "macos"), style.dark) {
            (true, true) => (0x6b6b_6bff, 0x2b2b_2bff),
            (true, false) => (0xc1c1_c1ff, 0xfafa_faff),
            (false, true) => (0x9f9f_9fff, 0x2c2c_2cff),
            (false, false) => (0x8b8b_8bff, 0xfcfc_fcff),
        };
        let colors = style
            .ink
            .scrollbar_color
            .0
            .as_ref()
            .map(|it| [it.0, it.1].map(|it| it.resolve(style.color())));
        let [thumb_color, track_color] = colors.unwrap_or([default_thumb, default_track]);
        let bars = [0, 1].map(|axis| document.scrollbar(id, axis));
        if let [Some(horizontal), Some(vertical)] = &bars {
            let corner = Rect {
                y: horizontal.rect.y,
                height: horizontal.rect.height,
                ..vertical.rect
            }
            .moved(space.origin);
            match vertical.custom {
                Some(_) => self.styled_part(
                    document
                        .scrollbar_part_style(id, 1, Pseudo::ScrollbarCorner)
                        .as_deref(),
                    corner,
                    &space,
                ),
                None if it.scrollbar_size > 0.0 => {
                    self.fill(square(self.snap_rect(corner)), track_color, &space)
                }
                None => {}
            }
        }
        for (axis, bar) in bars.into_iter().enumerate() {
            let Some(bar) = bar else { continue };
            let (rect, thumb) = (
                self.snap_rect(bar.rect.moved(space.origin)),
                bar.thumb.map(|it| it.moved(space.origin)),
            );
            if style.ink.pointer_events != PointerEvents::None {
                self.out.hits.push(Hit {
                    target: Target::Scrollbar(id, axis),
                    shape: square(rect),
                    link: space.link,
                });
            }
            let mut moving = space;
            if let (Some(scroller), Some(thumb), Some(own)) =
                (self.scroller_of(it.node), thumb, bar.thumb)
            {
                let abi::Scroller { min, max, .. } = self.out.scrollers[scroller as usize];
                let [start, end] = own.span(axis);
                let along = |by: f32| translation(if axis == 0 { [by, 0.0] } else { [0.0, by] });
                let ends = [
                    (min[axis], along(bar.track[0] - start)),
                    (max[axis], along(bar.track[1] - end)),
                ];
                self.wheel_hit(it.node, rect, scroller, &space);
                self.driven(
                    IDENTITY,
                    Source::Offset {
                        scroller,
                        axis: axis as u8,
                    },
                    ends,
                    &mut moving,
                );
                self.wheel_hit(it.node, thumb, scroller, &moving);
                let ratio = (max[axis] - min[axis])
                    / (bar.track[1] - bar.track[0] - (end - start)).max(1.0);
                let kind = [abi::HIT_THUMB_X, abi::HIT_THUMB_Y][axis];
                self.out
                    .wheel_hits
                    .last_mut()
                    .into_iter()
                    .for_each(|it| (it.kind, it.ratio) = (kind, ratio));
            }
            if bar.custom.is_some() {
                self.styled_part(bar.custom.as_deref(), rect, &space);
                self.styled_part(
                    document
                        .scrollbar_part_style(id, axis, Pseudo::ScrollbarTrack)
                        .as_deref(),
                    rect,
                    &space,
                );
                if let Some(thumb) = thumb {
                    self.styled_part(
                        document
                            .scrollbar_part_style(id, axis, Pseudo::ScrollbarThumb)
                            .as_deref(),
                        thumb,
                        &moving,
                    );
                }
                continue;
            }
            let hovered = document
                .scrolling
                .hovered
                .filter(|part| (part.0, part.1) == (it.node, axis))
                .map(|it| it.2);
            let is_dragged = document
                .scrolling
                .dragged
                .is_some_and(|part| (part.0, part.1) == (it.node, axis));
            let emphasized = |on: bool| match (on, style.dark) {
                (false, _) => thumb_color,
                (true, false) => mix_colors(thumb_color, alpha(thumb_color), 0.3),
                (true, true) => mix_colors(thumb_color, 0xffff_ff00 | alpha(thumb_color), 0.4),
            };
            let thickness = [rect.height, rect.width][axis];
            let across = |by: f32| {
                if axis == 0 {
                    [by, 0.0, by, 0.0]
                } else {
                    [0.0, by, 0.0, by]
                }
            };
            let pill = |rect: Rect| fit(rect, [[999.0; 2]; 4]);
            if it.scrollbar_size == 0.0 {
                let is_expanded = hovered.is_some() || is_dragged;
                let opacity = document
                    .scrolling
                    .overlay_opacity(it.node, document.animations.now);
                let faded = |color: u32, by: f32| color & !0xff | (alpha(color) as f32 * by) as u32;
                if is_expanded {
                    self.fill(square(rect), faded(track_color, opacity * 0.75), &space);
                }
                let color = faded(
                    colors.map_or(if style.dark { 0xffff_ff80 } else { 0x0000_0080 }, |it| {
                        it[0]
                    }),
                    opacity,
                );
                let [near, far] =
                    [if is_expanded { 3.0 } else { 7.0 }, 2.0].map(|it| it * thickness / 16.0);
                let inset = if axis == 0 {
                    [near, far, far, far]
                } else {
                    [far, far, far, near]
                };
                thumb
                    .into_iter()
                    .for_each(|it| self.fill(pill(it.shrunk(inset)), color, &moving));
                continue;
            }
            self.fill(square(rect), track_color, &space);
            let Some(thumb) = thumb else { continue };
            let color = emphasized(is_dragged || hovered == Some(Part::Thumb));
            self.fill(
                pill(
                    self.snap_rect(thumb)
                        .shrunk(across(self.snap(thickness / 5.0))),
                ),
                color,
                &moving,
            );
            for (part, direction) in [(Part::Back, -1.0), (Part::Forward, 1.0)]
                .into_iter()
                .filter(|_| bar.button > 0.0)
            {
                let [start, end] = rect.span(axis);
                let along = if direction < 0.0 {
                    start + bar.button / 2.0
                } else {
                    end - bar.button / 2.0
                };
                let (middle, half) = (
                    rect.span(1 - axis).iter().sum::<f32>() / 2.0,
                    thickness * 0.3,
                );
                let points = [
                    [-0.7 * direction, -1.0],
                    [-0.7 * direction, 1.0],
                    [0.7 * direction, 0.0],
                ]
                .map(|it| {
                    let point = [along + it[0] * half, middle + it[1] * half];
                    if axis == 0 {
                        point
                    } else {
                        [point[1], point[0]]
                    }
                });
                self.polygon(&points, emphasized(hovered == Some(part)), &space);
            }
        }
    }
}

pub(crate) fn resolve_padding(style: &Style, basis: f32) -> [f32; 4] {
    let l = &style.layout;
    [
        &l.padding_top.0,
        &l.padding_right.0,
        &l.padding_bottom.0,
        &l.padding_left.0,
    ]
    .map(|it: &Lp| it.resolve(basis))
}

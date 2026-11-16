use std::cell::Cell;
use std::ops::Range;
use std::time::Instant;

use super::raster::{Path, map_rect};
use super::warp::Projection;
use crate::abi::{
    self, Filter, Glyph, GradientStop, Item, LineStyle, PathVerb, Rect, Region, RoundedRect, Span,
};
use crate::gfx::{self, PathBuilder as _, Transform};
use crate::sync::Mutex;

/// What an item and, for a `Push*`, everything up to its `Pop` cover.
#[derive(Clone, Copy, Default)]
struct Extent {
    /// In the space that the item is in. For a `Pop`, of the content, in the space that is inside of the group.
    bounds: Rect,
    /// The index after it.
    end: u32,
    /// The index of a layer's `Mask`, or 0. For a `Pop`, the index after the `Push*` of the group around the group.
    mask: u32,
}

pub struct Scene {
    pub zoom: f32,
    pub items: Vec<Item>,
    pub glyphs: Vec<Glyph>,
    pub stops: Vec<GradientStop>,
    pub filters: Vec<Filter>,
    pub verbs: Vec<PathVerb>,
    pub bytes: Vec<u8>,
    pub regions: Vec<Region>,
    pub caret: Option<Rect>,
    pub has_backdrops: bool,
    pub has_cross_fades: bool,
    /// Those that have not been asked for, with their sizes.
    pub new_images: Mutex<Vec<(u32, [f32; 2])>>,
    extents: Vec<Extent>,
    /// The items as they were before `Motion` changed them.
    submitted: Vec<Item>,
}

impl Default for Scene {
    fn default() -> Scene {
        Scene {
            zoom: 1.,
            items: Vec::new(),
            glyphs: Vec::new(),
            stops: Vec::new(),
            filters: Vec::new(),
            verbs: Vec::new(),
            bytes: Vec::new(),
            regions: Vec::new(),
            caret: None,
            has_backdrops: false,
            has_cross_fades: false,
            new_images: Mutex::default(),
            extents: Vec::new(),
            submitted: Vec::new(),
        }
    }
}

/// What stays the same while a scene is painted.
pub struct Frame {
    /// Device pixels per CSS pixel.
    pub scale: f32,
    pub now: Instant,
    pub shows_caret: bool,
    pub snaps: bool,
    /// When an animated image next changes.
    pub next_change: Cell<Option<Instant>>,
    /// Until when it waits for images to be decoded, if it can do without them.
    pub deadline: Option<Instant>,
}

impl Frame {
    pub fn new(scale: f32, shows_caret: bool) -> Frame {
        Frame {
            scale,
            now: Instant::now(),
            shows_caret,
            snaps: true,
            next_change: Cell::new(None),
            deadline: None,
        }
    }

    pub fn rescaled(&self, factor: f32) -> Frame {
        Frame {
            scale: self.scale * factor,
            next_change: Cell::new(None),
            ..*self
        }
    }

    /// Moves the edges to device pixels, like Blink's `ToPixelSnappedRect`.
    pub fn snap(&self, rect: Rect) -> Rect {
        if !self.snaps {
            return rect;
        }
        let axis = |start: f32, size: f32| {
            let (low, high) = (
                (start * self.scale + 0.5).floor(),
                ((start + size) * self.scale + 0.5).floor(),
            );
            let snapped = if high == low && size * self.scale > 1. / 16. {
                1.
            } else {
                high - low
            };
            (low / self.scale, snapped / self.scale)
        };
        let ((x, width), (y, height)) = (axis(rect.x, rect.width), axis(rect.y, rect.height));
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    pub fn snap_shape(&self, shape: &RoundedRect) -> RoundedRect {
        let rect = self.snap(shape.rect);
        let [tl, tr, br, bl] = shape.radii;
        let fit = |side: f32, a: f32, b: f32| if a + b > side { side / (a + b) } else { 1. };
        let factor = fit(rect.width, tl[0], tr[0])
            .min(fit(rect.width, bl[0], br[0]))
            .min(fit(rect.height, tl[1], bl[1]))
            .min(fit(rect.height, tr[1], br[1]));
        RoundedRect {
            rect,
            radii: shape
                .radii
                .map(|radius| radius.map(|length| length * factor)),
        }
    }

    pub fn snap_width(&self, width: f32) -> f32 {
        match width * self.scale {
            ..=0. => 0.,
            device => (device + 0.01).floor().max(1.) / self.scale,
        }
    }

    pub fn is_translation(&self, matrix: &Transform) -> bool {
        const EPSILON: f32 = 1e-4;
        let is_near = |a: f32, b: f32| (a - b).abs() < EPSILON;
        is_near(matrix.sx, self.scale)
            && is_near(matrix.sy, self.scale)
            && is_near(matrix.kx, 0.)
            && is_near(matrix.ky, 0.)
    }

    /// A translation lands on a device pixel, so that what it moves stays sharp.
    pub fn concat(&self, matrix: &Transform, [a, b, c, d, e, f]: abi::Matrix) -> Transform {
        let result = matrix.pre_concat(Transform::from_row(a, b, c, d, e, f));
        match self.snaps && self.is_translation(&result) {
            true => Transform::from_row(
                self.scale,
                0.,
                0.,
                self.scale,
                (result.tx + 0.5).floor(),
                (result.ty + 0.5).floor(),
            ),
            false => result,
        }
    }

    pub fn changes_at(&self, time: Instant) {
        self.next_change.set(Some(
            self.next_change.get().map_or(time, |known| known.min(time)),
        ));
    }
}

pub fn outset(rect: Rect, by: f32) -> Rect {
    Rect {
        x: rect.x - by,
        y: rect.y - by,
        width: rect.width + by * 2.,
        height: rect.height + by * 2.,
    }
}

fn is_empty(rect: Rect) -> bool {
    !(rect.width > 0. && rect.height > 0.)
}

pub fn union(a: Rect, b: Rect) -> Rect {
    if is_empty(a) || is_empty(b) {
        return if is_empty(a) { b } else { a };
    }
    let (x, y) = (a.x.min(b.x), a.y.min(b.y));
    Rect {
        x,
        y,
        width: (a.x + a.width).max(b.x + b.width) - x,
        height: (a.y + a.height).max(b.y + b.height) - y,
    }
}

pub fn intersect(a: Rect, b: Rect) -> Rect {
    let (x, y) = (a.x.max(b.x), a.y.max(b.y));
    Rect {
        x,
        y,
        width: ((a.x + a.width).min(b.x + b.width) - x).max(0.),
        height: ((a.y + a.height).min(b.y + b.height) - y).max(0.),
    }
}

pub fn tile_bounds(clip: &RoundedRect, tile: &abi::Tile) -> Rect {
    let mut bounds = tile.rect;
    if tile.step[0] > 0. {
        (bounds.x, bounds.width) = (clip.rect.x, clip.rect.width);
    }
    if tile.step[1] > 0. {
        (bounds.y, bounds.height) = (clip.rect.y, clip.rect.height);
    }
    intersect(bounds, clip.rect)
}

pub fn filtered_bounds(bounds: Rect, filters: &[Filter]) -> Rect {
    filters.iter().fold(bounds, |bounds, filter| match *filter {
        Filter::Blur(sigma) => outset(bounds, sigma * 3.),
        Filter::DropShadow { offset, blur, .. } => {
            let shadow = outset(bounds, blur * 3.);
            let (x, y) = (shadow.x + offset[0], shadow.y + offset[1]);
            union(bounds, Rect { x, y, ..shadow })
        }
        Filter::Graph(region) => region,
        _ => bounds,
    })
}

pub fn has_graph(filters: &[Filter]) -> bool {
    filters
        .iter()
        .any(|filter| matches!(filter, Filter::Graph(_)))
}

/// Whether it changes what is under it where it has nothing.
pub fn cross_fades(item: &Item) -> bool {
    matches!(
        item,
        Item::PushLayer {
            blend: abi::BlendMode::PlusLighter,
            ..
        }
    )
}

pub fn erases(item: &Item) -> bool {
    use abi::BlendMode::{DestinationIn, SourceIn, SourceOut};
    matches!(
        item,
        Item::PushLayer {
            blend: DestinationIn | SourceIn | SourceOut,
            ..
        }
    )
}

fn leaf_bounds(item: &Item) -> Rect {
    // Snapping moves an edge by up to half a pixel.
    let snapped = |rect: Rect| {
        if is_empty(rect) {
            rect
        } else {
            outset(rect, 1.)
        }
    };
    match item {
        Item::Backdrop { shape, .. } | Item::Fill { shape, .. } | Item::Border { shape, .. } => {
            snapped(shape.rect)
        }
        Item::Shadow {
            shape, inset: true, ..
        } => snapped(shape.rect),
        Item::Shadow { shadow, blur, .. } => snapped(outset(shadow.rect, blur * 1.5)),
        Item::Gradient { clip, tile, .. } | Item::Image { clip, tile, .. } => {
            snapped(tile_bounds(clip, tile))
        }
        Item::ImagePart { clip, .. } | Item::Svg { clip, .. } => snapped(*clip),
        Item::Path {
            outline: abi::Outline { bounds, .. },
            ..
        }
        | Item::Shade { bounds, .. } => *bounds,
        Item::TextStroke {
            bounds,
            size,
            stroke,
            ..
        } => outset(
            *bounds,
            size * 0.5 + stroke.width * stroke.miter_limit.max(1.),
        ),
        Item::Text {
            bounds, blur, size, ..
        } => outset(*bounds, blur * 1.5 + size * 0.5),
        Item::Line {
            rect,
            style: LineStyle::Wavy,
            ..
        } => outset(*rect, rect.height.max(1.) * 3. + 2.),
        Item::Line {
            rect,
            style: LineStyle::Double,
            ..
        } => outset(*rect, rect.height * 2. + 2.),
        Item::Line { rect, .. } => outset(*rect, 1.),
        Item::Caret { rect, .. } => snapped(*rect),
        _ => Rect::default(),
    }
}

fn get<T>(slice: &[T], span: Span) -> &[T] {
    slice.get(span.range()).unwrap_or_default()
}

/// # Safety
/// `from` is valid.
pub unsafe fn copy<T: Copy>(from: abi::Slice<T>, to: &mut Vec<T>) {
    to.clear();
    // SAFETY: the caller's contract.
    to.extend_from_slice(unsafe { from.get() });
    to.shrink_to(to.len() * 2);
}

impl Scene {
    /// Takes what `list` has, which is left with vectors to reuse.
    pub fn replace(&mut self, first_items: &[Item], list: &mut Scene) {
        std::mem::swap(self, list);
        std::mem::swap(&mut self.items, &mut list.items);
        std::mem::swap(&mut self.extents, &mut list.extents);
        self.items.clear();
        self.items.extend_from_slice(first_items);
        self.items.extend_from_slice(&self.submitted);
        self.index();
    }

    pub fn is_same_list(&self, other: &Scene) -> bool {
        self.zoom == other.zoom
            && self.submitted == other.submitted
            && self.glyphs == other.glyphs
            && self.stops == other.stops
            && self.filters == other.filters
            && self.verbs == other.verbs
            && self.bytes == other.bytes
            && self.regions == other.regions
    }

    /// For `replace`.
    ///
    /// # Safety
    /// The slices of `list` are valid.
    pub unsafe fn copy_list(&mut self, list: &abi::DisplayList) {
        self.zoom = if list.zoom > 0. { list.zoom } else { 1. };
        // SAFETY: the caller's contract.
        unsafe {
            copy(list.items, &mut self.submitted);
            copy(list.glyphs, &mut self.glyphs);
            copy(list.stops, &mut self.stops);
            copy(list.filters, &mut self.filters);
            copy(list.verbs, &mut self.verbs);
            copy(list.bytes, &mut self.bytes);
            copy(list.regions, &mut self.regions);
        }
    }

    /// After a change to `items`.
    pub fn index(&mut self) {
        self.caret = None;
        self.has_backdrops = false;
        self.has_cross_fades = self.items.iter().any(cross_fades);
        self.new_images.get_mut().clear();
        self.extents.clear();
        let mut open: Vec<usize> = Vec::new();
        let mut index = 0;
        while index < self.items.len() || !open.is_empty() {
            if index == self.items.len() {
                self.items.push(Item::Pop);
            }
            let mut extent = Extent {
                bounds: leaf_bounds(&self.items[index]),
                end: index as u32 + 1,
                mask: 0,
            };
            let mut finished = extent.bounds;
            match self.items[index] {
                Item::Backdrop { .. } => self.has_backdrops = true,
                Item::Image {
                    tile,
                    image,
                    pixelated: false,
                    ..
                } => {
                    self.new_images
                        .get_mut()
                        .push((image, [tile.rect.width, tile.rect.height]));
                }
                Item::PushClip(_)
                | Item::PushClipPath { .. }
                | Item::PushTransform(_)
                | Item::PushLayer { .. }
                | Item::PushClipOutline(_)
                | Item::PushVector(_)
                | Item::PushPattern { .. }
                | Item::PushProjection(_) => {
                    open.push(index);
                    extent.bounds = Rect::default();
                }
                Item::Mask { .. } | Item::Input => {
                    if let Some(&layer) = open.last()
                        && matches!(self.items[layer], Item::PushLayer { .. })
                        && self.extents[layer].mask == 0
                    {
                        self.extents[layer].mask = index as u32;
                    }
                }
                Item::Pop => {
                    if let Some(push) = open.pop() {
                        (extent.bounds, extent.mask) = (
                            self.extents[push].bounds,
                            open.last().map_or(0, |it| *it as u32 + 1),
                        );
                        finished = self.group_bounds(push, extent.bounds);
                        self.extents[push].bounds = finished;
                        self.extents[push].end = index as u32 + 1;
                    }
                }
                Item::Caret { rect, .. } => self.caret = Some(rect),
                _ => {}
            }
            self.extents.push(extent);
            if let Some(&parent) = open.last()
                && parent != index
                && self.extents[parent].mask == 0
            {
                self.extents[parent].bounds = union(self.extents[parent].bounds, finished);
            }
            index += 1;
        }
    }

    /// After a change to nothing but the matrix of a `PushTransform`.
    pub fn index_around(&mut self, mut push: usize) {
        loop {
            let Extent {
                bounds: content,
                mask: parent,
                ..
            } = self.extents[self.end(push) - 1];
            let bounds = self.group_bounds(push, content);
            if std::mem::replace(&mut self.extents[push].bounds, bounds) == bounds || parent == 0 {
                return;
            }
            push = parent as usize - 1;
            let pop = self.end(push) - 1;
            self.extents[pop].bounds = self.content_bounds(push);
        }
    }

    fn group_bounds(&self, push: usize, content: Rect) -> Rect {
        match self.items[push] {
            Item::PushClip(shape) => intersect(content, outset(shape.rect, 1.)),
            Item::PushClipPath { verbs, .. } => {
                let bounds = gfx::bounds(&self.path(verbs));
                let (x, y, width, height) = (bounds.x, bounds.y, bounds.width, bounds.height);
                intersect(
                    content,
                    Rect {
                        x,
                        y,
                        width,
                        height,
                    },
                )
            }
            Item::PushClipOutline(outline) => intersect(content, outline.bounds),
            Item::PushTransform([a, b, c, d, e, f]) | Item::PushVector([a, b, c, d, e, f])
                if !is_empty(content) =>
            {
                map_rect(&Transform::from_row(a, b, c, d, e, f), content)
            }
            Item::PushPattern { bounds, .. } if !is_empty(content) => bounds,
            Item::PushProjection(matrix) if !is_empty(content) => {
                Projection(matrix).map_rect(content)
            }
            Item::PushLayer {
                bounds, filters, ..
            } => {
                let (content, filters) = (
                    intersect(content, outset(bounds, 1.)),
                    self.filters(filters),
                );
                if is_empty(content) && !has_graph(filters) {
                    content
                } else {
                    filtered_bounds(content, filters)
                }
            }
            _ => content,
        }
    }

    pub fn bounds(&self, index: usize) -> Rect {
        self.extents[index].bounds
    }

    pub fn end(&self, index: usize) -> usize {
        self.extents[index].end as usize
    }

    /// What is between a `Push*` and its `Mask` or `Pop`.
    pub fn content(&self, push: usize) -> Range<usize> {
        match self.extents[push].mask {
            0 => push + 1..self.end(push) - 1,
            mask => push + 1..mask as usize,
        }
    }

    /// The indices of its `Input`s and its `Mask`.
    fn markers(&self, layer: usize) -> impl Iterator<Item = usize> {
        let (first, end) = (self.extents[layer].mask as usize, self.end(layer) - 1);
        let after_content = self.children(if first == 0 { end } else { first }..end);
        after_content.filter(|index| matches!(self.items[*index], Item::Input | Item::Mask { .. }))
    }

    pub fn mask(&self, layer: usize) -> Option<(Range<usize>, bool)> {
        self.markers(layer)
            .find_map(|index| match self.items[index] {
                Item::Mask { luminance } => Some((index + 1..self.end(layer) - 1, luminance)),
                _ => None,
            })
    }

    pub fn input(&self, layer: usize, position: usize) -> Option<Range<usize>> {
        let mut markers = self.markers(layer).skip(position);
        Some(markers.next()? + 1..markers.next().unwrap_or(self.end(layer) - 1))
    }

    /// In the space that is inside of the `Push*`.
    pub fn content_bounds(&self, push: usize) -> Rect {
        self.children(self.content(push))
            .fold(Rect::default(), |all, index| union(all, self.bounds(index)))
    }

    pub fn floats(&self, span: Span) -> Vec<f32> {
        self.bytes(span)
            .as_chunks()
            .0
            .iter()
            .map(|bytes| f32::from_ne_bytes(*bytes))
            .collect()
    }

    /// The items of `range` that are in no group of it.
    pub fn children(&self, range: Range<usize>) -> impl Iterator<Item = usize> {
        let first = Some(range.start).filter(|first| *first < range.end);
        std::iter::successors(first, move |index| {
            Some(self.end(*index)).filter(|next| *next < range.end)
        })
    }

    pub fn glyphs(&self, span: Span) -> &[Glyph] {
        get(&self.glyphs, span)
    }

    pub fn stops(&self, span: Span) -> &[GradientStop] {
        get(&self.stops, span)
    }

    pub fn filters(&self, span: Span) -> &[Filter] {
        get(&self.filters, span)
    }

    pub fn verbs(&self, span: Span) -> &[PathVerb] {
        get(&self.verbs, span)
    }

    pub fn bytes(&self, span: Span) -> &[u8] {
        get(&self.bytes, span)
    }

    pub fn path(&self, verbs: Span) -> Path {
        let mut path = Path::new();
        for verb in self.verbs(verbs) {
            match *verb {
                PathVerb::Move(to) => path.move_to(to),
                PathVerb::Line(to) => path.line_to(to),
                PathVerb::Cubic(a, b, to) => path.curve_to(a, b, to),
                PathVerb::Close => path.close(),
            };
        }
        path
    }
}

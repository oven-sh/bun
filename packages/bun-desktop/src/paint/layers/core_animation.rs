use std::collections::hash_map::Entry;
use std::ffi::c_void;
use std::ops::Range;
use std::rc::Rc;
use std::sync::{LazyLock, OnceLock};
use std::time::{Duration, Instant};

use crate::hash::FastMap;

use super::metal::{self, Buffers};
use super::{Instance, Locked, Pass, Position, Target};
use crate::paint::flatten::{Caret, Curve, Depth, Lifted, bgra};
use crate::paint::raster::{IntRect, Layer, Pixel};
use crate::platform::macos::Object;

unsafe extern "C" {
    safe fn bd_surface_create(width: i32, height: i32) -> Option<Object>;
    safe fn bd_surface_is_in_use(surface: &c_void) -> bool;
    safe fn bd_surface_contents(surface: &c_void) -> Object;
    safe fn bd_surface_was_replaced(surface: &c_void);
    safe fn bd_surface_lock(
        surface: &c_void,
        writes: bool,
        bytes_per_row: &mut usize,
    ) -> *mut c_void;
    safe fn bd_surface_unlock(surface: &c_void, wrote: bool);
    fn bd_layer_create(parent: *const c_void) -> Object;
    safe fn bd_layer_pin(corner: &c_void) -> bool;
    safe fn bd_layer_place(
        layer: &c_void,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale: f64,
        is_opaque: bool,
    );
    safe fn bd_surface_make_wide(surface: &c_void);
    safe fn bd_layer_show(layer: &c_void, surface: &c_void);
    safe fn bd_layer_blink(layer: &c_void, color: u32, seconds_ago: f64, blinks: bool);
    safe fn bd_layer_clip(layer: &c_void, radius: f64, is_smooth: bool, opacity: f32, order: f64);
    safe fn bd_layer_center(layer: &c_void, x: f64, y: f64, width: f64, height: f64, scale: f64);
    fn bd_layer_animate(
        layer: &c_void,
        fades: bool,
        samples: *const f64,
        count: usize,
        ago: f64,
        cycle: f64,
        cycles: f64,
    );
    safe fn bd_layer_set_opaque(layer: &c_void, is_opaque: bool);
    safe fn bd_layer_remove(layer: &c_void);
    safe fn bd_layers_wait();
    safe fn bd_layers_flush();
    safe fn bd_witness_create(parent: &c_void) -> Object;
    safe fn bd_witness_present(layer: &c_void, tell: extern "C" fn(f64, f64));
}

/// Until the window server cannot take it for the frame before.
pub fn wait_to_flush() {
    bd_layers_wait();
}

pub fn flush() {
    bd_layers_flush();
}

pub use metal::{
    expect_scroll, finish_and_check as gpu_has_spoiled_surfaces, note_pause, waits_for_pause,
};

pub fn uses_gpu() -> bool {
    static IS_WANTED: LazyLock<bool> =
        LazyLock::new(|| std::env::var("BUN_DESKTOP_RENDERER").as_deref() != Ok("software"));
    *IS_WANTED
}

pub struct Surface {
    size: [usize; 2],
    pub(super) texture: OnceLock<Option<Object>>,
    contents: OnceLock<Object>,
    pub(super) surface: Object,
}

impl Surface {
    fn with_pixels(rect: IntRect, bgra: &[u8]) -> Option<Surface> {
        let surface = Surface::new(rect.width() as i32, rect.height() as i32)?;
        let Locked { start, stride } = Tree::lock(&surface, true);
        for (y, row) in bgra
            .chunks(rect.width() * 4)
            .take(rect.height())
            .enumerate()
        {
            // SAFETY: the surface is locked, and has that size.
            unsafe {
                std::ptr::copy_nonoverlapping(row.as_ptr(), start.add(y * stride).cast(), row.len())
            };
        }
        Tree::unlock(&surface, true);
        Some(surface)
    }

    pub fn new(width: i32, height: i32) -> Option<Surface> {
        Some(Surface {
            size: [width as usize, height as usize],
            surface: bd_surface_create(width, height)?,
            contents: OnceLock::new(),
            texture: OnceLock::new(),
        })
    }

    pub fn make_wide(&self) {
        bd_surface_make_wide(&self.surface);
    }

    pub fn object(&self) -> &c_void {
        &self.surface
    }

    pub fn is_in_use(&self) -> bool {
        bd_surface_is_in_use(&self.surface)
    }

    /// The GPU is not drawing on it.
    pub fn rows(&self, range: Range<usize>, mut read: impl FnMut(usize, &[Pixel])) {
        let (Locked { start, stride }, [width, height]) = (Tree::lock(self, false), self.size);
        // SAFETY: the surface is locked, and has that size.
        (range.start..range.end.min(height)).for_each(|y| {
            read(y, unsafe {
                std::slice::from_raw_parts(start.add(y * stride).cast(), width)
            })
        });
        Tree::unlock(self, false);
    }

    pub fn rows_mut(&mut self, mut write: impl FnMut(usize, &mut [Pixel])) {
        let (Locked { start, stride }, [width, height]) = (Tree::lock(self, true), self.size);
        // SAFETY: likewise.
        (0..height).for_each(|y| {
            write(y, unsafe {
                std::slice::from_raw_parts_mut(start.add(y * stride).cast(), width)
            })
        });
        Tree::unlock(self, true);
    }
}

struct Overlay {
    clip: Object,
    picture: Object,
    is_above: bool,
    order: usize,
    shown: Option<Lifted>,
}

#[derive(Clone, Copy, PartialEq)]
enum Group {
    Below,
    OverBlur,
    Beside,
    Above,
}

pub struct Tree {
    overlays: Vec<Overlay>,
    /// By their contents, with how long they are kept.
    pictures: FastMap<u128, (Surface, Instant)>,
    caret: Option<(Object, Caret)>,
    witness: Option<Object>,
    /// At the top left corner.
    corner: Object,
    /// The window server takes all layers in one for changed when one comes or goes, and blurs again what is below them.
    groups: [Object; 4],
    over_blur: Range<i32>,
    /// Where `Group::Below` shows.
    holes: Vec<IntRect>,
    cells: FastMap<Position, (Object, IntRect, Group)>,
    scale: f64,
    is_opaque: bool,
    is_flipped: bool,
    buffers: Option<Buffers>,
}

impl Tree {
    pub fn new(root: *mut c_void) -> Tree {
        // SAFETY: the layer of a view.
        let corner = unsafe { bd_layer_create(root) };
        // SAFETY: a layer.
        let groups = std::array::from_fn(|_| unsafe { bd_layer_create(&*corner) });
        let (buffers, pictures, cells) = (
            uses_gpu().then(Buffers::default),
            FastMap::default(),
            FastMap::default(),
        );
        Tree {
            overlays: Vec::new(),
            pictures,
            caret: None,
            witness: None,
            corner,
            groups,
            over_blur: 0..0,
            holes: Vec::new(),
            cells,
            scale: 0.,
            is_opaque: false,
            is_flipped: false,
            buffers,
        }
    }

    fn layer_in(&self, group: Group) -> Object {
        // SAFETY: a layer.
        unsafe { bd_layer_create(&*self.groups[group as usize]) }
    }

    pub fn keep_apart(&mut self, over_blur: Range<i32>) {
        self.over_blur = over_blur;
    }

    pub fn set_holes(&mut self, holes: impl Iterator<Item = IntRect>) {
        self.holes.clear();
        self.holes.extend(holes);
    }

    fn place(&self, layer: &Object, rect: IntRect) {
        let points = |pixels: i32| f64::from(pixels) / self.scale;
        let y = if self.is_flipped {
            points(rect.top)
        } else {
            -points(rect.bottom)
        };
        let (width, height) = (
            points(rect.right - rect.left),
            points(rect.bottom - rect.top),
        );
        bd_layer_place(
            layer,
            points(rect.left),
            y,
            width,
            height,
            self.scale,
            self.is_opaque_in(rect),
        );
    }

    fn is_opaque_in(&self, rect: IntRect) -> bool {
        self.is_opaque && self.holes.iter().all(|it| !it.overlaps(rect))
    }

    pub fn begin(&mut self, scale: f64, is_opaque: bool) {
        let is_flipped = bd_layer_pin(&self.corner);
        if (scale, is_opaque, is_flipped) != (self.scale, self.is_opaque, self.is_flipped) {
            crate::diagnostics::log!(
                "layers: scale {scale}, opaque {is_opaque}, flipped {is_flipped}"
            );
            (self.scale, self.is_opaque, self.is_flipped) = (scale, is_opaque, is_flipped);
            self.cells
                .values()
                .for_each(|(layer, rect, _)| self.place(layer, *rect));
            self.show_caret(None);
            self.overlays
                .drain(..)
                .for_each(|it| bd_layer_remove(&it.clip));
        }
    }

    fn animate(&self, layer: &Object, fades: bool, curve: Option<&Curve>) {
        let ([start, cycle, cycles], samples) =
            curve.map_or(([0.; 3], &[][..]), |it| (it.timing, &it.samples));
        let (scale, up) = (self.scale, if self.is_flipped { 1. } else { -1. });
        let mut samples: Vec<_> = samples.iter().copied().map(f64::from).collect();
        for [_, _, b, c, _, e, f] in samples.as_chunks_mut().0.iter_mut().filter(|_| !fades) {
            [*b, *c, *e, *f] = [*b * up, *c * up, *e / scale, *f / scale * up];
        }
        let (ago, count) = (
            crate::surface::milliseconds(Instant::now()) - start,
            samples.len() / if fades { 2 } else { 7 },
        );
        // SAFETY: that many samples.
        unsafe {
            bd_layer_animate(
                layer,
                fades,
                samples.as_ptr(),
                count,
                ago / 1000.,
                cycle / 1000.,
                cycles,
            )
        };
    }

    /// For `show_lifted`.
    pub fn keep(&mut self, contents: u128, paint: &mut dyn FnMut() -> Option<Layer>) -> Option<()> {
        if let Entry::Vacant(entry) = self.pictures.entry(contents) {
            let layer = paint()?;
            entry.insert((
                Surface::with_pixels(layer.rect, &bgra(&layer, layer.rect))?,
                Instant::now(),
            ));
        }
        Some(())
    }

    /// Returns the contents that it keeps until the next call.
    pub fn show_lifted(&mut self, mut all: Vec<Lifted>) -> Vec<u128> {
        const MAY_COME_BACK: Duration = Duration::from_secs(20);
        all.sort_by_key(Lifted::order);
        let (mut pictures, now) = (std::mem::take(&mut self.pictures), Instant::now());
        let mut unused = std::mem::take(&mut self.overlays);
        let mut take = |lifted: &Lifted| {
            let is_same = |it: &Overlay| {
                it.shown
                    .as_ref()
                    .is_some_and(|it| (it.contents, it.depth) == (lifted.contents, lifted.depth))
            };
            unused
                .iter()
                .position(is_same)
                .map(|index| unused.swap_remove(index))
        };
        let same: Vec<_> = all.iter().map(&mut take).collect();
        let (scale, up) = (self.scale, if self.is_flipped { 1. } else { -1. });
        for (order, (mut lifted, same)) in all.into_iter().zip(same).enumerate() {
            let Lifted {
                clip,
                rect,
                contents: Some(contents),
                radius,
                is_smooth,
                opacity,
                depth,
                ..
            } = lifted
            else {
                continue;
            };
            if let Some(pixels) = lifted
                .pixels
                .take()
                .filter(|_| !pictures.contains_key(&contents))
            {
                pictures
                    .extend(Surface::with_pixels(rect, &pixels).map(|it| (contents, (it, now))));
            }
            let (is_above, unused) = (depth == Depth::Above, &mut unused);
            let other = || {
                unused
                    .iter()
                    .position(|it| it.is_above == is_above)
                    .map(|index| unused.swap_remove(index))
            };
            let mut overlay = same.or_else(other).unwrap_or_else(|| {
                let clip = self.layer_in(if is_above { Group::Above } else { Group::Below });
                // SAFETY: a layer.
                Overlay {
                    picture: unsafe { bd_layer_create(&*clip) },
                    clip,
                    is_above,
                    order,
                    shown: None,
                }
            });
            let kept = pictures.get_mut(&contents).map(|(surface, kept_until)| {
                *kept_until = if lifted.fades.is_some() || !is_above {
                    now
                } else {
                    now + MAY_COME_BACK
                };
                &*surface
            });
            let Some(surface) = lifted.drawn.as_deref().or(kept) else {
                unused.push(overlay);
                continue;
            };
            let before = overlay.shown.as_ref();
            if before.is_none_or(|it| {
                (
                    overlay.order,
                    it.clip,
                    it.rect,
                    it.radius,
                    it.is_smooth,
                    it.opacity,
                ) != (order, clip, rect, radius, is_smooth, opacity)
            }) {
                self.place(&overlay.clip, clip);
                bd_layer_clip(
                    &overlay.clip,
                    f64::from(radius) / scale,
                    is_smooth,
                    opacity,
                    order as f64,
                );
                let edge = if self.is_flipped {
                    clip.top
                } else {
                    clip.bottom
                };
                let x = f64::from(rect.left + rect.right - 2 * clip.left) / 2. / scale;
                let y = f64::from(rect.top + rect.bottom - 2 * edge) / 2. / scale * up;
                bd_layer_center(
                    &overlay.picture,
                    x,
                    y,
                    rect.width() as f64 / scale,
                    rect.height() as f64 / scale,
                    scale,
                );
            }
            if before.is_none_or(|it| {
                it.contents != lifted.contents
                    || it.drawn.as_ref().map(Rc::as_ptr) != lifted.drawn.as_ref().map(Rc::as_ptr)
            }) {
                bd_layer_show(&overlay.picture, &surface.surface);
            }
            if before.and_then(|it| it.fades.as_ref()) != lifted.fades.as_ref() {
                self.animate(&overlay.picture, true, lifted.fades.as_ref());
            }
            if before.and_then(|it| it.moves.as_ref()) != lifted.moves.as_ref() {
                self.animate(&overlay.picture, false, lifted.moves.as_ref());
            }
            (overlay.order, overlay.shown) = (order, Some(lifted));
            self.overlays.push(overlay);
        }
        unused.iter().for_each(|it| bd_layer_remove(&it.clip));
        pictures.retain(|_, (_, kept_until)| *kept_until >= now);
        self.pictures = pictures;
        self.pictures.keys().copied().collect()
    }

    pub fn show_caret(&mut self, caret: Option<Caret>) {
        let (layer, shown) = self.caret.take().unzip();
        let Some(caret) = caret else {
            return layer.iter().for_each(|layer| bd_layer_remove(layer));
        };
        let layer = layer.unwrap_or_else(|| self.layer_in(Group::Above));
        if shown.is_none_or(|it| it.rect != caret.rect) {
            self.place(&layer, caret.rect);
        }
        if shown.is_none_or(|it| {
            (it.color, it.since, it.blinks) != (caret.color, caret.since, caret.blinks)
        }) {
            bd_layer_blink(
                &layer,
                caret.color,
                caret.since.elapsed().as_secs_f64(),
                caret.blinks,
            );
        }
        self.caret = Some((layer, caret));
    }

    /// `diagnostics::was_shown` follows.
    pub fn witness(&mut self, port: IntRect) {
        let layer = self
            .witness
            .take()
            .unwrap_or_else(|| bd_witness_create(&self.groups[Group::Above as usize]));
        let (left, top) = (port.right - 1, port.top.midpoint(port.bottom));
        self.place(&layer, IntRect::new(left, top, left + 1, top + 1));
        bd_layer_set_opaque(&layer, false);
        bd_witness_present(&layer, crate::diagnostics::was_shown);
        self.witness = Some(layer);
    }

    pub fn release_memory(&mut self) {
        metal::finish();
        self.buffers
            .iter_mut()
            .for_each(|buffers| *buffers = Buffers::default());
        metal::rest();
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        metal::finish();
        bd_layer_remove(&self.corner);
    }
}

impl Target for Tree {
    type Surface = Surface;

    fn create(&mut self, width: i32, height: i32) -> Option<Surface> {
        Surface::new(width, height)
    }

    fn is_in_use(surface: &Surface) -> bool {
        bd_surface_is_in_use(&surface.surface)
    }

    fn was_replaced(surface: &Surface) {
        bd_surface_was_replaced(&surface.surface);
    }

    fn lock(surface: &Surface, writes: bool) -> Locked {
        let mut bytes_per_row = 0;
        let start = bd_surface_lock(&surface.surface, writes, &mut bytes_per_row).cast();
        Locked {
            start,
            stride: bytes_per_row / 4,
        }
    }

    fn unlock(surface: &Surface, wrote: bool) {
        bd_surface_unlock(&surface.surface, wrote);
    }

    fn can_draw(&mut self, painting_took: Duration, is_resized: bool) -> bool {
        self.buffers.is_some()
            && metal::is_ready(!is_resized || painting_took * 4 > crate::host::interval())
    }

    fn draw(&mut self, instances: &[Instance], passes: &[Pass<Surface>]) -> bool {
        self.buffers
            .as_mut()
            .is_some_and(|buffers| metal::draw(buffers, instances, passes))
    }

    fn show(&mut self, position: Position, rect: IntRect, surface: &Surface, is_opaque: bool) {
        let group = if rect.left < self.over_blur.end && self.over_blur.start < rect.right {
            Group::OverBlur
        } else {
            Group::Beside
        };
        if self.cells.get(&position).is_some_and(|it| it.2 != group) {
            self.remove(position);
        }
        let known = self.cells.remove(&position);
        let has_moved = known.as_ref().is_none_or(|(_, placed, _)| *placed != rect);
        let layer = known.map_or_else(|| self.layer_in(group), |it| it.0);
        if has_moved {
            self.place(&layer, rect);
        }
        bd_layer_show(
            &layer,
            surface
                .contents
                .get_or_init(|| bd_surface_contents(&surface.surface)),
        );
        bd_layer_set_opaque(&layer, is_opaque || self.is_opaque_in(rect));
        self.cells.insert(position, (layer, rect, group));
    }

    fn remove(&mut self, position: Position) {
        if let Some((layer, ..)) = self.cells.remove(&position) {
            bd_layer_remove(&layer);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::c_char;

    use super::*;

    fn parent(layer: &c_void) -> *const c_void {
        unsafe extern "C" {
            fn sel_registerName(name: *const c_char) -> *const c_void;
            fn objc_msgSend(to: &c_void, selector: *const c_void) -> *const c_void;
        }
        // SAFETY: a layer has that method.
        unsafe { objc_msgSend(layer, sel_registerName(c"superlayer".as_ptr())) }
    }

    #[test]
    fn what_comes_and_goes_is_no_sibling_of_what_is_over_a_blur() {
        // SAFETY: it needs no parent.
        let root = unsafe { bd_layer_create(std::ptr::null()) };
        let (mut tree, surface) = (
            Tree::new(std::ptr::from_ref(&*root).cast_mut()),
            Surface::new(64, 16).unwrap(),
        );
        tree.begin(1., false);
        tree.show((0, 0), IntRect::new(0, 0, 128, 16), &surface, false);
        tree.keep_apart(0..64);
        tree.show((0, 0), IntRect::new(0, 0, 64, 16), &surface, false);
        tree.show((64, 0), IntRect::new(64, 0, 128, 16), &surface, false);
        tree.show_caret(Some(Caret {
            rect: IntRect::new(70, 0, 71, 16),
            color: 255,
            since: Instant::now(),
            blinks: true,
        }));
        let [over, beside, above] = [
            &tree.cells[&(0, 0)].0,
            &tree.cells[&(64, 0)].0,
            &tree.caret.as_ref().unwrap().0,
        ]
        .map(|it| parent(it));
        assert!(over != beside && over != above && beside != above);
    }
}

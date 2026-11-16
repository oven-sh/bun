use std::cell::OnceCell;
use std::ffi::c_void;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use super::metal::{self, Buffers};
use super::{Instance, Locked, Pass, Position, Target};
use crate::hash::FastMap;
use crate::paint::flatten::{Curve, Lifted};
use crate::paint::raster::IntRect;
use crate::platform::macos::Object;

unsafe extern "C" {
    safe fn bd_surface_create(width: i32, height: i32) -> Option<Object>;
    safe fn bd_surface_is_in_use(surface: &c_void) -> bool;
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
    safe fn bd_layer_show(layer: &c_void, surface: &c_void);
    safe fn bd_layer_blink(layer: &c_void, color: u32, seconds_ago: f64, blinks: bool);
    safe fn bd_layer_clip(layer: &c_void, radius: f64, opacity: f32, order: f64);
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
    safe fn bd_layer_move(layer: &c_void, x: f64, y: f64);
    safe fn bd_layer_set_order(layer: &c_void, order: f64);
    safe fn bd_layer_remove(layer: &c_void);
    safe fn bd_layers_flush();
}

pub fn flush() {
    bd_layers_flush();
}

pub use metal::finish_and_check as gpu_has_spoiled_surfaces;

pub fn uses_gpu() -> bool {
    static IS_WANTED: LazyLock<bool> =
        LazyLock::new(|| std::env::var("BUN_DESKTOP_RENDERER").as_deref() != Ok("software"));
    *IS_WANTED
}

pub fn slides() -> bool {
    static IS_WANTED: LazyLock<bool> =
        LazyLock::new(|| std::env::var("BUN_DESKTOP_SLIDE").is_ok_and(|it| it != "0"));
    *IS_WANTED && uses_gpu()
}

pub struct Surface {
    pub(super) texture: OnceCell<Option<Object>>,
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

    pub(super) fn new(width: i32, height: i32) -> Option<Surface> {
        Some(Surface {
            surface: bd_surface_create(width, height)?,
            texture: OnceCell::new(),
        })
    }
}

#[derive(Clone, Copy, PartialEq)]
pub struct Caret {
    pub rect: IntRect,
    pub color: u32,
    pub since: Instant,
    pub blinks: bool,
}

struct Overlay {
    clip: Object,
    picture: Object,
    shown: Option<Lifted>,
}

pub struct Tree {
    /// With the layer at the top left corner of the window that it is in, if `corner` is somewhere else.
    clip: Option<(Object, Object)>,
    /// Like `corner`, in front of other trees.
    front: Option<Object>,
    overlays: Vec<Overlay>,
    /// By their contents, with how long they are kept.
    pictures: FastMap<u128, (Surface, Instant)>,
    caret: Option<(Object, Caret)>,
    /// At the top left corner.
    corner: Object,
    cells: FastMap<Position, (Object, IntRect)>,
    scale: f64,
    is_opaque: bool,
    is_flipped: bool,
    buffers: Option<Buffers>,
}

impl Tree {
    fn new(root: *mut c_void) -> Tree {
        // SAFETY: the layer of a view.
        let corner = unsafe { bd_layer_create(root) };
        let buffers = uses_gpu().then(Buffers::default);
        Tree {
            front: None,
            clip: None,
            overlays: Vec::new(),
            pictures: FastMap::default(),
            caret: None,
            corner,
            cells: FastMap::default(),
            scale: 0.,
            is_opaque: false,
            is_flipped: false,
            buffers,
        }
    }

    pub fn of_window(root: *mut c_void) -> Tree {
        let mut tree = Tree::new(root);
        // SAFETY: the layer of a view.
        let front = tree.front.insert(unsafe { bd_layer_create(root) });
        bd_layer_set_order(front, 3.);
        tree
    }

    pub fn clipped(root: *mut c_void, order: f64) -> Tree {
        // SAFETY: layers.
        let (outer, clip) = unsafe {
            let outer = bd_layer_create(root);
            let clip = bd_layer_create(&*outer);
            (outer, clip)
        };
        bd_layer_set_order(&outer, order);
        let mut tree = Tree::new((&raw const *clip).cast_mut());
        tree.clip = Some((outer, clip));
        tree
    }

    /// `down` pixels higher than the cells are said to be.
    pub fn show_through(&self, rect: IntRect, down: i32, radius: f32) {
        let Some((_, clip)) = &self.clip else { return };
        self.place(clip, rect);
        bd_layer_clip(clip, f64::from(radius) / self.scale, 1., 0.);
        let y = if self.is_flipped {
            -rect.top - down
        } else {
            rect.bottom + down
        };
        bd_layer_move(
            &self.corner,
            f64::from(-rect.left) / self.scale,
            f64::from(y) / self.scale,
        );
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
            self.is_opaque,
        );
    }

    pub fn begin(&mut self, scale: f64, is_opaque: bool) {
        self.front.as_ref().map(|it| bd_layer_pin(it));
        let is_flipped = bd_layer_pin(self.clip.as_ref().map_or(&self.corner, |it| &it.0));
        if (scale, is_opaque, is_flipped) != (self.scale, self.is_opaque, self.is_flipped) {
            crate::diagnostics::log!(
                "layers: scale {scale}, opaque {is_opaque}, flipped {is_flipped}"
            );
            (self.scale, self.is_opaque, self.is_flipped) = (scale, is_opaque, is_flipped);
            self.cells
                .values()
                .for_each(|(layer, rect)| self.place(layer, *rect));
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

    /// Returns the contents that it keeps until the next call.
    pub fn show_lifted(&mut self, all: Vec<Lifted>) -> Vec<u128> {
        const MAY_COME_BACK: Duration = Duration::from_secs(20);
        let (mut pictures, now) = (std::mem::take(&mut self.pictures), Instant::now());
        let mut unused = std::mem::take(&mut self.overlays);
        let mut take = |lifted: &Lifted| {
            let is_same = |it: &Overlay| {
                it.shown
                    .as_ref()
                    .is_some_and(|it| it.contents == lifted.contents)
            };
            unused
                .iter()
                .position(is_same)
                .map(|index| unused.swap_remove(index))
        };
        let same: Vec<_> = all.iter().map(&mut take).collect();
        let (scale, up) = (self.scale, if self.is_flipped { 1. } else { -1. });
        for (mut lifted, same) in all.into_iter().zip(same) {
            let Lifted {
                item,
                clip,
                rect,
                contents: Some(contents),
                radius,
                opacity,
                ..
            } = lifted
            else {
                continue;
            };
            let clip = if clip.is_empty() {
                IntRect::default()
            } else {
                clip
            };
            if let Some(pixels) = lifted
                .pixels
                .take()
                .filter(|_| !pictures.contains_key(&contents))
            {
                pictures
                    .extend(Surface::with_pixels(rect, &pixels).map(|it| (contents, (it, now))));
            }
            let mut overlay = same.or_else(|| unused.pop()).unwrap_or_else(|| {
                // SAFETY: layers.
                let clip =
                    unsafe { bd_layer_create(&**self.front.as_ref().unwrap_or(&self.corner)) };
                // SAFETY: as above.
                Overlay {
                    picture: unsafe { bd_layer_create(&*clip) },
                    clip,
                    shown: None,
                }
            });
            let Some((surface, kept_until)) = pictures.get_mut(&contents) else {
                unused.push(overlay);
                continue;
            };
            *kept_until = if lifted.fades.is_some() {
                now
            } else {
                now + MAY_COME_BACK
            };
            let before = overlay.shown.as_ref();
            if before.is_none_or(|it| {
                (it.item, it.clip, it.rect, it.radius, it.opacity)
                    != (item, clip, rect, radius, opacity)
            }) {
                self.place(&overlay.clip, clip);
                bd_layer_clip(
                    &overlay.clip,
                    f64::from(radius) / scale,
                    opacity,
                    1. + item as f64,
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
            if before.is_none_or(|it| it.contents != lifted.contents) {
                bd_layer_show(&overlay.picture, &surface.surface);
            }
            if before.and_then(|it| it.fades.as_ref()) != lifted.fades.as_ref() {
                self.animate(&overlay.picture, true, lifted.fades.as_ref());
            }
            if before.and_then(|it| it.moves.as_ref()) != lifted.moves.as_ref() {
                self.animate(&overlay.picture, false, lifted.moves.as_ref());
            }
            overlay.shown = Some(lifted);
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
        // SAFETY: a layer.
        let layer = layer.unwrap_or_else(|| unsafe {
            bd_layer_create(&**self.front.as_ref().unwrap_or(&self.corner))
        });
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
        bd_layer_remove(self.clip.as_ref().map_or(&self.corner, |it| &it.0));
        self.front.iter().for_each(|it| bd_layer_remove(it));
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

    fn can_draw(&mut self) -> bool {
        self.buffers.is_some() && metal::is_ready()
    }

    fn draw(&mut self, instances: &[Instance], passes: &[Pass<Surface>]) -> bool {
        self.buffers
            .as_mut()
            .is_some_and(|buffers| metal::draw(buffers, instances, passes))
    }

    fn show(&mut self, position: Position, rect: IntRect, surface: &Surface) {
        let known = self.cells.remove(&position);
        let has_moved = known.as_ref().is_none_or(|(_, placed)| *placed != rect);
        // SAFETY: a layer.
        let layer = known.map_or_else(
            || unsafe { bd_layer_create(&*self.corner) },
            |(layer, _)| layer,
        );
        if has_moved {
            self.place(&layer, rect);
        }
        bd_layer_show(&layer, &surface.surface);
        self.cells.insert(position, (layer, rect));
    }

    fn remove(&mut self, position: Position) {
        if let Some((layer, _)) = self.cells.remove(&position) {
            bd_layer_remove(&layer);
        }
    }
}

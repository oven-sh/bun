use std::cell::OnceCell;
use std::ptr::null_mut;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CGPoint, CGRect, CGSize};
use objc2_core_graphics::kCGColorSpaceSRGB;
use objc2_foundation::{NSDictionary, NSNull, NSString};
use objc2_io_surface::{
    IOSurfaceLockOptions, IOSurfaceRef, kIOSurfaceBytesPerElement, kIOSurfaceBytesPerRow,
    kIOSurfaceColorSpace, kIOSurfaceHeight, kIOSurfacePixelFormat, kIOSurfaceWidth,
};
use objc2_metal::MTLTexture;
use objc2_quartz_core::{CAAction, CAAutoresizingMask, CAEdgeAntialiasingMask, CALayer};
use rustc_hash::FxHashMap;

use super::metal::{self, Buffers};
use super::{Instance, Locked, Pass, Position, Target};
use crate::paint::raster::IntRect;

pub struct Surface {
    pub(super) surface: CFRetained<IOSurfaceRef>,
    pub(super) texture: OnceCell<Option<Retained<ProtocolObject<dyn MTLTexture>>>>,
}

impl Surface {
    pub(super) fn new(width: i32, height: i32) -> Option<Surface> {
        let values =
            [width, height, 4, width * 4, i32::from_be_bytes(*b"BGRA")].map(CFNumber::new_i32);
        // SAFETY: the framework's keys, each with a value of the type that it documents.
        let surface = unsafe {
            let keys = [
                kIOSurfaceWidth,
                kIOSurfaceHeight,
                kIOSurfaceBytesPerElement,
                kIOSurfaceBytesPerRow,
                kIOSurfacePixelFormat,
            ];
            let properties =
                CFDictionary::from_slices(&keys, &values.each_ref().map(|value| &**value));
            let surface = IOSurfaceRef::new(properties.as_opaque())?;
            surface.set_value(kIOSurfaceColorSpace, kCGColorSpaceSRGB);
            surface
        };
        Some(Surface {
            surface,
            texture: OnceCell::new(),
        })
    }
}

fn lock_options(writes: bool) -> IOSurfaceLockOptions {
    if writes {
        IOSurfaceLockOptions::empty()
    } else {
        IOSurfaceLockOptions::ReadOnly
    }
}

fn layer_without_animations() -> Retained<CALayer> {
    let (layer, nothing) = (CALayer::new(), NSNull::null());
    let keys = [
        "bounds",
        "contents",
        "contentsScale",
        "onOrderIn",
        "onOrderOut",
        "position",
        "sublayers",
    ]
    .map(NSString::from_str);
    let nothing: &ProtocolObject<dyn CAAction> = ProtocolObject::from_ref(&*nothing);
    layer.setActions(Some(&NSDictionary::from_slices(
        &keys.each_ref().map(|key| &**key),
        &[nothing; 7],
    )));
    layer.setAnchorPoint(CGPoint::ZERO);
    layer
}

pub struct Tree {
    root: Retained<CALayer>,
    /// At the top left corner.
    corner: Retained<CALayer>,
    cells: FxHashMap<Position, (Retained<CALayer>, IntRect)>,
    scale: f64,
    is_opaque: bool,
    is_flipped: bool,
    buffers: Option<Buffers>,
}

impl Tree {
    pub fn new(root: Retained<CALayer>, uses_gpu: bool) -> Tree {
        let corner = layer_without_animations();
        root.addSublayer(&corner);
        let buffers = uses_gpu.then(Buffers::default);
        Tree {
            root,
            corner,
            cells: FxHashMap::default(),
            scale: 0.,
            is_opaque: false,
            is_flipped: false,
            buffers,
        }
    }

    fn place(&self, layer: &CALayer, rect: IntRect) {
        let points = |pixels: i32| f64::from(pixels) / self.scale;
        let size = CGSize::new(
            points(rect.right - rect.left),
            points(rect.bottom - rect.top),
        );
        let y = if self.is_flipped {
            points(rect.top)
        } else {
            -points(rect.bottom)
        };
        layer.setFrame(CGRect::new(CGPoint::new(points(rect.left), y), size));
        layer.setContentsScale(self.scale);
        layer.setOpaque(self.is_opaque);
    }

    pub fn begin(&mut self, scale: f64, is_opaque: bool) {
        let is_flipped = self.root.contentsAreFlipped();
        let corner = CGPoint::new(
            0.,
            if is_flipped {
                0.
            } else {
                self.root.bounds().size.height
            },
        );
        if self.corner.position() != corner {
            self.corner.setPosition(corner);
        }
        if (scale, is_opaque, is_flipped) != (self.scale, self.is_opaque, self.is_flipped) {
            log::info!(
                "layers: scale {scale}, opaque {is_opaque}, flipped {is_flipped}, corner {corner:?}"
            );
            (self.scale, self.is_opaque, self.is_flipped) = (scale, is_opaque, is_flipped);
            let flexible = [
                CAAutoresizingMask::LayerMinYMargin,
                CAAutoresizingMask::LayerMaxYMargin,
            ];
            self.corner
                .setAutoresizingMask(flexible[usize::from(is_flipped)]);
            self.cells
                .values()
                .for_each(|(layer, rect)| self.place(layer, *rect));
        }
    }

    pub fn release_memory(&mut self) {
        self.buffers
            .iter_mut()
            .for_each(|buffers| *buffers = Buffers::default());
    }
}

impl Target for Tree {
    type Surface = Surface;

    fn create(&mut self, width: i32, height: i32) -> Option<Surface> {
        Surface::new(width, height)
    }

    fn is_in_use(surface: &Surface) -> bool {
        surface.surface.is_in_use()
    }

    fn lock(Surface { surface, .. }: &Surface, writes: bool) -> Locked {
        // SAFETY: the seed is optional.
        unsafe { surface.lock(lock_options(writes), null_mut()) };
        Locked {
            start: surface.base_address().as_ptr().cast(),
            stride: surface.bytes_per_row() / 4,
        }
    }

    fn unlock(surface: &Surface, wrote: bool) {
        // SAFETY: as above.
        unsafe { surface.surface.unlock(lock_options(wrote), null_mut()) };
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
        let layer = known.map(|(layer, _)| layer).unwrap_or_else(|| {
            let layer = layer_without_animations();
            layer.setEdgeAntialiasingMask(CAEdgeAntialiasingMask::empty());
            self.corner.addSublayer(&layer);
            layer
        });
        if has_moved {
            self.place(&layer, rect);
        }
        // SAFETY: an `IOSurfaceRef` is an object, and one of those that a layer can show.
        unsafe {
            layer.setContents(Some(
                CFRetained::as_ptr(&surface.surface)
                    .cast::<AnyObject>()
                    .as_ref(),
            ))
        };
        self.cells.insert(position, (layer, rect));
    }

    fn remove(&mut self, position: Position) {
        if let Some((layer, _)) = self.cells.remove(&position) {
            layer.removeFromSuperlayer();
        }
    }
}

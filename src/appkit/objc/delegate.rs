//! The Objective-C class defined at run time so MetalKit has something to
//! call: an `MTKViewDelegate`. Delegate instances carry one `owner` ivar
//! pointing at a reference-counted Rust trait object; the `extern "C"` IMPs
//! below do nothing but forward. (The application delegate is the script's,
//! defined through the bridge.)

use std::sync::OnceLock;

use super::{ClassBuilder, Delegate, DelegateClass, Obj, Sel, This, sel};
use crate::geometry::Size;
use crate::objc::foundation::NSObject;

/// `MTKViewDelegate`. Both run on the main thread: from the view's display
/// timer inside AppKit event dispatch, or synchronously from `-[MTKView draw]`.
pub(crate) trait MetalViewEvents {
    /// `drawInMTKView:`.
    fn draw(&self);
    /// `mtkView:drawableSizeWillChange:`, in pixels.
    fn drawable_size_will_change(&self, size: Size);
}

// SAFETY (every `.method(...)` below): each IMP's signature transcribes the
// named protocol's (or overridden superclass's) declaration of that selector,
// which debug builds assert.

fn metal_view_class() -> &'static DelegateClass<dyn MetalViewEvents> {
    static CLASS: OnceLock<DelegateClass<dyn MetalViewEvents>> = OnceLock::new();
    // SAFETY: see above; `MTKViewDelegate` (MTKView.h) declares
    // `drawInMTKView:(MTKView *)` and `mtkView:(MTKView *) drawableSizeWillChange:(CGSize)`.
    CLASS.get_or_init(|| unsafe {
        ClassBuilder::<NSObject>::new(c"BunAppKitMetalDelegate")
            .owned::<dyn MetalViewEvents>()
            .protocol(c"MTKViewDelegate")
            .method(
                sel!("drawInMTKView:"),
                mtk_draw as extern "C" fn(Mtk, Sel, Obj),
            )
            .method(
                sel!("mtkView:drawableSizeWillChange:"),
                mtk_drawable_size_will_change as extern "C" fn(Mtk, Sel, Obj, Size),
            )
            .register()
    })
}

/// Registers every class this file defines, so the check of each IMP
/// against its protocol or superclass declaration runs now.
pub(super) fn register_all() {
    metal_view_class();
}

impl Delegate<dyn MetalViewEvents> {
    pub(crate) fn metal_view(handler: Box<dyn MetalViewEvents>) -> Self {
        Delegate::new(metal_view_class(), handler)
    }
}

type Mtk = This<dyn MetalViewEvents>;

// SAFETY (mtk): `metal_view_class()` above is the only `DelegateClass` for
// its handler, so a `This<H>` can only have come from an IMP registered on
// it. MetalKit calls on the main thread; `dispatch` handles a cleared owner.

fn mtk<R>(this: Mtk, f: impl FnOnce(&(dyn MetalViewEvents + 'static)) -> R) -> Option<R> {
    // SAFETY: see above.
    unsafe { metal_view_class().dispatch(this, f) }
}

extern "C" fn mtk_draw(this: Mtk, _: Sel, _view: Obj) {
    let _ = mtk(this, |h| h.draw());
}
extern "C" fn mtk_drawable_size_will_change(this: Mtk, _: Sel, _view: Obj, size: Size) {
    let _ = mtk(this, |h| h.drawable_size_will_change(size));
}

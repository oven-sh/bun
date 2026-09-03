//! Natives behind `bun:objc` and `bun:appkit`, all wrapping `bun_appkit`:
//! `ObjCObject`/`ObjCClass`/`ObjCSelector` and the `objc*` functions are the
//! Objective-C bridge (`bun:objc`, `src/js/bun/objc.ts`) that windows, menus and
//! views are built with in `src/js/bun/appkit.ts`; `AppKitApp` is the NSApplication lifecycle and the
//! event-loop integration; `AppKitView` is the Metal view; `gpu` plus the
//! `Gpu*` classes are the Metal layer. macOS only: `AppKit.classes.ts` marks
//! the classes `platform: "darwin"`, so other targets generate none of them.

mod app;
mod conv;
mod gpu;
mod objc;
mod slots;
mod view;

pub use self::gpu::{
    AppKitGpu, GpuBuffer, GpuComputePipeline, GpuDepthStencil, GpuFrame, GpuFunction, GpuLibrary,
    GpuRenderPipeline, GpuSampler, GpuTexture,
};
pub use self::objc::{ObjCClass, ObjCFunction, ObjCKeeper, ObjCObject, ObjCSelector};
pub use self::{app::AppKitApp, view::AppKitView};

use bun_jsc::{JSGlobalObject, JSValue};

/// `$rust("appkit.rs", "createObjcBinding")`: `{ ObjCObject, ObjCClass,
/// ObjCSelector, objc* }` for `src/js/bun/objc.ts` (`bun:objc`). Loads nothing;
/// Foundation loads on the first `objc*` call that needs it.
pub fn create_objc_binding(global: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global);
    objc::install(global, binding);
    binding.put(global, b"app", AppKitApp::create(global));
    binding
}

/// `$rust("appkit.rs", "createBinding")`: `{ AppKitView, gpu, Gpu* }`
/// for `src/js/bun/appkit.ts`. Loads nothing; AppKit starts on
/// `app.start()` and Metal on the first `gpu` call that needs the device.
pub fn create_binding(global: &JSGlobalObject) -> JSValue {
    use bun_jsc::JsClass as _;
    let binding = JSValue::create_empty_object_with_null_prototype(global);
    binding.put(global, b"AppKitView", AppKitView::get_constructor(global));
    binding.put(global, b"gpu", AppKitGpu::create(global));
    binding.put(global, b"GpuBuffer", GpuBuffer::get_constructor(global));
    binding.put(global, b"GpuTexture", GpuTexture::get_constructor(global));
    binding.put(global, b"GpuLibrary", GpuLibrary::get_constructor(global));
    binding.put(global, b"GpuFunction", GpuFunction::get_constructor(global));
    binding.put(
        global,
        b"GpuRenderPipeline",
        GpuRenderPipeline::get_constructor(global),
    );
    binding.put(
        global,
        b"GpuComputePipeline",
        GpuComputePipeline::get_constructor(global),
    );
    binding.put(global, b"GpuSampler", GpuSampler::get_constructor(global));
    binding.put(
        global,
        b"GpuDepthStencil",
        GpuDepthStencil::get_constructor(global),
    );
    binding.put(global, b"GpuFrame", GpuFrame::get_constructor(global));
    binding
}

//! Natives behind `bun:objc` and `bun:appkit`, all wrapping `bun_appkit`:
//! `ObjCObject`/`ObjCClass`/`ObjCSelector` and the `objc*` functions are the
//! Objective-C bridge (`bun:objc`, `src/js/bun/objc.ts`) that windows, menus and
//! views are built with in `src/js/bun/appkit.ts`; `AppKitApp` is the NSApplication lifecycle and the
//! event-loop integration; `AppKitView` is the Metal view; `gpu` plus the
//! `Gpu*` classes are the Metal layer. On other platforms the classes exist
//! so the generated bindings link, but the module throws before any of them
//! can be constructed.

#[cfg(target_os = "macos")]
mod app;
#[cfg(target_os = "macos")]
mod conv;
#[cfg(target_os = "macos")]
mod gpu;
#[cfg(target_os = "macos")]
mod objc;
#[cfg(target_os = "macos")]
mod slots;
#[cfg(target_os = "macos")]
mod view;

#[cfg(target_os = "macos")]
pub use self::gpu::{
    AppKitGpu, GpuBuffer, GpuComputePipeline, GpuDepthStencil, GpuFrame, GpuFunction, GpuLibrary,
    GpuRenderPipeline, GpuSampler, GpuTexture,
};
#[cfg(target_os = "macos")]
pub use self::objc::{ObjCClass, ObjCFunction, ObjCKeeper, ObjCObject, ObjCSelector};
#[cfg(target_os = "macos")]
pub use self::{app::AppKitApp, view::AppKitView};
#[cfg(not(target_os = "macos"))]
pub use unsupported::{
    AppKitApp, AppKitGpu, AppKitView, GpuBuffer, GpuComputePipeline, GpuDepthStencil, GpuFrame,
    GpuFunction, GpuLibrary, GpuRenderPipeline, GpuSampler, GpuTexture, ObjCClass, ObjCFunction,
    ObjCKeeper, ObjCObject, ObjCSelector,
};

use bun_jsc::{JSGlobalObject, JSValue};

/// `$rust("appkit.rs", "createObjcBinding")`: `{ ObjCObject, ObjCClass,
/// ObjCSelector, objc* }` for `src/js/bun/objc.ts` (`bun:objc`). Loads nothing;
/// Foundation loads on the first `objc*` call that needs it.
#[cfg(target_os = "macos")]
pub fn create_objc_binding(global: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global);
    objc::install(global, binding);
    binding.put(global, b"app", AppKitApp::create(global));
    binding
}

/// `$rust("appkit.rs", "createBinding")`: `{ AppKitView, gpu, Gpu* }`
/// for `src/js/bun/appkit.ts`. Loads nothing; AppKit starts on
/// `app.start()` and Metal on the first `gpu` call that needs the device.
#[cfg(target_os = "macos")]
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

#[cfg(not(target_os = "macos"))]
pub fn create_objc_binding(_global: &JSGlobalObject) -> JSValue {
    JSValue::UNDEFINED
}

#[cfg(not(target_os = "macos"))]
pub fn create_binding(_global: &JSGlobalObject) -> JSValue {
    JSValue::UNDEFINED
}

#[cfg(not(target_os = "macos"))]
mod unsupported {
    use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult};

    fn unavailable(global: &JSGlobalObject) -> JsError {
        global.throw(format_args!("AppKit is only available on macOS"))
    }

    /// Stamps out the host functions the generated bindings call. None is
    /// reachable: nothing can construct these classes off macOS.
    macro_rules! stub {
        (
            $(#[$attr:meta])* $name:ident {
                methods: [$($method:ident),* $(,)?],
                getters: [$($getter:ident),* $(,)?]
                $(, setters: [$($setter:ident),* $(,)?])?
            }
        ) => {
            $(#[$attr])*
            pub struct $name {
                _unused: u8,
            }

            impl $name {
                $(
                    pub fn $method(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
                        Ok(JSValue::UNDEFINED)
                    }
                )*
                $(
                    pub fn $getter(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
                        Ok(JSValue::UNDEFINED)
                    }
                )*
                $($(
                    pub fn $setter(&self, _global: &JSGlobalObject, _value: JSValue) -> JsResult<()> {
                        Ok(())
                    }
                )*)?
            }
        };
    }

    stub!(
        #[bun_jsc::JsClass]
        AppKitView {
            methods: [set, draw],
            getters: [get_drawable_size, get_on_frame, get_on_resize, get_native]
        }
    );

    impl AppKitView {
        pub fn constructor(
            global: &JSGlobalObject,
            _frame: &CallFrame,
            _this: JSValue,
        ) -> JsResult<Box<AppKitView>> {
            Err(unavailable(global))
        }
    }

    stub!(
        #[bun_jsc::JsClass(no_constructor)]
        AppKitApp {
            methods: [start, launched, quit_accepted, exit_now, hold, testing],
            getters: [get_started]
        }
    );

    stub!(
        #[bun_jsc::JsClass(no_constructor)]
        AppKitGpu {
            methods: [
                register_errors,
                buffer,
                texture,
                library,
                render_pipeline,
                compute_pipeline,
                sampler,
                depth_stencil,
                frame
            ],
            getters: [get_available, get_name, get_unified_memory]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuBuffer {
            methods: [write, read, destroy],
            getters: [
                get_byte_length,
                get_storage,
                get_in_flight,
                get_destroyed,
                get_label
            ],
            setters: [set_label]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuTexture {
            methods: [replace, read_pixels, destroy],
            getters: [
                get_width,
                get_height,
                get_format,
                get_in_flight,
                get_destroyed,
                get_label
            ],
            setters: [set_label]
        }
    );

    impl GpuBuffer {
        pub fn estimated_size(&self) -> usize {
            core::mem::size_of::<GpuBuffer>()
        }
    }

    impl GpuTexture {
        pub fn estimated_size(&self) -> usize {
            core::mem::size_of::<GpuTexture>()
        }
    }

    stub!(
        #[bun_jsc::JsClass]
        GpuLibrary {
            methods: [function],
            getters: [get_function_names, get_label],
            setters: [set_label]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuFunction {
            methods: [],
            getters: [get_name, get_type]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuRenderPipeline {
            methods: [],
            getters: [get_label, get_color_formats, get_depth_format]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuComputePipeline {
            methods: [],
            getters: [
                get_label,
                get_max_total_threads_per_threadgroup,
                get_thread_execution_width
            ]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuSampler {
            methods: [],
            getters: [get_label]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuDepthStencil {
            methods: [],
            getters: [get_label]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        GpuFrame {
            methods: [
                render_pass,
                pipeline,
                vertex_buffer,
                vertex_bytes,
                vertex_texture,
                fragment_buffer,
                fragment_bytes,
                fragment_texture,
                fragment_sampler,
                viewport,
                scissor,
                cull,
                winding,
                depth_stencil,
                draw,
                draw_indexed,
                compute_pass,
                buffer,
                bytes,
                texture,
                sampler,
                dispatch,
                dispatch_groups,
                blit,
                copy_buffer,
                generate_mipmaps,
                push_debug_group,
                pop_debug_group,
                end,
                commit,
                commit_and_wait
            ],
            getters: [
                get_committed,
                get_state,
                get_gpu_status,
                get_error,
                get_label
            ],
            setters: [set_label]
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        ObjCObject {
            methods: [msg_send, release, to_string],
            getters: [get_class_name, get_address, get_released]
        }
    );

    impl ObjCObject {
        pub fn estimated_size(&self) -> usize {
            core::mem::size_of::<ObjCObject>()
        }
    }

    stub!(
        #[bun_jsc::JsClass]
        ObjCClass {
            methods: [msg_send, to_string],
            getters: [get_name, get_address]
        }
    );

    stub!(
        #[bun_jsc::JsClass(no_constructor)]
        ObjCKeeper {
            methods: [],
            getters: []
        }
    );

    impl ObjCKeeper {
        pub fn has_pending_activity(&self) -> bool {
            false
        }
    }

    stub!(
        #[bun_jsc::JsClass(no_constructor)]
        ObjCFunction {
            methods: [call],
            getters: []
        }
    );

    stub!(
        #[bun_jsc::JsClass]
        ObjCSelector {
            methods: [to_string],
            getters: [get_name]
        }
    );

    macro_rules! not_constructible {
        ($($name:ident),*) => {$(
            impl $name {
                pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<$name>> {
                    Err(unavailable(global))
                }
            }
        )*};
    }
    not_constructible!(
        GpuBuffer,
        GpuTexture,
        GpuLibrary,
        GpuFunction,
        GpuRenderPipeline,
        GpuComputePipeline,
        GpuSampler,
        GpuDepthStencil,
        GpuFrame,
        ObjCObject,
        ObjCClass,
        ObjCSelector
    );
}

//! `cfg(bun_standalone)` replacement for `mod bake`.
//!
//! The full `bake/` tree pulls in `bun_bundler::bundle_v2` (→ `bun_css`) via
//! `DevServer` → `IncrementalGraph` → `BundleV2` → `Chunk`. Under
//! `bun-standalone` none of that is reachable from JS (every entry point throws
//! "not available in standalone executables"), so this stub provides only the
//! type names the rest of `bun_runtime` mentions in signatures plus the
//! `#[no_mangle]` C-ABI symbols the shared C++ archive references
//! unconditionally. Every type that would otherwise carry a bundler payload is
//! uninhabited, so `Option<Box<DevServer>>` etc. become ZSTs and the
//! `if let Some(dev) = …` bodies are statically dead (gated at the use sites).

#![allow(dead_code, unused_variables, clippy::missing_safety_doc)]

use bun_core::String as BunString;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use core::ffi::c_void;

// ─── DevServer ───────────────────────────────────────────────────────────────
pub mod dev_server {
    /// Uninhabited — `Option<Box<DevServer>>` is a ZST under standalone.
    pub enum DevServer {}

    pub mod route_bundle {
        /// `DevServer.RouteBundle.Index` — only stored in
        /// `HTMLBundle::Route::dev_server_id` (always `None` under standalone).
        #[derive(Clone, Copy)]
        pub struct Index(u32);
    }

    /// Uninhabited — never enqueued under standalone (no `DevServer` exists to
    /// own a `WatcherAtomics`).
    pub enum HotReloadEvent {}
    impl HotReloadEvent {
        pub unsafe fn run(_: *mut Self) {
            unreachable!("bake DevServer is not available in standalone executables")
        }
    }

    pub mod source_map_store {
        pub enum SourceMapStore {}
        impl SourceMapStore {
            pub fn sweep_weak_refs(
                _t: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
                _now: &bun_event_loop::EventLoopTimer::Timespec,
            ) {
                unreachable!("bake DevServer is not available in standalone executables")
            }
        }
    }

    impl DevServer {
        pub fn emit_memory_visualizer_message_timer(
            _t: &mut bun_event_loop::EventLoopTimer::EventLoopTimer,
            _now: &bun_event_loop::EventLoopTimer::Timespec,
        ) {
            unreachable!("bake DevServer is not available in standalone executables")
        }
    }
}
pub use dev_server as DevServer;

// ─── FrameworkRouter ─────────────────────────────────────────────────────────
pub mod framework_router {
    use super::*;

    /// `FrameworkRouter.Type.Index` — `AnyRoute::FrameworkRouter` is cfg-gated
    /// out under standalone, so this is signature-only.
    #[derive(Clone, Copy)]
    pub struct TypeIndex(u8);

    /// `JSFrameworkRouter` — backing type for the `FrameworkFileSystemRouter`
    /// codegen class. Never constructed under standalone; the constructor
    /// throws and `m_ctx` stays null.
    pub struct JSFrameworkRouter(());

    impl JSFrameworkRouter {
        pub fn constructor(
            global: &JSGlobalObject,
            _frame: &CallFrame,
        ) -> JsResult<Box<JSFrameworkRouter>> {
            Err(global.throw(format_args!(
                "FrameworkFileSystemRouter is not available in standalone executables. Install Bun: https://bun.com/get"
            )))
        }
        pub fn finalize(self: Box<Self>) {}
        pub fn r#match(
            &self,
            global: &JSGlobalObject,
            _frame: &CallFrame,
        ) -> JsResult<JSValue> {
            Err(global.throw(format_args!(
                "FrameworkFileSystemRouter is not available in standalone executables"
            )))
        }
        pub fn to_json(
            &self,
            global: &JSGlobalObject,
            _frame: &CallFrame,
        ) -> JsResult<JSValue> {
            Err(global.throw(format_args!(
                "FrameworkFileSystemRouter is not available in standalone executables"
            )))
        }
        /// `js2native` thunk target (`generated_js2native.rs`).
        pub fn get_bindings(global: &JSGlobalObject) -> JsResult<JSValue> {
            // `bun:internal-for-testing` only — return undefined rather than
            // throwing so the import itself succeeds.
            let _ = global;
            Ok(JSValue::UNDEFINED)
        }
    }

    /// `generated_js2native.rs` lowers the path to
    /// `framework_router::js_framework_router::get_bindings`.
    pub use JSFrameworkRouter as js_framework_router;
}

// ─── extern "C" exports the shared C++ archive references ────────────────────
// Signatures mirror the `cfg(bun_standalone)` stubs that previously lived in
// `bake/production.rs` / `bake/DevServer.rs`. Bodies are unreachable because
// `BakeGlobalObject__attachPerThreadData` is never called.

#[unsafe(no_mangle)]
pub extern "C" fn BakeToWindowsPath(_input: BunString) -> BunString {
    BunString::dead()
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeProdResolve(
    _global: &JSGlobalObject,
    _a_str: BunString,
    _specifier_str: BunString,
) -> BunString {
    BunString::dead()
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeProdLoad(_pt: *mut c_void, _key: BunString) -> BunString {
    BunString::dead()
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeProdSourceMap(_pt: *mut c_void, _key: BunString) -> BunString {
    BunString::dead()
}

bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bake__bundleNewRouteJSFunctionImpl(
        global: &JSGlobalObject,
        _request_ptr: *mut c_void,
        _route_kind: u8,
        _route_index: u32,
    ) -> JSValue {
        let _ = global.throw(format_args!(
            "Bake is not available in standalone executables. Install Bun: https://bun.com/get"
        ));
        JSValue::ZERO
    }
}

#[bun_jsc::host_fn(export = "Bake__getNewRouteParamsJSFunctionImpl")]
fn bake_get_new_route_params_stub(global: &JSGlobalObject, _cf: &CallFrame) -> JsResult<JSValue> {
    Err(global.throw(format_args!(
        "Bake is not available in standalone executables. Install Bun: https://bun.com/get"
    )))
}

// ─── extern "Rust" link-interface stubs ──────────────────────────────────────
// `bun_bundler::link_interface!(DevServerHandle[Bake] { ... })` emits
// `extern "Rust"` declarations for the symbols below; the real impls live in
// `bake/dev_server/mod.rs` (compiled out under standalone). Release links drop
// the dead `BundleV2` callers via `--gc-sections` so the undefined refs never
// reach the linker, but debug builds have no gc-sections — provide unreachable
// stubs so the symbols resolve. Signatures are deliberately erased: the Rust
// ABI matches by symbol name only and none of these are reachable at runtime.
macro_rules! dev_server_dispatch_stub {
    ($($sym:ident),* $(,)?) => {$(
        #[unsafe(no_mangle)]
        fn $sym() -> ! {
            unreachable!("bake DevServer is not available in standalone executables")
        }
    )*};
}
dev_server_dispatch_stub!(
    __bun_dispatch__DevServerHandle__Bake__asset_hash,
    __bun_dispatch__DevServerHandle__Bake__barrel_needed_exports,
    __bun_dispatch__DevServerHandle__Bake__current_bundle_start_data,
    __bun_dispatch__DevServerHandle__Bake__finalize_bundle,
    __bun_dispatch__DevServerHandle__Bake__handle_parse_task_failure,
    __bun_dispatch__DevServerHandle__Bake__is_file_cached,
    __bun_dispatch__DevServerHandle__Bake__log_for_resolution_failures,
    __bun_dispatch__DevServerHandle__Bake__put_or_overwrite_asset,
    __bun_dispatch__DevServerHandle__Bake__register_barrel_export,
    __bun_dispatch__DevServerHandle__Bake__register_barrel_with_deferrals,
    __bun_dispatch__DevServerHandle__Bake__track_resolution_failure,
);

#[unsafe(no_mangle)]
fn __bun_jsc_enable_hot_module_reloading_for_bundler() -> ! {
    unreachable!("bun build --watch is not available in standalone executables")
}

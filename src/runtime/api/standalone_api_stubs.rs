//! `cfg(bun_standalone)` replacement for `Bun.FileSystemRouter`.
//!
//! `bun_router` + the directory-walk machinery are not useful inside a compiled
//! executable (the route table was decided at build time). The codegen-emitted
//! `#[no_mangle]` thunks in `generated_classes.rs` reference these types by
//! path and call their inherent methods, so the stub provides a unit struct
//! with the exact method set the codegen calls — `constructor` throws, every
//! other method is unreachable (constructor failure means `m_ctx` stays null
//! and prototype methods never receive a live `&Self`). This keeps every
//! C++-referenced symbol linkable without compiling the real implementation.

#![allow(dead_code, unused_variables, clippy::missing_safety_doc)]

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

#[cold]
fn unavailable(global: &JSGlobalObject, name: &str) -> bun_jsc::JsError {
    global.throw(format_args!(
        "{name} is not available in standalone executables. Install Bun: https://bun.com/get"
    ))
}

/// Body for prototype methods / getters on a never-constructed stub: the
/// codegen thunk passes `&Self` from a non-null `m_ctx`, but `constructor`
/// always throws, so no `m_ctx` is ever populated.
macro_rules! never {
    () => {
        unreachable!("constructor throws under bun_standalone; m_ctx is never set")
    };
}

// ─── Bun.FileSystemRouter / MatchedRoute ─────────────────────────────────────
pub mod filesystem_router {
    use super::*;

    // `FrameworkFileSystemRouter` is declared in `filesystem_router.classes.ts`,
    // so codegen resolves it via this module. The real backing type already has
    // a standalone stub in `bake_standalone_stub.rs`.
    pub use crate::bake::framework_router::JSFrameworkRouter as FrameworkFileSystemRouter;

    pub struct FileSystemRouter(());

    bun_jsc::impl_js_class_via_generated!(
        FileSystemRouter => crate::generated_classes::js_FileSystemRouter
    );

    impl FileSystemRouter {
        pub fn constructor(g: &JSGlobalObject, _: &CallFrame) -> JsResult<Box<Self>> {
            Err(unavailable(g, "Bun.FileSystemRouter"))
        }
        pub fn finalize(self: Box<Self>) {}
        pub fn r#match(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn reload(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn get_origin(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_routes(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_style(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
    }

    pub struct MatchedRoute(());

    impl MatchedRoute {
        pub fn finalize(self: Box<Self>) {}
        pub fn get_file_path(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_kind(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_name(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_params(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_pathname(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_query(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_script_src(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
    }
}

//! `cfg(bun_standalone)` replacements for `Bun.Transpiler` / `Bun.FileSystemRouter`
//! / `Bun.Image` / `Bun.markdown`.
//!
//! Each backing module pulls in heavy dependencies that compiled executables
//! never use at runtime (`bun_bundler::Transpiler`, `bun_router`, the image
//! codec stack, `bun_md`). The codegen-emitted `#[no_mangle]` thunks in
//! `generated_classes.rs` reference these types by path and call their inherent
//! methods, so each stub provides a unit struct with the exact method set the
//! codegen calls — `constructor` throws, every other method is unreachable
//! (constructor failure means `m_ctx` stays null and prototype methods never
//! receive a live `&Self`). This keeps every C++-referenced symbol linkable
//! without compiling the real implementations.

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

// ─── Bun.Transpiler ──────────────────────────────────────────────────────────
pub mod js_transpiler {
    use super::*;

    pub struct JSTranspiler(());

    bun_jsc::impl_js_class_via_generated!(
        JSTranspiler => crate::generated_classes::js_Transpiler
    );

    impl JSTranspiler {
        pub fn constructor(g: &JSGlobalObject, _: &CallFrame) -> JsResult<Box<Self>> {
            Err(unavailable(g, "Bun.Transpiler"))
        }
        pub fn finalize(self: Box<Self>) {}
        pub fn scan(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn scan_imports(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn transform(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn transform_sync(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
    }

    /// REPL heuristic — pure byte scan, kept here so `cli/repl.rs` compiles
    /// without the real `JSTranspiler.rs` (which owns the canonical copy).
    /// Mirrors Node.js: a leading `{` not followed by a trailing `;` is treated
    /// as an object literal and wrapped in `()`.
    pub fn is_likely_object_literal(code: &[u8]) -> bool {
        let mut start = 0usize;
        while start < code.len() && matches!(code[start], b' ' | b'\t' | b'\n' | b'\r') {
            start += 1;
        }
        if start >= code.len() || code[start] != b'{' {
            return false;
        }
        let mut end = code.len();
        while end > start && matches!(code[end - 1], b' ' | b'\t' | b'\n' | b'\r') {
            end -= 1;
        }
        end > start && code[end - 1] != b';'
    }
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

// ─── Bun.markdown ────────────────────────────────────────────────────────────
pub mod markdown_object {
    use super::*;

    /// `Bun.markdown` lazy-prop body. The full build returns an object with
    /// `html`/`ansi`/`react`/`render` host fns; under standalone, accessing the
    /// property throws (the lazy-prop adapter accepts `JsResult<JSValue>`).
    pub fn create(global: &JSGlobalObject) -> JsResult<JSValue> {
        Err(unavailable(global, "Bun.markdown"))
    }
}

// ─── Bun.Image ───────────────────────────────────────────────────────────────
pub mod image {
    use super::*;
    use crate::generated_classes::PropertyName;

    pub struct Image(());

    // `Body.rs` downcasts `value.as_class_ref::<Image>()`; route through the
    // generated `js_Image` accessor module so the C++ `Image__fromJS` extern is
    // satisfied (it always returns null because no instance is ever created).
    bun_jsc::impl_js_class_via_generated!(Image => crate::generated_classes::js_Image);

    impl Image {
        pub fn constructor(g: &JSGlobalObject, _: &CallFrame, _: JSValue) -> JsResult<Box<Self>> {
            Err(unavailable(g, "Bun.Image"))
        }
        pub fn finalize(self: Box<Self>) {}
        pub fn estimated_size(&self) -> usize { 0 }

        /// `Blob.prototype.image()` entry — throws instead of constructing.
        pub fn from_blob_js(g: &JSGlobalObject, _: JSValue, _: JSValue) -> JsResult<JSValue> {
            Err(unavailable(g, "Bun.Image"))
        }

        // ── prototype methods (never reached) ────────────────────────────────
        pub fn do_format_avif(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_blob(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_buffer(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_bytes(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_data_url(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_flip(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_flop(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_format_heic(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_format_jpeg(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_metadata(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_modulate(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_placeholder(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_format_png(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_resize(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_rotate(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_to_base64(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_format_webp(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn do_write(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> { never!() }
        pub fn get_height(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }
        pub fn get_width(&self, _: &JSGlobalObject) -> JsResult<JSValue> { never!() }

        // ── statics (reachable via the constructor object) ───────────────────
        pub fn get_backend(g: &JSGlobalObject, _: JSValue, _: PropertyName) -> JsResult<JSValue> {
            Err(unavailable(g, "Bun.Image"))
        }
        pub fn set_backend(g: &JSGlobalObject, _: JSValue, _: JSValue, _: PropertyName) -> JsResult<bool> {
            Err(unavailable(g, "Bun.Image"))
        }
        pub fn clipboard_change_count(g: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
            Err(unavailable(g, "Bun.Image"))
        }
        pub fn from_clipboard(g: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
            Err(unavailable(g, "Bun.Image"))
        }
        pub fn has_clipboard_image(g: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
            Err(unavailable(g, "Bun.Image"))
        }
    }
}

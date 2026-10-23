//! C++ functions for hot-reloading server-side modules.

use core::ptr::NonNull;

use super::*;
use crate::bake::source_provider_exports::DevServerSourceProvider;

/// What JavaScriptCore's parser reports for source it rejects. Mirrors
/// `Bake::ParseFailure` in BakeSourceProvider.cpp.
#[repr(C)]
pub(super) struct ParseFailure {
    pub(super) message: BunString,
    /// The start of the token the parser stopped at, zero-based. The column
    /// counts UTF-16 code units.
    pub(super) line: i32,
    pub(super) column: i32,
}

/// Why a server patch did not load. `Bake::ServerPatchFailure` in
/// BakeSourceProvider.cpp has the values.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(super) enum ServerPatchFailure {
    /// The patch threw when it ran.
    Threw,
    /// JavaScriptCore did not parse the patch, so none of it ran.
    SyntaxError,
    ParserOutOfStackOrMemory,
}

/// A ref on the C++ `DevServerSourceProvider` of a loaded server patch.
pub(super) struct ServerPatchProvider(NonNull<DevServerSourceProvider>);

impl ServerPatchProvider {
    /// Registers the source map of the patch, for stack trace remapping.
    pub(super) fn attach_source_map(self, global: &JSGlobalObject, json: Vec<u8>) {
        unsafe extern "C" {
            fn DevServerSourceProvider__attachSourceMap(
                provider: *mut DevServerSourceProvider,
                global: &JSGlobalObject,
                ptr: *const u8,
                len: usize,
            );
        }
        // The provider frees the buffer.
        let json = ::core::mem::ManuallyDrop::new(json);
        // SAFETY: `self` holds a ref on the provider. `json` is a heap
        // allocation of `len` bytes whose ownership moves to the provider.
        unsafe {
            DevServerSourceProvider__attachSourceMap(
                self.0.as_ptr(),
                global,
                json.as_ptr(),
                json.len(),
            )
        };
    }
}

impl Drop for ServerPatchProvider {
    fn drop(&mut self) {
        unsafe extern "C" {
            fn DevServerSourceProvider__deref(provider: *mut DevServerSourceProvider);
        }
        // SAFETY: releases the ref `BakeLoadServerHmrPatch` handed over.
        unsafe { DevServerSourceProvider__deref(self.0.as_ptr()) };
    }
}

/// Returns the object of the patch's modules and the provider of its source.
/// `Err` holds what the load threw, and why.
pub(super) fn bake_load_server_hmr_patch(
    global: &JSGlobalObject,
    code: BunString,
) -> Result<(JSValue, ServerPatchProvider), (JSValue, ServerPatchFailure)> {
    unsafe extern "C" {
        safe fn BakeLoadServerHmrPatch(
            global: &JSGlobalObject,
            code: BunString,
            provider: &mut *mut DevServerSourceProvider,
            failure: &mut u8,
        ) -> JSValue;
    }
    let mut provider: *mut DevServerSourceProvider = ::core::ptr::null_mut();
    let mut failure: u8 = 0;
    match jsc::from_js_host_call(global, || {
        BakeLoadServerHmrPatch(global, code, &mut provider, &mut failure)
    }) {
        Ok(modules) => Ok((
            modules,
            ServerPatchProvider(NonNull::new(provider).expect("infallible: set on success")),
        )),
        Err(err) => Err((
            global.take_exception(err),
            match failure {
                1 => ServerPatchFailure::SyntaxError,
                2 => ServerPatchFailure::ParserOutOfStackOrMemory,
                _ => ServerPatchFailure::Threw,
            },
        )),
    }
}

/// Parses `code` the way `bake_load_server_hmr_patch` does, without running it.
pub(super) fn bake_check_server_hmr_patch_syntax(
    global: &JSGlobalObject,
    code: BunString,
) -> Result<(), ParseFailure> {
    unsafe extern "C" {
        safe fn BakeCheckServerHmrPatchSyntax(
            global: &JSGlobalObject,
            code: BunString,
            failure: &mut ParseFailure,
        ) -> bool;
    }
    let mut failure = ParseFailure {
        message: BunString::EMPTY,
        line: 0,
        column: 0,
    };
    if BakeCheckServerHmrPatchSyntax(global, code, &mut failure) {
        Ok(())
    } else {
        Err(failure)
    }
}

pub(super) fn bake_load_initial_server_code(
    global: &JSGlobalObject,
    code: BunString,
    separate_ssr_graph: bool,
) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn BakeLoadInitialServerCode(
            global: &JSGlobalObject,
            code: BunString,
            separate_ssr_graph: bool,
        ) -> JSValue;
    }
    jsc::from_js_host_call(global, || {
        BakeLoadInitialServerCode(global, code, separate_ssr_graph)
    })
}

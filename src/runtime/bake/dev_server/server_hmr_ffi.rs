//! C++ functions for hot-reloading server-side modules.

use core::ptr::NonNull;

use super::*;
use crate::bake::source_provider_exports::DevServerSourceProvider;

/// What JavaScriptCore's parser reports for a module it rejects. Mirrors
/// `Bake::ParseFailure` in BakeSourceProvider.cpp.
#[repr(C)]
pub(super) struct ParseFailure {
    pub(super) message: BunString,
    /// The start of the token the parser stopped at, zero-based. The column
    /// counts UTF-16 code units.
    pub(super) line: i32,
    pub(super) column: i32,
    /// The token starts the code that the parser rejects. If false, the token
    /// is after that code.
    pub(super) at_rejected_code: bool,
}

/// Why server code did not load. `Bake::ServerLoadFailure` in
/// BakeSourceProvider.cpp has the values.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(super) enum ServerLoadFailure {
    /// The code threw when it ran.
    Threw,
    /// JavaScriptCore did not parse the code, so none of it ran.
    SyntaxError,
    ParserOutOfStackOrMemory,
}

impl ServerLoadFailure {
    fn decode(failure: u8) -> Self {
        match failure {
            1 => Self::SyntaxError,
            2 => Self::ParserOutOfStackOrMemory,
            _ => Self::Threw,
        }
    }
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
) -> Result<(JSValue, ServerPatchProvider), (JSValue, ServerLoadFailure)> {
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
            ServerLoadFailure::decode(failure),
        )),
    }
}

/// Parses one module of a server patch the way `bake_load_server_hmr_patch`
/// does, without running it.
pub(super) fn bake_check_server_hmr_module_syntax(
    global: &JSGlobalObject,
    module: BunString,
) -> Result<(), ParseFailure> {
    unsafe extern "C" {
        safe fn BakeCheckServerHmrModuleSyntax(
            global: &JSGlobalObject,
            module: BunString,
            failure: &mut ParseFailure,
        ) -> bool;
    }
    let mut failure = ParseFailure {
        message: BunString::EMPTY,
        line: 0,
        column: 0,
        at_rejected_code: false,
    };
    if BakeCheckServerHmrModuleSyntax(global, module, &mut failure) {
        Ok(())
    } else {
        Err(failure)
    }
}

/// `Err` holds what the load threw, and why.
pub(super) fn bake_load_initial_server_code(
    global: &JSGlobalObject,
    code: BunString,
    separate_ssr_graph: bool,
) -> Result<JSValue, (jsc::JsError, ServerLoadFailure)> {
    unsafe extern "C" {
        safe fn BakeLoadInitialServerCode(
            global: &JSGlobalObject,
            code: BunString,
            separate_ssr_graph: bool,
            failure: &mut u8,
        ) -> JSValue;
    }
    let mut failure: u8 = 0;
    jsc::from_js_host_call(global, || {
        BakeLoadInitialServerCode(global, code, separate_ssr_graph, &mut failure)
    })
    .map_err(|err| (err, ServerLoadFailure::decode(failure)))
}

//! Port of `src/jsc/ModuleLoader.zig`.
//!
//! B-2 un-gate: real `ModuleLoader` struct, `FetchFlags`, and the
//! `HardcodedModule` re-export compile against the `lib.rs` stub surface.
//! `transpile_source_code` / `fetch_builtin_module` / `resolve_embedded_file`
//! and the `Bun__*` extern entry points are preserved verbatim from the
//! Phase-A draft inside `` blocks below — every body reaches into
//! `bun_runtime::node::fs` / `bun_transpiler` internals / gated bundler types
//! (forward-dep cycle on `bun_jsc`).

use core::ffi::c_void;

use bun_alloc::Arena as ArenaAllocator;
use bun_logger as logger;

use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, ErrorableResolvedSource, ErrorableString, JSGlobalObject, JSInternalPromise,
    JSValue, JsError, JsResult, ResolvedSource,
};

// Re-exports (thin re-exports from the original Zig file).
pub use bun_resolve_builtins::HardcodedModule;
pub use bun_resolver::node_fallbacks;
pub use crate::runtime_transpiler_store::RuntimeTranspilerStore;

// Spec ModuleLoader.zig:4 — `pub const AsyncModule = @import("./AsyncModule.zig").AsyncModule;`
// Mounted as a sub-module here (rather than from `lib.rs`) so the Phase-B
// un-gate touches only the two files this slice owns; `lib.rs` already
// re-exports `module_loader as ModuleLoader`, so `jsc::ModuleLoader::AsyncModule`
// resolves identically to the Zig path.
#[path = "AsyncModule.rs"]
pub mod async_module;
pub use async_module::{AsyncModule, Queue as AsyncModuleQueue};

#[allow(non_upper_case_globals)]
bun_core::declare_scope!(ModuleLoader, hidden);

#[derive(Default)]
pub struct ModuleLoader {
    pub transpile_source_code_arena: Option<Box<ArenaAllocator>>,
    pub eval_source: Option<Box<logger::Source>>,
}

pub static mut IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS: bool = false;
// TODO(port): Zig used a plain mutable global; Phase B may want AtomicBool.

#[inline]
pub fn set_is_allowed_to_use_internal_testing_apis(v: bool) {
    // SAFETY: only written during init on the JS thread.
    unsafe { IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS = v };
}

impl ModuleLoader {
    /// This must be called after calling transpileSourceCode
    ///
    /// PORT NOTE: takes only `&mut VirtualMachine` (not `&mut self,
    /// &mut VirtualMachine`) — `ModuleLoader` is a value field of
    /// `VirtualMachine`, so passing both would alias (PORTING.md §Forbidden).
    /// Access `module_loader` through `jsc_vm` instead.
    pub fn reset_arena(jsc_vm: &mut VirtualMachine) {
        if let Some(arena) = jsc_vm.module_loader.transpile_source_code_arena.as_mut() {
            // TODO(port): Zig `arena.reset(.free_all)` / `.retain_with_limit(8M)`.
            // bumpalo::Bump (= bun_alloc::Arena) only has `.reset()` (free all);
            // there is no retain-with-limit variant. PERF(port): profile in Phase B.
            let _ = jsc_vm.smol;
            arena.reset();
        }
    }
}

/// Dumps the module source to a file in /tmp/bun-debug-src/{filepath}
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FetchFlags {
    Transpile,
    PrintSource,
    PrintSourceAndClone,
}

impl FetchFlags {
    pub const fn disable_transpiling(self) -> bool {
        !matches!(self, FetchFlags::Transpile)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// §Dispatch — `bun_runtime` loader vtable.
//
// `transpile_source_code` / `fetch_builtin_module` / `Bun__transpileFile`
// reach into `bun_runtime::node::fs` (read-file), `bun_transpiler::ParseResult`,
// `bun_bundler::analyze_transpiled_module`, the source-code printer pool, and
// `webcore::Blob` — every one a forward-dep on `bun_jsc`. Per PORTING.md
// §Dispatch (cold-path: called per-import, not per-tick), the low tier owns
// the extern-"C" symbol and a manual vtable; `bun_runtime` installs the body.
// ──────────────────────────────────────────────────────────────────────────

/// `transpile_source_code` parameters that name only low-tier types. The
/// remaining params (`path: Fs.Path`, `loader: options.Loader`,
/// `module_type: options.ModuleType`, `printer: *BufferPrinter`) are passed
/// through the `extra: *mut c_void` slot — the high-tier hook owns the cast.
pub struct TranspileArgs<'a> {
    pub specifier: &'a [u8],
    pub referrer: &'a [u8],
    pub input_specifier: bun_string::String,
    pub log: *mut logger::Log,
    pub virtual_source: Option<&'a logger::Source>,
    pub global_object: *mut JSGlobalObject,
    pub flags: FetchFlags,
    /// `*mut TranspileExtra` — opaque, owned by the high tier. Null when
    /// called from the low-tier `Bun__*` shims (the hook recomputes them from
    /// `specifier`).
    pub extra: *mut c_void,
}

/// Concrete shape behind [`TranspileArgs::extra`]. Declared here (not in
/// `bun_runtime`) so both tiers agree on layout; every field type is already a
/// `bun_jsc` dep (`bun_resolver`, `bun_bundler::options`, `bun_js_printer`).
///
/// PORT NOTE: Zig passed these as positional params to `transpileSourceCode`
/// (ModuleLoader.zig:90-96). They're bundled because the §Dispatch fn-ptr
/// signature must be stable across the crate boundary.
#[repr(C)]
pub struct TranspileExtra {
    pub path: bun_resolver::fs::Path<'static>,
    pub loader: bun_bundler::options::Loader,
    pub module_type: bun_bundler::options::ModuleType,
    /// `*js_printer.BufferPrinter` — the per-VM shared printer. Never null
    /// when `extra` itself is non-null.
    pub source_code_printer: *mut bun_js_printer::BufferPrinter,
    /// `?*?*jsc.JSInternalPromise` — out-param for the async-module path
    /// (ModuleLoader.zig:95). Null forbids async resolution.
    pub promise_ptr: *mut *mut JSInternalPromise,
}

/// Result of `LoaderHooks::fetch_builtin_module` — tri-state to mirror
/// ModuleLoader.zig:861-876, where an ERROR during builtin lookup must be
/// surfaced to C++ (return `true` with `ret` populated as `.err`) rather than
/// falling through to filesystem resolution.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FetchBuiltinResult {
    /// Not a builtin/standalone-graph module — caller falls through.
    NotFound,
    /// Builtin found; `*out` is populated with `.ok(resolved)`.
    Found,
    /// Lookup errored; `*out` is populated with `.err(...)` (via
    /// `VirtualMachine::process_fetch_log`). Caller must return `true`.
    Errored,
}

pub struct LoaderHooks {
    /// `ModuleLoader.transpileSourceCode(...)` — full body. Returns `false`
    /// on error (error is written into `*ret` as `.err(...)`).
    pub transpile_source_code:
        unsafe fn(jsc_vm: *mut VirtualMachine, args: &TranspileArgs<'_>, ret: *mut ErrorableResolvedSource) -> bool,
    /// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)` — writes `*out`
    /// (as `ErrorableResolvedSource`) and returns a tri-state. On
    /// `Found`/`Errored`, `*out` is populated; on `NotFound` it is untouched.
    pub fetch_builtin_module: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        global: *mut JSGlobalObject,
        specifier: &bun_string::String,
        referrer: &bun_string::String,
        out: *mut ErrorableResolvedSource,
    ) -> FetchBuiltinResult,
    /// `ModuleLoader.getHardcodedModule(jsc_vm, specifier, hardcoded)` —
    /// per-variant body of the builtin-module fast path. `false` ⇒ `None`
    /// (recognised but not currently servable); `true` ⇒ `*out` populated.
    pub get_hardcoded_module: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        specifier: &bun_string::String,
        hardcoded: bun_resolve_builtins::Module,
        out: *mut ResolvedSource,
    ) -> bool,
    /// `ModuleLoader.resolveEmbeddedFile(vm, &path_buf, input_path, "node")`
    /// (spec ModuleLoader.zig:1332-1342) — extracts an embedded `.node` addon
    /// from the standalone-module graph to a real on-disk temp file and writes
    /// the resulting path back into `*in_out_str`. Returns `true` on success.
    /// Body lives in `bun_runtime` (reaches into `node::fs` +
    /// `StandaloneModuleGraph`).
    pub resolve_embedded_node_file:
        unsafe fn(vm: *mut VirtualMachine, in_out_str: *mut bun_string::String) -> bool,
    /// `VirtualMachine.resolveMaybeNeedsTrailingSlash(res, global, specifier,
    /// source, query_string?, is_esm, is_a_file_path, is_user_require_resolve)`
    /// (spec VirtualMachine.zig:1873-2016) — the resolution path behind
    /// `Bun__resolveSync` / `Zig__GlobalObject__resolve` / `import.meta.resolve`.
    /// Body reaches into `transpiler.resolver.resolveAndAutoInstall`, the
    /// `PluginRunner`, `ObjectURLRegistry`, and `ServerEntryPoint` (all
    /// `bun_runtime` types), so the low tier owns the symbol and dispatches.
    ///
    /// Writes `*res` (always — `.ok` or `.err`); writes `*query_string` (if
    /// non-null) to a fresh owned `bun.String`. Returns `false` iff a JS
    /// exception is pending on `global` (the Zig `bun.JSError!void` shape).
    pub resolve: unsafe fn(
        res: *mut ErrorableString,
        global: *mut JSGlobalObject,
        specifier: bun_string::String,
        source: bun_string::String,
        query_string: *mut bun_string::String,
        is_esm: bool,
        is_a_file_path: bool,
        is_user_require_resolve: bool,
    ) -> bool,
    /// `Bun__transpileVirtualModule` body (spec ModuleLoader.zig:1234-1304) —
    /// transpiles plugin-provided source through the per-thread `BufferPrinter`
    /// (a `bun_runtime` thread-local). Writes `*ret` (always — `.ok` or `.err`)
    /// and returns `true` (the only `false` return in Zig is unreachable here
    /// because the C++ caller already proved `plugin_runner != null`).
    pub transpile_virtual_module: unsafe fn(
        global: *mut JSGlobalObject,
        specifier: *const bun_string::String,
        referrer: *const bun_string::String,
        source_code: *mut bun_string::ZigString,
        loader: bun_options_types::schema::api::Loader,
        ret: *mut ErrorableResolvedSource,
    ) -> bool,
    /// `Bun__transpileFile` body — needs `options.getLoaderAndVirtualSource`,
    /// `node_module_module`, `webcore.Blob`, the concurrent-transpiler queue.
    /// Returns the in-flight promise when `allow_promise && async`, else null
    /// (result is in `*ret`).
    pub transpile_file: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        global: *mut JSGlobalObject,
        specifier: *const bun_string::String,
        referrer: *const bun_string::String,
        type_attribute: *const bun_string::String,
        ret: *mut ErrorableResolvedSource,
        allow_promise: bool,
        is_commonjs_require: bool,
        force_loader: u8,
    ) -> *mut c_void,
}

static LOADER_HOOKS: core::sync::atomic::AtomicPtr<LoaderHooks> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Called by `bun_runtime` at startup. `hooks` must be `'static`.
pub fn set_loader_hooks(hooks: &'static LoaderHooks) {
    // SAFETY: `AtomicPtr` requires `*mut T` for storage, but the pointer is
    // only ever loaded back as `&'static LoaderHooks` (see `loader_hooks()`)
    // and never written through — provenance from `&'static` is preserved.
    LOADER_HOOKS.store(
        (hooks as *const LoaderHooks).cast_mut(),
        core::sync::atomic::Ordering::Release,
    );
}

#[inline]
fn loader_hooks() -> Option<&'static LoaderHooks> {
    let p = LOADER_HOOKS.load(core::sync::atomic::Ordering::Acquire);
    // SAFETY: `p` was stored from a `&'static LoaderHooks` (or is null).
    unsafe { p.as_ref() }
}

/// `ModuleLoader.transpileSourceCode(...)` — thin shim over the §Dispatch
/// hook. PERF(port): was inline switch — direct call in Zig; the indirection
/// is one fn-ptr per import, dwarfed by the parser/printer work it does.
pub fn transpile_source_code(
    jsc_vm: &mut VirtualMachine,
    args: &TranspileArgs<'_>,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    let Some(hooks) = loader_hooks() else {
        // No high tier (unit tests) — fail closed.
        return false;
    };
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM.
    unsafe { (hooks.transpile_source_code)(jsc_vm, args, ret) }
}

/// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)`.
pub fn fetch_builtin_module(
    jsc_vm: &mut VirtualMachine,
    global: *mut JSGlobalObject,
    specifier: &bun_string::String,
    referrer: &bun_string::String,
    out: &mut ErrorableResolvedSource,
) -> FetchBuiltinResult {
    let Some(hooks) = loader_hooks() else {
        return FetchBuiltinResult::NotFound;
    };
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM; `out` is a
    // valid out-param.
    unsafe { (hooks.fetch_builtin_module)(jsc_vm, global, specifier, referrer, out) }
}

/// `VirtualMachine.resolveMaybeNeedsTrailingSlash(...)` — thin shim over the
/// §Dispatch hook. Spec VirtualMachine.zig:1873. The body lives in
/// `bun_runtime::jsc_hooks` because it drives `transpiler.resolver` (forward
/// dep on `bun_jsc`).
///
/// PORT NOTE: `is_a_file_path` was a Zig `comptime bool`; demoted to runtime
/// because the §Dispatch fn-ptr signature must be monomorphic across the crate
/// boundary. The branch is a single length-check / `dirWithTrailingSlash` —
/// PERF(port): was inline switch; the fn-ptr indirection is one call per
/// `import` / `require.resolve`, dominated by the resolver's dir-cache walk.
pub fn resolve_maybe_needs_trailing_slash(
    res: &mut ErrorableString,
    global: *mut JSGlobalObject,
    specifier: bun_string::String,
    source: bun_string::String,
    query_string: Option<&mut bun_string::String>,
    is_esm: bool,
    is_a_file_path: bool,
    is_user_require_resolve: bool,
) -> JsResult<()> {
    let Some(hooks) = loader_hooks() else {
        // No high tier (unit tests) — fail closed with ModuleNotFound so
        // callers surface a real ResolveMessage rather than `undefined`.
        *res = ErrorableString::err(bun_core::err!("ModuleNotFound"), JSValue::UNDEFINED);
        return Ok(());
    };
    let qs = query_string
        .map(|q| q as *mut bun_string::String)
        .unwrap_or(core::ptr::null_mut());
    // SAFETY: hook contract — `global` is the live JS-thread global (Zig
    // `*JSGlobalObject`, mutable: hook may throw on it); `res`/`qs` are valid
    // out-params for the call (single-threaded, no aliasing).
    let ok = unsafe {
        (hooks.resolve)(
            res,
            global,
            specifier,
            source,
            qs,
            is_esm,
            is_a_file_path,
            is_user_require_resolve,
        )
    };
    if ok { Ok(()) } else { Err(JsError::Thrown) }
}

/// `VirtualMachine.resolve(res, global, specifier, source, query_string,
/// is_esm)` (spec VirtualMachine.zig:1854-1863) — the `Zig__GlobalObject__resolve`
/// entry point. Thin wrapper that fixes `is_a_file_path = true`,
/// `is_user_require_resolve = false`.
#[inline]
pub fn resolve(
    res: &mut ErrorableString,
    global: *mut JSGlobalObject,
    specifier: bun_string::String,
    source: bun_string::String,
    query_string: Option<&mut bun_string::String>,
    is_esm: bool,
) -> JsResult<()> {
    resolve_maybe_needs_trailing_slash(
        res,
        global,
        specifier,
        source,
        query_string,
        is_esm,
        true,
        false,
    )
}

/// `VirtualMachine.processFetchLog(global, specifier, referrer, log, &errorable,
/// err)` — synthesizes a JS error from the parser/resolve `log` and writes it
/// into `errorable` so the C++ side (`Bun__onFulfillAsyncModule`,
/// ModuleLoader.cpp:473) rejects the import promise with a real Error instead
/// of `undefined`.
///
/// PORT NOTE: previously routed through `LoaderHooks` on the assumption the
/// body needed `bun_runtime` types; it doesn't — `BuildMessage` /
/// `ResolveMessage` live in this crate — so the hook slot was dropped and this
/// forwards to the real impl in [`crate::virtual_machine::process_fetch_log`].
pub fn process_fetch_log(
    global: *mut JSGlobalObject,
    specifier: bun_string::String,
    referrer: bun_string::String,
    log: &mut logger::Log,
    errorable: &mut ErrorableResolvedSource,
    err: bun_core::Error,
) {
    // SAFETY: callers (AsyncModule::fulfill, Bun__transpileFile error path)
    // pass the live JS-thread global; never null.
    let global = unsafe { &*global };
    crate::virtual_machine::process_fetch_log(global, specifier, referrer, log, errorable, err)
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" entry points — these are the symbols C++ calls. Bodies dispatch
// through `LoaderHooks`; the high tier owns the real logic.
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__transpileFile(
    jsc_vm: *mut VirtualMachine,
    global_object: *mut JSGlobalObject,
    specifier_ptr: *mut bun_string::String,
    referrer: *mut bun_string::String,
    type_attribute: *const bun_string::String,
    ret: *mut ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    force_loader_type: u8, // bun.schema.api.Loader — passed as raw u8 across the cycle
) -> *mut c_void {
    jsc::mark_binding(core::panic::Location::caller());
    let Some(hooks) = loader_hooks() else {
        // SAFETY: C++ passed a valid out-param.
        unsafe {
            *ret = ErrorableResolvedSource::err(
                bun_core::err!("ModuleNotFound"),
                JSValue::UNDEFINED,
            )
        };
        return core::ptr::null_mut();
    };
    // SAFETY: hook contract — all pointers are valid for the call (C++ ABI).
    // PERF(port): was inline switch.
    unsafe {
        (hooks.transpile_file)(
            jsc_vm,
            global_object,
            specifier_ptr,
            referrer,
            type_attribute,
            ret,
            allow_promise,
            is_commonjs_require,
            force_loader_type,
        )
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__fetchBuiltinModule(
    jsc_vm: *mut VirtualMachine,
    global_object: *mut JSGlobalObject,
    specifier: *const bun_string::String,
    referrer: *const bun_string::String,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: C++ passed valid pointers; `jsc_vm` is the live per-thread VM.
    let (jsc_vm, specifier, referrer, ret) =
        unsafe { (&mut *jsc_vm, &*specifier, &*referrer, &mut *ret) };
    // PORT NOTE: spec ModuleLoader.zig:861-876 — when `fetchBuiltinModule`
    // ERRORS, it calls `VirtualMachine.processFetchLog(..., ret, err)` and
    // returns **true** (so C++ surfaces the error instead of falling through to
    // filesystem resolution). The hook writes `ret` directly on Found/Errored.
    match fetch_builtin_module(jsc_vm, global_object, specifier, referrer, ret) {
        FetchBuiltinResult::NotFound => false,
        FetchBuiltinResult::Found | FetchBuiltinResult::Errored => true,
    }
}

/// `HardcodedModule.Alias.bun_aliases.get(str)` — linear scan over the
/// `BUN_ALIASES` const tables (PERF(port): Phase B replaces with phf).
#[inline]
fn bun_aliases_get(name: &[u8]) -> Option<bun_resolve_builtins::Alias> {
    for table in bun_resolve_builtins::HardcodedModule::BUN_ALIASES {
        for (k, v) in *table {
            if *k == name {
                return Some(*v);
            }
        }
    }
    None
}

/// Spec ModuleLoader.zig:828-848.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveAndFetchBuiltinModule(
    jsc_vm: *mut VirtualMachine,
    specifier: *mut bun_string::String,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: C++ passed valid pointers; `jsc_vm` is the live per-thread VM.
    let specifier = unsafe { &*specifier };
    let spec_utf8 = specifier.to_utf8();
    let Some(alias) = bun_aliases_get(spec_utf8.slice()) else {
        return false;
    };
    let Some(&hardcoded) = bun_resolve_builtins::Module::MAP.get(alias.path.as_bytes()) else {
        debug_assert!(false);
        return false;
    };
    let Some(hooks) = loader_hooks() else {
        return false;
    };
    let mut resolved = ResolvedSource::default();
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM; `&mut
    // resolved` is a valid out-param.
    if !unsafe { (hooks.get_hardcoded_module)(jsc_vm, specifier, hardcoded, &mut resolved) } {
        return false;
    }
    // SAFETY: C++ passed a valid out-param.
    unsafe { *ret = ErrorableResolvedSource::ok(resolved) };
    true
}

/// Spec ModuleLoader.zig:1332-1342. Support embedded .node files.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveEmbeddedNodeFile(
    vm: *mut VirtualMachine,
    in_out_str: *mut bun_string::String,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: C++ passed the live per-thread VM.
    if unsafe { (*vm).standalone_module_graph.is_none() } {
        return false;
    }
    // `ModuleLoader.resolveEmbeddedFile` reaches into `bun_runtime::node::fs` +
    // `StandaloneModuleGraph` — forward-dep on `bun_jsc`. Per §Dispatch the low
    // tier owns the extern symbol and dispatches through `LoaderHooks`; the
    // high tier extracts the embedded addon to a temp file and writes the
    // on-disk path back into `*in_out_str` (spec ModuleLoader.zig:1332-1342:
    // `bun.String.cloneUTF8(result)`).
    let Some(hooks) = loader_hooks() else {
        // Reaching here requires a standalone module graph but no `bun_runtime`
        // — an init-ordering invariant violation (the graph is installed by the
        // CLI entry, which runs strictly after `set_loader_hooks`). Fail loud
        // rather than silently returning `false` (which would leave the virtual
        // specifier in `*in_out_str` and make `process.dlopen()` mis-resolve —
        // PORTING.md §Forbidden: silent-no-op for real Zig logic).
        unreachable!("standalone_module_graph set but LoaderHooks unset (init ordering)");
    };
    // SAFETY: hook contract — `vm` is the live per-thread VM; `in_out_str` is a
    // valid in/out `bun.String*` (C++ ABI, BunProcess.cpp:463).
    // PERF(port): was inline switch.
    unsafe { (hooks.resolve_embedded_node_file)(vm, in_out_str) }
}

/// Spec ModuleLoader.zig:1344-1347.
#[unsafe(no_mangle)]
pub extern "C" fn ModuleLoader__isBuiltin(data: *const u8, len: usize) -> bool {
    // SAFETY: C++ guarantees `data[..len]` is a valid UTF-8 specifier slice.
    let str = unsafe { core::slice::from_raw_parts(data, len) };
    bun_aliases_get(str).is_some()
}

// ──────────────────────────────────────────────────────────────────────────
// `PluginRunner` namespace helpers — pure byte-string parsing, ported here
// (spec bundler_jsc/PluginRunner.zig:14-53) so `Bun__runVirtualModule` can
// pre-filter without depending on `bun_bundler_jsc` (forward-dep cycle).
// ──────────────────────────────────────────────────────────────────────────

/// Spec PluginRunner.zig:14-28 — `PluginRunner.extractNamespace`.
fn plugin_extract_namespace(specifier: &[u8]) -> &[u8] {
    let Some(colon) = bun_string::strings::index_of_char(specifier, b':') else {
        return b"";
    };
    let colon = colon as usize;
    // Windows drive-letter (`C:\…`) — not a namespace.
    if cfg!(windows)
        && colon == 1
        && specifier.len() > 3
        && bun_paths::resolve_path::is_sep_any(specifier[2])
        && ((specifier[0] > b'a' && specifier[0] < b'z')
            || (specifier[0] > b'A' && specifier[0] < b'Z'))
    {
        return b"";
    }
    &specifier[..colon]
}

/// Spec PluginRunner.zig:30-53 — `PluginRunner.couldBePlugin`.
fn plugin_could_be_plugin(specifier: &[u8]) -> bool {
    if let Some(last_dot) = bun_string::strings::last_index_of_char(specifier, b'.') {
        let ext = &specifier[last_dot + 1..];
        // '.' followed by either a letter or a non-ascii character — cheaply
        // rule out "../", "..", "./".
        if !ext.is_empty()
            && ((ext[0] >= b'a' && ext[0] <= b'z')
                || (ext[0] >= b'A' && ext[0] <= b'Z')
                || ext[0] > 127)
        {
            return true;
        }
    }
    let namespace = plugin_extract_namespace(specifier);
    !namespace.is_empty()
        && !bun_string::strings::eql_long(namespace, b"node", false)
        && !bun_string::strings::eql_long(namespace, b"bun", false)
        && !bun_string::strings::eql_long(namespace, b"file", false)
}

// PORT NOTE: `ModuleLoader.resolveEmbeddedFile` (spec ModuleLoader.zig:33-71)
// has been MOVED to `bun_runtime::jsc_hooks::resolve_embedded_node_file_hook`
// per PORTING.md §Forbidden ("dep-cycle: MOVE the code to the right crate") —
// the body reaches into `bun_standalone_graph` + `bun_sys::Tmpfile` +
// `node::fs`, none of which are `bun_jsc` deps. Both Zig callers
// (`Bun__resolveEmbeddedNodeFile` above, and the `.sqlite` arm of
// `transpileSourceCode`) now live in `bun_runtime`.

/// Spec ModuleLoader.zig:73-83.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__getDefaultLoader(
    global: &JSGlobalObject,
    str: &bun_string::String,
) -> bun_options_types::schema::api::Loader {
    use bun_options_types::schema::api;
    let jsc_vm = global.bun_vm();
    let filename = str.to_utf8();
    let loader = jsc_vm
        .transpiler
        .options
        .loader(bun_resolver::fs::PathName::init(filename.slice()).ext)
        .to_api();
    if loader == api::Loader::file {
        return api::Loader::js;
    }
    loader
}

/// Spec ModuleLoader.zig:1234-1304.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__transpileVirtualModule(
    global: *mut JSGlobalObject,
    specifier: *const bun_string::String,
    referrer: *const bun_string::String,
    source_code: *mut bun_string::ZigString,
    loader: bun_options_types::schema::api::Loader,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    // Body drives `transpileSourceCode` through the per-thread `BufferPrinter`
    // (a `bun_runtime` thread-local), so per §Dispatch the low tier owns the
    // extern symbol and dispatches; `bun_runtime` installs the body. Same
    // shape as `Bun__transpileFile` above.
    let Some(hooks) = loader_hooks() else {
        // SAFETY: C++ passed a valid out-param.
        unsafe {
            *ret = ErrorableResolvedSource::err(
                bun_core::err!("ModuleNotFound"),
                JSValue::UNDEFINED,
            );
        }
        return true;
    };
    // SAFETY: hook contract — all pointers are valid for the call (C++ ABI).
    // PERF(port): was inline switch.
    unsafe { (hooks.transpile_virtual_module)(global, specifier, referrer, source_code, loader, ret) }
}

/// Spec ModuleLoader.zig:1122-1143.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__runVirtualModule(
    global: *mut JSGlobalObject,
    specifier_ptr: *const bun_string::String,
) -> JSValue {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: C++ passed the live JS-thread global; never null.
    let global = unsafe { &*global };
    if global.bun_vm().plugin_runner.is_none() {
        return JSValue::ZERO;
    }

    // SAFETY: C++ passed a valid `bun.String*`.
    let specifier_slice = unsafe { &*specifier_ptr }.to_utf8();
    let specifier = specifier_slice.slice();

    if !plugin_could_be_plugin(specifier) {
        return JSValue::ZERO;
    }

    let namespace = plugin_extract_namespace(specifier);
    let after_namespace = if namespace.is_empty() {
        specifier
    } else {
        &specifier[(namespace.len() + 1).min(specifier.len())..]
    };

    match global.run_on_load_plugins(
        bun_string::String::init(bun_string::ZigString::init(namespace)),
        bun_string::String::init(bun_string::ZigString::init(after_namespace)),
        crate::js_global_object::BunPluginTarget::Bun,
    ) {
        // `catch return .zero` / `orelse return .zero`
        Ok(Some(v)) => v,
        Ok(None) | Err(_) => JSValue::ZERO,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ModuleLoader.zig (~1780 lines)
//   confidence: low
//   todos:      8
//   notes:      Keystone-C un-gate. ModuleLoader struct + FetchFlags +
//               reset_arena + HardcodedModule re-export real.
//               transpile_source_code / fetch_builtin_module /
//               Bun__transpileFile / Bun__fetchBuiltinModule /
//               Bun__transpileVirtualModule un-gated as §Dispatch shims over
//               `LoaderHooks` (bun_runtime installs the body).
//               Bun__getDefaultLoader / Bun__runVirtualModule ported inline.
//               resolveEmbeddedFile moved to bun_runtime::jsc_hooks.
//               Full Phase-A draft @ 5410a51d85^.
// ──────────────────────────────────────────────────────────────────────────

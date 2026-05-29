// ══════════════════════════════════════════════════════════════════════════
// `Transpiler` — the legacy single-file transpile path (pre-`bundle_v2`).
// resolver↔bundler cycle broken in O; `bun_resolver` is now a direct dep so
// the struct and all method bodies are un-gated and live at this tier.
// ══════════════════════════════════════════════════════════════════════════

use bun_alloc::Arena;
use bun_collections::HashMap;
use bun_collections::VecExt;
use bun_dotenv as dot_env;
use bun_js_parser as js_ast;
use bun_perf::system_timer::Timer as SystemTimer;
use bun_resolver::fs as Fs;
use bun_resolver::{self as resolver, Resolver};
use bun_router::Router;

use crate::options;

/// Port of `transpiler.zig:ResolveResults` — keyed by source path hash.
pub(crate) type ResolveResults = HashMap<u64, ()>;
pub(crate) type ResolveQueue = std::collections::VecDeque<resolver::Result>;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BunPluginTarget {
    Bun = 0,
    Node = 1,
    Browser = 2,
}

bun_core::assert_ffi_discr!(BunPluginTarget, u8; Bun = 0, Node = 1, Browser = 2);

pub trait PluginResolver {
    fn on_resolve(
        &self,
        specifier: &[u8],
        importer: &[u8],
        log: &mut bun_ast::Log,
        loc: bun_ast::Loc,
        target: BunPluginTarget,
    ) -> Result<Option<bun_paths::fs::Path<'static>>, bun_core::Error>;
}

pub struct PluginRunner;

impl PluginRunner {
    /// Spec PluginRunner.zig:14 `extractNamespace`.
    pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
        let Some(colon) = bun_core::index_of_char(specifier, b':') else {
            return b"";
        };
        let colon = colon as usize;
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

    /// Spec PluginRunner.zig:22 `couldBePlugin` — cheap pre-filter that rules
    /// out `./` / `../` / absolute paths before hitting the resolve hook.
    pub fn could_be_plugin(specifier: &[u8]) -> bool {
        if let Some(last_dot) = bun_core::last_index_of_char(specifier, b'.') {
            let ext = &specifier[last_dot + 1..];
            // '.' followed by either a letter or a non-ascii character
            // maybe there are non-ascii file extensions?
            // we mostly want to cheaply rule out "../" and ".." and "./"
            if !ext.is_empty()
                && (ext[0].is_ascii_lowercase() || ext[0].is_ascii_uppercase() || ext[0] > 127)
            {
                return true;
            }
        }
        !bun_paths::is_absolute(specifier) && bun_core::index_of_char(specifier, b':').is_some()
    }
}

/// Spec `transpiler.zig:5` — `pub const MacroJSCtx = @import("../bundler_jsc/PluginRunner.zig").MacroJSCtx`.
/// The canonical newtype lives in `bun_ast::Macro` (the lowest tier that
/// stores it, in `MacroContext.javascript_object`); re-exported here per spec.
pub use js_ast::Macro::MacroJSCtx;
/// Spec `transpiler.zig:1433 default_macro_js_value` (= `JSValue.zero`).
#[inline]
pub const fn default_macro_js_value() -> MacroJSCtx {
    MacroJSCtx::ZERO
}

pub struct Transpiler<'a> {
    pub options: options::BundleOptions<'a>,
    // PORT NOTE: raw ptr — Zig aliased the same `*Log` into `linker.log` and
    // `resolver.log` (see `set_log`). `&'a mut` would forbid that aliasing.
    // TODO(port): lifetime — restructure once linker/resolver own their logs.
    pub log: *mut bun_ast::Log,
    // TODO(port): arena — bundler is an AST crate per PORTING.md so we
    // thread an arena, but callers usually pass `bun.default_allocator`.
    // Confirm whether this should be removed (global mimalloc) or kept.
    pub arena: &'a Arena,
    pub result: options::TransformResult,
    pub resolver: Resolver<'a>,
    // TODO(port): lifetime — Zig used the global `Fs.FileSystem.instance`
    // singleton (`&'static mut`). Raw ptr until the singleton accessor lands.
    pub fs: *mut Fs::FileSystem,
    pub output_files: Vec<options::OutputFile>,
    pub resolve_results: Box<ResolveResults>,
    pub resolve_queue: ResolveQueue,
    pub elapsed: u64,
    pub needs_runtime: bool,
    pub router: Option<Router<'a>>,
    pub source_map: options::SourceMapOption,

    // `ModuleLoader::transpile_source_code` (jsc_hooks.rs) calls
    // `transpiler.linker.link()` / reads `import_counter`. Back-pointers wired
    // by `configure_linker` below; `set_log` keeps `linker.log` in sync.
    pub linker: crate::linker::Linker,
    pub timer: SystemTimer,
    // TODO(port): lifetime — Zig stored `&DotEnv.Loader` (global singleton).
    pub env: *mut dot_env::Loader<'a>,

    pub macro_context: Option<js_ast::Macro::MacroContext>,
}

impl<'a> Transpiler<'a> {
    pub const IS_CACHE_ENABLED: bool = false;

    pub fn set_log(&mut self, log: *mut bun_ast::Log) {
        self.log = log;
        self.linker.log = log;
        // SAFETY: caller (`ThreadPool::Worker::create`) passes the per-worker
        // arena-allocated `Log`, which outlives this `Transpiler<'a>`. Zig
        // aliased the same `*Log` into `resolver.log`.
        self.resolver.log = core::ptr::NonNull::new(log).expect("set_log: log is non-null");
    }

    /// Port of `transpiler.zig:102 setAllocator`.
    // TODO: remove this method. it does not make sense
    pub fn set_arena(&mut self, arena: &'a Arena) {
        self.arena = arena;
        // PORT NOTE: `crate::Linker` is the unit stub — no `.arena` field.
        // `Resolver` dropped its `arena` field (global mimalloc; see
        // resolver/lib.rs `// arena: dropped`), so nothing left to thread.
    }

    /// VM-teardown: the owning `VirtualMachine` is raw-allocated and never `Drop`'d,
    /// so free `BundleOptions` here. `log`/`fs`/`env` are aliased/singletons; left alone.
    /// `resolver` is a value field whose caches alias process-global BSSMaps, so the
    /// resolver itself stays put — only its owned `opts` projection (cloned in
    /// `resolver_bundle_options_subset`) is released.
    ///
    /// # Safety
    /// Calls `drop_in_place` on `options` / `result` / `resolver.opts` /
    /// `resolve_results`, leaving them logically uninitialized. After this
    /// returns, `self` must never be dropped (or `deinit`'d again) — every
    /// caller holds a `Transpiler` that bypasses `Drop`: a raw-`dealloc`'d
    /// `VirtualMachine` field, a `MaybeUninit` stack slot, or an arena-backed
    /// `&'static mut`. Owned `Transpiler`s from [`Self::for_worker`] must use
    /// normal `Drop` instead.
    pub unsafe fn deinit(&mut self) {
        if let Some(ctx) = self.macro_context.take() {
            ctx.deinit();
        }
        // SAFETY: `options`, `result`, and `resolver.opts` are init'd and never
        // read past `destroy()` / the `--changed` scan teardown. Caller upholds
        // the no-auto-drop contract above.
        unsafe {
            core::ptr::drop_in_place(&raw mut self.options);
            core::ptr::drop_in_place(&raw mut self.result);
            core::ptr::drop_in_place(&raw mut self.resolver.opts);
            core::ptr::drop_in_place(&raw mut self.resolve_results);
        }
    }

    /// Shared borrow of the process-lifetime `Fs::FileSystem` singleton.
    #[inline]
    pub fn fs(&self) -> &Fs::FileSystem {
        // SAFETY: `self.fs` is set in `Transpiler::init` to the
        // `Fs::FileSystem::instance` singleton (process-lifetime, never null,
        // never freed). Reads of `top_level_dir` (the dominant use) are sound
        // even concurrently with `fs_mut()` callers because that field is
        // `&'static [u8]` written once at init.
        unsafe { &*self.fs }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn fs_mut<'r>(&self) -> &'r mut Fs::FileSystem {
        // SAFETY: `self.fs` is the non-null process-lifetime singleton (see
        // `fs()`). The unbounded `'r` mirrors the prior open-coded
        // `unsafe { &mut *self.fs }` — the pointee outlives any `'r` a caller
        // can name. Exclusive access is upheld by single-threaded use at each
        // call site (no two live `&mut FileSystem` overlap).
        unsafe { &mut *self.fs }
    }

    /// Shared read-only borrow of the `Log`. Use for `has_errors()` /
    /// `.errors` / `.warnings` checks; prefer [`Self::log_mut`] for writes.
    #[inline]
    pub fn log(&self) -> &bun_ast::Log {
        // SAFETY: `self.log` is non-null after `init` (set to the
        // caller-provided arena `Log`) and outlives `self`. Read-only access
        // here cannot conflict with the aliased raw copies in
        // `self.{resolver,linker,options}.log` (those are also reads or
        // serialized writes on the bundle thread).
        unsafe { &*self.log }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn log_mut<'r>(&self) -> &'r mut bun_ast::Log {
        // SAFETY: `self.log` is non-null after `init` (set to the
        // caller-provided arena `Log`) and outlives `self`. The unbounded `'r`
        // mirrors the prior open-coded `unsafe { &mut *self.log }`; the
        // aliased raw copies in `self.{resolver,linker,options}.log` are never
        // dereferenced while a `log_mut()` result is live (caller contract).
        unsafe { &mut *self.log }
    }

    /// Shared read-only borrow of the `DotEnv::Loader`. Prefer this over
    /// [`Self::env_mut`] when only inspecting env vars (e.g. `.get()`), so
    /// call sites can overlap with other `&` borrows of the same loader.
    #[inline]
    pub fn env(&self) -> &'a dot_env::Loader<'a> {
        // SAFETY: `self.env` is non-null after `init` — set to either the
        // caller-provided loader or the `dot_env::INSTANCE` singleton, both of
        // which live for at least `'a`. Shared access cannot conflict with the
        // raw aliases in `resolver.env_loader` (those are reads or serialized
        // writes on the same thread).
        unsafe { &*self.env }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn env_mut(&self) -> &'a mut dot_env::Loader<'a> {
        // SAFETY: `self.env` is non-null after `init` — set to either the
        // caller-provided loader or the `dot_env::INSTANCE` singleton, both of
        // which live for at least `'a`. No other live `&mut Loader` exists at
        // any call site (single-threaded; `resolver.env_loader` aliases as a
        // raw `NonNull`, never as a held `&mut`).
        unsafe { &mut *self.env }
    }

    /// Per-worker / client-transpiler constructor — port of Zig's
    /// `transpiler.* = from.*` (ThreadPool.zig:308, bundle_v2.zig:204).
    ///
    /// Zig structs have no destructors, so a bitwise struct copy that aliases
    /// heap-owning fields is sound there. In Rust the prior bitwise
    /// `ptr::copy_nonoverlapping` aliased every `Box`/`Vec` between parent and
    /// worker; reassigning any of them on the worker (e.g.
    /// `resolver.caches = ...`) ran `Drop` on the parent's allocation. This
    /// constructor instead handles each field explicitly: `Copy`/raw-pointer
    /// fields are copied, owned fields are deep-cloned via
    /// [`options::BundleOptions::for_worker`] / [`Resolver::for_worker`], and
    /// per-worker scratch (`result`, `output_files`, `resolve_queue`, …) is
    /// freshly default-constructed.
    ///
    /// The returned value is a normal owned `Transpiler` whose `Drop` is sound
    /// — no `MaybeUninit` / `ptr::write` field-overwrite contract is needed by
    /// callers. **Self-referential pointers are NOT yet wired** (the value may
    /// still be moved into its final slot); call [`Self::wire_after_move`]
    /// once the `Transpiler` is at its final address.
    ///
    /// # Safety
    /// `from` must outlive the returned `Transpiler<'a>`. The few
    /// lifetime-carrying borrows in `BundleOptions<'_>` / `Resolver<'_>`
    /// (`framework`, `optimize_imports`, `standalone_module_graph`,
    /// `env_loader`) are widened from `from`'s lifetime to `'a` via a
    /// layout-preserving transmute — sound because those reference
    /// process-lifetime data in every caller, but unprovable to borrowck.
    pub unsafe fn for_worker(
        from: &Transpiler<'_>,
        arena: &'a Arena,
        log: *mut bun_ast::Log,
    ) -> Transpiler<'a> {
        // Deep-clone the heavy nested fields at `from`'s lifetime, then
        // lifetime-widen to `'a`. Layout is identical (only the lifetime
        // parameter differs), so `transmute` is a no-op reinterpretation.
        // SAFETY: see fn doc.
        let options: options::BundleOptions<'a> = unsafe {
            core::mem::transmute::<options::BundleOptions<'_>, options::BundleOptions<'a>>(
                from.options.for_worker(),
            )
        };
        let resolver_opts = resolver_bundle_options_subset(&options);
        let log_nn = core::ptr::NonNull::new(log).expect("Transpiler::for_worker: log is non-null");
        // SAFETY: see fn doc — `Resolver::for_worker` widens
        // `standalone_module_graph` / `env_loader` lifetimes.
        let resolver: Resolver<'a> =
            unsafe { Resolver::for_worker(&from.resolver, log_nn, resolver_opts) };

        Transpiler {
            options,
            log,
            arena,
            // Per-worker scratch — Zig's bitwise copy carried these too, but
            // workers never read the parent's accumulated state.
            result: options::TransformResult::default(),
            resolver,
            fs: from.fs,
            output_files: Vec::new(),
            resolve_results: Box::new(ResolveResults::default()),
            resolve_queue: ResolveQueue::default(),
            elapsed: 0,
            needs_runtime: from.needs_runtime,
            // Router carries owned routes/config and is unused by bundle_v2
            // workers; per-worker fresh.
            router: None,
            source_map: from.source_map,
            // Self-referential — wired by `wire_after_move`. Null back-pointers
            // for now (matches `Transpiler::init`; never derefed before then).
            linker: crate::linker::Linker::init(
                log,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                from.fs,
            ),
            timer: SystemTimer::start().expect("Timer fail"),
            // SAFETY: lifetime-widen the `Loader<'from>` raw pointer to `'a`
            // (process-lifetime singleton; see fn doc).
            env: from.env.cast(),
            // Spec ThreadPool.zig:311 `MacroContext.init(transpiler)` takes the
            // transpiler's *address*; deferred to `wire_after_move`.
            macro_context: None,
        }
    }

    pub fn wire_after_move(&mut self) {
        // Spec: `transpiler.setLog(log)` already ran inside `for_worker` via
        // direct field init; re-thread into `options.log` / `resolver.log` /
        // `linker.log` here so all four aliases agree.
        let log = self.log;
        self.options.log = log;
        self.resolver.log = core::ptr::NonNull::new(log).expect("wire_after_move: log is non-null");
        self.resolver.fs = self.fs;
        self.linker.reseat_self_refs(
            log,
            core::ptr::addr_of_mut!(self.resolve_queue),
            core::ptr::addr_of_mut!(self.options).cast(),
            core::ptr::addr_of_mut!(self.resolver).cast(),
            core::ptr::addr_of_mut!(*self.resolve_results),
            self.fs,
        );
        // Spec ThreadPool.zig:311 `transpiler.macro_context = MacroContext.init(transpiler)`.
        self.macro_context = Some(js_ast::Macro::MacroContext::init(self));
    }

    /// Port of `transpiler.zig:91 getPackageManager`.
    #[inline]
    pub fn get_package_manager(&mut self) -> *mut dyn bun_resolver::install_types::AutoInstaller {
        self.resolver.get_package_manager()
    }

    /// Port of `transpiler.zig:358 resetStore`.
    pub fn reset_store(&self) {
        bun_ast::Expr::data_store_reset();
        bun_ast::Stmt::data_store_reset();
        if !bun_ast::stmt::data::Store::disable_reset()
            && bun_ast::stmt::data::Store::memory_allocator().is_null()
        {
            bun_ast::store_ast_alloc_heap::reset();
        }
    }

    /// Port of `transpiler.zig:108 _resolveEntryPoint`.
    fn _resolve_entry_point(
        &mut self,
        entry_point: &[u8],
    ) -> Result<resolver::Result, bun_core::Error> {
        let top_level_dir = self.fs().top_level_dir;
        match self.resolver.resolve_with_framework(
            top_level_dir,
            entry_point,
            bun_ast::ImportKind::EntryPointBuild,
        ) {
            Ok(r) => Ok(r),
            Err(err) => {
                // Relative entry points that were not resolved to a node_modules package are
                // interpreted as relative to the current working directory.
                if !bun_paths::is_absolute(entry_point)
                    && !(entry_point.starts_with(b"./") || entry_point.starts_with(b".\\"))
                {
                    // Spec: `strings.append(arena, "./", entry_point)`.
                    let mut prefixed = Vec::with_capacity(2 + entry_point.len());
                    prefixed.extend_from_slice(b"./");
                    prefixed.extend_from_slice(entry_point);
                    // PORT NOTE: spec leaks the prefixed slice (arena-freed in
                    // Zig). `Resolver::resolve` interns the path internally,
                    // so the heap buffer can drop after the call.
                    if let Ok(r) = self.resolver.resolve(
                        top_level_dir,
                        &prefixed,
                        bun_ast::ImportKind::EntryPointBuild,
                    ) {
                        return Ok(r);
                    }
                    // return the original error
                }
                Err(err)
            }
        }
    }

    /// Port of `transpiler.zig:130 resolveEntryPoint`.
    pub fn resolve_entry_point(
        &mut self,
        entry_point: &[u8],
    ) -> Result<resolver::Result, bun_core::Error> {
        match self._resolve_entry_point(entry_point) {
            Ok(r) => Ok(r),
            Err(err) => {
                let mut cache_bust_buf = bun_paths::PathBuffer::uninit();

                let busted: bool = 'name: {
                    if bun_paths::is_absolute(entry_point) {
                        let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                            entry_point,
                        );
                        if !dir.is_empty() {
                            // Normalized with trailing slash
                            let buster_name = bun_paths::string_paths::normalize_slashes_only(
                                &mut cache_bust_buf[..],
                                dir,
                                bun_paths::SEP,
                            );
                            break 'name self.resolver.bust_dir_cache(
                                bun_paths::string_paths::without_trailing_slash_windows_path(
                                    buster_name,
                                ),
                            );
                        }
                    }

                    // Spec: `bun.pathLiteral("..")` — `".."` is sep-agnostic.
                    let parts: [&[u8]; 2] = [entry_point, b".."];
                    let top_level_dir = self.fs().top_level_dir;

                    let buster_name = bun_paths::resolve_path::join_abs_string_buf_z::<
                        bun_paths::platform::Auto,
                    >(
                        top_level_dir, &mut cache_bust_buf[..], &parts
                    );
                    self.resolver.bust_dir_cache(
                        bun_paths::string_paths::without_trailing_slash_windows_path(
                            buster_name.as_bytes(),
                        ),
                    )
                };

                // Only re-query if we previously had something cached.
                if busted {
                    if let Ok(result) = self._resolve_entry_point(entry_point) {
                        return Ok(result);
                    }
                    // ignore this error, we will print the original error
                }

                self.log_mut().add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "{} resolving \"{}\" (entry point)",
                        err,
                        bstr::BStr::new(entry_point)
                    ),
                );
                Err(err)
            }
        }
    }

    /// Port of `transpiler.zig:314 configureDefines`.
    pub fn configure_defines(&mut self) -> Result<(), bun_core::Error> {
        if self.options.defines_loaded {
            return Ok(());
        }

        if self.options.target == options::Target::BunMacro {
            self.options.env.behavior = bun_options_types::schema::api::DotEnvBehavior::Prefix;
            self.options.env.prefix = Box::from(b"BUN_".as_slice());
        }

        self.run_env_loader(self.options.env.disable_default_env_files)?;

        let env_loader = self.env_mut();
        let mut is_production = env_loader.is_production();

        // Spec passed `&this.options.env` as a separate arg; `load_defines` now
        // reads `&self.env` internally so the disjoint borrow is resolved
        // inside the `&mut self` scope without `unsafe`.
        self.options.load_defines(self.arena, Some(env_loader))?;

        let mut is_development = false;
        if let Some(node_env) = self.options.define.dots.get(b"NODE_ENV".as_slice()) {
            if !node_env.is_empty() {
                if let Some(s) = node_env[0].data.value.e_string() {
                    if s.eql_comptime(b"production") {
                        is_production = true;
                    } else if s.eql_comptime(b"development") {
                        is_development = true;
                    }
                }
            }
        }

        if is_development {
            self.options.set_production(false);
            self.resolver.opts.set_production(false);
            self.options.force_node_env = options::ForceNodeEnv::Development;
            self.resolver.opts.force_node_env = options::ForceNodeEnv::Development;
        } else if is_production {
            self.options.set_production(true);
            self.resolver.opts.set_production(true);
        }
        Ok(())
    }

    pub fn sync_resolver_opts(&mut self) {
        self.resolver.opts = resolver_bundle_options_subset(&self.options);
    }

    /// Port of `transpiler.zig:363 dumpEnvironmentVariables`.
    #[cold]
    #[inline(never)]
    pub fn dump_environment_variables(&self) {
        use bun_js_printer::{Encoding, write_json_string};
        bun_core::Output::flush();
        let env = self.env_mut();
        let w = bun_core::Output::writer();
        let _ = w.write_all(b"{\n");
        let mut first = true;
        let mut it = env.map.iterator();
        while let Some(pair) = it.next() {
            if !first {
                let _ = w.write_all(b",\n");
            }
            first = false;
            let _ = w.write_all(b"  ");
            let _ = write_json_string::<_, { Encoding::Utf8 }>(&**pair.key_ptr, w);
            let _ = w.write_all(b": ");
            let _ = write_json_string::<_, { Encoding::Utf8 }>(&*pair.value_ptr.value, w);
        }
        let _ = w.write_all(b"\n}\n");
        bun_core::Output::flush();
    }
}

use bun_resolver::tsconfig_json::TSConfigJSON;

/// D042: resolver-side and bundler-side `jsx::Pragma` are now the SAME
/// nominal type (`bun_options_types::jsx::Pragma`). Identity clone; kept so
/// existing call sites compile unchanged.
#[inline(always)]
fn jsx_pragma_from_resolver(
    src: &bun_resolver::tsconfig_json::options::jsx::Pragma,
) -> crate::options_impl::jsx::Pragma {
    src.clone()
}

/// D042: types unified — delegate to the resolver's own
/// `TSConfigJSON::merge_jsx` (5-field conditional copy keyed on `jsx_flags`).
#[inline]
fn merge_tsconfig_jsx_into(tsconfig: &TSConfigJSON, out: &mut crate::options_impl::jsx::Pragma) {
    *out = tsconfig.merge_jsx(core::mem::take(out));
}

impl<'a> Transpiler<'a> {
    /// Port of `transpiler.zig:233 configureLinkerWithAutoJSX`.
    pub fn configure_linker_with_auto_jsx(&mut self, auto_jsx: bool) {
        self.linker = crate::linker::Linker::init(
            self.log,
            core::ptr::addr_of_mut!(self.resolve_queue),
            core::ptr::addr_of_mut!(self.options).cast(),
            core::ptr::addr_of_mut!(self.resolver).cast(),
            core::ptr::addr_of_mut!(*self.resolve_results),
            self.fs,
        );

        if auto_jsx {
            // Most of the time, this will already be cached
            let top_level_dir = self.fs().top_level_dir;
            if let Ok(Some(root_dir)) = self.resolver.read_dir_info(top_level_dir) {
                if let Some(tsconfig) = root_dir.tsconfig_json() {
                    // If we don't explicitly pass JSX, try to get it from the root tsconfig
                    if self.options.transform_options.jsx.is_none() {
                        self.options.jsx = jsx_pragma_from_resolver(&tsconfig.jsx);
                    }
                    self.options.emit_decorator_metadata = tsconfig.emit_decorator_metadata;
                    self.options.experimental_decorators = tsconfig.experimental_decorators;
                }
            }
        }
    }

    /// Port of `transpiler.zig:259 configureLinker`.
    #[inline]
    pub fn configure_linker(&mut self) {
        self.configure_linker_with_auto_jsx(true);
    }

    /// Port of `transpiler.zig:263 runEnvLoader`.
    pub fn run_env_loader(&mut self, skip_default_env: bool) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        use bun_options_types::schema::api::DotEnvBehavior;
        // Derived once up front; no other live `&mut` to this `Loader` exists
        // for the duration of this call (Zig accessed `this.env.*` freely).
        let env: &mut dot_env::Loader<'_> = self.env_mut();

        match self.options.env.behavior {
            DotEnvBehavior::prefix
            | DotEnvBehavior::load_all
            | DotEnvBehavior::load_all_without_inlining => {
                let was_production = self.options.production;
                env.load_process()?;
                let has_production_env = env.is_production();
                if !was_production && has_production_env {
                    self.options.set_production(true);
                    self.resolver.opts.set_production(true);
                }

                let top_level_dir = self.fs().top_level_dir;
                let dir_info = match self.resolver.read_dir_info(top_level_dir) {
                    Ok(Some(d)) => d,
                    _ => return Ok(()),
                };

                if let Some(tsconfig) = dir_info.tsconfig_json() {
                    merge_tsconfig_jsx_into(tsconfig, &mut self.options.jsx);
                }

                let Some(dir) = dir_info.get_entries(self.resolver.generation) else {
                    return Ok(());
                };
                // `get_entries` returns `*mut bun_resolver::fs::DirEntry`
                // (BSSMap-owned). `dot_env::Loader::load` takes
                // `impl DirEntryProbe` (bun_dotenv sits below `bun_resolver`
                // in the crate graph); `bun_resolver::fs::DirEntry` impls it.
                // SAFETY: BSSMap singleton owns `*dir`; single-threaded path —
                // sole `&mut` for the call.
                let dir: &mut bun_resolver::fs::DirEntry = unsafe { &mut *dir };

                let env_files: Vec<&[u8]> = self.options.env.files.iter().map(|f| &**f).collect();

                let suffix = if self.options.is_test() || env.is_test() {
                    dot_env::DotEnvFileSuffix::Test
                } else if self.options.production {
                    dot_env::DotEnvFileSuffix::Production
                } else {
                    dot_env::DotEnvFileSuffix::Development
                };
                env.load(dir, &env_files, suffix, skip_default_env)?;
            }
            DotEnvBehavior::disable => {
                env.load_process()?;
                if env.is_production() {
                    self.options.set_production(true);
                    // Spec transpiler.zig:302 — see note in the `.prefix` arm.
                    self.resolver.opts.set_production(true);
                }
            }
            DotEnvBehavior::_none => {}
        }

        if env.get(b"BUN_DISABLE_TRANSPILER").unwrap_or(b"0") == b"1" {
            self.options.disable_transpilation = true;
        }
        Ok(())
    }
}

use crate::bun_node_fallbacks as NodeFallbackModules;
use crate::entry_points as EntryPoints;
use bun_ast::RuntimeTranspilerCache;
use bun_core::strings;
use bun_resolver::package_json::MacroMap as MacroRemap;
use bun_sys::Fd as FD;

/// Port of `transpiler.zig:ParseResult.AlreadyBundled` (tagged union).
#[derive(Default)]
pub enum AlreadyBundled {
    #[default]
    None,
    SourceCode,
    SourceCodeCjs,
    Bytecode(Box<[u8]>),
    BytecodeCjs(Box<[u8]>),
}

impl AlreadyBundled {
    pub fn bytecode_slice(&self) -> &[u8] {
        match self {
            AlreadyBundled::Bytecode(slice) | AlreadyBundled::BytecodeCjs(slice) => slice,
            _ => &[],
        }
    }

    pub fn is_bytecode(&self) -> bool {
        matches!(
            self,
            AlreadyBundled::Bytecode(_) | AlreadyBundled::BytecodeCjs(_)
        )
    }

    pub fn is_common_js(&self) -> bool {
        matches!(
            self,
            AlreadyBundled::SourceCodeCjs | AlreadyBundled::BytecodeCjs(_)
        )
    }
}

pub struct ParseResult<'a> {
    pub source: bun_ast::Source,
    pub loader: options::Loader,
    pub ast: bun_ast::Ast<'a>,
    pub already_bundled: AlreadyBundled,
    pub input_fd: Option<FD>,
    pub empty: bool,
    pub pending_imports: Vec<resolver::PendingResolution>,

    /// Zig: `?*bun.RuntimeTranspilerCache`. SAFETY: erased — bundler stores it
    /// and hands it back to the runtime side; never dereferenced here.
    pub runtime_transpiler_cache: Option<core::ptr::NonNull<RuntimeTranspilerCache>>,

    pub source_contents_backing: resolver::cache::Contents,
}

impl<'a> ParseResult<'a> {
    pub fn empty(arena: &'a bun_alloc::Arena) -> Self {
        ParseResult {
            source: Default::default(),
            loader: options::Loader::File,
            ast: bun_ast::Ast::empty_in(arena),
            already_bundled: Default::default(),
            input_fd: None,
            empty: true,
            pending_imports: Default::default(),
            runtime_transpiler_cache: None,
            source_contents_backing: Default::default(),
        }
    }
}

impl<'a> ParseResult<'a> {
    #[inline]
    fn empty_with(
        arena: &'a bun_alloc::Arena,
        source: bun_ast::Source,
        loader: options::Loader,
        input_fd: Option<FD>,
        source_contents_backing: resolver::cache::Contents,
    ) -> Self {
        ParseResult {
            source,
            loader,
            ast: bun_ast::Ast::empty_in(arena),
            already_bundled: AlreadyBundled::None,
            input_fd,
            empty: true,
            pending_imports: Default::default(),
            runtime_transpiler_cache: None,
            source_contents_backing,
        }
    }

    pub fn is_pending_import(&self, id: u32) -> bool {
        // Spec transpiler.zig:43-47: scan `pending_imports.items(.import_record_id)` for `id`.
        // PORT NOTE: AoS scan (see field comment); SoA column iteration restored
        // when `PendingResolution: MultiArrayElement` lands.
        self.pending_imports
            .iter()
            .any(|p| p.import_record_id == id)
    }
}

/// Port of `transpiler.zig:Transpiler.ParseOptions`.
pub struct ParseOptions<'a, 'b> {
    pub arena: &'a Arena,
    pub dirname_fd: FD,
    pub file_descriptor: Option<FD>,
    pub file_hash: Option<u32>,

    /// On exception, we might still want to watch the file.
    pub file_fd_ptr: Option<&'b mut FD>,

    pub path: bun_paths::fs::Path<'static>,
    pub loader: options::Loader,
    /// `BundleOptions.jsx` — the file-backed `options_impl::jsx::Pragma`, NOT
    /// the lib.rs shim. Callers pass `transpiler.options.jsx.clone()`.
    pub jsx: crate::options_impl::jsx::Pragma,
    pub macro_remappings: MacroRemap,
    pub macro_js_ctx: MacroJSCtx,
    pub virtual_source: Option<&'b bun_ast::Source>,
    /// Zig: `runtime.Runtime.Features.ReplaceableExport.Map`.
    pub replace_exports: bun_collections::StringArrayHashMap<bun_ast::runtime::ReplaceableExport>,
    pub inject_jest_globals: bool,
    pub set_breakpoint_on_first_line: bool,
    pub emit_decorator_metadata: bool,
    pub experimental_decorators: bool,
    pub remove_cjs_module_wrapper: bool,

    pub dont_bundle_twice: bool,
    pub allow_commonjs: bool,
    pub module_type: options::ModuleType,

    pub runtime_transpiler_cache: Option<&'b mut RuntimeTranspilerCache>,

    pub keep_json_and_toml_as_one_statement: bool,
    pub allow_bytecode_cache: bool,
}

use bun_options_types::schema::api;

#[inline]
pub(crate) fn to_parser_jsx_pragma(
    mut p: crate::options_impl::jsx::Pragma,
) -> js_ast::parser::options::JSX::Pragma {
    use crate::options_impl::jsx::Runtime;
    if p.runtime == Runtime::_None {
        p.runtime = Runtime::Automatic;
    }
    p
}

// `crate::options_impl::ModuleType` IS `js_ast::parser::options::ModuleType`
// (both re-export `bun_options_types::bundle_enums::ModuleType`). Identity shim
// kept so existing call sites compile unchanged; inlines to a move.
#[inline(always)]
fn to_parser_module_type(
    m: crate::options_impl::ModuleType,
) -> js_ast::parser::options::ModuleType {
    m
}

fn init_file_system(
    top_level_dir: Option<&'static [u8]>,
) -> Result<*mut Fs::FileSystem, bun_core::Error> {
    Fs::FileSystem::init(top_level_dir)
}

#[cold]
#[inline(never)]
pub(crate) fn resolver_bundle_options_subset(
    src: &options::BundleOptions<'_>,
) -> resolver::options::BundleOptions {
    use resolver::options as ropts;

    ropts::BundleOptions {
        target: src.target,
        packages: match src.packages {
            options::PackagesOption::External => ropts::Packages::External,
            options::PackagesOption::Bundle => ropts::Packages::Bundle,
        },
        // D042: same nominal type on both sides.
        jsx: src.jsx.clone(),
        // Spec `options.ResolveFileExtensions` — clone all four owned slices so
        // the resolver honours user `--extension-order` and the per-target
        // `.node` augmentation `from_api` applied.
        extension_order: ropts::ExtensionOrder {
            default: ropts::ExtensionOrderGroup {
                default: src.extension_order.default.default.clone(),
                esm: src.extension_order.default.esm.clone(),
            },
            node_modules: ropts::ExtensionOrderGroup {
                default: src.extension_order.node_modules.default.clone(),
                esm: src.extension_order.node_modules.esm.clone(),
            },
            css: ropts::owned_string_list(ropts::bundle_options::defaults::CSS_EXTENSION_ORDER),
        },
        conditions: ropts::Conditions {
            import: src.conditions.import.clone().expect("oom"),
            require: src.conditions.require.clone().expect("oom"),
            style: src.conditions.style.clone().expect("oom"),
        },
        external: src.external.clone(),
        extra_cjs_extensions: src.extra_cjs_extensions.clone(),
        framework: src.framework.map(|f| {
            // Bundler-local `bake_types::BuiltInModule` and
            // `bun_options_types::BuiltInModule` are nominally distinct (the
            // former predates the TYPE_ONLY move-down); convert variant-wise.
            use crate::bake_types::BuiltInModule as B;
            use bun_options_types::BuiltInModule as R;
            let mut m = bun_collections::StringArrayHashMap::default();
            for (k, v) in f
                .built_in_modules
                .keys()
                .iter()
                .zip(f.built_in_modules.values().iter())
            {
                let rv = match v {
                    B::Import(p) => R::Import(p.clone()),
                    B::Code(c) => R::Code(c.clone()),
                };
                m.put(k, rv).expect("oom");
            }
            ropts::Framework {
                built_in_modules: m,
            }
        }),
        global_cache: src.global_cache,
        // Spec `options.zig:1753`: `?*const Api.BunInstall` — both sides store
        // `Option<NonNull<api::BunInstall>>`, so this is a straight copy.
        install: src.install,
        load_package_json: src.load_package_json,
        load_tsconfig_json: src.load_tsconfig_json,
        main_field_extension_order: ropts::owned_string_list(src.main_field_extension_order),
        main_fields: src.main_fields.clone(),
        main_fields_is_default: src.transform_options.main_fields.is_empty(),
        mark_builtins_as_external: src.mark_builtins_as_external,
        polyfill_node_globals: src.polyfill_node_globals,
        prefer_offline_install: src.prefer_offline_install,
        preserve_symlinks: src.preserve_symlinks,
        rewrite_jest_for_tests: src.rewrite_jest_for_tests,
        tsconfig_override: src.tsconfig_override.clone(),
        production: src.production,
        force_node_env: src.force_node_env,
        output_dir: src.output_dir.clone(),
        root_dir: src.root_dir.clone(),
        public_path: src.public_path.clone(),
        compile: src.compile,
        supports_multiple_outputs: src.supports_multiple_outputs,
        tree_shaking: src.tree_shaking,
        allow_runtime: src.allow_runtime,
    }
}

impl<'a> Transpiler<'a> {
    pub fn init(
        arena: &'a Arena,
        log: *mut bun_ast::Log,
        opts: api::TransformOptions,
        env_loader_: Option<*mut dot_env::Loader<'static>>,
    ) -> Result<Transpiler<'a>, bun_core::Error> {
        let mut slot = core::mem::MaybeUninit::<Transpiler<'a>>::uninit();
        Self::init_in_place(&mut slot, arena, log, opts, env_loader_)?;
        // SAFETY: `init_in_place` returned `Ok`, so every field of `slot` was
        // written exactly once.
        Ok(unsafe { slot.assume_init() })
    }

    pub fn init_in_place(
        dst: &mut core::mem::MaybeUninit<Transpiler<'a>>,
        arena: &'a Arena,
        log: *mut bun_ast::Log,
        opts: api::TransformOptions,
        env_loader_: Option<*mut dot_env::Loader<'static>>,
    ) -> Result<(), bun_core::Error> {
        // Caller contract: `log` is the freshly-boxed per-VM `Log` from
        // `VirtualMachine::init` and is never null. Validate up front so the
        // deref sites below go through `NonNull` rather than the raw argument.
        let log_nn =
            core::ptr::NonNull::new(log).expect("Transpiler::init_in_place: log is non-null");
        // TODO(port): narrow error set
        bun_ast::expr::data::Store::create();
        bun_ast::stmt::data::Store::create();
        let cwd: Option<&'static [u8]> = match opts.absolute_working_dir.as_deref() {
            Some(s) => Some(Fs::DirnameStore::instance().append_slice(s)?),
            None => None,
        };
        let fs: *mut Fs::FileSystem = init_file_system(cwd)?;

        let env_loader: *mut dot_env::Loader<'static> = match env_loader_ {
            Some(l) => l,
            None => match dot_env::instance() {
                Some(l) => l,
                None => {
                    let map: *mut dot_env::Map =
                        bun_core::heap::into_raw(Box::new(dot_env::Map::init()));
                    // SAFETY: `map` is a fresh heap allocation with no other
                    // alias; `Loader` stores it for process lifetime and is
                    // itself installed into `dot_env::INSTANCE` below.
                    bun_core::heap::into_raw(Box::new(dot_env::Loader::init(unsafe { &mut *map })))
                }
            },
        };

        if dot_env::instance().is_none() {
            dot_env::set_instance(env_loader);
        }

        // hide elapsed time when loglevel is warn or error
        // SAFETY: caller contract — `log` is the freshly-boxed per-VM `Log`
        // (`VirtualMachine::init`), `env_loader` is either caller-owned or the
        // leak above; no other live `&mut` to either at this point.
        unsafe {
            (*env_loader).quiet = !log_nn.as_ref().level.at_least(bun_ast::Level::Info);
        }

        // `log` stays raw — `from_api` stores it in `BundleOptions.log: *mut`
        // and the same pointer is aliased into `Resolver::init1` / `Linker`
        // / the struct field below (Zig aliased `*Log` everywhere). No `&'a
        // mut Log` is materialized here, so the sibling raw pointers don't
        // invalidate a long-lived unique borrow under stacked borrows.
        // SAFETY: `fs` is the process-lifetime `Fs::FileSystem` singleton from
        // `init_file_system` above; this short `&mut *fs` is the only live
        // borrow for the duration of `from_api`.
        let bundle_options = options::BundleOptions::from_api(unsafe { &mut *fs }, log, opts)?;

        let resolver_opts = resolver_bundle_options_subset(&bundle_options);

        let outbase = bundle_options.output_dir.clone();
        let resolve_results = Box::new(ResolveResults::default());

        let p = dst.as_mut_ptr();
        // SAFETY: `dst` is an exclusively-borrowed, currently-uninitialised
        // `MaybeUninit<Transpiler>`; each `write` initialises a distinct field
        // and no field is read before it is written. `env_loader.cast()` matches
        // the field's `*mut Loader<'a>` (raw-pointer lifetime reinterpretation —
        // the pointee is the process-lifetime singleton or caller-supplied
        // loader, as in the original struct literal).
        unsafe {
            core::ptr::addr_of_mut!((*p).options).write(bundle_options);
            core::ptr::addr_of_mut!((*p).log).write(log_nn.as_ptr());
            core::ptr::addr_of_mut!((*p).arena).write(arena);
            core::ptr::addr_of_mut!((*p).result).write(options::TransformResult {
                outbase,
                ..Default::default()
            });
            core::ptr::addr_of_mut!((*p).resolver).write(Resolver::init1(
                log_nn,
                fs,
                resolver_opts,
            ));
            core::ptr::addr_of_mut!((*p).fs).write(fs);
            core::ptr::addr_of_mut!((*p).output_files).write(Vec::new());
            core::ptr::addr_of_mut!((*p).resolve_results).write(resolve_results);
            core::ptr::addr_of_mut!((*p).resolve_queue).write(ResolveQueue::default());
            core::ptr::addr_of_mut!((*p).elapsed).write(0);
            core::ptr::addr_of_mut!((*p).needs_runtime).write(false);
            core::ptr::addr_of_mut!((*p).router).write(None);
            core::ptr::addr_of_mut!((*p).source_map).write(options::SourceMapOption::None);
            // .thread_pool = pool,
            core::ptr::addr_of_mut!((*p).linker).write(crate::linker::Linker::init(
                log,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                fs,
            ));
            core::ptr::addr_of_mut!((*p).timer).write(SystemTimer::start().expect("Timer fail"));
            core::ptr::addr_of_mut!((*p).env).write(env_loader.cast());
            core::ptr::addr_of_mut!((*p).macro_context).write(None);
        }
        Ok(())
    }

    pub fn parse(
        &mut self,
        this_parse: ParseOptions<'a, '_>,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult<'a>> {
        self.parse_maybe_return_file_only::<false>(this_parse, client_entry_point_)
    }

    pub fn parse_maybe_return_file_only<const RETURN_FILE_ONLY: bool>(
        &mut self,
        this_parse: ParseOptions<'a, '_>,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult<'a>> {
        self.parse_maybe_return_file_only_allow_shared_buffer::<RETURN_FILE_ONLY, false>(
            this_parse,
            client_entry_point_,
        )
    }

    pub fn parse_maybe_return_file_only_allow_shared_buffer<
        const RETURN_FILE_ONLY: bool,
        const USE_SHARED_BUFFER: bool,
    >(
        &mut self,
        mut this_parse: ParseOptions<'a, '_>,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult<'a>> {
        let arena = this_parse.arena;
        let dirname_fd = this_parse.dirname_fd;
        let file_descriptor = this_parse.file_descriptor;
        let file_hash = this_parse.file_hash;
        let path = this_parse.path;
        let loader = this_parse.loader;
        let log: &mut bun_ast::Log = self.log_mut();

        let mut input_fd: Option<FD> = None;
        let mut source_backing: resolver::cache::Contents = resolver::cache::Contents::Empty;

        // PORT NOTE: Zig `&brk: { ... }` took the address of a temporary; Rust
        // owns the value and borrows it after the block.
        let source: &'a bun_ast::Source = arena.alloc('brk: {
            if let Some(virtual_source) = this_parse.virtual_source {
                break 'brk virtual_source.clone();
            }

            if let Some(client_entry_point) = client_entry_point_ {
                // Zig: if (@hasField(Child, "source")) — ClientEntryPoint always has it.
                break 'brk client_entry_point.source.clone();
            }

            if path.namespace == b"node" {
                if let Some(code) = NodeFallbackModules::contents_from_path(path.text) {
                    break 'brk bun_ast::Source::init_path_string(path.text, code);
                }

                break 'brk bun_ast::Source::init_path_string(path.text, b"");
            }

            if strings::has_prefix_comptime(path.text, b"data:") {
                use bun_resolver::data_url::DataURL;
                let data_url = match DataURL::parse_without_check(path.text) {
                    Ok(u) => u,
                    Err(err) => {
                        let _ = log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "{} parsing data url \"{}\"",
                                bstr::BStr::new(err.name()),
                                bstr::BStr::new(path.text),
                            ),
                        );
                        return None;
                    }
                };
                let body = match data_url.decode_data() {
                    Ok(b) => b,
                    Err(err) => {
                        let _ = log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "{} decoding data \"{}\"",
                                bstr::BStr::new(err.name()),
                                bstr::BStr::new(path.text),
                            ),
                        );
                        return None;
                    }
                };
                source_backing = resolver::cache::Contents::from(body);
                // SAFETY: `source_backing` is moved into the returned
                // `ParseResult` (or drops on `return None`); the re-borrow is
                // sound for the lifetime of `source.contents`' consumers, which
                // never outlive the `ParseResult`. A real lifetime can be
                // threaded once `bun_ast::Source.contents` becomes `Cow`.
                let contents: &'static [u8] =
                    unsafe { bun_ptr::detach_lifetime_ref::<[u8]>(source_backing.as_slice()) };
                break 'brk bun_ast::Source::init_path_string(path.text, contents);
            }

            let mut entry = match self.resolver.caches.fs.read_file_with_allocator(
                self.fs_mut(),
                path.text,
                dirname_fd,
                USE_SHARED_BUFFER,
                file_descriptor,
                if USE_SHARED_BUFFER { None } else { Some(arena) },
            ) {
                Ok(e) => e,
                Err(err) => {
                    let _ = log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "{} reading \"{}\"",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(path.text),
                        ),
                    );
                    return None;
                }
            };
            input_fd = Some(entry.fd);
            if let Some(file_fd_ptr) = this_parse.file_fd_ptr {
                *file_fd_ptr = entry.fd;
            }
            source_backing = core::mem::take(&mut entry.contents);
            // SAFETY: `source_backing` outlives every read through
            // `source.contents` (it is moved into the returned `ParseResult`,
            // and the only consumers are the parser/printer which run before
            // the result drops). `contents_is_recycled = true` records that
            // the bytes are externally-owned; threading `'bump` would remove
            // the erasure.
            let contents: &'static [u8] =
                unsafe { bun_ptr::detach_lifetime_ref::<[u8]>(source_backing.as_slice()) };
            match bun_ast::Source::init_recycled_file(&bun_ast::PathContentsPair { path, contents })
            {
                Ok(s) => break 'brk s,
                Err(_) => return None,
            }
        });

        if RETURN_FILE_ONLY {
            return Some(ParseResult::empty_with(
                arena,
                source.clone(),
                loader,
                input_fd,
                source_backing,
            ));
        }

        if source.contents.is_empty()
            || (source.contents.len() < 33 && strings::trim(&source.contents, b"\n\r ").is_empty())
        {
            if !loader.handles_empty_file() {
                return Some(ParseResult::empty_with(
                    arena,
                    source.clone(),
                    loader,
                    input_fd,
                    source_backing,
                ));
            }
        }

        match loader {
            options::Loader::Js
            | options::Loader::Jsx
            | options::Loader::Ts
            | options::Loader::Tsx => {
                // wasm magic number
                if source.is_web_assembly() {
                    return Some(ParseResult::empty_with(
                        arena,
                        source.clone(),
                        options::Loader::Wasm,
                        input_fd,
                        source_backing,
                    ));
                }

                let target = self.options.target;

                let mut jsx = this_parse.jsx;
                jsx.parse = loader.is_jsx();
                let _ = &this_parse.macro_remappings;

                use js_ast::parser::options as p_opts;
                let mut opts = js_ast::ParserOptions::<'_> {
                    ts: loader.is_typescript(),
                    jsx: to_parser_jsx_pragma(jsx),
                    keep_names: true,
                    ignore_dce_annotations: self.options.ignore_dce_annotations,
                    preserve_unused_imports_ts: false,
                    use_define_for_class_fields: false,
                    suppress_warnings_about_weird_code: true,
                    filepath_hash_for_hmr: file_hash.unwrap_or(0),
                    features: js_ast::RuntimeFeatures::default(),
                    tree_shaking: self.options.tree_shaking,
                    bundle: false,
                    code_splitting: false,
                    package_version: b"",
                    macro_context: None,
                    warn_about_unbundled_modules: !target.is_bun(),
                    allow_unresolved: &p_opts::AllowUnresolved::DEFAULT,
                    module_type: to_parser_module_type(this_parse.module_type),
                    output_format: p_opts::Format::Esm,
                    transform_only: self.options.transform_only,
                    import_meta_main_value: None,
                    lower_import_meta_main_for_node_js: false,
                    framework: None,
                    repl_mode: self.options.repl_mode,
                };

                opts.features.emit_decorator_metadata = this_parse.emit_decorator_metadata;
                // emitDecoratorMetadata implies legacy/experimental decorators, as it only
                // makes sense with TypeScript's legacy decorator system (reflect-metadata).
                // TC39 standard decorators have their own metadata mechanism.
                opts.features.standard_decorators = !loader.is_typescript()
                    || !(this_parse.experimental_decorators || this_parse.emit_decorator_metadata);
                opts.features.allow_runtime = self.options.allow_runtime;
                opts.features.set_breakpoint_on_first_line =
                    this_parse.set_breakpoint_on_first_line;
                opts.features.trim_unused_imports = self
                    .options
                    .trim_unused_imports
                    .unwrap_or_else(|| loader.is_typescript());
                opts.features.no_macros = self.options.no_macros;
                let rtc_ptr: Option<core::ptr::NonNull<RuntimeTranspilerCache>> = this_parse
                    .runtime_transpiler_cache
                    .as_deref_mut()
                    .map(core::ptr::NonNull::from);
                opts.features.runtime_transpiler_cache = rtc_ptr.map(core::ptr::NonNull::as_ptr);

                // @bun annotation
                opts.features.dont_bundle_twice = this_parse.dont_bundle_twice;

                opts.features.commonjs_at_runtime = this_parse.allow_commonjs;

                opts.features.inlining = self.options.inlining;
                opts.features.auto_import_jsx = self.options.auto_import_jsx;
                // JavaScriptCore implements `using` / `await using` natively, so
                // when targeting Bun there is no need to lower them.
                opts.features.lower_using = !target.is_bun();

                opts.features.inject_jest_globals = this_parse.inject_jest_globals;
                opts.features.minify_syntax = self.options.minify_syntax;
                opts.features.minify_identifiers = self.options.minify_identifiers;
                opts.features.dead_code_elimination = self.options.dead_code_elimination;
                opts.features.remove_cjs_module_wrapper = this_parse.remove_cjs_module_wrapper;
                opts.features.bundler_feature_flags = self
                    .options
                    .bundler_feature_flags
                    .as_deref()
                    .and_then(|s| s.clone().ok().map(Box::new));
                opts.features.repl_mode = self.options.repl_mode;

                // we'll just always enable top-level await
                // this is incorrect for Node.js files which are CommonJS modules
                opts.features.top_level_await = true;

                opts.features.is_macro_runtime = target == crate::options_impl::Target::BunMacro;
                opts.features.replace_exports = bun_ast::runtime::ReplaceableExportMap {
                    entries: this_parse.replace_exports,
                };

                if self.macro_context.is_none() {
                    let ctx = js_ast::Macro::MacroContext::init(self);
                    self.macro_context = Some(ctx);
                }
                if target != crate::options_impl::Target::BunMacro {
                    // SAFETY: `is_none()` check above guarantees `Some` here.
                    self.macro_context.as_mut().unwrap().javascript_object =
                        this_parse.macro_js_ctx;
                }
                // `crate::defines::Define` IS
                // `bun_js_parser::defines::Define`. Hand the parser the real
                // table so user `--define` values apply at parse time.
                let define: &'a js_ast::defines::Define;
                // SAFETY: `self.options.define` / `self.macro_context` are
                // owned by the long-lived `Transpiler`; the parser borrows
                // them for `'a` (arena lifetime). Erase to `'a` so the
                // returned `Ast<'a>` is not pinned to the `&mut self` borrow
                // — neither field is dropped while a parse is in flight
                // (Zig held `*const Define` / `*MacroContext`).
                unsafe {
                    let define_ptr: *const js_ast::defines::Define =
                        &raw const *self.options.define;
                    define = &*define_ptr;
                    opts.macro_context = self
                        .macro_context
                        .as_mut()
                        .map(|m| &mut *core::ptr::from_mut(m));
                }

                let parsed = match crate::cache::JavaScript::init()
                    .parse(arena, opts, define, log, source)
                {
                    Ok(Some(r)) => r,
                    Ok(None) | Err(_) => return None,
                };
                return Some(match parsed {
                    js_ast::Result::Ast(value) => ParseResult {
                        ast: *value,
                        source: source.clone(),
                        loader,
                        input_fd,
                        runtime_transpiler_cache: rtc_ptr,
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        empty: false,
                        source_contents_backing: source_backing,
                    },
                    js_ast::Result::Cached => ParseResult {
                        // TODO(port): Zig used `undefined` for ast here.
                        ast: bun_ast::Ast::empty_in(arena),
                        runtime_transpiler_cache: rtc_ptr,
                        source: source.clone(),
                        loader,
                        input_fd,
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        empty: false,
                        source_contents_backing: source_backing,
                    },
                    js_ast::Result::AlreadyBundled(already_bundled) => ParseResult {
                        // TODO(port): Zig used `undefined` for ast here.
                        ast: bun_ast::Ast::empty_in(arena),
                        already_bundled: match already_bundled {
                            js_ast::AlreadyBundled::Bun => AlreadyBundled::SourceCode,
                            js_ast::AlreadyBundled::BunCjs => AlreadyBundled::SourceCodeCjs,
                            js_ast::AlreadyBundled::BytecodeCjs
                            | js_ast::AlreadyBundled::Bytecode => 'brk: {
                                let is_cjs =
                                    matches!(already_bundled, js_ast::AlreadyBundled::BytecodeCjs);
                                let default_value = if is_cjs {
                                    AlreadyBundled::SourceCodeCjs
                                } else {
                                    AlreadyBundled::SourceCode
                                };
                                if this_parse.virtual_source.is_none()
                                    && this_parse.allow_bytecode_cache
                                {
                                    // PORT NOTE: `bun.bytecode_extension`
                                    // (bun.zig:3502) — no Rust const re-export
                                    // in `bun_core` yet, so inline the literal.
                                    const BYTECODE_EXT: &[u8] = b".jsc";
                                    let mut path_buf2 = bun_paths::PathBuffer::uninit();
                                    let n = path.text.len();
                                    path_buf2[..n].copy_from_slice(path.text);
                                    path_buf2[n..][..BYTECODE_EXT.len()]
                                        .copy_from_slice(BYTECODE_EXT);
                                    let total = n + BYTECODE_EXT.len();
                                    // PathBuffer is zero-initialized so
                                    // `path_buf2[total] == 0` already; safe to
                                    // borrow as a NUL-terminated ZStr.
                                    let zpath = bun_core::ZStr::from_buf(&path_buf2[..], total);
                                    let dir = dirname_fd.unwrap_valid().unwrap_or_else(FD::cwd);
                                    match bun_sys::File::read_from(dir, zpath) {
                                        Ok(contents) if !contents.is_empty() => {
                                            break 'brk if is_cjs {
                                                AlreadyBundled::BytecodeCjs(
                                                    contents.into_boxed_slice(),
                                                )
                                            } else {
                                                AlreadyBundled::Bytecode(
                                                    contents.into_boxed_slice(),
                                                )
                                            };
                                        }
                                        _ => {}
                                    }
                                }
                                default_value
                            }
                        },
                        source: source.clone(),
                        loader,
                        input_fd,
                        pending_imports: Default::default(),
                        runtime_transpiler_cache: None,
                        empty: false,
                        source_contents_backing: source_backing,
                    },
                });
            }
            // TODO: use lazy export AST
            options::Loader::Toml
            | options::Loader::Yaml
            | options::Loader::Json
            | options::Loader::Jsonc
            | options::Loader::Json5 => {
                return parse_data_loader(
                    source,
                    loader,
                    input_fd,
                    source_backing,
                    arena,
                    log,
                    this_parse.keep_json_and_toml_as_one_statement,
                );
            }
            options::Loader::Text => {
                return parse_text_loader(source, loader, input_fd, source_backing, arena);
            }
            options::Loader::Md => {
                return parse_md_loader(source, loader, input_fd, source_backing, arena, log);
            }
            options::Loader::Wasm => {
                return parse_wasm_loader(
                    source,
                    loader,
                    input_fd,
                    source_backing,
                    arena,
                    &path,
                    self.options.target,
                    log,
                );
            }
            options::Loader::Css => {}
            options::Loader::File
            | options::Loader::Napi
            | options::Loader::Base64
            | options::Loader::Dataurl
            | options::Loader::Bunsh
            | options::Loader::Sqlite
            | options::Loader::SqliteEmbedded
            | options::Loader::Html => parse_unsupported_loader(loader, &path),
        }

        None
    }
}

#[cold]
#[inline(never)]
fn parse_data_loader<'a>(
    source: &bun_ast::Source,
    loader: options::Loader,
    input_fd: Option<FD>,
    source_backing: resolver::cache::Contents,
    arena: &'a Arena,
    log: &mut bun_ast::Log,
    keep_json_and_toml_as_one_statement: bool,
) -> Option<ParseResult<'a>> {
    let value_expr: bun_ast::Expr = match loader {
        options::Loader::Jsonc => {
            // We allow importing tsconfig.*.json or jsconfig.*.json with comments
            // These files implicitly become JSONC files, which aligns with the behavior of text editors.
            match bun_parsers::json::parse_ts_config::<false>(source, log, arena) {
                Ok(e) => e,
                Err(_) => return None,
            }
        }
        options::Loader::Json => match bun_parsers::json::parse::<false>(source, log, arena) {
            Ok(e) => e,
            Err(_) => return None,
        },
        options::Loader::Toml => match bun_parsers::toml::TOML::parse(source, log, arena, false) {
            Ok(e) => e,
            Err(_) => return None,
        },
        options::Loader::Yaml => match bun_parsers::yaml::YAML::parse(source, log, arena) {
            Ok(e) => e,
            Err(_) => return None,
        },
        options::Loader::Json5 => {
            match bun_parsers::json5::JSON5Parser::parse(source, log, arena) {
                Ok(e) => e,
                Err(_) => return None,
            }
        }
        // SAFETY: outer match arm guarantees one of the five.
        _ => unsafe { core::hint::unreachable_unchecked() },
    };
    let mut expr = value_expr;

    let mut symbols: Vec<bun_ast::Symbol> = Vec::new();

    let parts: Box<[bun_ast::Part]> = 'parts: {
        if keep_json_and_toml_as_one_statement {
            let stmt = bun_ast::Stmt::allocate(
                arena,
                bun_ast::S::SExpr {
                    value: expr,
                    ..Default::default()
                },
                bun_ast::Loc { start: 0 },
            );
            // PERF(port): was `arena.alloc(Stmt, 1) catch unreachable`.
            let stmts = bun_ast::StoreSlice::new_mut(arena.alloc_slice_copy(&[stmt]));
            break 'parts Box::new([bun_ast::Part {
                stmts,
                ..Default::default()
            }]);
        }

        if let Some(obj) = expr.data.e_object_mut() {
            let properties: &mut [bun_ast::G::Property] = obj.properties.slice_mut();
            if !properties.is_empty() {
                let n = properties.len();
                let mut decls: Vec<bun_ast::G::Decl> = vec![bun_ast::G::Decl::default(); n];

                symbols.resize_with(n, Default::default);
                // PORT NOTE: `S::ExportClause.items: *mut [ClauseItem]`
                // is arena-owned; `ClauseItem: Default` so
                // `alloc_slice_fill_default` is fine.
                let export_clauses = arena.alloc_slice_fill_default::<bun_ast::ClauseItem>(n);
                let mut duplicate_key_checker: bun_collections::StringHashMap<u32> =
                    bun_collections::StringHashMap::default();
                // duplicate_key_checker drops at end of scope (defer .deinit())
                let mut count: usize = 0;
                // PORT NOTE: reshaped for borrowck — cannot zip 4
                // slices with one mutable borrow into `decls` and
                // also random-access `decls[prev]`.
                for i in 0..n {
                    let prop = &mut properties[i];
                    // SAFETY: data-format parsers always emit
                    // `e_string` keys (Zig `.?.data.e_string`).
                    let key = prop.key.as_mut().unwrap();
                    let key_loc = key.loc;
                    let name: &[u8] = key
                        .data
                        .e_string_mut()
                        .expect("infallible: variant checked")
                        .slice(arena);
                    // Do not make named exports for "default" exports
                    if name == b"default" {
                        continue;
                    }

                    let visited = match duplicate_key_checker.get_or_put(name) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if visited.found_existing {
                        decls[*visited.value_ptr as usize].value =
                            Some(prop.value.expect("infallible: prop has value"));
                        continue;
                    }
                    *visited.value_ptr = count as u32;

                    symbols[count] = bun_ast::Symbol {
                        original_name: match bun_core::MutableString::ensure_valid_identifier(name)
                        {
                            // Spec transpiler.zig:1049 calls
                            // `MutableString.ensureValidIdentifier(name, arena)`
                            // — the identifier lives in the
                            // per-parse arena. Arena-copy the
                            // owned `Box<[u8]>` so it is freed
                            // with the arena instead of leaking
                            // (PORTING.md §Forbidden patterns
                            // bars `heap::alloc` for `&'static`).
                            // SAFETY: ARENA — `arena` outlives
                            // the returned `ParseResult.ast`.
                            Ok(boxed) => bun_ast::StoreStr::new(arena.alloc_slice_copy(&boxed)),
                            Err(_) => return None,
                        },
                        ..Default::default()
                    };

                    let ref_ = bun_ast::Ref::init(count as u32, 0, false);
                    decls[count] = bun_ast::G::Decl {
                        binding: bun_ast::Binding::alloc(
                            arena,
                            bun_ast::b::Identifier { r#ref: ref_ },
                            key_loc,
                        ),
                        value: Some(prop.value.expect("infallible: prop has value")),
                    };
                    export_clauses[count] = bun_ast::ClauseItem {
                        name: bun_ast::LocRef {
                            ref_: Some(ref_),
                            loc: key_loc,
                        },
                        alias: bun_ast::StoreStr::new(name),
                        alias_loc: key_loc,
                        ..Default::default()
                    };
                    let value_loc = prop.value.expect("infallible: prop has value").loc;
                    prop.value = Some(bun_ast::Expr::init_identifier(ref_, value_loc));
                    count += 1;
                }

                decls.truncate(count);
                let stmt0 = bun_ast::Stmt::alloc(
                    bun_ast::S::Local {
                        decls: bun_ast::G::DeclList::move_from_list(decls),
                        kind: bun_ast::S::Kind::KVar,
                        ..Default::default()
                    },
                    bun_ast::Loc { start: 0 },
                );
                let stmt1 = bun_ast::Stmt::alloc(
                    bun_ast::S::ExportClause {
                        items: bun_ast::StoreSlice::new_mut(&mut export_clauses[..count]),
                        is_single_line: false,
                    },
                    bun_ast::Loc { start: 0 },
                );
                let stmt2 = bun_ast::Stmt::alloc(
                    bun_ast::S::ExportDefault {
                        value: bun_ast::StmtOrExpr::Expr(expr),
                        default_name: bun_ast::LocRef {
                            loc: bun_ast::Loc::default(),
                            ref_: Some(bun_ast::Ref::NONE),
                        },
                    },
                    bun_ast::Loc { start: 0 },
                );

                let stmts =
                    bun_ast::StoreSlice::new_mut(arena.alloc_slice_copy(&[stmt0, stmt1, stmt2]));
                break 'parts Box::new([bun_ast::Part {
                    stmts,
                    ..Default::default()
                }]);
            }
        }

        {
            let stmt = bun_ast::Stmt::alloc(
                bun_ast::S::ExportDefault {
                    value: bun_ast::StmtOrExpr::Expr(expr),
                    default_name: bun_ast::LocRef {
                        loc: bun_ast::Loc::default(),
                        ref_: Some(bun_ast::Ref::NONE),
                    },
                },
                bun_ast::Loc { start: 0 },
            );

            let stmts = bun_ast::StoreSlice::new_mut(arena.alloc_slice_copy(&[stmt]));
            break 'parts Box::new([bun_ast::Part {
                stmts,
                ..Default::default()
            }]);
        }
    };
    let mut ast = bun_ast::Ast::from_parts(parts, arena);
    ast.symbols = bun_alloc::vec_from_iter_in(symbols, arena);

    return Some(ParseResult {
        ast,
        source: source.clone(),
        loader,
        input_fd,
        already_bundled: AlreadyBundled::None,
        pending_imports: Default::default(),
        runtime_transpiler_cache: None,
        empty: false,
        source_contents_backing: source_backing,
    });
}

#[cold]
#[inline(never)]
fn parse_text_loader<'a>(
    source: &bun_ast::Source,
    loader: options::Loader,
    input_fd: Option<FD>,
    source_backing: resolver::cache::Contents,
    arena: &'a Arena,
) -> Option<ParseResult<'a>> {
    let expr = bun_ast::Expr::init(
        bun_ast::E::EString::init(&source.contents),
        bun_ast::Loc::EMPTY,
    );
    let stmt = bun_ast::Stmt::alloc(
        bun_ast::S::ExportDefault {
            value: bun_ast::StmtOrExpr::Expr(expr),
            default_name: bun_ast::LocRef {
                loc: bun_ast::Loc::default(),
                ref_: Some(bun_ast::Ref::NONE),
            },
        },
        bun_ast::Loc { start: 0 },
    );
    // PERF(port): was `arena.alloc(Stmt, 1) catch unreachable`.
    let stmts = bun_ast::StoreSlice::new_mut(arena.alloc_slice_copy(&[stmt]));
    let parts: Box<[bun_ast::Part]> = Box::new([bun_ast::Part {
        stmts,
        ..Default::default()
    }]);

    return Some(ParseResult {
        ast: bun_ast::Ast::from_parts(parts, arena),
        source: source.clone(),
        loader,
        input_fd,
        already_bundled: AlreadyBundled::None,
        pending_imports: Default::default(),
        runtime_transpiler_cache: None,
        empty: false,
        source_contents_backing: source_backing,
    });
}

#[cold]
#[inline(never)]
fn parse_md_loader<'a>(
    source: &bun_ast::Source,
    loader: options::Loader,
    input_fd: Option<FD>,
    source_backing: resolver::cache::Contents,
    arena: &'a Arena,
    log: &mut bun_ast::Log,
) -> Option<ParseResult<'a>> {
    let html: &'static [u8] = match bun_md::root::render_to_html(&source.contents) {
        // Spec transpiler.zig:1162 allocates the rendered HTML via
        // `arena` (the per-parse arena), so it is freed with the
        // arena. Arena-copy the heap `Box<[u8]>` and let it drop;
        // PORTING.md §Forbidden patterns bars `Box::leak` here.
        // SAFETY: ARENA — `arena` outlives the returned
        // `ParseResult.ast` (the AST crate's `Str` convention erases
        // `'bump` to `'static` for `E::String.data`).
        Ok(h) => unsafe { bun_ptr::detach_lifetime(arena.alloc_slice_copy(&h)) },
        Err(_) => {
            let _ = log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!("Failed to render markdown to HTML"),
            );
            return None;
        }
    };
    let expr = bun_ast::Expr::init(bun_ast::E::EString::init(html), bun_ast::Loc::EMPTY);
    let stmt = bun_ast::Stmt::alloc(
        bun_ast::S::ExportDefault {
            value: bun_ast::StmtOrExpr::Expr(expr),
            default_name: bun_ast::LocRef {
                loc: bun_ast::Loc::default(),
                ref_: Some(bun_ast::Ref::NONE),
            },
        },
        bun_ast::Loc { start: 0 },
    );
    let stmts = bun_ast::StoreSlice::new_mut(arena.alloc_slice_copy(&[stmt]));
    let parts: Box<[bun_ast::Part]> = Box::new([bun_ast::Part {
        stmts,
        ..Default::default()
    }]);

    return Some(ParseResult {
        ast: bun_ast::Ast::from_parts(parts, arena),
        source: source.clone(),
        loader,
        input_fd,
        already_bundled: AlreadyBundled::None,
        pending_imports: Default::default(),
        runtime_transpiler_cache: None,
        empty: false,
        source_contents_backing: source_backing,
    });
}

#[cold]
#[inline(never)]
fn parse_wasm_loader<'a>(
    source: &bun_ast::Source,
    loader: options::Loader,
    input_fd: Option<FD>,
    source_backing: resolver::cache::Contents,
    arena: &'a Arena,
    path: &bun_paths::fs::Path<'static>,
    target: options::Target,
    log: &mut bun_ast::Log,
) -> Option<ParseResult<'a>> {
    if target.is_bun() {
        if !source.is_web_assembly() {
            let _ = log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "Invalid wasm file \"{}\" (missing magic header)",
                    bstr::BStr::new(path.text)
                ),
            );
            return None;
        }

        return Some(ParseResult {
            ast: bun_ast::Ast::empty_in(arena),
            source: source.clone(),
            loader,
            input_fd,
            already_bundled: AlreadyBundled::None,
            pending_imports: Default::default(),
            runtime_transpiler_cache: None,
            empty: false,
            source_contents_backing: source_backing,
        });
    }
    None
}

#[cold]
#[inline(never)]
fn parse_unsupported_loader(loader: options::Loader, path: &bun_paths::fs::Path<'static>) -> ! {
    // Spec transpiler.zig:1216 — programmer-error hard crash, NOT a
    // silent `None` (PORTING.md §Forbidden: silent no-op).
    bun_core::Output::panic(format_args!(
        "Unsupported loader {:?} for path: {}",
        loader,
        bstr::BStr::new(path.text),
    ));
}

use bun_js_printer as js_printer;
use js_printer::analyze_transpiled_module;

#[inline]
fn to_bundle_enums_target(t: crate::options_impl::Target) -> bun_ast::Target {
    use bun_ast::Target as T;
    match t {
        crate::options_impl::Target::Browser => T::Browser,
        crate::options_impl::Target::Bun => T::Bun,
        crate::options_impl::Target::BunMacro => T::BunMacro,
        crate::options_impl::Target::Node => T::Node,
        crate::options_impl::Target::BakeServerComponentsSsr => T::BakeServerComponentsSsr,
    }
}

/// Re-export so `bun_bundler::PrintFormat::EsmAscii` (AsyncModule.rs:1018)
/// resolves once `lib.rs` `pub use transpiler::*` lands.
pub use js_printer::Format as PrintFormat;

impl<'a> Transpiler<'a> {
    fn print_with_source_map_maybe<const ENABLE_SOURCE_MAP: bool>(
        &mut self,
        print_arena: &Arena,
        mut ast: bun_ast::Ast,
        source: &bun_ast::Source,
        writer: &mut js_printer::BufferPrinter,
        format: js_printer::Format,
        source_map_context: Option<js_printer::SourceMapHandler<'_>>,
        runtime_transpiler_cache: Option<core::ptr::NonNull<RuntimeTranspilerCache>>,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error> {
        let arena = *ast.symbols.allocator();
        let symbols = bun_ast::symbol::Map::init_with_one_list(
            core::mem::replace(&mut ast.symbols, bun_alloc::ArenaVec::new_in(arena))
                .into_iter()
                .collect(),
        );

        let exports_kind = ast.exports_kind;

        match format {
            js_printer::Format::Cjs => self.print_cjs_cold::<ENABLE_SOURCE_MAP>(
                print_arena,
                writer,
                &ast,
                symbols,
                source,
                source_map_context,
                runtime_transpiler_cache,
            ),

            js_printer::Format::Esm => self.print_esm_cold::<ENABLE_SOURCE_MAP>(
                print_arena,
                writer,
                &ast,
                symbols,
                source,
                source_map_context,
                runtime_transpiler_cache,
            ),

            js_printer::Format::EsmAscii => {
                if self.options.target.is_bun() {
                    self.print_ast_esm_ascii::<ENABLE_SOURCE_MAP, true>(
                        print_arena,
                        writer,
                        &ast,
                        symbols,
                        source,
                        source_map_context,
                        exports_kind,
                        runtime_transpiler_cache,
                        module_info,
                    )
                } else {
                    self.print_ast_esm_ascii_not_bun_cold::<ENABLE_SOURCE_MAP>(
                        print_arena,
                        writer,
                        &ast,
                        symbols,
                        source,
                        source_map_context,
                        exports_kind,
                        runtime_transpiler_cache,
                        module_info,
                    )
                }
            }

            // Spec transpiler.zig:672 `else => unreachable`.
            js_printer::Format::CjsAscii => unreachable!(),
        }
    }

    // PERF: cold thunk — see `print_with_source_map_maybe` comment. Body is
    // verbatim from the former `Format::Cjs` match arm; `#[cold]` moves the
    // `print_common_js::<W,false,SM>` Printer<…> tree to `.text.unlikely`.
    #[cold]
    #[inline(never)]
    #[allow(clippy::too_many_arguments)]
    fn print_cjs_cold<const ENABLE_SOURCE_MAP: bool>(
        &mut self,
        print_arena: &Arena,
        writer: &mut js_printer::BufferPrinter,
        ast: &bun_ast::Ast,
        symbols: bun_ast::symbol::Map,
        source: &bun_ast::Source,
        source_map_context: Option<js_printer::SourceMapHandler<'_>>,
        runtime_transpiler_cache: Option<core::ptr::NonNull<RuntimeTranspilerCache>>,
    ) -> Result<usize, bun_core::Error> {
        js_printer::print_common_js::<_, false, ENABLE_SOURCE_MAP>(
            writer,
            print_arena,
            ast,
            symbols,
            source,
            js_printer::Options {
                bundling: false,
                runtime_imports: ast.runtime_imports.clone(),
                require_ref: Some(ast.require_ref),
                css_import_behavior: self.options.css_import_behavior(),
                source_map_handler: source_map_context,
                minify_whitespace: self.options.minify_whitespace,
                minify_syntax: self.options.minify_syntax,
                minify_identifiers: self.options.minify_identifiers,
                transform_only: self.options.transform_only,
                print_dce_annotations: self.options.emit_dce_annotations,
                runtime_transpiler_cache,
                hmr_ref: ast.wrapper_ref,
                mangled_props: None,
                ..Default::default()
            },
        )
    }

    // PERF: cold thunk — see `print_with_source_map_maybe` comment. Body is
    // verbatim from the former `Format::Esm` match arm; `#[cold]` moves the
    // `print_ast::<W,false,SM>` Printer<…> tree to `.text.unlikely`.
    #[cold]
    #[inline(never)]
    #[allow(clippy::too_many_arguments)]
    fn print_esm_cold<const ENABLE_SOURCE_MAP: bool>(
        &mut self,
        print_arena: &Arena,
        writer: &mut js_printer::BufferPrinter,
        ast: &bun_ast::Ast,
        symbols: bun_ast::symbol::Map,
        source: &bun_ast::Source,
        source_map_context: Option<js_printer::SourceMapHandler<'_>>,
        runtime_transpiler_cache: Option<core::ptr::NonNull<RuntimeTranspilerCache>>,
    ) -> Result<usize, bun_core::Error> {
        let opts = js_printer::Options {
            bundling: false,
            runtime_imports: ast.runtime_imports.clone(),
            require_ref: Some(ast.require_ref),
            css_import_behavior: self.options.css_import_behavior(),
            source_map_handler: source_map_context,
            minify_whitespace: self.options.minify_whitespace,
            minify_syntax: self.options.minify_syntax,
            minify_identifiers: self.options.minify_identifiers,
            transform_only: self.options.transform_only,
            import_meta_ref: ast.import_meta_ref,
            print_dce_annotations: self.options.emit_dce_annotations,
            runtime_transpiler_cache,
            hmr_ref: ast.wrapper_ref,
            mangled_props: None,
            ..Default::default()
        };
        js_printer::print_ast::<_, false, ENABLE_SOURCE_MAP>(
            writer,
            // Per-call scratch arena (rope flattening) — same as the Cjs arm.
            print_arena,
            ast,
            symbols,
            source,
            opts,
        )
    }

    #[cold]
    #[inline(never)]
    #[allow(clippy::too_many_arguments)]
    fn print_ast_esm_ascii_not_bun_cold<const ENABLE_SOURCE_MAP: bool>(
        &mut self,
        print_arena: &Arena,
        writer: &mut js_printer::BufferPrinter,
        ast: &bun_ast::Ast,
        symbols: bun_ast::symbol::Map,
        source: &bun_ast::Source,
        source_map_context: Option<js_printer::SourceMapHandler<'_>>,
        exports_kind: bun_ast::ExportsKind,
        runtime_transpiler_cache: Option<core::ptr::NonNull<RuntimeTranspilerCache>>,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error> {
        self.print_ast_esm_ascii::<ENABLE_SOURCE_MAP, false>(
            print_arena,
            writer,
            ast,
            symbols,
            source,
            source_map_context,
            exports_kind,
            runtime_transpiler_cache,
            module_info,
        )
    }

    // PORT NOTE: hoisted from `inline else => |is_bun|` arm of
    // print_with_source_map_maybe to express the comptime bool dispatch as a
    // const generic.
    #[allow(clippy::too_many_arguments)]
    fn print_ast_esm_ascii<const ENABLE_SOURCE_MAP: bool, const IS_BUN: bool>(
        &mut self,
        print_arena: &Arena,
        writer: &mut js_printer::BufferPrinter,
        ast: &bun_ast::Ast,
        symbols: bun_ast::symbol::Map,
        source: &bun_ast::Source,
        source_map_context: Option<js_printer::SourceMapHandler<'_>>,
        exports_kind: bun_ast::ExportsKind,
        runtime_transpiler_cache: Option<js_printer::RuntimeTranspilerCacheRef>,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error> {
        // Spec transpiler.zig:662-663 — both set on this (EsmAscii) arm only.
        // SAFETY: `module_info` is `ModuleInfo::create`'s `heap::alloc` (or
        // null); it is exclusively owned by this print call until T6 reclaims
        // it after `print_with_source_map` returns.
        let module_info = module_info.map(|p| unsafe { &mut *p });
        let opts = js_printer::Options {
            bundling: false,
            runtime_imports: ast.runtime_imports.clone(),
            require_ref: Some(ast.require_ref),
            css_import_behavior: self.options.css_import_behavior(),
            source_map_handler: source_map_context,
            minify_whitespace: self.options.minify_whitespace,
            minify_syntax: self.options.minify_syntax,
            minify_identifiers: self.options.minify_identifiers,
            transform_only: self.options.transform_only,
            module_type: if IS_BUN && self.options.transform_only {
                // this is for when using `bun build --no-bundle`
                // it should copy what was passed for the cli
                self.options.output_format
            } else if exports_kind == bun_ast::ExportsKind::Cjs {
                options::Format::Cjs
            } else {
                options::Format::Esm
            },
            inline_require_and_import_errors: false,
            import_meta_ref: ast.import_meta_ref,
            print_dce_annotations: self.options.emit_dce_annotations,
            runtime_transpiler_cache,
            module_info,
            hmr_ref: ast.wrapper_ref,
            mangled_props: None,
            target: to_bundle_enums_target(self.options.target),
            ..Default::default()
        };
        js_printer::print_ast::<_, IS_BUN, ENABLE_SOURCE_MAP>(
            writer,
            // Per-call scratch arena (rope flattening) — same as the Cjs arm.
            print_arena,
            ast,
            symbols,
            source,
            opts,
        )
    }

    #[inline(never)]
    pub fn print(
        &mut self,
        print_arena: &Arena,
        result: ParseResult,
        writer: &mut js_printer::BufferPrinter,
        format: js_printer::Format,
    ) -> Result<usize, bun_core::Error> {
        self.print_with_source_map_maybe::<false>(
            print_arena,
            result.ast,
            &result.source,
            writer,
            format,
            None,
            None,
            None,
        )
    }

    #[inline(never)]
    pub fn print_with_source_map(
        &mut self,
        print_arena: &Arena,
        result: ParseResult,
        writer: &mut js_printer::BufferPrinter,
        format: js_printer::Format,
        handler: js_printer::SourceMapHandler<'_>,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error> {
        // PORT NOTE: env_var feature_flag getters return `Option<bool>`
        // (Some(default) when unset); Zig's `.get()` is plain `bool`.
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS
            .get()
            .unwrap_or(false)
        {
            return self.print_with_source_map_maybe::<false>(
                print_arena,
                result.ast,
                &result.source,
                writer,
                format,
                Some(handler),
                result.runtime_transpiler_cache,
                module_info,
            );
        }
        self.print_with_source_map_maybe::<true>(
            print_arena,
            result.ast,
            &result.source,
            writer,
            format,
            Some(handler),
            result.runtime_transpiler_cache,
            module_info,
        )
    }

    #[inline(never)]
    pub fn print_skip_source_map(
        &mut self,
        print_arena: &Arena,
        result: ParseResult,
        writer: &mut js_printer::BufferPrinter,
        format: js_printer::Format,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error> {
        self.print_with_source_map_maybe::<false>(
            print_arena,
            result.ast,
            &result.source,
            writer,
            format,
            None,
            result.runtime_transpiler_cache,
            module_info,
        )
    }

    /// Port of `transpiler.zig:1225 normalizeEntryPointPath`.
    fn normalize_entry_point_path(&self, _entry: &[u8]) -> &'static [u8] {
        let fs = self.fs();
        let entry = fs.abs(&[_entry]);

        // Spec: `std.fs.accessAbsolute(entry, .{}) catch return _entry` — if the
        // absolutized path does not exist on disk, return the original input
        // unchanged so bare specifiers (`react`) and URLs are left alone.
        if !bun_sys::exists(entry) {
            return crate::linker::dupe(_entry);
        }

        let entry = fs.relative_to(entry);

        if !strings::starts_with(entry, b"./") {
            let mut __entry = Vec::with_capacity(2 + entry.len());
            __entry.extend_from_slice(b"./");
            __entry.extend_from_slice(entry);
            return crate::linker::dupe(&__entry);
        }
        crate::linker::dupe(entry)
    }

    fn enqueue_entry_points<const NORMALIZE_ENTRY_POINT: bool>(&mut self) -> usize {
        let mut entry_point_i: usize = 0;

        // PORT NOTE: snapshot entry points so the `&mut self` resolver call
        // does not conflict with the `&self.options` borrow.
        let entries: Vec<Box<[u8]>> = self.options.entry_points.to_vec();
        let top_level_dir = self.fs().top_level_dir;

        for _entry in entries.iter() {
            let entry: &[u8] = if NORMALIZE_ENTRY_POINT {
                self.normalize_entry_point_path(_entry)
            } else {
                _entry
            };

            let _reset = bun_ast::StoreResetGuard::new();

            let result = match self.resolver.resolve(
                top_level_dir,
                entry,
                bun_ast::ImportKind::EntryPointBuild,
            ) {
                Ok(r) => r,
                Err(err) => {
                    bun_core::Output::pretty_error(format_args!(
                        "Error resolving \"{}\": {}\n",
                        bstr::BStr::new(entry),
                        err.name(),
                    ));
                    continue;
                }
            };

            if result.path_const().is_none() {
                bun_core::Output::pretty_error(format_args!(
                    "\"{}\" is disabled due to \"browser\" field in package.json.\n",
                    bstr::BStr::new(entry),
                ));
                continue;
            }

            if self
                .linker
                .enqueue_resolve_result(result)
                .expect("unreachable")
            {
                entry_point_i += 1;
            }
        }

        entry_point_i
    }

    /// Port of `transpiler.zig:1286 transform`.
    pub fn transform(
        &mut self,
        log: *mut bun_ast::Log,
        _opts: api::TransformOptions,
    ) -> Result<options::TransformResult, bun_core::Error> {
        let _ = self.enqueue_entry_points::<true>();

        // `log` is the same `*mut Log` stored on `self.log`; caller
        // (`BuildCommand::exec`) holds it for the process lifetime.
        let _ = log;
        if self.log().level.at_least(bun_ast::Level::Debug) {
            self.resolver.debug_logs = Some(resolver::DebugLogs::init()?);
        }
        self.options.transform_only = true;

        if self.options.output_dir_handle.is_none() {
            let outstream = TransformOutstream::Stdout;
            match self.options.import_path_format {
                options::ImportPathFormat::Relative => {
                    self.process_resolve_queue(options::ImportPathFormat::Relative, outstream)?;
                }
                options::ImportPathFormat::AbsoluteUrl => {
                    self.process_resolve_queue(options::ImportPathFormat::AbsoluteUrl, outstream)?;
                }
                options::ImportPathFormat::AbsolutePath => {
                    self.process_resolve_queue(options::ImportPathFormat::AbsolutePath, outstream)?;
                }
                options::ImportPathFormat::PackagePath => {
                    self.process_resolve_queue(options::ImportPathFormat::PackagePath, outstream)?;
                }
            }
        } else {
            let Some(output_dir) = self.options.output_dir_handle else {
                bun_core::Output::print_error("Invalid or missing output directory.");
                bun_core::Global::crash();
            };
            let outstream = TransformOutstream::Dir(output_dir);
            match self.options.import_path_format {
                options::ImportPathFormat::Relative => {
                    self.process_resolve_queue(options::ImportPathFormat::Relative, outstream)?;
                }
                options::ImportPathFormat::AbsoluteUrl => {
                    self.process_resolve_queue(options::ImportPathFormat::AbsoluteUrl, outstream)?;
                }
                options::ImportPathFormat::AbsolutePath => {
                    self.process_resolve_queue(options::ImportPathFormat::AbsolutePath, outstream)?;
                }
                options::ImportPathFormat::PackagePath => {
                    self.process_resolve_queue(options::ImportPathFormat::PackagePath, outstream)?;
                }
            }
        }

        if bun_core::FeatureFlags::TRACING
            && self.options.log().level.at_least(bun_ast::Level::Info)
        {
            bun_core::Output::pretty_errorln(format_args!(
                "<r><d>\n---Tracing---\nResolve time:      {}\nParsing time:      {}\n---Tracing--\n\n<r>",
                self.resolver.elapsed, self.elapsed,
            ));
        }

        let outbase: Box<[u8]> = self.result.outbase.clone();
        let output_files: Box<[options::OutputFile]> =
            std::mem::take(&mut self.output_files).into_boxed_slice();
        // SAFETY: see above (`self.log` is the same pointer as `log`).
        let mut final_result =
            options::TransformResult::init(outbase, output_files, unsafe { &mut *self.log })?;
        final_result.root_dir = self.options.output_dir_handle;
        Ok(final_result)
    }

    /// Port of `transpiler.zig:1344 processResolveQueue` (with
    /// `wrap_entry_point = false`, the only value passed by the in-tree caller).
    fn process_resolve_queue(
        &mut self,
        import_path_format: options::ImportPathFormat,
        outstream: TransformOutstream,
    ) -> Result<(), bun_core::Error> {
        while let Some(item) = self.resolve_queue.pop_front() {
            bun_ast::Expr::data_store_reset();
            bun_ast::Stmt::data_store_reset();
            bun_ast::store_ast_alloc_heap::reset();

            let output_file = match self.build_with_resolve_result_eager(
                &item,
                import_path_format,
                outstream,
                None,
            ) {
                Ok(Some(f)) => f,
                Ok(None) | Err(_) => continue,
            };
            self.output_files.push(output_file);
        }
        Ok(())
    }

    /// Port of `transpiler.zig:380 buildWithResolveResultEager`.
    fn build_with_resolve_result_eager(
        &mut self,
        resolve_result: &resolver::Result,
        import_path_format: options::ImportPathFormat,
        _outstream: TransformOutstream,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Result<Option<options::OutputFile>, bun_core::Error> {
        if resolve_result.flags.is_external() {
            return Ok(None);
        }

        let Some(file_path_ref) = resolve_result.path_const() else {
            return Ok(None);
        };
        let file_path_text: &'static [u8] = crate::linker::dupe(file_path_ref.text);
        let file_path_ext: &'static [u8] = crate::linker::dupe(file_path_ref.name().ext);

        let loader = self.options.loader(file_path_ext);

        // `client_entry_point_` is always `None` from the only in-tree caller;
        // its source path uses the `bun_paths::fs::Path<'static>` shape, so just override
        // text/ext when present.
        let (file_path_text, file_path_ext) = if let Some(cep) = client_entry_point_.as_deref() {
            (
                crate::linker::dupe(cep.source.path.text),
                crate::linker::dupe(cep.source.path.name().ext),
            )
        } else {
            (file_path_text, file_path_ext)
        };

        let mut file_path = Fs::Path::init(file_path_text);

        let top_level_dir = self.fs().top_level_dir;
        let rel = bun_paths::resolve_path::relative(top_level_dir, file_path_text);
        file_path.pretty = crate::linker::dupe(rel);

        let mut output_file = options::OutputFile::zero_value();
        output_file.src_path = bun_paths::fs::Path::init(file_path_text);
        output_file.loader = loader;
        output_file.output_kind = options::OutputKind::Chunk;
        output_file.side = None;
        output_file.entry_point_index = None;

        match loader {
            options::Loader::Jsx
            | options::Loader::Tsx
            | options::Loader::Js
            | options::Loader::Ts
            | options::Loader::Json
            | options::Loader::Jsonc
            | options::Loader::Toml
            | options::Loader::Yaml
            | options::Loader::Json5
            | options::Loader::Text
            | options::Loader::Md => {
                // PORT NOTE: borrowck — `parse` consumes `&mut self`, so capture
                // the option fields needed for `ParseOptions` first.
                let jsx = jsx_pragma_from_resolver(&resolve_result.jsx);
                let dirname_fd = resolve_result.dirname_fd;
                let emit_decorator_metadata = resolve_result.flags.emit_decorator_metadata();
                let experimental_decorators = resolve_result.flags.experimental_decorators();
                // TODO(port): `MacroRemap` (StringArrayHashMap of StringArrayHashMap)
                // has no nested `Clone` impl; the Zig copied it by value. Re-key
                // shallowly here matching the build-command conversion.
                let macro_remappings = {
                    let mut m = MacroRemap::default();
                    for (k, v) in self.options.macro_remap.iter() {
                        let inner = v.clone().map_err(|_| bun_core::err!("OutOfMemory"))?;
                        m.insert(k, inner);
                    }
                    m
                };

                let parse_opts = ParseOptions {
                    arena: self.arena,
                    path: bun_paths::fs::Path::init(file_path_text),
                    loader,
                    dirname_fd,
                    file_descriptor: None,
                    file_hash: None,
                    file_fd_ptr: None,
                    macro_remappings,
                    macro_js_ctx: default_macro_js_value(),
                    jsx,
                    emit_decorator_metadata,
                    experimental_decorators,
                    virtual_source: None,
                    replace_exports: Default::default(),
                    inject_jest_globals: false,
                    set_breakpoint_on_first_line: false,
                    remove_cjs_module_wrapper: false,
                    dont_bundle_twice: false,
                    allow_commonjs: false,
                    module_type: options::ModuleType::Unknown,
                    runtime_transpiler_cache: None,
                    keep_json_and_toml_as_one_statement: false,
                    allow_bytecode_cache: false,
                };

                let Some(mut result) = self.parse(parse_opts, client_entry_point_) else {
                    return Ok(None);
                };

                if !self.options.transform_only {
                    let origin = self.options.origin.url();
                    if !self.options.target.is_bun() {
                        self.linker.link::<false, false>(
                            &file_path,
                            &mut result,
                            &origin,
                            import_path_format,
                        )?;
                    } else {
                        self.linker.link::<false, true>(
                            &file_path,
                            &mut result,
                            &origin,
                            import_path_format,
                        )?;
                    }
                }

                let buffer_writer = js_printer::BufferWriter::init();
                let mut writer = js_printer::BufferPrinter::init(buffer_writer);

                // Same `self.arena` that `parse_opts.arena` used to build
                // `result.ast` above. (`bun build` is one-shot — `self.arena`
                // here is `cli_arena()` and lives for the process.)
                let print_arena: &Arena = self.arena;
                output_file.size = match self.options.target {
                    options::Target::Browser | options::Target::Node => {
                        self.print(print_arena, result, &mut writer, js_printer::Format::Esm)?
                    }
                    options::Target::Bun
                    | options::Target::BunMacro
                    | options::Target::BakeServerComponentsSsr => self.print(
                        print_arena,
                        result,
                        &mut writer,
                        js_printer::Format::EsmAscii,
                    )?,
                };
                output_file.value = crate::output_file::Value::Buffer {
                    bytes: writer.ctx.written().to_vec().into_boxed_slice(),
                };
            }
            options::Loader::Dataurl | options::Loader::Base64 => {
                bun_core::Output::panic(format_args!("TODO: dataurl, base64"));
            }
            options::Loader::Css => {
                match self.build_css_output(
                    file_path_text,
                    resolve_result.dirname_fd,
                    file_path.pretty,
                ) {
                    Some(v) => output_file.value = v,
                    None => return Ok(None),
                }
            }
            options::Loader::Html
            | options::Loader::Bunsh
            | options::Loader::SqliteEmbedded
            | options::Loader::Sqlite
            | options::Loader::Wasm
            | options::Loader::File
            | options::Loader::Napi => {
                output_file.value = self.build_copied_file_output(file_path_text, file_path_ext)?;
            }
        }

        Ok(Some(output_file))
    }

    #[cold]
    #[inline(never)]
    fn build_css_output(
        &mut self,
        file_path_text: &'static [u8],
        dirname_fd: FD,
        file_path_pretty: &[u8],
    ) -> Option<crate::output_file::Value> {
        use crate::bun_css;

        let entry = match self.resolver.caches.fs.read_file_with_allocator(
            self.fs_mut(),
            file_path_text,
            dirname_fd,
            false,
            None,
            None,
        ) {
            Ok(e) => e,
            Err(err) => {
                let _ = self.log_mut().add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "{} reading \"{}\"",
                        err.name(),
                        bstr::BStr::new(file_path_pretty),
                    ),
                );
                return None;
            }
        };

        // The `ParserOptions.logger` `NonNull<Log>` borrow is
        // dropped when `sheet`/`opts` go out of scope at the end of
        // this arm, before any other `log_mut()` reborrow above.
        let mut opts = bun_css::ParserOptions::default(None);
        opts.logger = Some(core::ptr::NonNull::new(self.log).unwrap());
        const CSS_MODULE_SUFFIX: &[u8] = b".module.css";
        let enable_css_modules = file_path_text.len() > CSS_MODULE_SUFFIX.len()
            && strings::eql_comptime(
                &file_path_text[file_path_text.len() - CSS_MODULE_SUFFIX.len()..],
                CSS_MODULE_SUFFIX,
            );
        if enable_css_modules {
            opts.filename = bun_paths::basename(file_path_text);
            opts.css_modules = Some(bun_css::CssModuleConfig::default());
        }

        // SAFETY: `self.arena` is the per-transpile arena;
        // the CSS AST it backs is dropped before this fn returns
        // (only `result.code: Vec<u8>` escapes, which is
        // global-heap). `'static` matches the crate-wide erasure
        // on `StyleSheet`/`ParserOptions` (see css_parser.rs
        // TODO(port): 'bump threading).
        let alloc: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref::<Arena>(self.arena) };

        let (mut sheet, extra) = match bun_css::StyleSheet::<bun_css::DefaultAtRule>::parse(
            alloc,
            entry.contents(),
            opts,
            None,
            bun_ast::Index::INVALID,
        ) {
            Ok(v) => v,
            Err(e) => {
                let _ = self.log_mut().add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!("{} parsing", e),
                );
                return None;
            }
        };
        if let Err(e) = sheet.minify(alloc, &bun_css::MinifyOptions::default(), &extra) {
            self.log_mut().add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!("{} while minifying", e.kind),
            );
            return None;
        }
        let symbols = bun_ast::symbol::Map::init_list(Default::default());
        let result = match sheet.to_css(
            alloc,
            &bun_css::PrinterOptions {
                targets: bun_css::Targets::for_bundler_target(self.options.target),
                minify: self.options.minify_whitespace,
                ..bun_css::PrinterOptions::default()
            },
            None,
            None,
            &symbols,
        ) {
            Ok(v) => v,
            Err(e) => {
                self.log_mut().add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!("{} while printing", e),
                );
                return None;
            }
        };
        Some(crate::output_file::Value::Buffer {
            bytes: result.code.into_boxed_slice(),
        })
    }

    /// Cold path: `bun build` of a non-JS asset copied verbatim (`.html`,
    /// `.wasm`, `.node`, sqlite, bunsh, generic `file`). Split out so it
    /// isn't interleaved (post-LTO) with the hot JS/TS transpile path.
    #[cold]
    #[inline(never)]
    fn build_copied_file_output(
        &mut self,
        file_path_text: &'static [u8],
        file_path_ext: &[u8],
    ) -> Result<crate::output_file::Value, bun_core::Error> {
        let hashed_name = self
            .linker
            .get_hashed_filename(&bun_paths::fs::Path::init(file_path_text), None)?;
        let mut pathname = Vec::with_capacity(hashed_name.len() + file_path_ext.len());
        pathname.extend_from_slice(hashed_name);
        pathname.extend_from_slice(file_path_ext);
        Ok(crate::output_file::Value::Copy(
            crate::output_file::FileOperation {
                pathname: pathname.into_boxed_slice(),
                dir: self
                    .options
                    .output_dir_handle
                    .unwrap_or(bun_sys::Fd::INVALID),
                is_outdir: true,
                ..Default::default()
            },
        ))
    }
}

#[derive(Clone, Copy)]
enum TransformOutstream {
    Stdout,
    Dir(#[expect(dead_code)] bun_sys::Fd),
}

// ported from: src/bundler/transpiler.zig

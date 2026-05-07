// ══════════════════════════════════════════════════════════════════════════
// `Transpiler` — the legacy single-file transpile path (pre-`bundle_v2`).
// resolver↔bundler cycle broken in O; `bun_resolver` is now a direct dep so
// the struct and all method bodies are un-gated and live at this tier.
// ══════════════════════════════════════════════════════════════════════════

use bun_alloc::Arena;
use bun_collections::VecExt;
use bun_collections::HashMap;
use bun_dotenv as dot_env;
use bun_js_parser as js_ast;
use bun_logger as logger;
use bun_perf::system_timer::Timer as SystemTimer;
use bun_resolver::{self as resolver, Resolver};
use bun_resolver::fs as Fs;
use bun_router::Router;

use crate::options;

/// Port of `transpiler.zig:ResolveResults` — keyed by source path hash.
pub type ResolveResults = HashMap<u64, ()>;
/// Port of `transpiler.zig:ResolveQueue` — `std.fifo.LinearFifo(resolver.Result, .Dynamic)`.
// PORT NOTE: `bun_collections::LinearFifo<T, DynamicBuffer<T>>` would be exact,
// but `DynamicBuffer` isn't re-exported from `bun_collections` yet. `VecDeque`
// is structurally equivalent (growable ring buffer); swap once the re-export lands.
pub type ResolveQueue = std::collections::VecDeque<resolver::Result>;

/// Spec `JSGlobalObject.BunPluginTarget` (JSGlobalObject.zig:265). Defined at
/// this tier (lowest crate that needs to name it) and re-exported from
/// `bun_jsc::BunPluginTarget` so there is exactly one enum — no transmute
/// between mirror types.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BunPluginTarget {
    Bun = 0,
    Node = 1,
    Browser = 2,
}

/// Spec PluginRunner.zig:34 `onResolve` — the JSC-aware resolve hook.
///
/// The body calls `JSGlobalObject.runOnResolvePlugins`, so it cannot be
/// defined at this tier (`bun_jsc` depends on this crate). `bun_jsc` provides
/// the concrete `PluginRunner { global_object: *mut JSGlobalObject }` and
/// implements this trait; `Linker.plugin_runner` holds it as
/// `*mut dyn PluginResolver` so the linker stays JSC-free while the body lives
/// in exactly one place (no fn-ptr field, no `*mut c_void` erasure).
pub trait PluginResolver {
    fn on_resolve(
        &self,
        specifier: &[u8],
        importer: &[u8],
        log: &mut logger::Log,
        loc: logger::Loc,
        target: BunPluginTarget,
    ) -> Result<Option<bun_paths::fs::Path<'static>>, bun_core::Error>;
}

/// Spec PluginRunner.zig — namespace for the static byte-level helpers
/// (`extractNamespace` / `couldBePlugin`). The stateful struct (with
/// `global_object`) lives in `bun_jsc::PluginRunner` where `JSGlobalObject` is
/// nameable; only the JSC-free helpers stay at this tier.
pub struct PluginRunner;

impl PluginRunner {
    /// Spec PluginRunner.zig:14 `extractNamespace`.
    pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
        let Some(colon) = bun_string::strings::index_of_char(specifier, b':') else {
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
        if let Some(last_dot) = bun_string::strings::last_index_of_char(specifier, b'.') {
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
        !bun_paths::is_absolute(specifier)
            && bun_string::strings::index_of_char(specifier, b':').is_some()
    }
}

/// Spec `transpiler.zig:5` — `pub const MacroJSCtx = @import("../bundler_jsc/PluginRunner.zig").MacroJSCtx`.
/// The canonical newtype lives in `bun_js_parser::Macro` (the lowest tier that
/// stores it, in `MacroContext.javascript_object`); re-exported here per spec.
pub use js_ast::Macro::MacroJSCtx;
/// Spec `transpiler.zig:1433 default_macro_js_value` (= `JSValue.zero`).
#[inline]
pub const fn default_macro_js_value() -> MacroJSCtx {
    MacroJSCtx::ZERO
}

/// This structure was the JavaScript transpiler before bundle_v2 was written. It
/// now acts mostly as a configuration object, but it also contains stateful
/// logic around logging errors (`log`) and module resolution (`resolve_queue`).
///
/// This object is not exclusive to bundle_v2/Bun.build; one of these is stored
/// on every VM so that the options can be used for transpilation.
pub struct Transpiler<'a> {
    pub options: options::BundleOptions<'a>,
    // PORT NOTE: raw ptr — Zig aliased the same `*Log` into `linker.log` and
    // `resolver.log` (see `set_log`). `&'a mut` would forbid that aliasing.
    // TODO(port): lifetime — restructure once linker/resolver own their logs.
    pub log: *mut logger::Log,
    // TODO(port): allocator — bundler is an AST crate per PORTING.md so we
    // thread an arena, but callers usually pass `bun.default_allocator`.
    // Phase B: confirm whether this should be removed (global mimalloc) or kept.
    pub allocator: &'a Arena,
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

    // B-2 un-gated: real `crate::linker::Linker` so
    // `ModuleLoader::transpile_source_code` (jsc_hooks.rs) can call
    // `transpiler.linker.link()` / read `import_counter`. Back-pointers wired
    // by `configure_linker` below; `set_log` keeps `linker.log` in sync.
    pub linker: crate::linker::Linker,
    pub timer: SystemTimer,
    // TODO(port): lifetime — Zig stored `&DotEnv.Loader` (global singleton).
    pub env: *mut dot_env::Loader<'a>,

    pub macro_context: Option<js_ast::Macro::MacroContext>,
}

impl<'a> Transpiler<'a> {
    pub const IS_CACHE_ENABLED: bool = false;

    /// Port of `transpiler.zig:95 setLog`.
    ///
    /// PORT NOTE: takes `*mut Log` (not `&'a mut`) because Zig aliased the same
    /// `*Log` into `linker.log` / `resolver.log`; the un-gated struct field is
    /// already a raw pointer for that reason.
    pub fn set_log(&mut self, log: *mut logger::Log) {
        self.log = log;
        self.linker.log = log;
        // SAFETY: caller (`ThreadPool::Worker::create`) passes the per-worker
        // arena-allocated `Log`, which outlives this `Transpiler<'a>`. Zig
        // aliased the same `*Log` into `resolver.log`; `Resolver.log` is a
        // `*mut` so the raw pointer copies straight across.
        self.resolver.log = log;
    }

    /// Port of `transpiler.zig:102 setAllocator`.
    // TODO: remove this method. it does not make sense
    pub fn set_allocator(&mut self, allocator: &'a Arena) {
        self.allocator = allocator;
        // PORT NOTE: `crate::Linker` is the unit stub — no `.allocator` field.
        // `Resolver` dropped its `allocator` field (global mimalloc; see
        // resolver/lib.rs `// allocator: dropped`), so nothing left to thread.
    }

    /// Port of `bundle_v2.zig:198 initializeClientTranspiler`'s
    /// `client_transpiler.* = this_transpiler.*` value copy.
    ///
    /// Zig structs have no destructors, so a bitwise struct copy that aliases
    /// heap-owning fields is sound there (both copies live in the bundler arena
    /// and are bulk-freed). The Rust port mirrors that by `ptr::read`ing into a
    /// bumpalo arena slot (never `Drop`ped) and requiring the caller to use
    /// `ptr::write` for any subsequent heap-field overwrites so the aliased
    /// originals are never freed.
    ///
    /// # Safety
    /// - `arena` must outlive `self`.
    /// - The returned `Transpiler` aliases every heap-owning field of `self`.
    ///   It is never dropped (bumpalo). Callers MUST NOT assign to a heap-
    ///   owning field of the clone with `=` (which would drop the shared old
    ///   value); use `core::ptr::write` instead. Non-heap (`Copy`) fields and
    ///   raw-pointer fields may be assigned normally.
    pub unsafe fn arena_bitwise_dup(&self, arena: &'a Arena) -> &'a mut Transpiler<'a> {
        // SAFETY: bitwise read of `*self`; the duplicate is placed in `arena`
        // which never runs `Drop`, so no double-free occurs. See fn docs for
        // the field-overwrite contract callers must uphold.
        arena.alloc(unsafe { core::ptr::read(self) })
    }

    /// Port of `transpiler.zig:91 getPackageManager`.
    #[inline]
    pub fn get_package_manager(
        &mut self,
    ) -> *mut dyn bun_resolver::install_types::AutoInstaller {
        self.resolver.get_package_manager()
    }

    /// Port of `transpiler.zig:358 resetStore`.
    pub fn reset_store(&self) {
        js_ast::Expr::data_store_reset();
        js_ast::Stmt::data_store_reset();
    }

    /// Port of `transpiler.zig:108 _resolveEntryPoint`.
    fn _resolve_entry_point(
        &mut self,
        entry_point: &[u8],
    ) -> Result<resolver::Result, bun_core::Error> {
        // SAFETY: `self.fs` points at the global `Fs::FileSystem` singleton
        // (see field comment); never null after `Transpiler::init`.
        let top_level_dir = unsafe { (*self.fs).top_level_dir };
        match self.resolver.resolve_with_framework(
            top_level_dir,
            entry_point,
            bun_options_types::ImportKind::EntryPointBuild,
        ) {
            Ok(r) => Ok(r),
            Err(err) => {
                // Relative entry points that were not resolved to a node_modules package are
                // interpreted as relative to the current working directory.
                if !bun_paths::is_absolute(entry_point)
                    && !(entry_point.starts_with(b"./")
                        || entry_point.starts_with(b".\\"))
                {
                    // Spec: `strings.append(allocator, "./", entry_point)`.
                    let mut prefixed = Vec::with_capacity(2 + entry_point.len());
                    prefixed.extend_from_slice(b"./");
                    prefixed.extend_from_slice(entry_point);
                    // PORT NOTE: spec leaks the prefixed slice (arena-freed in
                    // Zig). `Resolver::resolve` interns the path internally,
                    // so the heap buffer can drop after the call.
                    if let Ok(r) = self.resolver.resolve(
                        top_level_dir,
                        &prefixed,
                        bun_options_types::ImportKind::EntryPointBuild,
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

                // Bust directory cache and try again
                // PORT NOTE: reshaped for borrowck — Zig's labelled-block
                // returned a slice that aliases either `entry_point` (via
                // `dirname`) or `cache_bust_buf`. Rust can't unify the two
                // disjoint mutable borrows of `cache_bust_buf` across `break`,
                // so compute `busted` directly instead.
                let busted: bool = 'name: {
                    if bun_paths::is_absolute(entry_point) {
                        let dir = bun_paths::resolve_path::dirname::<
                            bun_paths::platform::Auto,
                        >(entry_point);
                        if !dir.is_empty() {
                            // Normalized with trailing slash
                            let buster_name =
                                bun_string::strings::paths::normalize_slashes_only(
                                    &mut cache_bust_buf[..],
                                    dir,
                                    bun_paths::SEP,
                                );
                            break 'name self.resolver.bust_dir_cache(
                                bun_string::strings::paths::without_trailing_slash_windows_path(
                                    buster_name,
                                ),
                            );
                        }
                    }

                    // Spec: `bun.pathLiteral("..")` — `".."` is sep-agnostic.
                    let parts: [&[u8]; 2] = [entry_point, b".."];
                    // SAFETY: `self.fs` points at the process-lifetime
                    // `Fs::FileSystem` singleton; never null after
                    // `Transpiler::init` (see field PORT NOTE).
                    let top_level_dir = unsafe { (*self.fs).top_level_dir };

                    let buster_name = bun_paths::resolve_path::join_abs_string_buf_z::<
                        bun_paths::platform::Auto,
                    >(
                        top_level_dir, &mut cache_bust_buf[..], &parts
                    );
                    self.resolver.bust_dir_cache(
                        bun_string::strings::paths::without_trailing_slash_windows_path(
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

                // SAFETY: `self.log` is non-null after `init` and outlives
                // `Transpiler<'a>`. The aliased raw copies in
                // `self.{resolver,linker,options}.log` are not dereferenced in
                // this scope, so this `&mut` is the sole live reference to the
                // `Log` allocation for the duration of the `add_error_fmt` call.
                let log = unsafe { &mut *self.log };
                bun_core::handle_oom(log.add_error_fmt(
                    None,
                    logger::Loc::EMPTY,
                    format_args!(
                        "{} resolving \"{}\" (entry point)",
                        err,
                        bstr::BStr::new(entry_point)
                    ),
                ));
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
            self.options.env.behavior =
                bun_options_types::schema::api::DotEnvBehavior::Prefix;
            self.options.env.prefix = Box::from(b"BUN_".as_slice());
        }

        self.run_env_loader(self.options.env.disable_default_env_files)?;

        // SAFETY: `self.env` points at the long-lived `DotEnv::Loader`
        // (`init` always assigns it); never null here.
        let env_loader = unsafe { &mut *self.env };
        let mut is_production = env_loader.is_production();

        js_ast::Expr::data_store_create();
        js_ast::Stmt::data_store_create();

        // Spec `defer Store.reset()` — RAII guard resets both AST stores on
        // every exit path (including `?` early-return below).
        let _reset = js_ast::ast::StoreResetGuard::new();

        // Spec passed `&this.options.env` as a separate arg; `load_defines` now
        // reads `&self.env` internally so the disjoint borrow is resolved
        // inside the `&mut self` scope without `unsafe`.
        self.options.load_defines(self.allocator, Some(env_loader))?;

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

    /// Port of the spec idiom `out.resolver.opts = out.options` (transpiler.zig
    /// passes the same `BundleOptions` value to both struct fields; bake.zig:788
    /// re-assigns after mutating `out.options`). In the Rust port the resolver
    /// crate carries a FORWARD_DECL subset of `BundleOptions`, so re-project
    /// rather than `Clone`. Called after `init_transpiler_with_options` mutates
    /// `self.options` so the resolver sees the same conditions/target/public_path.
    pub fn sync_resolver_opts(&mut self) {
        self.resolver.opts = resolver_bundle_options_subset(&self.options);
    }

    /// Port of `transpiler.zig:363 dumpEnvironmentVariables`.
    #[cold]
    #[inline(never)]
    pub fn dump_environment_variables(&self) {
        use bun_js_printer::{write_json_string, Encoding};
        // PORT NOTE: spec uses `std.json.Stringify` (`.whitespace = .indent_2`)
        // to dump `env.map.*`. The Rust `bun_dotenv::Map` doesn't impl
        // `serde::Serialize`, so iterate and emit the object by hand. Keys and
        // values go through `write_json_string` (the same escaper the printer
        // uses for metafile/HTML-manifest JSON) so `"` / `\` / control bytes
        // are escaped exactly as `std.json.Stringify` does.
        bun_core::Output::flush();
        // SAFETY: `self.env` is non-null after `init`.
        let env = unsafe { &mut *self.env };
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

    /// Port of Zig `transpiler.* = from.*` (ThreadPool.zig:308) — bitwise
    /// struct copy for per-worker `Transpiler` initialization.
    ///
    /// # Safety
    /// The returned value aliases every heap allocation owned by `from`
    /// (`options`, `resolver`, `resolve_results`, …). Caller must ensure:
    ///   * `from` outlives every clone (the `BundleV2`-owned transpiler does), and
    ///   * the clone is stored where `Drop` never runs (`MaybeUninit` slot in
    ///     `WorkerData`), so no double-free occurs. `Worker::deinit` mirrors
    ///     Zig and only tears down the arena, never the per-worker `Transpiler`.
    ///
    /// PORT NOTE: writes in-place into the caller's `MaybeUninit` slot rather
    /// than returning an owned `Transpiler<'a>` by value. Returning by value
    /// would put an owned, fully-aliased `Transpiler` on the stack across the
    /// caller's `.write()`; if a panic unwound at that point `Drop` would run
    /// and double-free every heap field. Writing through `MaybeUninit::as_mut_ptr`
    /// guarantees no aliased owned value ever exists where `Drop` can reach it
    /// (PORTING.md §Forbidden — `ManuallyDrop`/`ptr::read` without paired drop).
    pub unsafe fn clone_for_worker(
        from: &Transpiler<'_>,
        out: &mut core::mem::MaybeUninit<Transpiler<'a>>,
    ) {
        // SAFETY: bitwise copy + lifetime erase per caller contract above.
        // `Transpiler<'x>` and `Transpiler<'a>` differ only in the lifetime
        // parameter, so the pointer cast is layout-preserving. `from` and
        // `out` cannot overlap (`from` is `&` and `out` is `&mut`).
        unsafe {
            core::ptr::copy_nonoverlapping(
                (from as *const Transpiler<'_>).cast::<Transpiler<'a>>(),
                out.as_mut_ptr(),
                1,
            );
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// B-2 un-gated: `configure_linker*` / `run_env_loader` — unblocks
// `RunCommand::configure_env_for_run` (runtime/cli/run_command.rs:527),
// `bun_install::configure_env_for_run`, `JSBundleCompletionTask`,
// `JSTranspiler`, and `bun.js.rs:: bun_main_shell_entry`.
// ══════════════════════════════════════════════════════════════════════════

use bun_resolver::tsconfig_json::{JsxField, TSConfigJSON};

/// CYCLEBREAK: convert resolver-side `tsconfig_json::options::jsx::Pragma`
/// into the bundler-side `options_impl::jsx::Pragma`. The two are structurally
/// the same value type but nominally distinct until the move-down to
/// `bun_options_types` lands (see resolver/tsconfig_json.rs:13 CYCLEBREAK note).
/// Fields the resolver subset doesn't carry (`classic_import_source`, `parse`,
/// `side_effects`) keep the bundler `Default`, matching Zig's struct-literal
/// defaults (options.zig:1196-1204).
fn jsx_pragma_from_resolver(
    src: &bun_resolver::tsconfig_json::options::jsx::Pragma,
) -> crate::options_impl::jsx::Pragma {
    use bun_resolver::tsconfig_json::options::jsx::Runtime as R;
    use crate::options_impl::jsx;
    jsx::Pragma {
        factory: src.factory.iter().map(|s| s.clone()).collect(),
        fragment: src.fragment.iter().map(|s| s.clone()).collect(),
        runtime: match src.runtime {
            R::Automatic => jsx::Runtime::Automatic,
            R::Classic => jsx::Runtime::Classic,
            R::Solid => jsx::Runtime::Solid,
        },
        import_source: jsx::ImportSource {
            development: src.import_source.development.clone(),
            production: src.import_source.production.clone(),
        },
        package_name: src.package_name.clone(),
        development: src.development,
        ..jsx::Pragma::default()
    }
}

/// CYCLEBREAK: inline `TSConfigJSON::merge_jsx` (resolver/tsconfig_json.rs:346)
/// against the bundler-side `Pragma`. The upstream `merge_jsx` takes/returns
/// the resolver-side nominal type; round-tripping through
/// [`jsx_pragma_from_resolver`] would lose `classic_import_source`/`parse`/
/// `side_effects`. Spec: options.zig — `TSConfigJSON.mergeJSX` is a 5-field
/// conditional copy keyed on `jsx_flags`.
fn merge_tsconfig_jsx_into(tsconfig: &TSConfigJSON, out: &mut crate::options_impl::jsx::Pragma) {
    use bun_resolver::tsconfig_json::options::jsx::Runtime as R;
    use crate::options_impl::jsx;
    if tsconfig.jsx_flags.contains(JsxField::Factory) {
        out.factory = tsconfig.jsx.factory.iter().map(|s| s.clone()).collect();
    }
    if tsconfig.jsx_flags.contains(JsxField::Fragment) {
        out.fragment = tsconfig.jsx.fragment.iter().map(|s| s.clone()).collect();
    }
    if tsconfig.jsx_flags.contains(JsxField::ImportSource) {
        out.import_source = jsx::ImportSource {
            development: tsconfig.jsx.import_source.development.clone(),
            production: tsconfig.jsx.import_source.production.clone(),
        };
    }
    if tsconfig.jsx_flags.contains(JsxField::Runtime) {
        out.runtime = match tsconfig.jsx.runtime {
            R::Automatic => jsx::Runtime::Automatic,
            R::Classic => jsx::Runtime::Classic,
            R::Solid => jsx::Runtime::Solid,
        };
    }
    if tsconfig.jsx_flags.contains(JsxField::Development) {
        out.development = tsconfig.jsx.development;
    }
}

impl<'a> Transpiler<'a> {
    /// Port of `transpiler.zig:233 configureLinkerWithAutoJSX`.
    pub fn configure_linker_with_auto_jsx(&mut self, auto_jsx: bool) {
        // PORT NOTE: `Linker::init` dropped its `allocator` arg (linker.rs:172
        // — global mimalloc). Zig stored borrowed `*T` into the linker; the
        // un-gated `crate::linker::Linker` mirrors that with raw pointers so
        // `&mut self.options` etc. coerce directly. Self-reference is
        // load-bearing — `linker.link()` reads back through these into the
        // owning `Transpiler` — hence raw `*mut`, not `&'a mut` (would alias
        // `&mut self` on every call).
        // PORT NOTE: `.cast()` on the `options`/`resolver` pointers erases the
        // `<'a>` lifetime parameter — `Linker` stores them as
        // `*mut BundleOptions` / `*mut Resolver` with an (implicit) distinct
        // lifetime. Raw-pointer storage is the Zig contract; the linker never
        // outlives its owning `Transpiler<'a>`.
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
            // SAFETY: `self.fs` is the process-lifetime `Fs::FileSystem`
            // singleton (set in `Transpiler::init` from `FileSystem::init`).
            let top_level_dir = unsafe { (*self.fs).top_level_dir };
            if let Ok(Some(root_dir)) = self.resolver.read_dir_info(top_level_dir) {
                // SAFETY: `read_dir_info` returns a pointer into the resolver's
                // BSS-backed `DirInfo` cache; entries live for process lifetime
                // and are never freed (resolver/dir_info.rs).
                let root_dir = unsafe { &*root_dir };
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
        // SAFETY: `self.env` is non-null — set to either the caller-provided
        // loader or the `dot_env::INSTANCE` singleton in `Transpiler::init`.
        // Derived once up front; no other live `&mut` to this `Loader` exists
        // for the duration of this call (Zig accessed `this.env.*` freely).
        let env: &mut dot_env::Loader<'_> = unsafe { &mut *self.env };

        match self.options.env.behavior {
            DotEnvBehavior::prefix
            | DotEnvBehavior::load_all
            | DotEnvBehavior::load_all_without_inlining => {
                // Process always has highest priority. Load process env vars
                // unconditionally before attempting directory traversal, so
                // that inherited environment variables are always available
                // even when a parent directory is not readable.
                let was_production = self.options.production;
                env.load_process()?;
                let has_production_env = env.is_production();
                if !was_production && has_production_env {
                    self.options.set_production(true);
                    // Spec transpiler.zig:275 `this.resolver.opts.setProduction(true)`.
                    // The resolver's FORWARD_DECL `BundleOptions` now exposes
                    // `set_production` (flips `production` + `jsx.development`
                    // and self-guards on `force_node_env`; resolver/lib.rs).
                    // Call it directly so resolver-side production gating
                    // (conditional-export `"production"` matching) stays in
                    // sync, instead of the partial single-field write.
                    self.resolver.opts.set_production(true);
                }

                // Load the project root for .env file discovery. If the cwd
                // (or a parent) is unreadable, readDirInfo may return null;
                // bail out of .env file loading in that case, but process
                // env vars were already loaded above.
                // SAFETY: `self.fs` — process-lifetime singleton (see above).
                let top_level_dir = unsafe { (*self.fs).top_level_dir };
                let dir_info = match self.resolver.read_dir_info(top_level_dir) {
                    Ok(Some(d)) => d,
                    _ => return Ok(()),
                };
                // SAFETY: BSS-backed `DirInfo` cache entry — process-lifetime.
                let dir_info = unsafe { &*dir_info };

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

                // PORT NOTE: `Env.files: Box<[Box<[u8]>]>` but `Loader::load`
                // wants `&[&[u8]]`. Re-borrow into a small Vec; the explicit
                // `--env-file` list is bounded (CLI args), not hot-path.
                // PERF(port): one tiny alloc — Zig passed the slice directly.
                let env_files: Vec<&[u8]> =
                    self.options.env.files.iter().map(|f| &**f).collect();

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

// ══════════════════════════════════════════════════════════════════════════
// B-2 un-gated: `ParseResult` / `AlreadyBundled` / `ParseOptions` +
// `Transpiler::parse*` — real types so `ModuleLoader::transpile_source_code`
// (jsc_hooks.rs) and `AsyncModule` / `JSTranspiler` can name them. The body
// of `parse_maybe_return_file_only_allow_shared_buffer` does the source-load
// step (virtual / client-entry / `node:` fallback) for real and gates the
// per-loader transpile branches behind `` until the lower-tier
// surfaces (`cache::Fs::read_file*`, `js_parser::Options::init`,
// `cache::JavaScript::parse`) un-gate.
// ══════════════════════════════════════════════════════════════════════════

use bun_sys::Fd as FD;
use bun_string::strings;
use bun_resolver::package_json::MacroMap as MacroRemap;
use crate::entry_points as EntryPoints;
use crate::cache::{RuntimeTranspilerCache, RuntimeTranspilerCacheExt as _};
use crate::ungate_support::bun_node_fallbacks as NodeFallbackModules;

/// Port of `transpiler.zig:ParseResult.AlreadyBundled` (tagged union).
pub enum AlreadyBundled {
    None,
    SourceCode,
    SourceCodeCjs,
    Bytecode(Box<[u8]>),
    BytecodeCjs(Box<[u8]>),
}

impl Default for AlreadyBundled {
    fn default() -> Self {
        AlreadyBundled::None
    }
}

impl AlreadyBundled {
    pub fn bytecode_slice(&self) -> &[u8] {
        match self {
            AlreadyBundled::Bytecode(slice) | AlreadyBundled::BytecodeCjs(slice) => slice,
            _ => &[],
        }
    }

    pub fn is_bytecode(&self) -> bool {
        matches!(self, AlreadyBundled::Bytecode(_) | AlreadyBundled::BytecodeCjs(_))
    }

    pub fn is_common_js(&self) -> bool {
        matches!(self, AlreadyBundled::SourceCodeCjs | AlreadyBundled::BytecodeCjs(_))
    }
}

/// Port of `transpiler.zig:ParseResult`.
// PORT NOTE: lifetime-free — `runtime_transpiler_cache` is a raw pointer (Zig
// `?*RuntimeTranspilerCache`) so `AsyncModule.parse_result` / `JSTranspiler`
// can store this by value without threading a borrow lifetime.
pub struct ParseResult {
    pub source: logger::Source,
    pub loader: options::Loader,
    pub ast: js_ast::Ast,
    pub already_bundled: AlreadyBundled,
    pub input_fd: Option<FD>,
    pub empty: bool,
    // PORT NOTE: Zig `_resolver.PendingResolution.List` is
    // `MultiArrayList(PendingResolution)`. `PendingResolution` does not yet
    // derive `MultiArrayElement` (lives in `bun_resolver`, derive macro is in
    // `bun_collections_macros` — orphan rules forbid impl-ing it here), so the
    // SoA `len()`/column accessors aren't reachable. Use AoS `Vec` for now;
    // `is_pending_import` only scans `import_record_id`, so the layout
    // difference is observable only as a SoA→AoS perf delta.
    // TODO(b3): switch back to `MultiArrayList<PendingResolution>` once the
    // derive lands upstream in `bun_resolver`.
    pub pending_imports: Vec<resolver::PendingResolution>,

    /// Zig: `?*bun.RuntimeTranspilerCache`. SAFETY: erased — bundler stores it
    /// and hands it back to the runtime side; never dereferenced here.
    pub runtime_transpiler_cache: Option<core::ptr::NonNull<RuntimeTranspilerCache>>,

    /// Owns the bytes that `source.contents` points into when they came from
    /// `cache::Fs::read_file_with_allocator` (non-shared-buffer path) or a
    /// decoded `data:` URL. `logger::Source.contents` is `&'static [u8]`
    /// (Phase-A `Str` convention) so the backing must live at least as long as
    /// the `ParseResult`; threading it here means it drops when the result is
    /// recycled instead of leaking via `mem::forget` (PORTING.md §Forbidden).
    /// `Contents::Empty`/`SharedBuffer` for the virtual-source / shared-buffer
    /// paths (no-op on drop).
    pub source_contents_backing: resolver::cache::Contents,
}

impl Default for ParseResult {
    /// Spec transpiler.zig — `ParseResult` is value-copied (e.g.
    /// `AsyncModule.resumeLoadingModule` reads/writes `this.parse_result` by
    /// value). `Default` lets the Rust port `mem::take` it across that
    /// boundary; see `AsyncModule::resume_loading_module`.
    fn default() -> Self {
        ParseResult {
            source: Default::default(),
            // PORT NOTE: `options::Loader` has no `Default`; Zig field had no
            // initializer either. `File` is the resolver's neutral fallback
            // (BundleEnums.rs:353), and `Default` here exists only for
            // `mem::take` in `AsyncModule::resume_loading_module`.
            loader: options::Loader::File,
            ast: js_ast::Ast::empty(),
            already_bundled: Default::default(),
            input_fd: None,
            empty: true,
            pending_imports: Default::default(),
            runtime_transpiler_cache: None,
            source_contents_backing: Default::default(),
        }
    }
}

impl ParseResult {
    #[inline]
    fn empty_with(
        source: logger::Source,
        loader: options::Loader,
        input_fd: Option<FD>,
        source_contents_backing: resolver::cache::Contents,
    ) -> Self {
        ParseResult {
            source,
            loader,
            ast: js_ast::Ast::empty(),
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
        self.pending_imports.iter().any(|p| p.import_record_id == id)
    }
}

/// Port of `transpiler.zig:Transpiler.ParseOptions`.
pub struct ParseOptions<'a> {
    pub allocator: &'a Arena,
    pub dirname_fd: FD,
    pub file_descriptor: Option<FD>,
    pub file_hash: Option<u32>,

    /// On exception, we might still want to watch the file.
    pub file_fd_ptr: Option<&'a mut FD>,

    pub path: logger::fs::Path,
    pub loader: options::Loader,
    /// `BundleOptions.jsx` — the file-backed `options_impl::jsx::Pragma`, NOT
    /// the lib.rs shim. Callers pass `transpiler.options.jsx.clone()`.
    pub jsx: crate::options_impl::jsx::Pragma,
    pub macro_remappings: MacroRemap,
    pub macro_js_ctx: MacroJSCtx,
    pub virtual_source: Option<&'a logger::Source>,
    /// Zig: `runtime.Runtime.Features.ReplaceableExport.Map`.
    pub replace_exports: bun_collections::StringArrayHashMap<js_ast::runtime::ReplaceableExport>,
    pub inject_jest_globals: bool,
    pub set_breakpoint_on_first_line: bool,
    pub emit_decorator_metadata: bool,
    pub experimental_decorators: bool,
    pub remove_cjs_module_wrapper: bool,

    pub dont_bundle_twice: bool,
    pub allow_commonjs: bool,
    /// `"type"` from `package.json`. Used to make sure the parser defaults
    /// to CommonJS or ESM based on what the package.json says, when it
    /// doesn't otherwise know from reading the source code.
    ///
    /// See: https://nodejs.org/api/packages.html#type
    pub module_type: options::ModuleType,

    pub runtime_transpiler_cache: Option<&'a mut RuntimeTranspilerCache>,

    pub keep_json_and_toml_as_one_statement: bool,
    pub allow_bytecode_cache: bool,
}

/// Manual clone — `logger::Source` doesn't `derive(Clone)` yet but every field
/// is `Copy`/`Clone` (`fs::Path`: Clone; `Str = &'static [u8]`: Copy).
#[inline]
fn dup_source(s: &logger::Source) -> logger::Source {
    logger::Source {
        path: s.path.clone(),
        contents: s.contents.clone(),
        contents_is_recycled: s.contents_is_recycled,
        identifier_name: s.identifier_name.clone(),
        index: s.index,
    }
}

use bun_options_types::schema::api;

// ── B-3 type unification (parse_maybe Js/Ts arm) ─────────────────────────
// `ModuleType`, `Define`, `RuntimeTranspilerCache` are now single nominal
// types shared between `bun_js_parser` and this crate (canonical defs live in
// the lower-tier crate; bundler re-exports). The by-value conversion shims
// for those are gone — `to_parser_module_type` is an identity fn and
// `parse_maybe` threads `self.options.define` / `runtime_transpiler_cache`
// directly.
//
// `JSX::Pragma` keeps a thin by-value conversion: `options_impl::jsx::Runtime`
// carries a 4th `_None` state for `api::JsxRuntime` round-tripping that the
// parser-side 3-state enum lacks. Collapsing it would change parser match
// exhaustiveness; deferred until `bun_options_types` grows the JSX surface.

#[inline]
pub fn to_parser_jsx_pragma(
    p: crate::options_impl::jsx::Pragma,
) -> js_ast::parser::options::JSX::Pragma {
    use crate::options_impl::jsx::Runtime as Src;
    use js_ast::parser::options::JSX;
    JSX::Pragma {
        factory: p.factory,
        fragment: p.fragment,
        runtime: match p.runtime {
            // PORT NOTE: bundler-side `Runtime` carries a `_None` zero state to
            // round-trip `api::JsxRuntime::_none`; the parser-side enum has no
            // such variant (parser only ever sees a resolved runtime). Map it
            // to the spec default `Automatic` (options.zig:1199 default).
            Src::_None | Src::Automatic => JSX::Runtime::Automatic,
            Src::Classic => JSX::Runtime::Classic,
            Src::Solid => JSX::Runtime::Solid,
        },
        import_source: JSX::ImportSource {
            development: p.import_source.development,
            production: p.import_source.production,
        },
        classic_import_source: p.classic_import_source,
        package_name: p.package_name,
        development: p.development,
        parse: p.parse,
        side_effects: p.side_effects,
    }
}

// B-3 UNIFIED: `crate::options_impl::ModuleType` IS `js_ast::parser::options::ModuleType`
// (both re-export `bun_options_types::BundleEnums::ModuleType`). Identity shim
// kept so existing call sites compile unchanged; inlines to a move.
#[inline(always)]
fn to_parser_module_type(
    m: crate::options_impl::ModuleType,
) -> js_ast::parser::options::ModuleType {
    m
}

/// Spec: `fs.zig:FileSystem.init`.
///
/// PORT NOTE: the inline `bun_resolver::fs` module exposes the `FileSystem`
/// struct + `INSTANCE`/`INSTANCE_LOADED` statics (resolver/lib.rs:120,129) but
/// not the `init` constructor (that lives in the still-gated file-backed
/// `resolver/fs.rs`). All fields are `pub` and `EntriesMap`/`Mutex` have
/// public constructors, so reproduce the singleton-init here. Matches Zig
/// semantics: first call sets `top_level_dir` (defaulting to getcwd),
/// subsequent calls return the existing instance untouched.
fn init_file_system(
    top_level_dir: Option<&'static [u8]>,
) -> Result<*mut Fs::FileSystem, bun_core::Error> {
    // Spec fs.zig:90-108 — delegate to `FileSystem.init`, which routes through
    // `Implementation.init` (fs.zig:823-837): that path calls `adjustUlimit()`
    // to raise RLIMIT_NOFILE and stores the returned limit in
    // `file_limit`/`file_quota`, and touches the `DirEntry.EntryStore`
    // singleton. The previous hand-built `Implementation { file_limit: 0, .. }`
    // skipped both, so `RealFS::need_to_close_files` (resolver/lib.rs:1594)
    // evaluated `!(0 > 254 && ..)` → always `true`, defeating directory-fd
    // caching, and the process never had its fd ulimit raised — large module
    // graphs could hit EMFILE where the spec build does not.
    Fs::FileSystem::init(top_level_dir)
}

/// CYCLEBREAK: project this crate's `options::BundleOptions<'a>` into the
/// resolver-crate FORWARD_DECL subset (`bun_resolver::options::BundleOptions`).
/// The two are nominally distinct until MOVE_DOWN to `bun_options_types`
/// unifies them (resolver/lib.rs `mod options` note).
///
/// Spec transpiler.zig:214 passes the SAME `bundle_options` value to
/// `Resolver.init1`, so `resolver.opts` must carry user-configured
/// `--external`, `--conditions`, `--main-fields`, and the extension order.
/// Every field the resolver reads is now projected (clone of owned data, no
/// `Box::leak`); the resolver-side FORWARD_DECL types were widened to owned
/// `Box<[Box<[u8]>]>`/`StringSet`/`StringArrayHashMap` so this is a faithful
/// value copy rather than a `Default` stub.
///
/// TODO(b3): drop this once `bun_options_types::BundleOptions` exists and both
/// crates re-export it — `Resolver::init1` will then take the canonical type
/// directly and Zig's `bundle_options` value can flow through unchanged
/// (transpiler.zig:209 passes the same `options` to both struct fields).
pub(crate) fn resolver_bundle_options_subset(
    src: &options::BundleOptions<'_>,
) -> resolver::options::BundleOptions {
    use crate::options_impl::jsx::Runtime as BR;
    use resolver::options as ropts;
    use resolver::tsconfig_json::options::jsx as rjsx;

    ropts::BundleOptions {
        target: src.target,
        packages: match src.packages {
            options::PackagesOption::External => ropts::Packages::External,
            options::PackagesOption::Bundle => ropts::Packages::Bundle,
        },
        jsx: rjsx::Pragma {
            factory: src.jsx.factory.iter().cloned().collect(),
            fragment: src.jsx.fragment.iter().cloned().collect(),
            runtime: match src.jsx.runtime {
                // bundler-side `_None` round-trips `api::JsxRuntime::_none`;
                // resolver-side enum has no such variant — map to spec default.
                BR::_None | BR::Automatic => rjsx::Runtime::Automatic,
                BR::Classic => rjsx::Runtime::Classic,
                BR::Solid => rjsx::Runtime::Solid,
            },
            import_source: rjsx::ImportSource {
                development: src.jsx.import_source.development.clone(),
                production: src.jsx.import_source.production.clone(),
            },
            package_name: src.jsx.package_name.clone(),
            development: src.jsx.development,
        },
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
            css: ropts::owned_string_list(
                ropts::bundle_options::defaults::CSS_EXTENSION_ORDER,
            ),
        },
        conditions: ropts::Conditions {
            import: src.conditions.import.clone().expect("oom"),
            require: src.conditions.require.clone().expect("oom"),
            style: src.conditions.style.clone().expect("oom"),
        },
        external: ropts::ExternalModules {
            patterns: src
                .external
                .patterns
                .iter()
                .map(|p| ropts::WildcardPattern {
                    prefix: p.prefix.clone(),
                    suffix: p.suffix.clone(),
                })
                .collect(),
            abs_paths: src.external.abs_paths.clone().expect("oom"),
            node_modules: src.external.node_modules.clone().expect("oom"),
        },
        extra_cjs_extensions: src.extra_cjs_extensions.clone(),
        framework: src.framework.map(|f| {
            // CYCLEBREAK: bundler-local `bake_types::BuiltInModule` and
            // `bun_options_types::BuiltInModule` are nominally distinct (the
            // former predates the TYPE_ONLY move-down); convert variant-wise.
            use crate::bake_types::BuiltInModule as B;
            use bun_options_types::BuiltInModule as R;
            let mut m = bun_collections::StringArrayHashMap::default();
            for (k, v) in f.built_in_modules.keys().iter().zip(f.built_in_modules.values().iter()) {
                let rv = match v {
                    B::Import(p) => R::Import(p.clone()),
                    B::Code(c) => R::Code(c.clone()),
                };
                m.put(k, rv).expect("oom");
            }
            ropts::Framework { built_in_modules: m }
        }),
        global_cache: src.global_cache,
        // Spec `options.zig:1753`: `?*const Api.BunInstall` → resolver's
        // FORWARD_DECL `*const ()`. Bundler now stores `Option<NonNull<_>>`
        // (PORTING.md §Forbidden: no `&*(p as *const _)` lifetime-extension at
        // call sites), so this is a plain pointer-to-pointer cast.
        install: src
            .install
            .map(|p| p.as_ptr() as *const ())
            .unwrap_or(core::ptr::null()),
        load_package_json: src.load_package_json,
        load_tsconfig_json: src.load_tsconfig_json,
        main_field_extension_order: ropts::owned_string_list(src.main_field_extension_order),
        // Spec resolver.zig `auto_main` compares the pointer of
        // `opts.main_fields` against the per-target default; with owned
        // storage that pointer test can't hold, so project the predicate as a
        // bool: it's "default" iff the user did not pass `--main-fields`
        // (`from_api` overwrites `main_fields` only when
        // `transform.main_fields` is non-empty — options.rs:2231).
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
        // FORWARD_DECL: bundler-only fields read via `c.resolver.opts` in
        // `linker_context/*` (Zig stores the full `BundleOptions` on the
        // resolver). Project them so the linker sees the same values it would
        // have read off the spec's shared struct.
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
    /// Port of `transpiler.zig:Transpiler.init`.
    ///
    /// Un-gated B-2 so [`init_runtime_state`](../runtime/jsc_hooks.rs)
    /// (spec `VirtualMachine.zig:1241`) can write `vm.transpiler`. Both
    /// lower-tier constructors are now live:
    ///   * [`options::BundleOptions::from_api`] — `bun_bundler::options`
    ///   * [`Resolver::init1`] — `bun_resolver` (its `mod options` is now
    ///     `pub` so this crate can build the FORWARD_DECL subset)
    ///
    /// PORT NOTE: `log` / `env_loader_` are raw pointers (not `&'a mut`) to
    /// match the un-gated struct field types — Zig aliased the same `*Log`
    /// into `linker.log` / `resolver.log` (see `set_log`).
    pub fn init(
        allocator: &'a Arena,
        log: *mut logger::Log,
        opts: api::TransformOptions,
        env_loader_: Option<*mut dot_env::Loader<'static>>,
    ) -> Result<Transpiler<'a>, bun_core::Error> {
        // TODO(port): narrow error set
        js_ast::ast::expr::data::Store::create();
        js_ast::ast::stmt::data::Store::create();

        // PORT NOTE: `FileSystem::init` wants `&'static [u8]`; Zig passed a
        // borrowed slice (transpiler.zig:179). Intern via `DirnameStore`
        // (the same path `FileSystem::init` already uses for the
        // `None`/getcwd case — fs.rs:222) so the cwd lives in the
        // process-lifetime BSS string store without `Box::leak`. PORTING.md
        // §Forbidden bars `Box::leak` even for singletons; on subsequent
        // per-worker `Transpiler::init` calls the previous leak was discarded
        // (`FileSystem::init` only stores `top_level_dir` on first call).
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
                    // PORTING.md §Forbidden bars `Box::leak` even for
                    // process-lifetime singletons. `bun_dotenv::INSTANCE` is an
                    // `AtomicPtr<Loader<'static>>` and `Loader` borrows
                    // an unbounded `&mut Map`, so a `OnceLock<Loader>` here can't
                    // be expressed without changing `bun_dotenv`'s API.
                    // Transfer ownership of both allocations into the global
                    // singleton via `Box::into_raw` (the AtomicPtr becomes the
                    // owner; matches `MiniEventLoop::init_global`).
                    // TODO(port): replace with a `OnceLock`-backed
                    // `bun_dotenv::instance_or_init()` accessor once
                    // `bun_dotenv` grows one (PORTING.md §Concurrency).
                    let map: *mut dot_env::Map = Box::into_raw(Box::new(dot_env::Map::init()));
                    // SAFETY: `map` is a fresh heap allocation with no other
                    // alias; `Loader` stores it for process lifetime and is
                    // itself installed into `dot_env::INSTANCE` below.
                    Box::into_raw(Box::new(dot_env::Loader::init(unsafe { &mut *map })))
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
            (*env_loader).quiet = !(*log).level.at_least(logger::Level::Info);
        }

        // var pool = try allocator.create(ThreadPool);
        // try pool.init(ThreadPool.InitConfig{
        //     .allocator = allocator,
        // });

        // `log` stays raw — `from_api` stores it in `BundleOptions.log: *mut`
        // and the same pointer is aliased into `Resolver::init1` / `Linker`
        // / the struct field below (Zig aliased `*Log` everywhere). No `&'a
        // mut Log` is materialized here, so the sibling raw pointers don't
        // invalidate a long-lived unique borrow under stacked borrows.
        // SAFETY: `fs` is the process-lifetime `Fs::FileSystem` singleton from
        // `init_file_system` above; this short `&mut *fs` is the only live
        // borrow for the duration of `from_api`.
        let bundle_options =
            options::BundleOptions::from_api(unsafe { &mut *fs }, log, opts)?;

        // CYCLEBREAK: `Resolver.opts` is the resolver-crate FORWARD_DECL subset
        // (`bun_resolver::options::BundleOptions`), nominally distinct from this
        // crate's `options::BundleOptions<'a>`. Project the fields the resolver
        // reads; the rest stay at `Default` until MOVE_DOWN to
        // `bun_options_types` unifies the two (resolver/lib.rs:2773 note).
        let resolver_opts = resolver_bundle_options_subset(&bundle_options);

        let outbase = bundle_options.output_dir.clone();
        let resolve_results = Box::new(ResolveResults::default());
        Ok(Transpiler {
            fs,
            allocator,
            timer: SystemTimer::start().expect("Timer fail"),
            resolver: Resolver::init1(log, fs, resolver_opts),
            log,
            // .thread_pool = pool,
            // PORT NOTE: Zig used `undefined`; `configure_linker` assigns later.
            // `core::mem::zeroed()` is NOT a valid analogue here —
            // `Linker.hashed_filenames: HashMap` carries a `NonNull` (niche),
            // so the all-zeroes bit pattern is instant UB. Construct via
            // `Linker::init` with null back-pointers instead; the value fields
            // (`hashed_filenames`, `tagged_resolutions`, …) get their proper
            // defaults and `configure_linker_with_auto_jsx` overwrites the
            // self-referential pointers before any deref.
            linker: crate::linker::Linker::init(
                log,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                fs,
            ),
            result: options::TransformResult {
                outbase,
                ..Default::default()
            },
            resolve_results,
            resolve_queue: ResolveQueue::default(),
            output_files: Vec::new(),
            env: env_loader.cast(),
            elapsed: 0,
            needs_runtime: false,
            router: None,
            source_map: options::SourceMapOption::None,
            macro_context: None,
            options: bundle_options,
        })
    }

    pub fn parse(
        &mut self,
        this_parse: ParseOptions<'_>,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult> {
        self.parse_maybe_return_file_only::<false>(this_parse, client_entry_point_)
    }

    pub fn parse_maybe_return_file_only<const RETURN_FILE_ONLY: bool>(
        &mut self,
        this_parse: ParseOptions<'_>,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult> {
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
        mut this_parse: ParseOptions<'_>,
        // TODO(port): Zig `anytype` + `@hasField(.., "source")` — only ever
        // called with `?*EntryPoints.ClientEntryPoint` in this file. If other
        // callers pass a different type, introduce a `ClientEntryPointLike`
        // trait with `fn source() -> Option<&Source>`.
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult> {
        let allocator = this_parse.allocator;
        let dirname_fd = this_parse.dirname_fd;
        let file_descriptor = this_parse.file_descriptor;
        let file_hash = this_parse.file_hash;
        let path = this_parse.path;
        let loader = this_parse.loader;
        // SAFETY: `self.log` is non-null after `init` and outlives `self`. The
        // same allocation is aliased by `self.{resolver,linker,options}.log`
        // (see header PORT NOTE), but those raw `*mut` copies are never
        // dereferenced for the lifetime of this `&mut` — every `Log` access in
        // this function body goes through the `log` binding below (the resolver
        // fs/js caches reached via `self.resolver.caches.*` do not touch
        // `resolver.log`). Hence this is the unique live `&mut Log`.
        let log: &mut logger::Log = unsafe { &mut *self.log };

        let mut input_fd: Option<FD> = None;
        // Owns the heap allocation backing `source.contents` for the
        // non-shared-buffer file-read and `data:` URL paths. Threaded into the
        // returned `ParseResult` so it drops with the result instead of being
        // `mem::forget`-ed (PORTING.md §Forbidden patterns). For virtual /
        // client-entry / `node:` / shared-buffer paths it stays `Empty`
        // (`Drop` is a no-op).
        let mut source_backing: resolver::cache::Contents = resolver::cache::Contents::Empty;

        // PORT NOTE: Zig `&brk: { ... }` took the address of a temporary; Rust
        // owns the value and borrows it after the block.
        let source_owned: logger::Source = 'brk: {
            if let Some(virtual_source) = this_parse.virtual_source {
                break 'brk dup_source(virtual_source);
            }

            if let Some(client_entry_point) = client_entry_point_ {
                // Zig: if (@hasField(Child, "source")) — ClientEntryPoint always has it.
                break 'brk dup_source(&client_entry_point.source);
            }

            if path.namespace == b"node" {
                if let Some(code) = NodeFallbackModules::contents_from_path(path.text) {
                    break 'brk logger::Source::init_path_string(path.text, code);
                }

                break 'brk logger::Source::init_path_string(path.text, b"");
            }

            // Spec transpiler.zig:826-835. The decoded body is owned in
            // `source_backing` (below) so `source.contents` re-borrows it
            // without leaking; never falls through to `read_file_with_allocator`
            // (which would try to open `data:...` as a filesystem path).
            if strings::has_prefix_comptime(path.text, b"data:") {
                use bun_resolver::data_url::DataURL;
                let data_url = match DataURL::parse_without_check(path.text) {
                    Ok(u) => u,
                    Err(err) => {
                        let _ = log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
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
                            logger::Loc::EMPTY,
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
                // never outlive the `ParseResult`. Phase B threads a real
                // lifetime once `logger::Source.contents` becomes `Cow`.
                let contents: &'static [u8] = unsafe {
                    let s = source_backing.as_slice();
                    core::slice::from_raw_parts(s.as_ptr(), s.len())
                };
                break 'brk logger::Source::init_path_string(path.text, contents);
            }

            // PERF(port): Zig forwarded `if (use_shared_buffer)
            // bun.default_allocator else this_parse.allocator` — the Rust
            // `read_file_with_allocator` drops the allocator (global mimalloc
            // for the non-shared path; see resolver/lib.rs PORT NOTE).
            let mut entry = match self.resolver.caches.fs.read_file_with_allocator(
                // SAFETY: `self.fs` is the non-null `&Fs.FileSystem.instance`
                // singleton (see `Transpiler.fs` field PORT NOTE).
                unsafe { &mut *self.fs },
                path.text,
                dirname_fd,
                USE_SHARED_BUFFER,
                file_descriptor,
            ) {
                Ok(e) => e,
                Err(err) => {
                    let _ = log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
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
            // PORT NOTE: `Source.contents: &'static [u8]` (Phase-A `Str`
            // convention). The bytes live either in the per-thread shared
            // buffer (`USE_SHARED_BUFFER` → `Contents::SharedBuffer`, no-op
            // drop) or a heap `Contents::Owned(Vec<u8>)`. Thread the
            // provenance-tagged backing alongside the `ParseResult` so it
            // drops when the result is recycled — no `mem::forget`
            // (PORTING.md §Forbidden patterns). Spec transpiler.zig:853 hands
            // `entry.contents` to `Source.initRecycledFile` by slice; Zig has
            // no implicit drop, so ownership was already with the caller.
            source_backing = core::mem::take(&mut entry.contents);
            // SAFETY: `source_backing` outlives every read through
            // `source.contents` (it is moved into the returned `ParseResult`,
            // and the only consumers are the parser/printer which run before
            // the result drops). `contents_is_recycled = true` records that
            // the bytes are externally-owned; Phase B threads `'bump`.
            let contents: &'static [u8] = unsafe {
                let s = source_backing.as_slice();
                core::slice::from_raw_parts(s.as_ptr(), s.len())
            };
            match logger::Source::init_recycled_file(logger::PathContentsPair {
                path: path.clone(),
                contents,
            }) {
                Ok(s) => break 'brk s,
                Err(_) => return None,
            }
        };
        let source: &logger::Source = &source_owned;

        if RETURN_FILE_ONLY {
            return Some(ParseResult::empty_with(
                dup_source(source),
                loader,
                input_fd,
                source_backing,
            ));
        }

        if source.contents.is_empty()
            || (source.contents.len() < 33
                && strings::trim(&source.contents, b"\n\r ").is_empty())
        {
            if !loader.handles_empty_file() {
                return Some(ParseResult::empty_with(
                    dup_source(source),
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
                        dup_source(source),
                        options::Loader::Wasm,
                        input_fd,
                        source_backing,
                    ));
                }

                let target = self.options.target;

                let mut jsx = this_parse.jsx;
                jsx.parse = loader.is_jsx();
                let _ = &this_parse.macro_remappings;

                // PORT NOTE: `ParserOptions::init` is hard-typed
                // `-> Options<'static>` and `Options<'a>` is *invariant* in
                // `'a` (it holds `Option<&'a mut MacroContext>`), so an
                // `Options<'static>` cannot be passed to
                // `cache::JavaScript::parse::<'x>` alongside a non-`'static`
                // `bump`/`source`/`define`. Construct the struct literal
                // directly (mirroring the body of `Options::init`,
                // ast/Parser.rs:144-180) so `'x` is inferred from the borrows
                // below instead of pinned to `'static`.
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
                    || !(this_parse.experimental_decorators
                        || this_parse.emit_decorator_metadata);
                opts.features.allow_runtime = self.options.allow_runtime;
                opts.features.set_breakpoint_on_first_line =
                    this_parse.set_breakpoint_on_first_line;
                opts.features.trim_unused_imports = self
                    .options
                    .trim_unused_imports
                    .unwrap_or(loader.is_typescript());
                opts.features.no_macros = self.options.no_macros;
                // B-3 UNIFIED: `crate::cache::RuntimeTranspilerCache` IS
                // `bun_js_parser::RuntimeTranspilerCache`; thread the pointer
                // directly. Spec transpiler.zig:899/957 copies the same
                // `?*RuntimeTranspilerCache` raw pointer to BOTH
                // `opts.features` and the returned `ParseResult`. Derive both
                // from a single reborrow so they share one provenance tag —
                // re-touching the parent `&mut` after the `*mut` cast would
                // pop the raw pointer off the borrow stack (Stacked Borrows).
                let rtc_ptr: Option<core::ptr::NonNull<RuntimeTranspilerCache>> =
                    this_parse
                        .runtime_transpiler_cache
                        .as_deref_mut()
                        .map(core::ptr::NonNull::from);
                opts.features.runtime_transpiler_cache =
                    rtc_ptr.map(core::ptr::NonNull::as_ptr);

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
                opts.features.remove_cjs_module_wrapper =
                    this_parse.remove_cjs_module_wrapper;
                // Spec transpiler.zig:925 forwards `transpiler.options
                // .bundler_feature_flags`. Zig aliased a `*const StringSet`;
                // `Features.bundler_feature_flags` is currently owned
                // (`Option<Box<StringSet>>`), so clone by value until B-3
                // changes the parser-side field to `Option<&'a StringSet>`.
                // The clone drops with `opts` — no leak.
                opts.features.bundler_feature_flags = self
                    .options
                    .bundler_feature_flags
                    .as_deref()
                    .and_then(|s| s.clone().ok().map(Box::new));
                opts.features.repl_mode = self.options.repl_mode;

                // we'll just always enable top-level await
                // this is incorrect for Node.js files which are CommonJS modules
                opts.features.top_level_await = true;

                opts.features.is_macro_runtime =
                    target == crate::options_impl::Target::BunMacro;
                // Spec transpiler.zig:943: `opts.features.replace_exports =
                // this_parse.replace_exports`. B-3 UNIFIED —
                // `js_ast::runtime::ReplaceableExport` IS
                // `js_ast::Runtime::ReplaceableExport`, so the inner
                // `StringArrayHashMap` moves directly into the newtype.
                opts.features.replace_exports = js_ast::Runtime::ReplaceableExportMap {
                    entries: this_parse.replace_exports,
                };

                if self.macro_context.is_none() {
                    // PORT NOTE: at this tier `MacroContext` only carries
                    // `javascript_object` (the JSC-backed resolver/env/remap
                    // fields live in `bun_js_parser_jsc`), so `Default` is
                    // semantically equivalent to Zig's `init(transpiler)` here.
                    self.macro_context =
                        Some(js_ast::Macro::MacroContext::default());
                }
                // Spec transpiler.zig:938-940: thread the caller-supplied JS
                // context into the macro runtime so macros invoked during
                // runtime transpilation see it (instead of null). Written on
                // `self.macro_context` before reborrowing into `opts` so the
                // `&mut` handed to the parser already carries the value.
                if target != crate::options_impl::Target::BunMacro {
                    // SAFETY: `is_none()` check above guarantees `Some` here.
                    self.macro_context.as_mut().unwrap().javascript_object =
                        this_parse.macro_js_ctx;
                }
                opts.macro_context = self.macro_context.as_mut();

                // B-3 UNIFIED: `crate::defines::Define` IS
                // `bun_js_parser::defines::Define`. Hand the parser the real
                // table so user `--define` values apply at parse time.
                // SAFETY: `self.options.define` is `Box<Define>` owned by the
                // long-lived `Transpiler`; the parser borrows it for `'a`
                // (arena lifetime). Erase to `'a` to satisfy
                // `JavaScript::parse`'s `&'a Define` param — the box is never
                // dropped while a parse is in flight (Zig held `*const Define`).
                let define: &'a js_ast::defines::Define = unsafe {
                    &*(&*self.options.define as *const crate::defines::Define)
                };

                // PORT NOTE: spec calls `transpiler.resolver.caches.js.parse`.
                // The resolver-side `cache::JavaScript` is a fieldless
                // CYCLEBREAK shell with no `parse` body (resolver/lib.rs:1664);
                // the real `parse` lives on `crate::cache::JavaScript`. Both
                // are stateless unit structs, so calling the bundler-crate one
                // directly is equivalent.
                let parsed = match crate::cache::JavaScript::init()
                    .parse(allocator, opts, define, log, source)
                {
                    Ok(Some(r)) => r,
                    Ok(None) | Err(_) => return None,
                };
                return Some(match parsed {
                    js_ast::Result::Ast(value) => ParseResult {
                        ast: value,
                        source: dup_source(source),
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
                        ast: js_ast::Ast::empty(),
                        runtime_transpiler_cache: rtc_ptr,
                        source: dup_source(source),
                        loader,
                        input_fd,
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        empty: false,
                        source_contents_backing: source_backing,
                    },
                    js_ast::Result::AlreadyBundled(already_bundled) => ParseResult {
                        // TODO(port): Zig used `undefined` for ast here.
                        ast: js_ast::Ast::empty(),
                        already_bundled: match already_bundled {
                            js_ast::AlreadyBundled::Bun => AlreadyBundled::SourceCode,
                            js_ast::AlreadyBundled::BunCjs => {
                                AlreadyBundled::SourceCodeCjs
                            }
                            js_ast::AlreadyBundled::BytecodeCjs
                            | js_ast::AlreadyBundled::Bytecode => 'brk: {
                                // Spec transpiler.zig:971-984: when the parser
                                // saw `// @bun @bytecode`, attempt to load the
                                // sidecar `<path>.jsc` cached bytecode. Only
                                // fall back to re-parsing source on read
                                // failure / empty file.
                                let is_cjs = matches!(
                                    already_bundled,
                                    js_ast::AlreadyBundled::BytecodeCjs
                                );
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
                                    let zpath = unsafe {
                                        bun_core::ZStr::from_raw(
                                            path_buf2.as_ptr(),
                                            total,
                                        )
                                    };
                                    // PORT NOTE: spec calls
                                    // `bun.sys.File.toSourceAt(...)` which is
                                    // `read_from` + wrap-in-`logger::Source`.
                                    // We only need `.contents`, so call
                                    // `read_from` directly (the `to_source_at`
                                    // wrapper is gated as a T1→T2 move-in,
                                    // sys/File.rs:446).
                                    let dir = dirname_fd
                                        .unwrap_valid()
                                        .unwrap_or_else(FD::cwd);
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
                        source: dup_source(source),
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
                // PERF(port): was `inline .toml, .yaml, .json, .jsonc, .json5
                // => |kind|` — comptime monomorphization per loader; profile in
                // Phase B.
                //
                // PORT NOTE: `bun_interchange::*` parse into the T2 value AST
                // (`bun_logger::js_ast::Expr`); lift into the full T4
                // `bun_js_parser::Expr` via the deep-convert `From` bridge
                // (Expr.rs:1265) so the StoreRef-backed accessors below work.
                let value_expr: logger::js_ast::Expr = match loader {
                    options::Loader::Jsonc => {
                        // We allow importing tsconfig.*.json or jsconfig.*.json with comments
                        // These files implicitly become JSONC files, which aligns with the behavior of text editors.
                        match bun_interchange::json::parse_ts_config::<false>(source, log, allocator) {
                            Ok(e) => e,
                            Err(_) => return None,
                        }
                    }
                    options::Loader::Json => {
                        match bun_interchange::json::parse::<false>(source, log, allocator) {
                            Ok(e) => e,
                            Err(_) => return None,
                        }
                    }
                    options::Loader::Toml => {
                        match bun_interchange::toml::TOML::parse(source, log, allocator, false) {
                            Ok(e) => e,
                            Err(_) => return None,
                        }
                    }
                    options::Loader::Yaml => {
                        match bun_interchange::yaml::YAML::parse(source, log, allocator) {
                            Ok(e) => e,
                            Err(_) => return None,
                        }
                    }
                    options::Loader::Json5 => {
                        match bun_interchange::json5::JSON5Parser::parse(source, log, allocator) {
                            Ok(e) => e,
                            Err(_) => return None,
                        }
                    }
                    // SAFETY: outer match arm guarantees one of the five.
                    _ => unsafe { core::hint::unreachable_unchecked() },
                };
                let mut expr = js_ast::Expr::from(value_expr);

                let mut symbols: Vec<js_ast::Symbol> = Vec::new();

                // PORT NOTE: reshaped — Zig `allocator.alloc(Part, 1)` returned
                // an arena slice, but `Ast::from_parts` takes `Box<[Part]>`
                // (Vec owns its buffer). The single-part array is built on
                // the global heap; `stmts` stays arena-backed (`*mut [Stmt]`).
                let parts: Box<[js_ast::Part]> = 'parts: {
                    if this_parse.keep_json_and_toml_as_one_statement {
                        let stmt = js_ast::Stmt::allocate(
                            allocator,
                            js_ast::S::SExpr { value: expr, ..Default::default() },
                            logger::Loc { start: 0 },
                        );
                        // PERF(port): was `allocator.alloc(Stmt, 1) catch unreachable`.
                        let stmts = allocator.alloc_slice_copy(&[stmt]) as *mut [js_ast::Stmt];
                        break 'parts Box::new([js_ast::Part { stmts, ..Default::default() }]);
                    }

                    if let Some(obj) = expr.data.e_object_mut() {
                        let properties: &mut [js_ast::G::Property] = obj.properties.slice_mut();
                        if !properties.is_empty() {
                            let n = properties.len();
                            // PORT NOTE: Zig `expandToCapacity()` / `allocator.alloc(Symbol, n)`
                            // leave slots uninitialized, which is inert in Zig.
                            // The loop below writes sparsely at index `i` and
                            // `continue`s on `"default"` / duplicate keys, so
                            // some slots are never assigned. In Rust an uninit
                            // live `Vec<T>` element is UB the moment it is
                            // observed (truncate/into_boxed_slice/index-assign),
                            // so pre-fill every slot with `Default` instead of
                            // `set_len`. PERF(port): was `expandToCapacity()`.
                            let mut decls: Vec<js_ast::G::Decl> =
                                vec![js_ast::G::Decl::default(); n];

                            symbols.resize_with(n, Default::default);
                            // PORT NOTE: `S::ExportClause.items: *mut [ClauseItem]`
                            // is arena-owned; `ClauseItem: Default` so
                            // `alloc_slice_fill_default` is fine.
                            let export_clauses =
                                allocator.alloc_slice_fill_default::<js_ast::ClauseItem>(n);
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
                                let name: &[u8] =
                                    key.data.e_string_mut().expect("infallible: variant checked").slice(allocator);
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
                                // PORT NOTE: spec transpiler.zig:1030-1071
                                // writes at `i` and shrinks to `count`, leaving
                                // holes when `"default"` / duplicates `continue`
                                // — a latent spec bug. Write densely at `count`
                                // (and store `count` in the checker) so
                                // `truncate(count)` / `[..count]` keep the
                                // actually-populated entries.
                                *visited.value_ptr = count as u32;

                                symbols[count] = js_ast::Symbol {
                                    original_name: match bun_string::MutableString::ensure_valid_identifier(name) {
                                        // Spec transpiler.zig:1049 calls
                                        // `MutableString.ensureValidIdentifier(name, allocator)`
                                        // — the identifier lives in the
                                        // per-parse arena. Arena-copy the
                                        // owned `Box<[u8]>` so it is freed
                                        // with the arena instead of leaking
                                        // (PORTING.md §Forbidden patterns
                                        // bars `Box::into_raw` for `&'static`).
                                        // SAFETY: ARENA — `allocator` outlives
                                        // the returned `ParseResult.ast`.
                                        Ok(boxed) => {
                                            allocator.alloc_slice_copy(&boxed) as *const [u8]
                                        }
                                        Err(_) => return None,
                                    },
                                    ..Default::default()
                                };

                                let ref_ = js_ast::Ref::init(count as u32, 0, false);
                                decls[count] = js_ast::G::Decl {
                                    binding: js_ast::Binding::alloc(
                                        allocator,
                                        js_ast::ast::b::Identifier { r#ref: ref_ },
                                        key_loc,
                                    ),
                                    value: Some(prop.value.expect("infallible: prop has value")),
                                };
                                export_clauses[count] = js_ast::ClauseItem {
                                    name: js_ast::LocRef { ref_: Some(ref_), loc: key_loc },
                                    alias: name as *const [u8],
                                    alias_loc: key_loc,
                                    ..Default::default()
                                };
                                let value_loc = prop.value.expect("infallible: prop has value").loc;
                                prop.value =
                                    Some(js_ast::Expr::init_identifier(ref_, value_loc));
                                count += 1;
                            }

                            decls.truncate(count);
                            let stmt0 = js_ast::Stmt::alloc(
                                js_ast::S::Local {
                                    decls: js_ast::G::DeclList::move_from_list(decls),
                                    kind: js_ast::S::Kind::KVar,
                                    ..Default::default()
                                },
                                logger::Loc { start: 0 },
                            );
                            let stmt1 = js_ast::Stmt::alloc(
                                js_ast::S::ExportClause {
                                    items: &mut export_clauses[..count] as *mut [js_ast::ClauseItem],
                                    is_single_line: false,
                                },
                                logger::Loc { start: 0 },
                            );
                            let stmt2 = js_ast::Stmt::alloc(
                                js_ast::S::ExportDefault {
                                    value: js_ast::StmtOrExpr::Expr(expr),
                                    default_name: js_ast::LocRef {
                                        loc: logger::Loc::default(),
                                        ref_: Some(js_ast::Ref::NONE),
                                    },
                                },
                                logger::Loc { start: 0 },
                            );

                            let stmts = allocator.alloc_slice_copy(&[stmt0, stmt1, stmt2])
                                as *mut [js_ast::Stmt];
                            break 'parts Box::new([js_ast::Part { stmts, ..Default::default() }]);
                        }
                    }

                    {
                        let stmt = js_ast::Stmt::alloc(
                            js_ast::S::ExportDefault {
                                value: js_ast::StmtOrExpr::Expr(expr),
                                default_name: js_ast::LocRef {
                                    loc: logger::Loc::default(),
                                    ref_: Some(js_ast::Ref::NONE),
                                },
                            },
                            logger::Loc { start: 0 },
                        );

                        let stmts =
                            allocator.alloc_slice_copy(&[stmt]) as *mut [js_ast::Stmt];
                        break 'parts Box::new([js_ast::Part { stmts, ..Default::default() }]);
                    }
                };
                let mut ast = js_ast::Ast::from_parts(parts);
                ast.symbols =
                    js_ast::ast::symbol::List::from_owned_slice(symbols.into_boxed_slice());

                return Some(ParseResult {
                    ast,
                    source: dup_source(source),
                    loader,
                    input_fd,
                    already_bundled: AlreadyBundled::None,
                    pending_imports: Default::default(),
                    runtime_transpiler_cache: None,
                    empty: false,
                    source_contents_backing: source_backing,
                });
            }
            // TODO: use lazy export AST
            options::Loader::Text => {
                let expr = js_ast::Expr::init(
                    js_ast::E::EString::init(&source.contents),
                    logger::Loc::EMPTY,
                );
                let stmt = js_ast::Stmt::alloc(
                    js_ast::S::ExportDefault {
                        value: js_ast::StmtOrExpr::Expr(expr),
                        default_name: js_ast::LocRef {
                            loc: logger::Loc::default(),
                            ref_: Some(js_ast::Ref::NONE),
                        },
                    },
                    logger::Loc { start: 0 },
                );
                // PERF(port): was `allocator.alloc(Stmt, 1) catch unreachable`.
                let stmts = allocator.alloc_slice_copy(&[stmt]) as *mut [js_ast::Stmt];
                let parts: Box<[js_ast::Part]> =
                    Box::new([js_ast::Part { stmts, ..Default::default() }]);

                return Some(ParseResult {
                    ast: js_ast::Ast::from_parts(parts),
                    source: dup_source(source),
                    loader,
                    input_fd,
                    already_bundled: AlreadyBundled::None,
                    pending_imports: Default::default(),
                    runtime_transpiler_cache: None,
                    empty: false,
                    source_contents_backing: source_backing,
                });
            }
            options::Loader::Md => {
                let html: &'static [u8] = match bun_md::root::render_to_html(&source.contents) {
                    // Spec transpiler.zig:1162 allocates the rendered HTML via
                    // `allocator` (the per-parse arena), so it is freed with the
                    // arena. Arena-copy the heap `Box<[u8]>` and let it drop;
                    // PORTING.md §Forbidden patterns bars `Box::leak` here.
                    // SAFETY: ARENA — `allocator` outlives the returned
                    // `ParseResult.ast` (Phase-A `Str` convention erases
                    // `'bump` to `'static` for `E::String.data`).
                    Ok(h) => unsafe { &*(allocator.alloc_slice_copy(&h) as *const [u8]) },
                    Err(_) => {
                        let _ = log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!("Failed to render markdown to HTML"),
                        );
                        return None;
                    }
                };
                let expr = js_ast::Expr::init(js_ast::E::EString::init(html), logger::Loc::EMPTY);
                let stmt = js_ast::Stmt::alloc(
                    js_ast::S::ExportDefault {
                        value: js_ast::StmtOrExpr::Expr(expr),
                        default_name: js_ast::LocRef {
                            loc: logger::Loc::default(),
                            ref_: Some(js_ast::Ref::NONE),
                        },
                    },
                    logger::Loc { start: 0 },
                );
                let stmts = allocator.alloc_slice_copy(&[stmt]) as *mut [js_ast::Stmt];
                let parts: Box<[js_ast::Part]> =
                    Box::new([js_ast::Part { stmts, ..Default::default() }]);

                return Some(ParseResult {
                    ast: js_ast::Ast::from_parts(parts),
                    source: dup_source(source),
                    loader,
                    input_fd,
                    already_bundled: AlreadyBundled::None,
                    pending_imports: Default::default(),
                    runtime_transpiler_cache: None,
                    empty: false,
                    source_contents_backing: source_backing,
                });
            }
            options::Loader::Wasm => {
                if self.options.target.is_bun() {
                    if !source.is_web_assembly() {
                        let _ = log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "Invalid wasm file \"{}\" (missing magic header)",
                                bstr::BStr::new(path.text)
                            ),
                        );
                        return None;
                    }

                    return Some(ParseResult {
                        ast: js_ast::Ast::empty(),
                        source: dup_source(source),
                        loader,
                        input_fd,
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        runtime_transpiler_cache: None,
                        empty: false,
                        source_contents_backing: source_backing,
                    });
                }
            }
            options::Loader::Css => {}
            options::Loader::File
            | options::Loader::Napi
            | options::Loader::Base64
            | options::Loader::Dataurl
            | options::Loader::Bunsh
            | options::Loader::Sqlite
            | options::Loader::SqliteEmbedded
            | options::Loader::Html => {
                // Spec transpiler.zig:1216 — programmer-error hard crash, NOT a
                // silent `None` (PORTING.md §Forbidden: silent no-op).
                bun_core::Output::panic(format_args!(
                    "Unsupported loader {:?} for path: {}",
                    loader,
                    bstr::BStr::new(path.text),
                ));
            }
        }

        None
    }
}

// ══════════════════════════════════════════════════════════════════════════
// B-2 un-gated: `Transpiler::print` / `print_with_source_map` — final step of
// `ModuleLoader::transpile_source_code` (jsc_hooks.rs spec :525-539). The
// `bun_js_printer` entry points (`print_ast` / `print_common_js` / `Options` /
// `SourceMapHandler` / `Format` / `WriterTrait`) are now real types; un-gate
// the dispatch shim so `RuntimeTranspilerStore` / `AsyncModule` link.
//
// PORT NOTE: `comptime format: js_printer.Format` demoted to a runtime arg —
// `bun_js_printer::Format` doesn't derive `ConstParamTy` (and can't be added
// from this crate). All un-gated callers pass a literal anyway; the inner
// `print_ast::<_, ASCII_ONLY, ENABLE_SOURCE_MAP>` keeps both real comptime
// bools, so codegen monomorphizes the printer body identically.
// PERF(port): outer `match format` is one extra branch — profile in Phase B.
// ══════════════════════════════════════════════════════════════════════════

use bun_js_printer as js_printer;
// PORT NOTE: `module_info` threads the *printer's* `analyze_transpiled_module::ModuleInfo`
// (the producer), not `crate::analyze_transpiled_module::ModuleInfo` (the
// richer consumer-side mirror). The two were CYCLEBREAK siblings; the print
// path only ever fills the printer-owned one and hands its serialized bytes to
// T6, so unify on the printer type here. Spec: transpiler.zig:663.
use js_printer::analyze_transpiled_module;

/// Map the bundler-local `Target` (options.rs:489) to the lower-tier
/// `bun_options_types::BundleEnums::Target` consumed by `js_printer::Options`.
/// The two enums are variant-for-variant identical but nominally distinct;
/// Phase B-3 collapses them (see lib.rs `pub mod options` shadow note).
#[inline]
fn to_bundle_enums_target(t: crate::options_impl::Target) -> bun_options_types::BundleEnums::Target {
    use bun_options_types::BundleEnums::Target as T;
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
    fn print_with_source_map_maybe<W, const ENABLE_SOURCE_MAP: bool>(
        &mut self,
        mut ast: js_ast::Ast,
        source: &logger::Source,
        writer: W,
        format: js_printer::Format,
        source_map_context: Option<js_printer::SourceMapHandler<'_>>,
        runtime_transpiler_cache: Option<core::ptr::NonNull<RuntimeTranspilerCache>>,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error>
    where
        W: js_printer::WriterTrait,
    {
        // TODO(port): narrow error set
        // TODO(port): `bun.perf.trace("JSPrinter.printWithSourceMap")` /
        // `("JSPrinter.print")` — `bun_perf::trace` now takes a `PerfEvent`
        // enum and neither variant is in `generated_perf_trace_events.rs`
        // yet. Re-add once `scripts/generate-perf-trace-events.sh` runs
        // against the Rust tree.

        // PORT NOTE: Zig built `Symbol.NestedList.fromBorrowedSliceDangerous(
        // &.{ast.symbols})` — aliased the stack-one-slice into the map. Rust
        // can't borrow `ast.symbols` while moving `ast` into `print_ast`, so
        // take the column out (the printer never reads `tree.symbols`; it
        // walks `symbols` exclusively — `rg tree.symbols js_printer/lib.rs` is
        // empty). `init_with_one_list` boxes the single inner list.
        // PERF(port): one extra alloc vs Zig's borrowed-slice — profile Phase B.
        let symbols = js_ast::ast::symbol::Map::init_with_one_list(core::mem::take(&mut ast.symbols));

        // `runtime_imports` is now forwarded — after Round-G `Ast.runtime_imports`
        // is the real `parser::Runtime::Imports`, the same type
        // `js_printer::Options.runtime_imports` takes (via `js_ast::runtime`),
        // so the seam is gone. Spec: zig:593/619/645.
        // `target` is now forwarded via `to_bundle_enums_target` below — it
        // *does* affect the EsmAscii/bun-runtime path (js_printer/lib.rs:6872
        // gates the `var {require}=import.meta;` hoist on `target == Bun`;
        // regression of oven-sh/bun#15738 if left at the `Browser` default).
        // `runtime_transpiler_cache` is now forwarded — erased through
        // `cache::RUNTIME_TRANSPILER_CACHE_VTABLE` so js_printer can call
        // `put` without naming `crate::cache`. Spec: zig:601/627/662.
        // `module_info` is now forwarded — this fn's parameter is the
        // printer-crate `analyze_transpiled_module::ModuleInfo` (see the `use`
        // above), so the seam is gone. Spec: zig:663 — EsmAscii arm only.

        let runtime_transpiler_cache =
            runtime_transpiler_cache.map(RuntimeTranspilerCache::as_printer_ref);

        let require_ref = ast.require_ref;
        let import_meta_ref = ast.import_meta_ref;
        let wrapper_ref = ast.wrapper_ref;
        let exports_kind = ast.exports_kind;

        match format {
            js_printer::Format::Cjs => js_printer::print_common_js::<W, false, ENABLE_SOURCE_MAP>(
                writer,
                // PORT NOTE: `print_common_js` grew a `&bumpalo::Bump` arg in
                // the Rust port (for `binary_expression_stack` arena). Zig
                // threaded `opts.allocator`; here `self.allocator` IS the
                // per-transpiler `bun_alloc::Arena = bumpalo::Bump`.
                self.allocator,
                &ast,
                symbols,
                source,
                js_printer::Options {
                    bundling: false,
                    runtime_imports: ast.runtime_imports.clone(),
                    require_ref: Some(require_ref),
                    css_import_behavior: self.options.css_import_behavior(),
                    source_map_handler: source_map_context,
                    minify_whitespace: self.options.minify_whitespace,
                    minify_syntax: self.options.minify_syntax,
                    minify_identifiers: self.options.minify_identifiers,
                    transform_only: self.options.transform_only,
                    print_dce_annotations: self.options.emit_dce_annotations,
                    runtime_transpiler_cache,
                    hmr_ref: wrapper_ref,
                    mangled_props: None,
                    ..Default::default()
                },
            ),

            js_printer::Format::Esm => {
                let opts = js_printer::Options {
                    bundling: false,
                    runtime_imports: ast.runtime_imports.clone(),
                    require_ref: Some(require_ref),
                    css_import_behavior: self.options.css_import_behavior(),
                    source_map_handler: source_map_context,
                    minify_whitespace: self.options.minify_whitespace,
                    minify_syntax: self.options.minify_syntax,
                    minify_identifiers: self.options.minify_identifiers,
                    transform_only: self.options.transform_only,
                    import_meta_ref,
                    print_dce_annotations: self.options.emit_dce_annotations,
                    runtime_transpiler_cache,
                    hmr_ref: wrapper_ref,
                    mangled_props: None,
                    ..Default::default()
                };
                js_printer::print_ast::<W, false, ENABLE_SOURCE_MAP>(
                    writer,
                    // PORT NOTE: `print_ast` takes a `&bumpalo::Bump` (for
                    // `binary_expression_stack` arena) — same as the Cjs arm.
                    self.allocator,
                    &ast,
                    symbols,
                    source,
                    opts,
                )
            }

            js_printer::Format::EsmAscii => {
                // PORT NOTE: `switch (target.isBun()) { inline else => |is_bun| ... }`
                // — runtime bool → comptime dispatch. Hoisted into the
                // `print_ast_esm_ascii` helper so the const-generic IS_BUN can
                // also drive `module_type`.
                if self.options.target.is_bun() {
                    self.print_ast_esm_ascii::<W, ENABLE_SOURCE_MAP, true>(
                        writer, ast, symbols, source, source_map_context, exports_kind,
                        runtime_transpiler_cache, module_info,
                    )
                } else {
                    self.print_ast_esm_ascii::<W, ENABLE_SOURCE_MAP, false>(
                        writer, ast, symbols, source, source_map_context, exports_kind,
                        runtime_transpiler_cache, module_info,
                    )
                }
            }

            // Spec transpiler.zig:672 `else => unreachable`.
            js_printer::Format::CjsAscii => unreachable!(),
        }
    }

    // PORT NOTE: hoisted from `inline else => |is_bun|` arm of
    // print_with_source_map_maybe to express the comptime bool dispatch as a
    // const generic.
    #[allow(clippy::too_many_arguments)]
    fn print_ast_esm_ascii<W, const ENABLE_SOURCE_MAP: bool, const IS_BUN: bool>(
        &mut self,
        writer: W,
        ast: js_ast::Ast,
        symbols: js_ast::ast::symbol::Map,
        source: &logger::Source,
        source_map_context: Option<js_printer::SourceMapHandler<'_>>,
        exports_kind: js_ast::ExportsKind,
        runtime_transpiler_cache: Option<js_printer::RuntimeTranspilerCacheRef>,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error>
    where
        W: js_printer::WriterTrait,
    {
        // Spec transpiler.zig:662-663 — both set on this (EsmAscii) arm only.
        // SAFETY: `module_info` is `ModuleInfo::create`'s `Box::into_raw` (or
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
            } else if exports_kind == js_ast::ExportsKind::Cjs {
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
            // Spec transpiler.zig:664. The printer reads `opts.target` at
            // js_printer/lib.rs:6872 to gate the `var {require}=import.meta;`
            // hoist on `Target::Bun` — defaulting to `Browser` here regressed
            // oven-sh/bun#15738.
            target: to_bundle_enums_target(self.options.target),
            ..Default::default()
        };
        js_printer::print_ast::<W, IS_BUN, ENABLE_SOURCE_MAP>(
            writer,
            // PORT NOTE: thread the per-transpiler arena (mirrors the Cjs arm /
            // spec transpiler.zig:635 — same shape across all three arms).
            self.allocator,
            &ast,
            symbols,
            source,
            opts,
        )
    }

    pub fn print<W>(
        &mut self,
        result: ParseResult,
        writer: W,
        format: js_printer::Format,
    ) -> Result<usize, bun_core::Error>
    where
        W: js_printer::WriterTrait,
    {
        self.print_with_source_map_maybe::<W, false>(
            result.ast,
            &result.source,
            writer,
            format,
            None,
            None,
            None,
        )
    }

    pub fn print_with_source_map<W>(
        &mut self,
        result: ParseResult,
        writer: W,
        format: js_printer::Format,
        handler: js_printer::SourceMapHandler<'_>,
        module_info: Option<*mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, bun_core::Error>
    where
        W: js_printer::WriterTrait,
    {
        // PORT NOTE: env_var feature_flag getters return `Option<bool>`
        // (Some(default) when unset); Zig's `.get()` is plain `bool`.
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS
            .get()
            .unwrap_or(false)
        {
            return self.print_with_source_map_maybe::<W, false>(
                result.ast,
                &result.source,
                writer,
                format,
                Some(handler),
                result.runtime_transpiler_cache,
                module_info,
            );
        }
        self.print_with_source_map_maybe::<W, true>(
            result.ast,
            &result.source,
            writer,
            format,
            Some(handler),
            result.runtime_transpiler_cache,
            module_info,
        )
    }

    /// Port of `transpiler.zig:1225 normalizeEntryPointPath`.
    fn normalize_entry_point_path(&self, _entry: &[u8]) -> &'static [u8] {
        // SAFETY: `self.fs` is the process-lifetime `Fs::FileSystem::instance`
        // singleton wired in `Transpiler::init`.
        let fs = unsafe { &*self.fs };
        let entry = fs.abs(&[_entry]);

        // Spec: `std.fs.accessAbsolute(entry, .{}) catch return _entry` — if the
        // absolutized path does not exist on disk, return the original input
        // unchanged so bare specifiers (`react`) and URLs are left alone.
        if !bun_sys::exists(entry) {
            return crate::linker::dupe(_entry);
        }

        let entry = fs.relative_to(entry);

        if !strings::starts_with(entry, b"./") {
            // Entry point paths without a leading "./" are interpreted as package
            // paths. This happens because they go through general path resolution
            // like all other import paths so that plugins can run on them. Requiring
            // a leading "./" for a relative path simplifies writing plugins because
            // entry points aren't a special case.
            //
            // However, requiring a leading "./" also breaks backward compatibility
            // and makes working with the CLI more difficult. So attempt to insert
            // "./" automatically when needed. We don't want to unconditionally insert
            // a leading "./" because the path may not be a file system path. For
            // example, it may be a URL. So only insert a leading "./" when the path
            // is an exact match for an existing file.
            let mut __entry = Vec::with_capacity(2 + entry.len());
            __entry.extend_from_slice(b"./");
            __entry.extend_from_slice(entry);
            return crate::linker::dupe(&__entry);
        }
        crate::linker::dupe(entry)
    }

    /// Port of `transpiler.zig:1254 enqueueEntryPoints`.
    ///
    /// PORT NOTE: the Zig version writes the resolved entry results into a
    /// caller-provided `[]Result` slice; the only caller (`transform`) discards
    /// that slice immediately, so the Rust port returns only the count and lets
    /// `linker.enqueue_resolve_result` push directly onto `resolve_queue`.
    fn enqueue_entry_points<const NORMALIZE_ENTRY_POINT: bool>(&mut self) -> usize {
        let mut entry_point_i: usize = 0;

        // PORT NOTE: snapshot entry points so the `&mut self` resolver call
        // does not conflict with the `&self.options` borrow.
        let entries: Vec<Box<[u8]>> = self.options.entry_points.iter().cloned().collect();
        // SAFETY: `self.fs` is the process-lifetime `Fs::FileSystem::instance`
        // singleton wired in `Transpiler::init`.
        let top_level_dir = unsafe { (*self.fs).top_level_dir };

        for _entry in entries.iter() {
            let entry: &[u8] = if NORMALIZE_ENTRY_POINT {
                self.normalize_entry_point_path(_entry)
            } else {
                _entry
            };

            let _reset = js_ast::ast::StoreResetGuard::new();

            let result = match self.resolver.resolve(
                top_level_dir,
                entry,
                bun_options_types::ImportKind::EntryPointBuild,
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
        log: *mut logger::Log,
        _opts: api::TransformOptions,
    ) -> Result<options::TransformResult, bun_core::Error> {
        let _ = self.enqueue_entry_points::<true>();

        // SAFETY: `log` is the same `*mut Log` stored on `self.log`; caller
        // (`BuildCommand::exec`) holds it for the process lifetime.
        if unsafe { &*log }.level.at_least(logger::Level::Debug) {
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
            // SAFETY: `self.options.log` is non-null after `init`.
            && unsafe { &*self.options.log }.level.at_least(logger::Level::Info)
        {
            bun_core::Output::pretty_errorln(format_args!(
                "<r><d>\n---Tracing---\nResolve time:      {}\nParsing time:      {}\n---Tracing--\n\n<r>",
                self.resolver.elapsed, self.elapsed,
            ));
        }

        let outbase: Box<[u8]> = self.result.outbase.clone();
        let output_files: Box<[options::OutputFile]> =
            std::mem::take(&mut self.output_files).into_boxed_slice();
        // SAFETY: see above.
        let mut final_result = options::TransformResult::init(outbase, output_files, unsafe {
            &mut *log
        })?;
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
            js_ast::Expr::data_store_reset();
            js_ast::Stmt::data_store_reset();

            let output_file = match self.build_with_resolve_result_eager(
                item,
                import_path_format,
                &outstream,
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
        resolve_result: resolver::Result,
        import_path_format: options::ImportPathFormat,
        _outstream: &TransformOutstream,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Result<Option<options::OutputFile>, bun_core::Error> {
        if resolve_result.flags.is_external() {
            return Ok(None);
        }

        let Some(file_path_ref) = resolve_result.path_const() else {
            return Ok(None);
        };
        // PORT NOTE: `resolver::Result.path_pair` carries `bun_resolver::fs::Path<'_>`;
        // downstream `linker.link`/`get_hashed_filename` and `OutputFile.src_path`
        // expect `bun_paths::fs::Path<'_>` / `bun_logger::fs::Path`. Re-init via
        // `text` (the only field both shapes share semantically).
        let file_path_text: &'static [u8] = crate::linker::dupe(file_path_ref.text);
        let file_path_ext: &'static [u8] = crate::linker::dupe(file_path_ref.name.ext);

        // Step 1. Parse & scan
        // Spec (transpiler.zig:397) keys the loader on the ORIGINAL resolve
        // result's extension *before* the `client_entry_point` path override
        // (line 400). Compute it here, then apply the override.
        let loader = self.options.loader(file_path_ext);

        // `client_entry_point_` is always `None` from the only in-tree caller;
        // its source path uses the `logger::fs::Path` shape, so just override
        // text/ext when present.
        let (file_path_text, file_path_ext) = if let Some(cep) = client_entry_point_.as_deref() {
            (
                crate::linker::dupe(cep.source.path.text),
                crate::linker::dupe(cep.source.path.name.ext),
            )
        } else {
            (file_path_text, file_path_ext)
        };

        let mut file_path = Fs::Path::init(file_path_text);

        // SAFETY: `self.fs` is the process-lifetime singleton.
        let top_level_dir = unsafe { (*self.fs).top_level_dir };
        let rel = bun_paths::resolve_path::relative(top_level_dir, file_path_text);
        file_path.pretty = crate::linker::dupe(rel);

        let mut output_file = options::OutputFile::zero_value();
        output_file.src_path = logger::fs::Path::init(file_path_text);
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
                let emit_decorator_metadata =
                    resolve_result.flags.emit_decorator_metadata();
                let experimental_decorators = resolve_result.flags.experimental_decorators();
                // TODO(port): `MacroRemap` (StringArrayHashMap of StringArrayHashMap)
                // has no nested `Clone` impl; the Zig copied it by value. Re-key
                // shallowly here matching the build-command conversion.
                let macro_remappings = {
                    let mut m = MacroRemap::default();
                    for (k, v) in self.options.macro_remap.iter() {
                        let inner = v
                            .clone()
                            .map_err(|_| bun_core::err!("OutOfMemory"))?;
                        m.insert(k, inner);
                    }
                    m
                };

                let parse_opts = ParseOptions {
                    allocator: self.allocator,
                    path: logger::fs::Path::init(file_path_text),
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

                output_file.size = match self.options.target {
                    options::Target::Browser | options::Target::Node => {
                        self.print(result, &mut writer, js_printer::Format::Esm)?
                    }
                    options::Target::Bun
                    | options::Target::BunMacro
                    | options::Target::BakeServerComponentsSsr => {
                        self.print(result, &mut writer, js_printer::Format::EsmAscii)?
                    }
                };
                output_file.value = crate::output_file::Value::Buffer {
                    bytes: writer.ctx.written().to_vec().into_boxed_slice(),
                };
            }
            options::Loader::Dataurl | options::Loader::Base64 => {
                bun_core::Output::panic(format_args!("TODO: dataurl, base64"));
            }
            options::Loader::Css => {
                #[cfg(not(feature = "css"))]
                {
                    let _ = (&file_path, file_path_ext);
                    bun_core::Output::panic(format_args!(
                        "CSS loader requires the `css` feature"
                    ));
                }
                #[cfg(feature = "css")]
                {
                    use crate::ungate_support::bun_css;

                    // SAFETY: `self.fs` is the process-lifetime singleton.
                    let fs = unsafe { &mut *self.fs };
                    let entry = match self.resolver.caches.fs.read_file_with_allocator(
                        fs,
                        file_path_text,
                        resolve_result.dirname_fd,
                        false,
                        None,
                    ) {
                        Ok(e) => e,
                        Err(err) => {
                            // SAFETY: `self.log` is non-null after `init`.
                            let _ = unsafe { &mut *self.log }.add_error_fmt(
                                None,
                                logger::Loc::EMPTY,
                                format_args!(
                                    "{} reading \"{}\"",
                                    err.name(),
                                    bstr::BStr::new(file_path.pretty),
                                ),
                            );
                            return Ok(None);
                        }
                    };

                    // SAFETY: `self.log` is non-null after `init`; the
                    // `ParserOptions.logger` `NonNull<Log>` borrow is dropped
                    // when `sheet`/`opts` go out of scope at the end of this
                    // arm, before any other `&mut *self.log` deref above.
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

                    // SAFETY: `self.allocator` is the per-transpile arena;
                    // the CSS AST it backs is dropped before this fn returns
                    // (only `result.code: Vec<u8>` escapes, which is
                    // global-heap). `'static` matches the crate-wide erasure
                    // on `StyleSheet`/`ParserOptions` (see css_parser.rs
                    // TODO(port): 'bump threading).
                    let alloc: &'static Arena =
                        unsafe { &*(self.allocator as *const Arena) };

                    let (mut sheet, extra) = match bun_css::StyleSheet::<
                        bun_css::DefaultAtRule,
                    >::parse(
                        alloc,
                        entry.contents(),
                        opts,
                        None,
                        bun_css::SrcIndex::INVALID,
                    ) {
                        Ok(v) => v,
                        Err(e) => {
                            // SAFETY: `self.log` is non-null after `init`.
                            let _ = unsafe { &mut *self.log }.add_error_fmt(
                                None,
                                logger::Loc::EMPTY,
                                format_args!("{} parsing", e),
                            );
                            return Ok(None);
                        }
                    };
                    if let Err(e) =
                        sheet.minify(alloc, &bun_css::MinifyOptions::default(), &extra)
                    {
                        // SAFETY: `self.log` is non-null after `init`.
                        bun_core::handle_oom(unsafe { &mut *self.log }.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!("{} while minifying", e.kind),
                        ));
                        return Ok(None);
                    }
                    let symbols = bun_logger::symbol::Map::init_list(Default::default());
                    let result = match sheet.to_css(
                        alloc,
                        bun_css::PrinterOptions {
                            targets: bun_css::Targets::for_bundler_target(
                                self.options.target,
                            ),
                            minify: self.options.minify_whitespace,
                            ..bun_css::PrinterOptions::default()
                        },
                        None,
                        None,
                        &symbols,
                    ) {
                        Ok(v) => v,
                        Err(e) => {
                            // SAFETY: `self.log` is non-null after `init`.
                            bun_core::handle_oom(unsafe { &mut *self.log }.add_error_fmt(
                                None,
                                logger::Loc::EMPTY,
                                format_args!("{} while printing", e),
                            ));
                            return Ok(None);
                        }
                    };
                    output_file.value = crate::output_file::Value::Buffer {
                        bytes: result.code.into_boxed_slice(),
                    };
                }
            }
            options::Loader::Html
            | options::Loader::Bunsh
            | options::Loader::SqliteEmbedded
            | options::Loader::Sqlite
            | options::Loader::Wasm
            | options::Loader::File
            | options::Loader::Napi => {
                let hashed_name = self
                    .linker
                    .get_hashed_filename(&bun_paths::fs::Path::init(file_path_text), None)?;
                let mut pathname =
                    Vec::with_capacity(hashed_name.len() + file_path_ext.len());
                pathname.extend_from_slice(&hashed_name);
                pathname.extend_from_slice(file_path_ext);

                output_file.value =
                    crate::output_file::Value::Copy(crate::output_file::FileOperation {
                        pathname: pathname.into_boxed_slice(),
                        dir: self
                            .options
                            .output_dir_handle
                            .unwrap_or(bun_sys::Fd::INVALID),
                        is_outdir: true,
                        ..Default::default()
                    });
            }
        }

        Ok(Some(output_file))
    }
}

/// Port of the `comptime Outstream: type` parameter to
/// `processResolveQueue` / `buildWithResolveResultEager` — Zig switched on
/// `bun.sys.File` vs `std.fs.Dir` at the type level; collapse to a runtime
/// enum since the only behavioural difference is unused (`_ = outstream`).
#[allow(dead_code)]
#[derive(Clone, Copy)]
enum TransformOutstream {
    Stdout,
    Dir(bun_sys::Fd),
}

/// Port of `transpiler.zig:374 BuildResolveResultPair`.
pub struct BuildResolveResultPair {
    pub written: usize,
    pub input_fd: Option<FD>,
    pub empty: bool,
}

impl Default for BuildResolveResultPair {
    fn default() -> Self {
        Self { written: 0, input_fd: None, empty: false }
    }
}

/// Port of `transpiler.zig:1405 ServeResult`.
pub struct ServeResult {
    pub file: options::OutputFile,
    pub mime_type: bun_http_types::MimeType::MimeType,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/transpiler.zig (1461 lines)
//   confidence: medium
//   notes:      `transform` / `enqueueEntryPoints` / `processResolveQueue` /
//               `buildWithResolveResultEager` ported for the legacy
//               single-file CLI path (`bun build --no-bundle`). CSS branch
//               of buildWithResolveResultEager falls back to file-copy until
//               the `css` cargo feature is wired to this crate's default set.
// ──────────────────────────────────────────────────────────────────────────

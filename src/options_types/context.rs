//! `Command.ContextData` and its option-carrying nested structs, lifted out of
//! `cli/cli.zig` so subsystems (install, bundler, bake, shell) can reference
//! the parsed-options shape without importing the CLI itself.
//!
//! `create()` (which calls `Arguments.parse`) and the `global_cli_ctx`/
//! `context_data` storage stay in `cli.rs`; they are forward-aliased onto
//! `ContextData` below so call sites that write `Command::ContextData::create()`
//! keep working.

use crate::schema::api;
use bun_collections::ArrayHashMap;

use crate::bundle_enums;
use crate::code_coverage_options::CodeCoverageOptions;
use crate::compile_target::CompileTarget;
use crate::global_cache::GlobalCache;
use crate::offline_mode::OfflineMode;

// TODO(port): every `[]const u8` / `[]const []const u8` struct field below is a
// proc-lifetime CLI string (no `deinit`, populated once from argv/bunfig and
// never freed). Ported as `Box<[u8]>` / `Vec<Box<[u8]>>` for now; Phase B may
// retype to `&'static [u8]` once the CLI parser leaks into a bump arena.

pub struct ContextData {
    pub start_time: i128,
    pub args: api::TransformOptions,
    /// Zig: `log: *Log`. Raw pointer (not `&mut`) so `Default` works and so the
    /// process-global `CONTEXT_DATA` static can be zero-initialized before
    /// `create_context_data()` writes the real `&mut Log` into it.
    // SAFETY: written exactly once in single-threaded CLI startup; thereafter
    // always non-null for the process lifetime. Callers deref via `ctx.log()`.
    pub log: *mut bun_ast::Log,
    // PORT NOTE: `std.mem.Allocator param` deleted (global mimalloc).
    pub positionals: Vec<Box<[u8]>>,
    pub passthrough: Vec<Box<[u8]>>,
    pub install: Option<Box<api::BunInstall>>,

    pub debug: DebugOptions,
    pub test_options: TestOptions,
    pub bundler_options: BundlerOptions,
    pub runtime_options: RuntimeOptions,

    pub filters: Vec<Box<[u8]>>,
    pub workspaces: bool,
    pub if_present: bool,
    pub parallel: bool,
    pub sequential: bool,
    pub no_exit_on_error: bool,

    pub preloads: Vec<Box<[u8]>>,
    pub has_loaded_global_config: bool,
}

impl Default for ContextData {
    // ── Startup .text page-fault reduction ───────────────────────────────
    // `--version` perf showed `ContextData::default` (1 638 B) plus its
    // out-of-line callees (`TransformOptions` / `DebugOptions` / `TestOptions`
    // / `BundlerOptions` / `RuntimeOptions` / `CodeCoverageOptions` /
    // `CompileTarget` / `CpuProf` …) sampling 31× across ≈10 distinct 4 KB
    // r-xp pages — each nested `Default` impl landed in its own CGU, so the
    // single call from `write_context_no_parse` faulted in ~40 KB of scattered
    // `.text`. The Zig spec is `std.mem.zeroes(Context)` (one comptime blob).
    //
    // A literal `unsafe { core::mem::zeroed() }` would match Zig but is
    // **unsound** in Rust: `Vec<T>` / `Box<[u8]>` carry a `NonNull` pointer
    // (validity invariant — null is immediate UB regardless of len). Instead,
    // every `Default` impl in this module is `#[inline(always)]` so the entire
    // recursive chain folds into the one `write_context_no_parse` call site
    // and lives on a single contiguous page. This removes the per-type callees
    // from the startup fault set without violating any niche invariants.
    #[inline(always)]
    fn default() -> Self {
        Self {
            start_time: 0,
            args: api::TransformOptions::default(),
            log: core::ptr::null_mut(),
            positionals: Vec::new(),
            passthrough: Vec::new(),
            install: None,
            debug: DebugOptions::default(),
            test_options: TestOptions::default(),
            bundler_options: BundlerOptions::default(),
            runtime_options: RuntimeOptions::default(),
            filters: Vec::new(),
            workspaces: false,
            if_present: false,
            parallel: false,
            sequential: false,
            no_exit_on_error: false,
            preloads: Vec::new(),
            has_loaded_global_config: false,
        }
    }
}

impl ContextData {
    /// Deref the process-lifetime `*mut Log` set in `create_context_data()`.
    ///
    /// Takes `&mut self` (not `&self`) so the borrow checker ties the returned
    /// `&mut Log` to an exclusive borrow of the `ContextData` — Zig's `*Log`
    /// freely aliases, but in Rust a `&self -> &mut Log` accessor would let two
    /// live `&mut Log` overlap (UB). Note this is *necessary but not
    /// sufficient*: the same `*Log` is borrowed (not owned) from the CLI
    /// caller and is also fanned out to and stored by the transpiler/bundler
    /// (`bundler/options.zig`), the install pipeline (`install/migration.zig`,
    /// `install/PackageManagerOptions.zig`), JSON parsing
    /// (`interchange/json.zig`), etc. Exclusive `self` does NOT exclude those
    /// aliases — see `# Safety` for the full precondition.
    ///
    /// # Safety
    /// - `self.log` must have been populated by `create_context_data()` (i.e.
    ///   this `ContextData` is the global CLI context) and remain valid for the
    ///   lifetime of the returned reference.
    /// - No other reference (`&` or `&mut`) to the pointed-to `Log` — including
    ///   any derived from the CLI caller's original `*Log` or from copies held
    ///   by the transpiler/bundler/install/JSON subsystems — may be live for
    ///   the lifetime of the returned `&mut`.
    #[inline]
    pub unsafe fn log(&mut self) -> &mut bun_ast::Log {
        debug_assert!(!self.log.is_null());
        // SAFETY: single-threaded CLI startup writes a process-lifetime pointer
        // and never invalidates it; the caller's `# Safety` contract guarantees
        // no overlapping borrow of the same `Log` (which is aliased elsewhere —
        // `&mut self` alone cannot prove exclusivity here).
        unsafe { &mut *self.log }
    }

    /// Mutable accessor for the process-lifetime CLI `Log`.
    ///
    /// `self.log` is the `*mut bun_ast::Log` written exactly once by
    /// `create_context_data()` during single-threaded CLI startup, pointing at
    /// the static `Cli::LOG_` storage. Other subsystems that copy the same
    /// `*mut Log` (transpiler, install) reborrow it via their own raw-pointer
    /// accessors. Centralizing the deref here removes ~20 identical
    /// `unsafe { &mut *ctx.log }` blocks at call sites.
    ///
    /// Takes `&self` (not `&mut self`) because several CLI entry points hold
    /// `&Context<'_>` (= `&&mut ContextData`) and a `&mut self` receiver could
    /// not prove exclusivity over the `Log` anyway — the pointer is aliased
    /// outside `ContextData` (see `Transpiler::log_mut`,
    /// `PackageManager::log_mut`). Note that a `&self` receiver provides **no**
    /// static guarantee against interleaving two `log_mut()` results — shared
    /// borrows do not exclude one another — hence this function is `unsafe`.
    ///
    /// # Safety
    /// The caller must ensure that for the lifetime of the returned `&mut Log`
    /// no other reference to the same `Log` exists: no second `log_mut()`
    /// borrow, no overlapping [`log_ref`] borrow, and no live `&mut Log`
    /// obtained via any other aliasing path (`Transpiler::log_mut`,
    /// `PackageManager::log_mut`, etc.). CLI dispatch is single-threaded, so
    /// this reduces to "do not hold the result across a call that may itself
    /// reborrow the log".
    ///
    /// # Panics
    /// If `self.log` is null (i.e. `create_context_data()` has not run).
    #[track_caller]
    #[inline]
    pub unsafe fn log_mut(&self) -> &mut bun_ast::Log {
        assert!(
            !self.log.is_null(),
            "ContextData::log_mut() before create_context_data()"
        );
        // SAFETY: `self.log` is non-null (asserted) and points at the
        // process-static `Cli::LOG_` (`'static`); the caller's `# Safety`
        // contract guarantees no overlapping borrow of the same `Log`.
        unsafe { &mut *self.log }
    }

    /// Shared-ref counterpart of [`log_mut`] for read-only inspection
    /// (`has_errors()`, `print()`).
    #[track_caller]
    #[inline]
    pub fn log_ref(&self) -> &bun_ast::Log {
        assert!(
            !self.log.is_null(),
            "ContextData::log_ref() before create_context_data()"
        );
        // SAFETY: `self.log` is non-null (asserted) and points at the
        // process-static `Cli::LOG_`; shared `&` may freely alias other
        // shared borrows. Callers of `log_mut` are obligated not to hold a
        // live `&mut Log` overlapping this.
        unsafe { &*self.log }
    }

    /// `Arguments.parse` lives in `cli/`; forward-aliased so
    /// `Command::ContextData::create(...)` keeps working.
    // TODO(port): Zig was `pub const create = bun.cli.Command.createContextData;`
    // — Rust cannot re-export an associated fn; TODO(port): add a thin
    // delegating `pub fn create(...)` here once `bun_cli` exists, or invert the
    // alias direction (cli re-exports this type).
    #[allow(unused)]
    pub const CREATE_SEE_CLI: () = ();
}

pub struct BundlerOptions {
    pub outdir: Box<[u8]>,
    pub outfile: Box<[u8]>,
    // TODO(port): was `[:0]const u8` (NUL-terminated); decide owned ZStr repr.
    pub metafile: Box<[u8]>,
    // TODO(port): was `[:0]const u8` (NUL-terminated); decide owned ZStr repr.
    pub metafile_md: Box<[u8]>,
    pub root_dir: Box<[u8]>,
    pub public_path: Box<[u8]>,
    pub entry_naming: Box<[u8]>,
    pub chunk_naming: Box<[u8]>,
    pub asset_naming: Box<[u8]>,
    pub server_components: bool,
    pub react_fast_refresh: bool,
    pub code_splitting: bool,
    pub transform_only: bool,
    pub inline_entrypoint_import_meta_main: bool,
    pub minify_syntax: bool,
    pub minify_whitespace: bool,
    pub minify_identifiers: bool,
    pub keep_names: bool,
    pub ignore_dce_annotations: bool,
    pub emit_dce_annotations: bool,
    pub output_format: bundle_enums::Format,
    pub bytecode: bool,
    pub banner: Box<[u8]>,
    pub footer: Box<[u8]>,
    pub css_chunking: bool,
    pub bake: bool,
    pub bake_debug_dump_server: bool,
    pub bake_debug_disable_minify: bool,

    pub production: bool,

    pub env_behavior: api::DotEnvBehavior,
    pub env_prefix: Box<[u8]>,
    pub elide_lines: Option<usize>,
    // Compile options
    pub compile: bool,
    pub compile_target: CompileTarget,
    pub compile_exec_argv: Option<Box<[u8]>>,
    pub compile_autoload_dotenv: bool,
    pub compile_autoload_bunfig: bool,
    pub compile_autoload_tsconfig: bool,
    pub compile_autoload_package_json: bool,
    pub compile_executable_path: Option<Box<[u8]>>,
    pub windows: bundle_enums::WindowsOptions,
    pub allow_unresolved: Option<Vec<Box<[u8]>>>,
}

impl Default for BundlerOptions {
    // See `ContextData::default` — folded into the single startup call site.
    #[inline(always)]
    fn default() -> Self {
        Self {
            outdir: Box::default(),
            outfile: Box::default(),
            metafile: Box::default(),
            metafile_md: Box::default(),
            root_dir: Box::default(),
            public_path: Box::default(),
            entry_naming: Box::from(&b"[dir]/[name].[ext]"[..]),
            chunk_naming: Box::from(&b"./[name]-[hash].[ext]"[..]),
            asset_naming: Box::from(&b"./[name]-[hash].[ext]"[..]),
            server_components: false,
            react_fast_refresh: false,
            code_splitting: false,
            transform_only: false,
            inline_entrypoint_import_meta_main: false,
            minify_syntax: false,
            minify_whitespace: false,
            minify_identifiers: false,
            keep_names: false,
            ignore_dce_annotations: false,
            emit_dce_annotations: true,
            output_format: bundle_enums::Format::Esm,
            bytecode: false,
            banner: Box::default(),
            footer: Box::default(),
            css_chunking: false,
            bake: false,
            bake_debug_dump_server: false,
            bake_debug_disable_minify: false,
            production: false,
            env_behavior: api::DotEnvBehavior::disable,
            env_prefix: Box::default(),
            elide_lines: None,
            compile: false,
            compile_target: CompileTarget::default(),
            compile_exec_argv: None,
            compile_autoload_dotenv: true,
            compile_autoload_bunfig: true,
            compile_autoload_tsconfig: false,
            compile_autoload_package_json: false,
            compile_executable_path: None,
            windows: bundle_enums::WindowsOptions::default(),
            allow_unresolved: None,
        }
    }
}

pub type Context<'a> = &'a mut ContextData;
// TODO(port): Zig `*ContextData` is passed everywhere as a long-lived handle;
// the borrow lifetime above may need to become `*mut ContextData` at call sites
// that re-enter the global ctx (Phase B).

// ──────────────────────────────────────────────────────────────────────────
// Process-global CLI context handle.
//
// `ContextData` is owned by the CLI crate (storage lives in
// `bun_runtime::cli::command::CONTEXT_DATA`), but lower-tier crates such as
// `bun_jsc` need read access to parsed runtime options (e.g.
// `runtime_options.console_depth`) without taking a forward dep on
// `bun_runtime`. The CLI publishes its pointer here via `set_global` during
// single-threaded startup; readers use `try_get`.
static GLOBAL_CLI_CTX: core::sync::atomic::AtomicPtr<ContextData> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Publish the process-global CLI context. Called once from
/// `bun_runtime::cli::command::create_context_data` during single-threaded
/// startup.
///
/// # Safety
/// `ctx` must outlive the process (it points into a `static`).
#[inline]
pub unsafe fn set_global(ctx: *mut ContextData) {
    GLOBAL_CLI_CTX.store(ctx, core::sync::atomic::Ordering::Release);
}

/// Raw pointer to the process-global CLI context (null before
/// `set_global`). Higher-tier crates that need a `&mut` view should go
/// through this single source of truth rather than keeping a parallel static.
#[inline]
pub fn global_ptr() -> *mut ContextData {
    GLOBAL_CLI_CTX.load(core::sync::atomic::Ordering::Acquire)
}

/// Read-only handle to the process-global CLI context, or `None` if the CLI
/// has not been initialized (embedder/tests). Prefer this over
/// `bun_runtime::cli::Command::get` from crates below `bun_runtime`.
#[inline]
pub fn try_get<'a>() -> Option<&'a ContextData> {
    let p = GLOBAL_CLI_CTX.load(core::sync::atomic::Ordering::Acquire);
    // SAFETY: pointer was published from a process-lifetime `static` in
    // single-threaded startup; treated as read-only here.
    unsafe { p.as_ref() }
}

pub struct DebugOptions {
    pub dump_environment_variables: bool,
    pub dump_limits: bool,
    pub fallback_only: bool,
    pub silent: bool,
    pub hot_reload: HotReload,
    pub global_cache: GlobalCache,
    pub offline_mode_setting: Option<OfflineMode>,
    pub run_in_bun: bool,
    pub loaded_bunfig: bool,
    /// Disables using bun.shell.Interpreter for `bun run`, instead spawning cmd.exe
    pub use_system_shell: bool,

    // technical debt
    pub macros: MacroOptions,
    pub editor: Box<[u8]>,
    pub package_bundle_map: ArrayHashMap<Box<[u8]>, bundle_enums::BundlePackage>,

    pub test_directory: Box<[u8]>,
    pub output_file: Box<[u8]>,
}

impl Default for DebugOptions {
    // See `ContextData::default` — folded into the single startup call site.
    #[inline(always)]
    fn default() -> Self {
        Self {
            dump_environment_variables: false,
            dump_limits: false,
            fallback_only: false,
            silent: false,
            hot_reload: HotReload::None,
            global_cache: GlobalCache::auto,
            offline_mode_setting: None,
            run_in_bun: false,
            loaded_bunfig: false,
            use_system_shell: !cfg!(windows),
            macros: MacroOptions::Unspecified,
            editor: Box::default(),
            package_bundle_map: ArrayHashMap::default(),
            test_directory: Box::default(),
            output_file: Box::default(),
        }
    }
}

pub enum MacroOptions {
    Unspecified,
    Disable,
    Map(MacroMap),
}

/// Re-declared from `resolver/package_json.zig` (plain hashmap aliases) so this
/// file does not depend on `resolver/`.
pub type MacroImportReplacementMap = ArrayHashMap<Box<[u8]>, Box<[u8]>>;
pub type MacroMap = ArrayHashMap<Box<[u8]>, MacroImportReplacementMap>;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum HotReload {
    None,
    Hot,
    Watch,
}

pub struct TestOptions {
    pub default_timeout_ms: u32,
    pub update_snapshots: bool,
    pub repeat_count: u32,
    pub retry: u32,
    pub run_todo: bool,
    pub only: bool,
    pub pass_with_no_tests: bool,
    pub concurrent: bool,
    pub randomize: bool,
    pub seed: Option<u32>,
    pub concurrent_test_glob: Option<Vec<Box<[u8]>>>,
    pub bail: u32,
    pub coverage: CodeCoverageOptions,
    pub path_ignore_patterns: Vec<Box<[u8]>>,
    pub path_ignore_patterns_from_cli: bool,
    pub test_filter_pattern: Option<Box<[u8]>>,
    /// `?*bun.jsc.RegularExpression` — typed as opaque to keep this file free
    /// of `jsc/` references. Read via `test_filter_regex()`.
    // FORWARD_DECL(b0): erased bun_jsc::RegularExpression to break the T3→T6
    // back-edge. High tier owns construction/destruction; this field only
    // stores the pointer. LIFETIMES.tsv says OWNED, so the high-tier setter is
    // responsible for freeing any previous value.
    pub test_filter_regex: Option<core::ptr::NonNull<()>>, // SAFETY: erased *mut bun_jsc::RegularExpression
    pub max_concurrency: u32,
    /// `bun test --isolate`: run each test file in a fresh global object on
    /// the same VM, force-closing leaked handles between files.
    pub isolate: bool,
    /// `bun test --parallel[=N]`: run test files across N worker
    /// processes. 0 means not requested. Implies `isolate` in workers.
    pub parallel: u32,
    /// `bun test --parallel-delay=MS`: how long the first worker must be
    /// busy before spawning the rest. None = use the built-in default.
    pub parallel_delay_ms: Option<u32>,
    /// Internal: this process is a `--parallel` worker. Files arrive over
    /// fd 3, results are written back over fd 3; no discovery, no header.
    pub test_worker: bool,
    /// `bun test --changed[=<since>]`. When set, only test files whose
    /// module graph reaches a file changed according to git are run.
    /// None = flag not passed. "" = compare against uncommitted changes.
    /// Otherwise the value is a git ref (commit, branch, tag) to diff
    /// against.
    pub changed: Option<Box<[u8]>>,
    /// `bun test --shard=M/N`. When set, test files are sorted by path
    /// and only every Nth file (starting from M-1) is run. index is
    /// 1-based; both are validated at parse time so `1 <= index <= count`.
    pub shard: Option<Shard>,

    pub reporters: Reporters,
    pub reporter_outfile: Option<Box<[u8]>>,
}

#[derive(Copy, Clone)]
pub struct Shard {
    pub index: u32,
    pub count: u32,
}

#[derive(Default, Copy, Clone)]
pub struct Reporters {
    pub dots: bool,
    pub only_failures: bool,
    pub junit: bool,
}

impl TestOptions {
    /// Returns the erased `*mut bun_jsc::RegularExpression`. Caller (high tier)
    /// casts back: `unsafe { &*ptr.cast::<bun_jsc::RegularExpression>() }`.
    #[inline]
    pub fn test_filter_regex(&self) -> Option<core::ptr::NonNull<()>> {
        // SAFETY: erased bun_jsc::RegularExpression — see field decl.
        self.test_filter_regex
    }
}

impl Default for TestOptions {
    // See `ContextData::default` — folded into the single startup call site.
    #[inline(always)]
    fn default() -> Self {
        Self {
            // 5 * std.time.ms_per_s
            default_timeout_ms: 5 * 1000,
            update_snapshots: false,
            repeat_count: 0,
            retry: 0,
            run_todo: false,
            only: false,
            pass_with_no_tests: false,
            concurrent: false,
            randomize: false,
            seed: None,
            concurrent_test_glob: None,
            bail: 0,
            coverage: CodeCoverageOptions::default(),
            path_ignore_patterns: Vec::new(),
            path_ignore_patterns_from_cli: false,
            test_filter_pattern: None,
            test_filter_regex: None,
            // Under ASAN every spawned `bun` child is several-× heavier in
            // RSS and ~2× slower to start, so `describe.concurrent` test
            // files that spawn one child per test (e.g. process-stdio,
            // multi-run) hit 20 live children at once and OOM the CI box.
            // Cap the default to 5 there; the `--max-concurrency` flag still
            // overrides explicitly.
            max_concurrency: if bun_core::env::ENABLE_ASAN { 5 } else { 20 },
            isolate: false,
            parallel: 0,
            parallel_delay_ms: None,
            test_worker: false,
            changed: None,
            shard: None,
            reporters: Reporters::default(),
            reporter_outfile: None,
        }
    }
}

pub enum Debugger {
    Unspecified,
    Enable(DebuggerEnable),
}

impl Default for Debugger {
    #[inline(always)]
    fn default() -> Self {
        Debugger::Unspecified
    }
}

#[derive(Default)]
pub struct DebuggerEnable {
    pub path_or_port: Box<[u8]>,
    pub wait_for_connection: bool,
    pub set_breakpoint_on_first_line: bool,
}

pub struct RuntimeOptions {
    pub smol: bool,
    pub debugger: Debugger,
    pub if_present: bool,
    pub redis_preconnect: bool,
    pub sql_preconnect: bool,
    pub eval: Eval,
    pub preconnect: Vec<Box<[u8]>>,
    pub experimental_http2_fetch: bool,
    pub experimental_http3_fetch: bool,
    pub dns_result_order: Box<[u8]>,
    /// `--expose-gc` makes `globalThis.gc()` available. Added for Node
    /// compatibility.
    pub expose_gc: bool,
    pub preserve_symlinks_main: bool,
    pub console_depth: Option<u16>,
    pub cron_title: Box<[u8]>,
    pub cron_period: Box<[u8]>,
    pub cpu_prof: CpuProf,
    pub heap_prof: HeapProf,
}

#[derive(Default)]
pub struct Eval {
    pub script: Box<[u8]>,
    pub eval_and_print: bool,
}

pub struct CpuProf {
    pub enabled: bool,
    pub name: Box<[u8]>,
    pub dir: Box<[u8]>,
    pub interval: u32,
    pub md_format: bool,
    pub json_format: bool,
}

impl Default for CpuProf {
    // See `ContextData::default` — folded into the single startup call site.
    #[inline(always)]
    fn default() -> Self {
        Self {
            enabled: false,
            name: Box::default(),
            dir: Box::default(),
            interval: 1000,
            md_format: false,
            json_format: false,
        }
    }
}

#[derive(Default)]
pub struct HeapProf {
    pub enabled: bool,
    pub text_format: bool,
    pub name: Box<[u8]>,
    pub dir: Box<[u8]>,
}

impl Default for RuntimeOptions {
    // See `ContextData::default` — folded into the single startup call site.
    #[inline(always)]
    fn default() -> Self {
        Self {
            smol: false,
            debugger: Debugger::Unspecified,
            if_present: false,
            redis_preconnect: false,
            sql_preconnect: false,
            eval: Eval::default(),
            preconnect: Vec::new(),
            experimental_http2_fetch: false,
            experimental_http3_fetch: false,
            dns_result_order: Box::from(&b"verbatim"[..]),
            expose_gc: false,
            preserve_symlinks_main: false,
            console_depth: None,
            cron_title: Box::default(),
            cron_period: Box::default(),
            cpu_prof: CpuProf::default(),
            heap_prof: HeapProf::default(),
        }
    }
}

// ported from: src/options_types/Context.zig

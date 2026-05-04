//! `Command.ContextData` and its option-carrying nested structs, lifted out of
//! `cli/cli.zig` so subsystems (install, bundler, bake, shell) can reference
//! the parsed-options shape without importing the CLI itself.
//!
//! `create()` (which calls `Arguments.parse`) and the `global_cli_ctx`/
//! `context_data` storage stay in `cli.rs`; they are forward-aliased onto
//! `ContextData` below so call sites that write `Command::ContextData::create()`
//! keep working.

use bun_collections::ArrayHashMap;
use bun_logger as logger;
use bun_schema::api;

use crate::bundle_enums;
use crate::code_coverage_options::CodeCoverageOptions;
use crate::compile_target::CompileTarget;
use crate::global_cache::GlobalCache;
use crate::offline_mode::OfflineMode;

// TODO(port): every `[]const u8` / `[]const []const u8` struct field below is a
// proc-lifetime CLI string (no `deinit`, populated once from argv/bunfig and
// never freed). Ported as `Box<[u8]>` / `Vec<Box<[u8]>>` for now; Phase B may
// retype to `&'static [u8]` once the CLI parser leaks into a bump arena.

pub struct ContextData<'a> {
    pub start_time: i128,
    pub args: api::TransformOptions,
    pub log: &'a mut logger::Log,
    // PORT NOTE: `allocator: std.mem.Allocator` deleted (global mimalloc).
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

impl<'a> ContextData<'a> {
    /// `Arguments.parse` lives in `cli/`; forward-aliased so
    /// `Command::ContextData::create(...)` keeps working.
    // TODO(port): Zig was `pub const create = bun.cli.Command.createContextData;`
    // — Rust cannot re-export an associated fn; Phase B should add a thin
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
            env_behavior: api::DotEnvBehavior::Disable,
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

pub type Context<'a> = &'a mut ContextData<'a>;
// TODO(port): Zig `*ContextData` is passed everywhere as a long-lived handle;
// the double-`'a` above may need splitting (`&'ctx mut ContextData<'log>`) in
// Phase B once call sites are ported.

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
    fn default() -> Self {
        Self {
            dump_environment_variables: false,
            dump_limits: false,
            fallback_only: false,
            silent: false,
            hot_reload: HotReload::None,
            global_cache: GlobalCache::Auto,
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
    // PORT NOTE: LIFETIMES.tsv classifies this as OWNED → Option<Box<RegularExpression>>.
    // That re-introduces a `bun_jsc` dep the Zig deliberately avoided; Phase B
    // may want to restore an opaque newtype here if the layering matters.
    pub test_filter_regex: Option<Box<bun_jsc::RegularExpression>>,
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
    #[inline]
    pub fn test_filter_regex(&self) -> Option<&bun_jsc::RegularExpression> {
        // PORT NOTE: Zig cast `?*anyopaque` → `?*RegularExpression`; field is
        // now typed directly so this is just a deref.
        self.test_filter_regex.as_deref()
    }
}

impl Default for TestOptions {
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
            max_concurrency: 20,
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/Context.zig (237 lines)
//   confidence: medium
//   todos:      5
//   notes:      []const u8 fields ported as Box<[u8]> (proc-lifetime, no deinit); `create` alias and `Context` type alias need Phase-B layering review; test_filter_regex now pulls in bun_jsc per LIFETIMES.tsv.
// ──────────────────────────────────────────────────────────────────────────

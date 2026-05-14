//! Port of `src/runtime/cli/Arguments.zig`.
//!
//! `parse()` runs `clap::parse()` against the per-tag table, handles
//! `--help`/`-v`/`--revision`, and populates the full `api::TransformOptions`
//! / `Context` from every recognised flag. All param tables — leaf and
//! concatenated — are const `&'static [ParamType]` via the
//! `bun_clap::parse_param!` proc-macro (compile-time spec parsing) plus a
//! const-fn slice concat (`bun_clap::concat_params!`), matching Zig's comptime
//! `clap.parseParam(...) ++ ...`.

use bun_options_types::{LoaderExt as _, TargetExt as _};

use bstr::BStr;
use bun_bundler::options;
use bun_clap as clap;
use bun_clap::parse_param;
use bun_core::ZStr;
use bun_core::env::OperatingSystem;
use bun_core::strings;
use bun_core::{self, FeatureFlags, Global, Output, env_var};
use bun_jsc::RegularExpression;
use bun_jsc::regular_expression::Flags as RegexFlags;
use bun_options_types::code_coverage_options::Reporters as CoverageReporters;
use bun_options_types::context::{Debugger, DebuggerEnable, HotReload, MacroOptions, Shard};
use bun_options_types::schema::api;
use bun_paths::resolve_path;
use bun_paths::{PathBuffer, platform};
use bun_standalone_graph::StandaloneModuleGraph::StandaloneModuleGraph;

use crate::cli;
use crate::cli::Bunfig;
use crate::cli::colon_list_type::ColonListType;
use crate::cli::command::{self, Context, Tag as CommandTag};
use crate::cli::concat_params;
use crate::cli::{DefineColonList, LoaderColonList};

/// Clone borrowed argv slices into the owning `Vec<Box<[u8]>>` shape used by
/// `api::TransformOptions` / `Context` fields.
#[inline]
fn slice_to_owned(input: &[&[u8]]) -> Vec<Box<[u8]>> {
    input.iter().map(|s| Box::<[u8]>::from(*s)).collect()
}

pub fn loader_resolver(input: &[u8]) -> Result<api::Loader, bun_core::Error> {
    let option_loader =
        bun_ast::Loader::from_string(input).ok_or(bun_core::err!("InvalidLoader"))?;
    Ok(option_loader.to_api())
}

pub fn noop_resolver(input: &[u8]) -> Result<&[u8], bun_core::Error> {
    Ok(input)
}

pub fn file_read_error(
    err: bun_core::Error,
    stderr: &mut impl std::io::Write,
    filename: &[u8],
    kind: &[u8],
) -> ! {
    let _ = write!(
        stderr,
        "Error reading file \"{}\" for {}: {}",
        BStr::new(filename),
        BStr::new(kind),
        BStr::new(err.name()),
    );
    Global::exit(1);
}

/// Resolve `filename` against `cwd`, open it, read its full contents, close it,
/// and return the buffer.
///
/// PORT NOTE: the Zig original (`std.fs.path.resolve` + `std.posix.toPosixPath`
/// + `bun.openFileZ` + `readToEndAlloc`) is itself non-idiomatic for the Bun
/// codebase. Reimplemented on top of `bun_paths::resolve_path` +
/// `bun_sys::File::read_from`, which is the cross-platform path the rest of the
/// runtime uses.
pub fn read_file(cwd: &[u8], filename: &[u8]) -> Result<Vec<u8>, bun_core::Error> {
    let mut buf = PathBuffer::uninit();
    let outpath = resolve_path::join_abs_string_buf::<platform::Auto>(cwd, &mut *buf, &[filename]);
    let len = outpath.len();
    buf[len] = 0;
    // SAFETY: `buf[len] == 0` written above; `buf` outlives the call.
    let path_z = ZStr::from_buf(&buf[..], len);
    match bun_sys::File::read_from(bun_sys::Fd::cwd(), path_z) {
        bun_sys::Result::Ok(bytes) => Ok(bytes),
        bun_sys::Result::Err(err) => Err(err.into()),
    }
}

pub fn resolve_jsx_runtime(s: &[u8]) -> Result<api::JsxRuntime, bun_core::Error> {
    if s == b"automatic" {
        Ok(api::JsxRuntime::Automatic)
    } else if s == b"fallback" || s == b"classic" {
        Ok(api::JsxRuntime::Classic)
    } else if s == b"solid" {
        Ok(api::JsxRuntime::Solid)
    } else {
        Err(bun_core::err!("InvalidJSXRuntime"))
    }
}

pub type ParamType = clap::Param<clap::Help>;

// ─── param tables ────────────────────────────────────────────────────────────
// Zig built these at comptime via `clap.parseParam("...") catch unreachable`
// concatenated with `++`. `bun_clap::parse_param!` expands to a const
// `Param<Help>` literal, and `concat_params!` is a const-fn slice concat, so
// every table — leaf and combined — lands in rodata with zero runtime init.
//
// All tables are `const` (const-eval cannot read `static`s) so they can feed
// both `concat_params!` and `comptime_table!`. The single rodata copy of each
// is the `static __CONV` / `static __TABLE` inside `comptime_table!` below.

// Zig: `if (Environment.show_crash_trace) debug_params else [_]ParamType{}`.
// `SHOW_CRASH_TRACE` is a `const bool`, so the dead branch is eliminated.
macro_rules! maybe_debug_params {
    () => {
        if bun_core::env::SHOW_CRASH_TRACE {
            DEBUG_PARAMS
        } else {
            &[] as &[ParamType]
        }
    };
}

// PORT NOTE: `builtin.have_error_return_tracing` is a Zig-only concept. Rust
// has no error-return tracing, but `bun_crash_handler::VERBOSE_ERROR_TRACE`
// still gates extra crash diagnostics. Expose the flag in crash-trace builds
// (debug/test/asan), which is the closest analogue.
const VERBOSE_ERROR_TRACE_PARAMS: &[ParamType] = &[parse_param!(
    "--verbose-error-trace             Dump error return traces"
)];
macro_rules! maybe_verbose_error_trace {
    () => {
        if bun_core::env::SHOW_CRASH_TRACE {
            VERBOSE_ERROR_TRACE_PARAMS
        } else {
            &[] as &[ParamType]
        }
    };
}

pub const BASE_PARAMS_: &[ParamType] = concat_params!(
    maybe_debug_params!(),
    &[
        parse_param!(
            "--env-file <STR>...               Load environment variables from the specified file(s)"
        ),
        parse_param!("--no-env-file                     Disable automatic loading of .env files"),
        parse_param!(
            "--cwd <STR>                       Absolute path to resolve files & entry points from. This just changes the process' cwd."
        ),
        parse_param!(
            "-c, --config <PATH>?              Specify path to Bun config file. Default <d>$cwd<r>/bunfig.toml"
        ),
        parse_param!("-h, --help                        Display this menu and exit"),
    ],
    maybe_verbose_error_trace!(),
    &[parse_param!("<POS>...")],
);

const DEBUG_PARAMS: &[ParamType] = &[
    parse_param!(
        "--breakpoint-resolve <STR>...     DEBUG MODE: breakpoint when resolving something that includes this string"
    ),
    parse_param!(
        "--breakpoint-print <STR>...       DEBUG MODE: breakpoint when printing something that includes this string"
    ),
];

pub const TRANSPILER_PARAMS_: &[ParamType] = &[
    parse_param!(
        "--main-fields <STR>...             Main fields to lookup in package.json. Defaults to --target dependent"
    ),
    parse_param!("--preserve-symlinks               Preserve symlinks when resolving files"),
    parse_param!(
        "--preserve-symlinks-main          Preserve symlinks when resolving the main entry point"
    ),
    parse_param!("--extension-order <STR>...        Defaults to: .tsx,.ts,.jsx,.js,.json "),
    parse_param!(
        "--tsconfig-override <STR>          Specify custom tsconfig.json. Default <d>$cwd<r>/tsconfig.json"
    ),
    parse_param!(
        "-d, --define <STR>...              Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\". Values are parsed as JSON."
    ),
    parse_param!(
        "--drop <STR>...                   Remove function calls, e.g. --drop=console removes all console.* calls."
    ),
    parse_param!(
        "--feature <STR>...               Enable a feature flag for dead-code elimination, e.g. --feature=SUPER_SECRET"
    ),
    parse_param!(
        "-l, --loader <STR>...             Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi"
    ),
    parse_param!(
        "--no-macros                       Disable macros from being executed in the bundler, transpiler and runtime"
    ),
    parse_param!(
        "--jsx-factory <STR>               Changes the function called when compiling JSX elements using the classic JSX runtime"
    ),
    parse_param!(
        "--jsx-fragment <STR>              Changes the function called when compiling JSX fragments"
    ),
    parse_param!(
        "--jsx-import-source <STR>         Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: \"react\""
    ),
    parse_param!("--jsx-runtime <STR>               \"automatic\" (default) or \"classic\""),
    parse_param!(
        "--jsx-side-effects                Treat JSX elements as having side effects (disable pure annotations)"
    ),
    parse_param!(
        "--ignore-dce-annotations          Ignore tree-shaking annotations such as @__PURE__"
    ),
];

pub const RUNTIME_PARAMS_: &[ParamType] = &[
    parse_param!(
        "--watch                           Automatically restart the process on file change"
    ),
    parse_param!(
        "--hot                             Enable auto reload in the Bun runtime, test runner, or bundler"
    ),
    parse_param!(
        "--no-clear-screen                 Disable clearing the terminal screen on reload when --hot or --watch is enabled"
    ),
    parse_param!(
        "--smol                            Use less memory, but run garbage collection more often"
    ),
    parse_param!(
        "-r, --preload <STR>...            Import a module before other modules are loaded"
    ),
    parse_param!("--require <STR>...                Alias of --preload, for Node.js compatibility"),
    parse_param!("--import <STR>...                 Alias of --preload, for Node.js compatibility"),
    parse_param!("--inspect <STR>?                  Activate Bun's debugger"),
    parse_param!(
        "--inspect-wait <STR>?             Activate Bun's debugger, wait for a connection before executing"
    ),
    parse_param!(
        "--inspect-brk <STR>?              Activate Bun's debugger, set breakpoint on first line of code and wait"
    ),
    parse_param!(
        "--cpu-prof                        Start CPU profiler and write profile to disk on exit"
    ),
    parse_param!("--cpu-prof-name <STR>             Specify the name of the CPU profile file"),
    parse_param!(
        "--cpu-prof-dir <STR>              Specify the directory where the CPU profile will be saved"
    ),
    parse_param!(
        "--cpu-prof-md                     Output CPU profile in markdown format (grep-friendly, designed for LLM analysis)"
    ),
    parse_param!(
        "--cpu-prof-interval <STR>         Specify the sampling interval in microseconds for CPU profiling (default: 1000)"
    ),
    parse_param!(
        "--heap-prof                       Generate V8 heap snapshot on exit (.heapsnapshot)"
    ),
    parse_param!("--heap-prof-name <STR>            Specify the name of the heap profile file"),
    parse_param!(
        "--heap-prof-dir <STR>             Specify the directory where the heap profile will be saved"
    ),
    parse_param!(
        "--heap-prof-md                    Generate markdown heap profile on exit (for CLI analysis)"
    ),
    parse_param!(
        "--if-present                      Exit without an error if the entrypoint does not exist"
    ),
    parse_param!("--no-install                      Disable auto install in the Bun runtime"),
    parse_param!(
        "--install <STR>                   Configure auto-install behavior. One of \"auto\" (default, auto-installs when no node_modules), \"fallback\" (missing packages only), \"force\" (always)."
    ),
    parse_param!(
        "-i                                Auto-install dependencies during execution. Equivalent to --install=fallback."
    ),
    parse_param!("-e, --eval <STR>                  Evaluate argument as a script"),
    parse_param!(
        "-p, --print <STR>                 Evaluate argument as a script and print the result"
    ),
    parse_param!(
        "--prefer-offline                  Skip staleness checks for packages in the Bun runtime and resolve from disk"
    ),
    parse_param!(
        "--prefer-latest                   Use the latest matching versions of packages in the Bun runtime, always checking npm"
    ),
    parse_param!("--port <STR>                      Set the default port for Bun.serve"),
    parse_param!("-u, --origin <STR>"),
    parse_param!("--conditions <STR>...             Pass custom conditions to resolve"),
    parse_param!("--fetch-preconnect <STR>...       Preconnect to a URL while code is loading"),
    parse_param!(
        "--experimental-http2-fetch        Offer h2 in fetch() TLS ALPN. Same as BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1"
    ),
    parse_param!(
        "--experimental-http3-fetch        Honor Alt-Svc: h3 in fetch() and upgrade to HTTP/3. Same as BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT=1"
    ),
    parse_param!(
        "--max-http-header-size <INT>      Set the maximum size of HTTP headers in bytes. Default is 16KiB"
    ),
    parse_param!(
        "--dns-result-order <STR>          Set the default order of DNS lookup results. Valid orders: verbatim (default), ipv4first, ipv6first"
    ),
    parse_param!(
        "--expose-gc                       Expose gc() on the global object. Has no effect on Bun.gc()."
    ),
    parse_param!(
        "--no-deprecation                  Suppress all reporting of the custom deprecation."
    ),
    parse_param!(
        "--throw-deprecation               Determine whether or not deprecation warnings result in errors."
    ),
    parse_param!("--title <STR>                     Set the process title"),
    parse_param!(
        "--zero-fill-buffers                Boolean to force Buffer.allocUnsafe(size) to be zero-filled."
    ),
    parse_param!(
        "--use-system-ca                   Use the system's trusted certificate authorities"
    ),
    parse_param!("--use-openssl-ca                  Use OpenSSL's default CA store"),
    parse_param!("--use-bundled-ca                  Use bundled CA store"),
    parse_param!("--redis-preconnect                Preconnect to $REDIS_URL at startup"),
    parse_param!("--sql-preconnect                  Preconnect to PostgreSQL at startup"),
    parse_param!(
        "--no-addons                       Throw an error if process.dlopen is called, and disable export condition \"node-addons\""
    ),
    parse_param!(
        "--unhandled-rejections <STR>      One of \"strict\", \"throw\", \"warn\", \"none\", or \"warn-with-error-code\""
    ),
    parse_param!(
        "--console-depth <NUMBER>          Set the default depth for console.log object inspection (default: 2)"
    ),
    parse_param!(
        "--user-agent <STR>               Set the default User-Agent header for HTTP requests"
    ),
    parse_param!("--cron-title <STR>               Title for cron execution mode"),
    parse_param!("--cron-period <STR>              Cron period for cron execution mode"),
];

pub const AUTO_OR_RUN_PARAMS: &[ParamType] = &[
    parse_param!(
        "-F, --filter <STR>...             Run a script in all workspace packages matching the pattern"
    ),
    parse_param!(
        "-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)"
    ),
    parse_param!(
        "--no-orphans                      Exit when the parent process dies, and on exit SIGKILL every descendant. Linux/macOS only."
    ),
    parse_param!(
        "--shell <STR>                     Control the shell used for package.json scripts. Supports either 'bun' or 'system'"
    ),
    parse_param!(
        "--workspaces                      Run a script in all workspace packages (from the \"workspaces\" field in package.json)"
    ),
    parse_param!(
        "--parallel                        Run multiple scripts concurrently with Foreman-style output"
    ),
    parse_param!(
        "--sequential                      Run multiple scripts sequentially with Foreman-style output"
    ),
    parse_param!(
        "--no-exit-on-error                Continue running other scripts when one fails (with --parallel/--sequential)"
    ),
];

pub const AUTO_ONLY_PARAMS: &[ParamType] = concat_params!(
    &[
        // parse_param!("--all"),
        parse_param!("--silent                          Don't print the script command"),
        parse_param!(
            "--elide-lines <NUMBER>            Number of lines of script output shown when using --filter (default: 10). Set to 0 to show all lines."
        ),
        parse_param!("-v, --version                     Print version and exit"),
        parse_param!("--revision                        Print version with revision and exit"),
    ],
    AUTO_OR_RUN_PARAMS,
);
pub const AUTO_PARAMS: &[ParamType] = concat_params!(
    AUTO_ONLY_PARAMS,
    RUNTIME_PARAMS_,
    TRANSPILER_PARAMS_,
    BASE_PARAMS_
);

pub const RUN_ONLY_PARAMS: &[ParamType] = concat_params!(
    &[
        parse_param!("--silent                          Don't print the script command"),
        parse_param!(
            "--elide-lines <NUMBER>            Number of lines of script output shown when using --filter (default: 10). Set to 0 to show all lines."
        ),
    ],
    AUTO_OR_RUN_PARAMS,
);
pub const RUN_PARAMS: &[ParamType] = concat_params!(
    RUN_ONLY_PARAMS,
    RUNTIME_PARAMS_,
    TRANSPILER_PARAMS_,
    BASE_PARAMS_
);

pub const BUNX_COMMANDS: &[ParamType] = concat_params!(
    &[parse_param!(
        "-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)"
    )],
    AUTO_ONLY_PARAMS,
);

// Zig: `if (FeatureFlags.bake_debugging_features) [_]ParamType{...} else [_]ParamType{}`.
const BAKE_DEBUG_PARAMS: &[ParamType] = &[
    parse_param!(
        "--debug-dump-server-files        When --app is set, dump all server files to disk even when building statically"
    ),
    parse_param!("--debug-no-minify                When --app is set, do not minify anything"),
];
macro_rules! maybe_bake_debug_params {
    () => {
        if FeatureFlags::BAKE_DEBUGGING_FEATURES {
            BAKE_DEBUG_PARAMS
        } else {
            &[] as &[ParamType]
        }
    };
}

pub const BUILD_ONLY_PARAMS: &[ParamType] = concat_params!(
    &[
        parse_param!(
            "--production                     Set NODE_ENV=production and enable minification"
        ),
        parse_param!(
            "--compile                        Generate a standalone Bun executable containing your bundled code. Implies --production"
        ),
        parse_param!(
            "--compile-exec-argv <STR>       Prepend arguments to the standalone executable's execArgv"
        ),
        parse_param!(
            "--compile-autoload-dotenv        Enable autoloading of .env files in standalone executable (default: true)"
        ),
        parse_param!(
            "--no-compile-autoload-dotenv     Disable autoloading of .env files in standalone executable"
        ),
        parse_param!(
            "--compile-autoload-bunfig        Enable autoloading of bunfig.toml in standalone executable (default: true)"
        ),
        parse_param!(
            "--no-compile-autoload-bunfig     Disable autoloading of bunfig.toml in standalone executable"
        ),
        parse_param!(
            "--compile-autoload-tsconfig      Enable autoloading of tsconfig.json at runtime in standalone executable (default: false)"
        ),
        parse_param!(
            "--no-compile-autoload-tsconfig   Disable autoloading of tsconfig.json at runtime in standalone executable"
        ),
        parse_param!(
            "--compile-autoload-package-json  Enable autoloading of package.json at runtime in standalone executable (default: false)"
        ),
        parse_param!(
            "--no-compile-autoload-package-json Disable autoloading of package.json at runtime in standalone executable"
        ),
        parse_param!(
            "--compile-executable-path <STR>  Path to a Bun executable to use for cross-compilation instead of downloading"
        ),
        parse_param!("--bytecode                       Use a bytecode cache"),
        parse_param!(
            "--watch                          Automatically restart the process on file change"
        ),
        parse_param!(
            "--no-clear-screen                Disable clearing the terminal screen on reload when --watch is enabled"
        ),
        parse_param!(
            "--target <STR>                   The intended execution environment for the bundle. \"browser\", \"bun\" or \"node\""
        ),
        parse_param!("--outdir <STR>                   Default to \"dist\" if multiple files"),
        parse_param!("--outfile <STR>                  Write to a file"),
        parse_param!(
            "--metafile <STR>?                Write a JSON file with metadata about the build"
        ),
        parse_param!(
            "--metafile-md <STR>?             Write a markdown file with a visualization of the module graph (LLM-friendly)"
        ),
        parse_param!(
            "--sourcemap <STR>?               Build with sourcemaps - 'linked', 'inline', 'external', or 'none'"
        ),
        parse_param!(
            "--banner <STR>                   Add a banner to the bundled output such as \"use client\"; for a bundle being used with RSCs"
        ),
        parse_param!(
            "--footer <STR>                   Add a footer to the bundled output such as // built with bun!"
        ),
        parse_param!(
            "--format <STR>                   Specifies the module format to build to. \"esm\", \"cjs\" and \"iife\" are supported. Defaults to \"esm\", or \"cjs\" with --bytecode."
        ),
        parse_param!(
            "--root <STR>                     Root directory used for multiple entry points"
        ),
        parse_param!("--splitting                      Enable code splitting"),
        parse_param!(
            "--public-path <STR>              A prefix to be appended to any import paths in bundled code"
        ),
        parse_param!(
            "-e, --external <STR>...          Exclude module from transpilation (can use * wildcards). ex: -e react"
        ),
        parse_param!(
            "--allow-unresolved <STR>...      Allow unresolved dynamic import()/require() specifiers matching these glob patterns. Use '<empty>' for opaque specifiers. Default is '*' (allow all)."
        ),
        parse_param!(
            "--reject-unresolved              Fail the build on any dynamic import()/require() specifier that cannot be resolved at build time."
        ),
        parse_param!(
            "--packages <STR>                 Add dependencies to bundle or keep them external. \"external\", \"bundle\" is supported. Defaults to \"bundle\"."
        ),
        parse_param!(
            "--entry-naming <STR>             Customize entry point filenames. Defaults to \"[dir]/[name].[ext]\""
        ),
        parse_param!(
            "--chunk-naming <STR>             Customize chunk filenames. Defaults to \"[name]-[hash].[ext]\""
        ),
        parse_param!(
            "--asset-naming <STR>             Customize asset filenames. Defaults to \"[name]-[hash].[ext]\""
        ),
        parse_param!(
            "--react-fast-refresh             Enable React Fast Refresh transform (does not emit hot-module code, use this for testing)"
        ),
        parse_param!("--no-bundle                      Transpile file only, do not bundle"),
        parse_param!(
            "--emit-dce-annotations           Re-emit DCE annotations in bundles. Enabled by default unless --minify-whitespace is passed."
        ),
        parse_param!("--minify                         Enable all minification flags"),
        parse_param!("--minify-syntax                  Minify syntax and inline data"),
        parse_param!("--minify-whitespace              Minify whitespace"),
        parse_param!("--minify-identifiers             Minify identifiers"),
        parse_param!(
            "--keep-names                     Preserve original function and class names when minifying"
        ),
        parse_param!(
            "--css-chunking                   Chunk CSS files together to reduce duplicated CSS loaded in a browser. Only has an effect when multiple entrypoints import CSS"
        ),
        parse_param!("--dump-environment-variables"),
        parse_param!("--conditions <STR>...            Pass custom conditions to resolve"),
        parse_param!(
            "--app                            (EXPERIMENTAL) Build a web app for production using Bun Bake."
        ),
        parse_param!("--server-components              (EXPERIMENTAL) Enable server components"),
        parse_param!(
            "--env <inline|prefix*|disable>   Inline environment variables into the bundle as process.env.${name}. Defaults to 'disable'. To inline environment variables matching a prefix, use my prefix like 'FOO_PUBLIC_*'."
        ),
        parse_param!(
            "--windows-hide-console           When using --compile targeting Windows, prevent a Command prompt from opening alongside the executable"
        ),
        parse_param!(
            "--windows-icon <STR>             When using --compile targeting Windows, assign an executable icon"
        ),
        parse_param!(
            "--windows-title <STR>            When using --compile targeting Windows, set the executable product name"
        ),
        parse_param!(
            "--windows-publisher <STR>        When using --compile targeting Windows, set the executable company name"
        ),
        parse_param!(
            "--windows-version <STR>          When using --compile targeting Windows, set the executable version (e.g. 1.2.3.4)"
        ),
        parse_param!(
            "--windows-description <STR>      When using --compile targeting Windows, set the executable description"
        ),
        parse_param!(
            "--windows-copyright <STR>        When using --compile targeting Windows, set the executable copyright"
        ),
    ],
    maybe_bake_debug_params!(),
);
pub const BUILD_PARAMS: &[ParamType] =
    concat_params!(BUILD_ONLY_PARAMS, TRANSPILER_PARAMS_, BASE_PARAMS_);

// TODO: update test completions
pub const TEST_ONLY_PARAMS: &[ParamType] = &[
    parse_param!(
        "--no-orphans                     Exit when the parent process dies, and on exit SIGKILL every descendant. Linux/macOS only."
    ),
    parse_param!(
        "--timeout <NUMBER>               Set the per-test timeout in milliseconds, default is 5000."
    ),
    parse_param!("-u, --update-snapshots           Update snapshot files"),
    parse_param!(
        "--rerun-each <NUMBER>            Re-run each test file <NUMBER> times, helps catch certain bugs"
    ),
    parse_param!(
        "--retry <NUMBER>                 Default retry count for all tests, overridden by per-test { retry: N }"
    ),
    parse_param!(
        "--todo                           Include tests that are marked with \"test.todo()\""
    ),
    parse_param!(
        "--only                           Run only tests that are marked with \"test.only()\" or \"describe.only()\""
    ),
    parse_param!("--pass-with-no-tests             Exit with code 0 when no tests are found"),
    parse_param!("--concurrent                     Treat all tests as `test.concurrent()` tests"),
    parse_param!("--randomize                      Run tests in random order"),
    parse_param!("--seed <INT>                     Set the random seed for test randomization"),
    parse_param!("--coverage                       Generate a coverage profile"),
    parse_param!(
        "--coverage-reporter <STR>...     Report coverage in 'text' and/or 'lcov'. Defaults to 'text'."
    ),
    parse_param!(
        "--coverage-dir <STR>             Directory for coverage files. Defaults to 'coverage'."
    ),
    parse_param!(
        "--bail <NUMBER>?                 Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1."
    ),
    parse_param!(
        "-t, --test-name-pattern/--grep <STR>    Run only tests with a name that matches the given regex."
    ),
    parse_param!(
        "--reporter <STR>                 Test output reporter format. Available: 'junit' (requires --reporter-outfile), 'dots'. Default: console output."
    ),
    parse_param!(
        "--reporter-outfile <STR>         Output file path for the reporter format (required with --reporter)."
    ),
    parse_param!(
        "--dots                           Enable dots reporter. Shorthand for --reporter=dots."
    ),
    parse_param!(
        "--only-failures                  Only display test failures, hiding passing tests."
    ),
    parse_param!(
        "--max-concurrency <NUMBER>        Maximum number of concurrent tests to execute at once. Default is 20."
    ),
    parse_param!("--path-ignore-patterns <STR>...   Glob patterns for test file paths to ignore."),
    parse_param!(
        "--changed <STR>?                 Only run test files affected by changed files according to git. Optionally pass a commit or branch to compare against."
    ),
    parse_param!(
        "--isolate                        Run each test file in a fresh global object. Leaked handles from one file cannot affect another."
    ),
    parse_param!(
        "--parallel <NUMBER>?             Run test files in parallel using N worker processes. Implies --isolate. Defaults to CPU core count."
    ),
    parse_param!(
        "--parallel-delay <NUMBER>        Milliseconds the first --parallel worker must be busy before spawning the rest. 0 spawns all immediately. Default 5."
    ),
    parse_param!(
        "--test-worker                    (internal) Run as a --parallel worker, receiving files over IPC."
    ),
    parse_param!(
        "--shard <STR>                    Run a subset of test files, e.g. '--shard=1/3' runs the first of three shards. Useful for splitting tests across multiple CI jobs."
    ),
];
pub const TEST_PARAMS: &[ParamType] = concat_params!(
    TEST_ONLY_PARAMS,
    RUNTIME_PARAMS_,
    TRANSPILER_PARAMS_,
    BASE_PARAMS_
);

/// Fallback table for `Command::tag_params` (Zig: `base_params_ ++
/// runtime_params_ ++ transpiler_params_`).
pub const BASE_RUNTIME_TRANSPILER_PARAMS: &[ParamType] =
    concat_params!(BASE_PARAMS_, RUNTIME_PARAMS_, TRANSPILER_PARAMS_);

// ─── pre-converted tables (rodata) ───────────────────────────────────────────
// Zig built these at comptime as part of the `ComptimeClap(Id, params)` type.
// `comptime_table!` converts `*_PARAMS` → `[Param<usize>; N]` + category counts
// + short-index entirely at const-eval, so `parse_with_table` does zero runtime
// conversion / allocation / sorting / locking. perf: `ConvertedTable::build` +
// quicksort + RawVec::grow was 8.7 % of `bun --version` userland samples.
//
// `.rodata.startup`: `comptime_table!` clusters the default-command table's
// nested `__CONV` / `__LONG` / `__TABLE` payloads there (see `src/clap/lib.rs`),
// otherwise each gets its own `.rodata.<sym>` input section that fat-LTO
// scatters across distinct pages in crate order. Pinning AUTO next to its
// `__TABLE` payload packs the trivial-script / `bun --version` arg-parse
// working set onto a couple of shared fault-around pages. Non-PIE `bun` has
// zero runtime relocations, so a `&'static` pointer literal stays in plain
// rodata even in `.rodata.startup`. Linux-only: ELF section syntax.
//
// Only `AUTO_TABLE` lives in `.rodata.startup`. `.rodata.startup` is
// deliberately one contiguous block faulted in with a single read-around on
// every cold start (including `bun --version` / `bun .` / `bun <file>`) —
// padding it with tables those paths never touch just grows that run. So
// `RUN_TABLE` (`bun run` / `bun x`), the subcommand tables (`build` / `test`)
// and the `BASE_RUNTIME_TRANSPILER` catch-all (`install` / `pm` / …) are all
// built with `comptime_table!(.., cold)` and stay in plain `.rodata`, where
// `src/startup.order` can still cluster the ones a sampled cold path actually
// hits without weighing down the `.rodata.startup` fault-around window.
#[cfg_attr(target_os = "linux", unsafe(link_section = ".rodata.startup"))]
pub static AUTO_TABLE: &clap::ConvertedTable = clap::comptime_table!(AUTO_PARAMS);
pub static RUN_TABLE: &clap::ConvertedTable = clap::comptime_table!(RUN_PARAMS, cold);
pub static BUILD_TABLE: &clap::ConvertedTable = clap::comptime_table!(BUILD_PARAMS, cold);
pub static TEST_TABLE: &clap::ConvertedTable = clap::comptime_table!(TEST_PARAMS, cold);
pub static BASE_RUNTIME_TRANSPILER_TABLE: &clap::ConvertedTable =
    clap::comptime_table!(BASE_RUNTIME_TRANSPILER_PARAMS, cold);

/// Per-tag pre-converted clap table (rodata, built at compile time via
/// `comptime_table!`). This is what `parse` consumes so the startup path never
/// hits `ConvertedTable::build`'s alloc/sort/lock.
#[inline]
pub fn tag_table(cmd: CommandTag) -> &'static clap::ConvertedTable {
    match cmd {
        CommandTag::AutoCommand => AUTO_TABLE,
        CommandTag::RunCommand | CommandTag::RunAsNodeCommand => RUN_TABLE,
        CommandTag::BuildCommand => BUILD_TABLE,
        CommandTag::TestCommand => TEST_TABLE,
        CommandTag::BunxCommand => RUN_TABLE,
        _ => BASE_RUNTIME_TRANSPILER_TABLE,
    }
}

// ─── exported FFI globals (written by parse(), read from C++) ────────────────
// `AtomicBool` has the same size/alignment/bit-validity as `bool`, so the
// `#[no_mangle]` symbol layout is unchanged for the C++ side that reads these
// as plain `bool`. Rust writes go through `.store(.., Relaxed)`.
#[unsafe(no_mangle)]
pub static Bun__Node__ZeroFillBuffers: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
#[unsafe(no_mangle)]
pub static Bun__Node__ProcessNoDeprecation: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
#[unsafe(no_mangle)]
pub static Bun__Node__ProcessThrowDeprecation: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BunCAStore {
    Bundled,
    Openssl,
    System,
}
#[unsafe(no_mangle)]
pub static Bun__Node__CAStore: core::sync::atomic::AtomicU8 =
    core::sync::atomic::AtomicU8::new(BunCAStore::Bundled as u8);
#[unsafe(no_mangle)]
pub static Bun__Node__UseSystemCA: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

// ─── bunfig loading ──────────────────────────────────────────────────────────
// their private helpers moved to `bun_bunfig::arguments` so `bun_install` can
// call them without a tier-6 dependency. Re-export here so existing
// `crate::cli::arguments::load_config*` callers are unaffected.
pub use bun_bunfig::arguments::{load_config, load_config_path, load_config_with_cmd_args};

/// Parse `argv` into `api::TransformOptions` for the given subcommand.
///
/// PORT NOTE: `comptime cmd: Command.Tag` demoted to runtime arg (no
/// `ConstParamTy` on `Tag`). The Zig original monomorphised over `cmd` so each
/// subcommand got a dedicated param-table reference and dead-code-eliminated the
/// other arms; here `command::tag_params(cmd)` does the runtime lookup, and the
/// per-`cmd` blocks below are guarded by `if matches!(cmd, …)` instead of
/// `if comptime cmd == …`.
// PERF(port): was comptime monomorphization — profile in Phase B.
pub fn parse(cmd: CommandTag, ctx: Context<'_>) -> Result<api::TransformOptions, bun_core::Error> {
    let mut diag = clap::Diagnostic::default();
    let table = tag_table(cmd);

    let args = match clap::parse_with_table::<clap::Help>(
        table,
        clap::ParseOptions {
            diagnostic: Some(&mut diag),
            stop_after_positional_at: match cmd {
                CommandTag::RunCommand => 2,
                CommandTag::AutoCommand | CommandTag::RunAsNodeCommand => 1,
                _ => 0,
            },
        },
    ) {
        Ok(a) => a,
        Err(err) => {
            // Report useful error and exit
            let _ = diag.report(Output::error_writer(), err);
            command::tag_print_help(cmd, false);
            Global::exit(1);
        }
    };

    if args.flag(b"--help") {
        command::tag_print_help(cmd, true);
        Output::flush();
        Global::exit(0);
    }

    if cmd == CommandTag::AutoCommand {
        if args.flag(b"--version") {
            cli::print_version_and_exit();
        }
        if args.flag(b"--revision") {
            cli::print_revision_and_exit();
        }
    }

    // PORT NOTE: Zig gated on `builtin.have_error_return_tracing`; see
    // `maybe_verbose_error_trace!` above for the Rust mapping.
    if bun_core::env::SHOW_CRASH_TRACE && args.flag(b"--verbose-error-trace") {
        bun_crash_handler::VERBOSE_ERROR_TRACE.store(true, core::sync::atomic::Ordering::Relaxed);
    }

    // ── --cwd ────────────────────────────────────────────────────────────────
    // PORT NOTE: Zig stored a `[:0]u8` (NUL-terminated, owned). The Rust
    // `api::TransformOptions.absolute_working_dir` is `Option<Box<[u8]>>`
    // (sentinel dropped per schema.rs), so we dupe into a plain `Box<[u8]>`.
    let cwd: Box<[u8]> = if let Some(cwd_arg) = args.option(b"--cwd") {
        let mut outbuf = PathBuffer::uninit();
        let cwd_len = bun_sys::getcwd(&mut *outbuf)?;
        let out = resolve_path::join_abs::<platform::Loose>(&outbuf[..cwd_len], cwd_arg);
        // `chdir` wants a NUL-terminated path; `join_abs` returns a borrowed
        // slice into a threadlocal buffer, so dupe-Z once and reuse for both
        // the `chdir` arg and the stored `absolute_working_dir`.
        let out_z = bun_core::ZBox::from_bytes(out);
        if let bun_sys::Result::Err(err) = bun_sys::chdir(&out_z) {
            Output::err(
                err,
                "Could not change directory to \"{}\"\n",
                format_args!("{}", BStr::new(cwd_arg)),
            );
            Global::exit(1);
        }
        Box::<[u8]>::from(out_z.as_bytes())
    } else {
        let mut temp = PathBuffer::uninit();
        let len = bun_sys::getcwd(&mut *temp)?;
        Box::<[u8]>::from(&temp[..len])
    };

    // Not gated on .BunxCommand: bunx skips Arguments.parse entirely
    // (uses_global_options=false). bunx picks up no-orphans via the
    // BUN_FEATURE_FLAG_NO_ORPHANS env var in main()→install() instead.
    if matches!(
        cmd,
        CommandTag::RunCommand | CommandTag::AutoCommand | CommandTag::TestCommand
    ) {
        if args.flag(b"--no-orphans") {
            bun_io::parent_death_watchdog::enable();
        }
    }

    if matches!(cmd, CommandTag::RunCommand | CommandTag::AutoCommand) {
        ctx.filters = slice_to_owned(args.options(b"--filter"));
        ctx.workspaces = args.flag(b"--workspaces");
        ctx.if_present = args.flag(b"--if-present");
        ctx.parallel = args.flag(b"--parallel");
        ctx.sequential = args.flag(b"--sequential");
        ctx.no_exit_on_error = args.flag(b"--no-exit-on-error");

        if let Some(elide_lines) = args.option(b"--elide-lines") {
            if !elide_lines.is_empty() {
                ctx.bundler_options.elide_lines = match strings::parse_int::<usize>(elide_lines, 10)
                {
                    Ok(v) => Some(v),
                    Err(_) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: Invalid elide-lines: \"{}\"",
                            BStr::new(elide_lines)
                        ));
                        Global::exit(1);
                    }
                };
            }
        }
    }

    if cmd == CommandTag::TestCommand {
        parse_test_command_options(&args, ctx);
    }

    ctx.args.absolute_working_dir = Some(cwd);
    ctx.positionals = slice_to_owned(args.positionals());

    if command::LOADS_CONFIG[cmd] {
        load_config_with_cmd_args(cmd, &args, ctx)?;
    }

    let mut opts: api::TransformOptions = ctx.args.clone();

    let defines_tuple = DefineColonList::resolve(args.options(b"--define"))?;

    if !defines_tuple.keys.is_empty() {
        opts.define = Some(api::StringMap {
            keys: defines_tuple
                .keys
                .iter()
                .map(|s| Box::<[u8]>::from(*s))
                .collect(),
            values: defines_tuple
                .values
                .iter()
                .map(|s| Box::<[u8]>::from(*s))
                .collect(),
        });
    }

    opts.drop = slice_to_owned(args.options(b"--drop"));
    opts.feature_flags = slice_to_owned(args.options(b"--feature"));

    // Node added a `--loader` flag (that's kinda like `--register`). It's
    // completely different from ours.
    let loader_tuple = if cmd != CommandTag::RunAsNodeCommand {
        LoaderColonList::resolve(args.options(b"--loader"))?
    } else {
        ColonListType {
            keys: Vec::new(),
            values: Vec::new(),
        }
    };

    if !loader_tuple.keys.is_empty() {
        opts.loaders = Some(api::LoaderMap {
            extensions: loader_tuple
                .keys
                .iter()
                .map(|s| Box::<[u8]>::from(*s))
                .collect(),
            loaders: loader_tuple.values,
        });
    }

    opts.tsconfig_override = if let Some(ts) = args.option(b"--tsconfig-override") {
        Some(
            resolve_path::join_abs_string::<platform::Auto>(
                ctx.args.absolute_working_dir.as_deref().unwrap(),
                &[ts],
            )
            .into(),
        )
    } else {
        None
    };

    opts.main_fields = slice_to_owned(args.options(b"--main-fields"));
    // we never actually supported inject.
    // opts.inject = args.options(b"--inject");
    opts.env_files = slice_to_owned(args.options(b"--env-file"));
    opts.extension_order = slice_to_owned(args.options(b"--extension-order"));

    if args.flag(b"--no-env-file") {
        opts.disable_default_env_files = true;
    }

    if args.flag(b"--preserve-symlinks") {
        opts.preserve_symlinks = Some(true);
    }
    if args.flag(b"--preserve-symlinks-main") {
        ctx.runtime_options.preserve_symlinks_main = true;
    }

    ctx.passthrough = slice_to_owned(args.remaining());

    if matches!(
        cmd,
        CommandTag::AutoCommand
            | CommandTag::RunCommand
            | CommandTag::BuildCommand
            | CommandTag::TestCommand
    ) {
        if !args.options(b"--conditions").is_empty() {
            opts.conditions = slice_to_owned(args.options(b"--conditions"));
        }
    }

    // runtime commands
    if matches!(
        cmd,
        CommandTag::AutoCommand
            | CommandTag::RunCommand
            | CommandTag::TestCommand
            | CommandTag::RunAsNodeCommand
    ) {
        {
            let preloads = args.options(b"--preload");
            let preloads2 = args.options(b"--require");
            let preloads3 = args.options(b"--import");
            let preload4 = env_var::BUN_INSPECT_PRELOAD.get();

            let total_preloads = ctx.preloads.len()
                + preloads.len()
                + preloads2.len()
                + preloads3.len()
                + (if preload4.is_some() { 1usize } else { 0usize });
            if total_preloads > 0 {
                let mut all: Vec<Box<[u8]>> = Vec::with_capacity(total_preloads);
                if !ctx.preloads.is_empty() {
                    all.append(&mut ctx.preloads);
                }
                // PERF(port): was appendSliceAssumeCapacity
                for p in preloads {
                    all.push(Box::<[u8]>::from(*p));
                }
                for p in preloads2 {
                    all.push(Box::<[u8]>::from(*p));
                }
                for p in preloads3 {
                    all.push(Box::<[u8]>::from(*p));
                }
                if let Some(p) = preload4 {
                    all.push(Box::<[u8]>::from(p));
                }
                ctx.preloads = all;
            }
        }

        if args.flag(b"--hot") {
            ctx.debug.hot_reload = HotReload::Hot;
            if args.flag(b"--no-clear-screen") {
                let _ = bun_dotenv::HAS_NO_CLEAR_SCREEN_CLI_FLAG.set(true);
            }
        } else if args.flag(b"--watch") {
            ctx.debug.hot_reload = HotReload::Watch;

            // Windows applies this to the watcher child process.
            // The parent process is unable to re-launch itself
            #[cfg(not(windows))]
            {
                bun_core::set_auto_reload_on_crash(true);
            }

            if args.flag(b"--no-clear-screen") {
                let _ = bun_dotenv::HAS_NO_CLEAR_SCREEN_CLI_FLAG.set(true);
            }
        }

        if let Some(origin) = args.option(b"--origin") {
            opts.origin = Some(origin.into());
        }

        if args.flag(b"--redis-preconnect") {
            ctx.runtime_options.redis_preconnect = true;
        }

        if args.flag(b"--sql-preconnect") {
            ctx.runtime_options.sql_preconnect = true;
        }

        if args.flag(b"--no-addons") {
            // used for disabling process.dlopen and
            // for disabling export condition "node-addons"
            opts.allow_addons = Some(false);
        }

        if let Some(unhandled_rejections) = args.option(b"--unhandled-rejections") {
            opts.unhandled_rejections = match api::UnhandledRejections::MAP
                .get(unhandled_rejections)
            {
                Some(v) => Some(*v),
                None => {
                    Output::err_generic(
                        "Invalid value for --unhandled-rejections: \"{}\". Must be one of \"strict\", \"throw\", \"warn\", \"none\", \"warn-with-error-code\"\n",
                        format_args!("{}", BStr::new(unhandled_rejections)),
                    );
                    Global::exit(1);
                }
            };
        }

        if let Some(port_str) = args.option(b"--port") {
            if cmd == CommandTag::RunAsNodeCommand {
                // TODO: prevent `node --port <script>` from working
                ctx.runtime_options.eval.script = port_str.into();
                ctx.runtime_options.eval.eval_and_print = true;
            } else {
                opts.port = match strings::parse_int::<u16>(port_str, 10) {
                    Ok(v) => Some(v),
                    Err(_) => {
                        Output::err_fmt(bun_core::fmt::out_of_range(
                            port_str,
                            bun_core::fmt::OutOfRangeOptions {
                                field_name: b"--port",
                                min: 0,
                                max: u16::MAX as i64,
                                msg: b"",
                            },
                        ));
                        Output::note("To evaluate TypeScript here, use 'bun --print'");
                        Global::exit(1);
                    }
                };
            }
        }

        if let Some(size_str) = args.option(b"--max-http-header-size") {
            let size = match strings::parse_int::<usize>(size_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::err_generic(
                        "Invalid value for --max-http-header-size: \"{}\". Must be a positive integer\n",
                        format_args!("{}", BStr::new(size_str)),
                    );
                    Global::exit(1);
                }
            };
            bun_http::set_max_http_header_size(if size == 0 { 1024 * 1024 * 1024 } else { size });
        }

        if let Some(user_agent) = args.option(b"--user-agent") {
            // argv slices returned by `clap::Args::option` borrow
            // process-lifetime `argv` storage.
            let _ = bun_http::OVERRIDDEN_DEFAULT_USER_AGENT.set(user_agent);
        }

        ctx.debug.offline_mode_setting = Some(if args.flag(b"--prefer-offline") {
            bun_options_types::offline_mode::OfflineMode::Offline
        } else if args.flag(b"--prefer-latest") {
            bun_options_types::offline_mode::OfflineMode::Latest
        } else {
            bun_options_types::offline_mode::OfflineMode::Online
        });

        if args.flag(b"--no-install") {
            ctx.debug.global_cache = options::GlobalCache::disable;
        } else if args.flag(b"-i") {
            ctx.debug.global_cache = options::GlobalCache::fallback;
        } else if let Some(enum_value) = args.option(b"--install") {
            // -i=auto --install=force, --install=disable
            if let Some(result) = options::GlobalCache::MAP.get(enum_value) {
                ctx.debug.global_cache = *result;
            // -i, --install
            } else if enum_value.is_empty() {
                ctx.debug.global_cache = options::GlobalCache::force;
            } else {
                Output::err_generic(
                    "Invalid value for --install: \"{}\". Must be either \"auto\", \"fallback\", \"force\", or \"disable\"\n",
                    format_args!("{}", BStr::new(enum_value)),
                );
                Global::exit(1);
            }
        }

        if let Some(script) = args.option(b"--print") {
            ctx.runtime_options.eval.script = script.into();
            ctx.runtime_options.eval.eval_and_print = true;
        } else if let Some(script) = args.option(b"--eval") {
            ctx.runtime_options.eval.script = script.into();
        }
        ctx.runtime_options.if_present = args.flag(b"--if-present");
        ctx.runtime_options.smol = args.flag(b"--smol");
        ctx.runtime_options.preconnect = slice_to_owned(args.options(b"--fetch-preconnect"));
        ctx.runtime_options.experimental_http2_fetch = args.flag(b"--experimental-http2-fetch");
        ctx.runtime_options.experimental_http3_fetch = args.flag(b"--experimental-http3-fetch");
        ctx.runtime_options.expose_gc = args.flag(b"--expose-gc");

        if let Some(depth_str) = args.option(b"--console-depth") {
            let depth = match strings::parse_int::<u16>(depth_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::err_generic(
                        "Invalid value for --console-depth: \"{}\". Must be a positive integer\n",
                        format_args!("{}", BStr::new(depth_str)),
                    );
                    Global::exit(1);
                }
            };
            // Treat depth=0 as maxInt(u16) for infinite depth
            ctx.runtime_options.console_depth = Some(if depth == 0 { u16::MAX } else { depth });
        }

        if let Some(order) = args.option(b"--dns-result-order") {
            ctx.runtime_options.dns_result_order = order.into();
        }

        let has_cron_title = args.option(b"--cron-title");
        let has_cron_period = args.option(b"--cron-period");
        if let Some(t) = has_cron_title {
            ctx.runtime_options.cron_title = t.into();
        }
        if let Some(p) = has_cron_period {
            ctx.runtime_options.cron_period = p.into();
        }
        if has_cron_title.is_some() != has_cron_period.is_some() {
            Output::err_generic(
                "--cron-title and --cron-period must be provided together",
                (),
            );
            Global::exit(1);
        }
        if has_cron_title.is_some()
            && (ctx.runtime_options.cron_title.is_empty()
                || ctx.runtime_options.cron_period.is_empty())
        {
            Output::err_generic("--cron-title and --cron-period must not be empty", ());
            Global::exit(1);
        }

        if let Some(inspect_flag) = args.option(b"--inspect") {
            ctx.runtime_options.debugger = if inspect_flag.is_empty() {
                Debugger::Enable(Default::default())
            } else {
                Debugger::Enable(DebuggerEnable {
                    path_or_port: Box::<[u8]>::from(inspect_flag),
                    ..Default::default()
                })
            };
        } else if let Some(inspect_flag) = args.option(b"--inspect-wait") {
            ctx.runtime_options.debugger = if inspect_flag.is_empty() {
                Debugger::Enable(DebuggerEnable {
                    wait_for_connection: true,
                    ..Default::default()
                })
            } else {
                Debugger::Enable(DebuggerEnable {
                    path_or_port: Box::<[u8]>::from(inspect_flag),
                    wait_for_connection: true,
                    ..Default::default()
                })
            };
        } else if let Some(inspect_flag) = args.option(b"--inspect-brk") {
            ctx.runtime_options.debugger = if inspect_flag.is_empty() {
                Debugger::Enable(DebuggerEnable {
                    wait_for_connection: true,
                    set_breakpoint_on_first_line: true,
                    ..Default::default()
                })
            } else {
                Debugger::Enable(DebuggerEnable {
                    path_or_port: Box::<[u8]>::from(inspect_flag),
                    wait_for_connection: true,
                    set_breakpoint_on_first_line: true,
                    ..Default::default()
                })
            };
        }

        let cpu_prof_flag = args.flag(b"--cpu-prof");
        let cpu_prof_md_flag = args.flag(b"--cpu-prof-md");

        // --cpu-prof-md alone enables profiling with markdown format
        // --cpu-prof alone enables profiling with JSON format
        // Both flags together enable profiling with both formats
        if cpu_prof_flag || cpu_prof_md_flag {
            ctx.runtime_options.cpu_prof.enabled = true;
            if let Some(name) = args.option(b"--cpu-prof-name") {
                ctx.runtime_options.cpu_prof.name = name.into();
            }
            if let Some(dir) = args.option(b"--cpu-prof-dir") {
                ctx.runtime_options.cpu_prof.dir = dir.into();
            }
            // md_format is true if --cpu-prof-md is passed (regardless of --cpu-prof)
            ctx.runtime_options.cpu_prof.md_format = cpu_prof_md_flag;
            // json_format is true if --cpu-prof is passed (regardless of --cpu-prof-md)
            ctx.runtime_options.cpu_prof.json_format = cpu_prof_flag;
            if let Some(interval_str) = args.option(b"--cpu-prof-interval") {
                ctx.runtime_options.cpu_prof.interval =
                    strings::parse_int::<u32>(interval_str, 10).unwrap_or(1000);
            }
        } else {
            // Warn if --cpu-prof-name or --cpu-prof-dir is used without a profiler flag
            if args.option(b"--cpu-prof-name").is_some() {
                Output::warn("--cpu-prof-name requires --cpu-prof or --cpu-prof-md to be enabled");
            }
            if args.option(b"--cpu-prof-dir").is_some() {
                Output::warn("--cpu-prof-dir requires --cpu-prof or --cpu-prof-md to be enabled");
            }
            if args.option(b"--cpu-prof-interval").is_some() {
                Output::warn(
                    "--cpu-prof-interval requires --cpu-prof or --cpu-prof-md to be enabled",
                );
            }
        }

        let heap_prof_v8 = args.flag(b"--heap-prof");
        let heap_prof_md = args.flag(b"--heap-prof-md");

        if heap_prof_v8 && heap_prof_md {
            // Both flags specified - warn and use markdown format
            Output::warn(
                "Both --heap-prof and --heap-prof-md specified; using --heap-prof-md (markdown format)",
            );
            ctx.runtime_options.heap_prof.enabled = true;
            ctx.runtime_options.heap_prof.text_format = true;
            if let Some(name) = args.option(b"--heap-prof-name") {
                ctx.runtime_options.heap_prof.name = name.into();
            }
            if let Some(dir) = args.option(b"--heap-prof-dir") {
                ctx.runtime_options.heap_prof.dir = dir.into();
            }
        } else if heap_prof_v8 || heap_prof_md {
            ctx.runtime_options.heap_prof.enabled = true;
            ctx.runtime_options.heap_prof.text_format = heap_prof_md;
            if let Some(name) = args.option(b"--heap-prof-name") {
                ctx.runtime_options.heap_prof.name = name.into();
            }
            if let Some(dir) = args.option(b"--heap-prof-dir") {
                ctx.runtime_options.heap_prof.dir = dir.into();
            }
        } else {
            // Warn if --heap-prof-name or --heap-prof-dir is used without --heap-prof or --heap-prof-md
            if args.option(b"--heap-prof-name").is_some() {
                Output::warn(
                    "--heap-prof-name requires --heap-prof or --heap-prof-md to be enabled",
                );
            }
            if args.option(b"--heap-prof-dir").is_some() {
                Output::warn(
                    "--heap-prof-dir requires --heap-prof or --heap-prof-md to be enabled",
                );
            }
        }

        if args.flag(b"--no-deprecation") {
            Bun__Node__ProcessNoDeprecation.store(true, core::sync::atomic::Ordering::Relaxed);
        }
        if args.flag(b"--throw-deprecation") {
            Bun__Node__ProcessThrowDeprecation.store(true, core::sync::atomic::Ordering::Relaxed);
        }
        if let Some(title) = args.option(b"--title") {
            // Static is `Mutex<Option<Box<[u8]>>>` so `process.title = "..."`
            // can drop the previous value; box the argv-borrowed slice up
            // front (Zig: `CLI.Bun__Node__ProcessTitle = title;`).
            *cli::Bun__Node__ProcessTitle.lock() = Some(title.into());
        }
        if args.flag(b"--zero-fill-buffers") {
            Bun__Node__ZeroFillBuffers.store(true, core::sync::atomic::Ordering::Relaxed);
        }
        let use_system_ca = args.flag(b"--use-system-ca");
        let use_openssl_ca = args.flag(b"--use-openssl-ca");
        let use_bundled_ca = args.flag(b"--use-bundled-ca");

        // Disallow any combination > 1
        if (use_system_ca as u8) + (use_openssl_ca as u8) + (use_bundled_ca as u8) > 1 {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: choose exactly one of --use-system-ca, --use-openssl-ca, or --use-bundled-ca"
            ));
            Global::exit(1);
        }

        // CLI overrides env var (NODE_USE_SYSTEM_CA)
        let store: Option<BunCAStore> = if use_bundled_ca {
            Some(BunCAStore::Bundled)
        } else if use_openssl_ca {
            Some(BunCAStore::Openssl)
        } else if use_system_ca || env_var::NODE_USE_SYSTEM_CA.get().unwrap_or(false) {
            Some(BunCAStore::System)
        } else {
            // No CA flag — leave the FFI default (Bundled) in place. Avoids a
            // `transmute<u8, BunCAStore>` round-trip through the atomic, which
            // would be UB on an out-of-range discriminant.
            None
        };
        if let Some(store) = store {
            Bun__Node__CAStore.store(store as u8, core::sync::atomic::Ordering::Relaxed);
            // Back-compat boolean used by native code until fully migrated
            Bun__Node__UseSystemCA.store(
                store == BunCAStore::System,
                core::sync::atomic::Ordering::Relaxed,
            );
        } else {
            // Spec Arguments.zig: `Bun__Node__UseSystemCA = (Bun__Node__CAStore == .system)`
            // is written unconditionally; preserve that always-write semantics
            // even when no CA flag/env was supplied (default `.bundled` ⇒ false).
            Bun__Node__UseSystemCA.store(false, core::sync::atomic::Ordering::Relaxed);
        }
    }

    if opts.port.is_some() && opts.origin.is_none() {
        let mut v: Vec<u8> = Vec::new();
        use std::io::Write;
        write!(&mut v, "http://localhost:{}/", opts.port.unwrap()).expect("write to Vec");
        opts.origin = Some(v.into_boxed_slice());
    }

    let output_dir: Option<&[u8]> = None;
    let output_file: Option<&[u8]> = None;

    ctx.bundler_options.ignore_dce_annotations = args.flag(b"--ignore-dce-annotations");

    if cmd == CommandTag::BuildCommand {
        parse_build_command_options(cmd, &args, &mut opts, ctx, &mut diag);
    }

    if opts.entry_points.is_empty() {
        let mut entry_points: &[Box<[u8]>] = &ctx.positionals;

        match cmd {
            CommandTag::BuildCommand => {
                if !entry_points.is_empty()
                    && (&*entry_points[0] == b"build" || &*entry_points[0] == b"bun")
                {
                    let mut out_entry = &entry_points[1..];
                    for (i, entry) in entry_points.iter().enumerate() {
                        if !entry.is_empty() {
                            out_entry = &out_entry[i..];
                            break;
                        }
                    }
                    entry_points = out_entry;
                }
            }
            CommandTag::RunCommand => {
                if !entry_points.is_empty()
                    && (&*entry_points[0] == b"run" || &*entry_points[0] == b"r")
                {
                    entry_points = &entry_points[1..];
                }
            }
            _ => {}
        }

        opts.entry_points = entry_points.to_vec();
    }

    let jsx_factory = args.option(b"--jsx-factory");
    let jsx_fragment = args.option(b"--jsx-fragment");
    let jsx_import_source = args.option(b"--jsx-import-source");
    let jsx_runtime = args.option(b"--jsx-runtime");
    let jsx_side_effects = args.flag(b"--jsx-side-effects");

    if matches!(cmd, CommandTag::AutoCommand | CommandTag::RunCommand) {
        // "run.silent" in bunfig.toml
        if args.flag(b"--silent") {
            ctx.debug.silent = true;
        }

        if let Some(elide_lines) = args.option(b"--elide-lines") {
            if !elide_lines.is_empty() {
                ctx.bundler_options.elide_lines = match strings::parse_int::<usize>(elide_lines, 10)
                {
                    Ok(v) => Some(v),
                    Err(_) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: Invalid elide-lines: \"{}\"",
                            BStr::new(elide_lines)
                        ));
                        Global::exit(1);
                    }
                };
            }
        }

        if let Some(define) = &opts.define {
            if !define.keys.is_empty() {
                bun_jsc::runtime_transpiler_cache::IS_DISABLED
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    if matches!(
        cmd,
        CommandTag::RunCommand | CommandTag::AutoCommand | CommandTag::BunxCommand
    ) {
        // "run.bun" in bunfig.toml
        if args.flag(b"--bun") {
            ctx.debug.run_in_bun = true;
        }
    }

    opts.resolve = Some(api::ResolveMode::Lazy);

    if jsx_factory.is_some()
        || jsx_fragment.is_some()
        || jsx_import_source.is_some()
        || jsx_runtime.is_some()
    {
        let default_factory: &[u8] = b"";
        let default_fragment: &[u8] = b"";
        let default_import_source: &[u8] = b"";
        if opts.jsx.is_none() {
            opts.jsx = Some(api::Jsx {
                factory: jsx_factory.unwrap_or(default_factory).into(),
                fragment: jsx_fragment.unwrap_or(default_fragment).into(),
                import_source: jsx_import_source.unwrap_or(default_import_source).into(),
                runtime: if let Some(runtime) = jsx_runtime {
                    resolve_jsx_runtime(runtime)?
                } else {
                    api::JsxRuntime::Automatic
                },
                development: false,
                side_effects: jsx_side_effects,
            });
        } else {
            let prev = opts.jsx.take().unwrap();
            opts.jsx = Some(api::Jsx {
                factory: jsx_factory.map(Box::<[u8]>::from).unwrap_or(prev.factory),
                fragment: jsx_fragment.map(Box::<[u8]>::from).unwrap_or(prev.fragment),
                import_source: jsx_import_source
                    .map(Box::<[u8]>::from)
                    .unwrap_or(prev.import_source),
                runtime: if let Some(runtime) = jsx_runtime {
                    resolve_jsx_runtime(runtime)?
                } else {
                    prev.runtime
                },
                development: false,
                side_effects: jsx_side_effects,
            });
        }
    }

    if cmd == CommandTag::BuildCommand {
        if opts.entry_points.is_empty() && !ctx.bundler_options.bake {
            Output::prettyln(format_args!(
                "<r><b>bun build <r><d>v{}<r>",
                bun_core::Global::package_json_version_with_sha
            ));
            Output::pretty(format_args!(
                "<r><red>error: Missing entrypoints. What would you like to bundle?<r>\n\n"
            ));
            Output::flush();
            Output::pretty(format_args!(
                "Usage:\n  <d>$<r> <b><green>bun build<r> \\<entrypoint\\> [...\\<entrypoints\\>] <cyan>[...flags]<r>  \n"
            ));
            Output::pretty(format_args!(
                "\nTo see full documentation:\n  <d>$<r> <b><green>bun build<r> --help\n"
            ));
            Output::flush();
            Global::exit(1);
        }

        if args.flag(b"--production") {
            let any_html = opts
                .entry_points
                .iter()
                .any(|entry_point| strings::has_suffix_comptime(entry_point, b".html"));
            if any_html {
                ctx.bundler_options.css_chunking = true;
            }

            ctx.bundler_options.production = true;
        }
    }

    if let Some(log_level) = opts.log_level {
        bun_ast::DEFAULT_LOG_LEVEL.store(match log_level {
            api::MessageLevel::Debug => bun_ast::Level::Debug,
            api::MessageLevel::Err => bun_ast::Level::Err,
            api::MessageLevel::Warn => bun_ast::Level::Warn,
            _ => bun_ast::Level::Err,
        });
        // SAFETY: `ctx.log` is the CLI log, owned by the caller and not yet
        // shared with another thread.
        unsafe {
            (*ctx.log).level = bun_ast::DEFAULT_LOG_LEVEL.load();
        }
    }

    if args.flag(b"--no-macros") {
        ctx.debug.macros = MacroOptions::Disable;
    }

    opts.output_dir = output_dir.map(Box::<[u8]>::from);
    if let Some(of) = output_file {
        ctx.debug.output_file = of.into();
    }

    if matches!(cmd, CommandTag::RunCommand | CommandTag::AutoCommand) {
        if let Some(shell) = args.option(b"--shell") {
            if shell == b"bun" {
                ctx.debug.use_system_shell = false;
            } else if shell == b"system" {
                ctx.debug.use_system_shell = true;
            } else {
                Output::err_generic(
                    "Expected --shell to be one of 'bun' or 'system'. Received: \"{}\"",
                    format_args!("{}", BStr::new(shell)),
                );
                Global::exit(1);
            }
        }
    }

    if bun_core::env::SHOW_CRASH_TRACE {
        // argv slices are process-lifetime.
        let _ = cli::debug_flags::RESOLVE_BREAKPOINTS
            .set(args.options(b"--breakpoint-resolve").to_vec());
        let _ =
            cli::debug_flags::PRINT_BREAKPOINTS.set(args.options(b"--breakpoint-print").to_vec());
    }

    Ok(opts)
}


/// Cold path: `bun test` option-group parsing — timeout / coverage / reporter /
/// shard / parallel / seed / etc. Split out of [`parse`] so the `bun run <script>`
/// and bare-`bun <file>` hot path (`USES_GLOBAL_OPTIONS` ⇒ `parse` runs on every
/// invocation) doesn't carry the test-runner flag handling in its instruction pages.
#[cold]
#[inline(never)]
fn parse_test_command_options(args: &clap::Args<clap::Help>, ctx: Context<'_>) {
    if let Some(timeout_ms) = args.option(b"--timeout") {
        if !timeout_ms.is_empty() {
            ctx.test_options.default_timeout_ms =
                match strings::parse_int::<u32>(timeout_ms, 10) {
                    Ok(v) => v,
                    Err(_) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: Invalid timeout: \"{}\"",
                            BStr::new(timeout_ms)
                        ));
                        Output::flush();
                        Global::exit(1);
                    }
                };
        }
    }

    if let Some(max_concurrency) = args.option(b"--max-concurrency") {
        if !max_concurrency.is_empty() {
            ctx.test_options.max_concurrency =
                match strings::parse_int::<u32>(max_concurrency, 10) {
                    Ok(v) => v,
                    Err(_) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: Invalid max-concurrency: \"{}\"",
                            BStr::new(max_concurrency)
                        ));
                        Global::exit(1);
                    }
                };
        }
    }

    if !ctx.test_options.coverage.enabled {
        ctx.test_options.coverage.enabled = args.flag(b"--coverage");
    }

    if !args.options(b"--coverage-reporter").is_empty() {
        ctx.test_options.coverage.reporters = CoverageReporters {
            text: false,
            lcov: false,
        };
        for reporter in args.options(b"--coverage-reporter") {
            if *reporter == b"text" {
                ctx.test_options.coverage.reporters.text = true;
            } else if *reporter == b"lcov" {
                ctx.test_options.coverage.reporters.lcov = true;
            } else {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: invalid coverage reporter '{}'. Available options: 'text' (console output), 'lcov' (code coverage file)",
                    BStr::new(reporter)
                ));
                Global::exit(1);
            }
        }
    }

    if let Some(reporter_outfile) = args.option(b"--reporter-outfile") {
        ctx.test_options.reporter_outfile = Some(reporter_outfile.into());
    }

    if let Some(reporter) = args.option(b"--reporter") {
        if reporter == b"junit" {
            if ctx.test_options.reporter_outfile.is_none() {
                Output::err_generic(
                    "--reporter=junit requires --reporter-outfile [file] to specify where to save the XML report",
                    (),
                );
                Global::crash();
            }
            ctx.test_options.reporters.junit = true;
        } else if reporter == b"dots" || reporter == b"dot" {
            ctx.test_options.reporters.dots = true;
        } else {
            Output::err_generic(
                "unsupported reporter format '{}'. Available options: 'junit' (for XML test results), 'dots'",
                format_args!("{}", BStr::new(reporter)),
            );
            Global::crash();
        }
    }

    // Handle --dots flag as shorthand for --reporter=dots
    if args.flag(b"--dots") {
        ctx.test_options.reporters.dots = true;
    }

    // Handle --only-failures flag
    if args.flag(b"--only-failures") {
        ctx.test_options.reporters.only_failures = true;
    }

    if let Some(dir) = args.option(b"--coverage-dir") {
        ctx.test_options.coverage.reports_directory = Box::<[u8]>::from(dir);
    }

    if !args.options(b"--path-ignore-patterns").is_empty() {
        ctx.test_options.path_ignore_patterns =
            slice_to_owned(args.options(b"--path-ignore-patterns"));
        ctx.test_options.path_ignore_patterns_from_cli = true;
    }

    if let Some(bail) = args.option(b"--bail") {
        if !bail.is_empty() {
            ctx.test_options.bail = match strings::parse_int::<u32>(bail, 10) {
                Ok(v) => v,
                Err(e) => {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: --bail expects a number: {:?}",
                        e
                    ));
                    Output::flush();
                    Global::exit(1);
                }
            };

            if ctx.test_options.bail == 0 {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: --bail expects a number greater than 0"
                ));
                Output::flush();
                Global::exit(1);
            }
        } else {
            ctx.test_options.bail = 1;
        }
    }
    if let Some(repeat_count) = args.option(b"--rerun-each") {
        if !repeat_count.is_empty() {
            ctx.test_options.repeat_count = match strings::parse_int::<u32>(repeat_count, 10) {
                Ok(v) => v,
                Err(e) => {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: --rerun-each expects a number: {:?}",
                        e
                    ));
                    Global::exit(1);
                }
            };
        }
    }
    if let Some(retry_count) = args.option(b"--retry") {
        if !retry_count.is_empty() {
            ctx.test_options.retry = match strings::parse_int::<u32>(retry_count, 10) {
                Ok(v) => v,
                Err(e) => {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: --retry expects a number: {:?}",
                        e
                    ));
                    Global::exit(1);
                }
            };
        }
    }
    if ctx.test_options.retry != 0 && ctx.test_options.repeat_count != 0 {
        Output::pretty_errorln(format_args!(
            "<r><red>error<r>: --retry cannot be used with --rerun-each"
        ));
        Global::exit(1);
    }
    if let Some(name_pattern) = args.option(b"--test-name-pattern") {
        ctx.test_options.test_filter_pattern = Some(name_pattern.into());
        let regex = match RegularExpression::init(
            bun_core::String::from_bytes(name_pattern),
            RegexFlags::None,
        ) {
            Ok(r) => r,
            Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: --test-name-pattern expects a valid regular expression but received {}",
                    bun_core::fmt::QuotedFormatter { text: name_pattern },
                ));
                Global::exit(1);
            }
        };
        // The compiled regex lives in `bun_jsc::RegularExpression` (T6); the
        // T3 `TestOptions` field is type-erased to `NonNull<()>` to break the
        // back-edge. High tier owns construction/destruction.
        ctx.test_options.test_filter_regex = core::ptr::NonNull::new(regex.cast::<()>());
    }
    if let Some(since) = args.option(b"--changed") {
        ctx.test_options.changed = Some(since.into());
    }
    if let Some(shard) = args.option(b"--shard") {
        let Some(sep) = strings::index_of_char(shard, b'/') else {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: --shard expects <d>'<r>index/count<d>'<r>, e.g. --shard=1/3"
            ));
            Global::exit(1);
        };
        let sep = sep as usize;
        let index_str = &shard[..sep];
        let count_str = &shard[sep + 1..];
        let index = match strings::parse_int::<u32>(index_str, 10) {
            Ok(v) => v,
            Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: --shard index must be a positive integer, got \"{}\"",
                    BStr::new(index_str)
                ));
                Global::exit(1);
            }
        };
        let count = match strings::parse_int::<u32>(count_str, 10) {
            Ok(v) => v,
            Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: --shard count must be a positive integer, got \"{}\"",
                    BStr::new(count_str)
                ));
                Global::exit(1);
            }
        };
        if count == 0 {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: --shard count must be greater than 0"
            ));
            Global::exit(1);
        }
        if index == 0 || index > count {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: --shard index must be between 1 and {}, got {}",
                count, index
            ));
            Global::exit(1);
        }
        ctx.test_options.shard = Some(Shard { index, count });
    }
    ctx.test_options.update_snapshots = args.flag(b"--update-snapshots");
    ctx.test_options.run_todo = args.flag(b"--todo");
    ctx.test_options.only = args.flag(b"--only");
    ctx.test_options.pass_with_no_tests = args.flag(b"--pass-with-no-tests");
    ctx.test_options.concurrent = args.flag(b"--concurrent");
    ctx.test_options.randomize = args.flag(b"--randomize");
    ctx.test_options.isolate = args.flag(b"--isolate");
    ctx.test_options.test_worker = args.flag(b"--test-worker");

    if let Some(parallel_str) = args.option(b"--parallel") {
        let parsed: u32 = if !parallel_str.is_empty() {
            match strings::parse_int::<u32>(parallel_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::pretty_errorln(format_args!(
                        "<red>error<r>: --parallel expects a positive integer, received \"{}\"",
                        BStr::new(parallel_str)
                    ));
                    Global::exit(1);
                }
            }
        } else {
            u32::from(bun_core::get_thread_count().max(1))
        };
        if parsed == 0 {
            Output::pretty_errorln(format_args!(
                "<red>error<r>: --parallel expects a positive integer, received \"0\""
            ));
            Global::exit(1);
        }
        ctx.test_options.parallel = parsed;
        // --parallel implies --isolate inside each worker.
        ctx.test_options.isolate = true;
    }

    if let Some(delay_str) = args.option(b"--parallel-delay") {
        ctx.test_options.parallel_delay_ms = match strings::parse_int::<u32>(delay_str, 10) {
            Ok(v) => Some(v),
            Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<red>error<r>: --parallel-delay expects a non-negative integer (milliseconds), received \"{}\"",
                    BStr::new(delay_str)
                ));
                Global::exit(1);
            }
        };
    }

    if let Some(seed_str) = args.option(b"--seed") {
        ctx.test_options.randomize = true;
        ctx.test_options.seed = match strings::parse_int::<u32>(seed_str, 10) {
            Ok(v) => Some(v),
            Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<red>error<r>: Invalid seed value: {}",
                    BStr::new(seed_str)
                ));
                Global::exit(1);
            }
        };
    }
}

/// Cold path: `bun build` option-group parsing — bundler flags, `--app` (Bake),
/// `--compile` / `CompileTarget`, sourcemap / format / minify, Windows executable
/// metadata, etc. Split out of [`parse`] for the same reason as
/// [`parse_test_command_options`].
#[cold]
#[inline(never)]
fn parse_build_command_options(
    cmd: CommandTag,
    args: &clap::Args<clap::Help>,
    opts: &mut api::TransformOptions,
    ctx: Context<'_>,
    diag: &mut clap::Diagnostic,
) {
    ctx.bundler_options.transform_only = args.flag(b"--no-bundle");
    ctx.bundler_options.bytecode = args.flag(b"--bytecode");

    let production = args.flag(b"--production");

    if args.flag(b"--app") {
        if !FeatureFlags::bake() {
            Output::err_generic(
                "To use the experimental \"--app\" option, upgrade to the canary build of bun via \"bun upgrade --canary\"",
                (),
            );
            Global::crash();
        }

        ctx.bundler_options.bake = true;
        ctx.bundler_options.bake_debug_dump_server =
            FeatureFlags::BAKE_DEBUGGING_FEATURES && args.flag(b"--debug-dump-server-files");
        ctx.bundler_options.bake_debug_disable_minify =
            FeatureFlags::BAKE_DEBUGGING_FEATURES && args.flag(b"--debug-no-minify");
    }

    if ctx.bundler_options.bytecode {
        ctx.bundler_options.output_format = options::Format::Cjs;
        ctx.args.target = Some(api::Target::Bun);
    }

    if let Some(public_path) = args.option(b"--public-path") {
        ctx.bundler_options.public_path = public_path.into();
    }

    if let Some(banner) = args.option(b"--banner") {
        ctx.bundler_options.banner = banner.into();
    }

    if let Some(footer) = args.option(b"--footer") {
        ctx.bundler_options.footer = footer.into();
    }

    let minify_flag = args.flag(b"--minify") || production;
    ctx.bundler_options.minify_syntax = minify_flag || args.flag(b"--minify-syntax");
    ctx.bundler_options.minify_whitespace = minify_flag || args.flag(b"--minify-whitespace");
    ctx.bundler_options.minify_identifiers = minify_flag || args.flag(b"--minify-identifiers");
    ctx.bundler_options.keep_names = args.flag(b"--keep-names");

    ctx.bundler_options.css_chunking = args.flag(b"--css-chunking");

    ctx.bundler_options.emit_dce_annotations =
        args.flag(b"--emit-dce-annotations") || !ctx.bundler_options.minify_whitespace;

    if !args.options(b"--external").is_empty() {
        opts.external = slice_to_owned(args.options(b"--external"));
    }

    if args.flag(b"--reject-unresolved") && !args.options(b"--allow-unresolved").is_empty() {
        Output::pretty_errorln(format_args!(
            "<r><red>error<r>: --reject-unresolved and --allow-unresolved cannot be used together"
        ));
        Global::crash();
    } else if args.flag(b"--reject-unresolved") {
        ctx.bundler_options.allow_unresolved = Some(Vec::new());
    } else if !args.options(b"--allow-unresolved").is_empty() {
        let raw = args.options(b"--allow-unresolved");
        let mut allow: Vec<Box<[u8]>> = Vec::with_capacity(raw.len());
        for val in raw {
            // "<empty>" sentinel represents the empty-string pattern (for matching opaque specifiers)
            allow.push(Box::<[u8]>::from(if *val == b"<empty>" {
                b"".as_slice()
            } else {
                *val
            }));
        }
        ctx.bundler_options.allow_unresolved = Some(allow);
    }

    if let Some(packages) = args.option(b"--packages") {
        if packages == b"bundle" {
            opts.packages = Some(api::Packages::Bundle);
        } else if packages == b"external" {
            opts.packages = Some(api::Packages::External);
        } else {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: Invalid packages setting: \"{}\"",
                BStr::new(packages)
            ));
            Global::crash();
        }
    }

    if let Some(env) = args.option(b"--env") {
        if let Some(asterisk) = strings::index_of_char(env, b'*') {
            if asterisk == 0 {
                ctx.bundler_options.env_behavior = options::EnvBehavior::LoadAll;
            } else {
                ctx.bundler_options.env_behavior = options::EnvBehavior::Prefix;
                ctx.bundler_options.env_prefix = Box::<[u8]>::from(&env[..asterisk as usize]);
            }
        } else if env == b"inline" || env == b"1" {
            ctx.bundler_options.env_behavior = options::EnvBehavior::LoadAll;
        } else if env == b"disable" || env == b"0" {
            ctx.bundler_options.env_behavior = options::EnvBehavior::LoadAllWithoutInlining;
        } else {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: Expected 'env' to be 'inline', 'disable', or a prefix with a '*' character"
            ));
            Global::crash();
        }
    }

    if let Some(target) = args.option(b"--target") {
        'brk: {
            if cmd == CommandTag::BuildCommand {
                if args.flag(b"--compile") {
                    if target.len() > 4 && strings::has_prefix(target, b"bun-") {
                        ctx.bundler_options.compile_target =
                            cli::Cli::CompileTarget::from(&target[3..]);
                        if !ctx.bundler_options.compile_target.is_supported() {
                            Output::err_generic(
                                "Unsupported compile target: {}\n",
                                format_args!("{}", ctx.bundler_options.compile_target),
                            );
                            Global::exit(1);
                        }
                        opts.target = Some(api::Target::Bun);
                        break 'brk;
                    }
                }
            }

            opts.target = Some(opts.target.unwrap_or_else(|| match target {
                b"browser" => api::Target::Browser,
                b"node" => api::Target::Node,
                b"macro" => {
                    if cmd == CommandTag::BuildCommand {
                        api::Target::BunMacro
                    } else {
                        api::Target::Bun
                    }
                }
                b"bun" => api::Target::Bun,
                _ => cli::invalid_target(diag, target),
            }));

            if opts.target.unwrap() == api::Target::Bun {
                ctx.debug.run_in_bun = opts.target.unwrap() == api::Target::Bun;
            } else {
                if ctx.bundler_options.bytecode {
                    Output::err_generic(
                        "target must be 'bun' when bytecode is true. Received: {}",
                        format_args!(
                            "{:?}",
                            <bun_ast::Target as bun_options_types::TargetExt>::from_api(
                                opts.target
                            )
                        ),
                    );
                    Global::exit(1);
                }

                if ctx.bundler_options.bake {
                    Output::err_generic(
                        "target must be 'bun' when using --app. Received: {}",
                        format_args!(
                            "{:?}",
                            <bun_ast::Target as bun_options_types::TargetExt>::from_api(
                                opts.target
                            )
                        ),
                    );
                }
            }
        }
    }

    if args.flag(b"--watch") {
        ctx.debug.hot_reload = HotReload::Watch;
        bun_core::set_auto_reload_on_crash(true);

        if args.flag(b"--no-clear-screen") {
            let _ = bun_dotenv::HAS_NO_CLEAR_SCREEN_CLI_FLAG.set(true);
        }
    }

    if args.flag(b"--compile") {
        ctx.bundler_options.compile = true;
        ctx.bundler_options.inline_entrypoint_import_meta_main = true;
    }

    if let Some(compile_exec_argv) = args.option(b"--compile-exec-argv") {
        if !ctx.bundler_options.compile {
            Output::err_generic("--compile-exec-argv requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.compile_exec_argv = Some(compile_exec_argv.into());
    }

    // Handle --compile-autoload-dotenv flags
    {
        let has_positive = args.flag(b"--compile-autoload-dotenv");
        let has_negative = args.flag(b"--no-compile-autoload-dotenv");

        if has_positive || has_negative {
            if !ctx.bundler_options.compile {
                Output::err_generic("--compile-autoload-dotenv requires --compile", ());
                Global::crash();
            }
            if has_positive && has_negative {
                Output::err_generic(
                    "Cannot use both --compile-autoload-dotenv and --no-compile-autoload-dotenv",
                    (),
                );
                Global::crash();
            }
            ctx.bundler_options.compile_autoload_dotenv = has_positive;
        }
    }

    // Handle --compile-autoload-bunfig flags
    {
        let has_positive = args.flag(b"--compile-autoload-bunfig");
        let has_negative = args.flag(b"--no-compile-autoload-bunfig");

        if has_positive || has_negative {
            if !ctx.bundler_options.compile {
                Output::err_generic("--compile-autoload-bunfig requires --compile", ());
                Global::crash();
            }
            if has_positive && has_negative {
                Output::err_generic(
                    "Cannot use both --compile-autoload-bunfig and --no-compile-autoload-bunfig",
                    (),
                );
                Global::crash();
            }
            ctx.bundler_options.compile_autoload_bunfig = has_positive;
        }
    }

    // Handle --compile-autoload-tsconfig flags (default: false, tsconfig not loaded at runtime)
    {
        let has_positive = args.flag(b"--compile-autoload-tsconfig");
        let has_negative = args.flag(b"--no-compile-autoload-tsconfig");

        if has_positive || has_negative {
            if !ctx.bundler_options.compile {
                Output::err_generic("--compile-autoload-tsconfig requires --compile", ());
                Global::crash();
            }
            if has_positive && has_negative {
                Output::err_generic(
                    "Cannot use both --compile-autoload-tsconfig and --no-compile-autoload-tsconfig",
                    (),
                );
                Global::crash();
            }
            ctx.bundler_options.compile_autoload_tsconfig = has_positive;
        }
    }

    // Handle --compile-autoload-package-json flags (default: false, package.json not loaded at runtime)
    {
        let has_positive = args.flag(b"--compile-autoload-package-json");
        let has_negative = args.flag(b"--no-compile-autoload-package-json");

        if has_positive || has_negative {
            if !ctx.bundler_options.compile {
                Output::err_generic("--compile-autoload-package-json requires --compile", ());
                Global::crash();
            }
            if has_positive && has_negative {
                Output::err_generic(
                    "Cannot use both --compile-autoload-package-json and --no-compile-autoload-package-json",
                    (),
                );
                Global::crash();
            }
            ctx.bundler_options.compile_autoload_package_json = has_positive;
        }
    }

    if let Some(path) = args.option(b"--compile-executable-path") {
        if !ctx.bundler_options.compile {
            Output::err_generic("--compile-executable-path requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.compile_executable_path = Some(path.into());
    }

    if args.flag(b"--windows-hide-console") {
        // --windows-hide-console technically doesnt depend on WinAPI, but since since --windows-icon
        // does, all of these customization options have been gated to windows-only
        if !cfg!(windows) {
            Output::err_generic(
                "Using --windows-hide-console is only available when compiling on Windows",
                (),
            );
            Global::crash();
        }
        if ctx.bundler_options.compile_target.os != OperatingSystem::Windows {
            Output::err_generic(
                "--windows-hide-console requires a Windows compile target",
                (),
            );
            Global::crash();
        }
        if !ctx.bundler_options.compile {
            Output::err_generic("--windows-hide-console requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.windows.hide_console = true;
    }
    if let Some(path) = args.option(b"--windows-icon") {
        if !cfg!(windows) {
            Output::err_generic(
                "Using --windows-icon is only available when compiling on Windows",
                (),
            );
            Global::crash();
        }
        if ctx.bundler_options.compile_target.os != OperatingSystem::Windows {
            Output::err_generic("--windows-icon requires a Windows compile target", ());
            Global::crash();
        }
        if !ctx.bundler_options.compile {
            Output::err_generic("--windows-icon requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.windows.icon = Some(path.into());
    }
    if let Some(title) = args.option(b"--windows-title") {
        if !cfg!(windows) {
            Output::err_generic(
                "Using --windows-title is only available when compiling on Windows",
                (),
            );
            Global::crash();
        }
        if ctx.bundler_options.compile_target.os != OperatingSystem::Windows {
            Output::err_generic("--windows-title requires a Windows compile target", ());
            Global::crash();
        }
        if !ctx.bundler_options.compile {
            Output::err_generic("--windows-title requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.windows.title = Some(title.into());
    }
    if let Some(publisher) = args.option(b"--windows-publisher") {
        if !cfg!(windows) {
            Output::err_generic(
                "Using --windows-publisher is only available when compiling on Windows",
                (),
            );
            Global::crash();
        }
        if ctx.bundler_options.compile_target.os != OperatingSystem::Windows {
            Output::err_generic("--windows-publisher requires a Windows compile target", ());
            Global::crash();
        }
        if !ctx.bundler_options.compile {
            Output::err_generic("--windows-publisher requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.windows.publisher = Some(publisher.into());
    }
    if let Some(version) = args.option(b"--windows-version") {
        if !cfg!(windows) {
            Output::err_generic(
                "Using --windows-version is only available when compiling on Windows",
                (),
            );
            Global::crash();
        }
        if ctx.bundler_options.compile_target.os != OperatingSystem::Windows {
            Output::err_generic("--windows-version requires a Windows compile target", ());
            Global::crash();
        }
        if !ctx.bundler_options.compile {
            Output::err_generic("--windows-version requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.windows.version = Some(version.into());
    }
    if let Some(description) = args.option(b"--windows-description") {
        if !cfg!(windows) {
            Output::err_generic(
                "Using --windows-description is only available when compiling on Windows",
                (),
            );
            Global::crash();
        }
        if ctx.bundler_options.compile_target.os != OperatingSystem::Windows {
            Output::err_generic(
                "--windows-description requires a Windows compile target",
                (),
            );
            Global::crash();
        }
        if !ctx.bundler_options.compile {
            Output::err_generic("--windows-description requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.windows.description = Some(description.into());
    }
    if let Some(copyright) = args.option(b"--windows-copyright") {
        if !cfg!(windows) {
            Output::err_generic(
                "Using --windows-copyright is only available when compiling on Windows",
                (),
            );
            Global::crash();
        }
        if ctx.bundler_options.compile_target.os != OperatingSystem::Windows {
            Output::err_generic("--windows-copyright requires a Windows compile target", ());
            Global::crash();
        }
        if !ctx.bundler_options.compile {
            Output::err_generic("--windows-copyright requires --compile", ());
            Global::crash();
        }
        ctx.bundler_options.windows.copyright = Some(copyright.into());
    }

    if let Some(outdir) = args.option(b"--outdir") {
        if !outdir.is_empty() {
            ctx.bundler_options.outdir = outdir.into();
        }
    } else if let Some(outfile) = args.option(b"--outfile") {
        if !outfile.is_empty() {
            ctx.bundler_options.outfile = outfile.into();
        }
    }

    if let Some(metafile) = args.option(b"--metafile") {
        // If --metafile is passed without a value, default to "meta.json"
        ctx.bundler_options.metafile = if !metafile.is_empty() {
            Box::<[u8]>::from(metafile)
        } else {
            Box::<[u8]>::from(b"meta.json".as_slice())
        };
    }

    if let Some(metafile_md) = args.option(b"--metafile-md") {
        // If --metafile-md is passed without a value, default to "meta.md"
        ctx.bundler_options.metafile_md = if !metafile_md.is_empty() {
            Box::<[u8]>::from(metafile_md)
        } else {
            Box::<[u8]>::from(b"meta.md".as_slice())
        };
    }

    if let Some(root_dir) = args.option(b"--root") {
        if !root_dir.is_empty() {
            ctx.bundler_options.root_dir = root_dir.into();
        }
    }

    if let Some(format_str) = args.option(b"--format") {
        let Some(format) = options::Format::from_string(format_str) else {
            Output::err_generic("Invalid format - must be esm, cjs, or iife", ());
            Global::crash();
        };

        match format {
            options::Format::InternalBakeDev => {
                Output::warn(format_args!(
                    "--format={} is for debugging only, and may experience breaking changes at any moment",
                    BStr::new(format_str)
                ));
                Output::flush();
            }
            options::Format::Cjs => {
                if ctx.args.target.is_none() {
                    ctx.args.target = Some(api::Target::Node);
                }
            }
            _ => {}
        }

        ctx.bundler_options.output_format = format;
        if ctx.bundler_options.bytecode {
            if format != options::Format::Cjs && format != options::Format::Esm {
                Output::err_generic("format must be 'cjs' or 'esm' when bytecode is true.", ());
                Global::exit(1);
            }
            // ESM bytecode requires --compile because module_info (import/export metadata)
            // is only available in compiled binaries. Without it, JSC must parse the file
            // twice (once for module analysis, once for bytecode), which is a deopt.
            if format == options::Format::Esm && !ctx.bundler_options.compile {
                Output::err_generic(
                    "ESM bytecode requires --compile. Use --format=cjs for bytecode without --compile.",
                    (),
                );
                Global::exit(1);
            }
        }
    }

    if args.flag(b"--splitting") {
        ctx.bundler_options.code_splitting = true;
    }

    if let Some(entry_naming) = args.option(b"--entry-naming") {
        ctx.bundler_options.entry_naming =
            strings::concat(&[b"./", strings::remove_leading_dot_slash(entry_naming)]);
    }

    if let Some(chunk_naming) = args.option(b"--chunk-naming") {
        ctx.bundler_options.chunk_naming =
            strings::concat(&[b"./", strings::remove_leading_dot_slash(chunk_naming)]);
    }

    if let Some(asset_naming) = args.option(b"--asset-naming") {
        ctx.bundler_options.asset_naming =
            strings::concat(&[b"./", strings::remove_leading_dot_slash(asset_naming)]);
    }

    if args.flag(b"--server-components") {
        ctx.bundler_options.server_components = true;
        if let Some(target) = opts.target {
            if !<bun_ast::Target as bun_options_types::TargetExt>::from_api(Some(target))
                .is_server_side()
            {
                Output::err_generic(
                    "Cannot use client-side --target={} with --server-components",
                    format_args!(
                        "{:?}",
                        <bun_ast::Target as bun_options_types::TargetExt>::from_api(Some(
                            target
                        ))
                    ),
                );
                Global::crash();
            } else {
                opts.target = Some(api::Target::Bun);
            }
        }
    }

    if args.flag(b"--react-fast-refresh") {
        ctx.bundler_options.react_fast_refresh = true;
    }

    if let Some(setting) = args.option(b"--sourcemap") {
        if setting.is_empty() {
            // In the future, Bun is going to make this default to .linked
            opts.source_map = Some(api::SourceMap::Linked);
        } else if setting == b"inline" {
            opts.source_map = Some(api::SourceMap::Inline);
        } else if setting == b"none" {
            opts.source_map = Some(api::SourceMap::None);
        } else if setting == b"external" {
            opts.source_map = Some(api::SourceMap::External);
        } else if setting == b"linked" {
            opts.source_map = Some(api::SourceMap::Linked);
        } else {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: Invalid sourcemap setting: \"{}\"",
                BStr::new(setting)
            ));
            Global::crash();
        }

        // when using --compile, only `external` works, as we do not
        // look at the source map comment. so after we validate the
        // user's choice was in the list, we secretly override it
        if ctx.bundler_options.compile {
            opts.source_map = Some(api::SourceMap::External);
        }
    }
}

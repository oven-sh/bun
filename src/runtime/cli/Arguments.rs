use bun_core::{Global, Output, FeatureFlags, Environment};
use bun_core::env_var;
use bun_cli as cli;
use crate::cli::{Command, DefineColonList, LoaderColonList, debug_flags, print_revision_and_exit, print_version_and_exit};
use crate::cli::Bunfig;
use bun_clap as clap;
use bun_logger as logger;
use bun_bundler::options;
use bun_paths as resolve_path;
use bun_paths::PathBuffer;
use bun_str::strings;
use bun_str::ZStr;
use bun_schema::api as api;
use bun_js_parser as js_ast;
use bun_jsc::RegularExpression;
use bun_alloc::AllocError;
use bstr::BStr;

// TODO(port): narrow error set
pub fn loader_resolver(input: &[u8]) -> Result<api::Loader, bun_core::Error> {
    let option_loader = options::Loader::from_string(input).ok_or(bun_core::err!("InvalidLoader"))?;
    Ok(option_loader.to_api())
}

// TODO(port): narrow error set
pub fn noop_resolver(input: &[u8]) -> Result<&[u8], bun_core::Error> {
    Ok(input)
}

pub fn file_read_error(err: bun_core::Error, stderr: &mut impl std::io::Write, filename: &[u8], kind: &[u8]) -> ! {
    let _ = write!(stderr, "Error reading file \"{}\" for {}: {}", BStr::new(filename), BStr::new(kind), err.name());
    // TODO(port): std::process is banned; use bun_core::Global::exit
    Global::exit(1);
}

// TODO(port): this fn uses std.fs.path.resolve / std.posix.toPosixPath / std.fs.File directly in
// the Zig source, which is itself non-idiomatic for the Bun codebase. Port to bun_sys::File.
pub fn read_file(cwd: &[u8], filename: &[u8]) -> Result<Vec<u8>, bun_core::Error> {
    let paths: [&[u8]; 2] = [cwd, filename];
    // TODO(port): std.fs.path.resolve equivalent
    let outpath = bun_paths::resolve(&paths)?;
    let file = bun_sys::File::open_z(&bun_sys::to_posix_path(&outpath)?, bun_sys::OpenFlags::READ_ONLY)?;
    // file closed on Drop
    let size = file.get_end_pos()?;
    file.read_to_end_alloc(size)
}

// TODO(port): narrow error set
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

// TODO(port): Zig builds these arrays at comptime via `clap.parseParam("...") catch unreachable`
// concatenated with `++`. In Rust we need either a const-fn parser or a build-time macro. The
// `clap::parse_param!` macro below is assumed to expand to a `ParamType` at compile time;
// concatenation is done with the `concat_params!` helper macro. Phase B: verify bun_clap exposes
// these.

#[cfg(feature = "show_crash_trace")]
macro_rules! maybe_debug_params { () => { DEBUG_PARAMS }; }
#[cfg(not(feature = "show_crash_trace"))]
macro_rules! maybe_debug_params { () => { [] }; }

// TODO(port): builtin.have_error_return_tracing has no direct Rust analogue (Zig-specific);
// gate behind a debug feature.
#[cfg(feature = "error_return_tracing")]
macro_rules! maybe_verbose_error_trace { () => { [clap::parse_param!("--verbose-error-trace             Dump error return traces")] }; }
#[cfg(not(feature = "error_return_tracing"))]
macro_rules! maybe_verbose_error_trace { () => { [] }; }

pub static BASE_PARAMS_: &[ParamType] = clap::concat_params!(
    maybe_debug_params!(),
    [
        clap::parse_param!("--env-file <STR>...               Load environment variables from the specified file(s)"),
        clap::parse_param!("--no-env-file                     Disable automatic loading of .env files"),
        clap::parse_param!("--cwd <STR>                       Absolute path to resolve files & entry points from. This just changes the process' cwd."),
        clap::parse_param!("-c, --config <PATH>?              Specify path to Bun config file. Default <d>$cwd<r>/bunfig.toml"),
        clap::parse_param!("-h, --help                        Display this menu and exit"),
    ],
    maybe_verbose_error_trace!(),
    [
        clap::parse_param!("<POS>..."),
    ],
);

static DEBUG_PARAMS: &[ParamType] = &[
    clap::parse_param!("--breakpoint-resolve <STR>...     DEBUG MODE: breakpoint when resolving something that includes this string"),
    clap::parse_param!("--breakpoint-print <STR>...       DEBUG MODE: breakpoint when printing something that includes this string"),
];

pub static TRANSPILER_PARAMS_: &[ParamType] = &[
    clap::parse_param!("--main-fields <STR>...             Main fields to lookup in package.json. Defaults to --target dependent"),
    clap::parse_param!("--preserve-symlinks               Preserve symlinks when resolving files"),
    clap::parse_param!("--preserve-symlinks-main          Preserve symlinks when resolving the main entry point"),
    clap::parse_param!("--extension-order <STR>...        Defaults to: .tsx,.ts,.jsx,.js,.json "),
    clap::parse_param!("--tsconfig-override <STR>          Specify custom tsconfig.json. Default <d>$cwd<r>/tsconfig.json"),
    clap::parse_param!("-d, --define <STR>...              Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\". Values are parsed as JSON."),
    clap::parse_param!("--drop <STR>...                   Remove function calls, e.g. --drop=console removes all console.* calls."),
    clap::parse_param!("--feature <STR>...               Enable a feature flag for dead-code elimination, e.g. --feature=SUPER_SECRET"),
    clap::parse_param!("-l, --loader <STR>...             Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi"),
    clap::parse_param!("--no-macros                       Disable macros from being executed in the bundler, transpiler and runtime"),
    clap::parse_param!("--jsx-factory <STR>               Changes the function called when compiling JSX elements using the classic JSX runtime"),
    clap::parse_param!("--jsx-fragment <STR>              Changes the function called when compiling JSX fragments"),
    clap::parse_param!("--jsx-import-source <STR>         Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: \"react\""),
    clap::parse_param!("--jsx-runtime <STR>               \"automatic\" (default) or \"classic\""),
    clap::parse_param!("--jsx-side-effects                Treat JSX elements as having side effects (disable pure annotations)"),
    clap::parse_param!("--ignore-dce-annotations          Ignore tree-shaking annotations such as @__PURE__"),
];

pub static RUNTIME_PARAMS_: &[ParamType] = &[
    clap::parse_param!("--watch                           Automatically restart the process on file change"),
    clap::parse_param!("--hot                             Enable auto reload in the Bun runtime, test runner, or bundler"),
    clap::parse_param!("--no-clear-screen                 Disable clearing the terminal screen on reload when --hot or --watch is enabled"),
    clap::parse_param!("--smol                            Use less memory, but run garbage collection more often"),
    clap::parse_param!("-r, --preload <STR>...            Import a module before other modules are loaded"),
    clap::parse_param!("--require <STR>...                Alias of --preload, for Node.js compatibility"),
    clap::parse_param!("--import <STR>...                 Alias of --preload, for Node.js compatibility"),
    clap::parse_param!("--inspect <STR>?                  Activate Bun's debugger"),
    clap::parse_param!("--inspect-wait <STR>?             Activate Bun's debugger, wait for a connection before executing"),
    clap::parse_param!("--inspect-brk <STR>?              Activate Bun's debugger, set breakpoint on first line of code and wait"),
    clap::parse_param!("--cpu-prof                        Start CPU profiler and write profile to disk on exit"),
    clap::parse_param!("--cpu-prof-name <STR>             Specify the name of the CPU profile file"),
    clap::parse_param!("--cpu-prof-dir <STR>              Specify the directory where the CPU profile will be saved"),
    clap::parse_param!("--cpu-prof-md                     Output CPU profile in markdown format (grep-friendly, designed for LLM analysis)"),
    clap::parse_param!("--cpu-prof-interval <STR>         Specify the sampling interval in microseconds for CPU profiling (default: 1000)"),
    clap::parse_param!("--heap-prof                       Generate V8 heap snapshot on exit (.heapsnapshot)"),
    clap::parse_param!("--heap-prof-name <STR>            Specify the name of the heap profile file"),
    clap::parse_param!("--heap-prof-dir <STR>             Specify the directory where the heap profile will be saved"),
    clap::parse_param!("--heap-prof-md                    Generate markdown heap profile on exit (for CLI analysis)"),
    clap::parse_param!("--if-present                      Exit without an error if the entrypoint does not exist"),
    clap::parse_param!("--no-install                      Disable auto install in the Bun runtime"),
    clap::parse_param!("--install <STR>                   Configure auto-install behavior. One of \"auto\" (default, auto-installs when no node_modules), \"fallback\" (missing packages only), \"force\" (always)."),
    clap::parse_param!("-i                                Auto-install dependencies during execution. Equivalent to --install=fallback."),
    clap::parse_param!("-e, --eval <STR>                  Evaluate argument as a script"),
    clap::parse_param!("-p, --print <STR>                 Evaluate argument as a script and print the result"),
    clap::parse_param!("--prefer-offline                  Skip staleness checks for packages in the Bun runtime and resolve from disk"),
    clap::parse_param!("--prefer-latest                   Use the latest matching versions of packages in the Bun runtime, always checking npm"),
    clap::parse_param!("--port <STR>                      Set the default port for Bun.serve"),
    clap::parse_param!("-u, --origin <STR>"),
    clap::parse_param!("--conditions <STR>...             Pass custom conditions to resolve"),
    clap::parse_param!("--fetch-preconnect <STR>...       Preconnect to a URL while code is loading"),
    clap::parse_param!("--experimental-http2-fetch        Offer h2 in fetch() TLS ALPN. Same as BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1"),
    clap::parse_param!("--experimental-http3-fetch        Honor Alt-Svc: h3 in fetch() and upgrade to HTTP/3. Same as BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT=1"),
    clap::parse_param!("--max-http-header-size <INT>      Set the maximum size of HTTP headers in bytes. Default is 16KiB"),
    clap::parse_param!("--dns-result-order <STR>          Set the default order of DNS lookup results. Valid orders: verbatim (default), ipv4first, ipv6first"),
    clap::parse_param!("--expose-gc                       Expose gc() on the global object. Has no effect on Bun.gc()."),
    clap::parse_param!("--no-deprecation                  Suppress all reporting of the custom deprecation."),
    clap::parse_param!("--throw-deprecation               Determine whether or not deprecation warnings result in errors."),
    clap::parse_param!("--title <STR>                     Set the process title"),
    clap::parse_param!("--zero-fill-buffers                Boolean to force Buffer.allocUnsafe(size) to be zero-filled."),
    clap::parse_param!("--use-system-ca                   Use the system's trusted certificate authorities"),
    clap::parse_param!("--use-openssl-ca                  Use OpenSSL's default CA store"),
    clap::parse_param!("--use-bundled-ca                  Use bundled CA store"),
    clap::parse_param!("--redis-preconnect                Preconnect to $REDIS_URL at startup"),
    clap::parse_param!("--sql-preconnect                  Preconnect to PostgreSQL at startup"),
    clap::parse_param!("--no-addons                       Throw an error if process.dlopen is called, and disable export condition \"node-addons\""),
    clap::parse_param!("--unhandled-rejections <STR>      One of \"strict\", \"throw\", \"warn\", \"none\", or \"warn-with-error-code\""),
    clap::parse_param!("--console-depth <NUMBER>          Set the default depth for console.log object inspection (default: 2)"),
    clap::parse_param!("--user-agent <STR>               Set the default User-Agent header for HTTP requests"),
    clap::parse_param!("--cron-title <STR>               Title for cron execution mode"),
    clap::parse_param!("--cron-period <STR>              Cron period for cron execution mode"),
];

pub static AUTO_OR_RUN_PARAMS: &[ParamType] = &[
    clap::parse_param!("-F, --filter <STR>...             Run a script in all workspace packages matching the pattern"),
    clap::parse_param!("-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)"),
    clap::parse_param!("--no-orphans                      Exit when the parent process dies, and on exit SIGKILL every descendant. Linux/macOS only."),
    clap::parse_param!("--shell <STR>                     Control the shell used for package.json scripts. Supports either 'bun' or 'system'"),
    clap::parse_param!("--workspaces                      Run a script in all workspace packages (from the \"workspaces\" field in package.json)"),
    clap::parse_param!("--parallel                        Run multiple scripts concurrently with Foreman-style output"),
    clap::parse_param!("--sequential                      Run multiple scripts sequentially with Foreman-style output"),
    clap::parse_param!("--no-exit-on-error                Continue running other scripts when one fails (with --parallel/--sequential)"),
];

pub static AUTO_ONLY_PARAMS: &[ParamType] = clap::concat_params!(
    [
        // clap::parse_param!("--all"),
        clap::parse_param!("--silent                          Don't print the script command"),
        clap::parse_param!("--elide-lines <NUMBER>            Number of lines of script output shown when using --filter (default: 10). Set to 0 to show all lines."),
        clap::parse_param!("-v, --version                     Print version and exit"),
        clap::parse_param!("--revision                        Print version with revision and exit"),
    ],
    AUTO_OR_RUN_PARAMS,
);
pub static AUTO_PARAMS: &[ParamType] = clap::concat_params!(AUTO_ONLY_PARAMS, RUNTIME_PARAMS_, TRANSPILER_PARAMS_, BASE_PARAMS_);

pub static RUN_ONLY_PARAMS: &[ParamType] = clap::concat_params!(
    [
        clap::parse_param!("--silent                          Don't print the script command"),
        clap::parse_param!("--elide-lines <NUMBER>            Number of lines of script output shown when using --filter (default: 10). Set to 0 to show all lines."),
    ],
    AUTO_OR_RUN_PARAMS,
);
pub static RUN_PARAMS: &[ParamType] = clap::concat_params!(RUN_ONLY_PARAMS, RUNTIME_PARAMS_, TRANSPILER_PARAMS_, BASE_PARAMS_);

pub static BUNX_COMMANDS: &[ParamType] = clap::concat_params!(
    [
        clap::parse_param!("-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)"),
    ],
    AUTO_ONLY_PARAMS,
);

#[cfg(feature = "bake_debugging_features")]
macro_rules! maybe_bake_debug_params {
    () => {
        [
            clap::parse_param!("--debug-dump-server-files        When --app is set, dump all server files to disk even when building statically"),
            clap::parse_param!("--debug-no-minify                When --app is set, do not minify anything"),
        ]
    };
}
#[cfg(not(feature = "bake_debugging_features"))]
macro_rules! maybe_bake_debug_params { () => { [] }; }

pub static BUILD_ONLY_PARAMS: &[ParamType] = clap::concat_params!(
    [
        clap::parse_param!("--production                     Set NODE_ENV=production and enable minification"),
        clap::parse_param!("--compile                        Generate a standalone Bun executable containing your bundled code. Implies --production"),
        clap::parse_param!("--compile-exec-argv <STR>       Prepend arguments to the standalone executable's execArgv"),
        clap::parse_param!("--compile-autoload-dotenv        Enable autoloading of .env files in standalone executable (default: true)"),
        clap::parse_param!("--no-compile-autoload-dotenv     Disable autoloading of .env files in standalone executable"),
        clap::parse_param!("--compile-autoload-bunfig        Enable autoloading of bunfig.toml in standalone executable (default: true)"),
        clap::parse_param!("--no-compile-autoload-bunfig     Disable autoloading of bunfig.toml in standalone executable"),
        clap::parse_param!("--compile-autoload-tsconfig      Enable autoloading of tsconfig.json at runtime in standalone executable (default: false)"),
        clap::parse_param!("--no-compile-autoload-tsconfig   Disable autoloading of tsconfig.json at runtime in standalone executable"),
        clap::parse_param!("--compile-autoload-package-json  Enable autoloading of package.json at runtime in standalone executable (default: false)"),
        clap::parse_param!("--no-compile-autoload-package-json Disable autoloading of package.json at runtime in standalone executable"),
        clap::parse_param!("--compile-executable-path <STR>  Path to a Bun executable to use for cross-compilation instead of downloading"),
        clap::parse_param!("--bytecode                       Use a bytecode cache"),
        clap::parse_param!("--watch                          Automatically restart the process on file change"),
        clap::parse_param!("--no-clear-screen                Disable clearing the terminal screen on reload when --watch is enabled"),
        clap::parse_param!("--target <STR>                   The intended execution environment for the bundle. \"browser\", \"bun\" or \"node\""),
        clap::parse_param!("--outdir <STR>                   Default to \"dist\" if multiple files"),
        clap::parse_param!("--outfile <STR>                  Write to a file"),
        clap::parse_param!("--metafile <STR>?                Write a JSON file with metadata about the build"),
        clap::parse_param!("--metafile-md <STR>?             Write a markdown file with a visualization of the module graph (LLM-friendly)"),
        clap::parse_param!("--sourcemap <STR>?               Build with sourcemaps - 'linked', 'inline', 'external', or 'none'"),
        clap::parse_param!("--banner <STR>                   Add a banner to the bundled output such as \"use client\"; for a bundle being used with RSCs"),
        clap::parse_param!("--footer <STR>                   Add a footer to the bundled output such as // built with bun!"),
        clap::parse_param!("--format <STR>                   Specifies the module format to build to. \"esm\", \"cjs\" and \"iife\" are supported. Defaults to \"esm\", or \"cjs\" with --bytecode."),
        clap::parse_param!("--root <STR>                     Root directory used for multiple entry points"),
        clap::parse_param!("--splitting                      Enable code splitting"),
        clap::parse_param!("--public-path <STR>              A prefix to be appended to any import paths in bundled code"),
        clap::parse_param!("-e, --external <STR>...          Exclude module from transpilation (can use * wildcards). ex: -e react"),
        clap::parse_param!("--allow-unresolved <STR>...      Allow unresolved dynamic import()/require() specifiers matching these glob patterns. Use '<empty>' for opaque specifiers. Default is '*' (allow all)."),
        clap::parse_param!("--reject-unresolved              Fail the build on any dynamic import()/require() specifier that cannot be resolved at build time."),
        clap::parse_param!("--packages <STR>                 Add dependencies to bundle or keep them external. \"external\", \"bundle\" is supported. Defaults to \"bundle\"."),
        clap::parse_param!("--entry-naming <STR>             Customize entry point filenames. Defaults to \"[dir]/[name].[ext]\""),
        clap::parse_param!("--chunk-naming <STR>             Customize chunk filenames. Defaults to \"[name]-[hash].[ext]\""),
        clap::parse_param!("--asset-naming <STR>             Customize asset filenames. Defaults to \"[name]-[hash].[ext]\""),
        clap::parse_param!("--react-fast-refresh             Enable React Fast Refresh transform (does not emit hot-module code, use this for testing)"),
        clap::parse_param!("--no-bundle                      Transpile file only, do not bundle"),
        clap::parse_param!("--emit-dce-annotations           Re-emit DCE annotations in bundles. Enabled by default unless --minify-whitespace is passed."),
        clap::parse_param!("--minify                         Enable all minification flags"),
        clap::parse_param!("--minify-syntax                  Minify syntax and inline data"),
        clap::parse_param!("--minify-whitespace              Minify whitespace"),
        clap::parse_param!("--minify-identifiers             Minify identifiers"),
        clap::parse_param!("--keep-names                     Preserve original function and class names when minifying"),
        clap::parse_param!("--css-chunking                   Chunk CSS files together to reduce duplicated CSS loaded in a browser. Only has an effect when multiple entrypoints import CSS"),
        clap::parse_param!("--dump-environment-variables"),
        clap::parse_param!("--conditions <STR>...            Pass custom conditions to resolve"),
        clap::parse_param!("--app                            (EXPERIMENTAL) Build a web app for production using Bun Bake."),
        clap::parse_param!("--server-components              (EXPERIMENTAL) Enable server components"),
        clap::parse_param!("--env <inline|prefix*|disable>   Inline environment variables into the bundle as process.env.${name}. Defaults to 'disable'. To inline environment variables matching a prefix, use my prefix like 'FOO_PUBLIC_*'."),
        clap::parse_param!("--windows-hide-console           When using --compile targeting Windows, prevent a Command prompt from opening alongside the executable"),
        clap::parse_param!("--windows-icon <STR>             When using --compile targeting Windows, assign an executable icon"),
        clap::parse_param!("--windows-title <STR>            When using --compile targeting Windows, set the executable product name"),
        clap::parse_param!("--windows-publisher <STR>        When using --compile targeting Windows, set the executable company name"),
        clap::parse_param!("--windows-version <STR>          When using --compile targeting Windows, set the executable version (e.g. 1.2.3.4)"),
        clap::parse_param!("--windows-description <STR>      When using --compile targeting Windows, set the executable description"),
        clap::parse_param!("--windows-copyright <STR>        When using --compile targeting Windows, set the executable copyright"),
    ],
    maybe_bake_debug_params!(),
);
pub static BUILD_PARAMS: &[ParamType] = clap::concat_params!(BUILD_ONLY_PARAMS, TRANSPILER_PARAMS_, BASE_PARAMS_);

// TODO: update test completions
pub static TEST_ONLY_PARAMS: &[ParamType] = &[
    clap::parse_param!("--no-orphans                     Exit when the parent process dies, and on exit SIGKILL every descendant. Linux/macOS only."),
    clap::parse_param!("--timeout <NUMBER>               Set the per-test timeout in milliseconds, default is 5000."),
    clap::parse_param!("-u, --update-snapshots           Update snapshot files"),
    clap::parse_param!("--rerun-each <NUMBER>            Re-run each test file <NUMBER> times, helps catch certain bugs"),
    clap::parse_param!("--retry <NUMBER>                 Default retry count for all tests, overridden by per-test { retry: N }"),
    clap::parse_param!("--todo                           Include tests that are marked with \"test.todo()\""),
    clap::parse_param!("--only                           Run only tests that are marked with \"test.only()\" or \"describe.only()\""),
    clap::parse_param!("--pass-with-no-tests             Exit with code 0 when no tests are found"),
    clap::parse_param!("--concurrent                     Treat all tests as `test.concurrent()` tests"),
    clap::parse_param!("--randomize                      Run tests in random order"),
    clap::parse_param!("--seed <INT>                     Set the random seed for test randomization"),
    clap::parse_param!("--coverage                       Generate a coverage profile"),
    clap::parse_param!("--coverage-reporter <STR>...     Report coverage in 'text' and/or 'lcov'. Defaults to 'text'."),
    clap::parse_param!("--coverage-dir <STR>             Directory for coverage files. Defaults to 'coverage'."),
    clap::parse_param!("--bail <NUMBER>?                 Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1."),
    clap::parse_param!("-t, --test-name-pattern/--grep <STR>    Run only tests with a name that matches the given regex."),
    clap::parse_param!("--reporter <STR>                 Test output reporter format. Available: 'junit' (requires --reporter-outfile), 'dots'. Default: console output."),
    clap::parse_param!("--reporter-outfile <STR>         Output file path for the reporter format (required with --reporter)."),
    clap::parse_param!("--dots                           Enable dots reporter. Shorthand for --reporter=dots."),
    clap::parse_param!("--only-failures                  Only display test failures, hiding passing tests."),
    clap::parse_param!("--max-concurrency <NUMBER>        Maximum number of concurrent tests to execute at once. Default is 20."),
    clap::parse_param!("--path-ignore-patterns <STR>...   Glob patterns for test file paths to ignore."),
    clap::parse_param!("--changed <STR>?                 Only run test files affected by changed files according to git. Optionally pass a commit or branch to compare against."),
    clap::parse_param!("--isolate                        Run each test file in a fresh global object. Leaked handles from one file cannot affect another."),
    clap::parse_param!("--parallel <NUMBER>?             Run test files in parallel using N worker processes. Implies --isolate. Defaults to CPU core count."),
    clap::parse_param!("--parallel-delay <NUMBER>        Milliseconds the first --parallel worker must be busy before spawning the rest. 0 spawns all immediately. Default 5."),
    clap::parse_param!("--test-worker                    (internal) Run as a --parallel worker, receiving files over IPC."),
    clap::parse_param!("--shard <STR>                    Run a subset of test files, e.g. '--shard=1/3' runs the first of three shards. Useful for splitting tests across multiple CI jobs."),
];
pub static TEST_PARAMS: &[ParamType] = clap::concat_params!(TEST_ONLY_PARAMS, RUNTIME_PARAMS_, TRANSPILER_PARAMS_, BASE_PARAMS_);

fn load_global_bunfig<const CMD: Command::Tag>(ctx: &mut Command::Context) -> Result<(), bun_core::Error> {
    if ctx.has_loaded_global_config {
        return Ok(());
    }

    ctx.has_loaded_global_config = true;

    let mut config_buf = PathBuffer::uninit();
    if let Some(path) = get_home_config_path(&mut config_buf) {
        load_bunfig::<CMD>(true, path, ctx)?;
    }
    Ok(())
}

pub fn load_config_path<const CMD: Command::Tag>(
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: &mut Command::Context,
) -> Result<(), bun_core::Error> {
    if const { CMD.read_global_config() } {
        if let Err(err) = load_global_bunfig::<CMD>(ctx) {
            if auto_loaded {
                return Ok(());
            }

            Output::pretty_errorln(format_args!(
                "{}\nreading global config \"{}\"",
                err.name(),
                BStr::new(config_path.as_bytes()),
            ));
            Global::exit(1);
        }
    }

    load_bunfig::<CMD>(auto_loaded, config_path, ctx)
}

fn load_bunfig<const CMD: Command::Tag>(
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: &mut Command::Context,
) -> Result<(), bun_core::Error> {
    let source = match bun_sys::File::to_source(config_path, bun_sys::ToSourceOptions { convert_bom: true }) {
        bun_sys::Result::Ok(s) => s,
        bun_sys::Result::Err(err) => {
            if auto_loaded {
                return Ok(());
            }
            Output::pretty_errorln(format_args!(
                "{}\nwhile reading config \"{}\"",
                err,
                BStr::new(config_path.as_bytes()),
            ));
            Global::exit(1);
        }
    };
    js_ast::Stmt::data::Store::create();
    js_ast::Expr::data::Store::create();
    let _store_reset = scopeguard::guard((), |_| {
        js_ast::Stmt::data::Store::reset();
        js_ast::Expr::data::Store::reset();
    });
    let original_level = ctx.log.level;
    let _level_reset = scopeguard::guard(original_level, |lvl| {
        // TODO(port): borrow of ctx.log inside guard closure may need reshaping
        ctx.log.level = lvl;
    });
    ctx.log.level = logger::Log::Level::Warn;
    ctx.debug.loaded_bunfig = true;
    Bunfig::parse::<CMD>(&source, ctx)
}

fn get_home_config_path(buf: &mut PathBuffer) -> Option<&ZStr> {
    let paths: [&[u8]; 1] = [b".bunfig.toml"];

    if let Some(data_dir) = env_var::XDG_CONFIG_HOME.get() {
        return Some(resolve_path::join_abs_string_buf_z(data_dir, buf, &paths, resolve_path::Platform::Auto));
    }

    if let Some(home_dir) = env_var::HOME.get() {
        return Some(resolve_path::join_abs_string_buf_z(home_dir, buf, &paths, resolve_path::Platform::Auto));
    }

    None
}

pub fn load_config<const CMD: Command::Tag>(
    user_config_path_: Option<&[u8]>,
    ctx: &mut Command::Context,
) -> Result<(), AllocError> {
    // If running as a standalone executable with autoloadBunfig disabled, skip config loading
    // unless an explicit config path was provided via --config
    if user_config_path_.is_none() {
        if let Some(graph) = bun_standalone::StandaloneModuleGraph::get() {
            if graph.flags.disable_autoload_bunfig {
                return Ok(());
            }
        }
    }

    let mut config_buf = PathBuffer::uninit();
    if const { CMD.read_global_config() } {
        if !ctx.has_loaded_global_config {
            ctx.has_loaded_global_config = true;

            if let Some(path) = get_home_config_path(&mut config_buf) {
                if let Err(err) = load_config_path::<CMD>(true, path, ctx) {
                    if ctx.log.has_any() {
                        let _ = ctx.log.print(Output::error_writer());
                    }
                    if ctx.log.has_any() {
                        Output::print_error("\n", format_args!(""));
                    }
                    Output::err(err, "failed to load bunfig", format_args!(""));
                    Global::crash();
                }
            }
        }
    }

    let mut config_path_: &[u8] = user_config_path_.unwrap_or(b"");

    let mut auto_loaded: bool = false;
    if config_path_.is_empty()
        && (user_config_path_.is_some()
            || Command::Tag::ALWAYS_LOADS_CONFIG.get(CMD)
            || (CMD == Command::Tag::AutoCommand
                && (
                    // "bun"
                    ctx.positionals.is_empty()
                        // "bun file.js"
                        || (!ctx.positionals.is_empty()
                            && options::DEFAULT_LOADERS.has(bun_paths::extension(ctx.positionals[0])))
                )))
    {
        config_path_ = b"bunfig.toml";
        auto_loaded = true;
    }

    if config_path_.is_empty() {
        return Ok(());
    }
    let config_path: &mut ZStr;
    if config_path_[0] == b'/' {
        config_buf[..config_path_.len()].copy_from_slice(config_path_);
        config_buf[config_path_.len()] = 0;
        // SAFETY: buf[len] == 0 written above
        config_path = unsafe { ZStr::from_raw_mut(config_buf.as_mut_ptr(), config_path_.len()) };
    } else {
        if ctx.args.absolute_working_dir.is_none() {
            let mut secondbuf = PathBuffer::uninit();
            let Ok(cwd) = bun_sys::getcwd(&mut secondbuf) else {
                return Ok(());
            };

            ctx.args.absolute_working_dir = Some(bun_str::ZStr::from_bytes(cwd)?);
        }

        let awd = ctx.args.absolute_working_dir.as_ref().unwrap();
        let parts: [&[u8]; 2] = [awd.as_bytes(), config_path_];
        let joined = resolve_path::join_abs_string_buf(
            awd.as_bytes(),
            &mut config_buf,
            &parts,
            resolve_path::Platform::Auto,
        );
        let joined_len = joined.len();
        config_buf[joined_len] = 0;
        // SAFETY: buf[len] == 0 written above
        config_path = unsafe { ZStr::from_raw_mut(config_buf.as_mut_ptr(), joined_len) };
    }

    if let Err(err) = load_config_path::<CMD>(auto_loaded, config_path, ctx) {
        if ctx.log.has_any() {
            let _ = ctx.log.print(Output::error_writer());
        }
        if ctx.log.has_any() {
            Output::print_error("\n", format_args!(""));
        }
        Output::err(err, "failed to load bunfig", format_args!(""));
        Global::crash();
    }
    Ok(())
}

pub fn load_config_with_cmd_args<const CMD: Command::Tag>(
    args: &clap::Args<clap::Help>,
    ctx: &mut Command::Context,
) -> Result<(), AllocError> {
    load_config::<CMD>(args.option("--config"), ctx)
}

// TODO(port): narrow error set
pub fn parse<const CMD: Command::Tag>(ctx: &mut Command::Context) -> Result<api::TransformOptions, bun_core::Error> {
    let mut diag = clap::Diagnostic::default();
    let params_to_parse = const { CMD.params() };

    let args = match clap::parse::<clap::Help>(
        params_to_parse,
        clap::ParseOptions {
            diagnostic: Some(&mut diag),
            stop_after_positional_at: match CMD {
                Command::Tag::RunCommand => 2,
                Command::Tag::AutoCommand | Command::Tag::RunAsNodeCommand => 1,
                _ => 0,
            },
        },
    ) {
        Ok(a) => a,
        Err(err) => {
            // Report useful error and exit
            let _ = diag.report(Output::error_writer(), err);
            CMD.print_help(false);
            Global::exit(1);
        }
    };

    let print_help = args.flag("--help");
    if print_help {
        CMD.print_help(true);
        Output::flush();
        Global::exit(0);
    }

    if CMD == Command::Tag::AutoCommand {
        if args.flag("--version") {
            print_version_and_exit();
        }

        if args.flag("--revision") {
            print_revision_and_exit();
        }
    }

    #[cfg(feature = "error_return_tracing")]
    {
        if args.flag("--verbose-error-trace") {
            bun_crash_handler::set_verbose_error_trace(true);
        }
    }

    let cwd: Box<ZStr>;
    if let Some(cwd_arg) = args.option("--cwd") {
        cwd = 'brk: {
            let mut outbuf = PathBuffer::uninit();
            let out = bun_paths::join_abs(bun_sys::getcwd(&mut outbuf)?, bun_paths::Platform::Loose, cwd_arg);
            match bun_sys::chdir(b"", out) {
                bun_sys::Result::Ok(()) => {}
                bun_sys::Result::Err(err) => {
                    Output::err(err, "Could not change directory to \"{}\"\n", format_args!("{}", BStr::new(cwd_arg)));
                    Global::exit(1);
                }
            }
            break 'brk bun_str::ZStr::from_bytes(out)?;
        };
    } else {
        cwd = bun_sys::getcwd_alloc()?;
    }

    // Not gated on .BunxCommand: bunx skips Arguments.parse entirely
    // (uses_global_options=false). bunx picks up no-orphans via the
    // BUN_FEATURE_FLAG_NO_ORPHANS env var in main()→install() instead.
    if matches!(CMD, Command::Tag::RunCommand | Command::Tag::AutoCommand | Command::Tag::TestCommand) {
        if args.flag("--no-orphans") {
            bun_core::ParentDeathWatchdog::enable();
        }
    }

    if matches!(CMD, Command::Tag::RunCommand | Command::Tag::AutoCommand) {
        ctx.filters = args.options("--filter");
        ctx.workspaces = args.flag("--workspaces");
        ctx.if_present = args.flag("--if-present");
        ctx.parallel = args.flag("--parallel");
        ctx.sequential = args.flag("--sequential");
        ctx.no_exit_on_error = args.flag("--no-exit-on-error");

        if let Some(elide_lines) = args.option("--elide-lines") {
            if !elide_lines.is_empty() {
                ctx.bundler_options.elide_lines = match bun_str::parse_int::<usize>(elide_lines, 10) {
                    Ok(v) => v,
                    Err(_) => {
                        Output::pretty_errorln(format_args!("<r><red>error<r>: Invalid elide-lines: \"{}\"", BStr::new(elide_lines)));
                        Global::exit(1);
                    }
                };
            }
        }
    }

    if CMD == Command::Tag::TestCommand {
        if let Some(timeout_ms) = args.option("--timeout") {
            if !timeout_ms.is_empty() {
                ctx.test_options.default_timeout_ms = match bun_str::parse_int::<u32>(timeout_ms, 10) {
                    Ok(v) => v,
                    Err(_) => {
                        Output::pretty_errorln(format_args!("<r><red>error<r>: Invalid timeout: \"{}\"", BStr::new(timeout_ms)));
                        Output::flush();
                        Global::exit(1);
                    }
                };
            }
        }

        if let Some(max_concurrency) = args.option("--max-concurrency") {
            if !max_concurrency.is_empty() {
                ctx.test_options.max_concurrency = match bun_str::parse_int::<u32>(max_concurrency, 10) {
                    Ok(v) => v,
                    Err(_) => {
                        Output::pretty_errorln(format_args!("<r><red>error<r>: Invalid max-concurrency: \"{}\"", BStr::new(max_concurrency)));
                        Global::exit(1);
                    }
                };
            }
        }

        if !ctx.test_options.coverage.enabled {
            ctx.test_options.coverage.enabled = args.flag("--coverage");
        }

        if !args.options("--coverage-reporter").is_empty() {
            ctx.test_options.coverage.reporters = Default::default(); // { text: false, lcov: false }
            ctx.test_options.coverage.reporters.text = false;
            ctx.test_options.coverage.reporters.lcov = false;
            for reporter in args.options("--coverage-reporter") {
                if reporter == b"text" {
                    ctx.test_options.coverage.reporters.text = true;
                } else if reporter == b"lcov" {
                    ctx.test_options.coverage.reporters.lcov = true;
                } else {
                    Output::pretty_errorln(format_args!("<r><red>error<r>: invalid coverage reporter '{}'. Available options: 'text' (console output), 'lcov' (code coverage file)", BStr::new(reporter)));
                    Global::exit(1);
                }
            }
        }

        if let Some(reporter_outfile) = args.option("--reporter-outfile") {
            ctx.test_options.reporter_outfile = Some(reporter_outfile);
        }

        if let Some(reporter) = args.option("--reporter") {
            if reporter == b"junit" {
                if ctx.test_options.reporter_outfile.is_none() {
                    Output::err_generic("--reporter=junit requires --reporter-outfile [file] to specify where to save the XML report", format_args!(""));
                    Global::crash();
                }
                ctx.test_options.reporters.junit = true;
            } else if reporter == b"dots" || reporter == b"dot" {
                ctx.test_options.reporters.dots = true;
            } else {
                Output::err_generic("unsupported reporter format '{}'. Available options: 'junit' (for XML test results), 'dots'", format_args!("{}", BStr::new(reporter)));
                Global::crash();
            }
        }

        // Handle --dots flag as shorthand for --reporter=dots
        if args.flag("--dots") {
            ctx.test_options.reporters.dots = true;
        }

        // Handle --only-failures flag
        if args.flag("--only-failures") {
            ctx.test_options.reporters.only_failures = true;
        }

        if let Some(dir) = args.option("--coverage-dir") {
            ctx.test_options.coverage.reports_directory = dir;
        }

        if !args.options("--path-ignore-patterns").is_empty() {
            ctx.test_options.path_ignore_patterns = args.options("--path-ignore-patterns");
            ctx.test_options.path_ignore_patterns_from_cli = true;
        }

        if let Some(bail) = args.option("--bail") {
            if !bail.is_empty() {
                ctx.test_options.bail = match bun_str::parse_int::<u32>(bail, 10) {
                    Ok(v) => v,
                    Err(e) => {
                        Output::pretty_errorln(format_args!("<r><red>error<r>: --bail expects a number: {}", e.name()));
                        Output::flush();
                        Global::exit(1);
                    }
                };

                if ctx.test_options.bail == 0 {
                    Output::pretty_errorln(format_args!("<r><red>error<r>: --bail expects a number greater than 0"));
                    Output::flush();
                    Global::exit(1);
                }
            } else {
                ctx.test_options.bail = 1;
            }
        }
        if let Some(repeat_count) = args.option("--rerun-each") {
            if !repeat_count.is_empty() {
                ctx.test_options.repeat_count = match bun_str::parse_int::<u32>(repeat_count, 10) {
                    Ok(v) => v,
                    Err(e) => {
                        Output::pretty_errorln(format_args!("<r><red>error<r>: --rerun-each expects a number: {}", e.name()));
                        Global::exit(1);
                    }
                };
            }
        }
        if let Some(retry_count) = args.option("--retry") {
            if !retry_count.is_empty() {
                ctx.test_options.retry = match bun_str::parse_int::<u32>(retry_count, 10) {
                    Ok(v) => v,
                    Err(e) => {
                        Output::pretty_errorln(format_args!("<r><red>error<r>: --retry expects a number: {}", e.name()));
                        Global::exit(1);
                    }
                };
            }
        }
        if ctx.test_options.retry != 0 && ctx.test_options.repeat_count != 0 {
            Output::pretty_errorln(format_args!("<r><red>error<r>: --retry cannot be used with --rerun-each"));
            Global::exit(1);
        }
        if let Some(name_pattern) = args.option("--test-name-pattern") {
            ctx.test_options.test_filter_pattern = Some(name_pattern);
            let regex = match RegularExpression::init(bun_str::String::from_bytes(name_pattern), RegularExpression::Flags::NONE) {
                Ok(r) => r,
                Err(_) => {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: --test-name-pattern expects a valid regular expression but received {}",
                        bun_core::fmt::QuotedFormatter { text: name_pattern },
                    ));
                    Global::exit(1);
                }
            };
            // TODO(port): @ptrCast — verify regex pointer type
            ctx.test_options.test_filter_regex = Some(regex);
        }
        if let Some(since) = args.option("--changed") {
            ctx.test_options.changed = Some(since);
        }
        if let Some(shard) = args.option("--shard") {
            let Some(sep) = strings::index_of_char(shard, b'/') else {
                Output::pretty_errorln(format_args!("<r><red>error<r>: --shard expects <d>'<r>index/count<d>'<r>, e.g. --shard=1/3"));
                Global::exit(1);
            };
            let sep = sep as usize;
            let index_str = &shard[..sep];
            let count_str = &shard[sep + 1..];
            let index = match bun_str::parse_int::<u32>(index_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::pretty_errorln(format_args!("<r><red>error<r>: --shard index must be a positive integer, got \"{}\"", BStr::new(index_str)));
                    Global::exit(1);
                }
            };
            let count = match bun_str::parse_int::<u32>(count_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::pretty_errorln(format_args!("<r><red>error<r>: --shard count must be a positive integer, got \"{}\"", BStr::new(count_str)));
                    Global::exit(1);
                }
            };
            if count == 0 {
                Output::pretty_errorln(format_args!("<r><red>error<r>: --shard count must be greater than 0"));
                Global::exit(1);
            }
            if index == 0 || index > count {
                Output::pretty_errorln(format_args!("<r><red>error<r>: --shard index must be between 1 and {}, got {}", count, index));
                Global::exit(1);
            }
            ctx.test_options.shard = Some(cli::TestShard { index, count });
        }
        ctx.test_options.update_snapshots = args.flag("--update-snapshots");
        ctx.test_options.run_todo = args.flag("--todo");
        ctx.test_options.only = args.flag("--only");
        ctx.test_options.pass_with_no_tests = args.flag("--pass-with-no-tests");
        ctx.test_options.concurrent = args.flag("--concurrent");
        ctx.test_options.randomize = args.flag("--randomize");
        ctx.test_options.isolate = args.flag("--isolate");
        ctx.test_options.test_worker = args.flag("--test-worker");

        if let Some(parallel_str) = args.option("--parallel") {
            let parsed: u32 = if !parallel_str.is_empty() {
                match bun_str::parse_int::<u32>(parallel_str, 10) {
                    Ok(v) => v,
                    Err(_) => {
                        Output::pretty_errorln(format_args!("<red>error<r>: --parallel expects a positive integer, received \"{}\"", BStr::new(parallel_str)));
                        Global::exit(1);
                    }
                }
            } else {
                bun_core::get_thread_count().max(1)
            };
            if parsed == 0 {
                Output::pretty_errorln(format_args!("<red>error<r>: --parallel expects a positive integer, received \"0\""));
                Global::exit(1);
            }
            ctx.test_options.parallel = parsed;
            // --parallel implies --isolate inside each worker.
            ctx.test_options.isolate = true;
        }

        if let Some(delay_str) = args.option("--parallel-delay") {
            ctx.test_options.parallel_delay_ms = match bun_str::parse_int::<u32>(delay_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::pretty_errorln(format_args!("<red>error<r>: --parallel-delay expects a non-negative integer (milliseconds), received \"{}\"", BStr::new(delay_str)));
                    Global::exit(1);
                }
            };
        }

        if let Some(seed_str) = args.option("--seed") {
            ctx.test_options.randomize = true;
            ctx.test_options.seed = match bun_str::parse_int::<u32>(seed_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::pretty_errorln(format_args!("<red>error<r>: Invalid seed value: {}", BStr::new(seed_str)));
                    Global::exit(1);
                }
            };
        }
    }

    ctx.args.absolute_working_dir = Some(cwd);
    ctx.positionals = args.positionals();

    if const { Command::Tag::LOADS_CONFIG.get(CMD) } {
        load_config_with_cmd_args::<CMD>(&args, ctx)?;
    }

    let mut opts: api::TransformOptions = ctx.args.clone();

    let defines_tuple = DefineColonList::resolve(args.options("--define"))?;

    if !defines_tuple.keys.is_empty() {
        opts.define = Some(api::StringMap {
            keys: defines_tuple.keys,
            values: defines_tuple.values,
        });
    }

    opts.drop = args.options("--drop");
    opts.feature_flags = args.options("--feature");

    // Node added a `--loader` flag (that's kinda like `--register`). It's
    // completely different from ours.
    let loader_tuple = if CMD != Command::Tag::RunAsNodeCommand {
        LoaderColonList::resolve(args.options("--loader"))?
    } else {
        LoaderColonList::Result { keys: Vec::new(), values: Vec::new() }
    };

    if !loader_tuple.keys.is_empty() {
        opts.loaders = Some(api::LoaderMap {
            extensions: loader_tuple.keys,
            loaders: loader_tuple.values,
        });
    }

    opts.tsconfig_override = if let Some(ts) = args.option("--tsconfig-override") {
        Some(resolve_path::join_abs_string(ctx.args.absolute_working_dir.as_ref().unwrap().as_bytes(), &[ts], resolve_path::Platform::Auto))
    } else {
        None
    };

    opts.main_fields = args.options("--main-fields");
    // we never actually supported inject.
    // opts.inject = args.options("--inject");
    opts.env_files = args.options("--env-file");
    opts.extension_order = args.options("--extension-order");

    if args.flag("--no-env-file") {
        opts.disable_default_env_files = true;
    }

    if args.flag("--preserve-symlinks") {
        opts.preserve_symlinks = true;
    }
    if args.flag("--preserve-symlinks-main") {
        ctx.runtime_options.preserve_symlinks_main = true;
    }

    ctx.passthrough = args.remaining();

    if matches!(CMD, Command::Tag::AutoCommand | Command::Tag::RunCommand | Command::Tag::BuildCommand | Command::Tag::TestCommand) {
        if !args.options("--conditions").is_empty() {
            opts.conditions = args.options("--conditions");
        }
    }

    // runtime commands
    if matches!(CMD, Command::Tag::AutoCommand | Command::Tag::RunCommand | Command::Tag::TestCommand | Command::Tag::RunAsNodeCommand) {
        {
            let preloads = args.options("--preload");
            let preloads2 = args.options("--require");
            let preloads3 = args.options("--import");
            let preload4 = env_var::BUN_INSPECT_PRELOAD.get();

            let total_preloads = ctx.preloads.len() + preloads.len() + preloads2.len() + preloads3.len() + (if preload4.is_some() { 1usize } else { 0usize });
            if total_preloads > 0 {
                let mut all: Vec<&[u8]> = Vec::with_capacity(total_preloads);
                if !ctx.preloads.is_empty() { all.extend_from_slice(&ctx.preloads); }
                // PERF(port): was appendSliceAssumeCapacity
                if !preloads.is_empty() { all.extend_from_slice(preloads); }
                if !preloads2.is_empty() { all.extend_from_slice(preloads2); }
                if !preloads3.is_empty() { all.extend_from_slice(preloads3); }
                if let Some(p) = preload4 { all.push(p); }
                ctx.preloads = all;
            }
        }

        if args.flag("--hot") {
            ctx.debug.hot_reload = cli::HotReload::Hot;
            if args.flag("--no-clear-screen") {
                bun_dotenv::Loader::set_has_no_clear_screen_cli_flag(true);
            }
        } else if args.flag("--watch") {
            ctx.debug.hot_reload = cli::HotReload::Watch;

            // Windows applies this to the watcher child process.
            // The parent process is unable to re-launch itself
            #[cfg(not(windows))]
            {
                bun_core::set_auto_reload_on_crash(true);
            }

            if args.flag("--no-clear-screen") {
                bun_dotenv::Loader::set_has_no_clear_screen_cli_flag(true);
            }
        }

        if let Some(origin) = args.option("--origin") {
            opts.origin = Some(origin);
        }

        if args.flag("--redis-preconnect") {
            ctx.runtime_options.redis_preconnect = true;
        }

        if args.flag("--sql-preconnect") {
            ctx.runtime_options.sql_preconnect = true;
        }

        if args.flag("--no-addons") {
            // used for disabling process.dlopen and
            // for disabling export condition "node-addons"
            opts.allow_addons = false;
        }

        if let Some(unhandled_rejections) = args.option("--unhandled-rejections") {
            opts.unhandled_rejections = match api::UnhandledRejections::MAP.get(unhandled_rejections) {
                Some(v) => Some(*v),
                None => {
                    Output::err_generic("Invalid value for --unhandled-rejections: \"{}\". Must be one of \"strict\", \"throw\", \"warn\", \"none\", \"warn-with-error-code\"\n", format_args!("{}", BStr::new(unhandled_rejections)));
                    Global::exit(1);
                }
            };
        }

        if let Some(port_str) = args.option("--port") {
            if CMD == Command::Tag::RunAsNodeCommand {
                // TODO: prevent `node --port <script>` from working
                ctx.runtime_options.eval.script = port_str;
                ctx.runtime_options.eval.eval_and_print = true;
            } else {
                opts.port = match bun_str::parse_int::<u16>(port_str, 10) {
                    Ok(v) => Some(v),
                    Err(_) => {
                        Output::err_fmt(bun_core::fmt::out_of_range(port_str, bun_core::fmt::OutOfRangeOpts {
                            field_name: "--port",
                            min: 0,
                            max: u16::MAX as i64,
                        }));
                        Output::note("To evaluate TypeScript here, use 'bun --print'", format_args!(""));
                        Global::exit(1);
                    }
                };
            }
        }

        if let Some(size_str) = args.option("--max-http-header-size") {
            let size = match bun_str::parse_int::<usize>(size_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::err_generic("Invalid value for --max-http-header-size: \"{}\". Must be a positive integer\n", format_args!("{}", BStr::new(size_str)));
                    Global::exit(1);
                }
            };
            if size == 0 {
                bun_http::set_max_http_header_size(1024 * 1024 * 1024);
            } else {
                bun_http::set_max_http_header_size(size);
            }
        }

        if let Some(user_agent) = args.option("--user-agent") {
            bun_http::set_overridden_default_user_agent(user_agent);
        }

        ctx.debug.offline_mode_setting = if args.flag("--prefer-offline") {
            Bunfig::OfflineMode::Offline
        } else if args.flag("--prefer-latest") {
            Bunfig::OfflineMode::Latest
        } else {
            Bunfig::OfflineMode::Online
        };

        if args.flag("--no-install") {
            ctx.debug.global_cache = options::GlobalCache::Disable;
        } else if args.flag("-i") {
            ctx.debug.global_cache = options::GlobalCache::Fallback;
        } else if let Some(enum_value) = args.option("--install") {
            // -i=auto --install=force, --install=disable
            if let Some(result) = options::GlobalCache::MAP.get(enum_value) {
                ctx.debug.global_cache = *result;
                // -i, --install
            } else if enum_value.is_empty() {
                ctx.debug.global_cache = options::GlobalCache::Force;
            } else {
                Output::err_generic("Invalid value for --install: \"{}\". Must be either \"auto\", \"fallback\", \"force\", or \"disable\"\n", format_args!("{}", BStr::new(enum_value)));
                Global::exit(1);
            }
        }

        if let Some(script) = args.option("--print") {
            ctx.runtime_options.eval.script = script;
            ctx.runtime_options.eval.eval_and_print = true;
        } else if let Some(script) = args.option("--eval") {
            ctx.runtime_options.eval.script = script;
        }
        ctx.runtime_options.if_present = args.flag("--if-present");
        ctx.runtime_options.smol = args.flag("--smol");
        ctx.runtime_options.preconnect = args.options("--fetch-preconnect");
        ctx.runtime_options.experimental_http2_fetch = args.flag("--experimental-http2-fetch");
        ctx.runtime_options.experimental_http3_fetch = args.flag("--experimental-http3-fetch");
        ctx.runtime_options.expose_gc = args.flag("--expose-gc");

        if let Some(depth_str) = args.option("--console-depth") {
            let depth = match bun_str::parse_int::<u16>(depth_str, 10) {
                Ok(v) => v,
                Err(_) => {
                    Output::err_generic("Invalid value for --console-depth: \"{}\". Must be a positive integer\n", format_args!("{}", BStr::new(depth_str)));
                    Global::exit(1);
                }
            };
            // Treat depth=0 as maxInt(u16) for infinite depth
            ctx.runtime_options.console_depth = if depth == 0 { u16::MAX } else { depth };
        }

        if let Some(order) = args.option("--dns-result-order") {
            ctx.runtime_options.dns_result_order = order;
        }

        let has_cron_title = args.option("--cron-title");
        let has_cron_period = args.option("--cron-period");
        if let Some(t) = has_cron_title {
            ctx.runtime_options.cron_title = t;
        }
        if let Some(p) = has_cron_period {
            ctx.runtime_options.cron_period = p;
        }
        if has_cron_title.is_some() != has_cron_period.is_some() {
            Output::err_generic("--cron-title and --cron-period must be provided together", format_args!(""));
            Global::exit(1);
        }
        if has_cron_title.is_some() && (ctx.runtime_options.cron_title.is_empty() || ctx.runtime_options.cron_period.is_empty()) {
            Output::err_generic("--cron-title and --cron-period must not be empty", format_args!(""));
            Global::exit(1);
        }

        if let Some(inspect_flag) = args.option("--inspect") {
            ctx.runtime_options.debugger = if inspect_flag.is_empty() {
                Command::Debugger::Enable(Default::default())
            } else {
                Command::Debugger::Enable(Command::DebuggerEnable {
                    path_or_port: Some(inspect_flag),
                    ..Default::default()
                })
            };
        } else if let Some(inspect_flag) = args.option("--inspect-wait") {
            ctx.runtime_options.debugger = if inspect_flag.is_empty() {
                Command::Debugger::Enable(Command::DebuggerEnable {
                    wait_for_connection: true,
                    ..Default::default()
                })
            } else {
                Command::Debugger::Enable(Command::DebuggerEnable {
                    path_or_port: Some(inspect_flag),
                    wait_for_connection: true,
                    ..Default::default()
                })
            };
        } else if let Some(inspect_flag) = args.option("--inspect-brk") {
            ctx.runtime_options.debugger = if inspect_flag.is_empty() {
                Command::Debugger::Enable(Command::DebuggerEnable {
                    wait_for_connection: true,
                    set_breakpoint_on_first_line: true,
                    ..Default::default()
                })
            } else {
                Command::Debugger::Enable(Command::DebuggerEnable {
                    path_or_port: Some(inspect_flag),
                    wait_for_connection: true,
                    set_breakpoint_on_first_line: true,
                    ..Default::default()
                })
            };
        }

        let cpu_prof_flag = args.flag("--cpu-prof");
        let cpu_prof_md_flag = args.flag("--cpu-prof-md");

        // --cpu-prof-md alone enables profiling with markdown format
        // --cpu-prof alone enables profiling with JSON format
        // Both flags together enable profiling with both formats
        if cpu_prof_flag || cpu_prof_md_flag {
            ctx.runtime_options.cpu_prof.enabled = true;
            if let Some(name) = args.option("--cpu-prof-name") {
                ctx.runtime_options.cpu_prof.name = name;
            }
            if let Some(dir) = args.option("--cpu-prof-dir") {
                ctx.runtime_options.cpu_prof.dir = dir;
            }
            // md_format is true if --cpu-prof-md is passed (regardless of --cpu-prof)
            ctx.runtime_options.cpu_prof.md_format = cpu_prof_md_flag;
            // json_format is true if --cpu-prof is passed (regardless of --cpu-prof-md)
            ctx.runtime_options.cpu_prof.json_format = cpu_prof_flag;
            if let Some(interval_str) = args.option("--cpu-prof-interval") {
                ctx.runtime_options.cpu_prof.interval = bun_str::parse_int::<u32>(interval_str, 10).unwrap_or(1000);
            }
        } else {
            // Warn if --cpu-prof-name or --cpu-prof-dir is used without a profiler flag
            if args.option("--cpu-prof-name").is_some() {
                Output::warn("--cpu-prof-name requires --cpu-prof or --cpu-prof-md to be enabled", format_args!(""));
            }
            if args.option("--cpu-prof-dir").is_some() {
                Output::warn("--cpu-prof-dir requires --cpu-prof or --cpu-prof-md to be enabled", format_args!(""));
            }
            if args.option("--cpu-prof-interval").is_some() {
                Output::warn("--cpu-prof-interval requires --cpu-prof or --cpu-prof-md to be enabled", format_args!(""));
            }
        }

        let heap_prof_v8 = args.flag("--heap-prof");
        let heap_prof_md = args.flag("--heap-prof-md");

        if heap_prof_v8 && heap_prof_md {
            // Both flags specified - warn and use markdown format
            Output::warn("Both --heap-prof and --heap-prof-md specified; using --heap-prof-md (markdown format)", format_args!(""));
            ctx.runtime_options.heap_prof.enabled = true;
            ctx.runtime_options.heap_prof.text_format = true;
            if let Some(name) = args.option("--heap-prof-name") {
                ctx.runtime_options.heap_prof.name = name;
            }
            if let Some(dir) = args.option("--heap-prof-dir") {
                ctx.runtime_options.heap_prof.dir = dir;
            }
        } else if heap_prof_v8 || heap_prof_md {
            ctx.runtime_options.heap_prof.enabled = true;
            ctx.runtime_options.heap_prof.text_format = heap_prof_md;
            if let Some(name) = args.option("--heap-prof-name") {
                ctx.runtime_options.heap_prof.name = name;
            }
            if let Some(dir) = args.option("--heap-prof-dir") {
                ctx.runtime_options.heap_prof.dir = dir;
            }
        } else {
            // Warn if --heap-prof-name or --heap-prof-dir is used without --heap-prof or --heap-prof-md
            if args.option("--heap-prof-name").is_some() {
                Output::warn("--heap-prof-name requires --heap-prof or --heap-prof-md to be enabled", format_args!(""));
            }
            if args.option("--heap-prof-dir").is_some() {
                Output::warn("--heap-prof-dir requires --heap-prof or --heap-prof-md to be enabled", format_args!(""));
            }
        }

        if args.flag("--no-deprecation") {
            // SAFETY: single-threaded startup; mirrors Zig export var write
            unsafe { Bun__Node__ProcessNoDeprecation = true; }
        }
        if args.flag("--throw-deprecation") {
            // SAFETY: single-threaded startup
            unsafe { Bun__Node__ProcessThrowDeprecation = true; }
        }
        if let Some(title) = args.option("--title") {
            cli::set_process_title(title);
        }
        if args.flag("--zero-fill-buffers") {
            // SAFETY: single-threaded startup
            unsafe { Bun__Node__ZeroFillBuffers = true; }
        }
        let use_system_ca = args.flag("--use-system-ca");
        let use_openssl_ca = args.flag("--use-openssl-ca");
        let use_bundled_ca = args.flag("--use-bundled-ca");

        // Disallow any combination > 1
        if (use_system_ca as u8) + (use_openssl_ca as u8) + (use_bundled_ca as u8) > 1 {
            Output::pretty_errorln(format_args!("<r><red>error<r>: choose exactly one of --use-system-ca, --use-openssl-ca, or --use-bundled-ca"));
            Global::exit(1);
        }

        // CLI overrides env var (NODE_USE_SYSTEM_CA)
        // SAFETY: single-threaded startup; exported globals read by C++
        unsafe {
            if use_bundled_ca {
                Bun__Node__CAStore = BunCAStore::Bundled;
            } else if use_openssl_ca {
                Bun__Node__CAStore = BunCAStore::Openssl;
            } else if use_system_ca {
                Bun__Node__CAStore = BunCAStore::System;
            } else {
                if env_var::NODE_USE_SYSTEM_CA.get() {
                    Bun__Node__CAStore = BunCAStore::System;
                }
            }

            // Back-compat boolean used by native code until fully migrated
            Bun__Node__UseSystemCA = Bun__Node__CAStore == BunCAStore::System;
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

    ctx.bundler_options.ignore_dce_annotations = args.flag("--ignore-dce-annotations");

    if CMD == Command::Tag::BuildCommand {
        ctx.bundler_options.transform_only = args.flag("--no-bundle");
        ctx.bundler_options.bytecode = args.flag("--bytecode");

        let production = args.flag("--production");

        if args.flag("--app") {
            if !FeatureFlags::bake() {
                Output::err_generic("To use the experimental \"--app\" option, upgrade to the canary build of bun via \"bun upgrade --canary\"", format_args!(""));
                Global::crash();
            }

            ctx.bundler_options.bake = true;
            ctx.bundler_options.bake_debug_dump_server = FeatureFlags::BAKE_DEBUGGING_FEATURES
                && args.flag("--debug-dump-server-files");
            ctx.bundler_options.bake_debug_disable_minify = FeatureFlags::BAKE_DEBUGGING_FEATURES
                && args.flag("--debug-no-minify");
        }

        if ctx.bundler_options.bytecode {
            ctx.bundler_options.output_format = options::Format::Cjs;
            ctx.args.target = Some(api::Target::Bun);
        }

        if let Some(public_path) = args.option("--public-path") {
            ctx.bundler_options.public_path = public_path;
        }

        if let Some(banner) = args.option("--banner") {
            ctx.bundler_options.banner = banner;
        }

        if let Some(footer) = args.option("--footer") {
            ctx.bundler_options.footer = footer;
        }

        let minify_flag = args.flag("--minify") || production;
        ctx.bundler_options.minify_syntax = minify_flag || args.flag("--minify-syntax");
        ctx.bundler_options.minify_whitespace = minify_flag || args.flag("--minify-whitespace");
        ctx.bundler_options.minify_identifiers = minify_flag || args.flag("--minify-identifiers");
        ctx.bundler_options.keep_names = args.flag("--keep-names");

        ctx.bundler_options.css_chunking = args.flag("--css-chunking");

        ctx.bundler_options.emit_dce_annotations = args.flag("--emit-dce-annotations")
            || !ctx.bundler_options.minify_whitespace;

        if !args.options("--external").is_empty() {
            let ext_opts = args.options("--external");
            let mut externals: Vec<&[u8]> = Vec::with_capacity(ext_opts.len());
            for (_i, external) in ext_opts.iter().enumerate() {
                externals.push(external);
            }
            opts.external = externals;
        }

        if args.flag("--reject-unresolved") && !args.options("--allow-unresolved").is_empty() {
            Output::pretty_errorln(format_args!("<r><red>error<r>: --reject-unresolved and --allow-unresolved cannot be used together"));
            Global::crash();
        } else if args.flag("--reject-unresolved") {
            ctx.bundler_options.allow_unresolved = Vec::new();
        } else if !args.options("--allow-unresolved").is_empty() {
            let raw = args.options("--allow-unresolved");
            let mut allow: Vec<&[u8]> = Vec::with_capacity(raw.len());
            for (_i, val) in raw.iter().enumerate() {
                // "<empty>" sentinel represents the empty-string pattern (for matching opaque specifiers)
                allow.push(if *val == b"<empty>" { b"" } else { val });
            }
            ctx.bundler_options.allow_unresolved = allow;
        }

        if let Some(packages) = args.option("--packages") {
            if packages == b"bundle" {
                opts.packages = api::Packages::Bundle;
            } else if packages == b"external" {
                opts.packages = api::Packages::External;
            } else {
                Output::pretty_errorln(format_args!("<r><red>error<r>: Invalid packages setting: \"{}\"", BStr::new(packages)));
                Global::crash();
            }
        }

        if let Some(env) = args.option("--env") {
            if let Some(asterisk) = strings::index_of_char(env, b'*') {
                if asterisk == 0 {
                    ctx.bundler_options.env_behavior = options::EnvBehavior::LoadAll;
                } else {
                    ctx.bundler_options.env_behavior = options::EnvBehavior::Prefix;
                    ctx.bundler_options.env_prefix = &env[..asterisk as usize];
                }
            } else if env == b"inline" || env == b"1" {
                ctx.bundler_options.env_behavior = options::EnvBehavior::LoadAll;
            } else if env == b"disable" || env == b"0" {
                ctx.bundler_options.env_behavior = options::EnvBehavior::LoadAllWithoutInlining;
            } else {
                Output::pretty_errorln(format_args!("<r><red>error<r>: Expected 'env' to be 'inline', 'disable', or a prefix with a '*' character"));
                Global::crash();
            }
        }

        // TODO(port): strings.ExactSizeMatcher(8) — phf or match on byte slice
        if let Some(target) = args.option("--target") {
            'brk: {
                if CMD == Command::Tag::BuildCommand {
                    if args.flag("--compile") {
                        if target.len() > 4 && strings::has_prefix(target, b"bun-") {
                            ctx.bundler_options.compile_target = cli::Cli::CompileTarget::from(&target[3..]);
                            if !ctx.bundler_options.compile_target.is_supported() {
                                Output::err_generic("Unsupported compile target: {}\n", format_args!("{}", ctx.bundler_options.compile_target));
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
                    b"macro" => if CMD == Command::Tag::BuildCommand { api::Target::BunMacro } else { api::Target::Bun },
                    b"bun" => api::Target::Bun,
                    _ => cli::invalid_target(&mut diag, target),
                }));

                if opts.target.unwrap() == api::Target::Bun {
                    ctx.debug.run_in_bun = opts.target.unwrap() == api::Target::Bun;
                } else {
                    if ctx.bundler_options.bytecode {
                        Output::err_generic("target must be 'bun' when bytecode is true. Received: {}", format_args!("{}", <&'static str>::from(opts.target.unwrap())));
                        Global::exit(1);
                    }

                    if ctx.bundler_options.bake {
                        Output::err_generic("target must be 'bun' when using --app. Received: {}", format_args!("{}", <&'static str>::from(opts.target.unwrap())));
                    }
                }
            }
        }

        if args.flag("--watch") {
            ctx.debug.hot_reload = cli::HotReload::Watch;
            bun_core::set_auto_reload_on_crash(true);

            if args.flag("--no-clear-screen") {
                bun_dotenv::Loader::set_has_no_clear_screen_cli_flag(true);
            }
        }

        if args.flag("--compile") {
            ctx.bundler_options.compile = true;
            ctx.bundler_options.inline_entrypoint_import_meta_main = true;
        }

        if let Some(compile_exec_argv) = args.option("--compile-exec-argv") {
            if !ctx.bundler_options.compile {
                Output::err_generic("--compile-exec-argv requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.compile_exec_argv = compile_exec_argv;
        }

        // Handle --compile-autoload-dotenv flags
        {
            let has_positive = args.flag("--compile-autoload-dotenv");
            let has_negative = args.flag("--no-compile-autoload-dotenv");

            if has_positive || has_negative {
                if !ctx.bundler_options.compile {
                    Output::err_generic("--compile-autoload-dotenv requires --compile", format_args!(""));
                    Global::crash();
                }
                if has_positive && has_negative {
                    Output::err_generic("Cannot use both --compile-autoload-dotenv and --no-compile-autoload-dotenv", format_args!(""));
                    Global::crash();
                }
                ctx.bundler_options.compile_autoload_dotenv = has_positive;
            }
        }

        // Handle --compile-autoload-bunfig flags
        {
            let has_positive = args.flag("--compile-autoload-bunfig");
            let has_negative = args.flag("--no-compile-autoload-bunfig");

            if has_positive || has_negative {
                if !ctx.bundler_options.compile {
                    Output::err_generic("--compile-autoload-bunfig requires --compile", format_args!(""));
                    Global::crash();
                }
                if has_positive && has_negative {
                    Output::err_generic("Cannot use both --compile-autoload-bunfig and --no-compile-autoload-bunfig", format_args!(""));
                    Global::crash();
                }
                ctx.bundler_options.compile_autoload_bunfig = has_positive;
            }
        }

        // Handle --compile-autoload-tsconfig flags (default: false, tsconfig not loaded at runtime)
        {
            let has_positive = args.flag("--compile-autoload-tsconfig");
            let has_negative = args.flag("--no-compile-autoload-tsconfig");

            if has_positive || has_negative {
                if !ctx.bundler_options.compile {
                    Output::err_generic("--compile-autoload-tsconfig requires --compile", format_args!(""));
                    Global::crash();
                }
                if has_positive && has_negative {
                    Output::err_generic("Cannot use both --compile-autoload-tsconfig and --no-compile-autoload-tsconfig", format_args!(""));
                    Global::crash();
                }
                ctx.bundler_options.compile_autoload_tsconfig = has_positive;
            }
        }

        // Handle --compile-autoload-package-json flags (default: false, package.json not loaded at runtime)
        {
            let has_positive = args.flag("--compile-autoload-package-json");
            let has_negative = args.flag("--no-compile-autoload-package-json");

            if has_positive || has_negative {
                if !ctx.bundler_options.compile {
                    Output::err_generic("--compile-autoload-package-json requires --compile", format_args!(""));
                    Global::crash();
                }
                if has_positive && has_negative {
                    Output::err_generic("Cannot use both --compile-autoload-package-json and --no-compile-autoload-package-json", format_args!(""));
                    Global::crash();
                }
                ctx.bundler_options.compile_autoload_package_json = has_positive;
            }
        }

        if let Some(path) = args.option("--compile-executable-path") {
            if !ctx.bundler_options.compile {
                Output::err_generic("--compile-executable-path requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.compile_executable_path = path;
        }

        if args.flag("--windows-hide-console") {
            // --windows-hide-console technically doesnt depend on WinAPI, but since since --windows-icon
            // does, all of these customization options have been gated to windows-only
            if !cfg!(windows) {
                Output::err_generic("Using --windows-hide-console is only available when compiling on Windows", format_args!(""));
                Global::crash();
            }
            if ctx.bundler_options.compile_target.os != cli::CompileTargetOs::Windows {
                Output::err_generic("--windows-hide-console requires a Windows compile target", format_args!(""));
                Global::crash();
            }
            if !ctx.bundler_options.compile {
                Output::err_generic("--windows-hide-console requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.windows.hide_console = true;
        }
        if let Some(path) = args.option("--windows-icon") {
            if !cfg!(windows) {
                Output::err_generic("Using --windows-icon is only available when compiling on Windows", format_args!(""));
                Global::crash();
            }
            if ctx.bundler_options.compile_target.os != cli::CompileTargetOs::Windows {
                Output::err_generic("--windows-icon requires a Windows compile target", format_args!(""));
                Global::crash();
            }
            if !ctx.bundler_options.compile {
                Output::err_generic("--windows-icon requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.windows.icon = Some(path);
        }
        if let Some(title) = args.option("--windows-title") {
            if !cfg!(windows) {
                Output::err_generic("Using --windows-title is only available when compiling on Windows", format_args!(""));
                Global::crash();
            }
            if ctx.bundler_options.compile_target.os != cli::CompileTargetOs::Windows {
                Output::err_generic("--windows-title requires a Windows compile target", format_args!(""));
                Global::crash();
            }
            if !ctx.bundler_options.compile {
                Output::err_generic("--windows-title requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.windows.title = Some(title);
        }
        if let Some(publisher) = args.option("--windows-publisher") {
            if !cfg!(windows) {
                Output::err_generic("Using --windows-publisher is only available when compiling on Windows", format_args!(""));
                Global::crash();
            }
            if ctx.bundler_options.compile_target.os != cli::CompileTargetOs::Windows {
                Output::err_generic("--windows-publisher requires a Windows compile target", format_args!(""));
                Global::crash();
            }
            if !ctx.bundler_options.compile {
                Output::err_generic("--windows-publisher requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.windows.publisher = Some(publisher);
        }
        if let Some(version) = args.option("--windows-version") {
            if !cfg!(windows) {
                Output::err_generic("Using --windows-version is only available when compiling on Windows", format_args!(""));
                Global::crash();
            }
            if ctx.bundler_options.compile_target.os != cli::CompileTargetOs::Windows {
                Output::err_generic("--windows-version requires a Windows compile target", format_args!(""));
                Global::crash();
            }
            if !ctx.bundler_options.compile {
                Output::err_generic("--windows-version requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.windows.version = Some(version);
        }
        if let Some(description) = args.option("--windows-description") {
            if !cfg!(windows) {
                Output::err_generic("Using --windows-description is only available when compiling on Windows", format_args!(""));
                Global::crash();
            }
            if ctx.bundler_options.compile_target.os != cli::CompileTargetOs::Windows {
                Output::err_generic("--windows-description requires a Windows compile target", format_args!(""));
                Global::crash();
            }
            if !ctx.bundler_options.compile {
                Output::err_generic("--windows-description requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.windows.description = Some(description);
        }
        if let Some(copyright) = args.option("--windows-copyright") {
            if !cfg!(windows) {
                Output::err_generic("Using --windows-copyright is only available when compiling on Windows", format_args!(""));
                Global::crash();
            }
            if ctx.bundler_options.compile_target.os != cli::CompileTargetOs::Windows {
                Output::err_generic("--windows-copyright requires a Windows compile target", format_args!(""));
                Global::crash();
            }
            if !ctx.bundler_options.compile {
                Output::err_generic("--windows-copyright requires --compile", format_args!(""));
                Global::crash();
            }
            ctx.bundler_options.windows.copyright = Some(copyright);
        }

        if let Some(outdir) = args.option("--outdir") {
            if !outdir.is_empty() {
                ctx.bundler_options.outdir = outdir;
            }
        } else if let Some(outfile) = args.option("--outfile") {
            if !outfile.is_empty() {
                ctx.bundler_options.outfile = outfile;
            }
        }

        if let Some(metafile) = args.option("--metafile") {
            // If --metafile is passed without a value, default to "meta.json"
            ctx.bundler_options.metafile = if !metafile.is_empty() {
                bun_str::ZStr::from_bytes(metafile).into()
            } else {
                b"meta.json".into()
            };
        }

        if let Some(metafile_md) = args.option("--metafile-md") {
            // If --metafile-md is passed without a value, default to "meta.md"
            ctx.bundler_options.metafile_md = if !metafile_md.is_empty() {
                bun_str::ZStr::from_bytes(metafile_md).into()
            } else {
                b"meta.md".into()
            };
        }

        if let Some(root_dir) = args.option("--root") {
            if !root_dir.is_empty() {
                ctx.bundler_options.root_dir = root_dir;
            }
        }

        if let Some(format_str) = args.option("--format") {
            let Some(format) = options::Format::from_string(format_str) else {
                Output::err_generic("Invalid format - must be esm, cjs, or iife", format_args!(""));
                Global::crash();
            };

            match format {
                options::Format::InternalBakeDev => {
                    Output::warn("--format={} is for debugging only, and may experience breaking changes at any moment", format_args!("{}", BStr::new(format_str)));
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
                    Output::err_generic("format must be 'cjs' or 'esm' when bytecode is true.", format_args!(""));
                    Global::exit(1);
                }
                // ESM bytecode requires --compile because module_info (import/export metadata)
                // is only available in compiled binaries. Without it, JSC must parse the file
                // twice (once for module analysis, once for bytecode), which is a deopt.
                if format == options::Format::Esm && !ctx.bundler_options.compile {
                    Output::err_generic("ESM bytecode requires --compile. Use --format=cjs for bytecode without --compile.", format_args!(""));
                    Global::exit(1);
                }
            }
        }

        if args.flag("--splitting") {
            ctx.bundler_options.code_splitting = true;
        }

        if let Some(entry_naming) = args.option("--entry-naming") {
            ctx.bundler_options.entry_naming = strings::concat(&[b"./", strings::remove_leading_dot_slash(entry_naming)])?;
        }

        if let Some(chunk_naming) = args.option("--chunk-naming") {
            ctx.bundler_options.chunk_naming = strings::concat(&[b"./", strings::remove_leading_dot_slash(chunk_naming)])?;
        }

        if let Some(asset_naming) = args.option("--asset-naming") {
            ctx.bundler_options.asset_naming = strings::concat(&[b"./", strings::remove_leading_dot_slash(asset_naming)])?;
        }

        if args.flag("--server-components") {
            ctx.bundler_options.server_components = true;
            if let Some(target) = opts.target {
                if !options::Target::from(target).is_server_side() {
                    Output::err_generic("Cannot use client-side --target={} with --server-components", format_args!("{}", <&'static str>::from(target)));
                    Global::crash();
                } else {
                    opts.target = Some(api::Target::Bun);
                }
            }
        }

        if args.flag("--react-fast-refresh") {
            ctx.bundler_options.react_fast_refresh = true;
        }

        if let Some(setting) = args.option("--sourcemap") {
            if setting.is_empty() {
                // In the future, Bun is going to make this default to .linked
                opts.source_map = api::SourceMap::Linked;
            } else if setting == b"inline" {
                opts.source_map = api::SourceMap::Inline;
            } else if setting == b"none" {
                opts.source_map = api::SourceMap::None;
            } else if setting == b"external" {
                opts.source_map = api::SourceMap::External;
            } else if setting == b"linked" {
                opts.source_map = api::SourceMap::Linked;
            } else {
                Output::pretty_errorln(format_args!("<r><red>error<r>: Invalid sourcemap setting: \"{}\"", BStr::new(setting)));
                Global::crash();
            }

            // when using --compile, only `external` works, as we do not
            // look at the source map comment. so after we validate the
            // user's choice was in the list, we secretly override it
            if ctx.bundler_options.compile {
                opts.source_map = api::SourceMap::External;
            }
        }
    }

    if opts.entry_points.is_empty() {
        let mut entry_points = ctx.positionals;

        match CMD {
            Command::Tag::BuildCommand => {
                if !entry_points.is_empty() && (entry_points[0] == b"build" || entry_points[0] == b"bun") {
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
            Command::Tag::RunCommand => {
                if !entry_points.is_empty() && (entry_points[0] == b"run" || entry_points[0] == b"r") {
                    entry_points = &entry_points[1..];
                }
            }
            _ => {}
        }

        opts.entry_points = entry_points;
    }

    let jsx_factory = args.option("--jsx-factory");
    let jsx_fragment = args.option("--jsx-fragment");
    let jsx_import_source = args.option("--jsx-import-source");
    let jsx_runtime = args.option("--jsx-runtime");
    let jsx_side_effects = args.flag("--jsx-side-effects");

    if matches!(CMD, Command::Tag::AutoCommand | Command::Tag::RunCommand) {
        // "run.silent" in bunfig.toml
        if args.flag("--silent") {
            ctx.debug.silent = true;
        }

        if let Some(elide_lines) = args.option("--elide-lines") {
            if !elide_lines.is_empty() {
                ctx.bundler_options.elide_lines = match bun_str::parse_int::<usize>(elide_lines, 10) {
                    Ok(v) => v,
                    Err(_) => {
                        Output::pretty_errorln(format_args!("<r><red>error<r>: Invalid elide-lines: \"{}\"", BStr::new(elide_lines)));
                        Global::exit(1);
                    }
                };
            }
        }

        if let Some(define) = &opts.define {
            if !define.keys.is_empty() {
                bun_jsc::RuntimeTranspilerCache::set_disabled(true);
            }
        }
    }

    if matches!(CMD, Command::Tag::RunCommand | Command::Tag::AutoCommand | Command::Tag::BunxCommand) {
        // "run.bun" in bunfig.toml
        if args.flag("--bun") {
            ctx.debug.run_in_bun = true;
        }
    }

    opts.resolve = api::ResolveMode::Lazy;

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
                factory: jsx_factory.unwrap_or(default_factory),
                fragment: jsx_fragment.unwrap_or(default_fragment),
                import_source: jsx_import_source.unwrap_or(default_import_source),
                runtime: if let Some(runtime) = jsx_runtime { resolve_jsx_runtime(runtime)? } else { api::JsxRuntime::Automatic },
                development: false,
                side_effects: jsx_side_effects,
            });
        } else {
            let prev = opts.jsx.as_ref().unwrap();
            opts.jsx = Some(api::Jsx {
                factory: jsx_factory.unwrap_or(prev.factory),
                fragment: jsx_fragment.unwrap_or(prev.fragment),
                import_source: jsx_import_source.unwrap_or(prev.import_source),
                runtime: if let Some(runtime) = jsx_runtime { resolve_jsx_runtime(runtime)? } else { prev.runtime },
                development: false,
                side_effects: jsx_side_effects,
            });
        }
    }

    if CMD == Command::Tag::BuildCommand {
        if opts.entry_points.is_empty() && !ctx.bundler_options.bake {
            Output::prettyln(format_args!(const_format::concatcp!("<r><b>bun build <r><d>v", bun_core::Global::PACKAGE_JSON_VERSION_WITH_SHA, "<r>")));
            Output::pretty(format_args!("<r><red>error: Missing entrypoints. What would you like to bundle?<r>\n\n"));
            Output::flush();
            Output::pretty(format_args!("Usage:\n  <d>$<r> <b><green>bun build<r> \\<entrypoint\\> [...\\<entrypoints\\>] <cyan>[...flags]<r>  \n"));
            Output::pretty(format_args!("\nTo see full documentation:\n  <d>$<r> <b><green>bun build<r> --help\n"));
            Output::flush();
            Global::exit(1);
        }

        if args.flag("--production") {
            let any_html = opts.entry_points.iter().any(|entry_point| strings::has_suffix(entry_point, b".html"));
            if any_html {
                ctx.bundler_options.css_chunking = true;
            }

            ctx.bundler_options.production = true;
        }
    }

    if let Some(log_level) = opts.log_level {
        logger::Log::set_default_log_level(match log_level {
            api::LogLevel::Debug => logger::Log::Level::Debug,
            api::LogLevel::Err => logger::Log::Level::Err,
            api::LogLevel::Warn => logger::Log::Level::Warn,
            _ => logger::Log::Level::Err,
        });
        ctx.log.level = logger::Log::default_log_level();
    }

    if args.flag("--no-macros") {
        ctx.debug.macros = cli::MacroOptions::Disable;
    }

    opts.output_dir = output_dir;
    if let Some(of) = output_file {
        ctx.debug.output_file = of;
    }

    if matches!(CMD, Command::Tag::RunCommand | Command::Tag::AutoCommand) {
        if let Some(shell) = args.option("--shell") {
            if shell == b"bun" {
                ctx.debug.use_system_shell = false;
            } else if shell == b"system" {
                ctx.debug.use_system_shell = true;
            } else {
                Output::err_generic("Expected --shell to be one of 'bun' or 'system'. Received: \"{}\"", format_args!("{}", BStr::new(shell)));
                Global::exit(1);
            }
        }
    }

    #[cfg(feature = "show_crash_trace")]
    {
        debug_flags::set_resolve_breakpoints(args.options("--breakpoint-resolve"));
        debug_flags::set_print_breakpoints(args.options("--breakpoint-print"));
    }

    Ok(opts)
}

#[unsafe(no_mangle)]
pub static mut Bun__Node__ZeroFillBuffers: bool = false;
#[unsafe(no_mangle)]
pub static mut Bun__Node__ProcessNoDeprecation: bool = false;
#[unsafe(no_mangle)]
pub static mut Bun__Node__ProcessThrowDeprecation: bool = false;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BunCAStore {
    Bundled,
    Openssl,
    System,
}
#[unsafe(no_mangle)]
pub static mut Bun__Node__CAStore: BunCAStore = BunCAStore::Bundled;
#[unsafe(no_mangle)]
pub static mut Bun__Node__UseSystemCA: bool = false;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/Arguments.zig (1744 lines)
//   confidence: medium
//   todos:      12
//   notes:      comptime param arrays use placeholder clap::parse_param!/concat_params! macros; const-generic Command::Tag needs ConstParamTy; Output/Global call signatures are approximate; mutable export statics need atomic/UnsafeCell wrappers in Phase B
// ──────────────────────────────────────────────────────────────────────────


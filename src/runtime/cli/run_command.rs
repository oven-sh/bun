//! Port of `src/runtime/cli/run_command.zig`.
//!
//! `RunCommand::exec` classifies the first positional as a file path vs. a
//! package.json script and either boots the JS VM directly (via `Run::boot` →
//! `VirtualMachine::init` → `Run::start`) or spawns the script body through the
//! bun-shell / system shell. PATH stitching, `node_modules/.bin` lookup,
//! markdown rendering, and the Windows bunx fast-path are all handled here.

use ::core::ffi::{c_char, c_void};
use ::core::sync::atomic::{AtomicBool, Ordering};
use std::io::Write as _;

use bun_ast::Loader;
use bun_bundler::Transpiler;
use bun_collections::{ArrayHashMap, StringHashMap};
use bun_core::MutableString;
use bun_core::{self as core, Environment, Global, Output, ZStr};
use bun_core::{pretty, pretty_errorln, prettyln};
use bun_dotenv as DotEnv;
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::virtual_machine::{InitOptions as VmInitOptions, VirtualMachine};
use bun_jsc::{JSGlobalObject, JSValue};
use bun_md::root as md;
use bun_options_types::schema::api;
#[cfg(windows)]
use bun_paths::WPathBuffer;
use bun_paths::strings;
use bun_paths::{self as paths, DELIMITER, MAX_PATH_BYTES, PathBuffer, SEP};
use bun_resolver::dir_info::DirInfo;
use bun_resolver::package_json::PackageJSON;
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_threading::Channel;
use bun_which::which;

use crate::cli;
use crate::cli::Command;
use crate::cli::arguments;
use crate::cli::command::{ContextData, Tag as CommandTag};
use crate::cli::shell_completions::ShellCompletions;

bun_core::declare_scope!(RUN_LOG, visible);

use bun_core::UnwrapOrOom;

/// Port of `bun.pathLiteral` — picks the POSIX or Windows literal at compile
/// time. Local because `bun_paths` does not export a macro form yet.
macro_rules! path_literal {
    ($posix:literal, $win:literal) => {{
        #[cfg(windows)]
        {
            $win
        }
        #[cfg(not(windows))]
        {
            $posix
        }
    }};
}

/// Process-lifetime arena for the runner's `Transpiler`. Zig passed
/// `ctx.allocator` (== `bun.default_allocator`); the Rust port threads an
/// `&'static Arena` per PORTING.md §AST crates. Route through the shared
/// `cli::cli_arena()` (a `LazyLock` — `MimallocArena` is `Sync`).
#[inline]
fn runner_arena() -> &'static bun_alloc::Arena {
    crate::cli::cli_arena()
}

// Passthrough-arg shell escaping (run_command.zig:233-239 → shell.zig
// escape8Bit). The escape tables + helpers are the lower-tier
// `bun_shell_parser` crate's canonical copy — import them so future fixes to
// the shell escaper cannot silently diverge.
use bun_shell_parser::{escape_8bit, needs_escape_utf8_ascii_latin1};

pub struct NpmArgs;
impl NpmArgs {
    // https://github.com/npm/rfcs/blob/main/implemented/0021-reduce-lifecycle-script-environment.md#detailed-explanation
    pub const PACKAGE_NAME: &'static [u8] = b"npm_package_name";
    pub const PACKAGE_VERSION: &'static [u8] = b"npm_package_version";
}

/// Runtime knobs `Command::start` passes through; mirrors the Zig
/// `comptime`-tuple that selected the per-tag exec body.
pub struct ExecCfg {
    pub bin_dirs_only: bool,
    pub log_errors: bool,
    pub allow_fast_run_for_extensions: bool,
}

impl Default for ExecCfg {
    fn default() -> Self {
        Self {
            bin_dirs_only: false,
            log_errors: true,
            allow_fast_run_for_extensions: true,
        }
    }
}

pub struct RunCommand;

impl RunCommand {
    /// `bun run --help` body.
    pub fn print_help(package_json: Option<&PackageJSON>) {
        // PORT NOTE: templates are passed as *string literals* so the
        // `pretty_fmt!` proc-macro rewrites the `<tag>` color markup at compile
        // time. Routing them through a `const &str` + `{}` (as the original
        // Phase-A draft did) prints the raw `<b>`/`<r>` tags verbatim.
        pretty!("<b>Usage<r>: <b><green>bun run<r> <cyan>[flags]<r> \\<file or script\\>\n\n");
        pretty!("<b>Flags:<r>");
        bun_clap::simple_help(crate::cli::arguments::RUN_PARAMS);
        pretty!(
            "\n\n\
<b>Examples:<r>
  <d>Run a JavaScript or TypeScript file<r>
  <b><green>bun run<r> <blue>./index.js<r>
  <b><green>bun run<r> <blue>./index.tsx<r>

  <d>Run a package.json script<r>
  <b><green>bun run<r> <blue>dev<r>
  <b><green>bun run<r> <blue>lint<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/run<r>
"
        );

        if let Some(pkg) = package_json {
            if let Some(scripts) = pkg.scripts.as_deref() {
                let mut display_name: &[u8] = &pkg.name;
                if display_name.is_empty() {
                    display_name = paths::basename(pkg.source.path.name.dir);
                }
                let _ = display_name;

                if scripts.count() > 0 {
                    pretty!("\n<b>package.json scripts ({} found):<r>", scripts.count());
                    for (key, value) in scripts.keys().iter().zip(scripts.values().iter()) {
                        prettyln!("\n");
                        prettyln!(
                            "  <d>$</r> bun run<r> <blue>{}<r>\n",
                            bstr::BStr::new(key.as_ref())
                        );
                        prettyln!("  <d>  {}<r>\n", bstr::BStr::new(value));
                    }
                    prettyln!("\n");
                } else {
                    prettyln!("\n<r><yellow>No \"scripts\" found in package.json.<r>\n");
                }
            } else {
                prettyln!("\n<r><yellow>No \"scripts\" found in package.json.<r>\n");
            }
        }

        Output::flush();
    }

    const SHELLS_TO_SEARCH: &'static [&'static [u8]] = &[b"bash", b"sh", b"zsh"];

    /// `findShell` — locate a POSIX shell on `$PATH`, falling back to a
    /// hardcoded list. Returns a NUL-terminated path borrowed from the
    /// process-lifetime cache populated by `find_shell`.
    fn find_shell_impl(path: &[u8], cwd: &[u8], path_buf: &mut PathBuffer) -> Option<usize> {
        #[cfg(windows)]
        {
            let _ = (path, cwd);
            const WIN: &[u8] = b"C:\\Windows\\System32\\cmd.exe";
            path_buf[..WIN.len()].copy_from_slice(WIN);
            return Some(WIN.len());
        }

        #[cfg(not(windows))]
        {
            for shell in Self::SHELLS_TO_SEARCH {
                if let Some(shell_) = which(path_buf, path, cwd, shell) {
                    return Some(shell_.len());
                }
            }

            const HARDCODED_POPULAR_ONES: &[&[u8]] = &[
                b"/bin/bash",
                b"/usr/bin/bash",
                b"/usr/local/bin/bash", // don't think this is a real one
                b"/bin/sh",
                b"/usr/bin/sh", // don't think this is a real one
                b"/usr/bin/zsh",
                b"/usr/local/bin/zsh",
                b"/system/bin/sh", // Android
            ];
            for shell in HARDCODED_POPULAR_ONES {
                path_buf[..shell.len()].copy_from_slice(shell);
                path_buf[shell.len()] = 0;
                // SAFETY: NUL-terminated above.
                let z = ZStr::from_buf(&path_buf[..], shell.len());
                if bun_sys::is_executable_file_path(z) {
                    return Some(shell.len());
                }
            }

            None
        }
    }

    /// Find the "best" shell to use. Cached to only run once.
    pub fn find_shell(path: &[u8], cwd: &[u8]) -> Option<&'static ZStr> {
        // PORT NOTE: Zig used `bun.once` over a module-level `var shell_buf`
        // (run_command.zig:73). Process-lifetime; written exactly once on the
        // CLI thread. PORTING.md §Global mutable state: scratch buffer behind
        // a `Once` gate → RacyCell.
        static SHELL_BUF: bun_core::RacyCell<PathBuffer> =
            bun_core::RacyCell::new(PathBuffer::ZEROED);
        static ONCE: bun_core::Once<Option<&'static ZStr>> = bun_core::Once::new();
        ONCE.call(|| {
            // SAFETY: single-writer (Once gate), process-lifetime storage,
            // CLI is single-threaded at this point.
            let buf = unsafe { &mut *SHELL_BUF.get() };
            let len = Self::find_shell_impl(path, cwd, buf)?;
            buf[len] = 0;
            // SAFETY: `buf[len] == 0` written above; SHELL_BUF is `'static`.
            Some(ZStr::from_buf(&buf[..], len))
        })
    }

    // Look for invocations of any: `yarn run` / `yarn $cmd` / `pnpm run` /
    // `npm run` / `npx` / `pnpx` and replace them with `bun run` / `bun x`.
    //
    // so lifecycle scripts can call it without a bun_runtime → bun_install
    // → bun_runtime cycle. This is a thin re-export for `bun run` /
    // filter_run / multi_run callers.
    #[inline]
    pub fn replace_package_manager_run(
        copy_script: &mut Vec<u8>,
        script: &[u8],
    ) -> Result<(), bun_core::Error> {
        bun_install::lifecycle_script_runner::replace_package_manager_run(copy_script, script)
    }

    /// Port of `runPackageScriptForeground` (run_command.zig:209). Spawns the
    /// script body via the bun-shell or system shell and exits on non-zero.
    ///
    /// PORT NOTE: `allocator` parameter dropped (PORTING.md §Allocators —
    /// always global mimalloc); `passthrough` is `&[Box<[u8]>]` to match
    /// `ctx.passthrough` directly (Zig was `[]const string`).
    pub fn run_package_script_foreground(
        ctx: &mut ContextData,
        original_script: &[u8],
        name: &[u8],
        cwd: &[u8],
        env: &mut DotEnv::Loader<'_>,
        passthrough: &[Box<[u8]>],
        silent: bool,
        use_system_shell: bool,
    ) -> Result<(), bun_core::Error> {
        let shell_bin = Self::find_shell(env.get(b"PATH").unwrap_or(b""), cwd)
            .ok_or(bun_core::err!("MissingShell"))?;
        env.map
            .put(b"npm_lifecycle_event", name)
            .expect("unreachable");
        env.map
            .put(b"npm_lifecycle_script", original_script)
            .expect("unreachable");

        let mut copy_script_capacity: usize = original_script.len();
        for part in passthrough {
            copy_script_capacity += 1 + part.len();
        }
        let mut copy_script: Vec<u8> = Vec::with_capacity(copy_script_capacity);

        // We're going to do this slowly.
        // Find exact matches of yarn, pnpm, npm

        Self::replace_package_manager_run(&mut copy_script, original_script)?;

        for part in passthrough {
            copy_script.push(b' ');
            if needs_escape_utf8_ascii_latin1(part) {
                escape_8bit::<true>(part, &mut copy_script).unwrap_or_oom();
                continue;
            }
            copy_script.extend_from_slice(part);
        }

        bun_core::scoped_log!(RUN_LOG, "Script: \"{}\"", bstr::BStr::new(&copy_script));

        if !silent {
            Output::command(Output::CommandArgv::Single(&copy_script));
            Output::flush();
        }

        if !use_system_shell {
            // SAFETY: `MiniEventLoop` stores `env` as a raw `*mut`; the loader
            // outlives the call (process-lifetime in `configure_env_for_run`).
            // Erase the loader's borrowed lifetime to `'static` for the
            // singleton handoff (Zig passed a raw `*DotEnv.Loader`).
            let mini = bun_event_loop::MiniEventLoop::init_global(
                Some(unsafe {
                    &mut *std::ptr::from_mut::<DotEnv::Loader<'_>>(env)
                        .cast::<DotEnv::Loader<'static>>()
                }),
                Some(cwd),
            );
            // SAFETY: `init_global` returns the thread-local singleton as a raw
            // pointer (Zig `*MiniEventLoop`); reborrow `&'static mut` for the
            // duration of `init_and_run_from_source` — single-threaded mini loop,
            // no aliasing `&mut` exists across this call.
            let mini = unsafe { &mut *mini };
            let code = match crate::shell::Interpreter::init_and_run_from_source(
                ctx,
                mini,
                name,
                &copy_script,
                Some(cwd),
            ) {
                Ok(c) => c,
                Err(err) => {
                    if !silent {
                        pretty_errorln!(
                            "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                            bstr::BStr::new(name),
                            bstr::BStr::new(err.name()),
                        );
                    }
                    Global::exit(1);
                }
            };

            if code > 0 {
                if code != 2 && !silent {
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> script <b>\"{}\"<r> exited with code {}<r>",
                        bstr::BStr::new(name),
                        code,
                    );
                    Output::flush();
                }
                Global::exit(code as u32);
            }
            return Ok(());
        }

        use crate::api::bun_process::{Status as SpawnStatus, sync};

        let argv: Vec<Box<[u8]>> = vec![
            shell_bin.as_bytes().to_vec().into_boxed_slice(),
            if cfg!(windows) {
                b"/c".as_slice()
            } else {
                b"-c".as_slice()
            }
            .to_vec()
            .into_boxed_slice(),
            copy_script.clone().into_boxed_slice(),
        ];

        #[cfg(not(windows))]
        let ipc_fd: Option<bun_sys::Fd> = bun_core::env_var::NODE_CHANNEL_FD.get().and_then(|s| {
            bun_core::fmt::parse_int::<u32>(s, 10)
                .ok()
                .and_then(|fd| i32::try_from(fd).ok().map(bun_sys::Fd::from_native))
        });
        #[cfg(windows)]
        let ipc_fd: Option<bun_sys::Fd> = None; // TODO: implement on Windows

        // TODO: remember to free this when we add --filter or --concurrent
        // in the meantime we don't need to free it.
        let envp = env.map.create_null_delimited_env_map()?;

        let spawn_result = match sync::spawn(&sync::Options {
            argv,
            argv0: Some(shell_bin.as_ptr().cast::<::core::ffi::c_char>()),
            envp: Some(envp.as_ptr().cast::<*const ::core::ffi::c_char>()),
            cwd: cwd.to_vec().into_boxed_slice(),
            stderr: sync::SyncStdio::Inherit,
            stdout: sync::SyncStdio::Inherit,
            stdin: sync::SyncStdio::Inherit,
            ipc: ipc_fd,
            #[cfg(windows)]
            windows: crate::api::bun_process::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init_mini(
                    bun_event_loop::MiniEventLoop::init_global(
                        // SAFETY: same lifetime erasure as the `!use_system_shell`
                        // branch above — `env` outlives the mini event loop.
                        Some(unsafe {
                            &mut *::core::ptr::from_mut::<DotEnv::Loader<'_>>(env)
                                .cast::<DotEnv::Loader<'static>>()
                        }),
                        None,
                    ),
                ),
                ..Default::default()
            },
            ..Default::default()
        }) {
            Err(err) => {
                if !silent {
                    pretty_errorln!(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                        bstr::BStr::new(name),
                        bstr::BStr::new(err.name()),
                    );
                }
                Output::flush();
                return Ok(());
            }
            Ok(Err(err)) => {
                if !silent {
                    pretty_errorln!(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error:\n{}",
                        bstr::BStr::new(name),
                        err,
                    );
                }
                Output::flush();
                return Ok(());
            }
            Ok(Ok(result)) => result,
        };

        match spawn_result.status {
            SpawnStatus::Exited(exit_code) => {
                // Zig: `exit_code.signal.valid() && != .SIGINT` — `.signal` is a
                // raw `u8` here; `signal_code()` range-checks 1..=31 (i.e. valid).
                if let Some(sig) = spawn_result.status.signal_code() {
                    if sig != bun_core::SignalCode::SIGINT && !silent {
                        pretty_errorln!(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> was terminated by signal {}<r>",
                            bstr::BStr::new(name),
                            bun_sys::SignalCode(sig as u8).fmt(Output::enable_ansi_colors_stderr()),
                        );
                        Output::flush();

                        if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN
                            .get()
                            == Some(true)
                        {
                            bun_crash_handler::suppress_reporting();
                        }

                        Global::raise_ignoring_panic_handler(sig);
                    }
                }

                if exit_code.code != 0 {
                    if exit_code.code != 2 && !silent {
                        pretty_errorln!(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> exited with code {}<r>",
                            bstr::BStr::new(name),
                            exit_code.code,
                        );
                        Output::flush();
                    }

                    Global::exit(exit_code.code as u32);
                }
            }

            SpawnStatus::Signaled(_) => {
                // Zig: only the *print* is gated on `signal.valid()`;
                // `suppressReporting` + `raiseIgnoringPanicHandler(signal)`
                // run unconditionally (run_command.zig:342-353).
                let signal_code = spawn_result.status.signal_code();
                if let Some(sig) = signal_code {
                    if sig != bun_core::SignalCode::SIGINT && !silent {
                        pretty_errorln!(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> was terminated by signal {}<r>",
                            bstr::BStr::new(name),
                            bun_sys::SignalCode(sig as u8).fmt(Output::enable_ansi_colors_stderr()),
                        );
                        Output::flush();
                    }
                }

                if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get()
                    == Some(true)
                {
                    bun_crash_handler::suppress_reporting();
                }

                if let Some(sig) = signal_code {
                    Global::raise_ignoring_panic_handler(sig);
                }
                // `.signaled` always carries 1..=31 in practice; fallback only
                // for type-totality (Zig re-raised the raw u8 unconditionally).
                Global::exit(1);
            }

            SpawnStatus::Err(ref err) => {
                if !silent {
                    pretty_errorln!(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error:\n{}",
                        bstr::BStr::new(name),
                        err,
                    );
                }

                Output::flush();
                return Ok(());
            }

            _ => {}
        }

        Ok(())
    }

    /// Port of `configureEnvForRun` (run_command.zig:772). Allocates a
    /// process-lifetime `Transpiler`, primes its resolver/env, reads the
    /// top-level `DirInfo`, configures the bundler linker / JSX runtime, and
    /// seeds the `npm_*` env vars.
    ///
    /// Returns a raw `*mut DirInfo` borrowed from the resolver's directory
    /// cache (process-lifetime; Zig returned `*DirInfo`).
    ///
    /// Hot-path note: the common `bun run <package.json script>` case never
    /// transpiles anything through this `Transpiler` (it shells out / boots a
    /// fresh VM with its own transpiler), so it should call
    /// [`Self::configure_env_for_run_without_linker`] instead — that skips the
    /// `configure_linker()` + `load_tsconfig_json` work, which is the single
    /// largest block of bundler/linker code otherwise faulted in by `bun run`.
    pub fn configure_env_for_run(
        ctx: &mut ContextData,
        this_transpiler: &mut ::core::mem::MaybeUninit<Transpiler<'static>>,
        env: Option<*mut DotEnv::Loader<'static>>,
        log_errors: bool,
        store_root_fd: bool,
    ) -> Result<bun_resolver::DirInfoRef, bun_core::Error> {
        Self::configure_env_for_run_impl(ctx, this_transpiler, env, log_errors, store_root_fd, true)
    }

    /// Like [`Self::configure_env_for_run`] but does **not** construct the
    /// bundler linker or enable `load_tsconfig_json` — for callers that only
    /// use the returned `Transpiler` for module resolution / env / `$PATH`
    /// lookup (the `bun run <script>` dispatch path), never for transpiling.
    pub fn configure_env_for_run_without_linker(
        ctx: &mut ContextData,
        this_transpiler: &mut ::core::mem::MaybeUninit<Transpiler<'static>>,
        env: Option<*mut DotEnv::Loader<'static>>,
        log_errors: bool,
        store_root_fd: bool,
    ) -> Result<bun_resolver::DirInfoRef, bun_core::Error> {
        Self::configure_env_for_run_impl(ctx, this_transpiler, env, log_errors, store_root_fd, false)
    }

    /// `configure_linker()` + `load_tsconfig_json` setup, factored into a
    /// `#[cold]` callee so the bundler-linker/JSX-runtime code it pulls in does
    /// not share `.text` pages with the hot `bun run <script>` dispatch path.
    #[cold]
    #[inline(never)]
    #[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
    fn configure_run_transpiler_linker(this_transpiler: &mut Transpiler<'static>) {
        this_transpiler.resolver.opts.load_tsconfig_json = true;
        this_transpiler.options.load_tsconfig_json = true;
        this_transpiler.configure_linker();
    }

    fn configure_env_for_run_impl(
        ctx: &mut ContextData,
        this_transpiler: &mut ::core::mem::MaybeUninit<Transpiler<'static>>,
        env: Option<*mut DotEnv::Loader<'static>>,
        log_errors: bool,
        store_root_fd: bool,
        with_linker: bool,
    ) -> Result<bun_resolver::DirInfoRef, bun_core::Error> {
        let args = ctx.args.clone();
        let env_is_none = env.is_none();
        // PORT NOTE: process-lifetime arena singleton for the runner's
        // transpiler. Zig passed `ctx.allocator` (== `bun.default_allocator`);
        // the Rust port threads an `&'static Arena` per PORTING.md §AST crates.
        // TODO(port): allocator — collapse once Transpiler::init drops the arena arg.
        let arena: &'static bun_alloc::Arena = runner_arena();
        // PORT NOTE: out-param constructor — Zig: `var this_transpiler: Transpiler
        // = undefined;` then `configureEnvForRun` writes the whole struct.
        // `Transpiler` holds `&Arena`/`Box`/enum fields (non-null invariants),
        // so callers MUST pass a `MaybeUninit` slot (PORTING.md §std.mem.zeroes).
        this_transpiler.write(Transpiler::init(arena, ctx.log, args, env)?);
        // SAFETY: fully written on the line above.
        let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        let env_loader = this_transpiler.env_mut();
        env_loader.quiet = true;
        this_transpiler.options.env.prefix = Box::default();

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        // Bundler-linker + JSX-runtime config: only callers that actually
        // transpile through this `Transpiler` need it. `configure_linker`'s
        // auto-JSX step reads the cwd `DirInfo` (and, with `load_tsconfig_json`
        // on, its `tsconfig.json`) — keep it ahead of the `read_dir_info` below
        // so that read populates/uses the same cache entry, matching Zig's
        // `configureEnvForRun` ordering exactly.
        if with_linker {
            Self::configure_run_transpiler_linker(this_transpiler);
        }

        // SAFETY: `Transpiler::init` always sets `fs` to the process singleton.
        let top_level_dir = unsafe { (*this_transpiler.fs).top_level_dir };
        let root_dir_info: bun_resolver::DirInfoRef =
            match this_transpiler.resolver.read_dir_info(top_level_dir) {
                Err(err) => {
                    if !log_errors {
                        return Err(bun_core::err!("CouldntReadCurrentDirectory"));
                    }
                    // SAFETY: `ctx.log` set in `create_context_data` (single-
                    // threaded CLI startup), process-lifetime.
                    let _ = unsafe { ctx.log() }.print(std::ptr::from_mut::<bun_core::io::Writer>(
                        Output::error_writer(),
                    ));
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>{}<r> loading directory {}",
                        bstr::BStr::new(err.name()),
                        bun_core::fmt::QuotedFormatter {
                            text: top_level_dir
                        },
                    );
                    Output::flush();
                    return Err(err);
                }
                Ok(None) => {
                    // SAFETY: see `Err` arm above.
                    let _ = unsafe { ctx.log() }.print(std::ptr::from_mut::<bun_core::io::Writer>(
                        Output::error_writer(),
                    ));
                    pretty_errorln!("error loading current directory");
                    Output::flush();
                    return Err(bun_core::err!("CouldntReadCurrentDirectory"));
                }
                Ok(Some(info)) => info,
            };

        this_transpiler.resolver.store_fd = false;

        if env_is_none {
            // Re-derive — borrowck won't let `env_loader` straddle the
            // `&mut this_transpiler.resolver` above. Scoped to this block so it
            // does NOT straddle `run_env_loader` below (which itself derives
            // `env_mut()`, popping any outstanding `&mut Loader` tag).
            let env_loader = this_transpiler.env_mut();
            env_loader.load_process()?;

            if let Some(node_env) = env_loader.get(b"NODE_ENV") {
                if node_env == b"production" {
                    this_transpiler.options.production = true;
                }
            }

            // Always skip default .env files for package.json script runner
            // (see comment in env_loader.zig:542-548 - the script's own bun instance loads .env)
            let _ = this_transpiler.run_env_loader(true);
        }

        // Re-derive after `run_env_loader` — that call creates its own
        // `env_mut()` borrow, which under Stacked Borrows invalidates any
        // `&mut Loader` derived before it. Zig spec run_command.zig:820-823
        // re-dereferences `this_transpiler.env` per-statement; mirror that by
        // taking a fresh borrow here for the remaining env-var seeding.
        let env_loader = this_transpiler.env_mut();

        env_loader
            .map
            .put_default(b"npm_config_local_prefix", top_level_dir)
            .expect("unreachable");

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_io::ParentDeathWatchdog::is_enabled() {
            env_loader
                .map
                .put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1")
                .expect("unreachable");
        }

        // we have no way of knowing what version they're expecting without running the node executable
        // running the node executable is too slow
        // so we will just hardcode it to LTS
        env_loader
            .map
            .put_default(
                b"npm_config_user_agent",
                // the use of npm/? is copying yarn
                // e.g.
                // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
                const_format::concatcp!(
                    "bun/",
                    Global::package_json_version,
                    " npm/? node/v",
                    Environment::REPORTED_NODEJS_VERSION,
                    " ",
                    Global::os_name,
                    " ",
                    Global::arch_name
                )
                .as_bytes(),
            )
            .expect("unreachable");

        if env_loader.get(b"npm_execpath").is_none() {
            // we don't care if this fails
            if let Ok(self_exe_path) = bun_core::self_exe_path() {
                env_loader
                    .map
                    .put_default(b"npm_execpath", self_exe_path.as_bytes())
                    .expect("unreachable");
            }
        }

        if let Some(package_json) = root_dir_info.enclosing_package_json {
            if !package_json.name.is_empty() {
                if env_loader.map.get(NpmArgs::PACKAGE_NAME).is_none() {
                    env_loader
                        .map
                        .put(NpmArgs::PACKAGE_NAME, &package_json.name)
                        .expect("unreachable");
                }
            }

            env_loader
                .map
                .put_default(b"npm_package_json", package_json.source.path.text)
                .expect("unreachable");

            if !package_json.version.is_empty() {
                if env_loader.map.get(NpmArgs::PACKAGE_VERSION).is_none() {
                    env_loader
                        .map
                        .put(NpmArgs::PACKAGE_VERSION, &package_json.version)
                        .expect("unreachable");
                }
            }

            if let Some(config) = package_json.config.as_deref() {
                env_loader.map.ensure_unused_capacity(config.count())?;
                for (k, v) in config.keys().iter().zip(config.values().iter()) {
                    let key = strings::concat(&[b"npm_package_config_", &k[..]]);
                    // PERF(port): was assume_capacity
                    env_loader.map.put_assume_capacity(&key, *v);
                }
            }
        }

        Ok(root_dir_info)
    }

    /// Best-effort default-loader lookup by file extension. Thin forwarder to
    /// `bun_bundler::options::DEFAULT_LOADERS` (the *file-extension*→Loader map
    /// at options.zig:1041 — NOT `Loader::NAMES`, which is the *loader-name*
    /// table and has different membership, e.g. `.sh` is unconditional there
    /// but Windows-only in `defaultLoaders`). Single source of truth so this
    /// file cannot drift from options.zig.
    #[inline]
    fn default_loader_for(target: &[u8]) -> Option<Loader> {
        bun_bundler::options::DEFAULT_LOADERS
            .get(paths::extension(target))
            .copied()
    }

    /// Shared ctx→transpiler/resolver option projection used by [`boot`] and
    /// [`boot_standalone`] (bun.js.zig:64-98 / :247-275 — the two bodies are
    /// byte-identical in Zig).
    fn wire_transpiler_from_ctx(b: &mut Transpiler<'_>, ctx: &mut ContextData) {
        use bun_options_types::context::MacroOptions;
        use bun_options_types::offline_mode::OfflineMode;

        // PORT NOTE: `BundleOptions::install` is a raw `NonNull` backref into
        // the CLI's `Box<BunInstall>` (process-lifetime — Zig stored the raw
        // `?*BunInstall`). `as_deref` yields `&BunInstall`, which
        // `NonNull::from` converts without the lifetime tie.
        let install_ptr = ctx.install.as_deref().map(::core::ptr::NonNull::from);
        b.options.install = install_ptr;
        // resolver's `BundleOptions.install` is the FORWARD_DECL `*const ()`
        // (breaks the bun_install dep cycle) — erase the type.
        b.resolver.opts.install =
            install_ptr.map_or(::core::ptr::null(), |p| p.as_ptr().cast::<()>());
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        let offline = ctx
            .debug
            .offline_mode_setting
            .unwrap_or(OfflineMode::Online);
        b.resolver.opts.prefer_offline_install = offline == OfflineMode::Offline;
        // PORT NOTE: resolver's forward-decl `BundleOptions` lacks
        // `prefer_latest_install`; only the bundler-side mirror carries it.
        b.options.global_cache = ctx.debug.global_cache;
        b.options.prefer_offline_install = offline == OfflineMode::Offline;
        b.options.prefer_latest_install = offline == OfflineMode::Latest;
        b.resolver.env_loader = ::core::ptr::NonNull::new(b.env);

        b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
        // PORT NOTE: resolver's forward-decl `BundleOptions` does not project
        // `minify_*` (resolver never reads them); Zig assigned both because the
        // resolver carried the full struct.

        match &mut ctx.debug.macros {
            MacroOptions::Disable => b.options.no_macros = true,
            MacroOptions::Map(macros) => {
                // PORT NOTE: `ContextData::MacroMap` and
                // `BundleOptions::macro_remap` are both
                // `ArrayHashMap<Box<[u8]>, ArrayHashMap<Box<[u8]>, Box<[u8]>>>`
                // but with different hasher contexts (`Auto` vs
                // `BoxedSliceContext`), so re-seat by iterating instead of move.
                // Cold path (only hit when bunfig declares `[macros]`).
                for (k, v) in macros.iter() {
                    let mut inner =
                        bun_resolver::package_json::MacroImportReplacementMap::default();
                    for (ik, iv) in v.iter() {
                        inner.put(ik, iv.clone()).unwrap_or_oom();
                    }
                    b.options.macro_remap.put(k, inner).unwrap_or_oom();
                }
            }
            MacroOptions::Unspecified => {}
        }
    }

    /// `Run.doPreconnect` (bun.js.zig:114) — kick off TCP preconnects for
    /// `--preconnect <url>` before the entry module loads.
    fn do_preconnect(preconnect: &[Box<[u8]>]) {
        if preconnect.is_empty() {
            return;
        }
        bun_http::http_thread::init(&Default::default());

        for url_str in preconnect {
            // SAFETY: `ctx.runtime_options.preconnect` is process-lifetime
            // (CLI argv-derived, never freed); erase the borrow lifetime so
            // `URL<'static>` (which `AsyncHTTP::preconnect` requires) can hold
            // a backref into it.
            let url_str: &'static [u8] =
                unsafe { ::core::slice::from_raw_parts(url_str.as_ptr(), url_str.len()) };
            let url = bun_url::URL::parse(url_str);

            if !url.is_http() && !url.is_https() {
                bun_core::err_generic!(
                    "preconnect URL must be HTTP or HTTPS: {}",
                    bun_core::fmt::quote(url_str),
                );
                Global::exit(1);
            }
            if url.hostname.is_empty() {
                bun_core::err_generic!(
                    "preconnect URL must have a hostname: {}",
                    bun_core::fmt::quote(url_str),
                );
                Global::exit(1);
            }
            if !url.has_valid_port() {
                bun_core::err_generic!(
                    "preconnect URL must have a valid port: {}",
                    bun_core::fmt::quote(url_str),
                );
                Global::exit(1);
            }

            bun_http::async_http::preconnect(url, false);
        }
    }

    /// Port of `bun_js.Run.bootBunShell` (src/bun.js.zig:142) — run a `.sh`
    /// entry point through the bun-shell on a `MiniEventLoop` without ever
    /// initializing JSC.
    #[cold]
    #[inline(never)]
    #[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
    fn boot_bun_shell(
        ctx: &mut ContextData,
        entry_path: &[u8],
    ) -> Result<crate::shell::ExitCode, bun_core::Error> {
        // Dummy transpiler so we can load .env (Zig: "this is a hack").
        let mut args = ctx.args.clone();
        args.write = Some(false);
        args.resolve = Some(api::ResolveMode::Lazy);
        args.target = Some(api::Target::Bun);
        let mut bundle = Transpiler::init(runner_arena(), ctx.log, args, None)?;
        bundle.run_env_loader(bundle.options.env.disable_default_env_files)?;

        let top_level_dir: &[u8] = ctx.args.absolute_working_dir.as_deref().unwrap_or(b"");
        let mini = bun_event_loop::MiniEventLoop::init_global(
            // SAFETY: `bundle.env` points to the process-lifetime DotEnv
            // singleton (set by `Transpiler::init`); erasing the borrowed
            // lifetime mirrors the `run_package_script_foreground` handoff.
            Some(unsafe { &mut *bundle.env.cast::<DotEnv::Loader<'static>>() }),
            None,
        );
        // SAFETY: `init_global` returns the thread-local singleton; single-
        // threaded mini loop, no aliasing `&mut` exists across this call.
        let mini = unsafe { &mut *mini };
        mini.top_level_dir = Box::<[u8]>::from(top_level_dir);

        // `initAndRunFromFile`: read source then hand off to the interpreter.
        let mut path_buf = PathBuffer::uninit();
        path_buf[..entry_path.len()].copy_from_slice(entry_path);
        path_buf[entry_path.len()] = 0;
        // SAFETY: NUL-terminated above; `path_buf` outlives the call.
        let path_z = ZStr::from_buf(&path_buf[..], entry_path.len());
        let src = match sys::File::read_from(Fd::cwd(), path_z) {
            Ok(bytes) => bytes,
            Err(err) => return Err(err.into()),
        };

        crate::shell::Interpreter::init_and_run_from_file(ctx, mini, entry_path, &src)
    }

    /// Port of `bun_js.Run.boot` (src/bun.js.zig) — `VirtualMachine::init`,
    /// hand off CLI state, then enter `Run::start` under the JSC API lock.
    pub(crate) fn boot(
        ctx: &mut ContextData,
        entry_path: Box<[u8]>,
        loader: Option<Loader>,
    ) -> Result<(), bun_core::Error> {
        if !ctx.debug.loaded_bunfig {
            arguments::load_config_path(
                CommandTag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            )?;
        }

        // The shell does not need to initialize JSC (saves 1-3ms).
        if strings::has_suffix_comptime(&entry_path, b".sh") {
            let exit_code = Self::boot_bun_shell(ctx, &entry_path)?;
            Global::exit(exit_code as u32);
        }

        // PORT NOTE: `jsc::initialize(false)` + `Expr/Stmt::Store::create()` +
        // `MimallocArena::init()` precede VM init in Zig. `bun_jsc::initialize`
        // is now real (calls `JSCInitialize` over `bun_sys::environ()`); the
        // dispatch hooks (`jsc_hooks::install_jsc_hooks`) are installed by
        // `main.rs` before `Cli::start`, so `VirtualMachine::init` already sees
        // a populated `RuntimeHooks` table.
        bun_jsc::initialize(ctx.runtime_options.eval.eval_and_print);
        bun_ast::initialize_store();

        let vm_ptr = VirtualMachine::init(VmInitOptions {
            transform_options: ctx.args.clone(),
            log: ::core::ptr::NonNull::new(ctx.log),
            debugger: ::core::mem::take(&mut ctx.runtime_options.debugger),
            smol: ctx.runtime_options.smol,
            mini_mode: ctx.runtime_options.smol,
            eval_mode: ctx.runtime_options.eval.eval_and_print,
            is_main_thread: true,
            ..Default::default()
        })?;
        // SAFETY: `init` returns the unique freshly-boxed VM on this thread.
        let vm = unsafe { &mut *vm_ptr };

        // PORT NOTE: `vm.preload`/`vm.argv` are `Vec<Box<[u8]>>` on both sides;
        // hand the CLI's vectors over wholesale (process-lifetime, never freed).
        vm.preload = std::mem::take(&mut ctx.preloads);
        vm.argv = std::mem::take(&mut ctx.passthrough);
        // Zig passes `store_fd = ctx.debug.hot_reload != .none` to `init`;
        // `InitOptions` lacks the field so set it on the resolver directly.
        vm.transpiler.resolver.store_fd = ctx.debug.hot_reload != cli::command::HotReload::None;
        // PORT NOTE: `vm.dns_result_order` is a `u8` until the b2-cycle widens
        // it to `bun_dns::Order`; the enum is `#[repr(u8)]` so `as u8` is the
        // exact `@intFromEnum` Zig would have done.
        vm.dns_result_order =
            bun_dns::Order::from_string_or_die(&ctx.runtime_options.dns_result_order) as u8;
        // `vm.main` is a BACKREF into these bytes; convert the `Box` to a raw
        // heap pointer now (Zig: `allocator.dupe` + never-free) so the address
        // is stable for both `set_main` and the `RUN` write below. The runner
        // never returns, so the allocation is process-lifetime by construction.
        // `mut` because the cron-execution branch below may swap in a synthetic
        // `cwd/[eval]` path (Zig: `run.entry_path = heap_entry_path`).
        let mut entry_ptr: *const [u8] = bun_core::heap::into_raw(entry_path);
        // SAFETY: freshly-allocated heap bytes, never freed (see above).
        let entry: &[u8] = unsafe { &*entry_ptr };
        vm.set_main(entry);

        if !ctx.runtime_options.eval.script.is_empty() {
            // PORT NOTE: `ctx.runtime_options.eval.script` is process-lifetime
            // (CLI argv); erase the borrow lifetime so the `Source` (stored in
            // the VM for the process duration) can backref into it.
            let script: &'static [u8] = unsafe {
                ::core::slice::from_raw_parts(
                    ctx.runtime_options.eval.script.as_ptr(),
                    ctx.runtime_options.eval.script.len(),
                )
            };
            vm.module_loader.eval_source =
                Some(Box::new(bun_ast::Source::init_path_string(entry, script)));
            if ctx.runtime_options.eval.eval_and_print {
                vm.transpiler.options.dead_code_elimination = false;
            }
        } else if !ctx.runtime_options.cron_title.is_empty()
            && !ctx.runtime_options.cron_period.is_empty()
        {
            // Cron execution mode (bun.js.zig:213-244): wrap the entry point in
            // a script that imports the module and calls
            // `default.scheduled(controller)`. The synthetic source is keyed at
            // `cwd/[eval]` so the module loader serves it from `eval_source`.
            let escaped_path = escape_for_js_string(entry);
            let escaped_period = escape_for_js_string(&ctx.runtime_options.cron_period);
            let cron_script = format!(
                "const mod = await import(\"{path}\");\n\
                 const scheduled = (mod.default || mod).scheduled;\n\
                 if (typeof scheduled !== \"function\") throw new Error(\"Module does not export default.scheduled()\");\n\
                 const controller = {{ cron: \"{period}\", type: \"scheduled\", scheduledTime: Date.now() }};\n\
                 await scheduled(controller);\n",
                path = bstr::BStr::new(&escaped_path),
                period = bstr::BStr::new(&escaped_period),
            );
            // PORT NOTE: process-lifetime (runner never returns) — store both
            // the script bytes and the synthetic entry path in the runner arena
            // so the `Source` stored in the VM can backref into them (Zig:
            // `allocPrint` + `dupe` + never-free).
            let cron_script: &'static [u8] =
                runner_arena().alloc_slice_copy(cron_script.as_bytes());

            // entry_path must end with /[eval] for the transpiler to use eval_source
            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd(&mut cwd_buf)?;
            let cwd_bytes = cwd.as_bytes();
            let mut eval_path: Vec<u8> = Vec::with_capacity(cwd_bytes.len() + EVAL_TRIGGER.len());
            eval_path.extend_from_slice(cwd_bytes);
            eval_path.extend_from_slice(EVAL_TRIGGER);
            let heap_entry: &'static [u8] = runner_arena().alloc_slice_copy(&eval_path);

            vm.module_loader.eval_source = Some(Box::new(bun_ast::Source::init_path_string(
                heap_entry,
                cron_script,
            )));
            // Zig: `run.entry_path = heap_entry_path` — override what
            // `Run::start` will pass to `vm.load_entry_point`.
            entry_ptr = std::ptr::from_ref::<[u8]>(heap_entry);
            vm.set_main(heap_entry);
        }

        // ctx → transpiler/resolver option mapping (bun.js.zig:247-275).
        // PORT NOTE: reshaped for borrowck — `b` borrows `vm.transpiler`
        // exclusively; `fail_with_build_error(vm)` needs the whole `vm`, so
        // capture the defines result, drop `b`, then branch.
        let defines_ok = {
            let b = &mut vm.transpiler;
            Self::wire_transpiler_from_ctx(b, ctx);
            b.options.env.behavior = api::DotEnvBehavior::LoadAllWithoutInlining;
            b.configure_defines().is_ok()
        };
        if !defines_ok {
            crate::run_main::fail_with_build_error(vm);
        }

        // Allow setting a custom timezone. Without `$TZ`, JSC/ICU lazily
        // auto-detects the host zone the first time a `Date` is constructed —
        // matching upstream Bun. `.env` files are loaded by
        // `configure_defines` above, so `$TZ` set in one is honored.
        if let Some(tz) = vm.env_loader().get(b"TZ") {
            if !tz.is_empty() {
                let _ = vm
                    .global()
                    .set_time_zone(&bun_jsc::zig_string::ZigString::init(tz));
            }
        }

        // Zig: `AsyncHTTP.loadEnv(allocator, vm.log, b.env)`.
        // SAFETY: `vm.log` set in `init`; `b.env` is the long-lived
        // `DotEnv::Loader` allocated/retained for the VM (never null after
        // `Transpiler::init`).
        bun_http::async_http::load_env(unsafe { vm.log.unwrap().as_mut() }, vm.env_loader());

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        bun_jsc::virtual_machine::IS_MAIN_THREAD_VM.set(true);

        vm.env_loader().load_tracy();

        bun_http::EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http2_fetch,
            ::core::sync::atomic::Ordering::Relaxed,
        );
        bun_http::EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http3_fetch,
            ::core::sync::atomic::Ordering::Relaxed,
        );
        Self::do_preconnect(&ctx.runtime_options.preconnect);

        // Zig: `vm.main_is_html_entrypoint = (loader orelse
        //   vm.transpiler.options.loader(ext)) == .html`.
        vm.main_is_html_entrypoint = loader
            .unwrap_or_else(|| vm.transpiler.options.loader(paths::extension(entry)))
            == Loader::Html;

        // ── enter `Run::start` under the JSC API lock ──────────────────────
        // Zig: `vm.global.vm().holdAPILock(&run, OpaqueWrap(Run, Run.start))`.
        // SAFETY: `RUN` is the process-global singleton (Zig: `var run: Run`);
        // written exactly once here on the main thread before the API-lock
        // trampoline reads it, never freed (`global_exit` ends the process).
        unsafe {
            RUN.get().write(Run {
                ctx: std::ptr::from_mut::<ContextData>(ctx),
                vm: vm_ptr,
                entry_path: entry_ptr,
            });
        }
        // PORT NOTE: `ctx.debug.hot_reload` → `vm.hot_reload` (a `u8` until the
        // b2-cycle widens it to `cli::HotReload`); `Run::start` re-reads it
        // from `self.ctx` to drive the hot-reloader enable.
        vm.hot_reload = ctx.debug.hot_reload as u8;

        extern "C" fn trampoline(ctx: *mut c_void) {
            // SAFETY: `ctx` is `&mut RUN` passed through `holdAPILock`'s
            // opaque slot; the API lock is held for the full call so no
            // other thread touches the VM.
            let this = unsafe { &mut *ctx.cast::<Run>() };
            this.start();
        }
        // SAFETY: `vm.global` set in `init`; `vm()` borrows the JSC VM for
        // the API-lock FFI call. `&raw mut RUN` yields a stable raw pointer
        // to the static.
        #[allow(deprecated)]
        vm.global()
            .vm()
            .hold_api_lock(RUN.get().cast::<c_void>(), trampoline);

        // `Run::start` never returns (ends in `global_exit`); this is dead
        // code kept so the type unifies with the `?`-early-return above.
        Ok(())
    }

    /// Port of `bun_js.Run.bootStandalone` (src/bun.js.zig:27) — entry point for
    /// `bun build --compile` executables. Mirrors [`boot`] but routes through
    /// `VirtualMachine::init_with_module_graph` and applies the standalone
    /// runtime flags from the embedded graph before entering `Run::start`.
    pub(crate) fn boot_standalone(
        ctx: &mut ContextData,
        entry_path: Box<[u8]>,
        graph: &mut bun_standalone_graph::Graph,
    ) -> Result<(), bun_core::Error> {
        use bun_standalone_graph::StandaloneModuleGraph::Flags as GraphFlags;

        bun_jsc::initialize(false);
        bun_analytics::features::standalone_executable.fetch_add(1, Ordering::Relaxed);
        bun_ast::initialize_store();

        // Load bunfig.toml unless disabled by compile flags. Config loading
        // with execArgv is handled earlier in `Command::start` via `init()`.
        if !ctx.debug.loaded_bunfig && !graph.flags.contains(GraphFlags::DISABLE_AUTOLOAD_BUNFIG) {
            arguments::load_config_path(
                CommandTag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            )?;
        }

        // PORT NOTE: layering — `Options::graph` is the resolver's trait object
        // (`&'static dyn bun_resolver::StandaloneModuleGraph`); the concrete
        // `bun_standalone_graph::Graph` implements it. The graph is the
        // process-global singleton (`StandaloneModuleGraph::set` in
        // `cli_body.rs`), so erasing the borrow lifetime via raw-pointer
        // round-trip per PORTING.md §process-lifetime borrows is sound.
        // SAFETY: `graph` lives in the process-global INSTANCE static; never
        // freed (`global_exit` ends the process before any deinit).
        let graph_dyn: &'static dyn bun_resolver::StandaloneModuleGraph = unsafe {
            &*(std::ptr::from_ref::<bun_standalone_graph::Graph>(graph)
                as *const (dyn bun_resolver::StandaloneModuleGraph + 'static))
        };
        let vm_ptr = VirtualMachine::init_with_module_graph(bun_jsc::virtual_machine::Options {
            log: std::ptr::NonNull::new(ctx.log),
            args: ctx.args.clone(),
            graph: Some(graph_dyn),
            is_main_thread: true,
            smol: ctx.runtime_options.smol,
            // PORT NOTE: `Options::dns_result_order` is `u8` until the
            // b2-cycle widens it to `bun_dns::Order`; the enum is
            // `#[repr(u8)]` so `as u8` matches Zig's `@intFromEnum`.
            dns_result_order: bun_dns::Order::from_string_or_die(
                &ctx.runtime_options.dns_result_order,
            ) as u8,
            ..Default::default()
        })?;
        // SAFETY: `init_with_module_graph` returns the unique freshly-boxed VM
        // on this thread.
        let vm = unsafe { &mut *vm_ptr };

        vm.preload = std::mem::take(&mut ctx.preloads);
        vm.argv = std::mem::take(&mut ctx.passthrough);

        // `vm.main` is a BACKREF (`*const [u8]`) into `entry_path`'s heap
        // buffer; convert the `Box` to a raw heap pointer now (Zig:
        // `allocator.dupe` + never-free) so the address is stable for both
        // `set_main` and the `RUN` write below. The runner never returns, so
        // the allocation is process-lifetime by construction.
        let entry_ptr: *const [u8] = bun_core::heap::into_raw(entry_path);
        // SAFETY: freshly-allocated heap bytes, never freed (see above).
        vm.set_main(unsafe { &*entry_ptr });

        // PORT NOTE: reshaped for borrowck — `b` borrows `vm.transpiler`
        // exclusively; `fail_with_build_error(vm)` needs the whole `vm`, so
        // capture the defines result, drop `b`, then branch.
        let defines_ok = {
            let b = &mut vm.transpiler;
            Self::wire_transpiler_from_ctx(b, ctx);

            // `serve_plugins` / `bunfig_path` (standalone-only; bun.js.zig:80).
            b.options.serve_plugins = ctx.args.serve_plugins.take().map(Vec::into_boxed_slice);
            b.options.bunfig_path = ::core::mem::take(&mut ctx.args.bunfig_path);

            crate::run_main::apply_standalone_runtime_flags(b, graph);

            b.configure_defines().is_ok()
        };
        if !defines_ok {
            crate::run_main::fail_with_build_error(vm);
        }

        // Zig: `AsyncHTTP.loadEnv(allocator, vm.log, b.env)`.
        // SAFETY: `vm.log` set in `init`; `b.env` is the long-lived
        // `DotEnv::Loader` allocated/retained for the VM (never null after
        // `Transpiler::init`).
        bun_http::async_http::load_env(unsafe { vm.log.unwrap().as_mut() }, vm.env_loader());

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        bun_jsc::virtual_machine::IS_MAIN_THREAD_VM.set(true);

        bun_http::EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http2_fetch,
            ::core::sync::atomic::Ordering::Relaxed,
        );
        bun_http::EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http3_fetch,
            ::core::sync::atomic::Ordering::Relaxed,
        );
        Self::do_preconnect(&ctx.runtime_options.preconnect);

        // SAFETY: `RUN` is the process-global singleton (Zig: `var run: Run`);
        // written exactly once here on the main thread before the API-lock
        // trampoline reads it, never freed (`global_exit` ends the process).
        unsafe {
            RUN.get().write(Run {
                ctx: std::ptr::from_mut::<ContextData>(ctx),
                vm: vm_ptr,
                entry_path: entry_ptr,
            });
        }

        extern "C" fn trampoline(ctx: *mut c_void) {
            // SAFETY: `ctx` is `&mut RUN` passed through `holdAPILock`'s
            // opaque slot; the API lock is held for the full call.
            let this = unsafe { &mut *ctx.cast::<Run>() };
            this.start();
        }
        // SAFETY: `vm.global` set in `init`; `vm()` borrows the JSC VM for
        // the API-lock FFI call.
        #[allow(deprecated)]
        vm.global()
            .vm()
            .hold_api_lock(RUN.get().cast::<c_void>(), trampoline);

        // `Run::start` never returns; dead code for `?`-early-return type unify.
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `Run` — port of `src/bun.js.zig` `Run`. The canonical (and only) Rust
// definition lives here so the CLI dispatch path can drive the event loop
// without a crate-cycle; `crate::run_main` re-exports it for callers that
// expect the Zig `bun.js.Run` namespace.
// ──────────────────────────────────────────────────────────────────────────

pub struct Run {
    /// `Command.Context` (a `*ContextData` newtype in Zig). The CLI's
    /// `ContextData` is parse-once / process-lifetime; `boot()` writes the raw
    /// pointer here so [`Run::start`] can read profiler / preconnect /
    /// hot-reload flags under the API lock without re-threading every field.
    ctx: *mut ContextData,
    vm: *mut VirtualMachine,
    /// Heap bytes (from `boot`'s `heap::alloc`, matching Zig's
    /// `allocator.dupe` + never-free) or a borrow into the standalone graph's
    /// `entryPoint().name` (from `boot_standalone`). Either way the bytes live
    /// for the process — `Run::start` never returns — so a raw `*const [u8]`
    /// matches Zig's `entry_path: string` exactly without forcing a `'static`
    /// borrow or a `MaybeUninit` static for `Box<[u8]>`.
    entry_path: *const [u8],
}

// Zig: `var run: Run = undefined;` — process-global, written once in `boot`.
// PORTING.md §Global mutable state: `Run` is `!Sync` (raw ptrs); RacyCell so
// `boot`/`boot_standalone` can `ptr::write` it on the single CLI thread and
// the `holdAPILock` trampoline can re-derive `&mut Run` from the static.
static RUN: bun_core::RacyCell<Run> = bun_core::RacyCell::new(Run {
    ctx: ::core::ptr::null_mut(),
    vm: ::core::ptr::null_mut(),
    entry_path: ::core::ptr::slice_from_raw_parts(::core::ptr::null(), 0),
});

// PORT NOTE: Zig writes `run.any_unhandled = true` from inside the
// unhandled-rejection callback while `Run::start` holds `&mut self` (via the
// `holdAPILock` trampoline). Storing the flag on `Run` and writing through a
// fresh `&raw mut RUN` would alias that exclusive borrow (PORTING.md
// §Forbidden — Stacked Borrows UB). Keep it as a sibling static instead so the
// callback's write and `start()`'s reads never overlap a `&mut`.
static ANY_UNHANDLED: AtomicBool = AtomicBool::new(false);

impl Run {
    /// `onUnhandledRejectionBeforeClose` — record that *something* rejected so
    /// `start()` sets a non-zero exit code, then route through the VM's
    /// default error printer.
    fn on_unhandled_rejection_before_close(
        this: &mut VirtualMachine,
        _global: &JSGlobalObject,
        value: JSValue,
    ) {
        // SAFETY: BORROW_PARAM ptr set by caller, outlives this call.
        let list = this
            .on_unhandled_rejection_exception_list
            .map(|p| unsafe { &mut *p.as_ptr() });
        this.run_error_handler(value, list);
        ANY_UNHANDLED.store(true, Ordering::Relaxed);
    }

    /// `Run.addConditionalGlobals` (bun.js.zig:562) — wire `--eval`/`--print`
    /// node-module globals and `--expose-gc` into the JSC global object.
    fn add_conditional_globals(&mut self) {
        unsafe extern "C" {
            fn Bun__ExposeNodeModuleGlobals(global: *const JSGlobalObject);
            fn JSC__JSGlobalObject__addGc(global: *const JSGlobalObject);
        }
        // SAFETY: `self.vm`/`self.ctx` are process-lifetime; written by
        // `boot()` before the API-lock trampoline runs.
        let vm = unsafe { &*self.vm };
        let ro = unsafe { &(*self.ctx).runtime_options };
        if !ro.eval.script.is_empty() {
            // SAFETY: FFI; `vm.global` is live for the VM lifetime.
            unsafe { Bun__ExposeNodeModuleGlobals(vm.global) };
        }
        if ro.expose_gc {
            // SAFETY: FFI; `vm.global` is live for the VM lifetime.
            unsafe { JSC__JSGlobalObject__addGc(vm.global) };
        }
    }

    /// `Run.start` — load the entry point, run the event loop until idle,
    /// fire `beforeExit`/`exit`, then `globalExit`. Called under the JSC API
    /// lock via `hold_api_lock`.
    #[allow(unused_assignments)] // `printed_…` writes before `global_exit` are intentional Zig-shape.
    fn start(&mut self) -> ! {
        // PORT NOTE: deref the raw VM/ctx pointers once so the rest of this
        // body can borrow `vm` and `ctx` alongside `self.entry_path`.
        // SAFETY: `self.vm` is the boxed-and-leaked main-thread VM; `self.ctx`
        // is the CLI's process-lifetime `ContextData`. Both are written by
        // `boot()`/`boot_standalone()` before the API-lock trampoline runs.
        let vm = unsafe { &mut *self.vm };
        let ctx = unsafe { &*self.ctx };
        // SAFETY: `entry_path` is process-lifetime (heap from `heap::alloc`
        // or a borrow into the standalone graph); deref to a `'static` slice
        // so `enable_hot_module_reloading` can store it without re-erasing.
        let mut entry: &'static [u8] = unsafe { &*self.entry_path };

        vm.hot_reload = ctx.debug.hot_reload as u8;
        vm.on_unhandled_rejection = Run::on_unhandled_rejection_before_close;

        // ── CPU profiler (bun.js.zig:316-331) ──────────────────────────────
        if ctx.runtime_options.cpu_prof.enabled {
            let opts = &ctx.runtime_options.cpu_prof;
            // SAFETY: `ctx` is process-lifetime; erase `Box<[u8]>` borrows to
            // `'static` for `CPUProfilerConfig` (Zig stored borrowed slices).
            vm.cpu_profiler_config = Some(bun_jsc::bun_cpu_profiler::CPUProfilerConfig {
                name: unsafe { &*std::ptr::from_ref::<[u8]>(opts.name.as_ref()) },
                dir: unsafe { &*std::ptr::from_ref::<[u8]>(opts.dir.as_ref()) },
                md_format: opts.md_format,
                json_format: opts.json_format,
                interval: opts.interval,
            });
            bun_jsc::bun_cpu_profiler::set_sampling_interval(opts.interval);
            // SAFETY: `vm.jsc_vm` set in `init`.
            bun_jsc::bun_cpu_profiler::start_cpu_profiler(unsafe { &mut *vm.jsc_vm });
            bun_analytics::features::cpu_profile.fetch_add(1, Ordering::Relaxed);
        }

        // ── Heap profiler (bun.js.zig:333-342) ─────────────────────────────
        if ctx.runtime_options.heap_prof.enabled {
            let opts = &ctx.runtime_options.heap_prof;
            // SAFETY: `ctx` is process-lifetime; see CPU-profiler note above.
            vm.heap_profiler_config = Some(bun_jsc::bun_heap_profiler::HeapProfilerConfig {
                name: unsafe { &*std::ptr::from_ref::<[u8]>(opts.name.as_ref()) },
                dir: unsafe { &*std::ptr::from_ref::<[u8]>(opts.dir.as_ref()) },
                text_format: opts.text_format,
            });
            bun_analytics::features::heap_snapshot.fetch_add(1, Ordering::Relaxed);
        }

        self.add_conditional_globals();

        // ── redis preconnect (must run under the API lock) ─────────────────
        'do_redis_preconnect: {
            if !ctx.runtime_options.redis_preconnect {
                break 'do_redis_preconnect;
            }
            // Go through the global object's getter because `Bun.redis` is a
            // PropertyCallback (no direct WriteBarrier handle to read).
            let global = vm.global();
            let bun_object = match global.to_js_value().get(global, "Bun") {
                Ok(Some(v)) => v,
                Ok(None) => break 'do_redis_preconnect,
                Err(e) => {
                    global.report_active_exception_as_unhandled(e);
                    break 'do_redis_preconnect;
                }
            };
            let redis = match bun_object.get(global, "redis") {
                Ok(Some(v)) => v,
                Ok(None) => break 'do_redis_preconnect,
                Err(e) => {
                    global.report_active_exception_as_unhandled(e);
                    break 'do_redis_preconnect;
                }
            };
            let Some(client) = redis.as_::<crate::valkey_jsc::js_valkey::JSValkeyClient>() else {
                break 'do_redis_preconnect;
            };
            // SAFETY: `as_` returns a live `m_ctx` pointer owned by the JS
            // wrapper; accessed here under the API lock.
            if let Err(e) = unsafe { &*client }.do_connect(global, redis) {
                global.report_active_exception_as_unhandled(e);
            }
        }

        // ── postgres/sql preconnect ───────────────────────────────────────
        'do_postgres_preconnect: {
            if !ctx.runtime_options.sql_preconnect {
                break 'do_postgres_preconnect;
            }
            let global = vm.global();
            let bun_object = match global.to_js_value().get(global, "Bun") {
                Ok(Some(v)) => v,
                Ok(None) => break 'do_postgres_preconnect,
                Err(e) => {
                    global.report_active_exception_as_unhandled(e);
                    break 'do_postgres_preconnect;
                }
            };
            let sql_object = match bun_object.get(global, "sql") {
                Ok(Some(v)) => v,
                Ok(None) => break 'do_postgres_preconnect,
                Err(e) => {
                    global.report_active_exception_as_unhandled(e);
                    break 'do_postgres_preconnect;
                }
            };
            let connect_fn = match sql_object.get(global, "connect") {
                Ok(Some(v)) => v,
                Ok(None) => break 'do_postgres_preconnect,
                Err(e) => {
                    global.report_active_exception_as_unhandled(e);
                    break 'do_postgres_preconnect;
                }
            };
            if let Err(e) = connect_fn.call(global, sql_object, &[]) {
                global.report_active_exception_as_unhandled(e);
            }
        }

        // ── hot-reloader enable (bun.js.zig:390-394) ───────────────────────
        match ctx.debug.hot_reload {
            cli::command::HotReload::Hot => {
                bun_jsc::hot_reloader::HotReloader::enable_hot_module_reloading(
                    self.vm,
                    Some(entry),
                )
            }
            cli::command::HotReload::Watch => {
                bun_jsc::hot_reloader::WatchReloader::enable_hot_module_reloading(
                    self.vm,
                    Some(entry),
                )
            }
            _ => {}
        }

        // Zig: `if entry_path == "." { entry_path = fs.top_level_dir }`.
        if entry == b"." {
            // SAFETY: `vm.transpiler.fs` is the process-static `FileSystem`
            // singleton (set in `Transpiler::init`).
            let tld = unsafe { (*vm.transpiler.fs).top_level_dir };
            if !tld.is_empty() {
                entry = tld;
            }
        }

        match vm.load_entry_point(entry) {
            Ok(promise) => {
                // SAFETY: `promise` is a live GC cell returned by the module loader.
                let promise = unsafe { &mut *promise };
                if promise.status() == PromiseStatus::Rejected {
                    // SAFETY: `vm.jsc_vm` set in `init`; FFI takes `*mut`.
                    let result = promise.result(unsafe { &mut *vm.jsc_vm });
                    let global = vm.global;
                    // SAFETY: `global` valid for VM lifetime.
                    let handled = vm.uncaught_exception(unsafe { &*global }, result, true);
                    promise.set_handled();
                    vm.pending_internal_promise_reported_at = vm.hot_reload_counter;

                    // Spec bun.js.zig:407: when --hot/--watch is on (or a user
                    // `uncaughtException` handler swallowed the error), keep the
                    // process alive instead of hard-exiting on a rejected entry.
                    if vm.hot_reload != 0 || handled {
                        vm.add_main_to_watcher_if_needed();
                        // SAFETY: `event_loop` is a self-pointer into this VM;
                        // uniquely accessed here.
                        vm.event_loop_ref().tick();
                        // SAFETY: as above — `event_loop` is a self-pointer into
                        // this VM; uniquely accessed here.
                        vm.event_loop_ref().tick_possibly_forever();
                    } else {
                        exit_with_unhandled_note(vm);
                    }
                }

                // SAFETY: `vm.jsc_vm` set in `init`.
                let _ = promise.result(unsafe { &mut *vm.jsc_vm });

                if log_has_msgs(vm) {
                    dump_build_error(vm);
                    log_clear_msgs(vm);
                }
            }
            Err(err) => entry_point_load_failed(vm, &err),
        }

        // don't run the GC if we don't actually need to
        if vm.is_event_loop_alive() || vm.event_loop_ref().tick_concurrent_with_count() > 0 {
            vm.global().vm().release_weak_refs();
            // PERF(port): `vm.arena.gc()` — Zig's `MimallocArena.gc()` is
            // `mi_heap_collect`; `bun_alloc::Arena = bumpalo::Bump` has no
            // per-heap collect, so this is a no-op until Phase B swaps the
            // arena type. Semantically a memory-usage hint, not correctness.
            let _ = vm.global().vm().run_gc(false);
            vm.tick();
        }

        // Initial synchronous evaluation of the entrypoint is done (TLA may
        // still be pending and will resolve in the loop below); the embedded
        // source pages are off the hot path now. Skip under --watch/--hot
        // since those re-read source on every reload.
        if !vm.is_watcher_enabled() {
            bun_standalone_graph::Graph::hint_source_pages_dont_need();
        }

        // ── core run-loop ──────────────────────────────────────────────────
        if vm.is_watcher_enabled() {
            vm.report_exception_in_hot_reloaded_module_if_needed();
            loop {
                while vm.is_event_loop_alive() {
                    vm.tick();
                    vm.report_exception_in_hot_reloaded_module_if_needed();
                    vm.auto_tick_active();
                }
                vm.on_before_exit();
                vm.report_exception_in_hot_reloaded_module_if_needed();
                // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
                // accessed here. Watcher arm keeps the process alive across
                // reloads (bun.js.zig `start` watcher loop).
                vm.event_loop_ref().tick_possibly_forever();
            }
        } else {
            while vm.is_event_loop_alive() {
                vm.tick();
                vm.auto_tick_active();
            }

            if ctx.runtime_options.eval.eval_and_print {
                let to_print: JSValue = 'brk: {
                    let result = vm
                        .entry_point_result
                        .value
                        .get()
                        .unwrap_or(JSValue::UNDEFINED);
                    if let Some(promise) = result.as_any_promise() {
                        match promise.status() {
                            PromiseStatus::Pending => {
                                // C-ABI shims are emitted by
                                // `generate-host-exports.ts` into
                                // `crate::generated_host_exports` under their
                                // link name (`Bun__on…EntryPointResult`).
                                result.then2(
                                    vm.global(),
                                    JSValue::UNDEFINED,
                                    crate::generated_host_exports::Bun__onResolveEntryPointResult,
                                    crate::generated_host_exports::Bun__onRejectEntryPointResult,
                                );
                                vm.tick();
                                vm.auto_tick_active();
                                while vm.is_event_loop_alive() {
                                    vm.tick();
                                    vm.auto_tick_active();
                                }
                                break 'brk result;
                            }
                            _ => break 'brk promise.result(vm.jsc_vm()),
                        }
                    }
                    result
                };
                // Zig: `to_print.print(vm.global, .Log, .Log)`.
                // SAFETY: `vals[..1]` is the single stack `to_print`; null
                // `ctype` routes to the VM's stdout/stderr default.
                unsafe {
                    bun_jsc::ConsoleObject::message_with_type_and_level(
                        ::core::ptr::null_mut(),
                        bun_jsc::ConsoleObject::MessageType::Log,
                        bun_jsc::ConsoleObject::MessageLevel::Log,
                        vm.global(),
                        &raw const to_print,
                        1,
                    );
                }
            }

            vm.on_before_exit();
        }

        if log_has_msgs(vm) {
            dump_build_error(vm);
            Output::flush();
        }

        vm.on_unhandled_rejection = Run::on_unhandled_rejection_before_close;
        vm.global().handle_rejected_promises();
        vm.on_exit();

        if ANY_UNHANDLED.load(Ordering::Relaxed) {
            print_unhandled_version_note(vm);
        }

        // These create undefined references to externally-defined C symbols
        // (uv_* posix stubs, v8:: shims) so the linker pulls those archive
        // members from libbun.a in CI's split link-only mode and keeps them
        // through `--gc-sections`. Without them, dlopen'd NAPI modules see
        // `undefined symbol: uv_*` instead of the friendly crash message.
        // (Rust-defined `#[no_mangle]` exports don't need this; the imported
        // C symbols do.)
        crate::napi::fix_dead_code_elimination();
        crate::webcore::bake_response::fix_dead_code_elimination();
        bun_crash_handler::fix_dead_code_elimination();
        vm.global_exit();
    }
}

#[inline]
fn log_has_msgs(vm: &VirtualMachine) -> bool {
    match vm.log {
        // SAFETY: `vm.log` is a process-lifetime `&mut Log` written once in
        // `VirtualMachine::init`; never freed, single-threaded CLI.
        Some(p) => unsafe { !(*p.as_ptr()).msgs.is_empty() },
        None => false,
    }
}

#[inline]
fn log_clear_msgs(vm: &mut VirtualMachine) {
    if let Some(p) = vm.log {
        // SAFETY: see `log_has_msgs`.
        unsafe { (*p.as_ptr()).msgs.clear() };
    }
}

#[cold]
#[inline(never)]
#[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
fn dump_build_error(vm: &mut VirtualMachine) {
    Output::flush();
    if let Some(log) = vm.log {
        // SAFETY: `vm.log` set in `init`; single-threaded CLI.
        let log = unsafe { &mut *log.as_ptr() };
        let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
            Output::error_writer_buffered(),
        ));
    }
    Output::flush();
}

/// Cold tail shared by the rejected-entry-point and load-failure paths in
/// `Run::start`: flag the exit code, run `on_exit`, optionally print the
/// "unhandled error" sourcemap note + version string, then hard-exit. Hoisted
/// out (and parked in `.text.unlikely` on linux) so the linker keeps it off the
/// `.text.hot` fault-around window the `require('fs')` startup path pulls in.
#[cold]
#[inline(never)]
#[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
fn exit_with_unhandled_note(vm: &mut VirtualMachine) -> ! {
    vm.exit_handler.exit_code = 1;
    vm.on_exit();
    if ANY_UNHANDLED.load(Ordering::Relaxed) {
        bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo::print();
        pretty_errorln!("<r>\n<d>{}<r>", Global::unhandled_error_bun_version_string,);
    }
    vm.global_exit();
}

/// Cold `Err(err)` arm of `vm.load_entry_point` in `Run::start`.
#[cold]
#[inline(never)]
#[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
fn entry_point_load_failed(vm: &mut VirtualMachine, err: &bun_core::Error) -> ! {
    if log_has_msgs(vm) {
        dump_build_error(vm);
        log_clear_msgs(vm);
    } else {
        pretty_errorln!(
            "Error occurred loading entry point: {}",
            bstr::BStr::new(err.name()),
        );
        Output::flush();
    }
    exit_with_unhandled_note(vm);
}

/// Cold tail of `Run::start` when `ANY_UNHANDLED` tripped on an otherwise-clean
/// exit: bump the exit code and print the sourcemap note + version string.
#[cold]
#[inline(never)]
#[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
fn print_unhandled_version_note(vm: &mut VirtualMachine) {
    vm.exit_handler.exit_code = 1;
    bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo::print();
    pretty_errorln!("<r>\n<d>{}<r>", Global::unhandled_error_bun_version_string,);
}

impl RunCommand {
    /// `_bootAndHandleError` — duplicate `path` to a process-lifetime buffer,
    /// boot the VM, and on failure print the formatted error + `exit(1)`.
    fn _boot_and_handle_error(ctx: &mut ContextData, path: &[u8], loader: Option<Loader>) -> bool {
        if matches!(
            loader.or_else(|| Self::default_loader_for(path)),
            Some(Loader::Md)
        ) {
            Self::render_markdown_file_and_exit(path);
        }

        Global::configure_allocator(core::Global::AllocatorConfiguration {
            long_running: true,
            ..Default::default()
        });

        // `entry_path` must outlive the VM (it's stored in `vm.main`); pass an
        // owned copy by value (Zig: `ctx.allocator.dupe(u8, path)`).
        let owned: Box<[u8]> = path.to_vec().into_boxed_slice();

        if let Err(err) = Self::boot(ctx, owned, loader) {
            Self::boot_failed_exit(ctx, paths::basename(path), &err);
        }
        true
    }

    /// Cold tail of the `bun <file>` / `bun run -` boot path: flush the parse
    /// log, print `Failed to run <name> due to error <err>`, and `exit(1)`.
    /// Hoisted into its own `#[cold] #[inline(never)]` (and parked in
    /// `.text.unlikely` on linux) so PGO + the linker keep it out of the
    /// `.text.hot` fault-around window the `require('fs')` startup path pulls in.
    #[cold]
    #[inline(never)]
    #[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
    fn boot_failed_exit(ctx: &mut ContextData, display_name: &[u8], err: &bun_core::Error) -> ! {
        // SAFETY: `ctx.log` was set in `create_context_data` (single-threaded
        // CLI startup) and is process-lifetime.
        //
        // PORT NOTE: `Log::print` is generic over `IntoLogWrite`, which is
        // implemented for `*mut io::Writer` (not `&mut`). `error_writer()`
        // returns the process-global writer; cast to the raw pointer the
        // trait expects.
        let _ = unsafe { ctx.log() }.print(std::ptr::from_mut::<bun_core::io::Writer>(
            Output::error_writer(),
        ));

        pretty_errorln!(
            "<r><red>error<r>: Failed to run <b>{}<r> due to error <b>{}<r>",
            bstr::BStr::new(display_name),
            bstr::BStr::new(err.name()),
        );
        bun_core::handle_error_return_trace(err);
        Global::exit(1);
    }

    // This path is almost always a path to a user directory. So it cannot be
    // inlined like our uses of /tmp. On Windows use `GetTempPathW` /
    // `RealFS.platformTempDir` instead — this const is POSIX-only and
    // referencing it on Windows is a compile error (mirrors Zig's
    // `@compileError` arm).
    //
    // Canonical definition lives in `bun_install::RunCommand` (lower tier so
    // the package manager can use it without depending on `bun_runtime`).
    #[cfg(not(windows))]
    pub const BUN_NODE_DIR: &'static str = bun_install::RunCommand::BUN_NODE_DIR;

    /// Port of `bunNodeFileUtf8` (run_command.zig). Returns the path to the
    /// fake `node` shim that points back at the running `bun` binary.
    pub fn bun_node_file_utf8() -> Result<&'static ZStr, bun_core::Error> {
        #[cfg(not(windows))]
        {
            const BUN_NODE_DIR_Z: &str = const_format::concatcp!(RunCommand::BUN_NODE_DIR, "\0");
            Ok(ZStr::from_static(BUN_NODE_DIR_Z.as_bytes()))
        }
        #[cfg(windows)]
        {
            let mut temp_path_buffer = WPathBuffer::uninit();
            let mut target_path_buffer = PathBuffer::uninit();
            // SAFETY: FFI Win32 `GetTempPathW`. `temp_path_buffer` is a valid
            // writable WCHAR[MAX_PATH+] buffer and `nBufferLength` is its
            // capacity in WCHARs; the call writes at most that many wide chars.
            let len = unsafe {
                sys::windows::GetTempPathW(
                    u32::try_from(temp_path_buffer.len()).expect("int cast"),
                    temp_path_buffer.as_mut_ptr(),
                )
            };
            if len == 0 {
                return Err(bun_core::err!("FailedToGetTempPath"));
            }

            let converted = strings::convert_utf16_to_utf8_in_buffer(
                &mut target_path_buffer,
                &temp_path_buffer[..len as usize],
            );

            const FILE_NAME: &str = const_format::concatcp!(
                "bun-node",
                if Environment::GIT_SHA_SHORT.len() > 0 {
                    const_format::concatcp!("-", Environment::GIT_SHA_SHORT)
                } else {
                    ""
                },
                "\\node.exe"
            );
            let conv_len = converted.len();
            let total = conv_len + FILE_NAME.len();
            target_path_buffer[conv_len..total].copy_from_slice(FILE_NAME.as_bytes());
            target_path_buffer[total] = 0;

            // Zig: `allocator.dupeZ` — process-lifetime, never freed. Park the
            // bytes in the per-process `runner_arena()` instead of leaking
            // (PORTING.md §Forbidden bars per-call leaks).
            let stored: &'static [u8] =
                runner_arena().alloc_slice_copy(&target_path_buffer[..=total]);
            // SAFETY: `stored[total] == 0` (written above before the copy);
            // arena-backed slice lives for process lifetime.
            Ok(ZStr::from_buf(&stored[..], total))
        }
    }

    /// Port of `createFakeTemporaryNodeExecutable` (run_command.zig). Creates
    /// `<tmp>/bun-node*/node` and `<tmp>/bun-node*/bun` symlinks (or hard
    /// links on Windows) pointing at the running `bun` binary, then appends
    /// that directory to `path` so child processes resolve `node` to bun.
    ///
    /// Implementation lives in `bun_install::RunCommand` (lower tier) so the
    /// package manager can call it without depending on `bun_runtime`; this is
    /// a thin delegate so existing `Self::` callers keep compiling.
    #[inline]
    pub fn create_fake_temporary_node_executable(
        path: &mut Vec<u8>,
        optional_bun_path: &mut &[u8],
    ) -> Result<(), bun_core::Error> {
        bun_install::RunCommand::create_fake_temporary_node_executable(path, optional_bun_path)
    }

    /// Port of `configurePathForRun` (run_command.zig). Prepends workspace
    /// `.bin` dirs + the bun-node shim dir to `PATH` and writes the original
    /// PATH back through `original_path`.
    pub fn configure_path_for_run(
        ctx: &mut ContextData,
        root_dir_info: bun_resolver::DirInfoRef,
        this_transpiler: &mut Transpiler<'static>,
        original_path: Option<&mut Vec<u8>>,
        cwd: &[u8],
        force_using_bun: bool,
    ) -> Result<(), bun_core::Error> {
        let mut package_json_dir: &[u8] = b"";

        if let Some(package_json) = root_dir_info.enclosing_package_json {
            if root_dir_info.package_json.is_none() {
                // no trailing slash
                package_json_dir =
                    strings::without_trailing_slash(package_json.source.path.name.dir);
            }
        }

        let new_path = Self::configure_path_for_run_with_package_json_dir(
            ctx,
            package_json_dir,
            this_transpiler,
            original_path,
            cwd,
            force_using_bun,
        )?;
        this_transpiler
            .env_mut()
            .map
            .put(b"PATH", &new_path)
            .unwrap_or_oom();
        Ok(())
    }

    /// Port of `configurePathForRunWithPackageJsonDir` (run_command.zig).
    /// Builds a new PATH with `node_modules/.bin` for each ancestor of `cwd`
    /// (plus `package_json_dir` and the bun-node shim dir) prepended, returns
    /// it as an owned buffer, and writes the original PATH out via
    /// `original_path`.
    pub fn configure_path_for_run_with_package_json_dir(
        _ctx: &mut ContextData,
        package_json_dir: &[u8],
        this_transpiler: &mut Transpiler<'static>,
        original_path: Option<&mut Vec<u8>>,
        cwd: &[u8],
        force_using_bun: bool,
    ) -> Result<Vec<u8>, bun_core::Error> {
        let env_loader = this_transpiler.env_mut();
        // Snapshot PATH up front. In Zig the env map stores borrowed slices into
        // process environ, so the returned `[]const u8` outlives later `put`s; the
        // Rust map owns `Box<[u8]>` values, so a borrow would dangle once the
        // caller (`configure_path_for_run`) overwrites PATH. Own a copy instead.
        let path: Vec<u8> = env_loader
            .get(b"PATH")
            .map(<[u8]>::to_vec)
            .unwrap_or_default();
        if let Some(op) = original_path {
            *op = path.clone();
        }

        let bun_node_exe = Self::bun_node_file_utf8()?;
        let bun_node_dir_win = bun_paths::dirname(bun_node_exe.as_bytes())
            .ok_or(bun_core::err!("FailedToGetTempPath"))?;
        let found_node = env_loader
            .load_node_js_config(
                bun_paths::fs::FileSystem::instance(),
                if force_using_bun {
                    bun_node_exe.as_bytes()
                } else {
                    b""
                },
            )
            .unwrap_or(false);

        let mut needs_to_force_bun = force_using_bun || !found_node;
        let mut optional_bun_self_path: &[u8] = b"";

        let mut new_path_len: usize = path.len() + 2;

        if !package_json_dir.is_empty() {
            new_path_len += package_json_dir.len() + 1;
        }

        {
            let mut remain = cwd;
            while let Some(i) = strings::last_index_of_char(remain, SEP) {
                new_path_len += strings::without_trailing_slash(remain).len()
                    + b"node_modules.bin".len()
                    + 1
                    + 2; // +2 for path separators, +1 for path delimiter
                remain = &remain[..i];
            }
            // Zig `else` clause runs once after the loop ends naturally
            new_path_len +=
                strings::without_trailing_slash(remain).len() + b"node_modules.bin".len() + 1 + 2; // +2 for path separators, +1 for path delimiter
        }

        if needs_to_force_bun {
            new_path_len += bun_node_dir_win.len() + 1;
        }

        let mut new_path: Vec<u8> = Vec::with_capacity(new_path_len);

        if needs_to_force_bun {
            match Self::create_fake_temporary_node_executable(
                &mut new_path,
                &mut optional_bun_self_path,
            ) {
                Ok(()) => {}
                Err(e) if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
                Err(other) => panic!(
                    "unexpected error from createFakeTemporaryNodeExecutable: {}",
                    other.name()
                ),
            }

            if !force_using_bun {
                let env_mut = this_transpiler.env_mut();
                env_mut
                    .map
                    .put(b"NODE", bun_node_exe.as_bytes())
                    .unwrap_or_oom();
                env_mut
                    .map
                    .put(b"npm_node_execpath", bun_node_exe.as_bytes())
                    .unwrap_or_oom();
                env_mut
                    .map
                    .put(b"npm_execpath", optional_bun_self_path)
                    .unwrap_or_oom();
            }

            needs_to_force_bun = false;
        }
        let _ = needs_to_force_bun;

        {
            if !package_json_dir.is_empty() {
                new_path.extend_from_slice(package_json_dir);
                new_path.push(DELIMITER);
            }

            let mut remain = cwd;
            while let Some(i) = strings::last_index_of_char(remain, SEP) {
                new_path.extend_from_slice(strings::without_trailing_slash(remain));
                new_path.extend_from_slice(path_literal!(
                    b"/node_modules/.bin",
                    b"\\node_modules\\.bin"
                ));
                new_path.push(DELIMITER);
                remain = &remain[..i];
            }
            // Zig `else` clause runs once after loop ends naturally
            new_path.extend_from_slice(strings::without_trailing_slash(remain));
            new_path.extend_from_slice(path_literal!(
                b"/node_modules/.bin",
                b"\\node_modules\\.bin"
            ));
            new_path.push(DELIMITER);

            new_path.extend_from_slice(&path);
        }

        Ok(new_path)
    }

    fn basename_or_bun(str: &[u8]) -> &[u8] {
        // The full path is not used here, because on windows it is dependant on the
        // username. Before windows we checked bun_node_dir, but this is not allowed on Windows.
        let suffix_posix =
            const_format::concatcp!("/bun-node/node", std::env::consts::EXE_SUFFIX).as_bytes();
        let suffix_win =
            const_format::concatcp!("\\bun-node\\node", std::env::consts::EXE_SUFFIX).as_bytes();
        if str.ends_with(suffix_posix) || (cfg!(windows) && str.ends_with(suffix_win)) {
            return b"bun";
        }
        paths::basename(str)
    }

    /// Port of `runBinary` (run_command.zig). On Windows this first probes for
    /// a sibling `.bunx` shim and direct-launches it via `BunXFastPath` to
    /// skip the wrapper exe; otherwise (or if the fast path declines) it falls
    /// through to `run_binary_without_bunx_path`.
    ///
    /// This function only returns if an error starting the process is
    /// encountered; most other errors are handled by printing and exiting.
    pub fn run_binary(
        ctx: &mut ContextData,
        executable: &[u8],
        executable_z: &ZStr,
        cwd: &[u8],
        env: &mut DotEnv::Loader<'static>,
        passthrough: &[Box<[u8]>],
        original_script_for_bun_run: Option<&[u8]>,
    ) -> Result<::core::convert::Infallible, bun_core::Error> {
        // Attempt to find a ".bunx" file on disk, and run it, skipping the
        // wrapper exe.  we build the full exe path even though we could do
        // a relative lookup, because in the case we do find it, we have to
        // generate this full path anyways.
        #[cfg(windows)]
        if bun_core::FeatureFlags::WINDOWS_BUNX_FAST_PATH && executable.ends_with(b".exe") {
            debug_assert!(paths::is_absolute(executable));

            // SAFETY: `DIRECT_LAUNCH_BUFFER` is a process-lifetime static used
            // single-threaded from CLI dispatch. The returned slice points into
            // it; we keep the borrow scoped until `try_launch` consumes it.
            let buf = unsafe { &mut *bunx_fast_path_buffers::DIRECT_LAUNCH_BUFFER.get() };
            let w = strings::to_nt_path(buf, executable);
            let w_len = w.len();
            debug_assert!(w_len > sys::windows::NT_OBJECT_PREFIX.len() + b".exe".len());
            let new_len = w_len + b".bunx".len() - b".exe".len();
            let bunx = bun_core::w!("bunx");
            buf[new_len - bunx.len()..new_len].copy_from_slice(bunx);
            buf[new_len] = 0;

            BunXFastPath::try_launch(ctx, new_len, env, passthrough);
        }

        Self::run_binary_without_bunx_path(
            ctx,
            executable,
            executable_z.as_ptr().cast::<c_char>(),
            cwd,
            env,
            passthrough,
            original_script_for_bun_run,
        )
    }

    fn run_binary_generic_error(executable: &[u8], silent: bool, err: sys::Error) -> ! {
        if !silent {
            pretty_errorln!(
                "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to:\n{}",
                bstr::BStr::new(Self::basename_or_bun(executable)),
                err.with_path(executable),
            );
        }
        Global::exit(1);
    }

    pub fn run_binary_without_bunx_path(
        ctx: &mut ContextData,
        executable: &[u8],
        executable_z: *const c_char,
        cwd: &[u8],
        env: &mut DotEnv::Loader<'static>,
        passthrough: &[Box<[u8]>],
        original_script_for_bun_run: Option<&[u8]>,
    ) -> Result<::core::convert::Infallible, bun_core::Error> {
        use crate::api::bun_process::{Status as SpawnStatus, sync};

        let mut argv: Vec<Box<[u8]>> = Vec::with_capacity(1 + passthrough.len());
        argv.push(executable.to_vec().into_boxed_slice());
        for p in passthrough {
            argv.push(p.clone());
        }

        let silent = ctx.debug.silent;

        // TODO: remember to free this when we add --filter or --concurrent
        // in the meantime we don't need to free it.
        let envp = env.map.create_null_delimited_env_map()?;

        let spawn_result = match sync::spawn(&sync::Options {
            argv,
            argv0: Some(executable_z),
            envp: Some(envp.as_ptr().cast::<*const c_char>()),
            cwd: cwd.to_vec().into_boxed_slice(),
            stderr: sync::SyncStdio::Inherit,
            stdout: sync::SyncStdio::Inherit,
            stdin: sync::SyncStdio::Inherit,
            use_execve_on_macos: silent,
            #[cfg(windows)]
            windows: crate::api::bun_process::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init_mini(
                    bun_event_loop::MiniEventLoop::init_global(
                        Some(unsafe {
                            // SAFETY: env loader is process-lifetime; erase
                            // borrowed lifetime for the singleton handoff.
                            &mut *::core::ptr::from_mut::<DotEnv::Loader<'_>>(env)
                                .cast::<DotEnv::Loader<'static>>()
                        }),
                        None,
                    ),
                ),
                ..Default::default()
            },
            ..Default::default()
        }) {
            Ok(r) => r,
            Err(err) => {
                bun_core::handle_error_return_trace(&err);

                // an error occurred before the process was spawned
                'print_error: {
                    if !silent {
                        #[cfg(unix)]
                        {
                            // SAFETY: `executable_z` is the NUL-terminated form
                            // of `executable` (caller invariant).
                            let exec_z = unsafe {
                                let cstr = bun_core::ffi::cstr(executable_z);
                                ZStr::from_raw(cstr.as_ptr().cast(), cstr.to_bytes().len())
                            };
                            match sys::stat(exec_z) {
                                Ok(stat) => {
                                    if sys::S::ISDIR(stat.st_mode as _) {
                                        pretty_errorln!(
                                            "<r><red>error<r>: Failed to run directory \"<b>{}<r>\"\n",
                                            bstr::BStr::new(Self::basename_or_bun(executable)),
                                        );
                                        break 'print_error;
                                    }
                                }
                                Err(err2) => match err2.get_errno() {
                                    sys::E::ENOENT | sys::E::EPERM | sys::E::ENOTDIR => {
                                        pretty_errorln!(
                                            "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to error:\n{}",
                                            bstr::BStr::new(Self::basename_or_bun(executable)),
                                            err2,
                                        );
                                        break 'print_error;
                                    }
                                    _ => {}
                                },
                            }
                        }

                        pretty_errorln!(
                            "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to <r><red>{}<r>",
                            bstr::BStr::new(Self::basename_or_bun(executable)),
                            bstr::BStr::new(err.name()),
                        );
                    }
                }
                Global::exit(1);
            }
        };

        match spawn_result {
            Err(err) => {
                // an error occurred while spawning the process
                Self::run_binary_generic_error(executable, silent, err);
            }
            Ok(result) => {
                let signal_code = result.status.signal_code();
                match result.status {
                    // An error occurred after the process was spawned.
                    SpawnStatus::Err(err) => {
                        Self::run_binary_generic_error(executable, silent, err);
                    }

                    SpawnStatus::Signaled(signal) => {
                        // Zig: print is gated on `signal.valid()` (1..=31 ⇔
                        // `signal_code.is_some()`); the re-raise is NOT — it
                        // forwards the raw byte unconditionally so the parent
                        // observes the real termination signal (incl. RT 32-64).
                        if let Some(sc) = signal_code {
                            if sc != bun_core::SignalCode::SIGINT && !silent {
                                pretty_errorln!(
                                    "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to signal <b>{}<r>",
                                    bstr::BStr::new(Self::basename_or_bun(executable)),
                                    sc.name(),
                                );
                            }
                        }

                        if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN
                            .get()
                            == Some(true)
                        {
                            bun_crash_handler::suppress_reporting();
                        }

                        Global::raise_ignoring_panic_handler_raw(::core::ffi::c_int::from(signal));
                    }

                    SpawnStatus::Exited(exit_code) => {
                        // A process can be both signaled and exited.
                        // Zig: gated on `exit_code.signal.valid()` (1..=31).
                        if let Some(sc) = signal_code {
                            if !silent {
                                pretty_errorln!(
                                    "<r><red>error<r>: \"<b>{}<r>\" exited with signal <b>{}<r>",
                                    bstr::BStr::new(Self::basename_or_bun(executable)),
                                    sc.name(),
                                );
                            }

                            if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN
                                .get()
                                == Some(true)
                            {
                                bun_crash_handler::suppress_reporting();
                            }

                            Global::raise_ignoring_panic_handler(sc);
                        }

                        let code = exit_code.code;
                        if code != 0 {
                            if !silent {
                                let is_probably_trying_to_run_a_pkg_script =
                                    original_script_for_bun_run.is_some()
                                        && ((code == 1
                                            && original_script_for_bun_run.unwrap() == b"test")
                                            || (code == 2
                                                && strings::eql_any_comptime(
                                                    original_script_for_bun_run.unwrap(),
                                                    &[b"install", b"kill", b"link"],
                                                )
                                                && ctx.positionals.len() == 1));

                                if is_probably_trying_to_run_a_pkg_script {
                                    // if you run something like `bun run test`,
                                    // you get a confusing message because you
                                    // don't usually think about your global
                                    // path, let alone "/bin/test"
                                    //
                                    // test exits with code 1, the other ones i
                                    // listed exit with code 2
                                    //
                                    // so for these script names, print the
                                    // entire exe name.
                                    Output::err_generic(
                                        "\"<b>{}<r>\" exited with code {}",
                                        (bstr::BStr::new(executable), code),
                                    );
                                    bun_core::note!(
                                        "a package.json script \"{}\" was not found",
                                        bstr::BStr::new(original_script_for_bun_run.unwrap()),
                                    );
                                }
                                // 128 + 2 is the exit code of a process killed
                                // by SIGINT, which is caused by CTRL + C
                                else if code > 0 && code != 130 {
                                    Output::err_generic(
                                        "\"<b>{}<r>\" exited with code {}",
                                        (bstr::BStr::new(Self::basename_or_bun(executable)), code),
                                    );
                                } else {
                                    pretty_errorln!(
                                        "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to exit code <b>{}<r>",
                                        bstr::BStr::new(Self::basename_or_bun(executable)),
                                        code,
                                    );
                                }
                            }
                        }

                        Global::exit(code as u32);
                    }
                    SpawnStatus::Running => panic!("Unexpected state: process is running"),
                }
            }
        }
    }

    /// Dispatch `bun run <target>`: classify as file path vs. package.json
    /// script, then either boot the VM or spawn the script.
    ///
    /// Mirrors Zig `RunCommand.exec(ctx, .{ .bin_dirs_only, .log_errors,
    /// .allow_fast_run_for_extensions })` — all three knobs are forwarded so
    /// `--if-present` (suppresses missing-script errors) and the Auto-command
    /// fast-path-by-extension behave exactly per spec.
    #[inline]
    pub fn exec(ctx: &mut ContextData, cfg: ExecCfg) -> Result<bool, bun_core::Error> {
        Self::exec_with_cfg(ctx, cfg)
    }

    pub fn exec_with_cfg(ctx: &mut ContextData, cfg: ExecCfg) -> Result<bool, bun_core::Error> {
        let bin_dirs_only = cfg.bin_dirs_only;
        let log_errors = cfg.log_errors;

        // ── find what to run ────────────────────────────────────────────────
        let mut positionals: &[Box<[u8]>] = &ctx.positionals[..];
        if !positionals.is_empty() && positionals[0].as_ref() == b"run" {
            positionals = &positionals[1..];
        }

        // PORT NOTE: `target_name` borrows `ctx.positionals`, but the boot path
        // mutates `ctx` (takes `preloads`/`passthrough`). Dupe up-front to
        // dodge the borrowck split; the string is short and `exec` is cold.
        let target_name: Box<[u8]> = if !positionals.is_empty() {
            positionals[0].clone()
        } else {
            Box::default()
        };
        let target_name: &[u8] = &target_name;
        // unclear why passthrough is an escaped string, it should probably be
        // []const []const u8 and allow its users to escape it.

        let mut try_fast_run = false;
        let mut skip_script_check = false;
        if !target_name.is_empty() && target_name[0] == b'.' {
            try_fast_run = true;
            skip_script_check = true;
        } else if paths::is_absolute(target_name) {
            try_fast_run = true;
            skip_script_check = true;
        } else if cfg.allow_fast_run_for_extensions {
            if let Some(l) = Self::default_loader_for(target_name) {
                if l.can_be_run_by_bun() || l == Loader::Md {
                    try_fast_run = true;
                }
            }
        }

        if !ctx.debug.loaded_bunfig {
            // `Arguments::load_config_path` — loads global bunfig (if the
            // command opts in via `read_global_config`) then `bunfig.toml`.
            let _ = arguments::load_config_path(
                CommandTag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            );
        }

        // ── try fast run (file exists & not a dir → boot VM) ────────────────
        if try_fast_run && Self::maybe_open_with_bun_js(ctx, target_name) {
            return Ok(true);
        }

        // ── setup (unconditional — zig:1694-1699) ───────────────────────────
        // PORT NOTE: out-param init — Zig: `var this_transpiler: Transpiler
        // = undefined;`. `Transpiler` is NOT all-zero-valid POD (holds
        // `&Arena`/`Box`/enum fields), so use `MaybeUninit` and let
        // `configure_env_for_run` `.write()` the whole struct (PORTING.md
        // §std.mem.zeroes).
        //
        // Use the `_without_linker` variant: nothing reached from here
        // transpiles through `this_transpiler` — the script-string path shells
        // out, and the file-entry-point path boots a fresh VM with its own
        // transpiler — so the bundler-linker / `tsconfig.json` / JSX-runtime
        // setup would be dead weight (and the largest block of bundler code
        // otherwise faulted in for a plain `bun run <script>`).
        let mut this_transpiler = ::core::mem::MaybeUninit::<Transpiler<'static>>::uninit();
        let root_dir_info = Self::configure_env_for_run_without_linker(
            ctx,
            &mut this_transpiler,
            None,
            log_errors,
            false,
        )?;
        // SAFETY: `configure_env_for_run_without_linker` returned `Ok`, so the
        // slot is fully initialized via `MaybeUninit::write`.
        let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
        let force_using_bun = ctx.debug.run_in_bun;
        let mut original_path: Vec<u8> = Vec::new();
        Self::configure_path_for_run(
            ctx,
            root_dir_info,
            this_transpiler,
            Some(&mut original_path),
            root_dir_info.abs_path,
            force_using_bun,
        )?;
        let env_loader: &mut DotEnv::Loader<'static> = this_transpiler.env_mut();
        env_loader
            .map
            .put(b"npm_command", b"run-script")
            .expect("unreachable");

        let root_dir = root_dir_info;

        // ── empty command → print help ──────────────────────────────────────
        if target_name.is_empty() {
            if let Some(package_json) = root_dir.enclosing_package_json {
                Self::print_help(Some(package_json));
            } else {
                Self::print_help(None);
                prettyln!("\n<r><yellow>No package.json found.<r>\n");
                Output::flush();
            }
            return Ok(true);
        }

        // ── stdin (`bun run -`) ─────────────────────────────────────────────
        if target_name.len() == 1 && target_name[0] == b'-' {
            return Self::exec_stdin(ctx);
        }

        // ── package.json script lookup ──────────────────────────────────────
        if !skip_script_check {
            if let Some(package_json) = root_dir.enclosing_package_json {
                if let Some(scripts) = package_json.scripts.as_deref() {
                    if let Some(&script_content) = scripts.get(target_name) {
                        bun_core::scoped_log!(
                            RUN_LOG,
                            "Found matching script `{}`",
                            bstr::BStr::new(script_content)
                        );
                        Global::configure_allocator(core::Global::AllocatorConfiguration {
                            long_running: false,
                            ..Default::default()
                        });
                        env_loader
                            .map
                            .put(b"npm_lifecycle_event", target_name)
                            .expect("unreachable");

                        // allocate enough to hold "post${scriptname}"
                        // PORT NOTE: byte 0 is a placeholder so the "pre" slice
                        // (`[1..]`) and the in-place "post" overwrite share one
                        // buffer (run_command.zig:1749-1794).
                        let mut temp_script_buffer: Vec<u8> =
                            Vec::with_capacity(b"\x00pre".len() + target_name.len());
                        temp_script_buffer.extend_from_slice(b"\x00pre");
                        temp_script_buffer.extend_from_slice(target_name);

                        let package_json_dir =
                            strings::without_trailing_slash(strings::without_suffix_comptime(
                                package_json.source.path.text,
                                b"package.json",
                            ));
                        bun_core::scoped_log!(
                            RUN_LOG,
                            "Running in dir `{}`",
                            bstr::BStr::new(package_json_dir)
                        );

                        // PORT NOTE: borrowck reshape — `ctx.passthrough` is a
                        // field of `ctx` but `run_package_script_foreground`
                        // takes `&mut ContextData`; clone the slice up-front.
                        let passthrough: Vec<Box<[u8]>> = ctx.passthrough.clone();
                        let silent = ctx.debug.silent;
                        let use_system_shell = ctx.debug.use_system_shell;

                        if let Some(&prescript) = scripts.get(&temp_script_buffer[1..]) {
                            Self::run_package_script_foreground(
                                ctx,
                                prescript,
                                &temp_script_buffer[1..],
                                package_json_dir,
                                env_loader,
                                &[],
                                silent,
                                use_system_shell,
                            )?;
                        }

                        Self::run_package_script_foreground(
                            ctx,
                            script_content,
                            target_name,
                            package_json_dir,
                            env_loader,
                            &passthrough,
                            silent,
                            use_system_shell,
                        )?;

                        temp_script_buffer[..b"post".len()].copy_from_slice(b"post");

                        if let Some(&postscript) = scripts.get(&temp_script_buffer[..]) {
                            Self::run_package_script_foreground(
                                ctx,
                                postscript,
                                &temp_script_buffer,
                                package_json_dir,
                                env_loader,
                                &[],
                                silent,
                                use_system_shell,
                            )?;
                        }

                        return Ok(true);
                    }
                }
            }
        }

        // ── module resolution fallback (run_command.zig:1820-1857) ──────────
        // load module and run that module
        // TODO: run module resolution here - try the next condition if the module can't be found
        bun_core::scoped_log!(
            RUN_LOG,
            "Try resolve `{}` in `{}`",
            bstr::BStr::new(target_name),
            bstr::BStr::new(unsafe { (*this_transpiler.fs).top_level_dir }),
        );
        // Temporarily honor `--preserve-symlinks-main` / NODE_PRESERVE_SYMLINKS_MAIN
        // for this one resolve. Zig: `defer resolver.opts.preserve_symlinks = saved`.
        let resolution: ::core::result::Result<bun_resolver::Result, bun_core::Error> = {
            let saved_preserve = this_transpiler.resolver.opts.preserve_symlinks;
            this_transpiler.resolver.opts.preserve_symlinks =
                ctx.runtime_options.preserve_symlinks_main
                    || bun_core::env_var::NODE_PRESERVE_SYMLINKS_MAIN
                        .get()
                        .unwrap_or(false);
            // SAFETY: `Transpiler::init` always sets `fs`; resolver-cache lifetime.
            let top_level_dir = unsafe { (*this_transpiler.fs).top_level_dir };
            let resolved = match this_transpiler.resolver.resolve(
                top_level_dir,
                target_name,
                bun_ast::ImportKind::EntryPointRun,
            ) {
                ok @ Ok(_) => ok,
                Err(_) => {
                    // Retry with explicit `./` prefix (run_command.zig:1832-1836).
                    let prefixed: Vec<u8> = [b"./".as_slice(), target_name].concat();
                    this_transpiler.resolver.resolve(
                        top_level_dir,
                        &prefixed,
                        bun_ast::ImportKind::EntryPointRun,
                    )
                }
            };
            this_transpiler.resolver.opts.preserve_symlinks = saved_preserve;
            resolved
        };
        // (path, loader) — captured if the resolve hit a real file whose
        // loader Bun cannot execute (e.g. `.css`); used by the `log_errors`
        // tail to print "Cannot run … / Bun cannot run {loader} files".
        let mut resolved_to_unrunnable_file: Option<(Box<[u8]>, Loader)> = None;
        match resolution {
            Ok(mut resolved) => {
                let path = resolved.path().expect("resolved primary path");
                let ext = path.name.ext;
                let loader: Loader = this_transpiler
                    .options
                    .loaders
                    .get(ext)
                    .copied()
                    .or_else(|| bun_bundler::options::DEFAULT_LOADERS.get(ext).copied())
                    .unwrap_or(Loader::Tsx);
                if loader.can_be_run_by_bun() || loader == Loader::Html || loader == Loader::Md {
                    bun_core::scoped_log!(RUN_LOG, "Resolved to: `{}`", bstr::BStr::new(path.text));
                    // PORT NOTE: borrowck — `_boot_and_handle_error` takes
                    // `&mut ctx`; copy `path.text` out of the resolver borrow.
                    let text: Box<[u8]> = path.text.to_vec().into_boxed_slice();
                    return Ok(Self::_boot_and_handle_error(ctx, &text, Some(loader)));
                } else {
                    bun_core::scoped_log!(
                        RUN_LOG,
                        "Resolved file `{}` but ignoring because loader is {}",
                        bstr::BStr::new(path.text),
                        <&'static str>::from(loader),
                    );
                    resolved_to_unrunnable_file =
                        Some((path.text.to_vec().into_boxed_slice(), loader));
                }
            }
            Err(_) => {
                // Support globs for HTML entry points.
                if strings::has_suffix_comptime(target_name, b".html")
                    && strings::contains_char(target_name, b'*')
                {
                    return Ok(Self::_boot_and_handle_error(
                        ctx,
                        target_name,
                        Some(Loader::Html),
                    ));
                }
            }
        }

        // ── Windows .bunx fast-path (run_command.zig:1862-1888) ─────────────
        #[cfg(windows)]
        if bun_core::FeatureFlags::WINDOWS_BUNX_FAST_PATH {
            // SAFETY: process-lifetime static, single-threaded CLI dispatch.
            let buf = unsafe { &mut *bunx_fast_path_buffers::DIRECT_LAUNCH_BUFFER.get() };
            // NT object-manager prefix (`\??\`), NOT the Win32 long-path
            // `\\?\` — `try_launch` hands this to NtCreateFile.
            let root = bun_core::w!("\\??\\");
            buf[..root.len()].copy_from_slice(root);
            let cwd_len = unsafe {
                sys::windows::kernel32::GetCurrentDirectoryW(
                    (buf.len() - 4) as u32,
                    buf.as_mut_ptr().add(root.len()),
                )
            } as usize;
            'try_bunx_file: {
                if cwd_len == 0 {
                    break 'try_bunx_file;
                }
                let mut ptr = root.len() + cwd_len;
                let prefix = bun_core::w!("\\node_modules\\.bin\\");
                buf[ptr..ptr + prefix.len()].copy_from_slice(prefix);
                ptr += prefix.len();
                let encoded =
                    strings::convert_utf8_to_utf16_in_buffer(&mut buf[ptr..], target_name);
                ptr += encoded.len();
                let ext = bun_core::w!(".bunx");
                buf[ptr..ptr + ext.len()].copy_from_slice(ext);
                ptr += ext.len();
                buf[ptr] = 0;

                let passthrough: Vec<Box<[u8]>> = ctx.passthrough.clone();
                BunXFastPath::try_launch(ctx, ptr, env_loader, &passthrough);
            }
        }

        // ── node_modules/.bin / system $PATH fallback ───────────────────────
        // Zig: run_command.zig:1890-1912 — search the prepended `.bin` dirs
        // (PATH minus ORIGINAL_PATH) unless `--bun` was passed, in which case
        // search the whole stitched PATH.
        {
            let _ = force_using_bun;
            // SAFETY: `Transpiler::init` always sets `fs`; resolver-cache lifetime.
            let fs = unsafe { &mut *this_transpiler.fs };
            let top_level_dir = fs.top_level_dir;
            let path = env_loader.get(b"PATH").unwrap_or(b"");
            let mut path_for_which = path;
            if bin_dirs_only {
                if original_path.len() < path.len() {
                    path_for_which = &path[..path.len() - (original_path.len() + 1)];
                } else {
                    path_for_which = b"";
                }
            }

            if !path_for_which.is_empty() {
                let mut path_buf = PathBuffer::uninit();
                if let Some(destination) =
                    which(&mut path_buf, path_for_which, top_level_dir, target_name)
                {
                    let out = destination.as_bytes();
                    let stored = fs.dirname_store.append_slice(out)?;
                    let passthrough: Vec<Box<[u8]>> = ctx.passthrough.clone();
                    Self::run_binary_without_bunx_path(
                        ctx,
                        stored,
                        destination.as_ptr().cast::<c_char>(),
                        top_level_dir,
                        env_loader,
                        &passthrough,
                        Some(target_name),
                    )?;
                }
            }
        }

        // ── failure ─────────────────────────────────────────────────────────
        if ctx.runtime_options.if_present {
            return Ok(true);
        }

        // `bun feedback` (run_command.zig:1921-1925).
        // SAFETY: `cli::CMD` is written once during single-threaded CLI
        // startup before any worker thread is spawned; read-only here.
        if ctx.filters.is_empty()
            && !ctx.workspaces
            && unsafe { cli::CMD.read() } == Some(CommandTag::AutoCommand)
            && target_name == b"feedback"
        {
            Self::bun_feedback(ctx)?;
        }

        if log_errors {
            if let Some((path, loader)) = resolved_to_unrunnable_file {
                bun_core::pretty_error!(
                    "<r><red>error<r><d>:<r> <b>Cannot run \"{}\"<r>\n",
                    bstr::BStr::new(&path),
                );
                bun_core::pretty_error!(
                    "<r><d>note<r><d>:<r> Bun cannot run {} files directly\n",
                    <&'static str>::from(loader),
                );
            } else {
                let default_loader = Self::default_loader_for(target_name);
                if default_loader
                    .map(Loader::is_javascript_like_or_json)
                    .unwrap_or(false)
                    || (!target_name.is_empty()
                        && (target_name[0] == b'.'
                            || target_name[0] == b'/'
                            || paths::is_absolute(target_name)))
                {
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>Module not found \"<b>{}<r>\"",
                        bstr::BStr::new(target_name),
                    );
                } else if !paths::extension(target_name).is_empty() {
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>File not found \"<b>{}<r>\"",
                        bstr::BStr::new(target_name),
                    );
                } else {
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>Script not found \"<b>{}<r>\"",
                        bstr::BStr::new(target_name),
                    );
                }
            }
            Global::exit(1);
        }

        Ok(false)
    }

    /// Fast-path file probe: if `target` resolves to an existing regular file,
    /// duplicate its absolute path and boot the VM. Returns `false` if the
    /// path does not exist / is a directory, so the caller can fall through to
    /// script lookup.
    ///
    /// PORT NOTE: the Zig version reads `ctx.args.entry_points[0]`; this tier
    /// has not wired `Arguments::parse` to populate `entry_points` yet, so we
    /// take the target slice explicitly.
    fn maybe_open_with_bun_js(ctx: &mut ContextData, target: &[u8]) -> bool {
        if target.is_empty() {
            return false;
        }

        // PORT NOTE (run_command.zig:1586-1640): Zig OPENS the file (rather than
        // just stat()ing the path), fstat()s the fd, then derives the canonical
        // absolute path via `bun.getFdPath(fd, &buf)` before booting. The
        // get_fd_path step matters: it resolves symlinks so module-relative
        // resolution sees the real location.
        let mut script_name_buf = PathBuffer::uninit();

        // Build a NUL-terminated path to open (mirrors the Zig branching for
        // absolute vs. simple-relative vs. `..`/`~`-prefixed).
        let open_len: usize = if paths::is_absolute(target) {
            // Zig: `PosixToWinNormalizer.resolveCWD` (prepends the cwd drive
            // letter on Windows for `/abs` paths) then, on Windows only,
            // `resolve_path.normalizeString(.., .windows)` to canonicalize
            // separators. Both are no-ops on POSIX (`resolve_cwd` returns the
            // input slice untouched).
            let mut win_resolver = paths::resolve_path::PosixToWinNormalizer::default();
            let resolved = win_resolver
                .resolve_cwd(target)
                .unwrap_or_else(|_| panic!("Could not resolve path"));
            #[cfg(windows)]
            let resolved: &[u8] =
                paths::resolve_path::normalize_string::<false, paths::platform::Windows>(resolved);
            if resolved.len() >= MAX_PATH_BYTES {
                return false;
            }
            script_name_buf[..resolved.len()].copy_from_slice(resolved);
            resolved.len()
        } else if !target.starts_with(b"..") && target[0] != b'~' {
            // open relative to cwd as-is
            if target.len() >= MAX_PATH_BYTES {
                return false;
            }
            script_name_buf[..target.len()].copy_from_slice(target);
            target.len()
        } else {
            // `..foo` / `~foo` — resolve against cwd via joinAbsStringBuf.
            let mut cwd_buf = PathBuffer::uninit();
            let Ok(cwd) = bun_core::getcwd(&mut cwd_buf) else {
                return false;
            };
            let cwd_len = cwd.as_bytes().len();
            cwd_buf[cwd_len] = paths::SEP;
            let joined = paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
                &cwd_buf[..cwd_len + 1],
                &mut script_name_buf.0,
                &[target],
            );
            if joined.is_empty() {
                return false;
            }
            joined.len()
        };
        script_name_buf[open_len] = 0;
        // SAFETY: `script_name_buf[open_len] == 0` written above;
        // `script_name_buf[..open_len]` is init.
        let open_z = bun_core::ZStr::from_buf(&script_name_buf[..], open_len);

        // Open read-only. `catch return false` in Zig.
        let Ok(fd) = bun_sys::open(open_z, bun_sys::O::RDONLY, 0) else {
            return false;
        };
        // `.makeLibUVOwnedForSyscall(.open, .close_on_fail)` — hands the
        // HANDLE off to libuv ownership on Windows; pass-through on POSIX.
        let Ok(fd) = fd.make_lib_uv_owned_for_syscall(sys::Tag::open, sys::ErrorCase::CloseOnFail)
        else {
            return false;
        };

        // fstat: directories cannot be run. if only there was a faster way to
        // check this
        let is_dir = match bun_sys::fstat(fd) {
            Ok(st) => bun_sys::S::ISDIR(st.st_mode as _),
            Err(_) => {
                let _ = bun_sys::close(fd);
                return false;
            }
        };
        if is_dir {
            let _ = bun_sys::close(fd);
            return false;
        }

        Global::configure_allocator(core::Global::AllocatorConfiguration {
            long_running: true,
            ..Default::default()
        });

        // Re-derive the canonical absolute path from the open fd (resolves
        // symlinks). On non-Windows Zig writes back into `script_name_buf`.
        let absolute_script_path: Box<[u8]> = {
            let resolved = match bun_sys::get_fd_path(fd, &mut script_name_buf) {
                Ok(p) => p,
                Err(_) => {
                    let _ = bun_sys::close(fd);
                    return false;
                }
            };
            resolved.to_vec().into_boxed_slice()
        };
        let _ = bun_sys::close(fd);

        Self::_boot_and_handle_error(ctx, &absolute_script_path, None)
    }

    /// `bun run -` — read script from stdin into `ctx.runtime_options.eval`
    /// and boot the VM with the synthetic `[stdin]` path.
    fn exec_stdin(ctx: &mut ContextData) -> Result<bool, bun_core::Error> {
        bun_core::scoped_log!(RUN_LOG, "Executing from stdin");

        // read from stdin
        // PERF(port): Zig `stackFallback(2048, …)` — Phase B can swap to
        // `SmallVec<[u8; 2048]>` if profiled hot; cold CLI path here.
        // PORT NOTE: `read_to_end_into` is the cursor-relative streaming reader
        // (stdin is a pipe/tty, not seekable; `read_to_end` would `pread(0)`).
        let mut list: Vec<u8> = Vec::new();
        if bun_sys::File::stdin().read_to_end_into(&mut list).is_err() {
            return Ok(false);
        }
        ctx.runtime_options.eval.script = list.into_boxed_slice();

        // Zig: `bun.pathLiteral("/[stdin]")`.
        #[cfg(windows)]
        const STDIN_TRIGGER: &[u8] = b"\\[stdin]";
        #[cfg(not(windows))]
        const STDIN_TRIGGER: &[u8] = b"/[stdin]";

        let mut entry_point_buf = [0u8; MAX_PATH_BYTES + STDIN_TRIGGER.len()];
        let mut cwd_buf = PathBuffer::uninit();
        let cwd = bun_core::getcwd(&mut cwd_buf)?;
        let cwd_bytes = cwd.as_bytes();
        let cwd_len = cwd_bytes.len();
        entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
        entry_point_buf[cwd_len..cwd_len + STDIN_TRIGGER.len()].copy_from_slice(STDIN_TRIGGER);
        let entry_path = &entry_point_buf[..cwd_len + STDIN_TRIGGER.len()];

        // Zig: prepend "-" to `ctx.passthrough` so `process.argv[1]` matches
        // Node's `node -` semantics.
        let mut passthrough_list: Vec<Box<[u8]>> = Vec::with_capacity(ctx.passthrough.len() + 1);
        passthrough_list.push(b"-".to_vec().into_boxed_slice());
        passthrough_list.append(&mut ctx.passthrough);
        ctx.passthrough = passthrough_list;

        // Zig: `Run.boot(ctx, dupe(entry_path), null) catch |err| { … }`.
        // PORT NOTE: NOT routed through `_boot_and_handle_error` — the spec
        // stdin path (run_command.zig:1740-1749) skips the
        // `configureAllocator(.long_running=true)` / `.md` checks and prints
        // `basename(target_name)` (= "-"), not `basename(entry_path)`
        // (= "[stdin]"), in the error message.
        let owned: Box<[u8]> = entry_path.to_vec().into_boxed_slice();
        if let Err(err) = Self::boot(ctx, owned, None) {
            Self::boot_failed_exit(ctx, b"-", &err);
        }
        Ok(true)
    }

    /// Port of `cli.zig`'s `@"bun --eval --print"` — synthetic `cwd/[eval]`
    /// entry point + boot. `Arguments::parse` has already stashed the script
    /// in `ctx.runtime_options.eval.script`. Public so `Command::start` can
    /// route the `-e`/`-p` AutoCommand path here without re-implementing the
    /// path-buffer dance.
    pub fn exec_eval(ctx: &mut ContextData) -> Result<(), bun_core::Error> {
        // Zig: `ctx.passthrough = concat(ctx.positionals, ctx.passthrough)`.
        // PORT NOTE: prepend positionals into the existing passthrough vec
        // (cold path, single allocation).
        if !ctx.positionals.is_empty() {
            let mut merged: Vec<Box<[u8]>> =
                Vec::with_capacity(ctx.positionals.len() + ctx.passthrough.len());
            merged.extend(ctx.positionals.iter().cloned());
            merged.append(&mut ctx.passthrough);
            ctx.passthrough = merged;
        }

        let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
        let mut cwd_buf = PathBuffer::uninit();
        let cwd = bun_core::getcwd(&mut cwd_buf)?;
        let cwd_bytes = cwd.as_bytes();
        let cwd_len = cwd_bytes.len();
        entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
        entry_point_buf[cwd_len..cwd_len + EVAL_TRIGGER.len()].copy_from_slice(EVAL_TRIGGER);
        let entry: Box<[u8]> = entry_point_buf[..cwd_len + EVAL_TRIGGER.len()]
            .to_vec()
            .into_boxed_slice();
        Self::boot(ctx, entry, None)
    }

    /// `node` argv0 emulation. Port of `execAsIfNode`.
    pub fn exec_as_if_node(ctx: &mut ContextData) -> Result<(), bun_core::Error> {
        // SAFETY: single-threaded CLI startup; `PRETEND_TO_BE_NODE` is set in
        // `Command::which()` before dispatch.
        debug_assert!(crate::cli::PRETEND_TO_BE_NODE.load(::core::sync::atomic::Ordering::Relaxed));

        if !ctx.runtime_options.eval.script.is_empty() {
            // synthetic `[eval]` path under cwd
            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd(&mut cwd_buf)?;
            let cwd_bytes = cwd.as_bytes();
            let cwd_len = cwd_bytes.len();
            entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
            entry_point_buf[cwd_len..cwd_len + EVAL_TRIGGER.len()].copy_from_slice(EVAL_TRIGGER);
            let entry: Box<[u8]> = entry_point_buf[..cwd_len + EVAL_TRIGGER.len()]
                .to_vec()
                .into_boxed_slice();
            return Self::boot(ctx, entry, None);
        }

        if ctx.positionals.is_empty() {
            Self::exec_as_if_node_missing_script();
        }

        // PORT NOTE: borrowck — `_boot_and_handle_error` takes `&mut ctx`, so
        // dupe the positional out before the call.
        let filename: Box<[u8]> = ctx.positionals[0].clone();

        let normalized: Box<[u8]> = if paths::is_absolute(&filename) {
            filename
        } else {
            // PORT NOTE (run_command.zig:1976-1984): the spec writes
            // `path_buf[cwd.len] = std.fs.path.sep_posix` (always `/`, NOT the
            // platform separator) and then runs the result through
            // `resolve_path.joinAbsStringBuf(.., .loose)` to collapse `.`/`..`.
            let mut cwd_buf = PathBuffer::uninit();
            let cwd = bun_core::getcwd(&mut cwd_buf)?;
            let cwd_len = cwd.as_bytes().len();
            cwd_buf[cwd_len] = b'/';
            let mut out_buf = PathBuffer::uninit();
            let joined = paths::resolve_path::join_abs_string_buf::<paths::platform::Loose>(
                &cwd_buf[..cwd_len + 1],
                &mut out_buf.0,
                &[&filename],
            );
            joined.to_vec().into_boxed_slice()
        };

        // PORT NOTE (run_command.zig:1987-1992): this arm calls `Run.boot`
        // directly — NOT `_bootAndHandleError` — so it (a) does not call
        // `Global::configure_allocator` and (b) uses the
        // `Output.err(err, "Failed to run script \"...\"")` form.
        let basename: Box<[u8]> = paths::basename(&normalized).to_vec().into_boxed_slice();
        if let Err(err) = Self::boot(ctx, normalized, None) {
            Self::exec_as_if_node_boot_failed(ctx, &basename, err);
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    #[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
    fn exec_as_if_node_missing_script() -> ! {
        Output::err_generic(
            "Missing script to execute. Bun's provided 'node' cli wrapper does not support a repl.",
            (),
        );
        Global::exit(1);
    }

    #[cold]
    #[inline(never)]
    #[cfg_attr(target_os = "linux", unsafe(link_section = ".text.unlikely"))]
    fn exec_as_if_node_boot_failed(
        ctx: &mut ContextData,
        basename: &[u8],
        err: bun_core::Error,
    ) -> ! {
        // SAFETY: `ctx.log` set in `create_context_data` (single-threaded
        // CLI startup), process-lifetime.
        let _ = unsafe { ctx.log() }.print(std::ptr::from_mut::<bun_core::io::Writer>(
            Output::error_writer(),
        ));

        Output::err(
            err,
            "Failed to run script \"<b>{}<r>\"",
            (bstr::BStr::new(basename),),
        );
        Global::exit(1);
    }
}

// Zig: `bun.pathLiteral("/[eval]")` — `pathLiteral` swaps `/` → platform SEP
// at comptime. Only the leading separator matters here.
#[cfg(windows)]
const EVAL_TRIGGER: &[u8] = b"\\[eval]";
#[cfg(not(windows))]
const EVAL_TRIGGER: &[u8] = b"/[eval]";

/// Port of `escapeForJSString` (bun.js.zig:615) — escape `\ " \n \r \t` for
/// embedding in a double-quoted JS string literal. Used by the cron-execution
/// wrapper script to inline the entry path and cron period.
fn escape_for_js_string(input: &[u8]) -> Vec<u8> {
    if !input
        .iter()
        .any(|&c| matches!(c, b'\\' | b'"' | b'\n' | b'\r' | b'\t'))
    {
        return input.to_vec();
    }
    let mut result: Vec<u8> = Vec::with_capacity(input.len() + 16);
    for &c in input {
        match c {
            b'\\' => result.extend_from_slice(b"\\\\"),
            b'"' => result.extend_from_slice(b"\\\""),
            b'\n' => result.extend_from_slice(b"\\n"),
            b'\r' => result.extend_from_slice(b"\\r"),
            b'\t' => result.extend_from_slice(b"\\t"),
            _ => result.push(c),
        }
    }
    result
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ::core::marker::ConstParamTy)]
pub enum Filter {
    Script,
    Bin,
    BunJs,
    All,
    AllPlusBunJs,
    ScriptExclude,
    ScriptAndDescriptions,
}

type DoneChannel =
    bun_threading::Channel<u32, bun_collections::linear_fifo::StaticBuffer<u32, 256>>;

/// One pending remote-image download. Lives on the heap so its
/// `async_http.task` (embedded in ThreadPool.Task) has a stable
/// address — HTTPThread.schedule does `container_of` on that task,
/// so moving the struct would break the worker's callback.
struct RemoteImageDownload {
    // Assigned immediately after the struct literal in
    // prefetchRemoteImages (can't be set in the literal because
    // AsyncHTTP.init needs a pointer to response_buffer, which only
    // has a stable address once the owning struct is live).
    // Self-referential: borrows from `url: Box<[u8]>` below.
    async_http: bun_http::AsyncHTTP<'static>,
    response_buffer: bun_core::MutableString,
    url: Box<[u8]>,
    done: *const DoneChannel,
}

impl RemoteImageDownload {
    fn on_done(
        this: *mut RemoteImageDownload,
        async_http: *mut bun_http::AsyncHTTP<'static>,
        _result: bun_http::HTTPClientResult<'_>,
    ) {
        // Mirror sendSyncCallback from AsyncHTTP.zig: the worker's
        // ThreadlocalAsyncHTTP is about to be freed, so copy its
        // mutated state back into our owned AsyncHTTP before writing
        // to the channel.
        // SAFETY: `this` was passed as the callback ctx in `prefetch_remote_images`;
        // `async_http` is the worker-thread temporary whose `.real` points back at
        // `this.async_http`.
        unsafe {
            let this = &mut *this;
            let async_http = &mut *async_http;
            if let Some(real) = async_http.real {
                // Zig `real.* = async_http.*;` is a raw bitwise overwrite with
                // NO destructor on the old value. `ptr::write` preserves that —
                // `*real.as_ptr() = …` would run Drop on the previous
                // `this.async_http` (whose state the fresh copy still aliases).
                real.as_ptr().write(::core::ptr::read(async_http));
                (*real.as_ptr()).response_buffer = async_http.response_buffer;
            }
            // Channel payload is a placeholder tick — the main thread
            // walks `downloads[]` to read per-task state after N wakeups.
            let _ = (*this.done).write_item(0);
        }
    }
}

impl RunCommand {
    pub fn ls(ctx: &mut ContextData) -> Result<(), bun_core::Error> {
        let args = ctx.args.clone();

        let arena: &'static bun_alloc::Arena = runner_arena();
        let mut this_transpiler = Transpiler::init(arena, ctx.log, args, None)?;
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        this_transpiler.options.env.prefix = Box::default();

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.configure_linker();
        Ok(())
    }

    /// `bun feedback` — boots the embedded `eval/feedback.ts` script.
    fn bun_feedback(ctx: &mut ContextData) -> Result<::core::convert::Infallible, bun_core::Error> {
        let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
        // SAFETY: bun_paths::PathBuffer and bun_core::PathBuffer are
        // layout-identical newtypes over [u8; MAX_PATH_BYTES].
        let cwd = bun_core::getcwd(unsafe {
            &mut *entry_point_buf.as_mut_ptr().cast::<bun_core::PathBuffer>()
        })?;
        let cwd_len = cwd.as_bytes().len();
        entry_point_buf[cwd_len..cwd_len + EVAL_TRIGGER.len()].copy_from_slice(EVAL_TRIGGER);

        ctx.runtime_options.eval.script =
            bun_core::runtime_embed_file!(Codegen, "eval/feedback.ts")
                .as_bytes()
                .to_vec()
                .into_boxed_slice();

        Self::boot(
            ctx,
            entry_point_buf[..cwd_len + EVAL_TRIGGER.len()]
                .to_vec()
                .into_boxed_slice(),
            None,
        )?;
        Global::exit(0);
    }

    fn unlink_staged_path(path: &[u8]) {
        let mut zbuf = [0u8; MAX_PATH_BYTES + 1];
        if path.len() >= zbuf.len() {
            return;
        }
        zbuf[..path.len()].copy_from_slice(path);
        zbuf[path.len()] = 0;
        // SAFETY: NUL-terminated above.
        let z = ZStr::from_buf(&zbuf[..], path.len());
        let _ = sys::unlink(z);
    }

    /// Parse `contents` once with an ImageUrlCollector, download every
    /// http(s) image URL it finds to a temp file, and populate `out_map`
    /// with url → temp-path entries. Failures are silent — an image that
    /// can't be downloaded just falls back to alt-text rendering.
    fn prefetch_remote_images(
        contents: &[u8],
        md_opts: md::Options,
        out_map: &mut StringHashMap<Box<[u8]>>,
    ) {
        let mut collector = md::ImageUrlCollector::init();
        if md::render_with_renderer(contents, md_opts, collector.renderer()).is_err() {
            return;
        }
        if collector.urls.is_empty() {
            return;
        }

        // Walk the collected URLs once, deduping and picking out the
        // http(s) ones. If there are no remote URLs we never spawn the
        // HTTP worker or allocate any Download structs.
        let mut seen: StringHashMap<()> = StringHashMap::default();
        let mut remote_urls: Vec<Box<[u8]>> = Vec::new();
        for u in collector.urls.iter() {
            let u: &[u8] = u.as_ref();
            if !u.starts_with(b"http://") && !u.starts_with(b"https://") {
                continue;
            }
            let Ok(gop) = seen.get_or_put(u) else {
                continue;
            };
            if gop.found_existing {
                continue;
            }
            if remote_urls.try_reserve(1).is_err() {
                continue;
            }
            remote_urls.push(u.to_vec().into_boxed_slice());
        }
        if remote_urls.is_empty() {
            return;
        }

        bun_http::http_thread::init(&Default::default());

        // Heap-allocate each Download so AsyncHTTP.task has a stable
        // address (see RemoteImageDownload doc comment).
        let mut downloads: Vec<Box<RemoteImageDownload>> = Vec::new();
        // Drop frees response_buffer + the Box for each download.

        let done_channel = DoneChannel::init_static();

        // Kick off every download in parallel. Accumulate tasks into a
        // single ThreadPool.Batch, then ship the whole batch to the
        // HTTP thread in one schedule() call — worker picks up and runs
        // them concurrently.
        let mut batch = bun_threading::thread_pool::Batch::default();
        for raw_url in remote_urls.into_iter() {
            let Ok(response_buffer) = bun_core::MutableString::init(8 * 1024) else {
                continue;
            };
            // PORT NOTE: Zig wrote `.async_http = undefined` then overwrote it.
            // `AsyncHTTP` holds non-nullable `fn()` pointers (result_callback,
            // task.callback), so `mem::zeroed()` would be instant UB. Allocate
            // an uninit `Box`, write the cheap fields first to obtain stable
            // heap addresses for `url`/`response_buffer`, then `ptr::write`
            // the fully-formed `AsyncHTTP` last.
            let mut d: Box<::core::mem::MaybeUninit<RemoteImageDownload>> =
                Box::new(::core::mem::MaybeUninit::uninit());
            let slot = d.as_mut_ptr();
            // SAFETY: writing to uninitialized fields of a freshly-allocated
            // `MaybeUninit` slot; no prior value is dropped.
            unsafe {
                ::core::ptr::addr_of_mut!((*slot).response_buffer).write(response_buffer);
                ::core::ptr::addr_of_mut!((*slot).url).write(raw_url);
                ::core::ptr::addr_of_mut!((*slot).done).write(&raw const done_channel);
            }
            // SAFETY: `(*slot).url` is heap-owned and outlives the AsyncHTTP
            // (freed only when `downloads` drops after the channel drains).
            let url_static: &'static [u8] = unsafe {
                let url = &*::core::ptr::addr_of!((*slot).url);
                ::core::slice::from_raw_parts(url.as_ptr(), url.len())
            };
            let response_buffer_ptr: *mut bun_core::MutableString =
                unsafe { ::core::ptr::addr_of_mut!((*slot).response_buffer) };
            let d_ptr: *mut RemoteImageDownload = slot;
            let async_http = bun_http::AsyncHTTP::init(
                bun_http::Method::GET,
                bun_url::URL::parse(url_static),
                Default::default(),
                b"",
                response_buffer_ptr,
                b"",
                bun_http::HTTPClientResultCallback::new::<RemoteImageDownload>(
                    d_ptr,
                    RemoteImageDownload::on_done,
                ),
                bun_http::FetchRedirect::Follow,
                Default::default(),
            );
            // SAFETY: last field — all four fields are now initialized.
            unsafe { ::core::ptr::addr_of_mut!((*slot).async_http).write(async_http) };
            // SAFETY: every field of `RemoteImageDownload` was `ptr::write`n above.
            let mut d: Box<RemoteImageDownload> = unsafe {
                bun_core::heap::take(bun_core::heap::into_raw(d).cast::<RemoteImageDownload>())
            };
            d.async_http.schedule(&mut batch);
            downloads.push(d);
        }
        if downloads.is_empty() {
            return;
        }
        bun_http::HTTPThread::schedule(batch);

        // Block the main thread on the channel until every scheduled
        // download has reported back. readItem() uses a mutex+condvar,
        // no busy loop. The payload value is unused — each wakeup just
        // means "one more task finished".
        let mut completed: usize = 0;
        while completed < downloads.len() {
            if done_channel.read_item().is_err() {
                break;
            }
            completed += 1;
        }

        // Second pass: walk completed downloads, write successful
        // bodies to temp files, populate out_map. All disk I/O is done
        // AFTER every network request has settled.
        let tmpdir = bun_resolver::fs::RealFS::tmpdir_path();
        for d in downloads.iter_mut() {
            if d.async_http.err.is_some() {
                continue;
            }
            let status = d
                .async_http
                .response
                .as_ref()
                .map(|r| r.status_code)
                .unwrap_or(0);
            if status != 200 {
                continue;
            }
            let bytes = d.response_buffer.slice();
            if bytes.is_empty() {
                continue;
            }

            // Extension is best-effort from the URL path; Kitty inspects
            // the file's magic bytes regardless.
            let ext: &[u8] = if d.url.ends_with(b".png") {
                b".png"
            } else if d.url.ends_with(b".jpg") || d.url.ends_with(b".jpeg") {
                b".jpg"
            } else if d.url.ends_with(b".gif") {
                b".gif"
            } else if d.url.ends_with(b".webp") {
                b".webp"
            } else {
                b".bin"
            };
            let mut name_buf = [0u8; 64];
            let name = {
                let mut cursor = &mut name_buf[..];
                if write!(
                    cursor,
                    "bun-md-{:x}{}",
                    bun_core::fast_random(),
                    bstr::BStr::new(ext)
                )
                .is_err()
                {
                    continue;
                }
                let written = 64 - cursor.len();
                &name_buf[..written]
            };
            let mut path: Vec<u8> = Vec::new();
            if write!(
                &mut path,
                "{}/{}",
                bstr::BStr::new(tmpdir),
                bstr::BStr::new(name)
            )
            .is_err()
            {
                continue;
            }

            let fd = match sys::open_a(&path, sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC, 0o600)
            {
                Ok(f) => f,
                Err(_) => continue,
            };
            let ok = sys::File { handle: fd }.write_all(bytes).is_ok();
            fd.close();
            if !ok {
                // openA + TRUNC leaves an orphan even on zero-byte
                // write failure. Unlink via stack buffer so cleanup
                // can't fail for OOM reasons.
                Self::unlink_staged_path(&path);
                continue;
            }
            // Dupe d.url for the map key — `collector.urls` owns the backing
            // PORT NOTE: reshaped — Zig frees `key`/`path` and unlinks on
            // `put` failure. Check capacity first while `path` is still
            // borrowable for `unlink_staged_path`.
            if out_map.try_reserve(1).is_err() {
                Self::unlink_staged_path(&path);
                continue;
            }
            out_map.put_assume_capacity(&d.url, path.into_boxed_slice());
        }
    }

    fn render_markdown_file_and_exit(path: &[u8]) -> ! {
        // No explicit free() on contents / rendered below: every path out
        // of this function calls Global::exit() or bun.outOfMemory() (both
        // noreturn), so the OS reclaims the allocations on process exit.
        let contents = match sys::File::read_from(Fd::cwd(), path) {
            Ok(bytes) => bytes,
            Err(err) => {
                pretty_errorln!("<r><red>error<r>: {}", err);
                Output::flush();
                Global::exit(1);
            }
        };

        // Theme selection: colors when stdout is a TTY (or forced on),
        // hyperlinks when colors are on. Light/dark detected from env.
        let colors = Output::enable_ansi_colors_stdout();
        let columns: u16 = 'brk: {
            // Output.terminal_size is never populated; query stdout
            // directly. Honor COLUMNS so piped output and tests can
            // pin a width.
            if let Some(env) = bun_core::getenv_z(bun_core::zstr!("COLUMNS")) {
                if let Some(n) = bun_core::fmt::parse_int::<u16>(env, 10).ok() {
                    if n > 0 {
                        break 'brk n;
                    }
                }
            }
            #[cfg(unix)]
            {
                // SAFETY: all-zero is a valid winsize (#[repr(C)] POD).
                let mut size: libc::winsize = bun_core::ffi::zeroed();
                // SAFETY: ioctl with valid winsize ptr
                if unsafe { libc::ioctl(libc::STDOUT_FILENO, libc::TIOCGWINSZ, &raw mut size) } == 0
                {
                    if size.ws_col > 0 {
                        break 'brk size.ws_col;
                    }
                }
            }
            #[cfg(windows)]
            {
                if let Some(handle) = sys::windows::GetStdHandle(sys::windows::STD_OUTPUT_HANDLE) {
                    // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (#[repr(C)] POD).
                    let mut csbi: sys::windows::CONSOLE_SCREEN_BUFFER_INFO =
                        unsafe { bun_core::ffi::zeroed_unchecked() };
                    // SAFETY: FFI Win32 `GetConsoleScreenBufferInfo`. `handle`
                    // is a valid console output HANDLE from GetStdHandle and
                    // `csbi` is a valid mutable CONSOLE_SCREEN_BUFFER_INFO out-ptr.
                    if unsafe {
                        sys::windows::kernel32::GetConsoleScreenBufferInfo(handle, &mut csbi)
                    } != sys::windows::FALSE
                    {
                        let w = csbi.srWindow.Right - csbi.srWindow.Left + 1;
                        if w > 0 {
                            break 'brk u16::try_from(w).expect("int cast");
                        }
                    }
                }
            }
            80
        };
        let is_tty = Output::is_stdout_tty();
        let kitty_graphics = colors && is_tty && md::detect_kitty_graphics();

        let md_opts: md::Options = md::Options::TERMINAL;

        // Pre-scan for http(s) image URLs so Kitty can display them
        // inline. Only runs when kitty_graphics is on and the document
        // actually contains an image marker — otherwise the whole block
        // is a no-op.
        let mut remote_map: StringHashMap<Box<[u8]>> = StringHashMap::default();
        if kitty_graphics && strings::contains(&contents, b"![") {
            Self::prefetch_remote_images(&contents, md_opts, &mut remote_map);
        }

        // Relative image paths in the markdown should resolve against
        // the document's directory, not the process cwd — otherwise
        // `bun ./docs/README.md` from `/home/user` can't find `./img.png`
        // that sits next to README.md. Resolve to an absolute dir first
        // so joinAbsString downstream doesn't double-apply cwd.
        let mut base_buf = PathBuffer::uninit();
        let mut cwd_buf = PathBuffer::uninit();
        let abs_md_path: &[u8] = 'blk: {
            if paths::is_absolute(path) {
                break 'blk path;
            }
            let cwd: &[u8] = match sys::getcwd(&mut cwd_buf.0[..]) {
                Ok(n) => &cwd_buf[..n],
                Err(_) => break 'blk path,
            };
            paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
                cwd,
                &mut base_buf.0,
                &[path],
            )
        };
        let dir = paths::resolve_path::dirname::<paths::platform::Auto>(abs_md_path);
        // When dirname returns empty (bare filename + getcwd failed), fall
        // back to "." instead of abs_md_path — otherwise joinAbsString
        // downstream would treat the file path itself as a directory.
        let image_base_dir: &[u8] = if !dir.is_empty() { dir } else { b"." };

        let theme = md::AnsiTheme {
            light: md::detect_light_background(),
            columns,
            colors,
            hyperlinks: colors && is_tty,
            kitty_graphics,
            remote_image_paths: if remote_map.count() > 0 {
                Some(&remote_map)
            } else {
                None
            },
            image_base_dir: Some(image_base_dir),
        };

        let rendered = match md::render_to_ansi(&contents, md_opts, theme) {
            Err(bun_md::parser::ParserError::OutOfMemory) => bun_core::out_of_memory(),
            Err(bun_md::parser::ParserError::StackOverflow) => {
                pretty_errorln!(
                    "<r><red>error<r>: markdown rendering exceeded the stack — input is too deeply nested",
                );
                Output::flush();
                Global::exit(1);
            }
            Err(_) | Ok(None) => {
                pretty_errorln!("<r><red>error<r>: failed to render markdown");
                Output::flush();
                Global::exit(1);
            }
            Ok(Some(r)) => r,
        };

        let _ = Output::writer().write_all(&rendered);
        Output::flush();
        // Temp files prefetchRemoteImages() wrote are deliberately NOT
        // unlinked here. Output.flush() only guarantees the APC bytes
        // reached the terminal's PTY ring buffer — Kitty reads the file
        // asynchronously from its own event loop, so unlinking inside
        // this process races Kitty's open() and typically drops images
        // silently (q=2 suppresses the error). System tmp cleanup
        // (systemd-tmpfiles, /tmp reboot wipe) eventually removes the
        // bun-md-*.png files, which are small (~100KB each) and rare.
        Global::exit(0);
    }

    /// Shell-completion entries for `bun run`. Called from
    /// `cli_body::bun_getcompletes`.
    pub fn completions<const FILTER: Filter>(
        ctx: &mut ContextData,
        default_completions: Option<&'static [&'static [u8]]>,
        reject_list: &[&[u8]],
    ) -> Result<ShellCompletions, bun_core::Error> {
        let mut shell_out = ShellCompletions::default();
        if FILTER != Filter::ScriptExclude {
            if let Some(defaults) = default_completions {
                shell_out.commands = std::borrow::Cow::Borrowed(defaults);
            }
        }

        let args = ctx.args.clone();

        let Ok(mut this_transpiler) = Transpiler::init(runner_arena(), ctx.log, args, None) else {
            return Ok(shell_out);
        };
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        this_transpiler.options.env.prefix = Box::default();
        // SAFETY: `Transpiler::env` is a non-null process-lifetime `*mut Loader`.
        unsafe { (*this_transpiler.env).quiet = true };

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = true;
        this_transpiler.configure_linker();

        // SAFETY: `Transpiler::fs` is the non-null process-static singleton.
        let top_level_dir = unsafe { (*this_transpiler.fs).top_level_dir };
        let Some(root_dir_info) = this_transpiler
            .resolver
            .read_dir_info(top_level_dir)
            .ok()
            .flatten()
        else {
            this_transpiler.resolver.care_about_bin_folder = false;
            this_transpiler.resolver.care_about_scripts = false;
            return Ok(shell_out);
        };

        {
            this_transpiler.env_mut().load_process()?;

            if let Some(node_env) = this_transpiler.env().get(b"NODE_ENV") {
                if node_env == b"production" {
                    this_transpiler.options.production = true;
                }
            }
        }

        type ResultList = ArrayHashMap<Box<[u8]>, ()>;

        if let Some(shell) = this_transpiler.env().get(b"SHELL") {
            shell_out.shell = crate::cli::shell_completions::Shell::from_env(shell);
        }

        let mut results = ResultList::new();
        let mut descriptions: Vec<&[u8]> = Vec::new();

        if FILTER != Filter::ScriptExclude {
            if let Some(defaults) = default_completions {
                results.ensure_unused_capacity(defaults.len())?;
                for item in defaults {
                    let _ = results.get_or_put(Box::from(*item));
                }
            }
        }

        if FILTER == Filter::Bin || FILTER == Filter::All || FILTER == Filter::AllPlusBunJs {
            // `bin_dirs()` reads process-static storage but its return slice is
            // tied to `&self`, which would conflict with the `&mut self` borrow
            // taken by `read_dir_info` inside the loop. Snapshot the `'static`
            // path slices into a local Vec to detach the borrow.
            let bin_dirs_snapshot: Vec<&'static [u8]> =
                this_transpiler.resolver.bin_dirs().to_vec();
            for bin_path in bin_dirs_snapshot {
                if let Some(bin_dir) = this_transpiler
                    .resolver
                    .read_dir_info(bin_path)
                    .ok()
                    .flatten()
                {
                    // SAFETY: resolver cache owns the DirInfo for the process lifetime.
                    if let Some(entries) = unsafe { &*bin_dir }.get_entries_const() {
                        let mut path_buf = PathBuffer::uninit();
                        let mut iter = entries.data.iter();
                        let mut has_copied = false;
                        let mut dir_slice_len: usize = 0;
                        while let Some(entry) = iter.next() {
                            // SAFETY: `EntryMap` stores non-null `*mut Entry` values owned by
                            // the resolver dir-cache for the process lifetime.
                            let value = unsafe { &**entry.1 };
                            // SAFETY: `Transpiler::fs` is the non-null process-static singleton.
                            if value.kind(unsafe { &raw mut (*this_transpiler.fs).fs }, true)
                                == bun_resolver::fs::EntryKind::File
                            {
                                if !has_copied {
                                    path_buf[..value.dir.len()].copy_from_slice(value.dir);
                                    dir_slice_len = value.dir.len();
                                    if !strings::ends_with_char_or_is_zero_length(value.dir, SEP) {
                                        dir_slice_len = value.dir.len() + 1;
                                    }
                                    has_copied = true;
                                }

                                let base = value.base();
                                path_buf[dir_slice_len..dir_slice_len + base.len()]
                                    .copy_from_slice(base);
                                path_buf[dir_slice_len + base.len()] = 0;
                                // SAFETY: NUL terminator written above
                                let slice =
                                    ZStr::from_buf(&path_buf[..], dir_slice_len + base.len());
                                if !sys::is_executable_file_path(slice) {
                                    continue;
                                }
                                // we need to dupe because the string may point to a pointer that only exists in the current scope
                                // SAFETY: `Transpiler::fs` is the non-null process-static singleton.
                                let Ok(appended) = unsafe { (*this_transpiler.fs).filename_store }
                                    .append_slice(base)
                                else {
                                    continue;
                                };
                                let _ = results.get_or_put(Box::from(appended))?;
                            }
                        }
                    }
                }
            }
        }

        if FILTER == Filter::AllPlusBunJs || FILTER == Filter::BunJs {
            if let Some(dir_info) = this_transpiler
                .resolver
                .read_dir_info(top_level_dir)
                .ok()
                .flatten()
            {
                if let Some(entries) = dir_info.get_entries_const() {
                    let mut iter = entries.data.iter();

                    while let Some(entry) = iter.next() {
                        // SAFETY: `EntryMap` stores non-null `*mut Entry` values owned by the
                        // resolver dir-cache for the process lifetime.
                        let value = unsafe { &**entry.1 };
                        let name = value.base();
                        if name[0] != b'.'
                            && this_transpiler
                                .options
                                .loader(paths::extension(name))
                                .can_be_run_by_bun()
                            && !strings::contains(name, b".config")
                            && !strings::contains(name, b".d.ts")
                            && !strings::contains(name, b".d.mts")
                            && !strings::contains(name, b".d.cts")
                            // SAFETY: `Transpiler::fs` is the non-null process-static singleton.
                            && value.kind(unsafe { &raw mut (*this_transpiler.fs).fs }, true)
                                == bun_resolver::fs::EntryKind::File
                        {
                            // SAFETY: `Transpiler::fs` is the non-null process-static singleton.
                            let Ok(appended) =
                                unsafe { (*this_transpiler.fs).filename_store }.append_slice(name)
                            else {
                                continue;
                            };
                            let _ = results.get_or_put(Box::from(appended))?;
                        }
                    }
                }
            }
        }

        if FILTER == Filter::ScriptExclude
            || FILTER == Filter::Script
            || FILTER == Filter::All
            || FILTER == Filter::AllPlusBunJs
            || FILTER == Filter::ScriptAndDescriptions
        {
            if let Some(package_json) = root_dir_info.enclosing_package_json {
                if let Some(scripts) = package_json.scripts.as_deref() {
                    results.ensure_unused_capacity(scripts.count())?;
                    if FILTER == Filter::ScriptAndDescriptions {
                        descriptions.reserve(scripts.count());
                    }

                    let mut max_description_len: usize = 20;
                    if let Some(max) = this_transpiler.env().get(b"MAX_DESCRIPTION_LEN") {
                        if let Ok(max_len) = bun_core::fmt::parse_int::<usize>(max, 10) {
                            max_description_len = max_len;
                        }
                    }

                    let keys = scripts.keys();
                    let mut key_i: usize = 0;
                    'loop_: while key_i < keys.len() {
                        let key: &[u8] = &keys[key_i];
                        key_i += 1;

                        if FILTER == Filter::ScriptExclude {
                            for default in reject_list {
                                if *default == key {
                                    continue 'loop_;
                                }
                            }
                        }

                        // npm-style lifecycle hooks: a script named `pre<X>` or `post<X>` runs
                        // automatically around `<X>`, so there's no reason to list it as a
                        // completion target. But `prettier`, `prebuild`-with-no-`build`,
                        // `postgres`, etc. are standalone scripts — keep them.
                        if key.starts_with(b"pre") {
                            if scripts.contains(&key[b"pre".len()..]) {
                                continue 'loop_;
                            }
                        } else if key.starts_with(b"post") {
                            if scripts.contains(&key[b"post".len()..]) {
                                continue 'loop_;
                            }
                        }

                        // PERF(port): capacity reserved by `ensure_unused_capacity`
                        // above; `assume_capacity` skips the grow check and
                        // avoids a redundant alloc when the key is a duplicate.
                        let entry_item = results.get_or_put_assume_capacity(Box::from(key));

                        if FILTER == Filter::ScriptAndDescriptions && max_description_len > 0 {
                            let mut description: &[u8] = *scripts.get(key).unwrap();

                            // When the command starts with something like
                            // NODE_OPTIONS='--max-heap-size foo' bar
                            // ^--------------------------------^ trim that
                            // that way, you can see the real command that's being run
                            if !description.is_empty() {
                                'trimmer: {
                                    if !description.is_empty()
                                        && description.starts_with(b"NODE_OPTIONS=")
                                    {
                                        if let Some(i) = strings::index_of_char(description, b'=') {
                                            let i = i as usize;
                                            let delimiter: u8 = if description.len() > i + 1 {
                                                match description[i + 1] {
                                                    b'\'' => b'\'',
                                                    b'"' => b'"',
                                                    _ => b' ',
                                                }
                                            } else {
                                                break 'trimmer;
                                            };

                                            let delimiter_offset: usize =
                                                if delimiter == b' ' { 1 } else { 2 };
                                            if description.len() > delimiter_offset + i {
                                                if let Some(j) = strings::index_of_char(
                                                    &description[delimiter_offset + i..],
                                                    delimiter,
                                                ) {
                                                    let j = j as usize;
                                                    description = strings::trim(
                                                        &description[delimiter_offset + i..]
                                                            [j + 1..],
                                                        b" ",
                                                    );
                                                } else {
                                                    break 'trimmer;
                                                }
                                            } else {
                                                break 'trimmer;
                                            }
                                        } else {
                                            break 'trimmer;
                                        }
                                    }
                                }

                                if description.len() > max_description_len {
                                    description = &description[..max_description_len];
                                }
                            }

                            descriptions.insert(entry_item.index, description);
                        }
                    }
                }
            }
        }

        this_transpiler.resolver.care_about_bin_folder = false;
        this_transpiler.resolver.care_about_scripts = false;

        // PORT NOTE: `ShellCompletions` stores `&'static [&'static [u8]]`; the
        // keys interned into `filename_store` / boxed from static tables outlive
        // the process. The owning `results` ArrayHashMap is held in a process-
        // lifetime arena slot so the borrowed keys remain valid (Zig never
        // freed it either).
        let mut all_keys: Vec<&'static [u8]> = results
            .keys()
            .iter()
            .map(|k| -> &'static [u8] {
                // SAFETY: every key is a freshly-boxed `Box<[u8]>` owned by
                // `results`. The owning `ArrayHashMap` is parked in the
                // process-lifetime `runner_arena()` below and `bumpalo::Bump`
                // never runs `Drop`, so the boxed bytes live until process
                // exit and erasing to `'static` is sound.
                unsafe { ::core::slice::from_raw_parts(k.as_ptr(), k.len()) }
            })
            .collect();
        strings::sort_asc(&mut all_keys);
        // Park the owning maps in the runner arena (process-lifetime) so the
        // `'static` slices above remain valid without leaking/forgetting.
        let _ = runner_arena().alloc(results);
        shell_out.commands = std::borrow::Cow::Borrowed(runner_arena().alloc_slice_copy(&all_keys));
        shell_out.descriptions = std::borrow::Cow::Borrowed(runner_arena().alloc_slice_copy(
            // SAFETY: descriptions borrow into the package.json source buffer
            // (process-lifetime); erase to `'static`.
            unsafe {
                ::core::slice::from_raw_parts(
                    descriptions.as_ptr().cast::<&'static [u8]>(),
                    descriptions.len(),
                )
            },
        ));

        Ok(shell_out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows `.bunx` fast-path: skip the wrapper exe by reading the shim metadata
// directly and either spawning the target binary or booting Bun in-process.
// ─────────────────────────────────────────────────────────────────────────────

bun_core::declare_scope!(BUNX_FAST_PATH_LOG, visible);

/// Uninhabited namespace holder; all members are associated items.
pub enum BunXFastPath {}

#[cfg(windows)]
mod bunx_fast_path_buffers {
    use super::*;
    // PORTING.md §Global mutable state: Windows-only single-thread CLI scratch
    // buffers (bunx fast-path runs once on the main thread) → RacyCell.
    pub static DIRECT_LAUNCH_BUFFER: bun_core::RacyCell<WPathBuffer> =
        bun_core::RacyCell::new(WPathBuffer::ZEROED);
    // Zig spec (run_command.zig:2014): `var environment_buffer: bun.WPathBuffer`
    // — same `[PATH_MAX_WIDE]u16` shape as the launch buffer.
    pub static ENVIRONMENT_BUFFER: bun_core::RacyCell<WPathBuffer> =
        bun_core::RacyCell::new(WPathBuffer::ZEROED);
}

impl BunXFastPath {
    /// Port of `appendWindowsArgument` (run_command.zig:2049-2091): convert a
    /// UTF-8 argument to UTF-16, applying Windows command-line quoting/escaping
    /// per the canonical "Everyone quotes command line arguments the wrong way"
    /// rules. Writes into `buffer` and returns the number of u16s written.
    #[cfg(windows)]
    fn append_windows_argument(buffer: &mut [u16], arg: &[u8]) -> usize {
        let mut wbuf = [0u16; bun_paths::MAX_WPATH];
        let warg = strings::convert_utf8_to_utf16_in_buffer(&mut wbuf, arg);

        if warg.is_empty() {
            // Empty argument needs quotes.
            buffer[0] = b'"' as u16;
            buffer[1] = b'"' as u16;
            return 2;
        }

        // Spec (run_command.zig:2042-2044): trigger quoting only on
        // space/tab/quote — compare the FULL u16, not the truncated low byte.
        let needs_quote = warg
            .iter()
            .any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'"' as u16);

        if !needs_quote {
            buffer[..warg.len()].copy_from_slice(warg);
            return warg.len();
        }

        // Fast path: no embedded `"`/`\` → simple wrap (zig:2052-2062).
        let has_quote_or_backslash = warg.iter().any(|&c| c == b'"' as u16 || c == b'\\' as u16);
        if !has_quote_or_backslash {
            buffer[0] = b'"' as u16;
            buffer[1..1 + warg.len()].copy_from_slice(warg);
            buffer[warg.len() + 1] = b'"' as u16;
            return warg.len() + 2;
        }

        // Complex case: libuv reverse-walk backslash escaping.
        let mut pos: usize = 0;
        buffer[pos] = b'"' as u16;
        pos += 1;
        let start = pos;

        // Walk the wide string in reverse, emitting escapes for `"` and
        // backslash runs that precede a `"` (the closing quote we add last).
        let mut quote_hit = true;
        let mut i = warg.len();
        while i > 0 {
            i -= 1;
            let c = warg[i];
            buffer[pos] = c;
            pos += 1;
            if quote_hit && c == b'\\' as u16 {
                buffer[pos] = b'\\' as u16;
                pos += 1;
            } else if c == b'"' as u16 {
                quote_hit = true;
                buffer[pos] = b'\\' as u16;
                pos += 1;
            } else {
                quote_hit = false;
            }
        }

        // Reverse the content we just wrote (between opening quote and current position)
        buffer[start..pos].reverse();

        // Add closing quote
        buffer[pos] = b'"' as u16;
        pos += 1;

        pos
    }

    /// If this returns, it implies the fast path cannot be taken.
    #[cfg(windows)]
    pub fn try_launch(
        ctx: &mut ContextData,
        path_len: usize,
        env: &mut DotEnv::Loader<'static>,
        passthrough: &[Box<[u8]>],
    ) {
        if !bun_core::FeatureFlags::WINDOWS_BUNX_FAST_PATH {
            return;
        }

        // SAFETY: process-lifetime static, single-threaded CLI dispatch.
        let direct_launch_buffer =
            unsafe { &mut *bunx_fast_path_buffers::DIRECT_LAUNCH_BUFFER.get() };
        let (path_to_use, command_line) = direct_launch_buffer.split_at_mut(path_len);

        bun_core::scoped_log!(
            BUNX_FAST_PATH_LOG,
            "Attempting to find and load bunx file: '{}'",
            bun_core::fmt::utf16(path_to_use)
        );
        debug_assert!(paths::is_absolute_windows_wtf16(path_to_use));

        let handle = match sys::open_file_at_windows(
            Fd::INVALID, // absolute path is given
            path_to_use,
            sys::NtCreateFileOptions {
                access_mask: sys::windows::STANDARD_RIGHTS_READ
                    | sys::windows::FILE_READ_DATA
                    | sys::windows::FILE_READ_ATTRIBUTES
                    | sys::windows::FILE_READ_EA
                    | sys::windows::SYNCHRONIZE,
                disposition: sys::windows::FILE_OPEN,
                options: sys::windows::FILE_NON_DIRECTORY_FILE
                    | sys::windows::FILE_SYNCHRONOUS_IO_NONALERT,
                ..Default::default()
            },
        ) {
            Ok(fd) => fd.native(),
            Err(err) => {
                bun_core::scoped_log!(BUNX_FAST_PATH_LOG, "Failed to open bunx file: '{}'", err);
                return;
            }
        };

        let mut i: usize = 0;
        for arg in passthrough {
            // Add space separator before each argument
            command_line[i] = b' ' as u16;
            i += 1;
            i += Self::append_windows_argument(&mut command_line[i..], arg);
        }
        // Zig: `ctx.passthrough = passthrough;` — `direct_launch_callback` →
        // `Run.boot` reads `vm.argv = ctx.passthrough`, so the assignment must
        // happen before the shim may call back. Current callers pass a clone of
        // `ctx.passthrough` so this is a write-back of identical data, but the
        // spec contract is that *this* `passthrough` wins.
        ctx.passthrough = passthrough.to_vec();

        // SAFETY: process-lifetime static, single-threaded CLI dispatch.
        let env_buf = unsafe { &mut *bunx_fast_path_buffers::ENVIRONMENT_BUFFER.get() };
        let environment = match env.map.write_windows_env_block(&mut env_buf.0) {
            Ok(env) => Some(env),
            Err(_) => {
                // Spec (run_command.zig:2148) leaks `handle` here via
                // `catch return`; the shim's `NtClose(metadata_handle)` only
                // runs if `try_startup_from_bun_js` is reached. Close it
                // explicitly so the slow-path fallback doesn't inherit a
                // dangling open HANDLE for the process lifetime.
                Fd::from_native(handle as u64).close();
                return;
            }
        };

        let run_ctx = bun_install::windows_shim::bun_shim_impl::FromBunRunContext {
            handle,
            base_path: path_to_use[4..].as_mut_ptr(),
            base_path_len: path_to_use.len() - 4,
            arguments: command_line.as_mut_ptr(),
            arguments_len: i,
            force_use_bun: ctx.debug.run_in_bun,
            direct_launch_with_bun_js: Self::direct_launch_callback,
            cli_context: ::core::ptr::from_mut(ctx),
            environment,
        };

        bun_core::scoped_log!(
            BUNX_FAST_PATH_LOG,
            "run_ctx.force_use_bun: '{}'",
            run_ctx.force_use_bun
        );

        bun_install::windows_shim::bun_shim_impl::try_startup_from_bun_js(run_ctx);

        bun_core::scoped_log!(BUNX_FAST_PATH_LOG, "did not start via shim");
    }

    #[cfg(windows)]
    fn direct_launch_callback(wpath: &mut [u16], ctx: bun_options_types::context::Context<'_>) {
        // SAFETY: process-lifetime static, single-threaded CLI dispatch.
        // `try_launch` (still on the call stack) holds live `&mut [u16]`
        // reborrows (`path_to_use`/`command_line`) and raw pointers
        // (`run_ctx.base_path`/`arguments`) into this same UnsafeCell.
        // Materialising a fresh `&mut WPathBuffer` here would push a Unique
        // tag over the whole buffer and pop those tags under Stacked Borrows.
        // Derive the byte slice directly from the raw `*mut WPathBuffer` so no
        // intermediate `&mut` retag covers the caller's borrows.
        // WPathBuffer is `#[repr(transparent)] [u16; PATH_MAX_WIDE]` —
        // reinterpret as `[u8; 2N]` for the UTF-16→UTF-8 transcoder's output.
        let out_buf = unsafe {
            let raw = bunx_fast_path_buffers::DIRECT_LAUNCH_BUFFER.get();
            ::core::slice::from_raw_parts_mut(raw.cast::<u8>(), bun_paths::PATH_MAX_WIDE * 2)
        };
        let utf8 = strings::convert_utf16_to_utf8_in_buffer(out_buf, wpath);
        if let Err(err) = RunCommand::boot(ctx, utf8.to_vec().into_boxed_slice(), None) {
            // SAFETY: `ctx.log` was set in `create_context_data`.
            let _ = unsafe { &mut *ctx.log }.print(std::ptr::from_mut(Output::error_writer()));
            Output::err(
                err,
                "Failed to run bin \"<b>{}<r>\"",
                (bstr::BStr::new(paths::basename(utf8)),),
            );
            Global::exit(1);
        }
    }
}

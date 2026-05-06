//! Port of `src/runtime/cli/run_command.zig`.
//!
//! B-2 round 3: dispatch un-gate. `RunCommand::exec` / `exec_as_if_node` are
//! now real — they classify the positional as a file path vs. a package.json
//! script and, for the file-path arm, boot the JS VM directly via the now-real
//! `bun_jsc::VirtualMachine::{init, load_entry_point}` hooks.
//!
//! `configure_env_for_run` + `run_package_script_foreground` are now real:
//! Transpiler/DotEnv/Resolver are direct deps and the package.json `scripts`
//! lookup arm in `exec()` calls them. Sub-gated inside those bodies:
//! `Transpiler::{configure_linker,run_env_loader}`, the bun-shell
//! `Interpreter::init_and_run_from_source` path, the full `bun.spawnSync`
//! options struct, and `ParentDeathWatchdog` — all blocked on lower-tier
//! surfaces, not on this file.
//!
//! Still re-gated inside `exec()` with ``: `configure_path_for_run`
//! (bun-node fake-exe + PATH stitching), `node_modules/.bin` `which()` fallback,
//! the markdown renderer, and the full `Run::start` run-loop (`hold_api_lock` +
//! `globalExit`); their bodies are preserved verbatim in `phase_a_draft` below.

use ::core::ffi::c_void;
use ::core::sync::atomic::{AtomicBool, Ordering};

use bun_bundler::Transpiler;
use bun_core::{self as core, Environment, Global, Output, ZStr};
use bun_core::{pretty, pretty_errorln, prettyln};
use bun_dotenv as DotEnv;
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::virtual_machine::{ExitHandler, InitOptions as VmInitOptions, VirtualMachine};
use bun_jsc::{JSGlobalObject, JSValue};
use bun_options_types::schema::api;
use bun_options_types::BundleEnums::Loader;
use bun_paths::{self as paths, MAX_PATH_BYTES, PathBuffer};
use bun_resolver::dir_info::DirInfo;
use bun_string::strings;
use bun_which::which;

use crate::cli::arguments;
use crate::cli::command::{ContextData, Tag as CommandTag};

bun_core::declare_scope!(RUN_LOG, visible);

/// Process-lifetime arena for the runner's `Transpiler`. Zig passed
/// `ctx.allocator` (== `bun.default_allocator`); the Rust port threads an
/// `&'static Arena` per PORTING.md §AST crates. `bun_alloc::Arena` (=
/// `bumpalo::Bump`) is `!Sync`, so `OnceLock`/`LazyLock` cannot hold it
/// directly — guard a `static mut MaybeUninit` with `Once` instead so the
/// allocation happens exactly once (PORTING.md §Forbidden bars `Box::leak`
/// per call).
fn runner_arena() -> &'static bun_alloc::Arena {
    static ONCE: std::sync::Once = std::sync::Once::new();
    static mut ARENA: ::core::mem::MaybeUninit<bun_alloc::Arena> =
        ::core::mem::MaybeUninit::uninit();
    ONCE.call_once(|| {
        // SAFETY: one-time init under `Once`; no concurrent writer.
        unsafe { (*(&raw mut ARENA)).write(bun_alloc::Arena::new()) };
    });
    // SAFETY: initialized exactly once above. `configure_env_for_run` is only
    // ever called from the single CLI dispatch thread, so the `!Sync` Bump is
    // never observed concurrently.
    unsafe { (*(&raw const ARENA)).assume_init_ref() }
}

/// Inlined from `shell_body.rs` (`SPECIAL_CHARS` / `needs_escape_utf8_ascii_latin1`
/// / `escape_8bit`) so passthrough-arg escaping is never lossy while the
/// shell crate is ``-gated. Kept byte-identical to the spec
/// (run_command.zig:233-239 → shell.zig escape8Bit).
mod shell_escape_inline {
    const SPECIAL_JS_CHAR: u8 = 8;
    const SPECIAL_CHARS: [u8; 34] = [
        b'~', b'[', b']', b'#', b';', b'\n', b'*', b'{', b',', b'}', b'`', b'$', b'=', b'(', b')',
        b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'|', b'>', b'<', b'&', b'\'',
        b'"', b' ', b'\\', SPECIAL_JS_CHAR,
    ];
    const BACKSLASHABLE_CHARS: [u8; 4] = [b'$', b'`', b'"', b'\\'];

    pub(super) fn needs_escape_utf8_ascii_latin1(str: &[u8]) -> bool {
        for &c in str {
            for &sc in &SPECIAL_CHARS {
                if c == sc {
                    return true;
                }
            }
        }
        false
    }

    /// works for utf-8, latin-1, and ascii
    pub(super) fn escape_8bit(str: &[u8], outbuf: &mut Vec<u8>, add_quotes: bool) {
        outbuf.reserve(str.len());
        if add_quotes {
            outbuf.push(b'"');
        }
        'outer: for &c in str {
            for &spc in &BACKSLASHABLE_CHARS {
                if spc == c {
                    outbuf.extend_from_slice(&[b'\\', c]);
                    continue 'outer;
                }
            }
            outbuf.push(c);
        }
        if add_quotes {
            outbuf.push(b'"');
        }
    }
}

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
        Self { bin_dirs_only: false, log_errors: true, allow_fast_run_for_extensions: true }
    }
}

pub struct RunCommand;

impl RunCommand {
    /// `bun run --help` body. Real (no JSC/transpiler deps).
    pub fn print_help(_package_json: Option<&()>) {
        // TODO(port): `package_json: Option<&PackageJSON>` — script-listing
        // section gated on bun_resolver::package_json::PackageJSON shape.
        const INTRO_TEXT: &str = "\
<b>Usage<r>: <b><green>bun run<r> <cyan>[flags]<r> <blue>\\<file or script\\><r>

  Run a JavaScript or TypeScript file, or a package.json script.

<b>Flags:<r>";

        const OUTRO_TEXT: &str = "\
<b>Examples:<r>
  <d>Run a JavaScript or TypeScript file<r>
  <b><green>bun run<r> <blue>./index.js<r>
  <b><green>bun run<r> <blue>./index.tsx<r>

  <d>Run a package.json script<r>
  <b><green>bun run<r> <blue>dev<r>
  <b><green>bun run<r> <blue>lint<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/run<r>
";

        pretty!("{}", INTRO_TEXT);
        Output::flush();
        bun_clap::simple_help(crate::cli::arguments::RUN_PARAMS.as_slice());
        prettyln!("\n");
        pretty!("{}", OUTRO_TEXT);
        Output::flush();
    }

    const SHELLS_TO_SEARCH: &'static [&'static [u8]] = &[b"bash", b"sh", b"zsh"];

    const BUN_BIN_NAME: &'static str = if cfg!(debug_assertions) { "bun-debug" } else { "bun" };
    const BUN_RUN: &'static str = const_format::concatcp!(RunCommand::BUN_BIN_NAME, " run");

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
                let z = unsafe { ZStr::from_raw(path_buf.as_ptr(), shell.len()) };
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
        // CLI thread.
        static mut SHELL_BUF: PathBuffer = PathBuffer::ZEROED;
        static ONCE: bun_core::Once<Option<&'static ZStr>> = bun_core::Once::new();
        ONCE.call(|| {
            // SAFETY: single-writer (Once gate), process-lifetime storage,
            // CLI is single-threaded at this point.
            let buf = unsafe { &mut *::core::ptr::addr_of_mut!(SHELL_BUF) };
            let len = Self::find_shell_impl(path, cwd, buf)?;
            buf[len] = 0;
            // SAFETY: `buf[len] == 0` written above; SHELL_BUF is `'static`.
            Some(unsafe { ZStr::from_raw(buf.as_ptr(), len) })
        })
    }

    // Look for invocations of any:
    // - yarn run
    // - yarn $cmdName
    // - pnpm run
    // - npm run
    // Replace them with "bun run"
    pub fn replace_package_manager_run(
        copy_script: &mut Vec<u8>,
        script: &[u8],
    ) -> Result<(), bun_core::Error> {
        let mut entry_i: usize = 0;
        let mut delimiter: u8 = b' ';

        while entry_i < script.len() {
            let start = entry_i;

            match script[entry_i] {
                b'y' => {
                    if delimiter > 0 {
                        let remainder = &script[start..];
                        if remainder.starts_with(b"yarn ") {
                            let next = &remainder[b"yarn ".len()..];
                            // We have yarn
                            // Find the next space
                            if let Some(space) = strings::index_of_char(next, b' ') {
                                let yarn_cmd = &next[..space as usize];
                                if yarn_cmd == b"run" {
                                    copy_script.extend_from_slice(Self::BUN_RUN.as_bytes());
                                    entry_i += b"yarn run".len();
                                    continue;
                                }

                                // yarn npm is a yarn 2 subcommand
                                if yarn_cmd == b"npm" {
                                    entry_i += b"yarn npm ".len();
                                    copy_script.extend_from_slice(b"yarn npm ");
                                    continue;
                                }

                                if yarn_cmd.starts_with(b"-") {
                                    // Skip the rest of the command
                                    entry_i += b"yarn ".len() + yarn_cmd.len();
                                    copy_script.extend_from_slice(b"yarn ");
                                    copy_script.extend_from_slice(yarn_cmd);
                                    continue;
                                }

                                // implicit yarn commands
                                // TODO(b2-blocked): `crate::cli::list_of_yarn_commands`
                                // is ``-gated (duplicate phf_set! keys).
                                // Until it un-gates, fall through (don't rewrite the
                                // bare-subcommand form) so we never misclassify an
                                // actual yarn builtin as a script.
                                
                                if !crate::cli::list_of_yarn_commands::ALL_YARN_COMMANDS
                                    .contains(yarn_cmd)
                                {
                                    copy_script.extend_from_slice(Self::BUN_RUN.as_bytes());
                                    copy_script.push(b' ');
                                    copy_script.extend_from_slice(yarn_cmd);
                                    entry_i += b"yarn ".len() + yarn_cmd.len();
                                    delimiter = 0;
                                    continue;
                                }
                            }
                        }
                    }

                    delimiter = 0;
                }

                b' ' => delimiter = b' ',
                b'"' => delimiter = b'"',
                b'\'' => delimiter = b'\'',

                b'n' => {
                    if delimiter > 0 {
                        if script[start..].starts_with(b"npm run ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_RUN, " ").as_bytes(),
                            );
                            entry_i += b"npm run ".len();
                            delimiter = 0;
                            continue;
                        }

                        if script[start..].starts_with(b"npx ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_BIN_NAME, " x ").as_bytes(),
                            );
                            entry_i += b"npx ".len();
                            delimiter = 0;
                            continue;
                        }
                    }

                    delimiter = 0;
                }
                b'p' => {
                    if delimiter > 0 {
                        if script[start..].starts_with(b"pnpm run ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_RUN, " ").as_bytes(),
                            );
                            entry_i += b"pnpm run ".len();
                            delimiter = 0;
                            continue;
                        }
                        if script[start..].starts_with(b"pnpm dlx ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_BIN_NAME, " x ").as_bytes(),
                            );
                            entry_i += b"pnpm dlx ".len();
                            delimiter = 0;
                            continue;
                        }
                        if script[start..].starts_with(b"pnpx ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_BIN_NAME, " x ").as_bytes(),
                            );
                            entry_i += b"pnpx ".len();
                            delimiter = 0;
                            continue;
                        }
                    }

                    delimiter = 0;
                }
                _ => delimiter = 0,
            }

            copy_script.push(script[entry_i]);
            entry_i += 1;
        }
        Ok(())
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
        env.map.put(b"npm_lifecycle_event", name).expect("unreachable");
        env.map.put(b"npm_lifecycle_script", original_script).expect("unreachable");

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
            // PORT NOTE: `crate::shell::needs_escape_utf8_ascii_latin1` /
            // `escape_8bit` live in `shell_body.rs`, which is ``.
            // Until the shell-escape surface re-exports, use the inlined
            // byte-identical copies in `shell_escape_inline` so the live path
            // is never lossy (run_command.zig:233-239).
            if shell_escape_inline::needs_escape_utf8_ascii_latin1(part) {
                shell_escape_inline::escape_8bit(part, &mut copy_script, true);
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
            let mini = bun_event_loop::MiniEventLoop::init_global(
                Some(unsafe { &mut *(env as *mut _) }),
                Some(cwd),
            );
            // SAFETY: `init_global` returns the thread-local singleton as a raw
            // pointer (Zig `*MiniEventLoop`); reborrow `&'static mut` for the
            // duration of `init_and_run_from_source` — single-threaded mini loop,
            // no aliasing `&mut` exists across this call.
            let mini = unsafe { &mut *mini };
            let code = match crate::shell::Interpreter::init_and_run_from_source(
                ctx, mini, name, &copy_script, Some(cwd),
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

        use crate::api::bun_process::{sync, Status as SpawnStatus};

        let argv: Vec<Box<[u8]>> = vec![
            shell_bin.as_bytes().to_vec().into_boxed_slice(),
            if cfg!(windows) { b"/c".as_slice() } else { b"-c".as_slice() }
                .to_vec()
                .into_boxed_slice(),
            copy_script.clone().into_boxed_slice(),
        ];

        let ipc_fd: Option<bun_sys::Fd> = if !cfg!(windows) {
            bun_core::env_var::NODE_CHANNEL_FD.get().and_then(|s| {
                ::core::str::from_utf8(s).ok()?.parse::<u32>().ok().and_then(|fd| {
                    i32::try_from(fd).ok().map(bun_sys::Fd::from_native)
                })
            })
        } else {
            None // TODO: implement on Windows
        };

        // TODO: remember to free this when we add --filter or --concurrent
        // in the meantime we don't need to free it.
        let envp = env.map.create_null_delimited_env_map()?;

        let spawn_result = match sync::spawn(&sync::Options {
            argv,
            argv0: Some(shell_bin.as_ptr() as *const ::core::ffi::c_char),
            envp: Some(envp.as_ptr() as *const *const ::core::ffi::c_char),
            cwd: cwd.to_vec().into_boxed_slice(),
            stderr: sync::SyncStdio::Inherit,
            stdout: sync::SyncStdio::Inherit,
            stdin: sync::SyncStdio::Inherit,
            ipc: ipc_fd,
            #[cfg(windows)]
            windows: crate::api::bun_process::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init(
                    bun_event_loop::MiniEventLoop::init_global(
                        Some(unsafe { &mut *(env as *mut _) }),
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
                            bun_sys::SignalCode(sig as u8)
                                .fmt(Output::enable_ansi_colors_stderr()),
                        );
                        Output::flush();

                        if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() == Some(true) {
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
                if let Some(sig) = spawn_result.status.signal_code() {
                    if sig != bun_core::SignalCode::SIGINT && !silent {
                        pretty_errorln!(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> was terminated by signal {}<r>",
                            bstr::BStr::new(name),
                            bun_sys::SignalCode(sig as u8)
                                .fmt(Output::enable_ansi_colors_stderr()),
                        );
                        Output::flush();
                    }

                    if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() == Some(true) {
                        bun_crash_handler::suppress_reporting();
                    }

                    Global::raise_ignoring_panic_handler(sig);
                }
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
    /// top-level `DirInfo`, and seeds the `npm_*` env vars.
    ///
    /// Returns a raw `*mut DirInfo` borrowed from the resolver's directory
    /// cache (process-lifetime; Zig returned `*DirInfo`).
    pub fn configure_env_for_run(
        ctx: &mut ContextData,
        this_transpiler: &mut ::core::mem::MaybeUninit<Transpiler<'static>>,
        env: Option<*mut DotEnv::Loader<'static>>,
        log_errors: bool,
        store_root_fd: bool,
    ) -> Result<*mut DirInfo, bun_core::Error> {
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
        // SAFETY: `Transpiler::init` always sets `env` (singleton or leaked).
        let env_loader = unsafe { &mut *this_transpiler.env };
        env_loader.quiet = true;
        this_transpiler.options.env.prefix = Box::default();

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        this_transpiler.resolver.opts.load_tsconfig_json = true;
        this_transpiler.options.load_tsconfig_json = true;

        // TODO(b2-blocked): `Transpiler::configure_linker` lives in the gated
        // `__phase_a_draft` impl (transpiler.rs:1313).
        
        this_transpiler.configure_linker();

        // SAFETY: `Transpiler::init` always sets `fs` to the process singleton.
        let top_level_dir = unsafe { (*this_transpiler.fs).top_level_dir };
        let root_dir_info: *mut DirInfo =
            match this_transpiler.resolver.read_dir_info(top_level_dir) {
                Err(err) => {
                    if !log_errors {
                        return Err(bun_core::err!("CouldntReadCurrentDirectory"));
                    }
                    // TODO(b2): `Log::print` wants `fmt::Write`; route through
                    // `Output::error_writer()` once a shim lands. See
                    // `_boot_and_handle_error` for the same wart.
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>{}<r> loading directory {}",
                        bstr::BStr::new(err.name()),
                        bun_core::fmt::QuotedFormatter { text: top_level_dir },
                    );
                    Output::flush();
                    return Err(err);
                }
                Ok(None) => {
                    // TODO(b2): `ctx.log.print(Output.errorWriter())` — same
                    // writer-shim wart as the `Err` arm above; route the
                    // buffered resolver diagnostics once the shim lands.
                    pretty_errorln!("error loading current directory");
                    Output::flush();
                    return Err(bun_core::err!("CouldntReadCurrentDirectory"));
                }
                Ok(Some(info)) => info,
            };

        this_transpiler.resolver.store_fd = false;

        if env_is_none {
            // SAFETY: re-derive — borrowck won't let `env_loader` straddle the
            // `&mut this_transpiler.resolver` above. Scoped to this block so it
            // does NOT straddle `run_env_loader` below (which itself derives
            // `&mut *self.env`, popping any outstanding `&mut Loader` tag).
            let env_loader = unsafe { &mut *this_transpiler.env };
            env_loader.load_process()?;

            if let Some(node_env) = env_loader.get(b"NODE_ENV") {
                if node_env == b"production" {
                    this_transpiler.options.production = true;
                }
            }

            // Always skip default .env files for package.json script runner
            // (see comment in env_loader.zig:542-548 - the script's own bun instance loads .env)
            // TODO(b2-blocked): `Transpiler::run_env_loader` is in the gated
            // `__phase_a_draft` impl (transpiler.rs:1317).

            let _ = this_transpiler.run_env_loader(true);
        }

        // SAFETY: re-derive after `run_env_loader` — that call creates its own
        // `&mut *self.env` (transpiler.rs:282), which under Stacked Borrows
        // invalidates any `&mut Loader` derived before it. Zig spec
        // run_command.zig:820-823 re-dereferences `this_transpiler.env`
        // per-statement; mirror that by taking a fresh borrow here for the
        // remaining env-var seeding.
        let env_loader = unsafe { &mut *this_transpiler.env };

        env_loader.map.put_default(b"npm_config_local_prefix", top_level_dir).expect("unreachable");

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_aio::ParentDeathWatchdog::is_enabled() {
            env_loader.map.put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1").expect("unreachable");
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

        // SAFETY: `read_dir_info` returned `Some(ptr)`; entry lives in the
        // resolver's `DirInfoCache` for the process lifetime.
        let root_dir = unsafe { &*root_dir_info };
        if let Some(package_json) = root_dir.enclosing_package_json {
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
                    let key = strings::concat(&[b"npm_package_config_", &k[..]])?;
                    // PERF(port): was assume_capacity
                    env_loader.map.put_assume_capacity(&key, *v);
                }
            }
        }

        Ok(root_dir_info)
    }

    /// Best-effort default-loader lookup by file extension. Mirrors
    /// `options.defaultLoaders.get(ext)` (the *file-extension*→Loader map at
    /// options.zig:1041 — NOT `Loader::NAMES`, which is the *loader-name*
    /// table and has different membership, e.g. `.sh` is unconditional there
    /// but Windows-only in `defaultLoaders`). Routed through the lower-tier
    /// `BundleEnums::Loader` so this file does not name `bun_bundler`'s
    /// (duplicate, soon-to-collapse) `options::Loader`.
    #[inline]
    fn default_loader_for(target: &[u8]) -> Option<Loader> {
        let ext = paths::extension(target);
        // Keyed with the leading dot, exactly as in options.zig `defaultLoaders`.
        match ext {
            b".jsx" => Some(Loader::Jsx),
            b".json" => Some(Loader::Json),
            b".js" => Some(Loader::Jsx),
            b".mjs" => Some(Loader::Js),
            b".cjs" => Some(Loader::Js),
            b".css" => Some(Loader::Css),
            b".ts" => Some(Loader::Ts),
            b".tsx" => Some(Loader::Tsx),
            b".mts" => Some(Loader::Ts),
            b".cts" => Some(Loader::Ts),
            b".toml" => Some(Loader::Toml),
            b".yaml" => Some(Loader::Yaml),
            b".yml" => Some(Loader::Yaml),
            b".wasm" => Some(Loader::Wasm),
            b".node" => Some(Loader::Napi),
            b".txt" => Some(Loader::Text),
            b".text" => Some(Loader::Text),
            b".html" => Some(Loader::Html),
            b".jsonc" => Some(Loader::Jsonc),
            b".json5" => Some(Loader::Json5),
            b".md" => Some(Loader::Md),
            b".markdown" => Some(Loader::Md),
            #[cfg(windows)]
            b".sh" => Some(Loader::Bunsh),
            _ => None,
        }
    }

    /// Port of `bun_js.Run.boot` — `VirtualMachine::init`, hand off CLI
    /// state, then enter `Run::start` under the JSC API lock. The full
    /// transpiler option mapping (`install`/`global_cache`/`minify`/macros/
    /// `serve_plugins` — `Run.boot` in src/bun.js.rs lines 110-170) stays
    /// gated on `vm.transpiler` being populated by `init_runtime_state`.
    pub(crate) fn boot(
        ctx: &mut ContextData,
        entry_path: Box<[u8]>,
        loader: Option<Loader>,
    ) -> Result<(), bun_core::Error> {
        let _ = loader;
        // PORT NOTE: `jsc::initialize(false)` + `Expr/Stmt::Store::create()` +
        // `MimallocArena::init()` precede VM init in Zig. `bun_jsc::initialize`
        // is now real (calls `JSCInitialize` over `bun_sys::environ()`); the
        // dispatch hooks (`jsc_hooks::install_jsc_hooks`) are installed by
        // `main.rs` before `Cli::start`, so `VirtualMachine::init` already sees
        // a populated `RuntimeHooks` table.
        // TODO(b2-blocked): `bun_jsc::initialize(false)` once un-gated.
        // TODO(b2-blocked): `js_ast::{Expr,Stmt}::Data::Store::create()` once
        // `bun_js_parser` exposes the store ctors at this tier.

        let vm_ptr = VirtualMachine::init(VmInitOptions {
            smol: ctx.runtime_options.smol,
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
        vm.is_main_thread = true;
        bun_jsc::virtual_machine::IS_MAIN_THREAD_VM.with(|c| c.set(true));
        // TODO(port): `VirtualMachine::main` is still `&'static [u8]`; it should
        // be `Box<[u8]>` so ownership transfers (PORTING.md §Forbidden patterns).
        // Until that field is retyped (out of this file's scope), park the bytes
        // in the process-lifetime `runner_arena()` instead of `Box::leak`
        // (PORTING.md §Forbidden bars per-call `Box::leak`). The arena is never
        // reset and the process exits via `globalExit`/`exit(1)`, matching Zig's
        // `allocator.dupe` + no-free.
        let entry_path: &'static [u8] = runner_arena().alloc_slice_copy(&entry_path);
        vm.main = entry_path;

        // TODO(b2-blocked): full transpiler/resolver option mapping
        // (`Run.boot` in src/bun.js.rs lines 110-170 — install/global_cache/
        // minify/macros/serve_plugins) — needs `vm.transpiler` populated by
        // `init_runtime_state`, which is still a no-op for those fields.
        
        {
            let b = &mut vm.transpiler;
            // PORT NOTE: `Transpiler<'static>` requires a `'static` borrow but
            // `ctx` is `&'_ mut ContextData`. The `BunInstall` box is process-
            // lifetime in practice (CLI parse-once, never freed — Zig stored
            // the raw pointer); erase the borrow lifetime via raw-pointer
            // round-trip per PORTING.md §process-lifetime borrows.
            b.options.install = ctx
                .install
                .as_deref()
                .map(|p| unsafe { &*(p as *const api::BunInstall) });
            b.resolver.opts.global_cache = ctx.debug.global_cache;
            // … see phase_a_draft / src/bun.js.rs for the full list.
        }

        // ── enter `Run::start` under the JSC API lock ──────────────────────
        // Zig: `vm.global.vm().holdAPILock(&run, OpaqueWrap(Run, Run.start))`.
        // SAFETY: `RUN` is the process-global singleton (Zig: `var run: Run`);
        // written exactly once here on the main thread before the API-lock
        // trampoline reads it, never freed (`global_exit` ends the process).
        unsafe {
            (&raw mut RUN).write(Run {
                vm: vm_ptr,
                entry_path,
                eval_and_print: ctx.runtime_options.eval.eval_and_print,
            });
        }
        // PORT NOTE: `ctx.debug.hot_reload` → `vm.hot_reload` (a `u8` until the
        // b2-cycle widens it to `cli::HotReload`); the watcher run-loop arm in
        // `Run::start` keys off `vm.is_watcher_enabled()` instead.
        vm.hot_reload = ctx.debug.hot_reload as u8;

        extern "C" fn trampoline(ctx: *mut c_void) {
            // SAFETY: `ctx` is `&mut RUN` passed through `holdAPILock`'s
            // opaque slot; the API lock is held for the full call so no
            // other thread touches the VM.
            let this = unsafe { &mut *(ctx as *mut Run) };
            this.start();
        }
        // SAFETY: `vm.global` set in `init`; `vm()` borrows the JSC VM for
        // the API-lock FFI call. `&raw mut RUN` yields a stable raw pointer
        // to the static.
        #[allow(deprecated)]
        vm.global().vm().hold_api_lock(
            (&raw mut RUN) as *mut c_void,
            trampoline,
        );

        // `Run::start` never returns (ends in `global_exit`); this is dead
        // code kept so the type unifies with the `?`-early-return above.
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `Run` — port of `src/bun.js.zig` `Run::start`. Lives here (not the
// higher-tier `bun.js.rs`) so the CLI dispatch path can drive the event
// loop without a crate-cycle.
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct Run {
    vm: *mut VirtualMachine,
    entry_path: &'static [u8],
    /// Snapshot of `ctx.runtime_options.eval.eval_and_print` (the full
    /// `Command::Context` is not stored — its only consumers in `start()`
    /// beyond this flag are gated b2 features).
    eval_and_print: bool,
}

// Zig: `var run: Run = undefined;` — process-global, written once in `boot`.
static mut RUN: Run = Run {
    vm: ::core::ptr::null_mut(),
    entry_path: b"",
    eval_and_print: false,
};

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

    /// Inlined `VirtualMachine.onBeforeExit` (gated upstream): dispatch
    /// `process.on('beforeExit')`, then re-run the loop if the listener
    /// scheduled new work, re-dispatching until quiescent.
    fn on_before_exit(vm: &mut VirtualMachine) {
        // PORT NOTE: `ExitHandler::dispatch_on_before_exit` takes the raw VM
        // pointer (not `&mut self`) because the FFI it calls re-enters
        // `VirtualMachine::get()` — see `ExitHandler::dispatch_on_exit` doc.
        let vm_ptr = vm as *mut VirtualMachine;
        // SAFETY: `vm_ptr` is the live per-thread VM (we just took its address).
        unsafe { ExitHandler::dispatch_on_before_exit(vm_ptr) };
        let mut dispatch = false;
        loop {
            while vm.is_event_loop_alive() {
                vm.tick();
                // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
                // accessed here (no live `&mut EventLoop` overlaps).
                vm.auto_tick_active();
                dispatch = true;
            }
            if dispatch {
                // SAFETY: `vm_ptr` is the live per-thread VM.
                unsafe { ExitHandler::dispatch_on_before_exit(vm_ptr) };
                dispatch = false;
                if vm.is_event_loop_alive() {
                    continue;
                }
            }
            break;
        }
    }

    /// Inlined `VirtualMachine.onExit` (gated upstream): dispatch
    /// `process.on('exit')`, mark shutting-down, then run NAPI cleanup hooks.
    fn on_exit(vm: &mut VirtualMachine) {
        // TODO(b2-blocked): `cpu_profiler_config` / `heap_profiler_config`
        // stop-and-write — `CPUProfiler`/`HeapProfiler` are gated siblings.
        // PORT NOTE: see `on_before_exit` re: raw-ptr signature.
        // SAFETY: `vm` is the live per-thread VM (we just took its address).
        unsafe { ExitHandler::dispatch_on_exit(vm as *mut VirtualMachine) };
        vm.is_shutting_down = true;

        // Make sure we run new cleanup hooks introduced by running cleanup hooks.
        // PORT NOTE: re-derive `rare_data` each outer iteration and drop the
        // `&mut` before `hook.execute()` — a NAPI cleanup hook may re-enter via
        // `napi_add_env_cleanup_hook` → `RareData::push_cleanup_hook`, which
        // takes a fresh `&mut RareData`; holding the outer borrow across that
        // call would alias under Stacked Borrows.
        loop {
            let hooks = match vm.rare_data.as_mut() {
                Some(r) if !r.cleanup_hooks.is_empty() => std::mem::take(&mut r.cleanup_hooks),
                _ => break,
            };
            for hook in hooks {
                hook.execute();
            }
        }
    }

    /// Inlined `VirtualMachine.globalExit` (gated upstream).
    fn global_exit(vm: &mut VirtualMachine) -> ! {
        debug_assert!(vm.is_shutting_down);
        // TODO(b2-blocked): `shouldDestructMainThreadOnExit()` teardown path
        // (worker drain, socket-group close, `Zig__GlobalObject__destructOnExit`,
        // transpiler/gc_controller deinit) — every callee is gated. The
        // non-destructing fast path is just `exit(code)`.
        Global::exit(vm.exit_handler.exit_code as u32);
    }

    /// `Run.start` — load the entry point, run the event loop until idle,
    /// fire `beforeExit`/`exit`, then `globalExit`. Called under the JSC API
    /// lock via `hold_api_lock`.
    #[allow(unused_assignments)] // `printed_…` writes before `global_exit` are intentional Zig-shape.
    fn start(&mut self) -> ! {
        // PORT NOTE: deref the raw VM pointer once instead of going through a
        // `&mut self` accessor so `self.{any_unhandled,entry_path,…}` stay
        // borrowable alongside `vm` for the rest of this body.
        // SAFETY: `self.vm` is the boxed-and-leaked main-thread VM; valid for
        // process lifetime once `boot` writes it.
        let vm = unsafe { &mut *self.vm };
        vm.on_unhandled_rejection = Run::on_unhandled_rejection_before_close;

        // TODO(b2-blocked): CPU/heap profiler start, `addConditionalGlobals`,
        // redis/sql preconnect, hot-reloader enable — see `src/bun.js.rs`
        // `Run::start` lines 414-535. All depend on gated `bun_runtime`
        // siblings (`CPUProfiler`, `valkey`, `hot_reloader::enable_*`).

        // Zig: `if entry_path == "." { entry_path = fs.top_level_dir }` —
        // `vm.transpiler.fs` is a b2-cycle placeholder; skip the rewrite.

        let mut printed_sourcemap_warning_and_version = false;

        match vm.load_entry_point(self.entry_path) {
            Ok(promise) => {
                // SAFETY: `promise` is a live GC cell returned by the module loader.
                let promise = unsafe { &mut *promise };
                if promise.status() == PromiseStatus::Rejected {
                    // SAFETY: `vm.jsc_vm` set in `init`; FFI takes `*mut`.
                    let result = promise.result(unsafe { &mut *vm.jsc_vm });
                    // TODO(b2-blocked): `vm.uncaught_exception(global, result, true)`
                    // — gated. Route through the unhandled-rejection printer
                    // instead so the error still surfaces.
                    let global = vm.global;
                    // SAFETY: `global` valid for VM lifetime.
                    (vm.on_unhandled_rejection)(vm, unsafe { &*global }, result);
                    promise.set_handled();
                    vm.pending_internal_promise_reported_at = vm.hot_reload_counter;

                    // Spec bun.js.zig:407 gates on `vm.hot_reload != .none or handled`;
                    // `is_watcher_enabled()` reads `bun_watcher`, which is only set
                    // by the (gated) `enableHotModuleReloading`. Key off `hot_reload`
                    // directly so `--hot`/`--watch` keep the process alive on a
                    // rejected entry point regardless of watcher wiring.
                    // TODO(b2-blocked): `or handled` — needs `vm.uncaught_exception`
                    // un-gated to thread the bool back here.
                    if vm.hot_reload != 0 {
                        // TODO(b2-blocked): `add_main_to_watcher_if_needed()` — gated.
                        // SAFETY: `event_loop` is a self-pointer into this VM;
                        // uniquely accessed here.
                        unsafe { (*vm.event_loop()).tick() };
                        // SAFETY: as above — `event_loop` is a self-pointer into
                        // this VM; uniquely accessed here.
                        unsafe { (*vm.event_loop()).tick_possibly_forever() };
                    } else {
                        vm.exit_handler.exit_code = 1;
                        Run::on_exit(vm);
                        if ANY_UNHANDLED.load(Ordering::Relaxed) {
                            printed_sourcemap_warning_and_version = true;
                            // TODO(b2-blocked): `SavedSourceMap::MissingSourceMapNoteInfo::print()`
                            // — real impl lives in the gated `SavedSourceMap.rs`.
                            pretty_errorln!(
                                "<r>\n<d>{}<r>",
                                Global::unhandled_error_bun_version_string,
                            );
                        }
                        Run::global_exit(vm);
                    }
                }

                // SAFETY: `vm.jsc_vm` set in `init`.
                let _ = promise.result(unsafe { &mut *vm.jsc_vm });

                if log_has_msgs(vm) {
                    dump_build_error(vm);
                    log_clear_msgs(vm);
                }
            }
            Err(err) => {
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
                vm.exit_handler.exit_code = 1;
                Run::on_exit(vm);
                if ANY_UNHANDLED.load(Ordering::Relaxed) {
                    printed_sourcemap_warning_and_version = true;
                    pretty_errorln!(
                        "<r>\n<d>{}<r>",
                        Global::unhandled_error_bun_version_string,
                    );
                }
                Run::global_exit(vm);
            }
        }

        // don't run the GC if we don't actually need to
        // SAFETY: `event_loop` is a self-pointer into this VM; uniquely accessed.
        if vm.is_event_loop_alive() || unsafe { (*vm.event_loop()).tick_concurrent_with_count() } > 0 {
            vm.global().vm().release_weak_refs();
            // TODO(b2-blocked): `vm.arena.gc()` — `bun_alloc::Arena::gc` not yet
            // wired through the `Option<NonNull<Arena>>` field.
            let _ = vm.global().vm().run_gc(false);
            vm.tick();
        }

        // TODO(b2-blocked): `StandaloneModuleGraph::hint_source_pages_dont_need()`
        // — `bun_standalone_module_graph` not in this crate's dep set.

        // ── core run-loop ──────────────────────────────────────────────────
        if vm.is_watcher_enabled() {
            // TODO(b2-blocked): `report_exception_in_hot_reloaded_module_if_needed`
            // — gated upstream. The watcher arm otherwise matches the
            // non-watcher arm with `tick_possibly_forever` keeping the
            // process alive across reloads.
            loop {
                while vm.is_event_loop_alive() {
                    vm.tick();
                    // SAFETY: `event_loop` is a self-pointer into this VM;
                    // uniquely accessed here.
                    vm.auto_tick_active();
                }
                Run::on_before_exit(vm);
                // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
                // accessed here. Watcher arm keeps the process alive across
                // reloads (run_command.zig `start` watcher loop).
                unsafe { (*vm.event_loop()).tick_possibly_forever() };
            }
        } else {
            while vm.is_event_loop_alive() {
                vm.tick();
                // SAFETY: `event_loop` is a self-pointer into this VM;
                // uniquely accessed here.
                vm.auto_tick_active();
            }

            if self.eval_and_print {
                // TODO(b2-blocked): `bun -p` result printing —
                // `JSValue::then2`/`print` + `Bun__on{Resolve,Reject}EntryPointResult`
                // are not yet at this tier. See `src/bun.js.rs` lines 652-685.
            }

            Run::on_before_exit(vm);
        }

        if log_has_msgs(vm) {
            dump_build_error(vm);
            Output::flush();
        }

        vm.on_unhandled_rejection = Run::on_unhandled_rejection_before_close;
        vm.global().handle_rejected_promises();
        Run::on_exit(vm);

        if ANY_UNHANDLED.load(Ordering::Relaxed) && !printed_sourcemap_warning_and_version {
            vm.exit_handler.exit_code = 1;
            // TODO(b2-blocked): `SavedSourceMap::MissingSourceMapNoteInfo::print()`.
            pretty_errorln!(
                "<r>\n<d>{}<r>",
                Global::unhandled_error_bun_version_string,
            );
        }

        // PORT NOTE: `fixDeadCodeElimination()` calls dropped — Rust does not
        // DCE `#[no_mangle] extern "C"` symbols the way Zig does, so the
        // anti-DCE shims are unnecessary here.
        Run::global_exit(vm);
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
fn dump_build_error(vm: &mut VirtualMachine) {
    Output::flush();
    if let Some(log) = vm.log {
        // SAFETY: `vm.log` set in `init`; single-threaded CLI.
        let log = unsafe { &mut *log.as_ptr() };
        // TODO(b2): route through `Output::error_writer_buffered()` once a
        // `fmt::Write` adapter exists; buffer-then-dump for now.
        let mut buf = String::new();
        let _ = log.print(&mut buf);
        bun_core::pretty_error!("{}", buf);
    }
    Output::flush();
}

impl RunCommand {
    /// `_bootAndHandleError` — duplicate `path` to a process-lifetime buffer,
    /// boot the VM, and on failure print the formatted error + `exit(1)`.
    fn _boot_and_handle_error(
        ctx: &mut ContextData,
        path: &[u8],
        loader: Option<Loader>,
    ) -> bool {
        // TODO(b2-blocked): `Loader::Md` → `render_markdown_file_and_exit`
        // (needs bun_md + bun_http remote-image prefetch). See phase_a_draft.
        
        if matches!(
            loader.or_else(|| Self::default_loader_for(path)),
            Some(Loader::Md)
        ) {
            // PORT NOTE: real impl lives in `phase_a_draft::render_markdown_file_and_exit`;
            // blocked on `bun_md` + remote-image prefetch landing in this tier.
            let _ = path;
            todo!("blocked_on: RunCommand::render_markdown_file_and_exit");
        }

        Global::configure_allocator(core::Global::AllocatorConfiguration {
            long_running: true,
            ..Default::default()
        });

        // `entry_path` must outlive the VM (it's stored in `vm.main`); pass an
        // owned copy by value (Zig: `ctx.allocator.dupe(u8, path)`).
        let owned: Box<[u8]> = path.to_vec().into_boxed_slice();

        if let Err(err) = Self::boot(ctx, owned, loader) {
            // SAFETY: `ctx.log` was set in `create_context_data` (single-threaded
            // CLI startup) and is process-lifetime.
            
            // PORT NOTE: `Log::print` is generic over `IntoLogWrite`, which is
            // implemented for `*mut io::Writer` (not `&mut`). `error_writer()`
            // returns `&'static mut io::Writer`; cast to the raw pointer the
            // trait expects.
            let _ = unsafe { ctx.log() }.print(Output::error_writer() as *mut bun_core::io::Writer);

            pretty_errorln!(
                "<r><red>error<r>: Failed to run <b>{}<r> due to error <b>{}<r>",
                bstr::BStr::new(paths::basename(path)),
                bstr::BStr::new(err.name()),
            );
            Global::exit(1);
        }
        true
    }

    /// Port of `configurePATHForRun` (run_command.zig). Prepends workspace
    /// `.bin` dirs + `BUN_WHICH_IGNORE_CWD` to `PATH` and writes the original
    /// PATH back through `original_path`.
    ///
    /// Real body lives in `phase_a_draft::configure_path_for_run` (depends on
    /// `configure_path_for_run_with_package_json_dir`, still draft-only).
    #[allow(unused_variables)]
    pub fn configure_path_for_run(
        ctx: &mut ContextData,
        root_dir_info: *mut DirInfo,
        this_transpiler: &mut Transpiler<'static>,
        original_path: Option<&mut &[u8]>,
        cwd: &[u8],
        force_using_bun: bool,
    ) -> Result<(), bun_core::Error> {
        todo!("blocked_on: RunCommand::configure_path_for_run (phase_a_draft)")
    }

    /// Dispatch `bun run <target>`: classify as file path vs. package.json
    /// script, then either boot the VM or spawn the script.
    ///
    /// Legacy two-arg form preserved for `Command::start`; callers wanting
    /// the full `ExecCfg` go through `exec_with_cfg`.
    pub fn exec(ctx: &mut ContextData, bin_dirs_only: bool) -> Result<bool, bun_core::Error> {
        Self::exec_with_cfg(
            ctx,
            ExecCfg { bin_dirs_only, log_errors: true, allow_fast_run_for_extensions: true },
        )
    }

    pub fn exec_with_cfg(ctx: &mut ContextData, cfg: ExecCfg) -> Result<bool, bun_core::Error> {
        let _bin_dirs_only = cfg.bin_dirs_only;
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
            let _ = arguments::load_config_path(CommandTag::RunCommand, true, bun_core::zstr!("bunfig.toml"), ctx);
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
        let mut this_transpiler =
            ::core::mem::MaybeUninit::<Transpiler<'static>>::uninit();
        let root_dir_info = Self::configure_env_for_run(
            ctx,
            &mut this_transpiler,
            None,
            log_errors,
            false,
        )?;
        // SAFETY: `configure_env_for_run` returned `Ok`, so the slot is
        // fully initialized via `MaybeUninit::write`.
        let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
        let force_using_bun = ctx.debug.run_in_bun;
        let mut original_path: &[u8] = b"";
        Self::configure_path_for_run(
            ctx,
            root_dir_info,
            this_transpiler,
            Some(&mut original_path),
            unsafe { (*root_dir_info).abs_path },
            force_using_bun,
        )?;
        // SAFETY: `Transpiler::init` always sets `env`.
        let env_loader: &mut DotEnv::Loader<'static> = unsafe { &mut *this_transpiler.env };
        env_loader.map.put(b"npm_command", b"run-script").expect("unreachable");

        // SAFETY: `read_dir_info` returned non-null; resolver-cache lifetime.
        let root_dir = unsafe { &*root_dir_info };

        // ── empty command → print help ──────────────────────────────────────
        if target_name.is_empty() {
            if root_dir.enclosing_package_json.is_some() {
                // TODO(port): pass `package_json` once `print_help` takes
                // `Option<&PackageJSON>` (script-listing section).
                Self::print_help(Some(&()));
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

                        let package_json_dir = strings::without_trailing_slash(
                            strings::without_suffix_comptime(
                                package_json.source.path.text,
                                b"package.json",
                            ),
                        );
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

        // ── module resolution fallback ──────────────────────────────────────
        // TODO(b2-blocked): `this_transpiler.resolver.resolve(top_level_dir,
        // target_name, EntryPointRun)` — needs Transpiler + bun_resolver wired
        // via `configure_env_for_run`. Until then, attempt the on-disk
        // `./target_name` path directly (covers `bun run script.ts`).
        if Self::maybe_open_with_bun_js(ctx, target_name) {
            return Ok(true);
        }

        // ── node_modules/.bin / system $PATH fallback ───────────────────────
        // Zig: run_command.zig:1890-1912 — search the prepended `.bin` dirs
        // (PATH minus ORIGINAL_PATH) unless `--bun` was passed, in which case
        // search the whole stitched PATH.
        // TODO(b2-blocked): Windows `BunXFastPath::try_launch` precedes this
        // in the .zig spec; preserved in phase_a_draft.
        {
            // SAFETY: `Transpiler::init` always sets `fs`; resolver-cache lifetime.
            let fs = unsafe { &mut *this_transpiler.fs };
            let top_level_dir = fs.top_level_dir;
            let path = env_loader.get(b"PATH").unwrap_or(b"");
            let mut path_for_which = path;
            if !force_using_bun {
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
                    let _stored = fs.dirname_store.append_slice(out)?;
                    let _ = (top_level_dir, target_name);
                    // TODO(b2-blocked): `run_binary_without_bunx_path` lives in
                    // `phase_a_draft` only (needs `bun_core::spawn_sync` wiring).
                    // Once ported to the active `impl RunCommand`:
                    //   Self::run_binary_without_bunx_path(
                    //       ctx, stored, destination.as_ptr() as *const c_char,
                    //       top_level_dir, env_loader, &passthrough,
                    //       Some(target_name),
                    //   )?;
                    todo!("blocked_on: RunCommand::run_binary_without_bunx_path");
                }
            }
        }

        // ── failure ─────────────────────────────────────────────────────────
        if ctx.runtime_options.if_present {
            return Ok(true);
        }

        // TODO(b2-blocked): `bun feedback` — when `ctx.filters.is_empty() &&
        // !ctx.workspaces && Cli::cmd() == AutoCommand && target_name ==
        // b"feedback"`, dispatch to `Self::bun_feedback(ctx)` (run_command.zig
        // :1921-1925). Blocked on `cli::Cli::cmd()` being available in this
        // tier; the impl is preserved in `phase_a_draft::bun_feedback`.

        if log_errors {
            let default_loader = Self::default_loader_for(target_name);
            if default_loader.map(Loader::is_javascript_like_or_json).unwrap_or(false)
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
            // TODO(port): `PosixToWinNormalizer.resolveCWD` + Windows
            // `normalizeString` — Phase B once those land at this tier.
            if target.len() >= MAX_PATH_BYTES {
                return false;
            }
            script_name_buf[..target.len()].copy_from_slice(target);
            target.len()
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
            // SAFETY: bun_paths::PathBuffer and bun_core::PathBuffer are
            // layout-identical newtypes over [u8; MAX_PATH_BYTES].
            let Ok(cwd) = bun_core::getcwd(unsafe {
                &mut *(::core::ptr::addr_of_mut!(cwd_buf) as *mut bun_core::PathBuffer)
            }) else { return false };
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
        let open_z = unsafe { bun_core::ZStr::from_raw(script_name_buf.as_ptr(), open_len) };

        // Open read-only. `catch return false` in Zig.
        let Ok(fd) = bun_sys::open(open_z, bun_sys::O::RDONLY, 0) else {
            return false;
        };
        // TODO(port): `.makeLibUVOwnedForSyscall(.open, .close_on_fail)` —
        // Windows-only fd-ownership shim; no-op on POSIX.

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
        // SAFETY: bun_paths::PathBuffer and bun_core::PathBuffer are layout-identical.
        let cwd = bun_core::getcwd(unsafe {
            &mut *(::core::ptr::addr_of_mut!(cwd_buf) as *mut bun_core::PathBuffer)
        })?;
        let cwd_bytes = cwd.as_bytes();
        let cwd_len = cwd_bytes.len();
        entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
        entry_point_buf[cwd_len..cwd_len + STDIN_TRIGGER.len()].copy_from_slice(STDIN_TRIGGER);
        let entry_path = &entry_point_buf[..cwd_len + STDIN_TRIGGER.len()];

        // Zig: prepend "-" to `ctx.passthrough` so `process.argv[1]` matches
        // Node's `node -` semantics.
        let mut passthrough_list: Vec<Box<[u8]>> =
            Vec::with_capacity(ctx.passthrough.len() + 1);
        passthrough_list.push(b"-".to_vec().into_boxed_slice());
        passthrough_list.append(&mut ctx.passthrough);
        ctx.passthrough = passthrough_list;

        // `Run.boot(ctx, dupe(entry_path), null) catch |err| { … exit(1) }`
        Ok(Self::_boot_and_handle_error(ctx, entry_path, None))
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
        // SAFETY: bun_paths::PathBuffer and bun_core::PathBuffer are layout-identical.
        let cwd = bun_core::getcwd(unsafe {
            &mut *(::core::ptr::addr_of_mut!(cwd_buf) as *mut bun_core::PathBuffer)
        })?;
        let cwd_bytes = cwd.as_bytes();
        let cwd_len = cwd_bytes.len();
        entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
        entry_point_buf[cwd_len..cwd_len + EVAL_TRIGGER.len()].copy_from_slice(EVAL_TRIGGER);
        let entry: Box<[u8]> =
            entry_point_buf[..cwd_len + EVAL_TRIGGER.len()].to_vec().into_boxed_slice();
        Self::boot(ctx, entry, None)
    }

    /// `node` argv0 emulation. Port of `execAsIfNode`.
    pub fn exec_as_if_node(ctx: &mut ContextData) -> Result<(), bun_core::Error> {
        // SAFETY: single-threaded CLI startup; `PRETEND_TO_BE_NODE` is set in
        // `Command::which()` before dispatch.
        debug_assert!(unsafe { crate::cli::PRETEND_TO_BE_NODE });

        if !ctx.runtime_options.eval.script.is_empty() {
            // synthetic `[eval]` path under cwd
            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + EVAL_TRIGGER.len()];
            let mut cwd_buf = PathBuffer::uninit();
            // SAFETY: bun_paths::PathBuffer and bun_core::PathBuffer are layout-identical.
            let cwd = bun_core::getcwd(unsafe {
                &mut *(::core::ptr::addr_of_mut!(cwd_buf) as *mut bun_core::PathBuffer)
            })?;
            let cwd_bytes = cwd.as_bytes();
            let cwd_len = cwd_bytes.len();
            entry_point_buf[..cwd_len].copy_from_slice(cwd_bytes);
            entry_point_buf[cwd_len..cwd_len + EVAL_TRIGGER.len()].copy_from_slice(EVAL_TRIGGER);
            let entry: Box<[u8]> =
                entry_point_buf[..cwd_len + EVAL_TRIGGER.len()].to_vec().into_boxed_slice();
            return Self::boot(ctx, entry, None);
        }

        if ctx.positionals.is_empty() {
            pretty_errorln!(
                "<r><red>error<r>: Missing script to execute. Bun's provided 'node' cli wrapper does not support a repl."
            );
            Global::exit(1);
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
            // SAFETY: bun_paths::PathBuffer and bun_core::PathBuffer are layout-identical.
            let cwd = bun_core::getcwd(unsafe {
                &mut *(::core::ptr::addr_of_mut!(cwd_buf) as *mut bun_core::PathBuffer)
            })?;
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
            // TODO(b2): `Log::print` wants `&mut impl fmt::Write`;
            // `Output::error_writer()` is `*mut io::Writer`. Route through a
            // shim once io::Writer implements fmt::Write.
            
            let _ = unsafe { ctx.log() }.print(Output::error_writer() as *mut bun_core::io::Writer);

            Output::err(
                err,
                "Failed to run script \"<b>{}<r>\"",
                (bstr::BStr::new(&basename),),
            );
            Global::exit(1);
        }
        Ok(())
    }
}

// Zig: `bun.pathLiteral("/[eval]")` — `pathLiteral` swaps `/` → platform SEP
// at comptime. Only the leading separator matters here.
#[cfg(windows)]
const EVAL_TRIGGER: &[u8] = b"\\[eval]";
#[cfg(not(windows))]
const EVAL_TRIGGER: &[u8] = b"/[eval]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter { Script, Bin, BunJs, All, AllPlusBunJs, ScriptExclude, ScriptAndDescriptions }

// ─────────────────────────────────────────────────────────────────────────────
// Phase-A draft preserved verbatim. Re-gate lifted once bun_jsc / transpiler /
// resolver siblings are green.
// ─────────────────────────────────────────────────────────────────────────────

mod phase_a_draft {
use ::core::ffi::{c_char, CStr};
use std::cell::RefCell;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_bundler::options as options;
use bun_bundler::Transpiler;
use crate::cli::{self as cli, Arguments, Command};
use bun_collections::{ArrayHashMap, StringHashMap};
use bun_core::{self as core, env_var, fmt as bun_fmt, Environment, Global, Output};
use bun_core::{note, pretty_errorln};
use bun_dotenv as DotEnv;
use bun_http as http;
use bun_jsc as jsc;
// TODO(b2-blocked): `bun_md` is a workspace crate but not yet a dep of
// `bun_runtime`. The markdown render path is preserved verbatim below; once
// `bun_md` is wired into `runtime/Cargo.toml` swap this stub back to
// `use bun_md as md;`.
mod md {
    pub use super::md_stub::*;
}
use bun_paths::{self as resolve_path, PathBuffer, WPathBuffer, DELIMITER, MAX_PATH_BYTES, SEP};
use bun_resolver::dir_info::DirInfo;
use bun_resolver::package_json::PackageJSON;
use bun_options_types::schema::api;
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_threading::Channel;
use bun_which::which;

use crate::cli::list_of_yarn_commands as yarn_commands;
use crate::shell_completions::ShellCompletions;

/// Stand-in for the higher-tier `bun.js` `Run` entry points (mirrors the shim
/// in `cli_body.rs`). The real implementation lives in a crate that depends on
/// `bun_runtime`; this keeps the Phase-A draft compiling until dispatch is
/// rewired through `super::Run::boot`.
mod bun_bun_js {
    #[allow(non_snake_case)]
    pub mod Run {
        pub fn boot(
            _ctx: impl ::core::any::Any,
            _entry: impl ::core::any::Any,
            _loader: Option<bun_bundler::options::Loader>,
        ) -> Result<(), bun_core::Error> {
            todo!("blocked_on: bun_js::Run::boot (higher-tier crate)")
        }
    }
}

/// Port of `bun.pathLiteral` — returns the literal as-is on POSIX, with
/// `/` rewritten to `\` on Windows. Local because `bun_paths` does not (yet)
/// export a macro form; see `src/bun.rs` for the eventual shared definition.
macro_rules! path_literal {
    ($posix:literal, $win:literal) => {{
        #[cfg(windows)]
        { $win }
        #[cfg(not(windows))]
        { $posix }
    }};
}

// TODO(b2-blocked): `bun_md` shim — keeps the markdown render path compiling
// until `bun_md` is added to `runtime/Cargo.toml`. Swap for `use bun_md as md;`
// once the dep edge lands.
pub(super) mod md_stub {
    #[derive(Clone, Copy)]
    pub struct Options;
    impl Options { pub const TERMINAL: Self = Self; }
    pub struct ImageUrlCollector;
    impl ImageUrlCollector {
        pub fn init() -> Self { Self }
        pub fn renderer(&mut self) -> &mut Self { self }
        pub fn urls(&self) -> &[&[u8]] { &[] }
    }
    pub struct AnsiTheme { pub light: bool }
    pub fn detect_kitty_graphics() -> bool { false }
    pub fn detect_light_background() -> bool { false }
    pub fn render_with_renderer<R>(_src: &[u8], _opts: Options, _r: R) -> Result<(), ()> {
        todo!("blocked_on: bun_md")
    }
    pub fn render_to_ansi(_src: &[u8], _opts: Options, _theme: AnsiTheme) -> Result<Vec<u8>, ()> {
        todo!("blocked_on: bun_md")
    }
}

bun_output::declare_scope!(RUN, visible);
bun_output::declare_scope!(BunXFastPath, visible);

// TODO(port): Zig used module-level `var path_buf: bun.PathBuffer = undefined;`.
// In Rust we wrap in thread_local RefCell since these are mutable globals accessed
// from a single thread but Rust forbids `static mut` without unsafe.
thread_local! {
    static PATH_BUF: RefCell<PathBuffer> = const { RefCell::new(PathBuffer::ZEROED) };
    static PATH_BUF2: RefCell<PathBuffer> = const { RefCell::new(PathBuffer::ZEROED) };
}

pub struct NpmArgs;
impl NpmArgs {
    // https://github.com/npm/rfcs/blob/main/implemented/0021-reduce-lifecycle-script-environment.md#detailed-explanation
    pub const PACKAGE_NAME: &'static [u8] = b"npm_package_name";
    pub const PACKAGE_VERSION: &'static [u8] = b"npm_package_version";
}

pub struct RunCommand;

impl RunCommand {
    const SHELLS_TO_SEARCH: &'static [&'static [u8]] = &[b"bash", b"sh", b"zsh"];

    fn find_shell_impl(path: &[u8], cwd: &[u8]) -> Option<&'static ZStr> {
        // TODO(port): return type — Zig returns a slice into a static buffer or a literal.
        // We return Option<&'static ZStr> here; the cached path is copied into SHELL_BUF in find_shell.
        #[cfg(windows)]
        {
            return Some(bun_core::zstr!("C:\\Windows\\System32\\cmd.exe"));
        }

        #[cfg(not(windows))]
        {
            PATH_BUF.with_borrow_mut(|path_buf| {
                for shell in Self::SHELLS_TO_SEARCH {
                    if let Some(shell_) = which(path_buf, path, cwd, shell) {
                        // SAFETY: which() writes into path_buf and returns a slice into it.
                        // The caller (find_shell) immediately copies this into its own static buffer.
                        // TODO(port): lifetime — Zig returns a borrow into the global path_buf.
                        return Some(unsafe { ::core::mem::transmute::<&ZStr, &'static ZStr>(shell_) });
                    }
                }
                None
            })
            .or_else(|| {
                fn try_shell(str: &ZStr) -> bool {
                    sys::is_executable_file_path(str)
                }

                const HARDCODED_POPULAR_ONES: &[&ZStr] = &[
                    bun_core::zstr!("/bin/bash"),
                    bun_core::zstr!("/usr/bin/bash"),
                    bun_core::zstr!("/usr/local/bin/bash"), // don't think this is a real one
                    bun_core::zstr!("/bin/sh"),
                    bun_core::zstr!("/usr/bin/sh"), // don't think this is a real one
                    bun_core::zstr!("/usr/bin/zsh"),
                    bun_core::zstr!("/usr/local/bin/zsh"),
                    bun_core::zstr!("/system/bin/sh"), // Android
                ];
                for shell in HARDCODED_POPULAR_ONES {
                    if try_shell(shell) {
                        return Some(*shell);
                    }
                }

                None
            })
        }
    }

    /// Find the "best" shell to use
    /// Cached to only run once
    pub fn find_shell(path: &[u8], cwd: &[u8]) -> Option<&'static ZStr> {
        thread_local! {
            static SHELL_BUF: RefCell<PathBuffer> = const { RefCell::new(PathBuffer::ZEROED) };
        }
        static ONCE: bun_core::Once<Option<&'static ZStr>> = bun_core::Once::new();
        // TODO(port): bun.once stored args; here we capture path/cwd by closure on first call only.
        ONCE.call(|| {
            if let Some(found) = Self::find_shell_impl(path, cwd) {
                SHELL_BUF.with_borrow_mut(|shell_buf| {
                    if found.len() < shell_buf.len() {
                        shell_buf[..found.len()].copy_from_slice(found.as_bytes());
                        shell_buf[found.len()] = 0;
                        // SAFETY: shell_buf[found.len()] == 0 written above; SHELL_BUF is thread-local
                        // and lives for the program lifetime (process exits before thread teardown).
                        return Some(unsafe {
                            ::core::mem::transmute::<&ZStr, &'static ZStr>(ZStr::from_raw(
                                shell_buf.as_ptr(),
                                found.len(),
                            ))
                        });
                    }
                    None
                })
            } else {
                None
            }
        })
    }

    const BUN_BIN_NAME: &'static str = if cfg!(debug_assertions) { "bun-debug" } else { "bun" };
    const BUN_RUN: &'static str = const_format::concatcp!(RunCommand::BUN_BIN_NAME, " run");
    const BUN_RUN_USING_BUN: &'static str =
        const_format::concatcp!(RunCommand::BUN_BIN_NAME, " --bun run");

    // Look for invocations of any:
    // - yarn run
    // - yarn $cmdName
    // - pnpm run
    // - npm run
    // Replace them with "bun run"

    #[inline]
    pub fn replace_package_manager_run(
        copy_script: &mut Vec<u8>,
        script: &[u8],
    ) -> Result<(), AllocError> {
        let mut entry_i: usize = 0;
        let mut delimiter: u8 = b' ';

        while entry_i < script.len() {
            let start = entry_i;

            match script[entry_i] {
                b'y' => {
                    if delimiter > 0 {
                        let remainder = &script[start..];
                        if remainder.starts_with(b"yarn ") {
                            let next = &remainder[b"yarn ".len()..];
                            // We have yarn
                            // Find the next space
                            if let Some(space) = strings::index_of_char(next, b' ') {
                                let yarn_cmd = &next[..space as usize];
                                if yarn_cmd == b"run" {
                                    copy_script.extend_from_slice(Self::BUN_RUN.as_bytes());
                                    entry_i += b"yarn run".len();
                                    continue;
                                }

                                // yarn npm is a yarn 2 subcommand
                                if yarn_cmd == b"npm" {
                                    entry_i += b"yarn npm ".len();
                                    copy_script.extend_from_slice(b"yarn npm ");
                                    continue;
                                }

                                if yarn_cmd.starts_with(b"-") {
                                    // Skip the rest of the command
                                    entry_i += b"yarn ".len() + yarn_cmd.len();
                                    copy_script.extend_from_slice(b"yarn ");
                                    copy_script.extend_from_slice(yarn_cmd);
                                    continue;
                                }

                                // implicit yarn commands
                                if !yarn_commands::ALL_YARN_COMMANDS.contains(yarn_cmd) {
                                    copy_script.extend_from_slice(Self::BUN_RUN.as_bytes());
                                    copy_script.push(b' ');
                                    copy_script.extend_from_slice(yarn_cmd);
                                    entry_i += b"yarn ".len() + yarn_cmd.len();
                                    delimiter = 0;
                                    continue;
                                }
                            }
                        }
                    }

                    delimiter = 0;
                }

                b' ' => {
                    delimiter = b' ';
                }
                b'"' => {
                    delimiter = b'"';
                }
                b'\'' => {
                    delimiter = b'\'';
                }

                b'n' => {
                    if delimiter > 0 {
                        if script[start..].starts_with(b"npm run ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_RUN, " ").as_bytes(),
                            );
                            entry_i += b"npm run ".len();
                            delimiter = 0;
                            continue;
                        }

                        if script[start..].starts_with(b"npx ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_BIN_NAME, " x ").as_bytes(),
                            );
                            entry_i += b"npx ".len();
                            delimiter = 0;
                            continue;
                        }
                    }

                    delimiter = 0;
                }
                b'p' => {
                    if delimiter > 0 {
                        if script[start..].starts_with(b"pnpm run ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_RUN, " ").as_bytes(),
                            );
                            entry_i += b"pnpm run ".len();
                            delimiter = 0;
                            continue;
                        }
                        if script[start..].starts_with(b"pnpm dlx ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_BIN_NAME, " x ").as_bytes(),
                            );
                            entry_i += b"pnpm dlx ".len();
                            delimiter = 0;
                            continue;
                        }
                        if script[start..].starts_with(b"pnpx ") {
                            copy_script.extend_from_slice(
                                const_format::concatcp!(RunCommand::BUN_BIN_NAME, " x ").as_bytes(),
                            );
                            entry_i += b"pnpx ".len();
                            delimiter = 0;
                            continue;
                        }
                    }

                    delimiter = 0;
                }
                _ => {
                    delimiter = 0;
                }
            }

            copy_script.push(script[entry_i]);
            entry_i += 1;
        }
        Ok(())
    }

    pub fn run_package_script_foreground(
        ctx: &Command::Context,
        original_script: &[u8],
        name: &[u8],
        cwd: &[u8],
        env: &mut DotEnv::Loader,
        passthrough: &[&[u8]],
        silent: bool,
        use_system_shell: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let shell_bin = Self::find_shell(env.get(b"PATH").unwrap_or(b""), cwd)
            .ok_or(bun_core::err!("MissingShell"))?;
        env.map.put(b"npm_lifecycle_event", name).expect("unreachable");
        env.map.put(b"npm_lifecycle_script", original_script).expect("unreachable");

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
            if crate::shell::needs_escape_utf8_ascii_latin1(part) {
                crate::shell::escape_8bit(part, &mut copy_script, true)?;
            } else {
                copy_script.extend_from_slice(part);
            }
        }

        bun_output::scoped_log!(RUN, "Script: \"{}\"", bstr::BStr::new(&copy_script));

        if !silent {
            Output::command(&copy_script);
            Output::flush();
        }

        if !use_system_shell {
            let mini = jsc::MiniEventLoop::init_global(env, Some(cwd));
            let code = match crate::shell::Interpreter::init_and_run_from_source(
                ctx,
                mini,
                name,
                &copy_script,
                cwd,
            ) {
                Ok(c) => c,
                Err(err) => {
                    if !silent {
                        Output::pretty_errorln(
                            "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                            (bstr::BStr::new(name), err.name()),
                        );
                    }
                    Global::exit(1);
                }
            };

            if code > 0 {
                if code != 2 && !silent {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> script <b>\"{}\"<r> exited with code {}<r>",
                        (bstr::BStr::new(name), code),
                    );
                    Output::flush();
                }

                Global::exit(code);
            }

            return Ok(());
        }

        let argv: [&[u8]; 3] = [
            shell_bin.as_bytes(),
            if cfg!(windows) { b"/c" } else { b"-c" },
            &copy_script,
        ];

        let ipc_fd: Option<Fd> = if !cfg!(windows) {
            'blk: {
                let Some(node_ipc_fd) = env_var::NODE_CHANNEL_FD.get() else { break 'blk None };
                // TODO(port): parseInt(u31) — using u32 then range-check
                let Ok(fd) = ::core::str::from_utf8(node_ipc_fd)
                    .ok()
                    .and_then(|s| s.parse::<u32>().ok())
                    .ok_or(())
                else {
                    break 'blk None;
                };
                Some(Fd::from_native(i32::try_from(fd).unwrap()))
            }
        } else {
            None // TODO: implement on Windows
        };

        use crate::api::bun_process::{sync as spawn_sync_mod, Status as SpawnStatus};

        // TODO: remember to free this when we add --filter or --concurrent
        // in the meantime we don't need to free it.
        let envp = env.map.create_null_delimited_env_map()?;

        let spawn_result_maybe = spawn_sync_mod::spawn(&spawn_sync_mod::Options {
            argv: argv.iter().map(|s| s.to_vec().into_boxed_slice()).collect(),
            argv0: Some(shell_bin.as_ptr() as *const c_char),
            envp: Some(envp.as_ptr() as *const *const c_char),
            cwd: cwd.to_vec().into_boxed_slice(),
            stderr: spawn_sync_mod::SyncStdio::Inherit,
            stdout: spawn_sync_mod::SyncStdio::Inherit,
            stdin: spawn_sync_mod::SyncStdio::Inherit,
            ipc: ipc_fd,

            #[cfg(windows)]
            windows: crate::api::bun_process::WindowsOptions {
                loop_: jsc::EventLoopHandle::init(jsc::MiniEventLoop::init_global(env, None)),
                ..Default::default()
            },
            ..Default::default()
        });

        let spawn_result = match spawn_result_maybe {
            Err(err) => {
                if !silent {
                    Output::pretty_errorln(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                        (bstr::BStr::new(name), err.name()),
                    );
                }
                Output::flush();
                return Ok(());
            }
            Ok(Err(err)) => {
                if !silent {
                    Output::pretty_errorln(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error:\n{}",
                        (bstr::BStr::new(name), err),
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
                        Output::pretty_errorln(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> was terminated by signal {}<r>",
                            (
                                bstr::BStr::new(name),
                                bun_sys::SignalCode(sig as u8)
                                    .fmt(Output::enable_ansi_colors_stderr()),
                            ),
                        );
                        Output::flush();

                        if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() == Some(true) {
                            bun_crash_handler::suppress_reporting();
                        }

                        Global::raise_ignoring_panic_handler(sig);
                    }
                }

                if exit_code.code != 0 {
                    if exit_code.code != 2 && !silent {
                        pretty_errorln!(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> exited with code {}<r>",
                            bstr::BStr::new(name), exit_code.code,
                        );
                        Output::flush();
                    }

                    Global::exit(exit_code.code as u32);
                }
            }

            SpawnStatus::Signaled(_) => {
                if let Some(sig) = spawn_result.status.signal_code() {
                    if sig != bun_core::SignalCode::SIGINT && !silent {
                        pretty_errorln!(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> was terminated by signal {}<r>",
                            bstr::BStr::new(name),
                            bun_sys::SignalCode(sig as u8)
                                .fmt(Output::enable_ansi_colors_stderr()),
                        );
                        Output::flush();
                    }

                    if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() == Some(true) {
                        bun_crash_handler::suppress_reporting();
                    }

                    Global::raise_ignoring_panic_handler(sig);
                }
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

    /// When printing error messages from 'bun run', attribute bun overridden node.js to bun
    /// This prevents '"node" exited with ...' when it was actually bun.
    /// As of writing this is only used for 'runBinary'
    fn basename_or_bun(str: &[u8]) -> &[u8] {
        // The full path is not used here, because on windows it is dependant on the
        // username. Before windows we checked bun_node_dir, but this is not allowed on Windows.
        let suffix_posix = const_format::concatcp!("/bun-node/node", std::env::consts::EXE_SUFFIX).as_bytes();
        let suffix_win = const_format::concatcp!("\\bun-node\\node", std::env::consts::EXE_SUFFIX).as_bytes();
        if str.ends_with(suffix_posix) || (cfg!(windows) && str.ends_with(suffix_win)) {
            return b"bun";
        }
        bun_paths::basename(str)
    }

    /// On windows, this checks for a `.bunx` file in the same directory as the
    /// script If it exists, it will be run instead of the script which is
    /// assumed to `bun_shim_impl.exe`
    ///
    /// This function only returns if an error starting the process is
    /// encountered, most other errors are handled by printing and exiting.
    pub fn run_binary(
        ctx: &Command::Context,
        executable: &[u8],
        executable_z: &ZStr,
        cwd: &[u8],
        env: &mut DotEnv::Loader,
        passthrough: &[&[u8]],
        original_script_for_bun_run: Option<&[u8]>,
    ) -> Result<::core::convert::Infallible, bun_core::Error> {
        // Attempt to find a ".bunx" file on disk, and run it, skipping the
        // wrapper exe.  we build the full exe path even though we could do
        // a relative lookup, because in the case we do find it, we have to
        // generate this full path anyways.
        #[cfg(windows)]
        if bun_core::FeatureFlags::WINDOWS_BUNX_FAST_PATH && executable.ends_with(b".exe") {
            debug_assert!(bun_paths::is_absolute(executable));

            // Using a mut borrow is safe because we know that
            // `direct_launch_buffer` is the data destination that assumption is
            // backed by the immediate assertion.
            // TODO(port): @constCast → direct mutable access to static buffer
            let mut wpath = BunXFastPath::DIRECT_LAUNCH_BUFFER.with_borrow_mut(|buf| {
                let w = strings::to_nt_path(buf, executable);
                debug_assert!(bun_core::is_slice_in_buffer_t::<u16>(w, buf));
                // SAFETY: returned slice points into thread-local buffer; lifetime extended to caller scope
                unsafe { core::mem::transmute::<&mut [u16], &'static mut [u16]>(w) }
            });

            debug_assert!(wpath.len() > sys::windows::NT_OBJECT_PREFIX.len() + b".exe".len());
            let new_len = wpath.len() + b".bunx".len() - b".exe".len();
            // TODO(port): wpath.len += delta — recreate slice with new length into static buffer
            let wpath = BunXFastPath::DIRECT_LAUNCH_BUFFER.with_borrow_mut(|buf| {
                // SAFETY: buf is the thread-local DIRECT_LAUNCH_BUFFER; new_len <= buf.len()
                // (extended by ".bunx".len - ".exe".len delta on the original NT path).
                unsafe { core::slice::from_raw_parts_mut(buf.as_mut_ptr(), new_len) }
            });
            let bunx = bun_str::w!("bunx");
            wpath[new_len - bunx.len()..].copy_from_slice(bunx);

            BunXFastPath::try_launch(ctx, wpath, env, passthrough);
        }

        Self::run_binary_without_bunx_path(
            ctx,
            executable,
            executable_z.as_ptr() as *const c_char,
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

    fn run_binary_without_bunx_path(
        ctx: &Command::Context,
        executable: &[u8],
        executable_z: *const c_char,
        cwd: &[u8],
        env: &mut DotEnv::Loader,
        passthrough: &[&[u8]],
        original_script_for_bun_run: Option<&[u8]>,
    ) -> Result<::core::convert::Infallible, bun_core::Error> {
        let argv_ = [executable];
        let mut argv: Vec<&[u8]> = argv_.to_vec();

        if !passthrough.is_empty() {
            let mut array_list: Vec<&[u8]> = Vec::new();
            array_list.push(executable);
            array_list.extend_from_slice(passthrough);
            argv = array_list;
        }

        let silent = ctx.debug.silent;

        use crate::api::bun_process::{sync, Status as SpawnStatus};

        // TODO: remember to free this when we add --filter or --concurrent
        // in the meantime we don't need to free it.
        let envp = env.map.create_null_delimited_env_map()?;

        let spawn_result = match sync::spawn(&sync::Options {
            argv: argv.iter().map(|a| a.to_vec().into_boxed_slice()).collect(),
            argv0: Some(executable_z),
            envp: Some(envp.as_ptr() as *const *const c_char),
            cwd: cwd.to_vec().into_boxed_slice(),
            stderr: sync::SyncStdio::Inherit,
            stdout: sync::SyncStdio::Inherit,
            stdin: sync::SyncStdio::Inherit,
            use_execve_on_macos: silent,

            #[cfg(windows)]
            windows: crate::api::bun_process::WindowsOptions {
                loop_: jsc::EventLoopHandle::init(jsc::MiniEventLoop::init_global(env, None)),
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
                            // SAFETY: executable is a NUL-terminated slice (executableZ points into it)
                            let exec_z = unsafe { ZStr::from_raw(executable.as_ptr(), executable.len()) };
                            match sys::stat(exec_z) {
                                sys::Result::Ok(stat) => {
                                    if sys::S::ISDIR(stat.st_mode) {
                                        pretty_errorln!(
                                            "<r><red>error<r>: Failed to run directory \"<b>{}<r>\"\n",
                                            bstr::BStr::new(Self::basename_or_bun(executable)),
                                        );
                                        break 'print_error;
                                    }
                                }
                                sys::Result::Err(err2) => match err2.get_errno() {
                                    sys::Errno::ENOENT | sys::Errno::EPERM | sys::Errno::ENOTDIR => {
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
                            err.name(),
                        );
                    }
                }
                Global::exit(1);
            }
        };

        match spawn_result {
            sys::Result::Err(err) => {
                // an error occurred while spawning the process
                Self::run_binary_generic_error(executable, silent, err);
            }
            sys::Result::Ok(result) => {
                let signal_code = result.status.signal_code();
                match result.status {
                    // An error occurred after the process was spawned.
                    SpawnStatus::Err(err) => {
                        Self::run_binary_generic_error(executable, silent, err);
                    }

                    SpawnStatus::Signaled(signal) => {
                        let signal = bun_sys::SignalCode(signal);
                        if signal.valid() && signal != bun_sys::SignalCode::SIGINT && !silent {
                            pretty_errorln!(
                                "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to signal <b>{}<r>",
                                bstr::BStr::new(Self::basename_or_bun(executable)),
                                signal.name().unwrap_or("unknown"),
                            );
                        }

                        if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() == Some(true) {
                            bun_crash_handler::suppress_reporting();
                        }

                        if let Some(sc) = signal_code {
                            Global::raise_ignoring_panic_handler(sc);
                        }
                        Global::exit(1);
                    }

                    SpawnStatus::Exited(exit_code) => {
                        // A process can be both signaled and exited
                        let exit_signal = bun_sys::SignalCode(exit_code.signal);
                        if exit_signal.valid() {
                            if !silent {
                                pretty_errorln!(
                                    "<r><red>error<r>: \"<b>{}<r>\" exited with signal <b>{}<r>",
                                    bstr::BStr::new(Self::basename_or_bun(executable)),
                                    exit_signal.name().unwrap_or("unknown"),
                                );
                            }

                            if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() == Some(true) {
                                bun_crash_handler::suppress_reporting();
                            }

                            if let Some(sc) = signal_code {
                                Global::raise_ignoring_panic_handler(sc);
                            }
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
                                    // if you run something like `bun run test`, you get a confusing message because
                                    // you don't usually think about your global path, let alone "/bin/test"
                                    //
                                    // test exits with code 1, the other ones i listed exit with code 2
                                    //
                                    // so for these script names, print the entire exe name.
                                    Output::err_generic(
                                        "\"<b>{}<r>\" exited with code {}",
                                        (bstr::BStr::new(executable), code),
                                    );
                                    bun_core::note!(
                                        "a package.json script \"{}\" was not found",
                                        bstr::BStr::new(original_script_for_bun_run.unwrap()),
                                    );
                                }
                                // 128 + 2 is the exit code of a process killed by SIGINT, which is caused by CTRL + C
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

    pub fn ls(ctx: &Command::Context) -> Result<(), bun_core::Error> {
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

    // This path is almost always a path to a user directory. So it cannot be inlined like
    // our uses of /tmp. You can use one of these functions instead:
    // - bun.windows.GetTempPathW (native)
    // - bun.fs.FileSystem.RealFS.platformTempDir (any platform)
    #[cfg(not(windows))]
    pub const BUN_NODE_DIR: &'static str = const_format::concatcp!(
        if cfg!(target_os = "macos") {
            "/private/tmp"
        } else if cfg!(target_os = "android") {
            "/data/local/tmp"
        } else {
            "/tmp"
        },
        if !cfg!(debug_assertions) {
            // TODO(port): Environment.git_sha_short — string concat at const time
            const_format::concatcp!(
                "/bun-node",
                if Environment::GIT_SHA_SHORT.len() > 0 {
                    const_format::concatcp!("-", Environment::GIT_SHA_SHORT)
                } else {
                    ""
                }
            )
        } else {
            "/bun-node-debug"
        }
    );
    // TODO(port): @compileError on use — Zig fired only when the .windows arm was reached.
    // Rust evaluates const items eagerly, so we leave the const undefined on Windows; misuse
    // surfaces as an unresolved-name error at the use site instead.

    pub fn bun_node_file_utf8() -> Result<&'static ZStr, bun_core::Error> {
        // TODO(port): allocator param dropped (global mimalloc)
        #[cfg(not(windows))]
        {
            // TODO(port): Zig returned BUN_NODE_DIR (no NUL); we need a ZStr.
            const BUN_NODE_DIR_Z: &str = const_format::concatcp!(RunCommand::BUN_NODE_DIR, "\0");
            // SAFETY: BUN_NODE_DIR_Z is a NUL-terminated &'static str literal.
            return Ok(unsafe {
                ZStr::from_raw(BUN_NODE_DIR_Z.as_ptr(), BUN_NODE_DIR_Z.len() - 1)
            });
        }
        #[cfg(windows)]
        {
            let mut temp_path_buffer = WPathBuffer::uninit();
            let mut target_path_buffer = PathBuffer::uninit();
            let len = sys::windows::GetTempPathW(
                u32::try_from(temp_path_buffer.len()).unwrap(),
                temp_path_buffer.as_mut_ptr(),
            );
            if len == 0 {
                return Err(bun_core::err!("FailedToGetTempPath"));
            }

            let converted = strings::convert_utf16_to_utf8_in_buffer(
                &mut target_path_buffer,
                &temp_path_buffer[..len as usize],
            )?;

            const DIR_NAME: &str = const_format::concatcp!(
                "bun-node",
                if Environment::GIT_SHA_SHORT.len() > 0 {
                    const_format::concatcp!("-", Environment::GIT_SHA_SHORT)
                } else {
                    ""
                }
            );
            const FILE_NAME: &str = const_format::concatcp!(DIR_NAME, "\\node.exe");
            let conv_len = converted.len();
            target_path_buffer[conv_len..conv_len + FILE_NAME.len()]
                .copy_from_slice(FILE_NAME.as_bytes());

            target_path_buffer[conv_len + FILE_NAME.len()] = 0;

            // TODO(port): allocator.dupeZ → leak a Box<ZStr>; caller never frees (process-lifetime)
            let owned = bun_str::ZStr::from_bytes(&target_path_buffer[..conv_len + FILE_NAME.len()]);
            Ok(Box::leak(owned))
        }
    }

    pub fn create_fake_temporary_node_executable(
        path: &mut Vec<u8>,
        optional_bun_path: &mut &[u8],
    ) -> Result<(), bun_core::Error> {
        // TODO(port): error set was OOM || std.fs.SelfExePathError
        // If we are already running as "node", the path should exist
        // SAFETY: PRETEND_TO_BE_NODE is a process-startup flag (single-threaded write).
        if unsafe { cli::PRETEND_TO_BE_NODE } {
            return Ok(());
        }

        #[cfg(unix)]
        {
            let mut argv0: *const c_char = optional_bun_path.as_ptr() as *const c_char;

            // if we are already an absolute path, use that
            // if the user started the application via a shebang, it's likely that the path is absolute already
            // PORT NOTE: `bun_core::argv()` returns an `Argv` wrapper; `.get(0)` yields
            // `&'static ZStr` (NUL-terminated, process-lifetime).
            let argv0_slice = bun_core::argv().get(0).map(|z| z.as_bytes()).unwrap_or(b"");
            if argv0_slice.first() == Some(&b'/') {
                *optional_bun_path = argv0_slice;
                argv0 = argv0_slice.as_ptr() as *const c_char;
            } else if optional_bun_path.is_empty() {
                // otherwise, ask the OS for the absolute path
                let self_ = bun_core::self_exe_path()?;
                if !self_.is_empty() {
                    argv0 = self_.as_ptr() as *const c_char;
                    *optional_bun_path = self_.as_bytes();
                }
            }

            if optional_bun_path.is_empty() {
                argv0 = argv0_slice.as_ptr() as *const c_char;
            }

            #[cfg(debug_assertions)]
            {
                // Zig: std.fs.deleteTreeAbsolute(BUN_NODE_DIR) — best-effort.
                let _ = sys::Dir::cwd().delete_tree(Self::BUN_NODE_DIR.as_bytes());
            }
            const PATHS: [&str; 2] = [
                const_format::concatcp!(RunCommand::BUN_NODE_DIR, "/node\0"),
                const_format::concatcp!(RunCommand::BUN_NODE_DIR, "/bun\0"),
            ];
            const BUN_NODE_DIR_Z: &str =
                const_format::concatcp!(RunCommand::BUN_NODE_DIR, "\0");
            for p in PATHS {
                let mut retried = false;
                'retry: loop {
                    'inner: {
                        // SAFETY: argv0 is a valid NUL-terminated C string.
                        let target = unsafe {
                            let cstr = CStr::from_ptr(argv0);
                            ZStr::from_raw(cstr.as_ptr().cast(), cstr.to_bytes().len())
                        };
                        // SAFETY: PATHS entries are NUL-terminated string literals.
                        let link = unsafe { ZStr::from_raw(p.as_ptr(), p.len() - 1) };
                        if let sys::Result::Err(err) = sys::symlink(target, link) {
                            if err.get_errno() == sys::Errno::EEXIST {
                                break 'inner;
                            }
                            if retried {
                                return Ok(());
                            }

                            // Zig: std.fs.makeDirAbsoluteZ(BUN_NODE_DIR) — best-effort.
                            // SAFETY: BUN_NODE_DIR_Z is a NUL-terminated literal.
                            let dir_z = unsafe {
                                ZStr::from_raw(
                                    BUN_NODE_DIR_Z.as_ptr(),
                                    BUN_NODE_DIR_Z.len() - 1,
                                )
                            };
                            let _ = sys::mkdir(dir_z, 0o755);

                            retried = true;
                            continue 'retry;
                        }
                    }
                    break;
                }
            }
            if !path.is_empty() && path[path.len() - 1] != DELIMITER {
                path.push(DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            path.extend_from_slice(Self::BUN_NODE_DIR.as_bytes());
            path.push(DELIMITER);
        }
        #[cfg(windows)]
        {
            let mut target_path_buffer = WPathBuffer::uninit();

            let prefix = bun_str::w!("\\??\\");

            let len = sys::windows::GetTempPathW(
                u32::try_from(target_path_buffer.len() - prefix.len()).unwrap(),
                // SAFETY: prefix.len() < target_path_buffer.len(); pointer stays in bounds.
                unsafe { target_path_buffer.as_mut_ptr().add(prefix.len()) },
            );
            if len == 0 {
                Output::debug(
                    "Failed to create temporary node dir: {}",
                    (sys::windows::get_last_error_tag(),),
                );
                return Ok(());
            }
            let len = len as usize;

            target_path_buffer[..prefix.len()].copy_from_slice(prefix);

            const DIR_NAME: &str = if cfg!(debug_assertions) {
                "bun-node-debug"
            } else {
                const_format::concatcp!(
                    "bun-node",
                    if Environment::GIT_SHA_SHORT.len() > 0 {
                        const_format::concatcp!("-", Environment::GIT_SHA_SHORT)
                    } else {
                        ""
                    }
                )
            };
            let dir_name_w = bun_str::w!(DIR_NAME);
            // TODO(port): w! macro requires literal; this needs a const-time UTF-16 conversion of DIR_NAME
            target_path_buffer[prefix.len() + len..prefix.len() + len + dir_name_w.len()]
                .copy_from_slice(dir_name_w);
            let dir_slice_len = prefix.len() + len + dir_name_w.len();

            #[cfg(debug_assertions)]
            {
                let dir_slice_u8 = strings::utf16_le_to_utf8_alloc(&target_path_buffer[..dir_slice_len])
                    .expect("oom");
                let _ = sys::Dir::cwd().delete_tree(&dir_slice_u8);
                sys::Dir::cwd().make_path(&dir_slice_u8).expect("huh?");
            }

            let image_path = sys::windows::exe_path_w();
            for name in [bun_str::w!("node.exe"), bun_str::w!("bun.exe")] {
                // file_name = dir_name ++ "\\" ++ name ++ "\x00"
                let mut off = prefix.len() + len;
                target_path_buffer[off..off + dir_name_w.len()].copy_from_slice(dir_name_w);
                off += dir_name_w.len();
                target_path_buffer[off] = b'\\' as u16;
                off += 1;
                target_path_buffer[off..off + name.len()].copy_from_slice(name);
                off += name.len();
                target_path_buffer[off] = 0;

                let file_slice = &target_path_buffer[..off];

                if sys::windows::CreateHardLinkW(
                    file_slice.as_ptr(),
                    image_path.as_ptr(),
                    core::ptr::null_mut(),
                ) == 0
                {
                    match sys::windows::get_last_error() {
                        sys::windows::Error::ALREADY_EXISTS => {}
                        _ => {
                            {
                                debug_assert!(target_path_buffer[dir_slice_len] == b'\\' as u16);
                                target_path_buffer[dir_slice_len] = 0;
                                let _ = sys::mkdir_w(&target_path_buffer[..dir_slice_len], 0);
                                target_path_buffer[dir_slice_len] = b'\\' as u16;
                            }

                            if sys::windows::CreateHardLinkW(
                                file_slice.as_ptr(),
                                image_path.as_ptr(),
                                core::ptr::null_mut(),
                            ) == 0
                            {
                                return Ok(());
                            }
                        }
                    }
                }
            }
            if !path.is_empty() && path[path.len() - 1] != DELIMITER {
                path.push(DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            strings::to_utf8_append_to_list(
                path,
                &target_path_buffer[prefix.len()..dir_slice_len],
            )?;
            path.push(DELIMITER);
        }
        Ok(())
    }

    pub fn configure_env_for_run(
        ctx: &Command::Context,
        this_transpiler: &mut ::core::mem::MaybeUninit<Transpiler<'static>>,
        env: Option<*mut DotEnv::Loader<'static>>,
        log_errors: bool,
        store_root_fd: bool,
    ) -> Result<*mut DirInfo, bun_core::Error> {
        // TODO(port): return type lifetime — Zig returns *DirInfo owned by resolver cache
        let args = ctx.args.clone();
        let env_is_none = env.is_none();
        let arena: &'static bun_alloc::Arena = runner_arena();
        // PORT NOTE: out-param constructor — `MaybeUninit::write` avoids dropping
        // an uninitialized `Transpiler` (the old `*this_transpiler = …` would).
        this_transpiler.write(Transpiler::init(arena, ctx.log, args, env)?);
        // SAFETY: just initialized via `write` on the line above.
        let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        // SAFETY: `Transpiler::init` always sets `env` (singleton or leaked).
        let env_loader = unsafe { &mut *this_transpiler.env };
        env_loader.quiet = true;
        this_transpiler.options.env.prefix = Box::default();

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        this_transpiler.resolver.opts.load_tsconfig_json = true;
        this_transpiler.options.load_tsconfig_json = true;

        this_transpiler.configure_linker();

        // SAFETY: `Transpiler::init` always sets `fs` (process-static singleton).
        let top_level_dir = unsafe { (*this_transpiler.fs).top_level_dir };
        let root_dir_info = match this_transpiler.resolver.read_dir_info(top_level_dir) {
            Err(err) => {
                if !log_errors {
                    return Err(bun_core::err!("CouldntReadCurrentDirectory"));
                }
                // SAFETY: `ctx.log` is the process-lifetime CLI log.
                let _ = unsafe { &*ctx.log }.print(Output::error_writer());
                pretty_errorln!(
                    "<r><red>error<r><d>:<r> <b>{}<r> loading directory {}",
                    err.name(),
                    bun_fmt::QuotedFormatter { text: top_level_dir },
                );
                Output::flush();
                return Err(err);
            }
            Ok(None) => {
                // SAFETY: `ctx.log` is the process-lifetime CLI log.
                let _ = unsafe { &*ctx.log }.print(Output::error_writer());
                pretty_errorln!("error loading current directory");
                Output::flush();
                return Err(bun_core::err!("CouldntReadCurrentDirectory"));
            }
            Ok(Some(info)) => info,
        };

        this_transpiler.resolver.store_fd = false;

        if env_is_none {
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

        // SAFETY: re-borrow after `run_env_loader` may have touched the loader via the
        // raw pointer; the singleton lives for the process.
        let env_loader = unsafe { &mut *this_transpiler.env };

        env_loader
            .map
            .put_default(b"npm_config_local_prefix", top_level_dir)
            .expect("unreachable");

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_aio::ParentDeathWatchdog::is_enabled() {
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

        // SAFETY: resolver cache owns the DirInfo for the process lifetime.
        let root_dir_ref = unsafe { &*root_dir_info };
        if let Some(package_json) = root_dir_ref.enclosing_package_json {
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

            if let Some(config) = &package_json.config {
                env_loader.map.ensure_unused_capacity(config.count())?;
                debug_assert_eq!(config.keys().len(), config.values().len());
                for (k, v) in config.keys().iter().zip(config.values().iter()) {
                    let key = strings::concat(&[b"npm_package_config_", k.as_ref()])?;
                    env_loader.map.put_assume_capacity(&key, v);
                    // PERF(port): was assume_capacity
                }
            }
        }

        Ok(root_dir_info)
    }

    pub fn configure_path_for_run_with_package_json_dir(
        ctx: &Command::Context,
        package_json_dir: &[u8],
        this_transpiler: &mut Transpiler,
        original_path: Option<&mut &[u8]>,
        cwd: &[u8],
        force_using_bun: bool,
    ) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): return type was []u8 (slice into owned ArrayList); we return Vec<u8>
        // SAFETY: `Transpiler::init` always sets `env`/`fs` (process-lifetime singletons).
        let env_loader = unsafe { &mut *this_transpiler.env };
        let fs_ref = unsafe { &*this_transpiler.fs };
        let path = env_loader.get(b"PATH").unwrap_or(b"");
        if let Some(op) = original_path {
            *op = path;
        }

        let bun_node_exe = Self::bun_node_file_utf8()?;
        let bun_node_dir_win = bun_core::util::dirname(bun_node_exe.as_bytes())
            .ok_or(bun_core::err!("FailedToGetTempPath"))?;
        let found_node = env_loader
            .load_node_js_config(
                fs_ref,
                if force_using_bun { bun_node_exe.as_bytes() } else { b"" },
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
                new_path_len +=
                    strings::without_trailing_slash(remain).len() + b"node_modules.bin".len() + 1 + 2; // +2 for path separators, +1 for path delimiter
                remain = &remain[..i as usize];
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
            match Self::create_fake_temporary_node_executable(&mut new_path, &mut optional_bun_self_path)
            {
                Ok(()) => {}
                Err(e) if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
                Err(other) => panic!(
                    "unexpected error from createFakeTemporaryNodeExecutable: {}",
                    other.name()
                ),
            }

            if !force_using_bun {
                this_transpiler.env.map.put(b"NODE", bun_node_exe.as_bytes()).unwrap_or_oom();
                this_transpiler
                    .env
                    .map
                    .put(b"npm_node_execpath", bun_node_exe.as_bytes())
                    .unwrap_or_oom();
                this_transpiler
                    .env
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
                new_path.extend_from_slice(path_literal!(b"/node_modules/.bin", b"\\node_modules\\.bin"));
                new_path.push(DELIMITER);
                remain = &remain[..i as usize];
            }
            // Zig `else` clause runs once after loop ends naturally
            new_path.extend_from_slice(strings::without_trailing_slash(remain));
            new_path.extend_from_slice(path_literal!(b"/node_modules/.bin", b"\\node_modules\\.bin"));
            new_path.push(DELIMITER);

            new_path.extend_from_slice(path);
        }

        Ok(new_path)
    }

    pub fn configure_path_for_run(
        ctx: &Command::Context,
        root_dir_info: &DirInfo,
        this_transpiler: &mut Transpiler,
        original_path: Option<&mut &[u8]>,
        cwd: &[u8],
        force_using_bun: bool,
    ) -> Result<(), bun_core::Error> {
        let mut package_json_dir: &[u8] = b"";

        if let Some(package_json) = root_dir_info.enclosing_package_json {
            if root_dir_info.package_json.is_none() { // raw field -- `is_none()` only
                // no trailing slash

                package_json_dir = strings::without_trailing_slash(package_json.source.path.name.dir);
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
        // TODO(port): new_path is now owned Vec<u8>; map.put may need to take ownership or borrow
        this_transpiler.env.map.put(b"PATH", &new_path).unwrap_or_oom();
        Ok(())
    }

    pub fn completions<const FILTER: Filter>(
        ctx: &Command::Context,
        default_completions: Option<&[&[u8]]>,
        reject_list: &[&[u8]],
    ) -> Result<ShellCompletions, bun_core::Error> {
        let mut shell_out = ShellCompletions::default();
        if FILTER != Filter::ScriptExclude {
            if let Some(defaults) = default_completions {
                shell_out.commands = defaults.to_vec().into_boxed_slice();
                // TODO(port): Zig stored the borrowed slice; we copy here
            }
        }

        let args = ctx.args.clone();

        let Ok(mut this_transpiler) = Transpiler::init(ctx.log, args, None) else {
            return Ok(shell_out);
        };
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        this_transpiler.options.env.prefix = b"";
        this_transpiler.env.quiet = true;

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = true;
        let resolver_ptr: *mut _ = &mut this_transpiler.resolver;
        let _reset = scopeguard::guard((), move |_| {
            // SAFETY: this_transpiler outlives _reset (declared earlier in the same scope);
            // raw ptr used to avoid holding a long-lived &mut across the body below.
            // TODO(port): defer block resetting resolver flags — borrow checker reshape
            unsafe {
                (*resolver_ptr).care_about_bin_folder = false;
                (*resolver_ptr).care_about_scripts = false;
            }
        });
        this_transpiler.configure_linker();

        let Some(root_dir_info) = this_transpiler
            .resolver
            .read_dir_info(this_transpiler.fs.top_level_dir)
            .ok()
            .flatten()
        else {
            return Ok(shell_out);
        };

        {
            this_transpiler.env.load_process()?;

            if let Some(node_env) = this_transpiler.env.get(b"NODE_ENV") {
                if node_env == b"production" {
                    this_transpiler.options.production = true;
                }
            }
        }

        type ResultList = ArrayHashMap<Box<[u8]>, ()>;
        // TODO(port): Zig used bun.StringArrayHashMap(void) keyed by borrowed slices

        if let Some(shell) = this_transpiler.env.get(b"SHELL") {
            shell_out.shell = ShellCompletions::Shell::from_env(shell);
        }

        let mut results = ResultList::new();
        let mut descriptions: Vec<&[u8]> = Vec::new();

        if FILTER != Filter::ScriptExclude {
            if let Some(defaults) = default_completions {
                results.ensure_unused_capacity(defaults.len())?;
                for item in defaults {
                    let _ = results.get_or_put_assume_capacity(Box::from(*item));
                    // PERF(port): was assume_capacity
                }
            }
        }

        if FILTER == Filter::Bin || FILTER == Filter::All || FILTER == Filter::AllPlusBunJs {
            for bin_path in this_transpiler.resolver.bin_dirs() {
                if let Some(bin_dir) = this_transpiler.resolver.read_dir_info(bin_path).ok().flatten() {
                    if let Some(entries) = bin_dir.get_entries_const() {
                        PATH_BUF.with_borrow_mut(|path_buf| -> Result<(), bun_core::Error> {
                            let mut iter = entries.data.iter();
                            let mut has_copied = false;
                            let mut dir_slice_len: usize = 0;
                            while let Some(entry) = iter.next() {
                                let value = entry.value;
                                if value.kind(&this_transpiler.fs.fs, true) == bun_resolver::fs::EntryKind::File {
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
                                    let slice = unsafe {
                                        ZStr::from_raw(path_buf.as_ptr(), dir_slice_len + base.len())
                                    };
                                    if !sys::is_executable_file_path(slice) {
                                        continue;
                                    }
                                    // we need to dupe because the string pay point to a pointer that only exists in the current scope
                                    let Ok(appended) =
                                        this_transpiler.fs.filename_store.append(base)
                                    else {
                                        continue;
                                    };
                                    let _ = results.get_or_put(Box::from(appended))?;
                                }
                            }
                            Ok(())
                        })?;
                    }
                }
            }
        }

        if FILTER == Filter::AllPlusBunJs || FILTER == Filter::BunJs {
            if let Some(dir_info) = this_transpiler
                .resolver
                .read_dir_info(this_transpiler.fs.top_level_dir)
                .ok()
                .flatten()
            {
                if let Some(entries) = dir_info.get_entries_const() {
                    let mut iter = entries.data.iter();

                    while let Some(entry) = iter.next() {
                        let value = entry.value;
                        let name = value.base();
                        if name[0] != b'.'
                            && this_transpiler
                                .options
                                .loader(bun_paths::extension(name))
                                .can_be_run_by_bun()
                            && !strings::contains(name, b".config")
                            && !strings::contains(name, b".d.ts")
                            && !strings::contains(name, b".d.mts")
                            && !strings::contains(name, b".d.cts")
                            && value.kind(&this_transpiler.fs.fs, true) == bun_resolver::fs::EntryKind::File
                        {
                            let Ok(appended) = this_transpiler.fs.filename_store.append(name) else {
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
                if let Some(scripts) = &package_json.scripts {
                    results.ensure_unused_capacity(scripts.count())?;
                    if FILTER == Filter::ScriptAndDescriptions {
                        descriptions.reserve(scripts.count());
                    }

                    let mut max_description_len: usize = 20;
                    if let Some(max) = this_transpiler.env.get(b"MAX_DESCRIPTION_LEN") {
                        if let Some(max_len) = ::core::str::from_utf8(max)
                            .ok()
                            .and_then(|s| s.parse::<usize>().ok())
                        {
                            max_description_len = max_len;
                        }
                    }

                    let keys = scripts.keys();
                    let mut key_i: usize = 0;
                    'loop_: while key_i < keys.len() {
                        let key = keys[key_i];
                        key_i += 1;
                        // PORT NOTE: reshaped for borrowck — increment moved to top with continue 'loop_

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

                        let entry_item = results.get_or_put_assume_capacity(Box::from(key));
                        // PERF(port): was assume_capacity

                        if FILTER == Filter::ScriptAndDescriptions && max_description_len > 0 {
                            let mut description = scripts.get(key).unwrap();

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
                                                        &description[delimiter_offset + i..][j + 1..],
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

        let all_keys = results.into_keys();
        // TODO(port): Zig got a mutable view via results.keys() then sorted in place

        let mut all_keys = all_keys;
        strings::sort_asc(&mut all_keys);
        shell_out.commands = all_keys.into_boxed_slice();
        shell_out.descriptions = descriptions.into_boxed_slice();

        Ok(shell_out)
    }

    pub fn print_help(package_json: Option<&PackageJSON>) {
        const INTRO_TEXT: &str =
            "<b>Usage<r>: <b><green>bun run<r> <cyan>[flags]<r> \\<file or script\\>";

        const EXAMPLES_TEXT: &str = "<b>Examples:<r>\n  <d>Run a JavaScript or TypeScript file<r>\n  <b><green>bun run<r> <blue>./index.js<r>\n  <b><green>bun run<r> <blue>./index.tsx<r>\n\n  <d>Run a package.json script<r>\n  <b><green>bun run<r> <blue>dev<r>\n  <b><green>bun run<r> <blue>lint<r>\n\nFull documentation is available at <magenta>https://bun.com/docs/cli/run<r>\n";

        Output::pretty(const_format::concatcp!(INTRO_TEXT, "\n\n"), ());

        Output::pretty("<b>Flags:<r>", ());

        bun_clap::simple_help(crate::cli::arguments::RUN_PARAMS.as_slice());
        Output::pretty(const_format::concatcp!("\n\n", EXAMPLES_TEXT), ());

        if let Some(pkg) = package_json {
            if let Some(scripts) = &pkg.scripts {
                let mut display_name = pkg.name;

                if display_name.is_empty() {
                    display_name = bun_paths::basename(pkg.source.path.name.dir);
                }
                let _ = display_name;

                let mut iterator = scripts.iter();

                if scripts.count() > 0 {
                    Output::pretty(
                        "\n<b>package.json scripts ({} found):<r>",
                        (scripts.count(),),
                    );
                    // Output.prettyln("<r><blue><b>{s}<r> scripts:<r>\n", .{display_name});
                    while let Some(entry) = iterator.next() {
                        Output::prettyln("\n", ());
                        Output::prettyln(
                            "  <d>$</r> bun run<r> <blue>{}<r>\n",
                            (bstr::BStr::new(entry.key),),
                        );
                        Output::prettyln("  <d>  {}<r>\n", (bstr::BStr::new(entry.value),));
                    }

                    // Output.prettyln("\n<d>{d} scripts<r>", .{scripts.count()});

                    Output::prettyln("\n", ());
                } else {
                    Output::prettyln("\n<r><yellow>No \"scripts\" found in package.json.<r>\n", ());
                }
            } else {
                Output::prettyln("\n<r><yellow>No \"scripts\" found in package.json.<r>\n", ());
            }
        }

        Output::flush();
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
        let mut remote_urls: Vec<&[u8]> = Vec::new();
        for u in collector.urls.iter() {
            if !u.starts_with(b"http://") && !u.starts_with(b"https://") {
                continue;
            }
            let Ok(gop) = seen.get_or_put(u) else { continue };
            if gop.found_existing {
                continue;
            }
            if remote_urls.try_reserve(1).is_err() {
                continue;
            }
            remote_urls.push(u);
        }
        if remote_urls.is_empty() {
            return;
        }

        http::HTTPThread::init(&Default::default());

        // Heap-allocate each Download so AsyncHTTP.task has a stable
        // address (see RemoteImageDownload doc comment).
        let mut downloads: Vec<Box<RemoteImageDownload>> = Vec::new();
        // Drop frees response_buffer + the Box for each download.

        let done_channel = DoneChannel::init();

        // Kick off every download in parallel. Accumulate tasks into a
        // single ThreadPool.Batch, then ship the whole batch to the
        // HTTP thread in one schedule() call — worker picks up and runs
        // them concurrently.
        let mut batch = bun_threading::ThreadPool::Batch::default();
        for raw_url in remote_urls.iter() {
            let Ok(response_buffer) = bun_str::MutableString::init(8 * 1024) else {
                continue;
            };
            // TODO(port): Box::try_new is nightly; using Box::new (aborts on OOM via mimalloc)
            let mut d = Box::new(RemoteImageDownload {
                // Assigned immediately after construction (can't be set in the literal because
                // AsyncHTTP::init needs a pointer to response_buffer, which only has a stable
                // address once the owning struct is live).
                // SAFETY: field is fully overwritten by AsyncHTTP::init immediately below
                // before any read.
                // TODO(port): MaybeUninit pattern
                async_http: unsafe { ::core::mem::zeroed() },
                response_buffer,
                url: raw_url,
                done: &done_channel,
            });
            d.async_http = http::AsyncHTTP::init(
                http::Method::GET,
                bun_url::URL::parse(raw_url),
                Default::default(),
                b"",
                &mut d.response_buffer as *mut _,
                b"",
                http::HTTPClientResult::Callback::new::<RemoteImageDownload>(
                    RemoteImageDownload::on_done,
                )
                .init(&mut *d),
                http::FetchRedirect::Follow,
                Default::default(),
            );
            d.async_http.schedule(&mut batch);
            downloads.push(d);
        }
        if downloads.is_empty() {
            return;
        }
        http::http_thread().schedule(batch);

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
            let status = d.async_http.response.as_ref().map(|r| r.status_code).unwrap_or(0);
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
                if write!(cursor, "bun-md-{:x}{}", bun_core::fast_random(), bstr::BStr::new(ext))
                    .is_err()
                {
                    continue;
                }
                let written = 64 - cursor.len();
                &name_buf[..written]
            };
            let mut path: Vec<u8> = Vec::new();
            if write!(&mut path, "{}/{}", bstr::BStr::new(tmpdir), bstr::BStr::new(name)).is_err() {
                continue;
            }

            let fd = match sys::open_a(&path, sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC, 0o600) {
                sys::Result::Ok(f) => f,
                sys::Result::Err(_) => {
                    continue;
                }
            };
            let ok = matches!(sys::File { handle: fd }.write_all(bytes), sys::Result::Ok(_));
            fd.close();
            if !ok {
                // openA + TRUNC leaves an orphan even on zero-byte
                // write failure. Unlink via stack buffer so cleanup
                // can't fail for OOM reasons.
                Self::unlink_staged_path(&path);
                continue;
            }
            // Dupe d.url for the map key — `collector.urls.items` owns
            // the backing bytes and gets freed by `defer collector.deinit()`
            // when this function returns, which would leave out_map with
            // dangling keys that emitImage() would later hash-compare.
            let key: Box<[u8]> = Box::from(d.url);
            if out_map.put(key, path.into_boxed_slice()).is_err() {
                Self::unlink_staged_path(&path);
                // TODO(port): path moved above; reorder for borrowck in Phase B
                continue;
            }
        }
    }

    /// Null-terminate `path` on the stack and unlink it. Never allocates.
    fn unlink_staged_path(path: &[u8]) {
        let mut buf = PathBuffer::uninit();
        let _ = sys::unlink(bun_paths::resolve_path::z(path, &mut buf));
    }

    /// Read a markdown file, render it to ANSI, print to stdout, and exit.
    /// Runs without a JavaScript VM — much faster than booting JSC.
    fn render_markdown_file_and_exit(path: &[u8]) -> ! {
        // No explicit free() on contents / rendered below: every path out
        // of this function calls Global::exit() or bun.outOfMemory() (both
        // noreturn), so the OS reclaims the allocations on process exit.
        let contents = match sys::File::read_from(Fd::cwd(), path) {
            sys::Result::Ok(bytes) => bytes,
            sys::Result::Err(err) => {
                Output::pretty_errorln("<r><red>error<r>: {}", (err,));
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
            if let Some(env) = bun_core::getenv_z(b"COLUMNS") {
                if let Some(n) = ::core::str::from_utf8(env).ok().and_then(|s| s.parse::<u16>().ok()) {
                    if n > 0 {
                        break 'brk n;
                    }
                }
            }
            #[cfg(unix)]
            {
                // SAFETY: all-zero is a valid winsize (#[repr(C)] POD).
                let mut size: libc::winsize = unsafe { ::core::mem::zeroed() };
                // SAFETY: ioctl with valid winsize ptr
                if unsafe {
                    libc::ioctl(
                        libc::STDOUT_FILENO,
                        libc::TIOCGWINSZ,
                        &mut size as *mut libc::winsize,
                    )
                } == 0
                {
                    if size.ws_col > 0 {
                        break 'brk size.ws_col;
                    }
                }
            }
            #[cfg(windows)]
            {
                if let Ok(handle) = sys::windows::GetStdHandle(sys::windows::STD_OUTPUT_HANDLE) {
                    // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (#[repr(C)] POD).
                    let mut csbi: sys::windows::CONSOLE_SCREEN_BUFFER_INFO =
                        unsafe { ::core::mem::zeroed() };
                    if sys::windows::kernel32::GetConsoleScreenBufferInfo(handle, &mut csbi)
                        != sys::windows::FALSE
                    {
                        let w = csbi.srWindow.Right - csbi.srWindow.Left + 1;
                        if w > 0 {
                            break 'brk u16::try_from(w).unwrap();
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
            if bun_paths::is_absolute(path) {
                break 'blk path;
            }
            let cwd = match sys::getcwd(&mut cwd_buf) {
                sys::Result::Ok(c) => c,
                sys::Result::Err(_) => break 'blk path,
            };
            bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(cwd, &mut base_buf, &[path])
        };
        let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(abs_md_path);
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
            remote_image_paths: if remote_map.count() > 0 { Some(&remote_map) } else { None },
            image_base_dir,
        };

        let rendered = match md::render_to_ansi(&contents, md_opts, theme) {
            Err(e) if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
            Err(e) if e == bun_core::err!("StackOverflow") => {
                Output::pretty_errorln(
                    "<r><red>error<r>: markdown rendering exceeded the stack — input is too deeply nested",
                    (),
                );
                Output::flush();
                Global::exit(1);
            }
            Err(_) => unreachable!(),
            Ok(None) => {
                Output::pretty_errorln("<r><red>error<r>: failed to render markdown", ());
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

    fn _boot_and_handle_error(
        ctx: &Command::Context,
        path: &[u8],
        loader: Option<options::Loader>,
    ) -> bool {
        let resolved_loader: Option<options::Loader> =
            loader.or_else(|| options::DEFAULT_LOADERS.get(bun_paths::extension(path)).copied());
        if let Some(l) = resolved_loader {
            if l == options::Loader::Md {
                Self::render_markdown_file_and_exit(path);
            }
        }
        Global::configure_allocator(Global::AllocatorConfiguration { long_running: true, ..Default::default() });
        let Ok(dup) = Box::<[u8]>::try_from(path) else { return false };
        // TODO(port): Box::try_from doesn't exist; use to_vec().into_boxed_slice()
        if let Err(err) = bun_bun_js::Run::boot(ctx, dup, loader) {
            let _ = ctx.log.print(Output::error_writer());

            Output::pretty_errorln(
                "<r><red>error<r>: Failed to run <b>{}<r> due to error <b>{}<r>",
                (bstr::BStr::new(bun_paths::basename(path)), err.name()),
            );
            bun_core::handle_error_return_trace(&err);
            Global::exit(1);
        }
        true
    }

    fn maybe_open_with_bun_js(ctx: &Command::Context) -> bool {
        if ctx.args.entry_points.is_empty() {
            return false;
        }
        let mut script_name_buf = PathBuffer::uninit();

        let script_name_to_search: &[u8] = &ctx.args.entry_points[0];

        let mut absolute_script_path: Option<Box<[u8]>> = None;

        // TODO: optimize this pass for Windows. we can make better use of system apis available
        let mut file_path: &[u8] = script_name_to_search;
        {
            let opened = 'brk: {
                if bun_paths::is_absolute(script_name_to_search) {
                    let mut win_resolver = bun_paths::resolve_path::PosixToWinNormalizer::default();
                    let mut resolved = win_resolver
                        .resolve_cwd(script_name_to_search)
                        .expect("Could not resolve path");
                    #[cfg(windows)]
                    {
                        resolved =
                            bun_paths::resolve_path::normalize_string::<false, bun_paths::platform::Windows>(resolved);
                    }
                    break 'brk sys::open_file(resolved, sys::OpenFlags::READ_ONLY);
                } else if !script_name_to_search.starts_with(b"..")
                    && script_name_to_search[0] != b'~'
                {
                    let file_path_z = {
                        script_name_buf[..file_path.len()].copy_from_slice(file_path);
                        script_name_buf[file_path.len()] = 0;
                        // SAFETY: NUL written above
                        unsafe { ZStr::from_raw(script_name_buf.as_ptr(), file_path.len()) }
                    };

                    break 'brk sys::open_file_absolute_z(file_path_z, sys::OpenFlags::READ_ONLY);
                } else {
                    let mut path_buf_2 = PathBuffer::uninit();
                    let Ok(cwd) = bun_core::getcwd(&mut path_buf_2) else { return false };
                    let cwd_len = cwd.len();
                    path_buf_2[cwd_len] = SEP;
                    let parts = [script_name_to_search];
                    file_path = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
                        &path_buf_2[..cwd_len + 1],
                        &mut script_name_buf,
                        &parts,
                        );
                    if file_path.is_empty() {
                        return false;
                    }
                    let fp_len = file_path.len();
                    script_name_buf[fp_len] = 0;
                    // SAFETY: NUL written above
                    let file_path_z = unsafe { ZStr::from_raw(script_name_buf.as_ptr(), fp_len) };
                    break 'brk sys::open_file_absolute_z(file_path_z, sys::OpenFlags::READ_ONLY);
                }
            };
            let Ok(std_file) = opened else { return false };
            let Ok(file) = Fd::from_std_file(std_file)
                .make_libuv_owned_for_syscall(sys::Tag::open, sys::ErrorCase::CloseOnFail)
                .unwrap_result()
            else {
                return false;
            };
            // PORT NOTE: defer file.close() — using scopeguard
            let _close = scopeguard::guard(file, |f| f.close());
            let file = *_close;

            match sys::fstat(file) {
                sys::Result::Ok(stat) => {
                    // directories cannot be run. if only there was a faster way to check this
                    if sys::S::ISDIR(u32::try_from(stat.mode).unwrap()) {
                        return false;
                    }
                }
                sys::Result::Err(_) => return false,
            }

            Global::configure_allocator(Global::AllocatorConfiguration { long_running: true, ..Default::default() });

            absolute_script_path = 'brk: {
                #[cfg(not(windows))]
                {
                    let Ok(p) = sys::get_fd_path(file, &mut script_name_buf) else {
                        return false;
                    };
                    break 'brk Some(Box::from(p));
                }

                #[cfg(windows)]
                {
                    let mut fd_path_buf = PathBuffer::uninit();
                    let Ok(p) = sys::get_fd_path(file, &mut fd_path_buf) else {
                        return false;
                    };
                    break 'brk Some(Box::from(p));
                }
            };
        }

        let _ = Self::_boot_and_handle_error(ctx, &absolute_script_path.unwrap(), None);
        true
    }

    pub fn exec(ctx: &Command::Context, cfg: ExecCfg) -> Result<bool, bun_core::Error> {
        let bin_dirs_only = cfg.bin_dirs_only;
        let log_errors = cfg.log_errors;

        // find what to run

        let mut positionals = &ctx.positionals[..];
        if !positionals.is_empty() && positionals[0] == b"run" {
            positionals = &positionals[1..];
        }

        let mut target_name: &[u8] = b"";
        if !positionals.is_empty() {
            target_name = positionals[0];
            positionals = &positionals[1..];
        }
        let _ = positionals;
        let passthrough = ctx.passthrough; // unclear why passthrough is an escaped string, it should probably be []const []const u8 and allow its users to escape it.

        let mut try_fast_run = false;
        let mut skip_script_check = false;
        if !target_name.is_empty() && target_name[0] == b'.' {
            try_fast_run = true;
            skip_script_check = true;
        } else if bun_paths::is_absolute(target_name) {
            try_fast_run = true;
            skip_script_check = true;
        } else if cfg.allow_fast_run_for_extensions {
            let ext = bun_paths::extension(target_name);
            let default_loader = options::DEFAULT_LOADERS.get(ext).copied();
            if default_loader.is_some()
                && (default_loader.unwrap().can_be_run_by_bun()
                    || default_loader.unwrap() == options::Loader::Md)
            {
                try_fast_run = true;
            }
        }

        if !ctx.debug.loaded_bunfig {
            let _ = cli::Arguments::load_config_path(cli::Command::Tag::RunCommand, true, bun_core::zstr!("bunfig.toml"), ctx);
        }

        // try fast run (check if the file exists and is not a folder, then run it)
        if try_fast_run && Self::maybe_open_with_bun_js(ctx) {
            return Ok(true);
        }

        // setup
        let force_using_bun = ctx.debug.run_in_bun;
        let mut original_path: &[u8] = b"";
        // PORT NOTE: out-param init — Zig had `var this_transpiler: Transpiler = undefined;`.
        // `Transpiler` is NOT all-zero-valid POD (holds `&Arena`/`Box`/enum fields), so
        // `mem::zeroed()` is UB; use `MaybeUninit` and let `configure_env_for_run` `.write()`
        // the whole struct (PORTING.md §std.mem.zeroes).
        let mut this_transpiler = ::core::mem::MaybeUninit::<Transpiler>::uninit();
        let root_dir_info =
            Self::configure_env_for_run(ctx, &mut this_transpiler, None, log_errors, false)?;
        // SAFETY: `configure_env_for_run` returned `Ok`, so the slot is fully
        // initialized via `MaybeUninit::write`.
        let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
        Self::configure_path_for_run(
            ctx,
            root_dir_info,
            this_transpiler,
            Some(&mut original_path),
            root_dir_info.abs_path,
            force_using_bun,
        )?;
        this_transpiler.env.map.put(b"npm_command", b"run-script").expect("unreachable");

        // check for empty command

        if target_name.is_empty() {
            if let Some(package_json) = root_dir_info.enclosing_package_json {
                Self::print_help(Some(package_json));
            } else {
                Self::print_help(None);
                Output::prettyln("\n<r><yellow>No package.json found.<r>\n", ());
                Output::flush();
            }

            return Ok(true);
        }

        // check for stdin

        if target_name.len() == 1 && target_name[0] == b'-' {
            bun_output::scoped_log!(RUN, "Executing from stdin");

            // read from stdin
            // PERF(port): was stack-fallback allocator
            let mut list: Vec<u8> = Vec::new();
            // TODO(port): std.fs.File.stdin().readerStreaming → bun_sys equivalent
            if sys::File::stdin().read_to_end(&mut list).is_err() {
                return Ok(false);
            }
            ctx.runtime_options.eval.script = list.into_boxed_slice();
            // TODO(port): ctx mutability — Zig Context is mutable through pointer

            const TRIGGER: &[u8] = path_literal!(b"/[stdin]", b"\\[stdin]");
            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + TRIGGER.len()];
            let cwd_len = sys::getcwd(&mut entry_point_buf[..MAX_PATH_BYTES])?;
            entry_point_buf[cwd_len..cwd_len + TRIGGER.len()].copy_from_slice(TRIGGER);
            let entry_path = &entry_point_buf[..cwd_len + TRIGGER.len()];

            let mut passthrough_list: Vec<&[u8]> = Vec::with_capacity(ctx.passthrough.len() + 1);
            passthrough_list.push(b"-");
            // PERF(port): was assume_capacity
            passthrough_list.extend_from_slice(ctx.passthrough);
            ctx.passthrough = passthrough_list.into_boxed_slice();
            // TODO(port): ctx mutability

            let dup: Box<[u8]> = entry_path.to_vec().into_boxed_slice();
            if let Err(err) = super::Run::boot(ctx, dup, None) {
                let _ = ctx.log.print(Output::error_writer());

                Output::pretty_errorln(
                    "<r><red>error<r>: Failed to run <b>{}<r> due to error <b>{}<r>",
                    (bstr::BStr::new(bun_paths::basename(target_name)), err.name()),
                );
                bun_core::handle_error_return_trace(&err);
                Global::exit(1);
            }
            return Ok(true);
        }

        // run script with matching name

        if !skip_script_check {
            if let Some(package_json) = root_dir_info.enclosing_package_json {
                if let Some(scripts) = &package_json.scripts {
                    if let Some(script_content) = scripts.get(target_name) {
                        bun_output::scoped_log!(
                            RUN,
                            "Found matching script `{}`",
                            bstr::BStr::new(script_content)
                        );
                        Global::configure_allocator(Global::AllocatorConfiguration { long_running: false, ..Default::default() });
                        this_transpiler
                            .env
                            .map
                            .put(b"npm_lifecycle_event", target_name)
                            .expect("unreachable");

                        // allocate enough to hold "post${scriptname}"
                        let mut temp_script_buffer: Vec<u8> = Vec::new();
                        write!(
                            &mut temp_script_buffer,
                            "\x00pre{}",
                            bstr::BStr::new(target_name)
                        )?;

                        let package_json_path =
                            root_dir_info.enclosing_package_json.unwrap().source.path.text;
                        let package_json_dir = strings::without_trailing_slash(
                            strings::without_suffix_comptime(package_json_path, b"package.json"),
                        );
                        bun_output::scoped_log!(
                            RUN,
                            "Running in dir `{}`",
                            bstr::BStr::new(package_json_dir)
                        );

                        if let Some(prescript) = scripts.get(&temp_script_buffer[1..]) {
                            Self::run_package_script_foreground(
                                ctx,
                                prescript,
                                &temp_script_buffer[1..],
                                package_json_dir,
                                this_transpiler.env,
                                &[],
                                ctx.debug.silent,
                                ctx.debug.use_system_shell,
                            )?;
                        }

                        Self::run_package_script_foreground(
                            ctx,
                            script_content,
                            target_name,
                            package_json_dir,
                            this_transpiler.env,
                            passthrough,
                            ctx.debug.silent,
                            ctx.debug.use_system_shell,
                        )?;

                        temp_script_buffer[..b"post".len()].copy_from_slice(b"post");

                        if let Some(postscript) = scripts.get(&temp_script_buffer) {
                            Self::run_package_script_foreground(
                                ctx,
                                postscript,
                                &temp_script_buffer,
                                package_json_dir,
                                this_transpiler.env,
                                &[],
                                ctx.debug.silent,
                                ctx.debug.use_system_shell,
                            )?;
                        }

                        return Ok(true);
                    }
                }
            }
        }

        // load module and run that module
        // TODO: run module resolution here - try the next condition if the module can't be found

        bun_output::scoped_log!(
            RUN,
            "Try resolve `{}` in `{}`",
            bstr::BStr::new(target_name),
            bstr::BStr::new(this_transpiler.fs.top_level_dir)
        );
        let resolution = {
            let preserve_symlinks = this_transpiler.resolver.opts.preserve_symlinks;
            let _restore = scopeguard::guard((), |_| {
                // TODO(port): defer this_transpiler.resolver.opts.preserve_symlinks = preserve_symlinks;
                // borrowck reshape needed — captured this_transpiler mutably
            });
            this_transpiler.resolver.opts.preserve_symlinks = ctx.runtime_options.preserve_symlinks_main
                || env_var::NODE_PRESERVE_SYMLINKS_MAIN.get();
            let res = this_transpiler
                .resolver
                .resolve(
                    this_transpiler.fs.top_level_dir,
                    target_name,
                    bun_options_types::ImportKind::EntryPointRun,
                )
                .or_else(|_| {
                    let joined: Vec<u8> = [b"./".as_slice(), target_name].concat();
                    this_transpiler.resolver.resolve(
                        this_transpiler.fs.top_level_dir,
                        &joined,
                        bun_options_types::ImportKind::EntryPointRun,
                    )
                });
            this_transpiler.resolver.opts.preserve_symlinks = preserve_symlinks;
            res
        };
        let mut resolved_to_unrunnable_file: Option<ResolvedUnrunnable> = None;
        match resolution {
            Ok(resolved) => {
                let mut resolved_mutable = resolved;
                let path = resolved_mutable.path().unwrap();
                let loader: options::Loader = this_transpiler
                    .options
                    .loaders
                    .get(path.name.ext)
                    .copied()
                    .or_else(|| options::DEFAULT_LOADERS.get(path.name.ext).copied())
                    .unwrap_or(options::Loader::Tsx);
                if loader.can_be_run_by_bun()
                    || loader == options::Loader::Html
                    || loader == options::Loader::Md
                {
                    bun_output::scoped_log!(RUN, "Resolved to: `{}`", bstr::BStr::new(path.text));
                    return Ok(Self::_boot_and_handle_error(ctx, path.text, Some(loader)));
                } else {
                    bun_output::scoped_log!(
                        RUN,
                        "Resolved file `{}` but ignoring because loader is {}",
                        bstr::BStr::new(path.text),
                        <&'static str>::from(loader)
                    );
                    resolved_to_unrunnable_file = Some(ResolvedUnrunnable {
                        path: path.text,
                        loader,
                    });
                }
            }
            Err(_) => {
                // Support globs for HTML entry points.
                if target_name.ends_with(b".html") {
                    if strings::index_of_char(target_name, b'*').is_some() {
                        return Ok(Self::_boot_and_handle_error(
                            ctx,
                            target_name,
                            Some(options::Loader::Html),
                        ));
                    }
                }
            }
        }

        // execute a node_modules/.bin/<X> command, or (run only) a system command like 'ls'

        #[cfg(windows)]
        if bun_core::FeatureFlags::WINDOWS_BUNX_FAST_PATH {
            'try_bunx_file: {
                // Attempt to find a ".bunx" file on disk, and run it, skipping the
                // wrapper exe.  we build the full exe path even though we could do
                // a relative lookup, because in the case we do find it, we have to
                // generate this full path anyways.
                BunXFastPath::DIRECT_LAUNCH_BUFFER.with_borrow_mut(|direct_launch_buffer| {
                    let mut ptr: &mut [u16] = &mut direct_launch_buffer[..];
                    let root = bun_str::w!("\\??\\");
                    ptr[..root.len()].copy_from_slice(root);
                    ptr = &mut ptr[4..];
                    let cwd_len = sys::windows::kernel32::GetCurrentDirectoryW(
                        u32::try_from(direct_launch_buffer.len() - 4).unwrap(),
                        ptr.as_mut_ptr(),
                    );
                    if cwd_len == 0 {
                        return; // break 'try_bunx_file
                    }
                    let cwd_len = cwd_len as usize;
                    ptr = &mut ptr[cwd_len..];
                    let prefix = bun_str::w!("\\node_modules\\.bin\\");
                    ptr[..prefix.len()].copy_from_slice(prefix);
                    ptr = &mut ptr[prefix.len()..];
                    let encoded = strings::convert_utf8_to_utf16_in_buffer(ptr, target_name);
                    let encoded_len = encoded.len();
                    ptr = &mut ptr[encoded_len..];
                    let ext = bun_str::w!(".bunx");
                    ptr[..ext.len()].copy_from_slice(ext);
                    ptr[ext.len()] = 0;

                    let l = root.len() + cwd_len + prefix.len() + encoded_len + ext.len();
                    // SAFETY: NUL terminator written at index l
                    let path_to_use = unsafe {
                        bun_str::WStr::from_raw_mut(direct_launch_buffer.as_mut_ptr(), l)
                    };
                    BunXFastPath::try_launch(ctx, path_to_use, this_transpiler.env, ctx.passthrough);
                });
                // TODO(port): labeled-block control flow reshaped into closure for borrowck
                // (was: `let _ = 'try_bunx_file;` — invalid Rust label-as-expr)
            }
        }

        let path = this_transpiler.env.get(b"PATH").unwrap_or(b"");
        let mut path_for_which = path;
        if bin_dirs_only {
            if original_path.len() < path.len() {
                path_for_which = &path[..path.len() - (original_path.len() + 1)];
            } else {
                path_for_which = b"";
            }
        }

        if !path_for_which.is_empty() {
            let dest = PATH_BUF.with_borrow_mut(|path_buf| {
                which(path_buf, path_for_which, this_transpiler.fs.top_level_dir, target_name)
                    .map(|d| {
                        // SAFETY: borrow into thread-local PATH_BUF; consumed (copied via
                        // dirname_store.append) before PATH_BUF is reused.
                        // TODO(port): lifetime — borrow into thread-local; Zig copied via dirname_store below
                        unsafe { ::core::mem::transmute::<&ZStr, &'static ZStr>(d) }
                    })
            });
            if let Some(destination) = dest {
                let out = destination.as_bytes();
                let stored = this_transpiler.fs.dirname_store.append(out)?;
                Self::run_binary_without_bunx_path(
                    ctx,
                    stored,
                    destination.as_ptr() as *const c_char,
                    this_transpiler.fs.top_level_dir,
                    this_transpiler.env,
                    passthrough,
                    Some(target_name),
                )?;
            }
        }

        // failure

        if ctx.runtime_options.if_present {
            return Ok(true);
        }

        if ctx.filters.is_empty()
            && !ctx.workspaces
            // SAFETY: single-threaded CLI dispatch; `CMD` is set once in
            // `create_context_data` before any subcommand `exec` runs.
            && unsafe { cli::CMD }.is_some()
            && unsafe { cli::CMD }.unwrap() == cli::Command::Tag::AutoCommand
        {
            if target_name == b"feedback" {
                Self::bun_feedback(ctx)?;
            }
        }

        if log_errors {
            if let Some(info) = resolved_to_unrunnable_file {
                // SAFETY: BACKREF into resolver-owned path text; resolver outlives this scope.
                let path = unsafe { &*info.path };
                Output::pretty_error(
                    "<r><red>error<r><d>:<r> <b>Cannot run \"{}\"<r>\n",
                    (bstr::BStr::new(path),),
                );
                Output::pretty_error(
                    "<r><d>note<r><d>:<r> Bun cannot run {} files directly\n",
                    (<&'static str>::from(info.loader),),
                );
            } else {
                let ext = bun_paths::extension(target_name);
                let default_loader = options::DEFAULT_LOADERS.get(ext).copied();
                if (default_loader.is_some() && default_loader.unwrap().is_java_script_like_or_json())
                    || (!target_name.is_empty()
                        && (target_name[0] == b'.'
                            || target_name[0] == b'/'
                            || bun_paths::is_absolute(target_name)))
                {
                    Output::pretty_error(
                        "<r><red>error<r><d>:<r> <b>Module not found \"<b>{}<r>\"\n",
                        (bstr::BStr::new(target_name),),
                    );
                } else if !ext.is_empty() {
                    Output::pretty_error(
                        "<r><red>error<r><d>:<r> <b>File not found \"<b>{}<r>\"\n",
                        (bstr::BStr::new(target_name),),
                    );
                } else {
                    Output::pretty_error(
                        "<r><red>error<r><d>:<r> <b>Script not found \"<b>{}<r>\"\n",
                        (bstr::BStr::new(target_name),),
                    );
                }
            }

            Global::exit(1);
        }

        Ok(false)
    }

    pub fn exec_as_if_node(ctx: &Command::Context) -> Result<(), bun_core::Error> {
        debug_assert!(cli::PRETEND_TO_BE_NODE.get());

        if !ctx.runtime_options.eval.script.is_empty() {
            const TRIGGER: &[u8] = path_literal!(b"/[eval]", b"\\[eval]");
            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + TRIGGER.len()];
            let cwd_len = sys::getcwd(&mut entry_point_buf[..MAX_PATH_BYTES])?;
            entry_point_buf[cwd_len..cwd_len + TRIGGER.len()].copy_from_slice(TRIGGER);
            super::Run::boot(
                ctx,
                entry_point_buf[..cwd_len + TRIGGER.len()].to_vec().into_boxed_slice(),
                None,
            )?;
            return Ok(());
        }

        if ctx.positionals.is_empty() {
            Output::err_generic(
                "Missing script to execute. Bun's provided 'node' cli wrapper does not support a repl.",
                (),
            );
            Global::exit(1);
        }

        // TODO(@paperclover): merge windows branch
        // var win_resolver = resolve_path.PosixToWinNormalizer{};

        let filename = ctx.positionals[0];

        let normalized_filename: &[u8] = if bun_paths::is_absolute(filename) {
            // TODO(@paperclover): merge windows branch
            // try win_resolver.resolveCWD("/dev/bun/test/etc.js");
            filename
        } else {
            // TODO(port): uses module-level path_buf/path_buf2 globals
            PATH_BUF.with_borrow_mut(|path_buf| -> Result<&'static [u8], bun_core::Error> {
                let cwd = bun_core::getcwd(path_buf)?;
                let cwd_len = cwd.len();
                path_buf[cwd_len] = b'/'; // sep_posix
                let parts = [filename];
                PATH_BUF2.with_borrow_mut(|path_buf2| {
                    let r = bun_paths::resolve_path::join_abs_string_buf::<
                        bun_paths::platform::Loose,
                    >(&path_buf[..cwd_len + 1], path_buf2, &parts);
                    // SAFETY: result borrows thread-local PATH_BUF2 which lives for process lifetime
                    Ok(unsafe { ::core::mem::transmute::<&[u8], &'static [u8]>(r) })
                })
            })?
        };

        if let Err(err) =
            super::Run::boot(ctx, normalized_filename.to_vec().into_boxed_slice(), None)
        {
            let _ = ctx.log.print(Output::error_writer());

            Output::err(
                err,
                "Failed to run script \"<b>{}<r>\"",
                (bstr::BStr::new(bun_paths::basename(normalized_filename)),),
            );
            Global::exit(1);
        }
        Ok(())
    }

    fn bun_feedback(ctx: &Command::Context) -> Result<::core::convert::Infallible, bun_core::Error> {
        const TRIGGER: &[u8] = path_literal!(b"/[eval]", b"\\[eval]");
        let mut entry_point_buf = [0u8; MAX_PATH_BYTES + TRIGGER.len()];
        let cwd_len = sys::getcwd(&mut entry_point_buf[..MAX_PATH_BYTES])?;
        entry_point_buf[cwd_len..cwd_len + TRIGGER.len()].copy_from_slice(TRIGGER);
        ctx.runtime_options.eval.script = if Environment::CODEGEN_EMBED {
            // TODO(port): @embedFile → include_str! (path relative to this .rs)
            include_str!("../../js/eval/feedback.ts")
        } else {
            bun_core::runtime_embed_file(bun_core::EmbedKind::Codegen, "eval/feedback.ts")
        };
        // TODO(port): ctx mutability
        super::Run::boot(
            ctx,
            entry_point_buf[..cwd_len + TRIGGER.len()].to_vec().into_boxed_slice(),
            None,
        )?;
        Global::exit(0);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, ::core::marker::ConstParamTy)]
pub enum Filter {
    Script,
    Bin,
    All,
    BunJs,
    AllPlusBunJs,
    ScriptAndDescriptions,
    ScriptExclude,
}

pub struct ExecCfg {
    pub bin_dirs_only: bool,
    pub log_errors: bool,
    pub allow_fast_run_for_extensions: bool,
}

struct ResolvedUnrunnable {
    // BACKREF into resolver-owned path text; raw ptr per Phase-A `[]const u8` field rule
    // (no struct lifetimes in Phase A).
    path: *const [u8],
    loader: options::Loader,
}

type DoneChannel = Channel<u32, bun_collections::linear_fifo::StaticBuffer<u32, 256>>;
// TODO(port): Channel generic shape — Zig was Channel(u32, .{ .Static = 256 })

/// One pending remote-image download. Lives on the heap so its
/// `async_http.task` (embedded in ThreadPool.Task) has a stable
/// address — HTTPThread.schedule does @fieldParentPtr on that task,
/// so moving the struct would break the worker's callback.
struct RemoteImageDownload<'a> {
    // Assigned immediately after the struct literal in
    // prefetchRemoteImages (can't be set in the literal because
    // AsyncHTTP.init needs a pointer to response_buffer, which only
    // has a stable address once the owning struct is live).
    async_http: http::AsyncHTTP,
    response_buffer: bun_str::MutableString,
    url: &'a [u8],
    done: &'a DoneChannel,
}

impl<'a> RemoteImageDownload<'a> {
    fn on_done(
        &mut self,
        async_http: &mut http::AsyncHTTP,
        _result: http::HTTPClientResult,
    ) {
        // Mirror sendSyncCallback from AsyncHTTP.zig: the worker's
        // ThreadlocalAsyncHTTP is about to be freed, so copy its
        // mutated state back into our owned AsyncHTTP before writing
        // to the channel.
        // SAFETY: async_http.real points back at &mut self.async_http (set by AsyncHTTP::init)
        unsafe {
            *async_http.real.unwrap() = *async_http;
            (*async_http.real.unwrap()).response_buffer = async_http.response_buffer;
        }
        // TODO(port): raw-pointer copy semantics — Phase B verify AsyncHTTP layout
        // Channel payload is a placeholder tick — the main thread
        // walks `downloads[]` to read per-task state after N wakeups.
        let _ = self.done.write_item(0);
    }
}

// NOTE: uninhabited enum (type-namespace only) so it does not collide with the
// `declare_scope!(BunXFastPath, …)` static of the same name in value-namespace.
pub enum BunXFastPath {}

impl BunXFastPath {
    // TODO(port): module-level mutable WPathBuffer globals → thread_local RefCell
    thread_local! {
        pub static DIRECT_LAUNCH_BUFFER: RefCell<WPathBuffer> = const { RefCell::new(WPathBuffer::ZEROED) };
        static ENVIRONMENT_BUFFER: RefCell<WPathBuffer> = const { RefCell::new(WPathBuffer::ZEROED) };
    }

    /// Append a single UTF-8 argument to a Windows command line (UTF-16), with proper quoting and escaping.
    /// Returns the number of UTF-16 code units written.
    ///
    /// Based on libuv's quote_cmd_arg function:
    /// https://github.com/libuv/libuv/blob/v1.x/src/win/process.c#L443-L518
    ///
    /// SAFETY: Caller must ensure `buffer` has sufficient space. Worst case requires
    /// approximately `2 * arg.len + 3` UTF-16 code units (when every character needs escaping).
    /// The command line buffer is sized to Windows' 32,767 character limit.
    fn append_windows_argument(buffer: &mut [u16], arg: &[u8]) -> usize {
        // Temporary buffer for UTF-16 conversion (max 2048 wide chars = 4KB)
        let mut temp_buf = [0u16; 2048];

        // Convert UTF-8 to UTF-16
        let utf16_result = strings::convert_utf8_to_utf16_in_buffer(&mut temp_buf, arg);
        let len = utf16_result.len();
        let source = &temp_buf[..len];

        if len == 0 {
            // Empty argument needs quotes
            buffer[0] = b'"' as u16;
            buffer[1] = b'"' as u16;
            return 2;
        }

        // Check if we need quoting (contains space, tab, or quote)
        let needs_quote = source
            .iter()
            .any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'"' as u16);

        if !needs_quote {
            // No quoting needed, just copy to output
            buffer[..len].copy_from_slice(source);
            return len;
        }

        // Check if we have embedded quotes or backslashes
        let has_quote_or_backslash = source
            .iter()
            .any(|&c| c == b'"' as u16 || c == b'\\' as u16);

        if !has_quote_or_backslash {
            // Simple case: just wrap in quotes
            buffer[0] = b'"' as u16;
            buffer[1..1 + len].copy_from_slice(source);
            buffer[len + 1] = b'"' as u16;
            return len + 2;
        }

        // Complex case: need to handle backslash escaping
        // Use libuv's algorithm: process backwards, then reverse
        let mut pos: usize = 0;
        buffer[pos] = b'"' as u16;
        pos += 1;

        let start = pos;
        let mut quote_hit: bool = true;

        let mut i: usize = len;
        while i > 0 {
            i -= 1;
            buffer[pos] = source[i];
            pos += 1;

            if quote_hit && source[i] == b'\\' as u16 {
                buffer[pos] = b'\\' as u16;
                pos += 1;
            } else if source[i] == b'"' as u16 {
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

    /// If this returns, it implies the fast path cannot be taken
    #[cfg(windows)]
    fn try_launch(
        ctx: &Command::Context,
        path_to_use: &mut bun_str::WStr,
        env: &mut DotEnv::Loader,
        passthrough: &[&[u8]],
    ) {
        if !bun_core::FeatureFlags::WINDOWS_BUNX_FAST_PATH {
            return;
        }

        Self::DIRECT_LAUNCH_BUFFER.with_borrow_mut(|direct_launch_buffer| {
            debug_assert!(bun_core::is_slice_in_buffer_t::<u16>(
                path_to_use.as_slice(),
                direct_launch_buffer
            ));
            let command_line = &mut direct_launch_buffer[path_to_use.len()..];

            bun_output::scoped_log!(
                BunXFastPath,
                "Attempting to find and load bunx file: '{}'",
                bun_fmt::utf16(path_to_use.as_slice())
            );
            #[cfg(debug_assertions)]
            {
                debug_assert!(bun_paths::is_absolute_windows_wtf16(path_to_use.as_slice()));
            }
            let handle = match sys::open_file_at_windows(
                Fd::INVALID, // absolute path is given
                path_to_use,
                sys::OpenFileAtWindowsOptions {
                    access_mask: sys::windows::STANDARD_RIGHTS_READ
                        | sys::windows::FILE_READ_DATA
                        | sys::windows::FILE_READ_ATTRIBUTES
                        | sys::windows::FILE_READ_EA
                        | sys::windows::SYNCHRONIZE,
                    disposition: sys::windows::FILE_OPEN,
                    options: sys::windows::FILE_NON_DIRECTORY_FILE
                        | sys::windows::FILE_SYNCHRONOUS_IO_NONALERT,
                },
            )
            .unwrap_result()
            {
                Ok(fd) => fd.cast(),
                Err(err) => {
                    bun_output::scoped_log!(BunXFastPath, "Failed to open bunx file: '{}'", err);
                    return;
                }
            };

            let mut i: usize = 0;
            for arg in passthrough {
                // Add space separator before each argument
                command_line[i] = b' ' as u16;
                i += 1;

                // Append the argument with proper quoting/escaping
                #[cfg(windows)]
                {
                    i += Self::append_windows_argument(&mut command_line[i..], arg);
                }
                #[cfg(not(windows))]
                {
                    unreachable!();
                }
            }
            ctx.passthrough = passthrough;
            // TODO(port): ctx mutability

            let environment = Self::ENVIRONMENT_BUFFER.with_borrow_mut(|env_buf| {
                env.map.write_windows_env_block(env_buf)
            });
            let Ok(environment) = environment else { return };

            // TODO(b2-blocked): `bun_install::windows_shim::bun_shim_impl` is not
            // re-exported from the install crate yet (only `bin_linking_shim` is).
            todo!("blocked_on: bun_install::windows_shim::bun_shim_impl::FromBunRunContext");
            #[cfg(any())]
            let run_ctx = bun_install::windows_shim::bun_shim_impl::FromBunRunContext {
                handle,
                base_path: &path_to_use.as_slice()[4..],
                arguments: &command_line[..i],
                force_use_bun: ctx.debug.run_in_bun,
                direct_launch_with_bun_js: Self::direct_launch_callback,
                cli_context: ctx,
                environment,
            };

            #[cfg(debug_assertions)]
            {
                bun_output::scoped_log!(BunXFastPath, "run_ctx.handle: '{}'", Fd::from_system(handle));
                bun_output::scoped_log!(
                    BunXFastPath,
                    "run_ctx.base_path: '{}'",
                    bun_fmt::utf16(run_ctx.base_path)
                );
                bun_output::scoped_log!(
                    BunXFastPath,
                    "run_ctx.arguments: '{}'",
                    bun_fmt::utf16(run_ctx.arguments)
                );
                bun_output::scoped_log!(
                    BunXFastPath,
                    "run_ctx.force_use_bun: '{}'",
                    run_ctx.force_use_bun
                );
            }

            #[cfg(any())]
            bun_install::windows_shim::bun_shim_impl::try_startup_from_bun_js(run_ctx);

            bun_output::scoped_log!(BunXFastPath, "did not start via shim");
        });
    }

    #[cfg(windows)]
    fn direct_launch_callback(wpath: &[u16], ctx: &Command::Context) {
        Self::DIRECT_LAUNCH_BUFFER.with_borrow_mut(|direct_launch_buffer| {
            // SAFETY: WPathBuffer is `[u16; N]` — reinterpret as `[u8; 2N]`
            // for the UTF-16→UTF-8 transcoder's output buffer.
            let out_buf = unsafe {
                ::core::slice::from_raw_parts_mut(
                    direct_launch_buffer.as_mut_ptr().cast::<u8>(),
                    direct_launch_buffer.len() * 2,
                )
            };
            let utf8 = match bun_core::strings::convert_utf16_to_utf8_in_buffer(out_buf, wpath) {
                Ok(u) => u,
                Err(_) => return,
            };
            if let Err(err) = super::Run::boot(ctx, utf8.to_vec().into_boxed_slice(), None) {
                let _ = ctx.log.print(Output::error_writer());
                Output::err(
                    err,
                    "Failed to run bin \"<b>{}<r>\"",
                    (bstr::BStr::new(bun_paths::basename(utf8)),),
                );
                Global::exit(1);
            }
        });
    }
}

// TODO(port): the following Zig imports were re-exported as `use` at the top of this file:
// DotEnv, ShellCompletions, options, resolve_path, PackageJSON, which, yarn_commands, windows,
// bun (Environment, Global, OOM, Output, clap, default_allocator, jsc, strings, transpiler,
// Run, api), CLI (Arguments, Command).

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/run_command.zig (2204 lines)
//   confidence: low
//   todos:      46
//   notes:      heavy use of mutable global PathBuffers via thread_local; ctx mutability, Transpiler init-out-param, and Windows bunx fast-path buffer reslicing all need Phase B reshape; Output::* call signatures are placeholder (fmt-args tuple). All unsafe blocks now carry SAFETY annotations.
// ──────────────────────────────────────────────────────────────────────────
} // mod phase_a_draft

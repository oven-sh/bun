use core::ffi::{c_char, CStr};
use std::cell::RefCell;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_bundler::options as options;
use bun_bundler::Transpiler;
use crate::cli::{self as cli, Arguments, Command};
use bun_collections::{ArrayHashMap, StringHashMap};
use bun_core::{self as core, env_var, fmt as bun_fmt, Environment, Global, Output};
use bun_dotenv as DotEnv;
use bun_http as http;
use bun_jsc as jsc;
use bun_md as md;
use bun_paths::{self as resolve_path, PathBuffer, WPathBuffer, DELIMITER, MAX_PATH_BYTES, SEP};
use bun_resolver::dir_info::DirInfo;
use bun_resolver::package_json::PackageJSON;
use bun_schema::api;
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd};
use bun_threading::Channel;
use bun_which::which;

use crate::list_of_yarn_commands::all_yarn_commands as yarn_commands;
use crate::shell_completions::ShellCompletions;

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
            return Some(ZStr::from_static(b"C:\\Windows\\System32\\cmd.exe\0"));
        }

        #[cfg(not(windows))]
        {
            PATH_BUF.with_borrow_mut(|path_buf| {
                for shell in Self::SHELLS_TO_SEARCH {
                    if let Some(shell_) = which(path_buf, path, cwd, shell) {
                        // SAFETY: which() writes into path_buf and returns a slice into it.
                        // The caller (find_shell) immediately copies this into its own static buffer.
                        // TODO(port): lifetime — Zig returns a borrow into the global path_buf.
                        return Some(unsafe { core::mem::transmute::<&ZStr, &'static ZStr>(shell_) });
                    }
                }
                None
            })
            .or_else(|| {
                fn try_shell(str: &ZStr) -> bool {
                    sys::is_executable_file_path(str)
                }

                const HARDCODED_POPULAR_ONES: &[&ZStr] = &[
                    ZStr::from_static(b"/bin/bash\0"),
                    ZStr::from_static(b"/usr/bin/bash\0"),
                    ZStr::from_static(b"/usr/local/bin/bash\0"), // don't think this is a real one
                    ZStr::from_static(b"/bin/sh\0"),
                    ZStr::from_static(b"/usr/bin/sh\0"), // don't think this is a real one
                    ZStr::from_static(b"/usr/bin/zsh\0"),
                    ZStr::from_static(b"/usr/local/bin/zsh\0"),
                    ZStr::from_static(b"/system/bin/sh\0"), // Android
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
        *ONCE.call(|| {
            if let Some(found) = Self::find_shell_impl(path, cwd) {
                SHELL_BUF.with_borrow_mut(|shell_buf| {
                    if found.len() < shell_buf.len() {
                        shell_buf[..found.len()].copy_from_slice(found.as_bytes());
                        shell_buf[found.len()] = 0;
                        // SAFETY: shell_buf[found.len()] == 0 written above; SHELL_BUF is thread-local
                        // and lives for the program lifetime (process exits before thread teardown).
                        return Some(unsafe {
                            core::mem::transmute::<&ZStr, &'static ZStr>(ZStr::from_raw(
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
                                if !yarn_commands::has(yarn_cmd) {
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
                let Ok(fd) = core::str::from_utf8(node_ipc_fd)
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

        let spawn_result_maybe = bun_core::spawn_sync(&bun_core::SpawnSyncOptions {
            argv: &argv,
            argv0: Some(shell_bin.as_ptr() as *const c_char),

            // TODO: remember to free this when we add --filter or --concurrent
            // in the meantime we don't need to free it.
            envp: env.map.create_null_delimited_env_map()?,

            cwd: Some(cwd),
            stderr: bun_core::Stdio::Inherit,
            stdout: bun_core::Stdio::Inherit,
            stdin: bun_core::Stdio::Inherit,
            ipc: ipc_fd,

            #[cfg(windows)]
            windows: bun_core::SpawnWindowsOptions {
                loop_: jsc::EventLoopHandle::init(jsc::MiniEventLoop::init_global(env, None)),
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
            Ok(sys::Result::Err(err)) => {
                if !silent {
                    Output::pretty_errorln(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error:\n{}",
                        (bstr::BStr::new(name), err),
                    );
                }
                Output::flush();
                return Ok(());
            }
            Ok(sys::Result::Ok(result)) => result,
        };

        match spawn_result.status {
            bun_core::SpawnStatus::Exited(exit_code) => {
                if exit_code.signal.valid() && exit_code.signal != bun_core::Signal::SIGINT && !silent {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> script <b>\"{}\"<r> was terminated by signal {}<r>",
                        (bstr::BStr::new(name), exit_code.signal.fmt(Output::enable_ansi_colors_stderr())),
                    );
                    Output::flush();

                    if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() {
                        bun_crash_handler::suppress_reporting();
                    }

                    Global::raise_ignoring_panic_handler(exit_code.signal);
                }

                if exit_code.code != 0 {
                    if exit_code.code != 2 && !silent {
                        Output::pretty_errorln(
                            "<r><red>error<r><d>:<r> script <b>\"{}\"<r> exited with code {}<r>",
                            (bstr::BStr::new(name), exit_code.code),
                        );
                        Output::flush();
                    }

                    Global::exit(exit_code.code);
                }
            }

            bun_core::SpawnStatus::Signaled(signal) => {
                if signal.valid() && signal != bun_core::Signal::SIGINT && !silent {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> script <b>\"{}\"<r> was terminated by signal {}<r>",
                        (bstr::BStr::new(name), signal.fmt(Output::enable_ansi_colors_stderr())),
                    );
                    Output::flush();
                }

                if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() {
                    bun_crash_handler::suppress_reporting();
                }

                Global::raise_ignoring_panic_handler(signal);
            }

            bun_core::SpawnStatus::Err(err) => {
                if !silent {
                    Output::pretty_errorln(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error:\n{}",
                        (bstr::BStr::new(name), err),
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
        let suffix_posix = const_format::concatcp!("/bun-node/node", bun_core::EXE_SUFFIX).as_bytes();
        let suffix_win = const_format::concatcp!("\\bun-node\\node", bun_core::EXE_SUFFIX).as_bytes();
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
    ) -> Result<core::convert::Infallible, bun_core::Error> {
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
            Output::pretty_errorln(
                "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to:\n{}",
                (
                    bstr::BStr::new(Self::basename_or_bun(executable)),
                    err.with_path(executable),
                ),
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
    ) -> Result<core::convert::Infallible, bun_core::Error> {
        let argv_ = [executable];
        let mut argv: Vec<&[u8]> = argv_.to_vec();

        if !passthrough.is_empty() {
            let mut array_list: Vec<&[u8]> = Vec::new();
            array_list.push(executable);
            array_list.extend_from_slice(passthrough);
            argv = array_list;
        }

        let silent = ctx.debug.silent;
        let spawn_result = match bun_core::spawn_sync(&bun_core::SpawnSyncOptions {
            argv: &argv,
            argv0: Some(executable_z),

            // TODO: remember to free this when we add --filter or --concurrent
            // in the meantime we don't need to free it.
            envp: env.map.create_null_delimited_env_map()?,

            cwd: Some(cwd),
            stderr: bun_core::Stdio::Inherit,
            stdout: bun_core::Stdio::Inherit,
            stdin: bun_core::Stdio::Inherit,
            use_execve_on_macos: silent,

            #[cfg(windows)]
            windows: bun_core::SpawnWindowsOptions {
                loop_: jsc::EventLoopHandle::init(jsc::MiniEventLoop::init_global(env, None)),
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
                                    if sys::S::isdir(stat.mode) {
                                        Output::pretty_errorln(
                                            "<r><red>error<r>: Failed to run directory \"<b>{}<r>\"\n",
                                            (bstr::BStr::new(Self::basename_or_bun(executable)),),
                                        );
                                        break 'print_error;
                                    }
                                }
                                sys::Result::Err(err2) => match err2.get_errno() {
                                    sys::Errno::NOENT | sys::Errno::PERM | sys::Errno::NOTDIR => {
                                        Output::pretty_errorln(
                                            "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to error:\n{}",
                                            (bstr::BStr::new(Self::basename_or_bun(executable)), err2),
                                        );
                                        break 'print_error;
                                    }
                                    _ => {}
                                },
                            }
                        }

                        Output::pretty_errorln(
                            "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to <r><red>{}<r>",
                            (bstr::BStr::new(Self::basename_or_bun(executable)), err.name()),
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
                match result.status {
                    // An error occurred after the process was spawned.
                    bun_core::SpawnStatus::Err(err) => {
                        Self::run_binary_generic_error(executable, silent, err);
                    }

                    bun_core::SpawnStatus::Signaled(signal) => {
                        if signal.valid() && signal != bun_core::Signal::SIGINT && !silent {
                            Output::pretty_errorln(
                                "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to signal <b>{}<r>",
                                (
                                    bstr::BStr::new(Self::basename_or_bun(executable)),
                                    signal.name().unwrap_or("unknown"),
                                ),
                            );
                        }

                        if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() {
                            bun_crash_handler::suppress_reporting();
                        }

                        Global::raise_ignoring_panic_handler(signal);
                    }

                    bun_core::SpawnStatus::Exited(exit_code) => {
                        // A process can be both signaled and exited
                        if exit_code.signal.valid() {
                            if !silent {
                                Output::pretty_errorln(
                                    "<r><red>error<r>: \"<b>{}<r>\" exited with signal <b>{}<r>",
                                    (
                                        bstr::BStr::new(Self::basename_or_bun(executable)),
                                        exit_code.signal.name().unwrap_or("unknown"),
                                    ),
                                );
                            }

                            if bun_core::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN.get() {
                                bun_crash_handler::suppress_reporting();
                            }

                            Global::raise_ignoring_panic_handler(exit_code.signal);
                        }

                        let code = exit_code.code;
                        if code != 0 {
                            if !silent {
                                let is_probably_trying_to_run_a_pkg_script =
                                    original_script_for_bun_run.is_some()
                                        && ((code == 1
                                            && original_script_for_bun_run.unwrap() == b"test")
                                            || (code == 2
                                                && strings::eql_any(
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
                                    Output::note(
                                        "a package.json script \"{}\" was not found",
                                        (bstr::BStr::new(original_script_for_bun_run.unwrap()),),
                                    );
                                }
                                // 128 + 2 is the exit code of a process killed by SIGINT, which is caused by CTRL + C
                                else if code > 0 && code != 130 {
                                    Output::err_generic(
                                        "\"<b>{}<r>\" exited with code {}",
                                        (bstr::BStr::new(Self::basename_or_bun(executable)), code),
                                    );
                                } else {
                                    Output::pretty_errorln(
                                        "<r><red>error<r>: Failed to run \"<b>{}<r>\" due to exit code <b>{}<r>",
                                        (bstr::BStr::new(Self::basename_or_bun(executable)), code),
                                    );
                                }
                            }
                        }

                        Global::exit(code);
                    }
                    bun_core::SpawnStatus::Running => panic!("Unexpected state: process is running"),
                }
            }
        }
    }

    pub fn ls(ctx: &Command::Context) -> Result<(), bun_core::Error> {
        let args = ctx.args.clone();

        let mut this_transpiler = Transpiler::init(ctx.log, args, None)?;
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        this_transpiler.options.env.prefix = b"";

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
            return Ok(ZStr::from_static(
                const_format::concatcp!(RunCommand::BUN_NODE_DIR, "\0").as_bytes(),
            ));
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
        if cli::PRETEND_TO_BE_NODE.get() {
            return Ok(());
        }

        #[cfg(unix)]
        {
            let mut argv0: *const c_char = optional_bun_path.as_ptr() as *const c_char;

            // if we are already an absolute path, use that
            // if the user started the application via a shebang, it's likely that the path is absolute already
            if bun_core::argv()[0][0] == b'/' {
                *optional_bun_path = bun_core::argv()[0];
                argv0 = bun_core::argv()[0].as_ptr() as *const c_char;
                // TODO(port): bun.argv[0] is [:0]const u8 in Zig; assume null-terminated here
            } else if optional_bun_path.is_empty() {
                // otherwise, ask the OS for the absolute path
                let self_ = bun_core::self_exe_path()?;
                if !self_.is_empty() {
                    argv0 = self_.as_ptr() as *const c_char;
                    *optional_bun_path = self_;
                }
            }

            if optional_bun_path.is_empty() {
                argv0 = bun_core::argv()[0].as_ptr() as *const c_char;
            }

            #[cfg(debug_assertions)]
            {
                // TODO(port): std.fs.deleteTreeAbsolute → bun_sys equivalent
                let _ = sys::delete_tree_absolute(Self::BUN_NODE_DIR.as_bytes());
            }
            const PATHS: [&str; 2] = [
                const_format::concatcp!(RunCommand::BUN_NODE_DIR, "/node"),
                const_format::concatcp!(RunCommand::BUN_NODE_DIR, "/bun"),
            ];
            for p in PATHS {
                let mut retried = false;
                loop {
                    'inner: {
                        // SAFETY: argv0 is a valid NUL-terminated C string
                        let target = unsafe { CStr::from_ptr(argv0) };
                        if let Err(err) = sys::symlinkz(target, p.as_bytes()) {
                            if err == bun_core::err!("PathAlreadyExists") {
                                break 'inner;
                            }
                            if retried {
                                return Ok(());
                            }

                            let _ = sys::make_dir_absolute_z(Self::BUN_NODE_DIR.as_bytes());

                            retried = true;
                            continue;
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
                let _ = sys::delete_tree_absolute(&dir_slice_u8);
                sys::make_dir_absolute(&dir_slice_u8).expect("huh?");
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
        this_transpiler: &mut Transpiler,
        env: Option<&mut DotEnv::Loader>,
        log_errors: bool,
        store_root_fd: bool,
    ) -> Result<&'static mut DirInfo, bun_core::Error> {
        // TODO(port): return type lifetime — Zig returns *DirInfo owned by resolver cache
        let args = ctx.args.clone();
        let env_is_none = env.is_none();
        *this_transpiler = Transpiler::init(ctx.log, args, env)?;
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        this_transpiler.env.quiet = true;
        this_transpiler.options.env.prefix = b"";

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        this_transpiler.resolver.opts.load_tsconfig_json = true;
        this_transpiler.options.load_tsconfig_json = true;

        this_transpiler.configure_linker();

        let root_dir_info = match this_transpiler.resolver.read_dir_info(this_transpiler.fs.top_level_dir) {
            Err(err) => {
                if !log_errors {
                    return Err(bun_core::err!("CouldntReadCurrentDirectory"));
                }
                let _ = ctx.log.print(Output::error_writer());
                Output::pretty_errorln(
                    "<r><red>error<r><d>:<r> <b>{}<r> loading directory {}",
                    (
                        err.name(),
                        bun_fmt::QuotedFormatter { text: this_transpiler.fs.top_level_dir },
                    ),
                );
                Output::flush();
                return Err(err);
            }
            Ok(None) => {
                let _ = ctx.log.print(Output::error_writer());
                Output::pretty_errorln("error loading current directory", ());
                Output::flush();
                return Err(bun_core::err!("CouldntReadCurrentDirectory"));
            }
            Ok(Some(info)) => info,
        };

        this_transpiler.resolver.store_fd = false;

        if env_is_none {
            this_transpiler.env.load_process()?;

            if let Some(node_env) = this_transpiler.env.get(b"NODE_ENV") {
                if node_env == b"production" {
                    this_transpiler.options.production = true;
                }
            }

            // Always skip default .env files for package.json script runner
            // (see comment in env_loader.zig:542-548 - the script's own bun instance loads .env)
            let _ = this_transpiler.run_env_loader(true);
        }

        this_transpiler
            .env
            .map
            .put_default(b"npm_config_local_prefix", this_transpiler.fs.top_level_dir)
            .expect("unreachable");

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_core::ParentDeathWatchdog::is_enabled() {
            this_transpiler
                .env
                .map
                .put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1")
                .expect("unreachable");
        }

        // we have no way of knowing what version they're expecting without running the node executable
        // running the node executable is too slow
        // so we will just hardcode it to LTS
        this_transpiler
            .env
            .map
            .put_default(
                b"npm_config_user_agent",
                // the use of npm/? is copying yarn
                // e.g.
                // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
                const_format::concatcp!(
                    "bun/",
                    Global::PACKAGE_JSON_VERSION,
                    " npm/? node/v",
                    Environment::REPORTED_NODEJS_VERSION,
                    " ",
                    Global::OS_NAME,
                    " ",
                    Global::ARCH_NAME
                )
                .as_bytes(),
            )
            .expect("unreachable");

        if this_transpiler.env.get(b"npm_execpath").is_none() {
            // we don't care if this fails
            if let Ok(self_exe_path) = bun_core::self_exe_path() {
                this_transpiler
                    .env
                    .map
                    .put_default(b"npm_execpath", self_exe_path)
                    .expect("unreachable");
            }
        }

        if let Some(package_json) = root_dir_info.enclosing_package_json {
            if !package_json.name.is_empty() {
                if this_transpiler.env.map.get(NpmArgs::PACKAGE_NAME).is_none() {
                    this_transpiler
                        .env
                        .map
                        .put(NpmArgs::PACKAGE_NAME, package_json.name)
                        .expect("unreachable");
                }
            }

            this_transpiler
                .env
                .map
                .put_default(b"npm_package_json", package_json.source.path.text)
                .expect("unreachable");

            if !package_json.version.is_empty() {
                if this_transpiler.env.map.get(NpmArgs::PACKAGE_VERSION).is_none() {
                    this_transpiler
                        .env
                        .map
                        .put(NpmArgs::PACKAGE_VERSION, package_json.version)
                        .expect("unreachable");
                }
            }

            if let Some(config) = &package_json.config {
                this_transpiler.env.map.ensure_unused_capacity(config.count())?;
                debug_assert_eq!(config.keys().len(), config.values().len());
                for (k, v) in config.keys().iter().zip(config.values().iter()) {
                    let key = strings::concat(&[b"npm_package_config_", k])?;
                    this_transpiler.env.map.put_assume_capacity(key, v);
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
        let path = this_transpiler.env.get(b"PATH").unwrap_or(b"");
        if let Some(op) = original_path {
            *op = path;
        }

        let bun_node_exe = Self::bun_node_file_utf8()?;
        let bun_node_dir_win = bun_paths::Dirname::dirname::<u8>(bun_node_exe.as_bytes())
            .ok_or(bun_core::err!("FailedToGetTempPath"))?;
        let found_node = this_transpiler
            .env
            .load_node_js_config(
                this_transpiler.fs,
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
                new_path.extend_from_slice(bun_paths::path_literal!("/node_modules/.bin"));
                new_path.push(DELIMITER);
                remain = &remain[..i as usize];
            }
            // Zig `else` clause runs once after loop ends naturally
            new_path.extend_from_slice(strings::without_trailing_slash(remain));
            new_path.extend_from_slice(bun_paths::path_literal!("/node_modules/.bin"));
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
            if root_dir_info.package_json.is_none() {
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
                                if value.kind(&this_transpiler.fs.fs, true) == bun_fs::EntryKind::File {
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
                            && value.kind(&this_transpiler.fs.fs, true) == bun_fs::EntryKind::File
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
                        if let Some(max_len) = core::str::from_utf8(max)
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

        bun_core::clap::simple_help(&Arguments::RUN_PARAMS);
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
                async_http: unsafe { core::mem::zeroed() },
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
        let tmpdir = bun_fs::FileSystem::RealFS::tmpdir_path();
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
        let _ = sys::unlink(bun_paths::z(path, &mut buf));
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
                if let Some(n) = core::str::from_utf8(env).ok().and_then(|s| s.parse::<u16>().ok()) {
                    if n > 0 {
                        break 'brk n;
                    }
                }
            }
            #[cfg(unix)]
            {
                // SAFETY: all-zero is a valid Winsize (#[repr(C)] POD).
                let mut size: sys::posix::Winsize = unsafe { core::mem::zeroed() };
                // SAFETY: ioctl with valid winsize ptr
                if unsafe {
                    sys::posix::ioctl(
                        sys::posix::STDOUT_FILENO,
                        sys::posix::TIOCGWINSZ,
                        &mut size as *mut _ as usize,
                    )
                } == 0
                {
                    if size.col > 0 {
                        break 'brk size.col;
                    }
                }
            }
            #[cfg(windows)]
            {
                if let Ok(handle) = sys::windows::GetStdHandle(sys::windows::STD_OUTPUT_HANDLE) {
                    // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (#[repr(C)] POD).
                    let mut csbi: sys::windows::CONSOLE_SCREEN_BUFFER_INFO =
                        unsafe { core::mem::zeroed() };
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
            bun_paths::join_abs_string_buf(cwd, &mut base_buf, &[path], bun_paths::Style::Auto)
        };
        let dir = bun_paths::dirname(abs_md_path, bun_paths::Style::Auto);
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
            loader.or_else(|| options::default_loaders().get(bun_paths::extension(path)).copied());
        if let Some(l) = resolved_loader {
            if l == options::Loader::Md {
                Self::render_markdown_file_and_exit(path);
            }
        }
        Global::configure_allocator(&bun_core::AllocatorConfig { long_running: true });
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

        let script_name_to_search = ctx.args.entry_points[0];

        let mut absolute_script_path: Option<Box<[u8]>> = None;

        // TODO: optimize this pass for Windows. we can make better use of system apis available
        let mut file_path = script_name_to_search;
        {
            let opened = 'brk: {
                if bun_paths::is_absolute(script_name_to_search) {
                    let mut win_resolver = resolve_path::PosixToWinNormalizer::default();
                    let mut resolved = win_resolver
                        .resolve_cwd(script_name_to_search)
                        .expect("Could not resolve path");
                    #[cfg(windows)]
                    {
                        resolved =
                            resolve_path::normalize_string(resolved, false, bun_paths::Style::Windows);
                    }
                    break 'brk bun_core::open_file(resolved, bun_core::OpenMode::ReadOnly);
                } else if !script_name_to_search.starts_with(b"..")
                    && script_name_to_search[0] != b'~'
                {
                    let file_path_z = {
                        script_name_buf[..file_path.len()].copy_from_slice(file_path);
                        script_name_buf[file_path.len()] = 0;
                        // SAFETY: NUL written above
                        unsafe { ZStr::from_raw(script_name_buf.as_ptr(), file_path.len()) }
                    };

                    break 'brk bun_core::open_file_z(file_path_z, bun_core::OpenMode::ReadOnly);
                } else {
                    let mut path_buf_2 = PathBuffer::uninit();
                    let Ok(cwd) = bun_core::getcwd(&mut path_buf_2) else { return false };
                    let cwd_len = cwd.len();
                    path_buf_2[cwd_len] = SEP;
                    let parts = [script_name_to_search];
                    file_path = resolve_path::join_abs_string_buf(
                        &path_buf_2[..cwd_len + 1],
                        &mut script_name_buf,
                        &parts,
                        bun_paths::Style::Auto,
                    );
                    if file_path.is_empty() {
                        return false;
                    }
                    let fp_len = file_path.len();
                    script_name_buf[fp_len] = 0;
                    // SAFETY: NUL written above
                    let file_path_z = unsafe { ZStr::from_raw(script_name_buf.as_ptr(), fp_len) };
                    break 'brk bun_core::open_file_z(file_path_z, bun_core::OpenMode::ReadOnly);
                }
            };
            let Ok(std_file) = opened else { return false };
            let Ok(file) = Fd::from_std_file(std_file)
                .make_libuv_owned_for_syscall(sys::Syscall::Open, sys::OnFail::CloseOnFail)
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
                    if sys::S::isdir(u32::try_from(stat.mode).unwrap()) {
                        return false;
                    }
                }
                sys::Result::Err(_) => return false,
            }

            Global::configure_allocator(&bun_core::AllocatorConfig { long_running: true });

            absolute_script_path = 'brk: {
                #[cfg(not(windows))]
                {
                    let Ok(p) = bun_core::get_fd_path(file, &mut script_name_buf) else {
                        return false;
                    };
                    break 'brk Some(Box::from(p));
                }

                #[cfg(windows)]
                {
                    let mut fd_path_buf = PathBuffer::uninit();
                    let Ok(p) = bun_core::get_fd_path(file, &mut fd_path_buf) else {
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
            let default_loader = options::default_loaders().get(ext).copied();
            if default_loader.is_some()
                && (default_loader.unwrap().can_be_run_by_bun()
                    || default_loader.unwrap() == options::Loader::Md)
            {
                try_fast_run = true;
            }
        }

        if !ctx.debug.loaded_bunfig {
            let _ = cli::Arguments::load_config_path(true, b"bunfig.toml", ctx, cli::Command::Tag::RunCommand);
        }

        // try fast run (check if the file exists and is not a folder, then run it)
        if try_fast_run && Self::maybe_open_with_bun_js(ctx) {
            return Ok(true);
        }

        // setup
        let force_using_bun = ctx.debug.run_in_bun;
        let mut original_path: &[u8] = b"";
        // SAFETY: Phase-A placeholder — configure_env_for_run treats this as an out-param and
        // fully initializes it before any field is read. Zig had `var this_transpiler: Transpiler
        // = undefined;`.
        // TODO(port): use MaybeUninit<Transpiler> + configure_env_for_run as out-param init
        let mut this_transpiler: Transpiler = unsafe { core::mem::zeroed() };
        let root_dir_info =
            Self::configure_env_for_run(ctx, &mut this_transpiler, None, log_errors, false)?;
        Self::configure_path_for_run(
            ctx,
            root_dir_info,
            &mut this_transpiler,
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

            const TRIGGER: &[u8] = bun_paths::path_literal!("/[stdin]");
            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + TRIGGER.len()];
            // TODO(port): std.posix.getcwd → bun_sys
            let cwd = sys::getcwd_buf(&mut entry_point_buf[..MAX_PATH_BYTES])?;
            let cwd_len = cwd.len();
            entry_point_buf[cwd_len..cwd_len + TRIGGER.len()].copy_from_slice(TRIGGER);
            let entry_path = &entry_point_buf[..cwd_len + TRIGGER.len()];

            let mut passthrough_list: Vec<&[u8]> = Vec::with_capacity(ctx.passthrough.len() + 1);
            passthrough_list.push(b"-");
            // PERF(port): was assume_capacity
            passthrough_list.extend_from_slice(ctx.passthrough);
            ctx.passthrough = passthrough_list.into_boxed_slice();
            // TODO(port): ctx mutability

            let dup: Box<[u8]> = entry_path.to_vec().into_boxed_slice();
            if let Err(err) = bun_bun_js::Run::boot(ctx, dup, None) {
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
                        Global::configure_allocator(&bun_core::AllocatorConfig { long_running: false });
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
                            strings::without_suffix(package_json_path, b"package.json"),
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
                    bun_resolver::Kind::EntryPointRun,
                )
                .or_else(|_| {
                    let joined: Vec<u8> = [b"./".as_slice(), target_name].concat();
                    this_transpiler.resolver.resolve(
                        this_transpiler.fs.top_level_dir,
                        &joined,
                        bun_resolver::Kind::EntryPointRun,
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
                    .or_else(|| options::default_loaders().get(path.name.ext).copied())
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
                let _ = 'try_bunx_file;
                // TODO(port): labeled-block control flow reshaped into closure for borrowck
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
                        unsafe { core::mem::transmute::<&ZStr, &'static ZStr>(d) }
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
            && cli::Cli::cmd().is_some()
            && cli::Cli::cmd().unwrap() == cli::Command::Tag::AutoCommand
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
                let default_loader = options::default_loaders().get(ext).copied();
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
            const TRIGGER: &[u8] = bun_paths::path_literal!("/[eval]");
            let mut entry_point_buf = [0u8; MAX_PATH_BYTES + TRIGGER.len()];
            // TODO(port): std.posix.getcwd → bun_sys
            let cwd = sys::getcwd_buf(&mut entry_point_buf[..MAX_PATH_BYTES])?;
            let cwd_len = cwd.len();
            entry_point_buf[cwd_len..cwd_len + TRIGGER.len()].copy_from_slice(TRIGGER);
            bun_bun_js::Run::boot(ctx, &entry_point_buf[..cwd_len + TRIGGER.len()], None)?;
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
                    let r = resolve_path::join_abs_string_buf(
                        &path_buf[..cwd_len + 1],
                        path_buf2,
                        &parts,
                        bun_paths::Style::Loose,
                    );
                    // SAFETY: result borrows thread-local PATH_BUF2 which lives for process lifetime
                    Ok(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(r) })
                })
            })?
        };

        if let Err(err) = bun_bun_js::Run::boot(ctx, normalized_filename, None) {
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

    fn bun_feedback(ctx: &Command::Context) -> Result<core::convert::Infallible, bun_core::Error> {
        const TRIGGER: &[u8] = bun_paths::path_literal!("/[eval]");
        let mut entry_point_buf = [0u8; MAX_PATH_BYTES + TRIGGER.len()];
        // TODO(port): std.posix.getcwd → bun_sys
        let cwd = sys::getcwd_buf(&mut entry_point_buf[..MAX_PATH_BYTES])?;
        let cwd_len = cwd.len();
        entry_point_buf[cwd_len..cwd_len + TRIGGER.len()].copy_from_slice(TRIGGER);
        ctx.runtime_options.eval.script = if Environment::CODEGEN_EMBED {
            // TODO(port): @embedFile → include_bytes!
            include_bytes!("eval/feedback.ts")
        } else {
            bun_core::runtime_embed_file(bun_core::EmbedKind::Codegen, "eval/feedback.ts")
        };
        // TODO(port): ctx mutability
        bun_bun_js::Run::boot(ctx, &entry_point_buf[..cwd_len + TRIGGER.len()], None)?;
        Global::exit(0);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
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

type DoneChannel = Channel<u32, 256>;
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

pub struct BunXFastPath;

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

            bun_install::windows_shim::bun_shim_impl::try_startup_from_bun_js(run_ctx);

            bun_output::scoped_log!(BunXFastPath, "did not start via shim");
        });
    }

    fn direct_launch_callback(wpath: &[u16], ctx: &Command::Context) {
        Self::DIRECT_LAUNCH_BUFFER.with_borrow_mut(|direct_launch_buffer| {
            let utf8 = match strings::convert_utf16_to_utf8_in_buffer(
                bun_core::reinterpret_slice::<u8>(direct_launch_buffer),
                wpath,
            ) {
                Ok(u) => u,
                Err(_) => return,
            };
            if let Err(err) = bun_bun_js::Run::boot(ctx, utf8, None) {
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

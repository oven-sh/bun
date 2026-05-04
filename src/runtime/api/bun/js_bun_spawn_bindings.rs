use core::ffi::{c_char, CStr};
use std::io::Write as _;

use bun_collections::BabyList;
use bun_core::{fmt as bun_fmt, Output, SignalCode, StackCheck};
use bun_io::MaxBuf;
use bun_jsc::{
    self as jsc, CallFrame, EventLoop, EventLoopHandle, JSGlobalObject, JSObject,
    JSPropertyIterator, JSValue, JsError, JsResult, Subprocess, SystemError, WebCore, ZigString,
};
use bun_jsc::ipc as IPC;
use bun_jsc::Subprocess::{Readable, Writable};
use bun_paths::PathBuffer;
use bun_spawn::{self as spawn, Process, Rusage, SpawnOptions, Stdio};
use bun_str::{self as strings_mod, strings, String as BunString, ZStr};
use bun_sys::{self as sys, Fd};

use crate::api::bun::terminal::Terminal;

bun_output::declare_scope!(Subprocess, hidden);

// TODO(port): move to runtime_sys
unsafe extern "C" {
    static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char;
}

struct Argv0Result {
    argv0: Box<ZStr>, // TODO(port): lifetime — was arena-owned [:0]const u8; caller must keep alive past spawn_process
    arg0: Box<ZStr>,  // TODO(port): lifetime — was arena-owned [:0]u8; caller must keep alive past spawn_process
}

// This is split into a separate function to conserve stack space.
// On Windows, a single path buffer can take 64 KB.
fn get_argv0(
    global_this: &JSGlobalObject,
    path: &[u8],
    cwd: &[u8],
    pretend_argv0: Option<&CStr>,
    first_cmd: JSValue,
) -> JsResult<Argv0Result> {
    let arg0 = first_cmd.to_slice_or_null_with_allocator(global_this)?;
    // `arg0` drops at scope exit (was `defer arg0.deinit()`).

    // Check for null bytes in command (security: prevent null byte injection)
    if strings::index_of_char(arg0.slice(), 0).is_some() {
        return global_this
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "The argument 'args[0]' must be a string without null bytes. Received {}",
                    bun_fmt::quote(arg0.slice())
                ),
            )
            .throw();
    }
    // Heap allocate it to ensure we don't run out of stack space.
    let path_buf: Box<PathBuffer> = Box::new(PathBuffer::uninit());
    // drops at scope exit (was `defer bun.default_allocator.destroy(path_buf)`).

    let actual_argv0: Box<ZStr>;

    let argv0_to_use: &[u8] = arg0.slice();

    // This mimicks libuv's behavior, which mimicks execvpe
    // Only resolve from $PATH when the command is not an absolute path
    let path_to_use: &[u8] = if strings::index_of_char(argv0_to_use, b'/').is_some() {
        b""
        // If no $PATH is provided, we fallback to the one from environ
        // This is already the behavior of the PATH passed in here.
    } else if !path.is_empty() {
        path
    } else if cfg!(unix) {
        // If the user explicitly passed an empty $PATH, we fallback to the OS-specific default (which libuv also does)
        // SAFETY: BUN_DEFAULT_PATH_FOR_SPAWN is a NUL-terminated static C string.
        unsafe { CStr::from_ptr(BUN_DEFAULT_PATH_FOR_SPAWN) }.to_bytes()
    } else {
        b""
    };

    if path_to_use.is_empty() {
        actual_argv0 = ZStr::from_bytes(argv0_to_use);
    } else {
        let Some(resolved) = bun_core::which(&path_buf, path_to_use, cwd, argv0_to_use) else {
            return throw_command_not_found(global_this, argv0_to_use);
        };
        actual_argv0 = ZStr::from_bytes(resolved);
    }

    Ok(Argv0Result {
        argv0: actual_argv0,
        arg0: if let Some(p) = pretend_argv0 {
            ZStr::from_bytes(p.to_bytes())
        } else {
            ZStr::from_bytes(arg0.slice())
        },
    })
}

/// `argv` for `Bun.spawn` & `Bun.spawnSync`
fn get_argv(
    global_this: &JSGlobalObject,
    args: JSValue,
    path: &[u8],
    cwd: &[u8],
    argv0: &mut Option<*const c_char>,
    argv: &mut Vec<Option<*const c_char>>,
) -> JsResult<()> {
    if args.is_empty_or_undefined_or_null() {
        return global_this.throw_invalid_arguments("cmd must be an array of strings", format_args!(""));
    }

    let mut cmds_array = args.array_iterator(global_this)?;

    if cmds_array.len == 0 {
        return global_this.throw_invalid_arguments("cmd must not be empty", format_args!(""));
    }

    if cmds_array.len > u32::MAX - 2 {
        return global_this.throw_invalid_arguments("cmd array is too large", format_args!(""));
    }

    // + 1 for argv0
    // + 1 for null terminator
    *argv = Vec::with_capacity(cmds_array.len as usize + 2);

    let argv0_result = get_argv0(
        global_this,
        path,
        cwd,
        // SAFETY: argv0 was produced by to_owned_slice_z above; NUL-terminated and outlives this call.
        argv0.map(|p| unsafe { CStr::from_ptr(p) }),
        cmds_array.next()?.unwrap(),
    )?;

    *argv0 = Some(argv0_result.argv0.as_ptr() as *const c_char);
    argv.push(Some(argv0_result.arg0.as_ptr() as *const c_char));
    // TODO(port): lifetime — argv0_result.{argv0,arg0} are owned Box<ZStr> and drop at end of this
    // fn. Phase B: collect into a backing Vec<Box<ZStr>> in the caller that lives past spawn_process.

    let mut arg_index: usize = 1;
    while let Some(value) = cmds_array.next()? {
        let arg = value.to_bun_string(global_this)?;
        // `arg` derefs on drop (was `defer arg.deref()`).

        // Check for null bytes in argument (security: prevent null byte injection)
        if arg.index_of_ascii_char(0).is_some() {
            return global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'args[{}]' must be a string without null bytes. Received \"{}\"",
                        arg_index,
                        arg.to_zig_string()
                    ),
                )
                .throw();
        }

        // TODO(port): lifetime — owned Box<ZStr> dropped at end of loop body; Phase B: collect into backing Vec.
        argv.push(Some(arg.to_owned_slice_z()?));
        arg_index += 1;
    }

    if argv.is_empty() {
        return global_this.throw_invalid_arguments("cmd must be an array of strings", format_args!(""));
    }
    Ok(())
}

/// Bun.spawn() calls this.
pub fn spawn(
    global_this: &JSGlobalObject,
    args: JSValue,
    secondary_args_value: Option<JSValue>,
) -> JsResult<JSValue> {
    spawn_maybe_sync::<false>(global_this, args, secondary_args_value)
}

/// Bun.spawnSync() calls this.
pub fn spawn_sync(
    global_this: &JSGlobalObject,
    args: JSValue,
    secondary_args_value: Option<JSValue>,
) -> JsResult<JSValue> {
    spawn_maybe_sync::<true>(global_this, args, secondary_args_value)
}

pub fn spawn_maybe_sync<const IS_SYNC: bool>(
    global_this: &JSGlobalObject,
    args_: JSValue,
    secondary_args_value: Option<JSValue>,
) -> JsResult<JSValue> {
    if IS_SYNC {
        // We skip this on Windows due to test failures.
        #[cfg(not(windows))]
        {
            // Since the event loop is recursively called, we need to check if it's safe to recurse.
            if !StackCheck::init().is_safe_to_recurse() {
                return global_this.throw_stack_overflow();
            }
        }
    }

    // PERF(port): was arena bulk-free — argv/env strings allocated per-iteration; profile in Phase B.
    // TODO(port): lifetime — argv/env_array hold *const c_char into owned Box<ZStr>s; collect those
    // into a backing `Vec<Box<ZStr>>` here that lives past spawn_process (Zig used a bump arena).

    let mut override_env = false;
    let mut env_array: Vec<Option<*const c_char>> = Vec::new();
    let jsc_vm = global_this.bun_vm();

    let mut cwd: &[u8] = jsc_vm.transpiler.fs.top_level_dir;

    let mut stdio: [Stdio; 3] = [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit];

    if IS_SYNC {
        stdio[1] = Stdio::Pipe;
        stdio[2] = Stdio::Pipe;
    }
    let mut lazy = false;
    let mut on_exit_callback = JSValue::ZERO;
    let mut on_disconnect_callback = JSValue::ZERO;
    let mut path: &[u8] = jsc_vm.transpiler.env.get(b"PATH").unwrap_or(b"");
    let mut argv: Vec<Option<*const c_char>> = Vec::new();
    let mut cmd_value = JSValue::ZERO;
    let mut detached = false;
    let mut args = args_;
    // TODO(port): Zig used `if (is_sync) void else ?IPC.Mode`; Rust const-generic bool
    // can't gate field type. Always Option<IPC::Mode>; IS_SYNC branches never read it.
    let mut maybe_ipc_mode: Option<IPC::Mode> = None;
    let mut ipc_callback: JSValue = JSValue::ZERO;
    let mut extra_fds: Vec<spawn::SpawnOptions::Stdio> = Vec::new();
    let mut argv0: Option<*const c_char> = None;
    let mut ipc_channel: i32 = -1;
    let mut timeout: Option<i32> = None;
    let mut kill_signal: SignalCode = SignalCode::default();
    let mut max_buffer: Option<i64> = None;

    let mut windows_hide: bool = false;
    let mut windows_verbatim_arguments: bool = false;
    let mut abort_signal: Option<*mut WebCore::AbortSignal> = None;
    let mut terminal_info: Option<Terminal::CreateResult> = None;
    let mut existing_terminal: Option<*mut Terminal> = None; // Existing terminal passed by user
    let mut terminal_js_value: JSValue = JSValue::ZERO;
    // TODO(port): the Zig `defer` block at function end (abort_signal.unref + terminal cleanup)
    // is implemented via scopeguard below; disarmed where the Zig set the locals to null.
    let mut defer_guard = scopeguard::guard(
        (&mut abort_signal, &mut terminal_info),
        |(abort_signal, terminal_info)| {
            if let Some(signal) = abort_signal.take() {
                // SAFETY: signal was ref()'d when stored; unref releases that ref.
                unsafe { (*signal).unref() };
            }
            // If we created a new terminal but spawn failed, close it. The
            // writer/reader/finalize deref paths release the remaining refs.
            // Downgrade the JSRef so the wrapper is GC-eligible, and mark
            // finalized so onReaderDone skips the JS exit callback — the user
            // never received this terminal (spawn threw).
            if let Some(info) = terminal_info.take() {
                info.terminal.this_value.downgrade();
                info.terminal.flags.finalized = true;
                info.terminal.close_internal();
            }
        },
    );
    // PORT NOTE: reshaped for borrowck — re-borrow through the guard tuple.
    let (abort_signal, terminal_info) = &mut *defer_guard;

    {
        if args.is_empty_or_undefined_or_null() {
            return global_this.throw_invalid_arguments("cmd must be an array", format_args!(""));
        }

        let args_type = args.js_type();
        if args_type.is_array() {
            cmd_value = args;
            args = secondary_args_value.unwrap_or(JSValue::ZERO);
        } else if !args.is_object() {
            return global_this.throw_invalid_arguments("cmd must be an array", format_args!(""));
        } else if let Some(cmd_value_) = args.get_truthy(global_this, "cmd")? {
            cmd_value = cmd_value_;
        } else {
            return global_this.throw_invalid_arguments("cmd must be an array", format_args!(""));
        }

        if args.is_object() {
            if let Some(argv0_) = args.get_truthy(global_this, "argv0")? {
                let argv0_str = argv0_.get_zig_string(global_this)?;
                if argv0_str.len > 0 {
                    // TODO(port): lifetime — owned Box<ZStr>; Phase B: stash in backing Vec.
                    argv0 = Some(argv0_str.to_owned_slice_z()?);
                }
            }

            // need to update `cwd` before searching for executable with `Which.which`
            if let Some(cwd_) = args.get_truthy(global_this, "cwd")? {
                let cwd_str = cwd_.get_zig_string(global_this)?;
                if cwd_str.len > 0 {
                    // TODO(port): lifetime — owned Box<ZStr>; Phase B: stash in backing Vec.
                    cwd = cwd_str.to_owned_slice_z()?;
                    // TODO(port): cwd is &[u8] but to_owned_slice_z returns ZStr; .as_bytes() needed
                }
            }
        }

        if !args.is_empty() && args.is_object() {
            // Reject terminal option on spawnSync
            if IS_SYNC {
                if args.get_truthy(global_this, "terminal")?.is_some() {
                    return global_this.throw_invalid_arguments(
                        "terminal option is only supported for Bun.spawn, not Bun.spawnSync",
                        format_args!(""),
                    );
                }
            }

            // This must run before the stdio parsing happens
            if !IS_SYNC {
                if let Some(val) = args.get_truthy(global_this, "ipc")? {
                    if val.is_cell() && val.is_callable() {
                        maybe_ipc_mode = Some('ipc_mode: {
                            if let Some(mode_val) = args.get_truthy(global_this, "serialization")? {
                                if mode_val.is_string() {
                                    break 'ipc_mode match IPC::Mode::from_js(global_this, mode_val)? {
                                        Some(m) => m,
                                        None => {
                                            return global_this.throw_invalid_arguments(
                                                "serialization must be \"json\" or \"advanced\"",
                                                format_args!(""),
                                            );
                                        }
                                    };
                                } else {
                                    if !global_this.has_exception() {
                                        return global_this.throw_invalid_argument_type(
                                            "spawn",
                                            "serialization",
                                            "string",
                                        );
                                    }
                                    return Ok(JSValue::ZERO);
                                }
                            }
                            break 'ipc_mode IPC::Mode::Advanced;
                        });

                        ipc_callback = val.with_async_context_if_needed(global_this);
                    }
                }
            }

            if let Some(signal_val) = args.get_truthy(global_this, "signal")? {
                if let Some(signal) = signal_val.as_::<WebCore::AbortSignal>() {
                    **abort_signal = Some(signal.ref_());
                } else {
                    return global_this.throw_invalid_argument_type_value(
                        "signal",
                        "AbortSignal",
                        signal_val,
                    );
                }
            }

            if let Some(on_disconnect_) = args.get_truthy(global_this, "onDisconnect")? {
                if !on_disconnect_.is_cell() || !on_disconnect_.is_callable() {
                    return global_this.throw_invalid_arguments(
                        "onDisconnect must be a function or undefined",
                        format_args!(""),
                    );
                }

                on_disconnect_callback = if IS_SYNC {
                    on_disconnect_
                } else {
                    on_disconnect_.with_async_context_if_needed(global_this)
                };
            }

            if let Some(on_exit_) = args.get_truthy(global_this, "onExit")? {
                if !on_exit_.is_cell() || !on_exit_.is_callable() {
                    return global_this.throw_invalid_arguments(
                        "onExit must be a function or undefined",
                        format_args!(""),
                    );
                }

                on_exit_callback = if IS_SYNC {
                    on_exit_
                } else {
                    on_exit_.with_async_context_if_needed(global_this)
                };
            }

            if let Some(env_arg) = args.get_truthy(global_this, "env")? {
                env_arg.ensure_still_alive();
                let Some(object) = env_arg.get_object() else {
                    return global_this
                        .throw_invalid_arguments("env must be an object", format_args!(""));
                };

                override_env = true;
                // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                let mut new_path: &[u8] = b"";
                append_envp_from_js(global_this, object, &mut env_array, &mut new_path)?;
                path = new_path;
            }

            get_argv(global_this, cmd_value, path, cwd, &mut argv0, &mut argv)?;

            if let Some(stdio_val) = args.get(global_this, "stdio")? {
                if !stdio_val.is_empty_or_undefined_or_null() {
                    if stdio_val.js_type().is_array() {
                        let mut stdio_iter = stdio_val.array_iterator(global_this)?;
                        let mut i: u32 = 0;
                        while let Some(value) = stdio_iter.next()? {
                            stdio[i as usize].extract(global_this, i, value, IS_SYNC)?;
                            if i == 2 {
                                break;
                            }
                            i += 1;
                        }
                        i += 1;

                        while let Some(value) = stdio_iter.next()? {
                            // extract() leaves `out_stdio` untouched when `value` is undefined, so this
                            // must be initialized to a sane default instead of `undefined`.
                            let mut new_item: Stdio = Stdio::Ignore;
                            new_item.extract(global_this, i, value, IS_SYNC)?;

                            let opt = match new_item.as_spawn_option(i) {
                                spawn::StdioResult::Result(opt) => opt,
                                spawn::StdioResult::Err(e) => {
                                    return e.throw_js(global_this);
                                }
                            };
                            if matches!(opt, spawn::SpawnOptions::Stdio::Ipc) {
                                ipc_channel = i32::try_from(extra_fds.len()).unwrap();
                            }
                            extra_fds.push(opt);
                            i += 1;
                        }
                    } else {
                        return global_this
                            .throw_invalid_arguments("stdio must be an array", format_args!(""));
                    }
                }
            } else {
                if let Some(value) = args.get(global_this, "stdin")? {
                    stdio[0].extract(global_this, 0, value, IS_SYNC)?;
                }

                if let Some(value) = args.get(global_this, "stderr")? {
                    stdio[2].extract(global_this, 2, value, IS_SYNC)?;
                }

                if let Some(value) = args.get(global_this, "stdout")? {
                    stdio[1].extract(global_this, 1, value, IS_SYNC)?;
                }
            }

            if !IS_SYNC {
                if let Some(lazy_val) = args.get(global_this, "lazy")? {
                    if lazy_val.is_boolean() {
                        lazy = lazy_val.to_boolean();
                    }
                }
            }

            if let Some(detached_val) = args.get(global_this, "detached")? {
                if detached_val.is_boolean() {
                    detached = detached_val.to_boolean();
                }
            }

            #[cfg(windows)]
            {
                if let Some(val) = args.get(global_this, "windowsHide")? {
                    if val.is_boolean() {
                        windows_hide = val.as_boolean();
                    }
                }

                if let Some(val) = args.get(global_this, "windowsVerbatimArguments")? {
                    if val.is_boolean() {
                        windows_verbatim_arguments = val.as_boolean();
                    }
                }
            }

            if let Some(timeout_value) = args.get(global_this, "timeout")? {
                'brk: {
                    if timeout_value != JSValue::NULL {
                        if timeout_value.is_number() && timeout_value.as_number().is_infinite() && timeout_value.as_number() > 0.0 {
                            break 'brk;
                        }

                        let timeout_int = global_this.validate_integer_range::<u64>(
                            timeout_value,
                            0,
                            jsc::IntegerRangeOptions { min: 0, field_name: "timeout" },
                        )?;
                        if timeout_int > 0 {
                            timeout = Some(i32::try_from((timeout_int as u32) & 0x7FFF_FFFF).unwrap());
                            // PORT NOTE: Zig `@intCast(@as(u31, @truncate(timeout_int)))` — truncate to u31 then widen to i32.
                        }
                    }
                }
            }

            if let Some(val) = args.get(global_this, "killSignal")? {
                kill_signal = SignalCode::from_js(val, global_this)?;
            }

            if let Some(val) = args.get(global_this, "maxBuffer")? {
                if val.is_number() && val.is_finite() {
                    // 'Infinity' does not set maxBuffer
                    let value = val.coerce::<i64>(global_this)?;
                    if value > 0 && (stdio[0].is_piped() || stdio[1].is_piped() || stdio[2].is_piped()) {
                        max_buffer = Some(value);
                    }
                }
            }

            if !IS_SYNC {
                if let Some(terminal_val) = args.get_truthy(global_this, "terminal")? {
                    // Check if it's an existing Terminal object
                    if let Some(terminal) = Terminal::from_js(terminal_val) {
                        if terminal.flags.closed {
                            return global_this
                                .throw_invalid_arguments("terminal is closed", format_args!(""));
                        }
                        if terminal.flags.inline_spawned {
                            return global_this.throw_invalid_arguments(
                                "terminal was created inline by a previous spawn and cannot be reused",
                                format_args!(""),
                            );
                        }
                        #[cfg(unix)]
                        {
                            if terminal.slave_fd == Fd::INVALID {
                                return global_this.throw_invalid_arguments(
                                    "terminal slave fd is no longer valid",
                                    format_args!(""),
                                );
                            }
                        }
                        #[cfg(not(unix))]
                        if terminal.get_pseudoconsole().is_none() {
                            return global_this.throw_invalid_arguments(
                                "terminal pseudoconsole is no longer valid",
                                format_args!(""),
                            );
                        }
                        existing_terminal = Some(terminal);
                        terminal_js_value = terminal_val;
                    } else if terminal_val.is_object() {
                        // Create a new terminal from options
                        let mut term_options = Terminal::Options::parse_from_js(global_this, terminal_val)?;
                        **terminal_info = Some(match Terminal::create_from_spawn(global_this, &mut term_options) {
                            Ok(v) => v,
                            Err(err) => {
                                drop(term_options);
                                // TODO(port): narrow error set — Zig matched error.{OpenPtyFailed,DupFailed,NotSupported,WriterStartFailed,ReaderStartFailed}
                                return match err {
                                    e if e == bun_core::err!("OpenPtyFailed") => {
                                        global_this.throw("Failed to open PTY", format_args!(""))
                                    }
                                    e if e == bun_core::err!("DupFailed") => global_this
                                        .throw("Failed to duplicate PTY file descriptor", format_args!("")),
                                    e if e == bun_core::err!("NotSupported") => global_this
                                        .throw("PTY not supported on this platform", format_args!("")),
                                    e if e == bun_core::err!("WriterStartFailed") => global_this
                                        .throw("Failed to start terminal writer", format_args!("")),
                                    e if e == bun_core::err!("ReaderStartFailed") => global_this
                                        .throw("Failed to start terminal reader", format_args!("")),
                                    _ => unreachable!(),
                                };
                            }
                        });
                    } else {
                        return global_this.throw_invalid_arguments(
                            "terminal must be a Terminal object or options object",
                            format_args!(""),
                        );
                    }

                    #[cfg(unix)]
                    {
                        let terminal = existing_terminal
                            // SAFETY: existing_terminal points to a live Terminal (JS-owned, ref'd via terminal_js_value).
                            .map(|p| unsafe { &*p })
                            .unwrap_or_else(|| terminal_info.as_ref().unwrap().terminal);
                        let slave_fd = terminal.get_slave_fd();
                        stdio[0] = Stdio::Fd(slave_fd);
                        stdio[1] = Stdio::Fd(slave_fd);
                        stdio[2] = Stdio::Fd(slave_fd);
                    }
                    #[cfg(not(unix))]
                    {
                        // On Windows, ConPTY supplies stdio via PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE.
                        // Set stdio to .ignore so spawnProcessWindows doesn't allocate pipes.
                        stdio[0] = Stdio::Ignore;
                        stdio[1] = Stdio::Ignore;
                        stdio[2] = Stdio::Ignore;
                        // ConPTY spawns with bInheritHandles=FALSE and no stdio buffer,
                        // so extra fds and IPC pipes can't be passed to the child.
                        if maybe_ipc_mode.is_some() || !extra_fds.is_empty() {
                            return global_this.throw_invalid_arguments(
                                "ipc and extra stdio are not supported with terminal on Windows",
                                format_args!(""),
                            );
                        }
                    }
                }
            }
        } else {
            get_argv(global_this, cmd_value, path, cwd, &mut argv0, &mut argv)?;
        }
    }

    bun_output::scoped_log!(Subprocess, "spawn maxBuffer: {:?}", max_buffer);

    if !override_env && env_array.is_empty() {
        match jsc_vm.transpiler.env.map.create_null_delimited_env_map() {
            Ok(items) => {
                env_array = items;
            }
            Err(err) => {
                let _ = global_this.throw_error(err, "in Bun.spawn");
                return Ok(JSValue::ZERO);
            }
        }
    }

    // PORT NOTE: Zig `inline for (0..stdio.len)` — unrolled here as a regular for; const N=3.
    for fd_index in 0..stdio.len() {
        if stdio[fd_index].can_use_memfd(IS_SYNC, fd_index > 0 && max_buffer.is_some()) {
            if stdio[fd_index].use_memfd(fd_index) {
                jsc_vm.counters.mark(jsc::Counter::SpawnMemfd);
            }
        }
    }
    let mut should_close_memfd = cfg!(target_os = "linux");

    let mut memfd_guard = scopeguard::guard(
        (&mut should_close_memfd, &mut stdio),
        |(should_close_memfd, stdio)| {
            if **should_close_memfd {
                for fd_index in 0..stdio.len() {
                    if let Stdio::Memfd(fd) = stdio[fd_index] {
                        fd.close();
                        stdio[fd_index] = Stdio::Ignore;
                    }
                }
            }
        },
    );
    // PORT NOTE: reshaped for borrowck — re-borrow through the guard tuple so the guard
    // stays armed (runs on every early return) until disarmed by `**should_close_memfd = false` below.
    // TODO(port): errdefer — if borrowck rejects the double-&mut reborrow at later use sites,
    // Phase B may need to move stdio into the guard by value and reborrow via DerefMut.
    let (should_close_memfd, stdio) = &mut *memfd_guard;

    // "NODE_CHANNEL_FD=" is 16 bytes long, 15 bytes for the number, and 1 byte for the null terminator should be enough/safe
    let mut ipc_env_buf: [u8; 32] = [0; 32];
    if !IS_SYNC {
        if let Some(ipc_mode) = maybe_ipc_mode {
            // IPC is currently implemented in a very limited way.
            //
            // Node lets you pass as many fds as you want, they all become be sockets; then, IPC is just a special
            // runtime-owned version of "pipe" (in which pipe is a misleading name since they're bidirectional sockets).
            //
            // Bun currently only supports three fds: stdin, stdout, and stderr, which are all unidirectional
            //
            // And then one fd is assigned specifically and only for IPC. If the user dont specify it, we add one (default: 3).
            //
            // When Bun.spawn() is given an `.ipc` callback, it enables IPC as follows:
            if let Err(err) = env_array.try_reserve(3) {
                let _ = global_this.throw_error(err.into(), "in Bun.spawn");
                return Ok(JSValue::ZERO);
            }
            let ipc_fd: i32 = 'brk: {
                if ipc_channel == -1 {
                    // If the user didn't specify an IPC channel, we need to add one
                    ipc_channel = i32::try_from(extra_fds.len()).unwrap();
                    let mut ipc_extra_fd_default = Stdio::Ipc;
                    let fd: i32 = ipc_channel + 3;
                    match ipc_extra_fd_default.as_spawn_option(fd) {
                        spawn::StdioResult::Result(opt) => {
                            extra_fds.push(opt);
                        }
                        spawn::StdioResult::Err(e) => {
                            return e.throw_js(global_this);
                        }
                    }
                    break 'brk fd;
                } else {
                    break 'brk i32::try_from(ipc_channel + 3).unwrap();
                }
            };

            let pipe_env = {
                let mut cursor = &mut ipc_env_buf[..];
                match write!(cursor, "NODE_CHANNEL_FD={}\0", ipc_fd) {
                    Ok(()) => {
                        let written = 32 - cursor.len();
                        // SAFETY: NUL written above at buf[written-1]
                        unsafe { ZStr::from_raw(ipc_env_buf.as_ptr(), written - 1) }
                    }
                    Err(_) => return global_this.throw_out_of_memory(),
                }
            };
            // PERF(port): was assume_capacity
            env_array.push(Some(pipe_env.as_ptr() as *const c_char));

            // PERF(port): was assume_capacity
            env_array.push(Some(match ipc_mode {
                // PORT NOTE: Zig `inline else => |t| "..." ++ @tagName(t)` — written out per variant.
                IPC::Mode::Json => b"NODE_CHANNEL_SERIALIZATION_MODE=json\0".as_ptr() as *const c_char,
                IPC::Mode::Advanced => {
                    b"NODE_CHANNEL_SERIALIZATION_MODE=advanced\0".as_ptr() as *const c_char
                }
            }));
        }
    }

    env_array.push(None);
    argv.push(None);

    if IS_SYNC {
        for (i, io) in stdio.iter_mut().enumerate() {
            io.to_sync(i as u8);
        }
    }

    // If the whole thread is supposed to do absolutely nothing while waiting,
    // we can block the thread which reduces CPU usage.
    //
    // That means:
    // - No maximum buffer
    // - No timeout
    // - No abort signal
    // - No stdin, stdout, stderr pipes
    // - No extra fds
    // - No auto killer (for tests)
    // - No execution time limit (for tests)
    // - No IPC
    // - No inspector (since they might want to press pause or step)
    let can_block_entire_thread_to_reduce_cpu_usage_in_fast_path = (cfg!(unix) && IS_SYNC)
        && abort_signal.is_none()
        && timeout.is_none()
        && max_buffer.is_none()
        && !stdio[0].is_piped()
        && !stdio[1].is_piped()
        && !stdio[2].is_piped()
        && extra_fds.is_empty()
        && !jsc_vm.auto_killer.enabled
        && !jsc_vm.jsc_vm.has_execution_time_limit()
        && !jsc_vm.is_inspector_enabled()
        && !bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH.get();

    // For spawnSync, use an isolated event loop to prevent JavaScript timers from firing
    // and to avoid interfering with the main event loop
    let event_loop: &EventLoop = if IS_SYNC {
        &jsc_vm.rare_data().spawn_sync_event_loop(jsc_vm).event_loop
    } else {
        jsc_vm.event_loop()
    };

    if IS_SYNC {
        jsc_vm.rare_data().spawn_sync_event_loop(jsc_vm).prepare(jsc_vm);
    }

    let _sync_loop_cleanup = scopeguard::guard((), |_| {
        if IS_SYNC {
            jsc_vm
                .rare_data()
                .spawn_sync_event_loop(jsc_vm)
                .cleanup(jsc_vm, jsc_vm.event_loop());
        }
    });

    let loop_handle = EventLoopHandle::init(event_loop);

    let spawn_options = SpawnOptions {
        cwd,
        detached,
        stdin: match stdio[0].as_spawn_option(0) {
            spawn::StdioResult::Result(opt) => opt,
            spawn::StdioResult::Err(e) => return e.throw_js(global_this),
        },
        stdout: match stdio[1].as_spawn_option(1) {
            spawn::StdioResult::Result(opt) => opt,
            spawn::StdioResult::Err(e) => return e.throw_js(global_this),
        },
        stderr: match stdio[2].as_spawn_option(2) {
            spawn::StdioResult::Result(opt) => opt,
            spawn::StdioResult::Err(e) => return e.throw_js(global_this),
        },
        extra_fds: &extra_fds,
        argv0,
        can_block_entire_thread_to_reduce_cpu_usage_in_fast_path,
        // Only pass pty_slave_fd for newly created terminals (for setsid+TIOCSCTTY setup).
        // For existing terminals, the session is already set up - child just uses the fd as stdio.
        #[cfg(unix)]
        pty_slave_fd: 'blk: {
            if let Some(ti) = terminal_info.as_ref() {
                break 'blk ti.terminal.get_slave_fd().native();
            }
            break 'blk -1;
        },
        #[cfg(windows)]
        pseudoconsole: 'blk: {
            if let Some(t) = existing_terminal {
                // SAFETY: existing_terminal points to a live Terminal (JS-owned, ref'd via terminal_js_value).
                break 'blk unsafe { (*t).get_pseudoconsole() };
            }
            if let Some(ti) = terminal_info.as_ref() {
                break 'blk ti.terminal.get_pseudoconsole();
            }
            break 'blk None;
        },

        #[cfg(windows)]
        windows: spawn::WindowsOptions {
            hide_window: windows_hide,
            verbatim_arguments: windows_verbatim_arguments,
            loop_: loop_handle,
        },
        ..Default::default()
    };

    let mut spawned = match spawn::spawn_process(
        &spawn_options,
        argv.as_ptr() as *const *const c_char,
        env_array.as_ptr() as *const *const c_char,
    ) {
        Err(err) if err == bun_core::err!("EMFILE") || err == bun_core::err!("ENFILE") => {
            drop(spawn_options);
            let display_path: &ZStr = if !argv.is_empty() && argv[0].is_some() {
                // SAFETY: argv[0] is a NUL-terminated string we built above.
                unsafe { ZStr::from_ptr(argv[0].unwrap() as *const u8) }
            } else {
                ZStr::EMPTY
            };
            let mut systemerror = sys::Error::from_code(
                if err == bun_core::err!("EMFILE") { sys::Errno::MFILE } else { sys::Errno::NFILE },
                sys::Tag::PosixSpawn,
            )
            .with_path(display_path)
            .to_system_error();
            systemerror.errno = if err == bun_core::err!("EMFILE") {
                -sys::UV_E::MFILE
            } else {
                -sys::UV_E::NFILE
            };
            return global_this.throw_value(systemerror.to_error_instance(global_this));
        }
        Err(err) => {
            drop(spawn_options);
            let _ = global_this.throw_error(err, ": failed to spawn process");
            return Ok(JSValue::ZERO);
        }
        Ok(maybe) => match maybe {
            sys::Result::Err(err) => {
                drop(spawn_options);
                match err.get_errno() {
                    errno @ (sys::Errno::ACCES
                    | sys::Errno::NOENT
                    | sys::Errno::PERM
                    | sys::Errno::ISDIR
                    | sys::Errno::NOTDIR) => {
                        let display_path: &ZStr = if !argv.is_empty() && argv[0].is_some() {
                            // SAFETY: argv[0] is a NUL-terminated string we built above.
                            unsafe { ZStr::from_ptr(argv[0].unwrap() as *const u8) }
                        } else {
                            ZStr::EMPTY
                        };
                        if !display_path.as_bytes().is_empty() {
                            let mut systemerror = err.with_path(display_path).to_system_error();
                            if errno == sys::Errno::NOENT {
                                systemerror.errno = -sys::UV_E::NOENT;
                            }
                            return global_this.throw_value(systemerror.to_error_instance(global_this));
                        }
                    }
                    _ => {}
                }

                return global_this.throw_value(err.to_js(global_this)?);
            }
            sys::Result::Ok(result) => result,
        },
    };

    // Use the isolated loop for spawnSync operations
    let process = spawned.to_process(loop_handle, IS_SYNC);

    let subprocess = Box::into_raw(Box::new(Subprocess {
        ref_count: Subprocess::RefCount::init(),
        global_this,
        process,
        pid_rusage: None,
        stdin: Writable::Ignore,
        stdout: Readable::Ignore,
        stderr: Readable::Ignore,
        stdio_pipes: BabyList::default(),
        ipc_data: None,
        flags: Subprocess::Flags { is_sync: IS_SYNC, ..Default::default() },
        // SAFETY: field is overwritten by the aggregate init below before any read.
        kill_signal: unsafe { core::mem::zeroed() },
        ..Default::default()
    }));
    // SAFETY: subprocess is a freshly-boxed Subprocess; we hold the only reference.
    let subprocess = unsafe { &mut *subprocess };

    #[cfg(unix)]
    let posix_ipc_fd = if !IS_SYNC && maybe_ipc_mode.is_some() {
        spawned.extra_pipes[usize::try_from(ipc_channel).unwrap()].fd()
    } else {
        Fd::INVALID
    };

    MaxBuf::create_for_subprocess(subprocess, &mut subprocess.stderr_maxbuf, max_buffer);
    MaxBuf::create_for_subprocess(subprocess, &mut subprocess.stdout_maxbuf, max_buffer);

    let mut promise_for_stream: JSValue = JSValue::ZERO;

    // When run synchronously, subprocess isn't garbage collected
    *subprocess = Subprocess {
        global_this,
        process,
        pid_rusage: None,
        // stdin/stdout/stderr are assigned immediately after this literal.
        // `Writable.init()` writes to `subprocess.weak_file_sink_stdin_ptr`,
        // `subprocess.flags`, and calls `subprocess.ref()` for `.pipe` /
        // `.readable_stream` stdin; if called from inside this aggregate
        // initializer those writes are clobbered by `.ref_count =
        // .initExactRefs(2)`, `.flags = .{...}`, and the default
        // `weak_file_sink_stdin_ptr = null` below. stdout/stderr are deferred
        // so that if `Writable.init()` fails the catch block doesn't have to
        // tear down unstarted `PipeReader`s (whose `deinit()` asserts
        // `isDone()`).
        stdin: Writable::Ignore,
        stdout: Readable::Ignore,
        stderr: Readable::Ignore,
        // 1. JavaScript.
        // 2. Process.
        ref_count: Subprocess::RefCount::init_exact_refs(2),
        stdio_pipes: spawned.extra_pipes.move_to_unmanaged(),
        ipc_data: if !IS_SYNC && cfg!(windows) {
            #[cfg(windows)]
            {
                maybe_ipc_mode.map(|ipc_mode| {
                    IPC::SendQueue::init(
                        ipc_mode,
                        IPC::Owner::Subprocess(subprocess),
                        IPC::Socket::Uninitialized,
                    )
                })
            }
            #[cfg(not(windows))]
            {
                None
            }
        } else {
            None
        },

        flags: Subprocess::Flags { is_sync: IS_SYNC, ..Default::default() },
        kill_signal,
        stderr_maxbuf: subprocess.stderr_maxbuf,
        stdout_maxbuf: subprocess.stdout_maxbuf,
        terminal: existing_terminal.or_else(|| terminal_info.as_ref().map(|info| info.terminal)),
        ..Default::default()
    };

    subprocess.stdin = match Writable::init(
        &mut stdio[0],
        event_loop,
        subprocess,
        spawned.stdin,
        &mut promise_for_stream,
    ) {
        Ok(v) => v,
        Err(err) => {
            // ref_count = 2 from the aggregate above, but neither the JS
            // wrapper nor the process exit handler are wired up yet, so
            // release both. stdout/stderr are still `.ignore` — close the raw
            // spawned pipe handles directly since `Readable.init()` will not
            // run. `finalizeStreams()` here only closes `stdio_pipes` and the
            // pidfd; stdin/stdout/stderr are `.ignore` so their `closeIO` is a
            // no-op.
            #[cfg(unix)]
            {
                if let Some(fd) = spawned.stdout {
                    fd.close();
                }
                if let Some(fd) = spawned.stderr {
                    fd.close();
                }
            }
            #[cfg(not(unix))]
            {
                for r in [spawned.stdout, spawned.stderr] {
                    match r {
                        spawn::WindowsPipe::Buffer(pipe) => pipe.close(Subprocess::on_pipe_close),
                        spawn::WindowsPipe::BufferFd(fd) => fd.close(),
                        spawn::WindowsPipe::Unavailable => {}
                    }
                }
            }
            subprocess.finalize_streams();
            subprocess.process.detach();
            subprocess.process.deref();
            MaxBuf::remove_from_subprocess(&mut subprocess.stdout_maxbuf);
            MaxBuf::remove_from_subprocess(&mut subprocess.stderr_maxbuf);
            subprocess.deref();
            subprocess.deref();
            if err == JsError::Thrown {
                return Err(JsError::Thrown);
            }
            return global_this.throw_out_of_memory();
        }
    };

    subprocess.stdout = Readable::init(
        stdio[1],
        event_loop,
        subprocess,
        spawned.stdout,
        jsc_vm.allocator,
        subprocess.stdout_maxbuf,
        IS_SYNC,
    );
    subprocess.stderr = Readable::init(
        stdio[2],
        event_loop,
        subprocess,
        spawned.stderr,
        jsc_vm.allocator,
        subprocess.stderr_maxbuf,
        IS_SYNC,
    );

    // For inline terminal options: close parent's slave_fd so EOF is received when child exits
    // For existing terminal: keep slave_fd open so terminal can be reused for more spawns
    if let Some(info) = terminal_info.take() {
        terminal_js_value = info.js_value;
        info.terminal.close_slave_fd();
        subprocess.flags.owns_terminal = true;
    }
    // existing_terminal: don't close slave_fd - user manages lifecycle and can reuse

    subprocess.process.set_exit_handler(subprocess);

    promise_for_stream.ensure_still_alive();
    subprocess.flags.is_stdin_a_readable_stream = promise_for_stream != JSValue::ZERO;

    if promise_for_stream != JSValue::ZERO && !global_this.has_exception() {
        if let Some(err) = promise_for_stream.to_error() {
            let _ = global_this.throw_value(err);
        }
    }

    if global_this.has_exception() {
        let err = global_this.take_exception(JsError::Thrown);
        // Ensure we kill the process so we don't leave things in an unexpected state.
        let _ = subprocess.try_kill(subprocess.kill_signal);

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        return global_this.throw_value(err);
    }

    // PORT NOTE: Zig left this `undefined` and only read it on the assigned path; Rust uses
    // Option since `IPC::Socket` is a tagged union (zeroed enum is UB).
    #[cfg(unix)]
    let mut posix_ipc_info: Option<IPC::Socket> = None;
    #[cfg(unix)]
    if !IS_SYNC {
        if let Some(mode) = maybe_ipc_mode {
            if let Some(socket) = jsc_vm.rare_data().spawn_ipc_group(jsc_vm).from_fd(
                jsc::SocketKind::SpawnIpc,
                None,
                core::mem::size_of::<*mut IPC::SendQueue>(),
                posix_ipc_fd.cast(),
                true,
            ) {
                subprocess.ipc_data = Some(IPC::SendQueue::init(
                    mode,
                    IPC::Owner::Subprocess(subprocess),
                    IPC::Socket::Uninitialized,
                ));
                posix_ipc_info = Some(IPC::Socket::from(socket));
            }
        }
    }

    if let Some(ipc_data) = subprocess.ipc_data.as_mut() {
        #[cfg(unix)]
        {
            if let Some(posix_ipc_info) = posix_ipc_info {
                if let Some(ctx) = posix_ipc_info.ext::<*mut IPC::SendQueue>() {
                    *ctx = subprocess.ipc_data.as_mut().unwrap() as *mut _;
                    subprocess.ipc_data.as_mut().unwrap().socket = IPC::SocketState::Open(posix_ipc_info);
                }
            }
            // uws owns the fd now (owns_fd=1); neutralize the slot so finalizeStreams doesn't double-close.
            subprocess.stdio_pipes[usize::try_from(ipc_channel).unwrap()] =
                spawn::ExtraPipe::Unavailable;
        }
        #[cfg(not(unix))]
        {
            if let Some(err) = ipc_data
                .windows_configure_server(
                    subprocess.stdio_pipes[usize::try_from(ipc_channel).unwrap()].buffer,
                )
                .as_err()
            {
                subprocess.deref();
                return global_this.throw_value(err.to_js(global_this)?);
            }
            subprocess.stdio_pipes[usize::try_from(ipc_channel).unwrap()] =
                spawn::ExtraPipe::Unavailable;
        }
        ipc_data.write_version_packet(global_this);
    }

    if matches!(subprocess.stdin, Writable::Pipe(_)) && promise_for_stream == JSValue::ZERO {
        if let Writable::Pipe(pipe) = &mut subprocess.stdin {
            pipe.signal = WebCore::streams::Signal::init(&mut subprocess.stdin);
            // TODO(port): borrowck — Zig passes `&subprocess.stdin` while holding `.pipe`.
        }
    }

    let out = if !IS_SYNC {
        subprocess.to_js(global_this)
    } else {
        JSValue::ZERO
    };
    if out != JSValue::ZERO {
        subprocess.this_value.set_weak(out);
        // Immediately upgrade to strong if there's pending activity to prevent premature GC
        subprocess.update_has_pending_activity();
    }

    let mut send_exit_notification = false;

    if !IS_SYNC {
        // This must go before other things happen so that the exit handler is
        // registered before onProcessExit can potentially be called.
        if let Some(timeout_val) = timeout {
            subprocess.event_loop_timer.next =
                bun_core::timespec::ms_from_now(bun_core::timespec::Mode::AllowMockedTime, timeout_val);
            global_this.bun_vm().timer.insert(&mut subprocess.event_loop_timer);
            subprocess.set_event_loop_timer_refd(true);
        }

        debug_assert!(out != JSValue::ZERO);

        if on_exit_callback.is_cell() {
            jsc::Codegen::JSSubprocess::on_exit_callback_set_cached(out, global_this, on_exit_callback);
        }
        if on_disconnect_callback.is_cell() {
            jsc::Codegen::JSSubprocess::on_disconnect_callback_set_cached(
                out,
                global_this,
                on_disconnect_callback,
            );
        }
        if ipc_callback.is_cell() {
            jsc::Codegen::JSSubprocess::ipc_callback_set_cached(out, global_this, ipc_callback);
        }

        if let Stdio::ReadableStream(rs) = &stdio[0] {
            jsc::Codegen::JSSubprocess::stdin_set_cached(out, global_this, rs.value);
        }

        // Cache the terminal JS value if a terminal was created
        if terminal_js_value != JSValue::ZERO {
            jsc::Codegen::JSSubprocess::terminal_set_cached(out, global_this, terminal_js_value);
        }

        match subprocess.process.watch() {
            sys::Result::Ok(()) => {}
            sys::Result::Err(_) => {
                send_exit_notification = true;
                lazy = false;
            }
        }
    }

    let _exit_notify_guard = scopeguard::guard((), |_| {
        if send_exit_notification {
            if subprocess.process.has_exited() {
                // process has already exited, we called wait4(), but we did not call onProcessExit()
                // SAFETY: all-zero is a valid Rusage (POD).
                subprocess
                    .process
                    .on_exit(subprocess.process.status, &unsafe { core::mem::zeroed::<Rusage>() });
            } else {
                // process has already exited, but we haven't called wait4() yet
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.process.wait(IS_SYNC);
            }
        }
    });

    if let Writable::Buffer(buffer) = &mut subprocess.stdin {
        if let Some(err) = buffer.start().as_err() {
            let _ = subprocess.try_kill(subprocess.kill_signal);
            let _ = global_this.throw_value(err.to_js(global_this)?);
            return Err(JsError::Thrown);
        }
    }

    if let Readable::Pipe(pipe) = &mut subprocess.stdout {
        if let Some(err) = pipe.start(subprocess, event_loop).as_err() {
            let _ = subprocess.try_kill(subprocess.kill_signal);
            let _ = global_this.throw_value(err.to_js(global_this)?);
            return Err(JsError::Thrown);
        }
        if (IS_SYNC || !lazy) && matches!(subprocess.stdout, Readable::Pipe(_)) {
            if let Readable::Pipe(pipe) = &mut subprocess.stdout {
                pipe.read_all();
            }
        }
    }

    if let Readable::Pipe(pipe) = &mut subprocess.stderr {
        if let Some(err) = pipe.start(subprocess, event_loop).as_err() {
            let _ = subprocess.try_kill(subprocess.kill_signal);
            let _ = global_this.throw_value(err.to_js(global_this)?);
            return Err(JsError::Thrown);
        }

        if (IS_SYNC || !lazy) && matches!(subprocess.stderr, Readable::Pipe(_)) {
            if let Readable::Pipe(pipe) = &mut subprocess.stderr {
                pipe.read_all();
            }
        }
    }

    **should_close_memfd = false;

    // Once everything is set up, we can add the abort listener
    // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
    // Therefore, we must do this at the very end.
    if let Some(signal) = abort_signal.take() {
        // SAFETY: signal is a valid *mut AbortSignal ref'd above.
        unsafe {
            (*signal).pending_activity_ref();
            subprocess.abort_signal =
                Some((*signal).add_listener(subprocess, Subprocess::on_abort_signal));
        }
    }

    if !IS_SYNC {
        if !subprocess.process.has_exited() {
            jsc_vm.on_subprocess_spawn(&subprocess.process);
        }
        return Ok(out);
    }

    // PORT NOTE: Zig `comptime bun.assert(is_sync)` — anonymous const items cannot capture
    // const-generic params, so use a runtime debug_assert (the !IS_SYNC path returned above).
    debug_assert!(IS_SYNC);

    if can_block_entire_thread_to_reduce_cpu_usage_in_fast_path {
        jsc_vm.counters.mark(jsc::Counter::SpawnSyncBlocking);
        let debug_timer = Output::DebugTimer::start();
        subprocess.process.wait(true);
        bun_output::scoped_log!(Subprocess, "spawnSync fast path took {}", debug_timer);

        // watchOrReap will handle the already exited case for us.
    }

    match subprocess.process.watch_or_reap() {
        sys::Result::Ok(()) => {
            // Once everything is set up, we can add the abort listener
            // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
            // Therefore, we must do this at the very end.
            if let Some(signal) = abort_signal.take() {
                // SAFETY: signal is a valid *mut AbortSignal ref'd above.
                unsafe {
                    (*signal).pending_activity_ref();
                    subprocess.abort_signal =
                        Some((*signal).add_listener(subprocess, Subprocess::on_abort_signal));
                }
            }
        }
        sys::Result::Err(_) => {
            subprocess.process.wait(true);
        }
    }

    if !subprocess.process.has_exited() {
        jsc_vm.on_subprocess_spawn(&subprocess.process);
    }

    let mut did_timeout = false;

    // Use the isolated event loop to tick instead of the main event loop
    // This ensures JavaScript timers don't fire and stdin/stdout from the main process aren't affected
    {
        let mut absolute_timespec = bun_core::timespec::EPOCH;
        let mut now = bun_core::timespec::now(bun_core::timespec::Mode::AllowMockedTime);
        let mut user_timespec: bun_core::timespec::Timespec = if let Some(timeout_ms) = timeout {
            now.add_ms(timeout_ms)
        } else {
            absolute_timespec
        };

        // Support `AbortSignal.timeout`, but it's best-effort.
        // Specifying both `timeout: number` and `AbortSignal.timeout` chooses the soonest one.
        // This does mean if an AbortSignal times out it will throw
        if let Some(signal) = subprocess.abort_signal {
            // SAFETY: subprocess.abort_signal was ref'd via pending_activity_ref above and is live until unref.
            if let Some(abort_signal_timeout) = unsafe { (*signal).get_timeout() } {
                if abort_signal_timeout.event_loop_timer.state == jsc::TimerState::ACTIVE {
                    if user_timespec.eql(&bun_core::timespec::EPOCH)
                        || abort_signal_timeout.event_loop_timer.next.order(&user_timespec)
                            == core::cmp::Ordering::Less
                    {
                        user_timespec = abort_signal_timeout.event_loop_timer.next;
                    }
                }
            }
        }

        let has_user_timespec = !user_timespec.eql(&bun_core::timespec::EPOCH);

        let sync_loop = jsc_vm.rare_data().spawn_sync_event_loop(jsc_vm);

        while subprocess.compute_has_pending_activity() {
            // Re-evaluate this at each iteration of the loop since it may change between iterations.
            let bun_test_timeout: bun_core::timespec::Timespec =
                if let Some(runner) = jsc::Jest::Jest::runner() {
                    runner.get_active_timeout()
                } else {
                    bun_core::timespec::EPOCH
                };
            let has_bun_test_timeout = !bun_test_timeout.eql(&bun_core::timespec::EPOCH);

            if has_bun_test_timeout {
                match bun_test_timeout.order_ignore_epoch(&user_timespec) {
                    core::cmp::Ordering::Less => absolute_timespec = bun_test_timeout,
                    core::cmp::Ordering::Equal => {}
                    core::cmp::Ordering::Greater => absolute_timespec = user_timespec,
                }
            } else if has_user_timespec {
                absolute_timespec = user_timespec;
            } else {
                absolute_timespec = bun_core::timespec::EPOCH;
            }
            let has_timespec = !absolute_timespec.eql(&bun_core::timespec::EPOCH);

            if let Writable::Buffer(buffer) = &mut subprocess.stdin {
                buffer.watch();
            }

            if let Readable::Pipe(pipe) = &mut subprocess.stderr {
                pipe.watch();
            }

            if let Readable::Pipe(pipe) = &mut subprocess.stdout {
                pipe.watch();
            }

            // Tick the isolated event loop without passing timeout to avoid blocking
            // The timeout check is done at the top of the loop
            match sync_loop.tick_with_timeout(if has_timespec && !did_timeout {
                Some(&absolute_timespec)
            } else {
                None
            }) {
                jsc::TickResult::Completed => {
                    now = bun_core::timespec::now(bun_core::timespec::Mode::AllowMockedTime);
                }
                jsc::TickResult::Timeout => {
                    now = bun_core::timespec::now(bun_core::timespec::Mode::AllowMockedTime);
                    let did_user_timeout = has_user_timespec
                        && (absolute_timespec.eql(&user_timespec)
                            || user_timespec.order(&now) == core::cmp::Ordering::Less);

                    if did_user_timeout {
                        did_timeout = true;
                        let _ = subprocess.try_kill(subprocess.kill_signal);
                    }

                    // Support bun:test timeouts AND spawnSync() timeout.
                    // There is a scenario where inside of spawnSync() a totally
                    // different test fails, and that SHOULD be okay.
                    if has_bun_test_timeout {
                        if bun_test_timeout.order(&now) == core::cmp::Ordering::Less {
                            let mut active_file_strong =
                                jsc::Jest::Jest::runner().unwrap().bun_test_root.active_file
                                    // TODO: add a .cloneNonOptional()?
                                    .clone();

                            let mut taken_active_file = active_file_strong.take().unwrap();

                            jsc::Jest::Jest::runner().unwrap().remove_active_timeout(jsc_vm);

                            // This might internally call `std.c.kill` on this
                            // spawnSync process. Even if we do that, we still
                            // need to reap the process. So we may go through
                            // the event loop again, but it should wake up
                            // ~instantly so we can drain the events.
                            jsc::Jest::bun_test::BunTest::bun_test_timeout_callback(
                                &mut taken_active_file,
                                &absolute_timespec,
                                jsc_vm,
                            );
                            // active_file_strong / taken_active_file drop here (was `defer .deinit()`).
                        }
                    }
                }
            }
        }
    }
    if global_this.has_exception() {
        // e.g. a termination exception.
        return Ok(JSValue::ZERO);
    }

    subprocess.update_has_pending_activity();

    let signal_code = subprocess.get_signal_code(global_this);
    let exit_code = subprocess.get_exit_code(global_this);
    let stdout = subprocess.stdout.to_buffered_value(global_this)?;
    let stderr = subprocess.stderr.to_buffered_value(global_this)?;
    let resource_usage: JSValue = if !global_this.has_exception() {
        subprocess.create_resource_usage_object(global_this)?
    } else {
        JSValue::ZERO
    };
    let exited_due_to_timeout = did_timeout;
    let exited_due_to_max_buffer = subprocess.exited_due_to_maxbuf;
    let result_pid = JSValue::js_number_from_int32(subprocess.pid());
    subprocess.finalize();

    let sync_value = JSValue::create_empty_object(global_this, 0);
    sync_value.put(global_this, ZigString::static_("exitCode"), exit_code);
    if !signal_code.is_empty_or_undefined_or_null() {
        sync_value.put(global_this, ZigString::static_("signalCode"), signal_code);
    }
    sync_value.put(global_this, ZigString::static_("stdout"), stdout);
    sync_value.put(global_this, ZigString::static_("stderr"), stderr);
    sync_value.put(
        global_this,
        ZigString::static_("success"),
        JSValue::from(exit_code.is_int32() && exit_code.as_int32() == 0),
    );
    sync_value.put(global_this, ZigString::static_("resourceUsage"), resource_usage);
    if timeout.is_some() {
        sync_value.put(
            global_this,
            ZigString::static_("exitedDueToTimeout"),
            if exited_due_to_timeout { JSValue::TRUE } else { JSValue::FALSE },
        );
    }
    if max_buffer.is_some() {
        sync_value.put(
            global_this,
            ZigString::static_("exitedDueToMaxBuffer"),
            if exited_due_to_max_buffer.is_some() { JSValue::TRUE } else { JSValue::FALSE },
        );
    }
    sync_value.put(global_this, ZigString::static_("pid"), result_pid);

    Ok(sync_value)
}

fn throw_command_not_found(global_this: &JSGlobalObject, command: &[u8]) -> JsResult<!> {
    // TODO(port): return type — Zig returns `bun.JSError` (the error value itself).
    // Mapped to JsResult<!> so callers can `return throw_command_not_found(...)?;` or similar.
    let err = SystemError {
        message: BunString::create_format(format_args!(
            "Executable not found in $PATH: \"{}\"",
            bstr::BStr::new(command)
        )),
        code: BunString::static_("ENOENT"),
        errno: -sys::UV_E::NOENT,
        path: BunString::clone_utf8(command),
        ..Default::default()
    };
    global_this.throw_value(err.to_error_instance(global_this))
}

pub fn append_envp_from_js(
    global_this: &JSGlobalObject,
    object: &JSObject,
    envp: &mut Vec<Option<*const c_char>>,
    path: &mut &[u8],
) -> JsResult<()> {
    let mut object_iter = JSPropertyIterator::init(
        global_this,
        object,
        jsc::PropertyIteratorOptions { skip_empty_name: false, include_value: true },
    )?;
    // drops at scope exit (was `defer object_iter.deinit()`).

    envp.reserve_exact(
        (object_iter.len +
            // +1 incase there's IPC
            // +1 for null terminator
            2)
        .saturating_sub(envp.len()),
    );
    while let Some(key) = object_iter.next()? {
        let value = object_iter.value;
        if value.is_undefined() {
            continue;
        }

        let value_bunstr = value.to_bun_string(global_this)?;
        // derefs on drop (was `defer value_bunstr.deref()`).

        // Check for null bytes in env key and value (security: prevent null byte injection)
        if key.index_of_ascii_char(0).is_some() {
            return global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The property 'options.env['{}']' must be a string without null bytes. Received \"{}\"",
                        key.to_zig_string(),
                        key.to_zig_string()
                    ),
                )
                .throw();
        }
        if value_bunstr.index_of_ascii_char(0).is_some() {
            return global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The property 'options.env['{}']' must be a string without null bytes. Received \"{}\"",
                        key.to_zig_string(),
                        value_bunstr.to_zig_string()
                    ),
                )
                .throw();
        }

        // PORT NOTE: Zig `std.fmt.allocPrintSentinel(envp.allocator, "{f}={f}", .{key, value}, 0)`
        // PERF(port): was arena bulk-free — profile in Phase B.
        let line: Box<ZStr> = {
            let mut buf: Vec<u8> = Vec::new();
            write!(&mut buf, "{}={}", key, value_bunstr.to_zig_string()).map_err(|_| JsError::OutOfMemory)?;
            buf.push(0);
            let len = buf.len() - 1;
            let slice = buf.into_boxed_slice();
            // SAFETY: slice[len] == 0 written above; slice is heap-owned and outlives the ZStr.
            unsafe { ZStr::from_raw_owned(slice, len) }
        };

        if key.eql_comptime(b"PATH") {
            *path = &line.as_bytes()[b"PATH=".len()..];
        }

        // TODO(port): lifetime — `line: Box<ZStr>` drops at end of loop body; Phase B: collect into
        // a backing Vec<Box<ZStr>> in the caller that lives past spawn_process.
        envp.push(Some(line.as_ptr() as *const c_char));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/js_bun_spawn_bindings.zig (1204 lines)
//   confidence: low
//   todos:      16
//   notes:      arena dropped per non-AST rule — argv/env *const c_char now point into owned Box<ZStr>s that need a backing Vec in Phase B; memfd-close + abort/terminal `defer`s reshaped via scopeguard re-borrows; `comptime is_sync` → const generic with void types collapsed to Option; Subprocess/IPC/Terminal cross-crate paths guessed
// ──────────────────────────────────────────────────────────────────────────

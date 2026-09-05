use core::cell::Cell;
use core::ffi::{CStr, c_char};
use core::ptr::NonNull;
use std::io::Write as _;

use crate::ipc as IPC;
#[cfg(not(windows))]
use bun_core::StackCheck;
use bun_core::{Output, Timespec, TimespecMockMode, ZBox, fmt as bun_fmt};
use bun_core::{String as BunString, ZStr, strings};
use bun_event_loop::SpawnSyncEventLoop::TickState;
use bun_io::max_buf::MaxBuf;
use bun_jsc::{
    self as jsc, EventLoopHandle, JSGlobalObject, JSObject, JSPropertyIterator, JSValue, JsError,
    JsResult, SystemError,
};
use bun_jsc::{JsCell, SysErrorJsc as _};
#[cfg(unix)]
use bun_sys::Fd;
use bun_sys::UV_E;
use bun_sys::{self as sys, FdExt as _, SignalCode};

// Process / spawn machinery is local to this crate (api/bun/process.rs).
#[cfg(unix)]
use crate::api::bun_process::ExtraPipe;
#[cfg(not(windows))]
use crate::api::bun_process::SpawnResultExt as _;
use crate::api::bun_process::{self as spawn, CStrPtr, Rusage, SpawnOptions};
// User-facing JS `Stdio` enum (extract/as_spawn_option/is_piped).
use crate::api::bun_spawn::stdio::{self, Stdio};
use crate::api::bun_subprocess::{
    self as Subprocess, Readable, Subprocess as SubprocessT, Writable,
};
use crate::api::bun_terminal_body::{
    self as terminal_body, InitError as TerminalInitError, Options as TerminalOptions, Terminal,
};
use crate::webcore as WebCore;

// ── local extension shims (real-body wrappers, not stubs) ───────────────────
trait JSValueSpawnExt {
    fn is_finite(self) -> bool;
}
impl JSValueSpawnExt for JSValue {
    #[inline]
    fn is_finite(self) -> bool {
        self.is_number() && self.as_number().is_finite()
    }
}

/// `SignalCode.fromJS` (bun_sys_jsc bridge).
#[inline]
fn signal_code_from_js(val: JSValue, global: &JSGlobalObject) -> JsResult<SignalCode> {
    bun_sys_jsc::signal_code_jsc::from_js(val, global)
}

#[inline]
fn subprocess_ipc_owner(ptr: *mut SubprocessT<'_>) -> Option<IPC::SendQueueOwner> {
    core::ptr::NonNull::new(ptr.cast::<SubprocessT<'static>>()).map(IPC::SendQueueOwner::Subprocess)
}

bun_output::declare_scope!(Subprocess, hidden);

// Stdio is platform-dependent: process.rs defines `PosixStdio` / `WindowsStdio`
// as siblings; alias the active one here so the body stays platform-neutral.
#[cfg(not(windows))]
type SpawnOptionsStdio = spawn::PosixStdio;
#[cfg(windows)]
type SpawnOptionsStdio = spawn::WindowsStdio;

// Reading the symbol address has no precondition (the value itself is a
// rodata `const char*`); kept `safe` to match the identical declaration in
// `runtime/shell/subproc.rs` so the two extern blocks don't diverge.
unsafe extern "C" {
    safe static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char;
}

struct Argv0Result {
    /// Was arena-owned `[:0]const u8`; caller stashes in its `Vec<ZBox>` backing
    /// store so the pointer outlives `spawn_process`.
    argv0: ZBox,
    /// Was arena-owned `[:0]u8`; caller stashes in its `Vec<ZBox>` backing store.
    arg0: ZBox,
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
    let arg0 = first_cmd.to_utf8(global_this)?;

    // Check for null bytes in command (security: prevent null byte injection)
    if strings::index_of_char(arg0.slice(), 0).is_some() {
        return Err(global_this
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "The argument 'args[0]' must be a string without null bytes. Received {}",
                    bun_fmt::quote(arg0.slice())
                ),
            )
            .throw());
    }
    // Heap allocate it to ensure we don't run out of stack space.
    let mut path_buf: Box<bun_core::PathBuffer> = Box::default();
    // drops at scope exit (was `defer bun.default_allocator.destroy(path_buf)`).

    let argv0_to_use: &[u8] = arg0.slice();

    // This mimicks libuv's behavior, which mimicks execvpe
    // Only resolve from $PATH when the command is not an absolute path.
    // libuv never appends .cmd/.bat, so a `\` path without one is still completed here.
    let names_a_file = strings::index_of_char(argv0_to_use, b'/').is_some()
        || (cfg!(windows) && bun_which::is_windows_path_with_executable_extension(argv0_to_use));
    let path_to_use: &[u8] = if names_a_file {
        b""
        // If no $PATH is provided, we fallback to the one from environ
        // This is already the behavior of the PATH passed in here.
    } else if !path.is_empty() {
        path
    } else if cfg!(unix) {
        // If the user explicitly passed an empty $PATH, we fallback to the OS-specific default (which libuv also does)
        // SAFETY: BUN_DEFAULT_PATH_FOR_SPAWN is a NUL-terminated static C string.
        unsafe { bun_core::ffi::cstr(BUN_DEFAULT_PATH_FOR_SPAWN) }.to_bytes()
    } else {
        b""
    };

    let actual_argv0: ZBox = if path_to_use.is_empty() {
        ZBox::from_bytes(argv0_to_use)
    } else {
        let Some(resolved) =
            bun_which::which_for_spawn(&mut path_buf, path_to_use, cwd, argv0_to_use)
        else {
            return Err(throw_command_not_found(global_this, argv0_to_use));
        };
        ZBox::from_bytes(resolved.as_bytes())
    };

    Ok(Argv0Result {
        argv0: actual_argv0,
        arg0: if let Some(p) = pretend_argv0 {
            ZBox::from_bytes(p.to_bytes())
        } else {
            ZBox::from_bytes(arg0.slice())
        },
    })
}

/// `argv` for `Bun.spawn` & `Bun.spawnSync`
///
/// `storage` receives ownership of every NUL-terminated string whose pointer is
/// pushed into `argv` / `argv0`; the caller's `Vec<ZBox>`
/// is dropped after `spawn_process` returns.
fn get_argv(
    global_this: &JSGlobalObject,
    args: JSValue,
    path: &[u8],
    cwd: &[u8],
    argv0: &mut Option<*const c_char>,
    argv: &mut Vec<CStrPtr>,
    storage: &mut Vec<ZBox>,
) -> JsResult<()> {
    if args.is_empty_or_undefined_or_null() {
        return Err(
            global_this.throw_invalid_arguments(format_args!("cmd must be an array of strings"))
        );
    }

    let mut cmds_array = args.array_iterator(global_this)?;

    if cmds_array.len == 0 {
        return Err(global_this.throw_invalid_arguments(format_args!("cmd must not be empty")));
    }

    if cmds_array.len > u32::MAX - 2 {
        return Err(global_this.throw_invalid_arguments(format_args!("cmd array is too large")));
    }

    // + 1 for argv0
    // + 1 for null terminator
    *argv = Vec::with_capacity(cmds_array.len as usize + 2);
    storage.reserve(cmds_array.len as usize + 2);

    let argv0_result = get_argv0(
        global_this,
        path,
        cwd,
        // SAFETY: argv0 was produced by to_owned_slice_z above; NUL-terminated and outlives this call.
        argv0.map(|p| unsafe { bun_core::ffi::cstr(p) }),
        cmds_array.next()?.unwrap(),
    )?;

    // CreateProcessW runs `.bat`/`.cmd` files through `cmd.exe`, which
    // re-tokenizes the command line with shell metacharacter rules
    // (BatBadBut, CVE-2024-24576 / CVE-2024-27980). libuv's MSVCRT-style
    // quoting cannot make that safe, so reject arguments that cmd.exe would
    // reinterpret.
    let is_batch_file = cfg!(windows) && bun_which::is_batch_file(argv0_result.argv0.as_bytes());
    if is_batch_file && bun_which::batch_arg_has_cmd_metachars(argv0_result.arg0.as_bytes()) {
        return Err(global_this
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "The command name contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received {}",
                    bun_fmt::quote(argv0_result.arg0.as_bytes())
                ),
            )
            .throw());
    }

    *argv0 = Some(argv0_result.argv0.as_ptr());
    argv.push(argv0_result.arg0.as_ptr());
    // Transfer ownership to the caller's backing store so the pointers above
    // stay valid past `spawn_process`.
    storage.push(argv0_result.argv0);
    storage.push(argv0_result.arg0);

    let mut arg_index: usize = 1;
    while let Some(value) = cmds_array.next()? {
        let arg = value.to_bun_string(global_this)?;

        // Check for null bytes in argument (security: prevent null byte injection)
        if arg.index_of_ascii_char(0).is_some() {
            return Err(global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'args[{}]' must be a string without null bytes. Received \"{}\"",
                        arg_index,
                        arg
                    ),
                )
                .throw());
        }

        let owned = arg.to_owned_slice_z();
        if is_batch_file && bun_which::batch_arg_has_cmd_metachars(owned.as_bytes()) {
            return Err(global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'args[{}]' contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received {}",
                        arg_index,
                        bun_fmt::quote(owned.as_bytes())
                    ),
                )
                .throw());
        }
        argv.push(owned.as_ptr());
        storage.push(owned);
        arg_index += 1;
    }

    if argv.is_empty() {
        return Err(
            global_this.throw_invalid_arguments(format_args!("cmd must be an array of strings"))
        );
    }
    Ok(())
}

/// Bun.spawn() calls this.
pub(crate) fn spawn(
    global_this: &JSGlobalObject,
    args: JSValue,
    secondary_args_value: Option<JSValue>,
) -> JsResult<JSValue> {
    spawn_maybe_sync(false, global_this, args, secondary_args_value, &mut None)
}

/// Bun.spawnSync() calls this.
pub(crate) fn spawn_sync(
    global_this: &JSGlobalObject,
    args: JSValue,
    secondary_args_value: Option<JSValue>,
) -> JsResult<JSValue> {
    let mut bun_test_deadline: Option<Timespec> = None;
    let result = spawn_maybe_sync(
        true,
        global_this,
        args,
        secondary_args_value,
        &mut bun_test_deadline,
    );
    // A bun:test deadline that passed while the isolated loop was blocking is reported only now: the loop is torn down and the child reaped, so the runner's callback re-enters nothing that is mid-flight. With an exception pending (spawn failure, termination) the file timer is left armed and reports it from the main loop instead.
    if let Some(deadline) = bun_test_deadline
        && result.is_ok()
        && !global_this.has_exception()
        && let Some(runner) = crate::test_runner::jest::Jest::runner()
        && let Some(active_file) = runner.bun_test_root.active_file.clone()
    {
        let vm = global_this.bun_vm().as_mut();
        runner.remove_active_timeout(vm);
        crate::test_runner::bun_test::BunTest::bun_test_timeout_callback(
            &active_file,
            &deadline,
            vm,
        );
        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }
    }
    result
}

fn spawn_maybe_sync(
    is_sync: bool,
    global_this: &JSGlobalObject,
    args_: JSValue,
    secondary_args_value: Option<JSValue>,
    bun_test_deadline: &mut Option<Timespec>,
) -> JsResult<JSValue> {
    if is_sync {
        // We skip this on Windows due to test failures.
        #[cfg(not(windows))]
        {
            // Since the event loop is recursively called, we need to check if it's safe to recurse.
            if !StackCheck::init().is_safe_to_recurse() {
                return Err(global_this.throw_stack_overflow());
            }
        }
    }

    // PERF: argv/env strings are allocated per-iteration; profile if hot.
    // Backing store for every NUL-terminated string whose `*const c_char` is
    // pushed into `argv` / `argv0` / `env_array` below. This `Vec`
    // drops after `spawn_process` returns, freeing all argv/env allocations.
    let mut cstr_storage: Vec<ZBox> = Vec::new();

    let mut override_env = false;
    let mut env_array: Vec<CStrPtr> = Vec::new();
    // SAFETY: `bun_vm()` returns the live VirtualMachine for this thread; it
    // outlives this call frame.
    let jsc_vm: &mut jsc::VirtualMachineRef = global_this.bun_vm().as_mut();

    let mut cwd: &[u8] = bun_resolver::fs::FileSystem::get().top_level_dir;
    let mut user_specified_cwd = false;

    let mut stdio: [Stdio; 3] = [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit];

    if is_sync {
        stdio[1] = Stdio::Pipe;
        stdio[2] = Stdio::Pipe;
    }
    let mut lazy = false;
    let mut on_exit_callback = JSValue::ZERO;
    let mut on_disconnect_callback = JSValue::ZERO;
    // `env_loader()` is the audited safe accessor for the per-VM DotEnv loader
    // (process-lifetime; centralised non-null deref in `VirtualMachine`).
    let mut path: &[u8] = jsc_vm.env_loader().get(b"PATH").unwrap_or(b"");
    let mut argv: Vec<CStrPtr> = Vec::new();
    let cmd_value: JSValue;
    let mut detached = false;
    let mut args = args_;
    let mut maybe_ipc_mode: Option<IPC::Mode> = None;
    let mut ipc_callback: JSValue = JSValue::ZERO;
    let mut extra_fds: Vec<SpawnOptionsStdio> = Vec::new();
    #[cfg(not(windows))]
    let mut socket_fd_indices: Vec<usize> = Vec::new();
    let mut argv0: Option<*const c_char> = None;
    let mut ipc_channel: i32 = -1;
    let mut timeout: Option<i32> = None;
    let mut uid: Option<u32> = None;
    let mut gid: Option<u32> = None;
    let mut kill_signal: SignalCode = SignalCode::DEFAULT;
    let mut max_buffer: Option<i64> = None;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let mut cgroup: Option<CgroupTarget> = None;

    #[cfg(windows)]
    let mut windows_hide: bool = false;
    #[cfg(windows)]
    let mut windows_verbatim_arguments: bool = false;
    let mut abort_signal: Option<bun_jsc::AbortSignalRef> = None;
    let mut terminal_info: Option<terminal_body::CreateResult> = None;
    let mut existing_terminal: Option<bun_ptr::BackRef<Terminal, bun_ptr::Mut>> = None; // Existing terminal passed by user
    let mut terminal_js_value: JSValue = JSValue::ZERO;
    let mut defer_guard = scopeguard::guard(
        &mut terminal_info,
        |terminal_info: &mut Option<terminal_body::CreateResult>| {
            // If we created a new terminal but spawn failed, close it. The
            // writer/reader/finalize deref paths release the remaining refs.
            // Downgrade the JSRef so the wrapper is GC-eligible, and mark
            // finalized so onReaderDone skips the JS exit callback — the user
            // never received this terminal (spawn threw).
            if let Some(info) = terminal_info.take() {
                // `abandon_from_spawn` is the spawn-side error-path teardown
                // (downgrade JSRef, mark finalized, close_internal).
                info.terminal.abandon_from_spawn();
            }
        },
    );
    // Note: reshaped for borrowck — re-borrow through the guard.
    let terminal_info = &mut **defer_guard;

    // Owned ZBox for `cwd` held here so the `&[u8]` borrow stays valid until
    // `spawn_process` returns.
    let cwd_owned: ZBox;
    {
        if args.is_empty_or_undefined_or_null() {
            return Err(global_this.throw_invalid_arguments(format_args!("cmd must be an array")));
        }

        let args_type = args.js_type();
        if args_type.is_array() {
            cmd_value = args;
            args = secondary_args_value.unwrap_or_default();
        } else if !args.is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!("cmd must be an array")));
        } else if let Some(cmd_value_) = args.get_truthy(global_this, "cmd")? {
            cmd_value = cmd_value_;
        } else {
            return Err(global_this.throw_invalid_arguments(format_args!("cmd must be an array")));
        }

        if args.is_object() {
            if let Some(argv0_) = args.get_truthy(global_this, "argv0")? {
                let argv0_str = argv0_.to_bun_string(global_this)?;
                if !argv0_str.is_empty() {
                    let owned = argv0_str.to_owned_slice_z();
                    // Check for null bytes in argv0 (security: prevent null byte injection)
                    if strings::index_of_char(owned.as_bytes(), 0).is_some() {
                        return Err(global_this
                            .err(
                                jsc::ErrorCode::INVALID_ARG_VALUE,
                                format_args!(
                                    "The property 'options.argv0' must be a string without null bytes. Received {}",
                                    bun_fmt::quote(owned.as_bytes())
                                ),
                            )
                            .throw());
                    }
                    argv0 = Some(owned.as_ptr());
                    cstr_storage.push(owned);
                }
            }

            // need to update `cwd` before searching for executable with `Which.which`
            if let Some(cwd_) = args.get_truthy(global_this, "cwd")? {
                let cwd_str = cwd_.to_bun_string(global_this)?;
                if !cwd_str.is_empty() {
                    cwd_owned = cwd_str.to_owned_slice_z();
                    // Check for null bytes in cwd (security: prevent null byte injection)
                    if strings::index_of_char(cwd_owned.as_bytes(), 0).is_some() {
                        return Err(global_this
                            .err(
                                jsc::ErrorCode::INVALID_ARG_VALUE,
                                format_args!(
                                    "The property 'options.cwd' must be a string without null bytes. Received {}",
                                    bun_fmt::quote(cwd_owned.as_bytes())
                                ),
                            )
                            .throw());
                    }
                    // `cwd_owned` is never mutated again, so this borrow is valid
                    // for every read of `cwd` below.
                    cwd = cwd_owned.as_bytes();
                    user_specified_cwd = true;
                }
            }
        }

        if !args.is_empty() && args.is_object() {
            // Reject terminal option on spawnSync
            if is_sync {
                if args.get_truthy(global_this, "terminal")?.is_some() {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "terminal option is only supported for Bun.spawn, not Bun.spawnSync",
                    )));
                }
            }

            // This must run before the stdio parsing happens
            if !is_sync {
                if let Some(val) = args.get_truthy(global_this, "ipc")? {
                    if val.is_cell() && val.is_callable() {
                        maybe_ipc_mode = Some('ipc_mode: {
                            if let Some(mode_val) = args.get_truthy(global_this, "serialization")? {
                                if mode_val.is_string() {
                                    break 'ipc_mode match IPC::Mode::from_js(global_this, mode_val)?
                                    {
                                        Some(m) => m,
                                        None => {
                                            return Err(global_this.throw_invalid_arguments(format_args!(
                                                "serialization must be \"json\" or \"advanced\"",
                                            )));
                                        }
                                    };
                                } else {
                                    return Err(global_this.throw_invalid_argument_type(
                                        "spawn",
                                        "serialization",
                                        "string",
                                    ));
                                }
                            }
                            break 'ipc_mode IPC::Mode::Advanced;
                        });

                        ipc_callback = val.with_async_context_if_needed(global_this);
                    }
                }
            }

            if let Some(signal_val) = args.get_truthy(global_this, "signal")? {
                if let Some(signal) = WebCore::AbortSignal::from_js(signal_val) {
                    // `from_js` returns a live FFI handle owned by JS.
                    // `AbortSignal` is an `opaque_ffi!` ZST handle; `opaque_ref`
                    // is the centralised non-null deref proof.
                    let sig = WebCore::AbortSignal::opaque_ref(signal);
                    if let Some(abort_error) = sig.node_abort_error_if_aborted(global_this) {
                        return Err(global_this.throw_value(abort_error));
                    }
                    abort_signal = Some(sig.ref_());
                } else {
                    return Err(global_this.throw_invalid_argument_type_value(
                        b"signal",
                        b"AbortSignal",
                        signal_val,
                    ));
                }
            }

            if let Some(on_disconnect_) = args.get_truthy(global_this, "onDisconnect")? {
                if !on_disconnect_.is_cell() || !on_disconnect_.is_callable() {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "onDisconnect must be a function or undefined",
                    )));
                }

                on_disconnect_callback = if is_sync {
                    on_disconnect_
                } else {
                    on_disconnect_.with_async_context_if_needed(global_this)
                };
            }

            if let Some(on_exit_) = args.get_truthy(global_this, "onExit")? {
                if !on_exit_.is_cell() || !on_exit_.is_callable() {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "onExit must be a function or undefined",
                    )));
                }

                on_exit_callback = if is_sync {
                    on_exit_
                } else {
                    on_exit_.with_async_context_if_needed(global_this)
                };
            }

            if let Some(env_arg) = args.get_truthy(global_this, "env")? {
                env_arg.ensure_still_alive();
                let Some(object) = env_arg.get_object() else {
                    return Err(
                        global_this.throw_invalid_arguments(format_args!("env must be an object"))
                    );
                };

                override_env = true;
                // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                let mut new_path: &[u8] = b"";
                // `JSObject` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
                // centralised non-null-ZST deref proof.
                append_envp_from_js(
                    global_this,
                    JSObject::opaque_ref(object),
                    &mut env_array,
                    &mut new_path,
                    &mut cstr_storage,
                )?;
                path = new_path;
            }

            get_argv(
                global_this,
                cmd_value,
                path,
                cwd,
                &mut argv0,
                &mut argv,
                &mut cstr_storage,
            )?;

            if let Some(stdio_val) = args.get(global_this, "stdio")? {
                if !stdio_val.is_empty_or_undefined_or_null() {
                    if stdio_val.js_type().is_array() {
                        let mut stdio_iter = stdio_val.array_iterator(global_this)?;
                        let mut i: i32 = 0;
                        while let Some(value) = stdio_iter.next()? {
                            Stdio::extract(&mut stdio[i as usize], global_this, i, value, is_sync)?;
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
                            Stdio::extract(&mut new_item, global_this, i, value, is_sync)?;

                            let opt = match new_item.as_spawn_option(i) {
                                stdio::ResultT::Result(opt) => opt,
                                stdio::ResultT::Err(e) => {
                                    return Err(e.throw_js(global_this));
                                }
                            };
                            #[cfg(not(windows))]
                            let is_ipc = matches!(opt, SpawnOptionsStdio::Ipc);
                            #[cfg(windows)]
                            let is_ipc = matches!(opt, SpawnOptionsStdio::Ipc(_));
                            if is_ipc {
                                ipc_channel = i32::try_from(extra_fds.len()).expect("int cast");
                            }
                            extra_fds.push(opt);
                            i += 1;
                        }
                    } else {
                        return Err(global_this
                            .throw_invalid_arguments(format_args!("stdio must be an array")));
                    }
                }
            } else {
                if let Some(value) = args.get(global_this, "stdin")? {
                    Stdio::extract(&mut stdio[0], global_this, 0, value, is_sync)?;
                }

                if let Some(value) = args.get(global_this, "stderr")? {
                    Stdio::extract(&mut stdio[2], global_this, 2, value, is_sync)?;
                }

                if let Some(value) = args.get(global_this, "stdout")? {
                    Stdio::extract(&mut stdio[1], global_this, 1, value, is_sync)?;
                }
            }

            if !is_sync {
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

            // Node semantics: uid/gid are int32s passed through to the OS
            // (negative values are cast to uid_t/gid_t, matching libuv).
            if let Some(uid_value) = args.get(global_this, "uid")? {
                if uid_value != JSValue::NULL {
                    let uid_int = global_this.validate_integer_range::<i32>(
                        uid_value,
                        0,
                        bun_sql_jsc::jsc::IntegerRange {
                            min: i128::from(i32::MIN),
                            max: i128::from(i32::MAX),
                            field_name: b"uid",
                            ..Default::default()
                        },
                    )?;
                    uid = Some(uid_int as u32);
                }
            }

            if let Some(gid_value) = args.get(global_this, "gid")? {
                if gid_value != JSValue::NULL {
                    let gid_int = global_this.validate_integer_range::<i32>(
                        gid_value,
                        0,
                        bun_sql_jsc::jsc::IntegerRange {
                            min: i128::from(i32::MIN),
                            max: i128::from(i32::MAX),
                            field_name: b"gid",
                            ..Default::default()
                        },
                    )?;
                    gid = Some(gid_int as u32);
                }
            }

            // Ignored where cgroups don't exist, like `windowsHide` on POSIX.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            if let Some(value) = args.get(global_this, "cgroup")? {
                if !value.is_undefined_or_null() {
                    cgroup = Some(CgroupTarget::from_js(global_this, value)?);
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
                        if timeout_value.is_number() {
                            let n = timeout_value.as_number();
                            // +Infinity is accepted as "no timeout"; NaN is always a
                            // caller-side bug (validate_integer_range would map it to 0).
                            if n.is_nan() {
                                return Err(global_this.throw_range_error(
                                    n,
                                    bun_fmt::OutOfRangeOptions {
                                        field_name: b"timeout",
                                        msg: b"a non-negative integer",
                                        ..Default::default()
                                    },
                                ));
                            }
                            if n.is_infinite() && n > 0.0 {
                                break 'brk;
                            }
                        }

                        let timeout_int = global_this.validate_integer_range::<u64>(
                            timeout_value,
                            0,
                            bun_sql_jsc::jsc::IntegerRange {
                                min: 0,
                                field_name: b"timeout",
                                ..Default::default()
                            },
                        )?;
                        if timeout_int > 0 {
                            timeout = Some(
                                i32::try_from((timeout_int as u32) & 0x7FFF_FFFF)
                                    .expect("int cast"),
                            );
                        }
                    }
                }
            }

            if let Some(val) = args.get(global_this, "killSignal")? {
                kill_signal = signal_code_from_js(val, global_this)?;
                if kill_signal.0 == 0 {
                    return Err(global_this
                        .err(
                            jsc::ErrorCode::ERR_UNKNOWN_SIGNAL,
                            format_args!("Unknown signal: 0"),
                        )
                        .throw());
                }
            }

            if let Some(val) = args.get(global_this, "maxBuffer")? {
                if val.is_number() && val.is_finite() {
                    // 'Infinity' does not set maxBuffer
                    let value = val.coerce_to_int64(global_this)?;
                    if value > 0
                        && (stdio[0].is_piped() || stdio[1].is_piped() || stdio[2].is_piped())
                    {
                        max_buffer = Some(value);
                    }
                }
            }

            if !is_sync {
                if let Some(terminal_val) = args.get_truthy(global_this, "terminal")? {
                    // Check if it's an existing Terminal object
                    if let Some(terminal) = terminal_body::js::from_js(terminal_val) {
                        // `from_js` returns the live `m_ctx` pointer borrowed
                        // from the JS wrapper; it stays valid for as long as
                        // `terminal_val` is reachable (kept alive below via
                        // `terminal_js_value`), so the `BackRef` invariant
                        // (pointee outlives holder) holds for this scope.
                        // SAFETY: `terminal` is the wrapper's live `m_ctx` heap pointer
                        // (write provenance from its original allocation).
                        let term = unsafe { bun_ptr::BackRef::from_raw_mut(terminal.as_ptr()) };
                        if term.is_closed() {
                            return Err(global_this
                                .throw_invalid_arguments(format_args!("terminal is closed")));
                        }
                        if term.is_inline_spawned() {
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                "terminal was created inline by a previous spawn and cannot be reused",
                            )));
                        }
                        #[cfg(unix)]
                        if term.get_slave_fd() == Fd::INVALID {
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                "terminal slave fd is no longer valid"
                            )));
                        }
                        #[cfg(not(unix))]
                        if term.get_pseudoconsole().is_none() {
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                "terminal pseudoconsole is no longer valid"
                            )));
                        }
                        existing_terminal = Some(term);
                        terminal_js_value = terminal_val;
                    } else if terminal_val.is_object() {
                        // Create a new terminal from options
                        let term_options =
                            TerminalOptions::parse_from_js(global_this, terminal_val)?;
                        match Terminal::create_from_spawn(global_this, &term_options) {
                            Ok(created) => *terminal_info = Some(created),
                            Err(err) => {
                                return Err(match err {
                                    TerminalInitError::OpenPtyFailed => {
                                        global_this.throw(format_args!("Failed to open PTY"))
                                    }
                                    TerminalInitError::DupFailed => global_this.throw(
                                        format_args!("Failed to duplicate PTY file descriptor"),
                                    ),
                                    TerminalInitError::NotSupported => global_this
                                        .throw(format_args!("PTY not supported on this platform")),
                                    TerminalInitError::WriterStartFailed => global_this
                                        .throw(format_args!("Failed to start terminal writer")),
                                    TerminalInitError::ReaderStartFailed => global_this
                                        .throw(format_args!("Failed to start terminal reader")),
                                });
                            }
                        }
                    } else {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "terminal must be a Terminal object or options object",
                        )));
                    }

                    #[cfg(unix)]
                    {
                        let slave_fd =
                            existing_terminal
                                .map(|t| t.get_slave_fd())
                                .unwrap_or_else(|| {
                                    terminal_info.as_ref().unwrap().terminal.get_slave_fd()
                                });
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
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                "ipc and extra stdio are not supported with terminal on Windows",
                            )));
                        }
                    }
                }
            }
        } else {
            get_argv(
                global_this,
                cmd_value,
                path,
                cwd,
                &mut argv0,
                &mut argv,
                &mut cstr_storage,
            )?;
        }
    }

    bun_output::scoped_log!(Subprocess, "spawn maxBuffer: {:?}", max_buffer);

    // Owns the `K=V\0` storage when inheriting the parent env; the struct
    // lives until spawn returns.
    let mut inherited_env_storage: Option<bun_dotenv::NullDelimitedEnvMap> = None;
    if !override_env && env_array.is_empty() {
        // `Transpiler::env_mut()` is the audited safe `&mut Loader` accessor
        // (per-VM DotEnv loader, valid for VM lifetime; centralised
        // single-unsafe deref). `.map` is its `&'a mut Map` slot.
        let envmap = match jsc_vm
            .transpiler
            .env_mut()
            .map
            .create_null_delimited_env_map()
        {
            Ok(m) => m,
            Err(_) => return Err(global_this.throw_out_of_memory()),
        };
        // Note: `as_slice()` *includes* the trailing null, so strip it; the
        // common tail below re-appends one after the optional NODE_CHANNEL_*
        // entries.
        let entries = envmap.as_slice();
        env_array.extend_from_slice(&entries[..entries.len().saturating_sub(1)]);
        inherited_env_storage = Some(envmap);
    }
    let _ = &inherited_env_storage;

    for fd_index in 0..stdio.len() {
        if stdio[fd_index].can_use_memfd() {
            if stdio[fd_index].use_memfd(fd_index as u32) {
                jsc_vm.counters.mark(jsc::counters::Field::SpawnMemfd);
            }
        }
    }
    let mut should_close_memfd = bun_core::env::IS_LINUX;

    let mut memfd_guard = scopeguard::guard(
        (&mut should_close_memfd, &mut stdio),
        |(should_close_memfd, stdio): (&mut bool, &mut [Stdio; 3])| {
            if *should_close_memfd {
                for fd_index in 0..stdio.len() {
                    if matches!(stdio[fd_index], Stdio::Memfd(_)) {
                        // Note: closing the fd first and then assigning would
                        // Drop the old `Stdio::Memfd` and re-close the same fd
                        // (EBADF → fd.rs debug_assert). `Stdio`'s Drop already
                        // closes a Memfd, so just replace with `Ignore` and
                        // let Drop perform the single close.
                        drop(core::mem::replace(&mut stdio[fd_index], Stdio::Ignore));
                    }
                }
            }
        },
    );
    // Note: reshaped for borrowck — re-borrow through the guard tuple so the guard
    // stays armed (runs on every early return) until disarmed by `**should_close_memfd = false` below.
    let (should_close_memfd, stdio) = &mut *memfd_guard;

    // "NODE_CHANNEL_FD=" is 16 bytes long, 15 bytes for the number, and 1 byte for the null terminator should be enough/safe
    let mut ipc_env_buf: [u8; 32] = [0; 32];
    if !is_sync {
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
            if let Err(_err) = env_array.try_reserve(3) {
                return Err(global_this.throw_out_of_memory());
            }
            let ipc_fd: i32 = 'brk: {
                if ipc_channel == -1 {
                    // If the user didn't specify an IPC channel, we need to add one
                    ipc_channel = i32::try_from(extra_fds.len()).expect("int cast");
                    let mut ipc_extra_fd_default = Stdio::Ipc;
                    let fd: i32 = ipc_channel + 3;
                    match ipc_extra_fd_default.as_spawn_option(fd) {
                        stdio::ResultT::Result(opt) => {
                            extra_fds.push(opt);
                        }
                        stdio::ResultT::Err(e) => {
                            return Err(e.throw_js(global_this));
                        }
                    }
                    break 'brk fd;
                } else {
                    break 'brk ipc_channel + 3;
                }
            };

            let pipe_env = {
                let mut cursor = &mut ipc_env_buf[..];
                match write!(cursor, "NODE_CHANNEL_FD={}\0", ipc_fd) {
                    Ok(()) => {
                        let written = 32 - cursor.len();
                        // SAFETY: NUL written above at buf[written-1]
                        ZStr::from_buf(&ipc_env_buf[..], written - 1)
                    }
                    Err(_) => return Err(global_this.throw_out_of_memory()),
                }
            };
            env_array.push(pipe_env.as_ptr().cast::<c_char>());

            env_array.push(match ipc_mode {
                IPC::Mode::Json => c"NODE_CHANNEL_SERIALIZATION_MODE=json".as_ptr(),
                IPC::Mode::Advanced => c"NODE_CHANNEL_SERIALIZATION_MODE=advanced".as_ptr(),
            });
        }
    }

    env_array.push(core::ptr::null());
    argv.push(core::ptr::null());

    if is_sync {
        for (i, io) in stdio.iter_mut().enumerate() {
            io.to_sync(i as u32);
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
    // - No IPC
    // - No inspector (since they might want to press pause or step)
    let can_block_entire_thread_to_reduce_cpu_usage_in_fast_path = (cfg!(unix) && is_sync)
        && abort_signal.is_none()
        && timeout.is_none()
        && max_buffer.is_none()
        && !stdio[0].is_piped()
        && !stdio[1].is_piped()
        && !stdio[2].is_piped()
        && extra_fds.is_empty()
        && !jsc_vm.auto_killer.enabled
        && !jsc_vm.is_inspector_enabled()
        && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH
            .get()
            .unwrap_or(false);

    // For spawnSync, use an isolated event loop to prevent JavaScript timers from firing
    // and to avoid interfering with the main event loop.
    //
    // Note: borrowck — `rare_data()` borrows `jsc_vm` mutably and the
    // returned `&mut SpawnSyncEventLoop` keeps that borrow alive, so we cannot
    // also pass `jsc_vm` into `spawn_sync_event_loop`/`prepare`/`cleanup` while
    // holding it. Route through a raw `*mut VirtualMachineRef` for the duration.
    let jsc_vm_ptr: *mut jsc::VirtualMachineRef = jsc_vm;
    // For is_sync, use the isolated loop's `event_loop` (created by
    // `SpawnSyncEventLoop::init`) so stdio readers/writers register on it
    // instead of the main loop.
    let event_loop: *mut jsc::event_loop::EventLoop = if is_sync {
        // SAFETY: see note above; `spawn_sync_event_loop` re-borrows the
        // same VM via the raw pointer for its `vm` arg.
        unsafe {
            let Some(sync_loop) = (*jsc_vm_ptr)
                .rare_data()
                .spawn_sync_event_loop(&mut *jsc_vm_ptr)
            else {
                // `WindowsStdio` has no `Drop`; free the pipes `as_spawn_option` allocated.
                #[cfg(windows)]
                for e in &mut extra_fds {
                    e.deinit();
                }
                return Err(throw_spawn_sync_loop_init_failed(global_this));
            };
            sync_loop.prepare(jsc_vm_ptr.cast());
            // `SpawnSyncEventLoop.event_loop` is type-erased to `*mut ()`
            // (bun_event_loop is below bun_jsc); the accessor returns the
            // concrete `jsc::EventLoop` allocation created via the runtime
            // vtable in `SpawnSyncEventLoop::init`.
            sync_loop
                .event_loop_ptr()
                .cast::<jsc::event_loop::EventLoop>()
        }
    } else {
        jsc_vm.event_loop()
    };

    // Note: reshaped for borrowck — `defer!` is non-`move`, so the closure
    // would capture the *place* `*jsc_vm_ptr` and conflict with later
    // `&mut *jsc_vm_ptr` re-borrows below. Copy the raw pointer into a sibling
    // local so the closure's captured place is disjoint.
    let jsc_vm_ptr_cleanup = jsc_vm_ptr;
    scopeguard::defer! {
        if is_sync {
            // SAFETY: defer runs while `jsc_vm` (the thread VM) is still live.
            unsafe {
                (*jsc_vm_ptr_cleanup)
                    .rare_data()
                    .spawn_sync_event_loop(&mut *jsc_vm_ptr_cleanup)
                    .expect("cached by the is_sync prepare above")
                    .cleanup(jsc_vm_ptr_cleanup.cast());
            }
        }
    }

    let loop_handle = EventLoopHandle::init(event_loop.cast::<()>());

    #[cfg(any(target_os = "linux", target_os = "android"))]
    let cgroup_dir = match &cgroup {
        Some(target) => Some(target.open(global_this)?),
        None => None,
    };

    let mut spawn_options = SpawnOptions {
        // Empty means "inherit the parent's working directory". Only chdir
        // when the user asked for it: the stored cwd path string can be stale
        // if the directory was renamed out from under the process (#33819).
        cwd: if user_specified_cwd {
            cwd.to_vec().into_boxed_slice()
        } else {
            Box::default()
        },
        detached,
        uid,
        gid,
        stdin: match stdio[0].as_spawn_option(0) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => return Err(e.throw_js(global_this)),
        },
        stdout: match stdio[1].as_spawn_option(1) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => return Err(e.throw_js(global_this)),
        },
        stderr: match stdio[2].as_spawn_option(2) {
            stdio::ResultT::Result(opt) => opt,
            stdio::ResultT::Err(e) => return Err(e.throw_js(global_this)),
        },
        extra_fds: {
            // Record which extra-stdio slots are 'socket-fd' so we can
            // downgrade them from OwnedFd to UnownedFd after all fallible
            // init below succeeds. spawn_process_posix pushes OwnedFd for
            // SocketFd so every error path's finalize_streams still closes
            // the bun-created fd; the caller-owns-it contract only begins
            // once the Subprocess is returned and .stdio[i] is readable.
            #[cfg(not(windows))]
            for (j, e) in extra_fds.iter().enumerate() {
                if matches!(e, SpawnOptionsStdio::SocketFd) {
                    socket_fd_indices.push(j);
                }
            }
            core::mem::take(&mut extra_fds).into_boxed_slice()
        },
        argv0,
        can_block_entire_thread_to_reduce_cpu_usage_in_fast_path,
        // Only pass pty_slave_fd for newly created terminals (for setsid+TIOCSCTTY setup).
        // For existing terminals, the session is already set up - child just uses the fd as stdio.
        #[cfg(unix)]
        pty_slave_fd: match terminal_info.as_ref() {
            Some(ti) => ti.terminal.get_slave_fd().native(),
            None => -1,
        },
        #[cfg(windows)]
        pseudoconsole: existing_terminal
            .as_deref()
            .or_else(|| terminal_info.as_ref().map(|info| info.terminal.get()))
            .and_then(Terminal::get_pseudoconsole),

        #[cfg(windows)]
        windows: spawn::WindowsOptions {
            hide_window: windows_hide,
            verbatim_arguments: windows_verbatim_arguments,
            loop_: loop_handle,
        },
        #[cfg(any(target_os = "linux", target_os = "android"))]
        cgroup_fd: cgroup_dir.as_ref().map(|c| c.dir.handle()),
        ..Default::default()
    };

    // SAFETY: `argv`/`env_array` are local null-terminated C-string arrays
    // with argv[0] non-null; valid for this call.
    let mut spawned = match unsafe {
        spawn::spawn_process(&spawn_options, argv.as_ptr(), env_array.as_ptr())
    } {
        Err(err)
            if err == bun_spawn::Error::Sys(bun_errno::SystemErrno::EMFILE)
                || err == bun_spawn::Error::Sys(bun_errno::SystemErrno::ENFILE) =>
        {
            // Windows: close+free the heap `uv::Pipe` handles that
            // `as_spawn_option` allocated and `spawn_process_windows` may have
            // `uv_pipe_init`-registered on the spawn-sync loop. Skipping this
            // leaks them and trips `assert(err == 0)` in `uv_loop_delete` at
            // `SpawnSyncEventLoop::Drop`. POSIX: no-op.
            spawn_options.deinit();
            let display_path: &ZStr = if !argv.is_empty() && !argv[0].is_null() {
                // SAFETY: argv[0] is non-null and points at a NUL-terminated
                // string we built above (lives in `cstr_storage`).
                ZStr::from_cstr(unsafe { bun_core::ffi::cstr(argv[0]) })
            } else {
                ZStr::EMPTY
            };
            let mut systemerror = sys::Error::from_code(
                if err == bun_spawn::Error::Sys(bun_errno::SystemErrno::EMFILE) {
                    sys::Errno::EMFILE
                } else {
                    sys::Errno::ENFILE
                },
                sys::Tag::posix_spawn,
            )
            .with_path(display_path)
            .to_system_error();
            systemerror.errno = if err == bun_spawn::Error::Sys(bun_errno::SystemErrno::EMFILE) {
                -UV_E::MFILE
            } else {
                -UV_E::NFILE
            };
            return Err(global_this
                .throw_value(SystemError::from(systemerror).to_error_instance(global_this)));
        }
        Err(err) => {
            // See EMFILE arm above.
            spawn_options.deinit();
            return Err(
                global_this.throw_error(crate::Error::from(err), ": failed to spawn process")
            );
        }
        Ok(maybe) => match maybe {
            sys::Result::Err(err) => {
                // See EMFILE arm above.
                spawn_options.deinit();
                #[cfg(any(target_os = "linux", target_os = "android"))]
                if let Some(c) = &cgroup_dir
                    && err.syscall == sys::Tag::clone3
                {
                    return Err(global_this.throw_value(c.target.blame(&err).to_js(global_this)));
                }
                match err.get_errno() {
                    errno @ (sys::Errno::EACCES
                    | sys::Errno::ENOENT
                    | sys::Errno::EPERM
                    | sys::Errno::EISDIR
                    | sys::Errno::ENOTDIR) => {
                        let display_path: &ZStr = if !argv.is_empty() && !argv[0].is_null() {
                            // SAFETY: argv[0] is non-null and points at a NUL-terminated
                            // string we built above (lives in `cstr_storage`).
                            ZStr::from_cstr(unsafe { bun_core::ffi::cstr(argv[0]) })
                        } else {
                            ZStr::EMPTY
                        };
                        if !display_path.as_bytes().is_empty() {
                            let mut systemerror = err.with_path(display_path).to_system_error();
                            if errno == sys::Errno::ENOENT {
                                systemerror.errno = -UV_E::NOENT;
                            }
                            return Err(global_this.throw_value(
                                SystemError::from(systemerror).to_error_instance(global_this),
                            ));
                        }
                    }
                    _ => {}
                }

                return Err(global_this.throw_value(err.to_js(global_this)));
            }
            sys::Result::Ok(result) => result,
        },
    };

    // Use the isolated loop for spawnSync operations
    //
    // Note: `PosixSpawnResult::to_process` consumes `self` but only reads
    // `pid`/`pidfd`/`has_exited`. `stdin/stdout/stderr/extra_pipes` are still
    // needed afterward, so take those fields out first so the partial move is
    // explicit.
    let spawned_stdin = spawned.stdin.take();
    let spawned_stdout = spawned.stdout.take();
    let spawned_stderr = spawned.stderr.take();
    let mut spawned_extra_pipes = core::mem::take(&mut spawned.extra_pipes);
    let process = spawned.to_process(loop_handle);

    #[cfg(unix)]
    let posix_ipc_fd = if !is_sync && maybe_ipc_mode.is_some() {
        spawned_extra_pipes[usize::try_from(ipc_channel).expect("int cast")].fd()
    } else {
        Fd::INVALID
    };

    // When run synchronously, subprocess isn't garbage collected.
    //
    // Note: build
    // the struct once with its final field values, then fill in the
    // address-dependent fields (maxbufs, ipc_data on Windows) afterward.
    let subprocess_ptr = bun_core::heap::into_raw(Box::new(SubprocessT {
        global_this: bun_ptr::BackRef::new(global_this),
        process,
        pid_rusage: Cell::new(None),
        // stdin/stdout/stderr are assigned immediately after this literal.
        // `Writable.init()` writes to `subprocess.weak_file_sink_stdin_ptr`,
        // `subprocess.flags`, and calls `subprocess.ref()` for `.pipe` /
        // `.readable_stream` stdin; if called from inside this aggregate
        // initializer those writes are clobbered by the `ref_count`, `flags`,
        // and default `weak_file_sink_stdin_ptr` initializers below.
        // stdout/stderr are deferred
        // so that if `Writable.init()` fails the catch block doesn't have to
        // tear down unstarted `PipeReader`s (whose `deinit()` asserts
        // `isDone()`).
        stdin: JsCell::new(Writable::Ignore),
        stdout: JsCell::new(Readable::Ignore),
        stderr: JsCell::new(Readable::Ignore),
        // 1=JS (released in Subprocess::finalize), 2=Process exit handler
        // (released in Subprocess::on_process_exit; stranded if child outlives VM teardown).
        ref_count: bun_ptr::RefCount::init_exact_refs(2),
        stdio_pipes: JsCell::new(core::mem::take(&mut spawned_extra_pipes)),
        ipc_data: JsCell::new(None),
        flags: Cell::new(if is_sync {
            Subprocess::Flags::IS_SYNC
        } else {
            Subprocess::Flags::empty()
        }),
        kill_signal,
        stderr_maxbuf: Cell::new(None),
        stdout_maxbuf: Cell::new(None),
        terminal: Cell::new(
            existing_terminal
                .map(|t| t.as_ptr())
                .or_else(|| terminal_info.as_ref().map(|info| info.terminal.as_ptr()))
                .and_then(NonNull::new),
        ),
        observable_getters: Default::default(),
        closed: Default::default(),
        this_value: Default::default(),
        weak_file_sink_stdin_ptr: Cell::new(None),
        abort_signal: JsCell::new(None),
        event_loop_timer_refd: Cell::new(false),
        event_loop_timer: JsCell::new(crate::timer::EventLoopTimer::init_paused(
            crate::timer::EventLoopTimerTag::SubprocessTimeout,
        )),
        exited_due_to_maxbuf: Cell::new(None),
    }));
    // SAFETY: subprocess_ptr is a freshly-boxed Subprocess; we hold the only reference.
    let subprocess = unsafe { &mut *subprocess_ptr };
    #[cfg(windows)]
    SubprocessT::record_stdio_pipe_ownership(subprocess_ptr);
    // Erase the borrow lifetime to 'static for the intrusive back-pointer
    // (PipeReader stores it as raw NonNull). subprocess_ptr is non-null (just boxed).
    let subprocess_nn: NonNull<SubprocessT<'static>> =
        NonNull::new(subprocess_ptr.cast()).expect("Box::into_raw returned null");

    // Address-dependent fields, filled now that `subprocess` has a stable address.
    {
        let owner = bun_io::max_buf::Owner {
            ptr: subprocess_nn.cast::<()>(),
            on_overflow: SubprocessT::on_max_buffer_overflow,
        };
        let mut mb = None;
        MaxBuf::create_for_subprocess(&mut mb, max_buffer, owner);
        subprocess.stderr_maxbuf.set(mb);
        let mut mb = None;
        MaxBuf::create_for_subprocess(&mut mb, max_buffer, owner);
        subprocess.stdout_maxbuf.set(mb);
    }

    #[cfg(windows)]
    if !is_sync {
        if let Some(ipc_mode) = maybe_ipc_mode {
            subprocess.ipc_data.set(Some(IPC::SendQueue::new(
                ipc_mode,
                subprocess_ipc_owner(subprocess_ptr),
                IPC::SocketUnion::Uninitialized,
            )));
        }
    }

    let mut promise_for_stream: JSValue = JSValue::ZERO;

    match Writable::init(
        &mut stdio[0],
        // SAFETY: event_loop points to the live JSC EventLoop for this thread.
        unsafe { &*event_loop },
        subprocess,
        spawned_stdin,
        &mut promise_for_stream,
    ) {
        Ok(v) => subprocess.stdin.set(v),
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
                if let Some(fd) = spawned_stdout {
                    if !stdio[1].borrows_caller_fd() {
                        fd.close();
                    }
                }
                if let Some(fd) = spawned_stderr {
                    if !stdio[2].borrows_caller_fd() {
                        fd.close();
                    }
                }
            }
            #[cfg(not(unix))]
            {
                use bun_libuv_sys::UvHandle as _;
                for r in [spawned_stdout, spawned_stderr] {
                    match r {
                        spawn::WindowsStdioResult::Buffer(pipe) => {
                            // `uv_close` is async — libuv keeps the raw handle pointer
                            // until the next loop tick and then calls `on_pipe_close`,
                            // which reclaims the allocation via `heap::take`. Leak the
                            // Box so it outlives this scope; dropping it here would be
                            // a use-after-free + double-free when the callback fires.
                            Box::leak(pipe).close(Subprocess::on_pipe_close)
                        }
                        spawn::WindowsStdioResult::BufferFd(fd) => fd.close(),
                        spawn::WindowsStdioResult::UnownedFd(_)
                        | spawn::WindowsStdioResult::Unavailable => {}
                    }
                }
            }
            subprocess.finalize_streams();
            subprocess.process_mut().detach();
            if let Some(ipc_data) = subprocess.ipc_data.take() {
                // Nothing else holds it yet (no socket wired, no task scheduled).
                ipc_data.detach();
            }
            let mut mb = subprocess.stdout_maxbuf.get();
            MaxBuf::remove_from_subprocess(&mut mb);
            subprocess.stdout_maxbuf.set(mb);
            let mut mb = subprocess.stderr_maxbuf.get();
            MaxBuf::remove_from_subprocess(&mut mb);
            subprocess.stderr_maxbuf.set(mb);
            subprocess.deref();
            subprocess.deref();
            // Note: `Writable::init` returns
            // `crate::Error`. Map non-thrown to OOM.
            if global_this.has_exception() {
                return Err(JsError::Thrown);
            }
            let _ = err;
            return Err(global_this.throw_out_of_memory());
        }
    }

    // event_loop points to the live JSC EventLoop for this thread.
    let event_loop_nn = NonNull::new(event_loop).expect("event_loop is null");
    subprocess.stdout.set(Readable::init(
        core::mem::replace(&mut stdio[1], Stdio::Ignore),
        event_loop_nn,
        subprocess_nn,
        spawned_stdout,
        subprocess.stdout_maxbuf.get(),
        is_sync,
    ));
    subprocess.stderr.set(Readable::init(
        core::mem::replace(&mut stdio[2], Stdio::Ignore),
        event_loop_nn,
        subprocess_nn,
        spawned_stderr,
        subprocess.stderr_maxbuf.get(),
        is_sync,
    ));

    // Inline terminals keep slave_fd until on_process_exit (BSD kernels flush
    // pty output on last slave close; see Terminal::drain_and_close_slave_fd).
    // Existing terminals keep slave_fd for reuse.
    if let Some(info) = terminal_info.take() {
        terminal_js_value = info.js_value;
        #[cfg(unix)]
        info.terminal.mark_inline_spawned();
        #[cfg(windows)]
        {
            // ConPTY has no slave fd; this just marks inline_spawned.
            info.terminal.close_slave_fd();
            // Release the ConDrv \Reference handle now that the child holds a
            // copy: conhost then exits on its own once the child disconnects
            // and the reader observes EOF without us having to tear ConPTY
            // down from on_process_exit.
            info.terminal.release_pseudoconsole_reference();
        }
        subprocess.update_flags(|f| f.insert(Subprocess::Flags::OWNS_TERMINAL));
    }
    // existing_terminal: don't close slave_fd - user manages lifecycle and can reuse

    // SAFETY: `subprocess_ptr` is the live JSC-allocated Subprocess that owns
    // `process` and outlives it (handler ctx invariant).
    subprocess.process_mut().set_exit_handler(unsafe {
        bun_spawn::ProcessExit::new(bun_spawn::ProcessExitKind::Subprocess, subprocess_ptr)
    });

    promise_for_stream.ensure_still_alive();
    subprocess.update_flags(|f| {
        f.set(
            Subprocess::Flags::IS_STDIN_A_READABLE_STREAM,
            promise_for_stream != JSValue::ZERO,
        )
    });

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

        return Err(global_this.throw_value(err));
    }

    // Note: Option (rather than an uninitialized value) since `IPC::Socket`
    // is a tagged union (zeroed enum is UB) and it is only read on the
    // assigned path.
    #[cfg(unix)]
    let mut posix_ipc_info: Option<IPC::Socket> = None;
    #[cfg(unix)]
    if !is_sync {
        if let Some(mode) = maybe_ipc_mode {
            // SAFETY: `jsc_vm_ptr` is the live per-thread VM; JS thread.
            let vm = unsafe { &mut *jsc_vm_ptr };
            let loop_ = vm.uws_loop();
            let raw_socket = vm.rare_data().spawn_ipc_group(loop_).from_fd(
                bun_uws::SocketKind::SpawnIpc,
                None,
                core::mem::size_of::<*mut IPC::SendQueue>() as core::ffi::c_int,
                posix_ipc_fd.native(),
                0,
                true,
            );
            if !raw_socket.is_null() {
                let socket = raw_socket;
                subprocess.ipc_data.set(Some(IPC::SendQueue::new(
                    mode,
                    subprocess_ipc_owner(subprocess_ptr),
                    IPC::SocketUnion::Uninitialized,
                )));
                posix_ipc_info = Some(IPC::Socket::from(socket));
            }
        }
    }

    if let Some(ipc_data) = subprocess.ipc() {
        #[cfg(unix)]
        {
            if let Some(posix_ipc_info) = posix_ipc_info {
                if let Some(ctx) = posix_ipc_info.ext::<*mut IPC::SendQueue>() {
                    // SAFETY: `ctx` is the live ext-slot pointer returned by uSockets;
                    // it stays valid for the socket's lifetime.
                    unsafe { *ctx = ipc_data.as_ctx_ptr() };
                    ipc_data.socket.set(IPC::SocketUnion::Open(posix_ipc_info));
                }
            }
            // uws owns the fd now (owns_fd=1); neutralize the slot so finalizeStreams doesn't double-close.
            subprocess.stdio_pipes.with_mut(|v| {
                v[usize::try_from(ipc_channel).expect("int cast")] = ExtraPipe::Unavailable;
            });
        }
        #[cfg(not(unix))]
        {
            use crate::node::MaybeExt as _;
            let idx = usize::try_from(ipc_channel).expect("int cast");
            // The IPC channel is always a `buffer` pipe on Windows.
            // Ownership of the heap `uv::Pipe` transfers to `ipc_data.socket`;
            // neutralize the slot up front so `finalizeStreams` can't
            // double-close it (the Box would otherwise drop on reassignment).
            let ipc_pipe: *mut bun_libuv_sys::Pipe = subprocess.stdio_pipes.with_mut(|pipes| {
                match core::mem::take(&mut pipes[idx]) {
                    spawn::WindowsStdioResult::Buffer(pipe) => bun_core::heap::into_raw(pipe),
                    other => {
                        // Restore the slot before panicking so the
                        // `Subprocess` finalizer still sees the original
                        // variant. Use
                        // `unreachable!` (NOT `debug_assert!` — that would
                        // compile out in release and feed null to
                        // `windows_configure_server`, which immediately
                        // dereferences it).
                        pipes[idx] = other;
                        unreachable!("IPC channel stdio is not a buffer pipe");
                    }
                }
            });
            // `windows_configure_server` stores the pointer in `uv_handle_t.data`
            // for the pipe's lifetime, so it must be the allocation root
            // (write provenance), never one re-derived from `&SendQueue`.
            // SAFETY: `ipc_data` is the live SendQueue owned by `subprocess`.
            if let Some(err) =
                unsafe { IPC::SendQueue::windows_configure_server(ipc_data.as_ctx_ptr(), ipc_pipe) }
                    .as_err()
            {
                let err_js = err.to_js(global_this);
                subprocess.deref();
                return Err(global_this.throw_value(err_js));
            }
        }
        ipc_data.write_version_packet(global_this);
    }

    if matches!(subprocess.stdin.get(), Writable::Pipe(_)) && promise_for_stream == JSValue::ZERO {
        // Store the whole-allocation `*mut Subprocess` so Writable::on_close can raw-project stdin.
        // SAFETY: `subprocess_ptr` is the stable boxed Subprocess; stdin was just confirmed `Pipe`.
        unsafe {
            if let Writable::Pipe(pipe) = (*subprocess_ptr).stdin.get() {
                (*pipe.as_ptr())
                    .source
                    .set(WebCore::streams::SourceHandle::Subprocess(
                        bun_ptr::BackRef::from_raw(subprocess_ptr.cast::<SubprocessT<'static>>()),
                    ));
            }
        }
    }

    let out = if !is_sync {
        // `subprocess_ptr` came from `heap::alloc` above and has not yet been
        // wrapped; ownership transfers to the C++ JS cell (released via
        // `SubprocessClass__finalize`). Use the raw-ptr entrypoint instead of
        // the by-value `JsClass::to_js` (which would re-box).
        SubprocessT::to_js_from_ptr(subprocess_ptr, global_this)
    } else {
        JSValue::ZERO
    };
    if out != JSValue::ZERO {
        subprocess.this_value.with_mut(|v| v.set_weak(out));
        // Immediately upgrade to strong if there's pending activity to prevent premature GC
        subprocess.update_has_pending_activity();
    }

    let mut send_exit_notification = false;

    if !is_sync {
        // This must go before other things happen so that the exit handler is
        // registered before onProcessExit can potentially be called.
        if let Some(timeout_val) = timeout {
            let ts = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, i64::from(timeout_val));
            // Note: `EventLoopTimer.next` is a local-stub Timespec until
            // `bun_event_loop` switches to `bun_core::Timespec`; copy fieldwise.
            subprocess.event_loop_timer.with_mut(|t| {
                t.next = crate::timer::ElTimespec {
                    sec: ts.sec,
                    nsec: ts.nsec,
                };
            });
            // `Timer::All` lives in `bun_runtime`; reach it via the
            // `RuntimeHooks` dispatch (`VirtualMachineRef::timer_insert`) which
            // forwards to `crate::timer::All::insert`.
            // SAFETY: `jsc_vm_ptr` is the live per-thread VM; the timer node is
            // owned by the boxed `Subprocess` and stays at a stable address
            // until `Subprocess::finalize` removes it from the heap.
            unsafe {
                jsc::VirtualMachineRef::timer_insert(
                    jsc_vm_ptr,
                    core::ptr::addr_of!(subprocess.event_loop_timer)
                        .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                        .cast_mut(),
                );
            }
            subprocess.set_event_loop_timer_refd(true);
        }

        debug_assert!(out != JSValue::ZERO);

        if on_exit_callback.is_cell() {
            Subprocess::js::on_exit_callback_set_cached(out, global_this, on_exit_callback);
        }
        if on_disconnect_callback.is_cell() {
            Subprocess::js::on_disconnect_callback_set_cached(
                out,
                global_this,
                on_disconnect_callback,
            );
        }
        if ipc_callback.is_cell() {
            Subprocess::js::ipc_callback_set_cached(out, global_this, ipc_callback);
        }

        if let Stdio::ReadableStream(rs) = &stdio[0] {
            Subprocess::js::stdin_set_cached(out, global_this, rs.value);
        }

        // Cache the terminal JS value if a terminal was created
        if terminal_js_value != JSValue::ZERO {
            Subprocess::js::terminal_set_cached(out, global_this, terminal_js_value);
        }

        match subprocess.process_mut().watch() {
            sys::Result::Ok(()) => {}
            sys::Result::Err(_) => {
                send_exit_notification = true;
                lazy = false;
            }
        }
    }

    // Note: reshaped for borrowck — copy `subprocess_ptr` so the
    // non-`move` `defer!` closure captures a disjoint place from the
    // `(*subprocess_ptr).abort_signal = …` writes that follow.
    let subprocess_ptr_exit = subprocess_ptr;
    scopeguard::defer! {
        if send_exit_notification {
            // SAFETY: subprocess_ptr is live for the lifetime of this defer.
            let proc = unsafe { &*subprocess_ptr_exit }.process_mut();
            if proc.has_exited() {
                // process has already exited, we called wait4(), but we did not call onProcessExit()
                // SAFETY: all-zero is a valid Rusage (POD).
                let status = proc.status.clone();
                proc.on_exit(status, &bun_core::ffi::zeroed::<Rusage>());
            } else {
                // process has already exited, but we haven't called wait4() yet
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                proc.wait(is_sync);
            }
        }
    }

    // Start the readers before the Writable::Buffer stdin writer so that if
    // the writer's start() throws below, both PipeReaders have taken their
    // start() ref and on_process_exit's later drain is refcount-balanced.
    if let Readable::Pipe(pipe) = subprocess.stdout.get() {
        // Note: pass `subprocess_nn` (the `NonNull<Subprocess<'static>>`
        // captured above) instead of the live `&mut subprocess`, which would
        // alias with the `&mut subprocess.stdout` borrow held by `pipe`.
        Readable::pipe_reader_mut(pipe).start(subprocess_nn, event_loop_nn, !is_sync && lazy);
        if (is_sync || !lazy) && matches!(subprocess.stdout.get(), Readable::Pipe(_)) {
            if let Readable::Pipe(pipe) = subprocess.stdout.get() {
                Readable::pipe_reader_mut(pipe).read_all();
            }
        }
    }

    if let Readable::Pipe(pipe) = subprocess.stderr.get() {
        // Note: see stdout arm above — avoid aliased &mut.
        Readable::pipe_reader_mut(pipe).start(subprocess_nn, event_loop_nn, !is_sync && lazy);

        if (is_sync || !lazy) && matches!(subprocess.stderr.get(), Readable::Pipe(_)) {
            if let Readable::Pipe(pipe) = subprocess.stderr.get() {
                Readable::pipe_reader_mut(pipe).read_all();
            }
        }
    }

    let stdin_start_err = match subprocess.stdin.get() {
        Writable::Buffer(buffer) => Writable::buffer_writer_mut(buffer).start().err(),
        _ => None,
    };
    if let Some(err) = stdin_start_err {
        // An unstarted writer never reports on_close; a Buffer left here pins the wrapper.
        #[cfg(not(windows))] // Windows adopts the pipe at create and start() cannot fail there.
        subprocess.on_close_io(Subprocess::StdioKind::Stdin);
        let _ = subprocess.try_kill(subprocess.kill_signal);
        return Err(global_this.throw_value(err.to_js(global_this)));
    }

    **should_close_memfd = false;

    // Every `return Err` above is past; the Subprocess will be returned to
    // JS. Downgrade 'socket-fd' slots from OwnedFd to UnownedFd so
    // finalize_streams (on later GC) skips them and the caller is the sole
    // owner via .stdio[i]. Placed here (not earlier) because the
    // Writable::init error arm, the has_exception catch-all, and the IPC
    // open-socket failure all throw after populating stdio_pipes; on those
    // paths the caller never receives the Subprocess, so the OwnedFd slot
    // must remain for the GC'd wrapper's finalize_streams to close.
    #[cfg(not(windows))]
    if !socket_fd_indices.is_empty() {
        subprocess.stdio_pipes.with_mut(|pipes| {
            for j in &socket_fd_indices {
                if let Some(slot @ ExtraPipe::OwnedFd(_)) = pipes.get_mut(*j) {
                    let ExtraPipe::OwnedFd(fd) = *slot else {
                        unreachable!()
                    };
                    *slot = ExtraPipe::UnownedFd(fd);
                }
            }
        });
    }

    // Once everything is set up, we can add the abort listener
    // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
    // Therefore, we must do this at the very end.
    if let Some(signal) = abort_signal.take() {
        // Ownership of the ref transfers to `subprocess.abort_signal`.
        // `add_listener` may synchronously fire `on_abort_signal` (already
        // aborted), which re-enters via `subprocess_ptr` and may take the
        // field, so store it first and hold no `&mut Subprocess` across the call.
        let sig: *mut WebCore::AbortSignal = signal.get();
        // SAFETY: `subprocess_ptr` is live; `sig` is kept alive by the ref just stored.
        unsafe {
            (*subprocess_ptr).abort_signal.set(Some(signal));
            (*sig).pending_activity_ref();
            let _ = (*sig).add_listener(subprocess_ptr.cast(), Subprocess::on_abort_signal);
        }
    }

    if !is_sync {
        if !subprocess.has_exited() {
            // SAFETY: jsc_vm_ptr points to the live thread VM; `subprocess.process`
            // is a `BackRef` (wraps `NonNull`), so its pointer is non-null.
            unsafe {
                (*jsc_vm_ptr)
                    .on_subprocess_spawn(NonNull::new_unchecked(subprocess.process.as_ptr()))
            };
        }
        return Ok(out);
    }

    debug_assert!(is_sync);

    if can_block_entire_thread_to_reduce_cpu_usage_in_fast_path {
        // SAFETY: jsc_vm_ptr is the live thread VM.
        unsafe { &mut *jsc_vm_ptr }
            .counters
            .mark(jsc::counters::Field::SpawnSyncBlocking);
        let debug_timer = Output::DebugTimer::start();
        subprocess.process_mut().wait(true);
        bun_output::scoped_log!(Subprocess, "spawnSync fast path took {}", debug_timer);

        // watchOrReap will handle the already exited case for us.
    }

    match subprocess.process_mut().watch_or_reap() {
        sys::Result::Ok(_) => {
            // Once everything is set up, we can add the abort listener
            // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
            // Therefore, we must do this at the very end.
            if let Some(signal) = abort_signal.take() {
                let sig: *mut WebCore::AbortSignal = signal.get();
                // SAFETY: see the matching block above.
                unsafe {
                    (*subprocess_ptr).abort_signal.set(Some(signal));
                    (*sig).pending_activity_ref();
                    let _ = (*sig).add_listener(subprocess_ptr.cast(), Subprocess::on_abort_signal);
                }
            }
        }
        sys::Result::Err(_) => {
            subprocess.process_mut().wait(true);
        }
    }

    if !subprocess.has_exited() {
        // SAFETY: jsc_vm_ptr points to the live thread VM; `subprocess.process`
        // is a `BackRef` (wraps `NonNull`), so its pointer is non-null.
        unsafe {
            (*jsc_vm_ptr).on_subprocess_spawn(NonNull::new_unchecked(subprocess.process.as_ptr()))
        };
    }

    let mut did_timeout = false;

    // Use the isolated event loop to tick instead of the main event loop
    // This ensures JavaScript timers don't fire and stdin/stdout from the main process aren't affected
    {
        let mut absolute_timespec = Timespec::EPOCH;
        let mut now = Timespec::now(TimespecMockMode::ForceRealTime);
        let mut user_timespec: Timespec = if let Some(timeout_ms) = timeout {
            now.add_ms(i64::from(timeout_ms))
        } else {
            absolute_timespec
        };

        // Support `AbortSignal.timeout`, but it's best-effort.
        // Specifying both `timeout: number` and `AbortSignal.timeout` chooses the soonest one.
        // This does mean if an AbortSignal times out it will throw
        if let Some(signal) = subprocess.abort_signal_ref() {
            if let Some(abort_signal_timeout) = signal.get_timeout() {
                // Note: `AbortSignal::Timeout.event_loop_timer` uses the
                // bun_event_loop-local `Timespec` stub; convert fieldwise.
                //
                // A fake-heap deadline is on the mocked clock, which cannot
                // advance while this call blocks; only a real-heap one is
                // comparable with `now`.
                if abort_signal_timeout.event_loop_timer.state
                    == crate::timer::EventLoopTimerState::ACTIVE
                    && abort_signal_timeout.event_loop_timer.in_heap
                        == crate::timer::InHeap::Regular
                {
                    let next = &abort_signal_timeout.event_loop_timer.next;
                    let next_ts = Timespec {
                        sec: next.sec,
                        nsec: next.nsec,
                    };
                    if user_timespec.eql(&Timespec::EPOCH)
                        || next_ts.order(&user_timespec) == core::cmp::Ordering::Less
                    {
                        user_timespec = next_ts;
                    }
                }
            }
        }

        let has_user_timespec = !user_timespec.eql(&Timespec::EPOCH);
        let mut bun_test_fired = false;

        // SAFETY: jsc_vm_ptr is the live thread VM; re-borrowed for the nested arg.
        let sync_loop = unsafe { &mut *jsc_vm_ptr }
            .rare_data()
            .spawn_sync_event_loop(unsafe { &mut *jsc_vm_ptr })
            .expect("cached by the is_sync prepare above");

        while subprocess.compute_has_pending_activity() {
            // Re-evaluate this at each iteration of the loop since it may change between iterations.
            let bun_test_timeout: Timespec = if bun_test_fired {
                Timespec::EPOCH
            } else if let Some(runner) = crate::test_runner::jest::Jest::runner() {
                runner.get_active_timeout()
            } else {
                Timespec::EPOCH
            };
            let has_bun_test_timeout = !bun_test_timeout.eql(&Timespec::EPOCH);

            if has_bun_test_timeout {
                match Timespec::order_ignore_epoch(bun_test_timeout, user_timespec) {
                    core::cmp::Ordering::Less => absolute_timespec = bun_test_timeout,
                    core::cmp::Ordering::Equal => {}
                    core::cmp::Ordering::Greater => absolute_timespec = user_timespec,
                }
            } else if has_user_timespec {
                absolute_timespec = user_timespec;
            } else {
                absolute_timespec = Timespec::EPOCH;
            }
            let has_timespec = !absolute_timespec.eql(&Timespec::EPOCH);

            if let Writable::Buffer(buffer) = subprocess.stdin.get() {
                Writable::buffer_writer_mut(buffer).watch();
            }

            if let Readable::Pipe(pipe) = subprocess.stderr.get() {
                Readable::pipe_reader_mut(pipe).watch();
            }

            if let Readable::Pipe(pipe) = subprocess.stdout.get() {
                Readable::pipe_reader_mut(pipe).watch();
            }

            // Tick the isolated event loop without passing timeout to avoid blocking
            // The timeout check is done at the top of the loop
            match sync_loop.tick_with_timeout(if has_timespec && !did_timeout {
                Some(&absolute_timespec)
            } else {
                None
            }) {
                TickState::Completed => {}
                TickState::Timeout => {
                    now = Timespec::now(TimespecMockMode::ForceRealTime);
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
                    // Kill the dangling processes now so this loop can drain, but leave the runner's timeout callback to `spawn_sync`: it re-enters the test runner and must not run while this isolated loop is still active.
                    if has_bun_test_timeout
                        && bun_test_timeout.order(&now) == core::cmp::Ordering::Less
                    {
                        bun_test_fired = true;
                        *bun_test_deadline = Some(absolute_timespec);
                        if let Some(active_file) = crate::test_runner::jest::Jest::runner()
                            .unwrap()
                            .bun_test_root
                            .active_file
                            .clone()
                        {
                            active_file
                                .get()
                                .execution
                                .kill_dangling_processes_on_timeout(global_this);
                        }
                        let _ = subprocess.try_kill(subprocess.kill_signal);
                    }
                }
            }

            // Once the wait is being terminated (timeout, maxBuffer, bun:test
            // per-test timeout), stop waiting on pipe EOF; a grandchild may
            // still hold the write end (Node.js SyncProcessRunner::Kill()).
            if did_timeout || bun_test_fired || subprocess.exited_due_to_maxbuf.get().is_some() {
                subprocess.close_readable_pipes();
            }
        }
    }
    if global_this.has_exception() {
        // e.g. a termination exception.
        // SAFETY: same as below; `subprocess` is not used after this line.
        unsafe {
            bun_jsc::host_fn::host_fn_finalize_ref_counted(subprocess_ptr, SubprocessT::finalize)
        };
        return Ok(JSValue::ZERO);
    }

    subprocess.update_has_pending_activity();

    let signal_code = SubprocessT::get_signal_code(subprocess, global_this);
    let exit_code = SubprocessT::get_exit_code(subprocess, global_this);
    // Propagated after `finalize`, which must run even when building the output throws.
    let output = subprocess
        .stdout
        .with_mut(|s| s.to_buffered_value(global_this))
        .and_then(|stdout| {
            let stderr = subprocess
                .stderr
                .with_mut(|s| s.to_buffered_value(global_this))?;
            let resource_usage = subprocess.create_resource_usage_object(global_this)?;
            Ok((stdout, stderr, resource_usage))
        });
    let exited_due_to_timeout = did_timeout;
    let exited_due_to_max_buffer = subprocess.exited_due_to_maxbuf.get();
    let result_pid = JSValue::js_number_from_int32(subprocess.pid());
    // SAFETY: `subprocess_ptr` was produced by `heap::into_raw(Box::new(...))`
    // above (spawnSync path: never handed to a JS wrapper); do what the
    // wrapper's finalizer would have. `subprocess` is not used after this line.
    unsafe {
        bun_jsc::host_fn::host_fn_finalize_ref_counted(subprocess_ptr, SubprocessT::finalize)
    };
    let (stdout, stderr, resource_usage) = output?;

    let sync_value = JSValue::create_empty_object(global_this, 0);
    sync_value.put(global_this, b"exitCode", exit_code);
    if !signal_code.is_empty_or_undefined_or_null() {
        sync_value.put(global_this, b"signalCode", signal_code);
    }
    sync_value.put(global_this, b"stdout", stdout);
    sync_value.put(global_this, b"stderr", stderr);
    sync_value.put(
        global_this,
        b"success",
        JSValue::from(exit_code.is_int32() && exit_code.as_int32() == 0),
    );
    sync_value.put(global_this, b"resourceUsage", resource_usage);
    if timeout.is_some() {
        sync_value.put(
            global_this,
            b"exitedDueToTimeout",
            if exited_due_to_timeout {
                JSValue::TRUE
            } else {
                JSValue::FALSE
            },
        );
    }
    if max_buffer.is_some() {
        sync_value.put(
            global_this,
            b"exitedDueToMaxBuffer",
            if exited_due_to_max_buffer.is_some() {
                JSValue::TRUE
            } else {
                JSValue::FALSE
            },
        );
    }
    sync_value.put(global_this, b"pid", result_pid);

    Ok(sync_value)
}

fn throw_spawn_sync_loop_init_failed(global_this: &JSGlobalObject) -> JsError {
    // us_create_loop returns NULL without the errno; EMFILE is the common cause.
    let err = SystemError {
        message: BunString::static_(
            b"spawnSync failed to initialize its event loop (system resource exhaustion)",
        ),
        code: BunString::static_("EMFILE"),
        errno: -UV_E::MFILE,
        path: BunString::EMPTY,
        #[cfg(windows)]
        syscall: BunString::static_("uv_loop_init"),
        #[cfg(any(target_os = "linux", target_os = "android"))]
        syscall: BunString::static_("epoll_create1"),
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        syscall: BunString::static_("kqueue"),
        hostname: BunString::EMPTY,
        fd: -1,
        dest: BunString::EMPTY,
    };
    global_this.throw_value(err.to_error_instance(global_this))
}

fn throw_command_not_found(global_this: &JSGlobalObject, command: &[u8]) -> JsError {
    let err = SystemError {
        message: BunString::create_format(format_args!(
            "Executable not found in $PATH: \"{}\"",
            bstr::BStr::new(command)
        )),
        code: BunString::static_("ENOENT"),
        errno: -UV_E::NOENT,
        path: BunString::clone_utf8(command),
        ..Default::default()
    };
    global_this.throw_value(err.to_error_instance(global_this))
}

/// `storage` receives ownership of every `K=V\0` line whose pointer is pushed
/// into `envp` (and, for `PATH=`, sliced into `*path`); the caller's
/// `Vec<ZBox>` is dropped after `spawn_process` returns.
fn append_envp_from_js(
    global_this: &JSGlobalObject,
    object: &JSObject,
    envp: &mut Vec<CStrPtr>,
    path: &mut &[u8],
    storage: &mut Vec<ZBox>,
) -> JsResult<()> {
    let object_iter = JSPropertyIterator::init(
        global_this,
        object,
        jsc::PropertyIteratorOptions {
            skip_empty_name: false,
            include_value: true,
        },
    )?;
    // drops at scope exit (was `defer object_iter.deinit()`).

    envp.reserve_exact(
        (object_iter.len +
            // +1 incase there's IPC
            // +1 for null terminator
            2)
        .saturating_sub(envp.len()),
    );
    storage.reserve(object_iter.len);
    while let Some((key, value)) = object_iter.next()? {
        if value.is_undefined() {
            continue;
        }

        let value_bunstr = value.to_bun_string(global_this)?;

        // Check for null bytes in env key and value (security: prevent null byte injection)
        if key.index_of_ascii_char(0).is_some() {
            return Err(global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The property 'options.env['{}']' must be a string without null bytes. Received \"{}\"",
                        key,
                        key
                    ),
                )
                .throw());
        }
        if value_bunstr.index_of_ascii_char(0).is_some() {
            return Err(global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The property 'options.env['{}']' must be a string without null bytes. Received \"{}\"",
                        key,
                        value_bunstr
                    ),
                )
                .throw());
        }

        // PERF: per-entry allocation — profile if it shows up on a hot path.
        let line: ZBox = {
            let mut buf: Vec<u8> = Vec::new();
            write!(&mut buf, "{}={}", key, value_bunstr).map_err(|_| JsError::OutOfMemory)?;
            ZBox::from_vec(buf)
        };

        // Windows environment variable names are case-insensitive: an env
        // object carrying `Path` (the usual casing there) must still drive
        // the executable lookup, like libuv's spawn does.
        let line_bytes = line.as_bytes();
        let key_end = strings::index_of_char_usize(line_bytes, b'=').unwrap_or(line_bytes.len());
        let is_path_key = if cfg!(windows) {
            strings::eql_case_insensitive_ascii(&line_bytes[..key_end], b"PATH", true)
        } else {
            &line_bytes[..key_end] == b"PATH"
        };
        if is_path_key && key_end < line_bytes.len() {
            // SAFETY: `line` is moved into `storage` below (a `Vec<ZBox>` that
            // outlives every read of `*path`), and `ZBox` is heap-backed so the
            // bytes don't move when the `ZBox` value itself is moved.
            *path = unsafe { bun_ptr::detach_lifetime(&line_bytes[key_end + 1..]) };
        }

        envp.push(line.as_ptr());
        storage.push(line);
    }
    Ok(())
}

/// `cgroup` option: a cgroup directory the child starts inside.
#[cfg(any(target_os = "linux", target_os = "android"))]
enum CgroupTarget {
    Path(ZBox),
    DirFd(Fd),
}

/// The directory fd handed to `posix_spawn_bun`, plus what to blame on error.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct OpenCgroup<'a> {
    /// Always ours and `O_CLOEXEC` (a caller's fd is dup'd), so it can neither
    /// leak into the child nor be closed under us mid-spawn.
    dir: sys::File,
    target: &'a CgroupTarget,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl CgroupTarget {
    /// Attach whichever of path / fd the caller gave us.
    fn blame(&self, err: &sys::Error) -> sys::Error {
        match self {
            Self::Path(path) => err.with_path(path.as_bytes()),
            Self::DirFd(fd) => err.with_fd(*fd),
        }
    }

    fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        if value.is_number() {
            // `validate_integer_range` maps NaN to the default; there is no default fd.
            let fd = global.validate_integer_range::<i32>(
                value,
                -1,
                bun_sql_jsc::jsc::IntegerRange {
                    min: 0,
                    max: i128::from(i32::MAX),
                    field_name: b"cgroup",
                    ..Default::default()
                },
            )?;
            if fd < 0 {
                return Err(global.throw_range_error(
                    value.as_number(),
                    bun_fmt::OutOfRangeOptions {
                        field_name: b"cgroup",
                        msg: b"an integer",
                        ..Default::default()
                    },
                ));
            }
            return Ok(Self::DirFd(Fd::from_native(fd)));
        }
        if value.is_string() {
            let path = value.to_utf8(global)?;
            if strings::contains_char(path.slice(), 0) {
                return Err(global
                    .err(
                        jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "The property 'options.cgroup' must be a string without null bytes. Received {}",
                            bun_fmt::quote(path.slice())
                        ),
                    )
                    .throw());
            }
            return Ok(Self::Path(ZBox::from_bytes(path.slice())));
        }
        Err(global.throw_invalid_argument_type_value(b"cgroup", b"string or number", value))
    }

    /// Resolve to a directory fd in the parent so a bad path fails the spawn
    /// with errno + path rather than an opaque exit 127 from the child.
    fn open(&self, global: &JSGlobalObject) -> JsResult<OpenCgroup<'_>> {
        let dir = match self {
            Self::DirFd(fd) => sys::dup(*fd),
            Self::Path(path) => sys::open_dir_absolute(path.as_bytes()),
        };
        let opened = match dir {
            Ok(dir) => OpenCgroup {
                dir: sys::File::from_fd(dir),
                target: self,
            },
            Err(err) => return Err(global.throw_value(self.blame(&err).to_js(global))),
        };

        // Best-effort: a frozen destination would park the child before exec
        // and, through vfork, this thread with it. The kernel reports no error.
        if Self::is_frozen(opened.dir.handle()) {
            let err = self.blame(&sys::Error::from_code(sys::Errno::EBUSY, sys::Tag::clone3));
            return Err(global.throw_value(err.to_js(global)));
        }

        Ok(opened)
    }

    fn is_frozen(dir: Fd) -> bool {
        // v2: `cgroup.freeze` is this cgroup's own request (set before freezing
        // completes); `cgroup.events` `frozen 1` is the effective state,
        // including a freeze inherited from an ancestor.
        if let Ok(freeze) = sys::File::read_from(dir, b"cgroup.freeze") {
            return freeze.starts_with(b"1")
                || sys::File::read_from(dir, b"cgroup.events")
                    .is_ok_and(|events| strings::contains(&events, b"frozen 1"));
        }
        // v1 only freezes where the freezer controller is co-mounted, and
        // reports THAWED / FREEZING / FROZEN (effective state).
        sys::File::read_from(dir, b"freezer.state").is_ok_and(|state| !state.starts_with(b"THAWED"))
    }
}

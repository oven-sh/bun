use core::cell::Cell;
use core::ffi::{CStr, c_char};
use core::ptr::NonNull;
use std::io::Write as _;

use bun_collections::VecExt;
use bun_core::{self as strings_mod, String as BunString, ZStr, ZigString, strings};
use bun_core::{Output, StackCheck, Timespec, TimespecMockMode, ZBox, fmt as bun_fmt};
use bun_event_loop::SpawnSyncEventLoop::TickState;
use bun_io::max_buf::MaxBuf;
use bun_jsc::ipc as IPC;
use bun_jsc::{
    self as jsc, CallFrame, EventLoopHandle, JSGlobalObject, JSObject, JSPropertyIterator, JSValue,
    JsError, JsResult, SystemError,
};
use bun_jsc::{JsCell, JsClass as _, SysErrorJsc as _};
use bun_paths::PathBuffer;
use bun_sys::UV_E;
use bun_sys::{self as sys, Fd, FdExt as _, SignalCode};

// Process / spawn machinery is local to this crate (api/bun/process.rs).
use crate::api::bun_process::{
    self as spawn, CStrPtr, ExtraPipe, Process, Rusage, SpawnOptions, SpawnProcessResult,
    SpawnResultExt as _,
};
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
// `JSValue::withAsyncContextIfNeeded` (Zig) — wraps a callback so its
// AsyncLocalStorage context is restored at fire-time. The C-ABI symbol lives in
// `src/jsc/bindings/AsyncContextFrame.cpp`; matches the per-callsite FFI used
// by Timer.rs / udp_socket.rs / node_crypto_binding.rs.
unsafe extern "C" {
    safe fn AsyncContextFrame__withAsyncContextIfNeeded(
        global: &JSGlobalObject,
        callback: JSValue,
    ) -> JSValue;
}
trait JSValueSpawnExt {
    fn with_async_context_if_needed(self, global: &JSGlobalObject) -> JSValue;
    fn is_finite(self) -> bool;
}
impl JSValueSpawnExt for JSValue {
    #[inline]
    fn with_async_context_if_needed(self, global: &JSGlobalObject) -> JSValue {
        AsyncContextFrame__withAsyncContextIfNeeded(global, self)
    }
    #[inline]
    fn is_finite(self) -> bool {
        self.is_number() && self.as_number().is_finite()
    }
}

/// `bun.String.indexOfAsciiChar` — encoding-aware ASCII-char search over the
/// string's storage code units (Latin-1 bytes or UTF-16 u16s). Matches Zig
/// `bun.String.indexOfAsciiChar` exactly; `bun_core::String` does not expose it
/// inherently yet.
trait BunStringSpawnExt {
    fn index_of_ascii_char(&self, chr: u8) -> Option<usize>;
}
impl BunStringSpawnExt for BunString {
    #[inline]
    fn index_of_ascii_char(&self, chr: u8) -> Option<usize> {
        debug_assert!(chr < 128);
        if self.is_utf16() {
            self.utf16().iter().position(|&c| c == u16::from(chr))
        } else {
            // Latin-1 / ASCII: 1 byte == 1 code unit.
            strings::index_of_char(self.latin1(), chr).map(|i| i as usize)
        }
    }
}

/// `SignalCode.fromJS` (bun_sys_jsc bridge).
#[inline]
fn signal_code_from_js(val: JSValue, global: &JSGlobalObject) -> JsResult<SignalCode> {
    bun_sys_jsc::signal_code_jsc::from_js(val, global)
}

/// Convert a `bun_sys::SystemError` (T1 stub shape) into the C-ABI
/// `bun_jsc::SystemError` and materialize a JS Error instance.
fn sys_system_error_to_js(err: bun_sys::SystemError, global: &JSGlobalObject) -> JSValue {
    let jsc_err = SystemError {
        errno: err.errno,
        code: err.code,
        message: err.message,
        path: err.path,
        syscall: err.syscall,
        hostname: err.hostname,
        fd: err.fd,
        dest: err.dest,
    };
    jsc_err.to_error_instance(global)
}

/// `Terminal.CreateResult` — local mirror that flattens `IntrusiveRc<Terminal>`
/// to a `BackRef<Terminal>` used by `Subprocess.terminal`, so the scopeguard /
/// field-assignment paths share one pointer type with `existing_terminal`.
pub struct TerminalCreateResult {
    /// BACKREF — the `IntrusiveRc<Terminal>` pointer leaked via `into_raw()`
    /// when this struct was populated; the +1 ref is held until
    /// `Subprocess::finalize` (or the spawn-error scopeguard's
    /// `abandon_from_spawn`) releases it, so the pointee outlives this struct.
    pub terminal: bun_ptr::BackRef<Terminal>,
    pub js_value: JSValue,
}

impl TerminalCreateResult {
    /// Shared borrow of the held `Terminal` (BackRef invariant: +1-ref'd
    /// IntrusiveRc, live while this struct is held).
    #[inline]
    pub fn term(&self) -> &Terminal {
        self.terminal.get()
    }
}

// ── IPC owner trait impl for Subprocess ─────────────────────────────────────
// Mirrors the `IPCInstance` impl in `bun_jsc::VirtualMachine`; lives here
// because `Subprocess` is a `bun_runtime` type and `bun_jsc::ipc` (tier-5)
// sees only the `dyn SendQueueOwner` trait object.
impl IPC::SendQueueOwner for SubprocessT<'static> {
    fn global_this(&self) -> *const JSGlobalObject {
        self.global_this.as_ptr()
    }
    fn handle_ipc_close(&mut self) {
        SubprocessT::handle_ipc_close(self)
    }
    fn handle_ipc_message(&mut self, msg: IPC::DecodedIPCMessage, handle: JSValue) {
        SubprocessT::handle_ipc_message(self, msg, handle)
    }
    fn this_jsvalue(&self) -> JSValue {
        self.this_value.get().try_get().unwrap_or(JSValue::ZERO)
    }
    fn kind(&self) -> IPC::SendQueueOwnerKind {
        IPC::SendQueueOwnerKind::Subprocess
    }
}

#[inline]
fn subprocess_ipc_owner(ptr: *mut SubprocessT<'_>) -> *mut dyn IPC::SendQueueOwner {
    // `SendQueue.owner` is a BACKREF — the SendQueue is stored inline in
    // `Subprocess.ipc_data` and dropped before the Subprocess is freed.
    // Erase the borrowed `'a` (raw-pointer lifetimes are not enforced) so the
    // unsizing coercion to `dyn SendQueueOwner + 'static` is well-formed.
    ptr.cast::<SubprocessT<'static>>() as *mut dyn IPC::SendQueueOwner
}

bun_output::declare_scope!(Subprocess, hidden);

// `SpawnOptions.Stdio` in Zig is a platform-dependent nested decl. Rust enums
// cannot nest type decls, so process.rs defines `PosixStdio` / `WindowsStdio`
// as siblings; alias the active one here so the body stays platform-neutral.
#[cfg(not(windows))]
type SpawnOptionsStdio = spawn::PosixStdio;
#[cfg(windows)]
type SpawnOptionsStdio = spawn::WindowsStdio;

// TODO(port): move to runtime_sys
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
    let arg0 = first_cmd.to_slice_or_null(global_this)?;
    // `arg0` drops at scope exit (was `defer arg0.deinit()`).

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

    let actual_argv0: ZBox;

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
        unsafe { bun_core::ffi::cstr(BUN_DEFAULT_PATH_FOR_SPAWN) }.to_bytes()
    } else {
        b""
    };

    if path_to_use.is_empty() {
        actual_argv0 = ZBox::from_bytes(argv0_to_use);
    } else {
        let Some(resolved) = bun_which::which(&mut path_buf, path_to_use, cwd, argv0_to_use) else {
            return Err(throw_command_not_found(global_this, argv0_to_use));
        };
        actual_argv0 = ZBox::from_bytes(resolved.as_bytes());
    }

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
/// pushed into `argv` / `argv0`. The Zig original used a bump arena freed at the
/// end of `spawnMaybeSync`; here the caller's `Vec<ZBox>` plays the same role
/// and is dropped after `spawn_process` returns.
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

    *argv0 = Some(argv0_result.argv0.as_ptr());
    argv.push(argv0_result.arg0.as_ptr());
    // Transfer ownership to the caller's backing store so the pointers above
    // stay valid past `spawn_process` (Zig used a bump arena freed at fn exit).
    storage.push(argv0_result.argv0);
    storage.push(argv0_result.arg0);

    let mut arg_index: usize = 1;
    while let Some(value) = cmds_array.next()? {
        let arg = value.to_bun_string(global_this)?;
        // `arg` derefs on drop (was `defer arg.deref()`).

        // Check for null bytes in argument (security: prevent null byte injection)
        if arg.index_of_ascii_char(0).is_some() {
            return Err(global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'args[{}]' must be a string without null bytes. Received \"{}\"",
                        arg_index,
                        arg.to_zig_string()
                    ),
                )
                .throw());
        }

        let owned = arg.to_owned_slice_z();
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
                return Err(global_this.throw_stack_overflow());
            }
        }
    }

    // PERF(port): was arena bulk-free — argv/env strings allocated per-iteration; profile in Phase B.
    // Backing store for every NUL-terminated string whose `*const c_char` is
    // pushed into `argv` / `argv0` / `env_array` below. Zig used a bump arena
    // (`arena.deinit()` at fn exit); this `Vec` is the Rust equivalent and
    // drops after `spawn_process` returns, freeing all argv/env allocations.
    let mut cstr_storage: Vec<ZBox> = Vec::new();

    let mut override_env = false;
    let mut env_array: Vec<CStrPtr> = Vec::new();
    // SAFETY: `bun_vm()` returns the live VirtualMachine for this thread; it
    // outlives this call frame.
    let jsc_vm: &mut jsc::VirtualMachineRef = global_this.bun_vm().as_mut();

    let mut cwd: &[u8] = bun_resolver::fs::FileSystem::get().top_level_dir;

    let mut stdio: [Stdio; 3] = [Stdio::Ignore, Stdio::Pipe, Stdio::Inherit];

    if IS_SYNC {
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
    let mut cmd_value = JSValue::ZERO;
    let mut detached = false;
    let mut args = args_;
    // TODO(port): Zig used `if (is_sync) void else ?IPC.Mode`; Rust const-generic bool
    // can't gate field type. Always Option<IPC::Mode>; IS_SYNC branches never read it.
    let mut maybe_ipc_mode: Option<IPC::Mode> = None;
    let mut ipc_callback: JSValue = JSValue::ZERO;
    let mut extra_fds: Vec<SpawnOptionsStdio> = Vec::new();
    let mut argv0: Option<*const c_char> = None;
    let mut ipc_channel: i32 = -1;
    let mut timeout: Option<i32> = None;
    let mut kill_signal: SignalCode = SignalCode::DEFAULT;
    let mut max_buffer: Option<i64> = None;

    let mut windows_hide: bool = false;
    let mut windows_verbatim_arguments: bool = false;
    let mut abort_signal: Option<*mut WebCore::AbortSignal> = None;
    let mut terminal_info: Option<TerminalCreateResult> = None;
    let mut existing_terminal: Option<bun_ptr::BackRef<Terminal>> = None; // Existing terminal passed by user
    let mut terminal_js_value: JSValue = JSValue::ZERO;
    // TODO(port): the Zig `defer` block at function end (abort_signal.unref + terminal cleanup)
    // is implemented via scopeguard below; disarmed where the Zig set the locals to null.
    let mut defer_guard = scopeguard::guard(
        (&mut abort_signal, &mut terminal_info),
        |(abort_signal, terminal_info): (
            &mut Option<*mut WebCore::AbortSignal>,
            &mut Option<TerminalCreateResult>,
        )| {
            if let Some(signal) = abort_signal.take() {
                // signal was ref()'d when stored; unref releases that ref.
                // `AbortSignal` is an `opaque_ffi!` ZST handle; `opaque_ref` is
                // the centralised non-null deref proof.
                WebCore::AbortSignal::opaque_ref(signal).unref();
            }
            // If we created a new terminal but spawn failed, close it. The
            // writer/reader/finalize deref paths release the remaining refs.
            // Downgrade the JSRef so the wrapper is GC-eligible, and mark
            // finalized so onReaderDone skips the JS exit callback — the user
            // never received this terminal (spawn threw).
            if let Some(info) = terminal_info.take() {
                // `abandon_from_spawn` is the spawn-side error-path teardown
                // (downgrade JSRef, mark finalized, close_internal).
                info.term().abandon_from_spawn();
            }
        },
    );
    // PORT NOTE: reshaped for borrowck — re-borrow through the guard tuple.
    let (abort_signal, terminal_info) = &mut *defer_guard;

    // Owned ZBox for `cwd` held here so the `&[u8]` borrow stays valid until
    // `spawn_process` returns (Zig used the bump arena).
    let mut cwd_owned: Option<ZBox> = None;
    {
        if args.is_empty_or_undefined_or_null() {
            return Err(global_this.throw_invalid_arguments(format_args!("cmd must be an array")));
        }

        let args_type = args.js_type();
        if args_type.is_array() {
            cmd_value = args;
            args = secondary_args_value.unwrap_or(JSValue::ZERO);
        } else if !args.is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!("cmd must be an array")));
        } else if let Some(cmd_value_) = args.get_truthy(global_this, "cmd")? {
            cmd_value = cmd_value_;
        } else {
            return Err(global_this.throw_invalid_arguments(format_args!("cmd must be an array")));
        }

        if args.is_object() {
            if let Some(argv0_) = args.get_truthy(global_this, "argv0")? {
                let argv0_str = argv0_.get_zig_string(global_this)?;
                if argv0_str.len > 0 {
                    let owned = argv0_str.to_owned_slice_z();
                    argv0 = Some(owned.as_ptr());
                    cstr_storage.push(owned);
                }
            }

            // need to update `cwd` before searching for executable with `Which.which`
            if let Some(cwd_) = args.get_truthy(global_this, "cwd")? {
                let cwd_str = cwd_.get_zig_string(global_this)?;
                if cwd_str.len > 0 {
                    cwd_owned = Some(cwd_str.to_owned_slice_z());
                    // `cwd_owned` is never mutated again, so this borrow is valid
                    // for every read of `cwd` below.
                    cwd = cwd_owned.as_ref().unwrap().as_bytes();
                }
            }
        }

        if !args.is_empty() && args.is_object() {
            // Reject terminal option on spawnSync
            if IS_SYNC {
                if args.get_truthy(global_this, "terminal")?.is_some() {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "terminal option is only supported for Bun.spawn, not Bun.spawnSync",
                    )));
                }
            }

            // This must run before the stdio parsing happens
            if !IS_SYNC {
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
                                    if !global_this.has_exception() {
                                        return Err(global_this.throw_invalid_argument_type(
                                            "spawn",
                                            "serialization",
                                            "string",
                                        ));
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
                if let Some(signal) = WebCore::AbortSignal::from_js(signal_val) {
                    // `from_js` returns a live FFI handle owned by JS.
                    // `AbortSignal` is an `opaque_ffi!` ZST handle; `opaque_ref`
                    // is the centralised non-null deref proof.
                    **abort_signal = Some(WebCore::AbortSignal::opaque_ref(signal).ref_());
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

                on_disconnect_callback = if IS_SYNC {
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

                on_exit_callback = if IS_SYNC {
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
                            Stdio::extract(&mut stdio[i as usize], global_this, i, value, IS_SYNC)?;
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
                            Stdio::extract(&mut new_item, global_this, i, value, IS_SYNC)?;

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
                    Stdio::extract(&mut stdio[0], global_this, 0, value, IS_SYNC)?;
                }

                if let Some(value) = args.get(global_this, "stderr")? {
                    Stdio::extract(&mut stdio[2], global_this, 2, value, IS_SYNC)?;
                }

                if let Some(value) = args.get(global_this, "stdout")? {
                    Stdio::extract(&mut stdio[1], global_this, 1, value, IS_SYNC)?;
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
                        if timeout_value.is_number()
                            && timeout_value.as_number().is_infinite()
                            && timeout_value.as_number() > 0.0
                        {
                            break 'brk;
                        }

                        // TODO(port): `JSGlobalObject::validate_integer_range` lives in
                        // a sibling impl block currently behind a different `mod` re-export;
                        // route through the `bun_sql_jsc` extension trait until the
                        // inherent method is re-exported from `bun_jsc::JSGlobalObject`.
                        use bun_sql_jsc::jsc::JSGlobalObjectSqlExt as _;
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
                            // PORT NOTE: Zig `@intCast(@as(u31, @truncate(timeout_int)))` — truncate to u31 then widen to i32.
                        }
                    }
                }
            }

            if let Some(val) = args.get(global_this, "killSignal")? {
                kill_signal = signal_code_from_js(val, global_this)?;
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

            if !IS_SYNC {
                if let Some(terminal_val) = args.get_truthy(global_this, "terminal")? {
                    // Check if it's an existing Terminal object
                    if let Some(terminal) = terminal_body::js::from_js(terminal_val) {
                        // `from_js` returns the live `m_ctx` pointer borrowed
                        // from the JS wrapper; it stays valid for as long as
                        // `terminal_val` is reachable (kept alive below via
                        // `terminal_js_value`), so the `BackRef` invariant
                        // (pointee outlives holder) holds for this scope.
                        let term = bun_ptr::BackRef::from(terminal);
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
                        let mut term_options =
                            TerminalOptions::parse_from_js(global_this, terminal_val)?;
                        match Terminal::create_from_spawn(global_this, &mut term_options) {
                            Ok(created) => {
                                **terminal_info = Some(TerminalCreateResult {
                                    // Transfer the +1 ref to `Subprocess.terminal` (released
                                    // in `Subprocess::finalize`); the scopeguard's
                                    // `abandon_from_spawn` path covers the error case.
                                    // `IntrusiveRc::into_raw` is never null (NonNull-backed).
                                    terminal: bun_ptr::BackRef::from(
                                        core::ptr::NonNull::new(created.terminal.into_raw())
                                            .expect("IntrusiveRc non-null"),
                                    ),
                                    js_value: created.js_value,
                                });
                            }
                            Err(err) => {
                                drop(term_options);
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
                                    terminal_info.as_ref().unwrap().term().get_slave_fd()
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

    // Owns the `K=V\0` storage when inheriting the parent env (Zig used the
    // bump arena; here the struct is the arena and lives until spawn returns).
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
        // PORT NOTE: Zig assigned `env_array.items = envp` (sentinel slice — the
        // trailing `null` lives at `[len]`, outside `.items`). The Rust port's
        // `as_slice()` *includes* the trailing null, so strip it; the common
        // tail below re-appends one after the optional NODE_CHANNEL_* entries.
        let entries = envmap.as_slice();
        env_array.extend_from_slice(&entries[..entries.len().saturating_sub(1)]);
        inherited_env_storage = Some(envmap);
    }
    let _ = &inherited_env_storage;

    // PORT NOTE: Zig `inline for (0..stdio.len)` — unrolled here as a regular for; const N=3.
    for fd_index in 0..stdio.len() {
        if stdio[fd_index].can_use_memfd(IS_SYNC, fd_index > 0 && max_buffer.is_some()) {
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
                        // PORT NOTE: Zig closes the fd then writes
                        // `stdio[i] = .ignore`. In Rust that assignment would
                        // Drop the old `Stdio::Memfd` and re-close the same fd
                        // (EBADF → fd.rs debug_assert). `Stdio`'s Drop already
                        // closes a Memfd, so just replace with `.ignore` and
                        // let Drop perform the single close.
                        drop(core::mem::replace(&mut stdio[fd_index], Stdio::Ignore));
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
            if let Err(_err) = env_array.try_reserve(3) {
                let _ = global_this.throw_out_of_memory();
                return Ok(JSValue::ZERO);
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
                    break 'brk i32::try_from(ipc_channel + 3).expect("int cast");
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
            // PERF(port): was assume_capacity
            env_array.push(pipe_env.as_ptr().cast::<c_char>());

            // PERF(port): was assume_capacity
            env_array.push(match ipc_mode {
                // PORT NOTE: Zig `inline else => |t| "..." ++ @tagName(t)` — written out per variant.
                IPC::Mode::Json => b"NODE_CHANNEL_SERIALIZATION_MODE=json\0"
                    .as_ptr()
                    .cast::<c_char>(),
                IPC::Mode::Advanced => b"NODE_CHANNEL_SERIALIZATION_MODE=advanced\0"
                    .as_ptr()
                    .cast::<c_char>(),
            });
        }
    }

    env_array.push(core::ptr::null());
    argv.push(core::ptr::null());

    if IS_SYNC {
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
        // `jsc_vm()` is the audited safe `&VM` accessor (centralised opaque-ZST
        // deref proof in `VirtualMachine`).
        && !jsc_vm.jsc_vm().has_execution_time_limit()
        && !jsc_vm.is_inspector_enabled()
        && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH
            .get()
            .unwrap_or(false);

    // For spawnSync, use an isolated event loop to prevent JavaScript timers from firing
    // and to avoid interfering with the main event loop.
    //
    // PORT NOTE: borrowck — `rare_data()` borrows `jsc_vm` mutably and the
    // returned `&mut SpawnSyncEventLoop` keeps that borrow alive, so we cannot
    // also pass `jsc_vm` into `spawn_sync_event_loop`/`prepare`/`cleanup` while
    // holding it. Route through a raw `*mut VirtualMachineRef` for the duration.
    let jsc_vm_ptr: *mut jsc::VirtualMachineRef = jsc_vm;
    // For IS_SYNC, use the isolated loop's `event_loop` (created by
    // `SpawnSyncEventLoop::init`) so stdio readers/writers register on it
    // instead of the main loop — matches Zig
    // `&jsc_vm.rareData().spawnSyncEventLoop(jsc_vm).event_loop`.
    let event_loop: *mut jsc::event_loop::EventLoop = if IS_SYNC {
        // SAFETY: see PORT NOTE above; `spawn_sync_event_loop` re-borrows the
        // same VM via the raw pointer for its `vm` arg.
        unsafe {
            let sync_loop = (*jsc_vm_ptr)
                .rare_data()
                .spawn_sync_event_loop(&mut *jsc_vm_ptr);
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

    // PORT NOTE: reshaped for borrowck — `defer!` is non-`move`, so the closure
    // would capture the *place* `*jsc_vm_ptr` and conflict with later
    // `&mut *jsc_vm_ptr` re-borrows below. Copy the raw pointer into a sibling
    // local so the closure's captured place is disjoint.
    let jsc_vm_ptr_cleanup = jsc_vm_ptr;
    scopeguard::defer! {
        if IS_SYNC {
            // SAFETY: defer runs while `jsc_vm` (the thread VM) is still live.
            unsafe {
                let main_loop = (*jsc_vm_ptr_cleanup).event_loop();
                (*jsc_vm_ptr_cleanup)
                    .rare_data()
                    .spawn_sync_event_loop(&mut *jsc_vm_ptr_cleanup)
                    .cleanup(jsc_vm_ptr_cleanup.cast(), main_loop.cast());
            }
        }
    }

    let loop_handle = EventLoopHandle::init(event_loop.cast::<()>());

    let mut spawn_options = SpawnOptions {
        cwd: cwd.to_vec().into_boxed_slice(),
        detached,
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
        extra_fds: core::mem::take(&mut extra_fds).into_boxed_slice(),
        argv0,
        can_block_entire_thread_to_reduce_cpu_usage_in_fast_path,
        // Only pass pty_slave_fd for newly created terminals (for setsid+TIOCSCTTY setup).
        // For existing terminals, the session is already set up - child just uses the fd as stdio.
        #[cfg(unix)]
        pty_slave_fd: match terminal_info.as_ref() {
            Some(ti) => ti.term().get_slave_fd().native(),
            None => -1,
        },
        #[cfg(windows)]
        pseudoconsole: existing_terminal
            .as_deref()
            .or_else(|| terminal_info.as_ref().map(TerminalCreateResult::term))
            .and_then(Terminal::get_pseudoconsole),

        #[cfg(windows)]
        windows: spawn::WindowsOptions {
            hide_window: windows_hide,
            verbatim_arguments: windows_verbatim_arguments,
            loop_: loop_handle,
        },
        ..Default::default()
    };

    let mut spawned = match spawn::spawn_process(&spawn_options, argv.as_ptr(), env_array.as_ptr())
    {
        Err(err) if err == bun_core::err!("EMFILE") || err == bun_core::err!("ENFILE") => {
            // Windows: close+free the heap `uv::Pipe` handles that
            // `as_spawn_option` allocated and `spawn_process_windows` may have
            // `uv_pipe_init`-registered on the spawn-sync loop. Skipping this
            // leaks them and trips `assert(err == 0)` in `uv_loop_delete` at
            // `SpawnSyncEventLoop::Drop`. POSIX: no-op. (Zig spec
            // js_bun_spawn_bindings.zig:627 — `spawn_options.deinit()`.)
            spawn_options.deinit();
            let display_path: &ZStr = if !argv.is_empty() && !argv[0].is_null() {
                // SAFETY: argv[0] is non-null and points at a NUL-terminated
                // string we built above (lives in `arg0_backing`/`arg_backing`).
                ZStr::from_cstr(unsafe { bun_core::ffi::cstr(argv[0]) })
            } else {
                ZStr::EMPTY
            };
            let mut systemerror = sys::Error::from_code(
                if err == bun_core::err!("EMFILE") {
                    sys::Errno::EMFILE
                } else {
                    sys::Errno::ENFILE
                },
                sys::Tag::posix_spawn,
            )
            .with_path(display_path)
            .to_system_error();
            systemerror.errno = if err == bun_core::err!("EMFILE") {
                -UV_E::MFILE
            } else {
                -UV_E::NFILE
            };
            return Err(global_this.throw_value(sys_system_error_to_js(systemerror, global_this)));
        }
        Err(err) => {
            // See EMFILE arm above — Zig spec js_bun_spawn_bindings.zig:637.
            spawn_options.deinit();
            let _ = global_this.throw_error(err, ": failed to spawn process");
            return Ok(JSValue::ZERO);
        }
        Ok(maybe) => match maybe {
            sys::Result::Err(err) => {
                // See EMFILE arm above — Zig spec js_bun_spawn_bindings.zig:642.
                spawn_options.deinit();
                match err.get_errno() {
                    errno @ (sys::Errno::EACCES
                    | sys::Errno::ENOENT
                    | sys::Errno::EPERM
                    | sys::Errno::EISDIR
                    | sys::Errno::ENOTDIR) => {
                        let display_path: &ZStr = if !argv.is_empty() && !argv[0].is_null() {
                            // SAFETY: argv[0] is non-null and points at a NUL-terminated
                            // string we built above (lives in `arg0_backing`/`arg_backing`).
                            ZStr::from_cstr(unsafe { bun_core::ffi::cstr(argv[0]) })
                        } else {
                            ZStr::EMPTY
                        };
                        if !display_path.as_bytes().is_empty() {
                            let mut systemerror = err.with_path(display_path).to_system_error();
                            if errno == sys::Errno::ENOENT {
                                systemerror.errno = -UV_E::NOENT;
                            }
                            return Err(global_this
                                .throw_value(sys_system_error_to_js(systemerror, global_this)));
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
    // PORT NOTE: `PosixSpawnResult::to_process` consumes `self` but only reads
    // `pid`/`pidfd`/`has_exited`. Zig kept using `spawned.stdin/stdout/stderr/
    // extra_pipes` afterward; in Rust, take those fields out first so the
    // partial move is explicit.
    let spawned_stdin = spawned.stdin.take();
    let spawned_stdout = spawned.stdout.take();
    let spawned_stderr = spawned.stderr.take();
    let mut spawned_extra_pipes = core::mem::take(&mut spawned.extra_pipes);
    // `to_process` returns a freshly Box-allocated `Process` carrying an
    // intrusive `ThreadSafeRefCount` initialized to 1. `Subprocess.process`
    // stores it as `*mut Process` (Zig: `*Process`); the matching `deref()` in
    // `Subprocess::finalize` (or the error path below) frees the Box when the
    // refcount reaches zero.
    let process: *mut Process = spawned.to_process(loop_handle, IS_SYNC);

    #[cfg(unix)]
    let posix_ipc_fd = if !IS_SYNC && maybe_ipc_mode.is_some() {
        spawned_extra_pipes[usize::try_from(ipc_channel).expect("int cast")].fd()
    } else {
        Fd::INVALID
    };

    // When run synchronously, subprocess isn't garbage collected.
    //
    // PORT NOTE: Zig built a placeholder struct, took its address for
    // `MaxBuf::create_for_subprocess`, then overwrote `subprocess.*` with the
    // real aggregate. In Rust that whole-struct reassignment would (a) move
    // `process` twice and (b) run Drop on every field of the placeholder. Build
    // the struct once with its final field values instead, then fill in the
    // address-dependent fields (maxbufs, ipc_data on Windows) afterward.
    let subprocess_ptr = bun_core::heap::into_raw(Box::new(SubprocessT {
        global_this: bun_ptr::BackRef::new(global_this),
        // SAFETY: `to_process` returns a non-null `Box::into_raw` pointer; the
        // intrusive ref is released in `Subprocess::finalize`.
        process: unsafe { bun_ptr::BackRef::from_raw(process) },
        pid_rusage: Cell::new(None),
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
        stdin: JsCell::new(Writable::Ignore),
        stdout: JsCell::new(Readable::Ignore),
        stderr: JsCell::new(Readable::Ignore),
        // 1. JavaScript.
        // 2. Process.
        ref_count: bun_ptr::RefCount::init_exact_refs(2),
        stdio_pipes: JsCell::new(core::mem::take(&mut spawned_extra_pipes)),
        ipc_data: JsCell::new(None),
        flags: Cell::new(if IS_SYNC {
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
        abort_signal: Cell::new(None),
        event_loop_timer_refd: Cell::new(false),
        event_loop_timer: JsCell::new(crate::timer::EventLoopTimer::init_paused(
            crate::timer::EventLoopTimerTag::SubprocessTimeout,
        )),
        exited_due_to_maxbuf: Cell::new(None),
    }));
    // SAFETY: subprocess_ptr is a freshly-boxed Subprocess; we hold the only reference.
    let subprocess = unsafe { &mut *subprocess_ptr };
    // Erase the borrow lifetime to 'static for the intrusive back-pointer
    // (PipeReader stores it as raw NonNull). subprocess_ptr is non-null (just boxed).
    let subprocess_nn: NonNull<SubprocessT<'static>> =
        NonNull::new(subprocess_ptr.cast()).expect("Box::into_raw returned null");

    // Address-dependent fields, filled now that `subprocess` has a stable address.
    {
        let mut mb = None;
        MaxBuf::create_for_subprocess(&mut mb, max_buffer);
        subprocess.stderr_maxbuf.set(mb);
        let mut mb = None;
        MaxBuf::create_for_subprocess(&mut mb, max_buffer);
        subprocess.stdout_maxbuf.set(mb);
    }

    #[cfg(windows)]
    if !IS_SYNC {
        if let Some(ipc_mode) = maybe_ipc_mode {
            subprocess.ipc_data.set(Some(IPC::SendQueue::init(
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
                    fd.close();
                }
                if let Some(fd) = spawned_stderr {
                    fd.close();
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
                        spawn::WindowsStdioResult::Unavailable => {}
                    }
                }
            }
            subprocess.finalize_streams();
            subprocess.process_mut().detach();
            // Zig: `subprocess.process.deref()` releases the intrusive ref
            // (finalize() won't run on this error path).
            // SAFETY: this error path returns without ever reading `process` again.
            unsafe { Process::deref(subprocess.process.as_ptr()) };
            let mut mb = subprocess.stdout_maxbuf.get();
            MaxBuf::remove_from_subprocess(&mut mb);
            subprocess.stdout_maxbuf.set(mb);
            let mut mb = subprocess.stderr_maxbuf.get();
            MaxBuf::remove_from_subprocess(&mut mb);
            subprocess.stderr_maxbuf.set(mb);
            subprocess.deref();
            subprocess.deref();
            // PORT NOTE: Zig returned `err` directly (`bun.JSError` or
            // `error.OutOfMemory`); the Rust port's `Writable::init` returns
            // `bun_core::Error`. Map non-thrown to OOM.
            if global_this.has_exception() {
                return Err(JsError::Thrown);
            }
            let _ = err;
            return Err(global_this.throw_out_of_memory());
        }
    }

    // PORT NOTE: Zig passed `allocator` (unused/autofix) — dropped in Rust port of Readable::init.
    // event_loop points to the live JSC EventLoop for this thread.
    let event_loop_nn = NonNull::new(event_loop).expect("event_loop is null");
    subprocess.stdout.set(Readable::init(
        core::mem::replace(&mut stdio[1], Stdio::Ignore),
        event_loop_nn,
        subprocess_nn,
        spawned_stdout,
        subprocess.stdout_maxbuf.get(),
        IS_SYNC,
    ));
    subprocess.stderr.set(Readable::init(
        core::mem::replace(&mut stdio[2], Stdio::Ignore),
        event_loop_nn,
        subprocess_nn,
        spawned_stderr,
        subprocess.stderr_maxbuf.get(),
        IS_SYNC,
    ));

    // For inline terminal options: close parent's slave_fd so EOF is received when child exits
    // For existing terminal: keep slave_fd open so terminal can be reused for more spawns
    if let Some(info) = terminal_info.take() {
        terminal_js_value = info.js_value;
        // Spawn succeeded so the child holds its own copy of the slave fd.
        info.term().close_slave_fd();
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

    // PORT NOTE: Zig left this `undefined` and only read it on the assigned path; Rust uses
    // Option since `IPC::Socket` is a tagged union (zeroed enum is UB).
    #[cfg(unix)]
    let mut posix_ipc_info: Option<IPC::Socket> = None;
    #[cfg(unix)]
    if !IS_SYNC {
        if let Some(mode) = maybe_ipc_mode {
            // SAFETY: re-borrow `jsc_vm` through the raw pointer for the nested
            // `vm` arg while `rare_data()` holds the outer &mut.
            let raw_socket = unsafe { &mut *jsc_vm_ptr }
                .rare_data()
                .spawn_ipc_group(unsafe { &mut *jsc_vm_ptr })
                .from_fd(
                    bun_uws::SocketKind::SpawnIpc,
                    None,
                    core::mem::size_of::<*mut IPC::SendQueue>() as core::ffi::c_int,
                    posix_ipc_fd.native(),
                    true,
                );
            if !raw_socket.is_null() {
                let socket = raw_socket;
                subprocess.ipc_data.set(Some(IPC::SendQueue::init(
                    mode,
                    subprocess_ipc_owner(subprocess_ptr),
                    IPC::SocketUnion::Uninitialized,
                )));
                posix_ipc_info = Some(IPC::Socket::from(socket));
            }
        }
    }

    // `Subprocess::ipc()` centralises the single unsafe `JsCell` deref;
    // `ipc_data` is inline in the freshly-boxed Subprocess and no other borrow
    // is live (single JS thread).
    if let Some(ipc_data) = subprocess.ipc() {
        #[cfg(unix)]
        {
            if let Some(posix_ipc_info) = posix_ipc_info {
                if let Some(ctx) = posix_ipc_info.ext::<*mut IPC::SendQueue>() {
                    // SAFETY: `ctx` is the live ext-slot pointer returned by uSockets;
                    // it stays valid for the socket's lifetime.
                    unsafe { *ctx = std::ptr::from_mut(ipc_data) };
                    ipc_data.socket = IPC::SocketUnion::Open(posix_ipc_info);
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
            // Zig: `stdio_pipes.items[ipc_channel].buffer` — direct union-field
            // access (the IPC channel is always a `buffer` pipe on Windows).
            // Ownership of the heap `uv::Pipe` transfers to `ipc_data.socket`;
            // neutralize the slot up front so `finalizeStreams` can't
            // double-close it (the Box would otherwise drop on reassignment).
            let ipc_pipe: *mut bun_libuv_sys::Pipe = subprocess.stdio_pipes.with_mut(|pipes| {
                match core::mem::take(&mut pipes[idx]) {
                    spawn::WindowsStdioResult::Buffer(pipe) => bun_core::heap::into_raw(pipe),
                    other => {
                        // Restore the slot before panicking so the
                        // `Subprocess` finalizer still sees the original
                        // variant. Zig's `.buffer` field access is
                        // safety-checked in ReleaseSafe and panics on a
                        // non-`.buffer` variant; mirror that with
                        // `unreachable!` (NOT `debug_assert!` — that would
                        // compile out in release and feed null to
                        // `windows_configure_server`, which immediately
                        // dereferences it).
                        pipes[idx] = other;
                        unreachable!("IPC channel stdio is not a buffer pipe");
                    }
                }
            });
            // PROVENANCE: `windows_configure_server` STORES the `*mut SendQueue`
            // in `uv_handle_t.data` for the pipe's lifetime, so it takes a raw
            // pointer (not `&mut self`) — see its safety doc. NOTE: this still
            // derives from the `ipc_data` reborrow (same as the unix branch's
            // `ptr::from_mut(ipc_data)` above); a true root-raw projection
            // through `Option<SendQueue>` is tracked separately.
            // SAFETY: `ipc_data` points at the live SendQueue inline in
            // `*subprocess_ptr`; no other `&mut` to it is live in this scope.
            if let Some(err) = unsafe {
                IPC::SendQueue::windows_configure_server(core::ptr::from_mut(ipc_data), ipc_pipe)
            }
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
        // PORT NOTE: Zig writes `subprocess.stdin.pipe.signal =
        // Signal.init(&subprocess.stdin)` and the callback `@fieldParentPtr`s
        // back to the `Subprocess`. In Rust the SignalHandler impl is on
        // `Subprocess` and the stored back-pointer is the `*mut Subprocess`
        // (whole-allocation provenance), so `Writable::on_close` can raw-project
        // `stdin` instead of doing out-of-provenance pointer arithmetic. The
        // vtable only dereferences this pointer later on the JS thread, after
        // the local `subprocess` borrow has ended.
        // SAFETY: `subprocess_ptr` is the stable boxed `Subprocess` (from
        // `heap::alloc` above) and `stdin` was just confirmed to be the
        // `Pipe` variant; the signal's stored back-pointer remains valid for
        // the lifetime of the FileSink, which is owned by `subprocess.stdin`.
        unsafe {
            if let Writable::Pipe(pipe) = (*subprocess_ptr).stdin.get() {
                (*pipe.as_ptr())
                    .signal
                    .set(WebCore::streams::Signal::init_with_type::<SubprocessT<'_>>(
                        subprocess_ptr,
                    ));
            }
        }
    }

    let out = if !IS_SYNC {
        // `subprocess_ptr` came from `heap::alloc` above and has not yet been
        // wrapped; ownership transfers to the C++ JS cell (released via
        // `SubprocessClass__finalize`). Zig's `subprocess.toJS(globalThis)` did
        // not re-allocate, so use the raw-ptr entrypoint instead of the
        // by-value `JsClass::to_js` (which would re-box).
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

    if !IS_SYNC {
        // This must go before other things happen so that the exit handler is
        // registered before onProcessExit can potentially be called.
        if let Some(timeout_val) = timeout {
            let ts =
                Timespec::ms_from_now(TimespecMockMode::AllowMockedTime, i64::from(timeout_val));
            // PORT NOTE: `EventLoopTimer.next` is a local-stub Timespec until
            // `bun_event_loop` switches to `bun_core::Timespec`; copy fieldwise.
            subprocess.event_loop_timer.with_mut(|t| {
                t.next = crate::timer::ElTimespec {
                    sec: ts.sec,
                    nsec: ts.nsec,
                };
            });
            // Zig: `globalThis.bunVM().timer.insert(&subprocess.event_loop_timer)`.
            // `Timer::All` lives in `bun_runtime`; reach it via the
            // `RuntimeHooks` dispatch (`VirtualMachineRef::timer_insert`) which
            // forwards to `crate::timer::All::insert`.
            // SAFETY: `jsc_vm_ptr` is the live per-thread VM; the timer node is
            // owned by the boxed `Subprocess` and stays at a stable address
            // until `Subprocess::finalize` removes it from the heap.
            unsafe {
                jsc::VirtualMachineRef::timer_insert(
                    jsc_vm_ptr,
                    subprocess.event_loop_timer.as_ptr(),
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

    // PORT NOTE: reshaped for borrowck — copy `subprocess_ptr` so the
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
                proc.wait(IS_SYNC);
            }
        }
    }

    if let Writable::Buffer(buffer) = subprocess.stdin.get() {
        if let Err(err) = Writable::buffer_writer_mut(buffer).start() {
            let _ = subprocess.try_kill(subprocess.kill_signal);
            let _ = global_this.throw_value(err.to_js(global_this));
            return Err(JsError::Thrown);
        }
    }

    if let Readable::Pipe(pipe) = subprocess.stdout.get() {
        // PORT NOTE: pass `subprocess_nn` (the `NonNull<Subprocess<'static>>`
        // captured above) instead of the live `&mut subprocess`, which would
        // alias with the `&mut subprocess.stdout` borrow held by `pipe`.
        if let Err(err) = Readable::pipe_reader_mut(pipe).start(subprocess_nn, event_loop_nn) {
            let _ = subprocess.try_kill(subprocess.kill_signal);
            let _ = global_this.throw_value(err.to_js(global_this));
            return Err(JsError::Thrown);
        }
        if (IS_SYNC || !lazy) && matches!(subprocess.stdout.get(), Readable::Pipe(_)) {
            if let Readable::Pipe(pipe) = subprocess.stdout.get() {
                Readable::pipe_reader_mut(pipe).read_all();
            }
        }
    }

    if let Readable::Pipe(pipe) = subprocess.stderr.get() {
        // PORT NOTE: see stdout arm above — avoid aliased &mut.
        if let Err(err) = Readable::pipe_reader_mut(pipe).start(subprocess_nn, event_loop_nn) {
            let _ = subprocess.try_kill(subprocess.kill_signal);
            let _ = global_this.throw_value(err.to_js(global_this));
            return Err(JsError::Thrown);
        }

        if (IS_SYNC || !lazy) && matches!(subprocess.stderr.get(), Readable::Pipe(_)) {
            if let Readable::Pipe(pipe) = subprocess.stderr.get() {
                Readable::pipe_reader_mut(pipe).read_all();
            }
        }
    }

    **should_close_memfd = false;

    // Once everything is set up, we can add the abort listener
    // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
    // Therefore, we must do this at the very end.
    if let Some(signal) = abort_signal.take() {
        // SAFETY: `signal` is a live *mut AbortSignal carrying the +1 ref taken
        // above; ownership of that ref transfers to `subprocess.abort_signal`.
        // `add_listener` may synchronously fire `on_abort_signal` (already
        // aborted), which re-enters via `subprocess_ptr` — write through the
        // raw pointer so no `&mut Subprocess` is held across the call.
        unsafe {
            (*signal).pending_activity_ref();
            let _ = (*signal).add_listener(subprocess_ptr.cast(), Subprocess::on_abort_signal);
            (*subprocess_ptr).abort_signal.set(NonNull::new(signal));
        }
    }

    if !IS_SYNC {
        if !subprocess.has_exited() {
            // SAFETY: jsc_vm_ptr points to the live thread VM.
            unsafe { &mut *jsc_vm_ptr }.on_subprocess_spawn(subprocess.process.as_ptr());
        }
        return Ok(out);
    }

    // PORT NOTE: Zig `comptime bun.assert(is_sync)` — anonymous const items cannot capture
    // const-generic params, so use a runtime debug_assert (the !IS_SYNC path returned above).
    debug_assert!(IS_SYNC);

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
                // SAFETY: see the matching block above.
                unsafe {
                    (*signal).pending_activity_ref();
                    let _ =
                        (*signal).add_listener(subprocess_ptr.cast(), Subprocess::on_abort_signal);
                    (*subprocess_ptr).abort_signal.set(NonNull::new(signal));
                }
            }
        }
        sys::Result::Err(_) => {
            subprocess.process_mut().wait(true);
        }
    }

    if !subprocess.has_exited() {
        // SAFETY: jsc_vm_ptr points to the live thread VM.
        unsafe { &mut *jsc_vm_ptr }.on_subprocess_spawn(subprocess.process.as_ptr());
    }

    let mut did_timeout = false;

    // Use the isolated event loop to tick instead of the main event loop
    // This ensures JavaScript timers don't fire and stdin/stdout from the main process aren't affected
    {
        let mut absolute_timespec = Timespec::EPOCH;
        let mut now = Timespec::now(TimespecMockMode::AllowMockedTime);
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
                // PORT NOTE: `AbortSignal::Timeout.event_loop_timer` uses the
                // bun_event_loop-local `Timespec` stub; convert fieldwise.
                if abort_signal_timeout.event_loop_timer.state
                    == crate::timer::EventLoopTimerState::ACTIVE
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

        // SAFETY: jsc_vm_ptr is the live thread VM; re-borrowed for the nested arg.
        let sync_loop = unsafe { &mut *jsc_vm_ptr }
            .rare_data()
            .spawn_sync_event_loop(unsafe { &mut *jsc_vm_ptr });

        while subprocess.compute_has_pending_activity() {
            // Re-evaluate this at each iteration of the loop since it may change between iterations.
            let bun_test_timeout: Timespec =
                if let Some(runner) = crate::test_runner::jest::Jest::runner() {
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
                TickState::Completed => {
                    now = Timespec::now(TimespecMockMode::AllowMockedTime);
                }
                TickState::Timeout => {
                    now = Timespec::now(TimespecMockMode::AllowMockedTime);
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
                            let mut active_file_strong = crate::test_runner::jest::Jest::runner()
                                .unwrap()
                                .bun_test_root
                                .active_file
                                // TODO: add a .cloneNonOptional()?
                                .clone();

                            let taken_active_file = active_file_strong.take().unwrap();

                            // SAFETY: jsc_vm_ptr is the live thread VM.
                            crate::test_runner::jest::Jest::runner()
                                .unwrap()
                                .remove_active_timeout(unsafe { &mut *jsc_vm_ptr });

                            // This might internally call `std.c.kill` on this
                            // spawnSync process. Even if we do that, we still
                            // need to reap the process. So we may go through
                            // the event loop again, but it should wake up
                            // ~instantly so we can drain the events.
                            crate::test_runner::bun_test::BunTest::bun_test_timeout_callback(
                                taken_active_file,
                                &absolute_timespec,
                                // SAFETY: jsc_vm_ptr is the live thread VM.
                                unsafe { &*jsc_vm_ptr },
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

    let signal_code = SubprocessT::get_signal_code(subprocess, global_this);
    let exit_code = SubprocessT::get_exit_code(subprocess, global_this);
    let stdout = subprocess
        .stdout
        .with_mut(|s| s.to_buffered_value(global_this))?;
    let stderr = subprocess
        .stderr
        .with_mut(|s| s.to_buffered_value(global_this))?;
    let resource_usage: JSValue = if !global_this.has_exception() {
        subprocess.create_resource_usage_object(global_this)?
    } else {
        JSValue::ZERO
    };
    let exited_due_to_timeout = did_timeout;
    let exited_due_to_max_buffer = subprocess.exited_due_to_maxbuf.get();
    let result_pid = JSValue::js_number_from_int32(subprocess.pid());
    // SAFETY: `subprocess_ptr` was produced by `heap::into_raw(Box::new(...))`
    // above (spawnSync path: never handed to a JS wrapper); reclaim ownership.
    // `subprocess` (`&mut *subprocess_ptr`) is not used after this line.
    SubprocessT::finalize(unsafe { Box::from_raw(subprocess_ptr) });

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

fn throw_command_not_found(global_this: &JSGlobalObject, command: &[u8]) -> JsError {
    // Zig returns `bun.JSError` (the error value itself); callers wrap in `Err(...)`.
    let err = SystemError {
        message: BunString::create_format(format_args!(
            "Executable not found in $PATH: \"{}\"",
            bstr::BStr::new(command)
        )),
        code: BunString::static_("ENOENT"),
        errno: -UV_E::NOENT,
        path: BunString::clone_utf8(command),
        syscall: BunString::EMPTY,
        hostname: BunString::EMPTY,
        fd: -1,
        dest: BunString::EMPTY,
    };
    global_this.throw_value(err.to_error_instance(global_this))
}

/// `storage` receives ownership of every `K=V\0` line whose pointer is pushed
/// into `envp` (and, for `PATH=`, sliced into `*path`). The Zig original used a
/// bump arena freed at the end of `spawnMaybeSync`; the caller's `Vec<ZBox>`
/// plays the same role and is dropped after `spawn_process` returns.
pub fn append_envp_from_js(
    global_this: &JSGlobalObject,
    object: &JSObject,
    envp: &mut Vec<CStrPtr>,
    path: &mut &[u8],
    storage: &mut Vec<ZBox>,
) -> JsResult<()> {
    let mut object_iter = JSPropertyIterator::init(
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
    while let Some(key) = object_iter.next()? {
        let value = object_iter.value;
        if value.is_undefined() {
            continue;
        }

        let value_bunstr = value.to_bun_string(global_this)?;
        // derefs on drop (was `defer value_bunstr.deref()`).

        // Check for null bytes in env key and value (security: prevent null byte injection)
        if key.index_of_ascii_char(0).is_some() {
            return Err(global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The property 'options.env['{}']' must be a string without null bytes. Received \"{}\"",
                        key.to_zig_string(),
                        key.to_zig_string()
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
                        key.to_zig_string(),
                        value_bunstr.to_zig_string()
                    ),
                )
                .throw());
        }

        // PORT NOTE: Zig `std.fmt.allocPrintSentinel(envp.allocator, "{f}={f}", .{key, value}, 0)`
        // PERF(port): was arena bulk-free — profile in Phase B.
        let line: ZBox = {
            let mut buf: Vec<u8> = Vec::new();
            write!(&mut buf, "{}={}", key, value_bunstr.to_zig_string())
                .map_err(|_| JsError::OutOfMemory)?;
            ZBox::from_vec(buf)
        };

        if key.eql_comptime(b"PATH") {
            // SAFETY: `line` is moved into `storage` below (a `Vec<ZBox>` that
            // outlives every read of `*path`), and `ZBox` is heap-backed so the
            // bytes don't move when the `ZBox` value itself is moved.
            *path = unsafe { bun_ptr::detach_lifetime(&line.as_bytes()[b"PATH=".len()..]) };
        }

        envp.push(line.as_ptr());
        storage.push(line);
    }
    Ok(())
}

// ported from: src/runtime/api/bun/js_bun_spawn_bindings.zig

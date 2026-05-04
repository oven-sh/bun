//! Spawns and watches the WebView host subprocess. macOS only.
//!
//! WKWebView hard-asserts `pthread_main_np()` (MainThreadCocoa.mm). Bridging
//! CFRunLoop into kqueue on the JS thread was abandoned: CFRunLoopWakeUp's
//! ignoreWakeUps flag check is a userspace drop before the mach send — lldb on
//! hangs showed the CF wake port seqno=0 over the process lifetime. No wake
//! path exists for kqueue to observe.
//!
//! The host child runs CFRunLoopRun() as its real main loop. CF manages
//! ignoreWakeUps correctly when it owns the loop. Parent talks over a
//! socketpair; usockets handles the parent end (C++ side), CFFileDescriptor
//! handles the child end. Socket EOF = parent died = child exits.
//!
//! This file owns process lifetime only. The usockets client lives in C++
//! (WebKitBackend.cpp) — usockets is a C API and the frame protocol is C structs.

use core::ffi::c_char;
use core::ptr::{self, NonNull};

use bun_core::{self, Error};
use bun_jsc::{JSGlobalObject, VirtualMachine};
use bun_output::{declare_scope, scoped_log};
use bun_spawn::{self, Process, Rusage, SpawnOptions, Status};
use bun_sys::{self, Fd};

declare_scope!(WebViewHost, hidden);

pub struct HostProcess {
    // TODO(port): lifetime — intrusive refcount (`.deref()` called in on_process_exit);
    // no LIFETIMES.tsv row for this field, kept raw to match Zig `*bun.spawn.Process`.
    process: NonNull<Process>,
}

// SAFETY: only ever accessed from the JS thread (macOS WebView host is single-VM).
static mut INSTANCE: *mut HostProcess = ptr::null_mut();

/// Called from WebView.closeAll() and dispatchOnExit. Socket EOF handles
/// normal parent-death (including SIGKILL of Bun — kernel closes fds, child
/// reads 0, CFRunLoopStop). This catches the clean-exit path where the child
/// hasn't yet noticed EOF before we return from main(). WKWebView's own
/// WebContent/GPU/Network helpers are XPC-connected to the child — when the
/// child dies they get connection-invalidated and exit.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__WebViewHost__kill() {
    // SAFETY: single-threaded access (JS thread only).
    unsafe {
        if let Some(i) = INSTANCE.as_mut() {
            let _ = i.process.as_mut().kill(9);
        }
    }
}

/// Lazy: first `new Bun.WebView()` calls this via C++. Returns the parent
/// socket fd (C++ adopts into usockets and owns it from then on), or -1.
/// C++'s HostClient::ensureSpawned checks its own sock before calling here,
/// so instance-already-exists → -1 means "you already have the fd, this is
/// a bug" not "spawn failed". We deliberately don't store the fd — usockets
/// owns it; re-returning a fd usockets may have already closed would be a
/// use-after-close. Rust only owns process lifetime (watch + kill).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__WebViewHost__ensure(
    global: &JSGlobalObject,
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> i32 {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (global, stdout_inherit, stderr_inherit);
        return -1;
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: single-threaded access (JS thread only).
        if unsafe { !INSTANCE.is_null() } {
            return -1; // C++ already holds the fd
        }

        let fd = match spawn(global.bun_vm(), stdout_inherit, stderr_inherit) {
            Ok(fd) => fd,
            Err(err) => {
                scoped_log!(WebViewHost, "spawn failed: {}", err.name());
                return -1;
            }
        };
        fd.cast()
    }
}

impl HostProcess {
    /// Child died (EVFILT_PROC fired). Socket onClose may have fired already
    /// (clean FIN) or may not have (SIGKILL, SIGSEGV). Tell C++ to reject any
    /// pending promises and mark the host dead.
    pub fn on_process_exit(
        &mut self,
        _: &mut Process,
        status: Status,
        _: &Rusage,
    ) {
        scoped_log!(WebViewHost, "child exited: {}", status);
        let signo: i32 = if let Some(sig) = status.signal_code() {
            sig as i32
        } else {
            0
        };
        // SAFETY: FFI call into WebKitBackend.cpp; signo is a plain i32.
        unsafe { Bun__WebViewHost__childDied(signo) };
        // SAFETY: process is a valid intrusive-refcounted pointer owned by this struct.
        unsafe { self.process.as_mut().deref_() };
        // SAFETY: `self` was allocated via Box::into_raw in spawn(); INSTANCE points at it.
        unsafe {
            drop(Box::from_raw(self as *mut HostProcess));
            INSTANCE = ptr::null_mut();
        }
    }
}

fn spawn(
    vm: &VirtualMachine,
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> Result<Fd, Error> {
    // TODO(port): narrow error set
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (vm, stdout_inherit, stderr_inherit);
        return Err(bun_core::err!("Unsupported"));
    }
    #[cfg(target_os = "macos")]
    {
        // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B.

        // Both ends nonblocking — parent uses usockets; child sets O_NONBLOCK
        // again after dup2 (socketpair flags are per-fd, not per-pair).
        let fds = bun_sys::socketpair(
            bun_sys::AF_UNIX,
            bun_sys::SOCK_STREAM,
            0,
            bun_sys::SocketpairBehavior::Nonblocking,
        )
        .unwrap()?;
        // errdefer fds[0].close() — rolls back on any error below.
        let fd0_guard = scopeguard::guard(fds[0], |fd| fd.close());
        // fds[1] is closed by spawnProcess after dup2 into the child.

        let exe = bun_core::self_exe_path()?;

        // Child sees fd 3 (first extra_fd → 3+0). The env var is the only
        // signal; no argv changes so `ps` shows a normal `bun` invocation.
        // Same pattern as NODE_CHANNEL_FD in js_bun_spawn_bindings.zig.
        let base = vm.transpiler().env().map().create_null_delimited_env_map()?;
        let mut env: Vec<Option<*const c_char>> = Vec::new();
        env.reserve(base.len() + 2);
        // SAFETY: `base` is `[*:0]const u8` slice; reinterpret as nullable C-string pointers.
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B.
        env.extend(base.iter().map(|p| Some(p.cast::<c_char>())));
        // PERF(port): was appendAssumeCapacity — profile in Phase B.
        env.push(Some(b"BUN_INTERNAL_WEBVIEW_HOST=3\0".as_ptr().cast::<c_char>()));
        env.push(None);

        let mut argv: [Option<*const c_char>; 2] = [Some(exe.as_ptr().cast::<c_char>()), None];

        let mut opts = SpawnOptions {
            stdin: bun_spawn::Stdio::Ignore,
            // Default ignore — the child runs no JS or user code, so output is
            // only panics/NSLog from WebKit. Opt-in via backend.stderr when
            // debugging a silent host crash.
            stdout: if stdout_inherit { bun_spawn::Stdio::Inherit } else { bun_spawn::Stdio::Ignore },
            stderr: if stderr_inherit { bun_spawn::Stdio::Inherit } else { bun_spawn::Stdio::Ignore },
            extra_fds: &[bun_spawn::ExtraFd::Pipe(fds[1])],
            argv0: Some(exe.as_ptr().cast::<c_char>()),
            ..Default::default()
        };

        let mut spawned = bun_spawn::spawn_process(
            &mut opts,
            // SAFETY: argv is a NUL-terminated array of NUL-terminated strings.
            unsafe { argv.as_mut_ptr().cast() },
            // SAFETY: env is a NUL-terminated array of NUL-terminated strings.
            unsafe { env.as_mut_ptr().cast() },
        )?
        .unwrap()?;

        let self_ = Box::into_raw(Box::new(HostProcess {
            // TODO(port): toProcess() returns an intrusive-refcounted *Process; verify ownership transfer.
            process: NonNull::new(spawned.to_process(vm.event_loop(), false))
                .expect("toProcess returned null"),
        }));
        // SAFETY: self_ was just allocated and is non-null.
        let self_ref = unsafe { &mut *self_ };
        // SAFETY: process is valid; set_exit_handler stores `self_` as the callback receiver.
        unsafe { self_ref.process.as_mut().set_exit_handler(self_ref) };
        // SAFETY: process is valid.
        match unsafe { self_ref.process.as_mut().watch() } {
            bun_sys::Result::Ok(()) => {
                // Weak handle: parent exits when no views + nothing pending,
                // child gets socket EOF and exits, EVFILT_PROC fires into a
                // dead process (kernel discards). If we ref'd, parent would
                // stay alive forever waiting on a child that is waiting on us.
                // dispatchOnExit also SIGKILLs via Bun__WebViewHost__kill.
                // SAFETY: process is valid.
                unsafe { self_ref.process.as_mut().disable_keeping_event_loop_alive() };
            }
            bun_sys::Result::Err(e) => {
                scoped_log!(WebViewHost, "watch failed: {}", e);
                // SAFETY: process is valid; drop the ref we hold.
                unsafe { self_ref.process.as_mut().deref_() };
                // SAFETY: self_ was allocated via Box::into_raw above.
                unsafe { drop(Box::from_raw(self_)) };
                // fd0_guard (errdefer at the top) closes fds[0]; don't double-close here.
                return Err(bun_core::err!("WatchFailed"));
            }
        }
        // SAFETY: single-threaded access (JS thread only).
        unsafe { INSTANCE = self_ };
        // fd handed to C++ which adopts it into usockets. Not stored here —
        // usockets owns the socket; Rust only owns process lifetime.
        let fd0 = scopeguard::ScopeGuard::into_inner(fd0_guard);
        Ok(fd0)
    }
}

// Implemented in WebKitBackend.cpp. Rejects all pending promises, marks the
// host socket dead. `signo` is the signal that killed the child (0 if it
// exited cleanly).
// TODO(port): move to <runtime>_sys
unsafe extern "C" {
    fn Bun__WebViewHost__childDied(signo: i32);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webview/HostProcess.zig (150 lines)
//   confidence: medium
//   todos:      4
//   notes:      bun_spawn crate path/API guessed; process field is intrusive-rc kept as NonNull (no LIFETIMES row); static mut INSTANCE needs Phase-B audit
// ──────────────────────────────────────────────────────────────────────────

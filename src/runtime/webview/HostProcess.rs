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
use bun_jsc::JSGlobalObject;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_output::{declare_scope, scoped_log};
use bun_spawn::{
    self, EventLoopHandle, Process, ProcessExit, ProcessExitKind, Rusage, SpawnOptions,
    SpawnResultExt as _, Status, Stdio,
};
use bun_sys::{self, Fd, FdExt as _};

declare_scope!(WebViewHost, hidden);

pub struct HostProcess {
    // Intrusive refcount (`.deref()` called in on_process_exit); kept raw to
    // match Zig `*bun.spawn.Process`.
    process: NonNull<Process>,
}

// PORTING.md §Global mutable state: JS-thread-only singleton ptr → AtomicPtr.
// Only ever accessed from the JS thread (macOS WebView host is single-VM).
static INSTANCE: core::sync::atomic::AtomicPtr<HostProcess> =
    core::sync::atomic::AtomicPtr::new(ptr::null_mut());

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
        if let Some(i) = INSTANCE
            .load(core::sync::atomic::Ordering::Relaxed)
            .as_mut()
        {
            // SAFETY: INSTANCE is set to a live heap-allocated pointer in
            // spawn() and cleared in on_process_exit before the box is dropped.
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
        if !INSTANCE
            .load(core::sync::atomic::Ordering::Relaxed)
            .is_null()
        {
            return -1; // C++ already holds the fd
        }

        // `bun_vm()` returns `&'static VirtualMachine`; `spawn` takes the raw
        // `*mut` because it threads through C ABI / event-loop dispatch.
        let fd = match spawn(
            global.bun_vm() as *const _ as *mut _,
            stdout_inherit,
            stderr_inherit,
        ) {
            Ok(fd) => fd,
            Err(err) => {
                scoped_log!(WebViewHost, "spawn failed: {}", err.name());
                return -1;
            }
        };
        fd.native()
    }
}

bun_spawn::link_impl_ProcessExit! {
    HostProcess for HostProcess => |this| {
        // Child died (EVFILT_PROC). Socket onClose may or may not have fired
        // already (clean FIN vs SIGKILL/SIGSEGV). Tell C++ to reject any
        // pending promises and mark the host dead.
        on_process_exit(_process, status, _rusage) => {
            scoped_log!(WebViewHost, "child exited: {}", status);
            let signo: i32 = status.signal_code().map_or(0, |s| s as i32);
            Bun__WebViewHost__childDied(signo);
            // `this` was heap-allocated in spawn(); process is the
            // intrusive-rc *mut Process whose strong ref we hold. `deref()`
            // drops that ref, then drop the Box.
            Process::deref((*this).process.as_ptr());
            drop(bun_core::heap::take(this));
            INSTANCE.store(ptr::null_mut(), core::sync::atomic::Ordering::Relaxed);
        },
    }
}

fn spawn(vm: *mut VirtualMachine, stdout_inherit: bool, stderr_inherit: bool) -> Result<Fd, Error> {
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
        let fds: [Fd; 2] = bun_sys::socketpair(
            libc::AF_UNIX as i32,
            libc::SOCK_STREAM as i32,
            0,
            true, // .nonblocking
        )?;
        // errdefer fds[0].close() — rolls back on any error below.
        let fd0_guard = scopeguard::guard(fds[0], |fd| fd.close());
        // fds[1] is closed by spawnProcess after dup2 into the child.

        let exe = bun_core::self_exe_path()?;

        // Child sees fd 3 (first extra_fd → 3+0). The env var is the only
        // signal; no argv changes so `ps` shows a normal `bun` invocation.
        // Same pattern as NODE_CHANNEL_FD in js_bun_spawn_bindings.zig.
        // SAFETY: vm is the per-thread VirtualMachine (valid for the call);
        // `transpiler.env` is set during VM init and lives for VM lifetime.
        let base = unsafe { (*(*vm).transpiler.env).map.create_null_delimited_env_map() }?;
        let base_slice = base.as_slice();
        // base_slice already has a trailing None sentinel; drop it, append our
        // var, then re-terminate.
        let base_entries = &base_slice[..base_slice.len().saturating_sub(1)];
        let mut env: Vec<*const c_char> = Vec::with_capacity(base_entries.len() + 2);
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B.
        env.extend(base_entries.iter().copied());
        // PERF(port): was appendAssumeCapacity — profile in Phase B.
        env.push(c"BUN_INTERNAL_WEBVIEW_HOST=3".as_ptr());
        env.push(ptr::null());

        let argv: [*const c_char; 2] = [exe.as_ptr(), ptr::null()];

        let opts = SpawnOptions {
            stdin: Stdio::Ignore,
            // Default ignore — the child runs no JS or user code, so output is
            // only panics/NSLog from WebKit. Opt-in via backend.stderr when
            // debugging a silent host crash.
            stdout: if stdout_inherit {
                Stdio::Inherit
            } else {
                Stdio::Ignore
            },
            stderr: if stderr_inherit {
                Stdio::Inherit
            } else {
                Stdio::Ignore
            },
            extra_fds: vec![Stdio::Pipe(fds[1])].into_boxed_slice(),
            argv0: Some(exe.as_ptr()),
            ..SpawnOptions::default()
        };

        let spawned = bun_spawn::spawn_process(&opts, argv.as_ptr(), env.as_ptr())??;

        // SAFETY: vm is valid for the call.
        let event_loop = EventLoopHandle::init(unsafe { (*vm).event_loop() }.cast());
        let process =
            NonNull::new(spawned.to_process(event_loop, false)).expect("toProcess returned null");
        let self_ptr = bun_core::heap::into_raw(Box::new(HostProcess { process }));
        // SAFETY: `self_ptr` is a freshly-allocated, exclusively-owned Box that
        // owns `process` and outlives it.
        unsafe {
            (*process.as_ptr())
                .set_exit_handler(ProcessExit::new(ProcessExitKind::HostProcess, self_ptr));
        }
        // SAFETY: process is live and exclusively owned here.
        match unsafe { (*process.as_ptr()).watch() } {
            Ok(()) => {
                // Weak handle: parent exits when no views + nothing pending,
                // child gets socket EOF and exits, EVFILT_PROC fires into a
                // dead process (kernel discards). If we ref'd, parent would
                // stay alive forever waiting on a child that is waiting on us.
                // dispatchOnExit also SIGKILLs via Bun__WebViewHost__kill.
                // SAFETY: process is live and exclusively owned here.
                unsafe { (*process.as_ptr()).disable_keeping_event_loop_alive() };
            }
            Err(e) => {
                scoped_log!(WebViewHost, "watch failed: {}", e);
                // SAFETY: drop the strong ref we hold (Zig: `process.deref()`),
                // then reclaim the Box (Zig: `bun.destroy(self)`).
                unsafe {
                    Process::deref(process.as_ptr());
                    drop(bun_core::heap::take(self_ptr));
                }
                // fd0_guard (errdefer at the top) closes fds[0]; don't double-close here.
                return Err(bun_core::err!("WatchFailed"));
            }
        }
        INSTANCE.store(self_ptr, core::sync::atomic::Ordering::Relaxed);
        // fd handed to C++ which adopts it into usockets. Not stored here —
        // usockets owns the socket; Rust only owns process lifetime.
        let fd0 = scopeguard::ScopeGuard::into_inner(fd0_guard);
        Ok(fd0)
    }
}

// Implemented in WebKitBackend.cpp. Rejects all pending promises, marks the
// host socket dead. `signo` is the signal that killed the child (0 if it
// exited cleanly).
unsafe extern "C" {
    fn Bun__WebViewHost__childDied(signo: i32);
}

// ported from: src/runtime/webview/HostProcess.zig

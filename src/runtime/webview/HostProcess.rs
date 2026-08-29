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

use core::cell::Cell;

use bun_jsc::JSGlobalObject;
use bun_output::{declare_scope, scoped_log};
use bun_ptr::ThisPtr;
use bun_spawn::{ProcessHandle, Status};

#[cfg(target_os = "macos")]
use {
    crate::Error,
    bun_jsc::virtual_machine::VirtualMachine,
    bun_ptr::OwnedThis,
    bun_spawn::{EventLoopHandle, SpawnEnv, SpawnOptions, SpawnResultExt as _, Stdio},
    bun_sys::{self, Fd, FdExt as _},
    core::ffi::CStr,
};

declare_scope!(WebViewHost, hidden);

/// The WebKit host child. Owned by this thread's [`Hosts`](crate::webview::Hosts)
/// until its exit is reaped.
pub(crate) struct HostProcess {
    /// Our ref on the process; dropping the host detaches and releases it.
    process: ProcessHandle,
    /// Set by [`webview_host_retire`]: the exit is reaped but not reported to C++.
    retired: Cell<bool>,
}

/// Called from WebView.closeAll() and dispatchOnExit. Socket EOF handles
/// normal parent-death (including SIGKILL of Bun — kernel closes fds, child
/// reads 0, CFRunLoopStop). This catches the clean-exit path where the child
/// hasn't yet noticed EOF before we return from main(). WKWebView's own
/// WebContent/GPU/Network helpers are XPC-connected to the child — when the
/// child dies they get connection-invalidated and exit.
// HOST_EXPORT(Bun__WebViewHost__kill, c)
pub fn webview_host_kill() {
    crate::jsc_hooks::with_webview_hosts(|hosts| {
        if let Some(host) = hosts.webkit.current() {
            let _ = host.process.kill(9);
        }
    });
}

/// HostClient::retireGlobal (`bun test --isolate`): unpublish and kill this host so the next file can spawn its own at once.
// HOST_EXPORT(Bun__WebViewHost__retire, c)
pub fn webview_host_retire() {
    crate::jsc_hooks::with_webview_hosts(|hosts| {
        let Some(host) = hosts.webkit.retire() else {
            return;
        };
        host.retired.set(true);
        let _ = host.process.kill(9);
    });
}

/// Lazy: first `new Bun.WebView()` calls this via C++. Returns the parent
/// socket fd (C++ adopts into usockets and owns it from then on), or -1.
/// C++'s HostClient::ensureSpawned checks its own sock before calling here,
/// so instance-already-exists → -1 means "you already have the fd, this is
/// a bug" not "spawn failed". We deliberately don't store the fd — usockets
/// owns it; re-returning a fd usockets may have already closed would be a
/// use-after-close. Rust only owns process lifetime (watch + kill).
// HOST_EXPORT(Bun__WebViewHost__ensure, c)
pub fn webview_host_ensure(
    global: &JSGlobalObject,
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> i32 {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (global, stdout_inherit, stderr_inherit);
        -1
    }
    #[cfg(target_os = "macos")]
    {
        let published = crate::jsc_hooks::with_webview_hosts(|hosts| hosts.webkit.is_published());
        if published != Some(false) {
            return -1; // C++ already holds the fd (or no runtime state)
        }

        let fd = match spawn(global.bun_vm(), stdout_inherit, stderr_inherit) {
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
            HostProcess::on_exit(ThisPtr::new(this), &status)
        },
    }
}

impl HostProcess {
    /// The exit handler: `this` is the host the registry owns (installed with
    /// `set_exit_handler`), taken back and dropped here.
    fn on_exit(this: ThisPtr<HostProcess>, status: &Status) {
        scoped_log!(WebViewHost, "child exited: {}", status);
        let retired = this.retired.get();
        // A retired host was already unpublished by `webview_host_retire`.
        if !retired {
            let signo: i32 = status.signal_code().map_or(0, |s| s as i32);
            Bun__WebViewHost__childDied(signo);
        }
        let host = crate::jsc_hooks::with_webview_hosts(|hosts| hosts.webkit.take(this)).flatten();
        debug_assert!(host.is_some(), "webview host exit for an unknown host");
        // Dropping it releases our ref on the process.
        drop(host);
    }
}

#[cfg(target_os = "macos")]
fn spawn(vm: &VirtualMachine, stdout_inherit: bool, stderr_inherit: bool) -> Result<Fd, Error> {
    // Both ends nonblocking — parent uses usockets; child sets O_NONBLOCK
    // again after dup2 (socketpair flags are per-fd, not per-pair).
    let fds: [Fd; 2] = bun_sys::socketpair(
        libc::AF_UNIX as i32,
        libc::SOCK_STREAM as i32,
        0,
        true, // .nonblocking
    )?;
    // fd0_guard rolls back fds[0] on any error below.
    let fd0_guard = scopeguard::guard(fds[0], |fd| fd.close());
    // fds[1] is closed by spawnProcess after dup2 into the child.

    let exe = bun_core::self_exe_path()?;

    // Child sees fd 3 (first extra_fd → 3+0). The env var is the only
    // signal; no argv changes so `ps` shows a normal `bun` invocation.
    // Same pattern as NODE_CHANNEL_FD in js_bun_spawn_bindings.rs.
    let base = vm
        .as_mut()
        .transpiler
        .env_mut()
        .map
        .create_null_delimited_env_map()?;
    let mut env: Vec<&CStr> = base.iter().collect();
    env.push(c"BUN_INTERNAL_WEBVIEW_HOST=3");

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

    let spawned = bun_spawn::spawn_process_cstr(&opts, &[exe.as_cstr()], SpawnEnv::Strings(&env))??;

    let event_loop = EventLoopHandle::init(vm.as_mut().event_loop().cast::<()>());
    let host = OwnedThis::new(HostProcess {
        process: spawned.to_process_handle(event_loop),
        retired: Cell::new(false),
    });
    host.process.set_exit_handler(host.this_ptr());
    match host.process.watch() {
        Ok(()) => {
            // Weak handle: parent exits when no views + nothing pending,
            // child gets socket EOF and exits, EVFILT_PROC fires into a
            // dead process (kernel discards). If we ref'd, parent would
            // stay alive forever waiting on a child that is waiting on us.
            // dispatchOnExit also SIGKILLs via Bun__WebViewHost__kill.
            host.process.disable_keeping_event_loop_alive();
        }
        Err(e) => {
            scoped_log!(WebViewHost, "watch failed: {}", e);
            // Dropping `host` detaches and releases the process.
            // fd0_guard (declared at the top) closes fds[0]; don't double-close here.
            return Err(crate::Error::WatchFailed);
        }
    }
    crate::jsc_hooks::with_webview_hosts(|hosts| hosts.webkit.publish(host));
    // fd handed to C++ which adopts it into usockets. Not stored here —
    // usockets owns the socket; Rust only owns process lifetime.
    let fd0 = scopeguard::ScopeGuard::into_inner(fd0_guard);
    Ok(fd0)
}

// Implemented in WebKitBackend.cpp. Rejects all pending promises, marks the
// host socket dead. `signo` is the signal that killed the child (0 if it
// exited cleanly).
unsafe extern "C" {
    safe fn Bun__WebViewHost__childDied(signo: i32);
}

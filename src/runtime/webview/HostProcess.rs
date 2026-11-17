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

use core::sync::atomic::{AtomicI32, Ordering};

use bun_jsc::JSGlobalObject;
use bun_output::{declare_scope, scoped_log};
use bun_spawn::{self, ProcessHandle, Status};

#[cfg(target_os = "macos")]
use {
    crate::Error,
    bun_core::CStrList,
    bun_jsc::virtual_machine::VirtualMachine,
    bun_ptr::{AliasableBox, CellExt as _},
    bun_spawn::{
        EventLoopHandle, Process, ProcessExit, ProcessExitKind, SpawnOptions, SpawnResultExt as _,
        Stdio,
    },
    bun_sys::{self, Fd},
};

declare_scope!(WebViewHost, hidden);

pub(crate) struct HostProcess {
    process: ProcessHandle,
}

/// Of the host that C++ talks to, whichever thread spawned it. 0: none.
static PID: AtomicI32 = AtomicI32::new(0);

fn unreaped() -> &'static super::Unreaped<HostProcess> {
    #[cfg(target_os = "macos")]
    return &crate::jsc_hooks::runtime_state().browsers.host;
    #[cfg(not(target_os = "macos"))]
    unreachable!("only macOS spawns a host");
}

fn kill(pid: i32) {
    if pid != 0 {
        #[cfg(unix)]
        bun_spawn::ffi::kill(pid, libc::SIGKILL);
    }
}

/// Called from WebView.closeAll() and dispatchOnExit. Socket EOF handles
/// normal parent-death (including SIGKILL of Bun — kernel closes fds, child
/// reads 0, CFRunLoopStop). This catches the clean-exit path where the child
/// hasn't yet noticed EOF before we return from main(). WKWebView's own
/// WebContent/GPU/Network helpers are XPC-connected to the child — when the
/// child dies they get connection-invalidated and exit.
#[unsafe(no_mangle)]
extern "C" fn Bun__WebViewHost__kill() {
    kill(PID.load(Ordering::Relaxed));
}

/// HostClient::retireGlobal (`bun test --isolate`): unpublish and kill this host so the next file can spawn its own at once.
#[unsafe(no_mangle)]
extern "C" fn Bun__WebViewHost__retire() {
    kill(PID.swap(0, Ordering::Relaxed));
}

/// Lazy: first `new Bun.WebView()` calls this via C++. Returns the parent
/// socket fd (C++ adopts into usockets and owns it from then on), or -1.
/// C++'s HostClient::ensureSpawned checks its own sock before calling here,
/// so instance-already-exists → -1 means "you already have the fd, this is
/// a bug" not "spawn failed". We deliberately don't store the fd — usockets
/// owns it; re-returning a fd usockets may have already closed would be a
/// use-after-close. Rust only owns process lifetime (watch + kill).
#[unsafe(no_mangle)]
extern "C" fn Bun__WebViewHost__ensure(
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
        if PID.load(Ordering::Relaxed) != 0 {
            return -1; // C++ already holds the fd
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
        on_process_exit(status, _rusage) => HostProcess::on_exit(this, &status),
    }
}

impl HostProcess {
    fn on_exit(this: *mut HostProcess, status: &Status) {
        scoped_log!(WebViewHost, "child exited: {}", status);
        let Some(host) = super::remove(unreaped(), this) else {
            return;
        };
        let pid = host.process.pid;
        drop(host);
        if (PID.compare_exchange(pid, 0, Ordering::Relaxed, Ordering::Relaxed)).is_err() {
            return; // retired
        }
        let signo: i32 = status.signal().map_or(0, |signal| i32::from(signal.0));
        // SAFETY: takes no pointers, and this is the thread that C++ called `Bun__WebViewHost__ensure` on.
        unsafe { Bun__WebViewHost__childDied(signo) };
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
    let parent_end = bun_sys::File::from_fd(fds[0]);
    // fds[1] is closed by spawnProcess after dup2 into the child.

    let exe = bun_core::self_exe_path()?;

    // Child sees fd 3 (first extra_fd → 3+0). The env var is the only
    // signal; no argv changes so `ps` shows a normal `bun` invocation.
    // Same pattern as NODE_CHANNEL_FD in js_bun_spawn_bindings.rs.
    let base = vm.env_loader().map.to_envp();
    let host_variable = [Some(c"BUN_INTERNAL_WEBVIEW_HOST=3".into()), None];
    let env = [base.unterminated(), &host_variable].concat();

    let argv = [Some(exe.into()), None];

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
        argv0: Some(exe.into()),
        ..SpawnOptions::default()
    };

    let (argv, env) = (CStrList::new(&argv), CStrList::new(&env));
    let spawned = bun_spawn::spawn_process(&opts, argv, Some(env))??;

    let event_loop = EventLoopHandle::init(vm.event_loop_ptr());
    let host = AliasableBox::new(HostProcess {
        process: spawned.to_process_handle(event_loop),
    });
    let process = &host.process;
    // SAFETY: `host` owns `process`, whose `Drop` detaches the handler.
    let handler = unsafe { ProcessExit::new(ProcessExitKind::HostProcess, host.as_ptr()) };
    Process::set_exit_handler(process, handler);
    match process.watch() {
        Ok(()) => {
            // Weak handle: parent exits when no views + nothing pending,
            // child gets socket EOF and exits, EVFILT_PROC fires into a
            // dead process (kernel discards). If we ref'd, parent would
            // stay alive forever waiting on a child that is waiting on us.
            // dispatchOnExit also SIGKILLs via Bun__WebViewHost__kill.
            process.disable_keeping_event_loop_alive();
        }
        Err(e) => {
            scoped_log!(WebViewHost, "watch failed: {}", e);
            return Err(crate::Error::WatchFailed);
        }
    }
    PID.store(process.pid, Ordering::Relaxed);
    unreaped().with_taken(|unreaped| unreaped.push(host));
    // fd handed to C++ which adopts it into usockets. Not stored here —
    // usockets owns the socket; Rust only owns process lifetime.
    Ok(parent_end.into_raw())
}

// Implemented in WebKitBackend.cpp. Rejects all pending promises, marks the
// host socket dead. `signo` is the signal that killed the child (0 if it
// exited cleanly).
unsafe extern "C" {
    fn Bun__WebViewHost__childDied(signo: i32);
}

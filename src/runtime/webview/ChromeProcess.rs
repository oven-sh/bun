//! Spawns Chrome/Chromium with --remote-debugging-pipe. The child reads CDP
//! JSON from fd 3 and writes replies to fd 4 (NUL-delimited). No separate
//! host process — Chrome IS the IPC peer. One fewer hop than WKWebView.
//!
//! Parent death → Chrome's pipe read EOFs → Chrome exits. Same lifetime
//! coupling as HostProcess.zig's socket EOF path.
//!
//! fd layout (child):
//!   3 = Chrome reads CDP commands from us  (parent writes → child reads)
//!   4 = Chrome writes CDP replies to us    (child writes  → parent reads)
//!
//! One socketpair, the child end dup'd to BOTH fd 3 and fd 4. Chrome's
//! DevToolsPipeHandler does read(3) and write(4) — it doesn't care that
//! both fds point at the same socket. usockets' bsd_recv() calls recv()
//! which fails ENOTSOCK on a pipe fd (the earlier two-pipes layout broke
//! here: recv(readFd) returned -1 → loop treated as close → onClose fired
//! before any data); socketpair gives us a proper socket for the read path
//! and the write path can share it.

use core::ffi::{c_char, CStr};
use core::ptr::{self, NonNull};
use std::io::Write as _;

use bun_core::{self, env_var, getenv_z, which, ZBox, ZStr};
use bun_event_loop::EventLoopHandle;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::JSGlobalObject;
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, path_buffer_pool, platform, resolve_path, PathBuffer};
use bun_spawn::{self, Process, ProcessExitVTable, Rusage, SpawnOptions, Status, Stdio};
use bun_str::strings;
use bun_sys::{self, EntryKind, Fd, FdExt as _, O};

declare_scope!(Chrome, hidden);

pub struct ChromeProcess {
    process: NonNull<Process>,
}

// SAFETY: only accessed from the JS thread (exported fns are called from C++
// on the mutator thread; on_process_exit runs on the event loop thread which
// is the same thread).
static mut INSTANCE: *mut ChromeProcess = ptr::null_mut();

/// Called from WebView.closeAll() and dispatchOnExit. Chrome spawns its own
/// renderer/gpu/utility children (the "process model" zygote tree) — tracked
/// by Chrome's own ProcessSingleton, they exit when the browser process
/// dies. SIGKILL here takes the browser process, the zygote tree follows.
/// The C++ side doesn't touch JS state; EVFILT_PROC → Bun__Chrome__died →
/// rejectAllAndMarkDead handles promise rejection on the next loop tick.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Chrome__kill() {
    // SAFETY: JS-thread-only global; see INSTANCE decl. INSTANCE is set to a
    // live Box::into_raw'd pointer in spawn() and cleared in on_process_exit
    // before the box is dropped.
    unsafe {
        if let Some(i) = INSTANCE.as_mut() {
            let _ = i.process.as_mut().kill(9);
        }
    }
}

/// Lazy: first `new Bun.WebView({ backend: "chrome" })` calls this via
/// C++. Returns the parent's socketpair fd (C++ adopts into usockets and
/// owns it from then on), or -1 on spawn failure / already-running.
/// C++'s Transport::ensureSpawned checks its own m_readSock before calling
/// here, so instance-already-exists → -1 means "you already have the fd,
/// this is a bug" not "spawn failed". We deliberately don't store the fd —
/// usockets owns it; re-returning a fd usockets may have already closed
/// would be a use-after-close.
///
/// Windows TODO — fd.cast() returns a HANDLE there, and pipe() / fcntl
/// nonblocking have no direct equivalents. The spawn would need to use
/// named pipes or libuv. For now -1 and C++ throws not-implemented.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Chrome__ensure(
    global: *mut JSGlobalObject,
    user_data_dir: *const c_char, // ?[*:0]const u8
    path: *const c_char,          // ?[*:0]const u8
    extra_argv: *const *const c_char, // ?[*]const [*:0]const u8
    extra_argv_len: u32,
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> i32 {
    #[cfg(windows)]
    {
        let _ = (global, user_data_dir, path, extra_argv, extra_argv_len, stdout_inherit, stderr_inherit);
        return -1;
    }
    #[cfg(not(windows))]
    {
        // SAFETY: JS-thread-only global.
        if unsafe { !INSTANCE.is_null() } {
            return -1; // C++ already holds the fd
        }

        let extra: &[*const c_char] = if extra_argv.is_null() {
            &[]
        } else {
            // SAFETY: caller guarantees extra_argv points to extra_argv_len entries.
            unsafe { core::slice::from_raw_parts(extra_argv, extra_argv_len as usize) }
        };
        // SAFETY: global is a valid &JSGlobalObject for the duration of this call.
        let global = unsafe { &*global };
        // SAFETY: caller passes valid NUL-terminated strings when non-null.
        let user_data_dir = if user_data_dir.is_null() { None } else { Some(unsafe { CStr::from_ptr(user_data_dir) }) };
        // SAFETY: caller passes valid NUL-terminated strings when non-null.
        let path = if path.is_null() { None } else { Some(unsafe { CStr::from_ptr(path) }) };
        // SAFETY: bun_vm() returns the per-global VM pointer; valid for the
        // duration of this call (we're on the JS thread).
        let vm = unsafe { &mut *global.bun_vm() };
        let fd = match spawn(vm, user_data_dir, path, extra, stdout_inherit, stderr_inherit) {
            Ok(fd) => fd,
            Err(err) => {
                scoped_log!(Chrome, "spawn failed: {}", err.name());
                return -1;
            }
        };
        fd.cast()
    }
}

static CHROME_EXIT_VTABLE: ProcessExitVTable = ProcessExitVTable {
    on_process_exit: ChromeProcess::on_process_exit_thunk,
};

impl ChromeProcess {
    /// SAFETY: `owner` must be the `*mut ChromeProcess` registered via
    /// `set_exit_handler`.
    unsafe fn on_process_exit_thunk(
        owner: *mut (),
        process: *mut Process,
        status: Status,
        rusage: *const Rusage,
    ) {
        // SAFETY: caller contract — owner is the live ChromeProcess registered
        // with this vtable; process/rusage are valid for the duration of the call.
        unsafe { (*owner.cast::<ChromeProcess>()).on_process_exit(&mut *process, status, &*rusage) };
    }

    pub fn on_process_exit(&mut self, _: &mut Process, status: Status, _: &Rusage) {
        scoped_log!(Chrome, "chrome exited: {}", status);
        let signo: i32 = if let Some(sig) = status.signal_code() {
            sig as i32
        } else {
            0
        };
        // SAFETY: FFI call into ChromeBackend.cpp; signo is plain i32.
        unsafe { Bun__Chrome__died(signo) };
        // SAFETY: process is a valid intrusive-refcounted pointer owned by this
        // struct (replaces Zig's `process.deref()`).
        unsafe { self.process.as_mut().deref() };
        // SAFETY: `self` was Box::into_raw'd in spawn(); INSTANCE points at it.
        unsafe {
            drop(Box::from_raw(self as *mut ChromeProcess));
            INSTANCE = ptr::null_mut();
        }
    }
}

/// Auto-detect the Chrome binary. chrome-headless-shell is the ~100MB
/// stripped variant (no GPU compositor, no extensions) — ships with
/// playwright installs. Falls through to the full app bundles.
///
/// Playwright registry layout (packages/playwright-core/src/server/registry):
///   mac:   ~/Library/Caches/ms-playwright/chromium_headless_shell-<rev>/
///            chrome-headless-shell-mac-<arch>/chrome-headless-shell
///   linux: ~/.cache/ms-playwright/chromium_headless_shell-<rev>/
///            chrome-headless-shell-linux64/chrome-headless-shell
///            (arm64 non-cft builds use chrome-linux/headless_shell instead)
#[cfg(not(windows))]
fn find_chrome(explicit_path: Option<&CStr>) -> Option<ZBox> {
    // Precedence: backend.path > BUN_CHROME_PATH > $PATH > hardcoded > playwright.
    // backend.path is per-Bun.WebView call (first wins — later views reuse
    // the already-spawned Chrome); env var is per-process.
    if let Some(p) = explicit_path {
        return Some(ZBox::from_bytes(p.to_bytes()));
    }
    if let Some(p) = getenv_z(ZStr::from_static(b"BUN_CHROME_PATH\0")) {
        return Some(ZBox::from_bytes(p));
    }

    let mut buf = path_buffer_pool::get();

    // $PATH first — `brew install chromium`, distro packages, manual symlinks
    // all land here. Same precedence as `which` at a shell prompt.
    let path = env_var::PATH.get().unwrap_or(b"");
    let names: [&[u8]; 7] = [
        b"google-chrome-stable",
        b"google-chrome",
        b"chromium-browser",
        b"chromium",
        b"brave-browser",
        b"microsoft-edge",
        b"chrome", // brew cask symlink, some CI setups
    ];
    for n in names {
        if let Some(found) = which(&mut buf, path, b"", n) {
            return Some(ZBox::from_bytes(found.as_bytes()));
        }
    }

    // Hardcoded absolute paths — macOS app bundles aren't in $PATH, and
    // snap on Linux doesn't always export /snap/bin. Signed bundles before
    // Playwright: enterprise endpoint-protection (Gatekeeper, Santa)
    // allowlists notarized bundles but blocks unsigned binaries in cache
    // dirs; Playwright's chrome-headless-shell is unsigned and SIGKILLs at
    // exec on a locked-down dev machine while Chrome.app runs.
    #[cfg(target_os = "macos")]
    {
        let bundles: [&[u8]; 5] = [
            b"Google Chrome.app/Contents/MacOS/Google Chrome",
            b"Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            b"Chromium.app/Contents/MacOS/Chromium",
            b"Brave Browser.app/Contents/MacOS/Brave Browser",
            b"Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ];
        // /Applications then ~/Applications — per-user installs (non-admin
        // or drag-to-home-folder) land in the latter.
        let home = env_var::HOME.get().unwrap_or(b"");
        for b in bundles {
            let sys = resolve_path::join_string_buf_z::<platform::Auto>(
                buf.as_mut_slice(),
                &[b"/Applications", b],
            );
            if bun_sys::is_executable_file_path(sys) {
                return Some(ZBox::from_bytes(sys.as_bytes()));
            }
            if !home.is_empty() {
                let user = resolve_path::join_string_buf_z::<platform::Auto>(
                    buf.as_mut_slice(),
                    &[home, b"Applications", b],
                );
                if bun_sys::is_executable_file_path(user) {
                    return Some(ZBox::from_bytes(user.as_bytes()));
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let absolute: [&ZStr; 8] = [
            ZStr::from_static(b"/usr/bin/google-chrome-stable\0"),
            ZStr::from_static(b"/usr/bin/google-chrome\0"),
            ZStr::from_static(b"/usr/bin/chromium-browser\0"),
            ZStr::from_static(b"/usr/bin/chromium\0"),
            ZStr::from_static(b"/snap/bin/chromium\0"),
            ZStr::from_static(b"/usr/bin/brave-browser\0"),
            ZStr::from_static(b"/snap/bin/brave\0"),
            ZStr::from_static(b"/usr/bin/microsoft-edge\0"),
        ];
        for c in absolute {
            if bun_sys::is_executable_file_path(c) {
                return Some(ZBox::from_bytes(c.as_bytes()));
            }
        }
    }

    // Playwright cache — readdir for the newest chromium_headless_shell-<rev>.
    // Last resort: smaller binary (~100MB), but unsigned. CI Linux runners
    // usually have this and nothing else.
    if let Some(p) = find_playwright_shell() {
        return Some(p);
    }

    None
}

/// Scan the Playwright cache dir for chromium_headless_shell-<rev> entries,
/// pick the highest rev, stat the binary inside. Returns null if no cache
/// dir, no matching entries, or binary missing.
#[cfg(not(windows))]
fn find_playwright_shell() -> Option<ZBox> {
    let home = env_var::HOME.get()?;

    let mut dir_buf = path_buffer_pool::get();
    let cache_subpath: &[u8] = if cfg!(target_os = "macos") {
        b"Library/Caches/ms-playwright"
    } else {
        b".cache/ms-playwright"
    };
    // PORT NOTE: reshaped for borrowck — copy out so dir_buf can be reborrowed
    // later (Zig got two separate threadlocal bufs).
    let cache_dir = ZBox::from_bytes(
        resolve_path::join_string_buf_z::<platform::Auto>(
            dir_buf.as_mut_slice(),
            &[home, cache_subpath],
        )
        .as_bytes(),
    );

    let fd = match bun_sys::open(&cache_dir, O::RDONLY | O::DIRECTORY, 0) {
        Ok(f) => f,
        Err(_) => return None,
    };
    // PORT NOTE: `defer fd.close()` — Fd has no Drop; close explicitly on all
    // exit paths via scopeguard.
    let _fd_guard = scopeguard::guard(fd, |fd| fd.close());

    // Scan for chromium_headless_shell-<rev> and track max rev.
    let mut best_rev: u32 = 0;
    let mut best_name = [0u8; 64];
    let mut best_len: usize = 0;
    const PREFIX: &[u8] = b"chromium_headless_shell-";

    let mut iter = bun_sys::iterate_dir(fd);
    loop {
        let entry = match iter.next() {
            Ok(Some(e)) => e,
            Ok(None) => break,
            Err(_) => return None,
        };
        if entry.kind != EntryKind::Directory {
            continue;
        }
        let name = entry.name.slice();
        if !name.starts_with(PREFIX) {
            continue;
        }
        let rev_str = &name[PREFIX.len()..];
        let rev: u32 = match core::str::from_utf8(rev_str).ok().and_then(|s| s.parse().ok()) {
            Some(r) => r,
            None => continue,
        };
        if rev > best_rev {
            best_rev = rev;
            best_len = name.len().min(best_name.len());
            best_name[..best_len].copy_from_slice(&name[..best_len]);
        }
    }
    if best_rev == 0 {
        return None;
    }

    // Build the binary path. Two possible subdir layouts:
    //   cft:     chrome-headless-shell-<plat>-<arch>/chrome-headless-shell
    //   non-cft: chrome-linux/headless_shell   (linux arm64 only)
    let arch: &str = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    let plat: &str = if cfg!(target_os = "macos") { "mac" } else { "linux" };
    let mut subdir_cft: Vec<u8> = Vec::new();
    write!(
        &mut subdir_cft,
        "chrome-headless-shell-{}-{}/chrome-headless-shell",
        plat, arch
    )
    .ok()?;

    let mut bin_buf = path_buffer_pool::get();
    let bin = resolve_path::join_string_buf_z::<platform::Auto>(
        bin_buf.as_mut_slice(),
        &[cache_dir.as_bytes(), &best_name[..best_len], &subdir_cft],
    );
    if bun_sys::is_executable_file_path(bin) {
        return Some(ZBox::from_bytes(bin.as_bytes()));
    }

    // Fall back to the non-cft linux arm64 layout.
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        let bin2 = resolve_path::join_string_buf_z::<platform::Auto>(
            bin_buf.as_mut_slice(),
            &[
                cache_dir.as_bytes(),
                &best_name[..best_len],
                b"chrome-linux/headless_shell",
            ],
        );
        if bun_sys::is_executable_file_path(bin2) {
            return Some(ZBox::from_bytes(bin2.as_bytes()));
        }
    }
    None
}

#[cfg(not(windows))]
fn spawn(
    vm: &mut VirtualMachine,
    user_data_dir: Option<&CStr>,
    explicit_path: Option<&CStr>,
    extra_argv: &[*const c_char],
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> Result<Fd, bun_core::Error> {
    // PERF(port): was arena bulk-free — all temp strings now individually heap-allocated.

    let chrome = find_chrome(explicit_path).ok_or(bun_core::err!("ChromeNotFound"))?;
    scoped_log!(Chrome, "using chrome: {}", bstr::BStr::new(chrome.as_bytes()));

    // One socketpair. Parent keeps fds[0], child gets fds[1] dup'd to BOTH
    // fd 3 and fd 4. Chrome read(3)'s commands and write(4)'s replies —
    // both hit the same socket. Parent end nonblocking so usockets recv
    // returns EAGAIN; child end BLOCKING for Chrome's dedicated-thread
    // read loop. O_NONBLOCK lives on the open file description (shared
    // across dup2), so set it on fds[0] only — fds[0] and fds[1] are two
    // different descriptions (peer sockets), the flag isn't shared across.
    let fds: [Fd; 2] = bun_sys::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, false)?;
    let fds = scopeguard::guard(fds, |fds| {
        fds[0].close();
        fds[1].close();
    });
    bun_sys::set_nonblocking(fds[0])?;

    // Minimal flags. --remote-debugging-pipe is the one that matters;
    // --headless works on both full Chrome (switches to headless mode) and
    // chrome-headless-shell (no-op, it's already headless). --headless=new
    // breaks chrome-headless-shell (it IS the new headless mode; =new is a
    // full-Chrome-only switch). Playwright passes plain --headless
    // (chromium.js:293).
    //
    // --user-data-dir MUST precede --remote-debugging-pipe in argv. Chrome's
    // CommandLine::Init stops at the first -- after argv[0] on some builds;
    // order-insensitive on most, but --user-data-dir-first is the defensive
    // layout every headless harness uses. Without it, ProcessSingleton locks
    // the default profile (~/Library/Application Support/Google/Chrome) and
    // aborts if a real Chrome is already running.
    let data_dir: ZBox = if let Some(d) = user_data_dir {
        let d = d.to_bytes();
        let mut v = Vec::with_capacity(b"--user-data-dir=".len() + d.len());
        v.extend_from_slice(b"--user-data-dir=");
        v.extend_from_slice(d);
        ZBox::from_vec(v)
    } else {
        // pid_t → u32 cast so {d} formats. Fresh dir per parent process;
        // multiple Bun.WebView instances in one process share the Chrome.
        // SAFETY: getpid() is infallible.
        let pid: u32 = unsafe { libc::getpid() } as u32;
        let mut v = Vec::new();
        write!(&mut v, "--user-data-dir=/tmp/bun-chrome-{}", pid).unwrap();
        ZBox::from_vec(v)
    };

    let mut argv: Vec<*const c_char> = Vec::new();
    argv.push(chrome.as_ptr());
    argv.push(data_dir.as_ptr());
    argv.push(c"--remote-debugging-pipe".as_ptr());
    argv.push(c"--headless".as_ptr());
    argv.push(c"--no-first-run".as_ptr());
    argv.push(c"--no-default-browser-check".as_ptr());
    argv.push(c"--disable-gpu".as_ptr()); // headless CI has no GPU context
    // Enterprise policy can force-install extensions (webRequest spam on
    // stderr). --disable-extensions is best-effort; mandatory extensions
    // may still load. --disable-background-networking shuts up GCM/update.
    argv.push(c"--disable-extensions".as_ptr());
    argv.push(c"--disable-background-networking".as_ptr());
    // Throttling suite (playwright's chromiumSwitches.ts subset). These
    // gate rAF/setTimeout firing when the tab thinks it's backgrounded.
    // A headless target is "occluded" by definition; without these Chrome
    // throttles timers to 1 Hz and pauses rAF entirely.
    argv.push(c"--disable-background-timer-throttling".as_ptr());
    argv.push(c"--disable-backgrounding-occluded-windows".as_ptr());
    argv.push(c"--disable-renderer-backgrounding".as_ptr());
    // CDP message rate limiter — a burst of evaluates/clicks in a test
    // loop hits it otherwise. Playwright and puppeteer both ship this.
    argv.push(c"--disable-ipc-flooding-protection".as_ptr());
    // No startup window — targets are Target.createTarget'd, not the
    // default about:blank. Saves one tab and the visual-complete wait.
    argv.push(c"--no-startup-window".as_ptr());
    // User extras last so they can override built-in flags (Chrome's
    // CommandLine last-wins for duplicate switches). Memory is the caller's
    // CString Vector — lives until Bun__Chrome__ensure returns, after which
    // posix_spawn has copied argv into the child.
    for a in extra_argv {
        argv.push(*a);
    }
    argv.push(core::ptr::null());

    // SAFETY: `transpiler.env` is the per-VM DotEnv loader (set during init,
    // valid for VM lifetime); `.map` is its `&mut Map` slot.
    let env = unsafe { (*vm.transpiler.env).map.create_null_delimited_env_map() }
        .map_err(|_| bun_core::err!("OutOfMemory"))?;

    let opts = SpawnOptions {
        stdin: Stdio::Ignore,
        stdout: if stdout_inherit { Stdio::Inherit } else { Stdio::Ignore },
        stderr: if stderr_inherit { Stdio::Inherit } else { Stdio::Ignore },
        // fd 3 AND fd 4 both point at fds[1]. spawnProcess dup2's each
        // .pipe entry to 3+index; passing the same fd twice gives Chrome
        // the same socket at both positions.
        extra_fds: Box::new([Stdio::Pipe(fds[1]), Stdio::Pipe(fds[1])]),
        argv0: Some(chrome.as_ptr()),
        ..SpawnOptions::default()
    };

    let spawned = bun_spawn::spawn_process(&opts, argv.as_ptr(), env.as_ptr().cast())??;

    // PORT NOTE: reshaped for borrowck — disarm the scopeguard now and close
    // explicitly on the WatchFailed path below (Zig's errdefer stayed armed
    // past this point and would re-close fds[1] on WatchFailed; that's
    // idempotent there but a clear use-after-close here).
    let fds = scopeguard::ScopeGuard::into_inner(fds);

    // Parent doesn't need the child's end. POSIX_SPAWN_CLOEXEC_DEFAULT
    // already closed our copy in the child (only fd 3/4 survive the exec);
    // close our reference so Chrome's death EOF's our end.
    fds[1].close();

    let self_ptr = Box::into_raw(Box::new(ChromeProcess {
        process: NonNull::new(spawned.to_process(
            EventLoopHandle::init(vm.event_loop().cast::<()>()),
            false,
        ))
        .expect("toProcess returned null"),
    }));
    // SAFETY: self_ptr is a freshly-allocated, exclusively-owned Box.
    let self_ref = unsafe { &mut *self_ptr };
    // SAFETY: process is valid; set_exit_handler stores `self_ptr` as the callback receiver.
    unsafe {
        self_ref
            .process
            .as_mut()
            .set_exit_handler(self_ptr.cast::<()>(), &CHROME_EXIT_VTABLE)
    };
    // SAFETY: process is valid.
    match unsafe { self_ref.process.as_mut().watch() } {
        Ok(()) => {
            // Same weak-handle reasoning as HostProcess: parent exit →
            // Chrome's fd 3 EOFs → DevToolsPipeHandler::Shutdown → exit.
            // dispatchOnExit also SIGKILLs via Bun__Chrome__kill.
            // SAFETY: process is valid and exclusively owned here.
            unsafe { self_ref.process.as_mut().disable_keeping_event_loop_alive() };
        }
        Err(e) => {
            scoped_log!(Chrome, "watch failed: {}", e);
            // SAFETY: process is valid; drop the ref we hold (replaces Zig's
            // `process.deref()` + `bun.destroy(self)`).
            unsafe { self_ref.process.as_mut().deref() };
            // SAFETY: self_ptr was allocated via Box::into_raw above.
            unsafe { drop(Box::from_raw(self_ptr)) };
            fds[0].close();
            return Err(bun_core::err!("WatchFailed"));
        }
    }
    // SAFETY: JS-thread-only global.
    unsafe { INSTANCE = self_ptr };
    // fd returned to C++ which adopts it into usockets. Not stored here —
    // usockets owns it; we only own the process lifetime.
    Ok(fds[0])
}

// Implemented in ChromeBackend.cpp. Rejects all pending CDP promises.
unsafe extern "C" {
    fn Bun__Chrome__died(signo: i32);
}

// --- DevToolsActivePort discovery -------------------------------------------
// Chrome writes <port>\n/devtools/browser/<id> to DevToolsActivePort in its
// profile dir when remote debugging is on (via --remote-debugging-port OR
// the chrome://inspect toggle). Sync file read — instant answer, no network.
// The new chrome://inspect toggle does NOT expose /json/version (404), so
// this file is the ONLY discovery mechanism for that mode. chrome-devtools-
// mcp does the same.

/// Read DevToolsActivePort from Chrome's default profile directory.
/// Chrome writes this when --remote-debugging-port is set OR when the
/// user flips the "Allow remote debugging" toggle in chrome://inspect.
/// Two lines: port, then path (/devtools/browser/<id>). Returns the
/// full ws:// URL in out_buf, or null if the file doesn't exist /
/// is malformed / the profile dir is non-standard.
fn read_dev_tools_active_port(out_buf: &mut Vec<u8>) -> Option<()> {
    // Default profile locations. Multiple Chrome channels (stable/beta/
    // canary) have distinct dirs; try each. Chromium and Edge also
    // respond to the same debugging protocol.
    // Windows roots under %LOCALAPPDATA%; POSIX under $HOME. The subdir
    // names come from each browser's installer — hardcoded, not
    // discoverable. Edge uses the same CDP + file format as Chrome.
    #[cfg(windows)]
    let root = getenv_z(ZStr::from_static(b"LOCALAPPDATA\0"))?;
    #[cfg(not(windows))]
    let root = getenv_z(ZStr::from_static(b"HOME\0"))?;

    #[cfg(target_os = "macos")]
    let candidates: &[&[u8]] = &[
        b"Library/Application Support/Google/Chrome/DevToolsActivePort",
        b"Library/Application Support/Google/Chrome Canary/DevToolsActivePort",
        b"Library/Application Support/Google/Chrome Beta/DevToolsActivePort",
        b"Library/Application Support/Chromium/DevToolsActivePort",
        b"Library/Application Support/BraveSoftware/Brave-Browser/DevToolsActivePort",
        b"Library/Application Support/Microsoft Edge/DevToolsActivePort",
    ];
    #[cfg(target_os = "linux")]
    let candidates: &[&[u8]] = &[
        b".config/google-chrome/DevToolsActivePort",
        b".config/google-chrome-beta/DevToolsActivePort",
        b".config/google-chrome-unstable/DevToolsActivePort",
        b".config/chromium/DevToolsActivePort",
        b".config/BraveSoftware/Brave-Browser/DevToolsActivePort",
        b".config/microsoft-edge/DevToolsActivePort",
    ];
    #[cfg(windows)]
    let candidates: &[&[u8]] = &[
        // Windows installer layout: <vendor>\<channel>\User Data\
        b"Google\\Chrome\\User Data\\DevToolsActivePort",
        b"Google\\Chrome SxS\\User Data\\DevToolsActivePort", // Canary
        b"Google\\Chrome Beta\\User Data\\DevToolsActivePort",
        b"Chromium\\User Data\\DevToolsActivePort",
        b"BraveSoftware\\Brave-Browser\\User Data\\DevToolsActivePort",
        b"Microsoft\\Edge\\User Data\\DevToolsActivePort",
    ];
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    let candidates: &[&[u8]] = &[];

    let mut path_buf = PathBuffer::uninit();
    for rel in candidates {
        let path = resolve_path::join_abs_string_buf_z::<platform::Auto>(
            root,
            path_buf.as_mut_slice(),
            &[rel],
        );
        let contents: Vec<u8> = match bun_sys::File::read_from(Fd::cwd(), path.as_bytes()) {
            Err(_) => continue, // ENOENT or EACCES — try next
            Ok(c) => c,
        };

        // Parse: line 1 = port, line 2 = path.
        let mut lines = contents.split(|b| *b == b'\n');
        let port_str = match lines.next() {
            Some(s) => strings::trim(s, b" \r\t"),
            None => continue,
        };
        let ws_path = match lines.next() {
            Some(s) => strings::trim(s, b" \r\t"),
            None => continue,
        };
        // Validate port (catch stale/corrupt files).
        let port: u16 = match core::str::from_utf8(port_str).ok().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        if port == 0 || ws_path.is_empty() || ws_path[0] != b'/' {
            continue;
        }

        out_buf.clear();
        write!(out_buf, "ws://127.0.0.1:{}", port).ok()?;
        out_buf.extend_from_slice(ws_path);
        return Some(());
    }
    None
}

/// Auto-discover a running Chrome's WebSocket debugger URL by reading
/// DevToolsActivePort (instant, no network). Writes the ws:// URL into
/// out_buf and returns its length, or 0 if no file found.
///
/// C++ calls this from the constructor when backend:"chrome" has no
/// explicit path or url — if we get a URL back, connect to the existing
/// Chrome; else spawn our own. Sync file read means the constructor
/// stays synchronous and the decision is made before any I/O kicks off.
///
/// The file can be stale — Chrome crashed without cleaning up, or was
/// restarted with a different browser-id. The subsequent WS connect
/// fails with a close code; C++ falls back to spawn in that case
/// (m_wasAutoDetected gate in wsOnClose). We don't pre-validate here
/// because that'd need a network round-trip which defeats the file.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Chrome__autoDetect(out_buf: *mut u8, out_cap: usize) -> usize {
    let mut buf: Vec<u8> = Vec::new();
    if read_dev_tools_active_port(&mut buf).is_some() {
        if buf.len() > out_cap {
            return 0;
        }
        // SAFETY: caller guarantees out_buf points to at least out_cap writable bytes.
        unsafe {
            core::ptr::copy_nonoverlapping(buf.as_ptr(), out_buf, buf.len());
        }
        return buf.len();
    }
    0
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webview/ChromeProcess.zig (477 lines)
//   confidence: medium
//   notes:      arena dropped (non-AST); owned [:0]u8 via bun_core::ZBox; static mut INSTANCE
//               needs Phase B sync wrapper; Process held via intrusive-rc NonNull (matches HostProcess.rs)
// ──────────────────────────────────────────────────────────────────────────

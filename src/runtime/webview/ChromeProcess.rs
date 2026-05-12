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

use core::ffi::{CStr, c_char};
use core::ptr::{self, NonNull};
use std::io::Write as _;

use bun_core::strings;
use bun_core::{self, ZBox, ZStr, env_var, getenv_z, zstr};
use bun_jsc::JSGlobalObject;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, path_buffer_pool, platform, resolve_path};
use bun_spawn::{
    self, EventLoopHandle, Process, ProcessExit, ProcessExitKind, Rusage, SpawnOptions,
    SpawnResultExt as _, Status, Stdio,
};
use bun_sys::{self, Fd, FdExt as _, O};
use bun_which::which;

declare_scope!(Chrome, hidden);

pub struct ChromeProcess {
    // Intrusive refcount (`.deref()` called in on_process_exit); kept raw to
    // match Zig `*bun.spawn.Process`.
    process: NonNull<Process>,
}

// PORTING.md §Global mutable state: JS-thread-only singleton ptr → AtomicPtr.
// Only accessed from the JS thread (exported fns are called from C++ on the
// mutator thread; on_process_exit runs on the event loop thread which is the
// same thread). Relaxed ordering matches the Zig non-atomic var.
static INSTANCE: core::sync::atomic::AtomicPtr<ChromeProcess> =
    core::sync::atomic::AtomicPtr::new(ptr::null_mut());

/// Called from WebView.closeAll() and dispatchOnExit. Chrome spawns its own
/// renderer/gpu/utility children (the "process model" zygote tree) — tracked
/// by Chrome's own ProcessSingleton, they exit when the browser process
/// dies. SIGKILL here takes the browser process, the zygote tree follows.
/// The C++ side doesn't touch JS state; EVFILT_PROC → Bun__Chrome__died →
/// rejectAllAndMarkDead handles promise rejection on the next loop tick.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Chrome__kill() {
    // SAFETY: JS-thread-only global; see INSTANCE decl.
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
    global: &JSGlobalObject,
    user_data_dir: *const c_char,     // ?[*:0]const u8
    path: *const c_char,              // ?[*:0]const u8
    extra_argv: *const *const c_char, // ?[*]const [*:0]const u8
    extra_argv_len: u32,
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> i32 {
    #[cfg(windows)]
    {
        let _ = (
            global,
            user_data_dir,
            path,
            extra_argv,
            extra_argv_len,
            stdout_inherit,
            stderr_inherit,
        );
        return -1;
    }
    #[cfg(not(windows))]
    {
        if !INSTANCE
            .load(core::sync::atomic::Ordering::Relaxed)
            .is_null()
        {
            return -1; // C++ already holds the fd
        }

        let extra: &[*const c_char] = if extra_argv.is_null() {
            &[]
        } else {
            // SAFETY: caller guarantees extra_argv points to extra_argv_len entries.
            unsafe { core::slice::from_raw_parts(extra_argv, extra_argv_len as usize) }
        };
        let vm = global.bun_vm_ptr();
        // SAFETY: caller passes valid NUL-terminated strings when non-null.
        let user_data_dir = if user_data_dir.is_null() {
            None
        } else {
            Some(unsafe { bun_core::ffi::cstr(user_data_dir) })
        };
        // SAFETY: caller passes valid NUL-terminated strings when non-null.
        let path = if path.is_null() {
            None
        } else {
            Some(unsafe { bun_core::ffi::cstr(path) })
        };
        let fd = match spawn(
            vm,
            user_data_dir,
            path,
            extra,
            stdout_inherit,
            stderr_inherit,
        ) {
            Ok(fd) => fd,
            Err(err) => {
                scoped_log!(Chrome, "spawn failed: {}", err.name());
                return -1;
            }
        };
        fd.native()
    }
}

bun_spawn::link_impl_ProcessExit! {
    ChromeProcess for ChromeProcess => |this| {
        on_process_exit(_process, status, _rusage) => {
            scoped_log!(Chrome, "chrome exited: {}", status);
            let signo: i32 = status.signal_code().map_or(0, |s| s as i32);
            Bun__Chrome__died(signo);
            // `this` was heap-allocated in spawn(); process is the
            // intrusive-rc *mut Process whose strong ref we hold. `deref()`
            // drops that ref, then drop the Box.
            Process::deref((*this).process.as_ptr());
            drop(bun_core::heap::take(this));
            INSTANCE.store(ptr::null_mut(), core::sync::atomic::Ordering::Relaxed);
        },
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
fn find_chrome(explicit_path: Option<&CStr>) -> Option<ZBox> {
    // Precedence: backend.path > BUN_CHROME_PATH > $PATH > hardcoded > playwright.
    // backend.path is per-Bun.WebView call (first wins — later views reuse
    // the already-spawned Chrome); env var is per-process.
    if let Some(p) = explicit_path {
        return Some(ZBox::from_bytes(p.to_bytes()));
    }
    if let Some(p) = getenv_z(zstr!("BUN_CHROME_PATH")) {
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
            return Some(ZBox::from_bytes(&found[..]));
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
            let sys_parts: [&[u8]; 2] = [b"/Applications", b];
            let sys = resolve_path::join_string_buf_z::<platform::Auto>(&mut buf[..], &sys_parts);
            if bun_sys::is_executable_file_path(sys) {
                return Some(ZBox::from_bytes(&sys[..]));
            }
            if !home.is_empty() {
                let user_parts: [&[u8]; 3] = [home, b"Applications", b];
                let user =
                    resolve_path::join_string_buf_z::<platform::Auto>(&mut buf[..], &user_parts);
                if bun_sys::is_executable_file_path(user) {
                    return Some(ZBox::from_bytes(&user[..]));
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let absolute: [&ZStr; 8] = [
            zstr!("/usr/bin/google-chrome-stable"),
            zstr!("/usr/bin/google-chrome"),
            zstr!("/usr/bin/chromium-browser"),
            zstr!("/usr/bin/chromium"),
            zstr!("/snap/bin/chromium"),
            zstr!("/usr/bin/brave-browser"),
            zstr!("/snap/bin/brave"),
            zstr!("/usr/bin/microsoft-edge"),
        ];
        for c in absolute {
            if bun_sys::is_executable_file_path(c) {
                return Some(ZBox::from_bytes(&c[..]));
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
fn find_playwright_shell() -> Option<ZBox> {
    let home = env_var::HOME.get()?;

    let mut dir_buf = path_buffer_pool::get();
    let cache_subpath: &[u8] = if cfg!(target_os = "macos") {
        b"Library/Caches/ms-playwright"
    } else {
        b".cache/ms-playwright"
    };
    let parts: [&[u8]; 2] = [home, cache_subpath];
    let cache_dir = resolve_path::join_string_buf_z::<platform::Auto>(&mut dir_buf[..], &parts);

    let fd = bun_sys::open(cache_dir, O::RDONLY | O::DIRECTORY, 0).ok()?;
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
        if entry.kind != bun_sys::EntryKind::Directory {
            continue;
        }
        // Zig spec: `bun.DirIterator.iterate(fd, .u8)` — request UTF-8 names
        // even on Windows. `slice_u8()` is the cross-platform `&[u8]` borrow.
        let name = entry.name.slice_u8();
        if !name.starts_with(PREFIX) {
            continue;
        }
        let rev_str = &name[PREFIX.len()..];
        let rev: u32 = match bun_core::fmt::parse_int(rev_str, 10).ok() {
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
    let arch: &str = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let plat: &str = if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let mut subdir_cft: Vec<u8> = Vec::new();
    write!(
        &mut subdir_cft,
        "chrome-headless-shell-{}-{}/chrome-headless-shell",
        plat, arch
    )
    .ok()?;

    let cache_dir: &[u8] = &cache_dir[..];
    let mut bin_buf = path_buffer_pool::get();
    let bin_parts: [&[u8]; 3] = [cache_dir, &best_name[..best_len], &subdir_cft];
    let bin = resolve_path::join_string_buf_z::<platform::Auto>(&mut bin_buf[..], &bin_parts);
    if bun_sys::is_executable_file_path(bin) {
        return Some(ZBox::from_bytes(&bin[..]));
    }

    // Fall back to the non-cft linux arm64 layout.
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        let bin_parts2: [&[u8]; 3] = [
            cache_dir,
            &best_name[..best_len],
            b"chrome-linux/headless_shell",
        ];
        let bin2 = resolve_path::join_string_buf_z::<platform::Auto>(&mut bin_buf[..], &bin_parts2);
        if bun_sys::is_executable_file_path(bin2) {
            return Some(ZBox::from_bytes(&bin2[..]));
        }
    }
    None
}

fn spawn(
    vm: *mut VirtualMachine,
    user_data_dir: Option<&CStr>,
    explicit_path: Option<&CStr>,
    extra_argv: &[*const c_char],
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> Result<Fd, bun_core::Error> {
    #[cfg(windows)]
    {
        let _ = (
            vm,
            user_data_dir,
            explicit_path,
            extra_argv,
            stdout_inherit,
            stderr_inherit,
        );
        return Err(bun_core::err!("Unsupported"));
    }
    #[cfg(not(windows))]
    {
        // PERF(port): was arena bulk-free — all temp strings now individually heap-allocated.

        let chrome = find_chrome(explicit_path).ok_or(bun_core::err!("ChromeNotFound"))?;
        scoped_log!(
            Chrome,
            "using chrome: {}",
            bstr::BStr::new(chrome.as_bytes())
        );

        // One socketpair. Parent keeps fds[0], child gets fds[1] dup'd to BOTH
        // fd 3 and fd 4. Chrome read(3)'s commands and write(4)'s replies —
        // both hit the same socket. Parent end nonblocking so usockets recv
        // returns EAGAIN; child end BLOCKING for Chrome's dedicated-thread
        // read loop. O_NONBLOCK lives on the open file description (shared
        // across dup2), so set it on fds[0] only — fds[0] and fds[1] are two
        // different descriptions (peer sockets), the flag isn't shared across.
        let fds: [Fd; 2] = bun_sys::socketpair(
            libc::AF_UNIX as i32,
            libc::SOCK_STREAM as i32,
            0,
            false, // .blocking
        )?;
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
            let mut v = Vec::with_capacity(16 + d.len());
            v.extend_from_slice(b"--user-data-dir=");
            v.extend_from_slice(d);
            ZBox::from_vec(v)
        } else {
            // pid_t → u32 cast so {d} formats. Fresh dir per parent process;
            // multiple Bun.WebView instances in one process share the Chrome.
            // SAFETY: getpid is always safe.
            let pid: u32 = unsafe { libc::getpid() } as u32;
            let mut v = Vec::new();
            write!(&mut v, "--user-data-dir=/tmp/bun-chrome-{}", pid)
                .expect("infallible: in-memory write");
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

        // SAFETY: vm is the per-thread VirtualMachine (valid for the call);
        // `transpiler.env` is set during VM init and lives for VM lifetime;
        // `.map` is its `&mut Map` slot.
        let env = unsafe { (*(*vm).transpiler.env).map.create_null_delimited_env_map() }?;

        let opts = SpawnOptions {
            stdin: Stdio::Ignore,
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
            // fd 3 AND fd 4 both point at fds[1]. spawnProcess dup2's each
            // .pipe entry to 3+index; passing the same fd twice gives Chrome
            // the same socket at both positions.
            extra_fds: vec![Stdio::Pipe(fds[1]), Stdio::Pipe(fds[1])].into_boxed_slice(),
            argv0: Some(chrome.as_ptr()),
            ..SpawnOptions::default()
        };

        // TODO(port): narrow error set — outer Result + inner bun_sys::Result
        let spawned = bun_spawn::spawn_process(&opts, argv.as_ptr(), env.as_ptr().cast())??;

        // PORT NOTE: reshaped for borrowck — Zig's errdefer stays armed past
        // this point (and would re-close fds on the WatchFailed path below);
        // we disarm here and close explicitly on that path instead.
        // TODO(port): verify Zig errdefer double-close of fds[1] on WatchFailed is intentional/idempotent.
        let fds = scopeguard::ScopeGuard::into_inner(fds);

        // Parent doesn't need the child's end. POSIX_SPAWN_CLOEXEC_DEFAULT
        // already closed our copy in the child (only fd 3/4 survive the exec);
        // close our reference so Chrome's death EOF's our end.
        fds[1].close();

        // SAFETY: vm is valid for the call.
        let event_loop = EventLoopHandle::init(unsafe { (*vm).event_loop() }.cast());
        let process =
            NonNull::new(spawned.to_process(event_loop, false)).expect("toProcess returned null");
        let self_ptr = bun_core::heap::into_raw(Box::new(ChromeProcess { process }));
        // SAFETY: `self_ptr` is a freshly-allocated, exclusively-owned Box that
        // owns `process` and outlives it.
        unsafe {
            (*process.as_ptr())
                .set_exit_handler(ProcessExit::new(ProcessExitKind::ChromeProcess, self_ptr));
        }
        // SAFETY: process is live and exclusively owned here.
        match unsafe { (*process.as_ptr()).watch() } {
            Ok(()) => {
                // Same weak-handle reasoning as HostProcess: parent exit →
                // Chrome's fd 3 EOFs → DevToolsPipeHandler::Shutdown → exit.
                // dispatchOnExit also SIGKILLs via Bun__Chrome__kill.
                // SAFETY: process is live and exclusively owned here.
                unsafe { (*process.as_ptr()).disable_keeping_event_loop_alive() };
            }
            Err(e) => {
                scoped_log!(Chrome, "watch failed: {}", e);
                // SAFETY: drop the strong ref we hold (Zig: `process.deref()`),
                // then reclaim the Box (Zig: `bun.destroy(self)`).
                unsafe {
                    Process::deref(process.as_ptr());
                    drop(bun_core::heap::take(self_ptr));
                }
                fds[0].close();
                return Err(bun_core::err!("WatchFailed"));
            }
        }
        INSTANCE.store(self_ptr, core::sync::atomic::Ordering::Relaxed);
        // fd returned to C++ which adopts it into usockets. Not stored here —
        // usockets owns it; we only own the process lifetime.
        Ok(fds[0])
    }
}

// Implemented in ChromeBackend.cpp. Rejects all pending CDP promises.
// TODO(port): move to <runtime>_sys
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
    // NB: do NOT route Windows through bun_core::getenv_z — it is stubbed to
    // None on cfg(windows) (TODO(b2-blocked) in bun_core/util.rs), which made
    // this whole function dead on Windows. Zig's bun.getenvZ walks the env
    // block case-insensitively and returns a real value; std::env::var is the
    // working equivalent here (LOCALAPPDATA is always valid Unicode).
    #[cfg(windows)]
    let root_owned = std::env::var("LOCALAPPDATA").ok()?;
    #[cfg(windows)]
    let root: &[u8] = root_owned.as_bytes();
    #[cfg(not(windows))]
    let root = getenv_z(zstr!("HOME"))?;

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

    let mut path_buf = path_buffer_pool::get();
    for rel in candidates {
        let path =
            resolve_path::join_abs_string_buf_z::<platform::Auto>(root, &mut path_buf[..], &[rel]);
        let contents: Vec<u8> = match bun_sys::File::read_from(Fd::cwd(), path) {
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
        let port: u16 = match bun_core::fmt::parse_int(port_str, 10).ok() {
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

// ported from: src/runtime/webview/ChromeProcess.zig

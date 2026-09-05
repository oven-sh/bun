//! Spawns Chrome/Chromium with --remote-debugging-pipe. The child reads CDP
//! JSON from fd 3 and writes replies to fd 4 (NUL-delimited). No separate
//! host process — Chrome IS the IPC peer. One fewer hop than WKWebView.
//!
//! Parent death → Chrome's pipe read EOFs → Chrome exits. Same lifetime
//! coupling as HostProcess.rs's socket EOF path.
//!
//! fd layout (child):
//!   3 = Chrome reads CDP commands from us  (parent writes → child reads)
//!   4 = Chrome writes CDP replies to us    (child writes  → parent reads)
//!
//! POSIX: one socketpair, the child end dup'd to BOTH fd 3 and fd 4. Chrome's
//! DevToolsPipeHandler does read(3) and write(4) — it doesn't care that
//! both fds point at the same socket. usockets' bsd_recv() calls recv()
//! which fails ENOTSOCK on a pipe fd (the earlier two-pipes layout broke
//! here: recv(readFd) returned -1 → loop treated as close → onClose fired
//! before any data); socketpair gives us a proper socket for the read path
//! and the write path can share it.
//! Windows (no inheritable sockets): two uv_pipe()s driven here instead, see [`PipeEvent`] and `Bun__Chrome__writePipe`.

use core::ffi::{CStr, c_char};
use core::ptr;
#[cfg(windows)]
use core::sync::atomic::AtomicU32;
use core::sync::atomic::{AtomicPtr, Ordering};
use std::io::Write as _;

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_core::ZStr;
use bun_core::{self, ZBox, env_var, getenv_z, strings, zstr};
use bun_jsc::JSGlobalObject;
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(windows)]
use bun_libuv_sys::{UvHandle as _, UvStream as _};
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, path_buffer_pool, platform, resolve_path};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{
    self, EventLoopHandle, Process, ProcessExit, ProcessExitKind, ProcessHandle, SpawnOptions,
    Status, Stdio,
};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd, FdExt as _};
use bun_which::which;

declare_scope!(Chrome, hidden);

pub(crate) struct ChromeProcess {
    process: ProcessHandle,
    /// Set by [`Bun__Chrome__retire`]: the exit is reaped but not reported to C++.
    retired: bool,
    #[cfg(windows)]
    pipes: WindowsPipes,
    #[cfg(windows)]
    generation: u32,
}

/// Our ends of the two pipes (boxed, null once closed) and the read scratch.
#[cfg(windows)]
struct WindowsPipes {
    /// Child reads the other end as fd 3.
    cmd: *mut uv::Pipe,
    /// Child writes the other end as fd 4.
    reply: *mut uv::Pipe,
    read_buf: Box<[u8]>,
}

// PORTING.md §Global mutable state: JS-thread-only singleton ptr → AtomicPtr.
// Only accessed from the JS thread (exported fns are called from C++ on the
// mutator thread; on_process_exit runs on the event loop thread which is the
// same thread), so Relaxed ordering suffices.
static INSTANCE: AtomicPtr<ChromeProcess> = AtomicPtr::new(ptr::null_mut());

/// Generation of the Chrome in INSTANCE; stamped on every [`PipeEvent`] (same threading as INSTANCE).
#[cfg(windows)]
static GENERATION: AtomicU32 = AtomicU32::new(0);

/// Called from WebView.closeAll() and dispatchOnExit. Chrome spawns its own
/// renderer/gpu/utility children (the "process model" zygote tree) — tracked
/// by Chrome's own ProcessSingleton, they exit when the browser process
/// dies. SIGKILL here takes the browser process, the zygote tree follows.
/// The C++ side doesn't touch JS state; EVFILT_PROC → Bun__Chrome__died →
/// rejectAllAndMarkDead handles promise rejection on the next loop tick.
#[unsafe(no_mangle)]
extern "C" fn Bun__Chrome__kill() {
    // SAFETY: JS-thread-only global; see INSTANCE decl.
    unsafe {
        if let Some(i) = INSTANCE.load(Ordering::Relaxed).as_mut() {
            let _ = i.process.kill(9);
        }
    }
}

/// Transport::retireGlobal (`bun test --isolate`): unpublish and kill this Chrome so the next file can spawn its own at once.
#[unsafe(no_mangle)]
extern "C" fn Bun__Chrome__retire() {
    let this = INSTANCE.swap(ptr::null_mut(), Ordering::Relaxed);
    // SAFETY: INSTANCE held a live heap-allocated pointer; `on_exit` only
    // frees it after it runs, and we have just taken it out of INSTANCE.
    let Some(chrome) = (unsafe { this.as_mut() }) else {
        return;
    };
    chrome.retired = true;
    #[cfg(windows)]
    {
        // Queued events from this Chrome carry its generation; `QueuedEvent::deliver` drops them.
        GENERATION.fetch_add(1, Ordering::Relaxed);
        chrome.pipes.close();
    }
    let _ = chrome.process.kill(9);
}

/// Returns the parent's socketpair fd (POSIX, owned by usockets from then on), 0 (Windows), or -1 on failure.
///
/// # Safety
/// `user_data_dir` and `path` must each be null or point to a valid
/// NUL-terminated string. `extra_argv` must be null or point to
/// `extra_argv_len` valid NUL-terminated string pointers.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Chrome__ensure(
    global: &JSGlobalObject,
    user_data_dir: *const c_char,     // ?[*:0]const u8
    path: *const c_char,              // ?[*:0]const u8
    extra_argv: *const *const c_char, // ?[*]const [*:0]const u8
    extra_argv_len: u32,
    stdout_inherit: bool,
    stderr_inherit: bool,
    detached: bool,
) -> i32 {
    {
        if !INSTANCE.load(Ordering::Relaxed).is_null() {
            return -1; // C++ already holds the transport
        }

        let extra: &[*const c_char] = if extra_argv.is_null() {
            &[]
        } else {
            // SAFETY: caller guarantees extra_argv points to extra_argv_len entries.
            unsafe { core::slice::from_raw_parts(extra_argv, extra_argv_len as usize) }
        };
        let vm = global.bun_vm_ptr();
        let user_data_dir = if user_data_dir.is_null() {
            None
        } else {
            // SAFETY: caller passes a valid NUL-terminated string when non-null; null is handled above.
            Some(unsafe { bun_core::ffi::cstr(user_data_dir) })
        };
        let path = if path.is_null() {
            None
        } else {
            // SAFETY: caller passes a valid NUL-terminated string when non-null; null is handled above.
            Some(unsafe { bun_core::ffi::cstr(path) })
        };
        match spawn(
            vm,
            user_data_dir,
            path,
            extra,
            stdout_inherit,
            stderr_inherit,
            detached,
        ) {
            Ok(rc) => rc,
            Err(err) => {
                scoped_log!(Chrome, "spawn failed: {}", err.name());
                -1
            }
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    ChromeProcess for ChromeProcess => |this| {
        on_process_exit(process, status, _rusage) => ChromeProcess::on_exit(this, process, &status),
    }
}

impl ChromeProcess {
    /// Safety: `this` is the pointer published in INSTANCE (freed here); `process` is the exit callback's own argument, which carries the `&mut Process` already live in its frame (as in `SyncWindowsProcess::on_process_exit`).
    unsafe fn on_exit(this: *mut ChromeProcess, process: *mut Process, status: &Status) {
        scoped_log!(Chrome, "chrome exited: {}", status);
        // A retired Chrome was already unpublished by `Bun__Chrome__retire`.
        let _ =
            INSTANCE.compare_exchange(this, ptr::null_mut(), Ordering::Relaxed, Ordering::Relaxed);
        // SAFETY: caller contract; nothing else references the allocation once INSTANCE is cleared.
        let mut chrome = unsafe { bun_core::heap::take(this) };
        debug_assert_eq!(process, chrome.process.as_ptr());
        chrome.close_transport();
        if chrome.retired {
            return;
        }
        let signo: i32 = status.signal_code().map_or(0, |s| s as i32);
        #[cfg(windows)]
        PipeEvent::Exited { signo }.post(chrome.generation);
        #[cfg(not(windows))]
        {
            drop(chrome);
            // SAFETY: plain FFI call; takes no pointers.
            unsafe { Bun__Chrome__died(signo) };
        }
    }

    /// On POSIX C++ owns the socket.
    fn close_transport(&mut self) {
        #[cfg(windows)]
        self.pipes.close();
    }
}

/// On Windows `is_executable_file_path` only looks at the extension.
fn is_browser_binary(path: &bun_core::ZStr) -> bool {
    #[cfg(windows)]
    {
        bun_sys::exists_z(path)
    }
    #[cfg(not(windows))]
    {
        bun_sys::is_executable_file_path(path)
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
///   windows: %LOCALAPPDATA%\ms-playwright\chromium_headless_shell-<rev>\chrome-headless-shell-win64\chrome-headless-shell.exe
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
    #[cfg(not(windows))]
    let names: &[&[u8]] = &[
        b"google-chrome-stable",
        b"google-chrome",
        b"chromium-browser",
        b"chromium",
        b"brave-browser",
        b"microsoft-edge",
        b"chrome", // brew cask symlink, some CI setups
    ];
    #[cfg(windows)]
    let names: &[&[u8]] = &[b"chrome", b"chromium", b"brave", b"msedge"];
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
            if is_browser_binary(sys) {
                return Some(ZBox::from_bytes(&sys[..]));
            }
            if !home.is_empty() {
                let user_parts: [&[u8]; 3] = [home, b"Applications", b];
                let user =
                    resolve_path::join_string_buf_z::<platform::Auto>(&mut buf[..], &user_parts);
                if is_browser_binary(user) {
                    return Some(ZBox::from_bytes(&user[..]));
                }
            }
        }
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
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
            if is_browser_binary(c) {
                return Some(ZBox::from_bytes(&c[..]));
            }
        }
    }
    #[cfg(windows)]
    {
        // Edge lives under ProgramFiles(x86) even on 64-bit; per-user installs (always Canary, "SxS") under LOCALAPPDATA.
        let relative: [&[u8]; 7] = [
            b"Google\\Chrome\\Application\\chrome.exe",
            b"Google\\Chrome Beta\\Application\\chrome.exe",
            b"Google\\Chrome Dev\\Application\\chrome.exe",
            b"Google\\Chrome SxS\\Application\\chrome.exe",
            b"Chromium\\Application\\chrome.exe",
            b"BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            b"Microsoft\\Edge\\Application\\msedge.exe",
        ];
        let roots: [Option<&[u8]>; 3] = [
            getenv_z(zstr!("ProgramFiles")),
            getenv_z(zstr!("ProgramFiles(x86)")),
            getenv_z(zstr!("LOCALAPPDATA")),
        ];
        for rel in relative {
            for &root in roots.iter().flatten() {
                if root.is_empty() {
                    continue;
                }
                let parts: [&[u8]; 2] = [root, rel];
                let candidate =
                    resolve_path::join_string_buf_z::<platform::Auto>(&mut buf[..], &parts);
                if is_browser_binary(candidate) {
                    return Some(ZBox::from_bytes(&candidate[..]));
                }
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
    #[cfg(windows)]
    let (root, cache_subpath): (&[u8], &[u8]) =
        (getenv_z(zstr!("LOCALAPPDATA"))?, b"ms-playwright");
    #[cfg(target_os = "macos")]
    let (root, cache_subpath): (&[u8], &[u8]) =
        (env_var::HOME.get()?, b"Library/Caches/ms-playwright");
    #[cfg(not(any(windows, target_os = "macos")))]
    let (root, cache_subpath): (&[u8], &[u8]) = (env_var::HOME.get()?, b".cache/ms-playwright");

    let mut dir_buf = path_buffer_pool::get();
    let parts: [&[u8]; 2] = [root, cache_subpath];
    let cache_dir = resolve_path::join_string_buf_z::<platform::Auto>(&mut dir_buf[..], &parts);

    let fd = bun_sys::open_dir_absolute(&cache_dir[..]).ok()?;
    // `defer fd.close()` — Fd has no Drop; close explicitly on all
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
        // The iterator requests UTF-8 names
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

    // Build the binary path. Possible subdir layouts:
    //   cft:     chrome-headless-shell-<plat>-<arch>/chrome-headless-shell
    //   windows: chrome-headless-shell-win64/chrome-headless-shell.exe
    //   non-cft: chrome-linux/headless_shell   (linux arm64 only)
    #[cfg(windows)]
    let subdir_cft: &[u8] = b"chrome-headless-shell-win64/chrome-headless-shell.exe";
    #[cfg(not(windows))]
    let subdir_cft_owned: Vec<u8> = {
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
        let mut v: Vec<u8> = Vec::new();
        write!(
            &mut v,
            "chrome-headless-shell-{}-{}/chrome-headless-shell",
            plat, arch
        )
        .ok()?;
        v
    };
    #[cfg(not(windows))]
    let subdir_cft: &[u8] = &subdir_cft_owned;

    let cache_dir: &[u8] = &cache_dir[..];
    let mut bin_buf = path_buffer_pool::get();
    let bin_parts: [&[u8]; 3] = [cache_dir, &best_name[..best_len], subdir_cft];
    let bin = resolve_path::join_string_buf_z::<platform::Auto>(&mut bin_buf[..], &bin_parts);
    if is_browser_binary(bin) {
        return Some(ZBox::from_bytes(&bin[..]));
    }

    // Fall back to the non-cft linux arm64 layout.
    #[cfg(all(
        any(target_os = "linux", target_os = "android"),
        target_arch = "aarch64"
    ))]
    {
        let bin_parts2: [&[u8]; 3] = [
            cache_dir,
            &best_name[..best_len],
            b"chrome-linux/headless_shell",
        ];
        let bin2 = resolve_path::join_string_buf_z::<platform::Auto>(&mut bin_buf[..], &bin_parts2);
        if is_browser_binary(bin2) {
            return Some(ZBox::from_bytes(&bin2[..]));
        }
    }
    None
}

/// Returns `Bun__Chrome__ensure`'s success value.
fn spawn(
    vm: *mut VirtualMachine,
    user_data_dir: Option<&CStr>,
    explicit_path: Option<&CStr>,
    extra_argv: &[*const c_char],
    stdout_inherit: bool,
    stderr_inherit: bool,
    detached: bool,
) -> crate::Result<i32> {
    {
        let chrome = find_chrome(explicit_path).ok_or(crate::Error::ChromeNotFound)?;
        scoped_log!(
            Chrome,
            "using chrome: {}",
            bstr::BStr::new(chrome.as_bytes())
        );

        // SAFETY: `vm` is the live thread-local VM; `event_loop()` is its
        // per-thread `jsc::EventLoop`.
        let event_loop = unsafe { EventLoopHandle::init((*vm).event_loop().cast()) };
        let mut endpoints = Endpoints::create(event_loop)?;

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
            let mut name_buf = [0u8; 64];
            let name = bun_paths::fs::FileSystem::tmpname(
                b"bun-chrome",
                &mut name_buf,
                bun_core::fast_random(),
            )?;
            let mut dir_buf = path_buffer_pool::get();
            let dir_parts: [&[u8]; 2] = [bun_resolver::fs::RealFS::tmpdir_path(), name.as_bytes()];
            let dir =
                resolve_path::join_string_buf_z::<platform::Auto>(&mut dir_buf[..], &dir_parts);
            bun_sys::mkdir(dir, 0o700)?;
            let mut v = Vec::with_capacity(16 + dir.len());
            v.extend_from_slice(b"--user-data-dir=");
            v.extend_from_slice(&dir[..]);
            ZBox::from_vec(v)
        };

        let mut argv: Vec<*const c_char> = vec![
            chrome.as_ptr(),
            data_dir.as_ptr(),
            c"--remote-debugging-pipe".as_ptr(),
            c"--headless".as_ptr(),
            c"--no-first-run".as_ptr(),
            c"--no-default-browser-check".as_ptr(),
            c"--disable-gpu".as_ptr(), // headless CI has no GPU context
            // Enterprise policy can force-install extensions (webRequest spam on
            // stderr). --disable-extensions is best-effort; mandatory extensions
            // may still load. --disable-background-networking shuts up GCM/update.
            c"--disable-extensions".as_ptr(),
            c"--disable-background-networking".as_ptr(),
            // Throttling suite (playwright's chromiumSwitches.ts subset). These
            // gate rAF/setTimeout firing when the tab thinks it's backgrounded.
            // A headless target is "occluded" by definition; without these Chrome
            // throttles timers to 1 Hz and pauses rAF entirely.
            c"--disable-background-timer-throttling".as_ptr(),
            c"--disable-backgrounding-occluded-windows".as_ptr(),
            c"--disable-renderer-backgrounding".as_ptr(),
            // CDP message rate limiter — a burst of evaluates/clicks in a test
            // loop hits it otherwise. Playwright and puppeteer both ship this.
            c"--disable-ipc-flooding-protection".as_ptr(),
            // No startup window — targets are Target.createTarget'd, not the
            // default about:blank. Saves one tab and the visual-complete wait.
            c"--no-startup-window".as_ptr(),
        ];
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
            extra_fds: endpoints.child_fds(), // dup2'd to child fd 3 and 4, in order
            argv0: Some(chrome.as_ptr()),
            detached,
            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                loop_: event_loop,
                ..Default::default()
            },
            ..SpawnOptions::default()
        };

        // SAFETY: `argv`/`env` are local null-terminated C-string arrays with
        // argv[0] non-null; valid for this call.
        let spawned =
            unsafe { bun_spawn::spawn_process(&opts, argv.as_ptr(), env.as_ptr().cast()) }??;
        #[cfg(windows)]
        let mut spawned = spawned;

        // Keeping our copies of the child's ends would mask Chrome's death (no EOF).
        endpoints.close_child_ends();

        endpoints.attach(spawned.to_process_handle(event_loop))
    }
}

// Implemented in ChromeBackend.cpp. Rejects all pending CDP promises.
unsafe extern "C" {
    fn Bun__Chrome__died(signo: i32);
}

// --- POSIX transport: one socketpair --------------------------------------

#[cfg(not(windows))]
struct Endpoints {
    /// `[parent, child]`. Both closed on drop unless taken.
    fds: Option<[Fd; 2]>,
    child_closed: bool,
}

#[cfg(not(windows))]
impl Endpoints {
    fn create(_event_loop: EventLoopHandle) -> crate::Result<Endpoints> {
        // Only our end goes nonblocking (for usockets); Chrome's reader thread wants its end blocking.
        let fds: [Fd; 2] = bun_sys::socketpair(
            libc::AF_UNIX as i32,
            libc::SOCK_STREAM as i32,
            0,
            false, // .blocking
        )?;
        let mut endpoints = Endpoints {
            fds: Some(fds),
            child_closed: false,
        };
        match bun_sys::set_nonblocking(fds[0]) {
            Ok(()) => Ok(endpoints),
            Err(err) => {
                endpoints.close_all();
                Err(err.into())
            }
        }
    }

    fn child_fds(&self) -> Box<[Stdio]> {
        let child = self.fds.expect("endpoints live")[1];
        // The one socket at both fd 3 (Chrome reads) and fd 4 (Chrome writes).
        vec![Stdio::Pipe(child), Stdio::Pipe(child)].into_boxed_slice()
    }

    fn close_child_ends(&mut self) {
        if !self.child_closed {
            self.child_closed = true;
            self.fds.expect("endpoints live")[1].close();
        }
    }

    fn close_all(&mut self) {
        if let Some(fds) = self.fds.take() {
            fds[0].close();
            if !self.child_closed {
                fds[1].close();
            }
        }
    }

    /// Publishes the singleton and returns our fd for C++ to adopt.
    fn attach(mut self, process: ProcessHandle) -> crate::Result<i32> {
        let self_ptr = bun_core::heap::into_raw(Box::new(ChromeProcess {
            process,
            retired: false,
        }));
        // SAFETY: `self_ptr` is the freshly-allocated Box that owns `process`
        // and outlives it.
        let process = unsafe {
            let process = &(*self_ptr).process;
            process
                .process_mut()
                .set_exit_handler(ProcessExit::new(ProcessExitKind::ChromeProcess, self_ptr));
            process
        };
        if let Err(e) = process.process_mut().watch() {
            scoped_log!(Chrome, "watch failed: {}", e);
            // SAFETY: reclaim the Box (drops our process ref).
            drop(unsafe { bun_core::heap::take(self_ptr) });
            self.close_all();
            return Err(crate::Error::WatchFailed);
        }
        // Same weak-handle reasoning as HostProcess: parent exit → Chrome's
        // fd 3 EOFs → DevToolsPipeHandler::Shutdown → exit. dispatchOnExit
        // also SIGKILLs via Bun__Chrome__kill.
        process.process_mut().disable_keeping_event_loop_alive();
        INSTANCE.store(self_ptr, Ordering::Relaxed);

        let fds = self.fds.take().expect("endpoints live");
        debug_assert!(self.child_closed);
        // usockets owns the fd from here on; this module only owns the process.
        Ok(fds[0].native())
    }
}

#[cfg(not(windows))]
impl Drop for Endpoints {
    fn drop(&mut self) {
        self.close_all();
    }
}

// --- Windows transport: two pipes -----------------------------------------

#[cfg(windows)]
const READ_BUF_SIZE: usize = 64 * 1024;

#[cfg(windows)]
struct Endpoints {
    /// The child's ends; `None` once closed.
    cmd_child: Option<Fd>,
    reply_child: Option<Fd>,
    /// Our ends; null once handed over.
    cmd: *mut uv::Pipe,
    reply: *mut uv::Pipe,
}

#[cfg(windows)]
impl Endpoints {
    fn create(event_loop: EventLoopHandle) -> crate::Result<Endpoints> {
        // uv_pipe() returns [read end, write end]; UV_NONBLOCK_PIPE (overlapped) goes on our ends only.
        let mut cmd_fds: [uv::uv_file; 2] = [0; 2];
        // SAFETY: FFI; `cmd_fds` is the out-array uv_pipe fills.
        unsafe { uv::uv_pipe(&raw mut cmd_fds, 0, uv::UV_NONBLOCK_PIPE as i32) }
            .to_result(bun_sys::Tag::uv_pipe)?;
        let mut endpoints = Endpoints {
            cmd_child: Some(Fd::from_uv(cmd_fds[0])),
            reply_child: None,
            cmd: ptr::null_mut(),
            reply: ptr::null_mut(),
        };
        let cmd_parent = Fd::from_uv(cmd_fds[1]);
        if let Err(err) = endpoints.wrap(event_loop, cmd_parent, |e, pipe| e.cmd = pipe) {
            cmd_parent.close();
            return Err(err);
        }

        let mut reply_fds: [uv::uv_file; 2] = [0; 2];
        // SAFETY: FFI; `reply_fds` is the out-array uv_pipe fills.
        unsafe { uv::uv_pipe(&raw mut reply_fds, uv::UV_NONBLOCK_PIPE as i32, 0) }
            .to_result(bun_sys::Tag::uv_pipe)?;
        endpoints.reply_child = Some(Fd::from_uv(reply_fds[1]));
        let reply_parent = Fd::from_uv(reply_fds[0]);
        if let Err(err) = endpoints.wrap(event_loop, reply_parent, |e, pipe| e.reply = pipe) {
            reply_parent.close();
            return Err(err);
        }
        Ok(endpoints)
    }

    /// On success libuv owns `fd`; on failure the caller still does.
    fn wrap(
        &mut self,
        event_loop: EventLoopHandle,
        fd: Fd,
        store: impl FnOnce(&mut Endpoints, *mut uv::Pipe),
    ) -> crate::Result<()> {
        let pipe: *mut uv::Pipe = bun_core::heap::into_raw(bun_core::boxed_zeroed::<uv::Pipe>());
        // SAFETY: `pipe` is a live Box; `close_and_destroy` frees it in any state.
        let result = unsafe {
            (*pipe)
                .init(event_loop.uv_loop(), false)
                .to_result(bun_sys::Tag::uv_pipe)
                .and_then(|()| (*pipe).open(fd.uv()).to_result(bun_sys::Tag::open))
        };
        if let Err(err) = result {
            // SAFETY: see above.
            unsafe { uv::Pipe::close_and_destroy(pipe) };
            return Err(err.into());
        }
        // Pending commands keep the loop alive (Transport::updateKeepAlive), not
        // the pipes.
        // SAFETY: `pipe` is initialized.
        unsafe { (*pipe).unref() };
        store(self, pipe);
        Ok(())
    }

    fn child_fds(&self) -> Box<[Stdio]> {
        vec![
            Stdio::Pipe(self.cmd_child.expect("endpoints live")), // fd 3
            Stdio::Pipe(self.reply_child.expect("endpoints live")), // fd 4
        ]
        .into_boxed_slice()
    }

    fn close_child_ends(&mut self) {
        if let Some(fd) = self.cmd_child.take() {
            fd.close();
        }
        if let Some(fd) = self.reply_child.take() {
            fd.close();
        }
    }

    /// Moves our ends into a [`ChromeProcess`], starts reading replies, and publishes it.
    fn attach(mut self, process: ProcessHandle) -> crate::Result<i32> {
        let pipes = WindowsPipes {
            cmd: core::mem::replace(&mut self.cmd, ptr::null_mut()),
            reply: core::mem::replace(&mut self.reply, ptr::null_mut()),
            read_buf: vec![0u8; READ_BUF_SIZE].into_boxed_slice(),
        };
        let reply = pipes.reply;
        let generation = GENERATION.load(Ordering::Relaxed).wrapping_add(1);
        let self_ptr = bun_core::heap::into_raw(Box::new(ChromeProcess {
            process,
            retired: false,
            pipes,
            generation,
        }));
        // SAFETY: `self_ptr` is the freshly-allocated Box that owns `process`.
        let process: *mut Process = unsafe { (*self_ptr).process.as_ptr() };

        // Unlike POSIX the exit can't be delivered before we return (it comes
        // through this thread's loop), so the exit handler is installed after.
        // SAFETY: `reply` and `process` are owned by `*self_ptr`, which
        // outlives the reads (`WindowsPipes::close` stops them first).
        let started = unsafe {
            (*reply)
                .read_start_ctx::<ChromeProcess>(self_ptr)
                .to_result(bun_sys::Tag::listen)
                .and_then(|()| (*process).watch())
        };
        if let Err(err) = started {
            scoped_log!(Chrome, "read_start/watch failed: {}", err);
            // SAFETY: `self_ptr` is unpublished; dropping it closes the pipes,
            // then detaches and releases the process.
            unsafe {
                let mut chrome = bun_core::heap::take(self_ptr);
                chrome.pipes.close();
                let _ = chrome.process.kill(9);
            }
            return Err(err.into());
        }

        // SAFETY: `self_ptr` is live until `on_exit`.
        unsafe {
            let p = process;
            (*p).set_exit_handler(ProcessExit::new(ProcessExitKind::ChromeProcess, self_ptr));
            (*p).disable_keeping_event_loop_alive();
        }
        INSTANCE.store(self_ptr, Ordering::Relaxed);
        GENERATION.store(generation, Ordering::Relaxed);
        Ok(0)
    }
}

#[cfg(windows)]
impl Drop for Endpoints {
    fn drop(&mut self) {
        self.close_child_ends();
        for pipe in [self.cmd, self.reply] {
            if !pipe.is_null() {
                // SAFETY: still ours; `attach` nulls the fields it takes over.
                unsafe { uv::Pipe::close_and_destroy(pipe) };
            }
        }
    }
}

#[cfg(windows)]
impl WindowsPipes {
    /// Idempotent; in-flight writes complete with UV_ECANCELED and free themselves.
    fn close(&mut self) {
        let reply = core::mem::replace(&mut self.reply, ptr::null_mut());
        if !reply.is_null() {
            // SAFETY: the live Box from `attach`; ownership ends here.
            unsafe {
                (*reply).read_stop();
                uv::Pipe::close_and_destroy(reply);
            }
        }
        let cmd = core::mem::replace(&mut self.cmd, ptr::null_mut());
        if !cmd.is_null() {
            // SAFETY: as above.
            unsafe { uv::Pipe::close_and_destroy(cmd) };
        }
    }
}

#[cfg(windows)]
impl uv::StreamReader for ChromeProcess {
    fn on_read_alloc(this: &mut Self, _suggested_size: usize) -> &mut [u8] {
        &mut this.pipes.read_buf
    }

    fn on_read_error(this: &mut Self, err: core::ffi::c_int) {
        scoped_log!(
            Chrome,
            "reply pipe closed: {:?}",
            bun_sys::windows::translate_uv_error_to_e(err)
        );
        PipeEvent::Closed.post(this.generation);
    }

    unsafe fn on_read(this: *mut Self, data: &[u8]) {
        scoped_log!(Chrome, "read {} bytes", data.len());
        // SAFETY: `this` is live for the duration of the callback.
        let generation = unsafe { (*this).generation };
        PipeEvent::Data(Box::from(data)).post(generation);
    }
}

/// What the reply pipe produced, handed to C++ from an event-loop task rather than from the libuv read callback.
#[cfg(windows)]
enum PipeEvent {
    Data(Box<[u8]>),
    Closed,
    Exited { signo: i32 },
}

#[cfg(windows)]
struct QueuedEvent {
    generation: u32,
    event: PipeEvent,
}

#[cfg(windows)]
impl PipeEvent {
    fn post(self, generation: u32) {
        let queued = bun_core::heap::into_raw(Box::new(QueuedEvent {
            generation,
            event: self,
        }));
        // Not dispatched from the read callback: C++ runs JS that may spin a nested event loop (bun:test does), and libuv re-arms the read only after the callback returns.
        VirtualMachine::get()
            .as_mut()
            .enqueue_task(bun_jsc::ManagedTask::ManagedTask::new_owned(
                queued,
                QueuedEvent::deliver,
            ));
    }
}

#[cfg(windows)]
impl QueuedEvent {
    fn deliver(this: *mut QueuedEvent) -> bun_jsc::JsResult<()> {
        // SAFETY: the box leaked by `post`; ManagedTask hands it over once.
        let queued = unsafe { bun_core::heap::take(this) };
        if queued.generation != GENERATION.load(Ordering::Relaxed) {
            scoped_log!(
                Chrome,
                "dropping event from replaced chrome (generation {})",
                queued.generation
            );
            return Ok(());
        }
        // SAFETY: plain FFI; onData copies `bytes` before returning.
        unsafe {
            match queued.event {
                PipeEvent::Data(bytes) => Bun__Chrome__onPipeData(bytes.as_ptr(), bytes.len()),
                PipeEvent::Closed => Bun__Chrome__onPipeClosed(),
                PipeEvent::Exited { signo } => Bun__Chrome__died(signo),
            }
        }
        Ok(())
    }
}

/// One in-flight `uv_write` and the copy of the chunk `buf` points into.
#[cfg(windows)]
struct WriteReq {
    req: uv::uv_write_t,
    buf: uv::uv_buf_t,
    bytes: Box<[u8]>,
    generation: u32,
}

#[cfg(windows)]
impl WriteReq {
    /// Safety: `pipe` is the live command pipe of the Chrome with `generation`.
    unsafe fn submit(pipe: *mut uv::Pipe, chunk: &[u8], generation: u32) -> bool {
        let mut req = Box::new(WriteReq {
            req: bun_core::ffi::zeroed::<uv::uv_write_t>(),
            buf: uv::uv_buf_t::init(b""), // re-init below, once `bytes` has stopped moving
            bytes: Box::from(chunk),
            generation,
        });
        req.buf = uv::uv_buf_t::init(&req.bytes);
        let req = bun_core::heap::into_raw(req);
        // SAFETY: caller contract; `req` stays put until `on_write` reclaims it.
        let rc = unsafe {
            (*req)
                .req
                .write((*pipe).as_stream(), &(*req).buf, req, WriteReq::on_write)
        };
        if let Some(err) = rc.to_error(bun_sys::Tag::write) {
            scoped_log!(Chrome, "uv_write failed: {}", err);
            // SAFETY: libuv did not take `req`, so the callback will not run.
            unsafe { bun_core::heap::destroy(req) };
            return false;
        }
        true
    }

    fn on_write(this: *mut WriteReq, status: uv::ReturnCode) {
        // SAFETY: the Box leaked by `submit`; libuv hands it back exactly once.
        let req = unsafe { bun_core::heap::take(this) };
        if let Some(err) = status.to_error(bun_sys::Tag::write) {
            scoped_log!(Chrome, "command pipe write failed: {}", err);
            // ECANCELED is `WindowsPipes::close` draining the queue; the death is already being reported.
            if status.int() != uv::UV_ECANCELED {
                PipeEvent::Closed.post(req.generation);
            }
        }
    }
}

/// Transport::writeRaw on Windows. A write that fails surfaces as a Closed event, like any other loss of the transport. Safety: `data` points to `len` readable bytes.
#[cfg(windows)]
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Chrome__writePipe(data: *const u8, len: usize) {
    let instance = INSTANCE.load(Ordering::Relaxed);
    if instance.is_null() {
        return; // Chrome already exited; the Exited event is on its way to C++
    }
    // SAFETY: INSTANCE is live until `on_exit` clears it; raw field reads, so
    // nothing aliases the `&mut` the read callbacks form.
    let (pipe, generation) = unsafe { ((*instance).pipes.cmd, (*instance).generation) };
    debug_assert!(
        !pipe.is_null(),
        "pipes are only closed after INSTANCE is cleared"
    );
    scoped_log!(Chrome, "write {} bytes", len);
    // SAFETY: caller contract.
    let bytes = unsafe { bun_core::ffi::slice(data, len) };
    for chunk in bytes.chunks(u32::MAX as usize) {
        // SAFETY: `pipe` belongs to the published instance read above.
        if !unsafe { WriteReq::submit(pipe, chunk, generation) } {
            PipeEvent::Closed.post(generation);
            return;
        }
    }
}

// Implemented in ChromeBackend.cpp.
#[cfg(windows)]
unsafe extern "C" {
    fn Bun__Chrome__onPipeData(data: *const u8, len: usize);
    fn Bun__Chrome__onPipeClosed();
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
    let root = getenv_z(zstr!("LOCALAPPDATA"))?;
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
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
    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "android",
        windows
    )))]
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
        let mut lines = strings::split(&contents, b"\n");
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
///
/// # Safety
/// `out_buf` must point to at least `out_cap` writable bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Chrome__autoDetect(out_buf: *mut u8, out_cap: usize) -> usize {
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

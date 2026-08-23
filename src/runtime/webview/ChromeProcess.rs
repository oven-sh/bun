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

use core::cell::Cell;
use core::ffi::CStr;
#[cfg(windows)]
use core::sync::atomic::{AtomicU32, Ordering};
use std::io::Write as _;

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_core::ZStr;
use bun_core::{self, ZBox, env_var, getenv_z, strings, zstr};
use bun_jsc::JSGlobalObject;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, path_buffer_pool, platform, resolve_path};
use bun_ptr::{OwnedThis, ThisPtr};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{self, EventLoopHandle, ProcessHandle, SpawnEnv, SpawnOptions, Status, Stdio};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd, FdExt as _};
use bun_which::which;

declare_scope!(Chrome, hidden);

/// The Chrome child. Owned by this thread's [`Hosts`](crate::webview::Hosts)
/// until its exit is reaped.
pub(crate) struct ChromeProcess {
    /// Our ref on the process; dropping this detaches and releases it.
    process: ProcessHandle,
    /// Set by [`chrome_retire`]: the exit is reaped but not reported to C++.
    retired: Cell<bool>,
    #[cfg(windows)]
    pipes: WindowsPipes,
    #[cfg(windows)]
    generation: u32,
}

/// Our ends of the two pipes (`None` once closed).
#[cfg(windows)]
struct WindowsPipes {
    /// Child reads the other end as fd 3.
    cmd: bun_jsc::JsCell<Option<uv::OwnedPipe>>,
    /// Child writes the other end as fd 4.
    reply: bun_jsc::JsCell<Option<uv::OwnedPipe>>,
}

/// Generation of the published Chrome; stamped on every [`PipeEvent`]. Main
/// (JS) thread only, like the registry.
#[cfg(windows)]
static GENERATION: AtomicU32 = AtomicU32::new(0);

/// Called from WebView.closeAll() and dispatchOnExit. Chrome spawns its own
/// renderer/gpu/utility children (the "process model" zygote tree) — tracked
/// by Chrome's own ProcessSingleton, they exit when the browser process
/// dies. SIGKILL here takes the browser process, the zygote tree follows.
/// The C++ side doesn't touch JS state; EVFILT_PROC → Bun__Chrome__died →
/// rejectAllAndMarkDead handles promise rejection on the next loop tick.
// HOST_EXPORT(Bun__Chrome__kill, c)
pub fn chrome_kill() {
    crate::jsc_hooks::with_webview_hosts(|hosts| {
        if let Some(chrome) = hosts.chrome.current() {
            let _ = chrome.process.kill(9);
        }
    });
}

/// Transport::retireGlobal (`bun test --isolate`): unpublish and kill this Chrome so the next file can spawn its own at once.
// HOST_EXPORT(Bun__Chrome__retire, c)
pub fn chrome_retire() {
    crate::jsc_hooks::with_webview_hosts(|hosts| {
        let Some(chrome) = hosts.chrome.retire() else {
            return;
        };
        chrome.retired.set(true);
        #[cfg(windows)]
        {
            // Queued events from this Chrome carry its generation; `QueuedEvent::deliver` drops them.
            GENERATION.fetch_add(1, Ordering::Relaxed);
            chrome.pipes.close();
        }
        let _ = chrome.process.kill(9);
    });
}

/// Returns the parent's socketpair fd (POSIX, owned by usockets from then on), 0 (Windows), or -1 on failure.
/// `extra_argv` is the extra switches back to back, each NUL-terminated.
// HOST_EXPORT(Bun__Chrome__ensure, c)
pub fn chrome_ensure(
    global: &JSGlobalObject,
    user_data_dir: Option<&CStr>,
    path: Option<&CStr>,
    extra_argv: &[u8],
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> i32 {
    let published = crate::jsc_hooks::with_webview_hosts(|hosts| hosts.chrome.is_published());
    if published != Some(false) {
        return -1; // C++ already holds the transport (or no runtime state)
    }

    let extra: Vec<&CStr> = extra_argv
        .split_inclusive(|&b| b == 0)
        .filter_map(|arg| CStr::from_bytes_with_nul(arg).ok())
        .collect();
    match spawn(
        global.bun_vm(),
        user_data_dir,
        path,
        &extra,
        stdout_inherit,
        stderr_inherit,
    ) {
        Ok(rc) => rc,
        Err(err) => {
            scoped_log!(Chrome, "spawn failed: {}", err.name());
            -1
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    ChromeProcess for ChromeProcess => |this| {
        on_process_exit(_process, status, _rusage) => ChromeProcess::on_exit(ThisPtr::new(this), &status),
    }
}

impl ChromeProcess {
    /// The exit handler: `this` is the Chrome the registry owns (installed
    /// with `set_exit_handler`), taken back and dropped here.
    fn on_exit(this: ThisPtr<ChromeProcess>, status: &Status) {
        scoped_log!(Chrome, "chrome exited: {}", status);
        // A retired Chrome was already unpublished by `chrome_retire`.
        let chrome =
            crate::jsc_hooks::with_webview_hosts(|hosts| hosts.chrome.take(this)).flatten();
        debug_assert!(chrome.is_some(), "chrome exit for an unknown chrome");
        let Some(chrome) = chrome else {
            return;
        };
        chrome.close_transport();
        let retired = chrome.retired.get();
        #[cfg(windows)]
        let generation = chrome.generation;
        // Releases our ref on the process.
        drop(chrome);
        if retired {
            return;
        }
        let signo: i32 = status.signal_code().map_or(0, |s| s as i32);
        #[cfg(windows)]
        PipeEvent::Exited { signo }.post(generation);
        #[cfg(not(windows))]
        Bun__Chrome__died(signo);
    }

    /// On POSIX C++ owns the socket.
    fn close_transport(&self) {
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
    vm: &VirtualMachine,
    user_data_dir: Option<&CStr>,
    explicit_path: Option<&CStr>,
    extra_argv: &[&CStr],
    stdout_inherit: bool,
    stderr_inherit: bool,
) -> crate::Result<i32> {
    let chrome = find_chrome(explicit_path).ok_or(crate::Error::ChromeNotFound)?;
    scoped_log!(
        Chrome,
        "using chrome: {}",
        bstr::BStr::new(chrome.as_bytes())
    );

    let event_loop = EventLoopHandle::init(vm.as_mut().event_loop().cast::<()>());
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
        let dir = resolve_path::join_string_buf_z::<platform::Auto>(&mut dir_buf[..], &dir_parts);
        bun_sys::mkdir(dir, 0o700)?;
        let mut v = Vec::with_capacity(16 + dir.len());
        v.extend_from_slice(b"--user-data-dir=");
        v.extend_from_slice(&dir[..]);
        ZBox::from_vec(v)
    };

    let mut argv: Vec<&CStr> = vec![
        chrome.as_zstr().as_cstr(),
        data_dir.as_zstr().as_cstr(),
        c"--remote-debugging-pipe",
        c"--headless",
        c"--no-first-run",
        c"--no-default-browser-check",
        c"--disable-gpu", // headless CI has no GPU context
        // Enterprise policy can force-install extensions (webRequest spam on
        // stderr). --disable-extensions is best-effort; mandatory extensions
        // may still load. --disable-background-networking shuts up GCM/update.
        c"--disable-extensions",
        c"--disable-background-networking",
        // Throttling suite (playwright's chromiumSwitches.ts subset). These
        // gate rAF/setTimeout firing when the tab thinks it's backgrounded.
        // A headless target is "occluded" by definition; without these Chrome
        // throttles timers to 1 Hz and pauses rAF entirely.
        c"--disable-background-timer-throttling",
        c"--disable-backgrounding-occluded-windows",
        c"--disable-renderer-backgrounding",
        // CDP message rate limiter — a burst of evaluates/clicks in a test
        // loop hits it otherwise. Playwright and puppeteer both ship this.
        c"--disable-ipc-flooding-protection",
        // No startup window — targets are Target.createTarget'd, not the
        // default about:blank. Saves one tab and the visual-complete wait.
        c"--no-startup-window",
    ];
    // User extras last so they can override built-in flags (Chrome's
    // CommandLine last-wins for duplicate switches). Memory is the caller's
    // buffer — lives until Bun__Chrome__ensure returns, after which
    // posix_spawn has copied argv into the child.
    argv.extend_from_slice(extra_argv);

    let env = vm
        .as_mut()
        .transpiler
        .env_mut()
        .map
        .create_null_delimited_env_map()?;
    let env: Vec<&CStr> = env.iter().collect();

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
        #[cfg(windows)]
        windows: bun_spawn::WindowsOptions {
            loop_: event_loop,
            ..Default::default()
        },
        ..SpawnOptions::default()
    };

    let spawned = bun_spawn::spawn_process_cstr(&opts, &argv, SpawnEnv::Strings(&env))??;
    #[cfg(windows)]
    let mut spawned = spawned;

    // Keeping our copies of the child's ends would mask Chrome's death (no EOF).
    endpoints.close_child_ends();

    let process = spawned.to_process_handle(event_loop);
    endpoints.attach(process)
}

// Implemented in ChromeBackend.cpp. Rejects all pending CDP promises.
unsafe extern "C" {
    safe fn Bun__Chrome__died(signo: i32);
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

    /// Publishes the Chrome and returns our fd for C++ to adopt.
    fn attach(mut self, process: ProcessHandle) -> crate::Result<i32> {
        let chrome = OwnedThis::new(ChromeProcess {
            process,
            retired: Cell::new(false),
        });
        chrome.process.set_exit_handler(chrome.this_ptr());
        if let Err(e) = chrome.process.watch() {
            scoped_log!(Chrome, "watch failed: {}", e);
            // Dropping `chrome` detaches and releases the process.
            self.close_all();
            return Err(crate::Error::WatchFailed);
        }
        // Same weak-handle reasoning as HostProcess: parent exit → Chrome's
        // fd 3 EOFs → DevToolsPipeHandler::Shutdown → exit. dispatchOnExit
        // also SIGKILLs via Bun__Chrome__kill.
        chrome.process.disable_keeping_event_loop_alive();
        crate::jsc_hooks::with_webview_hosts(|hosts| hosts.chrome.publish(chrome));

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
    /// Our ends; `None` once handed over.
    cmd: Option<uv::OwnedPipe>,
    reply: Option<uv::OwnedPipe>,
}

#[cfg(windows)]
impl Endpoints {
    fn create(_event_loop: EventLoopHandle) -> crate::Result<Endpoints> {
        // uv_pipe() returns [read end, write end]; UV_NONBLOCK_PIPE (overlapped) goes on our ends only.
        let cmd_fds = uv::pipe_pair(0, uv::UV_NONBLOCK_PIPE as i32)
            .map_err(|rc| pipe_error(rc, bun_sys::Tag::uv_pipe))?;
        let mut endpoints = Endpoints {
            cmd_child: Some(Fd::from_uv(cmd_fds[0])),
            reply_child: None,
            cmd: None,
            reply: None,
        };
        let cmd_parent = Fd::from_uv(cmd_fds[1]);
        match Self::wrap(cmd_parent) {
            Ok(pipe) => endpoints.cmd = Some(pipe),
            Err(err) => {
                cmd_parent.close();
                return Err(err);
            }
        }

        let reply_fds = uv::pipe_pair(uv::UV_NONBLOCK_PIPE as i32, 0)
            .map_err(|rc| pipe_error(rc, bun_sys::Tag::uv_pipe))?;
        endpoints.reply_child = Some(Fd::from_uv(reply_fds[1]));
        let reply_parent = Fd::from_uv(reply_fds[0]);
        match Self::wrap(reply_parent) {
            Ok(pipe) => endpoints.reply = Some(pipe),
            Err(err) => {
                reply_parent.close();
                return Err(err);
            }
        }
        Ok(endpoints)
    }

    /// On success libuv owns `fd`; on failure the caller still does.
    fn wrap(fd: Fd) -> crate::Result<uv::OwnedPipe> {
        let pipe =
            uv::OwnedPipe::init(false).map_err(|rc| pipe_error(rc, bun_sys::Tag::uv_pipe))?;
        pipe.open(fd.uv())
            .map_err(|rc| pipe_error(rc, bun_sys::Tag::open))?;
        // Pending commands keep the loop alive (Transport::updateKeepAlive), not
        // the pipes.
        pipe.unref();
        Ok(pipe)
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
        let generation = GENERATION.load(Ordering::Relaxed).wrapping_add(1);
        let chrome = OwnedThis::new(ChromeProcess {
            process,
            retired: Cell::new(false),
            pipes: WindowsPipes {
                cmd: bun_jsc::JsCell::new(self.cmd.take()),
                reply: bun_jsc::JsCell::new(self.reply.take()),
            },
            generation,
        });

        // Unlike POSIX the exit can't be delivered before we return (it comes
        // through this thread's loop), so the exit handler is installed after.
        let started = chrome
            .pipes
            .reply
            .get()
            .as_ref()
            .expect("just moved in")
            .read_start(
                READ_BUF_SIZE,
                Box::new(move |read| match read {
                    uv::PipeRead::Data(data) => {
                        scoped_log!(Chrome, "read {} bytes", data.len());
                        PipeEvent::Data(Box::from(data)).post(generation);
                    }
                    uv::PipeRead::Error(err) => {
                        scoped_log!(
                            Chrome,
                            "reply pipe closed: {:?}",
                            bun_sys::windows::translate_uv_error_to_e(err)
                        );
                        PipeEvent::Closed.post(generation);
                    }
                }),
            )
            .map_err(|rc| pipe_error(rc, bun_sys::Tag::listen))
            .and_then(|()| chrome.process.watch().map_err(Into::into));
        if let Err(err) = started {
            scoped_log!(Chrome, "read_start/watch failed: {}", err);
            chrome.pipes.close();
            let _ = chrome.process.kill(9);
            // Dropping `chrome` detaches (closing the handle) and releases the process.
            return Err(err);
        }

        chrome.process.set_exit_handler(chrome.this_ptr());
        chrome.process.disable_keeping_event_loop_alive();
        crate::jsc_hooks::with_webview_hosts(|hosts| hosts.chrome.publish(chrome));
        GENERATION.store(generation, Ordering::Relaxed);
        Ok(0)
    }
}

#[cfg(windows)]
impl Drop for Endpoints {
    fn drop(&mut self) {
        self.close_child_ends();
        // `cmd` / `reply` still ours (not taken by `attach`) close as they drop.
    }
}

#[cfg(windows)]
fn pipe_error(rc: uv::ReturnCode, tag: bun_sys::Tag) -> crate::Error {
    bun_sys::Error::from_uv_rc(rc, tag)
        .expect("an error return code")
        .into()
}

#[cfg(windows)]
impl WindowsPipes {
    /// Idempotent; in-flight writes complete with UV_ECANCELED and free themselves.
    fn close(&self) {
        if let Some(reply) = self.reply.replace(None) {
            reply.read_stop();
            drop(reply);
        }
        drop(self.cmd.replace(None));
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
        let queued = Box::new(QueuedEvent {
            generation,
            event: self,
        });
        // Not dispatched from the read callback: C++ runs JS that may spin a nested event loop (bun:test does), and libuv re-arms the read only after the callback returns.
        VirtualMachine::get()
            .as_mut()
            .enqueue_task(bun_jsc::ManagedTask::ManagedTask::new_boxed(
                queued,
                QueuedEvent::deliver,
            ));
    }
}

#[cfg(windows)]
impl QueuedEvent {
    fn deliver(queued: Box<QueuedEvent>) -> bun_jsc::JsResult<()> {
        if queued.generation != GENERATION.load(Ordering::Relaxed) {
            scoped_log!(
                Chrome,
                "dropping event from replaced chrome (generation {})",
                queued.generation
            );
            return Ok(());
        }
        match queued.event {
            PipeEvent::Data(bytes) => Bun__Chrome__onPipeData(bun_core::ffi::FfiSlice::new(&bytes)),
            PipeEvent::Closed => Bun__Chrome__onPipeClosed(),
            PipeEvent::Exited { signo } => Bun__Chrome__died(signo),
        }
        Ok(())
    }
}

/// Transport::writeRaw on Windows (POSIX writes through the usockets socket
/// C++ owns). A write that fails surfaces as a Closed event, like any other
/// loss of the transport.
// HOST_EXPORT(Bun__Chrome__writePipe, c)
pub fn chrome_write_pipe(data: &[u8]) {
    #[cfg(not(windows))]
    let _ = data;
    #[cfg(windows)]
    crate::jsc_hooks::with_webview_hosts(|hosts| {
        let Some(chrome) = hosts.chrome.current() else {
            return; // Chrome already exited; the Exited event is on its way to C++
        };
        let generation = chrome.generation;
        scoped_log!(Chrome, "write {} bytes", data.len());
        let cmd = chrome.pipes.cmd.get();
        let cmd = cmd
            .as_ref()
            .expect("pipes are only closed after the chrome is unpublished");
        for chunk in data.chunks(u32::MAX as usize) {
            let queued = cmd.write(
                Box::from(chunk),
                Box::new(move |status: uv::ReturnCode| {
                    if let Some(err) = status.to_error(bun_sys::Tag::write) {
                        scoped_log!(Chrome, "command pipe write failed: {}", err);
                        // ECANCELED is `WindowsPipes::close` draining the queue; the death is already being reported.
                        if status.int() != uv::UV_ECANCELED {
                            PipeEvent::Closed.post(generation);
                        }
                    }
                }),
            );
            if let Err(rc) = queued {
                scoped_log!(
                    Chrome,
                    "uv_write failed: {:?}",
                    rc.to_error(bun_sys::Tag::write)
                );
                PipeEvent::Closed.post(generation);
                return;
            }
        }
    });
}

// Implemented in ChromeBackend.cpp.
#[cfg(windows)]
unsafe extern "C" {
    // `onPipeData` copies the bytes before returning.
    safe fn Bun__Chrome__onPipeData(data: bun_core::ffi::FfiSlice<'_>);
    safe fn Bun__Chrome__onPipeClosed();
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
// HOST_EXPORT(Bun__Chrome__autoDetect, c)
pub fn chrome_auto_detect(out_buf: &mut [u8]) -> usize {
    let mut buf: Vec<u8> = Vec::new();
    if read_dev_tools_active_port(&mut buf).is_some() {
        if buf.len() > out_buf.len() {
            return 0;
        }
        out_buf[..buf.len()].copy_from_slice(&buf);
        return buf.len();
    }
    0
}

//! `Bun.open(target, options?)` — open a URL, file, or folder with the
//! platform's default handler.
//!
//! The implementation delegates to `Bun.spawn` with `stdio: [ignore, ignore,
//! ignore]` and `detached: true`, which is the same fire-and-forget posture
//! that the `open` npm package achieves by hand. Routing the launch through
//! `Bun.spawn` (rather than re-implementing process creation) keeps the call
//! non-blocking, lets the JS caller receive a `Promise`, and reuses the
//! libuv / posix_spawn / uv_spawn plumbing without duplicating it — including
//! the exited-promise machinery, PID reporting, and zombie reaping.
//!
//! The macOS, Linux/FreeBSD, and Windows arms below only differ in how the
//! target is wrapped in the platform opener's argv. See `docs/runtime/open.md`
//! (added in the same PR) for the full behavioral matrix. Android is
//! intentionally an `UnsupportedOs` error — Bun's Android target has no
//! desktop session to launch into; a follow-up JNI bridge to
//! `Intent.ACTION_VIEW` can revisit this.

// Per-OS `#[cfg]` arms make `target` and `opts` unused on the
// `cfg(not(any(...)))` fallback. Suppressing the lint at the module level
// is the smallest change; `#[allow]` on the function would re-introduce
// the same problem every time we add a new platform arm.
#![allow(unused_variables)]

use bun_core::Utf8Bytes;

/// Options accepted by `Bun.open`. Field semantics match the npm `open`
/// package where they overlap, and the macOS flags map directly to
/// `/usr/bin/open`'s native flags.
#[derive(Default, Clone)]
pub struct OpenOptions {
    /// Application to open with. On macOS this maps to `/usr/bin/open -a`.
    /// On Windows the shell dispatches it directly (`lpFile`); on Linux the
    /// named binary is executed with the target as its final argument (the
    /// platform's default opener is bypassed because a named app knows its
    /// own handlers).
    pub app: Option<Utf8Bytes<'static>>,

    /// Arguments passed to [`Self::app`] before the target. On macOS these
    /// ride behind `--args` (so `/usr/bin/open` forwards them verbatim);
    /// on Windows and Linux they precede the target on the app's own
    /// command line.
    pub app_arguments: Vec<String>,

    /// macOS: pass `-W` so `/usr/bin/open` blocks until the launched app
    /// exits. On Windows the native watcher gives `.exited` true process
    /// semantics regardless, so `wait` only controls when the outer promise
    /// settles there. Linux has no per-opener wait contract; ignored.
    pub wait: bool,

    /// macOS: `open -g`. No effect on Windows or Linux.
    pub background: bool,

    /// macOS: `open -n`. No effect on Windows or Linux.
    pub new_instance: bool,

    /// macOS: `open -e`. Windows: the shell verb becomes `edit` instead of
    /// `open`. No effect on Linux.
    pub edit: bool,
}

/// Errors that `Bun.open` can surface before a launch is attempted.
/// Launch-time failures come from the OS dispatch itself (`ShellExecuteExW`
/// error codes on Windows, spawn errors elsewhere) and are surfaced as their
/// standard system errors on the returned promise.
#[derive(Debug)]
pub enum OpenError {
    InvalidTarget(String),
    /// Linux/FreeBSD only: none of the known freedesktop openers is on PATH.
    OpenerMissing(Vec<&'static str>),
    UnsupportedOs(&'static str),
}

impl OpenError {
    /// Short machine code, suitable for the JS side to match on.
    pub fn code(&self) -> &'static str {
        match self {
            OpenError::InvalidTarget(_) => "ERR_INVALID_ARG_VALUE",
            OpenError::OpenerMissing(_) => "ENOENT",
            OpenError::UnsupportedOs(_) => "ERR_UNSUPPORTED_OP",
        }
    }
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::InvalidTarget(t) => write!(f, "Invalid target: {t:?}"),
            OpenError::OpenerMissing(candidates) => write!(
                f,
                "no desktop opener found; looked for {}",
                candidates.join(", ")
            ),
            OpenError::UnsupportedOs(o) => write!(f, "Bun.open is not supported on {o}"),
        }
    }
}

impl std::error::Error for OpenError {}

/// Shared pre-launch validation: non-empty, no NUL bytes. C-string targets
/// cannot carry NUL on either POSIX or Windows; refusing before any OS call
/// avoids silent truncation.
pub fn validate_target(target: &str) -> Result<(), OpenError> {
    if target.is_empty() {
        return Err(OpenError::InvalidTarget("<empty string>".into()));
    }
    if target.contains('\0') {
        return Err(OpenError::InvalidTarget("target contains a NUL byte".into()));
    }
    Ok(())
}

/// The freedesktop openers probed in order on Linux/FreeBSD. `gio` and
/// `kde-open` need their action word as the first argument; `xdg-open` and
/// `wslview` take the target directly.
pub const OPENER_CANDIDATES: &[&str] = &["xdg-open", "gio", "kde-open", "wslview"];

/// Build the argv for the given target on a POSIX platform. The first
/// element is the opener binary; subsequent elements are the flags the
/// platform opener expects before the target. `target` is always the final
/// element except under macOS `--args`, mirroring the npm `open` package's
/// documented ordering (`--args` hands every following argument to the app).
///
/// `opener_override` supplies the resolved default-opener binary name on
/// Linux/FreeBSD (from probing [`OPENER_CANDIDATES`]); it is ignored when an
/// explicit `app` is set.
#[cfg(not(windows))]
pub fn argv_for(
    target: &str,
    opts: &OpenOptions,
    opener_override: Option<&str>,
) -> Result<Vec<Vec<u8>>, OpenError> {
    validate_target(target)?;

    #[cfg(target_os = "macos")]
    {
        let mut argv: Vec<Vec<u8>> = Vec::with_capacity(8 + opts.app_arguments.len());
        argv.push(b"/usr/bin/open".to_vec());
        if opts.wait {
            argv.push(b"-W".to_vec());
        }
        if opts.background {
            argv.push(b"-g".to_vec());
        }
        if opts.new_instance {
            argv.push(b"-n".to_vec());
        }
        if let Some(app) = opts.app.as_ref() {
            argv.push(b"-a".to_vec());
            argv.push(app.slice().to_vec());
        }
        if opts.edit {
            argv.push(b"-e".to_vec());
        }
        argv.push(target.as_bytes().to_vec());
        // npm parity (#332): everything after `--args` reaches the app, so
        // user arguments must come after the target here.
        if !opts.app_arguments.is_empty() && opts.app.is_some() {
            argv.push(b"--args".to_vec());
            for arg in &opts.app_arguments {
                argv.push(arg.as_bytes().to_vec());
            }
        }
        return Ok(argv);
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        let mut argv: Vec<Vec<u8>> = Vec::with_capacity(4 + opts.app_arguments.len());
        match opts.app.as_ref() {
            Some(app) => {
                // A named app executes directly; the default opener is
                // bypassed because the app knows its own handlers.
                argv.push(app.slice().to_vec());
                if opener_override == Some("gio") {
                    argv.push(b"open".to_vec());
                }
            }
            None => {
                let opener = opener_override.ok_or_else(|| {
                    OpenError::OpenerMissing(OPENER_CANDIDATES.to_vec())
                })?;
                argv.push(opener.as_bytes().to_vec());
                if opener == "gio" {
                    argv.push(b"open".to_vec());
                }
            }
        }
        for arg in &opts.app_arguments {
            argv.push(arg.as_bytes().to_vec());
        }
        argv.push(target.as_bytes().to_vec());
        return Ok(argv);
    }

    #[cfg(target_os = "android")]
    {
        let _ = (opts, opener_override);
        Err(OpenError::UnsupportedOs("android"))
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "freebsd",
        target_os = "android"
    )))]
    {
        let _ = (opts, opener_override);
        Err(OpenError::UnsupportedOs("this platform"))
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Windows-native launch path (`ShellExecuteExW`)
//
// The POSIX arms above spawn an opener binary through `Bun.spawn`. On
// Windows that route would pay a cmd.exe hop whose lifetime masks the real
// handler, caps targets at cmd.exe's 8_191-character command line, and
// cannot suppress shell error dialogs. `ShellExecuteExW` with
// `SEE_MASK_NOCLOSEPROCESS` solves all three: it hands back the launched
// process handle (real PID, real exit code), takes the target directly with
// no intermediate re-tokenization, and honors `SEE_MASK_FLAG_NO_UI`.
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub mod native {
    use super::*;
    use bun_sys::windows as win32;

    /// A completed shell dispatch. `process` is the handle the shell handed
    /// back (`SEE_MASK_NOCLOSEPROCESS`); ownership transfers to the caller,
    /// which must `CloseHandle` it exactly once. It is null when the handler
    /// did not produce one (DDE singletons reuse a running process).
    pub struct ShellLaunch {
        pub pid: u32,
        pub process: win32::HANDLE,
    }

    impl Drop for ShellLaunch {
        fn drop(&mut self) {
            if !self.process.is_null() {
                // SAFETY: handle came from ShellExecuteExW with
                // SEE_MASK_NOCLOSEPROCESS; CloseHandle is valid exactly once.
                unsafe { win32::CloseHandle(self.process) };
            }
        }
    }

    impl ShellLaunch {
        /// Destructure without running [`Drop`], transferring handle
        /// ownership to the caller (`Bun.open`'s exit watcher).
        pub fn into_parts(self) -> (u32, win32::HANDLE) {
            let pid = self.pid;
            let process = self.process;
            core::mem::forget(self);
            (pid, process)
        }
    }

    thread_local! {
        static COM_INITIALISED: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
    }

    /// Enter the COM apartment ShellExecute requires, once per thread.
    ///
    /// The apartment reference is deliberately left balanced for the thread's
    /// lifetime (the standard pattern for a runtime's main thread): pairing
    /// `CoUninitialize` after each dispatch would tear down the apartment the
    /// next launch depends on. A changed-mode answer means another subsystem
    /// already initialised a different apartment model — proceed without
    /// ever touching its balance.
    fn com_enter() {
        if COM_INITIALISED.get() {
            return;
        }
        // SAFETY: null reserved is the documented form.
        let hr = unsafe {
            win32::CoInitializeEx(
                core::ptr::null_mut(),
                win32::COINIT_APARTMENTTHREADED | win32::COINIT_DISABLE_OLE1DDE,
            )
        };
        match hr {
            win32::S_OK | win32::S_FALSE => COM_INITIALISED.set(true),
            // RPC_E_CHANGED_MODE or a real failure: proceed either way —
            // ShellExecuteExW tolerates an existing foreign apartment.
            _ => {}
        }
    }

    /// Quote one argument per Windows command-line rules (MSVCRT parsing):
    /// bare when it contains no whitespace/quote, otherwise quoted with
    /// backslash-escaped quotes and escaped trailing backslashes.
    fn quote_windows_arg(arg: &str) -> String {
        if !arg.is_empty()
            && !arg.bytes().any(|b| matches!(b, b' ' | b'\t' | b'\n' | b'"'))
        {
            return arg.to_string();
        }
        let mut out = String::with_capacity(arg.len() + 8);
        out.push('"');
        let mut backslashes = 0usize;
        for ch in arg.chars() {
            match ch {
                '\\' => backslashes += 1,
                '"' => {
                    out.extend(core::iter::repeat_n('\\', backslashes * 2 + 1));
                    backslashes = 0;
                    out.push('"');
                }
                _ => {
                    out.extend(core::iter::repeat_n('\\', backslashes));
                    backslashes = 0;
                    out.push(ch);
                }
            }
        }
        // Backslashes preceding the closing quote escape double.
        out.extend(core::iter::repeat_n('\\', backslashes * 2));
        out.push('"');
        out
    }

    /// Map a failed `ShellExecuteExW` to [`OpenError`]. `ShellExecuteEx`
    /// reports through `GetLastError`; the classic `SE_ERR_*` values share
    /// those slots.
    fn map_shell_error(code: u32, target: &str) -> OpenError {
        let detail = match code {
            0 => "The operating system denied memory allocation",
            2 => "File not found",
            3 => "Path not found",
            5 => "Access denied",
            8 => "Not enough memory",
            26 => "A sharing violation occurred",
            27 => "The file association information is incomplete",
            28 => "The DDE transaction timed out",
            29 => "The DDE transaction failed",
            30 => "The operation was taken over by another DDE transaction",
            31 | 32 => "No application is associated with this target",
            _ => "The shell refused the launch",
        };
        OpenError::InvalidTarget(format!("{target:?}: {detail} (Win32 error {code})"))
    }

    /// Hand one target (or one app plus its arguments) to the shell.
    ///
    /// `app` replaces the association lookup entirely (`lpFile` becomes the
    /// app, everything else rides in `lpParameters`). `extra_arguments` are
    /// the caller-provided `arguments` array entries; the target always goes
    /// last, matching the npm `open` package's ordering.
    #[allow(clippy::too_many_arguments)]
    pub fn shell_execute_open(
        target: &str,
        app: Option<&str>,
        extra_arguments: &[String],
        verb: &str,
        hide_errors: bool,
    ) -> Result<ShellLaunch, OpenError> {
        if target.contains('\0') || app.is_some_and(|a| a.contains('\0')) {
            return Err(OpenError::InvalidTarget("target contains a NUL byte".into()));
        }
        // An existing directory as `app` causes `ShellExecuteExW` to hand off to
        // Explorer, whose DDE singleton handshake corrupted the COM state on this
        // build and produced a sync segfault. Reject any path that resolves to a
        // directory before the shell call so the promise rejects cleanly.
        if let Some(a) = app {
            let app_wide: Vec<u16> = a.encode_utf16().chain(core::iter::once(0)).collect();
            let attrs = unsafe { bun_sys::c::GetFileAttributesW(app_wide.as_ptr()) };
            if attrs != 0xFFFF_FFFF
                && attrs & win32::FILE_ATTRIBUTE_DIRECTORY != 0
            {
                return Err(OpenError::InvalidTarget(
                    format!("options.app is a directory: {a}"),
                ));
            }
        }

        let wide = |s: &str| -> Vec<u16> {
            s.encode_utf16().chain(core::iter::once(0)).collect()
        };
        let verb_wide = wide(verb);
        let target_wide = wide(target);

        let (file_wide, params_wide): (Vec<u16>, Option<Vec<u16>>) = match app {
            Some(app) => {
                let mut parts: Vec<String> =
                    extra_arguments.iter().map(|a| quote_windows_arg(a)).collect();
                parts.push(quote_windows_arg(target));
                (wide(app), Some(wide(&parts.join(" "))))
            }
            None => (target_wide, None),
        };

        let mut info: win32::SHELLEXECUTEINFOW = unsafe { core::mem::zeroed() };
        info.cbSize = core::mem::size_of::<win32::SHELLEXECUTEINFOW>() as win32::DWORD;
        info.fMask = win32::SEE_MASK_NOCLOSEPROCESS
            | if hide_errors {
                win32::SEE_MASK_FLAG_NO_UI
            } else {
                0
            };
        info.lpVerb = verb_wide.as_ptr();
        info.lpFile = file_wide.as_ptr();
        if let Some(params) = &params_wide {
            info.lpParameters = params.as_ptr();
        }
        info.nShow = win32::SW_SHOWNORMAL;

        // ShellExecute paths perform COM-mediated handshakes; enter the
        // apartment for the lifetime of the thread (see com_enter).
        com_enter();
        // SAFETY: every pointer field points at live storage owned by this
        // frame; the struct outlives the call.
        let ok = unsafe { win32::ShellExecuteExW(&raw mut info) };
        if ok == 0 {
            // SAFETY: no precondition beyond the current thread.
            let err = win32::GetLastError();
            return Err(map_shell_error(err, target));
        }

        let process = info.hProcess;
        let pid = if process.is_null() {
            0
        } else {
            // SAFETY: handle satisfies PROCESS_QUERY_LIMITED_INFORMATION by
            // construction of SEE_MASK_NOCLOSEPROCESS.
            unsafe { win32::GetProcessId(process) }
        };
        Ok(ShellLaunch { pid, process })
    }
}

/// Exit-watcher for the native launch: a libuv timer on the VM's loop polls
/// the shell-returned process handle and settles the JS promises on the JS
/// thread when the handler exits.
///
/// The timer is unref'd so a long-lived browser never pins the runtime's
/// exit; if the runtime tears down first, OS cleanup closes the handle.
#[cfg(windows)]
pub(crate) mod watch {
    use super::native::ShellLaunch;
    use bun_jsc::{JSGlobalObject, JSPromiseStrong, JSValue, StringJsc as _};
    use bun_ptr::BackRef;
    use bun_sys::windows as win32;
    use bun_sys::windows::libuv;
    use bun_sys::windows::libuv::UvHandle as _;

    const POLL_INTERVAL_MS: u64 = 50;

    /// GC-rooted state for one in-flight native open. Lives until the timer
    /// close callback runs; the strong slots keep both promises alive across
    /// ticks regardless of whether user code still references them.
    pub(crate) struct Watch {
        /// Resolves with the launched handler's exit code (low byte, matching
        /// `Subprocess.exited`).
        exited: JSPromiseStrong,
        /// Present only under `wait: true`: resolves with the full result
        /// object after the handler exits.
        outer: Option<JSPromiseStrong>,
        pid: u32,
        process: win32::HANDLE,
        /// Self-pointer written right after allocation (see [`arm`]); the
        /// timer's `data` slot carries it back into every tick.
        timer: core::ptr::NonNull<libuv::Timer>,
        global: BackRef<JSGlobalObject>,
        /// Ticks elapsed since arm; drives the best-effort downgrade.
        tick: core::cell::Cell<u32>,
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            if !self.process.is_null() {
                // SAFETY: exactly-once close of the SEE_MASK_NOCLOSEPROCESS
                // handle; ShellLaunch ownership moved here at arm time.
                unsafe { win32::CloseHandle(self.process) };
            }
        }
    }

    /// After this many ticks without exit, downgrade to best-effort: stop
    /// polling, unref the handle, and leave `.exited` pending. Bounds both
    /// the shutdown-interaction window and long-lived-browser bookkeeping.
    const MAX_TICKS: u32 = 200; // 50ms x 200 = 10s

    extern "C" fn on_timer(timer_: *mut libuv::Timer) {

        // SAFETY: `data` was set to the boxed `Watch` before `start`, and the
        // box stays alive until `on_close` frees it (after this handle closes).
        let watch = unsafe { (*timer_).data.cast::<Watch>().as_mut() };
        let watch = watch.expect("Bun.open watcher fired after its state was freed");

        // SAFETY: safe re-decl of a by-value HANDLE + DWORD call; a bad
        // handle yields WAIT_FAILED rather than UB (mirrors the
        // `bun_sys::windows` safe-wrapper rationale).
        let status = unsafe { win32::WaitForSingleObject(watch.process, 0) };
        watch.tick.set(watch.tick.get() + 1);
        if watch.tick.get() >= MAX_TICKS {
            // Abandon: stop polling and release the loop pin. The strong
            // roots must survive a possible later settle, so leak the box
            // exactly like on_close does.
            let t = unsafe { &mut *timer_ };
            t.stop();
            t.unref();
            t.data = core::ptr::null_mut();
            t.close(on_close);
            return;
        }
        match status {
            win32::WAIT_OBJECT_0 => settle(watch, timer_, None),
            win32::WAIT_FAILED => {
                let global = watch.global.get();
                let last_error = win32::GetLastError();
                let message = format_args!(
                    "Bun.open lost track of the launched process (WaitForSingleObject failed, Win32 error {})",
                    last_error
                );
                let err = bun_core::String::create_format(message).to_error_instance(global);
                settle(watch, timer_, Some(err));
            }
            _ => {}
        }
    }

    fn settle(watch: &mut Watch, timer_: *mut libuv::Timer, error: Option<JSValue>) {
        let w = watch;
        // SAFETY: see on_timer; single-threaded JS loop owns both.
        {
            let t = unsafe { &mut *timer_ };
            t.stop();
            t.unref();
        }

        let global = w.global.get();
        // Promise resolution must run inside the VM's event-loop scope, the
        // same guard the subprocess exit path takes before touching JSC.
        // SAFETY: the loop pointer belongs to the live VM for this thread.
        let _scope = unsafe {
            bun_jsc::event_loop::EventLoop::enter_scope(
                global.bun_vm().as_mut().event_loop(),
            )
        };

        let mut code: win32::DWORD = 0;
        let exit_value = if error.is_some() {
            None
        } else {
            // SAFETY: live process handle owned by this Watch.
            let read = unsafe { win32::GetExitCodeProcess(w.process, &raw mut code) };
            if read == 0 {
                None
            } else {
                // Low byte matches `Subprocess.exited`; the raw DWORD keeps
                // NTSTATUS crash codes distinguishable via the full value we
                // deliberately do not surface (same convention as spawn).
                Some(JSValue::js_number((code & 0xFF) as f64))
            }
        };

        match (error, exit_value) {
            (_, Some(code_val)) => {
                // Read the promise's JSValue BEFORE resolve consumes the
                // strong slot; the result object needs the same promise.
                if let Some(mut outer) = w.outer.take() {
                    let exited_value = w.exited.value();
                    let result = JSValue::create_empty_object(global, 2);
                    result.put(global, b"pid", JSValue::js_number(f64::from(w.pid)));
                    result.put(global, b"exited", exited_value);
                    let _ = w.exited.resolve(global, code_val);
                    let _ = outer.resolve(global, result);
                } else {
                    let _ = w.exited.resolve(global, code_val);
                }
            }
            (Some(err), None) => {
                let exited_value = w.exited.value();
                let mut outer = w.outer.take();
                let _ = w.exited.reject_with_async_stack(global, Ok(err.clone()));
                if let Some(outer) = outer.as_mut() {
                    let _ = outer.reject_with_async_stack(global, Ok(err));
                }
            }
            (None, None) => {
                // GetExitCodeProcess failed without a wait failure:
                // surface a generic Error rather than a bogus code.
                let err = bun_core::String::from_bytes(
                    b"Bun.open could not read the launched process's exit code",
                )
                .to_error_instance(global);
                let _ = w.exited.reject_with_async_stack(global, Ok(err));
            }
        }

        // Free the timer allocation and then the Watch itself once the handle
        // close completes (libuv calls back on a later tick).
        // SAFETY: `timer` was heap-allocated via `heap::into_raw_nn` in arm.
        let t = unsafe { &mut *timer_ };
        t.data = core::ptr::null_mut();
        t.close(on_close);
    }

    extern "C" fn on_close(timer_: *mut libuv::Timer) {
        // SAFETY: allocated via heap::into_raw_nn in arm; libuv guarantees
        // exactly one close callback per handle.
        let data = unsafe { (*timer_).data } as *mut Watch;
        drop(unsafe { bun_core::heap::take(timer_) });
        if data.is_null() {
            return;
        }
        // Close the process handle (OS resource) but deliberately leak the
        // boxed `Watch`: its JSC strong roots must not be released after the
        // VM has torn down (process-exit ordering makes that a use-after-free),
        // and unresolved watchers at exit are bounded by the number of opens.
        let watch = unsafe { &mut *data };
        if !watch.process.is_null() {
            // SAFETY: exactly-once close; the watcher still owns the handle.
            unsafe { win32::CloseHandle(watch.process) };
            watch.process = core::ptr::null_mut();
        }
        core::mem::forget(unsafe { Box::from_raw(data) });
    }

    /// Arm the poller for one native launch. Returns nothing; the caller has
    /// already handed `exited.to_js()` / the pending outer promise to JS.
    ///
    /// `outer` is `Some` under `wait: true`; the caller must NOT have
    /// resolved either promise yet.
    pub(crate) fn arm(
        global: &JSGlobalObject,
        launch: ShellLaunch,
        outer: Option<JSPromiseStrong>,
        exited: JSPromiseStrong,
    ) {
        let uv_loop = global.bun_vm().as_mut().uv_loop();


        // Consume the launch without its Drop: handle ownership moves to the
        // Watch (released after the exit settles).
        let (pid, process) = launch.into_parts();

        let timer_ptr = bun_core::heap::into_raw_nn(Box::new(bun_core::ffi::zeroed()));

        let mut watch = Box::new(Watch {
            exited,
            outer,
            pid,
            process,
            timer: timer_ptr,
            global: BackRef::new(global),
            tick: core::cell::Cell::new(0),
        });
        // Fix the self-reference now that the box address is stable; the
        // timer reads `data` back into every tick.
        watch.timer = timer_ptr;
        let watch_ptr = Box::into_raw(watch);

        // SAFETY: freshly-zeroed handle, initialised against the VM's
        // process-lifetime loop (see `VirtualMachine::uv_loop` doc).
        let timer = unsafe { &mut *timer_ptr.as_ptr() };
        timer.init(uv_loop);

        timer.data = watch_ptr.cast();
        timer.start(POLL_INTERVAL_MS, POLL_INTERVAL_MS, Some(on_timer));
        // The poller stays ref'd: it must wake an otherwise-idle loop to
        // deliver `.exited`. This pins the runtime until the launched handler
        // exits (mirroring how Bun.spawn tracks children); callers that need
        // to exit immediately can call process.exit() themselves.
        timer.ref_();
    }
}

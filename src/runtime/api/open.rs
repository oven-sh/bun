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
    /// On Windows and Linux the named binary is executed directly with the
    /// target as its only argument (the platform's default opener is
    /// bypassed because the named app knows its own handlers).
    pub app: Option<Utf8Bytes<'static>>,

    /// macOS: `open -g`. No effect on Windows or Linux.
    pub background: bool,

    /// macOS: `open -n`. No effect on Windows or Linux.
    pub new_instance: bool,

    /// macOS: `open -e`. No effect on Windows or Linux.
    pub edit: bool,
}

/// Errors that `Bun.open` can surface before a spawn is attempted.
/// Spawn-time failures (`ENOENT` for a missing opener binary, permission
/// errors, command-line length limits) come from `Bun.spawn` itself and are
/// surfaced as its standard system errors on the returned promise.
#[derive(Debug)]
pub enum OpenError {
    InvalidTarget(String),
    UnsupportedOs(&'static str),
}

impl OpenError {
    /// Short machine code, suitable for the JS side to match on
    /// (`err.code === "ERR_INVALID_ARG_VALUE"`).
    pub fn code(&self) -> &'static str {
        match self {
            OpenError::InvalidTarget(_) => "ERR_INVALID_ARG_VALUE",
            OpenError::UnsupportedOs(_) => "ERR_UNSUPPORTED_OP",
        }
    }
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::InvalidTarget(t) => write!(f, "Invalid target: {t:?}"),
            OpenError::UnsupportedOs(o) => write!(f, "Bun.open is not supported on {o}"),
        }
    }
}

impl std::error::Error for OpenError {}

/// Build the argv to spawn for the given target. The first element is the
/// opener binary; subsequent elements are the flags the platform opener
/// expects before the target. `target` is always the final element, matching
/// the npm `open` package's documented order.
pub fn build_argv(target: &str, opts: &OpenOptions) -> Result<Vec<Vec<u8>>, OpenError> {
    if target.is_empty() {
        return Err(OpenError::InvalidTarget("<empty string>".into()));
    }
    if target.contains('\0') {
        // C strings cannot contain NUL on either POSIX or Windows; refuse
        // before we hand the value to the OS to avoid truncation.
        return Err(OpenError::InvalidTarget("target contains a NUL byte".into()));
    }

    #[cfg(target_os = "macos")]
    {
        let mut argv: Vec<Vec<u8>> = Vec::with_capacity(8);
        argv.push(b"/usr/bin/open".to_vec());
        if opts.background {
            argv.push(b"--background".to_vec());
        }
        if opts.new_instance {
            argv.push(b"--new".to_vec());
        }
        if let Some(app) = opts.app.as_ref() {
            argv.push(b"-a".to_vec());
            argv.push(app.slice().to_vec());
        }
        if opts.edit {
            argv.push(b"-e".to_vec());
        }
        argv.push(target.as_bytes().to_vec());
        return Ok(argv);
    }

    #[cfg(windows)]
    {
        if let Some(app) = opts.app.as_ref() {
            // npm `open` parity: a named app bypasses `cmd /c start` and is
            // executed directly with the target as its only argument.
            let mut argv: Vec<Vec<u8>> = Vec::with_capacity(2);
            argv.push(app.slice().to_vec());
            argv.push(target.as_bytes().to_vec());
            return Ok(argv);
        }
        // `cmd /c start "" "<target>"` — the empty `""` is the window title
        // placeholder that `start` requires when its first quoted arg is
        // not a verb. Without it, `start "C:\path with spaces.txt"` parses
        // the path as the title and errors out.
        let mut argv: Vec<Vec<u8>> = Vec::with_capacity(5);
        argv.push(b"cmd".to_vec());
        argv.push(b"/c".to_vec());
        argv.push(b"start".to_vec());
        argv.push(b"".to_vec());
        argv.push(target.as_bytes().to_vec());
        Ok(argv)
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        if let Some(app) = opts.app.as_ref() {
            // The user picked a binary; we execute it directly. `xdg-open`
            // is bypassed because the binary knows its own protocol/file
            // handlers.
            let mut argv: Vec<Vec<u8>> = Vec::with_capacity(2);
            argv.push(app.slice().to_vec());
            argv.push(target.as_bytes().to_vec());
            return Ok(argv);
        }
        let mut argv: Vec<Vec<u8>> = Vec::with_capacity(2);
        argv.push(b"xdg-open".to_vec());
        argv.push(target.as_bytes().to_vec());
        Ok(argv)
    }

    #[cfg(target_os = "android")]
    {
        let _ = opts;
        Err(OpenError::UnsupportedOs("android"))
    }

    #[cfg(not(any(
        target_os = "macos",
        windows,
        target_os = "linux",
        target_os = "freebsd",
        target_os = "android"
    )))]
    {
        let _ = (target, opts);
        Err(OpenError::UnsupportedOs("this platform"))
    }
}

/// Public entry point used by `Bun.open`'s host function. Returns the
/// prepared argv so the host function can hand it to `js_bun_spawn_bindings`.
pub fn argv_for(target: &str, opts: &OpenOptions) -> Result<Vec<Vec<u8>>, OpenError> {
    build_argv(target, opts)
}

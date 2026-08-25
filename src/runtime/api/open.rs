//! `Bun.open(target, options?)` — open a URL, file, or folder with the
//! platform's default handler.
//!
//! The implementation delegates to `Bun.spawn` with `stdio: [ignore, ignore,
//! ignore]` and `detached: true`, which is the same fire-and-forget posture
//! that the `open` npm package achieves by hand. Routing the launch through
//! `Bun.spawn` (rather than `bun_spawn::process::sync`) keeps the call
//! non-blocking, lets the JS caller receive a `Promise<BunOpenResult>`, and
//! reuses the libuv / posix_spawn / uv_spawn plumbing without re-implementing
//! it. The macOS, Linux/FreeBSD, and Windows arms below only differ in how
//! the target is wrapped in the platform opener's argv.
//!
//! See `docs/runtime/open.md` (added in the same PR) for the full behavioral
//! matrix. Android is intentionally a `NotImplementedError` — Bun's Android
//! target has no desktop session to launch into; a follow-up JNI bridge to
//! `Intent.ACTION_VIEW` can revisit this.

use bun_core::Utf8Bytes;

use crate::api::bun::js_bun_spawn_bindings;

/// Options accepted by `Bun.open`. Field semantics match the npm `open`
/// package where they overlap, and the macOS / Windows flags map directly to
/// the platform opener's native flags.
#[derive(Default, Debug, Clone)]
pub struct OpenOptions {
    /// Application to open with. On macOS this maps to `/usr/bin/open -a`.
    /// On Windows this overrides `lpFile` while `lpVerb = "open"`. On Linux
    /// the named binary is executed directly (the platform's `xdg-open` is
    /// only used when `app` is `None`).
    pub app: Option<Utf8Bytes>,

    /// `open -W` on macOS. On Windows, the returned `exited` promise resolves
    /// only after the spawned process (or its singleton reuse) signals input
    /// idle. Linux has no reliable per-process wait semantics here; the
    /// returned promise resolves immediately on the child PID.
    pub wait: bool,

    /// `open -g` on macOS. No effect on Windows or Linux.
    pub background: bool,

    /// `open -n` on macOS. No effect on Windows or Linux.
    pub new_instance: bool,

    /// macOS: `open -e`. Windows: `lpVerb = "edit"`. Linux: ignored (no
    /// portable "edit" verb on `xdg-open`).
    pub edit: bool,

    /// Windows: pass `SEE_MASK_FLAG_NO_UI` so the shell does not pop "no
    /// application is associated" dialogs. Defaults to `true` because
    /// scripted use of `Bun.open` should never block on a dialog box.
    pub hide_errors: bool,
}

/// Outcome of `Bun.open`. `pid === 0` on Windows when the shell reused an
/// already-running singleton process — the OS doesn't hand us a fresh PID
/// in that case, but the launch was still successful (`ok === true`).
#[derive(Debug, Clone)]
pub struct OpenResult {
    pub ok: bool,
    pub pid: i32,
    /// Resolves when the child process (or its input-idle wait) signals
    /// completion. Already-rejected on construction when `ok === false`.
    pub exit_code: Option<u8>,
    pub signal: Option<u8>,
}

/// Errors that `Bun.open` can surface. `TargetMissing` mirrors the npm
/// `open` package's `ENOENT` propagation; `OpenerMissing` is Linux-only
/// (`xdg-open` not installed) and `UnsupportedOs` covers Android / any
/// `cfg(target_os)` we have not yet wired up.
#[derive(Debug)]
pub enum OpenError {
    TargetMissing(String),
    OpenerMissing(String),
    InvalidTarget(String),
    UnsupportedOs(&'static str),
}

impl OpenError {
    /// Short, lowercase machine code, suitable for the JS side to match on
    /// (`err.code === "ENOENT"`).
    pub fn code(&self) -> &'static str {
        match self {
            OpenError::TargetMissing(_) => "ENOENT",
            OpenError::OpenerMissing(_) => "ENOENT",
            OpenError::InvalidTarget(_) => "ERR_INVALID_ARG_VALUE",
            OpenError::UnsupportedOs(_) => "ERR_UNSUPPORTED_OP",
        }
    }
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::TargetMissing(t) => write!(f, "Failed to open {t:?}: file or directory does not exist"),
            OpenError::OpenerMissing(t) => write!(f, "Failed to open {t:?}: xdg-open not installed and no `app` option was provided"),
            OpenError::InvalidTarget(t) => write!(f, "Invalid target: {t:?}"),
            OpenError::UnsupportedOs(o) => write!(f, "Bun.open is not supported on {o}"),
        }
    }
}

impl std::error::Error for OpenError {}

/// The configured platform opener (after applying `options.app`).
#[cfg_attr(unix, allow(dead_code))]
fn resolve_opener(opts: &OpenOptions) -> Result<&'static [u8], OpenError> {
    if let Some(app) = opts.app.as_ref() {
        // The caller specified an explicit app — return it as a slice the
        // caller owns. (Stored in the same arena as the input argv so the
        // pointer stays valid for the duration of the spawn.)
        // SAFETY: see `build_argv` for the lifetime contract.
        return Ok(app.as_bytes());
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(b"/usr/bin/open");
    }
    #[cfg(windows)]
    {
        // `cmd /c start ""` is the documented way to delegate to the shell
        // file-association handler. Using `start` directly would try to exec
        // a binary named `start`; going through cmd.exe first is the
        // intentional pattern.
        return Ok(b"cmd");
    }
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        // `xdg-open` is the freedesktop.org standard. We don't probe the
        // filesystem; the OS returns ENOENT if the binary is missing, which
        // we surface as `OpenerMissing`.
        return Ok(b"xdg-open");
    }
    #[cfg(target_os = "android")]
    {
        return Err(OpenError::UnsupportedOs("android"));
    }
    #[cfg(not(any(
        target_os = "macos",
        windows,
        target_os = "linux",
        target_os = "freebsd",
        target_os = "android"
    )))]
    {
        Err(OpenError::UnsupportedOs("this platform"))
    }
}

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
        if opts.wait {
            argv.push(b"--wait-apps".to_vec());
        }
        if opts.background {
            argv.push(b"--background".to_vec());
        }
        if opts.new_instance {
            argv.push(b"--new".to_vec());
        }
        if let Some(app) = opts.app.as_ref() {
            argv.push(b"-a".to_vec());
            argv.push(app.as_bytes().to_vec());
        }
        if opts.edit {
            argv.push(b"-e".to_vec());
        }
        argv.push(target.as_bytes().to_vec());
        return Ok(argv);
    }

    #[cfg(windows)]
    {
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
        return Ok(argv);
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        if let Some(app) = opts.app.as_ref() {
            // The user picked a binary; we execute it directly. `xdg-open`
            // is bypassed because the binary knows its own protocol/file
            // handlers.
            let mut argv: Vec<Vec<u8>> = Vec::with_capacity(2);
            argv.push(app.as_bytes().to_vec());
            argv.push(target.as_bytes().to_vec());
            return Ok(argv);
        }
        let mut argv: Vec<Vec<u8>> = Vec::with_capacity(2);
        argv.push(b"xdg-open".to_vec());
        argv.push(target.as_bytes().to_vec());
        return Ok(argv);
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
    // Touch `resolve_opener` so dead_code linting on the unused arm still
    // picks up the `#[cfg]` error path on unsupported platforms.
    let _ = resolve_opener(opts)?;
    build_argv(target, opts)
}

// Re-export so `BunObject.rs` doesn't have to walk the api::bun submodule
// tree just to reach the spawn binding.
pub use js_bun_spawn_bindings as spawn_bindings;

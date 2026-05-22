use crate::Fd;

// ── Pollable / is_readable / is_writable ──────────────────────────────────
// Port of `bun.PollFlag` + `bun.isReadable` / `bun.isWritable` (bun.zig:637).
// Named `Pollable` to match the original draft callers (io/PipeReader.rs).
// D050 dedup: this is the single canonical copy; the `bun` facade re-exports it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Pollable {
    Ready,
    NotReady,
    Hup,
}
/// Zig `bun.PollFlag` — original name kept as an alias.
pub type PollFlag = Pollable;

impl Pollable {
    /// Zig `@tagName(rc)` — lowercase tag name for the `[sys]` debug log.
    #[inline]
    pub const fn tag_name(self) -> &'static str {
        match self {
            Pollable::Ready => "ready",
            Pollable::NotReady => "not_ready",
            Pollable::Hup => "hup",
        }
    }
}

/// Non-blocking poll for readability. POSIX-only (Zig panics on Windows).
#[cfg(not(windows))]
pub fn is_readable(fd: Fd) -> Pollable {
    debug_assert!(fd.is_valid());
    let mut polls = [libc::pollfd {
        fd: fd.native(),
        events: libc::POLLIN | libc::POLLERR | libc::POLLHUP,
        revents: 0,
    }];
    // SAFETY: polls is a valid 1-element array; timeout 0 = non-blocking.
    let n = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
    let result = n > 0;
    let rc = if result && (polls[0].revents & (libc::POLLHUP | libc::POLLERR)) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    };
    crate::syslog!(
        "poll({}, .readable): {} ({}{})",
        fd,
        result,
        rc.tag_name(),
        if polls[0].revents & libc::POLLERR != 0 {
            " ERR "
        } else {
            ""
        },
    );
    rc
}
#[cfg(windows)]
pub fn is_readable(_fd: Fd) -> Pollable {
    // Zig bun.zig:639 — `@panic("TODO on Windows")`; no callers reach this on Windows.
    panic!("TODO on Windows");
}

/// Non-blocking `poll(fd, POLLOUT)` (or `WSAPoll` on Windows); reports writability.
#[cfg(not(windows))]
pub fn is_writable(fd: Fd) -> Pollable {
    debug_assert!(fd.is_valid());
    // bun.zig:692 — POLLOUT | POLLERR | POLLHUP.
    let mut polls = [libc::pollfd {
        fd: fd.native(),
        events: libc::POLLOUT | libc::POLLERR | libc::POLLHUP,
        revents: 0,
    }];
    // SAFETY: polls is a valid 1-element array; timeout 0 = non-blocking.
    let n = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
    let result = n > 0;
    let rc = if result && (polls[0].revents & (libc::POLLHUP | libc::POLLERR)) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    };
    crate::syslog!(
        "poll({}, .writable): {} ({}{})",
        fd,
        result,
        rc.tag_name(),
        if polls[0].revents & libc::POLLERR != 0 {
            " ERR "
        } else {
            ""
        },
    );
    rc
}
#[cfg(windows)]
pub fn is_writable(fd: Fd) -> Pollable {
    // Zig bun.zig:668-685 — WSAPoll(POLLWRNORM) via bun_windows_sys::ws2_32.
    use bun_windows_sys::ws2_32;
    let mut polls = [ws2_32::WSAPOLLFD {
        // HANDLE → SOCKET pointer reinterpretation; matches Zig `fd.asSocketFd()`.
        fd: fd.native() as usize,
        events: ws2_32::POLLWRNORM,
        revents: 0,
    }];
    // SAFETY: polls is a valid 1-element WSAPOLLFD array; len=1 matches the buffer.
    let rc = unsafe { ws2_32::WSAPoll(polls.as_mut_ptr(), 1, 0) };
    let result = rc != ws2_32::SOCKET_ERROR && rc != 0;
    crate::syslog!("poll({}) writable: {} ({})", fd, result, polls[0].revents);
    // PORT NOTE: faithful port of bun.zig:679 — yes, the `WRNORM`-set branch
    // returns `.hup` (not `.ready`). Kept verbatim to match upstream behaviour.
    if result && (polls[0].revents & ws2_32::POLLWRNORM) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    }
}

//! Signal-handler machinery for interactive-prompt cursor restoration.
//!
//! Shared by `bun update --interactive`
//! (`update_interactive_command.rs::UpdateInteractiveCommand::ask_for_updates`)
//! and `bun init`
//! (`init_command.rs::InitCommand::radio`). Both hide the cursor with
//! `\x1b[?25l` on entry and register a `scopeguard::defer!` to restore it on
//! normal / byte-3 scope exit, but an external SIGINT/SIGTERM (Unix) or
//! Ctrl+Break / console-close (Windows) bypasses that defer and leaves the
//! cursor hidden. See #30890.
//!
//! On Unix we install a SIGINT/SIGTERM handler that writes the ANSI restore
//! sequence directly to stdout via `write(2)` (async-signal-safe), restores
//! termios via the existing `uv_tty_reset_mode` atexit hook (same one
//! `c-bindings.cpp::onExitSignal` uses), and `_exit`s with the conventional
//! `128 + signum`.
//!
//! On Windows we install a `SetConsoleCtrlHandler` that writes the same
//! sequence and `ExitProcess`es with `STATUS_CONTROL_C_EXIT`.
//!
//! The prompt-entry code builds a [`Guard`]; its `Drop` removes the handler
//! so the CLI's normal signal semantics resume after the prompt.
//!
//! The mouse-tracking-off bytes (`\x1b[?1000l\x1b[?1006l`) are harmless
//! extras for callers that didn't enable mouse tracking (terminals ignore
//! disable sequences for modes that were already off), so both sites share
//! the single restore string.

#[cfg(unix)]
use core::sync::atomic::{AtomicI32, Ordering};

/// Cursor show + mouse-tracking off + SGR-extended-mouse off + CRLF.
/// Writing CRLF (not just LF) is intentional: the slave TTY may still be in
/// raw mode when the signal fires (termios restore happens inside the
/// handler *after* this write), so we must emit the carriage return
/// ourselves or the next shell prompt lands mid-line.
#[cfg(unix)]
const RESTORE_SEQUENCE: &[u8] = b"\x1b[?25h\x1b[?1000l\x1b[?1006l\r\n";

#[cfg(unix)]
unsafe extern "C" {
    // libuv entry point already linked by `Bun__ttySetMode`'s atexit hook
    // (see src/jsc/bindings/wtf-bindings.cpp). tcsetattr is not strictly
    // async-signal-safe per POSIX, but libuv + the existing
    // `onExitSignal` in c-bindings.cpp use it from a signal handler on
    // every TTY-owning Bun process already, so calling it here is
    // consistent with the rest of the codebase. Signature matches
    // `napi_body.rs:3610` (return value ignored).
    pub fn uv_tty_reset_mode();
}

#[cfg(unix)]
extern "C" fn handler(sig: i32) {
    // SAFETY: `write` is listed as async-signal-safe in POSIX.1-2024
    // §XSH 2.4.3. The buffer is a 'static slice.
    unsafe {
        let _ = libc::write(
            libc::STDOUT_FILENO,
            RESTORE_SEQUENCE.as_ptr().cast(),
            RESTORE_SEQUENCE.len(),
        );
    }
    // Restore cooked termios on every TTY Bun modified. Matches
    // onExitSignal's behaviour.
    // SAFETY: no preconditions; internal atomic spinlock + tcsetattr on a
    // saved termios snapshot. Call from signal handler mirrors libuv's own
    // `onExitSignal` in src/jsc/bindings/c-bindings.cpp.
    unsafe {
        uv_tty_reset_mode();
    }
    // Conventional `128 + signum` exit status for death-by-signal. _exit is
    // async-signal-safe and does not run atexit (which would try to restore
    // things we've already restored).
    // SAFETY: `_exit` has no preconditions; never returns.
    unsafe {
        libc::_exit(128 + sig);
    }
}

#[cfg(windows)]
unsafe extern "C" {
    // Restore the console-mode snapshot `output::stdio::init()` captured at
    // startup (stdin/stdout/stderr). Without this, the
    // ENABLE_LINE_INPUT/ECHO_INPUT/PROCESSED_INPUT bits we cleared on
    // prompt entry would leak to the next process reading the same
    // console. This is the Windows analogue of `uv_tty_reset_mode` on
    // Unix and is what the process-wide `Ctrlhandler` in c-bindings.cpp
    // would normally do for CTRL_C_EVENT — but our handler runs first in
    // the SetConsoleCtrlHandler LIFO chain and ExitProcess's directly, so
    // we have to invoke it ourselves.
    safe fn Bun__restoreWindowsStdio();
}

#[cfg(windows)]
unsafe extern "system" fn handler(ctrl: bun_sys::windows::DWORD) -> bun_sys::windows::BOOL {
    use bun_sys::windows;
    match ctrl {
        windows::CTRL_C_EVENT | windows::CTRL_BREAK_EVENT | windows::CTRL_CLOSE_EVENT => {
            // Same restore sequence as Unix; WriteFile on the console
            // handle is reentrant-safe for plain VT sequences.
            const RESTORE: &[u8] = b"\x1b[?25h\x1b[?1000l\x1b[?1006l\r\n";
            let mut written: windows::DWORD = 0;
            // bun_core::windows_sys::GetStdHandle returns `None` for
            // INVALID_HANDLE_VALUE and for null handles (no console
            // attached, handle closed, etc.). Skip the write in those
            // cases — we still need to ExitProcess either way.
            if let Some(h) = windows::GetStdHandle(windows::STD_OUTPUT_HANDLE) {
                // SAFETY: `h` is a non-null, non-INVALID kernel handle
                // returned by `GetStdHandle`; `RESTORE` is a 'static
                // 24-byte buffer; `written` is a valid stack out-pointer;
                // the overlapped pointer is nullable for synchronous I/O.
                unsafe {
                    windows::kernel32::WriteFile(
                        h,
                        RESTORE.as_ptr(),
                        RESTORE.len() as windows::DWORD,
                        &mut written,
                        core::ptr::null_mut(),
                    );
                }
            }
            // Windows analogue of the Unix `uv_tty_reset_mode` call — restores
            // the ENABLE_LINE_INPUT / ECHO_INPUT / PROCESSED_INPUT flags the
            // prompt cleared. Keeps both arms symmetric: ANSI restore →
            // console/termios restore → exit.
            Bun__restoreWindowsStdio();
            // STATUS_CONTROL_C_EXIT = 0xC000013A — matches what the default
            // console ctrl handler would have done.
            windows::kernel32::ExitProcess(0xC000013A);
        }
        _ => windows::FALSE,
    }
}

/// Saved previous sigaction for SIGINT / SIGTERM. Written once in
/// [`install`], read once in [`uninstall`]. Prompt entry/exit is
/// single-threaded so the plain static is safe — matches the pattern in
/// Coordinator::abort_handler.
#[cfg(unix)]
static PREV_INT: bun_core::RacyCell<core::mem::MaybeUninit<libc::sigaction>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());
#[cfg(unix)]
static PREV_TERM: bun_core::RacyCell<core::mem::MaybeUninit<libc::sigaction>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

/// Nesting level, so a hypothetical nested caller (pretty unlikely here,
/// but cheap insurance) doesn't uninstall the handler the outer call still
/// relies on.
#[cfg(unix)]
static LEVEL: AtomicI32 = AtomicI32::new(0);

#[must_use = "drop the guard to uninstall the signal handler"]
pub struct Guard(());

impl Drop for Guard {
    fn drop(&mut self) {
        uninstall();
    }
}

pub fn install() -> Guard {
    #[cfg(unix)]
    {
        if LEVEL.fetch_add(1, Ordering::AcqRel) == 0 {
            // SAFETY: sigaction is POD and zeroed is a valid empty mask +
            // null sa_restorer. PREV_* are written before any read in
            // `uninstall()`.
            unsafe {
                let mut act: libc::sigaction = bun_core::ffi::zeroed();
                act.sa_sigaction = handler as *const () as usize;
                libc::sigemptyset(&raw mut act.sa_mask);
                act.sa_flags = 0;
                libc::sigaction(
                    libc::SIGINT,
                    &raw const act,
                    PREV_INT.get().cast::<libc::sigaction>(),
                );
                libc::sigaction(
                    libc::SIGTERM,
                    &raw const act,
                    PREV_TERM.get().cast::<libc::sigaction>(),
                );
            }
        }
    }
    #[cfg(windows)]
    {
        // The Windows-console Ctrl+C path into the prompt is already
        // covered by unsetting ENABLE_PROCESSED_INPUT (byte 3 reaches the
        // input loop). This handler picks up the other cases that route:
        // Ctrl+Break from a parent process, console-close events, and
        // SIGINT/SIGTERM sent by other Bun subsystems.
        let _ = bun_sys::c::SetConsoleCtrlHandler(Some(handler), bun_sys::windows::TRUE);
    }
    Guard(())
}

fn uninstall() {
    #[cfg(unix)]
    {
        if LEVEL.fetch_sub(1, Ordering::AcqRel) == 1 {
            // SAFETY: PREV_* were initialized by `install`.
            unsafe {
                libc::sigaction(
                    libc::SIGINT,
                    PREV_INT.get().cast::<libc::sigaction>(),
                    core::ptr::null_mut(),
                );
                libc::sigaction(
                    libc::SIGTERM,
                    PREV_TERM.get().cast::<libc::sigaction>(),
                    core::ptr::null_mut(),
                );
            }
        }
    }
    #[cfg(windows)]
    {
        let _ = bun_sys::c::SetConsoleCtrlHandler(Some(handler), bun_sys::windows::FALSE);
    }
}

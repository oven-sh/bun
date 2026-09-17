use core::ffi::c_int;

use bun_sys::{Fd, FileKind};
use bun_uws_sys::Loop;

use crate::windows::{self, File, Pipe, PipeOrigin, Tty};

bun_core::declare_scope!(PipeSource, hidden);

/// What a reader or writer on Windows drives, by kind of HANDLE.
pub enum Source {
    Pipe(Pipe),
    Tty(Tty),
    File(File),
}

impl Source {
    /// Take `fd` over. `Foreign` and `InheritedUnshared` leave what `fd` is to
    /// be found out first, and say whose it is if it turns out to be a pipe;
    /// every other `origin` says it is one. `fd` is closed with the source when
    /// `close_fd` is set, except a standard handle, which is never closed. On
    /// `Err` the caller still owns `fd`.
    pub fn open(
        loop_: *mut Loop,
        fd: Fd,
        origin: PipeOrigin,
        close_fd: bool,
    ) -> bun_sys::Result<Source> {
        if matches!(
            origin,
            PipeOrigin::Created | PipeOrigin::Associated | PipeOrigin::CreatedSynchronous
        ) {
            bun_core::scoped_log!(PipeSource, "open(fd: {}, {:?})", fd, origin);
            return Pipe::open(loop_, fd, origin, close_fd).map(Source::Pipe);
        }
        let kind = bun_sys::File::borrow(&fd).kind().map_err(|err| {
            bun_sys::Error {
                syscall: bun_sys::Tag::open,
                ..err
            }
            .with_fd(fd)
        })?;
        Self::open_as(loop_, fd, origin, kind, close_fd)
    }

    /// [`open`](Self::open) by a caller that has asked what `fd` is already
    /// (`bun_sys::File::kind`).
    pub fn open_as(
        loop_: *mut Loop,
        fd: Fd,
        origin: PipeOrigin,
        kind: FileKind,
        close_fd: bool,
    ) -> bun_sys::Result<Source> {
        bun_core::scoped_log!(PipeSource, "open(fd: {}, {:?})", fd, kind);
        match kind {
            FileKind::NamedPipe => {
                Pipe::open_classified(loop_, fd, origin, close_fd).map(Source::Pipe)
            }
            // `NUL` and serial ports are character devices too.
            FileKind::CharacterDevice if windows::tty::is_console(fd.native()) => {
                Tty::open(loop_, fd, close_fd).map(Source::Tty)
            }
            _ => File::open(loop_, fd, close_fd).map(Source::File),
        }
    }

    /// Closed from under its owner by a loop teardown.
    pub fn is_closed(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_closed(),
            Source::Tty(tty) => tty.is_closed(),
            Source::File(_) => false,
        }
    }

    pub(crate) fn is_active(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_active(),
            Source::Tty(tty) => tty.is_active(),
            Source::File(_) => true,
        }
    }

    /// A system-kind `Fd` for a pipe or console; the `Fd` it was opened with
    /// for a file.
    pub fn get_fd(&self) -> Fd {
        match self {
            Source::Pipe(pipe) => pipe.fd(),
            Source::Tty(tty) => tty.fd(),
            Source::File(file) => file.fd(),
        }
    }

    /// Whether the source keeps the loop alive while it reads. A file
    /// operation in flight always does.
    pub fn ref_(&self) {
        match self {
            Source::Pipe(pipe) => pipe.ref_(),
            Source::Tty(tty) => tty.ref_(),
            Source::File(_) => {}
        }
    }

    pub fn unref(&self) {
        match self {
            Source::Pipe(pipe) => pipe.unref(),
            Source::Tty(tty) => tty.unref(),
            Source::File(_) => {}
        }
    }

    /// Leave the `Fd` the source was opened with open when the source closes.
    pub fn disown(&mut self) {
        match self {
            Source::Pipe(pipe) => pipe.disown(),
            Source::Tty(tty) => tty.disown(),
            Source::File(file) => file.disown(),
        }
    }

    /// Close, letting writes that have not completed report back (`ECANCELED`
    /// for a pipe). Dropping the source instead calls nobody back, except for
    /// a file write, whose callback is what releases the bytes it borrowed.
    pub fn close(self) {
        match self {
            Source::Pipe(pipe) => pipe.close(),
            Source::Tty(tty) => tty.close(),
            Source::File(file) => drop(file),
        }
    }

    pub(crate) fn is_reading(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_reading(),
            Source::Tty(tty) => tty.is_reading(),
            Source::File(file) => file.is_busy(),
        }
    }

    pub(crate) fn set_raw_mode(&mut self, value: bool) -> bun_sys::Result<()> {
        match self {
            Source::Tty(tty) => tty.set_mode(if value {
                windows::tty::Mode::Raw
            } else {
                windows::tty::Mode::Normal
            }),
            _ => Err(bun_sys::Error {
                errno: bun_sys::E::NOTSUP as _,
                syscall: bun_sys::Tag::uv_tty_set_mode,
                fd: self.get_fd(),
                ..Default::default()
            }),
        }
    }
}

/// `process.stdin.setRawMode`. Raw mode asks the console to produce VT input
/// sequences itself where it can, which is also what makes sequences such as
/// bracketed paste reach the process at all; Node's readline handles both
/// forms.
#[unsafe(no_mangle)]
extern "C" fn Source__setRawModeStdin(raw: bool) -> c_int {
    let stdin = Fd::stdin().native();
    let mode = if raw {
        windows::tty::Mode::RawVt
    } else {
        windows::tty::Mode::Normal
    };
    match windows::tty::set_console_mode(stdin, mode) {
        Ok(()) => 0,
        Err(err) => err.errno as c_int,
    }
}

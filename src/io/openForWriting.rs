use bun_core::ZStr;
#[cfg(unix)]
use bun_sys::FdExt;
use bun_sys::{self, Fd, Mode};

// A sealed trait whose impls cover each accepted input type
// (`PathOrFileDescriptor` and zero-terminated path slices).
pub trait OpenForWritingInput {
    fn open_for_writing_result(
        &self,
        dir: Fd,
        input_flags: i32,
        mode: Mode,
        is_nonblocking: &mut bool,
        openat: &dyn Fn(Fd, &ZStr, i32, Mode) -> bun_sys::Result<Fd>,
    ) -> bun_sys::Result<Fd>;
}

impl OpenForWritingInput for crate::PathOrFileDescriptor<'_> {
    fn open_for_writing_result(
        &self,
        dir: Fd,
        input_flags: i32,
        mode: Mode,
        is_nonblocking: &mut bool,
        _openat: &dyn Fn(Fd, &ZStr, i32, Mode) -> bun_sys::Result<Fd>,
    ) -> bun_sys::Result<Fd> {
        use crate::PathOrFileDescriptor::*;
        match self {
            Path(path) => {
                *is_nonblocking = true;
                bun_sys::openat_a(dir, path, input_flags, mode)
            }
            Fd(fd_) => bun_sys::dup_with_flags(*fd_, 0),
        }
    }
}

impl OpenForWritingInput for &ZStr {
    fn open_for_writing_result(
        &self,
        dir: Fd,
        input_flags: i32,
        mode: Mode,
        _is_nonblocking: &mut bool,
        openat: &dyn Fn(Fd, &ZStr, i32, Mode) -> bun_sys::Result<Fd>,
    ) -> bun_sys::Result<Fd> {
        openat(dir, self, input_flags, mode)
    }
}

pub fn open_for_writing<P, C>(
    dir: Fd,
    input_path: &P,
    input_flags: i32,
    mode: Mode,
    pollable: &mut bool,
    is_socket: &mut bool,
    force_sync: bool,
    out_nonblocking: &mut bool,
    ctx: C,
    on_force_sync_or_isa_tty: fn(C),
    is_pollable: fn(mode: Mode) -> bool,
) -> bun_sys::Result<Fd>
where
    P: OpenForWritingInput,
{
    open_for_writing_impl(
        dir,
        input_path,
        input_flags,
        mode,
        pollable,
        is_socket,
        force_sync,
        out_nonblocking,
        ctx,
        on_force_sync_or_isa_tty,
        is_pollable,
        bun_sys::openat,
    )
}

pub fn open_for_writing_impl<P, C>(
    dir: Fd,
    input_path: &P,
    input_flags: i32,
    mode: Mode,
    pollable: &mut bool,
    is_socket: &mut bool,
    force_sync: bool,
    out_nonblocking: &mut bool,
    ctx: C,
    on_force_sync_or_isa_tty: fn(C),
    is_pollable: fn(mode: Mode) -> bool,
    openat: fn(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> bun_sys::Result<Fd>,
) -> bun_sys::Result<Fd>
where
    P: OpenForWritingInput,
{
    #[cfg(windows)]
    {
        let _ = (
            is_socket,
            out_nonblocking,
            ctx,
            on_force_sync_or_isa_tty,
            is_pollable,
        );
    }
    // TODO: this should be concurrent.
    #[cfg(unix)]
    let mut isatty = false;
    let mut is_nonblocking = false;
    let result =
        input_path.open_for_writing_result(dir, input_flags, mode, &mut is_nonblocking, &openat);
    let fd = result?;

    #[cfg(unix)]
    {
        match bun_sys::fstat(fd) {
            Err(err) => {
                fd.close();
                return Err(err);
            }
            Ok(stat) => {
                // pollable.* = bun.sys.isPollable(stat.mode);
                *pollable = is_pollable(stat.st_mode as Mode);
                if !*pollable {
                    isatty = bun_sys::isatty(fd);
                }

                if isatty {
                    *pollable = true;
                }

                *is_socket = bun_sys::S::ISSOCK(stat.st_mode as Mode);

                if force_sync || isatty {
                    // Prevents interleaved or dropped stdout/stderr output for terminals.
                    // As noted in the following reference, local TTYs tend to be quite fast and
                    // this behavior has become expected due historical functionality on OS X,
                    // even though it was originally intended to change in v1.0.2 (Libuv 1.2.1).
                    // Ref: https://github.com/nodejs/node/pull/1771#issuecomment-119351671
                    let _ = bun_sys::update_nonblocking(fd, false);
                    is_nonblocking = false;
                    // this.force_sync = true;
                    // this.writer.force_sync = true;
                    on_force_sync_or_isa_tty(ctx);
                } else if *pollable {
                    if !is_nonblocking {
                        let flags = match bun_sys::get_fcntl_flags(fd) {
                            Ok(flags) => flags,
                            Err(err) => {
                                fd.close();
                                return Err(err);
                            }
                        };
                        is_nonblocking = (flags as i32 & bun_sys::O::NONBLOCK) != 0;

                        if !is_nonblocking {
                            if bun_sys::set_nonblocking(fd).is_ok() {
                                is_nonblocking = true;
                            }
                        }
                    }
                } else {
                    // Regular file / block device / anything else epoll can't wait
                    // on: the streaming writer has no poll to re-drive an EAGAIN, so
                    // an O_NONBLOCK short write would strand the unwritten tail in
                    // its buffer and close() would drop it. O_NONBLOCK is only on
                    // the open flags so open() itself never blocks on a FIFO; once
                    // fstat says this isn't one, clear it and let write() block so
                    // the try_write loop drains every short write synchronously.
                    let _ = bun_sys::update_nonblocking(fd, false);
                    is_nonblocking = false;
                }

                *out_nonblocking = is_nonblocking && *pollable;
            }
        }

        return Ok(fd);
    }

    #[cfg(windows)]
    {
        *pollable = (bun_sys::windows::GetFileType(fd.native()) & bun_sys::windows::FILE_TYPE_PIPE)
            != 0
            && !force_sync;
        return Ok(fd);
    }
}

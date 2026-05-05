use bun_str::ZStr;
use bun_sys::{self, Fd, Mode};

// PORT NOTE: Zig's `input_path: anytype` type-switches on `@TypeOf(input_path)` between
// `bun.webcore.PathOrFileDescriptor` and `[:0]const u8` / `[:0]u8`. Rust has no type-switch,
// so this is expressed as a sealed trait whose impls encode each `switch (PathT)` arm.
// TODO(port): verify callers — if only one input type is ever used per call site, consider
// monomorphizing into two free fns instead of the trait.
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

// CYCLEBREAK(TYPE_ONLY): `PathOrFileDescriptor` moved into io (see crate root).
impl OpenForWritingInput for crate::PathOrFileDescriptor {
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
                bun_sys::openat_a(dir, path.slice(), input_flags, mode)
            }
            Fd(fd_) => {
                let duped = bun_sys::dup_with_flags(*fd_, 0);
                duped
            }
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

impl OpenForWritingInput for &mut ZStr {
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
    input_path: P,
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
    input_path: P,
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
    // TODO: this should be concurrent.
    let mut isatty = false;
    let mut is_nonblocking = false;
    let result = input_path.open_for_writing_result(dir, input_flags, mode, &mut is_nonblocking, &openat);
    let fd = match result {
        Err(err) => return Err(err),
        Ok(fd) => fd,
    };

    #[cfg(unix)]
    {
        match bun_sys::fstat(fd) {
            Err(err) => {
                fd.close();
                return Err(err);
            }
            Ok(stat) => {
                // pollable.* = bun.sys.isPollable(stat.mode);
                *pollable = is_pollable(stat.mode);
                if !*pollable {
                    // TODO(port): std.posix.isatty — route through bun_sys
                    isatty = bun_sys::posix::isatty(fd.native());
                }

                if isatty {
                    *pollable = true;
                }

                *is_socket = bun_sys::S::is_sock(stat.mode);

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
                } else if !is_nonblocking {
                    let flags = match bun_sys::get_fcntl_flags(fd) {
                        Ok(flags) => flags,
                        Err(err) => {
                            fd.close();
                            return Err(err);
                        }
                    };
                    is_nonblocking = (flags & bun_sys::O::NONBLOCK) != 0;

                    if !is_nonblocking {
                        if bun_sys::set_nonblocking(fd).is_ok() {
                            is_nonblocking = true;
                        }
                    }
                }

                *out_nonblocking = is_nonblocking && *pollable;
            }
        }

        return Ok(fd);
    }

    #[cfg(windows)]
    {
        *pollable = (bun_sys::windows::GetFileType(fd.cast()) & bun_sys::windows::FILE_TYPE_PIPE) != 0 && !force_sync;
        return Ok(fd);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/io/openForWriting.zig (139 lines)
//   confidence: medium
//   todos:      2
//   notes:      anytype type-switch on input_path modeled as OpenForWritingInput trait; comptime fn-ptr params (Ctx/onForceSyncOrIsaTTY/isPollable/openat) flattened to plain fn pointers
// ──────────────────────────────────────────────────────────────────────────

use core::ptr;

use bun_core::feature_flags;
use bun_sys::{self, Fd};
use bun_url::URL;

#[derive(Copy, Clone)]
pub struct SendFile {
    pub fd: Fd,
    pub remain: usize,
    pub offset: usize,
    pub content_size: usize,
}

impl SendFile {
    pub fn is_eligible(url: &URL) -> bool {
        // `if cfg!()` is fine here: both branches type-check (no platform-only items referenced).
        if cfg!(windows) || !feature_flags::STREAMING_FILE_UPLOADS_FOR_HTTP_CLIENT {
            return false;
        }
        url.is_http() && url.href.len() > 0
    }

    // PORT NOTE: reshaped — Zig took `NewHTTPContext(false).HTTPSocket` and only ever
    // called `socket.fd()` on it. `NewHTTPContext` is part of the still-gated
    // mutually-recursive cluster, so accept the resolved fd directly. Callers pass
    // `socket.fd()`.
    pub fn write(&mut self, socket_fd: Fd) -> Status {
        // Zig u63 max == i64::MAX. Clamp `remain` so the signed sendfile count cannot overflow.
        let adjusted_count_temporary: u64 = (self.remain as u64).min(i64::MAX as u64);
        // TODO we should not need this int cast; improve the return type of `@min`
        let adjusted_count: u64 = adjusted_count_temporary; // was @intCast to u63

        // Android: same kernel `sendfile(2)` ABI, dispatched via `bun_sys::linux`'s
        // raw-syscall thunk (no libc difference matters here).
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = adjusted_count; // unused on Linux path (matches Zig)
            let mut signed_offset: i64 = i64::try_from(self.offset).expect("int cast");
            let begin = self.offset;
            // this does the syscall directly, without libc
            // SAFETY: fds are valid open descriptors owned by `self`/caller; offset ptr is a
            // live stack local.
            let val = unsafe {
                bun_sys::linux::sendfile(
                    socket_fd.native(),
                    self.fd.native(),
                    &raw mut signed_offset,
                    self.remain,
                )
            };
            self.offset = u64::try_from(signed_offset).expect("int cast") as usize;

            let errcode = bun_sys::get_errno(val);

            self.remain = (self.remain as u64)
                .saturating_sub((self.offset as u64).saturating_sub(begin as u64))
                as usize;

            if errcode != bun_sys::E::SUCCESS || self.remain == 0 || val == 0 {
                if errcode == bun_sys::E::SUCCESS {
                    return Status::Done;
                }

                return Status::Err(bun_core::errno_to_zig_err(errcode as i32));
            }
        }

        #[cfg(target_os = "freebsd")]
        {
            let mut sbytes: i64 = 0; // std.posix.off_t
            // Same-width signedness flip (Zig `@bitCast`); `as` is a bit-reinterpret here.
            let signed_offset: i64 = self.offset as u64 as i64;
            // FreeBSD: sendfile(fd, s, offset, nbytes, hdtr, *sbytes, flags)
            // SAFETY: fds valid; sbytes is a live stack local; hdtr is null (no headers).
            let errcode = bun_sys::get_errno(unsafe {
                bun_sys::c::sendfile(
                    self.fd.native(),
                    socket_fd.native(),
                    signed_offset,
                    adjusted_count as usize,
                    ptr::null_mut(),
                    &mut sbytes,
                    0,
                )
            });
            let wrote: u64 = u64::try_from(sbytes).expect("int cast");
            self.offset = (self.offset as u64).saturating_add(wrote) as usize;
            self.remain = (self.remain as u64).saturating_sub(wrote) as usize;
            if errcode != bun_sys::E::EAGAIN || self.remain == 0 || sbytes == 0 {
                if errcode == bun_sys::E::SUCCESS {
                    return Status::Done;
                }
                return Status::Err(bun_core::errno_to_zig_err(errcode as i32));
            }
        }

        #[cfg(all(
            unix,
            not(any(target_os = "linux", target_os = "android")),
            not(target_os = "freebsd")
        ))]
        {
            let mut sbytes: i64 = i64::try_from(adjusted_count).expect("int cast"); // std.posix.off_t
            // Zig: `@as(i64, @bitCast(self.offset))` — same-width `as` is the bitcast.
            let signed_offset: i64 = self.offset as u64 as i64;
            // SAFETY: fds valid; sbytes is a live stack local; hdtr is null (no headers).
            let errcode = bun_sys::get_errno(unsafe {
                bun_sys::c::sendfile(
                    self.fd.native(),
                    socket_fd.native(),
                    signed_offset,
                    &mut sbytes,
                    ptr::null_mut(),
                    0,
                )
            });
            let wrote: u64 = u64::try_from(sbytes).expect("int cast");
            self.offset = (self.offset as u64).saturating_add(wrote) as usize;
            self.remain = (self.remain as u64).saturating_sub(wrote) as usize;
            if errcode != bun_sys::E::EAGAIN || self.remain == 0 || sbytes == 0 {
                if errcode == bun_sys::E::SUCCESS {
                    return Status::Done;
                }

                return Status::Err(bun_core::errno_to_zig_err(errcode as i32));
            }
        }

        #[cfg(windows)]
        {
            let _ = (socket_fd, adjusted_count);
        }

        Status::Again
    }
}

pub enum Status {
    Done,
    Err(bun_core::Error),
    Again,
}

// ported from: src/http/SendFile.zig

use core::ptr;

use bun_core::{self, FeatureFlags};
use bun_sys::{self, Fd};
use bun_url::URL;

use crate::NewHTTPContext;

pub struct SendFile {
    pub fd: Fd,
    pub remain: usize,
    pub offset: usize,
    pub content_size: usize,
}

impl Default for SendFile {
    fn default() -> Self {
        Self {
            fd: Fd::invalid(),
            remain: 0,
            offset: 0,
            content_size: 0,
        }
    }
}

impl SendFile {
    pub fn is_eligible(url: &URL) -> bool {
        // `if cfg!()` is fine here: both branches type-check (no platform-only items referenced).
        if cfg!(windows) || !FeatureFlags::STREAMING_FILE_UPLOADS_FOR_HTTP_CLIENT {
            return false;
        }
        url.is_http() && url.href.len() > 0
    }

    pub fn write(
        &mut self,
        // TODO(port): Zig `NewHTTPContext(false).HTTPSocket` — nested type of a type-returning fn.
        // Phase B: confirm whether this becomes `HTTPSocket<false>` or an associated type.
        socket: NewHTTPContext::<false>::HTTPSocket,
    ) -> Status {
        // Zig u63 max == i64::MAX. Clamp `remain` so the signed sendfile count cannot overflow.
        let adjusted_count_temporary: u64 = (self.remain as u64).min(i64::MAX as u64);
        // TODO we should not need this int cast; improve the return type of `@min`
        let adjusted_count: u64 = adjusted_count_temporary; // was @intCast to u63

        #[cfg(target_os = "linux")]
        {
            let _ = adjusted_count; // unused on Linux path (matches Zig)
            let mut signed_offset: i64 = i64::try_from(self.offset).unwrap();
            let begin = self.offset;
            // this does the syscall directly, without libc
            // TODO(port): map `std.os.linux.sendfile` — using bun_sys::linux for the raw syscall.
            let val = unsafe {
                // SAFETY: fds are valid open descriptors owned by `self`/`socket`; offset ptr is a
                // live stack local.
                bun_sys::linux::sendfile(
                    socket.fd().cast(),
                    self.fd.cast(),
                    &mut signed_offset,
                    self.remain,
                )
            };
            self.offset = u64::try_from(signed_offset).unwrap() as usize;

            let errcode = bun_sys::get_errno(val);

            self.remain = (self.remain as u64)
                .saturating_sub((self.offset as u64).saturating_sub(begin as u64))
                as usize;

            if errcode != bun_sys::Errno::SUCCESS || self.remain == 0 || val == 0 {
                if errcode == bun_sys::Errno::SUCCESS {
                    return Status::Done;
                }

                return Status::Err(bun_core::errno_to_err(errcode));
            }
        }

        #[cfg(target_os = "freebsd")]
        {
            let mut sbytes: i64 = 0; // std.posix.off_t
            // SAFETY: same-size POD bitcast u64 -> i64 (Zig used @bitCast).
            let signed_offset: i64 = unsafe { core::mem::transmute::<u64, i64>(self.offset as u64) };
            // FreeBSD: sendfile(fd, s, offset, nbytes, hdtr, *sbytes, flags)
            // TODO(port): map `std.c.sendfile` (FreeBSD signature) — using bun_sys::c.
            let errcode = bun_sys::get_errno(unsafe {
                // SAFETY: fds valid; sbytes is a live stack local; hdtr is null (no headers).
                bun_sys::c::sendfile(
                    self.fd.cast(),
                    socket.fd().cast(),
                    signed_offset,
                    adjusted_count as usize,
                    ptr::null_mut(),
                    &mut sbytes,
                    0,
                )
            });
            let wrote: u64 = u64::try_from(sbytes).unwrap();
            self.offset = (self.offset as u64).saturating_add(wrote) as usize;
            self.remain = (self.remain as u64).saturating_sub(wrote) as usize;
            if errcode != bun_sys::Errno::AGAIN || self.remain == 0 || sbytes == 0 {
                if errcode == bun_sys::Errno::SUCCESS {
                    return Status::Done;
                }
                return Status::Err(bun_core::errno_to_err(errcode));
            }
        }

        #[cfg(all(unix, not(target_os = "linux"), not(target_os = "freebsd")))]
        {
            let mut sbytes: i64 = adjusted_count as i64; // std.posix.off_t
            // SAFETY: same-size POD bitcast u64 -> i64 (Zig used @bitCast).
            let signed_offset: i64 = unsafe { core::mem::transmute::<u64, i64>(self.offset as u64) };
            // TODO(port): map `std.c.sendfile` (Darwin signature) — using bun_sys::c.
            let errcode = bun_sys::get_errno(unsafe {
                // SAFETY: fds valid; sbytes is a live stack local; hdtr is null (no headers).
                bun_sys::c::sendfile(
                    self.fd.cast(),
                    socket.fd().cast(),
                    signed_offset,
                    &mut sbytes,
                    ptr::null_mut(),
                    0,
                )
            });
            let wrote: u64 = u64::try_from(sbytes).unwrap();
            self.offset = (self.offset as u64).saturating_add(wrote) as usize;
            self.remain = (self.remain as u64).saturating_sub(wrote) as usize;
            if errcode != bun_sys::Errno::AGAIN || self.remain == 0 || sbytes == 0 {
                if errcode == bun_sys::Errno::SUCCESS {
                    return Status::Done;
                }

                return Status::Err(bun_core::errno_to_err(errcode));
            }
        }

        Status::Again
    }
}

pub enum Status {
    Done,
    Err(bun_core::Error),
    Again,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/SendFile.zig (101 lines)
//   confidence: medium
//   todos:      4
//   notes:      NewHTTPContext<false>::HTTPSocket nested-type ref + raw sendfile FFI paths need Phase-B wiring; u63 modeled as u64 clamped to i64::MAX.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "freebsd")]
use core::ptr;

use bun_core::feature_flags;
use bun_sys::{self, Fd};
use bun_url::URL;

/// A file request body streamed from the HTTP thread. Never `sendfile(2)` on macOS: XNU's sleeps uninterruptibly under mbuf pressure (see `can_sendfile` in FileResponseStream.rs).
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

    /// `socket_fd` feeds `sendfile(2)`; `send` is the socket's own write (the one a `Bytes` body uses) for the copy path.
    pub(crate) fn write(
        &mut self,
        socket_fd: Fd,
        send: impl FnMut(&[u8]) -> crate::Result<usize>,
    ) -> Status {
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        if !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_FETCH_SENDFILE
            .get()
            .unwrap_or(false)
        {
            return self.write_sendfile(socket_fd);
        }

        #[cfg(unix)]
        {
            let _ = socket_fd;
            return self.write_copy(send);
        }

        #[cfg(windows)]
        {
            let _ = (socket_fd, send);
            Status::Again
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    fn write_sendfile(&mut self, socket_fd: Fd) -> Status {
        // Android: same kernel `sendfile(2)` ABI, dispatched via `bun_sys::linux`'s
        // raw-syscall thunk (no libc difference matters here).
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
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

                return Status::Err(bun_errno::from_errno(errcode as i32).into());
            }
        }

        #[cfg(target_os = "freebsd")]
        {
            // Clamp `remain` so the signed sendfile count cannot overflow.
            let adjusted_count: u64 = (self.remain as u64).min(i64::MAX as u64);
            let mut sbytes: i64 = 0; // C off_t
            // Same-width signedness flip; `as` is a bit-reinterpret here.
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
                return Status::Err(bun_errno::from_errno(errcode as i32).into());
            }
        }

        Status::Again
    }

    /// `pread` + `send`, leaving `offset`/`remain` at the first byte the socket did not take.
    #[cfg(unix)]
    fn write_copy(&mut self, mut send: impl FnMut(&[u8]) -> crate::Result<usize>) -> Status {
        bun_core::scoped_log!(
            crate::fetch,
            "copy file body offset={} remain={}",
            self.offset,
            self.remain
        );
        let buf = crate::scratch::file_body_copy_buffer();
        // Start small and double: a writable wake can mean as little as the low-water mark of space.
        let mut chunk: usize = 16 * 1024;
        loop {
            let want = chunk.min(buf.len()).min(self.remain);
            if want == 0 {
                return Status::Done;
            }
            let read = match bun_sys::pread(self.fd, &mut buf[..want], self.offset as i64) {
                // The file shrank after it was measured; nothing more to send.
                Ok(0) => return Status::Done,
                Ok(n) => n,
                Err(err) => return Status::Err(bun_errno::SystemErrno::from(err).into()),
            };
            let wrote = match send(&buf[..read]) {
                Ok(n) => n,
                Err(err) => return Status::Err(err),
            };
            self.offset += wrote;
            self.remain -= wrote;
            if wrote < read {
                break;
            }
            chunk = chunk.saturating_mul(2);
        }
        Status::Again
    }
}

pub(crate) enum Status {
    #[cfg(not(windows))]
    Done,
    #[cfg(not(windows))]
    Err(crate::Error),
    Again,
}

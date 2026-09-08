#[cfg(target_os = "freebsd")]
use core::ptr;

use bun_core::feature_flags;
use bun_sys::{self, Fd};
use bun_url::URL;

/// Streams a file request body from the HTTP thread. Linux and FreeBSD hand
/// the copy to `sendfile(2)`. macOS copies through a userspace buffer instead:
/// XNU's `sendfile` allocates its mbuf chain with an uninterruptible wait
/// before it checks for socket space, so under mbuf pressure the HTTP thread
/// sleeps in the kernel and the process cannot be killed (the server side
/// avoids it for the same reason, see `can_sendfile` in FileResponseStream.rs).
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

    // Takes the resolved fd directly rather than the socket; callers pass
    // `socket.fd()`.
    pub(crate) fn write(&mut self, socket_fd: Fd) -> Status {
        // Clamp `remain` so the signed sendfile count cannot overflow.
        let adjusted_count_temporary: u64 = (self.remain as u64).min(i64::MAX as u64);
        let adjusted_count: u64 = adjusted_count_temporary;

        // Android: same kernel `sendfile(2)` ABI, dispatched via `bun_sys::linux`'s
        // raw-syscall thunk (no libc difference matters here).
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = adjusted_count; // unused on Linux path
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

        #[cfg(all(
            unix,
            not(any(target_os = "linux", target_os = "android")),
            not(target_os = "freebsd")
        ))]
        {
            let _ = adjusted_count;
            let buf = crate::scratch::file_body_copy_buffer();
            // A writable event can mean as little as the low-water mark of
            // socket space. Start small and double while the socket keeps
            // taking whole chunks, so a slow link does not pread 256 KiB to
            // send 2 KiB on every wake.
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
                let wrote = match bun_sys::send_non_block(socket_fd, &buf[..read]) {
                    Ok(n) => n,
                    // ENOBUFS is the mbuf pool running dry: transient, like the
                    // other usockets write paths treat it. Wait for writable.
                    Err(err)
                        if matches!(err.get_errno(), bun_sys::E::EAGAIN | bun_sys::E::ENOBUFS) =>
                    {
                        break;
                    }
                    Err(err) => return Status::Err(bun_errno::SystemErrno::from(err).into()),
                };
                self.offset += wrote;
                self.remain -= wrote;
                if wrote < read {
                    break;
                }
                chunk = chunk.saturating_mul(2);
            }
        }

        #[cfg(windows)]
        {
            let _ = (socket_fd, adjusted_count);
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

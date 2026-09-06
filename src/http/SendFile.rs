#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
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
    /// Set once `sendfile(2)` refuses the fd (seccomp, a filesystem without
    /// `splice_read`, an old kernel). The rest of the body goes through
    /// `pread` + `write` from `offset`, so nothing already sent is repeated.
    pub use_read_write: bool,
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
            if self.use_read_write {
                return self.write_with_read_write(socket_fd);
            }
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

            match errcode {
                bun_sys::E::SUCCESS => {
                    if self.remain == 0 || val == 0 {
                        return Status::Done;
                    }
                }
                bun_sys::E::EAGAIN => {}
                // Same set as the statx and copy_file_range fallbacks: the
                // syscall is refused for this fd, not failing on it.
                bun_sys::E::EINVAL
                | bun_sys::E::ENOSYS
                | bun_sys::E::EOPNOTSUPP
                | bun_sys::E::EPERM => {
                    self.use_read_write = true;
                    return self.write_with_read_write(socket_fd);
                }
                _ => return Status::Err(bun_errno::from_errno(errcode as i32).into()),
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
            let mut sbytes: i64 = i64::try_from(adjusted_count).expect("int cast"); // C off_t
            // Same-width signedness flip; `as` is a bit-reinterpret here.
            let signed_offset: i64 = self.offset as u64 as i64;
            // SAFETY: fds valid; sbytes is a live stack local; hdtr is null (no headers).
            let errcode = bun_sys::get_errno(unsafe {
                bun_sys::c::sendfile(
                    self.fd.native(),
                    socket_fd.native(),
                    signed_offset,
                    &raw mut sbytes,
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

                return Status::Err(bun_errno::from_errno(errcode as i32).into());
            }
        }

        #[cfg(windows)]
        {
            let _ = (socket_fd, adjusted_count);
        }

        Status::Again
    }

    /// Copy from `offset` to the socket until the socket would block, the
    /// window is sent, or the file ends early. `pread` keeps the fd's file
    /// position untouched, so a partial socket write is resumed at `offset`
    /// on the next writable event.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn write_with_read_write(&mut self, socket_fd: Fd) -> Status {
        let mut stack_buf = bun_core::vec::UninitBuf::<{ 16 * 4096 }>::uninit();
        // SAFETY: `pread` is the only writer of `buf`; only `buf[..read]` is read back.
        let buf = unsafe { stack_buf.as_bytes_mut() };
        loop {
            if self.remain == 0 {
                return Status::Done;
            }
            let want = buf.len().min(self.remain);
            let Ok(signed_offset) = i64::try_from(self.offset) else {
                return Status::Err(bun_errno::SystemErrno::EOVERFLOW.into());
            };
            let read = match bun_sys::pread(self.fd, &mut buf[..want], signed_offset) {
                Ok(0) => return Status::Done,
                Ok(n) => n,
                Err(err) => return Status::Err(crate::Error::Sys(err.into())),
            };
            let mut sent = 0;
            while sent < read {
                match bun_sys::write(socket_fd, &buf[sent..read]) {
                    Ok(0) => return Status::Again,
                    Ok(n) => {
                        sent += n;
                        self.offset += n;
                        self.remain -= n;
                    }
                    Err(err) if err.get_errno() == bun_sys::E::EAGAIN => return Status::Again,
                    Err(err) => return Status::Err(crate::Error::Sys(err.into())),
                }
            }
        }
    }
}

pub(crate) enum Status {
    #[cfg(not(windows))]
    Done,
    #[cfg(not(windows))]
    Err(crate::Error),
    Again,
}

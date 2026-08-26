#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
use core::ptr;

use bun_core::feature_flags;
use bun_sys::{self, Fd};
use bun_url::URL;

/// A body sent with `sendfile(2)`; the JS-side `FetchTasklet` owns the fd for the whole request.
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

    /// Reads the advertised `content_size` bytes (fewer if the file shrank) for a non-sendfile hop.
    pub(crate) fn read_to_vec(&self) -> crate::Result<Vec<u8>> {
        let mut bytes: Vec<u8> = Vec::new();
        bytes
            .try_reserve_exact(self.content_size)
            .map_err(|_| bun_alloc::AllocError)?;
        bytes.resize(self.content_size, 0);
        let read = bun_sys::File::borrow(&self.fd)
            .pread_all(&mut bytes, self.offset as u64)
            .map_err(bun_errno::SystemErrno::from)?;
        bytes.truncate(read);
        Ok(bytes)
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
}

pub(crate) enum Status {
    #[cfg(not(windows))]
    Done,
    #[cfg(not(windows))]
    Err(crate::Error),
    Again,
}

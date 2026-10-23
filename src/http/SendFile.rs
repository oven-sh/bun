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

    // Takes the resolved fd directly rather than the socket; callers pass
    // `socket.fd()`.
    pub(crate) fn write(&mut self, socket_fd: Fd) -> Status {
        #[cfg(not(windows))]
        {
            let mut signed_offset: i64 = i64::try_from(self.offset).expect("int cast");
            let begin = self.offset;
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let result =
                bun_sys::sendfile(self.fd, socket_fd, Some(&mut signed_offset), self.remain);
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let result = bun_sys::sendfile(self.fd, socket_fd, &mut signed_offset, self.remain);
            let (val, errcode) = match result {
                Ok(sent) => (sent, bun_sys::E::SUCCESS),
                Err(err) => (0, err.get_errno()),
            };
            self.offset = u64::try_from(signed_offset).expect("int cast") as usize;

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

        #[cfg(windows)]
        {
            let _ = socket_fd;
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

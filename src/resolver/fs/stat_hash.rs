use bun_hash::XxHash64Streaming as XxHash64;
use bun_http_types::ETag::wtf;
use bun_sys::{S, Stat, Timespec};

#[derive(Default)]
pub struct StatHash {
    pub(crate) value: u64,

    pub last_modified_u64: u64,
    pub(crate) last_modified_buffer: [u8; 32],
    pub(crate) last_modified_buffer_len: u8,
    // TODO: add etag support here!
}

// `libc::stat` has no mtime method, so project the platform-specific fields
// here (mirrors `bun_sys::PosixStat::stat_mtime`).
#[inline]
fn stat_mtime(s: &Stat) -> Timespec {
    // The `libc` crate flattens BSD/Darwin `st_mtimespec` into
    // `st_mtime`/`st_mtime_nsec` so the access is uniform on all `unix`.
    #[cfg(unix)]
    {
        Timespec {
            sec: s.st_mtime,
            nsec: s.st_mtime_nsec,
        }
    }
    #[cfg(windows)]
    {
        Timespec {
            sec: s.mtim.sec as i64,
            nsec: s.mtim.nsec as i64,
        }
    }
}

impl StatHash {
    pub fn hash(&mut self, stat: &Stat, path: &[u8]) {
        let mut stat_hasher = XxHash64::new(42);
        let mtime = stat_mtime(stat);
        stat_hasher.update(bun_core::bytes_of(&stat.st_size));
        stat_hasher.update(bun_core::bytes_of(&stat.st_mode));
        stat_hasher.update(bun_core::bytes_of(&mtime));
        stat_hasher.update(bun_core::bytes_of(&stat.st_ino));
        stat_hasher.update(path);

        let prev = self.value;
        self.value = stat_hasher.digest();

        if prev != self.value && S::ISREG(stat.st_mode as u32) {
            let mtime_timespec = stat_mtime(stat);
            // Clamp negative values to 0 to avoid timestamp overflow issues on Windows
            let mtime = Timespec {
                nsec: mtime_timespec.nsec.max(0),
                sec: mtime_timespec.sec.max(0),
            };
            if mtime.ms() > 0 {
                self.last_modified_buffer_len = u8::try_from(
                    wtf::write_http_date(&mut self.last_modified_buffer, mtime.ms_unsigned()).len(),
                )
                .unwrap();
                self.last_modified_u64 = mtime.ms_unsigned();
            } else {
                self.last_modified_buffer_len = 0;
                self.last_modified_u64 = 0;
            }
        } else if !S::ISREG(stat.st_mode as u32) {
            self.last_modified_buffer_len = 0;
            self.last_modified_u64 = 0;
        }
    }

    pub fn last_modified(&self) -> Option<&[u8]> {
        if self.last_modified_buffer_len == 0 {
            return None;
        }

        Some(&self.last_modified_buffer[0..usize::from(self.last_modified_buffer_len)])
    }
}

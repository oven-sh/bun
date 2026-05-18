use bun_sys::{S, Stat, Timespec};
// Zig: `std.hash.XxHash64` (streaming init/update/digest).
use bun_hash::XxHash64Streaming as XxHash64;
use bun_http_types::ETag::wtf;

pub struct StatHash {
    pub value: u64,

    pub last_modified_u64: u64,
    pub last_modified_buffer: [u8; 32],
    pub last_modified_buffer_len: u8,
    // TODO: add etag support here!
}

impl Default for StatHash {
    fn default() -> Self {
        Self {
            value: 0,
            last_modified_u64: 0,
            last_modified_buffer: [0u8; 32],
            last_modified_buffer_len: 0,
        }
    }
}

// Zig `std.posix.Stat.mtime()` — Rust `libc::stat` has no method, project the
// platform-specific fields here (mirrors `bun_sys::PosixStat::stat_mtime`).
#[inline]
fn stat_mtime(s: &Stat) -> Timespec {
    // The `libc` crate flattens BSD/Darwin `st_mtimespec` into
    // `st_mtime`/`st_mtime_nsec` so the access is uniform on all `unix`.
    #[cfg(unix)]
    {
        Timespec {
            sec: s.st_mtime as i64,
            nsec: s.st_mtime_nsec as i64,
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

        if prev != self.value && S::ISREG(u32::try_from(stat.st_mode).expect("int cast")) {
            let mtime_timespec = stat_mtime(stat);
            // Clamp negative values to 0 to avoid timestamp overflow issues on Windows
            let mtime = Timespec {
                nsec: i64::try_from(mtime_timespec.nsec.max(0)).expect("int cast"),
                sec: i64::try_from(mtime_timespec.sec.max(0)).expect("int cast"),
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
        } else if !S::ISREG(u32::try_from(stat.st_mode).expect("int cast")) {
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

// ported from: src/resolver/fs/stat_hash.zig

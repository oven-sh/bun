use bun_sys::{Stat, Timespec, S};
// TODO(port): confirm XxHash64 source crate (Zig used std.hash.XxHash64; likely twox-hash or a bun_hash port)
use bun_hash::XxHash64;
use bun_jsc::wtf;

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

#[inline]
fn as_bytes<T>(v: &T) -> &[u8] {
    // SAFETY: reinterpreting a value as its raw byte representation; T is POD
    // (mirrors Zig std.mem.asBytes).
    unsafe { core::slice::from_raw_parts((v as *const T).cast::<u8>(), core::mem::size_of::<T>()) }
}

impl StatHash {
    pub fn hash(&mut self, stat: &Stat, path: &[u8]) {
        let mut stat_hasher = XxHash64::with_seed(42);
        stat_hasher.update(as_bytes(&stat.size));
        stat_hasher.update(as_bytes(&stat.mode));
        stat_hasher.update(as_bytes(&stat.mtime()));
        stat_hasher.update(as_bytes(&stat.ino));
        stat_hasher.update(path);

        let prev = self.value;
        self.value = stat_hasher.finish();

        // TODO(port): narrow @intCast target type for stat.mode (Zig inferred from S.ISREG param)
        if prev != self.value && S::isreg(u32::try_from(stat.mode).unwrap()) {
            let mtime_timespec = stat.mtime();
            // Clamp negative values to 0 to avoid timestamp overflow issues on Windows
            let mtime = Timespec {
                nsec: i64::try_from(mtime_timespec.nsec.max(0)).unwrap(),
                sec: i64::try_from(mtime_timespec.sec.max(0)).unwrap(),
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
        } else if !S::isreg(u32::try_from(stat.mode).unwrap()) {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/fs/stat_hash.zig (49 lines)
//   confidence: medium
//   todos:      2
//   notes:      XxHash64 crate TBD; bun.S/bun.timespec mapped to bun_sys::{S,Timespec}; wtf::write_http_date is a JSC dep in a base crate
// ──────────────────────────────────────────────────────────────────────────

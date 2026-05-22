// ─── Version (from bun_semver, TYPE_ONLY for env.rs::VERSION const) ───────
// Only the scalar fields env.rs reads (major/minor/patch). Full Version with
// tag/pre/build stays in bun_semver.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl Version {
    pub const ZERO: Self = Self {
        major: 0,
        minor: 0,
        patch: 0,
    };

    /// Parse leading `"MAJOR.MINOR.PATCH"` from a byte slice. Per field:
    /// accumulate ASCII digits (wrapping on overflow), stop at the first
    /// non-digit, then advance past a single `'.'` to the next field; missing
    /// or empty fields default to 0. Tolerates trailing junk (e.g. uname's
    /// `"5.10.16-microsoft-standard"` → {5,10,16}). `const fn` so it can
    /// populate `static`/`const` initializers.
    pub const fn parse_dotted(bytes: &[u8]) -> Self {
        let mut nums = [0u32; 3];
        let mut idx = 0usize;
        let mut i = 0usize;
        while idx < 3 {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                nums[idx] = nums[idx]
                    .wrapping_mul(10)
                    .wrapping_add((bytes[i] - b'0') as u32);
                i += 1;
            }
            if i == start {
                break;
            }
            idx += 1;
            if i < bytes.len() && bytes[i] == b'.' {
                i += 1;
            } else {
                break;
            }
        }
        Self {
            major: nums[0],
            minor: nums[1],
            patch: nums[2],
        }
    }
}

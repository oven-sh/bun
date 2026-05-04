use core::cmp::Ordering;

use bun_semver::String as SemverString;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ExternalString {
    pub value: SemverString,
    pub hash: u64,
}

impl Default for ExternalString {
    fn default() -> Self {
        Self {
            value: SemverString::default(),
            hash: 0,
        }
    }
}

impl ExternalString {
    #[inline]
    pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> bun_semver::string::Formatter<'a> {
        // TODO(port): confirm exact path/type of `bun_semver::string::Formatter`
        self.value.fmt(buf)
    }

    pub fn order(&self, rhs: &ExternalString, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        if self.hash == rhs.hash && self.hash > 0 {
            return Ordering::Equal;
        }

        self.value.order(&rhs.value, lhs_buf, rhs_buf)
    }

    /// ExternalString but without the hash
    #[inline]
    pub fn from(in_: &[u8]) -> ExternalString {
        ExternalString {
            value: SemverString::init(in_, in_),
            // `bun.Wyhash.hash(0, in)` — std.hash.Wyhash with seed 0, same as `bun.hash`
            hash: bun_wyhash::hash(in_),
        }
    }

    #[inline]
    pub fn is_inline(&self) -> bool {
        self.value.is_inline()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.value.is_empty()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.value.len()
    }

    #[inline]
    pub fn init(buf: &[u8], in_: &[u8], hash: u64) -> ExternalString {
        ExternalString {
            value: SemverString::init(buf, in_),
            hash,
        }
    }

    #[inline]
    pub fn slice<'a>(&self, buf: &'a [u8]) -> &'a [u8] {
        self.value.slice(buf)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_types/ExternalString.zig (51 lines)
//   confidence: high
//   todos:      1
//   notes:      `String.Formatter` return type path is a guess; depends on bun_semver layout
// ──────────────────────────────────────────────────────────────────────────

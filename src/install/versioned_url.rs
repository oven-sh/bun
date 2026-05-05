use core::cmp::Ordering;

use bun_semver::{self as semver, String, StringBuilder};
use bun_semver::version::VersionInt;

pub type VersionedURL = VersionedURLType<u64>;
pub type OldV2VersionedURL = VersionedURLType<u32>;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct VersionedURLType<SemverIntType: VersionInt> {
    pub url: String,
    pub version: semver::VersionType<SemverIntType>,
}

impl<SemverIntType: VersionInt> VersionedURLType<SemverIntType> {
    pub fn eql(&self, other: &Self) -> bool {
        self.version.eql(other.version)
    }

    pub fn order(&self, other: &Self, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        self.version.order(other.version, lhs_buf, rhs_buf)
    }

    // Zig uses `comptime Builder: type, builder: Builder` (anytype pattern) →
    // bound on the `bun_semver::StringBuilder` trait.
    pub fn count<B: StringBuilder>(&self, buf: &[u8], builder: &mut B) {
        self.version.count(buf, builder);
        builder.count(self.url.slice(buf));
    }

    pub fn clone<B: StringBuilder>(&self, buf: &[u8], builder: &mut B) -> Self {
        Self {
            version: self.version.append(buf, builder),
            url: builder.append::<String>(self.url.slice(buf)),
        }
    }
}

impl VersionedURLType<u32> {
    // Zig: `if (comptime SemverIntType != u32) @compileError("unexpected SemverIntType")`
    // → only impl for the u32 instantiation.
    pub fn migrate(&self) -> VersionedURLType<u64> {
        VersionedURLType {
            url: self.url,
            version: self.version.migrate(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/versioned_url.zig (44 lines)
//   confidence: medium
//   todos:      2
//   notes:      Builder anytype param needs a trait in bun_semver; semver::VersionType<I> assumed.
// ──────────────────────────────────────────────────────────────────────────

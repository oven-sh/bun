// These are all extern so they can't be top-level structs.
pub use bun_install_types::semver_string::String;
pub use bun_install_types::external_string::ExternalString;
pub use crate::version::Version;
pub use crate::version::VersionType;

pub use bun_install_types::sliced_string::SlicedString;
pub use crate::semver_range::SemverRange as Range;
pub use crate::semver_query::SemverQuery as Query;
// PORT NOTE: `SemverObject` re-export from `../semver_jsc/` deleted — *_jsc
// extension traits live in the `bun_semver_jsc` crate, not here.

pub mod version;
pub mod semver_range;
pub mod semver_query;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/semver/semver.zig (10 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; *_jsc alias dropped per guide
// ──────────────────────────────────────────────────────────────────────────

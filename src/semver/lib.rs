// These are all extern so they can't be top-level structs.
// TODO(b0): semver_string::String arrives from move-in (was bun_install_types::semver_string)
pub use crate::semver_string::String;
// TODO(b0): external_string::ExternalString arrives from move-in (was bun_install_types::external_string)
pub use crate::external_string::ExternalString;
pub use crate::version::Version;
pub use crate::version::VersionType;

// TODO(b0): sliced_string::SlicedString arrives from move-in (was bun_install_types::sliced_string)
pub use crate::sliced_string::SlicedString;
pub use crate::semver_range::SemverRange as Range;
pub use crate::semver_query::SemverQuery as Query;
// PORT NOTE: `SemverObject` re-export from `../semver_jsc/` deleted — *_jsc
// extension traits live in the `bun_semver_jsc` crate, not here.

pub mod version;
pub mod semver_range;
pub mod semver_query;

// TODO(b0): these three modules arrive from move-in (MOVE_DOWN bun_install_types → semver).
// The move-in pass adds sliced_string.rs / external_string.rs / semver_string.rs here.
pub mod sliced_string;
pub mod external_string;
pub mod semver_string;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/semver/semver.zig (10 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; *_jsc alias dropped per guide
// ──────────────────────────────────────────────────────────────────────────

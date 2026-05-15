#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
#![warn(unreachable_pub)]
pub mod NodeLinker;
pub mod resolver_hooks;

pub use resolver_hooks::{
    Architecture, AutoInstaller, Behavior, Dependency, DependencyGroup, DependencyID,
    DependencySlice, DependencyVersion, DependencyVersionTag, DependencyVersionValue,
    EnqueueResult, ExternalPackageNameHashList, ExternalSlice, ExternalStringList,
    ExternalStringMap, Features, INVALID_DEPENDENCY_ID, INVALID_PACKAGE_ID, Libc, Negatable,
    NegatableEnum, NegatableExt, NpmInfo, OldV2VersionedURL, OperatingSystem, PackageID,
    PackageJsonView, PackageNameHash, PreinstallState, Repository, Resolution, ResolutionSlice,
    ResolutionTag, ResolutionValue, TagInfo, TarballInfo, TaskCallbackContext,
    TruncatedPackageNameHash, URI, VersionSlice, VersionedURL, VersionedURLType, WakeHandler,
};

// ──────────────────────────────────────────────────────────────────────────
// B-2 RECONCILED: Phase-A drafts of ExternalString / SlicedString /
// SemverString duplicated the canonical defs that were MOVE-IN'd to
// `bun_semver` (see src/semver/lib.rs `MOVE-IN` blocks — same .zig ground
// truth). The drafts are dead duplicates; the public surface of this crate
// re-exports the single canonical impl so `install_types::SemverString::*`
// and `bun_semver::string::*` name the same types.
// ──────────────────────────────────────────────────────────────────────────

pub mod ExternalString {
    pub use bun_semver::ExternalString;
    pub(crate) use bun_semver::external_string::*;
}

pub mod SlicedString {
    pub use bun_semver::SlicedString;
    pub(crate) use bun_semver::sliced_string::*;
}

pub mod SemverString {
    // Re-export the full bun_semver string module surface (String, Formatter,
    // Pointer, Builder, etc.) so downstream `install_types::SemverString::*`
    // paths resolve.
    pub use bun_semver::String;
    pub use bun_semver::string::*;
}

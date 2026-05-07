#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod NodeLinker;
pub mod resolver_hooks;

pub use resolver_hooks::{
    Architecture, AutoInstaller, Behavior, Dependency, DependencyGroup, DependencyID,
    DependencySlice, DependencyVersion, DependencyVersionTag, DependencyVersionValue,
    EnqueueResult, ExternalPackageNameHashList, ExternalSlice, ExternalStringList,
    ExternalStringMap, Features, InitAutoInstaller, Libc, Negatable, NegatableEnum, NegatableExt,
    NpmInfo, OldV2VersionedURL, OperatingSystem, PackageID, PackageJsonView, PackageNameHash,
    PreinstallState, Repository, Resolution, ResolutionSlice, ResolutionTag, ResolutionValue,
    TagInfo, TarballInfo, TaskCallbackContext, TruncatedPackageNameHash, VersionSlice,
    VersionedURL, VersionedURLType, WakeHandler, ARCHITECTURE_NAME_MAP, INIT_AUTO_INSTALLER,
    INVALID_DEPENDENCY_ID, INVALID_PACKAGE_ID, LIBC_NAME_MAP, OPERATING_SYSTEM_NAME_MAP, URI,
};

// ──────────────────────────────────────────────────────────────────────────
// B-2 RECONCILED: Phase-A drafts of ExternalString / SlicedString /
// SemverString duplicated the canonical defs that were MOVE-IN'd to
// `bun_semver` (see src/semver/lib.rs `MOVE-IN` blocks — same .zig ground
// truth). The drafts are dead duplicates; the public surface of this crate
// re-exports the single canonical impl so `install_types::SemverString::*`
// and `bun_semver::string::*` name the same types.
// The sibling Phase-A `.rs` draft files are retained on disk for reference
// but are not compiled.
// ──────────────────────────────────────────────────────────────────────────

pub mod ExternalString {
    pub use bun_semver::external_string::*;
    pub use bun_semver::ExternalString;
}

pub mod SlicedString {
    pub use bun_semver::sliced_string::*;
    pub use bun_semver::SlicedString;
}

pub mod SemverString {
    // Re-export the full bun_semver string module surface (String, Formatter,
    // Pointer, Builder, etc.) so downstream `install_types::SemverString::*`
    // paths resolve.
    pub use bun_semver::string::*;
    pub use bun_semver::String;
}

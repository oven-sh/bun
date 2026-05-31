#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
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

// The canonical ExternalString / SlicedString / SemverString definitions live
// in `bun_semver` (see src/semver/lib.rs); this crate re-exports them so
// `install_types::SemverString::*` and `bun_semver::string::*` name the same types.

pub mod ExternalString {
    pub use bun_semver::ExternalString;
}

pub mod SlicedString {
    pub use bun_semver::SlicedString;
}

pub mod SemverString {
    // Re-export the full bun_semver string module surface (String, Formatter,
    // Pointer, Builder, etc.) so downstream `install_types::SemverString::*`
    // paths resolve.
    pub use bun_semver::String;
    pub use bun_semver::string::*;
}

#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod NodeLinker;
pub mod PackageExtensions;
pub mod resolver_hooks;

pub use resolver_hooks::{
    Architecture, AutoInstaller, Behavior, Dependency, DependencyGroup, DependencyID,
    DependencySlice, DependencyVersion, DependencyVersionTag, DependencyVersionValue,
    EnqueueResult, ExternalPackageNameHashList, ExternalSlice, ExternalStringList,
    ExternalStringMap, Features, INVALID_DEPENDENCY_ID, INVALID_PACKAGE_ID, Libc, Negatable,
    NegatableEnum, NegatableExt, NpmInfo, OperatingSystem, PackageID, PackageJsonView,
    PackageNameHash, PreinstallState, Repository, Resolution, ResolutionSlice, ResolutionTag,
    ResolutionValue, TagInfo, TarballInfo, TaskCallbackContext, TruncatedPackageNameHash, URI,
    VersionSlice, VersionedURL, VersionedURLType, WakeHandler,
};

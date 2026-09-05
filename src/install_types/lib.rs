#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod NodeLinker;
pub mod resolver_hooks;

pub use resolver_hooks::{
    AutoInstaller, DependencyGroup, DependencyID, DependencyVersionTag, INVALID_DEPENDENCY_ID,
    INVALID_PACKAGE_ID, PackageID, PackageNameHash, TruncatedPackageNameHash,
};

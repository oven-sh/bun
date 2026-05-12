//! MOVE_DOWN: the canonical `ExternalSlice<T>` and its derived alias types
//! live in `bun_install_types::resolver_hooks` so `bun_resolver` and
//! `bun_install` share ONE nominal type per name. Re-export them under the
//! original `crate::external_slice` / `crate::external` paths.

pub use bun_install_types::resolver_hooks::{
    ExternalPackageNameHashList, ExternalSlice, ExternalStringList, ExternalStringMap, VersionSlice,
};

// ported from: src/install/ExternalSlice.zig

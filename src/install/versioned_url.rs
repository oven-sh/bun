// MOVE_DOWN: `VersionedURLType<I>` (data + buffer-relative methods) now lives
// in `bun_install_types::resolver_hooks` so the `Resolution.Value` union there
// can name a real type. This file is a thin re-export shim so existing
// `crate::versioned_url::*` paths keep resolving.

pub use bun_install_types::resolver_hooks::{OldV2VersionedURL, VersionedURL, VersionedURLType};

// ported from: src/install/versioned_url.zig

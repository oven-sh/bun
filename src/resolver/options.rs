//! Resolver-tier `options` — re-exports of the canonical resolver-input types.
//!
//! Canonical defs live in `bun_options_types::resolve_options`; both the
//! resolver and the bundler re-export them, so `options::X` on either side
//! names the SAME nominal type. `bun_bundler::options::BundleOptions` is the
//! ~200-field CLI/config aggregate;
//! `bun_bundler::transpiler::resolver_bundle_options_subset` projects it into
//! the canonical struct for `Resolver::init1`.

pub use crate::tsconfig_json::options::jsx;
pub(crate) use bun_ast::{Loader, Target};
pub use bun_options_types::bundle_enums::ModuleType;

/// Re-export the real set type so `bun_bundler` can project user-supplied
/// `--external` `abs_paths`/`node_modules` through. The previous local ZST
/// stub returned `count() == 0` / `contains(..) == false`, so the resolver
/// silently ignored every `--external` absolute path / package name.
pub use bun_collections::StringSet;

pub use bun_options_types::owned_string_list;

// B-3 UNIFIED: FORWARD_DECL dropped — canonical type moved down to
// `bun_options_types::bundle_enums::ForceNodeEnv`. Re-exported so the
// `options::ForceNodeEnv` / `bundle_options::ForceNodeEnv` paths and the
// field on the local `BundleOptions` subset stay source-compatible.
pub use ::bun_options_types::ForceNodeEnv;

pub use bun_options_types::bake::Framework;
pub use bun_options_types::resolve_options::{
    BundleOptions, Conditions, ConditionsMap, ExtOrder, ExtensionOrder, ExtensionOrderGroup,
    ExternalModules, Packages, WildcardPattern,
};

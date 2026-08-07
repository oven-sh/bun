//! `[install]` configuration collected from `bunfig.toml` and `.npmrc`.

use bun_url::URL;

use bun_install_types::NodeLinker::{NodeLinker, PnpmMatcher};

#[derive(Clone, Debug, Default)]
pub struct NpmRegistry {
    pub url: Box<[u8]>,
    pub username: Box<[u8]>,
    pub password: Box<[u8]>,
    pub token: Box<[u8]>,
    pub email: Box<[u8]>,
}

impl NpmRegistry {
    /// Splits credentials embedded in a registry URL (`https://user:pass@host/`
    /// or `https://:token@host/`) out into their own fields.
    pub fn from_url(url: &[u8]) -> NpmRegistry {
        let url = URL::parse(url);
        let mut registry = NpmRegistry::default();

        if url.username.is_empty() && !url.password.is_empty() {
            registry.token = Box::from(url.password);
            registry.url = url.href_without_auth();
        } else if !url.username.is_empty() && !url.password.is_empty() {
            registry.username = Box::from(url.username);
            registry.password = Box::from(url.password);
            registry.url = url.href_without_auth();
        } else {
            // Do not include a trailing slash. There might be parameters at the end.
            registry.url = Box::from(url.href);
        }

        registry
    }
}

/// Per-scope npm registry overrides, keyed by scope name.
#[derive(Default)]
pub struct NpmRegistryMap {
    pub scopes: bun_collections::StringArrayHashMap<NpmRegistry>,
}

/// Value of `BunInstall.ca`.
#[derive(Clone, Debug)]
pub enum Ca {
    Str(Box<[u8]>),
    List(Box<[Box<[u8]>]>),
}

#[derive(Default)]
pub struct BunInstall {
    pub default_registry: Option<NpmRegistry>,
    pub scoped: Option<NpmRegistryMap>,
    pub cache_directory: Option<Box<[u8]>>,
    pub dry_run: Option<bool>,
    pub force: Option<bool>,
    pub save_dev: Option<bool>,
    pub save_optional: Option<bool>,
    pub save_peer: Option<bool>,
    pub save_lockfile: Option<bool>,
    pub production: Option<bool>,
    pub save_yarn_lockfile: Option<bool>,
    pub disable_cache: Option<bool>,
    pub disable_manifest_cache: Option<bool>,
    pub global_dir: Option<Box<[u8]>>,
    pub global_bin_dir: Option<Box<[u8]>>,
    pub frozen_lockfile: Option<bool>,
    pub exact: Option<bool>,
    pub concurrent_scripts: Option<u32>,
    pub cafile: Option<Box<[u8]>>,
    pub save_text_lockfile: Option<bool>,
    pub ca: Option<Ca>,
    pub ignore_scripts: Option<bool>,
    pub link_workspace_packages: Option<bool>,
    pub node_linker: Option<NodeLinker>,
    pub global_store: Option<bool>,
    pub security_scanner: Option<Box<[u8]>>,
    pub minimum_release_age_ms: Option<f64>,
    pub minimum_release_age_excludes: Option<Vec<Box<[u8]>>>,
    pub public_hoist_pattern: Option<PnpmMatcher>,
    pub hoist_pattern: Option<PnpmMatcher>,
    pub hoist: Option<bool>,
}

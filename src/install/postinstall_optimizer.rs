use std::sync::LazyLock;

use bun_collections::{ArrayHashMap, ArrayIdentityContextU64};
// `Expr` here is the T2 `bun_ast::Expr` (re-exported via
// `crate::bun_json`), not the T4 `bun_ast::Expr`. The sole caller
// (`lockfile::Package::parse_with_json`) holds a JSON-parsed `bun_json::Expr`,
// so binding to the lower-tier type avoids a cross-tier mismatch.
use bun_ast as js_ast;
use bun_semver as semver;

use crate::lockfile::package::Meta;
use crate::lockfile::tree::Id as TreeId;
use crate::npm;
use crate::{PackageID, PackageNameHash};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PostinstallOptimizer {
    NativeBinlink,
    Ignore,
}

// `string_hash` is `Wyhash11` (not `const fn`; only the std-Wyhash final4
// variant has a const implementation), so this is a `LazyLock` rather than a
// `const` array.
static DEFAULT_NATIVE_BINLINKS_NAME_HASHES: LazyLock<[PackageNameHash; 2]> = LazyLock::new(|| {
    [
        semver::string::Builder::string_hash(b"esbuild"),
        semver::string::Builder::string_hash(b"@anthropic-ai/claude-code"),
    ]
});

struct DefaultIgnore {
    name_hash: PackageNameHash,
    minimum_version: semver::Version,
}

// `Version::parse_utf8` is not `const fn`, so this is a `LazyLock`.
static DEFAULT_IGNORE: LazyLock<[DefaultIgnore; 1]> = LazyLock::new(|| {
    [DefaultIgnore {
        name_hash: semver::string::Builder::string_hash(b"sharp"),
        minimum_version: semver::Version::parse_utf8(b"0.33.0").version.min(),
    }]
});

impl PostinstallOptimizer {
    fn from_string_array_group(
        list: &mut List,
        expr: &js_ast::Expr,
        value: PostinstallOptimizer,
    ) -> Result<bool, bun_alloc::AllocError> {
        let Some(mut array) = expr.as_array() else {
            return Ok(false);
        };

        while let Some(entry) = array.next() {
            let js_ast::ExprData::EString(s) = &entry.data else {
                continue;
            };
            debug_assert!(s.next.is_none());
            debug_assert!(s.is_utf8());
            let str = s.slice8();
            if str.is_empty() {
                continue;
            }
            list.dynamic
                .put(semver::string::Builder::string_hash(str), value)?;
        }

        Ok(true)
    }

    pub(crate) fn from_package_json(
        list: &mut List,
        expr: &js_ast::Expr,
    ) -> Result<(), bun_alloc::AllocError> {
        if let Some(native_deps_expr) = expr.get(b"nativeDependencies") {
            list.disable_default_native_binlinks = Self::from_string_array_group(
                list,
                &native_deps_expr,
                PostinstallOptimizer::NativeBinlink,
            )?;
        }
        if let Some(ignored_scripts_expr) = expr.get(b"ignoreScripts") {
            list.disable_default_ignore = Self::from_string_array_group(
                list,
                &ignored_scripts_expr,
                PostinstallOptimizer::Ignore,
            )?;
        }
        Ok(())
    }

    pub(crate) fn get_native_binlink_replacement_package_id(
        resolutions: &[PackageID],
        metas: &[Meta],
        target_cpu: npm::Architecture,
        target_os: npm::OperatingSystem,
    ) -> Option<PackageID> {
        // Windows needs file extensions.
        // Wrap the raw bit in the newtype since `WIN32` is exported as the
        // underlying `u16` repr, not `Self`.
        if target_os.is_match(npm::OperatingSystem(npm::OperatingSystem::WIN32)) {
            return None;
        }

        // Loop through the list of optional dependencies with platform-specific constraints
        // Find a matching target-specific dependency.
        for &resolution in resolutions {
            if (resolution as usize) >= metas.len() {
                continue;
            }
            let meta: &Meta = &metas[resolution as usize];
            if meta.arch == npm::Architecture::ALL || meta.os == npm::OperatingSystem::ALL {
                continue;
            }
            if meta.arch.is_match(target_cpu) && meta.os.is_match(target_os) {
                return Some(resolution);
            }
        }

        None
    }
}

// The key is already a hash, so use the identity context rather than
// re-hashing it.
pub type Map = ArrayHashMap<PackageNameHash, PostinstallOptimizer, ArrayIdentityContextU64>;

#[derive(Default)]
pub struct List {
    pub(crate) dynamic: Map,
    pub(crate) disable_default_native_binlinks: bool,
    pub(crate) disable_default_ignore: bool,
}

#[derive(Clone, Copy)]
pub struct PkgInfo<'a> {
    pub(crate) name_hash: PackageNameHash,
    pub(crate) version: Option<semver::Version>,
    // Borrows the lockfile string buffer at call sites; only used to resolve
    // pre/build tags inside `Version::order`, never stored.
    pub(crate) version_buf: &'a [u8],
}

impl Default for PkgInfo<'_> {
    fn default() -> Self {
        Self {
            name_hash: 0,
            version: None,
            version_buf: b"",
        }
    }
}

impl List {
    pub(crate) fn is_native_binlink_enabled(&self) -> bool {
        if self.dynamic.len() == 0 {
            if self.disable_default_native_binlinks {
                return true;
            }
        }

        // The feature flag defaults to false; `env_var` returns `Option<bool>`,
        // so unwrap_or(false) preserves the default.
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER
            .get()
            .unwrap_or(false)
        {
            return false;
        }

        true
    }

    pub(crate) fn should_ignore_lifecycle_scripts(
        &self,
        pkg_info: &PkgInfo<'_>,
        resolutions: &[PackageID],
        metas: &[Meta],
        target_cpu: npm::Architecture,
        target_os: npm::OperatingSystem,
        tree_id: Option<TreeId>,
    ) -> bool {
        // The feature flag defaults to false; see note on the binlinker flag above.
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS
            .get()
            .unwrap_or(false)
        {
            return false;
        }

        let Some(mode) = self.get(pkg_info) else {
            return false;
        };

        match mode {
            PostinstallOptimizer::NativeBinlink => {
                // TODO: support hoisted.
                (tree_id.is_none() || tree_id.unwrap() == 0)

                    // It's not as simple as checking `get(name_hash) != null` because if the
                    // specific versions of the package do not have optional
                    // dependencies then we cannot do this optimization without
                    // breaking the code.
                    //
                    // This shows up in test/integration/esbuild/esbuild.test.ts
                    && PostinstallOptimizer::get_native_binlink_replacement_package_id(
                        resolutions,
                        metas,
                        target_cpu,
                        target_os,
                    )
                    .is_some()
            }

            PostinstallOptimizer::Ignore => true,
        }
    }

    fn from_default(pkg_info: &PkgInfo<'_>) -> Option<PostinstallOptimizer> {
        for &hash in DEFAULT_NATIVE_BINLINKS_NAME_HASHES.iter() {
            if hash == pkg_info.name_hash {
                return Some(PostinstallOptimizer::NativeBinlink);
            }
        }
        for default in DEFAULT_IGNORE.iter() {
            if default.name_hash == pkg_info.name_hash {
                if let Some(version) = pkg_info.version {
                    if version.order(
                        default.minimum_version,
                        pkg_info.version_buf,
                        // minimum version doesn't need a string_buf because
                        // it doesn't use pre/build tags
                        b"",
                    ) == core::cmp::Ordering::Less
                    {
                        return None;
                    }
                }
                return Some(PostinstallOptimizer::Ignore);
            }
        }
        None
    }

    pub(crate) fn get(&self, pkg_info: &PkgInfo<'_>) -> Option<PostinstallOptimizer> {
        if let Some(optimize) = self.dynamic.get(&pkg_info.name_hash) {
            return Some(*optimize);
        }

        let default = Self::from_default(pkg_info)?;

        match default {
            PostinstallOptimizer::NativeBinlink => {
                if !self.disable_default_native_binlinks {
                    return Some(PostinstallOptimizer::NativeBinlink);
                }
            }
            PostinstallOptimizer::Ignore => {
                if !self.disable_default_ignore {
                    return Some(PostinstallOptimizer::Ignore);
                }
            }
        }

        None
    }
}

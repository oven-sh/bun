use crate::lockfile::package::PackageColumns as _;

use bun_core::Output;
use bun_core::strings;
use bun_semver as semver;

use crate::dependency;
use crate::lockfile::{DependencyIDSlice, DependencySlice};
use crate::npm;
use crate::resolution::Tag as ResolutionTag;
use crate::{
    DependencyID, GetJsonResult, PackageID, PackageNameHash, Resolution, invalid_package_id,
};

use super::PackageManager;
use super::add_remove_with_filter::root_package_json_path;
use super::options::LogLevel;

impl PackageManager {
    pub(crate) fn format_later_version_in_cache(
        &mut self,
        package_name: &[u8],
        name_hash: PackageNameHash,
        resolution: &Resolution,
    ) -> Option<semver::version::Formatter<'_, u64>> {
        match resolution.tag {
            ResolutionTag::Npm => {
                let npm_version = resolution.npm().version;
                if npm_version.tag.has_pre() {
                    // TODO:
                    return None;
                }

                // reshaped for borrowck —
                // `this.manifests.byNameHash(this, …, .load_from_memory, …)`
                // would require simultaneous `&mut self.manifests`
                // (receiver) and `&mut self` (arg). The memory-only path touches
                // nothing on `PackageManager` besides the map, so use the
                // disjoint-borrow helper and read `self.options` / `self.lockfile`
                // alongside the held `&mut self.manifests` field borrow.
                let manifest = self
                    .manifests
                    .by_name_hash_in_memory(package_name, name_hash)?;

                if let Some(latest_version) = manifest
                    .find_by_dist_tag_with_filter(
                        b"latest",
                        self.options.minimum_release_age_ms,
                        self.options.minimum_release_age_excludes,
                    )
                    .unwrap()
                {
                    if latest_version.version.order(
                        npm_version,
                        &manifest.string_buf,
                        self.lockfile.buffers.string_bytes.as_slice(),
                    ) != core::cmp::Ordering::Greater
                    {
                        return None;
                    }
                    return Some(latest_version.version.fmt(&manifest.string_buf));
                }

                None
            }
            _ => None,
        }
    }

    pub fn scope_for_package_name(&self, name: &[u8]) -> &npm::registry::Scope {
        self.options.scope_for_package_name(name)
    }

    pub(crate) fn assign_resolution(&mut self, dependency_id: DependencyID, package_id: PackageID) {
        // reshaped for borrowck — capture lengths before mutable borrows.
        debug_assert!(
            (dependency_id as usize) < self.lockfile.buffers.resolutions.as_slice().len()
        );
        debug_assert!((package_id as usize) < self.lockfile.packages.len());
        // debug_assert!(self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize] == invalid_package_id);
        self.lockfile.take_refreshing(dependency_id);
        let buffers = &mut self.lockfile.buffers;
        buffers.resolutions.as_mut_slice()[dependency_id as usize] = package_id;
        let string_buf = buffers.string_bytes.as_slice();
        let dep = &mut buffers.dependencies.as_mut_slice()[dependency_id as usize];
        if dep.name.is_empty()
            || dep.name.slice(string_buf) == dep.version.literal.slice(string_buf)
        {
            dep.name = self.lockfile.packages.items_name()[package_id as usize];
            dep.name_hash = self.lockfile.packages.items_name_hash()[package_id as usize];
        }
    }

    pub(crate) fn assign_root_resolution(
        &mut self,
        dependency_id: DependencyID,
        package_id: PackageID,
    ) {
        // reshaped for borrowck — capture lengths before mutable borrows.
        debug_assert!(
            (dependency_id as usize) < self.lockfile.buffers.resolutions.as_slice().len()
        );
        debug_assert!((package_id as usize) < self.lockfile.packages.len());
        debug_assert!(
            self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize]
                == invalid_package_id
        );
        let buffers = &mut self.lockfile.buffers;
        buffers.resolutions.as_mut_slice()[dependency_id as usize] = package_id;
        let string_buf = buffers.string_bytes.as_slice();
        let dep = &mut buffers.dependencies.as_mut_slice()[dependency_id as usize];
        if dep.name.is_empty()
            || dep.name.slice(string_buf) == dep.version.literal.slice(string_buf)
        {
            dep.name = self.lockfile.packages.items_name()[package_id as usize];
            dep.name_hash = self.lockfile.packages.items_name_hash()[package_id as usize];
        }
    }

    pub(crate) fn verify_resolutions(&mut self, log_level: LogLevel) {
        let lockfile = &self.lockfile;
        let resolutions_lists: &[DependencyIDSlice] = lockfile.packages.items_resolutions();
        let dependency_lists: &[DependencySlice] = lockfile.packages.items_dependencies();
        let pkg_resolutions = lockfile.packages.items_resolution();
        let dependencies_buffer = lockfile.buffers.dependencies.as_slice();
        let resolutions_buffer = lockfile.buffers.resolutions.as_slice();
        let end: PackageID = lockfile.packages.len() as PackageID;

        let mut any_failed = false;
        // Read for the first `catalog:` row without an entry.
        let mut root_has_workspaces: Option<bool> = None;
        let string_buf = lockfile.buffers.string_bytes.as_slice();

        debug_assert_eq!(resolutions_lists.len(), dependency_lists.len());
        for (parent_id, (resolution_list, dependency_list)) in resolutions_lists
            .iter()
            .zip(dependency_lists.iter())
            .enumerate()
        {
            let res_slice = resolution_list.get(resolutions_buffer);
            let dep_slice = dependency_list.get(dependencies_buffer);
            debug_assert_eq!(res_slice.len(), dep_slice.len());
            for (package_id, failed_dep) in res_slice.iter().copied().zip(dep_slice.iter()) {
                if package_id < end {
                    continue;
                }

                // Unmet peers only warn (`warn_unmet_peer_dependency`).
                if failed_dep.behavior.is_peer() {
                    continue;
                }

                let features = (self.options).dependency_features(pkg_resolutions[parent_id].tag);
                // even if optional dependencies are enabled, it's still allowed to fail
                if failed_dep.behavior.is_optional() || !failed_dep.behavior.is_enabled(features) {
                    continue;
                }

                if log_level != LogLevel::Silent {
                    if !any_failed {
                        Output::flush();
                    }
                    // A row whose entry exists failed on the entry's version, not on the catalog.
                    let missing_entry = failed_dep.version.tag == dependency::Tag::Catalog
                        && lockfile
                            .catalogs
                            .get_ref(string_buf, *failed_dep.version.catalog(), failed_dep.name)
                            .is_none();
                    if missing_entry && root_has_workspaces.is_none() {
                        let log = self.log_mut();
                        root_has_workspaces = Some(
                            match self.workspace_package_json_cache.get_with_path(
                                log,
                                &root_package_json_path(),
                                Default::default(),
                            ) {
                                GetJsonResult::Entry(entry) => {
                                    entry.root.get(b"workspaces").is_some()
                                }
                                _ => true,
                            },
                        );
                    }
                    if missing_entry && root_has_workspaces == Some(true) {
                        // `bun add --catalog` refuses the name of the root and of a workspace.
                        let can_add = failed_dep.name_hash
                            != lockfile.packages.items_name_hash()[0]
                            && !lockfile.workspace_paths.contains(&failed_dep.name_hash);
                        let name = bstr::BStr::new(failed_dep.name.slice(string_buf));
                        let literal =
                            bun_core::fmt::for_terminal(failed_dep.version.literal.fmt(string_buf));
                        let catalog_name = failed_dep.version.catalog().slice(string_buf);
                        let is_default = catalog_name.is_empty() || catalog_name == b"default";
                        let catalog_exists = is_default
                            || lockfile
                                .catalogs
                                .groups
                                .keys()
                                .iter()
                                .any(|k| k.slice(string_buf) == catalog_name);
                        if !catalog_exists {
                            Output::err_generic(
                                "<b>{}@{}<r>: there is no catalog named \"{}\" in the root package.json",
                                (
                                    name,
                                    literal,
                                    bun_core::fmt::for_terminal(bstr::BStr::new(catalog_name)),
                                ),
                            );
                        } else if is_default {
                            Output::err_generic("<b>{}@{}<r> not in catalog", (name, literal));
                            if can_add {
                                bun_core::pretty_errorln!("  bun add --catalog {}", name);
                            }
                        } else {
                            Output::err_generic(
                                "<b>{}@{}<r> not in catalog \"{}\"",
                                (name, literal, bstr::BStr::new(catalog_name)),
                            );
                            if can_add {
                                bun_core::pretty_errorln!(
                                    "  bun add --catalog={} {}",
                                    bstr::BStr::new(catalog_name),
                                    name
                                );
                            }
                        }
                    } else if failed_dep.name.is_empty()
                        || strings::eql_long(
                            failed_dep.name.slice(string_buf),
                            failed_dep.version.literal.slice(string_buf),
                            true,
                        )
                    {
                        Output::err_generic(
                            "<b>{}<r><d> failed to resolve<r>",
                            (bun_core::fmt::for_terminal(
                                failed_dep.version.literal.fmt(string_buf),
                            ),),
                        );
                    } else {
                        Output::err_generic(
                            "<b>{}<r><d>@<b>{}<r><d> failed to resolve<r>",
                            (
                                bun_core::fmt::for_terminal(bstr::BStr::new(
                                    failed_dep.name.slice(string_buf),
                                )),
                                bun_core::fmt::for_terminal(
                                    failed_dep.version.literal.fmt(string_buf),
                                ),
                            ),
                        );
                    }
                }
                // track this so we can log each failure instead of just the first
                any_failed = true;
            }
        }

        if any_failed {
            if root_has_workspaces == Some(false) {
                bun_core::note!(
                    "catalogs require a \"workspaces\" field in the root package.json. {} was used as root and has none",
                    bun_core::fmt::quote(&root_package_json_path()),
                );
            }
            self.crash();
        }
    }
}

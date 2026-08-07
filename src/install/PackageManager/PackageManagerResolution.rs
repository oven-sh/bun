use crate::lockfile::package::PackageColumns as _;
use core::mem::ManuallyDrop;

use bun_core::Output;
use bun_core::strings;
use bun_paths::PathBuffer;
use bun_semver as semver;
use bun_semver::{SlicedString, String as SemverString};

use crate::_folder_resolver::{self as folder_resolver, GlobalOrRelative};
use crate::dependency;
use crate::lockfile::{DependencyIDSlice, DependencySlice};
use crate::npm;
use crate::resolution::Tag as ResolutionTag;
use crate::{DependencyID, PackageID, PackageNameHash, Resolution, invalid_package_id};

use super::PackageManager;
use super::options::LogLevel;

// ──────────────────────────────────────────────────────────────────────────
// Free-function re-export surface. Thin shims over the
// `impl PackageManager` bodies below so `pub use resolution::{...}` in
// `PackageManager.rs` resolves (matching the directories/enqueue pattern).
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn resolve_from_disk_cache(
    this: &mut PackageManager,
    package_name: &[u8],
    version: &dependency::Version,
    version_buf: &[u8],
) -> Option<PackageID> {
    this.resolve_from_disk_cache(package_name, version, version_buf)
}

#[inline]
pub fn assign_root_resolution(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
) {
    this.assign_root_resolution(dependency_id, package_id)
}

impl PackageManager {
    pub(crate) fn format_later_version_in_cache(
        &mut self,
        package_name: &[u8],
        name_hash: PackageNameHash,
        resolution: &Resolution,
    ) -> Option<semver::version::Formatter<'_, u64>> {
        // The `.load_from_memory` arm never reads scope; keep the param for
        // signature parity.
        let _ = package_name;
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
                let manifest = self.manifests.by_name_hash_in_memory(name_hash)?;

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

    pub(crate) fn get_installed_versions_from_disk_cache(
        &mut self,
        package_name: &[u8],
    ) -> crate::Result<Vec<semver::Version>> {
        let mut list: Vec<semver::Version> = Vec::new();
        let cache_dir = super::get_cache_directory(self);
        let dir = match bun_sys::Dir::borrow(&cache_dir)
            .open_at(package_name)
            .map_err(crate::Error::from)
        {
            Ok(d) => d,
            Err(
                crate::Error::Sys(bun_errno::SystemErrno::ENOENT)
                | crate::Error::Sys(bun_errno::SystemErrno::ENOTDIR)
                | crate::Error::Sys(bun_errno::SystemErrno::EACCES)
                | crate::Error::DeviceBusy,
            ) => {
                return Ok(list);
            }
            Err(e) => return Err(e),
        };
        let mut iter = bun_sys::iterate_dir(dir.fd);

        loop {
            let entry = match iter.next() {
                Ok(Some(e)) => e,
                Ok(None) => break,
                Err(e) => {
                    return Err(e.into());
                }
            };
            if entry.kind != bun_sys::EntryKind::Directory
                && entry.kind != bun_sys::EntryKind::SymLink
            {
                continue;
            }
            let name: &[u8] = entry.name.slice_u8();
            // Entry names carry `@@<registry host>` / `@@@<cache version>`
            // suffixes after the version; trim them before parsing.
            let name = &name[..strings::index_of(name, b"@@").unwrap_or(name.len())];
            let sliced = SlicedString::init(name, name);
            let parsed = semver::Version::parse(sliced);
            if !parsed.valid || parsed.wildcard != semver::query::Wildcard::None {
                continue;
            }
            let version = parsed.version.min();
            // Pre/build tags are stored as wyhash hex in entry names and
            // cannot be mapped back to a cache path, so only stable versions
            // are resolvable offline.
            if version.tag.has_pre() || version.tag.has_build() {
                continue;
            }
            list.push(version);
        }

        Ok(list)
    }

    pub(crate) fn resolve_from_disk_cache(
        &mut self,
        package_name: &[u8],
        version: &dependency::Version,
        version_buf: &[u8],
    ) -> Option<PackageID> {
        match version.tag {
            dependency::Tag::Npm => {}
            // Offline, "latest" means the newest stable cached version.
            dependency::Tag::DistTag if version.dist_tag().tag.slice(version_buf) == b"latest" => {}
            _ => return None,
        }

        let mut installed_versions = match self.get_installed_versions_from_disk_cache(package_name)
        {
            Ok(v) => v,
            Err(err) => {
                bun_core::debug!(
                    "error getting installed versions from disk cache: {}",
                    err.name()
                );
                return None;
            }
        };

        // Sort descending via the total-order helper (`b.order(a)`); a plain
        // Less/Greater closure is not antisymmetric and may panic since 1.81.
        // Entries are stable-only, so no string buffer is needed.
        installed_versions.sort_by(|a, b| semver::Version::order_fn(&[], *b, *a));
        let npm_query = version.try_npm();
        for installed_version in installed_versions.iter().copied() {
            let matches = match npm_query {
                // The query's pre/build tags were parsed against `version_buf`,
                // not the lockfile's string bytes.
                Some(npm) => npm.version.satisfies(installed_version, version_buf, &[]),
                // Sorted descending: the first entry is the newest stable.
                None => true,
            };
            if matches {
                let mut buf = PathBuffer::uninit();
                let npm_package_path = match super::path_for_cached_npm_path(
                    self,
                    &mut buf,
                    package_name,
                    installed_version,
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        // Stale or foreign-registry index entries reconstruct
                        // to a path that no longer exists; try the next one.
                        bun_core::debug!("error getting path for cached npm path: {}", err.name());
                        continue;
                    }
                };
                let dep_version = dependency::Version {
                    tag: dependency::Tag::Npm,
                    literal: SemverString::default(),
                    value: dependency::Value {
                        npm: ManuallyDrop::new(dependency::NpmInfo {
                            name: SemverString::init(package_name, package_name),
                            version: semver::query::Group::from(installed_version),
                            is_alias: false,
                        }),
                    },
                };
                match folder_resolver::get_or_put(
                    GlobalOrRelative::CacheFolder(npm_package_path),
                    &dep_version,
                    b".",
                    self,
                ) {
                    folder_resolver::FolderResolution::NewPackageId(id) => {
                        let deps = self.lockfile.packages.items_dependencies()[id as usize];
                        super::enqueue_dependency_list(self, deps);
                        return Some(id);
                    }
                    folder_resolver::FolderResolution::PackageId(id) => {
                        let deps = self.lockfile.packages.items_dependencies()[id as usize];
                        super::enqueue_dependency_list(self, deps);
                        return Some(id);
                    }
                    folder_resolver::FolderResolution::Err(err) => {
                        bun_core::debug!(
                            "error getting or putting folder resolution: {}",
                            err.name()
                        );
                        continue;
                    }
                }
            }
        }

        None
    }

    pub(crate) fn assign_resolution(&mut self, dependency_id: DependencyID, package_id: PackageID) {
        // reshaped for borrowck — capture lengths before mutable borrows.
        debug_assert!(
            (dependency_id as usize) < self.lockfile.buffers.resolutions.as_slice().len()
        );
        debug_assert!((package_id as usize) < self.lockfile.packages.len());
        // debug_assert!(self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize] == invalid_package_id);
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

                // TODO lockfile rewrite: remove this and make non-optional peer dependencies error if they did not resolve.
                //      Need to keep this for now because old lockfiles might have a peer dependency without the optional flag set.
                if failed_dep.behavior.is_peer() {
                    continue;
                }

                let features = match pkg_resolutions[parent_id].tag {
                    ResolutionTag::Root | ResolutionTag::Workspace | ResolutionTag::Folder => {
                        self.options.local_package_features
                    }
                    _ => self.options.remote_package_features,
                };
                // even if optional dependencies are enabled, it's still allowed to fail
                if failed_dep.behavior.is_optional() || !failed_dep.behavior.is_enabled(features) {
                    continue;
                }

                if log_level != LogLevel::Silent {
                    if failed_dep.name.is_empty()
                        || strings::eql_long(
                            failed_dep.name.slice(string_buf),
                            failed_dep.version.literal.slice(string_buf),
                            true,
                        )
                    {
                        Output::err_generic(
                            "<b>{}<r><d> failed to resolve<r>",
                            (failed_dep.version.literal.fmt(string_buf),),
                        );
                    } else {
                        Output::err_generic(
                            "<b>{}<r><d>@<b>{}<r><d> failed to resolve<r>",
                            (
                                bstr::BStr::new(failed_dep.name.slice(string_buf)),
                                failed_dep.version.literal.fmt(string_buf),
                            ),
                        );
                    }
                }
                // track this so we can log each failure instead of just the first
                any_failed = true;
            }
        }

        if any_failed {
            self.crash();
        }
    }
}

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
// Free-function re-export surface — Zig declares these at file scope with an
// explicit `*PackageManager` first param. Thin shims over the
// `impl PackageManager` bodies below so `pub use resolution::{...}` in
// `PackageManager.rs` resolves (matching the directories/enqueue pattern).
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn format_later_version_in_cache<'a>(
    this: &'a mut PackageManager,
    package_name: &[u8],
    name_hash: PackageNameHash,
    resolution: Resolution,
) -> Option<semver::version::Formatter<'a, u64>> {
    this.format_later_version_in_cache(package_name, name_hash, resolution)
}

#[inline]
pub fn scope_for_package_name<'a>(
    this: &'a PackageManager,
    name: &[u8],
) -> &'a npm::registry::Scope {
    this.scope_for_package_name(name)
}

#[inline]
pub fn get_installed_versions_from_disk_cache(
    this: &mut PackageManager,
    tags_buf: &mut Vec<u8>,
    package_name: &[u8],
) -> Result<Vec<semver::Version>, bun_core::Error> {
    this.get_installed_versions_from_disk_cache(tags_buf, package_name)
}

#[inline]
pub fn resolve_from_disk_cache(
    this: &mut PackageManager,
    package_name: &[u8],
    version: dependency::Version,
) -> Option<PackageID> {
    this.resolve_from_disk_cache(package_name, version)
}

#[inline]
pub fn assign_resolution(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
) {
    this.assign_resolution(dependency_id, package_id)
}

#[inline]
pub fn assign_root_resolution(
    this: &mut PackageManager,
    dependency_id: DependencyID,
    package_id: PackageID,
) {
    this.assign_root_resolution(dependency_id, package_id)
}

#[inline]
pub fn verify_resolutions(this: &mut PackageManager, log_level: LogLevel) {
    this.verify_resolutions(log_level)
}

impl PackageManager {
    pub fn format_later_version_in_cache(
        &mut self,
        package_name: &[u8],
        name_hash: PackageNameHash,
        resolution: Resolution,
    ) -> Option<semver::version::Formatter<'_, u64>> {
        // Zig forwards `package_name` → `scopeForPackageName` → `byNameHash`,
        // but the `.load_from_memory` arm never reads scope; keep the param for
        // signature parity.
        let _ = package_name;
        match resolution.tag {
            ResolutionTag::Npm => {
                let npm_version = resolution.npm().version;
                if npm_version.tag.has_pre() {
                    // TODO:
                    return None;
                }

                // PORT NOTE: reshaped for borrowck — Zig calls
                // `this.manifests.byNameHash(this, …, .load_from_memory, …)`,
                // which in Rust would require simultaneous `&mut self.manifests`
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

    pub fn get_installed_versions_from_disk_cache(
        &mut self,
        tags_buf: &mut Vec<u8>,
        package_name: &[u8],
    ) -> Result<Vec<semver::Version>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut list: Vec<semver::Version> = Vec::new();
        // Zig: `getCacheDirectory().openDir(package_name, .{ .iterate = true })`.
        let cache_dir = super::get_cache_directory(self);
        let dir = match bun_sys::open_dir(cache_dir, package_name) {
            Ok(d) => d,
            Err(e)
                if e == bun_core::err!("FileNotFound")
                    || e == bun_core::err!("NotDir")
                    || e == bun_core::err!("AccessDenied")
                    || e == bun_core::err!("DeviceBusy") =>
            {
                return Ok(list);
            }
            Err(e) => return Err(e),
        };
        // `defer dir.close()` → explicit close after iteration (Dir has no Drop).
        let mut iter = bun_sys::iterate_dir(dir.fd);

        loop {
            let entry = match iter.next() {
                Ok(Some(e)) => e,
                Ok(None) => break,
                Err(e) => {
                    dir.close();
                    return Err(e.into());
                }
            };
            if entry.kind != bun_sys::EntryKind::Directory
                && entry.kind != bun_sys::EntryKind::SymLink
            {
                continue;
            }
            let name: &[u8] = entry.name.slice_u8();
            let sliced = SlicedString::init(name, name);
            let parsed = semver::Version::parse(sliced);
            if !parsed.valid || parsed.wildcard != semver::query::Wildcard::None {
                continue;
            }
            // not handling OOM
            // TODO: wildcard
            let mut version = parsed.version.min();
            let total = (version.tag.build.len() + version.tag.pre.len()) as usize;
            if total > 0 {
                // PERF(port): was ensureUnusedCapacity — profile in Phase B
                let len_before = tags_buf.len();
                // `clone_into` writes exactly `total` bytes (build.len + pre.len)
                // into `available` and advances it; zero-fill the tail first so
                // we can hand it out as a safe `&mut [u8]` instead of slicing
                // raw spare capacity.
                tags_buf.resize(len_before + total, 0);
                let mut available = &mut tags_buf[len_before..];
                let new_version = version.clone_into(name, &mut available);
                version = new_version;
            }

            list.push(version);
            // PERF(port): was `catch unreachable` on append — Vec::push aborts on OOM
        }

        dir.close();
        Ok(list)
    }

    pub fn resolve_from_disk_cache(
        &mut self,
        package_name: &[u8],
        version: dependency::Version,
    ) -> Option<PackageID> {
        if version.tag != dependency::Tag::Npm {
            // only npm supported right now
            // tags are more ambiguous
            return None;
        }

        // PERF(port): was arena bulk-free (bun.ArenaAllocator + stackFallback(4096)) —
        // profile in Phase B. Allocator params dropped; Vec uses global mimalloc.
        let mut tags_buf: Vec<u8> = Vec::new();
        let mut installed_versions =
            match self.get_installed_versions_from_disk_cache(&mut tags_buf, package_name) {
                Ok(v) => v,
                Err(err) => {
                    Output::debug(format_args!(
                        "error getting installed versions from disk cache: {}",
                        err.name()
                    ));
                    return None;
                }
            };

        // TODO: make this fewer passes
        {
            let tags_slice: &[u8] = tags_buf.as_slice();
            // Zig: `std.sort.pdq(..., sortGt)` — `sortGt` is `order == .gt`, so
            // pdq sorts descending. Use the total-order helper with swapped args
            // (`b.order(a)`) so equal keys yield `Equal`; a two-way Less/Greater
            // closure is not antisymmetric and may panic since Rust 1.81.
            installed_versions.sort_by(|a, b| semver::Version::order_fn(tags_slice, *b, *a));
        }
        let npm_query = version.npm();
        for installed_version in installed_versions.iter().copied() {
            if npm_query.version.satisfies(
                installed_version,
                self.lockfile.buffers.string_bytes.as_slice(),
                tags_buf.as_slice(),
            ) {
                let mut buf = PathBuffer::uninit();
                let npm_package_path = match super::path_for_cached_npm_path(
                    self,
                    &mut buf,
                    package_name,
                    installed_version,
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        Output::debug(format_args!(
                            "error getting path for cached npm path: {}",
                            bun_core::Error::from(err).name()
                        ));
                        return None;
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
                    dep_version,
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
                        Output::debug(format_args!(
                            "error getting or putting folder resolution: {}",
                            err.name()
                        ));
                        return None;
                    }
                }
            }
        }

        None
    }

    pub fn assign_resolution(&mut self, dependency_id: DependencyID, package_id: PackageID) {
        // PORT NOTE: reshaped for borrowck — capture lengths before mutable borrows.
        if cfg!(debug_assertions) {
            debug_assert!(
                (dependency_id as usize) < self.lockfile.buffers.resolutions.as_slice().len()
            );
            debug_assert!((package_id as usize) < self.lockfile.packages.len());
            // debug_assert!(self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize] == invalid_package_id);
        }
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

    pub fn assign_root_resolution(&mut self, dependency_id: DependencyID, package_id: PackageID) {
        // PORT NOTE: reshaped for borrowck — capture lengths before mutable borrows.
        if cfg!(debug_assertions) {
            debug_assert!(
                (dependency_id as usize) < self.lockfile.buffers.resolutions.as_slice().len()
            );
            debug_assert!((package_id as usize) < self.lockfile.packages.len());
            debug_assert!(
                self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize]
                    == invalid_package_id
            );
        }
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

    pub fn verify_resolutions(&mut self, log_level: LogLevel) {
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

// ported from: src/install/PackageManager/PackageManagerResolution.zig

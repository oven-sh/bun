use bun_core::Output;
use bun_paths::PathBuffer;
use bun_semver as semver;
use bun_semver::{SlicedString, String as SemverString};
use bun_str::strings;

use crate::{
    invalid_package_id, Dependency, DependencyID, FolderResolution, Lockfile, Npm, PackageID,
    PackageManager, PackageNameHash, Resolution,
};

impl PackageManager {
    pub fn format_later_version_in_cache(
        &mut self,
        package_name: &[u8],
        name_hash: PackageNameHash,
        resolution: Resolution,
    ) -> Option<semver::version::Formatter> {
        match resolution.tag {
            Resolution::Tag::Npm => {
                if resolution.value.npm.version.tag.has_pre() {
                    // TODO:
                    return None;
                }

                let manifest = self.manifests.by_name_hash(
                    self,
                    self.scope_for_package_name(package_name),
                    name_hash,
                    .load_from_memory,
                    self.options.minimum_release_age_ms.is_some(),
                )?;
                // TODO(port): `.load_from_memory` is a Zig enum literal — replace with the
                // concrete Rust enum path once `manifests::LoadMode` (or equivalent) is ported.

                if let Some(latest_version) = manifest
                    .find_by_dist_tag_with_filter(
                        b"latest",
                        self.options.minimum_release_age_ms,
                        &self.options.minimum_release_age_excludes,
                    )
                    .unwrap_opt()
                {
                    if latest_version.version.order(
                        resolution.value.npm.version,
                        manifest.string_buf,
                        self.lockfile.buffers.string_bytes.as_slice(),
                    ) != core::cmp::Ordering::Greater
                    {
                        return None;
                    }
                    return Some(latest_version.version.fmt(manifest.string_buf));
                }

                None
            }
            _ => None,
        }
    }

    pub fn scope_for_package_name(&self, name: &[u8]) -> &Npm::Registry::Scope {
        if name.is_empty() || name[0] != b'@' {
            return &self.options.scope;
        }
        self.options
            .registries
            .get_ptr(Npm::Registry::Scope::hash(Npm::Registry::Scope::get_name(
                name,
            )))
            .unwrap_or(&self.options.scope)
    }

    pub fn get_installed_versions_from_disk_cache(
        &mut self,
        tags_buf: &mut Vec<u8>,
        package_name: &[u8],
    ) -> Result<Vec<semver::Version>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut list: Vec<semver::Version> = Vec::new();
        // TODO(port): `getCacheDirectory().openDir(...)` uses std.fs in Zig; map to bun_sys
        // directory iteration once the PackageManager cache-dir API is ported.
        let mut dir = match self
            .get_cache_directory()
            .open_dir(package_name, bun_sys::OpenDirOptions { iterate: true })
        {
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
        // `defer dir.close()` → handled by Drop on `dir`.
        let mut iter = dir.iterate();

        while let Some(entry) = iter.next()? {
            if entry.kind != bun_sys::DirEntryKind::Directory
                && entry.kind != bun_sys::DirEntryKind::SymLink
            {
                continue;
            }
            let name: &[u8] = entry.name;
            let sliced = SlicedString::init(name, name);
            let parsed = semver::Version::parse(sliced);
            if !parsed.valid || parsed.wildcard != semver::Wildcard::None {
                continue;
            }
            // not handling OOM
            // TODO: wildcard
            let mut version = parsed.version.min();
            let total = (version.tag.build.len() + version.tag.pre.len()) as usize;
            if total > 0 {
                tags_buf.reserve(total);
                // PERF(port): was ensureUnusedCapacity — profile in Phase B
                let len_before = tags_buf.len();
                // SAFETY: we reserved `total` bytes above; `clone_into` writes at most
                // `total` bytes (build.len + pre.len) into `available` and advances it.
                let mut available = unsafe {
                    core::slice::from_raw_parts_mut(
                        tags_buf.as_mut_ptr().add(len_before),
                        tags_buf.capacity() - len_before,
                    )
                };
                let new_version = version.clone_into(name, &mut available);
                // SAFETY: `clone_into` initialized exactly `total` bytes starting at len_before.
                unsafe { tags_buf.set_len(len_before + total) };
                version = new_version;
            }

            list.push(version);
            // PERF(port): was `catch unreachable` on append — Vec::push aborts on OOM
        }

        Ok(list)
    }

    pub fn resolve_from_disk_cache(
        &mut self,
        package_name: &[u8],
        version: Dependency::Version,
    ) -> Option<PackageID> {
        if version.tag != Dependency::Version::Tag::Npm {
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
            installed_versions.sort_by(|a, b| {
                // Zig std.sort.pdq with `sortGt` comparator (returns true if a > b) ⇒ descending.
                if semver::Version::sort_gt(tags_slice, *a, *b) {
                    core::cmp::Ordering::Less
                } else {
                    core::cmp::Ordering::Greater
                }
            });
            // TODO(port): verify sort_gt signature/ordering matches Semver.Version.sortGt exactly.
        }
        for installed_version in installed_versions.iter().copied() {
            if version.value.npm.version.satisfies(
                installed_version,
                self.lockfile.buffers.string_bytes.as_slice(),
                tags_buf.as_slice(),
            ) {
                let mut buf = PathBuffer::uninit();
                let npm_package_path =
                    match self.path_for_cached_npm_path(&mut buf, package_name, installed_version) {
                        Ok(p) => p,
                        Err(err) => {
                            Output::debug(format_args!(
                                "error getting path for cached npm path: {}",
                                err.name()
                            ));
                            return None;
                        }
                    };
                let dependency = Dependency::Version {
                    tag: Dependency::Version::Tag::Npm,
                    value: Dependency::Version::Value {
                        npm: Dependency::NpmInfo {
                            name: SemverString::init(package_name, package_name),
                            version: semver::Query::Group::from(installed_version),
                        },
                    },
                };
                match FolderResolution::get_or_put(
                    FolderResolution::Key::CacheFolder(npm_package_path),
                    dependency,
                    b".",
                    self,
                ) {
                    FolderResolution::Result::NewPackageId(id) => {
                        self.enqueue_dependency_list(
                            self.lockfile.packages.items_dependencies()[id as usize],
                        );
                        return Some(id);
                    }
                    FolderResolution::Result::PackageId(id) => {
                        self.enqueue_dependency_list(
                            self.lockfile.packages.items_dependencies()[id as usize],
                        );
                        return Some(id);
                    }
                    FolderResolution::Result::Err(err) => {
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

    pub fn verify_resolutions(&mut self, log_level: crate::package_manager::Options::LogLevel) {
        let lockfile = &self.lockfile;
        let resolutions_lists: &[Lockfile::DependencyIDSlice] =
            lockfile.packages.items_resolutions();
        let dependency_lists: &[Lockfile::DependencySlice] = lockfile.packages.items_dependencies();
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
                    Resolution::Tag::Root | Resolution::Tag::Workspace | Resolution::Tag::Folder => {
                        self.options.local_package_features
                    }
                    _ => self.options.remote_package_features,
                };
                // even if optional dependencies are enabled, it's still allowed to fail
                if failed_dep.behavior.optional || !failed_dep.behavior.is_enabled(features) {
                    continue;
                }

                if log_level != crate::package_manager::Options::LogLevel::Silent {
                    if failed_dep.name.is_empty()
                        || strings::eql_long(
                            failed_dep.name.slice(string_buf),
                            failed_dep.version.literal.slice(string_buf),
                            true,
                        )
                    {
                        Output::err_generic(format_args!(
                            "<b>{}<r><d> failed to resolve<r>",
                            failed_dep.version.literal.fmt(string_buf),
                        ));
                    } else {
                        Output::err_generic(format_args!(
                            "<b>{}<r><d>@<b>{}<r><d> failed to resolve<r>",
                            bstr::BStr::new(failed_dep.name.slice(string_buf)),
                            failed_dep.version.literal.fmt(string_buf),
                        ));
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/PackageManagerResolution.zig (243 lines)
//   confidence: medium
//   todos:      4
//   notes:      MultiArrayList field accessors (.items(.field)) ported as items_<field>(); FolderResolution/Dependency variant paths and manifests.by_name_hash enum literal need Phase-B fixup; arena/stack-fallback dropped per guide.
// ──────────────────────────────────────────────────────────────────────────

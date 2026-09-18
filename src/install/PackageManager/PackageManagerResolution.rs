use crate::lockfile::package::PackageColumns as _;
use core::mem::ManuallyDrop;

use bun_collections::index_sort;
use bun_core::Output;
use bun_core::strings;
use bun_semver as semver;
use bun_semver::{SlicedString, String as SemverString};

use crate::_folder_resolver::{self as folder_resolver, GlobalOrRelative};
use crate::bun_fs::FileSystem;
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
) -> Option<PackageID> {
    this.resolve_from_disk_cache(package_name, version)
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

    pub(crate) fn get_installed_versions_from_disk_cache(
        &mut self,
        tags_buf: &mut Vec<u8>,
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
                | crate::Error::Sys(bun_errno::SystemErrno::EACCES),
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
                let mut offset = tags_buf.len();
                tags_buf.resize(offset + total, 0);
                version = version.clone_into(name, tags_buf, &mut offset);
            }

            list.push(version);
        }

        Ok(list)
    }

    pub(crate) fn resolve_from_disk_cache(
        &mut self,
        package_name: &[u8],
        version: &dependency::Version,
    ) -> Option<PackageID> {
        if version.tag != dependency::Tag::Npm {
            // only npm supported right now
            // tags are more ambiguous
            return None;
        }

        let mut tags_buf: Vec<u8> = Vec::new();
        let mut installed_versions =
            match self.get_installed_versions_from_disk_cache(&mut tags_buf, package_name) {
                Ok(v) => v,
                Err(err) => {
                    bun_core::debug!(
                        "error getting installed versions from disk cache: {}",
                        err.name()
                    );
                    return None;
                }
            };

        // TODO: make this fewer passes
        {
            let tags_slice: &[u8] = tags_buf.as_slice();
            // Sort descending. Use the total-order helper with swapped args
            // (`b.order(a)`) so equal keys yield `Equal`; a two-way Less/Greater
            // closure is not antisymmetric and may panic since Rust 1.81.
            index_sort::sort_slice_by(&mut installed_versions, |a, b| {
                semver::Version::order_fn(tags_slice, *b, *a)
            });
        }
        let npm_query = version.npm();
        for installed_version in installed_versions.iter().copied() {
            if npm_query.version.satisfies(
                installed_version,
                self.lockfile.buffers.string_bytes.as_slice(),
                tags_buf.as_slice(),
            ) {
                let mut buf = bun_paths::path_buffer_pool::get();
                let npm_package_path = match super::path_for_cached_npm_path(
                    self,
                    &mut buf,
                    package_name,
                    installed_version,
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        bun_core::debug!("error getting path for cached npm path: {}", err.name());
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
                        return None;
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

                // Unmet peers only warn (`warn_unmet_peer_dependency`).
                if failed_dep.behavior.is_peer() {
                    continue;
                }

                let features = if pkg_resolutions[parent_id].tag.is_local_package() {
                    self.options.local_package_features
                } else {
                    self.options.remote_package_features
                };
                // even if optional dependencies are enabled, it's still allowed to fail
                if failed_dep.behavior.is_optional() || !failed_dep.behavior.is_enabled(features) {
                    continue;
                }

                if log_level != LogLevel::Silent {
                    if !any_failed {
                        Output::flush();
                    }
                    if failed_dep.version.tag == dependency::Tag::Catalog {
                        let name = bstr::BStr::new(failed_dep.name.slice(string_buf));
                        let literal = failed_dep.version.literal.fmt(string_buf);
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
                                (name, literal, bstr::BStr::new(catalog_name)),
                            );
                        } else if is_default {
                            Output::err_generic(
                                "<b>{}@{}<r> is not in the catalog",
                                (name, literal),
                            );
                            bun_core::pretty_errorln!("  bun add --catalog {}", name);
                        } else {
                            Output::err_generic(
                                "<b>{}@{}<r> is not in catalog \"{}\"",
                                (name, literal, bstr::BStr::new(catalog_name)),
                            );
                            bun_core::pretty_errorln!(
                                "  bun add --catalog={} {}",
                                bstr::BStr::new(catalog_name),
                                name
                            );
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

    /// A path outside the root receives writes from the linkers and from `bun prune`.
    pub(crate) fn verify_workspaces_inside_root(&mut self, log_level: LogLevel) {
        let lockfile = &self.lockfile;
        let string_buf = lockfile.buffers.string_bytes.as_slice();

        // The isolated linker iterates `workspace_paths`, even a path that never resolved.
        let mut paths: Vec<&[u8]> =
            Vec::with_capacity(lockfile.workspace_paths.count() + lockfile.packages.len());
        for path in lockfile.workspace_paths.values() {
            paths.push(path.slice(string_buf));
        }
        for resolution in lockfile.packages.items_resolution() {
            if resolution.tag == ResolutionTag::Workspace {
                paths.push(resolution.workspace().slice(string_buf));
            }
        }
        index_sort::sort_slice_unstable_by(&mut paths, |a, b| a.cmp(b));
        paths.dedup();

        let top_level_dir = FileSystem::instance().top_level_dir();
        let mut real_root: Option<Box<[u8]>> = None;
        let mut any_outside = false;

        for path in paths {
            let mut real_dir_buf = bun_paths::path_buffer_pool::get();
            let refusal =
                match workspace_containment(&mut real_root, top_level_dir, path, &mut real_dir_buf)
                {
                    Containment::Inside => continue,
                    Containment::Outside(real_dir) => Refusal::Outside(real_dir),
                    Containment::Refused(reason) => Refusal::Refused(reason),
                    Containment::Failed(err) => Refusal::Failed(err),
                };

            if log_level != LogLevel::Silent {
                if !any_outside {
                    Output::flush();
                }
                let path = bstr::BStr::new(path);
                match refusal {
                    Refusal::Outside(real_dir) => Output::err_generic(
                        "workspace <b>\"{}\"<r> is outside the workspace root: it resolves to \"{}\"",
                        (path, bstr::BStr::new(real_dir)),
                    ),
                    Refusal::Refused(reason) => {
                        Output::err_generic("workspace <b>\"{}\"<r> {}", (path, reason))
                    }
                    Refusal::Failed(err) => Output::err(
                        err,
                        "failed to resolve the directory of workspace <b>\"{}\"<r>",
                        (path,),
                    ),
                }
            }
            any_outside = true;
        }

        if any_outside {
            if log_level != LogLevel::Silent {
                bun_core::note!(
                    "to depend on a directory outside the project, declare it as \"file:../that/directory\", or run `bun link` in it"
                );
            }
            self.crash();
        }
    }
}

enum Refusal<'a> {
    Outside(&'a [u8]),
    Refused(&'static str),
    Failed(bun_sys::Error),
}

enum Containment<'a> {
    Inside,
    /// The real path the workspace path resolves to.
    Outside(&'a [u8]),
    Refused(&'static str),
    Failed(bun_sys::Error),
}

fn workspace_containment<'b>(
    real_root: &mut Option<Box<[u8]>>,
    top_level_dir: &[u8],
    workspace_path: &[u8],
    real_dir_buf: &'b mut bun_paths::PathBuffer,
) -> Containment<'b> {
    // `C:..` is drive-relative on Windows: the OS resolves it against that drive's own cwd.
    #[cfg(windows)]
    if matches!(workspace_path, [letter, b':', rest @ ..]
        if bun_paths::is_drive_letter(*letter)
            && !matches!(rest.first(), Some(c) if bun_paths::is_sep_any(*c)))
    {
        return Containment::Refused("names a drive");
    }
    // A `\` is a name byte here and a separator to the path code the linkers use.
    #[cfg(not(windows))]
    if strings::contains_char(workspace_path, b'\\') {
        return Containment::Refused("has a backslash");
    }
    // The installer creates these itself. Caseless: macOS and Windows open either name.
    for component in strings::split_any(workspace_path, b"/\\") {
        if component.eq_ignore_ascii_case(b"node_modules") {
            return Containment::Refused("is inside node_modules");
        }
    }

    let mut abs_dir_buf = bun_paths::path_buffer_pool::get();
    let Some(abs_dir_len) = write_absolute_path(&mut abs_dir_buf.0, top_level_dir, workspace_path)
    else {
        return Containment::Refused("is too long");
    };

    let (real_dir, dropped) =
        match real_path_of_nearest_existing_dir(&mut abs_dir_buf.0, abs_dir_len, real_dir_buf) {
            Ok(resolved) => resolved,
            Err(err) => return Containment::Failed(err),
        };
    let real_root = match real_root {
        Some(real_root) => &**real_root,
        None => {
            let mut root_buf = bun_paths::path_buffer_pool::get();
            let Some(root_len) = write_absolute_path(&mut root_buf.0, top_level_dir, b"") else {
                return Containment::Refused("is too long");
            };
            let mut real_root_buf = bun_paths::path_buffer_pool::get();
            match real_path_of_nearest_existing_dir(&mut root_buf.0, root_len, &mut real_root_buf) {
                Ok((root, _)) => real_root.insert(Box::from(root)),
                Err(err) => return Containment::Failed(err),
            }
        }
    };

    if !is_inside(real_root, real_dir) {
        return Containment::Outside(real_dir);
    }
    match dropped {
        // The install has yet to create the component each one applies to.
        Dropped::DotDot => {
            Containment::Refused("has a \"..\" component below a directory that does not exist")
        }
        Dropped::Symlink => Containment::Refused("has a symlink that does not resolve"),
        Dropped::Plain => Containment::Inside,
    }
}

/// `<root>/<path>` and a NUL, not normalized: only the OS resolves a `..` after a symlink.
fn write_absolute_path(buf: &mut [u8], root: &[u8], mut path: &[u8]) -> Option<usize> {
    let absolute = bun_paths::is_absolute(path);
    // A trailing separator makes `lstat` follow the last component, except on a bare root.
    while let [rest @ .., last] = path {
        if !bun_paths::is_sep_native(*last) || rest.is_empty() || is_drive(rest) {
            break;
        }
        path = rest;
    }
    let root: &[u8] = if absolute { b"" } else { root };
    let sep = (!root.is_empty() && !path.is_empty()) as usize;
    let len = root.len() + sep + path.len();
    if len + 1 > buf.len() {
        return None;
    }
    buf[..root.len()].copy_from_slice(root);
    if sep == 1 {
        buf[root.len()] = bun_paths::SEP;
    }
    buf[root.len() + sep..len].copy_from_slice(path);
    buf[len] = 0;
    Some(len)
}

/// A `..` and a symlink both resolve against a component the install has yet to create.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum Dropped {
    Plain,
    Symlink,
    DotDot,
}

/// The nearest existing directory of the NUL-terminated `buf[..len]`, and what it dropped.
fn real_path_of_nearest_existing_dir<'b>(
    buf: &mut [u8],
    len: usize,
    out: &'b mut bun_paths::PathBuffer,
) -> bun_sys::Maybe<(&'b [u8], Dropped)> {
    let mut len = len;
    let mut dropped = Dropped::Plain;
    loop {
        // SAFETY: `buf[len]` is the NUL this function maintains.
        let path = bun_core::ZStr::from_buf(buf, len);
        let err = match bun_sys::realpath(path, out) {
            Ok(real) => return Ok((real, dropped)),
            Err(err) => err,
        };
        let parent_len = match (err.get_errno(), bun_paths::dirname(&buf[..len])) {
            (bun_sys::E::ENOENT | bun_sys::E::ENOTDIR, Some(parent)) if !parent.is_empty() => {
                parent.len()
            }
            _ => return Err(err),
        };
        dropped = dropped.max(if bun_paths::basename(&buf[..len]) == b".." {
            Dropped::DotDot
        } else if is_symlink(path) {
            Dropped::Symlink
        } else {
            Dropped::Plain
        });
        len = parent_len;
        buf[len] = 0;
    }
}

fn is_symlink(path: &bun_core::ZStr) -> bool {
    #[cfg(windows)]
    {
        bun_sys::get_file_attributes(path).is_some_and(|a| a.is_reparse_point)
    }
    #[cfg(not(windows))]
    {
        bun_sys::lstat(path).is_ok_and(|st| bun_sys::posix::s_islnk(st.st_mode as u32))
    }
}

/// `C:` on Windows, where a trailing separator is part of the drive root's own name.
fn is_drive(_path: &[u8]) -> bool {
    #[cfg(windows)]
    return matches!(_path, [letter, b':'] if bun_paths::is_drive_letter(*letter));
    #[cfg(not(windows))]
    return false;
}

/// Exact: both come from the same `realpath`, and a volume can be case-sensitive.
fn is_inside(root: &[u8], dir: &[u8]) -> bool {
    // `/` and `C:\` keep a separator of their own, which every path below them repeats.
    let mut root = root;
    while let [rest @ .., last] = root {
        if !bun_paths::is_sep_native(*last) {
            break;
        }
        root = rest;
    }
    if !dir.starts_with(root) {
        return false;
    }
    dir.len() == root.len() || bun_paths::is_sep_native(dir[root.len()])
}

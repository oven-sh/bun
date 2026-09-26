//! node_modules-shaped views of cached packages that ship native addons.
//!
//! Auto-install resolves modules straight out of the global cache, where each
//! package lives in a flat dir (`<cache>/name@version@@@N`). Prebuilt native
//! addons locate sibling shared libraries with `$ORIGIN`-relative RPATH
//! entries that assume a node_modules layout (for example
//! `$ORIGIN/../../sharp-libvips-linux-x64/lib`), so `dlopen` misses even
//! though the library is one cache entry away. Symlinking the package dir
//! does not help: the kernel resolves the `..` components of an RPATH
//! candidate through the real parent directory, so only a layout whose real
//! directories are node_modules-shaped can satisfy those entries.
//!
//! For a cached npm package that contains a `.node` file, this module builds
//! `<cache>/.addon-links/<flat>/node_modules/<name>` with every file
//! hardlinked from the flat dir, and symlinks each resolved dependency next
//! to it (the same sibling shape the isolated-install store uses). The
//! resolver then returns that view, so `$ORIGIN/../..` lands in the
//! `node_modules` dir and the sibling symlink leads into the dependency's
//! cache dir. Packages without a `.node` file get an empty marker file
//! (`<flat>.skip`) so the directory scan runs only once per cache entry.
//!
//! Everything here is best-effort: on any failure the caller falls back to
//! the flat dir, which is the previous behavior.

#![cfg(not(windows))]

use crate::lockfile_real::package::PackageColumns as _;
use bun_core::{ZStr, fmt as bun_fmt, strings};
use bun_install::PackageID;
use bun_install::resolution::Tag as ResolutionTag;
use bun_paths::{self as path, PathBuffer};
use bun_semver as Semver;
use bun_semver::SlicedString;
use bun_sys::{self as sys, Dir, Fd, FdExt};

use super::PackageManager;
use super::package_manager_directories as directories;

const STORE_DIR: &[u8] = b".addon-links";
const SKIP_SUFFIX: &[u8] = b".skip";

bun_core::declare_scope!(addon_links, hidden);

/// If `package_name@version` is cached and contains a native addon, make sure
/// the node_modules-shaped view exists, refresh its dependency symlinks from
/// `package_id`'s resolutions, write the view's absolute package path into
/// `buf`, and return its length. Returns `None` when the package has no
/// native addon or the view cannot be built.
pub(super) fn maybe_store_path(
    this: &mut PackageManager,
    package_id: PackageID,
    package_name: &[u8],
    version: Semver::Version,
    buf: &mut PathBuffer,
) -> Option<usize> {
    if !crate::dependency::is_safe_install_folder_name(package_name) {
        return None;
    }

    let cache_dir = directories::get_cache_directory(this);
    if this.cache_directory_path.is_empty() {
        return None;
    }

    let mut folder_name_buf = PathBuffer::uninit();
    let folder_name_len = directories::cached_npm_package_folder_name_print(
        this,
        &mut folder_name_buf.0[..],
        package_name,
        version,
        None,
    )
    .as_bytes()
    .len();
    let folder_name = &folder_name_buf.0[..folder_name_len];

    let mut entry_buf = PathBuffer::uninit();
    let entry_z = concat_z(&mut entry_buf, &[STORE_DIR, b"/", folder_name]);

    if sys::lstatat(cache_dir, entry_z).is_err() {
        let mut marker_buf = PathBuffer::uninit();
        let marker_z = concat_z(
            &mut marker_buf,
            &[STORE_DIR, b"/", folder_name, SKIP_SUFFIX],
        );
        if sys::lstatat(cache_dir, marker_z).is_ok() {
            return None;
        }

        match flat_dir_has_native_addon(cache_dir, folder_name) {
            Some(true) => {
                if !build_store(cache_dir, folder_name, package_name, entry_z) {
                    return None;
                }
            }
            Some(false) => {
                write_skip_marker(cache_dir, marker_z);
                return None;
            }
            None => return None,
        }
    }

    ensure_dependency_links(this, package_id, cache_dir, folder_name);

    let len = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
        this.cache_directory_path.as_bytes(),
        &mut buf.0[..],
        &[STORE_DIR, folder_name, b"node_modules", package_name],
    )
    .as_bytes()
    .len();
    Some(len)
}

fn concat_z<'a>(buf: &'a mut PathBuffer, parts: &[&[u8]]) -> &'a ZStr {
    let mut at = 0;
    for part in parts {
        buf.0[at..at + part.len()].copy_from_slice(part);
        at += part.len();
    }
    buf.0[at] = 0;
    ZStr::from_buf(&buf.0, at)
}

/// `Some(true)` if any regular file under the flat dir ends in `.node`,
/// `Some(false)` if none does, `None` if the scan failed.
fn flat_dir_has_native_addon(cache_dir: Fd, folder_name: &[u8]) -> Option<bool> {
    let fd = sys::open_dir_for_iteration(cache_dir, folder_name).ok()?;
    let mut walker = match sys::walker_skippable::walk(fd, &[], &[]) {
        Ok(w) => w,
        Err(_) => {
            fd.close();
            return None;
        }
    };
    walker.resolve_unknown_entry_types = true;
    let found = loop {
        match walker.next() {
            Ok(Some(entry)) => {
                if entry.kind == sys::EntryKind::File
                    && entry.basename.as_bytes().ends_with(b".node")
                {
                    break Some(true);
                }
            }
            Ok(None) => break Some(false),
            Err(_) => break None,
        }
    };
    drop(walker);
    fd.close();
    found
}

fn write_skip_marker(cache_dir: Fd, marker_z: &ZStr) {
    if let Some(parent) = path::dirname(marker_z.as_bytes()) {
        let _ = bun_sys::make_path::make_path::<u8>(Dir::borrow(&cache_dir), parent);
    }
    let _ = sys::File::openat(cache_dir, marker_z, sys::O::WRONLY | sys::O::CREAT, 0o644);
}

/// Hardlink the flat dir's files into
/// `.addon-links/<flat>/node_modules/<name>`, built in a temp dir and renamed
/// into place so concurrent processes race safely. Returns `true` when the
/// store entry exists afterwards (built here or by the rename-race winner).
fn build_store(cache_dir: Fd, folder_name: &[u8], package_name: &[u8], entry_z: &ZStr) -> bool {
    let mut tmp_buf = PathBuffer::uninit();
    let hex = bun_fmt::u64_hex_fixed::<true, 16>(bun_core::fast_random());
    let tmp_z = concat_z(&mut tmp_buf, &[STORE_DIR, b"/.tmp-", &hex]);

    let mut dest_rel_buf = PathBuffer::uninit();
    let dest_rel_z = concat_z(
        &mut dest_rel_buf,
        &[tmp_z.as_bytes(), b"/node_modules/", package_name],
    );

    let dest_dir = match bun_sys::make_path::make_open_path(
        Dir::borrow(&cache_dir),
        dest_rel_z.as_bytes(),
        Default::default(),
    ) {
        Ok(dir) => dir,
        Err(_) => {
            let _ = cache_dir.delete_tree(tmp_z.as_bytes());
            return false;
        }
    };

    let linked = hardlink_tree(cache_dir, folder_name, &dest_dir);
    drop(dest_dir);
    if !linked {
        let _ = cache_dir.delete_tree(tmp_z.as_bytes());
        return false;
    }

    if let Some(parent) = path::dirname(entry_z.as_bytes()) {
        let _ = bun_sys::make_path::make_path::<u8>(Dir::borrow(&cache_dir), parent);
    }

    match sys::renameat(cache_dir, tmp_z, cache_dir, entry_z) {
        Ok(()) => true,
        Err(err) => {
            let _ = cache_dir.delete_tree(tmp_z.as_bytes());
            // Another process renamed its own copy into place first.
            matches!(err.get_errno(), sys::E::EEXIST | sys::E::ENOTEMPTY)
        }
    }
}

fn hardlink_tree(cache_dir: Fd, folder_name: &[u8], dest_dir: &Dir) -> bool {
    let Ok(src_fd) = sys::open_dir_for_iteration(cache_dir, folder_name) else {
        return false;
    };
    let mut walker = match sys::walker_skippable::walk(src_fd, &[], &[]) {
        Ok(w) => w,
        Err(_) => {
            src_fd.close();
            return false;
        }
    };
    walker.resolve_unknown_entry_types = true;
    let ok = loop {
        match walker.next() {
            Ok(Some(entry)) => match entry.kind {
                sys::EntryKind::Directory => {
                    if bun_sys::make_path::make_path::<u8>(dest_dir, entry.path.as_bytes()).is_err()
                    {
                        break false;
                    }
                }
                sys::EntryKind::File => {
                    if sys::linkat(entry.dir, entry.basename, dest_dir.fd(), entry.path).is_err() {
                        break false;
                    }
                }
                // Recreate symlinks verbatim. Dropping one would rename an
                // incomplete view into place, and the view is never rebuilt.
                sys::EntryKind::SymLink => {
                    let mut link_target_buf = PathBuffer::uninit();
                    let Ok(n) =
                        sys::readlinkat(entry.dir, entry.basename, &mut link_target_buf.0[..])
                    else {
                        break false;
                    };
                    link_target_buf.0[n] = 0;
                    let link_target_z = ZStr::from_buf(&link_target_buf.0, n);
                    if sys::symlinkat(link_target_z, dest_dir.fd(), entry.path).is_err() {
                        break false;
                    }
                }
                _ => {}
            },
            Ok(None) => break true,
            Err(_) => break false,
        }
    };
    drop(walker);
    src_fd.close();
    ok
}

enum LinkTarget {
    /// Resolved to an npm package: name the flat cache dir from its version.
    Npm {
        real_name: Vec<u8>,
        version: Semver::Version,
    },
    /// Resolved to an absolute folder (a disk-cache folder resolution).
    FolderPath(Vec<u8>),
    /// Edge not resolved in this process's lockfile (nothing `require`d the
    /// dependency). Pick the best cached version satisfying the range, the
    /// way offline resolution does.
    FromDiskCache { npm_name: Vec<u8>, dep_index: u32 },
}

/// Create or refresh `node_modules/<dep>` symlinks in the store entry, one
/// per dependency of `package_id` that maps to a cached package. The symlink
/// name is the dependency's alias (the name `dlopen`'s RPATH and `require`
/// see); the target is the dependency's flat cache dir.
fn ensure_dependency_links(
    this: &mut PackageManager,
    package_id: PackageID,
    cache_dir: Fd,
    folder_name: &[u8],
) {
    struct DepLink {
        alias: Vec<u8>,
        target: LinkTarget,
    }

    let mut links: Vec<DepLink> = Vec::new();
    {
        let pkgs = this.lockfile.packages.slice();
        let pkg_dependencies = pkgs.items_dependencies();
        let pkg_resolutions = pkgs.items_resolution();
        let pkg_names = pkgs.items_name();
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();

        let Some(deps) = pkg_dependencies.get(package_id as usize).copied() else {
            return;
        };
        bun_core::scoped_log!(
            addon_links,
            "pkg {} deps {}..{}",
            package_id,
            deps.begin(),
            deps.end()
        );
        for dep_index in deps.begin()..deps.end() {
            let Some(dep) = this.lockfile.buffers.dependencies.get(dep_index as usize) else {
                continue;
            };
            let alias = dep.name.slice(string_buf);
            if alias.is_empty() || !crate::dependency::is_safe_install_folder_name(alias) {
                continue;
            }

            let dep_pkg_id = this
                .lockfile
                .buffers
                .resolutions
                .get(dep_index as usize)
                .copied()
                .unwrap_or(crate::INVALID_PACKAGE_ID);

            let target = if dep_pkg_id != crate::INVALID_PACKAGE_ID
                && (dep_pkg_id as usize) < pkg_resolutions.len()
            {
                let resolution = &pkg_resolutions[dep_pkg_id as usize];
                match resolution.tag {
                    ResolutionTag::Npm => LinkTarget::Npm {
                        real_name: pkg_names[dep_pkg_id as usize].slice(string_buf).to_vec(),
                        version: resolution.npm().version,
                    },
                    ResolutionTag::Folder => {
                        let folder = resolution.folder().slice(string_buf);
                        if folder.first() != Some(&b'/') {
                            continue;
                        }
                        LinkTarget::FolderPath(folder.to_vec())
                    }
                    _ => continue,
                }
            } else if dep.version.tag == crate::dependency::Tag::Npm {
                let npm_name = dep.version.npm().name.slice(string_buf);
                if npm_name.is_empty() || !crate::dependency::is_safe_install_folder_name(npm_name)
                {
                    continue;
                }
                LinkTarget::FromDiskCache {
                    npm_name: npm_name.to_vec(),
                    dep_index,
                }
            } else {
                continue;
            };

            bun_core::scoped_log!(addon_links, "dep {} alias {}", dep_index, bun_fmt::s(alias));
            links.push(DepLink {
                alias: alias.to_vec(),
                target,
            });
        }
    }

    for link in &links {
        let mut target_buf = PathBuffer::uninit();
        let target_len = match &link.target {
            LinkTarget::Npm { real_name, version } => {
                let mut dep_folder_buf = PathBuffer::uninit();
                let dep_folder_len = directories::cached_npm_package_folder_name_print(
                    this,
                    &mut dep_folder_buf.0[..],
                    real_name,
                    *version,
                    None,
                )
                .as_bytes()
                .len();

                path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                    this.cache_directory_path.as_bytes(),
                    &mut target_buf.0[..],
                    &[&dep_folder_buf.0[..dep_folder_len]],
                )
                .as_bytes()
                .len()
            }
            LinkTarget::FolderPath(folder) => {
                target_buf.0[..folder.len()].copy_from_slice(folder);
                folder.len()
            }
            LinkTarget::FromDiskCache {
                npm_name,
                dep_index,
            } => {
                let Some(len) =
                    cached_dep_path_from_disk(this, npm_name, *dep_index, &mut target_buf)
                else {
                    continue;
                };
                len
            }
        };
        target_buf.0[target_len] = 0;
        let target_z = ZStr::from_buf(&target_buf.0, target_len);

        let mut link_buf = PathBuffer::uninit();
        let link_z = concat_z(
            &mut link_buf,
            &[STORE_DIR, b"/", folder_name, b"/node_modules/", &link.alias],
        );
        bun_core::scoped_log!(
            addon_links,
            "link {} -> {}",
            bun_fmt::s(link_z.as_bytes()),
            bun_fmt::s(target_z.as_bytes())
        );

        let mut read_buf = PathBuffer::uninit();
        match sys::readlinkat(cache_dir, link_z, &mut read_buf.0[..]) {
            Ok(n) if &read_buf.0[..n] == target_z.as_bytes() => {}
            Ok(_) => {
                // Replace atomically: a concurrent dlopen must never observe
                // the link as missing.
                let mut tmp_link_buf = PathBuffer::uninit();
                let hex = bun_fmt::u64_hex_fixed::<true, 16>(bun_core::fast_random());
                let tmp_link_z = concat_z(
                    &mut tmp_link_buf,
                    &[STORE_DIR, b"/", folder_name, b"/node_modules/.tmp-", &hex],
                );
                if sys::symlinkat(target_z, cache_dir, tmp_link_z).is_ok()
                    && sys::renameat(cache_dir, tmp_link_z, cache_dir, link_z).is_err()
                {
                    let _ = sys::unlinkat(cache_dir, tmp_link_z);
                }
            }
            Err(err) if err.get_errno() == sys::E::ENOENT => {
                if let Some(parent) = path::dirname(link_z.as_bytes()) {
                    let _ = bun_sys::make_path::make_path::<u8>(Dir::borrow(&cache_dir), parent);
                }
                let _ = sys::symlinkat(target_z, cache_dir, link_z);
            }
            // Exists but is not a symlink (for example the package's own
            // hardlinked dir): leave it alone.
            Err(_) => {}
        }
    }
}

/// Resolve an unresolved npm dependency edge against the disk cache: list
/// the install-index entries of `npm_name` (`<cache>/<name>/<version>@@@N`),
/// pick the highest version satisfying the edge's range, and write that flat
/// cache dir's absolute path into `buf`.
fn cached_dep_path_from_disk(
    this: &mut PackageManager,
    npm_name: &[u8],
    dep_index: u32,
    buf: &mut PathBuffer,
) -> Option<usize> {
    let cache_dir = directories::get_cache_directory(this);

    struct Candidate {
        version: Semver::Version,
        /// Owns the bytes the version's tag offsets point into.
        entry_name: Vec<u8>,
    }
    let mut candidates: Vec<Candidate> = Vec::new();
    {
        let index_dir = Dir::borrow(&cache_dir).open_at(npm_name).ok()?;
        let mut iter = sys::iterate_dir(index_dir.fd);
        while let Ok(Some(entry)) = iter.next() {
            // Accept Unknown: filesystems without d_type report every entry
            // as Unknown, and the semver parse below rejects non-index names.
            if !matches!(
                entry.kind,
                sys::EntryKind::Directory | sys::EntryKind::SymLink | sys::EntryKind::Unknown
            ) {
                continue;
            }
            let entry_name: Vec<u8> = entry.name.slice_u8().to_vec();
            // Index entries append suffixes to the version: `@@@N` (cache
            // version, maybe with `_patch_hash=...`) and `@@<host>@@@N` for a
            // non-default registry. A semver version cannot contain `@`, so
            // cut at the first `@@`. Parse from the owned copy: the version's
            // tag offsets then stay valid against `entry_name` (the cut is a
            // prefix, so offsets match the full buffer too). A shared tag
            // buffer would not work here: `clone_into` stores offsets
            // relative to the sub-slice it is given.
            let version_part = match strings::index_of(&entry_name, b"@@") {
                Some(at) => &entry_name[..at],
                None => &entry_name[..],
            };
            let parsed = Semver::Version::parse(SlicedString::init(version_part, version_part));
            if !parsed.valid || parsed.wildcard != Semver::query::Wildcard::None {
                continue;
            }
            let version = parsed.version.min();
            candidates.push(Candidate {
                version,
                entry_name,
            });
        }
    }
    if candidates.is_empty() {
        return None;
    }

    let best = {
        let dep = this.lockfile.buffers.dependencies.get(dep_index as usize)?;
        if dep.version.tag != crate::dependency::Tag::Npm {
            return None;
        }
        let query = &dep.version.npm().version;
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();

        let mut best: Option<&Candidate> = None;
        for candidate in &candidates {
            if !query.satisfies(candidate.version, string_buf, &candidate.entry_name) {
                continue;
            }
            match best {
                Some(current)
                    if candidate.version.order(
                        current.version,
                        &candidate.entry_name,
                        &current.entry_name,
                    ) != core::cmp::Ordering::Greater => {}
                _ => best = Some(candidate),
            }
        }
        best?
    };

    // The index entry is normally a symlink to the flat dir; resolve it. With
    // the install index disabled it can be a real dir, which is the target
    // itself.
    let mut entry_rel_buf = PathBuffer::uninit();
    let entry_rel_z = concat_z(&mut entry_rel_buf, &[npm_name, b"/", &best.entry_name]);
    match sys::readlinkat(cache_dir, entry_rel_z, &mut buf.0[..]) {
        Ok(n) => Some(n),
        Err(_) => Some(
            path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                this.cache_directory_path.as_bytes(),
                &mut buf.0[..],
                &[npm_name, &best.entry_name],
            )
            .as_bytes()
            .len(),
        ),
    }
}

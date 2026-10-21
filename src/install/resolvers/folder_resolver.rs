use core::fmt;

use bun_core::fmt::QuotedFormatter;
use bun_core::{ZStr, strings};
use bun_paths::{self, PathBuffer, SEP, SEP_STR, resolve_path};
use bun_resolver::fs::FileSystem;
use bun_semver::{self as semver, String as SemverString};
use bun_sys::{self, Fd, File, O};

use crate::bun_json::Expr;
use crate::dependency::{self};
use crate::install::{Features, Lockfile, PackageID};
use crate::lockfile::Package as LockfilePackage;
use crate::lockfile_real::StringBuilder;
use crate::lockfile_real::package::ResolverContext;
use crate::npm;
use crate::package_manager_real::PackageManager;
use crate::package_manager_real::process_dependency_list::{ListedDependencies, OnlyDependencies};
use crate::resolution::{ResolutionType, Tag as ResolutionTag, TaggedValue};

#[derive(Copy, Clone)]
pub enum FolderResolution {
    PackageId(PackageID),
    Err(crate::Error),
    NewPackageId(PackageID),
}

pub(crate) struct PackageWorkspaceSearchPathFormatter<'a> {
    pub manager: &'a PackageManager,
    pub version: dependency::Version,
}

impl<'a> fmt::Display for PackageWorkspaceSearchPathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Caller constructs this formatter only when
        // `self.version.tag == .workspace`.
        let workspace = self.version.workspace();
        let str_to_use = self
            .manager
            .lockfile
            .workspace_paths
            .get(&semver::string::Builder::string_hash(
                self.manager.lockfile.str(workspace),
            ))
            .unwrap_or(workspace);

        let search_path = self.manager.lockfile.str(str_to_use);

        let mut joined = bun_paths::path_buffer_pool::get();
        let mut dot_slash_rel = Vec::new();
        let rel: &[u8] = match normalize_package_json_path(
            GlobalOrRelative::Relative(dependency::version::Tag::Workspace),
            &mut joined,
            search_path,
        ) {
            Some(paths)
                if !strings::starts_with_char(paths.rel, b'.')
                    && !strings::starts_with_char(paths.rel, SEP) =>
            {
                dot_slash_rel.push(b'.');
                dot_slash_rel.push(SEP);
                dot_slash_rel.extend_from_slice(paths.rel);
                dot_slash_rel.as_slice()
            }
            Some(paths) => paths.rel,
            // It's too long to be a path, so show it as written.
            None => search_path,
        };

        let quoted = QuotedFormatter { text: rel };
        fmt::Display::fmt(&bun_core::fmt::EscapeControlChars(quoted), f)
    }
}

/// One directory resolves to a different package (`Features`, `Resolution`) per kind.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Kind {
    /// `file:` dependencies and workspace members (and the root seeded by `PackageManager::init`).
    Folder,
    /// `link:` targets (`Resolution::Symlink`, dependencies not installed).
    Link,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Key {
    kind: Kind,
    /// The hash of the normalized absolute `package.json` path that's kept in `Entry::abs_path`.
    abs_hash: u64,
}

impl Key {
    pub(crate) fn new(kind: Kind, normalized_abs_path: &[u8]) -> Key {
        Key {
            kind,
            abs_hash: bun_wyhash::hash(normalized_abs_path),
        }
    }
}

/// Value stored in the folder-resolution map: the resolution plus the
/// normalized absolute `package.json` path `Key::abs_hash` was computed from.
/// Lookups compare the path, since a different path whose hash collides must
/// not reuse this resolution.
pub struct Entry {
    pub(crate) abs_path: Box<[u8]>,
    pub(crate) resolution: FolderResolution,
}

struct NewResolver<'a> {
    /// `Folder`, `Symlink` or `Workspace`
    tag: ResolutionTag,
    folder_path: &'a [u8],
}

impl ResolverContext for NewResolver<'_> {
    fn check_bundled_dependencies(&self) -> bool {
        matches!(self.tag, ResolutionTag::Folder | ResolutionTag::Symlink)
    }

    fn count(&mut self, builder: &mut StringBuilder<'_>, _json: &Expr) {
        builder.count(self.folder_path);
    }

    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> crate::Result<ResolutionType<u64>> {
        let appended = builder.append::<SemverString>(self.folder_path);
        Ok(ResolutionType::<u64>::init(match self.tag {
            ResolutionTag::Folder => TaggedValue::Folder(appended),
            ResolutionTag::Symlink => TaggedValue::Symlink(appended),
            ResolutionTag::Workspace => TaggedValue::Workspace(appended),
            _ => unreachable!(),
        }))
    }

    fn fallback_name(&self) -> Option<Vec<u8>> {
        // Workspace members were registered under their package.json name by `WorkspaceMap`.
        if self.tag == ResolutionTag::Workspace {
            return None;
        }
        Some(dependency::fallback_package_name(self.folder_path).to_vec())
    }
}

struct Paths<'a> {
    abs: &'a ZStr,
    rel: &'a [u8],
}

/// Returns `None` when the `package.json` path does not fit `joined`.
fn normalize_package_json_path<'a>(
    global_or_relative: GlobalOrRelative<'_>,
    joined: &'a mut PathBuffer,
    non_normalized_path: &[u8],
) -> Option<Paths<'a>> {
    let mut normalize_spill = Vec::new();
    // We consider it valid if there is a package.json in the folder
    let normalized: &[u8] = if non_normalized_path == b"." {
        non_normalized_path
    } else if bun_paths::is_absolute(non_normalized_path) {
        strings::trim_right(non_normalized_path, SEP_STR.as_bytes())
    } else {
        strings::trim_right(
            resolve_path::normalize_string_spill::<true, bun_paths::platform::Auto>(
                &mut normalize_spill,
                non_normalized_path,
            ),
            SEP_STR.as_bytes(),
        )
    };

    const PACKAGE_JSON_LEN: usize = "/package.json".len();

    // The last byte of `joined` is reserved for the NUL terminator.
    let capacity = joined.len() - 1;

    let abs_len = if strings::starts_with_char(normalized, b'.') {
        let parts: [&[u8]; 2] = [normalized, b"package.json"];
        FileSystem::instance()
            .abs_buf_checked(&parts, &mut joined[..capacity])?
            .len()
    } else {
        let (prefix, needs_sep): (&[u8], bool) = match global_or_relative {
            GlobalOrRelative::Global(path) if !path.is_empty() => {
                let ends_with_sep = path[path.len() - 1] == SEP;
                (
                    &path[..path.len() - ends_with_sep as usize],
                    !normalized.is_empty() && !ends_with_sep && normalized[0] != SEP,
                )
            }
            _ => (b"", false),
        };
        let abs_len = prefix.len() + needs_sep as usize + normalized.len() + PACKAGE_JSON_LEN;
        if abs_len > capacity {
            return None;
        }

        let mut len = prefix.len();
        joined[..len].copy_from_slice(prefix);
        if needs_sep {
            joined[len] = SEP;
            len += 1;
        }
        joined[len..len + normalized.len()].copy_from_slice(normalized);
        len += normalized.len();
        joined[len] = SEP;
        joined[len + 1..len + PACKAGE_JSON_LEN].copy_from_slice(b"package.json");
        abs_len
    };

    // We store the folder name without package.json
    let rel = FileSystem::instance().relative(
        FileSystem::instance().top_level_dir(),
        &joined[..abs_len - PACKAGE_JSON_LEN],
    );
    joined[abs_len] = 0;

    Some(Paths {
        abs: ZStr::from_buf(joined, abs_len),
        rel,
    })
}

fn read_package_json_from_disk(
    manager: &mut PackageManager,
    abs: &ZStr,
    version: &dependency::Version,
    features: Features,
    resolver: &mut NewResolver<'_>,
) -> crate::Result<LockfilePackage> {
    let mut body = npm::Registry::BodyPool::get();

    let mut package: LockfilePackage = Default::default();

    // Borrow splitting: `manager.lockfile`, `manager`, and `manager.log` are
    // needed simultaneously; borrowck rejects the overlap on `&mut self`,
    // so split via raw pointer once here. `lockfile` and `log` are disjoint
    // fields of `PackageManager`, and `parse{,_with_json}` only reaches
    // `manager` through the `pm` argument (no re-entrant access to
    // `lockfile`/`log` via `pm`).
    //
    // `log_mut()` reads the BACKREF `self.log: *mut Log` and returns the
    // disjoint CLI `Log` allocation (lifetime decoupled from `&self`); call it
    // safely *before* establishing `manager_ptr` so `log` is derived from a
    // separate allocation and is unaffected by the `&mut *manager_ptr`
    // reborrows below.
    let log: &mut bun_ast::Log = manager.log_mut();
    let manager_ptr: *mut PackageManager = manager;

    if resolver.tag == ResolutionTag::Workspace {
        let _tracer =
            bun_perf::trace(bun_perf::PerfEvent::FolderResolverReadPackageJSONFromDiskWorkspace);

        // SAFETY: `manager_ptr` was just derived from the live `&mut PackageManager`
        // argument; `log` points into a separate `Log` allocation (see the
        // borrow-splitting comment above), so this `&mut` reborrow aliases no
        // other live reference.
        let json = unsafe { &mut *manager_ptr }
            .workspace_package_json_cache
            .get_with_path(log, abs.as_bytes(), Default::default())
            .unwrap()?;
        // `Expr` is `Copy`; take a raw pointer to `source` so the borrow on
        // `workspace_package_json_cache` ends before `&mut *manager_ptr` is
        // formed for `parse_with_json`.
        let root: Expr = json.root;
        let source: *const bun_ast::Source = &raw const json.source;

        // SAFETY: see the borrow-splitting comment above.
        unsafe {
            let lockfile: *mut Lockfile = &raw mut *(*manager_ptr).lockfile;
            package.parse_with_json(
                &mut *lockfile,
                &mut *manager_ptr,
                log,
                &*source,
                root,
                resolver,
                features,
            )?;
        }
    } else {
        let _tracer =
            bun_perf::trace(bun_perf::PerfEvent::FolderResolverReadPackageJSONFromDiskFolder);

        let source = {
            body.reset();
            match File::openat(Fd::cwd(), abs.as_bytes(), O::RDONLY, 0) {
                Ok(file) => {
                    let read_result = file
                        .read_to_end_with_array_list(
                            &mut body.list,
                            bun_sys::SizeHint::ProbablySmall,
                        )
                        .map(|_| ());
                    let _ = file.close();
                    read_result?;
                }
                // Like in Yarn, the directory of a `link:<path>` doesn't need a package.json.
                Err(err)
                    if resolver.tag == ResolutionTag::Symlink
                        && dependency::is_link_path(resolver.folder_path)
                        && matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) =>
                {
                    let dir = bun_core::ZBox::from_bytes(bun_paths::dirname_simple(abs.as_bytes()));
                    if !bun_sys::directory_exists_at(Fd::cwd(), &dir).unwrap_or(false) {
                        return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT));
                    }
                    body.list.extend_from_slice(b"{}");
                }
                Err(err) => return Err(err.into()),
            }

            bun_ast::Source::init_path_string(abs.as_bytes(), body.list.as_slice())
        };

        // SAFETY: see the borrow-splitting comment above.
        unsafe {
            let lockfile: *mut Lockfile = &raw mut *(*manager_ptr).lockfile;
            package.parse(
                &mut *lockfile,
                &mut *manager_ptr,
                log,
                &source,
                resolver,
                features,
            )?;
        }
    }

    if let Some(existing_id) =
        manager
            .lockfile
            .get_package_id(package.name_hash, Some(version), &package.resolution)
    {
        package.meta.id = existing_id;
        crate::lockfile_real::package::Diff::keep_resolutions(manager, existing_id, &package);
        manager.lockfile.packages.set(existing_id as usize, package);
        return Ok(*manager.lockfile.packages.get(existing_id as usize));
    }

    Ok(manager.lockfile.append_package(&package)?)
}

#[derive(Copy, Clone)]
pub enum GlobalOrRelative<'a> {
    Global(&'a [u8]),
    Relative(dependency::version::Tag),
}

/// Reads the dependencies in the package.json of a `file:` or `workspace:` folder. This doesn't
/// resolve the folder. Errors in the file are reported when the folder is resolved.
pub(crate) fn listed_dependencies(
    tag: dependency::version::Tag,
    non_normalized_path: &[u8],
    manager: &mut PackageManager,
) -> Option<ListedDependencies> {
    let mut joined = bun_paths::path_buffer_pool::get();
    let relative = GlobalOrRelative::Relative(tag);
    let paths = normalize_package_json_path(relative, &mut joined, non_normalized_path)?;
    let mut log = bun_ast::Log::init();
    // `bun add` in a workspace edits the copy in this cache before it writes the file.
    let entry = (manager.workspace_package_json_cache)
        .get_with_path(&mut log, paths.abs.as_bytes(), Default::default())
        .unwrap()
        .ok()?;
    let (source, json) = (entry.source.clone(), entry.root);
    let mut listed = ListedDependencies::default();
    // These features register no `npm:` alias, which would change how other rows are resolved.
    let parsed = listed.package.parse_with_json(
        &mut listed.lockfile,
        manager,
        &mut log,
        &source,
        json,
        &mut OnlyDependencies,
        Features::FOLDER,
    );
    parsed.ok().map(|()| listed)
}

pub(crate) fn get_or_put(
    global_or_relative: GlobalOrRelative<'_>,
    version: &dependency::Version,
    non_normalized_path: &[u8],
    manager: &mut PackageManager,
) -> FolderResolution {
    let mut joined = bun_paths::path_buffer_pool::get();
    #[cfg(windows)]
    let mut rel_buf = bun_paths::path_buffer_pool::get();
    let Some(paths) =
        normalize_package_json_path(global_or_relative, &mut joined, non_normalized_path)
    else {
        return FolderResolution::Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
    };

    #[cfg(not(windows))]
    let abs = paths.abs;
    #[cfg(not(windows))]
    let rel = paths.rel;

    // replace before getting hash. rel may or may not be contained in abs
    #[cfg(windows)]
    let (abs, rel): (&ZStr, &[u8]) = {
        // Writing in place through `(&ZStr).as_ptr().cast_mut()` /
        // `(&[u8]).as_ptr().cast_mut()` would be UB under Stacked/Tree
        // Borrows: those pointers carry read-only provenance, and the
        // optimizer may assume `abs`'s bytes are unchanged when computing
        // `hash(abs.as_bytes())` below.
        //
        // Instead: capture lengths, let the shared borrows of `joined` die,
        // then take a fresh `&mut joined[..abs_len]` (write provenance) and
        // mutate that. `rel` points into FileSystem's thread-local relative
        // buffer which we only ever see as `&[u8]`, so copy it into a local
        // we own and convert the copy — same pattern as
        // WorkspacePackageJSONCache::get_with_path.
        let abs_len = paths.abs.len();
        let rel_len = paths.rel.len();
        rel_buf[..rel_len].copy_from_slice(paths.rel);
        // `paths` is dead past this point → `joined` is no longer borrowed.
        bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(&mut joined[..abs_len]);
        bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(&mut rel_buf[..rel_len]);
        (
            // `normalize_package_json_path` wrote `joined[abs_len] = 0`; the
            // separator rewrite above never touches the NUL.
            ZStr::from_buf(&joined[..], abs_len),
            &rel_buf[..rel_len],
        )
    };
    // Must agree with the resolver picked for each variant below.
    let kind = match global_or_relative {
        GlobalOrRelative::Global(_)
        | GlobalOrRelative::Relative(dependency::version::Tag::Symlink) => Kind::Link,
        GlobalOrRelative::Relative(_) => Kind::Folder,
    };
    let key = Key::new(kind, abs.as_bytes());

    // Check first, compute, then insert, because read_package_json_from_disk
    // needs &mut manager. Compare the stored path, not just its hash: a
    // different path whose hash collides must not reuse this resolution. On a
    // collision, resolve fresh without caching so the first path's entry stays.
    let hash_collision = match manager.folders.get(&key) {
        Some(existing) if *existing.abs_path == *abs.as_bytes() => return existing.resolution,
        Some(_) => true,
        None => false,
    };

    let link_path;
    let (tag, folder_path, features): (_, &[u8], _) = match global_or_relative {
        GlobalOrRelative::Global(_) => {
            // `non_normalized_path` may alias the lockfile string buffer, which grows below.
            link_path = std::borrow::Cow::Owned(non_normalized_path.to_vec());
            (ResolutionTag::Symlink, &*link_path, Features::LINK)
        }
        GlobalOrRelative::Relative(dependency::version::Tag::Symlink) => {
            link_path = dependency::link_path_for_lockfile(rel);
            (ResolutionTag::Symlink, &*link_path, Features::LINK)
        }
        GlobalOrRelative::Relative(dependency::version::Tag::Folder) => {
            (ResolutionTag::Folder, rel, Features::FOLDER)
        }
        GlobalOrRelative::Relative(dependency::version::Tag::Workspace) => {
            (ResolutionTag::Workspace, rel, Features::WORKSPACE)
        }
        GlobalOrRelative::Relative(_) => unreachable!(),
    };
    let mut resolver = NewResolver { tag, folder_path };

    let (stored, returned) =
        match read_package_json_from_disk(manager, abs, version, features, &mut resolver) {
            Ok(package) => (
                FolderResolution::PackageId(package.meta.id),
                FolderResolution::NewPackageId(package.meta.id),
            ),
            Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT)) => (
                FolderResolution::Err(crate::Error::MissingPackageJSON),
                FolderResolution::Err(crate::Error::MissingPackageJSON),
            ),
            Err(err) => (FolderResolution::Err(err), FolderResolution::Err(err)),
        };
    if !hash_collision {
        manager.folders.insert(
            key,
            Entry {
                abs_path: abs.as_bytes().into(),
                resolution: stored,
            },
        );
    }
    returned
}

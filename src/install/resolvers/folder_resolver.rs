use core::fmt;

use bun_core::fmt::QuotedFormatter;
use bun_core::{ZStr, strings};
use bun_paths::Path;
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
    pub workspace: &'a [u8],
}

impl<'a> fmt::Display for PackageWorkspaceSearchPathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let lockfile = &self.manager.lockfile;
        let search_path = (lockfile.workspace_paths)
            .get(&semver::string::Builder::string_hash(self.workspace))
            .map_or(self.workspace, |path| lockfile.str(path));

        let mut paths = normalize_package_json_path(
            GlobalOrRelative::Relative(dependency::version::Tag::Workspace),
            search_path,
        );
        let rel: &[u8] = match &mut paths {
            Some(Paths { rel, .. }) => {
                if !strings::starts_with_char(rel, b'.') && !bun_paths::is_absolute(rel) {
                    rel.prepend(&[b'.', bun_paths::SEP]);
                }
                rel
            }
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

struct Paths {
    /// The absolute path of the `package.json`.
    abs: Path,
    /// The folder, relative to the project root.
    rel: Path,
}

/// Returns `None` when the `package.json` path is too long.
fn normalize_package_json_path(
    global_or_relative: GlobalOrRelative<'_>,
    non_normalized_path: &[u8],
) -> Option<Paths> {
    let top_level_dir = FileSystem::get().top_level_dir();
    let base = match global_or_relative {
        GlobalOrRelative::Global(path) => path,
        GlobalOrRelative::Relative(_) => top_level_dir,
    };
    let mut abs = Path::resolve(&[base, non_normalized_path]);
    let rel = Path::relative(top_level_dir, &abs);
    abs.push(b"package.json");
    let abs = abs.check_len().ok()?;
    Some(Paths { abs, rel })
}

/// A `file:` folder is copied, and `/` or `C:\` would take the whole file system.
fn is_root_above_project(folder: &[u8]) -> bool {
    let project = FileSystem::get().top_level_dir();
    let abs = Path::resolve(&[project, folder]);
    let is_share = abs.starts_with(br"\\");
    abs.dirname().is_none() && !is_share && Path::relative(project, &abs).starts_with(b"..")
}

/// For a lockfile row that starts at the project, which is `.`. On Windows a repository can be the root of a drive.
pub(crate) fn is_whole_file_system(folder: &[u8]) -> bool {
    let identity = |path: &[u8]| {
        (bun_sys::stat(&Path::from(path)).ok()).map(|stat| (stat.st_dev, stat.st_ino))
    };
    cfg!(not(windows))
        && !matches!(folder, b"" | b".")
        && identity(folder).is_some_and(|folder| Some(folder) == identity(b"/"))
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
    // `manager` through the `pm` argument. Through `pm` it never derefs `log`,
    // and it derefs `lockfile` only under `Features::workspaces`, which none
    // of the `features` that `get_or_put` passes has.
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
                    file.read_to_end_with_array_list(
                        &mut body.list,
                        bun_sys::SizeHint::ProbablySmall,
                    )?;
                }
                // Like in Yarn, the directory of a `link:<path>` doesn't need a package.json.
                Err(err)
                    if resolver.tag == ResolutionTag::Symlink
                        && dependency::is_link_path(resolver.folder_path)
                        && matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) =>
                {
                    let dir = Path::from(bun_paths::dirname_or_root(abs));
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
    let paths = normalize_package_json_path(GlobalOrRelative::Relative(tag), non_normalized_path)?;
    let mut log = bun_ast::Log::init();
    // `bun add` in a workspace edits the copy in this cache before it writes the file.
    let entry = (manager.workspace_package_json_cache)
        .get_with_path(&mut log, &paths.abs, Default::default())
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
    let Some(mut paths) = normalize_package_json_path(global_or_relative, non_normalized_path)
    else {
        return FolderResolution::Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
    };
    // replace before getting hash
    bun_paths::to_portable_in_place(paths.abs.as_mut_slice());
    bun_paths::to_portable_in_place(paths.rel.as_mut_slice());
    let abs: &ZStr = &paths.abs;
    let rel: &[u8] = &paths.rel;

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
            (ResolutionTag::Symlink, non_normalized_path, Features::LINK)
        }
        GlobalOrRelative::Relative(dependency::version::Tag::Symlink) => {
            link_path = dependency::link_path_for_lockfile(rel);
            (ResolutionTag::Symlink, &*link_path, Features::LINK)
        }
        GlobalOrRelative::Relative(dependency::version::Tag::Folder) => {
            if is_root_above_project(rel) {
                return FolderResolution::Err(crate::Error::MissingPackageJSON);
            }
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

use core::fmt;

use bun_core::fmt::QuotedFormatter;
use bun_core::{ZStr, strings};
use bun_paths::{self, MAX_PATH_BYTES, PathBuffer, SEP, SEP_STR};
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
use crate::resolution::{ResolutionType, Tag as ResolutionTag, TaggedValue};
use crate::versioned_url::VersionedURLType;

#[derive(Copy, Clone)]
pub enum FolderResolution {
    PackageId(PackageID),
    Err(crate::Error),
    NewPackageId(PackageID),
}

// The enum discriminant serves as the tag; expose an alias for it.

pub(crate) struct PackageWorkspaceSearchPathFormatter<'a> {
    pub manager: &'a PackageManager,
    pub version: dependency::Version,
    pub quoted: bool,
}

impl<'a> fmt::Display for PackageWorkspaceSearchPathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut joined = [0u8; MAX_PATH_BYTES + 2];
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

        // SAFETY: joined[2..] is exactly MAX_PATH_BYTES bytes long.
        let joined_path: &mut PathBuffer =
            unsafe { &mut *joined.as_mut_ptr().add(2).cast::<PathBuffer>() };
        let mut paths = normalize_package_json_path(
            GlobalOrRelative::Relative(dependency::version::Tag::Workspace),
            joined_path,
            self.manager.lockfile.str(str_to_use),
        );

        if !strings::starts_with_char(paths.rel, b'.') && !strings::starts_with_char(paths.rel, SEP)
        {
            joined[0] = b'.';
            joined[1] = SEP;
            // `paths.rel` points into `joined[2..]`; extend the view backward
            // by the two bytes just written via safe slicing of `joined`.
            let n = paths.rel.len() + 2;
            paths.rel = &joined[..n];
        }

        if self.quoted {
            let quoted = QuotedFormatter { text: paths.rel };
            fmt::Display::fmt(&quoted, f)
        } else {
            // `fmt::Formatter` only accepts `&str`, so non-UTF-8 path bytes are emitted lossily
            // (U+FFFD) via `bstr::BStr`'s Display. Both current callers pass
            // `quoted = true`, so this branch is unreached today; if a future
            // caller needs byte-exact output it must use an `io::Write` sink.
            write!(f, "{}", bstr::BStr::new(paths.rel))
        }
    }
}

/// Value stored in the folder-resolution map: the resolution plus the
/// normalized absolute `package.json` path the key hash was computed from.
/// Lookups compare the path, since a different path whose hash collides must
/// not reuse this resolution. `link` records whether the entry was resolved as
/// a `link:` target (a `Symlink` resolution parsed with `Features::LINK`, i.e.
/// without its dependencies) rather than as a folder/workspace: the same
/// directory referenced both ways is two different packages, so it is part of
/// the key (see `hash_for`) and of the equality check.
pub struct Entry {
    pub(crate) abs_path: Box<[u8]>,
    pub(crate) link: bool,
    pub(crate) resolution: FolderResolution,
}

// bun_collections::HashMap currently ignores the context/load-factor
// type params (backed by std HashMap); identity hashing is a TODO(perf).

fn normalize(path: &[u8]) -> &[u8] {
    FileSystem::instance().normalize(path)
}

pub(crate) fn hash(normalized_path: &[u8]) -> u64 {
    bun_wyhash::hash(normalized_path)
}

/// Map key: the path hash, in a separate keyspace for `link:` entries so a
/// `link:./x` and a `file:./x` (or workspace) naming the same directory do not
/// share a resolution.
fn hash_for(normalized_path: &[u8], link: bool) -> u64 {
    let h = hash(normalized_path);
    if link { h ^ 0x9E37_79B9_7F4A_7C15 } else { h }
}

// ── NewResolver ───────────────────────────────────────────────────────────
// The const-generic tag requires `#[derive(ConstParamTy)]` (already on `Tag`).
struct NewResolver<'a, const TAG: ResolutionTag> {
    pub(crate) folder_path: &'a [u8],
}

impl<'a, const TAG: ResolutionTag> ResolverContext for NewResolver<'a, TAG> {
    fn check_bundled_dependencies() -> bool {
        matches!(TAG, ResolutionTag::Folder | ResolutionTag::Symlink)
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
        Ok(ResolutionType::<u64>::init(match TAG {
            ResolutionTag::Folder => TaggedValue::Folder(appended),
            ResolutionTag::Symlink => TaggedValue::Symlink(appended),
            ResolutionTag::Workspace => TaggedValue::Workspace(appended),
            _ => unreachable!(),
        }))
    }
}

type Resolver<'a> = NewResolver<'a, { ResolutionTag::Folder }>;
type SymlinkResolver<'a> = NewResolver<'a, { ResolutionTag::Symlink }>;
type WorkspaceResolver<'a> = NewResolver<'a, { ResolutionTag::Workspace }>;

pub(crate) struct CacheFolderResolver {
    pub version: semver::Version,
}

impl ResolverContext for CacheFolderResolver {
    fn check_bundled_dependencies() -> bool {
        true
    }

    fn count(&mut self, _builder: &mut StringBuilder<'_>, _json: &Expr) {}

    fn resolve(
        &mut self,
        _builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> crate::Result<ResolutionType<u64>> {
        Ok(ResolutionType::<u64>::init(TaggedValue::Npm(
            VersionedURLType {
                version: self.version,
                url: SemverString::from(b""),
            },
        )))
    }
}

/// Unifies `NewResolver<TAG>` and `CacheFolderResolver` for
/// `read_package_json_from_disk`; the associated const `IS_WORKSPACE`
/// distinguishes the workspace resolver.
trait FolderResolverImpl: ResolverContext {
    const IS_WORKSPACE: bool;

    /// The stored (root-relative or absolute) target of a path-form `link:`
    /// dependency, if that is what is being resolved. Such a target may be a
    /// plain directory without a `package.json` (yarn/pnpm semantics).
    fn link_path(&self) -> Option<&[u8]> {
        None
    }
}
impl<'a, const TAG: ResolutionTag> FolderResolverImpl for NewResolver<'a, TAG> {
    const IS_WORKSPACE: bool = matches!(TAG, ResolutionTag::Workspace);

    fn link_path(&self) -> Option<&[u8]> {
        (matches!(TAG, ResolutionTag::Symlink) && dependency::is_link_path(self.folder_path))
            .then_some(self.folder_path)
    }
}
impl FolderResolverImpl for CacheFolderResolver {
    const IS_WORKSPACE: bool = false;
}

struct Paths<'a> {
    abs: &'a ZStr,
    rel: &'a [u8],
}

fn normalize_package_json_path<'a>(
    global_or_relative: GlobalOrRelative<'_>,
    joined: &'a mut PathBuffer,
    non_normalized_path: &[u8],
) -> Paths<'a> {
    let abs: &[u8];

    // We consider it valid if there is a package.json in the folder
    let normalized: &[u8] = if non_normalized_path.len() == 1 && non_normalized_path[0] == b'.' {
        non_normalized_path
    } else if bun_paths::is_absolute(non_normalized_path) {
        strings::trim_right(non_normalized_path, SEP_STR.as_bytes())
    } else {
        strings::trim_right(normalize(non_normalized_path), SEP_STR.as_bytes())
    };

    const PACKAGE_JSON_LEN: usize = "/package.json".len();

    let rel: &[u8] = if strings::starts_with_char(normalized, b'.') {
        let mut tempcat = PathBuffer::uninit();

        tempcat[..normalized.len()].copy_from_slice(normalized);
        tempcat[normalized.len()] = SEP;
        tempcat[normalized.len() + 1..normalized.len() + PACKAGE_JSON_LEN]
            .copy_from_slice(b"package.json");
        let parts: [&[u8]; 2] = [
            FileSystem::instance().top_level_dir(),
            &tempcat[0..normalized.len() + PACKAGE_JSON_LEN],
        ];
        abs = FileSystem::instance().abs_buf(&parts, joined);
        FileSystem::instance().relative(
            FileSystem::instance().top_level_dir(),
            &abs[0..abs.len() - PACKAGE_JSON_LEN],
        )
    } else {
        let joined_len = joined.len();
        let mut remain: &mut [u8] = &mut joined[..];
        match &global_or_relative {
            GlobalOrRelative::Global(path) | GlobalOrRelative::CacheFolder(path) => {
                if !path.is_empty() {
                    let offset = path
                        .len()
                        .saturating_sub((path[path.len().saturating_sub(1)] == SEP) as usize);
                    if offset > 0 {
                        remain[0..offset].copy_from_slice(&path[0..offset]);
                    }
                    remain = &mut remain[offset..];
                    if !normalized.is_empty() {
                        if (path[path.len() - 1] != SEP) && (normalized[0] != SEP) {
                            remain[0] = SEP;
                            remain = &mut remain[1..];
                        }
                    }
                }
            }
            GlobalOrRelative::Relative(_) => {}
        }
        remain[..normalized.len()].copy_from_slice(normalized);
        remain[normalized.len()] = SEP;
        remain[normalized.len() + 1..normalized.len() + PACKAGE_JSON_LEN]
            .copy_from_slice(b"package.json");
        let remain_after = remain.len() - (normalized.len() + PACKAGE_JSON_LEN);
        // Compute abs len from remaining capacity.
        let abs_len = joined_len - remain_after;
        abs = &joined[0..abs_len];
        // We store the folder name without package.json
        FileSystem::instance().relative(
            FileSystem::instance().top_level_dir(),
            &abs[0..abs.len() - PACKAGE_JSON_LEN],
        )
    };
    let abs_len = abs.len();
    joined[abs_len] = 0;

    Paths {
        abs: ZStr::from_buf(joined, abs_len),
        rel,
    }
}

fn read_package_json_from_disk<R: FolderResolverImpl>(
    manager: &mut PackageManager,
    abs: &ZStr,
    version: &dependency::Version,
    features: Features,
    resolver: &mut R,
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

    if R::IS_WORKSPACE {
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
            package.parse_with_json::<R>(
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
                    // closed on drop
                    file.read_to_end_with_array_list(
                        &mut body.list,
                        bun_sys::SizeHint::ProbablySmall,
                    )?;
                }
                // A path-form `link:` target may be a plain directory without a
                // package.json: treat it as an empty manifest named after the
                // directory (a lockfile package needs a name), with no dependencies.
                // The directory itself must exist — neither linker opens the target
                // when creating the symlink, so a missing one is reported here
                // (before anything is written) rather than left dangling.
                Err(err)
                    if matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR)
                        && resolver.link_path().is_some() =>
                {
                    let dir = bun_paths::dirname(abs.as_bytes()).unwrap_or(b"");
                    if !matches!(
                        bun_sys::directory_exists_at(Fd::cwd(), &bun_core::ZBox::from_bytes(dir)),
                        Ok(true)
                    ) {
                        return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT));
                    }
                    body.list.extend_from_slice(b"{\"name\":\"");
                    let start = body.list.len();
                    for &c in bun_paths::basename(dir) {
                        if c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.') {
                            body.list.push(c);
                        }
                    }
                    if body.list.len() == start {
                        // nothing usable in the directory name: a stable synthetic one,
                        // hashing the stored project-relative target (not the absolute path)
                        use std::io::Write as _;
                        let stored = resolver.link_path().unwrap_or(b"");
                        let _ = write!(&mut body.list, "link-{:016x}", bun_wyhash::hash(stored));
                    }
                    body.list.extend_from_slice(b"\",\"version\":\"0.0.0\"}");
                }
                Err(err) => return Err(err.into()),
            }

            bun_ast::Source::init_path_string(abs.as_bytes(), body.list.as_slice())
        };

        // SAFETY: see the borrow-splitting comment above.
        unsafe {
            let lockfile: *mut Lockfile = &raw mut *(*manager_ptr).lockfile;
            package.parse::<R>(
                &mut *lockfile,
                &mut *manager_ptr,
                log,
                &source,
                resolver,
                features,
            )?;
        }
    }

    let has_scripts = package.scripts.has_any()
        || 'brk: {
            let dir = bun_paths::dirname(abs.as_bytes()).unwrap_or(b"");
            let binding_dot_gyp_path = bun_paths::resolve_path::join_abs_string_z::<
                bun_paths::platform::Auto,
            >(dir, &[b"binding.gyp" as &[u8]]);
            break 'brk bun_sys::exists(binding_dot_gyp_path.as_bytes());
        };

    package.meta.set_has_install_script(has_scripts);

    if let Some(existing_id) =
        manager
            .lockfile
            .get_package_id(package.name_hash, Some(version), &package.resolution)
    {
        package.meta.id = existing_id;
        manager.lockfile.packages.set(existing_id as usize, package);
        return Ok(*manager.lockfile.packages.get(existing_id as usize));
    }

    Ok(manager.lockfile.append_package(&package)?)
}

#[derive(Copy, Clone)]
pub enum GlobalOrRelative<'a> {
    Global(&'a [u8]),
    Relative(dependency::version::Tag),
    CacheFolder(&'a [u8]),
}

pub(crate) fn get_or_put(
    global_or_relative: GlobalOrRelative<'_>,
    version: &dependency::Version,
    non_normalized_path: &[u8],
    manager: &mut PackageManager,
) -> FolderResolution {
    let mut joined = PathBuffer::uninit();
    #[cfg(windows)]
    let mut rel_buf = PathBuffer::uninit();
    let paths = normalize_package_json_path(global_or_relative, &mut joined, non_normalized_path);

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
    // `link:` targets (name-form under the global dir, or path-form) are parsed
    // with `Features::LINK` into a `Symlink` resolution; the same directory as a
    // `file:`/workspace target is a different package with its own dependencies.
    let link = matches!(
        global_or_relative,
        GlobalOrRelative::Global(_) | GlobalOrRelative::Relative(dependency::version::Tag::Symlink)
    );
    let abs_hash = hash_for(abs.as_bytes(), link);

    // Check first, compute, then insert, because read_package_json_from_disk
    // needs &mut manager. Compare the stored path (and kind), not just its hash:
    // a different path whose hash collides must not reuse this resolution. On a
    // collision, resolve fresh without caching so the first path's entry stays.
    let hash_collision = match manager.folders.get(&abs_hash) {
        Some(existing) if existing.link == link && *existing.abs_path == *abs.as_bytes() => {
            return existing.resolution;
        }
        Some(_) => true,
        None => false,
    };

    let result: crate::Result<LockfilePackage> = match global_or_relative {
        GlobalOrRelative::Global(_) => 'global: {
            let mut path = PathBuffer::uninit();
            path[..non_normalized_path.len()].copy_from_slice(non_normalized_path);
            let mut resolver: SymlinkResolver = NewResolver {
                folder_path: &path[0..non_normalized_path.len()],
            };
            break 'global read_package_json_from_disk(
                manager,
                abs,
                version,
                Features::LINK,
                &mut resolver,
            );
        }
        GlobalOrRelative::Relative(tag) => match tag {
            dependency::version::Tag::Folder => 'folder: {
                let mut resolver: Resolver = NewResolver { folder_path: rel };
                break 'folder read_package_json_from_disk(
                    manager,
                    abs,
                    version,
                    Features::FOLDER,
                    &mut resolver,
                );
            }
            dependency::version::Tag::Workspace => 'workspace: {
                let mut resolver: WorkspaceResolver = NewResolver { folder_path: rel };
                break 'workspace read_package_json_from_disk(
                    manager,
                    abs,
                    version,
                    Features::WORKSPACE,
                    &mut resolver,
                );
            }
            dependency::version::Tag::Symlink => 'symlink: {
                let mut path = PathBuffer::uninit();
                let Some(folder_path) = dependency::link_path_for_lockfile(rel, &mut path) else {
                    break 'symlink Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                };
                let mut resolver: SymlinkResolver = NewResolver { folder_path };
                break 'symlink read_package_json_from_disk(
                    manager,
                    abs,
                    version,
                    Features::LINK,
                    &mut resolver,
                );
            }
            _ => unreachable!(),
        },
        GlobalOrRelative::CacheFolder(_) => 'cache_folder: {
            let mut resolver = CacheFolderResolver {
                // `GlobalOrRelative::CacheFolder` is only passed by
                // `PackageManagerResolution` with a `version.tag == .npm`
                // dependency.
                version: version.npm().version.to_version(),
            };
            break 'cache_folder read_package_json_from_disk(
                manager,
                abs,
                version,
                Features::NPM,
                &mut resolver,
            );
        }
    };

    let package = match result {
        Ok(p) => p,
        Err(err) => {
            let stored = if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                FolderResolution::Err(crate::Error::MissingPackageJSON)
            } else {
                FolderResolution::Err(err)
            };
            if !hash_collision {
                manager.folders.insert(
                    abs_hash,
                    Entry {
                        abs_path: abs.as_bytes().into(),
                        link,
                        resolution: stored,
                    },
                );
            }
            return stored;
        }
    };

    if !hash_collision {
        manager.folders.insert(
            abs_hash,
            Entry {
                abs_path: abs.as_bytes().into(),
                link,
                resolution: FolderResolution::PackageId(package.meta.id),
            },
        );
    }
    FolderResolution::NewPackageId(package.meta.id)
}

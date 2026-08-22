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

        let mut joined = PathBuffer::uninit();
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
            // Too long to be a path; show it as written.
            None => search_path,
        };

        if self.quoted {
            let quoted = QuotedFormatter { text: rel };
            fmt::Display::fmt(&quoted, f)
        } else {
            // `fmt::Formatter` only accepts `&str`, so non-UTF-8 path bytes are emitted lossily
            // (U+FFFD) via `bstr::BStr`'s Display. Both current callers pass
            // `quoted = true`, so this branch is unreached today; if a future
            // caller needs byte-exact output it must use an `io::Write` sink.
            write!(f, "{}", bstr::BStr::new(rel))
        }
    }
}

/// Value stored in the folder-resolution map: the resolution plus the
/// normalized absolute `package.json` path the key hash was computed from.
/// Lookups compare the path, since a different path whose hash collides must
/// not reuse this resolution.
pub struct Entry {
    pub(crate) abs_path: Box<[u8]>,
    pub(crate) resolution: FolderResolution,
}

// bun_collections::HashMap currently ignores the context/load-factor
// type params (backed by std HashMap); identity hashing is a TODO(perf).

pub(crate) fn hash(normalized_path: &[u8]) -> u64 {
    bun_wyhash::hash(normalized_path)
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
}
impl<'a, const TAG: ResolutionTag> FolderResolverImpl for NewResolver<'a, TAG> {
    const IS_WORKSPACE: bool = matches!(TAG, ResolutionTag::Workspace);
}
impl FolderResolverImpl for CacheFolderResolver {
    const IS_WORKSPACE: bool = false;
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
            GlobalOrRelative::Global(path) | GlobalOrRelative::CacheFolder(path)
                if !path.is_empty() =>
            {
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
            let file = File::openat(Fd::cwd(), abs.as_bytes(), O::RDONLY, 0)?;
            body.reset();
            let read_result = file
                .read_to_end_with_array_list(&mut body.list, bun_sys::SizeHint::ProbablySmall)
                .map(|_| ());
            let _ = file.close();
            read_result?;

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
    let abs_hash = hash(abs.as_bytes());

    // Check first, compute, then insert, because read_package_json_from_disk
    // needs &mut manager. Compare the stored path, not just its hash: a
    // different path whose hash collides must not reuse this resolution. On a
    // collision, resolve fresh without caching so the first path's entry stays.
    let hash_collision = match manager.folders.get(&abs_hash) {
        Some(existing) if *existing.abs_path == *abs.as_bytes() => return existing.resolution,
        Some(_) => true,
        None => false,
    };

    let result: crate::Result<LockfilePackage> = match global_or_relative {
        GlobalOrRelative::Global(_) => 'global: {
            // `non_normalized_path` may alias the lockfile string buffer, which grows below.
            let folder_path: Box<[u8]> = Box::from(non_normalized_path);
            let mut resolver: SymlinkResolver = NewResolver {
                folder_path: &folder_path,
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
                resolution: FolderResolution::PackageId(package.meta.id),
            },
        );
    }
    FolderResolution::NewPackageId(package.meta.id)
}

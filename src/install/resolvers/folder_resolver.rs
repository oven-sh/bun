use core::fmt;

use bun_collections::{HashMap, IdentityContext};
use bun_core::fmt::QuotedFormatter;
use bun_core::{ZStr, strings};
use bun_paths::{self, MAX_PATH_BYTES, PathBuffer, SEP, SEP_STR};
use bun_resolver::fs::FileSystem;
use bun_semver::{self as semver, String as SemverString};
use bun_sys::{self, Fd, File, O};

use crate::bun_json::Expr;
use crate::dependency::{self, Dependency};
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
    Err(bun_core::Error),
    NewPackageId(PackageID),
}

// Zig: `pub const Tag = enum { package_id, err, new_package_id };`
// In Rust the enum discriminant serves as the tag; expose an alias for parity.
pub type Tag = core::mem::Discriminant<FolderResolution>;

pub struct PackageWorkspaceSearchPathFormatter<'a> {
    pub manager: &'a PackageManager,
    pub version: dependency::Version,
    pub quoted: bool,
}

impl<'a> PackageWorkspaceSearchPathFormatter<'a> {
    /// Zig default only set `quoted = true`; `manager`/`version` have no
    /// default, so a `Default` impl is not expressible. Construct explicitly.
    pub const DEFAULT_QUOTED: bool = true;
}

impl<'a> fmt::Display for PackageWorkspaceSearchPathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut joined = [0u8; MAX_PATH_BYTES + 2];
        // Zig: `getPtr(@truncate(String.Builder.stringHash(...)))` — key type is
        // `PackageNameHash` (u64), so the @truncate is identity.
        // Caller constructs this formatter only when
        // `self.version.tag == .workspace` (Zig: `formatter.version.value.workspace`).
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
            // Zig: `writer.writeAll(paths.rel)` writes raw bytes. `fmt::Formatter`
            // only accepts `&str`, so non-UTF-8 path bytes are emitted lossily
            // (U+FFFD) via `bstr::BStr`'s Display. Both current callers pass
            // `quoted = true`, so this branch is unreached today; if a future
            // caller needs byte-exact output it must use an `io::Write` sink.
            write!(f, "{}", bstr::BStr::new(paths.rel))
        }
    }
}

// Zig: std.HashMapUnmanaged(u64, FolderResolution, IdentityContext(u64), 80)
// PORT NOTE: bun_collections::HashMap currently ignores the context/load-factor
// type params (backed by std HashMap); identity hashing is a Phase-B perf item.
pub type Map = HashMap<u64, FolderResolution, IdentityContext<u64>>;

pub fn normalize(path: &[u8]) -> &[u8] {
    FileSystem::instance().normalize(path)
}

pub fn hash(normalized_path: &[u8]) -> u64 {
    bun_wyhash::hash(normalized_path)
}

// ── NewResolver(comptime tag: Resolution.Tag) type ────────────────────────
// PORT NOTE: `Resolution.Tag` (Zig nested decl) is `crate::resolution::Tag`;
// const-generic requires `#[derive(ConstParamTy)]` (already on `Tag`).
pub struct NewResolver<'a, const TAG: ResolutionTag> {
    pub folder_path: &'a [u8],
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
    ) -> Result<ResolutionType<u64>, bun_core::Error> {
        // Zig: @unionInit(Resolution.Value, @tagName(tag), builder.append(String, this.folder_path))
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

pub struct CacheFolderResolver {
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
    ) -> Result<ResolutionType<u64>, bun_core::Error> {
        Ok(ResolutionType::<u64>::init(TaggedValue::Npm(
            VersionedURLType {
                version: self.version,
                url: SemverString::from(b""),
            },
        )))
    }
}

/// Unifies `NewResolver<TAG>` and `CacheFolderResolver` for
/// `read_package_json_from_disk` (Zig: `comptime ResolverType: type`). The
/// associated const `IS_WORKSPACE` replaces the
/// `if (comptime ResolverType == WorkspaceResolver)` check.
pub trait FolderResolverImpl: ResolverContext {
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

fn normalize_package_json_path<'a>(
    global_or_relative: GlobalOrRelative<'_>,
    joined: &'a mut PathBuffer,
    non_normalized_path: &[u8],
) -> Paths<'a> {
    let mut abs: &[u8] = b"";
    let rel: &[u8];
    // We consider it valid if there is a package.json in the folder
    let normalized: &[u8] = if non_normalized_path.len() == 1 && non_normalized_path[0] == b'.' {
        non_normalized_path
    } else if bun_paths::is_absolute(non_normalized_path) {
        strings::trim_right(non_normalized_path, SEP_STR.as_bytes())
    } else {
        strings::trim_right(normalize(non_normalized_path), SEP_STR.as_bytes())
    };

    const PACKAGE_JSON_LEN: usize = "/package.json".len();

    if strings::starts_with_char(normalized, b'.') {
        let mut tempcat = PathBuffer::uninit();

        tempcat[..normalized.len()].copy_from_slice(normalized);
        // (std.fs.path.sep_str ++ "package.json")
        tempcat[normalized.len()] = SEP;
        tempcat[normalized.len() + 1..normalized.len() + PACKAGE_JSON_LEN]
            .copy_from_slice(b"package.json");
        let parts: [&[u8]; 2] = [
            FileSystem::instance().top_level_dir(),
            &tempcat[0..normalized.len() + PACKAGE_JSON_LEN],
        ];
        abs = FileSystem::instance().abs_buf(&parts, joined);
        rel = FileSystem::instance().relative(
            FileSystem::instance().top_level_dir(),
            &abs[0..abs.len() - PACKAGE_JSON_LEN],
        );
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
        // PORT NOTE: reshaped for borrowck — compute abs len from remaining capacity
        let abs_len = joined_len - remain_after;
        abs = &joined[0..abs_len];
        // We store the folder name without package.json
        rel = FileSystem::instance().relative(
            FileSystem::instance().top_level_dir(),
            &abs[0..abs.len() - PACKAGE_JSON_LEN],
        );
    }
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
    version: dependency::Version,
    features: Features,
    // PERF(port): was comptime monomorphization (features + ResolverType) — profile in Phase B
    resolver: &mut R,
) -> Result<LockfilePackage, bun_core::Error> {
    let mut body = npm::Registry::BodyPool::get();
    // defer Npm.Registry.BodyPool.release(body) — handled by PoolGuard Drop

    let mut package: LockfilePackage = Default::default();

    // PORT NOTE: Zig passed `manager.lockfile`, `manager`, `manager.log` as
    // three separate args; Rust borrowck rejects the overlap on `&mut self`,
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

        let json = unsafe { &mut *manager_ptr }
            .workspace_package_json_cache
            .get_with_path(log, abs.as_bytes(), Default::default())
            .unwrap()?;
        // `Expr` is `Copy`; take a raw pointer to `source` so the borrow on
        // `workspace_package_json_cache` ends before `&mut *manager_ptr` is
        // formed for `parse_with_json`.
        let root: Expr = json.root;
        let source: *const bun_ast::Source = &raw const json.source;

        // SAFETY: see PORT NOTE above on borrow splitting.
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
            // defer file.close()
            body.reset();
            // PORT NOTE: toManaged/moveToUnmanaged dance is a no-op in Rust
            // (Vec owns its allocator).
            let read_result = file
                .read_to_end_with_array_list(&mut body.list, bun_sys::SizeHint::ProbablySmall)
                .map(|_| ());
            let _ = file.close();
            read_result?;

            bun_ast::Source::init_path_string(abs.as_bytes(), body.list.as_slice())
        };

        // SAFETY: see PORT NOTE above on borrow splitting.
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

    Ok(manager.lockfile.append_package(package)?)
}

#[derive(Copy, Clone)]
pub enum GlobalOrRelative<'a> {
    Global(&'a [u8]),
    Relative(dependency::version::Tag),
    CacheFolder(&'a [u8]),
}

pub fn get_or_put(
    global_or_relative: GlobalOrRelative<'_>,
    version: dependency::Version,
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
        // Zig (folder_resolver.zig:249-252) does `@constCast(abs)` /
        // `@constCast(rel)` and mutates in place — well-defined in Zig, which
        // has no provenance-based aliasing model. In Rust, writing through
        // `(&ZStr).as_ptr().cast_mut()` / `(&[u8]).as_ptr().cast_mut()` is UB
        // under Stacked/Tree Borrows: those pointers carry read-only
        // provenance, and the optimizer may assume `abs`'s bytes are
        // unchanged when computing `hash(abs.as_bytes())` below.
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

    // PORT NOTE: reshaped for borrowck — Zig used getOrPut to reserve the slot before reading
    // package.json; here we check first, compute, then insert, because read_package_json_from_disk
    // needs &mut manager.
    if let Some(existing) = manager.folders.get(&abs_hash) {
        return *existing;
    }

    let result: Result<LockfilePackage, bun_core::Error> = match global_or_relative {
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
            _ => unreachable!(),
        },
        GlobalOrRelative::CacheFolder(_) => 'cache_folder: {
            let mut resolver = CacheFolderResolver {
                // `GlobalOrRelative::CacheFolder` is only passed by
                // `PackageManagerResolution` with a `version.tag == .npm`
                // dependency (Zig: `version.value.npm.version.toVersion()`).
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
            let stored = if err == bun_core::err!("FileNotFound") || err == bun_core::err!("ENOENT")
            {
                FolderResolution::Err(bun_core::err!("MissingPackageJSON"))
            } else {
                FolderResolution::Err(err)
            };
            manager.folders.insert(abs_hash, stored);
            return stored;
        }
    };

    manager
        .folders
        .insert(abs_hash, FolderResolution::PackageId(package.meta.id));
    FolderResolution::NewPackageId(package.meta.id)
}

// ported from: src/install/resolvers/folder_resolver.zig

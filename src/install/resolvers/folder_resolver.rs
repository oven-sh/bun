use core::fmt;

use bun_collections::{HashMap, IdentityContext};
use bun_core::fmt::QuotedFormatter;
use bun_logger as logger;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
// MOVE_DOWN(b0): bun_resolver::fs → bun_sys::fs
use bun_sys::fs::FileSystem;
use bun_semver::{self as semver, String as SemverString};
use bun_semver::version::VersionInt;
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd, File, O};

use crate::bun_json::Expr;
use crate::dependency::{self, Dependency};
use crate::install::{Features, PackageID};
use crate::lockfile::{Lockfile, StringBuilder};
use crate::lockfile::Package as LockfilePackage;
use crate::lockfile::package::ResolverContext;
use crate::package_manager_real::PackageManager;
use crate::npm;
use crate::resolution::{
    Resolution, ResolutionType, Tag as ResolutionTag, TaggedValue, Value as ResolutionValue,
};
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

impl<'a> fmt::Display for PackageWorkspaceSearchPathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut joined = [0u8; MAX_PATH_BYTES + 2];
        // Zig: `getPtr(@truncate(String.Builder.stringHash(...)))` — key type is
        // `PackageNameHash` (u64), so the @truncate is identity.
        // SAFETY: caller constructs this formatter only when
        // `self.version.tag == .workspace`, so the `workspace` union arm is
        // initialized (Zig: `formatter.version.value.workspace`).
        let workspace = unsafe { &self.version.value.workspace };
        let str_to_use = self
            .manager
            .lockfile
            .workspace_paths
            .get(
                &semver::string::Builder::string_hash(
                    self.manager.lockfile.str(workspace),
                ),
            )
            .unwrap_or(workspace);

        // SAFETY: joined[2..] is exactly MAX_PATH_BYTES bytes long.
        let joined_path: &mut PathBuffer = unsafe {
            &mut *(joined.as_mut_ptr().add(2) as *mut PathBuffer)
        };
        let mut paths = normalize_package_json_path(
            GlobalOrRelative::Relative(dependency::version::Tag::Workspace),
            joined_path,
            self.manager.lockfile.str(str_to_use),
        );

        if !strings::starts_with_char(paths.rel, b'.')
            && !strings::starts_with_char(paths.rel, SEP)
        {
            joined[0] = b'.';
            joined[1] = SEP;
            // SAFETY: paths.rel points into joined[2..]; extend the view backward by 2.
            paths.rel = unsafe {
                core::slice::from_raw_parts(joined.as_ptr(), paths.rel.len() + 2)
            };
        }

        if self.quoted {
            let quoted = QuotedFormatter { text: paths.rel };
            fmt::Display::fmt(&quoted, f)
        } else {
            // Zig `writer.writeAll(bytes)` — paths are byte slices that may not
            // be valid UTF-8 on every platform, so go through `bstr`'s lossy
            // `Display` impl.
            write!(f, "{}", bstr::BStr::new(paths.rel))
        }
    }
}

// Zig: std.HashMapUnmanaged(u64, FolderResolution, IdentityContext(u64), 80)
pub type Map = HashMap<u64, FolderResolution, IdentityContext<u64>>;

pub fn normalize(path: &[u8]) -> &[u8] {
    FileSystem::instance().normalize(path)
}

pub fn hash(normalized_path: &[u8]) -> u64 {
    bun_wyhash::hash(normalized_path)
}

// ── NewResolver(comptime tag: Resolution.Tag) type ────────────────────────
// PORT NOTE: `Resolution.Tag` (Zig nested decl) is `crate::resolution::Tag` in Rust;
// const-generic requires `#[derive(ConstParamTy)]` on that enum (added in resolution.rs).
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

    fn resolve<SemverIntType: VersionInt>(
        &mut self,
        builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<SemverIntType>, bun_core::Error> {
        // Zig: @unionInit(Resolution.Value, @tagName(tag), builder.append(String, this.folder_path))
        let appended = builder.append::<SemverString>(self.folder_path);
        Ok(ResolutionType::init(match TAG {
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

    fn resolve<SemverIntType: VersionInt>(
        &mut self,
        _builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<SemverIntType>, bun_core::Error> {
        // The npm payload is the only `Resolution.Value` variant whose layout
        // depends on `SemverIntType` (it carries `Version<SemverIntType>`).
        // `parse_with_json` always invokes `resolve::<u64>`, so build the
        // concrete `Resolution` (= `ResolutionType<u64>`) and cast it back to
        // the generic — a no-op at the only call site.
        let resolution = Resolution::init(TaggedValue::Npm(VersionedURLType {
            version: self.version,
            url: SemverString::from(b""),
        }));
        debug_assert_eq!(
            core::mem::size_of::<ResolutionType<SemverIntType>>(),
            core::mem::size_of::<Resolution>(),
        );
        // SAFETY: `ResolutionType<SemverIntType>` only differs from
        // `ResolutionType<u64>` in `Value::npm.version`'s integer width; the
        // sole caller monomorphizes with `SemverIntType = u64`, so the layouts
        // are identical (asserted above).
        Ok(unsafe { core::mem::transmute_copy(&resolution) })
    }
}

/// Compile-time check replacing Zig's `if (comptime ResolverType == WorkspaceResolver)`.
trait IsWorkspace {
    const IS_WORKSPACE: bool;
}
impl<'a, const TAG: ResolutionTag> IsWorkspace for NewResolver<'a, TAG> {
    const IS_WORKSPACE: bool = matches!(TAG, ResolutionTag::Workspace);
}
impl IsWorkspace for CacheFolderResolver {
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
        // SAFETY: joined[abs_len] == 0 written above
        abs: unsafe { ZStr::from_raw(joined.as_ptr(), abs_len) },
        rel,
    }
}

fn read_package_json_from_disk<R: ResolverContext + IsWorkspace>(
    manager: *mut PackageManager,
    abs: &ZStr,
    version: dependency::Version,
    features: Features,
    // PERF(port): was comptime monomorphization (features + ResolverType) — profile in Phase B
    resolver: &mut R,
) -> Result<LockfilePackage, bun_core::Error> {
    // Zig threaded `manager.lockfile`, `manager`, `manager.log` as three args;
    // Rust borrowck rejects the overlap on `&mut *manager`, so split via the
    // raw pointer once here (mirrors `Package::parse_from_real_manager`).
    // SAFETY: `manager` is `&mut *self` from the sole caller `get_or_put`; the
    // `lockfile` and `log` fields are disjoint from each other and from
    // `workspace_package_json_cache`, and `parse`/`parse_with_json` only reach
    // back into the manager through the `pm` argument they receive — no
    // re-entrancy through `read_package_json_from_disk`.
    macro_rules! split {
        () => {
            unsafe {
                let m = &mut *manager;
                let lockfile: *mut Lockfile = &mut *m.lockfile;
                let log: *mut logger::Log = m.log;
                (&mut *lockfile, &mut *manager, &mut *log)
            }
        };
    }

    let mut body = npm::Registry::BodyPool::get();
    // defer Npm.Registry.BodyPool.release(body) — handled by PoolGuard's Drop.

    let mut package = LockfilePackage::default();

    if R::IS_WORKSPACE {
        let _tracer = bun_perf::trace(
            bun_perf::PerfEvent::FolderResolverReadPackageJSONFromDiskWorkspace,
        );

        // SAFETY: see split! comment.
        let json = unsafe {
            let m = &mut *manager;
            let log: &mut logger::Log = &mut *m.log;
            m.workspace_package_json_cache
                .get_with_path(log, abs.as_bytes(), Default::default())
                .unwrap()?
        };

        let (lockfile, pm, log) = split!();
        package.parse_with_json(
            lockfile,
            pm,
            log,
            &json.source,
            json.root,
            resolver,
            features,
        )?;
    } else {
        let _tracer =
            bun_perf::trace(bun_perf::PerfEvent::FolderResolverReadPackageJSONFromDiskFolder);

        let source = &{
            let file = File::from_fd(
                bun_sys::openat_a(Fd::cwd(), abs.as_bytes(), O::RDONLY, 0)?,
            );
            // defer file.close()
            let file = scopeguard::guard(file, |f| {
                let _ = f.close();
            });

            body.reset();
            // PORT NOTE: Zig's `toManaged`/`moveToUnmanaged` dance is a no-op
            // in Rust — `Vec` already owns its allocator.
            let _ = file
                .read_to_end_with_array_list(&mut body.list, bun_sys::SizeHint::ProbablySmall)?;

            logger::Source::init_path_string(abs.as_bytes(), body.list.as_slice())
        };

        let (lockfile, pm, log) = split!();
        package.parse(lockfile, pm, log, source, resolver, features)?;
    }

    let has_scripts = package.scripts.has_any() || {
        let dir = bun_paths::dirname(abs.as_bytes()).unwrap_or(b"");
        let binding_dot_gyp_path =
            bun_paths::resolve_path::join_abs_string_z::<bun_paths::platform::Auto>(
                dir,
                &[b"binding.gyp" as &[u8]],
            );
        bun_sys::exists(binding_dot_gyp_path.as_bytes())
    };

    package.meta.set_has_install_script(has_scripts);

    // SAFETY: disjoint borrow of `manager.lockfile`; see split! comment.
    let lockfile: &mut Lockfile = unsafe { &mut (*manager).lockfile };
    if let Some(existing_id) =
        lockfile.get_package_id(package.name_hash, Some(version), &package.resolution)
    {
        package.meta.id = existing_id;
        lockfile.packages.set(existing_id as usize, package);
        return Ok(lockfile.packages.get(existing_id as usize));
    }

    Ok(lockfile.append_package(package)?)
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
    let paths = normalize_package_json_path(global_or_relative, &mut joined, non_normalized_path);
    let abs = paths.abs;
    let rel = paths.rel;

    // replace before getting hash. rel may or may not be contained in abs
    #[cfg(windows)]
    {
        // SAFETY: abs/rel point into `joined` (or a threadlocal buffer) which is mutable here.
        bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(unsafe {
            core::slice::from_raw_parts_mut(abs.as_ptr() as *mut u8, abs.len())
        });
        bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(unsafe {
            core::slice::from_raw_parts_mut(rel.as_ptr() as *mut u8, rel.len())
        });
    }
    let abs_hash = hash(abs.as_bytes());

    // PORT NOTE: reshaped for borrowck — Zig used getOrPut to reserve the slot before reading
    // package.json; here we check first, compute, then insert, because read_package_json_from_disk
    // needs &mut manager.
    if let Some(existing) = manager.folders.get(&abs_hash) {
        return *existing;
    }

    let manager_ptr: *mut PackageManager = manager;

    let result: Result<LockfilePackage, bun_core::Error> = match global_or_relative {
        GlobalOrRelative::Global(_) => {
            let mut path = PathBuffer::uninit();
            path[..non_normalized_path.len()].copy_from_slice(non_normalized_path);
            let mut resolver: SymlinkResolver = NewResolver {
                folder_path: &path[0..non_normalized_path.len()],
            };
            read_package_json_from_disk(
                manager_ptr,
                abs,
                version,
                Features::LINK,
                &mut resolver,
            )
        }
        GlobalOrRelative::Relative(tag) => match tag {
            dependency::version::Tag::Folder => {
                let mut resolver: Resolver = NewResolver { folder_path: rel };
                read_package_json_from_disk(
                    manager_ptr,
                    abs,
                    version,
                    Features::FOLDER,
                    &mut resolver,
                )
            }
            dependency::version::Tag::Workspace => {
                let mut resolver: WorkspaceResolver = NewResolver { folder_path: rel };
                read_package_json_from_disk(
                    manager_ptr,
                    abs,
                    version,
                    Features::WORKSPACE,
                    &mut resolver,
                )
            }
            _ => unreachable!(),
        },
        GlobalOrRelative::CacheFolder(_) => {
            let mut resolver = CacheFolderResolver {
                // SAFETY: `GlobalOrRelative::CacheFolder` is only passed by
                // `PackageManagerResolution` with a `version.tag == .npm`
                // dependency (Zig: `version.value.npm.version.toVersion()`).
                version: unsafe { version.value.npm.version.to_version() },
            };
            read_package_json_from_disk(
                manager_ptr,
                abs,
                version,
                Features::NPM,
                &mut resolver,
            )
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/resolvers/folder_resolver.zig (352 lines)
//   confidence: high
//   notes:      const-generic Resolution::Tag needs ConstParamTy; getOrPut reshaped (lookup→compute→insert) for borrowck; read_package_json_from_disk borrow-splits manager via raw pointer (mirrors Package::parse_from_real_manager).
// ──────────────────────────────────────────────────────────────────────────

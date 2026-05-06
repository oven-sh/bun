use core::fmt;

use bun_collections::{HashMap, IdentityContext};
use bun_core::fmt::QuotedFormatter;
use bun_js_parser as js_ast;
use bun_logger as logger;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
// MOVE_DOWN(b0): bun_resolver::fs → bun_sys::fs
use bun_sys::fs::FileSystem;
use bun_semver::{self as semver, String as SemverString};
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd, File, O};

use crate::dependency::{self, Dependency};
use crate::install::{Features, Lockfile, PackageID, PackageManager};
use crate::npm;
use crate::resolution::Resolution;

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

impl<'a> Default for PackageWorkspaceSearchPathFormatter<'a> {
    fn default() -> Self {
        // TODO(port): Zig default only set `quoted = true`; manager has no default.
        unreachable!("construct PackageWorkspaceSearchPathFormatter with explicit fields")
    }
}

impl<'a> fmt::Display for PackageWorkspaceSearchPathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut joined = [0u8; MAX_PATH_BYTES + 2];
        let str_to_use = self
            .manager
            .lockfile
            .workspace_paths
            .get_ptr(
                SemverString::Builder::string_hash(
                    self.manager.lockfile.str(&self.version.value.workspace),
                ) as u32, // @truncate
            )
            .unwrap_or(&self.version.value.workspace);

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
            write!(f, "{}", bstr::BStr::new(paths.rel))
            // TODO(port): writer.writeAll(bytes) — Display only accepts &str; consider a byte-writer trait
        }
    }
}

// Zig: std.HashMapUnmanaged(u64, FolderResolution, IdentityContext(u64), 80)
// TODO(port): bun_collections::HashMap needs identity-hash context + 80% max load factor
pub type Map = HashMap<u64, FolderResolution, IdentityContext<u64>>;

pub fn normalize(path: &[u8]) -> &[u8] {
    FileSystem::instance().normalize(path)
}

pub fn hash(normalized_path: &[u8]) -> u64 {
    bun_wyhash::hash(normalized_path)
}

// ── NewResolver(comptime tag: Resolution.Tag) type ────────────────────────
// TODO(port): requires `#[derive(core::marker::ConstParamTy, PartialEq, Eq)]` on `Resolution::Tag`
pub struct NewResolver<'a, const TAG: Resolution::Tag> {
    pub folder_path: &'a [u8],
}

impl<'a, const TAG: Resolution::Tag> NewResolver<'a, TAG> {
    pub fn resolve<B>(&self, builder: B, _json: js_ast::Expr) -> Result<Resolution, bun_core::Error> {
        // TODO(port): narrow error set
        // Zig: @unionInit(Resolution.Value, @tagName(tag), builder.append(String, this.folder_path))
        let appended = builder.append::<SemverString>(self.folder_path);
        // TODO(port): @unionInit by tag name — Resolution::Value variant chosen by TAG.
        let value = match TAG {
            Resolution::Tag::Folder => Resolution::Value::Folder(appended),
            Resolution::Tag::Symlink => Resolution::Value::Symlink(appended),
            Resolution::Tag::Workspace => Resolution::Value::Workspace(appended),
            _ => unreachable!(),
        };
        Ok(Resolution { tag: TAG, value })
    }

    pub fn count<B>(&self, builder: B, _json: js_ast::Expr) {
        builder.count(self.folder_path);
    }

    pub const fn check_bundled_dependencies() -> bool {
        matches!(TAG, Resolution::Tag::Folder | Resolution::Tag::Symlink)
    }
}

type Resolver<'a> = NewResolver<'a, { Resolution::Tag::Folder }>;
type SymlinkResolver<'a> = NewResolver<'a, { Resolution::Tag::Symlink }>;
type WorkspaceResolver<'a> = NewResolver<'a, { Resolution::Tag::Workspace }>;

pub struct CacheFolderResolver {
    pub version: semver::Version,
}

impl CacheFolderResolver {
    pub fn resolve<B>(&self, _builder: B, _json: js_ast::Expr) -> Result<Resolution, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Resolution {
            tag: Resolution::Tag::Npm,
            value: Resolution::Value::Npm(crate::resolution::NpmResolution {
                version: self.version,
                url: SemverString::from(b""),
            }),
        })
    }

    pub fn count<B>(&self, _builder: B, _json: js_ast::Expr) {}

    pub const fn check_bundled_dependencies() -> bool {
        true
    }
}

// TODO(port): trait to unify NewResolver<TAG> and CacheFolderResolver for `read_package_json_from_disk`
// (Zig used `comptime ResolverType: type`). The associated const `IS_WORKSPACE` replaces the
// `if (comptime ResolverType == WorkspaceResolver)` check.
pub trait FolderResolverImpl {
    const IS_WORKSPACE: bool;
}
impl<'a, const TAG: Resolution::Tag> FolderResolverImpl for NewResolver<'a, TAG> {
    const IS_WORKSPACE: bool = matches!(TAG, Resolution::Tag::Workspace);
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
            FileSystem::instance().top_level_dir,
            &tempcat[0..normalized.len() + PACKAGE_JSON_LEN],
        ];
        abs = FileSystem::instance().abs_buf(&parts, joined);
        rel = FileSystem::instance().relative(
            FileSystem::instance().top_level_dir,
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
            FileSystem::instance().top_level_dir,
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

fn read_package_json_from_disk<R: FolderResolverImpl>(
    manager: &mut PackageManager,
    abs: &ZStr,
    version: dependency::Version,
    features: Features,
    // PERF(port): was comptime monomorphization (features + ResolverType) — profile in Phase B
    resolver: &mut R,
) -> Result<Lockfile::Package, bun_core::Error> {
    // TODO(port): narrow error set
    let mut body = npm::Registry::BodyPool::get();
    // defer Npm.Registry.BodyPool.release(body) — handled by guard Drop

    let mut package = Lockfile::Package::default();

    if R::IS_WORKSPACE {
        let _tracer = bun_perf::trace("FolderResolver.readPackageJSONFromDisk.workspace");

        let json = manager
            .workspace_package_json_cache
            .get_with_path(manager.log, abs, Default::default())
            .unwrap()?;

        package.parse_with_json(
            manager.lockfile,
            manager,
            manager.log,
            &json.source,
            json.root,
            resolver,
            features,
        )?;
    } else {
        let _tracer = bun_perf::trace("FolderResolver.readPackageJSONFromDisk.folder");

        let source = &'brk: {
            let file = File::from(
                bun_sys::openat_a(Fd::cwd(), abs.as_bytes(), O::RDONLY, 0).unwrap()?,
            );
            // defer file.close() — TODO(port): File should impl Drop to close

            {
                body.data.reset();
                // TODO(port): toManaged/moveToUnmanaged dance is a no-op in Rust (Vec owns its allocator)
                file.read_to_end_with_array_list(&mut body.data.list, bun_sys::ReadHint::ProbablySmall)
                    .unwrap()?;
            }

            break 'brk logger::Source::init_path_string(abs.as_bytes(), body.data.list.as_slice());
        };

        package.parse(
            manager.lockfile,
            manager,
            manager.log,
            source,
            resolver,
            features,
        )?;
    }

    let has_scripts = package.scripts.has_any() || 'brk: {
        let dir = bun_paths::dirname(abs.as_bytes()).unwrap_or(b"");
        let binding_dot_gyp_path = bun_paths::join_abs_string_z(
            dir,
            &[b"binding.gyp" as &[u8]],
            bun_paths::Platform::Auto,
        );
        break 'brk bun_sys::exists(binding_dot_gyp_path);
    };

    package.meta.set_has_install_script(has_scripts);

    if let Some(existing_id) =
        manager
            .lockfile
            .get_package_id(package.name_hash, version, &package.resolution)
    {
        package.meta.id = existing_id;
        manager.lockfile.packages.set(existing_id, package);
        return Ok(manager.lockfile.packages.get(existing_id));
    }

    manager.lockfile.append_package(package)
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
        // TODO(port): @constCast — verify rel is always backed by mutable storage
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

    let result: Result<Lockfile::Package, bun_core::Error> = match global_or_relative {
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
                version: version.value.npm.version.to_version(),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/resolvers/folder_resolver.zig (352 lines)
//   confidence: medium
//   todos:      12
//   notes:      const-generic Resolution::Tag needs ConstParamTy; getOrPut reshaped (lookup→compute→insert) for borrowck; Paths/normalize_package_json_path lifetimes are aliasing-heavy (abs/rel both borrow joined + threadlocal)
// ──────────────────────────────────────────────────────────────────────────

use bun_alloc::AllocError;

use crate::Error;
use crate::bun_fs::FileSystem;
use crate::lockfile_real::package::PackageColumns;
use crate::repository::Repository;
use bun_core::ZStr;
use bun_core::{Global, Output, ZBox, env_var, fmt as bun_fmt};
use bun_dotenv::Loader as DotEnvLoader;
use bun_install::lockfile::{Format as LockfileFormat, LoadResult, Lockfile};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{Dependency, Integrity, PackageID, Resolution};
use bun_paths::{self as path, AbsPath, PathBuffer, SEP};
use bun_semver as Semver;
#[cfg(windows)]
use bun_sys::FdDirExt;
use bun_sys::{self as sys, Dir, Fd, File};

use crate::bun_progress::Node as ProgressNode;

use super::options::{self, Enable, LogLevel};
use super::{Command, PackageManager, ProgressStrings, Subcommand};

// ───────────────────────────── method wrappers ───────────────────────────────
// Thin `&mut self` shims so call sites can use method-style spelling
// (`pm.getCacheDirectory()` / `pm.getTemporaryDirectory()`). The bodies live
// in the free functions below to keep them callable without an `impl` path.

impl PackageManager {
    /// Borrowed view of the cached cache-directory fd. Returns `Fd` (not `Dir`)
    /// because the descriptor is owned by `self.cache_directory` — handing out
    /// an owning `Dir` would close the cached fd when the caller drops it.
    /// Callers that need `Dir` methods should use `Dir::borrow(&fd)`.
    #[inline]
    pub(crate) fn get_cache_directory(&mut self) -> Fd {
        get_cache_directory(self)
    }

    /// Snapshot the four `PackageManager` scalars
    /// `PackageManifestMap::by_name_hash_allow_expired`'s disk-fallback path
    /// reads. Captured by value so the loop body can hold `&mut self.manifests`
    /// alongside `&self.lockfile` / `&self.options` without aliasing the whole
    /// `&mut self` (which would be Stacked-Borrows UB).
    ///
    /// The cache directory is opened lazily here only when
    /// `options.enable.manifest_cache` is set (the only branch that reads it).
    #[inline]
    pub fn manifest_disk_cache_ctx(&mut self) -> crate::package_manifest_map::DiskCacheCtx {
        let enable_manifest_cache = self.options.enable.manifest_cache();
        crate::package_manifest_map::DiskCacheCtx {
            enable_manifest_cache,
            enable_manifest_cache_control: self.options.enable.manifest_cache_control(),
            cache_directory: enable_manifest_cache.then(|| get_cache_directory(self)),
            timestamp_for_manifest_cache_control: self.timestamp_for_manifest_cache_control,
            accept_expired: self.options.offline != super::options::OfflineMode::Online,
        }
    }

    #[inline]
    pub(crate) fn get_temporary_directory(&mut self) -> &'static TemporaryDirectory {
        get_temporary_directory(self)
    }

    /// Prints `why` and exits. Auto-install only logs `why`, and the import that needed the
    /// directory then throws it.
    pub(crate) fn exit_or_log(&mut self, why: &DirectoryError) {
        if !self.options.runtime_auto_install {
            Output::err_generic("{}", (why,));
            Global::exit(1);
        }
        self.log_mut()
            .add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("{why}"));
    }
}

/// Why a directory that the package manager needs could not be opened. `Display` gives the
/// message that the user sees.
#[derive(thiserror::Error, Debug)]
pub enum DirectoryError {
    #[error("cannot write files: {}", bun_fmt::s(.0.name()))]
    OpenCache(sys::Error),
    #[error("cannot access tempdir: {}", bun_fmt::s(.0.name()))]
    OpenTemporary(sys::Error),
    #[error(
        "{} accessing temporary directory. set $BUN_TMPDIR or $BUN_INSTALL",
        bun_fmt::s(.0.name())
    )]
    ProbeTemporary(sys::Error),
    #[error(
        "cannot write files to cache directory \"{}\": {}",
        bun_fmt::s(.cache),
        bun_fmt::s(.err.name())
    )]
    WriteCache { cache: Box<[u8]>, err: sys::Error },
    #[cfg(windows)]
    #[error(
        "{}: failed to read temporary directory path: '{}'",
        bun_fmt::s(.err.name()),
        bun_fmt::s(.path)
    )]
    TemporaryPath {
        path: &'static [u8],
        err: sys::Error,
    },
    #[error("failed to find a global directory for package caching and global link directories")]
    NoGlobal,
    #[error("{}: failed to open global directory", .0.name())]
    OpenGlobal(crate::Error),
    #[error(
        "{}: failed to open global link dir node_modules at '{global_dir}'",
        bun_fmt::s(.err.name())
    )]
    OpenGlobalLink { global_dir: Fd, err: sys::Error },
    #[error("{}: failed to get full path of global directory", bun_fmt::s(.0.name()))]
    GlobalLinkPath(sys::Error),
}

// ───────────────────────────── cache directory ────────────────────────────────

/// Returns a borrowed view (`Fd`) of the lazily-opened cache directory. The
/// descriptor is owned by `PackageManager::cache_directory` (closed only if
/// the singleton is ever dropped). Callers must not close the returned `Fd`;
/// use `Dir::borrow(&fd)` to call `&self` `Dir` methods on it.
#[inline]
pub fn get_cache_directory(this: &mut PackageManager) -> Fd {
    try_get_cache_directory(this).unwrap_or_else(|why| {
        Output::err_generic("{}", (why,));
        Global::crash();
    })
}

/// Like `get_cache_directory`, but returns the error instead of crashing. Auto-install calls this
/// first, because `get_cache_directory` cannot fail once the directory is open.
#[inline]
pub fn try_get_cache_directory(this: &mut PackageManager) -> Result<Fd, DirectoryError> {
    // SAFETY: `&mut PackageManager` is exclusive over every field the raw
    // path projects.
    unsafe { get_cache_directory_raw(this) }.map_err(DirectoryError::OpenCache)
}

/// Raw-pointer entry for callers that hold a disjoint `&mut this.manifests`
/// borrow (see `PackageManifestMap::by_name_hash_allow_expired`). Never
/// materializes a `&mut PackageManager` covering the whole struct — only the
/// disjoint `cache_directory`, `cache_directory_path`, `options.enable`, and
/// `env` fields are projected, so an outstanding `&mut manifests` derived
/// from the same provenance root stays valid under Stacked Borrows.
///
/// # Safety
/// `this` must be valid for reads and writes for the call's duration, and the
/// caller must hold no live borrow that overlaps the fields listed above.
#[inline]
pub(crate) unsafe fn get_cache_directory_raw(this: *mut PackageManager) -> sys::Maybe<Fd> {
    // SAFETY: caller contract — `cache_directory` is disjoint from any
    // borrow the caller holds.
    if let Some(d) = unsafe { (*this).cache_directory.as_ref() } {
        return Ok(d.fd());
    }
    // SAFETY: caller contract — `this` is valid and no live borrow overlaps
    // `options.enable`/`options.cache_directory`/`env`/`cache_directory_path`.
    let d = unsafe { ensure_cache_directory(this) }?;
    let fd = d.fd();
    // SAFETY: as above; single writer.
    unsafe { (*this).cache_directory = Some(d) };
    Ok(fd)
}

#[inline]
pub fn get_cache_directory_and_abs_path(this: &mut PackageManager) -> (Fd, AbsPath) {
    let cache_dir = get_cache_directory(this);
    (
        cache_dir,
        AbsPath::from(this.cache_directory_path.as_bytes())
            .expect("cache_directory_path is absolute"),
    )
}

#[inline]
pub fn get_temporary_directory(this: &mut PackageManager) -> &'static TemporaryDirectory {
    try_get_temporary_directory(this).unwrap_or_else(|why| {
        Output::err_generic("{}", (why,));
        Global::crash();
    })
}

/// Like `get_temporary_directory`, but returns the error instead of crashing. A failure is not
/// cached, so the next call tries again.
pub fn try_get_temporary_directory(
    this: &mut PackageManager,
) -> Result<&'static TemporaryDirectory, DirectoryError> {
    // Split get/set so the closure doesn't need to capture `this`.
    if let Some(td) = GET_TEMPORARY_DIRECTORY_ONCE.get() {
        return Ok(td);
    }
    let td = get_temporary_directory_run(this)?;
    let _ = GET_TEMPORARY_DIRECTORY_ONCE.set(td);
    Ok(GET_TEMPORARY_DIRECTORY_ONCE.get().expect("just set"))
}

pub struct TemporaryDirectory {
    pub(crate) handle: Dir,
    #[cfg(windows)]
    pub(crate) path: ZBox,
    pub(crate) name: &'static [u8],
}

// `TemporaryDirectory` is auto-`Send + Sync`: `Dir` wraps `Fd` (an integer),
// `ZBox` wraps `Box<[u8]>`, and `&'static [u8]` is `Sync`. No `unsafe impl`.
const _: fn() = || {
    fn assert<T: Send + Sync>() {}
    assert::<TemporaryDirectory>();
};

// We need a temporary directory that can be rename()
// This is important for extracting files.
//
// However, we want it to be reused! Otherwise a cache is silly.
//   Error RenameAcrossMountPoints moving react-is to cache dir:
static GET_TEMPORARY_DIRECTORY_ONCE: std::sync::OnceLock<TemporaryDirectory> =
    std::sync::OnceLock::new();

fn get_temporary_directory_run(
    manager: &mut PackageManager,
) -> Result<TemporaryDirectory, DirectoryError> {
    let cache_directory_fd = try_get_cache_directory(manager)?;
    let cache_directory = Dir::borrow(&cache_directory_fd);
    // The chosen tempdir must be on the same filesystem as the cache directory
    // This makes renameat() work
    let temp_dir_name = FileSystem::get_default_temp_dir();

    let mut tried_dot_tmp = false;
    let mut tempdir: Dir =
        match sys::make_path::make_open_path(&Dir::cwd(), temp_dir_name, Default::default()) {
            Ok(d) => d,
            Err(_) => {
                tried_dot_tmp = true;
                match sys::make_path::make_open_path(
                    cache_directory,
                    bun_paths::path_literal!(".tmp"),
                    Default::default(),
                ) {
                    Ok(d) => d,
                    Err(err) => return Err(DirectoryError::OpenTemporary(err)),
                }
            }
        };

    let mut tmpbuf = bun_paths::path_buffer_pool::get();
    let tmpname =
        FileSystem::tmpname(b"hm", &mut tmpbuf, bun_core::fast_random()).expect("unreachable");

    let mut timer = if manager.options.log_level != LogLevel::Silent
        && !bun_core::env_var::feature_flag::BUN_DISABLE_SLOW_FILESYSTEM_WARNING
            .get()
            .unwrap_or(false)
    {
        Some(bun_core::time::Timer::start())
    } else {
        None
    };

    'brk: loop {
        let file = match tempdir.create_file_z(
            tmpname,
            sys::CreateFlags {
                truncate: true,
                ..Default::default()
            },
        ) {
            Ok(f) => f,
            Err(err2) => {
                if !tried_dot_tmp {
                    tried_dot_tmp = true;

                    tempdir = match sys::make_path::make_open_path(
                        cache_directory,
                        bun_paths::path_literal!(".tmp"),
                        Default::default(),
                    ) {
                        Ok(d) => d,
                        Err(err) => return Err(DirectoryError::OpenTemporary(err)),
                    };

                    if verbose_install() {
                        bun_core::pretty_errorln!(
                            "<r><yellow>warn<r>: cannot access tempdir: {}, using fallback",
                            bun_fmt::s(err2.name())
                        );
                    }

                    continue 'brk;
                }
                return Err(DirectoryError::ProbeTemporary(err2));
            }
        };
        let _ = file.close(); // close error is non-actionable

        match sys::renameat_z(tempdir.fd(), tmpname, cache_directory.fd(), tmpname) {
            Ok(()) => {}
            Err(err) => {
                // The rename failed, so the probe is still sitting in `tempdir`.
                let _ = tempdir.delete_file_z(tmpname);
                if !tried_dot_tmp {
                    tried_dot_tmp = true;
                    tempdir = match cache_directory.make_open_path(b".tmp", Default::default()) {
                        Ok(d) => d,
                        Err(err2) => {
                            return Err(DirectoryError::WriteCache {
                                cache: manager.cache_directory_path.as_bytes().into(),
                                err: err2,
                            });
                        }
                    };

                    if verbose_install() {
                        bun_core::pretty_errorln!(
                            "<r><d>info<r>: cannot move files from tempdir: {}, using fallback",
                            bun_fmt::s(err.name())
                        );
                    }

                    continue 'brk;
                }

                return Err(DirectoryError::ProbeTemporary(err));
            }
        }
        let _ = cache_directory.delete_file_z(tmpname);
        break;
    }

    if let Some(timer) = timer.as_mut() {
        let elapsed = timer.read();
        if elapsed > bun_core::time::NS_PER_MS * 100 {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let cache_dir_path: &[u8] = match sys::get_fd_path(cache_directory_fd, &mut path_buf) {
                Ok(p) => &p[..],
                Err(_) => b"it",
            };
            bun_core::pretty_errorln!(
                "<r><yellow>warn<r>: Slow filesystem detected. If {} is a network drive, consider setting $BUN_INSTALL_CACHE_DIR to a local folder.",
                bun_fmt::s(cache_dir_path)
            );
        }
    }

    #[cfg(windows)]
    let mut buf = bun_paths::path_buffer_pool::get();
    #[cfg(windows)]
    let temp_dir_path = match sys::get_fd_path_z(Fd::from_std_dir(&tempdir), &mut buf) {
        Ok(p) => p,
        Err(err) => {
            return Err(DirectoryError::TemporaryPath {
                path: temp_dir_name,
                err,
            });
        }
    };

    // The node-gyp shim is written via `handle` and put on PATH via `name`.
    let name: &'static [u8] = if tried_dot_tmp {
        let joined = path::resolve_path::join::<path::platform::Auto>(&[
            manager.cache_directory_path.as_bytes(),
            b".tmp",
        ]);
        bun_core::handle_oom(FileSystem::instance().dirname_store().append(joined))
    } else {
        temp_dir_name
    };

    Ok(TemporaryDirectory {
        handle: tempdir,
        name,
        #[cfg(windows)]
        path: ZBox::from_bytes(temp_dir_path.as_bytes()),
    })
}

/// # Safety
/// See `get_cache_directory_raw` — only `options.enable`,
/// `options.cache_directory` (read), `env`, and `cache_directory_path` are
/// touched; caller must hold no overlapping borrow on those projections.
/// Borrows into other `options` sub-fields (e.g. `options.registries` /
/// `options.scope`) remain valid.
#[cold]
#[inline(never)]
unsafe fn ensure_cache_directory(this: *mut PackageManager) -> sys::Maybe<Dir> {
    loop {
        // SAFETY: field projections through the caller-provided provenance
        // root; see fn safety contract. Project `enable` narrowly so callers
        // may hold borrows into disjoint `options` sub-fields.
        if unsafe { (*this).options.enable.contains(Enable::CACHE) } {
            // SAFETY: caller-provided provenance root; `env_mut()` itself
            // encapsulates the BackRef deref + singleton-liveness invariant.
            let env = unsafe { &*this }.env_mut();
            // SAFETY: shared read of `options`; disjoint from `cache_directory_path`.
            let configured = unsafe { (*this).options.cache_directory };
            let opened = fetch_cache_directory_path(env, Some(configured)).and_then(|cache_dir| {
                // SAFETY: see fn safety contract.
                unsafe { (*this).cache_directory_path = ZBox::from_bytes(&cache_dir.path) };
                Dir::cwd().make_open_path(&cache_dir.path, Default::default())
            });

            match opened {
                Ok(d) => return Ok(d),
                Err(_) => {
                    // SAFETY: narrow `&mut enable` projection; disjoint from
                    // any `&options.{registries,scope}` the caller may hold.
                    unsafe { (*this).options.enable.set(Enable::CACHE, false) };
                    // SAFETY: see fn safety contract.
                    unsafe { (*this).cache_directory_path = ZBox::from_bytes(b"") };
                    continue;
                }
            }
        }

        // SAFETY: see fn safety contract.
        unsafe {
            (*this).cache_directory_path =
                ZBox::from_bytes(path::resolve_path::join_abs_string::<path::platform::Auto>(
                    FileSystem::instance().top_level_dir(),
                    &[CACHE_IN_PROJECT],
                ))
        };

        return Dir::cwd().make_open_path(CACHE_IN_PROJECT, Default::default());
    }
}

/// Packages are extracted here when the cache is disabled or cannot be opened.
const CACHE_IN_PROJECT: &[u8] = b"node_modules/.cache";

/// Opens the cache directory if it exists, else `node_modules/.cache`. Creates nothing.
pub(crate) fn open_existing_cache_directory(this: &PackageManager) -> Option<Dir> {
    if this.options.enable.contains(Enable::CACHE)
        && let Ok(cache) =
            fetch_cache_directory_path(this.env_mut(), Some(this.options.cache_directory))
        && let Ok(dir) = Dir::open(&cache.path)
    {
        return Some(dir);
    }
    Dir::open(CACHE_IN_PROJECT).ok()
}

pub struct CacheDir {
    pub path: Vec<u8>,
    /// True if no cache directory is configured, so `path` is below the working directory, whoever
    /// owns that.
    pub is_cwd_fallback: bool,
}

/// An empty variable counts as unset, because `abs(&[b""])` would be the project directory.
pub fn fetch_cache_directory_path(
    env: &mut DotEnvLoader,
    configured: Option<&[u8]>,
) -> sys::Maybe<CacheDir> {
    const CWD_FALLBACK: &[u8] = b"node_modules/.bun-cache";
    let variable = |name: &[u8]| {
        env.get(name)
            .filter(|dir| !dir.is_empty())
            .map(options::expand_home)
    };
    let from_env = variable(b"BUN_INSTALL_CACHE_DIR");
    let bun_install = variable(b"BUN_INSTALL");
    let home = env_var::XDG_CACHE_HOME
        .get_not_empty()
        .or_else(|| env_var::HOME.get_not_empty())
        .map(options::expand_home);
    let parts: &[&[u8]] = if let Some(dir) = from_env.as_deref() {
        &[dir]
    } else if let Some(dir) = configured.filter(|dir| !dir.is_empty()) {
        &[dir]
    } else if let Some(dir) = bun_install.as_deref() {
        &[dir, b"install/", b"cache/"]
    } else if let Some(dir) = home.as_deref() {
        &[dir, b".bun/", b"install/", b"cache/"]
    } else {
        &[CWD_FALLBACK]
    };

    let mut buf = path::path_buffer_pool::get();
    let Some(abs) = FileSystem::instance().abs_buf_checked(parts, &mut buf[..]) else {
        return Err(sys::Error::from_code(sys::E::ENAMETOOLONG, sys::Tag::open).with_path(parts[0]));
    };
    Ok(CacheDir {
        path: abs.to_vec(),
        is_cwd_fallback: parts[0] == CWD_FALLBACK,
    })
}

// ─────────────────────── cached folder name printers ──────────────────────────

/// What kind of entry something in the cache root is, going by its name. Each variant lists the
/// code that writes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheEntryKind {
    /// `<name>@<version>...`, `@G@...`, `@GH@...`, `@T@...` (the printers below).
    Package,
    /// `@<scope>`. Contains the scoped `Package` and `Index` entries.
    Scope,
    /// `<name>/<version>...` symlinks to `Package` directories (`ExtractTarball::extract`).
    Index,
    /// `links/`, `<hex>.git`, `@t@` (`RuntimeTranspilerCache`), `.<tmp>` staging, non-directories.
    Other,
}

impl CacheEntryKind {
    pub fn from_name(name: &[u8], kind: sys::EntryKind, in_scope: bool) -> CacheEntryKind {
        if kind != sys::EntryKind::Directory || name.is_empty() || name[0] == b'.' {
            return CacheEntryKind::Other;
        }
        if name[0] == b'@' {
            if in_scope || name.starts_with(b"@t@") {
                return CacheEntryKind::Other;
            }
            return if bun_core::strings::contains_char(&name[1..], b'@') {
                CacheEntryKind::Package
            } else {
                CacheEntryKind::Scope
            };
        }
        if bun_core::strings::contains_char(name, b'@') {
            return CacheEntryKind::Package;
        }
        if name == b"links" || name.ends_with(b".git") {
            return CacheEntryKind::Other;
        }
        CacheEntryKind::Index
    }
}

// PERF: an earlier version used `core::fmt::write` over a `format_args!` of
// `bun_fmt::s` / `hex_int_*` pieces. In Rust that is *dynamic* dispatch — every `{}` argument is a
// `&dyn Display` whose vtable lives in `.data.rel.ro`, and every
// `core::fmt::write` call drags in `Formatter` padding/alignment machinery
// plus a panic-format landing pad for the trailing `.expect("unreachable")`.
// Profiling `install/create-next` showed those vtable + panic-format pages
// getting faulted on the per-package hot path (this runs once per cache
// lookup / extract). Rewrite as straight-line byte copies into the caller's
// buffer: no `dyn`, no `Result`, no panic-format `.text`, no `Location`
// relocs.

/// Append-only cursor over a caller-owned `&mut [u8]`. All writers are
/// infallible: the destination is always a `PathBuffer` (`MAX_PATH_BYTES`,
/// asserted ≥ 1024 elsewhere) and the longest possible payload here —
/// `name@u64.u64.u64-16hex+16HEX@@@<ver>_patch_hash=16hex\0` plus an
/// `@@host__16hex` scope suffix — is bounded well under that. Debug builds
/// keep the bounds check; release elides it so no panic-format code is
/// reachable from this module.
struct ByteCursor<'a> {
    buf: &'a mut [u8],
    at: usize,
}

impl<'a> ByteCursor<'a> {
    #[inline(always)]
    fn new(buf: &'a mut [u8]) -> Self {
        Self { buf, at: 0 }
    }

    #[inline(always)]
    fn put(&mut self, bytes: &[u8]) {
        let end = self.at + bytes.len();
        // `buf` is a `PathBuffer`-sized slice; the maximum formatted length
        // (see type doc) cannot exceed it. Safe slice indexing replaces the
        // raw `as_mut_ptr().add()` write — the bounds check is statically
        // unreachable and LLVM elides it after inlining the fixed-size callers.
        self.buf[self.at..end].copy_from_slice(bytes);
        self.at = end;
    }

    #[inline(always)]
    fn put_byte(&mut self, b: u8) {
        self.buf[self.at] = b;
        self.at += 1;
    }

    /// `{}` for `u64` — decimal, no padding. Semver components are tiny in
    /// practice (1–3 digits) so the 20-byte scratch + reverse-fill beats any
    /// table lookup for code size.
    #[inline(always)]
    fn put_u64_dec(&mut self, n: u64) {
        let mut tmp = bun_fmt::ItoaBuf::new();
        self.put(bun_fmt::itoa(&mut tmp, n));
    }

    /// `{:016x}` / `{:016X}` — fixed 16-nibble u64.
    #[inline(always)]
    fn put_u64_hex16<const LOWER: bool>(&mut self, v: u64) {
        self.put(&bun_fmt::u64_hex_fixed::<LOWER, 16>(v));
    }

    /// `{:x}` — variable-width lower-hex (no leading zeros).
    #[inline(always)]
    fn put_u64_hex_var(&mut self, n: u64) {
        let mut tmp = [0u8; 16];
        self.put(bun_fmt::u64_hex_var_lower(&mut tmp, n));
    }

    /// Two lower-hex digits per byte.
    #[inline(always)]
    fn put_hex_bytes(&mut self, bytes: &[u8]) {
        let end = self.at + bytes.len() * 2;
        bun_fmt::bytes_to_hex_lower(bytes, &mut self.buf[self.at..end]);
        self.at = end;
    }

    /// `@@@{d}` when set.
    #[inline(always)]
    fn put_cache_version(&mut self, v: Option<usize>) {
        if let Some(v) = v {
            self.put(b"@@@");
            self.put_u64_dec(v as u64);
        }
    }

    /// `_patch_hash={x}` when set.
    #[inline(always)]
    fn put_patch_hash(&mut self, hash: Option<u64>) {
        if let Some(h) = hash {
            self.put(b"_patch_hash=");
            self.put_u64_hex_var(h);
        }
    }

    /// NUL-terminate and hand back the borrowed `ZStr`.
    #[inline(always)]
    fn finish_z(self) -> &'a ZStr {
        let at = self.at;
        self.buf[at] = 0;
        ZStr::from_buf(self.buf, at)
    }
}

pub fn cached_git_folder_name_print<'a>(
    buf: &'a mut [u8],
    resolved: &[u8],
    patch_hash: Option<u64>,
) -> &'a ZStr {
    let mut w = ByteCursor::new(buf);
    w.put(b"@G@");
    w.put(resolved);
    w.put_patch_hash(patch_hash);
    w.finish_z()
}

pub fn cached_git_folder_name(
    this: &PackageManager,
    repository: &Repository,
    patch_hash: Option<u64>,
) -> &'static ZStr {
    cached_git_folder_name_print(
        cached_package_folder_name_buf(),
        this.lockfile.str(&repository.resolved),
        patch_hash,
    )
}

pub fn cached_git_folder_name_print_auto(
    this: &PackageManager,
    repository: &Repository,
    patch_hash: Option<u64>,
) -> &'static ZStr {
    if !repository.resolved.is_empty() {
        return cached_git_folder_name(this, repository, patch_hash);
    }

    if !repository.repo.is_empty() && !repository.committish.is_empty() {
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();
        let mut w = ByteCursor::new(cached_package_folder_name_buf());
        w.put(b"@G@");
        w.put(repository.committish.slice(string_buf));
        w.put_cache_version(Some(CacheVersion::CURRENT));
        w.put_patch_hash(patch_hash);
        return w.finish_z();
    }

    ZStr::EMPTY
}

pub fn cached_github_folder_name_print<'a>(
    buf: &'a mut [u8],
    resolved: &[u8],
    patch_hash: Option<u64>,
) -> &'a ZStr {
    let mut w = ByteCursor::new(buf);
    w.put(b"@GH@");
    w.put(resolved);
    w.put_cache_version(Some(CacheVersion::CURRENT));
    w.put_patch_hash(patch_hash);
    w.finish_z()
}

pub fn cached_github_folder_name(
    this: &PackageManager,
    repository: &Repository,
    patch_hash: Option<u64>,
) -> &'static ZStr {
    cached_github_folder_name_print(
        cached_package_folder_name_buf(),
        this.lockfile.str(&repository.resolved),
        patch_hash,
    )
}

pub fn cached_github_folder_name_print_auto(
    this: &PackageManager,
    repository: &Repository,
    patch_hash: Option<u64>,
) -> &'static ZStr {
    if !repository.resolved.is_empty() {
        return cached_github_folder_name(this, repository, patch_hash);
    }

    if !repository.owner.is_empty()
        && !repository.repo.is_empty()
        && !repository.committish.is_empty()
    {
        return cached_github_folder_name_print_guess(
            cached_package_folder_name_buf(),
            this.lockfile.buffers.string_bytes.as_slice(),
            repository,
            patch_hash,
        );
    }

    ZStr::EMPTY
}

// TODO: normalize to alphanumeric
pub fn cached_npm_package_folder_name_print<'a>(
    this: &PackageManager,
    buf: &'a mut [u8],
    name: &[u8],
    version: Semver::Version,
    patch_hash: Option<u64>,
) -> &'a ZStr {
    let scope = this.scope_for_package_name(name);

    if scope.name.is_empty() && !this.options.did_override_default_scope {
        let include_version_number = true;
        return cached_npm_package_folder_print_basename(
            buf,
            name,
            version,
            patch_hash,
            include_version_number,
        );
    }

    let include_version_number = false;
    let spanned_len =
        cached_npm_package_folder_print_basename(buf, name, version, None, include_version_number)
            .as_bytes()
            .len();
    // reshaped for borrowck — resume the cursor at the basename's
    // tail instead of holding the returned `&ZStr` across the re-borrow.
    let scope_url = scope.url.url();
    let mut w = ByteCursor {
        buf,
        at: spanned_len,
    };
    let available = w.buf.len() - spanned_len;
    let visible_len = if scope_url.hostname.len() > 32 || available < 64 {
        scope_url.hostname.len().min(12)
    } else {
        scope_url.hostname.len()
    };
    w.put(b"@@");
    w.put(&scope_url.hostname[..visible_len]);
    // The host alone stands for `https://host/`. With a port, a path or http, it's a different
    // registry on that host.
    if visible_len < scope_url.hostname.len()
        || !scope_url.is_https()
        || !scope_url.port.is_empty()
        || scope_url.pathname.len() > 1
    {
        w.put(b"__");
        w.put_u64_hex16::<true>(Semver::semver_string::Builder::string_hash(scope_url.href));
    }
    w.put_cache_version(Some(CacheVersion::CURRENT));
    w.put_patch_hash(patch_hash);
    w.finish_z()
}

fn cached_github_folder_name_print_guess<'a>(
    buf: &'a mut [u8],
    string_buf: &[u8],
    repository: &Repository,
    patch_hash: Option<u64>,
) -> &'a ZStr {
    let mut w = ByteCursor::new(buf);
    w.put(b"@GH@");
    w.put(repository.owner.slice(string_buf));
    w.put_byte(b'-');
    w.put(repository.repo.slice(string_buf));
    w.put_byte(b'-');
    w.put(repository.committish.slice(string_buf));
    w.put_cache_version(Some(CacheVersion::CURRENT));
    w.put_patch_hash(patch_hash);
    w.finish_z()
}

pub fn cached_npm_package_folder_name(
    this: &PackageManager,
    name: &[u8],
    version: Semver::Version,
    patch_hash: Option<u64>,
) -> &'static ZStr {
    cached_npm_package_folder_name_print(
        this,
        cached_package_folder_name_buf(),
        name,
        version,
        patch_hash,
    )
}

// TODO: normalize to alphanumeric
pub fn cached_npm_package_folder_print_basename<'a>(
    buf: &'a mut [u8],
    name: &[u8],
    version: Semver::Version,
    patch_hash: Option<u64>,
    include_cache_version: bool,
) -> &'a ZStr {
    let cache_ver = if include_cache_version {
        Some(CacheVersion::CURRENT)
    } else {
        None
    };
    let mut w = ByteCursor::new(buf);
    w.put(name);
    w.put_byte(b'@');
    w.put_u64_dec(version.major);
    w.put_byte(b'.');
    w.put_u64_dec(version.minor);
    w.put_byte(b'.');
    w.put_u64_dec(version.patch);
    if version.tag.has_pre() {
        w.put_byte(b'-');
        w.put_u64_hex16::<true>(version.tag.pre.hash);
    }
    if version.tag.has_build() {
        w.put_byte(b'+');
        w.put_u64_hex16::<false>(version.tag.build.hash);
    }
    w.put_cache_version(cache_ver);
    w.put_patch_hash(patch_hash);
    w.finish_z()
}

/// Prints `@T@sha512-<first 16 digest bytes as hex>@@@1`. The name uses the digest because a path
/// or URL can serve different bytes tomorrow.
pub fn cached_tarball_folder_name_print<'a>(
    buf: &'a mut [u8],
    integrity: &Integrity,
    skips_verify: bool,
    tag: ResolutionTag,
    url: &[u8],
    patch_hash: Option<u64>,
) -> &'a ZStr {
    let mut w = ByteCursor::new(buf);
    w.put(b"@T@");
    match integrity.tag.name() {
        // Unverified bytes never get a cache entry named after the lockfile's hash.
        Some(algorithm) if !skips_verify => {
            let digest = integrity.slice();
            w.put(algorithm.as_bytes());
            w.put_byte(b'-');
            w.put_hex_bytes(&digest[..digest.len().min(16)]);
        }
        // `--no-verify`, or a row that has no integrity and gets none (`pins_tarballs`).
        _ => {
            let mut hasher = bun_wyhash::Wyhash11::init(0);
            if tag == ResolutionTag::LocalTarball {
                hasher.update(FileSystem::instance().top_level_dir());
            }
            hasher.update(url);
            hasher.update(integrity.slice());
            w.put_u64_hex16::<true>(hasher.final_());
        }
    }
    w.put_cache_version(Some(CacheVersion::CURRENT));
    w.put_patch_hash(patch_hash);
    w.finish_z()
}

/// Returns an empty name, which callers treat as a cache miss, for a dependency that only gets its
/// integrity during this run.
pub fn cached_tarball_folder_name(
    this: &PackageManager,
    integrity: &Integrity,
    resolution: &Resolution,
    patch_hash: Option<u64>,
) -> &'static ZStr {
    if !integrity.tag.is_supported() && this.pins_tarballs() {
        return ZStr::EMPTY;
    }
    let url = match resolution.tag {
        ResolutionTag::LocalTarball => resolution.local_tarball(),
        _ => resolution.remote_tarball(),
    };
    let print = |skips_verify: bool, patch_hash: Option<u64>| {
        cached_tarball_folder_name_print(
            cached_package_folder_name_buf(),
            integrity,
            skips_verify,
            resolution.tag,
            this.lockfile.str(url),
            patch_hash,
        )
    };
    if !this.skips_verify(resolution.tag) {
        return print(false, patch_hash);
    }
    // Verified bytes are good for every install, so `--no-verify` prefers them. A patched entry is made from its base.
    let has_verified_base = (this.cache_directory.as_ref())
        .is_some_and(|dir| is_package_in_cache_at(dir.fd(), print(false, None), resolution.tag));
    print(!has_verified_base, patch_hash)
}

impl PackageManager {
    /// Returns true if what this run reads from a `file:` path or URL can become the integrity in
    /// bun.lock.
    pub(crate) fn pins_tarballs(&self) -> bool {
        self.options.do_.save_lockfile() && self.options.offline != options::OfflineMode::Offline
    }

    /// `--no-verify` skips the hash check of a download, never of a `file:` tarball.
    pub(crate) fn skips_verify(&self, tag: ResolutionTag) -> bool {
        tag != ResolutionTag::LocalTarball
            && !self.options.do_.contains(options::Do::VERIFY_INTEGRITY)
    }

    /// `named_here` means the names on the command line refer to the package.json that `dependency`
    /// is in.
    pub(crate) fn repins_tarball(
        &self,
        dependency: &Dependency,
        string_buf: &[u8],
        named_here: bool,
    ) -> bool {
        self.pins_tarballs()
            && (self.options.enable.force_install()
                || if self.update_requests.is_empty() {
                    self.to_update
                } else {
                    named_here
                        && self
                            .update_requests
                            .iter()
                            .any(|request| request.matches(dependency, string_buf))
                })
    }

    pub(crate) fn locked_tarball(&self, resolution: &Resolution) -> Option<PackageID> {
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        self.lockfile
            .packages
            .items_resolution()
            .iter()
            .position(|locked| locked.eql(resolution, buf, buf))
            .map(|id| id as PackageID)
    }
}

pub fn is_folder_in_cache(this: &mut PackageManager, folder_path: &ZStr) -> bool {
    sys::directory_exists_at(get_cache_directory(this), folder_path).unwrap_or(false)
}

/// npm and tarball folders must contain `package.json`, git checkouts the `.bun-tag` written last.
pub fn is_package_in_cache_at(cache_dir: Fd, folder_path: &ZStr, tag: ResolutionTag) -> bool {
    let marker: &[u8] = match tag {
        ResolutionTag::Npm | ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
            b"package.json"
        }
        ResolutionTag::Git => b".bun-tag",
        _ => return sys::directory_exists_at(cache_dir, folder_path).unwrap_or(false),
    };
    let mut buf = bun_paths::path_buffer_pool::get();
    let marker_path = path::resolve_path::join_z_buf::<path::platform::Auto>(
        &mut buf.0,
        &[folder_path.as_bytes(), marker],
    );
    sys::exists_at(cache_dir, marker_path)
}

pub fn is_package_in_cache(
    this: &mut PackageManager,
    folder_path: &ZStr,
    tag: ResolutionTag,
) -> bool {
    is_package_in_cache_at(get_cache_directory(this), folder_path, tag)
}

// ─────────────────────────── global directories ───────────────────────────────

pub fn setup_global_dir(manager: &mut PackageManager, ctx: &Command::Context) -> Result<(), Error> {
    // `bun pm -g fetch` gets here from both the `bun pm` dispatcher and `install_with_manager`.
    if manager.options.global_bin_dir.is_valid() {
        return Ok(());
    }
    manager.options.global_bin_dir = options::open_global_bin_dir(ctx.install.as_deref())?;
    let mut out_buffer = bun_paths::path_buffer_pool::get();
    let result = sys::get_fd_path_z(manager.options.global_bin_dir, &mut out_buffer)?;
    let path = FileSystem::instance()
        .dirname_store()
        .append(result.as_bytes_with_nul())?;
    // SAFETY: `path` includes the trailing NUL (we appended `as_bytes_with_nul`)
    // and lives for program lifetime in the dirname store.
    manager.options.bin_path = ZStr::from_slice_with_nul(path);
    Ok(())
}

/// Returns a borrowed view (`Fd`) of the lazily-opened global link directory.
/// The descriptor is owned by `PackageManager::global_link_dir` (closed only if
/// the singleton is ever dropped). Callers must not close the returned `Fd`;
/// use `Dir::borrow(&fd)` to call `&self` `Dir` methods on it.
pub fn global_link_dir(this: &mut PackageManager) -> Fd {
    try_global_link_dir(this).unwrap_or_else(|why| {
        Output::err_generic("{}", (why,));
        Global::exit(1);
    })
}

/// Like `global_link_dir`, but returns the error instead of exiting.
pub fn try_global_link_dir(this: &mut PackageManager) -> Result<Fd, DirectoryError> {
    if let Some(d) = this.global_link_dir.as_ref() {
        return Ok(d.fd());
    }

    let global_dir = match options::open_global_dir(this.options.explicit_global_directory) {
        Ok(d) => Dir::from_fd(d),
        Err(crate::Error::NoGlobalDirectoryFound) => return Err(DirectoryError::NoGlobal),
        Err(err) => return Err(DirectoryError::OpenGlobal(err)),
    };
    let link_dir = match global_dir.make_open_path(b"node_modules", Default::default()) {
        Ok(d) => d,
        Err(err) => {
            // The error message prints this descriptor, and a debug build looks up its path, so
            // the directory has to stay open.
            let global_dir = this.global_dir.insert(global_dir).fd();
            return Err(DirectoryError::OpenGlobalLink { global_dir, err });
        }
    };
    let link_fd = link_dir.fd();
    let mut buf = bun_paths::path_buffer_pool::get();
    let path_ = match sys::get_fd_path(link_fd, &mut buf) {
        Ok(p) => p,
        Err(err) => return Err(DirectoryError::GlobalLinkPath(err)),
    };
    this.global_link_dir_path = Box::<[u8]>::from(bun_core::handle_oom(
        FileSystem::instance().dirname_store().append(path_),
    ));
    this.global_dir = Some(global_dir);
    this.global_link_dir = Some(link_dir);
    Ok(link_fd)
}

pub fn global_link_dir_path(this: &mut PackageManager) -> &[u8] {
    let _ = global_link_dir(this);
    &this.global_link_dir_path
}

// ────────────────────────── cached path resolution ────────────────────────────

/// `FileNotFound` unless the package is in the cache.
pub fn path_for_cached_npm_path<'a>(
    this: &mut PackageManager,
    buf: &'a mut PathBuffer,
    package_name: &[u8],
    version: Semver::Version,
) -> Result<&'a mut [u8], Error> {
    let mut folder_name_buf = bun_paths::path_buffer_pool::get();
    let folder_name = cached_npm_package_folder_name_print(
        this,
        &mut folder_name_buf.0[..],
        package_name,
        version,
        None,
    );
    path_for_cached_folder(this, buf, folder_name, ResolutionTag::Npm)
}

fn path_for_cached_folder<'a>(
    this: &mut PackageManager,
    buf: &'a mut PathBuffer,
    folder_name: &ZStr,
    tag: ResolutionTag,
) -> Result<&'a mut [u8], Error> {
    if !is_package_in_cache(this, folder_name, tag) {
        return Err(Error::FileNotFound);
    }
    let len = path::resolve_path::join_abs_string_buf::<path::platform::Auto>(
        this.cache_directory_path.as_bytes(),
        &mut buf.0[..],
        &[folder_name.as_bytes()],
    )
    .len();
    Ok(&mut buf.0[..len])
}

pub fn path_for_resolution<'a>(
    this: &mut PackageManager,
    package_id: PackageID,
    resolution: &Resolution,
    buf: &'a mut PathBuffer,
) -> Result<&'a mut [u8], Error> {
    // const folder_name = this.cachedNPMPackageFolderName(name, version);
    match resolution.tag {
        ResolutionTag::Npm => {
            let npm = *resolution.npm();
            let package_name_ = this.lockfile.packages.items_name()[package_id as usize];
            // borrowck — `path_for_cached_npm_path` reborrows `this`
            // mutably (for `get_cache_directory`), so the `&this.lockfile`
            // borrow can't be held across it. Copy the name out first.
            let package_name = this.lockfile.str(&package_name_).to_vec();

            path_for_cached_npm_path(this, buf, &package_name, npm.version)
        }
        ResolutionTag::Github => {
            let folder_name = cached_github_folder_name(this, resolution.github(), None);
            path_for_cached_folder(this, buf, folder_name, resolution.tag)
        }
        ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
            let integrity = this.lockfile.packages.items_meta()[package_id as usize].integrity;
            let folder_name = cached_tarball_folder_name(this, &integrity, resolution, None);
            path_for_cached_folder(this, buf, folder_name, resolution.tag)
        }
        _ => Ok(&mut buf.0[..0]),
    }
}

pub struct CacheDirAndSubpath<'a> {
    /// Borrowed view: the descriptor is owned by the `PackageManager` singleton
    /// (or is `Fd::cwd()`); callers must not close it.
    pub(crate) cache_dir: Fd,
    pub(crate) cache_dir_subpath: &'a ZStr,
}

/// this is copy pasted from `installPackageWithNameAndResolution()`
/// it's not great to do this
pub fn compute_cache_dir_and_subpath<'a>(
    manager: &mut PackageManager,
    pkg_name: &[u8],
    resolution: &Resolution,
    integrity: &Integrity,
    folder_path_buf: &'a mut PathBuffer,
    patch_hash: Option<u64>,
) -> CacheDirAndSubpath<'a> {
    let name = pkg_name;
    let mut cache_dir = Fd::cwd();
    let mut cache_dir_subpath: &ZStr = ZStr::EMPTY;

    match resolution.tag {
        ResolutionTag::Npm => {
            let version = resolution.npm().version;
            cache_dir_subpath = cached_npm_package_folder_name(manager, name, version, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        ResolutionTag::Git => {
            let git = resolution.git();
            cache_dir_subpath = cached_git_folder_name(manager, git, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        ResolutionTag::Github => {
            let github = resolution.github();
            cache_dir_subpath = cached_github_folder_name(manager, github, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        ResolutionTag::Folder => {
            let buf = manager.lockfile.buffers.string_bytes.as_slice();
            let folder = resolution.folder().slice(buf);
            // Handle when a package depends on itself via file:
            // example:
            //   "mineflayer": "file:."
            if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                cache_dir_subpath = z_static(b".\0");
            } else {
                folder_path_buf[..folder.len()].copy_from_slice(folder);
                folder_path_buf[folder.len()] = 0;
                cache_dir_subpath = ZStr::from_buf(folder_path_buf, folder.len());
            }
            cache_dir = Fd::cwd();
        }
        ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
            // Open it first, because with `--no-verify` the name depends on what's in the cache.
            cache_dir = get_cache_directory(manager);
            cache_dir_subpath =
                cached_tarball_folder_name(manager, integrity, resolution, patch_hash);
            if cache_dir_subpath.is_empty() {
                Output::err_generic(
                    "no integrity in lockfile for <b>{}@{}<r>, run <cyan>bun install<r> first",
                    (
                        bun_fmt::s(name),
                        bun_fmt::for_terminal(resolution.fmt(
                            manager.lockfile.buffers.string_bytes.as_slice(),
                            bun_fmt::PathSep::Posix,
                        )),
                    ),
                );
                Global::exit(1);
            }
        }
        ResolutionTag::Workspace => {
            let buf = manager.lockfile.buffers.string_bytes.as_slice();
            let folder = resolution.workspace().slice(buf);
            // Handle when a package depends on itself
            if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                cache_dir_subpath = z_static(b".\0");
            } else {
                folder_path_buf[..folder.len()].copy_from_slice(folder);
                folder_path_buf[folder.len()] = 0;
                cache_dir_subpath = ZStr::from_buf(folder_path_buf, folder.len());
            }
            cache_dir = Fd::cwd();
        }
        ResolutionTag::Symlink => {
            // borrowck — `global_link_dir_path` below reborrows
            // `manager` mutably, so copy the symlink target out of the lockfile
            // string buffer first instead of holding a slice across that call.
            let folder = resolution
                .symlink()
                .slice(manager.lockfile.buffers.string_bytes.as_slice())
                .to_vec();

            if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                cache_dir_subpath = z_static(b".\0");
                cache_dir = Fd::cwd();
            } else {
                // A path is relative to the project, a name to the global link dir.
                let is_path = crate::dependency::is_link_path(&folder);
                let directory = if is_path {
                    Fd::cwd()
                } else {
                    global_link_dir(manager)
                };
                let global_link_dir: &[u8] = if is_path {
                    b""
                } else {
                    global_link_dir_path(manager)
                };
                let ptr = &mut folder_path_buf.0[..];
                if global_link_dir.len() + 1 + folder.len() < ptr.len() {
                    let mut off = 0usize;
                    ptr[off..off + global_link_dir.len()].copy_from_slice(global_link_dir);
                    off += global_link_dir.len();
                    if global_link_dir.last().is_some_and(|&c| c != SEP) {
                        ptr[off] = SEP;
                        off += 1;
                    }
                    ptr[off..off + folder.len()].copy_from_slice(&folder);
                    off += folder.len();
                    ptr[off] = 0;
                    let len = off;
                    cache_dir_subpath = ZStr::from_buf(folder_path_buf, len);
                    cache_dir = directory;
                }
            }
        }
        _ => {}
    }

    CacheDirAndSubpath {
        cache_dir,
        cache_dir_subpath,
    }
}

// ─────────────────────────── package.json / lockfile ──────────────────────────

pub(crate) const NEW_PACKAGE_JSON: &[u8] = b"{\"dependencies\": {}}";

pub(crate) fn attempt_to_create_package_json_and_open() -> Result<File, Error> {
    let package_json_file = match Dir::cwd().create_file_z(
        z_static(b"package.json\0"),
        sys::CreateFlags {
            read: true,
            ..Default::default()
        },
    ) {
        Ok(f) => f,
        Err(err) => {
            bun_core::pretty_errorln!(
                "<r><red>error:<r> {} create package.json",
                bun_fmt::s(err.name())
            );
            Global::crash();
        }
    };

    package_json_file.pwrite_all(NEW_PACKAGE_JSON, 0)?;

    Ok(package_json_file)
}

pub fn attempt_to_create_package_json() -> Result<(), Error> {
    let file = attempt_to_create_package_json_and_open()?;
    let _ = file.close(); // close error is non-actionable
    Ok(())
}

pub fn save_lockfile(
    this: &mut PackageManager,
    load_result: &LoadResult,
    save_format: LockfileFormat,
    had_any_diffs: bool,
    // NOTE(dylan-conway): this and `packages_len_before_install` can most likely be deleted
    // now that git dependnecies don't append to lockfile during installation.
    lockfile_before_install: &Lockfile,
    packages_len_before_install: usize,
    log_level: LogLevel,
) -> Result<bool, AllocError> {
    if this.lockfile.is_empty() {
        if !this.options.dry_run {
            'delete: {
                let delete_format = match load_result {
                    LoadResult::NotFound => break 'delete,
                    LoadResult::Err(err) => err.format,
                    LoadResult::Ok(ok) => ok.format,
                };

                match sys::unlinkat(
                    Fd::cwd(),
                    if delete_format == LockfileFormat::Text {
                        bun_paths::path_literal!("bun.lock")
                    } else {
                        bun_paths::path_literal!("bun.lockb")
                    },
                ) {
                    Ok(()) => {}
                    Err(err) => {
                        // we don't care
                        if err.get_errno() == sys::E::ENOENT {
                            if had_any_diffs {
                                return Ok(false);
                            }
                            break 'delete;
                        }

                        if log_level != LogLevel::Silent {
                            Output::err(err, "failed to delete empty lockfile", ());
                        }
                        return Ok(false);
                    }
                }
            }
        }
        if !this.options.global {
            if log_level != LogLevel::Silent {
                match this.subcommand {
                    Subcommand::Remove => bun_core::pretty_errorln!(
                        "\npackage.json has no dependencies! Deleted empty lockfile"
                    ),
                    _ => {
                        bun_core::pretty_errorln!("No packages! Deleted empty lockfile")
                    }
                }
            }
        }

        return Ok(false);
    }

    // `Progress::start`
    // returns `&mut Node` borrowing `this.progress`, which would conflict with
    // the `&mut this` reborrows below. Stash as a raw pointer
    // (the node lives inside `this.progress.root`).
    let mut save_node: *mut ProgressNode = core::ptr::null_mut();

    if log_level.show_progress() {
        this.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        save_node = this.progress.start(ProgressStrings::save(), 0);
        // SAFETY: `save_node` was just set by `progress.start()` and is non-null.
        unsafe { (*save_node).activate() };

        this.progress.refresh();
    }

    let wrote = this.lockfile.save_to_disk(load_result, &this.options);

    // delete binary lockfile if saving text lockfile
    if save_format == LockfileFormat::Text && load_result.loaded_from_binary_lockfile() {
        let _ = sys::unlinkat(Fd::cwd(), bun_paths::path_literal!("bun.lockb"));
    }

    if cfg!(debug_assertions) {
        if !matches!(load_result, LoadResult::NotFound) {
            if load_result.loaded_from_text_lockfile() {
                if !Lockfile::eql(
                    &this.lockfile,
                    lockfile_before_install,
                    packages_len_before_install,
                )? {
                    Output::panic(format_args!("Lockfile non-deterministic after saving"));
                }
            } else {
                if this
                    .lockfile
                    .has_meta_hash_changed(false, packages_len_before_install)
                    .unwrap_or(false)
                {
                    Output::panic(format_args!(
                        "Lockfile metahash non-deterministic after saving"
                    ));
                }
            }
        }
    }

    if log_level.show_progress() {
        // SAFETY: `save_node` was set to a non-null `&mut Node` in the
        // matching `show_progress()` branch above and `this.progress` is
        // unchanged in between.
        unsafe { (*save_node).end() };
        this.progress.refresh();
        this.progress.root.end();
        this.progress = Default::default();
    } else if wrote && log_level != LogLevel::Silent {
        bun_core::pretty_errorln!("Saved lockfile");
        Output::flush();
    }

    Ok(wrote)
}

pub fn update_lockfile_if_needed(
    manager: &mut PackageManager,
    // The caller continues using
    // `load_result` after this call, so take it by shared reference.
    load_result: &LoadResult,
) -> Result<(), Error> {
    if let LoadResult::Ok(ok) = load_result {
        if ok.serializer_result.packages_need_update {
            let mut slice = manager.lockfile.packages.slice();
            for meta in slice.items_meta_mut() {
                // these are possibly updated later, but need to make sure non are zero
                meta.set_has_install_script(false);
            }
        }
    }

    Ok(())
}

pub fn write_yarn_lock(this: &mut PackageManager) -> Result<(), Error> {
    // Printed in the header. A lockfile that was loaded from bun.lock has none.
    let packages_len = this.lockfile.packages.len();
    this.lockfile.meta_hash = this.lockfile.generate_meta_hash(false, packages_len)?;
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    crate::lockfile_real::printer::Yarn::print(&this.lockfile, &mut buf)?;
    crate::lockfile_real::replace_in_cwd(z_static(b"yarn.lock\0"), &buf, 0o666);
    Ok(())
}

// ────────────────────────────── formatters ────────────────────────────────────

pub(crate) struct CacheVersion;
impl CacheVersion {
    pub(crate) const CURRENT: usize = 1;
}

// ────────────────────────────── helpers ───────────────────────────────────────

#[inline]
fn verbose_install() -> bool {
    // SAFETY: `VERBOSE_INSTALL` is set once during single-threaded CLI startup
    // (PackageManagerOptions.load) and only read on the main thread.
    PackageManager::verbose_install()
}

/// Thread-local cached folder-name buffer accessor.
/// Single-threaded install, non-reentrant scratch — the `&'static mut [u8]`
/// is the unique live borrow at every call site. Callers must not hold the
/// result across a call that re-enters this accessor (per-statement reborrow
/// shape — same contract the prior `*mut [u8]` API imposed, now centralized
/// here so the 6 call sites drop their `unsafe` block).
#[inline]
fn cached_package_folder_name_buf() -> &'static mut [u8] {
    // SAFETY: single-threaded usage (install runs on one thread); the
    // thread-local cell outlives all callers and only one `&mut` is taken at a
    // time per call site (the buffer is reused non-reentrantly).
    unsafe { (*super::cached_package_folder_name_buf()).as_mut_slice() }
}

/// `&'static ZStr` from a NUL-terminated literal.
#[inline]
const fn z_static(bytes_with_nul: &'static [u8]) -> &'static ZStr {
    // `from_static` is the const-eval-safe form of `from_slice_with_nul`.
    ZStr::from_static(bytes_with_nul)
}

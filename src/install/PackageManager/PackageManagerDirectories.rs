use core::fmt;
use std::io::Write as _;

use bun_alloc::AllocError;

use crate::Error;
use crate::bun_fs::FileSystem;
use crate::lockfile_real::package::PackageColumns;
use crate::repository::Repository;
#[cfg(not(windows))]
use bun_core::UnwrapOrOom;
use bun_core::ZStr;
use bun_core::{Global, Output, ZBox, env_var, fmt as bun_fmt};
use bun_dotenv::Loader as DotEnvLoader;
use bun_install::lockfile::{Format as LockfileFormat, LoadResult, Lockfile};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{PackageID, Resolution};
use bun_paths::{self as path, AbsPath, PathBuffer, SEP};
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::{self as sys, Dir, Fd, FdDirExt, File};

use crate::bun_progress::Node as ProgressNode;

use super::options::{self, Enable, LogLevel};
use super::{Command, Options, PackageManager, ProgressStrings, Subcommand};

// ───────────────────────────── method wrappers ───────────────────────────────
// Thin `&mut self` shims so call sites can use method-style spelling
// (`pm.getCacheDirectory()` / `pm.getTemporaryDirectory()`). The bodies live
// in the free functions below to keep them callable without an `impl` path.

impl PackageManager {
    /// Borrowed view of the cached cache-directory fd. Returns `Fd` (not `Dir`)
    /// because the descriptor is owned by `self.cache_directory_` — handing out
    /// an owning `Dir` would close the cached fd when the caller drops it.
    /// Callers that need `Dir` methods should use `Dir::borrow(&fd)`.
    #[inline]
    pub fn get_cache_directory(&mut self) -> Fd {
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
    pub fn manifest_disk_cache_ctx(&mut self) -> crate::package_manifest_map::DiskCacheCtx {
        let enable_manifest_cache = self.options.enable.manifest_cache();
        crate::package_manifest_map::DiskCacheCtx {
            enable_manifest_cache,
            enable_manifest_cache_control: self.options.enable.manifest_cache_control(),
            cache_directory: enable_manifest_cache.then(|| get_cache_directory(self)),
            timestamp_for_manifest_cache_control: self.timestamp_for_manifest_cache_control,
        }
    }

    #[inline]
    pub fn get_cache_directory_and_abs_path(&mut self) -> (Fd, AbsPath) {
        get_cache_directory_and_abs_path(self)
    }

    #[inline]
    pub fn get_temporary_directory(&mut self) -> &'static TemporaryDirectory {
        get_temporary_directory(self)
    }

    #[inline]
    pub fn cached_git_folder_name(
        &self,
        repository: &Repository,
        patch_hash: Option<u64>,
    ) -> &'static ZStr {
        cached_git_folder_name(self, repository, patch_hash)
    }

    #[inline]
    pub fn cached_github_folder_name(
        &self,
        repository: &Repository,
        patch_hash: Option<u64>,
    ) -> &'static ZStr {
        cached_github_folder_name(self, repository, patch_hash)
    }

    #[inline]
    pub fn cached_npm_package_folder_name(
        &self,
        name: &[u8],
        version: Semver::Version,
        patch_hash: Option<u64>,
    ) -> &'static ZStr {
        cached_npm_package_folder_name(self, name, version, patch_hash)
    }

    #[inline]
    pub fn cached_tarball_folder_name(
        &self,
        url: SemverString,
        patch_hash: Option<u64>,
    ) -> &'static ZStr {
        cached_tarball_folder_name(self, url, patch_hash)
    }

    #[inline]
    pub fn save_lockfile(
        &mut self,
        load_result: &LoadResult,
        save_format: LockfileFormat,
        had_any_diffs: bool,
        lockfile_before_install: &Lockfile,
        packages_len_before_install: usize,
        log_level: LogLevel,
    ) -> Result<(), AllocError> {
        save_lockfile(
            self,
            load_result,
            save_format,
            had_any_diffs,
            lockfile_before_install,
            packages_len_before_install,
            log_level,
        )
    }

    #[inline]
    pub fn write_yarn_lock(&mut self) -> Result<(), Error> {
        write_yarn_lock(self)
    }
}

// ───────────────────────────── cache directory ────────────────────────────────

/// Returns a borrowed view (`Fd`) of the lazily-opened cache directory. The
/// descriptor is owned by `PackageManager::cache_directory_` (closed only if
/// the singleton is ever dropped). Callers must not close the returned `Fd`;
/// use `Dir::borrow(&fd)` to call `&self` `Dir` methods on it.
#[inline]
pub fn get_cache_directory(this: &mut PackageManager) -> Fd {
    // SAFETY: `&mut PackageManager` is exclusive over every field the raw
    // path projects.
    unsafe { get_cache_directory_raw(this) }
}

/// Raw-pointer entry for callers that hold a disjoint `&mut this.manifests`
/// borrow (see `PackageManifestMap::by_name_hash_allow_expired`). Never
/// materializes a `&mut PackageManager` covering the whole struct — only the
/// disjoint `cache_directory_`, `cache_directory_path`, `options.enable`, and
/// `env` fields are projected, so an outstanding `&mut manifests` derived
/// from the same provenance root stays valid under Stacked Borrows.
///
/// # Safety
/// `this` must be valid for reads and writes for the call's duration, and the
/// caller must hold no live borrow that overlaps the fields listed above.
#[inline]
pub unsafe fn get_cache_directory_raw(this: *mut PackageManager) -> Fd {
    // SAFETY: caller contract — `cache_directory_` is disjoint from any
    // borrow the caller holds.
    if let Some(d) = unsafe { (*this).cache_directory_.as_ref() } {
        return d.fd();
    }
    // SAFETY: caller contract — `this` is valid and no live borrow overlaps
    // `options.enable`/`options.cache_directory`/`env`/`cache_directory_path`.
    let d = unsafe { ensure_cache_directory(this) };
    let fd = d.fd();
    // SAFETY: as above; single writer.
    unsafe { (*this).cache_directory_ = Some(d) };
    fd
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
    // `bun_core::Once<T, fn(A)->T>` can't
    // accept a non-`'static` `&mut PackageManager` argument, so use `OnceLock`
    // directly and split get/set so the closure doesn't need to capture `this`.
    if let Some(td) = GET_TEMPORARY_DIRECTORY_ONCE.get() {
        return td;
    }
    let td = get_temporary_directory_run(this);
    let _ = GET_TEMPORARY_DIRECTORY_ONCE.set(td);
    GET_TEMPORARY_DIRECTORY_ONCE.get().expect("just set")
}

pub struct TemporaryDirectory {
    pub handle: Dir,
    pub path: ZBox,
    pub name: &'static [u8],
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

fn get_temporary_directory_run(manager: &mut PackageManager) -> TemporaryDirectory {
    let cache_directory_fd = get_cache_directory(manager);
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
                    Err(err) => {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: bun is unable to access tempdir: {}",
                            bun_fmt::s(err.name())
                        );
                        Global::crash();
                    }
                }
            }
        };

    let mut tmpbuf = PathBuffer::uninit();
    let tmpname =
        FileSystem::tmpname(b"hm", &mut tmpbuf, bun_core::fast_random()).expect("unreachable");

    let mut timer = if manager.options.log_level != LogLevel::Silent {
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
                        Err(err) => {
                            bun_core::pretty_errorln!(
                                "<r><red>error<r>: bun is unable to access tempdir: {}",
                                bun_fmt::s(err.name())
                            );
                            Global::crash();
                        }
                    };

                    if verbose_install() {
                        bun_core::pretty_errorln!(
                            "<r><yellow>warn<r>: bun is unable to access tempdir: {}, using fallback",
                            bun_fmt::s(err2.name())
                        );
                    }

                    continue 'brk;
                }
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: {} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>",
                    bun_fmt::s(err2.name())
                );
                Global::crash();
            }
        };
        let _ = file.close(); // close error is non-actionable

        match sys::renameat_z(tempdir.fd(), tmpname, cache_directory.fd(), tmpname) {
            Ok(()) => {}
            Err(err) => {
                if !tried_dot_tmp {
                    tried_dot_tmp = true;
                    tempdir = match cache_directory.make_open_path(b".tmp", Default::default()) {
                        Ok(d) => d,
                        Err(err2) => {
                            bun_core::pretty_errorln!(
                                "<r><red>error<r>: bun is unable to write files to tempdir: {}",
                                bun_fmt::s(err2.name())
                            );
                            Global::crash();
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

                bun_core::pretty_errorln!(
                    "<r><red>error<r>: {} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>",
                    bun_fmt::s(err.name())
                );
                Global::crash();
            }
        }
        let _ = cache_directory.delete_file_z(tmpname);
        break;
    }

    if tried_dot_tmp {
        USING_FALLBACK_TEMP_DIR.store(true, core::sync::atomic::Ordering::Relaxed);
    }

    if manager.options.log_level != LogLevel::Silent {
        let elapsed = timer.as_mut().unwrap().read();
        if elapsed > bun_core::time::NS_PER_MS * 100 {
            let mut path_buf = PathBuffer::uninit();
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

    let mut buf = PathBuffer::uninit();
    let temp_dir_path = match sys::get_fd_path_z(Fd::from_std_dir(&tempdir), &mut buf) {
        Ok(p) => p,
        Err(err) => {
            Output::err(
                err,
                "Failed to read temporary directory path: '{}'",
                (bun_fmt::s(temp_dir_name),),
            );
            Global::exit(1);
        }
    };

    TemporaryDirectory {
        handle: tempdir,
        name: temp_dir_name,
        path: ZBox::from_bytes(temp_dir_path.as_bytes()),
    }
}

/// # Safety
/// See `get_cache_directory_raw` — only `options.enable`,
/// `options.cache_directory` (read), `env`, and `cache_directory_path` are
/// touched; caller must hold no overlapping borrow on those projections.
/// Borrows into other `options` sub-fields (e.g. `options.registries` /
/// `options.scope`) remain valid.
#[cold]
#[inline(never)]
unsafe fn ensure_cache_directory(this: *mut PackageManager) -> Dir {
    loop {
        // SAFETY: field projections through the caller-provided provenance
        // root; see fn safety contract. Project `enable` narrowly so callers
        // may hold borrows into disjoint `options` sub-fields.
        if unsafe { (*this).options.enable.contains(Enable::CACHE) } {
            // SAFETY: caller-provided provenance root; `env_mut()` itself
            // encapsulates the BackRef deref + singleton-liveness invariant.
            let env = unsafe { &*this }.env_mut();
            // SAFETY: shared read of `options`; disjoint from `cache_directory_path`.
            let cache_dir = fetch_cache_directory_path(env, Some(unsafe { &(*this).options }));
            // SAFETY: see fn safety contract.
            unsafe { (*this).cache_directory_path = ZBox::from_bytes(&cache_dir.path) };

            match Dir::cwd().make_open_path(&cache_dir.path, Default::default()) {
                Ok(d) => return d,
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
                    &[b"node_modules", b".cache"],
                ))
        };

        match Dir::cwd().make_open_path(b"node_modules/.cache", Default::default()) {
            Ok(d) => return d,
            Err(err) => {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: bun is unable to write files: {}",
                    bun_fmt::s(err.name())
                );
                Global::crash();
            }
        }
    }
}

pub struct CacheDir {
    pub path: Vec<u8>,
    pub is_node_modules: bool,
}

pub fn fetch_cache_directory_path(env: &mut DotEnvLoader, options: Option<&Options>) -> CacheDir {
    if let Some(dir) = env.get(b"BUN_INSTALL_CACHE_DIR") {
        return CacheDir {
            path: FileSystem::instance().abs(&[dir]).to_vec(),
            is_node_modules: false,
        };
    }

    if let Some(opts) = options {
        if !opts.cache_directory.is_empty() {
            return CacheDir {
                path: FileSystem::instance().abs(&[opts.cache_directory]).to_vec(),
                is_node_modules: false,
            };
        }
    }

    if let Some(dir) = env.get(b"BUN_INSTALL") {
        let parts: [&[u8]; 3] = [dir, b"install/", b"cache/"];
        return CacheDir {
            path: FileSystem::instance().abs(&parts).to_vec(),
            is_node_modules: false,
        };
    }

    if let Some(dir) = env_var::XDG_CACHE_HOME.get() {
        let parts: [&[u8]; 4] = [dir, b".bun/", b"install/", b"cache/"];
        return CacheDir {
            path: FileSystem::instance().abs(&parts).to_vec(),
            is_node_modules: false,
        };
    }

    if let Some(dir) = env_var::HOME.get() {
        let parts: [&[u8]; 4] = [dir, b".bun/", b"install/", b"cache/"];
        return CacheDir {
            path: FileSystem::instance().abs(&parts).to_vec(),
            is_node_modules: false,
        };
    }

    let fallback_parts: [&[u8]; 1] = [b"node_modules/.bun-cache"];
    CacheDir {
        is_node_modules: true,
        path: FileSystem::instance().abs(&fallback_parts).to_vec(),
    }
}

// ─────────────────────── cached folder name printers ──────────────────────────
//
// PERF: an earlier version used `core::fmt::write` over a `format_args!` of
// `bun_fmt::s` / `CacheVersionFormatter` / `PatchHashFmt` / `hex_int_*`
// pieces. In Rust that is *dynamic* dispatch — every `{}` argument is a
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

    /// `{:x}` — variable-width lower-hex (no leading zeros), as used by
    /// `PatchHashFmt`.
    #[inline(always)]
    fn put_u64_hex_var(&mut self, n: u64) {
        let mut tmp = [0u8; 16];
        self.put(bun_fmt::u64_hex_var_lower(&mut tmp, n));
    }

    /// Inlined body of `CacheVersionFormatter` — `@@@{d}` when set.
    #[inline(always)]
    fn put_cache_version(&mut self, v: Option<usize>) {
        if let Some(v) = v {
            self.put(b"@@@");
            self.put_u64_dec(v as u64);
        }
    }

    /// Inlined body of `PatchHashFmt` — `_patch_hash={x}` when set.
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
    if scope_url.hostname.len() > 32 || available < 64 {
        let visible_hostname = &scope_url.hostname[..scope_url.hostname.len().min(12)];
        w.put(b"@@");
        w.put(visible_hostname);
        w.put(b"__");
        w.put_u64_hex16::<true>(Semver::semver_string::Builder::string_hash(scope_url.href));
    } else {
        w.put(b"@@");
        w.put(scope_url.hostname);
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

pub fn cached_tarball_folder_name_print<'a>(
    buf: &'a mut [u8],
    url: &[u8],
    patch_hash: Option<u64>,
) -> &'a ZStr {
    let mut w = ByteCursor::new(buf);
    w.put(b"@T@");
    w.put_u64_hex16::<true>(Semver::semver_string::Builder::string_hash(url));
    w.put_cache_version(Some(CacheVersion::CURRENT));
    w.put_patch_hash(patch_hash);
    w.finish_z()
}

pub fn cached_tarball_folder_name(
    this: &PackageManager,
    url: SemverString,
    patch_hash: Option<u64>,
) -> &'static ZStr {
    cached_tarball_folder_name_print(
        cached_package_folder_name_buf(),
        this.lockfile.str(&url),
        patch_hash,
    )
}

pub fn is_folder_in_cache(this: &mut PackageManager, folder_path: &ZStr) -> bool {
    sys::directory_exists_at(get_cache_directory(this), folder_path).unwrap_or(false)
}

// ─────────────────────────── global directories ───────────────────────────────

pub fn setup_global_dir(manager: &mut PackageManager, ctx: &Command::Context) -> Result<(), Error> {
    manager.options.global_bin_dir = options::open_global_bin_dir(ctx.install.as_deref())?;
    let mut out_buffer = PathBuffer::uninit();
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
    if let Some(d) = this.global_link_dir.as_ref() {
        return d.fd();
    }

    let global_dir = match options::open_global_dir(this.options.explicit_global_directory) {
        Ok(d) => Dir::from_fd(d),
        Err(crate::Error::NoGlobalDirectoryFound) => {
            Output::err_generic(
                "failed to find a global directory for package caching and global link directories",
                (),
            );
            Global::exit(1);
        }
        Err(err) => {
            Output::err(err, "failed to open the global directory", ());
            Global::exit(1);
        }
    };
    let link_dir = match global_dir.make_open_path(b"node_modules", Default::default()) {
        Ok(d) => d,
        Err(err) => {
            Output::err(
                err,
                "failed to open global link dir node_modules at '{}'",
                (global_dir.fd(),),
            );
            Global::exit(1);
        }
    };
    let link_fd = link_dir.fd();
    this.global_dir = Some(global_dir);
    this.global_link_dir = Some(link_dir);
    let mut buf = PathBuffer::uninit();
    let path_ = match sys::get_fd_path(link_fd, &mut buf) {
        Ok(p) => p,
        Err(err) => {
            Output::err(
                err,
                "failed to get the full path of the global directory",
                (),
            );
            Global::exit(1);
        }
    };
    this.global_link_dir_path = Box::<[u8]>::from(bun_core::handle_oom(
        FileSystem::instance().dirname_store().append(path_),
    ));
    link_fd
}

pub fn global_link_dir_path(this: &mut PackageManager) -> &[u8] {
    let _ = global_link_dir(this);
    &this.global_link_dir_path
}

pub fn global_link_dir_and_path(this: &mut PackageManager) -> (Fd, &[u8]) {
    let dir = global_link_dir(this);
    (dir, &this.global_link_dir_path)
}

/// Returns true when `entry` at `dir_fd` should be treated as a
/// `bun link` registration: a symlink whose target is an existing
/// directory. On filesystems that don't populate `getdents64`'s
/// `d_type` field (NFS / FUSE / XFS with ftype=0), `kind` arrives as
/// `Unknown`; disambiguate with `lstatat` before following. A
/// dangling link (producer dir moved/deleted without `bun unlink`)
/// would otherwise make the installer skip the registry download
/// and then fail ENOENT in the worker with no fallback.
///
/// POSIX-only. On Windows the whole populate_linked_names_cache flow
/// short-circuits to the reparse-point fast path and falls through to
/// the per-call `GetFileAttributesW` check in `linked_package_path`.
#[cfg(not(windows))]
fn is_linked_entry(kind: sys::EntryKind, dir_fd: Fd, name: &bun_core::ZStr) -> bool {
    let is_symlink = match kind {
        sys::EntryKind::SymLink => true,
        sys::EntryKind::Unknown => match sys::lstatat(dir_fd, name) {
            Ok(st) => sys::posix::s_islnk(st.st_mode as u32),
            Err(_) => false,
        },
        _ => return false,
    };
    if !is_symlink {
        return false;
    }
    // Follow the symlink and confirm it resolves to a readable directory.
    // Matches what the installer worker will do (open_dir_for_iteration on the
    // producer path) — same success/failure outcome here as there.
    match bun_sys::openat(dir_fd, name, bun_sys::O::DIRECTORY | bun_sys::O::RDONLY, 0) {
        bun_sys::Result::Ok(fd) => {
            let _close = bun_sys::CloseOnDrop::new(fd);
            true
        }
        bun_sys::Result::Err(_) => false,
    }
}

/// Read the global link dir once and populate `this.linked_names` with
/// every registered package name (including scoped names as
/// `@scope/name`). Must be called on the main thread before any install
/// worker touches `linked_package_path`; after that the map is
/// read-only and lock-free.
///
/// Safe to call repeatedly; subsequent calls are no-ops.
pub fn populate_linked_names_cache(this: &mut PackageManager) {
    if this.linked_names_populated {
        return;
    }
    this.linked_names_populated = true;

    // Best-effort: for users who have never run `bun link`, the global
    // link dir may not exist (or may be unreadable). The full `global_link_dir`
    // path `Global::exit(1)`s on setup failure — treat that same failure
    // here as "no links on this machine" instead, and leave the cache
    // empty so `linked_package_path` short-circuits to null.
    if this.global_link_dir_path.is_empty() {
        let global_dir = match options::open_global_dir(this.options.explicit_global_directory) {
            Ok(d) => Dir::from_fd(d),
            Err(_) => return,
        };
        let link_dir = match global_dir.make_open_path(b"node_modules", Default::default()) {
            Ok(d) => d,
            Err(_) => {
                global_dir.close();
                return;
            }
        };
        let mut buf = PathBuffer::uninit();
        let path_ = match sys::get_fd_path(Fd::from_std_dir(&link_dir), &mut buf) {
            Ok(p) => p,
            Err(_) => {
                link_dir.close();
                global_dir.close();
                return;
            }
        };
        this.global_link_dir_path = Box::<[u8]>::from(bun_core::handle_oom(
            FileSystem::instance().dirname_store().append(path_),
        ));
        this.global_dir = Some(global_dir);
        this.global_link_dir = Some(link_dir);
    }

    let dir_path = &this.global_link_dir_path;
    let root_fd = match bun_sys::open_dir_for_iteration(Fd::cwd(), dir_path) {
        bun_sys::Result::Ok(fd) => fd,
        // Dir missing / unreadable → empty set. Every linked_package_path
        // lookup will short-circuit to null with no further syscalls.
        bun_sys::Result::Err(_) => return,
    };
    let _close_root = bun_sys::CloseOnDrop::new(root_fd);

    let mut iter = bun_sys::dir_iterator::iterate(root_fd);
    loop {
        let entry = match iter.next() {
            bun_sys::Result::Err(_) => return,
            bun_sys::Result::Ok(None) => return,
            bun_sys::Result::Ok(Some(e)) => e,
        };
        let name = entry.name.slice_u8();
        if name.is_empty() {
            continue;
        }

        // Scope dirs (`@scope`) contain the actual links nested one level
        // deeper; flatten to `@scope/name` in the cache. Accept `Unknown`
        // too: readdir on NFS / FUSE / XFS-ftype=0 returns `DT_UNKNOWN`
        // for every entry, and rejecting it here would drop real scope
        // dirs. `open_dir_for_iteration` below will reject non-dirs as
        // EACCES/ENOTDIR and we'll just skip them.
        if name[0] == b'@'
            && (entry.kind == sys::EntryKind::Directory || entry.kind == sys::EntryKind::Unknown)
        {
            #[cfg(windows)]
            {
                // WTF-16 name; skip scope flattening on Windows for now.
                // Falls through to the GetFileAttributesW path in
                // `linked_package_path`. Record the scope dir as a
                // potential link parent for the Windows fast path.
                this.linked_names_any_on_windows = true;
                continue;
            }
            #[cfg(not(windows))]
            {
                let scope_name_z = entry.name.as_zstr();
                let scope_fd = match bun_sys::open_dir_for_iteration(root_fd, scope_name_z) {
                    bun_sys::Result::Ok(fd) => fd,
                    bun_sys::Result::Err(_) => continue,
                };
                let _close_scope = bun_sys::CloseOnDrop::new(scope_fd);

                let mut scope_iter = bun_sys::dir_iterator::iterate(scope_fd);
                loop {
                    let scope_entry = match scope_iter.next() {
                        bun_sys::Result::Err(_) => break,
                        bun_sys::Result::Ok(None) => break,
                        bun_sys::Result::Ok(Some(e)) => e,
                    };
                    let sub_name = scope_entry.name.slice_u8();
                    if sub_name.is_empty() {
                        continue;
                    }
                    // Only symlinks — the global link dir is shared
                    // with `bun add -g`, which drops real directories
                    // under the same path. A real directory there means
                    // a global install, not a link.
                    if !is_linked_entry(scope_entry.kind, scope_fd, scope_entry.name.as_zstr()) {
                        continue;
                    }
                    let mut full: Vec<u8> = Vec::with_capacity(name.len() + 1 + sub_name.len());
                    full.extend_from_slice(name);
                    full.push(b'/');
                    full.extend_from_slice(sub_name);
                    this.linked_names.put(&full, ()).unwrap_or_oom();
                }
                continue;
            }
        }

        #[cfg(windows)]
        {
            // Over-approximate: any reparse-point entry at this level is a
            // candidate link. `linked_package_path`'s per-call
            // GetFileAttributesW will still reject false positives by
            // path. We just need enough signal to skip the syscall when
            // zero links exist.
            if entry.kind == sys::EntryKind::SymLink {
                this.linked_names_any_on_windows = true;
            }
            continue;
        }
        #[cfg(not(windows))]
        {
            if !is_linked_entry(entry.kind, root_fd, entry.name.as_zstr()) {
                continue;
            }
            this.linked_names.put(name, ()).unwrap_or_oom();
        }
    }
}

/// If `<globalLinkDir>/<pkg_name>` exists (typically a symlink created
/// by `bun link` from the producer dir), write its absolute path into
/// `buf` and return it. Otherwise `None`. Scoped names (`@scope/name`)
/// are handled because `join_abs_string_buf_z` preserves the `/`.
///
/// Shared `&PackageManager` so it's safe to call from any install-worker
/// thread: `populate_linked_names_cache` ran once on the main thread
/// before workers started, and the map / `global_link_dir_path` /
/// `linked_names_any_on_windows` are read-only thereafter. This is the
/// entry point workers must use — forming `&mut PackageManager` on a
/// task thread is UB per the `Task::run` SAFETY contract.
///
/// Performance:
/// - **POSIX**: single hashmap check, zero syscalls. Short-circuits to
///   `None` if `linked_names` is empty or doesn't contain the name.
/// - **Windows**: the readdir in `populate_linked_names_cache` yields
///   WTF-16 we can't key into the UTF-8 map, so a per-call
///   `GetFileAttributesW` + dangling-junction check is required when
///   `linked_names_any_on_windows` is set. With no active links the
///   fast-path flag is false and we return `None` with no syscalls.
pub fn linked_package_path<'a>(
    this: &'a PackageManager,
    pkg_name: &[u8],
    buf: &'a mut PathBuffer,
) -> Option<&'a bun_core::ZStr> {
    if pkg_name.is_empty() {
        return None;
    }
    // Cache must be populated before any worker calls this (asserted
    // at the top of install_isolated_packages).
    if !this.linked_names_populated {
        return None;
    }
    // Populate couldn't set up the global link dir — no links on
    // this machine. Don't try to re-init; that path needs `&mut`
    // and `Global::exit(1)`s on failure.
    if this.global_link_dir_path.is_empty() {
        return None;
    }

    // POSIX: hashmap keyed by UTF-8 name.
    #[cfg(not(windows))]
    {
        if this.linked_names.is_empty() {
            return None;
        }
        if !this.linked_names.contains_key(pkg_name) {
            return None;
        }
        let dir_path_ref: &[u8] = &this.global_link_dir_path;
        let joined = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
            dir_path_ref,
            buf,
            &[pkg_name],
        );
        Some(joined)
    }

    // Windows: readdir yielded WTF-16 we couldn't key into the UTF-8
    // map; `linked_names_any_on_windows` records whether any
    // link-shaped entry was seen. Short-circuit if none; otherwise
    // re-probe via GetFileAttributesW (read-only, safe on workers —
    // `global_link_dir_path` is immutable post-populate).
    #[cfg(windows)]
    {
        if !this.linked_names_any_on_windows {
            return None;
        }
        let dir_path_ref: &[u8] = &this.global_link_dir_path;
        let joined = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
            dir_path_ref,
            buf,
            &[pkg_name],
        );
        match sys::get_file_attributes(joined) {
            Some(attrs) if attrs.is_reparse_point => {}
            _ => return None,
        }
        match bun_sys::open_dir_for_iteration(Fd::cwd(), joined) {
            bun_sys::Result::Ok(fd) => {
                let _close = bun_sys::CloseOnDrop::new(fd);
                Some(joined)
            }
            bun_sys::Result::Err(_) => None,
        }
    }
}

/// Non-cached fallback: main-thread-only. Must hold `&mut PackageManager`
/// because `global_link_dir(this)` lazy-initializes
/// `global_link_dir` / `global_link_dir_path` on first call. Callers on
/// worker threads must use [`linked_package_path`] (read-only) instead.
///
/// Used by:
/// - Windows, where the readdir in `populate_linked_names_cache` can't
///   key WTF-16 names into the UTF-8 hashmap — every call falls through
///   to `GetFileAttributesW` against the joined path.
/// - Any caller outside the isolated-install flow that hasn't run
///   `populate_linked_names_cache` (`bun link` / `bun unlink` themselves,
///   resolver probes) — main thread only by construction.
pub fn linked_package_path_mut<'a>(
    this: &'a mut PackageManager,
    pkg_name: &[u8],
    buf: &'a mut PathBuffer,
) -> Option<&'a bun_core::ZStr> {
    if pkg_name.is_empty() {
        return None;
    }

    // If populate ran and left the cache empty because the global link
    // dir couldn't be set up (no writable profile, locked-down
    // container, etc.), don't re-attempt via `global_link_dir` — that
    // path `Global::exit(1)`s on setup failure, which would turn a
    // plain npm-only install on Windows into a hard exit.
    if this.linked_names_populated && this.global_link_dir_path.is_empty() {
        return None;
    }

    // POSIX fast path: the readdir in populate already UTF-8-keyed the
    // registered names into linked_names, so after populate has run we
    // can answer without touching the filesystem. The linked_pkg_ids
    // bitset build in isolated_install.rs calls this once per
    // root/workspace direct dependency; this check skips the lstat
    // below for every direct dep whose name is not link-registered
    // (the vast majority).
    #[cfg(not(windows))]
    {
        if this.linked_names_populated && !this.linked_names.contains_key(pkg_name) {
            return None;
        }
    }

    // Windows fast path. `populate_linked_names_cache` already paid the
    // readdir cost and recorded whether any link-shaped entry was seen;
    // short-circuit GetFileAttributesW when none exist.
    #[cfg(windows)]
    {
        if this.linked_names_populated && !this.linked_names_any_on_windows {
            return None;
        }
    }

    let _ = global_link_dir(this);
    let dir_path_ref: &[u8] = &this.global_link_dir_path;
    let joined = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
        dir_path_ref,
        buf,
        &[pkg_name],
    );

    // The global link dir is shared with `bun add -g` (same root —
    // `<globalDir>/node_modules/`), and on POSIX a hoisted global
    // install lands here as a real directory. Treat only symlinks /
    // reparse-points as registered links.
    let is_link: bool = {
        #[cfg(windows)]
        {
            match sys::get_file_attributes(joined) {
                Some(attrs) => attrs.is_reparse_point,
                None => return None,
            }
        }
        #[cfg(not(windows))]
        {
            match sys::lstat(joined) {
                Ok(st) => sys::posix::s_islnk(st.st_mode as u32),
                Err(_) => return None,
            }
        }
    };
    if !is_link {
        return None;
    }

    // Follow the symlink and confirm it resolves to a readable
    // directory. A dangling symlink (producer deleted without
    // `bun unlink`) would otherwise make the installer skip the
    // registry download and fail ENOENT in the worker.
    match bun_sys::open_dir_for_iteration(Fd::cwd(), joined) {
        bun_sys::Result::Ok(fd) => {
            let _close = bun_sys::CloseOnDrop::new(fd);
            Some(joined)
        }
        bun_sys::Result::Err(_) => None,
    }
}

// ────────────────────────── cached path resolution ────────────────────────────

pub fn path_for_cached_npm_path<'a>(
    this: &mut PackageManager,
    buf: &'a mut PathBuffer,
    package_name: &[u8],
    version: Semver::Version,
) -> Result<&'a mut [u8], Error> {
    let mut cache_path_buf = PathBuffer::uninit();

    let cache_path = cached_npm_package_folder_name_print(
        this,
        &mut cache_path_buf.0[..],
        package_name,
        version,
        None,
    );
    let cache_path_len = cache_path.as_bytes().len();
    // reshaped for borrowck — drop borrow before mutating buffer

    debug_assert!(cache_path_buf[package_name.len()] == b'@');

    cache_path_buf[package_name.len()] = SEP;

    let cache_dir: Fd = get_cache_directory(this);

    #[cfg(windows)]
    {
        let _ = cache_dir;
        let mut path_buf = PathBuffer::uninit();
        let cache_path = ZStr::from_buf(&cache_path_buf, cache_path_len);
        let joined = path::resolve_path::join_abs_string_buf_z::<path::platform::Windows>(
            &this.cache_directory_path,
            &mut path_buf,
            &[cache_path.as_bytes()],
        );
        return match sys::readlink(joined, &mut buf.0[..]) {
            Ok(n) => Ok(&mut buf.0[..n]),
            Err(err) => {
                let _ = sys::unlink(joined);
                Err(err.into())
            }
        };
    }

    #[cfg(not(windows))]
    {
        let cache_path = ZStr::from_buf(&cache_path_buf, cache_path_len);
        match sys::readlinkat(cache_dir, cache_path, &mut buf.0[..]) {
            Ok(n) => Ok(&mut buf.0[..n]),
            Err(err) => {
                // if we run into an error, delete the symlink
                // so that we don't repeatedly try to read it
                let _ = sys::unlinkat(cache_dir, cache_path);
                Err(Error::from(err))
            }
        }
    }
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
        _ => Ok(&mut buf.0[..0]),
    }
}

pub struct CacheDirAndSubpath<'a> {
    /// Borrowed view: the descriptor is owned by the `PackageManager` singleton
    /// (or is `Fd::cwd()`); callers must not close it.
    pub cache_dir: Fd,
    pub cache_dir_subpath: &'a ZStr,
}

/// this is copy pasted from `installPackageWithNameAndResolution()`
/// it's not great to do this
pub fn compute_cache_dir_and_subpath<'a>(
    manager: &mut PackageManager,
    pkg_name: &[u8],
    resolution: &Resolution,
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
        ResolutionTag::LocalTarball => {
            let tarball = *resolution.local_tarball();
            cache_dir_subpath = cached_tarball_folder_name(manager, tarball, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        ResolutionTag::RemoteTarball => {
            let tarball = *resolution.remote_tarball();
            cache_dir_subpath = cached_tarball_folder_name(manager, tarball, patch_hash);
            cache_dir = get_cache_directory(manager);
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
            let directory = global_link_dir(manager);

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
                let global_link_dir = global_link_dir_path(manager);
                let ptr = &mut folder_path_buf.0[..];
                let mut off = 0usize;
                ptr[off..off + global_link_dir.len()].copy_from_slice(global_link_dir);
                off += global_link_dir.len();
                if global_link_dir[global_link_dir.len() - 1] != SEP {
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
        _ => {}
    }

    CacheDirAndSubpath {
        cache_dir,
        cache_dir_subpath,
    }
}

// ─────────────────────────── package.json / lockfile ──────────────────────────

pub fn attempt_to_create_package_json_and_open() -> Result<File, Error> {
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

    package_json_file.pwrite_all(b"{\"dependencies\": {}}", 0)?;

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
) -> Result<(), AllocError> {
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
                                return Ok(());
                            }
                            break 'delete;
                        }

                        if log_level != LogLevel::Silent {
                            Output::err(err, "failed to delete empty lockfile", ());
                        }
                        return Ok(());
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

        return Ok(());
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

    this.lockfile.save_to_disk(load_result, &this.options);

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
    } else if log_level != LogLevel::Silent {
        bun_core::pretty_errorln!("Saved lockfile");
        Output::flush();
    }

    Ok(())
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
    let mut tmpname_buf = [0u8; 512];
    tmpname_buf[0..8].copy_from_slice(b"tmplock-");
    // Windows opens via `get_default_temp_dir`.
    let mut tmpfile = bun_resolver::fs::RealFsTmpfile::default();
    let mut secret = [0u8; 32];
    secret[0..8].copy_from_slice(
        &u64::try_from(bun_core::time::milli_timestamp())
            .expect("int cast")
            .to_le_bytes(),
    );
    let mut base64_bytes = [0u8; 64];
    bun_boringssl_sys::rand_bytes(&mut base64_bytes);

    // Format each byte as zero-padded 2-char lower hex (128 chars total).
    let tmpname_len = {
        let mut cursor = &mut tmpname_buf[8..];
        let initial_len = cursor.len();
        for b in &base64_bytes {
            write!(cursor, "{:02x}", b).expect("unreachable");
        }
        initial_len - cursor.len()
    };
    tmpname_buf[tmpname_len + 8] = 0;
    let tmpname = ZStr::from_buf(&tmpname_buf, tmpname_len + 8);

    if let Err(err) = tmpfile.create(tmpname) {
        bun_core::pretty_errorln!("<r><red>error:<r> failed to create tmpfile: {}", err.name());
        Global::crash();
    }

    let file = tmpfile.file();
    {
        let mut printer = crate::lockfile_real::Printer {
            lockfile: &this.lockfile,
            options: &this.options,
            successfully_installed: None,
            // `Yarn::print` never reads `updates`; pass an empty slice.
            updates: &[],
        };
        // `bun_sys::File`
        // has no `bun_io::Write` impl (and `bun_sys` ⊥ `bun_io`), so buffer the
        // entire output in a `Vec<u8>` (impls `bun_io::Write`) and flush once.
        let mut buf: Vec<u8> = Vec::with_capacity(4096);
        crate::lockfile_real::printer::Yarn::print(&mut printer, &mut buf)?;
        file.write_all(&buf).map_err(Error::from)?;
    }

    #[cfg(unix)]
    {
        let _ = sys::fchmod(
            tmpfile.fd,
            // chmod 666,
            0o0000040 | 0o0000004 | 0o0000002 | 0o0000400 | 0o0000200 | 0o0000020,
        );
    }

    tmpfile.promote_to_cwd(tmpname, z_static(b"yarn.lock\0"))?;
    Ok(())
}

// ────────────────────────────── formatters ────────────────────────────────────

pub struct CacheVersion;
impl CacheVersion {
    pub const CURRENT: usize = 1;
}

#[derive(Default)]
pub struct CacheVersionFormatter {
    pub version_number: Option<usize>,
}

impl fmt::Display for CacheVersionFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(version) = self.version_number {
            write!(f, "@@@{}", version)?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct PatchHashFmt {
    pub hash: Option<u64>,
}

impl fmt::Display for PatchHashFmt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(h) = self.hash {
            write!(f, "_patch_hash={:x}", h)?;
        }
        Ok(())
    }
}

// Set once during the (Once-guarded) temp-dir probe; never read today.
static USING_FALLBACK_TEMP_DIR: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

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

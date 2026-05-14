use core::fmt;
use std::io::Write as _;

use bun_alloc::AllocError;

use crate::bun_fs::FileSystem;
use crate::lockfile_real::package::PackageColumns;
use crate::repository::Repository;
use bun_core::{Error, Global, Output, ZBox, env_var, fmt as bun_fmt};
use bun_core::{ZStr, strings};
use bun_dotenv::Loader as DotEnvLoader;
use bun_install::lockfile::{self, Format as LockfileFormat, LoadResult, Lockfile};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{PackageID, Resolution};
use bun_paths::{self as path, AbsPath, MAX_PATH_BYTES, PathBuffer, SEP};
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::{self as sys, Dir, Fd, FdDirExt, File};

use crate::bun_progress::Node as ProgressNode;

use super::options::{self, Enable, LogLevel};
use super::{Command, Options, PackageManager, ProgressStrings, Subcommand};

// ───────────────────────────── method wrappers ───────────────────────────────
// Thin `&mut self` shims so call sites can use Zig's method-style spelling
// (`pm.getCacheDirectory()` / `pm.getTemporaryDirectory()`). The bodies live
// in the free functions below to keep them callable without an `impl` path.

impl PackageManager {
    #[inline]
    pub fn get_cache_directory(&mut self) -> Dir {
        get_cache_directory(self)
    }

    /// Snapshot the four `PackageManager` scalars
    /// `PackageManifestMap::by_name_hash_allow_expired`'s disk-fallback path
    /// reads. Captured by value so the loop body can hold `&mut self.manifests`
    /// alongside `&self.lockfile` / `&self.options` without aliasing the whole
    /// `&mut self` (Stacked-Borrows UB the Zig `*PackageManager` pattern is
    /// immune to).
    ///
    /// The cache directory is opened lazily here only when
    /// `options.enable.manifest_cache` is set (the only branch that reads it),
    /// matching the Zig `byNameHashAllowExpired` gating.
    pub fn manifest_disk_cache_ctx(&mut self) -> crate::package_manifest_map::DiskCacheCtx {
        let enable_manifest_cache = self.options.enable.manifest_cache();
        crate::package_manifest_map::DiskCacheCtx {
            enable_manifest_cache,
            enable_manifest_cache_control: self.options.enable.manifest_cache_control(),
            cache_directory: enable_manifest_cache.then(|| get_cache_directory(self).fd()),
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

#[inline]
pub fn get_cache_directory(this: &mut PackageManager) -> Dir {
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
pub unsafe fn get_cache_directory_raw(this: *mut PackageManager) -> Dir {
    // SAFETY: caller contract — `cache_directory_` is disjoint from any
    // borrow the caller holds.
    if let Some(d) = unsafe { (*this).cache_directory_ } {
        return d;
    }
    let d = unsafe { ensure_cache_directory(this) };
    // SAFETY: as above; single writer.
    unsafe { (*this).cache_directory_ = Some(d) };
    d
}

#[inline]
pub fn get_cache_directory_and_abs_path(this: &mut PackageManager) -> (Fd, AbsPath) {
    let cache_dir = get_cache_directory(this);
    (
        Fd::from_std_dir(&cache_dir),
        AbsPath::from(this.cache_directory_path.as_bytes())
            .expect("cache_directory_path is absolute"),
    )
}

#[inline]
pub fn get_temporary_directory(this: &mut PackageManager) -> &'static TemporaryDirectory {
    // PORT NOTE: Zig used `bun.once(...)`; `bun_core::Once<T, fn(A)->T>` can't
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
    let cache_directory = get_cache_directory(manager);
    // The chosen tempdir must be on the same filesystem as the cache directory
    // This makes renameat() work
    let temp_dir_name = FileSystem::get_default_temp_dir();

    let mut tried_dot_tmp = false;
    let mut tempdir: Dir =
        match sys::make_path::make_open_path(Dir::cwd(), temp_dir_name, Default::default()) {
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
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: bun is unable to access tempdir: {}",
                            err.name()
                        ));
                        Global::crash();
                    }
                }
            }
        };

    let mut tmpbuf = PathBuffer::uninit();
    let tmpname =
        FileSystem::tmpname(b"hm", &mut tmpbuf, bun_core::fast_random()).expect("unreachable");

    // TODO(port): std.time.Timer — using bun_core::time::Timer placeholder
    let mut timer = if manager.options.log_level != LogLevel::Silent {
        Some(bun_core::time::Timer::start().expect("unreachable"))
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
                            Output::pretty_errorln(format_args!(
                                "<r><red>error<r>: bun is unable to access tempdir: {}",
                                err.name()
                            ));
                            Global::crash();
                        }
                    };

                    if verbose_install() {
                        Output::pretty_errorln(format_args!(
                            "<r><yellow>warn<r>: bun is unable to access tempdir: {}, using fallback",
                            err2.name()
                        ));
                    }

                    continue 'brk;
                }
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: {} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>",
                    err2.name()
                ));
                Global::crash();
            }
        };
        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)

        match sys::renameat_z(tempdir.fd(), tmpname, cache_directory.fd(), tmpname) {
            Ok(()) => {}
            Err(err) => {
                if !tried_dot_tmp {
                    tried_dot_tmp = true;
                    tempdir = match cache_directory.make_open_path(b".tmp", Default::default()) {
                        Ok(d) => d,
                        Err(err2) => {
                            Output::pretty_errorln(format_args!(
                                "<r><red>error<r>: bun is unable to write files to tempdir: {}",
                                err2.name()
                            ));
                            Global::crash();
                        }
                    };

                    if verbose_install() {
                        Output::pretty_errorln(format_args!(
                            "<r><d>info<r>: cannot move files from tempdir: {}, using fallback",
                            bun_fmt::s(err.name())
                        ));
                    }

                    continue 'brk;
                }

                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: {} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>",
                    bun_fmt::s(err.name())
                ));
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
            let cache_dir_path: &[u8] =
                match sys::get_fd_path(Fd::from_std_dir(&cache_directory), &mut path_buf) {
                    Ok(p) => &p[..],
                    Err(_) => b"it",
                };
            Output::pretty_errorln(format_args!(
                "<r><yellow>warn<r>: Slow filesystem detected. If {} is a network drive, consider setting $BUN_INSTALL_CACHE_DIR to a local folder.",
                bun_fmt::s(cache_dir_path)
            ));
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
                    // PORT NOTE: allocator.free(this.cache_directory_path) — Box drop handles it
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
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: bun is unable to write files: {}",
                    err.name()
                ));
                Global::crash();
            }
        }
    }
    #[allow(unreachable_code)]
    unreachable!()
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
// PERF(port): the Zig originals lean on `std.fmt.bufPrint{,Z}`, which the
// straight port mapped to `core::fmt::write` over a `format_args!` of
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
        debug_assert!(at < self.buf.len());
        // SAFETY: see `put`; one byte of headroom for the NUL is part of the
        // PathBuffer-size invariant.
        unsafe { *self.buf.as_mut_ptr().add(at) = 0 };
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
    // PORT NOTE: reshaped for borrowck — resume the cursor at the basename's
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
    sys::directory_exists_at(Fd::from_std_dir(&get_cache_directory(this)), folder_path)
        .unwrap_or(false)
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
    manager.options.bin_path = ZStr::from_slice_with_nul(&path[..]);
    Ok(())
}

pub fn global_link_dir(this: &mut PackageManager) -> Dir {
    if let Some(d) = this.global_link_dir {
        return d;
    }

    let global_dir = match options::open_global_dir(this.options.explicit_global_directory) {
        Ok(d) => Dir::from_fd(d),
        Err(err) if err == bun_core::err!("No global directory found") => {
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
    this.global_dir = Some(global_dir);
    this.global_link_dir = Some(
        match global_dir.make_open_path(b"node_modules", Default::default()) {
            Ok(d) => d,
            Err(err) => {
                Output::err(
                    err,
                    "failed to open global link dir node_modules at '{}'",
                    (Fd::from_std_dir(&global_dir),),
                );
                Global::exit(1);
            }
        },
    );
    let mut buf = PathBuffer::uninit();
    let path_ = match sys::get_fd_path(Fd::from_std_dir(&this.global_link_dir.unwrap()), &mut buf) {
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
    this.global_link_dir.unwrap()
}

pub fn global_link_dir_path(this: &mut PackageManager) -> &[u8] {
    let _ = global_link_dir(this);
    &this.global_link_dir_path
}

pub fn global_link_dir_and_path(this: &mut PackageManager) -> (Dir, &[u8]) {
    let dir = global_link_dir(this);
    (dir, &this.global_link_dir_path)
}

// ────────────────────────── cached path resolution ────────────────────────────

pub fn path_for_cached_npm_path<'a>(
    this: &mut PackageManager,
    buf: &'a mut PathBuffer,
    package_name: &[u8],
    version: Semver::Version,
) -> Result<&'a mut [u8], Error> {
    // TODO(port): narrow error set
    let mut cache_path_buf = PathBuffer::uninit();

    let cache_path = cached_npm_package_folder_name_print(
        this,
        &mut cache_path_buf.0[..],
        package_name,
        version,
        None,
    );
    let cache_path_len = cache_path.as_bytes().len();
    // PORT NOTE: reshaped for borrowck — drop borrow before mutating buffer

    if cfg!(debug_assertions) {
        debug_assert!(cache_path_buf[package_name.len()] == b'@');
    }

    cache_path_buf[package_name.len()] = SEP;

    let cache_dir: Fd = Fd::from_std_dir(&get_cache_directory(this));

    #[cfg(windows)]
    {
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
    resolution: Resolution,
    buf: &'a mut PathBuffer,
) -> Result<&'a mut [u8], Error> {
    // TODO(port): narrow error set
    // const folder_name = this.cachedNPMPackageFolderName(name, version);
    match resolution.tag {
        ResolutionTag::Npm => {
            let npm = *resolution.npm();
            let package_name_ = this.lockfile.packages.items_name()[package_id as usize];
            // PORT NOTE: borrowck — `path_for_cached_npm_path` reborrows `this`
            // mutably (for `get_cache_directory`), so the `&this.lockfile`
            // borrow can't be held across it. Copy the name out first.
            let package_name = this.lockfile.str(&package_name_).to_vec();

            path_for_cached_npm_path(this, buf, &package_name, npm.version)
        }
        _ => Ok(&mut buf.0[..0]),
    }
}

pub struct CacheDirAndSubpath<'a> {
    pub cache_dir: Dir,
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
    let mut cache_dir = Dir::cwd();
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
            cache_dir = Dir::cwd();
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
            cache_dir = Dir::cwd();
        }
        ResolutionTag::Symlink => {
            let directory = global_link_dir(manager);

            // PORT NOTE: borrowck — `global_link_dir_path` below reborrows
            // `manager` mutably, so copy the symlink target out of the lockfile
            // string buffer first instead of holding a slice across that call.
            let folder = resolution
                .symlink()
                .slice(manager.lockfile.buffers.string_bytes.as_slice())
                .to_vec();

            if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                cache_dir_subpath = z_static(b".\0");
                cache_dir = Dir::cwd();
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
    // TODO(port): narrow error set
    let package_json_file = match Dir::cwd().create_file_z(
        z_static(b"package.json\0"),
        sys::CreateFlags {
            read: true,
            ..Default::default()
        },
    ) {
        Ok(f) => f,
        Err(err) => {
            Output::pretty_errorln(format_args!(
                "<r><red>error:<r> {} create package.json",
                err.name()
            ));
            Global::crash();
        }
    };

    package_json_file.pwrite_all(b"{\"dependencies\": {}}", 0)?;

    Ok(package_json_file)
}

pub fn attempt_to_create_package_json() -> Result<(), Error> {
    // TODO(port): narrow error set
    let file = attempt_to_create_package_json_and_open()?;
    let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
    Ok(())
}

pub fn save_lockfile(
    this: &mut PackageManager,
    load_result: &LoadResult,
    save_format: LockfileFormat,
    had_any_diffs: bool,
    // TODO(dylan-conway): this and `packages_len_before_install` can most likely be deleted
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
                    Subcommand::Remove => Output::pretty_errorln(format_args!(
                        "\npackage.json has no dependencies! Deleted empty lockfile"
                    )),
                    _ => {
                        Output::pretty_errorln(format_args!("No packages! Deleted empty lockfile"))
                    }
                }
            }
        }

        return Ok(());
    }

    // PORT NOTE: Zig held `*Progress.Node` across the body; `Progress::start`
    // returns `&mut Node` borrowing `this.progress`, which would conflict with
    // the `&mut this` reborrows below. Stash as a raw pointer (mirrors Zig's
    // non-exclusive `*Node`; the node lives inside `this.progress.root`).
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
        Output::pretty_errorln(format_args!("Saved lockfile"));
        Output::flush();
    }

    Ok(())
}

pub fn update_lockfile_if_needed(
    manager: &mut PackageManager,
    // PORT NOTE: Zig passed `Lockfile.LoadResult` by value (large structs are
    // passed by const-ref under Zig's ABI). The Rust caller continues using
    // `load_result` after this call, so take it by shared reference.
    load_result: &LoadResult,
) -> Result<(), Error> {
    // TODO(port): narrow error set
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
    // TODO(port): narrow error set

    let mut tmpname_buf = [0u8; 512];
    tmpname_buf[0..8].copy_from_slice(b"tmplock-");
    // PORT NOTE: `FileSystem.RealFS.Tmpfile` (fs.zig) — POSIX path never used
    // its `*RealFS` arg; Windows opens via `get_default_temp_dir`.
    let mut tmpfile = bun_resolver::fs::RealFsTmpfile::default();
    let mut secret = [0u8; 32];
    secret[0..8].copy_from_slice(
        &u64::try_from(bun_core::time::milli_timestamp())
            .expect("int cast")
            .to_le_bytes(),
    );
    let mut base64_bytes = [0u8; 64];
    bun_core::csprng(&mut base64_bytes);

    // Zig `std.fmt.bufPrint(buf, "{x}", .{&base64_bytes})` on a `*[64]u8` formats
    // each byte as zero-padded 2-char lower hex (128 chars total).
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
        Output::pretty_errorln(format_args!(
            "<r><red>error:<r> failed to create tmpfile: {}",
            err.name()
        ));
        Global::crash();
    }

    let file = tmpfile.file();
    {
        let mut printer = crate::lockfile_real::Printer {
            lockfile: &this.lockfile,
            options: &this.options,
            successfully_installed: None,
            // PORT NOTE: Zig leaves `.updates` at its default `&.{}`. `Yarn::print`
            // never reads `updates`, but pass an empty slice to match the spec
            // exactly rather than `&this.update_requests`.
            updates: &[],
        };
        // PORT NOTE: Zig used `file.writerStreaming(&[4096]u8)`. `bun_sys::File`
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

// PORTING.md §Global mutable state: bool flag → AtomicBool. Set once during
// the (Once-guarded) temp-dir probe; never read today but kept for Zig parity.
static USING_FALLBACK_TEMP_DIR: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

// ────────────────────────────── helpers ───────────────────────────────────────

#[inline]
fn verbose_install() -> bool {
    // SAFETY: `VERBOSE_INSTALL` is set once during single-threaded CLI startup
    // (PackageManagerOptions.load) and only read on the main thread.
    PackageManager::verbose_install()
}

/// Thread-local cached folder-name buffer accessor. Zig used a plain
/// `threadlocal var [bun.MAX_PATH_BYTES]u8`. PORTING.md §Global mutable state:
/// single-threaded install, non-reentrant scratch — the `&'static mut [u8]`
/// is the unique live borrow at every call site. Callers must not hold the
/// result across a call that re-enters this accessor (per-statement reborrow
/// shape — same contract the prior `*mut [u8]` API imposed, now centralized
/// here so the 6 call sites drop their `unsafe` block).
#[inline]
fn cached_package_folder_name_buf() -> &'static mut [u8] {
    // SAFETY: single-threaded usage (install runs on one thread); the
    // thread-local cell outlives all callers and only one `&mut` is taken at a
    // time per call site (Zig also reused this buffer non-reentrantly).
    unsafe { (*super::cached_package_folder_name_buf()).as_mut_slice() }
}

/// `&'static ZStr` from a NUL-terminated literal.
#[inline]
const fn z_static(bytes_with_nul: &'static [u8]) -> &'static ZStr {
    // `from_static` is the const-eval-safe form of `from_slice_with_nul`.
    ZStr::from_static(bytes_with_nul)
}

// ported from: src/install/PackageManager/PackageManagerDirectories.zig

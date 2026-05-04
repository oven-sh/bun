use core::fmt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_cli::Command;
use bun_core::{env_var, fmt as bun_fmt, Error, Global, Output, Progress};
use bun_dotenv::Loader as DotEnvLoader;
use bun_fs::FileSystem;
use bun_install::lockfile::Lockfile;
use bun_install::{PackageID, Repository, Resolution};
use bun_paths::{self as path, AbsPath, PathBuffer, MAX_PATH_BYTES, SEP};
use bun_semver::{self as Semver, String as SemverString};
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Dir, Fd, File};

use super::{Options, PackageManager, ProgressStrings};

// ───────────────────────────── cache directory ────────────────────────────────

#[inline]
pub fn get_cache_directory(this: &mut PackageManager) -> Dir {
    match this.cache_directory_ {
        Some(d) => d,
        None => {
            let d = ensure_cache_directory(this);
            this.cache_directory_ = Some(d);
            d
        }
    }
}

#[inline]
pub fn get_cache_directory_and_abs_path(this: &mut PackageManager) -> (Fd, AbsPath) {
    let cache_dir = get_cache_directory(this);
    (Fd::from_std_dir(cache_dir), AbsPath::from(&this.cache_directory_path))
}

#[inline]
pub fn get_temporary_directory(this: &mut PackageManager) -> &'static TemporaryDirectory {
    GET_TEMPORARY_DIRECTORY_ONCE.call(this)
}

pub struct TemporaryDirectory {
    pub handle: Dir,
    pub path: Box<ZStr>,
    pub name: &'static [u8],
}

// We need a temporary directory that can be rename()
// This is important for extracting files.
//
// However, we want it to be reused! Otherwise a cache is silly.
//   Error RenameAcrossMountPoints moving react-is to cache dir:
static GET_TEMPORARY_DIRECTORY_ONCE: bun_core::Once<TemporaryDirectory, fn(&mut PackageManager) -> TemporaryDirectory> =
    bun_core::Once::new(get_temporary_directory_run);

fn get_temporary_directory_run(manager: &mut PackageManager) -> TemporaryDirectory {
    let cache_directory = get_cache_directory(manager);
    // The chosen tempdir must be on the same filesystem as the cache directory
    // This makes renameat() work
    let temp_dir_name = bun_fs::file_system::RealFS::get_default_temp_dir();

    let mut tried_dot_tmp = false;
    let mut tempdir: Dir = match sys::make_path::make_open_path(Dir::cwd(), temp_dir_name, Default::default()) {
        Ok(d) => d,
        Err(_) => {
            tried_dot_tmp = true;
            match sys::make_path::make_open_path(cache_directory, bun_paths::path_literal(".tmp"), Default::default()) {
                Ok(d) => d,
                Err(err) => {
                    Output::pretty_errorln(
                        format_args!("<r><red>error<r>: bun is unable to access tempdir: {}", err.name()),
                    );
                    Global::crash();
                }
            }
        }
    };

    let mut tmpbuf = PathBuffer::uninit();
    let tmpname = FileSystem::tmpname(b"hm", &mut tmpbuf, bun_core::fast_random()).expect("unreachable");

    // TODO(port): std.time.Timer — using bun_core::time::Timer placeholder
    let mut timer = if manager.options.log_level != Options::LogLevel::Silent {
        Some(bun_core::time::Timer::start().expect("unreachable"))
    } else {
        None
    };

    'brk: loop {
        let file = match tempdir.create_file_z(tmpname, sys::CreateFileOptions { truncate: true, ..Default::default() }) {
            Ok(f) => f,
            Err(err2) => {
                if !tried_dot_tmp {
                    tried_dot_tmp = true;

                    tempdir = match sys::make_path::make_open_path(
                        cache_directory,
                        bun_paths::path_literal(".tmp"),
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

                    if PackageManager::verbose_install() {
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
        file.close();

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

                    if PackageManager::verbose_install() {
                        Output::pretty_errorln(format_args!(
                            "<r><d>info<r>: cannot move files from tempdir: {}, using fallback",
                            err.name()
                        ));
                    }

                    continue 'brk;
                }

                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: {} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>",
                    err.name()
                ));
                Global::crash();
            }
        }
        let _ = cache_directory.delete_file_z(tmpname);
        break;
    }

    if tried_dot_tmp {
        // SAFETY: single-threaded init via Once
        unsafe { USING_FALLBACK_TEMP_DIR = true; }
    }

    if manager.options.log_level != Options::LogLevel::Silent {
        let elapsed = timer.as_mut().unwrap().read();
        if elapsed > bun_core::time::NS_PER_MS * 100 {
            let mut path_buf = PathBuffer::uninit();
            let cache_dir_path =
                sys::get_fd_path(Fd::from_std_dir(cache_directory), &mut path_buf).unwrap_or(b"it");
            Output::pretty_errorln(format_args!(
                "<r><yellow>warn<r>: Slow filesystem detected. If {} is a network drive, consider setting $BUN_INSTALL_CACHE_DIR to a local folder.",
                bstr::BStr::new(cache_dir_path)
            ));
        }
    }

    let mut buf = PathBuffer::uninit();
    let temp_dir_path = match sys::get_fd_path_z(Fd::from_std_dir(tempdir), &mut buf) {
        Ok(p) => p,
        Err(err) => {
            Output::err(err, format_args!("Failed to read temporary directory path: '{}'", bstr::BStr::new(temp_dir_name)));
            Global::exit(1);
        }
    };

    TemporaryDirectory {
        handle: tempdir,
        name: temp_dir_name,
        path: ZStr::from_bytes(temp_dir_path.as_bytes()),
    }
}

#[cold]
#[inline(never)]
fn ensure_cache_directory(this: &mut PackageManager) -> Dir {
    loop {
        if this.options.enable.cache {
            let cache_dir = fetch_cache_directory_path(&mut this.env, Some(&this.options));
            this.cache_directory_path = ZStr::from_bytes(cache_dir.path);

            match Dir::cwd().make_open_path(cache_dir.path, Default::default()) {
                Ok(d) => return d,
                Err(_) => {
                    this.options.enable.cache = false;
                    // PORT NOTE: allocator.free(this.cache_directory_path) — Box drop handles it
                    this.cache_directory_path = Default::default();
                    continue;
                }
            }
        }

        this.cache_directory_path = ZStr::from_bytes(path::join_abs_string(
            FileSystem::instance().top_level_dir(),
            &[b"node_modules", b".cache"],
            path::Platform::Auto,
        ));

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
    pub path: &'static [u8],
    pub is_node_modules: bool,
}

pub fn fetch_cache_directory_path(env: &mut DotEnvLoader, options: Option<&Options>) -> CacheDir {
    if let Some(dir) = env.get(b"BUN_INSTALL_CACHE_DIR") {
        return CacheDir { path: FileSystem::instance().abs(&[dir]), is_node_modules: false };
    }

    if let Some(opts) = options {
        if !opts.cache_directory.is_empty() {
            return CacheDir { path: FileSystem::instance().abs(&[&opts.cache_directory]), is_node_modules: false };
        }
    }

    if let Some(dir) = env.get(b"BUN_INSTALL") {
        let parts: [&[u8]; 3] = [dir, b"install/", b"cache/"];
        return CacheDir { path: FileSystem::instance().abs(&parts), is_node_modules: false };
    }

    if let Some(dir) = env_var::XDG_CACHE_HOME.get() {
        let parts: [&[u8]; 4] = [dir, b".bun/", b"install/", b"cache/"];
        return CacheDir { path: FileSystem::instance().abs(&parts), is_node_modules: false };
    }

    if let Some(dir) = env_var::HOME.get() {
        let parts: [&[u8]; 4] = [dir, b".bun/", b"install/", b"cache/"];
        return CacheDir { path: FileSystem::instance().abs(&parts), is_node_modules: false };
    }

    let fallback_parts: [&[u8]; 1] = [b"node_modules/.bun-cache"];
    CacheDir { is_node_modules: true, path: FileSystem::instance().abs(&fallback_parts) }
}

// ─────────────────────── cached folder name printers ──────────────────────────

pub fn cached_git_folder_name_print(buf: &mut [u8], resolved: &[u8], patch_hash: Option<u64>) -> &ZStr {
    buf_print_z(buf, format_args!("@G@{}{}", bstr::BStr::new(resolved), PatchHashFmt { hash: patch_hash }))
        .expect("unreachable")
}

pub fn cached_git_folder_name(this: &PackageManager, repository: &Repository, patch_hash: Option<u64>) -> &'static ZStr {
    cached_git_folder_name_print(
        PackageManager::cached_package_folder_name_buf(),
        this.lockfile.str(&repository.resolved),
        patch_hash,
    )
}

pub fn cached_git_folder_name_print_auto(this: &PackageManager, repository: &Repository, patch_hash: Option<u64>) -> &'static ZStr {
    if !repository.resolved.is_empty() {
        return cached_git_folder_name(this, repository, patch_hash);
    }

    if !repository.repo.is_empty() && !repository.committish.is_empty() {
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();
        return buf_print_z(
            PackageManager::cached_package_folder_name_buf(),
            format_args!(
                "@G@{}{}{}",
                repository.committish.fmt(string_buf),
                CacheVersionFormatter { version_number: Some(CacheVersion::CURRENT) },
                PatchHashFmt { hash: patch_hash },
            ),
        )
        .expect("unreachable");
    }

    ZStr::EMPTY
}

pub fn cached_github_folder_name_print(buf: &mut [u8], resolved: &[u8], patch_hash: Option<u64>) -> &ZStr {
    buf_print_z(
        buf,
        format_args!(
            "@GH@{}{}{}",
            bstr::BStr::new(resolved),
            CacheVersionFormatter { version_number: Some(CacheVersion::CURRENT) },
            PatchHashFmt { hash: patch_hash },
        ),
    )
    .expect("unreachable")
}

pub fn cached_github_folder_name(this: &PackageManager, repository: &Repository, patch_hash: Option<u64>) -> &'static ZStr {
    cached_github_folder_name_print(
        PackageManager::cached_package_folder_name_buf(),
        this.lockfile.str(&repository.resolved),
        patch_hash,
    )
}

pub fn cached_github_folder_name_print_auto(this: &PackageManager, repository: &Repository, patch_hash: Option<u64>) -> &'static ZStr {
    if !repository.resolved.is_empty() {
        return cached_github_folder_name(this, repository, patch_hash);
    }

    if !repository.owner.is_empty() && !repository.repo.is_empty() && !repository.committish.is_empty() {
        return cached_github_folder_name_print_guess(
            PackageManager::cached_package_folder_name_buf(),
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
        return cached_npm_package_folder_print_basename(buf, name, version, patch_hash, include_version_number);
    }

    let include_version_number = false;
    let basename = cached_npm_package_folder_print_basename(buf, name, version, None, include_version_number);

    let spanned_len = basename.as_bytes().len();
    // PORT NOTE: reshaped for borrowck — drop `basename` borrow before re-borrowing `buf`
    let available = &mut buf[spanned_len..];
    let end_len: usize;
    if scope.url.hostname.len() > 32 || available.len() < 64 {
        let visible_hostname = &scope.url.hostname[..scope.url.hostname.len().min(12)];
        end_len = buf_print(
            available,
            format_args!(
                "@@{}__{}{}{}",
                bstr::BStr::new(visible_hostname),
                bun_fmt::hex_int_lower(SemverString::Builder::string_hash(&scope.url.href)),
                CacheVersionFormatter { version_number: Some(CacheVersion::CURRENT) },
                PatchHashFmt { hash: patch_hash },
            ),
        )
        .expect("unreachable");
    } else {
        end_len = buf_print(
            available,
            format_args!(
                "@@{}{}{}",
                bstr::BStr::new(&scope.url.hostname),
                CacheVersionFormatter { version_number: Some(CacheVersion::CURRENT) },
                PatchHashFmt { hash: patch_hash },
            ),
        )
        .expect("unreachable");
    }

    buf[spanned_len + end_len] = 0;
    // SAFETY: buf[spanned_len + end_len] == 0 written above
    unsafe { ZStr::from_raw(buf.as_ptr(), spanned_len + end_len) }
}

fn cached_github_folder_name_print_guess<'a>(
    buf: &'a mut [u8],
    string_buf: &[u8],
    repository: &Repository,
    patch_hash: Option<u64>,
) -> &'a ZStr {
    buf_print_z(
        buf,
        format_args!(
            "@GH@{}-{}-{}{}{}",
            repository.owner.fmt(string_buf),
            repository.repo.fmt(string_buf),
            repository.committish.fmt(string_buf),
            CacheVersionFormatter { version_number: Some(CacheVersion::CURRENT) },
            PatchHashFmt { hash: patch_hash },
        ),
    )
    .expect("unreachable")
}

pub fn cached_npm_package_folder_name(this: &PackageManager, name: &[u8], version: Semver::Version, patch_hash: Option<u64>) -> &'static ZStr {
    cached_npm_package_folder_name_print(this, PackageManager::cached_package_folder_name_buf(), name, version, patch_hash)
}

// TODO: normalize to alphanumeric
pub fn cached_npm_package_folder_print_basename<'a>(
    buf: &'a mut [u8],
    name: &[u8],
    version: Semver::Version,
    patch_hash: Option<u64>,
    include_cache_version: bool,
) -> &'a ZStr {
    let cache_ver = CacheVersionFormatter {
        version_number: if include_cache_version { Some(CacheVersion::CURRENT) } else { None },
    };
    if version.tag.has_pre() {
        if version.tag.has_build() {
            return buf_print_z(
                buf,
                format_args!(
                    "{}@{}.{}.{}-{}+{}{}{}",
                    bstr::BStr::new(name),
                    version.major,
                    version.minor,
                    version.patch,
                    bun_fmt::hex_int_lower(version.tag.pre.hash),
                    bun_fmt::hex_int_upper(version.tag.build.hash),
                    cache_ver,
                    PatchHashFmt { hash: patch_hash },
                ),
            )
            .expect("unreachable");
        }
        return buf_print_z(
            buf,
            format_args!(
                "{}@{}.{}.{}-{}{}{}",
                bstr::BStr::new(name),
                version.major,
                version.minor,
                version.patch,
                bun_fmt::hex_int_lower(version.tag.pre.hash),
                cache_ver,
                PatchHashFmt { hash: patch_hash },
            ),
        )
        .expect("unreachable");
    }
    if version.tag.has_build() {
        return buf_print_z(
            buf,
            format_args!(
                "{}@{}.{}.{}+{}{}{}",
                bstr::BStr::new(name),
                version.major,
                version.minor,
                version.patch,
                bun_fmt::hex_int_upper(version.tag.build.hash),
                cache_ver,
                PatchHashFmt { hash: patch_hash },
            ),
        )
        .expect("unreachable");
    }
    buf_print_z(
        buf,
        format_args!(
            "{}@{}.{}.{}{}{}",
            bstr::BStr::new(name),
            version.major,
            version.minor,
            version.patch,
            cache_ver,
            PatchHashFmt { hash: patch_hash },
        ),
    )
    .expect("unreachable")
}

pub fn cached_tarball_folder_name_print(buf: &mut [u8], url: &[u8], patch_hash: Option<u64>) -> &ZStr {
    buf_print_z(
        buf,
        format_args!(
            "@T@{}{}{}",
            bun_fmt::hex_int_lower(SemverString::Builder::string_hash(url)),
            CacheVersionFormatter { version_number: Some(CacheVersion::CURRENT) },
            PatchHashFmt { hash: patch_hash },
        ),
    )
    .expect("unreachable")
}

pub fn cached_tarball_folder_name(this: &PackageManager, url: SemverString, patch_hash: Option<u64>) -> &'static ZStr {
    cached_tarball_folder_name_print(PackageManager::cached_package_folder_name_buf(), this.lockfile.str(&url), patch_hash)
}

pub fn is_folder_in_cache(this: &mut PackageManager, folder_path: &ZStr) -> bool {
    sys::directory_exists_at(Fd::from_std_dir(get_cache_directory(this)), folder_path)
        .unwrap()
        .unwrap_or(false)
}

// ─────────────────────────── global directories ───────────────────────────────

pub fn setup_global_dir(manager: &mut PackageManager, ctx: &Command::Context) -> Result<(), Error> {
    manager.options.global_bin_dir = Options::open_global_bin_dir(ctx.install.as_ref())?;
    let mut out_buffer = PathBuffer::uninit();
    let result = sys::get_fd_path_z(Fd::from_std_dir(manager.options.global_bin_dir), &mut out_buffer)?;
    let path = FileSystem::instance().dirname_store.append_z(result)?;
    // SAFETY: `path` was just NUL-terminated by append_z and lives for program lifetime in dirname_store
    manager.options.bin_path = unsafe { ZStr::from_raw(path.as_ptr(), path.len()) };
    Ok(())
}

pub fn global_link_dir(this: &mut PackageManager) -> Dir {
    if let Some(d) = this.global_link_dir {
        return d;
    }

    let global_dir = match Options::open_global_dir(&this.options.explicit_global_directory) {
        Ok(d) => d,
        Err(err) if err == bun_core::err!("No global directory found") => {
            Output::err_generic(format_args!(
                "failed to find a global directory for package caching and global link directories"
            ));
            Global::exit(1);
        }
        Err(err) => {
            Output::err(err, format_args!("failed to open the global directory"));
            Global::exit(1);
        }
    };
    this.global_dir = Some(global_dir);
    this.global_link_dir = Some(match global_dir.make_open_path(b"node_modules", Default::default()) {
        Ok(d) => d,
        Err(err) => {
            Output::err(
                err,
                format_args!("failed to open global link dir node_modules at '{}'", Fd::from_std_dir(global_dir)),
            );
            Global::exit(1);
        }
    });
    let mut buf = PathBuffer::uninit();
    let path_ = match sys::get_fd_path(Fd::from_std_dir(this.global_link_dir.unwrap()), &mut buf) {
        Ok(p) => p,
        Err(err) => {
            Output::err(err, format_args!("failed to get the full path of the global directory"));
            Global::exit(1);
        }
    };
    this.global_link_dir_path = bun_fs::file_system::DirnameStore::instance().append(path_);
    this.global_link_dir.unwrap()
}

pub fn global_link_dir_path(this: &mut PackageManager) -> &[u8] {
    let _ = global_link_dir(this);
    this.global_link_dir_path
}

pub fn global_link_dir_and_path(this: &mut PackageManager) -> (Dir, &[u8]) {
    let dir = global_link_dir(this);
    (dir, this.global_link_dir_path)
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

    let cache_path = cached_npm_package_folder_name_print(this, cache_path_buf.as_mut_slice(), package_name, version, None);
    let cache_path_len = cache_path.as_bytes().len();
    // PORT NOTE: reshaped for borrowck — drop borrow before mutating buffer

    if cfg!(debug_assertions) {
        debug_assert!(cache_path_buf[package_name.len()] == b'@');
    }

    cache_path_buf[package_name.len()] = SEP;

    let cache_dir: Fd = Fd::from_std_dir(get_cache_directory(this));

    #[cfg(windows)]
    {
        let mut path_buf = PathBuffer::uninit();
        // SAFETY: cache_path_buf[cache_path_len] == 0 written by buf_print_z above
        let cache_path = unsafe { ZStr::from_raw(cache_path_buf.as_ptr(), cache_path_len) };
        let joined = path::join_abs_string_buf_z(
            &this.cache_directory_path,
            &mut path_buf,
            &[cache_path.as_bytes()],
            path::Platform::Windows,
        );
        return match sys::readlink(joined, buf).unwrap() {
            Ok(p) => Ok(p),
            Err(err) => {
                let _ = sys::unlink(joined);
                Err(err.into())
            }
        };
    }

    #[cfg(not(windows))]
    {
        // SAFETY: cache_path_buf[cache_path_len] == 0 written by buf_print_z above
        let cache_path = unsafe { ZStr::from_raw(cache_path_buf.as_ptr(), cache_path_len) };
        match cache_dir.readlinkat(cache_path, buf).unwrap() {
            Ok(p) => Ok(p),
            Err(err) => {
                // if we run into an error, delete the symlink
                // so that we don't repeatedly try to read it
                let _ = cache_dir.unlinkat(cache_path);
                Err(err.into())
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
        Resolution::Tag::Npm => {
            let npm = resolution.value.npm;
            let package_name_ = this.lockfile.packages.items_name()[package_id as usize];
            let package_name = this.lockfile.str(&package_name_);

            path_for_cached_npm_path(this, buf, package_name, npm.version)
        }
        _ => Ok(&mut buf.as_mut_slice()[..0]),
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
    let buf = manager.lockfile.buffers.string_bytes.as_slice();
    let mut cache_dir = Dir::cwd();
    let mut cache_dir_subpath: &ZStr = ZStr::EMPTY;

    match resolution.tag {
        Resolution::Tag::Npm => {
            cache_dir_subpath = cached_npm_package_folder_name(manager, name, resolution.value.npm.version, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        Resolution::Tag::Git => {
            cache_dir_subpath = cached_git_folder_name(manager, &resolution.value.git, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        Resolution::Tag::Github => {
            cache_dir_subpath = cached_github_folder_name(manager, &resolution.value.github, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        Resolution::Tag::Folder => {
            let folder = resolution.value.folder.slice(buf);
            // Handle when a package depends on itself via file:
            // example:
            //   "mineflayer": "file:."
            if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                cache_dir_subpath = ZStr::from_static(b".\0");
            } else {
                folder_path_buf[..folder.len()].copy_from_slice(folder);
                folder_path_buf[folder.len()] = 0;
                // SAFETY: folder_path_buf[folder.len()] == 0 written above
                cache_dir_subpath = unsafe { ZStr::from_raw(folder_path_buf.as_ptr(), folder.len()) };
            }
            cache_dir = Dir::cwd();
        }
        Resolution::Tag::LocalTarball => {
            cache_dir_subpath = cached_tarball_folder_name(manager, resolution.value.local_tarball, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        Resolution::Tag::RemoteTarball => {
            cache_dir_subpath = cached_tarball_folder_name(manager, resolution.value.remote_tarball, patch_hash);
            cache_dir = get_cache_directory(manager);
        }
        Resolution::Tag::Workspace => {
            let folder = resolution.value.workspace.slice(buf);
            // Handle when a package depends on itself
            if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                cache_dir_subpath = ZStr::from_static(b".\0");
            } else {
                folder_path_buf[..folder.len()].copy_from_slice(folder);
                folder_path_buf[folder.len()] = 0;
                // SAFETY: folder_path_buf[folder.len()] == 0 written above
                cache_dir_subpath = unsafe { ZStr::from_raw(folder_path_buf.as_ptr(), folder.len()) };
            }
            cache_dir = Dir::cwd();
        }
        Resolution::Tag::Symlink => {
            let directory = global_link_dir(manager);

            let folder = resolution.value.symlink.slice(buf);

            if folder.is_empty() || (folder.len() == 1 && folder[0] == b'.') {
                cache_dir_subpath = ZStr::from_static(b".\0");
                cache_dir = Dir::cwd();
            } else {
                let global_link_dir = global_link_dir_path(manager);
                let ptr = folder_path_buf.as_mut_slice();
                let mut off = 0usize;
                ptr[off..off + global_link_dir.len()].copy_from_slice(global_link_dir);
                off += global_link_dir.len();
                if global_link_dir[global_link_dir.len() - 1] != SEP {
                    ptr[off] = SEP;
                    off += 1;
                }
                ptr[off..off + folder.len()].copy_from_slice(folder);
                off += folder.len();
                ptr[off] = 0;
                let len = off;
                // SAFETY: ptr[len] == 0 written above
                cache_dir_subpath = unsafe { ZStr::from_raw(folder_path_buf.as_ptr(), len) };
                cache_dir = directory;
            }
        }
        _ => {}
    }

    CacheDirAndSubpath { cache_dir, cache_dir_subpath }
}

// ─────────────────────────── package.json / lockfile ──────────────────────────

pub fn attempt_to_create_package_json_and_open() -> Result<File, Error> {
    // TODO(port): narrow error set
    let package_json_file = match Dir::cwd().create_file_z(
        ZStr::from_static(b"package.json\0"),
        sys::CreateFileOptions { read: true, ..Default::default() },
    ) {
        Ok(f) => f,
        Err(err) => {
            Output::pretty_errorln(format_args!("<r><red>error:<r> {} create package.json", err.name()));
            Global::crash();
        }
    };

    package_json_file.pwrite_all(b"{\"dependencies\": {}}", 0)?;

    Ok(package_json_file)
}

pub fn attempt_to_create_package_json() -> Result<(), Error> {
    // TODO(port): narrow error set
    let file = attempt_to_create_package_json_and_open()?;
    file.close();
    Ok(())
}

pub fn save_lockfile(
    this: &mut PackageManager,
    load_result: &Lockfile::LoadResult,
    save_format: Lockfile::LoadResult::LockfileFormat,
    had_any_diffs: bool,
    // TODO(dylan-conway): this and `packages_len_before_install` can most likely be deleted
    // now that git dependnecies don't append to lockfile during installation.
    lockfile_before_install: &Lockfile,
    packages_len_before_install: usize,
    log_level: Options::LogLevel,
) -> Result<(), AllocError> {
    if this.lockfile.is_empty() {
        if !this.options.dry_run {
            'delete: {
                let delete_format = match load_result {
                    Lockfile::LoadResult::NotFound => break 'delete,
                    Lockfile::LoadResult::Err(err) => err.format,
                    Lockfile::LoadResult::Ok(ok) => ok.format,
                };

                match sys::unlinkat(
                    Fd::cwd(),
                    if delete_format == Lockfile::LoadResult::LockfileFormat::Text {
                        bun_paths::os_path_literal("bun.lock")
                    } else {
                        bun_paths::os_path_literal("bun.lockb")
                    },
                )
                .unwrap()
                {
                    Ok(()) => {}
                    Err(err) => {
                        // we don't care
                        if err == bun_core::err!(ENOENT) {
                            if had_any_diffs {
                                return Ok(());
                            }
                            break 'delete;
                        }

                        if log_level != Options::LogLevel::Silent {
                            Output::err(err, format_args!("failed to delete empty lockfile"));
                        }
                        return Ok(());
                    }
                }
            }
        }
        if !this.options.global {
            if log_level != Options::LogLevel::Silent {
                match this.subcommand {
                    PackageManager::Subcommand::Remove => {
                        Output::pretty_errorln(format_args!("\npackage.json has no dependencies! Deleted empty lockfile"))
                    }
                    _ => Output::pretty_errorln(format_args!("No packages! Deleted empty lockfile")),
                }
            }
        }

        return Ok(());
    }

    let mut save_node: Option<&mut Progress::Node> = None;

    if log_level.show_progress() {
        this.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        save_node = Some(this.progress.start(ProgressStrings::save(), 0));
        save_node.as_mut().unwrap().activate();

        this.progress.refresh();
    }

    this.lockfile.save_to_disk(load_result, &this.options);

    // delete binary lockfile if saving text lockfile
    if save_format == Lockfile::LoadResult::LockfileFormat::Text && load_result.loaded_from_binary_lockfile() {
        let _ = sys::unlinkat(Fd::cwd(), bun_paths::os_path_literal("bun.lockb"));
    }

    if cfg!(debug_assertions) {
        if !matches!(load_result, Lockfile::LoadResult::NotFound) {
            if load_result.loaded_from_text_lockfile() {
                if !this.lockfile.eql(lockfile_before_install, packages_len_before_install)? {
                    Output::panic(format_args!("Lockfile non-deterministic after saving"));
                }
            } else {
                if this.lockfile.has_meta_hash_changed(false, packages_len_before_install).unwrap_or(false) {
                    Output::panic(format_args!("Lockfile metahash non-deterministic after saving"));
                }
            }
        }
    }

    if log_level.show_progress() {
        save_node.unwrap().end();
        this.progress.refresh();
        this.progress.root.end();
        this.progress = Default::default();
    } else if log_level != Options::LogLevel::Silent {
        Output::pretty_errorln(format_args!("Saved lockfile"));
        Output::flush();
    }

    Ok(())
}

pub fn update_lockfile_if_needed(
    manager: &mut PackageManager,
    load_result: Lockfile::LoadResult,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if let Lockfile::LoadResult::Ok(ok) = &load_result {
        if ok.serializer_result.packages_need_update {
            let slice = manager.lockfile.packages.slice();
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
    let mut printer = Lockfile::Printer {
        lockfile: this.lockfile,
        options: &this.options,
    };

    let mut tmpname_buf = [0u8; 512];
    tmpname_buf[0..8].copy_from_slice(b"tmplock-");
    let mut tmpfile = bun_fs::file_system::RealFS::Tmpfile::default();
    let mut secret = [0u8; 32];
    secret[0..8].copy_from_slice(&u64::try_from(bun_core::time::milli_timestamp()).unwrap().to_le_bytes());
    let mut base64_bytes = [0u8; 64];
    bun_core::crypto::random_bytes(&mut base64_bytes);

    // TODO(port): Zig `std.fmt.bufPrint(buf, "{x}", .{&base64_bytes})` formats each u8 as
    // lower-hex WITHOUT zero-pad (1–2 chars/byte); length is computed from the returned slice.
    let tmpname_len = {
        let mut cursor = &mut tmpname_buf[8..];
        let initial_len = cursor.len();
        for b in &base64_bytes {
            write!(cursor, "{:x}", b).expect("unreachable");
        }
        initial_len - cursor.len()
    };
    tmpname_buf[tmpname_len + 8] = 0;
    // SAFETY: tmpname_buf[tmpname_len + 8] == 0 written above
    let tmpname = unsafe { ZStr::from_raw(tmpname_buf.as_ptr(), tmpname_len + 8) };

    if let Err(err) = tmpfile.create(&FileSystem::instance().fs, tmpname) {
        Output::pretty_errorln(format_args!("<r><red>error:<r> failed to create tmpfile: {}", err.name()));
        Global::crash();
    }

    let file = tmpfile.file();
    // TODO(port): std.fs.File.writerStreaming — using bun_io buffered writer
    let mut file_buffer = [0u8; 4096];
    let mut writer = bun_io::BufWriter::with_buffer(&mut file_buffer, file);
    Lockfile::Printer::Yarn::print(&mut printer, &mut writer)?;
    writer.flush()?;

    #[cfg(unix)]
    {
        let _ = bun_sys::c::fchmod(
            tmpfile.fd.cast(),
            // chmod 666,
            0o0000040 | 0o0000004 | 0o0000002 | 0o0000400 | 0o0000200 | 0o0000020,
        );
    }

    tmpfile.promote_to_cwd(tmpname, b"yarn.lock")?;
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

static mut USING_FALLBACK_TEMP_DIR: bool = false;

// ────────────────────────────── helpers ───────────────────────────────────────

// TODO(port): move to bun_str / bun_core if not already provided
/// Equivalent of `std.fmt.bufPrintZ` — writes formatted bytes into `buf`,
/// appends a NUL terminator, and returns a `&ZStr` borrowing `buf`.
fn buf_print_z(buf: &mut [u8], args: fmt::Arguments<'_>) -> Result<&ZStr, fmt::Error> {
    let total = buf.len();
    let mut cursor: &mut [u8] = buf;
    cursor.write_fmt(args).map_err(|_| fmt::Error)?;
    let remaining = cursor.len();
    let written = total - remaining;
    if written >= total {
        return Err(fmt::Error);
    }
    buf[written] = 0;
    // SAFETY: buf[written] == 0 written above; bytes [0..written] initialized by write_fmt
    Ok(unsafe { ZStr::from_raw(buf.as_ptr(), written) })
}

/// Equivalent of `std.fmt.bufPrint` — returns the number of bytes written.
fn buf_print(buf: &mut [u8], args: fmt::Arguments<'_>) -> Result<usize, fmt::Error> {
    let total = buf.len();
    let mut cursor: &mut [u8] = buf;
    cursor.write_fmt(args).map_err(|_| fmt::Error)?;
    let remaining = cursor.len();
    Ok(total - remaining)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/PackageManagerDirectories.zig (783 lines)
//   confidence: medium
//   todos:      9
//   notes:      bun.once → bun_core::Once placeholder; bufPrintZ helper inlined locally; threadlocal cached_package_folder_name_buf returns &'static mut — Phase B must verify lifetimes; std.fs.Dir mapped to bun_sys::Dir
// ──────────────────────────────────────────────────────────────────────────

use core::cell::RefCell;
use core::fmt;

use bun_core::fmt::s;
use bun_core::{self as bun, Output, fmt as bun_fmt};
use bun_core::{StringOrTinyString, ZStr};
use bun_paths::strings;
use bun_paths::{self as path, PathBuffer, WPathBuffer};
use bun_semver::{self as Semver, Version};
use bun_sys::{self as sys, Dir, Fd};

use bun_install::install::{self as Install, DependencyID, ExtractData};
use bun_install::integrity::Integrity;
use bun_install::npm::{self as Npm};
use bun_install::package_manager_real::PackageManager;
use bun_install::package_manager_real::directories;
use bun_install::resolution::{Resolution, Tag as ResolutionTag};
use bun_libarchive::{ArchiveAppender, ExtractOptions};
use bun_resolver::fs::FileSystem;
use bun_sys::FdDirExt;

// TODO(port): narrow error set
type Error = bun_core::Error;

pub struct ExtractTarball {
    pub name: StringOrTinyString,
    pub resolution: Resolution,
    pub cache_dir: Dir,
    pub temp_dir: Dir,
    pub dependency_id: DependencyID,
    pub skip_verify: bool,    // = false
    pub integrity: Integrity, // = Integrity::default()
    pub url: StringOrTinyString,
    /// BACKREF: PackageManager owns the task pool that owns this struct.
    pub package_manager: bun_ptr::BackRef<PackageManager>,
}

impl ExtractTarball {
    #[inline]
    pub fn run(&self, log: &mut bun_ast::Log, bytes: &[u8]) -> Result<ExtractData, Error> {
        if !self.skip_verify && self.integrity.tag.is_supported() {
            if !self.integrity.verify(bytes) {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Integrity check failed<r> for tarball: {}",
                        bun_fmt::s(self.name.slice()),
                    ),
                );
                return Err(bun_core::err!("IntegrityCheckFailed"));
            }
        }
        let mut result = self.extract(log, bytes)?;

        // Compute and store SHA-512 integrity hash for GitHub / URL / local tarballs
        // so the lockfile can pin the exact tarball content. On subsequent installs
        // the hash stored in the lockfile is forwarded via this.integrity and verified
        // above, preventing a compromised server from silently swapping the tarball.
        match self.resolution.tag {
            ResolutionTag::Github | ResolutionTag::RemoteTarball | ResolutionTag::LocalTarball => {
                if self.integrity.tag.is_supported() {
                    // Re-installing with an existing lockfile: integrity was already
                    // verified above, propagate the known value to ExtractData so that
                    // the lockfile keeps it on re-serialisation.
                    result.integrity = self.integrity;
                } else {
                    // First install (no integrity in the lockfile yet): compute it.
                    result.integrity = Integrity::for_bytes(bytes);
                }
            }
            _ => {}
        }

        Ok(result)
    }
}

pub fn build_url(
    registry_: &[u8],
    full_name_: &StringOrTinyString,
    version: Version,
    string_buf: &[u8],
) -> Result<&'static [u8], bun_alloc::AllocError> {
    build_url_with_printer(
        registry_,
        full_name_,
        version,
        string_buf,
        // Zig: `FileSystem.DirnameStore.print(fmt, args)` — format directly into
        // the store's tail; no intermediate `String`.
        |args| FileSystem::instance().dirname_store().print(args),
    )
}

/// Generic URL builder. The Zig version threads `comptime PrinterContext`,
/// `comptime ReturnType`, `comptime ErrorType` and a comptime `print` fn; in
/// Rust the closure carries its own context and the generics collapse to `R, E`.
pub fn build_url_with_printer<R, E>(
    registry_: &[u8],
    full_name_: &StringOrTinyString,
    version: Version,
    string_buf: &[u8],
    mut print: impl FnMut(fmt::Arguments<'_>) -> Result<R, E>,
) -> Result<R, E> {
    let registry = strings::trim_right(registry_, b"/");
    let full_name = full_name_.slice();

    let mut name = full_name;
    if name[0] == b'@' {
        if let Some(i) = strings::index_of_char(name, b'/') {
            name = &name[i as usize + 1..];
        }
    }

    // default_format = "{s}/{s}/-/"
    // `bun_fmt::s` writes bytes straight through — registry hosts, package names
    // and semver tags are pre-validated ASCII, so we don't need `bstr::BStr`'s
    // Utf8Chunks scan (Zig `{s}` parity).
    let registry = s(registry);
    let full_name = s(full_name);
    let name = s(name);

    if !version.tag.has_pre() && !version.tag.has_build() {
        print(format_args!(
            "{registry}/{full_name}/-/{name}-{}.{}.{}.tgz",
            version.major, version.minor, version.patch,
        ))
    } else if version.tag.has_pre() && version.tag.has_build() {
        print(format_args!(
            "{registry}/{full_name}/-/{name}-{}.{}.{}-{}+{}.tgz",
            version.major,
            version.minor,
            version.patch,
            s(version.tag.pre.slice(string_buf)),
            s(version.tag.build.slice(string_buf)),
        ))
    } else if version.tag.has_pre() {
        print(format_args!(
            "{registry}/{full_name}/-/{name}-{}.{}.{}-{}.tgz",
            version.major,
            version.minor,
            version.patch,
            s(version.tag.pre.slice(string_buf)),
        ))
    } else if version.tag.has_build() {
        print(format_args!(
            "{registry}/{full_name}/-/{name}-{}.{}.{}+{}.tgz",
            version.major,
            version.minor,
            version.patch,
            s(version.tag.build.slice(string_buf)),
        ))
    } else {
        unreachable!()
    }
}

// TODO(port): `bun.ThreadlocalBuffers(struct{...})` returns a type with `.get()`
// yielding a `*Bufs` into TLS. Model as a thread_local RefCell; callers borrow
// for the duration of the function.
struct TlBufs {
    final_path_buf: PathBuffer,
    folder_name_buf: PathBuffer,
    json_path_buf: PathBuffer,
}

thread_local! {
    // bun.ThreadlocalBuffers: lazily heap-allocate so only a Box pointer lives in TLS
    // (keeps PT_TLS MemSiz small — see test/js/bun/binary/tls-segment-size).
    static TL_BUFS: RefCell<Box<TlBufs>> = RefCell::new(Box::new(TlBufs {
        final_path_buf: PathBuffer::ZEROED,
        folder_name_buf: PathBuffer::ZEROED,
        json_path_buf: PathBuffer::ZEROED,
    }));
}

pub fn uses_streaming_extraction() -> bool {
    !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL
        .get()
        .unwrap_or(false)
}

impl ExtractTarball {
    /// Derive the display name and a filesystem-safe basename for this
    /// package. Shared by the buffered `extract()` path below and the
    /// streaming extractor in `TarballStream.rs` so both pick identical
    /// temp-dir and cache-folder names.
    pub fn name_and_basename(&self) -> (&[u8], &[u8]) {
        let name: &[u8] = if !self.name.slice().is_empty() {
            self.name.slice()
        } else {
            // Not sure where this case hits yet.
            // BUN-2WQ
            Output::warn(&format_args!(
                "Extracting nameless packages is not supported yet. Please open an issue on GitHub with reproduction steps.",
            ));
            debug_assert!(false);
            b"unnamed-package"
        };
        let basename: &[u8] = 'brk: {
            let mut tmp = name;
            if strings::has_prefix(tmp, b"https://") || strings::has_prefix(tmp, b"http://") {
                tmp = bun_paths::basename(tmp);
                if strings::ends_with(tmp, b".tgz") {
                    tmp = &tmp[0..tmp.len() - 4];
                } else if strings::ends_with(tmp, b".tar.gz") {
                    tmp = &tmp[0..tmp.len() - 7];
                }
            } else if tmp[0] == b'@' {
                if let Some(i) = strings::index_of_char(tmp, b'/') {
                    tmp = &tmp[i as usize + 1..];
                }
            }

            #[cfg(windows)]
            {
                if let Some(i) = strings::last_index_of_char(tmp, b':') {
                    tmp = &tmp[i + 1..];
                }
            }

            break 'brk tmp;
        };
        (name, basename)
    }

    fn extract(&self, log: &mut bun_ast::Log, tgz_bytes: &[u8]) -> Result<ExtractData, Error> {
        let _tracer = bun_core::perf::trace("ExtractTarball.extract");

        let tmpdir = self.temp_dir;
        // Zig: `var tmpname_buf: [bun.MAX_PATH_BYTES]u8` — UTF-8 on every
        // platform; the Windows tmpdir path is converted to wide at the
        // `open_dir_at_windows_a` boundary, not here.
        let mut tmpname_buf = PathBuffer::uninit();
        let (name, basename) = self.name_and_basename();

        let mut resolved: &'static [u8] = b"";
        let tmpname = FileSystem::tmpname(
            &basename[0..basename.len().min(32)],
            &mut tmpname_buf.0,
            bun_core::fast_random(),
        )?;
        {
            let extract_destination = match bun_sys::make_path::make_open_path(
                tmpdir,
                tmpname.as_bytes(),
                Default::default(),
            ) {
                Ok(d) => d,
                Err(err) => {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "{} when create temporary directory named \"{}\" (while extracting \"{}\")",
                            err.name(),
                            bun_fmt::s(tmpname.as_bytes()),
                            bun_fmt::s(name),
                        ),
                    );
                    return Err(bun_core::err!("InstallFailed"));
                }
            };
            // `defer extract_destination.close()` — bun_sys::Dir is Copy with NO Drop impl
            // (see src/sys/lib.rs: "close on Drop is NOT done"), so close explicitly via
            // scopeguard. `Dir` is Copy, so `extract_destination` remains usable below.
            let _close_extract_destination = scopeguard::guard(extract_destination, |d| d.close());

            use bun_libarchive::Archiver;
            use bun_zlib as Zlib;
            let mut zlib_pool = Npm::Registry::BodyPool::get();
            zlib_pool.reset();
            // `defer Npm.Registry.BodyPool.release(zlib_pool)` → PoolGuard's Drop releases.

            let mut esimated_output_size: usize = 0;

            let time_started_for_verbose_logs: u64 = if PackageManager::verbose_install() {
                bun_core::Timespec::now_allow_mocked_time().ns()
            } else {
                0
            };

            {
                // Last 4 bytes of a gzip-compressed file are the uncompressed size.
                if tgz_bytes.len() > 16 {
                    // If the file claims to be larger than 16 bytes and smaller than 64 MB, we'll preallocate the buffer.
                    // If it's larger than that, we'll do it incrementally. We want to avoid OOMing.
                    let last_4_bytes: u32 = u32::from_ne_bytes(
                        tgz_bytes[tgz_bytes.len() - 4..][..4]
                            .try_into()
                            .expect("infallible: size matches"),
                    );
                    if last_4_bytes > 16 && last_4_bytes < 64 * 1024 * 1024 {
                        // It's okay if this fails. We will just allocate as we go and that will error if we run out of memory.
                        esimated_output_size = last_4_bytes as usize;
                        if zlib_pool.list.capacity() == 0 {
                            let _ = zlib_pool.list.try_reserve_exact(last_4_bytes as usize);
                        } else {
                            let _ = zlib_pool.ensure_unused_capacity(last_4_bytes as usize);
                        }
                    }
                }
            }

            let mut needs_to_decompress = true;
            if bun_core::FeatureFlags::is_libdeflate_enabled()
                && zlib_pool.list.capacity() > 16
                && esimated_output_size > 0
            {
                'use_libdeflate: {
                    use bun_libdeflate_sys::libdeflate;
                    let decompressor_ptr = libdeflate::Decompressor::alloc();
                    if decompressor_ptr.is_null() {
                        break 'use_libdeflate;
                    }
                    // `defer decompressor.deinit()` — RAII guard frees on scope exit.
                    let _guard = scopeguard::guard(decompressor_ptr, |p| {
                        // SAFETY: `p` was returned by libdeflate_alloc_decompressor and is
                        // not used after this guard fires.
                        unsafe { libdeflate::Decompressor::destroy(p) }
                    });
                    // SAFETY: alloc returned non-null; valid until destroy.
                    let decompressor = unsafe { &mut *decompressor_ptr };

                    zlib_pool.list.clear();
                    let result = decompressor.decompress_to_vec(
                        tgz_bytes,
                        &mut zlib_pool.list,
                        libdeflate::Encoding::Gzip,
                    );
                    if result.status == libdeflate::Status::Success {
                        needs_to_decompress = false;
                    }

                    // If libdeflate fails for any reason, fallback to zlib.
                }
            }

            if needs_to_decompress {
                zlib_pool.list.clear();
                let mut zlib_entry =
                    Zlib::ZlibReaderArrayList::init(tgz_bytes, &mut zlib_pool.list)?;
                if let Err(err) = zlib_entry.read_all(true) {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "{} decompressing \"{}\" to \"{}\"",
                            err,
                            bun_fmt::s(name),
                            bun_core::fmt::fmt_path_u8(tmpname.as_bytes(), Default::default()),
                        ),
                    );
                    return Err(bun_core::err!("InstallFailed"));
                }
            }

            if PackageManager::verbose_install() {
                let decompressing_ended_at: u64 = bun_core::Timespec::now_allow_mocked_time().ns();
                let elapsed = decompressing_ended_at - time_started_for_verbose_logs;
                Output::pretty_errorln(format_args!(
                    "[{}] Extract {}<r> (decompressed {} tgz file in {})",
                    bun_fmt::s(name),
                    bun_fmt::s(tmpname.as_bytes()),
                    bun_core::fmt::size(tgz_bytes.len(), Default::default()),
                    bun_core::fmt::fmt_duration_one_decimal(elapsed),
                ));
            }

            match self.resolution.tag {
                ResolutionTag::Github => {
                    // BORROW_PARAM: out-param writing the first dirname back into a stack local.
                    struct DirnameReader<'a> {
                        needs_first_dirname: bool, // = true
                        outdirname: &'a mut &'static [u8],
                    }
                    impl<'a> ArchiveAppender for DirnameReader<'a> {
                        const HAS_ON_FIRST_DIRECTORY_NAME: bool = true;
                        fn needs_first_dirname(&self) -> bool {
                            self.needs_first_dirname
                        }
                        fn on_first_directory_name(&mut self, first_dirname: &[u8]) {
                            debug_assert!(self.needs_first_dirname);
                            self.needs_first_dirname = false;
                            *self.outdirname = FileSystem::instance()
                                .dirname_store()
                                .append(first_dirname)
                                .expect("unreachable");
                        }
                    }
                    let mut dirname_reader = DirnameReader {
                        needs_first_dirname: true,
                        outdirname: &mut resolved,
                    };

                    // PERF(port): was comptime bool dispatch on verbose_install — folded into
                    // `ExtractOptions::log` (runtime) — profile in Phase B.
                    let _ = Archiver::extract_to_dir(
                        &zlib_pool.list,
                        extract_destination.fd(),
                        None,
                        &mut dirname_reader,
                        ExtractOptions {
                            // for GitHub tarballs, the root dir is always <user>-<repo>-<commit_id>
                            depth_to_skip: 1,
                            log: PackageManager::verbose_install(),
                            ..Default::default()
                        },
                    )?;

                    // This tag is used to know which version of the package was
                    // installed from GitHub. package.json version becomes sort of
                    // meaningless in cases like this.
                    if !resolved.is_empty() {
                        // `std.fs.Dir.createFileZ(".bun-tag", .{ .truncate = true })` + write
                        if sys::File::write_file(
                            extract_destination.fd(),
                            ZStr::from_static(b".bun-tag\0"),
                            resolved,
                        )
                        .is_err()
                        {
                            let _ = sys::unlinkat(
                                extract_destination.fd(),
                                ZStr::from_static(b".bun-tag\0"),
                            );
                        }
                    }
                }
                _ => {
                    // PERF(port): was comptime bool dispatch on verbose_install — folded into
                    // `ExtractOptions::log` (runtime) — profile in Phase B.
                    let _ = Archiver::extract_to_dir(
                        &zlib_pool.list,
                        extract_destination.fd(),
                        None,
                        &mut (),
                        ExtractOptions {
                            // packages usually have root directory `package/`, and scoped packages usually have root `<scopename>/`
                            // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L442
                            depth_to_skip: 1,
                            npm: true,
                            log: PackageManager::verbose_install(),
                            ..Default::default()
                        },
                    )?;
                }
            }

            if PackageManager::verbose_install() {
                let elapsed = bun_core::Timespec::now_allow_mocked_time().ns()
                    - time_started_for_verbose_logs;
                Output::pretty_errorln(format_args!(
                    "[{}] Extracted to {} ({})<r>",
                    bun_fmt::s(name),
                    bun_fmt::s(tmpname.as_bytes()),
                    bun_core::fmt::fmt_duration_one_decimal(elapsed),
                ));
                Output::flush();
            }
        }

        self.move_to_cache_directory(log, tmpname, name, basename, resolved)
    }

    /// Rename the freshly-extracted temp directory into the cache, read
    /// `package.json` if required, and build the `ExtractData` result. Shared
    /// between the buffered and streaming extraction paths.
    pub fn move_to_cache_directory(
        &self,
        log: &mut bun_ast::Log,
        tmpname: &ZStr,
        name: &[u8],
        basename: &[u8],
        resolved: &[u8],
    ) -> Result<ExtractData, Error> {
        let package_manager = self.package_manager.get();

        let tmpdir = self.temp_dir;
        TL_BUFS.with_borrow_mut(|bufs| {
            // PORT NOTE: reshaped for borrowck — Zig grabbed a raw `*TlBufs` from TLS;
            // here the entire body lives inside the thread_local borrow closure.
            let folder_name: &[u8] = match self.resolution.tag {
                ResolutionTag::Npm => directories::cached_npm_package_folder_name_print(
                    package_manager,
                    &mut bufs.folder_name_buf,
                    name,
                    self.resolution.npm().version,
                    None,
                )
                .as_bytes(),
                ResolutionTag::Github => directories::cached_github_folder_name_print(
                    &mut bufs.folder_name_buf,
                    resolved,
                    None,
                )
                .as_bytes(),
                ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                    directories::cached_tarball_folder_name_print(
                        &mut bufs.folder_name_buf,
                        self.url.slice(),
                        None,
                    )
                    .as_bytes()
                }
                _ => unreachable!(),
            };
            if folder_name.is_empty() || (folder_name.len() == 1 && folder_name[0] == b'/') {
                panic!("Tried to delete root and stopped it");
            }
            let cache_dir = self.cache_dir;

            // e.g. @next
            // if it's a namespace package, we need to make sure the @name folder exists
            let create_subdir = basename.len() != name.len() && !self.resolution.tag.is_git();

            // Now that we've extracted the archive, we rename.
            #[cfg(windows)]
            {
                let mut did_retry = false;
                let mut path2_buf = WPathBuffer::uninit();
                let path2 = strings::to_wpath_normalized(&mut path2_buf, folder_name);
                if create_subdir {
                    if let Some(folder) = bun_paths::Dirname::dirname_u16(path2) {
                        let _ = bun_sys::make_path::make_path_u16(cache_dir, folder);
                    }
                }

                let path_to_use = path2;

                loop {
                    let dir_to_move = match sys::open_dir_at_windows_a(
                        self.temp_dir.fd(),
                        tmpname.as_bytes(),
                        sys::WindowsOpenDirOptions {
                            can_rename_or_delete: true,
                            iterable: false,
                            read_only: true,
                            ..Default::default()
                        },
                    ) {
                        Ok(d) => d,
                        Err(err) => {
                            // i guess we just
                            log.add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "moving \"{}\" to cache dir failed\n{}\n From: {}\n   To: {}",
                                    bun_fmt::s(name),
                                    err,
                                    bun_fmt::s(tmpname.as_bytes()),
                                    bun_fmt::s(folder_name),
                                ),
                            );
                            return Err(bun_core::err!("InstallFailed"));
                        }
                    };

                    match bun_sys::windows::move_opened_file_at(
                        dir_to_move,
                        Fd::from_std_dir(&cache_dir),
                        path_to_use,
                        true,
                    ) {
                        bun_sys::Result::Err(err) => {
                            if !did_retry {
                                match err.get_errno() {
                                    sys::Errno::NOTEMPTY
                                    | sys::Errno::PERM
                                    | sys::Errno::BUSY
                                    | sys::Errno::EXIST => {
                                        // before we attempt to delete the destination, let's close the source dir.
                                        let _ = sys::close(dir_to_move);

                                        // We tried to move the folder over
                                        // but it didn't work!
                                        // so instead of just simply deleting the folder
                                        // we rename it back into the temp dir
                                        // and then delete that temp dir
                                        // The goal is to make it more difficult for an application to reach this folder
                                        let mut tempdest_buf = PathBuffer::uninit();
                                        tempdest_buf[0..tmpname.len()]
                                            .copy_from_slice(tmpname.as_bytes());
                                        tempdest_buf[tmpname.len()..][0..4]
                                            .copy_from_slice(&[b't', b'm', b'p', 0]);
                                        let tempdest =
                                            ZStr::from_buf(&tempdest_buf, tmpname.len() + 3);
                                        let mut folder_name_z_buf = PathBuffer::uninit();
                                        folder_name_z_buf[0..folder_name.len()]
                                            .copy_from_slice(folder_name);
                                        folder_name_z_buf[folder_name.len()] = 0;
                                        let folder_name_z =
                                            ZStr::from_buf(&folder_name_z_buf, folder_name.len());
                                        match sys::renameat(
                                            Fd::from_std_dir(&cache_dir),
                                            folder_name_z,
                                            Fd::from_std_dir(&tmpdir),
                                            tempdest,
                                        ) {
                                            bun_sys::Result::Err(_) => {}
                                            bun_sys::Result::Ok(_) => {
                                                let _ = tmpdir.delete_tree(tempdest.as_bytes());
                                            }
                                        }
                                        did_retry = true;
                                        continue;
                                    }
                                    _ => {}
                                }
                            }
                            let _ = sys::close(dir_to_move);
                            log.add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "moving \"{}\" to cache dir failed\n{}\n  From: {}\n    To: {}",
                                    bun_fmt::s(name),
                                    err,
                                    bun_fmt::s(tmpname.as_bytes()),
                                    bun_fmt::s(folder_name),
                                ),
                            );
                            return Err(bun_core::err!("InstallFailed"));
                        }
                        bun_sys::Result::Ok(_) => {
                            let _ = sys::close(dir_to_move);
                        }
                    }

                    break;
                }
            }
            #[cfg(not(windows))]
            {
                // Attempt to gracefully handle duplicate concurrent `bun install` calls
                //
                // By:
                // 1. Rename from temporary directory to cache directory and fail if it already exists
                // 2a. If the rename fails, swap the cache directory with the temporary directory version
                // 2b. Delete the temporary directory version ONLY if we're not using a provided temporary directory
                // 3. If rename still fails, fallback to racily deleting the cache directory version and then renaming the temporary directory version again.
                //

                if create_subdir {
                    if let Some(folder) = bun_paths::Dirname::dirname(folder_name) {
                        let _ = bun_sys::make_path::make_path(cache_dir, folder);
                    }
                }

                if let Err(err) = sys::renameat_concurrently_a(
                    tmpdir.fd(),
                    tmpname.as_bytes(),
                    cache_dir.fd(),
                    folder_name,
                    sys::RenameatConcurrentlyOptions {
                        move_fallback: true,
                    },
                ) {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "moving \"{}\" to cache dir failed: {}\n  From: {}\n    To: {}",
                            bun_fmt::s(name),
                            err,
                            bun_fmt::s(tmpname.as_bytes()),
                            bun_fmt::s(folder_name),
                        ),
                    );
                    return Err(bun_core::err!("InstallFailed"));
                }
            }

            // We return a resolved absolute absolute file path to the cache dir.
            // To get that directory, we open the directory again.
            let final_dir = match bun_sys::open_dir(cache_dir, folder_name) {
                Ok(d) => d,
                Err(err) => {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "failed to verify cache dir for \"{}\": {}",
                            bun_fmt::s(name),
                            err.name(),
                        ),
                    );
                    return Err(bun_core::err!("InstallFailed"));
                }
            };
            // `defer final_dir.close()` — bun_sys::Dir is Copy with NO Drop impl; close
            // explicitly via scopeguard so all subsequent early returns release the fd.
            let _close_final_dir = scopeguard::guard(final_dir, |d| d.close());
            // and get the fd path
            let final_path = match sys::get_fd_path_z(final_dir.fd(), &mut bufs.final_path_buf) {
                Ok(p) => p,
                Err(err) => {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "failed to resolve cache dir for \"{}\": {}",
                            bun_fmt::s(name),
                            bun_fmt::s(err.name()),
                        ),
                    );
                    return Err(bun_core::err!("InstallFailed"));
                }
            };

            let url = FileSystem::instance()
                .dirname_store()
                .append(self.url.slice())?;

            let mut json_path: &[u8] = b"";
            let mut json_buf: Vec<u8> = Vec::new();
            let needs_json = match self.resolution.tag {
                // TODO remove extracted files not matching any globs under "files"
                ResolutionTag::Github
                | ResolutionTag::LocalTarball
                | ResolutionTag::RemoteTarball => true,
                _ => {
                    package_manager.lockfile.trusted_dependencies.is_some()
                        && package_manager
                            .lockfile
                            .trusted_dependencies
                            .as_ref()
                            .unwrap()
                            .contains(&(Semver::semver_string::Builder::string_hash(name) as u32))
                }
            };
            if needs_json {
                let read_result = sys::File::read_file_from(
                    cache_dir.fd(),
                    path::resolve_path::join_z_buf::<path::platform::Auto>(
                        &mut bufs.json_path_buf.0,
                        &[folder_name, b"package.json"],
                    )
                    .as_bytes(),
                );
                let (json_file, buf) = match read_result {
                    Ok(pair) => pair,
                    Err(err) => {
                        if self.resolution.tag == ResolutionTag::Github
                            && err == bun_core::err!("ENOENT")
                        {
                            // allow git dependencies without package.json
                            return Ok(ExtractData {
                                url: url.into(),
                                resolved: resolved.into(),
                                ..Default::default()
                            });
                        }

                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "\"package.json\" for \"{}\" failed to open: {}",
                                bun_fmt::s(name),
                                err.name(),
                            ),
                        );
                        return Err(bun_core::err!("InstallFailed"));
                    }
                };
                json_buf = buf;
                // `defer json_file.close()` → close after resolving path.
                json_path = match json_file.get_path(&mut bufs.json_path_buf) {
                    Ok(p) => p,
                    Err(err) => {
                        let _ = json_file.close();
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "\"package.json\" for \"{}\" failed to resolve: {}",
                                bun_fmt::s(name),
                                err.name(),
                            ),
                        );
                        return Err(bun_core::err!("InstallFailed"));
                    }
                };
                let _ = json_file.close();
            }

            if !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX
                .get()
                .unwrap_or(false)
            {
                // create an index storing each version of a package installed
                if strings::index_of_char(basename, b'/').is_none() {
                    'create_index: {
                        let dest_name: &[u8] = match self.resolution.tag {
                            ResolutionTag::Github => &folder_name[b"@GH@".len()..],
                            // trim "name@" from the prefix
                            ResolutionTag::Npm => &folder_name[name.len() + 1..],
                            _ => folder_name,
                        };

                        #[cfg(windows)]
                        {
                            if bun_sys::make_path::make_path(cache_dir, name).is_err() {
                                break 'create_index;
                            }

                            let mut dest_buf = PathBuffer::uninit();
                            let dest_path = path::resolve_path::join_abs_string_buf_z::<
                                path::platform::Windows,
                            >(
                                // only set once, should be fine to read not on main thread
                                package_manager.cache_directory_path.as_bytes(),
                                &mut dest_buf,
                                &[name, dest_name],
                            );

                            if sys::sys_uv::symlink_uv(
                                final_path,
                                dest_path,
                                bun_sys::windows::libuv::UV_FS_SYMLINK_JUNCTION,
                            )
                            .is_err()
                            {
                                break 'create_index;
                            }
                        }
                        #[cfg(not(windows))]
                        {
                            let Ok(index_dir_std) = bun_sys::make_path::make_open_path(
                                cache_dir,
                                name,
                                Default::default(),
                            ) else {
                                break 'create_index;
                            };
                            let index_dir = index_dir_std.fd();
                            // `defer index_dir.close()` → close explicitly after symlinkat.

                            let mut dest_buf = PathBuffer::uninit();
                            dest_buf[..dest_name.len()].copy_from_slice(dest_name);
                            dest_buf[dest_name.len()] = 0;
                            let dest_z = ZStr::from_buf(&dest_buf, dest_name.len());
                            let _ = sys::symlinkat(final_path, index_dir, dest_z);
                            let _ = sys::close(index_dir);
                        }
                    }
                }
            }

            let ret_json_path = FileSystem::instance().dirname_store().append(json_path)?;

            Ok(ExtractData {
                url: url.into(),
                resolved: resolved.into(),
                json: Some(Install::ExtractDataJson {
                    path: ret_json_path.into(),
                    buf: json_buf,
                }),
                ..Default::default()
            })
        })
    }
}

// ported from: src/install/extract_tarball.zig

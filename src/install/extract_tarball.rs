use core::cell::RefCell;
use core::fmt;

use bun_core::fmt::s;
use bun_core::{Output, fmt as bun_fmt};
use bun_core::{StringOrTinyString, ZStr};
use bun_paths::strings;
use bun_paths::{self as path, PathBuffer};
use bun_semver::Version;
use bun_sys::{self as sys, Dir, Fd};

use bun_archive::{ArchiveAppender, ExtractOptions};
use bun_install::install::{self as Install, DependencyID, ExtractData};
use bun_install::integrity::Integrity;
use bun_install::npm::{self as Npm};
use bun_install::package_manager_real::PackageManager;
use bun_install::package_manager_real::directories;
use bun_install::resolution::{Resolution, Tag as ResolutionTag};
use bun_resolver::fs::FileSystem;

use crate::cache_publish::{self, StagedEntry};
type Error = crate::Error;

pub struct ExtractTarball {
    pub(crate) name: StringOrTinyString,
    pub(crate) resolution: Resolution,
    /// Borrowed view of `PackageManager`'s cache directory fd; the manager
    /// owns and closes it, so this stays a non-owning raw `Fd`.
    pub(crate) cache_dir: Fd,
    /// Borrowed view of `PackageManager`'s temp directory fd (same ownership
    /// story as `cache_dir`).
    pub(crate) temp_dir: Fd,
    pub(crate) dependency_id: DependencyID,
    /// The value of `PackageManager::skips_verify`, which the cache lookup also uses.
    pub(crate) skip_verify: bool, // = false
    pub(crate) in_trusted_dependencies: bool,
    pub(crate) integrity: Integrity, // = Integrity::default()
    /// This run can't pin the dependency (see `pins_tarballs`), so the cache entry is named after
    /// `url`.
    pub(crate) stays_unpinned: bool,
    pub(crate) url: StringOrTinyString,
    /// The lockfile's bun-tag (`repository.resolved`) for a Github resolution,
    /// copied out because extract workers must not read lockfile buffers. When
    /// set it names the cache folder and `.bun-tag` (cache lookups are keyed by
    /// it); empty on a fresh resolve, which uses the archive's root dir name.
    pub(crate) github_resolved: StringOrTinyString,
    /// BACKREF: PackageManager owns the task pool that owns this struct.
    pub(crate) package_manager: bun_ptr::BackRef<PackageManager>,
}

impl ExtractTarball {
    #[inline]
    pub(crate) fn run(&self, log: &mut bun_ast::Log, bytes: &[u8]) -> Result<ExtractData, Error> {
        if !self.skip_verify && self.integrity.tag.is_supported() {
            if !self.integrity.verify(bytes) {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Integrity check failed for tarball: {}",
                        bun_fmt::for_terminal(bstr::BStr::new(self.name.slice())),
                    ),
                );
                return Err(crate::Error::IntegrityCheckFailed);
            }
        }
        let integrity = self.lockfile_integrity(|| Integrity::for_bytes(bytes));
        let mut result = self.extract(log, bytes, &integrity)?;
        result.integrity = integrity;
        Ok(result)
    }

    /// Determined before extracting, because the cache entry of a `file:` or URL tarball is named
    /// after it.
    pub(crate) fn lockfile_integrity(&self, compute: impl FnOnce() -> Integrity) -> Integrity {
        match self.resolution.tag {
            ResolutionTag::Github | ResolutionTag::RemoteTarball | ResolutionTag::LocalTarball => {
                if self.integrity.tag.is_supported() || self.stays_unpinned {
                    self.integrity
                } else {
                    compute()
                }
            }
            _ => Integrity::default(),
        }
    }
}

pub(crate) fn build_url(
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
        // Format directly into the store's tail; no intermediate `String`.
        |args| FileSystem::get().dirname_store().print(args),
    )
}

/// Generic URL builder; the closure carries its own context.
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
    // Utf8Chunks scan.
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

pub(crate) fn uses_streaming_extraction() -> bool {
    !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL
        .get()
        .unwrap_or(false)
}

impl ExtractTarball {
    /// Derive the display name and a filesystem-safe basename for this
    /// package. Shared by the buffered `extract()` path below and the
    /// streaming extractor in `TarballStream.rs` so both pick identical
    /// temp-dir and cache-folder names.
    pub(crate) fn name_and_basename(&self) -> (&[u8], &[u8]) {
        let name: &[u8] = if !self.name.slice().is_empty() {
            self.name.slice()
        } else {
            // A tarball package from the lockfile whose package.json has no `name`.
            b"unnamed-package"
        };
        let basename: &[u8] = 'brk: {
            let mut tmp = name;
            if strings::has_prefix(tmp, b"https://") || strings::has_prefix(tmp, b"http://") {
                // A URL name is the placeholder `bun add <url>` uses until package.json is read.
                if let Some(i) = strings::index_of_any(tmp, b"?#") {
                    tmp = &tmp[0..i];
                }
                tmp = bun_paths::basename(tmp);
                if strings::ends_with(tmp, b".tgz") {
                    tmp = &tmp[0..tmp.len() - 4];
                } else if strings::ends_with(tmp, b".tar.gz") {
                    tmp = &tmp[0..tmp.len() - 7];
                }
                if !bun_install::dependency::is_safe_install_folder_name(tmp) {
                    tmp = b"package";
                }
                break 'brk tmp;
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

    fn extract(
        &self,
        log: &mut bun_ast::Log,
        tgz_bytes: &[u8],
        integrity: &Integrity,
    ) -> Result<ExtractData, Error> {
        let _tracer = bun_core::perf::trace("ExtractTarball.extract");

        let tmpdir = Dir::borrow(&self.temp_dir);
        // UTF-8 on every platform; the Windows tmpdir path is converted to
        // wide at the `open_dir_at_windows_a` boundary, not here.
        let mut tmpname_buf = bun_paths::path_buffer_pool::get();
        let (name, basename) = self.name_and_basename();
        let truncated_basename = &basename[0..basename.len().min(32)];
        let tmpname_suffix: &[u8] =
            if bun_install::dependency::is_safe_install_folder_name(truncated_basename) {
                truncated_basename
            } else if self.resolution.tag.is_git()
                || self.resolution.tag == ResolutionTag::LocalTarball
            {
                b"package"
            } else {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Refusing to install package with invalid name \"{}\"",
                        bun_fmt::for_terminal(bstr::BStr::new(name)),
                    ),
                );
                return Err(crate::Error::InstallFailed);
            };

        let mut resolved: &'static [u8] = b"";
        let tmpname =
            FileSystem::tmpname(tmpname_suffix, &mut tmpname_buf.0, bun_core::fast_random())?;
        let staging = StagedEntry::new(self.temp_dir, tmpname);
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
                            bun_fmt::s(err.name()),
                            bun_fmt::s(tmpname.as_bytes()),
                            bun_fmt::for_terminal(bstr::BStr::new(name)),
                        ),
                    );
                    return Err(crate::Error::InstallFailed);
                }
            };

            use bun_archive::Archiver;
            let mut zlib_pool = Npm::Registry::BodyPool::get();
            zlib_pool.reset();
            // `defer Npm.Registry.BodyPool.release(zlib_pool)` → PoolGuard's Drop releases.

            let time_started_for_verbose_logs: u64 = if PackageManager::verbose_install() {
                bun_core::Timespec::now_allow_mocked_time().ns()
            } else {
                0
            };

            // `extract_to_dir` gunzips on the fly,
            // so hand it the compressed bytes and never buffer the full tar.
            // Small tarballs still try libdeflate first for speed; the gzip
            // ISIZE trailer (size mod 2^32) is only trusted when small.
            let mut decompressed_in_memory = false;
            if bun_core::FeatureFlags::is_libdeflate_enabled() && tgz_bytes.len() > 16 {
                let isize: u32 = u32::from_le_bytes(
                    tgz_bytes[tgz_bytes.len() - 4..][..4]
                        .try_into()
                        .expect("infallible: size matches"),
                );
                if isize > 16 && isize < 64 * 1024 * 1024 {
                    if zlib_pool.list.capacity() == 0 {
                        let _ = zlib_pool.list.try_reserve_exact(isize as usize);
                    } else {
                        let _ = zlib_pool.ensure_unused_capacity(isize as usize);
                    }
                    if zlib_pool.list.capacity() > 16 {
                        use bun_libdeflate_sys::libdeflate;
                        if let Some(mut decompressor) = libdeflate::OwnedDecompressor::new() {
                            zlib_pool.list.clear();
                            let result = decompressor.decompress_to_vec(
                                tgz_bytes,
                                &mut zlib_pool.list,
                                libdeflate::Encoding::Gzip,
                            );
                            // libdeflate only reads the first gzip member, so a tarball with more
                            // than one member is left to `extract_to_dir`.
                            if result.status == libdeflate::Status::Success
                                && result.read == tgz_bytes.len()
                            {
                                decompressed_in_memory = true;
                            }
                        }
                    }
                }
            }

            let tar_input: &[u8] = if decompressed_in_memory {
                &zlib_pool.list
            } else {
                zlib_pool.list.clear();
                tgz_bytes
            };

            if PackageManager::verbose_install() {
                bun_core::pretty_errorln!(
                    "[{}] Extract {}<r> ({} tgz file)",
                    bun_fmt::for_terminal(bstr::BStr::new(name)),
                    bun_fmt::s(tmpname.as_bytes()),
                    bun_core::fmt::size(tgz_bytes.len(), Default::default()),
                );
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
                            *self.outdirname = FileSystem::get()
                                .dirname_store()
                                .append(first_dirname)
                                .expect("unreachable");
                        }
                    }
                    let mut dirname_reader = DirnameReader {
                        needs_first_dirname: true,
                        outdirname: &mut resolved,
                    };

                    let _ = Archiver::extract_to_dir(
                        tar_input,
                        extract_destination.fd(),
                        None,
                        &mut dirname_reader,
                        ExtractOptions {
                            // for GitHub tarballs, the root dir is always <user>-<repo>-<commit_id>
                            depth_to_skip: 1,
                            log: PackageManager::verbose_install(),
                            skip_symlinks: true,
                            new_destination: true,
                            ..Default::default()
                        },
                    )?;

                    let lockfile_tag = self.github_resolved.slice();
                    if !lockfile_tag.is_empty() {
                        resolved = FileSystem::get()
                            .dirname_store()
                            .append(lockfile_tag)
                            .expect("unreachable");
                    }

                    // This tag is used to know which version of the package was
                    // installed from GitHub. package.json version becomes sort of
                    // meaningless in cases like this.
                    if !resolved.is_empty() {
                        // Create/truncate `.bun-tag`, then write the resolved tag.
                        if sys::File::openat(
                            extract_destination.fd(),
                            ZStr::from_static(b".bun-tag\0"),
                            sys::O::WRONLY
                                | sys::O::CREAT
                                | sys::O::TRUNC
                                | if cfg!(windows) { 0 } else { sys::O::NOFOLLOW },
                            0o664,
                        )
                        .and_then(|f| f.write_all(resolved))
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
                    let _ = Archiver::extract_to_dir(
                        tar_input,
                        extract_destination.fd(),
                        None,
                        &mut (),
                        ExtractOptions {
                            // packages usually have root directory `package/`, and scoped packages usually have root `<scopename>/`
                            // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L442
                            depth_to_skip: 1,
                            npm: true,
                            log: PackageManager::verbose_install(),
                            new_destination: true,
                            ..Default::default()
                        },
                    )?;
                }
            }

            // Explicitly close the temp extraction dir before the rename. On
            // Windows a still-open handle to the source directory can fail
            // `NtSetInformationFile` with EBUSY; spelling out the close keeps
            // the timing visible instead of relying on block-end Drop.
            drop(extract_destination);

            if PackageManager::verbose_install() {
                let elapsed = bun_core::Timespec::now_allow_mocked_time().ns()
                    - time_started_for_verbose_logs;
                bun_core::pretty_errorln!(
                    "[{}] Extracted to {} ({})<r>",
                    bun_fmt::for_terminal(bstr::BStr::new(name)),
                    bun_fmt::s(tmpname.as_bytes()),
                    bun_core::fmt::fmt_duration_one_decimal(elapsed),
                );
                Output::flush();
            }
        }

        self.move_to_cache_directory(log, staging, name, basename, resolved, integrity)
    }

    /// Rename the freshly-extracted temp directory into the cache, read
    /// `package.json` if required, and build the `ExtractData` result. Shared
    /// between the buffered and streaming extraction paths.
    /// `resolved` names a GitHub cache entry, `integrity` a `file:` / URL tarball's.
    pub(crate) fn move_to_cache_directory(
        &self,
        log: &mut bun_ast::Log,
        staging: StagedEntry<'_>,
        name: &[u8],
        basename: &[u8],
        resolved: &[u8],
        integrity: &Integrity,
    ) -> Result<ExtractData, Error> {
        let package_manager = self.package_manager.get();

        let tmpname = staging.name();
        TL_BUFS.with_borrow_mut(|bufs| {
            // The entire body lives inside the thread_local borrow closure.
            let folder_name_z: &ZStr = match self.resolution.tag {
                ResolutionTag::Npm => {
                    if !bun_install::package_installer::alias_is_safe_install_target(name) {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Refusing to install package with invalid name \"{}\"",
                                bun_fmt::for_terminal(bstr::BStr::new(name)),
                            ),
                        );
                        return Err(crate::Error::InstallFailed);
                    }
                    directories::cached_npm_package_folder_name_print(
                        package_manager,
                        &mut bufs.folder_name_buf,
                        name,
                        self.resolution.npm().version,
                        None,
                    )
                }
                ResolutionTag::Github => {
                    if !bun_install::repository::is_safe_resolved_tag(resolved) {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Refusing to install \"{}\": tarball root directory \"{}\" is not a valid folder name",
                                bun_fmt::for_terminal(bstr::BStr::new(name)),
                                bun_fmt::escape_control_chars(resolved),
                            ),
                        );
                        return Err(crate::Error::InstallFailed);
                    }
                    directories::cached_github_folder_name_print(
                        &mut bufs.folder_name_buf,
                        resolved,
                        None,
                    )
                }
                ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                    // A hash computed from these bytes is as good as a checked one.
                    let unchecked = self.skip_verify && self.integrity.tag.is_supported();
                    // `.bun-tag` does not claim a hash that `--no-verify` left unchecked.
                    let tag = if unchecked {
                        Integrity::default()
                    } else {
                        *integrity
                    };
                    // Records which bytes a copy in node_modules came from. See
                    // `PackageInstall::verify`.
                    let tag_path = path::resolve_path::join_z_buf::<path::platform::Auto>(
                        &mut bufs.json_path_buf.0,
                        &[tmpname.as_bytes(), b".bun-tag"],
                    );
                    if sys::File::openat(
                        self.temp_dir,
                        tag_path,
                        sys::O::WRONLY
                            | sys::O::CREAT
                            | sys::O::TRUNC
                            | if cfg!(windows) { 0 } else { sys::O::NOFOLLOW },
                        0o664,
                    )
                    .and_then(|f| f.write_all(tag.sri(&mut [0; Integrity::MAX_SRI_LEN])))
                    .is_err()
                    {
                        let _ = sys::unlinkat(self.temp_dir, tag_path);
                    }
                    directories::cached_tarball_folder_name_print(
                        &mut bufs.folder_name_buf,
                        integrity,
                        unchecked,
                        self.resolution.tag,
                        self.url.slice(),
                        None,
                    )
                }
                _ => unreachable!(),
            };
            let folder_name = folder_name_z.as_bytes();
            let cache_dir = Dir::borrow(&self.cache_dir);

            // e.g. @next
            // if it's a namespace package, we need to make sure the @name folder exists
            if basename.len() != name.len()
                && !self.resolution.tag.is_git()
                && let Some(scope_len) = strings::index_of_char(folder_name, b'/')
            {
                let _ =
                    bun_sys::make_path::make_path(cache_dir, &folder_name[..scope_len as usize]);
            }

            // Read it in the staging folder, so that a package.json that fails the install never
            // becomes a cache hit.
            let needs_json = match self.resolution.tag {
                // TODO remove extracted files not matching any globs under "files"
                ResolutionTag::Github
                | ResolutionTag::LocalTarball
                | ResolutionTag::RemoteTarball => true,
                _ => self.in_trusted_dependencies,
            };
            let mut json_buf: Option<Vec<u8>> = None;
            if needs_json {
                match sys::File::read_from(
                    self.temp_dir,
                    path::resolve_path::join_z_buf::<path::platform::Auto>(
                        &mut bufs.json_path_buf.0,
                        &[tmpname.as_bytes(), b"package.json"],
                    )
                    .as_bytes(),
                ) {
                    Ok(buf) => json_buf = Some(buf),
                    // allow git dependencies without package.json
                    Err(err)
                        if self.resolution.tag == ResolutionTag::Github
                            && err.get_errno() == sys::E::ENOENT => {}
                    Err(err) => {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "\"package.json\" for \"{}\" failed to open: {}",
                                bun_fmt::for_terminal(bstr::BStr::new(name)),
                                bun_fmt::s(err.name()),
                            ),
                        );
                        return Err(crate::Error::InstallFailed);
                    }
                }
            }
            if let Some(buf) = &json_buf {
                crate::initialize_mini_store();
                // Its locations borrow `buf`.
                let mut json_log = bun_ast::Log::init();
                if let Err(err) = crate::bun_json::ParsedJson::parse_package_json(
                    &bun_ast::Source::init_path_string("package.json", &buf[..]),
                    &mut json_log,
                ) {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "expected \"package.json\" of \"{}\" to be a JSON file: {}: {}",
                            bun_fmt::for_terminal(bstr::BStr::new(name)),
                            err.name(),
                            bun_fmt::escape_control_chars(
                                json_log
                                    .msgs
                                    .first()
                                    .map_or(&b"syntax error"[..], |msg| &msg.data.text[..]),
                            ),
                        ),
                    );
                    return Err(crate::Error::InstallFailed);
                }
            }

            // Now that we've extracted the archive, we rename.
            let final_dir = match staging.publish_and_open(self.cache_dir, folder_name_z, &|_| {
                directories::is_package_in_cache_at(
                    self.cache_dir,
                    folder_name_z,
                    self.resolution.tag,
                )
            }) {
                Ok(d) => d,
                Err(err) => {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "moving \"{}\" to cache dir failed: {}\n  From: {}\n    To: {}",
                            bun_fmt::for_terminal(bstr::BStr::new(name)),
                            err,
                            bun_fmt::s(tmpname.as_bytes()),
                            bun_fmt::s(folder_name),
                        ),
                    );
                    return Err(crate::Error::InstallFailed);
                }
            };
            // We return a resolved absolute absolute file path to the cache dir.
            let final_path = match sys::get_fd_path_z(final_dir.fd(), &mut bufs.final_path_buf) {
                Ok(p) => p,
                Err(err) => {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "failed to resolve cache dir for \"{}\": {}",
                            bun_fmt::for_terminal(bstr::BStr::new(name)),
                            bun_fmt::s(err.name()),
                        ),
                    );
                    return Err(crate::Error::InstallFailed);
                }
            };

            let url = FileSystem::get()
                .dirname_store()
                .append(self.url.slice())?;

            if needs_json && json_buf.is_none() {
                return Ok(ExtractData {
                    url: url.into(),
                    resolved: resolved.into(),
                    ..Default::default()
                });
            }
            let json_path: &[u8] = if needs_json {
                path::resolve_path::join_z_buf::<path::platform::Auto>(
                    &mut bufs.json_path_buf.0,
                    &[final_path.as_bytes(), b"package.json"],
                )
                .as_bytes()
            } else {
                b""
            };

            // create an index storing each version of a package installed
            if strings::index_of_char(basename, b'/').is_none()
                && bun_install::dependency::is_safe_install_folder_name(name)
            {
                cache_publish::create_index_link(
                    self.cache_dir,
                    // only set once, should be fine to read not on main thread
                    package_manager.cache_directory_path.as_bytes(),
                    name,
                    match self.resolution.tag {
                        ResolutionTag::Github => &folder_name[b"@GH@".len()..],
                        // trim "name@" from the prefix
                        ResolutionTag::Npm => &folder_name[name.len() + 1..],
                        _ => folder_name,
                    },
                    final_path,
                );
            }

            let ret_json_path = FileSystem::get().dirname_store().append(json_path)?;

            // Lands in `Task.data.*` (untagged `ManuallyDrop` union); freed by
            // `Task::deinit_payload()` at the `runTasks.rs` re-pool site, which
            // calls it before `preallocated_resolve_tasks.put()`.
            Ok(ExtractData {
                url: url.into(),
                resolved: resolved.into(),
                json: Some(Install::ExtractDataJson {
                    path: ret_json_path.into(),
                    buf: json_buf.unwrap_or_default(),
                }),
                ..Default::default()
            })
        })
    }
}

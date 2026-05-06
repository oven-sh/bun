//! Used for `bun build --compile`
//!
//! This downloads and extracts the bun binary for the target platform
//! It uses npm to download the bun binary from the npm registry
//! It stores the downloaded binary into the bun install cache.

use core::fmt;
use std::io::Write as _;

use bun_core::{env_var, fmt as bun_fmt, Environment, Global};
use bun_core::env::{Architecture, OperatingSystem};
use bun_paths::{self as path, PathBuffer};
use bun_semver::{SlicedString, Version};
use bun_string::{strings, MutableString, ZStr};
use bun_sys::Fd;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, Ordering};

/// Cold-path vtable for the synchronous HTTP GET used by
/// `CompileTarget::download_to_path`. Breaks the T3→T5 `bun_http` back-edge
/// (GENUINE per CYCLEBREAK). High tier (`bun_runtime::init`) writes a static
/// instance into `HTTP_SYNC_DOWNLOAD_VTABLE` at startup.
// PERF(port): was inline switch — direct bun_http::AsyncHTTP calls. Cold path
// (cross-compile binary download); the indirect call is fine.
pub struct HttpSyncDownloadVTable {
    /// `bun_http::HTTPThread::init(&Default::default())` — idempotent.
    pub init_thread: unsafe fn(),
    /// Synchronous GET. Writes the body into `out` and returns the HTTP status
    /// code. `progress_node` is an erased `*mut bun_core::progress::Node` (the
    /// callee assigns it to `client.progress_node`).
    pub get_sync: for<'a> unsafe fn(
        url: bun_url::URL<'a>,
        http_proxy: Option<bun_url::URL<'a>>,
        reject_unauthorized: bool,
        progress_node: *mut (), // SAFETY: erased *mut bun_core::Progress::Node
        out: *mut MutableString,
    ) -> Result<u16, bun_core::Error>,
}

/// Registered by `bun_runtime::init()`. Null until then — `download_to_path`
/// debug-asserts non-null.
pub static HTTP_SYNC_DOWNLOAD_VTABLE: AtomicPtr<HttpSyncDownloadVTable> =
    AtomicPtr::new(null_mut());

/// Used for `bun build --compile`
#[derive(Clone, Copy)]
pub struct CompileTarget {
    pub os: OperatingSystem,
    pub arch: Architecture,
    pub baseline: bool,
    pub version: Version,
    pub libc: Libc,
}

impl Default for CompileTarget {
    fn default() -> Self {
        Self {
            os: Environment::OS,
            arch: Environment::ARCH,
            baseline: !Environment::ENABLE_SIMD,
            version: Version {
                major: Environment::VERSION.major as _, // @truncate
                minor: Environment::VERSION.minor as _, // @truncate
                patch: Environment::VERSION.patch as _, // @truncate
                tag: Default::default(),
                _tag_padding: Default::default(),
            },
            libc: if Environment::IS_MUSL {
                Libc::Musl
            } else if Environment::IS_ANDROID {
                Libc::Android
            } else {
                Libc::Default
            },
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Libc {
    /// The default libc for the target
    /// "glibc" for linux, unspecified for other OSes
    Default,
    /// musl libc
    Musl,
    /// bionic (Android)
    Android,
}

impl Libc {
    /// npm package name, `@oven-sh/bun-{os}-{arch}`
    pub fn npm_name(self) -> &'static [u8] {
        match self {
            Libc::Default => b"",
            Libc::Musl => b"-musl",
            Libc::Android => b"-android",
        }
    }
}

impl fmt::Display for Libc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            // SAFETY: npm_name() returns ASCII literals
            unsafe { core::str::from_utf8_unchecked(self.npm_name()) },
        )
    }
}

struct BaselineFormatter {
    baseline: bool,
}

impl fmt::Display for BaselineFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.baseline {
            f.write_str("-baseline")?;
        }
        Ok(())
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum DownloadError {
    #[error("TargetNotFound")]
    TargetNotFound,
    #[error("NetworkError")]
    NetworkError,
    #[error("InvalidResponse")]
    InvalidResponse,
    #[error("ExtractionFailed")]
    ExtractionFailed,
    #[error("InvalidTarget")]
    InvalidTarget,
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("NoSpaceLeft")]
    NoSpaceLeft,
}
// TODO(port): impl From<DownloadError> for bun_core::Error

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ParseError {
    #[error("UnsupportedTarget")]
    UnsupportedTarget,
    #[error("InvalidTarget")]
    InvalidTarget,
}
// TODO(port): impl From<ParseError> for bun_core::Error

impl CompileTarget {
    pub fn eql(&self, other: &CompileTarget) -> bool {
        self.os == other.os
            && self.arch == other.arch
            && self.baseline == other.baseline
            && self.version.eql(other.version)
            && self.libc == other.libc
    }

    pub fn is_default(&self) -> bool {
        self.eql(&CompileTarget::default())
    }

    pub fn to_npm_registry_url<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(url) = env_var::BUN_COMPILE_TARGET_TARBALL_URL.get() {
            if strings::has_prefix(url, b"http://") || strings::has_prefix(url, b"https://") {
                // TODO(port): lifetime — Zig returns the env var slice directly (`return url;`),
                // which is not tied to `buf`. Phase B: change return type to allow returning a
                // non-buf slice (e.g. Cow<'_, [u8]>). For now copy into buf without truncation.
                if url.len() > buf.len() {
                    return Err(bun_core::err!("BufferTooSmall"));
                }
                buf[..url.len()].copy_from_slice(url);
                return Ok(&buf[..url.len()]);
            }
        }

        self.to_npm_registry_url_with_url(buf, b"https://registry.npmjs.org")
    }

    pub fn to_npm_registry_url_with_url<'a>(
        &self,
        buf: &'a mut [u8],
        registry_url: &[u8],
    ) -> Result<&'a [u8], bun_core::Error> {
        // TODO(port): narrow error set
        // Validate the target is supported before building URL
        if !self.is_supported() {
            return Err(bun_core::err!("UnsupportedTarget"));
        }

        // PERF(port): was comptime monomorphization (inline else over os/arch/libc/baseline
        // building a comptime format string) — profile in Phase B. Runtime concat is fine
        // for a one-shot URL build.
        let os = self.os.npm_name();
        let arch = self.arch.npm_name();
        let libc = self.libc.npm_name();
        let baseline: &[u8] = if self.baseline { b"-baseline" } else { b"" };

        let total = buf.len();
        let mut cursor: &mut [u8] = buf;
        // https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-0.1.6.tgz
        let res = (|| -> std::io::Result<()> {
            cursor.write_all(registry_url)?;
            cursor.write_all(b"/@oven/bun-")?;
            cursor.write_all(os)?;
            cursor.write_all(b"-")?;
            cursor.write_all(arch)?;
            cursor.write_all(libc)?;
            cursor.write_all(baseline)?;
            cursor.write_all(b"/-/bun-")?;
            cursor.write_all(os)?;
            cursor.write_all(b"-")?;
            cursor.write_all(arch)?;
            cursor.write_all(libc)?;
            cursor.write_all(baseline)?;
            write!(
                cursor,
                "-{}.{}.{}.tgz",
                self.version.major, self.version.minor, self.version.patch,
            )?;
            Ok(())
        })();

        match res {
            Ok(()) => {
                let remaining = cursor.len();
                // PORT NOTE: reshaped for borrowck — re-slice via raw len arithmetic
                let written = total - remaining;
                // SAFETY: cursor is a suffix of buf; written = total - remaining is in-bounds
                Ok(unsafe { core::slice::from_raw_parts(buf.as_ptr(), written) })
            }
            Err(e) => {
                // Catch buffer overflow or other formatting errors
                if e.kind() == std::io::ErrorKind::WriteZero {
                    return Err(bun_core::err!("BufferTooSmall"));
                }
                Err(bun_core::err!("NoSpaceLeft"))
            }
        }
    }

    pub fn exe_path<'a>(
        &self,
        buf: &'a mut PathBuffer,
        version_str: &'a ZStr,
        _env: &mut bun_dotenv::Loader<'_>,
        needs_download: &mut bool,
    ) -> &'a ZStr {
        if self.is_default() {
            'brk: {
                let Ok(self_exe_path) = bun_core::self_exe_path() else {
                    break 'brk;
                };
                buf[..self_exe_path.len()].copy_from_slice(self_exe_path.as_bytes());
                buf[self_exe_path.len()] = 0;
                *needs_download = false;
                // SAFETY: buf[self_exe_path.len()] == 0 written above
                return unsafe { ZStr::from_raw(buf.as_ptr(), self_exe_path.len()) };
            }
        }

        if bun_sys::exists_at(Fd::cwd(), version_str) {
            *needs_download = false;
            return version_str;
        }

        // MOVE_DOWN(b0): bun.install.PackageManager.fetchCacheDirectoryPath → bun_sys
        // T1 fallback ignores `_env` (full env-override chain lives in bun_install).
        let cache_dir = bun_sys::fetch_cache_directory_path();
        let dest = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
            path::fs::FileSystem::instance().top_level_dir(),
            &mut buf[..],
            &[
                cache_dir.as_slice(),
                version_str.as_bytes(),
            ],
        );

        if bun_sys::exists_at(Fd::cwd(), dest) {
            *needs_download = false;
        }

        dest
    }

    pub fn download_to_path(
        &self,
        env: &mut bun_dotenv::Loader,
        dest_z: &ZStr,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // GENUINE(b0): bun_http::{HTTPThread, AsyncHTTP} routed through
        // HttpSyncDownloadVTable (cold-path manual vtable). High tier supplies
        // the impl; see HTTP_SYNC_DOWNLOAD_VTABLE.
        let http_vt = HTTP_SYNC_DOWNLOAD_VTABLE.load(Ordering::Acquire);
        debug_assert!(
            !http_vt.is_null(),
            "HTTP_SYNC_DOWNLOAD_VTABLE not registered by bun_runtime::init()"
        );
        // SAFETY: registered once at startup, &'static thereafter.
        let http_vt: &HttpSyncDownloadVTable = unsafe { &*http_vt };
        unsafe { (http_vt.init_thread)() };
        let mut refresher = bun_core::Progress::Progress::default();

        {
            refresher.refresh();

            // TODO: This is way too much code necessary to send a single HTTP request...
            let mut compressed_archive_bytes =
                Box::new(MutableString::init(24 * 1024 * 1024)?);
            let mut url_buffer = [0u8; 2048];
            let url_str = match self.to_npm_registry_url(&mut url_buffer) {
                Ok(s) => s,
                Err(err) => {
                    // Return error without printing - let caller decide how to handle
                    return Err(err);
                }
            };
            let url_str_copy: Box<[u8]> = Box::from(url_str);
            let url = bun_url::URL::parse(&url_str_copy);
            {
                // TODO(port): errdefer progress.end() — `start` returns `&mut Node`
                // borrowing `refresher`, so a scopeguard capturing it would alias.
                // Phase B: reshape with a guard that re-borrows on drop.
                // PORT NOTE: reshaped for borrowck — `get_http_proxy_for` borrows
                // `env` for the proxy URL lifetime; read the bool first.
                let reject_unauthorized = env.get_tls_reject_unauthorized();
                let http_proxy: Option<bun_url::URL> = env.get_http_proxy_for(&url);
                let progress = refresher.start(b"Downloading", 0);

                let status_code = unsafe {
                    (http_vt.get_sync)(
                        url,
                        http_proxy,
                        reject_unauthorized,
                        progress as *mut bun_core::Progress::Node as *mut (),
                        &mut *compressed_archive_bytes as *mut _,
                    )
                };
                progress.end();
                let status_code = status_code?;

                match status_code {
                    404 => {
                        // Return error without printing - let caller handle the messaging
                        return Err(bun_core::err!("TargetNotFound"));
                    }
                    403 | 429 | 499..=599 => {
                        // Return error without printing - let caller handle the messaging
                        return Err(bun_core::err!("NetworkError"));
                    }
                    200 => {}
                    _ => return Err(bun_core::err!("NetworkError")),
                }
            }

            let mut tarball_bytes: Vec<u8> = Vec::new();
            {
                refresher.refresh();
                // defer compressed_archive_bytes.list.deinit(allocator) — handled by Drop

                if compressed_archive_bytes.list.is_empty() {
                    // Return error without printing - let caller handle the messaging
                    return Err(bun_core::err!("InvalidResponse"));
                }

                {
                    // PORT NOTE: reshaped for borrowck — `refresher.start` borrows
                    // `refresher` mutably; do gunzip work first, drive progress around it.
                    refresher.start(b"Decompressing", 0);
                    let gunzip_result = (|| -> Result<(), bun_core::Error> {
                        let mut gunzip = bun_zlib::ZlibReaderArrayList::init(
                            compressed_archive_bytes.list.as_slice(),
                            &mut tarball_bytes,
                        )
                        .map_err(|_| bun_core::err!("InvalidResponse"))?;
                        gunzip
                            .read_all(true)
                            .map_err(|_| bun_core::err!("InvalidResponse"))?;
                        Ok(())
                    })();
                    refresher.root.end();
                    if let Err(e) = gunzip_result {
                        // Return error without printing - let caller handle the messaging
                        return Err(e);
                    }
                }
                refresher.refresh();

                {
                    refresher.start(b"Extracting", 0);
                    // defer node.end() — see explicit calls below

                    // Inlined `bun.fs.FileSystem.tmpname` (lives in bun_resolver,
                    // which is a higher tier — would form a cycle). Produces
                    // `.{hex(hash|nano)}-{hex(counter)}.tmp\0`.
                    let mut tmpname_buf = [0u8; 1024];
                    let tempdir_name: &ZStr = {
                        use core::sync::atomic::AtomicU32;
                        static TMPNAME_ID: AtomicU32 = AtomicU32::new(0);
                        let hash = bun_core::fast_random();
                        let hex_value: u64 = (u128::from(hash)
                            | u128::try_from(bun_core::time::nano_timestamp()).unwrap_or(0))
                            as u64;
                        let mut cursor = std::io::Cursor::new(&mut tmpname_buf[..]);
                        write!(
                            &mut cursor,
                            ".{:x}-{:X}.tmp",
                            hex_value,
                            TMPNAME_ID.fetch_add(1, Ordering::Relaxed),
                        )
                        .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
                        let written = cursor.position() as usize;
                        tmpname_buf[written] = 0;
                        // SAFETY: tmpname_buf[written] == 0 written above
                        unsafe { ZStr::from_raw(tmpname_buf.as_ptr(), written) }
                    };
                    let tmpdir = bun_sys::Dir::cwd()
                        .make_open_path(tempdir_name.as_bytes(), Default::default())?;
                    let _cleanup = scopeguard::guard((), |_| {
                        let _ = bun_sys::Dir::cwd().delete_tree(tempdir_name.as_bytes());
                    });
                    let extract_res = bun_libarchive::Archiver::extract_to_dir(
                        tarball_bytes.as_slice(),
                        tmpdir.fd(),
                        None,
                        &mut (),
                        bun_libarchive::ExtractOptions {
                            // "package/bin"
                            depth_to_skip: 2,
                            ..Default::default()
                        },
                    );
                    if extract_res.is_err() {
                        refresher.root.end();
                        // Return error without printing - let caller handle the messaging
                        return Err(bun_core::err!("ExtractionFailed"));
                    }

                    let mut did_retry = false;
                    loop {
                        let src_name: &ZStr = if self.os == OperatingSystem::Windows {
                            bun_core::zstr!("bun.exe")
                        } else {
                            bun_core::zstr!("bun")
                        };
                        let mv = bun_sys::move_file_z(
                            tmpdir.fd(),
                            src_name,
                            Fd::INVALID,
                            dest_z,
                        );
                        if mv.is_err() {
                            if !did_retry {
                                did_retry = true;
                                let dirname = path::dirname_simple(dest_z.as_bytes());
                                if !dirname.is_empty() {
                                    let _ = bun_sys::Dir::cwd().make_path(dirname);
                                    continue;
                                }

                                // fallthrough, failed for another reason
                            }
                            refresher.root.end();
                            // Return error without printing - let caller handle the messaging
                            return Err(bun_core::err!("ExtractionFailed"));
                        }
                        break;
                    }
                    tmpdir.close();
                    refresher.root.end();
                }
                refresher.refresh();
            }
        }
        Ok(())
    }

    pub fn is_supported(&self) -> bool {
        match self.os {
            OperatingSystem::Windows => {
                self.arch == Architecture::X64 || self.arch == Architecture::Arm64
            }

            OperatingSystem::Mac => true,
            OperatingSystem::Linux => true,
            OperatingSystem::Freebsd => true,

            OperatingSystem::Wasm => false,
        }
    }

    pub fn try_from(input_: &[u8]) -> Result<CompileTarget, ParseError> {
        let mut this = CompileTarget::default();
        let input = strings::trim(input_, b" \t\r");
        if input.is_empty() {
            return Ok(this);
        }

        let mut found_os = false;
        let mut found_arch = false;
        let mut _found_baseline = false;
        let mut _found_version = false;
        let mut found_libc = false;

        // Parse each of the supported values.
        // The user shouldn't have to care about the order of the values. As long as it starts with "bun-".
        // Nobody wants to remember whether its "bun-linux-x64" or "bun-x64-linux".
        let mut splitter = strings::split(input, b"-");
        while !input.is_empty() {
            let Some(token) = splitter.next() else { break };
            if token.is_empty() {
                continue;
            }

            if let Some(arch) = Architecture::NAMES.get(token) {
                this.arch = *arch;
                found_arch = true;
                continue;
            } else if let Some(os) = OperatingSystem::NAMES.get(token) {
                this.os = *os;
                found_os = true;
                continue;
            } else if token == b"modern" {
                this.baseline = false;
                _found_baseline = true;
                continue;
            } else if token == b"baseline" {
                this.baseline = true;
                _found_baseline = true;
                continue;
            } else if strings::has_prefix(token, b"v1.") || strings::has_prefix(token, b"v0.") {
                let version = Version::parse(SlicedString::init(&token[1..], &token[1..]));
                if version.valid {
                    if version.version.major.is_none()
                        || version.version.minor.is_none()
                        || version.version.patch.is_none()
                    {
                        return Err(ParseError::InvalidTarget);
                    }

                    this.version = Version {
                        major: version.version.major.unwrap(),
                        minor: version.version.minor.unwrap(),
                        patch: version.version.patch.unwrap(),
                        tag: Default::default(),
                        _tag_padding: Default::default(),
                    };
                    _found_version = true;
                    continue;
                }
            } else if token == b"musl" {
                this.libc = Libc::Musl;
                found_libc = true;
                continue;
            } else if token == b"android" {
                this.libc = Libc::Android;
                found_libc = true;
                continue;
            } else {
                return Err(ParseError::UnsupportedTarget);
            }
        }

        if !found_libc && this.libc != Libc::Default && this.os != OperatingSystem::Linux {
            // "bun-windows-x64" should not implicitly be "bun-windows-x64-musl"
            this.libc = Libc::Default;
        }

        if found_os && !found_arch {
            // default to x64 if no arch is specified but OS is specified
            // On macOS arm64, it's kind of surprising to choose Linux arm64 or Windows arm64
            this.arch = Architecture::X64;
            found_arch = true;
            let _ = found_arch;
        }

        // there is no baseline arm64.
        if this.baseline && this.arch == Architecture::Arm64 {
            this.baseline = false;
        }

        if this.libc != Libc::Default && this.os != OperatingSystem::Linux {
            return Err(ParseError::InvalidTarget);
        }

        if this.arch == Architecture::Wasm || this.os == OperatingSystem::Wasm {
            return Err(ParseError::InvalidTarget);
        }

        Ok(this)
    }

    pub fn from(input_: &[u8]) -> CompileTarget {
        match Self::try_from(input_) {
            Ok(t) => t,
            Err(ParseError::UnsupportedTarget) => {
                let input = strings::trim(input_, b" \t\r");
                let mut splitter = strings::split(input, b"-");
                let mut unsupported_token: Option<&[u8]> = None;
                while let Some(token) = splitter.next() {
                    if token.is_empty() {
                        continue;
                    }
                    if Architecture::NAMES.get(token).is_none()
                        && OperatingSystem::NAMES.get(token).is_none()
                        && token != b"modern"
                        && token != b"baseline"
                        && token != b"musl"
                        && token != b"android"
                        && !(strings::has_prefix(token, b"v1.")
                            || strings::has_prefix(token, b"v0."))
                    {
                        unsupported_token = Some(token);
                        break;
                    }
                }

                if let Some(token) = unsupported_token {
                    bun_core::err_generic!(
                        "Unsupported target {} in \"bun{}\"\n\
                         To see the supported targets:\n  \
                         https://bun.com/docs/bundler/executables",
                        bun_fmt::quote(token),
                        bstr::BStr::new(input_),
                    );
                } else {
                    bun_core::err_generic!(
                        "Unsupported target: {}",
                        bstr::BStr::new(input_)
                    );
                }
                Global::exit(1);
            }
            Err(ParseError::InvalidTarget) => {
                let input = strings::trim(input_, b" \t\r");
                if strings::contains(input, b"musl") && !strings::contains(input, b"linux") {
                    bun_core::err_generic!(
                        "invalid target, musl libc only exists on linux"
                    );
                } else if strings::contains(input, b"android") && !strings::contains(input, b"linux")
                {
                    bun_core::err_generic!(
                        "invalid target, android only exists with linux (use bun-linux-arm64-android)"
                    );
                } else if strings::contains(input, b"wasm") {
                    bun_core::err_generic!(
                        "invalid target, WebAssembly is not supported. Sorry!"
                    );
                } else if strings::contains(input, b"v") {
                    // PORT NOTE: Zig used a comptime-concat format string with VERSION_STRING.
                    // `format_args!` requires a literal; pass the version as a runtime arg.
                    bun_core::err_generic!(
                        "Please pass a complete version number to --target. For example, --target=bun-v{}",
                        Environment::VERSION_STRING,
                    );
                } else {
                    bun_core::err_generic!(
                        "Invalid target: {}",
                        bstr::BStr::new(input_)
                    );
                }
                Global::exit(1);
            }
        }
    }

    // Exists for consistentcy with values.
    pub fn define_keys(&self) -> &'static [&'static [u8]] {
        &[
            b"process.platform",
            b"process.arch",
            b"process.versions.bun",
        ]
    }

    pub fn define_values(&self) -> &'static [&'static [u8]] {
        // PERF(port): was comptime monomorphization (inline else over os/arch/libc returning
        // anonymous struct const). Phase B: generate static tables via macro_rules! or
        // const_format::concatcp! over OperatingSystem::name_string().
        // TODO(port): this needs a static [&[u8]; 3] per (os, arch, libc) combo — the os
        // string is `"\"" ++ os.nameString() ++ "\""` and the version is
        // `"\"" ++ Global.package_json_version ++ "\""`, both comptime in Zig.
        macro_rules! table {
            ($platform:literal, $arch:literal) => {{
                const VALUES: &[&[u8]] = &[
                    $platform,
                    $arch,
                    const_format::concatcp!("\"", bun_core::Global::package_json_version, "\"")
                        .as_bytes(),
                ];
                VALUES
            }};
        }

        // Use inline else to avoid extra allocations.
        match self.arch {
            Architecture::X64 => match self.libc {
                // process.platform: Node reports "android" on Android, not "linux".
                Libc::Android => table!(b"\"android\"", b"\"x64\""),
                _ => match self.os {
                    OperatingSystem::Mac => table!(b"\"darwin\"", b"\"x64\""),
                    OperatingSystem::Linux => table!(b"\"linux\"", b"\"x64\""),
                    OperatingSystem::Windows => table!(b"\"win32\"", b"\"x64\""),
                    OperatingSystem::Freebsd => table!(b"\"freebsd\"", b"\"x64\""),
                    OperatingSystem::Wasm => table!(b"\"wasm\"", b"\"x64\""),
                    // TODO(port): verify os.nameString() values match these literals
                },
            },
            Architecture::Arm64 => match self.libc {
                Libc::Android => table!(b"\"android\"", b"\"arm64\""),
                _ => match self.os {
                    OperatingSystem::Mac => table!(b"\"darwin\"", b"\"arm64\""),
                    OperatingSystem::Linux => table!(b"\"linux\"", b"\"arm64\""),
                    OperatingSystem::Windows => table!(b"\"win32\"", b"\"arm64\""),
                    OperatingSystem::Freebsd => table!(b"\"freebsd\"", b"\"arm64\""),
                    OperatingSystem::Wasm => table!(b"\"wasm\"", b"\"arm64\""),
                },
            },
            _ => panic!("TODO"),
        }
    }
}

impl fmt::Display for CompileTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // bun-darwin-x64-baseline-v1.0.0
        // This doesn't match up 100% with npm, but that's okay.
        write!(
            f,
            "bun-{}-{}{}{}-v{}.{}.{}",
            bstr::BStr::new(self.os.npm_name()),
            bstr::BStr::new(self.arch.npm_name()),
            self.libc,
            BaselineFormatter { baseline: self.baseline },
            self.version.major,
            self.version.minor,
            self.version.patch,
        )
    }
}

// `fromJS` / `fromSlice` re-exports from bundler_jsc deleted — see PORTING.md §Idiom map.
// In Rust these are extension-trait methods living in bun_bundler_jsc.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/CompileTarget.zig (506 lines)
//   confidence: medium
//   todos:      13
//   notes:      download_to_path has heavy cross-crate I/O (http/zlib/libarchive/fs); define_values comptime table approximated with macro — verify os.nameString() literals
// ──────────────────────────────────────────────────────────────────────────

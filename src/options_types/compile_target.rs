//! Used for `bun build --compile`
//!
//! This downloads and extracts the bun binary for the target platform
//! It uses npm to download the bun binary from the npm registry
//! It stores the downloaded binary into the bun install cache.

use core::fmt;
use std::io::Write as _;

use bun_core::env::{ARCHITECTURE_NAMES, Architecture, OPERATING_SYSTEM_NAMES, OperatingSystem};
use bun_core::{Environment, Global, env_var, fmt as bun_fmt};
use bun_core::{ZStr, strings};
use bun_paths::{self as path, PathBuffer};
use bun_semver::{SlicedString, Version};
use bun_sys::Fd;

/// Used for `bun build --compile`
#[derive(Clone, Copy)]
pub struct CompileTarget {
    pub os: OperatingSystem,
    pub(crate) arch: Architecture,
    pub(crate) baseline: bool,
    pub(crate) version: Version,
    pub(crate) libc: Libc,
}

impl Default for CompileTarget {
    fn default() -> Self {
        Self {
            os: Environment::OS,
            arch: Environment::ARCH,
            baseline: false,
            version: Version {
                major: Environment::VERSION.major as _, // @truncate
                minor: Environment::VERSION.minor as _, // @truncate
                patch: Environment::VERSION.patch as _, // @truncate
                tag: Default::default(),
                _tag_padding: Default::default(),
            },
            libc: if cfg!(bun_portable) {
                Libc::Portable
            } else if Environment::IS_MUSL {
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
    /// The portable image: compiled for Linux (`os`), run on Linux, macOS and Windows by a host program of that OS.
    Portable,
}

/// The metadata of a Windows executable (`--windows-icon` and the like), asked of a portable target.
pub const PORTABLE_TARGET_WITH_WINDOWS_METADATA: &str = "a portable executable takes no Windows icon, title, publisher, version, description or copyright: its Windows part is the host program of the image, and the resources of that program are not written when compiling";

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
pub enum ParseError {
    #[error("UnsupportedTarget")]
    UnsupportedTarget,
    #[error("InvalidTarget")]
    InvalidTarget,
    /// `portable` without a CPU architecture.
    #[error("PortableTargetWithoutArch")]
    PortableTargetWithoutArch,
    /// `portable` with an operating system, a libc, `baseline` or `modern`.
    #[error("PortableTargetWithToken")]
    PortableTargetWithToken,
}

impl ParseError {
    /// What is wrong with a `portable` target, for the message of the error. `None` for the other errors.
    pub fn portable_target_message(&self) -> Option<&'static str> {
        match self {
            // No default: an x64 file does not start on an arm64 machine, and the name promises neither.
            ParseError::PortableTargetWithoutArch => Some(
                "a portable executable is one file per CPU architecture, use bun-portable-x64 or bun-portable-arm64",
            ),
            ParseError::PortableTargetWithToken => Some(
                "a portable executable runs on Linux, macOS and Windows and on every CPU of its architecture: \"portable\" takes the place of the operating system, and no libc, \"baseline\" or \"modern\" goes with it",
            ),
            ParseError::UnsupportedTarget | ParseError::InvalidTarget => None,
        }
    }
}

impl CompileTarget {
    /// `os` and `libc` of `bun-{os}-{arch}{libc}`, the name of the npm package and of the file in the cache.
    const fn os_and_libc_names(&self) -> (&'static str, &'static str) {
        match self.libc {
            Libc::Default => (self.os.npm_name(), ""),
            Libc::Musl => (self.os.npm_name(), "-musl"),
            Libc::Android => (self.os.npm_name(), "-android"),
            Libc::Portable => ("portable", ""),
        }
    }

    /// The executable of the target is a packed portable image (or that image alone), not a bun of one OS.
    pub const fn is_portable(&self) -> bool {
        matches!(self.libc, Libc::Portable)
    }

    pub const fn arch(&self) -> Architecture {
        self.arch
    }

    pub(crate) fn eql(&self, other: &CompileTarget) -> bool {
        self.os == other.os
            && self.arch == other.arch
            && self.baseline == other.baseline
            && self.version.eql(other.version)
            && self.libc == other.libc
    }

    pub fn is_default(&self) -> bool {
        self.eql(&CompileTarget::default())
    }

    /// Same os, arch and libc as this bun (a different bun version for this platform still counts).
    pub fn is_host_platform(&self) -> bool {
        let host = CompileTarget::default();
        self.os == host.os && self.arch == host.arch && self.libc == host.libc
    }

    pub fn to_npm_registry_url<'a>(&self, buf: &'a mut [u8]) -> crate::Result<&'a [u8]> {
        if let Some(url) = env_var::BUN_COMPILE_TARGET_TARBALL_URL.get() {
            if strings::has_prefix(url, b"http://") || strings::has_prefix(url, b"https://") {
                // The env var slice is `&'static [u8]`,
                // which outlives `'a`, so return it directly instead of copying into `buf`.
                return Ok(url);
            }
        }

        self.to_npm_registry_url_with_url(buf, b"https://registry.npmjs.org")
    }

    pub(crate) fn to_npm_registry_url_with_url<'a>(
        &self,
        buf: &'a mut [u8],
        registry_url: &[u8],
    ) -> crate::Result<&'a [u8]> {
        // Validate the target is supported before building URL
        if !self.is_supported() {
            return Err(crate::Error::UnsupportedTarget);
        }

        // Runtime concat is fine for a one-shot URL build.
        let (os, libc) = self.os_and_libc_names();
        let os = os.as_bytes();
        let arch = self.arch.npm_name();
        let baseline: &[u8] = if self.baseline { b"-baseline" } else { b"" };

        let total = buf.len();
        let mut cursor: &mut [u8] = buf;
        // https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-0.1.6.tgz
        let res = (|| -> std::io::Result<()> {
            cursor.write_all(registry_url)?;
            cursor.write_all(b"/@oven/bun-")?;
            cursor.write_all(os)?;
            cursor.write_all(b"-")?;
            cursor.write_all(arch.as_bytes())?;
            cursor.write_all(libc.as_bytes())?;
            cursor.write_all(baseline)?;
            cursor.write_all(b"/-/bun-")?;
            cursor.write_all(os)?;
            cursor.write_all(b"-")?;
            cursor.write_all(arch.as_bytes())?;
            cursor.write_all(libc.as_bytes())?;
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
                let written = total - remaining;
                // NLL ends `cursor`'s reborrow here; safe sub-slice of the owning buffer.
                Ok(&buf[..written])
            }
            Err(e) => {
                // Catch buffer overflow or other formatting errors
                if e.kind() == std::io::ErrorKind::WriteZero {
                    return Err(crate::Error::BufferTooSmall);
                }
                Err(crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))
            }
        }
    }

    pub fn exe_path<'a>(
        &self,
        buf: &'a mut PathBuffer,
        version_str: &'a ZStr,
        _env: &mut bun_dotenv::Loader,
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
                return ZStr::from_buf(&buf[..], self_exe_path.len());
            }
        }

        if bun_sys::exists_at(Fd::cwd(), version_str) {
            *needs_download = false;
            return version_str;
        }

        // T1 fallback ignores `_env` (full env-override chain lives in bun_install).
        let cache_dir = bun_sys::fetch_cache_directory_path();
        let dest = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
            path::fs::FileSystem::instance().top_level_dir(),
            &mut buf[..],
            &[cache_dir.as_slice(), version_str.as_bytes()],
        );

        if bun_sys::exists_at(Fd::cwd(), dest) {
            *needs_download = false;
        }

        dest
    }

    // `download_to_path` moved up to `bun_standalone_graph` so it can name
    // `bun_http::AsyncHTTP` directly; this struct stays data-only.

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

            if let Some(arch) = ARCHITECTURE_NAMES.get(token) {
                this.arch = *arch;
                found_arch = true;
                continue;
            } else if let Some(os) = OPERATING_SYSTEM_NAMES.get(token) {
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
                if let Some(version) = Self::version_of_token(token)? {
                    this.version = version;
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
            } else if token == b"portable" {
                return Self::try_from_portable(input);
            } else {
                return Err(ParseError::UnsupportedTarget);
            }
        }

        if !found_libc && this.libc != Libc::Default && this.os != OperatingSystem::Linux {
            // "bun-windows-x64" should not implicitly be "bun-windows-x64-musl"
            this.libc = Libc::Default;
        }

        // Asked of a bun that is a portable image: "bun-linux-x64" is a bun of Linux, not this image.
        #[cfg(bun_portable)]
        if found_os && !found_libc {
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

    /// The version of a token that starts with `v0.` or `v1.`. `None` when the rest is not a version.
    fn version_of_token(token: &[u8]) -> Result<Option<Version>, ParseError> {
        let version = Version::parse(SlicedString::init(&token[1..], &token[1..]));
        if !version.valid {
            return Ok(None);
        }
        let (Some(major), Some(minor), Some(patch)) = (
            version.version.major,
            version.version.minor,
            version.version.patch,
        ) else {
            return Err(ParseError::InvalidTarget);
        };
        Ok(Some(Version {
            major,
            minor,
            patch,
            tag: Default::default(),
            _tag_padding: Default::default(),
        }))
    }

    /// A target that names `portable`. The CPU architecture has to be named with it; a version may be.
    fn try_from_portable(input: &[u8]) -> Result<CompileTarget, ParseError> {
        let mut this = CompileTarget {
            os: OperatingSystem::Linux,
            libc: Libc::Portable,
            baseline: false,
            ..CompileTarget::default()
        };
        let mut found_arch = false;
        let mut splitter = strings::split(input, b"-");
        while let Some(token) = splitter.next() {
            if token.is_empty() || token == b"portable" {
                continue;
            }
            if let Some(arch) = ARCHITECTURE_NAMES.get(token) {
                this.arch = *arch;
                found_arch = true;
            } else if OPERATING_SYSTEM_NAMES.get(token).is_some()
                || token == b"musl"
                || token == b"android"
                || token == b"baseline"
                || token == b"modern"
            {
                return Err(ParseError::PortableTargetWithToken);
            } else if strings::has_prefix(token, b"v1.") || strings::has_prefix(token, b"v0.") {
                if let Some(version) = Self::version_of_token(token)? {
                    this.version = version;
                }
            } else {
                return Err(ParseError::UnsupportedTarget);
            }
        }
        if !found_arch {
            return Err(ParseError::PortableTargetWithoutArch);
        }
        if this.arch == Architecture::Wasm {
            return Err(ParseError::InvalidTarget);
        }
        Ok(this)
    }

    pub fn from(input_: &[u8]) -> CompileTarget {
        match Self::try_from(input_) {
            Ok(t) => t,
            Err(
                err @ (ParseError::PortableTargetWithoutArch | ParseError::PortableTargetWithToken),
            ) => {
                bun_core::err_generic!(
                    "invalid target \"bun{}\": {}",
                    bstr::BStr::new(input_),
                    err.portable_target_message().unwrap_or_default(),
                );
                Global::exit(1);
            }
            Err(ParseError::UnsupportedTarget) => {
                let input = strings::trim(input_, b" \t\r");
                let mut splitter = strings::split(input, b"-");
                let mut unsupported_token: Option<&[u8]> = None;
                while let Some(token) = splitter.next() {
                    if token.is_empty() {
                        continue;
                    }
                    if ARCHITECTURE_NAMES.get(token).is_none()
                        && OPERATING_SYSTEM_NAMES.get(token).is_none()
                        && token != b"modern"
                        && token != b"baseline"
                        && token != b"musl"
                        && token != b"android"
                        && token != b"portable"
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
                    bun_core::err_generic!("Unsupported target: {}", bstr::BStr::new(input_));
                }
                Global::exit(1);
            }
            Err(ParseError::InvalidTarget) => {
                let input = strings::trim(input_, b" \t\r");
                if strings::contains(input, b"musl") && !strings::contains(input, b"linux") {
                    bun_core::err_generic!("invalid target, musl libc only exists on linux");
                } else if strings::contains(input, b"android")
                    && !strings::contains(input, b"linux")
                {
                    bun_core::err_generic!(
                        "invalid target, android only exists with linux (use bun-linux-arm64-android)"
                    );
                } else if strings::contains(input, b"wasm") {
                    bun_core::err_generic!("invalid target, WebAssembly is not supported. Sorry!");
                } else if strings::contains(input, b"v") {
                    bun_core::err_generic!(
                        "Please pass a complete version number to --target. For example, --target=bun-v{}",
                        Environment::VERSION_STRING,
                    );
                } else {
                    bun_core::err_generic!("Invalid target: {}", bstr::BStr::new(input_));
                }
                Global::exit(1);
            }
        }
    }

    /// What `--compile` defines for the target.
    pub fn defines(&self) -> Defines {
        // Each axis gets its own exhaustive match so that adding a variant to
        // `OperatingSystem` / `Architecture` / `Libc` is a compile error here,
        // not a runtime panic behind a wildcard arm.
        let (platform, first): (&'static [u8], usize) = match self.libc {
            // process.platform: Node reports "android" on Android, not "linux".
            Libc::Android => (b"\"android\"", 0),
            Libc::Default | Libc::Musl => (
                match self.os {
                    OperatingSystem::Mac => b"\"darwin\"",
                    OperatingSystem::Linux => b"\"linux\"",
                    OperatingSystem::Windows => b"\"win32\"",
                    OperatingSystem::Freebsd => b"\"freebsd\"",
                    OperatingSystem::Wasm => b"\"wasm\"",
                },
                0,
            ),
            // Not a constant of the build: the executable answers with the OS that runs it.
            Libc::Portable => (b"", 1),
        };
        let arch: &'static [u8] = match self.arch {
            Architecture::X64 => b"\"x64\"",
            Architecture::Arm64 => b"\"arm64\"",
            Architecture::Wasm => b"\"wasm\"",
        };
        const VERSION: &[u8] =
            const_format::concatcp!("\"", bun_core::Global::package_json_version, "\"").as_bytes();
        Defines {
            entries: [
                (b"process.platform", platform),
                (b"process.arch", arch),
                (b"process.versions.bun", VERSION),
            ],
            first,
        }
    }
}

/// Key and value of `process.platform`, `process.arch` and `process.versions.bun`; a portable target has no platform.
pub struct Defines {
    entries: [(&'static [u8], &'static [u8]); 3],
    first: usize,
}

impl Defines {
    pub fn as_slice(&self) -> &[(&'static [u8], &'static [u8])] {
        &self.entries[self.first..]
    }
}

impl fmt::Display for CompileTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // bun-darwin-x64-baseline-v1.0.0
        // This doesn't match up 100% with npm, but that's okay.
        let (os, libc) = self.os_and_libc_names();
        write!(
            f,
            "bun-{}-{}{}{}-v{}.{}.{}",
            os,
            self.arch.npm_name(),
            libc,
            BaselineFormatter {
                baseline: self.baseline
            },
            self.version.major,
            self.version.minor,
            self.version.patch,
        )
    }
}

// `fromJS` / `fromSlice` re-exports from bundler_jsc deleted — see PORTING.md §Idiom map.
// In Rust these are extension-trait methods living in bun_bundler_jsc.

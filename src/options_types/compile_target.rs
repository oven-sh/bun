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
    pub(crate) const fn npm_name(self) -> &'static str {
        match self {
            Libc::Default => "",
            Libc::Musl => "-musl",
            Libc::Android => "-android",
        }
    }
}

impl fmt::Display for Libc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.npm_name())
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
pub enum ParseError {
    #[error("UnsupportedTarget")]
    UnsupportedTarget,
    #[error("InvalidTarget")]
    InvalidTarget,
}

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

    pub fn to_npm_registry_url_with_url<'a>(
        &self,
        buf: &'a mut [u8],
        registry_url: &[u8],
    ) -> crate::Result<&'a [u8]> {
        // Validate the target is supported before building URL
        if !self.is_supported() {
            return Err(crate::Error::UnsupportedTarget);
        }

        // Runtime concat is fine for a one-shot URL build.
        let os = self.os.npm_name().as_bytes();
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
                    if ARCHITECTURE_NAMES.get(token).is_none()
                        && OPERATING_SYSTEM_NAMES.get(token).is_none()
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

    // Exists for consistentcy with values.
    pub fn define_keys(&self) -> &'static [&'static [u8]] {
        &[
            b"process.platform",
            b"process.arch",
            b"process.versions.bun",
        ]
    }

    pub fn define_values(&self) -> &'static [&'static [u8]] {
        // Could generate static tables via macro_rules! or
        // const_format::concatcp! over OperatingSystem::name_string().
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
            self.os.npm_name(),
            self.arch.npm_name(),
            self.libc,
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

use bun_collections::VecExt;
use core::ffi::c_char;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_alloc::Arena as Bump;
use bun_core::Global::SyncCStr;
use bun_core::MutableString;
use bun_core::{self, Environment, Global, Output, Progress, fmt as bun_fmt};
use bun_core::{ZStr, strings};
use bun_dotenv as DotEnv;
use bun_http::{self as HTTP, headers};
use bun_install::integrity::{Integrity, Tag as IntegrityTag};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_parsers::json as JSON;
use bun_paths::{self, PathBuffer, SEP_STR};
use bun_resolver::fs;
use bun_sys as sys;
use bun_url::URL;
use bun_which::which;
use bun_wyhash::hash;

use crate::api::bun::process::Status;
use crate::api::bun::process::sync as spawn_sync;
use crate::cli::Command;

// `sync::Options.argv` is `Vec<Box<[u8]>>` (owns its rows). Helper
// to build it from borrowed slices.
#[inline]
fn build_argv(parts: &[&[u8]]) -> Vec<Box<[u8]>> {
    parts.iter().map(|p| Box::<[u8]>::from(*p)).collect()
}

#[cfg(windows)]
#[inline]
fn spawn_windows_options() -> crate::api::bun::process::WindowsOptions {
    crate::api::bun::process::WindowsOptions {
        loop_: bun_event_loop::EventLoopHandle::init_mini(
            bun_event_loop::MiniEventLoop::init_global(None, None),
        ),
        ..Default::default()
    }
}

// `bun_resolver::fs::FileSystem` (the inline canonical type surface
// in `resolver/lib.rs`) does not yet expose `tmpdir()`; the full impl lives in
// the un-exported `fs_full` module. Shim it locally — open
// `RealFS::tmpdir_path()` as a `sys::Dir`, mirroring `RealFS::open_tmp_dir`.
pub(crate) trait FileSystemTmpdirExt {
    fn tmpdir(&mut self) -> crate::Result<sys::Dir>;
}
impl FileSystemTmpdirExt for fs::FileSystem {
    fn tmpdir(&mut self) -> crate::Result<sys::Dir> {
        sys::Dir::open(fs::RealFS::tmpdir_path()).map_err(Into::into)
    }
}

// `bun.argv` is an `Argv` newtype (not `&[&[u8]]`), so
// `strings::contains_any` can't take it directly. Local helper that scans the
// process argv for an exact match.
#[inline]
fn argv_contains(target: &[u8]) -> bool {
    bun_core::argv().iter().any(|a| a == target)
}

// ──────────────────────────────────────────────────────────────────────────

pub struct Version {
    pub zip_url: Box<[u8]>,
    pub tag: Box<[u8]>,
    pub buf: MutableString,
    pub size: u32,
    pub digest: Integrity,
}

impl Version {
    pub fn name(&self) -> Option<Vec<u8>> {
        if self.tag.len() <= b"bun-v".len() || !self.tag.starts_with(b"bun-v") {
            if &*self.tag == b"canary" {
                use crate::cli as Cli;
                let mut out = Vec::new();
                let start_time = Cli::start_time();
                let bytes = &start_time.to_ne_bytes()[..];
                write!(
                    &mut out,
                    "bun-canary-timestamp-{}",
                    bun_fmt::hex_int_lower::<16>(hash(bytes)),
                )
                .expect("oom");
                return Some(out);
            }
            return Some(self.tag.to_vec());
        }

        Some(self.tag[b"bun-v".len()..].to_vec())
    }

    // "windows" not "win32"; Android folds to "linux" (`SUFFIX_ABI` below adds
    // "-android", matching `bun-linux-aarch64-android.zip` on the release page).
    pub const PLATFORM_LABEL: &'static str = bun_core::env::OS_NAME_NPM;

    pub const ARCH_LABEL: &'static str = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    };
    pub const TRIPLET: &'static str =
        const_format::concatcp!(Version::PLATFORM_LABEL, "-", Version::ARCH_LABEL);
    const SUFFIX_ABI: &'static str = if Environment::IS_MUSL {
        "-musl"
    } else if Environment::IS_ANDROID {
        "-android"
    } else {
        ""
    };
    const SUFFIX: &'static str = Version::SUFFIX_ABI;
    pub const FOLDER_NAME: &'static str =
        const_format::concatcp!("bun-", Version::TRIPLET, Version::SUFFIX);
    pub const ZIP_FILENAME: &'static str = const_format::concatcp!(Version::FOLDER_NAME, ".zip");

    pub const PROFILE_FOLDER_NAME: &'static str =
        const_format::concatcp!("bun-", Version::TRIPLET, Version::SUFFIX, "-profile");
    pub const PROFILE_ZIP_FILENAME: &'static str =
        const_format::concatcp!(Version::PROFILE_FOLDER_NAME, ".zip");

    const CURRENT_VERSION: &'static str =
        const_format::concatcp!("bun-v", Global::package_json_version);

    pub fn is_current(&self) -> bool {
        &*self.tag == Self::CURRENT_VERSION.as_bytes()
    }

    pub fn parse_asset_digest(buf: &[u8]) -> Integrity {
        const PREFIX: &[u8] = b"sha256:";
        const HEX_LEN: usize = 64;
        if buf.len() != PREFIX.len() + HEX_LEN || !strings::starts_with(buf, PREFIX) {
            return Integrity::default();
        }

        let mut digest = Integrity {
            tag: IntegrityTag::SHA256,
            ..Default::default()
        };
        for (i, pair) in buf[PREFIX.len()..].as_chunks::<2>().0.iter().enumerate() {
            match bun_fmt::hex_pair_value(pair[0], pair[1]) {
                Some(byte) => digest.value[i] = byte,
                None => return Integrity::default(),
            }
        }

        digest
    }
}

// Exported C symbol — null-terminated
// Moved out of `impl Version` — Rust impl blocks cannot hold `static` items.
// `*const c_char` is `!Sync`, so wrap in the `#[repr(transparent)]` `SyncCStr` newtype
// (same pattern as `Bun__userAgent` in bun_core::Global) so the C++ side still sees a
// single `const char*`-sized symbol.
#[unsafe(no_mangle)]
pub(crate) static Bun__githubURL: SyncCStr = SyncCStr(
    const_format::concatcp!(
        "https://github.com/oven-sh/bun/releases/download/bun-v",
        Global::package_json_version,
        "/",
        Version::ZIP_FILENAME,
        "\0"
    )
    .as_ptr()
    .cast::<c_char>(),
);

// ──────────────────────────────────────────────────────────────────────────

pub struct UpgradeCommand;

impl UpgradeCommand {
    const DEFAULT_GITHUB_HEADERS: &'static [u8] = b"Acceptapplication/vnd.github.v3+json";

    pub fn get_latest_version<const SILENT: bool>(
        env_loader: &mut DotEnv::Loader,
        refresher: Option<&mut Progress::Progress>,
        mut progress: Option<&mut Progress::Node>,
        use_profile: bool,
    ) -> crate::Result<Option<Version>> {
        let mut headers_buf: Vec<u8> = Self::DEFAULT_GITHUB_HEADERS.to_vec();

        let mut header_entries: headers::EntryList = headers::EntryList::default();
        let accept = headers::Entry {
            name: HTTP::ETag::StringPointer {
                offset: 0,
                length: u32::try_from(b"Accept".len()).expect("int cast"),
            },
            value: HTTP::ETag::StringPointer {
                offset: u32::try_from(b"Accept".len()).expect("int cast"),
                length: u32::try_from(b"application/vnd.github.v3+json".len()).expect("int cast"),
            },
        };
        header_entries.append(accept).expect("oom");
        // defer if SILENT header_entries.deinit() — Drop handles this

        // Incase they're using a GitHub proxy in e.g. China
        let mut github_api_domain: &[u8] = b"api.github.com";
        if let Some(api_domain) = env_loader.map.get(b"GITHUB_API_DOMAIN") {
            if !api_domain.is_empty() {
                github_api_domain = api_domain;
            }
        }

        // `AsyncHTTP::init_sync` wants `URL<'static>` / `&'static [u8]`, so back
        // the buffers in the process-lifetime CLI arena.
        let url_buf: &'static mut Vec<u8> = crate::cli::cli_arena().alloc(Vec::new());
        write!(
            url_buf,
            "https://{}/repos/Jarred-Sumner/bun-releases-for-updater/releases/latest",
            bstr::BStr::new(github_api_domain),
        )
        .expect("oom");
        let api_url = URL::parse(&url_buf[..]);

        if let Some(access_token) = env_loader
            .map
            .get(b"GITHUB_TOKEN")
            .or_else(|| env_loader.map.get(b"GITHUB_ACCESS_TOKEN"))
        {
            if !access_token.is_empty() {
                headers_buf.clear();
                write!(
                    &mut headers_buf,
                    "{}AuthorizationBearer {}",
                    bstr::BStr::new(Self::DEFAULT_GITHUB_HEADERS),
                    bstr::BStr::new(access_token),
                )
                .expect("oom");
                header_entries
                    .append(headers::Entry {
                        name: HTTP::ETag::StringPointer {
                            offset: accept.value.offset + accept.value.length,
                            length: u32::try_from(b"Authorization".len()).expect("int cast"),
                        },
                        value: HTTP::ETag::StringPointer {
                            offset: u32::try_from(
                                (accept.value.offset + accept.value.length) as usize
                                    + b"Authorization".len(),
                            )
                            .unwrap(),
                            length: u32::try_from(b"Bearer ".len() + access_token.len())
                                .expect("int cast"),
                        },
                    })
                    .expect("oom");
            }
        }

        let http_proxy = env_loader.get_http_proxy_for(&api_url);

        let metadata_body: &'static mut MutableString =
            crate::cli::cli_arena().alloc(MutableString::init(2048)?);
        let headers_buf: &'static [u8] = crate::cli::cli_dupe(&headers_buf);

        // ensure very stable memory address
        let mut async_http = Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            api_url,
            header_entries,
            headers_buf,
            std::ptr::from_mut::<MutableString>(metadata_body),
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        ));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        if !SILENT {
            // `progress_node` stores an untracked NonNull borrow of the caller's
            // `progress`; sound because `send_sync` below completes before this
            // frame returns, so the pointee outlives every use.
            async_http.client.progress_node = Some(NonNull::from(progress.as_deref_mut().unwrap()));
        }
        let response = async_http.send_sync()?;

        match response.status_code {
            404 => return Err(crate::Error::HTTP404),
            403 => return Err(crate::Error::HTTPForbidden),
            429 => return Err(crate::Error::HTTPTooManyRequests),
            499..=599 => return Err(crate::Error::GitHubIsDown),
            200 => {}
            _ => return Err(crate::Error::HTTPError),
        }

        let mut log = bun_ast::Log::init();
        let source =
            bun_ast::Source::init_path_string(b"releases.json", metadata_body.list.as_slice());
        bun_ast::initialize_store();
        // `JSON::parse_utf8` needs a bump arena; this is a one-shot
        // CLI path so use the process-lifetime CLI arena.
        let bump: &'static Bump = crate::cli::cli_arena();
        let expr = match JSON::parse_utf8(&source, &mut log, bump) {
            Ok(e) => e,
            Err(err) => {
                if !SILENT {
                    progress.expect("infallible: progress active").end();
                    refresher.expect("infallible: progress active").refresh();

                    if log.errors > 0 {
                        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        Global::exit(1);
                    } else {
                        bun_core::pretty_errorln!(
                            "Error parsing releases from GitHub: <r><red>{}<r>",
                            err.name()
                        );
                        Global::exit(1);
                    }
                }

                return Ok(None);
            }
        };

        if log.errors > 0 {
            if !SILENT {
                progress.expect("infallible: progress active").end();
                refresher.expect("infallible: progress active").refresh();

                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                Global::exit(1);
            }

            return Ok(None);
        }

        let mut version = Version {
            zip_url: Box::default(),
            tag: Box::default(),
            buf: MutableString::init_empty(),
            size: 0,
            digest: Integrity::default(),
        };

        if !expr.is_object() {
            if !SILENT {
                progress.expect("infallible: progress active").end();
                refresher.expect("infallible: progress active").refresh();

                bun_core::pretty_errorln!(
                    "JSON error - expected an object but received {:?}",
                    core::mem::discriminant(&expr.data)
                );
                Global::exit(1);
            }

            return Ok(None);
        }

        if let Some(tag_name_) = expr.as_property(b"tag_name") {
            if let Some(tag_name) = tag_name_.expr.as_utf8_string_literal() {
                version.tag = Box::<[u8]>::from(tag_name);
            }
        }

        if version.tag.is_empty() {
            if !SILENT {
                progress.expect("infallible: progress active").end();
                refresher.expect("infallible: progress active").refresh();

                bun_core::pretty_errorln!(
                    "JSON Error parsing releases from GitHub: <r><red>tag_name<r> is missing?\n{}",
                    // `version.buf` is still empty at this point;
                    // print the raw payload instead.
                    bstr::BStr::new(metadata_body.list.as_slice())
                );
                Global::exit(1);
            }

            return Ok(None);
        }

        'get_asset: {
            let Some(assets_) = expr.as_property(b"assets") else {
                break 'get_asset;
            };
            // `bun_ast::Expr` only exposes the raw `EArray` payload,
            // so unwrap it and iterate `items` directly.
            let Some(assets) = assets_.expr.data.e_array() else {
                break 'get_asset;
            };

            for asset in assets.items.slice() {
                if let Some(content_type) = asset.as_property(b"content_type") {
                    let Some(content_type_) = content_type.expr.as_utf8_string_literal() else {
                        continue;
                    };
                    if bun_core::env::IS_DEBUG {
                        bun_core::prettyln!("Content-type: {}", bstr::BStr::new(content_type_));
                        Output::flush();
                    }

                    if content_type_ != b"application/zip" {
                        continue;
                    }
                }

                if let Some(name_) = asset.as_property(b"name") {
                    if let Some(name) = name_.expr.as_utf8_string_literal() {
                        if bun_core::env::IS_DEBUG {
                            let filename = if !use_profile {
                                Version::ZIP_FILENAME
                            } else {
                                Version::PROFILE_ZIP_FILENAME
                            };
                            bun_core::prettyln!(
                                "Comparing {} vs {}",
                                bstr::BStr::new(name),
                                filename
                            );
                            Output::flush();
                        }

                        if !use_profile && name != Version::ZIP_FILENAME.as_bytes() {
                            continue;
                        }
                        if use_profile && name != Version::PROFILE_ZIP_FILENAME.as_bytes() {
                            continue;
                        }

                        version.zip_url = match asset.as_property(b"browser_download_url") {
                            Some(p) => match p.expr.as_utf8_string_literal() {
                                Some(s) => Box::<[u8]>::from(s),
                                None => break 'get_asset,
                            },
                            None => break 'get_asset,
                        };
                        if bun_core::env::IS_DEBUG {
                            bun_core::prettyln!("Found Zip {}", bstr::BStr::new(&*version.zip_url));
                            Output::flush();
                        }

                        if let Some(digest_) = asset.as_property(b"digest") {
                            if let Some(digest) = digest_.expr.as_utf8_string_literal() {
                                version.digest = Version::parse_asset_digest(digest);
                            }
                        }

                        if let Some(size_) = asset.as_property(b"size") {
                            if let bun_ast::ExprData::ENumber(n) = &size_.expr.data {
                                version.size =
                                    u32::try_from(((n.value().ceil()) as i32).max(0)).unwrap();
                            }
                        }
                        return Ok(Some(version));
                    }
                }
            }
        }

        if !SILENT {
            progress.expect("infallible: progress active").end();
            refresher.expect("infallible: progress active").refresh();
            if let Some(name) = version.name() {
                bun_core::pretty_errorln!(
                    "Bun v{} is out, but not for this platform ({}) yet.",
                    bstr::BStr::new(&name),
                    Version::TRIPLET
                );
            }

            Global::exit(0);
        }

        Ok(None)
    }

    const EXE_SUFFIX: &'static str = if cfg!(windows) { ".exe" } else { "" };

    const EXE_SUBPATH: &'static str = const_format::concatcp!(
        Version::FOLDER_NAME,
        SEP_STR,
        "bun",
        UpgradeCommand::EXE_SUFFIX
    );
    const PROFILE_EXE_SUBPATH: &'static str = const_format::concatcp!(
        Version::PROFILE_FOLDER_NAME,
        SEP_STR,
        "bun-profile",
        UpgradeCommand::EXE_SUFFIX
    );

    const MANUAL_UPGRADE_COMMAND: &'static str = {
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
        {
            "curl -fsSL https://bun.com/install | bash"
        }
        #[cfg(target_os = "windows")]
        {
            "powershell -c 'irm bun.sh/install.ps1|iex'"
        }
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "windows"
        )))]
        {
            // No install script exists for this platform; point at the docs instead.
            "(no install script for this platform — see https://bun.com/docs/installation)"
        }
    };

    /// Parse a pull request number from `1234`, `#1234`, or a GitHub pull
    /// request URL like `https://github.com/oven-sh/bun/pull/1234`.
    fn parse_pr_number(arg: &[u8]) -> Option<u64> {
        let mut digits = arg;
        if strings::has_prefix_comptime(digits, b"https://")
            || strings::has_prefix_comptime(digits, b"http://")
        {
            // The number is looked up in oven-sh/bun, so only the canonical
            // oven-sh/bun pull request URL is accepted; a URL naming any
            // other location must be rejected, not reinterpreted.
            digits = digits
                .strip_prefix(b"https://github.com/oven-sh/bun/pull/".as_slice())
                .or_else(|| {
                    digits.strip_prefix(b"http://github.com/oven-sh/bun/pull/".as_slice())
                })?;
            if let Some(end) = digits.iter().position(|c| !c.is_ascii_digit()) {
                digits = &digits[..end];
            }
        } else if let Some(rest) = digits.strip_prefix(b"#") {
            digits = rest;
        }

        if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        core::str::from_utf8(digits)
            .ok()?
            .parse::<u64>()
            .ok()
            .filter(|n| *n > 0)
    }

    #[cold]
    pub fn exec(ctx: Command::Context) -> crate::Result<()> {
        let args = bun_core::argv();
        let mut pr_number: Option<u64> = None;
        if args.len() > 2 {
            let mut positionals = args
                .iter()
                .skip(2)
                .filter(|arg| !strings::has_prefix_comptime(arg, b"--"));
            if let Some(first) = positionals.next() {
                if first == b"pr".as_slice() {
                    let Some(arg) = positionals.next() else {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r><d>:<r> Expected a pull request number.\n<blue>note<r><d>:<r> Usage: <b>bun upgrade pr \\<number\\><r>"
                        );
                        Global::exit(1);
                    };
                    let Some(number) = Self::parse_pr_number(arg) else {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r><d>:<r> Invalid pull request number: <b>{}<r>\n<blue>note<r><d>:<r> Usage: <b>bun upgrade pr \\<number\\><r>",
                            bstr::BStr::new(arg)
                        );
                        Global::exit(1);
                    };
                    if positionals.next().is_some() {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r><d>:<r> Unexpected extra arguments.\n<blue>note<r><d>:<r> Usage: <b>bun upgrade pr \\<number\\><r>"
                        );
                        Global::exit(1);
                    }
                    pr_number = Some(number);
                } else {
                    bun_core::pretty_error!(
                        "<r><red>error<r><d>:<r> This command updates Bun itself, and does not take package names.\n<blue>note<r><d>:<r> Use `bun update"
                    );
                    for arg_err in args.iter().skip(2) {
                        bun_core::pretty_error!(" {}", bstr::BStr::new(arg_err));
                    }
                    bun_core::pretty_errorln!("` instead.");
                    Global::exit(1);
                }
            }
        }

        if let Err(err) = Self::_exec(ctx, pr_number) {
            bun_core::pretty_errorln!(
                "<r>Bun upgrade failed with error: <red><b>{}<r>\n\n<cyan>Please upgrade manually<r>:\n  <b>{}<r>\n\n",
                err.name(),
                Self::MANUAL_UPGRADE_COMMAND
            );
            Global::exit(1);
        }
        Ok(())
    }

    fn _exec(ctx: Command::Context, pr_number: Option<u64>) -> crate::Result<()> {
        HTTP::http_thread::init(&Default::default());

        // SAFETY: FileSystem::init returns the process-global singleton; valid for 'static.
        let filesystem = unsafe { &mut *fs::FileSystem::init(None)? };
        let mut env_loader: DotEnv::Loader = {
            // Allocate in the process-lifetime CLI arena.
            DotEnv::Loader::init(crate::cli::cli_arena().alloc(DotEnv::Map::init()))
        };
        env_loader.load_process()?;

        let is_pr = pr_number.is_some();

        let use_canary: bool = !is_pr
            && 'brk: {
                let default_use_canary = Environment::IS_CANARY;

                if default_use_canary && argv_contains(b"--stable") {
                    break 'brk false;
                }

                break 'brk (env_loader.map.get(b"BUN_CANARY").unwrap_or(b"0") == b"1")
                    || argv_contains(b"--canary")
                    || default_use_canary;
            };

        let use_profile = argv_contains(b"--profile");

        let mut pr_build_title: Option<Box<[u8]>> = None;
        let mut pr_checksum: Option<PrArtifactChecksum> = None;

        let mut version: Version = if let Some(number) = pr_number {
            let pr_build = Self::fetch_pr_build(&mut env_loader, number, use_profile)?;
            pr_build_title = Some(pr_build.title);
            pr_checksum = Some(pr_build.zip_checksum);
            pr_build.version
        } else if !use_canary {
            // `Progress::start` returns `&mut Node` borrowing `refresher`;
            // leak the Progress and use raw pointers so we can pass both
            // `&mut refresher` and `&mut progress` to `get_latest_version`.
            let refresher: *mut Progress::Progress =
                bun_core::heap::into_raw(Box::new(Progress::Progress::default()));
            // SAFETY: refresher is a fresh leaked allocation.
            let progress: *mut Progress::Node =
                unsafe { (*refresher).start(b"Fetching version tags", 0) };

            let Some(version) = Self::get_latest_version::<false>(
                &mut env_loader,
                // SAFETY: refresher/progress point into the same leaked allocation;
                // `get_latest_version` only touches them on the !SILENT error
                // path (no overlapping live borrows).
                Some(unsafe { &mut *refresher }),
                // SAFETY: progress points into the same leaked allocation (see above).
                Some(unsafe { &mut *progress }),
                use_profile,
            )?
            else {
                return Ok(());
            };

            // SAFETY: see above.
            unsafe { (*progress).end() };
            // SAFETY: refresher is a leaked Box (process-lifetime); no other &mut is live.
            unsafe { (*refresher).refresh() };

            if !Environment::IS_CANARY {
                if version.name().is_some() && version.is_current() {
                    bun_core::pretty_errorln!(
                        "<r><green>Congrats!<r> You're already on the latest version of Bun <d>(which is v{})<r>",
                        bstr::BStr::new(&version.name().unwrap())
                    );
                    Global::exit(0);
                }
            }

            if version.name().is_none() {
                bun_core::pretty_errorln!(
                    "<r><red>error:<r> Bun versions are currently unavailable (the latest version name didn't match the expected format)"
                );
                Global::exit(1);
            }

            if !Environment::IS_CANARY {
                bun_core::pretty_errorln!(
                    "<r><b>Bun <cyan>v{}<r> is out<r>! You're on <blue>v{}<r>\n",
                    bstr::BStr::new(&version.name().unwrap()),
                    Global::package_json_version
                );
            } else {
                bun_core::pretty_errorln!(
                    "<r><b>Downgrading from Bun <blue>{}-canary<r> to Bun <cyan>v{}<r><r>\n",
                    Global::package_json_version,
                    bstr::BStr::new(&version.name().unwrap())
                );
            }
            Output::flush();

            version
        } else {
            Version {
                tag: b"canary"[..].into(),
                zip_url: const_format::concatcp!(
                    "https://github.com/oven-sh/bun/releases/download/canary/",
                    Version::ZIP_FILENAME
                )
                .as_bytes()
                .into(),
                size: 0,
                buf: MutableString::init_empty(),
                digest: Integrity::default(),
            }
        };

        // Try a delta upgrade first: download binary patches between
        // consecutive stable releases instead of the full archive. Any
        // failure falls back to the regular zip download below.
        let delta_binary: Option<Vec<u8>> =
            if !use_canary && !is_pr && !use_profile && !argv_contains(b"--no-delta") {
                match version.name() {
                    Some(target) => Self::try_delta_upgrade(&mut env_loader, &target, version.size),
                    None => None,
                }
            } else {
                None
            };

        let zip_url_bytes = core::mem::take(&mut version.zip_url);
        let zip_url = URL::parse(&zip_url_bytes);
        let http_proxy = env_loader.get_http_proxy_for(&zip_url);

        {
            let bytes: &[u8] = if delta_binary.is_some() {
                // The new binary was reconstructed from delta patches; no
                // archive download is needed.
                b""
            } else {
                let refresher: *mut Progress::Progress =
                    bun_core::heap::into_raw(Box::new(Progress::Progress::default()));
                // SAFETY: refresher is a fresh leaked allocation.
                let progress: *mut Progress::Node =
                    unsafe { (*refresher).start(b"Downloading", version.size as usize) };
                // SAFETY: see above.
                unsafe { (*progress).unit = Progress::Unit::Bytes };
                // SAFETY: refresher is a leaked Box (process-lifetime); no other &mut is live.
                unsafe { (*refresher).refresh() };
                // Store in the process-lifetime CLI arena.
                let zip_file_buffer: &'static mut MutableString = crate::cli::cli_arena()
                    .alloc(MutableString::init(version.size.max(1024) as usize)?);

                let mut async_http = Box::new(HTTP::AsyncHTTP::init_sync(
                    HTTP::Method::GET,
                    zip_url,
                    headers::EntryList::default(),
                    b"",
                    std::ptr::from_mut::<MutableString>(zip_file_buffer),
                    b"",
                    http_proxy,
                    None,
                    HTTP::FetchRedirect::Follow,
                ));
                // `progress` is intentionally leaked (process-lifetime), so the
                // untracked NonNull stored in `progress_node` can never dangle.
                async_http.client.progress_node =
                    Some(NonNull::new(progress).expect("leaked Box is non-null"));
                async_http.client.flags.reject_unauthorized =
                    env_loader.get_tls_reject_unauthorized();

                let response = async_http.send_sync()?;

                match response.status_code {
                    404 => {
                        if use_canary {
                            bun_core::pretty_errorln!(
                                "<r><red>error:<r> Canary builds are not available for this platform yet\n\n   Release: <cyan>https://github.com/oven-sh/bun/releases/tag/canary<r>\n  Filename: <b>{}<r>\n",
                                Version::ZIP_FILENAME
                            );
                            Global::exit(1);
                        }

                        return Err(crate::Error::HTTP404);
                    }
                    403 => return Err(crate::Error::HTTPForbidden),
                    429 => return Err(crate::Error::HTTPTooManyRequests),
                    // PR artifacts download from Buildkite, not GitHub.
                    499..=599 if is_pr => return Err(crate::Error::HTTPServerError),
                    499..=599 => return Err(crate::Error::GitHubIsDown),
                    200 => {}
                    _ => return Err(crate::Error::HTTPError),
                }

                let bytes = zip_file_buffer.slice();

                // SAFETY: refresher/progress are leaked allocations.
                unsafe { (*progress).end() };
                // SAFETY: refresher is a leaked Box (process-lifetime); no other &mut is live.
                unsafe { (*refresher).refresh() };

                if bytes.is_empty() {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Failed to download the latest version of Bun. Received empty content"
                    );
                    Global::exit(1);
                }

                if let Some(checksum) = &pr_checksum {
                    let (expected, actual) = match checksum {
                        PrArtifactChecksum::Sha256(expected) => {
                            (&**expected, Self::sha256_hex(bytes))
                        }
                        PrArtifactChecksum::Sha1(expected) => (&**expected, Self::sha1_hex(bytes)),
                    };
                    if actual.as_bytes() != expected {
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> The downloaded artifact failed checksum verification.\n  Expected: <b>{}<r>\n    Actual: <b>{}<r>",
                            bstr::BStr::new(expected),
                            actual
                        );
                        Global::exit(1);
                    }
                }

                // The digest describes the release archive, so it only applies
                // to a downloaded one. Delta upgrades verify every patch and
                // the reconstructed binary against their own checksums.
                if version.digest.tag.is_supported() && !version.digest.verify(bytes) {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> The file downloaded from {} did not match the checksum reported by the GitHub API for this release.\n<r>note: run <b>bun upgrade<r> again to retry the download",
                        bstr::BStr::new(&zip_url_bytes)
                    );
                    Global::exit(1);
                }

                bytes
            };

            let version_name = version.name().unwrap();
            let mut pr_revision: Option<Box<[u8]>> = None;

            if version_name.is_empty()
                || version_name.as_slice() == b"."
                || version_name.as_slice() == b".."
                || strings::index_of_char(&version_name, 0).is_some()
                || strings::index_of_char(&version_name, b'/').is_some()
                || strings::index_of_char(&version_name, b'\\').is_some()
            {
                Output::err_generic(
                    "Refusing to use release tag as a directory name: {}",
                    (bstr::BStr::new(&version_name),),
                );
                Global::exit(1);
            }

            let save_dir_: sys::Dir = match filesystem.tmpdir() {
                Ok(d) => d,
                Err(err) => {
                    Output::err_generic("Failed to open temporary directory: {}", (err.name(),));
                    Global::exit(1);
                }
            };

            let _ = save_dir_.delete_tree(&version_name);
            let version_name_z = bun_core::ZBox::from_bytes(&version_name);
            if let Err(err) = sys::mkdirat(&save_dir_, version_name_z.as_zstr(), 0o700) {
                Output::err_generic(
                    "Failed to create temporary directory: {}",
                    (bstr::BStr::new(err.name()),),
                );
                Global::exit(1);
            }
            let save_dir_it = match save_dir_.open_at(&version_name) {
                Ok(d) => d,
                Err(err) => {
                    Output::err_generic(
                        "Failed to open temporary directory: {}",
                        (bstr::BStr::new(err.name()),),
                    );
                    Global::exit(1);
                }
            };
            let save_dir: sys::Dir = save_dir_it;

            // Reshaped for borrowck — use a stack-local PathBuffer instead of thread_local
            let mut tmpdir_path_buf = PathBuffer::uninit();
            let tmpdir_path = match sys::get_fd_path(save_dir.fd(), &mut tmpdir_path_buf) {
                Ok(p) => p,
                Err(err) => {
                    Output::err_generic(
                        "Failed to read temporary directory: {}",
                        (bstr::BStr::new(err.name()),),
                    );
                    Global::exit(1);
                }
            };

            let tmpdir_path_len = tmpdir_path.len();
            tmpdir_path_buf[tmpdir_path_len] = 0;
            // SAFETY: buf[tmpdir_path_len] == 0 written above
            let tmpdir_z = ZStr::from_buf(&tmpdir_path_buf[..], tmpdir_path_len);
            let _ = sys::chdir(tmpdir_z);

            // SAFETY: literal ends with NUL.
            let tmpname: &ZStr = ZStr::from_static(b"bun.zip\0");
            let exe: &[u8] = if use_profile {
                Self::PROFILE_EXE_SUBPATH.as_bytes()
            } else {
                Self::EXE_SUBPATH.as_bytes()
            };

            if let Some(patched) = delta_binary.as_deref() {
                // The patched executable was reconstructed in memory; write it
                // into the staging directory at the same path the archive
                // would have been extracted to.
                // SAFETY: literal ends with NUL.
                let folder_z: &ZStr = ZStr::from_static(
                    const_format::concatcp!(Version::FOLDER_NAME, "\0").as_bytes(),
                );
                if let Err(err) = sys::mkdirat(&save_dir, folder_z, 0o755) {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Failed to create staging directory {}",
                        bstr::BStr::new(err.name())
                    );
                    Global::exit(1);
                }

                let exe_file = match save_dir.open_file(
                    exe,
                    sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                    0o755,
                ) {
                    Ok(f) => f,
                    Err(err) => {
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> Failed to open temp file {}",
                            bstr::BStr::new(err.name())
                        );
                        Global::exit(1);
                    }
                };
                if let Err(err) = exe_file.write_all(patched) {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Failed to write to temp file {}",
                        bstr::BStr::new(err.name())
                    );
                    Global::exit(1);
                }
                let _ = exe_file.close();
            } else {
                let zip_file = match save_dir.open_file(
                    tmpname.as_bytes(),
                    sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                    0o644,
                ) {
                    Ok(f) => f,
                    Err(err) => {
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> Failed to open temp file {}",
                            bstr::BStr::new(err.name())
                        );
                        Global::exit(1);
                    }
                };

                {
                    if let Err(err) = zip_file.write_all(bytes) {
                        let _ = sys::unlinkat(&save_dir, tmpname);
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> Failed to write to temp file {}",
                            bstr::BStr::new(err.name())
                        );
                        Global::exit(1);
                    }
                    let _ = zip_file.close();
                }

                {
                    scopeguard::defer! {
                        let _ = sys::unlinkat(&save_dir, tmpname);
                    }

                    #[cfg(unix)]
                    {
                        let mut unzip_path_buf = PathBuffer::uninit();
                        let Some(unzip_exe) = which(
                            &mut unzip_path_buf,
                            env_loader.map.get(b"PATH").unwrap_or(b""),
                            filesystem.top_level_dir,
                            b"unzip",
                        ) else {
                            let _ = sys::unlinkat(&save_dir, tmpname);
                            bun_core::pretty_errorln!(
                                "<r><red>error:<r> Failed to locate \"unzip\" in PATH. bun upgrade needs \"unzip\" to work."
                            );
                            Global::exit(1);
                        };

                        // We could just embed libz2
                        // however, we want to be sure that xattrs are preserved
                        // xattrs are used for codesigning
                        // it'd be easy to mess that up
                        let unzip_argv: [&[u8]; 4] =
                            [unzip_exe.as_bytes(), b"-q", b"-o", tmpname.as_bytes()];

                        let unzip_result = match spawn_sync::spawn(&spawn_sync::Options {
                            argv: build_argv(&unzip_argv),
                            envp: None,
                            cwd: Box::<[u8]>::from(&tmpdir_path_buf[..tmpdir_path_len]),
                            stdin: spawn_sync::SyncStdio::Inherit,
                            stdout: spawn_sync::SyncStdio::Inherit,
                            stderr: spawn_sync::SyncStdio::Inherit,
                            #[cfg(windows)]
                            windows: spawn_windows_options(),
                            ..Default::default()
                        }) {
                            Ok(Ok(r)) => r,
                            Ok(Err(err)) => {
                                let _ = sys::unlinkat(&save_dir, tmpname);
                                bun_core::pretty_errorln!(
                                    "<r><red>error:<r> Failed to spawn unzip due to {}.",
                                    bstr::BStr::new(err.name())
                                );
                                Global::exit(1);
                            }
                            Err(err) => {
                                let _ = sys::unlinkat(&save_dir, tmpname);
                                bun_core::pretty_errorln!(
                                    "<r><red>error:<r> Failed to spawn unzip due to {}.",
                                    err.name()
                                );
                                Global::exit(1);
                            }
                        };

                        match unzip_result.status {
                            Status::Exited(e) if e.code == 0 => {}
                            Status::Exited(e) => {
                                bun_core::pretty_errorln!(
                                    "<r><red>Unzip failed<r> (exit code: {})",
                                    e.code
                                );
                                let _ = sys::unlinkat(&save_dir, tmpname);
                                Global::exit(1);
                            }
                            other => {
                                bun_core::pretty_errorln!("<r><red>Unzip failed<r> ({})", other);
                                let _ = sys::unlinkat(&save_dir, tmpname);
                                Global::exit(1);
                            }
                        }
                    }
                    #[cfg(windows)]
                    {
                        // Run a powershell script to unzip the file
                        let mut unzip_script = Vec::new();
                        write!(
                        &mut unzip_script,
                        "$global:ProgressPreference='SilentlyContinue';Expand-Archive -Path \"{}\" \"{}\" -Force",
                        bun_fmt::escape_powershell(bstr::BStr::new(tmpname.as_bytes())),
                        bun_fmt::escape_powershell(bstr::BStr::new(&tmpdir_path_buf[..tmpdir_path_len])),
                    )
                    .expect("oom");

                        let mut buf = PathBuffer::uninit();
                        // Separate fallback buffer — borrowck holds `buf` for the lifetime
                        // of `which`'s returned `Option<&ZStr>` even across the `None` arm.
                        let mut buf2 = PathBuffer::uninit();
                        let powershell_path: &ZStr = match which(
                            &mut buf,
                            bun_core::env_var::PATH.get().unwrap_or(b""),
                            b"",
                            b"powershell",
                        ) {
                            Some(p) => p,
                            None => {
                                let system_root = bun_core::env_var::SYSTEMROOT
                                    .get()
                                    .unwrap_or(b"C:\\Windows");
                                let hardcoded_system_powershell = bun_paths::join_abs_string_buf_z::<
                                    bun_paths::platform::Windows,
                                >(
                                    system_root,
                                    &mut buf2[..],
                                    &[
                                        system_root,
                                        b"System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                                    ],
                                );
                                if !sys::exists(hardcoded_system_powershell.as_bytes()) {
                                    bun_core::pretty_errorln!(
                                        "<r><red>error:<r> Failed to unzip {} due to PowerShell not being installed.",
                                        bstr::BStr::new(tmpname.as_bytes())
                                    );
                                    Global::exit(1);
                                }
                                hardcoded_system_powershell
                            }
                        };

                        let unzip_argv: [&[u8]; 6] = [
                            powershell_path.as_bytes(),
                            b"-NoProfile",
                            b"-ExecutionPolicy",
                            b"Bypass",
                            b"-Command",
                            &unzip_script,
                        ];

                        let spawn_res = spawn_sync::spawn(&spawn_sync::Options {
                            argv: build_argv(&unzip_argv),
                            envp: None,
                            cwd: Box::<[u8]>::from(&tmpdir_path_buf[..tmpdir_path_len]),
                            stderr: spawn_sync::SyncStdio::Inherit,
                            stdout: spawn_sync::SyncStdio::Inherit,
                            stdin: spawn_sync::SyncStdio::Inherit,
                            #[cfg(windows)]
                            windows: spawn_windows_options(),
                            ..Default::default()
                        });
                        let spawn_res = match spawn_res {
                            Ok(r) => r,
                            Err(err) => {
                                bun_core::pretty_errorln!(
                                    "<r><red>error:<r> Failed to spawn Expand-Archive on {} due to error {}",
                                    bstr::BStr::new(tmpname.as_bytes()),
                                    err.name()
                                );
                                Global::exit(1);
                            }
                        };
                        if let Err(err) = spawn_res {
                            bun_core::pretty_errorln!(
                                "<r><red>error:<r> Failed to run Expand-Archive on {} due to error {}",
                                bstr::BStr::new(tmpname.as_bytes()),
                                bstr::BStr::new(err.name())
                            );
                            Global::exit(1);
                        }
                    }
                }
            }
            {
                let verify_argv: [&[u8]; 2] = [
                    exe,
                    if use_canary || is_pr {
                        b"--revision"
                    } else {
                        b"--version"
                    },
                ];

                // Diagnostic output is capped at 512 bytes by slicing the captured
                // stdout below (`..min(len, 512)`).
                let result: spawn_sync::Result = 'spawn: {
                    let spawned = spawn_sync::spawn(&spawn_sync::Options {
                        argv: build_argv(&verify_argv),
                        envp: None,
                        cwd: Box::<[u8]>::from(&tmpdir_path_buf[..tmpdir_path_len]),
                        stdout: spawn_sync::SyncStdio::Buffer,
                        stderr: spawn_sync::SyncStdio::Ignore,
                        stdin: spawn_sync::SyncStdio::Ignore,
                        #[cfg(windows)]
                        windows: spawn_windows_options(),
                        ..Default::default()
                    });
                    // Any spawn-time failure (allocator/OOM surfaces as
                    // `crate::Error`, posix_spawn surfaces as
                    // `bun_sys::Error`) → same diagnostic + cleanup.
                    let err_name: &'static [u8] = match spawned {
                        Ok(Ok(r)) => break 'spawn r,
                        Ok(Err(sys_err)) => sys_err.name(),
                        Err(core_err) => core_err.name().as_bytes(),
                    };

                    scopeguard::defer! {
                        let _ = save_dir_.delete_tree(&version_name);
                    }

                    // The spawn path may report a missing file as either
                    // `FileNotFound` or `ENOENT`; accept both.
                    if err_name == b"FileNotFound" || err_name == b"ENOENT" {
                        // We already chdir'd to tmpdir, so the relative `exe` path works.
                        if sys::exists(exe) {
                            // On systems like NixOS, the FileNotFound is actually the system-wide linker,
                            // as they do not have one (most systems have it at a known path). This is how
                            // ChildProcess returns FileNotFound despite the actual
                            //
                            // In these cases, prebuilt binaries from GitHub will never work without
                            // extra patching, so we will print a message deferring them to their system
                            // package manager.
                            bun_core::pretty_errorln!(
                                "<r><red>error<r><d>:<r> 'bun upgrade' is unsupported on systems without ld\n\nYou are likely on an immutable system such as NixOS, where dynamic\nlibraries are stored in a global cache.\n\nPlease use your system's package manager to properly upgrade bun.\n"
                            );
                            Global::exit(1);
                        }
                    }

                    bun_core::pretty_errorln!(
                        "<r><red>error<r><d>:<r> Failed to verify Bun (code: {})<r>",
                        bstr::BStr::new(err_name)
                    );
                    Global::exit(1);
                };

                if !result.status.is_ok() {
                    let _ = save_dir_.delete_tree(&version_name);
                    let exit_code: u32 = match &result.status {
                        Status::Exited(e) => u32::from(e.code),
                        Status::Signaled(sig) => 128 + u32::from(*sig),
                        _ => 1,
                    };
                    bun_core::pretty_errorln!(
                        "<r><red>error<r><d>:<r> failed to verify Bun<r> (exit code: {})",
                        exit_code
                    );
                    Global::exit(1);
                }

                // It should run successfully
                // but we don't care about the version number if we're doing a canary build
                if use_canary {
                    let version_string = result.stdout.as_slice();
                    if let Some(i) = strings::index_of_char(version_string, b'+') {
                        version.tag = version_string[(i as usize + 1)..].into();
                    }
                } else if is_pr {
                    // PR builds report an arbitrary in-development version;
                    // a successful exit is all the verification we can do.
                    pr_revision = Some(Box::<[u8]>::from(bun_core::trim(
                        result.stdout.as_slice(),
                        b" \n\r\t",
                    )));
                } else {
                    let mut version_string = result.stdout.as_slice();
                    if let Some(i) = strings::index_of_char(version_string, b' ') {
                        version_string = &version_string[..i as usize];
                    }

                    let trimmed = bun_core::trim(version_string, b" \n\r\t");
                    if trimmed != version_name.as_slice() {
                        let _ = save_dir_.delete_tree(&version_name);

                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: The downloaded version of Bun (<red>{}<r>) doesn't match the expected version (<b>{}<r>)<r>. Cancelled upgrade",
                            bstr::BStr::new(&version_string[..version_string.len().min(512)]),
                            bstr::BStr::new(&version_name)
                        );
                        Global::exit(1);
                    }
                }
            }

            // Keep the `&ZStr` form for Windows `sys::rename` (needs
            // a NUL-terminated path); `destination_executable` (bytes view) is
            // used everywhere else.
            #[cfg_attr(not(windows), allow(unused_variables))]
            let destination_executable_z: &ZStr = bun_core::self_exe_path()
                .map_err(|_| crate::Error::UpgradeFailedMissingExecutable)?;
            let destination_executable: &[u8] = destination_executable_z.as_bytes();
            // Reshaped for borrowck — use stack-local buffer.
            // Stacked Borrows: take ONE `*mut u8` over the buffer up front and
            // route every read/write through it. Indexing the `PathBuffer`
            // directly (via Deref/DerefMut) would materialize a fresh `&[u8]`
            // or `&mut [u8]` over the *whole* array, retagging it and
            // invalidating the raw-pointer-derived `&ZStr` views below. The
            // single `buf_ptr` is the shared provenance root.
            let mut current_executable_buf = PathBuffer::uninit();
            let buf_ptr: *mut u8 = current_executable_buf.as_mut_ptr();
            // SAFETY: `buf_ptr` covers `MAX_PATH_BYTES`; `destination_executable`
            // came from `self_exe_path()` which is bounded by that.
            unsafe {
                core::ptr::copy_nonoverlapping(
                    destination_executable.as_ptr(),
                    buf_ptr,
                    destination_executable.len(),
                );
                *buf_ptr.add(destination_executable.len()) = 0;
            }

            let target_filename_ = bun_paths::basename(destination_executable);
            // SAFETY: buf[destination_executable.len()] == 0 written above; the
            // view is derived from `buf_ptr` so later disjoint writes through
            // `buf_ptr` (at `target_dir_len`, outside this range) don't pop it.
            let target_filename = unsafe {
                ZStr::from_raw(
                    buf_ptr.add(destination_executable.len() - target_filename_.len()),
                    target_filename_.len(),
                )
            };
            let target_dir_ = bun_core::dirname(destination_executable)
                .ok_or(crate::Error::UpgradeFailedBecauseOfMissingExecutableDir)?;
            // safe because the slash will no longer be in use
            let target_dir_len = target_dir_.len();
            // SAFETY: in-bounds; write is at the separator byte between dirname
            // and basename, disjoint from both `&ZStr` views' ranges.
            unsafe { *buf_ptr.add(target_dir_len) = 0 };
            // SAFETY: buf[target_dir_len]==0 (just written). Derived from
            // `buf_ptr`; the Windows block below toggles the byte at
            // `target_dir_len` (outside `[0, target_dir_len)`) through the same
            // raw pointer, so this view's provenance stays valid across those
            // writes. Each mutation re-establishes the NUL before
            // `target_dirname` is read again.
            let target_dirname = unsafe { ZStr::from_raw(buf_ptr, target_dir_len) };
            let target_dir_it = match sys::Dir::open(target_dirname.as_bytes()) {
                Ok(d) => d,
                Err(err) => {
                    let _ = save_dir_.delete_tree(&version_name);
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Failed to open Bun's install directory {}",
                        bstr::BStr::new(err.name())
                    );
                    Global::exit(1);
                }
            };
            let target_dir: sys::Dir = target_dir_it;

            // `move_file_z` wants `&ZStr`; pre-compute a NUL-terminated
            // copy of `exe`.
            let mut exe_z_buf = PathBuffer::uninit();
            exe_z_buf[..exe.len()].copy_from_slice(exe);
            exe_z_buf[exe.len()] = 0;
            // SAFETY: NUL written above.
            let exe_z: &ZStr = ZStr::from_buf(&exe_z_buf[..], exe.len());

            if use_canary {
                // Check if the versions are the same
                let target_stat = match sys::fstatat(&target_dir, target_filename) {
                    Ok(s) => s,
                    Err(err) => {
                        let _ = save_dir_.delete_tree(&version_name);
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> {} while trying to stat target {} ",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(target_filename.as_bytes())
                        );
                        Global::exit(1);
                    }
                };

                let dest_stat = match sys::fstatat(&save_dir, exe_z) {
                    Ok(s) => s,
                    Err(err) => {
                        let _ = save_dir_.delete_tree(&version_name);
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> {} while trying to stat source {}",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(exe)
                        );
                        Global::exit(1);
                    }
                };

                if target_stat.st_size == dest_stat.st_size && target_stat.st_size > 0 {
                    let mut input_buf = vec![0u8; target_stat.st_size as usize];

                    let target_hash = hash(
                        match target_dir
                            .open_file(target_filename.as_bytes(), sys::O::RDONLY, 0)
                            .and_then(|f| {
                                let n = f.read_all(&mut input_buf);
                                let _ = f.close(); // close error is non-actionable
                                n
                            }) {
                            Ok(n) => &input_buf[..n],
                            Err(err) => {
                                let _ = save_dir_.delete_tree(&version_name);
                                bun_core::pretty_errorln!(
                                    "<r><red>error:<r> Failed to read target bun {}",
                                    bstr::BStr::new(err.name())
                                );
                                Global::exit(1);
                            }
                        },
                    );

                    let source_hash = hash(
                        match save_dir.open_file(exe, sys::O::RDONLY, 0).and_then(|f| {
                            let n = f.read_all(&mut input_buf);
                            let _ = f.close(); // close error is non-actionable
                            n
                        }) {
                            Ok(n) => &input_buf[..n],
                            Err(err) => {
                                let _ = save_dir_.delete_tree(&version_name);
                                bun_core::pretty_errorln!(
                                    "<r><red>error:<r> Failed to read source bun {}",
                                    bstr::BStr::new(err.name())
                                );
                                Global::exit(1);
                            }
                        },
                    );

                    if target_hash == source_hash {
                        let _ = save_dir_.delete_tree(&version_name);
                        bun_core::pretty_errorln!(
                            "<r><green>Congrats!<r> You're already on the latest <b>canary<r><green> build of Bun\n\nTo downgrade to the latest stable release, run <b><cyan>bun upgrade --stable<r>\n"
                        );
                        Global::exit(0);
                    }
                }
            }

            #[cfg(windows)]
            let mut outdated_filename: Option<bun_core::ZBox> = None;
            #[cfg(not(windows))]
            let outdated_filename: Option<()> = None;

            if env_loader.map.get(b"BUN_DRY_RUN").is_none() {
                #[cfg(windows)]
                {
                    // On Windows, we cannot replace the running executable directly.
                    // we rename the old executable to a temporary name, and then move the new executable to the old name.
                    // This is because Windows locks the executable while it's running.
                    // SAFETY: see `buf_ptr` note above — write through the shared
                    // raw provenance root, not via DerefMut (which would retag
                    // the whole buffer and invalidate `target_filename`/`target_dirname`).
                    unsafe { *buf_ptr.add(target_dir_len) = b'\\' };
                    let mut buf = Vec::new();
                    write!(
                        &mut buf,
                        "{}\\{}.outdated",
                        bstr::BStr::new(target_dirname.as_bytes()),
                        bstr::BStr::new(target_filename.as_bytes())
                    )
                    .expect("oom");
                    // Owned NUL-terminated string.
                    outdated_filename = Some(bun_core::ZBox::from_vec(buf));
                    if let Err(err) = sys::rename(
                        destination_executable_z,
                        outdated_filename.as_deref().unwrap(),
                    ) {
                        let _ = save_dir_.delete_tree(&version_name);
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> Failed to rename current executable {}",
                            bstr::BStr::new(err.name())
                        );
                        Global::exit(1);
                    }
                    // SAFETY: restore NUL via `buf_ptr` (see aliasing note above).
                    unsafe { *buf_ptr.add(target_dir_len) = 0 };
                }

                if let Err(err) =
                    sys::move_file_z(save_dir.fd(), exe_z, target_dir.fd(), target_filename)
                {
                    scopeguard::defer! {
                        let _ = save_dir_.delete_tree(&version_name);
                    }

                    #[cfg(windows)]
                    {
                        // Attempt to restore the old executable. If this fails, the user will be left without a working copy of bun.
                        if sys::rename(
                            outdated_filename.as_deref().unwrap(),
                            destination_executable_z,
                        )
                        .is_err()
                        {
                            Output::err_generic(
                                "Failed to move new version of Bun to {} due to {}",
                                (
                                    bstr::BStr::new(destination_executable),
                                    bstr::BStr::new(err.name()),
                                ),
                            );
                            Output::err_generic(
                                "Failed to restore the working copy of Bun. The installation is now corrupt.\n\nPlease reinstall Bun manually with the following command:\n   {}\n",
                                (Self::MANUAL_UPGRADE_COMMAND,),
                            );
                            Global::exit(1);
                        }
                    }

                    Output::err_generic(
                        "Failed to move new version of Bun to {} to {}\n\nPlease reinstall Bun manually with the following command:\n   {}\n",
                        (
                            bstr::BStr::new(destination_executable),
                            bstr::BStr::new(err.name()),
                            Self::MANUAL_UPGRADE_COMMAND,
                        ),
                    );
                    Global::exit(1);
                }
            }

            // Ensure completions are up to date.
            {
                let completions_argv: [&[u8]; 2] = [target_filename.as_bytes(), b"completions"];

                let _ = env_loader.map.put(b"IS_BUN_AUTO_UPDATE", b"true");
                // `spawn_sync` takes the C-style `[*:null]?[*:0]const u8` envp
                // directly, so build it from the DotEnv map. Output is buffered and
                // silently dropped along with any spawn error.
                if let Ok(envp) = env_loader.map.create_null_delimited_env_map() {
                    let _ = spawn_sync::spawn(&spawn_sync::Options {
                        argv: build_argv(&completions_argv),
                        envp: Some(envp.as_ptr().cast::<*const c_char>()),
                        cwd: Box::<[u8]>::from(target_dirname.as_bytes()),
                        stdout: spawn_sync::SyncStdio::Buffer,
                        stderr: spawn_sync::SyncStdio::Buffer,
                        stdin: spawn_sync::SyncStdio::Ignore,
                        #[cfg(windows)]
                        windows: spawn_windows_options(),
                        ..Default::default()
                    });
                }
            }

            Output::print_start_end(ctx.start_time, bun_core::time::nano_timestamp());

            if let Some(number) = pr_number {
                bun_core::pretty_errorln!(
                    "<r> Upgraded.\n\n<b><green>Installed a build of Bun from pull request #{}<r>\n\n     Title: <b>{}<r>\n  Revision: <b>{}<r>\n       PR: <cyan>https://github.com/oven-sh/bun/pull/{}<r>\n\nTo switch back to the latest stable release:\n\n  <b><cyan>bun upgrade<r>\n",
                    number,
                    bstr::BStr::new(pr_build_title.as_deref().unwrap_or(b"")),
                    bstr::BStr::new(pr_revision.as_deref().unwrap_or(b"unknown")),
                    number
                );
            } else if use_canary {
                bun_core::pretty_errorln!(
                    "<r> Upgraded.\n\n<b><green>Welcome to Bun's latest canary build!<r>\n\nReport any bugs:\n\n    https://github.com/oven-sh/bun/issues\n\nChangelog:\n\n    https://github.com/oven-sh/bun/compare/{}...{}\n",
                    Environment::GIT_SHA_SHORT,
                    bstr::BStr::new(&*version.tag)
                );
            } else {
                let bun_v = const_format::concatcp!("bun-v", Global::package_json_version);

                bun_core::pretty_errorln!(
                    "<r> Upgraded.\n\n<b><green>Welcome to Bun v{}!<r>\n\nWhat's new in Bun v{}:\n\n    <cyan>https://bun.com/blog/release-notes/{}<r>\n\nReport any bugs:\n\n    https://github.com/oven-sh/bun/issues\n\nCommit log:\n\n    https://github.com/oven-sh/bun/compare/{}...{}\n",
                    bstr::BStr::new(&version_name),
                    bstr::BStr::new(&version_name),
                    bstr::BStr::new(&*version.tag),
                    bun_v,
                    bstr::BStr::new(&*version.tag)
                );
            }

            Output::flush();

            #[cfg(windows)]
            {
                if let Some(to_remove) = outdated_filename {
                    // TODO: this file gets left on disk
                    //
                    // We should remove it, however we cannot remove an exe that is still running.
                    // A prior approach was to spawn a subprocess to remove the file, but that
                    // would open a terminal window, which steals user focus (even if minimized).
                    let _ = to_remove;
                }
            }
            #[cfg(not(windows))]
            {
                let _ = outdated_filename;
            }
        }

        Ok(())
    }

    // ──────────────────────────────────────────────────────────────────────
    // HTTP helpers

    /// Build the `Accept` (+ optional `Authorization`) headers for GitHub
    /// API requests, honoring `GITHUB_TOKEN` / `GITHUB_ACCESS_TOKEN`.
    fn github_api_headers(env_loader: &DotEnv::Loader) -> (headers::EntryList, &'static [u8]) {
        let mut headers_buf: Vec<u8> = Self::DEFAULT_GITHUB_HEADERS.to_vec();

        let mut header_entries: headers::EntryList = headers::EntryList::default();
        let accept = headers::Entry {
            name: HTTP::ETag::StringPointer {
                offset: 0,
                length: u32::try_from(b"Accept".len()).expect("int cast"),
            },
            value: HTTP::ETag::StringPointer {
                offset: u32::try_from(b"Accept".len()).expect("int cast"),
                length: u32::try_from(b"application/vnd.github.v3+json".len()).expect("int cast"),
            },
        };
        header_entries.append(accept).expect("oom");

        if let Some(access_token) = env_loader
            .map
            .get(b"GITHUB_TOKEN")
            .or_else(|| env_loader.map.get(b"GITHUB_ACCESS_TOKEN"))
        {
            if !access_token.is_empty() {
                let offset = u32::try_from(headers_buf.len()).expect("int cast");
                write!(
                    &mut headers_buf,
                    "AuthorizationBearer {}",
                    bstr::BStr::new(access_token),
                )
                .expect("oom");
                header_entries
                    .append(headers::Entry {
                        name: HTTP::ETag::StringPointer {
                            offset,
                            length: u32::try_from(b"Authorization".len()).expect("int cast"),
                        },
                        value: HTTP::ETag::StringPointer {
                            offset: offset
                                + u32::try_from(b"Authorization".len()).expect("int cast"),
                            length: u32::try_from(b"Bearer ".len() + access_token.len())
                                .expect("int cast"),
                        },
                    })
                    .expect("oom");
            }
        }

        (header_entries, crate::cli::cli_dupe(&headers_buf))
    }

    /// Synchronously GET `url_bytes`, following redirects. Returns the
    /// response body when the server answers 200.
    fn http_get_sync(
        env_loader: &mut DotEnv::Loader,
        url_bytes: &[u8],
        github_auth: bool,
    ) -> crate::Result<&'static [u8]> {
        // `AsyncHTTP::init_sync` wants `URL<'static>` / `&'static [u8]`; back
        // the buffers in the process-lifetime CLI arena.
        let url_buf: &'static [u8] = crate::cli::cli_dupe(url_bytes);
        let url = URL::parse(url_buf);

        let (header_entries, headers_buf) = if github_auth {
            Self::github_api_headers(env_loader)
        } else {
            (headers::EntryList::default(), &b""[..])
        };

        let http_proxy = env_loader.get_http_proxy_for(&url);

        let response_body: &'static mut MutableString =
            crate::cli::cli_arena().alloc(MutableString::init(2048)?);

        // ensure very stable memory address
        let mut async_http = Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            url,
            header_entries,
            headers_buf,
            std::ptr::from_mut::<MutableString>(response_body),
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        ));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        let response = async_http.send_sync()?;

        match response.status_code {
            200 => Ok(response_body.list.as_slice()),
            404 => Err(crate::Error::HTTP404),
            403 => Err(crate::Error::HTTPForbidden),
            429 => Err(crate::Error::HTTPTooManyRequests),
            // This helper also talks to non-GitHub hosts (Buildkite), so
            // only blame GitHub when the request actually went there.
            499..=599 if github_auth => Err(crate::Error::GitHubIsDown),
            499..=599 => Err(crate::Error::HTTPServerError),
            _ => Err(crate::Error::HTTPError),
        }
    }

    fn parse_json_response(bytes: &'static [u8]) -> Option<bun_ast::Expr> {
        let mut log = bun_ast::Log::init();
        let source = bun_ast::Source::init_path_string(b"response.json", bytes);
        bun_ast::initialize_store();
        let bump: &'static Bump = crate::cli::cli_arena();
        let expr = JSON::parse_utf8(&source, &mut log, bump).ok()?;
        if log.errors > 0 {
            return None;
        }
        Some(expr)
    }

    /// Owned copy of the string literal at `expr[name]`, if present.
    fn json_string_property(expr: &bun_ast::Expr, name: &[u8]) -> Option<Vec<u8>> {
        let query = expr.as_property(name)?;
        Some(query.expr.as_utf8_string_literal()?.to_vec())
    }

    /// `scheme://host[:port]` prefix of `url`, without any path/query/fragment.
    fn url_origin(url: &[u8]) -> &[u8] {
        let scheme_end = match strings::index_of(url, b"://") {
            Some(i) => i as usize + b"://".len(),
            None => 0,
        };
        let mut end = url.len();
        for (i, c) in url[scheme_end..].iter().enumerate() {
            if *c == b'/' || *c == b'?' || *c == b'#' {
                end = scheme_end + i;
                break;
            }
        }
        &url[..end]
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        use bun_sha_hmac::sha;
        let mut digest = [0u8; sha::SHA256::DIGEST];
        let mut hasher = sha::SHA256::init();
        hasher.update(bytes);
        hasher.r#final(&mut digest);
        bun_fmt::bytes_to_hex_lower_string(&digest)
    }

    fn sha1_hex(bytes: &[u8]) -> String {
        use bun_sha_hmac::sha;
        let mut digest = [0u8; sha::SHA1::DIGEST];
        let mut hasher = sha::SHA1::init();
        hasher.update(bytes);
        hasher.r#final(&mut digest);
        bun_fmt::bytes_to_hex_lower_string(&digest)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Delta upgrades

    const RELEASES_DOWNLOAD_BASE: &'static str = "https://github.com/oven-sh/bun/releases/download";

    /// Where `buildkite/bun` commit statuses are expected to point; builds
    /// anywhere else are not Bun's CI.
    const BUILDKITE_BUILDS_PREFIX: &'static str = "https://buildkite.com/bun/bun/builds/";

    /// zstd frame magic number — delta patches are zstd-compressed bsdiff
    /// streams. Raw bsdiff patches are accepted as well.
    const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

    /// Upper bound on the decompressed size of a delta patch, to reject
    /// pathological inputs (the raw bsdiff stream can exceed the size of the
    /// new binary, so this is intentionally generous).
    const MAX_PATCH_SIZE: usize = 2 * 1024 * 1024 * 1024;

    /// The release version this build was cut from, without the `-debug`
    /// suffix that debug builds append to `Bun.version`.
    fn current_release_version() -> &'static [u8] {
        let version = Global::package_json_version.as_bytes();
        version.strip_suffix(b"-debug").unwrap_or(version)
    }

    /// Base URL that release assets (delta patches and checksums) are
    /// downloaded from. Overridable so tests can serve fixtures.
    fn releases_download_base(env_loader: &DotEnv::Loader) -> Vec<u8> {
        let base: &[u8] = match env_loader.map.get(b"BUN_UPGRADE_TESTING_RELEASE_URL") {
            Some(url) if !url.is_empty() => url,
            _ => Self::RELEASES_DOWNLOAD_BASE.as_bytes(),
        };
        base.strip_suffix(b"/").unwrap_or(base).to_vec()
    }

    fn parse_version_component(digits: &[u8]) -> Option<u64> {
        if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        core::str::from_utf8(digits).ok()?.parse::<u64>().ok()
    }

    /// Parse a plain `major.minor.patch` version. Pre-release or build
    /// metadata (canary, debug, …) disqualifies a version from delta
    /// upgrades, so anything else returns `None`.
    fn parse_stable_version(bytes: &[u8]) -> Option<(u64, u64, u64)> {
        let mut parts = bytes.split(|c| *c == b'.');
        let major = Self::parse_version_component(parts.next()?)?;
        let minor = Self::parse_version_component(parts.next()?)?;
        let patch = Self::parse_version_component(parts.next()?)?;
        if parts.next().is_some() {
            return None;
        }
        Some((major, minor, patch))
    }

    /// Build the chain of consecutive `(from, to)` versions between
    /// `current` and `target`. Each release publishes a delta patch from its
    /// immediate predecessor, so multi-step upgrades chain patches:
    /// 1.2.10 -> 1.2.12 applies the 1.2.10->1.2.11 patch, then the
    /// 1.2.11->1.2.12 patch.
    ///
    /// Supports same-minor patch chains and a single minor-version jump
    /// (e.g. 1.2.13 -> 1.3.0 -> 1.3.1); capped at 3 steps. Returns an empty
    /// chain when the versions aren't eligible for delta upgrade.
    fn build_delta_chain(current: &[u8], target: &[u8]) -> Vec<(Vec<u8>, Vec<u8>)> {
        let Some((current_major, current_minor, current_patch)) =
            Self::parse_stable_version(current)
        else {
            return Vec::new();
        };
        let Some((target_major, target_minor, target_patch)) = Self::parse_stable_version(target)
        else {
            return Vec::new();
        };
        if current_major != target_major {
            return Vec::new();
        }

        fn format_version(major: u64, minor: u64, patch: u64) -> Vec<u8> {
            let mut out = Vec::new();
            write!(&mut out, "{}.{}.{}", major, minor, patch).expect("oom");
            out
        }

        let mut chain = Vec::new();

        if current_minor == target_minor {
            // Same minor: chain through consecutive patch versions.
            let diff = target_patch.saturating_sub(current_patch);
            if diff == 0 || diff > 3 {
                return Vec::new();
            }
            for i in 0..diff {
                chain.push((
                    format_version(current_major, current_minor, current_patch + i),
                    format_version(current_major, current_minor, current_patch + i + 1),
                ));
            }
        } else if target_minor == current_minor + 1 {
            // Cross-minor: the first step jumps to target_minor.0, the rest
            // chain through its patch versions.
            chain.push((
                current.to_vec(),
                format_version(target_major, target_minor, 0),
            ));
            for i in 0..target_patch {
                chain.push((
                    format_version(target_major, target_minor, i),
                    format_version(target_major, target_minor, i + 1),
                ));
            }
            if chain.len() > 3 {
                return Vec::new();
            }
        }

        chain
    }

    /// Parse the `<hex sha256>  <filename>` format of `.sha256sum` release
    /// assets (a bare hash is accepted too).
    fn parse_sha256sum(body: &[u8]) -> Option<Vec<u8>> {
        let hash = body
            .split(|c: &u8| c.is_ascii_whitespace())
            .find(|token| !token.is_empty())?;
        if hash.len() != 64 || !hash.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        Some(hash.to_ascii_lowercase())
    }

    /// Apply a delta patch (zstd-compressed bsdiff stream) to `old`,
    /// producing the new binary.
    pub(crate) fn apply_delta_patch(
        old: &[u8],
        patch_data: &[u8],
    ) -> Result<Vec<u8>, &'static str> {
        let decompressed;
        let raw_patch: &[u8] = if patch_data.starts_with(&Self::ZSTD_MAGIC) {
            if bun_zstd::get_decompressed_size(patch_data) > Self::MAX_PATCH_SIZE {
                return Err("patch is too large");
            }
            decompressed =
                bun_zstd::decompress_alloc(patch_data).map_err(|_| "failed to decompress patch")?;
            if decompressed.len() > Self::MAX_PATCH_SIZE {
                return Err("patch is too large");
            }
            &decompressed
        } else {
            patch_data
        };

        let mut new = Vec::new();
        let mut reader = raw_patch;
        bsdiff::patch(old, &mut reader, &mut new).map_err(|_| "patch did not apply")?;
        if new.is_empty() {
            return Err("patch produced an empty file");
        }
        Ok(new)
    }

    /// Create a delta patch that transforms `old` into `new` — the inverse
    /// of [`Self::apply_delta_patch`]. Used by the release tooling (via
    /// `bun:internal-for-testing`) to publish patch assets.
    pub(crate) fn create_delta_patch(old: &[u8], new: &[u8]) -> Result<Vec<u8>, &'static str> {
        let mut raw = Vec::new();
        bsdiff::diff(old, new, &mut raw).map_err(|_| "failed to compute binary diff")?;

        let mut compressed = vec![0u8; bun_zstd::compress_bound(raw.len())];
        match bun_zstd::compress(&mut compressed, &raw, Some(19)) {
            bun_zstd::Result::Success(size) => {
                compressed.truncate(size);
                Ok(compressed)
            }
            _ => Err("failed to compress binary diff"),
        }
    }

    /// Fetch `<url>.sha256sum` and return the expected hash, if valid.
    fn fetch_sha256(env_loader: &mut DotEnv::Loader, url: &[u8]) -> Option<Vec<u8>> {
        let mut checksum_url = url.to_vec();
        checksum_url.extend_from_slice(b".sha256sum");
        Self::parse_sha256sum(Self::http_get_sync(env_loader, &checksum_url, false).ok()?)
    }

    /// Attempt to reconstruct the target release's binary by downloading and
    /// applying bsdiff patches between consecutive releases, instead of
    /// downloading the whole archive.
    ///
    /// Tries the direct `target.from-current` patch first (each release
    /// publishes a patch from its immediate predecessor, which covers the
    /// common "one release behind" case even when version numbers were
    /// skipped), then falls back to chaining per-version patches. Returns
    /// `None` on any failure so the caller downloads the full archive.
    fn try_delta_upgrade(
        env_loader: &mut DotEnv::Loader,
        target_version: &[u8],
        full_download_size: u32,
    ) -> Option<Vec<u8>> {
        let current_version = Self::current_release_version();

        let chain = Self::build_delta_chain(current_version, target_version);
        if chain.is_empty() {
            return None;
        }

        let base = Self::releases_download_base(env_loader);

        // Verify the on-disk binary matches its release checksum before
        // patching anything; modified binaries can't be patched. Releases
        // that predate delta support have no checksum asset, so failures
        // here are silent.
        let expected_current = {
            let mut url = Vec::new();
            write!(
                &mut url,
                "{}/bun-v{}/{}",
                bstr::BStr::new(&base),
                bstr::BStr::new(current_version),
                Version::FOLDER_NAME,
            )
            .expect("oom");
            Self::fetch_sha256(env_loader, &url)?
        };

        let current_exe = bun_core::self_exe_path().ok()?;
        let mut original: Vec<u8> = sys::File::open(current_exe, sys::O::RDONLY, 0)
            .and_then(|file| file.read_to_end())
            .ok()?;
        if Self::sha256_hex(&original).as_bytes() != expected_current {
            return None;
        }

        let mut candidates: Vec<Vec<(Vec<u8>, Vec<u8>)>> =
            vec![vec![(current_version.to_vec(), target_version.to_vec())]];
        if chain.len() > 1 {
            candidates.push(chain);
        }

        bun_core::pretty_errorln!("<r><d>Attempting delta upgrade<r>");
        Output::flush();

        let candidate_count = candidates.len();
        'candidates: for (candidate, chain) in candidates.iter().enumerate() {
            // The last candidate can take the buffer instead of copying it.
            let mut binary = if candidate + 1 == candidate_count {
                core::mem::take(&mut original)
            } else {
                original.clone()
            };
            let mut downloaded: usize = 0;
            let total_steps = chain.len();

            for (step, (from, to)) in chain.iter().enumerate() {
                let mut patch_url = Vec::new();
                write!(
                    &mut patch_url,
                    "{}/bun-v{}/{}.from-{}.bsdiff",
                    bstr::BStr::new(&base),
                    bstr::BStr::new(to),
                    Version::FOLDER_NAME,
                    bstr::BStr::new(from),
                )
                .expect("oom");

                bun_core::pretty_errorln!(
                    "<r><d>Downloading patch {}/{} (v{} -> v{})<r>",
                    step + 1,
                    total_steps,
                    bstr::BStr::new(from),
                    bstr::BStr::new(to),
                );
                Output::flush();

                let Ok(patch) = Self::http_get_sync(env_loader, &patch_url, false) else {
                    continue 'candidates;
                };
                downloaded += patch.len();

                let Some(expected_patch) = Self::fetch_sha256(env_loader, &patch_url) else {
                    continue 'candidates;
                };
                if Self::sha256_hex(patch).as_bytes() != expected_patch {
                    continue 'candidates;
                }

                binary = match Self::apply_delta_patch(&binary, patch) {
                    Ok(patched) => patched,
                    Err(_) => continue 'candidates,
                };

                let expected_binary = {
                    let mut url = Vec::new();
                    write!(
                        &mut url,
                        "{}/bun-v{}/{}",
                        bstr::BStr::new(&base),
                        bstr::BStr::new(to),
                        Version::FOLDER_NAME,
                    )
                    .expect("oom");
                    let Some(expected) = Self::fetch_sha256(env_loader, &url) else {
                        continue 'candidates;
                    };
                    expected
                };
                if Self::sha256_hex(&binary).as_bytes() != expected_binary {
                    continue 'candidates;
                }
            }

            if full_download_size > 0 {
                bun_core::pretty_errorln!(
                    "<r><green>Delta upgrade verified<r> <d>— downloaded {} instead of {}<r>",
                    bun_fmt::bytes(downloaded),
                    bun_fmt::bytes(full_download_size as usize),
                );
            } else {
                bun_core::pretty_errorln!(
                    "<r><green>Delta upgrade verified<r> <d>— downloaded {}<r>",
                    bun_fmt::bytes(downloaded),
                );
            }
            Output::flush();

            return Some(binary);
        }

        bun_core::pretty_errorln!(
            "<r><d>Delta upgrade unavailable, downloading the full release<r>"
        );
        Output::flush();
        None
    }

    // ──────────────────────────────────────────────────────────────────────
    // Installing builds from pull requests

    /// Locate the Buildkite build for a pull request's latest commit and
    /// resolve the download URL of this platform's build artifact.
    ///
    /// PR builds are uploaded as public Buildkite artifacts, so — unlike
    /// GitHub Actions artifacts — no authentication is needed. The build is
    /// discovered through the `buildkite/bun` commit status, and artifacts
    /// are listed via Buildkite's browser-facing JSON endpoints.
    fn fetch_pr_build(
        env_loader: &mut DotEnv::Loader,
        pr_number: u64,
        use_profile: bool,
    ) -> crate::Result<PrBuild> {
        // Incase they're using a GitHub proxy in e.g. China
        let api_domain: Vec<u8> = match env_loader.map.get(b"GITHUB_API_DOMAIN") {
            Some(domain) if !domain.is_empty() => domain.to_vec(),
            _ => b"api.github.com".to_vec(),
        };

        bun_core::pretty_errorln!(
            "<r><d>Looking up pull request <b>#{}<r><d>...<r>",
            pr_number
        );
        Output::flush();

        let pull_body = {
            let mut url = Vec::new();
            write!(
                &mut url,
                "https://{}/repos/oven-sh/bun/pulls/{}",
                bstr::BStr::new(&api_domain),
                pr_number,
            )
            .expect("oom");
            match Self::http_get_sync(env_loader, &url, true) {
                Ok(body) => body,
                Err(crate::Error::HTTP404) => {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Pull request <b>#{}<r> was not found in oven-sh/bun",
                        pr_number
                    );
                    Global::exit(1);
                }
                Err(err) => {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Failed to look up pull request #{} (code: {})",
                        pr_number,
                        err.name()
                    );
                    Global::exit(1);
                }
            }
        };
        let Some(pull) = Self::parse_json_response(pull_body) else {
            bun_core::pretty_errorln!(
                "<r><red>error:<r> Failed to parse the GitHub API response for PR #{}",
                pr_number
            );
            Global::exit(1);
        };

        let title: Box<[u8]> = Self::json_string_property(&pull, b"title")
            .unwrap_or_default()
            .into();
        let state: Vec<u8> =
            Self::json_string_property(&pull, b"state").unwrap_or_else(|| b"unknown".to_vec());
        let Some(head_sha) = pull
            .as_property(b"head")
            .and_then(|p| Self::json_string_property(&p.expr, b"sha"))
        else {
            bun_core::pretty_errorln!(
                "<r><red>error:<r> The GitHub API response for PR #{} is missing the head commit",
                pr_number
            );
            Global::exit(1);
        };

        bun_core::pretty_errorln!(
            "<r>PR <b>#{}<r><d>:<r> {} <d>({})<r>",
            pr_number,
            bstr::BStr::new(&title),
            bstr::BStr::new(&state),
        );
        Output::flush();

        // Find the Buildkite build for the latest commit through its commit
        // status.
        let statuses_body = {
            let mut url = Vec::new();
            write!(
                &mut url,
                "https://{}/repos/oven-sh/bun/commits/{}/statuses?per_page=100",
                bstr::BStr::new(&api_domain),
                bstr::BStr::new(&head_sha),
            )
            .expect("oom");
            match Self::http_get_sync(env_loader, &url, true) {
                Ok(body) => body,
                Err(err) => {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Failed to fetch the CI statuses for PR #{} (code: {})",
                        pr_number,
                        err.name()
                    );
                    Global::exit(1);
                }
            }
        };

        // Only follow links into Bun's own Buildkite pipeline: a status whose
        // target points anywhere else is not the CI build (fail closed).
        let allowed_build_prefix: Vec<u8> =
            match env_loader.map.get(b"BUN_UPGRADE_TESTING_BUILDKITE_URL") {
                Some(url) if !url.is_empty() => url.to_vec(),
                _ => Self::BUILDKITE_BUILDS_PREFIX.as_bytes().to_vec(),
            };

        let mut build_url: Option<Vec<u8>> = None;
        if let Some(statuses) = Self::parse_json_response(statuses_body) {
            if let Some(statuses) = statuses.data.e_array() {
                // Statuses are listed newest-first; take the most recent
                // Buildkite build.
                for status in statuses.items.slice() {
                    let Some(context) = Self::json_string_property(status, b"context") else {
                        continue;
                    };
                    if context != b"buildkite/bun" {
                        continue;
                    }
                    if let Some(target_url) = Self::json_string_property(status, b"target_url") {
                        if strings::starts_with(&target_url, &allowed_build_prefix) {
                            build_url = Some(target_url);
                            break;
                        }
                    }
                }
            }
        }
        let Some(build_url_owned) = build_url else {
            bun_core::pretty_errorln!(
                "<r><red>error:<r> No CI build was found for the latest commit of PR <b>#{}<r>.\n\nCI may not have started yet:\n\n  <cyan>https://github.com/oven-sh/bun/pull/{}<r>\n",
                pr_number,
                pr_number
            );
            Global::exit(1);
        };
        let mut build_url: &[u8] = &build_url_owned;
        if let Some(i) = build_url.iter().position(|c| *c == b'#' || *c == b'?') {
            build_url = &build_url[..i];
        }
        let build_url = build_url.strip_suffix(b"/").unwrap_or(build_url);
        let origin: Vec<u8> = Self::url_origin(build_url).to_vec();

        bun_core::pretty_errorln!("<r><d>Finding build artifacts...<r>");
        Output::flush();

        let build_body = {
            let mut url = build_url.to_vec();
            url.extend_from_slice(b".json");
            match Self::http_get_sync(env_loader, &url, false) {
                Ok(body) => body,
                Err(err) => {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> Failed to fetch the CI build for PR #{} (code: {})",
                        pr_number,
                        err.name()
                    );
                    Global::exit(1);
                }
            }
        };
        let Some(build) = Self::parse_json_response(build_body) else {
            bun_core::pretty_errorln!(
                "<r><red>error:<r> Failed to parse the CI build info for PR #{}",
                pr_number
            );
            Global::exit(1);
        };

        let jobs_prop = build.as_property(b"jobs");
        let jobs_array = jobs_prop.and_then(|p| p.expr.data.e_array());
        let mut jobs: &[bun_ast::Expr] = match &jobs_array {
            Some(array) => array.items.slice(),
            None => &[],
        };

        // Buildkite's frontend stopped inlining jobs in the build response;
        // fall back to the paginated jobs endpoint.
        let fallback_jobs_array;
        if jobs.is_empty() {
            let mut url = build_url.to_vec();
            url.extend_from_slice(b"/data/jobs");
            fallback_jobs_array = Self::http_get_sync(env_loader, &url, false)
                .ok()
                .and_then(Self::parse_json_response)
                .and_then(|expr| expr.as_property(b"records"))
                .and_then(|p| p.expr.data.e_array());
            if let Some(array) = &fallback_jobs_array {
                jobs = array.items.slice();
            }
        }

        let artifact_name: &[u8] = if use_profile {
            Version::PROFILE_ZIP_FILENAME.as_bytes()
        } else {
            Version::ZIP_FILENAME.as_bytes()
        };

        for job in jobs {
            let Some(step_key) = Self::json_string_property(job, b"step_key") else {
                continue;
            };
            if !strings::contains(&step_key, b"build-bun") {
                continue;
            }
            let Some(base_path) = Self::json_string_property(job, b"base_path") else {
                continue;
            };
            if base_path.is_empty() {
                continue;
            }

            let mut artifacts_url = origin.clone();
            artifacts_url.extend_from_slice(&base_path);
            artifacts_url.extend_from_slice(b"/artifacts");
            let Ok(artifacts_body) = Self::http_get_sync(env_loader, &artifacts_url, false) else {
                continue;
            };
            let Some(artifacts) = Self::parse_json_response(artifacts_body) else {
                continue;
            };
            let Some(artifacts) = artifacts.data.e_array() else {
                continue;
            };

            for artifact in artifacts.items.slice() {
                let Some(file_name) = Self::json_string_property(artifact, b"file_name") else {
                    continue;
                };
                if file_name != artifact_name {
                    continue;
                }
                let Some(artifact_url) = Self::json_string_property(artifact, b"url") else {
                    continue;
                };
                if artifact_url.is_empty() {
                    continue;
                }

                let zip_url: Vec<u8> = if strings::has_prefix_comptime(&artifact_url, b"http") {
                    // An absolute artifact URL must stay on the build's own
                    // origin; anything else doesn't belong to this CI build.
                    // Compare origins exactly (a prefix check would accept
                    // lookalike hosts such as `https://example.com.evil`).
                    if Self::url_origin(&artifact_url) != origin.as_slice() {
                        continue;
                    }
                    artifact_url
                } else {
                    // Always followed by `return`, so `origin` can be taken.
                    let mut absolute = origin;
                    absolute.extend_from_slice(&artifact_url);
                    absolute
                };

                // Buildkite records checksums for every artifact; refuse to
                // install one that can't be verified after download.
                let zip_checksum = Self::json_string_property(artifact, b"sha256sum")
                    .filter(|hash| hash.len() == 64 && hash.iter().all(u8::is_ascii_hexdigit))
                    .map(|hash| PrArtifactChecksum::Sha256(hash.to_ascii_lowercase().into()))
                    .or_else(|| {
                        Self::json_string_property(artifact, b"sha1sum")
                            .filter(|hash| {
                                hash.len() == 40 && hash.iter().all(u8::is_ascii_hexdigit)
                            })
                            .map(|hash| PrArtifactChecksum::Sha1(hash.to_ascii_lowercase().into()))
                    });
                let Some(zip_checksum) = zip_checksum else {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> The <b>{}<r> artifact for PR <b>#{}<r> has no usable checksum; refusing to install it.",
                        bstr::BStr::new(&file_name),
                        pr_number,
                    );
                    Global::exit(1);
                };

                let mut tag = Vec::new();
                write!(&mut tag, "pr-{}", pr_number).expect("oom");

                return Ok(PrBuild {
                    version: Version {
                        tag: tag.into(),
                        zip_url: zip_url.into(),
                        size: 0,
                        buf: MutableString::init_empty(),
                        // CI artifacts are verified against the checksum
                        // Buildkite records for them, not a release digest.
                        digest: Integrity::default(),
                    },
                    title,
                    zip_checksum,
                });
            }
        }

        bun_core::pretty_errorln!(
            "<r><red>error:<r> Could not find a <b>{}<r> build artifact for PR <b>#{}<r>.\n\nThe build may still be running, or this platform isn't built in PR CI:\n\n  <cyan>{}<r>\n",
            bstr::BStr::new(artifact_name),
            pr_number,
            bstr::BStr::new(build_url),
        );
        Global::exit(1);
    }
}

/// A pull request's build artifact, resolved by [`UpgradeCommand::fetch_pr_build`].
struct PrBuild {
    version: Version,
    title: Box<[u8]>,
    /// Buildkite's recorded checksum of the artifact.
    zip_checksum: PrArtifactChecksum,
}

/// Buildkite's recorded checksum of a build artifact, as a lowercase hex
/// string. Newer responses carry sha256; older ones only sha1.
enum PrArtifactChecksum {
    Sha256(Box<[u8]>),
    Sha1(Box<[u8]>),
}

// ──────────────────────────────────────────────────────────────────────────

pub mod upgrade_js_bindings {
    use super::*;

    // Process-global, not threadlocal: if open/close are invoked from different
    // threads (main vs worker VM) a `thread_local!` would make the close see
    // `None` and leak the HANDLE. Use a `RacyCell`; access is test-only and
    // effectively single-threaded.
    #[cfg(windows)]
    static TEMPDIR_FD: bun_core::RacyCell<Option<sys::Fd>> = bun_core::RacyCell::new(None);

    pub fn generate(global: &JSGlobalObject) -> JSValue {
        let obj = JSValue::create_empty_object(global, 4);
        obj.put(
            global,
            b"openTempDirWithoutSharingDelete",
            jsc::JSFunction::create(
                global,
                b"openTempDirWithoutSharingDelete",
                // `#[bun_jsc::host_fn]` emits the C-ABI shim with a
                // `__jsc_host_` prefix.
                __jsc_host_js_open_temp_dir_without_sharing_delete,
                1,
                Default::default(),
            ),
        );
        obj.put(
            global,
            b"closeTempDirHandle",
            jsc::JSFunction::create(
                global,
                b"closeTempDirHandle",
                __jsc_host_js_close_temp_dir_handle,
                1,
                Default::default(),
            ),
        );
        obj.put(
            global,
            b"createDeltaPatch",
            jsc::JSFunction::create(
                global,
                b"createDeltaPatch",
                __jsc_host_js_create_delta_patch,
                2,
                Default::default(),
            ),
        );
        obj.put(
            global,
            b"applyDeltaPatch",
            jsc::JSFunction::create(
                global,
                b"applyDeltaPatch",
                __jsc_host_js_apply_delta_patch,
                2,
                Default::default(),
            ),
        );
        obj
    }

    fn delta_patch_arguments(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<(crate::node::StringOrBuffer, crate::node::StringOrBuffer)> {
        let arguments = frame.arguments();
        let (Some(first), Some(second)) = (arguments.first(), arguments.get(1)) else {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected two buffer arguments"))
            );
        };
        let (Some(first), Some(second)) = (
            crate::node::StringOrBuffer::from_js(global, *first)?,
            crate::node::StringOrBuffer::from_js(global, *second)?,
        ) else {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected two buffer arguments"))
            );
        };
        Ok((first, second))
    }

    /// Create a delta patch transforming `old` into `new` — the format that
    /// `bun upgrade` downloads from release assets. Used by the release
    /// tooling to publish patches, and by tests.
    #[bun_jsc::host_fn]
    pub(crate) fn js_create_delta_patch(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let (old, new) = delta_patch_arguments(global, frame)?;
        match UpgradeCommand::create_delta_patch(old.slice(), new.slice()) {
            Ok(patch) => Ok(JSValue::create_buffer(global, patch.leak())),
            Err(message) => Err(global
                .err(jsc::ErrCode::INVALID_ARG_VALUE, format_args!("{}", message))
                .throw()),
        }
    }

    /// Apply a delta patch created by `createDeltaPatch`.
    #[bun_jsc::host_fn]
    pub(crate) fn js_apply_delta_patch(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let (old, patch) = delta_patch_arguments(global, frame)?;
        match UpgradeCommand::apply_delta_patch(old.slice(), patch.slice()) {
            Ok(new) => Ok(JSValue::create_buffer(global, new.leak())),
            Err(message) => Err(global
                .err(jsc::ErrCode::INVALID_ARG_VALUE, format_args!("{}", message))
                .throw()),
        }
    }

    /// For testing upgrades when the temp directory has an open handle without FILE_SHARE_DELETE.
    /// Windows only
    #[bun_jsc::host_fn]
    pub(crate) fn js_open_temp_dir_without_sharing_delete(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            use sys::windows as w;

            let mut buf = bun_paths::WPathBuffer::uninit();
            let tmpdir_path = fs::RealFS::get_default_temp_dir();
            let mut wtmp = bun_paths::WPathBuffer::uninit();
            let tmpdir_w = bun_core::convert_utf8_to_utf16_in_buffer(&mut wtmp[..], tmpdir_path);
            let path = match sys::normalize_path_windows(sys::Fd::INVALID, tmpdir_w, &mut buf[..]) {
                sys::Result::Err(_) => return Ok(JSValue::UNDEFINED),
                sys::Result::Ok(norm) => norm,
            };

            let path_len_bytes: u16 = (path.len() * 2) as u16;
            let mut nt_name = w::UNICODE_STRING {
                Length: path_len_bytes,
                MaximumLength: path_len_bytes,
                Buffer: path.as_ptr().cast_mut().cast::<u16>(),
            };

            let mut attr = w::OBJECT_ATTRIBUTES {
                Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
                RootDirectory: core::ptr::null_mut(),
                Attributes: 0,
                ObjectName: &mut nt_name,
                SecurityDescriptor: core::ptr::null_mut(),
                SecurityQualityOfService: core::ptr::null_mut(),
            };

            let flags: u32 = w::STANDARD_RIGHTS_READ
                | w::FILE_READ_ATTRIBUTES
                | w::FILE_READ_EA
                | w::SYNCHRONIZE
                | w::FILE_TRAVERSE;

            let mut fd: w::HANDLE = w::INVALID_HANDLE_VALUE;
            let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();

            // SAFETY: FFI call to NtCreateFile with valid pointers
            let rc = unsafe {
                w::ntdll::NtCreateFile(
                    &mut fd,
                    flags,
                    &mut attr,
                    &mut io,
                    core::ptr::null_mut(),
                    0,
                    w::FILE_SHARE_READ | w::FILE_SHARE_WRITE,
                    w::FILE_OPEN,
                    w::FILE_DIRECTORY_FILE
                        | w::FILE_SYNCHRONOUS_IO_NONALERT
                        | w::FILE_OPEN_FOR_BACKUP_INTENT,
                    core::ptr::null_mut(),
                    0,
                )
            };

            match sys::windows::Win32Error::from_nt_status(rc) {
                sys::windows::Win32Error::SUCCESS => {
                    // System-kind handle on Windows.
                    // SAFETY: test-only helper; access is single-threaded (JS thread).
                    unsafe {
                        TEMPDIR_FD.write(Some(sys::Fd::from_system(fd)));
                    }
                }
                _ => {}
            }

            Ok(JSValue::UNDEFINED)
        }
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_close_temp_dir_handle(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            use bun_sys::FdExt as _;
            // SAFETY: test-only helper; access is single-threaded (JS thread).
            // Consume (`take`) the stored fd so a repeat call cannot
            // `CloseHandle` a stale, possibly-reissued HANDLE value.
            if let Some(fd) = unsafe { core::mem::take(&mut *TEMPDIR_FD.get()) } {
                fd.close();
            }

            Ok(JSValue::UNDEFINED)
        }
    }
}

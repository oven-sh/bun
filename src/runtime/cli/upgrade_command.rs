use bun_collections::VecExt;
use core::ffi::c_char;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_alloc::Arena as Bump;
use bun_core::Global::SyncCStr;
use bun_core::MutableString;
#[allow(unused_imports)]
use bun_core::ZigString;
use bun_core::{self, Environment, Global, Output, Progress, env_var, fmt as bun_fmt};
use bun_core::{ZStr, strings};
use bun_dotenv as DotEnv;
use bun_http::{self as HTTP, headers};
use bun_js_parser as js_ast;
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

// PORT NOTE: `sync::Options.argv` is `Vec<Box<[u8]>>` (owns its rows). Helper
// to build it from borrowed slices — Zig was `&.{...}` of `[]const u8`.
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

// PORT NOTE: `bun_resolver::fs::FileSystem` (the inline canonical type surface
// in `resolver/lib.rs`) does not yet expose `tmpdir()`; the full impl lives in
// the un-exported `fs_full` module. Shim it locally — open
// `RealFS::tmpdir_path()` as a `sys::Dir`, mirroring `RealFS::open_tmp_dir`.
pub trait FileSystemTmpdirExt {
    fn tmpdir(&mut self) -> Result<sys::Dir, bun_core::Error>;
}
impl FileSystemTmpdirExt for fs::FileSystem {
    fn tmpdir(&mut self) -> Result<sys::Dir, bun_core::Error> {
        sys::open_dir_absolute(fs::RealFS::tmpdir_path())
            .map(sys::Dir::from_fd)
            .map_err(Into::into)
    }
}

// PORT NOTE: `bun.argv` is an `Argv` newtype (not `&[&[u8]]`), so
// `strings::contains_any` can't take it directly. Local helper that scans the
// process argv for an exact match — same semantics as Zig's
// `strings.containsAny(bun.argv, ..)`.
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
    const SUFFIX_CPU: &'static str = if Environment::BASELINE {
        "-baseline"
    } else {
        ""
    };
    const SUFFIX: &'static str = const_format::concatcp!(Version::SUFFIX_ABI, Version::SUFFIX_CPU);
    pub const FOLDER_NAME: &'static str =
        const_format::concatcp!("bun-", Version::TRIPLET, Version::SUFFIX);
    pub const BASELINE_FOLDER_NAME: &'static str =
        const_format::concatcp!("bun-", Version::TRIPLET, "-baseline");
    pub const ZIP_FILENAME: &'static str = const_format::concatcp!(Version::FOLDER_NAME, ".zip");
    pub const BASELINE_ZIP_FILENAME: &'static str =
        const_format::concatcp!(Version::BASELINE_FOLDER_NAME, ".zip");

    pub const PROFILE_FOLDER_NAME: &'static str =
        const_format::concatcp!("bun-", Version::TRIPLET, Version::SUFFIX, "-profile");
    pub const PROFILE_ZIP_FILENAME: &'static str =
        const_format::concatcp!(Version::PROFILE_FOLDER_NAME, ".zip");

    const CURRENT_VERSION: &'static str =
        const_format::concatcp!("bun-v", Global::package_json_version);

    pub const BUN__GITHUB_BASELINE_URL: &'static ZStr = {
        const S: &str = const_format::concatcp!(
            "https://github.com/oven-sh/bun/releases/download/bun-v",
            Global::package_json_version,
            "/",
            Version::BASELINE_ZIP_FILENAME,
            "\0"
        );
        ZStr::from_static(S.as_bytes())
    };

    pub fn is_current(&self) -> bool {
        &*self.tag == Self::CURRENT_VERSION.as_bytes()
    }

    pub fn export() {
        // force-reference — drop in Rust (linker keeps #[no_mangle])
    }
}

// Exported C symbol — null-terminated
// PORT NOTE: moved out of `impl Version` — Rust impl blocks cannot hold `static` items.
// `*const c_char` is `!Sync`, so wrap in the `#[repr(transparent)]` `SyncCStr` newtype
// (same pattern as `Bun__userAgent` in bun_core::Global) so the C++ side still sees a
// single `const char*`-sized symbol.
#[unsafe(no_mangle)]
pub static Bun__githubURL: SyncCStr = SyncCStr(
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
    pub const BUN__GITHUB_BASELINE_URL: &'static ZStr = Version::BUN__GITHUB_BASELINE_URL;

    const DEFAULT_GITHUB_HEADERS: &'static [u8] = b"Acceptapplication/vnd.github.v3+json";

    // PORT NOTE: Zig declared module-level `var` PathBuffers (github_repository_url_buf,
    // current_executable_buf, unzip_path_buf, tmpdir_path_buf). They are single-use scratch
    // space; the port uses stack-local `PathBuffer::uninit()` at each call site instead
    // (reshaped for borrowck). No global state needed.

    pub fn get_latest_version<const SILENT: bool>(
        env_loader: &mut DotEnv::Loader,
        refresher: Option<&mut Progress::Progress>,
        mut progress: Option<&mut Progress::Node>,
        use_profile: bool,
    ) -> Result<Option<Version>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut headers_buf: Vec<u8> = Self::DEFAULT_GITHUB_HEADERS.to_vec();
        // gonna have to free memory myself like a goddamn caveman due to a thread safety issue with ArenaAllocator
        // (in Rust: Vec drops automatically; the Zig defer-free is a no-op here)

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

        // PORT NOTE: reshaped for borrowck — write into a local Vec instead of static buf.
        // `AsyncHTTP::init_sync` wants `URL<'static>` / `&'static [u8]`, so back
        // the buffers in the process-lifetime CLI arena (matches the Zig
        // original which used module-level static buffers).
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
            async_http.client.progress_node = Some(NonNull::from(progress.as_deref_mut().unwrap()));
            // TODO(port): lifetime — progress_node stores a borrow of progress
        }
        let response = async_http.send_sync()?;

        match response.status_code {
            404 => return Err(bun_core::err!("HTTP404")),
            403 => return Err(bun_core::err!("HTTPForbidden")),
            429 => return Err(bun_core::err!("HTTPTooManyRequests")),
            499..=599 => return Err(bun_core::err!("GitHubIsDown")),
            200 => {}
            _ => return Err(bun_core::err!("HTTPError")),
        }

        let mut log = bun_ast::Log::init();
        // defer if SILENT log.deinit() — Drop handles this
        let source =
            bun_ast::Source::init_path_string(b"releases.json", metadata_body.list.as_slice());
        bun_ast::initialize_store();
        // PORT NOTE: `JSON::parse_utf8` needs a bump arena; this is a one-shot
        // CLI path so use the process-lifetime CLI arena (Zig used the global
        // Expr/Stmt store which is process-lifetime anyway).
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
                        Output::pretty_errorln(format_args!(
                            "Error parsing releases from GitHub: <r><red>{}<r>",
                            err.name()
                        ));
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
        };

        if !expr.is_object() {
            if !SILENT {
                progress.expect("infallible: progress active").end();
                refresher.expect("infallible: progress active").refresh();

                Output::pretty_errorln(format_args!(
                    "JSON error - expected an object but received {:?}",
                    core::mem::discriminant(&expr.data)
                ));
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

                Output::pretty_errorln(format_args!(
                    "JSON Error parsing releases from GitHub: <r><red>tag_name<r> is missing?\n{}",
                    // Zig spec prints `metadata_body.list.items` here; `version.buf`
                    // is still empty at this point so using it loses the payload.
                    bstr::BStr::new(metadata_body.list.as_slice())
                ));
                Global::exit(1);
            }

            return Ok(None);
        }

        'get_asset: {
            let Some(assets_) = expr.as_property(b"assets") else {
                break 'get_asset;
            };
            // PORT NOTE: Zig `Expr.asArray()` returns an iterator; the T2
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
                    if cfg!(debug_assertions) {
                        Output::prettyln(format_args!(
                            "Content-type: {}",
                            bstr::BStr::new(content_type_)
                        ));
                        Output::flush();
                    }

                    if content_type_ != b"application/zip" {
                        continue;
                    }
                }

                if let Some(name_) = asset.as_property(b"name") {
                    if let Some(name) = name_.expr.as_utf8_string_literal() {
                        if cfg!(debug_assertions) {
                            let filename = if !use_profile {
                                Version::ZIP_FILENAME
                            } else {
                                Version::PROFILE_ZIP_FILENAME
                            };
                            Output::prettyln(format_args!(
                                "Comparing {} vs {}",
                                bstr::BStr::new(name),
                                filename
                            ));
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
                        if cfg!(debug_assertions) {
                            Output::prettyln(format_args!(
                                "Found Zip {}",
                                bstr::BStr::new(&*version.zip_url)
                            ));
                            Output::flush();
                        }

                        if let Some(size_) = asset.as_property(b"size") {
                            if let bun_ast::ExprData::ENumber(n) = &size_.expr.data {
                                version.size =
                                    u32::try_from(((n.value.ceil()) as i32).max(0)).unwrap();
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
                Output::pretty_errorln(format_args!(
                    "Bun v{} is out, but not for this platform ({}) yet.",
                    bstr::BStr::new(&name),
                    Version::TRIPLET
                ));
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
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            "curl -fsSL https://bun.com/install | bash"
        }
        #[cfg(target_os = "windows")]
        {
            "powershell -c 'irm bun.sh/install.ps1|iex'"
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        {
            // TODO(port): Environment.os.displayString() at comptime
            "(TODO: Install script for this platform)"
        }
    };

    #[cold]
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        let args = bun_core::argv();
        if args.len() > 2 {
            for arg in args.iter().skip(2) {
                if !strings::contains(arg, b"--") {
                    Output::pretty_error(format_args!(
                        "<r><red>error<r><d>:<r> This command updates Bun itself, and does not take package names.\n<blue>note<r><d>:<r> Use `bun update"
                    ));
                    for arg_err in args.iter().skip(2) {
                        Output::pretty_error(format_args!(" {}", bstr::BStr::new(arg_err)));
                    }
                    Output::pretty_errorln(format_args!("` instead."));
                    Global::exit(1);
                }
            }
        }

        if let Err(err) = Self::_exec(ctx) {
            Output::pretty_errorln(format_args!(
                "<r>Bun upgrade failed with error: <red><b>{}<r>\n\n<cyan>Please upgrade manually<r>:\n  <b>{}<r>\n\n",
                err.name(),
                Self::MANUAL_UPGRADE_COMMAND
            ));
            Global::exit(1);
        }
        Ok(())
    }

    fn _exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        HTTP::http_thread::init(&Default::default());

        // SAFETY: FileSystem::init returns the process-global singleton; valid for 'static.
        let filesystem = unsafe { &mut *fs::FileSystem::init(None)? };
        let mut env_loader: DotEnv::Loader = {
            // Zig leaks the map; allocate in the process-lifetime CLI arena.
            DotEnv::Loader::init(crate::cli::cli_arena().alloc(DotEnv::Map::init()))
        };
        env_loader.load_process()?;

        let use_canary: bool = 'brk: {
            let default_use_canary = Environment::IS_CANARY;

            if default_use_canary && argv_contains(b"--stable") {
                break 'brk false;
            }

            break 'brk (env_loader.map.get(b"BUN_CANARY").unwrap_or(b"0") == b"1")
                || argv_contains(b"--canary")
                || default_use_canary;
        };

        let use_profile = argv_contains(b"--profile");

        let mut version: Version = if !use_canary {
            // PORT NOTE: `Progress::start` returns `&mut Node` borrowing `refresher`;
            // leak the Progress and use raw pointers so we can pass both
            // `&mut refresher` and `&mut progress` to `get_latest_version` (Zig
            // freely aliased these).
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
                Some(unsafe { &mut *progress }),
                use_profile,
            )?
            else {
                return Ok(());
            };

            // SAFETY: see above.
            unsafe { (*progress).end() };
            unsafe { (*refresher).refresh() };

            if !Environment::IS_CANARY {
                if version.name().is_some() && version.is_current() {
                    Output::pretty_errorln(format_args!(
                        "<r><green>Congrats!<r> You're already on the latest version of Bun <d>(which is v{})<r>",
                        bstr::BStr::new(&version.name().unwrap())
                    ));
                    Global::exit(0);
                }
            }

            if version.name().is_none() {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> Bun versions are currently unavailable (the latest version name didn't match the expeccted format)"
                ));
                Global::exit(1);
            }

            if !Environment::IS_CANARY {
                Output::pretty_errorln(format_args!(
                    "<r><b>Bun <cyan>v{}<r> is out<r>! You're on <blue>v{}<r>\n",
                    bstr::BStr::new(&version.name().unwrap()),
                    Global::package_json_version
                ));
            } else {
                Output::pretty_errorln(format_args!(
                    "<r><b>Downgrading from Bun <blue>{}-canary<r> to Bun <cyan>v{}<r><r>\n",
                    Global::package_json_version,
                    bstr::BStr::new(&version.name().unwrap())
                ));
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
            }
        };

        let zip_url_bytes = core::mem::take(&mut version.zip_url);
        let zip_url = URL::parse(&zip_url_bytes);
        let http_proxy = env_loader.get_http_proxy_for(&zip_url);

        {
            let refresher: *mut Progress::Progress =
                bun_core::heap::into_raw(Box::new(Progress::Progress::default()));
            // SAFETY: refresher is a fresh leaked allocation.
            let progress: *mut Progress::Node =
                unsafe { (*refresher).start(b"Downloading", version.size as usize) };
            // SAFETY: see above.
            unsafe { (*progress).unit = Progress::Unit::Bytes };
            unsafe { (*refresher).refresh() };
            // Zig leaks this allocation intentionally — store in CLI arena.
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
            // `progress` is leaked; AsyncHTTP holds a NonNull into it.
            async_http.client.progress_node =
                Some(NonNull::new(progress).expect("leaked Box is non-null"));
            // TODO(port): lifetime — progress_node stores a borrow of progress
            async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

            let response = async_http.send_sync()?;

            match response.status_code {
                404 => {
                    if use_canary {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> Canary builds are not available for this platform yet\n\n   Release: <cyan>https://github.com/oven-sh/bun/releases/tag/canary<r>\n  Filename: <b>{}<r>\n",
                            Version::ZIP_FILENAME
                        ));
                        Global::exit(1);
                    }

                    return Err(bun_core::err!("HTTP404"));
                }
                403 => return Err(bun_core::err!("HTTPForbidden")),
                429 => return Err(bun_core::err!("HTTPTooManyRequests")),
                499..=599 => return Err(bun_core::err!("GitHubIsDown")),
                200 => {}
                _ => return Err(bun_core::err!("HTTPError")),
            }

            let bytes = zip_file_buffer.slice();

            // SAFETY: refresher/progress are leaked allocations.
            unsafe { (*progress).end() };
            unsafe { (*refresher).refresh() };

            if bytes.is_empty() {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> Failed to download the latest version of Bun. Received empty content"
                ));
                Global::exit(1);
            }

            let version_name = version.name().unwrap();

            let save_dir_: sys::Dir = match filesystem.tmpdir() {
                Ok(d) => d,
                Err(err) => {
                    Output::err_generic("Failed to open temporary directory: {}", (err.name(),));
                    Global::exit(1);
                }
            };

            let save_dir_it = match save_dir_.make_open_path(&version_name, Default::default()) {
                Ok(d) => d,
                Err(err) => {
                    Output::err_generic("Failed to open temporary directory: {}", (err.name(),));
                    Global::exit(1);
                }
            };
            let save_dir: sys::Dir = save_dir_it;

            // PORT NOTE: reshaped for borrowck — use a stack-local PathBuffer instead of thread_local
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

            // PORT NOTE: Zig used std.fs.Dir.createFileZ(.{ .truncate = true }); mapped to
            // bun_sys::openat with WRONLY|CREAT|TRUNC and wrapped in sys::File for write_all.
            let zip_file = match sys::openat_a(
                save_dir.fd(),
                tmpname.as_bytes(),
                sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                0o644,
            )
            .map(sys::File::from_fd)
            {
                Ok(f) => f,
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error:<r> Failed to open temp file {}",
                        bstr::BStr::new(err.name())
                    ));
                    Global::exit(1);
                }
            };

            {
                if let Err(err) = zip_file.write_all(bytes) {
                    let _ = sys::unlinkat(save_dir.fd(), tmpname);
                    Output::pretty_errorln(format_args!(
                        "<r><red>error:<r> Failed to write to temp file {}",
                        bstr::BStr::new(err.name())
                    ));
                    Global::exit(1);
                }
                let _ = zip_file.close();
            }

            {
                scopeguard::defer! {
                    let _ = sys::unlinkat(save_dir.fd(), tmpname);
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
                        let _ = sys::unlinkat(save_dir.fd(), tmpname);
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> Failed to locate \"unzip\" in PATH. bun upgrade needs \"unzip\" to work."
                        ));
                        Global::exit(1);
                    };

                    // We could just embed libz2
                    // however, we want to be sure that xattrs are preserved
                    // xattrs are used for codesigning
                    // it'd be easy to mess that up
                    let unzip_argv: [&[u8]; 4] =
                        [unzip_exe.as_bytes(), b"-q", b"-o", tmpname.as_bytes()];

                    // PORT NOTE: Zig used `std.process.Child` directly with all stdio
                    // set to `.Inherit` and `.spawnAndWait()`. PORTING.md / src/CLAUDE.md
                    // map this to `bun.spawnSync` → `crate::api::bun::process::sync::spawn`.
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
                            let _ = sys::unlinkat(save_dir.fd(), tmpname);
                            Output::pretty_errorln(format_args!(
                                "<r><red>error:<r> Failed to spawn unzip due to {}.",
                                bstr::BStr::new(err.name())
                            ));
                            Global::exit(1);
                        }
                        Err(err) => {
                            let _ = sys::unlinkat(save_dir.fd(), tmpname);
                            Output::pretty_errorln(format_args!(
                                "<r><red>error:<r> Failed to spawn unzip due to {}.",
                                err.name()
                            ));
                            Global::exit(1);
                        }
                    };

                    match unzip_result.status {
                        Status::Exited(e) if e.code == 0 => {}
                        Status::Exited(e) => {
                            Output::pretty_errorln(format_args!(
                                "<r><red>Unzip failed<r> (exit code: {})",
                                e.code
                            ));
                            let _ = sys::unlinkat(save_dir.fd(), tmpname);
                            Global::exit(1);
                        }
                        other => {
                            Output::pretty_errorln(format_args!(
                                "<r><red>Unzip failed<r> ({})",
                                other
                            ));
                            let _ = sys::unlinkat(save_dir.fd(), tmpname);
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
                    // PORT NOTE: separate fallback buffer — Zig reused `buf` for the
                    // hardcoded path, but Rust borrowck holds `buf` for the lifetime of
                    // `which`'s returned `Option<&ZStr>` even across the `None` arm.
                    let mut buf2 = PathBuffer::uninit();
                    let powershell_path: &ZStr = match which(
                        &mut buf,
                        env_var::PATH.get().unwrap_or(b""),
                        b"",
                        b"powershell",
                    ) {
                        Some(p) => p,
                        None => {
                            let system_root = env_var::SYSTEMROOT.get().unwrap_or(b"C:\\Windows");
                            let hardcoded_system_powershell =
                                bun_paths::join_abs_string_buf_z::<bun_paths::platform::Windows>(
                                    system_root,
                                    &mut buf2[..],
                                    &[
                                        system_root,
                                        b"System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                                    ],
                                );
                            if !sys::exists(hardcoded_system_powershell.as_bytes()) {
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error:<r> Failed to unzip {} due to PowerShell not being installed.",
                                    bstr::BStr::new(tmpname.as_bytes())
                                ));
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
                            Output::pretty_errorln(format_args!(
                                "<r><red>error:<r> Failed to spawn Expand-Archive on {} due to error {}",
                                bstr::BStr::new(tmpname.as_bytes()),
                                err.name()
                            ));
                            Global::exit(1);
                        }
                    };
                    if let Err(err) = spawn_res {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> Failed to run Expand-Archive on {} due to error {}",
                            bstr::BStr::new(tmpname.as_bytes()),
                            bstr::BStr::new(err.name())
                        ));
                        Global::exit(1);
                    }
                }
            }
            {
                let verify_argv: [&[u8]; 2] = [
                    exe,
                    if use_canary {
                        b"--revision"
                    } else {
                        b"--version"
                    },
                ];

                // PORT NOTE: Zig used `std.process.Child.run` with `.max_output_bytes = 512`.
                // PORTING.md bans `std::process`; mapped to `bun.spawnSync` with
                // `.stdout = .buffer`. The 512-byte cap is handled below by slicing the
                // captured stdout (`..min(len, 512)`), matching the Zig diagnostic path.
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
                    // Zig's `catch |err|` arm: any spawn-time failure (allocator/OOM
                    // surfaces as `bun_core::Error`, posix_spawn surfaces as
                    // `bun_sys::Error`) → same diagnostic + cleanup.
                    let err_name: &'static [u8] = match spawned {
                        Ok(Ok(r)) => break 'spawn r,
                        Ok(Err(sys_err)) => sys_err.name(),
                        Err(core_err) => core_err.name().as_bytes(),
                    };

                    scopeguard::defer! {
                        let _ = save_dir_.delete_tree(&version_name);
                    }

                    // Zig matched `error.FileNotFound`; the bun.sys spawn path tags
                    // it as ENOENT. Accept both to keep snapshot parity across
                    // the std→bun.sys mapping.
                    if err_name == b"FileNotFound" || err_name == b"ENOENT" {
                        // Zig: std.fs.cwd().access(exe, .{}) — we already chdir'd to tmpdir
                        if sys::exists(exe) {
                            // On systems like NixOS, the FileNotFound is actually the system-wide linker,
                            // as they do not have one (most systems have it at a known path). This is how
                            // ChildProcess returns FileNotFound despite the actual
                            //
                            // In these cases, prebuilt binaries from GitHub will never work without
                            // extra patching, so we will print a message deferring them to their system
                            // package manager.
                            Output::pretty_errorln(format_args!(
                                "<r><red>error<r><d>:<r> 'bun upgrade' is unsupported on systems without ld\n\nYou are likely on an immutable system such as NixOS, where dynamic\nlibraries are stored in a global cache.\n\nPlease use your system's package manager to properly upgrade bun.\n"
                            ));
                            Global::exit(1);
                        }
                    }

                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r><d>:<r> Failed to verify Bun (code: {})<r>",
                        bstr::BStr::new(err_name)
                    ));
                    Global::exit(1);
                };

                if !result.status.is_ok() {
                    let _ = save_dir_.delete_tree(&version_name);
                    let exit_code: u32 = match &result.status {
                        Status::Exited(e) => u32::from(e.code),
                        Status::Signaled(sig) => 128 + u32::from(*sig),
                        _ => 1,
                    };
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r><d>:<r> failed to verify Bun<r> (exit code: {})",
                        exit_code
                    ));
                    Global::exit(1);
                }

                // It should run successfully
                // but we don't care about the version number if we're doing a canary build
                if use_canary {
                    let version_string = result.stdout.as_slice();
                    if let Some(i) = strings::index_of_char(version_string, b'+') {
                        version.tag = version_string[(i as usize + 1)..].into();
                    }
                } else {
                    let mut version_string = result.stdout.as_slice();
                    if let Some(i) = strings::index_of_char(version_string, b' ') {
                        version_string = &version_string[..i as usize];
                    }

                    let trimmed = bun_core::trim(version_string, b" \n\r\t");
                    if trimmed != version_name.as_slice() {
                        let _ = save_dir_.delete_tree(&version_name);

                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r>: The downloaded version of Bun (<red>{}<r>) doesn't match the expected version (<b>{}<r>)<r>. Cancelled upgrade",
                            bstr::BStr::new(&version_string[..version_string.len().min(512)]),
                            bstr::BStr::new(&version_name)
                        ));
                        Global::exit(1);
                    }
                }
            }

            // PORT NOTE: keep the `&ZStr` form for Windows `sys::rename` (needs
            // a NUL-terminated path); `destination_executable` (bytes view) is
            // used everywhere else.
            #[cfg_attr(not(windows), allow(unused_variables))]
            let destination_executable_z: &ZStr = bun_core::self_exe_path()
                .map_err(|_| bun_core::err!("UpgradeFailedMissingExecutable"))?;
            let destination_executable: &[u8] = destination_executable_z.as_bytes();
            // PORT NOTE: reshaped for borrowck — use stack-local buffer.
            // Stacked Borrows: take ONE `*mut u8` over the buffer up front and
            // route every read/write through it. Indexing the `PathBuffer`
            // directly (via Deref/DerefMut) would materialize a fresh `&[u8]`
            // or `&mut [u8]` over the *whole* array, retagging it and
            // invalidating the raw-pointer-derived `&ZStr` views below. The
            // Zig original freely re-slices a global `var` with no aliasing
            // model; here the single `buf_ptr` is the shared provenance root.
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
                .ok_or(bun_core::err!("UpgradeFailedBecauseOfMissingExecutableDir"))?;
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
            let target_dir_it = match sys::open_dir_absolute(target_dirname.as_bytes()) {
                Ok(d) => sys::Dir::from_fd(d),
                Err(err) => {
                    let _ = save_dir_.delete_tree(&version_name);
                    Output::pretty_errorln(format_args!(
                        "<r><red>error:<r> Failed to open Bun's install directory {}",
                        bstr::BStr::new(err.name())
                    ));
                    Global::exit(1);
                }
            };
            let target_dir: sys::Dir = target_dir_it;

            // PORT NOTE: `move_file_z` wants `&ZStr`; pre-compute a NUL-terminated
            // copy of `exe` (Zig had it in a sentinel buffer).
            let mut exe_z_buf = PathBuffer::uninit();
            exe_z_buf[..exe.len()].copy_from_slice(exe);
            exe_z_buf[exe.len()] = 0;
            // SAFETY: NUL written above.
            let exe_z: &ZStr = ZStr::from_buf(&exe_z_buf[..], exe.len());

            if use_canary {
                // Check if the versions are the same
                let target_stat = match sys::fstatat(target_dir.fd(), target_filename) {
                    Ok(s) => s,
                    Err(err) => {
                        let _ = save_dir_.delete_tree(&version_name);
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> {} while trying to stat target {} ",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(target_filename.as_bytes())
                        ));
                        Global::exit(1);
                    }
                };

                let dest_stat = match sys::fstatat(save_dir.fd(), exe_z) {
                    Ok(s) => s,
                    Err(err) => {
                        let _ = save_dir_.delete_tree(&version_name);
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> {} while trying to stat source {}",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(exe)
                        ));
                        Global::exit(1);
                    }
                };

                if target_stat.st_size == dest_stat.st_size && target_stat.st_size > 0 {
                    let mut input_buf = vec![0u8; target_stat.st_size as usize];

                    // PORT NOTE: `Dir::read_file` (Zig std.fs.Dir.readFile) is open + read_all + close.
                    let target_hash = hash(
                        match sys::File::openat(
                            target_dir.fd(),
                            target_filename.as_bytes(),
                            sys::O::RDONLY,
                            0,
                        )
                        .and_then(|f| {
                            let n = f.read_all(&mut input_buf);
                            let _ = f.close(); // close error is non-actionable (Zig parity: discarded)
                            n
                        }) {
                            Ok(n) => &input_buf[..n],
                            Err(err) => {
                                let _ = save_dir_.delete_tree(&version_name);
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error:<r> Failed to read target bun {}",
                                    bstr::BStr::new(err.name())
                                ));
                                Global::exit(1);
                            }
                        },
                    );

                    let source_hash = hash(
                        match sys::File::openat(save_dir.fd(), exe, sys::O::RDONLY, 0).and_then(
                            |f| {
                                let n = f.read_all(&mut input_buf);
                                let _ = f.close(); // close error is non-actionable (Zig parity: discarded)
                                n
                            },
                        ) {
                            Ok(n) => &input_buf[..n],
                            Err(err) => {
                                let _ = save_dir_.delete_tree(&version_name);
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error:<r> Failed to read source bun {}",
                                    bstr::BStr::new(err.name())
                                ));
                                Global::exit(1);
                            }
                        },
                    );

                    if target_hash == source_hash {
                        let _ = save_dir_.delete_tree(&version_name);
                        Output::pretty_errorln(format_args!(
                            "<r><green>Congrats!<r> You're already on the latest <b>canary<r><green> build of Bun\n\nTo downgrade to the latest stable release, run <b><cyan>bun upgrade --stable<r>\n"
                        ));
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
                    // Zig: `std.fmt.allocPrintSentinel(..., 0)` — owned NUL-terminated string.
                    outdated_filename = Some(bun_core::ZBox::from_vec(buf));
                    if let Err(err) = sys::rename(
                        destination_executable_z,
                        outdated_filename.as_deref().unwrap(),
                    ) {
                        let _ = save_dir_.delete_tree(&version_name);
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> Failed to rename current executable {}",
                            bstr::BStr::new(err.name())
                        ));
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
                // PORT NOTE: Zig used `std.process.Child.run` with `env_map = std_map.get()`
                // and discarded the result (`_ = ... catch {}`). `bun.spawnSync` takes the
                // C-style `[*:null]?[*:0]const u8` envp directly, so build it from the
                // DotEnv map (`createNullDelimitedEnvMap` equivalent) instead of
                // round-tripping through `std_env_map`. Output is buffered (matching
                // `std.process.Child.run`'s default) and silently dropped along with any
                // spawn error — same as the Zig.
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

            if use_canary {
                Output::pretty_errorln(format_args!(
                    "<r> Upgraded.\n\n<b><green>Welcome to Bun's latest canary build!<r>\n\nReport any bugs:\n\n    https://github.com/oven-sh/bun/issues\n\nChangelog:\n\n    https://github.com/oven-sh/bun/compare/{}...{}\n",
                    Environment::GIT_SHA_SHORT,
                    bstr::BStr::new(&*version.tag)
                ));
            } else {
                let bun_v = const_format::concatcp!("bun-v", Global::package_json_version);

                Output::pretty_errorln(format_args!(
                    "<r> Upgraded.\n\n<b><green>Welcome to Bun v{}!<r>\n\nWhat's new in Bun v{}:\n\n    <cyan>https://bun.com/blog/release-notes/{}<r>\n\nReport any bugs:\n\n    https://github.com/oven-sh/bun/issues\n\nCommit log:\n\n    https://github.com/oven-sh/bun/compare/{}...{}\n",
                    bstr::BStr::new(&version_name),
                    bstr::BStr::new(&version_name),
                    bstr::BStr::new(&*version.tag),
                    bun_v,
                    bstr::BStr::new(&*version.tag)
                ));
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
}

// ──────────────────────────────────────────────────────────────────────────

pub mod upgrade_js_bindings {
    use super::*;

    // Zig spec: module-level `var tempdir_fd: ?bun.FD = null;` — process-global,
    // not threadlocal. If open/close are invoked from different threads (main vs
    // worker VM) a `thread_local!` would make the close see `None` and leak the
    // HANDLE. Match the Zig global with a `RacyCell`; access is test-only and
    // effectively single-threaded.
    static TEMPDIR_FD: bun_core::RacyCell<Option<sys::Fd>> = bun_core::RacyCell::new(None);

    pub fn generate(global: &JSGlobalObject) -> JSValue {
        let obj = JSValue::create_empty_object(global, 2);
        obj.put(
            global,
            b"openTempDirWithoutSharingDelete",
            jsc::JSFunction::create(
                global,
                b"openTempDirWithoutSharingDelete",
                // PORT NOTE: `#[bun_jsc::host_fn]` emits the C-ABI shim with a
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
        obj
    }

    /// For testing upgrades when the temp directory has an open handle without FILE_SHARE_DELETE.
    /// Windows only
    #[bun_jsc::host_fn]
    pub fn js_open_temp_dir_without_sharing_delete(
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
                    // Zig: `bun.FD.fromNative(fd)` — system-kind handle on Windows.
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
    pub fn js_close_temp_dir_handle(
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

pub fn export() {
    // force-reference — drop in Rust (linker keeps #[no_mangle])
}

// ported from: src/cli/upgrade_command.zig

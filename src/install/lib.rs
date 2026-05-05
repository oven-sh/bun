#![allow(unused, nonstandard_style, ambiguous_glob_reexports)]

use core::cell::Cell;
use core::fmt;

// ──────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: Phase-A draft modules are preserved on disk but gated
// behind `#[cfg(any())]` so the crate type-checks. Un-gating happens in B-2.
// Each gated module has a sibling stub mod exposing the minimal surface other
// crates / this crate's lib.rs re-exports.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! gated_mod {
    ($vis:vis mod $name:ident = $path:literal ;) => {
        #[cfg(any())]
        #[path = $path]
        $vis mod $name;
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Module declarations (gated) — Zig basenames preserved per PORTING.md, hence
// explicit #[path] attrs for PascalCase files.
// ──────────────────────────────────────────────────────────────────────────

gated_mod!(pub mod extract_tarball = "extract_tarball.rs";);
gated_mod!(pub mod network_task = "NetworkTask.rs";);
gated_mod!(pub mod tarball_stream = "TarballStream.rs";);
gated_mod!(pub mod npm = "npm.rs";);
gated_mod!(pub mod package_manager = "PackageManager.rs";);
gated_mod!(pub mod package_manifest_map = "PackageManifestMap.rs";);
gated_mod!(pub mod package_manager_task = "PackageManagerTask.rs";);
gated_mod!(pub mod lockfile = "lockfile.rs";);
gated_mod!(pub mod bin = "bin.rs";);
gated_mod!(pub mod lifecycle_script_runner = "lifecycle_script_runner.rs";);
gated_mod!(pub mod package_install = "PackageInstall.rs";);
gated_mod!(pub mod package_installer = "PackageInstaller.rs";);
gated_mod!(pub mod repository = "repository.rs";);
gated_mod!(pub mod resolution = "resolution.rs";);
gated_mod!(pub mod isolated_install = "isolated_install.rs";);
gated_mod!(pub mod pnpm_matcher = "PnpmMatcher.rs";);
gated_mod!(pub mod postinstall_optimizer = "postinstall_optimizer.rs";);
gated_mod!(pub mod external_slice = "ExternalSlice.rs";);
gated_mod!(pub mod integrity = "integrity.rs";);
gated_mod!(pub mod dependency = "dependency.rs";);
gated_mod!(pub mod patch_install = "patch_install.rs";);
gated_mod!(pub mod config_version = "ConfigVersion.rs";);
gated_mod!(pub mod hoisted_install = "hoisted_install.rs";);
gated_mod!(pub mod hosted_git_info = "hosted_git_info.rs";);
gated_mod!(pub mod migration = "migration.rs";);
gated_mod!(pub mod padding_checker = "padding_checker.rs";);
gated_mod!(pub mod pnpm = "pnpm.rs";);
gated_mod!(pub mod versioned_url = "versioned_url.rs";);
gated_mod!(pub mod yarn = "yarn.rs";);

#[cfg(any())]
pub mod resolvers {
    #[path = "folder_resolver.rs"]
    pub mod folder_resolver;
}

// ──────────────────────────────────────────────────────────────────────────
// Stub surface (B-1): opaque newtypes / todo!()-bodied re-exports so downstream
// re-exports type-check. Real impls live in the gated modules above.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(any()))]
pub mod extract_tarball { pub struct ExtractTarball; }
#[cfg(not(any()))]
pub mod network_task { pub struct NetworkTask; }
#[cfg(not(any()))]
pub mod tarball_stream { pub struct TarballStream; }
#[cfg(not(any()))]
pub mod npm {
    pub struct PackageManifest;
    pub struct Registry;
}
#[cfg(not(any()))]
pub mod package_manager {
    pub struct PackageManager;
    pub mod security_scanner { pub struct SecurityScanSubprocess; }
}
#[cfg(not(any()))]
pub mod package_manifest_map { pub struct PackageManifestMap; }
#[cfg(not(any()))]
pub mod package_manager_task { pub struct Task; }
#[cfg(not(any()))]
pub mod lockfile {
    pub struct Lockfile;
    pub struct PatchedDep;
    pub mod bun_lock {}
    pub mod tree { pub type Id = u32; }
}
#[cfg(not(any()))]
pub mod bin { pub struct Bin; }
#[cfg(not(any()))]
pub mod resolvers {
    pub mod folder_resolver { pub struct FolderResolution; }
}
#[cfg(not(any()))]
pub mod lifecycle_script_runner { pub struct LifecycleScriptSubprocess; }
#[cfg(not(any()))]
pub mod package_install { pub struct PackageInstall; }
#[cfg(not(any()))]
pub mod repository { pub struct Repository; }
#[cfg(not(any()))]
pub mod resolution { pub struct Resolution; }
#[cfg(not(any()))]
pub mod isolated_install {
    pub mod store {
        pub struct Store;
        pub type EntryId = u32;
    }
    pub mod file_copier { pub struct FileCopier; }
}
#[cfg(not(any()))]
pub mod pnpm_matcher { pub struct PnpmMatcher; }
#[cfg(not(any()))]
pub mod postinstall_optimizer { pub struct PostinstallOptimizer; }
#[cfg(not(any()))]
pub mod external_slice {
    pub struct ExternalSlice<T>(core::marker::PhantomData<T>);
    pub type ExternalPackageNameHashList = ();
    pub type ExternalStringList = ();
    pub type ExternalStringMap = ();
    pub type VersionSlice = ();
}
#[cfg(not(any()))]
pub mod integrity {
    #[derive(Default, Clone, Copy)]
    pub struct Integrity;
}
#[cfg(not(any()))]
pub mod dependency {
    pub struct Dependency;
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Behavior(pub u8);
}
#[cfg(not(any()))]
pub mod patch_install { pub struct PatchTask; }

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub use extract_tarball::ExtractTarball;
pub use network_task::NetworkTask;
pub use tarball_stream::TarballStream;
pub use npm as Npm;
pub use package_manager::PackageManager;
pub use package_manifest_map::PackageManifestMap;
pub use package_manager_task::Task;
pub use lockfile::bun_lock as TextLockfile;
pub use bin::Bin;
pub use resolvers::folder_resolver::FolderResolution;
pub use lifecycle_script_runner::LifecycleScriptSubprocess;
pub use package_manager::security_scanner::SecurityScanSubprocess;
pub use package_install::PackageInstall;
pub use repository::Repository;
pub use resolution::Resolution;
pub use isolated_install::store::Store;
pub use isolated_install::file_copier::FileCopier;
pub use pnpm_matcher::PnpmMatcher;
pub use postinstall_optimizer::PostinstallOptimizer;

// TODO(b1): bun_collections::identity_context::{ArrayIdentityContext,IdentityContext} missing
// pub use bun_collections::identity_context::ArrayIdentityContext;
// pub use bun_collections::identity_context::IdentityContext;
pub type ArrayIdentityContext = ();
pub type IdentityContext = ();

pub use external_slice as external;
pub use external::ExternalPackageNameHashList;
pub use external::ExternalSlice;
pub use external::ExternalStringList;
pub use external::ExternalStringMap;
pub use external::VersionSlice;

pub use integrity::Integrity;
pub use dependency::Dependency;
pub use dependency::Behavior;

pub use lockfile::Lockfile;
pub use lockfile::PatchedDep;

pub use patch_install as patch;
pub use patch::PatchTask;

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(b0): bun_runtime::cli::ShellCompletions → install
// Only the `Shell` enum (variant detection) is consumed here — the embedded
// completion script bodies stay in bun_cli (they pull in @embedFile assets).
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_snake_case)]
pub mod ShellCompletions {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub enum Shell {
        #[default]
        Unknown,
        Bash,
        Zsh,
        Fish,
        Pwsh,
    }

    impl Shell {
        /// Port of `Shell.fromEnv` (src/cli/shell_completions.zig). The Zig version was
        /// generic over the string type purely so it could accept both `[]const u8` and
        /// `[:0]const u8`; in Rust both coerce to `&[u8]`.
        pub fn from_env(shell: &[u8]) -> Shell {
            #[cfg(any())]
            {
                use bun_str::strings;
                let basename = bun_paths::basename(shell);
                if strings::eql_comptime(basename, b"bash") {
                    Shell::Bash
                } else if strings::eql_comptime(basename, b"zsh") {
                    Shell::Zsh
                } else if strings::eql_comptime(basename, b"fish") {
                    Shell::Fish
                } else if strings::eql_comptime(basename, b"pwsh")
                    || strings::eql_comptime(basename, b"powershell")
                {
                    Shell::Pwsh
                } else {
                    Shell::Unknown
                }
            }
            #[cfg(not(any()))]
            { let _ = shell; todo!("B-2: ShellCompletions::Shell::from_env") }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(b0): bun_runtime::cli::RunCommand (subset) → install
// Only the helpers the package manager needs: shell discovery, fake `node`
// shim creation, and env bootstrap for lifecycle scripts. The interactive
// `bun run` entrypoint stays in bun_cli.
// ──────────────────────────────────────────────────────────────────────────
pub struct RunCommand;

/// Hook (GENUINE b0): mirrors `bun_runtime::cli::PRETEND_TO_BE_NODE`. Set once at
/// startup by bun_cli when argv[0] basename == "node"; install only reads it.
/// Lives at module scope because Rust forbids `static` inside `impl`.
pub static PRETEND_TO_BE_NODE: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

#[cfg(any())] // TODO(b1): gated — depends on bun_bundler/bun_transpiler/bun_resolver/bun_bunfig/bun_schema/const_str/bun_c/bun_windows
impl RunCommand {
    const SHELLS_TO_SEARCH: &'static [&'static [u8]] = &[b"bash", b"sh", b"zsh"];

    /// `/tmp/bun-node-<sha>` (or debug variant). Windows builds compute the path
    /// at runtime via GetTempPathW, so this constant is POSIX-only.
    #[cfg(not(windows))]
    pub const BUN_NODE_DIR: &'static str = const_str::concat!(
        if cfg!(target_os = "macos") {
            "/private/tmp"
        } else if cfg!(target_os = "android") {
            "/data/local/tmp"
        } else {
            "/tmp"
        },
        if cfg!(debug_assertions) {
            "/bun-node-debug"
        } else if bun_core::env::GIT_SHA_SHORT.is_empty() {
            "/bun-node"
        } else {
            const_str::concat!("/bun-node-", bun_core::env::GIT_SHA_SHORT)
        },
    );

    fn find_shell_impl<'a>(
        buf: &'a mut bun_paths::PathBuffer,
        path: &[u8],
        cwd: &[u8],
    ) -> Option<&'a ZStr> {
        #[cfg(windows)]
        {
            let _ = (buf, path, cwd);
            // SAFETY: literal is NUL-free.
            return Some(unsafe { ZStr::from_bytes_unchecked(b"C:\\Windows\\System32\\cmd.exe\0") });
        }

        #[cfg(not(windows))]
        {
            for shell in Self::SHELLS_TO_SEARCH {
                if let Some(found) = bun_which::which(buf, path, cwd, shell) {
                    // SAFETY: which() writes a NUL-terminated path into `buf` and returns a
                    // borrow of it; reborrow as &ZStr with the buffer's lifetime.
                    let len = found.len();
                    return Some(unsafe { ZStr::from_raw(buf.as_ptr(), len) });
                }
            }

            const HARDCODED_POPULAR_ONES: &[&[u8]] = &[
                b"/bin/bash\0",
                b"/usr/bin/bash\0",
                b"/usr/local/bin/bash\0", // don't think this is a real one
                b"/bin/sh\0",
                b"/usr/bin/sh\0", // don't think this is a real one
                b"/usr/bin/zsh\0",
                b"/usr/local/bin/zsh\0",
                b"/system/bin/sh\0", // Android
            ];
            for &shell in HARDCODED_POPULAR_ONES {
                // SAFETY: each literal above is NUL-terminated.
                let z = unsafe { ZStr::from_bytes_unchecked(shell) };
                if bun_sys::is_executable_file_path(z) {
                    let body = z.as_bytes();
                    buf[..body.len()].copy_from_slice(body);
                    buf[body.len()] = 0;
                    // SAFETY: just wrote body + NUL into buf.
                    return Some(unsafe { ZStr::from_raw(buf.as_ptr(), body.len()) });
                }
            }

            None
        }
    }

    /// Find the "best" shell to use. Cached to only run once.
    /// Returns a slice into a process-lifetime static buffer.
    pub fn find_shell(path: &[u8], cwd: &[u8]) -> Option<&'static [u8]> {
        // PORTING.md §Concurrency: `bun.once` + static buf → OnceLock.
        static ONCE: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
        static SHELL_BUF: parking_lot::Mutex<bun_paths::PathBuffer> =
            parking_lot::Mutex::new([0u8; bun_paths::MAX_PATH_BYTES]);

        let len = *ONCE.get_or_init(|| {
            let mut scratch: bun_paths::PathBuffer = [0u8; bun_paths::MAX_PATH_BYTES];
            let found = Self::find_shell_impl(&mut scratch, path, cwd)?;
            let body = found.as_bytes();
            if body.len() >= bun_paths::MAX_PATH_BYTES {
                return None;
            }
            let mut dst = SHELL_BUF.lock();
            dst[..body.len()].copy_from_slice(body);
            dst[body.len()] = 0;
            Some(body.len())
        });

        len.map(|n| {
            // SAFETY: SHELL_BUF is written exactly once above (under OnceLock) and never
            // mutated again, so the static borrow is sound. Includes trailing NUL so the
            // caller may treat it as `[:0]const u8`.
            let ptr = SHELL_BUF.data_ptr() as *const u8;
            unsafe { core::slice::from_raw_parts(ptr, n + 1) }
        })
    }

    /// Port of `RunCommand.createFakeTemporaryNodeExecutable`
    /// (src/cli/run_command.zig). Symlinks/hardlinks the running bun binary as
    /// `node` + `bun` inside a temp dir and prepends that dir to `path`.
    pub fn create_fake_temporary_node_executable(
        path: &mut Vec<u8>,
        optional_bun_path: &mut &[u8],
    ) -> Result<(), bun_core::Error> {
        // If we are already running as "node", the path should exist
        if PRETEND_TO_BE_NODE.load(core::sync::atomic::Ordering::Relaxed) {
            return Ok(());
        }

        #[cfg(not(windows))]
        {
            let argv0: &ZStr = bun_core::argv()
                .get(0)
                .map(|b| b.as_ref())
                // SAFETY: literal is NUL-terminated.
                .unwrap_or(unsafe { ZStr::from_bytes_unchecked(b"bun\0") });

            // if we are already an absolute path, use that
            // if the user started the application via a shebang, it's likely that the path is absolute already
            let argv0_z: &ZStr = if argv0.as_bytes().first() == Some(&b'/') {
                *optional_bun_path = argv0.as_bytes();
                argv0
            } else if optional_bun_path.is_empty() {
                // otherwise, ask the OS for the absolute path
                match bun_core::self_exe_path() {
                    Ok(self_path) if !self_path.as_bytes().is_empty() => {
                        *optional_bun_path = self_path.as_bytes();
                        self_path
                    }
                    _ => argv0,
                }
            } else {
                argv0
            };

            #[cfg(debug_assertions)]
            {
                let _ = std::fs::remove_dir_all(Self::BUN_NODE_DIR);
            }

            for name in [
                const_str::concat!(RunCommand::BUN_NODE_DIR, "/node\0").as_bytes(),
                const_str::concat!(RunCommand::BUN_NODE_DIR, "/bun\0").as_bytes(),
            ] {
                // SAFETY: each literal above is NUL-terminated.
                let dest = unsafe { ZStr::from_bytes_unchecked(name) };
                let mut retried = false;
                loop {
                    match bun_sys::symlink(argv0_z, dest) {
                        Ok(()) => break,
                        Err(e) if e.errno == bun_c::EEXIST => break,
                        Err(_) if !retried => {
                            // SAFETY: literal is NUL-terminated.
                            let dir = unsafe {
                                ZStr::from_bytes_unchecked(
                                    const_str::concat!(RunCommand::BUN_NODE_DIR, "\0").as_bytes(),
                                )
                            };
                            let _ = bun_sys::mkdir(dir, 0o755);
                            retried = true;
                        }
                        Err(_) => return Ok(()),
                    }
                }
            }

            if !path.is_empty() && *path.last().unwrap() != bun_paths::DELIMITER {
                path.push(bun_paths::DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            path.extend_from_slice(Self::BUN_NODE_DIR.as_bytes());
            path.push(bun_paths::DELIMITER);
            Ok(())
        }

        #[cfg(windows)]
        {
            use bun_str::strings;

            let mut target_path_buffer: bun_paths::WPathBuffer =
                [0u16; bun_paths::PATH_MAX_WIDE];
            let prefix: &[u16] = strings::w("\\??\\");

            let len = unsafe {
                bun_windows::GetTempPathW(
                    (target_path_buffer.len() - prefix.len()) as u32,
                    target_path_buffer.as_mut_ptr().add(prefix.len()),
                )
            } as usize;
            if len == 0 {
                bun_output::scoped_log!(
                    RUN,
                    "Failed to create temporary node dir: {:?}",
                    unsafe { bun_windows::GetLastError() }
                );
                return Ok(());
            }

            target_path_buffer[..prefix.len()].copy_from_slice(prefix);

            let dir_name: &[u16] = if cfg!(debug_assertions) {
                strings::w("bun-node-debug")
            } else if bun_core::env::GIT_SHA_SHORT.is_empty() {
                strings::w("bun-node")
            } else {
                strings::w(const_str::concat!("bun-node-", bun_core::env::GIT_SHA_SHORT))
            };
            target_path_buffer[prefix.len() + len..][..dir_name.len()].copy_from_slice(dir_name);
            let dir_slice_len = prefix.len() + len + dir_name.len();

            let image_path = bun_windows::exe_path_w();
            for name in [strings::w("\\node.exe\0"), strings::w("\\bun.exe\0")] {
                target_path_buffer[dir_slice_len..][..name.len()].copy_from_slice(name);
                let file_slice = &target_path_buffer[..dir_slice_len + name.len() - 1];

                if unsafe {
                    bun_windows::CreateHardLinkW(
                        file_slice.as_ptr(),
                        image_path.as_ptr(),
                        core::ptr::null_mut(),
                    )
                } == 0
                {
                    match unsafe { bun_windows::GetLastError() } {
                        bun_windows::ERROR_ALREADY_EXISTS => {}
                        _ => {
                            target_path_buffer[dir_slice_len] = 0;
                            let _ = bun_sys::mkdir_w(&target_path_buffer[..dir_slice_len], 0);
                            target_path_buffer[dir_slice_len] = b'\\' as u16;

                            if unsafe {
                                bun_windows::CreateHardLinkW(
                                    file_slice.as_ptr(),
                                    image_path.as_ptr(),
                                    core::ptr::null_mut(),
                                )
                            } == 0
                            {
                                return Ok(());
                            }
                        }
                    }
                }
            }

            if !path.is_empty() && *path.last().unwrap() != bun_paths::DELIMITER {
                path.push(bun_paths::DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            strings::to_utf8_append_to_list(
                path,
                &target_path_buffer[prefix.len()..dir_slice_len],
            )?;
            path.push(bun_paths::DELIMITER);
            let _ = optional_bun_path;
            Ok(())
        }
    }

    /// Port of `RunCommand.configureEnvForRun` (src/cli/run_command.zig).
    /// Initializes a fresh `Transpiler` via out-param, loads `.env`, and seeds
    /// the npm_* environment variables lifecycle scripts expect. Returns the
    /// resolved root `DirInfo` (opaque to install — caller discards).
    pub fn configure_env_for_run(
        ctx: bun_bunfig::Command::Context,
        this_transpiler: &mut bun_transpiler::Transpiler,
        // Zig: `env: ?*DotEnv.Loader` — call site passes `this.env_mut()` (always Some).
        env: &mut bun_dotenv::Loader,
        log_errors: bool,
        store_root_fd: bool,
    ) -> Result<*mut bun_resolver::DirInfo, bun_core::Error> {
        use bun_core::{Global, Output};
        use bun_schema::api;

        // TODO(port): Zig branched on `env == null` to decide whether to run
        // loadProcess()/runEnvLoader(). The only install caller always passes a
        // loader, so the `had_env` path is the only one exercised here.
        let had_env = true;
        *this_transpiler =
            bun_transpiler::Transpiler::init(ctx.allocator, ctx.log, ctx.args, Some(env))?;
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        this_transpiler.env.quiet = true;
        this_transpiler.options.env.prefix = b"";

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        this_transpiler.resolver.opts.load_tsconfig_json = true;
        this_transpiler.options.load_tsconfig_json = true;

        this_transpiler.configure_linker();

        let root_dir_info = match this_transpiler
            .resolver
            .read_dir_info(this_transpiler.fs.top_level_dir)
        {
            Ok(Some(info)) => info,
            Ok(None) => {
                let _ = ctx.log.print(Output::error_writer());
                Output::pretty_errorln(format_args!("error loading current directory"));
                Output::flush();
                return Err(bun_core::err!(CouldntReadCurrentDirectory));
            }
            Err(err) => {
                if !log_errors {
                    return Err(bun_core::err!(CouldntReadCurrentDirectory));
                }
                let _ = ctx.log.print(Output::error_writer());
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> <b>{}<r> loading directory {}",
                    err,
                    bun_core::fmt::quote(this_transpiler.fs.top_level_dir),
                ));
                Output::flush();
                return Err(err);
            }
        };

        this_transpiler.resolver.store_fd = false;

        if !had_env {
            this_transpiler.env.load_process()?;

            if let Some(node_env) = this_transpiler.env.get(b"NODE_ENV") {
                if bun_str::strings::eql_comptime(node_env, b"production") {
                    this_transpiler.options.production = true;
                }
            }

            // Always skip default .env files for package.json script runner
            // (see comment in env_loader.zig:542-548 - the script's own bun instance loads .env)
            let _ = this_transpiler.run_env_loader(true);
        }

        let _ = this_transpiler
            .env
            .map
            .put_default(b"npm_config_local_prefix", this_transpiler.fs.top_level_dir);

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_aio::parent_death_watchdog::is_enabled() {
            let _ = this_transpiler
                .env
                .map
                .put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1");
        }

        // we have no way of knowing what version they're expecting without running the node executable
        // running the node executable is too slow
        // so we will just hardcode it to LTS
        let _ = this_transpiler.env.map.put_default(
            b"npm_config_user_agent",
            // the use of npm/? is copying yarn
            // e.g.
            // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
            const_str::concat!(
                "bun/",
                Global::package_json_version,
                " npm/? node/v",
                bun_core::env::REPORTED_NODEJS_VERSION,
                " ",
                Global::os_name,
                " ",
                Global::arch_name,
            )
            .as_bytes(),
        );

        if this_transpiler.env.get(b"npm_execpath").is_none() {
            // we don't care if this fails
            if let Ok(self_exe) = bun_core::self_exe_path() {
                let _ = this_transpiler
                    .env
                    .map
                    .put_default(b"npm_execpath", self_exe.as_bytes());
            }
        }

        // SAFETY: read_dir_info returned Some — pointer is owned by resolver's arena and
        // valid for the resolver's lifetime.
        if let Some(package_json) = unsafe { (*root_dir_info).enclosing_package_json } {
            let pkg = unsafe { &*package_json };
            if !pkg.name.is_empty()
                && this_transpiler.env.map.get(b"npm_package_name").is_none()
            {
                let _ = this_transpiler.env.map.put(b"npm_package_name", pkg.name);
            }

            let _ = this_transpiler
                .env
                .map
                .put_default(b"npm_package_json", pkg.source.path.text);

            if !pkg.version.is_empty()
                && this_transpiler.env.map.get(b"npm_package_version").is_none()
            {
                let _ = this_transpiler
                    .env
                    .map
                    .put(b"npm_package_version", pkg.version);
            }

            if let Some(config) = pkg.config.as_ref() {
                let _ = this_transpiler.env.map.ensure_unused_capacity(config.len());
                for (k, v) in config.iter() {
                    let key = bun_str::strings::concat(&[b"npm_package_config_", k]);
                    this_transpiler.env.map.put_assume_capacity(&key, v);
                }
            }
        }

        Ok(root_dir_info)
    }
}

#[cfg(not(any()))]
impl RunCommand {
    pub fn find_shell(_path: &[u8], _cwd: &[u8]) -> Option<&'static [u8]> {
        todo!("B-2: RunCommand::find_shell")
    }
    pub fn create_fake_temporary_node_executable(
        _path: &mut Vec<u8>,
        _optional_bun_path: &mut &[u8],
    ) -> Result<(), ()> {
        todo!("B-2: RunCommand::create_fake_temporary_node_executable")
    }
}

// ──────────────────────────────────────────────────────────────────────────

thread_local! {
    static INITIALIZED_STORE: Cell<bool> = const { Cell::new(false) };
}

pub const BUN_HASH_TAG: &[u8] = b".bun-tag-";

/// Length of `u64::MAX` formatted as lowercase hex (`ffffffffffffffff`).
pub const MAX_HEX_HASH_LEN: usize = {
    // Zig computed this with std.fmt.bufPrint at comptime; u64::MAX in hex is
    // always 16 nibbles.
    let mut n = u64::MAX;
    let mut len = 0usize;
    while n != 0 {
        n >>= 4;
        len += 1;
    }
    len
};
const _: () = assert!(MAX_HEX_HASH_LEN == 16);

pub const MAX_BUNTAG_HASH_BUF_LEN: usize = MAX_HEX_HASH_LEN + BUN_HASH_TAG.len() + 1;
pub type BuntagHashBuf = [u8; MAX_BUNTAG_HASH_BUF_LEN];

pub fn buntaghashbuf_make(buf: &mut BuntagHashBuf, patch_hash: u64) -> &mut [u8] {
    buf[0..BUN_HASH_TAG.len()].copy_from_slice(BUN_HASH_TAG);
    // std.fmt.bufPrint(buf[bun_hash_tag.len..], "{x}", .{patch_hash})
    let digits_len = {
        use std::io::Write;
        let mut cursor = &mut buf[BUN_HASH_TAG.len()..];
        let before = cursor.len();
        write!(cursor, "{:x}", patch_hash).expect("unreachable"); // error.NoSpaceLeft => unreachable
        before - cursor.len()
    };
    buf[BUN_HASH_TAG.len() + digits_len] = 0;
    // TODO(b1): return &mut ZStr once bun_str::ZStr::from_raw_mut is available
    &mut buf[..BUN_HASH_TAG.len() + digits_len]
}

pub struct StorePathFormatter<'a> {
    str: &'a [u8],
}

impl<'a> fmt::Display for StorePathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // if (!this.opts.replace_slashes) {
        //     try writer.writeAll(this.str);
        //     return;
        // }

        for &c in self.str {
            match c {
                b'/' => f.write_str("+")?,
                b'\\' => f.write_str("+")?,
                _ => write!(f, "{}", bstr::BStr::new(core::slice::from_ref(&c)))?,
            }
        }
        Ok(())
    }
}

pub fn fmt_store_path(str: &[u8]) -> StorePathFormatter<'_> {
    StorePathFormatter { str }
}

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
pub static ALIGNMENT_BYTES_TO_REPEAT_BUFFER: [u8; 144] = [0u8; 144];

pub fn initialize_store() {
    #[cfg(any())]
    {
        if INITIALIZED_STORE.with(|c| c.get()) {
            js_ast::Expr::Data::Store::reset();
            js_ast::Stmt::Data::Store::reset();
            return;
        }

        INITIALIZED_STORE.with(|c| c.set(true));
        js_ast::Expr::Data::Store::create();
        js_ast::Stmt::Data::Store::create();
    }
    #[cfg(not(any()))]
    { todo!("B-2: initialize_store") }
}

/// The default store we use pre-allocates around 16 MB of memory per thread
/// That adds up in multi-threaded scenarios.
/// ASTMemoryAllocator uses a smaller fixed buffer allocator
pub fn initialize_mini_store() {
    #[cfg(any())]
    {
        use bun_alloc::Arena;
        use bun_js_parser as js_ast;

        struct MiniStore {
            heap: Arena,
            memory_allocator: js_ast::ASTMemoryAllocator,
        }

        thread_local! {
            static INSTANCE: Cell<Option<*mut MiniStore>> = const { Cell::new(None) };
        }

        INSTANCE.with(|instance| {
            if instance.get().is_none() {
                let mut heap = Arena::new();
                // TODO(port): ASTMemoryAllocator construction — Zig threads heap.allocator()
                // into the AST allocator; in Rust the Bump (`Arena`) is passed by reference.
                let memory_allocator = js_ast::ASTMemoryAllocator::new(&heap);
                let mini_store = Box::into_raw(Box::new(MiniStore {
                    heap,
                    memory_allocator,
                }));
                // SAFETY: just allocated, non-null, thread-local exclusive access
                unsafe {
                    (*mini_store).memory_allocator.reset();
                    (*mini_store).memory_allocator.push();
                }
                instance.set(Some(mini_store));
            } else {
                // SAFETY: set above on this thread, never freed
                let mini_store = unsafe { &mut *instance.get().unwrap() };
                if mini_store
                    .memory_allocator
                    .stack_allocator
                    .fixed_buffer_allocator
                    .end_index
                    >= mini_store
                        .memory_allocator
                        .stack_allocator
                        .fixed_buffer_allocator
                        .buffer
                        .len()
                        .saturating_sub(1)
                {
                    // PERF(port): was arena bulk-free (heap.deinit() + re-init) — profile in Phase B
                    mini_store.heap = Arena::new();
                    // TODO(port): re-seat memory_allocator.allocator at the new heap
                }
                mini_store.memory_allocator.reset();
                mini_store.memory_allocator.push();
            }
        });
    }
    #[cfg(not(any()))]
    { todo!("B-2: initialize_mini_store") }
}

pub type PackageID = u32;
pub type DependencyID = u32;

// pub enum DependencyID: u32 {
//     root = max - 1,
//     invalid = max,
//     _,
//
//     const max = u32::MAX;
// }

pub const INVALID_PACKAGE_ID: PackageID = PackageID::MAX;
pub const INVALID_DEPENDENCY_ID: DependencyID = DependencyID::MAX;

pub type PackageNameAndVersionHash = u64;
/// Use String.Builder.stringHash to compute this
pub type PackageNameHash = u64;
/// @truncate String.Builder.stringHash to compute this
pub type TruncatedPackageNameHash = u32;

pub struct Aligner;

impl Aligner {
    pub fn write<W: std::io::Write>(writer: &mut W, pos: usize) -> std::io::Result<usize> {
        // TODO(port): narrow error set / use bun_io::Write once available
        let to_write = Self::skip_amount_with_align(core::mem::align_of::<u64>(), pos);

        let remainder: &[u8] =
            &ALIGNMENT_BYTES_TO_REPEAT_BUFFER[0..to_write.min(ALIGNMENT_BYTES_TO_REPEAT_BUFFER.len())];
        writer.write_all(remainder)?;

        Ok(to_write)
    }

    #[inline]
    pub fn skip_amount<T>(pos: usize) -> usize {
        Self::skip_amount_with_align(core::mem::align_of::<T>(), pos)
    }

    #[inline]
    fn skip_amount_with_align(align: usize, pos: usize) -> usize {
        // std.mem.alignForward(usize, pos, align) - pos
        pos.next_multiple_of(align) - pos
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Origin {
    Local = 0,
    Npm = 1,
    Tarball = 2,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Features {
    pub dependencies: bool,
    pub dev_dependencies: bool,
    pub is_main: bool,
    pub optional_dependencies: bool,
    pub peer_dependencies: bool,
    pub trusted_dependencies: bool,
    pub workspaces: bool,
    pub patched_dependencies: bool,

    pub check_for_duplicate_dependencies: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self {
            dependencies: true,
            dev_dependencies: false,
            is_main: false,
            optional_dependencies: false,
            peer_dependencies: true,
            trusted_dependencies: false,
            workspaces: false,
            patched_dependencies: false,
            check_for_duplicate_dependencies: false,
        }
    }
}

impl Features {
    pub fn behavior(self) -> Behavior {
        let mut out: u8 = 0;
        out |= (self.dependencies as u8) << 1;
        out |= (self.optional_dependencies as u8) << 2;
        out |= (self.dev_dependencies as u8) << 3;
        out |= (self.peer_dependencies as u8) << 4;
        out |= (self.workspaces as u8) << 5;
        // SAFETY: Behavior is #[repr(transparent)] over u8 in dependency stub
        // TODO(port): use Behavior::from_bits_retain if Behavior becomes bitflags!
        unsafe { core::mem::transmute::<u8, Behavior>(out) }
    }

    pub const MAIN: Features = Features {
        check_for_duplicate_dependencies: true,
        dev_dependencies: true,
        is_main: true,
        optional_dependencies: true,
        trusted_dependencies: true,
        patched_dependencies: true,
        workspaces: true,
        dependencies: true,
        peer_dependencies: true,
    };

    pub const FOLDER: Features = Features {
        dev_dependencies: true,
        optional_dependencies: true,
        dependencies: true,
        is_main: false,
        peer_dependencies: true,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const WORKSPACE: Features = Features {
        dev_dependencies: true,
        optional_dependencies: true,
        trusted_dependencies: true,
        dependencies: true,
        is_main: false,
        peer_dependencies: true,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const LINK: Features = Features {
        dependencies: false,
        peer_dependencies: false,
        dev_dependencies: false,
        is_main: false,
        optional_dependencies: false,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const NPM: Features = Features {
        optional_dependencies: true,
        dependencies: true,
        dev_dependencies: false,
        is_main: false,
        peer_dependencies: true,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const TARBALL: Features = Self::NPM;

    pub const NPM_MANIFEST: Features = Features {
        optional_dependencies: true,
        dependencies: true,
        dev_dependencies: false,
        is_main: false,
        peer_dependencies: true,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };
}

#[repr(u8)] // Zig: enum(u4); u8 is the smallest repr Rust allows
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum PreinstallState {
    Unknown = 0,
    Done,
    Extract,
    Extracting,
    CalcPatchHash,
    CalcingPatchHash,
    ApplyPatch,
    ApplyingPatch,
}

#[derive(Default)]
pub struct ExtractDataJson {
    pub path: Box<[u8]>,
    pub buf: Vec<u8>,
}

#[derive(Default)]
pub struct ExtractData {
    pub url: Box<[u8]>,
    pub resolved: Box<[u8]>,
    pub json: Option<ExtractDataJson>,
    /// Integrity hash computed from the raw tarball bytes.
    /// Used for HTTPS/local tarball dependencies where the hash
    /// is not available from a registry manifest.
    pub integrity: Integrity,
}

pub struct DependencyInstallContext {
    pub tree_id: lockfile::tree::Id,
    pub path: Vec<u8>,
    pub dependency_id: DependencyID,
}

impl DependencyInstallContext {
    pub fn new(dependency_id: DependencyID) -> Self {
        Self {
            tree_id: 0,
            path: Vec::new(),
            dependency_id,
        }
    }
}

pub enum TaskCallbackContext {
    Dependency(DependencyID),
    DependencyInstallContext(DependencyInstallContext),
    IsolatedPackageInstallContext(isolated_install::store::EntryId),
    RootDependency(DependencyID),
    RootRequestId(PackageID),
}

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.

// TODO(b1): thiserror::Error derive removed — re-add once error chain is wired
#[derive(strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum PackageManifestError {
    PackageManifestHTTP400,
    PackageManifestHTTP401,
    PackageManifestHTTP402,
    PackageManifestHTTP403,
    PackageManifestHTTP404,
    PackageManifestHTTP4xx,
    PackageManifestHTTP5xx,
}

impl core::fmt::Display for PackageManifestError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(*self))
    }
}

#[cfg(any())] // TODO(b1): bun_core::Error::from_name missing
impl From<PackageManifestError> for bun_core::Error {
    fn from(e: PackageManifestError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/install.zig (295 lines)
//   confidence: medium
//   todos:      5
//   notes:      lib.rs for bun_install crate; module decls/re-exports need Phase B path fixup; ASTMemoryAllocator/Arena interop in initialize_mini_store needs verification
// ──────────────────────────────────────────────────────────────────────────

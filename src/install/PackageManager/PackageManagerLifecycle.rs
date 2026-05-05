use core::sync::atomic::Ordering;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::ArrayHashMap;
use bun_core::{fmt as bun_fmt, Output};
use bun_paths as Path;
use bun_semver::String as SemverString;
use bun_str::{strings, ZStr};
use bun_sys as Syscall;
use bun_threading::Mutex;


use bun_fs::FileSystem;

use bun_install::lockfile::{self, Lockfile, Package};
use bun_install::{
    invalid_package_id, LifecycleScriptSubprocess, PackageID, PackageManager, PreinstallState,
    TruncatedPackageNameHash,
};

pub struct LifecycleScriptTimeLog {
    mutex: Mutex,
    list: Vec<LifecycleScriptTimeLogEntry>,
}

pub struct LifecycleScriptTimeLogEntry {
    // TODO(port): lifetime — borrows lockfile string buffer; using 'static as Phase-A placeholder
    pub package_name: &'static [u8],
    pub script_id: u8,
    /// nanosecond duration
    pub duration: u64,
}

impl Default for LifecycleScriptTimeLog {
    fn default() -> Self {
        Self {
            mutex: Mutex::default(),
            list: Vec::new(),
        }
    }
}

impl LifecycleScriptTimeLog {
    pub fn append_concurrent(&mut self, entry: LifecycleScriptTimeLogEntry) {
        self.mutex.lock();
        // TODO(port): consider `Mutex<Vec<Entry>>` so the guard scopes the borrow
        self.list.push(entry);
        self.mutex.unlock();
    }

    /// this can be called if .start was never called
    pub fn print_and_deinit(mut self) {
        if cfg!(debug_assertions) {
            if !self.mutex.try_lock() {
                panic!("LifecycleScriptTimeLog.print is not intended to be thread-safe");
            }
            self.mutex.unlock();
        }

        if !self.list.is_empty() {
            let longest: &LifecycleScriptTimeLogEntry = 'longest: {
                let mut i: usize = 0;
                let mut longest: u64 = self.list[0].duration;
                for (j, item) in self.list.iter().enumerate().skip(1) {
                    if item.duration > longest {
                        i = j;
                        longest = item.duration;
                    }
                }
                break 'longest &self.list[i];
            };

            // extra \n will print a blank line after this one
            Output::warn(format_args!(
                "{}'s {} script took {}\n\n",
                BStr::new(longest.package_name),
                BStr::new(Lockfile::Scripts::NAMES[longest.script_id as usize]),
                bun_fmt::fmt_duration_one_decimal(longest.duration),
            ));
            Output::flush();
        }
        // self.list dropped here (was `log.list.deinit(allocator)`)
    }
}

impl PackageManager {
    pub fn ensure_preinstall_state_list_capacity(&mut self, count: usize) {
        if self.preinstall_state.len() >= count {
            return;
        }

        let offset = self.preinstall_state.len();
        self.preinstall_state
            .reserve(count.saturating_sub(self.preinstall_state.len()));
        // expandToCapacity + @memset(.., .unknown)
        self.preinstall_state
            .resize(self.preinstall_state.capacity(), PreinstallState::Unknown);
        let _ = offset; // PORT NOTE: resize already fills [offset..] with Unknown
    }

    pub fn set_preinstall_state(
        &mut self,
        package_id: PackageID,
        lockfile: &Lockfile,
        value: PreinstallState,
    ) {
        self.ensure_preinstall_state_list_capacity(lockfile.packages.len());
        self.preinstall_state[package_id as usize] = value;
    }

    pub fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState {
        if (package_id as usize) >= self.preinstall_state.len() {
            return PreinstallState::Unknown;
        }
        self.preinstall_state[package_id as usize]
    }

    pub fn determine_preinstall_state(
        &mut self,
        pkg: Package,
        lockfile: &mut Lockfile,
        out_name_and_version_hash: &mut Option<u64>,
        out_patchfile_hash: &mut Option<u64>,
    ) -> PreinstallState {
        match self.get_preinstall_state(pkg.meta.id) {
            PreinstallState::Unknown => {
                // Do not automatically start downloading packages which are disabled
                // i.e. don't download all of esbuild's versions or SWCs
                if pkg.is_disabled(self.options.cpu, self.options.os) {
                    self.set_preinstall_state(pkg.meta.id, lockfile, PreinstallState::Done);
                    return PreinstallState::Done;
                }

                let patch_hash: Option<u64> = 'brk: {
                    if self.lockfile.patched_dependencies.len() == 0 {
                        break 'brk None;
                    }
                    // PERF(port): was stack-fallback (std.heap.stackFallback(1024, ...))
                    let mut name_and_version: Vec<u8> = Vec::new();
                    write!(
                        &mut name_and_version,
                        "{}@{}",
                        BStr::new(pkg.name.slice(self.lockfile.buffers.string_bytes.as_slice())),
                        pkg.resolution
                            .fmt(self.lockfile.buffers.string_bytes.as_slice(), Path::Style::Posix),
                    )
                    .expect("unreachable");
                    let name_and_version_hash =
                        SemverString::Builder::string_hash(&name_and_version);
                    let Some(patched_dep) = self
                        .lockfile
                        .patched_dependencies
                        .get(&name_and_version_hash)
                    else {
                        break 'brk None;
                    };
                    // Zig: `defer out_name_and_version_hash.* = name_and_version_hash;`
                    // Runs on every exit path after this point.
                    if patched_dep.patchfile_hash_is_null {
                        *out_name_and_version_hash = Some(name_and_version_hash);
                        self.set_preinstall_state(
                            pkg.meta.id,
                            self.lockfile,
                            PreinstallState::CalcPatchHash,
                        );
                        return PreinstallState::CalcPatchHash;
                    }
                    *out_patchfile_hash = Some(patched_dep.patchfile_hash().unwrap());
                    *out_name_and_version_hash = Some(name_and_version_hash);
                    break 'brk Some(patched_dep.patchfile_hash().unwrap());
                };

                let folder_path: &[u8] = match pkg.resolution.tag {
                    lockfile::ResolutionTag::Git => self
                        .cached_git_folder_name_print_auto(&pkg.resolution.value.git, patch_hash),
                    lockfile::ResolutionTag::Github => self.cached_github_folder_name_print_auto(
                        &pkg.resolution.value.github,
                        patch_hash,
                    ),
                    lockfile::ResolutionTag::Npm => self.cached_npm_package_folder_name(
                        lockfile.str(&pkg.name),
                        pkg.resolution.value.npm.version,
                        patch_hash,
                    ),
                    lockfile::ResolutionTag::LocalTarball => self
                        .cached_tarball_folder_name(pkg.resolution.value.local_tarball, patch_hash),
                    lockfile::ResolutionTag::RemoteTarball => self.cached_tarball_folder_name(
                        pkg.resolution.value.remote_tarball,
                        patch_hash,
                    ),
                    _ => b"",
                };

                if folder_path.is_empty() {
                    self.set_preinstall_state(pkg.meta.id, lockfile, PreinstallState::Extract);
                    return PreinstallState::Extract;
                }

                if self.is_folder_in_cache(folder_path) {
                    self.set_preinstall_state(pkg.meta.id, lockfile, PreinstallState::Done);
                    return PreinstallState::Done;
                }

                // If the package is patched, then `folder_path` looks like:
                // is-even@1.0.0_patch_hash=abc8s6dedhsddfkahaldfjhlj
                //
                // If that's not in the cache, we need to put it there:
                // 1. extract the non-patched pkg in the cache
                // 2. copy non-patched pkg into temp dir
                // 3. apply patch to temp dir
                // 4. rename temp dir to `folder_path`
                if patch_hash.is_some() {
                    let idx = strings::index_of(folder_path, b"_patch_hash=").unwrap_or_else(|| {
                        panic!(
                            "Expected folder path to contain `patch_hash=`, this is a bug in Bun. \
                             Please file a GitHub issue."
                        )
                    });
                    let non_patched_path_ = &folder_path[..idx];
                    let non_patched_path = ZStr::from_bytes(non_patched_path_);
                    if self.is_folder_in_cache(non_patched_path.as_bytes()) {
                        self.set_preinstall_state(
                            pkg.meta.id,
                            self.lockfile,
                            PreinstallState::ApplyPatch,
                        );
                        // yay step 1 is already done for us
                        return PreinstallState::ApplyPatch;
                    }
                    // we need to extract non-patched pkg into the cache
                    self.set_preinstall_state(pkg.meta.id, lockfile, PreinstallState::Extract);
                    return PreinstallState::Extract;
                }

                self.set_preinstall_state(pkg.meta.id, lockfile, PreinstallState::Extract);
                PreinstallState::Extract
            }
            val => val,
        }
    }

    pub fn has_no_more_pending_lifecycle_scripts(&mut self) -> bool {
        self.report_slow_lifecycle_scripts();
        self.pending_lifecycle_script_tasks.load(Ordering::Relaxed) == 0
    }

    pub fn tick_lifecycle_scripts(&mut self) {
        self.event_loop.tick_once(self);
    }

    pub fn sleep(&mut self) {
        self.report_slow_lifecycle_scripts();
        Output::flush();
        self.event_loop
            .tick(self, Self::has_no_more_pending_lifecycle_scripts);
    }

    pub fn report_slow_lifecycle_scripts(&mut self) {
        let log_level = self.options.log_level;
        if log_level == LogLevel::Silent {
            return;
        }
        if bun_core::feature_flag::BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING.get() {
            return;
        }

        if let Some(longest_running) = self.active_lifecycle_scripts.peek() {
            if self.cached_tick_for_slow_lifecycle_script_logging
                == self.event_loop.iteration_number()
            {
                return;
            }
            self.cached_tick_for_slow_lifecycle_script_logging =
                self.event_loop.iteration_number();
            // TODO(port): bun.timespec.now(.allow_mocked_time) — verify exact bun_core API
            let current_time = bun_core::Timespec::now_allow_mocked_time().ns();
            let time_running = current_time.saturating_sub(longest_running.started_at);
            const NS_PER_S: u64 = 1_000_000_000;
            let interval: u64 = if log_level.is_verbose() {
                NS_PER_S * 5
            } else {
                NS_PER_S * 30
            };
            if time_running > interval
                && current_time.saturating_sub(self.last_reported_slow_lifecycle_script_at)
                    > interval
            {
                self.last_reported_slow_lifecycle_script_at = current_time;
                let package_name = longest_running.package_name;

                if !(package_name.len() > 1 && package_name[package_name.len() - 1] == b's') {
                    Output::warn(format_args!(
                        "{}'s postinstall cost you {}\n",
                        BStr::new(package_name),
                        bun_fmt::fmt_duration_one_decimal(time_running),
                    ));
                } else {
                    Output::warn(format_args!(
                        "{}' postinstall cost you {}\n",
                        BStr::new(package_name),
                        bun_fmt::fmt_duration_one_decimal(time_running),
                    ));
                }
                Output::flush();
            }
        }
    }

    pub fn load_root_lifecycle_scripts(&mut self, root_package: Package) {
        let binding_dot_gyp_path = Path::join_abs_string_z(
            FileSystem::instance().top_level_dir,
            &[b"binding.gyp"],
            Path::Style::Auto,
        );

        let buf = self.lockfile.buffers.string_bytes.as_slice();
        // need to clone because this is a copy before Lockfile.cleanWithLogger
        let name = root_package.name.slice(buf);

        // TODO(port): bun.AbsPath(.{ .sep = .auto }) — comptime-options type; verify Rust shape
        let mut top_level_dir = bun_paths::AbsPath::init_top_level_dir();
        // `defer top_level_dir.deinit()` — handled by Drop

        if root_package.scripts.has_any() {
            let add_node_gyp_rebuild_script = root_package.scripts.install.is_empty()
                && root_package.scripts.preinstall.is_empty()
                && Syscall::exists(binding_dot_gyp_path);

            self.root_lifecycle_scripts = root_package.scripts.create_list(
                self.lockfile,
                buf,
                &mut top_level_dir,
                name,
                lockfile::ScriptsListKind::Root,
                add_node_gyp_rebuild_script,
            );
        } else if Syscall::exists(binding_dot_gyp_path) {
            // no scripts exist but auto node gyp script needs to be added
            self.root_lifecycle_scripts = root_package.scripts.create_list(
                self.lockfile,
                buf,
                &mut top_level_dir,
                name,
                lockfile::ScriptsListKind::Root,
                true,
            );
        }
    }

    /// Used to be called from multiple threads; now single-threaded
    /// TODO: re-evaluate whether some variables still need to be atomic
    pub fn spawn_package_lifecycle_scripts(
        &mut self,
        ctx: Command::Context,
        list: lockfile::package::scripts::List,
        optional: bool,
        foreground: bool,
        install_ctx: Option<LifecycleScriptSubprocess::InstallCtx>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let log_level = self.options.log_level;
        let mut any_scripts = false;
        for maybe_item in list.items.iter() {
            if maybe_item.is_some() {
                any_scripts = true;
                break;
            }
        }
        if !any_scripts {
            return Ok(());
        }

        self.ensure_temp_node_gyp_script()?;

        let cwd = list.cwd;
        let this_transpiler = self.configure_env_for_scripts(ctx, log_level)?;

        let mut script_env = this_transpiler.env.map.clone_with_allocator()?;
        // `defer script_env.map.deinit()` — handled by Drop

        let original_path = script_env.get(b"PATH").unwrap_or(b"");

        // TODO(port): bun.EnvPath(.{}) — comptime-options type; verify Rust shape
        let mut path = bun_core::EnvPath::init_capacity(
            original_path.len() + 1 + b"node_modules/.bin".len() + cwd.len() + 1,
        )?;
        // `defer PATH.deinit()` — handled by Drop

        let mut parent: Option<&[u8]> = Some(cwd);

        while let Some(dir) = parent {
            let mut builder = path.path_component_builder();
            builder.append(dir);
            builder.append(b"node_modules/.bin");
            builder.apply()?;

            parent = bun_paths::dirname(dir);
        }

        path.append(original_path)?;
        script_env.put(b"PATH", path.slice())?;

        let envp = script_env.create_null_delimited_env_map()?;

        let shell_bin: Option<&[u8]> = 'shell_bin: {
            #[cfg(windows)]
            {
                break 'shell_bin None;
            }

            #[cfg(not(windows))]
            {
                if let Some(env_path) = self.env.get(b"PATH") {
                    // TODO(b0): RunCommand::find_shell arrives from move-in (bun_runtime::cli::RunCommand → install).
                    break 'shell_bin crate::RunCommand::find_shell(env_path, cwd);
                }

                break 'shell_bin None;
            }
        };

        LifecycleScriptSubprocess::spawn_package_scripts(
            self,
            list,
            envp,
            shell_bin,
            optional,
            log_level,
            foreground,
            install_ctx,
        )?;
        Ok(())
    }

    pub fn find_trusted_dependencies_from_update_requests(
        &mut self,
    ) -> ArrayHashMap<TruncatedPackageNameHash, ()> {
        let parts = self.lockfile.packages.slice();
        // find all deps originating from --trust packages from cli
        let mut set: ArrayHashMap<TruncatedPackageNameHash, ()> = ArrayHashMap::default();
        if self.options.do_.trust_dependencies_from_args && self.lockfile.packages.len() > 0 {
            let root_deps = parts.items_dependencies()
                [self.root_package_id.get(self.lockfile, self.workspace_name_hash) as usize];
            let mut dep_id = root_deps.off;
            let end = dep_id.saturating_add(root_deps.len);
            while dep_id < end {
                let root_dep = self.lockfile.buffers.dependencies[dep_id as usize];
                for request in self.update_requests.iter() {
                    if request.matches(root_dep, self.lockfile.buffers.string_bytes.as_slice()) {
                        let package_id = self.lockfile.buffers.resolutions[dep_id as usize];
                        if package_id == invalid_package_id {
                            continue;
                        }

                        let entry =
                            set.get_or_put(root_dep.name_hash as TruncatedPackageNameHash);
                        if !entry.found_existing {
                            let dependency_slice =
                                parts.items_dependencies()[package_id as usize];
                            add_dependencies_to_set(&mut set, self.lockfile, dependency_slice);
                        }
                        break;
                    }
                }
                dep_id += 1;
            }
        }

        set
    }
}

fn add_dependencies_to_set(
    names: &mut ArrayHashMap<TruncatedPackageNameHash, ()>,
    lockfile: &mut Lockfile,
    dependencies_slice: lockfile::DependencySlice,
) {
    let begin = dependencies_slice.off;
    let end = begin.saturating_add(dependencies_slice.len);
    let mut dep_id = begin;
    while dep_id < end {
        let package_id = lockfile.buffers.resolutions[dep_id as usize];
        if package_id == invalid_package_id {
            dep_id += 1;
            continue;
        }

        let dep = lockfile.buffers.dependencies[dep_id as usize];
        let entry = names.get_or_put(dep.name_hash as TruncatedPackageNameHash);
        if !entry.found_existing {
            let dependency_slice = lockfile.packages.items_dependencies()[package_id as usize];
            add_dependencies_to_set(names, lockfile, dependency_slice);
        }
        dep_id += 1;
    }
}

// TODO(port): LogLevel import path — likely bun_install::Options::LogLevel
use bun_install::LogLevel;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/PackageManagerLifecycle.zig (393 lines)
//   confidence: medium
//   todos:      7
//   notes:      self.lockfile vs &mut self overlap in set_preinstall_state calls will need borrowck reshaping; AbsPath/EnvPath comptime-option types and MultiArrayList .items(.field) accessors need Phase-B API confirmation
// ──────────────────────────────────────────────────────────────────────────

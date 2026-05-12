use crate::lockfile::package::PackageColumns as _;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::ArrayHashMap;
use bun_core::fmt::PathSep;
use bun_core::{Output, ZBox, fmt as bun_fmt, handle_oom};
use bun_core::{ZStr, strings};
use bun_paths::resolve_path::{join_abs_string_z, platform};
use bun_paths::{self as Path, AutoAbsPath, EnvPath};
use bun_semver::string::Builder as SemverStringBuilder;
use bun_sys as Syscall;
use bun_threading::Mutex;

use crate::bun_fs::FileSystem;

use super::directories;
use super::package_manager_options::Do;
use crate::lifecycle_script_runner::{
    InstallCtx, LifecycleScriptSubprocess as RealLifecycleScriptSubprocess,
};
use crate::lockfile_real::package::scripts::List as ScriptsList;
use crate::package_manager_real::Command;
use crate::resolution_real::Tag as ResolutionTag;
use bun_install::lockfile::{self, Lockfile, Package};
use bun_install::{
    PackageID, PackageManager, PreinstallState, TruncatedPackageNameHash, invalid_package_id,
};

pub struct LifecycleScriptTimeLog {
    mutex: Mutex,
    list: Vec<LifecycleScriptTimeLogEntry>,
}

pub struct LifecycleScriptTimeLogEntry {
    // PORT NOTE: Zig borrowed the lockfile string buffer (`string`). The Rust
    // `LifecycleScriptSubprocess.package_name` is owned (`Box<[u8]>`) and freed
    // on `destroy`, so the log entry must own its copy to avoid a dangling
    // borrow. The list is at most a few dozen entries per install.
    pub package_name: Box<[u8]>,
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
                BStr::new(&longest.package_name),
                lockfile::Scripts::NAMES[longest.script_id as usize],
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

    /// PORT NOTE: Zig `setPreinstallState(this, package_id, lockfile, value)` — the
    /// separate `lockfile` parameter only feeds `lockfile.packages.len` into
    /// `ensurePreinstallStateListCapacity`. Every Rust caller passes
    /// `self.lockfile` (or an alias of it), which would alias `&mut self`; the
    /// parameter is dropped here and `self.lockfile` is read directly to keep
    /// borrowck happy.
    pub fn set_preinstall_state(&mut self, package_id: PackageID, value: PreinstallState) {
        let count = self.lockfile.packages.len();
        self.ensure_preinstall_state_list_capacity(count);
        self.preinstall_state[package_id as usize] = value;
    }

    pub fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState {
        if (package_id as usize) >= self.preinstall_state.len() {
            return PreinstallState::Unknown;
        }
        self.preinstall_state[package_id as usize]
    }

    /// PORT NOTE: Zig `determinePreinstallState(manager, pkg, lockfile, …)` — the
    /// separate `lockfile` parameter is always `manager.lockfile` at every call
    /// site in the Rust port; collapsed onto `self.lockfile` to avoid the
    /// `&mut self` / `&self.lockfile` aliasing borrowck rejects.
    pub fn determine_preinstall_state(
        &mut self,
        pkg: &Package,
        out_name_and_version_hash: &mut Option<u64>,
        out_patchfile_hash: &mut Option<u64>,
    ) -> PreinstallState {
        match self.get_preinstall_state(pkg.meta.id) {
            PreinstallState::Unknown => {
                // Do not automatically start downloading packages which are disabled
                // i.e. don't download all of esbuild's versions or SWCs
                if pkg.is_disabled(self.options.cpu, self.options.os) {
                    self.set_preinstall_state(pkg.meta.id, PreinstallState::Done);
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
                        BStr::new(
                            pkg.name
                                .slice(self.lockfile.buffers.string_bytes.as_slice())
                        ),
                        pkg.resolution.fmt(
                            self.lockfile.buffers.string_bytes.as_slice(),
                            PathSep::Posix
                        ),
                    )
                    .expect("unreachable");
                    let name_and_version_hash = SemverStringBuilder::string_hash(&name_and_version);
                    let Some(patched_dep) = self
                        .lockfile
                        .patched_dependencies
                        .get(&name_and_version_hash)
                        .copied()
                    else {
                        break 'brk None;
                    };
                    // Zig: `defer out_name_and_version_hash.* = name_and_version_hash;`
                    // Runs on every exit path after this point.
                    if patched_dep.patchfile_hash_is_null {
                        *out_name_and_version_hash = Some(name_and_version_hash);
                        self.set_preinstall_state(pkg.meta.id, PreinstallState::CalcPatchHash);
                        return PreinstallState::CalcPatchHash;
                    }
                    *out_patchfile_hash = Some(patched_dep.patchfile_hash().unwrap());
                    *out_name_and_version_hash = Some(name_and_version_hash);
                    break 'brk Some(patched_dep.patchfile_hash().unwrap());
                };

                // SAFETY: each arm reads the union variant that matches the
                // `pkg.resolution.tag` just dispatched on; `Resolution` is
                // zero-initialised (`Value::zero()`) so even a stale tag yields
                // POD bytes, never uninit.
                let folder_path: &ZStr = match pkg.resolution.tag {
                    ResolutionTag::Git => directories::cached_git_folder_name_print_auto(
                        self,
                        pkg.resolution.git(),
                        patch_hash,
                    ),
                    ResolutionTag::Github => directories::cached_github_folder_name_print_auto(
                        self,
                        pkg.resolution.github(),
                        patch_hash,
                    ),
                    ResolutionTag::Npm => {
                        let name = pkg
                            .name
                            .slice(self.lockfile.buffers.string_bytes.as_slice());
                        directories::cached_npm_package_folder_name(
                            self,
                            name,
                            pkg.resolution.npm().version,
                            patch_hash,
                        )
                    }
                    ResolutionTag::LocalTarball => directories::cached_tarball_folder_name(
                        self,
                        *pkg.resolution.local_tarball(),
                        patch_hash,
                    ),
                    ResolutionTag::RemoteTarball => directories::cached_tarball_folder_name(
                        self,
                        *pkg.resolution.remote_tarball(),
                        patch_hash,
                    ),
                    _ => ZStr::EMPTY,
                };

                if folder_path.is_empty() {
                    self.set_preinstall_state(pkg.meta.id, PreinstallState::Extract);
                    return PreinstallState::Extract;
                }

                if directories::is_folder_in_cache(self, folder_path) {
                    self.set_preinstall_state(pkg.meta.id, PreinstallState::Done);
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
                    let idx = strings::index_of(folder_path.as_bytes(), b"_patch_hash=")
                        .unwrap_or_else(|| {
                            panic!(
                                "Expected folder path to contain `patch_hash=`, this is a bug in \
                                 Bun. Please file a GitHub issue."
                            )
                        });
                    // Zig: `allocator.dupeZ(u8, folder_path[..idx])` — owned NUL-terminated copy.
                    let non_patched_path = ZBox::from_bytes(&folder_path.as_bytes()[..idx]);
                    if directories::is_folder_in_cache(self, &non_patched_path) {
                        self.set_preinstall_state(pkg.meta.id, PreinstallState::ApplyPatch);
                        // yay step 1 is already done for us
                        return PreinstallState::ApplyPatch;
                    }
                    // we need to extract non-patched pkg into the cache
                    self.set_preinstall_state(pkg.meta.id, PreinstallState::Extract);
                    return PreinstallState::Extract;
                }

                self.set_preinstall_state(pkg.meta.id, PreinstallState::Extract);
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
        // PORT NOTE: reshaped for borrowck — `self.event_loop.tick_once(self)`
        // would borrow `self` twice. Erase `self` to a raw context pointer
        // first; `tick_once` only forwards it opaquely to task callbacks.
        let ctx = std::ptr::from_mut::<PackageManager>(self).cast::<core::ffi::c_void>();
        self.event_loop.tick_once(ctx);
    }

    pub fn sleep(&mut self) {
        self.report_slow_lifecycle_scripts();
        Output::flush();
        // PORT NOTE: see `tick_lifecycle_scripts` — `is_done` callback reborrows
        // `self` (the struct that owns `event_loop`), so use the raw-pointer
        // `tick_raw` variant which only holds `&mut event_loop` between
        // `is_done` calls.
        let ctx = std::ptr::from_mut::<PackageManager>(self).cast::<core::ffi::c_void>();
        let event_loop = core::ptr::addr_of_mut!(self.event_loop);
        // SAFETY: `event_loop` is valid for the duration; `is_done` reborrows
        // `*ctx` only while no `&mut event_loop` is live (per `tick_raw` contract).
        unsafe {
            bun_event_loop::AnyEventLoop::tick_raw(event_loop, ctx, |ctx| {
                // SAFETY: `ctx` is the `*mut PackageManager` erased above; live
                // for the duration of `sleep`.
                let this = unsafe { bun_ptr::callback_ctx::<PackageManager>(ctx) };
                this.has_no_more_pending_lifecycle_scripts()
            });
        }
    }

    pub fn report_slow_lifecycle_scripts(&mut self) {
        let log_level = self.options.log_level;
        if log_level == LogLevel::Silent {
            return;
        }
        if bun_core::env_var::feature_flag::BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING
            .get()
            .unwrap_or(false)
        {
            return;
        }

        let longest_running = self.active_lifecycle_scripts.peek();
        if longest_running.is_null() {
            return;
        }
        if self.cached_tick_for_slow_lifecycle_script_logging == self.event_loop.iteration_number()
        {
            return;
        }
        self.cached_tick_for_slow_lifecycle_script_logging = self.event_loop.iteration_number();
        // SAFETY: `peek()` returned a non-null intrusive heap node owned by
        // `active_lifecycle_scripts`; only read for its `started_at` /
        // `package_name` fields below.
        let longest_running = unsafe { &*longest_running };
        let current_time = bun_core::Timespec::now_allow_mocked_time().ns();
        let time_running = current_time.saturating_sub(longest_running.started_at);
        const NS_PER_S: u64 = 1_000_000_000;
        let interval: u64 = if log_level.is_verbose() {
            NS_PER_S * 5
        } else {
            NS_PER_S * 30
        };
        if time_running > interval
            && current_time.saturating_sub(self.last_reported_slow_lifecycle_script_at) > interval
        {
            self.last_reported_slow_lifecycle_script_at = current_time;
            let package_name: &[u8] = &longest_running.package_name;

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

    pub fn load_root_lifecycle_scripts(&mut self, root_package: &Package) {
        let binding_dot_gyp_path = join_abs_string_z::<platform::Auto>(
            FileSystem::instance().top_level_dir(),
            &[b"binding.gyp"],
        );

        let buf = self.lockfile.buffers.string_bytes.as_slice();
        // need to clone because this is a copy before Lockfile.cleanWithLogger
        let name = root_package.name.slice(buf);

        // Zig: `bun.AbsPath(.{ .sep = .auto })` — `AutoAbsPath` is the SEP=auto alias.
        let mut top_level_dir = AutoAbsPath::init_top_level_dir();
        // `defer top_level_dir.deinit()` — handled by Drop

        if root_package.scripts.has_any() {
            let add_node_gyp_rebuild_script = root_package.scripts.install.is_empty()
                && root_package.scripts.preinstall.is_empty()
                && Syscall::exists(binding_dot_gyp_path.as_bytes());

            self.root_lifecycle_scripts = root_package.scripts.create_list(
                &self.lockfile,
                buf,
                &mut top_level_dir,
                name,
                ResolutionTag::Root,
                add_node_gyp_rebuild_script,
            );
        } else if Syscall::exists(binding_dot_gyp_path.as_bytes()) {
            // no scripts exist but auto node gyp script needs to be added
            self.root_lifecycle_scripts = root_package.scripts.create_list(
                &self.lockfile,
                buf,
                &mut top_level_dir,
                name,
                ResolutionTag::Root,
                true,
            );
        }
    }

    /// Used to be called from multiple threads; now single-threaded
    /// TODO: re-evaluate whether some variables still need to be atomic
    pub fn spawn_package_lifecycle_scripts(
        &mut self,
        ctx: Command::Context<'_>,
        list: ScriptsList,
        optional: bool,
        foreground: bool,
        install_ctx: Option<InstallCtx<'_>>,
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

        // PORT NOTE: `list` is moved into `spawn_package_scripts` below; copy
        // `cwd` out so the PATH builder can borrow it independently.
        let cwd_owned: Vec<u8> = list.cwd.as_bytes().to_vec();
        let cwd: &[u8] = &cwd_owned;
        let this_transpiler = self.configure_env_for_scripts(ctx, log_level)?;

        let env_loader = this_transpiler.env_mut();
        let mut script_env = env_loader.map.clone_with_allocator()?;
        // `defer script_env.map.deinit()` — handled by Drop

        // PORT NOTE: `script_env.put` below needs `&mut`; copy PATH out so the
        // shared borrow does not span it.
        let original_path: Vec<u8> = script_env.get(b"PATH").unwrap_or(b"").to_vec();

        // Zig: `bun.EnvPath(.{})` — `EnvPathOptions` is currently fieldless.
        let mut path = EnvPath::init_capacity(
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

        path.append(original_path.as_slice())?;
        script_env.put(b"PATH", path.slice())?;

        // Zig: `try script_env.createNullDelimitedEnvMap(this.allocator)` —
        // allocated with the manager-lifetime allocator and never freed in this
        // scope; ownership transfers to `LifecycleScriptSubprocess`, which
        // re-uses it across every `spawn_next_script` in the chain. Move the
        // owning `NullDelimitedEnvMap` by value so its `K=V\0` buffers outlive
        // this stack frame (freed by the subprocess's `Drop`).
        let envp = script_env.create_null_delimited_env_map()?;

        let shell_bin: Option<&ZStr> = 'shell_bin: {
            #[cfg(windows)]
            {
                break 'shell_bin None;
            }

            #[cfg(not(windows))]
            {
                if let Some(env_path) = self.env().get(b"PATH") {
                    // `find_shell` stores its result NUL-terminated (see
                    // `RunCommand::find_shell`); reinterpret as `&ZStr`.
                    if let Some(found) = crate::RunCommand::find_shell(env_path, cwd) {
                        debug_assert!(found.last() == Some(&0));
                        // `find_shell` includes the trailing NUL in its
                        // `'static` storage; slice off the sentinel for the
                        // `ZStr` length.
                        break 'shell_bin Some(ZStr::from_slice_with_nul(found));
                    }
                }

                break 'shell_bin None;
            }
        };

        RealLifecycleScriptSubprocess::spawn_package_scripts(
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
        // find all deps originating from --trust packages from cli
        let mut set: ArrayHashMap<TruncatedPackageNameHash, ()> = ArrayHashMap::default();
        if self.options.do_.trust_dependencies_from_args() && self.lockfile.packages.len() > 0 {
            let root_id = self
                .root_package_id
                .get(&self.lockfile, self.workspace_name_hash) as usize;
            let root_deps = self.lockfile.packages.items_dependencies()[root_id];
            let mut dep_id = root_deps.off;
            let end = dep_id.saturating_add(root_deps.len);
            while dep_id < end {
                let root_dep = &self.lockfile.buffers.dependencies[dep_id as usize];
                for request in self.update_requests.iter() {
                    if request.matches(root_dep, self.lockfile.buffers.string_bytes.as_slice()) {
                        let package_id = self.lockfile.buffers.resolutions[dep_id as usize];
                        if package_id == invalid_package_id {
                            continue;
                        }

                        let entry = handle_oom(
                            set.get_or_put(root_dep.name_hash as TruncatedPackageNameHash),
                        );
                        if !entry.found_existing {
                            let dependency_slice =
                                self.lockfile.packages.items_dependencies()[package_id as usize];
                            add_dependencies_to_set(&mut set, &self.lockfile, dependency_slice);
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
    lockfile: &Lockfile,
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

        let dep = &lockfile.buffers.dependencies[dep_id as usize];
        let entry = handle_oom(names.get_or_put(dep.name_hash as TruncatedPackageNameHash));
        if !entry.found_existing {
            let dependency_slice = lockfile.packages.items_dependencies()[package_id as usize];
            add_dependencies_to_set(names, lockfile, dependency_slice);
        }
        dep_id += 1;
    }
}

use bun_install::LogLevel;

// ──────────────────────────────────────────────────────────────────────────
// Free-function re-export surface — Zig declares these at file scope with an
// explicit `*PackageManager` first param. The `impl PackageManager` bodies
// above are the canonical port; these thin shims keep the
// `pub use lifecycle::{...}` re-exports in `PackageManager.rs` resolving the
// same way `PackageManagerDirectories.rs` / `PackageManagerEnqueue.rs` do.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn ensure_preinstall_state_list_capacity(this: &mut PackageManager, count: usize) {
    this.ensure_preinstall_state_list_capacity(count)
}

#[inline]
pub fn set_preinstall_state(
    this: &mut PackageManager,
    package_id: PackageID,
    value: PreinstallState,
) {
    this.set_preinstall_state(package_id, value)
}

#[inline]
pub fn get_preinstall_state(this: &PackageManager, package_id: PackageID) -> PreinstallState {
    this.get_preinstall_state(package_id)
}

#[inline]
pub fn determine_preinstall_state(
    this: &mut PackageManager,
    pkg: &Package,
    out_name_and_version_hash: &mut Option<u64>,
    out_patchfile_hash: &mut Option<u64>,
) -> PreinstallState {
    this.determine_preinstall_state(pkg, out_name_and_version_hash, out_patchfile_hash)
}

#[inline]
pub fn has_no_more_pending_lifecycle_scripts(this: &mut PackageManager) -> bool {
    this.has_no_more_pending_lifecycle_scripts()
}

#[inline]
pub fn tick_lifecycle_scripts(this: &mut PackageManager) {
    this.tick_lifecycle_scripts()
}

#[inline]
pub fn sleep(this: &mut PackageManager) {
    this.sleep()
}

#[inline]
pub fn report_slow_lifecycle_scripts(this: &mut PackageManager) {
    this.report_slow_lifecycle_scripts()
}

#[inline]
pub fn load_root_lifecycle_scripts(this: &mut PackageManager, root_package: &Package) {
    this.load_root_lifecycle_scripts(root_package)
}

#[inline]
pub fn spawn_package_lifecycle_scripts(
    this: &mut PackageManager,
    ctx: Command::Context<'_>,
    list: ScriptsList,
    optional: bool,
    foreground: bool,
    install_ctx: Option<InstallCtx<'_>>,
) -> Result<(), bun_core::Error> {
    this.spawn_package_lifecycle_scripts(ctx, list, optional, foreground, install_ctx)
}

#[inline]
pub fn find_trusted_dependencies_from_update_requests(
    this: &mut PackageManager,
) -> ArrayHashMap<TruncatedPackageNameHash, ()> {
    this.find_trusted_dependencies_from_update_requests()
}

// ported from: src/install/PackageManager/PackageManagerLifecycle.zig

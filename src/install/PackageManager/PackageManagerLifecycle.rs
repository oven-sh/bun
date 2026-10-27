use crate::lockfile::package::PackageColumns as _;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::ArrayHashMap;
use bun_core::fmt::PathSep;
use bun_core::{Output, ZBox, fmt as bun_fmt, handle_oom};
use bun_core::{ZStr, strings};
use bun_paths::resolve_path::{join_abs_string_z, platform};
use bun_paths::{AutoAbsPath, EnvPath};
use bun_semver::string::Builder as SemverStringBuilder;
use bun_sys as Syscall;

use crate::bun_fs::FileSystem;
use crate::bun_json;
use crate::initialize_store;

use super::directories;
use crate::lifecycle_script_runner::{
    InstallCtx, LifecycleScriptSubprocess as RealLifecycleScriptSubprocess,
};
use crate::lockfile_real::package::scripts::List as ScriptsList;
use crate::package_manager_real::Command;
use crate::resolution_real::Tag as ResolutionTag;
use bun_install::lockfile::{Lockfile, Package};
use bun_install::{Behavior, PackageID, PackageManager, PreinstallState, invalid_package_id};

impl PackageManager {
    pub(crate) fn ensure_preinstall_state_list_capacity(&mut self, count: usize) {
        if self.preinstall_state.len() >= count {
            return;
        }

        self.preinstall_state
            .reserve(count - self.preinstall_state.len());
        self.preinstall_state
            .resize(self.preinstall_state.capacity(), PreinstallState::Unknown);
    }

    /// A separate `lockfile` parameter would only feed `lockfile.packages.len` into
    /// `ensurePreinstallStateListCapacity`. Every caller passes
    /// `self.lockfile` (or an alias of it), which would alias `&mut self`;
    /// `self.lockfile` is read directly instead to keep
    /// borrowck happy.
    pub(crate) fn set_preinstall_state(&mut self, package_id: PackageID, value: PreinstallState) {
        let count = self.lockfile.packages.len();
        self.ensure_preinstall_state_list_capacity(count);
        self.preinstall_state[package_id as usize] = value;
    }

    pub(crate) fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState {
        if (package_id as usize) >= self.preinstall_state.len() {
            return PreinstallState::Unknown;
        }
        self.preinstall_state[package_id as usize]
    }

    /// A separate `lockfile` parameter would always be `manager.lockfile` at every call
    /// site; collapsed onto `self.lockfile` to avoid the
    /// `&mut self` / `&self.lockfile` aliasing borrowck rejects.
    /// `dependency` is the dependency `pkg` is being resolved for.
    pub fn determine_preinstall_state(
        &mut self,
        pkg: &Package,
        dependency: Behavior,
        out_name_and_version_hash: &mut Option<u64>,
        out_patchfile_hash: &mut Option<u64>,
    ) -> PreinstallState {
        match self.get_preinstall_state(pkg.meta.id) {
            PreinstallState::Unknown => {
                // Do not automatically start downloading packages which are disabled
                // i.e. don't download all of esbuild's versions or SWCs
                if !pkg.meta.arch.is_match(self.options.cpu)
                    || !pkg.meta.os.is_match(self.options.os)
                {
                    self.set_preinstall_state(pkg.meta.id, PreinstallState::Done);
                    return PreinstallState::Done;
                }
                // This only applies to this dependency. The state isn't changed, so a regular
                // dependency on the package still installs it.
                if !pkg
                    .meta
                    .libc
                    .is_match(self.options.libc.for_dependency(dependency))
                {
                    return PreinstallState::Done;
                }

                let patch_hash: Option<u64> = 'brk: {
                    if self.lockfile.patched_dependencies.len() == 0 {
                        break 'brk None;
                    }
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
                    // `*out_name_and_version_hash` is set on every exit path after this point.
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
                    ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                        directories::cached_tarball_folder_name(
                            self,
                            &pkg.meta.integrity,
                            &pkg.resolution,
                            patch_hash,
                        )
                    }
                    _ => ZStr::EMPTY,
                };

                if folder_path.is_empty() {
                    self.set_preinstall_state(pkg.meta.id, PreinstallState::Extract);
                    return PreinstallState::Extract;
                }

                let in_cache = if patch_hash.is_some() {
                    directories::is_folder_in_cache(self, folder_path)
                } else {
                    directories::is_package_in_cache(self, folder_path, pkg.resolution.tag)
                };
                if in_cache {
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
                    // Owned NUL-terminated copy.
                    let non_patched_path = ZBox::from_bytes(&folder_path.as_bytes()[..idx]);
                    if directories::is_package_in_cache(self, &non_patched_path, pkg.resolution.tag)
                    {
                        self.set_preinstall_state(pkg.meta.id, PreinstallState::ApplyPatch);
                        // yay step 1 is already done for us
                        return PreinstallState::ApplyPatch;
                    }
                    // we need to extract non-patched pkg into the cache
                }

                self.set_preinstall_state(pkg.meta.id, PreinstallState::Extract);
                PreinstallState::Extract
            }
            val => val,
        }
    }

    pub(crate) fn has_no_more_pending_lifecycle_scripts(&mut self) -> bool {
        self.report_slow_lifecycle_scripts();
        self.pending_lifecycle_script_tasks.load(Ordering::Relaxed) == 0
    }

    pub(crate) fn tick_lifecycle_scripts(&mut self) {
        // reshaped for borrowck — `self.event_loop.tick_once(self)`
        // would borrow `self` twice. Erase `self` to a raw context pointer
        // first; `tick_once` only forwards it opaquely to task callbacks.
        let ctx = std::ptr::from_mut::<PackageManager>(self).cast::<core::ffi::c_void>();
        self.event_loop.tick_once(ctx);
    }

    pub fn sleep(&mut self) {
        self.report_slow_lifecycle_scripts();
        Output::flush();
        // see `tick_lifecycle_scripts` — `is_done` callback reborrows
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
                let this = bun_ptr::callback_ctx::<PackageManager>(ctx);
                this.has_no_more_pending_lifecycle_scripts()
            });
        }
    }

    pub(crate) fn report_slow_lifecycle_scripts(&mut self) {
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

            let ends_in_s = package_name.len() > 1 && package_name.ends_with(b"s");
            bun_core::warn!(
                "{}'{} postinstall cost you {}\n",
                BStr::new(package_name),
                if ends_in_s { "" } else { "s" },
                bun_fmt::fmt_duration_one_decimal(time_running),
            );
            Output::flush();
        }
    }

    pub(crate) fn load_root_lifecycle_scripts(&mut self, root_package: &Package) {
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        // need to clone because this is a copy before Lockfile.cleanWithLogger
        let name = root_package.name.slice(buf);

        let mut top_level_dir = AutoAbsPath::init_top_level_dir();

        let add_node_gyp_rebuild_script = root_package
            .scripts
            .wants_default_node_gyp(FileSystem::instance().top_level_dir(), None);

        if root_package.scripts.has_any() || add_node_gyp_rebuild_script {
            self.root_lifecycle_scripts = root_package.scripts.create_list(
                buf,
                &mut top_level_dir,
                name,
                ResolutionTag::Root,
                add_node_gyp_rebuild_script,
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
    ) -> Result<(), crate::Error> {
        let log_level = self.options.log_level;
        if !list.items.iter().any(Option::is_some) {
            return Ok(());
        }

        self.ensure_temp_node_gyp_script()?;

        // `list` is moved into `spawn_package_scripts` below; copy
        // `cwd` out so the PATH builder can borrow it independently.
        let cwd_owned: Vec<u8> = list.cwd.as_bytes().to_vec();
        let cwd: &[u8] = &cwd_owned;
        if cwd.len() + "/node_modules/.bin".len() >= bun_paths::MAX_PATH_BYTES {
            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
        }
        let this_transpiler = self.configure_env_for_scripts(ctx)?;

        let env_loader = this_transpiler.env_mut();
        let mut script_env = env_loader.map.clone_with_allocator()?;

        // `script_env.put` below needs `&mut`; copy PATH out so the
        // shared borrow does not span it.
        let original_path: Vec<u8> = script_env.get(b"PATH").unwrap_or(b"").to_vec();

        let mut path = EnvPath::init_capacity(
            original_path.len() + 1 + b"node_modules/.bin".len() + cwd.len() + 1,
        )?;

        let mut parent: Option<&[u8]> = Some(cwd);
        // An untrusted package can link a `node` or `sh` into a shared `.bin`, so that directory is
        // searched last.
        let mut inherited_path = list.is_dependency.then_some(original_path.as_slice());
        let store_entry = bun_paths::path_literal!("/node_modules/.bun/").as_bytes();

        while let Some(dir) = parent {
            if dir.len() != cwd.len() && !strings::contains(dir, store_entry) {
                if let Some(inherited) = inherited_path.take() {
                    append_path_without_ancestor_bins(&mut path, inherited, cwd)?;
                }
            }

            let mut builder = path.path_component_builder();
            builder.append(dir);
            builder.append(b"node_modules/.bin");
            builder.apply()?;

            parent = bun_paths::dirname(dir);
        }

        match inherited_path {
            Some(inherited) => append_path_without_ancestor_bins(&mut path, inherited, cwd)?,
            None if list.is_dependency => {}
            None => path.append(original_path.as_slice())?,
        }
        script_env.put(b"PATH", path.slice())?;

        put_npm_package_env(&mut script_env, cwd, &list.package_name)?;

        // Ownership transfers to `LifecycleScriptSubprocess`, which
        // re-uses it across every `spawn_next_script` in the chain. Move the
        // owning `NullDelimitedEnvMap` by value so its `K=V\0` buffers outlive
        // this stack frame (freed by the subprocess's `Drop`).
        let envp = script_env.create_null_delimited_env_map()?;

        #[cfg(windows)]
        let shell_bin: Option<&ZStr> = None;
        // `find_shell` includes the trailing NUL in its `'static` storage.
        #[cfg(not(windows))]
        let shell_bin: Option<&ZStr> = (self.env().get(b"PATH"))
            .and_then(|env_path| crate::RunCommand::find_shell(env_path, cwd))
            .map(ZStr::from_slice_with_nul);

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

    pub(crate) fn find_trusted_dependencies_from_update_requests(
        &mut self,
    ) -> ArrayHashMap<PackageID, ()> {
        // find all packages originating from --trust packages from cli
        let mut set: ArrayHashMap<PackageID, ()> = ArrayHashMap::default();
        if self.options.do_.trust_dependencies_from_args() && self.lockfile.packages.len() > 0 {
            let root_id = self
                .root_package_id
                .get(&self.lockfile, self.workspace_name_hash) as usize;
            let root_deps = self.lockfile.packages.items_dependencies()[root_id];
            for dep_id in root_deps.begin()..root_deps.end() {
                let root_dep = &self.lockfile.buffers.dependencies[dep_id as usize];
                for request in self.update_requests.iter() {
                    if request.matches(root_dep, self.lockfile.buffers.string_bytes.as_slice()) {
                        let package_id = self.lockfile.buffers.resolutions[dep_id as usize];
                        if package_id == invalid_package_id {
                            continue;
                        }

                        add_package_to_set(&mut set, &self.lockfile, package_id);
                        break;
                    }
                }
            }
        }

        set
    }
}

/// Sets the same `npm_package_*` variables as `bun run`, replacing the ones that a `bun run` above
/// this install set.
fn put_npm_package_env(
    script_env: &mut bun_dotenv::Map,
    package_dir: &[u8],
    package_name: &[u8],
) -> Result<(), crate::Error> {
    script_env
        .map
        .retain(|key, _| !key.starts_with(b"npm_package_") && !key.starts_with(b"npm_lifecycle_"));

    let package_json_path = join_abs_string_z::<platform::Auto>(package_dir, &[b"package.json"]);
    script_env.put(b"npm_package_json", package_json_path.as_bytes())?;
    script_env.put(b"npm_package_name", package_name)?;

    let Ok(json_buf) = Syscall::File::read_from(Syscall::Fd::cwd(), package_json_path.as_bytes())
    else {
        return Ok(());
    };
    let json_src =
        bun_ast::Source::init_path_string(package_json_path.as_bytes(), json_buf.as_slice());
    let mut log = bun_ast::Log::init();

    initialize_store();

    let Ok(parsed) = bun_json::ParsedJson::parse_package_json(&json_src, &mut log) else {
        return Ok(());
    };
    let own: [(&[u8], &[u8]); 2] = [
        (b"npm_package_name", b"name"),
        (b"npm_package_version", b"version"),
    ];
    for (variable, property) in own {
        if let Some(value) = parsed.root.get(property) {
            if let Some(value) = value.as_utf8_string_literal() {
                script_env.put(variable, value)?;
            }
        }
    }
    let Some(config) = parsed.root.get(b"config") else {
        return Ok(());
    };

    config.try_for_each_property(|key, _, value| match value.as_utf8_string_literal() {
        Some(value) if !key.is_empty() && !value.is_empty() => {
            script_env.put(&strings::concat(&[b"npm_package_config_", key]), value)
        }
        _ => Ok(()),
    })?;
    Ok(())
}

/// Rewrites the `node_modules/.bin` entries of `PATH` to their real paths. A script's `cwd` is a
/// real path too, so `append_path_without_ancestor_bins` can then compare the two.
pub(crate) fn resolve_bin_dirs_in_path(
    env: &mut bun_dotenv::Loader,
) -> Result<(), bun_alloc::AllocError> {
    let bin = bun_paths::path_literal!("/node_modules/.bin").as_bytes();
    // On Windows, an entry may be written with either `\` or `/`.
    let spellings: [&[u8]; 2] = [bin, b"/node_modules/.bin"];
    let Some(inherited) = env.get(b"PATH") else {
        return Ok(());
    };
    let mut real_dir = bun_paths::path_buffer_pool::get();
    let mut path: Vec<u8> = Vec::with_capacity(inherited.len());
    for (i, entry) in strings::split(inherited, &[bun_paths::DELIMITER]).enumerate() {
        if i > 0 {
            path.push(bun_paths::DELIMITER);
        }
        let trimmed = strings::without_trailing_slash(entry);
        if let Some(dir) = (spellings.iter())
            .find_map(|bin| trimmed.strip_suffix(*bin))
            .filter(|dir| bun_paths::is_absolute(dir))
            && let Ok(dir) = Syscall::realpath(&ZBox::from_bytes(dir), &mut real_dir)
        {
            path.extend_from_slice(dir);
            path.extend_from_slice(bin);
        } else {
            path.extend_from_slice(entry);
        }
    }
    env.map.put(b"PATH", &path)
}

/// Without the `node_modules/.bin` of `cwd` and its ancestors that a `bun run` above put in front.
fn append_path_without_ancestor_bins(
    path: &mut EnvPath,
    inherited: &[u8],
    cwd: &[u8],
) -> Result<(), bun_alloc::AllocError> {
    let bin = bun_paths::path_literal!("/node_modules/.bin").as_bytes();
    for entry in strings::split(inherited, &[bun_paths::DELIMITER]) {
        let is_ancestor_bin = strings::without_trailing_slash(entry)
            .strip_suffix(bin)
            .is_some_and(|dir| {
                cwd.strip_prefix(dir)
                    .is_some_and(|rest| rest.first().is_none_or(|&c| c == bun_paths::SEP))
            });
        if !is_ancestor_bin {
            path.append(entry)?;
        }
    }
    Ok(())
}

fn add_package_to_set(
    set: &mut ArrayHashMap<PackageID, ()>,
    lockfile: &Lockfile,
    package_id: PackageID,
) {
    if handle_oom(set.get_or_put(package_id)).found_existing {
        return;
    }
    let mut visited = vec![false; lockfile.packages.len()];
    visited[package_id as usize] = true;
    let mut stack: Vec<PackageID> = vec![package_id];
    while let Some(current) = stack.pop() {
        let rows = lockfile.packages.items_dependencies()[current as usize];
        for dep_id in rows.begin()..rows.end() {
            let dep_package_id = lockfile.buffers.resolutions[dep_id as usize];
            if dep_package_id == invalid_package_id {
                continue;
            }
            if !core::mem::replace(&mut visited[dep_package_id as usize], true) {
                stack.push(dep_package_id);
            }
            // `--trust` saves these packages by name in `trustedDependencies`. A package that a
            // name cannot trust is left out, so that this install runs the same scripts as later
            // installs. What it depends on is still visited.
            if lockfile.can_trust_by_name(
                lockfile.str(&lockfile.buffers.dependencies[dep_id as usize].name),
                &lockfile.packages.items_resolution()[dep_package_id as usize],
            ) {
                let _ = handle_oom(set.get_or_put(dep_package_id));
            }
        }
    }
}

use bun_install::LogLevel;

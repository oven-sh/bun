#!/usr/bin/env python3
"""bunx: the install takes the registries of the project. Source changes for a tree at main."""
import sys

ROOT = "/workspace/bun/"


def patch(path, pairs):
    p = ROOT + path
    s = open(p, encoding="utf-8").read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f"{path}: expected 1 match, found {n}:\n{old[:200]}")
        s = s.replace(old, new)
    open(p, "w", encoding="utf-8").write(s)
    print("patched", path)


# ── env var ────────────────────────────────────────────────────────────────
patch("src/bun_core/env_var.rs", [
(r'''new!(pub BUN_INTERNAL_BUNX_INSTALL: string, "BUN_INTERNAL_BUNX_INSTALL", {});
''', r'''new!(pub BUN_INTERNAL_BUNX_INSTALL: string, "BUN_INTERNAL_BUNX_INSTALL", {});
// Set by `bunx` with `BUN_INTERNAL_BUNX_INSTALL`: the directory of the project that `bunx` runs in.
// The `bun add` takes the registries of that project's bunfig.toml and .npmrc.
new!(pub BUN_INTERNAL_BUNX_PROJECT: string, "BUN_INTERNAL_BUNX_PROJECT", {});
'''),
])

# ── runTasks.rs ────────────────────────────────────────────────────────────
patch("src/install/PackageManager/runTasks.rs", [
(r'''fn is_bunx_install() -> bool {
    is_bunx_tree(crate::bun_fs::FileSystem::instance().top_level_dir())
}
''', r'''fn is_bunx_install() -> bool {
    is_bunx_tree(crate::bun_fs::FileSystem::instance().top_level_dir())
}

/// The project that `bunx` runs in, if this process is the `bun add` that `bunx` spawned for it.
pub fn bunx_project() -> Option<&'static [u8]> {
    let project = bun_core::env_var::BUN_INTERNAL_BUNX_PROJECT.get()?;
    (bun_paths::is_absolute(project) && is_bunx_install()).then_some(project)
}
'''),
])

# ── dotenv ─────────────────────────────────────────────────────────────────
patch("src/dotenv/env_loader.rs", [
(r'''            if !skip_default_env {
                self.load_default_files(suffix, dir, &mut value_buffer)?;
            }
''', r'''            if !skip_default_env {
                self.load_default_files(suffix, bun_sys::Fd::cwd(), dir, &mut value_buffer)?;
            }
'''),
(r'''    fn load_default_files<D: DirEntryProbe + ?Sized>(
        &mut self,
        suffix: DotEnvFileSuffix,
        dir: &D,
        value_buffer: &mut Vec<u8>,
    ) -> crate::Result<()> {
        let dir_handle = bun_sys::Fd::cwd();

''', r'''    fn load_default_files<D: DirEntryProbe + ?Sized>(
        &mut self,
        suffix: DotEnvFileSuffix,
        dir_handle: bun_sys::Fd,
        dir: &D,
        value_buffer: &mut Vec<u8>,
    ) -> crate::Result<()> {
'''),
(r'''    fn loaded_count(&self) -> usize {
        self.default_files_loaded.len() + self.custom_files_loaded.count()
    }
''', r'''    /// Loads the default `.env` files of the directory `dir_handle`, which `dir` lists. It is for
    /// a directory that is not the working directory, and it prints nothing.
    pub fn load_default_files_of<D: DirEntryProbe + ?Sized>(
        &mut self,
        dir_handle: bun_sys::Fd,
        dir: &D,
        suffix: DotEnvFileSuffix,
    ) -> crate::Result<()> {
        self.load_default_files(suffix, dir_handle, dir, &mut Vec::new())
    }

    fn loaded_count(&self) -> usize {
        self.default_files_loaded.len() + self.custom_files_loaded.count()
    }
'''),
])

# ── PackageManagerOptions.rs: what expands `$VAR` in the registries of config files ──
patch("src/install/PackageManager/PackageManagerOptions.rs", [
(r'''        runtime_bunfigs: [Option<&Api::BunInstall>; 2],
        subcommand: Subcommand,
    ) -> crate::Result<()> {
        let bunfigs = [runtime_bunfigs[0], bun_install_ref, runtime_bunfigs[1]];
''', r'''        runtime_bunfigs: [Option<&Api::BunInstall>; 2],
        // What expands `$VAR` in the registries of the config files, if not `env`. For the install
        // that `bunx` spawns: `env` and the `.env` files of the project, which set nothing else.
        mut config_env: Option<&mut DotEnvLoader>,
        subcommand: Subcommand,
    ) -> crate::Result<()> {
        let bunfigs = [runtime_bunfigs[0], bun_install_ref, runtime_bunfigs[1]];
'''),
(r'''        self.scope = Npm::registry::Scope::from_api(b"", base, Some(&mut *env))?;
        // `did_override_default_scope` is set at the end of this fn;
''', r'''        self.scope = Npm::registry::Scope::from_api(
            b"",
            base,
            Some(config_env.as_deref_mut().unwrap_or(&mut *env)),
        )?;
        // `did_override_default_scope` is set at the end of this fn;
'''),
(r'''                    self.registries.put(
                        Npm::registry::Scope::hash(name),
                        Npm::registry::Scope::from_api(name, registry.clone(), Some(&mut *env))?,
                    )?;
                }
            }

            for url_auth in &config.url_auth {
                if let Some(url_auth) = Npm::registry::UrlAuth::from_api(url_auth, env)? {
                    self.url_auth.push(url_auth);
                }
            }
''', r'''                    self.registries.put(
                        Npm::registry::Scope::hash(name),
                        Npm::registry::Scope::from_api(
                            name,
                            registry.clone(),
                            Some(config_env.as_deref_mut().unwrap_or(&mut *env)),
                        )?,
                    )?;
                }
            }

            for url_auth in &config.url_auth {
                if let Some(url_auth) = Npm::registry::UrlAuth::from_api(
                    url_auth,
                    config_env.as_deref_mut().unwrap_or(&mut *env),
                )? {
                    self.url_auth.push(url_auth);
                }
            }
'''),
(r'''            self.registries.put(
                Npm::registry::Scope::hash(name),
                Npm::registry::Scope::from_api(name, registry, Some(&mut *env))?,
            )?;
        }

        {
            const TOKEN_KEYS: [&[u8]; 3] = [
''', r'''            self.registries.put(
                Npm::registry::Scope::hash(name),
                Npm::registry::Scope::from_api(
                    name,
                    registry,
                    Some(config_env.as_deref_mut().unwrap_or(&mut *env)),
                )?,
            )?;
        }

        {
            const TOKEN_KEYS: [&[u8]; 3] = [
'''),
])

# ── PackageManager.rs ──────────────────────────────────────────────────────
patch("src/install/PackageManager.rs", [
# the keep-list, next to the overlay
(r'''/// Appends `<separator>package.json\0`. A Windows drive root, `C:\`, has its separator already.
fn push_package_json(path: &mut Vec<u8>) {
''', r'''/// What the install of a `bunx` tool takes from the bunfig.toml or the .npmrc of the project that
/// `bunx` runs in: where packages come from, and what checks them. The other settings of `project`
/// are about the project's own `node_modules`, so they are `user`'s.
fn of_project_for_bunx(project: Api::BunInstall, user: Api::BunInstall) -> Api::BunInstall {
    let Api::BunInstall {
        default_registry,
        scoped,
        url_auth,
        ca,
        cafile,
        security_scanner,
        minimum_release_age_ms,
        minimum_release_age_excludes,
        lockfile_path: _,
        save_lockfile_path: _,
        cache_directory: _,
        dry_run: _,
        force: _,
        save_dev: _,
        save_optional: _,
        save_peer: _,
        save_lockfile: _,
        production: _,
        save_yarn_lockfile: _,
        disable_cache: _,
        disable_manifest_cache: _,
        global_dir: _,
        global_bin_dir: _,
        frozen_lockfile: _,
        exact: _,
        concurrent_scripts: _,
        save_text_lockfile: _,
        ignore_scripts: _,
        provenance: _,
        link_workspace_packages: _,
        node_linker: _,
        global_store: _,
        public_hoist_pattern: _,
        hoist_pattern: _,
        hoist: _,
        offline: _,
    } = project;
    Api::BunInstall {
        default_registry,
        scoped,
        url_auth,
        ca,
        cafile,
        security_scanner,
        minimum_release_age_ms,
        minimum_release_age_excludes,
        ..user
    }
}

/// For `bunx`, which names the directory that it installs a tool into after what decides the
/// packages in it. Returns a hash of the registries, the minimum release age and the security
/// scanner that the bunfig.toml and the .npmrc of `project` set, or `None` if they set none of
/// them. `Err` holds the path of the file that cannot be read or parsed.
pub fn bunx_project_key(env: &dot_env::Loader, project: &[u8]) -> Result<Option<u64>, Box<[u8]>> {
    let bunfig = ::bun_bunfig::arguments::load_install_section(project)?
        .map_or_else(Api::BunInstall::default, |bunfig| *bunfig);
    initialize_store();
    let mut npmrc = Api::BunInstall::default();
    let mut npmrc_path = bun_paths::path_buffer_pool::get();
    if let Some(path) = resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
        project,
        &mut npmrc_path,
        &[b".npmrc".as_slice()],
    ) && let Some(unreadable) = ini::load_npmrc_config(
        &mut npmrc,
        &bunfig,
        env,
        ini::NpmrcDiagnostics::Discard,
        &[path],
    ) {
        return Err(unreadable.as_bytes().into());
    }

    // The two files are kept apart: the user's bunfig.toml overrides the project's .npmrc, but not
    // the project's bunfig.toml.
    let mut settings: Vec<u8> = Vec::new();
    for (file, config) in [(b'n', npmrc), (b'b', bunfig)] {
        let config = of_project_for_bunx(config, Api::BunInstall::default());
        let mut add = |name: &[u8], value: &[u8]| {
            settings.extend_from_slice(&[file, 0]);
            settings.extend_from_slice(name);
            settings.push(0);
            settings.extend_from_slice(value);
            settings.push(0);
        };
        if let Some(registry) = &config.default_registry {
            add(b"registry", &registry.url);
        }
        if let Some(scoped) = &config.scoped {
            for (scope, registry) in scoped.scopes.keys().iter().zip(scoped.scopes.values()) {
                add(scope, &registry.url);
            }
        }
        if let Some(age) = config.minimum_release_age_ms {
            add(b"minimumReleaseAge", &age.to_bits().to_le_bytes());
        }
        for exclude in config.minimum_release_age_excludes.iter().flatten() {
            add(b"minimumReleaseAgeExcludes", exclude);
        }
        if let Some(scanner) = &config.security_scanner {
            add(b"scanner", scanner);
        }
    }
    Ok((!settings.is_empty()).then(|| bun_wyhash::hash(&settings)))
}

/// A copy of `env` with the default `.env` files of `dir`, which is not the working directory.
fn env_with_default_files_of(env: &dot_env::Loader, dir: &[u8]) -> Result<dot_env::Loader, Error> {
    let mut loader = dot_env::Loader::init_with_map(env.map.clone_with_allocator()?);
    loader.quiet = true;
    let Ok(fs::EntriesOption::Entries(entries)) = FileSystem::instance().read_directory(dir, 0, true)
    else {
        return Ok(loader);
    };
    // `.data` must only be probed while `entries_mutex` is held.
    let names = {
        let _entries_lock = FileSystem::instance().fs.entries_mutex.lock_guard();
        dot_env::DirEntryKeys(entries.data.iter().map(|(k, _)| Box::from(&**k)).collect())
    };
    let suffix = match env.get_node_env() {
        Some(b"development") => dot_env::DotEnvFileSuffix::Development,
        Some(b"test") => dot_env::DotEnvFileSuffix::Test,
        _ => dot_env::DotEnvFileSuffix::Production,
    };
    if let Ok(dir) = bun_sys::Dir::open(dir) {
        loader.load_default_files_of(dir.fd(), &names, suffix)?;
    }
    Ok(loader)
}

/// Appends `<separator>package.json\0`. A Windows drive root, `C:\`, has its separator already.
fn push_package_json(path: &mut Vec<u8>) {
'''),
# init: the project of bunx
(r'''    env.map.remove(b"BUN_INTERNAL_BUNX_INSTALL");
    env.map.remove(b"BUN_INTERNAL_BUNX_HAS_COPY");

    initialize_store();

    {
        // npmrc < bunfig < CLI
        let bunfig_install = ctx
            .install
            .take()
            .map_or_else(Api::BunInstall::default, |b| *b);
        let mut npmrc_local = bun_paths::path_buffer_pool::get();
        let mut install = load_npmrc_files(
            &bunfig_install,
            env,
            bun_paths::fs::FileSystem::instance().initial_top_level_dir(),
            &mut resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
                fs.top_level_dir(),
                &mut npmrc_local,
                &[b".npmrc".as_slice()],
            )
            .into_iter(),
            ini::NpmrcDiagnostics::Print,
            &mut ctx.unreadable_config,
        );

        overlay_bunfig_install(&mut install, bunfig_install);
        if env_ignores_scripts {
''', r'''    env.map.remove(b"BUN_INTERNAL_BUNX_INSTALL");
    env.map.remove(b"BUN_INTERNAL_BUNX_HAS_COPY");
    env.map.remove(b"BUN_INTERNAL_BUNX_PROJECT");

    initialize_store();

    // `bunx` installs a tool for the project that it runs in. The registries of that project's
    // bunfig.toml and .npmrc apply, and its `.env` files only expand `$VAR` in the two.
    let bunx_project = run_tasks::bunx_project();
    let mut bunx_project_env = match bunx_project {
        Some(project)
            if cli.env_files.is_empty()
                && !cli.no_env_file
                && !ctx.args.disable_default_env_files =>
        {
            Some(env_with_default_files_of(env, project)?)
        }
        _ => None,
    };

    {
        // npmrc < bunfig < CLI
        let bunfig_install = ctx
            .install
            .take()
            .map_or_else(Api::BunInstall::default, |b| *b);
        let start_dir = bun_paths::fs::FileSystem::instance().initial_top_level_dir();
        let join = resolve_path::join_abs_string_buf_z_checked::<platform::Auto>;
        let mut npmrc_local = bun_paths::path_buffer_pool::get();
        let npmrc_local = join(fs.top_level_dir(), &mut npmrc_local, &[b".npmrc".as_slice()]);
        let mut npmrc_of_project = bun_paths::path_buffer_pool::get();
        let npmrc_of_project = bunx_project
            .and_then(|project| join(project, &mut npmrc_of_project, &[b".npmrc".as_slice()]))
            .filter(|path| bun_sys::exists_z(path));
        let mut install = load_npmrc_files(
            &bunfig_install,
            bunx_project_env.as_ref().unwrap_or(&*env),
            start_dir,
            &mut npmrc_local.into_iter().chain(npmrc_of_project),
            ini::NpmrcDiagnostics::Print,
            &mut ctx.unreadable_config,
        );
        if npmrc_of_project.is_some() {
            // The lines of every .npmrc collapse into one map, so the project's file is read with
            // the user's. What it must not set is read again without it.
            let user = load_npmrc_files(
                &bunfig_install,
                env,
                start_dir,
                &mut npmrc_local.into_iter(),
                ini::NpmrcDiagnostics::Discard,
                &mut None,
            );
            install = of_project_for_bunx(install, user);
        }

        overlay_bunfig_install(&mut install, bunfig_install);
        if let Some(project) = bunx_project {
            match ::bun_bunfig::arguments::load_install_section(project) {
                Ok(Some(bunfig)) => overlay_bunfig_install(
                    &mut install,
                    of_project_for_bunx(*bunfig, Api::BunInstall::default()),
                ),
                Ok(None) => {}
                Err(path) => {
                    ctx.unreadable_config.get_or_insert(path);
                }
            }
        }
        if env_ignores_scripts {
'''),
(r'''            unsafe { &mut *ctx.log },
            env,
            cli,
            ctx.install.as_deref(),
            None,
            [None, None],
            subcommand,
        )?;
''', r'''            unsafe { &mut *ctx.log },
            env,
            cli,
            ctx.install.as_deref(),
            None,
            [None, None],
            bunx_project_env.as_mut(),
            subcommand,
        )?;
'''),
(r'''        Some(&npmrc),
        [root_bunfig.as_deref(), nearer_bunfig.as_deref()],
        Subcommand::Install,
    )?;
''', r'''        Some(&npmrc),
        [root_bunfig.as_deref(), nearer_bunfig.as_deref()],
        None,
        Subcommand::Install,
    )?;
'''),
])

# ── security_scanner.rs ────────────────────────────────────────────────────
p = ROOT + "src/install/PackageManager/security_scanner.rs"
s = open(p, encoding="utf-8").read()
old = "            cwd: Box::from(FileSystem::instance().top_level_dir()),\n"
if s.count(old) != 2:
    sys.exit(f"security_scanner.rs: expected 2 matches, found {s.count(old)}")
s = s.replace(old, "            cwd: Box::from(scanner_cwd()),\n")
old = '''    // After a partial install, the package might exist but not be in the lockfile yet
    // In that case, we'll get null here but should still try to run the scanner
    let security_scanner_pkg_id = finder.find_in_root_dependencies();
'''
if s.count(old) != 1:
    sys.exit("security_scanner.rs: finder anchor")
s = s.replace(old, '''    // After a partial install, the package might exist but not be in the lockfile yet
    // In that case, we'll get null here but should still try to run the scanner
    // `bunx <scanner>`: the scanner that checks the install is the project's, not the copy that is
    // being installed.
    let security_scanner_pkg_id = finder
        .find_in_root_dependencies()
        .filter(|_| crate::package_manager_real::run_tasks::bunx_project().is_none());
''')
old = '''fn replace_first(source: &[u8], placeholder: &[u8], with: &[u8]) -> Vec<u8> {
'''
if s.count(old) != 1:
    sys.exit("security_scanner.rs: replace_first anchor")
s = s.replace(old, '''/// Where the scanner runs, and where its module is looked up from: the project. For the install
/// that `bunx` spawns, that is the project `bunx` runs in, not the directory of the tool.
fn scanner_cwd() -> &'static [u8] {
    crate::package_manager_real::run_tasks::bunx_project()
        .unwrap_or_else(|| FileSystem::instance().top_level_dir())
}

''' + old)
open(p, "w", encoding="utf-8").write(s)
print("patched src/install/PackageManager/security_scanner.rs")

# ── bunx_command.rs ────────────────────────────────────────────────────────
patch("src/runtime/cli/bunx_command.rs", [
(r'''        // 2. The project's installed copy of the package. It is skipped when the user typed a
        // version, a tag, or a URL, because that says where the package must come from.
        if !is_versioned {
            let project = bun_install::package_manager_real::project_directory(top_level_dir);
            let found = match Self::find_in_project(
                this_transpiler,
                top_level_dir,
                project.unwrap_or(top_level_dir),
''', r'''        let project = bun_install::package_manager_real::project_directory(top_level_dir)
            .unwrap_or(top_level_dir);

        // 2. The project's installed copy of the package. It is skipped when the user typed a
        // version, a tag, or a URL, because that says where the package must come from.
        if !is_versioned {
            let found = match Self::find_in_project(
                this_transpiler,
                top_level_dir,
                project,
'''),
(r'''        let configured_cache = if cfg!(unix) {
            bun_install::package_manager_real::user_cache_directory(env_loader, top_level_dir)
        } else {
            None
        };
''', r'''        // The install takes the registries of the project's bunfig.toml and .npmrc. A package's own
        // script in `node_modules`, or the node-gyp that `bun install` runs for one, is not a
        // command of the project.
        let project_of_install = (ignore_cwd.is_empty()
            && !strings::contains(top_level_dir, bun_paths::NODE_MODULES_NEEDLE))
        .then_some(project);
        if let Some(project) = project_of_install
            && Self::has_install_config(this_transpiler, project)
        {
            match bun_install::package_manager_real::bunx_project_key(env_loader, project) {
                // What decides the content of a tree is part of its name.
                Ok(Some(key)) => {
                    package_fmt.extend_from_slice(format!("+project-{key:x}").as_bytes());
                }
                Ok(None) => {}
                Err(path) => {
                    Output::err_generic(
                        "cannot read or parse {}, refusing to install packages",
                        format_args!("{}", BStr::new(&path)),
                    );
                    Global::exit(1);
                }
            }
        }

        let configured_cache = if cfg!(unix) {
            bun_install::package_manager_real::user_cache_directory(env_loader, top_level_dir)
        } else {
            None
        };
'''),
(r'''        if let Some(arg) = &minimum_release_age_arg {
            args.push(arg);
        }

        bun_output::scoped_log!(
            bunx,
            "installing package: {}",
''', r'''        if let Some(arg) = &minimum_release_age_arg {
            args.push(arg);
        }
        if !ctx.args.env_files.is_empty() {
            // As for `bun add --env-file`: the project's default `.env` files are not read.
            args.push(b"--no-env-file");
        }

        bun_output::scoped_log!(
            bunx,
            "installing package: {}",
'''),
(r'''        env_loader
            .map
            .put(b"BUN_INTERNAL_BUNX_HAS_COPY", has_copy)?;

        let envp = env_loader.map.create_null_delimited_env_map()?;
''', r'''        env_loader
            .map
            .put(b"BUN_INTERNAL_BUNX_HAS_COPY", has_copy)?;
        match project_of_install {
            Some(project) => env_loader
                .map
                .put(b"BUN_INTERNAL_BUNX_PROJECT", project)?,
            None => env_loader.map.remove(b"BUN_INTERNAL_BUNX_PROJECT"),
        }

        let envp = env_loader.map.create_null_delimited_env_map()?;
'''),
(r'''            cwd: Box::<[u8]>::from(bunx_cache_dir),
            stderr: proc_sync::SyncStdio::Inherit,
            stdout: proc_sync::SyncStdio::Inherit,
            stdin: proc_sync::SyncStdio::Inherit,
''', r'''            cwd: Box::<[u8]>::from(bunx_cache_dir),
            stderr: proc_sync::SyncStdio::Inherit,
            // What the install prints, such as the report of a security scanner, is not the
            // output of the tool.
            stdout: proc_sync::SyncStdio::Pipe(Fd::stderr()),
            stdin: proc_sync::SyncStdio::Inherit,
'''),
(r'''        env_loader.map.remove(b"BUN_INTERNAL_BUNX_INSTALL");
        env_loader.map.remove(b"BUN_INTERNAL_BUNX_HAS_COPY");

        /// The raw byte: `signal_code()` would drop RT signals (>31).
''', r'''        env_loader.map.remove(b"BUN_INTERNAL_BUNX_INSTALL");
        env_loader.map.remove(b"BUN_INTERNAL_BUNX_HAS_COPY");
        env_loader.map.remove(b"BUN_INTERNAL_BUNX_PROJECT");

        /// The raw byte: `signal_code()` would drop RT signals (>31).
'''),
(r'''    fn prepend_to_path(
        env: &mut bun_dotenv::Loader,
        bunx_cache_dir: &[u8],
        path: &[u8],
    ) -> crate::Result<()> {
''', r'''    /// Whether `dir` has a bunfig.toml or an .npmrc, by its listing. The resolver has the listing of
    /// the working directory and of every directory above it, so this reads nothing for them.
    fn has_install_config(transpiler: &mut Transpiler, dir: &[u8]) -> bool {
        let Ok(Some(info)) = transpiler.resolver.read_dir_info(dir) else {
            return true;
        };
        let _entries_lock = bun_resolver::fs::FileSystem::instance()
            .fs
            .entries_mutex
            .lock_guard();
        info.get_entries_ref_locked(transpiler.resolver.generation)
            .is_none_or(|entries| {
                entries.has_comptime_query(b"bunfig.toml") || entries.has_comptime_query(b".npmrc")
            })
    }

    fn prepend_to_path(
        env: &mut bun_dotenv::Loader,
        bunx_cache_dir: &[u8],
        path: &[u8],
    ) -> crate::Result<()> {
'''),
])
print("all patches applied")

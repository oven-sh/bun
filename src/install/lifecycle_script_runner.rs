use core::sync::atomic::Ordering;

use crate::PackageManager;
use crate::buffered_subprocess::BufferedSubprocess;
use crate::isolated_install::installer::{CompleteState, Installer, Step};
use crate::isolated_install::store::entry;
use crate::lockfile_real::Scripts as LockfileScripts;
use crate::lockfile_real::package::scripts::List as ScriptsList;
use crate::package_manager_real::{InstallFields, ProgressStrings};
use bun_core::{Global, Output};
use bun_event_loop::EventLoopHandle;

use bun_core::{CStrList, CStrRef, CStringList, ZStr};
use bun_spawn::{SpawnOptions, Status};

bun_output::declare_scope!(Script, visible);

// ──────────────────────────────────────────────────────────────────────────
// Shared by `bun run` and lifecycle scripts. `bun_install` is the lower crate
// (bun_runtime depends on bun_install), so the canonical impl lives here and
// `RunCommand::replace_package_manager_run` is a thin re-export.
// ──────────────────────────────────────────────────────────────────────────

const BUN_BIN_NAME: &[u8] = if bun_core::env::IS_DEBUG {
    b"bun-debug"
} else {
    b"bun"
};
// `BUN_BIN_NAME ++ " run"` / `" x "` — kept as separate writes below since
// const byte concat is awkward in Rust.

/// Yarn built-in subcommands (union of v1 + v2.3 sets, deduped).
// PERF: the `comptime_string_map!` macro currently returns a
// Lazy with inferred const generics that can't be named in a `static` item, so
// use a sorted slice + binary_search for now. ~50 entries → <7 comparisons.
struct YarnCommands;
static YARN_COMMANDS: YarnCommands = YarnCommands;
impl YarnCommands {
    // Must stay byte-lexically sorted for binary_search.
    const SORTED: &'static [&'static [u8]] = &[
        b"access",
        b"add",
        b"audit",
        b"autoclean",
        b"bin",
        b"cache",
        b"check",
        b"config",
        b"create",
        b"dedupe",
        b"dlx",
        b"exec",
        b"explain",
        b"generate-lock-entry",
        b"generateLockEntry",
        b"global",
        b"help",
        b"import",
        b"info",
        b"init",
        b"install",
        b"licenses",
        b"link",
        b"list",
        b"login",
        b"logout",
        b"node",
        b"npm",
        b"outdated",
        b"owner",
        b"pack",
        b"patch",
        b"plugin",
        b"policies",
        b"publish",
        b"rebuild",
        b"remove",
        b"run",
        b"set",
        b"tag",
        b"team",
        b"unlink",
        b"unplug",
        b"up",
        b"upgrade",
        b"upgrade-interactive",
        b"upgradeInteractive",
        b"version",
        b"versions",
        b"why",
        b"workspace",
        b"workspaces",
    ];

    #[inline]
    fn has(&self, cmd: &[u8]) -> bool {
        Self::SORTED.binary_search(&cmd).is_ok()
    }
}

/// Removes the `node_modules/.bin` entries from a `PATH`.
pub fn strip_bin_dirs(path: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(path.len());
    for entry in bun_core::strings::split(path, &[bun_paths::DELIMITER]) {
        let dir = bun_core::strings::without_trailing_slash(entry);
        let is_bin_dir = bun_paths::basename(dir) == b".bin"
            && bun_paths::dirname(dir)
                .is_some_and(|parent| bun_paths::basename(parent) == b"node_modules");
        if !is_bin_dir {
            if !result.is_empty() {
                result.push(bun_paths::DELIMITER);
            }
            result.extend_from_slice(entry);
        }
    }
    result
}

/// Look for invocations of any: `yarn run` / `yarn $cmd` / `pnpm run` /
/// `pnpm dlx` / `pnpx` / `npm run` / `npx` and replace them with `bun run`
/// / `bun x` so that lifecycle scripts re-enter Bun instead of spawning
/// another package manager.
///
/// `#[cold]`: only reached when actually executing a package.json script /
/// lifecycle script — never on plain `bun foo.js` startup. Forcing it into
/// `.text.unlikely.*` keeps the byte-scanning loop out of the hot
/// fault-around windows the startup/dot benches page in (belt-and-suspenders
/// alongside `startup.order` regen — survives mangling-hash drift).
#[cold]
pub fn replace_package_manager_run(
    copy_script: &mut Vec<u8>,
    script: &[u8],
) -> Result<(), crate::Error> {
    use bun_core::strings;

    #[inline]
    fn append_bun_run(out: &mut Vec<u8>) {
        out.extend_from_slice(BUN_BIN_NAME);
        out.extend_from_slice(b" run");
    }
    #[inline]
    fn append_bun_x(out: &mut Vec<u8>) {
        out.extend_from_slice(BUN_BIN_NAME);
        out.extend_from_slice(b" x ");
    }

    let mut entry_i: usize = 0;
    let mut delimiter: u8 = b' ';

    while entry_i < script.len() {
        let start = entry_i;

        match script[entry_i] {
            b'y' => {
                if delimiter > 0 {
                    let remainder = &script[start..];
                    if strings::has_prefix_comptime(remainder, b"yarn ") {
                        let next = &remainder[b"yarn ".len()..];
                        // We have yarn
                        // Find the next space
                        if let Some(space) = strings::index_of_char(next, b' ') {
                            let yarn_cmd = &next[..space as usize];
                            if strings::eql_comptime(yarn_cmd, b"run") {
                                append_bun_run(copy_script);
                                entry_i += b"yarn run".len();
                                continue;
                            }

                            // yarn npm is a yarn 2 subcommand
                            if strings::eql_comptime(yarn_cmd, b"npm") {
                                entry_i += b"yarn npm ".len();
                                copy_script.extend_from_slice(b"yarn npm ");
                                continue;
                            }

                            if yarn_cmd.first() == Some(&b'-') {
                                // Skip the rest of the command
                                entry_i += b"yarn ".len() + yarn_cmd.len();
                                copy_script.extend_from_slice(b"yarn ");
                                copy_script.extend_from_slice(yarn_cmd);
                                continue;
                            }

                            // implicit yarn commands
                            if !YARN_COMMANDS.has(yarn_cmd) {
                                append_bun_run(copy_script);
                                copy_script.push(b' ');
                                copy_script.extend_from_slice(yarn_cmd);
                                entry_i += b"yarn ".len() + yarn_cmd.len();
                                delimiter = 0;
                                continue;
                            }
                        }
                    }
                }
                delimiter = 0;
            }

            b' ' => delimiter = b' ',
            b'"' => delimiter = b'"',
            b'\'' => delimiter = b'\'',

            b'n' => {
                if delimiter > 0 {
                    if strings::has_prefix_comptime(&script[start..], b"npm run ") {
                        append_bun_run(copy_script);
                        entry_i += b"npm run ".len();
                        let rewritten =
                            append_npm_run_in_workspaces(copy_script, &script[entry_i..]);
                        if rewritten == 0 {
                            copy_script.push(b' ');
                        }
                        entry_i += rewritten;
                        delimiter = 0;
                        continue;
                    }

                    if strings::has_prefix_comptime(&script[start..], b"npx ") {
                        append_bun_x(copy_script);
                        entry_i += b"npx ".len();
                        delimiter = 0;
                        continue;
                    }
                }
                delimiter = 0;
            }
            b'p' => {
                if delimiter > 0 {
                    if strings::has_prefix_comptime(&script[start..], b"pnpm run ") {
                        append_bun_run(copy_script);
                        copy_script.push(b' ');
                        entry_i += b"pnpm run ".len();
                        delimiter = 0;
                        continue;
                    }
                    if strings::has_prefix_comptime(&script[start..], b"pnpm dlx ") {
                        append_bun_x(copy_script);
                        entry_i += b"pnpm dlx ".len();
                        delimiter = 0;
                        continue;
                    }
                    if strings::has_prefix_comptime(&script[start..], b"pnpx ") {
                        append_bun_x(copy_script);
                        entry_i += b"pnpx ".len();
                        delimiter = 0;
                        continue;
                    }
                }
                delimiter = 0;
            }
            _ => delimiter = 0,
        }

        copy_script.push(script[entry_i]);
        entry_i += 1;
    }

    Ok(())
}

/// npm takes `-w` / `--workspaces` anywhere, `bun run` only in front. Returns the `args` consumed.
fn append_npm_run_in_workspaces(out: &mut Vec<u8>, args: &[u8]) -> usize {
    use bun_core::strings;

    let end = strings::index_of_any(args, b";&|\r\n").unwrap_or(args.len());
    let command = args[..end].trim_ascii_end();
    if strings::index_of_any(command, b"'\"()$`\\#").is_some() {
        return 0;
    }

    let mut flags: Vec<u8> = Vec::new();
    let mut rest: Vec<u8> = Vec::new();
    let mut selects_workspaces = false;
    let mut tokens = strings::tokenize_any(command, b" \t");
    while let Some(token) = tokens.next() {
        let workspace = match token {
            b"-w" | b"--workspace" => tokens.next(),
            b"--workspaces" | b"--ws" => {
                selects_workspaces = true;
                flags.extend_from_slice(b" --workspaces");
                continue;
            }
            b"--if-present" => {
                flags.extend_from_slice(b" --if-present");
                continue;
            }
            b"--" => {
                for passed_on in core::iter::once(token).chain(tokens) {
                    rest.push(b' ');
                    rest.extend_from_slice(passed_on);
                }
                break;
            }
            _ => match token
                .strip_prefix(b"--workspace=")
                .or_else(|| token.strip_prefix(b"-w="))
            {
                Some(workspace) => Some(workspace),
                None => {
                    rest.push(b' ');
                    rest.extend_from_slice(token);
                    continue;
                }
            },
        };
        // It must not be the next flag, or a word with a redirect attached to it.
        let Some(workspace) = workspace.filter(|workspace| {
            !workspace.is_empty()
                && workspace[0] != b'-'
                && strings::index_of_any(workspace, b"<>").is_none()
        }) else {
            return 0;
        };
        selects_workspaces = true;
        flags.extend_from_slice(b" --filter=");
        // npm also accepts the workspace's folder. `--filter` tells a path from a name by the
        // leading dot.
        if strings::contains_char(workspace, b'/') && !matches!(workspace[0], b'@' | b'.' | b'/') {
            flags.extend_from_slice(b"./");
        }
        flags.extend_from_slice(workspace);
    }

    if !selects_workspaces {
        return 0;
    }
    out.extend_from_slice(&flags);
    out.extend_from_slice(&rest);
    command.len()
}

/// Without a POSIX shell, this runs `bun exec --no-env-file`. Like `sh`, it doesn't add any `.env*`
/// file to the environment.
pub struct ScriptArgv<'a>([Option<CStrRef<'a>>; 5]);

impl<'a> ScriptArgv<'a> {
    pub fn new(shell: Option<&'a ZStr>, script: &'a ZStr) -> Result<Self, crate::Error> {
        let script = Some(script.into());
        Ok(Self(match shell {
            Some(sh) if cfg!(unix) => [Some(sh.into()), Some(c"-c".into()), script, None, None],
            _ => [
                Some(bun_core::self_exe_path()?.into()),
                Some(c"exec".into()),
                Some(c"--no-env-file".into()),
                script,
                None,
            ],
        }))
    }

    pub fn as_list(&self) -> CStrList<'_> {
        CStrList::new(&self.0)
    }
}

/// The scripts of one package, which run one after the other.
pub(crate) struct LifecycleScriptRunner {
    pub(crate) scripts: ScriptsList,
    current_script_index: u8,

    /// Owned by this
    /// struct so the `K=V\0` strings stay alive across every async
    /// `spawn_next_script` for the script chain; freed with it.
    envp: CStringList,
    shell_bin: Option<&'static ZStr>,

    foreground: bool,
    optional: bool,
    pub(crate) started_at: u64,

    ctx: Option<InstallCtx>,
}

/// The linker, not the script's cwd, determines what gets removed when an optional dependency's
/// script fails.
#[derive(Clone, Copy)]
pub enum InstallCtx {
    Isolated {
        entry_id: entry::Id,
    },
    /// The package is `node_modules/<package_name>` of this tree.
    Hoisted {
        tree_id: crate::lockfile_real::tree::Id,
    },
}

/// Who runs the scripts, which decides where their results go.
pub(crate) enum ScriptCaller<'c, 'i> {
    Manager(InstallFields<'c>),
    IsolatedLinker(&'c mut Installer<'i>),
}

impl<'i> ScriptCaller<'_, 'i> {
    pub(crate) fn install_fields(&mut self) -> InstallFields<'_> {
        match self {
            Self::Manager(manager) => manager.reborrow(),
            Self::IsolatedLinker(installer) => installer.manager.reborrow(),
        }
    }

    fn isolated(&mut self, ctx: Option<InstallCtx>) -> Option<(entry::Id, &mut Installer<'i>)> {
        let Some(InstallCtx::Isolated { entry_id }) = ctx else {
            return None;
        };
        let Self::IsolatedLinker(installer) = self else {
            unreachable!("only the isolated linker finishes scripts with `InstallCtx::Isolated`");
        };
        Some((entry_id, installer))
    }

    /// Handles the `git` commands and the scripts that have exited.
    pub(crate) fn finish_exited_subprocesses(mut self) {
        self.install_fields().finish_exited_git_commands();

        let mut index = 0;
        while let Some((child, script)) = self
            .install_fields()
            .state
            .active_lifecycle_scripts
            .get(index)
        {
            for err in child.take_read_errors() {
                script.print_reader_error(&err);
            }
            if let Some(status) = child.finished_status().cloned() {
                let (child, script) = self
                    .install_fields()
                    .state
                    .active_lifecycle_scripts
                    .remove(index);
                script.handle_exit(&mut self, status, child);
            } else {
                index += 1;
            }
        }
    }

    /// Both linkers treat a package that's at its final path as installed. Removing these packages
    /// makes the next install run their scripts.
    fn discard_packages_with_unfinished_scripts(&mut self, ctx: Option<InstallCtx>) {
        Output::flush();
        if let Some(InstallCtx::Hoisted { .. }) = ctx {
            let manager = self.install_fields();
            for (tree_id, folder_name) in &manager.state.unfinished_scripts {
                crate::package_installer::remove_placed_package(
                    manager.lockfile,
                    *tree_id,
                    folder_name,
                );
            }
        } else if let Some((entry_id, installer)) = self.isolated(ctx) {
            installer.discard_entries_with_unfinished_scripts(entry_id);
        }
    }
}

impl LifecycleScriptRunner {
    fn script_name(&self) -> &'static [u8] {
        debug_assert!((self.current_script_index as usize) < LockfileScripts::NAMES.len());
        LockfileScripts::NAMES[self.current_script_index as usize].as_bytes()
    }

    fn print_reader_error(&self, err: &bun_sys::Error) {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: Failed to read <b>{}<r> script output from \"<b>{}<r>\" due to error <b>{} {}<r>",
            bstr::BStr::new(self.script_name()),
            bstr::BStr::new(&self.scripts.package_name),
            err.errno,
            bstr::BStr::new(err.name()),
        );
        Output::flush();
    }

    fn spawn_next_script(mut self, caller: &mut ScriptCaller<'_, '_>, next_script_index: u8) {
        bun_core::analytics::Features::LIFECYCLE_SCRIPTS.fetch_add(1, Ordering::Relaxed);

        self.current_script_index = next_script_index;
        let manager = caller.install_fields();
        match self.spawn(&manager) {
            Ok(child) => manager.state.active_lifecycle_scripts.push((child, self)),
            Err(err) => {
                Output::err_generic(
                    "Failed to run script <b>{}<r> due to error <b>{}<r>",
                    (bstr::BStr::new(self.script_name()), err.name()),
                );
                caller.discard_packages_with_unfinished_scripts(self.ctx);
                drop(self);
                Global::exit(1);
            }
        }
    }

    fn spawn(&mut self, manager: &InstallFields<'_>) -> Result<BufferedSubprocess, crate::Error> {
        let original_script = self.scripts.items[self.current_script_index as usize]
            .as_ref()
            .expect("script present");

        let mut copy_script: Vec<u8> = Vec::with_capacity(original_script.len() + 1);
        replace_package_manager_run(&mut copy_script, original_script)?;
        copy_script.push(0);

        let combined_script: &ZStr = ZStr::from_slice_with_nul(&copy_script);
        let argv = ScriptArgv::new(self.shell_bin, combined_script)?;

        let (log_level, foreground) = (manager.options.log_level, self.foreground);
        if foreground && log_level != crate::LogLevel::Silent {
            Output::command(Output::CommandArgv::Single(combined_script.as_bytes()));
        } else if let Some(scripts_node) = manager.state.scripts_node {
            let emoji = ProgressStrings::SCRIPT_EMOJI.as_bytes();
            manager
                .state
                .set_node_name(scripts_node, &self.scripts.package_name, emoji);
            if manager.state.finished_installing {
                manager.state.progress.activate(scripts_node);
                manager.state.progress.refresh();
            }
        }

        bun_output::scoped_log!(
            Script,
            "{} - {} $ {}",
            bstr::BStr::new(&self.scripts.package_name),
            bstr::BStr::new(self.script_name()),
            bstr::BStr::new(combined_script.as_bytes())
        );

        let output = || {
            if log_level == crate::LogLevel::Silent {
                bun_spawn::Stdio::Ignore
            } else if log_level.is_verbose() || foreground {
                bun_spawn::Stdio::Inherit
            } else {
                bun_spawn::Stdio::Buffer
            }
        };
        let event_loop = EventLoopHandle::from_any(manager.state.event_loop);
        let spawn_options = SpawnOptions {
            stdin: if foreground {
                bun_spawn::Stdio::Inherit
            } else {
                bun_spawn::Stdio::Ignore
            },
            stdout: output(),
            stderr: output(),
            cwd: Box::<[u8]>::from(self.scripts.cwd.as_bytes()),

            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                loop_: event_loop,
                ..Default::default()
            },

            stream: false,
            // The kernel kills the child when bun dies, so no script outlives the install.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux_pdeathsig: Some(bun_sys::SignalCode::SIGKILL.0),
            ..Default::default()
        };

        self.started_at = bun_core::Timespec::now(bun_core::TimespecMockMode::AllowMockedTime).ns();
        // `envp` is shared by the whole chain. These two variables differ per script.
        let lifecycle_event = [
            b"npm_lifecycle_event=".as_slice(),
            self.script_name(),
            b"\0",
        ]
        .concat();
        let lifecycle_script = [
            b"npm_lifecycle_script=".as_slice(),
            &original_script[..],
            b"\0",
        ]
        .concat();
        let script_envp = [&lifecycle_event, &lifecycle_script]
            .map(|variable| Some(CStrRef::from_slice_with_nul(variable)));
        let envp = [self.envp.unterminated(), &script_envp, &[None]].concat();
        let envp = Some(CStrList::new(&envp));
        let spawned = bun_spawn::spawn_process(&spawn_options, argv.as_list(), envp)??;
        Ok(BufferedSubprocess::watch(spawned, event_loop)?)
    }

    fn print_output(manager: &InstallFields<'_>, child: BufferedSubprocess) {
        if manager.options.log_level.is_verbose() {
            return;
        }
        let outputs = child.into_output();
        if outputs.iter().all(Vec::is_empty) {
            return;
        }

        let _unbuffered = Output::disable_buffering_scope();
        Output::flush();

        for output in &outputs {
            if !output.is_empty() {
                // Write the raw bytes. Formatting them would replace invalid UTF-8 with U+FFFD.
                let _ = Output::error_writer().write_all(output);
                let _ = Output::error_writer().write_all(b"\n");
            }
        }
    }

    fn handle_exit(
        self,
        caller: &mut ScriptCaller<'_, '_>,
        status: Status,
        child: BufferedSubprocess,
    ) {
        bun_output::scoped_log!(
            Script,
            "{} - {} finished {}",
            bstr::BStr::new(&self.scripts.package_name),
            bstr::BStr::new(self.script_name()),
            status
        );

        match status {
            Status::Exited(exit) => {
                if exit.code > 0 {
                    if self.optional {
                        self.discard_failed_optional_package(caller);
                        return;
                    }
                    Self::print_output(&caller.install_fields(), child);
                    bun_core::pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" exited with {}<r>",
                        bstr::BStr::new(self.script_name()),
                        bstr::BStr::new(&self.scripts.package_name),
                        exit.code,
                    );
                    // Git dependencies are the only dependencies whose `prepare` scripts run.
                    if self.scripts.is_dependency && self.script_name().ends_with(b"prepare") {
                        bun_core::note!(
                            "devDependencies of a git dependency are not installed before its prepare scripts"
                        );
                    }
                    caller.discard_packages_with_unfinished_scripts(self.ctx);
                    drop(self);
                    Output::flush();
                    Global::exit(exit.code as u32);
                }
                drop(child);

                let manager = caller.install_fields();
                if !self.foreground
                    && let Some(scripts_node) = manager.state.scripts_node
                {
                    let progress = &manager.state.progress;
                    if manager.state.finished_installing {
                        progress.complete_one(scripts_node);
                    } else {
                        // As `complete_one`, but it is not shown yet.
                        let node = progress.node(scripts_node);
                        node.completed_items.update(|items| items + 1);
                    }
                }

                if let Some((entry_id, installer)) = caller.isolated(self.ctx) {
                    // preinstall
                    if self.current_script_index == 0 {
                        let previous_step = installer
                            .shared
                            .step(entry_id)
                            .swap(Step::Binaries as u32, Ordering::Release);
                        debug_assert!(previous_step == Step::RunPreinstall as u32);
                        installer.start_task(entry_id);
                        return;
                    }
                }

                for new_script_index in
                    (self.current_script_index as usize + 1)..LockfileScripts::NAMES.len()
                {
                    if self.scripts.items[new_script_index].is_some() {
                        let index = u8::try_from(new_script_index).expect("int cast");
                        self.spawn_next_script(caller, index);
                        return;
                    }
                }

                if PackageManager::verbose_install() {
                    bun_core::pretty_errorln!(
                        "<r><d>[Scripts]<r> Finished scripts for <b>{}<r>",
                        bun_core::fmt::quote(&self.scripts.package_name),
                    );
                }

                if let Some((entry_id, installer)) = caller.isolated(self.ctx) {
                    let previous_step = installer
                        .shared
                        .step(entry_id)
                        .swap(Step::Done as u32, Ordering::Release);
                    if bun_core::Environment::CI_ASSERT {
                        debug_assert!(self.current_script_index != 0);
                        debug_assert!(
                            previous_step == Step::RunPostInstallAndPrePostPrepare as u32
                        );
                    }
                    installer.on_task_complete(entry_id, CompleteState::Success);
                }

                // the last script finished
                self.forget_unfinished_scripts(&mut caller.install_fields());
            }
            Status::Signaled(signal) => {
                Self::print_output(&caller.install_fields(), child);
                let signal_code = bun_sys::SignalCode(signal);

                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" terminated by {}<r>",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.scripts.package_name),
                    signal_code.fmt(Output::enable_ansi_colors_stderr()),
                );
                caller.discard_packages_with_unfinished_scripts(self.ctx);

                Global::raise_ignoring_panic_handler_raw(core::ffi::c_int::from(signal));
            }
            Status::Err(err) => {
                if self.optional {
                    self.discard_failed_optional_package(caller);
                    return;
                }

                bun_core::pretty_errorln!(
                    "<r><red>error<r>: Failed to run <b>{}<r> script from \"<b>{}<r>\" due to\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.scripts.package_name),
                    err,
                );
                caller.discard_packages_with_unfinished_scripts(self.ctx);
                drop((self, child));
                Output::flush();
                Global::exit(1);
            }
            _ => {
                Output::panic(format_args!(
                    "error: Failed to run {} script from \"{}\" due to unexpected status\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.scripts.package_name),
                    status,
                ));
            }
        }
    }

    fn forget_unfinished_scripts(&self, manager: &mut InstallFields<'_>) {
        if let Some(InstallCtx::Hoisted { tree_id }) = self.ctx {
            manager
                .state
                .unfinished_scripts
                .retain(|(tree, folder_name)| {
                    *tree != tree_id || *folder_name != self.scripts.package_name
                });
        }
    }

    fn discard_failed_optional_package(&self, caller: &mut ScriptCaller<'_, '_>) {
        self.forget_unfinished_scripts(&mut caller.install_fields());
        let deleted = if let Some(InstallCtx::Hoisted { tree_id }) = self.ctx {
            crate::package_installer::remove_placed_package(
                caller.install_fields().lockfile,
                tree_id,
                &self.scripts.package_name,
            );
            true
        } else {
            (caller.isolated(self.ctx))
                .is_some_and(|(entry_id, installer)| installer.leave_out_entry(entry_id))
        };
        if caller.install_fields().options.log_level.is_verbose() {
            bun_core::warn!(
                "{} optional dependency '{}' due to failed '{}' script",
                if deleted { "deleting" } else { "skipping" },
                bstr::BStr::new(&self.scripts.package_name),
                bstr::BStr::new(self.script_name()),
            );
        }
    }

    pub(crate) fn spawn_package_scripts(
        caller: &mut ScriptCaller<'_, '_>,
        list: ScriptsList,
        envp: CStringList,
        shell_bin: Option<&'static ZStr>,
        optional: bool,
        foreground: bool,
        ctx: Option<InstallCtx>,
    ) {
        if caller.install_fields().options.log_level.is_verbose() {
            bun_core::pretty_errorln!(
                "<d>[Scripts]<r> Starting scripts for <b>\"{}\"<r>",
                bstr::BStr::new(&list.package_name),
            );
        }

        let first_index = list.first_index;
        let runner = LifecycleScriptRunner {
            envp,
            shell_bin,
            scripts: list,
            foreground,
            optional,
            ctx,
            current_script_index: 0,
            started_at: 0,
        };
        runner.spawn_next_script(caller, first_index);
    }
}

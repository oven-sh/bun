use core::sync::atomic::{AtomicUsize, Ordering};

use crate::PackageManager;
use crate::isolated_install::installer::{CompleteState, Installer, Step};
use crate::isolated_install::store::{EntryColumns, entry};
use crate::lockfile_real::Scripts as LockfileScripts;
use crate::lockfile_real::package::scripts::List as ScriptsList;
use crate::package_manager_real::ProgressStrings;
use bun_core::{Global, Output};
#[cfg(unix)]
use bun_io::PosixFlags;
use bun_io::heap as io_heap;
use bun_io::max_buf::Kind;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag, ReadResult};

use bun_core::{CStrList, CStrRef, CStringList, ZStr};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{
    Process, ProcessExit, ProcessExitKind, ProcessHandle, Rusage, SpawnOptions, SpawnProcessResult,
    Status,
};
#[cfg(unix)]
use bun_sys::Fd;

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

/// A `Box` between scripts. While one runs, its process, the readers and the heap point at it.
pub struct LifecycleScriptSubprocess<'a> {
    pub(crate) package_name: Box<[u8]>,

    pub(crate) scripts: ScriptsList,
    pub(crate) current_script_index: u8,

    pub(crate) remaining_fds: i8,
    /// `None` between scripts (`reset_polls`).
    pub(crate) process: Option<ProcessHandle>,
    pub(crate) stdout: OutputReader,
    pub(crate) stderr: OutputReader,
    /// `BackRef`, not `&'a`: the install loop holds `&mut PackageManager` while scripts run.
    pub(crate) manager: bun_ptr::BackRef<PackageManager>,
    /// Owned by this
    /// struct so the `K=V\0` strings stay alive across every async
    /// `spawn_next_script` for the script chain; freed with it.
    pub(crate) envp: CStringList,
    pub(crate) shell_bin: Option<&'a ZStr>,

    pub(crate) foreground: bool,
    pub(crate) optional: bool,
    pub(crate) started_at: u64,

    pub(crate) ctx: Option<InstallCtx<'a>>,

    pub(crate) heap: io_heap::IntrusiveField<LifecycleScriptSubprocess<'a>>,
}

/// The linker, not the script's cwd, determines what gets removed when an optional dependency's
/// script fails.
pub enum InstallCtx<'a> {
    Isolated {
        entry_id: entry::Id,
        /// A raw `*mut`, because `on_task_complete` and `start_task` mutate it from an exit-handler
        /// callback.
        installer: *mut Installer<'a>,
    },
    /// The package is `node_modules/<package_name>` of this tree.
    Hoisted {
        tree_id: crate::lockfile_real::tree::Id,
        unfinished: UnfinishedScripts,
    },
}

/// The packages that the hoisted linker placed and whose scripts haven't all run yet. Main thread
/// only.
pub(crate) type UnfinishedScripts =
    std::rc::Rc<core::cell::RefCell<Vec<(crate::lockfile_real::tree::Id, Box<[u8]>)>>>;

impl<'a> InstallCtx<'a> {
    /// BACKREF accessor — single `unsafe` deref for the set-once `installer`
    /// pointer so call sites in `handle_exit` are safe.
    ///
    /// SAFETY (encapsulated): `installer` is non-null and outlives every
    /// `LifecycleScriptSubprocess` (the `Installer` owns the script-spawn
    /// loop). Exit-handler callbacks run single-threaded on the main install
    /// loop, so no other `&`/`&mut Installer` overlaps the returned borrow.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn isolated(&self) -> Option<(entry::Id, &mut Installer<'a>)> {
        let Self::Isolated {
            entry_id,
            installer,
        } = *self
        else {
            return None;
        };
        // SAFETY: see fn doc.
        Some((entry_id, unsafe { &mut *installer }))
    }
}

pub type List<'a> = io_heap::Intrusive<LifecycleScriptSubprocess<'a>>;

impl<'a> io_heap::HeapNode for LifecycleScriptSubprocess<'a> {
    #[inline]
    fn heap(&self) -> &io_heap::IntrusiveField<Self> {
        &self.heap
    }

    #[inline]
    fn less(&self, other: &Self) -> bool {
        self.started_at < other.started_at
    }
}

static ALIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

impl<'a> LifecycleScriptSubprocess<'a> {
    /// Returns the
    /// global atomic so callers can write
    /// `LifecycleScriptSubprocess::alive_count().load(..)`.
    #[inline]
    pub fn alive_count() -> &'static AtomicUsize {
        &ALIVE_COUNT
    }
}

pub type OutputReader = BufferedReader;

impl<'a> LifecycleScriptSubprocess<'a> {
    #[inline]
    fn manager(&self) -> &PackageManager {
        // `manager` is non-null and outlives every subprocess (the
        // `PackageManager` is the singleton install-loop owner).
        self.manager.get()
    }

    pub(crate) fn script_name(&self) -> &'static [u8] {
        debug_assert!((self.current_script_index as usize) < LockfileScripts::NAMES.len());
        LockfileScripts::NAMES[self.current_script_index as usize].as_bytes()
    }

    fn event_loop(&self) -> bun_event_loop::EventLoopHandle {
        self.manager().event_loop
    }

    /// `true` if the reader has ended.
    fn note_read_result(&mut self, result: ReadResult) -> bool {
        match result {
            ReadResult::Pending => return false,
            ReadResult::Done => {}
            ReadResult::Err(err) => {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: Failed to read <b>{}<r> script output from \"<b>{}<r>\" due to error <b>{} {}<r>",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.package_name),
                    err.errno,
                    bstr::BStr::new(err.name()),
                );
                Output::flush();
            }
        }
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds -= 1;
        true
    }

    fn reader(&self, kind: Kind) -> &OutputReader {
        match kind {
            Kind::Stdout => &self.stdout,
            Kind::Stderr => &self.stderr,
        }
    }

    /// `true` if the reader has ended.
    fn read(&mut self, kind: Kind, event: IoEvent) -> bool {
        let event_loop = self.event_loop().as_event_loop_ctx();
        let result = self.reader(kind).read(event_loop, Some(event));
        self.note_read_result(result)
    }

    /// # Safety
    /// `this` is what [`Self::watch`] handed out. It may be freed.
    pub unsafe fn on_io(this: *mut Self, kind: Kind, event: IoEvent) {
        // SAFETY: fn contract. Nothing else runs until `maybe_finished`.
        unsafe {
            if (*this).read(kind, event) {
                Self::maybe_finished(this);
            }
        }
    }

    /// # Safety
    /// `this` is what [`Self::watch`] handed out. It may be freed.
    #[inline(never)]
    unsafe fn maybe_finished(this: *mut Self) {
        bun_removable_features::removable_definition!(Install, Self::maybe_finished);
        // SAFETY: fn contract. `watch` put it in the heap. The process and the readers each report
        // once, so nothing calls back after the last of them.
        let (this, status) = unsafe {
            if (*this).remaining_fds != 0 {
                return;
            }
            let Some(status) = (*this).process.as_ref().and_then(|p| p.status()).cloned() else {
                return;
            };
            let active = &(*this).manager.get().active_lifecycle_scripts;
            active.remove(this.cast());
            (bun_core::heap::take(this), status)
        };
        this.handle_exit(status);
    }

    /// Posix-only: re-prime a recycled `PosixBufferedReader` for a fresh socket fd.
    /// Only called from the `#[cfg(unix)]` branch of [`Self::start_readers`]; on Windows
    /// the `OutputReader` is a `WindowsBufferedReader` (libuv-pipe-backed) and this fn is dead.
    #[cfg(unix)]
    fn reset_output_flags(output: &OutputReader, fd: Fd) {
        output.update_flags(|f| {
            f.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
            f.remove(
                PosixFlags::MEMFD | PosixFlags::RECEIVED_EOF | PosixFlags::CLOSED_WITHOUT_REPORTING,
            );
        });

        #[cfg(debug_assertions)]
        {
            let flags = bun_sys::get_fcntl_flags(fd).expect("Failed to get fcntl flags");
            debug_assert!(flags & bun_sys::O::NONBLOCK as isize != 0);

            let stat = bun_sys::fstat(fd).expect("Failed to fstat");
            debug_assert!(bun_sys::S::ISSOCK(stat.st_mode as _));
        }
        let _ = fd;
    }

    /// Used to be called from multiple threads during isolated installs; now single-threaded
    /// TODO: re-evaluate whether some variables still need to be atomic
    fn spawn_next_script(mut self: Box<Self>, next_script_index: u8) {
        bun_core::analytics::Features::LIFECYCLE_SCRIPTS.fetch_add(1, Ordering::Relaxed);
        // Relaxed is enough, because it's only read and written on the main thread.
        let _ = ALIVE_COUNT.fetch_add(1, Ordering::Relaxed);

        self.current_script_index = next_script_index;
        match self.spawn() {
            Ok(spawned) => self.watch(spawned),
            Err(err) => self.exit_with_error(err),
        }
    }

    fn exit_with_error(&self, err: crate::Error) -> ! {
        Output::err_generic(
            "Failed to run script <b>{}<r> due to error <b>{}<r>",
            (bstr::BStr::new(self.script_name()), err.name()),
        );
        self.discard_packages_with_unfinished_scripts();
        Global::exit(1);
    }

    fn spawn(&mut self) -> Result<SpawnProcessResult, crate::Error> {
        let original_script = self.scripts.items[self.current_script_index as usize]
            .as_ref()
            .expect("script present");

        let mut copy_script: Vec<u8> = Vec::with_capacity(original_script.len() + 1);
        replace_package_manager_run(&mut copy_script, original_script)?;
        copy_script.push(0);

        let combined_script: &ZStr = ZStr::from_slice_with_nul(&copy_script);
        let argv = ScriptArgv::new(self.shell_bin, combined_script)?;

        let (log_level, foreground) = (self.manager().options.log_level, self.foreground);
        if foreground && log_level != crate::LogLevel::Silent {
            Output::command(Output::CommandArgv::Single(combined_script.as_bytes()));
        } else if let Some(scripts_node) = self.manager().scripts_node {
            let manager = self.manager();
            let emoji = ProgressStrings::SCRIPT_EMOJI.as_bytes();
            manager.set_node_name(scripts_node, &self.package_name, emoji);
            // .monotonic is okay: only hoisted installs use this, and only on the main thread.
            if manager.finished_installing.load(Ordering::Relaxed) {
                manager.progress.activate(scripts_node);
                manager.progress.refresh();
            }
        }

        bun_output::scoped_log!(
            Script,
            "{} - {} $ {}",
            bstr::BStr::new(&self.package_name),
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
                loop_: self.event_loop(),
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
        Ok(bun_spawn::spawn_process(
            &spawn_options,
            argv.as_list(),
            envp,
        )??)
    }

    fn start_readers(&mut self, spawned: &mut SpawnProcessResult) {
        for (kind, stdio) in [
            (Kind::Stdout, spawned.stdout.take()),
            (Kind::Stderr, spawned.stderr.take()),
        ] {
            #[cfg(unix)]
            if let Some(fd) = stdio.map(bun_sys::File::into_raw) {
                if spawned.memfds[kind as usize + 1] {
                    self.reader(kind).start_memfd(fd);
                    continue;
                }
                let _ = bun_sys::set_nonblocking(fd);
                self.remaining_fds += 1;

                Self::reset_output_flags(self.reader(kind), fd);
                let event_loop = self.event_loop().as_event_loop_ctx();
                match self.reader(kind).start(event_loop, fd, true) {
                    Ok(result) => _ = self.note_read_result(result),
                    Err(err) => self.exit_with_error(err.into()),
                }
            }
            #[cfg(windows)]
            if let bun_spawn::SpawnedStdio::Buffer(pipe) = stdio {
                self.remaining_fds += 1;
                if let Err(err) = self.reader(kind).start_with_pipe(pipe) {
                    self.exit_with_error(err.into());
                }
            }
        }
    }

    /// Leaves `self` to the process and the readers until [`Self::maybe_finished`].
    fn watch(self: Box<Self>, mut spawned: SpawnProcessResult) {
        debug_assert!(self.process.is_none(), "forgot to call `reset_polls`");
        let this = bun_core::heap::into_raw(self);
        // SAFETY: `this` is live until the process has reported, which only the last statement can
        // cause. Only fields are borrowed across it. The readers are fields of `this`.
        unsafe {
            for kind in [Kind::Stdout, Kind::Stderr] {
                let owner = Owner::with_kind(PollTag::LifecycleScript, kind, this.cast());
                (*this).reader(kind).set_owner(owner);
            }
            let active = &(*this).manager.get().active_lifecycle_scripts;
            active.insert(this.cast());
            (*this).start_readers(&mut spawned);

            let event_loop = (*this).event_loop();
            let process = (*this)
                .process
                .insert(spawned.to_process_handle(event_loop))
                .this_ptr();
            process.set_exit_handler(ProcessExit::new(ProcessExitKind::LifecycleScript, this));

            if let Err(err) = Process::watch_or_reap(process) {
                if !process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (#[repr(C)] POD).
                    Process::on_exit(
                        process,
                        Status::Err(err),
                        &bun_core::ffi::zeroed::<Rusage>(),
                    );
                }
            }
        }
    }

    pub(crate) fn print_output(&mut self) {
        if !self.manager().options.log_level.is_verbose() {
            // Reuse the memory
            // Reshaped for borrowck — evaluate
            // the stderr-capacity check first (immutable), then take the
            // disjoint `stdout` mutable borrow, so `core::mem::take` only fires
            // when all three clauses
            // (`stdout.len==0 && stdout.cap>0 && stderr.buffer().cap==0`)
            // hold — otherwise stdout's buffer is left
            // in place for the `stdout.items.len +| stderr.items.len` check.
            if self.stderr.buffer().capacity() == 0 {
                let stdout = self.stdout.final_buffer();
                if stdout.is_empty() && stdout.capacity() > 0 {
                    let buf = core::mem::take(stdout);
                    *self.stderr.buffer() = buf;
                }
            }

            let stdout_len = self.stdout.final_buffer().len();
            let stderr_len = self.stderr.final_buffer().len();

            if stdout_len.saturating_add(stderr_len) == 0 {
                return;
            }

            let _unbuffered = Output::disable_buffering_scope();
            Output::flush();

            if stdout_len > 0 {
                let stdout = self.stdout.final_buffer();
                // Write the raw bytes. Formatting them would replace invalid UTF-8 with U+FFFD.
                let _ = Output::error_writer().write_all(stdout.as_slice());
                let _ = Output::error_writer().write_all(b"\n");
                stdout.clear();
                stdout.shrink_to_fit();
            }

            if stderr_len > 0 {
                let stderr = self.stderr.final_buffer();
                let _ = Output::error_writer().write_all(stderr.as_slice());
                let _ = Output::error_writer().write_all(b"\n");
                stderr.clear();
                stderr.shrink_to_fit();
            }
        }
    }

    fn handle_exit(mut self: Box<Self>, status: Status) {
        bun_output::scoped_log!(
            Script,
            "{} - {} finished {}",
            bstr::BStr::new(&self.package_name),
            bstr::BStr::new(self.script_name()),
            status
        );

        // Relaxed is enough, because it's only read and written on the main thread.
        let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);

        match status {
            Status::Exited(exit) => {
                if exit.code > 0 {
                    if self.optional {
                        self.discard_failed_optional_package();
                        return;
                    }
                    self.print_output();
                    bun_core::pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" exited with {}<r>",
                        bstr::BStr::new(self.script_name()),
                        bstr::BStr::new(&self.package_name),
                        exit.code,
                    );
                    // Git dependencies are the only dependencies whose `prepare` scripts run.
                    if self.scripts.is_dependency && self.script_name().ends_with(b"prepare") {
                        bun_core::note!(
                            "devDependencies of a git dependency are not installed before its prepare scripts"
                        );
                    }
                    self.discard_packages_with_unfinished_scripts();
                    drop(self);
                    Output::flush();
                    Global::exit(exit.code as u32);
                }

                if !self.foreground
                    && let Some(scripts_node) = self.manager().scripts_node
                {
                    let progress = &self.manager().progress;
                    // .monotonic is okay because because this value is only used by hoisted
                    // installs, which only use this type on the main thread.
                    if self.manager().finished_installing.load(Ordering::Relaxed) {
                        progress.complete_one(scripts_node);
                    } else {
                        // As `complete_one`, but it is not shown yet.
                        let node = progress.node(scripts_node);
                        node.completed_items.update(|items| items + 1);
                    }
                }

                if let Some((entry_id, installer)) =
                    self.ctx.as_ref().and_then(InstallCtx::isolated)
                {
                    // preinstall
                    if self.current_script_index == 0 {
                        let previous_step = installer.store.entries.items_step()
                            [entry_id.get() as usize]
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
                        self.reset_polls();
                        self.spawn_next_script(u8::try_from(new_script_index).expect("int cast"));
                        return;
                    }
                }

                if PackageManager::verbose_install() {
                    bun_core::pretty_errorln!(
                        "<r><d>[Scripts]<r> Finished scripts for <b>{}<r>",
                        bun_core::fmt::quote(&self.package_name),
                    );
                }

                if let Some((entry_id, installer)) =
                    self.ctx.as_ref().and_then(InstallCtx::isolated)
                {
                    let previous_step = installer.store.entries.items_step()
                        [entry_id.get() as usize]
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
                self.forget_unfinished_scripts();
            }
            Status::Signaled(signal) => {
                self.print_output();
                let signal_code = bun_sys::SignalCode(signal);

                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" terminated by {}<r>",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.package_name),
                    signal_code.fmt(Output::enable_ansi_colors_stderr()),
                );
                self.discard_packages_with_unfinished_scripts();

                Global::raise_ignoring_panic_handler_raw(core::ffi::c_int::from(signal));
            }
            Status::Err(err) => {
                if self.optional {
                    self.discard_failed_optional_package();
                    return;
                }

                bun_core::pretty_errorln!(
                    "<r><red>error<r>: Failed to run <b>{}<r> script from \"<b>{}<r>\" due to\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.package_name),
                    err,
                );
                self.discard_packages_with_unfinished_scripts();
                drop(self);
                Output::flush();
                Global::exit(1);
            }
            _ => {
                Output::panic(format_args!(
                    "error: Failed to run {} script from \"{}\" due to unexpected status\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.package_name),
                    status,
                ));
            }
        }
    }

    pub(crate) fn reset_polls(&mut self) {
        debug_assert!(self.remaining_fds == 0);

        self.process = None;
        self.stdout = OutputReader::init();
        self.stderr = OutputReader::init();
    }

    fn forget_unfinished_scripts(&self) {
        if let Some(InstallCtx::Hoisted {
            tree_id,
            unfinished,
        }) = &self.ctx
        {
            unfinished.borrow_mut().retain(|(tree, folder_name)| {
                tree != tree_id || **folder_name != *self.package_name
            });
        }
    }

    /// Both linkers treat a package that's at its final path as installed. Removing these packages
    /// makes the next install run their scripts.
    fn discard_packages_with_unfinished_scripts(&self) {
        Output::flush();
        if let Some(InstallCtx::Hoisted { unfinished, .. }) = &self.ctx {
            for (tree_id, folder_name) in unfinished.borrow().iter() {
                crate::package_installer::remove_placed_package(
                    &self.manager().lockfile,
                    *tree_id,
                    folder_name,
                );
            }
        } else if let Some((entry_id, installer)) = self.ctx.as_ref().and_then(InstallCtx::isolated)
        {
            installer.discard_entries_with_unfinished_scripts(entry_id);
        }
    }

    fn discard_failed_optional_package(&mut self) {
        self.forget_unfinished_scripts();
        let deleted = match self.ctx.take() {
            Some(InstallCtx::Hoisted { tree_id, .. }) => {
                crate::package_installer::remove_placed_package(
                    &self.manager().lockfile,
                    tree_id,
                    &self.package_name,
                );
                true
            }
            Some(ctx) => ctx
                .isolated()
                .is_some_and(|(entry_id, installer)| installer.leave_out_entry(entry_id)),
            None => false,
        };
        if self.manager().options.log_level.is_verbose() {
            bun_core::warn!(
                "{} optional dependency '{}' due to failed '{}' script",
                if deleted { "deleting" } else { "skipping" },
                bstr::BStr::new(&self.package_name),
                bstr::BStr::new(self.script_name()),
            );
        }
    }

    pub(crate) fn spawn_package_scripts(
        manager: &mut PackageManager,
        list: ScriptsList,
        envp: CStringList,
        shell_bin: Option<&'a ZStr>,
        optional: bool,
        log_level: crate::LogLevel,
        foreground: bool,
        ctx: Option<InstallCtx<'a>>,
    ) {
        let package_name = list.package_name.clone();
        let lss = Box::new(LifecycleScriptSubprocess {
            manager: bun_ptr::BackRef::new(manager),
            envp,
            shell_bin,
            package_name,
            scripts: list,
            foreground,
            optional,
            ctx,
            // defaults:
            current_script_index: 0,
            remaining_fds: 0,
            process: None,
            stdout: OutputReader::init(),
            stderr: OutputReader::init(),
            started_at: 0,
            heap: io_heap::IntrusiveField::default(),
        });

        if log_level.is_verbose() {
            bun_core::pretty_errorln!(
                "<d>[Scripts]<r> Starting scripts for <b>\"{}\"<r>",
                bstr::BStr::new(&lss.scripts.package_name),
            );
        }

        lss.increment_pending_script_tasks();

        let first_index = lss.scripts.first_index;
        lss.spawn_next_script(first_index);
    }

    fn increment_pending_script_tasks(&self) {
        // .monotonic is okay because this is just used for progress. Other threads
        // don't rely on side effects of tasks based on this value. (And in the case
        // of hoisted installs it's single-threaded.)
        let _ = self
            .manager()
            .pending_lifecycle_script_tasks
            .fetch_add(1, Ordering::Relaxed);
    }
}

impl Drop for LifecycleScriptSubprocess<'_> {
    fn drop(&mut self) {
        // .monotonic is okay because this is just used for progress (see
        // `increment_pending_script_tasks`).
        let _ = self
            .manager()
            .pending_lifecycle_script_tasks
            .fetch_sub(1, Ordering::Relaxed);
    }
}

bun_spawn::link_impl_ProcessExit! {
    LifecycleScript for LifecycleScriptSubprocess<'static> => |this| {
        on_process_exit(_status, _rusage) => LifecycleScriptSubprocess::maybe_finished(this),
    }
}

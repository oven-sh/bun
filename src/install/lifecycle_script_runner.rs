use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::PackageManager;
use crate::isolated_install::store::entry;
use crate::lockfile_real::Scripts as LockfileScripts;
use crate::lockfile_real::package::scripts::List as ScriptsList;
use crate::package_manager_real::ProgressStrings;
use bun_core::{Global, Output};
use bun_event_loop::EventLoopHandle;
use bun_io::BufferedReader;
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};
use bun_ptr::{JsCell, ThisPtr};

use bun_core::ZStr;
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{ProcessHandle, SpawnOptions, Status};
#[cfg(unix)]
use bun_sys::Fd;
// `BufferedReaderParent::loop_` is typed `*mut bun_uws::Loop` (the
// `bun_io::Loop` is the trait's nominal: `us_loop_t` on POSIX, `uv_loop_t`
// on Windows. `AnyEventLoop::native_loop()` projects through the uws wrapper
// (`WindowsLoop::uv_loop`) on Windows so both paths hand back the same shape
// `BufferedReaderParent::loop_` expects.

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
                        copy_script.push(b' ');
                        entry_i += b"npm run ".len();
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

/// One package's lifecycle scripts, run one after the other as subprocesses.
///
/// Owned by `PackageManager::active_lifecycle_scripts`; the process exit
/// handler and the two output readers reach it through the `ThisPtr` its
/// [`bun_ptr::OwnedThis`] lends, so everything they touch is a `Cell`. Those
/// callbacks only record what happened; the install loop picks finished
/// scripts up in [`PackageManager::drain_lifecycle_scripts`], where the
/// manager (and, for isolated installs, the store installer) is available.
pub struct LifecycleScriptSubprocess {
    pub(crate) package_name: Box<[u8]>,

    pub(crate) scripts: ScriptsList,
    pub(crate) current_script_index: Cell<u8>,

    pub(crate) remaining_fds: Cell<i8>,
    pub(crate) process: Cell<Option<ProcessHandle>>,
    /// Set by the exit handler; `Some` once the current script's process is gone.
    pub(crate) exit_status: Cell<Option<Status>>,
    pub(crate) stdout: JsCell<OutputReader>,
    pub(crate) stderr: JsCell<OutputReader>,
    pub(crate) event_loop: EventLoopHandle,
    /// Owned by this
    /// struct so the `K=V\0` buffers stay alive across every async
    /// `spawn_next_script` for the script chain.
    pub(crate) envp: bun_dotenv::NullDelimitedEnvMap,
    pub(crate) shell_bin: Option<bun_core::ZBox>,

    pub(crate) has_incremented_alive_count: Cell<bool>,

    pub(crate) foreground: bool,
    pub(crate) optional: bool,
    pub(crate) started_at: Cell<u64>,

    /// The store entry these scripts run for (isolated installs).
    pub(crate) entry_id: Option<entry::Id>,
}

pub type List = Vec<bun_ptr::OwnedThis<LifecycleScriptSubprocess>>;

static ALIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

impl LifecycleScriptSubprocess {
    /// Returns the
    /// global atomic so callers can write
    /// `LifecycleScriptSubprocess::alive_count().load(..)`.
    #[inline]
    pub fn alive_count() -> &'static AtomicUsize {
        &ALIVE_COUNT
    }
}

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

pub type OutputReader = BufferedReader;

/// What finishing a script means for the store entry it ran for.
pub enum EntryEvent {
    /// `preinstall` succeeded: the entry can move on to linking binaries.
    PreinstallDone,
    /// All scripts ran.
    Done,
    /// An optional dependency's script failed; the package was removed.
    Skipped,
}

impl LifecycleScriptSubprocess {
    pub(crate) fn script_name(&self) -> &'static [u8] {
        debug_assert!((self.current_script_index.get() as usize) < LockfileScripts::NAMES.len());
        LockfileScripts::NAMES[self.current_script_index.get() as usize].as_bytes()
    }

    /// The process is gone and both output pipes are drained.
    #[inline]
    pub(crate) fn is_finished(&self) -> bool {
        let status = self.exit_status.take();
        let exited = status.is_some();
        self.exit_status.set(status);
        exited && self.remaining_fds.get() == 0
    }

    pub(crate) fn on_reader_done(&self) {
        debug_assert!(self.remaining_fds.get() > 0);
        self.remaining_fds.set(self.remaining_fds.get() - 1);
    }

    pub(crate) fn on_reader_error(&self, err: &bun_sys::Error) {
        debug_assert!(self.remaining_fds.get() > 0);
        self.remaining_fds.set(self.remaining_fds.get() - 1);

        bun_core::pretty_errorln!(
            "<r><red>error<r>: Failed to read <b>{}<r> script output from \"<b>{}<r>\" due to error <b>{} {}<r>",
            bstr::BStr::new(self.script_name()),
            bstr::BStr::new(&self.package_name),
            err.errno,
            bstr::BStr::new(err.name()),
        );
        Output::flush();
    }

    /// This is called from the process's exit handler; the install loop
    /// finishes the script in `PackageManager::drain_lifecycle_scripts`.
    pub(crate) fn on_process_exit(&self, status: Status) {
        self.exit_status.set(Some(status));
    }

    /// Posix-only: re-prime a recycled `PosixBufferedReader` for a fresh socket fd.
    /// Only called from the `#[cfg(unix)]` branch of [`spawn_next_script_inner`]; on Windows
    /// the `OutputReader` is a `WindowsBufferedReader` (libuv-pipe-backed) and this fn is dead.
    #[cfg(unix)]
    fn reset_output_flags(output: &mut OutputReader, fd: Fd) {
        output
            .flags
            .insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
        output.flags.remove(
            PosixFlags::MEMFD | PosixFlags::RECEIVED_EOF | PosixFlags::CLOSED_WITHOUT_REPORTING,
        );

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
    pub(crate) fn spawn_next_script(
        this: ThisPtr<Self>,
        manager: &mut PackageManager,
        next_script_index: u8,
    ) -> Result<(), crate::Error> {
        bun_core::analytics::Features::LIFECYCLE_SCRIPTS.fetch_add(1, Ordering::Relaxed);

        let me = this.get();
        if !me.has_incremented_alive_count.get() {
            me.has_incremented_alive_count.set(true);
            // .monotonic is okay because because this value is only used by hoisted installs, which
            // only use this type on the main thread.
            let _ = ALIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        }

        let result = Self::spawn_next_script_inner(this, manager, next_script_index);
        if result.is_err() {
            let me = this.get();
            if me.has_incremented_alive_count.get() {
                me.has_incremented_alive_count.set(false);
                // .monotonic is okay because because this value is only used by hoisted installs.
                let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
            }
        }
        result
    }

    fn spawn_next_script_inner(
        this: ThisPtr<Self>,
        manager: &mut PackageManager,
        next_script_index: u8,
    ) -> Result<(), crate::Error> {
        let me = this.get();
        let original_script = me.scripts.items[next_script_index as usize]
            .as_ref()
            .expect("script present");
        let cwd = me.scripts.cwd.as_bytes();
        let parent = this.as_ptr().cast::<c_void>();
        me.stdout.with_mut(|r| r.set_parent(parent));
        me.stderr.with_mut(|r| r.set_parent(parent));

        me.current_script_index.set(next_script_index);
        me.exit_status.set(None);

        let mut copy_script: Vec<u8> = Vec::with_capacity(original_script.len() + 1);
        replace_package_manager_run(&mut copy_script, original_script)?;
        copy_script.push(0);
        let combined_script = ZStr::from_buf(&copy_script[..], copy_script.len() - 1);

        if me.foreground && manager.options.log_level != crate::LogLevel::Silent {
            Output::command(Output::CommandArgv::Single(combined_script.as_bytes()));
        } else if let Some(scripts_node) = manager.scripts_node.as_mut() {
            PackageManager::set_node_name(
                scripts_node,
                &me.package_name,
                ProgressStrings::SCRIPT_EMOJI.as_bytes(),
            );
            // .monotonic is okay because because this value is only used by hoisted installs, which
            // only use this type on the main thread.
            if manager.finished_installing.load(Ordering::Relaxed) {
                scripts_node.activate();
                manager.progress.refresh();
            }
        }

        bun_output::scoped_log!(
            Script,
            "{} - {} $ {}",
            bstr::BStr::new(&me.package_name),
            bstr::BStr::new(me.script_name()),
            bstr::BStr::new(combined_script.as_bytes())
        );

        let self_exe;
        let argv0: &ZStr = match &me.shell_bin {
            Some(shell) if !cfg!(windows) => shell,
            _ => {
                self_exe = bun_core::self_exe_path()?;
                self_exe
            }
        };
        let argv1: &ZStr = if me.shell_bin.is_some() && !cfg!(windows) {
            ZStr::from_static(b"-c\0")
        } else {
            ZStr::from_static(b"exec\0")
        };
        let argv: [&core::ffi::CStr; 3] =
            [argv0.as_cstr(), argv1.as_cstr(), combined_script.as_cstr()];
        let envp: Vec<&core::ffi::CStr> = me.envp.iter().collect();

        // OWNERSHIP:
        // `bun_io::Source::Pipe` owns a `Box<uv::Pipe>` AND
        // `spawn_process_windows` does `heap::take(ptr)` on the
        // `Stdio::Buffer` pointer to produce a SECOND `Box<uv::Pipe>` in
        // `WindowsStdioResult::Buffer` — pre-stashing here would create two
        // `Box`es over one allocation (UAF + double-free when `spawned`
        // drops). Instead allocate the raw heap pipe inline in the
        // `Stdio::Buffer` arm below (so it is only allocated when actually
        // passed to libuv) and take SOLE ownership from
        // `spawned.stdout/stderr` after spawn — see the `#[cfg(windows)]`
        // block below and `filter_run.rs` for the canonical pattern.
        let spawn_options = SpawnOptions {
            stdin: if me.foreground {
                bun_spawn::Stdio::Inherit
            } else {
                bun_spawn::Stdio::Ignore
            },

            stdout: if manager.options.log_level == crate::LogLevel::Silent {
                bun_spawn::Stdio::Ignore
            } else if manager.options.log_level.is_verbose() || me.foreground {
                bun_spawn::Stdio::Inherit
            } else {
                #[cfg(unix)]
                {
                    bun_spawn::Stdio::Buffer
                }
                #[cfg(not(unix))]
                {
                    // Ownership of this raw heap allocation transfers to
                    // `spawn_process_windows`, which `heap::take`s it into
                    // `spawned.stdout`.
                    bun_spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                        bun_core::ffi::zeroed::<uv::Pipe>(),
                    ))
                        as bun_spawn::windows::UvPipePtr)
                }
            },
            stderr: if manager.options.log_level == crate::LogLevel::Silent {
                bun_spawn::Stdio::Ignore
            } else if manager.options.log_level.is_verbose() || me.foreground {
                bun_spawn::Stdio::Inherit
            } else {
                #[cfg(unix)]
                {
                    bun_spawn::Stdio::Buffer
                }
                #[cfg(not(unix))]
                {
                    // Ownership transfers to `spawned.stderr`.
                    bun_spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                        bun_core::ffi::zeroed::<uv::Pipe>(),
                    ))
                        as bun_spawn::windows::UvPipePtr)
                }
            },
            cwd: Box::<[u8]>::from(cwd),

            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                loop_: me.event_loop,
                ..Default::default()
            },

            stream: false,
            ..Default::default()
        };

        me.remaining_fds.set(0);
        me.started_at
            .set(bun_core::Timespec::now(bun_core::TimespecMockMode::AllowMockedTime).ns());
        let spawned = match bun_spawn::spawn_process_cstr(
            &spawn_options,
            &argv,
            bun_spawn::SpawnEnv::Strings(&envp),
        ) {
            Ok(Ok(s)) => s,
            res => {
                #[cfg(windows)]
                {
                    // `spawn_process_windows` only `heap::take`s the `Stdio::Buffer`
                    // raw `*mut uv::Pipe` allocations on the SUCCESS path; on every
                    // error return (uv_pipe_init failure, uv_spawn failure) ownership
                    // stays with the caller. `WindowsStdio` has no `Drop`, so reclaim
                    // and `uv_close`+free them explicitly here — otherwise the heap
                    // `uv::Pipe`s leak (and, if already `uv_pipe_init`'d, remain
                    // linked in the libuv loop's handle queue forever). Allocation
                    // happens inline (see OWNERSHIP note above), so the error
                    // path must be handled explicitly.
                    let mut spawn_options = spawn_options;
                    spawn_options.stdout.deinit();
                    spawn_options.stderr.deinit();
                }
                res??;
                unreachable!();
            }
        };
        #[cfg(windows)]
        let mut spawned = spawned;

        #[cfg(unix)]
        {
            if let Some(stdout) = spawned.stdout {
                if !spawned.memfds[1] {
                    let _ = bun_sys::set_nonblocking(stdout);
                    me.remaining_fds.set(me.remaining_fds.get() + 1);
                    me.stdout.with_mut(|r| {
                        Self::reset_output_flags(r, stdout);
                        r.start(stdout, true)?;
                        if let Some(poll) = r.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                        }
                        bun_sys::Result::Ok(())
                    })?;
                } else {
                    me.stdout.with_mut(|r| r.start_memfd(stdout));
                }
            }
            if let Some(stderr) = spawned.stderr {
                if !spawned.memfds[2] {
                    let _ = bun_sys::set_nonblocking(stderr);
                    me.remaining_fds.set(me.remaining_fds.get() + 1);
                    me.stderr.with_mut(|r| {
                        Self::reset_output_flags(r, stderr);
                        r.start(stderr, true)?;
                        if let Some(poll) = r.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                        }
                        bun_sys::Result::Ok(())
                    })?;
                } else {
                    me.stderr.with_mut(|r| r.start_memfd(stderr));
                }
            }
        }
        #[cfg(windows)]
        {
            // `spawned.{stdout,stderr}` own the `Box<uv::Pipe>`s. Move each
            // into the reader's `source` BEFORE `start_with_current_pipe`
            // (which reads the pipe from `source`) and BEFORE `spawned` drops —
            // otherwise the pipe is freed while libuv still has the handle
            // queued, and the later close callback frees it again.
            if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stdout.take() {
                me.remaining_fds.set(me.remaining_fds.get() + 1);
                me.stdout.with_mut(|r| {
                    r.set_source(bun_io::Source::Pipe(pipe));
                    r.start_with_current_pipe()
                })?;
            }
            if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stderr.take() {
                me.remaining_fds.set(me.remaining_fds.get() + 1);
                me.stderr.with_mut(|r| {
                    r.set_source(bun_io::Source::Pipe(pipe));
                    r.start_with_current_pipe()
                })?;
            }
        }

        let process = spawned.to_process_handle(me.event_loop);
        process.set_exit_handler(this);
        let watch = process.watch_or_reap();
        let exited = process.has_exited();
        let previous = me.process.replace(Some(process));
        debug_assert!(previous.is_none(), "forgot to call `reset_polls`");

        if let Err(err) = watch {
            if !exited {
                if let Some(process) = me.process.take() {
                    process.on_exit(Status::Err(err), &bun_spawn::process::rusage_zeroed());
                    me.process.set(Some(process));
                }
            }
        }

        Ok(())
    }

    pub(crate) fn print_output(&self, manager: &PackageManager) {
        if !manager.options.log_level.is_verbose() {
            let (stdout_len, stderr_cap) = (
                self.stdout
                    .with_mut(|r| (r.final_buffer().len(), r.final_buffer().capacity())),
                self.stderr.with_mut(|r| r.buffer().capacity()),
            );
            // Reuse the memory
            if stdout_len.0 == 0 && stdout_len.1 > 0 && stderr_cap == 0 {
                let buf = self.stdout.with_mut(|r| core::mem::take(r.final_buffer()));
                self.stderr.with_mut(|r| *r.buffer() = buf);
            }

            let stdout_len = self.stdout.with_mut(|r| r.final_buffer().len());
            let stderr_len = self.stderr.with_mut(|r| r.final_buffer().len());

            if stdout_len.saturating_add(stderr_len) == 0 {
                return;
            }

            Output::disable_buffering();
            Output::flush();

            if stdout_len > 0 {
                self.stdout.with_mut(|r| {
                    let stdout = r.final_buffer();
                    let _ = Output::error_writer()
                        .write_fmt(format_args!("{}\n", bstr::BStr::new(stdout.as_slice())));
                    stdout.clear();
                    stdout.shrink_to_fit();
                });
            }

            if stderr_len > 0 {
                self.stderr.with_mut(|r| {
                    let stderr = r.final_buffer();
                    let _ = Output::error_writer()
                        .write_fmt(format_args!("{}\n", bstr::BStr::new(stderr.as_slice())));
                    stderr.clear();
                    stderr.shrink_to_fit();
                });
            }

            Output::enable_buffering();
        }
    }

    /// Runs on the install loop once [`is_finished`](Self::is_finished):
    /// report the result and start the next script if there is one.
    /// Returns `None` while the subprocess has more scripts to run (it was
    /// put back on `manager.active_lifecycle_scripts`), otherwise what the
    /// finish means for the store entry.
    fn handle_exit(
        owned: bun_ptr::OwnedThis<Self>,
        manager: &mut PackageManager,
    ) -> Option<(Option<entry::Id>, EntryEvent)> {
        let this = owned.this_ptr();
        let me = this.get();
        let status = me.exit_status.take().expect("finished");
        me.exit_status.set(Some(status.clone()));
        bun_output::scoped_log!(
            Script,
            "{} - {} finished {}",
            bstr::BStr::new(&me.package_name),
            bstr::BStr::new(me.script_name()),
            status
        );

        if me.has_incremented_alive_count.get() {
            me.has_incremented_alive_count.set(false);
            // .monotonic is okay because because this value is only used by hoisted installs, which
            // only use this type on the main thread.
            let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        }

        match status {
            Status::Exited(exit) => {
                if exit.code > 0 {
                    if me.optional {
                        Self::decrement_pending_script_tasks(manager);
                        me.deinit_and_delete_package(manager);
                        return Some((me.entry_id, EntryEvent::Skipped));
                    }
                    me.print_output(manager);
                    bun_core::pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" exited with {}<r>",
                        bstr::BStr::new(me.script_name()),
                        bstr::BStr::new(&me.package_name),
                        exit.code,
                    );
                    drop(owned);
                    Output::flush();
                    Global::exit(exit.code as u32);
                }

                if !me.foreground
                    && let Some(scripts_node) = manager.scripts_node.as_mut()
                {
                    // .monotonic is okay because because this value is only used by hoisted
                    // installs, which only use this type on the main thread.
                    if manager.finished_installing.load(Ordering::Relaxed) {
                        scripts_node.complete_one();
                    } else {
                        // .monotonic because this is what `complete_one` does. This is the same
                        // as `complete_one` but doesn't update the parent.
                        scripts_node
                            .unprotected_completed_items
                            .fetch_add(1, Ordering::Relaxed);
                    }
                }

                if me.entry_id.is_some() {
                    match me.current_script_index.get() {
                        // preinstall
                        0 => {
                            Self::decrement_pending_script_tasks(manager);
                            return Some((me.entry_id, EntryEvent::PreinstallDone));
                        }
                        _ => {}
                    }
                }

                for new_script_index in
                    (me.current_script_index.get() as usize + 1)..LockfileScripts::NAMES.len()
                {
                    if me.scripts.items[new_script_index].is_some() {
                        me.reset_polls();
                        if let Err(err) = Self::spawn_next_script(
                            this,
                            manager,
                            u8::try_from(new_script_index).expect("int cast"),
                        ) {
                            Output::err_generic(
                                "Failed to run script <b>{}<r> due to error <b>{}<r>",
                                (
                                    bstr::BStr::new(LockfileScripts::NAMES[new_script_index]),
                                    err.name(),
                                ),
                            );
                            Global::exit(1);
                        }
                        manager.active_lifecycle_scripts.push(owned);
                        return None;
                    }
                }

                if PackageManager::verbose_install() {
                    bun_core::pretty_errorln!(
                        "<r><d>[Scripts]<r> Finished scripts for <b>{}<r>",
                        bun_core::fmt::quote(&me.package_name),
                    );
                }

                if bun_core::Environment::CI_ASSERT && me.entry_id.is_some() {
                    debug_assert!(me.current_script_index.get() != 0);
                }

                // the last script finished
                Self::decrement_pending_script_tasks(manager);
                Some((me.entry_id, EntryEvent::Done))
            }
            Status::Signaled(signal) => {
                me.print_output(manager);
                let signal_code = bun_sys::SignalCode::from(signal);

                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" terminated by {}<r>",
                    bstr::BStr::new(me.script_name()),
                    bstr::BStr::new(&me.package_name),
                    signal_code.fmt(Output::enable_ansi_colors_stderr()),
                );

                // `Status::signal_code()` range-checks 1..=31 (`bun_core::SignalCode` is
                // exhaustive); RT signals (>31) fall back to SIGTERM so the diverging
                // `raise_ignoring_panic_handler` path is preserved.
                Global::raise_ignoring_panic_handler(
                    Status::Signaled(signal)
                        .signal_code()
                        .unwrap_or(bun_core::SignalCode::SIGTERM),
                );
            }
            Status::Err(err) => {
                if me.optional {
                    Self::decrement_pending_script_tasks(manager);
                    me.deinit_and_delete_package(manager);
                    return Some((me.entry_id, EntryEvent::Skipped));
                }

                bun_core::pretty_errorln!(
                    "<r><red>error<r>: Failed to run <b>{}<r> script from \"<b>{}<r>\" due to\n{}",
                    bstr::BStr::new(me.script_name()),
                    bstr::BStr::new(&me.package_name),
                    err,
                );
                drop(owned);
                Output::flush();
                Global::exit(1);
            }
            _ => {
                Output::panic(format_args!(
                    "error: Failed to run {} script from \"{}\" due to unexpected status\n{}",
                    bstr::BStr::new(me.script_name()),
                    bstr::BStr::new(&me.package_name),
                    status,
                ));
            }
        }
    }

    pub(crate) fn reset_polls(&self) {
        debug_assert!(self.remaining_fds.get() == 0);

        if let Some(process) = self.process.take() {
            process.close();
        }

        self.stdout.with_mut(|r| {
            r.deinit();
            *r = OutputReader::init::<Self>();
        });
        self.stderr.with_mut(|r| {
            r.deinit();
            *r = OutputReader::init::<Self>();
        });
    }

    pub(crate) fn deinit_and_delete_package(&self, manager: &PackageManager) {
        if manager.options.log_level.is_verbose() {
            bun_core::warn!(
                "deleting optional dependency '{}' due to failed '{}' script",
                bstr::BStr::new(&self.package_name),
                bstr::BStr::new(self.script_name()),
            );
        }
        'try_delete_dir: {
            let Some(dirname) = bun_core::dirname(self.scripts.cwd.as_bytes()) else {
                break 'try_delete_dir;
            };
            let basename = bun_paths::basename(self.scripts.cwd.as_bytes());
            // Close this fd: this path returns to the install loop without
            // exiting, so the HANDLE/fd would otherwise persist for the rest of
            // the install on every failed optional-dependency lifecycle script.
            let Ok(dir) = bun_sys::Dir::open(dirname) else {
                break 'try_delete_dir;
            };
            let _ = dir.delete_tree(basename);
        }
    }

    pub(crate) fn spawn_package_scripts(
        manager: &mut PackageManager,
        list: ScriptsList,
        envp: bun_dotenv::NullDelimitedEnvMap,
        shell_bin: Option<&ZStr>,
        optional: bool,
        log_level: crate::LogLevel,
        foreground: bool,
        entry_id: Option<entry::Id>,
    ) -> Result<(), crate::Error> {
        let package_name = list.package_name.clone();
        let owned = bun_ptr::OwnedThis::new(LifecycleScriptSubprocess {
            event_loop: EventLoopHandle::from_any(&mut manager.event_loop),
            envp,
            shell_bin: shell_bin.map(|z| bun_core::ZBox::from_bytes(z.as_bytes())),
            package_name,
            scripts: list,
            foreground,
            optional,
            entry_id,
            current_script_index: Cell::new(0),
            remaining_fds: Cell::new(0),
            process: Cell::new(None),
            exit_status: Cell::new(None),
            stdout: JsCell::new(OutputReader::init::<Self>()),
            stderr: JsCell::new(OutputReader::init::<Self>()),
            has_incremented_alive_count: Cell::new(false),
            started_at: Cell::new(0),
        });

        if log_level.is_verbose() {
            bun_core::pretty_errorln!(
                "<d>[Scripts]<r> Starting scripts for <b>\"{}\"<r>",
                bstr::BStr::new(&owned.scripts.package_name),
            );
        }

        Self::increment_pending_script_tasks(manager);

        let first_index = owned.scripts.first_index;
        if let Err(err) = Self::spawn_next_script(owned.this_ptr(), manager, first_index) {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                bstr::BStr::new(LockfileScripts::NAMES[first_index as usize]),
                err.name(),
            );
            Global::exit(1);
        }
        manager.active_lifecycle_scripts.push(owned);

        Ok(())
    }

    fn increment_pending_script_tasks(manager: &PackageManager) {
        // .monotonic is okay because this is just used for progress. Other threads
        // don't rely on side effects of tasks based on this value. (And in the case
        // of hoisted installs it's single-threaded.)
        let _ = manager
            .pending_lifecycle_script_tasks
            .fetch_add(1, Ordering::Relaxed);
    }

    fn decrement_pending_script_tasks(manager: &PackageManager) {
        // .monotonic is okay because this is just used for progress (see
        // `increment_pending_script_tasks`).
        let _ = manager
            .pending_lifecycle_script_tasks
            .fetch_sub(1, Ordering::Relaxed);
    }
}

impl PackageManager {
    /// Finish every lifecycle script whose process has exited: print its
    /// output, start its next script, or report the result to `ctx`.
    pub(crate) fn drain_lifecycle_scripts<
        C: crate::package_manager_real::run_tasks::RunTasksCtx + ?Sized,
    >(
        ctx: &mut C,
    ) {
        // `handle_exit` may spawn the next script, and that one can already
        // be finished by the time it returns; keep going until none is.
        loop {
            let manager = ctx.manager();
            let Some(i) = manager
                .active_lifecycle_scripts
                .iter()
                .position(|script| script.is_finished())
            else {
                break;
            };
            let owned = manager.active_lifecycle_scripts.swap_remove(i);
            if let Some((Some(entry_id), event)) =
                LifecycleScriptSubprocess::handle_exit(owned, manager)
            {
                ctx.on_lifecycle_script_event(entry_id, event);
            }
        }
    }
}

impl Drop for LifecycleScriptSubprocess {
    fn drop(&mut self) {
        self.reset_polls();
        if self.has_incremented_alive_count.get() {
            let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    LifecycleScript for LifecycleScriptSubprocess => |this| {
        on_process_exit(_process, status, _rusage) =>
            (*this).on_process_exit(status),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderParent — wires the stdout/stderr OutputReaders back to
// `on_reader_done`/`on_reader_error` via the type-erased vtable.
// ──────────────────────────────────────────────────────────────────────────

// No `on_read_chunk` — output is consumed only in `final_buffer`.
bun_io::impl_buffered_reader_parent! {
    LifecycleScript for LifecycleScriptSubprocess;
    borrow = this;
    has_on_read_chunk = false;
    on_reader_done  = |this| this.get().on_reader_done();
    on_reader_error = |this, err| this.get().on_reader_error(&err);
    loop_           = |this| this.get().event_loop.native_loop();
    event_loop      = |this| this.get().event_loop.as_event_loop_ctx();
}

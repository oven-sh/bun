use core::ffi::c_char;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_core::{Global, Output};
use bun_install::lockfile::{self as Lockfile, Package};
use bun_install::store::{self as Store, Installer};
use bun_install::PackageManager;
use bun_io::heap as io_heap;
use bun_io::BufferedReader;

use bun_spawn::{Process, Rusage, SpawnOptions, Status};
use bun_str::ZStr;
use bun_sys::Fd;
use bun_aio::Loop as AsyncLoop;

bun_output::declare_scope!(Script, visible);

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(b0): bun_runtime::cli::run_command::replacePackageManagerRun → install
// Shared by `bun run` and lifecycle scripts; install must own a copy so it
// does not depend on bun_cli (cycle).
// ──────────────────────────────────────────────────────────────────────────

const BUN_BIN_NAME: &[u8] = if cfg!(debug_assertions) { b"bun-debug" } else { b"bun" };
// `BUN_BIN_NAME ++ " run"` / `" x "` — kept as separate writes below since
// const byte concat is awkward in Rust.

/// Yarn built-in subcommands (union of v1 + v2.3 sets).
/// Port of `src/cli/list-of-yarn-commands.zig::all_yarn_commands` (deduped).
// PERF(port): Zig used `bun.ComptimeStringMap(void, .{...})` (length-bucketed,
// comptime-sorted). The Rust `comptime_string_map!` macro currently returns a
// Lazy with inferred const generics that can't be named in a `static` item, so
// use a sorted slice + binary_search for now. ~50 entries → <7 comparisons.
struct YarnCommands;
static YARN_COMMANDS: YarnCommands = YarnCommands;
impl YarnCommands {
    // Must stay byte-lexically sorted for binary_search.
    const SORTED: &'static [&'static [u8]] = &[
        b"access", b"add", b"audit", b"autoclean", b"bin", b"cache", b"check", b"config",
        b"create", b"dedupe", b"dlx", b"exec", b"explain", b"generate-lock-entry",
        b"generateLockEntry", b"global", b"help", b"import", b"info", b"init", b"install",
        b"licenses", b"link", b"list", b"login", b"logout", b"node", b"npm", b"outdated",
        b"owner", b"pack", b"patch", b"plugin", b"policies", b"publish", b"rebuild",
        b"remove", b"run", b"set", b"tag", b"team", b"unlink", b"unplug", b"up", b"upgrade",
        b"upgrade-interactive", b"upgradeInteractive", b"version", b"versions", b"why",
        b"workspace", b"workspaces",
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
/// Port of `RunCommand.replacePackageManagerRun` (src/cli/run_command.zig).
pub fn replace_package_manager_run(
    copy_script: &mut Vec<u8>,
    script: &[u8],
) -> Result<(), bun_alloc::AllocError> {
    use bun_str::strings;

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

pub struct LifecycleScriptSubprocess<'a> {
    pub package_name: &'a [u8],

    pub scripts: Package::Scripts::List,
    pub current_script_index: u8,

    pub remaining_fds: i8,
    pub process: Option<std::sync::Arc<Process>>,
    pub stdout: OutputReader,
    pub stderr: OutputReader,
    pub has_called_process_exit: bool,
    pub manager: &'a PackageManager,
    // TODO(port): `[:null]?[*:0]const u8` — null-terminated slice of nullable C strings (envp).
    // No direct ZStr/WStr analogue; using raw repr for FFI passthrough to spawnProcess.
    pub envp: *const *const c_char,
    pub shell_bin: Option<&'a ZStr>,

    pub timer: Option<Timer>,

    pub has_incremented_alive_count: bool,

    pub foreground: bool,
    pub optional: bool,
    pub started_at: u64,

    pub ctx: Option<InstallCtx<'a>>,

    pub heap: io_heap::IntrusiveField<LifecycleScriptSubprocess<'a>>,
}

pub struct InstallCtx<'a> {
    pub entry_id: Store::Entry::Id,
    pub installer: &'a Installer,
}

pub type List<'a> = io_heap::Intrusive<
    LifecycleScriptSubprocess<'a>,
    *mut PackageManager,
    sort_by_started_at,
>;
// TODO(port): Rust type aliases cannot capture a fn item as a generic param like Zig's
// `Intrusive(T, Ctx, sortFn)` does. Phase B: make `Intrusive` take the comparator at
// construction or via a trait, and wire `sort_by_started_at` there.

fn sort_by_started_at(
    _: &PackageManager,
    a: &LifecycleScriptSubprocess<'_>,
    b: &LifecycleScriptSubprocess<'_>,
) -> bool {
    a.started_at < b.started_at
}

pub const MIN_MILLISECONDS_TO_LOG: u64 = 500;

pub static ALIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

pub type OutputReader = BufferedReader;

// TODO(port): `std.time.Timer` — replace with bun_core monotonic timer wrapper in Phase B.
pub type Timer = bun_core::time::Timer;

impl<'a> LifecycleScriptSubprocess<'a> {
    /// `bun.TrivialNew(@This())` — heap-allocate and return a raw pointer; this type is
    /// intrusive (heap field, OutputReader parent backrefs), so it lives behind `*mut Self`.
    pub fn new(init: Self) -> *mut Self {
        Box::into_raw(Box::new(init))
    }

    pub fn loop_(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.manager.event_loop.loop_().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.manager.event_loop.loop_()
        }
    }

    pub fn event_loop(&self) -> &AnyEventLoop {
        &self.manager.event_loop
    }

    pub fn script_name(&self) -> &'static [u8] {
        debug_assert!((self.current_script_index as usize) < Lockfile::Scripts::NAMES.len());
        Lockfile::Scripts::NAMES[self.current_script_index as usize]
    }

    pub fn on_reader_done(&mut self) {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds -= 1;

        self.maybe_finished();
    }

    pub fn on_reader_error(&mut self, err: bun_sys::Error) {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds -= 1;

        Output::pretty_errorln(
            format_args!(
                "<r><red>error<r>: Failed to read <b>{}<r> script output from \"<b>{}<r>\" due to error <b>{} {}<r>",
                bstr::BStr::new(self.script_name()),
                bstr::BStr::new(self.package_name),
                err.errno,
                <&'static str>::from(err.get_errno()),
            ),
        );
        Output::flush();
        self.maybe_finished();
    }

    fn maybe_finished(&mut self) {
        if !self.has_called_process_exit || self.remaining_fds != 0 {
            return;
        }

        let Some(process) = self.process.clone() else { return };

        self.handle_exit(process.status);
    }

    fn reset_output_flags(output: &mut OutputReader, fd: Fd) {
        output.flags.nonblocking = true;
        output.flags.socket = true;
        output.flags.memfd = false;
        output.flags.received_eof = false;
        output.flags.closed_without_reporting = false;

        if cfg!(debug_assertions) {
            // TODO(port): Environment.allow_assert gate — these call into bun_sys and panic on
            // failure; keep behind debug_assertions.
            let flags = bun_sys::get_fcntl_flags(fd)
                .unwrap()
                .expect("Failed to get fcntl flags");
            debug_assert!(flags & bun_sys::O::NONBLOCK != 0);

            let stat = bun_sys::fstat(fd).unwrap().expect("Failed to fstat");
            debug_assert!(bun_sys::posix::S::is_sock(stat.mode));
        }
        let _ = fd;
    }

    fn ensure_not_in_heap(&mut self) {
        if self.heap.child.is_some()
            || self.heap.next.is_some()
            || self.heap.prev.is_some()
            || core::ptr::eq(
                self.manager.active_lifecycle_scripts.root,
                self as *const _,
            )
        {
            // TODO(port): `active_lifecycle_scripts.remove` mutates manager state; `manager` is
            // `&'a PackageManager` (BORROW_PARAM per LIFETIMES.tsv). Phase B: interior mutability
            // on `active_lifecycle_scripts` or reclassify as `&'a mut`.
            self.manager.active_lifecycle_scripts.remove(self);
        }
    }

    /// Used to be called from multiple threads during isolated installs; now single-threaded
    /// TODO: re-evaluate whether some variables still need to be atomic
    pub fn spawn_next_script(&mut self, next_script_index: u8) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_core::analytics::Features::lifecycle_scripts_inc(1);

        if !self.has_incremented_alive_count {
            self.has_incremented_alive_count = true;
            // .monotonic is okay because because this value is only used by hoisted installs, which
            // only use this type on the main thread.
            let _ = ALIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        }

        // errdefer { decrement alive_count; ensure_not_in_heap }
        // PORT NOTE: reshaped for borrowck — scopeguard cannot capture `&mut self` while we use
        // it below, so capture a raw ptr and restore the side effects on the error path.
        let this_ptr: *mut Self = self;
        let guard = scopeguard::guard((), move |_| {
            // SAFETY: `self` outlives this scope; guard runs before fn returns.
            let this = unsafe { &mut *this_ptr };
            if this.has_incremented_alive_count {
                this.has_incremented_alive_count = false;
                // .monotonic is okay because because this value is only used by hoisted installs.
                let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
            }
            this.ensure_not_in_heap();
        });

        let manager = self.manager;
        let original_script = self.scripts.items[next_script_index as usize]
            .as_ref()
            .expect("script present");
        let cwd = &self.scripts.cwd;
        self.stdout.set_parent(self);
        self.stderr.set_parent(self);

        self.ensure_not_in_heap();

        self.current_script_index = next_script_index;
        self.has_called_process_exit = false;

        let mut copy_script: Vec<u8> = Vec::with_capacity(original_script.len() + 1);
        // TODO(b0): replace_package_manager_run arrives from move-in (bun_runtime::cli::run_command → install::lifecycle_script_runner).
        replace_package_manager_run(&mut copy_script, original_script)?;
        copy_script.push(0);

        // SAFETY: we just pushed a NUL byte at copy_script[len-1]; slice [..len-1] is the body.
        let combined_script: &mut ZStr =
            unsafe { ZStr::from_raw_mut(copy_script.as_mut_ptr(), copy_script.len() - 1) };

        if self.foreground && self.manager.options.log_level != PackageManager::Options::LogLevel::Silent {
            Output::command(combined_script.as_bytes());
        } else if let Some(scripts_node) = manager.scripts_node.as_ref() {
            manager.set_node_name(
                scripts_node,
                self.package_name,
                PackageManager::ProgressStrings::SCRIPT_EMOJI,
                true,
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
            bstr::BStr::new(self.package_name),
            bstr::BStr::new(self.script_name()),
            bstr::BStr::new(combined_script.as_bytes())
        );

        // TODO(port): `[_]?[*:0]const u8` argv array with trailing null. Using a fixed array of
        // `Option<*const c_char>` to match the Zig layout passed to spawnProcess via @ptrCast.
        let mut argv: [Option<*const c_char>; 4] =
            if self.shell_bin.is_some() && !cfg!(windows) {
                [
                    Some(self.shell_bin.unwrap().as_ptr() as *const c_char),
                    Some(b"-c\0".as_ptr() as *const c_char),
                    Some(combined_script.as_ptr() as *const c_char),
                    None,
                ]
            } else {
                [
                    Some(bun_core::self_exe_path()?.as_ptr() as *const c_char),
                    Some(b"exec\0".as_ptr() as *const c_char),
                    Some(combined_script.as_ptr() as *const c_char),
                    None,
                ]
            };

        #[cfg(windows)]
        {
            // SAFETY: all-zero is a valid uv::Pipe (POD libuv handle).
            self.stdout.source = bun_io::Source::Pipe(Box::into_raw(Box::new(unsafe {
                core::mem::zeroed::<uv::Pipe>()
            })));
            // SAFETY: all-zero is a valid uv::Pipe.
            self.stderr.source = bun_io::Source::Pipe(Box::into_raw(Box::new(unsafe {
                core::mem::zeroed::<uv::Pipe>()
            })));
        }

        let spawn_options = SpawnOptions {
            stdin: if self.foreground {
                bun_spawn::Stdio::Inherit
            } else {
                bun_spawn::Stdio::Ignore
            },

            stdout: if self.manager.options.log_level == PackageManager::Options::LogLevel::Silent {
                bun_spawn::Stdio::Ignore
            } else if self.manager.options.log_level.is_verbose() || self.foreground {
                bun_spawn::Stdio::Inherit
            } else {
                #[cfg(unix)]
                {
                    bun_spawn::Stdio::Buffer
                }
                #[cfg(not(unix))]
                {
                    bun_spawn::Stdio::BufferPipe(self.stdout.source.as_ref().unwrap().pipe)
                }
            },
            stderr: if self.manager.options.log_level == PackageManager::Options::LogLevel::Silent {
                bun_spawn::Stdio::Ignore
            } else if self.manager.options.log_level.is_verbose() || self.foreground {
                bun_spawn::Stdio::Inherit
            } else {
                #[cfg(unix)]
                {
                    bun_spawn::Stdio::Buffer
                }
                #[cfg(not(unix))]
                {
                    bun_spawn::Stdio::BufferPipe(self.stderr.source.as_ref().unwrap().pipe)
                }
            },
            cwd,

            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                // MOVE_DOWN(b0): bun_jsc::EventLoopHandle → bun_event_loop::EventLoopHandle
                loop_: bun_event_loop::EventLoopHandle::init(&manager.event_loop),
            },

            stream: false,
            ..Default::default()
        };

        self.remaining_fds = 0;
        self.started_at = bun_core::timespec::now(bun_core::timespec::Mode::AllowMockedTime).ns();
        self.manager.active_lifecycle_scripts.insert(self);
        let mut spawned = bun_spawn::spawn_process(
            &spawn_options,
            // SAFETY: argv is a `[?[*:0]const u8; 4]` with trailing null; matches the C layout
            // expected by spawn_process (Zig used @ptrCast here).
            unsafe { &mut *(argv.as_mut_ptr() as *mut _) },
            self.envp,
        )??;
        // TODO(port): Zig was `try (try spawnProcess(...)).unwrap()` — outer `!Maybe(Spawned)`.
        // Modeled here as `Result<bun_sys::Result<Spawned>, _>`, hence `??`. Verify in Phase B.

        #[cfg(unix)]
        {
            if let Some(stdout) = spawned.stdout {
                if !spawned.memfds[1] {
                    self.stdout.set_parent(self);
                    let _ = bun_sys::set_nonblocking(stdout);
                    self.remaining_fds += 1;

                    Self::reset_output_flags(&mut self.stdout, stdout);
                    self.stdout.start(stdout, true)?;
                    if let Some(poll) = self.stdout.handle.get_poll() {
                        poll.flags.insert(bun_aio::PollFlag::Socket);
                    }
                } else {
                    self.stdout.set_parent(self);
                    self.stdout.start_memfd(stdout);
                }
            }
            if let Some(stderr) = spawned.stderr {
                if !spawned.memfds[2] {
                    self.stderr.set_parent(self);
                    let _ = bun_sys::set_nonblocking(stderr);
                    self.remaining_fds += 1;

                    Self::reset_output_flags(&mut self.stderr, stderr);
                    self.stderr.start(stderr, true)?;
                    if let Some(poll) = self.stderr.handle.get_poll() {
                        poll.flags.insert(bun_aio::PollFlag::Socket);
                    }
                } else {
                    self.stderr.set_parent(self);
                    self.stderr.start_memfd(stderr);
                }
            }
        }
        #[cfg(windows)]
        {
            if matches!(spawned.stdout, bun_spawn::Stdio::Buffer { .. }) {
                self.stdout.parent = self;
                self.remaining_fds += 1;
                self.stdout.start_with_current_pipe()?;
            }
            if matches!(spawned.stderr, bun_spawn::Stdio::Buffer { .. }) {
                self.stderr.parent = self;
                self.remaining_fds += 1;
                self.stderr.start_with_current_pipe()?;
            }
        }

        let event_loop = &self.manager.event_loop;
        let process = spawned.to_process(event_loop, false);

        bun_core::assertf!(self.process.is_none(), "forgot to call `resetPolls`");
        self.process = Some(process.clone());
        process.set_exit_handler(self);

        match process.watch_or_reap() {
            bun_sys::Result::Err(err) => {
                if !process.has_exited() {
                    // SAFETY: all-zero is a valid Rusage (#[repr(C)] POD).
                    process.on_exit(
                        Status::Err(err),
                        &unsafe { core::mem::zeroed::<Rusage>() },
                    );
                }
            }
            bun_sys::Result::Ok(_) => {}
        }

        // success path: disarm errdefer
        scopeguard::ScopeGuard::into_inner(guard);
        Ok(())
    }

    pub fn print_output(&mut self) {
        if !self.manager.options.log_level.is_verbose() {
            let stdout = self.stdout.final_buffer();

            // Reuse the memory
            if stdout.is_empty() && stdout.capacity() > 0 && self.stderr.buffer().capacity() == 0 {
                *self.stderr.buffer() = core::mem::take(stdout);
            }

            let stderr = self.stderr.final_buffer();

            if stdout.len().saturating_add(stderr.len()) == 0 {
                return;
            }

            Output::disable_buffering();
            Output::flush();

            if !stdout.is_empty() {
                let _ = Output::error_writer()
                    .write_fmt(format_args!("{}\n", bstr::BStr::new(stdout.as_slice())));
                stdout.clear();
                stdout.shrink_to_fit();
            }

            if !stderr.is_empty() {
                let _ = Output::error_writer()
                    .write_fmt(format_args!("{}\n", bstr::BStr::new(stderr.as_slice())));
                stderr.clear();
                stderr.shrink_to_fit();
            }

            Output::enable_buffering();
        }
    }

    fn handle_exit(&mut self, status: Status) {
        bun_output::scoped_log!(
            Script,
            "{} - {} finished {}",
            bstr::BStr::new(self.package_name),
            bstr::BStr::new(self.script_name()),
            status
        );

        if self.has_incremented_alive_count {
            self.has_incremented_alive_count = false;
            // .monotonic is okay because because this value is only used by hoisted installs, which
            // only use this type on the main thread.
            let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        }

        self.ensure_not_in_heap();

        match status {
            Status::Exited(exit) => {
                let maybe_duration = self.timer.as_mut().map(|t| t.read());

                if exit.code > 0 {
                    if self.optional {
                        if let Some(ctx) = &self.ctx {
                            ctx.installer.store.entries.items_step()[ctx.entry_id.get()]
                                .store(Store::Step::Done, Ordering::Release);
                            ctx.installer
                                .on_task_complete(ctx.entry_id, Store::TaskResult::Skipped);
                        }
                        self.decrement_pending_script_tasks();
                        self.deinit_and_delete_package();
                        return;
                    }
                    self.print_output();
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" exited with {}<r>",
                        bstr::BStr::new(self.script_name()),
                        bstr::BStr::new(self.package_name),
                        exit.code,
                    ));
                    // SAFETY: `self` was created by `Self::new` (Box::into_raw); uniquely owned here.
                    unsafe { Self::destroy(self as *mut Self) };
                    Output::flush();
                    Global::exit(exit.code);
                }

                if !self.foreground && self.manager.scripts_node.is_some() {
                    // .monotonic is okay because because this value is only used by hoisted
                    // installs, which only use this type on the main thread.
                    if self.manager.finished_installing.load(Ordering::Relaxed) {
                        self.manager.scripts_node.as_ref().unwrap().complete_one();
                    } else {
                        // .monotonic because this is what `completeOne` does. This is the same
                        // as `completeOne` but doesn't update the parent.
                        // TODO(port): Zig used `@atomicRmw(usize, &node.unprotected_completed_items, .Add, 1, .monotonic)`.
                        // Model `unprotected_completed_items` as `AtomicUsize` in Phase B.
                        self.manager
                            .scripts_node
                            .as_ref()
                            .unwrap()
                            .unprotected_completed_items
                            .fetch_add(1, Ordering::Relaxed);
                    }
                }

                if let Some(nanos) = maybe_duration {
                    if nanos > MIN_MILLISECONDS_TO_LOG * bun_core::time::NS_PER_MS {
                        self.manager.lifecycle_script_time_log.append_concurrent(
                            // TODO(port): Zig passed `manager.lockfile.allocator`; allocator param
                            // dropped per §Allocators (non-AST crate).
                            PackageManager::LifecycleScriptTimeLogEntry {
                                package_name: self.package_name,
                                script_id: self.current_script_index,
                                duration: nanos,
                            },
                        );
                    }
                }

                if let Some(ctx) = &self.ctx {
                    match self.current_script_index {
                        // preinstall
                        0 => {
                            let previous_step = ctx.installer.store.entries.items_step()
                                [ctx.entry_id.get()]
                            .swap(Store::Step::Binaries, Ordering::Release);
                            debug_assert!(previous_step == Store::Step::RunPreinstall);
                            ctx.installer.start_task(ctx.entry_id);
                            self.decrement_pending_script_tasks();
                            // SAFETY: `self` was created by `Self::new` (Box::into_raw); uniquely owned here.
                            unsafe { Self::destroy(self as *mut Self) };
                            return;
                        }
                        _ => {}
                    }
                }

                for new_script_index in
                    (self.current_script_index as usize + 1)..Lockfile::Scripts::NAMES.len()
                {
                    if self.scripts.items[new_script_index].is_some() {
                        self.reset_polls();
                        if let Err(err) = self
                            .spawn_next_script(u8::try_from(new_script_index).unwrap())
                        {
                            Output::err_generic(format_args!(
                                "Failed to run script <b>{}<r> due to error <b>{}<r>",
                                bstr::BStr::new(Lockfile::Scripts::NAMES[new_script_index]),
                                err.name(),
                            ));
                            Global::exit(1);
                        }
                        return;
                    }
                }

                if PackageManager::verbose_install() {
                    Output::pretty_errorln(format_args!(
                        "<r><d>[Scripts]<r> Finished scripts for <b>{}<r>",
                        bun_core::fmt::quote(self.package_name),
                    ));
                }

                if let Some(ctx) = &self.ctx {
                    let previous_step = ctx.installer.store.entries.items_step()
                        [ctx.entry_id.get()]
                    .swap(Store::Step::Done, Ordering::Release);
                    #[cfg(feature = "ci_assert")]
                    {
                        debug_assert!(self.current_script_index != 0);
                        debug_assert!(
                            previous_step == Store::Step::RunPostInstallAndPrePostPrepare
                        );
                    }
                    let _ = previous_step;
                    ctx.installer
                        .on_task_complete(ctx.entry_id, Store::TaskResult::Success);
                }

                // the last script finished
                self.decrement_pending_script_tasks();
                // SAFETY: `self` was created by `Self::new` (Box::into_raw); uniquely owned here.
                unsafe { Self::destroy(self as *mut Self) };
            }
            Status::Signaled(signal) => {
                self.print_output();
                let signal_code = bun_core::SignalCode::from(signal);

                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" terminated by {}<r>",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(self.package_name),
                    signal_code.fmt(Output::enable_ansi_colors_stderr()),
                ));

                Global::raise_ignoring_panic_handler(signal);
            }
            Status::Err(err) => {
                if self.optional {
                    if let Some(ctx) = &self.ctx {
                        ctx.installer.store.entries.items_step()[ctx.entry_id.get()]
                            .store(Store::Step::Done, Ordering::Release);
                        ctx.installer
                            .on_task_complete(ctx.entry_id, Store::TaskResult::Skipped);
                    }
                    self.decrement_pending_script_tasks();
                    self.deinit_and_delete_package();
                    return;
                }

                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed to run <b>{}<r> script from \"<b>{}<r>\" due to\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(self.package_name),
                    err,
                ));
                // SAFETY: `self` was created by `Self::new` (Box::into_raw); uniquely owned here.
                unsafe { Self::destroy(self as *mut Self) };
                Output::flush();
                Global::exit(1);
            }
            _ => {
                Output::panic(format_args!(
                    "<r><red>error<r>: Failed to run <b>{}<r> script from \"<b>{}<r>\" due to unexpected status\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(self.package_name),
                    status,
                ));
            }
        }
    }

    /// This function may free the *LifecycleScriptSubprocess
    pub fn on_process_exit(&mut self, proc: &Process, _: Status, _: &Rusage) {
        if self
            .process
            .as_deref()
            .map(|p| !core::ptr::eq(p, proc))
            .unwrap_or(true)
        {
            Output::debug_warn(format_args!(
                "<d>[LifecycleScriptSubprocess]<r> onProcessExit called with wrong process"
            ));
            return;
        }
        self.has_called_process_exit = true;
        self.maybe_finished();
    }

    pub fn reset_polls(&mut self) {
        if cfg!(debug_assertions) {
            debug_assert!(self.remaining_fds == 0);
        }

        if let Some(process) = self.process.take() {
            process.close();
            // `process.deref()` in Zig drops one refcount; Arc::drop here.
            drop(process);
        }

        // TODO(port): OutputReader::deinit — if BufferedReader has Drop, the assignment below
        // handles it. Keeping explicit deinit calls to mirror Zig until Phase B confirms.
        self.stdout.deinit();
        self.stderr.deinit();
        self.stdout = OutputReader::init::<Self>();
        self.stderr = OutputReader::init::<Self>();
    }

    /// Consumes and frees a heap-allocated `LifecycleScriptSubprocess` created by [`Self::new`].
    /// Cleanup side effects (`reset_polls`, `ensure_not_in_heap`) run via `Drop`.
    ///
    /// # Safety
    /// `this` must have been produced by `Self::new` (`Box::into_raw`) and not yet destroyed;
    /// the caller must not use any outstanding `&`/`&mut` to `*this` after this returns.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` came from `Box::into_raw` in `Self::new` and is
        // uniquely owned here. Dropping the Box runs `Drop` (reset_polls + ensure_not_in_heap)
        // then frees the allocation (Zig: `this.* = undefined; bun.destroy(this);`).
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn deinit_and_delete_package(&mut self) {
        if self.manager.options.log_level.is_verbose() {
            Output::warn(format_args!(
                "deleting optional dependency '{}' due to failed '{}' script",
                bstr::BStr::new(self.package_name),
                bstr::BStr::new(self.script_name()),
            ));
        }
        'try_delete_dir: {
            let Some(dirname) = bun_paths::dirname(&self.scripts.cwd) else {
                break 'try_delete_dir;
            };
            let basename = bun_paths::basename(&self.scripts.cwd);
            let Ok(dir) = bun_sys::open_dir_absolute(dirname) else {
                break 'try_delete_dir;
            };
            let _ = dir.delete_tree(basename);
        }

        // SAFETY: `self` was created by `Self::new` (Box::into_raw); uniquely owned here.
        unsafe { Self::destroy(self as *mut Self) };
    }

    pub fn spawn_package_scripts(
        manager: &'a PackageManager,
        list: Package::Scripts::List,
        envp: *const *const c_char,
        shell_bin: Option<&'a ZStr>,
        optional: bool,
        log_level: PackageManager::Options::LogLevel,
        foreground: bool,
        ctx: Option<InstallCtx<'a>>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let lifecycle_subprocess = Self::new(LifecycleScriptSubprocess {
            manager,
            envp,
            shell_bin,
            package_name: list.package_name,
            scripts: list,
            foreground,
            optional,
            ctx,
            // defaults:
            current_script_index: 0,
            remaining_fds: 0,
            process: None,
            stdout: OutputReader::init::<Self>(),
            stderr: OutputReader::init::<Self>(),
            has_called_process_exit: false,
            timer: None,
            has_incremented_alive_count: false,
            started_at: 0,
            heap: io_heap::IntrusiveField::default(),
        });
        // SAFETY: `new` returned a freshly boxed non-null ptr; we hold the only reference.
        let lifecycle_subprocess = unsafe { &mut *lifecycle_subprocess };

        if log_level.is_verbose() {
            Output::pretty_errorln(format_args!(
                "<d>[Scripts]<r> Starting scripts for <b>\"{}\"<r>",
                bstr::BStr::new(lifecycle_subprocess.scripts.package_name),
            ));
        }

        lifecycle_subprocess.increment_pending_script_tasks();

        let first_index = lifecycle_subprocess.scripts.first_index;
        if let Err(err) = lifecycle_subprocess.spawn_next_script(first_index) {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                bstr::BStr::new(Lockfile::Scripts::NAMES[first_index as usize]),
                err.name(),
            ));
            Global::exit(1);
        }

        Ok(())
    }

    fn increment_pending_script_tasks(&self) {
        // .monotonic is okay because this is just used for progress. Other threads
        // don't rely on side effects of tasks based on this value. (And in the case
        // of hoisted installs it's single-threaded.)
        let _ = self
            .manager
            .pending_lifecycle_script_tasks
            .fetch_add(1, Ordering::Relaxed);
    }

    fn decrement_pending_script_tasks(&self) {
        // .monotonic is okay because this is just used for progress (see
        // `increment_pending_script_tasks`).
        let _ = self
            .manager
            .pending_lifecycle_script_tasks
            .fetch_sub(1, Ordering::Relaxed);
    }
}

impl Drop for LifecycleScriptSubprocess<'_> {
    fn drop(&mut self) {
        self.reset_polls();
        self.ensure_not_in_heap();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lifecycle_script_runner.zig (605 lines)
//   confidence: medium
//   todos:      12
//   notes:      manager is &'a but mutated (active_lifecycle_scripts, progress, scripts_node) — needs interior mutability; envp/argv FFI repr and Intrusive comparator wiring deferred; self-freeing intrusive type uses Drop + unsafe destroy(*mut Self).
// ──────────────────────────────────────────────────────────────────────────

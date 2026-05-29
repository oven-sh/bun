use core::ffi::{c_char, c_void};
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::PackageManager;
use crate::isolated_install::installer::{CompleteState, Installer, Step};
use crate::isolated_install::store::{EntryColumns, entry};
use crate::lockfile_real::Scripts as LockfileScripts;
use crate::lockfile_real::package::scripts::List as ScriptsList;
use crate::package_manager_real::ProgressStrings;
use crate::package_manager_real::package_manager_lifecycle::LifecycleScriptTimeLogEntry;
use bun_core::{Global, Output};
use bun_event_loop::AnyEventLoop;
use bun_io::BufferedReader;
use bun_io::heap as io_heap;
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};

use bun_core::ZStr;
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{Process, ProcessExit, ProcessExitKind, Rusage, SpawnOptions, Status};
#[cfg(unix)]
use bun_sys::Fd;

bun_output::declare_scope!(Script, visible);

const BUN_BIN_NAME: &[u8] = if cfg!(debug_assertions) {
    b"bun-debug"
} else {
    b"bun"
};
// `BUN_BIN_NAME ++ " run"` / `" x "` — kept as separate writes below since
// const byte concat is awkward in Rust.

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

#[cold]
pub fn replace_package_manager_run(
    copy_script: &mut Vec<u8>,
    script: &[u8],
) -> Result<(), bun_core::Error> {
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

pub struct LifecycleScriptSubprocess<'a> {
    pub package_name: Box<[u8]>,

    pub scripts: ScriptsList,
    pub current_script_index: u8,

    pub remaining_fds: i8,
    /// Zig: `?*Process`. `Process` is intrusively ref-counted (`bun_ptr::ThreadSafeRefCount`),
    /// so it lives behind a raw pointer and is dropped via `process.close(); process.deref()`
    /// in `reset_polls` (mirrors Zig `process.close(); process.deref();`). Null = none.
    pub process: *mut Process,
    pub stdout: OutputReader,
    pub stderr: OutputReader,
    pub has_called_process_exit: bool,
    pub manager: bun_ptr::BackRef<PackageManager>,
    pub envp: bun_dotenv::NullDelimitedEnvMap,
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
    pub entry_id: entry::Id,
    /// Zig: `installer: *Installer`. Raw `*mut` for the same reason as
    /// `LifecycleScriptSubprocess::manager` — `on_task_complete`/`start_task`
    /// mutate Installer state from inside an exit-handler callback.
    pub installer: *mut Installer<'a>,
}

impl<'a> InstallCtx<'a> {
    /// BACKREF accessor — single `unsafe` deref for the set-once `installer`
    /// pointer so call sites in `on_process_exit` are safe.
    ///
    /// SAFETY (encapsulated): `installer` is non-null and outlives every
    /// `LifecycleScriptSubprocess` (the `Installer` owns the script-spawn
    /// loop). Exit-handler callbacks run single-threaded on the main install
    /// loop, so no other `&`/`&mut Installer` overlaps the returned borrow.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn installer_mut(&self) -> &mut Installer<'a> {
        // SAFETY: see fn doc.
        unsafe { &mut *self.installer }
    }
}

#[derive(Default, Clone, Copy)]
pub struct StartedAtCtx;
pub type List<'a> = io_heap::Intrusive<LifecycleScriptSubprocess<'a>, StartedAtCtx>;

impl<'a> io_heap::HeapNode for LifecycleScriptSubprocess<'a> {
    #[inline]
    fn heap(&mut self) -> &mut io_heap::IntrusiveField<Self> {
        &mut self.heap
    }
}

impl<'a> io_heap::HeapContext<LifecycleScriptSubprocess<'a>> for StartedAtCtx {
    #[inline]
    unsafe fn less(
        &self,
        a: *mut LifecycleScriptSubprocess<'a>,
        b: *mut LifecycleScriptSubprocess<'a>,
    ) -> bool {
        // SAFETY: `a`/`b` are live heap nodes owned by the intrusive heap; the
        // heap only calls `less` on nodes it has been handed via `insert`.
        unsafe { (*a).started_at < (*b).started_at }
    }
}

pub(crate) const MIN_MILLISECONDS_TO_LOG: u64 = 500;

pub(crate) static ALIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

impl<'a> LifecycleScriptSubprocess<'a> {
    /// Zig: `LifecycleScriptSubprocess.alive_count` static decl. Returns the
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

// TODO(port): `std.time.Timer` — replace with bun_core monotonic timer wrapper.
pub(crate) type Timer = bun_core::time::Timer;

impl<'a> LifecycleScriptSubprocess<'a> {
    /// `bun.TrivialNew(@This())` — heap-allocate and return a raw pointer; this type is
    /// intrusive (heap field, OutputReader parent backrefs), so it lives behind `*mut Self`.
    pub fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    #[inline]
    fn manager(&self) -> &PackageManager {
        // `manager` is non-null and outlives every subprocess (Zig
        // `*PackageManager` is the singleton install-loop owner).
        self.manager.get()
    }

    /// # Safety
    /// See [`Self::manager`]. Mutable access is sound because Zig's
    /// `*PackageManager` is a non-exclusive pointer; no `&PackageManager`
    /// outlives the brief field accesses below on the install thread.
    #[inline]
    unsafe fn manager_mut(&mut self) -> &mut PackageManager {
        // SAFETY: see fn doc.
        unsafe { self.manager.get_mut() }
    }

    pub fn event_loop(&self) -> &AnyEventLoop<'static> {
        &self.manager().event_loop
    }

    pub fn script_name(&self) -> &'static [u8] {
        debug_assert!((self.current_script_index as usize) < LockfileScripts::NAMES.len());
        LockfileScripts::NAMES[self.current_script_index as usize].as_bytes()
    }

    pub fn on_reader_done(&mut self) {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds -= 1;

        self.maybe_finished();
    }

    pub fn on_reader_error(&mut self, err: &bun_sys::Error) {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds -= 1;

        Output::pretty_errorln(format_args!(
            "<r><red>error<r>: Failed to read <b>{}<r> script output from \"<b>{}<r>\" due to error <b>{} {}<r>",
            bstr::BStr::new(self.script_name()),
            bstr::BStr::new(&self.package_name),
            err.errno,
            <&'static str>::from(err.get_errno()),
        ));
        Output::flush();
        self.maybe_finished();
    }

    fn maybe_finished(&mut self) {
        if !self.has_called_process_exit || self.remaining_fds != 0 {
            return;
        }

        let process = self.process;
        if process.is_null() {
            return;
        }
        // SAFETY: `process` is the live intrusive-refcounted `*mut Process` set in
        // `spawn_next_script`; we hold a strong ref until `reset_polls`.
        let status = unsafe { (*process).status.clone() };
        self.handle_exit(status);
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

            let _stat = bun_sys::fstat(fd).expect("Failed to fstat");
            // TODO(port): `bun.S.ISSOCK(stat.mode)` once bun_sys exposes `S::ISSOCK`.
        }
        let _ = fd;
    }

    /// # Safety
    /// `this` must be a live `*mut Self` (allocation-rooted or derived from a
    /// caller-held `&mut Self`). Only the `manager` and `heap` fields are
    /// touched via raw-pointer projection — no whole-struct `&mut Self` is
    /// materialized — so callers may hold disjoint shared borrows into other
    /// fields across this call (see `spawn_next_script_inner`).
    unsafe fn ensure_not_in_heap(this: *mut Self) {
        // SAFETY: caller contract — `this` is non-null and live.
        unsafe {
            let manager: *mut PackageManager = (*this).manager.as_ptr();
            let heap = core::ptr::addr_of_mut!((*this).heap);
            // SAFETY: `manager` is non-null and outlives every subprocess (see
            // `Self::manager`); the install loop is single-threaded here.
            let active = &mut (*manager).active_lifecycle_scripts;
            if !(*heap).child.is_null()
                || !(*heap).next.is_null()
                || !(*heap).prev.is_null()
                || core::ptr::eq(active.root, this as *const _)
            {
                // SAFETY: `this` was inserted via `insert(this)` with allocation-
                // rooted provenance; the heap holds no other live `&mut` to it here.
                active.remove(this.cast::<LifecycleScriptSubprocess<'static>>());
            }
        }
    }

    /// Used to be called from multiple threads during isolated installs; now single-threaded
    /// TODO: re-evaluate whether some variables still need to be atomic
    ///
    /// # Safety
    /// `this` must have been produced by `Self::new` (`heap::alloc`) and be uniquely
    /// accessed by the caller for the duration of this call. The pointer is stored as a
    /// long-lived backref (reader `parent`, intrusive-heap node, process exit handler),
    /// so it must carry allocation-rooted provenance — passing a `*mut Self` coerced
    /// from a transient `&mut Self` reborrow would leave dead Stacked Borrows tags once
    /// the caller resumes using that borrow.
    pub unsafe fn spawn_next_script(
        this: *mut Self,
        next_script_index: u8,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_core::analytics::Features::LIFECYCLE_SCRIPTS.fetch_add(1, Ordering::Relaxed);

        // SAFETY: `this` is non-null and uniquely accessed (caller contract).
        unsafe {
            if !(*this).has_incremented_alive_count {
                (*this).has_incremented_alive_count = true;
                // .monotonic is okay because because this value is only used by hoisted installs, which
                // only use this type on the main thread.
                let _ = ALIVE_COUNT.fetch_add(1, Ordering::Relaxed);
            }
        }

        // errdefer { decrement alive_count; ensure_not_in_heap }
        // PORT NOTE: Zig's `errdefer` is modeled by splitting the fallible body into
        // `spawn_next_script_inner` and running the cleanup on the error branch. Both
        // functions take the allocation-rooted `*mut Self` (mirroring Zig's
        // `*LifecycleScriptSubprocess` receiver) so that backrefs stored into the
        // readers / intrusive heap / process exit handler retain valid Stacked Borrows
        // provenance after we return — deriving them from a `&mut self` reborrow would
        // leave dead tags once that borrow is popped by subsequent `self` uses, and the
        // synchronous `process.on_exit` dispatch below would alias a second `&mut Self`.
        // SAFETY: `this` is non-null and uniquely accessed (caller contract).
        let result = unsafe { Self::spawn_next_script_inner(this, next_script_index) };
        if result.is_err() {
            // SAFETY: as above.
            unsafe {
                if (*this).has_incremented_alive_count {
                    (*this).has_incremented_alive_count = false;
                    // .monotonic is okay because because this value is only used by hoisted installs.
                    let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
                }
                Self::ensure_not_in_heap(this);
            }
        }
        result
    }

    /// # Safety
    /// See [`Self::spawn_next_script`]. `this` is dereferenced for disjoint field
    /// access only — no whole-struct `&mut Self` is held across any call that may
    /// reenter via the stored exit-handler backref.
    unsafe fn spawn_next_script_inner(
        this: *mut Self,
        next_script_index: u8,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: `this` is non-null and uniquely accessed (caller contract).
        // Body wrapped in one block; per-field accesses do not materialize a
        // whole-struct `&mut Self` across reentrant calls.
        unsafe {
            let manager: *mut PackageManager = (*this).manager.as_ptr();
            let original_script = (*this).scripts.items[next_script_index as usize]
                .as_ref()
                .expect("script present");
            let cwd = (*this).scripts.cwd.as_bytes();
            (*this).stdout.set_parent(this.cast::<c_void>());
            (*this).stderr.set_parent(this.cast::<c_void>());

            // Raw-ptr receiver: touches only `heap`/`manager`, so the shared
            // borrows `original_script`/`cwd` (into `(*this).scripts`) survive.
            Self::ensure_not_in_heap(this);

            (*this).current_script_index = next_script_index;
            (*this).has_called_process_exit = false;

            let mut copy_script: Vec<u8> = Vec::with_capacity(original_script.len() + 1);
            replace_package_manager_run(&mut copy_script, original_script)?;
            copy_script.push(0);

            // SAFETY: we just pushed a NUL byte at copy_script[len-1]; slice [..len-1] is the body.
            let combined_script: &mut ZStr =
                ZStr::from_raw_mut(copy_script.as_mut_ptr(), copy_script.len() - 1);

            if (*this).foreground && (*manager).options.log_level != crate::LogLevel::Silent {
                Output::command(Output::CommandArgv::Single(combined_script.as_bytes()));
            } else if let Some(scripts_node) = (*manager).scripts_node_mut() {
                (*manager).set_node_name::<true>(
                    scripts_node,
                    &(*this).package_name,
                    ProgressStrings::SCRIPT_EMOJI.as_bytes(),
                );
                // .monotonic is okay because because this value is only used by hoisted installs, which
                // only use this type on the main thread.
                if (*manager).finished_installing.load(Ordering::Relaxed) {
                    scripts_node.activate();
                    (*manager).progress.refresh();
                }
            }

            bun_output::scoped_log!(
                Script,
                "{} - {} $ {}",
                bstr::BStr::new(&(*this).package_name),
                bstr::BStr::new((*this).script_name()),
                bstr::BStr::new(combined_script.as_bytes())
            );

            let mut argv: [*const c_char; 4] = if (*this).shell_bin.is_some() && !cfg!(windows) {
                [
                    (*this).shell_bin.unwrap().as_ptr().cast::<c_char>(),
                    c"-c".as_ptr(),
                    combined_script.as_ptr().cast::<c_char>(),
                    core::ptr::null(),
                ]
            } else {
                [
                    bun_core::self_exe_path()?.as_ptr().cast::<c_char>(),
                    c"exec".as_ptr(),
                    combined_script.as_ptr().cast::<c_char>(),
                    core::ptr::null(),
                ]
            };
            const _: () = assert!(
                core::mem::size_of::<[*const c_char; 4]>() == 4 * core::mem::size_of::<usize>()
            );

            let spawn_options = SpawnOptions {
                stdin: if (*this).foreground {
                    bun_spawn::Stdio::Inherit
                } else {
                    bun_spawn::Stdio::Ignore
                },

                stdout: if (*manager).options.log_level == crate::LogLevel::Silent {
                    bun_spawn::Stdio::Ignore
                } else if (*manager).options.log_level.is_verbose() || (*this).foreground {
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
                stderr: if (*manager).options.log_level == crate::LogLevel::Silent {
                    bun_spawn::Stdio::Ignore
                } else if (*manager).options.log_level.is_verbose() || (*this).foreground {
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
                    loop_: bun_event_loop::EventLoopHandle::from_any(&mut (*manager).event_loop),
                    ..Default::default()
                },

                stream: false,
                ..Default::default()
            };

            (*this).remaining_fds = 0;
            (*this).started_at =
                bun_core::Timespec::now(bun_core::TimespecMockMode::AllowMockedTime).ns();
            // Store the allocation-rooted `this` in the intrusive heap — not a `&mut self`
            // reborrow, whose SB tag would be invalidated by the field accesses below.
            (*manager)
                .active_lifecycle_scripts
                .insert(this.cast::<LifecycleScriptSubprocess<'static>>());
            let spawned = match bun_spawn::spawn_process(
                &spawn_options,
                // argv is `[*const c_char; 4]` with trailing null — exactly the
                // `[*:null]?[*:0]const u8` layout `spawn_process` expects (1 word/elt).
                argv.as_mut_ptr().cast(),
                (*this).envp.as_ptr().cast::<*const c_char>(),
            ) {
                Ok(Ok(s)) => s,
                res => {
                    // TODO(port): Zig was `try (try spawnProcess(...)).unwrap()` — outer
                    // `!Maybe(Spawned)`. Modeled here as `Result<bun_sys::Result<Spawned>, _>`.
                    #[cfg(windows)]
                    {
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
                        (*this).stdout.set_parent(this.cast::<c_void>());
                        let _ = bun_sys::set_nonblocking(stdout);
                        (*this).remaining_fds += 1;

                        Self::reset_output_flags(&mut (*this).stdout, stdout);
                        (*this).stdout.start(stdout, true)?;
                        if let Some(poll) = (*this).stdout.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                        }
                    } else {
                        (*this).stdout.set_parent(this.cast::<c_void>());
                        (*this).stdout.start_memfd(stdout);
                    }
                }
                if let Some(stderr) = spawned.stderr {
                    if !spawned.memfds[2] {
                        (*this).stderr.set_parent(this.cast::<c_void>());
                        let _ = bun_sys::set_nonblocking(stderr);
                        (*this).remaining_fds += 1;

                        Self::reset_output_flags(&mut (*this).stderr, stderr);
                        (*this).stderr.start(stderr, true)?;
                        if let Some(poll) = (*this).stderr.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                        }
                    } else {
                        (*this).stderr.set_parent(this.cast::<c_void>());
                        (*this).stderr.start_memfd(stderr);
                    }
                }
            }
            #[cfg(windows)]
            {
                if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stdout.take() {
                    (*this).stdout.source = Some(bun_io::Source::Pipe(pipe));
                    (*this).stdout.set_parent(this.cast::<c_void>());
                    (*this).remaining_fds += 1;
                    (*this).stdout.start_with_current_pipe()?;
                }
                if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stderr.take() {
                    (*this).stderr.source = Some(bun_io::Source::Pipe(pipe));
                    (*this).stderr.set_parent(this.cast::<c_void>());
                    (*this).remaining_fds += 1;
                    (*this).stderr.start_with_current_pipe()?;
                }
            }

            let event_loop = bun_event_loop::EventLoopHandle::from_any(&mut (*manager).event_loop);
            // `to_process` returns an intrusively-refcounted `*mut Process` (heap::alloc,
            // refcount = 1); the strong ref transfers to `(*this).process` and is released
            // in `reset_polls` via `process.deref()`.
            let process: *mut Process = spawned.to_process(event_loop, false);

            debug_assert!((*this).process.is_null(), "forgot to call `resetPolls`");
            (*this).process = process;
            // SAFETY: `this` is the allocation-rooted `LifecycleScriptSubprocess`;
            // we hold no live `&mut Self` here, so the synchronous `on_exit`
            // dispatch below may reenter `on_process_exit` through it without
            // aliasing. It outlives `process`.
            (*process).set_exit_handler(ProcessExit::new(ProcessExitKind::LifecycleScript, this));

            if let Err(err) = (*process).watch_or_reap() {
                if !(*process).has_exited() {
                    // SAFETY: all-zero is a valid Rusage (#[repr(C)] POD).
                    (*process).on_exit(Status::Err(err), &bun_core::ffi::zeroed::<Rusage>());
                }
            }

            Ok(())
        } // unsafe
    }

    pub fn print_output(&mut self) {
        if !self.manager().options.log_level.is_verbose() {
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

            Output::disable_buffering();
            Output::flush();

            if stdout_len > 0 {
                let stdout = self.stdout.final_buffer();
                let _ = Output::error_writer()
                    .write_fmt(format_args!("{}\n", bstr::BStr::new(stdout.as_slice())));
                stdout.clear();
                stdout.shrink_to_fit();
            }

            if stderr_len > 0 {
                let stderr = self.stderr.final_buffer();
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
            bstr::BStr::new(&self.package_name),
            bstr::BStr::new(self.script_name()),
            status
        );

        if self.has_incremented_alive_count {
            self.has_incremented_alive_count = false;
            // .monotonic is okay because because this value is only used by hoisted installs, which
            // only use this type on the main thread.
            let _ = ALIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        }

        // SAFETY: `self` is live; the raw-ptr receiver touches only disjoint
        // fields (`heap`/`manager`) — see `ensure_not_in_heap` doc.
        unsafe { Self::ensure_not_in_heap(std::ptr::from_mut::<Self>(self)) };

        match status {
            Status::Exited(exit) => {
                let maybe_duration = self.timer.as_mut().map(|t| t.read());

                if exit.code > 0 {
                    if self.optional {
                        if let Some(ctx) = &self.ctx {
                            let installer = ctx.installer_mut();
                            installer.store.entries.items_step()[ctx.entry_id.get() as usize]
                                .store(Step::Done as u32, Ordering::Release);
                            installer.on_task_complete(ctx.entry_id, CompleteState::Skipped);
                        }
                        self.decrement_pending_script_tasks();
                        self.deinit_and_delete_package();
                        return;
                    }
                    self.print_output();
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" exited with {}<r>",
                        bstr::BStr::new(self.script_name()),
                        bstr::BStr::new(&self.package_name),
                        exit.code,
                    ));
                    // SAFETY: `self` was created by `Self::new` (heap::alloc); uniquely owned here.
                    unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
                    Output::flush();
                    Global::exit(exit.code as u32);
                }

                if !self.foreground
                    && let Some(scripts_node) = self.manager().scripts_node_mut()
                {
                    // .monotonic is okay because because this value is only used by hoisted
                    // installs, which only use this type on the main thread.
                    if self.manager().finished_installing.load(Ordering::Relaxed) {
                        scripts_node.complete_one();
                    } else {
                        // Detached-parent path: collapses to `complete_one()` until the real
                        // `std.Progress` port lands.
                        scripts_node.complete_one();
                    }
                }

                if let Some(nanos) = maybe_duration {
                    if nanos > MIN_MILLISECONDS_TO_LOG * bun_core::time::NS_PER_MS {
                        let entry = LifecycleScriptTimeLogEntry {
                            package_name: self.package_name.clone(),
                            script_id: self.current_script_index,
                            duration: nanos,
                        };
                        // SAFETY: see [`Self::manager_mut`].
                        unsafe { self.manager_mut() }
                            .lifecycle_script_time_log
                            .append_concurrent(entry);
                    }
                }

                if let Some(ctx) = &self.ctx {
                    match self.current_script_index {
                        // preinstall
                        0 => {
                            let installer = ctx.installer_mut();
                            let previous_step = installer.store.entries.items_step()
                                [ctx.entry_id.get() as usize]
                                .swap(Step::Binaries as u32, Ordering::Release);
                            debug_assert!(previous_step == Step::RunPreinstall as u32);
                            installer.start_task(ctx.entry_id);
                            self.decrement_pending_script_tasks();
                            // SAFETY: `self` was created by `Self::new` (heap::alloc); uniquely owned here.
                            unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
                            return;
                        }
                        _ => {}
                    }
                }

                for new_script_index in
                    (self.current_script_index as usize + 1)..LockfileScripts::NAMES.len()
                {
                    if self.scripts.items[new_script_index].is_some() {
                        self.reset_polls();
                        // SAFETY: `self` was created by `Self::new` (heap::alloc) and is
                        // uniquely owned here; we do not touch `self` again on the
                        // success path before `return`, so the stored backrefs derived
                        // from this pointer are not invalidated by a later reborrow.
                        if let Err(err) = unsafe {
                            Self::spawn_next_script(
                                std::ptr::from_mut::<Self>(self),
                                u8::try_from(new_script_index).expect("int cast"),
                            )
                        } {
                            Output::err_generic(
                                "Failed to run script <b>{}<r> due to error <b>{}<r>",
                                (
                                    bstr::BStr::new(LockfileScripts::NAMES[new_script_index]),
                                    err.name(),
                                ),
                            );
                            Global::exit(1);
                        }
                        return;
                    }
                }

                if PackageManager::verbose_install() {
                    Output::pretty_errorln(format_args!(
                        "<r><d>[Scripts]<r> Finished scripts for <b>{}<r>",
                        bun_core::fmt::quote(&self.package_name),
                    ));
                }

                if let Some(ctx) = &self.ctx {
                    let installer = ctx.installer_mut();
                    let previous_step = installer.store.entries.items_step()
                        [ctx.entry_id.get() as usize]
                        .swap(Step::Done as u32, Ordering::Release);
                    if bun_core::Environment::CI_ASSERT {
                        debug_assert!(self.current_script_index != 0);
                        debug_assert!(
                            previous_step == Step::RunPostInstallAndPrePostPrepare as u32
                        );
                    }
                    let _ = previous_step;
                    installer.on_task_complete(ctx.entry_id, CompleteState::Success);
                }

                // the last script finished
                self.decrement_pending_script_tasks();
                // SAFETY: `self` was created by `Self::new` (heap::alloc); uniquely owned here.
                unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
            }
            Status::Signaled(signal) => {
                self.print_output();
                let signal_code = bun_sys::SignalCode::from(signal);

                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> <b>{}<r> script from \"<b>{}<r>\" terminated by {}<r>",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.package_name),
                    signal_code.fmt(Output::enable_ansi_colors_stderr()),
                ));

                Global::raise_ignoring_panic_handler(
                    Status::Signaled(signal)
                        .signal_code()
                        .unwrap_or(bun_core::SignalCode::SIGTERM),
                );
            }
            Status::Err(err) => {
                if self.optional {
                    if let Some(ctx) = &self.ctx {
                        let installer = ctx.installer_mut();
                        installer.store.entries.items_step()[ctx.entry_id.get() as usize]
                            .store(Step::Done as u32, Ordering::Release);
                        installer.on_task_complete(ctx.entry_id, CompleteState::Skipped);
                    }
                    self.decrement_pending_script_tasks();
                    self.deinit_and_delete_package();
                    return;
                }

                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed to run <b>{}<r> script from \"<b>{}<r>\" due to\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.package_name),
                    err,
                ));
                // SAFETY: `self` was created by `Self::new` (heap::alloc); uniquely owned here.
                unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
                Output::flush();
                Global::exit(1);
            }
            _ => {
                Output::panic(format_args!(
                    "<r><red>error<r>: Failed to run <b>{}<r> script from \"<b>{}<r>\" due to unexpected status\n{}",
                    bstr::BStr::new(self.script_name()),
                    bstr::BStr::new(&self.package_name),
                    status,
                ));
            }
        }
    }

    /// This function may free the *LifecycleScriptSubprocess
    pub fn on_process_exit(&mut self, proc: *mut Process, _: Status, _: &Rusage) {
        if self.process != proc {
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

        let process = core::mem::replace(&mut self.process, core::ptr::null_mut());
        if !process.is_null() {
            // SAFETY: `process` is the live intrusive-refcounted pointer set in
            // `spawn_next_script`; we held the only strong ref. `deref()` may free.
            unsafe {
                (*process).close();
                Process::deref(process);
            }
        }

        self.stdout.deinit();
        self.stderr.deinit();
        self.stdout = OutputReader::init::<Self>();
        self.stderr = OutputReader::init::<Self>();
    }

    /// Consumes and frees a heap-allocated `LifecycleScriptSubprocess` created by [`Self::new`].
    /// Cleanup side effects (`reset_polls`, `ensure_not_in_heap`) run via `Drop`.
    ///
    /// # Safety
    /// `this` must have been produced by `Self::new` (`heap::alloc`) and not yet destroyed;
    /// the caller must not use any outstanding `&`/`&mut` to `*this` after this returns.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` came from `heap::alloc` in `Self::new` and is
        // uniquely owned here. Dropping the Box runs `Drop` (reset_polls + ensure_not_in_heap)
        // then frees the allocation (Zig: `this.* = undefined; bun.destroy(this);`).
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn deinit_and_delete_package(&mut self) {
        if self.manager().options.log_level.is_verbose() {
            Output::warn(format_args!(
                "deleting optional dependency '{}' due to failed '{}' script",
                bstr::BStr::new(&self.package_name),
                bstr::BStr::new(self.script_name()),
            ));
        }
        'try_delete_dir: {
            let Some(dirname) = bun_core::dirname(self.scripts.cwd.as_bytes()) else {
                break 'try_delete_dir;
            };
            let basename = bun_paths::basename(self.scripts.cwd.as_bytes());
            let Ok(dir) = bun_sys::Dir::open(dirname) else {
                break 'try_delete_dir;
            };
            let _ = dir.delete_tree(basename);
        }

        // SAFETY: `self` was created by `Self::new` (heap::alloc); uniquely owned here.
        unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
    }

    pub fn spawn_package_scripts(
        manager: &mut PackageManager,
        list: ScriptsList,
        envp: bun_dotenv::NullDelimitedEnvMap,
        shell_bin: Option<&'a ZStr>,
        optional: bool,
        log_level: crate::LogLevel,
        foreground: bool,
        ctx: Option<InstallCtx<'a>>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let package_name = list.package_name.clone();
        let lifecycle_subprocess = Self::new(LifecycleScriptSubprocess {
            manager: bun_ptr::BackRef::new_mut(manager),
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
            process: core::ptr::null_mut(),
            stdout: OutputReader::init::<Self>(),
            stderr: OutputReader::init::<Self>(),
            has_called_process_exit: false,
            timer: None,
            has_incremented_alive_count: false,
            started_at: 0,
            heap: io_heap::IntrusiveField::default(),
        });

        let lss = bun_ptr::ParentRef::<Self>::from(
            core::ptr::NonNull::new(lifecycle_subprocess).expect("Box::into_raw is non-null"),
        );

        if log_level.is_verbose() {
            Output::pretty_errorln(format_args!(
                "<d>[Scripts]<r> Starting scripts for <b>\"{}\"<r>",
                bstr::BStr::new(&lss.scripts.package_name),
            ));
        }

        lss.increment_pending_script_tasks();

        let first_index = lss.scripts.first_index;
        // SAFETY: `lifecycle_subprocess` is the allocation-rooted `heap::alloc` pointer
        // from `Self::new`; passing it gives the stored backrefs stable provenance.
        if let Err(err) = unsafe { Self::spawn_next_script(lifecycle_subprocess, first_index) } {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                bstr::BStr::new(LockfileScripts::NAMES[first_index as usize]),
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
            .manager()
            .pending_lifecycle_script_tasks
            .fetch_add(1, Ordering::Relaxed);
    }

    fn decrement_pending_script_tasks(&self) {
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
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(process, status, rusage),
    }
}

bun_io::impl_buffered_reader_parent! {
    LifecycleScript for LifecycleScriptSubprocess<'a>;
    has_on_read_chunk = false;
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(&err);
    loop_           = |this| (*(*this).manager.as_ptr()).event_loop.native_loop();
    event_loop = |this| bun_event_loop::EventLoopHandle::from_any(
        &mut (*(*this).manager.as_ptr()).event_loop,
    ).as_event_loop_ctx();
}

impl Drop for LifecycleScriptSubprocess<'_> {
    fn drop(&mut self) {
        self.reset_polls();
        // SAFETY: `self` is live for the duration of `drop`; raw-ptr receiver
        // touches only `heap`/`manager` (see `ensure_not_in_heap` doc).
        unsafe { Self::ensure_not_in_heap(std::ptr::from_mut::<Self>(self)) };
    }
}

// ported from: src/install/lifecycle_script_runner.zig

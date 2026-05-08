//! Port of src/shell/builtin/rm.zig

use core::ffi::CStr;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use bun_core::{ZBox, ZStr};
use bun_paths::resolve_path::{self, platform, Platform};
use bun_sys::{dir_iterator, FdExt, E};

use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{shell_openat, EventLoopHandle, Interpreter, NodeId, ShellTask, WorkPoolTask};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

#[derive(Default)]
pub struct Rm {
    pub opts: Opts,
    pub state: RmState,
}

#[derive(Default)]
pub enum RmState {
    #[default]
    Idle,
    ParseOpts {
        idx: u32,
        wait_write_err: bool,
    },
    /// Spec rm.zig `.exec`.
    Exec(ExecState),
    Done { exit_code: ExitCode },
    WaitingWriteErr,
    Err(ExitCode),
}

pub struct ExecState {
    /// Index into argv where filepath args start.
    pub args_start: usize,
    pub total_tasks: usize,
    pub err: Option<bun_sys::Error>,
    pub error_signal: AtomicBool,
    pub output_done: AtomicUsize,
    pub output_count: AtomicUsize,
    pub tasks_done: usize,
    pub started: bool,
}

impl ExecState {
    #[inline]
    fn output_drained(&self) -> bool {
        self.output_done.load(Ordering::SeqCst) >= self.output_count.load(Ordering::SeqCst)
    }
}

#[derive(Clone, Copy)]
pub struct Opts {
    /// `--no-preserve-root` / `--preserve-root` — if false, allow recursive
    /// removal of `/`.
    pub preserve_root: bool,
    /// `-f`, `--force` — ignore nonexistent files and arguments, never prompt.
    pub force: bool,
    /// Configures how the user should be prompted on removal of files.
    pub prompt_behaviour: PromptBehaviour,
    /// `-r`, `-R`, `--recursive`
    pub recursive: bool,
    /// `-v`, `--verbose`
    pub verbose: bool,
    /// `-d`, `--dir` — remove empty directories without `-r`.
    pub remove_empty_dirs: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            preserve_root: true,
            force: false,
            prompt_behaviour: PromptBehaviour::Never,
            recursive: false,
            verbose: false,
            remove_empty_dirs: false,
        }
    }
}

#[derive(Default, Clone, Copy)]
pub enum PromptBehaviour {
    /// `--interactive=never` (default)
    #[default]
    Never,
    /// `-I`, `--interactive=once`
    Once { removed_count: u32 },
    /// `-i`, `--interactive=always`
    Always,
}

enum RmParseFlag {
    ContinueParsing,
    Done,
    IllegalOption,
    IllegalOptionWithFlag,
}

impl Rm {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }

    /// Spec: rm.zig `next`.
    pub fn next(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        loop {
            // PORT NOTE: reshaped for borrowck — read tag, drop borrow, act.
            enum Tag { Idle, ParseOpts(u32, bool), Exec, Done(ExitCode), Err(ExitCode), WaitErr }
            let tag = match &Self::state_mut(interp, cmd).state {
                RmState::Idle => Tag::Idle,
                RmState::ParseOpts { idx, wait_write_err } => {
                    Tag::ParseOpts(*idx, *wait_write_err)
                }
                RmState::Exec(_) => Tag::Exec,
                RmState::Done { exit_code } => Tag::Done(*exit_code),
                RmState::Err(c) => Tag::Err(*c),
                RmState::WaitingWriteErr => Tag::WaitErr,
            };
            match tag {
                Tag::WaitErr => return Yield::suspended(),
                Tag::Idle => {
                    Self::state_mut(interp, cmd).state =
                        RmState::ParseOpts { idx: 0, wait_write_err: false };
                    continue;
                }
                Tag::ParseOpts(idx, wait_write_err) => {
                    if wait_write_err {
                        panic!("Invalid");
                    }
                    let argc = Builtin::of(interp, cmd).args_slice().len();
                    // No args / only flags → print usage and exit 1.
                    if (idx as usize) >= argc {
                        let usage = Kind::Rm.usage_string();
                        return Self::write_err_literal(interp, cmd, idx, usage);
                    }

                    let p = Builtin::of(interp, cmd).args_slice()[idx as usize];
                    // SAFETY: argv entries are NUL-terminated.
                    let arg = unsafe { CStr::from_ptr(p) }.to_bytes().to_vec();
                    match Self::parse_flag(&mut Self::state_mut(interp, cmd).opts, &arg) {
                        RmParseFlag::ContinueParsing => {
                            if let RmState::ParseOpts { idx: i, .. } =
                                &mut Self::state_mut(interp, cmd).state
                            {
                                *i += 1;
                            }
                            continue;
                        }
                        RmParseFlag::Done => {
                            // `-r` implies `-d`.
                            {
                                let opts = &mut Self::state_mut(interp, cmd).opts;
                                if opts.recursive {
                                    opts.remove_empty_dirs = true;
                                }
                            }
                            if !matches!(
                                Self::state_mut(interp, cmd).opts.prompt_behaviour,
                                PromptBehaviour::Never
                            ) {
                                let buf: &[u8] = b"rm: \"-i\" is not supported yet";
                                return Self::write_err_literal(interp, cmd, idx, buf);
                            }

                            let args_start = idx as usize;

                            // Check that none of the paths will delete the root.
                            {
                                let mut buf = bun_paths::PathBuffer::uninit();
                                let cwd = match bun_sys::getcwd_z(&mut buf) {
                                    Ok(c) => c.as_bytes().to_vec(),
                                    Err(err) => {
                                        let msg = err
                                            .msg()
                                            .map(bstr::BStr::new)
                                            .unwrap_or_else(|| bstr::BStr::new(b"failed to get cwd"));
                                        let buf = Builtin::fmt_error_arena(
                                            interp,
                                            cmd,
                                            Some(Kind::Rm),
                                            format_args!("getcwd: {}", msg),
                                        )
                                        .to_vec();
                                        return Self::write_failing_error(interp, cmd, &buf, 1);
                                    }
                                };

                                for i in args_start..argc {
                                    let p = Builtin::of(interp, cmd).args_slice()[i];
                                    // SAFETY: argv entries are NUL-terminated.
                                    let path = unsafe { CStr::from_ptr(p) }.to_bytes();
                                    let resolved: &[u8] =
                                        if Platform::AUTO.is_absolute(path) {
                                            path
                                        } else {
                                            resolve_path::join::<platform::Auto>(&[&cwd, path])
                                        };
                                    let normalized = resolve_path::normalize_string::<false, platform::Auto>(resolved);
                                    let dirname = resolve_path::dirname::<platform::Auto>(normalized);
                                    if dirname.is_empty() {
                                        // PORT NOTE: reshaped for borrowck — copy resolved before
                                        // re-borrowing `interp` mutably.
                                        let resolved_owned = resolved.to_vec();
                                        if let Some(safeguard) =
                                            Builtin::of(interp, cmd).stderr.needs_io()
                                        {
                                            Self::state_mut(interp, cmd).state =
                                                RmState::ParseOpts { idx, wait_write_err: true };
                                            let child = ChildPtr::new(cmd, WriterTag::Builtin);
                                            return Builtin::of_mut(interp, cmd).stderr.enqueue_fmt(
                                                child,
                                                Some(Kind::Rm),
                                                format_args!(
                                                    "\"{}\" may not be removed\n",
                                                    bstr::BStr::new(&resolved_owned)
                                                ),
                                                safeguard,
                                            );
                                        }
                                        let buf = Builtin::fmt_error_arena(
                                            interp,
                                            cmd,
                                            Some(Kind::Rm),
                                            format_args!(
                                                "\"{}\" may not be removed\n",
                                                bstr::BStr::new(&resolved_owned)
                                            ),
                                        )
                                        .to_vec();
                                        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
                                        return Builtin::done(interp, cmd, 1);
                                    }
                                }
                            }

                            let total_tasks = argc - args_start;
                            Self::state_mut(interp, cmd).state = RmState::Exec(ExecState {
                                args_start,
                                total_tasks,
                                err: None,
                                error_signal: AtomicBool::new(false),
                                output_done: AtomicUsize::new(0),
                                output_count: AtomicUsize::new(0),
                                tasks_done: 0,
                                started: false,
                            });
                            continue;
                        }
                        RmParseFlag::IllegalOption => {
                            return Self::write_err_literal(
                                interp,
                                cmd,
                                idx,
                                b"rm: illegal option -- -\n",
                            );
                        }
                        RmParseFlag::IllegalOptionWithFlag => {
                            if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
                                Self::state_mut(interp, cmd).state =
                                    RmState::ParseOpts { idx, wait_write_err: true };
                                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                                return Builtin::of_mut(interp, cmd).stderr.enqueue_fmt(
                                    child,
                                    Some(Kind::Rm),
                                    format_args!(
                                        "illegal option -- {}\n",
                                        bstr::BStr::new(&arg[1..])
                                    ),
                                    safeguard,
                                );
                            }
                            let buf = Builtin::fmt_error_arena(
                                interp,
                                cmd,
                                Some(Kind::Rm),
                                format_args!(
                                    "illegal option -- {}\n",
                                    bstr::BStr::new(&arg[1..])
                                ),
                            )
                            .to_vec();
                            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
                            return Builtin::done(interp, cmd, 1);
                        }
                    }
                }
                Tag::Exec => {
                    let started = match &Self::state_mut(interp, cmd).state {
                        RmState::Exec(e) => e.started,
                        _ => unreachable!(),
                    };
                    if !started {
                        let cwd = Builtin::cwd(interp, cmd);
                        let evtloop = Builtin::event_loop(interp, cmd);
                        let opts = Self::state_mut(interp, cmd).opts;
                        let interp_ptr: *mut Interpreter = interp;
                        let (args_start, argc) = {
                            let me = Self::state_mut(interp, cmd);
                            let RmState::Exec(e) = &mut me.state else { unreachable!() };
                            e.started = true;
                            (e.args_start, e.args_start + e.total_tasks)
                        };
                        let (sig, out_count): (*const AtomicBool, *const AtomicUsize) =
                            match &Self::state_mut(interp, cmd).state {
                                RmState::Exec(e) => {
                                    (&raw const e.error_signal, &raw const e.output_count)
                                }
                                _ => unreachable!(),
                            };
                        for i in args_start..argc {
                            let p = Builtin::of(interp, cmd).args_slice()[i];
                            // SAFETY: argv entries are NUL-terminated.
                            let root = unsafe { CStr::from_ptr(p) }.to_bytes();
                            let is_absolute = Platform::AUTO.is_absolute(root);
                            let task = ShellRmTask::create(
                                cmd, opts, root, cwd, sig, out_count, is_absolute, evtloop,
                                interp_ptr,
                            );
                            // SAFETY: freshly heap-allocated.
                            unsafe { ShellRmTask::schedule(task) };
                        }
                    }
                    return Yield::suspended();
                }
                Tag::Done(code) => return Builtin::done(interp, cmd, code),
                Tag::Err(code) => return Builtin::done(interp, cmd, code),
            }
        }
    }

    fn write_err_literal(
        interp: &mut Interpreter,
        cmd: NodeId,
        idx: u32,
        buf: &[u8],
    ) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state =
                RmState::ParseOpts { idx, wait_write_err: true };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, 1)
    }

    /// Spec: rm.zig `writeFailingError`.
    fn write_failing_error(
        interp: &mut Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = RmState::WaitingWriteErr;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, exit_code)
    }

    /// Spec: rm.zig `onIOWriterChunk`.
    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        let outcome: Option<ExitCode> = match &mut Self::state_mut(interp, cmd).state {
            RmState::Exec(exec) => {
                exec.output_done.fetch_add(1, Ordering::SeqCst);
                if exec.tasks_done >= exec.total_tasks && exec.output_drained() {
                    Some(if exec.err.is_some() { 1 } else { 0 })
                } else {
                    None
                }
            }
            state => {
                if let Some(err) = &e {
                    let code = err.get_errno() as ExitCode;
                    *state = RmState::Err(code);
                    Some(code)
                } else {
                    Some(1)
                }
            }
        };
        if let Some(err) = e {
            err.deref();
        }
        match outcome {
            Some(code) => Builtin::done(interp, cmd, code),
            None => Yield::suspended(),
        }
    }

    /// Spec: rm.zig `onShellRmTaskDone`.
    pub fn on_shell_rm_task_done(
        interp: &mut Interpreter,
        cmd: NodeId,
        task: *mut ShellRmTask,
    ) {
        // In verbose mode the root DirTask may also be queued for write_verbose;
        // both callbacks hold a pending count and the last one to run frees the
        // ShellRmTask.
        // SAFETY: `task` is a live heap-allocated allocation; main thread.
        scopeguard::defer! { unsafe { ShellRmTask::decr_pending_and_maybe_deinit(task) }; }

        // SAFETY: `task` is live; exclusive on main thread until decr above runs.
        let task_err = unsafe { (*task).err.get_mut().take() };
        // PORT NOTE: reshaped for borrowck — format the error string before
        // stashing the error on `exec` (formatting needs &mut interp).
        let errstr: Option<Vec<u8>> = task_err
            .as_ref()
            .map(|e| Builtin::task_error_to_string(interp, cmd, Kind::Rm, e).to_vec());
        let (tasks_done, total) = {
            let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                panic!("Invalid state")
            };
            exec.tasks_done += 1;
            if let Some(e) = task_err {
                // Ownership of err.path stayed with the task (freed in
                // ShellRmTask::deinit); exec.err is only used as a
                // did-anything-fail flag from here, so drop the
                // soon-to-be-dangling path slice from our copy.
                exec.err = Some(e.without_path());
            }
            (exec.tasks_done, exec.total_tasks)
        };

        if let Some(s) = errstr {
            if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
                if let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                    exec.output_count.fetch_add(1, Ordering::SeqCst);
                }
                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(child, &s, safeguard)
                    .run(interp);
                return;
            }
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &s);
        }

        let all_out = match &Self::state_mut(interp, cmd).state {
            RmState::Exec(exec) => exec.output_drained(),
            _ => true,
        };
        if tasks_done >= total && all_out {
            let code = match &Self::state_mut(interp, cmd).state {
                RmState::Exec(exec) => {
                    if exec.err.is_some() { 1 } else { 0 }
                }
                _ => 0,
            };
            Self::state_mut(interp, cmd).state = RmState::Done { exit_code: code };
            Self::next(interp, cmd).run(interp);
        }
    }

    /// Spec: rm.zig `writeVerbose`. Flushes a `DirTask`'s buffered list of
    /// deleted paths to stdout, then frees the DirTask (non-root) and releases
    /// the pending-main-callback count taken in `DirTask::post_run`.
    fn write_verbose(interp: &mut Interpreter, cmd: NodeId, verbose: *mut DirTask) -> Yield {
        // SAFETY: `verbose` is a live DirTask posted via queue_for_write; main
        // thread, exclusive. Take the buffer up-front so the cleanup guard can
        // own the raw pointers without overlapping a borrow.
        let (tm, has_parent, buf) = unsafe {
            (
                (*verbose).task_manager,
                !(*verbose).parent_task.is_null(),
                core::mem::take(&mut (*verbose).deleted_entries),
            )
        };
        let _guard = scopeguard::guard((tm, verbose, has_parent), |(tm, v, hp)| {
            if hp {
                // SAFETY: non-root DirTask is its own Box; reclaim.
                unsafe { DirTask::deinit(v) };
            }
            // SAFETY: pending count was bumped in post_run before queue_for_write.
            unsafe { ShellRmTask::decr_pending_and_maybe_deinit(tm) };
        });

        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        let done = match &mut Self::state_mut(interp, cmd).state {
            RmState::Exec(exec) => {
                exec.output_done.fetch_add(1, Ordering::SeqCst);
                exec.tasks_done >= exec.total_tasks && exec.output_drained()
            }
            _ => false,
        };
        if done {
            let code = match &Self::state_mut(interp, cmd).state {
                RmState::Exec(exec) => if exec.err.is_some() { 1 } else { 0 },
                _ => 0,
            };
            return Builtin::done(interp, cmd, code);
        }
        Yield::done()
    }

    /// Spec: rm.zig `parseFlag`.
    fn parse_flag(opts: &mut Opts, flag: &[u8]) -> RmParseFlag {
        if flag.is_empty() || flag[0] != b'-' {
            return RmParseFlag::Done;
        }
        if flag.len() > 2 && flag[1] == b'-' {
            return match flag {
                b"--preserve-root" => {
                    opts.preserve_root = true;
                    RmParseFlag::ContinueParsing
                }
                b"--no-preserve-root" => {
                    opts.preserve_root = false;
                    RmParseFlag::ContinueParsing
                }
                b"--recursive" => {
                    opts.recursive = true;
                    RmParseFlag::ContinueParsing
                }
                b"--verbose" => {
                    opts.verbose = true;
                    RmParseFlag::ContinueParsing
                }
                b"--dir" => {
                    opts.remove_empty_dirs = true;
                    RmParseFlag::ContinueParsing
                }
                b"--interactive=never" => {
                    opts.prompt_behaviour = PromptBehaviour::Never;
                    RmParseFlag::ContinueParsing
                }
                b"--interactive=once" => {
                    opts.prompt_behaviour = PromptBehaviour::Once { removed_count: 0 };
                    RmParseFlag::ContinueParsing
                }
                b"--interactive=always" => {
                    opts.prompt_behaviour = PromptBehaviour::Always;
                    RmParseFlag::ContinueParsing
                }
                _ => RmParseFlag::IllegalOption,
            };
        }
        for &ch in &flag[1..] {
            match ch {
                b'f' => {
                    opts.force = true;
                    opts.prompt_behaviour = PromptBehaviour::Never;
                }
                b'r' | b'R' => opts.recursive = true,
                b'v' => opts.verbose = true,
                b'd' => opts.remove_empty_dirs = true,
                b'i' => opts.prompt_behaviour = PromptBehaviour::Once { removed_count: 0 },
                b'I' => opts.prompt_behaviour = PromptBehaviour::Always,
                _ => return RmParseFlag::IllegalOptionWithFlag,
            }
        }
        RmParseFlag::ContinueParsing
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Rm {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Rm(r) => &mut **r,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ShellRmTask — per-filepath-arg recursive delete tree
// ──────────────────────────────────────────────────────────────────────────

/// On Windows we allow posix path separators, but `path.join` uses the
/// platform separator: `foo/bar` + `baz` → `foo/bar\baz`. Detect which path
/// separator the user is using and prefer that. If both are used, pick the
/// first one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JoinStyle {
    Posix,
    Windows,
}

impl JoinStyle {
    fn from_path(p: &[u8]) -> JoinStyle {
        if cfg!(unix) {
            return JoinStyle::Posix;
        }
        let backslash = p.iter().position(|&c| c == b'\\').unwrap_or(usize::MAX);
        let forwardslash = p.iter().position(|&c| c == b'/').unwrap_or(usize::MAX);
        if forwardslash <= backslash { JoinStyle::Posix } else { JoinStyle::Windows }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EntryKindHint {
    Idk,
    Dir,
    File,
}

/// Spec: rm.zig `ShellRmTask`. One per filepath argument; owns the root
/// [`DirTask`] and tracks the cross-thread error state.
pub struct ShellRmTask {
    pub cmd: NodeId,
    pub opts: Opts,
    pub cwd: bun_sys::Fd,
    /// Windows only: resolved absolute path of `cwd` (heap-owned).
    #[cfg(windows)]
    pub cwd_path: Option<ZBox>,
    /// PORT NOTE: in Zig the root DirTask is an inline field. Here it lives in
    /// its own `heap::alloc`'d allocation so that `&ShellRmTask` (held as
    /// the `&self` receiver throughout `remove_entry*`) never overlaps the
    /// `&mut DirTask` borrows those methods take on the root — embedding it
    /// would make every `verbose_deleted` call on the root UB under Stacked
    /// Borrows. Freed in `Drop`.
    pub root_task: *mut DirTask,
    pub root_path: ZBox,
    pub root_is_absolute: bool,
    pub error_signal: *const AtomicBool,
    /// Backref into `Rm::ExecState.output_count` so [`verbose_deleted`] can
    /// bump it from worker threads (Zig: `this.rm.state.exec.incrementOutputCount`).
    output_count: *const AtomicUsize,
    /// Main-thread callbacks that must complete before this task can be freed:
    /// always one for `on_shell_rm_task_done` (via `finish_concurrently`), plus
    /// one per DirTask whose verbose output was queued. Decremented by
    /// [`decr_pending_and_maybe_deinit`].
    pub pending_main_callbacks: AtomicU32,
    /// First error hit by any worker thread. Mutex-wrapped so [`handle_err`]
    /// can take `&self` without an interior `&mut` cast.
    pub err: parking_lot::Mutex<Option<bun_sys::Error>>,
    pub join_style: JoinStyle,
    pub event_loop: EventLoopHandle,
    pub task: ShellTask,
}

/// Spec: rm.zig `ShellRmTask.DirTask`. One per directory in the recursive
/// walk; root and children alike are heap-allocated (see PORT NOTE on
/// [`ShellRmTask::root_task`]).
pub struct DirTask {
    pub task_manager: *mut ShellRmTask,
    pub parent_task: *mut DirTask,
    pub path: ZBox,
    pub is_absolute: bool,
    pub subtask_count: AtomicUsize,
    pub need_to_wait: AtomicBool,
    pub deleting_after_waiting_for_children: AtomicBool,
    pub kind_hint: EntryKindHint,
    pub deleted_entries: Vec<u8>,
    /// Intrusive node for the verbose-write bounce-back to the main thread.
    pub concurrent_task: bun_event_loop::EventLoopTask,
    /// Intrusive node for the thread-pool dispatch.
    pub work_task: WorkPoolTask,
}

// SAFETY: raw-pointer fields are only dereferenced on the threads that own
// them (worker pool / main thread); the surrounding atomics + `err` mutex
// provide the necessary synchronisation.
unsafe impl Send for ShellRmTask {}
unsafe impl Send for DirTask {}

impl ShellRmTask {
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        cmd: NodeId,
        opts: Opts,
        root_path: &[u8],
        cwd: bun_sys::Fd,
        error_signal: *const AtomicBool,
        output_count: *const AtomicUsize,
        is_absolute: bool,
        evtloop: EventLoopHandle,
        interp: *mut Interpreter,
    ) -> *mut ShellRmTask {
        let root_path_z = ZBox::from_bytes(root_path);
        let join_style = JoinStyle::from_path(root_path);
        // Separate allocation — see PORT NOTE on `root_task`.
        let root_task = bun_core::heap::into_raw(Box::new(DirTask {
            // task_manager is fixed up below once we have the ShellRmTask address.
            task_manager: core::ptr::null_mut(),
            parent_task: core::ptr::null_mut(),
            path: ZBox::from_bytes(root_path),
            is_absolute: false,
            subtask_count: AtomicUsize::new(1),
            need_to_wait: AtomicBool::new(false),
            deleting_after_waiting_for_children: AtomicBool::new(false),
            kind_hint: EntryKindHint::Idk,
            deleted_entries: Vec::new(),
            concurrent_task: bun_event_loop::EventLoopTask::from_event_loop(evtloop),
            work_task: WorkPoolTask {
                node: Default::default(),
                callback: DirTask::work_pool_callback,
            },
        }));
        let mut boxed = Box::new(ShellRmTask {
            cmd,
            opts,
            cwd,
            #[cfg(windows)]
            cwd_path: None,
            root_task,
            root_path: root_path_z,
            root_is_absolute: is_absolute,
            error_signal,
            output_count,
            pending_main_callbacks: AtomicU32::new(1),
            err: parking_lot::Mutex::new(None),
            join_style,
            event_loop: evtloop,
            task: ShellTask::new(evtloop),
        });
        boxed.task.interp = interp;
        let raw = bun_core::heap::into_raw(boxed);
        // SAFETY: both freshly leaked; exclusive.
        unsafe { (*root_task).task_manager = raw };
        raw
    }

    /// Spec: rm.zig `schedule` — `WorkPool.schedule(&this.task)`. Unlike most
    /// shell builtins this does NOT use the generic [`ShellTask::schedule`]
    /// trampoline (which auto-enqueues back to main on return): the recursive
    /// DirTask tree owns the bounce-back via [`finish_concurrently`].
    ///
    /// # Safety
    /// `this` must be a fresh `heap::alloc`'d task (see [`create`]).
    pub unsafe fn schedule(this: *mut ShellRmTask) {
        use bun_threading::work_pool::WorkPool;
        // SAFETY: `this` is live; `task` is the embedded `ShellTask`. Stay on
        // raw pointers — once `WorkPool::schedule` returns the worker thread
        // may already be running.
        unsafe {
            let st = &raw mut (*this).task;
            (*st).task.callback = Self::work_pool_callback;
            (*st).keep_alive.ref_((*st).event_loop.as_event_loop_ctx());
            WorkPool::schedule(&raw mut (*st).task);
        }
    }

    /// Spec: rm.zig `workPoolCallback` — recover `*ShellRmTask` from the
    /// intrusive `*WorkPoolTask` and run the root DirTask.
    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `task` is the first `#[repr(C)]` field of `ShellTask`, which
        // is embedded in `ShellRmTask` at `TASK_OFFSET` (Zig: `@fieldParentPtr`).
        let this = unsafe {
            task.cast::<u8>()
                .sub(<Self as crate::shell::interpreter::ShellTaskCtx>::TASK_OFFSET).cast::<ShellRmTask>()
        };
        // SAFETY: `this` is a live heap-allocated task; the worker thread has
        // exclusive access to `root_task` until it spawns subtasks.
        unsafe { DirTask::run_from_thread_pool_impl((*this).root_task) };
    }

    /// Spec: rm.zig `finishConcurrently` — post this task to the main-thread
    /// concurrent queue; routed by `dispatch.rs` → [`run_from_main_thread`].
    ///
    /// # Safety
    /// `this` is the live `heap::alloc`'d task; not touched again on this
    /// thread after return (unless a verbose pending-count keeps it alive).
    unsafe fn finish_concurrently(this: *mut ShellRmTask) {
        // SAFETY: caller contract.
        unsafe { ShellTask::on_finish::<ShellRmTask>(this) };
    }

    pub fn run_from_main_thread(this: *mut ShellRmTask, interp: &mut Interpreter) {
        // SAFETY: `this` is a live heap-allocated task.
        let cmd = unsafe { (*this).cmd };
        Rm::on_shell_rm_task_done(interp, cmd, this);
    }

    /// Spec: rm.zig `decrPendingAndMaybeDeinit`.
    ///
    /// # Safety
    /// `this` is a live `heap::alloc`'d task; main thread.
    pub unsafe fn decr_pending_and_maybe_deinit(this: *mut ShellRmTask) {
        // SAFETY: caller contract.
        if unsafe { (*this).pending_main_callbacks.fetch_sub(1, Ordering::SeqCst) } == 1 {
            // SAFETY: paired with `heap::alloc` in `create`.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    #[inline]
    fn error_signal(&self) -> &AtomicBool {
        // SAFETY: `error_signal` points into the boxed `Rm` ExecState which
        // outlives every in-flight ShellRmTask.
        unsafe { &*self.error_signal }
    }

    /// Spec: rm.zig `enqueue` — joins `path` onto `parent_dir.path` and spawns
    /// a child DirTask.
    fn enqueue(
        &self,
        parent_dir: *mut DirTask,
        path: &[u8],
        is_absolute: bool,
        kind_hint: EntryKindHint,
    ) {
        if self.error_signal().load(Ordering::SeqCst) {
            return;
        }
        // SAFETY: `parent_dir` is live for the duration of its run_from_thread_pool_impl.
        let parent_path = unsafe { (*parent_dir).path.as_bytes() };
        let new_path = self.join(&[parent_path, path], is_absolute);
        self.enqueue_no_join(parent_dir, new_path, kind_hint);
    }

    /// Spec: rm.zig `enqueueNoJoin`. Takes ownership of `path`.
    fn enqueue_no_join(&self, parent: *mut DirTask, path: ZBox, kind_hint: EntryKindHint) {
        if self.error_signal().load(Ordering::SeqCst) {
            return;
        }
        // SAFETY: `parent` is live; reuse its `task_manager` (preserves the
        // original `*mut` provenance from `heap::alloc` rather than deriving
        // a writeable pointer from `&self`).
        let task_manager = unsafe { (*parent).task_manager };
        let subtask = bun_core::heap::into_raw(Box::new(DirTask {
            task_manager,
            parent_task: parent,
            path,
            is_absolute: false,
            subtask_count: AtomicUsize::new(1),
            need_to_wait: AtomicBool::new(false),
            deleting_after_waiting_for_children: AtomicBool::new(false),
            kind_hint,
            deleted_entries: Vec::new(),
            concurrent_task: bun_event_loop::EventLoopTask::from_event_loop(self.event_loop),
            work_task: WorkPoolTask {
                node: Default::default(),
                callback: DirTask::work_pool_callback,
            },
        }));
        // SAFETY: `parent` is live until its subtask_count drains to 0.
        let count = unsafe { (*parent).subtask_count.fetch_add(1, Ordering::Relaxed) };
        debug_assert!(count > 0);
        // SAFETY: freshly heap-allocated.
        unsafe { bun_threading::work_pool::WorkPool::schedule(&raw mut (*subtask).work_task) };
    }

    /// Spec: rm.zig `verboseDeleted`.
    ///
    /// Takes `dir_task` as a raw pointer (not `&mut DirTask`) so callers in
    /// `remove_entry*` — which already hold `&self: &ShellRmTask` and a
    /// `&ZStr` borrowed from `dir_task.path` — never materialise an aliasing
    /// `&mut DirTask`. Only the disjoint `deleted_entries` field is reborrowed
    /// mutably here.
    fn verbose_deleted(&self, dir_task: *mut DirTask, path: &[u8]) -> bun_sys::Maybe<()> {
        if !self.opts.verbose {
            return Ok(());
        }
        // SAFETY: the calling worker thread has exclusive access to
        // `dir_task`'s non-atomic fields; `deleted_entries` is disjoint from
        // every other live borrow (`&self`, `path`).
        let entries = unsafe { &mut (*dir_task).deleted_entries };
        if entries.is_empty() {
            // SAFETY: `output_count` points into the boxed `Rm` ExecState.
            unsafe { (*self.output_count).fetch_add(1, Ordering::SeqCst) };
        }
        entries.extend_from_slice(path);
        entries.push(b'\n');
        Ok(())
    }

    /// Spec: rm.zig `bufJoin` — join into `buf` honoring [`join_style`].
    fn buf_join<'a>(&self, buf: &'a mut bun_paths::PathBuffer, parts: &[&[u8]]) -> &'a ZStr {
        if self.join_style == JoinStyle::Posix {
            resolve_path::join_z_buf::<platform::Posix>(buf.as_mut_slice(), parts)
        } else {
            resolve_path::join_z_buf::<platform::Windows>(buf.as_mut_slice(), parts)
        }
    }

    /// Spec: rm.zig `join` — owned ZBox.
    fn join(&self, parts: &[&[u8]], is_absolute: bool) -> ZBox {
        if !is_absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize.
            // Spec: `std.fs.path.joinZ(alloc, parts)` — concatenate with
            // platform separator, collapsing only adjacent separators.
            let sep = bun_paths::SEP;
            let mut out: Vec<u8> = Vec::new();
            for (i, p) in parts.iter().enumerate() {
                if i == 0 {
                    out.extend_from_slice(p);
                } else {
                    if !matches!(out.last(), Some(&c) if c == sep) {
                        out.push(sep);
                    }
                    let p = if p.first() == Some(&sep) { &p[1..] } else { p };
                    out.extend_from_slice(p);
                }
            }
            return ZBox::from_vec(out);
        }
        ZBox::from_bytes(resolve_path::join::<platform::Auto>(parts))
    }

    /// Spec: rm.zig `errorWithPath`.
    #[inline]
    fn error_with_path(&self, e: bun_sys::Error, path: &[u8]) -> bun_sys::Error {
        e.with_path(path)
    }

    /// Spec: rm.zig `removeEntry`.
    fn remove_entry(&self, dir_task: *mut DirTask, is_absolute: bool) -> bun_sys::Maybe<()> {
        let mut vtable = RemoveFileVTable { task: self, child_of_dir: false };
        let mut buf = bun_paths::PathBuffer::uninit();
        // SAFETY: `dir_task` is live; this thread owns it.
        match unsafe { (*dir_task).kind_hint } {
            EntryKindHint::Idk | EntryKindHint::File => {
                // SAFETY: see above.
                let path = unsafe { (*dir_task).path.as_zstr() };
                self.remove_entry_file(dir_task, path, is_absolute, &mut buf, &mut vtable)
            }
            EntryKindHint::Dir => self.remove_entry_dir(dir_task, is_absolute, &mut buf),
        }
    }

    /// Spec: rm.zig `removeEntryDir`.
    fn remove_entry_dir(
        &self,
        dir_task: *mut DirTask,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        // SAFETY: `dir_task` is live; this thread owns it.
        let path = unsafe { (*dir_task).path.as_zstr() };
        let dirfd = self.cwd;

        // If `-d` is specified without `-r` then we can just use `rmdirat`.
        if self.opts.remove_empty_dirs && !self.opts.recursive {
            let mut state = RemoveFileParent {
                task: self,
                treat_as_dir: true,
                allow_enqueue: false,
                enqueued: false,
            };
            'out_to_iter: while state.treat_as_dir {
                match bun_sys::rmdirat(dirfd, path) {
                    Ok(()) => return Ok(()),
                    Err(e) => match e.get_errno() {
                        E::ENOENT => {
                            if self.opts.force {
                                return self.verbose_deleted(dir_task, path.as_bytes());
                            }
                            return Err(self.error_with_path(e, path.as_bytes()));
                        }
                        E::ENOTDIR => {
                            state.treat_as_dir = false;
                            self.remove_entry_file(dir_task, path, is_absolute, buf, &mut state)?;
                            if !state.treat_as_dir {
                                return Ok(());
                            }
                            break 'out_to_iter;
                        }
                        _ => return Err(self.error_with_path(e, path.as_bytes())),
                    },
                }
            }
        }

        if !self.opts.recursive {
            return Err(bun_sys::Error::from_code(E::EISDIR, bun_sys::Tag::TODO)
                .with_path(path.as_bytes()));
        }

        let flags = bun_sys::O::DIRECTORY | bun_sys::O::RDONLY;
        let fd = match shell_openat(dirfd, path, flags, 0) {
            Ok(fd) => fd,
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.opts.force {
                        return self.verbose_deleted(dir_task, path.as_bytes());
                    }
                    return Err(self.error_with_path(e, path.as_bytes()));
                }
                E::ENOTDIR => {
                    let mut dummy = DummyRemoveFile;
                    return self.remove_entry_file(dir_task, path, is_absolute, buf, &mut dummy);
                }
                _ => return Err(self.error_with_path(e, path.as_bytes())),
            },
        };

        // On posix we can close the fd whenever, but on Windows we need to
        // close it BEFORE we delete.
        let mut close_fd = scopeguard::guard(Some(fd), |fd| {
            if let Some(fd) = fd {
                fd.close();
            }
        });

        if self.error_signal().load(Ordering::SeqCst) {
            return Ok(());
        }

        let mut iterator = dir_iterator::iterate(fd);
        let mut child_vtable = RemoveFileVTable { task: self, child_of_dir: true };

        let mut i: usize = 0;
        loop {
            let current = match iterator.next() {
                Err(e) => return Err(self.error_with_path(e, path.as_bytes())),
                Ok(None) => break,
                Ok(Some(ent)) => ent,
            };
            // TODO this seems bad maybe better to listen to kqueue/epoll event
            if (i & 3) == 0 && self.error_signal().load(Ordering::SeqCst) {
                return Ok(());
            }
            i += 1;
            match current.kind {
                bun_sys::EntryKind::Directory => {
                    self.enqueue(dir_task, current.name.slice_u8(), is_absolute, EntryKindHint::Dir);
                }
                _ => {
                    let name = current.name.slice_u8();
                    // PORT NOTE: reshaped for borrowck — Zig passed both the
                    // joined slice (borrowing `buf`) and `buf` itself to
                    // `removeEntryFile`. Copy the join into an owned ZBox so
                    // `buf` is free to be re-borrowed by the vtable callback.
                    let file_path = {
                        let joined = self.buf_join(buf, &[path.as_bytes(), name]);
                        ZBox::from_bytes(joined.as_bytes())
                    };
                    self.remove_entry_file(
                        dir_task,
                        file_path.as_zstr(),
                        is_absolute,
                        buf,
                        &mut child_vtable,
                    )?;
                }
            }
        }

        // Need to wait for children to finish.
        // SAFETY: `dir_task` is live; only this thread reads `subtask_count`
        // here (children atomically modify it).
        if unsafe { (*dir_task).subtask_count.load(Ordering::SeqCst) } > 1 {
            unsafe { (*dir_task).need_to_wait.store(true, Ordering::SeqCst) };
            return Ok(());
        }

        if self.error_signal().load(Ordering::SeqCst) {
            return Ok(());
        }

        #[cfg(windows)]
        {
            // Close BEFORE deleting on Windows.
            if let Some(f) = close_fd.take() { f.close(); }
        }

        match bun_sys::unlinkat_with_flags(self.cwd, path, bun_sys::AT_REMOVEDIR) {
            Ok(()) => self.verbose_deleted(dir_task, path.as_bytes()),
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.opts.force {
                        return self.verbose_deleted(dir_task, path.as_bytes());
                    }
                    Err(self.error_with_path(e, path.as_bytes()))
                }
                _ => Err(e),
            },
        }
    }

    /// Spec: rm.zig `removeEntryDirAfterChildren`. Returns `Ok(true)` if the
    /// directory was deleted (or force-ignored), `Ok(false)` if a subtask was
    /// enqueued and the caller should not run `post_run` yet.
    fn remove_entry_dir_after_children(&self, dir_task: *mut DirTask) -> bun_sys::Maybe<bool> {
        let dirfd = self.cwd;
        // SAFETY: `dir_task` is live; this thread owns it.
        let (path, is_abs) = unsafe { ((*dir_task).path.as_zstr(), (*dir_task).is_absolute) };
        let mut state = RemoveFileParent {
            task: self,
            treat_as_dir: true,
            allow_enqueue: true,
            enqueued: false,
        };
        loop {
            if state.treat_as_dir {
                match bun_sys::rmdirat(dirfd, path) {
                    Ok(()) => {
                        let _ = self.verbose_deleted(dir_task, path.as_bytes());
                        return Ok(true);
                    }
                    Err(e) => match e.get_errno() {
                        E::ENOENT => {
                            if self.opts.force {
                                let _ = self.verbose_deleted(dir_task, path.as_bytes());
                                return Ok(true);
                            }
                            return Err(self.error_with_path(e, path.as_bytes()));
                        }
                        E::ENOTDIR => {
                            state.treat_as_dir = false;
                            continue;
                        }
                        _ => return Err(self.error_with_path(e, path.as_bytes())),
                    },
                }
            } else {
                let mut buf = bun_paths::PathBuffer::uninit();
                self.remove_entry_file(dir_task, path, is_abs, &mut buf, &mut state)?;
                if state.enqueued {
                    return Ok(false);
                }
                if state.treat_as_dir {
                    continue;
                }
                return Ok(true);
            }
        }
    }

    /// Spec: rm.zig `removeEntryFile`.
    fn remove_entry_file<V: RemoveFileHandler>(
        &self,
        parent_dir_task: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
        vtable: &mut V,
    ) -> bun_sys::Maybe<()> {
        let dirfd = self.cwd;
        match bun_sys::unlinkat_with_flags(dirfd, path, 0) {
            Ok(()) => self.verbose_deleted(parent_dir_task, path.as_bytes()),
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.opts.force {
                        return self.verbose_deleted(parent_dir_task, path.as_bytes());
                    }
                    Err(self.error_with_path(e, path.as_bytes()))
                }
                E::EISDIR => vtable.on_is_dir(parent_dir_task, path, is_absolute, buf),
                // This might happen if the file is actually a directory.
                E::EPERM => {
                    // Non-Linux POSIX systems and Windows return EPERM when
                    // trying to delete a directory, so we need to handle that
                    // case specifically and translate the error.
                    #[cfg(any(
                        target_os = "macos",
                        target_os = "ios",
                        target_os = "freebsd",
                        target_os = "netbsd",
                        target_os = "dragonfly",
                        target_os = "openbsd",
                        target_os = "solaris",
                        target_os = "illumos",
                        windows,
                    ))]
                    {
                        // If we are allowed to delete directories then we can
                        // call `unlink`. If `path` points to a directory, then
                        // it is deleted (if empty) or we handle it as a
                        // directory. If it's actually a file, we get an error
                        // so we don't need to call `stat` to check that.
                        if self.opts.recursive || self.opts.remove_empty_dirs {
                            return match bun_sys::unlinkat_with_flags(
                                self.cwd,
                                path,
                                bun_sys::AT_REMOVEDIR,
                            ) {
                                // it was empty, we saved a syscall
                                Ok(()) => self.verbose_deleted(parent_dir_task, path.as_bytes()),
                                Err(e2) => match e2.get_errno() {
                                    // not empty, process directory as we would normally
                                    E::ENOTEMPTY => vtable
                                        .on_dir_not_empty(parent_dir_task, path, is_absolute, buf),
                                    // actually a file, the error is a permissions error
                                    E::ENOTDIR => Err(self.error_with_path(e, path.as_bytes())),
                                    _ => Err(self.error_with_path(e2, path.as_bytes())),
                                },
                            };
                        }
                        // We don't know if it was an actual permissions error
                        // or it was a directory so we need to try to delete it
                        // as a directory.
                        return vtable.on_is_dir(parent_dir_task, path, is_absolute, buf);
                    }
                    #[allow(unreachable_code)]
                    Err(self.error_with_path(e, path.as_bytes()))
                }
                _ => Err(self.error_with_path(e, path.as_bytes())),
            },
        }
    }

    fn handle_err(&self, err: bun_sys::Error) {
        let mut slot = self.err.lock();
        if slot.is_none() {
            *slot = Some(err);
            self.error_signal().store(true, Ordering::SeqCst);
        }
    }
}

impl Drop for ShellRmTask {
    fn drop(&mut self) {
        // SAFETY: `root_task` was `heap::alloc`'d in `create` and is never
        // freed by `DirTask::deinit` (root has `parent_task == null`).
        drop(unsafe { bun_core::heap::take(self.root_task) });
    }
}

// ── DirTask ────────────────────────────────────────────────────────────────

impl DirTask {
    /// Recover `*mut DirTask` from the intrusive `*WorkPoolTask`.
    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `work_task` is at a fixed offset within DirTask.
        let this = unsafe {
            task.cast::<u8>().sub(core::mem::offset_of!(DirTask, work_task)).cast::<DirTask>()
        };
        // SAFETY: `this` is a live DirTask; this worker thread owns it.
        unsafe { Self::run_from_thread_pool_impl(this) };
    }

    /// Spec: rm.zig `DirTask.runFromThreadPoolImpl`.
    ///
    /// # Safety
    /// `this` is a live DirTask (root or heap child); the calling worker
    /// thread has exclusive access to its non-atomic fields.
    unsafe fn run_from_thread_pool_impl(this: *mut DirTask) {
        // Stay on the raw pointer throughout: `remove_entry` re-derives
        // `&mut *this` internally (via `verbose_deleted` / `remove_entry_dir`)
        // and schedules child DirTasks that concurrently touch our atomics, so
        // holding a long-lived `&mut *this` across that call would alias under
        // Stacked Borrows.
        // SAFETY: caller contract.
        let tm_ptr: *mut ShellRmTask = unsafe { (*this).task_manager };

        // Root, get cwd path on Windows.
        #[cfg(windows)]
        // SAFETY: caller contract.
        if unsafe { (*this).parent_task }.is_null() {
            let mut buf = bun_paths::PathBuffer::uninit();
            // SAFETY: `tm_ptr` is live until pending_main_callbacks hits 0.
            let cwd = unsafe { (*tm_ptr).cwd };
            match bun_sys::get_fd_path(cwd, &mut buf) {
                Ok(p) => {
                    // SAFETY: root runs before any subtasks are spawned, so
                    // this write is unique. Stay on the raw `*mut` from
                    // `heap::alloc` — no `&ShellRmTask` exists yet, so no
                    // shared-read tag is invalidated by the write.
                    unsafe { (*tm_ptr).cwd_path = Some(ZBox::from_bytes(&*p)) };
                }
                Err(err) => {
                    // SAFETY: `tm_ptr` is live.
                    unsafe { (*tm_ptr).handle_err(err) };
                    // SAFETY: caller contract.
                    unsafe { Self::post_run(this) };
                    return;
                }
            }
        }

        // SAFETY: caller contract; exclusive access to `path` / `is_absolute`.
        let is_absolute = unsafe {
            let abs = Platform::AUTO.is_absolute((*this).path.as_bytes());
            (*this).is_absolute = abs;
            abs
        };

        // SAFETY: `task_manager` is live until pending_main_callbacks hits 0.
        // `root_task` lives in a separate allocation, so this borrow does not
        // overlap any DirTask and the field-level `&mut` taken inside
        // `verbose_deleted` cannot pop its tag under Stacked Borrows.
        let tm = unsafe { &*tm_ptr };
        if let Err(err) = tm.remove_entry(this, is_absolute) {
            tm.handle_err(err);
        }

        // SAFETY: caller contract; atomic load is fine even if children are
        // already running.
        if !unsafe { (*this).deleting_after_waiting_for_children.load(Ordering::SeqCst) } {
            // SAFETY: caller contract.
            unsafe { Self::post_run(this) };
        }
    }

    /// Spec: rm.zig `DirTask.postRun`.
    ///
    /// # Safety
    /// `this` is a live DirTask; called from a worker thread that just
    /// finished its body.
    unsafe fn post_run(this: *mut DirTask) {
        // SAFETY: caller contract.
        let me = unsafe { &*this };
        // This is true if the directory has subdirectories that need to be deleted.
        if me.need_to_wait.load(Ordering::SeqCst) {
            return;
        }
        // We have executed all the children of this task.
        if me.subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
            // SAFETY: `task_manager` is live until pending_main_callbacks hits 0.
            let tm = unsafe { &*me.task_manager };
            // If a verbose write will be queued, take a pending count on the
            // ShellRmTask now — before decrementing the parent (children) or
            // calling finish_concurrently (root) — so the main thread can't
            // free it out from under write_verbose.
            let will_queue_verbose = tm.opts.verbose && !me.deleted_entries.is_empty();
            if will_queue_verbose {
                tm.pending_main_callbacks.fetch_add(1, Ordering::SeqCst);
            }

            // If we have a parent and we are the last child, now we can delete the parent.
            if !me.parent_task.is_null() {
                // It's possible that we queued this subdir task and it
                // finished, while the parent was still in `remove_entry_dir`.
                // SAFETY: `parent_task` is live until its subtask_count drains.
                let tasks_left =
                    unsafe { (*me.parent_task).subtask_count.fetch_sub(1, Ordering::SeqCst) };
                let parent_still_in_remove_entry_dir =
                    unsafe { !(*me.parent_task).need_to_wait.load(Ordering::Relaxed) };
                if !parent_still_in_remove_entry_dir && tasks_left == 2 {
                    // SAFETY: parent is live and now exclusively owned by this thread.
                    unsafe { Self::delete_after_waiting_for_children(me.parent_task) };
                }
                if will_queue_verbose {
                    // SAFETY: caller contract.
                    unsafe { Self::queue_for_write(this) };
                } else {
                    // SAFETY: non-root DirTask is its own Box; reclaim.
                    unsafe { Self::deinit(this) };
                }
                return;
            }

            // Root task. After finish_concurrently() the task may be freed at
            // any time unless we hold a pending count, so don't touch
            // `this`/task_manager afterwards unless will_queue_verbose kept it
            // alive.
            // SAFETY: `me.task_manager` is the live ShellRmTask.
            unsafe { ShellRmTask::finish_concurrently(me.task_manager) };
            if will_queue_verbose {
                // SAFETY: caller contract; pending count keeps tm alive.
                unsafe { Self::queue_for_write(this) };
            }
        }
        // Otherwise need to wait.
    }

    /// Spec: rm.zig `DirTask.deleteAfterWaitingForChildren`.
    ///
    /// # Safety
    /// `this` is a live DirTask; called from a worker thread.
    unsafe fn delete_after_waiting_for_children(this: *mut DirTask) {
        // SAFETY: caller contract. Stay on raw `this` —
        // `remove_entry_dir_after_children` reborrows `(*this).deleted_entries`
        // mutably, so a long-lived `&mut *this` here would alias.
        unsafe {
            // `run_from_thread_pool_impl` has a `defer post_run` so set this to skip that.
            (*this).deleting_after_waiting_for_children.store(true, Ordering::SeqCst);
            (*this).need_to_wait.store(false, Ordering::SeqCst);
        }
        let mut do_post_run = true;
        // SAFETY: `task_manager` is live until pending_main_callbacks hits 0;
        // separate allocation from every DirTask.
        let tm = unsafe { &*(*this).task_manager };
        if !tm.error_signal().load(Ordering::SeqCst) {
            match tm.remove_entry_dir_after_children(this) {
                Err(e) => tm.handle_err(e),
                Ok(deleted) => {
                    if !deleted {
                        do_post_run = false;
                    }
                }
            }
        }
        if do_post_run {
            // SAFETY: caller contract.
            unsafe { Self::post_run(this) };
        }
    }

    /// Spec: rm.zig `DirTask.queueForWrite` — post this DirTask to the main
    /// thread for [`Rm::write_verbose`].
    ///
    /// # Safety
    /// `this` is a live DirTask; the pending-main-callback count on the
    /// owning ShellRmTask was bumped before calling.
    unsafe fn queue_for_write(this: *mut DirTask) {
        use bun_event_loop::{ConcurrentTask::AutoDeinit, EventLoopTask, EventLoopTaskPtr};
        // SAFETY: caller contract.
        let me = unsafe { &mut *this };
        if me.deleted_entries.is_empty() {
            // Spec: deinit non-root and bail. The pending count was already
            // taken so release it again. Capture before the decrement —
            // dropping the ShellRmTask drops the root DirTask, so for the root
            // `me` may dangle immediately after.
            let (tm, has_parent) = (me.task_manager, !me.parent_task.is_null());
            if has_parent {
                // SAFETY: non-root DirTask is its own Box.
                unsafe { Self::deinit(this) };
            }
            // SAFETY: `tm` is live (pending count > 0).
            unsafe { ShellRmTask::decr_pending_and_maybe_deinit(tm) };
            return;
        }
        // SAFETY: `task_manager` is live (pending count > 0).
        let event_loop = unsafe { (*me.task_manager).event_loop };
        let task_ptr = match &mut me.concurrent_task {
            EventLoopTask::Js(ct) => {
                ct.from(this, AutoDeinit::ManualDeinit);
                EventLoopTaskPtr { js: std::ptr::from_mut(ct) }
            }
            EventLoopTask::Mini(at) => EventLoopTaskPtr {
                mini: at.from(this, dir_task_run_from_main_thread_mini),
            },
        };
        event_loop.enqueue_task_concurrent(task_ptr);
    }

    /// Spec: rm.zig `DirTask.runFromMainThread` — flush verbose output.
    ///
    /// # Safety
    /// `this` is a live DirTask posted via [`queue_for_write`]; main thread.
    pub unsafe fn run_from_main_thread(this: *mut DirTask) {
        // SAFETY: caller contract.
        let tm = unsafe { (*this).task_manager };
        // SAFETY: pending count keeps `tm` alive; `interp` set at create.
        let (interp, cmd) = unsafe { (&mut *(*tm).task.interp, (*tm).cmd) };
        Rm::write_verbose(interp, cmd, this).run(interp);
    }

    /// Spec: rm.zig `DirTask.deinit`.
    ///
    /// # Safety
    /// `this` is a live heap-allocated (non-root) DirTask; reclaimed once.
    unsafe fn deinit(this: *mut DirTask) {
        debug_assert!(unsafe { !(*this).parent_task.is_null() });
        // The root task is owned by `ShellRmTask` (freed in its `Drop`); only
        // non-root children are reclaimed here.
        // SAFETY: caller contract.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

fn dir_task_run_from_main_thread_mini(this: *mut DirTask, _: *mut ()) {
    // SAFETY: mini-loop dispatch on main thread.
    unsafe { DirTask::run_from_main_thread(this) };
}

// ── RemoveFileHandler — Zig `vtable: anytype` lowered to a trait ───────────

trait RemoveFileHandler {
    fn on_is_dir(
        &mut self,
        parent_dir_task: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()>;
    fn on_dir_not_empty(
        &mut self,
        parent_dir_task: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()>;
}

struct DummyRemoveFile;
impl RemoveFileHandler for DummyRemoveFile {
    fn on_is_dir(&mut self, _: *mut DirTask, _: &ZStr, _: bool, _: &mut bun_paths::PathBuffer) -> bun_sys::Maybe<()> {
        Ok(())
    }
    fn on_dir_not_empty(&mut self, _: *mut DirTask, _: &ZStr, _: bool, _: &mut bun_paths::PathBuffer) -> bun_sys::Maybe<()> {
        Ok(())
    }
}

struct RemoveFileVTable<'a> {
    task: &'a ShellRmTask,
    child_of_dir: bool,
}
impl RemoveFileHandler for RemoveFileVTable<'_> {
    fn on_is_dir(
        &mut self,
        parent: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        if self.child_of_dir {
            self.task
                .enqueue_no_join(parent, ZBox::from_bytes(path.as_bytes()), EntryKindHint::Dir);
            return Ok(());
        }
        self.task.remove_entry_dir(parent, is_absolute, buf)
    }
    fn on_dir_not_empty(
        &mut self,
        parent: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        if self.child_of_dir {
            self.task
                .enqueue_no_join(parent, ZBox::from_bytes(path.as_bytes()), EntryKindHint::Dir);
            return Ok(());
        }
        self.task.remove_entry_dir(parent, is_absolute, buf)
    }
}

struct RemoveFileParent<'a> {
    task: &'a ShellRmTask,
    treat_as_dir: bool,
    allow_enqueue: bool,
    enqueued: bool,
}
impl RemoveFileHandler for RemoveFileParent<'_> {
    fn on_is_dir(&mut self, _: *mut DirTask, _: &ZStr, _: bool, _: &mut bun_paths::PathBuffer) -> bun_sys::Maybe<()> {
        self.treat_as_dir = true;
        Ok(())
    }
    fn on_dir_not_empty(
        &mut self,
        parent: *mut DirTask,
        path: &ZStr,
        _: bool,
        _: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        self.treat_as_dir = true;
        if self.allow_enqueue {
            self.task
                .enqueue_no_join(parent, ZBox::from_bytes(path.as_bytes()), EntryKindHint::Dir);
            self.enqueued = true;
        }
        Ok(())
    }
}

// ── Taskable / ShellTaskCtx glue ──────────────────────────────────────────

impl bun_event_loop::Taskable for ShellRmTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmTask;
}
impl bun_event_loop::Taskable for DirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmDirTask;
}

impl crate::shell::interpreter::ShellTaskCtx for ShellRmTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(_this: *mut Self) {
        // Not reached: `ShellRmTask::schedule` installs `work_pool_callback`
        // directly (rm.zig does NOT use `InnerShellTask` — the generic
        // trampoline auto-posts back, which would race the recursive DirTask
        // tree's own `finish_concurrently`).
        debug_assert!(
            false,
            "ShellRmTask scheduled via ShellTask::schedule; use ShellRmTask::schedule"
        );
    }
    fn run_from_main_thread(this: *mut Self, interp: &mut Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

// ported from: src/shell/builtin/rm.zig

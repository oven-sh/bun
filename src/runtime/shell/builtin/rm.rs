use core::ffi::{CStr, c_char};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use bun_core::{ZBox, ZStr, strings};
use bun_paths::resolve_path::{self, Platform, platform};
use bun_sys::{E, FdExt, dir_iterator};

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, NodeId, ShellTask, WorkPoolTask, shell_openat,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Rm {
    pub(crate) opts: Opts,
    pub(crate) state: RmState,
}

#[derive(Default)]
pub(crate) enum RmState {
    #[default]
    Idle,
    ParseOpts {
        idx: u32,
        wait_write_err: bool,
    },
    Exec(ExecState),
    Done {
        exit_code: ExitCode,
    },
    Err(ExitCode),
}

pub(crate) struct ExecState {
    /// Index into argv where filepath args start.
    pub(crate) args_start: usize,
    pub(crate) err: Option<bun_sys::Error>,
    pub(crate) output_done: AtomicUsize,
    pub(crate) output_count: AtomicUsize,
    /// The [`ShellRmTask`] has removed every operand and has come back.
    pub(crate) walk_done: bool,
    pub(crate) started: bool,
}

impl ExecState {
    #[inline]
    fn output_drained(&self) -> bool {
        self.output_done.load(Ordering::SeqCst) >= self.output_count.load(Ordering::SeqCst)
    }

    /// The exit code, once the task is back and no output chunk is pending.
    fn exit_code_if_done(&self) -> Option<ExitCode> {
        (self.walk_done && self.output_drained()).then_some(ExitCode::from(self.err.is_some()))
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Opts {
    /// `-f`, `--force` — ignore nonexistent files and arguments, never prompt.
    pub(crate) force: bool,
    /// Configures how the user should be prompted on removal of files.
    pub(crate) prompt_behaviour: PromptBehaviour,
    /// `-r`, `-R`, `--recursive`
    pub(crate) recursive: bool,
    /// `-v`, `--verbose`
    pub(crate) verbose: bool,
    /// `-d`, `--dir` — remove empty directories without `-r`.
    pub(crate) remove_empty_dirs: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            force: false,
            prompt_behaviour: PromptBehaviour::Never,
            recursive: false,
            verbose: false,
            remove_empty_dirs: false,
        }
    }
}

#[derive(Default, Clone, Copy)]
pub(crate) enum PromptBehaviour {
    /// `--interactive=never` (default)
    #[default]
    Never,
    /// `-I`, `--interactive=once`
    Once,
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
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }

    fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        loop {
            // Read the tag, drop the borrow, then act.
            enum Tag {
                Idle,
                ParseOpts(u32, bool),
                Exec,
                Done(ExitCode),
                Err(ExitCode),
            }
            let tag = match &Self::state_mut(interp, cmd).state {
                RmState::Idle => Tag::Idle,
                RmState::ParseOpts {
                    idx,
                    wait_write_err,
                } => Tag::ParseOpts(*idx, *wait_write_err),
                RmState::Exec(_) => Tag::Exec,
                RmState::Done { exit_code } => Tag::Done(*exit_code),
                RmState::Err(c) => Tag::Err(*c),
            };
            match tag {
                Tag::Idle => {
                    Self::state_mut(interp, cmd).state = RmState::ParseOpts {
                        idx: 0,
                        wait_write_err: false,
                    };
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

                    let arg = Builtin::of(interp, cmd).arg_bytes(idx as usize).to_vec();
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
                                let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
                                // Operands are unbounded user input, so neither
                                // step may use the fixed-size thread-local
                                // buffers behind `join` / `normalize_string`.
                                // Normalizing never grows a path by more than
                                // one byte.
                                let mut join_spill = Vec::new();
                                let mut normalize_buf = Vec::new();

                                for i in args_start..argc {
                                    let path = Builtin::of(interp, cmd).arg_bytes(i);
                                    let resolved: &[u8] = if Platform::AUTO.is_absolute(path) {
                                        path
                                    } else {
                                        resolve_path::join_spill::<platform::Auto>(
                                            &mut join_spill,
                                            &[&cwd, path],
                                        )
                                    };
                                    if normalize_buf.len() <= resolved.len() {
                                        normalize_buf.resize(resolved.len() + 1, 0);
                                    }
                                    let normalized = resolve_path::normalize_string_buf::<
                                        false,
                                        platform::Auto,
                                        false,
                                    >(
                                        resolved, &mut normalize_buf[..]
                                    );
                                    let dirname =
                                        resolve_path::dirname::<platform::Auto>(normalized);
                                    if dirname.is_empty() {
                                        // Copy resolved before
                                        // re-borrowing `interp` mutably.
                                        let resolved_owned = resolved.to_vec();
                                        if let Some(safeguard) =
                                            Builtin::of(interp, cmd).stderr.needs_io()
                                        {
                                            Self::state_mut(interp, cmd).state =
                                                RmState::ParseOpts {
                                                    idx,
                                                    wait_write_err: true,
                                                };
                                            let child = ChildPtr::new(cmd, WriterTag::Builtin);
                                            return Builtin::of_mut(interp, cmd)
                                                .stderr
                                                .enqueue_fmt(
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
                                        let _ =
                                            Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
                                        return Builtin::done(interp, cmd, 1);
                                    }
                                }
                            }

                            Self::state_mut(interp, cmd).state = RmState::Exec(ExecState {
                                args_start,
                                err: None,
                                output_done: AtomicUsize::new(0),
                                output_count: AtomicUsize::new(0),
                                walk_done: false,
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
                                Self::state_mut(interp, cmd).state = RmState::ParseOpts {
                                    idx,
                                    wait_write_err: true,
                                };
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
                                format_args!("illegal option -- {}\n", bstr::BStr::new(&arg[1..])),
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
                        let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                        let (args_start, out_count) = {
                            let me = Self::state_mut(interp, cmd);
                            let RmState::Exec(e) = &mut me.state else {
                                unreachable!()
                            };
                            e.started = true;
                            (e.args_start, bun_ptr::BackRef::new(&e.output_count))
                        };
                        // One task takes every operand, in the order given.
                        let operands = bun_ptr::RawSlice::new(
                            &Builtin::of(interp, cmd).args_slice()[args_start..],
                        );
                        let task = ShellRmTask::create(
                            cmd, opts, operands, cwd, out_count, evtloop, interp_ptr,
                        );
                        // SAFETY: freshly heap-allocated.
                        unsafe { ShellRmTask::schedule(task) };
                    }
                    return Yield::suspended();
                }
                Tag::Done(code) => return Builtin::done(interp, cmd, code),
                Tag::Err(code) => return Builtin::done(interp, cmd, code),
            }
        }
    }

    fn write_err_literal(interp: &Interpreter, cmd: NodeId, idx: u32, buf: &[u8]) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = RmState::ParseOpts {
                idx,
                wait_write_err: true,
            };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, 1)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        let outcome: Option<ExitCode> = match &mut Self::state_mut(interp, cmd).state {
            RmState::Exec(exec) => {
                exec.output_done.fetch_add(1, Ordering::SeqCst);
                exec.exit_code_if_done()
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
        drop(e);
        match outcome {
            Some(code) => Builtin::done(interp, cmd, code),
            None => Yield::suspended(),
        }
    }

    /// # Safety
    /// `task` must be a live `heap::alloc`'d [`ShellRmTask`]; main thread.
    fn on_shell_rm_task_done(interp: &Interpreter, cmd: NodeId, task: *mut ShellRmTask) {
        // A DirTask may also still be queued for write_verbose;
        // both callbacks hold a pending count and the last one to run frees the
        // ShellRmTask.
        // SAFETY: `task` is a live heap-allocated allocation; main thread.
        scopeguard::defer! { unsafe { ShellRmTask::decr_pending_and_maybe_deinit(task) }; }

        let exit_code = {
            let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                panic!("Invalid state")
            };
            exec.walk_done = true;
            exec.exit_code_if_done()
        };
        if let Some(exit_code) = exit_code {
            Self::state_mut(interp, cmd).state = RmState::Done { exit_code };
            Self::next(interp, cmd).run(interp);
        }
    }

    /// Writes an operand's error line; `Some` is its chunk when stderr is an fd.
    fn write_err(interp: &Interpreter, cmd: NodeId, err: &bun_sys::Error) -> Option<Yield> {
        // Formatted before `exec` is borrowed (formatting needs &mut interp).
        let line = Builtin::task_error_to_string(interp, cmd, Kind::Rm, err).to_vec();
        let safeguard = Builtin::of(interp, cmd).stderr.needs_io();
        if let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            // exec.err is only used as a did-anything-fail flag.
            exec.err = Some(err.without_path());
            if safeguard.is_some() {
                exec.output_count.fetch_add(1, Ordering::SeqCst);
            }
        }
        let Some(safeguard) = safeguard else {
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &line);
            return None;
        };
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        Some(
            Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, &line, safeguard),
        )
    }

    /// Writes what a queued `DirTask` brought: its `-v` lines, then its operand's error.
    fn write_verbose(interp: &Interpreter, cmd: NodeId, verbose: *mut DirTask) -> Yield {
        debug_assert!(
            matches!(&Self::state_mut(interp, cmd).state, RmState::Exec(exec) if !exec.walk_done),
            "a DirTask came back after its ShellRmTask"
        );
        // SAFETY: `verbose` is a live DirTask posted via queue_for_write; main
        // thread, exclusive. Take the buffer up-front so the cleanup guard can
        // own the raw pointers without overlapping a borrow.
        let (tm, buf, has_error) = unsafe {
            (
                (*verbose).task_manager,
                core::mem::take(&mut (*verbose).deleted_entries),
                (*verbose).has_error,
            )
        };
        let _guard = scopeguard::guard((tm, verbose), |(tm, v)| {
            // SAFETY: a queued DirTask is its own Box (reclaim); its pending
            // count was bumped before `queue_for_write`.
            unsafe {
                DirTask::deinit(v);
                ShellRmTask::decr_pending_and_maybe_deinit(tm);
            }
        });
        // Roots are queued in operand order, as `errs` is filled: the front error is this root's.
        let err = if has_error {
            // SAFETY: the pending count keeps `tm` live.
            unsafe { (*tm).errs.lock().pop_front() }
        } else {
            None
        };

        let out_chunk = if buf.is_empty() {
            None
        } else if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            Some(
                Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(child, &buf, safeguard),
            )
        } else {
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
            if let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_done.fetch_add(1, Ordering::SeqCst);
            }
            None
        };
        let err_chunk = err
            .as_ref()
            .and_then(|err| Self::write_err(interp, cmd, err));
        match (out_chunk, err_chunk) {
            (Some(out_chunk), Some(err_chunk)) => {
                out_chunk.run(interp);
                err_chunk
            }
            (Some(chunk), None) | (None, Some(chunk)) => chunk,
            (None, None) => Yield::done(),
        }
    }

    fn parse_flag(opts: &mut Opts, flag: &[u8]) -> RmParseFlag {
        if flag.is_empty() || flag[0] != b'-' {
            return RmParseFlag::Done;
        }
        if flag.len() > 2 && flag[1] == b'-' {
            return match flag {
                b"--preserve-root" | b"--no-preserve-root" => RmParseFlag::ContinueParsing,
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
                    opts.prompt_behaviour = PromptBehaviour::Once;
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
                b'i' => opts.prompt_behaviour = PromptBehaviour::Once,
                b'I' => opts.prompt_behaviour = PromptBehaviour::Always,
                _ => return RmParseFlag::IllegalOptionWithFlag,
            }
        }
        RmParseFlag::ContinueParsing
    }

    #[inline]
    fn state_mut(interp: &Interpreter, cmd: NodeId) -> &mut Rm {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Rm(r) => &mut **r,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ShellRmTask: one per command, removes the tree of each filepath arg in turn
// ──────────────────────────────────────────────────────────────────────────

/// On Windows we allow posix path separators, but `path.join` uses the
/// platform separator: `foo/bar` + `baz` → `foo/bar\baz`. Detect which path
/// separator the user is using and prefer that. If both are used, pick the
/// first one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum JoinStyle {
    Posix,
    Windows,
}

impl JoinStyle {
    fn from_path(p: &[u8]) -> JoinStyle {
        if cfg!(unix) {
            return JoinStyle::Posix;
        }
        let backslash = strings::index_of_char_usize(p, b'\\').unwrap_or(usize::MAX);
        let forwardslash = strings::index_of_char_usize(p, b'/').unwrap_or(usize::MAX);
        if forwardslash <= backslash {
            JoinStyle::Posix
        } else {
            JoinStyle::Windows
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKindHint {
    Idk,
    Dir,
}

/// A root takes its `-v` lines to the main thread once it holds this many bytes.
const VERBOSE_FLUSH_BYTES: usize = 4096;

/// One per `rm`: removes the operands one after another, in command-line order.
pub(crate) struct ShellRmTask {
    pub(crate) cmd: NodeId,
    pub(crate) opts: Opts,
    pub(crate) cwd: bun_sys::Fd,
    /// The operands: argv entries of the `Builtin`, which outlives this task's time on the pool.
    operands: bun_ptr::RawSlice<*const c_char>,
    /// Index of the operand being removed; stored only between two operands.
    cursor: AtomicUsize,
    /// The operand being removed has failed; cleared between two operands.
    error_signal: AtomicBool,
    /// Backref into `Rm::ExecState.output_count` so [`verbose_deleted`] can
    /// bump it from worker threads.
    output_count: bun_ptr::BackRef<AtomicUsize>,
    /// Main-thread callbacks that must complete before this task can be freed:
    /// always one for `on_shell_rm_task_done` (via `finish_concurrently`), plus
    /// one per DirTask queued for `write_verbose`. Decremented by
    /// [`decr_pending_and_maybe_deinit`].
    pub(crate) pending_main_callbacks: AtomicU32,
    /// The first error of each failed operand, in operand order, for the main thread.
    pub(crate) errs: bun_threading::Guarded<VecDeque<bun_sys::Error>>,
    pub(crate) event_loop: EventLoopHandle,
    pub task: ShellTask,
}

/// One per directory of the walk, and one per operand as the root of its walk.
pub(crate) struct DirTask {
    pub(crate) task_manager: *mut ShellRmTask,
    pub(crate) parent_task: *mut DirTask,
    /// `None` on a root: its path is the operand ([`DirTask::path`]).
    path: Option<ZBox>,
    pub(crate) is_absolute: bool,
    pub(crate) subtask_count: AtomicUsize,
    pub(crate) need_to_wait: AtomicBool,
    pub(crate) kind_hint: EntryKindHint,
    /// On a queued root: its operand failed, and the front of [`ShellRmTask::errs`] is the error.
    pub(crate) has_error: bool,
    pub(crate) deleted_entries: Vec<u8>,
    /// Intrusive node for the verbose-write bounce-back to the main thread.
    pub(crate) concurrent_task: bun_event_loop::EventLoopTask,
    /// Intrusive node for the thread-pool dispatch.
    pub(crate) work_task: WorkPoolTask,
}

// SAFETY: raw-pointer fields are only dereferenced on the threads that own
// them (worker pool / main thread); the surrounding atomics + `errs` mutex
// provide the necessary synchronisation.
unsafe impl Send for ShellRmTask {}
// SAFETY: `task_manager` / `parent_task` point at heap allocations kept alive
// by the `subtask_count` / `pending_main_callbacks` atomic protocol; non-atomic
// fields are single-owner per the `need_to_wait` handoff (see
// `verbose_deleted`).
unsafe impl Send for DirTask {}

impl ShellRmTask {
    pub(crate) fn create(
        cmd: NodeId,
        opts: Opts,
        operands: bun_ptr::RawSlice<*const c_char>,
        cwd: bun_sys::Fd,
        output_count: bun_ptr::BackRef<AtomicUsize>,
        evtloop: EventLoopHandle,
        interp: *mut Interpreter,
    ) -> *mut ShellRmTask {
        let mut boxed = Box::new(ShellRmTask {
            cmd,
            opts,
            cwd,
            operands,
            cursor: AtomicUsize::new(0),
            error_signal: AtomicBool::new(false),
            output_count,
            pending_main_callbacks: AtomicU32::new(1),
            errs: bun_threading::Guarded::new(VecDeque::new()),
            event_loop: evtloop,
            task: ShellTask::new(evtloop),
        });
        boxed.task.interp = interp;
        bun_core::heap::into_raw(boxed)
    }

    /// Unlike most shell builtins this does NOT use the generic
    /// [`ShellTask::schedule`] trampoline (which auto-enqueues back to main
    /// on return): the recursive
    /// DirTask tree and [`run_operands`] own the bounce-back via [`finish_concurrently`].
    ///
    /// # Safety
    /// `this` must be a fresh `heap::alloc`'d task (see [`create`]).
    pub(crate) unsafe fn schedule(this: *mut ShellRmTask) {
        use bun_threading::work_pool::WorkPool;
        // SAFETY: `this` is live; `task` is the embedded `ShellTask`. Stay on
        // raw pointers — once `WorkPool::schedule` returns the worker thread
        // may already be running.
        unsafe {
            let st = &raw mut (*this).task;
            (*st).task.callback = Self::work_pool_callback;
            (*st).keep_alive.ref_((*st).event_loop.as_event_loop_ctx());
            (*st).arm();
            WorkPool::schedule(&raw mut (*st).task);
        }
    }

    /// Recover `*ShellRmTask` from the intrusive `*WorkPoolTask` and run the
    /// operands.
    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `task` is the first `#[repr(C)]` field of `ShellTask`, which
        // is embedded in `ShellRmTask` at `TASK_OFFSET`. `this` is a live
        // heap-allocated task that no other thread has yet.
        unsafe {
            let this = <Self as crate::shell::interpreter::ShellTaskCtx>::from_work_task(task);
            Self::run_operands(this, None);
        }
    }

    /// Removes the operands in order; `finished` is the root of the operand that just ended.
    unsafe fn run_operands(this: *mut ShellRmTask, mut finished: Option<Box<DirTask>>) {
        // SAFETY: `this` is live until `finish_concurrently`. One thread at a
        // time is here: this returns when a root goes to its child tasks, and
        // only the thread that `post_run` gives that root to calls again. Every
        // DirTask of an ended operand has released its count, so no other
        // thread reads `cursor` or `error_signal` between two operands.
        unsafe {
            loop {
                let mut root = None;
                if let Some(mut ended) = finished.take() {
                    let cursor = (*this).cursor.load(Ordering::SeqCst);
                    let is_last = cursor + 1 == (*this).operands.len();
                    let failed = (*this).error_signal.load(Ordering::SeqCst);
                    let lines = ended.deleted_entries.len();
                    if failed || (lines > 0 && (is_last || lines >= VERBOSE_FLUSH_BYTES)) {
                        ended.has_error = failed;
                        (*this)
                            .pending_main_callbacks
                            .fetch_add(1, Ordering::SeqCst);
                        DirTask::queue_for_write(bun_core::heap::into_raw(ended));
                    } else {
                        root = Some(ended);
                    }
                    if is_last {
                        drop(root);
                        Self::finish_concurrently(this);
                        return;
                    }
                    (*this).error_signal.store(false, Ordering::SeqCst);
                    (*this).cursor.store(cursor + 1, Ordering::SeqCst);
                }
                let root = match root {
                    Some(root) => {
                        root.subtask_count.store(1, Ordering::SeqCst);
                        root
                    }
                    None => DirTask::create(
                        this,
                        core::ptr::null_mut(),
                        None,
                        EntryKindHint::Idk,
                        (*this).event_loop,
                    ),
                };
                finished = DirTask::run_from_thread_pool_impl(bun_core::heap::into_raw(root));
                if finished.is_none() {
                    return;
                }
            }
        }
    }

    /// The operand being removed.
    fn operand(&self) -> &ZStr {
        let arg = self.operands[self.cursor.load(Ordering::SeqCst)];
        // SAFETY: a NUL-terminated argv entry; `Rm` is done, and argv freed,
        // only after this task has come back (`ExecState::walk_done`).
        ZStr::from_cstr(unsafe { CStr::from_ptr(arg) })
    }

    /// Queues `-v` lines for the main thread, ahead of the DirTasks that are started after this.
    fn queue_lines(&self, task_manager: *mut ShellRmTask, lines: Vec<u8>) {
        let mut carrier = DirTask::create(
            task_manager,
            core::ptr::null_mut(),
            None,
            EntryKindHint::Idk,
            self.event_loop,
        );
        carrier.deleted_entries = lines;
        self.pending_main_callbacks.fetch_add(1, Ordering::SeqCst);
        // SAFETY: a fresh DirTask, with the pending count taken above.
        unsafe { DirTask::queue_for_write(bun_core::heap::into_raw(carrier)) };
    }

    /// Post this task to the main-thread
    /// concurrent queue; routed by `dispatch.rs` → [`run_from_main_thread`].
    ///
    /// # Safety
    /// `this` is the live `heap::alloc`'d task; not touched again on this
    /// thread after return (unless a verbose pending-count keeps it alive).
    unsafe fn finish_concurrently(this: *mut ShellRmTask) {
        // SAFETY: caller contract.
        unsafe { ShellTask::on_finish::<ShellRmTask>(this) };
    }

    /// # Safety
    /// `this` must be a live `heap::alloc`'d [`ShellRmTask`] posted via
    /// [`finish_concurrently`]; main thread.
    fn run_from_main_thread(this: *mut ShellRmTask, interp: &Interpreter) {
        // SAFETY: caller contract.
        unsafe {
            let cmd = (*this).cmd;
            Rm::on_shell_rm_task_done(interp, cmd, this);
        }
    }

    /// # Safety
    /// `this` is a live `heap::alloc`'d task; main thread.
    pub(crate) unsafe fn decr_pending_and_maybe_deinit(this: *mut ShellRmTask) {
        // SAFETY: caller contract; paired with `heap::alloc` in `create`.
        unsafe {
            if (*this)
                .pending_main_callbacks
                .fetch_sub(1, Ordering::SeqCst)
                == 1
            {
                drop(bun_core::heap::take(this));
            }
        }
    }

    /// Joins `path` onto `parent_dir.path` and spawns
    /// a child DirTask.
    fn enqueue(
        &self,
        parent_dir: *mut DirTask,
        path: &[u8],
        is_absolute: bool,
        kind_hint: EntryKindHint,
    ) {
        if self.error_signal.load(Ordering::SeqCst) {
            return;
        }
        // SAFETY: `parent_dir` is live for the duration of its run_from_thread_pool_impl.
        let parent_path = unsafe { DirTask::path(parent_dir) }.as_bytes();
        let new_path = self.join(&[parent_path, path], is_absolute);
        self.enqueue_no_join(parent_dir, new_path, kind_hint);
    }

    /// Takes ownership of `path`.
    fn enqueue_no_join(&self, parent: *mut DirTask, path: ZBox, kind_hint: EntryKindHint) {
        if self.error_signal.load(Ordering::SeqCst) {
            return;
        }
        // SAFETY: `parent` is live; reuse its `task_manager` (preserves the
        // original `*mut` provenance from `heap::alloc` rather than deriving
        // a writeable pointer from `&self`).
        let task_manager = unsafe { (*parent).task_manager };
        // SAFETY: the calling thread runs `parent`'s walk, so it owns the
        // non-atomic fields. A child queues its own lines when it is done, so
        // the lines a root holds go first.
        unsafe {
            if (*parent).parent_task.is_null() && !(*parent).deleted_entries.is_empty() {
                let lines = core::mem::take(&mut (*parent).deleted_entries);
                self.queue_lines(task_manager, lines);
            }
        }
        let subtask = bun_core::heap::into_raw(DirTask::create(
            task_manager,
            parent,
            Some(path),
            kind_hint,
            self.event_loop,
        ));
        // SAFETY: `parent` is live until its `subtask_count` drains to 0;
        // `subtask` is freshly heap-allocated.
        unsafe {
            let count = (*parent).subtask_count.fetch_add(1, Ordering::Relaxed);
            debug_assert!(count > 0);
            bun_threading::work_pool::WorkPool::schedule(&raw mut (*subtask).work_task);
        }
    }

    /// Takes `dir_task` as a raw pointer (not `&mut DirTask`) so callers in
    /// `remove_entry*` — which already hold `&self: &ShellRmTask` and a
    /// `&ZStr` borrowed from `dir_task.path` — never materialise an aliasing
    /// `&mut DirTask`. Only the disjoint `deleted_entries` field is reborrowed
    /// mutably here.
    fn verbose_deleted(&self, dir_task: *mut DirTask, path: &[u8]) -> bun_sys::Maybe<()> {
        if !self.opts.verbose {
            return Ok(());
        }
        // SAFETY: a DirTask's non-atomic fields are single-owner-at-a-time.
        // Ownership starts on the worker that runs `remove_entry*` and is
        // handed off via `subtask_count`: the parent's final append here is
        // sequenced-before its `subtask_count.fetch_sub(SeqCst)` in
        // `remove_entry_dir`, and the child taking the counter to 0 in
        // `post_run` acquire-reads from that release sequence before
        // re-entering via `delete_after_waiting_for_children`. That pair
        // makes prior `deleted_entries` writes visible to the new owner, so
        // this `&mut` is exclusive and race-free. The reborrow is also
        // disjoint from every other live borrow (`&self`, `path`).
        let entries = unsafe { &mut (*dir_task).deleted_entries };
        if entries.is_empty() {
            // `output_count` is a `BackRef` into the boxed `Rm` ExecState.
            self.output_count.fetch_add(1, Ordering::SeqCst);
        }
        entries.extend_from_slice(path);
        entries.push(b'\n');
        Ok(())
    }

    /// Join into `buf` honoring `join_style`.
    fn buf_join<'a>(
        join_style: JoinStyle,
        buf: &'a mut bun_paths::PathBuffer,
        spill: &'a mut Vec<u8>,
        parts: &[&[u8]],
    ) -> &'a ZStr {
        if join_style == JoinStyle::Posix {
            resolve_path::join_z_buf_spill::<platform::Posix>(buf.as_mut_slice(), spill, parts)
        } else {
            resolve_path::join_z_buf_spill::<platform::Windows>(buf.as_mut_slice(), spill, parts)
        }
    }

    /// Join to an owned ZBox.
    fn join(&self, parts: &[&[u8]], is_absolute: bool) -> ZBox {
        if !is_absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize.
            // Concatenate with the platform separator, collapsing only
            // adjacent separators. On Windows BOTH `/` and `\` count as
            // separators when deciding whether to insert/strip one.
            #[cfg(windows)]
            let is_sep = |c: u8| c == b'/' || c == b'\\';
            #[cfg(not(windows))]
            let is_sep = |c: u8| c == b'/';
            let mut out: Vec<u8> = Vec::new();
            for (i, p) in parts.iter().enumerate() {
                if i == 0 {
                    out.extend_from_slice(p);
                } else {
                    if !matches!(out.last(), Some(&c) if is_sep(c)) {
                        out.push(bun_paths::SEP);
                    }
                    let p = if matches!(p.first(), Some(&c) if is_sep(c)) {
                        &p[1..]
                    } else {
                        p
                    };
                    out.extend_from_slice(p);
                }
            }
            return ZBox::from_vec(out);
        }
        let mut spill = Vec::new();
        let joined = resolve_path::join_spill::<platform::Auto>(&mut spill, parts);
        ZBox::from_bytes(joined)
    }

    #[inline]
    fn error_with_path(&self, e: &bun_sys::Error, path: &[u8]) -> bun_sys::Error {
        e.with_path(path)
    }

    /// Returns `Ok(true)` when [`remove_entry_dir`] handed `dir_task` off to
    /// a child (its `subtask_count` slot was released without reaching 0).
    /// Once that happens, a child finishing on another thread may run
    /// [`DirTask::delete_after_waiting_for_children`] → `post_run` → `deinit`
    /// (or, for the root, the main thread may free the whole
    /// [`ShellRmTask`]). Callers must therefore treat `dir_task` as
    /// potentially-freed when this returns `Ok(true)`. The bool is threaded
    /// out locally instead of re-reading the atomic so the caller never
    /// dereferences `dir_task` to find out.
    fn remove_entry(&self, dir_task: *mut DirTask, is_absolute: bool) -> bun_sys::Maybe<bool> {
        let mut waiting = false;
        let mut buf = bun_paths::path_buffer_pool::get();
        // SAFETY: `dir_task` is live; this thread owns it. `kind_hint` /
        // `path` are read-only after construction.
        let (kind_hint, path) = unsafe { ((*dir_task).kind_hint, DirTask::path(dir_task)) };
        match kind_hint {
            EntryKindHint::Idk => {
                // POSIX: an operand whose last component is `.` or `..` is refused, not emptied.
                if self.opts.recursive
                    && matches!(bun_paths::basename(path.as_bytes()), b"." | b"..")
                {
                    return Err(bun_sys::Error::from_code(E::EINVAL, bun_sys::Tag::rmdir)
                        .with_path(path.as_bytes()));
                }
                let mut vtable = RemoveFileVTable {
                    task: self,
                    on_dir: OnDir::Recurse {
                        need_to_wait_out: &mut waiting,
                    },
                };
                self.remove_entry_file(dir_task, path, is_absolute, &mut buf, &mut vtable)?;
            }
            EntryKindHint::Dir => {
                self.remove_entry_dir(dir_task, is_absolute, &mut buf, &mut waiting)?;
            }
        }
        Ok(waiting)
    }

    /// `need_to_wait_out` is left `true` only when the hand-off in this
    /// function gave ownership of `dir_task` to a child; see
    /// [`remove_entry`] for why the caller needs this on its own stack
    /// rather than reading it back from `dir_task`.
    fn remove_entry_dir(
        &self,
        dir_task: *mut DirTask,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
        need_to_wait_out: &mut bool,
    ) -> bun_sys::Maybe<()> {
        // SAFETY: `dir_task` is live; this thread owns it.
        let path = unsafe { DirTask::path(dir_task) };
        let dirfd = self.cwd;

        // If `-d` is specified without `-r` then we can just use `rmdirat`.
        if self.opts.remove_empty_dirs && !self.opts.recursive {
            let mut state = RemoveFileParent {
                treat_as_dir: true,
                #[cfg(not(any(target_os = "linux", target_os = "android")))]
                allow_enqueue: false,
                enqueued: false,
            };
            if state.treat_as_dir {
                match bun_sys::rmdirat(dirfd, path) {
                    Ok(()) => return Ok(()),
                    Err(e) => match e.get_errno() {
                        E::ENOENT => {
                            if self.opts.force {
                                return self.verbose_deleted(dir_task, path.as_bytes());
                            }
                            return Err(self.error_with_path(&e, path.as_bytes()));
                        }
                        E::ENOTDIR => {
                            state.treat_as_dir = false;
                            self.remove_entry_file(dir_task, path, is_absolute, buf, &mut state)?;
                            if !state.treat_as_dir {
                                return Ok(());
                            }
                        }
                        _ => return Err(self.error_with_path(&e, path.as_bytes())),
                    },
                }
            }
        }

        if !self.opts.recursive {
            return Err(
                bun_sys::Error::from_code(E::EISDIR, bun_sys::Tag::TODO).with_path(path.as_bytes())
            );
        }

        // The entry was classified as a directory before this open (readdir
        // type, or unlinkat returning EISDIR/EPERM). NOFOLLOW keeps a symlink
        // swapped in between classification and open from redirecting the
        // recursive delete into an unrelated tree (same as Dir::delete_tree).
        let flags = bun_sys::O::DIRECTORY | bun_sys::O::RDONLY | bun_sys::O::NOFOLLOW;
        let fd = match shell_openat(dirfd, path, flags, 0) {
            Ok(fd) => fd,
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.opts.force {
                        return self.verbose_deleted(dir_task, path.as_bytes());
                    }
                    return Err(self.error_with_path(&e, path.as_bytes()));
                }
                E::ENOTDIR => {
                    let mut dummy = DummyRemoveFile;
                    return self.remove_entry_file(dir_task, path, is_absolute, buf, &mut dummy);
                }
                _ => return Err(self.error_with_path(&e, path.as_bytes())),
            },
        };

        // On posix we can close the fd whenever, but on Windows we need to
        // close it BEFORE we delete.
        let close_fd = scopeguard::guard(fd, |fd| fd.close());

        if self.error_signal.load(Ordering::SeqCst) {
            return Ok(());
        }

        let join_style = JoinStyle::from_path(self.operand().as_bytes());
        let mut iterator = dir_iterator::iterate(fd);
        let mut child_vtable = RemoveFileVTable {
            task: self,
            on_dir: OnDir::Enqueue,
        };

        // The loop may have already enqueued child DirTasks (bumping
        // `dir_task.subtask_count`) when a readdir/unlink error or an
        // `error_signal` from another worker aborts it. Returning from
        // inside the loop would skip the `need_to_wait` hand-off below,
        // so the last child's `post_run` would never drive
        // `delete_after_waiting_for_children` on this dir and the owning
        // `ShellRmTask` would never be freed.
        let mut i: usize = 0;
        let mut join_spill = Vec::new();
        let loop_result: bun_sys::Maybe<()> = loop {
            let current = match iterator.next() {
                Err(e) => break Err(self.error_with_path(&e, path.as_bytes())),
                Ok(None) => break Ok(()),
                Ok(Some(ent)) => ent,
            };
            // TODO this seems bad maybe better to listen to kqueue/epoll event
            if (i & 3) == 0 && self.error_signal.load(Ordering::SeqCst) {
                break Ok(());
            }
            i += 1;
            match current.kind {
                bun_sys::EntryKind::Directory => {
                    self.enqueue(
                        dir_task,
                        current.name.slice_u8(),
                        is_absolute,
                        EntryKindHint::Dir,
                    );
                }
                _ => {
                    let name = current.name.slice_u8();
                    // Copy the join into an owned ZBox so `buf` is free to
                    // be re-borrowed by the vtable callback.
                    let file_path = {
                        let joined = Self::buf_join(
                            join_style,
                            buf,
                            &mut join_spill,
                            &[path.as_bytes(), name],
                        );
                        ZBox::from_bytes(joined.as_bytes())
                    };
                    if let Err(e) = self.remove_entry_file(
                        dir_task,
                        file_path.as_zstr(),
                        is_absolute,
                        buf,
                        &mut child_vtable,
                    ) {
                        break Err(e);
                    }
                }
            }
        };

        // Stash any loop error before the hand-off — once `need_to_wait`
        // is published `self` may be freed, and `handle_err` takes a
        // mutex so it must not sit inside the hand-off below. The
        // `error_signal` check afterwards covers the no-children early-out.
        if let Err(e) = loop_result {
            self.handle_err(e);
        }

        // Closed before the hand-off: after it a child can remove this directory and end the operand.
        drop(close_fd);

        // Hand off to children. Publish `need_to_wait` first, then release
        // this task's own slot on `subtask_count` with the same `fetch_sub`
        // the children use: whoever takes the counter to 0 owns the rmdir.
        // A load-then-store here had a lost-wakeup window where the last
        // child could decrement and read `need_to_wait == false` between
        // the two operations, stranding `dir_task` forever.
        //
        // SAFETY: `dir_task` is live until `subtask_count` drains to 0, and
        // we still hold one count. Atomics through a short-lived `&DirTask`
        // — interior mutability.
        unsafe {
            let dt = &*dir_task;
            *need_to_wait_out = true;
            dt.need_to_wait.store(true, Ordering::SeqCst);
            if dt.subtask_count.fetch_sub(1, Ordering::SeqCst) != 1 {
                // A child still holds a count. It (or a later child) will
                // take the counter to 0 and drive
                // `delete_after_waiting_for_children`; nothing after this
                // may dereference `dir_task`.
                return Ok(());
            }
            // Every child already released its count (each saw the counter
            // > 1 and so did not take ownership). `dir_task` is exclusively
            // ours again: restore the invariants `post_run` expects and
            // fall through to delete inline.
            dt.subtask_count.store(1, Ordering::SeqCst);
            dt.need_to_wait.store(false, Ordering::SeqCst);
            *need_to_wait_out = false;
        }

        if self.error_signal.load(Ordering::SeqCst) {
            return Ok(());
        }

        match bun_sys::unlinkat_with_flags(self.cwd, path, bun_sys::AT_REMOVEDIR) {
            Ok(()) => self.verbose_deleted(dir_task, path.as_bytes()),
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.opts.force {
                        return self.verbose_deleted(dir_task, path.as_bytes());
                    }
                    Err(self.error_with_path(&e, path.as_bytes()))
                }
                _ => Err(e),
            },
        }
    }

    /// Returns `Ok(true)` if the
    /// directory was deleted (or force-ignored), `Ok(false)` if a subtask was
    /// enqueued and the caller should not run `post_run` yet.
    fn remove_entry_dir_after_children(&self, dir_task: *mut DirTask) -> bun_sys::Maybe<bool> {
        let dirfd = self.cwd;
        // SAFETY: `dir_task` is live; this thread owns it.
        let (path, is_abs) = unsafe { (DirTask::path(dir_task), (*dir_task).is_absolute) };
        let mut state = RemoveFileParent {
            treat_as_dir: true,
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
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
                            return Err(self.error_with_path(&e, path.as_bytes()));
                        }
                        E::ENOTDIR => {
                            state.treat_as_dir = false;
                            continue;
                        }
                        _ => return Err(self.error_with_path(&e, path.as_bytes())),
                    },
                }
            } else {
                let mut buf = bun_paths::path_buffer_pool::get();
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
                    Err(self.error_with_path(&e, path.as_bytes()))
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
                                    E::ENOTEMPTY => vtable.on_dir_not_empty(
                                        parent_dir_task,
                                        path,
                                        is_absolute,
                                        buf,
                                    ),
                                    // actually a file, the error is a permissions error
                                    E::ENOTDIR => Err(self.error_with_path(&e, path.as_bytes())),
                                    _ => Err(self.error_with_path(&e2, path.as_bytes())),
                                },
                            };
                        }
                        // We don't know if it was an actual permissions error
                        // or it was a directory so we need to try to delete it
                        // as a directory.
                        return vtable.on_is_dir(parent_dir_task, path, is_absolute, buf);
                    }
                    #[cfg(not(any(
                        target_os = "macos",
                        target_os = "ios",
                        target_os = "freebsd",
                        target_os = "netbsd",
                        target_os = "dragonfly",
                        target_os = "openbsd",
                        target_os = "solaris",
                        target_os = "illumos",
                        windows,
                    )))]
                    Err(self.error_with_path(&e, path.as_bytes()))
                }
                _ => Err(self.error_with_path(&e, path.as_bytes())),
            },
        }
    }

    /// Keeps the first error of the operand being removed and stops its walk.
    fn handle_err(&self, err: bun_sys::Error) {
        if !self.error_signal.swap(true, Ordering::SeqCst) {
            self.errs.lock().push_back(err);
        }
    }
}

// ── DirTask ────────────────────────────────────────────────────────────────

impl DirTask {
    fn create(
        task_manager: *mut ShellRmTask,
        parent_task: *mut DirTask,
        path: Option<ZBox>,
        kind_hint: EntryKindHint,
        event_loop: EventLoopHandle,
    ) -> Box<DirTask> {
        Box::new(DirTask {
            task_manager,
            parent_task,
            path,
            is_absolute: false,
            subtask_count: AtomicUsize::new(1),
            need_to_wait: AtomicBool::new(false),
            kind_hint,
            has_error: false,
            deleted_entries: Vec::new(),
            concurrent_task: bun_event_loop::EventLoopTask::from_event_loop(event_loop),
            work_task: WorkPoolTask {
                node: Default::default(),
                callback: DirTask::work_pool_callback,
            },
        })
    }

    /// The path this task removes.
    unsafe fn path<'a>(this: *const DirTask) -> &'a ZStr {
        // SAFETY: the caller runs `this`'s part of the walk: `path` and
        // `task_manager` are not written after `create`, the ShellRmTask
        // outlives its DirTasks, and `cursor` names this root's operand.
        unsafe {
            match &(*this).path {
                Some(path) => path.as_zstr(),
                None => (*(*this).task_manager).operand(),
            }
        }
    }

    /// Recover `*mut DirTask` from the intrusive `*WorkPoolTask`.
    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `work_task` is at a fixed offset within DirTask; `this` is a
        // live DirTask owned by this worker thread.
        let finished = unsafe {
            Self::run_from_thread_pool_impl(bun_core::from_field_ptr!(DirTask, work_task, task))
        };
        if let Some(root) = finished {
            // SAFETY: the ShellRmTask is live until `run_operands` ends the last operand.
            unsafe { ShellRmTask::run_operands(root.task_manager, Some(root)) };
        }
    }

    /// Returns the root of the operand if this call finished it, as [`Self::post_run`] does.
    /// # Safety
    /// `this` is a live DirTask (root or heap child); the calling worker
    /// thread has exclusive access to its non-atomic fields.
    #[must_use]
    unsafe fn run_from_thread_pool_impl(this: *mut DirTask) -> Option<Box<DirTask>> {
        // Stay on the raw pointer throughout: `remove_entry` re-derives
        // `&mut *this` internally (via `verbose_deleted` / `remove_entry_dir`)
        // and schedules child DirTasks that concurrently touch our atomics, so
        // holding a long-lived `&mut *this` across that call would alias under
        // Stacked Borrows.
        //
        // SAFETY: caller contract — `this` is a live DirTask; this worker
        // thread has exclusive access to its non-atomic fields (`task_manager`
        // / `parent_task` / `path` / `is_absolute`). `tm_ptr` is live until
        // `pending_main_callbacks` hits 0.
        let (tm_ptr, is_absolute): (*mut ShellRmTask, bool) = unsafe {
            let tm_ptr = (*this).task_manager;
            let abs = Platform::AUTO.is_absolute(Self::path(this).as_bytes());
            (*this).is_absolute = abs;
            (tm_ptr, abs)
        };

        // SAFETY: `task_manager` is live until pending_main_callbacks hits 0.
        // Every DirTask is a separate allocation, so this borrow does not
        // overlap any DirTask and the field-level `&mut` taken inside
        // `verbose_deleted` cannot pop its tag under Stacked Borrows.
        let tm = unsafe { &*tm_ptr };
        let waiting = match tm.remove_entry(this, is_absolute) {
            Ok(waiting) => waiting,
            Err(err) => {
                tm.handle_err(err);
                // `need_to_wait` is only stored on the `Ok(())` return path
                // of `remove_entry_dir`, so an `Err` return guarantees
                // ownership of `this` was not handed off.
                false
            }
        };

        // Re-reading `this` here to decide whether to skip `post_run` would
        // be a use-after-free race: once `remove_entry_dir` publishes
        // `need_to_wait = true`, the last child may run
        // `delete_after_waiting_for_children(this)` → `post_run` → `deinit`
        // (or, for the root, the main thread may drop the whole
        // `ShellRmTask`) before we get here. So the hand-off is threaded out
        // as a stack-local bool via `remove_entry`'s return value and `this`
        // is never touched again when set. When `waiting` is false the
        // hand-off never happened, so `post_run` is both safe and required.
        if !waiting {
            // SAFETY: `waiting == false` ⇒ `need_to_wait` was never published,
            // so no other thread can have driven `delete_after_waiting_for_children`
            // / `deinit` on `this`; it is still live and owned by this worker.
            return unsafe { Self::post_run(this) };
        }
        None
    }

    /// Returns the root of the operand if this call finished it: the caller then runs the next operand.
    /// # Safety
    /// `this` is a live DirTask; called from a worker thread that just
    /// finished its body.
    #[must_use]
    unsafe fn post_run(this: *mut DirTask) -> Option<Box<DirTask>> {
        // SAFETY: caller contract — `this` is a live DirTask owned by the
        // calling worker thread. `me` is held only over atomic / read-only
        // field access; `task_manager` is a separate allocation live until
        // `pending_main_callbacks` hits 0; `parent_task` is live until its
        // `subtask_count` drains. `delete_after_waiting_for_children` and
        // `queue_for_write` re-derive from raw `*mut` (no overlap with `me`,
        // which is a `&` over atomics + Copy fields). Non-root `deinit`
        // reclaims `this`'s Box; a finished root goes back as its Box.
        unsafe {
            let me = &*this;
            // This is true if the directory has subdirectories that need to be deleted.
            if me.need_to_wait.load(Ordering::SeqCst) {
                return None;
            }
            // We have executed all the children of this task.
            if me.subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
                let tm = &*me.task_manager;
                let parent_task = me.parent_task;
                // A child's lines are queued before its parent decrement, which can end the command.
                let will_queue_verbose =
                    !parent_task.is_null() && tm.opts.verbose && !me.deleted_entries.is_empty();
                if will_queue_verbose {
                    tm.pending_main_callbacks.fetch_add(1, Ordering::SeqCst);
                    Self::queue_for_write(this);
                } else if !parent_task.is_null() {
                    Self::deinit(this);
                }

                // If we have a parent and we are the last child, now we can delete the parent.
                if !parent_task.is_null() {
                    let p = &*parent_task;
                    // The parent releases its own slot on this counter in
                    // `remove_entry_dir`; whoever takes it to 0 owns the
                    // parent's rmdir. The parent's `fetch_sub` is sequenced
                    // after its final `deleted_entries` write and its
                    // `need_to_wait.store(true)`, and every decrement is a
                    // SeqCst RMW, so reading 1 here synchronizes-with the
                    // parent's release and makes those writes visible to
                    // `delete_after_waiting_for_children`.
                    if p.subtask_count.fetch_sub(1, Ordering::SeqCst) == 1 {
                        return Self::delete_after_waiting_for_children(parent_task);
                    }
                    return None;
                }

                // The operand's root: `run_operands` queues it or takes it to the next operand.
                return Some(bun_core::heap::take(this));
            }
        }
        // Otherwise need to wait.
        None
    }

    /// Returns what [`Self::post_run`] returns.
    /// # Safety
    /// `this` is a live DirTask; called from a worker thread.
    #[must_use]
    unsafe fn delete_after_waiting_for_children(this: *mut DirTask) -> Option<Box<DirTask>> {
        // SAFETY: caller contract. Stay on raw `this` —
        // `remove_entry_dir_after_children` reborrows `(*this).deleted_entries`
        // mutably (via `verbose_deleted`), so we never materialise a
        // long-lived `&DirTask` covering that field. The two atomic stores
        // and the `task_manager` read use raw place projection only.
        // `task_manager` lives in a separate allocation, so `tm: &ShellRmTask`
        // does not overlap any DirTask borrow.
        unsafe {
            (*this).need_to_wait.store(false, Ordering::SeqCst);
            // The caller just took `subtask_count` to 0; restore the slot
            // `post_run`'s own decrement expects.
            (*this).subtask_count.store(1, Ordering::SeqCst);
            let tm = &*(*this).task_manager;
            let mut do_post_run = true;
            if !tm.error_signal.load(Ordering::SeqCst) {
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
                return Self::post_run(this);
            }
        }
        None
    }

    /// Post this DirTask to the main
    /// thread for [`Rm::write_verbose`].
    ///
    /// # Safety
    /// `this` is a live DirTask; the pending-main-callback count on the
    /// owning ShellRmTask was bumped before calling.
    unsafe fn queue_for_write(this: *mut DirTask) {
        use bun_event_loop::{ConcurrentTask::AutoDeinit, EventLoopTask};
        // SAFETY: caller contract — `this` is live; `task_manager` is live
        // (pending count > 0).
        let (me, poster) = unsafe {
            let me = &mut *this;
            // The root rm task is still out (pending > 0), so its poster is set.
            let poster = (*me.task_manager)
                .task
                .poster
                .as_ref()
                .expect("rm root task on the pool is armed")
                .clone();
            (me, poster)
        };
        match &mut me.concurrent_task {
            EventLoopTask::Js(ct) => {
                ct.from(this, AutoDeinit::ManualDeinit);
                poster.post_js(core::ptr::NonNull::from(ct));
            }
            EventLoopTask::Mini(at) => {
                let at = at.from(this, dir_task_run_from_main_thread_mini);
                poster.post_mini(core::ptr::NonNull::new(at).expect("intrusive task"));
            }
        }
    }

    /// Flush verbose output.
    ///
    /// Reached only via `runtime::dispatch::run_task` for
    /// `task_tag::ShellRmDirTask` (or the mini-loop trampoline below), which
    /// always passes a live DirTask posted via [`queue_for_write`].
    ///
    /// # Safety
    /// `this` must be a live [`DirTask`] posted via [`queue_for_write`]; the
    /// pending count keeps `task_manager` alive; main thread.
    pub(crate) fn run_from_main_thread(this: *mut DirTask) {
        // SAFETY: caller contract — `interp` set at create.
        let (interp, cmd) = unsafe {
            let tm = (*this).task_manager;
            (&*(*tm).task.interp, (*tm).cmd)
        };
        Rm::write_verbose(interp, cmd, this).run(interp);
    }

    /// # Safety
    /// `this` is a live heap-allocated DirTask; reclaimed once.
    unsafe fn deinit(this: *mut DirTask) {
        // SAFETY: caller contract.
        unsafe { drop(bun_core::heap::take(this)) };
    }
}

fn dir_task_run_from_main_thread_mini(this: *mut DirTask, _: *mut ()) {
    // SAFETY: mini-loop trampoline for a DirTask posted via `queue_for_write`.
    DirTask::run_from_main_thread(this);
}

// ── RemoveFileHandler ───────────────────────────────────────────────────────

trait RemoveFileHandler {
    fn on_is_dir(
        &mut self,
        parent_dir_task: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()>;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
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
    fn on_is_dir(
        &mut self,
        _: *mut DirTask,
        _: &ZStr,
        _: bool,
        _: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    fn on_dir_not_empty(
        &mut self,
        _: *mut DirTask,
        _: &ZStr,
        _: bool,
        _: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        Ok(())
    }
}

struct RemoveFileVTable<'a> {
    task: &'a ShellRmTask,
    on_dir: OnDir<'a>,
}

/// What [`RemoveFileVTable`] does when the entry it was asked to unlink turns
/// out to be a directory.
enum OnDir<'a> {
    /// The entry is a child found while iterating a directory
    /// ([`ShellRmTask::remove_entry_dir`]): enqueue it as its own [`DirTask`].
    Enqueue,
    /// The entry is the [`DirTask`] itself ([`ShellRmTask::remove_entry`]):
    /// recurse into [`ShellRmTask::remove_entry_dir`] here. The out-param lets
    /// `remove_entry` learn that `need_to_wait` was published without
    /// re-reading the (possibly already-freed) DirTask.
    Recurse { need_to_wait_out: &'a mut bool },
}

impl RemoveFileVTable<'_> {
    fn on_dir(
        &mut self,
        parent: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        match &mut self.on_dir {
            OnDir::Enqueue => {
                self.task.enqueue_no_join(
                    parent,
                    ZBox::from_bytes(path.as_bytes()),
                    EntryKindHint::Dir,
                );
                Ok(())
            }
            OnDir::Recurse { need_to_wait_out } => {
                self.task
                    .remove_entry_dir(parent, is_absolute, buf, need_to_wait_out)
            }
        }
    }
}

impl RemoveFileHandler for RemoveFileVTable<'_> {
    fn on_is_dir(
        &mut self,
        parent: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        self.on_dir(parent, path, is_absolute, buf)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    fn on_dir_not_empty(
        &mut self,
        parent: *mut DirTask,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        self.on_dir(parent, path, is_absolute, buf)
    }
}

struct RemoveFileParent {
    treat_as_dir: bool,
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    allow_enqueue: bool,
    enqueued: bool,
}
impl RemoveFileHandler for RemoveFileParent {
    fn on_is_dir(
        &mut self,
        _: *mut DirTask,
        _: &ZStr,
        _: bool,
        _: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        self.treat_as_dir = true;
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    fn on_dir_not_empty(
        &mut self,
        parent: *mut DirTask,
        path: &ZStr,
        _: bool,
        _: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        self.treat_as_dir = true;
        if self.allow_enqueue {
            // SAFETY: `parent` is a live DirTask; `task_manager` is live until
            // `pending_main_callbacks` hits 0.
            let task = unsafe { &*(*parent).task_manager };
            task.enqueue_no_join(
                parent,
                ZBox::from_bytes(path.as_bytes()),
                EntryKindHint::Dir,
            );
            self.enqueued = true;
        }
        Ok(())
    }
}

// ── Taskable / ShellTaskCtx glue ──────────────────────────────────────────

impl bun_event_loop::Taskable for ShellRmTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmTask;
    /// The rm's own completion hop: drop the keep-alive and this pending
    /// callback's count (frees the task when it was the last).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe {
            (*this).task.unref_unrun();
            ShellRmTask::decr_pending_and_maybe_deinit(this);
        }
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
impl bun_event_loop::Taskable for DirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmDirTask;
    /// A `write_verbose` hop: free the dir task and give back the
    /// pending-callback unit it holds on its rm — as `run_from_main_thread`
    /// does when there is nothing to write.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; `tm` is read before `this` is freed.
        unsafe {
            let tm = (*this).task_manager;
            Self::deinit(this);
            ShellRmTask::decr_pending_and_maybe_deinit(tm);
        }
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellRmTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(_this: &mut Self) {
        // Not reached: `ShellRmTask::schedule` installs `work_pool_callback`
        // directly (the generic trampoline auto-posts back, which would race
        // the recursive DirTask tree's own `finish_concurrently`).
        debug_assert!(
            false,
            "ShellRmTask scheduled via ShellTask::schedule; use ShellRmTask::schedule"
        );
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: `ShellTask::run_from_main_thread` dispatch contract.
        Self::run_from_main_thread(this, interp)
    }
}

//! Port of src/shell/builtin/rm.zig

use core::ffi::CStr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId, ShellTask};
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
                        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
                            Self::state_mut(interp, cmd).state =
                                RmState::ParseOpts { idx, wait_write_err: true };
                            let child = ChildPtr::new(cmd, WriterTag::Builtin);
                            return Builtin::of_mut(interp, cmd)
                                .stderr
                                .enqueue(child, usage, safeguard);
                        }
                        Builtin::write_no_io(interp, cmd, IoKind::Stderr, usage);
                        return Builtin::done(interp, cmd, 1);
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
                                if let Some(safeguard) =
                                    Builtin::of(interp, cmd).stderr.needs_io()
                                {
                                    Self::state_mut(interp, cmd).state =
                                        RmState::ParseOpts { idx, wait_write_err: true };
                                    let child =
                                        ChildPtr::new(cmd, WriterTag::Builtin);
                                    return Builtin::of_mut(interp, cmd)
                                        .stderr
                                        .enqueue(child, buf, safeguard);
                                }
                                Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
                                return Builtin::done(interp, cmd, 1);
                            }

                            let args_start = idx as usize;
                            // TODO(b2-blocked): root-path guard — Zig joins
                            // each arg with cwd, normalises, and rejects if
                            // dirname == "" (i.e. would delete `/`). Needs
                            // bun_sys::getcwd + bun_paths::{join,normalizeString,dirname}.

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
                            return Self::write_err_literal(interp, cmd, idx, &buf);
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
                        let (args_start, argc) = {
                            let me = Self::state_mut(interp, cmd);
                            let RmState::Exec(e) = &mut me.state else { unreachable!() };
                            e.started = true;
                            (e.args_start, e.args_start + e.total_tasks)
                        };
                        let sig: *const AtomicBool = match &Self::state_mut(interp, cmd).state {
                            RmState::Exec(e) => &e.error_signal as *const _,
                            _ => unreachable!(),
                        };
                        for i in args_start..argc {
                            let p = Builtin::of(interp, cmd).args_slice()[i];
                            // SAFETY: argv entries are NUL-terminated.
                            let root = unsafe { CStr::from_ptr(p) }.to_bytes().to_vec();
                            let task = ShellRmTask::create(cmd, root, cwd, sig, evtloop);
                            // SAFETY: freshly Box::into_raw'd.
                            unsafe { ShellTask::schedule(task) };
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
        Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, 1)
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
                if exec.tasks_done >= exec.total_tasks
                    && exec.output_done.load(Ordering::SeqCst)
                        >= exec.output_count.load(Ordering::SeqCst)
                {
                    Some(if exec.err.is_some() { 1 } else { 0 })
                } else {
                    None
                }
            }
            state => {
                if let Some(err) = &e {
                    let code = err.errno as ExitCode;
                    *state = RmState::Err(code);
                    Some(code)
                } else {
                    Some(1)
                }
            }
        };
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
        // SAFETY: task was Box::into_raw'd in create(); reclaim.
        let mut task = unsafe { Box::from_raw(task) };
        let task_err = task.err.take();
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
                // exec.err is only used as a did-anything-fail flag from here.
                exec.err = Some(e);
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
            Builtin::write_no_io(interp, cmd, IoKind::Stderr, &s);
        }

        let all_out = match &Self::state_mut(interp, cmd).state {
            RmState::Exec(exec) => {
                exec.output_done.load(Ordering::SeqCst) >= exec.output_count.load(Ordering::SeqCst)
            }
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

/// Spec: rm.zig `ShellRmTask`. Walks the directory tree under `root_path` on a
/// worker thread, unlinking files / rmdir'ing directories bottom-up.
pub struct ShellRmTask {
    pub cmd: NodeId,
    pub root_path: Vec<u8>,
    pub cwd: bun_sys::Fd,
    pub error_signal: *const AtomicBool,
    pub is_absolute: bool,
    pub err: Option<bun_sys::Error>,
    pub deleted_entries: Vec<u8>,
    pub task: ShellTask,
}

impl ShellRmTask {
    pub fn create(
        cmd: NodeId,
        root_path: Vec<u8>,
        cwd: bun_sys::Fd,
        error_signal: *const AtomicBool,
        evtloop: EventLoopHandle,
    ) -> *mut ShellRmTask {
        // TODO(b2-blocked): bun_paths::Platform::Auto.is_absolute.
        let is_absolute = root_path.first() == Some(&b'/');
        Box::into_raw(Box::new(ShellRmTask {
            cmd,
            root_path,
            cwd,
            error_signal,
            is_absolute,
            err: None,
            deleted_entries: Vec::new(),
            task: ShellTask::new(evtloop),
        }))
    }

    /// Spec: rm.zig `ShellRmTask.runFromThreadPool` (~800 lines: DirTask
    /// breadth-first walk, unlinkat/rmdirat, verbose buffering).
    pub fn run_from_thread_pool(this: *mut ShellRmTask) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let this = unsafe { &mut *this };
        // TODO(b2-blocked): bun_sys::{unlinkat, rmdirat, fstatat},
        // bun_core::DirIterator. The full body builds a queue of `DirTask`s
        // (one per subdirectory), each of which iterates entries, unlinks
        // files, recurses into directories, and rmdir's itself once empty.
        // Verbose output is appended to `deleted_entries` and flushed via
        // `writeVerbose` on the main thread.
        let _ = (&this.root_path, this.cwd, this.is_absolute, this.error_signal);
        this.task.on_finish();
    }

    pub fn run_from_main_thread(this: *mut ShellRmTask, interp: &mut Interpreter) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let cmd = unsafe { (*this).cmd };
        Rm::on_shell_rm_task_done(interp, cmd, this);
    }

    /// Spec: rm.zig `ShellRmTask.DirTask.runFromMainThreadMini` — a child
    /// `DirTask` finished its subtree; bubble its error up into the parent.
    pub fn on_dir_task_done(
        parent: &mut ShellRmTask,
        _interp: &mut Interpreter,
        dir: *mut crate::shell::dispatch_tasks::ShellRmDirTask,
    ) {
        // SAFETY: `dir` is a live Box::into_raw'd DirTask (caller contract).
        let owned = unsafe { Box::from_raw(dir) };
        if parent.err.is_none() {
            parent.err = owned.err;
        }
        // TODO(b2-blocked): decrement the parent DirTask `remaining` counter
        // and rmdir bottom-up once it drains. The tree-walk that creates
        // these is still stubbed in `run_from_thread_pool`, so terminal
        // completion is routed via `ShellRmTask::run_from_main_thread`.
        let _ = &owned.path;
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellRmTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: *mut Self) { Self::run_from_thread_pool(this) }
    fn run_from_main_thread(this: *mut Self, interp: &mut Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/rm.zig (1268 lines)
//   confidence: low-medium (NodeId style; full parse_opts/exec state machine;
//               DirTask tree-walk stubbed)
//   blocked_on: bun_sys::{unlinkat, rmdirat, fstatat, getcwd},
//               bun_core::DirIterator, bun_paths helpers, WorkPool,
//               IOWriter::enqueue body
// ──────────────────────────────────────────────────────────────────────────

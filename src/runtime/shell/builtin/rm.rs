use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_core::{ZBox, ZStr, strings};
use bun_paths::resolve_path::{self, Platform, platform};
use bun_sys::{E, FdExt, dir_iterator};

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId, ShellTask, ShellTaskCtx, shell_openat};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Rm {
    pub(crate) opts: Opts,
    pub(crate) state: RmState,
}

#[derive(Default)]
pub enum RmState {
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

pub struct ExecState {
    /// Index into argv where filepath args start.
    pub(crate) args_start: usize,
    pub(crate) total_tasks: usize,
    pub(crate) err: Option<bun_sys::Error>,
    pub(crate) error_signal: AtomicBool,
    pub(crate) output_done: AtomicUsize,
    pub(crate) output_count: AtomicUsize,
    /// Numbers the chunks queued on a writer so each is called back.
    pub(crate) chunk_seq: u32,
    pub(crate) tasks_done: usize,
    pub(crate) started: bool,
}

impl ExecState {
    #[inline]
    fn output_drained(&self) -> bool {
        self.output_done.load(Ordering::SeqCst) >= self.output_count.load(Ordering::SeqCst)
    }

    fn next_chunk(&mut self, cmd: NodeId) -> ChildPtr {
        self.chunk_seq += 1;
        ChildPtr::builtin_task(cmd, self.chunk_seq)
    }
}

#[derive(Clone, Copy)]
pub struct Opts {
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
                    let parsed = Self::parse_flag(&mut Self::state_mut(interp, cmd).opts, &arg);
                    match parsed {
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
                                let cwd = Builtin::shell(interp, cmd).borrow().cwd().to_vec();
                                // Operands are unbounded user input, so neither
                                // step may use the fixed-size thread-local
                                // buffers behind `join` / `normalize_string`.
                                // Normalizing never grows a path by more than
                                // one byte.
                                let mut join_spill = Vec::new();
                                let mut normalize_buf = Vec::new();

                                for i in args_start..argc {
                                    let path = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                                    let resolved: &[u8] = if Platform::AUTO.is_absolute(&path) {
                                        &path
                                    } else {
                                        resolve_path::join_spill::<platform::Auto>(
                                            &mut join_spill,
                                            &[&cwd, &path],
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
                                        let stderr_needs_io =
                                            Builtin::of(interp, cmd).stderr.needs_io();
                                        if let Some(safeguard) = stderr_needs_io {
                                            Self::state_mut(interp, cmd).state =
                                                RmState::ParseOpts {
                                                    idx,
                                                    wait_write_err: true,
                                                };
                                            let child = ChildPtr::new(cmd, WriterTag::Builtin);
                                            return Builtin::write_out_fmt(
                                                interp,
                                                cmd,
                                                IoKind::Stderr,
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
                                            Some(Kind::Rm),
                                            format_args!(
                                                "\"{}\" may not be removed\n",
                                                bstr::BStr::new(&resolved_owned)
                                            ),
                                        );
                                        let _ =
                                            Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
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
                                chunk_seq: 0,
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
                            let stderr_needs_io = Builtin::of(interp, cmd).stderr.needs_io();
                            if let Some(safeguard) = stderr_needs_io {
                                Self::state_mut(interp, cmd).state = RmState::ParseOpts {
                                    idx,
                                    wait_write_err: true,
                                };
                                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                                return Builtin::write_out_fmt(
                                    interp,
                                    cmd,
                                    IoKind::Stderr,
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
                                Some(Kind::Rm),
                                format_args!("illegal option -- {}\n", bstr::BStr::new(&arg[1..])),
                            );
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
                        let opts = Self::state_mut(interp, cmd).opts;
                        let (args_start, argc) = {
                            let mut me = Self::state_mut(interp, cmd);
                            let RmState::Exec(e) = &mut me.state else {
                                unreachable!()
                            };
                            e.started = true;
                            (e.args_start, e.args_start + e.total_tasks)
                        };
                        let (sig, out_count) = {
                            let me = Self::state_mut(interp, cmd);
                            let RmState::Exec(e) = &me.state else {
                                unreachable!()
                            };
                            (
                                bun_ptr::BackRef::new(&e.error_signal),
                                bun_ptr::BackRef::new(&e.output_count),
                            )
                        };
                        for i in args_start..argc {
                            let root = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                            ShellRmTask::start(cmd, opts, &root, cwd, sig, out_count, interp);
                        }
                    }
                    return Yield::suspended();
                }
                Tag::Done(code) => return Builtin::done(interp, cmd, code),
                Tag::Err(code) => return Builtin::done(interp, cmd, code),
            }
        }
    }

    fn write_err_literal(interp: &Interpreter, cmd: NodeId, idx: u32, buf: &[u8]) -> Yield {
        let stderr_needs_io = Builtin::of(interp, cmd).stderr.needs_io();
        if let Some(safeguard) = stderr_needs_io {
            Self::state_mut(interp, cmd).state = RmState::ParseOpts {
                idx,
                wait_write_err: true,
            };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::write_out(interp, cmd, IoKind::Stderr, child, buf, safeguard);
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
        drop(e);
        match outcome {
            Some(code) => Builtin::done(interp, cmd, code),
            None => Yield::suspended(),
        }
    }

    /// The tree under one root argument is done (main thread).
    fn on_shell_rm_task_done(interp: &Interpreter, cmd: NodeId, task: Box<ShellRmTask>) {
        let task_err = task.tree.err.lock().take();
        drop(task);
        // Format the error string before
        // stashing the error on `exec` (formatting needs &mut interp).
        let errstr: Option<Vec<u8>> = task_err
            .as_ref()
            .map(|e| Builtin::task_error_to_string(Kind::Rm, e));
        let (tasks_done, total) = {
            let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                panic!("Invalid state")
            };
            exec.tasks_done += 1;
            if let Some(e) = task_err {
                // Only used as a did-anything-fail flag from here.
                exec.err = Some(e.without_path());
            }
            (exec.tasks_done, exec.total_tasks)
        };

        if let Some(s) = errstr {
            let stderr_needs_io = Builtin::of(interp, cmd).stderr.needs_io();
            if let Some(safeguard) = stderr_needs_io {
                // One error chunk per root can be in flight; number them so
                // each is called back (a failed writer calls equal children
                // back once).
                let child = {
                    let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                        unreachable!()
                    };
                    exec.output_count.fetch_add(1, Ordering::SeqCst);
                    exec.next_chunk(cmd)
                };
                Builtin::write_out(interp, cmd, IoKind::Stderr, child, &s, safeguard).run(interp);
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
                    if exec.err.is_some() {
                        1
                    } else {
                        0
                    }
                }
                _ => 0,
            };
            Self::state_mut(interp, cmd).state = RmState::Done { exit_code: code };
            Self::next(interp, cmd).run(interp);
        }
    }

    /// Flushes a `DirTask`'s buffered list of deleted paths to stdout (main
    /// thread); the task is done with.
    fn write_verbose(interp: &Interpreter, cmd: NodeId, mut dir: Box<DirTask>) -> Yield {
        let buf = core::mem::take(&mut dir.deleted_entries);
        drop(dir);

        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();

        if let Some(safeguard) = stdout_needs_io {
            // One chunk per DirTask can be in flight; number them so each is
            // called back (a failed writer calls equal children back once).
            let child = match &mut Self::state_mut(interp, cmd).state {
                RmState::Exec(exec) => exec.next_chunk(cmd),
                _ => ChildPtr::builtin_task(cmd, 1),
            };
            return Builtin::write_out(interp, cmd, IoKind::Stdout, child, &buf, safeguard);
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
                RmState::Exec(exec) => {
                    if exec.err.is_some() {
                        1
                    } else {
                        0
                    }
                }
                _ => 0,
            };
            return Builtin::done(interp, cmd, code);
        }
        Yield::done()
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
    fn state_mut(interp: &Interpreter, cmd: NodeId) -> bun_ptr::JsCellRefMut<'_, Rm> {
        bun_ptr::JsCellRefMut::map(Builtin::of_mut(interp, cmd), |b| match &mut b.impl_ {
            crate::shell::builtin::Impl::Rm(r) => &mut **r,
            _ => unreachable!(),
        })
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
pub enum EntryKindHint {
    Idk,
    Dir,
}

/// One per filepath argument: rides inside the root [`DirTask`] while the
/// tree under it is deleted on the pool, then is posted back to the owning
/// thread ([`Rm::on_shell_rm_task_done`]).
pub struct ShellRmTask {
    pub(crate) tree: Arc<RmTree>,
    pub task: ShellTask,
}

// `runtime::dispatch::run_task`'s `task_tag::ShellRmTask` arm reboxes the
// pointer `ShellTask::on_finish` posted; a completion that will not run drops
// the keep-alive and the box.
bun_event_loop::boxed_taskable!(ShellRmTask, ShellRmTask, |this| this.task.unref_unrun());

/// Shared by every [`DirTask`] under one root argument, from any pool thread.
pub struct RmTree {
    cmd: NodeId,
    opts: Opts,
    cwd: bun_sys::Fd,
    /// Into `Rm`'s `ExecState`, which stays in place until every task it
    /// started has reported back.
    error_signal: bun_ptr::BackRef<AtomicBool>,
    /// As `error_signal`; bumped once per `DirTask` that has verbose output.
    output_count: bun_ptr::BackRef<AtomicUsize>,
    /// First error hit by any worker thread.
    err: bun_threading::Guarded<Option<bun_sys::Error>>,
    join_style: JoinStyle,
}

/// One per directory (and per root path) in the recursive walk. Whoever holds
/// the box owns the non-atomic fields: the pool thread running it, then — once
/// it has handed off to its children — the last child to finish (through
/// [`Children`]), then the main thread for the verbose write.
pub struct DirTask {
    info: DirInfo,
    deleted_entries: Vec<u8>,
    /// Set once this directory has spawned a child task.
    children: Option<Arc<Children>>,
    pub task: ShellTask,
}

struct DirInfo {
    tree: Arc<RmTree>,
    path: ZBox,
    kind_hint: EntryKindHint,
    is_absolute: bool,
    /// The parent directory's [`Children`]; `None` for a root.
    parent: Option<Arc<Children>>,
    /// Root only: the rm task to post back once the whole tree is done.
    rm: Option<Box<ShellRmTask>>,
}

// Pool entry is `run_owned`; `runtime::dispatch::run_task`'s
// `task_tag::ShellRmDirTask` arm reboxes the verbose-output hop (a hop that
// will not run just drops the box: it took no keep-alive).
bun_threading::owned_task!(DirTask, task.task, run = DirTask::run_owned);
bun_event_loop::boxed_taskable!(DirTask, ShellRmDirTask);

/// A directory's own slot plus one per unfinished child task. Before giving
/// up its slot the directory parks its box here; whoever takes `pending` to
/// zero owns the box (and gets the slot back).
struct Children {
    pending: AtomicUsize,
    parked: bun_threading::Guarded<Option<Box<DirTask>>>,
}

impl Children {
    fn new() -> Children {
        Children {
            pending: AtomicUsize::new(1),
            parked: bun_threading::Guarded::new(None),
        }
    }

    /// The holder of `dir` gives up its slot. `Some` if every child had
    /// already finished: the caller keeps the directory.
    fn release(&self, dir: Box<DirTask>) -> Option<Box<DirTask>> {
        *self.parked.lock() = Some(dir);
        self.done()
    }

    /// One slot is done; the last one out takes the parked directory.
    fn done(&self) -> Option<Box<DirTask>> {
        if self.pending.fetch_sub(1, Ordering::SeqCst) != 1 {
            return None;
        }
        self.pending.store(1, Ordering::SeqCst);
        let dir = self.parked.lock().take();
        debug_assert!(dir.is_some(), "rm: last child out but no parked directory");
        dir
    }
}

impl ShellRmTask {
    pub(crate) fn start(
        cmd: NodeId,
        opts: Opts,
        root_path: &[u8],
        cwd: bun_sys::Fd,
        error_signal: bun_ptr::BackRef<AtomicBool>,
        output_count: bun_ptr::BackRef<AtomicUsize>,
        interp: &Interpreter,
    ) {
        let tree = Arc::new(RmTree {
            cmd,
            opts,
            cwd,
            error_signal,
            output_count,
            err: bun_threading::Guarded::new(None),
            join_style: JoinStyle::from_path(root_path),
        });
        let mut rm = Box::new(ShellRmTask {
            tree: Arc::clone(&tree),
            task: ShellTask::new(interp),
        });
        // Posted back from whichever pool thread finishes the tree, so take
        // the keep-alive and poster here on the owning thread.
        rm.task
            .keep_alive
            .ref_(rm.task.event_loop.as_event_loop_ctx());
        rm.task.arm();
        let root = Box::new(DirTask {
            info: DirInfo {
                tree,
                path: ZBox::from_bytes(root_path),
                kind_hint: EntryKindHint::Idk,
                is_absolute: false,
                parent: None,
                rm: Some(rm),
            },
            deleted_entries: Vec::new(),
            children: None,
            task: ShellTask::new(interp),
        });
        ShellTask::schedule_no_ref(root);
    }
}

impl ShellTaskCtx for ShellRmTask {
    fn shell_task(&self) -> &ShellTask {
        &self.task
    }
    fn shell_task_mut(&mut self) -> &mut ShellTask {
        &mut self.task
    }
    fn run_from_thread_pool(&mut self) {
        // Not scheduled itself: it rides inside the root DirTask.
        debug_assert!(false, "ShellRmTask is not a pool task");
    }
    fn run_from_main_thread(self: Box<Self>, interp: &Interpreter) {
        let cmd = self.tree.cmd;
        Rm::on_shell_rm_task_done(interp, cmd, self);
    }
}

impl RmTree {
    #[inline]
    fn errored(&self) -> bool {
        self.error_signal.load(Ordering::SeqCst)
    }

    fn handle_err(&self, err: bun_sys::Error) {
        let mut slot = self.err.lock();
        if slot.is_none() {
            *slot = Some(err);
            self.error_signal.store(true, Ordering::SeqCst);
        }
    }

    /// Join into `buf` honoring [`join_style`].
    fn buf_join<'a>(
        &self,
        buf: &'a mut bun_paths::PathBuffer,
        spill: &'a mut Vec<u8>,
        parts: &[&[u8]],
    ) -> &'a ZStr {
        if self.join_style == JoinStyle::Posix {
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
}

// ── DirTask ────────────────────────────────────────────────────────────────

impl DirTask {
    fn walk(&mut self) -> Walk<'_> {
        Walk {
            info: &self.info,
            entries: &mut self.deleted_entries,
            children: &mut self.children,
            task: &self.task,
        }
    }

    /// Pool thread: delete this entry (recursing into subdirectories as their
    /// own tasks), then either finish it or leave that to the last child.
    pub fn run_owned(mut this: Box<DirTask>) {
        this.info.is_absolute = Platform::AUTO.is_absolute(this.info.path.as_bytes());
        let mut handed_off = false;
        if let Err(err) = this.walk().remove_entry(&mut handed_off) {
            this.info.tree.handle_err(err);
        }
        if handed_off {
            let children = Arc::clone(this.children.as_ref().expect("handed off to a child"));
            this = match children.release(this) {
                // A child still runs; the last one finishes this directory.
                None => return,
                // Every child already finished: ours again.
                Some(dir) => dir,
            };
            if let Err(err) = this.walk().remove_dir_itself() {
                this.info.tree.handle_err(err);
            }
        }
        Self::post_run(this);
    }

    /// `this` and everything under it is deleted (or failed): queue its
    /// verbose output, then report to the parent directory or, for a root,
    /// post the rm task back.
    fn post_run(mut this: Box<DirTask>) {
        debug_assert!(
            this.children
                .as_ref()
                .is_none_or(|c| c.pending.load(Ordering::SeqCst) == 1),
            "rm: directory finished with a child task outstanding"
        );
        let parent = this.info.parent.take();
        let rm = this.info.rm.take();
        if this.info.tree.opts.verbose && !this.deleted_entries.is_empty() {
            // To `Rm::write_verbose`. Posted before the parent (or the rm
            // task) can complete, so it is written first.
            ShellTask::on_finish(this);
        } else {
            drop(this);
        }

        if let Some(parent) = parent {
            if let Some(dir) = parent.done() {
                Self::delete_after_waiting_for_children(dir);
            }
            return;
        }
        ShellTask::on_finish(rm.expect("root DirTask carries the rm task"));
    }

    /// Pool thread, as the last child of `dir` to finish: delete the (now
    /// empty) directory itself.
    fn delete_after_waiting_for_children(mut dir: Box<DirTask>) {
        loop {
            let mut spawned = false;
            if !dir.info.tree.errored() {
                match dir.walk().remove_entry_dir_after_children() {
                    Err(e) => dir.info.tree.handle_err(e),
                    Ok(deleted) => spawned = !deleted,
                }
            }
            if !spawned {
                return Self::post_run(dir);
            }
            // Not empty after all and a child was spawned for it: wait again.
            let children = Arc::clone(dir.children.as_ref().expect("spawned a child"));
            dir = match children.release(dir) {
                None => return,
                Some(d) => d,
            };
        }
    }
}

impl ShellTaskCtx for DirTask {
    fn shell_task(&self) -> &ShellTask {
        &self.task
    }
    fn shell_task_mut(&mut self) -> &mut ShellTask {
        &mut self.task
    }
    fn run_from_thread_pool(&mut self) {
        // `owned_task!(DirTask, .., run = DirTask::run_owned)`.
        debug_assert!(false, "DirTask runs through run_owned");
    }
    /// The verbose-output hop.
    fn run_from_main_thread(self: Box<Self>, interp: &Interpreter) {
        let cmd = self.info.tree.cmd;
        Rm::write_verbose(interp, cmd, self).run(interp);
    }
}

/// A [`DirTask`] being worked on by the thread that holds it.
struct Walk<'a> {
    info: &'a DirInfo,
    entries: &'a mut Vec<u8>,
    children: &'a mut Option<Arc<Children>>,
    task: &'a ShellTask,
}

/// What to do when the entry being unlinked turns out to be a directory.
enum OnDir<'a> {
    /// Nothing (it was reported as not-a-directory a moment ago).
    Ignore,
    /// A child found while iterating a directory: spawn a [`DirTask`] for it.
    Enqueue,
    /// The task's own path ([`Walk::remove_entry`]): recurse into
    /// [`Walk::remove_entry_dir`].
    Recurse { handed_off: &'a mut bool },
    /// The task's own path once its children are done.
    Parent(&'a mut RemoveFileParent),
}

struct RemoveFileParent {
    treat_as_dir: bool,
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    allow_enqueue: bool,
    enqueued: bool,
}

impl Walk<'_> {
    #[inline]
    fn tree(&self) -> &RmTree {
        &self.info.tree
    }

    /// Spawns a child task for `path` under this directory.
    fn enqueue(&mut self, path: &[u8], is_absolute: bool, kind_hint: EntryKindHint) {
        if self.tree().errored() {
            return;
        }
        let new_path = self
            .tree()
            .join(&[self.info.path.as_bytes(), path], is_absolute);
        self.enqueue_no_join(new_path, kind_hint);
    }

    /// Takes ownership of `path`.
    fn enqueue_no_join(&mut self, path: ZBox, kind_hint: EntryKindHint) {
        if self.tree().errored() {
            return;
        }
        let children = self
            .children
            .get_or_insert_with(|| Arc::new(Children::new()));
        let subtask = Box::new(DirTask {
            info: DirInfo {
                tree: Arc::clone(&self.info.tree),
                path,
                kind_hint,
                is_absolute: false,
                parent: Some(Arc::clone(children)),
                rm: None,
            },
            deleted_entries: Vec::new(),
            children: None,
            // Pool thread: the subtask reports to our loop through a clone of
            // our poster; no keep-alive ref (no VM thread-local here).
            task: ShellTask::new_child(self.task),
        });
        let count = children.pending.fetch_add(1, Ordering::Relaxed);
        debug_assert!(count > 0);
        ShellTask::schedule_no_ref(subtask);
    }

    fn verbose_deleted(&mut self, path: &[u8]) -> bun_sys::Maybe<()> {
        if !self.tree().opts.verbose {
            return Ok(());
        }
        if self.entries.is_empty() {
            self.tree().output_count.fetch_add(1, Ordering::SeqCst);
        }
        self.entries.extend_from_slice(path);
        self.entries.push(b'\n');
        Ok(())
    }

    /// `handed_off` is set when [`remove_entry_dir`](Self::remove_entry_dir)
    /// spawned children: the directory itself is then deleted by whoever
    /// finishes last (see [`DirTask::run_owned`]).
    fn remove_entry(&mut self, handed_off: &mut bool) -> bun_sys::Maybe<()> {
        let mut buf = bun_paths::PathBuffer::uninit();
        let (path, is_absolute) = (self.info.path.as_zstr(), self.info.is_absolute);
        match self.info.kind_hint {
            EntryKindHint::Idk => self.remove_entry_file(
                path,
                is_absolute,
                &mut buf,
                &mut OnDir::Recurse { handed_off },
            ),
            EntryKindHint::Dir => self.remove_entry_dir(is_absolute, &mut buf, handed_off),
        }
    }

    fn remove_entry_dir(
        &mut self,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
        handed_off: &mut bool,
    ) -> bun_sys::Maybe<()> {
        let path = self.info.path.as_zstr();
        let dirfd = self.tree().cwd;

        // If `-d` is specified without `-r` then we can just use `rmdirat`.
        if self.tree().opts.remove_empty_dirs && !self.tree().opts.recursive {
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
                            if self.tree().opts.force {
                                return self.verbose_deleted(path.as_bytes());
                            }
                            return Err(e.with_path(path.as_bytes()));
                        }
                        E::ENOTDIR => {
                            state.treat_as_dir = false;
                            self.remove_entry_file(
                                path,
                                is_absolute,
                                buf,
                                &mut OnDir::Parent(&mut state),
                            )?;
                            if !state.treat_as_dir {
                                return Ok(());
                            }
                        }
                        _ => return Err(e.with_path(path.as_bytes())),
                    },
                }
            }
        }

        if !self.tree().opts.recursive {
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
                    if self.tree().opts.force {
                        return self.verbose_deleted(path.as_bytes());
                    }
                    return Err(e.with_path(path.as_bytes()));
                }
                E::ENOTDIR => {
                    return self.remove_entry_file(path, is_absolute, buf, &mut OnDir::Ignore);
                }
                _ => return Err(e.with_path(path.as_bytes())),
            },
        };

        // On posix we can close the fd whenever, but on Windows we need to
        // close it BEFORE we delete.
        let mut _close_fd = scopeguard::guard(Some(fd), |fd| {
            if let Some(fd) = fd {
                fd.close();
            }
        });

        if self.tree().errored() {
            return Ok(());
        }

        let mut iterator = dir_iterator::iterate(fd);

        // An error (readdir/unlink, or `error_signal` from another worker)
        // may abort the loop after children were already spawned; the
        // hand-off below must still happen so the last child finishes this
        // directory.
        let mut i: usize = 0;
        let mut join_spill = Vec::new();
        let loop_result: bun_sys::Maybe<()> = loop {
            let current = match iterator.next() {
                Err(e) => break Err(e.with_path(path.as_bytes())),
                Ok(None) => break Ok(()),
                Ok(Some(ent)) => ent,
            };
            // TODO this seems bad maybe better to listen to kqueue/epoll event
            if (i & 3) == 0 && self.tree().errored() {
                break Ok(());
            }
            i += 1;
            match current.kind {
                bun_sys::EntryKind::Directory => {
                    self.enqueue(current.name.slice_u8(), is_absolute, EntryKindHint::Dir);
                }
                _ => {
                    let name = current.name.slice_u8();
                    // Copy the join into an owned ZBox so `buf` is free to
                    // be re-borrowed while removing the file.
                    let file_path = {
                        let joined =
                            self.tree()
                                .buf_join(buf, &mut join_spill, &[path.as_bytes(), name]);
                        ZBox::from_bytes(joined.as_bytes())
                    };
                    if let Err(e) = self.remove_entry_file(
                        file_path.as_zstr(),
                        is_absolute,
                        buf,
                        &mut OnDir::Enqueue,
                    ) {
                        break Err(e);
                    }
                }
            }
        };

        if let Err(e) = loop_result {
            self.tree().handle_err(e);
        }

        if self.children.is_some() {
            // Children were spawned: whoever finishes last (them, or us in
            // `run_owned`) deletes the directory itself. The fd is closed by
            // `_close_fd` on return.
            *handed_off = true;
            return Ok(());
        }

        #[cfg(windows)]
        {
            // Close BEFORE deleting on Windows.
            if let Some(f) = _close_fd.take() {
                f.close();
            }
        }

        self.remove_dir_itself()
    }

    /// The directory's contents are gone and no child is outstanding: delete
    /// the directory.
    fn remove_dir_itself(&mut self) -> bun_sys::Maybe<()> {
        if self.tree().errored() {
            return Ok(());
        }
        let path = self.info.path.as_zstr();
        match bun_sys::unlinkat_with_flags(self.tree().cwd, path, bun_sys::AT_REMOVEDIR) {
            Ok(()) => self.verbose_deleted(path.as_bytes()),
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.tree().opts.force {
                        return self.verbose_deleted(path.as_bytes());
                    }
                    Err(e.with_path(path.as_bytes()))
                }
                _ => Err(e),
            },
        }
    }

    /// Returns `Ok(true)` if the
    /// directory was deleted (or force-ignored), `Ok(false)` if a subtask was
    /// spawned and this directory has to wait for it.
    fn remove_entry_dir_after_children(&mut self) -> bun_sys::Maybe<bool> {
        let dirfd = self.tree().cwd;
        let (path, is_abs) = (self.info.path.as_zstr(), self.info.is_absolute);
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
                        let _ = self.verbose_deleted(path.as_bytes());
                        return Ok(true);
                    }
                    Err(e) => match e.get_errno() {
                        E::ENOENT => {
                            if self.tree().opts.force {
                                let _ = self.verbose_deleted(path.as_bytes());
                                return Ok(true);
                            }
                            return Err(e.with_path(path.as_bytes()));
                        }
                        E::ENOTDIR => {
                            state.treat_as_dir = false;
                            continue;
                        }
                        _ => return Err(e.with_path(path.as_bytes())),
                    },
                }
            } else {
                let mut buf = bun_paths::PathBuffer::uninit();
                self.remove_entry_file(path, is_abs, &mut buf, &mut OnDir::Parent(&mut state))?;
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

    fn on_is_dir(
        &mut self,
        handler: &mut OnDir<'_>,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        match handler {
            OnDir::Ignore => Ok(()),
            OnDir::Enqueue => {
                self.enqueue_no_join(ZBox::from_bytes(path.as_bytes()), EntryKindHint::Dir);
                Ok(())
            }
            OnDir::Recurse { handed_off } => self.remove_entry_dir(is_absolute, buf, handed_off),
            OnDir::Parent(state) => {
                state.treat_as_dir = true;
                Ok(())
            }
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    fn on_dir_not_empty(
        &mut self,
        handler: &mut OnDir<'_>,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
    ) -> bun_sys::Maybe<()> {
        match handler {
            OnDir::Parent(state) => {
                state.treat_as_dir = true;
                if state.allow_enqueue {
                    self.enqueue_no_join(ZBox::from_bytes(path.as_bytes()), EntryKindHint::Dir);
                    state.enqueued = true;
                }
                Ok(())
            }
            _ => self.on_is_dir(handler, path, is_absolute, buf),
        }
    }

    fn remove_entry_file(
        &mut self,
        path: &ZStr,
        is_absolute: bool,
        buf: &mut bun_paths::PathBuffer,
        handler: &mut OnDir<'_>,
    ) -> bun_sys::Maybe<()> {
        let dirfd = self.tree().cwd;
        match bun_sys::unlinkat_with_flags(dirfd, path, 0) {
            Ok(()) => self.verbose_deleted(path.as_bytes()),
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.tree().opts.force {
                        return self.verbose_deleted(path.as_bytes());
                    }
                    Err(e.with_path(path.as_bytes()))
                }
                E::EISDIR => self.on_is_dir(handler, path, is_absolute, buf),
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
                        if self.tree().opts.recursive || self.tree().opts.remove_empty_dirs {
                            return match bun_sys::unlinkat_with_flags(
                                self.tree().cwd,
                                path,
                                bun_sys::AT_REMOVEDIR,
                            ) {
                                // it was empty, we saved a syscall
                                Ok(()) => self.verbose_deleted(path.as_bytes()),
                                Err(e2) => match e2.get_errno() {
                                    // not empty, process directory as we would normally
                                    E::ENOTEMPTY => {
                                        self.on_dir_not_empty(handler, path, is_absolute, buf)
                                    }
                                    // actually a file, the error is a permissions error
                                    E::ENOTDIR => Err(e.with_path(path.as_bytes())),
                                    _ => Err(e2.with_path(path.as_bytes())),
                                },
                            };
                        }
                        // We don't know if it was an actual permissions error
                        // or it was a directory so we need to try to delete it
                        // as a directory.
                        return self.on_is_dir(handler, path, is_absolute, buf);
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
                    Err(e.with_path(path.as_bytes()))
                }
                _ => Err(e.with_path(path.as_bytes())),
            },
        }
    }
}

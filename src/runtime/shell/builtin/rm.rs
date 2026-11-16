use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use bun_core::{ZBox, ZStr, strings};
use bun_paths::resolve_path::{self, Platform, SpillBuf, platform};
use bun_sys::{E, dir_iterator};
use bun_threading::Guarded;
use bun_threading::work_pool::{OwnedTask, WorkPool};

use crate::node::fs::{
    find_embedded_shell_folder, forget_shell_operand, is_on_disk_at, note_found_on_disk,
};
use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{
    Interpreter, NodeId, ShellInterpreter, ShellTask, ShellTaskCtx, WorkPoolTask, shell_openat,
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
    pub(crate) total_tasks: usize,
    pub(crate) err: Option<bun_sys::Error>,
    pub(crate) output_done: usize,
    pub(crate) output_count: usize,
    pub(crate) tasks_done: usize,
    pub(crate) started: bool,
}

impl ExecState {
    #[inline]
    fn output_drained(&self) -> bool {
        self.output_done >= self.output_count
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
    pub(crate) fn start(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        note_found_on_disk();
        Self::next(interp, cmd)
    }

    fn next(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
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
                                let cwd = Builtin::shell(interp, cmd).cwd();
                                // Normalizing never grows a path by more than
                                // one byte.
                                let mut join_buf = SpillBuf::default();
                                let mut normalize_buf = Vec::new();

                                for i in args_start..argc {
                                    let path = Builtin::of(interp, cmd).arg_bytes(i);
                                    let resolved: &[u8] = if Platform::AUTO.is_absolute(path) {
                                        path
                                    } else {
                                        resolve_path::join_spill::<platform::Auto>(
                                            &mut join_buf,
                                            &[cwd, path],
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
                                        if let Some(fd) = Builtin::of(interp, cmd).stderr.needs_io()
                                        {
                                            Self::state_mut(interp, cmd).state =
                                                RmState::ParseOpts {
                                                    idx,
                                                    wait_write_err: true,
                                                };
                                            let child = ChildPtr::new(cmd, WriterTag::Builtin);
                                            return interp.enqueue_fmt(
                                                fd,
                                                child,
                                                Some(Kind::Rm),
                                                format_args!(
                                                    "\"{}\" may not be removed\n",
                                                    bstr::BStr::new(&resolved_owned)
                                                ),
                                            );
                                        }
                                        let buf = Builtin::fmt_error(
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
                                output_done: 0,
                                output_count: 0,
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
                            if let Some(fd) = Builtin::of(interp, cmd).stderr.needs_io() {
                                Self::state_mut(interp, cmd).state = RmState::ParseOpts {
                                    idx,
                                    wait_write_err: true,
                                };
                                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                                return interp.enqueue_fmt(
                                    fd,
                                    child,
                                    Some(Kind::Rm),
                                    format_args!(
                                        "illegal option -- {}\n",
                                        bstr::BStr::new(&arg[1..])
                                    ),
                                );
                            }
                            let buf = Builtin::fmt_error(
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
                        let (args_start, argc) = {
                            let me = Self::state_mut(interp, cmd);
                            let RmState::Exec(e) = &mut me.state else {
                                unreachable!()
                            };
                            e.started = true;
                            (e.args_start, e.args_start + e.total_tasks)
                        };
                        let error_signal = Arc::new(AtomicBool::new(false));
                        for i in args_start..argc {
                            Operand::schedule(interp, cmd, i, Arc::clone(&error_signal));
                        }
                    }
                    return Yield::suspended();
                }
                Tag::Done(code) => return Builtin::done(interp, cmd, code),
                Tag::Err(code) => return Builtin::done(interp, cmd, code),
            }
        }
    }

    fn write_err_literal(interp: &mut Interpreter<'_>, cmd: NodeId, idx: u32, buf: &[u8]) -> Yield {
        if let Some(fd) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = RmState::ParseOpts {
                idx,
                wait_write_err: true,
            };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return interp.enqueue(fd, child, buf);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, 1)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        let outcome: Option<ExitCode> = match &mut Self::state_mut(interp, cmd).state {
            RmState::Exec(exec) => {
                exec.output_done += 1;
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

    fn on_shell_rm_task_done(interp: &mut Interpreter<'_>, mut operand: Operand) -> Yield {
        let cmd = operand.cmd;
        let task_err = operand.err.get_mut().take();
        let path = Builtin::of(interp, cmd).arg_bytes(operand.arg_idx);
        let (is_recursive, was_on_disk) = (operand.opts.recursive, operand.was_on_disk);
        let cwd = Builtin::shell(interp, cmd).cwd();
        let find_folder = || find_embedded_shell_folder(cwd, path).filter(|_| !is_recursive);
        let task_err = task_err.or_else(find_folder);
        if task_err.is_none() {
            forget_shell_operand(cwd, path, was_on_disk);
        }
        let errstr: Option<Vec<u8>> = task_err
            .as_ref()
            .map(|e| Builtin::task_error_to_string(Kind::Rm, e));
        let (tasks_done, total) = {
            let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                panic!("Invalid state")
            };
            exec.tasks_done += 1;
            if let Some(e) = task_err {
                // Only a did-anything-fail flag from here.
                exec.err = Some(e.without_path());
            }
            (exec.tasks_done, exec.total_tasks)
        };

        if let Some(s) = errstr {
            if let Some(fd) = Builtin::of(interp, cmd).stderr.needs_io() {
                if let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                    exec.output_count += 1;
                }
                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                return interp.enqueue(fd, child, &s);
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
            return Self::next(interp, cmd);
        }
        Yield::suspended()
    }

    /// Flushes a `DirTask`'s buffered list of deleted paths to stdout.
    fn write_verbose(interp: &mut Interpreter<'_>, cmd: NodeId, buf: &[u8]) -> Yield {
        if let Some(fd) = Builtin::of(interp, cmd).stdout.needs_io() {
            if let RmState::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_count += 1;
            }
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return interp.enqueue(fd, child, buf);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, buf);
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
    fn state_mut<'i>(interp: &'i mut Interpreter<'_>, cmd: NodeId) -> &'i mut Rm {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Rm(r) => &mut **r,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Operand — per-filepath-arg recursive delete tree
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

/// One per filepath argument; shared by its [`DirTask`]s, and tracks the cross-thread error state.
pub(crate) struct Operand {
    pub(crate) cmd: NodeId,
    pub(crate) opts: Opts,
    pub(crate) cwd: bun_sys::Fd,
    /// Index into argv of the filepath argument.
    arg_idx: usize,
    /// Shared by the `Operand`s of the command.
    pub(crate) error_signal: Arc<AtomicBool>,
    /// First error hit by any worker thread. Mutex-wrapped so [`handle_err`]
    /// can take `&self` without an interior `&mut` cast.
    pub(crate) err: Guarded<Option<bun_sys::Error>>,
    pub(crate) join_style: JoinStyle,
    was_on_disk: bool,
}

/// One per directory in the recursive walk.
pub(crate) struct DirTask {
    pub(crate) operand: Arc<Operand>,
    /// `None` for the root.
    parent_task: Option<ParentTask>,
    /// Where `hand_off_to_children` leaves this task for its last child.
    hand_off_slot: Option<ParentTask>,
    pub path: ZBox,
    pub(crate) kind_hint: EntryKindHint,
    pub(crate) deleted_entries: Vec<u8>,
    task: ShellTask,
    /// Intrusive node for the thread-pool dispatch.
    pub(crate) work_task: WorkPoolTask,
}

bun_threading::intrusive_work_task!(DirTask, work_task);
bun_core::intrusive_field!(DirTask, task: ShellTask);

/// Held by a directory's task and its children. The last holder takes the task, and deletes the directory.
type ParentTask = Arc<Guarded<Option<Box<DirTask>>>>;

/// What [`Operand::remove_entry_file`] found.
#[derive(Clone, Copy, PartialEq, Eq)]
enum RemoveFileResult {
    Removed,
    IsDir,
}

enum DirState {
    Done,
    Remains(bun_sys::File),
}

impl Operand {
    fn schedule(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        arg_idx: usize,
        error_signal: Arc<AtomicBool>,
    ) {
        let cwd = Builtin::cwd(interp, cmd);
        let path = ZBox::from_bytes(Builtin::of(interp, cmd).arg_bytes(arg_idx));
        let operand = Arc::new(Operand {
            cmd,
            opts: Rm::state_mut(interp, cmd).opts,
            cwd,
            arg_idx,
            error_signal,
            err: Guarded::new(None),
            join_style: JoinStyle::from_path(path.as_bytes()),
            was_on_disk: is_on_disk_at(cwd, path.as_bytes()),
        });
        WorkPool::schedule_new(DirTask {
            operand,
            parent_task: None,
            hand_off_slot: None,
            path,
            kind_hint: EntryKindHint::Idk,
            deleted_entries: Vec::new(),
            task: ShellTask::new(interp),
            work_task: WorkPoolTask::default(),
        });
    }
}

impl DirTask {
    /// Joins `path` onto `self.path` and spawns
    /// a child DirTask.
    fn enqueue(&mut self, path: &[u8], is_absolute: bool) {
        if self.operand.error_signal.load(Ordering::SeqCst) {
            return;
        }
        let new_path = self
            .operand
            .join(&[self.path.as_bytes(), path], is_absolute);
        self.enqueue_no_join(new_path);
    }

    /// Takes ownership of `path`.
    fn enqueue_no_join(&mut self, path: ZBox) {
        if self.operand.error_signal.load(Ordering::SeqCst) {
            return;
        }
        WorkPool::schedule_new(DirTask {
            operand: Arc::clone(&self.operand),
            parent_task: Some(Arc::clone(self.hand_off_slot.get_or_insert_default())),
            hand_off_slot: None,
            path,
            kind_hint: EntryKindHint::Dir,
            deleted_entries: Vec::new(),
            // Only `-v` output makes a child post to the main thread.
            task: if self.operand.opts.verbose {
                ShellTask::new_child(&mut self.task)
            } else {
                ShellTask::default()
            },
            work_task: WorkPoolTask::default(),
        });
    }
}

impl Operand {
    fn verbose_deleted(&self, deleted_entries: &mut Vec<u8>, path: &[u8]) {
        if !self.opts.verbose {
            return;
        }
        deleted_entries.extend_from_slice(path);
        deleted_entries.push(b'\n');
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
        SpillBuf::with_scratch(|buf| {
            ZBox::from_bytes(resolve_path::join_spill::<platform::Auto>(buf, parts))
        })
    }

    #[inline]
    fn error_with_path(&self, e: &bun_sys::Error, path: &[u8]) -> bun_sys::Error {
        e.with_path(path)
    }
}

impl DirTask {
    fn remove_entry(&mut self) -> bun_sys::Maybe<DirState> {
        if self.kind_hint == EntryKindHint::Idk
            && self
                .operand
                .remove_entry_file(&self.path, &mut self.deleted_entries)?
                == RemoveFileResult::Removed
        {
            return Ok(DirState::Done);
        }
        self.remove_entry_dir()
    }

    fn remove_entry_dir(&mut self) -> bun_sys::Maybe<DirState> {
        let operand = &*self.operand;
        let path = self.path.as_zstr();
        let dirfd = operand.cwd;

        // If `-d` is specified without `-r` then we can just use `rmdirat`.
        if operand.opts.remove_empty_dirs && !operand.opts.recursive {
            match bun_sys::rmdirat(dirfd, path) {
                Ok(()) => return Ok(DirState::Done),
                Err(e) => match e.get_errno() {
                    E::ENOENT => {
                        if operand.opts.force {
                            operand.verbose_deleted(&mut self.deleted_entries, path.as_bytes());
                            return Ok(DirState::Done);
                        }
                        return Err(operand.error_with_path(&e, path.as_bytes()));
                    }
                    E::ENOTDIR => {
                        if operand.remove_entry_file(path, &mut self.deleted_entries)?
                            == RemoveFileResult::Removed
                        {
                            return Ok(DirState::Done);
                        }
                    }
                    _ => return Err(operand.error_with_path(&e, path.as_bytes())),
                },
            }
        }

        if !operand.opts.recursive {
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
                    if operand.opts.force {
                        operand.verbose_deleted(&mut self.deleted_entries, path.as_bytes());
                        return Ok(DirState::Done);
                    }
                    return Err(operand.error_with_path(&e, path.as_bytes()));
                }
                E::ENOTDIR => {
                    operand.remove_entry_file(path, &mut self.deleted_entries)?;
                    return Ok(DirState::Done);
                }
                _ => return Err(operand.error_with_path(&e, path.as_bytes())),
            },
        };

        let dir = bun_sys::File::from_fd(fd);

        if operand.error_signal.load(Ordering::SeqCst) {
            return Ok(DirState::Done);
        }

        let mut iterator = dir_iterator::iterate(dir.fd());
        let is_absolute = Platform::AUTO.is_absolute(path.as_bytes());

        let mut i: usize = 0;
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut join_spill = Vec::new();
        let loop_result: bun_sys::Maybe<()> = loop {
            let (operand, path) = (&*self.operand, self.path.as_bytes());
            let current = match iterator.next() {
                Err(e) => break Err(operand.error_with_path(&e, path)),
                Ok(None) => break Ok(()),
                Ok(Some(ent)) => ent,
            };
            // TODO this seems bad maybe better to listen to kqueue/epoll event
            if (i & 3) == 0 && operand.error_signal.load(Ordering::SeqCst) {
                break Ok(());
            }
            i += 1;
            match current.kind {
                bun_sys::EntryKind::Directory => {
                    self.enqueue(current.name.slice_u8(), is_absolute);
                }
                _ => {
                    let name = current.name.slice_u8();
                    let file_path = operand.buf_join(&mut buf, &mut join_spill, &[path, name]);
                    match operand.remove_entry_file(file_path, &mut self.deleted_entries) {
                        Ok(RemoveFileResult::Removed) => {}
                        Ok(RemoveFileResult::IsDir) => {
                            self.enqueue_no_join(ZBox::from_bytes(file_path.as_bytes()));
                        }
                        Err(e) => break Err(e),
                    }
                }
            }
        };

        if let Err(e) = loop_result {
            self.operand.handle_err(e);
        }
        Ok(DirState::Remains(dir))
    }

    /// For a directory whose children, if any, finished before `remove_entry_dir` did.
    fn remove_empty_dir(&mut self) -> bun_sys::Maybe<()> {
        let operand = &*self.operand;
        let path = self.path.as_zstr();
        match bun_sys::unlinkat_with_flags(operand.cwd, path, bun_sys::AT_REMOVEDIR) {
            Ok(()) => {}
            Err(e) => match e.get_errno() {
                E::ENOENT if operand.opts.force => {}
                E::ENOENT => return Err(operand.error_with_path(&e, path.as_bytes())),
                _ => return Err(e),
            },
        }
        operand.verbose_deleted(&mut self.deleted_entries, path.as_bytes());
        Ok(())
    }

    fn remove_entry_dir_after_children(&mut self) -> bun_sys::Maybe<()> {
        let operand = &*self.operand;
        let path = self.path.as_zstr();
        loop {
            match bun_sys::rmdirat(operand.cwd, path) {
                Ok(()) => {
                    operand.verbose_deleted(&mut self.deleted_entries, path.as_bytes());
                    return Ok(());
                }
                Err(e) => match e.get_errno() {
                    E::ENOENT => {
                        if operand.opts.force {
                            operand.verbose_deleted(&mut self.deleted_entries, path.as_bytes());
                            return Ok(());
                        }
                        return Err(operand.error_with_path(&e, path.as_bytes()));
                    }
                    E::ENOTDIR => {}
                    _ => return Err(operand.error_with_path(&e, path.as_bytes())),
                },
            }
            match operand.remove_entry_file(path, &mut self.deleted_entries)? {
                RemoveFileResult::Removed => return Ok(()),
                RemoveFileResult::IsDir => {}
            }
        }
    }
}

impl Operand {
    fn remove_entry_file(
        &self,
        path: &ZStr,
        deleted_entries: &mut Vec<u8>,
    ) -> bun_sys::Maybe<RemoveFileResult> {
        let dirfd = self.cwd;
        let mut removed = || {
            self.verbose_deleted(deleted_entries, path.as_bytes());
            Ok(RemoveFileResult::Removed)
        };
        match bun_sys::unlinkat_with_flags(dirfd, path, 0) {
            Ok(()) => removed(),
            Err(e) => match e.get_errno() {
                E::ENOENT => {
                    if self.opts.force {
                        return removed();
                    }
                    Err(self.error_with_path(&e, path.as_bytes()))
                }
                E::EISDIR => Ok(RemoveFileResult::IsDir),
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
                                Ok(()) => removed(),
                                Err(e2) => match e2.get_errno() {
                                    // not empty, process directory as we would normally
                                    E::ENOTEMPTY => Ok(RemoveFileResult::IsDir),
                                    // actually a file, the error is a permissions error
                                    E::ENOTDIR => Err(self.error_with_path(&e, path.as_bytes())),
                                    _ => Err(self.error_with_path(&e2, path.as_bytes())),
                                },
                            };
                        }
                        // We don't know if it was an actual permissions error
                        // or it was a directory so we need to try to delete it
                        // as a directory.
                        return Ok(RemoveFileResult::IsDir);
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

    fn handle_err(&self, err: bun_sys::Error) {
        let mut slot = self.err.lock();
        if slot.is_none() {
            *slot = Some(err);
            self.error_signal.store(true, Ordering::SeqCst);
        }
    }
}

// ── DirTask ────────────────────────────────────────────────────────────────

impl OwnedTask for DirTask {
    fn run(mut self: Box<Self>) {
        let dir_state = self.remove_entry().unwrap_or_else(|err| {
            self.operand.handle_err(err);
            DirState::Done
        });
        let Some(mut this) = self.hand_off_to_children() else {
            return;
        };
        if let DirState::Remains(dir) = dir_state
            && !this.operand.error_signal.load(Ordering::SeqCst)
        {
            // Close BEFORE deleting on Windows.
            if cfg!(windows) {
                drop(dir);
            }
            if let Err(err) = this.remove_empty_dir() {
                this.operand.handle_err(err);
            }
        }
        this.post_run();
    }
}

impl DirTask {
    /// `None` if a child is still running. The last one goes on with `self`, in `post_run`.
    fn hand_off_to_children(mut self: Box<Self>) -> Option<Box<Self>> {
        let Some(hand_off_slot) = self.hand_off_slot.take() else {
            return Some(self);
        };
        *hand_off_slot.lock() = Some(self);
        Self::take_if_last(hand_off_slot)
    }

    fn take_if_last(task: ParentTask) -> Option<Box<Self>> {
        Arc::into_inner(task)?.get_mut().take()
    }

    fn post_run(mut self: Box<Self>) {
        loop {
            let parent_task = self.parent_task.take();
            // The root always goes back, so the main thread drops the last `operand`.
            if parent_task.is_none() || !self.deleted_entries.is_empty() {
                ShellTask::on_finish(self);
            } else {
                drop(self);
            }

            // If we have a parent and we are the last child, now we can delete the parent.
            let Some(parent) = parent_task.and_then(Self::take_if_last) else {
                return;
            };
            self = parent;
            self.delete_after_waiting_for_children();
        }
    }

    fn delete_after_waiting_for_children(&mut self) {
        if !self.operand.error_signal.load(Ordering::SeqCst)
            && let Err(e) = self.remove_entry_dir_after_children()
        {
            self.operand.handle_err(e);
        }
    }
}

// ── BoxedTask / ShellTaskCtx glue ─────────────────────────────────────────

impl bun_event_loop::BoxedTask for DirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellRmDirTask;
    fn release_unrun(self: Box<Self>) {}
    /// See [`ShellTaskCtx`]: a step of a shell script always runs.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl ShellTaskCtx for DirTask {
    /// Flushes verbose output, and reports the `Operand` after its last `DirTask`.
    fn run_from_main_thread(self: Box<Self>, shell_interp: &ShellInterpreter, _: bool) {
        if !self.deleted_entries.is_empty() {
            shell_interp.run_yield_with(|interp| {
                Rm::write_verbose(interp, self.operand.cmd, &self.deleted_entries)
            });
        }
        if let Some(operand) = Arc::into_inner(self.operand) {
            shell_interp.run_yield_with(|interp| Rm::on_shell_rm_task_done(interp, operand));
        }
    }
}

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{
    Interpreter, Node, NodeId, Pipe, ShellExecEnv, ShellExecEnvKind, StateKind, closefd, log,
};
use crate::shell::io::{IO, InKind, OutKind};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::states::base::Base;
use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::r#if::If;
use crate::shell::states::subshell::Subshell;
use crate::shell::yield_::Yield;

pub struct Pipeline {
    pub(crate) base: Base,
    pub node: bun_ptr::BackRef<ast::Pipeline>,
    pub(crate) io: IO,
    pub(crate) exited_count: u32,
    /// `None` until `setup_commands` has inited every child.
    pub(crate) cmds: Option<Box<[CmdOrResult]>>,
    pub(crate) state: PipelineState,
}

pub enum CmdOrResult {
    Cmd(NodeId),
    Result(ExitCode),
}

pub enum PipelineState {
    /// `idx` is the next `cmds[]` slot to start.
    StartingCmds {
        idx: u32,
    },
    Pending,
    WaitingWriteErr,
    Done {
        exit_code: ExitCode,
    },
}

impl Default for PipelineState {
    fn default() -> Self {
        Self::StartingCmds { idx: 0 }
    }
}

impl Pipeline {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Pipeline,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Pipeline(Pipeline {
            base: Base::new(parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            exited_count: 0,
            cmds: None,
            state: PipelineState::default(),
        }))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    /// Queried by the trampoline (`Yield::run`) to manage the pipeline stack.
    #[inline]
    pub(crate) fn is_done(interp: &Interpreter, this: NodeId) -> bool {
        matches!(interp.as_pipeline(this).state, PipelineState::Done { .. })
    }

    #[inline]
    pub(crate) fn is_starting_cmds(interp: &Interpreter, this: NodeId) -> bool {
        matches!(
            interp.as_pipeline(this).state,
            PipelineState::StartingCmds { .. }
        )
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        match interp.as_pipeline(this).state {
            PipelineState::StartingCmds { idx } => Self::next_starting(interp, this, idx),
            PipelineState::Pending | PipelineState::WaitingWriteErr => Yield::suspended(),
            PipelineState::Done { exit_code } => {
                let parent = interp.as_pipeline(this).base.parent;
                interp.child_done(parent, this, exit_code)
            }
        }
    }

    /// Starts ONE child per call; `drain_pipelines` (Yield.rs) re-enters
    /// `Pipeline::next` for the next one once the current child suspends.
    fn next_starting(interp: &Interpreter, this: NodeId, idx: u32) -> Yield {
        if interp.as_pipeline(this).cmds.is_none() {
            debug_assert_eq!(idx, 0);
            if let Some(y) = Self::setup_commands(interp, this) {
                return y;
            }
        }

        let next = {
            let me = interp.as_pipeline(this);
            let cmds = me.cmds.as_deref().expect("set by setup_commands");
            cmds.get(idx as usize).map(|slot| match slot {
                CmdOrResult::Cmd(id) => *id,
                CmdOrResult::Result(_) => {
                    unreachable!("pipeline child {} finished before it was started", idx)
                }
            })
        };
        let Some(child) = next else {
            // All children started; wait for their `child_done` callbacks.
            interp.as_pipeline_mut(this).state = PipelineState::Pending;
            return Yield::suspended();
        };
        interp.as_pipeline_mut(this).state = PipelineState::StartingCmds { idx: idx + 1 };
        interp.start_node(child)
    }

    /// Creates the pipes and inits every child without starting any, so a
    /// failed pipe or dup finishes the pipeline (`Some(yield)`) while no child
    /// runs a subtree that `deinit` cannot reach.
    fn setup_commands(interp: &Interpreter, this: NodeId) -> Option<Yield> {
        let (node, parent_shell, evtloop) = {
            let me = interp.as_pipeline(this);
            (me.node, me.base.shell, interp.event_loop)
        };
        let items: &[ast::PipelineItem] = node.items;
        let cmd_count = items
            .iter()
            .filter(|it| !matches!(it, ast::PipelineItem::Assigns(_)))
            .count();

        if cmd_count == 0 {
            // An empty pipeline finishes with 0.
            return Some(Self::finish(interp, this, 0));
        }

        let mut pipes: Vec<Pipe> = Vec::with_capacity(cmd_count - 1);
        for _ in 0..cmd_count - 1 {
            // On POSIX use a
            // UNIX stream socketpair via `socketpairForShell` — on macOS
            // that variant intentionally skips SO_NOSIGPIPE so the
            // subprocess writing to a closed read end is killed by SIGPIPE
            // (like a real shell) instead of seeing EPIPE and printing
            // "Broken pipe" to stderr; on Windows use pipe().
            #[cfg(windows)]
            let r = bun_sys::pipe();
            #[cfg(unix)]
            let r = bun_sys::socketpair_for_shell(libc::AF_UNIX, libc::SOCK_STREAM, 0, false);
            match r {
                Ok(p) => pipes.push(p),
                Err(e) => {
                    for p in &pipes {
                        closefd(p[0]);
                        closefd(p[1]);
                    }
                    let sys_err = e.to_shell_system_error();
                    return Some(Self::write_failing_error(
                        interp,
                        this,
                        format_args!("bun: {}\n", sys_err.message),
                    ));
                }
            }
        }

        let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
        let mut cmds: Vec<CmdOrResult> = Vec::with_capacity(cmd_count);
        for item in items {
            if matches!(item, ast::PipelineItem::Assigns(_)) {
                continue;
            }
            // Position among runnable children (indexes `pipes[]`/`cmds[]`).
            let cmd_idx = cmds.len();

            let child_io = {
                let me = interp.as_pipeline(this);
                let stdin = if cmd_idx == 0 {
                    me.io.stdin.clone()
                } else {
                    let r = IOReader::init(pipes[cmd_idx - 1][0], evtloop);
                    r.set_interp(interp_ptr);
                    InKind::Fd(r)
                };
                let stdout = if cmd_idx == cmd_count - 1 {
                    me.io.stdout.clone()
                } else {
                    // `is_socket` is set on POSIX — the POSIX
                    // pipe is actually a socketpair end (see above).
                    let w = IOWriter::init(
                        pipes[cmd_idx][1],
                        io_writer::Flags {
                            pollable: true,
                            is_socket: cfg!(unix),
                            ..Default::default()
                        },
                        evtloop,
                    );
                    w.set_interp(interp_ptr);
                    OutKind::Fd(crate::shell::io::OutFd {
                        writer: w,
                        captured: None,
                    })
                };
                IO {
                    stdin,
                    stdout,
                    stderr: me.io.stderr.clone(),
                }
            };

            // Each pipeline child gets its own duped env (var assignments
            // inside a pipeline must not leak to siblings or the parent).
            // SAFETY: `parent_shell` is a live env owned by this pipeline's
            // parent state.
            let duped = match unsafe {
                (*parent_shell).dupe_for_subshell(&child_io, ShellExecEnvKind::Pipeline)
            } {
                Ok(d) => d,
                Err(e) => {
                    // Close the pipe ends that neither `child_io` nor an inited child owns.
                    drop(child_io);
                    for p in &pipes[cmd_idx..] {
                        closefd(p[0]);
                    }
                    for p in &pipes[core::cmp::min(cmd_idx + 1, pipes.len())..] {
                        closefd(p[1]);
                    }
                    interp.as_pipeline_mut(this).cmds = Some(cmds.into_boxed_slice());
                    let sys_err = e.to_shell_system_error();
                    return Some(Self::write_failing_error(
                        interp,
                        this,
                        format_args!("bun: {}\n", sys_err.message),
                    ));
                }
            };

            let child = match *item {
                ast::PipelineItem::Cmd(c) => Cmd::init(interp, duped, c, this, child_io),
                ast::PipelineItem::Subshell(s) => Subshell::init(interp, duped, s, this, child_io),
                ast::PipelineItem::If(f) => If::init(interp, duped, f, this, child_io),
                ast::PipelineItem::CondExpr(c) => CondExpr::init(interp, duped, c, this, child_io),
                ast::PipelineItem::Assigns(_) => unreachable!("skipped above"),
            };
            cmds.push(CmdOrResult::Cmd(child));
        }
        interp.as_pipeline_mut(this).cmds = Some(cmds.into_boxed_slice());
        None
    }

    /// Mark the pipeline done with `exit_code`. Returns `Next(this)` so the
    /// trampoline sees `is_done`, removes us from `pipeline_stack`, and
    /// `next()` reports to the parent. Calling `child_done(parent, ..)`
    /// directly would free this node while it is still on `pipeline_stack`.
    fn finish(interp: &Interpreter, this: NodeId, exit_code: ExitCode) -> Yield {
        interp.as_pipeline_mut(this).state = PipelineState::Done { exit_code };
        Yield::Next(this)
    }

    /// Same shape as `Builtin::cmd_write_failing_error`: `.fd` stderr
    /// enqueues an async write and parks in `WaitingWriteErr` (resumed by
    /// `on_io_writer_chunk`); otherwise append to the captured stderr buffer
    /// and finish with exit 1.
    fn write_failing_error(
        interp: &Interpreter,
        this: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        let stderr_fd = match &interp.as_pipeline(this).io.stderr {
            OutKind::Fd(fd) => Some((std::sync::Arc::clone(&fd.writer), fd.captured)),
            OutKind::Pipe | OutKind::Ignore => None,
        };
        if let Some((writer, captured)) = stderr_fd {
            // Only the fd arm transitions state.
            interp.as_pipeline_mut(this).state = PipelineState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(this, io_writer::WriterTag::Pipeline);
            return writer.enqueue(child, captured, &buf);
        }
        if let OutKind::Pipe = &interp.as_pipeline(this).io.stderr {
            // SAFETY: single trampoline frame; no other borrow of the env's
            // (or its parent's) stderr buffer is live.
            let stderr = unsafe {
                interp
                    .as_pipeline_mut(this)
                    .base
                    .shell_mut()
                    .buffered_stderr_mut()
            };
            stderr.extend_from_slice(&buf);
        }
        Self::finish(interp, this, 1)
    }

    /// IOWriter completion callback for the error message written in
    /// `WaitingWriteErr`. The pipeline finishes with exit code 1 whether or
    /// not the write succeeded: the parent always needs a completion, and a
    /// failed stderr write has nowhere else to be reported.
    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        debug_assert!(matches!(
            interp.as_pipeline(this).state,
            PipelineState::WaitingWriteErr
        ));
        Self::finish(interp, this, 1)
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        log!(
            "Pipeline {} childDone (child={} exit={})",
            this,
            child,
            exit_code
        );
        // Find the child in `cmds` and replace with its result.
        let (all_done, n) = {
            let me = interp.as_pipeline_mut(this);
            me.exited_count += 1;
            let n = me.cmds.as_ref().map(|c| c.len() as u32).unwrap_or(0);
            if let Some(cmds) = &mut me.cmds {
                for slot in cmds.iter_mut() {
                    if matches!(slot, CmdOrResult::Cmd(id) if *id == child) {
                        *slot = CmdOrResult::Result(exit_code);
                        break;
                    }
                }
            }
            (me.exited_count >= n && n > 0, n)
        };
        // We duped a ShellExecEnv per child in `next_starting`. Cmd/If/CondExpr
        // do NOT free `base.shell` in their own `deinit`, so free it here.
        // Subshell frees its own; Assigns is skipped.
        Self::deinit_child_duped_env(interp, child);
        interp.deinit_node(child);
        if all_done {
            // Exit code = last command's exit code (bash semantics).
            // For a single-runnable pipeline `last_exit_code` stays 0: only
            // inspect `cmds[len-1]` when `len >= 2`.
            let exit = {
                let me = interp.as_pipeline(this);
                match me.cmds.as_ref() {
                    Some(c) if c.len() >= 2 => match c.last() {
                        Some(CmdOrResult::Result(e)) => *e,
                        _ => 0,
                    },
                    _ => 0,
                }
            };
            interp.as_pipeline_mut(this).state = PipelineState::Done { exit_code: exit };
            return Yield::Next(this);
        }
        let _ = n;
        Yield::suspended()
    }

    /// Free the per-child env duped in `next_starting` for child kinds that
    /// don't free `base.shell` themselves.
    fn deinit_child_duped_env(interp: &Interpreter, child: NodeId) {
        let kind = interp.node(child).kind();
        if matches!(
            kind,
            StateKind::Cmd | StateKind::IfClause | StateKind::Condexpr
        ) {
            if let Some(base) = interp.node_mut(child).base_mut() {
                let shell = core::mem::replace(&mut base.shell, core::ptr::null_mut());
                if !shell.is_null() {
                    // SAFETY: `shell` is the duped env this pipeline child owned;
                    // null-checked above and exclusively held here.
                    ShellExecEnv::deinit_impl(shell);
                }
            }
        }
    }

    pub(crate) fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Pipeline {} deinit", this);
        // Only children that never started (setup failed) are still here.
        let cmds = interp.as_pipeline_mut(this).cmds.take();
        if let Some(cmds) = cmds {
            for c in cmds.into_vec() {
                if let CmdOrResult::Cmd(id) = c {
                    Self::deinit_child_duped_env(interp, id);
                    interp.deinit_node(id);
                }
            }
        }
    }
}

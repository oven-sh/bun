use bun_ptr::AsCtxPtr;

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
use crate::shell::{ExitCode, ShellErr};

pub struct Pipeline {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::Pipeline>,
    pub io: IO,
    pub exited_count: u32,
    pub cmds: Option<Box<[CmdOrResult]>>,
    pub pipes: Option<Box<[Pipe]>>,
    pub state: PipelineState,
}

pub enum CmdOrResult {
    Cmd(NodeId),
    Result(ExitCode),
}

pub enum PipelineState {
    StartingCmds { idx: u32 },
    Pending,
    WaitingWriteErr,
    Done { exit_code: ExitCode },
}

impl Default for PipelineState {
    fn default() -> Self {
        Self::StartingCmds { idx: 0 }
    }
}

impl Pipeline {
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Pipeline,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Pipeline(Pipeline {
            base: Base::new(StateKind::Pipeline, parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            exited_count: 0,
            cmds: None,
            pipes: None,
            state: PipelineState::default(),
        }))
    }

    pub fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    /// Queried by the trampoline (`Yield::run`) to manage the pipeline stack.
    #[inline]
    pub fn is_done(interp: &Interpreter, this: NodeId) -> bool {
        matches!(interp.as_pipeline(this).state, PipelineState::Done { .. })
    }

    #[inline]
    pub fn is_starting_cmds(interp: &Interpreter, this: NodeId) -> bool {
        matches!(
            interp.as_pipeline(this).state,
            PipelineState::StartingCmds { .. }
        )
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
        match interp.as_pipeline(this).state {
            PipelineState::StartingCmds { idx } => Self::next_starting(interp, this, idx),
            PipelineState::Pending | PipelineState::WaitingWriteErr => Yield::suspended(),
            PipelineState::Done { exit_code } => {
                let parent = interp.as_pipeline(this).base.parent;
                interp.child_done(parent, this, exit_code)
            }
        }
    }

    /// Set up N-1 pipes, dupe the shell env per child, spawn each
    /// Cmd/Assigns/Subshell/If/CondExpr with stdin/stdout wired to the right
    /// pipe ends.
    ///
    /// Spec (Pipeline.zig `next()` `.starting_cmds`): spawns exactly ONE child
    /// per call and returns that child's `start()` Yield. The trampoline's
    /// `drain_pipelines` (Yield.rs) re-enters `Pipeline::next` to spawn the
    /// next child once the current one suspends — so every child's start-yield
    /// is driven, never dropped.
    fn next_starting(interp: &Interpreter, this: NodeId, idx: u32) -> Yield {
        let (node, parent_shell, evtloop) = {
            let me = interp.as_pipeline(this);
            (me.node, me.base.shell, interp.event_loop)
        };
        let items: &[ast::PipelineItem] = node.items;
        // Spec (Pipeline.zig setupCommands): assigns inside a pipeline are
        // no-ops — they're not counted, not duped, not started. `cmd_count`
        // here is the number of *runnable* children.
        let cmd_count = items
            .iter()
            .filter(|it| !matches!(it, ast::PipelineItem::Assigns(_)))
            .count();

        if cmd_count == 0 {
            // Spec (Pipeline.zig start()): empty pipeline finishes with 0.
            // Return `Next(this)` so the trampoline sees `is_done`, removes us
            // from the pipeline stack, and `next()` bubbles to the parent.
            // Calling `child_done(parent, ..)` directly here would free this
            // node while it's still on `pipeline_stack`.
            interp.as_pipeline_mut(this).state = PipelineState::Done { exit_code: 0 };
            return Yield::Next(this);
        }

        // First entry: allocate pipes + cmd slots.
        if idx == 0 && interp.as_pipeline(this).cmds.is_none() {
            let mut pipes: Vec<Pipe> = Vec::with_capacity(cmd_count.saturating_sub(1));
            for _ in 0..cmd_count.saturating_sub(1) {
                // Spec (Pipeline.zig initializePipes 291-313): on POSIX use a
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
                        // Leave `StartingCmds` so `drain_pipelines` doesn't
                        // re-enter `next_starting` and retry the failing
                        // syscall in a loop (spec: setupCommands → start →
                        // .waiting_write_err → suspended).
                        interp.as_pipeline_mut(this).state = PipelineState::WaitingWriteErr;
                        interp.throw(ShellErr::new_sys(e));
                        return Yield::failed();
                    }
                }
            }
            let cmds: Vec<CmdOrResult> = (0..cmd_count).map(|_| CmdOrResult::Result(0)).collect();
            let me = interp.as_pipeline_mut(this);
            me.pipes = Some(pipes.into_boxed_slice());
            me.cmds = Some(cmds.into_boxed_slice());
        }

        // `idx` walks `items[]`; skip over Assigns to find the next runnable.
        let mut item_idx = idx as usize;
        while item_idx < items.len() && matches!(items[item_idx], ast::PipelineItem::Assigns(_)) {
            item_idx += 1;
        }
        if item_idx >= items.len() {
            // All children spawned; wait for their `child_done` callbacks.
            interp.as_pipeline_mut(this).state = PipelineState::Pending;
            return Yield::suspended();
        }
        // `cmd_idx` is the position among runnable children (indexes
        // `pipes[]`/`cmds[]`).
        let cmd_idx = items[..item_idx]
            .iter()
            .filter(|it| !matches!(it, ast::PipelineItem::Assigns(_)))
            .count();

        // Build per-child IO: stdin from prev pipe read end (or parent
        // stdin for first), stdout to this pipe write end (or parent stdout
        // for last), stderr inherited. Spec: Pipeline.zig readPipe/writePipe.
        let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
        let child_io = {
            let me = interp.as_pipeline(this);
            let pipes = me.pipes.as_ref().expect("pipes set above");
            let stdin = if cmd_count == 1 || cmd_idx == 0 {
                me.io.stdin.clone()
            } else {
                let r = IOReader::init(pipes[cmd_idx - 1][0], evtloop);
                r.set_interp(interp_ptr);
                InKind::Fd(r)
            };
            let stdout = if cmd_count == 1 || cmd_idx == cmd_count - 1 {
                me.io.stdout.clone()
            } else {
                // Spec (Pipeline.zig writePipe 320-324):
                // `.is_socket = bun.Environment.isPosix` — the POSIX
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
                // Spec (Pipeline.zig setupCommands 132-140): on dupe failure,
                // close the pipe ends not yet wrapped in an IOReader/IOWriter,
                // deref `cmd_io`, transition to `.waiting_write_err`, and
                // suspend. Without the state transition `drain_pipelines`
                // would re-enter at the same `idx`, re-wrapping the same fds
                // in fresh IOReader/IOWriter each iteration.
                drop(child_io);
                {
                    let me = interp.as_pipeline_mut(this);
                    if let Some(pipes) = me.pipes.as_ref() {
                        let len = pipes.len();
                        for p in &pipes[cmd_idx..] {
                            closefd(p[0]);
                        }
                        for p in &pipes[core::cmp::min(cmd_idx + 1, len)..] {
                            closefd(p[1]);
                        }
                    }
                    me.state = PipelineState::WaitingWriteErr;
                }
                interp.throw(ShellErr::new_sys(e));
                return Yield::failed();
            }
        };

        let child = match items[item_idx] {
            ast::PipelineItem::Cmd(c) => Cmd::init(interp, duped, c, this, child_io),
            ast::PipelineItem::Subshell(s) => Subshell::init(interp, duped, s, this, child_io),
            ast::PipelineItem::If(f) => If::init(interp, duped, f, this, child_io),
            ast::PipelineItem::CondExpr(c) => CondExpr::init(interp, duped, c, this, child_io),
            ast::PipelineItem::Assigns(_) => unreachable!("skipped above"),
        };
        interp.as_pipeline_mut(this).cmds.as_mut().unwrap()[cmd_idx] = CmdOrResult::Cmd(child);
        interp.as_pipeline_mut(this).state = PipelineState::StartingCmds {
            idx: (item_idx + 1) as u32,
        };

        // Spawn exactly this one child. The trampoline will re-enter us via
        // `drain_pipelines` to spawn the next after this one yields.
        interp.start_node(child)
    }

    /// Spec: Pipeline.zig `onIOWriterChunk` (lines 206-217).
    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        debug_assert!(matches!(
            interp.as_pipeline(this).state,
            PipelineState::WaitingWriteErr
        ));
        if let Some(e) = err {
            interp.throw(ShellErr::from_system(e));
            return Yield::failed();
        }
        let parent = interp.as_pipeline(this).base.parent;
        interp.child_done(parent, this, 1)
    }

    pub fn child_done(
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
        // do NOT free `base.shell` in their own `deinit`, so free it here
        // (spec: Pipeline.zig childDone() lines 236-250). Subshell frees its
        // own; Assigns is skipped per spec.
        Self::deinit_child_duped_env(interp, child);
        interp.deinit_node(child);
        if all_done {
            // Exit code = last command's exit code (bash semantics).
            // Spec (Pipeline.zig childDone 258-266): the back-scan loop is
            // `var i = len-1; while (i > 0) : (i -= 1)` — note `> 0`, not
            // `>= 0` — so for a single-runnable pipeline the loop body never
            // runs and `last_exit_code` stays 0. Mirror that exactly: only
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
    /// don't free `base.shell` themselves (spec: Pipeline.zig childDone()).
    fn deinit_child_duped_env(interp: &Interpreter, child: NodeId) {
        let kind = interp.node(child).kind();
        if matches!(
            kind,
            StateKind::Cmd | StateKind::IfClause | StateKind::Condexpr
        ) {
            if let Some(base) = interp.node_mut(child).base_mut() {
                let shell = core::mem::replace(&mut base.shell, core::ptr::null_mut());
                if !shell.is_null() {
                    ShellExecEnv::deinit_impl(shell);
                }
            }
        }
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Pipeline {} deinit", this);
        // Deinit any still-live children (and their duped envs).
        let cmds = interp.as_pipeline_mut(this).cmds.take();
        if let Some(cmds) = cmds {
            for c in cmds.into_vec() {
                if let CmdOrResult::Cmd(id) = c {
                    Self::deinit_child_duped_env(interp, id);
                    interp.deinit_node(id);
                }
            }
        }
        let me = interp.as_pipeline_mut(this);
        // The pipe fds are owned by the IOReader/IOWriter Arcs handed to each
        // child; when those drop they close. Any unclaimed ones (error path)
        // were closed inline above.
        me.pipes = None;
        me.base.end_scope();
    }
}

// ported from: src/shell/states/Pipeline.zig

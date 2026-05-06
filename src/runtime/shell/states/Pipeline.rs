use crate::shell::ast;
use crate::shell::interpreter::{
    closefd, log, Interpreter, Node, NodeId, Pipe, ShellExecEnv, ShellExecEnvKind, StateKind,
};
use crate::shell::io::{InKind, OutKind, IO};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::states::assigns::{AssignCtx, Assigns};
use crate::shell::states::base::Base;
use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::r#if::If;
use crate::shell::states::subshell::Subshell;
use crate::shell::yield_::Yield;
use crate::shell::{ExitCode, ShellErr};

pub struct Pipeline {
    pub base: Base,
    pub node: *const ast::Pipeline,
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
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Pipeline,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Pipeline(Pipeline {
            base: Base::new(StateKind::Pipeline, parent, shell),
            node,
            io,
            exited_count: 0,
            cmds: None,
            pipes: None,
            state: PipelineState::default(),
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
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

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
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
    fn next_starting(interp: &mut Interpreter, this: NodeId, idx: u32) -> Yield {
        let (node, parent_shell, evtloop) = {
            let me = interp.as_pipeline(this);
            (me.node, me.base.shell, interp.event_loop)
        };
        // SAFETY: `node` points into the AST arena which outlives every state
        // node.
        let items: &[ast::PipelineItem] = unsafe { &*(*node).items };
        let n = items.len();

        if n == 0 {
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
            let mut pipes: Vec<Pipe> = Vec::with_capacity(n.saturating_sub(1));
            for _ in 0..n.saturating_sub(1) {
                match bun_sys::pipe() {
                    Ok(p) => pipes.push(p),
                    Err(e) => {
                        for p in &pipes {
                            closefd(p[0]);
                            closefd(p[1]);
                        }
                        interp.throw(&ShellErr::new_sys(e));
                        return Yield::failed();
                    }
                }
            }
            let cmds: Vec<CmdOrResult> =
                (0..n).map(|_| CmdOrResult::Result(0)).collect();
            let me = interp.as_pipeline_mut(this);
            me.pipes = Some(pipes.into_boxed_slice());
            me.cmds = Some(cmds.into_boxed_slice());
        }

        if (idx as usize) >= n {
            // All children spawned; wait for their `child_done` callbacks.
            interp.as_pipeline_mut(this).state = PipelineState::Pending;
            return Yield::suspended();
        }

        let i = idx as usize;
        // Build per-child IO: stdin from prev pipe read end (or parent
        // stdin for i==0), stdout to this pipe write end (or parent stdout
        // for last), stderr inherited.
        let child_io = {
            let me = interp.as_pipeline(this);
            let pipes = me.pipes.as_ref().expect("pipes set above");
            let stdin = if i == 0 {
                me.io.stdin.clone()
            } else {
                InKind::Fd(IOReader::init(pipes[i - 1][0], evtloop))
            };
            let stdout = if i == n - 1 {
                me.io.stdout.clone()
            } else {
                OutKind::Fd(crate::shell::io::OutFd {
                    writer: IOWriter::init(
                        pipes[i][1],
                        io_writer::Flags { pollable: true, ..Default::default() },
                        evtloop,
                    ),
                    captured: None,
                })
            };
            IO { stdin, stdout, stderr: me.io.stderr.clone() }
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
                interp.throw(&ShellErr::new_sys(e));
                return Yield::failed();
            }
        };

        let child = match items[i] {
            ast::PipelineItem::Cmd(c) => Cmd::init(interp, duped, c, this, child_io),
            ast::PipelineItem::Assigns(a) => {
                Assigns::init(interp, duped, a, this, AssignCtx::Shell, child_io)
            }
            ast::PipelineItem::Subshell(s) => {
                Subshell::init(interp, duped, s, this, child_io)
            }
            ast::PipelineItem::If(f) => If::init(interp, duped, f, this, child_io),
            ast::PipelineItem::CondExpr(c) => {
                CondExpr::init(interp, duped, c, this, child_io)
            }
        };
        interp.as_pipeline_mut(this).cmds.as_mut().unwrap()[i] = CmdOrResult::Cmd(child);
        interp.as_pipeline_mut(this).state = PipelineState::StartingCmds { idx: idx + 1 };

        // Spawn exactly this one child. The trampoline will re-enter us via
        // `drain_pipelines` to spawn `cmds[idx+1]` after this one yields.
        interp.start_node(child)
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        log!("Pipeline {} childDone (child={} exit={})", this, child, exit_code);
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
            let exit = interp
                .as_pipeline(this)
                .cmds
                .as_ref()
                .and_then(|c| c.last())
                .map(|r| match r {
                    CmdOrResult::Result(e) => *e,
                    CmdOrResult::Cmd(_) => 0,
                })
                .unwrap_or(0);
            interp.as_pipeline_mut(this).state = PipelineState::Done { exit_code: exit };
            return Yield::Next(this);
        }
        let _ = n;
        Yield::suspended()
    }

    /// Free the per-child env duped in `next_starting` for child kinds that
    /// don't free `base.shell` themselves (spec: Pipeline.zig childDone()).
    fn deinit_child_duped_env(interp: &mut Interpreter, child: NodeId) {
        let kind = interp.node(child).kind();
        if matches!(kind, StateKind::Cmd | StateKind::IfClause | StateKind::Condexpr) {
            if let Some(base) = interp.node_mut(child).base_mut() {
                let shell = core::mem::replace(&mut base.shell, core::ptr::null_mut());
                if !shell.is_null() {
                    ShellExecEnv::deinit_impl(shell);
                }
            }
        }
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Pipeline.zig (388 lines)
//   confidence: medium (NodeId conversion; pipe-setup + dupe wired)
//   blocked_on: IOWriter/IOReader async write/read body (bun_io::Buffered*)
// ──────────────────────────────────────────────────────────────────────────

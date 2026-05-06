use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, Pipe, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

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
        // The full body (~250 lines) sets up N-1 pipes via `bun_sys::pipe()`,
        // dupes the shell env per child, spawns each Cmd/If/CondExpr/Subshell
        // with its stdin/stdout wired to the right pipe ends, and on Done
        // bubbles the last child's exit code to the parent.
        //
        // Gated until: ast::Pipeline::items, ShellExecEnv::dupe_for_subshell,
        // bun_sys::pipe(), IOReader/IOWriter::init.
        #[cfg(any())]
        {
            include!("Pipeline_next_body.rs");
        }
        match interp.as_pipeline(this).state {
            PipelineState::Done { exit_code } => {
                let parent = interp.as_pipeline(this).base.parent;
                interp.child_done(parent, this, exit_code)
            }
            _ => Yield::suspended(),
        }
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

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("Pipeline {} deinit", this);
        // Deinit any still-live children.
        let cmds = interp.as_pipeline_mut(this).cmds.take();
        if let Some(cmds) = cmds {
            for c in cmds.into_vec() {
                if let CmdOrResult::Cmd(id) = c {
                    interp.deinit_node(id);
                }
            }
        }
        let me = interp.as_pipeline_mut(this);
        // TODO(b2-blocked): close any remaining pipe fds via closefd().
        me.pipes = None;
        // TODO(b2-blocked): ShellExecEnv::deinit_impl on duped envs.
        me.base.end_scope();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Pipeline.zig (388 lines)
//   confidence: medium (NodeId conversion; pipe-setup body gated)
//   blocked_on: ast::Pipeline::items, bun_sys::pipe, IOReader/IOWriter::init,
//               ShellExecEnv::dupe_for_subshell
// ──────────────────────────────────────────────────────────────────────────

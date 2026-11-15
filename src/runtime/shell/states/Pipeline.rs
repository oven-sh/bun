use bun_sys::File;

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::builtin::IoKind;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnvId, ShellExecEnvKind, log};
use crate::shell::io::{IO, OutFd, OutKind};
use crate::shell::io_reader::{IOReader, IOReaderId};
use crate::shell::io_writer::{self, IOWriter, IOWriterId};
use crate::shell::states::base::{Base, Env};
use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::r#if::If;
use crate::shell::states::subshell::Subshell;
use crate::shell::yield_::Yield;

pub(crate) struct Pipeline<'a> {
    pub(crate) base: Base,
    shell: ShellExecEnvId,
    pub node: &'a ast::Pipeline<'a>,
    pub(crate) io: IO,
    pub(crate) exited_count: u32,
    /// `None` until `setup_commands` has inited every child.
    pub(crate) cmds: Option<Box<[CmdOrResult]>>,
    pub(crate) state: PipelineState,
}

pub(crate) enum CmdOrResult {
    Cmd { id: NodeId, pipe_ends: PipeEnds },
    Result(ExitCode),
}

impl CmdOrResult {
    fn deinit(self, interp: &mut Interpreter<'_>) {
        if let CmdOrResult::Cmd { id, pipe_ends } = self {
            // The node first: a builtin's redirection fd is closed by the time a reader of the pipe sees EOF.
            interp.deinit_node(id);
            pipe_ends.deinit(interp);
        }
    }
}

pub(crate) struct PipeEnds {
    stdin: Option<IOReaderId>,
    stdout: Option<IOWriterId>,
}

impl PipeEnds {
    fn deinit(self, interp: &mut Interpreter<'_>) {
        if let Some(stdin) = self.stdin {
            interp.io_readers.remove(stdin);
        }
        if let Some(stdout) = self.stdout {
            interp.io_writers.remove(stdout);
        }
    }
}

pub(crate) enum PipelineState {
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

impl<'a> Pipeline<'a> {
    pub(crate) fn init(
        interp: &mut Interpreter<'a>,
        shell: ShellExecEnvId,
        node: &'a ast::Pipeline<'a>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Pipeline(Pipeline {
            base: Base::new(parent),
            shell,
            node,
            io,
            exited_count: 0,
            cmds: None,
            state: PipelineState::default(),
        }))
    }

    pub(crate) fn start(_interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    /// Queried by the trampoline (`Yield::run`) to manage its `DeferredStack`.
    #[inline]
    pub(crate) fn is_done(interp: &Interpreter<'a>, this: NodeId) -> bool {
        matches!(interp.as_pipeline(this).state, PipelineState::Done { .. })
    }

    #[inline]
    pub(crate) fn is_starting_cmds(interp: &Interpreter<'a>, this: NodeId) -> bool {
        matches!(
            interp.as_pipeline(this).state,
            PipelineState::StartingCmds { .. }
        )
    }

    pub(crate) fn next(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        match interp.as_pipeline(this).state {
            PipelineState::StartingCmds { idx } => Self::next_starting(interp, this, idx),
            PipelineState::Pending | PipelineState::WaitingWriteErr => Yield::suspended(),
            PipelineState::Done { exit_code } => {
                let parent = interp.as_pipeline(this).base.parent;
                interp.child_done(parent, this, exit_code)
            }
        }
    }

    /// Starts ONE child per call; `drain_deferred` (Yield.rs) re-enters
    /// `Pipeline::next` for the next one once the current child suspends.
    fn next_starting(interp: &mut Interpreter<'a>, this: NodeId, idx: u32) -> Yield {
        if interp.failed() {
            // A nested pipeline's member failed while this one was still starting.
            if interp.as_pipeline(this).cmds.is_none() {
                return Self::finish(interp, this, 1);
            }
            Self::release_unstarted(interp, this);
            return Self::finish_if_all_exited(interp, this);
        }
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
                CmdOrResult::Cmd { id, .. } => *id,
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
    fn setup_commands(interp: &mut Interpreter<'a>, this: NodeId) -> Option<Yield> {
        let (items, parent_shell, io) = {
            let me = interp.as_pipeline(this);
            (me.node.items, me.shell, me.io)
        };
        let cmd_count = items
            .iter()
            .filter(|it| !matches!(it, ast::PipelineItem::Assigns(_)))
            .count();

        if cmd_count == 0 {
            // An empty pipeline finishes with 0.
            return Some(Self::finish(interp, this, 0));
        }

        let mut pipes: Vec<[File; 2]> = Vec::with_capacity(cmd_count - 1);
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
                Ok(p) => pipes.push(p.map(File::from_fd)),
                Err(e) => {
                    drop(pipes);
                    let sys_err = e.to_shell_system_error();
                    return Some(Self::write_failing_error(
                        interp,
                        this,
                        format_args!("bun: {}\n", sys_err.message),
                    ));
                }
            }
        }

        let mut pipes = pipes.into_iter();
        let mut read_end: Option<File> = None;
        let mut cmds: Vec<CmdOrResult> = Vec::with_capacity(cmd_count);
        for item in items {
            if matches!(item, ast::PipelineItem::Assigns(_)) {
                continue;
            }
            let pipe_ends = PipeEnds {
                stdin: read_end
                    .take()
                    .map(|read| IOReader::init(interp, read.into_raw())),
                stdout: pipes.next().map(|[read, write]| {
                    read_end = Some(read);
                    // `is_socket` is set on POSIX — the POSIX
                    // pipe is actually a socketpair end (see above).
                    IOWriter::init(
                        interp,
                        write.into_raw(),
                        io_writer::Flags {
                            pollable: true,
                            is_socket: cfg!(unix),
                            ..Default::default()
                        },
                    )
                }),
            };
            let child_io = IO {
                stdin: pipe_ends.stdin.unwrap_or(io.stdin),
                stdout: pipe_ends.stdout.map_or(io.stdout, |writer| {
                    OutKind::Fd(OutFd {
                        writer,
                        captured: None,
                    })
                }),
                stderr: io.stderr,
            };

            // Each pipeline child gets its own duped env (var assignments
            // inside a pipeline must not leak to siblings or the parent).
            let env = match interp.shells.dupe_for_subshell(
                parent_shell,
                child_io,
                ShellExecEnvKind::Pipeline,
            ) {
                Ok(d) => d,
                Err(e) => {
                    pipe_ends.deinit(interp);
                    drop((read_end, pipes));
                    interp.as_pipeline_mut(this).cmds = Some(cmds.into_boxed_slice());
                    let sys_err = e.to_shell_system_error();
                    return Some(Self::write_failing_error(
                        interp,
                        this,
                        format_args!("bun: {}\n", sys_err.message),
                    ));
                }
            };

            let id = match *item {
                ast::PipelineItem::Cmd(c) => Cmd::init(interp, Env::Owned(env), c, this, child_io),
                ast::PipelineItem::Subshell(s) => Subshell::init(interp, env, s, this, child_io),
                ast::PipelineItem::If(f) => If::init(interp, Env::Owned(env), f, this, child_io),
                ast::PipelineItem::CondExpr(c) => {
                    CondExpr::init(interp, Env::Owned(env), c, this, child_io)
                }
                ast::PipelineItem::Assigns(_) => unreachable!("skipped above"),
            };
            cmds.push(CmdOrResult::Cmd { id, pipe_ends });
        }
        interp.as_pipeline_mut(this).cmds = Some(cmds.into_boxed_slice());
        None
    }

    /// Mark the pipeline done with `exit_code`. Returns `Next(this)` so the
    /// trampoline sees `is_done`, removes us from its `DeferredStack`, and
    /// `next()` reports to the parent. Calling `child_done(parent, ..)`
    /// directly would free this node while it is still on that stack.
    fn finish(interp: &mut Interpreter<'a>, this: NodeId, exit_code: ExitCode) -> Yield {
        interp.as_pipeline_mut(this).state = PipelineState::Done { exit_code };
        Yield::Next(this)
    }

    /// Same shape as `Builtin::cmd_write_failing_error`: `.fd` stderr
    /// enqueues an async write and parks in `WaitingWriteErr` (resumed by
    /// `on_io_writer_chunk`); otherwise append to the captured stderr buffer
    /// and finish with exit 1.
    fn write_failing_error(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        if let OutKind::Fd(fd) = interp.as_pipeline(this).io.stderr {
            // Only the fd arm transitions state.
            interp.as_pipeline_mut(this).state = PipelineState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(this, io_writer::WriterTag::Pipeline);
            return interp.enqueue(fd, child, &buf);
        }
        let shell = interp.as_pipeline(this).shell;
        interp
            .shells
            .buffered_mut(shell, IoKind::Stderr)
            .extend_from_slice(&buf);
        Self::finish(interp, this, 1)
    }

    /// IOWriter completion callback for the error message written in
    /// `WaitingWriteErr`. The pipeline finishes with exit code 1 whether or
    /// not the write succeeded: the parent always needs a completion, and a
    /// failed stderr write has nowhere else to be reported.
    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'a>,
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
        interp: &mut Interpreter<'a>,
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
        Self::record_result_and_deinit(interp, this, child, exit_code);
        if interp.failed() {
            Self::release_unstarted(interp, this);
        }
        Self::finish_if_all_exited(interp, this)
    }

    /// `Done` once every member reported, else keep waiting for the rest.
    fn finish_if_all_exited(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        let me = interp.as_pipeline(this);
        let Some(cmds) = me.cmds.as_deref() else {
            return Yield::suspended();
        };
        if cmds.is_empty() || (me.exited_count as usize) < cmds.len() {
            return Yield::suspended();
        }
        // Exit code = last command's exit code (bash semantics).
        // For a single-runnable pipeline `last_exit_code` stays 0: only
        // inspect `cmds[len-1]` when `len >= 2`.
        let exit = if cmds.len() >= 2 {
            match cmds.last() {
                Some(CmdOrResult::Result(e)) => *e,
                _ => 0,
            }
        } else {
            0
        };
        interp.as_pipeline_mut(this).state = PipelineState::Done { exit_code: exit };
        Yield::Next(this)
    }

    fn record_result_and_deinit(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) {
        let me = interp.as_pipeline_mut(this);
        me.exited_count += 1;
        let slot = me
            .cmds
            .iter_mut()
            .flatten()
            .find(|slot| matches!(slot, CmdOrResult::Cmd { id, .. } if *id == child))
            .expect("a child is in cmds");
        core::mem::replace(slot, CmdOrResult::Result(exit_code)).deinit(interp);
    }

    /// The script failed: free the members that never started so their pipe ends close.
    fn release_unstarted(interp: &mut Interpreter<'a>, this: NodeId) {
        let PipelineState::StartingCmds { idx } = interp.as_pipeline(this).state else {
            return;
        };
        let unstarted: Vec<NodeId> = interp
            .as_pipeline(this)
            .cmds
            .as_deref()
            .map(|cmds| {
                cmds.iter()
                    .skip(idx as usize)
                    .filter_map(|slot| match slot {
                        CmdOrResult::Cmd { id, .. } => Some(*id),
                        CmdOrResult::Result(_) => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        for child in unstarted {
            log!("Pipeline {} release unstarted child {}", this, child);
            Self::record_result_and_deinit(interp, this, child, 1);
        }
        interp.as_pipeline_mut(this).state = PipelineState::Pending;
    }

    pub(crate) fn deinit(interp: &mut Interpreter<'a>, this: NodeId) {
        log!("Pipeline {} deinit", this);
        // Only children that never started (setup failed) are still here.
        let cmds = interp.as_pipeline_mut(this).cmds.take();
        if let Some(cmds) = cmds {
            for c in cmds.into_vec() {
                c.deinit(interp);
            }
        }
    }
}

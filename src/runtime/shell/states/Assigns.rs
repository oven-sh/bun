//! In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
//! no effect on the environment of the shell, so we can skip them.

use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, log};
use crate::shell::io::{IO, OutKind};
use crate::shell::io_writer;
use crate::shell::states::base::Base;
use crate::shell::states::expansion::Expansion;
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, ExitCode, ShellErr};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AssignCtx {
    Cmd,
    Shell,
}

pub struct Assigns {
    pub(crate) base: Base,
    /// Points into the AST arena, which outlives every state node — `RawSlice`
    /// invariant.
    pub node: bun_ptr::RawSlice<ast::Assign>,
    pub(crate) state: AssignsState,
    pub ctx: AssignCtx,
    /// Only `stderr` is written to: an expansion error in a value is reported
    /// the same way `Cmd` reports one in an argv word.
    pub(crate) io: IO,
}

#[derive(Default)]
pub enum AssignsState {
    #[default]
    Idle,
    Expanding {
        idx: u32,
    },
    /// An expansion error is being written to stderr; `on_io_writer_chunk`
    /// finishes the node with exit 1.
    WaitingWriteErr,
    Done,
}

impl Assigns {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &[ast::Assign],
        parent: NodeId,
        ctx: AssignCtx,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Assigns(Assigns {
            base: Base::new(parent, shell),
            // AST arena outlives every state node — `RawSlice` invariant.
            node: bun_ptr::RawSlice::new(node),
            state: AssignsState::Idle,
            ctx,
            io,
        }))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        loop {
            let (shell, node) = {
                let me = interp.as_assigns(this);
                (me.base.shell, me.node)
            };
            let assigns = node.slice();
            match interp.as_assigns(this).state {
                AssignsState::Idle => {
                    interp.as_assigns_mut(this).state = AssignsState::Expanding { idx: 0 };
                    continue;
                }
                AssignsState::Expanding { idx } => {
                    if (idx as usize) >= assigns.len() {
                        interp.as_assigns_mut(this).state = AssignsState::Done;
                        continue;
                    }
                    let atom: *const ast::Atom = &raw const assigns[idx as usize].value;
                    let child = Expansion::init(interp, shell, atom, this);
                    return Expansion::start(interp, child);
                }
                AssignsState::WaitingWriteErr => return Yield::suspended(),
                AssignsState::Done => {
                    let parent = interp.as_assigns(this).base.parent;
                    return interp.child_done(parent, this, 0);
                }
            }
        }
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is always an Expansion.
        if exit_code != 0 {
            let err = Expansion::take_err(interp, child);
            interp.deinit_node(child);
            return Self::fail(interp, this, err);
        }

        let out = Expansion::take_out(interp, child);
        interp.deinit_node(child);

        let (node, ctx) = {
            let me = interp.as_assigns(this);
            (me.node, me.ctx)
        };
        let AssignsState::Expanding { idx } = &mut interp.as_assigns_mut(this).state else {
            unreachable!("Assigns child_done outside Expanding")
        };
        // `idx` was bounds-checked in `next` before spawning the child.
        let label = node.slice()[*idx as usize].label;
        *idx += 1;

        // Join multi-word expansions with a single space. `ExpansionOut` stores all words contiguously in `buf`
        // with `bounds` marking inter-word offsets, so the merged value is
        // `buf` with a space inserted at each boundary.
        let value: Vec<u8> = if out.bounds.is_empty() {
            out.buf
        } else {
            let mut merged = Vec::with_capacity(out.buf.len() + out.bounds.len());
            let mut prev = 0usize;
            for &b in &out.bounds {
                merged.extend_from_slice(&out.buf[prev..b as usize]);
                merged.push(b' ');
                prev = b as usize;
            }
            merged.extend_from_slice(&out.buf[prev..]);
            merged
        };

        let value_ref = EnvStr::init_ref_counted(value.into_boxed_slice());
        interp.as_assigns_mut(this).base.shell_mut().assign_var(
            EnvStr::init_slice(label),
            value_ref,
            ctx,
        );
        value_ref.deref();

        Yield::Next(this)
    }

    /// A value failed to expand: report it on stderr and finish with exit 1.
    /// Assignments before the failing one have already been applied, as in
    /// bash; the ones after it are skipped.
    fn fail(interp: &Interpreter, this: NodeId, err: Option<ShellErr>) -> Yield {
        let Some(err) = err else {
            debug_assert!(false, "Expansion child failed without an error");
            return Self::finish_failed(interp, this);
        };
        let msg = format!("{err}\n");
        // Same shape as `Builtin::cmd_write_failing_error`: an fd-backed
        // stderr takes an async write and parks in `WaitingWriteErr`; a
        // captured one is appended to synchronously. The clone ends the borrow
        // of the node before its state is written.
        match interp.as_assigns(this).io.stderr.clone() {
            OutKind::Fd(fd) => {
                interp.as_assigns_mut(this).state = AssignsState::WaitingWriteErr;
                let child = io_writer::ChildPtr::new(this, io_writer::WriterTag::Assigns);
                fd.writer.enqueue(child, fd.captured, msg.as_bytes())
            }
            OutKind::Pipe => {
                // SAFETY: single trampoline frame; no other borrow of the env's
                // (or its parent's) stderr buffer is live.
                let stderr = unsafe {
                    interp
                        .as_assigns_mut(this)
                        .base
                        .shell_mut()
                        .buffered_stderr_mut()
                };
                stderr.extend_from_slice(msg.as_bytes());
                Self::finish_failed(interp, this)
            }
            OutKind::Ignore => Self::finish_failed(interp, this),
        }
    }

    /// IOWriter completion callback for the message written by [`Self::fail`]:
    /// throw on write failure, otherwise finish with exit 1.
    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(err) = err {
            interp.throw(ShellErr::from_system(err));
            return Yield::failed();
        }
        debug_assert!(matches!(
            interp.as_assigns(this).state,
            AssignsState::WaitingWriteErr
        ));
        Self::finish_failed(interp, this)
    }

    fn finish_failed(interp: &Interpreter, this: NodeId) -> Yield {
        let parent = interp.as_assigns(this).base.parent;
        interp.child_done(parent, this, 1)
    }

    pub(crate) fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Assigns {} deinit", this);
        interp.as_assigns_mut(this).base.end_scope();
    }
}

//! https://www.gnu.org/software/bash/manual/bash.html#Bash-Conditional-Expressions

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::expansion::{Expansion, ExpansionOpts};
use crate::shell::yield_::Yield;

pub struct CondExpr {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::CondExpr>,
    pub io: IO,
    pub state: CondExprState,
    pub args: Vec<Vec<u8>>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum CondExprState {
    #[default]
    Idle,
    ExpandingArgs {
        idx: u32,
    },
    WaitingStat,
    WaitingWriteErr,
    Done,
}

impl CondExpr {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::CondExpr,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::CondExpr(CondExpr {
            base: Base::new(StateKind::Condexpr, parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: CondExprState::Idle,
            args: Vec::new(),
        }))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        // Expand each arg via Expansion, then evaluate the operator.
        loop {
            let (shell, node) = {
                let me = interp.as_condexpr(this);
                (me.base.shell, me.node)
            };
            let n = node.get();
            match interp.as_condexpr(this).state {
                CondExprState::Idle => {
                    interp.as_condexpr_mut(this).state = CondExprState::ExpandingArgs { idx: 0 };
                    continue;
                }
                CondExprState::ExpandingArgs { idx } => {
                    if (idx as usize) >= n.args.len() {
                        return Self::command_impl_start(interp, this, n.op);
                    }
                    let atom: *const ast::Atom = n.args.get_const(idx as usize);
                    let io = interp.as_condexpr(this).io.clone();
                    let child = Expansion::init(
                        interp,
                        shell,
                        atom,
                        this,
                        io,
                        ExpansionOpts {
                            for_spawn: false,
                            single: true,
                        },
                    );
                    return Expansion::start(interp, child);
                }
                CondExprState::WaitingStat => return Yield::suspended(),
                CondExprState::WaitingWriteErr => return Yield::suspended(),
                CondExprState::Done => {
                    let parent = interp.as_condexpr(this).base.parent;
                    return interp.child_done(parent, this, 0);
                }
            }
        }
    }

    /// Evaluates the operator against
    /// the expanded `args` and returns the resulting exit code.
    fn command_impl_start(interp: &Interpreter, this: NodeId, op: ast::CondExprOp) -> Yield {
        use ast::CondExprOp as Op;
        let parent = interp.as_condexpr(this).base.parent;
        match op {
            Op::DashC | Op::DashD | Op::DashF => {
                // Empty expansion or empty path → exit 1 (bash always
                // gives 1; Windows `stat("")` can succeed and return cwd's
                // stat, so the empty-path check must be explicit).
                let path_empty = {
                    let me = interp.as_condexpr(this);
                    me.args.is_empty() || me.args[0].is_empty()
                };
                if path_empty {
                    return interp.child_done(parent, this, 1);
                }
                // Post a
                // `ShellCondExprStatTask` to the thread pool; the result comes
                // back on the main thread via `on_stat_task_done`.
                let (cwd_fd, mut path) = {
                    let me = interp.as_condexpr(this);
                    let cwd_fd = me.base.shell().cwd_fd;
                    (cwd_fd, me.args[0].clone())
                };
                if path.last() != Some(&0) {
                    path.push(0);
                }
                interp.as_condexpr_mut(this).state = CondExprState::WaitingStat;
                Self::do_stat(interp, this, cwd_fd, path)
            }
            Op::DashZ => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    if me.args.is_empty() || me.args[0].is_empty() {
                        0
                    } else {
                        1
                    }
                };
                interp.child_done(parent, this, exit)
            }
            Op::DashN => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    if !me.args.is_empty() && !me.args[0].is_empty() {
                        0
                    } else {
                        1
                    }
                };
                interp.child_done(parent, this, exit)
            }
            Op::EqEq => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    let is_eq =
                        me.args.is_empty() || (me.args.len() >= 2 && me.args[0] == me.args[1]);
                    if is_eq { 0 } else { 1 }
                };
                interp.child_done(parent, this, exit)
            }
            Op::NotEq => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    let is_neq = me.args.len() >= 2 && me.args[0] != me.args[1];
                    if is_neq { 0 } else { 1 }
                };
                interp.child_done(parent, this, exit)
            }
            _ => {
                debug_assert!(
                    !ast::CondExprOp::is_supported(op),
                    "supported CondExprOp not handled in command_impl_start"
                );
                // Unsupported op is unreachable (parser rejects it).
                interp.child_done(parent, this, 1)
            }
        }
    }

    /// IOWriter completion callback for the error message written in
    /// `WaitingWriteErr`: on write failure finish with the errno as the exit
    /// code, otherwise finish with exit code 1.
    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        let parent = interp.as_condexpr(this).base.parent;
        if let Some(e) = err {
            // Recover the positive errno (`to_shell_system_error` negated it).
            let exit_code: ExitCode = e.errno.unsigned_abs() as ExitCode;
            e.deref();
            return interp.child_done(parent, this, exit_code);
        }
        if matches!(
            interp.as_condexpr(this).state,
            CondExprState::WaitingWriteErr
        ) {
            return interp.child_done(parent, this, 1);
        }
        crate::shell::interpreter::unreachable_state(
            "CondExpr.onIOWriterChunk",
            <&'static str>::from(&interp.as_condexpr(this).state),
        )
    }

    /// Main-thread re-entry for the
    /// off-thread `stat`/`lstat` posted by a unary file-test operator.
    pub(crate) fn on_stat_task_done(
        interp: &Interpreter,
        this: NodeId,
        stat: &bun_sys::Result<bun_sys::Stat>,
        path: &[u8],
    ) {
        // Evaluate `op` against the stat result.
        let _ = path;
        debug_assert!(matches!(
            interp.as_condexpr(this).state,
            CondExprState::WaitingStat
        ));
        let op = interp.as_condexpr(this).node.op;
        let exit = match stat {
            Err(_) => 1,
            Ok(st) => {
                let mode = st.st_mode as _;
                let ok = match op {
                    ast::CondExprOp::DashF => bun_sys::S::ISREG(mode),
                    ast::CondExprOp::DashD => bun_sys::S::ISDIR(mode),
                    ast::CondExprOp::DashC => bun_sys::S::ISCHR(mode),
                    _ => {
                        unreachable!("CondExprOp does not need stat(); this indicates a bug in Bun")
                    }
                };
                if ok { 0 } else { 1 }
            }
        };
        let parent = interp.as_condexpr(this).base.parent;
        interp.child_done(parent, this, exit).run(interp);
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is always an Expansion that produced one arg.
        // On nonzero exit, write the failing error and finish; otherwise
        // collect the expanded word and advance.
        if exit_code != 0 {
            // Pull the expansion error out before deiniting the child, then
            // write the failing error.
            let err = Expansion::take_err(interp, child);
            interp.deinit_node(child);
            if let Some(err) = err {
                let y = Self::write_failing_error(interp, this, format_args!("{}\n", err));
                err.deinit();
                return y;
            }
            // Defensive fallback — finish via `writeFailingError` with exit 1.
            debug_assert!(false, "Expansion child failed without an error");
            let parent = interp.as_condexpr(this).base.parent;
            return interp.child_done(parent, this, 1);
        }
        let out = Expansion::take_out(interp, child);
        interp.deinit_node(child);
        {
            let me = interp.as_condexpr_mut(this);
            me.args.push(out.buf);
            if let CondExprState::ExpandingArgs { ref mut idx } = me.state {
                *idx += 1;
            }
        }
        Yield::Next(this)
    }

    /// Heap-allocate a `ShellCondExprStatTask`
    /// and hand it to the work pool; `run_from_thread_pool` performs the
    /// `statat`, then the main thread resumes via
    /// `ShellCondExprStatTask::run_from_main_thread` → `on_stat_task_done`.
    /// `path` is NUL-terminated by the caller.
    fn do_stat(interp: &Interpreter, this: NodeId, cwd_fd: bun_sys::Fd, path: Vec<u8>) -> Yield {
        use crate::shell::dispatch_tasks::{CondExprStatInner, ShellCondExprStatTask};
        use crate::shell::interpreter::ShellTask;
        debug_assert!(path.last() == Some(&0));
        let mut task = ShellTask::new(interp.event_loop);
        task.interp = interp.as_ctx_ptr();
        let stat_task = bun_core::heap::alloc(ShellCondExprStatTask {
            task: CondExprStatInner {
                task,
                cond: this,
                // Placeholder — always overwritten by `run_from_thread_pool`
                // before the main thread reads it.
                stat: Err(Default::default()),
                path,
                cwd_fd,
            },
        });
        // SAFETY: `stat_task` is a fresh heap allocation embedding `ShellTask`
        // at `TASK_OFFSET`; consumed (heap::take) in
        // `ShellCondExprStatTask::run_from_main_thread`.
        unsafe { ShellTask::schedule::<ShellCondExprStatTask>(stat_task) };
        Yield::suspended()
    }

    /// Same shape as `Builtin::cmd_write_failing_error`: `.fd` stderr
    /// enqueues an async
    /// write and parks in `WaitingWriteErr` (resumed by
    /// `on_io_writer_chunk`); otherwise append to the captured stderr buffer
    /// and finish with exit 1.
    fn write_failing_error(
        interp: &Interpreter,
        this: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use crate::shell::io::OutKind;
        use crate::shell::io_writer;
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        if interp.as_condexpr(this).io.stderr.needs_io().is_some() {
            // Only the fd arm transitions state.
            interp.as_condexpr_mut(this).state = CondExprState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(this, io_writer::WriterTag::CondExpr);
            // `OutKind::Fd` guaranteed by `needs_io()`.
            if let OutKind::Fd(fd) = &interp.as_condexpr(this).io.stderr {
                return fd.writer.enqueue(child, fd.captured, &buf);
            }
            unreachable!()
        }
        // No-IO path: append to the shell env's captured stderr and finish
        // synchronously with exit 1 (matches `on_io_writer_chunk`).
        if let OutKind::Pipe = &interp.as_condexpr(this).io.stderr {
            // SAFETY: single trampoline frame; no other borrow of the env's
            // (or its parent's) stderr buffer is live.
            let stderr = unsafe {
                interp
                    .as_condexpr_mut(this)
                    .base
                    .shell_mut()
                    .buffered_stderr_mut()
            };
            stderr.extend_from_slice(&buf);
        }
        let parent = interp.as_condexpr(this).base.parent;
        interp.child_done(parent, this, 1)
    }

    pub(crate) fn deinit(interp: &Interpreter, this: NodeId) {
        log!("CondExpr {} deinit", this);
        let me = interp.as_condexpr_mut(this);
        me.args.clear();
        me.base.end_scope();
    }
}

// `runtime::dispatch::run_task`'s `task_tag::ShellCondExprStatTask` arm casts
// the enqueued pointer back to `ShellCondExprStatTask`; both sides MUST agree.
impl bun_event_loop::Taskable for crate::shell::dispatch_tasks::ShellCondExprStatTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellCondExprStatTask;
}

impl crate::shell::interpreter::ShellTaskCtx
    for crate::shell::dispatch_tasks::ShellCondExprStatTask
{
    // The `ShellTask` is embedded one level down (`.task.task`); the dispatch
    // arm (`shell_dispatch!(nested ...)`) walks the same two hops.
    const TASK_OFFSET: usize =
        core::mem::offset_of!(crate::shell::dispatch_tasks::ShellCondExprStatTask, task)
            + core::mem::offset_of!(crate::shell::dispatch_tasks::CondExprStatInner, task);

    fn run_from_thread_pool(this: &mut Self) {
        let inner = &mut this.task;
        debug_assert!(inner.path.last() == Some(&0));
        let z = bun_core::ZStr::from_buf(&inner.path, inner.path.len() - 1);
        inner.stat = crate::shell::interpreter::shell_statat(inner.cwd_fd, z);
    }

    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // Delegates to the inherent fn in `dispatch_tasks.rs` (which consumes
        // the heap allocation). The dispatch arm calls the inherent fn
        // directly; this trait method exists to satisfy `ShellTaskCtx`.
        crate::shell::dispatch_tasks::ShellCondExprStatTask::run_from_main_thread(this, interp);
    }
}

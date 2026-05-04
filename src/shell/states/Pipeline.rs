use core::fmt;

use bun_collections::TaggedPtrUnion;
use bun_jsc::{self as jsc, EventLoopHandle, SystemError};
use bun_shell as shell;
use bun_shell::ast;
use bun_shell::interpret::{closefd, Pipe, StatePtrUnion};
use bun_shell::interpreter::{
    Assigns, Async, Binary, Cmd, CondExpr, If, IOReader, IOWriter, Interpreter, ShellExecEnv,
    State, StateKind, Stmt, Subshell, IO,
};
use bun_shell::{ExitCode, ShellErr, Yield};
use bun_sys::{self, Result as Maybe};

bun_output::declare_scope!(SHELL, hidden);
// `log` in the Zig source is `bun.shell.interpret.log`; reuse the same scope here.
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(SHELL, $($arg)*) };
}

pub struct Pipeline<'a> {
    pub base: State,
    pub node: &'a ast::Pipeline,
    /// Based on precedence rules pipeline can only be child of a stmt or
    /// binary
    ///
    /// *WARNING*: Do not directly call `this.parent.childDone`, it should
    ///            be handed in `Pipeline.next()`
    pub parent: ParentPtr,
    pub exited_count: u32,
    pub cmds: Option<Box<[CmdOrResult]>>,
    pub pipes: Option<Box<[Pipe]>>,
    pub io: IO,
    pub state: PipelineState,
}

pub enum PipelineState {
    StartingCmds { idx: u32 },
    Pending,
    WaitingWriteErr,
    Done { exit_code: ExitCode },
}

impl Default for PipelineState {
    // Zig default: `.{ .starting_cmds = .{ .idx = 0 } }`
    fn default() -> Self {
        Self::StartingCmds { idx: 0 }
    }
}

pub type ParentPtr = StatePtrUnion<(Stmt, Binary, Async)>;

pub type ChildPtr = StatePtrUnion<(Cmd, Assigns, If, CondExpr, Subshell)>;

type PipelineItem = TaggedPtrUnion<(Cmd, If, CondExpr, Subshell)>;

pub enum CmdOrResult {
    Cmd(PipelineItem),
    Result(ExitCode),
}

impl<'a> Pipeline<'a> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Pipeline,
        parent: ParentPtr,
        io: IO,
    ) -> *mut Pipeline<'a> {
        // TODO(port): in-place init — `parent.create::<Pipeline>()` allocates from the
        // parent's arena/pool and returns an uninitialized slot.
        let pipeline: *mut Pipeline<'a> = parent.create::<Pipeline<'a>>();
        // SAFETY: `parent.create` returns a freshly allocated, uninitialized slot for
        // exactly one `Pipeline`; we fully initialize it before returning.
        unsafe {
            pipeline.write(Pipeline {
                base: State::init_with_new_alloc_scope(StateKind::Pipeline, interpreter, shell_state),
                node,
                parent,
                exited_count: 0,
                cmds: None,
                pipes: None,
                io,
                state: PipelineState::StartingCmds { idx: 0 },
            });
        }
        pipeline
    }

    fn get_io(&self) -> IO {
        self.io
    }

    fn write_failing_error(&mut self, args: fmt::Arguments<'_>) -> Yield {
        fn enqueue_cb(ctx: &mut Pipeline<'_>) {
            ctx.state = PipelineState::WaitingWriteErr;
        }
        // TODO(port): `writeFailingErrorFmt` took `comptime fmt + anytype args` in Zig;
        // in Rust we pass a pre-built `fmt::Arguments`.
        self.base.shell.write_failing_error_fmt(self, enqueue_cb, args)
    }

    fn setup_commands(&mut self) -> Option<Yield> {
        let cmd_count: u32 = {
            let mut i: u32 = 0;
            for item in self.node.items.iter() {
                if match item {
                    ast::PipelineItem::Assigns(_) => false,
                    _ => true,
                } {
                    i += 1;
                }
            }
            i
        };

        self.cmds = if cmd_count >= 1 {
            // PERF(port): was arena alloc via `this.base.allocator()` — profile in Phase B
            Some(
                (0..cmd_count)
                    .map(|_| CmdOrResult::Result(0))
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
            )
        } else {
            None
        };
        if self.cmds.is_none() {
            return None;
        }
        // Pre-fill so a mid-loop failure leaves cmds[i..] in a state deinit() can skip safely.
        // (Done above during construction — Rust requires initialized elements.)

        // PERF(port): was arena alloc via `this.base.allocator()` — profile in Phase B
        let pipes_len = if cmd_count > 1 { cmd_count - 1 } else { 1 } as usize;
        let mut pipes: Box<[Pipe]> = vec![Pipe::default(); pipes_len].into_boxed_slice();
        // PORT NOTE: reshaped for borrowck — Zig stored `this.pipes = pipes` here and kept
        // using the local `pipes` slice. We keep ownership in the local until the end of
        // the function, then move into `self.pipes`.

        if cmd_count > 1 {
            let mut pipes_set: u32 = 0;
            if let Err(err) = Pipeline::initialize_pipes(&mut pipes, &mut pipes_set) {
                for pipe in &pipes[0..pipes_set as usize] {
                    closefd(pipe[0]);
                    closefd(pipe[1]);
                }
                let system_err = err.to_shell_system_error();
                // `defer system_err.deref()` — handled by Drop.
                self.pipes = Some(pipes);
                return Some(self.write_failing_error(format_args!("bun: {}\n", system_err.message)));
            }
        }

        let mut i: u32 = 0;
        let evtloop = self.base.event_loop();
        for item in self.node.items.iter() {
            match item {
                ast::PipelineItem::If(_)
                | ast::PipelineItem::Cmd(_)
                | ast::PipelineItem::CondExpr(_)
                | ast::PipelineItem::Subshell(_) => {
                    let mut cmd_io = self.get_io();
                    let stdin = if cmd_count > 1 {
                        Pipeline::read_pipe(&mut pipes, i as usize, &mut cmd_io, evtloop)
                    } else {
                        cmd_io.stdin.r#ref()
                    };
                    let stdout = if cmd_count > 1 {
                        Pipeline::write_pipe(&mut pipes, i as usize, cmd_count as usize, &mut cmd_io, evtloop)
                    } else {
                        cmd_io.stdout.r#ref()
                    };
                    cmd_io.stdin = stdin;
                    cmd_io.stdout = stdout;
                    let _ = cmd_io.stderr.r#ref();
                    let subshell_state = match self.base.shell.dupe_for_subshell(
                        self.base.alloc_scope(),
                        self.base.allocator(),
                        cmd_io,
                        StateKind::Pipeline,
                    ) {
                        Ok(s) => s,
                        Err(err) => {
                            cmd_io.deref();
                            if cmd_count > 1 {
                                // Close pipe ends not yet wrapped in an IOReader/IOWriter; the
                                // wrapped ones are owned by cmds[0..i]/cmd_io and close on deref.
                                for p in &pipes[i as usize..] {
                                    closefd(p[0]);
                                }
                                let w_start =
                                    (i + 1).min(u32::try_from(pipes.len()).unwrap()) as usize;
                                for p in &pipes[w_start..] {
                                    closefd(p[1]);
                                }
                            }
                            let system_err = err.to_shell_system_error();
                            // `defer system_err.deref()` — handled by Drop.
                            self.pipes = Some(pipes);
                            return Some(
                                self.write_failing_error(format_args!("bun: {}\n", system_err.message)),
                            );
                        }
                    };
                    self.cmds.as_mut().unwrap()[i as usize] = CmdOrResult::Cmd(match item {
                        ast::PipelineItem::If(n) => PipelineItem::init(If::init(
                            self.base.interpreter,
                            subshell_state,
                            n,
                            If::ParentPtr::init(self),
                            cmd_io,
                        )),
                        ast::PipelineItem::Cmd(n) => PipelineItem::init(Cmd::init(
                            self.base.interpreter,
                            subshell_state,
                            n,
                            Cmd::ParentPtr::init(self),
                            cmd_io,
                        )),
                        ast::PipelineItem::CondExpr(n) => PipelineItem::init(CondExpr::init(
                            self.base.interpreter,
                            subshell_state,
                            n,
                            CondExpr::ParentPtr::init(self),
                            cmd_io,
                        )),
                        ast::PipelineItem::Subshell(n) => PipelineItem::init(Subshell::init(
                            self.base.interpreter,
                            subshell_state,
                            n,
                            Subshell::ParentPtr::init(self),
                            cmd_io,
                        )),
                        _ => unreachable!(
                            "Pipeline runnable should be a command or an if conditional, this appears to be a bug in Bun."
                        ),
                    });
                    i += 1;
                }
                // in a pipeline assignments have no effect
                ast::PipelineItem::Assigns(_) => {}
            }
        }

        self.pipes = Some(pipes);
        None
    }

    pub fn start(&mut self) -> Yield {
        if let Some(yield_) = self.setup_commands() {
            return yield_;
        }
        if matches!(self.state, PipelineState::WaitingWriteErr | PipelineState::Done { .. }) {
            return Yield::Suspended;
        }
        if self.cmds.is_none() {
            self.state = PipelineState::Done { exit_code: 0 };
            return Yield::Done;
        }

        debug_assert!(self.exited_count == 0);

        log!(
            "pipeline start {:x} (count={})",
            self as *const _ as usize,
            self.node.items.len()
        );

        if self.node.items.is_empty() {
            self.state = PipelineState::Done { exit_code: 0 };
            return Yield::Done;
        }

        Yield::Pipeline(self)
    }

    pub fn next(&mut self) -> Yield {
        match &self.state {
            PipelineState::StartingCmds { idx } => {
                let idx = *idx;
                let cmds = self.cmds.as_ref().unwrap();
                if idx as usize >= cmds.len() {
                    self.state = PipelineState::Pending;
                    return Yield::Suspended;
                }
                log!(
                    "Pipeline(0x{:x}) starting cmd {}/{}",
                    self as *const _ as usize,
                    idx + 1,
                    cmds.len()
                );
                // PORT NOTE: reshaped for borrowck — bump idx before re-borrowing cmds.
                if let PipelineState::StartingCmds { idx: i } = &mut self.state {
                    *i += 1;
                }
                let cmd_or_result = &self.cmds.as_ref().unwrap()[idx as usize];
                let CmdOrResult::Cmd(cmd) = cmd_or_result else {
                    unreachable!();
                };
                // TODO(port): `TaggedPtrUnion::call("start", .{}, Yield)` is comptime
                // reflection dispatch over the union's variants. Phase B: trait-based
                // dispatch (`PipelineRunnable::start`) or expanded match.
                cmd.dispatch_start()
            }
            PipelineState::Pending => shell::unreachable_state("Pipeline.next", "pending"),
            PipelineState::WaitingWriteErr => {
                shell::unreachable_state("Pipeline.next", "waiting_write_err")
            }
            PipelineState::Done { exit_code } => {
                let exit_code = *exit_code;
                self.parent.child_done(self, exit_code)
            }
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, err: Option<SystemError>) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.state, PipelineState::WaitingWriteErr));
        }

        if let Some(e) = err {
            self.base.throw(&ShellErr::new_sys(e));
            return Yield::Failed;
        }

        self.parent.child_done(self, 1)
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        debug_assert!(!self.cmds.as_ref().unwrap().is_empty());

        let idx = 'brk: {
            // SAFETY: same-size POD bitcast of the tagged-ptr repr (unused — kept for parity).
            let _ptr_value: u64 = unsafe { core::mem::transmute(child.ptr.repr) };
            for (i, cmd_or_result) in self.cmds.as_ref().unwrap().iter().enumerate() {
                if let CmdOrResult::Cmd(cmd) = cmd_or_result {
                    let ptr = cmd.repr.ptr() as usize;
                    if ptr == usize::try_from(child.ptr.repr.ptr()).unwrap() {
                        break 'brk i;
                    }
                }
            }
            unreachable!("Invalid pipeline state");
        };

        log!(
            "Pipeline(0x{:x}) child done ({}) i={}",
            self as *const _ as usize,
            exit_code,
            idx
        );
        // We duped the subshell for commands in the pipeline so we need to
        // deinitialize it.
        if child.ptr.is::<Cmd>() {
            let cmd = child.as_::<Cmd>();
            cmd.base.shell.deinit();
        } else if child.ptr.is::<If>() {
            let if_clause = child.as_::<If>();
            if_clause.base.shell.deinit();
        } else if child.ptr.is::<CondExpr>() {
            let condexpr = child.as_::<CondExpr>();
            condexpr.base.shell.deinit();
        } else if child.ptr.is::<Assigns>() {
            // We don't do anything here since assigns have no effect in a pipeline
        } else if child.ptr.is::<Subshell>() {
            // Subshell already deinitializes its shell state so don't need to do anything here
        }

        child.deinit();
        self.cmds.as_mut().unwrap()[idx] = CmdOrResult::Result(exit_code);
        self.exited_count += 1;

        let cmds_len = self.cmds.as_ref().unwrap().len();
        log!(
            "Pipeline(0x{:x}) check exited_count={} cmds.len={}",
            self as *const _ as usize,
            self.exited_count,
            cmds_len
        );
        if self.exited_count as usize >= cmds_len {
            let mut last_exit_code: ExitCode = 0;
            let mut i: i64 = i64::try_from(cmds_len).unwrap() - 1;
            while i > 0 {
                let cmd_or_result = &self.cmds.as_ref().unwrap()[usize::try_from(i).unwrap()];
                if let CmdOrResult::Result(r) = cmd_or_result {
                    last_exit_code = *r;
                    break;
                }
                i -= 1;
            }
            self.state = PipelineState::Done { exit_code: last_exit_code };
            return Yield::Pipeline(self);
        }

        Yield::Suspended
    }

    // TODO(port): not `impl Drop` — this is pool-allocated and `parent.destroy(self)`
    // frees the backing slot, which `Drop` cannot express. Phase B: revisit ownership.
    pub fn deinit(&mut self) {
        if let Some(cmds) = self.cmds.take() {
            for cmd_or_result in cmds.iter() {
                if let CmdOrResult::Cmd(cmd) = cmd_or_result {
                    // TODO(port): `TaggedPtrUnion::call("deinit", .{}, void)` reflection
                    // dispatch — Phase B trait or expanded match.
                    cmd.dispatch_deinit();
                }
            }
            // `allocator.free(cmds)` — handled by Box drop.
        }
        if let Some(_pipes) = self.pipes.take() {
            // `allocator.free(pipes)` — handled by Box drop.
        }
        self.io.deref();
        self.base.end_scope();
        self.parent.destroy(self);
    }

    fn initialize_pipes(pipes: &mut [Pipe], set_count: &mut u32) -> Maybe<()> {
        for pipe in pipes.iter_mut() {
            #[cfg(windows)]
            {
                *pipe = match bun_sys::pipe() {
                    Ok(p) => p,
                    Err(e) => return Err(e),
                };
            }
            #[cfg(not(windows))]
            {
                match bun_sys::socketpair_for_shell(
                    // match bun_sys::socketpair(
                    // TODO(port): map std.posix.AF/SOCK constants
                    bun_sys::posix::AF_UNIX,
                    bun_sys::posix::SOCK_STREAM,
                    0,
                    bun_sys::SocketBlocking::Blocking,
                ) {
                    Ok(fds) => *pipe = fds,
                    Err(err) => return Err(err),
                }
            }
            *set_count += 1;
        }
        Ok(())
    }

    fn write_pipe(
        pipes: &mut [Pipe],
        proc_idx: usize,
        cmd_count: usize,
        io: &mut IO,
        evtloop: EventLoopHandle,
    ) -> IoOutKind {
        // Last command in the pipeline should write to stdout
        if proc_idx == cmd_count - 1 {
            return io.stdout.r#ref();
        }
        IoOutKind::Fd {
            writer: IOWriter::init(
                pipes[proc_idx][1],
                IOWriterFlags {
                    pollable: true,
                    is_socket: cfg!(unix),
                    ..Default::default()
                },
                evtloop,
            ),
        }
    }

    fn read_pipe(
        pipes: &mut [Pipe],
        proc_idx: usize,
        io: &mut IO,
        evtloop: EventLoopHandle,
    ) -> IoInKind {
        // First command in the pipeline should read from stdin
        if proc_idx == 0 {
            return io.stdin.r#ref();
        }
        IoInKind::Fd(IOReader::init(pipes[proc_idx - 1][0], evtloop))
    }
}

// TODO(port): these live on `IO` in Zig (`IO.OutKind`/`IO.InKind`); import the real
// types from `bun_shell::interpreter::io` in Phase B.
use bun_shell::interpreter::io::{InKind as IoInKind, OutKind as IoOutKind};
use bun_shell::interpreter::IOWriterFlags;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Pipeline.zig (364 lines)
//   confidence: medium
//   todos:      7
//   notes:      TaggedPtrUnion reflection `.call("name", ...)` needs trait dispatch; pool-allocated init/deinit kept as-is (not Drop); `pipes` ownership reshaped for borrowck.
// ──────────────────────────────────────────────────────────────────────────

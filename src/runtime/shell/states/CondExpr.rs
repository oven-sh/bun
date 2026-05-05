//! https://www.gnu.org/software/bash/manual/bash.html#Bash-Conditional-Expressions

use core::fmt;
use core::mem::MaybeUninit;

use bun_core::assert as bun_assert;
use bun_jsc::{self as jsc, EventLoopTask, SystemError};
use bun_str::ZStr;
use bun_sys::{self, Fd, Stat};

use crate::shell::ast;
use crate::shell::interpret::{log, ShellSyscall, ShellTask, StatePtrUnion};
use crate::shell::interpreter::{
    Async, Binary, Expansion, Interpreter, Pipeline, ShellExecEnv, State, Stmt, IO,
};
use crate::shell::{unreachable_state, ExitCode, Yield};

bun_output::declare_scope!(shell_interpret, hidden);

pub struct CondExpr<'a> {
    pub base: State,
    pub node: &'a ast::CondExpr,
    pub parent: ParentPtr,
    pub io: IO,
    pub state: CondExprState,
    // TODO(port): elements are owned `[:0]const u8` (NUL-terminated) filled by
    // Expansion via `.array_of_slice`; freed in deinit. Representing as
    // Vec<Box<[u8]>> for now — Phase B may want an owned ZStr type.
    pub args: Vec<Box<[u8]>>,
}

pub enum CondExprState {
    Idle,
    ExpandingArgs {
        idx: u32,
        // TODO(port): in-place init — Expansion::init writes into this slot.
        expansion: MaybeUninit<Expansion>,
        last_exit_code: ExitCode,
    },
    WaitingStat,
    StatComplete {
        stat: bun_sys::Result<Stat>,
    },
    WaitingWriteErr,
    Done,
}

impl Default for CondExprState {
    fn default() -> Self {
        CondExprState::Idle
    }
}

pub struct ShellCondExprStatTask {
    pub task: ShellTask<Self>,
    pub condexpr: *mut CondExpr<'static>, // BACKREF: creator callback ref
    pub result: Option<bun_sys::Result<Stat>>,
    // TODO(port): borrowed `[:0]const u8` from `condexpr.args[0]`; lifetime tied
    // to `condexpr` backref. ZStr<'static> stored by value (it is ptr+len).
    pub path: ZStr<'static>,
    pub cwdfd: Fd,
}

impl ShellCondExprStatTask {
    pub fn run_from_thread_pool(&mut self) {
        self.result = Some(ShellSyscall::statat(self.cwdfd, &self.path));
    }

    pub fn run_from_main_thread(&mut self) {
        let ret = self.result.take().expect("unreachable");
        // SAFETY: `condexpr` is the creator and outlives this task; we are on
        // the main thread.
        unsafe { (*self.condexpr).on_stat_task_complete(ret) };
        // Zig: `defer this.deinit();` — runs after callback. Self-destroy.
        // SAFETY: self was Box::into_raw'd in do_stat; this is the sole owner and last use.
        unsafe { Self::deinit(self) };
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut core::ffi::c_void) {
        self.run_from_main_thread();
    }

    /// # Safety
    /// `this` must have been allocated via `Box::into_raw` (bun.new) and not
    /// used after this call.
    pub unsafe fn deinit(this: *mut ShellCondExprStatTask) {
        // bun.destroy(this)
        drop(Box::from_raw(this));
    }
}

pub type ParentPtr = StatePtrUnion<(Stmt, Binary, Pipeline, Async)>;

pub type ChildPtr = StatePtrUnion<(Expansion,)>;

impl<'a> CondExpr<'a> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::CondExpr,
        parent: ParentPtr,
        io: IO,
    ) -> *mut CondExpr<'a> {
        let condexpr: *mut CondExpr<'a> = parent.create::<CondExpr>();
        // SAFETY: `parent.create` returns uninitialized storage for CondExpr;
        // we fully initialize it here before any other access.
        unsafe {
            condexpr.write(CondExpr {
                base: State::init_with_new_alloc_scope(
                    State::Kind::CondExpr,
                    interpreter,
                    shell_state,
                ),
                node,
                parent,
                io,
                state: CondExprState::Idle,
                // Zig used `undefined` then re-assigned with base.allocator();
                // in Rust the Vec uses the global allocator.
                args: Vec::new(),
            });
        }
        condexpr
    }

    pub fn start(&mut self) -> Yield {
        bun_output::scoped_log!(shell_interpret, "{} start", self);
        Yield::CondExpr(self)
    }

    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, CondExprState::Done) {
            match &mut self.state {
                CondExprState::Idle => {
                    self.state = CondExprState::ExpandingArgs {
                        idx: 0,
                        expansion: MaybeUninit::uninit(),
                        last_exit_code: 0,
                    };
                    continue;
                }
                CondExprState::ExpandingArgs { idx, expansion, .. } => {
                    if *idx >= self.node.args.len() {
                        return self.command_impl_start();
                    }

                    self.args.reserve(1);
                    // PERF(port): was ensureUnusedCapacity(1) — profile in Phase B

                    // TODO(port): in-place init of Expansion into the state slot.
                    Expansion::init(
                        self.base.interpreter,
                        self.base.shell,
                        expansion, // &mut MaybeUninit<Expansion>
                        self.node.args.get_const(*idx),
                        Expansion::ParentPtr::init(self),
                        Expansion::Out::ArrayOfSlice(&mut self.args),
                        self.io.copy(),
                    );
                    *idx += 1;
                    // SAFETY: Expansion::init fully initialized `expansion` above.
                    return unsafe { expansion.assume_init_mut() }.start();
                }
                CondExprState::WaitingStat => return Yield::Suspended,
                CondExprState::StatComplete { stat } => {
                    match self.node.op {
                        ast::cond_expr::Op::DashF => {
                            let st: Stat = match stat {
                                bun_sys::Result::Ok(st) => *st,
                                bun_sys::Result::Err(_) => {
                                    // It seems that bash always gives exit code 1
                                    return self.parent.child_done(self, 1);
                                }
                            };
                            return self.parent.child_done(
                                self,
                                if bun_sys::s::isreg(
                                    u32::try_from(st.mode).unwrap(),
                                ) {
                                    0
                                } else {
                                    1
                                },
                            );
                        }
                        ast::cond_expr::Op::DashD => {
                            let st: Stat = match stat {
                                bun_sys::Result::Ok(st) => *st,
                                bun_sys::Result::Err(_) => {
                                    // It seems that bash always gives exit code 1
                                    return self.parent.child_done(self, 1);
                                }
                            };
                            return self.parent.child_done(
                                self,
                                if bun_sys::s::isdir(
                                    u32::try_from(st.mode).unwrap(),
                                ) {
                                    0
                                } else {
                                    1
                                },
                            );
                        }
                        ast::cond_expr::Op::DashC => {
                            let st: Stat = match stat {
                                bun_sys::Result::Ok(st) => *st,
                                bun_sys::Result::Err(_) => {
                                    // It seems that bash always gives exit code 1
                                    return self.parent.child_done(self, 1);
                                }
                            };
                            return self.parent.child_done(
                                self,
                                if bun_sys::s::ischr(
                                    u32::try_from(st.mode).unwrap(),
                                ) {
                                    0
                                } else {
                                    1
                                },
                            );
                        }
                        ast::cond_expr::Op::DashZ
                        | ast::cond_expr::Op::DashN
                        | ast::cond_expr::Op::EqEq
                        | ast::cond_expr::Op::NotEq => {
                            panic!("This conditional expression op does not need `stat()`. This indicates a bug in Bun. Please file a GitHub issue.");
                        }
                        _ => {
                            #[cfg(debug_assertions)]
                            {
                                for supported in ast::cond_expr::Op::SUPPORTED {
                                    if *supported == self.node.op {
                                        panic!(
                                            "DEV: You did not support the \"{}\" conditional expression operation here.",
                                            <&'static str>::from(*supported)
                                        );
                                    }
                                }
                            }
                            panic!("Invalid conditional expression op, this indicates a bug in Bun. Please file a GithHub issue.");
                        }
                    }
                }
                CondExprState::WaitingWriteErr => return Yield::Suspended,
                CondExprState::Done => debug_assert!(false),
            }
        }

        self.parent.child_done(self, 0)
    }

    fn command_impl_start(&mut self) -> Yield {
        match self.node.op {
            ast::cond_expr::Op::DashC
            | ast::cond_expr::Op::DashD
            | ast::cond_expr::Op::DashF => {
                // Empty string expansion produces no args, or the path is an empty string;
                // the path doesn't exist. On Windows, stat("") can succeed and return the
                // cwd's stat, so we must check for empty paths explicitly.
                if self.args.is_empty() || self.args[0].is_empty() {
                    return self.parent.child_done(self, 1);
                }
                self.state = CondExprState::WaitingStat;
                self.do_stat()
            }
            ast::cond_expr::Op::DashZ => self.parent.child_done(
                self,
                if self.args.is_empty() || self.args[0].is_empty() {
                    0
                } else {
                    1
                },
            ),
            ast::cond_expr::Op::DashN => self.parent.child_done(
                self,
                if !self.args.is_empty() && !self.args[0].is_empty() {
                    0
                } else {
                    1
                },
            ),
            ast::cond_expr::Op::EqEq => {
                let is_eq = self.args.is_empty()
                    || (self.args.len() >= 2
                        && self.args[0].as_ref() == self.args[1].as_ref());
                self.parent.child_done(self, if is_eq { 0 } else { 1 })
            }
            ast::cond_expr::Op::NotEq => {
                let is_neq = self.args.len() >= 2
                    && self.args[0].as_ref() != self.args[1].as_ref();
                self.parent.child_done(self, if is_neq { 0 } else { 1 })
            }
            // else => @panic("Invalid node op: " ++ @tagName(this.node.op) ++ ", this indicates a bug in Bun. Please file a GithHub issue."),
            _ => {
                #[cfg(debug_assertions)]
                {
                    for supported in ast::cond_expr::Op::SUPPORTED {
                        if *supported == self.node.op {
                            panic!(
                                "DEV: You did not support the \"{}\" conditional expression operation here.",
                                <&'static str>::from(*supported)
                            );
                        }
                    }
                }

                panic!("Invalid cond expression op, this indicates a bug in Bun. Please file a GithHub issue.");
            }
        }
    }

    fn do_stat(&mut self) -> Yield {
        // TODO(port): `path` borrows `self.args[0]` as `[:0]const u8`. The Vec
        // element type above is `Box<[u8]>` placeholder; Phase B should use an
        // owned NUL-terminated slice type and pass `&ZStr` here.
        // SAFETY: args[0] is a NUL-terminated slice owned by `self` and
        // outlives the stat task (task completes before destroy).
        let path: ZStr<'static> =
            unsafe { ZStr::from_raw(self.args[0].as_ptr(), self.args[0].len()) };
        let stat_task = Box::into_raw(Box::new(ShellCondExprStatTask {
            task: ShellTask {
                event_loop: self.base.event_loop(),
                concurrent_task: EventLoopTask::from_event_loop(self.base.event_loop()),
                // TODO(port): ShellTask generic wiring (run_from_thread_pool /
                // run_from_main_thread / log) — Zig passes fn ptrs as comptime
                // params; Rust ShellTask<T> should call T::run_from_thread_pool etc.
                ..Default::default()
            },
            condexpr: self as *mut _ as *mut CondExpr<'static>,
            result: None,
            path,
            cwdfd: self.base.shell.cwd_fd,
        }));
        // SAFETY: stat_task is a freshly-boxed valid pointer; schedule takes
        // ownership of scheduling but the box is freed in run_from_main_thread.
        unsafe { (*stat_task).task.schedule() };
        Yield::Suspended
    }

    // TODO(port): not `impl Drop` — this calls `parent.destroy(this)` which
    // deallocates the CondExpr itself (allocated via `parent.create`). Per
    // PORTING.md the explicit self-destroy form is `unsafe fn destroy(*mut Self)`.
    /// # Safety
    /// `this` must point to a live CondExpr allocated via `parent.create`; it
    /// is deallocated by this call and must not be used afterward.
    pub unsafe fn destroy(this: *mut Self) {
        let me = &mut *this;
        me.io.deinit();
        // Zig frees each item; in Rust, dropping the Vec<Box<[u8]>> frees them.
        me.args.clear();
        me.base.end_scope();
        me.parent.destroy(this);
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        if child.ptr.is::<Expansion>() {
            if exit_code != 0 {
                // PORT NOTE: reshaped for borrowck — extract err before deinit.
                let CondExprState::ExpandingArgs { expansion, .. } = &mut self.state else {
                    unreachable!()
                };
                // SAFETY: expansion was initialized in `next()` before `start()`.
                let expansion = unsafe { expansion.assume_init_mut() };
                let err = expansion.state.err.take();
                expansion.deinit();
                let y = self.write_failing_error(format_args!("{}\n", err));
                drop(err);
                return y;
            }
            child.deinit();
            return self.next();
        }

        panic!("Invalid child to cond expression, this indicates a bug in Bun. Please file a report on Github.");
    }

    pub fn on_stat_task_complete(&mut self, result: bun_sys::Result<Stat>) {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.state, CondExprState::WaitingStat));
        }

        self.state = CondExprState::StatComplete { stat: result };
        self.next().run();
    }

    pub fn write_failing_error(&mut self, args: fmt::Arguments<'_>) -> Yield {
        fn enqueue_cb(ctx: &mut CondExpr<'_>) {
            ctx.state = CondExprState::WaitingWriteErr;
        }
        self.base
            .shell
            .write_failing_error_fmt(self, enqueue_cb, args)
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, err: Option<SystemError>) -> Yield {
        if let Some(e) = err {
            let exit_code: ExitCode = e.get_errno() as ExitCode;
            e.deref();
            return self.parent.child_done(self, exit_code);
        }

        if matches!(self.state, CondExprState::WaitingWriteErr) {
            return self.parent.child_done(self, 1);
        }

        unreachable_state(
            "CondExpr.onIOWriterChunk",
            <&'static str>::from(&self.state),
        )
    }
}

impl fmt::Display for CondExpr<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "CondExpr(0x{:x}, op={})",
            self as *const _ as usize,
            <&'static str>::from(self.node.op)
        )
    }
}

// TODO(port): derive IntoStaticStr on CondExprState for @tagName in
// on_io_writer_chunk.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/CondExpr.zig (306 lines)
//   confidence: medium
//   todos:      8
//   notes:      args Vec element type needs owned-ZStr; ShellTask<T> generic wiring; destroy() is self-destroying (not Drop); Expansion in-place init via MaybeUninit
// ──────────────────────────────────────────────────────────────────────────

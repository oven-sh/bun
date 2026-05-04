use core::fmt;

use bun_jsc::SystemError;
use bun_sys;

use crate::ast;
use crate::interpret::{log, StatePtrUnion};
use crate::interpreter::{
    Binary, Expansion, Interpreter, Pipeline, Script, ShellExecEnv, State, StateKind, Stmt, IO,
};
use crate::{ExitCode, Yield};

pub struct Subshell<'a> {
    pub base: State,
    pub node: &'a ast::Subshell,
    pub parent: ParentPtr,
    pub io: IO,
    pub state: SubshellState,
    pub redirection_file: Vec<u8>,
    pub exit_code: ExitCode,
}

#[derive(Default)]
pub enum SubshellState {
    #[default]
    Idle,
    ExpandingRedirect {
        idx: u32,
        expansion: Expansion,
    },
    Exec,
    WaitWriteErr,
    Done,
}

pub type ParentPtr = StatePtrUnion<(Pipeline, Binary, Stmt)>;

pub type ChildPtr = StatePtrUnion<(Script, Expansion)>;

impl<'a> fmt::Display for Subshell<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Subshell(0x{:x})", self as *const _ as usize)
    }
}

impl<'a> Subshell<'a> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Subshell,
        parent: ParentPtr,
        io: IO,
    ) -> *mut Subshell<'a> {
        let subshell = parent.create::<Subshell>();
        // TODO(port): in-place init — `parent.create` returns a pool slot; Zig writes via `subshell.* = .{...}`.
        // SAFETY: `parent.create` returns a valid uninitialized slot for Subshell.
        unsafe {
            subshell.write(Subshell {
                base: State::init_with_new_alloc_scope(StateKind::Subshell, interpreter, shell_state),
                node,
                parent,
                io,
                state: SubshellState::Idle,
                // PERF(port): Zig used base.allocator() (scope arena) for this Vec — profile in Phase B
                redirection_file: Vec::new(),
                exit_code: 0,
            });
            &mut *subshell
        }
    }

    pub fn init_dupe_shell_state(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Subshell,
        parent: ParentPtr,
        io: IO,
    ) -> bun_sys::Result<*mut Subshell<'a>> {
        let subshell_ptr = parent.create::<Subshell>();
        // TODO(port): in-place init — `parent.create` returns a pool slot.
        // SAFETY: `parent.create` returns a valid uninitialized slot for Subshell.
        let subshell = unsafe {
            subshell_ptr.write(Subshell {
                base: State::init_with_new_alloc_scope(StateKind::Subshell, interpreter, shell_state),
                node,
                parent,
                io,
                state: SubshellState::Idle,
                redirection_file: Vec::new(),
                exit_code: 0,
            });
            &mut *subshell_ptr
        };
        subshell.base.shell = match shell_state.dupe_for_subshell(
            subshell.base.alloc_scope(),
            subshell.base.allocator(),
            &subshell.io,
            StateKind::Subshell,
        ) {
            bun_sys::Result::Ok(s) => s,
            bun_sys::Result::Err(e) => {
                // Callee-consumes-on-failure: we own the io refs the caller passed in.
                subshell.io.deref();
                subshell.base.end_scope();
                parent.destroy(subshell_ptr);
                return bun_sys::Result::Err(e);
            }
        };
        // PERF(port): Zig used base.allocator() (scope arena) for this Vec — profile in Phase B
        subshell.redirection_file = Vec::new();
        bun_sys::Result::Ok(subshell_ptr)
    }

    pub fn start(&mut self) -> Yield {
        log!("{} start", self);
        let script = Script::init(
            self.base.interpreter,
            self.base.shell,
            &self.node.script,
            Script::ParentPtr::init(self),
            self.io.copy(),
        );
        script.start()
    }

    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, SubshellState::Done) {
            match &mut self.state {
                SubshellState::Idle => {
                    // TODO(port): Zig leaves `expansion` undefined here; Rust needs a placeholder
                    // until Expansion::init fills it via out-param below.
                    self.state = SubshellState::ExpandingRedirect {
                        idx: 0,
                        expansion: Expansion::default(),
                    };
                    return Yield::Subshell(self);
                }
                SubshellState::ExpandingRedirect { idx, .. } => {
                    if *idx >= 1 {
                        return self.transition_to_exec();
                    }
                    *idx += 1;

                    // Get the node to expand otherwise go straight to
                    // `expanding_args` state
                    let node_to_expand = 'brk: {
                        if let Some(redirect) = &self.node.redirect {
                            if let ast::Redirect::Atom(atom) = redirect {
                                break 'brk atom;
                            }
                        }
                        return self.transition_to_exec();
                    };

                    // PORT NOTE: reshaped for borrowck — re-borrow expansion after mutating idx above.
                    let SubshellState::ExpandingRedirect { expansion, .. } = &mut self.state else {
                        unreachable!()
                    };

                    Expansion::init(
                        self.base.interpreter,
                        self.base.shell,
                        expansion,
                        node_to_expand,
                        Expansion::ParentPtr::init(self),
                        Expansion::OutKind::Single {
                            list: &mut self.redirection_file,
                        },
                        self.io.copy(),
                    );

                    let SubshellState::ExpandingRedirect { expansion, .. } = &mut self.state else {
                        unreachable!()
                    };
                    return expansion.start();
                }
                SubshellState::WaitWriteErr | SubshellState::Exec => return Yield::Suspended,
                SubshellState::Done => panic!("This should not be possible."),
            }
        }

        self.parent.child_done(self, 0)
    }

    pub fn transition_to_exec(&mut self) -> Yield {
        log!("{} transitionToExec", self);
        let script = Script::init(
            self.base.interpreter,
            self.base.shell,
            &self.node.script,
            Script::ParentPtr::init(self),
            self.io.copy(),
        );
        self.state = SubshellState::Exec;
        script.start()
    }

    pub fn child_done(&mut self, child_ptr: ChildPtr, exit_code: ExitCode) -> Yield {
        self.exit_code = exit_code;
        if child_ptr.ptr.is::<Expansion>() && exit_code != 0 {
            if exit_code != 0 {
                let SubshellState::ExpandingRedirect { expansion, .. } = &mut self.state else {
                    unreachable!()
                };
                let err = expansion.state.err();
                // Zig: `defer err.deinit(bun.default_allocator)` — Drop handles freeing `err` at scope exit.
                expansion.deinit();
                return self.write_failing_error(format_args!("{}\n", err));
            }
            child_ptr.deinit();
            return Yield::Subshell(self);
        }

        if child_ptr.ptr.is::<Script>() {
            child_ptr.deinit();
            return self.parent.child_done(self, exit_code);
        }

        crate::unreachable_state("Subshell.childDone", "expected Script or Expansion");
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, err: Option<SystemError>) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.state, SubshellState::WaitWriteErr));
        }

        if let Some(e) = err {
            e.deref();
        }

        self.state = SubshellState::Done;
        self.parent.child_done(self, self.exit_code)
    }

    // TODO(port): not `impl Drop` — this self-destroys via `parent.destroy(self)` (pool slot return),
    // which Drop cannot express. Phase B: revisit once StatePtrUnion pool ownership is settled.
    pub fn deinit(&mut self) {
        self.base.shell.deinit();
        self.io.deref();
        // self.redirection_file dropped automatically when slot is destroyed; Zig called .deinit() explicitly.
        // TODO(port): if pool slot reuse does not run Drop, explicitly `mem::take(&mut self.redirection_file)`.
        core::mem::take(&mut self.redirection_file);
        self.base.end_scope();
        self.parent.destroy(self);
    }

    pub fn write_failing_error(&mut self, args: fmt::Arguments<'_>) -> Yield {
        fn enqueue_cb(ctx: &mut Subshell<'_>) {
            ctx.state = SubshellState::WaitWriteErr;
        }
        self.base
            .shell
            .write_failing_error_fmt(self, enqueue_cb, args)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Subshell.zig (215 lines)
//   confidence: medium
//   todos:      5
//   notes:      Pool-allocated state node: init/deinit kept as raw-ptr methods (not Box/Drop). Expansion in-place init + ast::Redirect variant names guessed. StatePtrUnion<(..)> tuple-generic assumed.
// ──────────────────────────────────────────────────────────────────────────

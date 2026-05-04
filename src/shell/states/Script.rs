//! A state node which represents the execution of a shell script. This struct
//! is used for both top-level scripts and also expansions (when running a
//! command substitution) and subshells.

use core::fmt;

use bun_shell::interpret::{log, StatePtrUnion};
use bun_shell::interpreter::{
    Expansion, Interpreter, InterpreterChildPtr, ShellExecEnv, State, Stmt, Subshell, IO,
};
use bun_shell::{ast, ExitCode, Yield};

pub struct Script<'a> {
    pub base: State,
    pub node: &'a ast::Script,
    pub io: IO,
    pub parent: ParentPtr,
    pub state: ScriptState,
}

pub enum ScriptState {
    Normal { idx: usize },
}

impl Default for ScriptState {
    fn default() -> Self {
        ScriptState::Normal { idx: 0 }
    }
}

pub type ParentPtr = StatePtrUnion<(Interpreter, Expansion, Subshell)>;

pub struct ChildPtr {
    pub val: Box<Stmt>,
}

impl ChildPtr {
    #[inline]
    pub fn init(child: Box<Stmt>) -> ChildPtr {
        ChildPtr { val: child }
    }
}
// PORT NOTE: Zig `ChildPtr.deinit` only called `val.deinit()`; Box<Stmt> Drop handles this.

impl<'a> fmt::Display for Script<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Script(0x{:x}, stmts={})",
            self as *const _ as usize,
            self.node.stmts.len()
        )
    }
}

impl<'a> Script<'a> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Script,
        parent_ptr: ParentPtr,
        io: IO,
    ) -> *mut Script<'a> {
        // TODO(port): parent_ptr.create(Script) allocates a slot owned by the parent's
        // alloc scope; returning a raw pointer to match the Zig state-machine ownership.
        let script: *mut Script<'a> = parent_ptr.create::<Script<'a>>();
        // SAFETY: parent_ptr.create returns a valid uninitialized allocation for Script
        unsafe {
            script.write(Script {
                base: State::init_with_new_alloc_scope(StateKind::Script, interpreter, shell_state),
                node,
                parent: parent_ptr,
                io,
                state: ScriptState::default(),
            });
            log!("{} init", &*script);
        }
        script
    }

    fn get_io(&mut self) -> IO {
        self.io
    }

    pub fn start(&mut self) -> Yield {
        if self.node.stmts.is_empty() {
            return self.finish(0);
        }
        Yield::Script(self)
    }

    pub fn next(&mut self) -> Yield {
        match self.state {
            ScriptState::Normal { ref mut idx } => {
                if *idx >= self.node.stmts.len() {
                    return Yield::Suspended;
                }
                let i = *idx;
                *idx += 1;
                // PORT NOTE: reshaped for borrowck — captured idx into local before
                // re-borrowing self.node / self.base / self for Stmt::init.
                let stmt_node = &self.node.stmts[i];
                let mut io = self.io;
                let stmt = Stmt::init(
                    self.base.interpreter,
                    self.base.shell,
                    stmt_node,
                    self,
                    *io.r#ref(),
                );
                stmt.start()
            }
        }
    }

    fn finish(&mut self, exit_code: ExitCode) -> Yield {
        if self.parent.ptr.is::<Interpreter>() {
            log!("Interpreter script finish");
            return self
                .base
                .interpreter
                .child_done(InterpreterChildPtr::init(self), exit_code);
        }

        self.parent.child_done(self, exit_code)
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        drop(child);
        let idx = match self.state {
            ScriptState::Normal { idx } => idx,
        };
        if idx >= self.node.stmts.len() {
            return self.finish(exit_code);
        }
        self.next()
    }

    // TODO(port): self-destroying state node — kept as explicit method, not Drop.
    // `parent.destroy(this)` frees the allocation that `self` lives in, so this
    // cannot be expressed as `impl Drop` (which would run again on the freed slot).
    pub fn deinit(&mut self) {
        log!("Script(0x{:x}) deinit", self as *mut _ as usize);
        self.io.deref();
        if !self.parent.ptr.is::<Interpreter>() && !self.parent.ptr.is::<Subshell>() {
            // The shell state is owned by the parent when the parent is Interpreter or Subshell
            // Otherwise this Script represents a command substitution which is duped from the parent
            // and must be deinitalized.
            self.base.shell.deinit();
        }

        self.base.end_scope();
        self.parent.destroy(self);
    }

    pub fn deinit_from_interpreter(this: *mut Script<'a>) {
        // SAFETY: caller (Interpreter) guarantees `this` is a valid Box-allocated Script
        unsafe {
            log!("Script(0x{:x}) deinitFromInterpreter", this as usize);
            (*this).io.deinit();
            // Let the interpreter deinitialize the shell state
            // this.base.shell.deinitImpl(false, false);
            drop(Box::from_raw(this));
        }
    }
}

// TODO(port): `StateKind::Script` corresponds to Zig's `.script` decl-literal tag passed to
// State.initWithNewAllocScope; verify the enum name in bun_shell::interpreter::State.
use bun_shell::interpreter::StateKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Script.zig (133 lines)
//   confidence: medium
//   todos:      3
//   notes:      ParentPtr.create/destroy own the allocation; deinit kept explicit (self-destroy). StatePtrUnion modeled as generic over a type tuple.
// ──────────────────────────────────────────────────────────────────────────

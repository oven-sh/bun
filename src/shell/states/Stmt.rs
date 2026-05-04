use crate::ast;
use crate::interpret::{log, StatePtrUnion};
use crate::interpreter::{
    Assigns, Async, Binary, Cmd, CondExpr, If, Interpreter, Pipeline, Script, ShellExecEnv, State,
    Subshell, IO,
};
use crate::{ExitCode, ShellErr, Yield};

pub struct Stmt<'arena> {
    pub base: State,
    pub node: &'arena ast::Stmt,
    pub parent: ParentPtr,
    pub idx: usize,
    pub last_exit_code: Option<ExitCode>,
    pub currently_executing: Option<ChildPtr>,
    pub io: IO,
}

pub type ParentPtr = StatePtrUnion<(Script, If)>;

pub type ChildPtr = StatePtrUnion<(Async, Binary, Pipeline, Cmd, Assigns, If, CondExpr, Subshell)>;

impl<'arena> Stmt<'arena> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'arena ast::Stmt,
        parent: impl Into<ParentPtr>,
        io: IO,
    ) -> *mut Stmt<'arena> {
        // Zig switched on @TypeOf(parent): if already ParentPtr, use it; else ParentPtr.init(parent).
        // In Rust the `Into<ParentPtr>` bound covers both (ParentPtr: Into<ParentPtr> is reflexive).
        let parent_ptr: ParentPtr = parent.into();
        // TODO(port): in-place init — `parent_ptr.create::<Stmt>()` returns a pre-allocated slot
        // from the interpreter's state arena/pool; keep raw-ptr factory shape.
        let script: *mut Stmt<'arena> = parent_ptr.create::<Stmt>();
        // SAFETY: `create` returns a valid uninitialized slot owned by the parent's allocator.
        unsafe {
            (*script).base = State::init_with_new_alloc_scope(StateKind::Stmt, interpreter, shell_state);
            (*script).node = node;
            (*script).parent = parent_ptr;
            (*script).idx = 0;
            (*script).last_exit_code = None;
            (*script).currently_executing = None;
            (*script).io = io;
        }
        log!("Stmt(0x{:x}) init", script as usize);
        script
    }

    pub fn start(&mut self) -> Yield {
        debug_assert!(self.idx == 0);
        debug_assert!(self.last_exit_code.is_none());
        debug_assert!(self.currently_executing.is_none());
        Yield::Stmt(self as *mut _)
    }

    pub fn next(&mut self) -> Yield {
        if self.idx >= self.node.exprs.len() {
            return self
                .parent
                .child_done(self, self.last_exit_code.unwrap_or(0));
        }

        let child = &self.node.exprs[self.idx];
        match child {
            ast::Expr::Binary(binary_node) => {
                let binary = Binary::init(
                    self.base.interpreter,
                    self.base.shell,
                    binary_node,
                    Binary::ParentPtr::init(self),
                    self.io.copy(),
                );
                self.currently_executing = Some(ChildPtr::init(binary));
                // SAFETY: `Binary::init` returns a valid live state pointer.
                unsafe { (*binary).start() }
            }
            ast::Expr::Cmd(cmd_node) => {
                let cmd = Cmd::init(
                    self.base.interpreter,
                    self.base.shell,
                    cmd_node,
                    Cmd::ParentPtr::init(self),
                    self.io.copy(),
                );
                self.currently_executing = Some(ChildPtr::init(cmd));
                // SAFETY: `Cmd::init` returns a valid live state pointer.
                unsafe { (*cmd).start() }
            }
            ast::Expr::Pipeline(pipeline_node) => {
                let pipeline = Pipeline::init(
                    self.base.interpreter,
                    self.base.shell,
                    pipeline_node,
                    Pipeline::ParentPtr::init(self),
                    self.io.copy(),
                );
                self.currently_executing = Some(ChildPtr::init(pipeline));
                // SAFETY: `Pipeline::init` returns a valid live state pointer.
                unsafe { (*pipeline).start() }
            }
            ast::Expr::Assign(assigns) => {
                let assign_machine = Assigns::init(
                    self.base.interpreter,
                    self.base.shell,
                    assigns,
                    AssignCtx::Shell,
                    Assigns::ParentPtr::init(self),
                    self.io.copy(),
                );
                // SAFETY: `Assigns::init` returns a valid live state pointer.
                unsafe { (*assign_machine).start() }
            }
            ast::Expr::Subshell(subshell_node) => {
                let script = match Subshell::init_dupe_shell_state(
                    self.base.interpreter,
                    self.base.shell,
                    subshell_node,
                    Subshell::ParentPtr::init(self),
                    self.io.copy(),
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        self.base.throw(&ShellErr::new_sys(e));
                        return Yield::Failed;
                    }
                };
                // SAFETY: `init_dupe_shell_state` Ok arm returns a valid live state pointer.
                unsafe { (*script).start() }
            }
            ast::Expr::If(if_node) => {
                let if_clause = If::init(
                    self.base.interpreter,
                    self.base.shell,
                    if_node,
                    If::ParentPtr::init(self),
                    self.io.copy(),
                );
                // SAFETY: `If::init` returns a valid live state pointer.
                unsafe { (*if_clause).start() }
            }
            ast::Expr::CondExpr(condexpr_node) => {
                let condexpr = CondExpr::init(
                    self.base.interpreter,
                    self.base.shell,
                    condexpr_node,
                    CondExpr::ParentPtr::init(self),
                    self.io.copy(),
                );
                // SAFETY: `CondExpr::init` returns a valid live state pointer.
                unsafe { (*condexpr).start() }
            }
            ast::Expr::Async(async_node) => {
                let r#async = Async::init(
                    self.base.interpreter,
                    self.base.shell,
                    async_node,
                    Async::ParentPtr::init(self),
                    self.io.copy(),
                );
                // SAFETY: `Async::init` returns a valid live state pointer.
                unsafe { (*r#async).start() }
            }
        }
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        // TODO(port): `child.ptr.repr.data` / `._ptr` reach into StatePtrUnion's TaggedPtr repr
        // for debug logging only — expose a debug accessor on StatePtrUnion in Phase B.
        let data = child.ptr_repr_data();
        log!(
            "child done Stmt {:x} child({})={:x} exit={}",
            self as *mut _ as usize,
            child.tag_name(),
            usize::try_from(child.ptr_repr_ptr()).unwrap(),
            exit_code
        );
        self.last_exit_code = Some(exit_code);
        self.idx += 1;
        let data2 = child.ptr_repr_data();
        log!("{} {}", data, data2);
        child.deinit();
        self.currently_executing = None;
        self.next()
    }

    // PORT NOTE: not `impl Drop` — this self-deallocates via `parent.destroy(self)` (state-machine
    // nodes are pool-allocated by the parent and explicitly torn down when the parent is done).
    pub fn deinit(&mut self) {
        log!("Stmt(0x{:x}) deinit", self as *mut _ as usize);
        self.io.deinit();
        if let Some(child) = self.currently_executing.take() {
            child.deinit();
        }
        self.base.end_scope();
        self.parent.destroy(self);
    }
}

// TODO(port): `StateKind` / `AssignCtx` enum locations — Zig passed `.stmt` / `.shell` decl-literals.
use crate::interpreter::state::StateKind;
use crate::interpreter::assigns::AssignCtx;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Stmt.zig (159 lines)
//   confidence: medium
//   todos:      3
//   notes:      state-machine node: kept raw *mut factory + explicit deinit (self-deallocates via parent); StatePtrUnion repr accessors and StateKind/AssignCtx paths need Phase B wiring
// ──────────────────────────────────────────────────────────────────────────

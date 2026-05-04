use bun_shell::interpret::{log, StatePtrUnion};
use bun_shell::interpreter::{
    Assigns, Async, Cmd, CondExpr, If, Interpreter, Pipeline, ShellExecEnv, State, Stmt, Subshell,
    IO,
};
use bun_shell::{ast, ExitCode, ShellErr, Yield};

pub struct Binary<'a> {
    pub base: State,
    // LIFETIMES.tsv: BORROW_PARAM — set from init param; deinit() never frees it
    pub node: &'a ast::Binary,
    /// Based on precedence rules binary expr can only be child of a stmt or
    /// another binary expr
    // LIFETIMES.tsv: BACKREF — parent.create allocs self; parent.allocator().destroy(this)
    pub parent: ParentPtr,
    pub left: Option<ExitCode>,
    pub right: Option<ExitCode>,
    pub io: IO,
    // LIFETIMES.tsv: OWNED — make_child allocs child; deinit() child.deinit() destroys
    pub currently_executing: Option<ChildPtr>,
}

pub type ChildPtr = StatePtrUnion<(
    Async,
    Cmd,
    Pipeline,
    Binary<'static>, // TODO(port): lifetime — self-referential variant in tagged ptr union
    Assigns,
    If,
    CondExpr,
    Subshell,
)>;

pub type ParentPtr = StatePtrUnion<(
    Stmt,
    Binary<'static>, // TODO(port): lifetime — self-referential variant in tagged ptr union
)>;

impl<'a> Binary<'a> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Binary,
        parent: ParentPtr,
        io: IO,
    ) -> *mut Binary<'a> {
        // TODO(port): parent.create(Binary) allocates `Binary` from the parent's allocator
        // and returns an uninitialized *mut Binary. Phase B: decide whether StatePtrUnion::create
        // returns &mut MaybeUninit<Self> or Box<Self>.
        let binary: &mut Binary<'a> = parent.create::<Binary<'a>>();
        binary.node = node;
        binary.base = State::init_with_new_alloc_scope(StateKind::Binary, interpreter, shell_state);
        binary.parent = parent;
        binary.io = io;
        binary.left = None;
        binary.right = None;
        binary.currently_executing = None;
        binary
    }

    pub fn start(&mut self) -> Yield {
        log!(
            "binary start {:x} ({})",
            self as *const _ as usize,
            <&'static str>::from(self.node.op)
        );
        debug_assert!(self.left.is_none());
        debug_assert!(self.right.is_none());
        debug_assert!(self.currently_executing.is_none());

        self.currently_executing = self.make_child(true);
        if self.currently_executing.is_none() {
            self.currently_executing = self.make_child(false);
            self.left = Some(0);
        }
        debug_assert!(self.currently_executing.is_some());
        self.currently_executing.as_mut().unwrap().start()
    }

    fn make_child(&mut self, left: bool) -> Option<ChildPtr> {
        let node = if left { &self.node.left } else { &self.node.right };
        match node {
            ast::Expr::Cmd(cmd_node) => {
                let cmd = Cmd::init(
                    self.base.interpreter,
                    self.base.shell,
                    cmd_node,
                    Cmd::ParentPtr::init(self),
                    self.io.copy(),
                );
                Some(ChildPtr::init(cmd))
            }
            ast::Expr::Binary(binary_node) => {
                let binary = Binary::init(
                    self.base.interpreter,
                    self.base.shell,
                    binary_node,
                    Binary::ParentPtr::init(self),
                    self.io.copy(),
                );
                Some(ChildPtr::init(binary))
            }
            ast::Expr::Pipeline(pipeline_node) => {
                let pipeline = Pipeline::init(
                    self.base.interpreter,
                    self.base.shell,
                    pipeline_node,
                    Pipeline::ParentPtr::init(self),
                    self.io.copy(),
                );
                Some(ChildPtr::init(pipeline))
            }
            ast::Expr::Assign(assigns) => {
                let assign = Assigns::init(
                    self.base.interpreter,
                    self.base.shell,
                    assigns,
                    AssignCtx::Shell,
                    Assigns::ParentPtr::init(self),
                    self.io.copy(),
                );
                Some(ChildPtr::init(assign))
            }
            ast::Expr::Subshell(subshell_node) => {
                match Subshell::init_dupe_shell_state(
                    self.base.interpreter,
                    self.base.shell,
                    subshell_node,
                    Subshell::ParentPtr::init(self),
                    self.io.copy(),
                ) {
                    Ok(subshell) => Some(ChildPtr::init(subshell)),
                    Err(e) => {
                        self.base.throw(&ShellErr::new_sys(e));
                        None
                    }
                }
            }
            ast::Expr::If(if_node) => {
                let if_clause = If::init(
                    self.base.interpreter,
                    self.base.shell,
                    if_node,
                    If::ParentPtr::init(self),
                    self.io.copy(),
                );
                Some(ChildPtr::init(if_clause))
            }
            ast::Expr::Condexpr(condexpr_node) => {
                let condexpr = CondExpr::init(
                    self.base.interpreter,
                    self.base.shell,
                    condexpr_node,
                    CondExpr::ParentPtr::init(self),
                    self.io.copy(),
                );
                Some(ChildPtr::init(condexpr))
            }
            ast::Expr::Async(async_node) => {
                let r#async = Async::init(
                    self.base.interpreter,
                    self.base.shell,
                    async_node,
                    Async::ParentPtr::init(self),
                    self.io.copy(),
                );
                Some(ChildPtr::init(r#async))
            }
        }
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        debug_assert!(self.left.is_none() || self.right.is_none());
        debug_assert!(self.currently_executing.is_some());
        log!(
            "binary child done {:x} ({}) {}",
            self as *const _ as usize,
            <&'static str>::from(self.node.op),
            if self.left.is_none() { "left" } else { "right" }
        );

        child.deinit();
        self.currently_executing = None;

        if self.left.is_none() {
            self.left = Some(exit_code);
            if (self.node.op == ast::BinaryOp::And && exit_code != 0)
                || (self.node.op == ast::BinaryOp::Or && exit_code == 0)
            {
                return self.parent.child_done(self, exit_code);
            }

            self.currently_executing = self.make_child(false);
            if self.currently_executing.is_none() {
                self.right = Some(0);
                return self.parent.child_done(self, 0);
            }

            return self.currently_executing.as_mut().unwrap().start();
        }

        self.right = Some(exit_code);
        self.parent.child_done(self, exit_code)
    }

    // TODO(port): not `impl Drop` — this is a self-destroying deinit that frees `self` via the
    // parent's allocator (parent-owned arena allocation). Drop cannot take params or destroy
    // its own backing storage. Phase B: reconcile with StatePtrUnion ownership model.
    pub fn deinit(&mut self) {
        if let Some(child) = self.currently_executing.take() {
            child.deinit();
        }
        self.io.deinit();
        self.base.end_scope();
        // SAFETY: `self` was allocated by `parent.create(Binary)` from this allocator;
        // after this call `self` is freed and must not be accessed.
        unsafe {
            self.parent.allocator().destroy(self);
        }
    }
}

// TODO(port): `StateKind::Binary` / `AssignCtx::Shell` — exact enum names from sibling modules
use bun_shell::interpreter::{AssignCtx, StateKind};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Binary.zig (174 lines)
//   confidence: medium
//   todos:      4
//   notes:      StatePtrUnion self-ref lifetime + parent-allocator self-destroy need Phase B ownership design
// ──────────────────────────────────────────────────────────────────────────

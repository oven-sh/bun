//! State node for a shell script. Used for the top-level script as well as
//! command-substitution and subshell bodies.

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::stmt::Stmt;
use crate::shell::yield_::Yield;

pub struct Script {
    pub base: Base,
    /// Back-reference into the bumpalo-allocated AST (`ShellArgs::__arena`).
    /// The arena outlives every state node (it's dropped only when the
    /// interpreter is finalized), so the BackRef invariant holds. Stored
    /// lifetime-erased to keep `Node` lifetime-free.
    pub node: bun_ptr::BackRef<ast::Script>,
    pub io: IO,
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

impl Script {
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Script,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Script(Script {
            base: Base::new(StateKind::Script, parent, shell),
            // SAFETY: `node` is non-null and points into the AST arena
            // (`ShellArgs::__arena`), which the interpreter holds for its
            // entire lifetime — strictly outliving every state node (the
            // BackRef invariant). Callers pass `&raw const` only to escape
            // borrowck across the `&Interpreter` reborrow.
            node: unsafe { bun_ptr::BackRef::from_raw(node as *mut ast::Script) },
            io,
            state: ScriptState::default(),
        }));
        log!("Script {} init (parent={})", id, parent);
        id
    }

    pub fn start(interp: &Interpreter, this: NodeId) -> Yield {
        if Self::stmt_count(interp, this) == 0 {
            return Self::finish(interp, this, 0);
        }
        Yield::Next(this)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let (idx, shell) = {
            let me = interp.as_script_mut(this);
            let len = Self::stmt_count_of(me);
            let ScriptState::Normal { idx } = &mut me.state;
            if *idx >= len {
                return Yield::suspended();
            }
            let i = *idx;
            *idx += 1;
            (i, me.base.shell)
        };
        // PORT NOTE: reshaped for borrowck — captured idx/shell into locals
        // before re-borrowing interp for Stmt::init.
        let stmt_node = Self::stmt_at(interp, this, idx);
        let io = interp.as_script(this).io.clone();
        let stmt = Stmt::init(interp, shell, stmt_node, this, io);
        Stmt::start(interp, stmt)
    }

    fn finish(interp: &Interpreter, this: NodeId, exit_code: ExitCode) -> Yield {
        let parent = interp.as_script(this).base.parent;
        interp.child_done(parent, this, exit_code)
    }

    pub fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        interp.deinit_node(child);
        let (idx, len) = {
            let me = interp.as_script(this);
            let ScriptState::Normal { idx } = me.state;
            (idx, Self::stmt_count_of(me))
        };
        if idx >= len {
            return Self::finish(interp, this, exit_code);
        }
        Self::next(interp, this)
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Script {} deinit", this);
        let parent = interp.as_script(this).base.parent;
        let parent_kind = if parent == NodeId::INTERPRETER {
            None
        } else {
            Some(interp.node(parent).kind())
        };
        let me = interp.as_script_mut(this);
        // io.deref() — IO uses Arc fields; Drop on the cloned `io` handles the
        // refcount decrement, no explicit call needed.
        if !matches!(parent_kind, None | Some(StateKind::Subshell)) {
            // The shell env is owned by the parent when the parent is the
            // Interpreter or a Subshell; otherwise this Script represents a
            // command substitution which duped from the parent and must
            // deinitialize it (Zig: `this.base.shell.deinit()`).
            if !me.base.shell.is_null() {
                ShellExecEnv::deinit_impl(me.base.shell);
                me.base.shell = core::ptr::null_mut();
            }
        }
        me.base.end_scope();
        // free_node is done by the caller (Interpreter::deinit_node).
    }

    pub fn deinit_from_interpreter(interp: &Interpreter, this: NodeId) {
        log!("Script {} deinitFromInterpreter", this);
        let me = interp.as_script_mut(this);
        // io.deinit() — IO Drop handles it.
        // Let the interpreter deinitialize the root shell state.
        me.base.end_scope();
    }

    // ── AST helpers ────────────────────────────────────────────────────────

    #[inline]
    fn stmt_count(interp: &Interpreter, this: NodeId) -> usize {
        Self::stmt_count_of(interp.as_script(this))
    }

    #[inline]
    fn stmt_count_of(me: &Script) -> usize {
        me.node.stmts.len()
    }

    #[inline]
    fn stmt_at(interp: &Interpreter, this: NodeId, idx: usize) -> *const ast::Stmt {
        let me = interp.as_script(this);
        &me.node.stmts[idx]
    }
}

// ported from: src/shell/states/Script.zig

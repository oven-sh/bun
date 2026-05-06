//! State node for a shell script. Used for the top-level script as well as
//! command-substitution and subshell bodies.

use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::stmt::Stmt;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Script {
    pub base: Base,
    /// Raw pointer into the bumpalo-allocated AST (`ShellArgs::__arena`). The
    /// arena outlives every state node (it's dropped only when the interpreter
    /// is finalized), so dereferencing is sound. Stored raw to keep `Node`
    /// lifetime-free.
    pub node: *const ast::Script,
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
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Script,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Script(Script {
            base: Base::new(StateKind::Script, parent, shell),
            node,
            io,
            state: ScriptState::default(),
        }));
        log!("Script {} init (parent={})", id, parent);
        id
    }

    pub fn start(interp: &mut Interpreter, this: NodeId) -> Yield {
        if Self::stmt_count(interp, this) == 0 {
            return Self::finish(interp, this, 0);
        }
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
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

    fn finish(interp: &mut Interpreter, this: NodeId, exit_code: ExitCode) -> Yield {
        let parent = interp.as_script(this).base.parent;
        interp.child_done(parent, this, exit_code)
    }

    pub fn child_done(
        interp: &mut Interpreter,
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

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("Script {} deinit", this);
        let parent = interp.as_script(this).base.parent;
        let parent_kind = if parent == NodeId::INTERPRETER {
            None
        } else {
            Some(interp.node(parent).kind())
        };
        let me = interp.as_script_mut(this);
        // io.deref() — Drop on IO clones handles refcounts; explicit no-op kept
        // for parity.
        if !matches!(parent_kind, None | Some(StateKind::Subshell)) {
            // The shell env is owned by the parent when the parent is the
            // Interpreter or a Subshell; otherwise this Script is a command
            // substitution which duped from the parent and must deinit it.
            // TODO(b2-blocked): ShellExecEnv::deinit_impl — gated body.
            let _ = me.base.shell;
        }
        me.base.end_scope();
        // free_node is done by the caller (Interpreter::deinit_node).
    }

    pub fn deinit_from_interpreter(interp: &mut Interpreter, this: NodeId) {
        log!("Script {} deinitFromInterpreter", this);
        let me = interp.as_script_mut(this);
        // io.deinit() — IO Drop handles it.
        // Let the interpreter deinitialize the root shell state.
        me.base.end_scope();
    }

    // ── AST helpers (opaque until shell parser un-gates) ───────────────────

    #[inline]
    fn stmt_count(interp: &Interpreter, this: NodeId) -> usize {
        Self::stmt_count_of(interp.as_script(this))
    }

    #[inline]
    fn stmt_count_of(_me: &Script) -> usize {
        // TODO(b2-blocked): ast::Script::stmts — `(*self.node).stmts.len()`.
        0
    }

    #[inline]
    fn stmt_at(_interp: &Interpreter, _this: NodeId, _idx: usize) -> *const ast::Stmt {
        // TODO(b2-blocked): ast::Script::stmts — `&(*self.node).stmts[idx]`.
        core::ptr::null()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Script.zig (133 lines)
//   confidence: high (NodeId-arena conversion complete)
//   blocked_on: ast::Script field access (shell parser gated)
// ──────────────────────────────────────────────────────────────────────────

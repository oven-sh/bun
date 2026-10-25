mod classes;
mod expressions;
mod functions;
mod prepass;
mod statements;
#[cfg(test)]
mod tests;
mod walker;

use bun_sema::bind::{Binding, Bound, ScopeId, SymbolId};
use bun_sema::fold::{Decisions, TreeNode};
use bun_sema::hir::{self, ClassId, ExprId, FnId, MemberId, StmtId};

pub(super) use self::walker::walk_file;
use super::{BindingRef, ScopeInput, ScopeSlot};
use crate::ir::FunctionKey;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(in crate::lower) struct WalkedFunctionId(pub(in crate::lower) u32);

impl WalkedFunctionId {
    pub(in crate::lower) const MODULE_BODY: WalkedFunctionId = WalkedFunctionId(0);

    pub(in crate::lower) fn index(self) -> usize {
        self.0 as usize
    }
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct WalkedFunction {
    pub(in crate::lower) key: FunctionKey,
    pub(in crate::lower) creator: Option<WalkedFunctionId>,
    pub(in crate::lower) created_at: u32,
    pub(in crate::lower) hoisted_to: Option<ScopeId>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) struct Initialization {
    pub(in crate::lower) time: u32,
    pub(in crate::lower) precedes_hoisted_functions: bool,
}

impl Initialization {
    pub(in crate::lower) const AT_SCOPE_ENTRY: Initialization = Initialization {
        time: 0,
        precedes_hoisted_functions: true,
    };
    pub(in crate::lower) const WITH_HOISTED_FUNCTIONS: Initialization = Initialization {
        time: 0,
        precedes_hoisted_functions: false,
    };
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) struct EvalUse {
    pub(super) function: WalkedFunctionId,
    pub(super) binding: BindingRef,
    pub(super) time: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ArgumentRead {
    Count,
    At(u32),
}

#[derive(Debug)]
pub(super) struct WalkedLoop {
    pub(super) statement: StmtId,
    pub(super) boundary: ScopeId,
    pub(super) function: WalkedFunctionId,
    pub(super) parent: Option<u32>,
    pub(super) stored: Vec<BindingRef>,
}

#[derive(Default)]
pub(super) struct ScopeWalk {
    pub(super) functions: Vec<WalkedFunction>,
    pub(super) function_of_fn: Vec<Option<WalkedFunctionId>>,
    pub(super) function_of_field: Vec<(MemberId, WalkedFunctionId)>,
    pub(super) uses: Vec<(WalkedFunctionId, BindingRef)>,
    pub(super) function_references: Vec<(WalkedFunctionId, FnId)>,
    pub(super) argument_reads: Vec<(WalkedFunctionId, ArgumentRead)>,
    pub(super) eval_uses: Vec<EvalUse>,
    pub(super) stored_slots: Vec<(ScopeId, ScopeSlot)>,
    pub(super) symbol_initializations: Vec<Option<Initialization>>,
    // The initialization stands under a branch, a loop, a `try`, a `switch`, a label or a `with` of its function, so code behind it in the text may run without it.
    pub(super) is_initialized_conditionally: Vec<bool>,
    pub(super) slot_initializations: Vec<((ScopeId, ScopeSlot), u32)>,
    pub(super) hoisted_functions: Vec<(ScopeId, SymbolId, FnId)>,
    pub(super) loops: Vec<WalkedLoop>,
    // Each identifier that a symbol is stored through, with the function that it stands in.
    pub(super) symbol_stores: Vec<(SymbolId, ExprId, WalkedFunctionId)>,
    // The time behind which none of those stores runs in the activation that owns the symbol, as long as they all stand in its own function.
    pub(super) last_store_times: Vec<u32>,
    pub(super) is_switch_scope: Vec<bool>,
    pub(super) is_repeated_scope: Vec<bool>,
    pub(super) eval_variable_scopes: Vec<ScopeId>,
    // The text of the file is a function of `this` and the five names of a CommonJS module.
    pub(super) has_wrapper_parameters: bool,
}

#[derive(Copy, Clone)]
enum Task {
    Statement(StmtId),
    Expression(ExprId),
    MarkCreated(WalkedFunctionId),
    InitializeSymbol(SymbolId),
    InitializeParameter(SymbolId),
    InitializeSlot(ScopeId, ScopeSlot),
    EndStores { first_pending: u32 },
    EndLoop(u32),
}

#[derive(Copy, Clone)]
struct Context {
    function: WalkedFunctionId,
    lexical_scope: ScopeId,
    enclosing_loop: Option<u32>,
    is_repeated: bool,
    is_conditional: bool,
}

impl Context {
    fn conditional(self) -> Context {
        Context {
            is_conditional: true,
            ..self
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum PatternRole {
    UnstoredVar,
    StoredVar,
    LexicalDeclaration,
    Parameter,
}

struct Walker<'x, 's> {
    input: &'x ScopeInput<'x, 's>,
    hir: &'x hir::File<'s>,
    bound: &'x Bound<'s>,
    decisions: &'x Decisions<'s>,
    lexical_owners: &'x [ScopeId],
    is_commonjs: bool,
    file_scope: ScopeId,
    // `exports` and `module` of each `__commonJS((exports, module) => { .. })` whose callback is the body of a module, in order.
    inner_module_parameters: Vec<SymbolId>,
    jsx_uses: Vec<(ExprId, Binding)>,
    metadata_uses: Vec<(ClassId, Binding)>,
    class_decorators: Vec<(ClassId, ExprId)>,
    last_users: Vec<Option<WalkedFunctionId>>,
    pending_stores: Vec<SymbolId>,
    clock: u32,
    walk: ScopeWalk,
    stack: Vec<(Task, Context)>,
    children: Vec<TreeNode>,
}

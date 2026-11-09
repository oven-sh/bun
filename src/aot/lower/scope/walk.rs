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
    pub(in crate::lower) is_made_late: bool,
    pub(in crate::lower) is_only_called_directly: bool,
    pub(in crate::lower) is_laid_in_literal: bool,
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

#[derive(Copy, Clone, Debug)]
pub(super) struct DeclarationRead {
    pub(super) symbol: SymbolId,
    pub(super) function: FnId,
    pub(super) owner: WalkedFunctionId,
    pub(super) reader: WalkedFunctionId,
    pub(super) enclosing_loop: Option<u32>,
    pub(super) time: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ArgumentRead {
    Count,
    At(u32),
}

#[derive(Debug)]
pub(super) struct WalkedTry {
    pub(super) statement: StmtId,
    pub(super) boundary: ScopeId,
    pub(super) function: WalkedFunctionId,
    pub(super) parent: Option<u32>,
    pub(super) stored: Vec<BindingRef>,
    pub(super) size: u32,
}

#[derive(Debug)]
pub(super) struct WalkedLoop {
    pub(super) statement: StmtId,
    pub(super) boundary: ScopeId,
    pub(super) function: WalkedFunctionId,
    pub(super) parent: Option<u32>,
    pub(super) entered_at: u32,
    pub(super) outermost: u32,
    pub(super) stored: Vec<BindingRef>,
    pub(super) symbols_stored_within: Vec<SymbolId>,
}

#[derive(Default)]
pub(super) struct ScopeWalk {
    pub(super) functions: Vec<WalkedFunction>,
    pub(super) function_of_fn: Vec<Option<WalkedFunctionId>>,
    pub(super) function_of_field: Vec<(MemberId, WalkedFunctionId)>,
    pub(super) uses: Vec<(WalkedFunctionId, BindingRef)>,
    pub(super) use_counts: Vec<u8>,
    pub(super) function_references: Vec<(WalkedFunctionId, FnId)>,
    pub(super) calls_by_name: Vec<(ExprId, FnId)>,
    pub(super) made_at_first_read: Vec<(SymbolId, FnId)>,
    pub(super) functions_laid_in_literals: Vec<FnId>,
    pub(super) created_at_each_read: Vec<SymbolId>,
    pub(super) is_looked_at: Vec<bool>,
    pub(super) names_handed_to_declarations: Vec<(SymbolId, FnId, u32)>,
    pub(super) functions_that_name_arguments: Vec<FnId>,
    pub(super) functions_created_before_loops: Vec<(StmtId, SymbolId)>,
    pub(super) declaration_reads: Vec<DeclarationRead>,
    pub(super) declarations_read_by_every_run: Vec<SymbolId>,
    pub(super) makers_of_closures_in_every_run: Vec<WalkedFunctionId>,
    pub(super) sites_that_start: Vec<(FnId, WalkedFunctionId, u32)>,
    pub(super) names_called: Vec<SymbolId>,
    pub(super) argument_reads: Vec<(WalkedFunctionId, ArgumentRead)>,
    pub(super) eval_uses: Vec<EvalUse>,
    pub(super) evals_under_names_of_file: Vec<(WalkedFunctionId, u32)>,
    pub(super) stored_slots: Vec<(ScopeId, ScopeSlot)>,
    pub(super) this_bindings: Vec<(ScopeId, bool)>,
    pub(super) symbol_initializations: Vec<Option<Initialization>>,
    pub(super) is_initialized_conditionally: Vec<bool>,
    pub(super) slot_initializations: Vec<((ScopeId, ScopeSlot), u32)>,
    pub(super) hoisted_functions: Vec<(ScopeId, SymbolId, FnId)>,
    pub(super) loops: Vec<WalkedLoop>,
    pub(super) tries: Vec<WalkedTry>,
    pub(super) symbol_stores: Vec<(SymbolId, ExprId, WalkedFunctionId)>,
    pub(super) last_store_times: Vec<u32>,
    pub(super) is_switch_scope: Vec<bool>,
    pub(super) is_repeated_scope: Vec<bool>,
    pub(super) eval_variable_scopes: Vec<ScopeId>,
    pub(super) parameter_eval_variable_scopes: Vec<ScopeId>,
    pub(super) has_wrapper_parameters: bool,
    pub(super) has_values_of_each_run: bool,
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
    EndDecoratedClass { first_store: u32 },
    EndLoop(u32),
    EndTry(u32),
}

#[derive(Copy, Clone)]
struct Context {
    function: WalkedFunctionId,
    lexical_scope: ScopeId,
    enclosing_loop: Option<u32>,
    enclosing_try: Option<u32>,
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
    inner_module_parameters: Vec<SymbolId>,
    jsx_uses: Vec<(ExprId, Binding)>,
    metadata_uses: Vec<(ClassId, Binding)>,
    class_decorators: Vec<(ClassId, ExprId)>,
    last_users: Vec<Option<WalkedFunctionId>>,
    pending_stores: Vec<SymbolId>,
    unconditional_statements: Vec<ExprId>,
    clock: u32,
    number_walked: u32,
    is_only_called_or_tested: Vec<bool>,
    walk: ScopeWalk,
    stack: Vec<(Task, Context)>,
    children: Vec<TreeNode>,
}

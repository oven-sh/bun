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
    // A declared function that is not instantiated at scope entry. `created_at` is the earliest time at which a direct call can enter it or a read of its name can create its closure.
    pub(in crate::lower) is_made_late: bool,
    // Nothing reads the name, so the function has no closure.
    pub(in crate::lower) is_only_called_directly: bool,
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
pub(super) struct WalkedLoop {
    pub(super) statement: StmtId,
    pub(super) boundary: ScopeId,
    pub(super) function: WalkedFunctionId,
    pub(super) parent: Option<u32>,
    pub(super) entered_at: u32,
    /// The loop of the same code that no other loop is around, itself where it is that one.
    pub(super) outermost: u32,
    /// What is stored in it and in no loop inside it, once for each store.
    pub(super) stored: Vec<BindingRef>,
    /// Of the outermost loop, until it ends: what is stored in it and in the loops inside it, once for each store.
    pub(super) symbols_stored_within: Vec<SymbolId>,
}

#[derive(Default)]
pub(super) struct ScopeWalk {
    pub(super) functions: Vec<WalkedFunction>,
    pub(super) function_of_fn: Vec<Option<WalkedFunctionId>>,
    pub(super) function_of_field: Vec<(MemberId, WalkedFunctionId)>,
    pub(super) uses: Vec<(WalkedFunctionId, BindingRef)>,
    // In how many places the code that is compiled names each symbol.
    pub(super) use_counts: Vec<u8>,
    pub(super) function_references: Vec<(WalkedFunctionId, FnId)>,
    // The calls that enter a function itself, and do not read the name of the callee.
    pub(super) calls_by_name: Vec<(ExprId, FnId)>,
    // The declared functions that somebody reads as values, each made where it is first read.
    pub(super) made_at_first_read: Vec<(SymbolId, FnId)>,
    // Of those, the ones that a loop of their owner reads: the closure is created in front of the loop.
    pub(super) functions_created_before_loops: Vec<(StmtId, SymbolId)>,
    pub(super) declaration_reads: Vec<DeclarationRead>,
    // A nested function reads them too, and every run of the function around them reads them: they are made where their scope is entered.
    pub(super) declarations_read_by_every_run: Vec<SymbolId>,
    // The functions of which every run makes a closure: `function createChecker() { .. return { check, typeOf: n => .. }; }`. Their scopes live on whatever is made late,
    // and a function like that declares hundreds of names which thousands of places read: they are made where the scope is entered, as ever.
    pub(super) makers_of_closures_in_every_run: Vec<WalkedFunctionId>,
    // Each of them once more: the function, who calls, and when.
    pub(super) sites_that_start: Vec<(FnId, WalkedFunctionId, u32)>,
    // The names that an expression fills and that such a call names: `use_counts` does not count those places, and Bun's transpiler does.
    pub(super) names_called: Vec<SymbolId>,
    pub(super) argument_reads: Vec<(WalkedFunctionId, ArgumentRead)>,
    pub(super) eval_uses: Vec<EvalUse>,
    pub(super) stored_slots: Vec<(ScopeId, ScopeSlot)>,
    // Each place that may bind `this` of a derived constructor, by the scope of the constructor, and whether it is a `super(..)` that every run of the constructor's own code comes to before what stands behind it.
    pub(super) this_bindings: Vec<(ScopeId, bool)>,
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
    pub(super) parameter_eval_variable_scopes: Vec<ScopeId>,
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
    EndDecoratedClass { first_store: u32 },
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
    // The expressions of the expression statements that stand under no branch, loop, `try`, `switch`, label or `with` of their function.
    unconditional_statements: Vec<ExprId>,
    clock: u32,
    walk: ScopeWalk,
    stack: Vec<(Task, Context)>,
    children: Vec<TreeNode>,
}

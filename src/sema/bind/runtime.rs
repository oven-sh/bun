mod binding_kinds;
mod bits;
mod block_functions;
mod declaration_kinds;
mod declarations;
mod direct_evals;
mod duplicate_names;
mod implicit_references;
mod lookup;
mod merged_declarations;
mod metadata_references;
mod namespace_exports;
#[cfg(test)]
mod parent_tests;
mod private_names;
mod queries;
mod references;
mod stability;
mod storage;
mod stores;
#[cfg(test)]
mod tests;
mod type_only_code;

use self::declaration_kinds::{Declaration, FunctionPosition, statement_position};
pub use self::storage::RuntimeTablesIn;
use super::decorator_metadata::MetadataReference;
use super::{BoundBuilder, Decl, ScopeId, SymbolId};
use crate::atom::{Atom, Intern, known};
use crate::hir::*;
use crate::util::FxHashMap;
use smallvec::SmallVec;

define_id!(PrivateNameId);

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub struct RuntimeBindOptions {
    pub jsx_factory_root: Option<Atom>,
    pub jsx_fragment_root: Option<Atom>,
    pub emits_decorator_metadata: bool,
    pub hoists_top_level_variables: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum CommonJsVariable {
    Module,
    Exports,
    Require,
    Filename,
    Dirname,
}

impl CommonJsVariable {
    pub fn name(self) -> Atom {
        match self {
            CommonJsVariable::Module => known::module,
            CommonJsVariable::Exports => known::exports,
            CommonJsVariable::Require => known::require,
            CommonJsVariable::Filename => known::filename,
            CommonJsVariable::Dirname => known::dirname,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum CodeUnit {
    File,
    Function(FnId),
    FieldInitializer(MemberId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Binding {
    Symbol(SymbolId),
    Arguments(CodeUnit),
    CommonJs(CommonJsVariable),
    Free,
}

impl Binding {
    #[inline]
    pub(super) fn from_symbol(symbol: SymbolId) -> Binding {
        symbol.some().map_or(Binding::Free, Binding::Symbol)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]
pub enum BindingKind {
    #[default]
    NoBinding,
    Import,
    TypeScriptContainer,
    Var,
    Let,
    Const,
    SimpleCatchParameter,
    Class,
    ClassInnerName,
    Function,
    FunctionName,
    Parameter,
}

impl BindingKind {
    pub fn is_immutable(self) -> bool {
        matches!(
            self,
            BindingKind::Import
                | BindingKind::Const
                | BindingKind::ClassInnerName
                | BindingKind::FunctionName
        )
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum InitialState {
    Uninitialized,
    Undefined,
    Initialized,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
pub enum BindingStability {
    #[default]
    NoBinding,
    Stable,
    Linked,
    Stored,
    NotInitializedOnce,
    VisibleToEval,
    MappedArgument,
    ContainerMember,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum BindingInitializer {
    Class(ClassId),
    Function(FnId),
    Namespace(ModuleId),
    Enum(EnumId),
    Expression(ExprId),
    PatternProperty {
        source: ExprId,
        path: SmallVec<[Atom; 2]>,
    },
    EntityName(ImportEqualsId),
    Import,
    Opaque,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct FunctionFlags: u8 {
        const HAS_PARAMETER_EXPRESSIONS = 1 << 0;
        const USES_ARGUMENTS = 1 << 1;
        const HAS_DIRECT_EVAL = 1 << 2;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ImplicitReferenceKind {
    JsxFactory,
    JsxFragment,
    DecoratorMetadata(MetadataReference),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum StoreKind {
    Assign,
    CompoundAssign(BinOp),
    Update(UnOp),
    Destructure,
    ForIn,
    ForOf,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SymbolStore {
    pub symbol: SymbolId,
    pub target: ExprId,
    pub kind: StoreKind,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct EarlyRedeclaration {
    pub earlier: Decl,
    pub later: Decl,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct EvalScope {
    pub scope: ScopeId,
    pub symbols: IdList<SymbolId>,
    pub is_sloppy: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct AnnexBFunction {
    pub function: FnId,
    pub block_symbol: SymbolId,
    pub var_symbol: SymbolId,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ParameterVarCopy {
    pub function: FnId,
    pub parameter: SymbolId,
    pub variable: SymbolId,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ImplicitReference {
    pub node: NodeData,
    pub kind: ImplicitReferenceKind,
    pub name: Atom,
    pub binding: Binding,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum PrivateMembers {
    Field(MemberId),
    Method(MemberId),
    Accessor {
        getter: Option<MemberId>,
        setter: Option<MemberId>,
    },
    AutoAccessor(MemberId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct PrivateName {
    pub class: ClassId,
    pub name: Atom,
    pub first_member: MemberId,
    pub members: PrivateMembers,
    pub is_static: bool,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::bind) struct PrivateReference {
    pub reference: ExprId,
    pub name: Atom,
    pub class: Option<ClassId>,
}

pub struct RuntimeBindingsIn<S: Storage> {
    tables: Option<S::Boxed<RuntimeTablesIn<S>>>,
}

pub type RuntimeBindings<'s> = RuntimeBindingsIn<InArena<'s>>;

impl<S: Storage> Default for RuntimeBindingsIn<S> {
    #[inline]
    fn default() -> Self {
        RuntimeBindingsIn { tables: None }
    }
}

impl<S: Storage> std::ops::Deref for RuntimeBindingsIn<S> {
    type Target = RuntimeTablesIn<S>;

    #[inline]
    fn deref(&self) -> &RuntimeTablesIn<S> {
        let tables = self.tables.as_deref();
        tables.expect("the file was bound without BindOptions::runtime")
    }
}

impl<S: Storage> std::ops::DerefMut for RuntimeBindingsIn<S> {
    #[inline]
    fn deref_mut(&mut self) -> &mut RuntimeTablesIn<S> {
        let tables = self.tables.as_deref_mut();
        tables.expect("the file was bound without BindOptions::runtime")
    }
}

const _: () = assert!(size_of::<(ExprId, Binding)>() <= 12 && size_of::<CodeUnit>() <= 8);
const _: () = assert!(size_of::<Option<Decl>>() == size_of::<Decl>());
const _: () = assert!(size_of::<RuntimeBindings<'static>>() == size_of::<usize>());

pub(in crate::bind) struct RuntimeInput<'a, 's> {
    pub hir: &'a File<'s>,
    pub bound: &'a mut BoundBuilder,
    pub idents: &'a [(ExprId, ScopeId)],
    pub options: RuntimeBindOptions,
    pub atoms: &'a dyn Intern,
}

#[derive(Default)]
struct RuntimeScopes {
    appended_bindings: FxHashMap<(ScopeId, Atom), (SymbolId, Declaration)>,
    hoisted_requires: Vec<(PatId, ScopeId)>,
    hidden_symbols: Vec<u64>,
    body_variables: Vec<(SymbolId, SymbolId)>,
    strict_scopes: Vec<u64>,
}

pub(in crate::bind) fn compute(
    mut input: RuntimeInput<'_, '_>,
    private_references: Vec<PrivateReference>,
) {
    input.bound.runtime.tables = Some(Box::default());
    input.bound.runtime.hoists_top_level_variables = input.options.hoists_top_level_variables;
    input.bound.runtime.first_appended_symbol = input.bound.symbols.len() as u32;
    let scopes = declarations::compute_declarations(&mut input);
    references::compute_references(&mut input, &scopes);
    input.bound.runtime.appended_symbol_end = input.bound.symbols.len() as u32;
    private_names::compute_private_names(&mut input, private_references);
    stability::compute_stability(&mut input);
    let has_sloppy_label =
        block_functions::has_sloppy_labeled_function(input.hir, input.bound, &scopes.strict_scopes);
    let runtime = &mut *input.bound.runtime;
    runtime.depends_on_sloppy_mode |= has_sloppy_label;
    runtime.strict_scopes = scopes.strict_scopes;
    debug_assert!(runtime.is_sorted());
}

pub(in crate::bind) fn has_implicit_block(
    hir: &File<'_>,
    bound: &BoundBuilder,
    statement: StmtId,
    function: FnId,
) -> bool {
    block_functions::is_block_function_declaration(hir, function)
        && statement_position(hir, bound, statement) == FunctionPosition::ImplicitBlock
}

pub fn has_simple_parameter_list(hir: &File<'_>, function: FnId) -> bool {
    hir[function].params.iter().all(|parameter| {
        let node = hir[parameter];
        matches!(hir[node.pat].kind, PatKind::Ident(_))
            && node.default.is_none()
            && !node.flags.contains(Flags::REST)
    })
}

pub fn has_mapped_arguments(hir: &File<'_>, unit: CodeUnit) -> bool {
    match unit {
        CodeUnit::File => !hir.is_strict,
        CodeUnit::Function(function) => {
            !hir[function].is_strict && has_simple_parameter_list(hir, function)
        }
        CodeUnit::FieldInitializer(_) => false,
    }
}

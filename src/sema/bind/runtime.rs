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

use self::declaration_kinds::{FunctionPosition, statement_position};
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
    /// `BoundIn::variable_kind`
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

pub struct RuntimeTablesIn<S: Storage> {
    pub(in crate::bind) is_module: bool,
    pub(in crate::bind) depends_on_sloppy_mode: bool,
    pub(in crate::bind) file_uses_arguments: bool,
    pub(in crate::bind) import_meta_may_be_modified: bool,
    pub(in crate::bind) hoists_top_level_variables: bool,
    pub(in crate::bind) first_appended_symbol: u32,
    pub(in crate::bind) appended_symbol_end: u32,
    pub(in crate::bind) strict_scopes: S::List<u64>,
    pub(in crate::bind) function_flags: S::List<FunctionFlags>,
    pub(in crate::bind) field_initializer_scopes: S::Few<(MemberId, ScopeId)>,
    pub(in crate::bind) early_error_redeclarations: S::Few<u32>,
    pub(in crate::bind) declarations: RuntimeDeclarationsIn<S>,
    pub(in crate::bind) references: RuntimeReferencesIn<S>,
    pub(in crate::bind) private_names: PrivateNamesIn<S>,
    pub(in crate::bind) stability: BindingStabilitiesIn<S>,
}

#[derive(Default)]
pub(in crate::bind) struct RuntimeDeclarationsIn<S: Storage> {
    pub pattern_symbols: S::Few<(PatId, SymbolId)>,
    pub function_symbols: S::Few<(FnId, SymbolId)>,
    pub class_symbols: S::Few<(ClassId, SymbolId)>,
    pub enum_symbols: S::Few<(EnumId, SymbolId)>,
    pub module_symbols: S::Few<(ModuleId, SymbolId)>,
    pub inner_class_symbols: S::Few<(ClassId, SymbolId)>,
    pub import_default_symbols: S::List<SymbolId>,
    pub import_namespace_symbols: S::List<SymbolId>,
    pub import_spec_symbols: S::List<SymbolId>,
    pub import_equals_symbols: S::Few<SymbolId>,
    pub export_expression_symbols: S::Few<(StmtId, SymbolId)>,
    pub own_scopes: S::List<(StmtId, ScopeId)>,
    pub symbol_scopes: S::List<ScopeId>,
    pub scope_units: S::List<CodeUnit>,
    pub valueless_symbols: S::List<u64>,
    pub binding_kinds: S::List<BindingKind>,
    pub annex_b_functions: S::Few<AnnexBFunction>,
    pub parameter_var_copies: S::Few<ParameterVarCopy>,
    pub early_redeclarations: S::Few<EarlyRedeclaration>,
    pub goal_independent_redeclaration_count: u32,
}

#[derive(Default)]
pub(in crate::bind) struct RuntimeReferencesIn<S: Storage> {
    pub evaluated_idents: S::List<u64>,
    pub ident_bindings: S::List<(ExprId, Binding)>,
    pub initialized_bindings: S::Few<(PatId, Binding)>,
    pub exported_bindings: S::Few<(ExportSpecId, Binding)>,
    pub entity_root_bindings: S::Few<(ImportEqualsId, Binding)>,
    pub redeclared_commonjs_variables: S::Few<(SymbolId, CommonJsVariable)>,
    pub eval_visible_symbols: S::List<u64>,
    pub stores: S::List<SymbolStore>,
    pub unbound_name_stores: S::Few<(ExprId, StoreKind)>,
    pub store_targets: S::List<u64>,
    pub dynamic_ident_lookups: S::Few<(ExprId, ScopeId)>,
    pub dynamic_declarator_lookups: S::Few<(PatId, ScopeId)>,
    pub eval_scopes: S::Few<(ExprId, EvalScope)>,
    pub jump_targets: S::Few<(StmtId, StmtId)>,
    pub implicit_references: S::Few<ImplicitReference>,
}

#[derive(Default)]
pub(in crate::bind) struct PrivateNamesIn<S: Storage> {
    pub names: S::Few<PrivateName>,
    pub references: S::Few<(ExprId, PrivateNameId)>,
    pub members: S::Few<(MemberId, PrivateNameId)>,
}

#[derive(Default)]
pub(in crate::bind) struct BindingStabilitiesIn<S: Storage> {
    pub stabilities: S::List<BindingStability>,
    pub initializers: S::List<Option<Decl>>,
}

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

impl Default for RuntimeTablesIn<Growable> {
    fn default() -> Self {
        RuntimeTablesIn {
            is_module: false,
            depends_on_sloppy_mode: false,
            file_uses_arguments: false,
            import_meta_may_be_modified: false,
            hoists_top_level_variables: false,
            first_appended_symbol: 0,
            appended_symbol_end: 0,
            strict_scopes: Vec::new(),
            function_flags: Vec::new(),
            field_initializer_scopes: Vec::new(),
            early_error_redeclarations: Vec::new(),
            declarations: RuntimeDeclarationsIn::default(),
            references: RuntimeReferencesIn::default(),
            private_names: PrivateNamesIn::default(),
            stability: BindingStabilitiesIn::default(),
        }
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
    appended_bindings: FxHashMap<(ScopeId, Atom), SymbolId>,
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

use super::find::{BindingValues, Certainty, HeldFunction, KnownReference};
use super::{Helper, KnownHelpers, Shape};
use crate::modules::{
    ExportBinding, ExportLookup, ImportBinding, ModuleGraph, ModuleRef, SiteAnswer,
    find_name_stored_as_module_exports,
};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, BindingKind, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{BinOp, Chain, ExprId, ExprKind, FnId, MemberKey, NodeData};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files, Sym};
use smallvec::SmallVec;

const MAX_INDIRECT_EXPORTS: usize = 8;

#[derive(Copy, Clone)]
pub struct ResolveInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub modules: &'a ModuleGraph,
    pub helpers: &'a KnownHelpers,
}

#[derive(Clone, Debug)]
pub struct KnownCallee {
    pub file: FileId,
    pub functions: SmallVec<[HeldFunction; 2]>,
    pub certainty: Certainty,
    pub holds_from_the_start: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ResolvedReference {
    pub symbol: SymbolId,
    pub function: HeldFunction,
    pub needs_guard: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PrivateStateKind {
    Field,
    Brand,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PrivateStateRole {
    Definition,
    Test,
    HelperArgument,
    Update,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct PrivateStateSite {
    pub state: SymbolId,
    pub kind: PrivateStateKind,
    pub role: PrivateStateRole,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PrivateMemberKind {
    Field,
    Method,
    Getter,
    Setter,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PrivateFieldAccess {
    Get,
    Set {
        value: usize,
    },
    GetMethod {
        member: usize,
    },
    GetReceiver,
    Has,
    /// An operator steps what the accessors of the answer read and store.
    Update,
    /// The entry is a descriptor, which the function reads or stores through.
    ApplyDescriptor {
        function: FnId,
        value: Option<usize>,
    },
    Add {
        value: Option<usize>,
        answers_collection: bool,
    },
    CallGetter {
        getter: usize,
        receiver_is_argument: bool,
    },
    CallSetter {
        setter: usize,
        value: usize,
        receiver_is_argument: bool,
    },
}

#[derive(Clone, Debug)]
pub struct PrivateFieldCall {
    pub callee: KnownCallee,
    pub helper: Helper,
    pub shape: Shape,
    /// Every function that the helper calls is the published one.
    pub is_settled: bool,
    pub receiver: usize,
    pub state: usize,
    pub value: Option<usize>,
    pub member_kind: PrivateMemberKind,
    pub member: Option<usize>,
    pub applies_descriptor: Option<FnId>,
}

impl KnownCallee {
    fn new(file: FileId, values: &BindingValues) -> KnownCallee {
        KnownCallee {
            file,
            functions: values.functions.clone(),
            certainty: values.certainty,
            holds_from_the_start: values.holds_from_the_start,
        }
    }

    fn predicted(self) -> KnownCallee {
        KnownCallee {
            certainty: Certainty::MayHoldOtherValues,
            holds_from_the_start: false,
            ..self
        }
    }

    pub fn shape_of(&self, helpers: &KnownHelpers, function: HeldFunction) -> Option<Shape> {
        Some(helpers.function(self.file, function.definition)?.shape)
    }

    pub fn helper(&self, helpers: &KnownHelpers) -> Option<Helper> {
        let mut families = self
            .functions
            .iter()
            .map(|&function| Some(self.shape_of(helpers, function)?.helper()));
        let first = families.next()??;
        families
            .all(|family| family == Some(first))
            .then_some(first)
    }

    pub fn needs_guard(&self) -> bool {
        self.functions.len() != 1
            || (self.certainty != Certainty::Always && !self.holds_from_the_start)
    }
}

impl PrivateFieldCall {
    pub fn access(&self, kind: PrivateStateKind) -> Option<PrivateFieldAccess> {
        if let Some(function) = self.applies_descriptor {
            let value = self.value;
            return (kind == PrivateStateKind::Field)
                .then_some(PrivateFieldAccess::ApplyDescriptor { function, value });
        }
        match (self.helper, kind, self.member_kind, self.member) {
            (
                Helper::ClassPrivateFieldGet,
                PrivateStateKind::Field,
                PrivateMemberKind::Field,
                None,
            ) => Some(PrivateFieldAccess::Get),
            (
                Helper::ClassPrivateFieldSet,
                PrivateStateKind::Field,
                PrivateMemberKind::Field,
                None,
            ) => Some(PrivateFieldAccess::Set { value: self.value? }),
            (
                Helper::ClassPrivateFieldGet,
                PrivateStateKind::Brand,
                PrivateMemberKind::Method,
                Some(member),
            ) => Some(PrivateFieldAccess::GetMethod { member }),
            (
                Helper::ClassPrivateFieldGet | Helper::PrivateGetterCall,
                PrivateStateKind::Brand,
                PrivateMemberKind::Getter,
                Some(getter),
            ) => Some(PrivateFieldAccess::CallGetter {
                getter,
                receiver_is_argument: self.helper == Helper::PrivateGetterCall,
            }),
            (
                Helper::ClassPrivateFieldSet | Helper::PrivateSetterCall,
                PrivateStateKind::Brand,
                PrivateMemberKind::Setter,
                Some(setter),
            ) => Some(PrivateFieldAccess::CallSetter {
                setter,
                value: self.value?,
                receiver_is_argument: self.helper == Helper::PrivateSetterCall,
            }),
            (Helper::ClassPrivateFieldIn, _, _, _) => Some(PrivateFieldAccess::Has),
            (Helper::PrivateWrapper, PrivateStateKind::Field, PrivateMemberKind::Field, None) => {
                Some(PrivateFieldAccess::Update)
            }
            (Helper::AssertClassBrand, _, _, None) => Some(PrivateFieldAccess::GetReceiver),
            (Helper::AssertClassBrand, _, _, Some(member)) => {
                Some(PrivateFieldAccess::GetMethod { member })
            }
            (Helper::PrivateElementAdd, _, _, _) => match (self.shape, kind) {
                (Shape::PrivateFieldAddSetsEntry, PrivateStateKind::Brand)
                | (Shape::PrivateMethodAddAddsEntry, PrivateStateKind::Field) => None,
                (shape, _) => Some(PrivateFieldAccess::Add {
                    value: self.value,
                    answers_collection: shape == Shape::PrivateElementAddAnswersCollection,
                }),
            },
            _ => None,
        }
    }

    /// The helper compares the state with the receiver where it holds a class.
    pub fn compares_classes(&self) -> bool {
        matches!(
            self.shape,
            Shape::ClassPrivateFieldGetByKind
                | Shape::ClassPrivateFieldSetByKind
                | Shape::ClassPrivateFieldInAsksStateOrComparesConstructor
        )
    }

    pub fn supports_private_state(&self, kind: PrivateStateKind) -> bool {
        let is_callee_certain = self.callee.functions.len() == 1
            && match self.callee.certainty {
                Certainty::Always | Certainty::OnceInitialized => true,
                Certainty::MayHoldOtherValues => false,
            };
        is_callee_certain && self.is_settled && self.access(kind).is_some()
    }
}

pub fn resolve_callee(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    callee: ExprId,
) -> Option<KnownCallee> {
    let (hir, bound) = (input.files.hir(file), input.files.bound(file));
    let mut callee = hir.skip_type_assertions(callee);
    while let ExprKind::Binary {
        op: BinOp::Comma,
        left,
        right,
    } = hir[callee].kind
    {
        if !matches!(
            hir[hir.skip_type_assertions(left)].kind,
            ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Null
        ) {
            return None;
        }
        callee = hir.skip_type_assertions(right);
    }
    if let ExprKind::Ident(_) = hir[callee].kind {
        if bound.dynamic_lookup_scope(NodeData::Expr(callee)).is_some() {
            return None;
        }
        return match bound.binding(callee) {
            Binding::Symbol(symbol) => match input.helpers.binding(file, symbol) {
                Some(values) => Some(KnownCallee::new(file, values)),
                None if bound.binding_kind(symbol) == BindingKind::Import => {
                    resolve_import(input, input.modules.import_binding(file, symbol))
                }
                None => {
                    let required = find_required_file(input, file, callee)?;
                    predict_exports(input, ModuleRef::File(required))
                }
            },
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        };
    }
    let (object, MemberKey::Name(name)) = hir.member_key(callee)? else {
        return None;
    };
    if let Some(binding) = input.modules.member_binding(file, callee) {
        return resolve_import(input, binding);
    }
    if name == known::default {
        let required = find_file_required_behind_wrapper(input, file, object)?;
        return predict_exports(input, ModuleRef::File(required));
    }
    if !input.helpers.is_binding_name(name) {
        return None;
    }
    let required = find_required_file(input, file, object)?;
    Some(resolve_export(input, required, name)?.predicted())
}

pub fn resolve_reference(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    reference: KnownReference,
    accepts: &dyn Fn(Shape) -> bool,
) -> Option<ResolvedReference> {
    let KnownReference::Helper {
        symbol,
        is_initialized_first,
    } = reference
    else {
        return None;
    };
    let values = input.helpers.binding(file, symbol)?;
    let mut held = values.functions.iter().copied();
    let function = held.find(|function| {
        let known = input.helpers.function(file, function.definition);
        known.is_some_and(|known| accepts(known.shape))
    })?;
    let is_declaration = input.files.bound(file).binding_kind(symbol) == BindingKind::Function;
    let is_always_bound = values.functions.len() == 1
        && match values.certainty {
            Certainty::Always => {
                is_initialized_first || is_declaration || values.holds_from_the_start
            }
            Certainty::OnceInitialized => is_initialized_first || values.holds_from_the_start,
            Certainty::MayHoldOtherValues => false,
        };
    Some(ResolvedReference {
        symbol,
        function,
        needs_guard: !is_always_bound,
    })
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PublicFieldAnswer {
    Value,
    DefinedObjectOrStoredValue,
    Object,
}

pub struct PublicFieldCallee {
    pub file: FileId,
    pub answer: PublicFieldAnswer,
    /// The function that stores: whether it is strict decides what a refused store does.
    pub defines: HeldFunction,
}

/// `__publicField` where nothing else can be called, neither by the call nor by the helper.
pub fn resolve_public_field(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    callee: ExprId,
) -> Option<PublicFieldCallee> {
    let callee = resolve_callee(input, file, callee)?;
    let &[held] = &callee.functions[..] else {
        return None;
    };
    let known = input.helpers.function(callee.file, held.definition)?;
    let is_certain = !callee.needs_guard() && callee.holds_from_the_start;
    let converts_key = known.shape == Shape::PublicFieldWithConvertedKey;
    let is_known = match converts_key {
        true => {
            known.names_locked_globals
                && calls_only_published_helpers(input, callee.file, held.definition)
        }
        false => known.relies_on_facts,
    };
    if !is_certain || !is_known {
        return None;
    }
    let answer = match known.shape {
        Shape::PublicFieldAnswersValue => PublicFieldAnswer::Value,
        Shape::PublicFieldAnswersWhatDefiningAnswers => {
            PublicFieldAnswer::DefinedObjectOrStoredValue
        }
        Shape::PublicFieldReturnsObject | Shape::PublicFieldWithConvertedKey => {
            return Some(PublicFieldCallee {
                file: callee.file,
                answer: PublicFieldAnswer::Object,
                defines: held,
            });
        }
        _ => return None,
    };
    let [reference] = known.references[..] else {
        return None;
    };
    let defines = resolve_reference(input, callee.file, reference, &|shape| {
        shape == Shape::DefineNormalPropertyDefinesWhatIsThereAndStoresWhatIsNot
    })?;
    (!defines.needs_guard).then_some(PublicFieldCallee {
        file: callee.file,
        answer,
        defines: defines.function,
    })
}

pub fn calls_only_published_helpers(
    input: &ResolveInput<'_, '_>,
    home: FileId,
    function: FnId,
) -> bool {
    let Some(known) = input.helpers.function(home, function) else {
        return false;
    };
    let relies_on_facts = !known.shape.replaces_itself()
        || (known.relies_on_facts && known.is_named_only_to_be_called);
    relies_on_facts
        && known.references.iter().all(|&reference| match reference {
            KnownReference::Loaded { .. } => resolve_loaded_reference(input, home, reference)
                .is_some_and(|(file, called)| {
                    calls_only_published_helpers(input, file, called.definition)
                }),
            _ => resolve_reference(input, home, reference, &|_| true).is_some_and(|called| {
                !called.needs_guard
                    && calls_only_published_helpers(input, home, called.function.definition)
            }),
        })
}

pub fn resolve_loaded_reference(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    reference: KnownReference,
) -> Option<(FileId, HeldFunction)> {
    let KnownReference::Loaded { symbol, helper } = reference else {
        return None;
    };
    let (hir, bound) = (input.files.hir(file), input.files.bound(file));
    let loaded = match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Expression(value) => {
            let mut value = hir.skip_type_assertions(value);
            if let Some((object, MemberKey::Name(known::default))) = hir.member_key(value) {
                value = hir.skip_type_assertions(object);
            }
            let required = find_required_file(input, file, value)?;
            predict_exports(input, ModuleRef::File(required))?
        }
        _ => resolve_import(input, input.modules.import_binding(file, symbol))?,
    };
    let [held] = loaded.functions[..] else {
        return None;
    };
    (loaded.helper(input.helpers)? == helper).then_some((loaded.file, held))
}

/// The function of this file that the helper hands the descriptor to.
fn find_descriptor_function(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    call: &PrivateFieldCall,
    helper: Helper,
) -> Option<FnId> {
    if call.callee.file != file {
        return None;
    }
    let first = call.callee.functions.first()?.definition;
    let known = input.helpers.function(file, first)?;
    known.references.iter().find_map(|&reference| {
        let called = resolve_reference(input, file, reference, &|shape| shape.helper() == helper)?;
        (!called.needs_guard).then_some(called.function.definition)
    })
}

/// Every helper that the function names holds the published function wherever it runs.
fn calls_settled_helpers(input: &ResolveInput<'_, '_>, home: FileId, function: FnId) -> bool {
    let Some(known) = input.helpers.function(home, function) else {
        return false;
    };
    known.references.iter().all(|&reference| {
        let called = resolve_reference(input, home, reference, &|_| true);
        called.is_some_and(|called| {
            !called.needs_guard && calls_settled_helpers(input, home, called.function.definition)
        })
    })
}

pub fn resolve_private_field_call(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    call: ExprId,
) -> Option<PrivateFieldCall> {
    let hir = input.files.hir(file);
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let site = hir[site];
    let arguments: SmallVec<[ExprId; 5]> = hir.ids(site.args).collect();
    let mut kinds = arguments.iter().map(|&argument| hir[argument].kind);
    let has_spread = kinds.any(|kind| matches!(kind, ExprKind::Spread(_)));
    if !matches!(site.chain, Chain::No) || has_spread {
        return None;
    }
    let callee = resolve_callee(input, file, site.callee)?;
    let modules = input.modules;
    let may_be_replaced = callee.file != file
        && (modules.reaches_mock(file) || modules.may_be_mocked(ModuleRef::File(callee.file)));
    let callee = match may_be_replaced {
        true => callee.predicted(),
        false => callee,
    };
    let helper = callee.helper(input.helpers)?;
    let first = callee.functions.first()?.definition;
    let known = input.helpers.function(callee.file, first)?;
    let shape = known.shape;
    let of_field = PrivateFieldCall {
        is_settled: calls_settled_helpers(input, callee.file, first),
        callee,
        helper,
        shape,
        receiver: 0,
        state: 1,
        value: None,
        member_kind: PrivateMemberKind::Field,
        member: None,
        applies_descriptor: None,
    };
    match (shape, arguments.len()) {
        (Shape::ClassPrivateFieldGetByDescriptor, 2) => Some(PrivateFieldCall {
            applies_descriptor: Some(find_descriptor_function(
                input,
                file,
                &of_field,
                Helper::ClassApplyDescriptorGet,
            )?),
            ..of_field
        }),
        (Shape::ClassPrivateFieldSetByDescriptor, 3) => Some(PrivateFieldCall {
            value: Some(2),
            applies_descriptor: Some(find_descriptor_function(
                input,
                file,
                &of_field,
                Helper::ClassApplyDescriptorSet,
            )?),
            ..of_field
        }),
        (Shape::ClassPrivateFieldGetFromWeakMap, 2) => Some(of_field),
        (Shape::ClassPrivateFieldSetInWeakMap, 3) => Some(PrivateFieldCall {
            value: Some(2),
            ..of_field
        }),
        (Shape::ClassPrivateFieldGetByKind, count @ (3 | 4)) => Some(PrivateFieldCall {
            member_kind: find_member_kind(input, file, arguments[2])?,
            member: (count == 4).then_some(3),
            ..of_field
        }),
        (Shape::ClassPrivateFieldSetByKind, count @ (4 | 5)) => Some(PrivateFieldCall {
            value: Some(2),
            member_kind: find_member_kind(input, file, arguments[3])?,
            member: (count == 5).then_some(4),
            ..of_field
        }),
        (
            Shape::ClassPrivateFieldInAsksStateOrComparesConstructor
            | Shape::ClassPrivateFieldInAsksState
            | Shape::ClassPrivateFieldGetOfBrandedReceiver
            | Shape::AssertClassBrandAnswersReceiverOrMember,
            2,
        ) => Some(PrivateFieldCall {
            receiver: 1,
            state: 0,
            ..of_field
        }),
        (Shape::ClassPrivateFieldSetOfBrandedReceiver, 3) => Some(PrivateFieldCall {
            receiver: 1,
            state: 0,
            value: Some(2),
            ..of_field
        }),
        (Shape::AssertClassBrandAnswersReceiverOrMember, 3) => Some(PrivateFieldCall {
            receiver: 1,
            state: 0,
            member_kind: PrivateMemberKind::Method,
            member: Some(2),
            ..of_field
        }),
        (Shape::PrivateGetterCallOfBrandedReceiver, 3) => Some(PrivateFieldCall {
            receiver: 1,
            state: 0,
            member_kind: PrivateMemberKind::Getter,
            member: Some(2),
            ..of_field
        }),
        (Shape::PrivateSetterCallOfBrandedReceiver, 4) => Some(PrivateFieldCall {
            receiver: 2,
            state: 0,
            value: Some(3),
            member_kind: PrivateMemberKind::Setter,
            member: Some(1),
            ..of_field
        }),
        (Shape::ClassPrivateFieldGetOrGetterCall | Shape::PrivateWrapperOfAccessors, 2) => {
            Some(of_field)
        }
        (Shape::ClassPrivateFieldGetOrGetterCall, 3) => Some(PrivateFieldCall {
            member_kind: PrivateMemberKind::Getter,
            member: Some(2),
            ..of_field
        }),
        (Shape::ClassPrivateFieldSetOrSetterCall, 3) => Some(PrivateFieldCall {
            value: Some(2),
            ..of_field
        }),
        (Shape::ClassPrivateFieldSetOrSetterCall, 4) => Some(PrivateFieldCall {
            value: Some(2),
            member_kind: PrivateMemberKind::Setter,
            member: Some(3),
            ..of_field
        }),
        (Shape::ClassPrivateMethodOfReceiver, 3) => Some(PrivateFieldCall {
            member_kind: PrivateMemberKind::Method,
            member: Some(2),
            ..of_field
        }),
        (Shape::PrivateFieldAddSetsEntry, 3) => Some(PrivateFieldCall {
            value: Some(2),
            ..of_field
        }),
        (Shape::PrivateMethodAddAddsEntry, 2) => Some(of_field),
        (
            Shape::PrivateElementAddAnswersCollection | Shape::PrivateElementAddAnswersNothing,
            count @ (2 | 3),
        ) => Some(PrivateFieldCall {
            value: (count == 3).then_some(2),
            ..of_field
        }),
        _ => None,
    }
}

fn find_constant_text<'a>(
    input: &ResolveInput<'a, '_>,
    file: FileId,
    expression: ExprId,
) -> Option<&'a [u8]> {
    let decisions = &input.files.analysis(file).decisions;
    match decisions.constant(input.files.hir(file), expression) {
        FoldedValue::Constant(Constant::String(text)) => Some(input.files.atoms.bytes(text)),
        _ => None,
    }
}

fn find_member_kind(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    kind: ExprId,
) -> Option<PrivateMemberKind> {
    match find_constant_text(input, file, kind)? {
        b"f" => Some(PrivateMemberKind::Field),
        b"m" => Some(PrivateMemberKind::Method),
        _ => None,
    }
}

fn resolve_variable(input: &ResolveInput<'_, '_>, variable: Sym) -> Option<KnownCallee> {
    let values = input.helpers.binding(variable.file, variable.id)?;
    Some(KnownCallee {
        holds_from_the_start: false,
        ..KnownCallee::new(variable.file, values)
    })
}

fn resolve_import(input: &ResolveInput<'_, '_>, binding: ImportBinding) -> Option<KnownCallee> {
    match binding {
        ImportBinding::Variable(variable) => resolve_variable(input, variable),
        ImportBinding::Synthetic(export) => {
            let export = input.modules.synthetic_export(export);
            predict_member(input, export.module, export.name)
        }
        ImportBinding::NamespaceRead { module, name } => predict_member(input, module, name),
        ImportBinding::Exports { module } => predict_exports(input, module),
        _ => None,
    }
}

fn resolve_export(input: &ResolveInput<'_, '_>, file: FileId, name: Atom) -> Option<KnownCallee> {
    let (mut module, mut name) = (ModuleRef::File(file), name);
    for _ in 0..MAX_INDIRECT_EXPORTS {
        match input.modules.find_export(module, name, &input.files.atoms) {
            ExportLookup::Found(ExportBinding::Variable(variable)) => {
                return resolve_variable(input, variable);
            }
            ExportLookup::Found(ExportBinding::Indirect {
                module: source,
                name: source_name,
            }) => (module, name) = (source, source_name),
            ExportLookup::Found(ExportBinding::Synthetic(export)) => {
                let export = input.modules.synthetic_export(export);
                return predict_member(input, export.module, export.name);
            }
            ExportLookup::Unknown => return predict_member(input, module, name),
            ExportLookup::Found(ExportBinding::Namespace { .. }) | ExportLookup::Absent => {
                return None;
            }
        }
    }
    None
}

fn predict_member(
    input: &ResolveInput<'_, '_>,
    module: ModuleRef,
    name: Atom,
) -> Option<KnownCallee> {
    if name == known::default {
        return predict_exports(input, module);
    }
    let file = match module {
        ModuleRef::File(file) => file,
        _ => return None,
    };
    if !input.helpers.is_binding_name(name) {
        return None;
    }
    let bound = input.files.bound(file);
    let mut bindings = input.helpers.file(file)?.bindings();
    let (_, values) = bindings.find(|&(symbol, _)| bound.symbol(symbol).name == name)?;
    Some(KnownCallee::new(file, values).predicted())
}

fn predict_exports(input: &ResolveInput<'_, '_>, module: ModuleRef) -> Option<KnownCallee> {
    let ModuleRef::File(file) = module else {
        return None;
    };
    input.helpers.file(file)?;
    let stored = find_name_stored_as_module_exports(input.files, file)?;
    Some(KnownCallee::new(file, input.helpers.binding(file, stored)?).predicted())
}

fn find_file_required_behind_wrapper(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    holder: ExprId,
) -> Option<FileId> {
    if let Some(required) = find_required_file(input, file, holder) {
        return Some(required);
    }
    let (hir, bound) = (input.files.hir(file), input.files.bound(file));
    let Binding::Symbol(symbol) = bound.binding(hir.skip_type_assertions(holder)) else {
        return None;
    };
    let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) else {
        return None;
    };
    let ExprKind::Call(site) = hir[hir.skip_type_assertions(value)].kind else {
        return None;
    };
    let site = hir[site];
    let only = (site.args.len() == 1).then(|| hir.id_at::<ExprId>(site.args, 0))?;
    match hir[hir.skip_type_assertions(only)].kind {
        ExprKind::Call(_) => find_required_file(input, file, only),
        _ => None,
    }
}

fn find_required_file(
    input: &ResolveInput<'_, '_>,
    file: FileId,
    object: ExprId,
) -> Option<FileId> {
    let (hir, bound) = (input.files.hir(file), input.files.bound(file));
    let object = hir.skip_type_assertions(object);
    let loaded = match hir[object].kind {
        ExprKind::Ident(_) => {
            let Binding::Symbol(symbol) = bound.binding(object) else {
                return None;
            };
            let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol)
            else {
                return None;
            };
            hir.skip_type_assertions(value)
        }
        ExprKind::Call(_) => object,
        _ => return None,
    };
    let analysis = input.files.analysis(file);
    let site = analysis.import_sites[analysis.import_site_of_call(loaded)?];
    let ImportSiteKind::Require(_) = site.kind else {
        return None;
    };
    match input.modules.site_answer(file, site.kind) {
        SiteAnswer::Module(ModuleRef::File(required)) => Some(required),
        SiteAnswer::Module(
            ModuleRef::Inner { .. }
            | ModuleRef::Facade(_)
            | ModuleRef::Check(_)
            | ModuleRef::Runtime(_)
            | ModuleRef::External { .. },
        )
        | SiteAnswer::Computed(_)
        | SiteAnswer::Failed(_)
        | SiteAnswer::Erased => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::run_serially;
    use crate::known_helpers::tests::{CREATE_BINDING, EXPORT_STAR};
    use crate::modules::testing::{file_named, with_graph};
    use bun_sema::hir::StmtKind;

    const PRIVATE_FIELD_GET: &str = r#"function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
"#;

    fn with_last_call<R>(
        files: &[(&str, &str)],
        name: &str,
        then: impl FnOnce(&ResolveInput<'_, '_>, FileId, ExprId) -> R,
    ) -> R {
        with_graph(files, |graph, bind_input| {
            let files = bind_input.files;
            let helpers = KnownHelpers::compute(files, &run_serially);
            let input = ResolveInput {
                files,
                modules: graph,
                helpers: &helpers,
            };
            let file = file_named(bind_input, name);
            let hir = files.hir(file);
            let last = hir.ids(hir.body).last().expect("the file has a statement");
            let StmtKind::Expr(call) = hir[last].kind else {
                panic!("the last statement of {name} is a call");
            };
            then(&input, file, call)
        })
    }

    fn describe_last_call(
        files: &[(&str, &str)],
        name: &str,
    ) -> Option<(Helper, Certainty, String)> {
        with_last_call(files, name, |input, file, call| {
            let hir = input.files.hir(file);
            let ExprKind::Call(site) = hir[call].kind else {
                panic!("the last statement of {name} is a call");
            };
            let callee = resolve_callee(input, file, hir[site].callee)?;
            let path = input.files.module(callee.file).file_name();
            let path = String::from_utf8_lossy(path).into_owned();
            Some((callee.helper(input.helpers)?, callee.certainty, path))
        })
    }

    fn describe_field_access(main: &str, helpers: &str) -> Option<(PrivateFieldAccess, bool)> {
        let files = [("main.mjs", main), ("helpers.mjs", helpers)];
        with_last_call(&files, "main.mjs", |input, file, call| {
            let described = resolve_private_field_call(input, file, call)?;
            let access = described.access(PrivateStateKind::Field)?;
            Some((
                access,
                described.supports_private_state(PrivateStateKind::Field),
            ))
        })
    }

    #[test]
    fn resolves_local_helper_variable() {
        let main =
            format!("{CREATE_BINDING}{EXPORT_STAR}__exportStar(require(\"./a.cjs\"), exports);");
        let files = [("main.cjs", main.as_str()), ("a.cjs", "exports.a = 1;")];
        let (helper, certainty, path) = describe_last_call(&files, "main.cjs").expect("resolved");
        assert_eq!(helper, Helper::ExportStar);
        assert_eq!(certainty, Certainty::OnceInitialized);
        assert!(path.ends_with("main.cjs"), "{path}");
    }

    #[test]
    fn resolves_imported_function_declaration() {
        let helpers = format!("export {PRIVATE_FIELD_GET}");
        let named = r#"import { __classPrivateFieldGet as get } from "./helpers.mjs";
get({}, new WeakMap(), "f");"#;
        let files = [("main.mjs", named), ("helpers.mjs", helpers.as_str())];
        let (helper, certainty, path) = describe_last_call(&files, "main.mjs").expect("resolved");
        assert_eq!(helper, Helper::ClassPrivateFieldGet);
        assert_eq!(certainty, Certainty::Always);
        assert!(path.ends_with("helpers.mjs"), "{path}");

        let namespace = r#"import * as helpers from "./helpers.mjs";
helpers.__classPrivateFieldGet({}, new WeakMap(), "f");"#;
        let files = [("main.mjs", namespace), ("helpers.mjs", helpers.as_str())];
        let (helper, certainty, _) = describe_last_call(&files, "main.mjs").expect("resolved");
        assert_eq!(
            (helper, certainty),
            (Helper::ClassPrivateFieldGet, Certainty::Always)
        );
    }

    #[test]
    fn a_variable_of_another_file_may_still_be_empty() {
        let needs_guard = |files: &[(&str, &str)]| {
            with_last_call(files, "main.mjs", |input, file, call| {
                let hir = input.files.hir(file);
                let ExprKind::Call(site) = hir[call].kind else {
                    panic!("the last statement is a call");
                };
                resolve_callee(input, file, hir[site].callee)
                    .expect("resolved")
                    .needs_guard()
            })
        };
        let body = PRIVATE_FIELD_GET
            .strip_prefix("function __classPrivateFieldGet")
            .expect("a declaration");
        let call = "__classPrivateFieldGet({}, new WeakMap(), \"f\");";
        let import = format!("import {{ __classPrivateFieldGet }} from \"./helpers.mjs\";\n{call}");
        let variable = format!("export var __classPrivateFieldGet = function{body}");
        assert!(needs_guard(&[
            ("main.mjs", import.as_str()),
            ("helpers.mjs", variable.as_str())
        ]));
        let declaration = format!("export {PRIVATE_FIELD_GET}");
        assert!(!needs_guard(&[
            ("main.mjs", import.as_str()),
            ("helpers.mjs", declaration.as_str())
        ]));
        let own = format!("var __classPrivateFieldGet = function{body};\n{call}");
        assert!(!needs_guard(&[("main.mjs", own.as_str())]));
    }

    #[test]
    fn private_state_requires_certain_callee_and_supported_access() {
        let import = "import { __classPrivateFieldGet } from \"./helpers.mjs\";\nvar state;\n";
        let declared = format!("export {PRIVATE_FIELD_GET}");
        let field = format!("{import}__classPrivateFieldGet({{}}, state, \"f\");");
        let get = PrivateFieldAccess::Get;
        assert_eq!(describe_field_access(&field, &declared), Some((get, true)));
        let assigned = format!("{declared}__classPrivateFieldGet = null;");
        assert_eq!(describe_field_access(&field, &assigned), Some((get, false)));
        let unsupported = [
            r#""a", Math.max"#,
            r#""m", Math.max"#,
            r#""f", {}"#,
            "Math.max()",
            r#"...["f"]"#,
        ];
        for other in unsupported {
            let call = format!("{import}__classPrivateFieldGet({{}}, state, {other});");
            assert_eq!(describe_field_access(&call, &declared), None, "{other}");
        }
    }

    #[test]
    fn predicts_member_of_required_module() {
        let library =
            format!("{CREATE_BINDING}{EXPORT_STAR}module.exports = [{{ __exportStar }}][0];");
        let main = r#"const library = require("./library.cjs");
library.__exportStar(require("./a.cjs"), exports);"#;
        let files = [
            ("main.cjs", main),
            ("library.cjs", library.as_str()),
            ("a.cjs", "exports.a = 1;"),
        ];
        let (helper, certainty, path) = describe_last_call(&files, "main.cjs").expect("resolved");
        assert_eq!(helper, Helper::ExportStar);
        assert_eq!(certainty, Certainty::MayHoldOtherValues);
        assert!(path.ends_with("library.cjs"), "{path}");
    }

    #[test]
    fn ignores_other_functions_with_helper_names() {
        let main = "function __exportStar(m, o) { return [m, o]; }\n__exportStar(1, 2);";
        assert_eq!(describe_last_call(&[("main.cjs", main)], "main.cjs"), None);
        let library = "exports.__exportStar = function (m, o) { return [m, o]; };";
        let main =
            format!("{CREATE_BINDING}{EXPORT_STAR}require(\"./library.cjs\").__exportStar(1, 2);");
        let files = [("main.cjs", main.as_str()), ("library.cjs", library)];
        assert_eq!(describe_last_call(&files, "main.cjs"), None);
    }
}

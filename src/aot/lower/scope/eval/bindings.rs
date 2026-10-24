use bun_sema::atom::{Atom, known, written_name};
use bun_sema::bind::{
    BindingKind, Bound, CodeUnit, Decl, EvalScope, PrivateMembers, PrivateNameId, ScopeId,
    ScopeKind, SymbolId,
};
use bun_sema::hir::{self, ClassId, MemberId};
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

use super::EvalContext;
use crate::ir::generated::{EvalBinding, EvalBindingKind, EvalScopeFlags, HomeObjectKind};
use crate::ir::{ClassSlot, StringId, ValueId, VariableKey};
use crate::lower::captures::{self, Capture};
use crate::lower::member::{self, PropertyName};
use crate::lower::private_names::{self, PrivateHolder};
use crate::lower::scope::{
    ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage, bindings, environments, variables,
};
use crate::lower::{FileLowering, FunctionLowering, commonjs, function, layouts, module};
use crate::modules::{ImportBinding, Shape, SyntheticExportId};

type ScopeDepths = SmallVec<[(ScopeId, u32); 8]>;

#[derive(Default)]
pub(super) struct EvalScopeBuilder {
    pub(super) bindings: Vec<EvalBinding>,
    pub(super) operands: SmallVec<[ValueId; 4]>,
    environments: SmallVec<[(ScopeId, u32); 4]>,
    arguments_objects: SmallVec<[(CodeUnit, u32); 1]>,
}

#[derive(Copy, Clone)]
struct ClassOperands {
    scope: ScopeId,
    depth: u32,
    token: Option<u32>,
    class_object: Option<u32>,
}

fn create_binding(kind: EvalBindingKind, name: Option<StringId>, depth: u32) -> EvalBinding {
    EvalBinding {
        name,
        kind,
        depth,
        layout: None,
        field: None,
        variable: None,
        operand: None,
        function: None,
        setter: None,
    }
}

fn find_entry<K: Copy + PartialEq>(entries: &[(K, u32)], key: K) -> Option<u32> {
    let entry = entries.iter().find(|entry| entry.0 == key)?;
    Some(entry.1)
}

fn compute_binding_kind(kind: BindingKind) -> EvalBindingKind {
    match kind {
        BindingKind::Const | BindingKind::ClassInnerName | BindingKind::Import => {
            EvalBindingKind::Constant
        }
        BindingKind::FunctionName => EvalBindingKind::FunctionName,
        BindingKind::SimpleCatchParameter => EvalBindingKind::SimpleCatchParameter,
        _ => EvalBindingKind::Variable,
    }
}

// A function keeps its top-level lexical declarations in an environment of their own, inside the environment of its variables: a `var` of the evaluated text that meets one of them is a SyntaxError.
fn compute_scope_depths(hir: &hir::File<'_>, bound: &Bound<'_>, innermost: ScopeId) -> ScopeDepths {
    let mut depths = ScopeDepths::new();
    let mut scope = innermost;
    while scope.is_some() {
        depths.push((scope, depths.len() as u32 * 2 + 1));
        scope = bound.runtime_parent_scope(hir, scope);
    }
    depths
}

fn is_lexical_declaration(kind: BindingKind) -> bool {
    matches!(
        kind,
        BindingKind::Let | BindingKind::Const | BindingKind::Class
    )
}

fn class_slot(scope: ScopeId, slot: ClassSlot) -> BindingRef {
    BindingRef::Slot(scope, ScopeSlot::Class(slot))
}

fn has_location(file: &FileLowering<'_, '_, '_, '_>, stored: BindingRef) -> bool {
    let placement = file.scopes.placement(stored);
    placement.is_some_and(|placement| match placement.storage {
        Storage::Field { .. } | Storage::Variable(_) => true,
        Storage::Local => false,
    })
}

fn can_reach_environment(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, scope: ScopeId) -> bool {
    lowering.scopes.find_environment(scope).is_some()
        || captures::find_captured_value(lowering, Capture::Environment(scope)).is_some()
}

impl EvalScopeBuilder {
    fn add_value_operand(&mut self, value: ValueId) -> u32 {
        let operand = self.operands.len() as u32;
        self.operands.push(value);
        operand
    }

    fn ensure_environment_operand(
        &mut self,
        lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
        scope: ScopeId,
    ) -> u32 {
        if let Some(operand) = find_entry(&self.environments, scope) {
            return operand;
        }
        let operand = self.add_value_operand(environments::get_environment(lowering, scope));
        self.environments.push((scope, operand));
        operand
    }

    fn ensure_arguments_operand(
        &mut self,
        lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
        unit: CodeUnit,
    ) -> u32 {
        if let Some(operand) = find_entry(&self.arguments_objects, unit) {
            return operand;
        }
        let operand = self.add_value_operand(bindings::get_arguments_object(lowering, unit));
        self.arguments_objects.push((unit, operand));
        operand
    }

    fn add_operand(&mut self, binding: EvalBinding, operand: u32) {
        self.bindings.push(EvalBinding {
            operand: Some(operand),
            ..binding
        });
    }

    fn add_value(&mut self, binding: EvalBinding, value: ValueId) {
        let operand = self.add_value_operand(value);
        self.add_operand(binding, operand);
    }

    fn add_variable(
        &mut self,
        lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
        binding: EvalBinding,
        key: VariableKey,
    ) {
        let variable = variables::ensure_variable(lowering.file, key);
        self.bindings.push(EvalBinding {
            variable: Some(variable),
            ..binding
        });
    }

    fn add_field(
        &mut self,
        lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
        binding: EvalBinding,
        scope: ScopeId,
        field: u32,
    ) {
        let operand = self.ensure_environment_operand(lowering, scope);
        let binding = EvalBinding {
            layout: Some(environments::environment_layout(lowering.file, scope)),
            field: Some(field),
            ..binding
        };
        self.add_operand(binding, operand);
    }

    fn add_stored(
        &mut self,
        lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
        binding: EvalBinding,
        stored: BindingRef,
    ) {
        let Some(placement) = lowering.file.scopes.placement(stored) else {
            return;
        };
        match placement.storage {
            Storage::Variable(key) => self.add_variable(lowering, binding, key),
            Storage::Field { scope, field } if can_reach_environment(lowering, scope) => {
                self.add_field(lowering, binding, scope, field);
            }
            Storage::Field { .. } | Storage::Local => {
                let value = bindings::get_stored(lowering, stored);
                self.add_value(binding, value);
            }
        }
    }
}

pub(super) fn collect_eval_bindings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    eval_scope: EvalScope,
    context: EvalContext,
) -> EvalScopeBuilder {
    let bound = lowering.file.bound;
    let depths = compute_scope_depths(lowering.file.hir, bound, eval_scope.scope);
    let mut builder = EvalScopeBuilder::default();
    for symbol in bound.ids(eval_scope.symbols) {
        let Some(depth) = find_entry(&depths, bound.symbol_scope(symbol)) else {
            debug_assert!(
                false,
                "a binding visible to eval is declared in an enclosing scope"
            );
            continue;
        };
        add_eval_symbol(lowering, &mut builder, symbol, depth);
    }
    for &(scope, depth) in &depths {
        add_eval_scope_bindings(lowering, &mut builder, context, scope, depth);
    }
    builder.bindings.shared_sort_by_key(|binding| binding.depth);
    builder
}

// The symbol of `export default function f() {}` is named `default`, and code spells it `f`.
pub(super) fn find_spelled_name(file: &FileLowering<'_, '_, '_, '_>, symbol: SymbolId) -> Atom {
    let data = file.bound.symbol(symbol);
    if data.name != known::default {
        return data.name;
    }
    for &declaration in data.decls.iter() {
        if let Decl::Fn(function) = declaration {
            return file.hir[function].name;
        }
        if let Decl::Class(class) = declaration {
            return file.hir[class].name;
        }
    }
    data.name
}

fn add_eval_symbol(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    symbol: SymbolId,
    depth: u32,
) {
    let bound = lowering.file.bound;
    let name = lowering
        .file
        .intern_atom(find_spelled_name(lowering.file, symbol));
    let declared_as = bound.binding_kind(symbol);
    let depth = if is_lexical_declaration(declared_as) {
        depth - 1
    } else {
        depth
    };
    let binding = create_binding(compute_binding_kind(declared_as), Some(name), depth);
    match lowering.file.scopes.form(symbol) {
        BindingForm::Stored => builder.add_stored(lowering, binding, BindingRef::Symbol(symbol)),
        BindingForm::Callee { function } => {
            let scope = bound.fns[function.idx()].scope;
            builder.add_stored(
                lowering,
                binding,
                BindingRef::Slot(scope, ScopeSlot::Callee),
            );
        }
        BindingForm::MappedArgument { unit, index } => {
            add_eval_mapped_argument(lowering, builder, binding, unit, index);
        }
        BindingForm::Import => add_eval_import(lowering, builder, binding, symbol, name),
        BindingForm::ContainerMember { .. } | BindingForm::NotAValue => {}
    }
}

fn add_eval_mapped_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    binding: EvalBinding,
    unit: CodeUnit,
    index: u32,
) {
    let operand = builder.ensure_arguments_operand(lowering, unit);
    let binding = EvalBinding {
        kind: EvalBindingKind::MappedArgument,
        field: Some(index),
        ..binding
    };
    builder.add_operand(binding, operand);
}

// The loader fills the variable of a name of a library module.
fn is_filled_by_loader(file: &FileLowering<'_, '_, '_, '_>, export: SyntheticExportId) -> bool {
    let modules = file.inputs.modules;
    match modules.shape(modules.synthetic_export(export).module) {
        Shape::AsToday | Shape::EsModule => true,
        Shape::Names | Shape::Value => false,
    }
}

fn add_eval_import(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    binding: EvalBinding,
    symbol: SymbolId,
    name: StringId,
) {
    let import = lowering
        .file
        .inputs
        .modules
        .import_binding(lowering.file.file, symbol);
    match import {
        ImportBinding::Variable(variable) => {
            builder.add_variable(lowering, binding, VariableKey::Symbol(variable));
        }
        ImportBinding::Synthetic(export) if !is_filled_by_loader(lowering.file, export) => {
            let value = module::emit_import_binding(lowering, import, name);
            builder.add_value(binding, value);
        }
        ImportBinding::Synthetic(export) | ImportBinding::CapturedBuiltin { export, .. } => {
            builder.add_variable(lowering, binding, VariableKey::SyntheticExport(export));
        }
        ImportBinding::Unbound | ImportBinding::Unused | ImportBinding::Local => {}
        _ => {
            let value = module::emit_import_binding(lowering, import, name);
            builder.add_value(binding, value);
        }
    }
}

fn add_eval_scope_bindings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    context: EvalContext,
    scope: ScopeId,
    depth: u32,
) {
    let binding = create_binding(EvalBindingKind::EvalVariables, None, depth);
    builder.add_stored(
        lowering,
        binding,
        BindingRef::Slot(scope, ScopeSlot::EvalVariables),
    );
    if context.this_scope == Some(scope) {
        add_eval_owner_bindings(lowering, builder, context, scope, depth);
    }
    match lowering.file.bound.scopes[scope.idx()].kind {
        ScopeKind::With(_) => {
            let binding = create_binding(EvalBindingKind::WithObject, None, depth);
            builder.add_stored(
                lowering,
                binding,
                BindingRef::Slot(scope, ScopeSlot::WithObject),
            );
        }
        ScopeKind::Class(class) => {
            add_eval_class_bindings(lowering, builder, context, class, depth);
        }
        ScopeKind::File => add_eval_commonjs_bindings(lowering, builder, context, depth),
        ScopeKind::Module(_)
        | ScopeKind::Fn(_)
        | ScopeKind::Block
        | ScopeKind::Interface(_)
        | ScopeKind::TypeAlias(_)
        | ScopeKind::TypeParams
        | ScopeKind::Enum(_)
        | ScopeKind::TypeParamList(_)
        | ScopeKind::Param(_)
        | ScopeKind::ReturnType(_)
        | ScopeKind::Extends
        | ScopeKind::InferConstraint
        | ScopeKind::StaticMember
        | ScopeKind::ComputedName
        | ScopeKind::BaseExpression
        | ScopeKind::FunctionName(_)
        | ScopeKind::PropertyDeclaration(..)
        | ScopeKind::PropertyType(..)
        | ScopeKind::FieldInitializer(_)
        | ScopeKind::ClassDecorators(_)
        | ScopeKind::ImplicitBlock(_) => {}
    }
}

fn add_eval_owner_bindings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    context: EvalContext,
    scope: ScopeId,
    depth: u32,
) {
    add_eval_arguments_binding(lowering, builder, context.owner, depth);
    let new_target = BindingRef::Slot(scope, ScopeSlot::NewTarget);
    if has_location(lowering.file, new_target) {
        let binding = create_binding(EvalBindingKind::NewTarget, None, depth);
        builder.add_stored(lowering, binding, new_target);
    }
    let this = BindingRef::Slot(scope, ScopeSlot::This);
    if context
        .flags
        .contains(EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR)
        || has_location(lowering.file, this)
    {
        let binding = create_binding(EvalBindingKind::This, None, depth);
        builder.add_stored(lowering, binding, this);
    }
    if context
        .flags
        .contains(EvalScopeFlags::ALLOWS_SUPER_PROPERTY)
    {
        let binding = create_binding(EvalBindingKind::HomeObject, None, depth);
        let home_object = match function::get_home_object(lowering) {
            (HomeObjectKind::Object, object) => object,
            (HomeObjectKind::ClassPrototype, class_object) => {
                let key = lowering.file.atom_key(known::prototype);
                lowering.builder.prop_get(class_object, key, false, false)
            }
        };
        builder.add_value(binding, home_object);
    }
}

fn add_eval_arguments_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    owner: CodeUnit,
    depth: u32,
) {
    match lowering.file.scopes.arguments_object(owner) {
        ArgumentsObject::Unmapped | ArgumentsObject::Mapped => {
            let name = lowering.file.intern_atom(known::arguments);
            let binding = create_binding(EvalBindingKind::Arguments, Some(name), depth);
            let scope = lowering.file.bound.top_scope(lowering.file.hir, owner);
            let stored = BindingRef::Slot(scope, ScopeSlot::ArgumentsBinding);
            builder.add_stored(lowering, binding, stored);
        }
        ArgumentsObject::None => {}
    }
}

fn add_eval_class_bindings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    context: EvalContext,
    class: ClassId,
    depth: u32,
) {
    let bound = lowering.file.bound;
    let scope = bound.class_scope[class.idx()];
    let stored_class_object = class_slot(scope, ClassSlot::ClassObject);
    let allows_super_call =
        context.class == Some(class) && context.flags.contains(EvalScopeFlags::ALLOWS_SUPER_CALL);
    let has_static_name = bound
        .private_names_of_class(class)
        .any(|(_, name)| name.is_static);
    let has_instance_name = bound
        .private_names_of_class(class)
        .any(|(_, name)| !name.is_static);
    if allows_super_call || has_static_name {
        let binding = create_binding(EvalBindingKind::ClassObject, None, depth);
        builder.add_stored(lowering, binding, stored_class_object);
    }
    let token = has_instance_name.then(|| {
        let token = bindings::get_stored(lowering, class_slot(scope, ClassSlot::ClassToken));
        builder.add_value_operand(token)
    });
    let class_object = has_static_name.then(|| {
        let class_object = bindings::get_stored(lowering, stored_class_object);
        builder.add_value_operand(class_object)
    });
    let operands = ClassOperands {
        scope,
        depth,
        token,
        class_object,
    };
    for (id, name) in bound.private_names_of_class(class) {
        add_eval_private_name(lowering, builder, operands, id, name.name);
    }
}

fn add_eval_private_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    operands: ClassOperands,
    id: PrivateNameId,
    name: Atom,
) {
    let resolved = private_names::resolve_private_name(lowering.file, id);
    let text = written_name(lowering.file.queries.atom_bytes(name));
    let text = lowering.file.intern_bytes(text);
    let binding = create_binding(EvalBindingKind::PrivateName, Some(text), operands.depth);
    let binding = match resolved.holder {
        PrivateHolder::Instance { layout, field } => EvalBinding {
            layout: Some(layout),
            field: Some(field),
            operand: operands.token,
            ..binding
        },
        PrivateHolder::ClassObject => EvalBinding {
            operand: operands.class_object,
            ..binding
        },
    };
    let scope = operands.scope;
    match resolved.members {
        PrivateMembers::Field(member) => {
            let static_field = class_slot(scope, ClassSlot::StaticField(member));
            add_eval_private_storage(lowering, builder, binding, resolved.holder, static_field);
        }
        PrivateMembers::AutoAccessor(member) if !resolved.is_decorated => {
            let static_field = class_slot(scope, ClassSlot::StaticField(member));
            add_eval_private_storage(lowering, builder, binding, resolved.holder, static_field);
        }
        PrivateMembers::AutoAccessor(member) => {
            let binding = match resolved.holder {
                PrivateHolder::Instance { layout, .. } => EvalBinding {
                    field: layouts::own_fields(lowering.file, layout).brand(),
                    ..binding
                },
                PrivateHolder::ClassObject => binding,
            };
            let stored_pair = class_slot(scope, ClassSlot::PrivateMethod(member));
            add_eval_decorated_accessor(lowering, builder, binding, stored_pair);
        }
        PrivateMembers::Method(member) => {
            let binding = EvalBinding {
                kind: EvalBindingKind::PrivateMethod,
                ..binding
            };
            add_eval_private_functions(lowering, builder, binding, scope, [Some(member), None]);
        }
        PrivateMembers::Accessor { getter, setter } => {
            let binding = EvalBinding {
                kind: EvalBindingKind::PrivateAccessor,
                ..binding
            };
            add_eval_private_functions(lowering, builder, binding, scope, [getter, setter]);
        }
    }
}

fn add_eval_private_storage(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    binding: EvalBinding,
    holder: PrivateHolder,
    static_field: BindingRef,
) {
    match holder {
        PrivateHolder::Instance { .. } => builder.bindings.push(binding),
        PrivateHolder::ClassObject => builder.add_stored(lowering, binding, static_field),
    }
}

fn add_eval_private_functions(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    binding: EvalBinding,
    scope: ScopeId,
    members: [Option<MemberId>; 2],
) {
    let [function, setter] = members.map(|member| {
        member.map(|member| {
            let stored_function = class_slot(scope, ClassSlot::PrivateMethod(member));
            let function = bindings::get_stored(lowering, stored_function);
            builder.add_value_operand(function)
        })
    });
    builder.bindings.push(EvalBinding {
        function,
        setter,
        ..binding
    });
}

fn add_eval_decorated_accessor(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    binding: EvalBinding,
    stored_pair: BindingRef,
) {
    let pair = bindings::get_stored(lowering, stored_pair);
    let [function, setter] = [known::get, known::set].map(|name| {
        let key = member::name_key(lowering.file, name);
        let function = member::emit_get(lowering, pair, PropertyName::Constant(key));
        Some(builder.add_value_operand(function))
    });
    builder.bindings.push(EvalBinding {
        kind: EvalBindingKind::PrivateAccessor,
        function,
        setter,
        ..binding
    });
}

fn add_eval_commonjs_bindings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builder: &mut EvalScopeBuilder,
    context: EvalContext,
    depth: u32,
) {
    if !commonjs::is_commonjs_module(lowering.file) {
        return;
    }
    if context.owner == CodeUnit::File {
        add_eval_arguments_binding(lowering, builder, CodeUnit::File, depth);
    }
    let scope = module::file_scope(lowering.file);
    let arguments_object = lowering.file.scopes.arguments_object(CodeUnit::File);
    for variable in commonjs::undeclared_wrapper_parameters(lowering.file.bound) {
        let name = lowering.file.intern_atom(variable.name());
        let binding = create_binding(EvalBindingKind::Variable, Some(name), depth);
        match arguments_object {
            ArgumentsObject::Mapped => {
                let index = commonjs::wrapper_parameter_index(variable);
                add_eval_mapped_argument(lowering, builder, binding, CodeUnit::File, index);
            }
            ArgumentsObject::None | ArgumentsObject::Unmapped => {
                let stored = BindingRef::Slot(scope, ScopeSlot::CommonJs(variable));
                builder.add_stored(lowering, binding, stored);
            }
        }
    }
}

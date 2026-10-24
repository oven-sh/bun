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
use crate::lower::captures::Capture;
use crate::lower::member::PropertyName;
use crate::lower::private_names::PrivateHolder;
use crate::lower::scope::{
    ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage, environments,
};
use crate::lower::{FileLowering, FunctionLowering, commonjs, layouts, module};
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

impl FileLowering<'_, '_, '_, '_> {
    fn has_location(&self, stored: BindingRef) -> bool {
        let placement = self.scopes.placement(stored);
        placement.is_some_and(|placement| match placement.storage {
            Storage::Field { .. } | Storage::Variable(_) => true,
            Storage::Local => false,
        })
    }

    // The symbol of `export default function f() {}` is named `default`, and code spells it `f`.
    pub(super) fn find_spelled_name(&self, symbol: SymbolId) -> Atom {
        let data = self.bound.symbol(symbol);
        if data.name != known::default {
            return data.name;
        }
        for &declaration in data.decls.iter() {
            if let Decl::Fn(function) = declaration {
                return self.hir[function].name;
            }
            if let Decl::Class(class) = declaration {
                return self.hir[class].name;
            }
        }
        data.name
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn can_reach_environment(&self, scope: ScopeId) -> bool {
        self.scopes.find_environment(scope).is_some()
            || self
                .find_captured_value(Capture::Environment(scope))
                .is_some()
    }

    pub(super) fn collect_eval_bindings(
        &mut self,
        eval_scope: EvalScope,
        context: EvalContext,
    ) -> EvalScopeBuilder {
        let bound = self.file.bound;
        let depths = compute_scope_depths(self.file.hir, bound, eval_scope.scope);
        let mut builder = EvalScopeBuilder::default();
        for symbol in bound.ids(eval_scope.symbols) {
            let Some(depth) = find_entry(&depths, bound.symbol_scope(symbol)) else {
                debug_assert!(
                    false,
                    "a binding visible to eval is declared in an enclosing scope"
                );
                continue;
            };
            self.add_eval_symbol(&mut builder, symbol, depth);
        }
        for &(scope, depth) in &depths {
            self.add_eval_scope_bindings(&mut builder, context, scope, depth);
        }
        builder.bindings.shared_sort_by_key(|binding| binding.depth);
        builder
    }

    fn add_eval_symbol(&mut self, builder: &mut EvalScopeBuilder, symbol: SymbolId, depth: u32) {
        let bound = self.file.bound;
        let name = self.file.intern_atom(self.file.find_spelled_name(symbol));
        let declared_as = bound.binding_kind(symbol);
        let depth = if is_lexical_declaration(declared_as) {
            depth - 1
        } else {
            depth
        };
        let binding = create_binding(compute_binding_kind(declared_as), Some(name), depth);
        match self.file.scopes.form(symbol) {
            BindingForm::Stored => builder.add_stored(self, binding, BindingRef::Symbol(symbol)),
            BindingForm::Callee { function } => {
                let scope = bound.fns[function.idx()].scope;
                builder.add_stored(self, binding, BindingRef::Slot(scope, ScopeSlot::Callee));
            }
            BindingForm::MappedArgument { unit, index } => {
                self.add_eval_mapped_argument(builder, binding, unit, index);
            }
            BindingForm::Import => self.add_eval_import(builder, binding, symbol, name),
            BindingForm::ContainerMember { .. } | BindingForm::NotAValue => {}
        }
    }

    fn add_eval_mapped_argument(
        &mut self,
        builder: &mut EvalScopeBuilder,
        binding: EvalBinding,
        unit: CodeUnit,
        index: u32,
    ) {
        let operand = builder.ensure_arguments_operand(self, unit);
        let binding = EvalBinding {
            kind: EvalBindingKind::MappedArgument,
            field: Some(index),
            ..binding
        };
        builder.add_operand(binding, operand);
    }

    fn add_eval_import(
        &mut self,
        builder: &mut EvalScopeBuilder,
        binding: EvalBinding,
        symbol: SymbolId,
        name: StringId,
    ) {
        let import = self
            .file
            .inputs
            .modules
            .import_binding(self.file.file, symbol);
        match import {
            ImportBinding::Variable(variable) => {
                builder.add_variable(self, binding, VariableKey::Symbol(variable));
            }
            ImportBinding::Synthetic(export) if !is_filled_by_loader(self.file, export) => {
                let value = module::emit_import_binding(self, import, name);
                builder.add_value(binding, value);
            }
            ImportBinding::Synthetic(export) | ImportBinding::CapturedBuiltin { export, .. } => {
                builder.add_variable(self, binding, VariableKey::SyntheticExport(export));
            }
            ImportBinding::Unbound | ImportBinding::Unused | ImportBinding::Local => {}
            _ => {
                let value = module::emit_import_binding(self, import, name);
                builder.add_value(binding, value);
            }
        }
    }

    fn add_eval_scope_bindings(
        &mut self,
        builder: &mut EvalScopeBuilder,
        context: EvalContext,
        scope: ScopeId,
        depth: u32,
    ) {
        let binding = create_binding(EvalBindingKind::EvalVariables, None, depth);
        builder.add_stored(
            self,
            binding,
            BindingRef::Slot(scope, ScopeSlot::EvalVariables),
        );
        if context.this_scope == Some(scope) {
            self.add_eval_owner_bindings(builder, context, scope, depth);
        }
        match self.file.bound.scopes[scope.idx()].kind {
            ScopeKind::With(_) => {
                let binding = create_binding(EvalBindingKind::WithObject, None, depth);
                builder.add_stored(
                    self,
                    binding,
                    BindingRef::Slot(scope, ScopeSlot::WithObject),
                );
            }
            ScopeKind::Class(class) => {
                self.add_eval_class_bindings(builder, context, class, depth);
            }
            ScopeKind::File => self.add_eval_commonjs_bindings(builder, context, depth),
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
        &mut self,
        builder: &mut EvalScopeBuilder,
        context: EvalContext,
        scope: ScopeId,
        depth: u32,
    ) {
        self.add_eval_arguments_binding(builder, context.owner, depth);
        let new_target = BindingRef::Slot(scope, ScopeSlot::NewTarget);
        if self.file.has_location(new_target) {
            let binding = create_binding(EvalBindingKind::NewTarget, None, depth);
            builder.add_stored(self, binding, new_target);
        }
        let this = BindingRef::Slot(scope, ScopeSlot::This);
        if context
            .flags
            .contains(EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR)
            || self.file.has_location(this)
        {
            let binding = create_binding(EvalBindingKind::This, None, depth);
            builder.add_stored(self, binding, this);
        }
        if context
            .flags
            .contains(EvalScopeFlags::ALLOWS_SUPER_PROPERTY)
        {
            let binding = create_binding(EvalBindingKind::HomeObject, None, depth);
            let home_object = match self.get_home_object() {
                (HomeObjectKind::Object, object) => object,
                (HomeObjectKind::ClassPrototype, class_object) => {
                    let key = self.file.atom_key(known::prototype);
                    self.builder.prop_get(class_object, key, false, false)
                }
            };
            builder.add_value(binding, home_object);
        }
    }

    fn add_eval_arguments_binding(
        &mut self,
        builder: &mut EvalScopeBuilder,
        owner: CodeUnit,
        depth: u32,
    ) {
        match self.file.scopes.arguments_object(owner) {
            ArgumentsObject::Unmapped | ArgumentsObject::Mapped => {
                let name = self.file.intern_atom(known::arguments);
                let binding = create_binding(EvalBindingKind::Arguments, Some(name), depth);
                let scope = self.file.bound.top_scope(self.file.hir, owner);
                let stored = BindingRef::Slot(scope, ScopeSlot::ArgumentsBinding);
                builder.add_stored(self, binding, stored);
            }
            ArgumentsObject::None => {}
        }
    }

    fn add_eval_class_bindings(
        &mut self,
        builder: &mut EvalScopeBuilder,
        context: EvalContext,
        class: ClassId,
        depth: u32,
    ) {
        let bound = self.file.bound;
        let scope = bound.class_scope[class.idx()];
        let stored_class_object = class_slot(scope, ClassSlot::ClassObject);
        let allows_super_call = context.class == Some(class)
            && context.flags.contains(EvalScopeFlags::ALLOWS_SUPER_CALL);
        let has_static_name = bound
            .private_names_of_class(class)
            .any(|(_, name)| name.is_static);
        let has_instance_name = bound
            .private_names_of_class(class)
            .any(|(_, name)| !name.is_static);
        if allows_super_call || has_static_name {
            let binding = create_binding(EvalBindingKind::ClassObject, None, depth);
            builder.add_stored(self, binding, stored_class_object);
        }
        let token = has_instance_name.then(|| {
            let token = self.get_stored(class_slot(scope, ClassSlot::ClassToken));
            builder.add_value_operand(token)
        });
        let class_object = has_static_name.then(|| {
            let class_object = self.get_stored(stored_class_object);
            builder.add_value_operand(class_object)
        });
        let operands = ClassOperands {
            scope,
            depth,
            token,
            class_object,
        };
        for (id, name) in bound.private_names_of_class(class) {
            self.add_eval_private_name(builder, operands, id, name.name);
        }
    }

    fn add_eval_private_name(
        &mut self,
        builder: &mut EvalScopeBuilder,
        operands: ClassOperands,
        id: PrivateNameId,
        name: Atom,
    ) {
        let resolved = self.file.resolve_private_name(id);
        let text = written_name(self.file.queries.atom_bytes(name));
        let text = self.file.intern_bytes(text);
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
                self.add_eval_private_storage(builder, binding, resolved.holder, static_field);
            }
            PrivateMembers::AutoAccessor(member) if !resolved.is_decorated => {
                let static_field = class_slot(scope, ClassSlot::StaticField(member));
                self.add_eval_private_storage(builder, binding, resolved.holder, static_field);
            }
            PrivateMembers::AutoAccessor(member) => {
                let binding = match resolved.holder {
                    PrivateHolder::Instance { layout, .. } => EvalBinding {
                        field: layouts::own_fields(self.file, layout).brand(),
                        ..binding
                    },
                    PrivateHolder::ClassObject => binding,
                };
                let stored_pair = class_slot(scope, ClassSlot::PrivateMethod(member));
                self.add_eval_decorated_accessor(builder, binding, stored_pair);
            }
            PrivateMembers::Method(member) => {
                let binding = EvalBinding {
                    kind: EvalBindingKind::PrivateMethod,
                    ..binding
                };
                self.add_eval_private_functions(builder, binding, scope, [Some(member), None]);
            }
            PrivateMembers::Accessor { getter, setter } => {
                let binding = EvalBinding {
                    kind: EvalBindingKind::PrivateAccessor,
                    ..binding
                };
                self.add_eval_private_functions(builder, binding, scope, [getter, setter]);
            }
        }
    }

    fn add_eval_private_storage(
        &mut self,
        builder: &mut EvalScopeBuilder,
        binding: EvalBinding,
        holder: PrivateHolder,
        static_field: BindingRef,
    ) {
        match holder {
            PrivateHolder::Instance { .. } => builder.bindings.push(binding),
            PrivateHolder::ClassObject => builder.add_stored(self, binding, static_field),
        }
    }

    fn add_eval_private_functions(
        &mut self,
        builder: &mut EvalScopeBuilder,
        binding: EvalBinding,
        scope: ScopeId,
        members: [Option<MemberId>; 2],
    ) {
        let [function, setter] = members.map(|member| {
            member.map(|member| {
                let stored_function = class_slot(scope, ClassSlot::PrivateMethod(member));
                let function = self.get_stored(stored_function);
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
        &mut self,
        builder: &mut EvalScopeBuilder,
        binding: EvalBinding,
        stored_pair: BindingRef,
    ) {
        let pair = self.get_stored(stored_pair);
        let [function, setter] = [known::get, known::set].map(|name| {
            let key = self.file.name_key(name);
            let function = self.emit_get(pair, PropertyName::Constant(key));
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
        &mut self,
        builder: &mut EvalScopeBuilder,
        context: EvalContext,
        depth: u32,
    ) {
        if !self.file.is_commonjs_module() {
            return;
        }
        if context.owner == CodeUnit::File {
            self.add_eval_arguments_binding(builder, CodeUnit::File, depth);
        }
        let scope = module::file_scope(self.file);
        let arguments_object = self.file.scopes.arguments_object(CodeUnit::File);
        for variable in commonjs::undeclared_wrapper_parameters(self.file.bound) {
            let name = self.file.intern_atom(variable.name());
            let binding = create_binding(EvalBindingKind::Variable, Some(name), depth);
            match arguments_object {
                ArgumentsObject::Mapped => {
                    let index = commonjs::wrapper_parameter_index(variable);
                    self.add_eval_mapped_argument(builder, binding, CodeUnit::File, index);
                }
                ArgumentsObject::None | ArgumentsObject::Unmapped => {
                    let stored = BindingRef::Slot(scope, ScopeSlot::CommonJs(variable));
                    builder.add_stored(self, binding, stored);
                }
            }
        }
    }
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
        let operand = self.add_value_operand(lowering.get_environment(scope));
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
        let operand = self.add_value_operand(lowering.get_arguments_object(unit));
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
        let variable = lowering.file.ensure_variable(key);
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
            Storage::Field { scope, field } if lowering.can_reach_environment(scope) => {
                self.add_field(lowering, binding, scope, field);
            }
            Storage::Field { .. } | Storage::Local => {
                let value = lowering.get_stored(stored);
                self.add_value(binding, value);
            }
        }
    }
}

// The loader fills the variable of a name of a library module.
fn is_filled_by_loader(file: &FileLowering<'_, '_, '_, '_>, export: SyntheticExportId) -> bool {
    let modules = file.inputs.modules;
    match modules.shape(modules.synthetic_export(export).module) {
        Shape::AsToday | Shape::EsModule => true,
        Shape::Names | Shape::Value => false,
    }
}

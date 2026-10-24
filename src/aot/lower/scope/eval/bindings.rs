use bun_sema::atom::{Atom, known, written_name};
use bun_sema::bind::{
    BindingKind, Bound, CodeUnit, Decl, EvalScope, PrivateMembers, ScopeId, ScopeKind, SymbolId,
};
use bun_sema::hir::{self, ClassId, MemberId};
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

use super::EvalContext;
use crate::ir::generated::{EvalBinding, EvalBindingKind, EvalScopeFlags, HomeObjectKind};
use crate::ir::{ClassSlot, StringId, ValueId, VariableKey};
use crate::lower::captures::Capture;
use crate::lower::member::PropertyName;
use crate::lower::private_names::{PrivateBinding, PrivateHolder};
use crate::lower::scope::{
    ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage, environments, find_entry,
};
use crate::lower::{FileLowering, FunctionLowering, commonjs, layouts, module};
use crate::modules::{ImportBinding, Shape, SyntheticExportId};

type ScopeDepths = SmallVec<[(ScopeId, u32); 8]>;
pub(super) type EvalOperands = SmallVec<[ValueId; 4]>;

struct EvalRecord<'l, 'f, 'a, 'c, 'p, 's> {
    lowering: &'l mut FunctionLowering<'f, 'a, 'c, 'p, 's>,
    context: EvalContext,
    bindings: Vec<EvalBinding>,
    operands: EvalOperands,
    environments: SmallVec<[(ScopeId, u32); 4]>,
    arguments_objects: SmallVec<[(CodeUnit, u32); 1]>,
}

fn create_binding(kind: EvalBindingKind, name: Option<StringId>, depth: u32) -> EvalBinding {
    EvalBinding {
        name,
        kind,
        depth,
        ..EvalBinding::default()
    }
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
    ) -> (Vec<EvalBinding>, EvalOperands) {
        let bound = self.file.bound;
        let depths = compute_scope_depths(self.file.hir, bound, eval_scope.scope);
        let mut record = EvalRecord {
            lowering: self,
            context,
            bindings: Vec::new(),
            operands: SmallVec::new(),
            environments: SmallVec::new(),
            arguments_objects: SmallVec::new(),
        };
        for symbol in bound.ids(eval_scope.symbols) {
            let Some(depth) = find_entry(&depths, bound.symbol_scope(symbol)) else {
                debug_assert!(
                    false,
                    "a binding visible to eval is declared in an enclosing scope"
                );
                continue;
            };
            record.add_symbol(symbol, depth);
        }
        for &(scope, depth) in &depths {
            record.add_scope_bindings(scope, depth);
        }
        record.bindings.shared_sort_by_key(|binding| binding.depth);
        (record.bindings, record.operands)
    }
}

impl EvalRecord<'_, '_, '_, '_, '_, '_> {
    fn add_symbol(&mut self, symbol: SymbolId, depth: u32) {
        let file = &mut *self.lowering.file;
        let bound = file.bound;
        let name = file.intern_atom(file.find_spelled_name(symbol));
        let declared_as = bound.binding_kind(symbol);
        let is_lexical = matches!(
            declared_as,
            BindingKind::Let | BindingKind::Const | BindingKind::Class
        );
        let depth = depth - u32::from(is_lexical);
        let binding = create_binding(compute_binding_kind(declared_as), Some(name), depth);
        match file.scopes.form(symbol) {
            BindingForm::Stored => self.add_stored(binding, BindingRef::Symbol(symbol)),
            BindingForm::Callee { function } => {
                let scope = bound.fns[function.idx()].scope;
                self.add_stored(binding, BindingRef::Slot(scope, ScopeSlot::Callee));
            }
            BindingForm::MappedArgument { unit, index } => {
                self.add_mapped_argument(binding, unit, index);
            }
            BindingForm::Import => self.add_import(binding, symbol, name),
            BindingForm::ContainerMember { .. } | BindingForm::NotAValue => {}
        }
    }

    fn add_mapped_argument(&mut self, binding: EvalBinding, unit: CodeUnit, index: u32) {
        let operand = match find_entry(&self.arguments_objects, unit) {
            Some(operand) => operand,
            None => {
                let arguments = self.lowering.get_arguments_object(unit);
                let operand = self.add_value_operand(arguments);
                self.arguments_objects.push((unit, operand));
                operand
            }
        };
        self.bindings.push(EvalBinding {
            kind: EvalBindingKind::MappedArgument,
            field: Some(index),
            operand: Some(operand),
            ..binding
        });
    }

    fn add_import(&mut self, binding: EvalBinding, symbol: SymbolId, name: StringId) {
        let file = &*self.lowering.file;
        let import = file.inputs.modules.import_binding(file.file, symbol);
        match import {
            ImportBinding::Variable(variable) => {
                self.add_variable(binding, VariableKey::Symbol(variable));
            }
            ImportBinding::Synthetic(export) if !is_filled_by_loader(file, export) => {
                let value = module::emit_import_binding(self.lowering, import, name);
                self.add_value(binding, value);
            }
            ImportBinding::Synthetic(export) | ImportBinding::CapturedBuiltin { export, .. } => {
                self.add_variable(binding, VariableKey::SyntheticExport(export));
            }
            ImportBinding::Unbound | ImportBinding::Unused | ImportBinding::Local => {}
            _ => {
                let value = module::emit_import_binding(self.lowering, import, name);
                self.add_value(binding, value);
            }
        }
    }

    fn add_scope_bindings(&mut self, scope: ScopeId, depth: u32) {
        let binding = create_binding(EvalBindingKind::EvalVariables, None, depth);
        self.add_stored(binding, BindingRef::Slot(scope, ScopeSlot::EvalVariables));
        if self.context.this_scope == Some(scope) {
            self.add_owner_bindings(scope, depth);
        }
        match self.lowering.file.bound.scopes[scope.idx()].kind {
            ScopeKind::With(_) => {
                let binding = create_binding(EvalBindingKind::WithObject, None, depth);
                self.add_stored(binding, BindingRef::Slot(scope, ScopeSlot::WithObject));
            }
            ScopeKind::Class(class) => self.add_class_bindings(class, depth),
            ScopeKind::File => self.add_commonjs_bindings(depth),
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

    fn add_owner_bindings(&mut self, scope: ScopeId, depth: u32) {
        let flags = self.context.flags;
        self.add_arguments_binding(self.context.owner, depth);
        let new_target = BindingRef::Slot(scope, ScopeSlot::NewTarget);
        if self.lowering.file.has_location(new_target) {
            let binding = create_binding(EvalBindingKind::NewTarget, None, depth);
            self.add_stored(binding, new_target);
        }
        let this = BindingRef::Slot(scope, ScopeSlot::This);
        if flags.contains(EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR)
            || self.lowering.file.has_location(this)
        {
            self.add_stored(create_binding(EvalBindingKind::This, None, depth), this);
        }
        if flags.contains(EvalScopeFlags::ALLOWS_SUPER_PROPERTY) {
            let binding = create_binding(EvalBindingKind::HomeObject, None, depth);
            let lowering = &mut *self.lowering;
            let home_object = match lowering.get_home_object() {
                (HomeObjectKind::Object, object) => object,
                (HomeObjectKind::ClassPrototype, class_object) => {
                    let key = lowering.file.atom_key(known::prototype);
                    lowering.builder.prop_get(class_object, key, false, false)
                }
            };
            self.add_value(binding, home_object);
        }
    }

    fn add_arguments_binding(&mut self, owner: CodeUnit, depth: u32) {
        let file = &mut *self.lowering.file;
        match file.scopes.arguments_object(owner) {
            ArgumentsObject::Unmapped | ArgumentsObject::Mapped => {
                let name = file.intern_atom(known::arguments);
                let binding = create_binding(EvalBindingKind::Arguments, Some(name), depth);
                let stored = file.code_unit_slot(owner, ScopeSlot::ArgumentsBinding);
                self.add_stored(binding, stored);
            }
            ArgumentsObject::None => {}
        }
    }

    fn add_class_bindings(&mut self, class: ClassId, depth: u32) {
        let (bound, context) = (self.lowering.file.bound, self.context);
        let scope = bound.class_scope[class.idx()];
        let stored_class_object = class_slot(scope, ClassSlot::ClassObject);
        let allows_super_call = context.class == Some(class)
            && context.flags.contains(EvalScopeFlags::ALLOWS_SUPER_CALL);
        let names = || bound.private_names_of_class(class);
        let has_static_name = names().any(|(_, name)| name.is_static);
        let has_instance_name = names().any(|(_, name)| !name.is_static);
        if allows_super_call || has_static_name {
            let binding = create_binding(EvalBindingKind::ClassObject, None, depth);
            self.add_stored(binding, stored_class_object);
        }
        let stored_token = class_slot(scope, ClassSlot::ClassToken);
        let token = has_instance_name.then(|| self.add_stored_operand(stored_token));
        let class_object = has_static_name.then(|| self.add_stored_operand(stored_class_object));
        for (id, name) in names() {
            let file = &mut *self.lowering.file;
            let resolved = file.resolve_private_name(id);
            let text = written_name(file.queries.atom_bytes(name.name));
            let text = file.intern_bytes(text);
            let binding = create_binding(EvalBindingKind::PrivateName, Some(text), depth);
            let binding = match resolved.holder {
                PrivateHolder::Instance { layout, field } => EvalBinding {
                    layout: Some(layout),
                    field: Some(field),
                    operand: token,
                    ..binding
                },
                PrivateHolder::ClassObject => EvalBinding {
                    operand: class_object,
                    ..binding
                },
            };
            self.add_private_name(binding, resolved, scope);
        }
    }

    fn add_private_name(
        &mut self,
        mut binding: EvalBinding,
        resolved: PrivateBinding,
        scope: ScopeId,
    ) {
        let (kind, function, setter) = match resolved.members {
            PrivateMembers::AutoAccessor(member) if resolved.is_decorated => {
                match resolved.holder {
                    PrivateHolder::Instance { layout, .. } => {
                        binding.field = layouts::own_fields(self.lowering.file, layout).brand();
                    }
                    PrivateHolder::ClassObject => {}
                }
                let stored_pair = class_slot(scope, ClassSlot::PrivateMethod(member));
                let pair = self.lowering.get_stored(stored_pair);
                let [function, setter] = [known::get, known::set].map(|name| {
                    let key = self.lowering.file.name_key(name);
                    let function = self.lowering.emit_get(pair, PropertyName::Constant(key));
                    Some(self.add_value_operand(function))
                });
                (EvalBindingKind::PrivateAccessor, function, setter)
            }
            PrivateMembers::Field(member) | PrivateMembers::AutoAccessor(member) => {
                match resolved.holder {
                    PrivateHolder::Instance { .. } => self.bindings.push(binding),
                    PrivateHolder::ClassObject => {
                        self.add_stored(binding, class_slot(scope, ClassSlot::StaticField(member)));
                    }
                }
                return;
            }
            PrivateMembers::Method(member) => {
                let function = self.add_private_function(scope, Some(member));
                (EvalBindingKind::PrivateMethod, function, None)
            }
            PrivateMembers::Accessor { getter, setter } => {
                let function = self.add_private_function(scope, getter);
                let setter = self.add_private_function(scope, setter);
                (EvalBindingKind::PrivateAccessor, function, setter)
            }
        };
        self.bindings.push(EvalBinding {
            kind,
            function,
            setter,
            ..binding
        });
    }

    fn add_private_function(&mut self, scope: ScopeId, member: Option<MemberId>) -> Option<u32> {
        Some(self.add_stored_operand(class_slot(scope, ClassSlot::PrivateMethod(member?))))
    }

    fn add_commonjs_bindings(&mut self, depth: u32) {
        if !self.lowering.file.is_commonjs_module() {
            return;
        }
        if self.context.owner == CodeUnit::File {
            self.add_arguments_binding(CodeUnit::File, depth);
        }
        let scope = module::file_scope(self.lowering.file);
        let arguments_object = self.lowering.file.scopes.arguments_object(CodeUnit::File);
        for variable in commonjs::undeclared_wrapper_parameters(self.lowering.file.bound) {
            let name = self.lowering.file.intern_atom(variable.name());
            let binding = create_binding(EvalBindingKind::Variable, Some(name), depth);
            match arguments_object {
                ArgumentsObject::Mapped => {
                    let index = commonjs::wrapper_parameter_index(variable);
                    self.add_mapped_argument(binding, CodeUnit::File, index);
                }
                ArgumentsObject::None | ArgumentsObject::Unmapped => {
                    let stored = BindingRef::Slot(scope, ScopeSlot::CommonJs(variable));
                    self.add_stored(binding, stored);
                }
            }
        }
    }

    fn add_value_operand(&mut self, value: ValueId) -> u32 {
        let operand = self.operands.len() as u32;
        self.operands.push(value);
        operand
    }

    fn add_stored_operand(&mut self, stored: BindingRef) -> u32 {
        let value = self.lowering.get_stored(stored);
        self.add_value_operand(value)
    }

    fn add_value(&mut self, binding: EvalBinding, value: ValueId) {
        let operand = Some(self.add_value_operand(value));
        self.bindings.push(EvalBinding { operand, ..binding });
    }

    fn add_variable(&mut self, binding: EvalBinding, key: VariableKey) {
        let variable = Some(self.lowering.file.ensure_variable(key));
        self.bindings.push(EvalBinding {
            variable,
            ..binding
        });
    }

    fn add_stored(&mut self, binding: EvalBinding, stored: BindingRef) {
        let Some(placement) = self.lowering.file.scopes.placement(stored) else {
            return;
        };
        match placement.storage {
            Storage::Variable(key) => self.add_variable(binding, key),
            Storage::Field { scope, field } if self.lowering.can_reach_environment(scope) => {
                let operand = match find_entry(&self.environments, scope) {
                    Some(operand) => operand,
                    None => {
                        let environment = self.lowering.get_environment(scope);
                        let operand = self.add_value_operand(environment);
                        self.environments.push((scope, operand));
                        operand
                    }
                };
                self.bindings.push(EvalBinding {
                    layout: Some(environments::environment_layout(self.lowering.file, scope)),
                    field: Some(field),
                    operand: Some(operand),
                    ..binding
                });
            }
            Storage::Field { .. } | Storage::Local => {
                let value = self.lowering.get_stored(stored);
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

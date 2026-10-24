use bun_sema::bind::{
    BindingKind, CommonJsVariable, InitialState, ScopeId, ScopeKind, SymbolId,
    has_simple_parameter_list,
};
use bun_sema::check::aot::ClassRef;
use smallvec::SmallVec;

use super::{BindingRef, ScopeSlot, dead_zone};
use crate::builtins::id::BuiltinId;
use crate::builtins::{BuiltinPath, Mutability};
use crate::ir::generated::{Field, FieldFlags, Layout, LayoutKind};
use crate::ir::{
    ClassSlot, DeclaredType, LayoutId, LayoutKey, Mapped, OpaqueKind, PositionFlags, Primitives,
    PropertyKey, Type, TypeTable,
};
use crate::lower::{FileLowering, class};

pub(in crate::lower) fn environment_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    scope: ScopeId,
) -> LayoutId {
    let layout = file.fragment.declare_layout(LayoutKey::Environment {
        file: file.file,
        environment: scope.0,
    });
    if file.fragment.is_layout_defined(layout) {
        return layout;
    }
    let bindings = file.scopes.environment_fields(scope);
    let bindings: SmallVec<[BindingRef; 8]> = SmallVec::from_slice(bindings);
    let mut fields = Vec::with_capacity(bindings.len());
    for (index, &binding) in bindings.iter().enumerate() {
        fields.push(file.create_environment_field(binding, index));
    }
    if !file.fragment.is_layout_defined(layout) {
        let definition = Layout {
            kind: LayoutKind::Environment,
            module: Some(file.module_id()),
            fields,
            ..Layout::default()
        };
        file.fragment.define_layout(layout, definition);
    }
    layout
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn stored_position(&mut self, binding: BindingRef) -> DeclaredType {
        let symbol = match binding {
            BindingRef::Symbol(symbol) => symbol,
            BindingRef::Slot(scope, slot) => return self.slot_position(scope, slot),
        };
        // A name that stands for a module holds `true`, whatever type is written behind it.
        if self.inputs.modules.holder(self.file, symbol).is_some() {
            return DeclaredType::untyped();
        }
        let position = self.binding_position(symbol);
        let path = self.builtins.of_symbol(symbol);
        self.expect_builtin_path(position, path)
    }

    pub(super) fn location_position(&mut self, binding: BindingRef) -> DeclaredType {
        let mut position = self.stored_position(binding);
        if dead_zone::has_dead_zone(self, binding) {
            position.ty = self.fragment.types.union(position.ty, TypeTable::ABSENT);
        }
        position
    }

    pub(super) fn is_listed_at_allocation(&self, binding: BindingRef) -> bool {
        if dead_zone::has_dead_zone(self, binding) {
            return false;
        }
        match binding {
            BindingRef::Symbol(symbol) => match self.bound.initial_state(symbol) {
                InitialState::Uninitialized => false,
                InitialState::Undefined => true,
                InitialState::Initialized => self.is_simple_parameter(symbol),
            },
            BindingRef::Slot(_, slot) => !matches!(slot, ScopeSlot::Class(_)),
        }
    }

    fn is_simple_parameter(&self, symbol: SymbolId) -> bool {
        let bound = self.bound;
        if bound.binding_kind(symbol) != BindingKind::Parameter {
            return false;
        }
        let ScopeKind::Fn(function) = bound.scopes[bound.symbol_scope(symbol).idx()].kind else {
            return false;
        };
        has_simple_parameter_list(self.hir, function)
    }

    fn create_environment_field(&mut self, binding: BindingRef, index: usize) -> Field {
        let label = format!("{}.{index}", slot_label(binding));
        let label = self.intern_bytes(label.as_bytes());
        let key = PropertyKey::from_engine_private_name(label);
        let key = self.fragment.property_keys.intern(key);
        let placement = self.scopes.placement(binding);
        let mut flags = FieldFlags::default();
        if self.is_listed_at_allocation(binding) {
            flags |= FieldFlags::IS_REQUIRED;
        }
        if placement.is_some_and(|placement| placement.is_immutable) {
            flags |= FieldFlags::IS_IMMUTABLE;
        }
        Field {
            key: Some(key),
            declared: self.location_position(binding),
            flags,
            ..Field::default()
        }
    }

    fn slot_position(&mut self, scope: ScopeId, slot: ScopeSlot) -> DeclaredType {
        match slot {
            ScopeSlot::This => this_position(self, scope),
            ScopeSlot::NewTarget
            | ScopeSlot::ArgumentsBinding
            | ScopeSlot::Class(ClassSlot::DecoratorState | ClassSlot::PrivateMethod(_)) => {
                DeclaredType::untyped()
            }
            ScopeSlot::Callee | ScopeSlot::Class(ClassSlot::ClassObject) => {
                DeclaredType::from_compiler(TypeTable::FUNCTION)
            }
            ScopeSlot::CommonJs(variable) => {
                if variable == CommonJsVariable::Exports
                    && let Some(position) = self.own_exports_position()
                {
                    return position;
                }
                let path = self.builtins.commonjs_variable(variable);
                self.expect_builtin_path(DeclaredType::untyped(), path)
            }
            ScopeSlot::Class(ClassSlot::ClassToken) => {
                let token = Type::opaque(OpaqueKind::ClassToken);
                DeclaredType::from_compiler(self.fragment.types.intern(token))
            }
            ScopeSlot::Class(ClassSlot::ComputedKey(_)) => {
                let types = &mut self.fragment.types;
                DeclaredType::from_compiler(types.union(TypeTable::STRING, TypeTable::SYMBOL))
            }
            ScopeSlot::Class(ClassSlot::StaticField(member)) => {
                let ScopeKind::Class(class) = self.bound.scopes[scope.idx()].kind else {
                    unreachable!("a class slot belongs to the scope of its class");
                };
                class::static_field_position(self, class, member)
            }
            _ => DeclaredType::from_compiler(TypeTable::OBJECT),
        }
    }

    fn own_exports_position(&mut self) -> Option<DeclaredType> {
        let layout = self.module_exports_layout(self.file)?;
        let exports = Mapped::expected(self.fragment.types.intern(Type::layout(layout)));
        Some(DeclaredType::new(exports, None, PositionFlags::default()))
    }

    // `ToThis` gives an object, so of the type of the entry value only the object part holds.
    fn converted_this_position(&mut self, entry: DeclaredType) -> DeclaredType {
        let types = &mut self.fragment.types;
        let objects = types.without_primitives(entry.ty, Primitives::ALL);
        if objects == TypeTable::OBJECT || objects == TypeTable::NEVER {
            return DeclaredType::from_compiler(TypeTable::OBJECT);
        }
        let mapped = match entry.is_expected() {
            true => Mapped::expected(objects),
            false => Mapped::checked(objects),
        };
        DeclaredType::new(mapped, entry.site, PositionFlags::default())
    }

    // Every store is checked against a checked type, so that type stays as it is.
    fn expect_builtin_path(
        &mut self,
        position: DeclaredType,
        path: Option<BuiltinPath>,
    ) -> DeclaredType {
        let Some(path) = path else {
            return position;
        };
        if path.mutability < Mutability::ConstantUnlessWritten {
            return position;
        }
        let is_expected = position.is_expected();
        if !is_expected && position.ty != TypeTable::ANYTHING {
            return position;
        }
        let own_exports = match path.id == BuiltinId::ModuleObjectExports {
            true => self.own_exports_position(),
            false => None,
        };
        let types = &mut self.fragment.types;
        let builtin = match own_exports {
            Some(exports) => exports.ty,
            None => types.intern(Type::builtin(path.id)),
        };
        let expected = match is_expected {
            true => types.union(position.ty, builtin),
            false => builtin,
        };
        DeclaredType::new(Mapped::expected(expected), position.site, position.flags)
    }
}

fn this_position(file: &mut FileLowering<'_, '_, '_, '_>, scope: ScopeId) -> DeclaredType {
    let bound = file.bound;
    match bound.scopes[scope.idx()].kind {
        ScopeKind::Fn(function) => {
            let position = file.function_positions(function).this;
            match bound.is_strict_scope(scope) {
                true => position,
                false => file.converted_this_position(position),
            }
        }
        ScopeKind::FieldInitializer(member) => {
            let class = bound.member_class(member);
            let class = ClassRef {
                file: file.file,
                class: class.expect("a field initializer belongs to a member of a class"),
            };
            file.class_this_type(class, Some(member))
        }
        ScopeKind::File => file
            .own_exports_position()
            .unwrap_or_else(DeclaredType::untyped),
        _ => DeclaredType::untyped(),
    }
}

fn slot_label(binding: BindingRef) -> &'static str {
    match binding {
        BindingRef::Symbol(_) => "binding",
        BindingRef::Slot(_, slot) => match slot {
            ScopeSlot::This => "this",
            ScopeSlot::NewTarget => "newTarget",
            ScopeSlot::Callee => "callee",
            ScopeSlot::HomeObject => "homeObject",
            ScopeSlot::Arguments => "arguments",
            ScopeSlot::ArgumentsBinding => "argumentsBinding",
            ScopeSlot::CommonJs(_) => "commonJs",
            ScopeSlot::WithObject => "withObject",
            ScopeSlot::EvalVariables => "evalVariables",
            ScopeSlot::Class(ClassSlot::ClassObject) => "classObject",
            ScopeSlot::Class(ClassSlot::ClassToken) => "classToken",
            ScopeSlot::Class(ClassSlot::ComputedKey(_)) => "computedKey",
            ScopeSlot::Class(ClassSlot::StaticField(_)) => "staticField",
            ScopeSlot::Class(ClassSlot::DecoratorState) => "decoratorState",
            ScopeSlot::Class(ClassSlot::PrivateMethod(_)) => "privateMethod",
        },
    }
}

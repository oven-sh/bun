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
    PropertyKey, Type, TypeTable, ValueId,
};
use crate::lower::captures::{self, Capture};
use crate::lower::{FileLowering, FunctionLowering, class, layouts, positions};

pub(super) fn environment_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    scope: ScopeId,
) -> LayoutId {
    let layout = file.fragment.declare_layout(LayoutKey::Environment {
        file: file.file,
        environment: scope.0,
    });
    if !file.fragment.is_layout_defined(layout) {
        define_environment_layout(file, layout, scope);
    }
    layout
}

pub(super) fn get_environment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
) -> ValueId {
    match lowering.scopes.find_environment(scope) {
        Some(variable) => lowering.builder.read_variable(variable),
        None => captures::find_captured_value(lowering, Capture::Environment(scope))
            .expect("a function captures every environment it reaches"),
    }
}

pub(super) fn stored_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    binding: BindingRef,
) -> DeclaredType {
    match binding {
        BindingRef::Symbol(symbol) => symbol_position(file, symbol),
        BindingRef::Slot(scope, slot) => slot_position(file, scope, slot),
    }
}

pub(super) fn location_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    binding: BindingRef,
) -> DeclaredType {
    let position = stored_position(file, binding);
    if !dead_zone::has_dead_zone(file, binding) {
        return position;
    }
    dead_zone::add_absent(file, position)
}

pub(super) fn is_listed_at_allocation(
    file: &FileLowering<'_, '_, '_, '_>,
    binding: BindingRef,
) -> bool {
    if dead_zone::has_dead_zone(file, binding) {
        return false;
    }
    match binding {
        BindingRef::Symbol(symbol) => match file.bound.initial_state(symbol) {
            InitialState::Uninitialized => false,
            InitialState::Undefined => true,
            InitialState::Initialized => is_simple_parameter(file, symbol),
        },
        BindingRef::Slot(_, slot) => match slot {
            ScopeSlot::Class(_) => false,
            _ => true,
        },
    }
}

fn is_simple_parameter(file: &FileLowering<'_, '_, '_, '_>, symbol: SymbolId) -> bool {
    let bound = file.bound;
    if bound.binding_kind(symbol) != BindingKind::Parameter {
        return false;
    }
    let ScopeKind::Fn(function) = bound.scopes[bound.symbol_scope(symbol).idx()].kind else {
        return false;
    };
    has_simple_parameter_list(file.hir, function)
}

fn define_environment_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    scope: ScopeId,
) {
    let bindings = file.scopes.environment_fields(scope);
    let bindings: SmallVec<[BindingRef; 8]> = SmallVec::from_slice(bindings);
    let mut fields = Vec::with_capacity(bindings.len());
    for (index, &binding) in bindings.iter().enumerate() {
        fields.push(create_environment_field(file, binding, index));
    }
    if file.fragment.is_layout_defined(layout) {
        return;
    }
    let definition = Layout {
        kind: LayoutKind::Environment,
        module: Some(file.module_id()),
        fields,
        ..Layout::default()
    };
    file.fragment.define_layout(layout, definition);
}

fn create_environment_field(
    file: &mut FileLowering<'_, '_, '_, '_>,
    binding: BindingRef,
    index: usize,
) -> Field {
    let label = format!("{}.{index}", slot_label(binding));
    let label = file.intern_bytes(label.as_bytes());
    let key = PropertyKey::from_engine_private_name(label);
    let key = file.fragment.property_keys.intern(key);
    let placement = file.scopes.placement(binding);
    let mut flags = FieldFlags::default();
    if is_listed_at_allocation(file, binding) {
        flags |= FieldFlags::IS_REQUIRED;
    }
    if placement.is_some_and(|placement| placement.is_immutable) {
        flags |= FieldFlags::IS_IMMUTABLE;
    }
    Field {
        key: Some(key),
        declared: location_position(file, binding),
        flags,
        ..Field::default()
    }
}

fn symbol_position(file: &mut FileLowering<'_, '_, '_, '_>, symbol: SymbolId) -> DeclaredType {
    // A name that stands for a module holds `true`, whatever type is written behind it.
    if file.inputs.modules.holder(file.file, symbol).is_some() {
        return DeclaredType::untyped();
    }
    let position = positions::binding_position(file, symbol);
    let path = file.builtins.of_symbol(symbol);
    expect_builtin_path(file, position, path)
}

fn slot_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    scope: ScopeId,
    slot: ScopeSlot,
) -> DeclaredType {
    match slot {
        ScopeSlot::This => this_position(file, scope),
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
                && let Some(position) = own_exports_position(file)
            {
                return position;
            }
            let path = file.builtins.commonjs_variable(variable);
            expect_builtin_path(file, DeclaredType::untyped(), path)
        }
        ScopeSlot::Class(ClassSlot::ClassToken) => {
            let token = Type::opaque(OpaqueKind::ClassToken);
            DeclaredType::from_compiler(file.fragment.types.intern(token))
        }
        ScopeSlot::Class(ClassSlot::ComputedKey(_)) => {
            let types = &mut file.fragment.types;
            DeclaredType::from_compiler(types.union(TypeTable::STRING, TypeTable::SYMBOL))
        }
        ScopeSlot::Class(ClassSlot::StaticField(member)) => {
            let ScopeKind::Class(class) = file.bound.scopes[scope.idx()].kind else {
                unreachable!("a class slot belongs to the scope of its class");
            };
            class::static_field_position(file, class, member)
        }
        _ => DeclaredType::from_compiler(TypeTable::OBJECT),
    }
}

fn own_exports_position(file: &mut FileLowering<'_, '_, '_, '_>) -> Option<DeclaredType> {
    let layout = layouts::module_exports_layout(file, file.file)?;
    let exports = file.fragment.types.intern(Type::layout(layout));
    Some(DeclaredType::new(
        Mapped::expected(exports),
        None,
        PositionFlags::default(),
    ))
}

fn this_position(file: &mut FileLowering<'_, '_, '_, '_>, scope: ScopeId) -> DeclaredType {
    let bound = file.bound;
    match bound.scopes[scope.idx()].kind {
        ScopeKind::Fn(function) => {
            let position = positions::function_positions(file, function).this;
            match bound.is_strict_scope(scope) {
                true => position,
                false => converted_this_position(file, position),
            }
        }
        ScopeKind::FieldInitializer(member) => {
            let class = bound.member_class(member);
            let class = ClassRef {
                file: file.file,
                class: class.expect("a field initializer belongs to a member of a class"),
            };
            positions::class_this_type(file, class, Some(member))
        }
        ScopeKind::File => own_exports_position(file).unwrap_or_else(DeclaredType::untyped),
        _ => DeclaredType::untyped(),
    }
}

// `ToThis` gives an object, so of the type of the entry value only the object part holds.
fn converted_this_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    entry: DeclaredType,
) -> DeclaredType {
    let objects = file
        .fragment
        .types
        .without_primitives(entry.ty, Primitives::ALL);
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
    file: &mut FileLowering<'_, '_, '_, '_>,
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
        true => own_exports_position(file),
        false => None,
    };
    let types = &mut file.fragment.types;
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

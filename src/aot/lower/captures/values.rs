use bun_sema::bind::Binding;
use smallvec::SmallVec;

use super::{Capture, CaptureList};
use crate::ir::generated::{Field, FieldFlags, Layout, LayoutKind};
use crate::ir::{
    DeclaredType, FunctionKey, LayoutId, LayoutKey, PropertyKey, Type, TypeTable, ValueId,
};
use crate::lower::scope::{self, BindingRef, DeadZone, LocalBinding, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering};

// The environments of a file are numbered by their scopes.
const FIRST_PACK: u32 = 1 << 31;

// A closure has room for so many captures.
fn find_pack_layout(file: &mut FileLowering<'_, '_, '_, '_>, key: FunctionKey) -> Option<LayoutId> {
    let number = file.scopes.packed_captures(key)?;
    let layout = file.fragment.declare_layout(LayoutKey::Environment {
        file: file.file,
        environment: FIRST_PACK | number,
    });
    if file.fragment.is_layout_defined(layout) {
        return Some(layout);
    }
    let positions = list_positions(file, key);
    let mut fields = Vec::with_capacity(positions.len());
    for (index, declared) in positions.into_iter().enumerate() {
        let label = file.intern_bytes(format!("capture.{index}").as_bytes());
        let key = PropertyKey::from_engine_private_name(label);
        fields.push(Field {
            key: Some(file.fragment.property_keys.intern(key)),
            declared,
            flags: FieldFlags::IS_REQUIRED | FieldFlags::IS_IMMUTABLE,
            ..Field::default()
        });
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
    Some(layout)
}

pub(super) fn unpack_captures(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    let Some(layout) = find_pack_layout(lowering.file, lowering.key) else {
        return;
    };
    let pack = lowering.builder.capture(0);
    let fields = 0..lowering.file.scopes.captures(lowering.key).len() as u32;
    let values = fields.map(|field| lowering.builder.get_environment_field(pack, layout, field));
    let values = values.collect();
    lowering.scopes.set_unpacked_captures(values);
}

fn get_capture(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, index: usize) -> ValueId {
    match lowering.scopes.unpacked_captures().get(index) {
        Some(&value) => value,
        None => lowering.builder.capture(index as u32),
    }
}

pub(crate) fn bind_captures(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    let captures: CaptureList = SmallVec::from_slice(lowering.file.scopes.captures(lowering.key));
    let first_copy = captures.iter().find_map(|&capture| match capture {
        Capture::Environment(_) => None,
        Capture::Value(binding) => Some(binding),
    });
    if first_copy.is_some_and(|binding| lowering.scopes.find_local(binding).is_some()) {
        return;
    }
    for (index, &capture) in captures.iter().enumerate() {
        match capture {
            Capture::Environment(_) => {}
            Capture::Value(binding) => {
                let position = scope::stored_position(lowering.file, binding);
                let declared = (position.ty != TypeTable::ANYTHING).then_some(position.ty);
                let variable = lowering.builder.create_variable(declared);
                let value = get_capture(lowering, index);
                lowering.builder.write_variable(variable, value);
                let local = LocalBinding {
                    variable,
                    dead_zone: DeadZone::Never,
                };
                lowering.scopes.declare_local(binding, local);
            }
        }
    }
}

pub(in crate::lower) fn capture_positions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
) -> Vec<DeclaredType> {
    match find_pack_layout(file, key) {
        Some(layout) => {
            let pack = file.fragment.types.intern(Type::environment(layout));
            vec![DeclaredType::from_compiler(pack)]
        }
        None => list_positions(file, key),
    }
}

fn list_positions(file: &mut FileLowering<'_, '_, '_, '_>, key: FunctionKey) -> Vec<DeclaredType> {
    let captures: CaptureList = SmallVec::from_slice(file.scopes.captures(key));
    let is_left_out = is_left_out(file, key);
    let positions = captures.into_iter().map(|capture| match capture {
        Capture::Environment(scope) => {
            let layout = scope::environment_layout(file, scope);
            let environment = file.fragment.types.intern(Type::environment(layout));
            DeclaredType::from_compiler(environment)
        }
        Capture::Value(_) if is_left_out => DeclaredType::untyped(),
        Capture::Value(binding) => scope::stored_position(file, binding),
    });
    positions.collect()
}

pub(in crate::lower) fn collect_capture_values(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: FunctionKey,
    home: Option<ValueId>,
) -> SmallVec<[ValueId; 4]> {
    let captures: CaptureList = SmallVec::from_slice(lowering.file.scopes.captures(key));
    let mut values = SmallVec::with_capacity(captures.len());
    for capture in captures {
        values.push(match capture {
            Capture::Environment(scope) => scope::get_environment(lowering, scope),
            Capture::Value(binding) if is_entry_capture(lowering.file, key, binding) => {
                home.expect("a method that uses super is created with its home object")
            }
            Capture::Value(binding) => get_copied_value(lowering, key, binding),
        });
    }
    let Some(layout) = find_pack_layout(lowering.file, key) else {
        return values;
    };
    let fields: SmallVec<[u32; 4]> = (0..values.len() as u32).collect();
    let pack = lowering.builder.new_object(layout, &fields, None, &values);
    SmallVec::from_slice(&[pack])
}

pub(in crate::lower) fn captures_home_object(
    file: &FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
) -> bool {
    file.scopes
        .captures(key)
        .iter()
        .any(|&capture| match capture {
            Capture::Environment(_) => false,
            Capture::Value(binding) => is_entry_capture(file, key, binding),
        })
}

pub(in crate::lower) fn find_captured_value(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    capture: Capture,
) -> Option<ValueId> {
    let captures = lowering.file.scopes.captures(lowering.key);
    let index = captures.binary_search(&capture).ok()?;
    Some(get_capture(lowering, index))
}

fn is_entry_capture(
    file: &FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    binding: BindingRef,
) -> bool {
    match key {
        FunctionKey::Source(source) => {
            let top_scope = file.bound.fns[source.function.idx()].scope;
            binding == BindingRef::Slot(top_scope, ScopeSlot::HomeObject)
        }
        _ => false,
    }
}

fn is_left_out(file: &FileLowering<'_, '_, '_, '_>, key: FunctionKey) -> bool {
    matches!(key, FunctionKey::Source(source) if file.inputs.library_functions.is_left_out(source))
}

fn get_copied_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: FunctionKey,
    binding: BindingRef,
) -> ValueId {
    let local = lowering.scopes.find_local(binding);
    debug_assert!(
        is_left_out(lowering.file, key)
            || local.is_none_or(|local| local.dead_zone != DeadZone::Uninitialized),
        "a copied binding is initialized before the closure is created"
    );
    let copy = find_captured_value(lowering, Capture::Value(binding));
    let reads_location = local.is_none() && copy.is_none();
    match binding {
        BindingRef::Symbol(symbol) if reads_location => {
            let name = lowering.file.bound.symbol(symbol).name;
            scope::get_binding(lowering, Binding::Symbol(symbol), name)
        }
        BindingRef::Symbol(_) | BindingRef::Slot(..) => scope::get_stored(lowering, binding),
    }
}

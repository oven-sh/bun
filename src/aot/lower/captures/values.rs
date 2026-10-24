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
    let positions = file.list_positions(key);
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

/// At the entry of every function.
pub(crate) fn unpack_captures(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    let Some(layout) = find_pack_layout(lowering.file, lowering.key) else {
        return;
    };
    let pack = lowering.builder.capture(0);
    let fields = 0..lowering.file.scopes.captures(lowering.key).len() as u32;
    let values = fields.map(|field| lowering.builder.get_environment_field(pack, layout, field));
    let values = values.collect();
    lowering.scopes.unpacked_captures = values;
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn get_capture(&self, index: usize) -> ValueId {
        match self.scopes.unpacked_captures.get(index) {
            Some(&value) => value,
            None => self.builder.capture(index as u32),
        }
    }

    pub(crate) fn bind_captures(&mut self) {
        let captures: CaptureList = SmallVec::from_slice(self.file.scopes.captures(self.key));
        let first_copy = captures.iter().find_map(|&capture| match capture {
            Capture::Environment(_) => None,
            Capture::Value(binding) => Some(binding),
        });
        if first_copy.is_some_and(|binding| self.scopes.find_local(binding).is_some()) {
            return;
        }
        for (index, &capture) in captures.iter().enumerate() {
            match capture {
                Capture::Environment(_) => {}
                Capture::Value(binding) => {
                    let position = self.file.stored_position(binding);
                    let declared = (position.ty != TypeTable::ANYTHING).then_some(position.ty);
                    let variable = self.builder.create_variable(declared);
                    let value = self.get_capture(index);
                    self.builder.write_variable(variable, value);
                    let local = LocalBinding {
                        variable,
                        dead_zone: DeadZone::Never,
                    };
                    self.scopes.locals.insert(binding, local);
                }
            }
        }
    }

    pub(in crate::lower) fn collect_capture_values(
        &mut self,
        key: FunctionKey,
        home: Option<ValueId>,
    ) -> SmallVec<[ValueId; 4]> {
        let captures: CaptureList = SmallVec::from_slice(self.file.scopes.captures(key));
        let mut values = SmallVec::with_capacity(captures.len());
        for capture in captures {
            values.push(match capture {
                Capture::Environment(scope) => self.get_environment(scope),
                Capture::Value(binding) if self.file.is_entry_capture(key, binding) => {
                    home.expect("a method that uses super is created with its home object")
                }
                Capture::Value(binding) => self.get_copied_value(key, binding),
            });
        }
        let Some(layout) = find_pack_layout(self.file, key) else {
            return values;
        };
        let fields: SmallVec<[u32; 4]> = (0..values.len() as u32).collect();
        let pack = self.builder.new_object(layout, &fields, None, &values);
        SmallVec::from_slice(&[pack])
    }

    pub(in crate::lower) fn find_captured_value(&self, capture: Capture) -> Option<ValueId> {
        let captures = self.file.scopes.captures(self.key);
        let index = captures.binary_search(&capture).ok()?;
        Some(self.get_capture(index))
    }

    fn get_copied_value(&mut self, key: FunctionKey, binding: BindingRef) -> ValueId {
        let local = self.scopes.find_local(binding);
        debug_assert!(
            is_left_out(self.file, key)
                || local.is_none_or(|local| local.dead_zone != DeadZone::Uninitialized),
            "a copied binding is initialized before the closure is created"
        );
        let copy = self.find_captured_value(Capture::Value(binding));
        let reads_location = local.is_none() && copy.is_none();
        match binding {
            BindingRef::Symbol(symbol) if reads_location => {
                let name = self.file.bound.symbol(symbol).name;
                self.get_binding(Binding::Symbol(symbol), name)
            }
            BindingRef::Symbol(_) | BindingRef::Slot(..) => self.get_stored(binding),
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn capture_positions(&mut self, key: FunctionKey) -> Vec<DeclaredType> {
        match find_pack_layout(self, key) {
            Some(layout) => {
                let pack = self.fragment.types.intern(Type::environment(layout));
                vec![DeclaredType::from_compiler(pack)]
            }
            None => self.list_positions(key),
        }
    }

    fn list_positions(&mut self, key: FunctionKey) -> Vec<DeclaredType> {
        let captures: CaptureList = SmallVec::from_slice(self.scopes.captures(key));
        let is_left_out = is_left_out(self, key);
        let positions = captures.into_iter().map(|capture| match capture {
            Capture::Environment(scope) => {
                let layout = scope::environment_layout(self, scope);
                let environment = self.fragment.types.intern(Type::environment(layout));
                DeclaredType::from_compiler(environment)
            }
            Capture::Value(_) if is_left_out => DeclaredType::untyped(),
            Capture::Value(binding) => self.stored_position(binding),
        });
        positions.collect()
    }

    fn is_entry_capture(&self, key: FunctionKey, binding: BindingRef) -> bool {
        match key {
            FunctionKey::Source(source) => {
                let top_scope = self.bound.fns[source.function.idx()].scope;
                binding == BindingRef::Slot(top_scope, ScopeSlot::HomeObject)
            }
            _ => false,
        }
    }
}

pub(in crate::lower) fn captures_home_object(
    file: &FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
) -> bool {
    let mut captures = file.scopes.captures(key).iter();
    captures.any(|&capture| match capture {
        Capture::Environment(_) => false,
        Capture::Value(binding) => file.is_entry_capture(key, binding),
    })
}

fn is_left_out(file: &FileLowering<'_, '_, '_, '_>, key: FunctionKey) -> bool {
    matches!(key, FunctionKey::Source(source) if file.inputs.library_functions.is_left_out(source))
}

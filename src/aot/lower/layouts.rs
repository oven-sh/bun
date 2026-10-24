mod birth_targets;
mod classes;
mod containers;
mod defined_object_types;
mod dictionaries;
mod object_types;
mod own_fields;
mod reached;
mod type_parameters;

use std::rc::Rc;

use bun_sema::check::aot::ClassRef;
use bun_sema::hir::ExprId;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::{CheckerTypeId, FileLowering};
use crate::ir::generated::{FieldFlags, LimitId};
use crate::ir::{DeclaredType, Id, LayoutId, LayoutKey, PropertyKeyId, TypeId};

pub(in crate::lower) use self::classes::{define_class_layout, private_key};
#[cfg(test)]
pub(crate) use self::defined_object_types::late_answers;
pub use self::defined_object_types::{DefinedObjectType, DefinedObjectTypes, ObjectTypeKey};
use self::defined_object_types::{
    HAS_PLACE, LAST_DEFINITION_LEVEL, NAMES_THE_SAME_IN_EVERY_FILE, NamesOfObjectType,
};
use self::object_types::{ListedFields, SortedMember};
pub(in crate::lower) use self::own_fields::OwnFields;

#[derive(Default)]
pub(crate) struct LayoutState {
    own_fields: Vec<Option<Rc<OwnFields>>>,
    listed_fields: Vec<Option<Rc<ListedFields>>>,
    source_types: Vec<SmallVec<[CheckerTypeId; 1]>>,
    settled_type_counts: Vec<u32>,
    types_of_layouts: FxHashSet<(LayoutId, CheckerTypeId)>,
    holder_in_progress: Option<CheckerTypeId>,
    holders: FxHashMap<CheckerTypeId, CheckerTypeId>,
    // The layouts of types that grow without end: `interface Tree<T> { left?: Tree<[T]> }`.
    growing: FxHashSet<LayoutId>,
    class_types: Vec<(ClassRef, CheckerTypeId)>,
    object_types: FxHashMap<CheckerTypeId, Option<LayoutId>>,
    sorted_members: FxHashMap<CheckerTypeId, Rc<[SortedMember]>>,
    described_names: Vec<(CheckerTypeId, NamesOfObjectType)>,
    dictionaries: FxHashMap<CheckerTypeId, bool>,
    literals: FxHashMap<ExprId, LayoutId>,
    literals_in_progress: SmallVec<[ExprId; 2]>,
    named_types: FxHashSet<(LayoutId, ObjectTypeKey)>,
    conversion_targets: FxHashSet<LayoutId>,
    placed_layouts: FxHashSet<LayoutId>,
}

fn slot_of<T: Default>(slots: &mut Vec<T>, layout: LayoutId) -> &mut T {
    if slots.len() <= layout.index() {
        slots.resize_with(layout.index() + 1, T::default);
    }
    &mut slots[layout.index()]
}

impl LayoutState {
    fn stored_fields(&self, layout: LayoutId) -> Option<Rc<OwnFields>> {
        self.own_fields.get(layout.index())?.clone()
    }

    fn store_fields(&mut self, layout: LayoutId, fields: OwnFields) -> Rc<OwnFields> {
        let fields = Rc::new(fields);
        *slot_of(&mut self.own_fields, layout) = Some(Rc::clone(&fields));
        fields
    }

    fn stored_listed_fields(&self, layout: LayoutId) -> Option<Rc<ListedFields>> {
        self.listed_fields.get(layout.index())?.clone()
    }

    fn source_types(&self, layout: LayoutId) -> &[CheckerTypeId] {
        self.source_types
            .get(layout.index())
            .map_or(&[], |types| &types[..])
    }

    fn take_unsettled_types(&mut self, layout: LayoutId) -> SmallVec<[CheckerTypeId; 1]> {
        let count = self.source_types(layout).len() as u32;
        let settled = core::mem::replace(slot_of(&mut self.settled_type_counts, layout), count);
        SmallVec::from_slice(&self.source_types(layout)[settled as usize..])
    }

    fn is_growing(&self, layout: LayoutId) -> bool {
        self.growing.contains(&layout)
    }

    fn mark_growing(&mut self, layout: LayoutId) {
        if self.growing.insert(layout)
            && let Some(fields) = self.own_fields.get_mut(layout.index())
        {
            *fields = None;
        }
    }

    // A field holds what any type with the layout declares for it, so the fields that were put together without this type no longer stand.
    fn add_source_type(&mut self, layout: LayoutId, ty: CheckerTypeId) -> bool {
        if !self.types_of_layouts.insert((layout, ty)) {
            return false;
        }
        slot_of(&mut self.source_types, layout).push(ty);
        if let Some(fields) = self.own_fields.get_mut(layout.index()) {
            *fields = None;
        }
        true
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn add_conversion(&mut self, layout: LayoutId, target: LayoutId) {
        self.layouts.conversion_targets.insert(target);
        self.fragment.add_supertype(layout, target);
    }

    pub(crate) fn note_view(&mut self, layout: LayoutId) {
        self.layouts.conversion_targets.insert(layout);
    }

    pub(crate) fn class_layout(&mut self, class: ClassRef) -> LayoutId {
        self.fragment.declare_layout(LayoutKey::Class(class))
    }

    pub(crate) fn class_type_layout(&mut self, class: ClassRef, ty: CheckerTypeId) -> LayoutId {
        self.layouts.class_types.push((class, ty));
        self.class_layout(class)
    }

    pub(crate) fn find_field(&mut self, layout: LayoutId, key: PropertyKeyId) -> Option<u32> {
        match self.find_fields_without_types(layout) {
            Some(listed) => listed.find(self, key),
            None => own_fields(self, layout).find(key),
        }
    }

    fn find_fields_without_types(&mut self, layout: LayoutId) -> Option<Rc<ListedFields>> {
        if self.layouts.stored_fields(layout).is_some() {
            return None;
        }
        match self.fragment.layout_key(layout) {
            LayoutKey::ObjectType { .. } => Some(self.list_fields(layout)),
            _ => None,
        }
    }

    pub(crate) fn is_method_field(&mut self, layout: LayoutId, field: u32) -> bool {
        let flags = match self.find_fields_without_types(layout) {
            Some(listed) => listed.flags(field),
            None => own_fields(self, layout).get(field).flags,
        };
        flags.contains(FieldFlags::IS_METHOD)
    }

    pub(crate) fn field_position(&mut self, layout: LayoutId, field: u32) -> DeclaredType {
        match self.find_fields_without_types(layout) {
            Some(listed) => self.listed_field_position(layout, &listed, field),
            None => own_fields(self, layout).get(field).declared,
        }
    }

    pub(crate) fn note_what_is_built(&mut self, ty: TypeId, limit: LimitId) {
        let Some(layouts) = self.collect_reached_layouts(ty, limit) else {
            return;
        };
        for layout in layouts {
            self.fragment.note_allocation(layout);
            let fields = own_fields(self, layout);
            for key in fields.as_slice().iter().filter_map(|field| field.key) {
                self.fragment.note_write(key);
            }
        }
    }

    pub(crate) fn define_remaining_layouts(&mut self) {
        self.record_class_type_arguments_of_file();
        self.define_remaining_class_layouts();
        let mentioned_count = self.fragment.end_layouts_of_code();
        for layout in (0..mentioned_count).map(LayoutId::new) {
            match self.fragment.layout_key(layout) {
                LayoutKey::Container(symbol)
                    if symbol.file == self.file && !self.fragment.is_layout_defined(layout) =>
                {
                    self.define_container_layout(layout, symbol);
                }
                LayoutKey::ObjectType { .. }
                | LayoutKey::Class(_)
                | LayoutKey::ConstructorFunction(_)
                | LayoutKey::Library(_)
                | LayoutKey::UntypedLiteral { .. }
                | LayoutKey::Container(_)
                | LayoutKey::TypeParameter(_)
                | LayoutKey::Environment { .. } => {}
            }
        }
        for level in 0..=LAST_DEFINITION_LEVEL {
            if !self.define_object_types(level) {
                break;
            }
        }
        let described_names = core::mem::take(&mut self.layouts.described_names);
        self.inputs
            .defined_object_types
            .hold_names_of_file(self.file, described_names);
    }

    fn find_layouts_of_objects(&self) -> FxHashSet<LayoutId> {
        let mut found = self.layouts.conversion_targets.clone();
        let layouts = (0..self.fragment.layout_keys().len()).map(LayoutId::new);
        found.extend(layouts.filter(|&layout| self.fragment.is_allocated(layout)));
        loop {
            let count = found.len();
            for &(layout, supertype) in self.fragment.supertype_edges() {
                if found.contains(&layout) {
                    found.insert(supertype);
                }
            }
            if found.len() == count {
                return found;
            }
        }
    }

    fn define_object_types(&mut self, level: u8) -> bool {
        let mut types_of_level = Vec::new();
        for layout in (0..self.fragment.layout_keys().len()).map(LayoutId::new) {
            if !matches!(
                self.fragment.layout_key(layout),
                LayoutKey::ObjectType { .. }
            ) {
                continue;
            }
            let types = self.layouts.take_unsettled_types(layout);
            if !types.is_empty() {
                types_of_level.push((layout, types));
            }
        }
        // Which types a file meets behind its code hangs on what it leaves to earlier files, which differs from one build to the next.
        let layouts_of_objects = match level {
            0 => self.find_layouts_of_objects(),
            _ => FxHashSet::default(),
        };
        for (layout, types) in &types_of_level {
            let says_types = layouts_of_objects.contains(layout);
            self.define_object_type_layout(*layout, types, level, says_types);
        }
        !types_of_level.is_empty()
    }
}

pub(in crate::lower) fn own_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
) -> Rc<OwnFields> {
    if let Some(fields) = file.layouts.stored_fields(layout) {
        return fields;
    }
    let fields = match file.fragment.layout_key(layout) {
        LayoutKey::Class(class) => file.compute_class_fields(layout, class),
        LayoutKey::ConstructorFunction(function) => {
            file.compute_constructor_function_fields(function)
        }
        LayoutKey::ObjectType { .. } => file.compute_object_type_fields(layout),
        LayoutKey::Container(symbol) => file.compute_container_fields(symbol),
        // The checker of this project has not read the text that stores them.
        _ => OwnFields::default(),
    };
    file.layouts.store_fields(layout, fields)
}

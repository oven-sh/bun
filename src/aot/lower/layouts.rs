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

use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{ClassRef, FunctionRef, ListedMember, ObjectMemberKind};
use bun_sema::hir::{ClassId, ExprId};
use bun_sema::program::FileId;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::{CheckerTypeId, FileLowering};
use crate::ir::generated::{FieldFlags, LimitId};
use crate::ir::{DeclaredType, FunctionId, Id, LayoutId, LayoutKey, PropertyKeyId, TypeId};

use self::defined_object_types::{
    HAS_PLACE, LAST_DEFINITION_LEVEL, NAMES_THE_SAME_IN_EVERY_FILE, NamesOfObjectType,
};
#[cfg(test)]
pub(crate) use self::defined_object_types::late_answers;
pub use self::defined_object_types::{DefinedObjectType, DefinedObjectTypes, ObjectTypeKey};
pub(in crate::lower) use self::dictionaries::is_dictionary_type;
use self::object_types::ListedFields;
pub(in crate::lower) use self::own_fields::OwnFields;
pub(in crate::lower) use self::type_parameters::{record_call_type_arguments, type_parameter_layout};

#[derive(Default)]
pub(crate) struct LayoutState {
    own_fields: Vec<Option<Rc<OwnFields>>>,
    listed_fields: Vec<Option<Rc<ListedFields>>>,
    source_types: Vec<SmallVec<[CheckerTypeId; 1]>>,
    // How many of them the file has defined the layout for, or has left to an earlier file.
    settled_type_counts: Vec<u32>,
    types_of_layouts: FxHashSet<(LayoutId, CheckerTypeId)>,
    // The type whose members are being looked at, and for each type the one that was when it was first met.
    holder_in_progress: Option<CheckerTypeId>,
    holders: FxHashMap<CheckerTypeId, CheckerTypeId>,
    // The layouts of types that grow without end: `interface Tree<T> { left?: Tree<[T]> }`. No list of types says what their
    // fields hold.
    growing: FxHashSet<LayoutId>,
    class_types: Vec<(ClassRef, CheckerTypeId)>,
    object_types: FxHashMap<CheckerTypeId, Option<LayoutId>>,
    // The members of an object type that are fields, in the order of their keys.
    sorted_members: FxHashMap<CheckerTypeId, Rc<[(PropertyKeyId, ListedMember)]>>,
    // What the file is the first to have worked out.
    described_names: Vec<(CheckerTypeId, NamesOfObjectType)>,
    dictionaries: FxHashMap<CheckerTypeId, bool>,
    literals: FxHashMap<ExprId, LayoutId>,
    literals_in_progress: SmallVec<[ExprId; 2]>,
    // The definitions of the file that say names alone, by what they say.
    named_types: FxHashSet<(LayoutId, ObjectTypeKey)>,
    // The layouts of the types that the code of the file converts a value to.
    conversion_targets: FxHashSet<LayoutId>,
    // The plain layouts that the file has defined by a type with a place.
    placed_layouts: FxHashSet<LayoutId>,
}

impl LayoutState {
    fn stored_fields(&self, layout: LayoutId) -> Option<Rc<OwnFields>> {
        self.own_fields.get(layout.index())?.clone()
    }

    fn store_fields(&mut self, layout: LayoutId, fields: OwnFields) -> Rc<OwnFields> {
        if self.own_fields.len() <= layout.index() {
            self.own_fields.resize_with(layout.index() + 1, || None);
        }
        let fields = Rc::new(fields);
        self.own_fields[layout.index()] = Some(Rc::clone(&fields));
        fields
    }

    fn stored_listed_fields(&self, layout: LayoutId) -> Option<Rc<ListedFields>> {
        self.listed_fields.get(layout.index())?.clone()
    }

    fn store_listed_fields(&mut self, layout: LayoutId, fields: Rc<ListedFields>) {
        if self.listed_fields.len() <= layout.index() {
            self.listed_fields.resize_with(layout.index() + 1, || None);
        }
        self.listed_fields[layout.index()] = Some(fields);
    }

    // The types of the file that have the layout, in the order they were met.
    fn source_types(&self, layout: LayoutId) -> &[CheckerTypeId] {
        self.source_types.get(layout.index()).map_or(&[], |types| &types[..])
    }

    fn take_unsettled_types(&mut self, layout: LayoutId) -> SmallVec<[CheckerTypeId; 1]> {
        if self.settled_type_counts.len() <= layout.index() {
            self.settled_type_counts.resize(layout.index() + 1, 0);
        }
        let types = self.source_types.get(layout.index()).map_or(&[][..], |types| &types[..]);
        let settled = &mut self.settled_type_counts[layout.index()];
        let unsettled = SmallVec::from_slice(&types[*settled as usize..]);
        *settled = types.len() as u32;
        unsettled
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

    // A field holds what any type with the layout declares for it, so the fields that were put together without this type no
    // longer stand. Says whether the type is new.
    fn add_source_type(&mut self, layout: LayoutId, ty: CheckerTypeId) -> bool {
        if !self.types_of_layouts.insert((layout, ty)) {
            return false;
        }
        if self.source_types.len() <= layout.index() {
            self.source_types.resize(layout.index() + 1, SmallVec::new());
        }
        self.source_types[layout.index()].push(ty);
        if let Some(fields) = self.own_fields.get_mut(layout.index()) {
            *fields = None;
        }
        true
    }
}

// Whatever has the one layout passes for the other from here on, and is seen, and stored into, through its types.
pub(crate) fn add_conversion(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    target: LayoutId,
) {
    file.layouts.conversion_targets.insert(target);
    file.fragment.add_supertype(layout, target);
}

// An object that nobody has followed here, or that the code stores into, is seen through the types of the layout.
pub(crate) fn note_view(file: &mut FileLowering<'_, '_, '_, '_>, layout: LayoutId) {
    file.layouts.conversion_targets.insert(layout);
}

pub(crate) fn class_layout(file: &mut FileLowering<'_, '_, '_, '_>, class: ClassRef) -> LayoutId {
    file.fragment.declare_layout(LayoutKey::Class(class))
}

pub(crate) fn class_type_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
    ty: CheckerTypeId,
) -> LayoutId {
    file.layouts.class_types.push((class, ty));
    class_layout(file, class)
}

pub(crate) fn constructor_function_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> Option<LayoutId> {
    classes::constructor_function_layout(file, function)
}

pub(crate) fn object_type_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<LayoutId> {
    object_types::object_type_layout(file, ty)
}

pub(crate) fn untyped_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    members: &[(PropertyKeyId, ObjectMemberKind)],
) -> LayoutId {
    object_types::untyped_layout(file, members)
}

pub(crate) fn find_field(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    key: PropertyKeyId,
) -> Option<u32> {
    match find_fields_without_types(file, layout) {
        Some(listed) => listed.find(key),
        None => own_fields(file, layout).find(key),
    }
}

fn find_fields_without_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
) -> Option<Rc<ListedFields>> {
    if file.layouts.stored_fields(layout).is_some() {
        return None;
    }
    match file.fragment.layout_key(layout) {
        LayoutKey::ObjectType { .. } => Some(object_types::list_fields(file, layout)),
        LayoutKey::Class(_)
        | LayoutKey::ConstructorFunction(_)
        | LayoutKey::Library(_)
        | LayoutKey::UntypedLiteral { .. }
        | LayoutKey::Container(_)
        | LayoutKey::TypeParameter(_)
        | LayoutKey::Environment { .. } => None,
    }
}

pub(crate) fn is_method_field(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    field: u32,
) -> bool {
    let flags = match find_fields_without_types(file, layout) {
        Some(listed) => listed.flags(field),
        None => own_fields(file, layout).get(field).flags,
    };
    flags.contains(FieldFlags::IS_METHOD)
}

pub(crate) fn field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    field: u32,
) -> DeclaredType {
    match find_fields_without_types(file, layout) {
        Some(listed) => object_types::listed_field_position(file, layout, &listed, field),
        None => own_fields(file, layout).get(field).declared,
    }
}

pub(crate) fn collect_reached_layouts(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: TypeId,
    limit: LimitId,
) -> Option<Vec<LayoutId>> {
    reached::collect_reached_layouts(file, ty, limit)
}

// Whoever builds a value of the type makes objects with every layout that the type leads to, and puts their names into them.
pub(crate) fn note_what_is_built(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: TypeId,
    limit: LimitId,
) {
    let Some(layouts) = collect_reached_layouts(file, ty, limit) else {
        return;
    };
    for layout in layouts {
        file.fragment.note_allocation(layout);
        let fields = own_fields(file, layout);
        for key in fields.as_slice().iter().filter_map(|field| field.key) {
            file.fragment.note_write(key);
        }
    }
}

pub(crate) fn define_remaining_layouts(file: &mut FileLowering<'_, '_, '_, '_>) {
    type_parameters::record_class_type_arguments_of_file(file);
    classes::define_remaining_class_layouts(file);
    let mentioned_count = file.fragment.end_layouts_of_code();
    for layout in (0..mentioned_count).map(LayoutId::new) {
        match file.fragment.layout_key(layout) {
            LayoutKey::Container(symbol)
                if symbol.file == file.file && !file.fragment.is_layout_defined(layout) =>
            {
                containers::define_container_layout(file, layout, symbol);
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
        if !define_object_types(file, level) {
            break;
        }
    }
    let described_names = core::mem::take(&mut file.layouts.described_names);
    file.inputs.defined_object_types.hold_names_of_file(file.file, described_names);
}

// The layouts through whose types the file may see an object that somebody makes: those with which it makes one, those that it
// converts a value to, and what those extend. What a slot holds is what is stored there, and an object is stored into where it is
// made or through a type that it was converted to. Of any other layout a file says the names alone.
fn find_layouts_of_objects(file: &FileLowering<'_, '_, '_, '_>) -> FxHashSet<LayoutId> {
    let mut found = file.layouts.conversion_targets.clone();
    let layouts = (0..file.fragment.layout_keys().len()).map(LayoutId::new);
    found.extend(layouts.filter(|&layout| file.fragment.is_allocated(layout)));
    loop {
        let count = found.len();
        for &(layout, supertype) in file.fragment.supertype_edges() {
            if found.contains(&layout) {
                found.insert(supertype);
            }
        }
        if found.len() == count {
            return found;
        }
    }
}

// The types that the file has met and not settled are of this level, whichever layout they have. What their fields name and the
// file has not met before is of the next level, so the list is closed before the first of them is defined.
fn define_object_types(file: &mut FileLowering<'_, '_, '_, '_>, level: u8) -> bool {
    let mut types_of_level = Vec::new();
    for layout in (0..file.fragment.layout_keys().len()).map(LayoutId::new) {
        if !matches!(file.fragment.layout_key(layout), LayoutKey::ObjectType { .. }) {
            continue;
        }
        let types = file.layouts.take_unsettled_types(layout);
        if !types.is_empty() {
            types_of_level.push((layout, types));
        }
    }
    // Which types a file meets behind its code hangs on what it leaves to earlier files, which differs from one build to the next.
    // What is said of such a type must not hang on the file that says it, so it is the names.
    let layouts_of_objects = match level {
        0 => find_layouts_of_objects(file),
        _ => FxHashSet::default(),
    };
    for (layout, types) in &types_of_level {
        let says_types = layouts_of_objects.contains(layout);
        object_types::define_object_type_layout(file, *layout, types, level, says_types);
    }
    !types_of_level.is_empty()
}

pub(in crate::lower) fn own_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
) -> Rc<OwnFields> {
    if let Some(fields) = file.layouts.stored_fields(layout) {
        return fields;
    }
    let fields = match file.fragment.layout_key(layout) {
        LayoutKey::Class(class) => classes::compute_class_fields(file, layout, class),
        LayoutKey::ConstructorFunction(function) => {
            classes::compute_constructor_function_fields(file, function)
        }
        LayoutKey::ObjectType { .. } => object_types::compute_object_type_fields(file, layout),
        LayoutKey::Container(symbol) => containers::compute_container_fields(file, symbol),
        // The checker of this project has not read the text that stores them.
        LayoutKey::Library(_)
        | LayoutKey::UntypedLiteral { .. }
        | LayoutKey::TypeParameter(_)
        | LayoutKey::Environment { .. } => OwnFields::default(),
    };
    file.layouts.store_fields(layout, fields)
}

pub(in crate::lower) fn define_class_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    constructor: FunctionId,
) -> LayoutId {
    classes::define_class_layout(file, class, Some(constructor))
}

pub(in crate::lower) fn private_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: LayoutId,
    name: Atom,
) -> PropertyKeyId {
    classes::private_key(file, owner, name)
}

pub(in crate::lower) fn literal_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> LayoutId {
    object_types::literal_layout(file, literal)
}

pub(crate) fn module_exports_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    module: FileId,
) -> Option<LayoutId> {
    containers::module_exports_layout(file, module)
}

pub(crate) fn begins_with_exports_object(
    file: &FileLowering<'_, '_, '_, '_>,
    module: FileId,
) -> bool {
    containers::begins_with_exports_object(file, module)
}

pub(crate) fn module_type_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<LayoutId> {
    containers::module_type_layout(file, ty)
}

pub(in crate::lower) fn container_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    container: SymbolId,
) -> LayoutId {
    containers::container_layout(file, container)
}

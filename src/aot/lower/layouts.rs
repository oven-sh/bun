mod birth_targets;
mod classes;
mod containers;
mod dictionaries;
mod object_types;
mod own_fields;
mod reached;

use std::rc::Rc;
use std::sync::Arc;

use bun_sema::check::aot::ClassRef;
use bun_sema::hir::ExprId;
use bun_sema::program::FileId;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::tables::Places;
use super::{CheckerTypeId, FileLowering};
use crate::ir::generated::LimitId;
use crate::ir::{DeclaredType, Id, LayoutId, LayoutKey, PropertyKeyId, TypeId};

pub(in crate::lower) use self::classes::{class_position, define_class_layout, private_key};
pub use self::containers::NamesCreatedOnExports;
pub(in crate::lower) use self::object_types::KnownOrders;
pub use self::object_types::ObjectTypeKey;
use self::object_types::{DescribedNames, ListedFields, SortedMember};
pub(in crate::lower) use self::own_fields::OwnFields;

#[derive(Default)]
pub(crate) struct LayoutState {
    places: Places,
    own_fields: Vec<Option<Rc<OwnFields>>>,
    listed_fields: Vec<Option<Rc<ListedFields>>>,
    source_types: Vec<SmallVec<[CheckerTypeId; 1]>>,
    types_of_layouts: FxHashSet<(LayoutId, CheckerTypeId)>,
    holder_in_progress: Option<CheckerTypeId>,
    holders: FxHashMap<CheckerTypeId, CheckerTypeId>,
    growing: FxHashSet<LayoutId>,
    object_types: FxHashMap<CheckerTypeId, Option<LayoutId>>,
    sorted_members: FxHashMap<CheckerTypeId, Arc<[SortedMember]>>,
    described_names: DescribedNames,
    dictionaries: FxHashMap<CheckerTypeId, bool>,
    literals: FxHashMap<ExprId, LayoutId>,
    written_types_of_literals: FxHashMap<ExprId, (LayoutId, CheckerTypeId)>,
    literals_in_progress: SmallVec<[ExprId; 2]>,
    literals_opened_at_once: FxHashSet<ExprId>,
    variables_that_leave_whole: Option<Rc<FxHashSet<bun_sema::bind::SymbolId>>>,
    class_types: Vec<(ClassRef, CheckerTypeId)>,
    layouts_seen_as_objects: FxHashSet<LayoutId>,
    named_types: FxHashMap<(LayoutId, ObjectTypeKey), (u32, Option<(FileId, u32)>)>,
}

fn slot_of<T: Default>(slots: &mut Vec<T>, place: usize) -> &mut T {
    if slots.len() <= place {
        slots.reserve(place + 1 - slots.len());
        while slots.len() <= place {
            slots.push(T::default());
        }
    }
    &mut slots[place]
}

impl LayoutState {
    pub(in crate::lower) fn new(places: Places) -> LayoutState {
        LayoutState {
            places,
            ..LayoutState::default()
        }
    }

    pub(in crate::lower) fn into_places(self) -> Places {
        self.places
    }

    fn stored_fields(&self, layout: LayoutId) -> Option<Rc<OwnFields>> {
        let place = self.places.find(layout.index())?;
        self.own_fields.get(place)?.clone()
    }

    fn has_stored_fields(&self, layout: LayoutId) -> bool {
        let place = self.places.find(layout.index());
        place.is_some_and(|place| matches!(self.own_fields.get(place), Some(Some(_))))
    }

    fn store_fields(&mut self, layout: LayoutId, fields: OwnFields) -> Rc<OwnFields> {
        let fields = Rc::new(fields);
        let place = self.places.place(layout.index());
        *slot_of(&mut self.own_fields, place) = Some(Rc::clone(&fields));
        fields
    }

    fn forget_fields(&mut self, layout: LayoutId) {
        if let Some(place) = self.places.find(layout.index())
            && let Some(fields) = self.own_fields.get_mut(place)
        {
            *fields = None;
        }
    }

    fn stored_listed_fields(&self, layout: LayoutId) -> Option<Rc<ListedFields>> {
        let place = self.places.find(layout.index())?;
        self.listed_fields.get(place)?.clone()
    }

    fn source_types(&self, layout: LayoutId) -> &[CheckerTypeId] {
        self.places
            .find(layout.index())
            .and_then(|place| self.source_types.get(place))
            .map_or(&[], |types| &**types)
    }

    fn is_growing(&self, layout: LayoutId) -> bool {
        self.growing.contains(&layout)
    }

    fn mark_growing(&mut self, layout: LayoutId) {
        if self.growing.insert(layout) {
            self.forget_fields(layout);
        }
    }

    fn add_source_type(&mut self, layout: LayoutId, ty: CheckerTypeId) -> bool {
        if !self.types_of_layouts.insert((layout, ty)) {
            return false;
        }
        let place = self.places.place(layout.index());
        slot_of(&mut self.source_types, place).push(ty);
        self.forget_fields(layout);
        true
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn add_conversion(&mut self, source: LayoutId, target: LayoutId) {
        self.layouts.layouts_seen_as_objects.insert(target);
        self.fragment.add_supertype(source, target);
    }

    pub(in crate::lower) fn note_layout_of_objects(&mut self, layout: LayoutId) {
        self.layouts.layouts_seen_as_objects.insert(layout);
    }

    pub(in crate::lower) fn note_layouts_of_objects(&mut self, ty: TypeId) {
        let named = self.fragment.types.get(ty).layouts;
        self.layouts.layouts_seen_as_objects.extend(named);
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
        if self.layouts.has_stored_fields(layout) {
            return None;
        }
        match self.fragment.layout_key(layout) {
            LayoutKey::ObjectType { .. } => Some(self.list_fields(layout)),
            _ => None,
        }
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
            if let Some(listed) = self.list_fields_without_unions(layout) {
                for &key in listed.keys().iter() {
                    self.fragment.note_write(key);
                }
                continue;
            }
            let fields = own_fields(self, layout);
            for key in fields.as_slice().iter().filter_map(|field| field.key) {
                self.fragment.note_write(key);
            }
        }
    }

    pub(crate) fn define_remaining_layouts(&mut self) {
        self.record_type_arguments_of_class_types();
        self.define_remaining_class_layouts();
        let mentioned_count = self.fragment.end_layouts_of_code();
        for index in 0..mentioned_count {
            let layout = self.fragment.layouts_named_in_file()[index];
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
                | LayoutKey::CreatedObject { .. }
                | LayoutKey::Container(_)
                | LayoutKey::Environment { .. } => {}
            }
        }
        self.define_object_types();
    }

    fn find_layouts_of_objects(&self) -> FxHashSet<LayoutId> {
        let mut found = self.layouts.layouts_seen_as_objects.clone();
        found.extend(self.fragment.allocated_layouts());
        let types = &self.fragment.types;
        for &(_, target) in &self.fragment.family_facts.conversions {
            found.extend(types.get(target).layouts);
        }
        if self.fragment.supertype_edges().is_empty() {
            return found;
        }
        let mut edges = self.fragment.supertype_edges().to_vec();
        edges.sort_unstable();
        let mut pending: Vec<LayoutId> = found.iter().copied().collect();
        while let Some(layout) = pending.pop() {
            let first = edges.partition_point(|edge| edge.0 < layout);
            let above = edges[first..].iter();
            for &(_, supertype) in above.take_while(|edge| edge.0 == layout) {
                if found.insert(supertype) {
                    pending.push(supertype);
                }
            }
        }
        found
    }

    fn define_object_types(&mut self) {
        let mut types = Vec::new();
        let mut types_of_layouts = Vec::new();
        for &layout in self.fragment.layouts_named_in_file() {
            if !matches!(
                self.fragment.layout_key(layout),
                LayoutKey::ObjectType { .. }
            ) {
                continue;
            }
            let start = types.len();
            types.extend_from_slice(self.layouts.source_types(layout));
            if start < types.len() {
                types_of_layouts.push((layout, start..types.len()));
            }
        }
        if types_of_layouts.is_empty() {
            return;
        }
        let layouts_of_objects = self.find_layouts_of_objects();
        for (layout, range) in types_of_layouts {
            let has_home = self.fragment.layout_key(layout).home_file().is_some();
            if has_home || layouts_of_objects.contains(&layout) {
                self.define_object_type_layout(layout, &types[range]);
                continue;
            }
            for &ty in &types[range] {
                self.define_names_of_type(layout, ty);
            }
        }
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
        _ => OwnFields::default(),
    };
    file.layouts.store_fields(layout, fields)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAYOUT: LayoutId = LayoutId::from_word(5);
    const OTHER_LAYOUT: LayoutId = LayoutId::from_word(2);
    const TYPE: CheckerTypeId = CheckerTypeId(3);
    const OTHER_TYPE: CheckerTypeId = CheckerTypeId(4);

    fn state_of_next_file(mut places: Places) -> LayoutState {
        places.begin_file();
        LayoutState::new(places)
    }

    #[test]
    fn next_file_sees_nothing_an_earlier_file_stored() {
        let mut earlier = state_of_next_file(Places::default());
        assert!(earlier.add_source_type(LAYOUT, TYPE));
        earlier.store_fields(LAYOUT, OwnFields::default());
        earlier.mark_growing(OTHER_LAYOUT);

        let mut later = state_of_next_file(earlier.into_places());
        assert!(later.stored_fields(LAYOUT).is_none());
        assert!(later.stored_listed_fields(LAYOUT).is_none());
        assert!(later.source_types(LAYOUT).is_empty());
        assert!(!later.is_growing(OTHER_LAYOUT));
        assert!(later.add_source_type(LAYOUT, TYPE));
        assert_eq!(later.source_types(LAYOUT), [TYPE]);
    }

    #[test]
    fn lookups_assign_no_place() {
        let mut state = state_of_next_file(Places::default());
        assert!(state.stored_fields(LAYOUT).is_none());
        assert!(state.stored_listed_fields(LAYOUT).is_none());
        assert!(state.source_types(LAYOUT).is_empty());
        state.mark_growing(LAYOUT);
        assert_eq!(state.into_places().find(LAYOUT.index()), None);
    }

    #[test]
    fn new_source_type_or_growth_discards_stored_fields() {
        let mut state = state_of_next_file(Places::default());
        assert!(state.add_source_type(LAYOUT, TYPE));
        state.store_fields(LAYOUT, OwnFields::default());
        assert!(!state.add_source_type(LAYOUT, TYPE));
        assert!(state.stored_fields(LAYOUT).is_some());
        assert!(state.add_source_type(LAYOUT, OTHER_TYPE));
        assert!(state.stored_fields(LAYOUT).is_none());
        assert_eq!(state.source_types(LAYOUT), [TYPE, OTHER_TYPE]);

        state.store_fields(LAYOUT, OwnFields::default());
        state.mark_growing(LAYOUT);
        assert!(state.stored_fields(LAYOUT).is_none());
    }
}

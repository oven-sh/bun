use bun_sort_by_number::SortByNumber;
use core::cell::{Cell, RefCell};
use core::cmp::Ordering;
use std::rc::Rc;
use std::sync::Arc;

use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::check::aot::{
    ListedMember, MemberLookup, MemberName, ObjectMemberKind, ObjectOrigin, ShapeKind, TypeIdentity,
};
use bun_sema::hir::{ExprId, ExprKind, PropKey, PropKind};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

use super::OwnFields;
use crate::builtins::id::BuiltinId;
use crate::builtins::resolve::SourceDialect;
use crate::builtins::table;
use crate::ir::generated::{
    Field, FieldFlags, Layout, LayoutKind, LimitId, NameClass, PositionFlags,
};
use crate::ir::{
    DeclaredType, Id, LayoutId, LayoutKey, PropertyKeyId, PropertyKeyKind, WellKnownSymbol,
    classify_name,
};
use crate::lower::{CheckerTypeId, FileLowering, SourceKind};
use crate::modules::ModuleRef;

const _: () = assert!(PropertyKeyKind::COUNT <= 1 << u8::BITS);
const _: () = assert!(WellKnownSymbol::COUNT <= 1 << u8::BITS);

type Member = (PropertyKeyId, ObjectMemberKind);
type Members = SmallVec<[Member; 8]>;
type KeyDescription = SmallVec<[u8; 24]>;
pub(super) type SortedMember = (FieldName, ListedMember);

// What a file says of the fields of a type is the same in every file that is checked, and the same in every file that is not.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ObjectTypeKey {
    Type {
        origin: ObjectOrigin,
        identity: TypeIdentity,
        is_checked: bool,
    },
    /// What `define_names_of_type` says.
    Names {
        flags: TypeIdentity,
        has_place: bool,
    },
}

struct FieldsOfType {
    fields: Vec<Field>,
    declared_order: Vec<u32>,
    /// The checker tells every file of the task the same about the members.
    is_kept: bool,
}

/// The names of a type in their order, where each of them is a text: no table of a file is asked for such an order, so it is the same in every file of the task.
/// By the type, with the address of the list of members that was put in order: the checker keeps its lists as long as the task lasts, and another answer is another list.
#[derive(Default)]
pub(in crate::lower) struct KnownOrders(FxHashMap<CheckerTypeId, (usize, Arc<[SortedMember]>)>);

impl KnownOrders {
    fn find(&self, ty: CheckerTypeId, members: &[ListedMember]) -> Option<Arc<[SortedMember]>> {
        let (address, sorted) = self.0.get(&ty)?;
        (*address == members.as_ptr() as usize).then(|| Arc::clone(sorted))
    }

    fn keep(&mut self, ty: CheckerTypeId, members: &[ListedMember], sorted: &Arc<[SortedMember]>) {
        let address = members.as_ptr() as usize;
        self.0.insert(ty, (address, Arc::clone(sorted)));
    }
}

// A file names few of the names of the types it meets, so a name goes into the file's tables where a definition says it.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum FieldName {
    Text(Atom),
    Key(PropertyKeyId),
}

struct ListedField {
    name: FieldName,
    flags: Cell<FieldFlags>,
    members: RefCell<SmallVec<[(CheckerTypeId, ListedMember); 1]>>,
    // What the first of these members declare, and how many they are.
    declared: Cell<(Option<DeclaredType>, usize)>,
}

#[derive(Default)]
pub(super) struct ListedFields {
    fields: Vec<ListedField>,
    is_known: bool,
}

impl ListedFields {
    pub(super) fn find(
        &self,
        file: &FileLowering<'_, '_, '_, '_>,
        key: PropertyKeyId,
    ) -> Option<u32> {
        let found = match file.describe_key(key) {
            Some(description) => self
                .fields
                .binary_search_by(|field| file.compare_name(field.name, &description))
                .ok(),
            None => self
                .fields
                .iter()
                .position(|field| field.name == FieldName::Key(key)),
        };
        found.map(|found| found as u32)
    }

    fn add_type(&self, ty: CheckerTypeId, members: &[SortedMember]) {
        debug_assert_eq!(
            self.fields.len(),
            members.len(),
            "types with one layout have the same names"
        );
        for (field, &(name, member)) in self.fields.iter().zip(members) {
            debug_assert_eq!(
                field.name, name,
                "types with one layout have the same names"
            );
            if member.is_optional {
                field
                    .flags
                    .set(field.flags.get().without(FieldFlags::IS_REQUIRED));
            }
            field.members.borrow_mut().push((ty, member));
        }
    }
}

struct UntypedMember {
    description: KeyDescription,
    key: PropertyKeyId,
    kind: ObjectMemberKind,
    source_index: usize,
}

fn is_field_name(class: NameClass) -> bool {
    !matches!(
        class,
        NameClass::Index | NameClass::CanonicalNumericString | NameClass::Proto
    )
}

fn listed_member_flags(member: ListedMember) -> FieldFlags {
    member_flags(member.kind, member.is_optional)
}

fn member_flags(kind: ObjectMemberKind, is_optional: bool) -> FieldFlags {
    let mut flags = FieldFlags::default();
    if !is_optional {
        flags |= FieldFlags::IS_REQUIRED;
    }
    if kind == ObjectMemberKind::Method {
        flags |= FieldFlags::IS_METHOD;
    }
    flags
}

pub(super) fn can_be_field(file: &FileLowering<'_, '_, '_, '_>, key: PropertyKeyId) -> bool {
    let key = file.fragment.property_keys.get(key);
    match key.kind {
        PropertyKeyKind::Text => {
            debug_assert!(key.text.is_some(), "text key without text");
            let strings = &file.fragment.strings;
            key.text
                .is_some_and(|text| is_field_name(strings.name_class(text)))
        }
        _ => true,
    }
}

fn describe_flags(flags: impl Iterator<Item = FieldFlags>) -> TypeIdentity {
    let flags: Vec<[u8; 4]> = flags.map(|flags| flags.0.to_le_bytes()).collect();
    TypeIdentity::of_untyped_members(
        flags
            .iter()
            .map(|flags| (flags.as_slice(), ObjectMemberKind::Field)),
    )
}

impl FileLowering<'_, '_, '_, '_> {
    fn describe_names(
        &mut self,
        ty: CheckerTypeId,
        members: &[ListedMember],
    ) -> (TypeIdentity, bool) {
        let fields = self.sort_listed_fields(ty, members);
        let descriptions: Vec<(KeyDescription, ObjectMemberKind)> = fields
            .iter()
            .filter_map(|&(name, member)| Some((self.describe_name(name)?, member.kind)))
            .collect();
        let has_other_optional_members =
            self.queries.has_other_optional_members_than_mapped_type(ty);
        let bytes_of_flags: Vec<u8> = match has_other_optional_members {
            true => {
                let flags = fields.iter().map(|field| listed_member_flags(field.1));
                let TypeIdentity(parts) = describe_flags(flags);
                parts.into_iter().flat_map(u64::to_le_bytes).collect()
            }
            false => Vec::new(),
        };
        let names = descriptions
            .iter()
            .map(|(name, kind)| (name.as_slice(), *kind))
            .chain(
                has_other_optional_members
                    .then_some((bytes_of_flags.as_slice(), ObjectMemberKind::Field)),
            );
        (
            TypeIdentity::of_untyped_members(names),
            descriptions.is_empty(),
        )
    }

    // Every member of such a type is a type that nothing has made yet, with the same layout, and looking at its members makes the next ones.
    fn grows_without_end(&mut self, ty: CheckerTypeId) -> bool {
        let holder = match self.layouts.holder_in_progress {
            Some(holder) if holder != ty => holder,
            Some(_) | None => return false,
        };
        self.layouts.holders.insert(ty, holder);
        let mut path = vec![ty];
        while let Some(&holder) = self.layouts.holders.get(&path[path.len() - 1]) {
            debug_assert!(
                path.len() <= self.layouts.holders.len(),
                "a type is held by one that the file met before it"
            );
            path.push(holder);
        }
        path.reverse();
        self.queries.grows_along(&path)
    }

    pub(crate) fn object_type_layout(&mut self, ty: CheckerTypeId) -> Option<LayoutId> {
        if let Some(&layout) = self.layouts.object_types.get(&ty) {
            return layout;
        }
        let layout = self.find_object_type_layout(ty);
        self.layouts.object_types.insert(ty, layout);
        layout
    }

    fn find_key(&mut self, name: FieldName) -> PropertyKeyId {
        match name {
            FieldName::Text(text) => self.atom_key(text),
            FieldName::Key(key) => key,
        }
    }

    // In the one order that every type with these names gives: field `i` of one is field `i` of the other.
    fn sort_listed_fields(
        &mut self,
        ty: CheckerTypeId,
        members: &[ListedMember],
    ) -> Arc<[SortedMember]> {
        if let Some(sorted) = self.layouts.sorted_members.get(&ty) {
            return Arc::clone(sorted);
        }
        let mut names = members.iter().map(|member| member.name);
        let is_alike_in_every_file = matches!(self.source.dialect(), SourceDialect::Program)
            && !names.any(|name| matches!(name, MemberName::Symbol(_)));
        if is_alike_in_every_file && let Some(sorted) = self.task.orders.find(ty, members) {
            let memo = &mut self.layouts.sorted_members;
            memo.insert(ty, Arc::clone(&sorted));
            return sorted;
        }
        let mut fields: Vec<SortedMember> = Vec::with_capacity(members.len());
        let mut names = FxHashSet::with_capacity_and_hasher(members.len(), Default::default());
        for &listed_member in members {
            let name = match (listed_member.name, self.source.dialect()) {
                (MemberName::String(name), SourceDialect::Program) => FieldName::Text(name),
                (MemberName::String(name), SourceDialect::Runtime) => {
                    FieldName::Key(self.name_key(name))
                }
                (MemberName::Symbol(name), _) => match self.created_symbol_key(name) {
                    Some(key) => FieldName::Key(key),
                    None => continue,
                },
                (MemberName::Private(_), _) => continue,
            };
            let can_be_field = match name {
                FieldName::Text(text) => {
                    is_field_name(classify_name(self.queries.atom_bytes(text)))
                }
                FieldName::Key(key) => can_be_field(self, key),
            };
            if can_be_field && names.insert(name) {
                fields.push((name, listed_member));
            }
        }
        fields.sort_by_cached_key(|field| self.describe_name(field.0));
        fields.truncate(self.inputs.limits.get(LimitId::FieldsInKeyOrder) as usize);
        let sorted: Arc<[SortedMember]> = fields.into();
        if is_alike_in_every_file {
            self.task.orders.keep(ty, members, &sorted);
        }
        self.layouts.sorted_members.insert(ty, Arc::clone(&sorted));
        sorted
    }

    fn compute_listed_fields(&mut self, layout: LayoutId) -> ListedFields {
        let types: SmallVec<[CheckerTypeId; 4]> =
            SmallVec::from_slice(self.layouts.source_types(layout));
        debug_assert!(
            !types.is_empty(),
            "object type layout without a source type"
        );
        let mut listed = ListedFields::default();
        for (index, &ty) in types.iter().enumerate() {
            let Ok(members) = self.queries.listed_members(ty) else {
                return ListedFields::default();
            };
            let fields_of_type = self.sort_listed_fields(ty, members);
            if index > 0 {
                listed.add_type(ty, &fields_of_type);
                continue;
            }
            let fields = fields_of_type.iter().map(|&(name, member)| ListedField {
                name,
                flags: Cell::new(listed_member_flags(member)),
                members: RefCell::new(smallvec![(ty, member)]),
                declared: Cell::new((None, 0)),
            });
            listed.fields = fields.collect();
            listed.is_known = true;
        }
        listed
    }

    pub(crate) fn lists_some_field(&mut self, layout: LayoutId) -> bool {
        !self.list_fields(layout).fields.is_empty()
    }

    pub(super) fn list_fields(&mut self, layout: LayoutId) -> Rc<ListedFields> {
        if let Some(listed) = self.layouts.stored_listed_fields(layout) {
            return listed;
        }
        let listed = Rc::new(self.compute_listed_fields(layout));
        let place = self.layouts.places.place(layout.index());
        let stored = &mut self.layouts.listed_fields;
        if stored.len() <= place {
            stored.resize_with(place + 1, Default::default);
        }
        stored[place] = Some(Rc::clone(&listed));
        listed
    }

    // The type of an expression: it says which names the object has, and nobody has declared what they hold.
    fn is_type_of_literal(&mut self, ty: CheckerTypeId) -> bool {
        matches!(
            self.queries.object_origin(ty),
            ObjectOrigin::ObjectLiteral { .. }
        )
    }

    // The checker's type of `a?: number` is `number`.
    pub(super) fn listed_field_position(
        &mut self,
        layout: LayoutId,
        listed: &ListedFields,
        field: u32,
    ) -> DeclaredType {
        let field = &listed.fields[field as usize];
        let (mut united, number_united) = field.declared.get();
        let members: SmallVec<[(CheckerTypeId, ListedMember); 4]> =
            SmallVec::from_slice(&field.members.borrow()[number_united..]);
        for &(ty, member) in &members {
            // Looking at the members is what finds out.
            if self.layouts.is_growing(layout) {
                return DeclaredType::untyped();
            }
            if self.is_type_of_literal(ty) {
                continue;
            }
            let outer = self.layouts.holder_in_progress.replace(ty);
            let types = self.queries.listed_member_types(ty, member);
            let mut declared = self.create_member_position(types);
            self.layouts.holder_in_progress = outer;
            if member.is_optional {
                declared = self.add_undefined(declared);
            }
            united = Some(match united {
                Some(united) => self.unite_positions(united, declared),
                None => declared,
            });
        }
        if self.layouts.is_growing(layout) {
            return DeclaredType::untyped();
        }
        field.declared.set((united, number_united + members.len()));
        united.unwrap_or_else(DeclaredType::untyped)
    }

    pub(super) fn compute_object_type_fields(&mut self, layout: LayoutId) -> OwnFields {
        let listed = self.list_fields(layout);
        if !listed.is_known {
            return OwnFields::default();
        }
        // The type of a field may be the first mention of another type with this very layout (`interface Even { other: Odd }`), which then adds to the fields that have been looked at.
        loop {
            let number_of_types = self.layouts.source_types(layout).len();
            for index in 0..listed.fields.len() as u32 {
                self.listed_field_position(layout, &listed, index);
            }
            if self.layouts.source_types(layout).len() == number_of_types {
                break;
            }
        }
        let is_growing = self.layouts.is_growing(layout);
        let mut fields = OwnFields::default();
        for field in &listed.fields {
            let declared = field.declared.get().0.filter(|_| !is_growing);
            fields.add(Field {
                key: Some(self.find_key(field.name)),
                declared: declared.unwrap_or_else(DeclaredType::untyped),
                flags: field.flags.get(),
                ..Field::default()
            });
        }
        fields.finish()
    }

    fn find_object_type_key(&mut self, ty: CheckerTypeId) -> Option<ObjectTypeKey> {
        // The identity of a computed type leaves out what nobody has written: the type of a method of a literal, of a rest copy.
        let origin = match self.queries.object_origin(ty) {
            ObjectOrigin::Computed => return None,
            origin @ (ObjectOrigin::Symbol(_)
            | ObjectOrigin::TypeLiteral { .. }
            | ObjectOrigin::MappedType { .. }
            | ObjectOrigin::ObjectLiteral { .. }) => origin,
        };
        Some(ObjectTypeKey::Type {
            origin,
            identity: self.queries.type_identity(ty).ok()?,
            is_checked: self.is_checked(),
        })
    }

    fn compute_fields_of_type(&mut self, ty: CheckerTypeId) -> Option<FieldsOfType> {
        let members = self.queries.listed_members(ty).ok()?;
        let listed = self.sort_listed_fields(ty, members);
        let mut fields = Vec::with_capacity(listed.len());
        let mut is_kept = true;
        let outer = self.layouts.holder_in_progress.replace(ty);
        for &(name, member) in listed.iter() {
            let types = self.queries.listed_member_types(ty, member);
            is_kept &= self.queries.keeps_listed_member_types(ty, member);
            let declared = self.create_member_position(types);
            let declared = match member.is_optional {
                true => self.add_undefined(declared),
                false => declared,
            };
            fields.push(Field {
                key: Some(self.find_key(name)),
                declared,
                flags: listed_member_flags(member),
                ..Field::default()
            });
        }
        self.layouts.holder_in_progress = outer;
        Some(FieldsOfType {
            fields,
            declared_order: find_declared_order(&listed),
            is_kept,
        })
    }

    pub(super) fn has_module(&self, home: FileId) -> bool {
        self.queries.files().is_compiled(home) && !self.inputs.is_left_out(home)
    }

    /// Which names the type has, which of them it requires and which are methods. What they hold is left to the files that say it.
    pub(super) fn define_names_of_type(&mut self, layout: LayoutId, ty: CheckerTypeId) {
        let Ok(members) = self.queries.listed_members(ty) else {
            return;
        };
        let listed = self.sort_listed_fields(ty, members);
        let place = self.find_place(ty);
        let key = ObjectTypeKey::Names {
            flags: describe_flags(listed.iter().map(|field| listed_member_flags(field.1))),
            has_place: place.is_some(),
        };
        // Which of two types the file has met first hangs on what its thread has lowered before, so the one that is declared first speaks for both.
        let said = self.layouts.named_types.get(&(layout, key)).copied();
        if said.is_some_and(|(_, place_of_speaker)| place_of_speaker <= place) {
            return;
        }
        let mut fields = Vec::with_capacity(listed.len());
        for &(name, member) in listed.iter() {
            fields.push(Field {
                key: Some(self.find_key(name)),
                declared: DeclaredType::unsaid(),
                flags: listed_member_flags(member),
                ..Field::default()
            });
        }
        let definition = self.create_definition(place, fields, find_declared_order(&listed));
        let index = match said {
            Some((index, _)) => {
                self.fragment.define_object_type_anew(index, definition);
                index
            }
            None => (self.fragment).define_object_type(layout, definition, Some(key)),
        };
        self.layouts.named_types.insert((layout, key), (index, place));
    }

    pub(super) fn define_object_type_layout(&mut self, layout: LayoutId, types: &[CheckerTypeId]) {
        // A layout with a home has one type, and the link takes what the home says.
        let has_home = self.fragment.layout_key(layout).home_file().is_some();
        for &ty in types {
            if !has_home && self.is_type_of_literal(ty) {
                self.define_names_of_type(layout, ty);
                continue;
            }
            // The link takes what the first file says of a type and drops what every later file says of it.
            if !has_home && self.is_said_by_an_earlier_file(ty) {
                continue;
            }
            let unstable_answers = self.queries.count_unstable_answers();
            let key = match has_home {
                true => None,
                false => self.find_object_type_key(ty),
            };
            let Some(found) = self.compute_fields_of_type(ty) else {
                continue;
            };
            let place = self.find_place(ty);
            let definition = self.create_definition(place, found.fields, found.declared_order);
            if key.is_some()
                && found.is_kept
                && self.queries.count_unstable_answers() == unstable_answers
            {
                self.note_that_the_file_has_said(ty);
            }
            self.define_type(layout, definition, key);
        }
    }

    fn find_place(&mut self, ty: CheckerTypeId) -> Option<(FileId, u32)> {
        let declaration = self.find_declaration(ty);
        declaration.filter(|&(home, _)| self.has_module(home))
    }

    fn create_definition(
        &mut self,
        place: Option<(FileId, u32)>,
        fields: Vec<Field>,
        declared_order: Vec<u32>,
    ) -> Layout {
        let (module, position) = match place {
            Some((home, position)) => {
                let module = self.fragment.declare_module(ModuleRef::File(home));
                (Some(module), position)
            }
            None => (None, 0),
        };
        Layout {
            kind: LayoutKind::Record,
            module,
            position,
            fields,
            declared_order,
            ..Layout::default()
        }
    }

    fn define_type(
        &mut self,
        layout: LayoutId,
        mut definition: Layout,
        key: Option<ObjectTypeKey>,
    ) {
        // Whether the file had found out by now hangs on what else it has looked at.
        if self.layouts.is_growing(layout) {
            for field in &mut definition.fields {
                field.declared = DeclaredType::untyped();
            }
        }
        self.fragment.define_object_type(layout, definition, key);
    }

    fn describe_name(&self, name: FieldName) -> Option<KeyDescription> {
        match name {
            FieldName::Text(text) => {
                let mut description = KeyDescription::new();
                description.push(PropertyKeyKind::Text.to_wire() as u8);
                description.extend_from_slice(self.queries.atom_bytes(text));
                Some(description)
            }
            FieldName::Key(key) => self.describe_key(key),
        }
    }

    fn compare_name(&self, name: FieldName, description: &[u8]) -> Ordering {
        match name {
            FieldName::Text(text) => {
                let kind = [PropertyKeyKind::Text.to_wire() as u8];
                kind.iter()
                    .chain(self.queries.atom_bytes(text))
                    .cmp(description)
            }
            FieldName::Key(key) => match self.describe_key(key) {
                Some(described) => described.as_slice().cmp(description),
                None => Ordering::Less,
            },
        }
    }

    fn describe_key(&self, key: PropertyKeyId) -> Option<KeyDescription> {
        let key = self.fragment.property_keys.get(key);
        let mut description = KeyDescription::new();
        description.push(key.kind.to_wire() as u8);
        match key.kind {
            PropertyKeyKind::Text
            | PropertyKeyKind::EnginePrivateName
            | PropertyKeyKind::ModulePrivateName
            | PropertyKeyKind::RegisteredSymbol => {
                description.extend_from_slice(self.fragment.strings.get(key.text?));
            }
            PropertyKeyKind::WellKnownSymbol => description.push(key.symbol?.to_wire() as u8),
            PropertyKeyKind::CreatedSymbol => {
                let ModuleRef::File(home) = self.fragment.module_ref(key.module?) else {
                    return None;
                };
                description.extend_from_slice(&home.0.to_be_bytes());
                description.extend_from_slice(&key.call_number?.to_be_bytes());
            }
            PropertyKeyKind::PrivateName => return None,
        }
        Some(description)
    }

    pub(crate) fn untyped_layout(&mut self, members: &[Member]) -> LayoutId {
        let mut sorted = Vec::with_capacity(members.len());
        for (source_index, &(key, kind)) in members.iter().enumerate() {
            match kind {
                ObjectMemberKind::Field | ObjectMemberKind::Method => {}
                _ => continue,
            }
            if !can_be_field(self, key) {
                continue;
            }
            let Some(description) = self.describe_key(key) else {
                continue;
            };
            sorted.push(UntypedMember {
                description,
                key,
                kind,
                source_index,
            });
        }
        sorted.shared_sort_by(|a, b| a.description.cmp(&b.description));
        sorted.dedup_by(|later, earlier| {
            let is_repeated = later.key == earlier.key;
            if is_repeated {
                earlier.kind = later.kind;
            }
            is_repeated
        });
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
        if sorted.len() as u64 > limit {
            let mut source_indexes: Vec<usize> =
                sorted.iter().map(|member| member.source_index).collect();
            source_indexes.sort_unstable();
            let first_dropped = source_indexes[limit as usize];
            sorted.retain(|member| member.source_index < first_dropped);
        }
        let descriptions = sorted
            .iter()
            .map(|member| (member.description.as_slice(), member.kind));
        let layout = self.fragment.declare_layout(LayoutKey::UntypedLiteral {
            file: self.file,
            members: TypeIdentity::of_untyped_members(descriptions),
        });
        if self.fragment.is_layout_defined(layout) {
            return layout;
        }
        let mut fields = OwnFields::default();
        for member in &sorted {
            fields.add(Field {
                key: Some(member.key),
                declared: DeclaredType::untyped(),
                flags: member_flags(member.kind, true),
                ..Field::default()
            });
        }
        let fields = self.layouts.store_fields(layout, fields.finish());
        let definition = Layout {
            kind: LayoutKind::Record,
            module: Some(self.module_id()),
            fields: fields.as_slice().to_vec(),
            declared_order: order_fields_by(sorted.len(), |field| {
                sorted[field].source_index as u32
            }),
            ..Layout::default()
        };
        self.fragment.define_layout(layout, definition);
        layout
    }

    /// The layout of a literal that is born with other names than it is written with.
    pub(in crate::lower) fn layout_of_names(
        &mut self,
        literal: ExprId,
        members: &[Member],
    ) -> LayoutId {
        if let Some(&layout) = self.layouts.literals.get(&literal) {
            return layout;
        }
        let layout = self.untyped_layout(members);
        self.layouts.literals.insert(literal, layout);
        layout
    }

    pub(in crate::lower) fn is_field_name(&mut self, name: Atom) -> bool {
        let key = self.name_key(name);
        can_be_field(self, key)
    }

    /// An assignment under such a name to an object right below `Object.prototype` is no definition: `__proto__` has a setter there, and the others are refused
    /// once the program has frozen it.
    pub(in crate::lower) fn is_name_on_object_prototype(&self, name: Atom) -> bool {
        self.inputs.builtin_names.get(name).is_some_and(|name| {
            !matches!(
                table::member(BuiltinId::ObjectPrototype, name),
                table::MemberLookup::Absent
            )
        })
    }

    fn collect_literal_members(&mut self, literal: ExprId) -> Members {
        let hir = self.hir;
        let mut members = Members::new();
        let ExprKind::Object(properties) = hir[literal].kind else {
            debug_assert!(false, "an object literal was expected");
            return members;
        };
        for property in properties.iter() {
            let kind = match hir[property].kind {
                PropKind::Init | PropKind::Shorthand => ObjectMemberKind::Field,
                PropKind::Method => ObjectMemberKind::Method,
                PropKind::Spread | PropKind::Getter | PropKind::Setter => continue,
            };
            match hir.runtime_property_key(property) {
                PropKey::Name(name) => members.push((self.name_key(name), kind)),
                PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => {}
            }
        }
        members
    }

    // `{ size: 4, a: 1 }` under `{ size: number; [key: string]: number }`: that type has no field for `a`, and the literal's own type has one.
    fn writes_name_under_index_signature(&mut self, literal: ExprId, ty: CheckerTypeId) -> bool {
        let signatures = self.queries.index_signatures(ty);
        if !signatures.is_ok_and(|signatures| !signatures.is_empty()) {
            return false;
        }
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        properties.iter().any(|property| {
            let PropKey::Name(name) = hir.runtime_property_key(property) else {
                return false;
            };
            matches!(
                self.queries.find_member(ty, name),
                Ok(MemberLookup::Index(_))
            )
        })
    }

    fn find_contextual_layout(&mut self, literal: ExprId) -> Option<LayoutId> {
        if let Some(found) = self.find_target_layout(literal) {
            return Some(found);
        }
        let ty = self.queries.contextual_type(literal).ok()??;
        if self.writes_name_under_index_signature(literal, ty) {
            return None;
        }
        self.object_type_layout(ty)
    }

    pub(in crate::lower) fn literal_layout(&mut self, literal: ExprId) -> LayoutId {
        if let Some(&layout) = self.layouts.literals.get(&literal) {
            return layout;
        }
        self.layouts.literals_in_progress.push(literal);
        let checked = self
            .find_contextual_layout(literal)
            .or_else(|| self.find_layout_of_enclosing_list(literal))
            .or_else(|| self.find_checked_layout(literal));
        let layout = checked.unwrap_or_else(|| {
            let members = self.collect_literal_members(literal);
            self.untyped_layout(&members)
        });
        self.layouts.literals_in_progress.pop();
        self.layouts.literals.insert(literal, layout);
        layout
    }

    // The file does not name the layout by that.
    fn number_object_type(
        &mut self,
        ty: CheckerTypeId,
        literal: Option<ExprId>,
    ) -> Option<LayoutId> {
        let members = self.queries.listed_members(ty).ok()?;
        let (identity, is_empty) = self.describe_names(ty, members);
        // The names of an object that is born without a known name, `{}` or `{ a: 1, ...anything }`, are those that are stored later, which differ from one place of birth to the next.
        let origin = match (self.queries.object_origin(ty), literal) {
            _ if !is_empty => ObjectOrigin::Computed,
            (_, Some(expression)) => ObjectOrigin::ObjectLiteral {
                file: self.file,
                expression,
            },
            (origin @ ObjectOrigin::ObjectLiteral { .. }, None) => origin,
            (_, None) => ObjectOrigin::Computed,
        };
        Some(self.fragment.number_layout(LayoutKey::ObjectType {
            origin,
            instantiation: identity,
        }))
    }

    // Without a literal the answer is the same in every file.
    fn number_object_type_once_in_task(&mut self, ty: CheckerTypeId) -> Option<LayoutId> {
        if let Some(known) = self.find_number_of_object_type(ty) {
            return known;
        }
        let unstable_answers = self.queries.count_unstable_answers();
        let layout = self.number_object_type(ty, None);
        if self.queries.count_unstable_answers() == unstable_answers {
            self.keep_number_of_object_type(ty, layout);
        }
        layout
    }

    fn declare_object_type(
        &mut self,
        ty: CheckerTypeId,
        literal: Option<ExprId>,
    ) -> Option<LayoutId> {
        let layout = match literal {
            Some(_) => self.number_object_type(ty, literal)?,
            None => self.number_object_type_once_in_task(ty)?,
        };
        self.fragment.name_layout(layout);
        if self.layouts.is_growing(layout) || !self.layouts.add_source_type(layout, ty) {
            return Some(layout);
        }
        if self.grows_without_end(ty) {
            self.layouts.mark_growing(layout);
            return Some(layout);
        }
        if let Some(listed) = self.layouts.stored_listed_fields(layout)
            && listed.is_known
            && let Ok(members) = self.queries.listed_members(ty)
        {
            listed.add_type(ty, &self.sort_listed_fields(ty, members));
        }
        // What passes for an interface passes for what the interface extends.
        if let ObjectOrigin::Symbol(interface) = self.queries.object_origin(ty) {
            let bases = self.queries.declared_base_types(interface);
            for base in bases.unwrap_or_default() {
                if let Some(extended) = self.object_type_layout(base)
                    && extended != layout
                {
                    self.fragment.add_supertype(layout, extended);
                }
            }
        }
        // `IncomingMessage` of a declaration file: what has that type is made by the function of Bun's own module of that name.
        if self.source == SourceKind::Program {
            for declaration in self.queries.library_declarations_of_type(ty) {
                let key = LayoutKey::Library(declaration);
                let made = self.fragment.declare_layout(key);
                self.add_conversion(made, layout);
            }
        }
        Some(layout)
    }

    fn find_object_type_layout(&mut self, ty: CheckerTypeId) -> Option<LayoutId> {
        let shape = self.queries.type_shape(ty).ok()?;
        if !matches!(shape.kind, ShapeKind::Object) || self.is_dictionary_type(ty) {
            return None;
        }
        let origin = self.queries.object_origin(ty);
        if let ObjectOrigin::ObjectLiteral {
            file: home,
            expression,
        } = origin
            && home == self.file
            && matches!(self.hir[expression].kind, ExprKind::Object(_))
            && !self.layouts.literals_in_progress.contains(&expression)
        {
            return Some(self.literal_layout(expression));
        }
        self.declare_object_type(ty, None)
    }

    fn find_declaration(&mut self, ty: CheckerTypeId) -> Option<(FileId, u32)> {
        let files = self.queries.files();
        match self.queries.object_origin(ty) {
            ObjectOrigin::Symbol(_) => self.queries.type_name_site(ty),
            ObjectOrigin::TypeLiteral { file: home, node }
            | ObjectOrigin::MappedType { file: home, node } => {
                Some((home, files.hir(home)[node].pos))
            }
            ObjectOrigin::ObjectLiteral {
                file: home,
                expression,
            } => Some((home, files.hir(home)[expression].pos)),
            ObjectOrigin::Computed => None,
        }
    }

    // Nothing tests a store into an expected position, so a field is proven only where every type that has it proves it.
    fn unite_positions(&mut self, left: DeclaredType, right: DeclaredType) -> DeclaredType {
        if left == right {
            return left;
        }
        let in_either = left.flags | right.flags;
        let mut flags = PositionFlags(left.flags.0 & right.flags.0);
        if in_either.contains(PositionFlags::IS_EXPECTED) {
            flags |= PositionFlags::IS_EXPECTED;
        }
        let ty = self.fragment.types.union(left.ty, right.ty);
        DeclaredType {
            ty,
            site: left.site.or(right.site),
            flags,
        }
    }

    fn find_layout_of_enclosing_list(&mut self, literal: ExprId) -> Option<LayoutId> {
        let Parent::Expr(list) = self.bound.parent_of_expr(literal) else {
            return None;
        };
        if !matches!(self.hir[list].kind, ExprKind::Array(_)) {
            return None;
        }
        let list_type = self.queries.expression_type(list).ok()?;
        let element = self.find_array_element_type(list_type)?;
        let ObjectOrigin::ObjectLiteral {
            file: home,
            expression,
        } = self.queries.object_origin(element)
        else {
            return None;
        };
        if home != self.file || expression == literal {
            return None;
        }
        self.object_type_layout(element)
    }

    fn find_checked_layout(&mut self, literal: ExprId) -> Option<LayoutId> {
        let ty = self.queries.expression_type(literal).ok()?;
        let origin = ObjectOrigin::ObjectLiteral {
            file: self.file,
            expression: literal,
        };
        let members = self.queries.listed_members(ty);
        let has_names = members.is_ok_and(|members| !members.is_empty());
        if has_names
            && self.queries.object_origin(ty) != origin
            && let Some(layout) = self.object_type_layout(ty)
        {
            return Some(layout);
        }
        self.declare_object_type(ty, Some(literal))
    }
}

fn find_declared_order(listed: &[SortedMember]) -> Vec<u32> {
    order_fields_by(listed.len(), |field| listed[field].1.property_index)
}

fn order_fields_by(number_of_fields: usize, place_in_source: impl Fn(usize) -> u32) -> Vec<u32> {
    let mut order: Vec<u32> = (0..number_of_fields as u32).collect();
    order.sort_by_u32(|&field| place_in_source(field as usize));
    match order.iter().zip(0..).all(|(&field, place)| field == place) {
        true => Vec::new(),
        false => order,
    }
}

#[cfg(test)]
mod tests {
    use bun_sema::atom::known;

    use super::*;

    #[test]
    fn order_is_known_of_the_list_that_was_put_in_order() {
        let member = ListedMember {
            name: MemberName::String(known::default),
            kind: ObjectMemberKind::Field,
            is_optional: false,
            property_index: 0,
        };
        let (list, other_list) = ([member], [member]);
        let sorted: Arc<[SortedMember]> = vec![(FieldName::Text(known::default), member)].into();
        let (ty, other_type) = (CheckerTypeId(3), CheckerTypeId(4));
        let mut orders = KnownOrders::default();
        assert!(orders.find(ty, &list).is_none());
        orders.keep(ty, &list, &sorted);
        assert!(orders.find(ty, &list).is_some());
        assert!(orders.find(ty, &other_list).is_none());
        assert!(orders.find(other_type, &list).is_none());
    }
}

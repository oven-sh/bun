use core::cell::{Cell, RefCell};
use core::cmp::Ordering;
use std::rc::Rc;

use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::check::aot::{
    ListedMember, MemberLookup, MemberName, ObjectMemberKind, ObjectOrigin, ShapeKind,
    TypeIdentity, WrittenType,
};
use bun_sema::hir::{ExprId, ExprKind, PropKey, PropKind};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};

use super::{
    DefinedObjectType, HAS_PLACE, LAST_DEFINITION_LEVEL, NAMES_THE_SAME_IN_EVERY_FILE,
    NamesOfObjectType, ObjectTypeKey, OwnFields, slot_of,
};
use crate::builtins::resolve::SourceDialect;
use crate::ir::generated::{
    Field, FieldFlags, Layout, LayoutKind, LimitId, NameClass, PositionFlags,
};
use crate::ir::{
    DeclaredType, LayoutId, LayoutKey, PropertyKeyId, PropertyKeyKind, StringId, WellKnownSymbol,
    classify_name,
};
use crate::lower::{CheckerTypeId, FileLowering, SourceKind, types};
use crate::modules::ModuleRef;

const _: () = assert!(PropertyKeyKind::COUNT <= 1 << u8::BITS);
const _: () = assert!(WellKnownSymbol::COUNT <= 1 << u8::BITS);

const MAX_ROUNDS_OF_FIELD_TYPES: usize = 4;

type Member = (PropertyKeyId, ObjectMemberKind);
type Members = SmallVec<[Member; 8]>;
type KeyDescription = SmallVec<[u8; 24]>;
pub(super) type SortedMember = (FieldName, ListedMember);

#[derive(Default)]
struct Declaration {
    name: Option<StringId>,
    site: Option<(FileId, u32)>,
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

    pub(super) fn flags(&self, field: u32) -> FieldFlags {
        self.fields[field as usize].flags.get()
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
    fn describe_names(&mut self, ty: CheckerTypeId, members: &[ListedMember]) -> NamesOfObjectType {
        let fields = self.sort_listed_fields(ty, members);
        let descriptions: Vec<(KeyDescription, ObjectMemberKind)> = fields
            .iter()
            .filter_map(|&(name, member)| Some((self.describe_name(name)?, member.kind)))
            .collect();
        let names = descriptions
            .iter()
            .map(|(name, kind)| (name.as_slice(), *kind));
        NamesOfObjectType {
            identity: TypeIdentity::of_untyped_members(names),
            is_empty: descriptions.is_empty(),
            flags: describe_flags(fields.iter().map(|field| listed_member_flags(field.1))),
        }
    }

    // Every member of such a type is a type that nothing has made yet, with the same layout, and looking at its members makes the next ones.
    fn grows_without_end(&mut self, ty: CheckerTypeId) -> bool {
        const LONGEST_PATH: usize = 64;
        let holder = match self.layouts.holder_in_progress {
            Some(holder) if holder != ty => holder,
            Some(_) | None => return false,
        };
        self.layouts.holders.insert(ty, holder);
        let mut path = vec![ty];
        while let Some(&holder) = self.layouts.holders.get(&path[path.len() - 1])
            && path.len() < LONGEST_PATH
        {
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

    fn find_position_in_file(&mut self, layout: LayoutId) -> u32 {
        let Some(&ty) = self.layouts.source_types(layout).first() else {
            debug_assert!(false, "object type layout without a source type");
            return 0;
        };
        match self.find_declaration(ty, false).site {
            Some((home, position)) if home == self.file => position,
            Some(_) | None => 0,
        }
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
    ) -> Rc<[SortedMember]> {
        if let Some(sorted) = self.layouts.sorted_members.get(&ty) {
            return Rc::clone(sorted);
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
        let sorted: Rc<[SortedMember]> = fields.into();
        self.layouts.sorted_members.insert(ty, Rc::clone(&sorted));
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
            let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
            if members.len() as u64 > limit && fields_of_type.len() as u64 == limit {
                let position = self.find_position_in_file(layout);
                self.gave_up(LimitId::FieldsInKeyOrder, position);
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

    pub(super) fn list_fields(&mut self, layout: LayoutId) -> Rc<ListedFields> {
        if let Some(listed) = self.layouts.stored_listed_fields(layout) {
            return listed;
        }
        let listed = Rc::new(self.compute_listed_fields(layout));
        *slot_of(&mut self.layouts.listed_fields, layout) = Some(Rc::clone(&listed));
        listed
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
        for _ in 0..MAX_ROUNDS_OF_FIELD_TYPES {
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
        Some(ObjectTypeKey {
            origin,
            identity: self.queries.type_identity(ty).ok()?,
            is_checked: self.is_checked(),
        })
    }

    fn compute_fields_of_type(
        &mut self,
        layout: LayoutId,
        ty: CheckerTypeId,
        is_told_to_other_files: bool,
    ) -> Option<(Vec<Field>, Vec<u32>, bool)> {
        let members = self.queries.listed_members(ty).ok()?;
        let listed = self.sort_listed_fields(ty, members);
        let mut fields = Vec::with_capacity(listed.len());
        let mut name_the_same_in_every_file = is_told_to_other_files;
        let outer = self.layouts.holder_in_progress.replace(ty);
        for &(name, member) in listed.iter() {
            let types = self.queries.listed_member_types(ty, member);
            name_the_same_in_every_file &=
                types.checked.is_ok() && !matches!(types.written, WrittenType::GaveUp(_));
            for named in [types.written.written(), types.checked.ok()]
                .into_iter()
                .flatten()
            {
                name_the_same_in_every_file = name_the_same_in_every_file
                    && types::is_mapped_alike_in_every_file(self, named);
            }
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
        // Whether the file had found out by now hangs on what else it has looked at.
        if self.layouts.is_growing(layout) {
            name_the_same_in_every_file = false;
            for field in &mut fields {
                field.declared = DeclaredType::untyped();
            }
        }
        Some((
            fields,
            find_declared_order(&listed),
            name_the_same_in_every_file,
        ))
    }

    fn has_place(&mut self, ty: CheckerTypeId) -> bool {
        let site = self.find_declaration(ty, false).site;
        site.is_some_and(|(home, _)| self.has_module(home))
    }

    fn has_module(&self, home: FileId) -> bool {
        self.queries.files().is_compiled(home) && !self.inputs.is_left_out(home)
    }

    // `false`: the file or an earlier one has said the same of the layout.
    fn claim_names(&mut self, layout: LayoutId, key: ObjectTypeKey) -> bool {
        let defined = self.inputs.defined_object_types;
        let Some(defined_type) = DefinedObjectType::new(self.fragment.layout_key(layout), key)
        else {
            return false;
        };
        self.layouts.named_types.insert((layout, key))
            && !defined.is_defined_by_earlier_file(&defined_type, self.file)
    }

    fn define_names_of_type(&mut self, layout: LayoutId, ty: CheckerTypeId) {
        let has_place = self.has_place(ty);
        let known = self.inputs.defined_object_types.find_names(ty);
        if let Some(names) = known
            && !self.claim_names(layout, create_key_of_names(names.flags, has_place))
        {
            return;
        }
        let Ok(members) = self.queries.listed_members(ty) else {
            return;
        };
        let listed = self.sort_listed_fields(ty, members);
        let fields: Vec<Field> = listed
            .iter()
            .map(|&(name, member)| Field {
                key: Some(self.find_key(name)),
                declared: DeclaredType::unsaid(),
                flags: listed_member_flags(member),
                ..Field::default()
            })
            .collect();
        let flags = describe_flags(fields.iter().map(|field| field.flags));
        let key = create_key_of_names(flags, has_place);
        if known.is_none() && !self.claim_names(layout, key) {
            return;
        }
        let key = Some((key, LAST_DEFINITION_LEVEL));
        let order = find_declared_order(&listed);
        self.define_type(layout, ty, fields, order, has_place, key);
    }

    pub(super) fn define_object_type_layout(
        &mut self,
        layout: LayoutId,
        types: &[CheckerTypeId],
        level: u8,
        says_types: bool,
    ) {
        // A layout with a home has one type, and the link takes what the home says.
        let has_home = self.fragment.layout_key(layout).home_file().is_some();
        if !has_home && !says_types {
            for &ty in types {
                self.define_names_of_type(layout, ty);
            }
            return;
        }
        for &ty in types {
            let key = match has_home {
                true => None,
                false => self.find_object_type_key(ty),
            };
            let layout_key = self.fragment.layout_key(layout);
            let defined = self.inputs.defined_object_types;
            let defined_type = key.and_then(|key| DefinedObjectType::new(layout_key, key));
            let is_defined_by_earlier_file =
                defined_type.is_some_and(|ty| defined.is_defined_by_earlier_file(&ty, self.file));
            if is_defined_by_earlier_file
                && (level == LAST_DEFINITION_LEVEL
                    || defined_type
                        .is_some_and(|ty| defined.has_earlier_file_gone_on_for_all(&ty, self.file)))
            {
                continue;
            }
            let is_told_to_other_files = defined_type.is_some()
                && !is_defined_by_earlier_file
                && level < LAST_DEFINITION_LEVEL;
            if let Some((fields, declared_order, name_the_same_in_every_file)) =
                self.compute_fields_of_type(layout, ty, is_told_to_other_files)
                && !is_defined_by_earlier_file
            {
                let names_the_same = match name_the_same_in_every_file {
                    true => NAMES_THE_SAME_IN_EVERY_FILE,
                    false => 0,
                };
                let has_place = !has_home && self.has_place(ty);
                let key = key.map(|key| (key, level | names_the_same));
                self.define_type(layout, ty, fields, declared_order, has_place, key);
            }
        }
    }

    // Which types with the layout a file meets first hangs on what it leaves to earlier files, so a definition is shown under the name of its own type.
    fn define_type(
        &mut self,
        layout: LayoutId,
        ty: CheckerTypeId,
        fields: Vec<Field>,
        declared_order: Vec<u32>,
        has_place: bool,
        key: Option<(ObjectTypeKey, u8)>,
    ) {
        // The link drops the name of every definition of a layout but the one that it shows: the first with a place, or the first.
        let is_first_of_file = match has_place {
            true => !self.layouts.placed_layouts.contains(&layout),
            false => !self.fragment.is_layout_defined(layout),
        };
        let layout_key = self.fragment.layout_key(layout);
        let defined = self.inputs.defined_object_types;
        let is_shown = is_first_of_file
            && !defined.is_layout_defined_by_earlier_file(layout_key, self.file, has_place);
        let declaration = self.find_declaration(ty, is_shown);
        let (module, position) = match declaration.site {
            Some((home, position)) if self.has_module(home) => {
                let module = self.fragment.declare_module(ModuleRef::File(home));
                (Some(module), position)
            }
            Some(_) | None => (None, 0),
        };
        let definition = Layout {
            kind: LayoutKind::Record,
            name: declaration.name,
            module,
            position,
            fields,
            declared_order,
            ..Layout::default()
        };
        let key = key.map(|(key, level)| match has_place {
            true => {
                self.layouts.placed_layouts.insert(layout);
                (key, level | HAS_PLACE)
            }
            false => (key, level),
        });
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
            PropertyKeyKind::Text | PropertyKeyKind::EnginePrivateName => {
                description.extend_from_slice(self.fragment.strings.get(key.text?));
            }
            PropertyKeyKind::WellKnownSymbol => description.push(key.symbol?.to_wire() as u8),
            PropertyKeyKind::CreatedSymbol => {
                let ModuleRef::File(home) = self.fragment.module_ref(key.module?) else {
                    return None;
                };
                description.extend_from_slice(&home.0.to_be_bytes());
                description.extend_from_slice(&key.position?.to_be_bytes());
            }
            PropertyKeyKind::PrivateName => return None,
        }
        Some(description)
    }

    fn untyped_layout_at(&mut self, members: &[Member], position: u32) -> LayoutId {
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
            self.gave_up(LimitId::FieldsInKeyOrder, position);
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
            ..Layout::default()
        };
        self.fragment.define_layout(layout, definition);
        layout
    }

    pub(crate) fn untyped_layout(&mut self, members: &[Member]) -> LayoutId {
        self.untyped_layout_at(members, 0)
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
            let position = self.hir[literal].pos;
            self.untyped_layout_at(&members, position)
        });
        self.layouts.literals_in_progress.pop();
        self.layouts.literals.insert(literal, layout);
        layout
    }

    fn declare_object_type(
        &mut self,
        ty: CheckerTypeId,
        literal: Option<ExprId>,
    ) -> Option<LayoutId> {
        let members = self.queries.listed_members(ty).ok()?;
        let names = match self.inputs.defined_object_types.find_names(ty) {
            Some(names) => names,
            None => {
                let names = self.describe_names(ty, members);
                self.layouts.described_names.push((ty, names));
                names
            }
        };
        // The names of an object that is born without a known name, `{}` or `{ a: 1, ...anything }`, are those that are stored later, which differ from one place of birth to the next.
        let origin = match (self.queries.object_origin(ty), literal) {
            _ if !names.is_empty => ObjectOrigin::Computed,
            (_, Some(expression)) => ObjectOrigin::ObjectLiteral {
                file: self.file,
                expression,
            },
            (origin @ ObjectOrigin::ObjectLiteral { .. }, None) => origin,
            (_, None) => ObjectOrigin::Computed,
        };
        let layout = self.fragment.declare_layout(LayoutKey::ObjectType {
            origin,
            instantiation: names.identity,
        });
        if self.layouts.is_growing(layout) || !self.layouts.add_source_type(layout, ty) {
            return Some(layout);
        }
        if self.grows_without_end(ty) {
            self.layouts.mark_growing(layout);
            return Some(layout);
        }
        if let Some(listed) = self.layouts.stored_listed_fields(layout)
            && listed.is_known
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

    fn find_declaration(&mut self, ty: CheckerTypeId, is_shown: bool) -> Declaration {
        let files = self.queries.files();
        let options = self.inputs.options;
        let site = match self.queries.object_origin(ty) {
            // A bundle holds no name of a type. The report of a mismatch shows them.
            ObjectOrigin::Symbol(_)
                if is_shown
                    && (!options.minifies_identifiers || options.reports_type_mismatches) =>
            {
                let Some(display_name) = self.queries.type_display_name(ty) else {
                    return Declaration::default();
                };
                return Declaration {
                    name: Some(self.intern_bytes(&display_name.text)),
                    site: Some((display_name.file, display_name.position)),
                };
            }
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
        };
        Declaration { name: None, site }
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
        DeclaredType {
            ty: self.fragment.types.union(left.ty, right.ty),
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
    let mut order: Vec<u32> = (0..listed.len() as u32).collect();
    order.sort_by_key(|&field| listed[field as usize].1.property_index);
    match order.iter().zip(0..).all(|(&field, place)| field == place) {
        true => Vec::new(),
        false => order,
    }
}

fn create_key_of_names(flags: TypeIdentity, has_place: bool) -> ObjectTypeKey {
    ObjectTypeKey {
        origin: ObjectOrigin::Computed,
        identity: flags,
        is_checked: has_place,
    }
}

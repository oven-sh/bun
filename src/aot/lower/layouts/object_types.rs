use bun_sort_by_number::SortByNumber;
use core::cell::{Cell, RefCell};
use core::cmp::Ordering;
use std::rc::Rc;
use std::sync::Arc;

use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, BindingKind, BindingStability, Bound, CodeUnit, Decl, Parent, SymbolId,
};
use bun_sema::check::aot::{
    ListedMember, MemberLookup, MemberName, ObjectMemberKind, ObjectOrigin, ShapeKind, TypeIdentity,
};
use bun_sema::hir::{BinOp, ExprId, ExprKind, File, FnId, PatKind, PropKey, PropKind};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

use super::OwnFields;
use crate::builtins::id::BuiltinId;
use crate::builtins::resolve::SourceDialect;
use crate::builtins::table;
use crate::ir::generated::{
    DeclaredRecord, Field, FieldFlags, Layout, LayoutKind, LimitId, NameClass, PositionFlags,
};
use crate::ir::{
    DeclaredType, Id, LayoutId, LayoutKey, PropertyKeyId, PropertyKeyKind, TypeId, WellKnownSymbol,
    classify_name,
};
use crate::lower::{CheckerTypeId, FileLowering, SourceKind};
use crate::modules::ModuleRef;

const _: () = assert!(PropertyKeyKind::COUNT <= 1 << u8::BITS);
const _: () = assert!(WellKnownSymbol::COUNT <= 1 << u8::BITS);

const KIND_OF_TEXT: u8 = PropertyKeyKind::Text.to_wire() as u8;
const KIND_OF_CREATED_SYMBOL: u8 = PropertyKeyKind::CreatedSymbol.to_wire() as u8;

fn split_home(key: &[u8]) -> Option<(&[u8], FileId)> {
    let [KIND_OF_CREATED_SYMBOL, ..] = key else {
        return None;
    };
    let (rest, home) = key.split_last_chunk()?;
    Some((rest, FileId(u32::from_be_bytes(*home))))
}

fn identity_of_keys<'a>(
    keys: impl Iterator<Item = (&'a [u8], ObjectMemberKind)> + Clone,
    mark: Option<&'a [u8]>,
) -> TypeIdentity {
    let mark = mark.map(|mark| (mark, ObjectMemberKind::Field));
    let whole = TypeIdentity::of_untyped_members(keys.clone().chain(mark));
    let Some((_, home)) = keys.clone().find_map(|(key, _)| split_home(key)) else {
        return whole;
    };
    let without_home = |key| split_home(key).map_or(key, |(rest, _)| rest);
    let text = keys.map(|(key, kind)| (without_home(key), kind));
    let TypeIdentity([first, _]) = TypeIdentity::of_untyped_members(text.chain(mark));
    TypeIdentity([first, whole.0[1]]).in_file(home)
}

fn literal_writes_functions_alone(hir: &File<'_>, literal: ExprId) -> bool {
    let ExprKind::Object(properties) = hir[literal].kind else {
        return false;
    };
    properties.iter().next().is_some()
        && properties.iter().all(|property| match hir[property].kind {
            PropKind::Method => true,
            PropKind::Init => matches!(hir[hir[property].value].kind, ExprKind::Fn(_)),
            _ => false,
        })
}

type Member = (PropertyKeyId, ObjectMemberKind);
type Members = SmallVec<[Member; 8]>;
type KeyDescription = SmallVec<[u8; 24]>;
pub(super) type SortedMember = (FieldName, ListedMember);

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ObjectTypeKey {
    Type {
        origin: ObjectOrigin,
        identity: TypeIdentity,
        is_checked: bool,
    },
    Names {
        flags: TypeIdentity,
        has_place: bool,
    },
}

struct FieldsOfType {
    fields: Vec<Field>,
    declared_order: Vec<u32>,
    is_kept: bool,
}

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

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum FieldName {
    Text(Atom),
    Key(PropertyKeyId),
}

#[derive(Copy, Clone)]
struct DescribedName {
    first_bytes: u64,
    start: u32,
    end: u32,
    field: u32,
}

impl DescribedName {
    #[inline]
    fn description<'t>(&self, text: &'t [u8]) -> &'t [u8] {
        &text[self.start as usize..self.end as usize]
    }

    #[inline]
    fn is_described(&self) -> bool {
        self.start < self.end
    }

    #[inline]
    fn is_described_like(&self, other: &DescribedName, text: &[u8]) -> bool {
        self.first_bytes == other.first_bytes && self.description(text) == other.description(text)
    }

    #[inline]
    fn compare(&self, other: &DescribedName, text: &[u8]) -> Ordering {
        self.first_bytes
            .cmp(&other.first_bytes)
            .then_with(|| self.description(text).cmp(other.description(text)))
            .then_with(|| self.field.cmp(&other.field))
    }
}

#[derive(Default)]
pub(super) struct DescribedNames {
    ty: Option<CheckerTypeId>,
    text: Vec<u8>,
    names: Vec<DescribedName>,
    fields: Vec<SortedMember>,
}

impl DescribedNames {
    fn clear(&mut self) {
        self.ty = None;
        self.text.clear();
        self.names.clear();
        self.fields.clear();
    }

    #[inline]
    fn add_text(&mut self, text: &[u8]) {
        let start = self.text.len();
        self.text.push(KIND_OF_TEXT);
        self.text.extend_from_slice(text);
        self.end_name(start);
    }

    fn add(&mut self, description: Option<&[u8]>) {
        let start = self.text.len();
        if let Some(description) = description {
            self.text.extend_from_slice(description);
        }
        self.end_name(start);
    }

    #[inline]
    fn end_name(&mut self, start: usize) {
        self.names.push(DescribedName {
            first_bytes: 0,
            start: start as u32,
            end: self.text.len() as u32,
            field: self.names.len() as u32,
        });
    }

    fn sort(&mut self) {
        let DescribedNames { text, names, .. } = self;
        text.extend_from_slice(&[0; 8]);
        for name in names.iter_mut() {
            let first_bytes = text[name.start as usize..].first_chunk::<8>();
            let first_bytes = first_bytes.map_or(0, |bytes| u64::from_be_bytes(*bytes));
            name.first_bytes = match name.end - name.start {
                length @ 0..8 => first_bytes & !(u64::MAX >> (8 * length)),
                _ => first_bytes,
            };
        }
        names.sort_unstable_by(|first, second| first.compare(second, text));
    }

    fn drop_repeated_names(&mut self) {
        let DescribedNames {
            text,
            names,
            fields,
            ..
        } = self;
        let mut has_repeated_name = false;
        for index in 1..names.len() {
            has_repeated_name |= names[index - 1].is_described_like(&names[index], text);
        }
        if !has_repeated_name {
            return;
        }
        let mut kept: Vec<DescribedName> = Vec::with_capacity(names.len());
        let mut start_of_run = 0;
        for name in names.iter() {
            if kept
                .last()
                .is_some_and(|last| !last.is_described_like(name, text))
            {
                start_of_run = kept.len();
            }
            let field_name = fields[name.field as usize].0;
            let mut run = kept[start_of_run..].iter();
            if !run.any(|earlier| fields[earlier.field as usize].0 == field_name) {
                kept.push(*name);
            }
        }
        *names = kept;
    }
}

struct ListedField {
    name: FieldName,
    flags: Cell<FieldFlags>,
    members: RefCell<SmallVec<[(CheckerTypeId, ListedMember); 1]>>,
    said: RefCell<SmallVec<[Option<DeclaredType>; 1]>>,
    declared: Cell<(Option<DeclaredType>, usize)>,
}

#[derive(Default)]
pub(super) struct ListedFields {
    fields: Vec<ListedField>,
    is_known: bool,
    places_of_types: RefCell<FxHashMap<CheckerTypeId, u32>>,
    types_of_literals: RefCell<SmallVec<[bool; 4]>>,
    number_looked_at: Cell<usize>,
    keys: RefCell<SmallVec<[PropertyKeyId; 8]>>,
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

    pub(super) fn keys(&self) -> core::cell::Ref<'_, SmallVec<[PropertyKeyId; 8]>> {
        self.keys.borrow()
    }

    pub(super) fn count_types(&self) -> usize {
        (self.fields.first()).map_or(0, |field| field.members.borrow().len())
    }

    pub(super) fn for_each_type_said(&self, first: usize, mut visit: impl FnMut(TypeId)) {
        for field in &self.fields {
            let mut last = None;
            for said in field.said.borrow().iter().skip(first).flatten() {
                if last.replace(said.ty) != Some(said.ty) {
                    visit(said.ty);
                }
            }
        }
    }

    fn find_place_of_type(&self, ty: CheckerTypeId) -> Option<usize> {
        const FEW: usize = 8;
        let members = self.fields.first()?.members.borrow();
        if members.len() <= FEW {
            return members.iter().position(|&(of, _)| of == ty);
        }
        let mut places = self.places_of_types.borrow_mut();
        for (place, &(of, _)) in members.iter().enumerate().skip(places.len()) {
            places.insert(of, place as u32);
        }
        places.get(&ty).map(|&place| place as usize)
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

#[inline]
fn listed_member_flags(member: ListedMember) -> FieldFlags {
    member_flags(member.kind, member.is_optional)
}

#[inline]
fn member_flags(kind: ObjectMemberKind, is_optional: bool) -> FieldFlags {
    let mut flags = 0;
    if !is_optional {
        flags |= FieldFlags::IS_REQUIRED.0;
    }
    if kind == ObjectMemberKind::Method {
        flags |= FieldFlags::IS_METHOD.0;
    }
    FieldFlags::from_wire(flags).unwrap_or_default()
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
    let mut distinct: SmallVec<[[u8; 4]; 4]> = SmallVec::new();
    for flags in flags {
        let flags = flags.0.to_le_bytes();
        if !distinct.contains(&flags) {
            distinct.push(flags);
        }
    }
    TypeIdentity::of_untyped_members(
        distinct
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
        if self.layouts.described_names.ty != Some(ty) {
            self.describe_sorted_names(ty, &fields);
        }
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
        let described = &self.layouts.described_names;
        let descriptions = described
            .names
            .iter()
            .zip(fields.iter())
            .filter(|(name, _)| name.is_described())
            .map(|(name, field)| (name.description(&described.text), field.1.kind));
        let is_empty = descriptions.clone().next().is_none();
        let flags = has_other_optional_members.then_some(bytes_of_flags.as_slice());
        (identity_of_keys(descriptions, flags), is_empty)
    }

    fn describe_sorted_names(&mut self, ty: CheckerTypeId, fields: &[SortedMember]) {
        let mut described = core::mem::take(&mut self.layouts.described_names);
        described.clear();
        for &(name, _) in fields {
            match name {
                FieldName::Text(text) => described.add_text(self.queries.atom_bytes(text)),
                FieldName::Key(key) => described.add(self.describe_key(key).as_deref()),
            }
        }
        described.ty = Some(ty);
        self.layouts.described_names = described;
    }

    fn holder_of_what_member_says(
        &mut self,
        ty: CheckerTypeId,
        member: ListedMember,
    ) -> Option<CheckerTypeId> {
        let hangs_on_arguments = self
            .queries
            .listed_member_hangs_on_type_arguments(ty, member);
        hangs_on_arguments.then_some(ty)
    }

    fn grows_without_end(&mut self, ty: CheckerTypeId) -> bool {
        let holder = match self.layouts.holder_in_progress {
            Some(holder) if holder != ty => holder,
            Some(_) | None => return false,
        };
        self.layouts.holders.insert(ty, holder);
        let mut path: SmallVec<[CheckerTypeId; 8]> = smallvec![ty];
        let mut last = ty;
        while let Some(&holder) = self.layouts.holders.get(&last) {
            debug_assert!(
                path.len() <= self.layouts.holders.len(),
                "a type is held by one that the file met before it"
            );
            path.push(holder);
            last = holder;
        }
        path.reverse();
        self.queries.grows_along(&path)
    }

    pub(in crate::lower) fn note_declared_record(
        &mut self,
        function: FnId,
        parameter: u32,
        ty: CheckerTypeId,
    ) {
        let is_written_by_declaration = matches!(
            self.queries.object_origin(ty),
            ObjectOrigin::Symbol(_)
                | ObjectOrigin::TypeLiteral { .. }
                | ObjectOrigin::MappedType { .. }
        );
        if !is_written_by_declaration || self.is_dictionary_type(ty) {
            return;
        }
        let Ok(members) = self.queries.listed_members(ty) else {
            return;
        };
        let fields = self.sort_listed_fields(ty, members);
        let required = fields.iter().filter(|field| !field.1.is_optional);
        let names: Vec<PropertyKeyId> = required.map(|field| self.find_key(field.0)).collect();
        if !names.is_empty() {
            let module = self.module_id();
            let start = self.hir[function].text_start;
            self.fragment.add_declared_record(DeclaredRecord {
                module,
                start,
                parameter,
                names,
            });
        }
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
        let mut described = core::mem::take(&mut self.layouts.described_names);
        described.clear();
        for &listed_member in members {
            let name = match (listed_member.name, self.source.dialect()) {
                (MemberName::String(name), SourceDialect::Program) => FieldName::Text(name),
                (MemberName::String(name), SourceDialect::Runtime) => {
                    FieldName::Key(self.name_key(name))
                }
                (MemberName::Symbol(name), _) => match self.symbol_key_of_member(name) {
                    Some(key) => FieldName::Key(key),
                    None => continue,
                },
                (MemberName::Private(_), _) => continue,
            };
            match name {
                FieldName::Text(text) => {
                    let text = self.queries.atom_bytes(text);
                    if !is_field_name(classify_name(text)) {
                        continue;
                    }
                    described.add_text(text);
                }
                FieldName::Key(key) => {
                    if !can_be_field(self, key) {
                        continue;
                    }
                    described.add(self.describe_key(key).as_deref());
                }
            }
            described.fields.push((name, listed_member));
        }
        described.sort();
        described.drop_repeated_names();
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder) as usize;
        described.names.truncate(limit);
        let fields = &described.fields;
        let in_order = described.names.iter();
        let in_order = in_order.map(|name| fields[name.field as usize]);
        let sorted: Arc<[SortedMember]> = in_order.collect();
        described.ty = Some(ty);
        self.layouts.described_names = described;
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
                said: RefCell::default(),
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

    fn is_type_of_literal(&mut self, ty: CheckerTypeId) -> bool {
        matches!(
            self.queries.object_origin(ty),
            ObjectOrigin::ObjectLiteral { .. }
        )
    }

    fn is_listed_type_of_literal(
        &mut self,
        listed: &ListedFields,
        place: usize,
        ty: CheckerTypeId,
    ) -> bool {
        if let Some(&known) = listed.types_of_literals.borrow().get(place) {
            return known;
        }
        let is_of_literal = self.is_type_of_literal(ty);
        let mut known = listed.types_of_literals.borrow_mut();
        if known.len() == place {
            known.push(is_of_literal);
        }
        is_of_literal
    }

    pub(super) fn listed_field_position(
        &mut self,
        layout: LayoutId,
        listed: &ListedFields,
        field: u32,
    ) -> DeclaredType {
        let (united, number_united) = listed.fields[field as usize].declared.get();
        if !self.make_positions_of_members(layout, listed, field) {
            return DeclaredType::untyped();
        }
        let field = &listed.fields[field as usize];
        if number_united == field.said.borrow().len() {
            return united.unwrap_or_else(DeclaredType::untyped);
        }
        let mut said: SmallVec<[DeclaredType; 4]> = SmallVec::new();
        if let Some(united) = united {
            said.push(united);
        }
        let number_said = {
            let by_each_member = field.said.borrow();
            let by_each_member: &[Option<DeclaredType>] = &by_each_member;
            for &position in by_each_member[number_united..].iter().flatten() {
                said.push(position);
            }
            by_each_member.len()
        };
        let united = self.unite_all_positions(&said);
        field.declared.set((united, number_said));
        united.unwrap_or_else(DeclaredType::untyped)
    }

    fn make_positions_of_members(
        &mut self,
        layout: LayoutId,
        listed: &ListedFields,
        field: u32,
    ) -> bool {
        let field = &listed.fields[field as usize];
        let number_seen = field.said.borrow().len();
        let number_listed = field.members.borrow().len();
        let mut made: SmallVec<[Option<DeclaredType>; 4]> = SmallVec::new();
        for place in number_seen..number_listed {
            if self.layouts.is_growing(layout) {
                return false;
            }
            let Some((ty, member)) = field.members.borrow().get(place).copied() else {
                break;
            };
            if self.is_listed_type_of_literal(listed, place, ty) {
                made.push(None);
                continue;
            }
            made.push(Some(self.position_declared_by_member(ty, member)));
        }
        if self.layouts.is_growing(layout) {
            return false;
        }
        let mut said = field.said.borrow_mut();
        if said.len() > number_seen {
            said.truncate(number_seen);
        }
        for &position in made.iter() {
            said.push(position);
        }
        if said.len() < listed.number_looked_at.get() {
            listed.number_looked_at.set(said.len());
        }
        true
    }

    pub(super) fn list_fields_without_unions(
        &mut self,
        layout: LayoutId,
    ) -> Option<Rc<ListedFields>> {
        let listed = self.find_fields_without_types(layout)?;
        loop {
            let number_of_types = self.layouts.source_types(layout).len();
            let number_listed = listed.count_types();
            if listed.number_looked_at.get() < number_listed {
                let is_looked_at = (0..listed.fields.len() as u32)
                    .all(|index| self.make_positions_of_members(layout, &listed, index));
                if is_looked_at {
                    listed.number_looked_at.set(number_listed);
                }
            }
            if self.layouts.source_types(layout).len() == number_of_types {
                break;
            }
        }
        if listed.keys.borrow().len() < listed.fields.len() {
            let names = listed.fields.iter().map(|field| field.name);
            *listed.keys.borrow_mut() = names.map(|name| self.find_key(name)).collect();
        }
        Some(listed)
    }

    pub(in crate::lower) fn make_positions_of_fields(&mut self, layout: LayoutId) {
        if self.list_fields_without_unions(layout).is_none() {
            super::own_fields(self, layout);
        }
    }

    fn field_position_under_written_type(
        &mut self,
        layout: LayoutId,
        field: u32,
        ty: CheckerTypeId,
    ) -> Option<DeclaredType> {
        let LayoutKey::ObjectType { .. } = self.fragment.layout_key(layout) else {
            return None;
        };
        let listed = self.list_fields(layout);
        if !self.make_positions_of_members(layout, &listed, field) {
            return None;
        }
        let place = listed.find_place_of_type(ty)?;
        let said = listed.fields[field as usize].said.borrow();
        said.get(place).copied().flatten()
    }

    fn position_declared_by_member(
        &mut self,
        ty: CheckerTypeId,
        member: ListedMember,
    ) -> DeclaredType {
        let outer = self.layouts.holder_in_progress;
        self.layouts.holder_in_progress = self.holder_of_what_member_says(ty, member);
        let types = self.queries.listed_member_types(ty, member);
        let declared = self.create_member_position(types);
        self.layouts.holder_in_progress = outer;
        match member.is_optional {
            true => self.add_undefined(declared),
            false => declared,
        }
    }

    pub(in crate::lower) fn position_of_member(
        &mut self,
        layout: LayoutId,
        field: u32,
        value: Option<ExprId>,
    ) -> DeclaredType {
        let Some(Parent::Prop(property)) = value.map(|value| self.bound.parent_of_expr(value))
        else {
            return self.field_position(layout, field);
        };
        let literal = self.bound.prop_owner[property.idx()];
        let written_types = &self.layouts.written_types_of_literals;
        let written = written_types.get(&literal).copied();
        let under_written_type = written
            .filter(|&(of_literal, _)| of_literal == layout)
            .and_then(|(_, ty)| self.field_position_under_written_type(layout, field, ty));
        if let Some(position) = under_written_type {
            return position;
        }
        let united = self.field_position(layout, field);
        if !crate::lower::positions::has_int32_promise(self)
            || self.layouts.literals.get(&literal) != Some(&layout)
            || self.layouts.is_growing(layout)
        {
            return united;
        }
        match self.queries.contextual_type(literal) {
            Ok(Some(context)) => {
                let LayoutKey::ObjectType { .. } = self.fragment.layout_key(layout) else {
                    return united;
                };
                let listed = self.list_fields(layout);
                let member = listed.find_place_of_type(context).and_then(|place| {
                    let field = listed.fields.get(field as usize)?;
                    field.members.borrow().get(place).copied()
                });
                match member {
                    Some((ty, member)) => self.position_declared_by_member(ty, member),
                    None => united,
                }
            }
            Ok(None) if self.is_reached_through_members_alone(literal) => DeclaredType::untyped(),
            _ => united,
        }
    }

    fn is_reached_through_members_alone(&mut self, literal: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let (ExprKind::Object(properties), Parent::VarInit(declaration)) =
            (hir[literal].kind, bound.parent_of_expr(literal))
        else {
            return false;
        };
        let name = hir[declaration].pat;
        let Some(variable) = bound.declared_symbol(Decl::Var(name)).some() else {
            return false;
        };
        matches!(hir[name].kind, PatKind::Ident(_))
            && properties.iter().all(|property| {
                matches!(
                    hir[property].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                )
            })
            && matches!(
                bound.binding_kind(variable),
                BindingKind::Const | BindingKind::Let
            )
            && bound.binding_stability(variable) == BindingStability::Stable
            && !bound.is_visible_to_eval(variable)
            && matches!(
                bound.code_unit(bound.symbol_scope(variable)),
                CodeUnit::Function(_)
            )
            && !self.variables_that_leave_whole().contains(&variable)
    }

    fn variables_that_leave_whole(&mut self) -> Rc<FxHashSet<SymbolId>> {
        if let Some(found) = &self.layouts.variables_that_leave_whole {
            return Rc::clone(found);
        }
        let (hir, bound) = (self.hir, self.bound);
        let mut found = FxHashSet::default();
        for (mention, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
            if matches!(node.kind, ExprKind::Ident(_))
                && bound.is_evaluated_ident(mention)
                && let Binding::Symbol(variable) = bound.binding(mention)
                && !reaches_member_alone(hir, bound, mention)
            {
                found.insert(variable);
            }
        }
        let found = Rc::new(found);
        self.layouts.variables_that_leave_whole = Some(Rc::clone(&found));
        found
    }

    pub(super) fn compute_object_type_fields(&mut self, layout: LayoutId) -> OwnFields {
        let listed = self.list_fields(layout);
        if !listed.is_known {
            return OwnFields::default();
        }
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

    fn find_object_type_key(
        &mut self,
        ty: CheckerTypeId,
        origin: ObjectOrigin,
    ) -> Option<ObjectTypeKey> {
        let origin = match origin {
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
        let outer = self.layouts.holder_in_progress;
        for &(name, member) in listed.iter() {
            self.layouts.holder_in_progress = self.holder_of_what_member_says(ty, member);
            let types = self.queries.listed_member_types(ty, member);
            is_kept = is_kept && self.queries.keeps_listed_member_types(ty, member);
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

    pub(super) fn define_names_of_type(&mut self, layout: LayoutId, ty: CheckerTypeId) {
        self.define_names_of_type_from(layout, ty, None);
    }

    fn define_names_of_type_from(
        &mut self,
        layout: LayoutId,
        ty: CheckerTypeId,
        origin: Option<ObjectOrigin>,
    ) {
        let Ok(members) = self.queries.listed_members(ty) else {
            return;
        };
        let listed = self.sort_listed_fields(ty, members);
        let place = self.find_place(ty, origin);
        let key = ObjectTypeKey::Names {
            flags: describe_flags(listed.iter().map(|field| listed_member_flags(field.1))),
            has_place: place.is_some(),
        };
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
        self.layouts
            .named_types
            .insert((layout, key), (index, place));
    }

    pub(super) fn define_object_type_layout(&mut self, layout: LayoutId, types: &[CheckerTypeId]) {
        let has_home = self.fragment.layout_key(layout).home_file().is_some();
        for &ty in types {
            let origin = match has_home {
                true => None,
                false => Some(self.queries.object_origin(ty)),
            };
            if matches!(origin, Some(ObjectOrigin::ObjectLiteral { .. })) {
                self.define_names_of_type_from(layout, ty, origin);
                continue;
            }
            if !has_home && self.is_said_by_an_earlier_file(ty) {
                continue;
            }
            let unstable_answers = self.queries.count_unstable_answers();
            let key = origin.and_then(|origin| self.find_object_type_key(ty, origin));
            let Some(found) = self.compute_fields_of_type(ty) else {
                continue;
            };
            let place = self.find_place(ty, origin);
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

    fn find_place(
        &mut self,
        ty: CheckerTypeId,
        origin: Option<ObjectOrigin>,
    ) -> Option<(FileId, u32)> {
        let declaration = self.find_declaration(ty, origin);
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
        if self.layouts.is_growing(layout) {
            for field in &mut definition.fields {
                field.declared = DeclaredType::untyped();
            }
        }
        self.fragment.define_object_type(layout, definition, key);
    }

    fn compare_name(&self, name: FieldName, description: &[u8]) -> Ordering {
        match name {
            FieldName::Text(text) => match description.split_first() {
                Some((kind, rest)) => KIND_OF_TEXT
                    .cmp(kind)
                    .then_with(|| self.queries.atom_bytes(text).cmp(rest)),
                None => Ordering::Greater,
            },
            FieldName::Key(key) => {
                let written = self.fragment.property_keys.get(key);
                match (written.kind, written.text, description.split_first()) {
                    (PropertyKeyKind::Text, Some(text), Some((kind, rest))) => KIND_OF_TEXT
                        .cmp(kind)
                        .then_with(|| self.fragment.strings.get(text).cmp(rest)),
                    _ => match self.describe_key(key) {
                        Some(described) => described.as_slice().cmp(description),
                        None => Ordering::Less,
                    },
                }
            }
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
                description.extend_from_slice(&key.call_number?.to_be_bytes());
                if let Some(text) = key.text {
                    description.extend_from_slice(self.fragment.strings.get(text));
                }
                description.extend_from_slice(&home.0.to_be_bytes());
            }
            PropertyKeyKind::PrivateName => return None,
        }
        Some(description)
    }

    pub(crate) fn untyped_layout(&mut self, members: &[Member]) -> LayoutId {
        self.untyped_layout_made_at(members, None)
    }

    fn untyped_layout_made_at(&mut self, members: &[Member], site: Option<ExprId>) -> LayoutId {
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
        let site = site.map(|site| [b"\xffmade at ".as_slice(), &site.0.to_le_bytes()].concat());
        let descriptions = sorted
            .iter()
            .map(|member| (member.description.as_slice(), member.kind));
        let layout = self.fragment.declare_layout(LayoutKey::UntypedLiteral {
            file: self.file,
            members: identity_of_keys(descriptions, site.as_deref()),
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

    pub(in crate::lower) fn layout_of_names_made_at(
        &mut self,
        site: ExprId,
        members: &[Member],
    ) -> LayoutId {
        if let Some(&layout) = self.layouts.literals.get(&site) {
            return layout;
        }
        let layout = self.untyped_layout_made_at(members, Some(site));
        self.layouts.literals.insert(site, layout);
        layout
    }

    pub(in crate::lower) fn is_field_name(&mut self, name: Atom) -> bool {
        let key = self.name_key(name);
        can_be_field(self, key)
    }

    pub(in crate::lower) fn is_name_on_object_prototype(&self, name: Atom) -> bool {
        let is_listed = self.inputs.builtin_names.get(name).is_some_and(|name| {
            !matches!(
                table::member(BuiltinId::ObjectPrototype, name),
                table::MemberLookup::Absent
            )
        });
        let added = self.inputs.names_added_to_builtins;
        is_listed || added.contains(&(BuiltinId::ObjectPrototype, name))
    }

    fn collect_names_copied_from_literal(&mut self, source: ExprId, members: &mut Members) {
        if let Ok(ty) = self.queries.expression_type(source)
            && matches!(
                self.queries.object_origin(ty),
                ObjectOrigin::ObjectLiteral { .. }
            )
        {
            self.collect_names_listed_by(ty, members);
        } else if let Some(ty) = self.find_literal_type_expected_of_parameter(source) {
            self.collect_names_listed_by(ty, members);
        }
    }

    pub(in crate::lower) fn find_literal_type_expected_of_parameter(
        &mut self,
        source: ExprId,
    ) -> Option<CheckerTypeId> {
        if self.is_checked() || !matches!(self.hir[source].kind, ExprKind::Ident(_)) {
            return None;
        }
        let named = self.bound.symbol_of_expr(source);
        if named.is_none() {
            return None;
        }
        let [Decl::Param(pattern)] = *self.bound.symbol(named).decls else {
            return None;
        };
        let expected = self.queries.binding_type(pattern).ok()?;
        let expected = self.queries.without_nullish(expected).ok()?;
        let is_written_literal = matches!(
            self.queries.object_origin(expected),
            ObjectOrigin::ObjectLiteral { .. }
        );
        is_written_literal.then_some(expected)
    }

    pub(in crate::lower) fn adds_names_to_literal_expected_of_parameter(
        &mut self,
        literal: ExprId,
    ) -> bool {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let mut rest = properties.iter();
        let Some(first) = rest.next().map(|first| hir[first]) else {
            return false;
        };
        if first.kind != PropKind::Spread {
            return false;
        }
        let Some(expected) = self.find_literal_type_expected_of_parameter(first.value) else {
            return false;
        };
        let mut copied = Members::new();
        self.collect_names_listed_by(expected, &mut copied);
        let copied: FxHashSet<PropertyKeyId> = copied.iter().map(|&(listed, _)| listed).collect();
        rest.any(|property| {
            let is_written_value = matches!(
                hir[property].kind,
                PropKind::Init | PropKind::Shorthand | PropKind::Method
            );
            match hir.runtime_property_key(property) {
                PropKey::Name(name) if is_written_value => !copied.contains(&self.name_key(name)),
                _ => false,
            }
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
                PropKind::Spread => {
                    self.collect_names_copied_from_literal(hir[property].value, &mut members);
                    continue;
                }
                PropKind::Getter | PropKind::Setter => continue,
            };
            match hir.runtime_property_key(property) {
                PropKey::Name(name) => members.push((self.name_key(name), kind)),
                PropKey::Computed(computed) => {
                    if let Some(key) = self.find_locked_symbol_key(computed) {
                        members.push((key, kind));
                    }
                }
                PropKey::None | PropKey::Private(_) => {}
            }
        }
        members
    }

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
        let layout = self.object_type_layout(ty)?;
        let is_written = matches!(
            self.queries.object_origin(ty),
            ObjectOrigin::Symbol(_)
                | ObjectOrigin::TypeLiteral { .. }
                | ObjectOrigin::MappedType { .. }
        );
        if is_written && self.is_checked() {
            let written = &mut self.layouts.written_types_of_literals;
            written.insert(literal, (layout, ty));
        }
        Some(layout)
    }

    fn collect_names_listed_by(&mut self, ty: CheckerTypeId, members: &mut Members) {
        let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
        while let Some(ty) = pending.pop() {
            let Ok(shape) = self.queries.type_shape(ty) else {
                continue;
            };
            match shape.kind {
                ShapeKind::Union(parts) => pending.extend(parts.iter().rev().copied()),
                ShapeKind::Object if !self.is_dictionary_type(ty) => {
                    let Ok(listed) = self.queries.listed_members(ty) else {
                        continue;
                    };
                    let mut listed: SmallVec<[ListedMember; 8]> = listed.iter().copied().collect();
                    listed.sort_by_key(|member| member.property_index);
                    for member in listed {
                        if let MemberName::String(name) = member.name {
                            members.push((self.name_key(name), ObjectMemberKind::Field));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn find_layout_of_assigned_names(&mut self, literal: ExprId) -> Option<LayoutId> {
        let hir = self.hir;
        let Parent::Expr(parent) = self.bound.parent_of_expr(literal) else {
            return None;
        };
        let ExprKind::Call(call) = hir[parent].kind else {
            return None;
        };
        let call = hir[call];
        let mut arguments = hir.ids(call.args);
        if arguments.next() != Some(literal) {
            return None;
        }
        let callee = hir.skip_type_assertions(call.callee);
        let builtin = self.builtins.builtin_of_expression(callee)?;
        if table::canonical_id(builtin) != BuiltinId::ObjectAssign {
            return None;
        }
        let mut members = self.collect_literal_members(literal);
        let number_written = members.len();
        for source in arguments {
            if matches!(hir[source].kind, ExprKind::Spread(_)) {
                return None;
            }
            if let Ok(ty) = self.queries.expression_type(source) {
                self.collect_names_listed_by(ty, &mut members);
            }
        }
        (members.len() > number_written).then(|| self.untyped_layout(&members))
    }

    fn find_layout_of_copied_names(&mut self, literal: ExprId) -> Option<LayoutId> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        let mut copied = Members::new();
        let mut holds_spread = false;
        for property in properties.iter() {
            if hir[property].kind == PropKind::Spread {
                holds_spread = true;
                self.collect_names_copied_from_literal(hir[property].value, &mut copied);
            }
        }
        if !holds_spread {
            return None;
        }
        let ty = self.queries.expression_type(literal).ok()?;
        let listed = self.queries.listed_members(ty);
        if listed.is_ok_and(|listed| !listed.is_empty()) {
            return None;
        }
        let members = self.collect_literal_members(literal);
        if members.is_empty() {
            return None;
        }
        if copied.is_empty() {
            self.layouts.literals_opened_at_once.insert(literal);
        }
        Some(self.untyped_layout_made_at(&members, Some(literal)))
    }

    pub(in crate::lower) fn is_opened_at_once(&self, literal: ExprId) -> bool {
        self.layouts.literals_opened_at_once.contains(&literal)
    }

    pub(in crate::lower) fn literal_layout(&mut self, literal: ExprId) -> LayoutId {
        if let Some(&layout) = self.layouts.literals.get(&literal) {
            return layout;
        }
        self.layouts.literals_in_progress.push(literal);
        let checked = self
            .find_contextual_layout(literal)
            .or_else(|| self.find_layout_of_assigned_names(literal))
            .or_else(|| self.find_layout_of_enclosing_list(literal))
            .or_else(|| self.find_layout_of_copied_names(literal))
            .or_else(|| self.find_checked_layout(literal));
        let layout = checked.unwrap_or_else(|| {
            let members = self.collect_literal_members(literal);
            self.untyped_layout(&members)
        });
        self.layouts.literals_in_progress.pop();
        self.layouts.literals.insert(literal, layout);
        layout
    }

    fn number_object_type(
        &mut self,
        ty: CheckerTypeId,
        literal: Option<ExprId>,
        origin: Option<ObjectOrigin>,
    ) -> Option<LayoutId> {
        let members = self.queries.listed_members(ty).ok()?;
        let (identity, is_empty) = self.describe_names(ty, members);
        let origin = origin.unwrap_or_else(|| self.queries.object_origin(ty));
        let home_of_functions = match (origin, literal) {
            (_, Some(expression)) => {
                literal_writes_functions_alone(self.hir, expression).then_some(self.file)
            }
            (ObjectOrigin::ObjectLiteral { file, expression }, None) => {
                literal_writes_functions_alone(self.queries.files().hir(file), expression)
                    .then_some(file)
            }
            (_, None) => None,
        };
        let identity = match home_of_functions {
            Some(file) if !is_empty => identity.in_file(file),
            _ => identity,
        };
        let origin = match (origin, literal) {
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

    fn number_object_type_once_in_task(
        &mut self,
        ty: CheckerTypeId,
        origin: Option<ObjectOrigin>,
    ) -> Option<LayoutId> {
        if let Some(known) = self.find_number_of_object_type(ty) {
            return known;
        }
        let unstable_answers = self.queries.count_unstable_answers();
        let layout = self.number_object_type(ty, None, origin);
        if self.queries.count_unstable_answers() == unstable_answers {
            self.keep_number_of_object_type(ty, layout);
        }
        layout
    }

    fn declare_object_type(
        &mut self,
        ty: CheckerTypeId,
        literal: Option<ExprId>,
        origin: Option<ObjectOrigin>,
    ) -> Option<LayoutId> {
        let layout = match literal {
            Some(_) => self.number_object_type(ty, literal, origin)?,
            None => self.number_object_type_once_in_task(ty, origin)?,
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
        let origin = origin.unwrap_or_else(|| self.queries.object_origin(ty));
        if let ObjectOrigin::Symbol(interface) = origin {
            let bases = self.queries.declared_base_types(interface);
            for base in bases.unwrap_or_default() {
                if let Some(extended) = self.object_type_layout(base)
                    && extended != layout
                {
                    self.fragment.add_supertype(layout, extended);
                }
            }
        }
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
        self.declare_object_type(ty, None, Some(origin))
    }

    fn find_declaration(
        &mut self,
        ty: CheckerTypeId,
        origin: Option<ObjectOrigin>,
    ) -> Option<(FileId, u32)> {
        let files = self.queries.files();
        match origin.unwrap_or_else(|| self.queries.object_origin(ty)) {
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

    fn unite_all_positions(&mut self, said: &[DeclaredType]) -> Option<DeclaredType> {
        let (&first, others) = said.split_first()?;
        if others.iter().all(|&other| other == first) {
            return Some(first);
        }
        let mut flags = first.flags;
        let mut in_any = first.flags;
        for other in others {
            flags = PositionFlags(flags.0 & other.flags.0);
            in_any |= other.flags;
        }
        if in_any.contains(PositionFlags::IS_EXPECTED) {
            flags |= PositionFlags::IS_EXPECTED;
        }
        let types = said.iter().map(|said| said.ty);
        Some(DeclaredType {
            ty: self.fragment.types.union_all(types),
            site: said.iter().find_map(|said| said.site),
            flags,
        })
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
        let found = has_names.then(|| self.queries.object_origin(ty));
        if found.is_some_and(|found| found != origin)
            && let Some(layout) = self.object_type_layout(ty)
        {
            return Some(layout);
        }
        self.declare_object_type(ty, Some(literal), found)
    }
}

fn reaches_member_alone(hir: &File<'_>, bound: &Bound<'_>, mention: ExprId) -> bool {
    match bound.parent_of_expr(mention) {
        Parent::Expr(user) => match hir[user].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                obj == mention && !is_called(hir, bound, user)
            }
            ExprKind::Binary {
                op: BinOp::In,
                right,
                ..
            } => right == mention,
            _ => false,
        },
        Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
            PatKind::Object(members) => members.iter().all(|member| !hir[member].is_rest),
            _ => false,
        },
        _ => false,
    }
}

fn is_called(hir: &File<'_>, bound: &Bound<'_>, mut callee: ExprId) -> bool {
    loop {
        let Parent::Expr(user) = bound.parent_of_expr(callee) else {
            return false;
        };
        if hir.type_assertion_operand(user).is_none() {
            return match hir[user].kind {
                ExprKind::Call(call) => hir[call].callee == callee,
                ExprKind::TaggedTemplate(_) => true,
                _ => false,
            };
        }
        callee = user;
    }
}

fn find_declared_order(listed: &[SortedMember]) -> Vec<u32> {
    order_fields_by(listed.len(), |field| listed[field].1.property_index)
}

fn order_fields_by(number_of_fields: usize, place_in_source: impl Fn(usize) -> u32) -> Vec<u32> {
    if (1..number_of_fields).all(|field| place_in_source(field - 1) <= place_in_source(field)) {
        return Vec::new();
    }
    let mut order: Vec<u32> = (0..number_of_fields as u32).collect();
    order.sort_by_u32(|&field| place_in_source(field as usize));
    order
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

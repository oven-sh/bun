use core::cell::{Cell, RefCell};
use core::cmp::Ordering;
use std::rc::Rc;

use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::check::aot::{
    ListedMember, MemberName, ObjectMemberKind, ObjectOrigin, ShapeKind, TypeIdentity, WrittenType,
};
use bun_sema::hir::{ExprId, ExprKind, PropKey, PropKind};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};

use super::{
    DefinedObjectType, HAS_PLACE, LAST_DEFINITION_LEVEL, NAMES_THE_SAME_IN_EVERY_FILE,
    NamesOfObjectType, ObjectTypeKey, OwnFields,
};
use crate::builtins::resolve::SourceDialect;
use crate::ir::generated::{
    Field, FieldFlags, Layout, LayoutKind, LimitId, NameClass, PositionFlags,
};
use crate::ir::{
    DeclaredType, LayoutId, LayoutKey, PropertyKeyId, PropertyKeyKind, StringId, WellKnownSymbol,
    classify_name,
};
use crate::lower::{CheckerTypeId, FileLowering, SourceKind, convert, member, positions, types};
use crate::modules::ModuleRef;

const _: () = assert!(PropertyKeyKind::COUNT <= 1 << u8::BITS);
const _: () = assert!(WellKnownSymbol::COUNT <= 1 << u8::BITS);

const MAX_ROUNDS_OF_FIELD_TYPES: usize = 4;

type Member = (PropertyKeyId, ObjectMemberKind);
type Members = SmallVec<[Member; 8]>;
type KeyDescription = SmallVec<[u8; 24]>;

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
    // The member of each type that has the layout, in the order the types were met.
    members: RefCell<SmallVec<[(CheckerTypeId, ListedMember); 1]>>,
    // What the first of these members declare, and how many they are.
    declared: Cell<(Option<DeclaredType>, usize)>,
}

impl ListedField {
    fn new(name: FieldName, ty: CheckerTypeId, member: ListedMember) -> ListedField {
        ListedField {
            name,
            flags: Cell::new(member_flags(member.kind, member.is_optional)),
            members: RefCell::new(smallvec![(ty, member)]),
            declared: Cell::new((None, 0)),
        }
    }
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
        let found = match describe_key(file, key) {
            Some(description) => self
                .fields
                .binary_search_by(|field| compare_name(file, field.name, &description))
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

    fn add_type(&self, fields_of_type: Vec<ListedField>) {
        debug_assert_eq!(
            self.fields.len(),
            fields_of_type.len(),
            "types with one layout have the same names"
        );
        for (field, field_of_type) in self.fields.iter().zip(fields_of_type) {
            debug_assert_eq!(
                field.name, field_of_type.name,
                "types with one layout have the same names"
            );
            if !field_of_type.flags.get().contains(FieldFlags::IS_REQUIRED) {
                field
                    .flags
                    .set(field.flags.get().without(FieldFlags::IS_REQUIRED));
            }
            field
                .members
                .borrow_mut()
                .extend(field_of_type.members.into_inner());
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

fn is_object_shape(kind: ShapeKind<'_>) -> bool {
    matches!(kind, ShapeKind::Object)
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

fn describe_names(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    members: &[ListedMember],
) -> NamesOfObjectType {
    let fields = sort_listed_fields(file, ty, members);
    let descriptions: Vec<(KeyDescription, ObjectMemberKind)> = fields
        .iter()
        .filter_map(|field| {
            Some((
                describe_name(file, field.name)?,
                field.members.borrow()[0].1.kind,
            ))
        })
        .collect();
    let names = descriptions
        .iter()
        .map(|(name, kind)| (name.as_slice(), *kind));
    NamesOfObjectType {
        identity: TypeIdentity::of_untyped_members(names),
        is_empty: descriptions.is_empty(),
        flags: describe_flags(fields.iter().map(|field| field.flags.get())),
    }
}

// A layout says where each property of an object lies, so it is known by the set of their names.
fn declare_object_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    literal: Option<ExprId>,
) -> Option<LayoutId> {
    let members = file.queries.listed_members(ty).ok()?;
    let names = match file.inputs.defined_object_types.find_names(ty) {
        Some(names) => names,
        None => {
            let names = describe_names(file, ty, members);
            file.layouts.described_names.push((ty, names));
            names
        }
    };
    // The names of an object that is born without a known name, `{}` or `{ a: 1, ...anything }`, are those that are stored later, which differ from one place of birth to the next.
    let origin = match (file.queries.object_origin(ty), literal) {
        _ if !names.is_empty => ObjectOrigin::Computed,
        (_, Some(expression)) => ObjectOrigin::ObjectLiteral {
            file: file.file,
            expression,
        },
        (origin @ ObjectOrigin::ObjectLiteral { .. }, None) => origin,
        (_, None) => ObjectOrigin::Computed,
    };
    let layout = file.fragment.declare_layout(LayoutKey::ObjectType {
        origin,
        instantiation: names.identity,
    });
    if file.layouts.is_growing(layout) || !file.layouts.add_source_type(layout, ty) {
        return Some(layout);
    }
    if grows_without_end(file, ty) {
        file.layouts.mark_growing(layout);
        return Some(layout);
    }
    if let Some(listed) = file.layouts.stored_listed_fields(layout)
        && listed.is_known
    {
        listed.add_type(sort_listed_fields(file, ty, members));
    }
    add_edges_to_extended_types(file, layout, ty);
    add_edge_from_library_class(file, layout, ty);
    Some(layout)
}

// Every member of such a type is a type that nothing has made yet, with the same layout, and looking at its members makes the next ones.
fn grows_without_end(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    const LONGEST_PATH: usize = 64;
    let Some(holder) = file
        .layouts
        .holder_in_progress
        .filter(|&holder| holder != ty)
    else {
        return false;
    };
    file.layouts.holders.insert(ty, holder);
    let mut path = vec![ty];
    while let Some(&holder) = file.layouts.holders.get(&path[path.len() - 1])
        && path.len() < LONGEST_PATH
    {
        path.push(holder);
    }
    path.reverse();
    file.queries.grows_along(&path)
}

fn create_position_of_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    member: ListedMember,
) -> DeclaredType {
    let outer = file.layouts.holder_in_progress.replace(ty);
    let types = file.queries.listed_member_types(ty, member);
    let declared = positions::create_member_position(file, types);
    file.layouts.holder_in_progress = outer;
    match member.is_optional {
        true => positions::add_undefined(file, declared),
        false => declared,
    }
}

// What passes for an interface passes for what the interface extends.
fn add_edges_to_extended_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    ty: CheckerTypeId,
) {
    let ObjectOrigin::Symbol(interface) = file.queries.object_origin(ty) else {
        return;
    };
    for base in file
        .queries
        .declared_base_types(interface)
        .unwrap_or_default()
    {
        if let Some(extended) = object_type_layout(file, base)
            && extended != layout
        {
            file.fragment.add_supertype(layout, extended);
        }
    }
}

// `IncomingMessage` of a declaration file: what has that type is made by the function of Bun's own module of that name.
fn add_edge_from_library_class(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    ty: CheckerTypeId,
) {
    if file.source != SourceKind::Program {
        return;
    }
    for declaration in file.queries.library_declarations_of_type(ty) {
        let made = file
            .fragment
            .declare_layout(LayoutKey::Library(declaration));
        super::add_conversion(file, made, layout);
    }
}

fn find_object_type_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<LayoutId> {
    let shape = file.queries.type_shape(ty).ok()?;
    if !is_object_shape(shape.kind) || super::is_dictionary_type(file, ty) {
        return None;
    }
    let origin = file.queries.object_origin(ty);
    if let ObjectOrigin::ObjectLiteral {
        file: home,
        expression,
    } = origin
        && home == file.file
        && matches!(file.hir[expression].kind, ExprKind::Object(_))
        && !file.layouts.literals_in_progress.contains(&expression)
    {
        return Some(literal_layout(file, expression));
    }
    declare_object_type(file, ty, None)
}

pub(crate) fn object_type_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<LayoutId> {
    if let Some(&layout) = file.layouts.object_types.get(&ty) {
        return layout;
    }
    let layout = find_object_type_layout(file, ty);
    file.layouts.object_types.insert(ty, layout);
    layout
}

fn find_named_declaration(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    is_shown: bool,
) -> Declaration {
    // A bundle holds no name of a type. The report of a mismatch shows them.
    let options = file.inputs.options;
    if !is_shown || (options.minifies_identifiers && !options.reports_type_mismatches) {
        return Declaration {
            name: None,
            site: file.queries.type_name_site(ty),
        };
    }
    match file.queries.type_display_name(ty) {
        Some(display_name) => Declaration {
            name: Some(file.intern_bytes(&display_name.text)),
            site: Some((display_name.file, display_name.position)),
        },
        None => Declaration::default(),
    }
}

fn find_declaration(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    is_shown: bool,
) -> Declaration {
    let files = file.queries.files();
    match file.queries.object_origin(ty) {
        ObjectOrigin::Symbol(_) => find_named_declaration(file, ty, is_shown),
        ObjectOrigin::TypeLiteral { file: home, node }
        | ObjectOrigin::MappedType { file: home, node } => Declaration {
            name: None,
            site: Some((home, files.hir(home)[node].pos)),
        },
        ObjectOrigin::ObjectLiteral {
            file: home,
            expression,
        } => Declaration {
            name: None,
            site: Some((home, files.hir(home)[expression].pos)),
        },
        ObjectOrigin::Computed => Declaration::default(),
    }
}

fn find_position_in_file(file: &mut FileLowering<'_, '_, '_, '_>, layout: LayoutId) -> u32 {
    let Some(&ty) = file.layouts.source_types(layout).first() else {
        debug_assert!(false, "object type layout without a source type");
        return 0;
    };
    match find_declaration(file, ty, false).site {
        Some((home, position)) if home == file.file => position,
        Some(_) | None => 0,
    }
}

fn collect_listed_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    members: &[ListedMember],
) -> Vec<ListedField> {
    let mut listed = Vec::with_capacity(members.len());
    let mut names = FxHashSet::with_capacity_and_hasher(members.len(), Default::default());
    for &listed_member in members {
        let name = match (listed_member.name, file.source.dialect()) {
            (MemberName::String(name), SourceDialect::Program) => FieldName::Text(name),
            (MemberName::String(name), SourceDialect::Runtime) => {
                FieldName::Key(member::name_key(file, name))
            }
            (MemberName::Symbol(name), _) => match member::created_symbol_key(file, name) {
                Some(key) => FieldName::Key(key),
                None => continue,
            },
            (MemberName::Private(_), _) => continue,
        };
        let can_be_field = match name {
            FieldName::Text(text) => is_field_name(classify_name(file.queries.atom_bytes(text))),
            FieldName::Key(key) => can_be_field(file, key),
        };
        if can_be_field && names.insert(name) {
            listed.push(ListedField::new(name, ty, listed_member));
        }
    }
    listed
}

fn find_key(file: &mut FileLowering<'_, '_, '_, '_>, name: FieldName) -> PropertyKeyId {
    match name {
        FieldName::Text(text) => file.atom_key(text),
        FieldName::Key(key) => key,
    }
}

// In the one order that every type with these names gives: field `i` of one is field `i` of the other.
fn sort_listed_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    members: &[ListedMember],
) -> Vec<ListedField> {
    if let Some(sorted) = file.layouts.sorted_members.get(&ty) {
        return sorted
            .iter()
            .map(|&(name, member)| ListedField::new(name, ty, member))
            .collect();
    }
    let mut fields = collect_listed_fields(file, ty, members);
    fields.sort_by_cached_key(|field| describe_name(file, field.name));
    fields.truncate(file.inputs.limits.get(LimitId::FieldsInKeyOrder) as usize);
    let sorted = fields
        .iter()
        .map(|field| (field.name, field.members.borrow()[0].1))
        .collect();
    file.layouts.sorted_members.insert(ty, sorted);
    fields
}

fn compute_listed_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
) -> ListedFields {
    let types: SmallVec<[CheckerTypeId; 4]> =
        SmallVec::from_slice(file.layouts.source_types(layout));
    debug_assert!(
        !types.is_empty(),
        "object type layout without a source type"
    );
    let mut listed = ListedFields::default();
    for (index, &ty) in types.iter().enumerate() {
        let Ok(members) = file.queries.listed_members(ty) else {
            return ListedFields::default();
        };
        let fields_of_type = sort_listed_fields(file, ty, members);
        if index > 0 {
            listed.add_type(fields_of_type);
            continue;
        }
        let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
        if members.len() as u64 > limit && fields_of_type.len() as u64 == limit {
            let position = find_position_in_file(file, layout);
            file.gave_up(LimitId::FieldsInKeyOrder, position);
        }
        listed.fields = fields_of_type;
        listed.is_known = true;
    }
    listed
}

pub(super) fn list_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
) -> Rc<ListedFields> {
    if let Some(listed) = file.layouts.stored_listed_fields(layout) {
        return listed;
    }
    let listed = Rc::new(compute_listed_fields(file, layout));
    file.layouts.store_listed_fields(layout, Rc::clone(&listed));
    listed
}

// Nothing tests a store into an expected position, so a field is proven only where every type that has it proves it.
fn unite_positions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    left: DeclaredType,
    right: DeclaredType,
) -> DeclaredType {
    if left == right {
        return left;
    }
    let in_either = left.flags | right.flags;
    let mut flags = PositionFlags(left.flags.0 & right.flags.0);
    if in_either.contains(PositionFlags::IS_EXPECTED) {
        flags |= PositionFlags::IS_EXPECTED;
    }
    DeclaredType {
        ty: file.fragment.types.union(left.ty, right.ty),
        site: left.site.or(right.site),
        flags,
    }
}

// The checker's type of `a?: number` is `number`.
pub(super) fn listed_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
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
        if file.layouts.is_growing(layout) {
            return DeclaredType::untyped();
        }
        let declared = create_position_of_member(file, ty, member);
        united = Some(match united {
            Some(united) => unite_positions(file, united, declared),
            None => declared,
        });
    }
    if file.layouts.is_growing(layout) {
        return DeclaredType::untyped();
    }
    field.declared.set((united, number_united + members.len()));
    united.unwrap_or_else(DeclaredType::untyped)
}

pub(super) fn compute_object_type_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
) -> OwnFields {
    let listed = list_fields(file, layout);
    if !listed.is_known {
        return OwnFields::default();
    }
    // The type of a field may be the first mention of another type with this very layout (`interface Even { other: Odd }`), which then adds to the fields that have been looked at.
    for _ in 0..MAX_ROUNDS_OF_FIELD_TYPES {
        let number_of_types = file.layouts.source_types(layout).len();
        for index in 0..listed.fields.len() as u32 {
            listed_field_position(file, layout, &listed, index);
        }
        if file.layouts.source_types(layout).len() == number_of_types {
            break;
        }
    }
    let is_growing = file.layouts.is_growing(layout);
    let mut fields = OwnFields::default();
    for field in &listed.fields {
        let declared = field.declared.get().0.filter(|_| !is_growing);
        fields.add(Field {
            key: Some(find_key(file, field.name)),
            declared: declared.unwrap_or_else(DeclaredType::untyped),
            flags: field.flags.get(),
            ..Field::default()
        });
    }
    fields.finish()
}

fn find_object_type_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<ObjectTypeKey> {
    // The identity of a computed type leaves out what nobody has written: the type of a method of a literal, of a rest copy.
    let origin = match file.queries.object_origin(ty) {
        ObjectOrigin::Computed => return None,
        origin @ (ObjectOrigin::Symbol(_)
        | ObjectOrigin::TypeLiteral { .. }
        | ObjectOrigin::MappedType { .. }
        | ObjectOrigin::ObjectLiteral { .. }) => origin,
    };
    Some(ObjectTypeKey {
        origin,
        identity: file.queries.type_identity(ty).ok()?,
        is_checked: file.is_checked(),
    })
}

struct FieldsOfType {
    fields: Vec<Field>,
    declared_order: Vec<u32>,
    name_the_same_in_every_file: bool,
}

// The fields in the order in which the type lists its members: the order that a text written for the type is likely to have.
fn find_declared_order(listed: &[ListedField]) -> Vec<u32> {
    let mut order: Vec<u32> = (0..listed.len() as u32).collect();
    order.sort_by_key(|&field| listed[field as usize].members.borrow()[0].1.property_index);
    match order.iter().zip(0..).all(|(&field, place)| field == place) {
        true => Vec::new(),
        false => order,
    }
}

fn compute_fields_of_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    ty: CheckerTypeId,
    is_told_to_other_files: bool,
) -> Option<FieldsOfType> {
    let members = file.queries.listed_members(ty).ok()?;
    let listed = sort_listed_fields(file, ty, members);
    let mut fields = Vec::with_capacity(listed.len());
    let mut name_the_same_in_every_file = is_told_to_other_files;
    let outer = file.layouts.holder_in_progress.replace(ty);
    for field in &listed {
        let (_, member) = field.members.borrow()[0];
        let types = file.queries.listed_member_types(ty, member);
        name_the_same_in_every_file &=
            types.checked.is_ok() && !matches!(types.written, WrittenType::GaveUp(_));
        for named in [types.written.written(), types.checked.ok()]
            .into_iter()
            .flatten()
        {
            name_the_same_in_every_file =
                name_the_same_in_every_file && types::is_mapped_alike_in_every_file(file, named);
        }
        let declared = positions::create_member_position(file, types);
        let declared = match member.is_optional {
            true => positions::add_undefined(file, declared),
            false => declared,
        };
        fields.push(Field {
            key: Some(find_key(file, field.name)),
            declared,
            flags: field.flags.get(),
            ..Field::default()
        });
    }
    file.layouts.holder_in_progress = outer;
    // Whether the file had found out by now hangs on what else it has looked at.
    if file.layouts.is_growing(layout) {
        name_the_same_in_every_file = false;
        for field in &mut fields {
            field.declared = DeclaredType::untyped();
        }
    }
    Some(FieldsOfType {
        fields,
        declared_order: find_declared_order(&listed),
        name_the_same_in_every_file,
    })
}

// All that such a definition says: two types that say the same have one key.
fn create_key_of_names(flags: TypeIdentity, has_place: bool) -> ObjectTypeKey {
    ObjectTypeKey {
        origin: ObjectOrigin::Computed,
        identity: flags,
        is_checked: has_place,
    }
}

// Where the type is declared, if that is a file with a module in the program.
fn find_place(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Option<(FileId, u32)> {
    let (home, position) = find_declaration(file, ty, false).site?;
    let has_module = file.queries.files().is_compiled(home) && !file.inputs.is_left_out(home);
    has_module.then_some((home, position))
}

// The link drops the name of every definition of a layout but the one that it shows: the first with a place, or the first.
fn can_be_shown(file: &FileLowering<'_, '_, '_, '_>, layout: LayoutId, has_place: bool) -> bool {
    let is_first_of_file = match has_place {
        true => !file.layouts.placed_layouts.contains(&layout),
        false => !file.fragment.is_layout_defined(layout),
    };
    let layout_key = file.fragment.layout_key(layout);
    let defined = file.inputs.defined_object_types;
    is_first_of_file && !defined.is_layout_defined_by_earlier_file(layout_key, file.file, has_place)
}

fn flag_place(file: &mut FileLowering<'_, '_, '_, '_>, layout: LayoutId, has_place: bool) -> u8 {
    if !has_place {
        return 0;
    }
    file.layouts.placed_layouts.insert(layout);
    HAS_PLACE
}

// `false`: the file or an earlier one has said the same of the layout.
fn claim_names(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    key: ObjectTypeKey,
) -> bool {
    let defined = file.inputs.defined_object_types;
    let Some(defined_type) = DefinedObjectType::new(file.fragment.layout_key(layout), key) else {
        return false;
    };
    file.layouts.named_types.insert((layout, key))
        && !defined.is_defined_by_earlier_file(&defined_type, file.file)
}

// Which names the type has and which it requires, as the listed members show, and not what they hold.
fn define_names_of_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    ty: CheckerTypeId,
) {
    // Most types were put in order by an earlier file, and most of those say what another type has said.
    let has_place = find_place(file, ty).is_some();
    let known = file.inputs.defined_object_types.find_names(ty);
    if let Some(names) = known
        && !claim_names(file, layout, create_key_of_names(names.flags, has_place))
    {
        return;
    }
    let Ok(members) = file.queries.listed_members(ty) else {
        return;
    };
    let listed = sort_listed_fields(file, ty, members);
    let fields: Vec<Field> = listed
        .iter()
        .map(|field| Field {
            key: Some(find_key(file, field.name)),
            declared: DeclaredType::unsaid(),
            flags: field.flags.get(),
            ..Field::default()
        })
        .collect();
    let key = create_key_of_names(
        describe_flags(fields.iter().map(|field| field.flags)),
        has_place,
    );
    if known.is_none() && !claim_names(file, layout, key) {
        return;
    }
    let is_shown = can_be_shown(file, layout, has_place);
    let definition =
        create_layout_of_type(file, ty, fields, find_declared_order(&listed), is_shown);
    let level = LAST_DEFINITION_LEVEL | flag_place(file, layout, has_place);
    file.fragment
        .define_object_type(layout, definition, Some((key, level)));
}

// One definition for each type, which says what that type declares: the link unites them.
pub(super) fn define_object_type_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    types: &[CheckerTypeId],
    level: u8,
    says_types: bool,
) {
    // A layout with a home has one type, and the link takes what the home says.
    let has_home = file.fragment.layout_key(layout).home_file().is_some();
    if !has_home && !says_types {
        for &ty in types {
            define_names_of_type(file, layout, ty);
        }
        return;
    }
    for &ty in types {
        let key = match has_home {
            true => None,
            false => find_object_type_key(file, ty),
        };
        let layout_key = file.fragment.layout_key(layout);
        let defined = file.inputs.defined_object_types;
        let defined_type = key.and_then(|key| DefinedObjectType::new(layout_key, key));
        let is_defined_by_earlier_file =
            defined_type.is_some_and(|ty| defined.is_defined_by_earlier_file(&ty, file.file));
        if is_defined_by_earlier_file
            && (level == LAST_DEFINITION_LEVEL
                || defined_type
                    .is_some_and(|ty| defined.has_earlier_file_gone_on_for_all(&ty, file.file)))
        {
            continue;
        }
        let is_told_to_other_files =
            defined_type.is_some() && !is_defined_by_earlier_file && level < LAST_DEFINITION_LEVEL;
        if let Some(computed) = compute_fields_of_type(file, layout, ty, is_told_to_other_files)
            && !is_defined_by_earlier_file
        {
            let names_the_same = match computed.name_the_same_in_every_file {
                true => NAMES_THE_SAME_IN_EVERY_FILE,
                false => 0,
            };
            let has_place = !has_home && find_place(file, ty).is_some();
            let is_shown = can_be_shown(file, layout, has_place);
            let key = key.map(|key| {
                (
                    key,
                    level | names_the_same | flag_place(file, layout, has_place),
                )
            });
            let definition =
                create_layout_of_type(file, ty, computed.fields, computed.declared_order, is_shown);
            file.fragment.define_object_type(layout, definition, key);
        }
    }
}

// Which types with the layout a file meets first hangs on what it leaves to earlier files, so a definition is shown under the name of its own type.
fn create_layout_of_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    fields: Vec<Field>,
    declared_order: Vec<u32>,
    is_shown: bool,
) -> Layout {
    let declaration = find_declaration(file, ty, is_shown);
    let (module, position) = match declaration.site {
        Some((home, position))
            if file.queries.files().is_compiled(home) && !file.inputs.is_left_out(home) =>
        {
            let module = file.fragment.declare_module(ModuleRef::File(home));
            (Some(module), position)
        }
        Some(_) | None => (None, 0),
    };
    Layout {
        kind: LayoutKind::Record,
        name: declaration.name,
        module,
        position,
        fields,
        declared_order,
        ..Layout::default()
    }
}

fn describe_name(file: &FileLowering<'_, '_, '_, '_>, name: FieldName) -> Option<KeyDescription> {
    match name {
        FieldName::Text(text) => {
            let mut description = KeyDescription::new();
            description.push(PropertyKeyKind::Text.to_wire() as u8);
            description.extend_from_slice(file.queries.atom_bytes(text));
            Some(description)
        }
        FieldName::Key(key) => describe_key(file, key),
    }
}

fn compare_name(
    file: &FileLowering<'_, '_, '_, '_>,
    name: FieldName,
    description: &[u8],
) -> Ordering {
    match name {
        FieldName::Text(text) => {
            let kind = [PropertyKeyKind::Text.to_wire() as u8];
            kind.iter()
                .chain(file.queries.atom_bytes(text))
                .cmp(description)
        }
        FieldName::Key(key) => match describe_key(file, key) {
            Some(described) => described.as_slice().cmp(description),
            None => Ordering::Less,
        },
    }
}

fn describe_key(file: &FileLowering<'_, '_, '_, '_>, key: PropertyKeyId) -> Option<KeyDescription> {
    let key = file.fragment.property_keys.get(key);
    let mut description = KeyDescription::new();
    description.push(key.kind.to_wire() as u8);
    match key.kind {
        PropertyKeyKind::Text | PropertyKeyKind::EnginePrivateName => {
            description.extend_from_slice(file.fragment.strings.get(key.text?));
        }
        PropertyKeyKind::WellKnownSymbol => description.push(key.symbol?.to_wire() as u8),
        PropertyKeyKind::CreatedSymbol => {
            let ModuleRef::File(home) = file.fragment.module_ref(key.module?) else {
                return None;
            };
            description.extend_from_slice(&home.0.to_be_bytes());
            description.extend_from_slice(&key.position?.to_be_bytes());
        }
        PropertyKeyKind::PrivateName => return None,
    }
    Some(description)
}

fn truncate_to_field_limit(
    file: &mut FileLowering<'_, '_, '_, '_>,
    members: &mut Vec<UntypedMember>,
    position: u32,
) {
    let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
    if members.len() as u64 <= limit {
        return;
    }
    let mut source_indexes: Vec<usize> = Vec::with_capacity(members.len());
    source_indexes.extend(members.iter().map(|member| member.source_index));
    source_indexes.sort_unstable();
    let first_dropped = source_indexes[limit as usize];
    members.retain(|member| member.source_index < first_dropped);
    file.gave_up(LimitId::FieldsInKeyOrder, position);
}

fn sort_untyped_members(
    file: &mut FileLowering<'_, '_, '_, '_>,
    members: &[Member],
    position: u32,
) -> Vec<UntypedMember> {
    let mut sorted = Vec::with_capacity(members.len());
    for (source_index, &(key, kind)) in members.iter().enumerate() {
        match kind {
            ObjectMemberKind::Field | ObjectMemberKind::Method => {}
            _ => continue,
        }
        if !can_be_field(file, key) {
            continue;
        }
        let Some(description) = describe_key(file, key) else {
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
    truncate_to_field_limit(file, &mut sorted, position);
    sorted
}

fn untyped_layout_at(
    file: &mut FileLowering<'_, '_, '_, '_>,
    members: &[Member],
    position: u32,
) -> LayoutId {
    let sorted = sort_untyped_members(file, members, position);
    let descriptions = sorted
        .iter()
        .map(|member| (member.description.as_slice(), member.kind));
    let layout = file.fragment.declare_layout(LayoutKey::UntypedLiteral {
        file: file.file,
        members: TypeIdentity::of_untyped_members(descriptions),
    });
    if file.fragment.is_layout_defined(layout) {
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
    let fields = file.layouts.store_fields(layout, fields.finish());
    let definition = Layout {
        kind: LayoutKind::Record,
        module: Some(file.module_id()),
        fields: fields.as_slice().to_vec(),
        ..Layout::default()
    };
    file.fragment.define_layout(layout, definition);
    layout
}

pub(crate) fn untyped_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    members: &[(PropertyKeyId, ObjectMemberKind)],
) -> LayoutId {
    untyped_layout_at(file, members, 0)
}

fn collect_literal_members(file: &mut FileLowering<'_, '_, '_, '_>, literal: ExprId) -> Members {
    let hir = file.hir;
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
            PropKey::Name(name) => members.push((member::name_key(file, name), kind)),
            PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => {}
        }
    }
    members
}

fn find_contextual_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> Option<(LayoutId, CheckerTypeId)> {
    if let Some(found) = super::birth_targets::find_target_layout(file, literal) {
        return Some(found);
    }
    let ty = file.queries.contextual_type(literal).ok()??;
    Some((object_type_layout(file, ty)?, ty))
}

fn find_layout_of_enclosing_list(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> Option<(LayoutId, CheckerTypeId)> {
    let Parent::Expr(list) = file.bound.parent_of_expr(literal) else {
        return None;
    };
    if !matches!(file.hir[list].kind, ExprKind::Array(_)) {
        return None;
    }
    let list_type = file.queries.expression_type(list).ok()?;
    let element = convert::find_array_element_type(file, list_type)?;
    let ObjectOrigin::ObjectLiteral {
        file: home,
        expression,
    } = file.queries.object_origin(element)
    else {
        return None;
    };
    if home != file.file || expression == literal {
        return None;
    }
    Some((object_type_layout(file, element)?, element))
}

fn find_checked_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> Option<(LayoutId, CheckerTypeId)> {
    let ty = file.queries.expression_type(literal).ok()?;
    let origin = ObjectOrigin::ObjectLiteral {
        file: file.file,
        expression: literal,
    };
    let has_names = file
        .queries
        .listed_members(ty)
        .is_ok_and(|members| !members.is_empty());
    if has_names
        && file.queries.object_origin(ty) != origin
        && let Some(layout) = object_type_layout(file, ty)
    {
        return Some((layout, ty));
    }
    Some((declare_object_type(file, ty, Some(literal))?, ty))
}

fn find_layout_of_checked_literal(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> Option<LayoutId> {
    let mut found = find_contextual_layout(file, literal);
    if found.is_none() {
        found = find_layout_of_enclosing_list(file, literal);
    }
    if found.is_none() {
        found = find_checked_layout(file, literal);
    }
    Some(found?.0)
}

fn compute_literal_layout(file: &mut FileLowering<'_, '_, '_, '_>, literal: ExprId) -> LayoutId {
    if let Some(layout) = find_layout_of_checked_literal(file, literal) {
        return layout;
    }
    let members = collect_literal_members(file, literal);
    let position = file.hir[literal].pos;
    untyped_layout_at(file, &members, position)
}

pub(in crate::lower) fn literal_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> LayoutId {
    if let Some(&layout) = file.layouts.literals.get(&literal) {
        return layout;
    }
    file.layouts.literals_in_progress.push(literal);
    let layout = compute_literal_layout(file, literal);
    file.layouts.literals_in_progress.pop();
    file.layouts.literals.insert(literal, layout);
    layout
}

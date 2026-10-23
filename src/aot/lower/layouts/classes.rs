use bun_sema::atom::{Atom, written_name};
use bun_sema::bind::{FnOwner, Parent};
use bun_sema::check::aot::{
    ClassDeclaration, ClassMemberSource, ClassParent, ClassRef, ClassShape, FunctionRef,
    MemberLookup, MemberName, ObjectMember, ObjectMemberKind, PositionTypes, ShapeKind,
};
use bun_sema::hir::{self, ClassId, ExprKind, Flags, FnId, FnKind, MemberId, PropKey};
use bun_sema::program::FileId;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

use super::OwnFields;
use super::object_types::can_be_field;
use crate::diagnostic_codes::Code;
use crate::ir::generated::{
    Field, FieldFlags, Layout, LayoutFlags, LayoutKind, LimitId, StaticField, TypeSiteKind,
};
use crate::ir::{
    ClassSlot, DeclaredType, FunctionId, FunctionKey, LayoutId, LayoutKey, Mapped, OpaqueKind,
    PositionFlags, PropertyKey, PropertyKeyId, Type, VariableKey,
};
use crate::lower::module::LibraryFunctionForm;
use crate::lower::positions::{self, SiteOrigin};
use crate::lower::types::map_type_at;
use crate::lower::{
    CheckerTypeId, FileLowering, SourceKind, class, convert, function_types, member, module, scope,
};

type Supertypes = SmallVec<[LayoutId; 4]>;

#[derive(Copy, Clone)]
struct FieldOwner {
    file: FileId,
    layout: LayoutId,
}

struct NamedField {
    key: PropertyKeyId,
    flags: FieldFlags,
    types: PositionTypes,
    has_declared_type: bool,
    is_optional_member: bool,
    position: u32,
}

#[derive(Copy, Clone)]
enum HeritageShape {
    ClassConstructor(ClassRef),
    Class(ClassRef),
    ObjectType,
    NoLayout,
}

fn hidden_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: LayoutId,
    text: &[u8],
) -> PropertyKeyId {
    let text = file.intern_bytes(text);
    let key = PropertyKey::from_private_name(text, owner);
    file.fragment.property_keys.intern(key)
}

pub(super) fn private_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: LayoutId,
    name: Atom,
) -> PropertyKeyId {
    let text = written_name(file.queries.atom_bytes(name));
    hidden_key(file, owner, text)
}

fn brand_field(file: &mut FileLowering<'_, '_, '_, '_>, layout: LayoutId) -> Field {
    let token = Type::opaque(OpaqueKind::ClassToken);
    let token = file.fragment.types.intern(token);
    Field {
        key: Some(hidden_key(file, layout, b"#")),
        declared: DeclaredType::from_compiler(token),
        flags: FieldFlags::IS_REQUIRED
            | FieldFlags::IS_PRIVATE
            | FieldFlags::IS_HIDDEN
            | FieldFlags::IS_BRAND
            | FieldFlags::IS_IMMUTABLE,
        ..Field::default()
    }
}

fn class_position(node: &hir::Class) -> u32 {
    match node.name.is_some() {
        true => node.name_pos,
        false => node.start,
    }
}

fn find_field_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: LayoutId,
    name: MemberName,
) -> Option<(PropertyKeyId, FieldFlags)> {
    match name {
        MemberName::String(name) => {
            let key = member::name_key(file, name);
            can_be_field(file, key).then_some((key, FieldFlags::default()))
        }
        MemberName::Private(name) => {
            let key = private_key(file, owner, name);
            Some((key, FieldFlags::IS_PRIVATE))
        }
        MemberName::Symbol(name) => {
            let key = member::created_symbol_key(file, name)?;
            Some((key, FieldFlags::default()))
        }
    }
}

fn collect_accessor_keys(
    file: &mut FileLowering<'_, '_, '_, '_>,
    shape: &ClassShape<'_>,
) -> SmallVec<[PropertyKeyId; 8]> {
    let mut keys = SmallVec::new();
    for entry in shape.members.iter().filter(|entry| !entry.is_static) {
        match entry.kind {
            ObjectMemberKind::Getter
            | ObjectMemberKind::Setter
            | ObjectMemberKind::GetterAndSetter => {}
            ObjectMemberKind::Field | ObjectMemberKind::Method => continue,
        }
        match entry.name {
            MemberName::String(name) => keys.push(member::name_key(file, name)),
            MemberName::Symbol(_) | MemberName::Private(_) => {}
        }
    }
    keys.sort_unstable();
    keys.dedup();
    keys
}

fn create_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: FieldOwner,
    types: PositionTypes,
    position: u32,
) -> DeclaredType {
    if owner.file != file.file {
        return DeclaredType::untyped();
    }
    let origin = SiteOrigin {
        kind: TypeSiteKind::Field,
        position,
    };
    positions::create_position(file, types, origin)
}

// A name that is only stored has the type of the first value stored. The checker holds no other store to it.
fn create_stored_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: FieldOwner,
    types: PositionTypes,
    position: u32,
) -> DeclaredType {
    let Ok(stored) = types.checked else {
        return DeclaredType::untyped();
    };
    if owner.file != file.file {
        return DeclaredType::untyped();
    }
    let mapped = map_type_at(file, stored, position);
    DeclaredType::new(Mapped::expected(mapped.ty), None, PositionFlags::default())
}

fn create_named_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: FieldOwner,
    field: &NamedField,
) -> DeclaredType {
    let mut declared = match field.has_declared_type {
        true => create_field_position(file, owner, field.types, field.position),
        false => create_stored_field_position(file, owner, field.types, field.position),
    };
    if field.is_optional_member {
        declared = positions::add_undefined(file, declared);
    }
    declared
}

fn count_private_fields(shape: &ClassShape<'_>) -> usize {
    let members = shape.members.iter();
    members
        .filter(|entry| !entry.is_static && entry.kind == ObjectMemberKind::Field)
        .filter(|entry| match entry.name {
            MemberName::Private(_) => true,
            MemberName::String(_) | MemberName::Symbol(_) => false,
        })
        .count()
}

#[allow(clippy::needless_pass_by_value)] // made for this call
fn try_add_named_field(
    file: &mut FileLowering<'_, '_, '_, '_>,
    fields: &mut OwnFields,
    owner: FieldOwner,
    field: NamedField,
    public_capacity: &mut u64,
) -> bool {
    if let Some(index) = fields.find_unindexed(field.key) {
        let known = *fields.get(index);
        let declared = match field.types.written.written() {
            Some(_) => create_named_field_position(file, owner, &field),
            None => known.declared,
        };
        let merged = Field {
            declared,
            flags: known.flags | field.flags,
            ..known
        };
        fields.replace(index, merged);
        return true;
    }
    if !field.flags.contains(FieldFlags::IS_PRIVATE) {
        if *public_capacity == 0 {
            return false;
        }
        *public_capacity -= 1;
    }
    fields.add(Field {
        key: Some(field.key),
        declared: create_named_field_position(file, owner, &field),
        flags: field.flags,
        ..Field::default()
    });
    true
}

fn find_declared_this_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> Option<CheckerTypeId> {
    if function.file != file.file {
        return None;
    }
    let signature = file.queries.function_signature(function);
    let written = signature.this_type.written.written()?;
    file.queries.without_nullish(written).ok()
}

fn find_declared_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    receiver: CheckerTypeId,
    name: MemberName,
) -> Option<ObjectMember> {
    let (MemberName::String(name) | MemberName::Symbol(name)) = name else {
        return None;
    };
    match file.queries.find_member(receiver, name) {
        Ok(MemberLookup::Member(member)) if member.kind == ObjectMemberKind::Field => Some(member),
        Ok(MemberLookup::Member(_) | MemberLookup::Index(_) | MemberLookup::Absent) | Err(_) => {
            None
        }
    }
}

fn add_named_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    fields: &mut OwnFields,
    owner: FieldOwner,
    shape: &ClassShape<'_>,
    declared_this: Option<CheckerTypeId>,
    mut public_capacity: u64,
) {
    let hir = file.queries.files().hir(owner.file);
    let accessor_keys = collect_accessor_keys(file, shape);
    let mut first_omitted = None;
    for entry in shape.members.iter().filter(|entry| !entry.is_static) {
        match entry.kind {
            ObjectMemberKind::Field => {}
            ObjectMemberKind::Method
            | ObjectMemberKind::Getter
            | ObjectMemberKind::Setter
            | ObjectMemberKind::GetterAndSetter => continue,
        }
        let (position, is_declared) = match entry.source {
            ClassMemberSource::Member(node) if class::is_declaration_only(hir[node]) => continue,
            ClassMemberSource::Member(node) => (hir[node].name_pos, true),
            ClassMemberSource::ParameterProperty(parameter) => (hir[parameter].pos, true),
            ClassMemberSource::ThisStore(store) => (hir[store].pos, false),
            ClassMemberSource::PrototypeStore(_) | ClassMemberSource::StaticStore(_) => continue,
        };
        let Some((key, mut flags)) = find_field_key(file, owner.layout, entry.name) else {
            continue;
        };
        if !is_declared && accessor_keys.binary_search(&key).is_ok() {
            continue;
        }
        if !entry.is_optional {
            flags |= FieldFlags::IS_REQUIRED;
        }
        let declared_member = match (is_declared, declared_this) {
            (false, Some(receiver)) => find_declared_member(file, receiver, entry.name),
            (true, _) | (false, None) => None,
        };
        let field = NamedField {
            key,
            flags,
            types: declared_member.map_or(entry.types, |member| member.types),
            has_declared_type: is_declared || declared_member.is_some(),
            is_optional_member: declared_member.is_some_and(|member| member.is_optional),
            position,
        };
        if !try_add_named_field(file, fields, owner, field, &mut public_capacity) {
            first_omitted.get_or_insert(position);
        }
    }
    if let Some(position) = first_omitted
        && owner.file == file.file
    {
        file.gave_up(LimitId::FieldsInKeyOrder, position);
    }
}

fn instance_accessor_members(
    hir: &hir::File<'_>,
    class: ClassId,
) -> impl Iterator<Item = MemberId> {
    class::runtime_members(hir, class).filter(move |&member| {
        let node = hir[member];
        class::is_auto_accessor(hir, member)
            && !node.flags.contains(Flags::STATIC)
            && !class::is_declaration_only(node)
    })
}

fn accessor_storage_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: FieldOwner,
    class: ClassId,
    member: MemberId,
) -> (PropertyKeyId, FieldFlags) {
    let hir = file.queries.files().hir(owner.file);
    let flags = FieldFlags::IS_REQUIRED | FieldFlags::IS_PRIVATE;
    match hir.runtime_member_key(member) {
        PropKey::Private(name) => (private_key(file, owner.layout, name), flags),
        PropKey::None | PropKey::Name(_) | PropKey::Computed(_) => {
            let text = format!("#{}", member.0 - hir[class].members.start);
            let key = hidden_key(file, owner.layout, text.as_bytes());
            (key, flags | FieldFlags::IS_HIDDEN)
        }
    }
}

fn add_accessor_storages(
    file: &mut FileLowering<'_, '_, '_, '_>,
    fields: &mut OwnFields,
    owner: FieldOwner,
    class: ClassId,
    shape: &ClassShape<'_>,
) {
    let hir = file.queries.files().hir(owner.file);
    for member in instance_accessor_members(hir, class) {
        let (key, flags) = accessor_storage_key(file, owner, class, member);
        let source = ClassMemberSource::Member(member);
        let declared = match shape.members.iter().find(|entry| entry.source == source) {
            Some(entry) => create_field_position(file, owner, entry.types, hir[member].name_pos),
            None => DeclaredType::untyped(),
        };
        let storage = Field {
            key: Some(key),
            declared,
            flags,
            ..Field::default()
        };
        fields.add_accessor_storage(member, storage);
    }
}

fn report_excess_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: FieldOwner,
    position: u32,
    fields: &OwnFields,
) {
    let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
    let count = fields.as_slice().len() as u64;
    if count <= limit || owner.file != file.file {
        return;
    }
    file.gave_up(LimitId::FieldsInKeyOrder, position);
    let span = file.span_at(position);
    let (limit, count) = (limit.to_string(), count.to_string());
    let purpose = LimitId::FieldsInKeyOrder.purpose();
    let arguments = [purpose.as_bytes(), limit.as_bytes(), count.as_bytes()];
    file.diagnostics
        .report(Code::ProgramLimitExceeded, span, &arguments);
}

pub(super) fn compute_class_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    class: ClassRef,
) -> OwnFields {
    let files = file.queries.files();
    let (hir, bound) = (files.hir(class.file), files.bound(class.file));
    let shape = file.queries.class_shape(class);
    let owner = FieldOwner {
        file: class.file,
        layout,
    };
    let mut fields = OwnFields::default();
    if class::has_instance_brand(hir, bound, class.class) {
        fields.add(brand_field(file, layout));
    }
    let states = class::private_state_fields(file, layout, class);
    let private_field_count = fields.as_slice().len()
        + count_private_fields(shape)
        + instance_accessor_members(hir, class.class).count()
        + states.len();
    let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
    let public_capacity = limit.saturating_sub(private_field_count as u64);
    add_named_fields(file, &mut fields, owner, shape, None, public_capacity);
    add_accessor_storages(file, &mut fields, owner, class.class, shape);
    for state in states {
        fields.add(state);
    }
    report_excess_fields(file, owner, class_position(&hir[class.class]), &fields);
    fields.finish()
}

pub(super) fn compute_constructor_function_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> OwnFields {
    let Some(shape) = file.queries.constructor_function_shape(function) else {
        return OwnFields::default();
    };
    let key = LayoutKey::ConstructorFunction(function);
    let owner = FieldOwner {
        file: function.file,
        layout: file.fragment.declare_layout(key),
    };
    let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
    let declared_this = find_declared_this_type(file, function);
    let mut fields = OwnFields::default();
    add_named_fields(file, &mut fields, owner, shape, declared_this, limit);
    fields.finish()
}

fn classify_heritage_shape(kind: ShapeKind<'_>) -> HeritageShape {
    match kind {
        ShapeKind::ClassConstructor(class) => HeritageShape::ClassConstructor(class),
        ShapeKind::Class(class) => HeritageShape::Class(class),
        ShapeKind::Object => HeritageShape::ObjectType,
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable { .. }
        | ShapeKind::Never
        | ShapeKind::Undefined
        | ShapeKind::Null
        | ShapeKind::Boolean
        | ShapeKind::BooleanLiteral(_)
        | ShapeKind::Number
        | ShapeKind::NumberLiteral(_)
        | ShapeKind::NumericEnumMember(_)
        | ShapeKind::BigInt
        | ShapeKind::BigIntLiteral { .. }
        | ShapeKind::String
        | ShapeKind::StringLiteral(_)
        | ShapeKind::TemplateLiteral { .. }
        | ShapeKind::Symbol
        | ShapeKind::AnyObject
        | ShapeKind::Function(_)
        | ShapeKind::Array { .. }
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Union(_)
        | ShapeKind::Constrained { .. } => HeritageShape::NoLayout,
    }
}

fn find_base_class(file: &mut FileLowering<'_, '_, '_, '_>, class: ClassId) -> Option<ClassRef> {
    let extends = file.hir[class].extends.some()?;
    let ty = file.queries.expression_type(extends).ok()?;
    let shape = file.queries.type_shape(ty).ok()?;
    let derived = ClassRef {
        file: file.file,
        class,
    };
    match classify_heritage_shape(shape.kind) {
        HeritageShape::ClassConstructor(base) if base != derived => Some(base),
        HeritageShape::ClassConstructor(_)
        | HeritageShape::Class(_)
        | HeritageShape::ObjectType
        | HeritageShape::NoLayout => None,
    }
}

fn find_layout_of_parent(
    file: &mut FileLowering<'_, '_, '_, '_>,
    parent: ClassParent,
) -> Option<LayoutId> {
    match parent {
        ClassParent::Declared(ClassDeclaration::Class(parent)) => {
            Some(super::class_layout(file, parent))
        }
        ClassParent::Declared(ClassDeclaration::Function(parent)) => {
            declare_constructor_function_layout(file, parent)
        }
        ClassParent::Library(parent) => {
            Some(file.fragment.declare_layout(LayoutKey::Library(parent)))
        }
    }
}

// Where the type of the heritage is no class, its binding says what it is: a constructor function, or what a module of Bun's exports.
fn find_base_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    base_class: Option<ClassRef>,
) -> Option<LayoutId> {
    if let Some(base) = base_class {
        return Some(super::class_layout(file, base));
    }
    // Each member more of the family of EventEmitter is one more place where its fields may lie, and an access tests few places.
    if file.source != SourceKind::Program {
        return None;
    }
    let derived = ClassRef {
        file: file.file,
        class,
    };
    let parent = file.queries.class_parent(derived)?;
    find_layout_of_parent(file, parent)
}

fn collect_implemented_layouts(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
) -> SmallVec<[LayoutId; 2]> {
    let hir = file.hir;
    let mut layouts = SmallVec::new();
    for node in hir.ids(hir[class].implements) {
        let Some(ty) = file.queries.written_type(node).written() else {
            continue;
        };
        let Ok(shape) = file.queries.type_shape(ty) else {
            continue;
        };
        match classify_heritage_shape(shape.kind) {
            HeritageShape::ObjectType => {
                if let Some(layout) = super::object_type_layout(file, ty) {
                    layouts.push(layout);
                }
            }
            HeritageShape::Class(implemented) => {
                layouts.push(super::class_layout(file, implemented));
            }
            HeritageShape::ClassConstructor(_) | HeritageShape::NoLayout => {}
        }
    }
    layouts
}

fn collect_supertypes(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    class: ClassId,
    base: Option<LayoutId>,
) -> Supertypes {
    let mut supertypes: Supertypes = base.into_iter().collect();
    for implemented in collect_implemented_layouts(file, class) {
        if implemented != layout && !supertypes.contains(&implemented) {
            supertypes.push(implemented);
        }
    }
    supertypes
}

fn find_field_origin(
    file: &mut FileLowering<'_, '_, '_, '_>,
    supertypes: &[LayoutId],
    key: PropertyKeyId,
) -> Option<(LayoutId, u32)> {
    supertypes.iter().find_map(|&supertype| {
        let field = super::own_fields(file, supertype).find(key)?;
        Some((supertype, field))
    })
}

fn set_field_origins(
    file: &mut FileLowering<'_, '_, '_, '_>,
    fields: &mut [Field],
    supertypes: &[LayoutId],
) {
    for field in fields {
        let Some(key) = field.key else {
            continue;
        };
        if field.flags.contains(FieldFlags::IS_PRIVATE) {
            continue;
        }
        if let Some((origin_layout, origin_field)) = find_field_origin(file, supertypes, key) {
            field.origin_layout = Some(origin_layout);
            field.origin_field = Some(origin_field);
        }
    }
}

fn create_static_field(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
    key: PropertyKeyId,
    member: MemberId,
) -> StaticField {
    let slot = ClassSlot::StaticField(member);
    StaticField {
        key: Some(key),
        computed_key: None,
        variable: scope::ensure_variable(file, VariableKey::ClassSlot { class, slot }),
    }
}

fn compute_static_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    class: ClassId,
) -> Vec<StaticField> {
    let hir = file.hir;
    let reference = ClassRef {
        file: file.file,
        class,
    };
    let shape = file.queries.class_shape(reference);
    let mut static_fields = Vec::new();
    let mut keys = FxHashSet::default();
    for entry in shape.members.iter().filter(|entry| entry.is_static) {
        match entry.kind {
            ObjectMemberKind::Field => {}
            ObjectMemberKind::Method
            | ObjectMemberKind::Getter
            | ObjectMemberKind::Setter
            | ObjectMemberKind::GetterAndSetter => continue,
        }
        let node = match entry.source {
            ClassMemberSource::Member(node) if !class::is_declaration_only(hir[node]) => node,
            ClassMemberSource::Member(_)
            | ClassMemberSource::ParameterProperty(_)
            | ClassMemberSource::ThisStore(_)
            | ClassMemberSource::PrototypeStore(_)
            | ClassMemberSource::StaticStore(_) => continue,
        };
        if class::has_private_static_storage(hir, node) {
            continue;
        }
        let Some((key, _)) = find_field_key(file, layout, entry.name) else {
            continue;
        };
        if keys.insert(key) {
            static_fields.push(create_static_field(file, reference, key, node));
        }
    }
    static_fields
}

pub(super) fn define_class_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    constructor: Option<FunctionId>,
) -> LayoutId {
    let reference = ClassRef {
        file: file.file,
        class,
    };
    let layout = super::class_layout(file, reference);
    if file.fragment.is_layout_defined(layout) {
        debug_assert!(false, "a class is defined once");
        return layout;
    }
    let node = file.hir[class];
    let base_class = find_base_class(file, class);
    let base = find_base_layout(file, class, base_class).filter(|&it| it != layout);
    let supertypes = collect_supertypes(file, layout, class, base);
    let mut fields = super::own_fields(file, layout).as_slice().to_vec();
    set_field_origins(file, &mut fields, &supertypes);
    let flags = match class::is_derived_class(file.hir, class) {
        true => LayoutFlags::HAS_HERITAGE,
        false => LayoutFlags::default(),
    };
    let definition = Layout {
        kind: LayoutKind::Instance,
        name: node.name.is_some().then(|| file.intern_atom(node.name)),
        module: Some(file.module_id()),
        position: class_position(&node),
        base,
        constructor,
        fields,
        static_fields: compute_static_fields(file, layout, class),
        flags,
        ..Layout::default()
    };
    file.fragment.define_layout(layout, definition);
    for supertype in supertypes {
        super::add_conversion(file, layout, supertype);
    }
    record_heritage_flows(file, reference, base_class);
    layout
}

fn find_inherited_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    base: Option<ClassRef>,
) -> SmallVec<[CheckerTypeId; 2]> {
    let hir = file.hir;
    let mut inherited = SmallVec::new();
    match base {
        Some(base) => inherited.extend(file.queries.declared_class_type(base).ok()),
        // The heritage is no class: a constructor function, or a value with a construct signature.
        None => {
            let derived = ClassRef {
                file: file.file,
                class,
            };
            inherited.extend(
                file.queries
                    .base_types_of_class(derived)
                    .unwrap_or_default(),
            );
        }
    }
    for node in hir.ids(hir[class].implements) {
        inherited.extend(file.queries.written_type(node).written());
    }
    inherited
}

fn record_heritage_flows(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
    base: Option<ClassRef>,
) {
    if let Some(base) = base {
        let derived_type = function_types::find_class_function_type(file, class);
        let base_type = function_types::find_class_function_type(file, base);
        file.fragment
            .add_function_type_edge(derived_type, base_type);
    }
    let Ok(instance) = file.queries.declared_class_type(class) else {
        return;
    };
    let position = class_position(&file.hir[class.class]);
    for inherited in find_inherited_types(file, class.class, base) {
        convert::record_heritage_flow(file, instance, inherited, position);
    }
}

fn can_be_constructor_function(node: &hir::Func) -> bool {
    let is_ordinary_function = match node.kind {
        FnKind::Decl | FnKind::Expr => true,
        FnKind::Arrow
        | FnKind::Method
        | FnKind::Getter
        | FnKind::Setter
        | FnKind::Constructor
        | FnKind::StaticBlock
        | FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => false,
    };
    is_ordinary_function
        && hir::has_body(node)
        && !node.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
}

// `a.b = function () {}`, `{ b: function () {} }`: nobody can name the function behind `new`.
fn is_stored_as_property(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> bool {
    let FnOwner::Expr(expression) = file.bound.fns[function.idx()].owner else {
        return false;
    };
    match file.bound.parent_of_expr(expression) {
        Parent::Prop(_) => true,
        Parent::Expr(parent) => match file.hir[parent].kind {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                let is_member = matches!(
                    file.hir[target].kind,
                    ExprKind::Dot { .. } | ExprKind::Index { .. }
                );
                value == expression && is_member
            }
            _ => false,
        },
        _ => false,
    }
}

// The type of the objects that the function makes.
fn find_declared_this_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> Option<LayoutId> {
    if is_stored_as_property(file, function.function) {
        return None;
    }
    let signature = file.queries.function_signature(function);
    let ty = signature.this_type.written.written()?;
    let shape = file.queries.type_shape(ty).ok()?;
    match classify_heritage_shape(shape.kind) {
        HeritageShape::ObjectType => super::object_type_layout(file, ty),
        HeritageShape::Class(class) => Some(super::class_layout(file, class)),
        HeritageShape::ClassConstructor(_) | HeritageShape::NoLayout => None,
    }
}

fn find_parent_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> Option<LayoutId> {
    let parent = file.queries.constructor_function_parent(function)?;
    find_layout_of_parent(file, parent)
}

fn define_constructor_function_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    function: FunctionRef,
) {
    let node = file.hir[function.function];
    let constructor = match file.decisions().is_dead_function(function.function) {
        true => None,
        false => Some(file.reference_function(FunctionKey::Source(function))),
    };
    let declared_this = find_declared_this_layout(file, function);
    let supertypes: Supertypes = declared_this
        .into_iter()
        .filter(|&it| it != layout)
        .collect();
    let mut fields = super::own_fields(file, layout).as_slice().to_vec();
    set_field_origins(file, &mut fields, &supertypes);
    let base = find_parent_layout(file, function).filter(|&it| it != layout);
    let definition = Layout {
        kind: LayoutKind::Instance,
        name: node.name.is_some().then(|| file.intern_atom(node.name)),
        module: Some(file.module_id()),
        position: node.start,
        base,
        constructor,
        fields,
        flags: LayoutFlags::IS_CONSTRUCTOR_FUNCTION,
        ..Layout::default()
    };
    file.fragment.define_layout(layout, definition);
    for supertype in supertypes {
        super::add_conversion(file, layout, supertype);
    }
}

fn declare_constructor_function_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> Option<LayoutId> {
    let hir = file.queries.files().hir(function.file);
    if !can_be_constructor_function(&hir[function.function]) {
        return None;
    }
    file.queries.constructor_function_shape(function)?;
    if function.file == file.file {
        match module::library_function_form(file, function.function) {
            Some(LibraryFunctionForm::Method | LibraryFunctionForm::NakedConstructor) => {
                return None;
            }
            Some(LibraryFunctionForm::Constructor) | None => {}
        }
    }
    let key = LayoutKey::ConstructorFunction(function);
    Some(file.fragment.declare_layout(key))
}

pub(super) fn constructor_function_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
) -> Option<LayoutId> {
    let layout = declare_constructor_function_layout(file, function)?;
    if function.file == file.file && !file.fragment.is_layout_defined(layout) {
        define_constructor_function_layout(file, layout, function);
    }
    Some(layout)
}

pub(super) fn define_remaining_class_layouts(file: &mut FileLowering<'_, '_, '_, '_>) {
    let (hir, bound) = (file.hir, file.bound);
    for class in (0..hir.classes.len() as u32).map(ClassId) {
        let is_ambient = hir[class].flags.contains(Flags::AMBIENT);
        if is_ambient || bound.class_scope[class.idx()].is_none() {
            continue;
        }
        let reference = ClassRef {
            file: file.file,
            class,
        };
        let layout = super::class_layout(file, reference);
        if !file.fragment.is_layout_defined(layout) {
            define_class_layout(file, class, None);
        }
    }
    for function in (0..hir.fns.len() as u32).map(FnId) {
        let reference = FunctionRef {
            file: file.file,
            function,
        };
        constructor_function_layout(file, reference);
    }
}

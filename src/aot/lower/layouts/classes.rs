use bun_sema::atom::{Atom, written_name};
use bun_sema::bind::{Binding, Decl, FnOwner, Parent};
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
    PositionFlags, PropertyKey, PropertyKeyId, StringId, Type, VariableKey,
};
use crate::lower::module::LibraryFunctionForm;
use crate::lower::positions::SiteOrigin;
use crate::lower::{CheckerTypeId, FileLowering, SourceKind, class, module};

type Supertypes = SmallVec<[LayoutId; 4]>;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn class_binding(&self, class: ClassId) -> Binding {
        Binding::Symbol(self.bound.declared_symbol(Decl::Class(class)))
    }

    pub(in crate::lower) fn intern_class_name(&mut self, class: ClassId) -> StringId {
        let binding = self.class_binding(class);
        self.intern_function_name(binding, self.hir[class].name)
    }

    fn hidden_key(&mut self, owner: LayoutId, text: &[u8]) -> PropertyKeyId {
        let text = self.intern_bytes(text);
        let key = PropertyKey::from_private_name(text, owner);
        self.fragment.property_keys.intern(key)
    }

    fn brand_field(&mut self, layout: LayoutId) -> Field {
        let token = Type::opaque(OpaqueKind::ClassToken);
        let token = self.fragment.types.intern(token);
        Field {
            key: Some(self.hidden_key(layout, b"#")),
            declared: DeclaredType::from_compiler(token),
            flags: FieldFlags::IS_REQUIRED
                | FieldFlags::IS_PRIVATE
                | FieldFlags::IS_HIDDEN
                | FieldFlags::IS_BRAND
                | FieldFlags::IS_IMMUTABLE,
            ..Field::default()
        }
    }

    fn collect_accessor_keys(&mut self, shape: &ClassShape<'_>) -> SmallVec<[PropertyKeyId; 8]> {
        let mut keys = SmallVec::new();
        for entry in shape.members.iter().filter(|entry| !entry.is_static) {
            match entry.kind {
                ObjectMemberKind::Getter
                | ObjectMemberKind::Setter
                | ObjectMemberKind::GetterAndSetter => {}
                ObjectMemberKind::Field | ObjectMemberKind::Method => continue,
            }
            match entry.name {
                MemberName::String(name) => keys.push(self.name_key(name)),
                MemberName::Symbol(_) | MemberName::Private(_) => {}
            }
        }
        keys.sort_unstable();
        keys.dedup();
        keys
    }

    fn create_field_position(
        &mut self,
        owner: FieldOwner,
        types: PositionTypes,
        position: u32,
    ) -> DeclaredType {
        if owner.file != self.file {
            return DeclaredType::untyped();
        }
        let origin = SiteOrigin {
            kind: TypeSiteKind::Field,
            position,
        };
        self.create_position(types, origin)
    }

    // A name that is only stored has the type of the first value stored. The checker holds no other store to it.
    fn create_stored_field_position(
        &mut self,
        owner: FieldOwner,
        types: PositionTypes,
        position: u32,
    ) -> DeclaredType {
        let Ok(stored) = types.checked else {
            return DeclaredType::untyped();
        };
        if owner.file != self.file {
            return DeclaredType::untyped();
        }
        let mapped = self.map_type_at(stored, position);
        DeclaredType::new(Mapped::expected(mapped.ty), None, PositionFlags::default())
    }

    fn create_named_field_position(
        &mut self,
        owner: FieldOwner,
        field: &NamedField,
    ) -> DeclaredType {
        let mut declared = match field.has_declared_type {
            true => self.create_field_position(owner, field.types, field.position),
            false => self.create_stored_field_position(owner, field.types, field.position),
        };
        if field.is_optional_member {
            declared = self.add_undefined(declared);
        }
        declared
    }

    #[allow(clippy::needless_pass_by_value)] // made for this call
    fn try_add_named_field(
        &mut self,
        fields: &mut OwnFields,
        owner: FieldOwner,
        field: NamedField,
        public_capacity: &mut u64,
    ) -> bool {
        if let Some(index) = fields.find_unindexed(field.key) {
            let known = *fields.get(index);
            let declared = match field.types.written.written() {
                Some(_) => self.create_named_field_position(owner, &field),
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
            declared: self.create_named_field_position(owner, &field),
            flags: field.flags,
            ..Field::default()
        });
        true
    }

    fn find_declared_this_type(&mut self, function: FunctionRef) -> Option<CheckerTypeId> {
        if function.file != self.file {
            return None;
        }
        let signature = self.queries.function_signature(function);
        let written = signature.this_type.written.written()?;
        self.queries.without_nullish(written).ok()
    }

    fn find_declared_member(
        &mut self,
        receiver: CheckerTypeId,
        name: MemberName,
    ) -> Option<ObjectMember> {
        let (MemberName::String(name) | MemberName::Symbol(name)) = name else {
            return None;
        };
        match self.queries.find_member(receiver, name) {
            Ok(MemberLookup::Member(member)) if member.kind == ObjectMemberKind::Field => {
                Some(member)
            }
            Ok(MemberLookup::Member(_) | MemberLookup::Index(_) | MemberLookup::Absent)
            | Err(_) => None,
        }
    }

    fn add_named_fields(
        &mut self,
        fields: &mut OwnFields,
        owner: FieldOwner,
        shape: &ClassShape<'_>,
        declared_this: Option<CheckerTypeId>,
        mut public_capacity: u64,
    ) {
        let hir = self.queries.files().hir(owner.file);
        let accessor_keys = self.collect_accessor_keys(shape);
        let mut first_omitted = None;
        for entry in shape.members.iter().filter(|entry| !entry.is_static) {
            match entry.kind {
                ObjectMemberKind::Field => {}
                _ => continue,
            }
            let (position, is_declared) = match entry.source {
                ClassMemberSource::Member(node) if class::is_declaration_only(hir[node]) => {
                    continue;
                }
                ClassMemberSource::Member(node) => (hir[node].name_pos, true),
                ClassMemberSource::ParameterProperty(parameter) => (hir[parameter].pos, true),
                ClassMemberSource::ThisStore(store) => (hir[store].pos, false),
                ClassMemberSource::PrototypeStore(_) | ClassMemberSource::StaticStore(_) => {
                    continue;
                }
            };
            let Some((key, mut flags)) = find_field_key(self, owner.layout, entry.name) else {
                continue;
            };
            if !is_declared && accessor_keys.binary_search(&key).is_ok() {
                continue;
            }
            if !entry.is_optional {
                flags |= FieldFlags::IS_REQUIRED;
            }
            let declared_member = match (is_declared, declared_this) {
                (false, Some(receiver)) => self.find_declared_member(receiver, entry.name),
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
            if !self.try_add_named_field(fields, owner, field, &mut public_capacity) {
                first_omitted.get_or_insert(position);
            }
        }
        if let Some(position) = first_omitted
            && owner.file == self.file
        {
            self.gave_up(LimitId::FieldsInKeyOrder, position);
        }
    }

    fn accessor_storage_key(
        &mut self,
        owner: FieldOwner,
        class: ClassId,
        member: MemberId,
    ) -> (PropertyKeyId, FieldFlags) {
        let hir = self.queries.files().hir(owner.file);
        let flags = FieldFlags::IS_REQUIRED | FieldFlags::IS_PRIVATE;
        match hir.runtime_member_key(member) {
            PropKey::Private(name) => (private_key(self, owner.layout, name), flags),
            PropKey::None | PropKey::Name(_) | PropKey::Computed(_) => {
                let text = format!("#{}", member.0 - hir[class].members.start);
                let key = self.hidden_key(owner.layout, text.as_bytes());
                (key, flags | FieldFlags::IS_HIDDEN)
            }
        }
    }

    fn add_accessor_storages(
        &mut self,
        fields: &mut OwnFields,
        owner: FieldOwner,
        class: ClassId,
        shape: &ClassShape<'_>,
    ) {
        let hir = self.queries.files().hir(owner.file);
        for member in instance_accessor_members(hir, class) {
            let (key, flags) = self.accessor_storage_key(owner, class, member);
            let source = ClassMemberSource::Member(member);
            let declared = match shape.members.iter().find(|entry| entry.source == source) {
                Some(entry) => self.create_field_position(owner, entry.types, hir[member].name_pos),
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

    fn report_excess_fields(&mut self, owner: FieldOwner, position: u32, fields: &OwnFields) {
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
        let count = fields.as_slice().len() as u64;
        if count <= limit || owner.file != self.file {
            return;
        }
        self.gave_up(LimitId::FieldsInKeyOrder, position);
        let span = self.span_at(position);
        let (limit, count) = (limit.to_string(), count.to_string());
        let purpose = LimitId::FieldsInKeyOrder.purpose();
        let arguments = [purpose.as_bytes(), limit.as_bytes(), count.as_bytes()];
        self.diagnostics
            .report(Code::ProgramLimitExceeded, span, &arguments);
    }

    fn find_layout_of_parent(&mut self, parent: ClassParent) -> Option<LayoutId> {
        match parent {
            ClassParent::Declared(ClassDeclaration::Class(parent)) => {
                Some(self.class_layout(parent))
            }
            ClassParent::Declared(ClassDeclaration::Function(parent)) => {
                self.declare_constructor_function_layout(parent)
            }
            ClassParent::Library(parent) => {
                Some(self.fragment.declare_layout(LayoutKey::Library(parent)))
            }
        }
    }

    fn collect_implemented_layouts(&mut self, class: ClassId) -> SmallVec<[LayoutId; 2]> {
        let hir = self.hir;
        let mut layouts = SmallVec::new();
        for node in hir.ids(hir[class].implements) {
            let Some(ty) = self.queries.written_type(node).written() else {
                continue;
            };
            let Ok(shape) = self.queries.type_shape(ty) else {
                continue;
            };
            match classify_heritage_shape(shape.kind) {
                HeritageShape::ObjectType => {
                    if let Some(layout) = self.object_type_layout(ty) {
                        layouts.push(layout);
                    }
                }
                HeritageShape::Class(implemented) => {
                    layouts.push(self.class_layout(implemented));
                }
                HeritageShape::ClassConstructor(_) | HeritageShape::NoLayout => {}
            }
        }
        layouts
    }

    fn collect_supertypes(
        &mut self,
        layout: LayoutId,
        class: ClassId,
        base: Option<LayoutId>,
    ) -> Supertypes {
        let mut supertypes: Supertypes = base.into_iter().collect();
        for implemented in self.collect_implemented_layouts(class) {
            if implemented != layout && !supertypes.contains(&implemented) {
                supertypes.push(implemented);
            }
        }
        supertypes
    }

    fn find_field_origin(
        &mut self,
        supertypes: &[LayoutId],
        key: PropertyKeyId,
    ) -> Option<(LayoutId, u32)> {
        supertypes.iter().find_map(|&supertype| {
            let field = super::own_fields(self, supertype).find(key)?;
            Some((supertype, field))
        })
    }

    fn set_field_origins(&mut self, fields: &mut [Field], supertypes: &[LayoutId]) {
        for field in fields {
            let Some(key) = field.key else {
                continue;
            };
            if field.flags.contains(FieldFlags::IS_PRIVATE) {
                continue;
            }
            if let Some((origin_layout, origin_field)) = self.find_field_origin(supertypes, key) {
                field.origin_layout = Some(origin_layout);
                field.origin_field = Some(origin_field);
            }
        }
    }

    fn create_static_field(
        &mut self,
        class: ClassRef,
        key: PropertyKeyId,
        member: MemberId,
    ) -> StaticField {
        let slot = ClassSlot::StaticField(member);
        StaticField {
            key: Some(key),
            computed_key: None,
            variable: self.ensure_variable(VariableKey::ClassSlot { class, slot }),
        }
    }

    fn record_heritage_flows(&mut self, class: ClassRef, base: Option<ClassRef>) {
        if let Some(base) = base {
            let derived_type = self.find_class_function_type(class);
            let base_type = self.find_class_function_type(base);
            self.fragment
                .add_function_type_edge(derived_type, base_type);
        }
        let Ok(instance) = self.queries.declared_class_type(class) else {
            return;
        };
        let position = class_position(&self.hir[class.class]);
        for inherited in find_inherited_types(self, class.class, base) {
            self.record_heritage_flow(instance, inherited, position);
        }
    }

    // `a.b = function () {}`, `{ b: function () {} }`: nobody can name the function behind `new`.
    fn is_stored_as_property(&self, function: FnId) -> bool {
        let FnOwner::Expr(expression) = self.bound.fns[function.idx()].owner else {
            return false;
        };
        match self.bound.parent_of_expr(expression) {
            Parent::Prop(_) => true,
            Parent::Expr(parent) => match self.hir[parent].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } => {
                    let is_member = matches!(
                        self.hir[target].kind,
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
    fn find_declared_this_layout(&mut self, function: FunctionRef) -> Option<LayoutId> {
        if self.is_stored_as_property(function.function) {
            return None;
        }
        let signature = self.queries.function_signature(function);
        let ty = signature.this_type.written.written()?;
        let shape = self.queries.type_shape(ty).ok()?;
        match classify_heritage_shape(shape.kind) {
            HeritageShape::ObjectType => self.object_type_layout(ty),
            HeritageShape::Class(class) => Some(self.class_layout(class)),
            HeritageShape::ClassConstructor(_) | HeritageShape::NoLayout => None,
        }
    }

    fn find_parent_layout(&mut self, function: FunctionRef) -> Option<LayoutId> {
        let parent = self.queries.constructor_function_parent(function)?;
        self.find_layout_of_parent(parent)
    }

    fn define_constructor_function_layout(&mut self, layout: LayoutId, function: FunctionRef) {
        let node = self.hir[function.function];
        let constructor = match self.decisions().is_dead_function(function.function) {
            true => None,
            false => Some(self.reference_function(FunctionKey::Source(function))),
        };
        let declared_this = self.find_declared_this_layout(function);
        let supertypes: Supertypes = declared_this
            .into_iter()
            .filter(|&it| it != layout)
            .collect();
        let mut fields = super::own_fields(self, layout).as_slice().to_vec();
        self.set_field_origins(&mut fields, &supertypes);
        let base = self.find_parent_layout(function).filter(|&it| it != layout);
        let definition = Layout {
            kind: LayoutKind::Instance,
            name: node
                .name
                .is_some()
                .then(|| self.intern_own_name(function.function)),
            module: Some(self.module_id()),
            position: node.start,
            base,
            constructor,
            fields,
            flags: LayoutFlags::IS_CONSTRUCTOR_FUNCTION,
            ..Layout::default()
        };
        self.fragment.define_layout(layout, definition);
        for supertype in supertypes {
            self.add_conversion(layout, supertype);
        }
    }

    fn declare_constructor_function_layout(&mut self, function: FunctionRef) -> Option<LayoutId> {
        let hir = self.queries.files().hir(function.file);
        if !can_be_constructor_function(&hir[function.function]) {
            return None;
        }
        self.queries.constructor_function_shape(function)?;
        if function.file == self.file {
            match module::library_function_form(self, function.function) {
                Some(LibraryFunctionForm::Method | LibraryFunctionForm::NakedConstructor) => {
                    return None;
                }
                Some(LibraryFunctionForm::Constructor) | None => {}
            }
        }
        let key = LayoutKey::ConstructorFunction(function);
        Some(self.fragment.declare_layout(key))
    }

    pub(crate) fn constructor_function_layout(
        &mut self,
        function: FunctionRef,
    ) -> Option<LayoutId> {
        let layout = self.declare_constructor_function_layout(function)?;
        if function.file == self.file && !self.fragment.is_layout_defined(layout) {
            self.define_constructor_function_layout(layout, function);
        }
        Some(layout)
    }
}

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

pub(in crate::lower) fn private_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: LayoutId,
    name: Atom,
) -> PropertyKeyId {
    let text = written_name(file.queries.atom_bytes(name));
    file.hidden_key(owner, text)
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
            let key = file.name_key(name);
            can_be_field(file, key).then_some((key, FieldFlags::default()))
        }
        MemberName::Private(name) => {
            let key = private_key(file, owner, name);
            Some((key, FieldFlags::IS_PRIVATE))
        }
        MemberName::Symbol(name) => {
            let key = file.created_symbol_key(name)?;
            Some((key, FieldFlags::default()))
        }
    }
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
        fields.add(file.brand_field(layout));
    }
    let states = file.private_state_fields(layout, class);
    let private_field_count = fields.as_slice().len()
        + count_private_fields(shape)
        + instance_accessor_members(hir, class.class).count()
        + states.len();
    let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
    let public_capacity = limit.saturating_sub(private_field_count as u64);
    file.add_named_fields(&mut fields, owner, shape, None, public_capacity);
    file.add_accessor_storages(&mut fields, owner, class.class, shape);
    for state in states {
        fields.add(state);
    }
    file.report_excess_fields(owner, class_position(&hir[class.class]), &fields);
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
    let declared_this = file.find_declared_this_type(function);
    let mut fields = OwnFields::default();
    file.add_named_fields(&mut fields, owner, shape, declared_this, limit);
    fields.finish()
}

fn classify_heritage_shape(kind: ShapeKind<'_>) -> HeritageShape {
    match kind {
        ShapeKind::ClassConstructor(class) => HeritageShape::ClassConstructor(class),
        ShapeKind::Class(class) => HeritageShape::Class(class),
        ShapeKind::Object => HeritageShape::ObjectType,
        _ => HeritageShape::NoLayout,
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
        _ => None,
    }
}

// Where the type of the heritage is no class, its binding says what it is: a constructor function, or what a module of Bun's exports.
fn find_base_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    base_class: Option<ClassRef>,
) -> Option<LayoutId> {
    if let Some(base) = base_class {
        return Some(file.class_layout(base));
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
    file.find_layout_of_parent(parent)
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
            _ => continue,
        }
        let node = match entry.source {
            ClassMemberSource::Member(node) if !class::is_declaration_only(hir[node]) => node,
            _ => continue,
        };
        if class::has_private_static_storage(hir, node) {
            continue;
        }
        let Some((key, _)) = find_field_key(file, layout, entry.name) else {
            continue;
        };
        if keys.insert(key) {
            static_fields.push(file.create_static_field(reference, key, node));
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
    let layout = file.class_layout(reference);
    if file.fragment.is_layout_defined(layout) {
        debug_assert!(false, "a class is defined once");
        return layout;
    }
    let node = file.hir[class];
    let base_class = find_base_class(file, class);
    let base = find_base_layout(file, class, base_class).filter(|&it| it != layout);
    let supertypes = file.collect_supertypes(layout, class, base);
    let mut fields = super::own_fields(file, layout).as_slice().to_vec();
    file.set_field_origins(&mut fields, &supertypes);
    let flags = match class::is_derived_class(file.hir, class) {
        true => LayoutFlags::HAS_HERITAGE,
        false => LayoutFlags::default(),
    };
    let definition = Layout {
        kind: LayoutKind::Instance,
        name: node.name.is_some().then(|| file.intern_class_name(class)),
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
        file.add_conversion(layout, supertype);
    }
    file.record_heritage_flows(reference, base_class);
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

fn can_be_constructor_function(node: &hir::Func) -> bool {
    let is_ordinary_function = matches!(node.kind, FnKind::Decl | FnKind::Expr);
    is_ordinary_function
        && hir::has_body(node)
        && !node.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
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
        let layout = file.class_layout(reference);
        if !file.fragment.is_layout_defined(layout) {
            define_class_layout(file, class, None);
        }
    }
    for function in (0..hir.fns.len() as u32).map(FnId) {
        let reference = FunctionRef {
            file: file.file,
            function,
        };
        file.constructor_function_layout(reference);
    }
}

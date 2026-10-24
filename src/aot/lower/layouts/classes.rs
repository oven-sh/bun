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

    fn create_field_position(
        &mut self,
        home: FileId,
        types: PositionTypes,
        position: u32,
    ) -> DeclaredType {
        if home != self.file {
            return DeclaredType::untyped();
        }
        let origin = SiteOrigin {
            kind: TypeSiteKind::Field,
            position,
        };
        self.create_position(types, origin)
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
        home: FileId,
        layout: LayoutId,
        shape: &ClassShape<'_>,
        declared_this: Option<CheckerTypeId>,
        mut public_capacity: u64,
    ) {
        let hir = self.queries.files().hir(home);
        let mut accessor_keys: SmallVec<[PropertyKeyId; 8]> = SmallVec::new();
        for entry in shape.members.iter().filter(|entry| !entry.is_static) {
            match entry.kind {
                ObjectMemberKind::Getter
                | ObjectMemberKind::Setter
                | ObjectMemberKind::GetterAndSetter => {}
                ObjectMemberKind::Field | ObjectMemberKind::Method => continue,
            }
            match entry.name {
                MemberName::String(name) => accessor_keys.push(self.name_key(name)),
                MemberName::Symbol(_) | MemberName::Private(_) => {}
            }
        }
        accessor_keys.sort_unstable();
        accessor_keys.dedup();
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
            let Some((key, mut flags)) = self.find_field_key(layout, entry.name) else {
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
            let types = declared_member.map_or(entry.types, |member| member.types);
            let known = fields.find_unindexed(key);
            if known.is_none() && !flags.contains(FieldFlags::IS_PRIVATE) {
                if public_capacity == 0 {
                    first_omitted.get_or_insert(position);
                    continue;
                }
                public_capacity -= 1;
            }
            let mut field = match known {
                Some(index) => *fields.get(index),
                None => Field {
                    key: Some(key),
                    ..Field::default()
                },
            };
            field.flags |= flags;
            if known.is_none() || types.written.written().is_some() {
                field.declared = match (is_declared || declared_member.is_some(), types.checked) {
                    (true, _) => self.create_field_position(home, types, position),
                    // A name that is only stored has the type of the first value stored. The checker holds no other store to it.
                    (false, Ok(stored)) if home == self.file => {
                        let mapped = Mapped::expected(self.map_type_at(stored, position).ty);
                        DeclaredType::new(mapped, None, PositionFlags::default())
                    }
                    (false, Ok(_) | Err(_)) => DeclaredType::untyped(),
                };
                if declared_member.is_some_and(|member| member.is_optional) {
                    field.declared = self.add_undefined(field.declared);
                }
            }
            match known {
                Some(index) => fields.replace(index, field),
                None => _ = fields.add(field),
            }
        }
        if let Some(position) = first_omitted
            && home == self.file
        {
            self.gave_up(LimitId::FieldsInKeyOrder, position);
        }
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

    fn find_layout_of_written_type(&mut self, ty: CheckerTypeId) -> Option<LayoutId> {
        match self.queries.type_shape(ty).ok()?.kind {
            ShapeKind::Object => self.object_type_layout(ty),
            ShapeKind::Class(class) => Some(self.class_layout(class)),
            ShapeKind::ClassConstructor(_) => None,
            _ => None,
        }
    }

    fn set_field_origins(&mut self, fields: &mut [Field], supertypes: &[LayoutId]) {
        for field in fields {
            let Some(key) = field.key else {
                continue;
            };
            if field.flags.contains(FieldFlags::IS_PRIVATE) {
                continue;
            }
            let origin = supertypes.iter().find_map(|&supertype| {
                Some((supertype, super::own_fields(self, supertype).find(key)?))
            });
            if let Some((origin_layout, origin_field)) = origin {
                field.origin_layout = Some(origin_layout);
                field.origin_field = Some(origin_field);
            }
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
        let hir = self.hir;
        let mut inherited: SmallVec<[CheckerTypeId; 2]> = SmallVec::new();
        match base {
            Some(base) => inherited.extend(self.queries.declared_class_type(base).ok()),
            // The heritage is no class: a constructor function, or a value with a construct signature.
            None => inherited.extend(self.queries.base_types_of_class(class).unwrap_or_default()),
        }
        for node in hir.ids(hir[class.class].implements) {
            inherited.extend(self.queries.written_type(node).written());
        }
        let position = class_position(&hir[class.class]);
        for inherited in inherited {
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

    fn find_declared_this_layout(&mut self, function: FunctionRef) -> Option<LayoutId> {
        if self.is_stored_as_property(function.function) {
            return None;
        }
        let signature = self.queries.function_signature(function);
        let ty = signature.this_type.written.written()?;
        self.find_layout_of_written_type(ty)
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
        let parent = self.queries.constructor_function_parent(function);
        let base = parent.and_then(|parent| self.find_layout_of_parent(parent));
        let definition = Layout {
            kind: LayoutKind::Instance,
            name: node
                .name
                .is_some()
                .then(|| self.intern_own_name(function.function)),
            module: Some(self.module_id()),
            position: node.start,
            base: base.filter(|&it| it != layout),
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
        let node = &self.queries.files().hir(function.file)[function.function];
        if !matches!(node.kind, FnKind::Decl | FnKind::Expr)
            || !hir::has_body(node)
            || node.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
        {
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

    fn find_field_key(
        &mut self,
        owner: LayoutId,
        name: MemberName,
    ) -> Option<(PropertyKeyId, FieldFlags)> {
        match name {
            MemberName::String(name) => {
                let key = self.name_key(name);
                can_be_field(self, key).then_some((key, FieldFlags::default()))
            }
            MemberName::Private(name) => {
                let key = private_key(self, owner, name);
                Some((key, FieldFlags::IS_PRIVATE))
            }
            MemberName::Symbol(name) => {
                let key = self.created_symbol_key(name)?;
                Some((key, FieldFlags::default()))
            }
        }
    }

    pub(super) fn compute_class_fields(&mut self, layout: LayoutId, class: ClassRef) -> OwnFields {
        let files = self.queries.files();
        let (hir, bound) = (files.hir(class.file), files.bound(class.file));
        let shape = self.queries.class_shape(class);
        let home = class.file;
        let mut fields = OwnFields::default();
        if class::has_instance_brand(hir, bound, class.class) {
            let token = Type::opaque(OpaqueKind::ClassToken);
            let token = self.fragment.types.intern(token);
            fields.add(Field {
                key: Some(self.hidden_key(layout, b"#")),
                declared: DeclaredType::from_compiler(token),
                flags: FieldFlags::IS_REQUIRED
                    | FieldFlags::IS_PRIVATE
                    | FieldFlags::IS_HIDDEN
                    | FieldFlags::IS_BRAND
                    | FieldFlags::IS_IMMUTABLE,
                ..Field::default()
            });
        }
        let states = self.private_state_fields(layout, class);
        let private_field_count = fields.as_slice().len()
            + count_private_fields(shape)
            + instance_accessor_members(hir, class.class).count()
            + states.len();
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
        let public_capacity = limit.saturating_sub(private_field_count as u64);
        self.add_named_fields(&mut fields, home, layout, shape, None, public_capacity);
        for member in instance_accessor_members(hir, class.class) {
            let flags = FieldFlags::IS_REQUIRED | FieldFlags::IS_PRIVATE;
            let (key, flags) = match hir.runtime_member_key(member) {
                PropKey::Private(name) => (private_key(self, layout, name), flags),
                PropKey::None | PropKey::Name(_) | PropKey::Computed(_) => {
                    let text = format!("#{}", member.0 - hir[class.class].members.start);
                    let key = self.hidden_key(layout, text.as_bytes());
                    (key, flags | FieldFlags::IS_HIDDEN)
                }
            };
            let source = ClassMemberSource::Member(member);
            let declared = match shape.members.iter().find(|entry| entry.source == source) {
                Some(entry) => self.create_field_position(home, entry.types, hir[member].name_pos),
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
        for state in states {
            fields.add(state);
        }
        let count = fields.as_slice().len() as u64;
        if count > limit && class.file == self.file {
            let position = class_position(&hir[class.class]);
            self.gave_up(LimitId::FieldsInKeyOrder, position);
            let span = self.span_at(position);
            let (limit, count) = (limit.to_string(), count.to_string());
            let purpose = LimitId::FieldsInKeyOrder.purpose();
            let arguments = [purpose.as_bytes(), limit.as_bytes(), count.as_bytes()];
            self.diagnostics
                .report(Code::ProgramLimitExceeded, span, &arguments);
        }
        fields.finish()
    }

    pub(super) fn compute_constructor_function_fields(
        &mut self,
        function: FunctionRef,
    ) -> OwnFields {
        let Some(shape) = self.queries.constructor_function_shape(function) else {
            return OwnFields::default();
        };
        let key = LayoutKey::ConstructorFunction(function);
        let (home, layout) = (function.file, self.fragment.declare_layout(key));
        let limit = self.inputs.limits.get(LimitId::FieldsInKeyOrder);
        let declared_this = self.find_declared_this_type(function);
        let mut fields = OwnFields::default();
        self.add_named_fields(&mut fields, home, layout, shape, declared_this, limit);
        fields.finish()
    }

    fn find_base_class(&mut self, derived: ClassRef) -> Option<ClassRef> {
        let extends = self.hir[derived.class].extends.some()?;
        let ty = self.queries.expression_type(extends).ok()?;
        match self.queries.type_shape(ty).ok()?.kind {
            ShapeKind::ClassConstructor(base) if base != derived => Some(base),
            _ => None,
        }
    }

    fn compute_static_fields(&mut self, layout: LayoutId, class: ClassRef) -> Vec<StaticField> {
        let hir = self.hir;
        let shape = self.queries.class_shape(class);
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
            let Some((key, _)) = self.find_field_key(layout, entry.name) else {
                continue;
            };
            if keys.insert(key) {
                let slot = ClassSlot::StaticField(node);
                static_fields.push(StaticField {
                    key: Some(key),
                    computed_key: None,
                    variable: self.ensure_variable(VariableKey::ClassSlot { class, slot }),
                });
            }
        }
        static_fields
    }

    pub(super) fn define_remaining_class_layouts(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for class in (0..hir.classes.len() as u32).map(ClassId) {
            let is_ambient = hir[class].flags.contains(Flags::AMBIENT);
            if is_ambient || bound.class_scope[class.idx()].is_none() {
                continue;
            }
            let reference = ClassRef {
                file: self.file,
                class,
            };
            let layout = self.class_layout(reference);
            if !self.fragment.is_layout_defined(layout) {
                define_class_layout(self, class, None);
            }
        }
        for function in (0..hir.fns.len() as u32).map(FnId) {
            let reference = FunctionRef {
                file: self.file,
                function,
            };
            self.constructor_function_layout(reference);
        }
    }
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

pub(in crate::lower) fn define_class_layout(
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
    let base_class = file.find_base_class(reference);
    let base = match base_class {
        Some(base) => Some(file.class_layout(base)),
        // Each member more of the family of EventEmitter is one more place where its fields may lie, and an access tests few places.
        None if file.source != SourceKind::Program => None,
        // Where the type of the heritage is no class, its binding says what it is: a constructor function, or what a module of Bun's exports.
        None => {
            let parent = file.queries.class_parent(reference);
            parent.and_then(|parent| file.find_layout_of_parent(parent))
        }
    };
    let base = base.filter(|&it| it != layout);
    let mut supertypes: Supertypes = base.into_iter().collect();
    for written in file.hir.ids(node.implements) {
        if let Some(ty) = file.queries.written_type(written).written()
            && let Some(implemented) = file.find_layout_of_written_type(ty)
            && implemented != layout
            && !supertypes.contains(&implemented)
        {
            supertypes.push(implemented);
        }
    }
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
        static_fields: file.compute_static_fields(layout, reference),
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

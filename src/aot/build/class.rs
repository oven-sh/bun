use super::coerce::{Signature, Ty};
use super::{FileBuild, Fx, Place, Source};
use crate::declared::{Declared, prim};
use crate::fragment::{GlobalKey, LayoutKey};
use crate::id::{FuncId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{
    self, Args, CoerceReason, Field, FuncKind, LayoutKind, Method, MethodKind, NO_VARIABLE, Op,
    Operation, class_flags, field_flags, func_flags, method_flags,
};
use bun_sema::atom::{Atom, PRIVATE_NAME_PREFIX};
use bun_sema::bind::{Decl, FnOwner, MemberOwner, SymbolId};
use bun_sema::check::{Activation, Capture, ClassFacts, Receiver};
use bun_sema::hir::{
    ClassId, DecoratorOwner, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList, Member,
    MemberId, MemberKind, PatKind, PropKey,
};
use bun_sema::program::{FileId, Sym};
use bun_sema::types::TypeId;

#[derive(Copy, Clone)]
pub(crate) struct ClassInfo {
    pub(crate) layout: LayoutId,
    pub(crate) facts: ClassFacts,
    pub(crate) is_derived: bool,
    pub(crate) base: Option<(FileId, ClassId)>,
    pub(crate) ctor: FuncId,
}

impl ClassInfo {
    pub(crate) fn returns_constructed_object(&self) -> bool {
        self.facts.may_return_another_object || self.is_derived && !self.facts.has_fixed_layout
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(crate) enum ClassVariable {
    IsDeclared,
    IsBound,
    Class,
    Base,
    Key(MemberId),
    PrivateName(Atom),
    PrivateMethods,
    StaticPrivateMethod(FuncId),
}

#[derive(Copy, Clone)]
pub(crate) struct StaticMember {
    pub(crate) kind: StaticMemberKind,
    pub(crate) name: StrId,
    pub(crate) is_private: bool,
    pub(crate) on: (FileId, ClassId),
}

#[derive(Copy, Clone)]
pub(crate) enum StaticMemberKind {
    Field(Sym),
    Method(FuncId),
    Accessor { getter: FuncId, setter: FuncId },
}

#[derive(Clone, PartialEq)]
enum TypeMetadata {
    None,
    Never,
    Unknown,
    Any,
    Void,
    Null,
    Undefined,
    Function,
    Array,
    Boolean,
    String,
    Object,
    Number,
    Bigint,
    Symbol,
    Promise,
    Identifier(Atom),
    Dot(Vec<Atom>),
}

impl TypeMetadata {
    fn names_different_identifier(&self, other: &TypeMetadata) -> bool {
        matches!((self, other), (TypeMetadata::Identifier(own), TypeMetadata::Identifier(other)) if own != other)
    }

    fn finish_union(&mut self, object: Atom) -> Option<TypeMetadata> {
        match self {
            TypeMetadata::Identifier(name) => (*name == object).then_some(TypeMetadata::Object),
            TypeMetadata::Unknown | TypeMetadata::Any | TypeMetadata::Object => {
                Some(TypeMetadata::Object)
            }
            TypeMetadata::Never | TypeMetadata::Null | TypeMetadata::Undefined => {
                *self = TypeMetadata::None;
                None
            }
            _ => None,
        }
    }

    fn merge_union(&mut self, left: TypeMetadata) {
        if left == TypeMetadata::None {
            return;
        }
        if core::mem::discriminant(self) != core::mem::discriminant(&left) {
            *self = match self {
                TypeMetadata::Never | TypeMetadata::Undefined | TypeMetadata::Null => left,
                _ => TypeMetadata::Object,
            };
        } else if self.names_different_identifier(&left) {
            *self = TypeMetadata::Object;
        }
    }

    fn finish_intersection(&mut self, object: Atom) -> Option<TypeMetadata> {
        match self {
            TypeMetadata::Identifier(name) => (*name == object).then_some(TypeMetadata::Object),
            TypeMetadata::Never => Some(TypeMetadata::Never),
            TypeMetadata::Any | TypeMetadata::Object => Some(TypeMetadata::Object),
            TypeMetadata::Unknown | TypeMetadata::Null | TypeMetadata::Undefined => {
                *self = TypeMetadata::None;
                None
            }
            _ => None,
        }
    }

    fn merge_intersection(&mut self, left: TypeMetadata) {
        if left == TypeMetadata::None {
            if *self == TypeMetadata::Unknown {
                *self = TypeMetadata::Undefined;
            }
            return;
        }
        if core::mem::discriminant(self) != core::mem::discriminant(&left) {
            *self = match self {
                TypeMetadata::Unknown | TypeMetadata::Undefined | TypeMetadata::Null => left,
                TypeMetadata::Never => TypeMetadata::Never,
                _ => TypeMetadata::Object,
            };
        } else if self.names_different_identifier(&left) {
            *self = TypeMetadata::Object;
        }
    }

    fn of_union(members: Vec<TypeMetadata>, object: Atom) -> TypeMetadata {
        let mut result = TypeMetadata::None;
        for (i, member) in members.into_iter().enumerate() {
            let mut left = result;
            match left.finish_union(object).filter(|_| i > 0) {
                Some(finished) => result = finished,
                None => {
                    result = member;
                    if i > 0 {
                        result.merge_union(left);
                    }
                }
            }
        }
        result
    }

    fn from_intersection(members: Vec<TypeMetadata>, object: Atom) -> TypeMetadata {
        let mut result = TypeMetadata::None;
        for (i, member) in members.into_iter().enumerate() {
            let mut left = result;
            match left.finish_intersection(object).filter(|_| i > 0) {
                Some(finished) => result = finished,
                None => {
                    result = member;
                    if i > 0 {
                        result.merge_intersection(left);
                    }
                }
            }
        }
        result
    }
}

struct ClassScope {
    env: LayoutId,
    fields: Vec<Field>,
    module_variables: u32,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn class_for_expr(&mut self, file: FileId, e: ExprId) -> Option<(FileId, ClassId)> {
        let sym = self
            .binding_for_ident(file, e)
            .or_else(|| self.binding_for_namespace_member(file, e))?;
        let class = match self.value_declaration(sym)? {
            (file, Decl::Class(class)) => (file, class),
            (_, Decl::Var(_)) => self.c.class_for_const(sym)?,
            _ => return None,
        };
        (!self.is_ambient(sym) && !self.is_assigned(sym)).then_some(class)
    }

    fn binding_for_ident(&mut self, file: FileId, e: ExprId) -> Option<Sym> {
        let ExprKind::Ident(name) = self.hir(file)[e.some()?].kind else {
            return None;
        };
        self.ident_symbol(file, e, name)
    }

    fn binding_for_namespace_member(&mut self, file: FileId, e: ExprId) -> Option<Sym> {
        let ExprKind::Dot {
            obj,
            name,
            chain: bun_sema::hir::Chain::No,
            ..
        } = self.hir(file)[e.some()?].kind
        else {
            return None;
        };
        self.namespace_member_in(file, obj, name)
    }

    pub(crate) fn instance_layout(&mut self, file: FileId, class: ClassId) -> Option<LayoutId> {
        let info = self.class_info(file, class);
        info.facts.has_fixed_layout.then_some(info.layout)
    }

    pub(crate) fn instance_type(&mut self, file: FileId, class: ClassId) -> Ty {
        match self.instance_layout(file, class) {
            Some(layout) => Ty {
                id: self.layout_ty(layout),
                checked: self
                    .layout_types
                    .get(&layout)
                    .copied()
                    .unwrap_or(TypeId::UNRESOLVED),
            },
            None => Ty::NONE,
        }
    }

    pub(crate) fn class_info(&mut self, file: FileId, class: ClassId) -> ClassInfo {
        if let Some(&known) = self.classes.get(&(file, class)) {
            return known;
        }
        let c = &self.hir(file)[class];
        self.classes_in_progress.insert((file, class));
        let named = if c.extends.is_some() {
            self.class_for_expr(file, c.extends)
                .filter(|named| !self.classes_in_progress.contains(named))
        } else {
            None
        };
        let extended = named.map(|(file, base)| self.class_info(file, base));
        self.classes_in_progress.remove(&(file, class));
        let mut fresh_from_new = Vec::new();
        let mut at = named;
        while let Some(base) = at {
            fresh_from_new.push(base);
            at = self.classes[&base].base;
        }
        let facts = self.c.class_facts(
            file,
            class,
            extended.map(|base| base.facts),
            &fresh_from_new,
        );
        let base = named.filter(|_| facts.has_fixed_layout);
        let base_layout = extended
            .filter(|_| facts.has_fixed_layout)
            .map_or(LayoutId::NONE, |extended| extended.layout);
        let name = self.name_of_class(file, class);
        let layout = self.add_layout(LayoutKind::Instance, name, LayoutKey::Instance(file, class));
        self.out.layouts[layout.idx()].base = base_layout;
        if let Some(extended) =
            extended.filter(|extended| !facts.has_fixed_layout && extended.facts.has_fixed_layout)
        {
            self.constructs.insert(layout, extended.layout);
        }
        self.classes.insert(
            (file, class),
            ClassInfo {
                layout,
                facts,
                is_derived: c.extends.is_some(),
                base,
                ctor: FuncId::NONE,
            },
        );
        if facts.has_fixed_layout {
            self.compute_class_layout(file, class, layout, base_layout);
        }
        self.classes[&(file, class)]
    }

    fn instance_field_name(&mut self, file: FileId, member: MemberId) -> Atom {
        match self.hir(file)[member].key {
            PropKey::Name(name) | PropKey::Private(name) => name,
            PropKey::Computed(key) => self
                .c
                .fold_constant_string(file, key)
                .map(|(name, _)| name)
                .or_else(|| self.c.property_named_by_constant_symbol(file, key))
                .unwrap_or(Atom::NONE),
            PropKey::None => Atom::NONE,
        }
    }

    fn compute_class_layout(
        &mut self,
        file: FileId,
        class: ClassId,
        layout: LayoutId,
        base: LayoutId,
    ) {
        let hir = self.hir(file);
        let c = &hir[class];
        let bound = self.c.bound(file);
        let instances = self.c.class_instance_type(file, class);
        self.layout_types.insert(layout, instances);
        if base.is_some() {
            for i in 0..self.out.layouts[base.idx()].fields.len() {
                let field = &self.out.layouts[base.idx()].fields[i];
                let copy = Field::new(field.name, TyId::NONE, field.flags);
                self.out.layouts[layout.idx()].fields.push(copy);
            }
        }
        let mut declared_by: Vec<(u32, Sym)> = Vec::new();
        let mut add = |this: &mut Self, name: Atom, symbol: SymbolId, flags: Flags| {
            if !Self::is_field_name(this.c.atoms().bytes(name)) {
                return;
            }
            let name = this.str(name);
            let fields = &mut this.out.layouts[layout.idx()].fields;
            let index = fields
                .iter()
                .position(|field| field.name == name)
                .unwrap_or_else(|| {
                    fields.push(Field::new(name, TyId::NONE, 0));
                    fields.len() - 1
                });
            if fields[index].flags & field_flags::ABSENT_AT_CREATION != 0 {
                fields[index].flags &= !(field_flags::ABSENT_AT_CREATION | field_flags::OPTIONAL);
            }
            if flags.contains(Flags::OPTIONAL) {
                fields[index].flags |= field_flags::OPTIONAL;
            }
            if symbol.is_some() {
                declared_by.push((index as u32, this.files.sym(file, symbol)));
            }
        };
        if let Some(constructor) = self.c.class_constructor(file, class) {
            for p in hir[constructor].params.iter() {
                if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                    && let PatKind::Ident(name) = hir[hir[p].pat].kind
                {
                    add(
                        self,
                        name,
                        bound.symbol_of_declaration(Decl::ParameterProperty(p)),
                        hir[p].flags,
                    );
                }
            }
        }
        let mut named_by_constants: Vec<Atom> = Vec::new();
        for member in c.members.iter() {
            let m = &hir[member];
            if m.kind != MemberKind::Property
                || m.flags
                    .intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT)
                || self.c.is_field_omitted(file, member)
            {
                continue;
            }
            let name = self.instance_field_name(file, member);
            if name.is_some() {
                add(self, name, bound.member_symbol[member.idx()], m.flags);
                if bound.member_symbol[member.idx()].is_none() {
                    named_by_constants.push(name);
                }
            }
        }
        let mut implemented: Vec<(u32, TypeId, Atom)> = Vec::new();
        for name in named_by_constants {
            let text = self.str(name);
            if let Some(field) = self.out.layouts[layout.idx()]
                .fields
                .iter()
                .position(|field| field.name == text)
            {
                implemented.push((field as u32, instances, name));
            }
        }
        for (interface, name) in self.c.implemented_optional_properties(file, class) {
            let bytes = self.c.atoms().bytes(name);
            if bytes.first() == Some(&0xFE) || bytes == b"__proto__" || !Self::is_field_name(bytes)
            {
                continue;
            }
            let text = self.str(name);
            let fields = &mut self.out.layouts[layout.idx()].fields;
            if !fields.iter().any(|field| field.name == text) {
                implemented.push((fields.len() as u32, interface, name));
                fields.push(Field::new(
                    text,
                    TyId::NONE,
                    field_flags::OPTIONAL | field_flags::ABSENT_AT_CREATION,
                ));
            }
        }
        for name in self.c.declared_only_properties(file, class) {
            let bytes = self.c.atoms().bytes(name);
            if bytes.first() == Some(&0xFE) || bytes == b"__proto__" || !Self::is_field_name(bytes)
            {
                continue;
            }
            let text = self.str(name);
            let fields = &mut self.out.layouts[layout.idx()].fields;
            if !fields.iter().any(|field| field.name == text) {
                implemented.push((fields.len() as u32, instances, name));
                fields.push(Field::new(
                    text,
                    TyId::NONE,
                    field_flags::OPTIONAL | field_flags::ABSENT_AT_CREATION,
                ));
            }
        }
        for name in self.c.methods_with_fields(file, class) {
            let text = self.str(name);
            let fields = &mut self.out.layouts[layout.idx()].fields;
            if !fields.iter().any(|field| field.name == text) {
                implemented.push((fields.len() as u32, instances, name));
                fields.push(Field::new(
                    text,
                    TyId::NONE,
                    field_flags::OPTIONAL | field_flags::ABSENT_AT_CREATION | field_flags::METHOD,
                ));
            }
        }
        let symbol = Sym {
            file,
            id: bound.class_symbol[class.idx()],
        };
        self.set_class_field_types(layout, symbol, base, declared_by, implemented);
    }

    pub(crate) fn define_class(&mut self, file: FileId, class: ClassId) -> ClassInfo {
        let info = self.class_info(file, class);
        if info.ctor.is_some() || !self.classes_being_defined.insert((file, class)) {
            return self.classes[&(file, class)];
        }
        if let Some((file, base)) = info.base {
            self.define_class(file, base);
        }
        let problem_count_before = std::mem::take(&mut self.problems);
        let hir = self.hir(file);
        let c = &hir[class];
        let bound = self.c.bound(file);
        let (facts, layout) = (info.facts, info.layout);

        let mut scope = ClassScope {
            env: LayoutId::NONE,
            fields: Vec::new(),
            module_variables: 0,
        };
        if facts.is_evaluated_once {
            let name = self.name_of_class(file, class);
            let boolean = self.known.boolean;
            self.add_class_variable(
                &mut scope,
                (file, class, ClassVariable::IsDeclared),
                name,
                boolean,
            );
            let runs_static_code = c.members.iter().any(|member| {
                let m = &hir[member];
                m.kind == MemberKind::StaticBlock
                    || m.kind == MemberKind::Property
                        && m.flags.contains(Flags::STATIC)
                        && m.init.is_some()
            });
            if runs_static_code {
                self.add_class_variable(
                    &mut scope,
                    (file, class, ClassVariable::IsBound),
                    name,
                    boolean,
                );
            }
        } else {
            scope.env = self.add_layout(
                LayoutKind::Environment,
                StrId::NONE,
                LayoutKey::ClassEnvironment(file, class),
            );
            debug_assert!(file == self.file);
            let was = self
                .activation_layouts
                .insert(Activation::Class(class), scope.env);
            self.index_activation_layout(Activation::Class(class));
            if let Some(undo) = &mut self.undo {
                undo.activation_layouts
                    .push((Activation::Class(class), was));
            }
            self.activations.insert(scope.env, Activation::Class(class));
            let imports = self.c.class_imports(file, class);
            for &import in &imports {
                let (index, declared) = (scope.fields.len() as u32, self.capture_ty(import));
                let name = match import {
                    Capture::Variable(sym) => self.str(self.files.symbol(sym).name),
                    _ => StrId::NONE,
                };
                scope
                    .fields
                    .push(Field::new(name, declared.id, field_flags::IMMUTABLE));
                self.checked_fields
                    .insert((scope.env, index), declared.checked);
            }
            self.imports.insert(scope.env, imports);
            self.add_hidden_variable(&mut scope, (file, class, ClassVariable::Class), b"class");
            if info
                .base
                .is_some_and(|base| !self.classes[&base].facts.is_evaluated_once)
            {
                self.add_hidden_variable(
                    &mut scope,
                    (file, class, ClassVariable::Base),
                    b"extends",
                );
            }
        }
        let environment = scope.env;

        let mut ctor = FuncId::NONE;
        let mut methods: Vec<Method> = Vec::new();
        let mut static_fields: Vec<(StrId, TyId)> = Vec::new();
        let mut has_private_methods = false;
        for member in c.members.iter() {
            let m = &hir[member];
            if m.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT) {
                continue;
            }
            let is_static = m.flags.contains(Flags::STATIC);
            if let PropKey::Private(name) = m.key
                && !is_static
                && !facts.has_fixed_layout
                && !self.class_variables.contains_key(&(
                    file,
                    class,
                    ClassVariable::PrivateName(name),
                ))
            {
                let text = self.private_name_text(name).unwrap_or_default();
                self.add_hidden_variable(
                    &mut scope,
                    (file, class, ClassVariable::PrivateName(name)),
                    &text,
                );
            }
            match m.kind {
                MemberKind::Constructor
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::StaticBlock
                    if m.func.is_none() || matches!(hir[m.func].body, FnBody::None) => {}
                MemberKind::Constructor => {
                    ctor = self.declare_function(file, m.func, Some((file, class)));
                }
                MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                    if let PropKey::Computed(written) = m.key {
                        let prefix: &[u8] = match m.kind {
                            MemberKind::Getter => b"get ",
                            MemberKind::Setter => b"set ",
                            _ => b"",
                        };
                        self.name_from_well_known_symbol(file, m.func, written, prefix);
                    }
                    let func = self.declare_member_function(file, class, m.func, is_static);
                    if !is_static && facts.has_fixed_layout {
                        self.declare_generic_entrypoint(file, class, m.func, func);
                    }
                    let mut method = Method {
                        name: StrId::NONE,
                        func,
                        kind: match m.kind {
                            MemberKind::Getter => MethodKind::Getter,
                            MemberKind::Setter => MethodKind::Setter,
                            _ => MethodKind::Method,
                        },
                        flags: if is_static { method_flags::STATIC } else { 0 },
                        key: NO_VARIABLE,
                    };
                    match m.key {
                        PropKey::Name(name) => method.name = self.str(name),
                        PropKey::Private(name) => {
                            method.name = self.str(name);
                            has_private_methods |= !is_static && !facts.has_fixed_layout;
                            if is_static && m.kind == MemberKind::Method && scope.env.is_some() {
                                self.add_cached_closure(
                                    &mut scope,
                                    (file, class, ClassVariable::StaticPrivateMethod(func)),
                                    func,
                                );
                            }
                        }
                        PropKey::Computed(key) => {
                            if !self.is_untyped_file(file) && self.c.is_symbol_name(file, key) {
                                let name = self.out.strs.intern(b"key");
                                let symbol = self.out.tys.intern(Declared::prims(prim::SYMBOL));
                                method.flags |= method_flags::KEY_IS_SYMBOL;
                                method.key = self.add_class_variable(
                                    &mut scope,
                                    (file, class, ClassVariable::Key(member)),
                                    name,
                                    symbol,
                                );
                            } else {
                                method.key = self.add_hidden_variable(
                                    &mut scope,
                                    (file, class, ClassVariable::Key(member)),
                                    b"key",
                                );
                            }
                        }
                        PropKey::None => continue,
                    }
                    methods.push(method);
                }
                MemberKind::StaticBlock => {
                    self.declare_member_function(file, class, m.func, true);
                }
                MemberKind::Property => {
                    if m.flags.contains(Flags::ACCESSOR) && !matches!(m.key, PropKey::Private(_)) {
                        self.problem(file, m.name_pos, "an `accessor` field");
                    }
                    let symbol = bound.member_symbol[member.idx()];
                    match m.key {
                        PropKey::Computed(_)
                            if self.is_field_named_by_constant_symbol(file, class, member) => {}
                        PropKey::Computed(_) => {
                            self.add_hidden_variable(
                                &mut scope,
                                (file, class, ClassVariable::Key(member)),
                                b"key",
                            );
                        }
                        PropKey::Private(_) if is_static && symbol.is_some() => {
                            self.add_static_field(&mut scope, self.files.sym(file, symbol));
                        }
                        PropKey::Name(name)
                            if is_static && symbol.is_some() && !self.is_untyped_file(file) =>
                        {
                            let sym = self.files.sym(file, symbol);
                            let declared = if self.c.is_annotated(sym) {
                                self.symbol_ty(sym).id
                            } else {
                                TyId::NONE
                            };
                            static_fields.push((self.str(name), declared));
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        if has_private_methods {
            self.add_hidden_variable(
                &mut scope,
                (file, class, ClassVariable::PrivateMethods),
                b"private methods",
            );
        }
        if ctor.is_none() {
            ctor = self.declare_default_constructor(file, class, info);
        }
        self.finish_constructor(file, class, info, ctor);
        if self.hir(file)[class].name.is_none() {
            self.out.funcs[ctor.idx()].flags |= func_flags::HAS_EXPLICIT_NAME;
        }
        if environment.is_some() {
            self.out.layouts[environment.idx()].fields = scope.fields;
        }

        let mut flags = self.out.layouts[layout.idx()].class_flags;
        for (flag, is_set) in [
            (class_flags::HAS_FIXED_LAYOUT, facts.has_fixed_layout),
            (class_flags::IS_EVALUATED_ONCE, facts.is_evaluated_once),
            (
                class_flags::HAS_UNTYPED_BASE,
                info.is_derived && !facts.has_fixed_layout,
            ),
            (class_flags::HAS_FIXED_MEMBERS, !self.is_untyped_file(file)),
            (
                class_flags::HAS_COMPUTED_STATIC_MEMBER,
                self.has_computed_static_member(file, class),
            ),
        ] {
            if is_set {
                flags |= flag;
            }
        }
        let out = &mut self.out.layouts[layout.idx()];
        out.class_flags = flags;
        out.constructor = ctor;
        out.methods = methods;
        out.static_fields = static_fields;
        out.environment = environment;
        let info = ClassInfo { ctor, ..info };
        self.classes.insert((file, class), info);
        self.classes_being_defined.remove(&(file, class));
        let problems = std::mem::replace(&mut self.problems, problem_count_before);
        if !problems.is_empty() {
            self.layout_problems.insert(layout, problems);
        }
        info
    }

    fn add_class_variable(
        &mut self,
        scope: &mut ClassScope,
        key: (FileId, ClassId, ClassVariable),
        name: StrId,
        declared: TyId,
    ) -> u32 {
        if scope.env.is_none() {
            scope.module_variables += 1;
            let global = self.add_global(
                name,
                key.0,
                Ty::from_id(declared),
                GlobalKey::ClassVariable(key.0, key.1, scope.module_variables - 1),
            );
            self.class_variables.insert(key, Place::Global(global));
            return global.0;
        }
        let index = scope.fields.len() as u32;
        scope.fields.push(Field::new(name, declared, 0));
        self.class_variables
            .insert(key, Place::Env(scope.env, index));
        index
    }

    fn add_hidden_variable(
        &mut self,
        scope: &mut ClassScope,
        key: (FileId, ClassId, ClassVariable),
        name: &[u8],
    ) -> u32 {
        let name = self.out.strs.intern(name);
        let variable = self.add_class_variable(scope, key, name, TyId::NONE);
        if scope.env.is_none() {
            let is_stored_once = matches!(
                key.2,
                ClassVariable::PrivateName(_) | ClassVariable::PrivateMethods
            ) && !self.is_lazily_evaluated(key.0);
            self.out.globals[variable as usize].initialization = if is_stored_once {
                ir::Initialization::NeverReadUninitializedStoredOnce
            } else {
                ir::Initialization::Undefined
            };
        }
        variable
    }

    fn add_cached_closure(
        &mut self,
        scope: &mut ClassScope,
        key: (FileId, ClassId, ClassVariable),
        single_function: FuncId,
    ) {
        let index = scope.fields.len() as u32;
        let declared = self.or_undefined(self.known.function);
        scope.fields.push(Field {
            single_function,
            single_function_flags: ir::single_function_flags::OR_NULLISH,
            ..Field::new(StrId::NONE, declared, 0)
        });
        self.cached_closures.insert((scope.env, index));
        self.class_variables
            .insert(key, Place::Env(scope.env, index));
    }

    fn add_static_field(&mut self, scope: &mut ClassScope, sym: Sym) -> u32 {
        if scope.env.is_none() {
            return self.symbol_global(sym).0;
        }
        let index = scope.fields.len() as u32;
        let name = self.str(self.files.symbol(sym).name);
        let declared = self.symbol_ty(sym);
        scope.fields.push(Field::new(name, declared.id, 0));
        self.checked_fields
            .insert((scope.env, index), declared.checked);
        if self.c.is_annotated(sym) {
            self.annotated_fields.insert((scope.env, index));
        }
        let was = self.places.insert(sym, Place::Env(scope.env, index));
        if let Some(undo) = &mut self.undo {
            undo.places.push((sym, was));
        }
        index
    }

    fn declare_member_function(
        &mut self,
        file: FileId,
        class: ClassId,
        func: FnId,
        is_static: bool,
    ) -> FuncId {
        let captures = self.c.function_captures(file, func);
        let id = self.declare_function(file, func, Some((file, class)));
        if is_static {
            let accepts_this = captures || self.c.inspects_this(file, func);
            let out = &mut self.out.funcs[id.idx()];
            out.declared_this_type = TyId::NONE;
            out.flags = if accepts_this {
                out.flags | func_flags::HAS_THIS
            } else {
                out.flags & !func_flags::HAS_THIS
            };
            if let Some(signature) = self.signatures.get_mut(&id) {
                signature.this = None;
            }
        }
        id
    }

    fn declare_generic_entrypoint(
        &mut self,
        file: FileId,
        class: ClassId,
        func: FnId,
        whole: FuncId,
    ) {
        if file != self.file
            || self.generic_entrypoints.contains_key(&whole)
            || !self.c.may_use_untyped_clones(file, class)
            || self.uses_arguments(file, func)
            || !self.c.method_has_untyped_clone(file, func)
            || !self.c.fn_captures(file, func).is_empty()
        {
            return;
        }
        let entry = self.declare_function_as(file, func, Some((file, class)), super::Role::Beside);
        let second = self.declare_function_as(file, func, Some((file, class)), super::Role::Second);
        self.typed_bodies.insert(entry, whole);
        self.untyped_clones.insert(entry, second);
        self.generic_entrypoints.insert(whole, entry);
        self.generic_entrypoint_ids.insert(entry);
    }

    pub(crate) fn forward_declare_constructor(&mut self, file: FileId, class: ClassId) -> FuncId {
        if let Some(declared) = self.c.class_constructor(file, class) {
            return self.forward_declare_function(file, declared);
        }
        if let Some(defined) = self
            .classes
            .get(&(file, class))
            .map(|info| info.ctor)
            .filter(|ctor| ctor.is_some())
        {
            return defined;
        }
        if let Some(&named) = self.named_default_constructors.get(&(file, class)) {
            return named;
        }
        let id = self.add_header(
            StrId::NONE,
            ModuleId::NONE,
            0,
            FuncKind::Constructor,
            Source::DefaultConstructor { file, class },
        );
        self.named_default_constructors.insert((file, class), id);
        id
    }

    fn declare_default_constructor(
        &mut self,
        file: FileId,
        class: ClassId,
        info: ClassInfo,
    ) -> FuncId {
        let name = self.name_of_class(file, class);
        let module = self.module_of(file);
        let start = self.hir(file)[class].start;
        let ctor = self.add_func(
            name,
            module,
            start,
            FuncKind::Constructor,
            Source::DefaultConstructor { file, class },
        );
        let mut signature = Signature::default();
        let mut declared_this_type = TyId::NONE;
        if info.facts.has_fixed_layout {
            declared_this_type = self.layout_ty(info.layout);
            signature.this = self.layout_types.get(&info.layout).copied();
        }
        let (mut params, mut annotated, mut flags) = (Vec::new(), Vec::new(), func_flags::HAS_THIS);
        match info.base {
            Some(base) => {
                let base = self.classes[&base].ctor;
                let uses_new_target =
                    usize::from(self.out.funcs[base.idx()].has(func_flags::HAS_NEW_TARGET));
                let extended = &self.out.funcs[base.idx()];
                params = extended.params[uses_new_target..].to_vec();
                annotated = extended
                    .annotated
                    .get(uses_new_target..)
                    .unwrap_or_default()
                    .to_vec();
                flags |= extended.flags & func_flags::HAS_REST;
                signature.params = self.signatures.get(&base).map_or(Vec::new(), |extended| {
                    extended
                        .params
                        .get(uses_new_target..)
                        .unwrap_or_default()
                        .to_vec()
                });
            }
            None if info.is_derived => {
                params.push(TyId::NONE);
                flags |= func_flags::HAS_REST;
            }
            None => {}
        }
        self.set_signature(ctor, signature);
        let out = &mut self.out.funcs[ctor.idx()];
        out.flags = flags;
        out.params = params;
        out.annotated = annotated;
        out.declared_this_type = declared_this_type;
        if !info.facts.is_evaluated_once && self.c.constructor_captures(file, class) {
            self.set_captures(ctor, &[Capture::Environment(Activation::Class(class))]);
        }
        ctor
    }

    fn finish_constructor(&mut self, file: FileId, class: ClassId, info: ClassInfo, ctor: FuncId) {
        let name = self.name_of_class(file, class);
        let instance = self.instance_type(file, class);
        let signature = self.signatures.entry(ctor).or_default();
        let out = &mut self.out.funcs[ctor.idx()];
        out.name = name;
        out.flags |= func_flags::IS_VALUE;
        if !info.facts.has_fixed_layout {
            out.declared_this_type = TyId::NONE;
            signature.this = None;
        }
        if info.facts.uses_new_target {
            out.flags |= func_flags::HAS_NEW_TARGET;
            out.params.insert(0, TyId::NONE);
            if !out.annotated.is_empty() {
                out.annotated.insert(0, false);
            }
            if !signature.params.is_empty() {
                signature.params.insert(0, TypeId::UNRESOLVED);
            }
        }
        if info.returns_constructed_object() {
            out.result = instance.id;
            signature.result = (instance.checked != TypeId::UNRESOLVED).then_some(instance.checked);
        }
    }

    pub(crate) fn instance_field_spans(&self, file: FileId, class: ClassId) -> Vec<(u32, u32)> {
        let hir = self.hir(file);
        let is_initialized = |m: &Member| {
            m.kind == MemberKind::Property
                && !m
                    .flags
                    .intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT)
        };
        hir[class]
            .members
            .iter()
            .filter(|&member| !self.c.is_field_omitted(file, member))
            .map(|member| &hir[member])
            .filter(|m| is_initialized(m))
            .map(|m| (m.start, m.loc.end))
            .collect()
    }

    pub(crate) fn pending_class_for(&self, func: FuncId) -> Option<(FileId, ClassId)> {
        let class = match self.sources[func.idx()] {
            Source::Function {
                class: Some(class), ..
            } => class,
            Source::DefaultConstructor { file, class } => (file, class),
            _ => return None,
        };
        (!self.declared_classes.contains(&class)).then_some(class)
    }

    fn did_declare_class(&mut self, file: FileId, class: ClassId) {
        self.declared_classes.insert((file, class));
        let info = self.classes[&(file, class)];
        self.declares.push(info.layout);
        if info.facts.has_fixed_layout {
            self.record_allocation(info.layout);
        }
        if let Some(waiting) = self.waiting_for_class.remove(&(file, class)) {
            self.work.extend(waiting);
        }
    }

    pub(crate) fn is_bound_once(&self, sym: Sym) -> bool {
        self.value_declaration(sym)
            .is_some_and(|(file, decl)| self.c.is_bound_once(file, decl))
    }

    fn can_reach_slot(&self, fx: &Fx, place: Option<Place>) -> bool {
        match place {
            Some(Place::Global(_)) => true,
            Some(Place::Env(layout, _)) => self.can_reach_env(fx, layout),
            None => false,
        }
    }

    fn read_class_variable(
        &mut self,
        fx: &mut Fx,
        file: FileId,
        class: ClassId,
        which: ClassVariable,
    ) -> V {
        match self.class_variables.get(&(file, class, which)).copied() {
            Some(Place::Global(global)) => self.emit_throwing(fx, Op::GlobalGet(global)),
            Some(Place::Env(layout, field)) => {
                let env = self.env_for_layout(fx, layout);
                self.emit_throwing(
                    fx,
                    Op::FieldGet {
                        obj: env,
                        layout,
                        field,
                    },
                )
            }
            None => self.unsupported(fx, 0, "a private member outside its class"),
        }
    }

    fn write_class_variable(
        &mut self,
        fx: &mut Fx,
        file: FileId,
        class: ClassId,
        which: ClassVariable,
        value: V,
    ) {
        match self.class_variables.get(&(file, class, which)).copied() {
            Some(Place::Global(global)) => {
                self.emit(fx, Op::GlobalSet(global, value));
            }
            Some(Place::Env(layout, field)) => {
                let env = self.env_for_layout(fx, layout);
                self.emit(
                    fx,
                    Op::FieldSet {
                        obj: env,
                        layout,
                        field,
                        value,
                    },
                );
            }
            None => {}
        }
    }

    pub(crate) fn class_object(&mut self, fx: &mut Fx, file: FileId, class: ClassId) -> V {
        if !fx.b.is_open() {
            return self.emit(fx, Op::Undefined);
        }
        let info = self.define_class(file, class);
        if info.facts.is_evaluated_once {
            return self.emit(fx, Op::FuncRef(info.ctor));
        }
        if self.can_reach_env(fx, self.out.layouts[info.layout.idx()].environment) {
            return self.read_class_variable(fx, file, class, ClassVariable::Class);
        }
        let sym = self.class_symbol(file, class);
        if fx.locals.contains_key(&sym) || self.places.contains_key(&sym) {
            return self.read_sym(fx, sym, 0);
        }
        self.unsupported(fx, 0, "a class outside the scope it is declared in")
    }

    pub(crate) fn class_as_value(&mut self, fx: &mut Fx, file: FileId, class: ClassId) -> V {
        let mut reached = Some((file, class));
        while let Some((file, class)) = reached {
            let info = self.class_info(file, class);
            if !info.facts.has_fixed_layout || !self.classes_as_values_set.insert(info.layout) {
                break;
            }
            self.classes_as_values.push(info.layout);
            reached = info.base;
        }
        self.class_object(fx, file, class)
    }

    pub(crate) fn is_within_class_environment(
        &mut self,
        fx: &Fx,
        file: FileId,
        class: ClassId,
    ) -> bool {
        let info = self.define_class(file, class);
        let environment = self.out.layouts[info.layout.idx()].environment;
        !info.facts.is_evaluated_once
            && environment.is_some()
            && self.can_reach_env(fx, environment)
    }

    pub(crate) fn emit_class_tdz_check(
        &mut self,
        fx: &mut Fx,
        file: FileId,
        class: ClassId,
        e: ExprId,
    ) {
        self.emit_default_export_tdz_check(fx, e);
        if e.is_some()
            && file == fx.file
            && self.c.is_in_class_heritage_or_computed_key(file, e, class)
        {
            let name = match self.hir(file)[e].kind {
                ExprKind::Ident(name) => name,
                _ => self.files.symbol(self.class_symbol(file, class)).name,
            };
            let name = self.c.atoms().bytes(name).to_vec();
            let message = if self.shared.constants.minifies_identifiers {
                [&[crate::names::TDZ_MARKER][..], &name].concat()
            } else {
                crate::names::tdz_error_message(&name)
            };
            return self.throw_error(fx, b"ReferenceError", &message);
        }
        if let Some(constant) = self
            .binding_for_ident(fx.file, e)
            .filter(|&named| self.c.class_for_const(named).is_some())
        {
            if self.c.may_be_in_tdz(constant, fx.file, e) {
                self.read_reference(fx, constant, e);
            }
            return;
        }
        if fx.class == Some((file, class)) {
            return;
        }
        let sym = self.class_symbol(file, class);
        if !self.c.may_be_in_tdz(sym, fx.file, e) {
            return;
        }
        if self.define_class(file, class).facts.is_evaluated_once {
            let is_outside =
                !(e.is_some() && file == fx.file && self.c.is_inside_class(file, e, class));
            let which = if is_outside
                && self
                    .class_variables
                    .contains_key(&(file, class, ClassVariable::IsBound))
            {
                ClassVariable::IsBound
            } else {
                ClassVariable::IsDeclared
            };
            self.read_class_variable(fx, file, class, which);
        } else if e.is_some() && (fx.locals.contains_key(&sym) || self.places.contains_key(&sym)) {
            self.read_reference(fx, sym, e);
        }
    }

    pub(crate) fn emit_class(&mut self, fx: &mut Fx, class: ClassId, binding: Option<Sym>) -> V {
        let file = fx.file;
        let hir = self.hir(file);
        let c = &hir[class];
        let info = self.define_class(file, class);
        let (facts, layout) = (info.facts, info.layout);
        let bound = self.c.bound(file);
        let is_decorated = hir.decorators.iter().any(|&(owner, _)| match owner {
            DecoratorOwner::Class(decorated) => decorated == class,
            DecoratorOwner::Member(member) => bound.member_owner[member.idx()] == MemberOwner::Class(class),
            DecoratorOwner::Param(p) => matches!(bound.fns.get(bound.param_fn[p.idx()].idx()).map(|func| func.owner), Some(FnOwner::Member(member)) if bound.member_owner[member.idx()] == MemberOwner::Class(class)),
        });
        let lowers_decorators = is_decorated && self.files.lowers_decorators(file);
        if is_decorated
            && !lowers_decorators
            && !self.shared.constants.leaves_decorators_to_the_bundler
        {
            self.problem(file, c.start, "a decorator");
        }
        let key_name = std::mem::replace(&mut self.key_name_value, V::NONE);
        let name = self.name_of_class(file, class);
        self.out.layouts[layout.idx()].name = name;
        self.out.funcs[info.ctor.idx()].name = name;
        for which in [ClassVariable::IsDeclared, ClassVariable::IsBound] {
            if let Some(&Place::Global(flag)) = self.class_variables.get(&(file, class, which)) {
                self.out.globals[flag.idx()].name = name;
            }
        }
        self.did_declare_class(file, class);

        let environment = self.out.layouts[layout.idx()].environment;
        let mut env = V::NONE;
        if environment.is_some() {
            env = self.new_environment(fx, environment);
            for (field, import) in self
                .imports
                .get(&environment)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .enumerate()
            {
                let value = self.capture_value(fx, import, c.start);
                self.emit(
                    fx,
                    Op::FieldSet {
                        obj: env,
                        layout: environment,
                        field: field as u32,
                        value,
                    },
                );
            }
            self.push_env(fx, environment, env);
        }
        let mut base = V::NONE;
        if c.extends.is_some() {
            match info.base {
                Some((file, extended))
                    if self.classes[&(file, extended)].facts.is_evaluated_once =>
                {
                    self.emit_class_tdz_check(fx, file, extended, c.extends)
                }
                _ => base = self.expr(fx, c.extends),
            }
        }
        let has_computed_names = c.members.iter().any(|member| {
            self.class_variables
                .contains_key(&(file, class, ClassVariable::Key(member)))
        });
        let prototype_parent = if base.is_some() && info.base.is_none() && has_computed_names {
            self.read_heritage(fx, base, c.extends)
        } else {
            V::NONE
        };
        for member in c.members.iter() {
            let m = &hir[member];
            match m.key {
                PropKey::Private(name)
                    if self.is_first_member_with_name(file, class, member)
                        && self.class_variables.contains_key(&(
                            file,
                            class,
                            ClassVariable::PrivateName(name),
                        )) =>
                {
                    let text = self.private_name_text(name).unwrap_or_default();
                    let text = self.out.strs.intern(&text);
                    let text = self.emit(fx, Op::Str(text));
                    let key = self.operation(fx, Operation::NewPrivateName, &[text]);
                    self.write_class_variable(
                        fx,
                        file,
                        class,
                        ClassVariable::PrivateName(name),
                        key,
                    );
                }
                _ => {}
            }
        }
        for member in c.members.iter() {
            match hir[member].key {
                PropKey::Computed(key)
                    if self.class_variables.contains_key(&(
                        file,
                        class,
                        ClassVariable::Key(member),
                    )) =>
                {
                    let key = self.expr(fx, key);
                    let key = self.emit_throwing(fx, Op::ToKey(key));
                    self.write_class_variable(fx, file, class, ClassVariable::Key(member), key);
                }
                PropKey::Computed(key)
                    if self.is_field_named_by_constant_symbol(file, class, member) =>
                {
                    self.emit_tdz_check(fx, key)
                }
                _ => {}
            }
        }

        let mut class_object = V::NONE;
        if !facts.is_evaluated_once {
            let closure = self.emit(
                fx,
                Op::Closure {
                    func: info.ctor,
                    captures: [env].into_iter().collect(),
                },
            );
            class_object = closure;
            if base.is_none() {
                base = self.emit(fx, Op::Undefined);
            }
            let outer = fx.b.pos;
            if c.extends.is_some() {
                fx.b.pos = self.last_pos(fx, c.extends);
            }
            if prototype_parent.is_some() {
                self.operation(fx, Operation::MakeClass, &[closure, base, prototype_parent]);
            } else {
                self.operation(fx, Operation::MakeClass, &[closure, base]);
            }
            fx.b.pos = outer;
            let declares_name = c.members.iter().any(|member| {
                let m = &hir[member];
                m.flags.contains(Flags::STATIC)
                    && matches!(
                        m.kind,
                        MemberKind::Method | MemberKind::Getter | MemberKind::Setter
                    )
                    && matches!(m.key, PropKey::Name(name) if self.c.atoms().bytes(name) == b"name")
            });
            if key_name.is_some() && !declares_name {
                let kind = self.emit(fx, Op::Int(0));
                self.operation(fx, Operation::SetFunctionName, &[closure, key_name, kind]);
            }
            self.write_class_variable(fx, file, class, ClassVariable::Class, closure);
            self.write_class_variable(fx, file, class, ClassVariable::Base, base);
        } else {
            if info.is_derived && !facts.has_fixed_layout {
                let closure = self.emit(fx, Op::FuncRef(info.ctor));
                let outer = fx.b.pos;
                fx.b.pos = self.last_pos(fx, c.extends);
                if prototype_parent.is_some() {
                    self.operation(fx, Operation::MakeClass, &[closure, base, prototype_parent]);
                } else {
                    self.operation(fx, Operation::MakeClass, &[closure, base]);
                }
                fx.b.pos = outer;
            }
            let yes = self.emit(fx, Op::Bool(true));
            self.write_class_variable(fx, file, class, ClassVariable::IsDeclared, yes);
        }
        self.emit_private_methods(fx, file, class);
        self.emit_static_members(fx, file, class);
        if !facts.is_evaluated_once
            && let Some(sym) = binding
        {
            self.initialize_sym(fx, sym, class_object, c.start);
        }
        if self
            .class_variables
            .contains_key(&(file, class, ClassVariable::IsBound))
        {
            let yes = self.emit(fx, Op::Bool(true));
            self.write_class_variable(fx, file, class, ClassVariable::IsBound, yes);
        }
        if environment.is_some() {
            fx.envs.pop();
        }
        if lowers_decorators {
            self.emit_legacy_decorators(fx, class, binding, class_object);
        }
        class_object
    }

    fn type_metadata(&self, file: FileId, ty: bun_sema::hir::TypeNodeId) -> TypeMetadata {
        use bun_sema::hir::{Keyword, TypeNodeKind as Kind};
        if ty.is_none() {
            return TypeMetadata::None;
        }
        let hir = self.hir(file);
        let object = self.c.atoms().intern(b"Object");
        match hir[ty].kind {
            Kind::Keyword(keyword) => match keyword {
                Keyword::Any => TypeMetadata::Any,
                Keyword::Unknown => TypeMetadata::Unknown,
                Keyword::Never => TypeMetadata::Never,
                Keyword::Void => TypeMetadata::Void,
                Keyword::Undefined => TypeMetadata::Undefined,
                Keyword::Null => TypeMetadata::Null,
                Keyword::String => TypeMetadata::String,
                Keyword::Number => TypeMetadata::Number,
                Keyword::Boolean => TypeMetadata::Boolean,
                Keyword::BigInt => TypeMetadata::Bigint,
                Keyword::Symbol => TypeMetadata::Symbol,
                Keyword::Object | Keyword::This | Keyword::Intrinsic => TypeMetadata::Object,
            },
            Kind::Ref { name, .. } => {
                let names: Vec<Atom> = name.iter().map(|part| hir[part].text).collect();
                if names.len() == 1 {
                    TypeMetadata::Identifier(names[0])
                } else {
                    TypeMetadata::Dot(names)
                }
            }
            Kind::StringLit(_) | Kind::Template { .. } => TypeMetadata::String,
            Kind::NumberLit(_) => TypeMetadata::Number,
            Kind::BigIntLit { .. } => TypeMetadata::Bigint,
            Kind::BoolLit(_) => TypeMetadata::Boolean,
            Kind::Array(_) | Kind::Tuple(_) | Kind::Readonly(_) => TypeMetadata::Array,
            Kind::Fn(_) => TypeMetadata::Function,
            Kind::Union(members) => TypeMetadata::of_union(
                hir.ids(members)
                    .map(|member| self.type_metadata(file, member))
                    .collect(),
                object,
            ),
            Kind::Intersection(members) => TypeMetadata::from_intersection(
                hir.ids(members)
                    .map(|member| self.type_metadata(file, member))
                    .collect(),
                object,
            ),
            _ => TypeMetadata::Object,
        }
    }

    fn parameter_metadata(
        &self,
        file: FileId,
        func: FnId,
        has_decorators: bool,
    ) -> Vec<TypeMetadata> {
        let hir = self.hir(file);
        let mut is_collected = has_decorators;
        let mut found = Vec::new();
        for p in hir[func].params.iter() {
            is_collected |= hir
                .decorators
                .iter()
                .any(|&(owner, _)| owner == DecoratorOwner::Param(p));
            found.push(if is_collected && !hir[p].flags.contains(Flags::REST) {
                self.type_metadata(file, hir[p].ty)
            } else {
                TypeMetadata::None
            });
        }
        found
    }

    fn result_metadata(&self, file: FileId, func: FnId, has_decorators: bool) -> TypeMetadata {
        let f = &self.hir(file)[func];
        if !has_decorators {
            TypeMetadata::None
        } else if f.ret.is_some() {
            self.type_metadata(file, f.ret)
        } else if f.flags.contains(Flags::ASYNC) {
            TypeMetadata::Promise
        } else {
            TypeMetadata::Undefined
        }
    }

    fn read_name_at(&mut self, fx: &mut Fx, class: ClassId, name: Atom, is_typeof: bool) -> V {
        let pos = self.hir(fx.file)[class].start;
        let found = self.c.value_named_at(fx.file, class, name);
        self.read_binding(fx, found, name, None, pos, is_typeof)
    }

    fn read_names_or_object(&mut self, fx: &mut Fx, class: ClassId, names: &[Atom]) -> V {
        let anything = self.out.tys.anything;
        let found = fx.b.new_var(anything);
        let (absent, done) = (fx.b.new_block(), fx.b.new_block());
        let mut value = self.read_name_at(fx, class, names[0], true);
        for (i, &name) in names.iter().enumerate() {
            if i > 0 {
                let name = self.str(name);
                value = self.emit_throwing(fx, Op::PropGet { obj: value, name });
            }
            let undefined = self.emit(fx, Op::Undefined);
            let is_undefined = self.emit(
                fx,
                Op::StrictEq {
                    a: value,
                    b: undefined,
                },
            );
            let present = fx.b.new_block();
            self.branch(fx, is_undefined, absent, present);
            fx.b.seal(present);
            fx.b.switch_to(present);
        }
        let value = if self.ty(fx, value) == anything {
            value
        } else {
            self.emit(
                fx,
                Op::Coerce {
                    value,
                    to: anything,
                    why: CoerceReason::Upcast,
                },
            )
        };
        fx.b.write(found, value);
        fx.b.jump(done);
        fx.b.seal(absent);
        fx.b.switch_to(absent);
        let object = self.c.atoms().intern(b"Object");
        let object = self.read_name_at(fx, class, object, false);
        let object = if self.ty(fx, object) == anything {
            object
        } else {
            self.emit(
                fx,
                Op::Coerce {
                    value: object,
                    to: anything,
                    why: CoerceReason::Upcast,
                },
            )
        };
        fx.b.write(found, object);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.read(found)
    }

    fn emit_type_metadata(&mut self, fx: &mut Fx, class: ClassId, metadata: &TypeMetadata) -> V {
        let name: &[u8] = match metadata {
            TypeMetadata::None
            | TypeMetadata::Any
            | TypeMetadata::Unknown
            | TypeMetadata::Object => b"Object",
            TypeMetadata::Never
            | TypeMetadata::Undefined
            | TypeMetadata::Null
            | TypeMetadata::Void => return self.emit(fx, Op::Undefined),
            TypeMetadata::String => b"String",
            TypeMetadata::Number => b"Number",
            TypeMetadata::Function => b"Function",
            TypeMetadata::Boolean => b"Boolean",
            TypeMetadata::Array => b"Array",
            TypeMetadata::Promise => b"Promise",
            TypeMetadata::Bigint => {
                let name = self.c.atoms().intern(b"BigInt");
                return self.read_names_or_object(fx, class, &[name]);
            }
            TypeMetadata::Symbol => {
                let name = self.c.atoms().intern(b"Symbol");
                return self.read_names_or_object(fx, class, &[name]);
            }
            TypeMetadata::Identifier(name) => {
                return self.read_names_or_object(fx, class, &[*name]);
            }
            TypeMetadata::Dot(names) => return self.read_names_or_object(fx, class, names),
        };
        let name = self.c.atoms().intern(name);
        self.read_name_at(fx, class, name, false)
    }

    fn call_decorator_helper(&mut self, fx: &mut Fx, at: ExprId, helper: &[u8], args: &[V]) -> V {
        let pos = self.hir(fx.file)[at].pos;
        let helper = self
            .shared
            .decorator_helpers()
            .zip(self.c.atoms().lookup(helper));
        let Some(helper) = helper.and_then(|(file, name)| self.exported_binding(file, name)) else {
            return self.unsupported(
                fx,
                pos,
                "a decorator in a program that was loaded without prelude/decorators.ts",
            );
        };
        let callee = self.read_sym(fx, helper, pos);
        let this = self.emit(fx, Op::Undefined);
        self.emit_throwing(
            fx,
            Op::Call {
                callee,
                this,
                args: args.iter().copied().collect(),
            },
        )
    }

    fn emit_design_metadata(&mut self, fx: &mut Fx, at: ExprId, label: &[u8], value: V) -> V {
        let label = self.out.strs.intern(label);
        let label = self.emit(fx, Op::Str(label));
        self.call_decorator_helper(fx, at, b"decoratorMetadata", &[label, value])
    }

    fn emit_design_paramtypes(
        &mut self,
        fx: &mut Fx,
        class: ClassId,
        at: ExprId,
        parameter_types: &[TypeMetadata],
    ) -> V {
        let mut types: Args = Args::new();
        for metadata in parameter_types {
            types.push(self.emit_type_metadata(fx, class, metadata));
        }
        let types = self.emit_throwing(fx, Op::NewArray(types));
        self.emit_design_metadata(fx, at, b"design:paramtypes", types)
    }

    fn emit_legacy_decorators(
        &mut self,
        fx: &mut Fx,
        class: ClassId,
        binding: Option<Sym>,
        class_object: V,
    ) {
        let file = fx.file;
        let hir = self.hir(file);
        let c = &hir[class];
        let emits_metadata = self
            .c
            .bound(file)
            .class_options
            .map_or(self.files.options.emit_decorator_metadata, |own| {
                own.emit_decorator_metadata
            });
        let declared_on = |owner: DecoratorOwner| -> Vec<ExprId> {
            hir.decorators
                .iter()
                .filter(|written| written.0 == owner)
                .map(|written| written.1)
                .collect()
        };
        let target = if class_object.is_some() {
            class_object
        } else {
            self.class_as_value(fx, file, class)
        };
        let mut constructor = FnId::NONE;
        let mut of_constructor: Vec<(usize, ExprId)> = Vec::new();
        for member in c.members.iter() {
            let m = &hir[member];
            let has_body = m.func.is_some() && !matches!(hir[m.func].body, FnBody::None);
            let mut parameter_types: Vec<(usize, ExprId)> = Vec::new();
            if has_body {
                for (i, p) in hir[m.func].params.iter().enumerate() {
                    parameter_types.extend(
                        declared_on(DecoratorOwner::Param(p))
                            .into_iter()
                            .map(|written| (i, written)),
                    );
                }
            }
            if m.kind == MemberKind::Constructor {
                if has_body {
                    (constructor, of_constructor) = (m.func, parameter_types);
                }
                continue;
            }
            let own = declared_on(DecoratorOwner::Member(member));
            let PropKey::Name(key) = m.key else { continue };
            let Some(at) = own
                .first()
                .copied()
                .or_else(|| parameter_types.first().map(|written| written.1))
            else {
                continue;
            };
            let mut elements: Args = Args::new();
            for &written in &own {
                elements.push(self.expr(fx, written));
            }
            for &(i, written) in &parameter_types {
                let index = self.emit(fx, Op::Int(i as i64));
                let decorator = self.expr(fx, written);
                elements.push(self.call_decorator_helper(
                    fx,
                    written,
                    b"decorateParameter",
                    &[index, decorator],
                ));
            }
            if emits_metadata {
                let has_decorators = !own.is_empty();
                match m.kind {
                    MemberKind::Property => {
                        let of_type = self.type_metadata(file, m.ty);
                        let of_type = self.emit_type_metadata(fx, class, &of_type);
                        elements.push(self.emit_design_metadata(fx, at, b"design:type", of_type));
                    }
                    MemberKind::Method if has_body => {
                        let of_type = self.emit_type_metadata(fx, class, &TypeMetadata::Function);
                        elements.push(self.emit_design_metadata(fx, at, b"design:type", of_type));
                        let parameter_types = self.parameter_metadata(file, m.func, has_decorators);
                        elements.push(self.emit_design_paramtypes(fx, class, at, &parameter_types));
                        let of_result = self.result_metadata(file, m.func, has_decorators);
                        let of_result = self.emit_type_metadata(fx, class, &of_result);
                        elements.push(self.emit_design_metadata(
                            fx,
                            at,
                            b"design:returntype",
                            of_result,
                        ));
                    }
                    MemberKind::Getter if has_body => {
                        let of_result = self.result_metadata(file, m.func, has_decorators);
                        let of_result = self.emit_type_metadata(fx, class, &of_result);
                        elements.push(self.emit_design_metadata(fx, at, b"design:type", of_result));
                        elements.push(self.emit_design_paramtypes(fx, class, at, &[]));
                    }
                    MemberKind::Setter if has_body => {
                        let parameter_types = self.parameter_metadata(file, m.func, has_decorators);
                        elements.push(self.emit_design_paramtypes(fx, class, at, &parameter_types));
                        if let Some(first) = parameter_types.first() {
                            let of_type = self.emit_type_metadata(fx, class, first);
                            elements.push(self.emit_design_metadata(
                                fx,
                                at,
                                b"design:type",
                                of_type,
                            ));
                        }
                    }
                    _ => {}
                }
            }
            let elements = self.emit_throwing(fx, Op::NewArray(elements));
            let prototype = self.out.strs.intern(b"prototype");
            let prototype = self.emit_throwing(
                fx,
                Op::PropGet {
                    obj: target,
                    name: prototype,
                },
            );
            let key = self.str(key);
            let key = self.emit(fx, Op::Str(key));
            let descriptor = self.emit(
                fx,
                if m.kind == MemberKind::Property {
                    Op::Undefined
                } else {
                    Op::Null
                },
            );
            self.call_decorator_helper(
                fx,
                at,
                b"decorateMember",
                &[elements, prototype, key, descriptor],
            );
        }
        let own = declared_on(DecoratorOwner::Class(class));
        let Some(at) = own
            .first()
            .copied()
            .or_else(|| of_constructor.first().map(|written| written.1))
        else {
            return;
        };
        let mut elements: Args = Args::new();
        for &written in &own {
            elements.push(self.expr(fx, written));
        }
        for &(i, written) in &of_constructor {
            let index = self.emit(fx, Op::Int(i as i64));
            let decorator = self.expr(fx, written);
            elements.push(self.call_decorator_helper(
                fx,
                written,
                b"decorateParameter",
                &[index, decorator],
            ));
        }
        if emits_metadata && constructor.is_some() {
            let parameter_types = self.parameter_metadata(file, constructor, !own.is_empty());
            elements.push(self.emit_design_paramtypes(fx, class, at, &parameter_types));
        }
        let elements = self.emit_throwing(fx, Op::NewArray(elements));
        let decorated = self.call_decorator_helper(fx, at, b"decorateClass", &[elements, target]);
        if let Some(sym) = binding {
            self.write_sym(fx, sym, decorated, c.start);
        }
    }

    fn read_heritage(&mut self, fx: &mut Fx, base: V, written: ExprId) -> V {
        let outer = fx.b.pos;
        fx.b.pos = self.last_pos(fx, written);
        let anything = self.out.tys.anything;
        let found = fx.b.new_var(anything);
        let null = self.emit(fx, Op::Null);
        let nothing = self.emit(
            fx,
            Op::Coerce {
                value: null,
                to: anything,
                why: CoerceReason::Upcast,
            },
        );
        fx.b.write(found, nothing);
        let is_null = self.emit(fx, Op::StrictEq { a: base, b: null });
        let (test, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_null, done, test);
        fx.b.seal(test);
        fx.b.switch_to(test);
        let is_constructor = self.operation(fx, Operation::IsConstructor, &[base]);
        let (read, refused) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_constructor, read, refused);
        fx.b.seal(read);
        fx.b.seal(refused);
        fx.b.switch_to(refused);
        self.throw_error(fx, b"TypeError", b"The superclass is not a constructor.");
        fx.b.switch_to(read);
        let name = self.out.strs.intern(b"prototype");
        let prototype = self.emit_throwing(fx, Op::PropGet { obj: base, name });
        let kind = self.emit(fx, Op::TypeOf(prototype));
        let object = self.out.strs.intern(b"object");
        let object = self.emit(fx, Op::Str(object));
        let is_object = self.emit(fx, Op::StrictEq { a: kind, b: object });
        let (fine, other) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_object, fine, other);
        fx.b.seal(other);
        fx.b.switch_to(other);
        let function = self.out.strs.intern(b"function");
        let function = self.emit(fx, Op::Str(function));
        let is_function = self.emit(
            fx,
            Op::StrictEq {
                a: kind,
                b: function,
            },
        );
        let mismatched = fx.b.new_block();
        self.branch(fx, is_function, fine, mismatched);
        fx.b.seal(fine);
        fx.b.seal(mismatched);
        fx.b.switch_to(mismatched);
        self.throw_error(
            fx,
            b"TypeError",
            b"The value of the superclass's prototype property is not an object or null.",
        );
        fx.b.switch_to(fine);
        let prototype = if self.ty(fx, prototype) == anything {
            prototype
        } else {
            self.emit(
                fx,
                Op::Coerce {
                    value: prototype,
                    to: anything,
                    why: CoerceReason::Upcast,
                },
            )
        };
        fx.b.write(found, prototype);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.pos = outer;
        fx.b.read(found)
    }

    fn is_first_member_with_name(&self, file: FileId, class: ClassId, member: MemberId) -> bool {
        let hir = self.hir(file);
        let PropKey::Private(name) = hir[member].key else {
            return true;
        };
        !hir[class]
            .members
            .iter()
            .take_while(|&other| other != member)
            .any(|other| matches!(hir[other].key, PropKey::Private(earlier) if earlier == name))
    }

    fn emit_private_methods(&mut self, fx: &mut Fx, file: FileId, class: ClassId) {
        if !self
            .class_variables
            .contains_key(&(file, class, ClassVariable::PrivateMethods))
        {
            return;
        }
        let hir = self.hir(file);
        let is_evaluated_once = self.classes[&(file, class)].facts.is_evaluated_once;
        let holder = self.emit(fx, Op::NewObject);
        for member in hir[class].members.iter() {
            let m = &hir[member];
            let PropKey::Private(name) = m.key else {
                continue;
            };
            if m.flags.contains(Flags::STATIC)
                || !matches!(
                    m.kind,
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter
                )
            {
                continue;
            }
            let Some(&func) = self.funcs.get(&(file, m.func)) else {
                continue;
            };
            let key = self.read_class_variable(fx, file, class, ClassVariable::PrivateName(name));
            let closure = if is_evaluated_once {
                self.make_closure(fx, func)
            } else {
                let captures = self.capture_values(fx, func, 0);
                self.emit(fx, Op::Closure { func, captures })
            };
            if m.kind == MemberKind::Method {
                self.operation(fx, Operation::DefineMethod, &[holder, key, closure]);
            } else {
                let shows = self.emit(fx, Op::Bool(false));
                let define = if m.kind == MemberKind::Getter {
                    Operation::DefineGetter
                } else {
                    Operation::DefineSetter
                };
                self.operation(fx, define, &[holder, key, closure, shows]);
            }
        }
        self.write_class_variable(fx, file, class, ClassVariable::PrivateMethods, holder);
    }

    fn emit_static_members(&mut self, fx: &mut Fx, file: FileId, class: ClassId) {
        let hir = self.hir(file);
        let bound = self.c.bound(file);
        let was_in_field_initializer = std::mem::replace(&mut fx.is_in_field_initializer, true);
        let outer = (
            fx.this,
            fx.this_var,
            fx.this_type,
            fx.this_class,
            fx.class,
            fx.is_static,
        );
        (
            fx.this,
            fx.this_var,
            fx.this_type,
            fx.this_class,
            fx.class,
            fx.is_static,
        ) = (
            V::NONE,
            None,
            Ty::NONE,
            Some((file, class)),
            Some((file, class)),
            true,
        );
        let put_aside = Some(Receiver::Function(fx.func)).filter(|receiver| {
            fx.func.is_some() && outer.0.is_some() && !fx.receivers.contains_key(receiver)
        });
        if let Some(receiver) = put_aside {
            fx.receivers.insert(receiver, outer.0);
        }
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if m.flags.contains(Flags::AMBIENT) {
                continue;
            }
            match m.kind {
                MemberKind::Property if m.flags.contains(Flags::STATIC) => {
                    let name = match m.key {
                        PropKey::Name(name) | PropKey::Private(name) => name,
                        _ => Atom::NONE,
                    };
                    let value = match m.key {
                        _ if m.init.is_none() => self.emit(fx, Op::Undefined),
                        PropKey::Computed(written) => {
                            let key = self.read_class_variable(
                                fx,
                                file,
                                class,
                                ClassVariable::Key(member),
                            );
                            self.expr_with_key_name(fx, m.init, written, key)
                        }
                        _ => self.expr_with_name(fx, m.init, name),
                    };
                    let symbol = bound.member_symbol[member.idx()];
                    let sym = if symbol.is_some() {
                        self.files.sym(file, symbol)
                    } else {
                        Sym { file, id: symbol }
                    };
                    if symbol.is_some()
                        && self.places.contains_key(&sym)
                        && !matches!(m.key, PropKey::Computed(_))
                    {
                        self.write_sym(fx, sym, value, m.name_pos);
                        continue;
                    }
                    let key = match m.key {
                        PropKey::Computed(_) => {
                            self.read_class_variable(fx, file, class, ClassVariable::Key(member))
                        }
                        _ => {
                            let name = self.str(name);
                            self.emit(fx, Op::Str(name))
                        }
                    };
                    let class_object = self.class_as_value(fx, file, class);
                    self.operation(fx, Operation::DefineField, &[class_object, key, value]);
                }
                MemberKind::StaticBlock => {
                    let Some(&func) = self.funcs.get(&(file, m.func)) else {
                        continue;
                    };
                    let this = self.static_receiver(fx, func, (file, class));
                    let args = self.direct_args(fx, func, this, &[]);
                    self.emit_throwing(fx, Op::CallDirect { func, args });
                }
                _ => {}
            }
        }
        if let Some(receiver) = put_aside {
            fx.receivers.remove(&receiver);
        }
        (
            fx.this,
            fx.this_var,
            fx.this_type,
            fx.this_class,
            fx.class,
            fx.is_static,
        ) = outer;
        fx.is_in_field_initializer = was_in_field_initializer;
    }

    pub(crate) fn is_in_static_member(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let mut func = func;
        while func.is_some() && hir[func].kind == FnKind::Arrow {
            func = bound.fns[func.idx()].enclosing;
        }
        func.is_some()
            && matches!(bound.fns[func.idx()].owner, FnOwner::Member(member) if hir[member].kind == MemberKind::StaticBlock || hir[member].flags.contains(Flags::STATIC))
    }

    fn own_static_member(
        &mut self,
        file: FileId,
        class: ClassId,
        name: Atom,
    ) -> Option<StaticMemberKind> {
        let hir = self.hir(file);
        let (mut getter, mut setter) = (FuncId::NONE, FuncId::NONE);
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if !m.flags.contains(Flags::STATIC)
                || m.flags.contains(Flags::AMBIENT)
                || !matches!(m.key, PropKey::Name(key) | PropKey::Private(key) if key == name)
            {
                continue;
            }
            match m.kind {
                MemberKind::Property => {
                    let symbol = self.c.bound(file).member_symbol[member.idx()];
                    return symbol
                        .is_some()
                        .then(|| StaticMemberKind::Field(self.files.sym(file, symbol)));
                }
                MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                    let Some(&func) = self.funcs.get(&(file, m.func)) else {
                        continue;
                    };
                    match m.kind {
                        MemberKind::Method => return Some(StaticMemberKind::Method(func)),
                        MemberKind::Getter => getter = func,
                        _ => setter = func,
                    }
                }
                _ => {}
            }
        }
        (getter.is_some() || setter.is_some())
            .then_some(StaticMemberKind::Accessor { getter, setter })
    }

    fn can_reach_static_member(
        &self,
        fx: &Fx,
        on: (FileId, ClassId),
        kind: StaticMemberKind,
    ) -> bool {
        match kind {
            StaticMemberKind::Field(sym) => self.can_reach_slot(fx, self.places.get(&sym).copied()),
            StaticMemberKind::Method(func) => {
                let retained = self
                    .class_variables
                    .get(&(on.0, on.1, ClassVariable::StaticPrivateMethod(func)))
                    .copied();
                self.has_captures_available(fx, func)
                    && (retained.is_none() || self.can_reach_slot(fx, retained))
            }
            StaticMemberKind::Accessor { getter, setter } => [getter, setter]
                .into_iter()
                .all(|func| func.is_none() || self.has_captures_available(fx, func)),
        }
    }

    fn has_computed_static_member(&mut self, file: FileId, class: ClassId) -> bool {
        let hir = self.hir(file);
        hir[class].members.iter().any(|member| hir[member].flags.contains(Flags::STATIC) && matches!(hir[member].key, PropKey::Computed(key) if self.is_untyped_file(file) || !self.c.is_symbol_name(file, key)))
    }

    pub(crate) fn static_member(
        &mut self,
        fx: &mut Fx,
        obj: ExprId,
        name: Atom,
    ) -> Option<StaticMember> {
        let on = self.class_for_expr(fx.file, obj)?;
        self.define_class(on.0, on.1);
        if self.is_untyped_file(on.0) || self.has_computed_static_member(on.0, on.1) {
            return None;
        }
        let kind = self.own_static_member(on.0, on.1, name)?;
        let is_private = self.c.atoms().bytes(name).starts_with(PRIVATE_NAME_PREFIX);
        if !(is_private || matches!(kind, StaticMemberKind::Field(_)))
            || !self.can_reach_static_member(fx, on, kind)
        {
            return None;
        }
        self.emit_class_tdz_check(fx, on.0, on.1, obj);
        Some(StaticMember {
            kind,
            name: self.str(name),
            is_private,
            on,
        })
    }

    pub(crate) fn class_as_receiver(&mut self, fx: &mut Fx, obj: ExprId, name: Atom) -> Option<V> {
        let on = self.class_for_expr(fx.file, obj)?;
        let mut at = Some(on);
        while let Some((file, class)) = at {
            let info = self.define_class(file, class);
            if self.is_untyped_file(file)
                || !info.facts.is_evaluated_once
                || self.has_computed_static_member(file, class)
            {
                return None;
            }
            let members = match self.own_static_member(file, class, name) {
                Some(StaticMemberKind::Field(_)) => return None,
                Some(StaticMemberKind::Method(method)) => [method, FuncId::NONE],
                Some(StaticMemberKind::Accessor { getter, setter }) => [getter, setter],
                None => {
                    at = info.base;
                    continue;
                }
            };
            self.emit_class_tdz_check(fx, on.0, on.1, obj);
            let inspects_this = members.into_iter().any(|member| {
                member.is_some() && self.out.funcs[member.idx()].has(func_flags::HAS_THIS)
            });
            return Some(if inspects_this {
                self.class_as_value(fx, on.0, on.1)
            } else {
                self.class_object(fx, on.0, on.1)
            });
        }
        None
    }

    pub(crate) fn static_private_member(&mut self, fx: &Fx, name: Atom) -> Option<StaticMember> {
        let class = self.private_name_class(name)?;
        self.define_class(fx.file, class);
        let kind = self.own_static_member(fx.file, class, name)?;
        self.can_reach_static_member(fx, (fx.file, class), kind)
            .then(|| StaticMember {
                kind,
                name: self.str(name),
                is_private: true,
                on: (fx.file, class),
            })
    }

    pub(crate) fn check_is_class(&mut self, fx: &mut Fx, value: V, on: (FileId, ClassId)) {
        let is_class = self.is_class(fx, value, on);
        let (fine, throw) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_class, fine, throw);
        fx.b.seal(fine);
        fx.b.seal(throw);
        fx.b.switch_to(throw);
        self.throw_error(
            fx,
            b"TypeError",
            b"Cannot access a private static member of a class on another object",
        );
        fx.b.switch_to(fine);
    }

    fn is_class(&mut self, fx: &mut Fx, value: V, on: (FileId, ClassId)) -> V {
        let is_evaluated_once = self.define_class(on.0, on.1).facts.is_evaluated_once;
        let hir = self.hir(on.0);
        let is_in_declaration_time_key = fx.file == on.0
            && hir[on.1].members.iter().any(|member| {
                matches!(hir[member].key, PropKey::Computed(key) if (hir[member].name_pos..bun_sema::hir::end_of_expr(hir, key)).contains(&fx.b.pos))
                    && self.class_variables.contains_key(&(on.0, on.1, ClassVariable::Key(member)))
            });
        if is_in_declaration_time_key {
            let (undeclared, join) = (fx.b.new_block(), fx.b.new_block());
            let is_class = fx.b.new_var(self.known.boolean);
            fx.handlers.push(undeclared);
            if is_evaluated_once {
                self.read_class_variable(fx, on.0, on.1, ClassVariable::IsDeclared);
            }
            let class = self.class_object(fx, on.0, on.1);
            fx.handlers.pop();
            fx.b.seal(undeclared);
            let same = self.emit(fx, Op::StrictEq { a: value, b: class });
            self.write(fx, is_class, same);
            fx.b.jump(join);
            fx.b.switch_to(undeclared);
            self.emit(fx, Op::Caught);
            let no = self.emit(fx, Op::Bool(false));
            self.write(fx, is_class, no);
            fx.b.jump(join);
            fx.b.seal(join);
            fx.b.switch_to(join);
            return self.read(fx, is_class);
        }
        let class = self.class_object(fx, on.0, on.1);
        self.emit(fx, Op::StrictEq { a: value, b: class })
    }

    pub(crate) fn check_has_static_member(
        &mut self,
        fx: &mut Fx,
        obj: V,
        member: StaticMember,
        pos: u32,
    ) {
        if obj.is_some() {
            self.check_is_class(fx, obj, member.on);
        }
        if member.is_private
            && let StaticMemberKind::Field(sym) = member.kind
        {
            self.read_sym(fx, sym, pos);
        }
    }

    pub(crate) fn has_static_private_member(
        &mut self,
        fx: &mut Fx,
        value: V,
        member: StaticMember,
        pos: u32,
    ) -> V {
        let is_class = self.is_class(fx, value, member.on);
        let (class, other, throw, join) = (
            fx.b.new_block(),
            fx.b.new_block(),
            fx.b.new_block(),
            fx.b.new_block(),
        );
        let has = fx.b.new_var(self.known.boolean);
        self.write(fx, has, is_class);
        self.branch(fx, is_class, class, other);
        fx.b.seal(class);
        fx.b.seal(other);
        fx.b.switch_to(other);
        let is_object = self.operation(fx, Operation::IsObject, &[value]);
        self.branch(fx, is_object, join, throw);
        fx.b.seal(throw);
        fx.b.switch_to(throw);
        self.throw_error(
            fx,
            b"TypeError",
            b"Cannot use 'in' to look for a private name in a value that is not an object",
        );
        fx.b.switch_to(class);
        if let StaticMemberKind::Field(sym) = member.kind {
            let absent = fx.b.new_block();
            fx.handlers.push(absent);
            self.read_sym(fx, sym, pos);
            fx.handlers.pop();
            fx.b.seal(absent);
            let present = fx.b.block;
            fx.b.switch_to(absent);
            self.emit(fx, Op::Caught);
            let no = self.emit(fx, Op::Bool(false));
            self.write(fx, has, no);
            fx.b.jump(join);
            fx.b.switch_to(present);
        }
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, has)
    }

    pub(crate) fn static_receiver(
        &mut self,
        fx: &mut Fx,
        func: FuncId,
        on: (FileId, ClassId),
    ) -> V {
        if self.out.funcs[func.idx()].has(func_flags::HAS_THIS) {
            self.class_as_value(fx, on.0, on.1)
        } else {
            V::NONE
        }
    }

    pub(crate) fn static_get(&mut self, fx: &mut Fx, member: StaticMember, pos: u32) -> V {
        match member.kind {
            StaticMemberKind::Field(sym) => self.read_sym(fx, sym, pos),
            StaticMemberKind::Method(func) => match self
                .class_variables
                .get(&(
                    member.on.0,
                    member.on.1,
                    ClassVariable::StaticPrivateMethod(func),
                ))
                .copied()
            {
                Some(Place::Env(layout, field)) => {
                    let env = self.env_for_layout(fx, layout);
                    let captures = self.capture_values(fx, func, pos);
                    self.emit(
                        fx,
                        Op::ClosureOnce {
                            func,
                            captures,
                            env,
                            field,
                        },
                    )
                }
                _ => self.make_closure(fx, func),
            },
            StaticMemberKind::Accessor { getter, .. } if getter.is_some() => {
                let this = self.static_receiver(fx, getter, member.on);
                self.emit_direct_call(fx, getter, this, &[])
            }
            StaticMemberKind::Accessor { .. } => {
                self.throw_error(
                    fx,
                    b"TypeError",
                    b"Trying to access an undefined private getter",
                );
                let after = fx.b.new_block();
                fx.b.seal(after);
                fx.b.switch_to(after);
                self.emit(fx, Op::Undefined)
            }
        }
    }

    pub(crate) fn static_set(&mut self, fx: &mut Fx, member: StaticMember, value: V, pos: u32) {
        match member.kind {
            StaticMemberKind::Field(sym) => self.write_sym(fx, sym, value, pos),
            StaticMemberKind::Accessor { setter, .. } if setter.is_some() => {
                let this = self.static_receiver(fx, setter, member.on);
                self.emit_direct_call(fx, setter, this, &[value]);
            }
            _ => {
                let obj = self.class_as_value(fx, member.on.0, member.on.1);
                self.emit_throwing(
                    fx,
                    Op::PropSet {
                        obj,
                        name: member.name,
                        value,
                    },
                );
            }
        }
    }

    pub(crate) fn private_name_text(&self, name: Atom) -> Option<Vec<u8>> {
        let bytes = self.c.atoms().bytes(name);
        (bytes.starts_with(b"#") || bytes.starts_with(PRIVATE_NAME_PREFIX))
            .then(|| bun_sema::atom::written_name(bytes).to_vec())
    }

    pub(crate) fn private_name_class(&self, name: Atom) -> Option<ClassId> {
        let bytes = self.c.atoms().bytes(name);
        if !bytes.starts_with(PRIVATE_NAME_PREFIX) {
            return None;
        }
        let class = bytes.rsplit(|&byte| byte == b'.').next()?;
        Some(ClassId(std::str::from_utf8(class).ok()?.parse().ok()?))
    }

    pub(crate) fn is_private_field(&self, file: FileId, name: Atom) -> bool {
        let Some(class) = self.private_name_class(name) else {
            return false;
        };
        let hir = self.hir(file);
        hir[class].members.iter().all(|member| {
            !matches!(hir[member].key, PropKey::Private(declared) if declared == name)
                || hir[member].kind == MemberKind::Property
                    && !hir[member].flags.contains(Flags::ACCESSOR)
        })
    }

    pub(crate) fn private_key(&mut self, fx: &mut Fx, name: Atom) -> Option<V> {
        let class = self.private_name_class(name)?;
        self.define_class(fx.file, class);
        self.class_variables
            .contains_key(&(fx.file, class, ClassVariable::PrivateName(name)))
            .then(|| self.read_class_variable(fx, fx.file, class, ClassVariable::PrivateName(name)))
    }

    pub(crate) fn construct_class(
        &mut self,
        fx: &mut Fx,
        callee: ExprId,
        (file, class): (FileId, ClassId),
        args: IdList<ExprId>,
    ) -> Option<V> {
        let info = self.define_class(file, class);
        let hir = self.hir(fx.file);
        let is_spread = hir
            .ids(args)
            .any(|e| matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing));
        if !info.facts.has_fixed_layout || is_spread || !self.has_captures_available(fx, info.ctor)
        {
            return None;
        }
        self.touch_module(fx, file);
        let mut class_object = V::NONE;
        if info.facts.is_evaluated_once {
            self.emit_class_tdz_check(fx, file, class, callee);
        } else {
            class_object = self.expr(fx, callee);
        }
        let mut all: Vec<V> = Vec::new();
        if info.facts.uses_new_target {
            all.push(if class_object.is_some() {
                class_object
            } else {
                self.class_as_value(fx, file, class)
            });
        }
        all.extend(self.arguments(fx, args).unwrap_or_default());
        let object = if info.facts.is_evaluated_once {
            self.emit(fx, Op::New(info.layout))
        } else {
            let object = self.operation(fx, Operation::NewObjectOfClass, &[class_object]);
            let instance = self.instance_type(file, class);
            self.coerce_to(fx, object, instance, CoerceReason::Claim)
        };
        let result = self.emit_direct_call(fx, info.ctor, object, &all);
        Some(if info.returns_constructed_object() {
            result
        } else {
            object
        })
    }

    pub(crate) fn direct_args(&mut self, fx: &mut Fx, func: FuncId, this: V, args: &[V]) -> Args {
        let mut all = self.capture_values(fx, func, 0);
        if self.out.funcs[func.idx()].has(func_flags::HAS_THIS) {
            let this = if this.is_some() {
                this
            } else {
                self.emit(fx, Op::Undefined)
            };
            all.push(this);
        }
        let count = self.out.funcs[func.idx()].params.len();
        for i in 0..count {
            match args.get(i) {
                Some(&arg) => all.push(arg),
                None => all.push(self.emit(fx, Op::Undefined)),
            }
        }
        all
    }

    pub(crate) fn emit_constructor(&mut self, fx: &mut Fx) {
        let Some((file, class)) = fx.class else {
            return;
        };
        let info = self.define_class(file, class);
        let hir = self.hir(file);
        let pos = if fx.func.is_some() {
            hir[fx.func].start
        } else {
            hir[class].start
        };
        let (uses_new_target, count) = {
            let func = &self.out.funcs[fx.id.idx()];
            (func.has(func_flags::HAS_NEW_TARGET), func.params.len())
        };
        self.add_captures(fx);
        fx.given = self.add_entry_param(fx, fx.this_type);
        if uses_new_target {
            fx.new_target = self.add_entry_param(fx, Ty::NONE);
        }
        fx.returns_this = info.returns_constructed_object();
        let is_passed_this = match info.base {
            Some(base) => !self.classes[&base].facts.may_return_another_object,
            None => !info.is_derived,
        };
        if is_passed_this {
            fx.this = fx.given;
            if self.tracks_field_definition_order(file, class)
                && info.base.is_some()
                && self.this_escapes_in_base_classes(info.layout)
                && let Some(&first) = self.own_fields_in_order(file, class).first()
            {
                self.list_fields(fx, pos, first, false);
            }
        } else if let Some(layout) = self.this_binding_layout(Receiver::Function(fx.func)) {
            let binding = self.emit(fx, Op::New(layout));
            let unbound = self.emit(fx, Op::Undefined);
            self.emit(
                fx,
                Op::FieldSet {
                    obj: binding,
                    layout,
                    field: 0,
                    value: unbound,
                },
            );
            self.emit(
                fx,
                Op::FieldSet {
                    obj: binding,
                    layout,
                    field: 1,
                    value: fx.new_target,
                },
            );
            fx.this_binding = Some((layout, binding));
        } else {
            let unbound = self.emit(fx, Op::Undefined);
            let var = self.new_temporary(fx);
            self.write(fx, var, unbound);
            fx.this_var = Some(var);
        }
        if fx.func.is_some() {
            let params = self.add_parameters(fx);
            self.record_body_span(fx);
            self.open_activation(fx, Activation::Call(fx.func));
            let defines_fields = !info.is_derived
                && fx
                    .class
                    .is_some_and(|(file, class)| !self.c.assigns_fields(file, class));
            if defines_fields {
                self.initialize_instance_elements(fx, pos);
            }
            fx.constructor_params = self.bind_parameters(fx, &params);
            if defines_fields {
                self.assign_decorated_fields(fx, pos);
                self.store_parameter_properties(fx, pos);
            } else if !info.is_derived {
                self.did_bind_this(fx, pos);
            }
            if let FnBody::Block(stmts) = hir[fx.func].body {
                self.block_body(fx, stmts);
            }
        } else {
            let types = self.out.funcs[fx.id.idx()].params.clone();
            let handed: Vec<V> = (usize::from(uses_new_target)..count)
                .map(|i| self.add_entry_param(fx, Ty::from_id(types[i])))
                .collect();
            match info.base {
                Some(base) => self.emit_default_super_call(fx, base, &handed, pos),
                None if info.is_derived => match self
                    .construct_promise_subclass_with_list(fx, file, class, handed[0], pos)
                {
                    Some(constructed) => {
                        self.bind_this(fx, constructed);
                        self.did_bind_this(fx, pos);
                    }
                    None => self.emit_super_construct(fx, handed[0], pos),
                },
                None => self.did_bind_this(fx, pos),
            }
        }
        if fx.returns_this {
            let this = self.this(fx, pos);
            self.terminate_with_return(fx, this);
        }
    }

    fn tracks_field_definition_order(&mut self, file: FileId, class: ClassId) -> bool {
        self.class_info(file, class).facts.has_fixed_layout
    }

    fn own_fields_in_order(&mut self, file: FileId, class: ClassId) -> Vec<Atom> {
        let hir = self.hir(file);
        let info = self.class_info(file, class);
        let mut names = Vec::new();
        if let Some(constructor) = self.c.class_constructor(file, class) {
            for p in hir[constructor].params.iter() {
                if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                    && let PatKind::Ident(name) = hir[hir[p].pat].kind
                {
                    names.push(name);
                }
            }
        }
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if m.kind == MemberKind::Property
                && !m
                    .flags
                    .intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT)
                && !self.c.is_field_omitted(file, member)
                && !matches!(m.key, PropKey::Private(_))
            {
                let name = self.instance_field_name(file, member);
                if name.is_some() {
                    names.push(name);
                }
            }
        }
        let extended = info
            .base
            .map(|(file, class)| self.class_info(file, class).layout);
        names.retain(|&name| {
            let name = self.str(name);
            self.out.layouts[info.layout.idx()].field(name).is_some()
                && !extended
                    .is_some_and(|extended| self.out.layouts[extended.idx()].field(name).is_some())
        });
        names
    }

    fn list_fields(&mut self, fx: &mut Fx, pos: u32, name: Atom, includes_name: bool) {
        let text = self.str(name);
        let (this, text) = (self.this(fx, pos), self.emit_key(fx, text));
        let word = match fx.listed_fields {
            None if !includes_name && fx.this == fx.given => {
                self.operation(fx, Operation::UnlistFields, &[this, text])
            }
            None => {
                let includes_name = self.emit(fx, Op::Bool(includes_name));
                self.operation(fx, Operation::ListFields, &[this, text, includes_name]);
                return;
            }
            Some((word, listed, includes_listed)) => {
                let listed = self.str(listed);
                let (includes_name, listed, includes_listed) = (
                    self.emit(fx, Op::Bool(includes_name)),
                    self.emit(fx, Op::Str(listed)),
                    self.emit(fx, Op::Bool(includes_listed)),
                );
                self.operation(
                    fx,
                    Operation::ListFields,
                    &[this, text, includes_name, listed, includes_listed, word],
                );
                word
            }
        };
        fx.listed_fields = Some((word, name, includes_name));
    }

    fn did_bind_this(&mut self, fx: &mut Fx, pos: u32) {
        self.initialize_instance_elements(fx, pos);
        self.assign_decorated_fields(fx, pos);
        if fx
            .class
            .is_some_and(|(file, class)| !self.c.assigns_fields(file, class))
        {
            self.store_parameter_properties(fx, pos);
        }
    }

    fn assign_decorated_fields(&mut self, fx: &mut Fx, pos: u32) {
        let Some((file, class)) = fx.class else {
            return;
        };
        if self.c.assigns_fields(file, class) {
            return;
        }
        let was_in_field_initializer = std::mem::replace(&mut fx.is_in_field_initializer, true);
        let hir = self.hir(file);
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if m.kind == MemberKind::Property
                && m.init.is_some()
                && !m
                    .flags
                    .intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT)
                && self.files.is_decorated_member(file, member)
                && let PropKey::Name(name) = m.key
            {
                let value = self.expr_with_name(fx, m.init, Atom::NONE);
                let (name, this) = (self.str(name), self.this(fx, pos));
                self.emit_throwing(
                    fx,
                    Op::PropSet {
                        obj: this,
                        name,
                        value,
                    },
                );
            }
        }
        fx.is_in_field_initializer = was_in_field_initializer;
    }

    fn initialize_instance_elements(&mut self, fx: &mut Fx, pos: u32) {
        let Some((file, class)) = fx.class else {
            return;
        };
        if self
            .class_variables
            .contains_key(&(file, class, ClassVariable::PrivateMethods))
        {
            let private_methods =
                self.read_class_variable(fx, file, class, ClassVariable::PrivateMethods);
            let this = self.this(fx, pos);
            self.operation(fx, Operation::PrivateMethodsAdd, &[this, private_methods]);
        }
        if self.c.assigns_fields(file, class) {
            self.store_parameter_properties(fx, pos);
        } else if !self.class_info(file, class).facts.has_fixed_layout
            && let Some(constructor) = self.c.class_constructor(file, class)
        {
            let hir = self.hir(fx.file);
            for p in hir[constructor].params.iter() {
                if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                    && let PatKind::Ident(name) = hir[hir[p].pat].kind
                {
                    let name = self.str(name);
                    let (name, undefined, this) = (
                        self.emit(fx, Op::Str(name)),
                        self.emit(fx, Op::Undefined),
                        self.this(fx, pos),
                    );
                    self.operation(fx, Operation::DefineField, &[this, name, undefined]);
                }
            }
        }
        self.initialize_fields(fx, file, class, pos);
    }

    fn store_parameter_properties(&mut self, fx: &mut Fx, pos: u32) {
        let Some((file, class)) = fx.class else {
            return;
        };
        if let Some(constructor) = self.c.class_constructor(file, class) {
            let hir = self.hir(fx.file);
            for (i, p) in hir[constructor].params.iter().enumerate() {
                if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                    && let PatKind::Ident(name) = hir[hir[p].pat].kind
                {
                    if self.c.assigns_fields(file, class)
                        && self.class_info(file, class).facts.has_fixed_layout
                        && self.inherits_accessor(file, class, name)
                    {
                        self.problem(file, pos, "a class field that shadows an accessor of a base class while \"useDefineForClassFields\" is false");
                    }
                    let name = self.str(name);
                    let this = self.this(fx, pos);
                    let Some(&value) = fx.constructor_params.get(i) else {
                        return self.problem(fx.file, pos, "`super()` in a parameter default of a constructor that has parameter properties");
                    };
                    self.emit_throwing(
                        fx,
                        Op::PropSet {
                            obj: this,
                            name,
                            value,
                        },
                    );
                }
            }
        }
    }

    fn initialize_fields(&mut self, fx: &mut Fx, file: FileId, class: ClassId, pos: u32) {
        let was_in_field_initializer = std::mem::replace(&mut fx.is_in_field_initializer, true);
        let hir = self.hir(file);
        let bound = self.c.bound(file);
        let info = self.class_info(file, class);
        let mut is_untouched = info.base.is_none()
            || info.facts.has_fixed_layout && !self.this_escapes_in_base_classes(info.layout);
        let uses_this = self.c.initializers_that_use_this(file, class);
        let assigns = self.c.assigns_fields(file, class);
        let lists_fields = self.tracks_field_definition_order(file, class);
        let (own_fields, lets_go) = if lists_fields {
            (
                self.own_fields_in_order(file, class),
                self.initializers_where_this_escapes(info.layout, file, class),
            )
        } else {
            Default::default()
        };
        let mut may_be_seen =
            lists_fields && info.base.is_some() && self.this_escapes_in_base_classes(info.layout);
        let mut has_undeclared_fields = may_be_seen;
        let runs_code = |init: ExprId| {
            init.is_some()
                && !matches!(
                    hir[init].kind,
                    ExprKind::Null
                        | ExprKind::True
                        | ExprKind::False
                        | ExprKind::Number(_)
                        | ExprKind::String(_)
                        | ExprKind::BigInt(_)
                        | ExprKind::Fn(_)
                )
        };
        let is_public_field = |member: &MemberId| {
            hir[*member].kind == MemberKind::Property
                && !hir[*member].flags.contains(Flags::STATIC)
                && !matches!(hir[*member].key, PropKey::Private(_))
        };
        let names_that_run_code: Vec<Atom> = hir[class]
            .members
            .iter()
            .filter(is_public_field)
            .filter(|&member| runs_code(hir[member].init))
            .map(|member| self.instance_field_name(file, member))
            .collect();
        let begins_run: Vec<bool> = own_fields
            .iter()
            .map(|own| names_that_run_code.contains(own))
            .collect();
        let end_of_run = |from: usize| {
            (from + 1..begins_run.len())
                .take_while(|&at| !begins_run[at])
                .last()
                .unwrap_or(from)
        };
        let mut listed = 0;
        if may_be_seen && !own_fields.is_empty() {
            if begins_run[0] {
                self.list_fields(fx, pos, own_fields[0], false);
            } else {
                listed = end_of_run(0) + 1;
                self.list_fields(fx, pos, own_fields[listed - 1], true);
            }
        }
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if m.kind != MemberKind::Property
                || m.flags
                    .intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT)
                || self.c.is_field_omitted(file, member)
                || !assigns && self.files.is_decorated_member(file, member)
            {
                continue;
            }
            let name = self.instance_field_name(file, member);
            let given = if assigns { Atom::NONE } else { name };
            if info.facts.has_fixed_layout && name.is_some() {
                if m.init.is_none() {
                    let field = self.str(name);
                    self.implicit_stores.push(field);
                    let symbol = bound.member_symbol[member.idx()];
                    let starts_undefined = symbol.is_none()
                        || self.field_starts_undefined(info.layout, self.files.sym(file, symbol));
                    if starts_undefined
                        && (!is_untouched || !Self::is_field_name(self.c.atoms().bytes(name)))
                    {
                        let undefined = self.emit(fx, Op::Undefined);
                        let this = self.this(fx, pos);
                        self.define_field(fx, this, name, undefined);
                    }
                    continue;
                }
                is_untouched &= !uses_this.contains(&member);
                may_be_seen |= lets_go.contains(&member);
                let place = own_fields.iter().position(|&own| own == name);
                if may_be_seen
                    && !has_undeclared_fields
                    && runs_code(m.init)
                    && let Some(place) = place
                {
                    self.list_fields(fx, pos, name, false);
                    has_undeclared_fields = true;
                    listed = place;
                }
                let field = self.str(name);
                self.record_stored_callee(fx, info.layout, name, m.init, false);
                let value = match self.out.layouts[info.layout.idx()].field(field) {
                    Some(field) => {
                        let (want, why) = (
                            self.field_type(info.layout, field),
                            self.field_cast_reason(info.layout, field),
                        );
                        self.expr_with_name_into(fx, m.init, given, want, why)
                    }
                    None => self.expr_with_name(fx, m.init, given),
                };
                if has_undeclared_fields && let Some(place) = place.filter(|&place| place >= listed)
                {
                    listed = end_of_run(place) + 1;
                    self.list_fields(fx, pos, own_fields[listed - 1], true);
                }
                let this = self.this(fx, pos);
                if assigns && matches!(m.key, PropKey::Name(_)) {
                    if self.inherits_accessor(file, class, name) {
                        self.problem(file, m.start, "a class field that shadows an accessor of a base class while \"useDefineForClassFields\" is false");
                    }
                    self.emit_throwing(
                        fx,
                        Op::PropSet {
                            obj: this,
                            name: field,
                            value,
                        },
                    );
                } else {
                    self.define_field(fx, this, name, value);
                }
                continue;
            }
            let value = match m.key {
                _ if m.init.is_none() => self.emit(fx, Op::Undefined),
                PropKey::Computed(written) if !assigns => {
                    let key = self.read_class_variable(fx, file, class, ClassVariable::Key(member));
                    self.expr_with_key_name(fx, m.init, written, key)
                }
                _ => self.expr_with_name(fx, m.init, given),
            };
            let key = match m.key {
                PropKey::Name(name) if assigns => {
                    let (name, this) = (self.str(name), self.this(fx, pos));
                    self.emit_throwing(
                        fx,
                        Op::PropSet {
                            obj: this,
                            name,
                            value,
                        },
                    );
                    continue;
                }
                PropKey::Name(name) => {
                    let name = self.str(name);
                    self.emit(fx, Op::Str(name))
                }
                PropKey::Private(name) => {
                    self.read_class_variable(fx, file, class, ClassVariable::PrivateName(name))
                }
                PropKey::Computed(_) => {
                    self.read_class_variable(fx, file, class, ClassVariable::Key(member))
                }
                PropKey::None => continue,
            };
            let this = self.this(fx, pos);
            let define = if matches!(m.key, PropKey::Private(_)) {
                Operation::PrivateFieldAdd
            } else {
                Operation::DefineField
            };
            self.operation(fx, define, &[this, key, value]);
        }
        if has_undeclared_fields && listed < own_fields.len() {
            self.list_fields(fx, pos, own_fields[own_fields.len() - 1], true);
        }
        fx.is_in_field_initializer = was_in_field_initializer;
    }

    fn is_field_named_by_constant_symbol(
        &mut self,
        file: FileId,
        class: ClassId,
        member: MemberId,
    ) -> bool {
        let m = &self.hir(file)[member];
        m.kind == MemberKind::Property
            && matches!(m.key, PropKey::Computed(_))
            && !m
                .flags
                .intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT)
            && self.class_info(file, class).facts.has_fixed_layout
            && !self.c.is_field_omitted(file, member)
            && self.c.known_member_name(file, m.key).is_some()
    }

    fn inherits_accessor(&mut self, file: FileId, class: ClassId, name: Atom) -> bool {
        let mut at = self.class_info(file, class).base;
        while let Some((file, class)) = at {
            let hir = self.hir(file);
            let has_accessor = hir[class].members.iter().any(|member| {
                let m = &hir[member];
                let is_accessor = matches!(m.kind, MemberKind::Getter | MemberKind::Setter)
                    || m.flags.contains(Flags::ACCESSOR);
                is_accessor
                    && !m.flags.contains(Flags::STATIC)
                    && matches!(m.key, PropKey::Name(key) | PropKey::Private(key) if key == name)
            });
            if has_accessor {
                return true;
            }
            at = self.class_info(file, class).base;
        }
        false
    }

    fn define_field(&mut self, fx: &mut Fx, this: V, key: Atom, value: V) {
        let name = self.str(key);
        let bytes = self.c.atoms().bytes(key);
        let is_field = Self::is_field_name(bytes) && bytes != b"__proto__";
        let is_store = match fx.class {
            Some((file, class)) => is_field && !self.inherits_accessor(file, class, key),
            None => false,
        };
        if is_store {
            self.emit_throwing(
                fx,
                Op::PropSet {
                    obj: this,
                    name,
                    value,
                },
            );
        } else {
            let name = self.emit_key(fx, name);
            self.operation(fx, Operation::DefineField, &[this, name, value]);
        }
    }

    pub(crate) fn super_call(&mut self, fx: &mut Fx, args: IdList<ExprId>, pos: u32) -> V {
        let Some((file, class)) = fx.class else {
            return self.unsupported(fx, pos, "`super()` outside a constructor");
        };
        if self.out.funcs[fx.id.idx()].kind != FuncKind::Constructor && fx.this_binding.is_none() {
            return self.unsupported(fx, pos, "`super()` outside a constructor");
        }
        let info = self.class_info(file, class);
        if !info.is_derived {
            return self.unsupported(fx, pos, "`super()` in a class without `extends`");
        }
        let Some(base) = info.base else {
            if let Some(constructed) = self.construct_promise_subclass(fx, file, class, args, pos) {
                self.bind_this(fx, constructed);
                self.did_bind_this(fx, pos);
                return self.this(fx, pos);
            }
            let written = args;
            if self
                .hir(fx.file)
                .ids(written)
                .all(|e| self.super_argument_is_side_effect_free(fx, written, e))
            {
                let args = self.emit_array_with_spread(fx, args);
                self.emit_super_construct(fx, args, pos);
                return self.this(fx, pos);
            }
            let class_object = self.class_object(fx, file, class);
            let parent = self.operation(fx, Operation::GetSuperConstructor, &[class_object]);
            let args = self.emit_array_with_spread(fx, args);
            let this = self.operation(
                fx,
                Operation::SuperConstruct,
                &[class_object, fx.new_target, args, parent],
            );
            self.bind_this(fx, this);
            self.did_bind_this(fx, pos);
            return self.this(fx, pos);
        };
        let ctor = self.classes[&base].ctor;
        let result = match self
            .has_captures_available(fx, ctor)
            .then(|| self.arguments(fx, args))
            .flatten()
        {
            Some(args) => {
                let uses_new_target = self.out.funcs[ctor.idx()].has(func_flags::HAS_NEW_TARGET);
                let all: Vec<V> = uses_new_target
                    .then_some(fx.new_target)
                    .into_iter()
                    .chain(args)
                    .collect();
                self.emit_direct_call(fx, ctor, fx.given, &all)
            }
            None => {
                let args = self.emit_array_with_spread(fx, args);
                self.emit_construct_on(fx, base, args)
            }
        };
        self.did_call_base_constructor(fx, base, result, pos);
        self.this(fx, pos)
    }

    fn construct_promise_subclass(
        &mut self,
        fx: &mut Fx,
        file: FileId,
        class: ClassId,
        args: IdList<ExprId>,
        pos: u32,
    ) -> Option<V> {
        let executor = self.hir(fx.file).ids(args).next().filter(|&only| {
            args.len() == 1 && !matches!(self.hir(fx.file)[only].kind, ExprKind::Spread(_))
        })?;
        let helper = self.promise_subclass_helper(file, class, b"Promise$constructSubclass")?;
        let class_object = self.class_object(fx, file, class);
        let parent = self.operation(fx, Operation::GetSuperConstructor, &[class_object]);
        let executor = self.expr(fx, executor);
        let callee = self.read_sym(fx, helper, pos);
        let this = self.emit(fx, Op::Undefined);
        Some(
            self.emit_throwing(
                fx,
                Op::Call {
                    callee,
                    this,
                    args: [class_object, fx.new_target, parent, executor]
                        .into_iter()
                        .collect(),
                },
            ),
        )
    }

    fn construct_promise_subclass_with_list(
        &mut self,
        fx: &mut Fx,
        file: FileId,
        class: ClassId,
        list: V,
        pos: u32,
    ) -> Option<V> {
        let helper =
            self.promise_subclass_helper(file, class, b"Promise$constructSubclassWithList")?;
        let class_object = self.class_object(fx, file, class);
        let parent = self.operation(fx, Operation::GetSuperConstructor, &[class_object]);
        let callee = self.read_sym(fx, helper, pos);
        let this = self.emit(fx, Op::Undefined);
        Some(
            self.emit_throwing(
                fx,
                Op::Call {
                    callee,
                    this,
                    args: [class_object, fx.new_target, parent, list]
                        .into_iter()
                        .collect(),
                },
            ),
        )
    }

    fn promise_subclass_helper(
        &mut self,
        file: FileId,
        class: ClassId,
        name: &[u8],
    ) -> Option<Sym> {
        if !self.c.extends_global_promise(file, class) {
            return None;
        }
        let helper = self
            .shared
            .promise_helpers()
            .zip(self.c.atoms().lookup(name));
        helper.and_then(|(helpers, name)| self.exported_binding(helpers, name))
    }

    fn super_argument_is_side_effect_free(
        &mut self,
        fx: &Fx,
        args: IdList<ExprId>,
        e: ExprId,
    ) -> bool {
        use bun_sema::bind::SymFlags;
        let hir = self.hir(fx.file);
        let mut references_own_variable = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name) => self.ident_binding(fx.file, e, name).is_some_and(|found| {
                found.file == fx.file
                    && !self.files.flags(found).contains(SymFlags::ALIAS)
                    && self.declaring_function(found).is_some()
                    && !self.is_ambient(found)
            }),
            _ => false,
        };
        match hir[e].kind {
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Fn(_) => true,
            ExprKind::Ident(_) => references_own_variable(e),
            ExprKind::Spread(inner) => {
                let ExprKind::Ident(name) = hir[inner].kind else {
                    return false;
                };
                if fx.func.is_none() || hir[fx.func].kind != FnKind::Constructor {
                    return false;
                }
                let is_rest = hir[fx.func].params.iter().any(|p| {
                    hir[p].flags.contains(Flags::REST)
                        && matches!(hir[hir[p].pat].kind, PatKind::Ident(rest) if rest == name)
                });
                let FnBody::Block(body) = hir[fx.func].body else {
                    return false;
                };
                let is_first_statement = hir.ids(body).next().is_some_and(|first| match hir[first].kind {
                    bun_sema::hir::StmtKind::Expr(call) => matches!(hir[call].kind, ExprKind::Call(call) if hir[call].args.start == args.start && hir[call].args.len == args.len),
                    _ => false,
                });
                is_rest && is_first_statement && references_own_variable(inner)
            }
            _ => false,
        }
    }

    fn emit_default_super_call(
        &mut self,
        fx: &mut Fx,
        base: (FileId, ClassId),
        handed: &[V],
        pos: u32,
    ) {
        let ctor = self.classes[&base].ctor;
        let result = if self.has_captures_available(fx, ctor) {
            let uses_new_target = self.out.funcs[ctor.idx()].has(func_flags::HAS_NEW_TARGET);
            let all: Vec<V> = uses_new_target
                .then_some(fx.new_target)
                .into_iter()
                .chain(handed.iter().copied())
                .collect();
            let args = self.direct_args(fx, ctor, fx.given, &all);
            self.emit_throwing(fx, Op::CallDirect { func: ctor, args })
        } else {
            let has_rest = self.out.funcs[ctor.idx()].has(func_flags::HAS_REST);
            let named = handed.len() - usize::from(has_rest);
            let mut array =
                self.emit_throwing(fx, Op::NewArray(handed[..named].iter().copied().collect()));
            if has_rest {
                array = self.operation(fx, Operation::AppendSpread, &[array, handed[named]]);
            }
            self.emit_construct_on(fx, base, array)
        };
        self.did_call_base_constructor(fx, base, result, pos);
    }

    fn emit_construct_on(&mut self, fx: &mut Fx, base: (FileId, ClassId), args: V) -> V {
        let extended = match fx.class {
            Some((file, class))
                if self
                    .class_variables
                    .contains_key(&(file, class, ClassVariable::Base)) =>
            {
                self.read_class_variable(fx, file, class, ClassVariable::Base)
            }
            _ => self.class_object(fx, base.0, base.1),
        };
        let new_target = if fx.new_target.is_some() {
            fx.new_target
        } else {
            self.emit(fx, Op::Undefined)
        };
        self.operation(
            fx,
            Operation::ConstructOn,
            &[extended, fx.given, new_target, args],
        )
    }

    fn did_call_base_constructor(
        &mut self,
        fx: &mut Fx,
        base: (FileId, ClassId),
        result: V,
        pos: u32,
    ) {
        if fx.this_var.is_some() && self.classes[&base].returns_constructed_object() {
            let this = self.coerce_to(fx, result, fx.this_type, CoerceReason::Claim);
            self.bind_this(fx, this);
        }
        self.did_bind_this(fx, pos);
    }

    fn emit_super_construct(&mut self, fx: &mut Fx, args: V, pos: u32) {
        let Some((file, class)) = fx.class else {
            return;
        };
        let class_object = self.class_object(fx, file, class);
        let this = self.operation(
            fx,
            Operation::SuperConstruct,
            &[class_object, fx.new_target, args],
        );
        self.bind_this(fx, this);
        self.did_bind_this(fx, pos);
    }

    fn bind_this(&mut self, fx: &mut Fx, this: V) {
        let Some(before) = self.this_if_bound(fx) else {
            return;
        };
        if !matches!(fx.b.func.op(before), Some(Op::Undefined)) {
            let undefined = self.emit(fx, Op::Undefined);
            let is_unbound = self.emit(
                fx,
                Op::StrictEq {
                    a: before,
                    b: undefined,
                },
            );
            let (fine, throw) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_unbound, fine, throw);
            fx.b.seal(fine);
            fx.b.seal(throw);
            fx.b.switch_to(throw);
            self.throw_error(
                fx,
                b"ReferenceError",
                b"'super()' can't be called more than once in a constructor.",
            );
            fx.b.switch_to(fine);
        }
        match (fx.this_binding, fx.this_var) {
            (Some((layout, binding)), _) => {
                self.emit(
                    fx,
                    Op::FieldSet {
                        obj: binding,
                        layout,
                        field: 0,
                        value: this,
                    },
                );
            }
            (None, Some(var)) => self.write(fx, var, this),
            (None, None) => {}
        }
    }

    pub(crate) fn this_if_bound(&mut self, fx: &mut Fx) -> Option<V> {
        match (fx.this_binding, fx.this_var) {
            (Some((layout, binding)), _) => Some(self.emit(
                fx,
                Op::FieldGet {
                    obj: binding,
                    layout,
                    field: 0,
                },
            )),
            (None, Some(var)) => Some(self.read(fx, var)),
            (None, None) => None,
        }
    }

    pub(crate) fn constructor_result(&mut self, fx: &mut Fx, value: V, pos: u32) -> V {
        if value.is_none() {
            return self.this(fx, pos);
        }
        let constructed = fx
            .class
            .map(|(file, class)| self.class_info(file, class).layout);
        if fx.is_typed
            && matches!(fx.b.func.op(value), Some(Op::New(_) | Op::NewWith { .. }))
            && let Some(constructed) = constructed
            && self.out.layouts[constructed.idx()].fields.is_empty()
            && let Some(&view) = self.layout_types.get(&constructed)
        {
            let returned = self.ty(fx, value);
            for source in self.layout_types_in(returned) {
                if source != view {
                    self.c.record_upcast(source, view);
                }
            }
        }
        let unchecked = self.this_if_bound(fx);
        let this = match unchecked {
            Some(this) => this,
            None => self.this(fx, pos),
        };
        let is_derived = fx
            .class
            .is_some_and(|(file, class)| self.class_info(file, class).is_derived);
        let result = self.operation(
            fx,
            if is_derived {
                Operation::DerivedConstructorResult
            } else {
                Operation::ConstructorResult
            },
            &[value, this],
        );
        if unchecked.is_some() {
            self.check_this_is_bound(fx, result);
        }
        result
    }

    pub(crate) fn check_this_is_bound(&mut self, fx: &mut Fx, this: V) {
        let mut source = this;
        while let Some(Op::Coerce { value, .. }) = fx.b.func.op(source) {
            source = *value;
        }
        if matches!(
            fx.b.func.op(source),
            Some(
                Op::CallDirect { .. }
                    | Op::Operation {
                        which: Operation::SuperConstruct | Operation::ConstructOn,
                        ..
                    }
            )
        ) {
            return;
        }
        let undefined = self.emit(fx, Op::Undefined);
        let is_unbound = self.emit(
            fx,
            Op::StrictEq {
                a: this,
                b: undefined,
            },
        );
        let (throw, fine) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_unbound, throw, fine);
        fx.b.seal(throw);
        fx.b.seal(fine);
        fx.b.switch_to(throw);
        self.throw_error(fx, b"ReferenceError", b"'super()' must be called in derived constructor before accessing |this| or returning non-object.");
        fx.b.switch_to(fine);
    }

    fn super_home(&mut self, fx: &mut Fx, pos: u32) -> (V, V) {
        let is_arrow = fx.func.is_some() && self.hir(fx.file)[fx.func].kind == FnKind::Arrow;
        let method = match is_arrow.then(|| self.c.arrow_receiver(fx.file, fx.func)) {
            Some(Receiver::Function(around)) => around,
            Some(_) => FnId::NONE,
            None => fx.func,
        };
        if let Some(&home) = fx.home_objects.get(&method) {
            let uses_home_object = self.emit(fx, Op::Bool(true));
            return (home, uses_home_object);
        }
        let class = match fx.class {
            Some((file, class)) => self.class_object(fx, file, class),
            None => self.unsupported(fx, pos, "`super` outside a class"),
        };
        let is_static = self.emit(fx, Op::Bool(fx.is_static));
        (class, is_static)
    }

    pub(crate) fn super_get(&mut self, fx: &mut Fx, name: StrId, pos: u32) -> V {
        if self.is_builtin_file(fx.file) && self.out.strs.get(name).starts_with(b"$") {
            self.problem(fx.file, pos, "a `$` intrinsic after `super.`");
        }
        let key = self.emit(fx, Op::Str(name));
        self.super_get_by_key(fx, key, pos)
    }

    pub(crate) fn super_get_by_key(&mut self, fx: &mut Fx, key: V, pos: u32) -> V {
        let (class, is_static) = self.super_home(fx, pos);
        let this = self.this(fx, pos);
        self.operation(fx, Operation::SuperGet, &[class, key, this, is_static])
    }

    pub(crate) fn super_set(&mut self, fx: &mut Fx, name: StrId, value: V, pos: u32) {
        if self.is_builtin_file(fx.file) && self.out.strs.get(name).starts_with(b"$") {
            self.problem(fx.file, pos, "a `$` intrinsic after `super.`");
        }
        let key = self.emit(fx, Op::Str(name));
        self.super_set_by_key(fx, key, value, pos);
    }

    pub(crate) fn super_set_by_key(&mut self, fx: &mut Fx, key: V, value: V, pos: u32) {
        let (class, is_static) = self.super_home(fx, pos);
        let this = self.this(fx, pos);
        self.operation(
            fx,
            Operation::SuperSet,
            &[class, key, value, this, is_static],
        );
    }
}

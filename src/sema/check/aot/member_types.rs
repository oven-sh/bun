use super::answers::{
    CheckedMember, CheckedType, GaveUp, IndexKey, IndexSignature, ListedMember, MemberName,
    ObjectMember, ObjectMemberKind, PositionTypes, SymbolCreation, WrittenType,
};
use super::queries::Queries;
use crate::atom::Atom;
use crate::bind::{Decl, MemberOwner, PatParent};
use crate::hir::{ExprId, ExprKind, MemberKind, TypeNodeId};
use crate::program::{FileId, Sym};
use crate::types::{
    ComponentsId, IndexInfo, MapperId, Prop, PropFlags, PropSource, TypeData, TypeId,
    UniqueSymbolDeclaration,
};
use smallvec::SmallVec;

enum Annotation {
    Node(TypeNodeId),
    Signature,
    Missing,
}

#[derive(Copy, Clone)]
struct AnnotatedDeclaration {
    file: FileId,
    decl: Decl,
    node: TypeNodeId,
}

#[derive(Default)]
struct WrittenParts {
    types: SmallVec<[TypeId; 4]>,
    gave_up: Option<GaveUp>,
    has_unwritten: bool,
}

impl WrittenParts {
    fn add(&mut self, part: WrittenType) {
        match part {
            WrittenType::Written(ty) => self.types.push(ty),
            WrittenType::Unwritten => self.has_unwritten = true,
            WrittenType::GaveUp(reason) => {
                self.gave_up.get_or_insert(reason);
            }
        }
    }

    fn is_every_part_written(&self) -> bool {
        !self.types.is_empty() && !self.has_unwritten && self.gave_up.is_none()
    }

    fn state_without_type(&self) -> WrittenType {
        self.gave_up
            .map_or(WrittenType::Unwritten, WrittenType::GaveUp)
    }
}

fn written_as_checked(written: WrittenType, checked: CheckedType) -> WrittenType {
    match (written, checked) {
        (WrittenType::Written(form), Ok(ty)) if form != ty => WrittenType::Unwritten,
        (WrittenType::Written(_), Err(reason)) => WrittenType::GaveUp(reason),
        (WrittenType::Written(_) | WrittenType::Unwritten | WrittenType::GaveUp(_), _) => written,
    }
}

fn member_kind(flags: PropFlags) -> ObjectMemberKind {
    if flags.contains(PropFlags::METHOD) {
        ObjectMemberKind::Method
    } else if !flags.contains(PropFlags::ACCESSOR) {
        ObjectMemberKind::Field
    } else if flags.contains(PropFlags::WRITE_ONLY) {
        ObjectMemberKind::Setter
    } else if flags.contains(PropFlags::READONLY) {
        ObjectMemberKind::Getter
    } else {
        ObjectMemberKind::GetterAndSetter
    }
}

fn index_key(key: TypeId) -> IndexKey {
    match key {
        TypeId::STRING => IndexKey::String,
        TypeId::NUMBER => IndexKey::Number,
        TypeId::SYMBOL => IndexKey::Symbol,
        _ => IndexKey::Pattern,
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn member_name(&self, name: Atom) -> MemberName {
        let atoms = self.c.atoms();
        if atoms.is_symbol_name(name) {
            MemberName::Symbol(name)
        } else if atoms.is_private_symbol_name(name) {
            MemberName::Private(name)
        } else {
            MemberName::String(name)
        }
    }

    pub(super) fn symbol_member_name(&mut self, file: FileId, key: ExprId) -> Option<Atom> {
        if !matches!(self.c.hir(file)[key].kind, ExprKind::Ident(_)) {
            return None;
        }
        let ty = self.c.type_of_expr(file, key);
        match self.c.data(ty) {
            TypeData::UniqueSymbol {
                symbol: UniqueSymbolDeclaration::Variable(_),
                ..
            } => self.c.property_name_of_type(ty),
            _ => None,
        }
    }

    pub fn symbol_creation(&mut self, name: Atom) -> Option<SymbolCreation> {
        let key = self.c.key_type_of_name(name)?;
        let &TypeData::UniqueSymbol {
            symbol: UniqueSymbolDeclaration::Variable(variable),
            ..
        } = self.c.data(key)
        else {
            return None;
        };
        let (hir, bound) = (self.c.hir(variable.file), self.c.bound(variable.file));
        let &[Decl::Var(pattern)] = bound.symbol(variable.id).decls else {
            return None;
        };
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let initializer = hir[declaration].init.some()?;
        let ExprKind::Call(call) = hir[initializer].kind else {
            return None;
        };
        let callee = hir[call].callee;
        if !matches!(hir[callee].kind, ExprKind::Ident(_))
            || !self
                .c
                .is_symbol_or_symbol_for_call(variable.file, initializer)
        {
            return None;
        }
        let mut arguments = hir.ids(hir[call].args);
        let description = match (arguments.next(), arguments.next()) {
            (None, _) => None,
            (Some(text), None) => match hir[text].kind {
                ExprKind::String(text) => Some(text),
                _ => return None,
            },
            (Some(_), Some(_)) => return None,
        };
        Some(SymbolCreation {
            file: variable.file,
            position: hir[callee].pos,
            description,
        })
    }

    pub(super) fn listed_member_of_prop(
        &self,
        prop: &Prop<'_>,
        property_index: u32,
    ) -> ListedMember {
        ListedMember {
            name: self.member_name(prop.name),
            kind: member_kind(prop.flags),
            is_optional: prop.flags.contains(PropFlags::OPTIONAL),
            property_index,
        }
    }

    pub(super) fn member_of_prop(
        &mut self,
        prop: &'p Prop<'p>,
        written_outer: MapperId,
        checked_outer: MapperId,
    ) -> ObjectMember {
        ObjectMember {
            name: self.member_name(prop.name),
            kind: member_kind(prop.flags),
            types: PositionTypes {
                written: self.ask_written(|queries| queries.written_of_prop(prop, written_outer)),
                checked: self
                    .ask(|queries| queries.type_without_optional_undefined(prop, checked_outer)),
            },
            is_optional: prop.flags.contains(PropFlags::OPTIONAL),
            is_readonly: prop.flags.contains(PropFlags::READONLY),
        }
    }

    pub(super) fn checked_member_of_prop(
        &mut self,
        prop: &'p Prop<'p>,
        outer: MapperId,
    ) -> CheckedMember {
        CheckedMember {
            name: self.member_name(prop.name),
            kind: member_kind(prop.flags),
            checked: self.ask(|queries| queries.type_without_optional_undefined(prop, outer)),
            is_optional: prop.flags.contains(PropFlags::OPTIONAL),
            is_readonly: prop.flags.contains(PropFlags::READONLY),
        }
    }

    pub(super) fn is_inferred_member(&mut self, prop: &'p Prop<'p>) -> bool {
        match &prop.source {
            PropSource::Type(_) | PropSource::Copy(..) | PropSource::Mapped(..) => false,
            PropSource::Literal(..) | PropSource::ReverseMapped(..) => true,
            PropSource::Symbol(symbol) => {
                let declarations = self.c.declarations_of_property(*symbol);
                declarations.iter().any(|&(file, decl)| {
                    matches!(self.annotation_of(file, decl), Annotation::Missing)
                })
            }
            PropSource::Intersected(_, parts) => {
                parts.iter().any(|part| self.is_inferred_member(part))
            }
        }
    }

    pub(super) fn index_signature(
        &mut self,
        owner: TypeId,
        info: &IndexInfo,
        written_mapper: MapperId,
        checked_mapper: MapperId,
    ) -> IndexSignature {
        IndexSignature {
            key: index_key(info.key),
            types: PositionTypes {
                written: self.ask_written(|queries| {
                    queries.written_of_index_info(owner, info, written_mapper)
                }),
                checked: self.ask(|queries| queries.index_value_type(info, checked_mapper)),
            },
            is_readonly: info.readonly,
        }
    }

    fn written_of_index_info(
        &mut self,
        owner: TypeId,
        info: &IndexInfo,
        mapper: MapperId,
    ) -> WrittenType {
        if self.c.is_stack_low() {
            return WrittenType::GaveUp(GaveUp::Unresolved);
        }
        let Some((file, member)) = info.declaration else {
            if info.components != ComponentsId::NONE {
                return WrittenType::Unwritten;
            }
            return self.written_of_mapped_member(
                owner,
                |queries, modifiers_type| queries.written_of_index_key(modifiers_type, info.key),
                |queries| queries.index_value_type(info, mapper),
            );
        };
        let node = self.c.hir(file)[member].ty;
        if !self.file_trust(file).is_trusted() || node.is_none() {
            return WrittenType::Unwritten;
        }
        let form = match self.written_form(file, node) {
            Ok(form) => form,
            Err(reason) => return WrittenType::GaveUp(reason),
        };
        if form == self.c.type_from_node(file, node) {
            return WrittenType::from_result(self.index_value_type(info, mapper));
        }
        let ty = self.c.instantiate(form, mapper);
        WrittenType::from_result(self.resolved(ty))
    }

    fn written_of_index_key(&mut self, owner: TypeId, key: TypeId) -> WrittenType {
        let Some(members) = self.c.members_for_index_infos(owner) else {
            return WrittenType::Unwritten;
        };
        let Some(info) = self.c.applicable_index_info(&members, key) else {
            return WrittenType::Unwritten;
        };
        let written = self.written_of_index_info(owner, &info, MapperId::IDENTITY);
        written_as_checked(written, self.index_value_type(&info, MapperId::IDENTITY))
    }

    fn index_value_type(&mut self, info: &IndexInfo, mapper: MapperId) -> CheckedType {
        let ty = self.c.instantiate(info.value, mapper);
        self.resolved(ty)
    }

    fn written_of_mapped_member(
        &mut self,
        mapped: TypeId,
        written_of_origin: impl FnOnce(&mut Self, TypeId) -> WrittenType,
        compute_type: impl FnOnce(&mut Self) -> CheckedType,
    ) -> WrittenType {
        let Some((file, node, _)) = self.c.mapped_origin(mapped) else {
            return WrittenType::Unwritten;
        };
        let template = self.c.mapped_decl(file, node).ty;
        let is_template_trusted = self.is_type_function_file(file)
            && (template.is_none() || !self.mentions_untrusted_alias(file, template));
        if !is_template_trusted {
            return WrittenType::Unwritten;
        }
        let Some(modifiers_type) = self.c.mapped_modifiers_type(mapped) else {
            return WrittenType::from_result(compute_type(self));
        };
        if self.has_remapping_name_type(mapped) {
            return WrittenType::Unwritten;
        }
        written_of_origin(self, modifiers_type).and_then(|_| compute_type(self))
    }

    fn has_remapping_name_type(&mut self, mapped: TypeId) -> bool {
        let Some(name_type) = self.c.mapped_name_type(mapped) else {
            return false;
        };
        let key = self.c.mapped_type_param(mapped);
        !self.c.is_assignable(name_type, key)
    }

    fn written_of_mapped_prop(
        &mut self,
        mapped: TypeId,
        prop: &'p Prop<'p>,
        outer: MapperId,
    ) -> WrittenType {
        self.written_of_mapped_member(
            mapped,
            |queries, _| match queries.c.synthetic_origin(mapped, prop) {
                Some(origin) => queries.written_of_source(origin),
                None => WrittenType::Unwritten,
            },
            |queries| queries.type_without_optional_undefined(prop, outer),
        )
    }

    fn written_of_prop(&mut self, prop: &'p Prop<'p>, outer: MapperId) -> WrittenType {
        if self.c.is_stack_low() {
            return WrittenType::GaveUp(GaveUp::Unresolved);
        }
        match &prop.source {
            PropSource::Type(_) => WrittenType::Unwritten,
            PropSource::Literal(..) | PropSource::ReverseMapped(..) => {
                self.note_inferred_member();
                WrittenType::Unwritten
            }
            PropSource::Symbol(symbol) => self.written_of_symbol(prop, *symbol, outer),
            PropSource::Intersected(whole, parts) => {
                self.written_of_parts(prop, *whole, parts, outer)
            }
            PropSource::Mapped(mapped, ..) => self.written_of_mapped_prop(*mapped, prop, outer),
            PropSource::Copy(_, declared, _) => self.written_of_copy(prop, declared, outer),
        }
    }

    fn written_of_source(&mut self, source: &'p Prop<'p>) -> WrittenType {
        let written = match self.written_of_prop(source, MapperId::IDENTITY) {
            WrittenType::Written(form) => self.instantiate_form(source, form, MapperId::IDENTITY),
            written @ (WrittenType::Unwritten | WrittenType::GaveUp(_)) => return written,
        };
        let checked = self.type_without_optional_undefined(source, MapperId::IDENTITY);
        written_as_checked(written, checked)
    }

    fn written_of_copy(
        &mut self,
        prop: &'p Prop<'p>,
        declared: &'p [Prop<'p>],
        outer: MapperId,
    ) -> WrittenType {
        let mut sources = WrittenParts::default();
        for source in declared {
            sources.add(self.written_of_source(source));
        }
        if !sources.is_every_part_written() {
            return sources.state_without_type();
        }
        let checked = match self.type_without_optional_undefined(prop, outer) {
            Ok(checked) => checked,
            Err(reason) => return WrittenType::GaveUp(reason),
        };
        match self.c.union(&sources.types) == checked {
            true => WrittenType::Written(checked),
            false => WrittenType::Unwritten,
        }
    }

    fn written_of_parts(
        &mut self,
        prop: &'p Prop<'p>,
        whole: TypeId,
        parts: &'p [Prop<'p>],
        outer: MapperId,
    ) -> WrittenType {
        let mut written = WrittenParts::default();
        for part in parts {
            written.add(self.written_of_prop(part, MapperId::IDENTITY));
        }
        if !written.is_every_part_written() {
            return written.state_without_type();
        }
        if self.c.is_union(whole) {
            return WrittenType::Written(self.c.union(&written.types));
        }
        let written = WrittenType::Written(self.c.intersection(&written.types));
        written_as_checked(written, self.type_without_optional_undefined(prop, outer))
    }

    fn written_of_symbol(
        &mut self,
        prop: &'p Prop<'p>,
        symbol: Sym,
        outer: MapperId,
    ) -> WrittenType {
        let declarations = self.c.declarations_of_property(symbol);
        let is_inferred = declarations
            .iter()
            .any(|&(file, decl)| matches!(self.annotation_of(file, decl), Annotation::Missing));
        if is_inferred {
            self.note_inferred_member();
        }
        if !self.member_trust(&declarations).is_trusted() {
            return WrittenType::Unwritten;
        }
        let is_every_signature = declarations
            .iter()
            .all(|&(file, decl)| matches!(self.annotation_of(file, decl), Annotation::Signature));
        if is_every_signature {
            let ty = self.c.type_of_prop(prop, outer);
            return WrittenType::from_result(self.resolved(ty));
        }
        let annotated = match member_kind(prop.flags) {
            ObjectMemberKind::Field | ObjectMemberKind::Method => {
                Ok(self.field_annotation(&declarations))
            }
            _ => self.accessor_annotation(&declarations),
        };
        let annotated = match annotated {
            Ok(Some(annotated)) => annotated,
            Ok(None) => return WrittenType::Unwritten,
            Err(reason) => return WrittenType::GaveUp(reason),
        };
        let form = match self.written_form(annotated.file, annotated.node) {
            Ok(form) => form,
            Err(reason) => return WrittenType::GaveUp(reason),
        };
        if self.is_class_declaration(annotated.file, annotated.decl) {
            return WrittenType::Written(form);
        }
        if form == self.c.type_from_node(annotated.file, annotated.node) {
            return WrittenType::from_result(self.type_without_optional_undefined(prop, outer));
        }
        self.instantiate_form(prop, form, outer)
    }

    fn instantiate_form(
        &mut self,
        prop: &'p Prop<'p>,
        form: TypeId,
        outer: MapperId,
    ) -> WrittenType {
        let ty = self.c.instantiate(form, prop.mapper);
        let ty = self.c.instantiate(ty, outer);
        match self.resolved(ty) {
            Ok(ty) => WrittenType::Written(self.without_optional_undefined(prop, ty)),
            Err(reason) => WrittenType::GaveUp(reason),
        }
    }

    fn accessor_annotation(
        &mut self,
        declarations: &[(FileId, Decl)],
    ) -> Result<Option<AnnotatedDeclaration>, GaveUp> {
        let mut getter = None;
        let mut setter = None;
        for &(file, decl) in declarations {
            let Annotation::Node(node) = self.annotation_of(file, decl) else {
                continue;
            };
            let annotated = AnnotatedDeclaration { file, decl, node };
            let is_getter = matches!(decl, Decl::Member(member)
                if self.c.hir(file)[member].kind == MemberKind::Getter);
            if is_getter {
                getter.get_or_insert(annotated);
            } else {
                setter.get_or_insert(annotated);
            }
        }
        let (Some(read), Some(write)) = (getter, setter) else {
            return Ok(getter.or(setter));
        };
        let read_type = self.written_form(read.file, read.node)?;
        let write_type = self.written_form(write.file, write.node)?;
        Ok((read_type == write_type).then_some(read))
    }

    fn field_annotation(&self, declarations: &[(FileId, Decl)]) -> Option<AnnotatedDeclaration> {
        let mut first = None;
        for &(file, decl) in declarations {
            match self.annotation_of(file, decl) {
                Annotation::Node(node) => {
                    first.get_or_insert(AnnotatedDeclaration { file, decl, node });
                }
                Annotation::Signature | Annotation::Missing => return None,
            }
        }
        first
    }

    fn is_class_declaration(&self, file: FileId, decl: Decl) -> bool {
        matches!(decl, Decl::ParameterProperty(_))
            || matches!(decl, Decl::Member(member)
                if matches!(self.c.bound(file).member_owner[member.idx()], MemberOwner::Class(_)))
    }

    fn annotation_of(&self, file: FileId, decl: Decl) -> Annotation {
        let hir = self.c.hir(file);
        let node = match decl {
            Decl::Member(member) => {
                let member = &hir[member];
                match member.kind {
                    MemberKind::Property => member.ty,
                    MemberKind::Method => return Annotation::Signature,
                    MemberKind::Getter => hir[member.func].ret,
                    MemberKind::Setter => {
                        hir[member.func].effective_set_accessor_type_annotation_node(hir)
                    }
                    _ => TypeNodeId::NONE,
                }
            }
            Decl::ParameterProperty(parameter) => hir[parameter].ty,
            _ => TypeNodeId::NONE,
        };
        node.some().map_or(Annotation::Missing, Annotation::Node)
    }

    fn type_without_optional_undefined(
        &mut self,
        prop: &'p Prop<'p>,
        outer: MapperId,
    ) -> CheckedType {
        let ty = self.c.type_of_prop(prop, outer);
        let ty = self.resolved(ty)?;
        Ok(self.without_optional_undefined(prop, ty))
    }

    fn without_optional_undefined(&mut self, prop: &'p Prop<'p>, ty: TypeId) -> TypeId {
        if !prop.flags.contains(PropFlags::OPTIONAL) {
            return ty;
        }
        let defined = self.c.filter(ty, |_, member| !member.is_undefined());
        if defined.is_never() {
            TypeId::UNDEFINED
        } else {
            defined
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn member_kind_follows_flags() {
        let accessor = PropFlags::ACCESSOR;
        assert_eq!(member_kind(PropFlags::empty()), ObjectMemberKind::Field);
        assert_eq!(member_kind(PropFlags::READONLY), ObjectMemberKind::Field);
        assert_eq!(member_kind(PropFlags::METHOD), ObjectMemberKind::Method);
        assert_eq!(
            member_kind(accessor | PropFlags::WRITE_ONLY),
            ObjectMemberKind::Setter
        );
        assert_eq!(
            member_kind(accessor | PropFlags::READONLY),
            ObjectMemberKind::Getter
        );
        assert_eq!(member_kind(accessor), ObjectMemberKind::GetterAndSetter);
    }

    #[test]
    fn source_stays_written_only_as_checked() {
        let number = WrittenType::Written(TypeId::NUMBER);
        let gave_up = WrittenType::GaveUp(GaveUp::Unresolved);
        assert_eq!(written_as_checked(number, Ok(TypeId::NUMBER)), number);
        assert_eq!(
            written_as_checked(WrittenType::Written(TypeId::UNKNOWN), Ok(TypeId::NUMBER)),
            WrittenType::Unwritten
        );
        assert_eq!(
            written_as_checked(number, Err(GaveUp::ErrorType)),
            WrittenType::GaveUp(GaveUp::ErrorType)
        );
        assert_eq!(
            written_as_checked(WrittenType::Unwritten, Ok(TypeId::NUMBER)),
            WrittenType::Unwritten
        );
        assert_eq!(written_as_checked(gave_up, Ok(TypeId::NUMBER)), gave_up);
    }

    #[test]
    fn first_gave_up_wins_over_unwritten() {
        let mut parts = WrittenParts::default();
        assert!(!parts.is_every_part_written());
        assert_eq!(parts.state_without_type(), WrittenType::Unwritten);
        parts.add(WrittenType::Written(TypeId::NUMBER));
        assert!(parts.is_every_part_written());
        parts.add(WrittenType::Unwritten);
        assert_eq!(parts.state_without_type(), WrittenType::Unwritten);
        parts.add(WrittenType::GaveUp(GaveUp::ErrorType));
        parts.add(WrittenType::GaveUp(GaveUp::Unresolved));
        assert!(!parts.is_every_part_written());
        assert_eq!(
            parts.state_without_type(),
            WrittenType::GaveUp(GaveUp::ErrorType)
        );
        assert_eq!(parts.types[..], [TypeId::NUMBER]);
    }
}

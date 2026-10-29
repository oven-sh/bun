use super::answers::{
    CheckedMember, GaveUp, IndexSignature, ListedMember, MemberLookup, MemberName, ObjectMember,
    PositionTypes, WrittenType,
};
use super::queries::Queries;
use super::type_shape::{ShapeKind, TypeShape};
use crate::atom::Atom;
use crate::hir::{ExprId, MemberKey};
use crate::program::Sym;
use crate::types::{IndexInfo, MapperId, Origin, TypeData, TypeId};
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq)]
enum ReceiverKind {
    Object,
    Class,
    Container,
    Other,
}

#[derive(Copy, Clone)]
enum UsesReceiverArguments {
    No,
    Yes,
}

#[derive(Copy, Clone)]
enum LookupKey {
    Name(Atom),
    Type(TypeId),
}

fn receiver_kind(shape: TypeShape<'_>) -> ReceiverKind {
    match shape.kind {
        ShapeKind::Object => ReceiverKind::Object,
        ShapeKind::Class(_) => ReceiverKind::Class,
        ShapeKind::Array { .. } | ShapeKind::Tuple { .. } | ShapeKind::Builtin { .. } => {
            ReceiverKind::Container
        }
        _ => ReceiverKind::Other,
    }
}

fn lookup_written_type(lookup: MemberLookup) -> WrittenType {
    match lookup {
        MemberLookup::Member(member) => member.types.written,
        MemberLookup::Index(signature) => signature.types.written,
        MemberLookup::Absent => WrittenType::Unwritten,
    }
}

fn replace_written_type(lookup: MemberLookup, written: WrittenType) -> MemberLookup {
    match lookup {
        MemberLookup::Member(member) => {
            let types = PositionTypes {
                written,
                ..member.types
            };
            MemberLookup::Member(ObjectMember { types, ..member })
        }
        MemberLookup::Index(signature) => {
            let types = PositionTypes {
                written,
                ..signature.types
            };
            MemberLookup::Index(IndexSignature { types, ..signature })
        }
        MemberLookup::Absent => MemberLookup::Absent,
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn declared_type_of_this(&mut self, ty: TypeId) -> TypeId {
        if let TypeData::ThisParam(symbol) = self.c.data(ty) {
            return self.c.declared_type(*symbol);
        }
        ty
    }

    pub(super) fn compute_object_members(
        &mut self,
        ty: TypeId,
    ) -> Result<&'c [ObjectMember], GaveUp> {
        let ty = self.declared_type_of_this(ty);
        let shape = self.type_shape(ty)?;
        if !shape.has_members() {
            return Ok(&[]);
        }
        let Some(members) = self.c.members(ty) else {
            return Ok(&[]);
        };
        let skips_private_names = receiver_kind(shape) == ReceiverKind::Object;
        let props = &members.shape().props;
        let mut list = Vec::with_capacity(props.len());
        for prop in props.iter() {
            let is_private = matches!(self.member_name(prop.name), MemberName::Private(_));
            if is_private && skips_private_names {
                continue;
            }
            list.push(self.member_of_prop(prop, members.mapper, members.mapper));
        }
        Ok(self.list(&list))
    }

    pub(super) fn compute_checked_members(
        &mut self,
        ty: TypeId,
    ) -> Result<(&'c [CheckedMember], bool), GaveUp> {
        let ty = self.declared_type_of_this(ty);
        let shape = self.type_shape(ty)?;
        if !shape.has_members() {
            return Ok((&[], false));
        }
        let Some(members) = self.c.members(ty) else {
            return Ok((&[], false));
        };
        let skips_private_names = receiver_kind(shape) == ReceiverKind::Object;
        let props = &members.shape().props;
        let mut list = Vec::with_capacity(props.len());
        let mut has_inferred_member = false;
        for prop in props.iter() {
            let is_private = matches!(self.member_name(prop.name), MemberName::Private(_));
            if is_private && skips_private_names {
                continue;
            }
            list.push(self.checked_member_of_prop(prop, members.mapper));
            has_inferred_member = has_inferred_member || self.is_inferred_member(prop);
        }
        Ok((self.list(&list), has_inferred_member))
    }

    pub(super) fn compute_find_checked_member(
        &mut self,
        receiver: TypeId,
        name: Atom,
    ) -> Result<Option<CheckedMember>, GaveUp> {
        let receiver = self.resolved(receiver)?;
        let found = self.c.get_property_of_type(receiver, name);
        Ok(found.map(|(prop, mapper)| self.checked_member_of_prop(prop, mapper)))
    }

    pub(super) fn compute_listed_members(
        &mut self,
        ty: TypeId,
    ) -> Result<&'c [ListedMember], GaveUp> {
        let ty = self.declared_type_of_this(ty);
        let shape = self.type_shape(ty)?;
        if !shape.has_members() {
            return Ok(&[]);
        }
        let Some(members) = self.c.members(ty) else {
            return Ok(&[]);
        };
        let skips_private_names = receiver_kind(shape) == ReceiverKind::Object;
        let props = &members.shape().props;
        let mut list = Vec::with_capacity(props.len());
        for (property_index, prop) in (0u32..).zip(props.iter()) {
            let member = self.listed_member_of_prop(prop, property_index);
            let is_private = matches!(member.name, MemberName::Private(_));
            if is_private && skips_private_names {
                continue;
            }
            list.push(member);
        }
        Ok(self.list(&list))
    }

    pub(super) fn compute_listed_member_types(
        &mut self,
        ty: TypeId,
        member: ListedMember,
    ) -> PositionTypes {
        let ty = self.declared_type_of_this(ty);
        let members = self.c.members(ty);
        let Some(members) = members else {
            debug_assert!(false, "a listed member belongs to a type with members");
            return PositionTypes::unwritten(Err(GaveUp::Unresolved));
        };
        let prop = &members.shape().props[member.property_index as usize];
        self.member_of_prop(prop, members.mapper, members.mapper)
            .types
    }

    pub(super) fn compute_index_signatures(
        &mut self,
        ty: TypeId,
    ) -> Result<&'c [IndexSignature], GaveUp> {
        let ty = self.declared_type_of_this(ty);
        if !self.type_shape(ty)?.has_members() {
            return Ok(&[]);
        }
        let Some(members) = self.c.members(ty) else {
            return Ok(&[]);
        };
        let members = self.c.structured(members);
        let mut list = Vec::with_capacity(members.index_infos().len());
        for info in members.index_infos() {
            if !info.is_enum_number_index_info {
                list.push(self.index_signature(ty, info, members.mapper, members.mapper));
            }
        }
        Ok(self.list(&list))
    }

    pub(super) fn compute_find_member(
        &mut self,
        receiver: TypeId,
        name: Atom,
    ) -> Result<MemberLookup, GaveUp> {
        self.lookup_member(receiver, name, UsesReceiverArguments::Yes)
    }

    pub(super) fn compute_member_access(&mut self, access: ExprId) -> Result<MemberLookup, GaveUp> {
        let file = self.file;
        let Some((object, key)) = self.c.hir(file).member_key(access) else {
            return Ok(MemberLookup::Absent);
        };
        let object_type = self.c.type_of_expr(file, object);
        let receiver = self.without_nullish(object_type)?;
        if receiver.is_never() {
            return Ok(MemberLookup::Absent);
        }
        let arguments = UsesReceiverArguments::No;
        match key {
            MemberKey::Name(name) | MemberKey::PrivateName(name) => {
                self.lookup_member(receiver, name, arguments)
            }
            MemberKey::Computed(index) => self.find_computed_member(receiver, index, arguments),
        }
    }

    fn lookup_member(
        &mut self,
        receiver: TypeId,
        name: Atom,
        arguments: UsesReceiverArguments,
    ) -> Result<MemberLookup, GaveUp> {
        let receiver = self.resolved(receiver)?;
        Ok(self.find_member_by_key(receiver, LookupKey::Name(name), arguments))
    }

    fn find_computed_member(
        &mut self,
        receiver: TypeId,
        index: ExprId,
        arguments: UsesReceiverArguments,
    ) -> Result<MemberLookup, GaveUp> {
        if receiver_kind(self.type_shape(receiver)?) == ReceiverKind::Container {
            return Ok(MemberLookup::Absent);
        }
        let file = self.file;
        if let Some(name) = self.c.literal_key(file, index) {
            return self.lookup_member(receiver, name, arguments);
        }
        let key = self.c.type_of_expr(file, index);
        let key = self.resolved(key)?;
        if let Some(name) = self.c.property_name_of_type(key) {
            return self.lookup_member(receiver, name, arguments);
        }
        Ok(self.find_member_by_key(receiver, LookupKey::Type(key), arguments))
    }

    fn find_member_by_key(
        &mut self,
        receiver: TypeId,
        key: LookupKey,
        arguments: UsesReceiverArguments,
    ) -> MemberLookup {
        let found = self.find_member_in_type(receiver, key);
        match arguments {
            UsesReceiverArguments::Yes => found,
            UsesReceiverArguments::No => self.remove_receiver_arguments(found, receiver, key),
        }
    }

    fn find_member_in_type(&mut self, ty: TypeId, key: LookupKey) -> MemberLookup {
        if let LookupKey::Name(name) = key {
            if let Some((prop, mapper)) = self.c.get_property_of_type(ty, name) {
                return MemberLookup::Member(self.member_of_prop(prop, mapper, mapper));
            }
            if matches!(self.member_name(name), MemberName::Private(_)) {
                return MemberLookup::Absent;
            }
        }
        let Some(members) = self.c.members_for_index_infos(ty) else {
            return MemberLookup::Absent;
        };
        let info = match key {
            LookupKey::Name(name) => self.c.applicable_index_info_for_name(&members, name),
            LookupKey::Type(key_type) => self.c.applicable_index_info(&members, key_type),
        };
        match info {
            Some(info) => self.index_lookup(ty, &info),
            None => MemberLookup::Absent,
        }
    }

    fn index_lookup(&mut self, owner: TypeId, info: &IndexInfo) -> MemberLookup {
        let signature = self.index_signature(owner, info, MapperId::IDENTITY, MapperId::IDENTITY);
        MemberLookup::Index(signature)
    }

    fn remove_receiver_arguments(
        &mut self,
        found: MemberLookup,
        receiver: TypeId,
        key: LookupKey,
    ) -> MemberLookup {
        let instantiated = lookup_written_type(found);
        match instantiated {
            WrittenType::Written(_) => {
                let written = self.ask_written(|queries| {
                    queries.declared_written_type(receiver, key, instantiated)
                });
                replace_written_type(found, written)
            }
            WrittenType::Unwritten | WrittenType::GaveUp(_) => found,
        }
    }

    fn declared_written_type(
        &mut self,
        receiver: TypeId,
        key: LookupKey,
        instantiated: WrittenType,
    ) -> WrittenType {
        let apparent = self.c.reduced_apparent_type(receiver);
        let Some(declared) = self.declared_form(apparent) else {
            return WrittenType::Unwritten;
        };
        if declared == apparent {
            return instantiated;
        }
        match self.resolved(declared) {
            Ok(declared) => lookup_written_type(self.find_member_in_type(declared, key)),
            Err(reason) => WrittenType::GaveUp(reason),
        }
    }

    fn declared_form(&mut self, ty: TypeId) -> Option<TypeId> {
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => Some(self.reference_declared_form(ty, *target)),
            TypeData::Anon { origin, .. } => Some(self.origin_declared_form(ty, *origin)),
            TypeData::Union(parts) => {
                let forms: Option<SmallVec<[TypeId; 4]>> =
                    parts.iter().map(|&part| self.declared_form(part)).collect();
                let forms = forms?;
                Some(match forms[..] == parts[..] {
                    true => ty,
                    false => self.c.union(&forms),
                })
            }
            TypeData::Intersection(parts) => {
                let forms: SmallVec<[TypeId; 4]> = parts
                    .iter()
                    .filter_map(|&part| self.declared_form(part))
                    .collect();
                if forms.is_empty() {
                    return None;
                }
                Some(match forms[..] == parts[..] {
                    true => ty,
                    false => self.c.intersection(&forms),
                })
            }
            _ => None,
        }
    }

    fn reference_declared_form(&mut self, reference: TypeId, target: Sym) -> TypeId {
        let declared = self.c.declared_type(target);
        let parameters = self.c.type_arguments(declared);
        match self.c.type_arguments(reference).starts_with(parameters) {
            true => reference,
            false => declared,
        }
    }

    fn origin_declared_form(&mut self, ty: TypeId, origin: Origin) -> TypeId {
        match origin {
            Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => {
                self.c.type_from_node(file, node)
            }
            Origin::ClassStatic(symbol) | Origin::Function(symbol) => self.c.type_of_symbol(symbol),
            _ => ty,
        }
    }
}

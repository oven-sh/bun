use super::description::{
    Description, Key, Tag, class_description, leaf, leaf_bytes, leaf_word, member_name_key,
};
use super::{ObjectOrigin, TypeIdentity};
use crate::bind::{Bound, ScopeId, ScopeKind};
use crate::check::aot::answers::{GaveUp, WrittenType};
use crate::check::aot::builtin_types::BuiltinTypeClass;
use crate::check::aot::queries::Queries;
use crate::check::aot::trust::Trust;
use crate::check::aot::type_shape::{ShapeKind, TupleElement};
use crate::hir::TypeNodeId;
use crate::program::{FileId, Sym};
use crate::types::{Origin, TypeData, TypeId};
use crate::util::FxHashMap;

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(in crate::check::aot) fn compute_type_identity(
        &mut self,
        ty: TypeId,
    ) -> Result<TypeIdentity, GaveUp> {
        Walk::default().describe(self, ty).map(TypeIdentity)
    }

    pub(in crate::check::aot) fn compute_object_origin(&mut self, ty: TypeId) -> ObjectOrigin {
        let ty = self.declared_type_of_this(ty);
        let data = self.c.data(ty);
        if let TypeData::Ref { target, .. } = data {
            return ObjectOrigin::Symbol(self.files().canonical(*target));
        }
        if let Some(alias) = self.c.alias_symbol_of_type(ty)
            && is_top_level_alias(self, alias)
        {
            return ObjectOrigin::Symbol(alias);
        }
        let TypeData::Anon { origin, .. } = data else {
            return ObjectOrigin::Computed;
        };
        match *origin {
            Origin::TypeLiteral(file, node) => ObjectOrigin::TypeLiteral { file, node },
            Origin::Mapped(file, node) => ObjectOrigin::MappedType { file, node },
            Origin::ObjectLiteral(file, expression, ..)
            | Origin::WidenedLiteral(file, expression, ..) => {
                ObjectOrigin::ObjectLiteral { file, expression }
            }
            Origin::ClassStatic(symbol)
            | Origin::Function(symbol)
            | Origin::EnumObject(symbol)
            | Origin::Module(symbol)
            | Origin::Namespace { module: symbol, .. } => ObjectOrigin::Symbol(symbol),
            Origin::GlobalThis => ObjectOrigin::Computed,
        }
    }
}

fn is_top_level_scope(bound: &Bound<'_>, scope: ScopeId) -> bool {
    let mut scope = scope;
    while let Some(enclosing) = bound.scopes.get(scope.idx()) {
        match enclosing.kind {
            ScopeKind::File => return true,
            ScopeKind::Module(_) => scope = enclosing.parent,
            _ => return false,
        }
    }
    false
}

fn is_top_level_alias(queries: &Queries<'_, '_, '_>, alias: Sym) -> bool {
    let declarations = queries.files().decls_of(alias);
    !declarations.is_empty()
        && declarations.iter().all(|&(file, decl)| {
            let (hir, bound) = (queries.c.hir(file), queries.c.bound(file));
            is_top_level_scope(bound, bound.scope_of_declaration(hir, decl))
        })
}

#[derive(Copy, Clone)]
enum Visit {
    Pending { index: usize },
    Described(Key),
}

#[derive(Default)]
struct Walk {
    visits: FxHashMap<TypeId, Visit>,
    pending: Vec<TypeId>,
    lowest_reference: Option<usize>,
    is_refining: bool,
}

fn lower_reference(left: Option<usize>, right: Option<usize>) -> Option<usize> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (reference, None) | (None, reference) => reference,
    }
}

fn unknown_part(reason: GaveUp) -> Result<Option<Key>, GaveUp> {
    match reason.is_function_of_key() {
        true => Ok(None),
        false => Err(reason),
    }
}

impl Walk {
    fn describe(&mut self, queries: &mut Queries<'_, '_, '_>, ty: TypeId) -> Result<Key, GaveUp> {
        if queries.c.is_stack_low() {
            return Err(GaveUp::Unresolved);
        }
        let ty = queries.declared_type_of_this(ty);
        match self.visits.get(&ty) {
            Some(&Visit::Pending { index }) => {
                self.lowest_reference = lower_reference(self.lowest_reference, Some(index));
                Ok(leaf(Tag::BackReference))
            }
            Some(&Visit::Described(key)) => Ok(key),
            None => match queries.find_known_identity(ty) {
                Some(TypeIdentity(key)) => Ok(key),
                None => self.describe_unvisited(queries, ty),
            },
        }
    }

    fn describe_unvisited(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
    ) -> Result<Key, GaveUp> {
        let index = self.pending.len();
        let unstable_answers = queries.count_unstable_answers();
        let enclosing_reference = self.lowest_reference.take();
        self.visits.insert(ty, Visit::Pending { index });
        self.pending.push(ty);
        let described = self.describe_shape(queries, ty);
        let lowest_reference = std::mem::replace(&mut self.lowest_reference, enclosing_reference);
        match (described, lowest_reference) {
            (Ok(key), None) => {
                self.pending.truncate(index);
                self.visits.insert(ty, Visit::Described(key));
                if !self.is_refining {
                    queries.remember_identity(ty, TypeIdentity(key), unstable_answers);
                }
                Ok(key)
            }
            (Ok(_), Some(lowest)) if lowest == index => {
                self.describe_component(queries, index, unstable_answers)
            }
            (Ok(key), Some(_)) => {
                self.lowest_reference = lower_reference(enclosing_reference, lowest_reference);
                Ok(key)
            }
            (Err(reason), _) => {
                for member in self.pending.drain(index..) {
                    self.visits.remove(&member);
                }
                Err(reason)
            }
        }
    }

    fn describe_component(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        first: usize,
        unstable_answers: u64,
    ) -> Result<Key, GaveUp> {
        let members = self.pending.split_off(first);
        let was_refining = std::mem::replace(&mut self.is_refining, true);
        let refined = self.refine_component(queries, &members);
        self.is_refining = was_refining;
        match refined {
            Ok(keys) => {
                for (&member, &key) in members.iter().zip(&keys) {
                    self.visits.insert(member, Visit::Described(key));
                    if !self.is_refining {
                        queries.remember_identity(member, TypeIdentity(key), unstable_answers);
                    }
                }
                Ok(keys[0])
            }
            Err(reason) => {
                for member in &members {
                    self.visits.remove(member);
                }
                Err(reason)
            }
        }
    }

    fn refine_component(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        members: &[TypeId],
    ) -> Result<Vec<Key>, GaveUp> {
        let mut keys = vec![leaf(Tag::BackReference); members.len()];
        let mut classes = vec![leaf(Tag::BackReference)];
        loop {
            for (&member, &key) in members.iter().zip(&keys) {
                self.visits.insert(member, Visit::Described(key));
            }
            for (&member, key) in members.iter().zip(&mut keys) {
                *key = self.describe_shape(queries, member)?;
            }
            let class_count = classes.len();
            classes.clone_from(&keys);
            classes.sort_unstable();
            classes.dedup();
            if classes.len() == class_count {
                break;
            }
        }
        let mut component = Description::new(Tag::Cyclic);
        component.keys(&classes);
        let component = component.finish();
        for key in &mut keys {
            let mut description = Description::new(Tag::Cyclic);
            description.key(*key);
            description.key(component);
            *key = description.finish();
        }
        Ok(keys)
    }

    fn describe_shape(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
    ) -> Result<Key, GaveUp> {
        let shape = queries.type_shape(ty)?;
        let key = self.describe_kind(queries, ty, shape.kind)?;
        match shape.trust {
            Trust::Trusted => Ok(key),
            Trust::Untrusted => {
                let mut description = Description::new(Tag::Untrusted);
                description.key(key);
                Ok(description.finish())
            }
        }
    }

    fn describe_kind(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
        kind: ShapeKind<'_>,
    ) -> Result<Key, GaveUp> {
        match kind {
            ShapeKind::Anything(reason) => Ok(leaf_word(Tag::Anything, reason as u64)),
            ShapeKind::TypeVariable { constraint, .. } => {
                self.describe_type_variable(queries, ty, constraint)
            }
            ShapeKind::Never => Ok(leaf(Tag::Never)),
            ShapeKind::Undefined => Ok(leaf(Tag::Undefined)),
            ShapeKind::Null => Ok(leaf(Tag::Null)),
            ShapeKind::Boolean => Ok(leaf(Tag::Boolean)),
            ShapeKind::BooleanLiteral(value) => Ok(leaf_word(Tag::BooleanLiteral, value as u64)),
            ShapeKind::Number => Ok(leaf(Tag::Number)),
            ShapeKind::NumberLiteral(value) => Ok(leaf_word(Tag::NumberLiteral, value.to_bits())),
            ShapeKind::NumericEnumMember(value) => {
                Ok(leaf_word(Tag::NumericEnumMember, value.to_bits()))
            }
            ShapeKind::BigInt => Ok(leaf(Tag::BigInt)),
            ShapeKind::BigIntLiteral {
                digits,
                is_negative,
            } => {
                let mut description = Description::new(Tag::BigIntLiteral);
                description.word(is_negative as u64);
                description.bytes(queries.atom_bytes(digits));
                Ok(description.finish())
            }
            ShapeKind::String => Ok(leaf(Tag::String)),
            ShapeKind::StringLiteral(atom) => {
                Ok(leaf_bytes(Tag::StringLiteral, queries.atom_bytes(atom)))
            }
            ShapeKind::TemplateLiteral { texts, types } => {
                let mut description = Description::new(Tag::TemplateLiteral);
                description.word(texts.len() as u64);
                for &text in texts {
                    description.bytes(queries.atom_bytes(text));
                }
                self.describe_list(queries, &mut description, types)?;
                Ok(description.finish())
            }
            ShapeKind::Symbol => Ok(leaf(Tag::Symbol)),
            ShapeKind::AnyObject => Ok(leaf(Tag::AnyObject)),
            ShapeKind::Function(signatures) => {
                let declaration = match signatures {
                    &[signature] => queries.signature_declaration(signature),
                    overloads => queries.first_overload(overloads),
                };
                let mut description = Description::new(Tag::Function);
                description.word(u64::from(declaration.is_some()));
                if let Some(declaration) = declaration {
                    description.file(queries, declaration.file);
                    description.word(u64::from(declaration.function.0));
                }
                Ok(description.finish())
            }
            ShapeKind::ClassConstructor(class) => {
                Ok(class_description(queries, Tag::ClassConstructor, class).finish())
            }
            ShapeKind::Array { element, .. } => {
                let mut description = Description::new(Tag::Array);
                description.written(self.describe_part(queries, element)?);
                Ok(description.finish())
            }
            ShapeKind::Tuple { elements, .. } => self.describe_tuple(queries, elements),
            ShapeKind::Builtin { class, arguments } => {
                self.describe_builtin(queries, class, arguments)
            }
            ShapeKind::Class(class) => {
                let mut description = class_description(queries, Tag::Class, class);
                description.word(u64::from(queries.accepted_primitives(ty)?.bits()));
                Ok(description.finish())
            }
            ShapeKind::Object => self.describe_object(queries, ty),
            ShapeKind::Union(members) => self.describe_union(queries, members),
            ShapeKind::Int32 { base } => {
                let mut description = Description::new(Tag::Int32);
                description.written(self.describe_part(queries, base)?);
                Ok(description.finish())
            }
        }
    }

    fn describe_list(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        description: &mut Description,
        types: &[TypeId],
    ) -> Result<(), GaveUp> {
        description.word(types.len() as u64);
        for &ty in types {
            description.written(self.describe_part(queries, ty)?);
        }
        Ok(())
    }

    fn describe_part(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
    ) -> Result<Option<Key>, GaveUp> {
        match self.describe(queries, ty) {
            Ok(key) => Ok(Some(key)),
            Err(reason) => unknown_part(reason),
        }
    }

    fn describe_written(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        written: WrittenType,
    ) -> Result<Option<Key>, GaveUp> {
        match written {
            WrittenType::Written(ty) => self.describe_part(queries, ty),
            WrittenType::Unwritten => Ok(None),
            WrittenType::GaveUp(reason) => unknown_part(reason),
        }
    }

    fn describe_type_variable(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
        constraint: Option<TypeId>,
    ) -> Result<Key, GaveUp> {
        let mut description = Description::new(Tag::TypeVariable);
        if let TypeData::TypeParam(file, parameter, _) = *queries.c.data(ty) {
            description.word(1);
            description.file(queries, file);
            description.word(u64::from(parameter.0));
        } else {
            description.word(0);
        }
        description.written(match constraint {
            Some(constraint) => self.describe_part(queries, constraint)?,
            None => None,
        });
        Ok(description.finish())
    }

    fn describe_tuple(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        elements: &[TupleElement],
    ) -> Result<Key, GaveUp> {
        let mut description = Description::new(Tag::Tuple);
        description.word(elements.len() as u64);
        for element in elements {
            description.word(element.kind as u64);
            description.written(self.describe_part(queries, element.ty)?);
        }
        Ok(description.finish())
    }

    fn describe_builtin(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        class: BuiltinTypeClass,
        arguments: &[TypeId],
    ) -> Result<Key, GaveUp> {
        let mut description = Description::new(Tag::Builtin);
        description.word(u64::from(class.class.0));
        description.word(u64::from(class.type_name));
        self.describe_list(queries, &mut description, arguments)?;
        Ok(description.finish())
    }

    fn describe_union(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        members: &[TypeId],
    ) -> Result<Key, GaveUp> {
        let mut keys = Vec::with_capacity(members.len());
        for &member in members {
            keys.push(self.describe_part(queries, member)?);
        }
        keys.sort_unstable();
        keys.dedup();
        let mut description = Description::new(Tag::Union);
        description.word(keys.len() as u64);
        for key in keys {
            description.written(key);
        }
        Ok(description.finish())
    }

    fn describe_object(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
    ) -> Result<Key, GaveUp> {
        match queries.compute_object_origin(ty) {
            ObjectOrigin::Symbol(symbol) => self.describe_named(queries, ty, symbol),
            ObjectOrigin::TypeLiteral { file, node } => {
                self.describe_type_node(queries, Tag::TypeLiteral, (file, node), ty)
            }
            ObjectOrigin::MappedType { file, node } => {
                self.describe_type_node(queries, Tag::MappedType, (file, node), ty)
            }
            ObjectOrigin::ObjectLiteral { file, expression } => {
                let mut description = Description::new(Tag::ObjectLiteral);
                description.file(queries, file);
                description.word(u64::from(expression.0));
                self.describe_mapping(queries, &mut description, ty)?;
                Ok(description.finish())
            }
            ObjectOrigin::Computed => {
                let TypeData::Intersection(parts) = queries.c.data(ty) else {
                    return self.describe_structure(queries, ty);
                };
                let mut description = Description::new(Tag::Intersection);
                self.describe_list(queries, &mut description, parts)?;
                Ok(description.finish())
            }
        }
    }

    fn describe_named(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
        symbol: Sym,
    ) -> Result<Key, GaveUp> {
        let mut description = Description::new(Tag::NamedObject);
        description.symbol(queries, symbol);
        if let TypeData::Ref { .. } = queries.c.data(ty) {
            let arguments = queries.c.type_arguments(ty);
            self.describe_list(queries, &mut description, arguments)?;
        } else {
            let alias = queries.c.alias_of_type(ty);
            let arguments = alias.map(|(_, arguments)| arguments).unwrap_or_default();
            self.describe_list(queries, &mut description, &arguments)?;
        }
        Ok(description.finish())
    }

    fn describe_type_node(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        tag: Tag,
        (file, node): (FileId, TypeNodeId),
        ty: TypeId,
    ) -> Result<Key, GaveUp> {
        let mut description = Description::new(tag);
        description.file(queries, file);
        description.word(u64::from(node.0));
        self.describe_mapping(queries, &mut description, ty)?;
        Ok(description.finish())
    }

    fn describe_mapping(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        description: &mut Description,
        ty: TypeId,
    ) -> Result<(), GaveUp> {
        let TypeData::Anon { mapper, .. } = *queries.c.data(ty) else {
            description.word(0);
            return Ok(());
        };
        let mapping = queries.c.types().mapping(mapper);
        let mut pairs = Vec::with_capacity(mapping.len());
        for &(source, target) in mapping {
            let source = self.describe_part(queries, source)?;
            pairs.push((source, self.describe_part(queries, target)?));
        }
        pairs.sort_unstable();
        description.word(pairs.len() as u64);
        for (source, target) in pairs {
            description.written(source);
            description.written(target);
        }
        Ok(())
    }

    fn describe_structure(
        &mut self,
        queries: &mut Queries<'_, '_, '_>,
        ty: TypeId,
    ) -> Result<Key, GaveUp> {
        let members = queries.object_members(ty)?;
        let signatures = queries.index_signatures(ty)?;
        let accepted_primitives = queries.accepted_primitives(ty)?;
        let mut description = Description::new(Tag::Object);
        description.word(u64::from(accepted_primitives.bits()));
        description.word(members.len() as u64);
        let mut described = Vec::with_capacity(members.len());
        for member in members {
            let name = member_name_key(queries, member.name);
            let written = self.describe_written(queries, member.types.written)?;
            described.push((name, member.kind, member.is_optional, written));
        }
        described.sort_by_key(|&(name, ..)| name);
        for (name, kind, is_optional, written) in described {
            description.member(name, kind, is_optional, written);
        }
        let mut index_keys = Vec::with_capacity(signatures.len());
        for signature in signatures {
            let written = self.describe_written(queries, signature.types.written)?;
            index_keys.push((signature.key as u8, written));
        }
        index_keys.sort_unstable();
        description.word(index_keys.len() as u64);
        for (key, written) in index_keys {
            description.word(u64::from(key));
            description.written(written);
        }
        Ok(description.finish())
    }
}

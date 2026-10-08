//! What is asked of a type.

use super::super::flow::facts;
use super::super::print;
use super::*;

impl<'c, 'p, 's> Services<'c, 'p, 's> {
    #[inline]
    pub fn type_flags(&mut self, ty: TypeId) -> TypeFlags {
        TypeFlags::from_bits_truncate(self.c.flags(ty))
    }

    /// `type.objectFlags`, derived from what the type is made of.
    pub fn object_flags(&mut self, ty: TypeId) -> ObjectFlags {
        let mut flags = ObjectFlags::empty();
        match *self.c.data(ty) {
            TypeData::Ref { target, .. } => {
                let of_target = self.c.files().flags(target);
                if self.c.has_this_type(target) {
                    flags |= ObjectFlags::REFERENCE;
                }
                if self.c.declared_type(target) == ty {
                    if of_target.contains(SymFlags::CLASS) {
                        flags |= ObjectFlags::CLASS;
                    } else if of_target.contains(SymFlags::INTERFACE) {
                        flags |= ObjectFlags::INTERFACE;
                    }
                }
                if self.c.types().is_array_literal(ty) {
                    flags |= ObjectFlags::ARRAY_LITERAL;
                }
            }
            TypeData::Tuple { .. } => {
                flags |= ObjectFlags::REFERENCE | ObjectFlags::TUPLE;
                if self.c.types().is_array_literal(ty) {
                    flags |= ObjectFlags::ARRAY_LITERAL;
                }
            }
            TypeData::Anon { origin, mapper } => {
                flags |= match origin {
                    Origin::Mapped(..) => ObjectFlags::MAPPED,
                    _ => ObjectFlags::ANONYMOUS,
                };
                if self.c.is_instantiating(mapper) {
                    flags |= ObjectFlags::INSTANTIATED;
                }
                if let Origin::ObjectLiteral(_, _, true, ..) | Origin::WidenedLiteral(_, _, true, ..) = origin {
                    flags |= ObjectFlags::JS_LITERAL;
                }
            }
            TypeData::Fns { mapper, .. } => {
                flags |= ObjectFlags::ANONYMOUS;
                if self.c.is_instantiating(mapper) {
                    flags |= ObjectFlags::INSTANTIATED;
                }
            }
            TypeData::Synth(ref shape) => {
                flags |= ObjectFlags::ANONYMOUS;
                if shape.instantiation_expression.is_some() {
                    flags |= ObjectFlags::INSTANTIATION_EXPRESSION_TYPE;
                }
                if shape.is_object_rest_type {
                    flags |= ObjectFlags::OBJECT_REST_TYPE;
                }
                if shape.is_js_literal {
                    flags |= ObjectFlags::JS_LITERAL;
                }
                if shape.single_signature_arguments.is_some() {
                    flags |= ObjectFlags::SINGLE_SIGNATURE_TYPE;
                }
                if self.c.is_instantiating(shape.mapper) {
                    flags |= ObjectFlags::INSTANTIATED;
                }
            }
            TypeData::ReverseMapped { .. } => flags |= ObjectFlags::ANONYMOUS | ObjectFlags::REVERSE_MAPPED,
            TypeData::EvolvingArray(_) => flags |= ObjectFlags::EVOLVING_ARRAY,
            _ => return flags,
        }
        if self.c.is_object_literal_type(ty) {
            flags |= ObjectFlags::OBJECT_LITERAL;
        }
        if self.c.is_fresh_object_literal_type(ty) {
            flags |= ObjectFlags::FRESH_LITERAL;
        }
        flags
    }

    /// `type.types`
    pub fn constituents(&mut self, ty: TypeId) -> &'p [TypeId] {
        match self.c.data(ty) {
            TypeData::Union(types) | TypeData::Intersection(types) => types,
            _ => &[],
        }
    }

    pub fn type_arguments(&mut self, ty: TypeId) -> &'p [TypeId] {
        match self.c.data(ty) {
            TypeData::Ref { .. } | TypeData::Tuple { .. } => self.c.type_arguments(ty),
            _ => &[],
        }
    }

    /// Whether what is stored as the alias of `ty` is the enum that it is the declared type of.
    fn is_enum_union(&self, ty: TypeId) -> bool {
        self.c.flags(ty) & (tf::UNION | tf::ENUM_LITERAL) == tf::UNION | tf::ENUM_LITERAL
    }

    /// `type.aliasSymbol`. That of the declared type of an enum with several members is the enum.
    pub fn alias_symbol(&mut self, ty: TypeId) -> Option<SymbolRef> {
        // `getUnresolvedSymbolForEntityName`
        if let TypeData::UnresolvedName { name, .. } = *self.c.data(ty) {
            let path = self.c.atoms().bytes(name);
            let last = bun_core::strings::last_index_of_char(path, b'.').map_or(path, |dot| &path[dot + 1..]);
            let last = self.c.atoms().intern(last);
            return Some(self.named_symbol(super::symbols::Key::Undeclared(name), last));
        }
        let alias = self.c.alias_symbol_of_type(ty)?;
        Some(self.symbol(alias))
    }

    pub fn alias_type_arguments(&mut self, ty: TypeId) -> &'c [TypeId] {
        if self.is_enum_union(ty) {
            return &[];
        }
        match self.c.alias_of_type(ty) {
            Some((_, arguments)) => self.list(&arguments),
            None => &[],
        }
    }

    pub fn literal_value(&mut self, ty: TypeId) -> Option<LiteralValue<'p>> {
        let atoms = self.c.atoms();
        Some(match *self.c.data(ty) {
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => LiteralValue::String(atoms.bytes(value)),
            TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } => LiteralValue::Number(f64::from_bits(bits)),
            TypeData::BigIntLit { text, negative, .. } => LiteralValue::BigInt {
                negative,
                base10: atoms.bytes(text),
            },
            _ => return None,
        })
    }

    pub fn intrinsic_name(&mut self, ty: TypeId) -> Option<&'static str> {
        Some(match *self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::Any | Intrinsic::Auto | Intrinsic::Wildcard | Intrinsic::NonInferrableAny => "any",
                Intrinsic::Error | Intrinsic::Unresolved => "error",
                Intrinsic::IntrinsicMarker => "intrinsic",
                Intrinsic::Unknown => "unknown",
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral => "never",
                Intrinsic::Void => "void",
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening => "undefined",
                Intrinsic::Null | Intrinsic::NullWidening => "null",
                Intrinsic::String => "string",
                Intrinsic::Number => "number",
                Intrinsic::BigInt => "bigint",
                Intrinsic::Symbol => "symbol",
                Intrinsic::Object => "object",
            },
            TypeData::UnresolvedName { .. } => "error",
            TypeData::BoolLit { value: true, .. } => "true",
            TypeData::BoolLit { value: false, .. } => "false",
            _ if self.c.flags(ty) & tf::BOOLEAN != 0 => "boolean",
            _ => return None,
        })
    }

    pub fn tuple_info(&mut self, ty: TypeId) -> Option<TupleInfo<'c>> {
        let TypeData::Tuple { flags, readonly, .. } = self.c.data(ty) else {
            return None;
        };
        let element_flags: SmallVec<[ElementFlags; 8]> =
            flags.iter().map(|it| ElementFlags::from_bits_truncate(it.bits() as u8 & 15)).collect();
        let is_variable = |it: &ElementFlags| it.intersects(ElementFlags::VARIABLE);
        let is_required = |it: &&ElementFlags| it.intersects(ElementFlags::REQUIRED | ElementFlags::VARIADIC);
        Some(TupleInfo {
            min_length: element_flags.iter().filter(is_required).count() as u32,
            fixed_length: element_flags.iter().position(is_variable).unwrap_or(element_flags.len()) as u32,
            combined_flags: element_flags.iter().fold(ElementFlags::empty(), |all, &it| all | it),
            readonly: *readonly,
            element_flags: self.list(&element_flags),
        })
    }

    pub fn structure(&mut self, ty: TypeId) -> Structure<'c> {
        match *self.c.data(ty) {
            TypeData::Cond { file, node, .. } => {
                let TypeNodeKind::Cond { check, yes, no, .. } = self.c.hir(file)[node].kind else {
                    return Structure::Other;
                };
                // `root.isDistributive`: the check type is written as a naked type parameter.
                let declared = self.c.type_from_node(file, check);
                Structure::Conditional {
                    is_distributive: self.c.flags(declared) & tf::TYPE_PARAMETER != 0,
                    check: self.c.cond_check(ty),
                    extends: self.c.cond_extends(ty),
                    root_true_type: self.c.type_from_node(file, yes),
                    root_false_type: self.c.type_from_node(file, no),
                }
            }
            TypeData::IndexedAccess { obj, index, .. } => Structure::IndexedAccess { object: obj, index },
            TypeData::Keyof(of) => Structure::Index { ty: of },
            TypeData::Anon {
                origin: Origin::Mapped(file, node),
                ..
            } => {
                let TypeNodeKind::Mapped(mapped) = self.c.hir(file)[node].kind else {
                    return Structure::Other;
                };
                let mapped = self.c.hir(file)[mapped];
                Structure::Mapped {
                    type_parameter: self.c.mapped_type_param(ty),
                    constraint: self.c.mapped_keys(ty),
                    name_type: self.c.mapped_name_type(ty),
                    template: self.c.mapped_template(ty),
                    readonly: mapped.readonly,
                    optional: mapped.optional,
                }
            }
            TypeData::Template { ref texts, ref types } => {
                let atoms = self.c.atoms();
                let texts: SmallVec<[&'c [u8]; 4]> = texts.iter().map(|&text| -> &'c [u8] { atoms.bytes(text) }).collect();
                Structure::TemplateLiteral {
                    texts: self.list(&texts),
                    types: self.list(types),
                }
            }
            TypeData::StringMapping { ty: of, .. } => Structure::StringMapping { ty: of },
            TypeData::Substitution { base, constraint } => Structure::Substitution { base, constraint },
            _ => Structure::Other,
        }
    }

    pub fn type_op(&mut self, op: TypeOp, ty: TypeId) -> Option<TypeId> {
        let c = &mut *self.c;
        Some(match op {
            TypeOp::Apparent => c.apparent_type(ty),
            TypeOp::BaseConstraint => return c.base_constraint_of(ty),
            TypeOp::ConstraintOfTypeParameter => {
                if c.flags(ty) & tf::TYPE_PARAMETER == 0 {
                    return None;
                }
                return c.constraint_of_type_param(ty);
            }
            TypeOp::DefaultOfTypeParameter => {
                if c.flags(ty) & tf::TYPE_PARAMETER == 0 {
                    return None;
                }
                return c.default_of_type_param(ty);
            }
            TypeOp::Awaited => return c.awaited_or_none(ty),
            TypeOp::PromisedTypeOfPromise => return c.thenable_value(ty),
            TypeOp::Widened => c.get_widened_type(ty),
            TypeOp::WidenedLiteral => c.widen_literal(ty),
            TypeOp::BaseTypeOfLiteral => c.base_of_literal(ty),
            TypeOp::Regular => c.regular(ty),
            TypeOp::Fresh => c.fresh(ty),
            TypeOp::NonNullable => c.non_nullable(ty),
            TypeOp::Reduced => c.reduced(ty),
            TypeOp::ReducedApparent => c.reduced_apparent_type(ty),
            TypeOp::Keyof => c.keyof(ty),
            TypeOp::RemoveDefinitelyFalsy => c.remove_definitely_falsy(ty),
            TypeOp::ExtractDefinitelyFalsy => c.definitely_falsy_part(ty),
            TypeOp::Target => match *c.data(ty) {
                TypeData::Ref { target, .. } => c.declared_type(target),
                TypeData::Tuple { .. } => ty,
                _ => return None,
            },
            TypeOp::ThisType => match *c.data(ty) {
                TypeData::Ref { target, .. } if c.has_this_type(target) => c.intern(TypeData::ThisParam(target)),
                _ => return None,
            },
            TypeOp::Iterated => return c.iterated_type_if_any(ty, false),
            TypeOp::AsyncIterated => return c.iterated_type_if_any(ty, true),
            TypeOp::NonOptional => c.remove_missing_type(ty, true),
            TypeOp::ModifiersTypeOfMapped => return c.mapped_modifiers_type(ty),
        })
    }

    pub fn type_test(&mut self, test: TypeTest, ty: TypeId) -> bool {
        let c = &mut *self.c;
        match test {
            TypeTest::Array => c.is_array(ty),
            TypeTest::ReadonlyArray => c.is_reference_to_global(ty, known::ReadonlyArray, 1),
            TypeTest::Tuple => c.is_tuple(ty),
            TypeTest::ArrayLike => c.is_array_like(ty),
            TypeTest::Error => c.is_error_type(ty),
            TypeTest::Unresolved => {
                ty == TypeId::UNRESOLVED || c.types().object_flags(ty).contains(crate::types::ObjectFlags::HAS_UNRESOLVED)
            }
            TypeTest::ThisTypeParameter => matches!(c.data(ty), TypeData::ThisParam(_)),
            TypeTest::FreshLiteral => c.is_fresh_literal(ty),
            TypeTest::Thenable => c.is_thenable(ty),
            TypeTest::ClassOrInterface => match *c.data(ty) {
                TypeData::Ref { target, .. } => c.declared_type(target) == ty,
                _ => false,
            },
            TypeTest::NonDeferredTypeReference => {
                matches!(c.data(ty), TypeData::Ref { .. } | TypeData::Tuple { .. }) && c.types().deferred(ty).is_none()
            }
            TypeTest::EmptyAnonymousObject => c.is_empty_anonymous_object_type(ty),
            TypeTest::Generic => c.is_generic_object_type(ty) || c.is_generic_index_type(ty),
        }
    }

    pub fn has_type_facts(&mut self, ty: TypeId, asked: TypeFacts) -> bool {
        const FACTS: [(TypeFacts, u32); 5] = [
            (TypeFacts::TRUTHY, facts::TRUTHY),
            (TypeFacts::FALSY, facts::FALSY),
            (TypeFacts::EQ_UNDEFINED_OR_NULL, facts::EQ_UNDEFINED_OR_NULL),
            (TypeFacts::IS_UNDEFINED, facts::IS_UNDEFINED),
            (TypeFacts::IS_NULL, facts::IS_NULL),
        ];
        let mask = FACTS.iter().filter(|it| asked.contains(it.0)).fold(0, |all, it| all | it.1);
        self.c.has_type_facts(ty, mask)
    }

    pub fn is_related(&mut self, relation: Relation, source: TypeId, target: TypeId) -> bool {
        match relation {
            Relation::Assignable => self.c.is_assignable(source, target),
            Relation::Identical => self.c.is_identical(source, target),
            Relation::Subtype => self.c.is_subtype(source, target),
            Relation::StrictSubtype => self.c.is_strict_subtype(source, target),
            Relation::Comparable => self.c.is_comparable(source, target),
            Relation::SameTupleTarget => match (self.c.data(source), self.c.data(target)) {
                (
                    TypeData::Tuple { flags: a, readonly: a_is_readonly, .. },
                    TypeData::Tuple { flags: b, readonly: b_is_readonly, .. },
                ) => a_is_readonly == b_is_readonly && a[..] == b[..],
                _ => false,
            },
        }
    }

    /// `getBaseTypes`, which is defined for the declared type of a class or an interface.
    pub fn base_types(&mut self, ty: TypeId) -> &'c [TypeId] {
        let TypeData::Ref { target, .. } = *self.c.data(ty) else {
            return &[];
        };
        if self.c.declared_type(target) != ty {
            return &[];
        }
        let bases = self.c.base_types(target);
        self.list(&bases)
    }

    pub fn index_infos_of_type(&mut self, ty: TypeId) -> &'c [IndexInfoData] {
        let Some(members) = self.c.members_for_index_infos(ty) else {
            return &[];
        };
        let mut infos: SmallVec<[IndexInfoData; 2]> = SmallVec::new();
        for info in &members.shape().index {
            let value = self.c.instantiate(info.value, members.mapper);
            infos.push(self.index_info(IndexInfo { value, ..*info }));
        }
        self.list(&infos)
    }

    fn index_info(&self, info: IndexInfo) -> IndexInfoData {
        IndexInfoData {
            key_type: info.key,
            ty: info.value,
            is_readonly: info.readonly,
            declaration: info.declaration.map(|(file, member)| NodeRef {
                file,
                node: self.c.hir(file).node(member),
            }),
        }
    }

    pub fn applicable_index_info(&mut self, ty: TypeId, key: TypeId) -> Option<IndexInfoData> {
        let members = self.c.members_for_index_infos(ty)?;
        let info = self.c.applicable_index_info(&members, key)?;
        Some(self.index_info(info))
    }

    pub fn signatures_of_type(&mut self, ty: TypeId, kind: SignatureKind) -> &'c [SigId] {
        let signatures = self.c.signatures(ty, kind == SignatureKind::Construct);
        self.list(&signatures)
    }

    pub fn union_type(&mut self, types: &[TypeId], reduction: UnionReduction) -> TypeId {
        match reduction {
            UnionReduction::None => self.c.union_unreduced(types),
            UnionReduction::Literal => self.c.union(types),
            UnionReduction::Subtype => self.c.union_reduced(types),
        }
    }

    pub fn intersection_type(&mut self, types: &[TypeId]) -> TypeId {
        self.c.intersection(types)
    }

    pub fn indexed_access_type(&mut self, object: TypeId, index: TypeId, in_expression: bool) -> Option<TypeId> {
        let flags = match in_expression {
            true => AccessFlags::EXPRESSION_POSITION,
            false => AccessFlags::empty(),
        };
        self.c.indexed_access_with_flags(object, index, flags)
    }

    pub fn assignment_reduced_type(&mut self, declared: TypeId, assigned: TypeId) -> TypeId {
        self.c.assignment_reduced_type(declared, assigned)
    }

    pub fn global_type(&mut self, name: &[u8], arity: u32) -> Option<TypeId> {
        let name = self.c.atoms().lookup(name)?;
        let symbol = match self.c.global_type_of_arity(name, arity as usize) {
            Some(symbol) => symbol,
            None => self.c.global_type_symbol(name)?,
        };
        Some(self.c.declared_type(symbol))
    }

    pub fn string_literal_type(&mut self, value: &[u8]) -> TypeId {
        let value = self.c.atoms().intern(value);
        self.c.string_literal(value, false)
    }

    pub fn number_literal_type(&mut self, value: f64) -> TypeId {
        self.c.number_literal(value, false)
    }

    pub fn compare_types(&mut self, a: TypeId, b: TypeId) -> Option<std::cmp::Ordering> {
        Some(self.c.compare_types(a, b))
    }

    pub fn type_to_string(&mut self, ty: TypeId, enclosing: Option<NodeRef>, flags: TypeFormatFlags) -> Vec<u8> {
        const FLAGS: [(TypeFormatFlags, u32); 10] = [
            (TypeFormatFlags::NO_TRUNCATION, print::NO_TRUNCATION),
            (TypeFormatFlags::WRITE_ARRAY_AS_GENERIC_TYPE, print::WRITE_ARRAY_AS_GENERIC_TYPE),
            (TypeFormatFlags::USE_STRUCTURAL_FALLBACK, print::USE_STRUCTURAL_FALLBACK),
            (TypeFormatFlags::USE_FULLY_QUALIFIED_TYPE, print::USE_FULLY_QUALIFIED_TYPE),
            (TypeFormatFlags::MULTILINE_OBJECT_LITERALS, print::MULTILINE_OBJECT_LITERALS),
            (TypeFormatFlags::WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL, print::WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL),
            (TypeFormatFlags::USE_TYPE_OF_FUNCTION, print::USE_TYPE_OF_FUNCTION),
            (TypeFormatFlags::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE, print::USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE),
            (TypeFormatFlags::NO_TYPE_REDUCTION, print::NO_TYPE_REDUCTION),
            (TypeFormatFlags::ALLOW_UNIQUE_ES_SYMBOL_TYPE, print::ALLOW_UNIQUE_ES_SYMBOL_TYPE),
        ];
        let flags = FLAGS.iter().filter(|it| flags.contains(it.0)).fold(0, |all, it| all | it.1);
        let enclosing = enclosing.and_then(|node| {
            let scope = self.scope_at(node)?;
            let at = super::super::enclosing_declaration::Enclosing::at_scope(node.file, scope);
            Some((at, self.expr_of(node).unwrap_or(ExprId::NONE)))
        });
        print::to_valid_utf8(print::type_to_string_with(self.c, ty, enclosing, flags))
    }
}

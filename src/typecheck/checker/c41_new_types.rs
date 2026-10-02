// checker.go:25126-25394 (layer K-OBJ): newType and the constructors of the types, type references, signatures and index infos of a checker, with setStructuredTypeMembers and getPropagatingFlagsOfTypes. The id of a type or of a signature is its place in the store of the checker, and the tracer call of newType is not ported.
use crate::ast::{NodeId, SymbolId, SymbolTableId};
use crate::checker::{
    AccessFlags, Checker, ConditionalRootId, ConditionalType, IndexFlags, IndexInfo, IndexInfoId,
    IndexType, IndexedAccessType, IntersectionType, IntrinsicType, LiteralType, LiteralValue,
    ObjectFlags, Signature, SignatureFlags, SignatureId, StringMappingType, SubstitutionType,
    TemplateLiteralType, Type, TypeAliasId, TypeData, TypeFlags, TypeId, TypeMapperId,
    TypePredicateId, UnionType, UniqueESSymbolType, get_type_list_key,
};
use crate::core::{List, Text};
use crate::internal::FaultKind;

impl<'a> Checker<'a> {
    pub fn new_type(
        &mut self,
        flags: TypeFlags,
        object_flags: ObjectFlags,
        data: TypeData<'a>,
    ) -> TypeId {
        self.type_count = self.type_count.wrapping_add(1);
        let t = self.types.alloc(Type {
            flags,
            object_flags: object_flags.without(
                ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED
                    | ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
                    | ObjectFlags::MEMBERS_RESOLVED,
            ),
            data,
            ..Type::default()
        });
        // `t.id = TypeId(c.TypeCount)`: the id of a type is its place in the store, nil once the id space is used up.
        if t.0 != self.type_count {
            self.ast
                .fault(FaultKind::IdSpaceExhausted, "newType", 0, self.type_count);
        }
        t
    }

    pub fn new_intrinsic_type(&mut self, flags: TypeFlags, intrinsic_name: Text<'a>) -> TypeId {
        self.new_intrinsic_type_ex(flags, intrinsic_name, ObjectFlags::NONE)
    }

    pub fn new_intrinsic_type_ex(
        &mut self,
        flags: TypeFlags,
        intrinsic_name: Text<'a>,
        object_flags: ObjectFlags,
    ) -> TypeId {
        let data = IntrinsicType { intrinsic_name };
        self.new_type(flags, object_flags, TypeData::Intrinsic(data))
    }

    pub fn create_widening_type(&mut self, non_widening_type: TypeId) -> TypeId {
        if self.strict_null_checks {
            return non_widening_type;
        }
        let flags = self.types[non_widening_type].flags;
        let intrinsic_name = self.as_intrinsic_type(non_widening_type).intrinsic_name;
        let t = self.new_intrinsic_type(flags, intrinsic_name);
        self.types[t].object_flags |= ObjectFlags::CONTAINS_WIDENING_TYPE;
        t
    }

    pub fn create_unknown_union_type(&mut self) -> TypeId {
        if self.strict_null_checks {
            let types = [
                self.undefined_type,
                self.null_type,
                self.unknown_empty_object_type,
            ];
            return self.get_union_type(List::from_slice(&types));
        }
        self.unknown_type
    }

    pub fn new_literal_type(
        &mut self,
        flags: TypeFlags,
        value: LiteralValue<'a>,
        regular_type: TypeId,
    ) -> TypeId {
        let data = LiteralType {
            value,
            ..LiteralType::default()
        };
        let t = self.new_type(flags, ObjectFlags::NONE, TypeData::Literal(data));
        if !regular_type.is_nil() {
            self.as_literal_type_mut(t).regular_type = regular_type;
        } else {
            self.as_literal_type_mut(t).regular_type = t;
        }
        t
    }

    pub fn new_unique_es_symbol_type(&mut self, symbol: SymbolId, name: Text<'a>) -> TypeId {
        let data = UniqueESSymbolType { name };
        let t = self.new_type(
            TypeFlags::UNIQUE_ES_SYMBOL,
            ObjectFlags::NONE,
            TypeData::UniqueESSymbol(data),
        );
        self.types[t].symbol = symbol;
        t
    }

    pub fn new_object_type(&mut self, object_flags: ObjectFlags, symbol: SymbolId) -> TypeId {
        let data = if object_flags.intersects(ObjectFlags::CLASS_OR_INTERFACE) {
            TypeData::Interface(Box::default())
        } else if object_flags.intersects(ObjectFlags::TUPLE) {
            TypeData::Tuple(Box::default())
        } else if object_flags.intersects(ObjectFlags::REFERENCE) {
            TypeData::TypeReference(Box::default())
        } else if object_flags.intersects(ObjectFlags::MAPPED) {
            TypeData::Mapped(Box::default())
        } else if object_flags.intersects(ObjectFlags::REVERSE_MAPPED) {
            TypeData::ReverseMapped(Box::default())
        } else if object_flags.intersects(ObjectFlags::EVOLVING_ARRAY) {
            TypeData::EvolvingArray(Box::default())
        } else if object_flags.intersects(ObjectFlags::INSTANTIATION_EXPRESSION_TYPE) {
            TypeData::InstantiationExpression(Box::default())
        } else if object_flags.intersects(ObjectFlags::ANONYMOUS) {
            TypeData::Object(Box::default())
        } else {
            return self.fail("Unhandled case in newObjectType");
        };
        let t = self.new_type(TypeFlags::OBJECT, object_flags, data);
        self.types[t].symbol = symbol;
        t
    }

    pub fn new_anonymous_type(
        &mut self,
        symbol: SymbolId,
        members: SymbolTableId,
        call_signatures: List<'a, SignatureId>,
        construct_signatures: List<'a, SignatureId>,
        index_infos: List<'a, IndexInfoId>,
    ) -> TypeId {
        let t = self.new_object_type(ObjectFlags::ANONYMOUS, symbol);
        self.set_structured_type_members(
            t,
            members,
            call_signatures,
            construct_signatures,
            index_infos,
        );
        t
    }

    pub fn try_create_type_reference(
        &mut self,
        target: TypeId,
        type_arguments: List<'a, TypeId>,
    ) -> TypeId {
        if type_arguments.len() != 0 && target == self.empty_generic_type {
            return self.unknown_type;
        }
        self.create_type_reference(target, type_arguments)
    }

    pub fn create_type_reference(
        &mut self,
        target: TypeId,
        type_arguments: List<'a, TypeId>,
    ) -> TypeId {
        self.create_type_reference_ex(target, type_arguments, ObjectFlags::NONE)
    }

    pub fn create_type_reference_ex(
        &mut self,
        target: TypeId,
        type_arguments: List<'a, TypeId>,
        object_flags: ObjectFlags,
    ) -> TypeId {
        let id = get_type_list_key(type_arguments);
        if let Some(t) = self.as_interface_type(target).instantiations.get_ok(&id) {
            return t;
        }
        let propagating_flags =
            self.get_propagating_flags_of_types(type_arguments, TypeFlags::NONE);
        let symbol = self.types[target].symbol;
        let t = self.new_object_type(
            ObjectFlags::REFERENCE | object_flags | propagating_flags,
            symbol,
        );
        let d = self.as_type_reference_mut(t);
        d.target = target;
        d.resolved_type_arguments = type_arguments;
        let ok = self.as_interface_type_mut(target).instantiations.set(id, t);
        self.map_set(ok);
        t
    }

    pub fn create_deferred_type_reference(
        &mut self,
        target: TypeId,
        node: NodeId,
        mapper: TypeMapperId,
        mut alias: TypeAliasId,
    ) -> TypeId {
        if alias.is_nil() {
            alias = self.get_alias_for_type_node(node);
            if !alias.is_nil() && !mapper.is_nil() {
                let type_arguments = self.type_aliases[alias].type_arguments;
                let type_arguments = self.instantiate_types(type_arguments, mapper);
                self.type_aliases[alias].type_arguments = type_arguments;
            }
        }
        let symbol = self.types[target].symbol;
        let t = self.new_object_type(ObjectFlags::REFERENCE, symbol);
        self.types[t].alias = alias;
        let d = self.as_type_reference_mut(t);
        d.target = target;
        d.mapper = mapper;
        d.node = node;
        t
    }

    pub fn clone_type_reference(&mut self, source: TypeId) -> TypeId {
        let symbol = self.types[source].symbol;
        let t = self.new_object_type(ObjectFlags::REFERENCE, symbol);
        let object_flags = self.types[source]
            .object_flags
            .without(ObjectFlags::MEMBERS_RESOLVED);
        self.types[t].object_flags = object_flags;
        let target = self.as_type_reference(source).target;
        self.as_type_reference_mut(t).target = target;
        let resolved_type_arguments = self.as_type_reference(source).resolved_type_arguments;
        self.as_type_reference_mut(t).resolved_type_arguments = resolved_type_arguments;
        t
    }

    pub fn set_structured_type_members(
        &mut self,
        t: TypeId,
        members: SymbolTableId,
        call_signatures: List<'a, SignatureId>,
        construct_signatures: List<'a, SignatureId>,
        index_infos: List<'a, IndexInfoId>,
    ) {
        self.types[t].object_flags |= ObjectFlags::MEMBERS_RESOLVED;
        self.as_structured_type_mut(t).members = members;
        let symbol = self.types[t].symbol;
        let properties = self.get_named_members(members, symbol);
        // slices.Clip cuts the spare capacity of a slice: a list has none, and nil stays nil.
        let (signatures, call_signature_count) = if call_signatures.len() != 0 {
            let signatures = if construct_signatures.len() != 0 {
                self.concatenate(call_signatures, construct_signatures)
            } else {
                call_signatures
            };
            (signatures, call_signatures.len())
        } else if construct_signatures.len() != 0 {
            (construct_signatures, 0)
        } else {
            (List::NIL, 0)
        };
        let data = self.as_structured_type_mut(t);
        data.properties = properties;
        data.signatures = signatures;
        data.call_signature_count = call_signature_count;
        data.index_infos = index_infos;
    }

    pub fn new_type_parameter(&mut self, symbol: SymbolId) -> TypeId {
        let t = self.new_type(
            TypeFlags::TYPE_PARAMETER,
            ObjectFlags::NONE,
            TypeData::TypeParameter(Box::default()),
        );
        self.types[t].symbol = symbol;
        t
    }

    // This function is used to propagate certain flags when creating new object type references and union types. It is only necessary to do so if a constituent type might be the undefined type, the null type, the type of an object literal or a non-inferrable type. This is because there are operations in the type checker that care about the presence of such types at arbitrary depth in a containing type.
    pub fn get_propagating_flags_of_types(
        &self,
        types: List<'_, TypeId>,
        exclude_kinds: TypeFlags,
    ) -> ObjectFlags {
        let mut result = ObjectFlags::NONE;
        for t in types.iter() {
            if !self.types[t].flags.intersects(exclude_kinds) {
                result |= self.types[t].object_flags;
            }
        }
        result & ObjectFlags::PROPAGATING_FLAGS
    }

    pub fn new_union_type(&mut self, object_flags: ObjectFlags, types: List<'a, TypeId>) -> TypeId {
        let mut data = Box::<UnionType<'a>>::default();
        data.base.types = types;
        self.new_type(TypeFlags::UNION, object_flags, TypeData::Union(data))
    }

    pub fn new_intersection_type(
        &mut self,
        object_flags: ObjectFlags,
        types: List<'a, TypeId>,
    ) -> TypeId {
        let mut data = Box::<IntersectionType<'a>>::default();
        data.base.types = types;
        self.new_type(
            TypeFlags::INTERSECTION,
            object_flags,
            TypeData::Intersection(data),
        )
    }

    pub fn new_indexed_access_type(
        &mut self,
        object_type: TypeId,
        index_type: TypeId,
        access_flags: AccessFlags,
    ) -> TypeId {
        let data = IndexedAccessType {
            object_type,
            index_type,
            access_flags,
            ..IndexedAccessType::default()
        };
        self.new_type(
            TypeFlags::INDEXED_ACCESS,
            ObjectFlags::NONE,
            TypeData::IndexedAccess(data),
        )
    }

    pub fn new_index_type(&mut self, target: TypeId, index_flags: IndexFlags) -> TypeId {
        let data = IndexType {
            target,
            index_flags,
            ..IndexType::default()
        };
        self.new_type(TypeFlags::INDEX, ObjectFlags::NONE, TypeData::Index(data))
    }

    pub fn new_template_literal_type(
        &mut self,
        texts: List<'a, Text<'a>>,
        types: List<'a, TypeId>,
    ) -> TypeId {
        let data = Box::new(TemplateLiteralType {
            texts,
            types,
            ..TemplateLiteralType::default()
        });
        self.new_type(
            TypeFlags::TEMPLATE_LITERAL,
            ObjectFlags::NONE,
            TypeData::TemplateLiteral(data),
        )
    }

    pub fn new_string_mapping_type(&mut self, symbol: SymbolId, target: TypeId) -> TypeId {
        let data = StringMappingType {
            target,
            ..StringMappingType::default()
        };
        let t = self.new_type(
            TypeFlags::STRING_MAPPING,
            ObjectFlags::NONE,
            TypeData::StringMapping(data),
        );
        self.types[t].symbol = symbol;
        t
    }

    pub fn new_conditional_type(
        &mut self,
        root: ConditionalRootId,
        mapper: TypeMapperId,
        combined_mapper: TypeMapperId,
    ) -> TypeId {
        let root_check_type = self.conditional_roots[root].check_type;
        let check_type = self.instantiate_type(root_check_type, mapper);
        let root_extends_type = self.conditional_roots[root].extends_type;
        let extends_type = self.instantiate_type(root_extends_type, mapper);
        let data = Box::new(ConditionalType {
            root,
            check_type,
            extends_type,
            mapper,
            combined_mapper,
            ..ConditionalType::default()
        });
        self.new_type(
            TypeFlags::CONDITIONAL,
            ObjectFlags::NONE,
            TypeData::Conditional(data),
        )
    }

    pub fn new_substitution_type(&mut self, base_type: TypeId, constraint: TypeId) -> TypeId {
        let data = SubstitutionType {
            base_type,
            constraint,
            ..SubstitutionType::default()
        };
        self.new_type(
            TypeFlags::SUBSTITUTION,
            ObjectFlags::NONE,
            TypeData::Substitution(data),
        )
    }

    pub fn new_signature(
        &mut self,
        flags: SignatureFlags,
        declaration: NodeId,
        type_parameters: List<'a, TypeId>,
        this_parameter: SymbolId,
        parameters: List<'a, SymbolId>,
        resolved_return_type: TypeId,
        resolved_type_predicate: TypePredicateId,
        min_argument_count: isize,
    ) -> SignatureId {
        self.signature_count = self.signature_count.wrapping_add(1);
        let sig = self.signatures.alloc(Signature {
            flags,
            declaration,
            type_parameters,
            parameters,
            this_parameter,
            resolved_return_type,
            resolved_type_predicate,
            min_argument_count: min_argument_count as i32,
            resolved_min_argument_count: -1,
            ..Signature::default()
        });
        // `sig.id = SignatureId(c.SignatureCount)`: the id of a signature is its place in the store, nil once the id space is used up.
        if sig.0 != self.signature_count {
            self.ast.fault(
                FaultKind::IdSpaceExhausted,
                "newSignature",
                0,
                self.signature_count,
            );
        }
        sig
    }

    pub fn new_index_info(
        &mut self,
        key_type: TypeId,
        value_type: TypeId,
        is_readonly: bool,
        declaration: NodeId,
        components: List<'a, NodeId>,
    ) -> IndexInfoId {
        let info = self.index_infos.alloc(IndexInfo {
            key_type,
            value_type,
            is_readonly,
            declaration,
            components,
            ..IndexInfo::default()
        });
        if info.is_nil() {
            self.ast
                .fault(FaultKind::IdSpaceExhausted, "newIndexInfo", 0, 0);
        }
        info
    }
}

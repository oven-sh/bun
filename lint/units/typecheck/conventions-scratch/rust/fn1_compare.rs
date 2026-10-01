// checker/utilities.go:362-705 and checker.go:22165-22188.
use crate::checker::Checker;
use crate::flags::{ObjectFlags, SymbolFlags, TypeFlags};
use crate::golang::{List, SliceBuf, compare_f64, compare_strings};
use crate::ids::*;
use crate::slices;
use crate::types::{LiteralValue, TypeMapper, TypeMapperKind};

impl<'a> Checker<'a> {
    pub fn sort_symbols(&mut self, symbols: &mut [SymbolId]) {
        slices::sort_func(symbols, |a, b| self.compare_symbols(a, b));
    }

    // The field `compareSymbols` holds the method value `compareSymbolsWorker`.
    pub fn compare_symbols(&mut self, s1: SymbolId, s2: SymbolId) -> isize {
        self.compare_symbols_worker(s1, s2)
    }

    pub fn compare_symbols_worker(&mut self, s1: SymbolId, s2: SymbolId) -> isize {
        if s1 == s2 {
            return 0;
        }
        if s1.is_nil() {
            return 1;
        }
        if s2.is_nil() {
            return -1;
        }
        if self.symbols[s1].declarations.len() != 0 && self.symbols[s2].declarations.len() != 0 {
            let r = self.compare_nodes(
                self.symbols[s1].declarations.at(0),
                self.symbols[s2].declarations.at(0),
            );
            if r != 0 {
                return r;
            }
        } else if self.symbols[s1].declarations.len() != 0 {
            return -1;
        } else if self.symbols[s2].declarations.len() != 0 {
            return 1;
        }
        let r = compare_strings(self.symbols[s1].name, self.symbols[s2].name);
        if r != 0 {
            return r;
        }
        // Fall back to symbol IDs. This is a last resort that should happen only when symbols have no declaration and duplicate names.
        self.get_symbol_id(s1) as isize - self.get_symbol_id(s2) as isize
    }

    pub fn compare_nodes(&mut self, n1: NodeId, n2: NodeId) -> isize {
        if n1 == n2 {
            return 0;
        }
        if n1.is_nil() {
            return 1;
        }
        if n2.is_nil() {
            return -1;
        }
        let s1 = self.nodes[n1].source_file;
        let s2 = self.nodes[n2].source_file;
        if s1 != s2 {
            let f1 = self.file_index_map.get(&s1);
            let f2 = self.file_index_map.get(&s2);
            // Order by index of file in the containing program
            return f1 - f2;
        }
        // In the same file, order by source position
        (self.nodes[n1].pos - self.nodes[n2].pos) as isize
    }

    pub fn compare_types(&mut self, t1: TypeId, t2: TypeId) -> isize {
        if t1 == t2 {
            return 0;
        }
        if t1.is_nil() {
            return -1;
        }
        if t2.is_nil() {
            return 1;
        }
        // First sort in order of increasing type flags values.
        let c = self.get_sort_order_flags(t1) - self.get_sort_order_flags(t2);
        if c != 0 {
            return c;
        }
        // Order named types by name and, in the case of aliased types, by alias type arguments.
        let c = self.compare_type_names(t1, t2);
        if c != 0 {
            return c;
        }
        // We have unnamed types or types with identical names. Now sort by data specific to the type.
        let flags = self.types[t1].flags;
        if flags.intersects(
            TypeFlags::ANY
                | TypeFlags::UNKNOWN
                | TypeFlags::STRING
                | TypeFlags::NUMBER
                | TypeFlags::BOOLEAN
                | TypeFlags::BIG_INT
                | TypeFlags::ES_SYMBOL
                | TypeFlags::VOID
                | TypeFlags::UNDEFINED
                | TypeFlags::NULL
                | TypeFlags::NEVER
                | TypeFlags::NON_PRIMITIVE,
        ) {
            // Only distinguished by type IDs, handled below.
        } else if flags.intersects(TypeFlags::OBJECT) {
            // Order unnamed or identically named object types by symbol.
            let c = self.compare_symbols(self.types[t1].symbol, self.types[t2].symbol);
            if c != 0 {
                return c;
            }
            // When object types have the same or no symbol, order by kind. We order type references before other kinds.
            if self.types[t1]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
                && self.types[t2]
                    .object_flags
                    .intersects(ObjectFlags::REFERENCE)
            {
                let r1 = t1;
                let r2 = t2;
                let target1 = self.as_type_reference(r1).object.target;
                let target2 = self.as_type_reference(r2).object.target;
                if self.types[target1]
                    .object_flags
                    .intersects(ObjectFlags::TUPLE)
                    && self.types[target2]
                        .object_flags
                        .intersects(ObjectFlags::TUPLE)
                {
                    // Tuple types have no associated symbol, instead we order by tuple element information.
                    let c = self.compare_tuple_types(target1, target2);
                    if c != 0 {
                        return c;
                    }
                }
                // Here we know we have references to instantiations of the same type because we have matching targets.
                if self.as_type_reference(r1).node.is_nil()
                    && self.as_type_reference(r2).node.is_nil()
                {
                    // Non-deferred type references with the same target are sorted by their type argument lists.
                    let c = self.compare_type_lists(
                        self.as_type_reference(t1).resolved_type_arguments,
                        self.as_type_reference(t2).resolved_type_arguments,
                    );
                    if c != 0 {
                        return c;
                    }
                } else {
                    // Deferred type references with the same target are ordered by the source location of the reference.
                    let c = self.compare_nodes(
                        self.as_type_reference(r1).node,
                        self.as_type_reference(r2).node,
                    );
                    if c != 0 {
                        return c;
                    }
                    // Instantiations of the same deferred type reference are ordered by their associated type mappers.
                    let c = self.compare_type_mappers(
                        self.as_object_type(t1).mapper,
                        self.as_object_type(t2).mapper,
                    );
                    if c != 0 {
                        return c;
                    }
                }
            } else if self.types[t1]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            {
                return -1;
            } else if self.types[t2]
                .object_flags
                .intersects(ObjectFlags::REFERENCE)
            {
                return 1;
            } else {
                // Order unnamed non-reference object types by kind associated type mappers.
                let c = (self.types[t1].object_flags & ObjectFlags::OBJECT_TYPE_KIND_MASK).bits()
                    as isize
                    - (self.types[t2].object_flags & ObjectFlags::OBJECT_TYPE_KIND_MASK).bits()
                        as isize;
                if c != 0 {
                    return c;
                }
                let c = self.compare_type_mappers(
                    self.as_object_type(t1).mapper,
                    self.as_object_type(t2).mapper,
                );
                if c != 0 {
                    return c;
                }
            }
        } else if flags.intersects(TypeFlags::UNION) {
            // Unions are ordered by origin and then constituent type lists.
            let o1 = self.as_union_type(t1).origin;
            let o2 = self.as_union_type(t2).origin;
            if o1.is_nil() && o2.is_nil() {
                let c = self.compare_type_lists(self.type_types(t1), self.type_types(t2));
                if c != 0 {
                    return c;
                }
            } else if o1.is_nil() {
                return 1;
            } else if o2.is_nil() {
                return -1;
            } else {
                let c = self.compare_types(o1, o2);
                if c != 0 {
                    return c;
                }
            }
        } else if flags.intersects(TypeFlags::INTERSECTION) {
            // Intersections are ordered by their constituent type lists.
            let c = self.compare_type_lists(self.type_types(t1), self.type_types(t2));
            if c != 0 {
                return c;
            }
        } else if flags
            .intersects(TypeFlags::ENUM | TypeFlags::ENUM_LITERAL | TypeFlags::UNIQUE_ES_SYMBOL)
        {
            // Enum members are ordered by their symbol (and thus their declaration order).
            let c = self.compare_symbols(self.types[t1].symbol, self.types[t2].symbol);
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::STRING_LITERAL) {
            // String literal types are ordered by their values.
            let c = compare_strings(self.literal_string(t1), self.literal_string(t2));
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::NUMBER_LITERAL) {
            // Numeric literal types are ordered by their values.
            let c = compare_f64(self.literal_number(t1), self.literal_number(t2));
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
            let b1 = self.literal_bool(t1);
            let b2 = self.literal_bool(t2);
            if b1 != b2 {
                if b1 {
                    return 1;
                }
                return -1;
            }
        } else if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            let c = self.compare_symbols(self.types[t1].symbol, self.types[t2].symbol);
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::INDEX) {
            let c =
                self.compare_types(self.as_index_type(t1).target, self.as_index_type(t2).target);
            if c != 0 {
                return c;
            }
            let c = self.as_index_type(t1).index_flags as isize
                - self.as_index_type(t2).index_flags as isize;
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::INDEXED_ACCESS) {
            let c = self.compare_types(
                self.as_indexed_access_type(t1).object_type,
                self.as_indexed_access_type(t2).object_type,
            );
            if c != 0 {
                return c;
            }
            let c = self.compare_types(
                self.as_indexed_access_type(t1).index_type,
                self.as_indexed_access_type(t2).index_type,
            );
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::CONDITIONAL) {
            let c = self.compare_nodes(
                self.conditional_roots[self.as_conditional_type(t1).root].node,
                self.conditional_roots[self.as_conditional_type(t2).root].node,
            );
            if c != 0 {
                return c;
            }
            let c = self.compare_type_mappers(
                self.as_conditional_type(t1).mapper,
                self.as_conditional_type(t2).mapper,
            );
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::SUBSTITUTION) {
            let c = self.compare_types(
                self.as_substitution_type(t1).base_type,
                self.as_substitution_type(t2).base_type,
            );
            if c != 0 {
                return c;
            }
            let c = self.compare_types(
                self.as_substitution_type(t1).constraint,
                self.as_substitution_type(t2).constraint,
            );
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            let c = self.compare_text_lists(
                self.as_template_literal_type(t1).texts,
                self.as_template_literal_type(t2).texts,
            );
            if c != 0 {
                return c;
            }
            let c = self.compare_type_lists(
                self.as_template_literal_type(t1).types,
                self.as_template_literal_type(t2).types,
            );
            if c != 0 {
                return c;
            }
        } else if flags.intersects(TypeFlags::STRING_MAPPING) {
            let c = self.compare_types(
                self.as_string_mapping_type(t1).target,
                self.as_string_mapping_type(t2).target,
            );
            if c != 0 {
                return c;
            }
        }
        // Fall back to type IDs. This results in type creation order for built-in types.
        self.types[t1].id.0 as isize - self.types[t2].id.0 as isize
    }

    fn literal_string(&self, t: TypeId) -> &'a [u8] {
        match self.as_literal_type(t).value {
            LiteralValue::String(s) => s,
            _ => {
                self.bad_cast("value.(string)");
                b""
            }
        }
    }

    fn literal_number(&self, t: TypeId) -> f64 {
        match self.as_literal_type(t).value {
            LiteralValue::Number(n) => n,
            _ => {
                self.bad_cast("value.(jsnum.Number)");
                0.0
            }
        }
    }

    fn literal_bool(&self, t: TypeId) -> bool {
        match self.as_literal_type(t).value {
            LiteralValue::Boolean(b) => b,
            _ => {
                self.bad_cast("value.(bool)");
                false
            }
        }
    }

    pub fn get_sort_order_flags(&mut self, t: TypeId) -> isize {
        // Return TypeFlagsEnum for all enum-like unit types (they'll be sorted by their symbols)
        if self.types[t]
            .flags
            .intersects(TypeFlags::ENUM_LITERAL | TypeFlags::ENUM)
            && !self.types[t].flags.intersects(TypeFlags::UNION)
        {
            return TypeFlags::ENUM.bits() as isize;
        }
        self.types[t].flags.bits() as isize
    }

    pub fn compare_type_names(&mut self, t1: TypeId, t2: TypeId) -> isize {
        let s1 = self.get_type_name_symbol(t1);
        let s2 = self.get_type_name_symbol(t2);
        if s1 == s2 {
            if !self.types[t1].alias.is_nil() {
                return self.compare_type_lists(
                    self.type_aliases[self.types[t1].alias].type_arguments,
                    self.type_aliases[self.types[t2].alias].type_arguments,
                );
            }
            return 0;
        }
        if s1.is_nil() {
            return 1;
        }
        if s2.is_nil() {
            return -1;
        }
        compare_strings(self.symbols[s1].name, self.symbols[s2].name)
    }

    pub fn get_type_name_symbol(&mut self, t: TypeId) -> SymbolId {
        if !self.types[t].alias.is_nil() {
            return self.type_aliases[self.types[t].alias].symbol;
        }
        if self.types[t]
            .flags
            .intersects(TypeFlags::TYPE_PARAMETER | TypeFlags::STRING_MAPPING)
            || self.types[t]
                .object_flags
                .intersects(ObjectFlags::CLASS_OR_INTERFACE | ObjectFlags::REFERENCE)
        {
            return self.types[t].symbol;
        }
        SymbolId::NIL
    }

    pub fn compare_tuple_types(&mut self, t1: TypeId, t2: TypeId) -> isize {
        if t1 == t2 {
            return 0;
        }
        if self.as_tuple_type(t1).readonly != self.as_tuple_type(t2).readonly {
            return if self.as_tuple_type(t1).readonly {
                1
            } else {
                -1
            };
        }
        let infos1 = self.as_tuple_type(t1).element_infos;
        let infos2 = self.as_tuple_type(t2).element_infos;
        if infos1.len() != infos2.len() {
            return infos1.len() - infos2.len();
        }
        for i in 0..infos1.len() {
            let c = infos1.at(i).flags.bits() as isize - infos2.at(i).flags.bits() as isize;
            if c != 0 {
                return c;
            }
        }
        for i in 0..infos1.len() {
            let c = self.compare_element_labels(
                infos1.at(i).labeled_declaration,
                infos2.at(i).labeled_declaration,
            );
            if c != 0 {
                return c;
            }
        }
        0
    }

    pub fn compare_element_labels(&mut self, n1: NodeId, n2: NodeId) -> isize {
        if n1 == n2 {
            return 0;
        }
        if n1.is_nil() {
            return -1;
        }
        if n2.is_nil() {
            return 1;
        }
        compare_strings(
            self.node_text(self.nodes[n1].name),
            self.node_text(self.nodes[n2].name),
        )
    }

    pub fn node_text(&mut self, node: NodeId) -> &'a [u8] {
        let _ = node;
        self.stand_in("Node.Text")
    }

    pub fn compare_type_lists(&mut self, s1: List<'a, TypeId>, s2: List<'a, TypeId>) -> isize {
        if s1.len() != s2.len() {
            return s1.len() - s2.len();
        }
        for (i, t1) in s1.iter().enumerate() {
            let c = self.compare_types(t1, s2.at(i));
            if c != 0 {
                return c;
            }
        }
        0
    }

    // slices.Compare on []string
    pub fn compare_text_lists(&mut self, s1: List<'a, &'a [u8]>, s2: List<'a, &'a [u8]>) -> isize {
        for (i, v1) in s1.iter().enumerate() {
            if i as isize >= s2.len() {
                return 1;
            }
            let c = compare_strings(v1, s2.at(i));
            if c != 0 {
                return c;
            }
        }
        if s1.len() < s2.len() {
            return -1;
        }
        0
    }

    pub fn mapper_kind(&self, m: TypeMapperId) -> TypeMapperKind {
        match self.type_mappers[m] {
            TypeMapper::Simple { .. } => TypeMapperKind::Simple,
            TypeMapper::Array { .. } => TypeMapperKind::Array,
            TypeMapper::Merged { .. } => TypeMapperKind::Merged,
            _ => TypeMapperKind::Unknown,
        }
    }

    pub fn compare_type_mappers(&mut self, m1: TypeMapperId, m2: TypeMapperId) -> isize {
        if m1 == m2 {
            return 0;
        }
        if m1.is_nil() {
            return 1;
        }
        if m2.is_nil() {
            return -1;
        }
        let kind1 = self.mapper_kind(m1);
        let kind2 = self.mapper_kind(m2);
        if kind1 != kind2 {
            return kind1 as isize - kind2 as isize;
        }
        match (&self.type_mappers[m1], &self.type_mappers[m2]) {
            (
                &TypeMapper::Simple {
                    source: source1,
                    target: target1,
                },
                &TypeMapper::Simple {
                    source: source2,
                    target: target2,
                },
            ) => {
                let c = self.compare_types(source1, source2);
                if c != 0 {
                    return c;
                }
                self.compare_types(target1, target2)
            }
            (
                &TypeMapper::Array {
                    sources: sources1,
                    targets: targets1,
                },
                &TypeMapper::Array {
                    sources: sources2,
                    targets: targets2,
                },
            ) => {
                let c = self.compare_type_lists(sources1, sources2);
                if c != 0 {
                    return c;
                }
                self.compare_type_lists(targets1, targets2)
            }
            (&TypeMapper::Merged { m1: a1, m2: a2 }, &TypeMapper::Merged { m1: b1, m2: b2 }) => {
                let c = self.compare_type_mappers(a1, b1);
                if c != 0 {
                    return c;
                }
                self.compare_type_mappers(a2, b2)
            }
            _ => 0,
        }
    }

    pub fn get_named_members(
        &mut self,
        members: SymbolTableId,
        container: SymbolId,
    ) -> List<'a, SymbolId> {
        if self.symbol_tables[members].len() == 0 {
            return List::NIL;
        }
        // For classes and interfaces, we store explicitly declared members ahead of inherited members.
        let mut result = SliceBuf::make(0, self.symbol_tables[members].len());
        let mut contained_count = 0;
        if !container.is_nil()
            && self.symbols[container]
                .flags
                .intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE)
        {
            for position in 0..self.symbol_tables[members].len() as usize {
                let Some((id, symbol)) = self.symbol_tables[members].entry_at(position) else {
                    break;
                };
                if self.is_named_member(symbol, id)
                    && self.is_declaration_contained_by(symbol, container)
                {
                    result.push(symbol);
                }
            }
            contained_count = result.len();
        }
        for position in 0..self.symbol_tables[members].len() as usize {
            let Some((id, symbol)) = self.symbol_tables[members].entry_at(position) else {
                break;
            };
            if self.is_named_member(symbol, id)
                && (container.is_nil()
                    || !self.symbols[container]
                        .flags
                        .intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE)
                    || !self.is_declaration_contained_by(symbol, container))
            {
                result.push(symbol);
            }
        }
        let (contained, rest) = result
            .items
            .split_at_mut(usize::try_from(contained_count).unwrap_or(0));
        self.sort_symbols(contained);
        self.sort_symbols(rest);
        self.list(&result)
    }

    pub fn is_named_member(&mut self, symbol: SymbolId, id: &'a [u8]) -> bool {
        let _ = (symbol, id);
        self.stand_in("isNamedMember")
    }

    pub fn is_declaration_contained_by(&mut self, symbol: SymbolId, container: SymbolId) -> bool {
        let _ = (symbol, container);
        self.stand_in("isDeclarationContainedBy")
    }
}

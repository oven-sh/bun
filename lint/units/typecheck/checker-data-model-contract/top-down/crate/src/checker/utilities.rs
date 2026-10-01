// checker/utilities.go 362-705, checker.go 22165-22188 and the helpers of internal/core whose callback needs the checker.
use crate::ast::flags_generated::SymbolFlags;
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{ObjectFlags, TypeFlags};
use crate::checker::ids::TypeMapperId;
use crate::checker::mapper::{MapperTargets, TypeMapper};
use crate::checker::types::LiteralValue;
use crate::tscore::golang::{List, SliceBuf, compare_strings};
use crate::tscore::gomore::{TextList, compare_f64};
use crate::tscore::ids::{NodeId, SymbolId, SymbolTableId, TypeId};
use crate::tscore::slices;
use crate::tscore::stable::ArenaItem;

impl<'a> Checker<'a> {
    // core.Some with a callback that needs the checker: the checker comes back as the first parameter.
    pub fn some<T: Copy>(
        &mut self,
        slice: &[T],
        mut f: impl FnMut(&mut Checker<'a>, T) -> bool,
    ) -> bool {
        for &value in slice {
            if f(self, value) {
                return true;
            }
        }
        false
    }

    // core.Every
    pub fn every<T: Copy>(
        &mut self,
        slice: &[T],
        mut f: impl FnMut(&mut Checker<'a>, T) -> bool,
    ) -> bool {
        for &value in slice {
            if !f(self, value) {
                return false;
            }
        }
        true
    }

    // core.Filter: returns the argument itself when nothing is removed.
    pub fn filter<T: ArenaItem + Default>(
        &mut self,
        slice: List<'a, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> bool,
    ) -> List<'a, T> {
        for (i, value) in slice.iter().enumerate() {
            if !f(self, value) {
                let mut result = SliceBuf::make(0, slice.len());
                result.extend(slice.sub(0usize, i));
                for j in i + 1..slice.len() as usize {
                    let value = slice.at(j);
                    if f(self, value) {
                        result.push(value);
                    }
                }
                return self.list(&result);
            }
        }
        slice
    }

    // core.Map: a nil slice maps to nil.
    pub fn map_list<T: Copy + Default, U: ArenaItem + Default>(
        &mut self,
        slice: List<'a, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> U,
    ) -> List<'a, U> {
        if slice.is_nil() {
            return List::NIL;
        }
        let mut result = SliceBuf::make(0, slice.len());
        for value in slice.iter() {
            result.push(f(self, value));
        }
        self.list(&result)
    }

    pub fn sort_symbols(&mut self, symbols: &mut [SymbolId]) {
        slices::sort_func(symbols, |s1, s2| self.compare_symbols(s1, s2));
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
        let a = self.ast;
        let (sym1, sym2) = (a.sym(s1), a.sym(s2));
        if sym1.declarations.len() != 0 && sym2.declarations.len() != 0 {
            let r = self.compare_nodes(sym1.declarations.at(0usize), sym2.declarations.at(0usize));
            if r != 0 {
                return r;
            }
        } else if sym1.declarations.len() != 0 {
            return -1;
        } else if sym2.declarations.len() != 0 {
            return 1;
        }
        let r = compare_strings(sym1.name, sym2.name);
        if r != 0 {
            return r;
        }
        // Fall back to symbol IDs. This is a last resort that should happen only when symbols have no declaration and duplicate names.
        a.get_symbol_id(s1) as isize - a.get_symbol_id(s2) as isize
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
        let a = self.ast;
        let s1 = a.source_file_of(n1);
        let s2 = a.source_file_of(n2);
        if s1 != s2 {
            let f1 = self.file_index_map.get(&s1);
            let f2 = self.file_index_map.get(&s2);
            // Order by index of file in the containing program
            return f1 - f2;
        }
        // In the same file, order by source position
        (a.pos(n1) - a.pos(n2)) as isize
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
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return self.types[t1].id.0 as isize - self.types[t2].id.0 as isize;
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
            let reference1 = self.types[t1]
                .object_flags
                .intersects(ObjectFlags::REFERENCE);
            let reference2 = self.types[t2]
                .object_flags
                .intersects(ObjectFlags::REFERENCE);
            if reference1 && reference2 {
                let target1 = self.as_type_reference(t1).object.target;
                let target2 = self.as_type_reference(t2).object.target;
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
                if self.as_type_reference(t1).node.is_nil()
                    && self.as_type_reference(t2).node.is_nil()
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
                        self.as_type_reference(t1).node,
                        self.as_type_reference(t2).node,
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
            } else if reference1 {
                return -1;
            } else if reference2 {
                return 1;
            } else {
                // Order unnamed non-reference object types by kind associated type mappers.
                let c = (self.types[t1].object_flags & ObjectFlags::OBJECT_TYPE_KIND_MASK).0
                    as isize
                    - (self.types[t2].object_flags & ObjectFlags::OBJECT_TYPE_KIND_MASK).0 as isize;
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
            let c = self.as_index_type(t1).index_flags.0 as isize
                - self.as_index_type(t2).index_flags.0 as isize;
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
            let c = compare_text_lists(
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

    // `value.(string)` of a literal type
    fn literal_string(&self, t: TypeId) -> &'a [u8] {
        match self.as_literal_type(t).value {
            LiteralValue::String(s) => s,
            _ => {
                self.bad_cast("value.(string)", t.0);
                b""
            }
        }
    }

    fn literal_number(&self, t: TypeId) -> f64 {
        match self.as_literal_type(t).value {
            LiteralValue::Number(n) => n,
            _ => {
                self.bad_cast("value.(jsnum.Number)", t.0);
                0.0
            }
        }
    }

    fn literal_bool(&self, t: TypeId) -> bool {
        match self.as_literal_type(t).value {
            LiteralValue::Boolean(b) => b,
            _ => {
                self.bad_cast("value.(bool)", t.0);
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
            return TypeFlags::ENUM.0 as isize;
        }
        self.types[t].flags.0 as isize
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
        let a = self.ast;
        compare_strings(a.sym(s1).name, a.sym(s2).name)
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
            let c = infos1.at(i).flags.0 as isize - infos2.at(i).flags.0 as isize;
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
        let a = self.ast;
        compare_strings(a.text(a.name(n1)), a.text(a.name(n2)))
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

    // compareTypeLists over the targets of two array mappers, whichever way each keeps them.
    fn compare_mapper_targets(&mut self, s1: MapperTargets<'a>, s2: MapperTargets<'a>) -> isize {
        if s1.len() != s2.len() {
            return s1.len() - s2.len();
        }
        for i in 0..s1.len() {
            let c = self.compare_types(s1.at(i), s2.at(i));
            if c != 0 {
                return c;
            }
        }
        0
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
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let kind1 = self.mapper_kind(m1);
        let kind2 = self.mapper_kind(m2);
        if kind1 != kind2 {
            return kind1.0 as isize - kind2.0 as isize;
        }
        match (self.type_mappers[m1], self.type_mappers[m2]) {
            (
                TypeMapper::Simple {
                    source: source1,
                    target: target1,
                },
                TypeMapper::Simple {
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
                TypeMapper::Array {
                    sources: sources1,
                    targets: targets1,
                },
                TypeMapper::Array {
                    sources: sources2,
                    targets: targets2,
                },
            ) => {
                let c = self.compare_type_lists(sources1, sources2);
                if c != 0 {
                    return c;
                }
                self.compare_mapper_targets(targets1, targets2)
            }
            (TypeMapper::Merged { m1: a1, m2: a2 }, TypeMapper::Merged { m1: b1, m2: b2 }) => {
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
        let a = self.ast;
        if a.table_len(members) == 0 {
            return List::NIL;
        }
        // For classes and interfaces, we store explicitly declared members ahead of inherited members.
        let mut result = SliceBuf::make(0, a.table_len(members));
        let mut contained_count = 0;
        if !container.is_nil()
            && a.sym(container)
                .flags
                .intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE)
        {
            for position in 0..a.table_len(members) as usize {
                let Some((id, symbol)) = a.table_entry_at(members, position) else {
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
        for position in 0..a.table_len(members) as usize {
            let Some((id, symbol)) = a.table_entry_at(members, position) else {
                break;
            };
            if self.is_named_member(symbol, id)
                && (container.is_nil()
                    || !a
                        .sym(container)
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

    pub fn is_named_member(&mut self, symbol: SymbolId, id: &[u8]) -> bool {
        let _ = symbol;
        self.stand_ins.record("isNamedMember");
        !id.starts_with(b"\xFE")
    }

    pub fn is_declaration_contained_by(&mut self, symbol: SymbolId, container: SymbolId) -> bool {
        let _ = (symbol, container);
        self.stand_in("isDeclarationContainedBy")
    }
}

// slices.Compare on []string
pub fn compare_text_lists(s1: TextList<'_>, s2: TextList<'_>) -> isize {
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

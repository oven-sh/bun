// checker.go:25725-26801 (layers K-UNION, K-INTERSECT, K-PRED): union and intersection construction and the predicates over constituent lists.
use crate::ast::{SymbolFlags, SymbolId};
use crate::checker::{
    Checker, IntersectionFlags, ObjectFlags, RelationKind, TypeAliasId, TypeComparer, TypeFlags,
    TypeId, UnionOfUnionKey, UnionReduction, compare_types, get_alias_key, get_intersection_key,
    get_type_list_key, get_union_key, is_fresh_literal_type, is_unit_type,
};
use crate::core::List;
use crate::diagnostics;

// `s[i]` as a guarded read: the nil id when the index is outside the slice.
fn at(types: &[TypeId], index: usize) -> TypeId {
    types.get(index).copied().unwrap_or(TypeId::NIL)
}

// `slices.Delete(s, i, i+1)`: nothing is removed when the index is outside the slice.
fn delete_at(types: &mut Vec<TypeId>, index: usize) {
    if index < types.len() {
        types.remove(index);
    }
}

// Go's slices.BinarySearchFunc and slices.SortStableFunc, statement for statement, so that the sequence of comparator calls is upstream's.
fn binary_search_func<E: Copy, T: Copy>(
    x: &[E],
    target: T,
    mut cmp: impl FnMut(E, T) -> isize,
) -> (usize, bool) {
    let n = x.len();
    let (mut i, mut j) = (0usize, n);
    while i < j {
        let h = (i + j) >> 1;
        let Some(&probe) = x.get(h) else { break };
        if cmp(probe, target) < 0 {
            i = h + 1;
        } else {
            j = h;
        }
    }
    let found = match x.get(i) {
        Some(&probe) => cmp(probe, target) == 0,
        None => false,
    };
    (i, found)
}
fn insertion_sort_cmp_func<E: Copy>(
    data: &mut [E],
    a: usize,
    b: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) {
    let mut i = a + 1;
    while i < b {
        let mut j = i;
        while j > a {
            let (Some(&x), Some(&y)) = (data.get(j), data.get(j - 1)) else {
                break;
            };
            if !(cmp(x, y) < 0) {
                break;
            }
            data.swap(j, j - 1);
            j -= 1;
        }
        i += 1;
    }
}

fn swap_range<E: Copy>(data: &mut [E], a: usize, b: usize, n: usize) {
    for i in 0..n {
        if a + i < data.len() && b + i < data.len() {
            data.swap(a + i, b + i);
        }
    }
}

fn rotate<E: Copy>(data: &mut [E], a: usize, m: usize, b: usize) {
    let mut i = m - a;
    let mut j = b - m;
    while i != j {
        if i > j {
            swap_range(data, m - i, m, j);
            i -= j;
        } else {
            swap_range(data, m - i, m + j - i, i);
            j -= i;
        }
    }
    swap_range(data, m - i, m, i);
}

fn less<E: Copy>(data: &[E], x: usize, y: usize, cmp: &mut impl FnMut(E, E) -> isize) -> bool {
    match (data.get(x), data.get(y)) {
        (Some(&p), Some(&q)) => cmp(p, q) < 0,
        _ => false,
    }
}

fn sym_merge<E: Copy>(
    data: &mut [E],
    a: usize,
    m: usize,
    b: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) {
    if m - a == 1 {
        let (mut i, mut j) = (m, b);
        while i < j {
            let h = (i + j) >> 1;
            if less(data, h, a, cmp) {
                i = h + 1;
            } else {
                j = h;
            }
        }
        let mut k = a;
        while k + 1 < i {
            data.swap(k, k + 1);
            k += 1;
        }
        return;
    }
    if b - m == 1 {
        let (mut i, mut j) = (a, m);
        while i < j {
            let h = (i + j) >> 1;
            if !less(data, m, h, cmp) {
                i = h + 1;
            } else {
                j = h;
            }
        }
        let mut k = m;
        while k > i {
            data.swap(k, k - 1);
            k -= 1;
        }
        return;
    }
    let mid = (a + b) >> 1;
    let n = mid + m;
    let (mut start, mut r) = if m > mid { (n - b, mid) } else { (a, m) };
    let p = n - 1;
    while start < r {
        let c = (start + r) >> 1;
        if !less(data, p - c, c, cmp) {
            start = c + 1;
        } else {
            r = c;
        }
    }
    let end = n - start;
    if start < m && m < end {
        rotate(data, start, m, end);
    }
    if a < start && start < mid {
        sym_merge(data, a, start, mid, cmp);
    }
    if mid < end && end < b {
        sym_merge(data, mid, end, b, cmp);
    }
}

fn sort_stable_func<E: Copy>(data: &mut [E], mut cmp: impl FnMut(E, E) -> isize) {
    let n = data.len();
    let mut block_size = 20usize;
    let (mut a, mut b) = (0usize, block_size);
    while b <= n {
        insertion_sort_cmp_func(data, a, b, &mut cmp);
        a = b;
        b += block_size;
    }
    insertion_sort_cmp_func(data, a, n, &mut cmp);
    while block_size < n {
        a = 0;
        b = 2 * block_size;
        while b <= n {
            sym_merge(data, a, a + block_size, b, &mut cmp);
            a = b;
            b += 2 * block_size;
        }
        let m = a + block_size;
        if m < n {
            sym_merge(data, a, m, n, &mut cmp);
        }
        block_size *= 2;
    }
}

// `slices.BinarySearchFunc(types, t, CompareTypes)`
fn binary_search_types(c: &mut Checker<'_>, types: &[TypeId], t: TypeId) -> (usize, bool) {
    binary_search_func(types, t, |t1, t2| compare_types(c, t1, t2))
}

impl<'a> Checker<'a> {
    pub fn get_union_or_intersection_type(
        &mut self,
        types: List<'_, TypeId>,
        is_union: bool,
        union_reduction: UnionReduction,
    ) -> TypeId {
        if is_union {
            return self.get_union_type_ex(types, union_reduction, TypeAliasId::NIL, TypeId::NIL);
        }
        self.get_intersection_type(types)
    }

    pub fn get_union_type(&mut self, types: List<'_, TypeId>) -> TypeId {
        self.get_union_type_ex(
            types,
            UnionReduction::LITERAL,
            TypeAliasId::NIL,
            TypeId::NIL,
        )
    }

    // We sort and deduplicate the constituent types based on object identity. If the subtypeReduction flag is specified we also reduce the constituent type set to only include types that aren't subtypes of other types. Subtype reduction is expensive for large union types and is possible only when union types are known not to circularly reference themselves (as is the case with union types created by expression constructs such as array literals and the || and ?: operators). Named types can circularly reference themselves and therefore cannot be subtype reduced during their declaration. For example, "type Item = string | (() => Item" is a named type that circularly references itself.
    pub fn get_union_type_ex(
        &mut self,
        types: List<'_, TypeId>,
        union_reduction: UnionReduction,
        alias: TypeAliasId,
        origin: TypeId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let list = types.as_slice();
        if list.is_empty() {
            return self.never_type;
        }
        if let [only] = list {
            return *only;
        }
        // We optimize for the common case of unioning a union type with some other type (such as `undefined`).
        if let [first, second] = list {
            if origin.is_nil()
                && (self.types[*first].flags.intersects(TypeFlags::UNION)
                    || self.types[*second].flags.intersects(TypeFlags::UNION))
            {
                let mut id1 = *first;
                let mut id2 = *second;
                if id1 > id2 {
                    std::mem::swap(&mut id1, &mut id2);
                }
                let key = UnionOfUnionKey {
                    id1,
                    id2,
                    r: union_reduction,
                    a: get_alias_key(self, alias),
                };
                let mut t = self.union_of_union_types.get(&key);
                if t.is_nil() {
                    t = self.get_union_type_worker(types, union_reduction, alias, TypeId::NIL);
                    let ok = self.union_of_union_types.set(key, t);
                    self.map_set(ok);
                }
                return t;
            }
        }
        self.get_union_type_worker(types, union_reduction, alias, origin)
    }

    pub fn get_union_type_worker(
        &mut self,
        types: List<'_, TypeId>,
        union_reduction: UnionReduction,
        alias: TypeAliasId,
        origin: TypeId,
    ) -> TypeId {
        let mut origin = origin;
        let (mut type_set, includes) = self.add_types_to_union(types);
        if union_reduction != UnionReduction::NONE {
            if includes.intersects(TypeFlags::ANY_OR_UNKNOWN) {
                if includes.intersects(TypeFlags::ANY) {
                    if includes.intersects(TypeFlags::INCLUDES_WILDCARD) {
                        return self.wildcard_type;
                    }
                    if includes.intersects(TypeFlags::INCLUDES_ERROR) {
                        return self.error_type;
                    }
                    return self.any_type;
                }
                return self.unknown_type;
            }
            if includes.intersects(TypeFlags::UNDEFINED) {
                // If type set contains both undefinedType and missingType, remove missingType
                if type_set.len() >= 2
                    && at(&type_set, 0) == self.undefined_type
                    && at(&type_set, 1) == self.missing_type
                {
                    delete_at(&mut type_set, 1);
                }
            }
            if includes.intersects(
                TypeFlags::ENUM
                    | TypeFlags::LITERAL
                    | TypeFlags::UNIQUE_ES_SYMBOL
                    | TypeFlags::TEMPLATE_LITERAL
                    | TypeFlags::STRING_MAPPING,
            ) || includes.intersects(TypeFlags::VOID)
                && includes.intersects(TypeFlags::UNDEFINED)
            {
                type_set = self.remove_redundant_literal_types(
                    type_set,
                    includes,
                    union_reduction.intersects(UnionReduction::SUBTYPE),
                );
            }
            if includes.intersects(TypeFlags::STRING_LITERAL)
                && includes.intersects(TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING)
            {
                type_set = self.remove_string_literals_matched_by_template_literals(type_set);
            }
            if includes.intersects(TypeFlags::INCLUDES_CONSTRAINED_TYPE_VARIABLE) {
                type_set = self.remove_constrained_type_variables(type_set);
            }
            if union_reduction == UnionReduction::SUBTYPE {
                // A nil list is the answer of the limit: nothing is cached and the union is the error type.
                match self.remove_subtypes(type_set, includes.intersects(TypeFlags::OBJECT)) {
                    Some(reduced) => type_set = reduced,
                    None => return self.error_type,
                }
            }
            if type_set.is_empty() {
                if includes.intersects(TypeFlags::NULL) {
                    if includes.intersects(TypeFlags::INCLUDES_NON_WIDENING_TYPE) {
                        return self.null_type;
                    }
                    return self.null_widening_type;
                }
                if includes.intersects(TypeFlags::UNDEFINED) {
                    if includes.intersects(TypeFlags::INCLUDES_NON_WIDENING_TYPE) {
                        return self.undefined_type;
                    }
                    return self.undefined_widening_type;
                }
                return self.never_type;
            }
        }
        if origin.is_nil() && includes.intersects(TypeFlags::UNION) {
            let named_unions = self.add_named_unions(Vec::new(), types);
            let mut reduced_types: Vec<TypeId> = Vec::new();
            for &t in &type_set {
                let mut contained = false;
                for &u in &named_unions {
                    let union_types = self.type_types(u);
                    if contains_type(self, union_types, t) {
                        contained = true;
                        break;
                    }
                }
                if !contained {
                    reduced_types.push(t);
                }
            }
            if alias.is_nil() && named_unions.len() == 1 && reduced_types.is_empty() {
                return at(&named_unions, 0);
            }
            // We create a denormalized origin type only when the union was created from one or more named unions (unions with alias symbols or origins) and when there is no overlap between those named unions.
            let mut named_types_count = 0usize;
            for &u in &named_unions {
                named_types_count += self.type_types(u).as_slice().len();
            }
            if named_types_count + reduced_types.len() == type_set.len() {
                for &t in &named_unions {
                    insert_type(self, &mut reduced_types, t);
                }
                // The origin union is made on every call, also when the keyed union is found afterwards: it takes a type id.
                let origin_types = if reduced_types.is_empty() {
                    List::NIL
                } else {
                    self.list_of(&reduced_types)
                };
                origin = self.new_union_type(ObjectFlags::NONE, origin_types);
            }
        }
        let primitive_union_flags = if includes.intersects(TypeFlags::NOT_PRIMITIVE_UNION) {
            ObjectFlags::NONE
        } else {
            ObjectFlags::PRIMITIVE_UNION
        };
        let contains_intersections_flags = if includes.intersects(TypeFlags::INTERSECTION) {
            ObjectFlags::CONTAINS_INTERSECTIONS
        } else {
            ObjectFlags::NONE
        };
        let object_flags = primitive_union_flags | contains_intersections_flags;
        self.get_union_type_from_sorted_list(
            List::from_slice(&type_set),
            object_flags,
            alias,
            origin,
        )
    }

    // This function assumes the constituent type list is sorted and deduplicated.
    pub fn get_union_type_from_sorted_list(
        &mut self,
        types: List<'_, TypeId>,
        precomputed_object_flags: ObjectFlags,
        alias: TypeAliasId,
        origin: TypeId,
    ) -> TypeId {
        let list = types.as_slice();
        if list.is_empty() {
            return self.never_type;
        }
        if let [only] = list {
            return *only;
        }
        let key = get_union_key(self, types, origin, alias);
        let mut t = self.union_types.get(&key);
        if t.is_nil() {
            let stored = self.list_of(list);
            let propagating = self.get_propagating_flags_of_types(stored, TypeFlags::NULLABLE);
            t = self.new_union_type(precomputed_object_flags | propagating, stored);
            self.as_union_type_mut(t).origin = origin;
            self.types[t].alias = alias;
            if let [first, second] = list {
                if self.types[*first]
                    .flags
                    .intersects(TypeFlags::BOOLEAN_LITERAL)
                    && self.types[*second]
                        .flags
                        .intersects(TypeFlags::BOOLEAN_LITERAL)
                {
                    self.types[t].flags |= TypeFlags::BOOLEAN;
                }
            }
            let ok = self.union_types.set(key, t);
            self.map_set(ok);
        }
        t
    }

    pub fn add_types_to_union(
        &mut self,
        source_types: List<'_, TypeId>,
    ) -> (Vec<TypeId>, TypeFlags) {
        fn add_type(c: &Checker<'_>, types: &mut Vec<TypeId>, includes: &mut TypeFlags, t: TypeId) {
            let flags = c.types[t].flags;
            // We ignore 'never' types in unions
            if flags.intersects(TypeFlags::NEVER) {
                return;
            }
            *includes |= flags & TypeFlags::INCLUDES_MASK;
            if flags.intersects(TypeFlags::INSTANTIABLE) {
                *includes |= TypeFlags::INCLUDES_INSTANTIABLE;
            }
            if flags.intersects(TypeFlags::INTERSECTION)
                && c.types[t]
                    .object_flags
                    .intersects(ObjectFlags::IS_CONSTRAINED_TYPE_VARIABLE)
            {
                *includes |= TypeFlags::INCLUDES_CONSTRAINED_TYPE_VARIABLE;
            }
            if t == c.wildcard_type {
                *includes |= TypeFlags::INCLUDES_WILDCARD;
            }
            if c.is_error_type(t) {
                *includes |= TypeFlags::INCLUDES_ERROR;
            }
            if !c.strict_null_checks && flags.intersects(TypeFlags::NULLABLE) {
                if !c.types[t]
                    .object_flags
                    .intersects(ObjectFlags::CONTAINS_WIDENING_TYPE)
                {
                    *includes |= TypeFlags::INCLUDES_NON_WIDENING_TYPE;
                }
                return;
            }
            types.push(t);
        }
        let mut types: Vec<TypeId> = Vec::with_capacity(source_types.as_slice().len());
        let mut includes = TypeFlags::NONE;
        let mut last_type = TypeId::NIL;
        for &t in source_types.as_slice() {
            if t != last_type {
                if self.types[t].flags.intersects(TypeFlags::UNION) {
                    let origin = self.as_union_type(t).origin;
                    if !self.types[t].alias.is_nil() || !origin.is_nil() {
                        includes |= TypeFlags::UNION;
                    }
                    let constituents = self.as_union_or_intersection_type(t).types;
                    for &s in constituents.as_slice() {
                        add_type(self, &mut types, &mut includes, s);
                    }
                } else {
                    add_type(self, &mut types, &mut includes, t);
                }
                last_type = t;
            }
        }
        if types.len() >= 2 {
            // Sort and deduplicate types
            sort_stable_func(&mut types, |t1, t2| compare_types(self, t1, t2));
            types.dedup();
        }
        (types, includes)
    }

    pub fn add_named_unions(
        &self,
        named_unions: Vec<TypeId>,
        types: List<'_, TypeId>,
    ) -> Vec<TypeId> {
        let mut named_unions = named_unions;
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return named_unions;
        }
        for &t in types.as_slice() {
            if self.types[t].flags.intersects(TypeFlags::UNION) {
                let origin = self.as_union_type(t).origin;
                if !self.types[t].alias.is_nil()
                    || !origin.is_nil() && !self.types[origin].flags.intersects(TypeFlags::UNION)
                {
                    if !named_unions.contains(&t) {
                        named_unions.push(t);
                    }
                } else if !origin.is_nil() && self.types[origin].flags.intersects(TypeFlags::UNION)
                {
                    named_unions = self.add_named_unions(named_unions, self.type_types(origin));
                }
            }
        }
        named_unions
    }

    pub fn remove_redundant_literal_types(
        &mut self,
        types: Vec<TypeId>,
        includes: TypeFlags,
        reduce_void_undefined: bool,
    ) -> Vec<TypeId> {
        let mut types = types;
        let mut i = types.len();
        while i > 0 {
            i -= 1;
            let t = at(&types, i);
            let flags = self.types[t].flags;
            let mut remove = flags.intersects(
                TypeFlags::STRING_LITERAL | TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING,
            ) && includes.intersects(TypeFlags::STRING)
                || flags.intersects(TypeFlags::NUMBER_LITERAL)
                    && includes.intersects(TypeFlags::NUMBER)
                || flags.intersects(TypeFlags::BIG_INT_LITERAL)
                    && includes.intersects(TypeFlags::BIG_INT)
                || flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL)
                    && includes.intersects(TypeFlags::ES_SYMBOL)
                || reduce_void_undefined
                    && flags.intersects(TypeFlags::UNDEFINED)
                    && includes.intersects(TypeFlags::VOID);
            if !remove && is_fresh_literal_type(self, t) {
                let regular_type = self.as_literal_type(t).regular_type;
                remove = contains_type(self, List::from_slice(&types), regular_type);
            }
            if remove {
                delete_at(&mut types, i);
            }
        }
        types
    }

    pub fn remove_string_literals_matched_by_template_literals(
        &mut self,
        types: Vec<TypeId>,
    ) -> Vec<TypeId> {
        let mut types = types;
        let templates: Vec<TypeId> = types
            .iter()
            .filter(|&&t| self.is_pattern_literal_type(t))
            .copied()
            .collect();
        if !templates.is_empty() {
            let mut i = types.len();
            while i > 0 {
                i -= 1;
                let t = at(&types, i);
                if self.types[t].flags.intersects(TypeFlags::STRING_LITERAL) {
                    let mut matched = false;
                    for &template in &templates {
                        if self.is_type_matched_by_template_literal_or_string_mapping(t, template) {
                            matched = true;
                            break;
                        }
                    }
                    if matched {
                        delete_at(&mut types, i);
                    }
                }
            }
        }
        types
    }

    pub fn is_type_matched_by_template_literal_or_string_mapping(
        &mut self,
        t: TypeId,
        template: TypeId,
    ) -> bool {
        if self.types[template]
            .flags
            .intersects(TypeFlags::TEMPLATE_LITERAL)
        {
            return self.is_type_matched_by_template_literal_type(
                t,
                template,
                TypeComparer::Assignable,
            );
        }
        self.is_member_of_string_mapping(t, template)
    }

    pub fn remove_constrained_type_variables(&mut self, types: Vec<TypeId>) -> Vec<TypeId> {
        let mut types = types;
        let mut type_variables: Vec<TypeId> = Vec::new();
        // First collect a list of the type variables occurring in constraining intersections.
        for &t in &types {
            if self.types[t].flags.intersects(TypeFlags::INTERSECTION)
                && self.types[t]
                    .object_flags
                    .intersects(ObjectFlags::IS_CONSTRAINED_TYPE_VARIABLE)
            {
                let constituents = self.as_union_or_intersection_type(t).types.as_slice();
                let mut index = 0;
                if !self.types[at(constituents, 0)]
                    .flags
                    .intersects(TypeFlags::TYPE_VARIABLE)
                {
                    index = 1;
                }
                let type_variable = at(constituents, index);
                if !type_variables.contains(&type_variable) {
                    type_variables.push(type_variable);
                }
            }
        }
        // For each type variable, check if the constraining intersections for that type variable fully cover the constraint of the type variable; if so, remove the constraining intersections and substitute the type variable.
        for &type_variable in &type_variables {
            let mut primitives: Vec<TypeId> = Vec::new();
            // First collect the primitive types from the constraining intersections.
            for &t in &types {
                if self.types[t].flags.intersects(TypeFlags::INTERSECTION)
                    && self.types[t]
                        .object_flags
                        .intersects(ObjectFlags::IS_CONSTRAINED_TYPE_VARIABLE)
                {
                    let constituents = self.as_union_or_intersection_type(t).types.as_slice();
                    let mut index = 0;
                    if !self.types[at(constituents, 0)]
                        .flags
                        .intersects(TypeFlags::TYPE_VARIABLE)
                    {
                        index = 1;
                    }
                    if at(constituents, index) == type_variable {
                        insert_type(self, &mut primitives, at(constituents, 1 - index));
                    }
                }
            }
            // If every constituent in the type variable's constraint is covered by an intersection of the type variable and that constituent, remove those intersections and substitute the type variable.
            let constraint = self.get_base_constraint_of_type(type_variable);
            if every_type(self, constraint, &mut |c, t| {
                contains_type(c, List::from_slice(&primitives), t)
            }) {
                let mut i = types.len();
                while i > 0 {
                    i -= 1;
                    let t = at(&types, i);
                    if self.types[t].flags.intersects(TypeFlags::INTERSECTION)
                        && self.types[t]
                            .object_flags
                            .intersects(ObjectFlags::IS_CONSTRAINED_TYPE_VARIABLE)
                    {
                        let constituents = self.as_union_or_intersection_type(t).types.as_slice();
                        let mut index = 0;
                        if !self.types[at(constituents, 0)]
                            .flags
                            .intersects(TypeFlags::TYPE_VARIABLE)
                        {
                            index = 1;
                        }
                        if at(constituents, index) == type_variable
                            && contains_type(
                                self,
                                List::from_slice(&primitives),
                                at(constituents, 1 - index),
                            )
                        {
                            delete_at(&mut types, i);
                        }
                    }
                }
                insert_type(self, &mut types, type_variable);
            }
        }
        types
    }

    // A nil result upstream is `None`: the union is too complex to represent.
    pub fn remove_subtypes(
        &mut self,
        types: Vec<TypeId>,
        has_object_types: bool,
    ) -> Option<Vec<TypeId>> {
        let mut types = types;
        // [] and [T] immediately reduce to [] and [T] respectively
        if types.len() < 2 {
            return Some(types);
        }
        let key = get_type_list_key(List::from_slice(&types));
        let cached = self.subtype_reduction_cache.get(&key);
        if !cached.is_nil() {
            return Some(cached.as_slice().to_vec());
        }
        // We assume that redundant primitive types have already been removed from the types array and that there are no any and unknown types in the array. Thus, the only possible supertypes for primitive types are empty object types, and if none of those are present we can exclude primitive types from the subtype check.
        let mut has_empty_object = false;
        if has_object_types {
            for &t in &types {
                if self.types[t].flags.intersects(TypeFlags::OBJECT)
                    && !self.is_generic_mapped_type(t)
                {
                    let resolved = self.resolve_structured_type_members(t);
                    if self.is_empty_resolved_type(resolved) {
                        has_empty_object = true;
                        break;
                    }
                }
            }
        }
        let length = types.len();
        let mut i = length;
        let mut count: usize = 0;
        while i > 0 {
            i -= 1;
            let source = at(&types, i);
            if has_empty_object
                || self.types[source]
                    .flags
                    .intersects(TypeFlags::STRUCTURED_OR_INSTANTIABLE)
            {
                // A type parameter with a union constraint may be a subtype of some union, but not a subtype of the individual constituents of that union. For example, `T extends A | B` is a subtype of `A | B`, but not a subtype of just `A` or just `B`. When we encounter such a type parameter, we therefore check if the type parameter is a subtype of a union of all the other types.
                if self.types[source]
                    .flags
                    .intersects(TypeFlags::TYPE_PARAMETER)
                {
                    let constraint = self.get_base_constraint_or_type(source);
                    if self.types[constraint].flags.intersects(TypeFlags::UNION) {
                        let never_type = self.never_type;
                        let others: Vec<TypeId> = types
                            .iter()
                            .map(|&t| if t == source { never_type } else { t })
                            .collect();
                        let union = self.get_union_type(List::from_slice(&others));
                        if self.is_type_related_to(source, union, RelationKind::StrictSubtype) {
                            delete_at(&mut types, i);
                        }
                        continue;
                    }
                }
                // Find the first property with a unit type, if any. When constituents have a property by the same name but of a different unit type, we can quickly disqualify them from subtype checks. This helps subtype reduction of large discriminated union types.
                let mut key_property = SymbolId::NIL;
                let mut key_property_type = TypeId::NIL;
                if self.types[source].flags.intersects(
                    TypeFlags::OBJECT
                        | TypeFlags::INTERSECTION
                        | TypeFlags::INSTANTIABLE_NON_PRIMITIVE,
                ) {
                    let properties = self.get_properties_of_type(source);
                    for &p in properties.as_slice() {
                        let property_type = self.get_type_of_symbol(p);
                        if is_unit_type(self, property_type) {
                            key_property = p;
                            break;
                        }
                    }
                }
                if !key_property.is_nil() {
                    let property_type = self.get_type_of_symbol(key_property);
                    key_property_type = self.get_regular_type_of_literal_type(property_type);
                }
                // The targets are the list as it is when the loop starts: the list changes only right before the loop is left.
                let target_count = types.len();
                for j in 0..target_count {
                    let target = at(&types, j);
                    if source != target {
                        if count == 100000 {
                            // After 100000 subtype checks we estimate the remaining amount of work by assuming the same ratio of checks per element. If the estimated number of remaining type checks is greater than 1M we deem the union type too complex to represent. This for example caps union types at 1000 unique object types.
                            let estimated_count = (count / (length - i)) * length;
                            if estimated_count > 1000000 {
                                let current_node = self.current_node;
                                self.error(
                                    current_node,
                                    diagnostics::EXPRESSION_PRODUCES_A_UNION_TYPE_THAT_IS_TOO_COMPLEX_TO_REPRESENT,
                                    &[],
                                );
                                return None;
                            }
                        }
                        count += 1;
                        if !key_property.is_nil()
                            && self.types[target].flags.intersects(
                                TypeFlags::OBJECT
                                    | TypeFlags::INTERSECTION
                                    | TypeFlags::INSTANTIABLE_NON_PRIMITIVE,
                            )
                        {
                            let name = self.ast.sym(key_property).name;
                            let t = self.get_type_of_property_of_type(target, name);
                            if !t.is_nil()
                                && is_unit_type(self, t)
                                && self.get_regular_type_of_literal_type(t) != key_property_type
                            {
                                continue;
                            }
                        }
                        if (source == self.empty_object_type
                            || source == self.unknown_empty_object_type)
                            && !self.types[target].symbol.is_nil()
                            && self.is_empty_anonymous_object_type(target)
                        {
                            continue;
                        }
                        if self.is_type_related_to(source, target, RelationKind::StrictSubtype) {
                            let source_target = self.get_target_type(source);
                            let target_target = self.get_target_type(target);
                            if !self.types[source_target]
                                .object_flags
                                .intersects(ObjectFlags::CLASS)
                                || !self.types[target_target]
                                    .object_flags
                                    .intersects(ObjectFlags::CLASS)
                                || self.is_type_derived_from(source, target)
                            {
                                delete_at(&mut types, i);
                                break;
                            }
                        }
                    }
                }
            }
        }
        let stored = self.list_of(&types);
        let ok = self.subtype_reduction_cache.set(key, stored);
        self.map_set(ok);
        Some(types)
    }

    pub fn intersect_types(&mut self, type1: TypeId, type2: TypeId) -> TypeId {
        if type1.is_nil() {
            return type2;
        }
        if type2.is_nil() {
            return type1;
        }
        self.get_intersection_type(List::from_slice(&[type1, type2]))
    }

    // We normalize combinations of intersection and union types based on the distributive property of the '&' operator. Specifically, because X & (A | B) is equivalent to X & A | X & B, we can transform intersection types with union type constituents into equivalent union types with intersection type constituents and effectively ensure that union types are always at the top level in type representations. We do not perform structural deduplication on intersection types. Intersection types are created only by the & type operator and we can't reduce those because we want to support recursive intersection types. For example, a type alias of the form "type List<T> = T & { next: List<T> }" cannot be reduced during its declaration. Also, unlike union types, the order of the constituent types is preserved in order that overload resolution for intersections of types with signatures can be deterministic.
    pub fn get_intersection_type(&mut self, types: List<'_, TypeId>) -> TypeId {
        self.get_intersection_type_ex(types, IntersectionFlags::NONE, TypeAliasId::NIL)
    }

    pub fn get_intersection_type_ex(
        &mut self,
        types: List<'_, TypeId>,
        flags: IntersectionFlags,
        alias: TypeAliasId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        // The ordered set of upstream is a list whose membership test is a scan: add appends, the caller tests contains.
        let mut type_set: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
        let includes = self.add_types_to_intersection(&mut type_set, TypeFlags::NONE, types);
        let mut object_flags = ObjectFlags::NONE;
        // An intersection type is considered empty if it contains the type never, or more than one unit type or, an object type and a nullable type (null or undefined), or a string-like type and a type known to be non-string-like, or a number-like type and a type known to be non-number-like, or a symbol-like type and a type known to be non-symbol-like, or a void-like type and a type known to be non-void-like, or a non-primitive type and a type known to be primitive.
        if includes.intersects(TypeFlags::NEVER) {
            if type_set.contains(&self.silent_never_type) {
                return self.silent_never_type;
            }
            return self.never_type;
        }
        if self.strict_null_checks
            && includes.intersects(TypeFlags::NULLABLE)
            && includes.intersects(
                TypeFlags::OBJECT | TypeFlags::NON_PRIMITIVE | TypeFlags::INCLUDES_EMPTY_OBJECT,
            )
            || includes.intersects(TypeFlags::NON_PRIMITIVE)
                && includes
                    .intersects(TypeFlags::DISJOINT_DOMAINS.without(TypeFlags::NON_PRIMITIVE))
            || includes.intersects(TypeFlags::STRING_LIKE)
                && includes.intersects(TypeFlags::DISJOINT_DOMAINS.without(TypeFlags::STRING_LIKE))
            || includes.intersects(TypeFlags::NUMBER_LIKE)
                && includes.intersects(TypeFlags::DISJOINT_DOMAINS.without(TypeFlags::NUMBER_LIKE))
            || includes.intersects(TypeFlags::BIG_INT_LIKE)
                && includes.intersects(TypeFlags::DISJOINT_DOMAINS.without(TypeFlags::BIG_INT_LIKE))
            || includes.intersects(TypeFlags::ES_SYMBOL_LIKE)
                && includes
                    .intersects(TypeFlags::DISJOINT_DOMAINS.without(TypeFlags::ES_SYMBOL_LIKE))
            || includes.intersects(TypeFlags::VOID_LIKE)
                && includes.intersects(TypeFlags::DISJOINT_DOMAINS.without(TypeFlags::VOID_LIKE))
        {
            return self.never_type;
        }
        if includes.intersects(TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING)
            && includes.intersects(TypeFlags::STRING_LITERAL)
        {
            let (reduced, is_empty_set) = self.extract_redundant_template_literals(type_set);
            type_set = reduced;
            if is_empty_set {
                return self.never_type;
            }
        }
        if includes.intersects(TypeFlags::ANY) {
            if includes.intersects(TypeFlags::INCLUDES_WILDCARD) {
                return self.wildcard_type;
            }
            if includes.intersects(TypeFlags::INCLUDES_ERROR) {
                return self.error_type;
            }
            return self.any_type;
        }
        if !self.strict_null_checks && includes.intersects(TypeFlags::NULLABLE) {
            if includes.intersects(TypeFlags::INCLUDES_EMPTY_OBJECT) {
                return self.never_type;
            }
            if includes.intersects(TypeFlags::UNDEFINED) {
                return self.undefined_type;
            }
            return self.null_type;
        }
        if includes.intersects(TypeFlags::STRING)
            && includes.intersects(
                TypeFlags::STRING_LITERAL | TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING,
            )
            || includes.intersects(TypeFlags::NUMBER)
                && includes.intersects(TypeFlags::NUMBER_LITERAL)
            || includes.intersects(TypeFlags::BIG_INT)
                && includes.intersects(TypeFlags::BIG_INT_LITERAL)
            || includes.intersects(TypeFlags::ES_SYMBOL)
                && includes.intersects(TypeFlags::UNIQUE_ES_SYMBOL)
            || includes.intersects(TypeFlags::VOID) && includes.intersects(TypeFlags::UNDEFINED)
            || includes.intersects(TypeFlags::INCLUDES_EMPTY_OBJECT)
                && includes.intersects(TypeFlags::DEFINITELY_NON_NULLABLE)
        {
            if !flags.intersects(IntersectionFlags::NO_SUPERTYPE_REDUCTION) {
                type_set = self.remove_redundant_supertypes(type_set, includes);
            }
        }
        if includes.intersects(TypeFlags::INCLUDES_MISSING_TYPE) {
            let undefined_type = self.undefined_type;
            let missing_type = self.missing_type;
            match type_set.iter_mut().find(|t| **t == undefined_type) {
                Some(slot) => *slot = missing_type,
                None => {
                    let _: () = self.fail("index out of range [-1]");
                }
            }
        }
        if type_set.is_empty() {
            return self.unknown_type;
        }
        if type_set.len() == 1 {
            return at(&type_set, 0);
        }
        if type_set.len() == 2 && !flags.intersects(IntersectionFlags::NO_CONSTRAINT_REDUCTION) {
            let mut type_var_index = 0;
            if !self.types[at(&type_set, 0)]
                .flags
                .intersects(TypeFlags::TYPE_VARIABLE)
            {
                type_var_index = 1;
            }
            let type_variable = at(&type_set, type_var_index);
            let primitive_type = at(&type_set, 1 - type_var_index);
            if self.types[type_variable]
                .flags
                .intersects(TypeFlags::TYPE_VARIABLE)
                && (self.types[primitive_type]
                    .flags
                    .intersects(TypeFlags::PRIMITIVE | TypeFlags::NON_PRIMITIVE)
                    && !self.is_generic_string_like_type(primitive_type)
                    || includes.intersects(TypeFlags::INCLUDES_EMPTY_OBJECT))
            {
                // We have an intersection T & P or P & T, where T is a type variable and P is a primitive type, the object type, or {}.
                let constraint = self.get_base_constraint_of_type(type_variable);
                // Check that T's constraint is similarly composed of primitive types, the object type, or {}.
                if !constraint.is_nil()
                    && every_type(self, constraint, &mut |c, t| {
                        c.is_primitive_or_object_or_empty_type(t)
                    })
                {
                    // If T's constraint is a subtype of P, simply return T. For example, given `T extends "a" | "b"`, the intersection `T & string` reduces to just T.
                    if self.is_type_strict_subtype_of(constraint, primitive_type) {
                        return type_variable;
                    }
                    if !(self.types[constraint].flags.intersects(TypeFlags::UNION)
                        && some_type(self, constraint, &mut |c, n| {
                            c.is_type_strict_subtype_of(n, primitive_type)
                        }))
                    {
                        // No constituent of T's constraint is a subtype of P. If P is also not a subtype of T's constraint, then the constraint and P are unrelated, and the intersection reduces to never. For example, given `T extends "a" | "b"`, the intersection `T & number` reduces to never.
                        if !self.is_type_strict_subtype_of(primitive_type, constraint) {
                            return self.never_type;
                        }
                    }
                    // Some constituent of T's constraint is a subtype of P, or P is a subtype of T's constraint. Thus, the intersection further constrains the type variable. For example, given `T extends string | number`, the intersection `T & "a"` is marked as a constrained type variable. Likewise, given `T extends "a" | 1`, the intersection `T & number` is marked as a constrained type variable.
                    object_flags = ObjectFlags::IS_CONSTRAINED_TYPE_VARIABLE;
                }
            }
        }
        // The key is made from the type set before the branches below edit the set in place.
        let key = get_intersection_key(self, List::from_slice(&type_set), flags, alias);
        let mut result = self.intersection_types.get(&key);
        if result.is_nil() {
            if includes.intersects(TypeFlags::UNION) {
                let (reduced_set, reduced) = self.intersect_unions_of_primitive_types(type_set);
                type_set = reduced_set;
                if reduced {
                    // When the intersection creates a reduced set (which might mean that *all* union types have disappeared), we restart the operation to get a new set of combined flags. Once we have reduced we'll never reduce again, so this occurs at most once.
                    result =
                        self.get_intersection_type_ex(List::from_slice(&type_set), flags, alias);
                } else if type_set.iter().all(|&t| is_union_with_undefined(self, t)) {
                    let mut contained_undefined_type = self.undefined_type;
                    let mut contains_missing = false;
                    for &t in &type_set {
                        if self.contains_missing_type(t) {
                            contains_missing = true;
                            break;
                        }
                    }
                    if contains_missing {
                        contained_undefined_type = self.missing_type;
                    }
                    self.filter_types(&mut type_set, &mut |c, t| is_not_undefined_type(c, t));
                    let intersection = self.get_intersection_type_ex(
                        List::from_slice(&type_set),
                        flags,
                        TypeAliasId::NIL,
                    );
                    result = self.get_union_type_ex(
                        List::from_slice(&[intersection, contained_undefined_type]),
                        UnionReduction::LITERAL,
                        alias,
                        TypeId::NIL,
                    );
                } else if type_set.iter().all(|&t| is_union_with_null(self, t)) {
                    self.filter_types(&mut type_set, &mut |c, t| is_not_null_type(c, t));
                    let intersection = self.get_intersection_type_ex(
                        List::from_slice(&type_set),
                        flags,
                        TypeAliasId::NIL,
                    );
                    let null_type = self.null_type;
                    result = self.get_union_type_ex(
                        List::from_slice(&[intersection, null_type]),
                        UnionReduction::LITERAL,
                        alias,
                        TypeId::NIL,
                    );
                } else if type_set.len() >= 3 && types.as_slice().len() > 2 {
                    // When we have three or more constituents, more than two inputs (to head off infinite reexpansion), some of which are unions, we employ a "divide and conquer" strategy where A & B & C & D is processed as (A & B) & (C & D). Since intersections of unions often produce far smaller unions of intersections than the full cartesian product (due to some intersections becoming `never`), this can dramatically reduce the overall work.
                    let middle = type_set.len() / 2;
                    let (left_types, right_types) = type_set.split_at(middle);
                    let left = self.get_intersection_type_ex(
                        List::from_slice(left_types),
                        flags,
                        TypeAliasId::NIL,
                    );
                    let right = self.get_intersection_type_ex(
                        List::from_slice(right_types),
                        flags,
                        TypeAliasId::NIL,
                    );
                    result = self.get_intersection_type_ex(
                        List::from_slice(&[left, right]),
                        flags,
                        alias,
                    );
                } else {
                    // We are attempting to construct a type of the form X & (A | B) & (C | D). Transform this into a type of the form X & A & C | X & A & D | X & B & C | X & B & D. If the estimated size of the resulting union type exceeds 100000 constituents, report an error.
                    if !self.check_cross_product_union(List::from_slice(&type_set)) {
                        return self.error_type;
                    }
                    let constituents =
                        self.get_cross_product_intersections(List::from_slice(&type_set), flags);
                    // We attach a denormalized origin type when at least one constituent of the cross-product union is an intersection (i.e. when the intersection didn't just reduce one or more unions to smaller unions) and the denormalized origin has fewer constituents than the union itself.
                    let mut origin = TypeId::NIL;
                    if constituents.iter().any(|&t| is_intersection_type(self, t))
                        && get_constituent_count_of_types(self, List::from_slice(&constituents))
                            > get_constituent_count_of_types(self, List::from_slice(&type_set))
                    {
                        let origin_types = self.list_of(&type_set);
                        origin = self.new_intersection_type(ObjectFlags::NONE, origin_types);
                    }
                    result = self.get_union_type_ex(
                        List::from_slice(&constituents),
                        UnionReduction::LITERAL,
                        alias,
                        origin,
                    );
                }
            } else {
                // The propagating flags are read from the input list, not from the reduced type set.
                let input_types = self.list_of(types.as_slice());
                let propagating =
                    self.get_propagating_flags_of_types(input_types, TypeFlags::NULLABLE);
                let stored = self.list_of(&type_set);
                result = self.new_intersection_type(object_flags | propagating, stored);
                self.types[result].alias = alias;
            }
            let ok = self.intersection_types.set(key, result);
            self.map_set(ok);
        }
        result
    }
}

pub fn is_union_with_undefined(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].flags.intersects(TypeFlags::UNION)
        && c.types[at(c.type_types(t).as_slice(), 0)]
            .flags
            .intersects(TypeFlags::UNDEFINED)
}

pub fn is_union_with_null(c: &Checker<'_>, t: TypeId) -> bool {
    if !c.types[t].flags.intersects(TypeFlags::UNION) {
        return false;
    }
    let types = c.type_types(t).as_slice();
    c.types[at(types, 0)].flags.intersects(TypeFlags::NULL)
        || c.types[at(types, 1)].flags.intersects(TypeFlags::NULL)
}

pub fn is_intersection_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].flags.intersects(TypeFlags::INTERSECTION)
}

pub fn is_primitive_union(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t]
        .object_flags
        .intersects(ObjectFlags::PRIMITIVE_UNION)
}

pub fn is_not_undefined_type(c: &Checker<'_>, t: TypeId) -> bool {
    !c.types[t].flags.intersects(TypeFlags::UNDEFINED)
}

pub fn is_not_null_type(c: &Checker<'_>, t: TypeId) -> bool {
    !c.types[t].flags.intersects(TypeFlags::NULL)
}

impl<'a> Checker<'a> {
    // Add the given types to the given type set. Order is preserved, freshness is removed from literal types, duplicates are removed, and nested types of the given kind are flattened into the set.
    pub fn add_types_to_intersection(
        &mut self,
        type_set: &mut Vec<TypeId>,
        includes: TypeFlags,
        types: List<'_, TypeId>,
    ) -> TypeFlags {
        let mut includes = includes;
        for &t in types.as_slice() {
            let regular_type = self.get_regular_type_of_literal_type(t);
            includes = self.add_type_to_intersection(type_set, includes, regular_type);
        }
        includes
    }

    pub fn add_type_to_intersection(
        &mut self,
        type_set: &mut Vec<TypeId>,
        includes: TypeFlags,
        t: TypeId,
    ) -> TypeFlags {
        let mut includes = includes;
        let mut t = t;
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return includes;
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.type_types(t);
            return self.add_types_to_intersection(type_set, includes, types);
        }
        if self.is_empty_anonymous_object_type(t) {
            if !includes.intersects(TypeFlags::INCLUDES_EMPTY_OBJECT) {
                includes |= TypeFlags::INCLUDES_EMPTY_OBJECT;
                type_set.push(t);
            }
        } else {
            if flags.intersects(TypeFlags::ANY_OR_UNKNOWN) {
                if t == self.wildcard_type {
                    includes |= TypeFlags::INCLUDES_WILDCARD;
                }
                if self.is_error_type(t) {
                    includes |= TypeFlags::INCLUDES_ERROR;
                }
            } else if self.strict_null_checks || !flags.intersects(TypeFlags::NULLABLE) {
                if t == self.missing_type {
                    includes |= TypeFlags::INCLUDES_MISSING_TYPE;
                    t = self.undefined_type;
                }
                if !type_set.contains(&t) {
                    if self.types[t].flags.intersects(TypeFlags::UNIT)
                        && includes.intersects(TypeFlags::UNIT)
                    {
                        // We have seen two distinct unit types which means we should reduce to an empty intersection. Adding TypeFlags.NonPrimitive causes that to happen.
                        includes |= TypeFlags::NON_PRIMITIVE;
                    }
                    type_set.push(t);
                }
            }
            includes |= flags & TypeFlags::INCLUDES_MASK;
        }
        includes
    }

    pub fn remove_redundant_supertypes(
        &mut self,
        types: Vec<TypeId>,
        includes: TypeFlags,
    ) -> Vec<TypeId> {
        let mut types = types;
        let mut i = types.len();
        while i > 0 {
            i -= 1;
            let t = at(&types, i);
            let flags = self.types[t].flags;
            let remove = flags.intersects(TypeFlags::STRING)
                && includes.intersects(
                    TypeFlags::STRING_LITERAL
                        | TypeFlags::TEMPLATE_LITERAL
                        | TypeFlags::STRING_MAPPING,
                )
                || flags.intersects(TypeFlags::NUMBER)
                    && includes.intersects(TypeFlags::NUMBER_LITERAL)
                || flags.intersects(TypeFlags::BIG_INT)
                    && includes.intersects(TypeFlags::BIG_INT_LITERAL)
                || flags.intersects(TypeFlags::ES_SYMBOL)
                    && includes.intersects(TypeFlags::UNIQUE_ES_SYMBOL)
                || flags.intersects(TypeFlags::VOID) && includes.intersects(TypeFlags::UNDEFINED)
                || self.is_empty_anonymous_object_type(t)
                    && includes.intersects(TypeFlags::DEFINITELY_NON_NULLABLE);
            if remove {
                delete_at(&mut types, i);
            }
        }
        types
    }

    // Returns true if the intersection of the template literals and string literals is the empty set, for example `get${string}` & "setX", and should reduce to never.
    pub fn extract_redundant_template_literals(
        &mut self,
        types: Vec<TypeId>,
    ) -> (Vec<TypeId>, bool) {
        let mut types = types;
        let literals: Vec<TypeId> = types
            .iter()
            .filter(|&&t| self.types[t].flags.intersects(TypeFlags::STRING_LITERAL))
            .copied()
            .collect();
        let mut i = types.len();
        while i > 0 {
            i -= 1;
            let t = at(&types, i);
            if !self.types[t]
                .flags
                .intersects(TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING)
            {
                continue;
            }
            for &t2 in &literals {
                if self.is_type_subtype_of(t2, t) {
                    // For example, `get${T}` & "getX" is just "getX", and Lowercase<string> & "foo" is just "foo"
                    delete_at(&mut types, i);
                    break;
                }
                if self.is_pattern_literal_type(t) {
                    return (types, true);
                }
            }
        }
        (types, false)
    }

    // If the given list of types contains more than one union of primitive types, replace the first with a union containing an intersection of those primitive types, then remove the other unions and return true. Otherwise, do nothing and return false.
    pub fn intersect_unions_of_primitive_types(
        &mut self,
        types: Vec<TypeId>,
    ) -> (Vec<TypeId>, bool) {
        let mut types = types;
        let Some(index) = types.iter().position(|&t| is_primitive_union(self, t)) else {
            return (types, false);
        };
        // Remove all but the first union of primitive types and collect them in the unionTypes array.
        let mut i = index + 1;
        let mut union_types: Vec<TypeId> = vec![at(&types, index)];
        while i < types.len() {
            let t = at(&types, i);
            if self.types[t]
                .object_flags
                .intersects(ObjectFlags::PRIMITIVE_UNION)
            {
                union_types.push(t);
                delete_at(&mut types, i);
            } else {
                i += 1;
            }
        }
        // Return false if there was only one union of primitive types
        if union_types.len() == 1 {
            return (types, false);
        }
        // We have more than one union of primitive types, now intersect them. For each type in each union we check if the type is matched in every union and if so we include it in the result.
        let mut checked: Vec<TypeId> = Vec::new();
        let mut result: Vec<TypeId> = Vec::new();
        for &u in &union_types {
            let constituents = self.type_types(u);
            for &t in constituents.as_slice() {
                if insert_type(self, &mut checked, t) {
                    if self.each_union_contains(List::from_slice(&union_types), t) {
                        // undefinedType/missingType are always sorted first so we leverage that here
                        if t == self.undefined_type
                            && !result.is_empty()
                            && at(&result, 0) == self.missing_type
                        {
                            continue;
                        }
                        if t == self.missing_type
                            && !result.is_empty()
                            && at(&result, 0) == self.undefined_type
                        {
                            let missing_type = self.missing_type;
                            if let Some(first) = result.first_mut() {
                                *first = missing_type;
                            }
                            continue;
                        }
                        insert_type(self, &mut result, t);
                    }
                }
            }
        }
        // Finally replace the first union with the result
        let union = self.get_union_type_from_sorted_list(
            List::from_slice(&result),
            ObjectFlags::PRIMITIVE_UNION,
            TypeAliasId::NIL,
            TypeId::NIL,
        );
        if let Some(slot) = types.get_mut(index) {
            *slot = union;
        }
        (types, true)
    }

    // Check that the given type has a match in every union. A given type is matched by an identical type, and a literal type is additionally matched by its corresponding primitive type, and missingType is matched by undefinedType (and vice versa).
    pub fn each_union_contains(&mut self, union_types: List<'_, TypeId>, t: TypeId) -> bool {
        for &u in union_types.as_slice() {
            if !self.union_contains_type(u, t, true) {
                return false;
            }
        }
        true
    }

    pub fn union_contains_type(&mut self, union: TypeId, t: TypeId, match_symbol: bool) -> bool {
        let types = self.type_types(union);
        if contains_type(self, types, t) {
            return true;
        }
        if t == self.missing_type {
            let undefined_type = self.undefined_type;
            return contains_type(self, types, undefined_type);
        }
        if t == self.undefined_type {
            let missing_type = self.missing_type;
            return contains_type(self, types, missing_type);
        }
        let flags = self.types[t].flags;
        let mut primitive = TypeId::NIL;
        if flags.intersects(TypeFlags::STRING_LITERAL) {
            primitive = self.string_type;
        } else if flags.intersects(TypeFlags::ENUM | TypeFlags::NUMBER_LITERAL) {
            primitive = self.number_type;
        } else if flags.intersects(TypeFlags::BIG_INT_LITERAL) {
            primitive = self.bigint_type;
        } else if flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) && match_symbol {
            primitive = self.es_symbol_type;
        }
        !primitive.is_nil() && contains_type(self, types, primitive)
    }

    pub fn get_cross_product_intersections(
        &mut self,
        types: List<'_, TypeId>,
        flags: IntersectionFlags,
    ) -> Vec<TypeId> {
        let count = self.get_cross_product_union_size(types);
        let mut intersections: Vec<TypeId> = Vec::new();
        let mut i: isize = 0;
        while i < count {
            let mut constituents: Vec<TypeId> = types.as_slice().to_vec();
            let mut n = i;
            for j in (0..types.as_slice().len()).rev() {
                let t = at(types.as_slice(), j);
                if self.types[t].flags.intersects(TypeFlags::UNION) {
                    let source_types = self.type_types(t).as_slice();
                    let length = source_types.len() as isize;
                    // A union has two or more constituents: the guard keeps a zero length from dividing.
                    if length > 0 {
                        if let Some(slot) = constituents.get_mut(j) {
                            *slot = at(source_types, (n % length) as usize);
                        }
                        n /= length;
                    }
                }
            }
            let t = self.get_intersection_type_ex(
                List::from_slice(&constituents),
                flags,
                TypeAliasId::NIL,
            );
            if !self.types[t].flags.intersects(TypeFlags::NEVER) {
                intersections.push(t);
            }
            i += 1;
        }
        intersections
    }
}

pub fn get_constituent_count(c: &Checker<'_>, t: TypeId) -> isize {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    if !c.types[t]
        .flags
        .intersects(TypeFlags::UNION_OR_INTERSECTION)
        || !c.types[t].alias.is_nil()
    {
        return 1;
    }
    if c.types[t].flags.intersects(TypeFlags::UNION) {
        let origin = c.as_union_type(t).origin;
        if !origin.is_nil() {
            return get_constituent_count(c, origin);
        }
    }
    get_constituent_count_of_types(c, c.type_types(t))
}

pub fn get_constituent_count_of_types(c: &Checker<'_>, types: List<'_, TypeId>) -> isize {
    let mut n = 0;
    for &t in types.as_slice() {
        n += get_constituent_count(c, t);
    }
    n
}

impl<'a> Checker<'a> {
    pub fn filter_types(
        &mut self,
        types: &mut [TypeId],
        predicate: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
    ) {
        for slot in types.iter_mut() {
            *slot = self.filter_type(*slot, predicate);
        }
    }

    pub fn is_empty_anonymous_object_type(&mut self, t: TypeId) -> bool {
        if !self.types[t]
            .object_flags
            .intersects(ObjectFlags::ANONYMOUS)
        {
            return false;
        }
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::MEMBERS_RESOLVED)
            && self.is_empty_resolved_type(t)
        {
            return true;
        }
        let symbol = self.types[t].symbol;
        if !symbol.is_nil()
            && self
                .ast
                .sym(symbol)
                .flags
                .intersects(SymbolFlags::TYPE_LITERAL)
        {
            let members = self.get_members_of_symbol(symbol);
            return self.ast.table_len(members) == 0;
        }
        false
    }

    // `t` is the type whose structured part upstream receives.
    pub fn is_empty_resolved_type(&self, t: TypeId) -> bool {
        if t == self.any_function_type {
            return false;
        }
        let resolved = self.as_structured_type(t);
        resolved.properties.as_slice().is_empty()
            && resolved.signatures.as_slice().is_empty()
            && resolved.index_infos.as_slice().is_empty()
    }

    pub fn is_empty_object_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::OBJECT) {
            if self.is_generic_mapped_type(t) {
                return false;
            }
            let resolved = self.resolve_structured_type_members(t);
            return self.is_empty_resolved_type(resolved);
        }
        if flags.intersects(TypeFlags::NON_PRIMITIVE) {
            return true;
        }
        if flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(t);
            for &s in types.as_slice() {
                if self.is_empty_object_type(s) {
                    return true;
                }
            }
            return false;
        }
        if flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.type_types(t);
            for &s in types.as_slice() {
                if !self.is_empty_object_type(s) {
                    return false;
                }
            }
            return true;
        }
        false
    }

    pub fn is_pattern_literal_placeholder_type(&self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            // Return true if the intersection consists of one or more placeholders and zero or more object type tags.
            let mut seen_placeholder = false;
            for &s in self.type_types(t).as_slice() {
                if self.types[s]
                    .flags
                    .intersects(TypeFlags::LITERAL | TypeFlags::NULLABLE)
                    || self.is_pattern_literal_placeholder_type(s)
                {
                    seen_placeholder = true;
                } else if !self.types[s].flags.intersects(TypeFlags::OBJECT) {
                    return false;
                }
            }
            return seen_placeholder;
        }
        self.types[t]
            .flags
            .intersects(TypeFlags::ANY | TypeFlags::STRING | TypeFlags::NUMBER | TypeFlags::BIG_INT)
            || self.is_pattern_literal_type(t)
    }

    pub fn is_pattern_literal_type(&self, t: TypeId) -> bool {
        // A pattern literal type is a template literal or a string mapping type that contains only non-generic pattern literal placeholders.
        self.types[t].flags.intersects(TypeFlags::TEMPLATE_LITERAL)
            && self
                .as_template_literal_type(t)
                .types
                .as_slice()
                .iter()
                .all(|&s| self.is_pattern_literal_placeholder_type(s))
            || self.types[t].flags.intersects(TypeFlags::STRING_MAPPING)
                && self.is_pattern_literal_placeholder_type(self.as_string_mapping_type(t).target)
    }

    pub fn is_generic_string_like_type(&self, t: TypeId) -> bool {
        self.types[t]
            .flags
            .intersects(TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING)
            && !self.is_pattern_literal_type(t)
    }
}

pub fn for_each_type<'a>(
    c: &mut Checker<'a>,
    t: TypeId,
    f: &mut dyn FnMut(&mut Checker<'a>, TypeId),
) {
    if c.types[t].flags.intersects(TypeFlags::UNION) {
        let types = c.type_types(t);
        for &u in types.as_slice() {
            f(c, u);
        }
    } else {
        f(c, t);
    }
}

pub fn some_type<'a>(
    c: &mut Checker<'a>,
    t: TypeId,
    f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
) -> bool {
    if c.types[t].flags.intersects(TypeFlags::UNION) {
        let types = c.type_types(t);
        for &u in types.as_slice() {
            if f(c, u) {
                return true;
            }
        }
        return false;
    }
    f(c, t)
}

pub fn every_type<'a>(
    c: &mut Checker<'a>,
    t: TypeId,
    f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
) -> bool {
    if c.types[t].flags.intersects(TypeFlags::UNION) {
        let types = c.type_types(t);
        for &u in types.as_slice() {
            if !f(c, u) {
                return false;
            }
        }
        return true;
    }
    f(c, t)
}

pub fn every_contained_type<'a>(
    c: &mut Checker<'a>,
    t: TypeId,
    f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
) -> bool {
    if c.types[t]
        .flags
        .intersects(TypeFlags::UNION_OR_INTERSECTION)
    {
        let types = c.type_types(t);
        for &u in types.as_slice() {
            if !f(c, u) {
                return false;
            }
        }
        return true;
    }
    f(c, t)
}

impl<'a> Checker<'a> {
    pub fn filter_type(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
    ) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(t).as_slice();
            let mut filtered: Vec<TypeId> = Vec::with_capacity(types.len());
            for &u in types {
                if f(self, u) {
                    filtered.push(u);
                }
            }
            // core.Filter returns its argument when nothing is removed, and core.Same then answers true.
            if filtered.len() == types.len() {
                return t;
            }
            let origin = self.as_union_type(t).origin;
            let mut new_origin = TypeId::NIL;
            if !origin.is_nil() && self.types[origin].flags.intersects(TypeFlags::UNION) {
                // If the origin type is a (denormalized) union type, filter its non-union constituents. If that ends up removing a smaller number of types than in the normalized constituent set (meaning some of the filtered types are within nested unions in the origin), then we can't construct a new origin type. Otherwise, if we have exactly one type left in the origin set, return that as the filtered type. Otherwise, construct a new filtered origin type.
                let origin_types = self.type_types(origin).as_slice();
                let mut origin_filtered: Vec<TypeId> = Vec::with_capacity(origin_types.len());
                for &u in origin_types {
                    if self.types[u].flags.intersects(TypeFlags::UNION) || f(self, u) {
                        origin_filtered.push(u);
                    }
                }
                if origin_types.len() - origin_filtered.len() == types.len() - filtered.len() {
                    if origin_filtered.len() == 1 {
                        return at(&origin_filtered, 0);
                    }
                    // The new origin is made before the union is looked up: it takes a type id on every call.
                    let origin_list = self.list_of(&origin_filtered);
                    new_origin = self.new_union_type(ObjectFlags::NONE, origin_list);
                }
            }
            // filtering could remove intersections so `ContainsIntersections` might be forwarded "incorrectly": it is purely an optimization hint so there is no harm in accidentally forwarding it
            let object_flags = self.types[t].object_flags
                & (ObjectFlags::PRIMITIVE_UNION | ObjectFlags::CONTAINS_INTERSECTIONS);
            return self.get_union_type_from_sorted_list(
                List::from_slice(&filtered),
                object_flags,
                TypeAliasId::NIL,
                new_origin,
            );
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) || f(self, t) {
            return t;
        }
        self.never_type
    }

    pub fn remove_type(&mut self, t: TypeId, target_type: TypeId) -> TypeId {
        if !self.types[t].flags.intersects(TypeFlags::UNION) {
            if t == target_type {
                return self.never_type;
            }
            return t;
        }
        let origin = self.as_union_type(t).origin;
        if !origin.is_nil() && self.types[origin].flags.intersects(TypeFlags::UNION) {
            let origin_types = self.type_types(origin);
            if contains_type(self, origin_types, target_type) {
                return self.filter_type(t, &mut |_, u| u != target_type);
            }
        }
        let types = self.type_types(t).as_slice();
        let (i, ok) = binary_search_types(self, types, target_type);
        if ok {
            if types.len() == 2 {
                return at(types, if i == 0 { 1 } else { 0 });
            }
            // Remove the target type from the slice.
            let filtered: Vec<TypeId> = types
                .iter()
                .enumerate()
                .filter(|&(j, _)| j != i)
                .map(|(_, &u)| u)
                .collect();
            let object_flags = self.types[t].object_flags
                & (ObjectFlags::PRIMITIVE_UNION | ObjectFlags::CONTAINS_INTERSECTIONS);
            return self.get_union_type_from_sorted_list(
                List::from_slice(&filtered),
                object_flags,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
        }
        t
    }
}

pub fn contains_type(c: &mut Checker<'_>, types: List<'_, TypeId>, t: TypeId) -> bool {
    let (_, ok) = binary_search_types(c, types.as_slice(), t);
    ok
}

// Upstream returns the list and whether the type was inserted: the list is edited in place here.
pub fn insert_type(c: &mut Checker<'_>, types: &mut Vec<TypeId>, t: TypeId) -> bool {
    let (i, ok) = binary_search_types(c, types, t);
    if !ok {
        types.insert(i.min(types.len()), t);
        return true;
    }
    false
}

pub fn count_types(c: &Checker<'_>, t: TypeId) -> isize {
    let flags = c.types[t].flags;
    if flags.intersects(TypeFlags::UNION) {
        return c.type_types(t).as_slice().len() as isize;
    }
    if flags.intersects(TypeFlags::NEVER) {
        return 0;
    }
    1
}

impl<'a> Checker<'a> {
    pub fn is_error_type(&self, t: TypeId) -> bool {
        // The only 'any' types that have alias symbols are those manufactured by getTypeFromTypeAliasReference for a reference to an unresolved symbol. We want those to behave like the errorType.
        t == self.error_type
            || self.types[t].flags.intersects(TypeFlags::ANY) && !self.types[t].alias.is_nil()
    }
}

pub fn compare_type_ids(t1: TypeId, t2: TypeId) -> isize {
    t1.0 as isize - t2.0 as isize
}

impl<'a> Checker<'a> {
    pub fn check_cross_product_union(&mut self, types: List<'_, TypeId>) -> bool {
        let size = self.get_cross_product_union_size(types);
        if size >= 100_000 {
            let current_node = self.current_node;
            self.error(
                current_node,
                diagnostics::EXPRESSION_PRODUCES_A_UNION_TYPE_THAT_IS_TOO_COMPLEX_TO_REPRESENT,
                &[],
            );
            return false;
        }
        true
    }

    pub fn get_cross_product_union_size(&self, types: List<'_, TypeId>) -> isize {
        let mut size: isize = 1;
        for &t in types.as_slice() {
            let flags = self.types[t].flags;
            if flags.intersects(TypeFlags::UNION) {
                let n = self.type_types(t).as_slice().len() as isize;
                // Cap the result to avoid integer overflow when computing the cross product of many large unions: a number overflow in TypeScript produces Infinity, which naturally exceeds the limit check.
                if n > 0 && size > isize::MAX / n {
                    return isize::MAX;
                }
                size *= n;
            } else if flags.intersects(TypeFlags::NEVER) {
                return 0;
            }
        }
        size
    }
}

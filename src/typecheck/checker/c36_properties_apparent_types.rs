// checker.go:21513-22212 (layers T-LOOKUP, T-UIMEMBERS, T-APPARENT, T-INSTANTIATE, T-CONSTRAINT, T-MEMBERS): the property of an object type, properties of union and intersection types, apparent and reduced types, the type arguments of a type reference, effective type arguments and type parameter defaults, and the named members of a symbol table.
use crate::ast::{
    Arg, Ast, CheckFlags, DiagnosticId, Kind, ModifierFlags, NodeId, SymbolFlags, SymbolId,
    SymbolTableId, get_symbol_table, is_in_js_file, is_type_parameter_declaration,
};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, IndexInfoId, MappedTypeModifiers, ObjectFlags, Ternary,
    TypeFlags, TypeFormatFlags, TypeId, TypeMapperId, TypeSystemEntity, TypeSystemPropertyName,
    compare_types_equal, every_type, get_declaration_modifier_flags_from_symbol,
    get_mapped_type_modifiers, is_late_bound_name, is_literal_type, is_object_literal_type,
    is_reserved_member_name, is_tuple_type, new_type_mapper, prepend_type_mapping,
};
use crate::collections::{OrderedSet, Set};
use crate::core::{List, find, first_non_nil, same, some};
use crate::diagnostics;

impl<'a> Checker<'a> {
    // If the given type is an object type and that type has a property by the given name, return the symbol for that property. Otherwise return undefined.
    pub fn get_property_of_object_type(&mut self, t: TypeId, name: &[u8]) -> SymbolId {
        if self.types[t].flags.intersects(TypeFlags::OBJECT) {
            let resolved = self.resolve_structured_type_members(t);
            let members = self.as_structured_type(resolved).members;
            let symbol = self.ast.table_get(members, name);
            if !symbol.is_nil() && self.symbol_is_value(symbol) {
                return symbol;
            }
        }
        SymbolId::NIL
    }

    pub fn get_property_of_union_or_intersection_type(
        &mut self,
        t: TypeId,
        name: &[u8],
        skip_object_function_property_augment: bool,
    ) -> SymbolId {
        let prop =
            self.get_union_or_intersection_property(t, name, skip_object_function_property_augment);
        // We need to filter out partial properties in union types
        if !prop.is_nil()
            && self
                .ast
                .sym(prop)
                .check_flags
                .intersects(CheckFlags::READ_PARTIAL)
        {
            return SymbolId::NIL;
        }
        prop
    }

    // Return the symbol for a given property in a union or intersection type, or undefined if the property does not exist in any constituent type. Note that the returned property may only be present in some constituents, in which case the isPartial flag is set when the containing type is union type. We need these partial properties when identifying discriminant properties, but otherwise they are filtered out and do not appear to be present in the union type.
    pub fn get_union_or_intersection_property(
        &mut self,
        t: TypeId,
        name: &[u8],
        skip_object_function_property_augment: bool,
    ) -> SymbolId {
        let a = self.ast;
        let cache = if skip_object_function_property_augment {
            get_symbol_table(
                a,
                &mut self
                    .as_union_or_intersection_type_mut(t)
                    .property_cache_without_function_property_augment,
            )
        } else {
            get_symbol_table(
                a,
                &mut self.as_union_or_intersection_type_mut(t).property_cache,
            )
        };
        let prop = a.table_get(cache, name);
        if !prop.is_nil() {
            return prop;
        }
        let prop = self.create_union_or_intersection_property(
            t,
            name,
            skip_object_function_property_augment,
        );
        if !prop.is_nil() {
            // The key of a table lives as long as the table: the name of the property when it is the requested name, else a copy.
            let prop_name = a.sym(prop).name;
            let key = if prop_name == name {
                prop_name
            } else {
                self.text(name)
            };
            a.table_set(cache, key, prop);
            // Propagate an entry from the non-augmented cache to the augmented cache unless the property is partial.
            if skip_object_function_property_augment
                && !a.sym(prop).check_flags.intersects(CheckFlags::PARTIAL)
            {
                let augmented_cache = get_symbol_table(
                    a,
                    &mut self.as_union_or_intersection_type_mut(t).property_cache,
                );
                if a.table_get(augmented_cache, name).is_nil() {
                    a.table_set(augmented_cache, key, prop);
                }
            }
        }
        prop
    }

    pub fn create_union_or_intersection_property(
        &mut self,
        containing_type: TypeId,
        name: &[u8],
        skip_object_function_property_augment: bool,
    ) -> SymbolId {
        let a = self.ast;
        let mut prop_flags = SymbolFlags::NONE;
        let mut single_prop = SymbolId::NIL;
        let mut prop_set: OrderedSet<SymbolId> = OrderedSet::default();
        let mut index_types: Vec<TypeId> = Vec::new();
        let is_union = self.types[containing_type]
            .flags
            .intersects(TypeFlags::UNION);
        // Flags we want to propagate to the result if they exist in all source symbols
        let mut check_flags = CheckFlags::NONE;
        let mut optional_flag = SymbolFlags::NONE;
        if !is_union {
            check_flags = CheckFlags::READONLY;
            optional_flag = SymbolFlags::OPTIONAL;
        }
        let mut synthetic_flag = CheckFlags::SYNTHETIC_METHOD;
        let mut merged_instantiations = false;
        let types = self.type_types(containing_type);
        for &current in types.as_slice() {
            let t = self.get_apparent_type(current);
            if !self.is_error_type(t) && !self.types[t].flags.intersects(TypeFlags::NEVER) {
                let prop = self.get_property_of_type_ex(
                    t,
                    name,
                    skip_object_function_property_augment,
                    false,
                );
                if !prop.is_nil() {
                    let modifiers = get_declaration_modifier_flags_from_symbol(a, prop);
                    if a.sym(prop).flags.intersects(SymbolFlags::CLASS_MEMBER) {
                        if is_union {
                            optional_flag |= a.sym(prop).flags & SymbolFlags::OPTIONAL;
                        } else {
                            optional_flag &= a.sym(prop).flags;
                        }
                    }
                    if single_prop.is_nil() {
                        single_prop = prop;
                        prop_flags = a.sym(prop).flags & SymbolFlags::ACCESSOR;
                        if prop_flags == SymbolFlags::NONE {
                            prop_flags = SymbolFlags::PROPERTY;
                        }
                    } else if prop != single_prop {
                        let prop_target = self.get_target_symbol(prop);
                        let single_prop_target = self.get_target_symbol(single_prop);
                        let is_instantiation = prop_target == single_prop_target;
                        // If the symbols are instances of one another with identical types - consider the symbols equivalent and just use the first one, which thus allows us to avoid eliding private members when intersecting a (this-)instantiations of a class with its raw base or another instance
                        if is_instantiation
                            && self.compare_properties(single_prop, prop, &mut compare_types_equal)
                                == Ternary::TRUE
                        {
                            // If we merged instantiations of a generic type, we replicate the symbol parent resetting behavior we used to do when we recorded multiple distinct symbols so that we still get, eg, `Array<T>.length` printed back and not `Array<string>.length` when we're looking at a `.length` access on a `string[] | number[]`
                            let single_prop_parent = a.sym(single_prop).parent;
                            merged_instantiations = !single_prop_parent.is_nil()
                                && self
                                    .get_local_type_parameters_of_class_or_interface_or_type_alias(
                                        single_prop_parent,
                                    )
                                    .len()
                                    != 0;
                        } else {
                            if prop_set.size() == 0 {
                                prop_set.add(single_prop);
                            }
                            prop_set.add(prop);
                        }
                        // classes created by mixins are represented as intersections and overriding a property in a derived class redefines it completely at runtime so a get accessor can't be merged with a set accessor in a base class, for that reason the accessor flags are only used when they are the same in all constituents
                        if prop_flags.intersects(SymbolFlags::ACCESSOR)
                            && (a.sym(prop).flags & SymbolFlags::ACCESSOR)
                                != (prop_flags & SymbolFlags::ACCESSOR)
                        {
                            prop_flags =
                                prop_flags.without(SymbolFlags::ACCESSOR) | SymbolFlags::PROPERTY;
                        }
                    }
                    if is_union && self.is_readonly_symbol(prop) {
                        check_flags |= CheckFlags::READONLY;
                    } else if !is_union && !self.is_readonly_symbol(prop) {
                        check_flags = check_flags.without(CheckFlags::READONLY);
                    }
                    if !modifiers.intersects(ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER) {
                        check_flags |= CheckFlags::CONTAINS_PUBLIC;
                    }
                    if modifiers.intersects(ModifierFlags::PROTECTED) {
                        check_flags |= CheckFlags::CONTAINS_PROTECTED;
                    }
                    if modifiers.intersects(ModifierFlags::PRIVATE) {
                        check_flags |= CheckFlags::CONTAINS_PRIVATE;
                    }
                    if modifiers.intersects(ModifierFlags::STATIC) {
                        check_flags |= CheckFlags::CONTAINS_STATIC;
                    }
                    if !is_prototype_property(a, prop) {
                        synthetic_flag = CheckFlags::SYNTHETIC_PROPERTY;
                    }
                } else if is_union {
                    let mut index_info = IndexInfoId::NIL;
                    if !is_late_bound_name(name) {
                        index_info = self.get_applicable_index_info_for_name(t, name);
                    }
                    if !index_info.is_nil() {
                        prop_flags =
                            prop_flags.without(SymbolFlags::ACCESSOR) | SymbolFlags::PROPERTY;
                        check_flags |= CheckFlags::WRITE_PARTIAL;
                        if self.index_infos[index_info].is_readonly {
                            check_flags |= CheckFlags::READONLY;
                        }
                        if is_tuple_type(self, t) {
                            let mut index_type = self.get_rest_type_of_tuple_type(t);
                            if index_type.is_nil() {
                                index_type = self.undefined_type;
                            }
                            index_types.push(index_type);
                        } else {
                            index_types.push(self.index_infos[index_info].value_type);
                        }
                    } else if is_object_literal_type(self, t)
                        && !self.types[t]
                            .object_flags
                            .intersects(ObjectFlags::CONTAINS_SPREAD)
                    {
                        check_flags |= CheckFlags::WRITE_PARTIAL;
                        index_types.push(self.undefined_type);
                    } else {
                        check_flags |= CheckFlags::READ_PARTIAL;
                    }
                }
            }
        }
        if single_prop.is_nil()
            || is_union
                && (prop_set.size() != 0 || check_flags.intersects(CheckFlags::PARTIAL))
                && check_flags
                    .intersects(CheckFlags::CONTAINS_PRIVATE | CheckFlags::CONTAINS_PROTECTED)
                && !(prop_set.size() != 0 && self.has_common_declaration(&prop_set))
        {
            // No property was found, or, in a union, a property has a private or protected declaration in one constituent, but is missing or has a different declaration in another constituent.
            return SymbolId::NIL;
        }
        if prop_set.size() == 0
            && !check_flags.intersects(CheckFlags::READ_PARTIAL)
            && index_types.is_empty()
        {
            if !merged_instantiations {
                return single_prop;
            }
            // No symbol from a union/intersection should have a `.parent` set (since unions/intersections don't act as symbol parents) Unless that parent is "reconstituted" from the "first value declaration" on the symbol (which is likely different than its instantiated parent!) They also have a `.containingType` set, which affects some services endpoints behavior, like `getRootSymbol`
            let mut single_prop_type = TypeId::NIL;
            let mut single_prop_mapper = TypeMapperId::NIL;
            if a.sym(single_prop).flags.intersects(SymbolFlags::TRANSIENT) {
                let links = self.value_symbol_links_get(single_prop);
                single_prop_type = self.value_symbol_links[links].resolved_type;
                single_prop_mapper = self.value_symbol_links[links].mapper;
            }
            let clone = self.create_symbol_with_type(single_prop, single_prop_type);
            let value_declaration = a.sym(single_prop).value_declaration;
            if !value_declaration.is_nil() {
                let parent = a.sym(a.symbol(value_declaration)).parent;
                a.update_symbol(clone, |s| s.parent = parent);
            }
            let links = self.value_symbol_links_get(clone);
            self.value_symbol_links[links].containing_type = containing_type;
            self.value_symbol_links[links].mapper = single_prop_mapper;
            let write_type = self.get_write_type_of_symbol(single_prop);
            self.value_symbol_links[links].write_type = write_type;
            return clone;
        }
        if prop_set.size() == 0 {
            prop_set.add(single_prop);
        }
        let mut declarations: Vec<NodeId> = Vec::new();
        let mut first_type = TypeId::NIL;
        let mut name_type = TypeId::NIL;
        let mut prop_types: Vec<TypeId> = Vec::new();
        // `writeTypes` of upstream is nil until a write type differs from the read type.
        let mut write_types: Option<Vec<TypeId>> = None;
        let mut first_value_declaration = NodeId::NIL;
        let mut has_non_uniform_value_declaration = false;
        for &prop in prop_set.values() {
            let prop_value_declaration = a.sym(prop).value_declaration;
            if first_value_declaration.is_nil() {
                first_value_declaration = prop_value_declaration;
            } else if !prop_value_declaration.is_nil()
                && prop_value_declaration != first_value_declaration
            {
                has_non_uniform_value_declaration = true;
            }
            declarations.extend_from_slice(a.sym(prop).declarations.as_slice());
            let t = self.get_type_of_symbol(prop);
            if first_type.is_nil() {
                first_type = t;
                let links = self.value_symbol_links_get(prop);
                name_type = self.value_symbol_links[links].name_type;
            }
            let write_type = self.get_write_type_of_symbol(prop);
            if write_types.is_some() || write_type != t {
                write_types
                    .get_or_insert_with(|| prop_types.clone())
                    .push(write_type);
            }
            if t != first_type {
                check_flags |= CheckFlags::HAS_NON_UNIFORM_TYPE;
            }
            if is_literal_type(self, t) || self.is_pattern_literal_type(t) {
                check_flags |= CheckFlags::HAS_LITERAL_TYPE;
            }
            if self.types[t].flags.intersects(TypeFlags::NEVER) && t != self.unique_literal_type {
                check_flags |= CheckFlags::HAS_NEVER_TYPE;
            }
            prop_types.push(t);
        }
        prop_types.extend_from_slice(&index_types);
        let name = self.text(name);
        let result = self.new_symbol_ex(
            prop_flags | optional_flag,
            name,
            check_flags | synthetic_flag,
        );
        let declarations = self.list(&declarations);
        a.update_symbol(result, |s| s.declarations = declarations);
        if !has_non_uniform_value_declaration && !first_value_declaration.is_nil() {
            // Inherit information about parent type.
            let parent = a.sym(a.symbol(first_value_declaration)).parent;
            a.update_symbol(result, |s| {
                s.value_declaration = first_value_declaration;
                s.parent = parent;
            });
        }
        let links = self.value_symbol_links_get(result);
        self.value_symbol_links[links].containing_type = containing_type;
        self.value_symbol_links[links].name_type = name_type;
        if prop_types.len() > 2 {
            // When `propTypes` has the potential to explode in size when normalized, defer normalization until absolutely needed
            a.update_symbol(result, |s| s.check_flags |= CheckFlags::DEFERRED_TYPE);
            let deferred = self.deferred_symbol_links.get(result);
            let constituents = self.list_of(&prop_types);
            let write_constituents = match &write_types {
                Some(write_types) => self.list_of(write_types),
                None => List::NIL,
            };
            self.deferred_symbol_links[deferred].parent = containing_type;
            self.deferred_symbol_links[deferred].constituents = constituents;
            self.deferred_symbol_links[deferred].write_constituents = write_constituents;
            return result;
        }
        let resolved_type = if is_union {
            self.get_union_type(List::from_slice(&prop_types))
        } else {
            self.get_intersection_type(List::from_slice(&prop_types))
        };
        self.value_symbol_links[links].resolved_type = resolved_type;
        if let Some(write_types) = &write_types {
            let write_type = if is_union {
                self.get_union_type(List::from_slice(write_types))
            } else {
                self.get_intersection_type(List::from_slice(write_types))
            };
            self.value_symbol_links[links].write_type = write_type;
        }
        result
    }

    pub fn get_target_symbol(&mut self, s: SymbolId) -> SymbolId {
        // if symbol is instantiated its flags are not copied from the 'target' so we'll need to get back original 'target' symbol to work with correct set of flags. NOTE: cast to TransientSymbol should be safe because only TransientSymbols have CheckFlags.Instantiated
        if !s.is_nil()
            && self
                .ast
                .sym(s)
                .check_flags
                .intersects(CheckFlags::INSTANTIATED)
        {
            let links = self.value_symbol_links_get(s);
            return self.value_symbol_links[links].target;
        }
        s
    }
}

// Return whether this symbol is a member of a prototype somewhere. Note that this is not tracked well within the compiler, so the answer may be incorrect.
pub fn is_prototype_property(a: Ast<'_>, symbol: SymbolId) -> bool {
    let s = a.sym(symbol);
    s.flags.intersects(SymbolFlags::METHOD)
        || s.check_flags.intersects(CheckFlags::SYNTHETIC_METHOD)
}

impl<'a> Checker<'a> {
    pub fn has_common_declaration(&self, symbols: &OrderedSet<SymbolId>) -> bool {
        let a = self.ast;
        let mut common_declarations: Set<NodeId> = Set::default();
        for &symbol in symbols.values() {
            let declarations = a.sym(symbol).declarations;
            if declarations.len() == 0 {
                return false;
            }
            if common_declarations.len() == 0 {
                for &d in declarations.as_slice() {
                    common_declarations.add(d);
                }
                continue;
            }
            // Upstream deletes from the set while it ranges over it: here the declarations that stay are collected into the next set.
            let mut remaining: Set<NodeId> = Set::default();
            for &d in common_declarations.keys() {
                if declarations.as_slice().contains(&d) {
                    remaining.add(d);
                }
            }
            common_declarations = remaining;
            if common_declarations.len() == 0 {
                return false;
            }
        }
        common_declarations.len() != 0
    }

    pub fn create_symbol_with_type(&mut self, source: SymbolId, t: TypeId) -> SymbolId {
        let a = self.ast;
        let s = a.sym(source);
        let symbol = self.new_symbol_ex(s.flags, s.name, s.check_flags & CheckFlags::READONLY);
        a.update_symbol(symbol, |r| {
            r.declarations = s.declarations;
            r.parent = s.parent;
            r.value_declaration = s.value_declaration;
        });
        let links = self.value_symbol_links_get(symbol);
        self.value_symbol_links[links].resolved_type = t;
        self.value_symbol_links[links].target = source;
        let source_links = self.value_symbol_links_get(source);
        let name_type = self.value_symbol_links[source_links].name_type;
        self.value_symbol_links[links].name_type = name_type;
        symbol
    }

    pub fn is_mapped_type_generic_indexed_access(&mut self, t: TypeId) -> bool {
        if self.types[t].flags.intersects(TypeFlags::INDEXED_ACCESS) {
            let object_type = self.as_indexed_access_type(t).object_type;
            let index_type = self.as_indexed_access_type(t).index_type;
            return self.types[object_type]
                .object_flags
                .intersects(ObjectFlags::MAPPED)
                && !self.is_generic_mapped_type(object_type)
                && self.is_generic_index_type(index_type)
                && !get_mapped_type_modifiers(self, object_type)
                    .intersects(MappedTypeModifiers::EXCLUDE_OPTIONAL)
                && self
                    .ast
                    .as_mapped_type_node(self.as_mapped_type(object_type).declaration)
                    .name_type
                    .is_nil();
        }
        false
    }

    // For a type parameter, return the base constraint of the type parameter. For the string, number, boolean, and symbol primitive types, return the corresponding object types. Otherwise return the type itself.
    pub fn get_apparent_type(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return t;
        }
        let original_type = t;
        let mut t = t;
        if self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
            t = self.get_base_constraint_of_type(t);
            if t.is_nil() {
                t = self.unknown_type;
            }
        }
        let flags = self.types[t].flags;
        let object_flags = self.types[t].object_flags;
        if object_flags.intersects(ObjectFlags::MAPPED) {
            return self.get_apparent_type_of_mapped_type(t);
        }
        if object_flags.intersects(ObjectFlags::REFERENCE) && t != original_type {
            return self.get_type_with_this_argument(t, original_type, false);
        }
        if flags.intersects(TypeFlags::INTERSECTION) {
            return self.get_apparent_type_of_intersection_type(t, original_type);
        }
        if flags.intersects(TypeFlags::STRING_LIKE) {
            return self.global_string_type;
        }
        if flags.intersects(TypeFlags::NUMBER_LIKE) {
            return self.global_number_type;
        }
        if flags.intersects(TypeFlags::BIG_INT_LIKE) {
            return self.get_global_big_int_type();
        }
        if flags.intersects(TypeFlags::BOOLEAN_LIKE) {
            return self.global_boolean_type;
        }
        if flags.intersects(TypeFlags::ES_SYMBOL_LIKE) {
            return self.get_global_es_symbol_type();
        }
        if flags.intersects(TypeFlags::NON_PRIMITIVE) {
            return self.empty_object_type;
        }
        if flags.intersects(TypeFlags::INDEX) {
            return self.string_number_symbol_type;
        }
        if flags.intersects(TypeFlags::UNKNOWN) && !self.strict_null_checks {
            return self.empty_object_type;
        }
        t
    }

    pub fn get_apparent_type_of_mapped_type(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.as_mapped_type(t).resolved_apparent_type.is_nil() {
            let resolved_apparent_type = self.get_resolved_apparent_type_of_mapped_type(t);
            self.as_mapped_type_mut(t).resolved_apparent_type = resolved_apparent_type;
        }
        self.as_mapped_type(t).resolved_apparent_type
    }

    pub fn get_resolved_apparent_type_of_mapped_type(&mut self, t: TypeId) -> TypeId {
        let a = self.ast;
        let mut target = self.as_object_type(t).target;
        if target.is_nil() {
            target = t;
        }
        let type_variable = self.get_homomorphic_type_variable(target);
        if !type_variable.is_nil()
            && a.as_mapped_type_node(self.as_mapped_type(target).declaration)
                .name_type
                .is_nil()
        {
            // We have a homomorphic mapped type or an instantiation of a homomorphic mapped type, i.e. a type of the form { [P in keyof T]: X }. Obtain the modifiers type (the T of the keyof T), and if it is another generic mapped type, recursively obtain its apparent type. Otherwise, obtain its base constraint. Then, if every constituent of the base constraint is an array or tuple type, apply this mapped type to the base constraint. It is safe to recurse when the modifiers type is a mapped type because we protect again circular constraints in getTypeFromMappedTypeNode.
            let modifiers_type = self.get_modifiers_type_from_mapped_type(t);
            let base_constraint = if self.is_generic_mapped_type(modifiers_type) {
                self.get_apparent_type_of_mapped_type(modifiers_type)
            } else {
                self.get_base_constraint_of_type(modifiers_type)
            };
            if !base_constraint.is_nil()
                && every_type(self, base_constraint, &mut |c, u| {
                    c.is_array_or_tuple_type(u) || c.is_array_or_tuple_or_intersection(u)
                })
            {
                let mapper = self.as_object_type(t).mapper;
                let mapper = prepend_type_mapping(self, type_variable, base_constraint, mapper);
                return self.instantiate_type(target, mapper);
            }
        }
        t
    }

    pub fn get_apparent_type_of_intersection_type(
        &mut self,
        t: TypeId,
        this_argument: TypeId,
    ) -> TypeId {
        if t == this_argument {
            if self.as_intersection_type(t).resolved_apparent_type.is_nil() {
                let resolved_apparent_type =
                    self.get_type_with_this_argument(t, this_argument, true);
                self.as_intersection_type_mut(t).resolved_apparent_type = resolved_apparent_type;
            }
            return self.as_intersection_type(t).resolved_apparent_type;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::APPARENT_TYPE,
            type_id: this_argument,
        };
        let mut result = self.cached_types.get(&key);
        if result.is_nil() {
            result = self.get_type_with_this_argument(t, this_argument, true);
            let ok = self.cached_types.set(key, result);
            self.map_set(ok);
        }
        result
    }

    // Return the reduced form of the given type. For a union type, it is a union of the normalized constituent types. For an intersection of types containing one or more mututally exclusive discriminant properties, it is 'never'. For all other types, it is simply the type itself. Discriminant properties are considered mutually exclusive when no constituent property has type 'never', but the intersection of the constituent property types is 'never'.
    pub fn get_reduced_type(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return t;
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::UNION) {
            if self.types[t]
                .object_flags
                .intersects(ObjectFlags::CONTAINS_INTERSECTIONS)
            {
                let reduced_type = self.as_union_type(t).resolved_reduced_type;
                if !reduced_type.is_nil() {
                    return reduced_type;
                }
                let reduced_type = self.get_reduced_union_type(t);
                self.as_union_type_mut(t).resolved_reduced_type = reduced_type;
                return reduced_type;
            }
        } else if flags.intersects(TypeFlags::INTERSECTION) {
            if !self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_NEVER_INTERSECTION_COMPUTED)
            {
                self.types[t].object_flags |= ObjectFlags::IS_NEVER_INTERSECTION_COMPUTED;
                let properties = self.get_properties_of_union_or_intersection_type(t);
                if some(properties.as_slice(), |prop| {
                    self.is_never_reduced_property(prop)
                }) {
                    self.types[t].object_flags |= ObjectFlags::IS_NEVER_INTERSECTION;
                }
            }
            if self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_NEVER_INTERSECTION)
            {
                return self.never_type;
            }
        }
        t
    }

    pub fn get_reduced_union_type(&mut self, union_type: TypeId) -> TypeId {
        let types = self.type_types(union_type);
        let reduced_types = self.same_map(types, |c, t| c.get_reduced_type(t));
        if same(reduced_types.as_slice(), types.as_slice()) {
            return union_type;
        }
        let reduced = self.get_union_type(reduced_types);
        if self.types[reduced].flags.intersects(TypeFlags::UNION) {
            self.as_union_type_mut(reduced).resolved_reduced_type = reduced;
        }
        reduced
    }

    pub fn is_never_reduced_property(&mut self, prop: SymbolId) -> bool {
        self.is_discriminant_with_never_type(prop)
            || is_conflicting_private_property(self.ast, prop)
    }

    pub fn get_reduced_apparent_type(&mut self, t: TypeId) -> TypeId {
        // Since getApparentType may return a non-reduced union or intersection type, we need to perform type reduction both before and after obtaining the apparent type. For example, given a type parameter 'T extends A | B', the type 'T & X' becomes 'A & X | B & X' after obtaining the apparent type, and that type may need further reduction to remove empty intersections.
        let reduced = self.get_reduced_type(t);
        let apparent = self.get_apparent_type(reduced);
        self.get_reduced_type(apparent)
    }

    pub fn elaborate_never_intersection(
        &mut self,
        chain: DiagnosticId,
        node: NodeId,
        t: TypeId,
    ) -> DiagnosticId {
        let a = self.ast;
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION)
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_NEVER_INTERSECTION)
        {
            let properties = self.get_properties_of_union_or_intersection_type(t);
            let never_prop = find(properties.as_slice(), |prop| {
                self.is_discriminant_with_never_type(prop)
            });
            if !never_prop.is_nil() {
                let type_name = self.type_to_string_ex(
                    t,
                    NodeId::NIL,
                    TypeFormatFlags::NO_TYPE_REDUCTION,
                    None,
                );
                let prop_name = self.symbol_to_string(never_prop);
                return self.new_diagnostic_chain_for_node(chain, node, diagnostics::THE_INTERSECTION_0_WAS_REDUCED_TO_NEVER_BECAUSE_PROPERTY_1_HAS_CONFLICTING_TYPES_IN_SOME_CONSTITUENTS, &[Arg::Str(&type_name), Arg::Str(&prop_name)]);
            }
            let properties = self.get_properties_of_union_or_intersection_type(t);
            let private_prop = find(properties.as_slice(), |prop| {
                is_conflicting_private_property(a, prop)
            });
            if !private_prop.is_nil() {
                let type_name = self.type_to_string_ex(
                    t,
                    NodeId::NIL,
                    TypeFormatFlags::NO_TYPE_REDUCTION,
                    None,
                );
                let prop_name = self.symbol_to_string(private_prop);
                return self.new_diagnostic_chain_for_node(chain, node, diagnostics::THE_INTERSECTION_0_WAS_REDUCED_TO_NEVER_BECAUSE_PROPERTY_1_EXISTS_IN_MULTIPLE_CONSTITUENTS_AND_IS_PRIVATE_IN_SOME, &[Arg::Str(&type_name), Arg::Str(&prop_name)]);
            }
        }
        chain
    }

    pub fn is_discriminant_with_never_type(&mut self, prop: SymbolId) -> bool {
        // Return true for a synthetic non-optional property with non-uniform types, where at least one is a literal type and none is never, that reduces to never.
        let s = self.ast.sym(prop);
        if s.flags.intersects(SymbolFlags::OPTIONAL)
            || (s.check_flags & (CheckFlags::NON_UNIFORM_AND_LITERAL | CheckFlags::HAS_NEVER_TYPE))
                != CheckFlags::NON_UNIFORM_AND_LITERAL
        {
            return false;
        }
        let prop_type = self.get_type_of_symbol(prop);
        self.types[prop_type].flags.intersects(TypeFlags::NEVER)
    }
}

pub fn is_conflicting_private_property(a: Ast<'_>, prop: SymbolId) -> bool {
    // Return true for a synthetic property with multiple declarations, at least one of which is private.
    let s = a.sym(prop);
    s.value_declaration.is_nil() && s.check_flags.intersects(CheckFlags::CONTAINS_PRIVATE)
}

impl<'a> Checker<'a> {
    pub fn get_type_arguments(&mut self, t: TypeId) -> List<'a, TypeId> {
        let a = self.ast;
        if self.as_type_reference(t).resolved_type_arguments.is_nil() {
            if !self.stack_check.is_safe_to_recurse() {
                return self.stack_limit();
            }
            let target = self.as_object_type(t).target;
            if !self.push_type_resolution(
                TypeSystemEntity::Type(t),
                TypeSystemPropertyName::ResolvedTypeArguments,
            ) {
                let count = self.as_interface_type(target).type_parameters().len();
                let error_types = vec![self.error_type; usize::try_from(count).unwrap_or(0)];
                return self.list_of(&error_types);
            }
            let mut type_arguments: List<'a, TypeId> = List::NIL;
            let node = self.as_type_reference(t).node;
            if !node.is_nil() {
                match a.kind(node) {
                    Kind::TypeReference => {
                        let outer_type_parameters =
                            self.as_interface_type(target).outer_type_parameters();
                        let local_type_parameters =
                            self.as_interface_type(target).local_type_parameters();
                        let effective_type_arguments =
                            self.get_effective_type_arguments(node, local_type_parameters);
                        // `append(outer, effective...)`: the outer list itself when nothing is appended.
                        if effective_type_arguments.len() == 0 {
                            type_arguments = outer_type_parameters;
                        } else {
                            let mut appended: Vec<TypeId> =
                                outer_type_parameters.as_slice().to_vec();
                            appended.extend_from_slice(effective_type_arguments.as_slice());
                            type_arguments = self.list_of(&appended);
                        }
                    }
                    Kind::ArrayType => {
                        let element_type =
                            self.get_type_from_type_node(a.as_array_type_node(node).element_type);
                        type_arguments = self.list_of(&[element_type]);
                    }
                    Kind::TupleType => {
                        let elements = a.elements(node);
                        type_arguments = self
                            .map_list(elements, |c, element| c.get_type_from_type_node(element));
                    }
                    kind => {
                        let _: () =
                            self.fail_detail("Unhandled case in getTypeArguments", kind as u32);
                    }
                }
            }
            if self.pop_type_resolution() {
                if self.as_type_reference(t).resolved_type_arguments.is_nil() {
                    let mapper = self.as_object_type(t).mapper;
                    let resolved_type_arguments = self.instantiate_types(type_arguments, mapper);
                    self.as_type_reference_mut(t).resolved_type_arguments = resolved_type_arguments;
                }
            } else {
                if self.as_type_reference(t).resolved_type_arguments.is_nil() {
                    let count = self.as_interface_type(target).type_parameters().len();
                    let error_types = vec![self.error_type; usize::try_from(count).unwrap_or(0)];
                    let error_types = self.list_of(&error_types);
                    self.as_type_reference_mut(t).resolved_type_arguments = error_types;
                }
                let error_node = if !node.is_nil() {
                    node
                } else {
                    self.current_node
                };
                let target_symbol = self.types[target].symbol;
                if !target_symbol.is_nil() {
                    let name = self.symbol_to_string(target_symbol);
                    self.error(
                        error_node,
                        diagnostics::TYPE_ARGUMENTS_FOR_0_CIRCULARLY_REFERENCE_THEMSELVES,
                        &[Arg::Str(&name)],
                    );
                } else {
                    self.error(
                        error_node,
                        diagnostics::TUPLE_TYPE_ARGUMENTS_CIRCULARLY_REFERENCE_THEMSELVES,
                        &[],
                    );
                }
            }
        }
        self.as_type_reference(t).resolved_type_arguments
    }

    pub fn get_effective_type_arguments(
        &mut self,
        node: NodeId,
        type_parameters: List<'a, TypeId>,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        let type_arguments = self.map_list(a.type_arguments(node), |c, type_node| {
            c.get_type_from_type_node(type_node)
        });
        let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
        self.fill_missing_type_arguments(
            type_arguments,
            type_parameters,
            min_type_argument_count,
            is_in_js_file(a, node),
        )
    }

    // Gets the minimum number of type arguments needed to satisfy all non-optional type parameters.
    pub fn get_min_type_argument_count(&self, type_parameters: List<'_, TypeId>) -> isize {
        let mut min_type_argument_count = 0;
        for (i, &type_parameter) in type_parameters.as_slice().iter().enumerate() {
            if !self.has_type_parameter_default(type_parameter) {
                min_type_argument_count = i as isize + 1;
            }
        }
        min_type_argument_count
    }

    pub fn has_type_parameter_default(&self, t: TypeId) -> bool {
        let a = self.ast;
        let symbol = self.types[t].symbol;
        !symbol.is_nil()
            && some(a.sym(symbol).declarations.as_slice(), |d| {
                is_type_parameter_declaration(a, d)
                    && !a.as_type_parameter_declaration(d).default_type.is_nil()
            })
    }

    pub fn fill_missing_type_arguments(
        &mut self,
        type_arguments: List<'a, TypeId>,
        type_parameters: List<'a, TypeId>,
        _min_type_argument_count: isize,
        is_java_script_implicit_any: bool,
    ) -> List<'a, TypeId> {
        let num_type_parameters = type_parameters.len();
        if num_type_parameters == 0 {
            return List::NIL;
        }
        let num_type_arguments = type_arguments.len();
        if is_java_script_implicit_any || num_type_arguments < num_type_parameters {
            let count = type_parameters.as_slice().len();
            // Map invalid forward references in default types to the error type
            let mut initial: Vec<TypeId> = type_arguments
                .as_slice()
                .iter()
                .copied()
                .take(count)
                .collect();
            initial.resize(count, self.error_type);
            // The mappers made below keep `result` while later rounds still write it: it is a live list, and the caller gets a frozen copy.
            let result = self.live_list(&initial);
            let base_default_type =
                self.get_default_type_argument_type(is_java_script_implicit_any);
            let first = usize::try_from(num_type_arguments).unwrap_or(0);
            for i in first..count {
                let mut default_type = self.get_default_from_type_parameter(type_parameters.at(i));
                if is_java_script_implicit_any
                    && !default_type.is_nil()
                    && (self.is_type_identical_to(default_type, self.unknown_type)
                        || self.is_type_identical_to(default_type, self.empty_object_type))
                {
                    default_type = self.any_type;
                }
                if !default_type.is_nil() {
                    let mapper = new_type_mapper(self, type_parameters, result);
                    let instantiated = self.instantiate_type(default_type, mapper);
                    let ok = result.set(i, instantiated);
                    self.slice_set(ok);
                } else {
                    let ok = result.set(i, base_default_type);
                    self.slice_set(ok);
                }
            }
            let filled: Vec<TypeId> = (0..count).map(|i| result.at(i)).collect();
            return self.list_of(&filled);
        }
        type_arguments
    }

    pub fn get_default_type_argument_type(&self, is_in_java_script_file: bool) -> TypeId {
        if is_in_java_script_file {
            return self.any_type;
        }
        self.unknown_type
    }

    // Gets the default type for a type parameter. If the type parameter is the result of an instantiation, this gets the instantiated default type of its target. If the type parameter has no default type or the default is circular, `undefined` is returned.
    pub fn get_default_from_type_parameter(&mut self, t: TypeId) -> TypeId {
        if !self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return TypeId::NIL;
        }
        let default_type = self.get_resolved_type_parameter_default(t);
        if default_type != self.no_constraint_type && default_type != self.circular_constraint_type
        {
            return default_type;
        }
        TypeId::NIL
    }

    pub fn get_resolved_type_parameter_default(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let resolved_default_type = self.as_type_parameter(t).resolved_default_type;
        if resolved_default_type.is_nil() {
            let target = self.as_type_parameter(t).target;
            if !target.is_nil() {
                let target_default = self.get_resolved_type_parameter_default(target);
                let resolved = if !target_default.is_nil() {
                    let mapper = self.as_type_parameter(t).mapper;
                    self.instantiate_type(target_default, mapper)
                } else {
                    self.no_constraint_type
                };
                self.as_type_parameter_mut(t).resolved_default_type = resolved;
            } else {
                // To block recursion, set the initial value to the resolvingDefaultType.
                let resolving_default_type = self.resolving_default_type;
                self.as_type_parameter_mut(t).resolved_default_type = resolving_default_type;
                let mut default_type = self.no_constraint_type;
                let symbol = self.types[t].symbol;
                if !symbol.is_nil() {
                    let default_declaration =
                        first_non_nil(a.sym(symbol).declarations.as_slice(), |decl| {
                            if is_type_parameter_declaration(a, decl) {
                                return a.as_type_parameter_declaration(decl).default_type;
                            }
                            NodeId::NIL
                        });
                    if !default_declaration.is_nil() {
                        default_type = self.get_type_from_type_node(default_declaration);
                    }
                }
                if self.as_type_parameter(t).resolved_default_type == self.resolving_default_type {
                    // If we have not been called recursively, set the correct default type.
                    self.as_type_parameter_mut(t).resolved_default_type = default_type;
                }
            }
        } else if resolved_default_type == self.resolving_default_type {
            // If we are called recursively for this type parameter, mark the default as circular.
            let circular_constraint_type = self.circular_constraint_type;
            self.as_type_parameter_mut(t).resolved_default_type = circular_constraint_type;
        }
        self.as_type_parameter(t).resolved_default_type
    }

    pub fn get_default_or_unknown_from_type_parameter(&mut self, t: TypeId) -> TypeId {
        let result = self.get_default_from_type_parameter(t);
        if !result.is_nil() {
            return result;
        }
        self.unknown_type
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
        // For classes and interfaces, we store explicitly declared members ahead of inherited members. This ensures we process explicitly declared members first in type relations, which is beneficial because explicitly declared members are more likely to contain discriminating differences. See for example https://github.com/microsoft/typescript-go/issues/1968.
        let mut result: Vec<SymbolId> =
            Vec::with_capacity(usize::try_from(a.table_len(members)).unwrap_or(0));
        let mut contained_count = 0;
        let container_is_class_or_interface = !container.is_nil()
            && a.sym(container)
                .flags
                .intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE);
        // Upstream ranges twice over the members, a map: the table is walked in insertion order, and both parts of the result are sorted below.
        if container_is_class_or_interface {
            let mut position = 0;
            while let Some((id, symbol)) = a.table_entry_at(members, position) {
                position += 1;
                if self.is_named_member(symbol, id)
                    && self.is_declaration_contained_by(symbol, container)
                {
                    result.push(symbol);
                }
            }
            contained_count = result.len();
        }
        let mut position = 0;
        while let Some((id, symbol)) = a.table_entry_at(members, position) {
            position += 1;
            if self.is_named_member(symbol, id)
                && (!container_is_class_or_interface
                    || !self.is_declaration_contained_by(symbol, container))
            {
                result.push(symbol);
            }
        }
        if let Some((contained, others)) = result.split_at_mut_checked(contained_count) {
            self.sort_symbols(contained);
            self.sort_symbols(others);
        }
        self.list_of(&result)
    }

    pub fn is_declaration_contained_by(&self, symbol: SymbolId, container: SymbolId) -> bool {
        let a = self.ast;
        let declaration = a.sym(symbol).value_declaration;
        if !declaration.is_nil() {
            for &d in a.sym(container).declarations.as_slice() {
                if a.loc(declaration).contained_by(a.loc(d)) {
                    return true;
                }
            }
        }
        false
    }

    pub fn is_named_member(&mut self, symbol: SymbolId, id: &[u8]) -> bool {
        !is_reserved_member_name(id) && self.symbol_is_value(symbol)
    }

    pub fn symbol_is_value(&mut self, symbol: SymbolId) -> bool {
        self.symbol_is_value_ex(symbol, false)
    }

    pub fn symbol_is_value_ex(
        &mut self,
        symbol: SymbolId,
        include_type_only_members: bool,
    ) -> bool {
        let flags = self.ast.sym(symbol).flags;
        flags.intersects(SymbolFlags::VALUE)
            || flags.intersects(SymbolFlags::ALIAS)
                && self
                    .get_symbol_flags_ex(symbol, !include_type_only_members, false)
                    .intersects(SymbolFlags::VALUE)
    }
}

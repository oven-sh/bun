// checker.go:17141-17469 (layers T-CONSTRAINT, T-DECLARED): the functions of 17413-17469: the declared type of a class or interface and the test for an interface without `this`.
use crate::ast::{
    NodeFlags, NodeId, SymbolFlags, SymbolId, get_extends_heritage_clause_elements,
    get_heritage_clause_element_name, is_entity_name, is_entity_name_expression,
    is_interface_declaration,
};
use crate::checker::{Checker, ObjectFlags, TypeId, get_type_list_key};
use crate::core::Map;

impl<'a> Checker<'a> {
    pub fn get_declared_type_of_class_or_interface(&mut self, symbol: SymbolId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let links = self.declared_type_links.get(symbol);
        if self.declared_type_links[links].declared_type.is_nil() {
            let kind = if self.ast.sym(symbol).flags.intersects(SymbolFlags::CLASS) {
                ObjectFlags::CLASS
            } else {
                ObjectFlags::INTERFACE
            };
            let t = self.new_object_type(kind, symbol);
            self.declared_type_links[links].declared_type = t;
            let outer_type_parameters =
                self.get_outer_type_parameters_of_class_or_interface(symbol);
            let type_parameters = self
                .append_local_type_parameters_of_class_or_interface_or_type_alias(
                    outer_type_parameters,
                    symbol,
                );
            // A class or interface is generic if it has type parameters or a "this" type. We always give classes a "this" type because it is not feasible to analyze all members to determine if the "this" type escapes the class (in particular, property types inferred from initializers and method return types inferred from return statements are very hard to exhaustively analyze). We give interfaces a "this" type if we can't definitely determine that they are free of "this" references.
            if !type_parameters.is_nil()
                || kind == ObjectFlags::CLASS
                || !self.is_thisless_interface(symbol)
            {
                self.types[t].object_flags |= ObjectFlags::REFERENCE;
                let this_type = self.new_type_parameter(symbol);
                self.as_interface_type_mut(t).this_type = this_type;
                self.as_type_parameter_mut(this_type).is_this_type = true;
                self.as_type_parameter_mut(this_type).constraint = t;
                let mut all_type_parameters: Vec<TypeId> = type_parameters.as_slice().to_vec();
                all_type_parameters.push(this_type);
                let all_type_parameters = self.list_of(&all_type_parameters);
                self.as_interface_type_mut(t).all_type_parameters = all_type_parameters;
                self.as_interface_type_mut(t).outer_type_parameter_count =
                    outer_type_parameters.as_slice().len() as isize;
                let resolved_type_arguments = self.as_interface_type(t).type_parameters();
                self.as_type_reference_mut(t).resolved_type_arguments = resolved_type_arguments;
                self.as_object_type_mut(t).instantiations = Map::make();
                let key = get_type_list_key(resolved_type_arguments);
                let ok = self.as_object_type_mut(t).instantiations.set(key, t);
                self.map_set(ok);
                self.as_object_type_mut(t).target = t;
            }
        }
        self.declared_type_links[links].declared_type
    }

    // Returns true if the interface given by the symbol is free of "this" references. Specifically, the result is true if the interface itself contains no references to "this" in its body, if all base types are interfaces, and if none of the base interfaces have a "this" type.
    pub fn is_thisless_interface(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        for &declaration in a.sym(symbol).declarations.as_slice() {
            if is_interface_declaration(a, declaration) {
                if a.flags(declaration).intersects(NodeFlags::CONTAINS_THIS) {
                    return false;
                }
                let base_type_nodes = get_extends_heritage_clause_elements(a, declaration);
                for &node in base_type_nodes {
                    let name = get_heritage_clause_element_name(a, node);
                    if is_entity_name(a, name) || is_entity_name_expression(a, name) {
                        let base_symbol = self.resolve_entity_name(
                            name,
                            SymbolFlags::TYPE,
                            true,
                            false,
                            NodeId::NIL,
                        );
                        if base_symbol.is_nil()
                            || !a.sym(base_symbol).flags.intersects(SymbolFlags::INTERFACE)
                        {
                            return false;
                        }
                        let base_type = self.get_declared_type_of_class_or_interface(base_symbol);
                        if !self.as_interface_type(base_type).this_type.is_nil() {
                            return false;
                        }
                    }
                }
            }
        }
        true
    }
}

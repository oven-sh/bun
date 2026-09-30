// checker.go:21513-22212 (layer T-INSTANTIATE): the function of 22007-22045: the type arguments of a type reference.
use crate::ast::{Arg, Kind};
use crate::checker::{Checker, TypeId, TypeSystemEntity, TypeSystemPropertyName};
use crate::core::List;
use crate::diagnostics;

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
}

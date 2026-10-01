// checker.go 22047-22102 and 22163-22186 (c36_properties_apparent_types): type argument defaults and getNamedMembers.
use crate::ast::flags_generated::SymbolFlags;
use crate::checker::checker::Checker;
use crate::checker::mapper::new_type_mapper;
use crate::tscore::golang::{List, SliceBuf};
use crate::tscore::ids::{SymbolId, SymbolTableId, TypeId};

impl<'a> Checker<'a> {
    // Gets the minimum number of type arguments needed to satisfy all non-optional type parameters.
    pub fn get_min_type_argument_count(&mut self, type_parameters: List<'a, TypeId>) -> isize {
        let mut min_type_argument_count = 0;
        for (i, type_parameter) in type_parameters.iter().enumerate() {
            if !self.has_type_parameter_default(type_parameter) {
                min_type_argument_count = i as isize + 1;
            }
        }
        min_type_argument_count
    }

    pub fn fill_missing_type_arguments(
        &mut self,
        type_arguments: List<'a, TypeId>,
        type_parameters: List<'a, TypeId>,
        min_type_argument_count: isize,
        is_java_script_implicit_any: bool,
    ) -> List<'a, TypeId> {
        let _ = min_type_argument_count;
        let num_type_parameters = type_parameters.len();
        if num_type_parameters == 0 {
            return List::NIL;
        }
        let num_type_arguments = type_arguments.len();
        if is_java_script_implicit_any || num_type_arguments < num_type_parameters {
            // `result` is read by the mappers made below while later rounds still write it: a live list.
            let mut initial = SliceBuf::make(num_type_parameters, num_type_parameters);
            for (i, t) in type_arguments.iter().enumerate() {
                let _ = initial.set(i, t);
            }
            // Map invalid forward references in default types to the error type
            let mut i = num_type_arguments;
            while i < num_type_parameters {
                let ok = initial.set(i, self.error_type);
                self.slice_set(ok);
                i += 1;
            }
            let result = self.live_list(&initial.items);
            let base_default_type =
                self.get_default_type_argument_type(is_java_script_implicit_any);
            let mut i = num_type_arguments;
            while i < num_type_parameters {
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
                i += 1;
            }
            // The writes are over: the caller gets a frozen list, the mappers keep the live one.
            return self.list_of(&result.to_vec());
        }
        type_arguments
    }

    pub fn get_default_type_argument_type(&self, is_in_java_script_file: bool) -> TypeId {
        if is_in_java_script_file {
            return self.any_type;
        }
        self.unknown_type
    }

    pub fn get_named_members(
        &mut self,
        members: SymbolTableId,
        container: SymbolId,
    ) -> List<'a, SymbolId> {
        if self.ast.table_len(members) == 0 {
            return List::NIL;
        }
        // For classes and interfaces, we store explicitly declared members ahead of inherited members.
        let mut result = SliceBuf::make(0, self.ast.table_len(members));
        let mut contained_count = 0usize;
        let container_is_class_or_interface = !container.is_nil()
            && self
                .ast
                .sym(container)
                .flags
                .intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE);
        if container_is_class_or_interface {
            let mut position = 0;
            while let Some((id, symbol)) = self.ast.table_entry_at(members, position) {
                if self.is_named_member(symbol, id)
                    && self.is_declaration_contained_by(symbol, container)
                {
                    result.push(symbol);
                }
                position += 1;
            }
            contained_count = result.items.len();
        }
        let mut position = 0;
        while let Some((id, symbol)) = self.ast.table_entry_at(members, position) {
            if self.is_named_member(symbol, id)
                && (!container_is_class_or_interface
                    || !self.is_declaration_contained_by(symbol, container))
            {
                result.push(symbol);
            }
            position += 1;
        }
        let contained_count = contained_count.min(result.items.len());
        let (contained, inherited) = result.items.split_at_mut(contained_count);
        self.sort_symbols(contained);
        self.sort_symbols(inherited);
        self.list(&result)
    }
}

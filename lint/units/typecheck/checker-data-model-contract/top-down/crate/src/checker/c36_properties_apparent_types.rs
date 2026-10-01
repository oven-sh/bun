// checker.go 22068-22104 (c36_properties_apparent_types): fillMissingTypeArguments, whose result is read through mappers while it is filled.
use crate::checker::checker::Checker;
use crate::checker::mapper::MapperTargets;
use crate::tscore::golang::{List, SliceBuf};
use crate::tscore::ids::TypeId;

impl<'a> Checker<'a> {
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
            // `make` and `copy`: the cells are the one backing array that the mappers below keep.
            let result = self
                .arena
                .alloc_type_cells(usize::try_from(num_type_parameters).unwrap_or(0));
            for (cell, type_argument) in result.iter().zip(type_arguments.iter()) {
                cell.set(type_argument);
            }
            // Map invalid forward references in default types to the error type
            for i in num_type_arguments..num_type_parameters {
                self.set_type_cell(result, i, self.error_type);
            }
            let base_default_type =
                self.get_default_type_argument_type(is_java_script_implicit_any);
            for i in num_type_arguments..num_type_parameters {
                let mut default_type = self.get_default_from_type_parameter(type_parameters.at(i));
                if is_java_script_implicit_any
                    && !default_type.is_nil()
                    && (self.is_type_identical_to(default_type, self.unknown_type)
                        || self.is_type_identical_to(default_type, self.empty_object_type))
                {
                    default_type = self.any_type;
                }
                if !default_type.is_nil() {
                    let mapper =
                        self.new_type_mapper(type_parameters, MapperTargets::Cells(result));
                    let instantiated = self.instantiate_type(default_type, mapper);
                    self.set_type_cell(result, i, instantiated);
                } else {
                    self.set_type_cell(result, i, base_default_type);
                }
            }
            // The slice that leaves the function: nothing writes the cells from here on.
            let mut frozen = SliceBuf::make(0, num_type_parameters);
            for cell in result {
                frozen.push(cell.get());
            }
            return self.list(&frozen);
        }
        type_arguments
    }

    // `result[i] = t` on the cells of fillMissingTypeArguments.
    fn set_type_cell(&self, cells: &[std::cell::Cell<TypeId>], index: isize, t: TypeId) {
        match usize::try_from(index).ok().and_then(|i| cells.get(i)) {
            Some(cell) => cell.set(t),
            None => self.index_out_of_range("fillMissingTypeArguments: result[i]"),
        }
    }

    pub fn get_default_type_argument_type(&mut self, is_in_java_script_file: bool) -> TypeId {
        if is_in_java_script_file {
            return self.any_type;
        }
        self.unknown_type
    }
}

// checker/relater.go (layer T-TUPLE): the functions of 1915-1945: slices, known keys and the rest array type of a tuple type.
use crate::checker::{Checker, TypeId};
use crate::core::List;

impl<'a> Checker<'a> {
    pub fn slice_tuple_type(&mut self, t: TypeId, index: isize, end_skip_count: isize) -> TypeId {
        let fixed_length = self.type_target_tuple_type(t).fixed_length;
        let element_infos = self.type_target_tuple_type(t).element_infos.as_slice();
        let end_index = self.get_type_reference_arity(t) - end_skip_count.max(0);
        if index > fixed_length {
            let rest_array_type = self.get_rest_array_type_of_tuple_type(t);
            if !rest_array_type.is_nil() {
                return rest_array_type;
            }
            return self.create_tuple_type(List::NIL);
        }
        if index >= end_index {
            return self.create_tuple_type(List::NIL);
        }
        // The two lists are sub slices of the type arguments and of the element infos: a bound outside a list is cut to the list.
        let type_arguments = self.get_type_arguments(t).as_slice();
        let lo = usize::try_from(index).unwrap_or(0);
        let hi = usize::try_from(end_index).unwrap_or(0);
        let type_lo = lo.min(type_arguments.len());
        let type_hi = hi.min(type_arguments.len()).max(type_lo);
        let info_lo = lo.min(element_infos.len());
        let info_hi = hi.min(element_infos.len()).max(info_lo);
        let element_types = List::from_slice(type_arguments.get(type_lo..type_hi).unwrap_or(&[]));
        let element_infos = List::from_slice(element_infos.get(info_lo..info_hi).unwrap_or(&[]));
        self.create_tuple_type_ex(element_types, element_infos, false)
    }

    pub fn get_known_keys_of_tuple_type(&mut self, t: TypeId) -> TypeId {
        let fixed_length =
            usize::try_from(self.type_target_tuple_type(t).fixed_length).unwrap_or(0);
        let mut keys: Vec<TypeId> = Vec::with_capacity(fixed_length + 1);
        for i in 0..fixed_length {
            let text = self.text(i.to_string().as_bytes());
            let key = self.get_string_literal_type(text);
            keys.push(key);
        }
        let array_type = if self.type_target_tuple_type(t).readonly {
            self.global_readonly_array_type
        } else {
            self.global_array_type
        };
        let index_type = self.get_index_type(array_type);
        keys.push(index_type);
        self.get_union_type(List::from_slice(&keys))
    }

    pub fn get_rest_array_type_of_tuple_type(&mut self, t: TypeId) -> TypeId {
        let rest_type = self.get_rest_type_of_tuple_type(t);
        if !rest_type.is_nil() {
            return self.create_array_type(rest_type);
        }
        TypeId::NIL
    }
}

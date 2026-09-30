// checker.go:31097-31702 (layers K-PRED, K-SUBST): the functions of 31607-31612 and 31694-31702: the target of a reference and the type variable behind substitution types.
use crate::checker::{Checker, ObjectFlags, TypeFlags, TypeId};

impl<'a> Checker<'a> {
    pub fn get_target_type(&self, t: TypeId) -> TypeId {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
        {
            return self.as_object_type(t).target;
        }
        t
    }

    pub fn get_actual_type_variable(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::SUBSTITUTION) {
            let base_type = self.as_substitution_type(t).base_type;
            return self.get_actual_type_variable(base_type);
        }
        if self.types[t].flags.intersects(TypeFlags::INDEXED_ACCESS) {
            let object_type = self.as_indexed_access_type(t).object_type;
            let index_type = self.as_indexed_access_type(t).index_type;
            if self.types[object_type]
                .flags
                .intersects(TypeFlags::SUBSTITUTION)
                || self.types[index_type]
                    .flags
                    .intersects(TypeFlags::SUBSTITUTION)
            {
                let actual_object_type = self.get_actual_type_variable(object_type);
                let actual_index_type = self.get_actual_type_variable(index_type);
                return self.get_indexed_access_type(actual_object_type, actual_index_type);
            }
        }
        t
    }
}

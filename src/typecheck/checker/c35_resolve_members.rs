// checker.go:20729-21511 (layer T-SIGINST): the functions of 20729-20762: instantiation of signatures and index infos.
use crate::checker::{
    Checker, IndexInfoId, SignatureFlags, SignatureId, TypeId, TypeMapperId, TypePredicateId,
    new_type_mapper,
};
use crate::core::List;

impl<'a> Checker<'a> {
    pub fn instantiate_signature(&mut self, sig: SignatureId, m: TypeMapperId) -> SignatureId {
        self.instantiate_signature_ex(sig, m, m == self.permissive_mapper)
    }

    pub fn instantiate_signature_ex(
        &mut self,
        sig: SignatureId,
        m: TypeMapperId,
        erase_type_parameters: bool,
    ) -> SignatureId {
        let mut m = m;
        let mut fresh_type_parameters: List<'a, TypeId> = List::NIL;
        let type_parameters = self.signatures[sig].type_parameters;
        if type_parameters.len() != 0 && !erase_type_parameters {
            // First create a fresh set of type parameters, then include a mapping from the old to the new type parameters in the mapper function. Finally store this mapper in the new type parameters such that we can use it when instantiating constraints.
            fresh_type_parameters =
                self.map_list(type_parameters, |c, tp| c.clone_type_parameter(tp));
            let fresh_mapper = new_type_mapper(self, type_parameters, fresh_type_parameters);
            m = self.combine_type_mappers(fresh_mapper, m);
            for &tp in fresh_type_parameters.as_slice() {
                self.as_type_parameter_mut(tp).mapper = m;
            }
        }
        // Don't compute resolvedReturnType and resolvedTypePredicate now, because using `mapper` now could trigger inferences to become fixed. (See `createInferenceContext`.) See GH#17600.
        let flags = self.signatures[sig].flags & SignatureFlags::PROPAGATING_FLAGS;
        let declaration = self.signatures[sig].declaration;
        let this_parameter = self.signatures[sig].this_parameter;
        let this_parameter = self.instantiate_symbol(this_parameter, m);
        let parameters = self.signatures[sig].parameters;
        let parameters = self.instantiate_symbols(parameters, m);
        let min_argument_count = self.signatures[sig].min_argument_count as isize;
        let result = self.new_signature(
            flags,
            declaration,
            fresh_type_parameters,
            this_parameter,
            parameters,
            TypeId::NIL,
            TypePredicateId::NIL,
            min_argument_count,
        );
        self.signatures[result].target = sig;
        self.signatures[result].mapper = m;
        result
    }

    pub fn instantiate_index_info(&mut self, info: IndexInfoId, m: TypeMapperId) -> IndexInfoId {
        let value_type = self.index_infos[info].value_type;
        let new_value_type = self.instantiate_type(value_type, m);
        if new_value_type == value_type {
            return info;
        }
        let key_type = self.index_infos[info].key_type;
        let is_readonly = self.index_infos[info].is_readonly;
        let declaration = self.index_infos[info].declaration;
        let components = self.index_infos[info].components;
        self.new_index_info(
            key_type,
            new_value_type,
            is_readonly,
            declaration,
            components,
        )
    }
}

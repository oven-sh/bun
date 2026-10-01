// checker.go 21225-21296 (c35_resolve_members, layer T-UIMEMBERS): getUnionSignatures.
use crate::checker::checker::Checker;
use crate::tscore::golang::{List, SliceBuf};
use crate::tscore::ids::{SignatureId, SymbolId};

impl<'a> Checker<'a> {
    // The signatures of a union type are those signatures that are present in each of the constituent types.
    pub fn get_union_signatures(
        &mut self,
        signature_lists: &[List<'a, SignatureId>],
    ) -> List<'a, SignatureId> {
        let mut result: SliceBuf<SignatureId> = SliceBuf::nil();
        let mut index_with_length_over_one: usize = 0;
        let mut count_length_over_one = 0;
        for (i, list) in signature_lists.iter().copied().enumerate() {
            if list.len() == 0 {
                return List::NIL;
            }
            if list.len() > 1 {
                index_with_length_over_one = i;
                count_length_over_one += 1;
            }
            for signature in list.iter() {
                // Only process signatures with parameter lists that aren't already in the result list
                if result.is_nil()
                    || self
                        .find_matching_signature(&result.items, signature, false, false, true)
                        .is_nil()
                {
                    let union_signatures =
                        self.find_matching_signatures(signature_lists, signature, i as isize);
                    if !union_signatures.is_nil() {
                        let mut s = signature;
                        // Union the result types when more than one signature matches
                        if union_signatures.len() > 1 {
                            let mut this_parameter = self.signatures[signature].this_parameter;
                            let mut first_this_parameter_of_union_signatures = SymbolId::NIL;
                            for sig in union_signatures.iter() {
                                let p = self.signatures[sig].this_parameter;
                                if !p.is_nil() {
                                    first_this_parameter_of_union_signatures = p;
                                    break;
                                }
                            }
                            if !first_this_parameter_of_union_signatures.is_nil() {
                                let mut types = SliceBuf::nil();
                                for sig in union_signatures.iter() {
                                    let p = self.signatures[sig].this_parameter;
                                    if !p.is_nil() {
                                        let t = self.get_type_of_symbol(p);
                                        if !t.is_nil() {
                                            types.push(t);
                                        }
                                    }
                                }
                                let types = self.list(&types);
                                let this_type = self.get_intersection_type(types);
                                this_parameter = self.create_symbol_with_type(
                                    first_this_parameter_of_union_signatures,
                                    this_type,
                                );
                            }
                            s = self.create_union_signature(signature, union_signatures);
                            self.signatures[s].this_parameter = this_parameter;
                        }
                        result.push(s);
                    }
                }
            }
        }
        if result.len() == 0 && count_length_over_one <= 1 {
            // No sufficiently similar signature existed to subsume all the other signatures in the union - time to see if we can make a single signature that handles all of them. We only do this when there are overloads in only one constituent.
            let master_list = signature_lists
                .get(index_with_length_over_one)
                .copied()
                .unwrap_or_default();
            let mut results: SliceBuf<SignatureId> = SliceBuf::clone_of(master_list);
            for signatures in signature_lists.iter().copied() {
                if !signatures.same(master_list) {
                    let signature = signatures.at(0usize);
                    self.assert(!signature.is_nil(), "getUnionSignatures bails early on empty signature lists and should not have empty lists on second pass");
                    let type_parameters = self.signatures[signature].type_parameters;
                    let mut mismatch = false;
                    if type_parameters.len() != 0 {
                        for i in 0..results.items.len() {
                            let s = results.at(i);
                            let s_type_parameters = self.signatures[s].type_parameters;
                            if s_type_parameters.len() != 0
                                && !self.compare_type_parameters_identical(
                                    type_parameters,
                                    s_type_parameters,
                                )
                            {
                                mismatch = true;
                                break;
                            }
                        }
                    }
                    if mismatch {
                        results = SliceBuf::nil();
                    } else if !results.is_nil() {
                        // core.Map: a new list of the same length.
                        let mut mapped = SliceBuf::make(0, results.len());
                        for i in 0..results.items.len() {
                            let sig = results.at(i);
                            let combined = self.combine_union_or_intersection_member_signatures(
                                sig, signature, true,
                            );
                            mapped.push(combined);
                        }
                        results = mapped;
                    }
                    if results.is_nil() {
                        break;
                    }
                }
            }
            result = results;
        }
        self.list(&result)
    }
}

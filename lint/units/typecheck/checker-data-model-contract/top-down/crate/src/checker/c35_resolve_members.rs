// checker.go 21226-21295 (c35_resolve_members): getUnionSignatures, where nil and empty lists differ and a list is found by identity.
use crate::checker::checker::Checker;
use crate::checker::ids::SignatureId;
use crate::tscore::golang::{List, SliceBuf};
use crate::tscore::ids::{SymbolId, TypeId};

impl<'a> Checker<'a> {
    // The signatures of a union type are those signatures that are present in each of the constituent types: see checker.go 21222.
    pub fn get_union_signatures(
        &mut self,
        signature_lists: &[List<'a, SignatureId>],
    ) -> List<'a, SignatureId> {
        let mut result: SliceBuf<SignatureId> = SliceBuf::nil();
        let mut index_with_length_over_one = 0;
        let mut count_length_over_one = 0;
        for (i, &signatures) in signature_lists.iter().enumerate() {
            if signatures.len() == 0 {
                return List::NIL;
            }
            if signatures.len() > 1 {
                index_with_length_over_one = i;
                count_length_over_one += 1;
            }
            for signature in signatures.iter() {
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
                                let mapped = self.signatures[sig].this_parameter;
                                if !mapped.is_nil() {
                                    first_this_parameter_of_union_signatures = mapped;
                                    break;
                                }
                            }
                            if !first_this_parameter_of_union_signatures.is_nil() {
                                let mut this_types: SliceBuf<TypeId> = SliceBuf::nil();
                                for sig in union_signatures.iter() {
                                    let sig_this_parameter = self.signatures[sig].this_parameter;
                                    if !sig_this_parameter.is_nil() {
                                        let mapped = self.get_type_of_symbol(sig_this_parameter);
                                        if !mapped.is_nil() {
                                            this_types.push(mapped);
                                        }
                                    }
                                }
                                let this_types = self.list(&this_types);
                                let this_type = self.get_intersection_type(this_types);
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
            // No signature subsumed all the others: try one signature that handles all of them, see checker.go 21268.
            let Some(&master_list) = signature_lists.get(index_with_length_over_one) else {
                self.index_out_of_range(
                    "getUnionSignatures: signatureLists[indexWithLengthOverOne]",
                );
                return self.list(&result);
            };
            let mut results: SliceBuf<SignatureId> = SliceBuf::nil();
            results.extend(master_list);
            for &signatures in signature_lists {
                if !signatures.same(master_list) {
                    let signature = signatures.at(0usize);
                    self.assert(
                        !signature.is_nil(),
                        "getUnionSignatures bails early on empty signature lists and should not have empty lists on second pass",
                    );
                    let signature_type_parameters = self.signatures[signature].type_parameters;
                    if signature_type_parameters.len() != 0 && {
                        let current = results.items.clone();
                        self.some(&current, |c, s| {
                            let s_type_parameters = c.signatures[s].type_parameters;
                            s_type_parameters.len() != 0
                                && !c.compare_type_parameters_identical(
                                    signature_type_parameters,
                                    s_type_parameters,
                                )
                        })
                    } {
                        results = SliceBuf::nil();
                    } else {
                        let mut mapped: SliceBuf<SignatureId> = if results.is_nil() {
                            SliceBuf::nil()
                        } else {
                            SliceBuf::make(0, results.len())
                        };
                        for i in 0..results.len() {
                            let sig = results.at(i);
                            mapped.push(self.combine_union_or_intersection_member_signatures(
                                sig, signature, true,
                            ));
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

    // Stand-ins for the callees of other layers.
    pub fn find_matching_signature(
        &mut self,
        signature_list: &[SignatureId],
        signature: SignatureId,
        partial_match: bool,
        ignore_this_types: bool,
        ignore_return_types: bool,
    ) -> SignatureId {
        let _ = (
            signature_list,
            signature,
            partial_match,
            ignore_this_types,
            ignore_return_types,
        );
        self.stand_ins.record("findMatchingSignature");
        SignatureId::NIL
    }
    pub fn find_matching_signatures(
        &mut self,
        signature_lists: &[List<'a, SignatureId>],
        signature: SignatureId,
        list_index: isize,
    ) -> List<'a, SignatureId> {
        let _ = (signature_lists, signature, list_index);
        self.stand_in("findMatchingSignatures")
    }
    pub fn create_symbol_with_type(&mut self, source: SymbolId, t: TypeId) -> SymbolId {
        let _ = (source, t);
        self.stand_in("createSymbolWithType")
    }
    pub fn create_union_signature(
        &mut self,
        signature: SignatureId,
        union_signatures: List<'a, SignatureId>,
    ) -> SignatureId {
        let _ = (signature, union_signatures);
        self.stand_in("createUnionSignature")
    }
    pub fn compare_type_parameters_identical(
        &mut self,
        source_params: List<'a, TypeId>,
        target_params: List<'a, TypeId>,
    ) -> bool {
        let _ = (source_params, target_params);
        self.stand_in("compareTypeParametersIdentical")
    }
    // The stand-in makes a signature of its own, so that a test sees which lists were combined.
    pub fn combine_union_or_intersection_member_signatures(
        &mut self,
        left: SignatureId,
        right: SignatureId,
        is_union: bool,
    ) -> SignatureId {
        let _ = is_union;
        self.stand_ins
            .record("combineUnionOrIntersectionMemberSignatures");
        let combined = self.new_signature(List::NIL, List::NIL, TypeId::NIL);
        self.signatures[combined].target = left;
        self.signatures[combined].mapper = self.signatures[right].mapper;
        combined
    }
    pub fn get_intersection_type(&mut self, types: List<'a, TypeId>) -> TypeId {
        let _ = types;
        self.stand_in("getIntersectionType")
    }
    pub fn get_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        let _ = symbol;
        self.stand_in("getTypeOfSymbol")
    }
}

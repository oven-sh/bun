// mapper.go 26-326: Map and MapsThisOnly. Replaces `Checker::map` of conventions-scratch/rust/fn3_instantiate.rs, Kind stays `mapper_kind`.
use crate::checker::Checker;
use crate::ids::*;
use crate::types::{FunctionMapper, TypeMapper};

impl<'a> Checker<'a> {
    // m.Map(t). Merged and Composite chains grow with the program, so the entry checks the stack.
    pub fn map(&mut self, m: TypeMapperId, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        match self.type_mappers[m] {
            TypeMapper::Simple { source, target } => {
                if t == source {
                    return target;
                }
                t
            }
            TypeMapper::Array { sources, targets } => {
                for (i, s) in sources.iter().enumerate() {
                    if t == s {
                        return targets.at(i);
                    }
                }
                t
            }
            TypeMapper::ArrayToSingle { sources, target } => {
                if sources.iter().any(|s| s == t) {
                    return target;
                }
                t
            }
            TypeMapper::Deferred {
                sources,
                parent,
                type_parameters,
            } => {
                for (i, s) in sources.iter().enumerate() {
                    if t == s {
                        return self.get_effective_type_argument_at_index(
                            parent,
                            type_parameters,
                            i as isize,
                        );
                    }
                }
                t
            }
            TypeMapper::Function(f) => self.call_function_mapper(f, t),
            TypeMapper::Merged { m1, m2 } => {
                let t1 = self.map(m1, t);
                self.map(m2, t1)
            }
            TypeMapper::Composite { m1, m2 } => {
                let t1 = self.map(m1, t);
                if t1 != t {
                    return self.instantiate_type(t1, m2);
                }
                self.map(m2, t)
            }
            TypeMapper::Inference { n, fixing } => self.map_inference(n, fixing, t),
            TypeMapper::Nil => t,
        }
    }

    // m.MapsThisOnly()
    pub fn maps_this_only(&mut self, m: TypeMapperId) -> bool {
        match self.type_mappers[m] {
            TypeMapper::Simple { source, .. } => self.is_this_type_parameter(source),
            TypeMapper::Array { sources, .. }
            | TypeMapper::ArrayToSingle { sources, .. }
            | TypeMapper::Deferred { sources, .. } => {
                sources.len() == 1 && self.is_this_type_parameter(sources.at(0usize))
            }
            _ => false,
        }
    }

    fn call_function_mapper(&mut self, f: FunctionMapper, t: TypeId) -> TypeId {
        match f {
            FunctionMapper::UniqueLiteral => self.get_unique_literal_type_for_type_parameter(t),
            FunctionMapper::ReportUnreliable => self.report_unreliable_worker(t),
            FunctionMapper::ReportUnmeasurable => self.report_unmeasurable_worker(t),
            FunctionMapper::Restrictive => self.restrictive_mapper_worker(t),
            FunctionMapper::Permissive => self.permissive_mapper_worker(t),
        }
    }

    // InferenceTypeMapper.Map: the loop over n.inferences belongs to the inference layer.
    fn map_inference(&mut self, n: InferenceContextId, fixing: bool, t: TypeId) -> TypeId {
        let _ = (n, fixing, t);
        self.stand_in("InferenceTypeMapper.Map")
    }

    pub fn get_effective_type_argument_at_index(
        &mut self,
        node: NodeId,
        type_parameters: crate::golang::List<'a, TypeId>,
        index: isize,
    ) -> TypeId {
        let _ = (node, type_parameters, index);
        self.stand_in("getEffectiveTypeArgumentAtIndex")
    }

    pub fn is_this_type_parameter(&mut self, t: TypeId) -> bool {
        self.types[t]
            .flags
            .intersects(crate::flags::TypeFlags::TYPE_PARAMETER)
            && self.as_type_parameter(t).is_this_type
    }

    pub fn get_unique_literal_type_for_type_parameter(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("getUniqueLiteralTypeForTypeParameter")
    }

    pub fn report_unmeasurable_worker(&mut self, t: TypeId) -> TypeId {
        t
    }

    pub fn restrictive_mapper_worker(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("restrictiveMapperWorker")
    }

    pub fn permissive_mapper_worker(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("permissiveMapperWorker")
    }
}

// checker/mapper.go: the nine mappers as one record in an arena of the checker, Map, Kind, MapsThisOnly and the factories.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{TypeFlags, TypeMapperKind};
use crate::checker::ids::{InferenceContextId, TypeMapperId};
use crate::tscore::golang::{GoIndex, List};
use crate::tscore::ids::{NodeId, TypeId};
use std::cell::Cell;

// The targets of an ArrayTypeMapper. `Cells` is a slice that its maker keeps writing after the mapper exists (checker.go 22090).
#[derive(Clone, Copy, Default)]
pub enum MapperTargets<'a> {
    #[default]
    Nil,
    List(List<'a, TypeId>),
    Cells(&'a [Cell<TypeId>]),
}

impl MapperTargets<'_> {
    pub fn len(self) -> isize {
        match self {
            MapperTargets::Nil => 0,
            MapperTargets::List(list) => list.len(),
            MapperTargets::Cells(cells) => cells.len() as isize,
        }
    }
    pub fn at(self, index: impl GoIndex) -> TypeId {
        match self {
            MapperTargets::Nil => TypeId::NIL,
            MapperTargets::List(list) => list.at(index),
            MapperTargets::Cells(cells) => index
                .to_index()
                .and_then(|i| cells.get(i))
                .map_or(TypeId::NIL, Cell::get),
        }
    }
}

// The five method values that NewChecker wraps with newFunctionTypeMapper (checker.go 1022-1026), in upstream's order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FunctionMapper {
    UniqueLiteral,
    ReportUnreliable,
    ReportUnmeasurable,
    Restrictive,
    Permissive,
}

#[derive(Clone, Copy, Default)]
pub enum TypeMapper<'a> {
    #[default]
    Nil,
    Simple {
        source: TypeId,
        target: TypeId,
    },
    Array {
        sources: List<'a, TypeId>,
        targets: MapperTargets<'a>,
    },
    ArrayToSingle {
        sources: List<'a, TypeId>,
        target: TypeId,
    },
    // The only maker is getInferredTypeParameterConstraint (checker.go 17237): target i is getEffectiveTypeArgumentAtIndex(parent, type_parameters, i).
    Deferred {
        sources: List<'a, TypeId>,
        parent: NodeId,
        type_parameters: List<'a, TypeId>,
    },
    Function(FunctionMapper),
    Merged {
        m1: TypeMapperId,
        m2: TypeMapperId,
    },
    Composite {
        m1: TypeMapperId,
        m2: TypeMapperId,
    },
    Inference {
        n: InferenceContextId,
        fixing: bool,
    },
}

impl<'a> Checker<'a> {
    pub fn new_simple_type_mapper(&mut self, source: TypeId, target: TypeId) -> TypeMapperId {
        self.type_mappers
            .alloc(TypeMapper::Simple { source, target })
    }

    pub fn new_array_type_mapper(
        &mut self,
        sources: List<'a, TypeId>,
        targets: MapperTargets<'a>,
    ) -> TypeMapperId {
        self.type_mappers
            .alloc(TypeMapper::Array { sources, targets })
    }

    pub fn new_array_to_single_type_mapper(
        &mut self,
        sources: List<'a, TypeId>,
        target: TypeId,
    ) -> TypeMapperId {
        self.type_mappers
            .alloc(TypeMapper::ArrayToSingle { sources, target })
    }

    pub fn new_merged_type_mapper(&mut self, m1: TypeMapperId, m2: TypeMapperId) -> TypeMapperId {
        self.type_mappers.alloc(TypeMapper::Merged { m1, m2 })
    }

    pub fn new_composite_type_mapper(
        &mut self,
        m1: TypeMapperId,
        m2: TypeMapperId,
    ) -> TypeMapperId {
        self.type_mappers.alloc(TypeMapper::Composite { m1, m2 })
    }

    pub fn new_inference_type_mapper(
        &mut self,
        n: InferenceContextId,
        fixing: bool,
    ) -> TypeMapperId {
        self.type_mappers.alloc(TypeMapper::Inference { n, fixing })
    }

    // newTypeMapper: `sources[0]` and `targets[0]` are read now, the array form keeps both slices.
    pub fn new_type_mapper(
        &mut self,
        sources: List<'a, TypeId>,
        targets: MapperTargets<'a>,
    ) -> TypeMapperId {
        if sources.len() == 1 {
            if targets.len() == 0 {
                self.index_out_of_range("newTypeMapper: targets[0]");
            }
            return self.new_simple_type_mapper(sources.at(0usize), targets.at(0usize));
        }
        self.new_array_type_mapper(sources, targets)
    }

    pub fn combine_type_mappers(&mut self, m1: TypeMapperId, m2: TypeMapperId) -> TypeMapperId {
        if !m1.is_nil() {
            return self.new_composite_type_mapper(m1, m2);
        }
        m2
    }

    pub fn merge_type_mappers(&mut self, m1: TypeMapperId, m2: TypeMapperId) -> TypeMapperId {
        if !m1.is_nil() {
            return self.new_merged_type_mapper(m1, m2);
        }
        m2
    }

    pub fn prepend_type_mapping(
        &mut self,
        source: TypeId,
        target: TypeId,
        mapper: TypeMapperId,
    ) -> TypeMapperId {
        if mapper.is_nil() {
            return self.new_simple_type_mapper(source, target);
        }
        let simple = self.new_simple_type_mapper(source, target);
        self.new_merged_type_mapper(simple, mapper)
    }

    pub fn append_type_mapping(
        &mut self,
        mapper: TypeMapperId,
        source: TypeId,
        target: TypeId,
    ) -> TypeMapperId {
        if mapper.is_nil() {
            return self.new_simple_type_mapper(source, target);
        }
        let simple = self.new_simple_type_mapper(source, target);
        self.new_merged_type_mapper(mapper, simple)
    }

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
            // A nil *TypeMapper: upstream dereferences nil here.
            TypeMapper::Nil => self.fail("nil TypeMapper"),
        }
    }

    // m.Kind(): Unknown for ArrayToSingle, Deferred, Function, Composite and Inference, as TypeMapperBase answers.
    pub fn mapper_kind(&self, m: TypeMapperId) -> TypeMapperKind {
        match self.type_mappers[m] {
            TypeMapper::Simple { .. } => TypeMapperKind::SIMPLE,
            TypeMapper::Array { .. } => TypeMapperKind::ARRAY,
            TypeMapper::Merged { .. } => TypeMapperKind::MERGED,
            _ => TypeMapperKind::UNKNOWN,
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

    pub fn is_this_type_parameter(&mut self, t: TypeId) -> bool {
        self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER)
            && self.as_type_parameter(t).is_this_type
    }

    pub fn get_effective_type_argument_at_index(
        &mut self,
        node: NodeId,
        type_parameters: List<'a, TypeId>,
        index: isize,
    ) -> TypeId {
        let _ = (node, type_parameters, index);
        self.stand_in("getEffectiveTypeArgumentAtIndex")
    }

    pub fn get_unique_literal_type_for_type_parameter(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("getUniqueLiteralTypeForTypeParameter")
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

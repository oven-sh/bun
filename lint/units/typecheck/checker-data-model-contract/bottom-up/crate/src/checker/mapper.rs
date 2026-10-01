// checker/mapper.go, whole. A mapper is a record of the checker; the upstream constructors become methods that allocate it.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{TypeFlags, TypeMapperKind};
use crate::tscore::golang::{GoIndex, List, LiveList, SliceBuf};
use crate::tscore::ids::{InferenceContextId, NodeId, TypeId, TypeMapperId};

// The five method values that NewChecker wraps with newFunctionTypeMapper (checker.go 1022-1026).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FunctionMapper {
    UniqueLiteral,
    ReportUnreliable,
    ReportUnmeasurable,
    Restrictive,
    Permissive,
}

// ArrayTypeMapper.targets: a frozen list, or the list that fillMissingTypeArguments still writes (checker.go 22090).
#[derive(Clone, Copy)]
pub enum Targets<'a> {
    Frozen(List<'a, TypeId>),
    Live(LiveList<'a, TypeId>),
}

impl<'a> From<List<'a, TypeId>> for Targets<'a> {
    fn from(list: List<'a, TypeId>) -> Self {
        Targets::Frozen(list)
    }
}
impl<'a> From<LiveList<'a, TypeId>> for Targets<'a> {
    fn from(list: LiveList<'a, TypeId>) -> Self {
        Targets::Live(list)
    }
}

impl Targets<'_> {
    pub fn at(self, index: impl GoIndex) -> TypeId {
        match self {
            Targets::Frozen(list) => list.at(index),
            Targets::Live(list) => list.at(index),
        }
    }
    pub fn len(self) -> isize {
        match self {
            Targets::Frozen(list) => list.len(),
            Targets::Live(list) => list.len(),
        }
    }
}

// TypeMapperData. Kind() is Unknown for ArrayToSingle, Deferred, Function, Composite and Inference, as TypeMapperBase answers.
#[derive(Default)]
pub enum TypeMapper<'a> {
    #[default]
    Nil,
    Simple {
        source: TypeId,
        target: TypeId,
    },
    Array {
        sources: List<'a, TypeId>,
        targets: Targets<'a>,
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

// Factory functions. The constructors are free functions upstream: they take the checker, which owns the mappers, first.

pub fn new_type_mapper<'a>(
    c: &mut Checker<'a>,
    sources: List<'a, TypeId>,
    targets: impl Into<Targets<'a>>,
) -> TypeMapperId {
    let targets = targets.into();
    if sources.len() == 1 {
        return new_simple_type_mapper(c, sources.at(0usize), targets.at(0usize));
    }
    new_array_type_mapper(c, sources, targets)
}

pub fn merge_type_mappers(c: &mut Checker<'_>, m1: TypeMapperId, m2: TypeMapperId) -> TypeMapperId {
    if !m1.is_nil() {
        return new_merged_type_mapper(c, m1, m2);
    }
    m2
}

pub fn prepend_type_mapping(
    c: &mut Checker<'_>,
    source: TypeId,
    target: TypeId,
    mapper: TypeMapperId,
) -> TypeMapperId {
    if mapper.is_nil() {
        return new_simple_type_mapper(c, source, target);
    }
    let simple = new_simple_type_mapper(c, source, target);
    new_merged_type_mapper(c, simple, mapper)
}

pub fn append_type_mapping(
    c: &mut Checker<'_>,
    mapper: TypeMapperId,
    source: TypeId,
    target: TypeId,
) -> TypeMapperId {
    if mapper.is_nil() {
        return new_simple_type_mapper(c, source, target);
    }
    let simple = new_simple_type_mapper(c, source, target);
    new_merged_type_mapper(c, mapper, simple)
}

// SimpleTypeMapper

pub fn new_simple_type_mapper(c: &mut Checker<'_>, source: TypeId, target: TypeId) -> TypeMapperId {
    c.type_mappers.alloc(TypeMapper::Simple { source, target })
}

// ArrayTypeMapper

pub fn new_array_type_mapper<'a>(
    c: &mut Checker<'a>,
    sources: List<'a, TypeId>,
    targets: Targets<'a>,
) -> TypeMapperId {
    c.type_mappers.alloc(TypeMapper::Array { sources, targets })
}

// ArrayToSingleTypeMapper

pub fn new_array_to_single_type_mapper<'a>(
    c: &mut Checker<'a>,
    sources: List<'a, TypeId>,
    target: TypeId,
) -> TypeMapperId {
    c.type_mappers
        .alloc(TypeMapper::ArrayToSingle { sources, target })
}

// DeferredTypeMapper

pub fn new_deferred_type_mapper<'a>(
    c: &mut Checker<'a>,
    sources: List<'a, TypeId>,
    parent: NodeId,
    type_parameters: List<'a, TypeId>,
) -> TypeMapperId {
    c.type_mappers.alloc(TypeMapper::Deferred {
        sources,
        parent,
        type_parameters,
    })
}

// FunctionTypeMapper

pub fn new_function_type_mapper(c: &mut Checker<'_>, f: FunctionMapper) -> TypeMapperId {
    c.type_mappers.alloc(TypeMapper::Function(f))
}

// MergedTypeMapper

pub fn new_merged_type_mapper(
    c: &mut Checker<'_>,
    m1: TypeMapperId,
    m2: TypeMapperId,
) -> TypeMapperId {
    c.type_mappers.alloc(TypeMapper::Merged { m1, m2 })
}

// CompositeTypeMapper

pub fn new_composite_type_mapper(
    c: &mut Checker<'_>,
    m1: TypeMapperId,
    m2: TypeMapperId,
) -> TypeMapperId {
    c.type_mappers.alloc(TypeMapper::Composite { m1, m2 })
}

// utilities.go 1013
pub fn is_this_type_parameter(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) && c.as_type_parameter(t).is_this_type
}

impl<'a> Checker<'a> {
    pub fn combine_type_mappers(&mut self, m1: TypeMapperId, m2: TypeMapperId) -> TypeMapperId {
        if !m1.is_nil() {
            return new_composite_type_mapper(self, m1, m2);
        }
        m2
    }

    pub fn map_type_with_composite_mapper(
        &mut self,
        t: TypeId,
        m1: TypeMapperId,
        m2: TypeMapperId,
    ) -> TypeId {
        if m1.is_nil() {
            return self.map(m2, t);
        }
        let t1 = self.map(m1, t);
        if t1 != t {
            return self.instantiate_type(t1, m2);
        }
        self.map(m2, t)
    }

    // Maps forward-references to later types parameters to the empty object type. This is used during inference when instantiating type parameter defaults.
    pub fn new_backreference_mapper(
        &mut self,
        context: InferenceContextId,
        index: isize,
    ) -> TypeMapperId {
        let inferences = self.inference_contexts[context].inferences;
        let forward_inferences = inferences.sub(index, inferences.len());
        let mut type_parameters = SliceBuf::make(0, forward_inferences.len());
        for i in forward_inferences.iter() {
            type_parameters.push(self.inference_infos[i].type_parameter);
        }
        let type_parameters = self.list(&type_parameters);
        let unknown_type = self.unknown_type;
        new_array_to_single_type_mapper(self, type_parameters, unknown_type)
    }

    // InferenceTypeMapper

    pub fn new_inference_type_mapper(
        &mut self,
        n: InferenceContextId,
        fixing: bool,
    ) -> TypeMapperId {
        self.type_mappers.alloc(TypeMapper::Inference { n, fixing })
    }

    // m.Map(t). Merged and Composite chains grow with the program, so the entry tests the stack.
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
            TypeMapper::Inference { n, fixing } => {
                let inferences = self.inference_contexts[n].inferences;
                for (i, inference) in inferences.iter().enumerate() {
                    if t == self.inference_infos[inference].type_parameter {
                        if fixing && !self.inference_infos[inference].is_fixed {
                            // Before we commit to a particular inference (and thus lock out any further inferences), we infer from any intra-expression inference sites we have collected.
                            self.infer_from_intra_expression_sites(n);
                            crate::checker::inference::clear_cached_inferences(self, inferences);
                            self.inference_infos[inference].is_fixed = true;
                        }
                        return self.get_inferred_type(n, i as isize);
                    }
                }
                t
            }
            TypeMapper::Nil => t,
        }
    }

    // m.Kind()
    pub fn mapper_kind(&self, m: TypeMapperId) -> TypeMapperKind {
        match self.type_mappers[m] {
            TypeMapper::Simple { .. } => TypeMapperKind::SIMPLE,
            TypeMapper::Array { .. } => TypeMapperKind::ARRAY,
            TypeMapper::Merged { .. } => TypeMapperKind::MERGED,
            _ => TypeMapperKind::UNKNOWN,
        }
    }

    // m.MapsThisOnly()
    pub fn maps_this_only(&self, m: TypeMapperId) -> bool {
        match self.type_mappers[m] {
            TypeMapper::Simple { source, .. } => is_this_type_parameter(self, source),
            TypeMapper::Array { sources, .. }
            | TypeMapper::ArrayToSingle { sources, .. }
            | TypeMapper::Deferred { sources, .. } => {
                sources.len() == 1 && is_this_type_parameter(self, sources.at(0usize))
            }
            _ => false,
        }
    }

    // FunctionTypeMapper.Map: `m.fn(t)`
    fn call_function_mapper(&mut self, f: FunctionMapper, t: TypeId) -> TypeId {
        match f {
            FunctionMapper::UniqueLiteral => self.get_unique_literal_type_for_type_parameter(t),
            FunctionMapper::ReportUnreliable => self.report_unreliable_worker(t),
            FunctionMapper::ReportUnmeasurable => self.report_unmeasurable_worker(t),
            FunctionMapper::Restrictive => self.restrictive_mapper_worker(t),
            FunctionMapper::Permissive => self.permissive_mapper_worker(t),
        }
    }
}

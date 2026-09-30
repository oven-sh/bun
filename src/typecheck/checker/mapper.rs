// checker/mapper.go: the type mappers. A mapper is a record of the checker named by its id: the constructors take the checker first, and `m.Map(t)`, `m.Kind()` and `m.MapsThisOnly()` are `c.map(m, t)`, `c.mapper_kind(m)` and `c.maps_this_only(m)`.
use crate::ast::NodeId;
use crate::checker::types::checker_flags;
use crate::checker::{
    Checker, InferenceContextId, TypeId, TypeMapperId, clear_cached_inferences,
    is_this_type_parameter,
};
use crate::core::{List, LiveList};

// TypeMapperKind

checker_flags!(TypeMapperKind: i32 {
    UNKNOWN = 0,
    SIMPLE = 1,
    ARRAY = 2,
    MERGED = 3,
});

// TypeMapper

// The function of a FunctionTypeMapper: one of the five method values that NewChecker wraps with newFunctionTypeMapper.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FunctionMapper {
    UniqueLiteral,
    ReportUnreliable,
    ReportUnmeasurable,
    Restrictive,
    Permissive,
}

// The targets of an ArrayTypeMapper: a list, or the list that fillMissingTypeArguments still writes while a mapper over it is in use.
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
    // `targets[index]`: the nil type for an index outside the list, where upstream panics.
    pub fn at(self, index: usize) -> TypeId {
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

// TypeMapperData

// The implementations of TypeMapperData. A DeferredTypeMapper holds what its one maker closes over: target i is getEffectiveTypeArgumentAtIndex(parent, type_parameters, i). An InferenceTypeMapper names its context.
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
        targets: Targets<'a>,
    },
    ArrayToSingle {
        sources: List<'a, TypeId>,
        target: TypeId,
    },
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
    // TypeMapper.Map. Merged and composite mappers form chains that grow with the program, so the entry tests the stack.
    pub fn map(&mut self, m: TypeMapperId, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let mapper = self.type_mappers[m];
        match mapper {
            // TypeMapperBase.Map
            TypeMapper::Nil => t,
            // SimpleTypeMapper.Map
            TypeMapper::Simple { source, target } => {
                if t == source {
                    return target;
                }
                t
            }
            // ArrayTypeMapper.Map
            TypeMapper::Array { sources, targets } => {
                for (i, &s) in sources.as_slice().iter().enumerate() {
                    if t == s {
                        return targets.at(i);
                    }
                }
                t
            }
            // ArrayToSingleTypeMapper.Map
            TypeMapper::ArrayToSingle { sources, target } => {
                if sources.as_slice().contains(&t) {
                    return target;
                }
                t
            }
            // DeferredTypeMapper.Map
            TypeMapper::Deferred {
                sources,
                parent,
                type_parameters,
            } => {
                for (i, &s) in sources.as_slice().iter().enumerate() {
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
            // FunctionTypeMapper.Map
            TypeMapper::Function(f) => match f {
                FunctionMapper::UniqueLiteral => self.get_unique_literal_type_for_type_parameter(t),
                FunctionMapper::ReportUnreliable => self.report_unreliable_worker(t),
                FunctionMapper::ReportUnmeasurable => self.report_unmeasurable_worker(t),
                FunctionMapper::Restrictive => self.restrictive_mapper_worker(t),
                FunctionMapper::Permissive => self.permissive_mapper_worker(t),
            },
            // MergedTypeMapper.Map
            TypeMapper::Merged { m1, m2 } => {
                let t1 = self.map(m1, t);
                self.map(m2, t1)
            }
            // CompositeTypeMapper.Map
            TypeMapper::Composite { m1, m2 } => {
                let t1 = self.map(m1, t);
                if t1 != t {
                    return self.instantiate_type(t1, m2);
                }
                self.map(m2, t)
            }
            // InferenceTypeMapper.Map
            TypeMapper::Inference { n, fixing } => {
                let inferences = self.inference_contexts[n].inferences;
                let len = usize::try_from(inferences.len()).unwrap_or(0);
                for i in 0..len {
                    let inference = inferences.at(i);
                    if t == self.inference_infos[inference].type_parameter {
                        if fixing && !self.inference_infos[inference].is_fixed {
                            // Before we commit to a particular inference (and thus lock out any further inferences), we infer from any intra-expression inference sites we have collected.
                            self.infer_from_intra_expression_sites(n);
                            let inferences = self.inference_contexts[n].inferences;
                            clear_cached_inferences(self, inferences);
                            self.inference_infos[inference].is_fixed = true;
                        }
                        return self.get_inferred_type(n, i as isize);
                    }
                }
                t
            }
        }
    }

    // TypeMapper.Kind: Unknown for every mapper but a simple, an array and a merged one, as TypeMapperBase answers.
    pub fn mapper_kind(&self, m: TypeMapperId) -> TypeMapperKind {
        match self.type_mappers[m] {
            TypeMapper::Simple { .. } => TypeMapperKind::SIMPLE,
            TypeMapper::Array { .. } => TypeMapperKind::ARRAY,
            TypeMapper::Merged { .. } => TypeMapperKind::MERGED,
            _ => TypeMapperKind::UNKNOWN,
        }
    }

    // TypeMapper.MapsThisOnly
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
}

// Factory functions

pub fn new_type_mapper<'a>(
    c: &mut Checker<'a>,
    sources: List<'a, TypeId>,
    targets: impl Into<Targets<'a>>,
) -> TypeMapperId {
    let targets = targets.into();
    if sources.len() == 1 {
        return new_simple_type_mapper(c, sources.at(0usize), targets.at(0));
    }
    new_array_type_mapper(c, sources, targets)
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

impl<'a> Checker<'a> {
    // Maps forward-references to later types parameters to the empty object type. This is used during inference when instantiating type parameter defaults.
    pub fn new_backreference_mapper(
        &mut self,
        context: InferenceContextId,
        index: isize,
    ) -> TypeMapperId {
        let inferences = self.inference_contexts[context].inferences;
        let type_parameters = if inferences.is_nil() {
            List::NIL
        } else {
            let start = usize::try_from(index).unwrap_or(0);
            let end = usize::try_from(inferences.len()).unwrap_or(0);
            let mut type_parameters: Vec<TypeId> = Vec::with_capacity(end.saturating_sub(start));
            for i in start..end {
                type_parameters.push(self.inference_infos[inferences.at(i)].type_parameter);
            }
            self.list_of(&type_parameters)
        };
        let unknown_type = self.unknown_type;
        new_array_to_single_type_mapper(self, type_parameters, unknown_type)
    }
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

// InferenceTypeMapper

impl<'a> Checker<'a> {
    pub fn new_inference_type_mapper(
        &mut self,
        n: InferenceContextId,
        fixing: bool,
    ) -> TypeMapperId {
        self.type_mappers.alloc(TypeMapper::Inference { n, fixing })
    }
}

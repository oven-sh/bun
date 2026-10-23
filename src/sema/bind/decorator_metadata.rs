use smallvec::{SmallVec, smallvec};

use super::{Binding, ImplicitReference, ImplicitReferenceKind};
use crate::atom::{Atom, known};
use crate::hir::*;

pub type MetadataList = SmallVec<[Metadata; 4]>;
pub type DesignEntries = SmallVec<[(DesignKey, DesignValue); 3]>;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Metadata {
    None,
    Never,
    Unknown,
    Any,
    Void,
    Null,
    Undefined,
    Function,
    Array,
    Boolean,
    String,
    Object,
    Number,
    BigInt,
    Symbol,
    Promise,
    Name(TypeNodeId),
    QualifiedName(TypeNodeId),
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum MetadataGlobal {
    Object,
    String,
    Number,
    Function,
    Boolean,
    Array,
    BigInt,
    Symbol,
    Promise,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum MetadataReference {
    TypeName(TypeNodeId),
    Global(ClassId, MetadataGlobal),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SerializedMetadata {
    Undefined,
    Global(MetadataGlobal),
    GuardedGlobal(MetadataGlobal),
    GuardedName(TypeNodeId),
    GuardedQualifiedName(TypeNodeId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DesignKey {
    Type,
    ParameterTypes,
    ReturnType,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum DesignValue {
    Type(Metadata),
    Types(MetadataList),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct VisitedTypeName {
    pub annotated: NodeData,
    pub node: TypeNodeId,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum MergeKind {
    Union,
    Intersection,
}

#[derive(Copy, Clone)]
enum Step {
    Collect(TypeNodeId),
    CollectPart(MergeKind, TypeNodeId),
    Merge(MergeKind, Metadata),
    SetArray,
    SetIndexedAccess,
    SaveResult,
    ResetResult,
    FinishConditional { no: TypeNodeId },
}

type Steps = SmallVec<[Step; 8]>;

impl MetadataGlobal {
    pub fn name(self) -> Atom {
        match self {
            MetadataGlobal::Object => known::Object,
            MetadataGlobal::String => known::String,
            MetadataGlobal::Number => known::Number,
            MetadataGlobal::Function => known::Function,
            MetadataGlobal::Boolean => known::Boolean,
            MetadataGlobal::Array => known::Array,
            MetadataGlobal::BigInt => known::BigInt,
            MetadataGlobal::Symbol => known::Symbol,
            MetadataGlobal::Promise => known::Promise,
        }
    }
}

impl Metadata {
    pub fn serialized(self) -> SerializedMetadata {
        match self {
            Metadata::None | Metadata::Any | Metadata::Unknown | Metadata::Object => {
                SerializedMetadata::Global(MetadataGlobal::Object)
            }
            Metadata::Never | Metadata::Undefined | Metadata::Null | Metadata::Void => {
                SerializedMetadata::Undefined
            }
            Metadata::String => SerializedMetadata::Global(MetadataGlobal::String),
            Metadata::Number => SerializedMetadata::Global(MetadataGlobal::Number),
            Metadata::Function => SerializedMetadata::Global(MetadataGlobal::Function),
            Metadata::Boolean => SerializedMetadata::Global(MetadataGlobal::Boolean),
            Metadata::Array => SerializedMetadata::Global(MetadataGlobal::Array),
            Metadata::Promise => SerializedMetadata::Global(MetadataGlobal::Promise),
            Metadata::BigInt => SerializedMetadata::GuardedGlobal(MetadataGlobal::BigInt),
            Metadata::Symbol => SerializedMetadata::GuardedGlobal(MetadataGlobal::Symbol),
            Metadata::Name(node) => SerializedMetadata::GuardedName(node),
            Metadata::QualifiedName(node) => SerializedMetadata::GuardedQualifiedName(node),
        }
    }
}

impl SerializedMetadata {
    pub(super) fn globals(self) -> [Option<MetadataGlobal>; 2] {
        match self {
            SerializedMetadata::Undefined => [None, None],
            SerializedMetadata::Global(global) => [Some(global), None],
            SerializedMetadata::GuardedGlobal(global) => {
                [Some(global), Some(MetadataGlobal::Object)]
            }
            SerializedMetadata::GuardedName(_) | SerializedMetadata::GuardedQualifiedName(_) => {
                [Some(MetadataGlobal::Object), None]
            }
        }
    }
}

pub fn entity_names(hir: &File<'_>, node: TypeNodeId) -> Span<NameId> {
    let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
        debug_assert!(false, "entity_names takes a type reference");
        return Span::EMPTY;
    };
    name
}

pub fn find_metadata_binding(
    references: &[ImplicitReference],
    reference: MetadataReference,
) -> Option<Binding> {
    let found = references.binary_search_by_key(&Some(reference), |entry| match entry.kind {
        ImplicitReferenceKind::DecoratorMetadata(recorded) => Some(recorded),
        ImplicitReferenceKind::JsxFactory | ImplicitReferenceKind::JsxFragment => None,
    });
    found.ok().map(|index| references[index].binding)
}

pub fn is_legacy_decorated_member(hir: &File<'_>, member: MemberId) -> bool {
    is_decoratable_member(hir, member)
        && (has_decorators(hir, hir[member].modifiers) || has_parameter_decorator(hir, member))
}

pub(super) fn has_decorators(hir: &File<'_>, modifiers: Span<ModifierId>) -> bool {
    modifiers.iter().any(|modifier| match hir[modifier].kind {
        ModifierKind::Decorator(_) => true,
        ModifierKind::Keyword(_) => false,
    })
}

pub(super) fn is_decoratable_member(hir: &File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    if matches!(node.key, PropKey::Private(_)) {
        return false;
    }
    match node.kind {
        MemberKind::Property => true,
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => {
            node.func.is_some() && has_body(&hir[node.func])
        }
        _ => false,
    }
}

pub(super) fn has_parameter_decorator(hir: &File<'_>, member: MemberId) -> bool {
    let node = hir[member];
    match node.kind {
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => {
            let parameters = node
                .func
                .some()
                .map_or(Span::EMPTY, |function| hir[function].params);
            parameters
                .iter()
                .any(|parameter| has_decorators(hir, hir.param_modifiers(parameter)))
        }
        _ => false,
    }
}

pub(super) fn first_name(hir: &File<'_>, node: TypeNodeId) -> Option<Atom> {
    hir.texts(entity_names(hir, node)).next()
}

fn is_same_variant(a: Metadata, b: Metadata) -> bool {
    core::mem::discriminant(&a) == core::mem::discriminant(&b)
}

fn finish_merge(hir: &File<'_>, kind: MergeKind, current: &mut Metadata) -> Option<Metadata> {
    match *current {
        Metadata::Name(node) => {
            (first_name(hir, node) == Some(known::Object)).then_some(Metadata::Object)
        }
        Metadata::Any | Metadata::Object => Some(Metadata::Object),
        Metadata::Unknown if kind == MergeKind::Union => Some(Metadata::Object),
        Metadata::Never if kind == MergeKind::Intersection => Some(Metadata::Never),
        Metadata::Unknown | Metadata::Never | Metadata::Null | Metadata::Undefined => {
            *current = Metadata::None;
            None
        }
        _ => None,
    }
}

fn merge(hir: &File<'_>, kind: MergeKind, result: &mut Metadata, left: Metadata) {
    if left == Metadata::None {
        if kind == MergeKind::Intersection && *result == Metadata::Unknown {
            *result = Metadata::Undefined;
        }
        return;
    }
    if !is_same_variant(*result, left) {
        *result = match *result {
            Metadata::Undefined | Metadata::Null => left,
            Metadata::Never => match kind {
                MergeKind::Union => left,
                MergeKind::Intersection => Metadata::Never,
            },
            Metadata::Unknown => match kind {
                MergeKind::Union => Metadata::Object,
                MergeKind::Intersection => left,
            },
            _ => Metadata::Object,
        };
        return;
    }
    if let (Metadata::Name(current), Metadata::Name(previous)) = (*result, left)
        && first_name(hir, current) != first_name(hir, previous)
    {
        *result = Metadata::Object;
    }
}

fn keyword_metadata(keyword: Keyword, current: Metadata) -> Metadata {
    match keyword {
        Keyword::Any => Metadata::Any,
        Keyword::Unknown => Metadata::Unknown,
        Keyword::Never => Metadata::Never,
        Keyword::Void => Metadata::Void,
        Keyword::Undefined => Metadata::Undefined,
        Keyword::Null => Metadata::Null,
        Keyword::String => Metadata::String,
        Keyword::Number => Metadata::Number,
        Keyword::Boolean => Metadata::Boolean,
        Keyword::BigInt => Metadata::BigInt,
        Keyword::Symbol => Metadata::Symbol,
        Keyword::Object | Keyword::This => Metadata::Object,
        Keyword::Intrinsic => current,
    }
}

fn push_merged_parts(
    hir: &File<'_>,
    kind: MergeKind,
    parts: IdList<TypeNodeId>,
    steps: &mut Steps,
) {
    let mut parts = hir.ids(parts);
    let first = parts.next();
    steps.extend(parts.rev().map(|part| Step::CollectPart(kind, part)));
    steps.extend(first.map(Step::Collect));
}

pub struct MetadataCollector<'a, 's> {
    pub(super) hir: &'a File<'s>,
    visited: Vec<VisitedTypeName>,
}

impl<'a, 's> MetadataCollector<'a, 's> {
    pub fn new(hir: &'a File<'s>) -> MetadataCollector<'a, 's> {
        MetadataCollector {
            hir,
            visited: Vec::new(),
        }
    }

    pub fn visited(&self) -> &[VisitedTypeName] {
        &self.visited
    }

    pub fn collect_member(&mut self, member: MemberId) -> DesignEntries {
        let hir = self.hir;
        let data = hir[member];
        let is_decorated = has_decorators(hir, data.modifiers);
        match data.kind {
            MemberKind::Property if !is_decorated => DesignEntries::new(),
            MemberKind::Property => {
                let metadata = self.collect_annotation(NodeData::Member(member), data.ty);
                if data.flags.intersects(Flags::AMBIENT | Flags::ACCESSOR) {
                    return DesignEntries::new();
                }
                smallvec![(DesignKey::Type, DesignValue::Type(metadata))]
            }
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter if data.func.is_none() => {
                DesignEntries::new()
            }
            MemberKind::Method => {
                let parameters = self.collect_parameters(data.func, is_decorated);
                let result = self.collect_result(member, is_decorated);
                smallvec![
                    (DesignKey::Type, DesignValue::Type(Metadata::Function)),
                    (DesignKey::ParameterTypes, DesignValue::Types(parameters)),
                    (DesignKey::ReturnType, DesignValue::Type(result)),
                ]
            }
            MemberKind::Getter => {
                let result = self.collect_result(member, is_decorated);
                smallvec![
                    (DesignKey::Type, DesignValue::Type(result)),
                    (
                        DesignKey::ParameterTypes,
                        DesignValue::Types(MetadataList::new())
                    ),
                ]
            }
            MemberKind::Setter => {
                let parameters = self.collect_parameters(data.func, is_decorated);
                let first = parameters.first().copied();
                let mut entries: DesignEntries =
                    smallvec![(DesignKey::ParameterTypes, DesignValue::Types(parameters))];
                entries.extend(first.map(|first| (DesignKey::Type, DesignValue::Type(first))));
                entries
            }
            _ => DesignEntries::new(),
        }
    }

    pub fn collect_constructor(&mut self, class: ClassId, constructor: FnId) -> MetadataList {
        let is_class_decorated = has_decorators(self.hir, self.hir[class].modifiers);
        self.collect_parameters(constructor, is_class_decorated)
    }

    fn collect_parameters(&mut self, function: FnId, is_owner_decorated: bool) -> MetadataList {
        let hir = self.hir;
        let mut is_annotation_read = is_owner_decorated;
        let mut metadata = MetadataList::new();
        for parameter in hir[function].params.iter() {
            is_annotation_read |= has_decorators(hir, hir.param_modifiers(parameter));
            let data = hir[parameter];
            let is_rest = data.flags.contains(Flags::REST);
            metadata.push(if is_annotation_read && !is_rest {
                self.collect_annotation(NodeData::Param(parameter), data.ty)
            } else {
                Metadata::None
            });
        }
        metadata
    }

    fn collect_result(&mut self, member: MemberId, is_owner_decorated: bool) -> Metadata {
        if !is_owner_decorated {
            return Metadata::None;
        }
        let hir = self.hir;
        let function = &hir[hir[member].func];
        if function.ret.is_some() {
            self.collect_annotation(NodeData::Member(member), function.ret)
        } else if function.flags.contains(Flags::ASYNC) {
            Metadata::Promise
        } else {
            Metadata::Undefined
        }
    }

    fn collect_annotation(&mut self, annotated: NodeData, annotation: TypeNodeId) -> Metadata {
        if annotation.is_none() {
            return Metadata::None;
        }
        let hir = self.hir;
        let mut result = Metadata::None;
        let mut saved_results: SmallVec<[Metadata; 4]> = SmallVec::new();
        let mut steps: Steps = smallvec![Step::Collect(annotation)];
        while let Some(step) = steps.pop() {
            match step {
                Step::Collect(node) => self.collect_node(annotated, node, &mut result, &mut steps),
                Step::CollectPart(kind, part) => {
                    let mut left = result;
                    match finish_merge(hir, kind, &mut left) {
                        Some(finished) => result = finished,
                        None => steps.extend([Step::Merge(kind, left), Step::Collect(part)]),
                    }
                }
                Step::Merge(kind, left) => merge(hir, kind, &mut result, left),
                Step::SetArray => result = Metadata::Array,
                Step::SetIndexedAccess => {
                    let is_untouched = result == Metadata::None;
                    result = if is_untouched {
                        Metadata::Array
                    } else {
                        Metadata::Object
                    };
                }
                Step::SaveResult => {
                    saved_results.push(result);
                    result = Metadata::None;
                }
                Step::ResetResult => result = Metadata::None,
                Step::FinishConditional { no } => {
                    let mut left = result;
                    result = saved_results
                        .pop()
                        .expect("a conditional type saved its check type");
                    let kind = MergeKind::Intersection;
                    match finish_merge(hir, kind, &mut left) {
                        Some(finished) => result = finished,
                        None => steps.extend([Step::Merge(kind, left), Step::Collect(no)]),
                    }
                }
            }
        }
        result
    }

    fn collect_node(
        &mut self,
        annotated: NodeData,
        node: TypeNodeId,
        result: &mut Metadata,
        steps: &mut Steps,
    ) {
        let hir = self.hir;
        match hir[node].kind {
            TypeNodeKind::Keyword(keyword) => *result = keyword_metadata(keyword, *result),
            TypeNodeKind::StringLit(_) | TypeNodeKind::Template { .. } => {
                *result = Metadata::String;
            }
            TypeNodeKind::NumberLit(_) => *result = Metadata::Number,
            TypeNodeKind::BigIntLit { .. } => *result = Metadata::BigInt,
            TypeNodeKind::BoolLit(_) => *result = Metadata::Boolean,
            TypeNodeKind::Ref { name, .. } => {
                self.visited.push(VisitedTypeName { annotated, node });
                *result = match name.len() {
                    1 => Metadata::Name(node),
                    _ => Metadata::QualifiedName(node),
                };
            }
            TypeNodeKind::Array(element) => {
                steps.extend([Step::SetArray, Step::Collect(element)]);
            }
            TypeNodeKind::Tuple(_) | TypeNodeKind::Readonly(_) => *result = Metadata::Array,
            TypeNodeKind::Fn(_) => *result = Metadata::Function,
            TypeNodeKind::Object(_)
            | TypeNodeKind::Mapped(_)
            | TypeNodeKind::Keyof(_)
            | TypeNodeKind::Typeof { .. }
            | TypeNodeKind::Import {
                is_typeof: true, ..
            } => *result = Metadata::Object,
            TypeNodeKind::Import {
                is_typeof: false,
                name,
                ..
            } => {
                let is_name = matches!(*result, Metadata::Name(_) | Metadata::QualifiedName(_));
                if is_name && !name.is_empty() {
                    *result = Metadata::Object;
                }
            }
            TypeNodeKind::IndexedAccess { obj, .. } => {
                steps.extend([Step::SetIndexedAccess, Step::Collect(obj)]);
            }
            TypeNodeKind::JSDoc { ty, .. } => steps.push(Step::Collect(ty)),
            TypeNodeKind::Union(parts) => push_merged_parts(hir, MergeKind::Union, parts, steps),
            TypeNodeKind::Intersection(parts) => {
                push_merged_parts(hir, MergeKind::Intersection, parts, steps);
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => steps.extend([
                Step::FinishConditional { no },
                Step::Collect(yes),
                Step::ResetResult,
                Step::Collect(extends),
                Step::SaveResult,
                Step::Collect(check),
            ]),
            TypeNodeKind::Infer(_)
            | TypeNodeKind::UniqueSymbol
            | TypeNodeKind::Unique(_)
            | TypeNodeKind::Predicate { .. }
            | TypeNodeKind::Heritage { .. }
            | TypeNodeKind::Error => {}
        }
    }
}

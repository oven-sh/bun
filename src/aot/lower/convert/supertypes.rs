use bun_sema::check::aot::{
    ClassParent, ClassRef, MemberName, ObjectMemberKind, ObjectOrigin, ShapeKind, TupleElement,
    TupleElementKind, TypeParameterRef,
};
use bun_sema::hir::{BinOp, ExprId, ExprKind};
use bun_sema::types::SigId as SignatureId;
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};
use std::rc::Rc;

use crate::builtins::id::BuiltinId;
use crate::ir::generated::LimitId;
use crate::ir::{ContentsSlot, DeclaredType, LayoutId, LayoutKey};
use crate::lower::types::{find_contents_type, find_mapped_source};
use crate::lower::{CheckerTypeId, FileLowering, SourceKind, function_types, layouts, positions};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ConversionKind {
    Performed,
    Asserted,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct ComparedPair {
    source: CheckerTypeId,
    target: CheckerTypeId,
    is_asserted: bool,
}

#[derive(Copy, Clone)]
struct PendingPair {
    pair: ComparedPair,
    depth: u8,
    is_accepted: bool,
}

// A literal is converted member by member where it is built, so only a value of one structural type that flows into another needs the walk through their members, and what differs there lies near the top.
const MAX_COMPARED_DEPTH: u8 = 2;
const MAX_ASSERTED_PAIRS: usize = 1024;
const MAX_ASSERTED_MEMBER_DEPTH: u8 = 1;

#[derive(Default)]
struct Comparison {
    depth: u8,
    // The checker lets the source of the pair at hand flow into its target.
    is_accepted: bool,
    pending: SmallVec<[PendingPair; 8]>,
}

enum ComparedShape<'x> {
    Transparent(&'x [CheckerTypeId]),
    Class(ClassRef),
    ObjectType,
    TypeParameter {
        parameter: TypeParameterRef,
        constraint: Option<CheckerTypeId>,
    },
    Tuple(&'x [TupleElement]),
    Function(&'x [SignatureId]),
    ClassConstructor(ClassRef),
    Container,
    Primitive,
    NoValue,
    Loose,
}

fn classify_shape<'x>(kind: &'x ShapeKind<'_>) -> ComparedShape<'x> {
    match kind {
        ShapeKind::Union(members) => ComparedShape::Transparent(members),
        ShapeKind::TypeVariable {
            parameter: Some(parameter),
            constraint,
        } => ComparedShape::TypeParameter {
            parameter: *parameter,
            constraint: *constraint,
        },
        ShapeKind::TypeVariable {
            parameter: None,
            constraint,
        } => ComparedShape::Transparent(constraint.as_slice()),
        ShapeKind::Constrained { base, .. } => {
            ComparedShape::Transparent(core::slice::from_ref(base))
        }
        ShapeKind::Class(class) => ComparedShape::Class(*class),
        ShapeKind::Object => ComparedShape::ObjectType,
        ShapeKind::Tuple { elements, .. } => ComparedShape::Tuple(elements),
        ShapeKind::Function(signatures) => ComparedShape::Function(signatures),
        ShapeKind::ClassConstructor(class) => ComparedShape::ClassConstructor(*class),
        ShapeKind::Array { .. } | ShapeKind::Builtin { .. } => ComparedShape::Container,
        ShapeKind::Never | ShapeKind::Undefined | ShapeKind::Null => ComparedShape::NoValue,
        ShapeKind::Anything(_) | ShapeKind::AnyObject => ComparedShape::Loose,
        _ => ComparedShape::Primitive,
    }
}

#[allow(clippy::trivially_copy_pass_by_ref)] // its callers hold references
fn has_element_type(element: &TupleElement) -> bool {
    match element.kind {
        TupleElementKind::Required | TupleElementKind::Optional | TupleElementKind::Rest => true,
        TupleElementKind::Variadic => false,
    }
}

pub(super) fn can_hold_family(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    match classify_shape(&shape.kind) {
        ComparedShape::Primitive | ComparedShape::NoValue | ComparedShape::Loose => false,
        _ => true,
    }
}

fn find_layout(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Option<LayoutId> {
    let shape = file.queries.type_shape(ty).ok()?;
    match classify_shape(&shape.kind) {
        ComparedShape::Class(class) => Some(layouts::class_layout(file, class)),
        ComparedShape::ObjectType => layouts::object_type_layout(file, ty),
        ComparedShape::TypeParameter { parameter, .. } => {
            Some(layouts::type_parameter_layout(file, parameter))
        }
        _ => None,
    }
}

impl Comparison {
    // Nobody has to look for the parts of a pair whose parts are not followed.
    fn follows_parts(&self) -> bool {
        self.depth < MAX_COMPARED_DEPTH
    }

    // A part of the two types: a result, an element, the contents.
    fn follow(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        if self.follows_parts() {
            self.add_pair(source, target, self.depth + 1, self.is_accepted);
        }
    }

    // Nothing is compared below a member: those are types that nobody else asks the checker for.
    fn follow_member(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        if self.follows_parts() {
            self.add_pair(source, target, MAX_COMPARED_DEPTH, self.is_accepted);
        }
    }

    // The same value under another of its types: a member of a union, a constraint.
    fn follow_value(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        self.add_pair(source, target, self.depth, self.is_accepted);
    }

    fn follow_accepted_value(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        self.add_pair(source, target, self.depth, true);
    }

    fn follow_guessed_value(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        self.add_pair(source, target, self.depth, false);
    }

    fn add_pair(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
        depth: u8,
        is_accepted: bool,
    ) {
        if source != target {
            self.pending.push(PendingPair {
                pair: ComparedPair {
                    source,
                    target,
                    is_asserted: false,
                },
                depth,
                is_accepted,
            });
        }
    }

    fn accepts(
        &mut self,
        file: &mut FileLowering<'_, '_, '_, '_>,
        source: CheckerTypeId,
        target: CheckerTypeId,
    ) -> bool {
        if !self.is_accepted {
            self.is_accepted = matches!(file.queries.is_assignable(source, target), Ok(true));
        }
        self.is_accepted
    }

    // Every entry and every store is tested, so nothing rests on a flow against the checker's direction: it would only put the family of the wider type into the narrower one.
    fn follow_if_assignable(
        &mut self,
        file: &mut FileLowering<'_, '_, '_, '_>,
        source: CheckerTypeId,
        target: CheckerTypeId,
    ) {
        if self.depth < MAX_COMPARED_DEPTH
            && let Ok(true) = file.queries.is_assignable(source, target)
        {
            self.add_pair(source, target, MAX_COMPARED_DEPTH, true);
        }
    }
}

pub(super) fn find_target_type(
    file: &FileLowering<'_, '_, '_, '_>,
    position: DeclaredType,
) -> Option<CheckerTypeId> {
    positions::find_position_source(file, position)
        .or_else(|| find_mapped_source(file, position.ty))
}

pub(crate) fn record_contents_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    container: ExprId,
    slot: ContentsSlot,
    position: DeclaredType,
) {
    let Some(target) = find_target_type(file, position) else {
        return;
    };
    let Ok(container_type) = file.queries.expression_type(container) else {
        return;
    };
    let Some(contents) = find_contents_type(file, container_type, slot) else {
        return;
    };
    let source_position = file.hir[container].pos;
    record_conversion(
        file,
        contents,
        target,
        source_position,
        ConversionKind::Performed,
    );
}

enum FlowingOperands {
    Whole,
    One(ExprId),
    Two(ExprId, ExprId),
}

// The checker's union of two functions with equal signatures keeps one of them, so each operand that can be the value flows for itself.
fn find_flowing_operands(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> FlowingOperands {
    let hir = file.hir;
    match hir[expression].kind {
        ExprKind::Cond { branches, .. } => {
            let branches = hir.branches(branches);
            FlowingOperands::Two(branches.yes, branches.no)
        }
        ExprKind::Binary { op, left, right } => match op {
            BinOp::Or | BinOp::Nullish => FlowingOperands::Two(left, right),
            // Of the left operand of `&&` only what is falsy is the value, and no object is.
            BinOp::And | BinOp::Comma => FlowingOperands::One(right),
            _ => FlowingOperands::Whole,
        },
        ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => {
            FlowingOperands::One(expr)
        }
        _ => FlowingOperands::Whole,
    }
}

pub(super) fn collect_flowing_operands(
    file: &FileLowering<'_, '_, '_, '_>,
    source: ExprId,
) -> SmallVec<[ExprId; 4]> {
    let mut operands = SmallVec::new();
    let mut pending: SmallVec<[ExprId; 4]> = smallvec![source];
    while let Some(expression) = pending.pop() {
        match find_flowing_operands(file, expression) {
            FlowingOperands::Two(first, second) => pending.extend([second, first]),
            FlowingOperands::One(operand) => pending.push(operand),
            FlowingOperands::Whole => operands.push(expression),
        }
    }
    operands
}

fn record_builtin_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    builtin: BuiltinId,
    target: CheckerTypeId,
) {
    let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![target];
    while let Some(ty) = pending.pop() {
        let Ok(shape) = file.queries.type_shape(ty) else {
            continue;
        };
        match classify_shape(&shape.kind) {
            ComparedShape::Transparent(types) => pending.extend_from_slice(types),
            ComparedShape::Function(signatures) => {
                if let Some(function_type) = function_types::find_function_type(file, signatures) {
                    file.fragment.add_builtin_member(function_type, builtin);
                }
            }
            ComparedShape::Class(_)
            | ComparedShape::ObjectType
            | ComparedShape::TypeParameter { .. }
            | ComparedShape::Tuple(_)
            | ComparedShape::ClassConstructor(_)
            | ComparedShape::Container
            | ComparedShape::Primitive
            | ComparedShape::NoValue
            | ComparedShape::Loose => {}
        }
    }
}

pub(super) fn record_flow_into_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: ExprId,
    target: CheckerTypeId,
    kind: ConversionKind,
) {
    for expression in collect_flowing_operands(file, source) {
        if let Some(builtin) = file.builtins.builtin_of_expression(expression) {
            record_builtin_member(file, builtin, target);
        }
        if let Ok(source_type) = file.queries.expression_type(expression) {
            let position = file.hir[expression].pos;
            record_conversion(file, source_type, target, position, kind);
        }
    }
}

// The family of the source goes into the family of the target, part by part.
pub(super) fn record_conversion(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    position: u32,
    kind: ConversionKind,
) {
    let mut comparison = Comparison::default();
    comparison.pending.push(PendingPair {
        pair: ComparedPair {
            source,
            target,
            is_asserted: kind == ConversionKind::Asserted,
        },
        depth: 0,
        is_accepted: false,
    });
    compare_pending_pairs(file, comparison, position);
}

fn collect_object_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> SmallVec<[CheckerTypeId; 4]> {
    let mut objects = SmallVec::new();
    let mut visited: SmallVec<[CheckerTypeId; 4]> = SmallVec::new();
    let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
    while let Some(ty) = pending.pop() {
        if visited.contains(&ty) {
            continue;
        }
        visited.push(ty);
        let Ok(shape) = file.queries.type_shape(ty) else {
            continue;
        };
        match classify_shape(&shape.kind) {
            ComparedShape::Transparent(types) => pending.extend_from_slice(types),
            ComparedShape::TypeParameter { constraint, .. } => pending.extend(constraint),
            ComparedShape::Class(_) | ComparedShape::ObjectType => objects.push(ty),
            ComparedShape::Tuple(_)
            | ComparedShape::Function(_)
            | ComparedShape::ClassConstructor(_)
            | ComparedShape::Container
            | ComparedShape::Primitive
            | ComparedShape::NoValue
            | ComparedShape::Loose => {}
        }
    }
    objects
}

pub(super) fn record_copied_members(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    position: u32,
) {
    let sources = collect_object_types(file, source);
    let targets = collect_object_types(file, target);
    let mut comparison = Comparison::default();
    for &source in &sources {
        for &target in &targets {
            if source != target {
                follow_copied_members(file, &mut comparison, source, target);
            }
        }
    }
    compare_pending_pairs(file, comparison, position);
}

fn follow_copied_members(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    let Ok(members) = file.queries.checked_members(target) else {
        return;
    };
    for member in members {
        let (MemberName::String(name), Ok(target_type)) = (member.name, member.checked) else {
            continue;
        };
        let Ok(Some(found)) = file.queries.find_checked_member(source, name) else {
            continue;
        };
        if let Ok(source_type) = found.checked
            && source_type != target_type
        {
            comparison.follow_if_assignable(file, source_type, target_type);
        }
    }
}

fn compare_pending_pairs(
    file: &mut FileLowering<'_, '_, '_, '_>,
    mut comparison: Comparison,
    position: u32,
) {
    let limit = file.inputs.limits.get(LimitId::MaxSupertypePairs);
    let mut next = 0;
    let mut compared = 0u64;
    while let Some(&PendingPair {
        pair,
        depth,
        is_accepted,
    }) = comparison.pending.get(next)
    {
        next += 1;
        if pair.source == pair.target {
            continue;
        }
        // A pair that was met far down was not walked as far as one that is met near the top.
        let compared_types = &mut file.types.conversions.compared_types;
        if compared_types
            .get(&pair)
            .is_some_and(|&walked_from| walked_from <= depth)
        {
            continue;
        }
        if compared == limit {
            file.gave_up(LimitId::MaxSupertypePairs, position);
            return;
        }
        compared_types.insert(pair, depth);
        compared += 1;
        comparison.depth = depth;
        comparison.is_accepted = is_accepted;
        compare_pair(file, &mut comparison, pair);
    }
}

fn has_layout(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    file.queries.type_shape(ty).is_ok_and(|shape| {
        matches!(
            classify_shape(&shape.kind),
            ComparedShape::Class(_) | ComparedShape::ObjectType
        )
    })
}

// Of `x as Type` with `x: Type | Node | Symbol`, only a Type is meant: the assertion picks among the objects that the union names, and says nothing of the others.
fn find_asserted_members(
    file: &mut FileLowering<'_, '_, '_, '_>,
    members: &[CheckerTypeId],
    target: CheckerTypeId,
) -> SmallVec<[CheckerTypeId; 4]> {
    let mut objects: SmallVec<[CheckerTypeId; 4]> = SmallVec::from_slice(members);
    objects.retain(|&mut member| has_layout(file, member));
    let mut others: SmallVec<[CheckerTypeId; 4]> = SmallVec::from_slice(members);
    others.retain(|member| !objects.contains(member));
    let mut picked = objects.clone();
    picked.retain(|&mut member| file.queries.is_assignable(member, target) == Ok(true));
    others.extend(if picked.is_empty() { objects } else { picked });
    others
}

fn compare_pair(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    pair: ComparedPair,
) {
    let ComparedPair {
        source,
        target,
        is_asserted,
    } = pair;
    let shapes = (
        file.queries.type_shape(source),
        file.queries.type_shape(target),
    );
    let (Ok(source_shape), Ok(target_shape)) = shapes else {
        return;
    };
    let source_kind = classify_shape(&source_shape.kind);
    if let (ComparedShape::Transparent(types), true) = (&source_kind, is_asserted) {
        let depth = comparison.depth;
        let members = find_asserted_members(file, types, target);
        comparison
            .pending
            .extend(members.iter().map(|&source| PendingPair {
                pair: ComparedPair {
                    source,
                    target,
                    is_asserted,
                },
                depth,
                is_accepted: false,
            }));
        return;
    }
    // What nothing is known of may be an object that somebody has made.
    if let ComparedShape::Loose = source_kind {
        for &ty in collect_types_with_layout(file, target, AssertionSide::Target).iter() {
            if let Some(layout) = find_layout(file, ty) {
                layouts::note_view(file, layout);
            }
        }
    }
    if is_asserted {
        match file.queries.is_assignable(source, target) {
            Ok(true) => comparison.follow_accepted_value(source, target),
            Ok(false) | Err(_) => admit_asserted_objects(file, source, target),
        }
        return;
    }
    let value_kind = find_value_kind(&source_kind);
    match (source_kind, classify_shape(&target_shape.kind)) {
        (ComparedShape::Transparent(types), _) => {
            for &ty in types {
                comparison.follow_value(ty, target);
            }
        }
        (ComparedShape::NoValue | ComparedShape::Loose, _)
        | (_, ComparedShape::NoValue | ComparedShape::Loose | ComparedShape::Primitive) => {}
        (_, ComparedShape::Transparent(types)) => {
            follow_into_fitting_member(file, comparison, source, value_kind, types);
        }
        // Two instantiations of one class share each field, whose type is the type parameter.
        (ComparedShape::Class(class), ComparedShape::Class(target_class))
            if class == target_class =>
        {
            compare_members(file, comparison, source, target);
        }
        (
            ComparedShape::Class(_) | ComparedShape::ObjectType,
            ComparedShape::Class(_) | ComparedShape::ObjectType,
        ) => compare_objects(file, comparison, source, target),
        (
            ComparedShape::Class(_)
            | ComparedShape::ObjectType
            | ComparedShape::TypeParameter { .. },
            ComparedShape::TypeParameter { constraint, .. },
        ) => {
            add_layout_edge(file, source, target);
            if let Some(constraint) = constraint {
                comparison.follow_guessed_value(source, constraint);
            }
        }
        // One node stands for every instantiation of a type parameter.
        (
            ComparedShape::TypeParameter { constraint, .. },
            ComparedShape::Class(_) | ComparedShape::ObjectType,
        ) => {
            if let Some(constraint) = constraint
                && let Ok(true) = file.queries.is_assignable(constraint, target)
            {
                add_layout_edge(file, source, target);
                comparison.follow_accepted_value(constraint, target);
            }
        }
        (
            ComparedShape::Tuple(_)
            | ComparedShape::Function(_)
            | ComparedShape::ClassConstructor(_)
            | ComparedShape::Container
            | ComparedShape::Primitive,
            ComparedShape::TypeParameter { .. },
        ) => {
            if let Some(layout) = find_layout(file, target) {
                file.fragment.family_facts.add_member_without_layout(layout);
            }
        }
        // The type of the position lists a value without a layout only where the checker lets it in, so no other one passes the test of the position.
        (
            ComparedShape::Tuple(_)
            | ComparedShape::Function(_)
            | ComparedShape::ClassConstructor(_)
            | ComparedShape::Container
            | ComparedShape::Primitive,
            ComparedShape::Class(_) | ComparedShape::ObjectType,
        ) => {
            if comparison.accepts(file, source, target)
                && let Some(layout) = find_layout(file, target)
            {
                file.fragment.family_facts.add_member_without_layout(layout);
            }
        }
        (ComparedShape::Tuple(elements), ComparedShape::Tuple(targets)) => {
            for (element, target) in elements.iter().zip(targets) {
                if has_element_type(element) && has_element_type(target) {
                    comparison.follow(element.ty, target.ty);
                }
            }
        }
        (ComparedShape::Tuple(elements), ComparedShape::Container) => {
            compare_tuple_contents(file, comparison, elements, target);
        }
        (ComparedShape::Container, ComparedShape::Container) => {
            compare_contents(file, comparison, source, target);
        }
        (ComparedShape::Function(signatures), ComparedShape::Function(targets)) => {
            compare_functions(file, comparison, signatures, targets);
        }
        (ComparedShape::ClassConstructor(class), ComparedShape::ClassConstructor(target_class)) => {
            let function = function_types::find_class_function_type(file, class);
            let function_type = function_types::find_class_function_type(file, target_class);
            file.fragment
                .add_function_type_edge(function, function_type);
        }
        (ComparedShape::ClassConstructor(class), ComparedShape::Function(targets)) => {
            if let Some(function_type) = function_types::find_function_type(file, targets) {
                let function = function_types::find_class_function_type(file, class);
                file.fragment
                    .add_function_type_edge(function, function_type);
            }
        }
        (
            ComparedShape::Class(_)
            | ComparedShape::ObjectType
            | ComparedShape::TypeParameter { .. }
            | ComparedShape::Primitive,
            ComparedShape::Tuple(_)
            | ComparedShape::Function(_)
            | ComparedShape::ClassConstructor(_)
            | ComparedShape::Container,
        )
        | (
            ComparedShape::Tuple(_),
            ComparedShape::Function(_) | ComparedShape::ClassConstructor(_),
        )
        | (
            ComparedShape::Function(_),
            ComparedShape::Tuple(_) | ComparedShape::ClassConstructor(_) | ComparedShape::Container,
        )
        | (
            ComparedShape::ClassConstructor(_),
            ComparedShape::Tuple(_) | ComparedShape::Container,
        )
        | (
            ComparedShape::Container,
            ComparedShape::Tuple(_)
            | ComparedShape::Function(_)
            | ComparedShape::ClassConstructor(_),
        ) => {}
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ValueKind {
    Object,
    Function,
    List,
    Primitive,
    Other,
}

fn find_value_kind(shape: &ComparedShape<'_>) -> ValueKind {
    match shape {
        ComparedShape::Function(_) | ComparedShape::ClassConstructor(_) => ValueKind::Function,
        ComparedShape::Tuple(_) | ComparedShape::Container => ValueKind::List,
        ComparedShape::Primitive => ValueKind::Primitive,
        ComparedShape::Transparent(_) | ComparedShape::NoValue | ComparedShape::Loose => {
            ValueKind::Other
        }
        _ => ValueKind::Object,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum UnionMember {
    OfSameKind,
    Open,
    OfAnotherKind,
}

fn classify_union_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    kind: ValueKind,
    member: CheckerTypeId,
) -> UnionMember {
    let Ok(shape) = file.queries.type_shape(member) else {
        return UnionMember::OfAnotherKind;
    };
    match classify_shape(&shape.kind) {
        ComparedShape::TypeParameter { .. } | ComparedShape::Transparent(_) => UnionMember::Open,
        shape if kind != ValueKind::Other && find_value_kind(&shape) == kind => {
            UnionMember::OfSameKind
        }
        _ => UnionMember::OfAnotherKind,
    }
}

// The type of a position is the union of the families of its members, so one member that takes the value is enough.
fn follow_into_fitting_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    source: CheckerTypeId,
    kind: ValueKind,
    members: &[CheckerTypeId],
) {
    if members.contains(&source) {
        return;
    }
    if let &[member] = members {
        comparison.follow_value(source, member);
        return;
    }
    let mut kinds: SmallVec<[UnionMember; 8]> = SmallVec::new();
    for &member in members {
        kinds.push(classify_union_member(file, kind, member));
    }
    // A primitive that flows into a primitive adds nothing to any family.
    if kind == ValueKind::Primitive && !kinds.contains(&UnionMember::Open) {
        return;
    }
    let of_same_kind = || {
        let members = members.iter().zip(&kinds);
        members
            .filter(|member| *member.1 == UnionMember::OfSameKind)
            .map(|member| *member.0)
    };
    // The union takes the value, and no other member of it can.
    if comparison.is_accepted
        && !kinds.contains(&UnionMember::Open)
        && let (Some(member), None) = (of_same_kind().next(), of_same_kind().nth(1))
    {
        comparison.follow_accepted_value(source, member);
        return;
    }
    // Whether one function type fits another can take the checker seconds, and a function too many in the family of a function type costs little: it goes into every member that is one.
    if kind != ValueKind::Function {
        for member in of_same_kind() {
            if let Ok(true) = file.queries.is_assignable(source, member) {
                comparison.follow_accepted_value(source, member);
                return;
            }
        }
    }
    // A function that is missing from the family of a method's type stops a literal from being allocated with its methods.
    for (&member, member_kind) in members.iter().zip(kinds) {
        let takes_value = match member_kind {
            UnionMember::Open => true,
            UnionMember::OfSameKind => kind == ValueKind::Function,
            UnionMember::OfAnotherKind => false,
        };
        if takes_value {
            comparison.follow_guessed_value(source, member);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(in crate::lower) enum AssertionSide {
    Source,
    Target,
}

// The types with a layout that a value of the type may have.
fn collect_types_with_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    side: AssertionSide,
) -> Rc<[CheckerTypeId]> {
    if let Some(found) = file.types.conversions.types_with_layout.get(&(ty, side)) {
        return Rc::clone(found);
    }
    let found: Rc<[CheckerTypeId]> = Rc::from(find_types_with_layout(file, ty, side));
    file.types
        .conversions
        .types_with_layout
        .insert((ty, side), Rc::clone(&found));
    found
}

fn find_types_with_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    side: AssertionSide,
) -> Vec<CheckerTypeId> {
    let mut found = Vec::new();
    let mut visited = FxHashSet::default();
    let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
    while let Some(ty) = pending.pop() {
        if !visited.insert(ty) {
            continue;
        }
        let Ok(shape) = file.queries.type_shape(ty) else {
            continue;
        };
        match classify_shape(&shape.kind) {
            ComparedShape::Transparent(types) => pending.extend_from_slice(types),
            ComparedShape::TypeParameter { constraint, .. } => {
                // `value as Flow` with `value: S` says that this value is a Flow, not that whatever is passed for S is one.
                if side == AssertionSide::Target {
                    found.push(ty);
                }
                pending.extend(constraint);
            }
            ComparedShape::Class(_) | ComparedShape::ObjectType => found.push(ty),
            ComparedShape::Tuple(_)
            | ComparedShape::Function(_)
            | ComparedShape::ClassConstructor(_)
            | ComparedShape::Container
            | ComparedShape::Primitive
            | ComparedShape::NoValue
            | ComparedShape::Loose => {}
        }
    }
    found
}

// An assertion down or sideways says that objects of the one type are objects of the other, and the program goes on as if they were: `createBaseNode(kind) as Mutable<T>`, `(node as NamedDeclaration).name`.
fn admit_asserted_objects(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    admit_asserted_objects_and_members(file, source, target, MAX_ASSERTED_MEMBER_DEPTH);
}

fn admit_asserted_objects_and_members(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    member_depth: u8,
) {
    // `node as Identifier` stands in a file many times, and says the same each time.
    let assertion = (source, target, member_depth);
    if !file.types.conversions.admitted_assertions.insert(assertion) {
        return;
    }
    let sources = collect_types_with_layout(file, source, AssertionSide::Source);
    let targets = collect_types_with_layout(file, target, AssertionSide::Target);
    if sources.len() * targets.len() > MAX_ASSERTED_PAIRS {
        return;
    }
    // Of `x as Type` with `x: Type | Node | Symbol`, only a Type is meant.
    for &source in sources.iter() {
        for &target in targets.iter() {
            let Ok(true) = file.queries.can_be_asserted(source, target) else {
                continue;
            };
            if let (Some(layout), Some(supertype)) =
                (find_layout(file, source), find_layout(file, target))
            {
                layouts::add_conversion(file, layout, supertype);
            }
            if member_depth > 0 {
                admit_asserted_members(file, source, target, member_depth - 1);
            }
        }
    }
}

// `symbol as MappedSymbol` also says that `symbol.links`, a TransientSymbolLinks, is a MappedSymbolLinks.
fn admit_asserted_members(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    member_depth: u8,
) {
    let Ok(members) = file.queries.checked_members(target) else {
        return;
    };
    for member in members {
        let (MemberName::String(name), Ok(target_type)) = (member.name, member.checked) else {
            continue;
        };
        if !is_read_through(member.kind) {
            continue;
        }
        let Ok(Some(found)) = file.queries.find_checked_member(source, name) else {
            continue;
        };
        if let Ok(source_type) = found.checked
            && source_type != target_type
        {
            admit_asserted_objects_and_members(file, source_type, target_type, member_depth);
        }
    }
}

// `new EventEmitter()`: a declaration file gives the expression its type, and a function of Bun's own modules makes the object.
pub(crate) fn record_construction_by_library(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    callee: ExprId,
) {
    if file.source != SourceKind::Program {
        return;
    }
    let Some(ClassParent::Library(declaration)) =
        file.queries.constructed_declaration(file.file, callee)
    else {
        return;
    };
    let Ok(ty) = file.queries.expression_type(expression) else {
        return;
    };
    if let Some(supertype) = find_layout(file, ty) {
        let layout = file
            .fragment
            .declare_layout(LayoutKey::Library(declaration));
        layouts::add_conversion(file, layout, supertype);
    }
}

fn add_layout_edge(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    match (find_layout(file, source), find_layout(file, target)) {
        (Some(layout), Some(supertype)) => layouts::add_conversion(file, layout, supertype),
        (None, Some(supertype)) => file
            .fragment
            .family_facts
            .add_member_without_layout(supertype),
        (Some(_) | None, None) => {}
    }
}

fn compare_functions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    signatures: &[SignatureId],
    targets: &[SignatureId],
) {
    let function_types = (
        function_types::find_function_type(file, signatures),
        function_types::find_function_type(file, targets),
    );
    if let (Some(function), Some(function_type)) = function_types {
        file.fragment
            .add_function_type_edge(function, function_type);
    }
    let (&[signature], &[target]) = (signatures, targets) else {
        return;
    };
    if !comparison.follows_parts() {
        return;
    }
    let returned = file.queries.signature_result(signature);
    let expected = file.queries.signature_result(target);
    // What is passed to the function is tested at its entry, and passes if it has the names that the parameter's type requires.
    if let (Ok(returned), Ok(expected)) = (returned, expected) {
        comparison.follow(returned, expected);
    }
}

// What is read out of a container is tested where it is read, whatever was written through another type of the container.
fn compare_tuple_contents(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    elements: &[TupleElement],
    target: CheckerTypeId,
) {
    if !comparison.follows_parts() {
        return;
    }
    let Some(contents) = find_contents_type(file, target, ContentsSlot::Element) else {
        return;
    };
    for element in elements.iter().filter(|element| has_element_type(element)) {
        comparison.follow(element.ty, contents);
    }
}

fn compare_contents(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    if !comparison.follows_parts() {
        return;
    }
    for slot in ContentsSlot::ALL {
        let Some(source_contents) = find_contents_type(file, source, slot) else {
            continue;
        };
        let Some(target_contents) = find_contents_type(file, target, slot) else {
            continue;
        };
        comparison.follow(source_contents, target_contents);
    }
}

fn compare_objects(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    // Every entry and every store is tested, so nothing rests on an edge that the checker would not allow.
    if !comparison.accepts(file, source, target) {
        return;
    }
    match (find_layout(file, source), find_layout(file, target)) {
        // A literal is allocated with the layout of the type it is written under, and each of its members is converted where the literal is built.
        (Some(layout), Some(supertype)) if layout == supertype => {
            layouts::add_conversion(file, layout, supertype);
            if let ObjectOrigin::ObjectLiteral { .. } = file.queries.object_origin(source) {
                return;
            }
        }
        (Some(layout), Some(supertype)) => layouts::add_conversion(file, layout, supertype),
        (None, Some(supertype)) => file
            .fragment
            .family_facts
            .add_member_without_layout(supertype),
        (Some(_) | None, None) => {}
    }
    compare_members(file, comparison, source, target);
}

fn is_read_through(kind: ObjectMemberKind) -> bool {
    match kind {
        ObjectMemberKind::Setter => false,
        _ => true,
    }
}

fn compare_members(
    file: &mut FileLowering<'_, '_, '_, '_>,
    comparison: &mut Comparison,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    if !comparison.follows_parts() {
        return;
    }
    let Ok(members) = file.queries.checked_members(target) else {
        return;
    };
    for member in members {
        let (MemberName::String(name), Ok(target_type)) = (member.name, member.checked) else {
            continue;
        };
        let Ok(Some(found)) = file.queries.find_checked_member(source, name) else {
            continue;
        };
        let Ok(source_type) = found.checked else {
            continue;
        };
        if source_type == target_type {
            continue;
        }
        if is_read_through(member.kind) {
            comparison.follow_member(source_type, target_type);
        }
    }
}

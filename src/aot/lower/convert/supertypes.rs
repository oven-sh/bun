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
use crate::lower::types::find_contents_type;
use crate::lower::{CheckerTypeId, FileLowering, SourceKind};

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
        ShapeKind::Int32 { base } => ComparedShape::Transparent(core::slice::from_ref(base)),
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

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn can_hold_family(&mut self, ty: CheckerTypeId) -> bool {
        let Ok(shape) = self.queries.type_shape(ty) else {
            return false;
        };
        !matches!(
            classify_shape(&shape.kind),
            ComparedShape::Primitive | ComparedShape::NoValue | ComparedShape::Loose
        )
    }

    pub(super) fn find_target_type(&self, position: DeclaredType) -> Option<CheckerTypeId> {
        self.find_position_source(position)
            .or_else(|| self.find_mapped_source(position.ty))
    }

    pub(crate) fn record_contents_flow(
        &mut self,
        container: ExprId,
        slot: ContentsSlot,
        position: DeclaredType,
    ) {
        let Some(target) = self.find_target_type(position) else {
            return;
        };
        let Ok(container_type) = self.queries.expression_type(container) else {
            return;
        };
        let Some(contents) = find_contents_type(self, container_type, slot) else {
            return;
        };
        let source_position = self.hir[container].pos;
        self.record_conversion(contents, target, source_position, ConversionKind::Performed);
    }

    // The checker's union of two functions with equal signatures keeps one of them, so each operand that can be the value flows for itself.
    pub(super) fn collect_flowing_operands(&self, source: ExprId) -> SmallVec<[ExprId; 4]> {
        let hir = self.hir;
        let mut operands = SmallVec::new();
        let mut pending: SmallVec<[ExprId; 4]> = smallvec![source];
        while let Some(expression) = pending.pop() {
            match hir[expression].kind {
                ExprKind::Cond { branches, .. } => {
                    let branches = hir.branches(branches);
                    pending.extend([branches.no, branches.yes]);
                }
                ExprKind::Binary { op, left, right } => match op {
                    BinOp::Or | BinOp::Nullish => pending.extend([right, left]),
                    // Of the left operand of `&&` only what is falsy is the value, and no object is.
                    BinOp::And | BinOp::Comma => pending.push(right),
                    _ => operands.push(expression),
                },
                ExprKind::Satisfies { expr, .. }
                | ExprKind::NonNull(expr)
                | ExprKind::AsConst(expr) => pending.push(expr),
                _ => operands.push(expression),
            }
        }
        operands
    }

    fn record_builtin_member(&mut self, builtin: BuiltinId, target: CheckerTypeId) {
        let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![target];
        while let Some(ty) = pending.pop() {
            let Ok(shape) = self.queries.type_shape(ty) else {
                continue;
            };
            match classify_shape(&shape.kind) {
                ComparedShape::Transparent(types) => pending.extend_from_slice(types),
                ComparedShape::Function(signatures) => {
                    if let Some(function_type) = self.find_function_type(signatures) {
                        self.fragment.add_builtin_member(function_type, builtin);
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
        &mut self,
        source: ExprId,
        target: CheckerTypeId,
        kind: ConversionKind,
    ) {
        for expression in self.collect_flowing_operands(source) {
            if let Some(builtin) = self.builtins.builtin_of_expression(expression) {
                self.record_builtin_member(builtin, target);
            }
            if let Ok(source_type) = self.queries.expression_type(expression) {
                let position = self.hir[expression].pos;
                self.record_conversion(source_type, target, position, kind);
            }
        }
    }

    pub(super) fn record_conversion(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
        position: u32,
        kind: ConversionKind,
    ) {
        let mut comparison = Comparison::default();
        comparison.add_pair(source, target, kind == ConversionKind::Asserted, 0, false);
        self.compare_pending_pairs(comparison, position);
    }

    fn collect_object_types(&mut self, ty: CheckerTypeId) -> SmallVec<[CheckerTypeId; 4]> {
        let mut objects = SmallVec::new();
        let mut visited: SmallVec<[CheckerTypeId; 4]> = SmallVec::new();
        let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
        while let Some(ty) = pending.pop() {
            if visited.contains(&ty) {
                continue;
            }
            visited.push(ty);
            let Ok(shape) = self.queries.type_shape(ty) else {
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
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
        position: u32,
    ) {
        let sources = self.collect_object_types(source);
        let targets = self.collect_object_types(target);
        let mut comparison = Comparison::default();
        // Every entry and every store is tested, so nothing rests on a flow against the checker's direction: it would only put the family of the wider type into the narrower one.
        for &source in &sources {
            for &target in targets.iter().filter(|&&target| target != source) {
                self.visit_differing_members(source, target, false, |file, _, from, to| {
                    if let Ok(true) = file.queries.is_assignable(from, to) {
                        comparison.add_pair(from, to, false, MAX_COMPARED_DEPTH, true);
                    }
                });
            }
        }
        self.compare_pending_pairs(comparison, position);
    }

    // The members that both types name and give different types. Nothing is asked about a setter that is skipped.
    fn visit_differing_members(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
        skips_setters: bool,
        mut visit: impl FnMut(&mut Self, ObjectMemberKind, CheckerTypeId, CheckerTypeId),
    ) {
        let Ok(members) = self.queries.checked_members(target) else {
            return;
        };
        for member in members {
            let (MemberName::String(name), Ok(target_type)) = (member.name, member.checked) else {
                continue;
            };
            if skips_setters && !is_read_through(member.kind) {
                continue;
            }
            let Ok(Some(found)) = self.queries.find_checked_member(source, name) else {
                continue;
            };
            if let Ok(source_type) = found.checked
                && source_type != target_type
            {
                visit(self, member.kind, source_type, target_type);
            }
        }
    }

    fn compare_pending_pairs(&mut self, mut comparison: Comparison, position: u32) {
        let limit = self.inputs.limits.get(LimitId::MaxSupertypePairs);
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
            let compared_types = &mut self.types.conversions.compared_types;
            if compared_types
                .get(&pair)
                .is_some_and(|&walked_from| walked_from <= depth)
            {
                continue;
            }
            if compared == limit {
                self.gave_up(LimitId::MaxSupertypePairs, position);
                return;
            }
            compared_types.insert(pair, depth);
            compared += 1;
            comparison.depth = depth;
            comparison.is_accepted = is_accepted;
            self.compare_pair(&mut comparison, pair);
        }
    }

    fn compare_pair(&mut self, comparison: &mut Comparison, pair: ComparedPair) {
        let ComparedPair {
            source,
            target,
            is_asserted,
        } = pair;
        let shapes = (
            self.queries.type_shape(source),
            self.queries.type_shape(target),
        );
        let (Ok(source_shape), Ok(target_shape)) = shapes else {
            return;
        };
        let source_kind = classify_shape(&source_shape.kind);
        // Of `x as Type` with `x: Type | Node | Symbol`, only a Type is meant: the assertion picks among the objects that the union names, and says nothing of the others.
        if let (ComparedShape::Transparent(members), true) = (&source_kind, is_asserted) {
            let mut objects: SmallVec<[CheckerTypeId; 4]> = SmallVec::from_slice(members);
            objects.retain(|&mut member| has_layout(self, member));
            let mut others: SmallVec<[CheckerTypeId; 4]> = SmallVec::from_slice(members);
            others.retain(|member| !objects.contains(member));
            let mut picked = objects.clone();
            picked.retain(|&mut member| self.queries.is_assignable(member, target) == Ok(true));
            others.extend(if picked.is_empty() { objects } else { picked });
            for source in others {
                comparison.add_pair(source, target, true, comparison.depth, false);
            }
            return;
        }
        // What nothing is known of may be an object that somebody has made.
        if let ComparedShape::Loose = source_kind {
            for &ty in self
                .collect_types_with_layout(target, AssertionSide::Target)
                .iter()
            {
                if let Some(layout) = find_layout(self, ty) {
                    self.note_view(layout);
                }
            }
        }
        if is_asserted {
            match self.queries.is_assignable(source, target) {
                Ok(true) => comparison.follow_accepted_value(source, target),
                Ok(false) | Err(_) => {
                    self.admit_asserted_objects(source, target, MAX_ASSERTED_MEMBER_DEPTH);
                }
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
                self.follow_into_fitting_member(comparison, source, value_kind, types);
            }
            // Two instantiations of one class share each field, whose type is the type parameter.
            (ComparedShape::Class(class), ComparedShape::Class(target_class))
                if class == target_class =>
            {
                self.compare_members(comparison, source, target);
            }
            (
                ComparedShape::Class(_) | ComparedShape::ObjectType,
                ComparedShape::Class(_) | ComparedShape::ObjectType,
            ) => {
                // Every entry and every store is tested, so nothing rests on an edge that the checker would not allow.
                if !comparison.accepts(self, source, target) {
                    return;
                }
                // A literal is allocated with the layout of the type it is written under, and each of its members is converted where the literal is built.
                if self.add_layout_edge(source, target)
                    && let ObjectOrigin::ObjectLiteral { .. } = self.queries.object_origin(source)
                {
                    return;
                }
                self.compare_members(comparison, source, target);
            }
            (
                ComparedShape::Class(_)
                | ComparedShape::ObjectType
                | ComparedShape::TypeParameter { .. },
                ComparedShape::TypeParameter { constraint, .. },
            ) => {
                self.add_layout_edge(source, target);
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
                    && let Ok(true) = self.queries.is_assignable(constraint, target)
                {
                    self.add_layout_edge(source, target);
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
                if let Some(layout) = find_layout(self, target) {
                    self.fragment.family_facts.add_member_without_layout(layout);
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
                if comparison.accepts(self, source, target)
                    && let Some(layout) = find_layout(self, target)
                {
                    self.fragment.family_facts.add_member_without_layout(layout);
                }
            }
            (ComparedShape::Tuple(elements), ComparedShape::Tuple(targets)) => {
                for (element, target) in elements.iter().zip(targets) {
                    if has_element_type(element) && has_element_type(target) {
                        comparison.follow(element.ty, target.ty);
                    }
                }
            }
            // What is read out of a container is tested where it is read, whatever was written through another type of the container.
            (ComparedShape::Tuple(elements), ComparedShape::Container) => {
                if comparison.follows_parts()
                    && let Some(contents) = find_contents_type(self, target, ContentsSlot::Element)
                {
                    for element in elements.iter().filter(|element| has_element_type(element)) {
                        comparison.follow(element.ty, contents);
                    }
                }
            }
            (ComparedShape::Container, ComparedShape::Container) => {
                for slot in ContentsSlot::ALL {
                    if comparison.follows_parts()
                        && let Some(source_contents) = find_contents_type(self, source, slot)
                        && let Some(target_contents) = find_contents_type(self, target, slot)
                    {
                        comparison.follow(source_contents, target_contents);
                    }
                }
            }
            (ComparedShape::Function(signatures), ComparedShape::Function(targets)) => {
                let function_types = (
                    self.find_function_type(signatures),
                    self.find_function_type(targets),
                );
                if let (Some(function), Some(function_type)) = function_types {
                    self.fragment
                        .add_function_type_edge(function, function_type);
                }
                let (&[signature], &[target]) = (signatures, targets) else {
                    return;
                };
                if !comparison.follows_parts() {
                    return;
                }
                let returned = self.queries.signature_result(signature);
                let expected = self.queries.signature_result(target);
                // What is passed to the function is tested at its entry, and passes if it has the names that the parameter's type requires.
                if let (Ok(returned), Ok(expected)) = (returned, expected) {
                    comparison.follow(returned, expected);
                }
            }
            (
                ComparedShape::ClassConstructor(class),
                ComparedShape::ClassConstructor(target_class),
            ) => {
                let function = self.find_class_function_type(class);
                let function_type = self.find_class_function_type(target_class);
                self.fragment
                    .add_function_type_edge(function, function_type);
            }
            (ComparedShape::ClassConstructor(class), ComparedShape::Function(targets)) => {
                if let Some(function_type) = self.find_function_type(targets) {
                    let function = self.find_class_function_type(class);
                    self.fragment
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
                ComparedShape::Tuple(_)
                | ComparedShape::ClassConstructor(_)
                | ComparedShape::Container,
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

    fn classify_union_member(&mut self, kind: ValueKind, member: CheckerTypeId) -> UnionMember {
        let Ok(shape) = self.queries.type_shape(member) else {
            return UnionMember::OfAnotherKind;
        };
        match classify_shape(&shape.kind) {
            ComparedShape::TypeParameter { .. } | ComparedShape::Transparent(_) => {
                UnionMember::Open
            }
            shape if kind != ValueKind::Other && find_value_kind(&shape) == kind => {
                UnionMember::OfSameKind
            }
            _ => UnionMember::OfAnotherKind,
        }
    }

    // `new (class extends Set { })()` into `Stream | Set<Stream>`: the object is a Set, and belongs to the family of no other member.
    pub(super) fn flows_into_container(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
    ) -> bool {
        let shapes = (
            self.queries.type_shape(source),
            self.queries.type_shape(target),
        );
        let (Ok(source_shape), Ok(target_shape)) = shapes else {
            return false;
        };
        let ComparedShape::Transparent(members) = classify_shape(&target_shape.kind) else {
            return false;
        };
        find_value_kind(&classify_shape(&source_shape.kind)) == ValueKind::Object
            && members.iter().any(|&member| {
                is_container(self, member)
                    && matches!(self.queries.is_assignable(source, member), Ok(true))
            })
    }

    // The type of a position is the union of the families of its members, so one member that takes the value is enough.
    fn follow_into_fitting_member(
        &mut self,
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
            kinds.push(self.classify_union_member(kind, member));
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
                if let Ok(true) = self.queries.is_assignable(source, member) {
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

    fn collect_types_with_layout(
        &mut self,
        root: CheckerTypeId,
        side: AssertionSide,
    ) -> Rc<[CheckerTypeId]> {
        if let Some(found) = self.types.conversions.types_with_layout.get(&(root, side)) {
            return Rc::clone(found);
        }
        let mut found = Vec::new();
        let mut visited = FxHashSet::default();
        let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![root];
        while let Some(ty) = pending.pop() {
            if !visited.insert(ty) {
                continue;
            }
            let Ok(shape) = self.queries.type_shape(ty) else {
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
        let found: Rc<[CheckerTypeId]> = Rc::from(found);
        self.types
            .conversions
            .types_with_layout
            .insert((root, side), Rc::clone(&found));
        found
    }

    // An assertion down or sideways says that objects of the one type are objects of the other, and the program goes on as if they were: `createBaseNode(kind) as Mutable<T>`, `(node as NamedDeclaration).name`.
    fn admit_asserted_objects(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
        member_depth: u8,
    ) {
        // `node as Identifier` stands in a self many times, and says the same each time.
        let assertion = (source, target, member_depth);
        if !self.types.conversions.admitted_assertions.insert(assertion) {
            return;
        }
        let sources = self.collect_types_with_layout(source, AssertionSide::Source);
        let targets = self.collect_types_with_layout(target, AssertionSide::Target);
        if sources.len() * targets.len() > MAX_ASSERTED_PAIRS {
            return;
        }
        for &source in sources.iter() {
            for &target in targets.iter() {
                let Ok(true) = self.queries.can_be_asserted(source, target) else {
                    continue;
                };
                if let (Some(layout), Some(supertype)) =
                    (find_layout(self, source), find_layout(self, target))
                {
                    self.add_conversion(layout, supertype);
                }
                if member_depth == 0 {
                    continue;
                }
                // `symbol as MappedSymbol` also says that `symbol.links`, a TransientSymbolLinks, is a MappedSymbolLinks.
                self.visit_differing_members(source, target, true, |file, _, from, to| {
                    file.admit_asserted_objects(from, to, member_depth - 1);
                });
            }
        }
    }

    // `new EventEmitter()`: a declaration file gives the expression its type, and a function of Bun's own modules makes the object.
    pub(crate) fn record_construction_by_library(&mut self, expression: ExprId, callee: ExprId) {
        if self.source != SourceKind::Program {
            return;
        }
        let Some(ClassParent::Library(declaration)) =
            self.queries.constructed_declaration(self.file, callee)
        else {
            return;
        };
        let Ok(ty) = self.queries.expression_type(expression) else {
            return;
        };
        if let Some(supertype) = find_layout(self, ty) {
            let layout = self
                .fragment
                .declare_layout(LayoutKey::Library(declaration));
            self.add_conversion(layout, supertype);
        }
    }

    // Says whether the two types have one layout.
    fn add_layout_edge(&mut self, source: CheckerTypeId, target: CheckerTypeId) -> bool {
        match (find_layout(self, source), find_layout(self, target)) {
            (Some(layout), Some(supertype)) => {
                self.add_conversion(layout, supertype);
                return layout == supertype;
            }
            (None, Some(supertype)) => self
                .fragment
                .family_facts
                .add_member_without_layout(supertype),
            (Some(_) | None, None) => {}
        }
        false
    }

    fn compare_members(
        &mut self,
        comparison: &mut Comparison,
        source: CheckerTypeId,
        target: CheckerTypeId,
    ) {
        if !comparison.follows_parts() {
            return;
        }
        // Nothing is compared below a member: those are types that nobody else asks the checker for.
        self.visit_differing_members(source, target, false, |_, kind, from, to| {
            if is_read_through(kind) {
                comparison.add_pair(from, to, false, MAX_COMPARED_DEPTH, comparison.is_accepted);
            }
        });
    }
}

fn find_layout(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Option<LayoutId> {
    let shape = file.queries.type_shape(ty).ok()?;
    match classify_shape(&shape.kind) {
        ComparedShape::Class(class) => Some(file.class_layout(class)),
        ComparedShape::ObjectType => file.object_type_layout(ty),
        ComparedShape::TypeParameter { parameter, .. } => {
            Some(file.type_parameter_layout(parameter))
        }
        _ => None,
    }
}

impl Comparison {
    fn follows_parts(&self) -> bool {
        self.depth < MAX_COMPARED_DEPTH
    }

    // A part of the two types: a result, an element, the contents.
    fn follow(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        if self.follows_parts() {
            self.add_pair(source, target, false, self.depth + 1, self.is_accepted);
        }
    }

    // The same value under another of its types: a member of a union, a constraint.
    fn follow_value(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        self.add_pair(source, target, false, self.depth, self.is_accepted);
    }

    fn follow_accepted_value(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        self.add_pair(source, target, false, self.depth, true);
    }

    fn follow_guessed_value(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        self.add_pair(source, target, false, self.depth, false);
    }

    fn add_pair(
        &mut self,
        source: CheckerTypeId,
        target: CheckerTypeId,
        is_asserted: bool,
        depth: u8,
        is_accepted: bool,
    ) {
        if source != target {
            self.pending.push(PendingPair {
                pair: ComparedPair {
                    source,
                    target,
                    is_asserted,
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
}

fn has_layout(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    file.queries.type_shape(ty).is_ok_and(|shape| {
        matches!(
            classify_shape(&shape.kind),
            ComparedShape::Class(_) | ComparedShape::ObjectType
        )
    })
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

fn is_container(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let shape = file.queries.type_shape(ty);
    shape.is_ok_and(|shape| matches!(classify_shape(&shape.kind), ComparedShape::Container))
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(in crate::lower) enum AssertionSide {
    Source,
    Target,
}

fn is_read_through(kind: ObjectMemberKind) -> bool {
    !matches!(kind, ObjectMemberKind::Setter)
}

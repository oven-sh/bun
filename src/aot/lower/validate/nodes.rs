#[cfg(test)]
mod tests;

use std::collections::VecDeque;
use std::rc::Rc;

use bun_sema::atom::Atom;
use bun_sema::check::aot::{
    AnythingReason, BRAND_KEYS, GaveUp, IndexKey, MemberName, ObjectMember, ObjectMemberKind,
    SchemaConstraint, ShapeKind, TupleElement, TupleElementKind, TypeShape, WrittenUnionOrders,
};
use bun_sema::hir::TypeNodeId;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::rules::{apply_constraints, find_refused_rule};
use super::unsupported::{DescribesUnsupported, Origin, Step};
use super::{ValidatedFile, ValidationError};
use crate::ir::LayoutId;
use crate::ir::generated::{
    LimitId, TemplatePart, TemplatePlaceholder, UndeclaredMembers, ValidatedPrimitive,
    ValidationMember, ValidationNode, ValidationRule, ValidationShape,
};
use crate::lower::CheckerTypeId;

const ROOT: u32 = 0;
const MAX_NESTED_CONSTRAINT_LISTS: usize = 8;

#[derive(Copy, Clone)]
pub(super) struct Source<'c> {
    node: u32,
    ty: CheckerTypeId,
    shape: TypeShape<'c>,
    is_deep_strict: bool,
}

pub(super) struct NodeBuilder<'f, 'c, F> {
    pub(super) file: &'f mut F,
    nodes: Vec<ValidationNode>,
    origins: Vec<Option<Origin>>,
    ids: FxHashMap<(CheckerTypeId, bool), u32>,
    pending: VecDeque<Source<'c>>,
    orders: WrittenUnionOrders,
    position: u32,
}

pub(super) fn validation_nodes<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    ty: CheckerTypeId,
    written: TypeNodeId,
    position: u32,
) -> Result<Rc<[ValidationNode]>, ValidationError> {
    let key = (ty, file.queries().written_place(written));
    if let Some(nodes) = file.validation().nodes_by_type.get(&key) {
        return Ok(Rc::clone(nodes));
    }
    let limits_hit = file.queries().count_limits_hit();
    let max_declarations = file.limit(LimitId::MaxValidationNodes) as usize;
    let orders = (file.queries()).written_union_orders(written, max_declarations);
    let mut builder = NodeBuilder {
        file: &mut *file,
        nodes: Vec::new(),
        origins: Vec::new(),
        ids: FxHashMap::default(),
        pending: VecDeque::new(),
        orders,
        position,
    };
    builder.ensure(ty, false, None)?;
    while let Some(source) = builder.pending.pop_front() {
        builder.fill(source)?;
    }
    // At a limit the checker goes on with the error type, which a conditional type swallows: the nodes would be those of another type.
    if builder.file.queries().count_limits_hit() != limits_hit {
        return Err(ValidationError::GaveUp(GaveUp::ErrorType));
    }
    if let Some(node) = find_node_tested_against_itself(&builder.nodes) {
        return Err(builder.refuse_at(node, b"a type that is tested against itself"));
    }
    let nodes: Rc<[ValidationNode]> = builder.nodes.into();
    let memo = &mut file.validation().nodes_by_type;
    memo.insert(key, Rc::clone(&nodes));
    Ok(nodes)
}

fn placeholder_of(kind: ShapeKind<'_>) -> Option<TemplatePlaceholder> {
    match kind {
        ShapeKind::String | ShapeKind::Anything(AnythingReason::Any) => {
            Some(TemplatePlaceholder::String)
        }
        ShapeKind::Number => Some(TemplatePlaceholder::Number),
        ShapeKind::BigInt => Some(TemplatePlaceholder::BigInt),
        ShapeKind::Anything(
            AnythingReason::Unknown | AnythingReason::EmptyObjectType | AnythingReason::Void,
        )
        | ShapeKind::TypeVariable { .. }
        | ShapeKind::Never
        | ShapeKind::Undefined
        | ShapeKind::Null
        | ShapeKind::Boolean
        | ShapeKind::BooleanLiteral(_)
        | ShapeKind::NumberLiteral(_)
        | ShapeKind::NumericEnumMember(_)
        | ShapeKind::BigIntLiteral { .. }
        | ShapeKind::StringLiteral(_)
        | ShapeKind::TemplateLiteral { .. }
        | ShapeKind::Symbol
        | ShapeKind::AnyObject
        | ShapeKind::Function(_)
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Array { .. }
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Class(_)
        | ShapeKind::Object
        | ShapeKind::Union(_)
        | ShapeKind::Constrained { .. } => None,
    }
}

fn is_default(constraint: &SchemaConstraint<'_>) -> bool {
    matches!(constraint, SchemaConstraint::Default(_))
}

/// An arm of a primitive kind gives back the value it accepts, so it makes no difference which of several takes it.
fn is_primitive_kind(kind: ShapeKind<'_>) -> bool {
    !matches!(
        kind,
        ShapeKind::Anything(_)
            | ShapeKind::TypeVariable { .. }
            | ShapeKind::AnyObject
            | ShapeKind::Function(_)
            | ShapeKind::ClassConstructor(_)
            | ShapeKind::Array { .. }
            | ShapeKind::Tuple { .. }
            | ShapeKind::Builtin { .. }
            | ShapeKind::Class(_)
            | ShapeKind::Object
            | ShapeKind::Union(_)
            | ShapeKind::Constrained { .. }
    )
}

fn undeclared_without_signature(is_deep_strict: bool) -> UndeclaredMembers {
    if is_deep_strict {
        UndeclaredMembers::Rejected
    } else {
        UndeclaredMembers::Allowed
    }
}

fn primitive_shape(primitive: ValidatedPrimitive) -> ValidationShape {
    ValidationShape::Primitive { primitive }
}

/// The nodes that test the very value that `node` tests. The others test a part of it, which is smaller.
fn nodes_of_same_value(node: &ValidationNode) -> SmallVec<[u32; 8]> {
    let mut found: SmallVec<[u32; 8]> = SmallVec::new();
    match &node.shape {
        ValidationShape::Union { arms } => found.extend_from_slice(arms),
        ValidationShape::Unknown
        | ValidationShape::Never
        | ValidationShape::Undefined
        | ValidationShape::Null
        | ValidationShape::AnyObject
        | ValidationShape::Primitive { .. }
        | ValidationShape::BooleanLiteral { .. }
        | ValidationShape::NumberLiteral { .. }
        | ValidationShape::StringLiteral { .. }
        | ValidationShape::Array { .. }
        | ValidationShape::Tuple { .. }
        | ValidationShape::Dictionary { .. }
        | ValidationShape::Object { .. } => {}
    }
    for rule in &node.rules {
        match rule {
            ValidationRule::Not { node } | ValidationRule::DependentNode { node, .. } => {
                found.push(*node);
            }
            ValidationRule::If {
                condition,
                then,
                otherwise,
            } => found.extend([*condition, *then, *otherwise]),
            ValidationRule::ExactlyOne { nodes } | ValidationRule::Every { nodes } => {
                found.extend_from_slice(nodes);
            }
            ValidationRule::Integer
            | ValidationRule::Minimum { .. }
            | ValidationRule::Maximum { .. }
            | ValidationRule::ExclusiveMinimum { .. }
            | ValidationRule::ExclusiveMaximum { .. }
            | ValidationRule::MultipleOf { .. }
            | ValidationRule::MinimumLength { .. }
            | ValidationRule::MaximumLength { .. }
            | ValidationRule::Pattern { .. }
            | ValidationRule::Format { .. }
            | ValidationRule::Template { .. }
            | ValidationRule::Message { .. }
            | ValidationRule::DefaultNull
            | ValidationRule::DefaultBoolean { .. }
            | ValidationRule::DefaultNumber { .. }
            | ValidationRule::DefaultString { .. }
            | ValidationRule::UniqueItems
            | ValidationRule::Contains { .. }
            | ValidationRule::PatternMembers { .. }
            | ValidationRule::MemberNames { .. }
            | ValidationRule::MinimumMembers { .. }
            | ValidationRule::MaximumMembers { .. }
            | ValidationRule::DependentMembers { .. } => {}
        }
    }
    found
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Visit {
    Unseen,
    Open,
    Closed,
}

/// Such a test never ends: `type Loop = Schema.Not<Loop>`.
fn find_node_tested_against_itself(nodes: &[ValidationNode]) -> Option<u32> {
    let mut visits = vec![Visit::Unseen; nodes.len()];
    let mut open: Vec<(u32, SmallVec<[u32; 8]>)> = Vec::new();
    for start in 0..nodes.len() as u32 {
        if visits[start as usize] != Visit::Unseen {
            continue;
        }
        visits[start as usize] = Visit::Open;
        open.push((start, nodes_of_same_value(&nodes[start as usize])));
        while let Some((node, rest)) = open.last_mut() {
            let Some(next) = rest.pop() else {
                visits[*node as usize] = Visit::Closed;
                open.pop();
                continue;
            };
            match visits[next as usize] {
                Visit::Open => return Some(next),
                Visit::Closed => {}
                Visit::Unseen => {
                    visits[next as usize] = Visit::Open;
                    open.push((next, nodes_of_same_value(&nodes[next as usize])));
                }
            }
        }
    }
    None
}

impl<'c, 'p: 'c, 's: 'p, F: ValidatedFile<'c, 'p, 's>> NodeBuilder<'_, 'c, F> {
    pub(super) fn shape_of(&mut self, ty: CheckerTypeId) -> Result<TypeShape<'c>, ValidationError> {
        let shape = self.file.queries().type_shape(ty);
        shape.map_err(ValidationError::GaveUp)
    }

    fn ensure(
        &mut self,
        ty: CheckerTypeId,
        is_deep_strict: bool,
        origin: Option<Origin>,
    ) -> Result<u32, ValidationError> {
        let shape = match self.file.queries().type_shape(ty) {
            Ok(shape) => shape,
            Err(GaveUp::ErrorType) => {
                return Err(self.file.describe_unsupported(&self.origins, origin, ty));
            }
            Err(
                reason
                @ (GaveUp::Unresolved | GaveUp::FlowAnalysisDisabled | GaveUp::UnreachedNode),
            ) => return Err(ValidationError::GaveUp(reason)),
        };
        let key = if matches!(shape.kind, ShapeKind::Undefined) {
            (CheckerTypeId::UNDEFINED, false)
        } else {
            (ty, is_deep_strict)
        };
        if let Some(&node) = self.ids.get(&key) {
            return Ok(node);
        }
        let (ty, is_deep_strict) = key;
        let node = self.add_node(ty, origin)?;
        self.ids.insert(key, node);
        self.pending.push_back(Source {
            node,
            ty,
            shape,
            is_deep_strict,
        });
        Ok(node)
    }

    fn ensure_child(
        &mut self,
        source: Source<'c>,
        ty: CheckerTypeId,
        step: Step,
    ) -> Result<u32, ValidationError> {
        let origin = Origin {
            parent: source.node,
            step,
        };
        self.ensure(ty, source.is_deep_strict, Some(origin))
    }

    /// A type argument of a rule is a type of its own: it is as strict as it is written. Under `Schema.Not`, a stricter one would accept more.
    pub(super) fn ensure_operand(
        &mut self,
        source: Source<'c>,
        ty: CheckerTypeId,
        alias: &'static str,
    ) -> Result<u32, ValidationError> {
        let origin = Origin {
            parent: source.node,
            step: Step::RuleOperand(alias),
        };
        self.ensure(ty, false, Some(origin))
    }

    /// A type argument that says what a part of the value holds, and that no other node tests: `Schema.DeepStrict` reaches it as it reaches a member.
    pub(super) fn ensure_part(
        &mut self,
        source: Source<'c>,
        ty: CheckerTypeId,
        alias: &'static str,
    ) -> Result<u32, ValidationError> {
        self.ensure_child(source, ty, Step::RuleOperand(alias))
    }

    pub(super) fn node_mut(&mut self, source: Source<'c>) -> &mut ValidationNode {
        &mut self.nodes[source.node as usize]
    }

    fn add_node(
        &mut self,
        ty: CheckerTypeId,
        origin: Option<Origin>,
    ) -> Result<u32, ValidationError> {
        if self.nodes.len() as u64 >= self.file.limit(LimitId::MaxValidationNodes) {
            self.file
                .gave_up(LimitId::MaxValidationNodes, self.position);
            return Err(ValidationError::TooLarge);
        }
        let node = self.nodes.len() as u32;
        let ty = self.file.result_type(ty, self.position);
        self.nodes.push(ValidationNode {
            shape: ValidationShape::Never,
            ty,
            rules: Vec::new(),
            text: None,
        });
        self.origins.push(origin);
        Ok(node)
    }

    fn fill(&mut self, mut source: Source<'c>) -> Result<(), ValidationError> {
        let mut constraint_lists: SmallVec<[&'c [SchemaConstraint<'c>]; 1]> = SmallVec::new();
        let mut visited: SmallVec<[CheckerTypeId; 2]> = SmallVec::new();
        while let ShapeKind::Constrained { base, constraints } = source.shape.kind {
            if visited.contains(&source.ty) {
                return Err(ValidationError::GaveUp(GaveUp::Unresolved));
            }
            visited.push(source.ty);
            constraint_lists.push(constraints);
            source.is_deep_strict |= constraints.contains(&SchemaConstraint::DeepStrict);
            source.ty = base;
            source.shape = self.shape_of(base)?;
        }
        if let Some(rule) = find_refused_rule(&constraint_lists) {
            return Err(self.refuse_atom(source, rule));
        }
        let shape = self.compute_shape(source)?;
        self.nodes[source.node as usize].shape = shape;
        apply_constraints(self, source, &constraint_lists)
    }

    fn compute_shape(&mut self, source: Source<'c>) -> Result<ValidationShape, ValidationError> {
        let is_builtin_subtype = self.file.queries().is_builtin_subtype(source.ty);
        if is_builtin_subtype.map_err(ValidationError::GaveUp)?
            || self.file.queries().says_more_than_its_shape(source.ty)
        {
            return Err(self.unsupported(source));
        }
        match source.shape.kind {
            ShapeKind::Anything(AnythingReason::Any | AnythingReason::Unknown) => {
                Ok(ValidationShape::Unknown)
            }
            ShapeKind::Anything(AnythingReason::EmptyObjectType) => {
                self.set_object_text(source);
                Ok(ValidationShape::Object {
                    layout: None,
                    members: Vec::new(),
                    undeclared: undeclared_without_signature(source.is_deep_strict),
                    undeclared_value: None,
                })
            }
            ShapeKind::TypeVariable { .. } if source.node == ROOT => {
                let text = self.file.queries().type_text(source.ty);
                Err(ValidationError::TypeParameter { text })
            }
            ShapeKind::Never => Ok(ValidationShape::Never),
            ShapeKind::Undefined => Ok(ValidationShape::Undefined),
            ShapeKind::Null => Ok(ValidationShape::Null),
            ShapeKind::AnyObject => Ok(ValidationShape::AnyObject),
            ShapeKind::Boolean => Ok(primitive_shape(ValidatedPrimitive::Boolean)),
            ShapeKind::Number => Ok(primitive_shape(ValidatedPrimitive::Number)),
            ShapeKind::String => Ok(primitive_shape(ValidatedPrimitive::String)),
            ShapeKind::BigInt => Ok(primitive_shape(ValidatedPrimitive::BigInt)),
            ShapeKind::BooleanLiteral(value) => Ok(ValidationShape::BooleanLiteral { value }),
            ShapeKind::NumberLiteral(value) | ShapeKind::NumericEnumMember(value) => {
                Ok(ValidationShape::NumberLiteral { value })
            }
            ShapeKind::StringLiteral(text) => {
                let value = self.file.intern_atom(text);
                Ok(ValidationShape::StringLiteral { value })
            }
            ShapeKind::TemplateLiteral { texts, types } => {
                self.compute_template_shape(source, texts, types)
            }
            ShapeKind::Array { element, .. } => {
                let element = self.ensure_child(source, element, Step::ArrayElement)?;
                Ok(ValidationShape::Array { element })
            }
            ShapeKind::Tuple { elements, .. } => self.compute_tuple_shape(source, elements),
            ShapeKind::Union(arm_types) => {
                let arm_types = self.order_arms(source.ty, arm_types)?;
                let mut arms = Vec::with_capacity(arm_types.len());
                for arm_type in arm_types {
                    arms.push(self.ensure_child(source, arm_type, Step::UnionArm)?);
                }
                Ok(ValidationShape::Union { arms })
            }
            ShapeKind::Object => self.compute_object_shape(source),
            ShapeKind::Constrained { .. } => {
                unreachable!("fill reads the base of a constrained type")
            }
            ShapeKind::Anything(AnythingReason::Void)
            | ShapeKind::TypeVariable { .. }
            | ShapeKind::BigIntLiteral { .. }
            | ShapeKind::Symbol
            | ShapeKind::Function(_)
            | ShapeKind::ClassConstructor(_)
            | ShapeKind::Builtin { .. }
            | ShapeKind::Class(_) => Err(self.unsupported(source)),
        }
    }

    fn builds_value(&mut self, arm: CheckerTypeId) -> Result<bool, ValidationError> {
        let mut kind = self.shape_of(arm)?.kind;
        let mut steps = 0;
        while let ShapeKind::Constrained { base, constraints } = kind {
            steps += 1;
            if constraints.iter().any(is_default) || steps > MAX_NESTED_CONSTRAINT_LISTS {
                return Ok(true);
            }
            kind = self.shape_of(base)?.kind;
        }
        Ok(!is_primitive_kind(kind))
    }

    /// Where several arms accept a value, the one that is written first builds the result.
    fn order_arms(
        &mut self,
        union: CheckerTypeId,
        arms: &[CheckerTypeId],
    ) -> Result<SmallVec<[CheckerTypeId; 8]>, ValidationError> {
        let mut places: SmallVec<[usize; 8]> = SmallVec::new();
        for (place, &arm) in arms.iter().enumerate() {
            if self.builds_value(arm)? {
                places.push(place);
            }
        }
        let mut builders: SmallVec<[(CheckerTypeId, CheckerTypeId); 8]> = SmallVec::new();
        for &place in &places {
            builders.push((arms[place], self.find_written_type(arms[place])?));
        }
        self.orders
            .sort_members_by(union, &mut builders[..], |&(_, written)| written);
        let mut ordered: SmallVec<[CheckerTypeId; 8]> = SmallVec::from_slice(arms);
        for (&place, (builder, _)) in places.iter().zip(builders) {
            ordered[place] = builder;
        }
        Ok(ordered)
    }

    /// `(A | B) & Schema.Strict` is the union of `A & Schema.Strict` and `B & Schema.Strict`, which nobody wrote: each goes by its base.
    fn find_written_type(&mut self, arm: CheckerTypeId) -> Result<CheckerTypeId, ValidationError> {
        let mut ty = arm;
        for _ in 0..MAX_NESTED_CONSTRAINT_LISTS {
            if self.orders.is_written(ty) {
                return Ok(ty);
            }
            let ShapeKind::Constrained { base, .. } = self.shape_of(ty)?.kind else {
                break;
            };
            ty = base;
        }
        Ok(arm)
    }

    fn compute_template_shape(
        &mut self,
        source: Source<'c>,
        texts: &[Atom],
        types: &[CheckerTypeId],
    ) -> Result<ValidationShape, ValidationError> {
        let [head, tail @ ..] = texts else {
            return Err(self.unsupported(source));
        };
        debug_assert_eq!(tail.len(), types.len(), "a text follows each placeholder");
        let mut parts = Vec::with_capacity(types.len());
        for (&ty, &text) in types.iter().zip(tail) {
            let placeholder = placeholder_of(self.shape_of(ty)?.kind)
                .filter(|_| !self.file.queries().says_more_than_its_shape(ty));
            let Some(placeholder) = placeholder else {
                return Err(self.unsupported(source));
            };
            let text = self.file.intern_atom(text);
            parts.push(TemplatePart { placeholder, text });
        }
        let head = self.file.intern_atom(*head);
        let text = self.file.queries().template_literal_text(source.ty);
        let text = self.file.intern_bytes(&text);
        let node = &mut self.nodes[source.node as usize];
        node.rules.push(ValidationRule::Template { head, parts });
        node.text = Some(text);
        Ok(primitive_shape(ValidatedPrimitive::String))
    }

    fn compute_tuple_shape(
        &mut self,
        source: Source<'c>,
        elements: &[TupleElement],
    ) -> Result<ValidationShape, ValidationError> {
        let mut nodes = Vec::with_capacity(elements.len());
        let mut required: u32 = 0;
        let mut rest = None;
        for (index, element) in elements.iter().enumerate() {
            if rest.is_some() {
                return Err(self.unsupported(source));
            }
            let step = Step::TupleElement(index as u32);
            match element.kind {
                TupleElementKind::Required if required as usize == index => {
                    required += 1;
                    nodes.push(self.ensure_child(source, element.ty, step)?);
                }
                TupleElementKind::Optional => {
                    nodes.push(self.ensure_optional_element(source, element.ty, step)?);
                }
                TupleElementKind::Rest => {
                    rest = Some(self.ensure_child(source, element.ty, Step::ArrayElement)?);
                }
                TupleElementKind::Required | TupleElementKind::Variadic => {
                    return Err(self.unsupported(source));
                }
            }
        }
        Ok(ValidationShape::Tuple {
            elements: nodes,
            required,
            rest,
        })
    }

    /// The checker adds `undefined` to the type of `B?`. An element that is there is a `B`: an array that ends early says that it is not.
    fn ensure_optional_element(
        &mut self,
        source: Source<'c>,
        ty: CheckerTypeId,
        step: Step,
    ) -> Result<u32, ValidationError> {
        let shape = self.shape_of(ty)?;
        let ShapeKind::Union(arms) = shape.kind else {
            return self.ensure_child(source, ty, step);
        };
        let mut present: SmallVec<[CheckerTypeId; 8]> = SmallVec::new();
        for &arm in arms {
            if !matches!(self.shape_of(arm)?.kind, ShapeKind::Undefined) {
                present.push(arm);
            }
        }
        if present.len() == arms.len() {
            return self.ensure_child(source, ty, step);
        }
        if let [only] = present[..] {
            return self.ensure_child(source, only, step);
        }
        let origin = Origin {
            parent: source.node,
            step,
        };
        let node = self.add_node(ty, Some(origin))?;
        let union = Source {
            node,
            ty,
            shape,
            is_deep_strict: source.is_deep_strict,
        };
        let mut nodes = Vec::with_capacity(present.len());
        for arm in self.order_arms(ty, &present)? {
            nodes.push(self.ensure_child(union, arm, Step::UnionArm)?);
        }
        self.nodes[node as usize].shape = ValidationShape::Union { arms: nodes };
        Ok(node)
    }

    fn compute_object_shape(
        &mut self,
        source: Source<'c>,
    ) -> Result<ValidationShape, ValidationError> {
        let declared = self.file.queries().object_members(source.ty);
        let declared = declared.map_err(ValidationError::GaveUp)?;
        let layout = self.file.object_type_layout(source.ty);
        let mut members = Vec::with_capacity(declared.len());
        for member in declared {
            members.push(self.compute_member(source, layout, member)?);
        }
        let signatures = self.file.queries().index_signatures(source.ty);
        let value_type = match signatures.map_err(ValidationError::GaveUp)? {
            [] => None,
            [signature] => match signature.key {
                IndexKey::String => Some(signature.types.checked.map_err(ValidationError::GaveUp)?),
                IndexKey::Number | IndexKey::Symbol | IndexKey::Pattern => {
                    return Err(self.unsupported(source));
                }
            },
            [_, _, ..] => return Err(self.unsupported(source)),
        };
        let (undeclared, undeclared_value) = match value_type {
            None => (undeclared_without_signature(source.is_deep_strict), None),
            Some(value_type) => {
                let value = self.ensure_child(source, value_type, Step::IndexSignatureValue)?;
                if members.is_empty() {
                    return Ok(ValidationShape::Dictionary { value });
                }
                (UndeclaredMembers::Validated, Some(value))
            }
        };
        self.set_object_text(source);
        Ok(ValidationShape::Object {
            layout,
            members,
            undeclared,
            undeclared_value,
        })
    }

    fn compute_member(
        &mut self,
        source: Source<'c>,
        layout: Option<LayoutId>,
        member: &ObjectMember,
    ) -> Result<ValidationMember, ValidationError> {
        let name = match member.name {
            MemberName::String(name) => name,
            MemberName::Symbol(_) | MemberName::Private(_) => {
                return Err(self.unsupported(source));
            }
        };
        // The checker turns an alias of `Schema` into a constraint. A mapped type over one gives its key to an object type, with whatever modifiers, and the rule would be skipped.
        if BRAND_KEYS.contains(&self.file.queries().atom_bytes(name)) {
            return Err(self.refuse_atom(source, name));
        }
        let key = self.file.name_key(name);
        let origin = Origin {
            parent: source.node,
            step: Step::NamedMember(name),
        };
        let ty = member.types.checked.map_err(ValidationError::GaveUp)?;
        match member.kind {
            ObjectMemberKind::Method => {
                return Err(self
                    .file
                    .describe_unsupported(&self.origins, Some(origin), ty));
            }
            ObjectMemberKind::Field
            | ObjectMemberKind::Getter
            | ObjectMemberKind::Setter
            | ObjectMemberKind::GetterAndSetter => {}
        }
        let node = self.ensure(ty, source.is_deep_strict, Some(origin))?;
        let field = layout.and_then(|layout| self.file.find_field(layout, key));
        Ok(ValidationMember {
            key,
            node,
            field,
            is_optional: member.is_optional,
        })
    }

    fn set_object_text(&mut self, source: Source<'c>) {
        let name = self.file.queries().type_display_name(source.ty);
        let text = name.map(|name| self.file.intern_bytes(&name.text));
        self.nodes[source.node as usize].text = text;
    }

    fn unsupported(&mut self, source: Source<'c>) -> ValidationError {
        let origin = self.origins[source.node as usize];
        self.file
            .describe_unsupported(&self.origins, origin, source.ty)
    }

    pub(super) fn refuse(&mut self, source: Source<'c>, rule: &[u8]) -> ValidationError {
        self.refuse_at(source.node, rule)
    }

    pub(super) fn refuse_atom(&mut self, source: Source<'c>, rule: Atom) -> ValidationError {
        let rule = self.file.atom_bytes(rule);
        self.refuse_at(source.node, rule)
    }

    fn refuse_at(&mut self, node: u32, rule: &[u8]) -> ValidationError {
        let origin = self.origins[node as usize];
        self.file.describe_refused(&self.origins, origin, rule)
    }
}

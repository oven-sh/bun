#[cfg(test)]
mod tests;

use bun_sema::atom::{Atom, number_to_string};
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, File, IdList, PropId, PropKey, Span};
use bun_sema::hir_from_data::DataValue;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use crate::ir::generated::{DataMember, DataNode};
use crate::ir::{PositionFlags, PropertyKeyId, TypeTable};
use crate::lower::{FileLowering, FunctionLowering, convert, layouts, positions};

const MAX_LINEAR_SEARCH_MEMBERS: usize = 8;

type LayoutMembers = SmallVec<[(PropertyKeyId, ObjectMemberKind); 16]>;

#[derive(Copy, Clone)]
pub(super) enum Part<'v> {
    Expression(ExprId),
    Value(&'v DataValue<'v>),
}

#[derive(Copy, Clone)]
enum Composite<'v> {
    ArrayLiteral(ExprId, IdList<ExprId>),
    ObjectLiteral(ExprId, Span<PropId>),
    ArrayValue(&'v [DataValue<'v>]),
    ObjectValue(&'v [(Atom, DataValue<'v>)]),
}

struct Frame<'v> {
    composite: Composite<'v>,
    next_child: usize,
    first_node: usize,
}

impl<'v> Frame<'v> {
    fn take_child(&mut self, hir: &File<'_>) -> Option<Part<'v>> {
        let index = self.next_child;
        self.next_child += 1;
        match self.composite {
            Composite::ArrayLiteral(_, items) => {
                (index < items.len()).then(|| Part::Expression(hir.id_at(items, index)))
            }
            Composite::ObjectLiteral(_, properties) => (index < properties.len())
                .then(|| Part::Expression(hir[properties.at(index)].value)),
            Composite::ArrayValue(items) => items.get(index).map(Part::Value),
            Composite::ObjectValue(entries) => {
                entries.get(index).map(|entry| Part::Value(&entry.1))
            }
        }
    }
}

pub(super) fn create_node(file: &mut FileLowering<'_, '_, '_, '_>, root: Part<'_>) -> DataNode {
    let hir = file.hir;
    let mut frames = Vec::new();
    let mut finished = Vec::new();
    visit(file, root, &mut frames, &mut finished);
    while let Some(frame) = frames.last_mut() {
        if let Some(child) = frame.take_child(hir) {
            visit(file, child, &mut frames, &mut finished);
            continue;
        }
        let (composite, first_node) = (frame.composite, frame.first_node);
        frames.pop();
        let children = finished.split_off(first_node);
        let node = match composite {
            Composite::ArrayLiteral(literal, _) => DataNode::Array {
                contents: file.array_literal_contents(literal),
                elements: children,
            },
            Composite::ObjectLiteral(literal, properties) => {
                finish_object_literal(file, literal, properties, children)
            }
            Composite::ArrayValue(_) => DataNode::Array {
                contents: TypeTable::ANYTHING,
                elements: children,
            },
            Composite::ObjectValue(entries) => finish_object_value(file, entries, children),
        };
        finished.push(node);
    }
    finished.pop().expect("the walk finishes the root")
}

fn visit<'v>(
    file: &mut FileLowering<'_, '_, '_, '_>,
    part: Part<'v>,
    frames: &mut Vec<Frame<'v>>,
    finished: &mut Vec<DataNode>,
) {
    let first_node = finished.len();
    let mut wait_for_children = |composite| {
        frames.push(Frame {
            composite,
            next_child: 0,
            first_node,
        });
    };
    let leaf = match part {
        Part::Expression(mut literal) => loop {
            if let Some(node) = file.create_folded_node(literal) {
                break node;
            }
            if let Some(operand) = file.hir.type_assertion_operand(literal) {
                literal = operand;
                continue;
            }
            match file.hir[literal].kind {
                ExprKind::Array(items) => {
                    return wait_for_children(Composite::ArrayLiteral(literal, items));
                }
                ExprKind::Object(properties) => {
                    return wait_for_children(Composite::ObjectLiteral(literal, properties));
                }
                _ => {
                    debug_assert!(false, "every part of a data literal is constant data");
                    break DataNode::Undefined;
                }
            }
        },
        Part::Value(value) => file.create_leaf(match *value {
            DataValue::Undefined => Constant::Undefined,
            DataValue::Null => Constant::Null,
            DataValue::Boolean(value) => Constant::Boolean(value),
            DataValue::Number(value) => Constant::Number(value),
            DataValue::String(text) => Constant::String(text),
            DataValue::BigInt(digits) => Constant::BigInt(digits),
            DataValue::Array(items) => return wait_for_children(Composite::ArrayValue(items)),
            DataValue::Object(entries) => {
                return wait_for_children(Composite::ObjectValue(entries));
            }
        }),
    };
    finished.push(leaf);
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn convert_int32_member(&mut self, literal: ExprId, property: PropId) {
        let file = &mut *self.file;
        let layout = file.literal_layout(literal);
        let key = constant_key(file, property);
        let Some(field) = file.find_field(layout, key) else {
            return;
        };
        let position = file.field_position(layout, field);
        let value = file.hir[property].value;
        let FoldedValue::Constant(constant) = file.decisions().constant(file.hir, value) else {
            return;
        };
        if !position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
            return;
        }
        let constant = self.emit_constant(constant);
        let subject = convert::Int32Subject::LiteralProperty;
        self.describe_int32_flow(position, subject, Some(value));
        self.convert_initializer(constant, position, Some(value));
    }

    /// No operation stores a member of a data literal, so a member that enters an `int32` gets a request of its own.
    pub(super) fn convert_int32_members(&mut self, root: ExprId) {
        let hir = self.file.hir;
        let mut pending = vec![root];
        while let Some(expression) = pending.pop() {
            let literal = hir.skip_type_assertions(expression);
            match hir[literal].kind {
                ExprKind::Array(items) => pending.extend(hir.ids(items)),
                ExprKind::Object(properties) => {
                    // The positions of the fields are made when they are first asked for, which may be here.
                    let layout = self.file.literal_layout(literal);
                    layouts::own_fields(self.file, layout);
                    let has_promise = positions::has_int32_promise(self.file);
                    for property in properties.iter() {
                        if has_promise {
                            self.convert_int32_member(literal, property);
                        }
                        pending.push(hir[property].value);
                    }
                }
                _ => {}
            }
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn create_folded_node(&mut self, expression: ExprId) -> Option<DataNode> {
        let decisions = self.decisions();
        match decisions.decision(expression) {
            Decision::Constant(constant) => return Some(self.create_leaf(constant)),
            Decision::Data(value) => return Some(create_node(self, Part::Value(value))),
            Decision::DeferredData | Decision::GlobalPath(_) => {
                debug_assert!(
                    false,
                    "every part of a data literal has its value at build time"
                );
                return Some(DataNode::Undefined);
            }
            Decision::Unknown => {}
        }
        match decisions.constant(self.hir, expression) {
            FoldedValue::Constant(constant) => Some(self.create_leaf(constant)),
            FoldedValue::ConstantOutsideDeadZone(constant) => {
                debug_assert!(false, "no part of a data literal checks a dead zone");
                Some(self.create_leaf(constant))
            }
            FoldedValue::Unknown => None,
        }
    }

    fn create_leaf(&mut self, constant: Constant) -> DataNode {
        match constant {
            Constant::Undefined => DataNode::Undefined,
            Constant::Null => DataNode::Null,
            Constant::Boolean(value) => DataNode::Boolean { value },
            Constant::Number(value) => DataNode::Number { value },
            Constant::String(text) => DataNode::String {
                value: self.intern_atom(text),
            },
            Constant::BigInt(digits) => DataNode::BigInt {
                digits: self.intern_atom(digits),
            },
        }
    }

    pub(super) fn create_deferred_node(&mut self) -> DataNode {
        match self.inputs.deferred_data.get(self.file) {
            Some(value) => create_node(self, Part::Value(value)),
            None => {
                debug_assert!(false, "module binding has the manifest of every page");
                DataNode::Undefined
            }
        }
    }

    fn to_property_key(&mut self, constant: Constant) -> PropertyKeyId {
        match constant {
            Constant::String(text) => self.name_key(text),
            Constant::Number(number) => intern_text_key(self, &number_to_string(number)),
            Constant::BigInt(digits) => self.atom_key(digits),
            Constant::Boolean(true) => intern_text_key(self, b"true"),
            Constant::Boolean(false) => intern_text_key(self, b"false"),
            Constant::Null => intern_text_key(self, b"null"),
            Constant::Undefined => intern_text_key(self, b"undefined"),
        }
    }
}

fn finish_object_literal(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
    properties: Span<PropId>,
    values: Vec<DataNode>,
) -> DataNode {
    debug_assert_eq!(
        properties.len(),
        values.len(),
        "each property has one finished node"
    );
    let layout = file.literal_layout(literal);
    let searches_linearly = properties.len() <= MAX_LINEAR_SEARCH_MEMBERS;
    let mut members: Vec<DataMember> = Vec::with_capacity(values.len());
    let mut member_indexes: FxHashMap<PropertyKeyId, usize> = FxHashMap::default();
    if !searches_linearly {
        member_indexes.reserve(properties.len());
    }
    for (property, value) in properties.iter().zip(values) {
        let key = constant_key(file, property);
        let next_index = members.len();
        let index = if searches_linearly {
            let found = members.iter().position(|member| member.key == key);
            found.unwrap_or(next_index)
        } else {
            *member_indexes.entry(key).or_insert(next_index)
        };
        match members.get_mut(index) {
            Some(member) => member.value = value,
            None => members.push(DataMember { key, value }),
        }
    }
    DataNode::Object { layout, members }
}

fn finish_object_value(
    file: &mut FileLowering<'_, '_, '_, '_>,
    entries: &[(Atom, DataValue<'_>)],
    values: Vec<DataNode>,
) -> DataNode {
    debug_assert_eq!(
        entries.len(),
        values.len(),
        "each entry has one finished node"
    );
    let layout_members: LayoutMembers = entries
        .iter()
        .map(|&(name, _)| (file.name_key(name), ObjectMemberKind::Field))
        .collect();
    let layout = file.untyped_layout(&layout_members);
    let members = layout_members
        .into_iter()
        .zip(values)
        .map(|((key, _), value)| DataMember { key, value })
        .collect();
    DataNode::Object { layout, members }
}

fn constant_key(file: &mut FileLowering<'_, '_, '_, '_>, property: PropId) -> PropertyKeyId {
    let folded = match file.hir.runtime_property_key(property) {
        PropKey::Name(name) => return file.name_key(name),
        PropKey::Computed(key) => file.decisions().constant(file.hir, key),
        PropKey::None | PropKey::Private(_) => FoldedValue::Unknown,
    };
    match folded {
        FoldedValue::Constant(constant) => file.to_property_key(constant),
        FoldedValue::ConstantOutsideDeadZone(constant) => {
            debug_assert!(false, "no key of a data literal checks a dead zone");
            file.to_property_key(constant)
        }
        FoldedValue::Unknown => {
            debug_assert!(false, "every key of a data literal is constant");
            intern_text_key(file, b"")
        }
    }
}

fn intern_text_key(file: &mut FileLowering<'_, '_, '_, '_>, text: &[u8]) -> PropertyKeyId {
    let text = file.intern_bytes(text);
    file.text_key(text)
}

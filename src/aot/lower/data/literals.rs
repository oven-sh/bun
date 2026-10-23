use bun_sema::atom::number_to_string;
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, File, IdList, PropId, PropKey, Span};
use rustc_hash::FxHashMap;

use super::values::{create_leaf, create_node as create_value_node};
use crate::ir::generated::{DataMember, DataNode};
use crate::ir::{PositionFlags, PropertyKeyId};
use crate::lower::{
    FileLowering, FunctionLowering, convert, expression, layouts, member, positions, types,
};

const MAX_LINEAR_SEARCH_MEMBERS: usize = 8;

#[derive(Copy, Clone)]
enum Composite {
    Array {
        literal: ExprId,
        items: IdList<ExprId>,
    },
    Object {
        literal: ExprId,
        properties: Span<PropId>,
    },
}

struct Frame {
    composite: Composite,
    next_child: usize,
    first_node: usize,
}

impl Frame {
    fn take_child(&mut self, hir: &File<'_>) -> Option<ExprId> {
        let index = self.next_child;
        let child = match self.composite {
            Composite::Array { items, .. } if index < items.len() => hir.id_at(items, index),
            Composite::Object { properties, .. } if index < properties.len() => {
                hir[properties.at(index)].value
            }
            Composite::Array { .. } | Composite::Object { .. } => return None,
        };
        self.next_child += 1;
        Some(child)
    }
}

pub(super) fn create_node(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    root: ExprId,
) -> DataNode {
    let file = &mut *lowering.file;
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
            Composite::Array { literal, .. } => finish_array(file, literal, children),
            Composite::Object {
                literal,
                properties,
            } => finish_object(file, literal, properties, children),
        };
        finished.push(node);
    }
    finished.pop().expect("the walk finishes the root")
}

fn convert_int32_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
    property: PropId,
) {
    let file = &mut *lowering.file;
    let layout = layouts::literal_layout(file, literal);
    let key = constant_key(file, property);
    let Some(field) = layouts::find_field(file, layout, key) else {
        return;
    };
    let position = layouts::field_position(file, layout, field);
    let value = file.hir[property].value;
    let FoldedValue::Constant(constant) = file.decisions().constant(file.hir, value) else {
        return;
    };
    if !position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
        return;
    }
    let constant = expression::emit_constant(lowering, constant);
    let subject = convert::Int32Subject::LiteralProperty;
    convert::describe_int32_flow(lowering, position, subject, Some(value));
    convert::convert_initializer(lowering, constant, position, Some(value));
}

/// No operation stores a member of a data literal, so a member that enters an `int32` gets a request of its own.
pub(super) fn convert_int32_members(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    root: ExprId,
) {
    let hir = lowering.file.hir;
    let mut pending = vec![root];
    while let Some(expression) = pending.pop() {
        match find_composite(hir, hir.skip_type_assertions(expression)) {
            Some(Composite::Array { items, .. }) => pending.extend(hir.ids(items)),
            Some(Composite::Object {
                literal,
                properties,
            }) => {
                // The positions of the fields are made when they are first asked for, which may be here.
                let layout = layouts::literal_layout(lowering.file, literal);
                layouts::own_fields(lowering.file, layout);
                let has_promise = positions::has_int32_promise(lowering.file);
                for property in properties.iter() {
                    if has_promise {
                        convert_int32_member(lowering, literal, property);
                    }
                    pending.push(hir[property].value);
                }
            }
            None => {}
        }
    }
}

fn visit(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    frames: &mut Vec<Frame>,
    finished: &mut Vec<DataNode>,
) {
    let hir = file.hir;
    let mut part = expression;
    loop {
        if let Some(node) = create_folded_node(file, part) {
            finished.push(node);
            return;
        }
        match hir.type_assertion_operand(part) {
            Some(operand) => part = operand,
            None => break,
        }
    }
    match find_composite(hir, part) {
        Some(composite) => frames.push(Frame {
            composite,
            next_child: 0,
            first_node: finished.len(),
        }),
        None => {
            debug_assert!(false, "every part of a data literal is constant data");
            finished.push(DataNode::Undefined);
        }
    }
}

fn create_folded_node(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<DataNode> {
    let decisions = file.decisions();
    match decisions.decision(expression) {
        Decision::Constant(constant) => return Some(create_leaf(file, constant)),
        Decision::Data(value) => return Some(create_value_node(file, value)),
        Decision::DeferredData | Decision::GlobalPath(_) => {
            debug_assert!(
                false,
                "every part of a data literal has its value at build time"
            );
            return Some(DataNode::Undefined);
        }
        Decision::Unknown => {}
    }
    match decisions.constant(file.hir, expression) {
        FoldedValue::Constant(constant) => Some(create_leaf(file, constant)),
        FoldedValue::ConstantOutsideDeadZone(constant) => {
            debug_assert!(false, "no part of a data literal checks a dead zone");
            Some(create_leaf(file, constant))
        }
        FoldedValue::Unknown => None,
    }
}

fn find_composite(hir: &File<'_>, expression: ExprId) -> Option<Composite> {
    match hir[expression].kind {
        ExprKind::Array(items) => Some(Composite::Array {
            literal: expression,
            items,
        }),
        ExprKind::Object(properties) => Some(Composite::Object {
            literal: expression,
            properties,
        }),
        _ => None,
    }
}

fn finish_array(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
    elements: Vec<DataNode>,
) -> DataNode {
    DataNode::Array {
        contents: types::array_literal_contents(file, literal),
        elements,
    }
}

fn finish_object(
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
    let layout = layouts::literal_layout(file, literal);
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

fn constant_key(file: &mut FileLowering<'_, '_, '_, '_>, property: PropId) -> PropertyKeyId {
    let folded = match file.hir.runtime_property_key(property) {
        PropKey::Name(name) => return member::name_key(file, name),
        PropKey::Computed(key) => file.decisions().constant(file.hir, key),
        PropKey::None | PropKey::Private(_) => FoldedValue::Unknown,
    };
    match folded {
        FoldedValue::Constant(constant) => to_property_key(file, constant),
        FoldedValue::ConstantOutsideDeadZone(constant) => {
            debug_assert!(false, "no key of a data literal checks a dead zone");
            to_property_key(file, constant)
        }
        FoldedValue::Unknown => {
            debug_assert!(false, "every key of a data literal is constant");
            intern_text_key(file, b"")
        }
    }
}

fn to_property_key(file: &mut FileLowering<'_, '_, '_, '_>, constant: Constant) -> PropertyKeyId {
    match constant {
        Constant::String(text) => member::name_key(file, text),
        Constant::Number(number) => intern_text_key(file, &number_to_string(number)),
        Constant::BigInt(digits) => file.atom_key(digits),
        Constant::Boolean(true) => intern_text_key(file, b"true"),
        Constant::Boolean(false) => intern_text_key(file, b"false"),
        Constant::Null => intern_text_key(file, b"null"),
        Constant::Undefined => intern_text_key(file, b"undefined"),
    }
}

fn intern_text_key(file: &mut FileLowering<'_, '_, '_, '_>, text: &[u8]) -> PropertyKeyId {
    let text = file.intern_bytes(text);
    file.text_key(text)
}

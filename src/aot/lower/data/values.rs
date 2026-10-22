#[cfg(test)]
mod tests;

use bun_sema::atom::Atom;
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::fold::Constant;
use bun_sema::hir_from_data::DataValue;
use smallvec::SmallVec;

use crate::ir::generated::{DataMember, DataNode};
use crate::ir::{PropertyKeyId, TypeTable};
use crate::lower::{FileLowering, layouts, member};

type LayoutMembers = SmallVec<[(PropertyKeyId, ObjectMemberKind); 16]>;

#[derive(Copy, Clone)]
enum Composite<'v> {
    Array(&'v [DataValue<'v>]),
    Object(&'v [(Atom, DataValue<'v>)]),
}

struct Frame<'v> {
    composite: Composite<'v>,
    next_child: usize,
    first_node: usize,
}

impl<'v> Frame<'v> {
    fn new(composite: Composite<'v>, first_node: usize) -> Frame<'v> {
        Frame {
            composite,
            next_child: 0,
            first_node,
        }
    }

    fn take_child(&mut self) -> Option<&'v DataValue<'v>> {
        let child = match self.composite {
            Composite::Array(items) => items.get(self.next_child),
            Composite::Object(entries) => entries.get(self.next_child).map(|entry| &entry.1),
        };
        self.next_child += 1;
        child
    }
}

pub(super) fn create_node(
    file: &mut FileLowering<'_, '_, '_, '_>,
    value: &DataValue<'_>,
) -> DataNode {
    let mut frames = Vec::new();
    let mut finished = Vec::new();
    visit(file, value, &mut frames, &mut finished);
    while let Some(frame) = frames.last_mut() {
        if let Some(child) = frame.take_child() {
            visit(file, child, &mut frames, &mut finished);
            continue;
        }
        let (composite, first_node) = (frame.composite, frame.first_node);
        frames.pop();
        let children = finished.split_off(first_node);
        let node = match composite {
            Composite::Array(_) => finish_array(children),
            Composite::Object(entries) => finish_object(file, entries, children),
        };
        finished.push(node);
    }
    finished.pop().expect("the walk finishes the root")
}

fn visit<'v>(
    file: &mut FileLowering<'_, '_, '_, '_>,
    value: &DataValue<'v>,
    frames: &mut Vec<Frame<'v>>,
    finished: &mut Vec<DataNode>,
) {
    let constant = match *value {
        DataValue::Undefined => Constant::Undefined,
        DataValue::Null => Constant::Null,
        DataValue::Boolean(value) => Constant::Boolean(value),
        DataValue::Number(value) => Constant::Number(value),
        DataValue::String(text) => Constant::String(text),
        DataValue::BigInt(digits) => Constant::BigInt(digits),
        DataValue::Array(items) => {
            frames.push(Frame::new(Composite::Array(items), finished.len()));
            return;
        }
        DataValue::Object(entries) => {
            frames.push(Frame::new(Composite::Object(entries), finished.len()));
            return;
        }
    };
    finished.push(create_leaf(file, constant));
}

pub(super) fn create_leaf(
    file: &mut FileLowering<'_, '_, '_, '_>,
    constant: Constant,
) -> DataNode {
    match constant {
        Constant::Undefined => DataNode::Undefined,
        Constant::Null => DataNode::Null,
        Constant::Boolean(value) => DataNode::Boolean { value },
        Constant::Number(value) => DataNode::Number { value },
        Constant::String(text) => DataNode::String {
            value: file.intern_atom(text),
        },
        Constant::BigInt(digits) => DataNode::BigInt {
            digits: file.intern_atom(digits),
        },
    }
}

fn finish_array(elements: Vec<DataNode>) -> DataNode {
    DataNode::Array {
        contents: TypeTable::ANYTHING,
        elements,
    }
}

fn finish_object(
    file: &mut FileLowering<'_, '_, '_, '_>,
    entries: &[(Atom, DataValue<'_>)],
    values: Vec<DataNode>,
) -> DataNode {
    debug_assert_eq!(entries.len(), values.len(), "each entry has one finished node");
    let layout_members: LayoutMembers = entries
        .iter()
        .map(|&(name, _)| (member::name_key(file, name), ObjectMemberKind::Field))
        .collect();
    let layout = layouts::untyped_layout(file, &layout_members);
    let members = layout_members
        .into_iter()
        .zip(values)
        .map(|((key, _), value)| DataMember { key, value })
        .collect();
    DataNode::Object { layout, members }
}

pub(super) fn create_deferred_node(file: &mut FileLowering<'_, '_, '_, '_>) -> DataNode {
    match file.inputs.deferred_data.get(file.file) {
        Some(value) => create_node(file, value),
        None => {
            debug_assert!(false, "module binding has the manifest of every page");
            DataNode::Undefined
        }
    }
}

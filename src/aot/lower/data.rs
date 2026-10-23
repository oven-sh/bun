mod literals;
mod values;

use bun_sema::atom::known;
use bun_sema::bind::BindingInitializer;
use bun_sema::fold::Decision;
use bun_sema::hir::ExprId;
use rustc_hash::FxHashMap;

use super::{FileLowering, FunctionLowering};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{Data, DataNode, LimitId};
use crate::ir::{DataId, ValueId};
use crate::modules::ExportBinding;

#[derive(Default)]
pub(crate) struct DataState {
    records: FxHashMap<ExprId, DataId>,
}

pub(crate) fn lower_decided_data(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let data = match lowering.file.modules.data.records.get(&expression).copied() {
        Some(data) => data,
        None => {
            let root = create_root(lowering, expression);
            literals::convert_int32_members(lowering, expression);
            add_record(lowering.file, expression, root)
        }
    };
    lowering.builder.data(data)
}

pub(in crate::lower) fn declare_module_data(
    file: &mut FileLowering<'_, '_, '_, '_>,
) -> Option<DataId> {
    let expression = find_default_export_initializer(file)?;
    let root = match file.decisions().decision(expression) {
        Decision::Data(value) => values::create_node(file, value),
        Decision::DeferredData => values::create_deferred_node(file),
        Decision::Unknown | Decision::Constant(_) | Decision::GlobalPath(_) => return None,
    };
    Some(add_record(file, expression, root))
}

fn find_default_export_initializer(file: &FileLowering<'_, '_, '_, '_>) -> Option<ExprId> {
    let exports = file.inputs.modules.exports(file.file);
    let default_export = exports
        .iter()
        .find(|export| export.name == known::default)?;
    let ExportBinding::Variable(symbol) = default_export.binding else {
        return None;
    };
    if symbol.file != file.file {
        return None;
    }
    match file.bound.binding_initializer(file.hir, symbol.id) {
        BindingInitializer::Expression(expression) => Some(expression),
        _ => None,
    }
}

fn create_root(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> DataNode {
    match lowering.file.decisions().decision(expression) {
        Decision::Data(value) => values::create_node(lowering.file, value),
        Decision::DeferredData => values::create_deferred_node(lowering.file),
        Decision::Unknown | Decision::Constant(_) | Decision::GlobalPath(_) => {
            debug_assert!(
                lowering.file.decisions().is_data_literal(expression),
                "an expression without a data decision is a data literal"
            );
            literals::create_node(lowering, expression)
        }
    }
}

fn nesting_depth(root: &DataNode) -> u64 {
    let mut deepest = 0;
    let mut pending = vec![(root, 1)];
    while let Some((node, depth)) = pending.pop() {
        match node {
            DataNode::Array { elements, .. } => {
                deepest = deepest.max(depth);
                pending.extend(elements.iter().map(|element| (element, depth + 1)));
            }
            DataNode::Object { members, .. } => {
                deepest = deepest.max(depth);
                pending.extend(members.iter().map(|member| (&member.value, depth + 1)));
            }
            DataNode::Undefined
            | DataNode::Null
            | DataNode::Hole
            | DataNode::Boolean { .. }
            | DataNode::Number { .. }
            | DataNode::String { .. }
            | DataNode::BigInt { .. } => {}
        }
    }
    deepest
}

fn enforce_nesting_limit(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    root: DataNode,
) -> DataNode {
    let maximum = file.inputs.limits.get(LimitId::MaxNestingDepth);
    if nesting_depth(&root) <= maximum {
        return root;
    }
    let position = file.hir[expression].pos;
    file.gave_up(LimitId::MaxNestingDepth, position);
    let span = file.span_at(position);
    let depth = maximum.to_string();
    file.diagnostics
        .report(Code::NestedTooDeeply, span, &[depth.as_bytes()]);
    DataNode::Undefined
}

fn add_record(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    root: DataNode,
) -> DataId {
    let root = enforce_nesting_limit(file, expression, root);
    let module = Some(file.module_id());
    let data = file.fragment.add_data(Data { root, module });
    file.modules.data.records.insert(expression, data);
    data
}

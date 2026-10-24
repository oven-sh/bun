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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_decided_data(&mut self, expression: ExprId) -> ValueId {
        let data = match self.file.modules.data.records.get(&expression).copied() {
            Some(data) => data,
            None => {
                let root = self.create_root(expression);
                self.convert_int32_members(expression);
                add_record(self.file, expression, root)
            }
        };
        self.builder.data(data)
    }

    fn create_root(&mut self, expression: ExprId) -> DataNode {
        match self.file.decisions().decision(expression) {
            Decision::Data(value) => values::create_node(self.file, value),
            Decision::DeferredData => self.file.create_deferred_node(),
            Decision::Unknown | Decision::Constant(_) | Decision::GlobalPath(_) => {
                debug_assert!(
                    self.file.decisions().is_data_literal(expression),
                    "an expression without a data decision is a data literal"
                );
                literals::create_node(self, expression)
            }
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn declare_module_data(&mut self) -> Option<DataId> {
        let expression = self.find_default_export_initializer()?;
        let root = match self.decisions().decision(expression) {
            Decision::Data(value) => values::create_node(self, value),
            Decision::DeferredData => self.create_deferred_node(),
            Decision::Unknown | Decision::Constant(_) | Decision::GlobalPath(_) => return None,
        };
        Some(add_record(self, expression, root))
    }

    fn find_default_export_initializer(&self) -> Option<ExprId> {
        let exports = self.inputs.modules.exports(self.file);
        let default_export = exports
            .iter()
            .find(|export| export.name == known::default)?;
        let ExportBinding::Variable(symbol) = default_export.binding else {
            return None;
        };
        if symbol.file != self.file {
            return None;
        }
        match self.bound.binding_initializer(self.hir, symbol.id) {
            BindingInitializer::Expression(expression) => Some(expression),
            _ => None,
        }
    }

    fn enforce_nesting_limit(&mut self, expression: ExprId, root: DataNode) -> DataNode {
        let maximum = self.inputs.limits.get(LimitId::MaxNestingDepth);
        if nesting_depth(&root) <= maximum {
            return root;
        }
        let position = self.hir[expression].pos;
        self.gave_up(LimitId::MaxNestingDepth, position);
        let span = self.span_at(position);
        let depth = maximum.to_string();
        self.diagnostics
            .report(Code::NestedTooDeeply, span, &[depth.as_bytes()]);
        DataNode::Undefined
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

fn add_record(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    root: DataNode,
) -> DataId {
    let root = file.enforce_nesting_limit(expression, root);
    let module = Some(file.module_id());
    let data = file.fragment.add_data(Data { root, module });
    file.modules.data.records.insert(expression, data);
    data
}

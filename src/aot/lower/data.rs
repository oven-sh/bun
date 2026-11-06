mod values;

use bun_sema::atom::known;
use bun_sema::bind::BindingInitializer;
use bun_sema::fold::Decision;
use bun_sema::hir::ExprId;
use rustc_hash::FxHashMap;
use smallvec::smallvec;

use self::values::Part;
use super::call::Arguments;
use super::{FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
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
        if let Some(&data) = self.file.modules.data.records.get(&expression) {
            return self.builder.data(data);
        }
        let root = match self.file.decisions().decision(expression) {
            Decision::Data(value) => values::create_node(self.file, Part::Value(value)),
            Decision::DeferredData => match self.file.create_deferred_node() {
                Some(node) => node,
                None => return self.emit_refusal_of_unbundled_page(),
            },
            Decision::Unknown | Decision::Constant(_) | Decision::GlobalPath(_) => {
                debug_assert!(
                    self.file.decisions().is_data_literal(expression),
                    "an expression without a data decision is a data literal"
                );
                values::create_node(self.file, Part::Expression(expression))
            }
        };
        self.convert_int32_members(expression);
        let data = add_record(self.file, expression, root);
        self.builder.data(data)
    }

    // No `import` or `require()` names the page, so the build did not bundle it. A load of a computed path can still reach it.
    fn emit_refusal_of_unbundled_page(&mut self) -> ValueId {
        let mut pages = self.file.inputs.sources.pages().iter();
        let page = pages.find(|page| page.0 == self.file.file);
        let name = page.map_or(&b""[..], |page| bun_paths::basename(&page.1));
        let reason = b"': the page isn't bundled into this executable, because no import or require() names it";
        let message = self.emit_text(&[b"Cannot load '", name, reason].concat());
        let constructor = self.emit_builtin_itself(BuiltinId::Error);
        let error = self.emit_construct(constructor, Arguments::Values(smallvec![message]), None);
        self.emit_throw(error);
        self.builder.undefined()
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn declare_module_data(&mut self) -> Option<DataId> {
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
        let BindingInitializer::Expression(expression) =
            self.bound.binding_initializer(self.hir, symbol.id)
        else {
            return None;
        };
        let root = match self.decisions().decision(expression) {
            Decision::Data(value) => values::create_node(self, Part::Value(value)),
            Decision::DeferredData => self.create_deferred_node()?,
            Decision::Unknown | Decision::Constant(_) | Decision::GlobalPath(_) => return None,
        };
        Some(add_record(self, expression, root))
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
    mut root: DataNode,
) -> DataId {
    let maximum = file.inputs.limits.get(LimitId::MaxDataNestingDepth);
    if nesting_depth(&root) > maximum {
        let position = file.hir[expression].pos;
        file.queries.answer_nothing_from_now_on();
        file.gave_up(LimitId::MaxDataNestingDepth, position);
        let span = file.span_at(position);
        let depth = maximum.to_string();
        file.diagnostics
            .report(Code::NestedTooDeeply, span, &[depth.as_bytes()]);
        root = DataNode::Undefined;
    }
    let module = Some(file.module_id());
    let data = file.fragment.add_data(Data { root, module });
    file.modules.data.records.insert(expression, data);
    data
}

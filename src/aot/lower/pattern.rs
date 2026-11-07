mod array;
mod object;
mod view;

use bun_sema::check::aot::{PositionTypes, WrittenType};
use bun_sema::hir::{ExprId, PatId};

use self::view::NodeShape;
use super::FunctionLowering;
use super::expression::AssignmentTarget;
use super::member::{KeyConversion, Reference};
use crate::ir::ValueId;

#[derive(Copy, Clone, Debug)]
pub(super) enum PatternNode {
    Binding(PatId),
    Assignment(ExprId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum DefaultHolder {
    Parameter,
    ObjectPattern,
    ArrayPattern,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn bind_pattern(&mut self, pattern: PatId, value: ValueId, source: Option<ExprId>) {
        self.destructure(PatternNode::Binding(pattern), value, source);
    }

    pub(crate) fn assign_pattern(
        &mut self,
        target: ExprId,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        self.destructure(PatternNode::Assignment(target), value, source);
    }

    fn destructure(&mut self, node: PatternNode, value: ValueId, source: Option<ExprId>) {
        match self.file.node_shape(node) {
            NodeShape::Hole => {}
            NodeShape::Leaf => {
                let position = self.file.node_position(node);
                self.set_position(position);
                match node {
                    PatternNode::Binding(pattern) => {
                        self.initialize_pattern_name(pattern, value, source);
                    }
                    PatternNode::Assignment(target) => {
                        let reference = self.lower_reference(target, KeyConversion::AtAccess);
                        self.set_position(position);
                        self.put_reference(&reference, value, source);
                    }
                }
            }
            NodeShape::Object => {
                let module = source.and_then(|source| self.file.find_destructured_module(source));
                if let Some(module) = module {
                    if self.enter_pattern(node) {
                        self.destructure_exports(node, module);
                        self.leave_nesting();
                    }
                } else if self.enter_pattern(node) {
                    self.destructure_object(node, value);
                    self.leave_nesting();
                }
            }
            NodeShape::Array => {
                if self.enter_pattern(node) {
                    array::destructure_array(self, node, value);
                    self.leave_nesting();
                }
            }
        }
    }

    fn enter_pattern(&mut self, node: PatternNode) -> bool {
        let position = self.file.node_position(node);
        self.set_position(position);
        self.enter_nesting(position)
    }

    fn prepare_target(&mut self, target: PatternNode) -> Option<Reference> {
        let PatternNode::Assignment(expression) = target else {
            return None;
        };
        match self.file.classify_assignment_target(expression) {
            AssignmentTarget::Expression => {
                Some(self.lower_reference(expression, KeyConversion::AtAccess))
            }
            _ => None,
        }
    }

    fn finish_target(&mut self, target: PatternNode, prepared: Option<Reference>, value: ValueId) {
        match prepared {
            Some(reference) => {
                let position = self.file.node_position(target);
                self.set_position(position);
                self.put_reference(&reference, value, None);
            }
            None => self.destructure(target, value, None),
        }
    }
}

fn apply_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    default: ExprId,
    target: PatternNode,
    holder: DefaultHolder,
) -> ValueId {
    apply_default_with(
        lowering,
        value,
        default,
        target,
        holder,
        &mut |lowering, value| {
            let PatternNode::Binding(pattern) = target else {
                return value;
            };
            if !lowering.file.has_annotated_root(target) {
                return value;
            }
            let types = PositionTypes {
                written: WrittenType::Unwritten,
                checked: lowering.file.queries.binding_type(pattern),
            };
            let position = lowering.file.create_position(types);
            lowering.convert_initializer(value, position, Some(default))
        },
    )
}

pub(super) fn apply_default_with(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    default: ExprId,
    target: PatternNode,
    holder: DefaultHolder,
    convert: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, ValueId) -> ValueId,
) -> ValueId {
    if default.is_none() {
        return value;
    }
    let result = lowering.builder.create_variable(None);
    let use_default = lowering.create_block();
    let join = lowering.create_block();
    let present = lowering.branch_if_undefined(value, use_default);
    lowering.builder.write_variable(result, present);
    lowering.jump(join);
    lowering.continue_in(use_default);
    let name = match lowering.file.node_shape(target) {
        NodeShape::Leaf => lowering.file.default_function_name(target, default, holder),
        NodeShape::Object | NodeShape::Array | NodeShape::Hole => None,
    };
    let default_value = match name {
        Some((binding, name, _)) => {
            let name = lowering.file.name_given_by_binding(binding, name);
            lowering.lower_named_evaluation(default, name)
        }
        None => lowering.lower_expression(default),
    };
    let default_value = convert(lowering, default_value);
    lowering.builder.write_variable(result, default_value);
    lowering.jump(join);
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

#[cfg(test)]
mod tests {
    use bun_core::strings::index_of;

    use crate::compile::testing::lower_program;
    use crate::ir::Opcode;
    use crate::load::host_platform;
    use crate::lower::{Fragment, LoweringOptions};

    #[track_caller]
    fn lower(source: &str) -> Fragment {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_text: false,
            removable: Default::default(),
            minifies_identifiers: false,
            obfuscates: false,
            counts_executions: false,
            runs_tests: false,
        };
        let mut lowered = lower_program(&[("main.ts", source)], options);
        assert_eq!(lowered.len(), 1);
        lowered.remove(0).1.fragment
    }

    #[track_caller]
    fn offset_of(source: &str, text: &str) -> u32 {
        let offset = index_of(source.as_bytes(), text.as_bytes());
        offset.expect("the source has the text") as u32
    }

    #[test]
    fn member_behind_a_default_is_stored_to_at_its_own_position() {
        let source = "export function probe(holder: any, list: any, make: any) {
  [holder.first = {
    made: make(),
  }] = list;
  ({ key: holder.second = {
    made: make(),
  } } = list);
}
";
        let fragment = lower(source);
        let functions = fragment.functions.iter();
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        let stores = values.filter(|value| value.opcode == Opcode::PropSet);
        let reported: Vec<u32> = stores.filter_map(|value| value.position).collect();
        let expected = ["holder.first", "holder.second"].map(|text| offset_of(source, text));
        assert_eq!(reported, expected);
    }
}

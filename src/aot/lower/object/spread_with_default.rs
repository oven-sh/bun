use bun_sema::hir::{BinOp, ExprId};

use super::ObjectBuilder;
use super::literal::Dictionary;
use crate::ir::TypeTable;
use crate::lower::FunctionLowering;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    /// `{ a, ...(given ?? { b }) }`, `{ a, ...(given || { b }) }`: where the left side decides, its value is spread.
    /// Where it does not, the members of the literal are defined one by one, and no object is made for them.
    pub(super) fn lower_spread_with_default(
        &mut self,
        object: &mut ObjectBuilder,
        dictionary: Option<Dictionary>,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        position: u32,
    ) {
        self.finish_head(object);
        let given = self.lower_expression(left);
        self.set_position(position);
        let (edge_of_given, value_given, edge_of_default) = match op {
            BinOp::Or => {
                let split = self.split_on_truthiness(given);
                (split.taken, split.taken_value, split.not_taken)
            }
            BinOp::Nullish => {
                let split = self.split_on_type(given, TypeTable::NULLISH);
                (split.not_taken, split.not_taken_value, split.taken)
            }
            _ => unreachable!("lower_spread hands over `||` and `??` alone"),
        };

        let spreads_given = self.create_block();
        let defines_default = self.create_block();
        let join = self.create_block();
        self.builder.switch_to(edge_of_given);
        self.jump(spreads_given);
        self.builder.switch_to(edge_of_default);
        self.jump(defines_default);

        self.continue_in(spreads_given);
        self.add_spread(object, value_given);
        self.define_waiting_elements(object);
        self.jump(join);

        self.continue_in(defines_default);
        self.lower_spread(object, dictionary, right, position);
        self.define_waiting_elements(object);
        self.jump(join);

        self.continue_in(join);
    }
}

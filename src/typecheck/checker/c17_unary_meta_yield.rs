// checker.go:10707-11130 (layer E-AWAIT): the functions of 10935-10943: the await expression.
use crate::ast::NodeId;
use crate::checker::{Checker, TypeFlags, TypeId};
use crate::diagnostics;

impl<'a> Checker<'a> {
    pub fn check_await_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_grammar_await_or_await_using(node);
        let operand_type = self.check_expression(a.expression(node));
        let awaited_type = self.check_awaited_type(
            operand_type,
            true,
            node,
            diagnostics::TYPE_OF_AWAIT_OPERAND_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER,
        );
        if awaited_type == operand_type
            && !self.is_error_type(awaited_type)
            && !self.types[operand_type]
                .flags
                .intersects(TypeFlags::ANY_OR_UNKNOWN)
        {
            let diagnostic = self.create_diagnostic_for_node(
                node,
                diagnostics::X_AWAIT_HAS_NO_EFFECT_ON_THE_TYPE_OF_THIS_EXPRESSION,
                &[],
            );
            self.add_error_or_suggestion(false, diagnostic);
        }
        awaited_type
    }
}

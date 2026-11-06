use bun_sema::bind::Parent;
use bun_sema::hir::{BinOp, ExprId, ExprKind, UnOp};
use smallvec::{SmallVec, smallvec};

use crate::ir::generated::LimitId;
use crate::lower::FunctionLowering;

// An operand of `+`, as Bun's transpiler prints it and JSC's parser reads it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum PrintedOperand {
    Text,
    OtherLiteral,
    Template,
    // `typeof x`, or a sum with a string among its operands.
    KnownString,
    Other,
}

impl PrintedOperand {
    fn is_string(self) -> bool {
        matches!(self, PrintedOperand::Text | PrintedOperand::KnownString)
    }

    // What the transpiler prints in place of `self + next`, if that is one literal or one template.
    // It makes a string of a literal on the left only where that is the whole left operand.
    fn join(
        self,
        next: PrintedOperand,
        is_whole_left_operand: bool,
        is_written: bool,
    ) -> Option<PrintedOperand> {
        use PrintedOperand::{OtherLiteral, Template, Text};
        match (self, next) {
            _ if is_written => None,
            (Text, Text | OtherLiteral) => Some(Text),
            (Text, Template) | (Template, Text | OtherLiteral | Template) => Some(Template),
            (OtherLiteral, Text | OtherLiteral | Template) if is_whole_left_operand => Some(next),
            _ => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum SumOperator {
    Separate,
    // The transpiler joins the right operand with the one in front of it.
    Joined,
    // JSC evaluates `a + "b" + c` as one concatenation. It converts each operand right behind the operand's evaluation, and records no position for that.
    Concatenated,
}

pub(super) type SumOperators = SmallVec<[SumOperator; 8]>;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn classify_printed_operand(&mut self, operand: ExprId, depth: u32) -> PrintedOperand {
        let hir = self.file.hir;
        let printed = self.file.skip_unprinted_syntax(operand);
        match hir[printed].kind {
            // A sum in more parentheses than code can be nested counts as an operand nothing is known about.
            ExprKind::Binary { op: BinOp::Add, .. }
                if u64::from(depth) >= self.file.inputs.limits.get(LimitId::MaxNestingDepth)
                    || self.file.queries.is_stack_low() =>
            {
                return PrintedOperand::Other;
            }
            ExprKind::Binary { op: BinOp::Add, .. } => {
                return self.classify_printed_sum(printed, depth + 1);
            }
            ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            } if !self.file.is_literal_operand(operand) => return PrintedOperand::KnownString,
            _ => {}
        }
        if self.file.is_literal_operand(printed) {
            return match self.file.is_string_literal_operand(printed) {
                true => PrintedOperand::Text,
                false => PrintedOperand::OtherLiteral,
            };
        }
        match hir[printed].kind {
            ExprKind::Template { .. } => PrintedOperand::Template,
            _ => PrintedOperand::Other,
        }
    }

    fn classify_printed_sum(&mut self, sum: ExprId, depth: u32) -> PrintedOperand {
        if let Some(&kind) = self.printed_sums.get(&sum) {
            return kind;
        }
        let hir = self.file.hir;
        let mut operands: SmallVec<[ExprId; 8]> = SmallVec::new();
        let mut first = sum;
        while let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = hir[first].kind
        {
            operands.push(right);
            first = self.file.skip_unprinted_syntax(left);
        }
        let mut last = self.classify_printed_operand(first, depth);
        let mut is_whole = true;
        let mut has_string_in_front = false;
        for &operand in operands.iter().rev() {
            let next = self.classify_printed_operand(operand, depth);
            match last.join(next, is_whole, self.file.runs_as_written()) {
                Some(joined) => last = joined,
                None => {
                    has_string_in_front |= last.is_string();
                    last = next;
                    is_whole = false;
                }
            }
        }
        let kind = match is_whole {
            true => last,
            false if has_string_in_front || last.is_string() => PrintedOperand::KnownString,
            false => PrintedOperand::Other,
        };
        self.printed_sums.insert(sum, kind);
        kind
    }

    // `x += a + "b"` is one concatenation too.
    fn is_added_to_target(&self, expression: ExprId) -> bool {
        let hir = self.file.hir;
        let mut value = expression;
        while let Parent::Expr(parent) = self.file.bound.parent_of_expr(value) {
            match hir[parent].kind {
                ExprKind::Assign {
                    op: Some(BinOp::Add),
                    value: added,
                    ..
                } => return added == value,
                _ if hir.type_assertion_operand(parent).is_some() => value = parent,
                _ => return false,
            }
        }
        false
    }

    // What becomes of the operators of a spine, which starts with the outermost one. `None`: they all stay separate.
    pub(super) fn plan_sums(
        &mut self,
        expression: ExprId,
        spine: &[(BinOp, ExprId)],
        innermost: ExprId,
    ) -> Option<SumOperators> {
        let is_sum = |&(op, _): &(BinOp, ExprId)| op == BinOp::Add;
        let is_added_to_target = is_sum(&spine[0]) && self.is_added_to_target(expression);
        let has_two_sums_in_a_row = spine
            .iter()
            .zip(spine.iter().skip(1))
            .any(|(outer, inner)| is_sum(outer) && is_sum(inner));
        if !is_added_to_target && !has_two_sums_in_a_row {
            return None;
        }
        let mut operators: SumOperators = smallvec![SumOperator::Separate; spine.len()];
        // The operators that the transpiler prints, from the innermost one, with whether the parser knows the result to be a string.
        let mut printed: SmallVec<[(usize, bool); 8]> = SmallVec::new();
        let mut has_concatenation = false;
        let mut end = spine.len();
        while end > 0 {
            let start = spine[..end].iter().rposition(|operator| !is_sum(operator));
            let start = start.map_or(0, |index| index + 1);
            if start == end {
                end -= 1;
                continue;
            }
            let mut last = match end == spine.len() {
                true => self.classify_printed_operand(innermost, 0),
                false => PrintedOperand::Other,
            };
            let mut is_whole = true;
            let mut is_string = false;
            printed.clear();
            for index in (start..end).rev() {
                let next = self.classify_printed_operand(spine[index].1, 0);
                match last.join(next, is_whole, self.file.runs_as_written()) {
                    Some(joined) => {
                        operators[index] = SumOperator::Joined;
                        last = joined;
                    }
                    None => {
                        is_string |= last.is_string();
                        if let Some(operator) = printed.last_mut() {
                            operator.1 = is_string;
                        }
                        printed.push((index, false));
                        last = next;
                        is_whole = false;
                    }
                }
            }
            if let Some(operator) = printed.last_mut() {
                operator.1 = is_string || last.is_string();
            }
            let mut is_taken = start == 0 && is_added_to_target;
            for place in (0..printed.len()).rev() {
                let (index, is_string) = printed[place];
                let has_string_sum_on_the_left = place > 0 && printed[place - 1].1;
                is_taken = (is_taken && is_string) || has_string_sum_on_the_left;
                if is_taken {
                    operators[index] = SumOperator::Concatenated;
                    has_concatenation = true;
                }
            }
            end = start;
        }
        has_concatenation.then_some(operators)
    }
}

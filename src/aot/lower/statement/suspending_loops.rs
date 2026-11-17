use bun_sema::hir::{BinOp, ExprId, ExprKind, IdList, NodeData, StmtId, StmtKind, UnOp, VarKind};
use bun_sema::node::Node;

use crate::ir::BlockId;
use crate::ir::generated::FunctionFlags;
use crate::lower::FunctionLowering;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum SuspendingPart {
    Arm,
    Rest,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct SuspendingArm {
    pub(in crate::lower) part: SuspendingPart,
    pub(in crate::lower) statement: StmtId,
    pub(in crate::lower) loop_statement: StmtId,
    pub(in crate::lower) resumed: BlockId,
    pub(in crate::lower) late_continue: Option<LateContinue>,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct LateContinue {
    pub(in crate::lower) test: ExprId,
    pub(in crate::lower) block: BlockId,
}

#[derive(Copy, Clone, Default, Debug)]
struct Contents {
    suspends: bool,
    creates_function: bool,
    can_be_repeated: bool,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn find_contents(&self, node: Node) -> Contents {
        let hir = self.file.hir;
        let mut contents = Contents {
            can_be_repeated: true,
            ..Contents::default()
        };
        let mut open = vec![node];
        while let Some(node) = open.pop() {
            match hir.data(node) {
                NodeData::Expr(expression) => match hir[expression].kind {
                    ExprKind::Await(_) | ExprKind::Yield { .. } => contents.suspends = true,
                    ExprKind::Fn(_) | ExprKind::Class(_) => {
                        contents.creates_function = true;
                        continue;
                    }
                    ExprKind::Call(_)
                    | ExprKind::New(_)
                    | ExprKind::TaggedTemplate(_)
                    | ExprKind::ImportCall { .. }
                    | ExprKind::Regex { .. }
                    | ExprKind::Array(_)
                    | ExprKind::Object(_)
                    | ExprKind::Jsx(_) => contents.can_be_repeated = false,
                    _ => {}
                },
                NodeData::Stmt(statement) => match hir[statement].kind {
                    StmtKind::ForOf { is_await: true, .. } => contents.suspends = true,
                    StmtKind::Fn(_) | StmtKind::Class(_) => {
                        contents.creates_function = true;
                        continue;
                    }
                    StmtKind::Var(declarations) => {
                        contents.suspends |= declarations
                            .iter()
                            .any(|declaration| hir[declaration].kind == VarKind::AwaitUsing);
                        contents.can_be_repeated = false;
                    }
                    StmtKind::Empty
                    | StmtKind::Expr(_)
                    | StmtKind::If { .. }
                    | StmtKind::Block(_)
                    | StmtKind::Break(_)
                    | StmtKind::Continue(_)
                    | StmtKind::Return(_)
                    | StmtKind::Throw(_) => {}
                    _ => contents.can_be_repeated = false,
                },
                _ => {}
            }
            hir.for_each_child(node, &mut |child| {
                open.push(child);
                false
            });
        }
        contents.can_be_repeated &= !contents.suspends && !contents.creates_function;
        contents
    }

    fn always_leaves(&self, statement: StmtId) -> bool {
        let hir = self.file.hir;
        match hir[statement].kind {
            StmtKind::Return(_) | StmtKind::Throw(_) | StmtKind::Break(_) => true,
            StmtKind::Block(statements) => {
                let last = hir.ids(statements).last();
                last.is_some_and(|last| self.always_leaves(last))
            }
            _ => false,
        }
    }

    pub(in crate::lower) fn find_suspending_arm(
        &self,
        repeated: [ExprId; 2],
        body: StmtId,
    ) -> Option<StmtId> {
        if !self
            .builder
            .function()
            .flags
            .contains(FunctionFlags::IS_ASYNC)
        {
            return None;
        }
        let hir = self.file.hir;
        let statements = match hir[body].kind {
            StmtKind::Block(statements) => hir.ids(statements).collect(),
            StmtKind::If { .. } => vec![body],
            _ => return None,
        };
        let mut found = None;
        for statement in statements {
            let contents = self.find_contents(hir.node(statement));
            if contents.creates_function {
                return None;
            }
            if found.is_some() {
                if !contents.can_be_repeated {
                    return None;
                }
            } else if contents.suspends {
                let StmtKind::If { test, yes, no } = hir[statement].kind else {
                    return None;
                };
                let decisions = self.file.decisions();
                let other_suspends = no.is_some() && self.find_contents(hir.node(no)).suspends;
                let is_dead =
                    decisions.is_dead_stmt(yes) || (no.is_some() && decisions.is_dead_stmt(no));
                if other_suspends
                    || is_dead
                    || self.find_contents(hir.node(test)).suspends
                    || self.always_leaves(yes)
                {
                    return None;
                }
                found = Some(statement);
            }
        }
        let is_repeatable = |expression: ExprId| {
            expression.is_none() || self.find_contents(hir.node(expression)).can_be_repeated
        };
        found.filter(|_| repeated.into_iter().all(is_repeatable))
    }

    fn continues_loop(&self, loop_statement: StmtId, statement: StmtId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let mut open = vec![(hir.node(statement), false)];
        while let Some((node, is_in_inner_loop)) = open.pop() {
            let mut is_in_inner_loop = is_in_inner_loop;
            match hir.data(node) {
                NodeData::Expr(_) => continue,
                NodeData::Stmt(statement) => match hir[statement].kind {
                    StmtKind::Continue(_) => {
                        let Some(mut target) = bound.jump_target(statement) else {
                            match is_in_inner_loop {
                                true => continue,
                                false => return true,
                            }
                        };
                        while let StmtKind::Labeled { body, .. } = hir[target].kind {
                            target = body;
                        }
                        if target == loop_statement {
                            return true;
                        }
                    }
                    StmtKind::Fn(_) | StmtKind::Class(_) => continue,
                    StmtKind::For { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. }
                    | StmtKind::While { .. }
                    | StmtKind::DoWhile { .. } => is_in_inner_loop = true,
                    _ => {}
                },
                _ => {}
            }
            hir.for_each_child(node, &mut |child| {
                open.push((child, is_in_inner_loop));
                false
            });
        }
        false
    }

    pub(in crate::lower) fn find_suspending_rest(
        &self,
        loop_statement: StmtId,
        test: ExprId,
        repeated: [ExprId; 2],
        body: StmtId,
    ) -> Option<StmtId> {
        let suspends = FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR;
        let hir = self.file.hir;
        let StmtKind::Block(statements) = hir[body].kind else {
            return None;
        };
        if !self.builder.function().flags.intersects(suspends) {
            return None;
        }
        let mut some_iteration_continues = false;
        for statement in hir.ids(statements) {
            if self.find_contents(hir.node(statement)).suspends {
                let test_suspends = test.is_some() && self.find_contents(hir.node(test)).suspends;
                let is_repeatable = |expression: ExprId| {
                    expression.is_none() || self.find_contents(hir.node(expression)).can_be_repeated
                };
                return (some_iteration_continues
                    && !test_suspends
                    && repeated.into_iter().all(is_repeatable))
                .then_some(statement);
            }
            some_iteration_continues |= self.continues_loop(loop_statement, statement);
        }
        None
    }

    pub(super) fn enter_suspending_rest(&mut self, statement: StmtId) {
        if let Some(arm) = self.suspending_arm
            && arm.part == SuspendingPart::Rest
            && arm.statement == statement
        {
            self.set_continue_target(arm.loop_statement, arm.resumed);
        }
    }

    pub(in crate::lower) fn reads_only_variables(&self, expression: ExprId) -> bool {
        let hir = self.file.hir;
        match hir[expression].kind {
            ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_) => true,
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                operand,
            }
            | ExprKind::NonNull(operand)
            | ExprKind::AsConst(operand)
            | ExprKind::As { expr: operand, .. }
            | ExprKind::Satisfies { expr: operand, .. } => self.reads_only_variables(operand),
            ExprKind::Binary { op, left, right } => {
                !matches!(op, BinOp::In | BinOp::Instanceof)
                    && self.reads_only_variables(left)
                    && self.reads_only_variables(right)
            }
            _ => false,
        }
    }

    pub(super) fn begin_late_continue(&mut self, test: ExprId, yes: StmtId) {
        let hir = self.file.hir;
        let continues = match hir[yes].kind {
            StmtKind::Continue(_) => true,
            StmtKind::Block(statements) => {
                statements.len == 1
                    && matches!(hir[hir.id_at(statements, 0)].kind, StmtKind::Continue(_))
            }
            _ => false,
        };
        if !continues
            || !self
                .suspending_arm
                .is_some_and(|arm| arm.part == SuspendingPart::Rest)
            || !matches!(hir[test].kind, ExprKind::Binary { op: BinOp::Or, .. })
            || self.file.is_statically_resolved(test)
        {
            return;
        }
        let operands = self.file.collect_logical_operands(test, BinOp::Or);
        if !self.reads_only_variables(operands[0])
            || operands
                .iter()
                .all(|&operand| self.reads_only_variables(operand))
        {
            return;
        }
        let block = self.create_block();
        if let Some(arm) = &mut self.suspending_arm {
            arm.late_continue = Some(LateContinue { test, block });
        }
    }

    pub(super) fn end_late_continue(&mut self, test: ExprId, yes: StmtId) {
        let Some(arm) = self.suspending_arm else {
            return;
        };
        let Some(late) = arm.late_continue.filter(|late| late.test == test) else {
            return;
        };
        self.continue_in(late.block);
        let target = self.set_continue_target(arm.loop_statement, arm.resumed);
        self.lower_statement(yes);
        if let Some(target) = target {
            self.set_continue_target(arm.loop_statement, target);
        }
        if let Some(arm) = &mut self.suspending_arm {
            arm.late_continue = None;
        }
    }

    pub(super) fn lower_suspending_arm(
        &mut self,
        arm: SuspendingArm,
        (test, yes, no): (ExprId, StmtId, StmtId),
        behind: IdList<StmtId>,
    ) {
        let suspending = self.create_block();
        let other = self.create_block();
        self.lower_condition(test, suspending, other);
        self.continue_in(suspending);
        let cleans_up = self.cleans_up_before_next_iteration(arm.loop_statement);
        let target = self.set_continue_target(arm.loop_statement, arm.resumed);
        self.lower_statement(yes);
        self.lower_statements(behind);
        self.emit_continue(arm.loop_statement);
        if !cleans_up && let Some(target) = target {
            self.set_continue_target(arm.loop_statement, target);
        }

        self.continue_in(other);
        if no.is_some() {
            self.lower_statement(no);
        }
    }
}

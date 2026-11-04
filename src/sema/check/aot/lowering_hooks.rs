//! What lowering needs from the checker besides its answers: a slot for state it keeps across files, a dense number per
//! type, and both types of an expression in one call. Nothing here runs unless lowering calls it.

use super::answers::{ExpressionTypes, GaveUp};
use super::kept_answers::RowsCarriedOver;
use super::queries::Queries;
use crate::check::Checker;
use crate::hir::ExprId;
use crate::table::Id;
use crate::types::TypeId;
use core::any::Any;

impl Checker<'_, '_> {
    /// State that lowering keeps across the files this checker visits. It leaves this place when the task ends.
    /// `with_queries` borrows the checker, so take the state out before that call and put it back after.
    pub fn state_of_lowering(&mut self) -> &mut Option<Box<dyn Any + Send>> {
        &mut self.aot_answers.of_lowering
    }

    /// Where a task ends, `hand_on` is given what `state_of_lowering` holds. What it returns is for the next task of the thread.
    /// Whatever goes by an address of the checker's means nothing there, so it is freed here, and so is what goes by
    /// `Queries::row_of_type`, but for the rows that are carried over, which have new numbers.
    pub fn hand_state_of_lowering_on_with(
        &mut self,
        hand_on: fn(
            Box<dyn Any + Send>,
            Option<&RowsCarriedOver<'_>>,
        ) -> Option<Box<dyn Any + Send>>,
    ) {
        self.aot_answers.hand_on_of_lowering = Some(hand_on);
    }

    /// What was handed on by an earlier task of this thread, the last that left something in `state_of_lowering`.
    pub fn state_of_lowering_in_last_task(&mut self) -> &mut Option<Box<dyn Any + Send>> {
        &mut self.aot_answers.of_lowering_in_last_task
    }
}

impl Queries<'_, '_, '_> {
    /// 0, 1, 2.. in the order types are first asked about. A type keeps its number across every file the checker's task
    /// visits. Numbers change exactly when `Checker::state_of_lowering` is emptied.
    #[inline]
    pub fn is_known_to_every_task(&self, ty: TypeId) -> bool {
        ty.local_number().is_none()
    }

    pub fn row_of_type(&mut self, ty: TypeId) -> u32 {
        self.kept.type_row(ty).number()
    }

    /// The type that checking the file cached for the expression. Opens no question. It equals `type_of_expr` only
    /// between questions, when the checker has no check mode, recheck or contextual binding pattern in progress.
    #[inline]
    pub(super) fn type_left_by_check(&mut self, expression: ExprId) -> Option<TypeId> {
        let left = self.c.cached_type_of_expr(self.file, expression);
        debug_assert!(left.is_none() || left == Some(self.c.type_of_expr(self.file, expression)));
        left
    }

    /// The answers of `expression_type` and `predicted_expression_type` in one call. Inference from uses runs only
    /// where it can add something: the checked type is `any`, or it is `number` and the expression names a variable or
    /// parameter without a type annotation.
    pub fn expression_types(&mut self, expression: ExprId) -> Result<ExpressionTypes, GaveUp> {
        let checked = self.expression_type(expression)?;
        let predicted = match self.find_subject_of_expression(expression, checked) {
            Some(_) => {
                self.ask(|queries| Ok(queries.infer_expression_type(expression, checked)))?
            }
            None => checked,
        };
        Ok(ExpressionTypes { checked, predicted })
    }
}

/// `KeptAnswers::take` creates a mimalloc arena, which is foreign code that Miri can't run.
#[cfg(all(test, not(miri)))]
mod tests {
    use crate::check::aot::KeptAnswers;
    use crate::types::TypeId;

    #[test]
    fn rows_and_state_outlast_a_file_and_end_together() {
        let mut answers = KeptAnswers::default();
        answers.of_lowering = Some(Box::new(7u32));
        answers.hand_on_of_lowering = Some(|state, _| Some(state));

        let (mut memo, arena) = answers.take();
        assert!(answers.of_lowering.is_some());
        assert_eq!(memo.type_row(TypeId::NUMBER).number(), 0);
        assert_eq!(memo.type_row(TypeId::STRING).number(), 1);
        assert_eq!(memo.type_row(TypeId::NUMBER).number(), 0);
        answers.put_back(memo, arena);

        let (mut memo, arena) = answers.take();
        assert_eq!(memo.type_row(TypeId::STRING).number(), 1);
        assert_eq!(memo.type_row(TypeId::ANY).number(), 2);
        answers.put_back(memo, arena);
        let state = answers.of_lowering.as_ref();
        assert_eq!(
            state.and_then(|state| state.downcast_ref::<u32>()),
            Some(&7)
        );

        answers.clear();
        assert!(answers.of_lowering.is_none());
        let (mut memo, _arena) = answers.take();
        assert_eq!(memo.type_row(TypeId::STRING).number(), 0);

        // A task that leaves nothing takes nothing away.
        answers.clear();
        let state = answers.of_lowering_in_last_task.as_ref();
        assert_eq!(
            state.and_then(|state| state.downcast_ref::<u32>()),
            Some(&7)
        );
    }

    #[test]
    fn rows_that_a_second_file_asked_for_go_on_to_the_next_task() {
        let mut answers = KeptAnswers::default();
        answers.hand_on_of_lowering = Some(|_, carried| {
            let carried = carried.expect("the memo outlives the task");
            let new_rows: Vec<Option<u32>> = (0..4).map(|row| carried.new_row(row)).collect();
            let holds = [TypeId::NUMBER, TypeId::STRING, TypeId::ANY].map(|ty| carried.holds(ty));
            Some(Box::new((new_rows, holds, carried.count())))
        });

        let (mut memo, arena) = answers.take();
        memo.type_row(TypeId::NUMBER);
        memo.type_row(TypeId::STRING);
        memo.type_row(TypeId::NUMBER);
        answers.put_back(memo, arena);
        let (mut memo, arena) = answers.take();
        memo.type_row(TypeId::STRING);
        memo.type_row(TypeId::ANY);
        answers.put_back(memo, arena);

        answers.of_lowering = Some(Box::new(7u32));
        answers.outlives_task = true;
        answers.end_task();
        assert!(!answers.outlives_task && answers.of_lowering.is_none());
        let state = answers.of_lowering_in_last_task.take().expect("handed on");
        let state = state.downcast::<(Vec<Option<u32>>, [bool; 3], usize)>();
        let expected = (vec![None, Some(0), None, None], [false, true, false], 1);
        assert_eq!(state.ok(), Some(Box::new(expected)));

        // It stays for as long as tasks end well, asked for or not.
        let (mut memo, arena) = answers.take();
        assert_eq!(memo.type_row(TypeId::ANY).number(), 1);
        answers.put_back(memo, arena);
        answers.of_lowering = Some(Box::new(7u32));
        answers.outlives_task = true;
        answers.end_task();
        let (mut memo, arena) = answers.take();
        assert_eq!(memo.type_row(TypeId::STRING).number(), 0);
        assert_eq!(memo.type_row(TypeId::ANY).number(), 1);
        answers.put_back(memo, arena);

        answers.end_task();
        let (mut memo, _arena) = answers.take();
        assert_eq!(memo.type_row(TypeId::ANY).number(), 0);
    }
}

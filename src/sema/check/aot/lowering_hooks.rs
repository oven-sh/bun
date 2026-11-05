use super::kept_answers::RowsCarriedOver;
use super::queries::Queries;
use crate::check::Checker;
use crate::hir::ExprId;
use crate::table::Id;
use crate::types::TypeId;
use core::any::Any;

impl Checker<'_, '_> {
    pub fn state_of_lowering(&mut self) -> &mut Option<Box<dyn Any + Send>> {
        &mut self.aot_answers.of_lowering
    }

    pub fn hand_state_of_lowering_on_with(
        &mut self,
        hand_on: fn(
            Box<dyn Any + Send>,
            Option<&RowsCarriedOver<'_>>,
        ) -> Option<Box<dyn Any + Send>>,
    ) {
        self.aot_answers.hand_on_of_lowering = Some(hand_on);
    }

    pub fn state_of_lowering_in_last_task(&mut self) -> &mut Option<Box<dyn Any + Send>> {
        &mut self.aot_answers.of_lowering_in_last_task
    }
}

impl Queries<'_, '_, '_> {
    #[inline]
    pub fn is_known_to_every_task(&self, ty: TypeId) -> bool {
        ty.local_number().is_none()
    }

    #[inline]
    pub fn row_of_type(&mut self, ty: TypeId) -> u32 {
        self.kept.type_row(ty).number()
    }

    #[inline]
    pub(super) fn type_left_by_check(&mut self, expression: ExprId) -> Option<TypeId> {
        let left = self.c.cached_type_of_expr(self.file, expression);
        debug_assert!(left.is_none() || left == Some(self.c.type_of_expr(self.file, expression)));
        left
    }
}

#[cfg(all(test, not(miri)))]
mod tests {
    use crate::atom::Atom;
    use crate::check::aot::{
        KeptAnswers, ListedMember, MemberName, ObjectMemberKind, PositionTypes,
    };
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

        answers.clear();
        let state = answers.of_lowering_in_last_task.as_ref();
        assert_eq!(
            state.and_then(|state| state.downcast_ref::<u32>()),
            Some(&7)
        );
    }

    #[test]
    fn a_task_that_lowers_nothing_and_is_cleared_takes_the_rows_from_the_state_it_found() {
        let mut answers = KeptAnswers::default();
        answers.hand_on_of_lowering = Some(|_, carried| Some(Box::new(carried.is_some())));
        let has_rows = |answers: &KeptAnswers| {
            let state = answers.of_lowering_in_last_task.as_ref();
            state
                .and_then(|state| state.downcast_ref::<bool>())
                .copied()
        };

        answers.of_lowering = Some(Box::new(7u32));
        answers.outlives_task = true;
        answers.end_task();
        assert_eq!(has_rows(&answers), Some(true));

        let (mut memo, arena) = answers.take();
        memo.type_row(TypeId::STRING);
        answers.put_back(memo, arena);
        answers.end_task();
        let (mut memo, _arena) = answers.take();
        assert_eq!(memo.type_row(TypeId::ANY).number(), 0);
        assert_eq!(has_rows(&answers), Some(false));
    }

    #[test]
    fn rows_that_a_second_file_asked_for_go_on_to_the_next_task() {
        let mut answers = KeptAnswers::default();
        answers.hand_on_of_lowering = Some(|_, carried| {
            let carried = carried?;
            let new_rows: Vec<Option<u32>> = (0..4).map(|row| carried.new_row(row)).collect();
            Some(Box::new((new_rows, carried.count())))
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
        let state = state.downcast::<(Vec<Option<u32>>, usize)>();
        let expected = (vec![None, Some(0), None, None], 1);
        assert_eq!(state.ok(), Some(Box::new(expected)));

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
        assert!(answers.of_lowering_in_last_task.is_none());
    }

    #[test]
    fn types_kept_for_a_member_are_not_found_for_another_name_under_its_number() {
        let member = |name: u32| ListedMember {
            name: MemberName::String(Atom(name)),
            kind: ObjectMemberKind::Field,
            is_optional: false,
            property_index: 0,
        };
        let (mut memo, _arena) = KeptAnswers::default().take();
        let row = memo.object_row(TypeId::ANY);
        memo.make_room_for_member_types(row, 1);
        let types = PositionTypes::unwritten(Ok(TypeId::STRING));
        memo.keep_member_types(row, member(1), types);
        assert_eq!(memo.find_member_types(row, member(1)), Some(types));
        assert_eq!(memo.find_member_types(row, member(2)), None);
    }
}

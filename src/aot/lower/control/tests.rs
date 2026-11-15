use bun_sema::hir::StmtId;
use smallvec::SmallVec;

use super::{BreakTargetKind, Cleanup, ControlEntry, ControlState, ReturnRule, get_return_rule};
use crate::ir::generated::{BlockRole, FunctionFlags, FunctionKind};
use crate::ir::testing::function_with_parameters;
use crate::ir::{BlockId, BuilderScratch, FunctionBuilder, Handler, Id};

fn create_stack(entries: Vec<ControlEntry>) -> ControlState {
    ControlState { entries }
}

fn break_target(statement: u32, kind: BreakTargetKind) -> ControlEntry {
    ControlEntry::BreakTarget {
        statement: StmtId(statement),
        kind,
        block: BlockId::new(0),
    }
}

fn continue_target(statement: u32) -> ControlEntry {
    ControlEntry::ContinueTarget {
        statement: StmtId(statement),
        block: BlockId::new(0),
    }
}

fn create_handler() -> Handler {
    let function = function_with_parameters(FunctionFlags::default(), &[]);
    let mut builder = FunctionBuilder::new(function, BuilderScratch::default());
    builder.create_handler(BlockRole::CatchHandler, None, None)
}

fn handler() -> ControlEntry {
    ControlEntry::Handler {
        handler: create_handler(),
        outer: None,
    }
}

fn cleanup() -> ControlEntry {
    ControlEntry::Cleanup(Cleanup {
        handler: create_handler(),
        outer: None,
        exits: SmallVec::new(),
    })
}

#[test]
fn unlabeled_break_skips_labels() {
    let mut stack = create_stack(vec![
        break_target(1, BreakTargetKind::Label),
        break_target(2, BreakTargetKind::Loop),
        break_target(3, BreakTargetKind::Switch),
        cleanup(),
        break_target(4, BreakTargetKind::Label),
    ]);
    assert_eq!(stack.innermost_break_statement(), Some(StmtId(3)));
    stack.entries.truncate(2);
    assert_eq!(stack.innermost_break_statement(), Some(StmtId(2)));
    stack.entries.truncate(1);
    assert_eq!(stack.innermost_break_statement(), None);
}

#[test]
fn unlabeled_continue_skips_switches() {
    let stack = create_stack(vec![
        continue_target(1),
        handler(),
        break_target(2, BreakTargetKind::Switch),
    ]);
    assert_eq!(stack.innermost_continue_statement(), Some(StmtId(1)));
}

#[test]
fn empty_stack_handlers_and_cleanups_have_no_target() {
    for stack in [
        ControlState::default(),
        create_stack(vec![handler(), cleanup()]),
    ] {
        assert_eq!(stack.innermost_break_statement(), None);
        assert_eq!(stack.innermost_continue_statement(), None);
    }
}

#[test]
fn innermost_target_wins() {
    let stack = create_stack(vec![
        break_target(1, BreakTargetKind::Loop),
        continue_target(1),
        break_target(2, BreakTargetKind::Loop),
        continue_target(2),
    ]);
    assert_eq!(stack.innermost_break_statement(), Some(StmtId(2)));
    assert_eq!(stack.innermost_continue_statement(), Some(StmtId(2)));
}

#[test]
fn only_constructors_compute_their_result() {
    for kind in FunctionKind::ALL {
        let is_constructor = matches!(
            kind,
            FunctionKind::BaseConstructor | FunctionKind::DerivedConstructor
        );
        let computes_result = matches!(get_return_rule(kind), ReturnRule::ConstructorResult);
        assert_eq!(computes_result, is_constructor, "{kind:?}");
    }
}

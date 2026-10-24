mod cleanup;
mod exits;
#[cfg(test)]
mod tests;

use bun_sema::hir::{ExprId, StmtId, StmtKind};
use smallvec::SmallVec;

use super::{FunctionLowering, class, convert, generator};
use crate::ir::generated::{BlockRole, ECMAMode, FunctionFlags, FunctionKind, TailCast};
use crate::ir::{BlockId, DeclaredType, Handler, PositionFlags, ValueId};

#[derive(Default)]
pub(crate) struct ControlState {
    entries: Vec<ControlEntry>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum BreakTargetKind {
    Loop,
    Switch,
    Label,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum CleanupLanding {
    KeepsException,
    TakesValue,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum CleanupPath {
    Normal,
    Rethrow,
    Throw { thrown: ValueId },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Exit {
    FallThrough,
    Break(StmtId),
    Continue(StmtId),
    Return,
}

enum ControlEntry {
    BreakTarget {
        statement: StmtId,
        kind: BreakTargetKind,
        block: BlockId,
    },
    ContinueTarget {
        statement: StmtId,
        block: BlockId,
    },
    Handler {
        handler: Handler,
        outer: Option<Handler>,
    },
    Cleanup(Cleanup),
}

struct Cleanup {
    handler: Handler,
    outer: Option<Handler>,
    exits: SmallVec<[CleanupExit; 2]>,
}

#[derive(Copy, Clone)]
struct CleanupExit {
    exit: Exit,
    block: BlockId,
    returned: Option<ValueId>,
}

#[derive(Copy, Clone)]
enum ReturnRule {
    DeclaredResult,
    ConstructorResult,
}

impl ControlState {
    fn innermost_break_statement(&self) -> Option<StmtId> {
        self.entries.iter().rev().find_map(|entry| match entry {
            ControlEntry::BreakTarget {
                statement, kind, ..
            } => match kind {
                BreakTargetKind::Loop | BreakTargetKind::Switch => Some(*statement),
                BreakTargetKind::Label => None,
            },
            _ => None,
        })
    }

    fn innermost_continue_statement(&self) -> Option<StmtId> {
        self.entries.iter().rev().find_map(|entry| match entry {
            ControlEntry::ContinueTarget { statement, .. } => Some(*statement),
            _ => None,
        })
    }
}

fn get_return_rule(kind: FunctionKind) -> ReturnRule {
    match kind {
        FunctionKind::BaseConstructor | FunctionKind::DerivedConstructor => {
            ReturnRule::ConstructorResult
        }
        _ => ReturnRule::DeclaredResult,
    }
}

pub(crate) fn emit_return(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    source: Option<ExprId>,
) {
    let returned = lowering.returned;
    let value = match get_return_rule(lowering.builder.function().kind) {
        ReturnRule::DeclaredResult => {
            let subject = convert::Int32Subject::Result;
            convert::describe_int32_flow(lowering, returned, subject, source);
            let is_async = lowering
                .builder
                .function()
                .flags
                .contains(FunctionFlags::IS_ASYNC);
            let source = match is_async {
                true => source.and_then(|source| {
                    generator::find_awaited_source(lowering.file, source, returned)
                }),
                false => source,
            };
            convert::convert(lowering, value, returned, source)
        }
        ReturnRule::ConstructorResult => value,
    };
    exits::emit_exit(lowering, Exit::Return, Some(value));
}

// For a value that no expression of the program returns. Nothing proves that it is an `int32`.
fn convert_to_result(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> ValueId {
    match get_return_rule(lowering.builder.function().kind) {
        ReturnRule::DeclaredResult => {
            let returned = lowering.returned;
            let flags = returned.flags.without(PositionFlags::IS_INT32_PROMISE);
            convert::convert(lowering, value, DeclaredType { flags, ..returned }, None)
        }
        ReturnRule::ConstructorResult => value,
    }
}

// The checker lets a function whose result has no `undefined` end only where it finds the end unreachable.
pub(crate) fn emit_empty_return(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    let undefined = lowering.builder.undefined();
    let value = convert_to_result(lowering, undefined);
    exits::emit_exit(lowering, Exit::Return, Some(value));
}

fn emit_function_return(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, value: ValueId) {
    match get_return_rule(lowering.builder.function().kind) {
        ReturnRule::DeclaredResult => {
            lowering.builder.return_value(Some(value));
            lowering.begin_unreachable_block();
        }
        ReturnRule::ConstructorResult => {
            let covering = lowering.handler();
            if covering.is_some() {
                lowering.leave_handler(None);
            }
            let result = class::emit_constructor_result(lowering, value);
            lowering.builder.return_value(Some(result));
            match covering {
                Some(handler) => {
                    lowering.enter_handler(handler);
                }
                None => lowering.begin_unreachable_block(),
            }
        }
    }
}

pub(crate) fn allows_tail_call(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> bool {
    let function = lowering.builder.function();
    let has_ordinary_return = matches!(
        function.kind,
        FunctionKind::Plain
            | FunctionKind::Arrow
            | FunctionKind::Method
            | FunctionKind::Getter
            | FunctionKind::Setter
    );
    let suspends = FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR;
    has_ordinary_return
        && !function.flags.intersects(suspends)
        && lowering.mode() == ECMAMode::Strict
        && lowering.handler().is_none()
        && !is_in_for_in_body(lowering)
}

// JSC makes no tail call from the body of a for-in statement.
fn is_in_for_in_body(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> bool {
    let hir = lowering.file.hir;
    lowering.control.entries.iter().any(|entry| match entry {
        ControlEntry::ContinueTarget { statement, .. } => {
            matches!(hir[*statement].kind, StmtKind::ForIn { .. })
        }
        _ => false,
    })
}

pub(crate) fn emit_return_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ValueId,
    casts: &[DeclaredType],
) {
    debug_assert!(
        allows_tail_call(lowering),
        "the caller checks allows_tail_call first"
    );
    let untyped = DeclaredType::untyped();
    let positions = casts.iter().copied().chain([lowering.returned]);
    let casts: SmallVec<[TailCast; 2]> = positions
        .filter(|&declared| declared != untyped)
        .map(|declared| TailCast { declared })
        .collect();
    lowering.builder.return_call(call, &casts);
    lowering.begin_unreachable_block();
}

pub(in crate::lower) fn lower_break(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let labeled = lowering.file.bound.jump_target(statement);
    let target = labeled.or_else(|| lowering.control.innermost_break_statement());
    emit_jump_exit(lowering, target.map(Exit::Break));
}

pub(in crate::lower) fn lower_continue(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let target = match lowering.file.bound.jump_target(statement) {
        Some(labeled) => Some(find_labeled_loop(lowering, labeled)),
        None => lowering.control.innermost_continue_statement(),
    };
    emit_jump_exit(lowering, target.map(Exit::Continue));
}

fn find_labeled_loop(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, labeled: StmtId) -> StmtId {
    let hir = lowering.file.hir;
    let mut statement = labeled;
    while let StmtKind::Labeled { body, .. } = hir[statement].kind {
        statement = body;
    }
    statement
}

fn emit_jump_exit(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, exit: Option<Exit>) {
    match exit {
        Some(exit) => exits::emit_exit(lowering, exit, None),
        None => {
            lowering.builder.unreachable();
            lowering.begin_unreachable_block();
        }
    }
}

pub(crate) fn push_break_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    kind: BreakTargetKind,
    block: BlockId,
) {
    lowering.control.entries.push(ControlEntry::BreakTarget {
        statement,
        kind,
        block,
    });
}

pub(crate) fn push_continue_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    block: BlockId,
) {
    let entry = ControlEntry::ContinueTarget { statement, block };
    lowering.control.entries.push(entry);
}

pub(crate) fn pop_jump_target(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    let entry = lowering.control.entries.pop();
    debug_assert!(matches!(
        entry,
        Some(ControlEntry::BreakTarget { .. } | ControlEntry::ContinueTarget { .. })
    ));
}

pub(crate) fn begin_handler(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    role: BlockRole,
    subject: Option<ValueId>,
) -> Handler {
    let handler = lowering.create_handler(role, subject);
    let outer = lowering.enter_handler(handler);
    let entry = ControlEntry::Handler { handler, outer };
    lowering.control.entries.push(entry);
    handler
}

pub(crate) fn end_handler(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, handler: Handler) {
    let Some(ControlEntry::Handler {
        handler: top,
        outer,
    }) = lowering.control.entries.pop()
    else {
        unreachable!("the top entry of the control stack is a handler");
    };
    debug_assert_eq!(top, handler, "handlers end innermost first");
    lowering.leave_handler(outer);
}

pub(crate) fn begin_cleanup(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    role: BlockRole,
    subject: Option<ValueId>,
) {
    let handler = lowering.create_handler(role, subject);
    let outer = lowering.enter_handler(handler);
    lowering
        .control
        .entries
        .push(ControlEntry::Cleanup(Cleanup {
            handler,
            outer,
            exits: SmallVec::new(),
        }));
}

pub(crate) fn end_cleanup_per_exit(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    landing: CleanupLanding,
    emit: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, CleanupPath),
) {
    cleanup::end_per_exit(lowering, landing, emit);
}

pub(in crate::lower) fn end_cleanup_shared(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
) {
    cleanup::end_shared(lowering, body);
}

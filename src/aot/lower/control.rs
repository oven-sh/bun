mod cleanup;
#[cfg(test)]
mod tests;

use bun_sema::hir::{ExprId, StmtId, StmtKind};
use smallvec::SmallVec;

use super::{FunctionLowering, convert};
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn emit_return(&mut self, value: ValueId, source: Option<ExprId>) {
        let returned = self.returned;
        let value = match get_return_rule(self.builder.function().kind) {
            ReturnRule::DeclaredResult => {
                self.describe_int32_flow(returned, convert::Int32Subject::Result, source);
                let function = self.builder.function();
                let source = match function.flags.contains(FunctionFlags::IS_ASYNC) {
                    true => {
                        source.and_then(|source| self.file.find_awaited_source(source, returned))
                    }
                    false => source,
                };
                convert::convert(self, value, returned, source)
            }
            ReturnRule::ConstructorResult => value,
        };
        self.emit_exit(Exit::Return, Some(value));
    }

    // For a value that no expression of the program returns. Nothing proves that it is an `int32`.
    fn convert_to_result(&mut self, value: ValueId) -> ValueId {
        match get_return_rule(self.builder.function().kind) {
            ReturnRule::DeclaredResult => {
                let returned = self.returned;
                let flags = returned.flags.without(PositionFlags::IS_INT32_PROMISE);
                convert::convert(self, value, DeclaredType { flags, ..returned }, None)
            }
            ReturnRule::ConstructorResult => value,
        }
    }

    // The checker lets a function whose result has no `undefined` end only where it finds the end unreachable.
    pub(crate) fn emit_empty_return(&mut self) {
        let undefined = self.builder.undefined();
        let value = self.convert_to_result(undefined);
        self.emit_exit(Exit::Return, Some(value));
    }

    fn emit_function_return(&mut self, value: ValueId) {
        match get_return_rule(self.builder.function().kind) {
            ReturnRule::DeclaredResult => {
                self.builder.return_value(Some(value));
                self.begin_unreachable_block();
            }
            ReturnRule::ConstructorResult => {
                let covering = self.handler();
                if covering.is_some() {
                    self.leave_handler(None);
                }
                let result = self.emit_constructor_result(value);
                self.builder.return_value(Some(result));
                match covering {
                    Some(handler) => {
                        self.enter_handler(handler);
                    }
                    None => self.begin_unreachable_block(),
                }
            }
        }
    }

    // JSC makes no tail call from the body of a for-in statement.
    fn is_in_for_in_body(&self) -> bool {
        let hir = self.file.hir;
        self.control.entries.iter().any(|entry| match entry {
            ControlEntry::ContinueTarget { statement, .. } => {
                matches!(hir[*statement].kind, StmtKind::ForIn { .. })
            }
            _ => false,
        })
    }

    pub(crate) fn emit_return_call(&mut self, call: ValueId, casts: &[DeclaredType]) {
        debug_assert!(
            allows_tail_call(self),
            "the caller checks allows_tail_call first"
        );
        let untyped = DeclaredType::untyped();
        let positions = casts.iter().copied().chain([self.returned]);
        let casts: SmallVec<[TailCast; 2]> = positions
            .filter(|&declared| declared != untyped)
            .map(|declared| TailCast { declared })
            .collect();
        self.builder.return_call(call, &casts);
        self.begin_unreachable_block();
    }

    pub(in crate::lower) fn lower_break(&mut self, statement: StmtId) {
        let labeled = self.file.bound.jump_target(statement);
        let target = labeled.or_else(|| self.control.innermost_break_statement());
        self.emit_jump_exit(target.map(Exit::Break));
    }

    pub(in crate::lower) fn lower_continue(&mut self, statement: StmtId) {
        let Some(mut target) = self.file.bound.jump_target(statement) else {
            let target = self.control.innermost_continue_statement();
            return self.emit_jump_exit(target.map(Exit::Continue));
        };
        while let StmtKind::Labeled { body, .. } = self.file.hir[target].kind {
            target = body;
        }
        self.emit_jump_exit(Some(Exit::Continue(target)));
    }

    fn emit_jump_exit(&mut self, exit: Option<Exit>) {
        match exit {
            Some(exit) => self.emit_exit(exit, None),
            None => {
                self.builder.unreachable();
                self.begin_unreachable_block();
            }
        }
    }

    pub(crate) fn push_break_target(
        &mut self,
        statement: StmtId,
        kind: BreakTargetKind,
        block: BlockId,
    ) {
        self.control.entries.push(ControlEntry::BreakTarget {
            statement,
            kind,
            block,
        });
    }

    pub(crate) fn push_continue_target(&mut self, statement: StmtId, block: BlockId) {
        let entry = ControlEntry::ContinueTarget { statement, block };
        self.control.entries.push(entry);
    }

    pub(crate) fn pop_jump_target(&mut self) {
        let entry = self.control.entries.pop();
        debug_assert!(matches!(
            entry,
            Some(ControlEntry::BreakTarget { .. } | ControlEntry::ContinueTarget { .. })
        ));
    }

    pub(crate) fn begin_handler(&mut self, role: BlockRole, subject: Option<ValueId>) -> Handler {
        let handler = self.create_handler(role, subject);
        let outer = self.enter_handler(handler);
        let entry = ControlEntry::Handler { handler, outer };
        self.control.entries.push(entry);
        handler
    }

    pub(crate) fn end_handler(&mut self, handler: Handler) {
        let Some(ControlEntry::Handler {
            handler: top,
            outer,
        }) = self.control.entries.pop()
        else {
            unreachable!("the top entry of the control stack is a handler");
        };
        debug_assert_eq!(top, handler, "handlers end innermost first");
        self.leave_handler(outer);
    }

    pub(crate) fn begin_cleanup(&mut self, role: BlockRole, subject: Option<ValueId>) {
        let handler = self.create_handler(role, subject);
        let outer = self.enter_handler(handler);
        self.control.entries.push(ControlEntry::Cleanup(Cleanup {
            handler,
            outer,
            exits: SmallVec::new(),
        }));
    }

    fn emit_exit(&mut self, exit: Exit, returned: Option<ValueId>) {
        debug_assert_ne!(exit, Exit::FallThrough);
        debug_assert_eq!(returned.is_some(), exit == Exit::Return);
        if self.builder.is_unreachable() {
            return;
        }
        match (self.resolve_exit_block(exit), returned) {
            (Some(block), Some(value)) => self.jump_with(block, &[value]),
            (Some(block), None) => self.jump(block),
            (None, Some(value)) => return self.emit_function_return(value),
            (None, None) => self.builder.unreachable(),
        }
        self.begin_unreachable_block();
    }

    fn resolve_exit_block(&mut self, exit: Exit) -> Option<BlockId> {
        for entry in self.control.entries.iter_mut().rev() {
            match entry {
                ControlEntry::BreakTarget {
                    statement, block, ..
                } if exit == Exit::Break(*statement) => return Some(*block),
                ControlEntry::ContinueTarget { statement, block }
                    if exit == Exit::Continue(*statement) =>
                {
                    return Some(*block);
                }
                ControlEntry::Cleanup(cleanup) => {
                    if let Some(known) = cleanup.exits.iter().find(|known| known.exit == exit) {
                        return Some(known.block);
                    }
                    let block = self.builder.create_block(cleanup.outer);
                    let returned = match exit {
                        Exit::Return => Some(self.builder.add_parameter(block, None)),
                        Exit::FallThrough | Exit::Break(_) | Exit::Continue(_) => None,
                    };
                    cleanup.exits.push(CleanupExit {
                        exit,
                        block,
                        returned,
                    });
                    return Some(block);
                }
                ControlEntry::BreakTarget { .. }
                | ControlEntry::ContinueTarget { .. }
                | ControlEntry::Handler { .. } => {}
            }
        }
        None
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
        && !lowering.is_in_for_in_body()
}

use super::{Cleanup, CleanupExit, ControlEntry, Exit};
use crate::ir::{BlockId, FunctionBuilder, ValueId};
use crate::lower::FunctionLowering;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn emit_exit(&mut self, exit: Exit, returned: Option<ValueId>) {
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
                    return Some(find_or_create_exit(&mut self.builder, cleanup, exit));
                }
                ControlEntry::BreakTarget { .. }
                | ControlEntry::ContinueTarget { .. }
                | ControlEntry::Handler { .. } => {}
            }
        }
        None
    }
}

fn find_or_create_exit(
    builder: &mut FunctionBuilder,
    cleanup: &mut Cleanup,
    exit: Exit,
) -> BlockId {
    if let Some(known) = cleanup.exits.iter().find(|known| known.exit == exit) {
        return known.block;
    }
    let block = builder.create_block(cleanup.outer);
    let returned = match exit {
        Exit::Return => Some(builder.add_parameter(block, None)),
        Exit::FallThrough | Exit::Break(_) | Exit::Continue(_) => None,
    };
    cleanup.exits.push(CleanupExit {
        exit,
        block,
        returned,
    });
    block
}

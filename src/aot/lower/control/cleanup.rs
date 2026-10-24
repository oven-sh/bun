use smallvec::SmallVec;

use super::{Cleanup, CleanupExit, CleanupLanding, CleanupPath, ControlEntry, Exit};
use crate::ir::{BlockId, Edge, Handler, ValueId};
use crate::lower::FunctionLowering;

type PathBlocks = SmallVec<[BlockId; 4]>;
type EmitCleanup<'e> = &'e mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, CleanupPath);

struct SharedCleanup {
    block: BlockId,
    path_count: usize,
    selector: Option<ValueId>,
    returned: Option<ValueId>,
    thrown: ValueId,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn pop_cleanup(&mut self) -> (Cleanup, BlockId) {
        let Some(ControlEntry::Cleanup(mut cleanup)) = self.control.entries.pop() else {
            unreachable!("the top entry of the control stack is a cleanup");
        };
        if !self.builder.is_unreachable() {
            let block = self.create_block_under(cleanup.outer);
            self.jump(block);
            let fall_through = CleanupExit {
                exit: Exit::FallThrough,
                block,
                returned: None,
            };
            cleanup.exits.insert(0, fall_through);
        }
        self.leave_handler(cleanup.outer);
        let after = self.create_block();
        (cleanup, after)
    }

    fn continue_exit(&mut self, exit: CleanupExit, returned: Option<ValueId>, after: BlockId) {
        match exit.exit {
            Exit::FallThrough => self.jump(after),
            Exit::Break(_) | Exit::Continue(_) | Exit::Return => {
                self.emit_exit(exit.exit, returned);
            }
        }
    }

    pub(super) fn end_per_exit(&mut self, landing: CleanupLanding, emit: EmitCleanup<'_>) {
        let (cleanup, after) = self.pop_cleanup();
        for exit in &cleanup.exits {
            self.continue_in(exit.block);
            emit(self, CleanupPath::Normal);
            self.continue_exit(*exit, exit.returned, after);
        }
        self.emit_landing(cleanup.handler, landing, emit);
        self.continue_in(after);
    }

    fn emit_landing(&mut self, handler: Handler, landing: CleanupLanding, emit: EmitCleanup<'_>) {
        self.continue_in(handler.block());
        match landing {
            CleanupLanding::KeepsException => {
                let exception = self.builder.catch_exception();
                emit(self, CleanupPath::Rethrow);
                self.builder.rethrow(exception);
            }
            CleanupLanding::TakesValue => {
                let thrown = self.builder.catch_value();
                emit(self, CleanupPath::Throw { thrown });
                if !self.builder.is_unreachable() {
                    self.emit_throw(thrown);
                }
            }
        }
    }

    pub(super) fn end_shared(
        &mut self,
        body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
    ) {
        let (cleanup, after) = self.pop_cleanup();
        let shared = self.create_shared_cleanup(&cleanup);

        for (path, exit) in cleanup.exits.iter().enumerate() {
            self.continue_in(exit.block);
            self.enter_shared_cleanup(&shared, path, exit.returned, None);
        }
        self.continue_in(cleanup.handler.block());
        let thrown = self.builder.catch_value();
        self.enter_shared_cleanup(&shared, cleanup.exits.len(), None, Some(thrown));

        self.continue_in(shared.block);
        body(self);
        let continuations = self.emit_shared_dispatch(&shared);

        for (exit, continuation) in cleanup.exits.iter().zip(&continuations) {
            self.continue_in(*continuation);
            // The parameter of the shared block also takes the `undefined` of the paths that return nothing.
            let returned = exit.returned.and(shared.returned);
            let returned = returned.map(|returned| self.convert_to_result(returned));
            self.continue_exit(*exit, returned, after);
        }
        self.continue_in(continuations[cleanup.exits.len()]);
        self.emit_throw(shared.thrown);
        self.continue_in(after);
    }

    fn create_shared_cleanup(&mut self, cleanup: &Cleanup) -> SharedCleanup {
        let path_count = cleanup.exits.len() + 1;
        let has_return_path = cleanup.exits.iter().any(|path| path.exit == Exit::Return);
        let block = self.create_block();
        let builder = &mut self.builder;
        SharedCleanup {
            block,
            path_count,
            selector: (path_count >= 2).then(|| builder.add_parameter(block, None)),
            returned: has_return_path.then(|| builder.add_parameter(block, None)),
            thrown: builder.add_parameter(block, None),
        }
    }

    fn enter_shared_cleanup(
        &mut self,
        shared: &SharedCleanup,
        path: usize,
        returned: Option<ValueId>,
        thrown: Option<ValueId>,
    ) {
        let builder = &mut self.builder;
        let mut arguments: SmallVec<[ValueId; 3]> = SmallVec::new();
        if shared.selector.is_some() {
            arguments.push(builder.integer(path as i64));
        }
        if shared.returned.is_some() {
            arguments.push(returned.unwrap_or_else(|| builder.undefined()));
        }
        arguments.push(thrown.unwrap_or_else(|| builder.undefined()));
        self.jump_with(shared.block, &arguments);
    }

    fn emit_shared_dispatch(&mut self, shared: &SharedCleanup) -> PathBlocks {
        let mut continuations = PathBlocks::new();
        for _ in 0..shared.path_count {
            continuations.push(self.create_block());
        }
        match (shared.selector, continuations.split_last()) {
            (Some(selector), Some((landing_path, exits))) => {
                let cases: SmallVec<[i64; 4]> = (0..exits.len() as i64).collect();
                let edges: SmallVec<[Edge<'_>; 4]> =
                    exits.iter().map(|&exit| Edge::to(exit)).collect();
                let otherwise = Edge::to(*landing_path);
                self.builder.switch(selector, &cases, &edges, otherwise);
            }
            (None, Some((only_path, _))) => self.jump(*only_path),
            (_, None) => unreachable!("the landing path always exists"),
        }
        continuations
    }
}

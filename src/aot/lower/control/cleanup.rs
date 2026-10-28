use smallvec::SmallVec;

use super::{Cleanup, CleanupExit, CleanupLanding, CleanupPath, ControlEntry, Exit};
use crate::ir::{BlockId, Edge, ValueId};
use crate::lower::FunctionLowering;

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

    pub(crate) fn end_cleanup_per_exit(
        &mut self,
        landing: CleanupLanding,
        emit: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, CleanupPath),
    ) {
        let (cleanup, after) = self.pop_cleanup();
        for exit in &cleanup.exits {
            self.continue_in(exit.block);
            emit(self, CleanupPath::Normal);
            self.continue_exit(*exit, exit.returned, after);
        }
        self.continue_in(cleanup.handler.block());
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
        self.continue_in(after);
    }

    pub(in crate::lower) fn end_cleanup_shared(
        &mut self,
        body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
    ) {
        let (cleanup, after) = self.pop_cleanup();
        let exits = &cleanup.exits;
        let shared = self.create_block();
        let builder = &mut self.builder;
        let selector = (!exits.is_empty()).then(|| builder.add_parameter(shared, None));
        let has_return_path = exits.iter().any(|path| path.exit == Exit::Return);
        let shared_returned = has_return_path.then(|| builder.add_parameter(shared, None));
        let shared_thrown = builder.add_parameter(shared, None);

        let landing = (cleanup.handler.block(), None);
        let entries = exits.iter().map(|exit| (exit.block, exit.returned));
        for (path, (block, returned)) in entries.chain([landing]).enumerate() {
            self.continue_in(block);
            let builder = &mut self.builder;
            let thrown = (path == exits.len()).then(|| builder.catch_value());
            let mut arguments: SmallVec<[ValueId; 3]> = SmallVec::new();
            if selector.is_some() {
                arguments.push(builder.integer(path as i64));
            }
            if shared_returned.is_some() {
                arguments.push(returned.unwrap_or_else(|| builder.undefined()));
            }
            arguments.push(thrown.unwrap_or_else(|| builder.undefined()));
            self.jump_with(shared, &arguments);
        }

        self.continue_in(shared);
        body(self);
        let continuations: SmallVec<[BlockId; 4]> =
            (0..=exits.len()).map(|_| self.create_block()).collect();
        let Some((&landing_path, exit_paths)) = continuations.split_last() else {
            unreachable!("the landing path always exists");
        };
        match selector {
            Some(selector) => {
                let cases: SmallVec<[i64; 4]> = (0..exit_paths.len() as i64).collect();
                let edges: SmallVec<[Edge<'_>; 4]> =
                    exit_paths.iter().map(|&exit| Edge::to(exit)).collect();
                let otherwise = Edge::to(landing_path);
                self.builder.switch(selector, &cases, &edges, otherwise);
            }
            None => self.jump(landing_path),
        }

        for (exit, continuation) in exits.iter().zip(exit_paths) {
            self.continue_in(*continuation);
            // The parameter of the shared block also takes the `undefined` of the paths that return nothing.
            let returned = exit.returned.and(shared_returned);
            let returned = returned.map(|returned| self.convert_to_result(returned));
            self.continue_exit(*exit, returned, after);
        }
        self.continue_in(landing_path);
        self.emit_throw(shared_thrown);
        self.continue_in(after);
    }
}

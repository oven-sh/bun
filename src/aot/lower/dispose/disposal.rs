use smallvec::SmallVec;

use super::{AwaitState, Disposal, DisposeHint};
use crate::ir::generated::BlockRole;
use crate::ir::{Edge, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::call::{self, Arguments, CallSite};
use crate::lower::control::CleanupPath;

const HAS_AWAIT_STATE: &str = "a scope with an asynchronous resource has its await state";

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn emit_disposal(&mut self, disposal: Disposal, path: CleanupPath) {
        let resource = disposal.resource;
        self.set_position(resource.position);
        let pending = match path {
            CleanupPath::Normal => None,
            CleanupPath::Throw { thrown } => Some(thrown),
            CleanupPath::Rethrow => unreachable!("a resource scope takes the thrown value"),
        };
        let trailing = match resource.hint {
            DisposeHint::Async if disposal.is_last => disposal.awaits,
            DisposeHint::Async | DisposeHint::Sync => None,
        };
        if resource.hint == DisposeHint::Sync && disposal.follows_async_resource {
            self.emit_pending_await(disposal.awaits.expect(HAS_AWAIT_STATE));
        }

        let done = self.create_block();
        let skipped = self.create_block();
        let method = self.branch_if_undefined(resource.method, skipped);
        self.emit_dispose_call(disposal, method, pending, trailing);
        self.jump(done);

        self.continue_in(skipped);
        if resource.hint == DisposeHint::Async {
            let state = disposal.awaits.expect(HAS_AWAIT_STATE);
            let yes = self.builder.boolean(true);
            self.builder.write_variable(state.needs_await, yes);
        }
        self.jump(done);

        self.continue_in(done);
        if let Some(state) = trailing {
            self.emit_pending_await(state);
        }
    }

    fn emit_dispose_call(
        &mut self,
        disposal: Disposal,
        method: ValueId,
        pending: Option<ValueId>,
        trailing: Option<AwaitState>,
    ) {
        let catches = pending.is_some() || trailing.is_some();
        let handler = catches.then(|| self.begin_handler(BlockRole::CatchHandler, None));
        let this = Some(disposal.resource.value);
        let arguments = Arguments::Values(SmallVec::new());
        let result = call::emit_call(self, method, this, arguments, CallSite::default());
        if disposal.resource.hint == DisposeHint::Async {
            let state = disposal.awaits.expect(HAS_AWAIT_STATE);
            let yes = self.builder.boolean(true);
            self.builder.write_variable(state.has_awaited, yes);
            self.emit_await(result);
        }
        let Some(handler) = handler else {
            return;
        };
        self.end_handler(handler);
        let resume = self.create_block();
        self.jump(resume);

        self.continue_in(handler.block());
        let error = self.builder.catch_value();
        let error = match pending {
            Some(suppressed) => self.builder.new_suppressed_error(error, suppressed),
            None => error,
        };
        if let Some(state) = trailing {
            self.emit_pending_await(state);
        }
        self.emit_throw(error);
        self.continue_in(resume);
    }

    fn emit_pending_await(&mut self, state: AwaitState) {
        let check = self.create_block();
        let wait = self.create_block();
        let done = self.create_block();

        let needs_await = self.builder.read_variable(state.needs_await);
        self.builder
            .branch(needs_await, Edge::to(check), Edge::to(done));

        self.continue_in(check);
        let has_awaited = self.builder.read_variable(state.has_awaited);
        self.builder
            .branch(has_awaited, Edge::to(done), Edge::to(wait));

        self.continue_in(wait);
        let undefined = self.builder.undefined();
        self.emit_await(undefined);
        let no = self.builder.boolean(false);
        self.builder.write_variable(state.needs_await, no);
        self.jump(done);

        self.continue_in(done);
    }
}

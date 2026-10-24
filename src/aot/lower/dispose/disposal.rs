use smallvec::SmallVec;

use super::{AwaitState, Disposal, DisposeHint};
use crate::ir::generated::BlockRole;
use crate::ir::{Edge, ValueId};
use crate::lower::call::{self, Arguments, CallSite};
use crate::lower::control::{self, CleanupPath};
use crate::lower::{FunctionLowering, async_function, condition, exception};

const HAS_AWAIT_STATE: &str = "a scope with an asynchronous resource has its await state";

pub(super) fn emit_disposal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    disposal: Disposal,
    path: CleanupPath,
) {
    let resource = disposal.resource;
    lowering.set_position(resource.position);
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
        emit_pending_await(lowering, disposal.awaits.expect(HAS_AWAIT_STATE));
    }

    let done = lowering.create_block();
    let skipped = lowering.create_block();
    let method = condition::branch_if_undefined(lowering, resource.method, skipped);
    emit_dispose_call(lowering, disposal, method, pending, trailing);
    lowering.jump(done);

    lowering.continue_in(skipped);
    if resource.hint == DisposeHint::Async {
        let state = disposal.awaits.expect(HAS_AWAIT_STATE);
        let yes = lowering.builder.boolean(true);
        lowering.builder.write_variable(state.needs_await, yes);
    }
    lowering.jump(done);

    lowering.continue_in(done);
    if let Some(state) = trailing {
        emit_pending_await(lowering, state);
    }
}

fn emit_dispose_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    disposal: Disposal,
    method: ValueId,
    pending: Option<ValueId>,
    trailing: Option<AwaitState>,
) {
    let catches = pending.is_some() || trailing.is_some();
    let handler = catches.then(|| control::begin_handler(lowering, BlockRole::CatchHandler, None));
    let this = Some(disposal.resource.value);
    let arguments = Arguments::Values(SmallVec::new());
    let result = call::emit_call(lowering, method, this, arguments, CallSite::default());
    if disposal.resource.hint == DisposeHint::Async {
        let state = disposal.awaits.expect(HAS_AWAIT_STATE);
        let yes = lowering.builder.boolean(true);
        lowering.builder.write_variable(state.has_awaited, yes);
        async_function::emit_await(lowering, result);
    }
    let Some(handler) = handler else {
        return;
    };
    control::end_handler(lowering, handler);
    let resume = lowering.create_block();
    lowering.jump(resume);

    lowering.continue_in(handler.block());
    let error = lowering.builder.catch_value();
    let error = match pending {
        Some(suppressed) => lowering.builder.new_suppressed_error(error, suppressed),
        None => error,
    };
    if let Some(state) = trailing {
        emit_pending_await(lowering, state);
    }
    exception::emit_throw(lowering, error);
    lowering.continue_in(resume);
}

fn emit_pending_await(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, state: AwaitState) {
    let check = lowering.create_block();
    let wait = lowering.create_block();
    let done = lowering.create_block();

    let needs_await = lowering.builder.read_variable(state.needs_await);
    lowering
        .builder
        .branch(needs_await, Edge::to(check), Edge::to(done));

    lowering.continue_in(check);
    let has_awaited = lowering.builder.read_variable(state.has_awaited);
    lowering
        .builder
        .branch(has_awaited, Edge::to(done), Edge::to(wait));

    lowering.continue_in(wait);
    let undefined = lowering.builder.undefined();
    async_function::emit_await(lowering, undefined);
    let no = lowering.builder.boolean(false);
    lowering.builder.write_variable(state.needs_await, no);
    lowering.jump(done);

    lowering.continue_in(done);
}

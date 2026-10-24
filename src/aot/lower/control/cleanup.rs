use smallvec::SmallVec;

use super::exits::emit_exit;
use super::{
    Cleanup, CleanupExit, CleanupLanding, CleanupPath, ControlEntry, Exit, convert_to_result,
};
use crate::ir::{BlockId, Edge, Handler, ValueId};
use crate::lower::{FunctionLowering, exception};

type PathBlocks = SmallVec<[BlockId; 4]>;
type EmitCleanup<'e> = &'e mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, CleanupPath);

struct SharedCleanup {
    block: BlockId,
    path_count: usize,
    selector: Option<ValueId>,
    returned: Option<ValueId>,
    thrown: ValueId,
}

fn pop_cleanup(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> (Cleanup, BlockId) {
    let Some(ControlEntry::Cleanup(mut cleanup)) = lowering.control.entries.pop() else {
        unreachable!("the top entry of the control stack is a cleanup");
    };
    if !lowering.builder.is_unreachable() {
        let block = lowering.create_block_under(cleanup.outer);
        lowering.jump(block);
        let fall_through = CleanupExit {
            exit: Exit::FallThrough,
            block,
            returned: None,
        };
        cleanup.exits.insert(0, fall_through);
    }
    lowering.leave_handler(cleanup.outer);
    let after = lowering.create_block();
    (cleanup, after)
}

fn continue_exit(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    exit: CleanupExit,
    returned: Option<ValueId>,
    after: BlockId,
) {
    match exit.exit {
        Exit::FallThrough => lowering.jump(after),
        Exit::Break(_) | Exit::Continue(_) | Exit::Return => {
            emit_exit(lowering, exit.exit, returned);
        }
    }
}

pub(super) fn end_per_exit(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    landing: CleanupLanding,
    emit: EmitCleanup<'_>,
) {
    let (cleanup, after) = pop_cleanup(lowering);
    for exit in &cleanup.exits {
        lowering.continue_in(exit.block);
        emit(lowering, CleanupPath::Normal);
        continue_exit(lowering, *exit, exit.returned, after);
    }
    emit_landing(lowering, cleanup.handler, landing, emit);
    lowering.continue_in(after);
}

fn emit_landing(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    handler: Handler,
    landing: CleanupLanding,
    emit: EmitCleanup<'_>,
) {
    lowering.continue_in(handler.block());
    match landing {
        CleanupLanding::KeepsException => {
            let exception = lowering.builder.catch_exception();
            emit(lowering, CleanupPath::Rethrow);
            lowering.builder.rethrow(exception);
        }
        CleanupLanding::TakesValue => {
            let thrown = lowering.builder.catch_value();
            emit(lowering, CleanupPath::Throw { thrown });
            if !lowering.builder.is_unreachable() {
                exception::emit_throw(lowering, thrown);
            }
        }
    }
}

pub(super) fn end_shared(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
) {
    let (cleanup, after) = pop_cleanup(lowering);
    let shared = create_shared_cleanup(lowering, &cleanup);

    for (path, exit) in cleanup.exits.iter().enumerate() {
        lowering.continue_in(exit.block);
        enter_shared_cleanup(lowering, &shared, path, exit.returned, None);
    }
    lowering.continue_in(cleanup.handler.block());
    let thrown = lowering.builder.catch_value();
    enter_shared_cleanup(lowering, &shared, cleanup.exits.len(), None, Some(thrown));

    lowering.continue_in(shared.block);
    body(lowering);
    let continuations = emit_shared_dispatch(lowering, &shared);

    for (exit, continuation) in cleanup.exits.iter().zip(&continuations) {
        lowering.continue_in(*continuation);
        // The parameter of the shared block also takes the `undefined` of the paths that return nothing.
        let returned = exit.returned.and(shared.returned);
        let returned = returned.map(|returned| convert_to_result(lowering, returned));
        continue_exit(lowering, *exit, returned, after);
    }
    lowering.continue_in(continuations[cleanup.exits.len()]);
    exception::emit_throw(lowering, shared.thrown);
    lowering.continue_in(after);
}

fn create_shared_cleanup(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    cleanup: &Cleanup,
) -> SharedCleanup {
    let path_count = cleanup.exits.len() + 1;
    let has_return_path = cleanup.exits.iter().any(|path| path.exit == Exit::Return);
    let block = lowering.create_block();
    let builder = &mut lowering.builder;
    SharedCleanup {
        block,
        path_count,
        selector: (path_count >= 2).then(|| builder.add_parameter(block, None)),
        returned: has_return_path.then(|| builder.add_parameter(block, None)),
        thrown: builder.add_parameter(block, None),
    }
}

fn enter_shared_cleanup(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    shared: &SharedCleanup,
    path: usize,
    returned: Option<ValueId>,
    thrown: Option<ValueId>,
) {
    let builder = &mut lowering.builder;
    let mut arguments: SmallVec<[ValueId; 3]> = SmallVec::new();
    if shared.selector.is_some() {
        arguments.push(builder.integer(path as i64));
    }
    if shared.returned.is_some() {
        arguments.push(returned.unwrap_or_else(|| builder.undefined()));
    }
    arguments.push(thrown.unwrap_or_else(|| builder.undefined()));
    lowering.jump_with(shared.block, &arguments);
}

fn emit_shared_dispatch(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    shared: &SharedCleanup,
) -> PathBlocks {
    let mut continuations = PathBlocks::new();
    for _ in 0..shared.path_count {
        continuations.push(lowering.create_block());
    }
    match (shared.selector, continuations.split_last()) {
        (Some(selector), Some((landing_path, exits))) => {
            let cases: SmallVec<[i64; 4]> = (0..exits.len() as i64).collect();
            let edges: SmallVec<[Edge<'_>; 4]> = exits.iter().map(|&exit| Edge::to(exit)).collect();
            let otherwise = Edge::to(*landing_path);
            lowering.builder.switch(selector, &cases, &edges, otherwise);
        }
        (None, Some((only_path, _))) => lowering.jump(*only_path),
        (_, None) => unreachable!("the landing path always exists"),
    }
    continuations
}

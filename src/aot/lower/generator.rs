use bun_sema::hir::{self, ExprId, ExprKind, Flags, FnId};

use super::async_function::emit_await;
use super::types::find_mapped_source;
use super::yield_star::lower_yield_star;
use super::{FileLowering, FunctionLowering, control, convert, exception, expression, positions};
use crate::ir::generated::{FunctionFlags, ResumeMode, YieldResult};
use crate::ir::{DeclaredType, Edge, FunctionKey, ValueId};

#[derive(Default)]
pub(crate) struct CoroutineState {
    yielded: Option<DeclaredType>,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct Resumption {
    pub(in crate::lower) sent: ValueId,
    pub(in crate::lower) mode: ValueId,
}

pub(crate) fn coroutine_flags(hir: &hir::File<'_>, function: FnId) -> FunctionFlags {
    let source_flags = hir[function].flags;
    let mut flags = FunctionFlags::default();
    if source_flags.contains(Flags::ASYNC) {
        flags |= FunctionFlags::IS_ASYNC;
    }
    if source_flags.contains(Flags::GENERATOR) {
        flags |= FunctionFlags::IS_GENERATOR | FunctionFlags::TAKES_CALLEE;
    }
    flags
}

pub(in crate::lower) fn is_async_generator(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
) -> bool {
    let flags = lowering.builder.function().flags;
    flags.contains(FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR)
}

pub(crate) fn emit_coroutine_start(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    let flags = lowering.builder.function().flags;
    if !flags.contains(FunctionFlags::IS_GENERATOR) {
        return;
    }
    let yielded = match lowering.key {
        FunctionKey::Source(source) => {
            positions::function_positions(lowering.file, source.function).yielded
        }
        FunctionKey::ModuleBody(_)
        | FunctionKey::WrappedModuleBody(_)
        | FunctionKey::FaceBody(_)
        | FunctionKey::CheckBody(_)
        | FunctionKey::Signature(_)
        | FunctionKey::ClassSignature(_)
        | FunctionKey::ImplicitConstructor(_)
        | FunctionKey::InstanceInitializer(_)
        | FunctionKey::StaticInitializer(_)
        | FunctionKey::AccessorGetter { .. }
        | FunctionKey::AccessorSetter { .. }
        | FunctionKey::PrivateNameTest { .. } => DeclaredType::untyped(),
    };
    lowering.builder.initial_yield();
    lowering.coroutine.yielded = Some(yielded);
}

pub(crate) fn lower_yield(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let ExprKind::Yield { value, star } = lowering.file.hir[expression].kind else {
        unreachable!("lower_yield takes a Yield expression");
    };
    match star {
        true => lower_yield_star(lowering, value),
        false => lower_plain_yield(lowering, expression, value),
    }
}

pub(crate) fn prepare_return_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> ValueId {
    await_in_async_generator(lowering, value)
}

fn await_in_async_generator(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> ValueId {
    match is_async_generator(lowering) {
        true => emit_await(lowering, value),
        false => value,
    }
}

pub(in crate::lower) fn yielded_position(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
) -> DeclaredType {
    let yielded = lowering.coroutine.yielded;
    debug_assert!(yielded.is_some(), "InitialYield dominates every Yield");
    yielded.unwrap_or_else(DeclaredType::untyped)
}

pub(in crate::lower) fn emit_yield(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> Resumption {
    let builder = &mut lowering.builder;
    let results = builder.yield_value(value);
    Resumption {
        sent: builder.result_at(results, YieldResult::Sent.to_wire()),
        mode: builder.result_at(results, YieldResult::Mode.to_wire()),
    }
}

pub(in crate::lower) fn emit_resume_switch(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    mode: ValueId,
    on_throw: Edge<'_>,
    on_return: Edge<'_>,
    on_next: Edge<'_>,
) {
    let cases = [
        i64::from(ResumeMode::Throw.to_wire()),
        i64::from(ResumeMode::Return.to_wire()),
    ];
    lowering
        .builder
        .switch(mode, &cases, &[on_throw, on_return], on_next);
}

// The position takes what the operand is fulfilled with: the operand itself where its type has no promise in it.
// A promise never enters the position, so only the type of what it holds flows there.
pub(in crate::lower) fn find_awaited_source(
    file: &mut FileLowering<'_, '_, '_, '_>,
    operand: ExprId,
    position: DeclaredType,
) -> Option<ExprId> {
    let operand_type = file.queries.expression_type(operand).ok()?;
    let fulfilled = file.queries.awaited_type(operand_type).ok()?;
    if fulfilled == operand_type {
        return Some(operand);
    }
    let target = positions::find_position_source(file, position)
        .or_else(|| find_mapped_source(file, position.ty))?;
    let source_position = file.hir[operand].pos;
    convert::record_type_flow(file, fulfilled, target, source_position);
    None
}

fn lower_plain_yield(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    operand: ExprId,
) -> ValueId {
    let value = match operand.some() {
        Some(operand) => expression::lower_expression(lowering, operand),
        None => lowering.builder.undefined(),
    };
    let position = lowering.file.hir[expression].pos;
    lowering.set_position(position);
    let value = await_in_async_generator(lowering, value);
    let yielded = yielded_position(lowering);
    let source = operand.some();
    let source = match is_async_generator(lowering) {
        true => source.and_then(|operand| find_awaited_source(lowering.file, operand, yielded)),
        false => source,
    };
    let value = convert::convert(lowering, value, yielded, source);
    let resumption = emit_yield(lowering, value);

    let on_throw = lowering.create_block();
    let on_return = lowering.create_block();
    let on_next = lowering.create_block();
    emit_resume_switch(
        lowering,
        resumption.mode,
        Edge::to(on_throw),
        Edge::to(on_return),
        Edge::to(on_next),
    );

    lowering.continue_in(on_throw);
    exception::emit_throw(lowering, resumption.sent);

    lowering.continue_in(on_return);
    control::emit_return(lowering, resumption.sent, None);

    lowering.continue_in(on_next);
    resumption.sent
}

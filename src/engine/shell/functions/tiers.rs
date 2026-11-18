//! Hints to the compilers, and questions about what they have done.

use bun_engine_bytecode::Specialization;
use bun_engine_vm::{
    CodeBlock, FunctionExecutable, JsFunction, Restrictions, options, total_compile_seconds,
};

use super::{put, return_false, return_undefined};
use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("neverInlineFunction", no_inline, 1),
    ("noInline", no_inline, 1),
    ("noDFG", no_optimization, 1),
    ("noFTL", no_full_optimization, 1),
    ("noOSRExitFuzzing", return_undefined, 1),
    ("numberOfDFGCompiles", optimization_count, 1),
    ("optimizeNextInvocation", optimize_next_invocation, 1),
    ("reoptimizationRetryCount", reoptimization_count, 1),
    ("totalCompileTime", total_compile_time, 0),
    ("engineOptions", engine_options, 0),
    ("OSRExit", return_undefined, 0),
    ("isFinalTier", return_false, 0),
    ("predictInt32", return_undefined, 0),
    ("fiatInt52", identity, 0),
    ("effectful42", effectful_42, 0),
    ("resetSuperSamplerState", return_undefined, 0),
    ("disableRichSourceInfo", return_undefined, 0),
];

/// How often a test repeats JavaScript and WebAssembly code to reach the last tier.
pub(super) fn loop_counts() -> (i32, i32) {
    let options = options();
    let clamp = |count: i32, threshold: i32| {
        if options.use_concurrent_jit {
            count
        } else {
            count.min(threshold.saturating_mul(3))
        }
    };
    let script = if !options.use_jit || !options.use_baseline_jit {
        clamp(100, options.threshold_for_baseline)
    } else if !options.use_quick_optimizer {
        clamp(1000, options.threshold_for_quick_optimizer)
    } else {
        clamp(10000, options.threshold_for_full_optimizer)
    };
    let wasm = if !options.use_jit || !options.use_wasm_baseline_jit {
        100
    } else if !options.use_wasm_optimizer {
        1000
    } else {
        clamp(10000, options.threshold_for_wasm_optimizer)
    };
    (script, wasm)
}

pub(super) fn executable_of(function: Value) -> Option<Gc<FunctionExecutable>> {
    function.downcast::<JsFunction>()?.script_executable()
}

pub(super) fn code_block_of(function: Value) -> Option<Gc<CodeBlock>> {
    let executable = executable_of(function)?;
    (executable.code_block(Specialization::Call))
        .or_else(|| executable.code_block(Specialization::Construct))
}

#[native_abi]
pub(super) fn no_inline(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(executable) = executable_of(frame.argument(0)) {
        executable.restrict(Restrictions::NEVER_INLINE);
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn no_optimization(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(executable) = executable_of(frame.argument(0)) {
        executable.restrict(Restrictions::NEVER_OPTIMIZE);
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn no_full_optimization(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(executable) = executable_of(frame.argument(0)) {
        executable.restrict(Restrictions::NEVER_FULLY_OPTIMIZE);
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn optimization_count(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument_count() == 0 {
        return Ok(Value::UNDEFINED);
    }
    Ok((code_block_of(frame.argument(0)).map_or(0, |it| it.optimizations())).into())
}

#[native_abi]
fn reoptimization_count(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok((code_block_of(frame.argument(0)).map_or(0, |it| it.reoptimizations())).into())
}

#[native_abi]
fn total_compile_time(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok((total_compile_seconds() * 1e3).into())
}

#[native_abi]
fn optimize_next_invocation(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(code_block) = code_block_of(frame.argument(0)) {
        code_block.baseline().execution_counter().set(0);
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn identity(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.argument(0))
}

#[native_abi]
fn effectful_42(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(42.into())
}

#[native_abi]
fn engine_options(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let object = cx.new_object();
    for (name, value) in options().all() {
        put(cx, &object, name, value);
    }
    let state = State::of(cx);
    let line = state.command_line();
    put(
        cx,
        &object,
        "forceDiskCache",
        line.requires_disk_cache.into(),
    );
    let name = "diskCachePayloadIsPersistentForTesting";
    put(cx, &object, name, line.embeds_disk_cache.into());
    Ok(object.into())
}

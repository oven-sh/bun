//! What has run.

use bun_engine_inspector::profiling::{BlockRange, Coverage, Gaps};
use bun_engine_vm::JsFunction;

use crate::prelude::*;

pub(super) const VM_FUNCTIONS: Functions = &[
    ("hasBasicBlockExecuted", has_block_executed, 2),
    ("basicBlockExecutionCount", block_execution_count, 2),
    ("dumpBasicBlockExecutionRanges", dump_blocks, 0),
    ("dumpCodeRanges", dump_code_ranges, 0),
];

/// The smallest around the first place where the function has the text.
fn find_block(cx: &mut Cx, frame: &CallFrame) -> JsResult<BlockRange> {
    let needle = frame.argument(1).to_string_view(cx)?;
    let function = frame.argument(0).downcast::<JsFunction>();
    let block = function.and_then(|function| {
        let executable = function.script_executable()?;
        let (info, provider) = (executable.info(), executable.provider());
        let start = info.parameters_start() as usize;
        let text = provider.text().slice(0..info.range().end as usize);
        let offset = text.find(needle.text(), start)? as i32;
        let blocks = Coverage::of(cx).blocks_and_code_ranges(provider.id());
        (blocks.into_iter())
            .filter(|block| (block.start..=block.end).contains(&offset))
            .min_by_key(|block| block.end - block.start)
    });
    block.ok_or_else(|| cx.throw_type_error("No block of the function has that text"))
}

#[native_abi]
fn has_block_executed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(find_block(cx, frame)?.has_executed.into())
}

#[native_abi]
fn block_execution_count(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(find_block(cx, frame)?.execution_count.into())
}

#[native_abi]
fn dump_blocks(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let coverage = Coverage::of(cx);
    for id in coverage.source_ids() {
        eprintln!("SourceID: {id}");
        for it in coverage.counted_blocks(id, Gaps::Without) {
            let (start, end, count) = (it.start, it.end, it.execution_count);
            let has_executed = it.has_executed;
            eprintln!(
                "\tBasicBlock: [{start}, {end}] hasExecuted: {has_executed}, executionCount:{count}"
            );
        }
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn dump_code_ranges(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let coverage = Coverage::of(cx);
    for id in coverage.source_ids() {
        eprintln!("SourceID: {id}");
        for block in coverage.blocks(id, Gaps::With) {
            eprintln!("\t{block:?}");
        }
        for range in coverage.code_ranges(id) {
            eprintln!("\t{range:?}");
        }
    }
    Ok(Value::UNDEFINED)
}

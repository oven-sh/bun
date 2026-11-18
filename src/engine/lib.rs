//! Assembles the parts of the engine.

#![forbid(unsafe_code)]

use std::sync::OnceLock;

use bun_engine_inspector::profiling;
use bun_engine_vm::heap::HeapKind;
use bun_engine_vm::{CallFrame, CodeBlock, Cx, Hooks, RealmSlot, Tier, Vm, VmRef, call, options};

fn initialize_realm_slot(cx: &Cx, slot: RealmSlot) {
    let _ = bun_engine_vm::initialize_module_slot(cx, slot)
        || bun_engine_builtins::initialize_slot(cx, slot)
        || bun_engine_intl::initialize_slot(cx, slot)
        || bun_engine_temporal::initialize_slot(cx, slot)
        || bun_engine_wasm::initialize_slot(cx, slot)
        || bun_engine_ffi::initialize_slot(cx, slot);
}

fn tier_up(
    vm: &Vm,
    from: Tier,
    code_block: &CodeBlock,
    frame: &CallFrame,
    loop_offset: Option<u32>,
) -> usize {
    if from == Tier::Interpreter && options().use_baseline_jit {
        bun_engine_baseline::tier_up(vm, code_block)
    } else if code_block.is_due_for_next_tier(vm) {
        bun_engine_optimizer::tier_up(vm, code_block, frame, loop_offset)
    } else {
        0
    }
}

fn initialize() -> Hooks {
    if options().use_jit_dump {
        profiling::start_jit_dump();
    }
    Hooks {
        interpreter_entry: bun_engine_interpreter::entry(),
        adopt_machine_code: bun_engine_baseline::adopt,
        catch_address: bun_engine_baseline::catch_address,
        native_call_entry: |_, _| call::native_call_entry(),
        jettison: bun_engine_optimizer::jettison,
        cover: profiling::cover,
        tier_up,
        initialize_realm: bun_engine_builtins::initialize_realm,
        initialize_realm_slot,
        realm_watchpoint_conditions: bun_engine_builtins::watchpoint_conditions,
        did_start_having_a_bad_time: |_, _| {},
        builtin_source: bun_engine_builtins::builtin_source,
        grow_wasm_memory: bun_engine_wasm::grow_memory,
        kept_result_of_wasm_getter: bun_engine_wasm::kept_result_of_getter,
        compare_in_locale: bun_engine_intl::compare_in_locale,
        temporal_to_locale_string: bun_engine_intl::temporal_to_locale_string,
        make_wasm_module: bun_engine_wasm::make_module,
        find_wasm_handler: bun_engine_wasm::find_handler,
        wasm_frame_catches: bun_engine_wasm::frame_catches,
        wasm_callee: bun_engine_wasm::describe_callee,
        wasm_frame: bun_engine_wasm::wasm_frame,
        sampled_wasm_frame: bun_engine_wasm::sampled_wasm_frame,
        wasm_names: bun_engine_wasm::wasm_names,
        describe_wasm_module: bun_engine_wasm::describe_module,
        will_mark: |vm| {
            bun_engine_wasm::will_mark(vm);
            profiling::will_mark(vm);
        },
        visit_roots: profiling::visit_roots,
        visit_code_on_stack: |vm, addresses, _| {
            bun_engine_wasm::release_code_not_on_stack(vm, addresses);
        },
        reconcile_weak_references: profiling::reconcile_weak_references,
        did_collect: |vm, scope| {
            bun_engine_baseline::did_collect(scope);
            bun_engine_optimizer::did_collect(vm, scope);
        },
        will_destroy: profiling::will_destroy,
    }
}

/// For the current thread. `bun_engine_vm::set_options` has been called.
pub fn create_vm(heap_kind: HeapKind) -> VmRef {
    static HOOKS: OnceLock<Hooks> = OnceLock::new();
    VmRef::new(HOOKS.get_or_init(initialize), heap_kind)
}

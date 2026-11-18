//! The run time that every thread of the process shares.

use std::hash::{BuildHasher, RandomState};
use std::sync::OnceLock;

use bun_engine_vm::options;
use bun_engine_wasm_format::Features;
use bun_engine_wasm_runtime::{Engine, Options, Resources, Tiering, optimize_fully, set_resources};

use crate::host::HEAP;

fn features() -> Features {
    let mut features = Features::empty();
    features.set(Features::SIMD, options().use_wasm_simd);
    features.set(Features::MEMORY64, options().use_wasm_memory64);
    features
}

fn tiering() -> Tiering {
    if !options().use_wasm_baseline_jit && !options().use_wasm_optimizer {
        return Tiering::Interpreted;
    }
    if !options().use_wasm_optimizer {
        return Tiering::BaselineOnly;
    }
    match u32::try_from(options().threshold_for_wasm_optimizer) {
        Ok(threshold @ 1..) if options().use_wasm_baseline_jit => Tiering::After(threshold),
        _ => Tiering::OptimizedOnly,
    }
}

fn create() -> Option<&'static Engine> {
    if !options().use_wasm {
        return None;
    }
    set_resources(Resources {
        ram_size: options().ram_size as u64,
        background_threads: options().wasm_compiler_threads as usize,
        release_free_memory: || bun_alloc::mimalloc::mi_on_thread_idle(),
    });
    let options = Options {
        features: features(),
        cpu: bun_engine_asm::Features::host(),
        handle_faults: options().use_wasm_fault_handler,
        guard_memories: options().use_wasm_fast_memory,
        tiering: tiering(),
        optimizer: optimize_fully,
        use_threads: options().use_concurrent_jit,
        seed: RandomState::new().hash_one(()),
    };
    Engine::new(&HEAP, options).ok()
}

/// `None` if WebAssembly is switched off, or if there is no room for the code that every module needs.
pub(crate) fn engine() -> Option<&'static Engine> {
    static ENGINE: OnceLock<Option<&'static Engine>> = OnceLock::new();
    *ENGINE.get_or_init(create)
}

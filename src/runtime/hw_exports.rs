//! phase-d: handwritten Zig `@export` / `export fn` C-ABI symbols whose bodies
//! live in `bun_jsc::VirtualMachine` but whose link names must be emitted from
//! a crate that *depends on* `bun_jsc` (so the bodies can call back into the
//! real `VirtualMachine` struct without inverting the crate DAG). Each fn here
//! is a 1:1 port of the corresponding `src/jsc/VirtualMachine.zig` body.
//!
//! Symbols that already have a Rust `#[export_name]` / `#[no_mangle]` elsewhere
//! are intentionally **not** re-declared here to avoid duplicate-symbol link
//! errors:
//!   - `Bun__getTLSDefaultCiphers` / `Bun__setTLSDefaultCiphers`
//!       → `src/jsc/rare_data.rs`
//!   - `Resolver__nodeModulePathsForJS` / `Resolver__nodeModulePathsJSValue`
//!       → `src/jsc/resolver_jsc.rs`
//!   - `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming`
//!       → `src/jsc/JSGlobalObject.rs`
//!
//! Symbols whose Zig source lives outside `src/runtime/**` and whose body
//! depends on un-ported state are emitted here with a `todo!("blocked_on: …")`
//! body so the link name is satisfied; see each note.

use core::ffi::c_void;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSInternalPromise, JSValue, ZigStackFrame};

// ─── VirtualMachine.zig ──────────────────────────────────────────────────────

/// `export fn Bun__isMainThreadVM() callconv(.c) bool { return get().is_main_thread; }`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__isMainThreadVM() -> bool {
    // SAFETY: `get()` returns the live per-thread VM raw ptr.
    unsafe { (*VirtualMachine::get()).is_main_thread }
}

/// `export fn Bun__drainMicrotasksFromJS(global, callframe) callconv(jsc.conv) JSValue`
#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub fn Bun__drainMicrotasksFromJS(global: *mut JSGlobalObject, _callframe: *mut CallFrame) -> JSValue {
    // SAFETY: JSC passes a live global; `bun_vm()` returns its owning VM.
    let vm = unsafe { (*global).bun_vm() } as *const VirtualMachine as *mut VirtualMachine;
    // SAFETY: VM is uniquely live on this thread for the duration of the call.
    unsafe { (*vm).drain_microtasks() };
    JSValue::UNDEFINED
}

/// `export fn Bun__logUnhandledException(exception: JSValue) void { get().runErrorHandler(exception, null); }`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__logUnhandledException(exception: JSValue) {
    // SAFETY: `get()` returns the live per-thread VM raw ptr; mutator thread.
    unsafe { (*VirtualMachine::get()).run_error_handler(exception, None) };
}

/// `export fn Bun__remapStackFramePositions(vm, frames, frames_count)` —
/// **may run on the heap-collector thread** (see oven-sh/bun#17087); the
/// underlying method serializes on `remap_stack_frames_mutex`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__remapStackFramePositions(
    vm: *mut VirtualMachine,
    frames: *mut ZigStackFrame,
    frames_count: usize,
) {
    // SAFETY: `vm` is the C++-side ZigGlobalObject's m_bunVM; live for the call.
    unsafe { (*vm).remap_stack_frame_positions(frames, frames_count) };
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMain(vm, is_patched)`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMain(
    vm: *mut VirtualMachine,
    is_patched: bool,
) {
    // SAFETY: `vm` is the live per-thread VM (called from `node:module` patch hook).
    let vm = unsafe { &mut *vm };
    if vm.is_in_preload {
        vm.has_patched_run_main = is_patched;
    }
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(vm, promise)`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(
    vm: *mut VirtualMachine,
    promise: *mut JSInternalPromise,
) {
    // SAFETY: `vm` is the live per-thread VM; `promise` is a live JSC heap cell.
    let vm = unsafe { &mut *vm };
    if vm.pending_internal_promise.is_none() {
        vm.pending_internal_promise = Some(promise);
        vm.pending_internal_promise_is_protected = false;
    }
}

/// `@export(&setEntryPointEvalResultESM, .{ .name = "Bun__VM__setEntryPointEvalResultESM" })`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__setEntryPointEvalResultESM(this: *mut VirtualMachine, result: JSValue) {
    // SAFETY: `this` is the live per-thread VM.
    let this = unsafe { &mut *this };
    // allow esm evaluate to set value multiple times
    if !this.entry_point_result.cjs_set_value {
        // PORT NOTE: reshaped for borrowck — split disjoint &mut/& borrows.
        // SAFETY: `global` is the VM's owned global (STATIC ref per LIFETIMES.tsv).
        let global = unsafe { &*this.global };
        this.entry_point_result.value.set(global, result);
    }
}

/// `@export(&setEntryPointEvalResultCJS, .{ .name = "Bun__VM__setEntryPointEvalResultCJS" })`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__setEntryPointEvalResultCJS(this: *mut VirtualMachine, value: JSValue) {
    // SAFETY: `this` is the live per-thread VM.
    let this = unsafe { &mut *this };
    if !this.entry_point_result.value.has() {
        // PORT NOTE: reshaped for borrowck — split disjoint &mut/& borrows.
        // SAFETY: `global` is the VM's owned global (STATIC ref per LIFETIMES.tsv).
        let global = unsafe { &*this.global };
        this.entry_point_result.value.set(global, value);
        this.entry_point_result.cjs_set_value = true;
    }
}

/// `@export(&specifierIsEvalEntryPoint, .{ .name = "Bun__VM__specifierIsEvalEntryPoint" })`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__specifierIsEvalEntryPoint(
    this: *mut VirtualMachine,
    specifier: JSValue,
) -> bool {
    // SAFETY: `this` is the live per-thread VM.
    let this = unsafe { &mut *this };
    if let Some(eval_source) = this.module_loader.eval_source.as_ref() {
        let global = this.global();
        // Zig: `specifier.toBunString(this.global) catch @panic("unexpected exception")`
        let specifier_str = bun_jsc::bun_string_jsc::from_js(specifier, global)
            .expect("unexpected exception");
        // `bun.String` derefs on Drop.
        return specifier_str.eql_utf8(&eval_source.path.text);
    }
    false
}

/// `export fn Bun__closeChildIPC(global)` — defers the actual socket close to
/// the next tick on the event loop.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__closeChildIPC(global: *mut JSGlobalObject) {
    // SAFETY: `global` is live; `bun_vm()` returns its owning VM.
    let vm = unsafe { (*global).bun_vm() } as *const VirtualMachine as *mut VirtualMachine;
    // SAFETY: VM is uniquely live on this thread.
    if let Some(current_ipc) = unsafe { (*vm).get_ipc_instance() } {
        // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance`.
        unsafe { (*current_ipc).data.close_socket_next_tick(true) };
    }
}

// ─── outside-of-runtime sources (link name parked here, body delegated) ──────

// REAL: `Bun__Process__send` now exported directly from
// `bun_jsc::virtual_machine_exports` via `#[host_fn(export = ...)]`.

/// `@export(&jsFunctionFindSourceMap, .{ .name = "Bun__JSSourceMap__find" })`
/// (src/sourcemap_jsc/JSSourceMap.zig). Body is fully ported in
/// `bun_sourcemap_jsc` but the `#[host_fn(export = ...)]` wiring there is
/// gated; until that crate exposes `find_source_map` publicly, satisfy the
/// link name here.
#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub fn Bun__JSSourceMap__find(_global: *mut JSGlobalObject, _callframe: *mut CallFrame) -> JSValue {
    // Node.js doesn't enable source maps by default; the flag-gated full body
    // lives in `bun_sourcemap_jsc::find_source_map` (private).
    todo!("blocked_on: bun_sourcemap_jsc::find_source_map (private fn; add `pub` + re-export, then forward here)")
}

//! `Bun.startupSnapshot`: the app-facing side of `bun build --snapshot`. `take()` marks the point at which a manual-mode
//! build takes the snapshot; the rest lets an app ask which kind of process it is in. `process.on('restore')` is the
//! hook that runs in a resumed process.
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    jsc::create_host_function_object(
        global,
        &[
            ("main", __jsc_host_main, 1),
            ("take", __jsc_host_take, 1),
            ("isBuildingSnapshot", __jsc_host_is_building_snapshot, 0),
            ("epoch", __jsc_host_epoch, 0),
            ("reclean", __jsc_host_reclean, 0),
        ],
    )
}

/// `Bun.startupSnapshot.take({ timers, envGate })`: in the run that takes the snapshot, the app has finished starting up —
/// leave JS via an uncatchable termination and write the snapshot from the top of the event loop, then exit. Returns at once
/// in every other process, so it can be called unconditionally.
#[bun_jsc::host_fn]
fn take(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [opts] = frame.arguments_as_array::<1>();
    // Only a process that `bun build --snapshot` started to take the snapshot does anything here, so apps can call this
    // unconditionally at the point in their startup they consider "ready".
    if !bun_core::snapshot::building() {
        return Ok(JSValue::UNDEFINED);
    }
    if !opts.is_undefined_or_null() && !opts.is_object() {
        return Err(global.throw_invalid_arguments(format_args!(
            "take() takes an options object: {{ timers, envGate }}"
        )));
    }
    if opts.is_object() {
        if let Some(v) = opts.get(global, "timers")? {
            let mode = v.to_bun_string(global)?;
            let mode = if mode.eql_comptime("keep") {
                bun_core::snapshot::SnapshotTimers::Keep
            } else if mode.eql_comptime("cancel") {
                bun_core::snapshot::SnapshotTimers::Cancel
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "take: `timers` must be \"keep\" or \"cancel\""
                )));
            };
            bun_core::snapshot::set_snapshot_timers(mode);
        }
        // envGate: names of environment variables the snapshotted boot depended on. The snapshot records their values (or
        // absence) at build time and is only restored by processes whose environment agrees; anything else boots normally.
        if let Some(names) = opts.get(global, "envGate")? {
            if !names.is_undefined_or_null() {
                let mut it = names.array_iterator(global)?;
                let mut joined: Vec<u8> = Vec::new();
                while let Some(name) = it.next()? {
                    let name = name.to_bun_string(global)?.to_owned_slice();
                    if name.is_empty()
                        || bun_core::strings::contains_char(&name, 0)
                        || bun_core::strings::contains_char(&name, b'=')
                    {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "take: envGate entries must be non-empty variable names"
                        )));
                    }
                    joined.extend_from_slice(&name);
                    joined.push(0);
                }
                Bun__snapshotSetEnvGate(joined.as_ptr(), joined.len());
            }
        }
    }
    if bun_core::snapshot::snapshot_in_progress() {
        return Ok(JSValue::UNDEFINED); // the runtime is already draining the process (auto mode, or an earlier call): the options above still apply
    }
    let Some(out) = bun_core::env_var::BUN_SNAPSHOT_OUT.get() else {
        return Ok(JSValue::UNDEFINED);
    };
    bun_core::snapshot::request_snapshot(out);
    crate::cli::run_command::unwind_for_snapshot(global.vm());
    // Unwind every JS frame right now; the outermost EventLoop::tick sees the request and writes the snapshot.
    JSC__VM__throwTerminationExceptionNow(global);
    Err(jsc::JsError::Thrown)
}

unsafe extern "C" {
    safe fn JSC__VM__throwTerminationExceptionNow(global: &JSGlobalObject) -> JSValue;
    /// NUL-separated variable names; copied by the callee.
    safe fn Bun__snapshotSetEnvGate(names: *const u8, len: usize);
}

/// `Bun.startupSnapshot.reclean()`: in a process restored from a snapshot, hand pages whose contents drifted back to the
/// snapshot's bytes (transient writes: locks, refcounts) back to the clean file mapping. Cheap (~10ms); call when idle.
#[bun_jsc::host_fn]
fn reclean(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    if bun_core::snapshot::restored() {
        Bun__snapshotRecleanPages(global.vm());
    }
    Ok(JSValue::UNDEFINED)
}

unsafe extern "C" {
    safe fn Bun__snapshotRecleanPages(vm: &bun_jsc::VM);
}

/// `Bun.startupSnapshot.isBuildingSnapshot()`: true only in the run `bun build --snapshot` makes to take the snapshot.
#[bun_jsc::host_fn]
fn is_building_snapshot(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::from(bun_core::snapshot::building()))
}

/// `Bun.startupSnapshot.epoch()`: 0 in a process that booted normally, N in one resumed from a snapshot (N counts restores).
#[bun_jsc::host_fn]
fn epoch(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::js_number(bun_core::snapshot::epoch() as f64))
}

/// `Bun.startupSnapshot.main(fn)`: the program itself. Called right away in an ordinary launch; kept aside in the run that
/// takes the snapshot (so the snapshot holds the loaded program, not a program that has run); called after `'restore'` in
/// a launch that resumes from the snapshot, with that launch's argv, cwd, environment and stdio.
#[bun_jsc::host_fn]
fn main(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [callback] = frame.arguments_as_array::<1>();
    if !callback.is_callable() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.startupSnapshot.main() expects a function"
        )));
    }
    if bun_core::snapshot::building() {
        VirtualMachine::get()
            .as_mut()
            .rare_data()
            .startup_snapshot_main
            .set(global, callback);
        return Ok(JSValue::UNDEFINED);
    }
    callback.call(global, JSValue::UNDEFINED, &[])
}

/// Called by the restore sequence after the `'restore'` listeners have run.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__startupSnapshotRunMain(global: &JSGlobalObject) {
    let vm = VirtualMachine::get().as_mut();
    let Some(callback) = vm.rare_data().startup_snapshot_main.get() else {
        return;
    };
    if let Err(err) = callback.call(global, JSValue::UNDEFINED, &[]) {
        let exception = global.take_exception(err);
        vm.run_error_handler(exception, None);
    }
}

/// Asked by the snapshot writer: a snapshot taken with a `main()` registered is valid for any invocation.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__startupSnapshotHasMain() -> bool {
    VirtualMachine::get()
        .as_mut()
        .rare_data()
        .startup_snapshot_main
        .has()
}

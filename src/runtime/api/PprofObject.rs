//! The native half of `Bun.pprof.heap` (src/jsc/bindings/BunPprofObject.cpp).

use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult};
use bun_pprof::heap;

/// The one name of the API that is not in BunPprofObject.cpp.
const SAMPLE_INTERVAL: &str = "sampleInterval";

fn throw(global: &JSGlobalObject, error: heap::Error) -> bun_jsc::JsError {
    match error {
        heap::Error::AlreadyRunning => global
            .err(
                bun_jsc::ErrorCode::INVALID_STATE,
                format_args!(
                    "A heap profile is already running. There is one per process: call Bun.pprof.heap.stop() first."
                ),
            )
            .throw(),
        heap::Error::NotRunning => global
            .err(
                bun_jsc::ErrorCode::INVALID_STATE,
                format_args!("No heap profile is running. Call Bun.pprof.heap.start() first."),
            )
            .throw(),
        heap::Error::IntervalTooSmall => global.throw_invalid_arguments(format_args!(
            "{SAMPLE_INTERVAL} must be at least {} bytes",
            heap::MIN_SAMPLE_INTERVAL
        )),
        heap::Error::OutOfMemory => global.throw_out_of_memory(),
    }
}

/// `Bun.pprof.heap.start({ sampleInterval })`
#[bun_jsc::host_fn(export = "Bun__pprof__heapStart")]
fn heap_start(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [options] = frame.arguments_as_array::<1>();
    let mut sample_interval = heap::DEFAULT_SAMPLE_INTERVAL;
    if options.is_object() {
        if let Some(value) = options.get(global, SAMPLE_INTERVAL)? {
            // The shared validator reads NaN as "use the default".
            if value.is_number() && value.as_number().is_nan() {
                return Err(global.throw_range_error(
                    f64::NAN,
                    bun_core::fmt::OutOfRangeOptions {
                        field_name: SAMPLE_INTERVAL.as_bytes(),
                        min: heap::MIN_SAMPLE_INTERVAL as i64,
                        max: bun_jsc::MAX_SAFE_INTEGER,
                        ..Default::default()
                    },
                ));
            }
            if !value.is_undefined() {
                sample_interval = global.validate_integer_range::<usize>(
                    value,
                    heap::DEFAULT_SAMPLE_INTERVAL,
                    bun_jsc::IntegerRange {
                        min: heap::MIN_SAMPLE_INTERVAL as i128,
                        max: i128::from(bun_jsc::MAX_SAFE_INTEGER),
                        field_name: SAMPLE_INTERVAL.as_bytes(),
                        always_allow_zero: false,
                    },
                )?;
            }
        }
    } else if !options.is_undefined() {
        return Err(global.throw_invalid_argument_type_value("options", "object", options));
    }
    bun_jsc::bun_heap_pprof::install();
    heap::start(sample_interval).map_err(|e| throw(global, e))?;
    Ok(JSValue::UNDEFINED)
}

/// `Bun.pprof.heap.profile()`
#[bun_jsc::host_fn(export = "Bun__pprof__heapProfile")]
fn heap_profile(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    if !heap::is_running() {
        return Err(throw(global, heap::Error::NotRunning));
    }
    bun_jsc::bun_heap_pprof::resolve_sampled_positions(global.bun_vm().as_mut());
    let bytes = heap::profile().map_err(|e| throw(global, e))?;
    JSUint8Array::from_bytes(global, bytes.into_boxed_slice())
}

/// `Bun.pprof.heap.stop()`
#[bun_jsc::host_fn(export = "Bun__pprof__heapStop")]
fn heap_stop(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    if !heap::is_running() {
        return Err(throw(global, heap::Error::NotRunning));
    }
    bun_jsc::bun_heap_pprof::resolve_sampled_positions(global.bun_vm().as_mut());
    let bytes = heap::stop().map_err(|e| throw(global, e))?;
    JSUint8Array::from_bytes(global, bytes.into_boxed_slice())
}

/// `Bun.pprof.heap.isRunning`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__pprof__heapIsRunning() -> bool {
    heap::is_running()
}

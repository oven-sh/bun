use bun_jsc::{JSGlobalObject, JSType as JsType, JSValue, JsResult};

/// On windows, this is what libuv expects
/// On unix it is what the utimens api expects
#[cfg(windows)]
pub type TimeLike = f64;
#[cfg(not(windows))]
pub type TimeLike = libc::timespec;
// TODO(port): Zig's `std.posix.timespec` uses field names `sec`/`nsec`; libc::timespec
// uses `tv_sec`/`tv_nsec`. Confirm bun_sys exposes a wrapper or stick with libc.

const NS_PER_S: f64 = bun_core::time::NS_PER_S as f64;
#[cfg(not(windows))]
const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;
#[cfg(not(windows))]
const NS_PER_MS: f64 = bun_core::time::NS_PER_MS as f64;

pub fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<Option<TimeLike>> {
    // Number is most common case
    if value.is_number() {
        let seconds = value.as_number();
        if seconds.is_finite() {
            if seconds < 0.0 {
                return Ok(Some(from_now()));
            }
            return Ok(Some(from_seconds(seconds)));
        }
        return Ok(None);
    } else {
        match value.js_type() {
            JsType::JSDate => {
                let milliseconds = value.get_unix_timestamp();
                if milliseconds.is_finite() {
                    return Ok(Some(from_milliseconds(milliseconds)));
                }
            }
            JsType::String => {
                let seconds = value.to_number(global_object)?;
                if seconds.is_finite() {
                    return Ok(Some(from_seconds(seconds)));
                }
            }
            _ => {}
        }
    }
    Ok(None)
}

#[cfg(windows)]
fn from_seconds(seconds: f64) -> TimeLike {
    seconds
}

#[cfg(not(windows))]
fn from_seconds(seconds: f64) -> TimeLike {
    libc::timespec {
        // PORT NOTE: Rust `as` saturates on overflow/NaN where Zig @intFromFloat is UB.
        tv_sec: seconds as _,
        tv_nsec: (seconds.rem_euclid(1.0) * NS_PER_S) as _,
    }
}

#[cfg(windows)]
fn from_milliseconds(milliseconds: f64) -> TimeLike {
    milliseconds / 1000.0
}

#[cfg(not(windows))]
fn from_milliseconds(milliseconds: f64) -> TimeLike {
    let mut sec: f64 = milliseconds.div_euclid(MS_PER_S);
    let mut nsec: f64 = milliseconds.rem_euclid(MS_PER_S) * NS_PER_MS;

    if nsec < 0.0 {
        nsec += NS_PER_S;
        sec -= 1.0;
    }

    libc::timespec {
        tv_sec: sec as _,
        tv_nsec: nsec as _,
    }
}

#[cfg(windows)]
fn from_now() -> TimeLike {
    // TODO(port): std.time.nanoTimestamp() — confirm bun_core/bun_sys provides a
    // nanosecond-since-epoch helper; std::time::SystemTime is a fallback.
    let nanos = bun_core::time::nano_timestamp();
    (nanos as f64) / NS_PER_S
}

#[cfg(not(windows))]
fn from_now() -> TimeLike {
    libc::timespec {
        tv_sec: 0,
        #[cfg(any(target_os = "linux", target_os = "android"))]
        tv_nsec: libc::UTIME_NOW as _,
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        tv_nsec: bun_sys::c::UTIME_NOW as _,
    }
}

// ported from: src/runtime/node/time_like.zig

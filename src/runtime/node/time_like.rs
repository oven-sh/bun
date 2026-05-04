use bun_jsc::{JSGlobalObject, JSValue, JsResult, JsType};

/// On windows, this is what libuv expects
/// On unix it is what the utimens api expects
#[cfg(windows)]
pub type TimeLike = f64;
#[cfg(not(windows))]
pub type TimeLike = libc::timespec;
// TODO(port): Zig's `std.posix.timespec` uses field names `sec`/`nsec`; libc::timespec
// uses `tv_sec`/`tv_nsec`. Confirm bun_sys exposes a wrapper or stick with libc.

const NS_PER_S: f64 = 1_000_000_000.0;
const MS_PER_S: f64 = 1_000.0;
const NS_PER_MS: f64 = 1_000_000.0;

// Equivalent to `toUnixTimestamp`
//
// Node.js docs:
// > Values can be either numbers representing Unix epoch time in seconds, Dates, or a numeric string like '123456789.0'.
// > If the value can not be converted to a number, or is NaN, Infinity, or -Infinity, an Error will be thrown.
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
    // Permissions requirements
    //        To set both file timestamps to the current time (i.e., times is
    //        NULL, or both tv_nsec fields specify UTIME_NOW), either:
    //
    //        •  the caller must have write access to the file;
    //
    //        •  the caller's effective user ID must match the owner of the
    //           file; or
    //
    //        •  the caller must have appropriate privileges.
    //
    //        To make any change other than setting both timestamps to the
    //        current time (i.e., times is not NULL, and neither tv_nsec field
    //        is UTIME_NOW and neither tv_nsec field is UTIME_OMIT), either
    //        condition 2 or 3 above must apply.
    //
    //        If both tv_nsec fields are specified as UTIME_OMIT, then no file
    //        ownership or permission checks are performed, and the file
    //        timestamps are not modified, but other error conditions may still
    libc::timespec {
        tv_sec: 0,
        #[cfg(target_os = "linux")]
        tv_nsec: libc::UTIME_NOW as _,
        #[cfg(not(target_os = "linux"))]
        tv_nsec: bun_sys::c::UTIME_NOW as _,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/time_like.zig (106 lines)
//   confidence: medium
//   todos:      2
//   notes:      TimeLike maps to libc::timespec on unix (tv_sec/tv_nsec vs Zig sec/nsec); Windows from_now() needs nano_timestamp source
// ──────────────────────────────────────────────────────────────────────────

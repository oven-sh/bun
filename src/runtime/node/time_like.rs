use bun_jsc::{JSGlobalObject, JSType as JsType, JSValue, JsResult};

/// On windows, this is what libuv expects
/// On unix it is what the utimens api expects
#[cfg(windows)]
pub type TimeLike = f64;
#[cfg(not(windows))]
pub type TimeLike = libc::timespec;

const NS_PER_S: f64 = bun_core::time::NS_PER_S as f64;
#[cfg(not(windows))]
const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;
#[cfg(not(windows))]
const NS_PER_MS: f64 = bun_core::time::NS_PER_MS as f64;

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
        // floor (not truncate) so negative fractions pair with the
        // always-non-negative `rem_euclid` nanoseconds. `as` saturates on overflow/NaN.
        tv_sec: seconds.div_euclid(1.0) as _,
        tv_nsec: (seconds.rem_euclid(1.0) * NS_PER_S) as _,
    }
}

#[cfg(windows)]
fn from_milliseconds(milliseconds: f64) -> TimeLike {
    milliseconds / 1000.0
}

#[cfg(not(windows))]
fn from_milliseconds(milliseconds: f64) -> TimeLike {
    libc::timespec {
        tv_sec: milliseconds.div_euclid(MS_PER_S) as _,
        tv_nsec: (milliseconds.rem_euclid(MS_PER_S) * NS_PER_MS) as _,
    }
}

#[cfg(windows)]
fn from_now() -> TimeLike {
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
        #[cfg(any(target_os = "linux", target_os = "android"))]
        tv_nsec: libc::UTIME_NOW as _,
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        tv_nsec: bun_sys::c::UTIME_NOW as _,
    }
}

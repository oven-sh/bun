use bun_jsc::{JSGlobalObject, JSType as JsType, JSValue, JsResult};

pub(crate) use bun_sys::TimeLike;

const NS_PER_S: f64 = bun_core::time::NS_PER_S as f64;
const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;
const NS_PER_MS: f64 = bun_core::time::NS_PER_MS as f64;

// Equivalent to `toUnixTimestamp`
//
// Node.js docs:
// > Values can be either numbers representing Unix epoch time in seconds, Dates, or a numeric string like '123456789.0'.
// > If the value can not be converted to a number, or is NaN, Infinity, or -Infinity, an Error will be thrown.
pub(crate) fn from_js(
    global_object: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<TimeLike>> {
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

fn from_seconds(seconds: f64) -> TimeLike {
    // floor (not truncate) so negative fractions pair with the
    // always-non-negative `rem_euclid` nanoseconds.
    let mut sec = seconds.div_euclid(1.0);
    let mut nsec = seconds.rem_euclid(1.0) * NS_PER_S;
    // As in Node.js there, 0.36 does not come back as 0.3599998.
    if cfg!(windows) {
        nsec = (nsec / 1000.0).round() * 1000.0;
    }
    // rem_euclid can round to exactly 1.0 for tiny negative inputs; borrow back.
    if nsec >= NS_PER_S {
        nsec -= NS_PER_S;
        sec += 1.0;
    }
    TimeLike {
        // `as` saturates on overflow/NaN.
        sec: sec as _,
        nsec: nsec as _,
    }
}

fn from_milliseconds(milliseconds: f64) -> TimeLike {
    TimeLike {
        sec: milliseconds.div_euclid(MS_PER_S) as _,
        nsec: (milliseconds.rem_euclid(MS_PER_S) * NS_PER_MS) as _,
    }
}

#[cfg(windows)]
fn from_now() -> TimeLike {
    let (nanos, per_second) = (bun_core::time::nano_timestamp(), NS_PER_S as i128);
    TimeLike {
        sec: nanos.div_euclid(per_second) as _,
        nsec: nanos.rem_euclid(per_second) as _,
    }
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
    TimeLike {
        sec: 0,
        nsec: bun_sys::UTIME_NOW,
    }
}

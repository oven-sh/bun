use bun_jsc::{JSGlobalObject, JSType as JsType, JSValue, JsResult};

pub type TimeLike = bun_sys::TimeLike;

#[cfg(not(windows))]
const NS_PER_S: f64 = bun_core::time::NS_PER_S as f64;
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

/// Node on Windows stores the time libuv's `TIME_T_TO_FILETIME` computes: the
/// FILETIME tick count is `seconds * 1e7 + <1601 offset>` evaluated as a double,
/// which at today's dates rounds to 16 ticks. `utimes(p, 1713037251.36)` reads
/// back as 1713037251360 ms only with that rounding.
#[cfg(windows)]
fn from_seconds(seconds: f64) -> TimeLike {
    const TICKS_PER_S: i64 = 10_000_000;
    const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
    // `as` saturates on overflow/NaN.
    let ticks = (seconds * TICKS_PER_S as f64 + UNIX_EPOCH_TICKS as f64) as i64 - UNIX_EPOCH_TICKS;
    TimeLike {
        sec: ticks.div_euclid(TICKS_PER_S),
        nsec: ticks.rem_euclid(TICKS_PER_S) * 100,
    }
}

#[cfg(not(windows))]
fn from_seconds(seconds: f64) -> TimeLike {
    // floor (not truncate) so negative fractions pair with the
    // always-non-negative `rem_euclid` nanoseconds.
    let mut sec = seconds.div_euclid(1.0);
    let mut nsec = seconds.rem_euclid(1.0) * NS_PER_S;
    // rem_euclid can round to exactly 1.0 for tiny negative inputs; borrow back.
    if nsec >= NS_PER_S {
        nsec -= NS_PER_S;
        sec += 1.0;
    }
    TimeLike {
        // `as` saturates on overflow/NaN.
        sec: sec as i64,
        nsec: nsec as i64,
    }
}

#[cfg(windows)]
fn from_milliseconds(milliseconds: f64) -> TimeLike {
    from_seconds(milliseconds / MS_PER_S)
}

#[cfg(not(windows))]
fn from_milliseconds(milliseconds: f64) -> TimeLike {
    TimeLike {
        sec: milliseconds.div_euclid(MS_PER_S) as i64,
        nsec: (milliseconds.rem_euclid(MS_PER_S) * NS_PER_MS) as i64,
    }
}

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

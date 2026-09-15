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
//
// A `Date` or a string goes to libuv as the number it converts to, and there a
// NaN is `UV_FS_UTIME_OMIT` and an infinity is `UV_FS_UTIME_NOW`.
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
                if milliseconds.is_nan() {
                    return Ok(Some(omit()));
                }
                return Ok(Some(from_milliseconds(milliseconds)));
            }
            JsType::String => {
                let seconds = value.to_number(global_object)?;
                if seconds.is_finite() {
                    return Ok(Some(from_seconds(seconds)));
                }
                if seconds.is_infinite() {
                    return Ok(Some(from_now()));
                }
            }
            _ => {}
        }
    }
    Ok(None)
}

/// The time Node on Windows stores: libuv's `TIME_T_TO_FILETIME` evaluates the
/// FILETIME, `seconds * 1e7 + <ticks from 1601 to 1970>`, as a double.
#[cfg(windows)]
fn from_seconds(seconds: f64) -> TimeLike {
    const TICKS_PER_S: i64 = 10_000_000;
    const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
    const I64_LIMIT: f64 = 9_223_372_036_854_775_808.0;
    let filetime = seconds * TICKS_PER_S as f64 + UNIX_EPOCH_TICKS as f64;
    if !(0.0..I64_LIMIT).contains(&filetime) {
        // Not a FILETIME. Saturated, so that `bun_sys` fails the conversion
        // with `EINVAL`, which is what `SetFileTime` gives Node.
        return TimeLike {
            sec: if filetime < 0.0 { i64::MIN } else { i64::MAX },
            nsec: 0,
        };
    }
    let ticks = filetime as i64 - UNIX_EPOCH_TICKS;
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

fn omit() -> TimeLike {
    TimeLike {
        sec: 0,
        nsec: bun_sys::UTIME_OMIT,
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

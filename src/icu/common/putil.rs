//! The clock, floating-point helpers, and the host's locale and time zone. ICU4C: putil.cpp, putilimp.h

use crate::common::memory::fail_on_oom;
use crate::common::umutex::OnceBox;
use crate::common::utypes::UErrorCode;
use crate::sys::host::{self, TzGlobals};

/// Milliseconds since 1970-01-01T00:00Z.
pub(crate) type UDate = f64;

pub(crate) fn uprv_get_utc_time() -> UDate {
    bun_core::time::milli_timestamp() as UDate
}

/// Values out of range and NaN convert to `MIN`.
#[cfg(target_arch = "x86_64")]
mod casts {
    #[inline]
    pub(crate) fn double_to_int32(d: f64) -> i32 {
        if d < 2147483648.0 { d as i32 } else { i32::MIN }
    }

    #[inline]
    pub(crate) fn double_to_int64(d: f64) -> i64 {
        if d < 9_223_372_036_854_775_808.0 {
            d as i64
        } else {
            i64::MIN
        }
    }
}

/// Values out of range saturate and NaN converts to 0.
#[cfg(target_arch = "aarch64")]
mod casts {
    #[inline]
    pub(crate) fn double_to_int32(d: f64) -> i32 {
        d as i32
    }

    #[inline]
    pub(crate) fn double_to_int64(d: f64) -> i64 {
        d as i64
    }
}

pub(crate) use casts::{double_to_int32, double_to_int64};

/// Returns 2^54, the `double` nearest to 2^54 - 1.
pub(crate) fn uprv_max_mantissa() -> f64 {
    2f64.powi(f64::MANTISSA_DIGITS as i32 + 1) - 1.0
}

/// Returns `ab_CD_GH` for the POSIX ID `ab_CD.EF@GH`. The variant follows the last `@` and ends at a dot.
#[cfg(unix)]
pub(crate) fn uprv_get_default_locale_id() -> Result<&'static [u8], UErrorCode> {
    use crate::common::cstring::split_once;
    use crate::common::memory::{try_concat, try_to_vec};
    use bun_core::{getenv_z, strings, zstr};

    static CORRECTED: OnceBox<Vec<u8>> = OnceBox::new();
    let corrected = CORRECTED.get_or_try_init(|| {
        let is_not_c_locale = |id: &&[u8]| *id != b"C" && *id != b"POSIX";
        let variables = [zstr!("LC_ALL"), zstr!("LC_MESSAGES"), zstr!("LANG")];
        let from_variables = || {
            variables
                .into_iter()
                .filter_map(getenv_z)
                .find(|value| !value.is_empty())
        };
        let current = host::messages_locale();
        let posix_id = current
            .as_deref()
            .filter(is_not_c_locale)
            .or_else(from_variables)
            .unwrap_or(b"C");
        let base = match split_once(split_once(posix_id, b'.').0, b'@').0 {
            b"C" | b"POSIX" => b"en_US_POSIX",
            base => base,
        };
        let Some((_, variant)) = strings::rsplit_once_char(posix_id, b'@') else {
            return try_to_vec(base);
        };
        let variant = if variant == b"nynorsk" {
            b"NY"
        } else {
            split_once(variant, b'.').0
        };
        try_concat(&[
            base,
            if strings::contains_char(base, b'_') {
                b"_"
            } else {
                b"__"
            },
            variant,
        ])
    });
    corrected.map(Vec::as_slice)
}

#[cfg(windows)]
pub(crate) fn uprv_get_default_locale_id() -> Result<&'static [u8], UErrorCode> {
    static CORRECTED: OnceBox<Option<Vec<u8>>> = OnceBox::new();
    let corrected = CORRECTED.get_or_try_init(|| {
        let name = host::user_default_locale_name();
        Ok(name
            .as_ref()
            .and_then(crate::common::wintz::default_locale_id))
    })?;
    Ok(corrected.as_deref().unwrap_or(b"en_US"))
}

#[cfg(unix)]
mod host_time_zone {
    use super::{TzGlobals, UErrorCode, host};
    use crate::common::memory::{oom_checked, try_to_vec};
    use crate::common::putil_data::OFFSET_ZONE_MAPPINGS;

    /// Accepts `Iceland` and `GMT+11`, rejects POSIX rules such as `CST-7CDT`.
    fn is_valid_olson_id(id: &[u8]) -> bool {
        let letters = id
            .iter()
            .take_while(|&&c| !c.is_ascii_digit() && c != b',')
            .count();
        let digits = id
            .iter()
            .skip(letters)
            .take(2)
            .take_while(|c| c.is_ascii_digit())
            .count();
        letters + digits == id.len()
            || [b"PST8PDT", b"MST7MDT", b"CST6CDT", b"EST5EDT"]
                .iter()
                .any(|&known| known == id)
    }

    /// Strips `posix/` or `right/`: both directories repeat the zoneinfo tree.
    fn skip_zone_id_prefix(id: &[u8]) -> &[u8] {
        id.strip_prefix(b"posix/")
            .or_else(|| id.strip_prefix(b"right/"))
            .unwrap_or(id)
    }

    /// Maps the abbreviations in `tzname` to an Olson ID. Returns the standard abbreviation if no row matches.
    fn remap_short_time_zone() -> Result<Vec<u8>, UErrorCode> {
        const JUNE_SOLSTICE: i32 = 1182478260;
        const DECEMBER_SOLSTICE: i32 = 1198332540;
        let mut globals = TzGlobals::lock();
        // Make both calls, in this order: `tzname` holds the abbreviations of the last time converted.
        let daylight_type = match (
            globals.is_dst(JUNE_SOLSTICE),
            globals.is_dst(DECEMBER_SOLSTICE),
        ) {
            (_, true) => 2,
            (true, false) => 1,
            (false, false) => 0,
        };
        let ([standard, daylight], offset) = (globals.tzname(), globals.timezone());
        OFFSET_ZONE_MAPPINGS
            .iter()
            .find(|row| {
                (row.0, row.1, row.2.as_bytes(), row.3.as_bytes())
                    == (offset, daylight_type, &standard, &daylight)
            })
            // Where `timezone` converts times, it can have changed the names.
            .map_or_else(
                || Ok(globals.tzname().into_iter().next().unwrap_or_default()),
                |row| try_to_vec(row.4.as_bytes()),
            )
    }

    mod localtime {
        use super::{is_valid_olson_id, skip_zone_id_prefix};
        use crate::common::memory::{Appendable, defer_oom, try_to_vec};
        use crate::common::slice_ext::SliceExt;
        use bun_core::{ZStr, strings, zstr};
        use bun_sys::dir_iterator::iterate_owned;
        use bun_sys::{CloseOnDrop, Dir, Fd, File, O};

        pub(super) const TZDEFAULT: &ZStr = zstr!("/etc/localtime");
        const TZZONEINFO: &[u8] = b"/usr/share/zoneinfo/";

        fn open(path: &[u8]) -> Option<CloseOnDrop> {
            let file = File::openat(Fd::cwd(), path, O::RDONLY | O::NOCTTY, 0);
            file.ok().map(CloseOnDrop::from)
        }

        /// Compares the first `size` bytes.
        fn contents_equal(a: &File, b: &File, size: usize) -> bool {
            const CHUNK_SIZE: usize = 4096;
            let (mut chunk_a, mut chunk_b) = ([0; CHUNK_SIZE], [0; CHUNK_SIZE]);
            (0..size).step_by(CHUNK_SIZE).all(|at| {
                let length = (size - at).min(CHUNK_SIZE);
                let fill = |file: &File, chunk: &mut [u8]| {
                    file.pread_all(chunk.slice_mut(..length), at as u64)
                        .is_ok_and(|count| count == length)
                };
                fill(a, &mut chunk_a) && fill(b, &mut chunk_b) && chunk_a == chunk_b
            })
        }

        /// Returns the ID of the first file under `TZZONEINFO` that has the contents of `default`, depth first.
        fn search_for_tz_file(default: &File) -> Option<Vec<u8>> {
            let size = default.get_end_pos().ok()?;
            let is_copy = |file: CloseOnDrop| {
                file.get_end_pos().is_ok_and(|other| other == size)
                    && contents_equal(default, &file, size)
            };
            // `directories` is the stack of open directories, each with the length of its path.
            let (mut path, mut directories) = (Vec::new(), Vec::new());
            path.add_all(TZZONEINFO);
            directories.add((iterate_owned(Dir::open(TZZONEINFO).ok()?), path.len()));
            while let Some((directory, length)) = directories.last_mut() {
                let Ok(Some(entry)) = directory.next() else {
                    directories.pop();
                    continue;
                };
                let name = entry.name.slice();
                if name == b"posixrules" || name == b"localtime" {
                    continue;
                }
                path.truncate(*length);
                defer_oom(path.reserve_append(name.len() + 1))?;
                path.add_all(name);
                if let Ok(directory) = Dir::open(&path) {
                    path.add(b'/');
                    directories.add((iterate_owned(directory), path.len()));
                } else if open(&path).is_some_and(is_copy) {
                    return defer_oom(try_to_vec(skip_zone_id_prefix(
                        path.slice(TZZONEINFO.len()..),
                    )));
                }
            }
            None
        }

        pub(super) fn after_zoneinfo(path: &[u8]) -> Option<&[u8]> {
            const TZZONEINFOTAIL: &[u8] = b"/zoneinfo/";
            let at = strings::index_of(path, TZZONEINFOTAIL)?;
            Some(path.slice(at + TZZONEINFOTAIL.len()..))
        }

        /// Derives the ID from the target of the symlink `TZDEFAULT`, or else from a file with the same contents.
        pub(crate) fn olson_id() -> Option<Vec<u8>> {
            let (mut real, mut link) = (
                bun_paths::path_buffer_pool::get(),
                bun_paths::path_buffer_pool::get(),
            );
            let id = match bun_sys::realpath(TZDEFAULT, &mut real) {
                Ok(mut path) if path != TZDEFAULT.as_bytes() => {
                    if after_zoneinfo(path).is_none_or(|id| id == b"posixrules")
                        && let Ok(length @ 1..) = bun_sys::readlink(TZDEFAULT, &mut link[..])
                    {
                        path = link.slice(..length);
                    }
                    defer_oom(try_to_vec(skip_zone_id_prefix(after_zoneinfo(path)?)))
                }
                _ => search_for_tz_file(&*open(TZDEFAULT)?),
            };
            id.filter(|id| is_valid_olson_id(id))
        }
    }

    fn id_in_tz_setting(tz: &[u8]) -> Option<&[u8]> {
        let name = tz.strip_prefix(b":").unwrap_or(tz);
        match localtime::after_zoneinfo(name).filter(|_| name.starts_with(b"/")) {
            Some(b"localtime" | b"posixrules") => None,
            Some(id) => Some(skip_zone_id_prefix(id)).filter(|id| is_valid_olson_id(id)),
            None if name == localtime::TZDEFAULT.as_bytes() => None,
            None => is_valid_olson_id(tz).then(|| skip_zone_id_prefix(name)),
        }
    }

    pub(crate) fn uprv_tzname() -> Result<Vec<u8>, UErrorCode> {
        // After a failed copy of a name the next way must not be tried: it could give another zone.
        if let Some(id) = oom_checked(host::tz_setting())?
            .as_deref()
            .and_then(id_in_tz_setting)
        {
            return try_to_vec(id);
        }
        // The last way calls `localtime_r`, which changes the caller's `tzname`.
        oom_checked(localtime::olson_id())?.map_or_else(remap_short_time_zone, Ok)
    }
}

#[cfg(windows)]
mod host_time_zone {
    use super::{TzGlobals, UErrorCode};

    pub(crate) fn uprv_tzname() -> Result<Vec<u8>, UErrorCode> {
        Ok(crate::common::wintz::uprv_detect_windows_time_zone()
            .or_else(|| TzGlobals::lock().standard_tzname())
            .unwrap_or_default())
    }
}

/// Returns the ID of the host's time zone, or its abbreviation. Fails only if out of memory.
pub(crate) fn query_host_time_zone() -> Result<Vec<u8>, UErrorCode> {
    TzGlobals::lock().tzset();
    fail_on_oom(host_time_zone::uprv_tzname)
}

//! How a language writes dates of the Gregorian calendar.

use bun_jsc::JSGlobalObject;

unsafe extern "C" {
    /// These fill `out`, and answer how much of it.
    fn Bun__DOM__bestDatePattern(
        locale: *const u8,
        skeleton: *const u16,
        length: u32,
        out: *mut u16,
        capacity: u32,
    ) -> u32;
    fn Bun__DOM__formatDate(
        locale: *const u8,
        pattern: *const u16,
        length: u32,
        time: f64,
        out: *mut u16,
        capacity: u32,
    ) -> u32;
    fn Bun__DOM__firstDayOfWeek(locale: *const u8) -> u32;
    safe fn Bun__DOM__localTime(global: &JSGlobalObject) -> f64;
}

/// With a NUL at the end.
pub(super) struct Locale(Vec<u8>);

fn filled(fill: impl FnOnce(*mut u16, u32) -> u32) -> String {
    let mut out = [0; 128];
    let length = fill(out.as_mut_ptr(), out.len() as u32) as usize;
    String::from_utf16_lossy(&out[..length.min(out.len())])
}

impl Locale {
    pub(super) fn new(tag: &str) -> Locale {
        Locale([tag.as_bytes(), b"\0"].concat())
    }

    /// https://unicode.org/reports/tr35/tr35-dates.html#availableFormats_appendItems
    pub(super) fn pattern(&self, skeleton: &str) -> String {
        let skeleton: Vec<_> = skeleton.encode_utf16().collect();
        // SAFETY: the pointers and the lengths are of slices.
        filled(|out, capacity| unsafe {
            Bun__DOM__bestDatePattern(
                self.0.as_ptr(),
                skeleton.as_ptr(),
                skeleton.len() as u32,
                out,
                capacity,
            )
        })
    }

    /// In UTC.
    pub(super) fn format(&self, pattern: &str, time: f64) -> String {
        let pattern: Vec<_> = pattern.encode_utf16().collect();
        // SAFETY: as above.
        filled(|out, capacity| unsafe {
            Bun__DOM__formatDate(
                self.0.as_ptr(),
                pattern.as_ptr(),
                pattern.len() as u32,
                time,
                out,
                capacity,
            )
        })
    }

    /// 0 is Monday.
    pub(super) fn first_day_of_week(&self) -> i64 {
        // SAFETY: it ends with NUL.
        unsafe { Bun__DOM__firstDayOfWeek(self.0.as_ptr()) }.into()
    }
}

/// What a clock in UTC would show if it were set to the time here.
pub(super) fn local_time(global: &JSGlobalObject) -> f64 {
    Bun__DOM__localTime(global)
}

mod last_parsed;
mod recent_days;

use core::cell::{Cell, RefCell};

use bun_engine_text::{StringRef, Text};
use bun_icu::calendar::ZoneName;

use last_parsed::LastParsed;
use recent_days::{Day, RecentDays};

use crate::fields::{DateFields, OffsetBits};
use crate::format::{date_time_string, time_string};
use crate::parse::{Parsed, parse_date};
use crate::time_value::{DAY, LOCAL_TIMES, split_at_midnight, time_clip, time_clip_integer};
use crate::zone::{Side, TimeZoneId, ZoneRules, system_time_zone, time_zone_generation};

/// A span of instants in milliseconds, cut to those that have fields.
#[derive(Clone, Copy)]
struct UtcSpan {
    start: i64,
    end: i64,
    offset: i32,
    offset_bits: OffsetBits,
}

impl UtcSpan {
    const EMPTY: UtcSpan = UtcSpan {
        start: 0,
        end: 0,
        offset: 0,
        offset_bits: OffsetBits::UTC,
    };
}

/// A span of local times, in milliseconds.
#[derive(Clone, Copy)]
struct LocalSpan {
    start: f64,
    end: f64,
    offset: f64,
}

impl LocalSpan {
    const EMPTY: LocalSpan = LocalSpan {
        start: 0.0,
        end: 0.0,
        offset: 0.0,
    };
}

/// Local time as one thread sees it. It stays in the zone that the process was in when it first needed one, until `refresh`.
pub struct DateCache {
    generation: Cell<u64>,
    zone: Cell<Option<(TimeZoneId, &'static ZoneRules)>>,
    utc_days: RecentDays,
    local_days: RecentDays,
    utc_span: Cell<UtcSpan>,
    local_span: Cell<LocalSpan>,
    last_parsed: LastParsed,
    /// For standard time and for daylight saving time, with what goes around them.
    zone_names: RefCell<[Option<StringRef>; 2]>,
}

impl Default for DateCache {
    fn default() -> DateCache {
        DateCache {
            generation: Cell::new(time_zone_generation()),
            zone: Cell::new(None),
            utc_days: RecentDays::new(),
            local_days: RecentDays::new(),
            utc_span: Cell::new(UtcSpan::EMPTY),
            local_span: Cell::new(LocalSpan::EMPTY),
            last_parsed: LastParsed::default(),
            zone_names: RefCell::default(),
        }
    }
}

impl DateCache {
    /// Whether the zone of the process can have changed since the last `refresh`.
    #[inline]
    pub fn is_stale(&self) -> bool {
        self.generation.get() != time_zone_generation()
    }

    /// Follows the process to its zone. Returns whether earlier results of `local_fields` are out of date.
    pub fn refresh(&self) -> bool {
        self.generation.set(time_zone_generation());
        if (self.zone.get()).is_none_or(|(id, _)| id == system_time_zone()) {
            return false;
        }
        self.zone.set(None);
        self.local_days.clear();
        self.utc_span.set(UtcSpan::EMPTY);
        self.local_span.set(LocalSpan::EMPTY);
        self.last_parsed.clear();
        self.zone_names.take();
        true
    }

    pub fn time_zone(&self) -> TimeZoneId {
        self.zone().0
    }

    #[inline]
    fn zone(&self) -> (TimeZoneId, &'static ZoneRules) {
        self.zone.get().unwrap_or_else(|| {
            let id = system_time_zone();
            let zone = (id, id.rules());
            self.zone.set(Some(zone));
            zone
        })
    }

    /// `DateFields::utc`, quicker for a day that was asked about lately.
    #[inline]
    pub fn utc_fields(&self, time: f64) -> Option<DateFields> {
        let time = time.to_int_checked()?;
        (self.utc_days.find(time)).or_else(|| self.utc_fields_of_new_day(time))
    }

    #[inline(never)]
    fn utc_fields_of_new_day(&self, time: i64) -> Option<DateFields> {
        LOCAL_TIMES.contains(&time).then_some(())?;
        let (days, since_midnight) = split_at_midnight(time);
        let fields = DateFields::at_midnight(days, OffsetBits::UTC);
        let midnight = time - i64::from(since_midnight);
        if midnight != *LOCAL_TIMES.end() {
            self.utc_days.add(time, Day { midnight, fields });
        }
        Some(fields.later(since_midnight))
    }

    /// `DateFields::in_zone` for `time_zone`: the fields of LocalTime(`time`).
    #[inline]
    pub fn local_fields(&self, time: f64) -> Option<DateFields> {
        let time = time.to_int_checked()?;
        (self.local_days.find(time)).or_else(|| self.local_fields_of_new_day(time))
    }

    #[inline(never)]
    fn local_fields_of_new_day(&self, time: i64) -> Option<DateFields> {
        let mut span = self.utc_span.get();
        if !(span.start..span.end).contains(&time) {
            span = self.find_utc_span(time);
            (span.start..span.end).contains(&time).then_some(())?;
        }
        let (days, since_midnight) = split_at_midnight(time + i64::from(span.offset));
        let fields = DateFields::at_midnight(days, span.offset_bits);
        let midnight = time - i64::from(since_midnight);
        if span.start <= midnight && midnight + DAY <= span.end {
            self.local_days.add(time, Day { midnight, fields });
        }
        Some(fields.later(since_midnight))
    }

    #[inline(never)]
    fn find_utc_span(&self, time: i64) -> UtcSpan {
        let span = self.zone().1.span_at(time.div_euclid(1000));
        let offset = span.offset.seconds * 1000;
        let first = LOCAL_TIMES.start() - i64::from(offset.min(0));
        let last = LOCAL_TIMES.end() - i64::from(offset.max(0));
        let span = UtcSpan {
            start: span.start.saturating_mul(1000).max(first),
            end: span.end.saturating_mul(1000).min(last + 1),
            offset,
            offset_bits: OffsetBits::new(span.offset),
        };
        self.utc_span.set(span);
        span
    }

    /// UTC(`local_time`), for `time_clip`.
    #[inline]
    pub fn utc(&self, local_time: f64) -> f64 {
        let span = self.local_span.get();
        if (span.start..span.end).contains(&local_time) {
            return local_time - span.offset;
        }
        self.utc_outside_span(local_time)
    }

    #[inline(never)]
    fn utc_outside_span(&self, local_time: f64) -> f64 {
        let Some(milliseconds) = local_time.to_int_checked::<i64>() else {
            return local_time;
        };
        let rules = self.zone().1;
        let span = rules.span_at_local(milliseconds.div_euclid(1000), Side::Before);
        let offset = f64::from(span.offset.seconds * 1000);
        self.local_span.set(LocalSpan {
            start: span.start as f64 * 1000.0,
            end: span.end as f64 * 1000.0,
            offset,
        });
        local_time - offset
    }

    /// `Date.parse`.
    pub fn parse(&self, text: Text<'_>) -> f64 {
        (self.last_parsed).time_or_else(text, || self.parse_anew(text))
    }

    #[inline(always)]
    fn parse_anew(&self, text: Text<'_>) -> f64 {
        match parse_date(text) {
            Some(Parsed::Utc(time)) => time_clip_integer(time),
            Some(Parsed::Local(time)) => time_clip(self.utc(time as f64)),
            None => f64::NAN,
        }
    }

    /// `Tue Feb 01 2022 13:05:09 GMT+0100 (Central European Standard Time)`
    pub fn date_time_string(&self, fields: DateFields) -> StringRef {
        self.with_zone_name(fields, date_time_string)
    }

    /// `13:05:09 GMT+0100 (Central European Standard Time)`
    pub fn time_string(&self, fields: DateFields) -> StringRef {
        self.with_zone_name(fields, time_string)
    }

    #[inline(always)]
    fn with_zone_name(
        &self,
        fields: DateFields,
        format: impl FnOnce(DateFields, Text<'_>) -> StringRef,
    ) -> StringRef {
        let mut names = self.zone_names.borrow_mut();
        let name = names[usize::from(fields.is_daylight())]
            .get_or_insert_with(|| self.parenthesized_zone_name(fields.is_daylight()));
        format(fields, name.text())
    }

    #[cold]
    fn parenthesized_zone_name(&self, is_daylight: bool) -> StringRef {
        let kind = if is_daylight {
            ZoneName::Daylight
        } else {
            ZoneName::Standard
        };
        let mut name = self.time_zone().long_name(kind).unwrap_or_default();
        if !name.is_empty() {
            name.insert_from_slice(0, &b" (".map(u16::from));
            name.push(b')'.into());
        }
        StringRef::try_narrowed(Text::Utf16(&name)).unwrap_or_default()
    }
}

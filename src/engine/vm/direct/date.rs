use bun_engine_date::{
    BitField, Component, DateFields, iso_string, make_date, make_date_from_integers, make_day,
    make_full_year, make_time, ms_from_time, time_clip,
};
use bun_engine_macros::direct_form;
use bun_engine_text::StringImpl;

use super::Quiet;
use super::operand::{Original, ToNumber};
use super::outcome::{Flat, Number, OrNan, OrNull, Ranged, Real, Time};
use crate::{Cx, DateInstance, Gc, GlobalObject, JsResult, JsString, Vm};

#[direct_form(writes(CLOCK))]
fn date_now(global: Gc<GlobalObject>) -> Real {
    Real::new(global.date_now())
}

#[direct_form(reads(DATE))]
fn get_time(this: Gc<DateInstance>) -> Time {
    Time::clipped(this.time())
}

#[direct_form(writes(DATE))]
fn set_time(this: Gc<DateInstance>, time: ToNumber) -> Time {
    Time::clipped(this.set_time(time.0))
}

#[direct_form(reads(DATE))]
pub fn get_milliseconds(this: Gc<DateInstance>) -> OrNan<Ranged<0, 999>> {
    let time = Some(this.time()).filter(|time| !time.is_nan());
    time.map(|time| Ranged::new(ms_from_time(time).into()))
        .into()
}

macro_rules! getters {
    ($($local:ident $(, $utc:ident)? = $range:ty, $read:expr;)*) => {$(
        #[direct_form(reads(DATE, TIME_ZONE))]
        pub fn $local(vm: Quiet<'_>, this: Gc<DateInstance>) -> OrNan<$range> {
            let fields = vm.local_fields(&this);
            fields.map($read).map(|it| Ranged::new(it.into())).into()
        }

        $(
            #[direct_form(reads(DATE))]
            pub fn $utc(vm: Quiet<'_>, this: Gc<DateInstance>) -> OrNan<$range> {
                let fields = vm.utc_fields(&this);
                fields.map($read).map(|it| Ranged::new(it.into())).into()
            }
        )?
    )*};
}

const fn highest(field: BitField) -> i32 {
    field.mask() as i32
}

/// Of the magnitude of a signed one.
const fn limit(field: BitField) -> i32 {
    1 << (field.width - 1)
}

const YEARS: i32 = limit(DateFields::YEAR);
const OFFSETS: i32 = limit(DateFields::OFFSET_MINUTES);

getters! {
    get_full_year, get_utc_full_year = Ranged<{ -YEARS }, YEARS>, DateFields::year;
    get_month, get_utc_month = Ranged<0, { highest(DateFields::MONTH) }>, DateFields::month;
    get_date, get_utc_date = Ranged<0, { highest(DateFields::DAY) }>, DateFields::day;
    get_day, get_utc_day = Ranged<0, { highest(DateFields::WEEK_DAY) }>, DateFields::week_day;
    get_hours, get_utc_hours = Ranged<0, { highest(DateFields::HOUR) }>, DateFields::hour;
    get_minutes, get_utc_minutes = Ranged<0, { highest(DateFields::MINUTE) }>, DateFields::minute;
    get_seconds, get_utc_seconds = Ranged<0, { highest(DateFields::SECOND) }>, DateFields::second;
    get_timezone_offset = Ranged<{ -OFFSETS }, OFFSETS>, |it| -it.offset_minutes();
    get_year = Ranged<{ -YEARS - 1900 }, YEARS>, |it| it.year() - 1900;
}

#[derive(Clone, Copy)]
pub enum Clock {
    Local,
    Utc,
}

/// What a setter starts from. It is read before the arguments are converted, which can change the date.
pub struct Setter {
    date: Gc<DateInstance>,
    clock: Clock,
    fields: Option<DateFields>,
    millisecond: u16,
}

impl Setter {
    #[inline(always)]
    pub fn new(vm: Quiet<'_>, date: Gc<DateInstance>, clock: Clock) -> Setter {
        Setter {
            date,
            clock,
            fields: match clock {
                Clock::Local => vm.local_fields(&date),
                Clock::Utc => vm.utc_fields(&date),
            },
            millisecond: ms_from_time(date.time()),
        }
    }

    /// `values` are those of the components from `first` on.
    #[inline(always)]
    pub fn finish(self, vm: Quiet<'_>, first: Component, values: &[f64]) -> Time {
        let fields = match (self.fields, first) {
            (Some(fields), _) => fields,
            (None, Component::Year) => DateFields::EPOCH,
            (None, _) => return Time::clipped(f64::NAN),
        };
        let time = fields.with_components(self.millisecond, first, values);
        let time = match self.clock {
            Clock::Local => vm.utc(time),
            Clock::Utc => time,
        };
        Time::clipped(self.date.set_time(time))
    }
}

#[inline(never)]
fn set(
    vm: Quiet<'_>,
    date: Gc<DateInstance>,
    clock: Clock,
    first: Component,
    values: &[f64],
) -> Time {
    Setter::new(vm, date, clock).finish(vm, first, values)
}

macro_rules! setters {
    ($($local:ident, $utc:ident = $first:ident($($value:ident),*);)*) => {$(
        #[direct_form(reads(TIME_ZONE), writes(DATE))]
        fn $local(vm: Quiet<'_>, this: Gc<DateInstance>, $($value: ToNumber),*) -> Time {
            set(vm, this, Clock::Local, Component::$first, &[$($value.0),*])
        }

        #[direct_form(writes(DATE))]
        fn $utc(vm: Quiet<'_>, this: Gc<DateInstance>, $($value: ToNumber),*) -> Time {
            set(vm, this, Clock::Utc, Component::$first, &[$($value.0),*])
        }
    )*};
}

setters! {
    set_full_year1, set_utc_full_year1 = Year(year);
    set_full_year2, set_utc_full_year2 = Year(year, month);
    set_full_year3, set_utc_full_year3 = Year(year, month, day);
    set_month1, set_utc_month1 = Month(month);
    set_month2, set_utc_month2 = Month(month, day);
    set_date, set_utc_date = Day(day);
    set_hours1, set_utc_hours1 = Hour(hour);
    set_hours2, set_utc_hours2 = Hour(hour, minute);
    set_hours3, set_utc_hours3 = Hour(hour, minute, second);
    set_hours4, set_utc_hours4 = Hour(hour, minute, second, millisecond);
    set_minutes1, set_utc_minutes1 = Minute(minute);
    set_minutes2, set_utc_minutes2 = Minute(minute, second);
    set_minutes3, set_utc_minutes3 = Minute(minute, second, millisecond);
    set_seconds1, set_utc_seconds1 = Second(second);
    set_seconds2, set_utc_seconds2 = Second(second, millisecond);
    set_milliseconds, set_utc_milliseconds = Millisecond(millisecond);
}

#[direct_form(reads(DATE))]
pub fn to_iso_string(cx: &Cx, this: Gc<DateInstance>) -> JsResult<Flat> {
    match iso_string(this.time()) {
        Some(string) => Ok(Flat::new(cx, string)),
        None => Err(cx.throw_range_error("Invalid Date")),
    }
}

/// What `toJSON` comes to if the conversions of the date are pristine.
#[inline]
pub fn iso_string_or_null(vm: &Vm, date: Gc<DateInstance>) -> OrNull<Flat> {
    iso_string(date.time()).map(|it| Flat::new(vm, it)).into()
}

#[direct_form(reads(DATE), needs(DateConversions))]
fn date_to_json(vm: &Vm, this: Original<DateInstance>) -> OrNull<Flat> {
    iso_string_or_null(vm, this.0)
}

#[direct_form(reads(TIME_ZONE))]
fn date_parse_characters(vm: Quiet<'_>, string: &StringImpl) -> Time {
    Time::clipped(vm.parse_date(string.text()))
}

#[direct_form(reads(TIME_ZONE), only_lacks_room)]
fn date_parse_string(cx: &Cx, string: Gc<JsString>) -> JsResult<Number> {
    Ok(cx.date_cache().parse(string.view(cx)?.text()).into())
}

#[inline(always)]
fn create(cx: &Cx, time: f64) -> Gc<DateInstance> {
    DateInstance::create(cx, cx.date_shape(), time)
}

#[direct_form(writes(CLOCK), makes(date_shape), gives_new)]
fn new_date_now(cx: &Cx) -> Gc<DateInstance> {
    create(cx, cx.global().date_now())
}

#[direct_form(pure, makes(date_shape), gives_new)]
fn new_date_at(cx: &Cx, time: ToNumber) -> Gc<DateInstance> {
    create(cx, time.0)
}

#[direct_form(reads(DATE), makes(date_shape), gives_new)]
fn new_date_like(cx: &Cx, other: Gc<DateInstance>) -> Gc<DateInstance> {
    create(cx, other.time())
}

#[direct_form(reads(TIME_ZONE), only_lacks_room, makes(date_shape), gives_new)]
fn new_date_parsed(cx: &Cx, string: Gc<JsString>) -> JsResult<Gc<DateInstance>> {
    Ok(create(cx, cx.date_cache().parse(string.view(cx)?.text())))
}

/// What the constructor and `Date.UTC` take for arguments that are missing.
pub const DEFAULT_NUMBERS: [f64; 7] = [f64::NAN, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
/// The same, but for the year.
pub const DEFAULT_INTEGERS: [i32; 7] = [0, 0, 1, 0, 0, 0, 0];

/// On the clock that the components are read from.
#[inline(never)]
pub fn time_from_numbers(components: &[f64; 7]) -> f64 {
    let [year, month, day, hour, minute, second, millisecond] = *components;
    make_date(
        make_day(make_full_year(year), month, day),
        make_time(hour, minute, second, millisecond),
    )
}

#[inline(always)]
pub fn time_from_integers(components: &[i32; 7]) -> f64 {
    let mut components = *components;
    if (0..=99).contains(&components[0]) {
        components[0] += 1900;
    }
    make_date_from_integers(components)
}

#[inline(always)]
fn completed<T: Copy, const COUNT: usize>(first: [T; COUNT], mut defaults: [T; 7]) -> [T; 7] {
    defaults[..COUNT].copy_from_slice(&first);
    defaults
}

#[inline(never)]
fn create_at_local_time(cx: &Cx, local_time: f64) -> Gc<DateInstance> {
    create(cx, cx.date_cache().utc(local_time))
}

macro_rules! from_numbers {
    ($($new:ident, $utc:ident($($part:ident),*);)*) => {$(
        #[direct_form(reads(TIME_ZONE), makes(date_shape), gives_new)]
        fn $new(cx: &Cx, $($part: ToNumber),*) -> Gc<DateInstance> {
            create_at_local_time(cx, time_from_numbers(&completed([$($part.0),*], DEFAULT_NUMBERS)))
        }

        #[direct_form(pure)]
        fn $utc($($part: ToNumber),*) -> Time {
            Time::clipped(time_clip(time_from_numbers(&completed([$($part.0),*], DEFAULT_NUMBERS))))
        }
    )*};
}

from_numbers! {
    new_date2, utc2(year, month);
    new_date3, utc3(year, month, day);
    new_date4, utc4(year, month, day, hour);
    new_date5, utc5(year, month, day, hour, minute);
    new_date6, utc6(year, month, day, hour, minute, second);
    new_date7, utc7(year, month, day, hour, minute, second, millisecond);
}

/// As far as there are registers.
macro_rules! from_integers {
    ($(new $new:ident($($part:ident),*);)* $(utc $utc:ident($($utc_part:ident),*);)*) => {
        $(
            #[direct_form(reads(TIME_ZONE), makes(date_shape), gives_new)]
            fn $new(cx: &Cx, $($part: i32),*) -> Gc<DateInstance> {
                create_at_local_time(cx, time_from_integers(&completed([$($part),*], DEFAULT_INTEGERS)))
            }
        )*
        $(
            #[direct_form(pure)]
            fn $utc($($utc_part: i32),*) -> Time {
                let time = time_from_integers(&completed([$($utc_part),*], DEFAULT_INTEGERS));
                Time::clipped(time_clip(time))
            }
        )*
    };
}

from_integers! {
    new new_date_of_int32s2(year, month);
    new new_date_of_int32s3(year, month, day);
    new new_date_of_int32s4(year, month, day, hour);
    new new_date_of_int32s5(year, month, day, hour, minute);
    utc utc_of_int32s2(year, month);
    utc utc_of_int32s3(year, month, day);
    utc utc_of_int32s4(year, month, day, hour);
    utc utc_of_int32s5(year, month, day, hour, minute);
    utc utc_of_int32s6(year, month, day, hour, minute, second);
}

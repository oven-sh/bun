//! ECMA-262, 21.4.1.32. Beyond it, a fraction can have any number of digits, an offset can lack its colon, and every month
//! has 31 days.

use bun_engine_text::CodeUnit;

use super::Parsed;
use super::cursor::Cursor;
use crate::civil::days_from_civil;
use crate::time_value::DAY;

pub(super) enum Attempt {
    Complete(Parsed),
    Invalid,
    /// The text goes on in another format after these numbers.
    Unfinished {
        numbers: [i32; 3],
        count: usize,
    },
}

#[inline(always)]
pub(super) fn parse<T: CodeUnit>(cursor: &mut Cursor<'_, T>) -> Attempt {
    if let Some(time) = cursor.peek_chunk().and_then(usual_date_and_time) {
        cursor.advance(USUAL_LENGTH);
        return fraction(cursor, i32::MAX)
            .and_then(|millisecond| zone(cursor, time + i64::from(millisecond)))
            .map_or(Attempt::Invalid, Attempt::Complete);
    }

    let mut numbers = [1; 3];
    let unfinished = |numbers, count| Attempt::Unfinished { numbers, count };

    let year = match cursor.sign() {
        None => cursor.fixed::<4>(0, 9999),
        Some(sign) => (cursor.fixed::<6>(0, 999_999))
            .filter(|&year| sign > 0 || year > 0)
            .map(|year| sign * year),
    };
    let Some(year) = year else {
        return unfinished(numbers, 0);
    };
    numbers[0] = year;
    let mut count = 1;
    for max in [12, 31] {
        if !cursor.skip(b'-') {
            break;
        }
        let Some(number) = cursor.fixed::<2>(1, max) else {
            return unfinished(numbers, count);
        };
        numbers[count] = number;
        count += 1;
    }

    let midnight = days_from_civil(year, numbers[1] as u8, numbers[2] as u8) * DAY;
    if cursor.is_at_end() {
        return Attempt::Complete(Parsed::Utc(midnight));
    }
    if !cursor.skip(b'T') && !cursor.skip(b't') {
        return unfinished(numbers, count);
    }
    time_of_day(cursor)
        .and_then(|time| zone(cursor, midnight + i64::from(time)))
        .map_or(Attempt::Invalid, Attempt::Complete)
}

const USUAL_LENGTH: usize = "2022-02-01T13:05:09".len();

/// Eight characters at a time.
#[inline(always)]
fn usual_date_and_time<T: CodeUnit>(units: &[T; USUAL_LENGTH]) -> Option<i64> {
    // In the place of each digit, ten times its value and that of the next character.
    let pairs = |start: usize, least: &[u8; 8], most: &[u8; 8]| {
        let bytes = core::array::from_fn(|index| units[start + index].to_u16().min(0xff) as u8);
        let [bytes, least, most] = [bytes, *least, *most].map(u64::from_le_bytes);
        let digits = bytes ^ least;
        let room = 0x7f7f_7f7f_7f7f_7f7f - (most ^ least);
        let is_match = (digits.wrapping_add(room) | digits) & 0x8080_8080_8080_8080 == 0;
        is_match.then(|| (digits * 10 + (digits >> 8)).to_le_bytes())
    };
    let [century, _, year, _, _, month @ 1..=12, ..] = pairs(0, b"0000-00-", b"9999-19-")? else {
        return None;
    };
    let [day @ 1..=31, ..] = pairs(8, b"00T00:00", b"39T29:59")? else {
        return None;
    };
    let [hour @ 0..=23, _, _, minute, _, _, second, _] = pairs(11, b"00:00:00", b"29:59:59")?
    else {
        return None;
    };
    let days = days_from_civil(i32::from(century) * 100 + i32::from(year), month, day);
    let seconds = (i64::from(hour) * 60 + i64::from(minute)) * 60 + i64::from(second);
    Some(days * DAY + seconds * 1000)
}

/// In milliseconds.
#[inline(always)]
fn time_of_day<T: CodeUnit>(cursor: &mut Cursor<'_, T>) -> Option<i32> {
    let hour = cursor.fixed::<2>(0, 24)?;
    let (max, max_fraction) = if hour == 24 { (0, 0) } else { (59, i32::MAX) };
    cursor.skip(b':').then_some(())?;
    let minute = cursor.fixed::<2>(0, max)?;
    let (mut second, mut millisecond) = (0, 0);
    if cursor.skip(b':') {
        second = cursor.fixed::<2>(0, max)?;
        millisecond = fraction(cursor, max_fraction)?;
    }
    Some(((hour * 60 + minute) * 60 + second) * 1000 + millisecond)
}

/// In milliseconds. Zero if there is none.
#[inline(always)]
fn fraction<T: CodeUnit>(cursor: &mut Cursor<'_, T>, max_digits: i32) -> Option<i32> {
    if !cursor.skip(b'.') {
        return Some(0);
    }
    let digits = cursor.number().filter(|it| it.value <= max_digits)?;
    Some(digits.milliseconds())
}

/// Through the end of the text.
#[inline(always)]
fn zone<T: CodeUnit>(cursor: &mut Cursor<'_, T>, time: i64) -> Option<Parsed> {
    let parsed = if cursor.skip(b'Z') || cursor.skip(b'z') {
        Parsed::Utc(time)
    } else if let Some(sign) = cursor.sign() {
        Parsed::Utc(time - i64::from(sign * offset_minutes(cursor)? * 60_000))
    } else {
        Parsed::Local(time)
    };
    cursor.is_at_end().then_some(parsed)
}

#[inline(always)]
fn offset_minutes<T: CodeUnit>(cursor: &mut Cursor<'_, T>) -> Option<i32> {
    if let Some(both) = cursor.fixed::<4>(0, 2359) {
        return (both % 100 < 60).then_some(both / 100 * 60 + both % 100);
    }
    let hours = cursor.fixed::<2>(0, 23)?;
    cursor.skip(b':').then_some(())?;
    Some(hours * 60 + cursor.fixed::<2>(0, 59)?)
}

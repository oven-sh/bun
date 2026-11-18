use bun_engine_text::{CodeUnit, Text, with_text};

use super::cursor::Cursor;
use crate::unit::NANOSECONDS_PER_SECOND;
use crate::{PlainTime, Unit};

type Fields = [f64; Unit::ALL.len()];

/// ParseTemporalDurationString, without the check of the range. `fields` are zero.
pub(crate) fn duration(text: Text<'_>, fields: &mut Fields) -> Option<()> {
    with_text!(text, |units| Cursor::parse_all(units, |cursor| {
        cursor.duration(fields)
    }))
}

impl<T: CodeUnit> Cursor<'_, T> {
    /// Saturates above the greatest count that a duration can have.
    #[inline]
    fn count(&mut self) -> i64 {
        const LIMIT: i64 = 1 << 59;
        let digits = self.take_while(|next| next.is_ascii_digit());
        digits.iter().fold(0, |count, digit| {
            (count * 10 + i64::from(digit.to_u32() & 0xf)).min(LIMIT)
        })
    }

    fn duration(&mut self, fields: &mut Fields) -> Option<()> {
        let sign = self.sign().unwrap_or(1);
        if !self.eat_letter(b'P') {
            return None;
        }
        let has_date = self.duration_date(sign, fields)?;
        if self.eat_letter(b'T') {
            return self.duration_time(sign, fields);
        }
        has_date.then_some(())
    }

    fn duration_date(&mut self, sign: i8, fields: &mut Fields) -> Option<bool> {
        let mut previous = None;
        while self.peek().is_ascii_digit() {
            let count = self.count();
            let unit = match self.next()?.to_ascii_uppercase() {
                b'Y' => Unit::Year,
                b'M' => Unit::Month,
                b'W' => Unit::Week,
                b'D' => Unit::Day,
                _ => return None,
            };
            if previous.is_some_and(|previous| unit >= previous) {
                return None;
            }
            fields[unit as usize] = (count * i64::from(sign)) as f64;
            previous = Some(unit);
        }
        Some(previous.is_some())
    }

    fn duration_time(&mut self, sign: i8, fields: &mut Fields) -> Option<()> {
        let mut previous = Unit::Day;
        while self.peek().is_ascii_digit() {
            let count = self.count();
            let fraction = self.fraction()?;
            let unit = match self.next()?.to_ascii_uppercase() {
                b'H' => Unit::Hour,
                b'M' => Unit::Minute,
                b'S' => Unit::Second,
                _ => return None,
            };
            if unit >= previous {
                return None;
            }
            fields[unit as usize] = (count * i64::from(sign)) as f64;
            previous = unit;
            if let Some(fraction) = fraction {
                spread_fraction(fraction, unit, sign, fields);
                break;
            }
        }
        (previous != Unit::Day).then_some(())
    }
}

/// Over the units below `unit`.
fn spread_fraction(fraction: u32, unit: Unit, sign: i8, fields: &mut Fields) {
    let nanoseconds = i64::from(fraction) * (unit.nanoseconds() / NANOSECONDS_PER_SECOND);
    let [_, parts @ ..] = PlainTime::from_nanosecond_of_day(nanoseconds).fields();
    for (field, part) in fields[Unit::Minute as usize..].iter_mut().zip(parts) {
        *field += f64::from(part * i32::from(sign));
    }
}

//! The formats of RFC 822, RFC 850 and RFC 1123, and variations that servers send.

use crate::civil::days_from_civil;
use crate::time_value::TIME_VALUES;
use crate::zone::system_time_zone;

const MONTHS: [&[u8; 3]; 12] = [
    b"jan", b"feb", b"mar", b"apr", b"may", b"jun", b"jul", b"aug", b"sep", b"oct", b"nov", b"dec",
];

/// With the hours that they are behind UTC.
const ZONES: [(&[u8], i32); 10] = [
    (b"ut", 0),
    (b"gmt", 0),
    (b"est", 5),
    (b"edt", 4),
    (b"cst", 6),
    (b"cdt", 5),
    (b"mst", 7),
    (b"mdt", 6),
    (b"pst", 8),
    (b"pdt", 7),
];

fn is_space(byte: u8) -> bool {
    matches!(byte, b'\t'..=b'\r' | b' ')
}

/// From 1.
fn month_at_start(text: &[u8]) -> Option<i64> {
    let prefix = text.first_chunk::<3>()?.map(|it| it.to_ascii_lowercase());
    let index = MONTHS.iter().position(|&&month| month == prefix)?;
    Some(index as i64 + 1)
}

#[derive(Clone, Copy)]
struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn peek(self) -> Option<u8> {
        self.0.first().copied()
    }

    fn advance(&mut self) {
        self.0 = self.0.get(1..).unwrap_or_default();
    }

    fn skip(&mut self, byte: u8) -> bool {
        let is_next = self.peek() == Some(byte);
        if is_next {
            self.advance();
        }
        is_next
    }

    fn skip_while(&mut self, predicate: impl Fn(u8) -> bool) {
        while self.peek().is_some_and(&predicate) {
            self.advance();
        }
    }

    fn skip_letters(&mut self, letters: &[u8]) -> bool {
        match self.0.split_at_checked(letters.len()) {
            Some((start, rest)) if start.eq_ignore_ascii_case(letters) => {
                self.0 = rest;
                true
            }
            _ => false,
        }
    }

    fn skip_spaces_and_comments(&mut self) {
        let mut depth = 0usize;
        while let Some(byte) = self.peek() {
            match byte {
                b'(' => depth += 1,
                b')' if depth > 0 => depth -= 1,
                _ if depth == 0 && !is_space(byte) => return,
                _ => {}
            }
            self.advance();
        }
    }

    /// After spaces, a plus and a minus, each if it is there. Nothing is consumed unless the number is strictly inside the
    /// range of `i32`.
    #[inline(never)]
    fn integer(&mut self) -> Option<i32> {
        let mut reader = *self;
        reader.skip_while(is_space);
        reader.skip(b'+');
        let sign = if reader.skip(b'-') { -1 } else { 1 };
        reader.peek().filter(u8::is_ascii_digit)?;
        let mut value = 0i32;
        while let Some(digit) = reader.peek().filter(u8::is_ascii_digit) {
            value = value
                .checked_mul(10)?
                .checked_add(i32::from(digit - b'0'))?;
            reader.advance();
        }
        let value = Some(sign * value).filter(|&value| value != i32::MAX)?;
        *self = reader;
        Some(value)
    }

    fn integer_up_to(&mut self, max: i32) -> Option<i32> {
        self.integer().filter(|value| (0..=max).contains(value))
    }

    /// Passes over everything before the first digit. The last word of three characters or more can name the month.
    fn leading_month(&mut self) -> Option<i64> {
        let mut month = None;
        self.skip_spaces_and_comments();
        let mut word = self.0;
        while let Some(byte) = self.peek().filter(|byte| !byte.is_ascii_digit()) {
            if is_space(byte) || byte == b'(' {
                if word.len() - self.0.len() >= 3 {
                    month = month_at_start(word);
                }
                self.skip_spaces_and_comments();
                word = self.0;
            } else {
                self.advance();
            }
        }
        month.or_else(|| month_at_start(word))
    }

    /// The year if it comes first, the month and the day.
    fn date(&mut self) -> Option<(Option<i32>, i64, i32)> {
        let named_month = self.leading_month();
        let first = self.integer()?;
        if first > 31 {
            self.skip(b'/').then_some(())?;
            let month = self.integer()?;
            self.skip(b'/').then_some(())?;
            return Some((Some(first), month.into(), self.integer()?));
        }
        if named_month.is_none() && self.skip(b'/') {
            let day = self.integer()?;
            self.skip(b'/');
            self.peek()?;
            return Some((None, first.into(), day));
        }
        self.skip(b'-');
        self.skip_spaces_and_comments();
        self.skip(b',');
        if let Some(month) = named_month {
            return Some((None, month, first));
        }
        let month = month_at_start(self.0)?;
        self.skip_while(|byte| byte != b'-' && byte != b',' && !is_space(byte));
        self.peek()?;
        self.advance();
        Some((None, month, first))
    }

    /// The seconds since midnight, from what follows the hour.
    fn clock(&mut self, mut hour: i32) -> Option<i32> {
        ((0..=23).contains(&hour) && self.skip(b':')).then_some(())?;
        let minute = self.integer_up_to(59)?;
        let second = if self.skip(b':') {
            self.integer_up_to(59)?
        } else if self.peek().is_none_or(is_space) {
            0
        } else {
            return None;
        };
        self.skip_spaces_and_comments();
        for (letters, half) in [(b"am", 0), (b"pm", 12)] {
            if self.skip_letters(letters) {
                hour = (hour <= 12).then_some(hour % 12 + half)?;
                self.skip_spaces_and_comments();
                break;
            }
        }
        Some((hour * 60 + minute) * 60 + second)
    }

    /// The minutes ahead of UTC, modulo 2^32, from the sign on.
    fn numeric_offset(&mut self) -> Option<i32> {
        let number = self.integer().filter(|it| it.abs() <= 9959)?;
        let (sign, number) = (if number < 0 { -1 } else { 1 }, number.abs());
        let minutes = if self.skip(b':') {
            self.integer()?.wrapping_add(number * 60)
        } else if number >= 24 {
            number / 100 * 60 + number % 100
        } else {
            number * 60
        };
        Some(minutes.wrapping_mul(sign))
    }
}

/// The value of an `Expires` attribute, in milliseconds since the epoch. If it names no zone it is in that of the process.
pub fn parse_cookie_date(text: &[u8]) -> Option<i64> {
    let mut reader = Reader(text);
    let (mut year, month, day) = reader.date()?;

    let mut after_year = reader;
    if year.is_none() && reader.peek().is_some() {
        year = Some(after_year.integer()?);
    }
    let mut seconds = 0;
    match after_year.peek() {
        None => reader = after_year,
        Some(separator) => {
            if separator == b':' {
                // That was the hour.
                year = None;
            } else if is_space(separator) || separator == b',' {
                reader = after_year;
                reader.advance();
                if separator != b',' {
                    reader.skip_letters(b"at");
                }
                reader.skip_spaces_and_comments();
            } else {
                return None;
            }
            if let Some(hour) = reader.integer() {
                seconds = reader.clock(hour)?;
            }
        }
    }

    if year.is_none() && reader.peek().is_some_and(|it| it.is_ascii_digit()) {
        year = Some(reader.integer()?);
        reader.skip_spaces_and_comments();
    }
    let mut offset = (reader.skip_letters(b"gmt") || reader.skip_letters(b"utc")).then_some(0);
    if matches!(reader.peek(), Some(b'+' | b'-')) {
        offset = Some(reader.numeric_offset()?);
    } else if let Some((_, hours)) = ZONES.iter().find(|(name, _)| reader.skip_letters(name)) {
        offset = Some(-60 * hours);
    }
    reader.skip_spaces_and_comments();
    if year.is_none() && reader.peek().is_some() {
        year = Some(reader.integer()?);
        reader.skip_spaces_and_comments();
    }

    if reader.peek().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let year = match year.unwrap_or(2000) {
        year @ 0..=49 => year + 2000,
        year @ 50..=99 => year + 1900,
        year => year,
    };
    let time = days_from_civil(year, month as u8, day as u8) * 86_400 + i64::from(seconds);
    if !TIME_VALUES.contains(&time.saturating_mul(1000)) {
        return None;
    }
    let offset = match offset {
        Some(minutes) => i64::from(minutes) * 60,
        None => i64::from(system_time_zone().rules().offsets_at_local(time).before),
    };
    Some((time - offset) * 1000)
}

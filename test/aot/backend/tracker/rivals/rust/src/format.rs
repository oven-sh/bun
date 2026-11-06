use crate::types::Timestamp;

const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

struct Civil {
    year: i64,
    month: usize,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    millisecond: u32,
}

/// The date and the time of day in UTC.
fn civil(moment: Timestamp) -> Civil {
    let milliseconds = moment.0.div_euclid(1000);
    let (days, rest) = (milliseconds.div_euclid(86_400_000), milliseconds.rem_euclid(86_400_000) as u32);
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let month = if shifted_month < 10 { shifted_month + 3 } else { shifted_month - 9 };
    Civil {
        year: year_of_era + era * 400 + i64::from(month <= 2),
        month: month as usize,
        day: (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32,
        hour: rest / 3_600_000,
        minute: rest / 60_000 % 60,
        second: rest / 1000 % 60,
        millisecond: rest % 1000,
    }
}

pub fn push_int<N: itoa::Integer>(out: &mut String, n: N) {
    out.push_str(itoa::Buffer::new().format(n));
}

fn push_padded(out: &mut String, n: u32, width: usize) {
    let mut buffer = itoa::Buffer::new();
    let digits = buffer.format(n);
    for _ in digits.len()..width {
        out.push('0');
    }
    out.push_str(digits);
}

/// 2026-10-16T13:45:00.000Z
pub fn push_iso(out: &mut String, moment: Timestamp) {
    let c = civil(moment);
    push_padded(out, c.year as u32, 4);
    out.push('-');
    push_padded(out, c.month as u32, 2);
    out.push('-');
    push_padded(out, c.day, 2);
    out.push('T');
    push_padded(out, c.hour, 2);
    out.push(':');
    push_padded(out, c.minute, 2);
    out.push(':');
    push_padded(out, c.second, 2);
    out.push('.');
    push_padded(out, c.millisecond, 3);
    out.push('Z');
}

fn push_date(out: &mut String, c: &Civil) {
    out.push_str(MONTHS[c.month - 1]);
    out.push(' ');
    push_int(out, c.day);
    out.push_str(", ");
    push_int(out, c.year);
}

/// Oct 16, 2026
pub fn push_day(out: &mut String, moment: Timestamp) {
    push_date(out, &civil(moment));
}

/// Oct 16, 2026, 13:45
pub fn push_minute(out: &mut String, moment: Timestamp) {
    let c = civil(moment);
    push_date(out, &c);
    out.push_str(", ");
    push_padded(out, c.hour, 2);
    out.push(':');
    push_padded(out, c.minute, 2);
}

/// 1,234,567
pub fn push_number(out: &mut String, n: usize) {
    let mut buffer = itoa::Buffer::new();
    let digits = buffer.format(n);
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
}

/// 1 comment, 2 comments, 1,234 comments
pub fn push_count(out: &mut String, n: usize, singular: &str) {
    push_number(out, n);
    out.push(' ');
    out.push_str(singular);
    if n != 1 {
        out.push('s');
    }
}

pub fn push_time_tag(out: &mut String, moment: Timestamp, text: fn(&mut String, Timestamp)) {
    out.push_str("<time datetime=\"");
    push_iso(out, moment);
    out.push_str("\">");
    text(out, moment);
    out.push_str("</time>");
}

pub fn escape(out: &mut String, text: &str) {
    let mut from = 0;
    for (i, byte) in text.bytes().enumerate() {
        let entity = match byte {
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'"' => "&quot;",
            b'\'' => "&#x27;",
            _ => continue,
        };
        out.push_str(&text[from..i]);
        out.push_str(entity);
        from = i + 1;
    }
    out.push_str(&text[from..]);
}

pub fn wrapped(out: &mut String, open: &str, text: &str, close: &str) {
    out.push_str(open);
    escape(out, text);
    out.push_str(close);
}

/// -1,234
pub fn push_signed_number(out: &mut String, n: i64) {
    if n < 0 {
        out.push('-');
    }
    push_number(out, n.unsigned_abs() as usize);
}

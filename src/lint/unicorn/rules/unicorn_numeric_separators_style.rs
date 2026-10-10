use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces a convention of grouping digits using numeric separators.
pub struct NumericSeparatorsStyle {
    only_if_contains_separator: bool,
    hexadecimal: NumericBaseConfig,
    binary: NumericBaseConfig,
    octal: NumericBaseConfig,
    number: NumericBaseConfig,
    fraction_group_length: usize,
}

const NUMERIC_SEPARATORS_STYLE: Message = Message::new("", "Invalid group length in numeric value.");

struct NumericBaseConfig {
    only_if_contains_separator: Option<bool>,
    group_length: usize,
    minimum_digits: usize,
}

impl NumericBaseConfig {
    fn new(options: Object, group_length: usize, minimum_digits: usize) -> Self {
        let integer = |key: &str| options.number(key).filter(|it| it.fract() == 0.0).and_then(|_| options.usize(key));
        NumericBaseConfig {
            only_if_contains_separator: options.bool("onlyIfContainsSeparator"),
            group_length: integer("groupLength").unwrap_or(group_length),
            minimum_digits: integer("minimumDigits").unwrap_or(minimum_digits),
        }
    }

    /// Adds the digits of `part` to `out`, in groups of `length`, which are counted from the right, or `from_left`.
    fn add_separators(&self, out: &mut Vec<u8>, part: &[u8], length: usize, from_left: bool) {
        let count = part.len() - strings::count_char(part, b'_');
        // oxlint does not come to an end with groups of no digits.
        let is_grouped = length != 0 && count >= self.minimum_digits && count > length;
        for (i, digit) in part.iter().filter(|it| **it != b'_').enumerate() {
            if is_grouped && i != 0 && (if from_left { i } else { count - i }) % length == 0 {
                out.push(b'_');
            }
            out.push(*digit);
        }
    }
}

impl NumericSeparatorsStyle {
    /// `raw`: without the `n` of a `BigInt`. `None`: nothing is said about numbers of this kind without a separator.
    fn format(&self, raw: &[u8]) -> Option<Vec<u8>> {
        let (prefix, digits, config) = match raw {
            [b'0', b'b' | b'B', digits @ ..] => (raw.get(..2)?, digits, &self.binary),
            [b'0', b'x' | b'X', digits @ ..] => (raw.get(..2)?, digits, &self.hexadecimal),
            [b'0', b'o' | b'O', digits @ ..] => (raw.get(..2)?, digits, &self.octal),
            // `010`, which cannot have separators.
            [b'0', digits @ ..] if !digits.is_empty() && digits.iter().all(|it| matches!(it, b'0'..=b'7')) => {
                return None;
            }
            _ => (&b""[..], raw, &self.number),
        };
        if !strings::contains_char(raw, b'_')
            && config.only_if_contains_separator.unwrap_or(self.only_if_contains_separator)
        {
            return None;
        }
        let mut out = Vec::with_capacity(raw.len() + raw.len() / 2);
        out.extend_from_slice(prefix);
        if !prefix.is_empty() {
            config.add_separators(&mut out, digits, config.group_length, false);
            return Some(out);
        }

        let (mantissa, exponent) = match strings::index_of_any(raw, b"eE") {
            Some(at) => (raw.get(..at)?, raw.get(at..)),
            None => (raw, None),
        };
        let (integer_part, decimal_part) = strings::split_once_char(mantissa, b'.').unwrap_or((mantissa, b""));
        config.add_separators(&mut out, integer_part, config.group_length, false);
        // The `.` of `1.e2` is dropped, as in oxlint. That of `1.` stays, for `1..toString()`.
        if !decimal_part.is_empty() || raw.ends_with(b".") {
            out.push(b'.');
            config.add_separators(&mut out, decimal_part, self.fraction_group_length, true);
        }
        if let Some([mark, exponent @ ..]) = exponent {
            out.push(*mark);
            let exponent_part = match exponent {
                [sign @ (b'+' | b'-'), rest @ ..] => {
                    out.push(*sign);
                    rest
                }
                _ => exponent,
            };
            config.add_separators(&mut out, exponent_part, config.group_length, false);
        }
        Some(out)
    }
}

impl Rule for NumericSeparatorsStyle {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "numeric-separators-style", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let number = options.object("number");
        let fraction_group_length = number.number("fractionGroupLength").filter(|it| it.fract() == 0.0);
        NumericSeparatorsStyle {
            only_if_contains_separator: options.bool_or("onlyIfContainsSeparator", false),
            hexadecimal: NumericBaseConfig::new(options.object("hexadecimal"), 2, 0),
            binary: NumericBaseConfig::new(options.object("binary"), 4, 0),
            octal: NumericBaseConfig::new(options.object("octal"), 4, 0),
            fraction_group_length: fraction_group_length.and_then(|_| number.usize("fractionGroupLength")).unwrap_or(usize::MAX),
            number: NumericBaseConfig::new(number, 3, 5),
        }
    }

    fn number_literal<'a>(&self, number: Literal<'a>, cx: &mut Cx<'a, Self>) {
        let raw = number.text();
        // Most numbers are a few digits.
        let is_short = raw.len() <= self.number.group_length || raw.len() < self.number.minimum_digits;
        if is_short && raw.iter().all(u8::is_ascii_digit) {
            return;
        }
        let digits = raw.strip_suffix(b"n").unwrap_or(raw);
        let Some(mut formatted) = self.format(digits) else {
            return;
        };
        if formatted != digits {
            formatted.extend_from_slice(raw.get(digits.len()..).unwrap_or_default());
            cx.report(number, NUMERIC_SEPARATORS_STYLE).fix(|fixer| fixer.replace(number, formatted));
        }
    }
}

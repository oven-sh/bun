//! Parses number skeletons such as "currency/EUR .00 compact-short". ICU4C: number_skeletons.cpp

use crate::common::cstring::split_once;
use crate::common::locid::Locale;
use crate::common::slice_ext::SliceExt;
use crate::common::utypes::*;
use crate::i18n::measunit::MeasureUnit;
use crate::i18n::number_decimalquantity::RoundingMode;
use crate::i18n::number_fluent::{MacroProps, Notation, SignDisplay, UnitWidth};
use crate::i18n::number_grouping::Grouper;
use crate::i18n::number_rounding::{Digits, Rounding};
use crate::i18n::number_scientific::ScientificHandler;
use bun_core::strings;

/// Keeps every count of digits far below the limit of `Digits`.
const MAX_LENGTH: usize = 400;

/// Parses a run of `required` and a run of '#', as in "00##" and "@@#". Also returns the rest of `text`.
fn parse_digits(text: &[u8], required: u8) -> (Digits, &[u8]) {
    let (min, text) = text.split_while(|&c| c == required);
    let (optional, text) = text.split_while(|&c| c == b'#');
    (Digits::new(min.len(), min.len() + optional.len()), text)
}

/// Parses "0.05" and "50.", but not "0.01".
fn parse_increment(text: &[u8]) -> Option<Rounding> {
    let (integer, Some(fraction)) = split_once(text, b'.') else {
        return None;
    };
    let mantissa = integer.iter().chain(fraction).try_fold(0u16, |sum, &c| {
        sum.checked_mul(10)?
            .checked_add(char::from(c).to_digit(10)? as u16)
    })?;
    (mantissa > 1).then_some(Rounding::Increment {
        mantissa,
        fraction_digits: fraction.len() as i16,
    })
}

/// Parses ".00#", "@@#", ".00#/@@#r", ".00#/@@#s" and "precision-increment/0.05".
fn parse_precision(stem: &[u8], option: Option<&[u8]>) -> Option<Rounding> {
    match (stem, option) {
        (b"precision-increment", Some(increment)) => parse_increment(increment),
        ([b'@', ..], None) => match parse_digits(stem, b'@') {
            (digits, []) => Some(Rounding::Significant(digits)),
            _ => None,
        },
        ([b'.', digits @ ..], _) => match (
            parse_digits(digits, b'0'),
            option.map(|option| parse_digits(option, b'@')),
        ) {
            ((fraction, []), None) => Some(Rounding::Fraction(fraction)),
            ((fraction, []), Some((significant, &[priority @ (b'r' | b's')])))
                if significant.min > 0 =>
            {
                Some(Rounding::FractionSignificant {
                    fraction,
                    significant,
                    relaxed: priority == b'r',
                })
            }
            _ => None,
        },
        _ => None,
    }
}

/// What a token sets. No two tokens may set the same.
#[derive(Clone, Copy)]
enum Setting {
    Unit,
    Scale,
    Width,
    Mode,
    Integer,
    Precision,
    Notation,
    Sign,
    Group,
}

fn parse_unit(stem: &[u8], option: Option<&[u8]>) -> Option<MeasureUnit> {
    match (stem, option) {
        (b"percent", None) => Some(MeasureUnit::PERCENT),
        (b"unit", Some(unit)) => MeasureUnit::for_identifier(unit),
        (b"measure-unit", Some(unit)) => MeasureUnit::duration(unit.strip_prefix(b"duration-")?),
        (b"currency", Some(&[a, b, c])) if [a, b, c].iter().all(u8::is_ascii_uppercase) => {
            Some(MeasureUnit::Currency([a, b, c].map(u16::from)))
        }
        _ => None,
    }
}

fn parse_token(token: &[u8], macros: &mut MacroProps) -> Option<Setting> {
    if let Some(mode) = token.strip_prefix(b"rounding-mode-") {
        macros.rounder.mode = match mode {
            b"ceiling" => RoundingMode::Ceiling,
            b"floor" => RoundingMode::Floor,
            b"down" => RoundingMode::Down,
            b"up" => RoundingMode::Up,
            b"half-even" => RoundingMode::HalfEven,
            b"half-ceiling" => RoundingMode::HalfCeiling,
            b"half-floor" => RoundingMode::HalfFloor,
            b"half-down" => RoundingMode::HalfDown,
            b"half-up" => RoundingMode::HalfUp,
            _ => return None,
        };
        return Some(Setting::Mode);
    }
    if let Some(zeros) = token.strip_prefix(b"integer-width/*") {
        let (zeros @ [_, ..], []) = zeros.split_while(|&c| c == b'0') else {
            return None;
        };
        macros.min_integer_digits = zeros.len() as i32;
        return Some(Setting::Integer);
    }
    if let Some(sign) = token.strip_prefix(b"sign-") {
        (macros.sign, macros.is_accounting) = match sign {
            b"auto" => (SignDisplay::Auto, false),
            b"always" => (SignDisplay::Always, false),
            b"never" => (SignDisplay::Never, false),
            b"except-zero" => (SignDisplay::ExceptZero, false),
            b"negative" => (SignDisplay::Negative, false),
            b"accounting" => (SignDisplay::Auto, true),
            b"accounting-always" => (SignDisplay::Always, true),
            b"accounting-except-zero" => (SignDisplay::ExceptZero, true),
            b"accounting-negative" => (SignDisplay::Negative, true),
            _ => return None,
        };
        return Some(Setting::Sign);
    }
    if let Some(strategy) = token.strip_prefix(b"group-") {
        macros.grouper = match strategy {
            b"off" => Grouper::Off,
            b"min2" => Grouper::Min2,
            b"auto" => Grouper::Auto,
            b"on-aligned" => Grouper::OnAligned,
            _ => return None,
        };
        return Some(Setting::Group);
    }
    if let Some(width) = token.strip_prefix(b"unit-width-") {
        macros.unit_width = match width {
            b"narrow" => UnitWidth::Narrow,
            b"short" => UnitWidth::Short,
            b"full-name" => UnitWidth::FullName,
            b"iso-code" => UnitWidth::IsoCode,
            b"formal" => UnitWidth::Formal,
            b"hidden" => UnitWidth::Hidden,
            _ => return None,
        };
        return Some(Setting::Width);
    }
    macros.notation = match token {
        b"compact-short" => Notation::Compact { is_long: false },
        b"compact-long" => Notation::Compact { is_long: true },
        b"scientific" => Notation::Scientific(ScientificHandler::Scientific),
        b"engineering" => Notation::Scientific(ScientificHandler::Engineering),
        b"scale/100" => {
            macros.scale = 2;
            return Some(Setting::Scale);
        }
        [b'.' | b'@', ..] | [b'p', b'r', ..] => {
            let precision = token.strip_suffix(b"/w");
            let (stem, option) = split_once(precision.unwrap_or(token), b'/');
            macros.rounder.rounding = Some(parse_precision(stem, option)?);
            macros.rounder.hide_zeros_if_whole = precision.is_some();
            return Some(Setting::Precision);
        }
        _ => {
            let (stem, option) = split_once(token, b'/');
            macros.unit = parse_unit(stem, option)?;
            return Some(Setting::Unit);
        }
    };
    Some(Setting::Notation)
}

fn parse_tokens(text: &[u8], macros: &mut MacroProps) -> Option<()> {
    let mut seen = 0u16;
    for token in strings::tokenize(text, b" ") {
        let setting = 1 << parse_token(token, macros)? as u16;
        (seen & setting == 0).then_some(())?;
        seen |= setting;
    }
    let lacks = |setting| seen & 1 << setting as u16 == 0;
    let is_compact = matches!(macros.notation, Notation::Compact { .. });
    let is_currency = matches!(macros.unit, MeasureUnit::Currency(_));
    if is_compact && lacks(Setting::Group) {
        macros.grouper = Grouper::Min2;
    }
    let needs_currency = matches!(
        macros.unit_width,
        UnitWidth::IsoCode | UnitWidth::Formal | UnitWidth::Hidden
    );
    let lacks_precision = (is_compact || is_currency) && lacks(Setting::Precision);
    (!lacks_precision && (is_currency || !needs_currency)).then_some(())
}

pub(crate) fn parse(skeleton: &[u16], locale: Locale) -> Result<MacroProps, UErrorCode> {
    let mut buffer = [0; MAX_LENGTH];
    let text = buffer
        .get_mut(..skeleton.len())
        .ok_or(U_UNSUPPORTED_ERROR)?;
    for (c, &unit) in text.iter_mut().zip(skeleton) {
        *c = u8::try_from(unit).unwrap_or(0);
    }
    let mut macros = MacroProps::new(locale);
    parse_tokens(text, &mut macros).ok_or(U_UNSUPPORTED_ERROR)?;
    Ok(macros)
}

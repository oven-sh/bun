use bun_engine_text::{StringRef, Text};
use bun_icu::Buffer;

/// The single units that ECMA-402 sanctions, in ascending order.
pub(crate) const SANCTIONED_UNITS: [&str; 45] = [
    "acre",
    "bit",
    "byte",
    "celsius",
    "centimeter",
    "day",
    "degree",
    "fahrenheit",
    "fluid-ounce",
    "foot",
    "gallon",
    "gigabit",
    "gigabyte",
    "gram",
    "hectare",
    "hour",
    "inch",
    "kilobit",
    "kilobyte",
    "kilogram",
    "kilometer",
    "liter",
    "megabit",
    "megabyte",
    "meter",
    "microsecond",
    "mile",
    "mile-scandinavian",
    "milliliter",
    "millimeter",
    "millisecond",
    "minute",
    "month",
    "nanosecond",
    "ounce",
    "percent",
    "petabyte",
    "pound",
    "second",
    "stone",
    "terabit",
    "terabyte",
    "week",
    "yard",
    "year",
];

const PER: &str = "-per-";

/// A well-formed unit identifier, as indices into `SANCTIONED_UNITS`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Unit {
    numerator: u8,
    denominator: Option<u8>,
}

fn find_sanctioned(text: Text<'_>) -> Option<u8> {
    let index = SANCTIONED_UNITS.binary_search_by(|unit| Text::from_ascii(unit).cmp(&text));
    index.ok().map(|index| index as u8)
}

impl Unit {
    pub(crate) fn parse(text: Text<'_>) -> Option<Unit> {
        let Some(per) = text.find(Text::from_ascii(PER), 0) else {
            return find_sanctioned(text).map(|numerator| Unit {
                numerator,
                denominator: None,
            });
        };
        Some(Unit {
            numerator: find_sanctioned(text.slice(0..per))?,
            denominator: Some(find_sanctioned(text.slice_from(per + PER.len()))?),
        })
    }

    pub(crate) fn identifier(self) -> Buffer<u8> {
        let name = |index: u8| SANCTIONED_UNITS[usize::from(index)].as_bytes();
        let mut identifier = Buffer::from_slice(name(self.numerator));
        if let Some(denominator) = self.denominator {
            identifier.extend_from_slice(PER.as_bytes());
            identifier.extend_from_slice(name(denominator));
        }
        identifier
    }

    pub fn to_string_ref(self) -> StringRef {
        StringRef::from_latin1(&self.identifier())
    }
}

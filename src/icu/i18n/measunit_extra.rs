//! Parses unit identifiers with the units and aliases in the data. ICU4C: measunit_extra.cpp

use crate::common::charstr::{CharStrings, SmallChars, Span, decimal};
use crate::common::cstring::{split_once, until_nul};
use crate::common::maps::Map;
use crate::common::memory::{Appendable, try_concat, try_map_insert, try_push};
use crate::common::packed_strs;
use crate::common::resource::ResourceValue;
use crate::common::slice_ext::SliceExt;
use crate::common::sorting::sort_in_place_by;
use crate::common::udata::U_ICUDATA_ALIAS;
use crate::common::uinvchar::invariant_chars;
use crate::common::umutex::OnceBox;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::measunit_data::{PREFIX_NAMES, PREFIXES};
use crate::i18n::number_decnum::string_to_double;
use std::borrow::Cow;
use std::cmp::{Ordering, Reverse};
use std::fmt::NumBuffer;

const SYNTAX_ERROR: UErrorCode = U_ILLEGAL_ARGUMENT_ERROR;

type UMeasurePrefix = i32;
pub(crate) const UMEASURE_PREFIX_ONE: UMeasurePrefix = 30;
const UMEASURE_PREFIX_INTERNAL_ONE_BIN: UMeasurePrefix = -60;

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) enum Complexity {
    #[default]
    Single,
    Compound,
    /// "foot-and-inch"
    Mixed,
}

/// A key of `convertUnits`, such as "gram" or "nautical-mile".
#[derive(Clone, Copy)]
struct SimpleUnit {
    id: &'static [u8],
    index: u32,
    /// Index of the base unit in `unitQuantities`.
    category: u32,
}

/// A simple unit with prefix and power, such as "square-kilometer".
#[derive(Clone, Copy)]
pub(crate) struct SingleUnitImpl {
    simple_unit: SimpleUnit,
    pub(crate) unit_prefix: UMeasurePrefix,
    pub(crate) dimensionality: i32,
}

impl SingleUnitImpl {
    pub(crate) fn get_simple_unit_id(&self) -> &'static [u8] {
        self.simple_unit.id
    }

    /// Compares by the order of units in an identifier.
    fn compare_to(&self, other: &Self) -> Ordering {
        let key = |unit: &Self| {
            let (base, power) = (
                umeas_get_prefix_base(unit.unit_prefix),
                umeas_get_prefix_power(unit.unit_prefix),
            );
            let size = (if base == 1024 { power * 3 } else { power }, base);
            let SimpleUnit {
                category, index, ..
            } = unit.simple_unit;
            (unit.dimensionality < 0, category, index, Reverse(size))
        };
        key(self).cmp(&key(other))
    }

    fn differs_only_in_power(&self, other: &Self) -> bool {
        (self.simple_unit.index, self.unit_prefix) == (other.simple_unit.index, other.unit_prefix)
    }

    /// Appends the identifier, ignoring the sign of the dimensionality.
    pub(crate) fn append_neutral_identifier(&self, result: &mut Vec<u8>) -> Result<(), UErrorCode> {
        match self.dimensionality.unsigned_abs() {
            1 => {}
            2 => result.add_all(b"square-"),
            3 => result.add_all(b"cubic-"),
            power @ ..=15 => {
                result.add_all(b"pow");
                result.add_all(&decimal(power.into()));
                result.add(b'-');
            }
            _ => return Err(SYNTAX_ERROR),
        }
        if let Some((name, _)) = prefixes().find(|&(_, prefix)| prefix == self.unit_prefix) {
            result.add_all(name);
        }
        result.add_all(self.simple_unit.id);
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct MeasureUnitImpl {
    pub(crate) complexity: Complexity,
    pub(crate) single_units: Vec<SingleUnitImpl>,
    /// Empty until `serialize` is called.
    pub(crate) identifier: Vec<u8>,
    /// 0 if there is none.
    pub(crate) constant_denominator: u64,
}

/// Returns all prefixes except `UMEASURE_PREFIX_ONE`, with their names.
fn prefixes() -> impl Iterator<Item = (&'static [u8], UMeasurePrefix)> {
    PREFIX_NAMES
        .iter()
        .zip(PREFIXES.iter().map(|&prefix| prefix.into()))
}

#[derive(Clone, Copy)]
enum Token {
    Prefix(UMeasurePrefix),
    Per,
    Times,
    And,
    InitialPer,
    Power(i32),
    SimpleUnit(SimpleUnit),
    /// An index into `UnitExtras::replacements`.
    Alias(usize),
    /// "100" or "1e6": the text up to the next "-", if no other token matches.
    ConstantDenominator(u64),
}

packed_strs! {
    /// Power prefixes, starting at 2.
    static POWERS = [
        "pow2-", "pow3-", "pow4-", "pow5-", "pow6-", "pow7-", "pow8-", "pow9-", "pow10-", "pow11-", "pow12-", "pow13-",
        "pow14-", "pow15-",
    ];
}

// The ranges of `Stem::value`.
const PREFIX_OFFSET: i32 = 64;
const PER: i32 = 128;
const TIMES: i32 = 129;
const AND: i32 = 130;
const INITIAL_PER: i32 = 192;
const POWER_OFFSET: i32 = 256;
const SIMPLE_UNIT_OFFSET: i32 = 512;
/// With enough simple units, the values of the last ones are read as aliases.
const ALIAS_OFFSET: i32 = 51200;

/// The text of a token.
#[derive(Clone, Copy)]
struct Stem {
    name: &'static [u8],
    value: i32,
    /// `SimpleUnit::category`, or 0.
    category: u32,
}

impl Stem {
    fn token(&self) -> Token {
        let Self {
            name,
            value,
            category,
        } = *self;
        match value {
            PER => Token::Per,
            TIMES => Token::Times,
            AND => Token::And,
            INITIAL_PER => Token::InitialPer,
            POWER_OFFSET..SIMPLE_UNIT_OFFSET => Token::Power(value - POWER_OFFSET),
            SIMPLE_UNIT_OFFSET..ALIAS_OFFSET => Token::SimpleUnit(SimpleUnit {
                id: name,
                index: (value - SIMPLE_UNIT_OFFSET) as u32,
                category,
            }),
            ALIAS_OFFSET.. => Token::Alias((value - ALIAS_OFFSET) as usize),
            _ => Token::Prefix(value - PREFIX_OFFSET),
        }
    }
}

// ICU4C: measunit_extra.cpp, initUnitExtras
struct UnitExtras {
    /// Sorted by name.
    stems: Vec<Stem>,
    replacements: Vec<Span>,
    replacement_chars: CharStrings,
    /// Total length of the replacements, each with its NUL.
    replacements_length: usize,
}

impl UnitExtras {
    fn get() -> Result<&'static Self, UErrorCode> {
        static UNIT_EXTRAS: OnceBox<Result<UnitExtras, UErrorCode>> = OnceBox::new();
        UNIT_EXTRAS.get_or_init_caching_err(Self::load)
    }

    fn load() -> Result<Self, UErrorCode> {
        let units = ures_open_direct(None, b"units")?;

        // Each item maps one base unit ("meter-per-second") to its category ("speed").
        let quantities = units.get_by_key(b"unitQuantities")?.get_value();
        let mut categories = Map::default();
        for (item, index) in quantities.get_array()?.iter().zip(0..) {
            for (base_unit, _) in item.get_table()?.iter() {
                try_map_insert(&mut categories, base_unit, index)?;
            }
        }

        let syntax: [(&[u8], _); 6] = [
            (b"-per-", PER),
            (b"-", TIMES),
            (b"-and-", AND),
            (b"per-", INITIAL_PER),
            (b"square-", POWER_OFFSET + 2),
            (b"cubic-", POWER_OFFSET + 3),
        ];
        let fixed = prefixes()
            .map(|(name, prefix)| (name, PREFIX_OFFSET + prefix))
            .chain(syntax)
            .chain(POWERS.iter().zip(POWER_OFFSET + 2..));
        let mut stems = Vec::new();
        stems.add_each(fixed.map(|(name, value)| Stem {
            name,
            value,
            category: 0,
        }));

        let rates = units.get_by_key(b"convertUnits")?.get_value().get_table()?;
        // "kilogram" is parsed as "kilo" and "gram".
        for ((name, rate), index) in rates
            .iter()
            .filter(|&(name, _)| name != b"kilogram")
            .zip(0..)
        {
            let target = rate
                .get_table()?
                .get(b"target")
                .ok_or(U_INVALID_FORMAT_ERROR)?;
            let target: SmallChars = invariant_chars(target.get_string()?.iter())?;
            let &category = categories.get(&*target).ok_or(U_INVALID_FORMAT_ERROR)?;
            stems.add(Stem {
                name,
                value: SIMPLE_UNIT_OFFSET.wrapping_add(index),
                category,
            });
        }

        let (mut replacements, mut replacement_chars) = (Vec::new(), CharStrings::default());
        let mut replacements_length = 0;
        let mut sink = |name, value: &ResourceValue| {
            stems.add(Stem {
                name,
                value: ALIAS_OFFSET.wrapping_add(replacements.len() as i32),
                category: 0,
            });
            let replacement = value
                .get_table()?
                .get(b"replacement")
                .ok_or(U_MISSING_RESOURCE_ERROR)?;
            let replacement: SmallChars = invariant_chars(replacement.get_string()?.iter())?;
            replacements_length += replacement.len() + 1;
            try_push(
                &mut replacements,
                replacement_chars.add(until_nul(&replacement))?,
            )
        };
        let metadata = ures_open(Some(U_ICUDATA_ALIAS), b"metadata")?;
        ures_get_all_children_with_fallback(&metadata, b"alias/unit", &mut sink)?;

        sort_in_place_by(&mut stems, |left, right| left.name.cmp(right.name));
        Ok(Self {
            stems,
            replacements,
            replacement_chars,
            replacements_length,
        })
    }

    /// Returns the longest token at the start of `text` and its length.
    fn longest_token(&self, text: &[u8]) -> Option<(Token, usize)> {
        let mut found = None;
        // The stems that start with the bytes read so far. An exact match sorts first.
        let mut stems = &*self.stems;
        for (depth, byte) in text.iter().enumerate() {
            stems = stems.slice(stems.partition_point(|stem| stem.name.get(depth) < Some(byte))..);
            stems = stems.slice(..stems.partition_point(|stem| stem.name.get(depth) == Some(byte)));
            let Some(stem) = stems.first() else { break };
            if stem.name.len() == depth + 1 {
                found = Some(stem);
            }
        }
        found.map(|stem| (stem.token(), stem.name.len()))
    }
}

/// Parses an integer from 1 to 2^63.
fn parse_constant(text: &[u8]) -> Result<u64, UErrorCode> {
    let number = string_to_double(text).ok_or(SYNTAX_ERROR)?;
    let whole = number as u64;
    if (1.0..=i64::MAX as f64).contains(&number) && number - whole as f64 <= 1e-9 {
        Ok(whole)
    } else {
        Err(SYNTAX_ERROR)
    }
}

enum SingleUnitOrConstant {
    SingleUnit { unit: SingleUnitImpl, saw_and: bool },
    ConstantDenominator(u64),
}

struct Parser<'a> {
    extras: &'static UnitExtras,
    /// After an alias: the replacement and the text after the alias.
    source: Cow<'a, [u8]>,
    index: usize,
    after_per: bool,
    /// Length of the tail of `source` that comes from the caller's identifier.
    caller_length: usize,
    /// Number of bytes that aliases inside replacements may still insert.
    nested_alias_budget: usize,
}

impl<'a> Parser<'a> {
    fn parse(source: &'a [u8]) -> Result<MeasureUnitImpl, UErrorCode> {
        let mut parser = Self {
            extras: UnitExtras::get()?,
            source: Cow::Borrowed(source),
            index: 0,
            after_per: false,
            caller_length: source.len(),
            nested_alias_budget: 0,
        };
        let mut result = MeasureUnitImpl::default();

        while parser.index < parser.source.len() {
            let (unit, saw_and) = match parser.next_single_unit_or_constant()? {
                SingleUnitOrConstant::ConstantDenominator(_) if result.constant_denominator > 0 => {
                    return Err(SYNTAX_ERROR);
                }
                SingleUnitOrConstant::ConstantDenominator(constant) => {
                    result.constant_denominator = constant;
                    result.complexity = Complexity::Compound;
                    continue;
                }
                SingleUnitOrConstant::SingleUnit { unit, saw_and } => (unit, saw_and),
            };

            let is_added = result.append_single_unit(&unit);
            if saw_and && !is_added {
                return Err(SYNTAX_ERROR);
            }

            let complexity = if saw_and {
                Complexity::Mixed
            } else {
                Complexity::Compound
            };
            match result.single_units.len() {
                ..2 => {}
                // This turns "meter-and-foot-foot" back into a compound unit.
                2 => result.complexity = complexity,
                _ if result.complexity != complexity => return Err(SYNTAX_ERROR),
                _ => {}
            }
        }

        if result.single_units.is_empty() {
            return Err(SYNTAX_ERROR);
        }
        Ok(result)
    }

    /// Fails at the end of the source.
    fn next_token(&mut self) -> Result<Token, UErrorCode> {
        let rest = self.source.slice(self.index..);
        let Some((token, length)) = self.extras.longest_token(rest) else {
            let (constant, _) = split_once(rest, b'-');
            self.index += constant.len();
            return parse_constant(constant).map(Token::ConstantDenominator);
        };
        self.index += length;
        Ok(token)
    }

    fn process_alias(&mut self, alias: usize) -> Result<(), UErrorCode> {
        let replacement = self
            .extras
            .replacement_chars
            .get(*self.extras.replacements.get(alias).ok_or(SYNTAX_ERROR)?);
        let remaining = self.source.len() - self.index;
        if remaining < self.caller_length {
            self.caller_length = remaining;
            self.nested_alias_budget = self.extras.replacements_length;
        } else {
            self.nested_alias_budget = self
                .nested_alias_budget
                .checked_sub(replacement.len())
                .ok_or(SYNTAX_ERROR)?;
        }
        self.source = Cow::Owned(try_concat(&[replacement, self.source.slice(self.index..)])?);
        self.index = 0;
        Ok(())
    }

    fn next_single_unit_or_constant(&mut self) -> Result<SingleUnitOrConstant, UErrorCode> {
        let at_start = self.index == 0;
        let mut token = self.next_token()?;
        if let Token::Alias(alias) = token {
            self.process_alias(alias)?;
            token = self.next_token()?;
        }

        let (just_saw_per, saw_and) = (
            matches!(token, Token::Per | Token::InitialPer),
            matches!(token, Token::And),
        );
        match (at_start, token) {
            (true, Token::InitialPer) | (false, Token::Per | Token::Times) => {
                token = self.next_token()?
            }
            (false, Token::And) if !self.after_per => token = self.next_token()?,
            (false, _) => return Err(SYNTAX_ERROR),
            (true, _) => {}
        }
        self.after_per |= just_saw_per;

        let mut dimensionality = if self.after_per { -1 } else { 1 };
        let mut unit_prefix = UMEASURE_PREFIX_ONE;
        let (mut may_have_power, mut may_have_prefix) = (true, true);
        if let (Token::ConstantDenominator(constant), true) = (token, just_saw_per) {
            return Ok(SingleUnitOrConstant::ConstantDenominator(constant));
        }
        loop {
            match token {
                Token::Power(power) if may_have_power => {
                    dimensionality *= power;
                    may_have_power = false;
                }
                Token::Prefix(prefix) if may_have_prefix => {
                    unit_prefix = prefix;
                    (may_have_power, may_have_prefix) = (false, false);
                }
                Token::SimpleUnit(simple_unit) => {
                    let unit = SingleUnitImpl {
                        simple_unit,
                        unit_prefix,
                        dimensionality,
                    };
                    return Ok(SingleUnitOrConstant::SingleUnit { unit, saw_and });
                }
                Token::Alias(alias) => self.process_alias(alias)?,
                _ => return Err(SYNTAX_ERROR),
            }
            token = self.next_token()?;
        }
    }
}

fn is_binary(prefix: UMeasurePrefix) -> bool {
    prefix < 0
}

pub(crate) fn umeas_get_prefix_power(prefix: UMeasurePrefix) -> i32 {
    if is_binary(prefix) {
        prefix - UMEASURE_PREFIX_INTERNAL_ONE_BIN
    } else {
        prefix - UMEASURE_PREFIX_ONE
    }
}

pub(crate) fn umeas_get_prefix_base(prefix: UMeasurePrefix) -> i32 {
    if is_binary(prefix) { 1024 } else { 10 }
}

/// Appends "100" or "1e6".
fn append_constant(to: &mut Vec<u8>, constant: u64) {
    let mut buffer = NumBuffer::new();
    match constant.format_into(&mut buffer).as_bytes() {
        [b'1', zeros @ ..] if constant > 1000 && zeros.iter().all(|&digit| digit == b'0') => {
            to.add_all(b"1e");
            to.add_all(&decimal(zeros.len() as i64));
        }
        digits => to.add_all(digits),
    }
}

impl MeasureUnitImpl {
    pub(crate) fn for_identifier(identifier: &[u8]) -> Result<Self, UErrorCode> {
        Parser::parse(identifier)
    }

    /// Returns false if `unit` was coalesced with an existing unit on the same side of the "per".
    pub(crate) fn append_single_unit(&mut self, unit: &SingleUnitImpl) -> bool {
        let existing = self.single_units.iter_mut().rfind(|existing| {
            existing.differs_only_in_power(unit)
                && existing.dimensionality.signum() == unit.dimensionality.signum()
        });
        if let Some(existing) = existing {
            existing.dimensionality = existing.dimensionality.wrapping_add(unit.dimensionality);
            return false;
        }
        self.single_units.add(*unit);
        if self.single_units.len() > 1 && self.complexity == Complexity::Single {
            self.complexity = Complexity::Compound;
        }
        true
    }

    /// Sorts the units of a compound unit and sets `identifier`.
    pub(crate) fn serialize(&mut self) -> Result<(), UErrorCode> {
        if self.complexity == Complexity::Compound {
            sort_in_place_by(&mut self.single_units, SingleUnitImpl::compare_to);
        }
        let mut result = Vec::new();
        let (mut before_per, mut needs_per, mut needs_constant) =
            (true, false, self.constant_denominator > 0);
        for unit in &self.single_units {
            if unit.dimensionality < 0 {
                needs_per = std::mem::take(&mut before_per);
            }
            let separator: &[u8] = match (self.complexity, needs_per, result.is_empty()) {
                (Complexity::Mixed, _, true) | (_, false, true) => b"",
                (Complexity::Mixed, _, false) => b"-and-",
                (_, true, true) => b"per-",
                (_, true, false) => b"-per-",
                (_, false, false) => b"-",
            };
            result.add_all(separator);
            if needs_per && std::mem::take(&mut needs_constant) {
                append_constant(&mut result, self.constant_denominator);
                result.add(b'-');
            }
            unit.append_neutral_identifier(&mut result)?;
        }
        if needs_constant {
            result.add_all(b"-per-");
            append_constant(&mut result, self.constant_denominator);
        }
        self.identifier = result;
        Ok(())
    }
}

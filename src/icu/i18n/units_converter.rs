//! Converts between single units. The order of operations counts.

use crate::common::charstr::SmallChars;
use crate::common::cstring::split_once;
use crate::common::memory::Appendable;
use crate::common::packed_strs;
use crate::common::resource::ResourceTable;
use crate::common::slice_ext::SliceExt;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uresimp::ures_open_direct;
use crate::common::utypes::*;
use crate::i18n::measunit_extra::{
    SingleUnitImpl, UMEASURE_PREFIX_ONE, umeas_get_prefix_base, umeas_get_prefix_power,
};
use crate::i18n::number_decnum::string_to_double;
use bun_core::strings;

/// The table `convertUnits`.
pub(crate) struct ConversionRates(ResourceTable);

impl ConversionRates {
    pub(crate) fn load() -> Result<Self, UErrorCode> {
        let rates = ures_open_direct(None, b"units")?.get_by_key(b"convertUnits")?;
        rates.get_value().get_table().map(Self)
    }

    /// Returns "factor", "offset" or "special" of `unit` up to a character that is not invariant, or else an empty text.
    fn get(&self, unit: &SingleUnitImpl, key: &[u8], is_kept: fn(&u16) -> bool) -> SmallChars {
        let rate = self.0.get(unit.get_simple_unit_id());
        let text = rate.and_then(|rate| rate.get_table().ok()?.get(key)?.get_string().ok());
        let mut chars = SmallChars::new();
        chars.add_each(invariant_prefix(
            text.unwrap_or_default().iter().filter(is_kept),
        ));
        chars
    }
}

packed_strs! {
    static CONSTANT_NAMES = [
        "ft_to_m", "PI", "gravity", "G", "gal_imp_to_m3", "lb_to_kg", "glucose_molar_mass", "item_per_mole",
        "meters_per_AU", "sec_per_julian_year", "speed_of_light_meters_per_second", "sho_to_m3", "tsubo_to_m2",
        "shaku_to_m", "AMU",
    ];
}

/// The value of each entry of `CONSTANT_NAMES`.
const CONSTANTS: [f64; 15] = [
    0.3048,
    411557987.0 / 131002976.0,
    9.80665,
    6.67408E-11,
    0.00454609,
    0.45359237,
    180.1557,
    6.02214076E+23,
    149597870700.0,
    31557600.0,
    299792458.0,
    2401.0 / (1331.0 * 1000.0),
    400.0 / 121.0,
    4.0 / 121.0,
    1.66053878283E-27,
];

/// `powi` multiplies repeatedly, which rounds differently.
fn pow(base: f64, exponent: i32) -> f64 {
    base.powf(exponent.into())
}

fn str_to_double(text: &[u8]) -> Result<f64, UErrorCode> {
    string_to_double(text).ok_or(U_INVALID_FORMAT_ERROR)
}

struct Factor {
    num: f64,
    den: f64,
    offset: f64,
    /// Exponent of each entry of `CONSTANTS`, kept apart so that constants cancel exactly. Wraps on overflow.
    exponents: [i32; CONSTANTS.len()],
}

impl Factor {
    const ONE: Self = Self {
        num: 1.0,
        den: 1.0,
        offset: 0.0,
        exponents: [0; CONSTANTS.len()],
    };

    /// The power of `unit` is positive.
    fn to_base(unit: &SingleUnitImpl, rates: &ConversionRates) -> Result<Self, UErrorCode> {
        let mut factor = Self::parse(&rates.get(unit, b"factor", |&c| c != 0x20))?;
        let offset = match split_once(&rates.get(unit, b"offset", |_| true), b'/') {
            (dividend, Some(divisor)) => str_to_double(dividend)? / str_to_double(divisor)?,
            (offset, None) => str_to_double(offset)?,
        };
        factor.offset = if offset < 0.0 { 0.0 } else { offset };
        if unit.unit_prefix != UMEASURE_PREFIX_ONE {
            factor.multiply_by_power(
                umeas_get_prefix_base(unit.unit_prefix).into(),
                umeas_get_prefix_power(unit.unit_prefix),
            );
        }
        let power = unit.dimensionality;
        factor.exponents = (factor.exponents).map(|exponent| exponent.wrapping_mul(power));
        (factor.num, factor.den) = (pow(factor.num, power), pow(factor.den, power));
        Ok(factor)
    }

    /// Parses "ft_to_m*1007/gal_to_m3*3". Everything after the first '/' is in the denominator.
    fn parse(mut text: &[u8]) -> Result<Self, UErrorCode> {
        let (mut factor, mut signum) = (Self::ONE, 1);
        while !text.is_empty() {
            let end = strings::index_of_any(text, b"*/").unwrap_or(text.len());
            let (element, rest) = text.split_soft(end);
            factor.add_element(element, signum)?;
            if let [b'/', ..] = rest {
                signum = -1;
            }
            text = rest.get(1..).unwrap_or_default();
        }
        Ok(factor)
    }

    fn add_element(&mut self, element: &[u8], signum: i32) -> Result<(), UErrorCode> {
        let (name, power): (&[u8], _) = match element {
            b"ft2_to_m2" => (b"ft_to_m", 2),
            b"ft3_to_m3" => (b"ft_to_m", 3),
            b"in3_to_m3" => {
                self.den *= pow(1728.0, signum);
                (b"ft_to_m", 3)
            }
            b"gal_to_m3" => {
                self.num *= pow(231.0, signum);
                self.den *= pow(1728.0, signum);
                (b"ft_to_m", 3)
            }
            _ => (element, 1),
        };
        match CONSTANT_NAMES
            .iter()
            .zip(&mut self.exponents)
            .find(|(constant, _)| *constant == name)
        {
            Some((_, exponent)) => *exponent = exponent.wrapping_add(power * signum),
            None => {
                let number = str_to_double(element)?;
                *(if signum == -1 {
                    &mut self.den
                } else {
                    &mut self.num
                }) *= number;
            }
        }
        Ok(())
    }

    fn multiply_by_power(&mut self, base: f64, exponent: i32) {
        *(if exponent < 0 {
            &mut self.den
        } else {
            &mut self.num
        }) *= pow(base, exponent.wrapping_abs());
    }

    fn divide_by(&mut self, other: &Self) {
        self.num *= other.den;
        self.den *= other.num;
        self.exponents
            .iter_mut()
            .zip(other.exponents)
            .for_each(|(lhs, rhs)| *lhs = lhs.wrapping_sub(rhs));
    }

    /// Returns numerator and denominator.
    fn into_fraction(mut self) -> (f64, f64) {
        for (exponent, constant) in self
            .exponents
            .into_iter()
            .zip(CONSTANTS)
            .filter(|&(exponent, _)| exponent != 0)
        {
            self.multiply_by_power(constant, exponent);
        }
        (self.num, self.den)
    }
}

/// True for "celsius", false for "square-celsius" and "kilokelvin".
fn is_simple_unit(unit: &SingleUnitImpl) -> bool {
    unit.dimensionality == 1 && unit.unit_prefix == UMEASURE_PREFIX_ONE
}

/// Returns an empty text if `unit` has no special mapping.
fn get_special_mapping_name(unit: &SingleUnitImpl, rates: &ConversionRates) -> SmallChars {
    if is_simple_unit(unit) {
        rates.get(unit, b"special", |_| true)
    } else {
        SmallChars::new()
    }
}

pub(crate) fn is_bigger_unit(
    first: &SingleUnitImpl,
    second: &SingleUnitImpl,
    rates: &ConversionRates,
) -> Result<bool, UErrorCode> {
    // A unit with a special mapping is bigger than a unit without.
    match (
        &*get_special_mapping_name(first, rates),
        &*get_special_mapping_name(second, rates),
    ) {
        ([], []) => {}
        (first, second) => return Ok(first > second),
    }
    let size = |unit| {
        Factor::to_base(unit, rates)
            .map(Factor::into_fraction)
            .map(|(num, den)| num / den)
    };
    Ok(size(first)? > size(second)?)
}

/// Minimum meters per second of each Beaufort number, followed by an upper limit for the last.
static BEAUFORT_MIN_SPEEDS: [f64; 19] = [
    0.0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 36.9, 41.4, 46.1, 51.1,
    55.8, 61.4,
];
const MAX_BEAUFORT: usize = 17;

fn beaufort_to_base(value: f64) -> f64 {
    if value.is_nan() {
        return value;
    }
    let value = ((value.abs() + 0.5) as usize).min(MAX_BEAUFORT);
    (BEAUFORT_MIN_SPEEDS.at(value) + BEAUFORT_MIN_SPEEDS.at(value + 1)) / 2.0
}

/// A speed on a boundary gets the range that the binary search tests first. NaN gets the first range tested.
fn base_to_beaufort(speed: f64) -> f64 {
    let speed = speed.abs();
    if speed >= BEAUFORT_MIN_SPEEDS.at(MAX_BEAUFORT) {
        return MAX_BEAUFORT as f64;
    }
    let (mut start, mut end) = (0, MAX_BEAUFORT + 1);
    loop {
        let mid = (start + end) / 2;
        if speed < BEAUFORT_MIN_SPEEDS.at(mid) {
            end = mid;
        } else if speed > BEAUFORT_MIN_SPEEDS.at(mid + 1) {
            start = mid + 1;
        } else {
            return mid as f64;
        }
    }
}

/// Conversion between a unit and its base unit, used if source or target has a special mapping.
#[derive(Clone, Copy)]
pub(crate) enum Mapping {
    Fraction(f64, f64),
    Beaufort,
    /// An unknown special mapping.
    Identity,
}

/// Returns a NaN `amount` unchanged: which of two NaN operands survives an operation depends on the compiler.
fn scale(amount: f64, factor: f64, divisor: f64) -> f64 {
    if amount.is_nan() {
        amount
    } else {
        amount * factor / divisor
    }
}

impl Mapping {
    fn new(
        unit: &SingleUnitImpl,
        special: &[u8],
        rates: &ConversionRates,
    ) -> Result<Self, UErrorCode> {
        match special {
            b"" => Factor::to_base(unit, rates)
                .map(Factor::into_fraction)
                .map(|(num, den)| Self::Fraction(num, den)),
            b"beaufort" => Ok(Self::Beaufort),
            _ => Ok(Self::Identity),
        }
    }

    fn unit_to_base(self, amount: f64) -> f64 {
        match self {
            Self::Fraction(num, den) => scale(amount, num, den),
            Self::Beaufort => beaufort_to_base(amount),
            Self::Identity => amount,
        }
    }

    fn base_to_unit(self, base: f64) -> f64 {
        match self {
            Self::Fraction(num, den) => scale(base, den, num),
            Self::Beaufort => base_to_beaufort(base),
            Self::Identity => base,
        }
    }
}

pub(crate) enum UnitsConverter {
    Special {
        source: Mapping,
        target: Mapping,
    },
    Linear {
        num: f64,
        den: f64,
        source_offset: f64,
        target_offset: f64,
    },
}

impl UnitsConverter {
    pub(crate) fn new(
        source: &SingleUnitImpl,
        target: &SingleUnitImpl,
        rates: &ConversionRates,
    ) -> Result<Self, UErrorCode> {
        let special_source = get_special_mapping_name(source, rates);
        let special_target = get_special_mapping_name(target, rates);
        if !special_source.is_empty() || !special_target.is_empty() {
            return Ok(Self::Special {
                source: Mapping::new(source, &special_source, rates)?,
                target: Mapping::new(target, &special_target, rates)?,
            });
        }
        let mut factor = Factor::to_base(source, rates)?;
        let target_to_base = Factor::to_base(target, rates)?;
        let (mut source_offset, mut target_offset) = (0.0, 0.0);
        if is_simple_unit(source) && is_simple_unit(target) {
            source_offset = factor.offset * factor.den / factor.num;
            target_offset = target_to_base.offset * target_to_base.den / target_to_base.num;
        }
        factor.divide_by(&target_to_base);
        let (num, den) = factor.into_fraction();
        Ok(Self::Linear {
            num,
            den,
            source_offset,
            target_offset,
        })
    }

    /// A NaN keeps its sign.
    pub(crate) fn convert(&self, amount: f64) -> f64 {
        match *self {
            Self::Special { source, target } => target.base_to_unit(source.unit_to_base(amount)),
            Self::Linear { .. } if amount.is_nan() => amount,
            Self::Linear {
                num,
                den,
                source_offset,
                target_offset,
            } => (amount + source_offset) * (num / den) - target_offset,
        }
    }

    pub(crate) fn convert_inverse(&self, amount: f64) -> f64 {
        match *self {
            Self::Special { source, target } => source.base_to_unit(target.unit_to_base(amount)),
            Self::Linear {
                num,
                den,
                source_offset,
                target_offset,
            } => (amount + target_offset) * (den / num) - source_offset,
        }
    }
}

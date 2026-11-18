use bun_engine_text::{PropertyName, Text, names};

use crate::{CalendarId, IsoDate};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Era {
    Aa,
    Ah,
    Am,
    Ap,
    Bce,
    Be,
    Bh,
    Broc,
    Ce,
    Heisei,
    Meiji,
    Reiwa,
    Roc,
    Shaka,
    Showa,
    Taisho,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct EraYear {
    pub era: Era,
    pub year: i32,
}

/// The years of Amete Alem before those of Amete Mihret.
pub(super) const AMETE_ALEM_YEARS: i32 = 5500;

/// From the latest. Meiji began before Japan adopted the Gregorian calendar, in its sixth year.
const JAPANESE_ERAS: [(Era, IsoDate); 5] = [
    (Era::Reiwa, IsoDate::from_valid(2019, 5, 1)),
    (Era::Heisei, IsoDate::from_valid(1989, 1, 8)),
    (Era::Showa, IsoDate::from_valid(1926, 12, 25)),
    (Era::Taisho, IsoDate::from_valid(1912, 7, 30)),
    (Era::Meiji, IsoDate::from_valid(1873, 1, 1)),
];

impl Era {
    pub const fn code(self) -> PropertyName<'static> {
        match self {
            Era::Aa => names::aa,
            Era::Ah => names::ah,
            Era::Am => names::am,
            Era::Ap => names::ap,
            Era::Bce => names::bce,
            Era::Be => names::be,
            Era::Bh => names::bh,
            Era::Broc => names::broc,
            Era::Ce => names::ce,
            Era::Heisei => names::heisei,
            Era::Meiji => names::meiji,
            Era::Reiwa => names::reiwa,
            Era::Roc => names::roc,
            Era::Shaka => names::shaka,
            Era::Showa => names::showa,
            Era::Taisho => names::taisho,
        }
    }

    #[inline(never)]
    fn is_named(self, name: Text<'_>) -> bool {
        let alias = match self {
            Era::Ce => Some("ad"),
            Era::Bce => Some("bc"),
            _ => None,
        };
        (alias.map(Text::from_ascii).into_iter())
            .chain([self.code().text()])
            .any(|it| name.eq_ignore_ascii_case(it))
    }

    const fn counts_backwards(self) -> bool {
        matches!(self, Era::Bce | Era::Bh | Era::Broc)
    }

    /// The arithmetic year that comes before year 1 of the era.
    fn year_zero(self, calendar: CalendarId) -> i32 {
        match self {
            Era::Aa if calendar == CalendarId::Ethiopic => -AMETE_ALEM_YEARS,
            Era::Meiji => 1867,
            Era::Taisho => 1911,
            Era::Showa => 1925,
            Era::Heisei => 1988,
            Era::Reiwa => 2018,
            _ => 0,
        }
    }
}

impl CalendarId {
    /// The era of the years from 1 on, and that of the years before.
    const fn eras_around_epoch(self) -> Option<[Era; 2]> {
        Some(match self {
            CalendarId::Chinese | CalendarId::Dangi | CalendarId::Iso8601 => return None,
            CalendarId::Buddhist => [Era::Be; 2],
            CalendarId::Coptic | CalendarId::Hebrew => [Era::Am; 2],
            CalendarId::Ethioaa => [Era::Aa; 2],
            CalendarId::Ethiopic => [Era::Am, Era::Aa],
            CalendarId::Gregory | CalendarId::Japanese => [Era::Ce, Era::Bce],
            CalendarId::Indian => [Era::Shaka; 2],
            CalendarId::IslamicCivil | CalendarId::IslamicTbla | CalendarId::IslamicUmalqura => {
                [Era::Ah, Era::Bh]
            }
            CalendarId::Persian => [Era::Ap; 2],
            CalendarId::Roc => [Era::Roc, Era::Broc],
        })
    }

    fn mid_year_eras(self) -> &'static [(Era, IsoDate)] {
        match self {
            CalendarId::Japanese => &JAPANESE_ERAS,
            _ => &[],
        }
    }

    /// CalendarSupportsEra
    #[inline]
    pub(crate) const fn has_eras(self) -> bool {
        self.eras_around_epoch().is_some()
    }

    /// CanonicalizeEraInCalendar, ignoring ASCII case.
    pub(crate) fn find_era(self, name: Text<'_>) -> Option<Era> {
        (self.eras_around_epoch()?.into_iter())
            .chain(self.mid_year_eras().iter().map(|&(era, _)| era))
            .find(|era| era.is_named(name))
    }

    /// CalendarDateArithmeticYearForEraYear
    pub(super) fn arithmetic_year(self, era_year: EraYear) -> i32 {
        if era_year.era.counts_backwards() {
            1 - era_year.year
        } else {
            era_year.era.year_zero(self) + era_year.year
        }
    }

    /// CalendarDateEra and CalendarDateEraYear. `year` is the arithmetic year of `date`.
    #[inline]
    pub(super) fn era_year(self, year: i32, date: IsoDate) -> Option<EraYear> {
        let [positive, other] = self.eras_around_epoch()?;
        let era = match self.mid_year_eras().iter().find(|it| date >= it.1) {
            Some(&(era, _)) => era,
            None if year > 0 => positive,
            None => other,
        };
        let year = if era.counts_backwards() {
            1 - year
        } else {
            year - era.year_zero(self)
        };
        Some(EraYear { era, year })
    }
}

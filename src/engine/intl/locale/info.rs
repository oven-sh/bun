//! What is in use where a locale is.

use core::ffi::CStr;
use std::sync::OnceLock;

use bun_engine_text::{StringRef, Text};
use bun_icu::CText;
use bun_icu::resource_bundle::ResourceBundle;
use smallvec::SmallVec;

use super::{Locale, WEEKDAYS};
use crate::error::IcuResult;
use crate::language_tag::subtag::Subtag;
use crate::language_tag::{Key, join};
use crate::{AvailableLocales, HourCycle, Named, NumberingSystem, Result, calendar, collation};

named_enum! {
    pub enum Direction {
        LeftToRight = "ltr",
        RightToLeft = "rtl",
    }
}

/// Monday is 1 and Sunday is 7.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct WeekInfo {
    pub first_day: u8,
    pub weekend: SmallVec<[u8; 7]>,
}

const INVALID_LOCALE: &str = "invalid locale";

impl Locale {
    pub fn calendars(&self) -> Result<Vec<StringRef>> {
        if let Some(preferred) = self.preferred(Key::CALENDAR) {
            return Ok(preferred);
        }
        let list = self.regional_data(c"calendarPreferenceData")?;
        (0..list.item_count())
            .map(|index| {
                let name = list.string_at(index).or_type_error(INVALID_LOCALE)?;
                let name: SmallVec<[u8; 32]> = name.iter().map(|&unit| unit as u8).collect();
                Ok(StringRef::from_latin1(calendar::bcp47_name(&name)))
            })
            .collect()
    }

    pub fn collations(&self) -> Result<Vec<StringRef>> {
        if let Some(preferred) = self.preferred(Key::COLLATION) {
            return Ok(preferred);
        }
        let collations = self
            .data_locale(AvailableLocales::collator())
            .and_then(|id| bun_icu::collator::types_for_locale(&id))
            .and_then(collation::collect)
            .or_type_error(INVALID_LOCALE)?;
        Ok((collations.iter())
            .map(|it| StringRef::from_latin1(it.as_bytes()))
            .collect())
    }

    pub fn hour_cycles(&self) -> Result<Vec<StringRef>> {
        if let Some(preferred) = self.preferred(Key::HOUR_CYCLE) {
            return Ok(preferred);
        }
        let data = self.regional_data(c"timeData")?;
        let symbol = (data.string_by_key(c"preferred")).or_type_error(INVALID_LOCALE)?;
        let hour_cycle = match symbol.first().and_then(|&unit| u8::try_from(unit).ok()) {
            Some(b'K') => HourCycle::H11,
            Some(b'h') => HourCycle::H12,
            Some(b'k') => HourCycle::H24,
            _ => HourCycle::H23,
        };
        Ok(vec![hour_cycle.to_string_ref()])
    }

    pub fn numbering_systems(&self) -> Result<Vec<StringRef>> {
        if let Some(preferred) = self.preferred(Key::NUMBERING_SYSTEM) {
            return Ok(preferred);
        }
        let id = (self.data_locale(AvailableLocales::general())).or_type_error(INVALID_LOCALE)?;
        Ok(vec![NumberingSystem::default_for(&id)?.to_string_ref()])
    }

    /// `None` if the locale has no region.
    pub fn time_zones(&self) -> Result<Option<Vec<StringRef>>> {
        let Some(region) = self.base_subtags().region else {
            return Ok(None);
        };
        let mut names = CText::new(region)
            .and_then(|region| bun_icu::time_zone::canonical_ids(Some(&region)))
            .or_type_error(INVALID_LOCALE)?;
        let mut zones = Vec::new();
        while let Some(name) = names.next().or_type_error(INVALID_LOCALE)? {
            zones.push(StringRef::from_latin1(name));
        }
        zones.sort_unstable_by(|a, b| a.text().cmp(&b.text()));
        Ok(Some(zones))
    }

    /// `direction` of `getTextInfo`
    pub fn direction(&self) -> Result<Direction> {
        let base = self.base_subtags();
        let subtags = [Some(base.language), base.script, base.region];
        let id = join(subtags.into_iter().flatten().filter_map(Subtag::new));
        match bun_icu::locale::is_right_to_left(&id.or_type_error(INVALID_LOCALE)?) {
            true => Ok(Direction::RightToLeft),
            false => Ok(Direction::LeftToRight),
        }
    }

    pub fn week_info(&self) -> Result<WeekInfo> {
        let data = self.regional_data(c"weekData")?;
        // These count from Sunday.
        let Ok(&[first_day, _, weekend_start, _, weekend_end, _]) = data.int_vector() else {
            return Err(crate::Error::Type(INVALID_LOCALE));
        };
        let weekend_length = (weekend_end - weekend_start).rem_euclid(7);
        let is_in_weekend =
            |day: u8| (i32::from(day) + 1 - weekend_start).rem_euclid(7) <= weekend_length;
        Ok(WeekInfo {
            first_day: (self.first_day_override())
                .unwrap_or_else(|| (first_day + 5).rem_euclid(7) as u8 + 1),
            weekend: (1..=7).filter(|&day| is_in_weekend(day)).collect(),
        })
    }

    /// UTS #35, part 4, First Day Overrides.
    fn first_day_override(&self) -> Option<u8> {
        let name = Text::Latin1(self.0.keyword(Key::FIRST_DAY).unwrap_or_default());
        if let Some(index) = WEEKDAYS.iter().position(|it| name.eq_ascii(it)) {
            return Some(index as u8 + 1);
        }
        let is_iso = self.0.keyword(Key::CALENDAR) == Some(b"iso8601");
        (is_iso && self.subdivision_region(Key::REGION_OVERRIDE).is_none()).then_some(1)
    }

    fn preferred(&self, key: Key) -> Option<Vec<StringRef>> {
        let value = self.keyword(key).filter(|it| !it.is_empty())?;
        Some(vec![value])
    }

    /// The root locale if no prefix is available.
    fn data_locale(&self, available: &AvailableLocales) -> bun_icu::Result<CText> {
        CText::new(available.lookup(&self.0).unwrap_or(b"root"))
    }

    /// The entry for the language in the region, for the region, or for the world.
    fn regional_data(&self, table: &CStr) -> Result<ResourceBundle> {
        let table = supplemental_table(table).or_type_error(INVALID_LOCALE)?;
        let language = Subtag::new(self.0.language()).unwrap_or(Subtag::UND);
        let region = self.preferred_region()?;
        let look_up = |key: &[Subtag]| table.by_key(&join(key.iter().copied())?);
        look_up(&[language, region])
            .or_else(|_| look_up(&[region]))
            .or_else(|_| look_up(&[Subtag::WORLD]))
            .or_type_error(INVALID_LOCALE)
    }

    /// RegionPreference
    fn preferred_region(&self) -> Result<Subtag> {
        let named = (self.subdivision_region(Key::REGION_OVERRIDE))
            .or_else(|| self.base_subtags().region.and_then(Subtag::new))
            .or_else(|| self.subdivision_region(Key::SUBDIVISION));
        if let Some(region) = named {
            return Ok(region);
        }
        let mut likely = self.parse()?.language_id;
        likely.maximize();
        Ok(likely.region.unwrap_or(Subtag::WORLD))
    }

    /// The region of the subdivision that is the value of `key`, if CLDR knows it.
    fn subdivision_region(&self, key: Key) -> Option<Subtag> {
        const MAX_SUFFIX_LENGTH: usize = 4;

        let (region, suffix) = self.0.keyword(key)?.split_at_checked(2)?;
        let region = Subtag::new(region)?.to_uppercase();
        if suffix.len() > MAX_SUFFIX_LENGTH || region.as_bytes() == b"ZZ" {
            return None;
        }
        let known = supplemental_table(c"territoryInfo").ok()?;
        known.by_key(&join([region]).ok()?).ok().map(|_| region)
    }
}

fn supplemental_table(name: &CStr) -> bun_icu::Result<ResourceBundle> {
    static DATA: OnceLock<bun_icu::Result<ResourceBundle>> = OnceLock::new();
    DATA.get_or_init(|| ResourceBundle::open_direct(c"supplementalData"))
        .as_ref()
        .map_err(|&error| error)?
        .by_key(name)
}

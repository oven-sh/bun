use bun_engine_text::{CodeUnit, Text};

use super::WEEKDAYS;
use crate::collator::CaseFirst;
use crate::language_tag::subtag::{
    Subtag, Subtags, is_language, is_region, is_script, lowercase_subtags,
};
use crate::language_tag::{Key, LocaleId, Variants};
use crate::{Error, HourCycle, KeywordValue, Named, Result};

/// In the order that they are read.
#[derive(Default)]
pub struct Options {
    language: Option<Subtag>,
    script: Option<Subtag>,
    region: Option<Subtag>,
    variants: Option<Variants>,
    pub calendar: Option<KeywordValue>,
    pub collation: Option<KeywordValue>,
    first_day_of_week: Option<KeywordValue>,
    pub hour_cycle: Option<HourCycle>,
    pub case_first: Option<CaseFirst>,
    pub numeric: Option<bool>,
    pub numbering_system: Option<KeywordValue>,
}

fn subtag(text: Text<'_>, accepts: fn(&[u8]) -> bool, malformed: &'static str) -> Result<Subtag> {
    Subtag::from_text(text)
        .filter(|it| accepts(it.as_bytes()))
        .ok_or(Error::Range(malformed))
}

impl Options {
    pub fn set_language(&mut self, text: Text<'_>) -> Result<()> {
        let malformed = "language is not a well-formed language value";
        self.language = Some(subtag(text, is_language, malformed)?.to_lowercase());
        Ok(())
    }

    pub fn set_script(&mut self, text: Text<'_>) -> Result<()> {
        let malformed = "script is not a well-formed script value";
        self.script = Some(subtag(text, is_script, malformed)?.to_titlecase());
        Ok(())
    }

    pub fn set_region(&mut self, text: Text<'_>) -> Result<()> {
        let malformed = "region is not a well-formed region value";
        self.region = Some(subtag(text, is_region, malformed)?.to_uppercase());
        Ok(())
    }

    pub fn set_variants(&mut self, text: Text<'_>) -> Result<()> {
        const MALFORMED: Error = Error::Range("variants is not a well-formed variants value");

        let text = lowercase_subtags(text)?.ok_or(MALFORMED)?;
        let mut subtags = Subtags::new(&text);
        let variants = Variants::parse(&mut subtags)?.filter(|_| subtags.rest().is_empty());
        self.variants = Some(variants.ok_or(MALFORMED)?);
        Ok(())
    }

    pub fn set_first_day_of_week(&mut self, text: Text<'_>) -> Result<()> {
        // Sunday is both 0 and 7.
        let name = match text.get(0).and_then(|unit| unit.digit_value(8)) {
            Some(day) if text.len() == 1 => Text::from_ascii(WEEKDAYS[(day as usize + 6) % 7]),
            _ => text,
        };
        let value = KeywordValue::parse(Key::FIRST_DAY, name)?.ok_or(Error::Range(
            "firstDayOfWeek is not a well-formed firstDayOfWeek value",
        ))?;
        self.first_day_of_week = Some(value);
        Ok(())
    }

    /// UpdateLanguageId and MakeLocaleRecord
    pub(super) fn apply_to<'a>(&'a mut self, id: &mut LocaleId<'a>) {
        let language_id = &mut id.language_id;
        language_id.language = self.language.unwrap_or(language_id.language);
        language_id.script = self.script.or(language_id.script);
        language_id.region = self.region.or(language_id.region);
        if let Some(variants) = self.variants.take() {
            language_id.variants = variants;
        }
        let bytes = |value: &'a Option<KeywordValue>| value.as_ref().map(KeywordValue::as_bytes);
        let numeric = (self.numeric).map(|it| if it { "true" } else { "false" });
        for (key, value) in [
            (Key::CALENDAR, bytes(&self.calendar)),
            (Key::COLLATION, bytes(&self.collation)),
            (Key::FIRST_DAY, bytes(&self.first_day_of_week)),
            (Key::HOUR_CYCLE, self.hour_cycle.map(name)),
            (Key::CASE_FIRST, self.case_first.map(name)),
            (Key::NUMERIC, numeric.map(str::as_bytes)),
            (Key::NUMBERING_SYSTEM, bytes(&self.numbering_system)),
        ] {
            if let Some(value) = value {
                id.set_keyword(key, value);
            }
        }
    }
}

fn name(value: impl Named) -> &'static [u8] {
    value.as_str().as_bytes()
}

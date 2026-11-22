//! The plural form of a range ("1–2 days") by the forms of its ends. ICU4C: pluralranges.cpp

use crate::common::cstring::until_nul;
use crate::common::memory::{try_concat, try_to_vec};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::uinvchar::append_invariant_chars;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::standardplural::{PluralForm, SELECTABLE_COUNT};

/// Indexed by the form of the first number and then by that of the second.
#[derive(Clone, Copy, Default)]
pub(crate) struct StandardPluralRanges([[Option<PluralForm>; SELECTABLE_COUNT]; SELECTABLE_COUNT]);

impl ResourceSink for StandardPluralRanges {
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        for entry in value.get_array()?.iter() {
            let keywords = entry.get_array()?;
            if keywords.get_size() != 3 {
                return Err(U_RESOURCE_TYPE_MISMATCH);
            }
            let mut forms = [PluralForm::Other; 3];
            for (form, keyword) in forms.iter_mut().zip(keywords.iter()) {
                *form = PluralForm::from_keyword_units(keyword.get_string()?.iter())
                    .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
            }
            let [first, second, result] = forms;
            let row = self.0.get_mut(first.index());
            if let Some(form) = row.and_then(|row| row.get_mut(second.index())) {
                form.get_or_insert(result);
            }
        }
        Ok(())
    }
}

impl StandardPluralRanges {
    /// A language without data is not an error.
    pub(crate) fn for_language(language: &[u8]) -> Result<Self, UErrorCode> {
        let mut result = Self::default();
        let rb = ures_open_direct(None, b"pluralRanges")?;
        let Ok(set) =
            ures_get_string_by_key_with_fallback(&rb, &try_concat(&[b"locales/", language])?)
        else {
            return Ok(result);
        };
        let mut path = try_to_vec(b"rules/")?;
        append_invariant_chars(&mut path, set.iter())?;
        ures_get_all_items_with_fallback(&rb, until_nul(&path), &mut result)?;
        Ok(result)
    }

    pub(crate) fn resolve(&self, first: PluralForm, second: PluralForm) -> PluralForm {
        let row = self.0.get(first.index());
        let form = row.and_then(|row| *row.get(second.index())?);
        form.unwrap_or(PluralForm::Other)
    }
}

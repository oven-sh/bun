//! The plural form of a range ("1–2 days") by the forms of its ends. ICU4C: pluralranges.cpp

use crate::common::memory::{Appendable, try_concat, try_to_vec};
use crate::common::slice_ext::SliceExt;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::Subtag;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::standardplural::{COUNT, PluralForm};

/// Indexed by the form of the first number and then by that of the second.
#[derive(Clone, Copy)]
pub(crate) struct StandardPluralRanges([[PluralForm; COUNT]; COUNT]);

impl StandardPluralRanges {
    /// A language without data is not an error.
    pub(crate) fn for_language(language: &[u8]) -> Result<Self, UErrorCode> {
        let mut result = Self([[PluralForm::Other; COUNT]; COUNT]);
        let rb = ures_open_direct(None, b"pluralRanges")?;
        let Ok(set) =
            ures_get_string_by_key_with_fallback(&rb, &try_concat(&[b"locales/", language])?)
        else {
            return Ok(result);
        };
        let mut path = try_to_vec(b"rules/")?;
        path.add_each(invariant_prefix(set.iter()));
        let entries = rb.get_by_key_with_fallback(&path)?;
        for entry in entries.get_value().get_array()?.iter() {
            let forms = entry.get_array()?;
            let form = |index| {
                let keyword = forms.get(index).ok_or(U_RESOURCE_TYPE_MISMATCH)?;
                let keyword = Subtag::<8>::new(invariant_prefix(keyword.get_string()?.iter()));
                PluralForm::from_keyword(&keyword).ok_or(U_ILLEGAL_ARGUMENT_ERROR)
            };
            if let Some(row) = result.0.soft_get_mut(form(0)?.index()) {
                row.set(form(1)?.index(), form(2)?);
            }
        }
        Ok(result)
    }

    pub(crate) fn resolve(&self, first: PluralForm, second: PluralForm) -> PluralForm {
        let row = self.0.soft_get(first.index());
        let form = row.and_then(|row| row.soft_get(second.index()));
        form.copied().unwrap_or(PluralForm::Other)
    }
}

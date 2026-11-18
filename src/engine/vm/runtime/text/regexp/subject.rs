use bun_engine_text::Text;

use crate::{Cx, Gc, JsString, StringView};

/// What can be searched.
pub trait Subject: Copy {
    fn text(&self) -> Text<'_>;

    /// The string that has the characters.
    fn owner(&self) -> Option<Gc<JsString>>;
}

impl Subject for Text<'_> {
    #[inline(always)]
    fn text(&self) -> Text<'_> {
        *self
    }

    fn owner(&self) -> Option<Gc<JsString>> {
        None
    }
}

impl Subject for &StringView {
    #[inline(always)]
    fn text(&self) -> Text<'_> {
        StringView::text(self)
    }

    fn owner(&self) -> Option<Gc<JsString>> {
        Some(StringView::owner(self).0)
    }
}

/// Stands for the same characters for as long as the cell lives.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Identity {
    pub(super) cell: usize,
    offset_in_bytes: usize,
    length: usize,
}

impl Identity {
    pub(super) fn of(cx: &Cx, subject: impl Subject) -> Option<Identity> {
        let address = |text: Text<'_>| match text {
            Text::Latin1(characters) => characters.as_ptr_range().start.addr(),
            Text::Utf16(units) => units.as_ptr_range().start.addr(),
        };
        let (owner, text) = (subject.owner()?, subject.text());
        let whole = owner.view(cx).ok()?;
        let offset_in_bytes = address(text).checked_sub(address(whole.text()))?;
        let bytes_per_unit = if text.is_latin1() { 1 } else { 2 };
        let is_inside = whole.text().is_latin1() == text.is_latin1()
            && offset_in_bytes / bytes_per_unit + text.len() <= whole.text().len();
        is_inside.then_some(Identity {
            cell: owner.address(),
            offset_in_bytes,
            length: text.len(),
        })
    }
}

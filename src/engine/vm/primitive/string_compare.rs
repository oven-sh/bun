use core::cmp::Ordering;

use crate::{Cx, JsResult, JsString};

impl JsString {
    /// `None` unless both are atoms.
    #[inline(always)]
    pub fn equals_if_atoms(&self, other: &JsString) -> Option<bool> {
        (self.is_atom() && other.is_atom()).then(|| self.fiber() == other.fiber())
    }

    #[inline(always)]
    pub fn equals(&self, cx: &Cx, other: &JsString) -> JsResult<bool> {
        if let (Some(a), Some(b)) = (self.try_impl(), other.try_impl()) {
            return Ok(a == b);
        }
        Ok(self.len() == other.len() && self.rope_equals(cx, other)?)
    }

    /// They are as long as each other. `None` if characters have to be put together.
    #[inline(always)]
    pub(crate) fn equals_in_pieces(&self, other: &JsString) -> Option<bool> {
        match (self.try_view(), other.try_view()) {
            (Some(a), Some(b)) => Some(a.text() == b.text()),
            (None, Some(view)) => self.fibers_equal(view.text()),
            (Some(view), None) => other.fibers_equal(view.text()),
            (None, None) => None,
        }
    }

    #[inline(never)]
    fn rope_equals(&self, cx: &Cx, other: &JsString) -> JsResult<bool> {
        if let Some(result) = self.equals_in_pieces(other) {
            return Ok(result);
        }
        Ok(self.view(cx)?.text() == other.view(cx)?.text())
    }

    #[inline]
    pub fn compare(&self, cx: &Cx, other: &JsString) -> JsResult<Ordering> {
        Ok(self.view(cx)?.text().cmp(&other.view(cx)?.text()))
    }
}

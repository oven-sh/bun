use bun_engine_text::Text;
use bun_engine_unicode::is_str_white_space;

use crate::{Cx, Gc, JsResult, JsString};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TrimSides {
    Start,
    End,
    Both,
}

/// No string is so long that it matters whether a position is beyond what an `i32` holds or at its limit.
impl JsString {
    #[inline(always)]
    fn clamp_relative_position(&self, position: i32) -> u32 {
        if position < 0 {
            self.len().saturating_sub(position.unsigned_abs())
        } else {
            (position as u32).min(self.len())
        }
    }

    /// `String.prototype.slice`
    #[inline]
    pub fn slice(&self, cx: &Cx, start: i32, end: i32) -> JsResult<Gc<JsString>> {
        let start = self.clamp_relative_position(start);
        self.substring(cx, start, self.clamp_relative_position(end).max(start))
    }

    /// `String.prototype.substring`
    #[inline]
    pub fn substring_between(&self, cx: &Cx, a: i32, b: i32) -> JsResult<Gc<JsString>> {
        let (a, b) = (self.clamp_position(a), self.clamp_position(b));
        self.substring(cx, a.min(b), a.max(b))
    }

    /// `String.prototype.substr`
    #[inline]
    pub fn substr(&self, cx: &Cx, start: i32, length: i32) -> JsResult<Gc<JsString>> {
        let start = self.clamp_relative_position(start);
        self.substring(cx, start, (start + length.max(0) as u32).min(self.len()))
    }

    /// `None` outside the string.
    #[inline(always)]
    pub fn get_unit(&self, cx: &Cx, position: i32) -> JsResult<Option<u16>> {
        Ok(self.view(cx)?.text().get(position as u32 as usize))
    }

    /// `String.prototype.at`
    #[inline]
    pub fn at(&self, cx: &Cx, position: i32) -> JsResult<Option<Gc<JsString>>> {
        let from = if position < 0 { self.len() as i32 } else { 0 };
        let unit = self.get_unit(cx, from + position)?;
        Ok(unit.map(|unit| Self::from_unit(cx, unit)))
    }

    /// TrimString
    #[inline]
    pub fn trim(&self, cx: &Cx, sides: TrimSides) -> JsResult<Gc<JsString>> {
        let is_white_space = |unit: u16| is_str_white_space(unit.into());
        let view = self.view(cx)?;
        let text: Text<'_> = view.text();
        let range = match sides {
            TrimSides::Start => text.leading_len(is_white_space)..text.len(),
            TrimSides::End => 0..text.len() - text.trailing_len(is_white_space),
            TrimSides::Both => text.trimmed_range(is_white_space),
        };
        if range.len() == text.len() {
            return Ok(self.into());
        }
        Ok(view.substring(cx, range))
    }
}

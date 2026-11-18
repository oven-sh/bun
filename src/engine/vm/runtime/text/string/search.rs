use crate::primitive::FiberSearch;
use crate::{Cx, JsResult, JsString};

impl JsString {
    /// The index that a position stands for where a negative one does not count from the end.
    #[inline(always)]
    pub fn clamp_position(&self, position: i32) -> u32 {
        (position.max(0) as u32).min(self.len())
    }

    /// The first index of `search` at or after `start`.
    #[inline]
    pub fn index_of(&self, cx: &Cx, search: &JsString, start: u32) -> JsResult<Option<u32>> {
        if u64::from(start) + u64::from(search.len()) > u64::from(self.len()) {
            return Ok(None);
        }
        let search = search.view(cx)?;
        if search.text().len() == 1 {
            return self.index_of_unit(cx, search.text().at(0), start);
        }
        let found = self.view(cx)?.text().find(search.text(), start as usize);
        Ok(found.map(|index| index as u32))
    }

    #[inline]
    pub fn index_of_unit(&self, cx: &Cx, unit: u16, mut start: u32) -> JsResult<Option<u32>> {
        if self.is_worth_walking() {
            match self.find_unit_in_fibers(unit, start) {
                FiberSearch::Done(found) => return Ok(found),
                FiberSearch::GoOnFrom(index) => start = index,
            }
        }
        let found = self.view(cx)?.text().find_unit(unit, start as usize);
        Ok(found.map(|index| index as u32))
    }

    /// The last index of `search` at or before `start`.
    #[inline]
    pub fn last_index_of(&self, cx: &Cx, search: &JsString, start: u32) -> JsResult<Option<u32>> {
        if search.len() > self.len() {
            return Ok(None);
        }
        let search = search.view(cx)?;
        if search.text().len() == 1 {
            return self.last_index_of_unit(cx, search.text().at(0), start);
        }
        let found = self.view(cx)?.text().rfind(search.text(), start as usize);
        Ok(found.map(|index| index as u32))
    }

    #[inline]
    pub fn last_index_of_unit(&self, cx: &Cx, unit: u16, start: u32) -> JsResult<Option<u32>> {
        let mut end = start.saturating_add(1);
        if self.is_worth_walking() {
            match self.rfind_unit_in_fibers(unit, end) {
                FiberSearch::Done(found) => return Ok(found),
                FiberSearch::GoOnFrom(index) => end = index,
            }
        }
        let found = self.view(cx)?.text().rfind_unit(unit, end as usize);
        Ok(found.map(|index| index as u32))
    }

    /// Whether `search` is at `start`.
    #[inline]
    pub fn starts_with(&self, cx: &Cx, search: &JsString, start: u32) -> JsResult<bool> {
        let end = u64::from(start) + u64::from(search.len());
        if end > u64::from(self.len()) {
            return Ok(false);
        }
        let search = search.view(cx)?;
        if self.is_worth_walking() {
            let (fiber, start) = self.fiber_containing(start..end as u32);
            if let Some(view) = fiber.try_view() {
                return Ok((view.text().slice_from(start as usize)).starts_with(search.text()));
            }
        }
        Ok(self.view(cx)?.text().slice(start as usize..end as usize) == search.text())
    }

    /// Whether `search` ends at `end`.
    #[inline]
    pub fn ends_with(&self, cx: &Cx, search: &JsString, end: u32) -> JsResult<bool> {
        match end.checked_sub(search.len()) {
            Some(start) => self.starts_with(cx, search, start),
            None => Ok(false),
        }
    }
}

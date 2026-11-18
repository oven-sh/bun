//! What can be found out about a rope without putting its characters together.

use core::marker::PhantomData;
use core::ops::Range;

use bun_engine_text::Text;
use smallvec::{SmallVec, smallvec};

use super::string::impl_at;
use crate::{Cx, Gc, JsResult, JsRopeString, JsString, NoGc};

/// The runs of characters that a string consists of.
pub struct Pieces<'a, const REVERSED: bool> {
    /// The addresses of strings that the first one keeps alive.
    pending: SmallVec<[usize; 16]>,
    string: PhantomData<&'a JsString>,
}

impl<'a, const REVERSED: bool> Iterator for Pieces<'a, REVERSED> {
    type Item = Text<'a>;

    #[inline]
    fn next(&mut self) -> Option<Text<'a>> {
        // SAFETY: nothing is collected or resolved for `'a`.
        let mut string = unsafe { Gc::<JsString>::from_address(self.pending.pop()?) };
        while let Some(rope) = string.as_concatenation() {
            let mut fibers = rope.fiber_list();
            if !REVERSED {
                fibers.reverse();
            }
            let mut fibers = fibers.into_iter().flatten();
            string = fibers.next_back()?;
            self.pending.extend(fibers.map(Gc::address));
        }
        let (owner, offset) = string.try_view()?.owner();
        // SAFETY: as above, and nothing releases what is swapped for an atom either.
        let text = unsafe { impl_at(owner.fiber()).as_ref() }.text();
        Some(text.slice(offset as usize..(offset + string.len()) as usize))
    }
}

impl JsRopeString {
    #[inline(always)]
    fn fiber_list(&self) -> [Option<Gc<JsString>>; 3] {
        let (first, second, third) = self.fibers();
        [Some(first), Some(second), third]
    }

    /// With the range that each takes up.
    #[inline(always)]
    fn placed_fibers(&self) -> impl DoubleEndedIterator<Item = (Gc<JsString>, Range<u32>)> + use<> {
        let mut end = 0;
        let placed = self.fiber_list().map(|fiber| {
            let (fiber, start) = (fiber?, end);
            end += fiber.len();
            Some((fiber, start..end))
        });
        placed.into_iter().flatten()
    }
}

/// How a search in the fibers of a concatenation has ended.
pub(crate) enum FiberSearch {
    Done(Option<u32>),
    /// At a fiber that has fibers itself.
    GoOnFrom(u32),
}

impl JsString {
    /// Shorter ones are put together at once.
    const MIN_LENGTH_TO_WALK: u32 = 0x128;

    pub fn pieces<'a>(&'a self, _: &'a NoGc<'_>) -> Pieces<'a, false> {
        Pieces {
            pending: smallvec![self.address()],
            string: PhantomData,
        }
    }

    /// From the last to the first, which takes no memory for a string that has grown at its end.
    pub fn pieces_reversed<'a>(&'a self, _: &'a NoGc<'_>) -> Pieces<'a, true> {
        Pieces {
            pending: smallvec![self.address()],
            string: PhantomData,
        }
    }

    #[inline(always)]
    pub(crate) fn is_worth_walking(&self) -> bool {
        self.is_concatenation() && self.len() >= Self::MIN_LENGTH_TO_WALK
    }

    /// Whether it has these characters, which are as many. `None` if that is not found out in a few steps, or it is
    /// asked again and again. `self` is a concatenation.
    pub(crate) fn fibers_equal(&self, mut text: Text<'_>) -> Option<bool> {
        const MAX_DEPTH: usize = 4;
        let mut rope = self.as_concatenation()?;
        for _ in 0..MAX_DEPTH {
            let (first, second, third) = rope.fibers();
            for fiber in [third, Some(second)].into_iter().flatten() {
                let start = text.len() - fiber.len() as usize;
                if fiber.try_view()?.text() != text.slice_from(start) {
                    return Some(false);
                }
                text = text.slice(0..start);
            }
            if rope.address() == self.address() && self.is_read_again() {
                return None;
            }
            match first.as_concatenation() {
                Some(inner) => rope = inner,
                None => return Some(first.try_view()?.text() == text),
            }
        }
        None
    }

    /// The innermost string, a few levels down at most, that has all of the range, and where it starts there.
    pub(crate) fn fiber_containing(&self, range: Range<u32>) -> (Gc<JsString>, u32) {
        const MAX_DEPTH: usize = 8;
        let (mut string, mut start, length) = (Gc::from(self), range.start, range.len() as u32);
        for _ in 0..MAX_DEPTH {
            let Some((fiber, place)) = string.as_concatenation().and_then(|rope| {
                (rope.placed_fibers()).find(|(_, it)| it.start <= start && start + length <= it.end)
            }) else {
                break;
            };
            (string, start) = (fiber, start - place.start);
        }
        (string, start)
    }

    /// The first index of `unit` at or after `start`. `self` is a concatenation.
    pub(crate) fn find_unit_in_fibers(&self, unit: u16, start: u32) -> FiberSearch {
        let fibers = self.as_rope().expect("a rope").placed_fibers();
        for (fiber, place) in fibers.filter(|(_, place)| start < place.end) {
            let Some(view) = fiber.try_view() else {
                return FiberSearch::GoOnFrom(start.max(place.start));
            };
            let from = start.saturating_sub(place.start) as usize;
            if let Some(index) = view.text().find_unit(unit, from) {
                return FiberSearch::Done(Some(place.start + index as u32));
            }
        }
        FiberSearch::Done(None)
    }

    /// The last index of `unit` before `end`. `self` is a concatenation.
    pub(crate) fn rfind_unit_in_fibers(&self, unit: u16, end: u32) -> FiberSearch {
        let fibers = self.as_rope().expect("a rope").placed_fibers();
        for (fiber, place) in fibers.rev().filter(|(_, place)| place.start < end) {
            let Some(view) = fiber.try_view() else {
                return FiberSearch::GoOnFrom(end.min(place.end));
            };
            if let Some(index) = view.text().rfind_unit(unit, (end - place.start) as usize) {
                return FiberSearch::Done(Some(place.start + index as u32));
            }
        }
        FiberSearch::Done(None)
    }

    /// A rope that shares all fibers but those with the first `unit`. `None` if there is none, or it is too far in.
    pub(crate) fn replace_unit_in_fibers(
        &self,
        cx: &Cx,
        unit: u16,
        replacement: Gc<JsString>,
    ) -> JsResult<Option<Gc<JsString>>> {
        const MAX_VISITS: usize = 256;
        // The address of a concatenation that `self` keeps alive, and which of its fibers is being searched.
        let mut path = SmallVec::<[(usize, usize); 16]>::new();
        // SAFETY: nothing is resolved before this returns.
        let fibers_at = |rope| unsafe { Gc::<JsRopeString>::from_address(rope) }.fiber_list();
        let mut current = Gc::from(self);
        for _ in 0..MAX_VISITS {
            let Some(view) = current.try_view() else {
                path.push((current.address(), 0));
                current = current.as_rope().expect("a rope").fibers().0;
                continue;
            };
            if let Some(index) = view.text().find_unit(unit, 0) {
                let before = view.substring(cx, 0..index);
                let after = view.substring(cx, index + 1..view.text().len());
                let mut result = Self::concat3(cx, before, replacement, after)?;
                for &(rope, which) in path.iter().rev() {
                    let mut fibers = fibers_at(rope);
                    fibers[which] = Some(result);
                    let [a, b, c] = fibers.map(|it| it.unwrap_or_else(|| cx.small_strings.empty()));
                    result = Self::concat3(cx, a, b, c)?;
                }
                Gc::from(self).keep_alive();
                return Ok(Some(result));
            }
            current = loop {
                let Some((rope, which)) = path.last_mut() else {
                    return Ok(None);
                };
                *which += 1;
                match fibers_at(*rope).get(*which) {
                    Some(&Some(next)) => break next,
                    _ => path.pop(),
                };
            };
        }
        Ok(None)
    }
}

use core::cell::RefCell;

use bun_engine_text::{StringImpl, StringRef};

use crate::{Gc, GcFree, ImmutableArray, Match, RegExp, Visitor, Vm};

struct Entry {
    subject: StringRef,
    regexp: usize,
    result: usize,
    last: Option<Match>,
}

/// What a pattern has made of a string that is likely to come again. At each collection it is either visited or cleared.
pub(super) struct ResultCache<const SIZE: usize>(RefCell<Vec<Option<Entry>>>);

// SAFETY: see above.
unsafe impl<const SIZE: usize> GcFree for ResultCache<SIZE> {}

impl<const SIZE: usize> Default for ResultCache<SIZE> {
    fn default() -> Self {
        ResultCache(RefCell::default())
    }
}

impl<const SIZE: usize> ResultCache<SIZE> {
    #[inline]
    fn places(subject: &StringImpl, regexp: &RegExp) -> [usize; 2] {
        let first = (subject.address() ^ regexp.address()) >> 4;
        [first % SIZE, (first + 1) % SIZE]
    }

    /// With the last match.
    #[inline]
    pub(super) fn get(
        &self,
        _: &Vm,
        subject: &StringImpl,
        regexp: &RegExp,
    ) -> Option<(Gc<ImmutableArray>, Option<Match>)> {
        let entries = self.0.borrow();
        Self::places(subject, regexp).into_iter().find_map(|place| {
            let entry = entries.get(place)?.as_ref()?;
            let is_hit = entry.subject.ptr_eq(subject) && entry.regexp == regexp.address();
            // SAFETY: alive, as long as it is in the cache.
            is_hit.then(|| (unsafe { Gc::from_address(entry.result) }, entry.last))
        })
    }

    pub(super) fn insert(
        &self,
        subject: &StringImpl,
        regexp: &RegExp,
        result: Gc<ImmutableArray>,
        last: Option<Match>,
    ) {
        let mut entries = self.0.borrow_mut();
        entries.resize_with(SIZE, || None);
        let [first, second] = Self::places(subject, regexp);
        let place = match (&entries[first], &entries[second]) {
            (None, _) => first,
            (_, None) => second,
            _ => {
                entries[second] = None;
                first
            }
        };
        entries[place] = Some(Entry {
            subject: StringRef::retain(subject),
            regexp: regexp.address(),
            result: result.address(),
            last,
        });
    }

    pub(super) fn visit(&self, visitor: &mut Visitor) {
        for entry in self.0.borrow().iter().flatten() {
            // SAFETY: as in `get`.
            unsafe {
                visitor.append_word(entry.regexp as u64);
                visitor.append_word(entry.result as u64);
            }
        }
    }

    pub(super) fn clear(&self) {
        self.0.take();
    }
}

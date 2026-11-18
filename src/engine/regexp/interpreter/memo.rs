//! The states that a search has been in.
//!
//! All that follows a state has been tried in vain when the search comes to it again, since success ends the search.
//! That does not hold inside a lookaround, whose success does not, and for what is noted without regard to the
//! captures, once one is read. Such marks are on trial until the search has gone back behind them.

use super::table::{Key, Table};
use crate::program::{Direction, Site, SiteId, Sites};

/// A site and what the rest of the pattern depends on there.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct State {
    tag: u32,
    circumstances: [u32; 2],
}

const IS_TAG: u32 = 1;
const OF_SUCCESS: u32 = 2;
const IGNORES_CAPTURES: u32 = 4;
const BITS_BELOW_SITE: u32 = 3;

impl State {
    #[inline]
    pub(super) fn new(site: SiteId, ignores_captures: bool, it: &Circumstances) -> State {
        let kind = u32::from(ignores_captures) * IGNORES_CAPTURES;
        State {
            tag: site.0 << BITS_BELOW_SITE | kind | IS_TAG,
            circumstances: it.last,
        }
    }

    /// Has the marks for the positions from which the lookaround has succeeded.
    pub(super) fn of_success(self) -> State {
        State {
            tag: self.tag | OF_SUCCESS,
            ..self
        }
    }

    fn site(self) -> usize {
        (self.tag >> BITS_BELOW_SITE) as usize
    }

    fn ignores_captures(self) -> bool {
        self.tag & IGNORES_CAPTURES != 0
    }

    #[inline(always)]
    fn recent(self) -> usize {
        (self.tag / 2) as usize % RECENT
    }

    #[inline(always)]
    fn key(self, word: u32) -> Key {
        Key::new([self.tag, self.circumstances[0], self.circumstances[1], word])
    }
}

/// A list of numbers, which has the same length for all states of a kind at a site.
#[derive(Default)]
pub(super) struct Circumstances {
    /// The first stands for all before the second.
    last: [u32; 2],
    count: u32,
}

/// Marks from one position to another, in the direction of the site.
#[derive(Clone, Copy)]
struct OnTrial {
    state: State,
    first: u32,
    last: u32,
    depth: u32,
    direction: Direction,
    /// The search has come back to the last position, from after the visit or from further on.
    is_last_in_doubt: bool,
}

/// The words that have bits for the positions, and the bits.
fn words_between(a: u32, b: u32) -> impl Iterator<Item = (u32, u64)> {
    let (low, high) = (a.min(b), a.max(b));
    (low / 64..=high / 64).map(move |word| {
        let (from, to) = (low.max(word * 64) % 64, high.min(word * 64 + 63) % 64);
        (word, u64::MAX << from & u64::MAX >> (63 - to))
    })
}

/// The bits of 64 positions for a state.
#[derive(Clone, Copy)]
pub(super) struct Word(usize);

const RECENT: usize = 256;
const SITES_TRUSTED: usize = 64;
const WORK_OF_TRIAL: u64 = 48;

/// How often the marks that ignore captures can turn out to be wrong before a site goes without them for a while.
const TRUST: i16 = 16;
const VISITS_WITHOUT_TRUST: i16 = 256;

pub(crate) struct Memo {
    marks: Table,
    /// Gives numbers to lists of numbers, and to captured texts the place where they were first seen.
    names: Table,
    /// By tag: the slot of `marks` that was used last.
    recent: [u32; RECENT],
    trust: [i16; SITES_TRUSTED],
    trail: Vec<OnTrial>,
    /// None of the trail before this ignores captures.
    first_unread: usize,
    /// The lookarounds that the search is inside of.
    depth: u32,
    /// Where the last match has ended, so that marks outside of lookarounds do not hold there.
    end_of_match: usize,
    matches: u32,
    max_size: usize,
    work: u64,
}

impl Memo {
    pub(crate) fn new() -> Memo {
        Memo {
            marks: Table::default(),
            names: Table::default(),
            recent: [0; RECENT],
            trust: [TRUST; SITES_TRUSTED],
            trail: Vec::new(),
            first_unread: 0,
            depth: 0,
            end_of_match: usize::MAX,
            matches: 0,
            max_size: 0,
            work: 0,
        }
    }

    pub(crate) fn size(&self) -> usize {
        self.marks.size() + self.names.size() + self.trail.capacity() * size_of::<OnTrial>()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.marks.len() == 0
    }

    pub(crate) fn set_max_size(&mut self, bytes: usize) {
        self.max_size = bytes;
    }

    pub(crate) fn clear(&mut self) {
        self.marks.clear();
        self.names.clear();
        self.trail.clear();
        self.trust = [TRUST; SITES_TRUSTED];
        (self.first_unread, self.depth) = (0, 0);
        (self.end_of_match, self.matches) = (usize::MAX, 0);
    }

    /// For when the present attempt is known to fail, or the search to end with a match.
    pub(crate) fn abandon_attempt(&mut self) {
        while let Some(marks) = self.trail.pop() {
            self.erase(marks);
        }
        (self.first_unread, self.depth) = (0, 0);
    }

    /// The marks from there on serve the next search.
    pub(crate) fn note_match(&mut self, end: u32) {
        self.abandon_attempt();
        self.end_of_match = end as usize;
        match self.matches.checked_add(1).filter(|&it| it < 1 << 30) {
            Some(matches) => self.matches = matches,
            None => self.clear(),
        }
    }

    #[inline]
    pub(super) fn take_work(&mut self) -> u64 {
        use core::mem::take;
        take(&mut self.work) + take(&mut self.marks.work) + take(&mut self.names.work)
    }

    #[inline]
    pub(super) fn is_end_of_match(&self, site: &Site, position: usize) -> bool {
        position == self.end_of_match && site.depth == 0
    }

    /// Whether to note a visit without regard to the captures.
    #[inline]
    pub(super) fn trusts(&mut self, site: SiteId) -> bool {
        let trust = &mut self.trust[site.index() % SITES_TRUSTED];
        if *trust <= 0 {
            *trust -= 1;
            if *trust == -VISITS_WITHOUT_TRUST {
                *trust = 1;
            }
        }
        *trust > 0
    }

    #[cold]
    fn empty_marks(&mut self) {
        self.marks.empty();
        self.trail.clear();
        self.first_unread = 0;
    }

    /// The value for the key, which is `new` if there was none. Nothing if all names and states are void.
    fn name(&mut self, key: [u32; 4], new: u64) -> Option<u64> {
        if !self.names.make_room(self.max_size / 4) {
            self.names.empty();
            self.empty_marks();
            return None;
        }
        let index = self.names.find_or_add(Key::new(key));
        let name = self.names.value(index);
        if *name == 0 {
            *name = new;
        }
        Some(*name)
    }

    /// Where a text with that hash and length was first seen.
    pub(super) fn first_with(&mut self, hash: u64, length: u32, start: u32) -> Option<u32> {
        let key = [u32::MAX, hash as u32, (hash >> 32) as u32, length];
        Some(self.name(key, u64::from(start) + 1)? as u32 - 1)
    }

    #[inline(always)]
    pub(super) fn append(&mut self, list: &mut Circumstances, number: u32) -> Option<()> {
        let [mut first, second] = list.last;
        match list.count {
            0 | 1 => first = second,
            count => {
                let unused = self.names.len() as u64 + 1;
                first = self.name([count, first, second, 0], unused)? as u32;
            }
        }
        (list.last, list.count) = ([first, number], list.count + 1);
        Some(())
    }

    /// Whether two words can be had.
    #[inline(always)]
    pub(super) fn make_room(&mut self) -> bool {
        self.marks.make_room(self.max_size / 2) || {
            self.empty_marks();
            self.marks.make_room(0)
        }
    }

    #[inline(always)]
    fn find_or_add(&mut self, state: State, word: u32) -> Word {
        let (key, recent) = (state.key(word), &mut self.recent[state.recent()]);
        if !self.marks.has_at(*recent as usize, key) {
            *recent = self.marks.find_or_add(key) as u32;
        }
        Word(*recent as usize)
    }

    #[inline]
    fn find(&mut self, state: State, word: u32) -> Option<Word> {
        let (key, recent) = (state.key(word), &mut self.recent[state.recent()]);
        if !self.marks.has_at(*recent as usize, key) {
            *recent = self.marks.find(key)? as u32;
        }
        Some(Word(*recent as usize))
    }

    /// The one with the bit `position % 64` for the position. There is room.
    #[inline(always)]
    pub(super) fn word(&mut self, state: State, site: &Site, position: usize) -> Word {
        match self.is_end_of_match(site, position) {
            true => self.find_or_add(state, !self.matches),
            false => self.find_or_add(state, (position / 64) as u32),
        }
    }

    #[inline]
    pub(super) fn bits(&mut self, word: Word) -> &mut u64 {
        self.marks.value(word.0)
    }

    pub(super) fn has_succeeded(&mut self, state: State, position: usize) -> bool {
        let word = self.find(state.of_success(), (position / 64) as u32);
        word.is_some_and(|it| *self.bits(it) >> (position % 64) & 1 != 0)
    }

    /// Whether two ranges of marks can be put on trial.
    #[inline]
    pub(super) fn can_try(&mut self) -> bool {
        self.trail.len() + 2 <= self.trail.capacity() || self.lengthen_trail()
    }

    #[cold]
    fn lengthen_trail(&mut self) -> bool {
        let more = self.trail.len().max(16);
        (self.trail.len() + more) * size_of::<OnTrial>() <= self.max_size / 4
            && self.trail.try_reserve_exact(more).is_ok()
    }

    pub(super) fn put_on_trial(&mut self, state: State, site: &Site, first: usize, last: usize) {
        self.work += WORK_OF_TRIAL;
        let follows = |before: &OnTrial| match site.direction {
            _ if before.state != state || before.is_last_in_doubt => false,
            Direction::Forward => before.last as usize + 1 == first,
            Direction::Backward => before.last as usize == first + 1,
        };
        match self.trail.last_mut() {
            Some(before) if follows(before) => before.last = last as u32,
            _ => self.trail.push(OnTrial {
                state,
                first: first as u32,
                last: last as u32,
                depth: site.depth,
                direction: site.direction,
                is_last_in_doubt: false,
            }),
        }
    }

    /// After a failure.
    #[inline]
    pub(super) fn go_back_to(&mut self, position: usize) {
        if !self.trail.is_empty() {
            self.confirm_beyond(position as u32);
        }
    }

    fn confirm_beyond(&mut self, position: u32) {
        let depth = self.depth;
        let is_beyond = |other: u32, marks: &OnTrial| match marks.direction {
            _ if marks.depth != depth => false,
            Direction::Forward => other > position,
            Direction::Backward => other < position,
        };
        while let Some(marks) = self.trail.pop_if(|it| is_beyond(it.first, it)) {
            if marks.state.ignores_captures() {
                let trust = &mut self.trust[marks.state.site() % SITES_TRUSTED];
                *trust = (*trust + 1).clamp(1, TRUST);
            }
        }
        self.first_unread = self.first_unread.min(self.trail.len());
        for marks in self.trail.iter_mut().rev() {
            if is_beyond(marks.last, marks) {
                (marks.last, marks.is_last_in_doubt) = (position, false);
            }
            if marks.depth != depth || marks.last != position || marks.is_last_in_doubt {
                break;
            }
            marks.is_last_in_doubt = true;
        }
    }

    fn erase(&mut self, marks: OnTrial) {
        let at_end = marks.depth == 0 && marks.first as usize == self.end_of_match;
        let of_end = at_end.then_some((!self.matches, u64::MAX));
        for (word, bits) in words_between(marks.first, marks.last).chain(of_end) {
            if let Some(word) = self.find(marks.state, word) {
                *self.bits(word) &= !bits;
            }
        }
        self.work += WORK_OF_TRIAL;
    }

    fn note_success(&mut self, mut marks: OnTrial) {
        if marks.is_last_in_doubt {
            let first = marks.last;
            self.erase(OnTrial { first, ..marks });
            match marks.direction {
                _ if marks.first == marks.last => return,
                Direction::Forward => marks.last -= 1,
                Direction::Backward => marks.last += 1,
            }
        }
        for (word, bits) in words_between(marks.first, marks.last) {
            if !self.marks.make_room(self.max_size / 2) {
                return self.empty_marks();
            }
            let word = self.find_or_add(marks.state.of_success(), word);
            *self.bits(word) |= bits;
        }
        self.work += WORK_OF_TRIAL;
    }

    pub(super) fn enter_look(&mut self, depth: u32) {
        self.depth = depth;
    }

    pub(super) fn leave_look(&mut self, depth: u32, has_found: bool, sites: &Sites) {
        while let Some(marks) = self.trail.pop_if(|it| it.depth == depth) {
            match (has_found, sites.sites[marks.state.site()].look) {
                (false, _) => {}
                (true, None) => self.erase(marks),
                (true, Some(_)) => self.note_success(marks),
            }
        }
        self.first_unread = self.first_unread.min(self.trail.len());
        self.depth = depth - 1;
    }

    /// What happens from now on depends on the captures.
    #[inline]
    pub(super) fn note_read(&mut self) {
        if self.first_unread != self.trail.len() {
            self.erase_what_ignores_captures();
        }
    }

    fn erase_what_ignores_captures(&mut self) {
        let mut kept = self.first_unread;
        for index in self.first_unread..self.trail.len() {
            let marks = self.trail[index];
            if marks.state.ignores_captures() {
                let trust = &mut self.trust[marks.state.site() % SITES_TRUSTED];
                *trust = (*trust - 1).max(0);
                self.erase(marks);
            } else {
                self.trail[kept] = marks;
                kept += 1;
            }
        }
        self.trail.truncate(kept);
        self.first_unread = kept;
    }
}

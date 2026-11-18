//! What a site remembers besides the case that its instruction has room for.

use core::alloc::Layout;
use core::cell::Cell;
use core::mem::offset_of;
use core::ops::Deref;
use core::ptr::NonNull;

use bun_engine_text::{Identifier, PropertyName, StringImpl, StringRef};

use super::{AccessCase, AccessKind, Key, KeyedCase, PrototypeLookup};
use crate::caches::{ENTRY_SHIFT, LoadEntry, name_hash};
use crate::code::metadata::Entry;
use crate::heap::Survivors;
use crate::{CodeBlock, Gc, JsCell, ShapeId, Visitor, Vm};

/// The cases follow. Whoever calls out does not look at it again: it may be gone.
#[repr(C)]
pub struct CaseList {
    /// For each case, see `tag`. The others are `NO_TAG`.
    tags: [Cell<u32>; AccessCases::MAX_CASES],
    len: Cell<u8>,
    capacity: u8,
    /// Of a site that has an inline case: counts up to zero. Then the slow path is taken, which sees whether that case
    /// is the best one.
    turns: Cell<u16>,
    last: Cell<Last>,
    additions: Cell<u8>,
    samples: Cell<u8>,
    keyed: KeyedCase,
}

const _: () = {
    assert!(ShapeId::LAST_BITS & CaseList::NO_TAG == 0);
    assert!(align_of::<StringImpl>() > CaseList::NO_TAG as usize);
    assert!(align_of::<JsCell>() > CaseList::NO_TAG as usize);
};

/// What a case is searched by. With the key it tells the shape.
#[inline(always)]
const fn tag(shape: ShapeId, key: usize) -> u32 {
    shape.bits() ^ key as u32
}

impl CaseList {
    /// Of a word of 32 bits, to which adding `TURN` carries when the count runs out.
    pub const OFFSET_OF_TURNS: usize = offset_of!(CaseList, len);
    pub const TURN: i32 = 1 << (8 * (offset_of!(CaseList, turns) - Self::OFFSET_OF_TURNS));
    pub const OFFSET_OF_KEYED: usize = offset_of!(CaseList, keyed);
    /// Neither a shape nor a key is odd.
    const NO_TAG: u32 = 1;
    /// A site that needs more in a short time keeps seeing new shapes, or its cases do not last.
    const MAX_ADDITIONS: u8 = 24;
    const SAMPLES_PER_ROUND: u8 = 8;
    /// No divisor in common with the number of shapes that a loop is likely to alternate between.
    const TURNS_BETWEEN_SAMPLES: u16 = 7;
    const TURNS_BEFORE_SAMPLING: u16 = 32;

    pub const fn offset_of_tag(index: usize) -> usize {
        offset_of!(CaseList, tags) + index * size_of::<u32>()
    }

    pub const fn offset_of_case(index: usize) -> usize {
        size_of::<CaseList>() + index * size_of::<AccessCase>()
    }

    fn layout(capacity: u8) -> Layout {
        let size = Self::offset_of_case(capacity.into());
        Layout::from_size_align(size, align_of::<AccessCase>()).expect("small")
    }

    fn create(capacity: u8, last: Last) -> NonNull<CaseList> {
        // SAFETY: the size is not zero, and has room for the header.
        unsafe {
            let memory = NonNull::new(std::alloc::alloc(Self::layout(capacity)));
            let list = (memory.unwrap_or_else(|| bun_alloc::out_of_memory())).cast::<CaseList>();
            list.write(CaseList {
                tags: [const { Cell::new(Self::NO_TAG) }; _],
                turns: Cell::new(Self::TURNS_BEFORE_SAMPLING.wrapping_neg()),
                len: Cell::new(0),
                capacity,
                last: Cell::new(last),
                additions: Cell::new(0),
                samples: Cell::new(0),
                keyed: KeyedCase::default(),
            });
            list
        }
    }

    #[inline(always)]
    fn len(&self) -> usize {
        self.len.get().into()
    }

    #[inline(always)]
    fn case_ptr(&self, index: usize) -> *mut AccessCase {
        let address = core::ptr::from_ref(self).addr() + Self::offset_of_case(index);
        core::ptr::with_exposed_provenance_mut(address)
    }

    #[inline(always)]
    pub fn keyed(&self) -> &KeyedCase {
        &self.keyed
    }

    #[inline(always)]
    pub(super) fn cases(&self) -> &[AccessCase] {
        // SAFETY: those below the length have been written.
        unsafe { core::slice::from_raw_parts(self.case_ptr(0), self.len()) }
    }

    /// The count of the key comes with the case.
    fn set(&self, index: usize, case: &AccessCase) {
        assert!(index < self.capacity.into());
        self.tags[index].set(tag(case.shape(), case.key.get()));
        // SAFETY: allocated with that many.
        unsafe { case.write_to(self.case_ptr(index)) };
    }

    fn push(&self, owner: &CodeBlock, case: &AccessCase) {
        self.set(self.len(), case);
        self.len.update(|len| len + 1);
        owner.did_get_case(case);
    }

    /// `key` is the address of a name or an object.
    #[inline(always)]
    pub fn find(&self, shape: ShapeId, key: usize) -> Option<&AccessCase> {
        let wanted = tag(shape, key);
        debug_assert!(wanted != Self::NO_TAG);
        (0..AccessCases::MAX_CASES)
            .filter(|&index| self.tags[index].get() == wanted)
            // SAFETY: only a case that has been written has such a tag.
            .map(|index| unsafe { &*self.case_ptr(index) })
            .find(|case| case.key.get() == key)
    }

    /// In a list whose cases have no keys.
    #[inline(always)]
    pub fn find_by_shape(&self, shape: ShapeId) -> Option<&AccessCase> {
        let index = (self.tags.iter()).position(|it| it.get() == shape.bits())?;
        // SAFETY: as above.
        Some(unsafe { &*self.case_ptr(index) })
    }

    /// Or else the case for any key.
    #[inline(always)]
    pub(super) fn find_by_name(
        &self,
        shape: ShapeId,
        name: PropertyName<'_>,
        key: Key,
    ) -> Option<&AccessCase> {
        match key {
            Key::Fixed => self.find_by_shape(shape),
            Key::Variable => (self.find(shape, name.address()))
                .or_else(|| self.find(shape, 0).filter(|_| !name.is_private())),
        }
    }

    fn retain(&self, keep: impl Fn(&AccessCase) -> bool) {
        let mut kept = 0;
        for (index, case) in self.cases().iter().enumerate() {
            if keep(case) {
                if kept != index {
                    self.set(kept, case);
                }
                kept += 1;
            } else if let Some(name) = case.name() {
                // SAFETY: the count that the list has held.
                drop(unsafe { StringRef::from_raw(name) });
            }
        }
        self.tags[kept..].iter().for_each(|it| it.set(Self::NO_TAG));
        self.len.set(kept as u8);
    }

    #[inline(never)]
    fn reconcile(&self, survivors: &Survivors) {
        self.retain(|case| case.is_live(survivors));
        (self.cases().iter()).for_each(|case| case.renew(survivors.vm()));
        self.additions.update(|count| count / 2);
        self.keyed.reconcile(self.cases(), survivors);
    }

    /// True if the time has come to take the slow path.
    #[inline(always)]
    pub fn count_turn(&self) -> bool {
        self.turns.update(|it| it.wrapping_add(1));
        self.turns.get() == 0
    }

    /// Ends a round of samples.
    fn sort_by_votes(&self) {
        // SAFETY: those below the length have been written, and nothing else looks at them meanwhile.
        let cases = unsafe { core::slice::from_raw_parts_mut(self.case_ptr(0), self.len()) };
        cases.sort_by_key(|case| core::cmp::Reverse(case.votes.get()));
        for (case, slot) in cases.iter().zip(&self.tags) {
            case.votes.set(0);
            slot.set(tag(case.shape(), case.key.get()));
        }
    }
}

/// What happens if no case applies.
#[derive(Clone, Copy)]
pub struct Last {
    kind: AccessKind,
    failures: Failures,
}

impl Last {
    const fn new(kind: AccessKind, failures: Failures) -> Last {
        Last { kind, failures }
    }

    /// One for which `is_last` holds.
    pub fn kind(self) -> AccessKind {
        self.kind
    }

    /// Whether the site has seen something that it has no case for.
    pub fn did_miss(self) -> bool {
        self.failures.0 != 0
    }
}

/// Zero if there have been none. Otherwise the low bits count down to one, when the next attempt is due.
#[derive(Clone, Copy)]
struct Failures(u8);

impl Failures {
    const NONE: Failures = Failures(0);
    const PAUSE: u8 = 0x1f;
    const WAS_UNWATCHABLE: u8 = 0x20;
}

/// What the cases of a site have in common.
#[derive(Clone, Copy)]
pub struct Summary(u32);

impl Summary {
    const SHIFT: u32 = 20;
    const IS_PLAIN: u32 = 1 << 8;

    fn of(cases: &[AccessCase], did_miss: bool) -> Summary {
        let is_plain = !did_miss && cases.iter().all(|it| it.kind().is_plain());
        let has_slot = |it: &&AccessCase| it.plain_offset() != 0;
        let count = |offset| {
            (cases.iter())
                .filter(|it| it.plain_offset() == offset)
                .count()
        };
        let usual = (cases.iter().filter(has_slot).map(AccessCase::plain_offset))
            .find(|&offset| count(offset) * 4 >= cases.len() * 3);
        let words = usual.and_then(|it| i8::try_from(it / 8).ok()).unwrap_or(0);
        Summary(u32::from(words as u8) | if is_plain { Self::IS_PLAIN } else { 0 })
    }

    /// Nothing is done but to read or write a slot.
    pub fn is_plain(self) -> bool {
        self.0 & Self::IS_PLAIN != 0
    }

    /// Of a slot of the object itself.
    pub fn usual_byte_offset(self) -> Option<i32> {
        Some(i32::from(self.0 as i8) * 8).filter(|&it| it != 0)
    }
}

const _: () = assert!(LoadEntry::PRIMARY_COUNT << ENTRY_SHIFT <= 1 << Summary::SHIFT);

/// A copy of a case, with its key.
pub struct SeenCase {
    case: AccessCase,
    key: Option<Identifier>,
}

impl SeenCase {
    pub fn key(&self) -> Option<PropertyName<'_>> {
        self.key.as_ref().map(Identifier::name)
    }
}

impl Deref for SeenCase {
    type Target = AccessCase;

    fn deref(&self) -> &AccessCase {
        &self.case
    }
}

/// Why no case has come of an access.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum NoCase {
    /// Something has been rearranged so that the next attempt can succeed.
    Retry,
    Uncacheable,
    /// The prototypes cannot be watched, or the object is a dictionary for good. The cache of the `Vm` does better.
    Unwatchable,
    AddsToDictionary,
}

/// What comes of taking a sample.
pub(super) enum Sample {
    /// From now on all accesses are to come by the list.
    First,
    Another,
    /// The cases are sorted by how often they apply.
    Last,
}

/// As a signed number: from `FIRST_ADDRESS` on the address of a `CaseList`. Below that, down to zero, a count. From
/// there down to `i32::MIN` the site is megamorphic, and has a `Summary` above the `caches::name_hash` of a fixed key.
/// Below that it is the address of the lookup of an inline case that is the only one, with the sign bit set.
#[repr(transparent)]
pub struct AccessCases(Cell<isize>);

impl AccessCases {
    pub const MAX_CASES: usize = 8;
    pub const FIRST_ADDRESS: isize = 256;
    pub const LONE_LOOKUP_BIT: isize = isize::MIN;
    const HAS_RUN: isize = 1;
    const HAS_RUN_TWICE: isize = 2;
    const GAVE_UP: isize = Self::FIRST_ADDRESS - 1;

    /// # Safety
    /// It is not looked at after anything that may add a case or collect.
    #[inline(always)]
    pub unsafe fn list(&self) -> Option<&CaseList> {
        let word = self.0.get();
        // SAFETY: from `CaseList::create`, and the caller's.
        (word >= Self::FIRST_ADDRESS)
            .then(|| unsafe { &*core::ptr::with_exposed_provenance(word as usize) })
    }

    #[inline(always)]
    fn with_list<R>(&self, read: impl FnOnce(&CaseList) -> R) -> Option<R> {
        // SAFETY: the callers are in this file, and do neither.
        unsafe { self.list() }.map(read)
    }

    #[inline(always)]
    pub(super) fn has_list(&self) -> bool {
        self.0.get() >= Self::FIRST_ADDRESS
    }

    #[inline(always)]
    pub fn is_megamorphic(&self) -> bool {
        (i32::MIN as isize..0).contains(&self.0.get())
    }

    /// Of a megamorphic site whose key is fixed. Only the bits that the tables go by.
    #[inline(always)]
    pub fn name_hash(&self) -> u32 {
        self.0.get() as u32
    }

    /// Of a megamorphic site: as it was before.
    pub fn summary(&self) -> Summary {
        if self.is_megamorphic() {
            return Summary(self.0.get() as u32 >> Summary::SHIFT);
        }
        let did_miss = self.last().is_some_and(|it| {
            it.kind == AccessKind::Generic || it.failures.0 & Failures::PAUSE > 1
        });
        self.with_cases(|cases| Summary::of(cases, did_miss))
    }

    #[inline(always)]
    pub(super) fn lone_lookup(&self) -> Option<Gc<PrototypeLookup>> {
        let word = self.0.get();
        // SAFETY: visited with the code block.
        (word < i32::MIN as isize)
            .then(|| unsafe { Gc::from_address((word ^ Self::LONE_LOOKUP_BIT) as usize) })
    }

    /// Whether `set_lone_lookup` loses nothing.
    pub(super) fn is_blank(&self) -> bool {
        (0..=Self::HAS_RUN_TWICE).contains(&self.0.get())
    }

    pub(super) fn set_lone_lookup(&self, owner: &CodeBlock, lookup: Gc<PrototypeLookup>) {
        debug_assert!(self.is_blank());
        (self.0).set(lookup.address() as isize | Self::LONE_LOOKUP_BIT);
        owner.write_barrier_for_cell();
    }

    pub(super) fn did_clear_inline_case(&self) {
        if self.lone_lookup().is_some() || !self.has_run() {
            self.0.set(Self::HAS_RUN);
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = SeenCase> {
        let copies =
            (0..).map_while(|index| self.with_list(|list| list.cases().get(index).cloned())?);
        copies.map(|case| SeenCase {
            // SAFETY: the list holds a count of it.
            key: (case.name()).map(|it| unsafe { PropertyName::from_raw(it) }.to_identifier()),
            case,
        })
    }

    /// For what neither adds a case nor collects.
    #[inline(always)]
    pub(super) fn with_cases<R>(&self, read: impl FnOnce(&[AccessCase]) -> R) -> R {
        // SAFETY: private to `ic`, where the callers see to that.
        read(unsafe { self.list() }.map_or_default(CaseList::cases))
    }

    /// `None` if there is nothing to say about that yet.
    #[inline]
    pub fn last(&self) -> Option<Last> {
        match self.0.get() {
            0..=Self::HAS_RUN_TWICE => None,
            Self::GAVE_UP => Some(Last::new(AccessKind::Generic, Failures::NONE)),
            count @ 0..Self::GAVE_UP => {
                let failures = Failures((count - Self::HAS_RUN_TWICE) as u8);
                Some(Last::new(AccessKind::End, failures))
            }
            _ if self.is_megamorphic() => Some(Last::new(AccessKind::Megamorphic, Failures::NONE)),
            _ => self.with_list(|list| list.last.get()),
        }
    }

    /// There is no lone lookup.
    #[inline]
    fn set_failures(&self, failures: Failures) {
        let last = Last::new(AccessKind::End, failures);
        if self.with_list(|list| list.last.set(last)).is_none() {
            self.0.set(Self::HAS_RUN_TWICE + isize::from(failures.0));
        }
    }

    pub fn has_run(&self) -> bool {
        self.0.get() != 0
    }

    /// Code that runs once is not worth a cache.
    #[inline(always)]
    pub(super) fn should_cache(&self) -> bool {
        if self.0.get() == 0 {
            self.0.set(Self::HAS_RUN);
            return false;
        }
        match self.last() {
            None => true,
            Some(last) if last.kind != AccessKind::End => false,
            Some(last) if last.failures.0 & Failures::PAUSE <= 1 => true,
            Some(last) => {
                self.set_failures(Failures(last.failures.0 - 1));
                false
            }
        }
    }

    /// The same, where that takes a list.
    #[inline(always)]
    pub(super) fn should_cache_in_list(&self) -> bool {
        if (0..Self::HAS_RUN_TWICE).contains(&self.0.get()) {
            self.0.update(|count| count + 1);
            return false;
        }
        self.should_cache()
    }

    /// There is no lone lookup.
    fn reserve_one(&self, owner: &CodeBlock) -> &CaseList {
        let grown = match self.with_list(|list| (list.len.get(), list.capacity)) {
            None => Some(1),
            Some((len, capacity)) => (len == capacity).then_some(capacity * 2),
        };
        if let Some(capacity) = grown {
            self.reallocate(owner, capacity);
        }
        // SAFETY: the callers are in this file, and only add to it.
        unsafe { self.list() }.expect("just made")
    }

    fn reallocate(&self, owner: &CodeBlock, capacity: u8) {
        let last = (self.last()).unwrap_or(Last::new(AccessKind::End, Failures::NONE));
        let new = CaseList::create(capacity, last);
        self.with_list(|old| {
            // SAFETY: just made.
            let new = unsafe { new.as_ref() };
            old.cases().iter().for_each(|case| new.push(owner, case));
            new.additions.set(old.additions.get());
            new.samples.set(old.samples.get());
            new.turns.set(old.turns.get());
            new.keyed.copy_from(&old.keyed);
            old.len.set(0);
        });
        self.replace(new.as_ptr().expose_provenance() as isize);
        owner.will_need_entries_released();
    }

    fn replace(&self, word: isize) {
        let capacity = self.with_list(|list| {
            list.retain(|_| false);
            list.capacity
        });
        let old = self.0.replace(word);
        if let Some(capacity) = capacity {
            let memory = core::ptr::with_exposed_provenance_mut(old as usize);
            // SAFETY: from `CaseList::create`, and this was the only way to it.
            unsafe { std::alloc::dealloc(memory, CaseList::layout(capacity)) };
        }
    }

    fn overflow(&self, to: Overflow<'_>) {
        match to {
            Overflow::Megamorphic(name) => {
                let hash = name.map_or(0, name_hash) % (1 << Summary::SHIFT);
                let summary = self.summary().0 << Summary::SHIFT;
                self.replace(((hash | summary) as i32 | i32::MIN) as isize);
            }
            Overflow::Generic => {
                let generic = Last::new(AccessKind::Generic, Failures::NONE);
                if self.with_list(|list| list.last.set(generic)).is_none() {
                    self.0.set(Self::GAVE_UP);
                }
            }
        }
    }

    /// Makes a list of what has been the only case, with room for another.
    pub(super) fn start_with(&self, owner: &CodeBlock, only: Option<AccessCase>) {
        debug_assert!(!self.has_list() && !self.is_megamorphic());
        self.did_clear_inline_case();
        self.reallocate(owner, 1 + u8::from(only.is_some()));
        self.with_list(|list| only.inspect(|case| list.push(owner, case)));
    }

    /// Of a site that has no lone lookup. A case for any key has none.
    pub(super) fn add(
        &self,
        vm: &Vm,
        owner: &CodeBlock,
        case: &AccessCase,
        variable_key: Option<PropertyName<'_>>,
        overflow: Overflow<'_>,
    ) {
        let key = variable_key.filter(|_| !case.kind().is_for_any_key());
        if key != variable_key {
            case.forget_key_for_proxy();
        }
        let searched_by = (
            case.shape(),
            key.map_or_else(|| case.key.get(), PropertyName::address),
        );
        let is_there = |list: &CaseList| {
            (list.find(searched_by.0, searched_by.1)).is_some_and(|old| old.does_the_same_as(case))
        };
        // It has not applied, and will not next time.
        if self.with_list(is_there) == Some(true) {
            return self.pause();
        }
        let state = self.with_list(|list| {
            list.retain(|old| old.is_valid() && (old.shape(), old.key.get()) != searched_by);
            (
                list.len() == Self::MAX_CASES,
                list.additions.get() == CaseList::MAX_ADDITIONS,
            )
        });
        let (is_full, is_restless) = state.unwrap_or_default();
        // The global object will come to rest, and the cache of the `Vm` serves it less well.
        let waits = case.kind() == AccessKind::ThroughGlobalProxy;
        if is_full || (is_restless && !waits) {
            return self.overflow(overflow);
        }
        if is_restless {
            self.with_list(|list| list.additions.update(|count| count - 1));
            self.pause();
        }
        if let Some(key) = key {
            let counted = key.to_identifier().into_string().into_raw();
            case.key.set(counted.as_ptr().expose_provenance());
        }
        case.renew(vm);
        let list = self.reserve_one(owner);
        list.additions.update(|count| count + 1);
        list.push(owner, case);
        list.keyed.did_add_case(vm, list.cases());
    }

    fn pause(&self) {
        let before = self.last().map_or(0, |last| last.failures.0);
        self.set_failures(Failures(before | Failures::PAUSE));
    }

    /// Of a site that has no lone lookup.
    pub(super) fn did_fail(&self, reason: NoCase, overflow: Overflow<'_>) {
        let before = self.last().map_or(0, |last| last.failures.0) & Failures::WAS_UNWATCHABLE;
        match reason {
            NoCase::Retry => {}
            NoCase::Uncacheable => self.pause(),
            NoCase::AddsToDictionary if !matches!(overflow, Overflow::Megamorphic(None)) => {
                self.pause();
            }
            _ if before == 0 => {
                self.set_failures(Failures(Failures::WAS_UNWATCHABLE | 1));
            }
            _ => self.overflow(overflow),
        }
    }

    pub(super) fn apply(
        &self,
        vm: &Vm,
        owner: &CodeBlock,
        plan: &Result<AccessCase, NoCase>,
        variable_key: Option<PropertyName<'_>>,
        overflow: Overflow<'_>,
    ) {
        match plan {
            Ok(case) => self.add(vm, owner, case, variable_key, overflow),
            &Err(reason) => self.did_fail(reason, overflow),
        }
    }

    /// For a site that can become megamorphic.
    pub(super) fn apply_by_key(
        &self,
        vm: &Vm,
        owner: &CodeBlock,
        plan: &Result<AccessCase, NoCase>,
        name: PropertyName<'_>,
        key: Key,
    ) {
        let overflow = Overflow::Megamorphic((key == Key::Fixed).then_some(name));
        self.apply(
            vm,
            owner,
            plan,
            (key == Key::Variable).then_some(name),
            overflow,
        );
    }
}

impl CaseList {
    /// If the count of turns has run out. The access is to an object of that shape, by that key.
    #[inline(always)]
    pub(super) fn take_sample(&self, shape: ShapeId, key: usize) -> Option<Sample> {
        (self.turns.get() == 0).then(|| self.sample(shape, key))
    }

    #[inline(never)]
    fn sample(&self, shape: ShapeId, key: usize) -> Sample {
        const ROUND: u8 = CaseList::SAMPLES_PER_ROUND + 1;
        const LAST_ROUND: u8 = 3;
        let taken = self.samples.get();
        self.samples.set(taken + 1);
        (self.turns).set(Self::TURNS_BETWEEN_SAMPLES.wrapping_neg());
        if taken.is_multiple_of(ROUND) {
            return Sample::First;
        }
        if let Some(case) = self.find(shape, key) {
            case.votes.update(|votes| votes + 1);
        }
        if taken % ROUND != ROUND - 1 {
            return Sample::Another;
        }
        let round = (taken / ROUND + 1).min(LAST_ROUND);
        self.samples.set(round * ROUND);
        (self.turns).set((u16::MAX >> (3 * (LAST_ROUND - round))).wrapping_neg());
        self.sort_by_votes();
        Sample::Last
    }
}

/// What a site becomes when its cases do not suffice.
#[derive(Clone, Copy)]
pub(super) enum Overflow<'a> {
    /// With the name, if it is fixed.
    Megamorphic(Option<PropertyName<'a>>),
    Generic,
}

impl CodeBlock {
    /// In one of its entries.
    pub(super) fn did_get_case(&self, case: &AccessCase) {
        if !case.new_shape().is_none() {
            self.has_transitions.set(true);
        }
        self.write_barrier_for_cell();
    }
}

pub(super) fn visit_transition(from: ShapeId, to: ShapeId, visitor: &mut Visitor) {
    if !to.is_none() && !from.is_none() && visitor.is_address_marked(from.address()) {
        visitor.append_shape(to);
    }
}

// SAFETY: an integer.
unsafe impl Entry for AccessCases {
    #[inline(always)]
    fn visit(&self, visitor: &mut Visitor) {
        if let Some(lookup) = self.lone_lookup() {
            return visitor.append(lookup);
        }
        self.with_cases(|cases| {
            for case in cases {
                // SAFETY: zero, or a cell that has been kept alive so far.
                unsafe { visitor.append_word(case.kept_alive()) };
            }
        });
    }

    #[inline]
    fn visit_transitions(&self, visitor: &mut Visitor) {
        self.with_cases(|cases| {
            for case in cases
                .iter()
                .filter(|it| it.kind() != AccessKind::ThroughGlobalProxy)
            {
                visit_transition(case.shape(), case.new_shape(), visitor);
            }
        });
    }

    #[inline(always)]
    fn reconcile(&self, _: &CodeBlock, survivors: &Survivors) {
        self.with_list(|list| list.reconcile(survivors));
    }

    #[inline]
    fn release(&self) {
        self.replace(0);
    }
}

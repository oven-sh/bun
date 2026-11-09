//! A bounded memo of resolver answers, valid while [`crate::resolution_epoch`] stands.
//!
//! An answer is kept only if its resolver run read nothing but the caches (`Resolver::dir_cache_misses`), and every write
//! to those caches moves the epoch. What one VM alone reads besides them moves that VM's memo: [`Memo::forget`].

use bun_core::{WTFString, WTFStringImplStruct};

/// The inputs of a resolution besides the two strings.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Kind(u8);

impl Kind {
    #[inline]
    pub fn new(
        is_esm: bool,
        source_is_a_file_path: bool,
        global_cache: crate::GlobalCache,
    ) -> Self {
        Self(u8::from(is_esm) | u8::from(source_is_a_file_path) << 1 | (global_cache as u8) << 2)
    }
}

/// A string of a key, as a caller has it.
pub trait Text {
    /// What an entry keeps of it.
    type Kept;
    /// 24 bits, as `WTF::StringImpl::hash()`.
    fn hash(&self) -> u32;
    fn is(&self, kept: &Self::Kept) -> bool;
    /// Holds no more memory than the characters.
    fn keep(&self) -> Self::Kept;
}

/// A resolved path, as an entry keeps it and a hit hands it out.
pub trait Answer {
    fn is(&self, other: &Self) -> bool;
    fn share(&self) -> Self;
}

struct Entry<T: Text + ?Sized, A> {
    specifier: T::Kept,
    source: T::Kept,
    path: A,
}

struct Way<T: Text + ?Sized, A> {
    entry: Option<Entry<T, A>>,
    /// The low half of the epoch. `Memo::epoch_high` is the other half.
    epoch: u32,
    /// Compared before the strings of `entry`: those are most likely not in the CPU cache.
    tag: u16,
    kind: Kind,
    /// Not about `entry`: the mark of a pair last resolved without one, here to share the cache line.
    missed: u8,
}

/// Most recently used first.
#[repr(align(64))]
struct Bucket<T: Text + ?Sized, A>([Way<T, A>; 2]);

const _: () = assert!(size_of::<Bucket<WTFStringImplStruct, WTFString>>() == 64);

/// 64 KB of buckets.
const BUCKET_BITS: u32 = 10;
const FIRST_SIGHTS: usize = 64;

/// In a mark, beside 7 bits of the tag: the pair is never kept.
const REFUSED: u8 = 1 << 7;
/// The same in a first sight, beside 15 bits.
const REFUSED_FIRST_SIGHT: u16 = 1 << 15;

/// Where `get` looked, for what follows the resolver run.
#[derive(Clone, Copy)]
pub struct Slot {
    bucket: u32,
    tag: u16,
    epoch: u32,
}

/// What the memo has for a pair.
pub enum Lookup<A> {
    /// The resolved path.
    Kept(A),
    /// The entry is from before the epoch moved: `refresh` it with the new answer.
    Stale(Slot),
    /// No entry, and the pair was resolved just before: `put` the answer.
    Repeated(Slot),
    /// No entry, and the pair is marked from now on.
    New(Slot),
    /// No entry, ever: `refuse` said so.
    Refused,
}

pub struct Memo<T: Text + ?Sized, A> {
    /// Empty until an answer is kept or `FIRST_SIGHTS` pairs were resolved: a small program needs no table.
    buckets: Box<[Bucket<T, A>]>,
    /// Until there are buckets, the pairs resolved once. Afterwards `Way::missed` says it.
    first_sights: [u16; FIRST_SIGHTS],
    /// How many of them.
    first_sight_count: u8,
    /// Added to the epoch.
    forgotten: u64,
    /// The high half of the epoch of every entry.
    epoch_high: u32,
    /// For `bun:internal-for-testing`.
    hits: u64,
}

impl<T: Text + ?Sized, A> Default for Memo<T, A> {
    fn default() -> Self {
        Self {
            buckets: Box::default(),
            first_sights: [0; FIRST_SIGHTS],
            first_sight_count: 0,
            forgotten: 0,
            epoch_high: 0,
            hits: 0,
        }
    }
}

impl<T: Text + ?Sized, A: Answer> Memo<T, A> {
    pub fn hits(&self) -> u64 {
        self.hits
    }

    /// No answer from before is given again.
    pub fn forget(&mut self) {
        self.forgotten = self.forgotten.wrapping_add(1);
    }

    /// Entries keep the low half of their epoch, so none outlives a change of the high half.
    fn low_half(&mut self, epoch: u64) -> u32 {
        let epoch = epoch.wrapping_add(self.forgotten);
        let high = (epoch >> 32) as u32;
        if high != self.epoch_high {
            self.buckets = Box::default();
            self.first_sights = [0; FIRST_SIGHTS];
            self.first_sight_count = 0;
            self.epoch_high = high;
        }
        epoch as u32
    }

    pub fn get(&mut self, specifier: &T, source: &T, kind: Kind, epoch: u64) -> Lookup<A> {
        let epoch = self.low_half(epoch);
        let (bucket, tag) = slot(specifier.hash(), source.hash(), kind);
        let slot = Slot { bucket, tag, epoch };
        let Some(Bucket(ways)) = self.buckets.get_mut(bucket as usize) else {
            return self.first_sight(slot);
        };
        if let Some(way) = ways
            .iter()
            .position(|way| way.holds(tag, specifier, source, kind))
        {
            if way != 0 {
                swap_entries(ways);
            }
            return match &ways[0].entry {
                Some(entry) if ways[0].epoch == epoch => {
                    self.hits += 1;
                    Lookup::Kept(entry.path.share())
                }
                _ => Lookup::Stale(slot),
            };
        }
        // An entry starts at the second resolution of a pair, so a one-off evicts nothing.
        let mark = mark_of(tag);
        if let Some(way) = ways.iter().find(|way| way.missed & !REFUSED == mark) {
            return match way.missed & REFUSED {
                0 => Lookup::Repeated(slot),
                _ => Lookup::Refused,
            };
        }
        ways[1].missed = ways[0].missed;
        ways[0].missed = mark;
        Lookup::New(slot)
    }

    #[cold]
    fn first_sight(&mut self, slot: Slot) -> Lookup<A> {
        let seen = &mut self.first_sights[slot.bucket as usize % FIRST_SIGHTS];
        let mark = first_sight_of(slot.tag);
        if *seen & !REFUSED_FIRST_SIGHT == mark {
            return match *seen & REFUSED_FIRST_SIGHT {
                0 => Lookup::Repeated(slot),
                _ => Lookup::Refused,
            };
        }
        *seen = mark;
        // Two pairs that take turns in one first sight never see themselves there. A bucket marks two.
        self.first_sight_count += 1;
        if usize::from(self.first_sight_count) == FIRST_SIGHTS {
            self.build();
        }
        Lookup::New(slot)
    }

    fn build(&mut self) {
        self.buckets = core::iter::repeat_with(|| Bucket([Way::EMPTY, Way::EMPTY]))
            .take(1 << BUCKET_BITS)
            .collect();
    }

    /// After `Lookup::Repeated` or `Lookup::New`: keeps the answer, over the less recently used entry.
    pub fn put(&mut self, slot: Slot, specifier: &T, source: &T, kind: Kind, path: &A) {
        if self.buckets.is_empty() {
            self.build();
        }
        let Bucket(ways) = &mut self.buckets[slot.bucket as usize];
        swap_entries(ways);
        ways[0].entry = Some(Entry {
            specifier: specifier.keep(),
            source: source.keep(),
            path: path.share(),
        });
        ways[0].epoch = slot.epoch;
        ways[0].tag = slot.tag;
        ways[0].kind = kind;
    }

    /// After `Lookup::Stale`: the entry answers again, with `path`. Most often that is the path it has, and then it
    /// keeps the string it has.
    pub fn refresh(&mut self, slot: Slot, path: &A) {
        let Some(Bucket([way, _])) = self.buckets.get_mut(slot.bucket as usize) else {
            return;
        };
        let Some(entry) = way.entry.as_mut().filter(|_| way.tag == slot.tag) else {
            return;
        };
        if !entry.path.is(path) {
            entry.path = path.share();
        }
        way.epoch = slot.epoch;
    }

    /// After any `Lookup` with a slot: the pair is one that is never kept, so the next `get` says `Refused`.
    pub fn refuse(&mut self, slot: Slot) {
        let Some(Bucket(ways)) = self.buckets.get_mut(slot.bucket as usize) else {
            let seen = &mut self.first_sights[slot.bucket as usize % FIRST_SIGHTS];
            if *seen & !REFUSED_FIRST_SIGHT == first_sight_of(slot.tag) {
                *seen |= REFUSED_FIRST_SIGHT;
            }
            return;
        };
        // `Lookup::Stale` moved the entry to the front.
        if ways[0].entry.is_some() && ways[0].tag == slot.tag {
            ways[0].entry = None;
        }
        let mark = mark_of(slot.tag);
        match ways.iter_mut().find(|way| way.missed & !REFUSED == mark) {
            Some(way) => way.missed |= REFUSED,
            None => {
                ways[1].missed = ways[0].missed;
                ways[0].missed = mark | REFUSED;
            }
        }
    }
}

impl<T: Text + ?Sized, A> Way<T, A> {
    const EMPTY: Self = Self {
        entry: None,
        epoch: 0,
        tag: 0,
        kind: Kind(0),
        missed: 0,
    };

    #[inline]
    fn holds(&self, tag: u16, specifier: &T, source: &T, kind: Kind) -> bool {
        self.tag == tag
            && self.kind == kind
            && self
                .entry
                .as_ref()
                .is_some_and(|entry| specifier.is(&entry.specifier) && source.is(&entry.source))
    }
}

/// All but `missed`.
#[inline]
fn swap_entries<T: Text + ?Sized, A>(ways: &mut [Way<T, A>; 2]) {
    let [a, b] = ways;
    core::mem::swap(&mut a.entry, &mut b.entry);
    core::mem::swap(&mut a.epoch, &mut b.epoch);
    core::mem::swap(&mut a.tag, &mut b.tag);
    core::mem::swap(&mut a.kind, &mut b.kind);
}

/// Never 0, which is a bucket that saw nothing yet.
#[inline]
fn mark_of(tag: u16) -> u8 {
    (tag as u8 & !REFUSED).max(1)
}

/// Never 0, as `mark_of`.
#[inline]
fn first_sight_of(tag: u16) -> u16 {
    (tag & !REFUSED_FIRST_SIGHT).max(1)
}

/// The bucket of a key, and a tag that tells it from most other keys of that bucket.
#[inline]
fn slot(specifier_hash: u32, source_hash: u32, kind: Kind) -> (u32, u16) {
    // A `StringImpl` hash is 24 bits.
    let key = u64::from(specifier_hash) << 32 | u64::from(source_hash) << 8 | u64::from(kind.0);
    let mixed = key.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    // Both from the top: a bit of the product depends only on the key bits at and below it.
    (
        (mixed >> (u64::BITS - BUCKET_BITS)) as u32,
        (mixed >> (u64::BITS - BUCKET_BITS - u16::BITS)) as u16,
    )
}

impl Text for WTFStringImplStruct {
    type Kept = WTFString;

    #[inline]
    fn hash(&self) -> u32 {
        WTFStringImplStruct::hash(self)
    }

    /// The same characters in the other width do not match, which only costs a resolution.
    #[inline]
    fn is(&self, kept: &WTFString) -> bool {
        core::ptr::eq(self, &raw const **kept)
            || (self.is_8bit() == kept.is_8bit() && self.byte_slice() == kept.byte_slice())
    }

    /// A slice of another string keeps all of that string alive, and an external one its owner's memory.
    fn keep(&self) -> WTFString {
        let this = core::ptr::from_ref(self).cast_mut();
        if self.owns_its_characters() {
            // SAFETY: `self` is a live impl, and the new ref keeps it alive.
            return unsafe { WTFString::clone_from_raw(this) };
        }
        let copy = bun_core::String::retain_wtf_impl(this).thread_isolated_copy();
        // SAFETY: the copy of a WTF-backed string is WTF-backed, and `leak_wtf_impl` hands over its ref.
        unsafe { WTFString::adopt(copy.leak_wtf_impl()) }
    }
}

impl Answer for WTFString {
    #[inline]
    fn is(&self, other: &Self) -> bool {
        core::ptr::eq(&raw const **self, &raw const **other)
            || (self.is_8bit() == other.is_8bit() && self.byte_slice() == other.byte_slice())
    }

    #[inline]
    fn share(&self) -> Self {
        self.clone()
    }
}

/// The memo of a VM.
pub type ResolutionMemo = Memo<WTFStringImplStruct, WTFString>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    /// A string whose hash the test picks. The count of its `Rc` says what the memo keeps.
    struct Name {
        hash: u32,
        text: Rc<str>,
    }

    fn name(hash: u32, text: &str) -> Name {
        Name {
            hash,
            text: Rc::from(text),
        }
    }

    impl Text for Name {
        type Kept = Rc<str>;
        fn hash(&self) -> u32 {
            self.hash
        }
        fn is(&self, kept: &Rc<str>) -> bool {
            *self.text == **kept
        }
        fn keep(&self) -> Rc<str> {
            self.text.clone()
        }
    }

    impl Answer for Rc<str> {
        fn is(&self, other: &Self) -> bool {
            self == other
        }
        fn share(&self) -> Self {
            self.clone()
        }
    }

    type TestMemo = Memo<Name, Rc<str>>;
    const CJS: Kind = Kind(0);
    const ESM: Kind = Kind(1);

    /// What a resolution does with the memo: what `get` said, and the answer if the memo gave it.
    fn resolve(
        memo: &mut TestMemo,
        specifier: &Name,
        source: &Name,
        kind: Kind,
        epoch: u64,
        path: &str,
    ) -> (&'static str, Option<Rc<str>>) {
        match memo.get(specifier, source, kind, epoch) {
            Lookup::Kept(answer) => ("kept", Some(answer)),
            Lookup::Stale(slot) => {
                memo.refresh(slot, &Rc::from(path));
                ("stale", None)
            }
            Lookup::Repeated(slot) => {
                memo.put(slot, specifier, source, kind, &Rc::from(path));
                ("repeated", None)
            }
            Lookup::New(_) => ("new", None),
            Lookup::Refused => ("refused", None),
        }
    }

    fn said(memo: &mut TestMemo, specifier: &Name, source: &Name, path: &str) -> &'static str {
        resolve(memo, specifier, source, CJS, 0, path).0
    }

    fn source() -> Name {
        name(22, "/app/main.js")
    }

    /// Specifiers whose keys with `source()` share one bucket, with different marks.
    fn specifiers_of_one_bucket(count: usize) -> Vec<Name> {
        let (bucket, _) = slot(1, source().hash, CJS);
        let mut names: Vec<Name> = Vec::new();
        let mut marks: Vec<(u8, u16)> = Vec::new();
        for hash in 1..1 << 24 {
            let (other, tag) = slot(hash, source().hash, CJS);
            let mark = (mark_of(tag), first_sight_of(tag));
            let is_new = !marks
                .iter()
                .any(|seen| seen.0 == mark.0 || seen.1 == mark.1);
            if other == bucket && is_new {
                marks.push(mark);
                names.push(name(hash, &format!("./name-{hash}")));
                if names.len() == count {
                    return names;
                }
            }
        }
        panic!("fewer than {count} such hashes")
    }

    /// A memo that has its table, built by a key of another bucket.
    fn memo_with_table() -> TestMemo {
        let mut memo = TestMemo::default();
        let (bucket, _) = slot(1, source().hash, CJS);
        let other = (2..).find(|hash| slot(*hash, source().hash, CJS).0 != bucket);
        let other = name(other.unwrap(), "./builds-the-table");
        assert_eq!(said(&mut memo, &other, &source(), "/app/t.js"), "new");
        assert_eq!(said(&mut memo, &other, &source(), "/app/t.js"), "repeated");
        assert_eq!(memo.buckets.len(), 1 << BUCKET_BITS);
        memo
    }

    #[test]
    fn an_entry_starts_at_the_second_resolution_and_answers_from_the_third() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "./a"), source());
        let steps: Vec<_> = (0..5)
            .map(|_| said(&mut memo, &specifier, &source, "/app/a.js"))
            .collect();
        assert_eq!(steps, ["new", "repeated", "kept", "kept", "kept"]);
        assert_eq!(memo.hits(), 3);
        let (_, answer) = resolve(&mut memo, &specifier, &source, CJS, 0, "/app/other.js");
        assert_eq!(answer.as_deref(), Some("/app/a.js"));
    }

    #[test]
    fn pairs_resolved_once_keep_no_string_and_a_few_of_them_build_no_table() {
        let mut memo = TestMemo::default();
        let source = source();
        let specifiers: Vec<Name> = (0..500)
            .map(|i| name(1000 + i * 7919, &format!("./one-off-{i}")))
            .collect();
        for (i, specifier) in specifiers.iter().enumerate() {
            assert_eq!(memo.buckets.is_empty(), i < FIRST_SIGHTS, "after {i}");
            memo.get(specifier, &source, CJS, 0);
        }
        assert_eq!(Rc::strong_count(&source.text), 1);
        assert!(specifiers.iter().all(|it| Rc::strong_count(&it.text) == 1));
        assert_eq!(memo.hits(), 0);
    }

    #[test]
    fn the_first_answer_that_is_kept_builds_the_table() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "./a"), source());
        assert_eq!(said(&mut memo, &specifier, &source, "/app/a.js"), "new");
        assert!(memo.buckets.is_empty());
        assert_eq!(
            said(&mut memo, &specifier, &source, "/app/a.js"),
            "repeated"
        );
        assert_eq!(memo.buckets.len(), 1 << BUCKET_BITS);
        assert_eq!(Rc::strong_count(&specifier.text), 2);
        assert_eq!(Rc::strong_count(&source.text), 2);
    }

    #[test]
    fn two_pairs_that_take_turns_in_one_first_sight_are_kept_once_there_is_a_table() {
        let mut memo = TestMemo::default();
        let source = source();
        let pair = specifiers_of_one_bucket(2);
        let mut steps = Vec::new();
        for _ in 0..FIRST_SIGHTS {
            steps.push(said(&mut memo, &pair[0], &source, "/app/0.js"));
            steps.push(said(&mut memo, &pair[1], &source, "/app/1.js"));
        }
        // Each overwrites the first sight of the other, until that many were counted.
        assert!(steps[..FIRST_SIGHTS].iter().all(|step| *step == "new"));
        assert!(steps[FIRST_SIGHTS + 4..].iter().all(|step| *step == "kept"));
    }

    #[test]
    fn an_entry_of_an_older_epoch_is_not_answered_and_answers_again_once_refreshed() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "./a"), source());
        for _ in 0..3 {
            resolve(&mut memo, &specifier, &source, CJS, 5, "/app/a.js");
        }
        let (_, kept) = resolve(&mut memo, &specifier, &source, CJS, 5, "");
        let (step, _) = resolve(&mut memo, &specifier, &source, CJS, 6, "/app/a.js");
        assert_eq!(step, "stale");
        // The same answer: the entry keeps the string it has.
        let (step, answer) = resolve(&mut memo, &specifier, &source, CJS, 6, "");
        assert_eq!(step, "kept");
        assert!(Rc::ptr_eq(&answer.unwrap(), &kept.unwrap()));
        // The new answer can be another one.
        let (step, _) = resolve(&mut memo, &specifier, &source, CJS, 7, "/app/a/index.js");
        assert_eq!(step, "stale");
        let (step, answer) = resolve(&mut memo, &specifier, &source, CJS, 7, "");
        assert_eq!((step, answer.as_deref()), ("kept", Some("/app/a/index.js")));
    }

    #[test]
    fn a_stale_entry_behind_another_entry_is_not_answered() {
        let mut memo = TestMemo::default();
        let source = source();
        let pair = specifiers_of_one_bucket(2);
        for _ in 0..3 {
            resolve(&mut memo, &pair[0], &source, CJS, 5, "/app/first.js");
        }
        for _ in 0..3 {
            resolve(&mut memo, &pair[1], &source, CJS, 6, "/app/second.js");
        }
        // The first is the second way now, with the epoch 5. Its way to the front brings that epoch along.
        let (step, _) = resolve(&mut memo, &pair[0], &source, CJS, 6, "/app/first.js");
        assert_eq!(step, "stale");
        let (step, _) = resolve(&mut memo, &pair[1], &source, CJS, 6, "/app/second.js");
        assert_eq!(step, "kept");
        let (step, _) = resolve(&mut memo, &pair[0], &source, CJS, 6, "/app/first.js");
        assert_eq!(step, "kept");
    }

    #[test]
    fn an_epoch_that_is_2_to_the_32_later_drops_every_entry() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "./a"), source());
        for _ in 0..3 {
            resolve(&mut memo, &specifier, &source, CJS, 5, "/app/a.js");
        }
        assert_eq!(Rc::strong_count(&specifier.text), 2);
        let later = 5 + (1 << 32);
        let (step, _) = resolve(&mut memo, &specifier, &source, CJS, later, "/app/a.js");
        assert_eq!(step, "new");
        assert!(memo.buckets.is_empty());
        assert_eq!(Rc::strong_count(&specifier.text), 1);
        assert_eq!(Rc::strong_count(&source.text), 1);
    }

    #[test]
    fn forget_drops_every_answer_of_before() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "./a"), source());
        for _ in 0..3 {
            resolve(&mut memo, &specifier, &source, CJS, 5, "/app/a.js");
        }
        memo.forget();
        let (step, _) = resolve(&mut memo, &specifier, &source, CJS, 5, "/app/a.cjs");
        assert_eq!(step, "stale");
        let (step, answer) = resolve(&mut memo, &specifier, &source, CJS, 5, "");
        assert_eq!((step, answer.as_deref()), ("kept", Some("/app/a.cjs")));
        // Also when the epoch moves on.
        memo.forget();
        let (step, _) = resolve(&mut memo, &specifier, &source, CJS, 6, "/app/a.cjs");
        assert_eq!(step, "stale");
    }

    #[test]
    fn two_keys_of_one_bucket_each_get_their_own_answer() {
        let mut memo = memo_with_table();
        let source = source();
        let pair = specifiers_of_one_bucket(2);
        for _ in 0..2 {
            said(&mut memo, &pair[0], &source, "/app/first.js");
            said(&mut memo, &pair[1], &source, "/app/second.js");
        }
        for _ in 0..3 {
            let (_, answer) = resolve(&mut memo, &pair[0], &source, CJS, 0, "");
            assert_eq!(answer.as_deref(), Some("/app/first.js"));
            let (_, answer) = resolve(&mut memo, &pair[1], &source, CJS, 0, "");
            assert_eq!(answer.as_deref(), Some("/app/second.js"));
        }
    }

    #[test]
    fn equal_hashes_do_not_make_equal_keys() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "./a"), source());
        for _ in 0..3 {
            said(&mut memo, &specifier, &source, "/app/a.js");
        }
        // The same bucket and tag: the strings tell them apart.
        let other_specifier = name(11, "./b");
        let other_source = name(22, "/lib/main.js");
        let is_kept = |lookup| matches!(lookup, Lookup::Kept(_));
        assert!(!is_kept(memo.get(&other_specifier, &source, CJS, 0)));
        assert!(!is_kept(memo.get(&specifier, &other_source, CJS, 0)));
        let (_, answer) = resolve(&mut memo, &specifier, &source, CJS, 0, "");
        assert_eq!(answer.as_deref(), Some("/app/a.js"));
    }

    #[test]
    fn the_kind_is_part_of_the_key() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "dual"), source());
        for _ in 0..3 {
            resolve(&mut memo, &specifier, &source, CJS, 0, "/dual/index.cjs");
            resolve(&mut memo, &specifier, &source, ESM, 0, "/dual/index.mjs");
        }
        let (_, answer) = resolve(&mut memo, &specifier, &source, CJS, 0, "");
        assert_eq!(answer.as_deref(), Some("/dual/index.cjs"));
        let (_, answer) = resolve(&mut memo, &specifier, &source, ESM, 0, "");
        assert_eq!(answer.as_deref(), Some("/dual/index.mjs"));
    }

    #[test]
    fn the_less_recently_used_entry_of_a_bucket_is_replaced() {
        let source = source();
        let names = specifiers_of_one_bucket(3);
        for last_used in [0, 1] {
            let mut memo = memo_with_table();
            for name in &names[..2] {
                for _ in 0..2 {
                    said(&mut memo, name, &source, &name.text);
                }
            }
            assert_eq!(said(&mut memo, &names[last_used], &source, ""), "kept");
            for _ in 0..2 {
                said(&mut memo, &names[2], &source, "./third");
            }
            assert_eq!(Rc::strong_count(&names[1 - last_used].text), 1);
            assert_eq!(Rc::strong_count(&names[last_used].text), 2);
            assert_eq!(said(&mut memo, &names[last_used], &source, ""), "kept");
            assert_eq!(said(&mut memo, &names[2], &source, ""), "kept");
        }
    }

    #[test]
    fn a_bucket_marks_the_two_pairs_it_saw_last() {
        let mut memo = memo_with_table();
        let source = source();
        let names = specifiers_of_one_bucket(3);
        for name in &names {
            assert_eq!(said(&mut memo, name, &source, ""), "new");
        }
        // The first of three marks is gone, and the third is there.
        assert_eq!(said(&mut memo, &names[0], &source, ""), "new");
        assert_eq!(said(&mut memo, &names[2], &source, "./two"), "repeated");
    }

    #[test]
    fn a_refused_pair_is_not_asked_about_again() {
        let source = source();
        let specifier = name(11, "./a?query");
        for mut memo in [TestMemo::default(), memo_with_table()] {
            assert!(matches!(
                memo.get(&specifier, &source, CJS, 0),
                Lookup::New(_)
            ));
            let Lookup::Repeated(slot) = memo.get(&specifier, &source, CJS, 0) else {
                panic!("the second resolution of a pair")
            };
            memo.refuse(slot);
            for _ in 0..3 {
                assert!(matches!(
                    memo.get(&specifier, &source, CJS, 0),
                    Lookup::Refused
                ));
            }
            assert_eq!(Rc::strong_count(&specifier.text), 1);
            assert_eq!(memo.hits(), 0);
        }
    }

    #[test]
    fn refusing_a_pair_that_has_an_entry_drops_the_entry() {
        let mut memo = TestMemo::default();
        let (specifier, source) = (name(11, "pkg"), source());
        for _ in 0..3 {
            said(
                &mut memo,
                &specifier,
                &source,
                "/app/node_modules/pkg/index.js",
            );
        }
        let Lookup::Stale(slot) = memo.get(&specifier, &source, CJS, 1) else {
            panic!("an entry of the epoch before")
        };
        memo.refuse(slot);
        assert_eq!(Rc::strong_count(&specifier.text), 1);
        assert!(matches!(
            memo.get(&specifier, &source, CJS, 1),
            Lookup::Refused
        ));
    }

    #[test]
    fn a_mark_is_never_the_one_of_an_empty_bucket() {
        assert_eq!(mark_of(0), 1);
        assert_eq!(mark_of(0x80), 1);
        assert_eq!(mark_of(0x1ff), 0x7f);
        assert_eq!(first_sight_of(0), 1);
        assert_eq!(first_sight_of(0x8000), 1);
        assert_eq!(first_sight_of(0xffff), 0x7fff);
    }

    #[test]
    fn the_tag_depends_on_both_hashes_and_the_kind() {
        let (bucket, tag) = slot(0x12_3456, 0x65_4321, CJS);
        let mut specifier_matters = false;
        let mut source_matters = false;
        for bit in 0..24 {
            specifier_matters |= slot(0x12_3456 ^ 1 << bit, 0x65_4321, CJS).1 != tag;
            source_matters |= slot(0x12_3456, 0x65_4321 ^ 1 << bit, CJS).1 != tag;
        }
        assert!(specifier_matters && source_matters);
        assert_ne!(slot(0x12_3456, 0x65_4321, ESM), (bucket, tag));
    }
}

//! The single-threaded path store: a path-byte arena + SoA metadata columns +
//! a path-keyed hash index + a path-sorted order + an access-recency ring.
//!
//! Owned, mutated and read by exactly one thread; no locks, not `Sync`.
//! Memory is accounted exactly (vector capacities; the store performs every
//! growth itself) against a hard budget — see `budget.rs`.

use bun_collections::array_hash_map::{ArrayHashAdapter, ArrayHashMap, AutoContext, hash_string};
use bun_core::handle_oom;

use crate::budget::{BudgetExceeded, grown_capacity, reserve_to};

/// Dense per-entry handle. INTERNAL to the index: invalidated by
/// [`Store::compact`], so it must never be retained across a mutation or
/// exposed to callers that outlive one (JS always gets path strings).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FileId(u32);

impl FileId {
    #[inline]
    pub fn index(self) -> usize {
        self.0 as usize
    }

    /// Inverse of [`FileId::index`] for ids the store itself produced (the
    /// raw `u32`s in its sorted order / prefilter output).
    #[inline]
    pub(crate) fn from_raw(raw: u32) -> FileId {
        FileId(raw)
    }
}

/// What kind of filesystem object an entry is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

/// Per-entry metadata (POD). The stat fields are exactly what a
/// racily-clean comparison against a git index entry needs.
///
/// `kind` is always known (the crawl gets it from the dirent). The stat
/// fields are only meaningful for an entry whose stat block is VALID — read
/// them through [`Store::stat`], which returns `None` otherwise, never
/// zeroes that look real.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Meta {
    pub size: u64,
    pub mode: u32,
    pub mtime_s: i64,
    pub mtime_ns: u32,
    pub ctime_s: i64,
    pub ctime_ns: u32,
    pub dev: u64,
    pub ino: u64,
    pub uid: u32,
    pub gid: u32,
    pub kind: EntryKind,
}

impl Default for Meta {
    fn default() -> Meta {
        Meta {
            size: 0,
            mode: 0,
            mtime_s: 0,
            mtime_ns: 0,
            ctime_s: 0,
            ctime_ns: 0,
            dev: 0,
            ino: 0,
            uid: 0,
            gid: 0,
            kind: EntryKind::File,
        }
    }
}

/// A path's location inside the arena.
#[derive(Clone, Copy)]
struct StrRef {
    off: u32,
    len: u32,
}

/// Entry tombstone: the slot's arena/meta storage is retained until the next
/// [`Store::compact`], but the entry is gone from the map and `sorted`.
const FLAG_DEAD: u8 = 1 << 0;

/// The entry's stat block holds real `lstat` data ([`Store::stat`] returns
/// `Some`). Clear for entries the enumeration-only crawl recorded (name +
/// kind from the dirent, no stat) and after [`Store::invalidate_stat`].
const FLAG_STAT_VALID: u8 = 1 << 1;

/// Capacity of the access-recency ring (entries, not bytes).
const TOUCH_RING_CAP: usize = 256;

/// Amortized bytes charged per hash-map entry: 4-byte key + 4-byte stored
/// hash + the internal index slot at its load factor. The map's index is an
/// implementation detail of `bun_collections`, so it is charged per *entry*;
/// everything the store allocates itself is charged by exact capacity.
const MAP_ENTRY_BYTES: usize = 24;

/// Vector-capacity floors used when a column first grows (see
/// [`grown_capacity`]).
const ARENA_FLOOR: usize = 64;
const COLUMN_FLOOR: usize = 8;

#[derive(Clone, Copy)]
struct TouchSlot {
    id: u32,
    seq: u64,
}

/// Column capacities one insertion will grow to, and the exact bytes the
/// store accounts for once it has (see [`Store::plan_growth`]).
#[derive(Clone, Copy)]
struct GrowthPlan {
    arena: usize,
    paths: usize,
    meta: usize,
    flags: usize,
    sorted: usize,
    map_entries: usize,
    bytes: usize,
}

impl GrowthPlan {
    fn new(
        arena: usize,
        paths: usize,
        meta: usize,
        flags: usize,
        sorted: usize,
        map_entries: usize,
        touch_cap: usize,
    ) -> GrowthPlan {
        GrowthPlan {
            arena,
            paths,
            meta,
            flags,
            sorted,
            map_entries,
            bytes: Store::accounted_bytes(
                arena,
                paths,
                meta,
                flags,
                sorted,
                map_entries,
                touch_cap,
            ),
        }
    }
}

/// Adapted hash/eq for the path map: keys are entry ids resolved to path
/// bytes through the arena, so the map never owns a second copy of any path.
struct PathLookup<'a> {
    arena: &'a [u8],
    paths: &'a [StrRef],
}

impl PathLookup<'_> {
    #[inline]
    fn resolve(&self, id: u32) -> &[u8] {
        let r = self.paths[id as usize];
        &self.arena[r.off as usize..r.off as usize + r.len as usize]
    }
}

impl ArrayHashAdapter<[u8], u32> for PathLookup<'_> {
    #[inline]
    fn hash(&self, key: &[u8]) -> u32 {
        hash_string(key)
    }
    #[inline]
    fn eql(&self, a: &[u8], b: &u32, _b_index: usize) -> bool {
        self.resolve(*b) == a
    }
}

type PathMap = ArrayHashMap<u32, (), AutoContext>;

/// See the module docs. All methods are plain `&self`/`&mut self`.
pub struct Store {
    /// All relative path bytes, back to back.
    arena: Vec<u8>,
    /// Indexed by `FileId`.
    paths: Vec<StrRef>,
    meta: Vec<Meta>,
    flags: Vec<u8>,
    /// `FileId` (as `u32`) keyed by path bytes resolved through the arena.
    by_path: PathMap,
    /// Live ids ordered by path bytes. Stale while `sorted_dirty` (see
    /// [`Store::extend_enumerated`] / [`Store::ensure_sorted`]).
    sorted: Vec<u32>,
    /// A batch was appended without maintaining `sorted`. The next ordered
    /// read must be preceded by [`Store::ensure_sorted`].
    sorted_dirty: bool,
    /// Recency ring; `touch_head` is the oldest slot once the ring is full.
    touch: Vec<TouchSlot>,
    touch_head: usize,
    touch_seq: u64,
    /// Bumped by every mutation that can change the live path set or
    /// invalidate a [`FileId`] (insert, remove, bulk load, compact); see
    /// [`Store::generation`]. `touch` does not bump it: recency only affects
    /// ranking, never the candidate set.
    generation: u64,
    /// `byte_freq[b]` = occurrences of byte `b` across all live paths,
    /// maintained incrementally on insert/remove. Lets `complete()` pick the
    /// rarest needle byte and bound the arena-sweep hit count without
    /// scanning anything (see [`Store::live_byte_count`]).
    byte_freq: [u32; 256],
    budget: usize,
    /// Exact retained bytes (see `recompute_bytes`). Never exceeds `budget`.
    bytes: usize,
    truncated: bool,
    dead: u32,
}

impl Store {
    /// `budget` is a hard cap on retained bytes; entries that don't fit are
    /// dropped (and `truncated()` becomes true), never panicked on.
    pub fn new(budget: usize) -> Store {
        Store {
            arena: Vec::new(),
            paths: Vec::new(),
            meta: Vec::new(),
            flags: Vec::new(),
            by_path: PathMap::new(),
            sorted: Vec::new(),
            sorted_dirty: false,
            touch: Vec::new(),
            touch_head: 0,
            touch_seq: 0,
            generation: 0,
            byte_freq: [0u32; 256],
            budget,
            bytes: 0,
            truncated: false,
            dead: 0,
        }
    }

    /// A replacement for a store whose generation was `predecessor`: an empty
    /// store whose generation starts strictly past it, so that a generation a
    /// caller captured from the OLD store can never equal one observed on the
    /// new store, no matter how many mutations follow (the generation is
    /// monotonic across the life of whatever owns the stores).
    pub fn new_after(budget: usize, predecessor: u64) -> Store {
        let mut store = Store::new(budget);
        store.generation = predecessor.wrapping_add(1);
        store
    }

    /// Number of live entries. Exact even while the sorted order is dirty.
    #[inline]
    pub fn len(&self) -> usize {
        self.paths.len() - self.dead as usize
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Exact bytes retained by the store (vector capacities + the amortized
    /// per-entry cost of the hash index).
    #[inline]
    pub fn memory_usage(&self) -> usize {
        self.bytes
    }

    #[inline]
    pub fn budget(&self) -> usize {
        self.budget
    }

    /// True once any entry has been dropped because the budget was hit.
    #[inline]
    pub fn truncated(&self) -> bool {
        self.truncated
    }

    /// Tombstones currently retained (cleared by [`Store::compact`]).
    /// Test-only: compaction is triggered internally off the `dead` counter.
    #[cfg(test)]
    pub(crate) fn tombstones(&self) -> usize {
        self.dead as usize
    }

    /// Mutation counter: bumped by every successful [`Store::upsert`],
    /// [`Store::remove`], [`Store::bulk_load`] and [`Store::compact`] (which
    /// invalidates ids), never by [`Store::touch`]. Lets a caller detect
    /// that ids and candidate sets it cached are still valid.
    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn get(&self, path: &[u8]) -> Option<FileId> {
        let idx = self.lookup_map_index(path)?;
        Some(FileId(self.by_path.keys()[idx]))
    }

    /// `id` must be a live id obtained from this store since its last
    /// mutation (compaction invalidates ids).
    #[inline]
    pub fn path(&self, id: FileId) -> &[u8] {
        let r = self.paths[id.index()];
        &self.arena[r.off as usize..r.off as usize + r.len as usize]
    }

    /// The entry's kind. Always known — the crawl records it from the dirent.
    #[inline]
    pub fn kind(&self, id: FileId) -> EntryKind {
        self.meta[id.index()].kind
    }

    /// The entry's cached `lstat` data, or `None` when no real stat has been
    /// recorded for it (the enumeration-only crawl records none) or it was
    /// invalidated. The returned `Meta`'s `kind` always matches
    /// [`Store::kind`].
    #[inline]
    pub fn stat(&self, id: FileId) -> Option<&Meta> {
        (self.flags[id.index()] & FLAG_STAT_VALID != 0).then(|| &self.meta[id.index()])
    }

    /// Record fresh `lstat` data for an existing entry (kind included) and
    /// mark its stat block VALID. Like [`Store::touch`], this changes no
    /// path and invalidates no id, so it does not bump the generation.
    #[inline]
    pub fn fill_stat(&mut self, id: FileId, meta: Meta) {
        self.meta[id.index()] = meta;
        self.flags[id.index()] |= FLAG_STAT_VALID;
    }

    /// Forget the entry's cached stat (its kind is kept).
    #[inline]
    pub fn invalidate_stat(&mut self, id: FileId) {
        self.flags[id.index()] &= !FLAG_STAT_VALID;
    }

    /// Insert or update with real `lstat` data; the entry's stat block
    /// becomes VALID. On update the metadata is replaced in place; on insert
    /// the entry is rejected with [`BudgetExceeded`] if it would push
    /// retained bytes past the budget.
    pub fn upsert(&mut self, path: &[u8], meta: Meta) -> Result<FileId, BudgetExceeded> {
        self.upsert_inner(path, meta.kind, Some(meta), true)
    }

    /// Insert or update an enumerated entry: kind only, no stat. An existing
    /// entry of the same kind keeps whatever (possibly newer) stat it has; a
    /// kind change discards it.
    pub fn upsert_enumerated(
        &mut self,
        path: &[u8],
        kind: EntryKind,
    ) -> Result<FileId, BudgetExceeded> {
        self.upsert_inner(path, kind, None, true)
    }

    /// Insert many statted entries; sorts once at the end. Entries that
    /// don't fit in the budget are dropped (`truncated()` becomes true).
    pub fn bulk_load<P, I>(&mut self, entries: I)
    where
        P: AsRef<[u8]>,
        I: IntoIterator<Item = (P, Meta)>,
    {
        for (path, meta) in entries {
            let _ = self.upsert_inner(path.as_ref(), meta.kind, Some(meta), false);
        }
        self.sorted_dirty = true;
        self.bytes = self.recompute_bytes();
        self.ensure_sorted();
    }

    /// [`Store::bulk_load`] for enumerated (kind-only, no stat) entries —
    /// what a crawl produces.
    pub fn bulk_load_enumerated<P, I>(&mut self, entries: I)
    where
        P: AsRef<[u8]>,
        I: IntoIterator<Item = (P, EntryKind)>,
    {
        self.extend_enumerated(entries);
        self.ensure_sorted();
    }

    /// Append one enumerated (kind-only) batch *without* re-sorting: the
    /// path map, the arena prefilter, `len()`, `get()` and `path()` are all
    /// coherent immediately, but the path-sorted order is left dirty until
    /// the next [`Store::ensure_sorted`]. This is what makes applying a
    /// progressive crawl's batches O(batch) instead of O(n log n) each: the
    /// one re-sort is amortized over however many batches arrive between
    /// ordered reads.
    pub fn extend_enumerated<P, I>(&mut self, entries: I)
    where
        P: AsRef<[u8]>,
        I: IntoIterator<Item = (P, EntryKind)>,
    {
        for (path, kind) in entries {
            let _ = self.upsert_inner(path.as_ref(), kind, None, false);
        }
        self.sorted_dirty = true;
        self.bytes = self.recompute_bytes();
    }

    /// Rebuild the path-sorted order if a batch append left it dirty. Must
    /// be called before any ordered read ([`Store::iter_sorted`],
    /// [`Store::range_with_prefix`]); the mutating entry points that depend
    /// on the order call it themselves.
    pub fn ensure_sorted(&mut self) {
        if self.sorted_dirty {
            self.sorted_dirty = false;
            self.rebuild_sorted();
            self.bytes = self.recompute_bytes();
        }
    }

    /// Remove `path`. The slot becomes a tombstone; storage is reclaimed by
    /// the next [`Store::compact`] (triggered automatically once tombstones
    /// outnumber a quarter of the live entries).
    pub fn remove(&mut self, path: &[u8]) -> bool {
        // The removal below splices the id out of the sorted order by
        // binary search, which needs that order to be current.
        self.ensure_sorted();
        let Some(map_idx) = self.lookup_map_index(path) else {
            return false;
        };
        let id = self.by_path.keys()[map_idx];
        self.by_path.swap_remove_at(map_idx);
        self.flags[id as usize] |= FLAG_DEAD;
        self.dead += 1;
        for &b in path {
            self.byte_freq[b as usize] -= 1;
        }
        self.generation += 1;
        let pos = self.sorted_position(path);
        // The id is live and indexed, so it is present in `sorted` at the
        // partition point of its own path.
        debug_assert_eq!(self.sorted.get(pos), Some(&id));
        if self.sorted.get(pos) == Some(&id) {
            self.sorted.remove(pos);
        }
        self.bytes = self.recompute_bytes();
        if self.should_compact() {
            self.compact();
        }
        true
    }

    /// Drop tombstones and rebuild the arena and index with exact capacities.
    /// Invalidates every outstanding [`FileId`].
    pub fn compact(&mut self) {
        // `sorted` is the live-id source below.
        self.ensure_sorted();
        let live = self.sorted.len();
        let live_path_bytes: usize = self
            .sorted
            .iter()
            .map(|&id| self.paths[id as usize].len as usize)
            .sum();

        let mut arena: Vec<u8> = Vec::new();
        reserve_to(&mut arena, live_path_bytes);
        let mut paths: Vec<StrRef> = Vec::new();
        reserve_to(&mut paths, live);
        let mut meta: Vec<Meta> = Vec::new();
        reserve_to(&mut meta, live);
        let mut flags: Vec<u8> = Vec::new();
        reserve_to(&mut flags, live);

        // `sorted` holds the live ids in path order, so new ids are assigned
        // in that same order and `sorted` becomes the identity.
        let mut remap: Vec<u32> = vec![u32::MAX; self.paths.len()];
        for (new_id, &old_id) in self.sorted.iter().enumerate() {
            let r = self.paths[old_id as usize];
            let off = arena.len();
            arena.extend_from_slice(&self.arena[r.off as usize..r.off as usize + r.len as usize]);
            // `off` fits in u32: the old arena already held these bytes.
            paths.push(StrRef {
                off: off as u32,
                len: r.len,
            });
            meta.push(self.meta[old_id as usize]);
            flags.push(self.flags[old_id as usize] & !FLAG_DEAD);
            remap[old_id as usize] = new_id as u32;
        }

        let mut by_path = PathMap::new();
        handle_oom(by_path.ensure_total_capacity(live));
        for new_id in 0..live {
            let lookup = PathLookup {
                arena: &arena,
                paths: &paths,
            };
            let r = paths[new_id];
            let path = &arena[r.off as usize..r.off as usize + r.len as usize];
            let gop = handle_oom(by_path.get_or_put_adapted(path, &lookup));
            debug_assert!(!gop.found_existing);
            *gop.key_ptr = new_id as u32;
        }

        self.arena = arena;
        self.paths = paths;
        self.meta = meta;
        self.flags = flags;
        self.by_path = by_path;
        let mut sorted: Vec<u32> = Vec::new();
        reserve_to(&mut sorted, live);
        sorted.extend(0..live as u32);
        self.sorted = sorted;
        self.remap_touch_ring(&remap);
        self.dead = 0;
        self.generation += 1;
        self.bytes = self.recompute_bytes();
    }

    /// Live ids in path order. Precondition: the sorted order is not dirty
    /// (see [`Store::ensure_sorted`]).
    pub fn iter_sorted(&self) -> impl Iterator<Item = FileId> + '_ {
        debug_assert!(!self.sorted_dirty, "ordered read of a dirty store");
        self.sorted.iter().map(|&id| FileId(id))
    }

    /// Live ids whose path starts with `prefix`, in path order. Both range
    /// bounds are resolved up front by binary search ([`Store::prefix_range`]),
    /// so iteration is a plain slice walk with no per-item prefix test.
    pub fn range_with_prefix<'a>(&'a self, prefix: &'a [u8]) -> impl Iterator<Item = FileId> + 'a {
        self.sorted[self.prefix_range(prefix)]
            .iter()
            .map(|&id| FileId(id))
    }

    /// Index range, in the path-sorted order, of the live ids whose path
    /// starts with `prefix`. The empty prefix is the whole order (no
    /// comparisons); otherwise two binary searches: the paths with `prefix`
    /// are exactly the contiguous block that sorts at or after `prefix` and
    /// still starts with it (any later path without the prefix sorts after
    /// every path with it).
    pub(crate) fn prefix_range(&self, prefix: &[u8]) -> core::ops::Range<usize> {
        debug_assert!(!self.sorted_dirty, "ordered read of a dirty store");
        if prefix.is_empty() {
            return 0..self.sorted.len();
        }
        let start = self.sorted_position(prefix);
        let end = start
            + self.sorted[start..].partition_point(|&id| self.path_bytes(id).starts_with(prefix));
        start..end
    }

    /// The raw ids of the path-sorted slice `range` (a sub-range of
    /// [`Store::prefix_range`]), each convertible with [`FileId::from_raw`].
    #[inline]
    pub(crate) fn sorted_ids(&self, range: core::ops::Range<usize>) -> &[u32] {
        debug_assert!(!self.sorted_dirty, "ordered read of a dirty store");
        &self.sorted[range]
    }

    /// A raw, thread-shareable, read-only view of the columns a parallel
    /// `complete()` chunk needs (see [`StoreView`]). The caller must uphold
    /// the view's blocking contract.
    #[inline]
    pub(crate) fn view(&self) -> StoreView {
        StoreView {
            arena: self.arena.as_ptr(),
            arena_len: self.arena.len(),
            paths: self.paths.as_ptr(),
            meta: self.meta.as_ptr(),
            len: self.paths.len(),
        }
    }

    /// Occurrences of `byte` across the bytes of every live path.
    #[inline]
    pub(crate) fn live_byte_count(&self, byte: u8) -> u32 {
        self.byte_freq[byte as usize]
    }

    /// Live ids whose path contains `lo` (or `up`, when given), in ascending
    /// id order, deduplicated, appended to `out` (cleared first).
    ///
    /// This is one `memchr`/`memchr2` sweep of the whole contiguous path
    /// arena; each hit offset is mapped back to its entry by binary search
    /// over the per-id arena offsets, which are ascending in id by
    /// construction (entries only ever append to the arena, and `compact`
    /// re-packs both in the same order). The arena still holds the bytes of
    /// tombstoned entries until the next compaction; their hits are skipped.
    pub(crate) fn ids_with_byte(&self, lo: u8, up: Option<u8>, out: &mut Vec<FileId>) {
        out.clear();
        match up {
            Some(up) if up != lo => self.map_hits(memchr::memchr2_iter(lo, up, &self.arena), out),
            _ => self.map_hits(memchr::memchr_iter(lo, &self.arena), out),
        }
    }

    /// Maps ascending arena hit offsets to deduplicated live ids (see
    /// [`Store::ids_with_byte`]).
    fn map_hits(&self, hits: impl Iterator<Item = usize>, out: &mut Vec<FileId>) {
        // `paths[..].off` is ascending and the arena has no gaps, so each
        // ascending hit lands at or after the previously hit entry.
        let mut next_entry = 0usize;
        let mut hit_end = 0usize;
        for hit in hits {
            if hit < hit_end {
                continue; // same entry as the previous hit
            }
            let idx = next_entry
                + self.paths[next_entry..]
                    .partition_point(|r| (r.off as usize + r.len as usize) <= hit);
            debug_assert!(idx < self.paths.len(), "arena hit past the last entry");
            let r = self.paths[idx];
            debug_assert!((r.off as usize..r.off as usize + r.len as usize).contains(&hit));
            hit_end = r.off as usize + r.len as usize;
            next_entry = idx + 1;
            if self.flags[idx] & FLAG_DEAD == 0 {
                out.push(FileId(idx as u32));
            }
        }
    }

    /// Record an access to `id` (most-recent-first ranking for
    /// [`crate::complete`] and [`Store::recent`]).
    pub fn touch(&mut self, id: FileId) {
        if self.touch.capacity() == 0 {
            let ring_bytes = TOUCH_RING_CAP * core::mem::size_of::<TouchSlot>();
            // The ring is best-effort bookkeeping: if it doesn't fit in the
            // budget, accesses simply aren't recorded.
            if self.bytes.saturating_add(ring_bytes) > self.budget {
                return;
            }
            reserve_to(&mut self.touch, TOUCH_RING_CAP);
            self.bytes = self.recompute_bytes();
        }
        self.touch_seq += 1;
        let slot = TouchSlot {
            id: id.0,
            seq: self.touch_seq,
        };
        if self.touch.len() < TOUCH_RING_CAP {
            self.touch.push(slot);
        } else {
            self.touch[self.touch_head] = slot;
            self.touch_head = (self.touch_head + 1) % TOUCH_RING_CAP;
        }
    }

    /// The most recently touched live paths, most recent first, deduplicated,
    /// at most `n`.
    pub fn recent(&self, n: usize) -> Vec<FileId> {
        let mut out: Vec<FileId> = Vec::new();
        if n == 0 {
            return out;
        }
        self.for_each_recent(|id| {
            out.push(id);
            out.len() < n
        });
        out
    }

    /// Most-recent-first rank of every live id in the touch ring, as an
    /// id-keyed map. `complete()` builds this once per query.
    pub(crate) fn touch_ranks(&self) -> ArrayHashMap<u32, u32, AutoContext> {
        let mut ranks: ArrayHashMap<u32, u32, AutoContext> = ArrayHashMap::new();
        let mut rank: u32 = 0;
        self.for_each_recent(|id| {
            let _ = ranks.put_no_clobber(id.0, rank);
            rank += 1;
            true
        });
        ranks
    }

    // ── internals ────────────────────────────────────────────────────────

    /// Visit live, deduplicated ring entries newest-first until `f` returns
    /// false.
    fn for_each_recent(&self, mut f: impl FnMut(FileId) -> bool) -> bool {
        let len = self.touch.len();
        let mut seen: Vec<u32> = Vec::new();
        for i in (0..len).rev() {
            // Newest-first: slots `[touch_head..len)` are older than
            // `[0..touch_head)` once the ring has wrapped.
            let slot = self.touch[(self.touch_head + i) % len];
            if self.flags[slot.id as usize] & FLAG_DEAD != 0 || seen.contains(&slot.id) {
                continue;
            }
            seen.push(slot.id);
            if !f(FileId(slot.id)) {
                return false;
            }
        }
        true
    }

    #[inline]
    fn path_bytes(&self, id: u32) -> &[u8] {
        let r = self.paths[id as usize];
        &self.arena[r.off as usize..r.off as usize + r.len as usize]
    }

    fn lookup_map_index(&self, path: &[u8]) -> Option<usize> {
        let lookup = PathLookup {
            arena: &self.arena,
            paths: &self.paths,
        };
        self.by_path.get_index_adapted(path, &lookup)
    }

    /// First index in `sorted` whose path is `>= path`.
    fn sorted_position(&self, path: &[u8]) -> usize {
        self.sorted
            .partition_point(|&id| self.path_bytes(id) < path)
    }

    /// `stat: Some(meta)` records a real lstat (its `kind` equals `kind`)
    /// and marks the stat block VALID; `None` is an enumerated entry. With
    /// `maintain_sorted`, a new id is spliced into `sorted` — unless the
    /// order is already dirty, in which case the pending rebuild covers it.
    fn upsert_inner(
        &mut self,
        path: &[u8],
        kind: EntryKind,
        stat: Option<Meta>,
        maintain_sorted: bool,
    ) -> Result<FileId, BudgetExceeded> {
        debug_assert!(stat.is_none_or(|m| m.kind == kind));
        if let Some(map_idx) = self.lookup_map_index(path) {
            let id = self.by_path.keys()[map_idx];
            match stat {
                Some(meta) => self.fill_stat(FileId(id), meta),
                // An enumerated upsert never downgrades a (newer) cached
                // stat of the same kind; a kind change makes it stale.
                None if self.meta[id as usize].kind != kind => {
                    self.meta[id as usize] = Meta {
                        kind,
                        ..Meta::default()
                    };
                    self.invalidate_stat(FileId(id));
                }
                None => {}
            }
            self.generation += 1;
            return Ok(FileId(id));
        }

        // Arena offsets, path lengths and ids are u32.
        let new_off = self.arena.len();
        if new_off + path.len() > u32::MAX as usize || self.paths.len() >= u32::MAX as usize {
            self.truncated = true;
            return Err(BudgetExceeded);
        }

        let Some(plan) = self.plan_growth(path.len()) else {
            self.truncated = true;
            return Err(BudgetExceeded);
        };
        self.apply_growth(&plan);

        let id = self.paths.len() as u32;
        self.arena.extend_from_slice(path);
        self.paths.push(StrRef {
            off: new_off as u32,
            len: path.len() as u32,
        });
        self.meta.push(stat.unwrap_or_else(|| Meta {
            kind,
            ..Meta::default()
        }));
        self.flags
            .push(if stat.is_some() { FLAG_STAT_VALID } else { 0 });

        {
            let lookup = PathLookup {
                arena: &self.arena,
                paths: &self.paths,
            };
            let gop = handle_oom(self.by_path.get_or_put_adapted(path, &lookup));
            debug_assert!(!gop.found_existing);
            *gop.key_ptr = id;
        }

        if maintain_sorted && !self.sorted_dirty {
            let pos = self.sorted_position(path);
            self.sorted.insert(pos, id);
        }
        for &b in path {
            self.byte_freq[b as usize] += 1;
        }
        self.generation += 1;
        self.bytes = self.recompute_bytes();
        Ok(FileId(id))
    }

    fn should_compact(&self) -> bool {
        self.dead as usize * 4 > self.len()
    }

    fn rebuild_sorted(&mut self) {
        let live = self.paths.len() - self.dead as usize;
        self.sorted.clear();
        let sorted_target = grown_capacity(self.sorted.capacity(), live, COLUMN_FLOOR);
        reserve_to(&mut self.sorted, sorted_target);
        self.sorted.extend(
            (0..self.paths.len() as u32).filter(|&id| self.flags[id as usize] & FLAG_DEAD == 0),
        );
        let (arena, paths) = (&self.arena, &self.paths);
        self.sorted.sort_unstable_by(|&a, &b| {
            let ra = paths[a as usize];
            let rb = paths[b as usize];
            let pa = &arena[ra.off as usize..ra.off as usize + ra.len as usize];
            let pb = &arena[rb.off as usize..rb.off as usize + rb.len as usize];
            pa.cmp(pb)
        });
    }

    /// Column capacities (and the accounted bytes they imply) for one more
    /// entry with `path_len` path bytes; the store grows to exactly these
    /// (`reserve_exact`), so the projection is exact. Amortized doubling
    /// while the doubled total fits the budget; once it does not, every
    /// column is sized at once for the largest entry count the budget can
    /// hold ([`Store::fitted_plan`]) so retained bytes approach the budget
    /// instead of stranding the headroom a refused doubling left behind.
    /// `None` when even the exact minimum no longer fits.
    fn plan_growth(&self, path_len: usize) -> Option<GrowthPlan> {
        let n = self.paths.len() + 1;
        let live = n - self.dead as usize;
        let arena_need = self.arena.len() + path_len;
        let map_entries = self.by_path.count() + 1;
        let touch_cap = self.touch.capacity();

        let doubled = GrowthPlan::new(
            grown_capacity(self.arena.capacity(), arena_need, ARENA_FLOOR),
            grown_capacity(self.paths.capacity(), n, COLUMN_FLOOR),
            grown_capacity(self.meta.capacity(), n, COLUMN_FLOOR),
            grown_capacity(self.flags.capacity(), n, ARENA_FLOOR),
            grown_capacity(self.sorted.capacity(), live, COLUMN_FLOOR),
            map_entries,
            touch_cap,
        );
        if doubled.bytes <= self.budget {
            return Some(doubled);
        }
        let exact = GrowthPlan::new(
            self.arena.capacity().max(arena_need),
            self.paths.capacity().max(n),
            self.meta.capacity().max(n),
            self.flags.capacity().max(n),
            self.sorted.capacity().max(live),
            map_entries,
            touch_cap,
        );
        if exact.bytes > self.budget {
            return None;
        }
        Some(self.fitted_plan(&exact, arena_need, n).unwrap_or(exact))
    }

    /// The largest coordinated growth that still fits the budget: model the
    /// store at `entries` entries of the current average path length (every
    /// column at the larger of its existing capacity and that entry count,
    /// plus the per-entry hash-map cost those entries will incur) and find
    /// the largest affordable entry count by binary search — the modelled
    /// bytes are monotone in it. `None` when that is no better than `exact`
    /// (the store is then within one entry of the cap).
    fn fitted_plan(&self, exact: &GrowthPlan, arena_need: usize, n: usize) -> Option<GrowthPlan> {
        let touch_cap = self.touch.capacity();
        let avg_path = arena_need.div_ceil(n).max(1);
        let at = |entries: usize| {
            GrowthPlan::new(
                exact.arena.max(entries.saturating_mul(avg_path)),
                exact.paths.max(entries),
                exact.meta.max(entries),
                exact.flags.max(entries),
                exact.sorted.max(entries),
                exact.map_entries.max(entries),
                touch_cap,
            )
        };
        let per_entry = avg_path
            + core::mem::size_of::<StrRef>()
            + core::mem::size_of::<Meta>()
            + 1
            + core::mem::size_of::<u32>()
            + MAP_ENTRY_BYTES;
        // `at(x).bytes >= x * per_entry`, so `hi` never fits; `lo` must.
        let mut lo = n;
        let mut hi = self.budget / per_entry + 1;
        if at(lo).bytes > self.budget || hi <= lo {
            return None;
        }
        while hi - lo > 1 {
            let mid = lo + (hi - lo) / 2;
            if at(mid).bytes <= self.budget {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        if lo <= n {
            return None;
        }
        // The applied plan accounts for the hash map at its real entry count
        // (`exact.map_entries`, <= the modelled `lo`), never more than `at(lo)`.
        Some(GrowthPlan::new(
            exact.arena.max(lo.saturating_mul(avg_path)),
            exact.paths.max(lo),
            exact.meta.max(lo),
            exact.flags.max(lo),
            exact.sorted.max(lo),
            exact.map_entries,
            touch_cap,
        ))
    }

    fn apply_growth(&mut self, plan: &GrowthPlan) {
        reserve_to(&mut self.arena, plan.arena);
        reserve_to(&mut self.paths, plan.paths);
        reserve_to(&mut self.meta, plan.meta);
        reserve_to(&mut self.flags, plan.flags);
        reserve_to(&mut self.sorted, plan.sorted);
    }

    fn recompute_bytes(&self) -> usize {
        Self::accounted_bytes(
            self.arena.capacity(),
            self.paths.capacity(),
            self.meta.capacity(),
            self.flags.capacity(),
            self.sorted.capacity(),
            self.by_path.count(),
            self.touch.capacity(),
        )
    }

    fn accounted_bytes(
        arena_cap: usize,
        paths_cap: usize,
        meta_cap: usize,
        flags_cap: usize,
        sorted_cap: usize,
        map_entries: usize,
        touch_cap: usize,
    ) -> usize {
        arena_cap
            + paths_cap * core::mem::size_of::<StrRef>()
            + meta_cap * core::mem::size_of::<Meta>()
            + flags_cap
            + sorted_cap * core::mem::size_of::<u32>()
            + map_entries * MAP_ENTRY_BYTES
            + touch_cap * core::mem::size_of::<TouchSlot>()
    }

    fn remap_touch_ring(&mut self, remap: &[u32]) {
        if self.touch.is_empty() {
            return;
        }
        // Re-pack the surviving slots oldest-first so `touch_head` resets to 0.
        let len = self.touch.len();
        let mut kept: Vec<TouchSlot> = Vec::with_capacity(len);
        for i in 0..len {
            let slot = self.touch[(self.touch_head + i) % len];
            let new_id = remap[slot.id as usize];
            if new_id != u32::MAX {
                kept.push(TouchSlot {
                    id: new_id,
                    seq: slot.seq,
                });
            }
        }
        self.touch.clear();
        self.touch.extend_from_slice(&kept);
        self.touch_head = 0;
    }
}

/// An immutable raw view of the three columns the per-candidate `complete()`
/// pipeline reads — the path arena, the per-id path refs and the per-id
/// metadata (`kind`) — built by [`Store::view`] on the thread that owns the
/// store and handed to the work-pool chunks of `complete()`'s parallel
/// fan-out (`crate::complete`).
///
/// # Safety contract (why the `Send`/`Sync` impls below are sound)
///
/// The owning thread builds the view inside `complete()` and **blocks there
/// until every chunk has finished** (it joins a per-chunk `WaitGroup` before
/// returning), and the `Store` is `!Sync` and owned by that same thread, so:
///
/// - the pointed-to columns cannot be mutated, reallocated, or dropped while
///   any worker holds the view (the only thread that could is blocked);
/// - workers only ever read through it.
///
/// A worker task that runs *after* the owning thread has unblocked (one the
/// pool dequeued too late to claim a chunk) never dereferences the view: the
/// pointers may dangle by then, which is why they are raw pointers and not
/// slices.
#[derive(Clone, Copy)]
pub(crate) struct StoreView {
    arena: *const u8,
    arena_len: usize,
    paths: *const StrRef,
    meta: *const Meta,
    /// Entry count: `paths` and `meta` both have this many elements.
    len: usize,
}

// SAFETY: see the type docs — the view is a read-only snapshot whose pointees
// are kept alive and unmutated by the owning thread blocking inside
// `complete()` for as long as any worker can dereference it.
unsafe impl Send for StoreView {}
// SAFETY: same as `Send`; all access through the view is read-only.
unsafe impl Sync for StoreView {}

impl StoreView {
    /// Same as [`Store::path`]. `id` must come from the candidate list the
    /// owning thread built from the same store the view was taken from.
    #[inline]
    pub(crate) fn path(&self, id: FileId) -> &[u8] {
        // SAFETY: `paths` points to `len` initialized `StrRef`s of the live,
        // unmutated store (see the type docs); the index is bounds-checked.
        let r = unsafe { core::slice::from_raw_parts(self.paths, self.len) }[id.index()];
        // SAFETY: every `StrRef` the store hands out is in bounds of its
        // arena (`off + len <= arena_len`, re-checked here).
        let arena = unsafe { core::slice::from_raw_parts(self.arena, self.arena_len) };
        &arena[r.off as usize..r.off as usize + r.len as usize]
    }

    /// Same as [`Store::kind`].
    #[inline]
    pub(crate) fn kind(&self, id: FileId) -> EntryKind {
        // SAFETY: `meta` points to `len` initialized `Meta`s of the live,
        // unmutated store (see the type docs); the index is bounds-checked.
        let meta = unsafe { core::slice::from_raw_parts(self.meta, self.len) };
        meta[id.index()].kind
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(kind: EntryKind, size: u64) -> Meta {
        Meta {
            size,
            kind,
            ..Meta::default()
        }
    }

    fn paths_of(store: &Store, ids: impl IntoIterator<Item = FileId>) -> Vec<Vec<u8>> {
        ids.into_iter().map(|id| store.path(id).to_vec()).collect()
    }

    fn load(store: &mut Store, paths: &[&[u8]]) {
        for p in paths {
            store.upsert(p, meta(EntryKind::File, 1)).unwrap();
        }
    }

    #[test]
    fn upsert_get_path_meta_roundtrip() {
        let mut s = Store::new(1 << 20);
        let id = s.upsert(b"src/main.rs", meta(EntryKind::File, 42)).unwrap();
        assert_eq!(s.path(id), b"src/main.rs");
        assert_eq!(s.stat(id).unwrap().size, 42);
        assert_eq!(s.get(b"src/main.rs"), Some(id));
        assert_eq!(s.get(b"src/main.r"), None);
        assert_eq!(s.len(), 1);

        // Update in place: same id, new meta, no new entry.
        let id2 = s.upsert(b"src/main.rs", meta(EntryKind::File, 7)).unwrap();
        assert_eq!(id2, id);
        assert_eq!(s.stat(id).unwrap().size, 7);
        assert_eq!(s.len(), 1);
    }

    #[test]
    fn iter_sorted_is_byte_lexicographic() {
        let mut s = Store::new(1 << 20);
        load(&mut s, &[b"b", b"a/z", b"a", b"a/b", b"ab", b"\xffbin"]);
        assert_eq!(
            paths_of(&s, s.iter_sorted()),
            vec![
                b"a".to_vec(),
                b"a/b".to_vec(),
                b"a/z".to_vec(),
                b"ab".to_vec(),
                b"b".to_vec(),
                b"\xffbin".to_vec()
            ]
        );
    }

    #[test]
    fn range_with_prefix_binary_searches_the_sorted_order() {
        let mut s = Store::new(1 << 20);
        load(
            &mut s,
            &[
                b"src/a.rs",
                b"src/b.rs",
                b"src2/x.rs",
                b"lib/c.rs",
                b"src/",
                b"sr",
            ],
        );
        assert_eq!(
            paths_of(&s, s.range_with_prefix(b"src/")),
            vec![b"src/".to_vec(), b"src/a.rs".to_vec(), b"src/b.rs".to_vec()]
        );
        // Empty prefix = everything, in order.
        assert_eq!(s.range_with_prefix(b"").count(), s.len());
        assert_eq!(s.range_with_prefix(b"zzz").count(), 0);
    }

    #[test]
    fn remove_tombstones_then_compact_reclaims() {
        let mut s = Store::new(1 << 20);
        let names: Vec<Vec<u8>> = (0..64u32)
            .map(|i| format!("dir/file{i:03}.txt").into_bytes())
            .collect();
        for n in &names {
            s.upsert(n, meta(EntryKind::File, 1)).unwrap();
        }
        assert_eq!(s.len(), 64);
        assert!(!s.remove(b"dir/absent.txt"));

        // Stay below the auto-compaction threshold (dead*4 <= live).
        for n in names.iter().take(8) {
            assert!(s.remove(n));
        }
        assert_eq!(s.len(), 56);
        assert_eq!(s.tombstones(), 8);
        assert_eq!(s.get(&names[0]), None);
        assert_eq!(s.range_with_prefix(b"dir/file00").count(), 2); // 008, 009

        let before = s.memory_usage();
        s.compact();
        assert_eq!(s.tombstones(), 0);
        assert_eq!(s.len(), 56);
        assert!(s.memory_usage() < before, "compaction must shrink");
        // Ids are reassigned but lookups and order are intact.
        let got = paths_of(&s, s.iter_sorted());
        let expected: Vec<Vec<u8>> = names[8..].to_vec();
        assert_eq!(got, expected);
        for n in &names[8..] {
            assert!(s.get(n).is_some());
        }
    }

    #[test]
    fn remove_auto_compacts_past_quarter_dead() {
        let mut s = Store::new(1 << 20);
        let names: Vec<Vec<u8>> = (0..20u32)
            .map(|i| format!("f{i:02}").into_bytes())
            .collect();
        for n in &names {
            s.upsert(n, Meta::default()).unwrap();
        }
        for n in names.iter().take(5) {
            assert!(s.remove(n));
        }
        // 5 dead vs 15 live: 5*4 > 15 triggered a compaction on the last remove.
        assert_eq!(s.tombstones(), 0);
        assert_eq!(s.len(), 15);
        assert_eq!(
            s.get(&names[5]).map(|id| s.path(id).to_vec()),
            Some(names[5].clone())
        );
    }

    #[test]
    fn reinsert_after_remove_is_live_again() {
        let mut s = Store::new(1 << 20);
        s.upsert(b"a", meta(EntryKind::File, 1)).unwrap();
        s.upsert(b"b", meta(EntryKind::File, 1)).unwrap();
        assert!(s.remove(b"a"));
        assert_eq!(s.get(b"a"), None);
        let id = s.upsert(b"a", meta(EntryKind::Dir, 9)).unwrap();
        assert_eq!(s.get(b"a"), Some(id));
        assert_eq!(s.kind(id), EntryKind::Dir);
        assert_eq!(
            paths_of(&s, s.iter_sorted()),
            vec![b"a".to_vec(), b"b".to_vec()]
        );
    }

    #[test]
    fn bulk_load_sorts_once_and_dedupes() {
        let mut s = Store::new(1 << 20);
        s.bulk_load([
            (b"z".as_slice(), meta(EntryKind::File, 1)),
            (b"a".as_slice(), meta(EntryKind::File, 1)),
            (b"m/n".as_slice(), meta(EntryKind::Dir, 0)),
            (b"a".as_slice(), meta(EntryKind::File, 5)),
        ]);
        assert_eq!(s.len(), 3);
        assert_eq!(
            paths_of(&s, s.iter_sorted()),
            vec![b"a".to_vec(), b"m/n".to_vec(), b"z".to_vec()]
        );
        assert_eq!(s.stat(s.get(b"a").unwrap()).unwrap().size, 5);
        // Incremental upserts after a bulk load keep the order sorted.
        s.upsert(b"b", meta(EntryKind::File, 1)).unwrap();
        assert_eq!(
            paths_of(&s, s.iter_sorted()),
            vec![b"a".to_vec(), b"b".to_vec(), b"m/n".to_vec(), b"z".to_vec()]
        );
    }

    #[test]
    fn budget_is_a_hard_cap_and_sets_truncated() {
        // Big enough for a handful of entries, far too small for 10k.
        let budget = 4096;
        let mut s = Store::new(budget);
        let mut accepted = 0usize;
        for i in 0..10_000u32 {
            let p = format!("some/dir/with/a/long/prefix/file_{i:05}.tsx").into_bytes();
            match s.upsert(&p, meta(EntryKind::File, u64::from(i))) {
                Ok(_) => accepted += 1,
                Err(BudgetExceeded) => {}
            }
            assert!(
                s.memory_usage() <= budget,
                "bytes {} exceeded budget {budget} after {i} upserts",
                s.memory_usage()
            );
        }
        assert!(s.truncated());
        assert!(accepted > 0, "a 4 KiB budget must fit at least one entry");
        assert!(accepted < 10_000);
        assert_eq!(s.len(), accepted);
        // The store keeps working on what fit.
        let first = s.iter_sorted().next().unwrap();
        assert!(s.get(s.path(first).to_vec().as_slice()).is_some());
    }

    #[test]
    fn budget_between_doubling_boundaries_is_packed_not_stranded() {
        // A budget that a column doubling (here: 1024 -> 2048 entries) would
        // overshoot. Refusing the doubling outright froze the store at the
        // previous capacity (1024 entries, ~84% of this budget); the fitted
        // growth must instead pack entries until within one entry of the cap.
        let budget = 200_000;
        let mut s = Store::new(budget);
        let mut accepted = 0usize;
        loop {
            let p = format!("some/dir/path/entry_{accepted:017}.rs");
            assert_eq!(p.len(), 40);
            match s.upsert(p.as_bytes(), Meta::default()) {
                Ok(_) => accepted += 1,
                Err(BudgetExceeded) => break,
            }
            assert!(
                s.memory_usage() <= budget,
                "bytes {} exceeded budget {budget}",
                s.memory_usage()
            );
        }
        assert!(s.truncated());
        assert_eq!(s.len(), accepted);
        assert_eq!(s.memory_usage(), s.recompute_bytes());
        let used = s.memory_usage();
        assert!(used <= budget);
        assert!(
            used * 10 > budget * 9,
            "only {used} of {budget} budget bytes used"
        );
        assert!(
            accepted > 1100,
            "{accepted} entries: the budget had room for more"
        );
        // The cap is sticky: later (even shorter) inserts keep being rejected
        // once nothing more fits, and reads keep working on what did.
        assert_eq!(s.upsert(b"zz.rs", Meta::default()), Err(BudgetExceeded));
        assert!(s.get(b"some/dir/path/entry_00000000000000000.rs").is_some());
    }

    #[test]
    fn zero_budget_accepts_nothing_and_never_panics() {
        let mut s = Store::new(0);
        assert_eq!(s.upsert(b"a", Meta::default()), Err(BudgetExceeded));
        assert!(s.truncated());
        assert_eq!(s.len(), 0);
        assert_eq!(s.memory_usage(), 0);
        assert!(!s.remove(b"a"));
        s.touch(FileId(0)); // out-of-range id never recorded: ring not allocated
        assert!(s.recent(10).is_empty());
    }

    #[test]
    fn memory_usage_grows_with_content_and_is_exact_after_compact() {
        let mut s = Store::new(1 << 24);
        let empty = s.memory_usage();
        load(&mut s, &[b"aaaa", b"bbbb", b"cccc"]);
        assert!(s.memory_usage() > empty);
        s.compact();
        // After compaction every vector is exactly sized.
        let expected = Store::accounted_bytes(12, 3, 3, 3, 3, 3, 0);
        assert_eq!(s.memory_usage(), expected);
    }

    #[test]
    fn touch_and_recent_are_most_recent_first_and_skip_dead() {
        let mut s = Store::new(1 << 20);
        let a = s.upsert(b"a", Meta::default()).unwrap();
        let b = s.upsert(b"b", Meta::default()).unwrap();
        let c = s.upsert(b"c", Meta::default()).unwrap();
        assert!(s.recent(8).is_empty());
        s.touch(a);
        s.touch(b);
        s.touch(c);
        s.touch(a); // a again: dedup keeps the newest occurrence
        assert_eq!(s.recent(8), vec![a, c, b]);
        assert_eq!(s.recent(2), vec![a, c]);
        assert_eq!(s.recent(0), Vec::<FileId>::new());

        assert!(s.remove(b"c"));
        assert_eq!(s.recent(8), vec![a, b]);

        let ranks = s.touch_ranks();
        assert_eq!(ranks.get(&a.0).copied(), Some(0));
        assert_eq!(ranks.get(&b.0).copied(), Some(1));
        assert!(ranks.get(&c.0).is_none());
    }

    #[test]
    fn touch_ring_wraps_and_survives_compaction() {
        let mut s = Store::new(1 << 22);
        let names: Vec<Vec<u8>> = (0..600u32)
            .map(|i| format!("p{i:04}").into_bytes())
            .collect();
        let ids: Vec<FileId> = names
            .iter()
            .map(|n| s.upsert(n, Meta::default()).unwrap())
            .collect();
        for &id in &ids {
            s.touch(id);
        }
        // Ring holds the last TOUCH_RING_CAP touches.
        let recent = s.recent(TOUCH_RING_CAP);
        assert_eq!(recent.len(), TOUCH_RING_CAP);
        assert_eq!(s.path(recent[0]), b"p0599");
        assert_eq!(
            s.path(*recent.last().unwrap()),
            names[600 - TOUCH_RING_CAP].as_slice()
        );

        // Remove untouched entries to force a compaction, then verify the
        // ring's ids were remapped to the surviving paths.
        for n in names.iter().take(200) {
            assert!(s.remove(n));
        }
        assert_eq!(s.len(), 400);
        // Auto-compaction ran at least once on the way (and re-armed after).
        assert!(s.tombstones() * 4 <= s.len());
        let recent_after = s.recent(4);
        assert_eq!(s.path(recent_after[0]), b"p0599");
        assert_eq!(s.path(recent_after[3]), b"p0596");
    }

    #[test]
    fn non_utf8_and_empty_paths_are_preserved() {
        let mut s = Store::new(1 << 20);
        let weird: &[u8] = b"dir/\xf0\x28\x8c\x28";
        let id = s.upsert(weird, Meta::default()).unwrap();
        assert_eq!(s.path(id), weird);
        assert_eq!(s.get(weird), Some(id));
        let root = s.upsert(b"", meta(EntryKind::Dir, 0)).unwrap();
        assert_eq!(s.path(root), b"");
        assert_eq!(s.iter_sorted().next(), Some(root));
    }

    #[test]
    fn many_entries_stay_consistent() {
        let mut s = Store::new(1 << 24);
        let names: Vec<Vec<u8>> = (0..2000u32)
            .map(|i| format!("src/m{}/f{i}.rs", i % 17).into_bytes())
            .collect();
        s.bulk_load(names.iter().map(|n| (n.as_slice(), Meta::default())));
        assert_eq!(s.len(), names.len());
        let mut expected: Vec<Vec<u8>> = names.clone();
        expected.sort();
        assert_eq!(paths_of(&s, s.iter_sorted()), expected);
        for n in &names {
            let id = s.get(n).unwrap();
            assert_eq!(s.path(id), n.as_slice());
        }
    }

    #[test]
    fn range_with_prefix_end_bound_edge_cases() {
        let mut s = Store::new(1 << 20);
        load(
            &mut s,
            &[
                b"a",
                b"ab",
                b"abz",
                b"ab\xff",
                b"ab\xff\xff",
                b"b",
                b"\xff",
                b"\xff\xff",
            ],
        );
        // The prefix that is also the LAST key in the order.
        assert_eq!(
            paths_of(&s, s.range_with_prefix(b"\xff\xff")),
            vec![b"\xff\xff".to_vec()]
        );
        // Prefix ending in 0xff (no same-length lexicographic successor).
        assert_eq!(
            paths_of(&s, s.range_with_prefix(b"ab\xff")),
            vec![b"ab\xff".to_vec(), b"ab\xff\xff".to_vec()]
        );
        assert_eq!(
            paths_of(&s, s.range_with_prefix(b"\xff")),
            vec![b"\xff".to_vec(), b"\xff\xff".to_vec()]
        );
        // A prefix matched only by itself; one greater than every key.
        assert_eq!(paths_of(&s, s.range_with_prefix(b"b")), vec![b"b".to_vec()]);
        assert_eq!(s.range_with_prefix(b"zzz").count(), 0);
        // Everything, and the first key's block.
        assert_eq!(s.range_with_prefix(b"").count(), s.len());
        assert_eq!(
            paths_of(&s, s.range_with_prefix(b"a")),
            vec![
                b"a".to_vec(),
                b"ab".to_vec(),
                b"abz".to_vec(),
                b"ab\xff".to_vec(),
                b"ab\xff\xff".to_vec()
            ]
        );
        // A prefix longer than any key it could match.
        assert_eq!(s.range_with_prefix(b"ab\xff\xff\xff").count(), 0);
        let empty = Store::new(1 << 20);
        assert_eq!(empty.range_with_prefix(b"").count(), 0);
        assert_eq!(empty.range_with_prefix(b"x").count(), 0);
    }

    #[test]
    fn generation_bumps_on_mutation_but_not_on_touch() {
        let mut s = Store::new(1 << 20);
        let g0 = s.generation();
        let id = s.upsert(b"a", Meta::default()).unwrap();
        let g1 = s.generation();
        assert!(g1 > g0, "insert must bump");
        s.touch(id);
        assert_eq!(s.generation(), g1, "touch must not bump");
        s.upsert(b"a", meta(EntryKind::Dir, 0)).unwrap();
        let g2 = s.generation();
        assert!(g2 > g1, "meta update must bump");
        s.upsert(b"b", Meta::default()).unwrap();
        let g3 = s.generation();
        assert!(g3 > g2);
        assert!(s.remove(b"b"));
        let g4 = s.generation();
        assert!(g4 > g3, "remove must bump");
        assert!(!s.remove(b"b"));
        assert_eq!(s.generation(), g4, "a no-op remove must not bump");
        s.compact();
        assert!(s.generation() > g4, "compact invalidates ids and must bump");
    }

    /// A replacement store seeded with [`Store::new_after`] can never reach a
    /// generation an observer captured from its predecessor: the guard
    /// "drop the result if the generation changed" stays sound across a
    /// `refresh()` that swaps the store (a plain `Store::new` restarts at 0
    /// and an exact-wraparound — old == new after k mutations — defeats it).
    #[test]
    fn new_after_keeps_the_generation_monotonic_across_a_replacement() {
        let mut old = Store::new(1 << 20);
        for i in 0..5u32 {
            old.upsert(format!("f{i}").as_bytes(), Meta::default())
                .unwrap();
        }
        let observed = old.generation();
        // The defeated scenario: a fresh store re-reaches `observed`.
        let mut naive = Store::new(1 << 20);
        for i in 0..5u32 {
            naive
                .upsert(format!("g{i}").as_bytes(), Meta::default())
                .unwrap();
        }
        assert_eq!(naive.generation(), observed, "the wraparound is real");

        let mut replacement = Store::new_after(1 << 20, observed);
        assert!(replacement.generation() > observed);
        for i in 0..16u32 {
            replacement
                .upsert(format!("g{i}").as_bytes(), Meta::default())
                .unwrap();
            assert!(replacement.generation() > observed);
        }
    }

    #[test]
    fn stat_validity_is_explicit_and_kind_is_always_known() {
        let mut s = Store::new(1 << 20);
        // An enumerated entry has a kind but no stat — nothing to misread.
        let a = s.upsert_enumerated(b"a", EntryKind::Symlink).unwrap();
        assert_eq!(s.kind(a), EntryKind::Symlink);
        assert_eq!(s.stat(a), None);
        let g_enumerated = s.generation();

        // fill_stat / invalidate_stat flip exactly the validity bit and,
        // like touch, never bump the generation (no path or id changes).
        s.fill_stat(a, meta(EntryKind::Symlink, 9));
        assert_eq!(s.stat(a).map(|m| m.size), Some(9));
        assert_eq!(s.kind(a), EntryKind::Symlink);
        s.invalidate_stat(a);
        assert_eq!(s.stat(a), None);
        assert_eq!(s.kind(a), EntryKind::Symlink);
        assert_eq!(s.generation(), g_enumerated);

        // A full upsert (a real lstat) is valid immediately, on insert and
        // on update of an enumerated entry.
        let b = s.upsert(b"b", meta(EntryKind::File, 7)).unwrap();
        assert_eq!(s.stat(b).map(|m| m.size), Some(7));
        s.fill_stat(a, meta(EntryKind::Symlink, 1));
        assert_eq!(s.upsert(b"a", meta(EntryKind::File, 3)), Ok(a));
        assert_eq!(
            (s.kind(a), s.stat(a).map(|m| m.size)),
            (EntryKind::File, Some(3))
        );

        // An enumerated re-upsert never downgrades a same-kind cached stat,
        // and discards it on a kind change.
        assert_eq!(s.upsert_enumerated(b"a", EntryKind::File), Ok(a));
        assert_eq!(s.stat(a).map(|m| m.size), Some(3));
        assert_eq!(s.upsert_enumerated(b"a", EntryKind::Dir), Ok(a));
        assert_eq!((s.kind(a), s.stat(a)), (EntryKind::Dir, None));

        // Validity survives a compaction.
        s.upsert(b"c", meta(EntryKind::File, 5)).unwrap();
        assert!(s.remove(b"b"));
        s.compact();
        let a = s.get(b"a").unwrap();
        let c = s.get(b"c").unwrap();
        assert_eq!(s.stat(a), None);
        assert_eq!(s.stat(c).map(|m| m.size), Some(5));
        assert_eq!(s.memory_usage(), s.recompute_bytes());
    }

    #[test]
    fn extend_enumerated_defers_the_sort_until_ensure_sorted() {
        let mut s = Store::new(1 << 22);
        s.extend_enumerated([
            (b"z/b".as_slice(), EntryKind::File),
            (b"a".as_slice(), EntryKind::Dir),
            (b"m".as_slice(), EntryKind::File),
        ]);
        // Unordered reads are coherent while the order is dirty…
        assert_eq!(s.len(), 3);
        assert!(!s.is_empty());
        let a = s.get(b"a").unwrap();
        assert_eq!(
            (s.kind(a), s.stat(a), s.path(a)),
            (EntryKind::Dir, None, b"a".as_slice())
        );
        let mut hits = Vec::new();
        s.ids_with_byte(b'z', None, &mut hits);
        assert_eq!(paths_of(&s, hits), vec![b"z/b".to_vec()]);
        // …including upserts (which stay out of the stale order)…
        s.upsert(b"k", meta(EntryKind::File, 1)).unwrap();
        s.extend_enumerated([(b"a/x".as_slice(), EntryKind::File)]);
        assert_eq!(s.len(), 5);
        assert_eq!(s.memory_usage(), s.recompute_bytes());
        // …and the one deferred re-sort yields the exact path order.
        s.ensure_sorted();
        assert_eq!(
            paths_of(&s, s.iter_sorted()),
            vec![
                b"a".to_vec(),
                b"a/x".to_vec(),
                b"k".to_vec(),
                b"m".to_vec(),
                b"z/b".to_vec()
            ]
        );
        assert_eq!(
            paths_of(&s, s.range_with_prefix(b"a/")),
            vec![b"a/x".to_vec()]
        );
        // ensure_sorted is idempotent; bulk_load_enumerated sorts itself.
        s.ensure_sorted();
        s.bulk_load_enumerated([(b"b".as_slice(), EntryKind::File)]);
        assert_eq!(s.iter_sorted().nth(2), s.get(b"b"));

        // remove() and compact() self-heal a dirty order.
        s.extend_enumerated([(b"0".as_slice(), EntryKind::File)]);
        assert!(s.remove(b"m"));
        assert_eq!(s.len(), 6);
        s.extend_enumerated([(b"1".as_slice(), EntryKind::File)]);
        s.compact();
        assert_eq!(s.len(), 7);
        assert_eq!(paths_of(&s, s.iter_sorted()).first(), Some(&b"0".to_vec()));
    }

    #[test]
    fn live_byte_counts_track_inserts_and_removes() {
        let mut s = Store::new(1 << 20);
        assert_eq!(s.live_byte_count(b'q'), 0);
        load(&mut s, &[b"src/a.rs", b"lib/qq.rs", b"Q.txt"]);
        assert_eq!(s.live_byte_count(b'q'), 2);
        assert_eq!(s.live_byte_count(b'Q'), 1);
        assert_eq!(s.live_byte_count(b's'), 3);
        assert!(s.remove(b"lib/qq.rs"));
        assert_eq!(s.live_byte_count(b'q'), 0);
        assert_eq!(s.live_byte_count(b'Q'), 1);
        // Compaction rebuilds the arena but the live set is unchanged.
        s.compact();
        assert_eq!(s.live_byte_count(b'q'), 0);
        assert_eq!(s.live_byte_count(b'Q'), 1);
        // Re-inserting brings the counts back.
        s.upsert(b"qq", Meta::default()).unwrap();
        assert_eq!(s.live_byte_count(b'q'), 2);
    }

    #[test]
    fn ids_with_byte_sweeps_the_arena_and_skips_tombstones() {
        let mut s = Store::new(1 << 20);
        load(&mut s, &[b"src/a.rs", b"lib/qq.rs", b"Q.txt", b"zz/z.z"]);
        let mut out = Vec::new();
        // Case pair: matches both 'q' and 'Q'; multiple hits in one path
        // are deduplicated; output is in id (= insertion) order.
        s.ids_with_byte(b'q', Some(b'Q'), &mut out);
        assert_eq!(
            paths_of(&s, out.iter().copied()),
            vec![b"lib/qq.rs".to_vec(), b"Q.txt".to_vec()]
        );
        s.ids_with_byte(b'q', None, &mut out);
        assert_eq!(
            paths_of(&s, out.iter().copied()),
            vec![b"lib/qq.rs".to_vec()]
        );
        // A byte present in no path.
        s.ids_with_byte(b'%', None, &mut out);
        assert!(out.is_empty());
        // Tombstoned entries keep their bytes in the arena but are skipped.
        assert!(s.remove(b"lib/qq.rs"));
        s.ids_with_byte(b'q', Some(b'Q'), &mut out);
        assert_eq!(paths_of(&s, out.iter().copied()), vec![b"Q.txt".to_vec()]);
        // After compaction the rebuilt arena still maps hits to the right ids.
        s.compact();
        s.ids_with_byte(b'z', None, &mut out);
        assert_eq!(paths_of(&s, out.iter().copied()), vec![b"zz/z.z".to_vec()]);
        s.ids_with_byte(b'q', Some(b'Q'), &mut out);
        assert_eq!(paths_of(&s, out.iter().copied()), vec![b"Q.txt".to_vec()]);
    }
}

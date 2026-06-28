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
    /// Live ids ordered by path bytes.
    sorted: Vec<u32>,
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

    /// Number of live entries.
    #[inline]
    pub fn len(&self) -> usize {
        self.sorted.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.sorted.is_empty()
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
    #[inline]
    pub fn tombstones(&self) -> usize {
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

    #[inline]
    pub fn meta(&self, id: FileId) -> &Meta {
        &self.meta[id.index()]
    }

    /// Insert or update. On update the metadata is replaced in place; on
    /// insert the entry is rejected with [`BudgetExceeded`] if it would push
    /// retained bytes past the budget.
    pub fn upsert(&mut self, path: &[u8], meta: Meta) -> Result<FileId, BudgetExceeded> {
        self.upsert_inner(path, meta, true)
    }

    /// Insert many entries; sorts once at the end. Entries that don't fit in
    /// the budget are dropped (`truncated()` becomes true).
    pub fn bulk_load<P, I>(&mut self, entries: I)
    where
        P: AsRef<[u8]>,
        I: IntoIterator<Item = (P, Meta)>,
    {
        for (path, meta) in entries {
            let _ = self.upsert_inner(path.as_ref(), meta, false);
        }
        self.rebuild_sorted();
        self.bytes = self.recompute_bytes();
    }

    /// Remove `path`. The slot becomes a tombstone; storage is reclaimed by
    /// the next [`Store::compact`] (triggered automatically once tombstones
    /// outnumber a quarter of the live entries).
    pub fn remove(&mut self, path: &[u8]) -> bool {
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

    /// Live ids in path order.
    pub fn iter_sorted(&self) -> impl Iterator<Item = FileId> + '_ {
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
        if prefix.is_empty() {
            return 0..self.sorted.len();
        }
        let start = self.sorted_position(prefix);
        let end = start
            + self.sorted[start..].partition_point(|&id| self.path_bytes(id).starts_with(prefix));
        start..end
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

    fn upsert_inner(
        &mut self,
        path: &[u8],
        meta: Meta,
        maintain_sorted: bool,
    ) -> Result<FileId, BudgetExceeded> {
        if let Some(map_idx) = self.lookup_map_index(path) {
            let id = self.by_path.keys()[map_idx];
            self.meta[id as usize] = meta;
            self.generation += 1;
            return Ok(FileId(id));
        }

        // Arena offsets, path lengths and ids are u32.
        let new_off = self.arena.len();
        if new_off + path.len() > u32::MAX as usize || self.paths.len() >= u32::MAX as usize {
            self.truncated = true;
            return Err(BudgetExceeded);
        }

        let projected = self.projected_bytes_after_insert(path.len());
        if projected > self.budget {
            self.truncated = true;
            return Err(BudgetExceeded);
        }
        self.grow_for_insert(path.len());

        let id = self.paths.len() as u32;
        self.arena.extend_from_slice(path);
        self.paths.push(StrRef {
            off: new_off as u32,
            len: path.len() as u32,
        });
        self.meta.push(meta);
        self.flags.push(0);

        {
            let lookup = PathLookup {
                arena: &self.arena,
                paths: &self.paths,
            };
            let gop = handle_oom(self.by_path.get_or_put_adapted(path, &lookup));
            debug_assert!(!gop.found_existing);
            *gop.key_ptr = id;
        }

        if maintain_sorted {
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
        self.dead as usize * 4 > self.sorted.len()
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

    /// Retained bytes the store would account for after appending one entry
    /// with `path_len` path bytes, assuming the growth `grow_for_insert`
    /// performs. The store does all growth itself (`reserve_exact`), so this
    /// projection is exact.
    fn projected_bytes_after_insert(&self, path_len: usize) -> usize {
        let n = self.paths.len() + 1;
        let live = self.sorted.len().max(n - self.dead as usize);
        let arena_cap = grown_capacity(
            self.arena.capacity(),
            self.arena.len() + path_len,
            ARENA_FLOOR,
        );
        let paths_cap = grown_capacity(self.paths.capacity(), n, COLUMN_FLOOR);
        let meta_cap = grown_capacity(self.meta.capacity(), n, COLUMN_FLOOR);
        let flags_cap = grown_capacity(self.flags.capacity(), n, ARENA_FLOOR);
        let sorted_cap = grown_capacity(self.sorted.capacity(), live, COLUMN_FLOOR);
        Self::accounted_bytes(
            arena_cap,
            paths_cap,
            meta_cap,
            flags_cap,
            sorted_cap,
            self.by_path.count() + 1,
            self.touch.capacity(),
        )
    }

    fn grow_for_insert(&mut self, path_len: usize) {
        let n = self.paths.len() + 1;
        let live = self.sorted.len().max(n - self.dead as usize);
        let arena_target = grown_capacity(
            self.arena.capacity(),
            self.arena.len() + path_len,
            ARENA_FLOOR,
        );
        reserve_to(&mut self.arena, arena_target);
        let paths_target = grown_capacity(self.paths.capacity(), n, COLUMN_FLOOR);
        reserve_to(&mut self.paths, paths_target);
        let meta_target = grown_capacity(self.meta.capacity(), n, COLUMN_FLOOR);
        reserve_to(&mut self.meta, meta_target);
        let flags_target = grown_capacity(self.flags.capacity(), n, ARENA_FLOOR);
        reserve_to(&mut self.flags, flags_target);
        let sorted_target = grown_capacity(self.sorted.capacity(), live, COLUMN_FLOOR);
        reserve_to(&mut self.sorted, sorted_target);
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
        assert_eq!(s.meta(id).size, 42);
        assert_eq!(s.get(b"src/main.rs"), Some(id));
        assert_eq!(s.get(b"src/main.r"), None);
        assert_eq!(s.len(), 1);

        // Update in place: same id, new meta, no new entry.
        let id2 = s.upsert(b"src/main.rs", meta(EntryKind::File, 7)).unwrap();
        assert_eq!(id2, id);
        assert_eq!(s.meta(id).size, 7);
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
        assert_eq!(s.meta(id).kind, EntryKind::Dir);
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
        assert_eq!(s.meta(s.get(b"a").unwrap()).size, 5);
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

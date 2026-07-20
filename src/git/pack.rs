//! Packfile parsing and indexing — `gitformat-pack(5)`.
//!
//! Layout: `"PACK"` · u32be version (2) · u32be nobjects · objects… ·
//! sha1(everything before). Each object is a type+size header followed by one
//! zlib stream. Type is 3 bits in the first header byte; size is the remaining
//! 4 bits plus 7-bit continuation bytes (LE). `OFS_DELTA` inserts a negative
//! offset varint between header and zlib body; `REF_DELTA` inserts a 20-byte
//! base oid.
//!
//! Indexing is two passes:
//!
//! 1. **Sequential scan.** Walk the buffer once. For each entry decode the
//!    header, then `libdeflate_zlib_decompress_ex` the payload — we know the
//!    inflated size from the header, and the `_ex` variant reports how many
//!    input bytes it consumed, which is the only way to learn where the next
//!    object starts. Non-deltas are SHA-1'd immediately; deltas just record
//!    `{offset, base, inflated-delta}` for pass 2. Per-entry CRC-32 is
//!    computed here (over the on-disk bytes, header included — that's what
//!    `.idx` v2 stores).
//!
//! 2. **Parallel resolve.** Build the delta forest (children grouped under
//!    their base entry), then resolve each root's subtree on a worker thread.
//!    Within a subtree, a base is inflated/applied once and reused for every
//!    child (depth-first, so the working set is one chain, not the whole
//!    tree).
//!
//! Everything operates on a single contiguous `&[u8]` — the caller has either
//! buffered the download or mmap'd the file.

use crate::hash::{Sha1, crc32_of, object_id};
use crate::{Error, Oid, Result, delta};
use bun_collections::{HashContext, HashMap};
use bun_libdeflate_sys::libdeflate::{Decompressor, Status};
use bun_threading::{Guarded, WorkPool};

const SIGNATURE: [u8; 4] = *b"PACK";
const TRAILER: usize = 20;

/// Hash an `Oid` by reinterpreting its first 8 bytes — SHA-1 is already a
/// uniform hash, so running wyhash on top is wasted work (and the hot
/// `BlobSink` probe loop does this tens of millions of times).
pub(crate) struct OidCtx;
impl HashContext<Oid> for OidCtx {
    #[inline]
    fn ctx_hash(key: &Oid) -> u64 {
        u64::from_ne_bytes(key.0[..8].try_into().unwrap())
    }
    #[inline]
    fn ctx_eql(a: &Oid, b: &Oid) -> bool {
        a == b
    }
}

pub(crate) type OidMap<V> = HashMap<Oid, V, OidCtx>;

/// Object kind as stored in the pack header (and as the loose-object type
/// string for hashing).
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ObjKind {
    Commit,
    Tree,
    Blob,
    Tag,
}

impl ObjKind {
    pub(crate) fn name(self) -> &'static [u8] {
        match self {
            ObjKind::Commit => b"commit",
            ObjKind::Tree => b"tree",
            ObjKind::Blob => b"blob",
            ObjKind::Tag => b"tag",
        }
    }
}

#[derive(Copy, Clone, Debug)]
enum RawType {
    Base(ObjKind),
    OfsDelta,
    RefDelta,
}

impl RawType {
    fn from_bits(b: u8) -> Result<Self> {
        Ok(match b {
            1 => RawType::Base(ObjKind::Commit),
            2 => RawType::Base(ObjKind::Tree),
            3 => RawType::Base(ObjKind::Blob),
            4 => RawType::Base(ObjKind::Tag),
            6 => RawType::OfsDelta,
            7 => RawType::RefDelta,
            // 5 is reserved; 0 is invalid.
            n => return Err(Error::Pack(format!("invalid object type {n}"))),
        })
    }
}

/// What an entry's payload deltas against.
#[derive(Copy, Clone, Debug)]
enum Base {
    /// Non-delta — payload is the full object.
    None(ObjKind),
    /// Base lives at this absolute pack offset (same pack, by construction).
    Ofs(u64),
    /// Base named by oid. For a fresh clone (no `have`s) the server only ever
    /// sends bases that are themselves in the pack (a "thin" pack would
    /// reference objects we already have — we have none).
    Ref(Oid),
}

/// One pack entry. Pass 1 fills the offsets/base; pass 2 fills oid/kind/crc32
/// in parallel via interior mutability (each worker owns a disjoint subset of
/// indices, so no two threads write the same `Entry`).
struct Entry {
    /// Absolute byte offset of the entry header in the pack.
    offset: u64,
    /// Absolute offset of the **next** entry's header (= this entry's end).
    next_offset: u64,
    /// Absolute offset where the zlib body starts (after header + base ref).
    data_offset: u64,
    /// Inflated size from the header (for deltas: the delta-stream size, not
    /// the result size).
    inflated_size: u64,
    base: Base,
    // ── pass-2 outputs ────────────────────────────────────────────────────
    oid: core::cell::Cell<Oid>,
    kind: core::cell::Cell<ObjKind>,
    crc32: core::cell::Cell<u32>,
    /// Index into `entries` of every delta whose base is this entry.
    children: Vec<u32>,
}

// SAFETY: pass 2 partitions `entries` by index — each worker writes a
// disjoint set of `Cell`s (proved by the `roots`/subtree partition; see
// `resolve_subtree`). `Cell<T>` is `Send` for `T: Copy`; we only need `Sync`
// for the shared `&[Entry]` borrow, and the algorithm guarantees no aliased
// writes.
unsafe impl Sync for Entry {}

/// A parsed + indexed pack, ready for random-access reads and `.idx` emission.
pub struct PackIndex {
    /// Pack bytes (owned — the download buffer, or a `Vec` read from disk).
    pack: Vec<u8>,
    /// `entries[i]` is the i-th object in pack order.
    entries: Vec<Entry>,
    /// `by_oid[&oid] = entry index`. Built after pass 2.
    by_oid: OidMap<u32>,
    /// SHA-1 of the pack body (the trailer value) — also the pack/idx filename.
    pack_hash: Oid,
}

/// Per-thread inflate scratch. libdeflate decompressors aren't `Sync` and
/// allocating one per object would dominate small-object cost.
pub(crate) struct Inflate {
    dec: *mut Decompressor,
}

impl Inflate {
    pub(crate) fn new() -> Self {
        let dec = Decompressor::alloc();
        assert!(!dec.is_null(), "libdeflate_alloc_decompressor OOM");
        Self { dec }
    }

    /// Inflate one zlib stream whose **inflated size is exactly `size`** from
    /// `input` (which may extend past the stream). On success `out.len() ==
    /// size` and the return value is the number of input bytes the stream
    /// occupied (header + deflate body + adler32).
    pub(crate) fn inflate_into(
        &mut self,
        input: &[u8],
        size: usize,
        out: &mut Vec<u8>,
    ) -> Result<usize> {
        out.clear();
        if size == 0 {
            // libdeflate happily decodes a zero-length zlib stream, but the
            // git pack writer emits one too (2-byte header + empty stored
            // block + adler32). Let libdeflate tell us how long it was.
        }
        out.reserve(size);
        // SAFETY: `self.dec` is non-null for the lifetime of `self` (checked
        // in `new`, freed in `Drop`).
        let dec = unsafe { &mut *self.dec };
        let spare = &mut out.spare_capacity_mut()[..size];
        let r = dec.decompress_into(input, spare, bun_libdeflate_sys::libdeflate::Encoding::Zlib);
        match r.status {
            Status::Success => {}
            Status::BadData => return Err(Error::Pack("zlib stream corrupt".into())),
            Status::ShortOutput => {
                return Err(Error::Pack("zlib stream shorter than declared size".into()));
            }
            Status::InsufficientSpace => {
                return Err(Error::Pack("zlib stream longer than declared size".into()));
            }
        }
        if r.written != size {
            return Err(Error::Pack(format!(
                "inflated {} bytes, header said {size}",
                r.written
            )));
        }
        // SAFETY: libdeflate wrote exactly `r.written` bytes into spare.
        unsafe { out.set_len(size) };
        Ok(r.read)
    }
}

impl Drop for Inflate {
    fn drop(&mut self) {
        // SAFETY: alloc'd in `new`, freed exactly once here.
        unsafe { Decompressor::destroy(self.dec) };
    }
}

// `*mut Decompressor` is a unique heap handle; libdeflate has no global state.
// SAFETY: we never alias the pointer across threads — each `Inflate` is owned
// by one worker.
unsafe impl Send for Inflate {}

thread_local! {
    /// Per-worker libdeflate decompressor + scratch. `WorkPool::each` runs
    /// the closure once per item across a fixed worker set, so reusing one
    /// decompressor per OS thread avoids ~N allocs of a 32 KiB context.
    static TLS_INFLATE: core::cell::RefCell<Inflate> =
        core::cell::RefCell::new(Inflate::new());
}

/// Run `f` with this thread's [`Inflate`].
pub(crate) fn with_inflate<R>(f: impl FnOnce(&mut Inflate) -> R) -> R {
    TLS_INFLATE.with(|c| f(&mut c.borrow_mut()))
}

/// Per-phase timings (ns) from [`PackIndex::build`].
#[derive(Default, Debug)]
pub struct Timings {
    pub trailer_sha: u64,
    pub pass1_scan: u64,
    pub pass2_resolve: u64,
    pub n_deltas: u32,
}

/// Per-worker accumulator passed through `resolve_subtree`. When `want`,
/// every resolved tree's blob entries are recorded as `oid → wyhash(name)`
/// (riding the inflated bytes pass-2 already has). Dedup is local — the same
/// blob recurs thousands of times across historical trees, so a per-chunk map
/// keeps the merged result small. Path-hash bucketing is **load-bearing**:
/// the server only reuses an on-disk delta if both object and base land in
/// the same request, and same-path blobs are exactly each other's delta
/// bases. With random (oid-prefix) bucketing total blob bytes ~double.
#[derive(Default)]
pub(crate) struct BlobSink {
    pub(crate) want: bool,
    pub(crate) seen: OidMap<u32>,
}

impl BlobSink {
    #[inline]
    fn maybe(&mut self, kind: ObjKind, data: &[u8]) {
        if !self.want || kind != ObjKind::Tree {
            return;
        }
        for entry in crate::odb::TreeIter::new(data) {
            let Ok(e) = entry else { return };
            if e.mode != 0o040000 && e.mode != 0o160000 {
                let gop = self.seen.get_or_put(e.oid).expect("OOM");
                if !gop.found_existing {
                    *gop.value_ptr = bun_wyhash::hash(e.name) as u32;
                }
            }
        }
    }
    pub(crate) fn merge_into(&self, out: &mut OidMap<u32>) {
        for (oid, h) in self.seen.iter() {
            let gop = out.get_or_put(*oid).expect("OOM");
            if !gop.found_existing {
                *gop.value_ptr = *h;
            }
        }
    }
}

impl PackIndex {
    /// Parse and index `pack`, fanning pass-2 across `WorkPool`.
    pub fn build(pack: Vec<u8>, timing: &mut Timings) -> Result<Self> {
        let mut sink = BlobSink::default();
        Self::build_with(pack, timing, &mut sink, false)
    }

    /// Parse and index `pack` on the calling thread only — no `WorkPool` use.
    /// Safe to call from inside a `WorkPool` task (the parallel blob-pack
    /// indexing path).
    pub(crate) fn build_serial(pack: Vec<u8>) -> Result<Self> {
        let mut sink = BlobSink::default();
        Self::build_with(pack, &mut Timings::default(), &mut sink, true)
    }

    pub(crate) fn build_with(
        pack: Vec<u8>,
        timing: &mut Timings,
        blob_sink: &mut BlobSink,
        serial: bool,
    ) -> Result<Self> {
        if pack.len() < 12 + TRAILER {
            return Err(Error::Pack(
                "truncated (shorter than header+trailer)".into(),
            ));
        }
        if pack[..4] != SIGNATURE {
            return Err(Error::Pack("bad signature (not 'PACK')".into()));
        }
        let version = u32::from_be_bytes(pack[4..8].try_into().unwrap());
        if version != 2 {
            return Err(Error::Pack(format!("unsupported pack version {version}")));
        }
        let nobjects = u32::from_be_bytes(pack[8..12].try_into().unwrap()) as usize;

        let tmr = bun_core::time::Timer::start().unwrap();
        let mut last = 0u64;
        let mut lap = || {
            let now = tmr.read();
            let d = now - last;
            last = now;
            d
        };
        let claimed = Oid({
            let mut t = [0u8; 20];
            t.copy_from_slice(&pack[pack.len() - TRAILER..]);
            t
        });
        // Trailer SHA-1 runs on a worker concurrently with the boundary scan
        // below — both are read-only over `pack`. Skipped when `serial`
        // (caller is itself a worker; nested `go` would risk pool deadlock).
        let trailer_hash = Guarded::new(Oid::ZERO);
        let trailer_wg = bun_threading::WaitGroup::init_with_count(1);
        if serial {
            let mut h = Sha1::new();
            h.update(&pack[..pack.len() - TRAILER]);
            *trailer_hash.lock() = h.finish();
            trailer_wg.finish();
        } else {
            WorkPool::go(
                (
                    // SAFETY: `pack` and `trailer_hash` outlive the WaitGroup
                    // wait below; the worker only reads `pack` and writes the
                    // result.
                    unsafe { bun_ptr::detach_lifetime(&pack[..pack.len() - TRAILER]) },
                    bun_ptr::BackRef::from(core::ptr::NonNull::from(&trailer_hash)),
                    bun_ptr::BackRef::from(core::ptr::NonNull::from(&trailer_wg)),
                ),
                |(body, out, wg)| {
                    let mut h = Sha1::new();
                    h.update(body);
                    *out.lock() = h.finish();
                    wg.finish();
                },
            )
            .unwrap();
        }

        // ── Pass 1: sequential boundary scan ──────────────────────────────
        // Inflate-only — the irreducibly serial step (each object's start is
        // the previous object's end). SHA-1 and CRC-32 are deferred to pass 2
        // so they parallelise.
        let mut entries: Vec<Entry> = Vec::with_capacity(nobjects);
        let mut inflate = Inflate::new();
        let mut buf = Vec::new();

        let mut pos = 12usize;
        let end = pack.len() - TRAILER;
        for _ in 0..nobjects {
            let offset = pos as u64;
            let (raw, size, hdr_len) = read_entry_header(&pack[pos..end])?;
            pos += hdr_len;
            let (base, extra) = match raw {
                RawType::Base(k) => (Base::None(k), 0),
                RawType::OfsDelta => {
                    let (neg, n) = read_ofs_varint(&pack[pos..end])?;
                    let base_off = offset
                        .checked_sub(neg)
                        .filter(|&b| b >= 12)
                        .ok_or_else(|| Error::Pack("OFS_DELTA points before pack start".into()))?;
                    (Base::Ofs(base_off), n)
                }
                RawType::RefDelta => {
                    let raw = pack
                        .get(pos..pos + 20)
                        .ok_or_else(|| Error::Pack("truncated REF_DELTA oid".into()))?;
                    let mut oid = [0u8; 20];
                    oid.copy_from_slice(raw);
                    (Base::Ref(Oid(oid)), 20)
                }
            };
            pos += extra;
            let data_offset = pos as u64;
            let size = usize::try_from(size)
                .map_err(|_| Error::Pack("object size overflows usize".into()))?;
            let consumed = inflate.inflate_into(&pack[pos..end], size, &mut buf)?;
            pos += consumed;

            entries.push(Entry {
                offset,
                next_offset: pos as u64,
                data_offset,
                inflated_size: size as u64,
                base,
                oid: core::cell::Cell::new(Oid::ZERO),
                kind: core::cell::Cell::new(ObjKind::Blob),
                crc32: core::cell::Cell::new(0),
                children: Vec::new(),
            });
        }
        if pos != end {
            return Err(Error::Pack(format!(
                "pack has {} trailing bytes before trailer",
                end - pos
            )));
        }
        timing.pass1_scan = lap();

        // Join the trailer-SHA worker before pass 2 (which reuses the pool).
        trailer_wg.wait();
        let actual = *trailer_hash.lock();
        if claimed != actual {
            return Err(Error::Pack(format!(
                "pack trailer mismatch: claimed {claimed}, computed {actual}"
            )));
        }
        timing.trailer_sha = lap();

        // ── Build delta forest ────────────────────────────────────────────
        // Work units = every non-delta entry (its subtree may be empty). Each
        // worker hashes the root and resolves its descendants — that puts
        // **all** SHA-1, CRC-32, and delta application in the parallel phase.
        // OFS_DELTA parents resolve via binary search on the offset-sorted
        // entries; REF_DELTA defers to a fixed-point sweep after pass 2 (we
        // advertise `ofs-delta`, so this is empty in practice).
        let mut roots: Vec<u32> = Vec::new();
        let mut pending_ref: Vec<u32> = Vec::new();
        for i in 0..entries.len() {
            match entries[i].base {
                Base::None(_) => roots.push(i as u32),
                Base::Ofs(off) => {
                    let parent = offset_to_idx(&entries, off).ok_or_else(|| {
                        Error::Pack(format!("OFS_DELTA base @{off} is not an object boundary"))
                    })?;
                    entries[parent as usize].children.push(i as u32);
                    timing.n_deltas += 1;
                }
                Base::Ref(_) => {
                    pending_ref.push(i as u32);
                    timing.n_deltas += 1;
                }
            }
        }

        // ── Pass 2: hash + resolve ────────────────────────────────────────
        if serial {
            // Caller is itself a `WorkPool` worker — nested `each()` could
            // starve the pool. Resolve on this thread; the outer `each` over
            // packs supplies the parallelism.
            with_inflate(|inf| {
                for &root in &roots {
                    resolve_subtree(&pack, &entries, root, inf, blob_sink)?;
                }
                Ok::<_, Error>(())
            })?;
            timing.pass2_resolve = lap();
            let mut oid_to_idx: OidMap<u32> = HashMap::with_capacity(nobjects);
            for (i, e) in entries.iter().enumerate() {
                oid_to_idx.insert(e.oid.get(), i as u32);
            }
            if !pending_ref.is_empty() {
                return Err(Error::Pack("REF_DELTA in blob pack (serial path)".into()));
            }
            return Ok(PackIndex {
                pack,
                entries,
                by_oid: oid_to_idx,
                pack_hash: actual,
            });
        }
        // Chunk roots into ~ncpu×8 ranges so `each` schedules O(hundreds) of
        // tasks, not O(hundreds-of-thousands).
        struct ResolveCtx<'a> {
            pack: &'a [u8],
            entries: &'a [Entry],
            roots: &'a [u32],
            want_blobs: bool,
            sinks: Guarded<Vec<BlobSink>>,
            err: Guarded<Option<Error>>,
        }
        let ctx = ResolveCtx {
            pack: &pack,
            entries: &entries,
            roots: &roots,
            want_blobs: blob_sink.want,
            sinks: Guarded::new(Vec::new()),
            err: Guarded::new(None),
        };
        let ncpu = WorkPool::get().max_threads.max(1) as usize;
        let chunk = (roots.len() / (ncpu * 8)).max(1);
        let mut ranges: Vec<(u32, u32)> = (0..roots.len())
            .step_by(chunk)
            .map(|s| (s as u32, (s + chunk).min(roots.len()) as u32))
            .collect();
        WorkPool::get().each(
            &ctx,
            |ctx, (lo, hi): (u32, u32), _i| {
                let mut sink = BlobSink {
                    want: ctx.want_blobs,
                    // Reserve once: avoids ~log₂ rehashes/chunk (the previous
                    // 2 s overhead was almost entirely rehash copies).
                    seen: if ctx.want_blobs {
                        OidMap::with_capacity(65536)
                    } else {
                        OidMap::default()
                    },
                };
                with_inflate(|inf| {
                    for &root in &ctx.roots[lo as usize..hi as usize] {
                        if let Err(e) = resolve_subtree(ctx.pack, ctx.entries, root, inf, &mut sink)
                        {
                            *ctx.err.lock() = Some(e);
                            return;
                        }
                    }
                });
                if sink.want {
                    ctx.sinks.lock().push(sink);
                }
            },
            &mut ranges,
        );
        let ResolveCtx {
            mut err, mut sinks, ..
        } = ctx;
        if blob_sink.want {
            blob_sink.seen.ensure_total_capacity(nobjects).expect("OOM");
            for s in core::mem::take(sinks.get_mut()) {
                s.merge_into(&mut blob_sink.seen);
            }
        }
        if let Some(e) = err.get_mut().take() {
            return Err(e);
        }
        timing.pass2_resolve = lap();

        // ── oid → index map ───────────────────────────────────────────────
        let mut oid_to_idx: OidMap<u32> = HashMap::with_capacity(nobjects);
        for (i, e) in entries.iter().enumerate() {
            if !matches!(e.base, Base::Ref(_)) {
                oid_to_idx.insert(e.oid.get(), i as u32);
            }
        }

        // ── REF_DELTAs whose base was itself a delta ─────────────────────
        // Iterate to a fixed point. In practice `pending_ref` is empty (we
        // advertise `ofs-delta`); this is the correctness fallback.
        while !pending_ref.is_empty() {
            let mut still: Vec<u32> = Vec::new();
            let before = pending_ref.len();
            for i in pending_ref {
                let Base::Ref(base_oid) = entries[i as usize].base else {
                    unreachable!()
                };
                let Some(&parent) = oid_to_idx.get(&base_oid) else {
                    still.push(i);
                    continue;
                };
                // Resolve this single delta now (its base's oid is known).
                // The parent's *data* may still need a chain walk; if that
                // walk hits another unresolved Ref, defer to the next outer
                // iteration.
                let mut base_data = Vec::new();
                if walk_ofs_chain(&pack, &entries, parent, &mut inflate, &mut base_data).is_err() {
                    still.push(i);
                    continue;
                }
                let mut delta_buf = Vec::new();
                let e = &entries[i as usize];
                inflate.inflate_into(
                    &pack[e.data_offset as usize..pack.len() - TRAILER],
                    e.inflated_size as usize,
                    &mut delta_buf,
                )?;
                let mut out = Vec::new();
                delta::apply(&base_data, &delta_buf, &mut out)?;
                let kind = entries[parent as usize].kind.get();
                let oid = object_id(kind, &out);
                entries[i as usize].oid.set(oid);
                entries[i as usize].kind.set(kind);
                entries[i as usize].crc32.set(crc32_of(
                    0,
                    &pack[entries[i as usize].offset as usize
                        ..entries[i as usize].next_offset as usize],
                ));
                oid_to_idx.insert(oid, i);
            }
            if still.len() == before {
                return Err(Error::Pack(format!(
                    "{} REF_DELTA object(s) reference oids not in pack (thin pack not supported for initial clone)",
                    still.len()
                )));
            }
            pending_ref = still;
        }

        Ok(PackIndex {
            pack,
            entries,
            by_oid: oid_to_idx,
            pack_hash: actual,
        })
    }

    pub fn pack_hash(&self) -> Oid {
        self.pack_hash
    }

    /// Number of objects in the pack.
    #[allow(clippy::len_without_is_empty)] // a 0-object pack is a protocol error we reject earlier
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn contains(&self, oid: &Oid) -> bool {
        self.by_oid.get(oid).is_some()
    }

    pub(crate) fn pack_bytes(&self) -> &[u8] {
        &self.pack
    }

    /// Look up an object by id and inflate it. Delta chains are walked to the
    /// root. `inflate` is caller-owned so a hot loop (checkout) reuses it.
    pub(crate) fn read(
        &self,
        oid: &Oid,
        inflate: &mut Inflate,
        out: &mut Vec<u8>,
    ) -> Result<ObjKind> {
        let &idx = self
            .by_oid
            .get(oid)
            .ok_or_else(|| Error::Pack(format!("object {oid} not in pack")))?;
        self.read_idx(idx, inflate, out)
    }

    fn read_idx(&self, idx: u32, inflate: &mut Inflate, out: &mut Vec<u8>) -> Result<ObjKind> {
        let end = self.pack.len() - TRAILER;
        // Collect chain idx → … → root, resolving Ofs by binary search and
        // Ref via `by_oid` (both are populated post-build).
        let mut chain = vec![idx];
        loop {
            let e = &self.entries[*chain.last().unwrap() as usize];
            let parent = match e.base {
                Base::None(_) => break,
                Base::Ofs(off) => offset_to_idx(&self.entries, off)
                    .ok_or_else(|| Error::Pack("delta base offset not found".into()))?,
                Base::Ref(oid) => *self
                    .by_oid
                    .get(&oid)
                    .ok_or_else(|| Error::Pack(format!("REF_DELTA base {oid} not in pack")))?,
            };
            if chain.contains(&parent) {
                return Err(Error::Pack("delta cycle".into()));
            }
            chain.push(parent);
        }
        let root = chain.pop().unwrap();
        let re = &self.entries[root as usize];
        let kind = re.kind.get();
        inflate.inflate_into(
            &self.pack[re.data_offset as usize..end],
            re.inflated_size as usize,
            out,
        )?;
        let mut delta_buf = Vec::new();
        let mut tmp = Vec::new();
        while let Some(i) = chain.pop() {
            let e = &self.entries[i as usize];
            inflate.inflate_into(
                &self.pack[e.data_offset as usize..end],
                e.inflated_size as usize,
                &mut delta_buf,
            )?;
            delta::apply(out, &delta_buf, &mut tmp)?;
            core::mem::swap(out, &mut tmp);
        }
        Ok(kind)
    }

    /// Emit a v2 `.idx` (`gitformat-pack(5)` §pack-*.idx) into `w`.
    pub fn write_idx(&self, w: &mut Vec<u8>) {
        // Sorted permutation of entry indices by oid.
        let mut order: Vec<u32> = (0..self.entries.len() as u32).collect();
        order.sort_unstable_by_key(|&i| self.entries[i as usize].oid.get());

        let mut sha = Sha1::new();
        let mut put = |buf: &[u8]| {
            sha.update(buf);
            w.extend_from_slice(buf);
        };

        // Header: magic + version 2.
        put(&[0xff, 0x74, 0x4f, 0x63]);
        put(&2u32.to_be_bytes());

        // 256-entry first-level fanout: fanout[i] = #oids with first byte ≤ i.
        let mut fanout = [0u32; 256];
        for &i in &order {
            fanout[self.entries[i as usize].oid.get().0[0] as usize] += 1;
        }
        let mut acc = 0u32;
        for f in &mut fanout {
            acc += *f;
            *f = acc;
        }
        for f in fanout {
            put(&f.to_be_bytes());
        }

        // Name table.
        for &i in &order {
            put(&self.entries[i as usize].oid.get().0);
        }
        // CRC32 table.
        for &i in &order {
            put(&self.entries[i as usize].crc32.get().to_be_bytes());
        }
        // 4-byte offset table; offsets ≥ 2^31 get bit 31 set and index into
        // the 8-byte table.
        let mut large: Vec<u64> = Vec::new();
        for &i in &order {
            let off = self.entries[i as usize].offset;
            if off < (1u64 << 31) {
                put(&(off as u32).to_be_bytes());
            } else {
                let idx = large.len() as u32 | 0x8000_0000;
                large.push(off);
                put(&idx.to_be_bytes());
            }
        }
        for off in large {
            put(&off.to_be_bytes());
        }
        // Pack checksum, then idx checksum.
        put(&self.pack_hash.0);
        let idx_hash = sha.finish();
        w.extend_from_slice(&idx_hash.0);
    }
}

/// Decode the type+size header. Returns `(type, inflated_size, header_bytes)`.
fn read_entry_header(buf: &[u8]) -> Result<(RawType, u64, usize)> {
    let b0 = *buf.first().ok_or_else(trunc)?;
    let raw = RawType::from_bits((b0 >> 4) & 0x7)?;
    let mut size = u64::from(b0 & 0x0f);
    let mut shift = 4u32;
    let mut i = 1usize;
    let mut cont = b0 & 0x80 != 0;
    while cont {
        let b = *buf.get(i).ok_or_else(trunc)?;
        i += 1;
        if shift >= 64 {
            return Err(Error::Pack("object size varint too long".into()));
        }
        size |= u64::from(b & 0x7f) << shift;
        shift += 7;
        cont = b & 0x80 != 0;
    }
    Ok((raw, size, i))
}

/// OFS_DELTA negative-offset varint: big-endian 7-bit groups, MSB = continue,
/// with a `+1` per continuation (so no redundant encodings). Returns
/// `(offset, bytes_consumed)`.
fn read_ofs_varint(buf: &[u8]) -> Result<(u64, usize)> {
    let b0 = *buf.first().ok_or_else(trunc)?;
    let mut val = u64::from(b0 & 0x7f);
    let mut i = 1usize;
    let mut b = b0;
    while b & 0x80 != 0 {
        b = *buf.get(i).ok_or_else(trunc)?;
        i += 1;
        val = val
            .checked_add(1)
            .and_then(|v| v.checked_shl(7))
            .ok_or_else(|| Error::Pack("OFS_DELTA varint overflow".into()))?
            | u64::from(b & 0x7f);
    }
    Ok((val, i))
}

#[cold]
fn trunc() -> Error {
    Error::Pack("truncated object header".into())
}

/// Hash `root` (a non-delta) and DFS-resolve every delta under it, writing
/// `oid`/`kind`/`crc32` into each entry's `Cell`s. Runs on a worker thread;
/// the index partition guarantees no other worker touches the same entries.
fn resolve_subtree(
    pack: &[u8],
    entries: &[Entry],
    root: u32,
    inflate: &mut Inflate,
    sink: &mut BlobSink,
) -> Result<()> {
    let end = pack.len() - TRAILER;
    let root_e = &entries[root as usize];
    let Base::None(kind) = root_e.base else {
        unreachable!("resolve_subtree called on a delta root")
    };
    root_e.crc32.set(crc32_of(
        0,
        &pack[root_e.offset as usize..root_e.next_offset as usize],
    ));
    let mut base = Vec::new();
    inflate.inflate_into(
        &pack[root_e.data_offset as usize..end],
        root_e.inflated_size as usize,
        &mut base,
    )?;
    root_e.oid.set(object_id(kind, &base));
    root_e.kind.set(kind);
    sink.maybe(kind, &base);
    if root_e.children.is_empty() {
        return Ok(());
    }
    // (parent_data, children_iter) — one inflated buffer per stack level so
    // siblings reuse their parent's data without re-inflating.
    let mut stack: Vec<(Vec<u8>, core::slice::Iter<'_, u32>)> =
        vec![(base, root_e.children.iter())];
    let mut delta_buf = Vec::new();

    while let Some((parent_data, iter)) = stack.last_mut() {
        let Some(&child_idx) = iter.next() else {
            stack.pop();
            continue;
        };
        let child = &entries[child_idx as usize];
        child.crc32.set(crc32_of(
            0,
            &pack[child.offset as usize..child.next_offset as usize],
        ));
        inflate.inflate_into(
            &pack[child.data_offset as usize..end],
            child.inflated_size as usize,
            &mut delta_buf,
        )?;
        let mut data = Vec::new();
        delta::apply(parent_data, &delta_buf, &mut data)?;
        child.oid.set(object_id(kind, &data));
        child.kind.set(kind);
        sink.maybe(kind, &data);
        if !child.children.is_empty() {
            stack.push((data, child.children.iter()));
        }
    }
    Ok(())
}

/// Build-time helper: inflate entry `idx` by walking only `Ofs`/`None` links
/// (used when resolving a late REF_DELTA whose parent is already known). A
/// `Ref` link here means the parent is itself an unresolved REF_DELTA — caller
/// defers to the next fixed-point iteration.
fn walk_ofs_chain(
    pack: &[u8],
    entries: &[Entry],
    idx: u32,
    inflate: &mut Inflate,
    out: &mut Vec<u8>,
) -> Result<()> {
    let end = pack.len() - TRAILER;
    let mut chain = vec![idx];
    loop {
        let e = &entries[*chain.last().unwrap() as usize];
        match e.base {
            Base::None(_) => break,
            Base::Ofs(off) => {
                let parent = offset_to_idx(entries, off)
                    .ok_or_else(|| Error::Pack("delta base offset not found".into()))?;
                if chain.contains(&parent) {
                    return Err(Error::Pack("delta cycle".into()));
                }
                chain.push(parent);
            }
            Base::Ref(_) => {
                return Err(Error::Pack(
                    "REF_DELTA parent not yet resolved (deferred)".into(),
                ));
            }
        }
    }
    let root = chain.pop().unwrap();
    let re = &entries[root as usize];
    inflate.inflate_into(
        &pack[re.data_offset as usize..end],
        re.inflated_size as usize,
        out,
    )?;
    let mut delta_buf = Vec::new();
    let mut tmp = Vec::new();
    while let Some(i) = chain.pop() {
        let e = &entries[i as usize];
        inflate.inflate_into(
            &pack[e.data_offset as usize..end],
            e.inflated_size as usize,
            &mut delta_buf,
        )?;
        delta::apply(out, &delta_buf, &mut tmp)?;
        core::mem::swap(out, &mut tmp);
    }
    Ok(())
}

/// Entries are in pack order, i.e. sorted by `offset`. Binary search.
fn offset_to_idx(entries: &[Entry], off: u64) -> Option<u32> {
    entries
        .binary_search_by_key(&off, |e| e.offset)
        .ok()
        .map(|i| i as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_header_roundtrip() {
        // type=blob(3), size=300: b0 = 1_011_1100 (cont,type=3,low4=0xc=12),
        // b1 = 0_0010010 (18); 12 + 18<<4 = 12+288 = 300.
        let buf = [0b1011_1100u8, 0b0001_0010, 0xff];
        let (t, s, n) = read_entry_header(&buf).unwrap();
        assert!(matches!(t, RawType::Base(ObjKind::Blob)));
        assert_eq!(s, 300);
        assert_eq!(n, 2);
    }

    #[test]
    fn ofs_varint() {
        // Single byte: value = low7.
        assert_eq!(read_ofs_varint(&[0x42]).unwrap(), (0x42, 1));
        // Two bytes: ((b0&7f)+1)<<7 | (b1&7f).
        // [0x80, 0x01] → (0+1)<<7 | 1 = 129.
        assert_eq!(read_ofs_varint(&[0x80, 0x01]).unwrap(), (129, 2));
        // [0x81, 0x48] → (1+1)<<7 | 0x48 = 328.
        assert_eq!(read_ofs_varint(&[0x81, 0x48]).unwrap(), (328, 2));
    }
}

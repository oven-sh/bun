//! Sampling heap profiler on mimalloc's `mi_profiler_t` hooks: the hooks and the buckets they
//! fill. They run inside `malloc`/`free` of any thread and allocate only from [`Meta`].

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::UnsafeCell;
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

use bun_alloc::mimalloc::{self, mi_profiler_sample_data_t, mi_profiler_t};
use bun_threading::Mutex;

use crate::encode;

/// What Go (`runtime.MemProfileRate`), tcmalloc and V8 (`--heap-prof-interval`) use.
pub const DEFAULT_SAMPLE_INTERVAL: usize = 512 * 1024;

/// The smallest mean interval (single intervals are drawn around it and can be shorter). mimalloc
/// counts small allocations when their page is refilled, up to 64 KiB of blocks at a time: a
/// mean below that samples them no finer and costs more.
pub const MIN_SAMPLE_INTERVAL: usize = 64 * 1024;

/// Frames read from the frame-pointer chain of one sample.
const MAX_CHAIN: usize = 128;
const MAX_JS_FRAMES: usize = 64;
const MAX_STACK_WORDS: usize = MAX_CHAIN + MAX_JS_FRAMES;

/// A stack word is a native return address or `JS_TAG | index into Session::js_locations`.
pub(crate) const JS_TAG: usize = 1 << (usize::BITS - 1);

static META_HEAP: AtomicPtr<mimalloc::Heap> = AtomicPtr::new(core::ptr::null_mut());

/// Allocator on a process-lifetime mimalloc heap with sampling off (`mi_heap_profile_disable`).
/// Any thread allocates from it: a mimalloc v3 `mi_heap_t` gives each thread its own `mi_theap_t`.
#[derive(Clone, Copy)]
pub(crate) struct Meta;

fn ensure_meta_heap() -> bool {
    if !META_HEAP.load(Ordering::Acquire).is_null() {
        return true;
    }
    // SAFETY: no preconditions.
    let heap = unsafe { mimalloc::mi_heap_new() };
    if heap.is_null() {
        return false;
    }
    // SAFETY: `heap` is live.
    unsafe { mimalloc::mi_heap_profile_disable(heap) };
    if META_HEAP
        .compare_exchange(
            core::ptr::null_mut(),
            heap,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_err()
    {
        // SAFETY: nothing was allocated from `heap`.
        unsafe { mimalloc::mi_heap_destroy(heap) };
    }
    true
}

// SAFETY: blocks come from a heap that is never destroyed; every `Meta` is the same allocator.
unsafe impl Allocator for Meta {
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        let heap = META_HEAP.load(Ordering::Acquire);
        if heap.is_null() {
            return Err(AllocError);
        }
        // SAFETY: `heap` is live for the process.
        let p = unsafe { mimalloc::mi_heap_malloc_auto_align(heap, layout.size(), layout.align()) };
        NonNull::new(p.cast::<u8>())
            .map(|p| NonNull::slice_from_raw_parts(p, layout.size()))
            .ok_or(AllocError)
    }

    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        let _ = layout;
        // SAFETY: `ptr` came from `allocate` above.
        unsafe { mimalloc::mi_free(ptr.as_ptr().cast()) };
    }
}

type MetaVec<T> = Vec<T, Meta>;

/// `push` that reports allocation failure: a hook must not panic inside `malloc`.
fn try_push<T>(vec: &mut MetaVec<T>, value: T) -> bool {
    if vec.len() == vec.capacity() && vec.try_reserve(1).is_err() {
        return false;
    }
    vec.push(value);
    true
}

fn try_extend<T: Copy>(vec: &mut MetaVec<T>, values: &[T]) -> bool {
    if vec.try_reserve(values.len()).is_err() {
        return false;
    }
    vec.extend_from_slice(values);
    true
}

const EMPTY_SLOT: u32 = u32::MAX;

/// Open-addressed `hash -> index into a Vec` whose entries keep their own hash.
struct Index {
    slots: MetaVec<u32>,
    len: usize,
}

impl Index {
    fn new() -> Self {
        Self {
            slots: Vec::new_in(Meta),
            len: 0,
        }
    }

    /// `Ok(index)` of the match, `Err(slot)` to insert at, `Err(usize::MAX)` when out of memory.
    fn find(
        &mut self,
        hash: u64,
        hash_of: impl Fn(u32) -> u64,
        is_match: impl Fn(u32) -> bool,
    ) -> Result<u32, usize> {
        if (self.len + 1) * 2 > self.slots.len() && !self.grow(hash_of) {
            return Err(usize::MAX);
        }
        let mask = self.slots.len() - 1;
        let mut slot = (hash as usize) & mask;
        loop {
            let index = self.slots[slot];
            if index == EMPTY_SLOT {
                return Err(slot);
            }
            if is_match(index) {
                return Ok(index);
            }
            slot = (slot + 1) & mask;
        }
    }

    fn insert(&mut self, slot: usize, index: u32) {
        self.slots[slot] = index;
        self.len += 1;
    }

    fn grow(&mut self, hash_of: impl Fn(u32) -> u64) -> bool {
        let new_len = (self.slots.len() * 2).max(256);
        let mut slots: MetaVec<u32> = Vec::new_in(Meta);
        if slots.try_reserve_exact(new_len).is_err() {
            return false;
        }
        slots.resize(new_len, EMPTY_SLOT);
        let mask = new_len - 1;
        for &index in self.slots.iter().filter(|&&i| i != EMPTY_SLOT) {
            let mut slot = (hash_of(index) as usize) & mask;
            while slots[slot] != EMPTY_SLOT {
                slot = (slot + 1) & mask;
            }
            slots[slot] = index;
        }
        self.slots = slots;
        true
    }
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    bun_wyhash::hash(bytes)
}

const HASH_SEED: u64 = 0xcbf2_9ce4_8422_2325;

/// FNV-1a over words.
fn mix(hash: u64, word: u64) -> u64 {
    (hash ^ word).wrapping_mul(0x0000_0100_0000_01b3)
}

#[derive(Clone, Copy)]
pub(crate) struct Span {
    pub(crate) start: u32,
    pub(crate) len: u32,
    hash: u64,
}

/// UTF-8 strings, deduplicated. Index 0 is "".
pub(crate) struct Strings {
    pub(crate) bytes: MetaVec<u8>,
    pub(crate) spans: MetaVec<Span>,
    index: Index,
}

impl Strings {
    fn new() -> Self {
        Self {
            bytes: Vec::new_in(Meta),
            spans: Vec::new_in(Meta),
            index: Index::new(),
        }
    }

    fn get(&self, id: u32) -> &[u8] {
        match self.spans.get(id as usize) {
            Some(span) => &self.bytes[span.start as usize..][..span.len as usize],
            None => b"",
        }
    }

    /// 0 (the empty string) when there is no memory for it.
    fn intern(&mut self, value: &[u8]) -> u32 {
        if self.spans.is_empty() {
            let empty = Span {
                start: 0,
                len: 0,
                hash: hash_bytes(b""),
            };
            match self.index.find(empty.hash, |_| empty.hash, |_| false) {
                Err(slot) if slot != usize::MAX && try_push(&mut self.spans, empty) => {
                    self.index.insert(slot, 0);
                }
                _ => return 0,
            }
        }
        if value.is_empty() {
            return 0;
        }
        let hash = hash_bytes(value);
        let (spans, bytes) = (&self.spans, &self.bytes);
        let found = self.index.find(
            hash,
            |i| spans[i as usize].hash,
            |i| {
                let span = spans[i as usize];
                span.hash == hash && &bytes[span.start as usize..][..span.len as usize] == value
            },
        );
        match found {
            Ok(id) => id,
            Err(usize::MAX) => 0,
            Err(slot) => {
                let (Ok(start), Ok(len)) =
                    (u32::try_from(self.bytes.len()), u32::try_from(value.len()))
                else {
                    return 0;
                };
                let id = self.spans.len() as u32;
                if !try_extend(&mut self.bytes, value) {
                    return 0;
                }
                if !try_push(&mut self.spans, Span { start, len, hash }) {
                    self.bytes.truncate(start as usize);
                    return 0;
                }
                self.index.insert(slot, id);
                id
            }
        }
    }
}

const _: () = assert!(
    core::mem::align_of::<SampleData>() <= core::mem::align_of::<*mut c_void>()
        && core::mem::size_of::<SampleData>() <= mimalloc::MI_PROFILE_SAMPLE_DATA_MAX_SIZE
);

/// What [`on_alloc`] leaves in the sampled block for [`on_free`].
#[repr(C)]
#[derive(Clone, Copy)]
struct SampleData {
    /// 0: not recorded (no session, no memory, re-entered).
    generation: u32,
    bucket: u32,
    bytes: u64,
    objects: u64,
}

#[derive(Clone, Copy)]
pub(crate) struct Bucket {
    hash: u64,
    pub(crate) stack_start: u32,
    pub(crate) depth: u32,
    /// String id of the thread's name.
    pub(crate) thread: u32,
    /// `worker_threads.threadId` of the Worker whose JavaScript thread this is, else 0.
    pub(crate) worker: u32,
    pub(crate) alloc_objects: u64,
    pub(crate) alloc_bytes: u64,
    pub(crate) free_objects: u64,
    pub(crate) free_bytes: u64,
}

#[derive(Clone, Copy)]
pub(crate) struct JsLocation {
    hash: u64,
    pub(crate) name: u32,
    // As sampled, in the code that ran: what a frame is looked up by.
    url: u32,
    line: u32,
    column: u32,
    function_line: u32,
    function_column: u32,
    /// The `JSC::VM*` it was sampled on: only that VM has the sourcemaps to resolve it.
    vm: usize,
    /// In the source, once the VM's sourcemaps were asked.
    source: Option<SourcePosition>,
}

#[derive(Clone, Copy)]
pub(crate) struct SourcePosition {
    pub(crate) url: u32,
    pub(crate) line: u32,
    pub(crate) column: u32,
    pub(crate) function_line: u32,
}

impl JsLocation {
    pub(crate) fn is_resolved(&self) -> bool {
        self.source.is_some()
    }

    /// Where to report the frame: in the source if known, else in the code that ran.
    pub(crate) fn position(&self) -> SourcePosition {
        self.source.unwrap_or(SourcePosition {
            url: self.url,
            line: self.line,
            column: self.column,
            function_line: self.function_line,
        })
    }
}

pub(crate) struct Session {
    generation: u32,
    pub(crate) sample_interval: usize,
    pub(crate) started_at_ns: i64,
    rng: u64,
    pub(crate) stacks: MetaVec<usize>,
    pub(crate) buckets: MetaVec<Bucket>,
    bucket_index: Index,
    pub(crate) strings: Strings,
    pub(crate) js_locations: MetaVec<JsLocation>,
    js_index: Index,
    pub(crate) samples: u64,
    pub(crate) dropped: u64,
}

impl Session {
    fn new(generation: u32, sample_interval: usize) -> Self {
        let started_at_ns = now_ns();
        Self {
            generation,
            sample_interval,
            started_at_ns,
            rng: (started_at_ns as u64) | 1,
            stacks: Vec::new_in(Meta),
            buckets: Vec::new_in(Meta),
            bucket_index: Index::new(),
            strings: Strings::new(),
            js_locations: Vec::new_in(Meta),
            js_index: Index::new(),
            samples: 0,
            dropped: 0,
        }
    }

    fn bucket_for(&mut self, stack: &[usize], thread: u32, worker: u32) -> Option<u32> {
        let labels = u64::from(thread) << 32 | u64::from(worker);
        let hash = stack
            .iter()
            .fold(mix(HASH_SEED, labels), |hash, &word| mix(hash, word as u64));
        let (buckets, stacks) = (&self.buckets, &self.stacks);
        let found = self.bucket_index.find(
            hash,
            |i| buckets[i as usize].hash,
            |i| {
                let b = &buckets[i as usize];
                b.hash == hash
                    && b.thread == thread
                    && b.worker == worker
                    && b.depth as usize == stack.len()
                    && &stacks[b.stack_start as usize..][..stack.len()] == stack
            },
        );
        match found {
            Ok(index) => Some(index),
            Err(usize::MAX) => None,
            Err(slot) => {
                let index = u32::try_from(self.buckets.len()).ok()?;
                let stack_start = u32::try_from(self.stacks.len()).ok()?;
                if !try_extend(&mut self.stacks, stack) {
                    return None;
                }
                let bucket = Bucket {
                    hash,
                    stack_start,
                    depth: stack.len() as u32,
                    thread,
                    worker,
                    alloc_objects: 0,
                    alloc_bytes: 0,
                    free_objects: 0,
                    free_bytes: 0,
                };
                if !try_push(&mut self.buckets, bucket) {
                    self.stacks.truncate(stack_start as usize);
                    return None;
                }
                self.bucket_index.insert(slot, index);
                Some(index)
            }
        }
    }

    fn js_location_for(&mut self, frame: &RawJsFrame, vm: usize) -> Option<usize> {
        let mut scratch = [0u8; 4096];
        // SAFETY: the strings belong to cells that frames of this thread's stack keep alive.
        let name = self.strings.intern(unsafe { frame.name(&mut scratch) });
        // SAFETY: as above.
        let url = self.strings.intern(unsafe { frame.url(&mut scratch) });
        let hash = [
            u64::from(name) << 32 | u64::from(url),
            u64::from(frame.line) << 32 | u64::from(frame.column),
            vm as u64,
        ]
        .into_iter()
        .fold(HASH_SEED, mix);
        let locations = &self.js_locations;
        let found = self.js_index.find(
            hash,
            |i| locations[i as usize].hash,
            |i| {
                let l = &locations[i as usize];
                l.hash == hash
                    && l.name == name
                    && l.url == url
                    && l.line == frame.line
                    && l.column == frame.column
                    && l.vm == vm
            },
        );
        match found {
            Ok(index) => Some(index as usize),
            Err(usize::MAX) => None,
            Err(slot) => {
                let index = u32::try_from(self.js_locations.len()).ok()?;
                let location = JsLocation {
                    hash,
                    name,
                    url,
                    line: frame.line,
                    column: frame.column,
                    function_line: frame.function_line,
                    function_column: frame.function_column,
                    vm,
                    source: None,
                };
                if !try_push(&mut self.js_locations, location) {
                    return None;
                }
                self.js_index.insert(slot, index);
                Some(index as usize)
            }
        }
    }

    /// Exponentially distributed, so a periodic pattern is not always sampled at the same point.
    fn next_interval(&mut self) -> usize {
        // xorshift64*
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        let bits = self.rng.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11;
        // (0, 1]
        let uniform = (bits as f64 + 1.0) / (1u64 << 53) as f64;
        let interval = -uniform.ln() * self.sample_interval as f64;
        // What is allocated after a thread's last sample is in no sample: at most this much.
        (interval as usize).clamp(1, self.sample_interval.saturating_mul(16))
    }
}

/// Mirrors `Bun::PprofJSFrame` (BunPprofJSFrames.cpp). The strings are borrowed for the hook.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct RawJsFrame {
    name: *const c_void,
    url: *const c_void,
    name_len: u32,
    url_len: u32,
    line: u32,
    column: u32,
    function_line: u32,
    function_column: u32,
    /// The entry of the frame-pointer chain whose pc this frame replaces.
    chain_index: u32,
    name_is_16bit: u8,
    url_is_16bit: u8,
}

const _: () = assert!(
    core::mem::size_of::<RawJsFrame>() == 48
        && core::mem::offset_of!(RawJsFrame, chain_index) == 40
);

impl RawJsFrame {
    pub const EMPTY: Self = Self {
        name: core::ptr::null(),
        url: core::ptr::null(),
        name_len: 0,
        url_len: 0,
        line: 0,
        column: 0,
        function_line: 0,
        function_column: 0,
        chain_index: 0,
        name_is_16bit: 0,
        url_is_16bit: 0,
    };

    /// # Safety
    /// The frame's pointers are still valid.
    unsafe fn name<'a>(&'a self, scratch: &'a mut [u8]) -> &'a [u8] {
        // SAFETY: fn contract.
        unsafe { utf8_of(self.name, self.name_len, self.name_is_16bit != 0, scratch) }
    }

    /// # Safety
    /// The frame's pointers are still valid.
    unsafe fn url<'a>(&'a self, scratch: &'a mut [u8]) -> &'a [u8] {
        // SAFETY: fn contract.
        unsafe { utf8_of(self.url, self.url_len, self.url_is_16bit != 0, scratch) }
    }
}

/// # Safety
/// `characters` points to `len` Latin-1 bytes, or UTF-16 code units if `is_16bit`.
unsafe fn utf8_of<'a>(
    characters: *const c_void,
    len: u32,
    is_16bit: bool,
    scratch: &'a mut [u8],
) -> &'a [u8] {
    if characters.is_null() || len == 0 {
        return b"";
    }
    if is_16bit {
        // SAFETY: fn contract.
        let units = unsafe { core::slice::from_raw_parts(characters.cast::<u16>(), len as usize) };
        let units = &units[..units.len().min(scratch.len() / 3)];
        let written = bun_core::strings::copy_utf16_into_utf8(scratch, units).written;
        return &scratch[..written as usize];
    }
    // SAFETY: fn contract.
    let latin1 = unsafe { core::slice::from_raw_parts(characters.cast::<u8>(), len as usize) };
    if bun_core::strings::is_all_ascii(latin1) {
        return latin1;
    }
    let latin1 = &latin1[..latin1.len().min(scratch.len() / 2)];
    let written = bun_core::strings::copy_latin1_into_utf8(scratch, latin1).written;
    &scratch[..written as usize]
}

#[derive(Clone, Copy, Default)]
pub struct JsThread {
    /// JavaScript frames written to `out`, innermost first.
    pub frames: usize,
    /// Identity of the thread's VM (`JSC::VM*`), 0 when the thread has none.
    pub vm: usize,
    /// `worker_threads.threadId` when the VM is a Worker's, else 0.
    pub worker: u32,
}

/// Runs inside `malloc`: no allocation, no locks. The slices are innermost frame first.
pub type CaptureJsFrames =
    fn(frame_pointers: &[usize], return_addresses: &[usize], out: &mut [RawJsFrame]) -> JsThread;

static CAPTURE_JS_FRAMES: OnceLock<CaptureJsFrames> = OnceLock::new();

pub fn set_js_frame_source(capture: CaptureJsFrames) {
    let _ = CAPTURE_JS_FRAMES.set(capture);
}

/// `line` and `column` are 1-based.
pub struct ResolvedPosition {
    pub url: Vec<u8>,
    pub line: u32,
    pub column: u32,
}

struct Unresolved {
    index: u32,
    positions: [(u32, u32); 2],
    resolved: [Option<ResolvedPosition>; 2],
}

/// Passes what was sampled on `vm` through `resolve(url, line, column)`, the VM's sourcemaps.
/// `line` and `column` are one-based; a frame without a position (either is 0) is not passed.
/// Call it on the VM's thread.
pub fn resolve_js_locations(
    vm: usize,
    resolve: &mut dyn FnMut(&[u8], u32, u32) -> Option<ResolvedPosition>,
) {
    if vm == 0 || !is_running() {
        return;
    }
    let is_pending = |l: &JsLocation| l.vm == vm && !l.is_resolved();
    // Nothing is allocated from the default heap under the lock: sizes first.
    let (generation, pending, url_bytes) = {
        let Some(mut guard) = SHARED.lock() else {
            return;
        };
        let Some(session) = guard.session() else {
            return;
        };
        let pending = session.js_locations.iter().filter(|l| is_pending(l));
        let (n, bytes) = pending.fold((0usize, 0usize), |(n, bytes), l| {
            (n + 1, bytes + session.strings.get(l.url).len())
        });
        (session.generation, n, bytes)
    };
    if pending == 0 {
        return;
    }
    let mut work: Vec<Unresolved> = Vec::with_capacity(pending);
    let mut urls: Vec<u8> = Vec::with_capacity(url_bytes);
    let mut url_spans: Vec<(usize, usize)> = Vec::with_capacity(pending);
    {
        let Some(mut guard) = SHARED.lock() else {
            return;
        };
        let Some(session) = guard.session().filter(|s| s.generation == generation) else {
            return;
        };
        for (index, l) in session.js_locations.iter().enumerate() {
            if !is_pending(l) {
                continue;
            }
            let url = session.strings.get(l.url);
            // What was sampled since the sizes were taken waits for the next call.
            if work.len() == work.capacity() || urls.len() + url.len() > urls.capacity() {
                break;
            }
            url_spans.push((urls.len(), url.len()));
            urls.extend_from_slice(url);
            work.push(Unresolved {
                index: index as u32,
                positions: [(l.line, l.column), (l.function_line, l.function_column)],
                resolved: [None, None],
            });
        }
    }
    for (item, &(start, len)) in work.iter_mut().zip(&url_spans) {
        let url = &urls[start..][..len];
        for (position, resolved) in item.positions.iter().zip(&mut item.resolved) {
            if position.0 != 0 && position.1 != 0 {
                *resolved = resolve(url, position.0, position.1);
            }
        }
    }
    let Some(mut guard) = SHARED.lock() else {
        return;
    };
    let Some(session) = guard.session().filter(|s| s.generation == generation) else {
        return;
    };
    for item in &work {
        let new_url = item.resolved[0]
            .as_ref()
            .map(|r| session.strings.intern(&r.url));
        let Some(l) = session.js_locations.get_mut(item.index as usize) else {
            continue;
        };
        if !is_pending(l) {
            continue;
        }
        l.source = Some(match (&item.resolved[0], new_url) {
            (Some(r), Some(url)) => SourcePosition {
                url,
                line: r.line,
                column: r.column,
                // The start of the function only counts when it maps into the same file.
                function_line: match &item.resolved[1] {
                    Some(f) if f.url == r.url => f.line,
                    _ => 0,
                },
            },
            _ => l.position(),
        });
    }
}

struct Shared {
    lock: UnsafeCell<Mutex>,
    /// `bun_threading::current_thread_id` of the thread inside the lock, 0 when none.
    owner: AtomicU64,
    session: UnsafeCell<Option<Session>>,
}

// SAFETY: `session` is only touched through `Locked`; `lock` is only replaced in a forked child.
unsafe impl Sync for Shared {}

static SHARED: Shared = Shared {
    lock: UnsafeCell::new(Mutex::new()),
    owner: AtomicU64::new(0),
    session: UnsafeCell::new(None),
};

struct Locked<'a>(&'a Shared);

impl Shared {
    /// `None` when the calling thread is already inside: a hook that was re-entered.
    fn lock(&self) -> Option<Locked<'_>> {
        let me = bun_threading::current_thread_id();
        if self.owner.load(Ordering::Relaxed) == me {
            return None;
        }
        // SAFETY: the mutex is only replaced in a forked child before it has other threads.
        unsafe { (*self.lock.get()).lock() };
        self.owner.store(me, Ordering::Relaxed);
        Some(Locked(self))
    }
}

impl Locked<'_> {
    fn session(&mut self) -> Option<&mut Session> {
        self.slot().as_mut()
    }

    fn slot(&mut self) -> &mut Option<Session> {
        // SAFETY: the lock is held for as long as `self` lives.
        unsafe { &mut *self.0.session.get() }
    }
}

impl Drop for Locked<'_> {
    fn drop(&mut self) {
        self.0.owner.store(0, Ordering::Relaxed);
        // SAFETY: locked by this thread in `Shared::lock`.
        unsafe { (*self.0.lock.get()).unlock() };
    }
}

struct ProfilerCell(UnsafeCell<mi_profiler_t>);
// SAFETY: mimalloc only writes `reserved` (atomically); the rest is never written.
unsafe impl Sync for ProfilerCell {}

static PROFILER: ProfilerCell = ProfilerCell(UnsafeCell::new(mi_profiler_t {
    reserved: core::ptr::null_mut(),
    sample_data_size: core::mem::size_of::<SampleData>(),
    // 0: a thread's first allocation is a sample, and `on_alloc` returns an interval drawn around the session's.
    initial_sample_rate: 0,
    on_alloc: Some(on_alloc),
    on_free: Some(on_free),
    on_realloc_inplace: None,
}));

static GENERATION: AtomicU32 = AtomicU32::new(0);
static ATTACHED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy)]
pub enum Error {
    AlreadyRunning,
    NotRunning,
    /// `sample_interval` is below [`MIN_SAMPLE_INTERVAL`].
    IntervalTooSmall,
    OutOfMemory,
}

impl From<Error> for &'static str {
    fn from(error: Error) -> Self {
        match error {
            Error::AlreadyRunning => "AlreadyRunning",
            Error::NotRunning => "NotRunning",
            Error::IntervalTooSmall => "IntervalTooSmall",
            Error::OutOfMemory => "OutOfMemory",
        }
    }
}

pub fn is_running() -> bool {
    RUNNING.load(Ordering::Acquire)
}

pub fn start(sample_interval: usize) -> Result<(), Error> {
    if sample_interval < MIN_SAMPLE_INTERVAL {
        return Err(Error::IntervalTooSmall);
    }
    if !ensure_meta_heap() {
        return Err(Error::OutOfMemory);
    }
    register_fork_handler();
    {
        let Some(mut guard) = SHARED.lock() else {
            return Err(Error::AlreadyRunning);
        };
        if guard.session().is_some() {
            return Err(Error::AlreadyRunning);
        }
        let generation = GENERATION
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1)
            .max(1);
        *guard.slot() = Some(Session::new(generation, sample_interval));
    }
    // SAFETY: `PROFILER` is a static; mimalloc keeps the pointer for the life of the process.
    unsafe {
        if !ATTACHED.swap(true, Ordering::AcqRel) && !mimalloc::mi_profile(PROFILER.0.get()) {
            ATTACHED.store(false, Ordering::Release);
            if let Some(mut guard) = SHARED.lock() {
                *guard.slot() = None;
            }
            return Err(Error::OutOfMemory);
        }
        mimalloc::mi_profiler_start(PROFILER.0.get());
    }
    RUNNING.store(true, Ordering::Release);
    Ok(())
}

/// The gzipped `profile.proto`.
pub fn stop() -> Result<Vec<u8>, Error> {
    if !RUNNING.swap(false, Ordering::AcqRel) {
        return Err(Error::NotRunning);
    }
    // SAFETY: see `start`.
    unsafe { mimalloc::mi_profiler_stop(PROFILER.0.get()) };
    // A hook already past mimalloc's enabled check waits for the lock, then finds no session.
    let session = SHARED
        .lock()
        .and_then(|mut guard| guard.slot().take())
        .ok_or(Error::NotRunning)?;
    let profile = encode::encode(&encode::View::of(&session));
    drop(session);
    encode::gzip(&profile).ok_or(Error::OutOfMemory)
}

/// The gzipped `profile.proto` so far.
pub fn profile() -> Result<Vec<u8>, Error> {
    let copy = loop {
        let mut copy = {
            let mut guard = SHARED.lock().ok_or(Error::NotRunning)?;
            encode::Snapshot::sized_for(guard.session().ok_or(Error::NotRunning)?)
        };
        // Outside the lock: every other thread's samples wait on it.
        copy.reserve();
        let mut guard = SHARED.lock().ok_or(Error::NotRunning)?;
        if copy.fill_from(guard.session().ok_or(Error::NotRunning)?) {
            break copy;
        }
    };
    let profile = encode::encode(&copy.view());
    encode::gzip(&profile).ok_or(Error::OutOfMemory)
}

fn sample_data(data: *mut mi_profiler_sample_data_t) -> *mut SampleData {
    if data.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: mimalloc reserved `sample_data_size` pointer-aligned bytes at `user_data`.
    unsafe { (&raw mut (*data).user_data).cast::<SampleData>() }
}

unsafe extern "C" fn on_alloc(
    _profiler: *mut mi_profiler_t,
    data: *mut mi_profiler_sample_data_t,
    _ptr: *mut c_void,
    requested_size: usize,
    bytes_sample_rate: usize,
    bytes_since_last_sample: u64,
    _heap: *const mimalloc::Heap,
) -> usize {
    let sample = sample_data(data);
    let mut recorded = SampleData {
        generation: 0,
        bucket: 0,
        bytes: 0,
        objects: 0,
    };
    let next = record_allocation(requested_size, bytes_since_last_sample, &mut recorded);
    if !sample.is_null() {
        // SAFETY: see `sample_data`.
        unsafe { sample.write(recorded) };
    }
    // The rate of a thread that has not had a sample yet is 1, and a drawn one can be as short.
    next.unwrap_or_else(|| bytes_sample_rate.max(MIN_SAMPLE_INTERVAL))
}

/// The interval until the next sample, `None` when nothing was recorded.
#[inline(never)]
fn record_allocation(
    requested_size: usize,
    bytes_since_last_sample: u64,
    recorded: &mut SampleData,
) -> Option<usize> {
    if SHARED.owner.load(Ordering::Relaxed) == bun_threading::current_thread_id() {
        return None;
    }

    // `pcs[0]` is in `on_alloc`; the allocator's frames after it are left to `drop_frames`.
    let mut frame_pointers = [0usize; MAX_CHAIN];
    let mut pcs = [0usize; MAX_CHAIN];
    let chain = bun_core::debug::capture_frame_chain(
        bun_core::debug::frame_address(),
        &mut frame_pointers,
        &mut pcs,
    );

    let mut js_frames = [RawJsFrame::EMPTY; MAX_JS_FRAMES];
    let js = match CAPTURE_JS_FRAMES.get() {
        #[cfg(not(windows))]
        Some(capture) => capture(&frame_pointers[..chain], &pcs[..chain], &mut js_frames),
        // `RtlCaptureStackBackTrace` gives no frame pointers to find `vm.topCallFrame` among:
        // walk them too, as far as the code keeps them.
        #[cfg(all(windows, target_arch = "aarch64"))]
        Some(capture) => {
            let mut walked_pcs = [0usize; MAX_CHAIN];
            let walked = bun_core::debug::capture_frame_chain_bounded(
                bun_core::debug::frame_address(),
                &mut frame_pointers,
                &mut walked_pcs,
            );
            capture(
                &frame_pointers[..walked],
                &walked_pcs[..walked],
                &mut js_frames,
            )
        }
        // On x64 Windows rbp does not point at a frame record, so there is nothing to check
        // `vm.topCallFrame` against: no JavaScript frames, only the Worker's label.
        #[cfg(all(windows, not(target_arch = "aarch64")))]
        Some(capture) => capture(&[], &[], &mut js_frames),
        None => JsThread::default(),
    };
    let js_frames = &js_frames[..js.frames.min(MAX_JS_FRAMES)];

    let mut name = [0u8; 64];
    let thread_name = current_thread_name(&mut name);

    let mut guard = SHARED.lock()?;
    let session = guard.session()?;
    session.samples += 1;

    let mut stack = [0usize; MAX_STACK_WORDS];
    let mut depth = 0usize;
    let mut push = |word: usize| {
        if depth < MAX_STACK_WORDS {
            stack[depth] = word;
            depth += 1;
        }
    };
    let mut next_js = 0usize;
    for (k, &pc) in pcs[..chain].iter().enumerate().skip(1) {
        let mut replaced = false;
        // On Windows the frames' indices are into another walk: they go after the native ones.
        while cfg!(not(windows))
            && next_js < js_frames.len()
            && js_frames[next_js].chain_index as usize <= k
        {
            if let Some(index) = session.js_location_for(&js_frames[next_js], js.vm) {
                push(JS_TAG | index);
            }
            replaced |= js_frames[next_js].chain_index as usize == k;
            next_js += 1;
        }
        if !replaced {
            push(pc);
        }
    }
    for frame in &js_frames[next_js..] {
        if let Some(index) = session.js_location_for(frame, js.vm) {
            push(JS_TAG | index);
        }
    }

    let thread = session.strings.intern(thread_name);
    let objects = (bytes_since_last_sample / (requested_size.max(1) as u64)).max(1);
    match session.bucket_for(&stack[..depth], thread, js.worker) {
        Some(bucket) => {
            let b = &mut session.buckets[bucket as usize];
            b.alloc_bytes += bytes_since_last_sample;
            b.alloc_objects += objects;
            *recorded = SampleData {
                generation: session.generation,
                bucket,
                bytes: bytes_since_last_sample,
                objects,
            };
        }
        None => session.dropped += 1,
    }
    Some(session.next_interval())
}

unsafe extern "C" fn on_free(
    _profiler: *mut mi_profiler_t,
    data: *mut mi_profiler_sample_data_t,
    _ptr: *mut c_void,
    _heap: *const mimalloc::Heap,
) {
    let sample = sample_data(data);
    if sample.is_null() {
        return;
    }
    // SAFETY: `on_alloc` wrote it when this block was sampled.
    let sample = unsafe { sample.read() };
    if sample.generation == 0 {
        return;
    }
    let Some(mut guard) = SHARED.lock() else {
        return;
    };
    let Some(session) = guard.session() else {
        return;
    };
    if sample.generation != session.generation {
        return;
    }
    if let Some(b) = session.buckets.get_mut(sample.bucket as usize) {
        // The amounts were read from in front of the freed block, where the program can have written.
        b.free_bytes = b.free_bytes.saturating_add(sample.bytes);
        b.free_objects = b.free_objects.saturating_add(sample.objects);
    }
}

pub(crate) fn now_ns() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as i64)
}

/// Empty on Windows, where `GetThreadDescription` allocates.
fn current_thread_name(buf: &mut [u8; 64]) -> &[u8] {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    // SAFETY: PR_GET_NAME writes at most 16 bytes including the NUL.
    let ok = unsafe { libc::prctl(libc::PR_GET_NAME, buf.as_mut_ptr()) } == 0;
    #[cfg(target_vendor = "apple")]
    // SAFETY: writes at most `buf.len()` bytes including the NUL.
    let ok = unsafe {
        libc::pthread_getname_np(libc::pthread_self(), buf.as_mut_ptr().cast(), buf.len())
    } == 0;
    #[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple")))]
    let ok = false;
    if !ok {
        return b"";
    }
    let len = bun_core::strings::index_of_char_usize(&buf[..], 0).unwrap_or(buf.len());
    &buf[..len]
}

/// A forked child may have copied the lock held: it gets a fresh one and no session.
fn register_fork_handler() {
    #[cfg(unix)]
    {
        static REGISTERED: AtomicBool = AtomicBool::new(false);
        extern "C" fn child() {
            RUNNING.store(false, Ordering::Release);
            SHARED.owner.store(0, Ordering::Relaxed);
            // SAFETY: the child has no other thread yet. Not dropped: a hook may have been mid-update.
            unsafe {
                SHARED.lock.get().write(Mutex::new());
                let _ = core::mem::ManuallyDrop::new((*SHARED.session.get()).take());
                mimalloc::mi_profiler_stop(PROFILER.0.get());
            }
        }
        if !REGISTERED.swap(true, Ordering::AcqRel) {
            // SAFETY: `child` does not allocate and takes no lock.
            unsafe { libc::pthread_atfork(None, None, Some(child)) };
        }
    }
}

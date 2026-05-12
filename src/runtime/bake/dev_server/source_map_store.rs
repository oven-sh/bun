//! Storage for source maps on `/_bun/client/{id}.js.map`
//!
//! All source maps are reference counted, so that when a websocket disconnects
//! or a bundle is replaced, the unreachable source map URLs are revoked. Source
//! maps that aren't reachable from IncrementalGraph can still be reached by
//! a browser tab if it has a callback to a previously loaded chunk; so DevServer
//! should be aware of it.
//!
//! Spec: src/runtime/bake/DevServer/SourceMapStore.zig

use core::mem::offset_of;

use bun_collections::{ArrayHashMap, LinearFifo, linear_fifo::StaticBuffer};
use bun_core::string_joiner::StringJoiner;
use bun_core::{Timespec, TimespecMockMode};
use bun_sourcemap::{self as source_map, SourceMapState};

use crate::bake::dev_server_body::map_log;
use crate::bake::{self, Side};
use crate::timer::EventLoopTimerState;

use super::{ChunkKind, DevServer, EventLoopTimer, Magic, TimerTag, packed_map};

/// See `SourceId` for what the content of u64 is.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Default)]
pub struct Key(pub u64);
impl Key {
    #[inline]
    pub const fn init(v: u64) -> Self {
        Self(v)
    }
    #[inline]
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Route bundle keys clear the bottom 32 bits of this value, using only the
/// top 32 bits to represent the map. For JS chunks, these bottom 32 bits are
/// used as an index into `dev.route_bundles` to know what route it refers to.
///
/// HMR patches set the bottom bit to `1`, and use the remaining 63 bits as
/// an ID. This is fine since the JS chunks are never served after the update
/// is emitted.
// TODO: Rewrite this `SourceMapStore.Key` and some other places that use bit
// shifts and u64 to use this struct.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct SourceId(pub u64);
impl SourceId {
    #[inline]
    pub const fn kind(self) -> ChunkKind {
        if self.0 & 1 == 0 {
            ChunkKind::InitialResponse
        } else {
            ChunkKind::HmrChunk
        }
    }
    /// `bits.initial_response.generation_id` (top 32 bits)
    #[inline]
    pub const fn initial_response_generation_id(self) -> u32 {
        (self.0 >> 32) as u32
    }
    /// `bits.hmr_chunk.content_hash` (upper 63 bits)
    #[inline]
    pub const fn hmr_chunk_content_hash(self) -> u64 {
        self.0 >> 1
    }
}

pub const WEAK_REF_EXPIRY_SECONDS: i64 = 10;
pub const WEAK_REF_ENTRY_MAX: usize = 16;

/// IncrementalGraph stores partial source maps for each file. A
/// `SourceMapStore.Entry` is the information + refcount holder to
/// construct the actual JSON file associated with a bundle/hot update.
// PORT NOTE: Zig's `dev_arena` allocator-handle field is dropped — its sole
// reader was `Entry.arena()` which fed `paths`/`files` frees in `deinit`.
// In Rust those are `Box`/`Vec` backed by the global mimalloc.
pub struct Entry {
    /// Sum of:
    /// - How many active sockets have code that could reference this source map?
    /// - For route bundle client scripts, +1 until invalidation.
    pub ref_count: u32,
    /// Indexes are off by one because this excludes the HMR Runtime.
    // PORT NOTE: Zig borrowed inner slices from `IncrementalGraph.bundled_files
    // .keys()`; that is self-referential w.r.t. `DevServer`, so the port stores
    // owned copies instead. See PERF(port) in `IncrementalGraph::take_source_map`.
    pub paths: Box<[Box<[u8]>]>,
    /// Indexes are off by one because this excludes the HMR Runtime.
    // PORT NOTE: Zig used `bun.MultiArrayList(PackedMap.Shared)` (SoA over a
    // tagged union). `MultiArrayElement` cannot be derived for an enum and the
    // column split buys nothing for a 2-word payload, so this is a plain `Vec`.
    pub files: Vec<packed_map::Shared>,
    /// The memory cost can be shared between many entries and IncrementalGraph
    /// so this is only used for eviction logic, to pretend this was the only
    /// entry. To compute the memory cost of DevServer, this cannot be used.
    pub overlapping_memory_cost: u32,
}

impl Default for Entry {
    fn default() -> Self {
        Self {
            ref_count: 0,
            paths: Box::default(),
            files: Vec::new(),
            overlapping_memory_cost: 0,
        }
    }
}

impl Entry {
    // PORT NOTE: Zig `sourceContents()` was dead code — it indexed
    // `entry.source_contents` and `entry.file_paths`, fields removed in
    // 67f0c3e016a (replaced by `paths` + `files`). Zig's lazy compilation
    // never instantiated it; no callers exist. Dropped rather than stubbed.

    /// `SourceMapStore.Entry.renderMappings`.
    pub fn render_mappings(&self, kind: ChunkKind) -> Result<Vec<u8>, bun_core::Error> {
        let mut j = StringJoiner::default();
        j.push_static(b"AAAA");
        self.join_vlq(kind, &mut j, Side::Client)?;
        Ok(j.done()?.into_vec())
    }

    /// `SourceMapStore.Entry.renderJSON`.
    pub fn render_json(
        &self,
        dev: &mut DevServer,
        kind: ChunkKind,
        side: Side,
    ) -> Result<Vec<u8>, bun_core::Error> {
        let map_files = self.files.as_slice();
        let paths = &self.paths;

        let mut j = StringJoiner::default();

        j.push_static(br#"{"version":3,"sources":["bun://Bun/Bun HMR Runtime""#);

        // This buffer is temporary, holding the quoted source paths, joined with commas.
        // PERF(port): was arena-backed ArrayList; using global Vec since
        // `percent_encode_write` takes `&mut Vec<u8>`.
        let mut source_map_strings: Vec<u8> = Vec::new();

        #[cfg(windows)]
        let mut buf = bun_paths::path_buffer_pool::get();

        for native_file_path in paths.iter() {
            let native_file_path: &[u8] = native_file_path;
            source_map_strings.extend_from_slice(b",");
            #[cfg(windows)]
            let path: &[u8] =
                bun_paths::resolve_path::path_to_posix_buf::<u8>(native_file_path, &mut **buf);
            #[cfg(not(windows))]
            let path: &[u8] = native_file_path;

            if bun_paths::is_absolute(path) {
                let is_windows_drive_path = cfg!(windows) && path[0] != b'/';

                // On the client we prefix the sourcemap path with "file://" and
                // percent encode it
                if side == Side::Client {
                    source_map_strings.extend_from_slice(if is_windows_drive_path {
                        b"\"file:///"
                    } else {
                        b"\"file://"
                    });
                } else {
                    source_map_strings.push(b'"');
                }

                if cfg!(windows) && !is_windows_drive_path {
                    // UNC namespace -> file://server/share/path.ext
                    let unc_path = if path.len() > 2 && path[0] == b'/' && path[1] == b'/' {
                        &path[2..]
                    } else {
                        path // invalid but must not crash
                    };
                    match Self::encode_source_map_path(side, unc_path, &mut source_map_strings) {
                        Ok(()) => {}
                        Err(EncodeSourceMapPathError::IncompleteUTF8) => {
                            panic!("Unexpected: asset with incomplete UTF-8 as file path")
                        }
                        Err(EncodeSourceMapPathError::OutOfMemory) => {
                            return Err(bun_core::err!("OutOfMemory"));
                        }
                    }
                } else {
                    // posix paths always start with '/'
                    // -> file:///path/to/file.js
                    // windows drive letter paths have the extra slash added
                    // -> file:///C:/path/to/file.js
                    match Self::encode_source_map_path(side, path, &mut source_map_strings) {
                        Ok(()) => {}
                        Err(EncodeSourceMapPathError::IncompleteUTF8) => {
                            panic!("Unexpected: asset with incomplete UTF-8 as file path")
                        }
                        Err(EncodeSourceMapPathError::OutOfMemory) => {
                            return Err(bun_core::err!("OutOfMemory"));
                        }
                    }
                }
                source_map_strings.extend_from_slice(b"\"");
            } else {
                source_map_strings.extend_from_slice(b"\"bun://");
                match bun_core::percent_encode_write(path, &mut source_map_strings) {
                    Ok(()) => {}
                    Err(bun_core::PercentEncodeError::IncompleteUTF8) => {
                        panic!("Unexpected: asset with incomplete UTF-8 as file path")
                    }
                    Err(bun_core::PercentEncodeError::OutOfMemory) => {
                        return Err(bun_core::err!("OutOfMemory"));
                    }
                }
                source_map_strings.extend_from_slice(b"\"");
            }
        }
        // PORT NOTE: Zig `j.pushStatic(source_map_strings.items)` borrows the
        // arena-backed buffer for the lifetime of `j`; `source_map_strings`
        // outlives `j.done_with_end()` below so the borrow is sound.
        j.push_static(source_map_strings.as_slice());
        j.push_static(br#"],"sourcesContent":["// (Bun's internal HMR runtime is minified)""#);
        for chunk in map_files {
            let Some(source_map) = chunk.get() else {
                // For empty chunks, put a blank entry. This allows HTML files to get their stack
                // remapped, despite having no actual mappings.
                j.push_static(b",\"\"");
                continue;
            };
            j.push_static(b",");
            let quoted_slice = source_map.quoted_contents();
            if quoted_slice.is_empty() {
                debug_assert!(false); // vlq without source contents!
                j.push_static(b",\"// Did not have source contents for this file.\n// This is a bug in Bun's bundler and should be reported with a reproduction.\"");
                continue;
            }
            // Store the location of the source file. Since it is going
            // to be stored regardless for use by the served source map.
            // These 8 bytes per file allow remapping sources without
            // reading from disk, as well as ensuring that remaps to
            // this exact sourcemap can print the previous state of
            // the code when it was modified.
            debug_assert_eq!(quoted_slice[0], b'"');
            debug_assert_eq!(quoted_slice[quoted_slice.len() - 1], b'"');
            j.push_static(quoted_slice);
        }
        // This first mapping makes the bytes from line 0 column 0 to the next mapping
        j.push_static(br#"],"names":[],"mappings":"AAAA"#);
        self.join_vlq(kind, &mut j, side)?;

        let json_bytes = j.done_with_end(b"\"}")?.into_vec();
        // errdefer @compileError("last try should be the final alloc") — no further fallible ops below.

        #[cfg(feature = "bake_debugging_features")]
        if let Some(dump_dir) = dev.dump_dir.as_mut() {
            let rel_path_escaped: &[u8] = if side == Side::Client {
                b"latest_chunk.js.map"
            } else {
                b"latest_hmr.js.map"
            };
            if let Err(err) = crate::bake::dev_server_body::dump_bundle(
                dump_dir,
                if side == Side::Client {
                    bake::Graph::Client
                } else {
                    bake::Graph::Server
                },
                rel_path_escaped,
                &json_bytes,
                false,
            ) {
                // PORT NOTE: Zig `bun.handleErrorReturnTrace` is a no-op in Rust.
                bun_core::output::warn(format_args!("Could not dump bundle: {}", err));
            }
        }
        #[cfg(not(feature = "bake_debugging_features"))]
        let _ = dev;

        Ok(json_bytes)
    }

    fn encode_source_map_path(
        side: Side,
        utf8_input: &[u8],
        out: &mut Vec<u8>,
    ) -> Result<(), EncodeSourceMapPathError> {
        // On the client, percent encode everything so it works in the browser
        if side == Side::Client {
            return bun_core::percent_encode_write(utf8_input, out)
                .map_err(EncodeSourceMapPathError::from);
        }
        // PORT NOTE: Zig `array_list.writer()` + `writePreQuotedString(..., @TypeOf(writer), writer, ...)`
        // → `&mut impl bun_io::Write` per PORTING.md §Type map "(comptime X: type, arg: X)".
        bun_js_printer::write_pre_quoted_string::<
            _,
            b'"',
            false,
            true,
            { bun_js_printer::Encoding::Utf8 },
        >(utf8_input, out)
        .map_err(|_| EncodeSourceMapPathError::OutOfMemory)
    }

    fn join_vlq(
        &self,
        kind: ChunkKind,
        j: &mut StringJoiner,
        side: Side,
    ) -> Result<(), bun_core::Error> {
        let _ = side;
        let map_files = self.files.as_slice();

        // PORT NOTE: Zig `comptime .init("self[Symbol.for(\"bun:hmr\")]({\n")`
        // — only `line_count` is read here; the literal has exactly one '\n'.
        const HMR_CHUNK_PREFIX: &[u8] = b"self[Symbol.for(\"bun:hmr\")]({\n";
        let runtime_line_count: u32 = match kind {
            ChunkKind::InitialResponse => bake::get_hmr_runtime(Side::Client).line_count,
            ChunkKind::HmrChunk => HMR_CHUNK_PREFIX.iter().filter(|&&b| b == b'\n').count() as u32,
        };

        let mut prev_end_state = SourceMapState {
            generated_line: 0,
            generated_column: 0,
            source_index: 0,
            original_line: 0,
            original_column: 0,
        };

        // The runtime.line_count counts newlines (e.g., 2941 for a 2942-line file).
        // The runtime ends at line 2942 with })({ so modules start after that.
        let mut lines_between: u32 = runtime_line_count;

        // Join all of the mappings together.
        for (i, file) in map_files.iter().enumerate() {
            match file {
                packed_map::Shared::Some(source_map) => {
                    let source_index = i + 1;
                    let content: &packed_map::PackedMap = source_map.as_ref();
                    let start_state = SourceMapState {
                        source_index: i32::try_from(source_index).expect("int cast"),
                        generated_line: i32::try_from(lines_between).expect("int cast"),
                        generated_column: 0,
                        original_line: 0,
                        original_column: 0,
                    };
                    lines_between = 0;

                    source_map::append_source_map_chunk(
                        j,
                        prev_end_state,
                        start_state,
                        content.vlq(),
                    )?;

                    prev_end_state = SourceMapState {
                        source_index: i32::try_from(source_index).expect("int cast"),
                        generated_line: 0,
                        generated_column: 0,
                        original_line: content.end_state.original_line,
                        original_column: content.end_state.original_column,
                    };
                }
                packed_map::Shared::LineCount(count) => {
                    lines_between += count.get();
                    // - Empty file has no breakpoints that could remap.
                    // - Codegen of HTML files cannot throw.
                }
                packed_map::Shared::None => {
                    // NOTE: It is too late to compute the line count since the bundled text may
                    // have been freed already. For example, a HMR chunk is never persisted.
                    // We could return an error here but what would be a better behavior for renderJSON and renderMappings?
                    // This is a dev server, crashing is not a good DX, we could fail the request but that's not a good DX either.
                    if cfg!(debug_assertions) {
                        map_log!(
                            "Skipping source map entry with missing line count at index {}",
                            i
                        );
                    }
                }
            }
        }
        Ok(())
    }

    /// `SourceMapStore.Entry.deinit` — Rust drop handles `files` (each
    /// `Shared` decrements its `Rc<PackedMap>`) and `paths` (outer box only;
    /// inner slices are borrowed from IncrementalGraph and not freed).
    ///
    /// PORT NOTE: not `impl Drop` — Zig only asserted `ref_count == 0` on the
    /// explicit `unrefAtIndex` release path. Whole-store teardown and
    /// `*out = Entry { .. }` overwrites legitimately drop entries with nonzero
    /// counts, where a `Drop` assertion would diverge from spec and panic.
    pub fn deinit(&mut self) {
        debug_assert_eq!(self.ref_count, 0);
        self.files.clear();
        self.paths = Box::default();
    }
}

#[derive(Debug)]
pub enum EncodeSourceMapPathError {
    OutOfMemory,
    IncompleteUTF8,
}
impl From<bun_core::PercentEncodeError> for EncodeSourceMapPathError {
    fn from(e: bun_core::PercentEncodeError) -> Self {
        match e {
            bun_core::PercentEncodeError::IncompleteUTF8 => Self::IncompleteUTF8,
            bun_core::PercentEncodeError::OutOfMemory => Self::OutOfMemory,
        }
    }
}

#[derive(Copy, Clone)]
pub struct WeakRef {
    /// This encoding only supports route bundle scripts, which do not
    /// utilize the bottom 32 bits of their keys. This is because the bottom
    /// 32 bits are used for the index of the route bundle. While those bits
    /// are present in the JS file's key, it is not present in the source
    /// map key. This allows this struct to be cleanly packed to 128 bits.
    pub key_top_bits: u32,
    /// When this ref expires, it must subtract this many from `refs`
    pub count: u32,
    /// Seconds since epoch. Every time `weak_refs` is incremented, this is
    /// updated to the current time + 1 minute. When the timer expires, all
    /// references are removed.
    pub expire: i64,
}

impl WeakRef {
    #[inline]
    pub fn key(self) -> Key {
        Key::init((self.key_top_bits as u64) << 32)
    }

    #[inline]
    pub fn init(k: Key, count: u32, expire: i64) -> WeakRef {
        WeakRef {
            key_top_bits: u32::try_from(k.get() >> 32).expect("int cast"),
            count,
            expire,
        }
    }
}

/// Result of `SourceMapStore::put_or_increment_ref_count`.
pub enum PutOrIncrementRefCount<'a> {
    /// If an *Entry is returned, caller must initialize some
    /// fields with the source map data.
    Uninitialized(&'a mut Entry),
    /// Already exists, ref count was incremented.
    Shared(&'a mut Entry),
}

/// Action for `SourceMapStore::remove_or_upgrade_weak_ref`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum RemoveOrUpgradeMode {
    /// Remove the weak ref entirely
    Remove = 0,
    /// Convert the weak ref into a strong ref
    Upgrade = 1,
}

pub struct LocateWeakRefResult {
    pub index: usize,
    pub r#ref: WeakRef,
}

/// `bun.GenericIndex(u32, Entry)`.
pub enum SmEntryMarker {}
pub type EntryIndex = bun_core::GenericIndex<u32, SmEntryMarker>;

pub struct GetResult<'a> {
    pub index: EntryIndex,
    pub mappings: source_map::mapping::List,
    pub file_paths: &'a [Box<[u8]>],
    pub entry_files: &'a [packed_map::Shared],
}
// PORT NOTE: Zig `GetResult.deinit` only freed `mappings`; Rust drops it
// automatically — no `impl Drop` needed.

pub struct SourceMapStore {
    pub entries: ArrayHashMap<Key, Entry>,
    /// When a HTML bundle is loaded, it places a "weak reference" to the
    /// script's source map. This reference is held until either:
    /// - The script loads and moves the ref into "strongly held" by the HmrSocket
    /// - The expiry time passes
    /// - Too many different weak references exist
    pub weak_refs: LinearFifo<WeakRef, StaticBuffer<WeakRef, WEAK_REF_ENTRY_MAX>>,
    /// Shared
    pub weak_ref_sweep_timer: EventLoopTimer,
}

bun_event_loop::impl_timer_owner!(SourceMapStore; from_timer_ptr => weak_ref_sweep_timer);

impl Default for SourceMapStore {
    fn default() -> Self {
        Self {
            entries: ArrayHashMap::new(),
            weak_refs: LinearFifo::<WeakRef, StaticBuffer<WeakRef, WEAK_REF_ENTRY_MAX>>::init(),
            weak_ref_sweep_timer: EventLoopTimer::init_paused(TimerTag::DevServerSweepSourceMaps),
        }
    }
}

// Intrusive backref: recover the owning DevServer. Caller must guarantee `self`
// is the `source_maps` field of a live, heap-allocated `DevServer` (always
// true for production use; the `Default::default()` instance must never call
// this).
bun_core::impl_field_parent! { SourceMapStore => DevServer.source_maps; pub fn mut owner; }

impl SourceMapStore {
    /// `SourceMapStore.empty` (Zig: `pub const empty: Self = .{ ... }`).
    /// PORT NOTE: ArrayHashMap/LinearFifo have no `const fn` ctors; callers use
    /// this in lieu of a `const`.
    #[inline]
    pub fn empty() -> Self {
        Self::default()
    }

    #[inline]
    fn timer_all<'a>() -> &'a mut crate::timer::All {
        crate::jsc_hooks::timer_all_mut()
    }

    pub fn put_or_increment_ref_count(
        &mut self,
        script_id: Key,
        ref_count: u32,
    ) -> Result<PutOrIncrementRefCount<'_>, bun_alloc::AllocError> {
        let gop = self.entries.get_or_put(script_id)?;
        if !gop.found_existing {
            debug_assert!(ref_count > 0); // invalid state
            *gop.value_ptr = Entry {
                ref_count,
                // Zig left these `undefined`; caller fills them.
                overlapping_memory_cost: 0,
                paths: Box::default(),
                files: Vec::new(),
            };
            Ok(PutOrIncrementRefCount::Uninitialized(gop.value_ptr))
        } else {
            // Zig: `bun.debugAssert(ref_count >= 0)` — always true for u32.
            gop.value_ptr.ref_count += ref_count;
            Ok(PutOrIncrementRefCount::Shared(gop.value_ptr))
        }
    }

    pub fn unref(&mut self, key: Key) {
        self.unref_count(key, 1);
    }

    pub fn unref_count(&mut self, key: Key, count: u32) {
        let Some(index) = self.entries.get_index(&key) else {
            debug_assert!(false);
            return;
        };
        self.unref_at_index(index, count);
    }

    fn unref_at_index(&mut self, index: usize, count: u32) {
        let e = &mut self.entries.values_mut()[index];
        e.ref_count -= count;
        if cfg!(debug_assertions) {
            // PORT NOTE: reshaped for borrowck — read key after mutable borrow ends.
            let rc = e.ref_count;
            let key = self.entries.keys()[index].get();
            map_log!("dec {:x}, {} | {} -> {}", key, count, rc + count, rc);
        }
        if self.entries.values()[index].ref_count == 0 {
            // Zig: e.deinit(); store.entries.swapRemoveAt(index);
            // `swap_remove_at` drops the Entry, freeing `files`/`paths`;
            // the `ref_count == 0` invariant is the branch condition itself.
            self.entries.swap_remove_at(index);
        }
    }

    /// `SourceMapStore.addWeakRef`.
    pub fn add_weak_ref(&mut self, key: Key) {
        // This function expects that `weak_ref_entry_max` is low.
        let Some(entry) = self.entries.get_mut(&key) else {
            debug_assert!(false);
            return;
        };
        entry.ref_count += 1;
        let entry_ref_count = entry.ref_count;
        // PORT NOTE: reshaped for borrowck — drop `entry` borrow before touching weak_refs/owner.

        let mut new_weak_ref_count: u32 = 1;

        let mut found = false;
        for i in 0..self.weak_refs.readable_length() {
            let r = self.weak_refs.peek_item(i);
            if r.key() == key {
                new_weak_ref_count += r.count;
                self.weak_refs.ordered_remove_item(i);
                found = true;
                break;
            }
        }
        if !found {
            // If full, one must be expired to make room.
            if self.weak_refs.readable_length() >= WEAK_REF_ENTRY_MAX {
                let first = self.weak_refs.read_item().unwrap();
                self.unref_count(first.key(), first.count);
                if self.weak_ref_sweep_timer.state == EventLoopTimerState::ACTIVE
                    && self.weak_ref_sweep_timer.next.sec == first.expire
                {
                    Self::timer_all().remove(core::ptr::addr_of_mut!(self.weak_ref_sweep_timer));
                }
            }
        }

        let expire = Timespec::ms_from_now(
            TimespecMockMode::AllowMockedTime,
            WEAK_REF_EXPIRY_SECONDS * 1000,
        );
        self.weak_refs
            .write_item(WeakRef::init(key, new_weak_ref_count, expire.sec))
            .expect("unreachable"); // space has been cleared above

        if self.weak_ref_sweep_timer.state != EventLoopTimerState::ACTIVE {
            map_log!("arming weak ref sweep timer");
            Self::timer_all().update(core::ptr::addr_of_mut!(self.weak_ref_sweep_timer), &expire);
        }
        map_log!("addWeakRef {:x}, ref_count: {}", key.get(), entry_ref_count);
    }

    /// Returns true if the ref count was incremented (meaning there was a
    /// source map to transfer).
    pub fn remove_or_upgrade_weak_ref(&mut self, key: Key, mode: RemoveOrUpgradeMode) -> bool {
        if self.entries.get(&key).is_none() {
            return false;
        }
        let mut found = false;
        for i in 0..self.weak_refs.readable_length() {
            let r = self.weak_refs.peek_item_mut(i);
            if r.key() == key {
                r.count = r.count.saturating_sub(1);
                let r_count = r.count;
                if mode == RemoveOrUpgradeMode::Remove {
                    self.unref(key);
                }
                if r_count == 0 {
                    self.weak_refs.ordered_remove_item(i);
                }
                found = true;
                break;
            }
        }
        if !found {
            // Zig `for { ... } else { entry.ref_count += @intFromEnum(mode); }`
            let entry = self.entries.get_mut(&key).unwrap();
            entry.ref_count += mode as u32;
        }
        let entry_ref_count = self.entries.get(&key).map(|e| e.ref_count).unwrap_or(0);
        map_log!(
            "maybeUpgradeWeakRef {:x}, ref_count: {}",
            key.get(),
            entry_ref_count
        );
        let _ = entry_ref_count;
        true
    }

    pub fn locate_weak_ref(&self, key: Key) -> Option<LocateWeakRefResult> {
        for i in 0..self.weak_refs.readable_length() {
            let r = self.weak_refs.peek_item(i);
            if r.key() == key {
                return Some(LocateWeakRefResult { index: i, r#ref: r });
            }
        }
        None
    }

    /// `SourceMapStore.sweepWeakRefs` — pop expired weak-refs, decrement,
    /// reschedule. Called from the high-tier `EventLoopTimer` dispatch with
    /// the raw `*EventLoopTimer` (Zig recovers the store via
    /// `@fieldParentPtr("weak_ref_sweep_timer", t)`).
    pub fn sweep_weak_refs(
        timer: *mut EventLoopTimer,
        now_ts: &bun_event_loop::EventLoopTimer::Timespec,
    ) {
        map_log!("sweepWeakRefs");
        // SAFETY: `timer` points to the `weak_ref_sweep_timer` field of a SourceMapStore.
        let store: &mut SourceMapStore = unsafe { &mut *SourceMapStore::from_timer_ptr(timer) };
        // SAFETY: invariant of `owner()` — store is the `source_maps` field of a live DevServer.
        debug_assert!(unsafe { (*store.owner()).magic } == Magic::Valid);

        // PORT NOTE: Zig compared `i64 expire <= u64 now` with mathematically-correct
        // mixed-sign semantics (negative expire ⇒ expired). Keep `now` as i64 (already
        // clamped ≥0) so the comparison stays sign-correct without u64 wrap.
        let now: i64 = now_ts.sec.max(0);

        // PORT NOTE: Zig `defer store.owner().emitMemoryVisualizerMessageIfNeeded()`
        // inlined at both returns (a scopeguard cannot capture &mut store across
        // the loop body without aliasing).

        while let Some(item) = store.weak_refs.read_item() {
            if item.expire <= now {
                store.unref_count(item.key(), item.count);
            } else {
                store.weak_refs.unget(&[item]).expect("unreachable"); // space exists since the last item was just removed.
                store.weak_ref_sweep_timer.state = EventLoopTimerState::FIRED;
                Self::timer_all().update(
                    core::ptr::addr_of_mut!(store.weak_ref_sweep_timer),
                    &Timespec {
                        sec: item.expire + 1,
                        nsec: 0,
                    },
                );
                // SAFETY: invariant of `owner()`.
                unsafe { (*store.owner()).emit_memory_visualizer_message_if_needed() };
                return;
            }
        }

        store.weak_ref_sweep_timer.state = EventLoopTimerState::CANCELLED;
        // SAFETY: invariant of `owner()`.
        unsafe { (*store.owner()).emit_memory_visualizer_message_if_needed() };
    }

    /// This is used in exactly one place: remapping errors.
    /// In that function, an arena allows reusing memory between different source maps.
    pub fn get_parsed_source_map(&self, script_id: Key) -> Option<GetResult<'_>> {
        let index = self.entries.get_index(&script_id)?; // source map was collected.
        let entry = &self.entries.values()[index];

        let script_id_decoded = SourceId(script_id.get());
        // bun.handleOom(expr) — Rust aborts on OOM by default; just unwrap the inner Result.
        let vlq_bytes = entry
            .render_mappings(script_id_decoded.kind())
            .expect("OOM");
        // PERF(port): Zig used arena for both `arena` and `gpa` here;
        // render_mappings now returns Vec<u8> (global alloc).

        match source_map::mapping::parse(
            &vlq_bytes,
            None,
            i32::try_from(entry.paths.len()).expect("int cast"),
            0, // unused
            Default::default(),
        ) {
            source_map::ParseResult::Fail(fail) => {
                bun_core::output::debug_warn(format_args!(
                    "Failed to re-parse source map: {}",
                    bstr::BStr::new(fail.msg)
                ));
                None
            }
            source_map::ParseResult::Success(psm) => Some(GetResult {
                index: EntryIndex::init(u32::try_from(index).expect("int cast")),
                mappings: psm.mappings,
                file_paths: &entry.paths,
                entry_files: &entry.files,
            }),
        }
    }
}

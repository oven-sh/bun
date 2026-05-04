//! Storage for source maps on `/_bun/client/{id}.js.map`
//!
//! All source maps are referenced counted, so that when a websocket disconnects
//! or a bundle is replaced, the unreachable source map URLs are revoked. Source
//! maps that aren't reachable from IncrementalGraph can still be reached by
//! a browser tab if it has a callback to a previously loaded chunk; so DevServer
//! should be aware of it.

use core::mem::offset_of;

use bun_alloc::Arena as Bump; // bumpalo::Bump re-export
use bun_collections::{ArrayHashMap, MultiArrayList};
use bun_core::{Output, StringJoiner};
use bun_sourcemap::{self as source_map, SourceMapState};

use bun_bake::{self as bake, Side};
use bun_bake::dev_server::{
    self, ChunkKind, DevAllocator, DevServer, dump_bundle, packed_map,
};
use bun_runtime::api::timer::EventLoopTimer;

// PORT NOTE: Zig `mapLog = DevServer.mapLog` — reuse DevServer's existing scope so
// `BUN_DEBUG_<scope>=1` enables both call sites; do NOT re-declare a new scope here.
use bun_bake::dev_server::map_log;

/// See `SourceId` for what the content of u64 is.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct Key(pub u64);
impl Key {
    pub const fn init(v: u64) -> Self { Key(v) }
    pub const fn get(self) -> u64 { self.0 }
}

pub struct SourceMapStore {
    pub entries: ArrayHashMap<Key, Entry>,
    /// When a HTML bundle is loaded, it places a "weak reference" to the
    /// script's source map. This reference is held until either:
    /// - The script loads and moves the ref into "strongly held" by the HmrSocket
    /// - The expiry time passes
    /// - Too many different weak references exist
    pub weak_refs: bun_collections::LinearFifo<WeakRef, WEAK_REF_ENTRY_MAX>,
    // TODO(port): bun.LinearFifo(WeakRef, .{ .Static = N }) — confirm bun_collections::LinearFifo<T, N> API matches std.fifo.LinearFifo
    /// Shared
    pub weak_ref_sweep_timer: EventLoopTimer,
}

impl SourceMapStore {
    pub const EMPTY: Self = Self {
        entries: ArrayHashMap::EMPTY,
        weak_ref_sweep_timer: EventLoopTimer::init_paused(EventLoopTimer::Tag::DevServerSweepSourceMaps),
        weak_refs: bun_collections::LinearFifo::INIT,
    };
}

const WEAK_REF_EXPIRY_SECONDS: i64 = 10;
pub const WEAK_REF_ENTRY_MAX: usize = 16;

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
        // SAFETY: ChunkKind is #[repr(u1)]-equivalent with variants {0,1}; bit 0 is always a valid discriminant.
        unsafe { core::mem::transmute::<u8, ChunkKind>((self.0 & 1) as u8) }
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
    #[inline]
    pub const fn from_bits(bits: u64) -> Self { SourceId(bits) }
}
// PORT NOTE: Zig `packed struct(u64) { kind: ChunkKind, bits: packed union { ... } }`.
// Rust packed structs cannot contain unions with bitfield layout; manual shift accessors above
// preserve the exact bit layout (LSB = kind, bits[1..32] = unused/zero for initial_response,
// bits[32..64] = generation_id; bits[1..64] = content_hash for hmr_chunk).

/// IncrementalGraph stores partial source maps for each file. A
/// `SourceMapStore.Entry` is the information + refcount holder to
/// construct the actual JSON file associated with a bundle/hot update.
pub struct Entry {
    pub dev_allocator: DevAllocator,
    /// Sum of:
    /// - How many active sockets have code that could reference this source map?
    /// - For route bundle client scripts, +1 until invalidation.
    pub ref_count: u32,
    /// Indexes are off by one because this excludes the HMR Runtime.
    /// Outer slice is owned, inner slice is shared with IncrementalGraph.
    // TODO(port): inner-slice lifetime is borrowed from IncrementalGraph; using &'static [u8] as a Phase-A placeholder.
    pub paths: Box<[&'static [u8]]>,
    /// Indexes are off by one because this excludes the HMR Runtime.
    pub files: MultiArrayList<packed_map::Shared>,
    /// The memory cost can be shared between many entries and IncrementalGraph
    /// So this is only used for eviction logic, to pretend this was the only
    /// entry. To compute the memory cost of DevServer, this cannot be used.
    pub overlapping_memory_cost: u32,
}

impl Entry {
    // TODO(port): Zig references nonexistent fields `source_contents` / `file_paths` — looks like
    // dead/stale code in the source. Port preserved verbatim for diffing; revisit in Phase B.
    pub fn source_contents(&self) -> &[bun_str::StringPointer] {
        todo!("source_contents: references fields not present on Entry (stale Zig)")
    }

    pub fn render_mappings(
        &self,
        kind: ChunkKind,
        arena: &Bump,
    ) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut j = StringJoiner::new(arena);
        j.push_static(b"AAAA");
        self.join_vlq(kind, &mut j, arena, Side::Client)?;
        Ok(j.done())
    }

    pub fn render_json(
        &self,
        dev: &mut DevServer,
        arena: &Bump,
        kind: ChunkKind,
        side: Side,
    ) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): narrow error set
        let map_files = self.files.slice();
        let paths = &self.paths;

        let mut j = StringJoiner::new(arena);

        j.push_static(br#"{"version":3,"sources":["bun://Bun/Bun HMR Runtime""#);

        // This buffer is temporary, holding the quoted source paths, joined with commas.
        let mut source_map_strings: bumpalo::collections::Vec<'_, u8> =
            bumpalo::collections::Vec::new_in(arena);
        // PERF(port): was arena-backed ArrayList; bumpalo Vec drops with arena reset.

        let buf = bun_paths::path_buffer_pool().get();

        for native_file_path in paths.iter() {
            source_map_strings.extend_from_slice(b",");
            #[cfg(windows)]
            let path = bun_paths::path_to_posix_buf(native_file_path, &mut *buf);
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
                            return Err(bun_core::err!("OutOfMemory"))
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
                            return Err(bun_core::err!("OutOfMemory"))
                        }
                    }
                }
                source_map_strings.extend_from_slice(b"\"");
            } else {
                source_map_strings.extend_from_slice(b"\"bun://");
                match bun_str::strings::percent_encode_write(path, &mut source_map_strings) {
                    Ok(()) => {}
                    Err(e) if e == bun_core::err!("IncompleteUTF8") => {
                        panic!("Unexpected: asset with incomplete UTF-8 as file path")
                    }
                    Err(e) => return Err(e),
                }
                source_map_strings.extend_from_slice(b"\"");
            }
        }
        // PORT NOTE: Zig `j.pushStatic(source_map_strings.items)` borrows the arena-backed buffer
        // for the lifetime of `j`; both live in `arena`, so the borrow is sound here too.
        j.push_static(source_map_strings.as_slice());
        j.push_static(br#"],"sourcesContent":["// (Bun's internal HMR runtime is minified)""#);
        for i in 0..map_files.len() {
            let chunk = map_files.get(i);
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
            debug_assert!(quoted_slice[0] == b'"');
            debug_assert!(quoted_slice[quoted_slice.len() - 1] == b'"');
            j.push_static(quoted_slice);
        }
        // This first mapping makes the bytes from line 0 column 0 to the next mapping
        j.push_static(br#"],"names":[],"mappings":"AAAA"#);
        self.join_vlq(kind, &mut j, arena, side)?;

        let json_bytes = j.done_with_end(b"\"}")?;
        // errdefer @compileError("last try should be the final alloc") — no further fallible ops below.

        if bun_core::feature_flags::BAKE_DEBUGGING_FEATURES {
            if let Some(dump_dir) = &dev.dump_dir {
                let rel_path_escaped: &[u8] = if side == Side::Client {
                    b"latest_chunk.js.map"
                } else {
                    b"latest_hmr.js.map"
                };
                if let Err(err) = dump_bundle(
                    dump_dir,
                    if side == Side::Client { dev_server::Graph::Client } else { dev_server::Graph::Server },
                    rel_path_escaped,
                    &json_bytes,
                    false,
                ) {
                    // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent; dropped.
                    Output::warn(format_args!("Could not dump bundle: {}", err.name()));
                }
            }
        }

        Ok(json_bytes)
    }

    fn encode_source_map_path(
        side: Side,
        utf8_input: &[u8],
        array_list: &mut bumpalo::collections::Vec<'_, u8>,
    ) -> Result<(), EncodeSourceMapPathError> {
        // On the client, percent encode everything so it works in the browser
        if side == Side::Client {
            return bun_str::strings::percent_encode_write(utf8_input, array_list)
                .map_err(EncodeSourceMapPathError::from);
        }

        // TODO(port): Zig used `array_list.writer()` then `writePreQuotedString(..., @TypeOf(writer), writer, ...)`.
        // In Rust this becomes `&mut impl core::fmt::Write` (or bun_io::Write) per §Type map "(comptime X: type, arg: X)".
        bun_js_printer::write_pre_quoted_string(
            utf8_input,
            array_list,
            b'"',
            false,
            true,
            bun_js_printer::Encoding::Utf8,
        )
        .map_err(EncodeSourceMapPathError::from)
    }

    fn join_vlq(
        &self,
        kind: ChunkKind,
        j: &mut StringJoiner,
        arena: &Bump,
        side: Side,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let _ = side;
        let map_files = self.files.slice();

        let runtime: bake::HmrRuntime = match kind {
            ChunkKind::InitialResponse => bake::get_hmr_runtime(Side::Client),
            ChunkKind::HmrChunk => {
                // PORT NOTE: Zig `comptime .init("...")` — HmrRuntime::init must be a const fn.
                const HMR_CHUNK_RUNTIME: bake::HmrRuntime =
                    bake::HmrRuntime::init(b"self[Symbol.for(\"bun:hmr\")]({\n");
                HMR_CHUNK_RUNTIME
            }
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
        let mut lines_between: u32 = runtime.line_count;

        // Join all of the mappings together.
        for i in 0..map_files.len() {
            match map_files.get(i) {
                packed_map::Shared::Some(source_map) => {
                    let source_index = i + 1;
                    let content = source_map.get();
                    let start_state = SourceMapState {
                        source_index: i32::try_from(source_index).unwrap(),
                        generated_line: i32::try_from(lines_between).unwrap(),
                        generated_column: 0,
                        original_line: 0,
                        original_column: 0,
                    };
                    lines_between = 0;

                    source_map::append_source_map_chunk(
                        j,
                        arena,
                        prev_end_state,
                        start_state,
                        content.vlq(),
                    )?;

                    prev_end_state = SourceMapState {
                        source_index: i32::try_from(source_index).unwrap(),
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
                    if cfg!(feature = "debug_logs") {
                        bun_output::scoped_log!(
                            map_log,
                            "Skipping source map entry with missing line count at index {}",
                            i
                        );
                    }
                }
            }
        }
        Ok(())
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        // PORT NOTE: Zig `deinit` used `useAllFields` to statically assert every field is handled.
        // In Rust, `Box`/`MultiArrayList` fields drop automatically; only the side effects remain.
        debug_assert!(self.ref_count == 0);
        let files = self.files.slice();
        for i in 0..files.len() {
            let mut file = files.get(i);
            file.deinit();
            // TODO(port): packed_map::Shared::deinit — confirm this is not double-dropping vs MultiArrayList Drop.
        }
        // self.files: MultiArrayList drops its backing storage.
        // self.paths: Box<[..]> drops the outer allocation; inner slices are borrowed (not freed).
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum EncodeSourceMapPathError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("IncompleteUTF8")]
    IncompleteUTF8,
}
impl From<bun_alloc::AllocError> for EncodeSourceMapPathError {
    fn from(_: bun_alloc::AllocError) -> Self { Self::OutOfMemory }
}
impl From<bun_core::Error> for EncodeSourceMapPathError {
    fn from(e: bun_core::Error) -> Self {
        if e == bun_core::err!("IncompleteUTF8") { Self::IncompleteUTF8 } else { Self::OutOfMemory }
    }
}
impl From<EncodeSourceMapPathError> for bun_core::Error {
    fn from(e: EncodeSourceMapPathError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
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
    pub fn key(self) -> Key {
        Key::init((self.key_top_bits as u64) << 32)
    }

    pub fn init(k: Key, count: u32, expire: i64) -> WeakRef {
        WeakRef {
            key_top_bits: u32::try_from(k.get() >> 32).unwrap(),
            count,
            expire,
        }
    }
}

impl SourceMapStore {
    pub fn owner(&mut self) -> &mut DevServer {
        // SAFETY: self is the `source_maps` field of a DevServer; recovered via container_of.
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(DevServer, source_maps))
                .cast::<DevServer>()
        }
    }

    fn dev_allocator(&self) -> DevAllocator {
        // SAFETY: same container_of invariant as `owner`; const-only access.
        let dev_server: &DevServer = unsafe {
            &*(self as *const Self as *const u8)
                .sub(offset_of!(DevServer, source_maps))
                .cast::<DevServer>()
        };
        dev_server.dev_allocator()
    }
}

pub enum PutOrIncrementRefCount<'a> {
    /// If an *Entry is returned, caller must initialize some
    /// fields with the source map data.
    Uninitialized(&'a mut Entry),
    /// Already exists, ref count was incremented.
    Shared(&'a mut Entry),
}

impl SourceMapStore {
    pub fn put_or_increment_ref_count(
        &mut self,
        script_id: Key,
        ref_count: u32,
    ) -> Result<PutOrIncrementRefCount<'_>, bun_alloc::AllocError> {
        // PORT NOTE: reshaped for borrowck — capture dev_allocator before borrowing entries mutably.
        let dev_allocator = self.dev_allocator();
        let gop = self.entries.get_or_put(script_id)?;
        if !gop.found_existing {
            debug_assert!(ref_count > 0); // invalid state
            *gop.value_ptr = Entry {
                dev_allocator,
                ref_count,
                // TODO(port): Zig left these `undefined`; caller fills them. Using zeroed/default placeholders.
                overlapping_memory_cost: 0,
                paths: Box::default(),
                files: MultiArrayList::default(),
            };
            Ok(PutOrIncrementRefCount::Uninitialized(gop.value_ptr))
        } else {
            // debug_assert!(ref_count >= 0) — always true for u32; kept as comment for parity.
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
        if cfg!(feature = "debug_logs") {
            // PORT NOTE: reshaped for borrowck — read key after mutable borrow ends.
            let rc = e.ref_count;
            let key = self.entries.keys()[index].get();
            bun_output::scoped_log!(
                map_log,
                "dec {:x}, {} | {} -> {}",
                key,
                count,
                rc + count,
                rc
            );
        }
        if self.entries.values()[index].ref_count == 0 {
            // Drop runs Entry::drop (was e.deinit()).
            self.entries.swap_remove_at(index);
        }
    }

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
        for i in 0..self.weak_refs.count() {
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
            if self.weak_refs.count() >= WEAK_REF_ENTRY_MAX {
                let first = self.weak_refs.read_item().unwrap();
                self.unref_count(first.key(), first.count);
                if self.weak_ref_sweep_timer.state == EventLoopTimer::State::ACTIVE
                    && self.weak_ref_sweep_timer.next.sec == first.expire
                {
                    self.owner().vm.timer.remove(&mut self.weak_ref_sweep_timer);
                    // TODO(port): borrowck — owner() borrows self mutably while weak_ref_sweep_timer is a field of self.
                }
            }
        }

        let expire = bun_core::timespec::ms_from_now(
            bun_core::timespec::MockTime::AllowMockedTime,
            WEAK_REF_EXPIRY_SECONDS * 1000,
        );
        self.weak_refs
            .write_item(WeakRef::init(key, new_weak_ref_count, expire.sec))
            .expect("unreachable"); // space has been cleared above

        if self.weak_ref_sweep_timer.state != EventLoopTimer::State::ACTIVE {
            bun_output::scoped_log!(map_log, "arming weak ref sweep timer");
            self.owner().vm.timer.update(&mut self.weak_ref_sweep_timer, &expire);
            // TODO(port): borrowck — same overlapping &mut as above.
        }
        bun_output::scoped_log!(
            map_log,
            "addWeakRef {:x}, ref_count: {}",
            key.get(),
            entry_ref_count
        );
    }

    /// Returns true if the ref count was incremented (meaning there was a source map to transfer)
    pub fn remove_or_upgrade_weak_ref(&mut self, key: Key, mode: RemoveOrUpgradeMode) -> bool {
        if self.entries.get(&key).is_none() {
            return false;
        }
        let mut found = false;
        for i in 0..self.weak_refs.count() {
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
            let entry = self.entries.get_mut(&key).unwrap();
            entry.ref_count += mode as u32;
        }
        let entry_ref_count = self.entries.get(&key).map(|e| e.ref_count).unwrap_or(0);
        bun_output::scoped_log!(
            map_log,
            "maybeUpgradeWeakRef {:x}, ref_count: {}",
            key.get(),
            entry_ref_count
        );
        true
    }

    pub fn locate_weak_ref(&self, key: Key) -> Option<LocateWeakRefResult> {
        for i in 0..self.weak_refs.count() {
            let r = self.weak_refs.peek_item(i);
            if r.key() == key {
                return Some(LocateWeakRefResult { index: i, r#ref: r });
            }
        }
        None
    }

    pub fn sweep_weak_refs(timer: *mut EventLoopTimer, now_ts: &bun_core::Timespec) {
        bun_output::scoped_log!(map_log, "sweepWeakRefs");
        // SAFETY: timer points to the `weak_ref_sweep_timer` field of a SourceMapStore.
        let store: &mut SourceMapStore = unsafe {
            &mut *(timer as *mut u8)
                .sub(offset_of!(SourceMapStore, weak_ref_sweep_timer))
                .cast::<SourceMapStore>()
        };
        debug_assert!(store.owner().magic == dev_server::Magic::Valid);

        let now: u64 = now_ts.sec.max(0) as u64;

        // PORT NOTE: Zig `defer store.owner().emitMemoryVisualizerMessageIfNeeded()` inlined
        // at both returns below (scopeguard cannot capture &mut store across the loop body).

        while let Some(item) = store.weak_refs.read_item() {
            if item.expire as u64 <= now {
                // PORT NOTE: Zig compared i64 expire <= u64 now (peer-type widened to u64).
                store.unref_count(item.key(), item.count);
            } else {
                store
                    .weak_refs
                    .unget(&[item])
                    .expect("unreachable"); // there is enough space since the last item was just removed.
                store.weak_ref_sweep_timer.state = EventLoopTimer::State::FIRED;
                store.owner().vm.timer.update(
                    &mut store.weak_ref_sweep_timer,
                    &bun_core::Timespec { sec: item.expire + 1, nsec: 0 },
                );
                // TODO(port): borrowck — overlapping &mut (owner() vs field).
                store.owner().emit_memory_visualizer_message_if_needed();
                return;
            }
        }

        store.weak_ref_sweep_timer.state = EventLoopTimer::State::CANCELLED;
        store.owner().emit_memory_visualizer_message_if_needed();
    }
}

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

#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct EntryIndex(pub u32);
impl EntryIndex {
    pub const fn init(v: u32) -> Self { EntryIndex(v) }
}

pub struct GetResult<'a> {
    pub index: EntryIndex,
    pub mappings: source_map::mapping::List,
    pub file_paths: &'a [&'static [u8]],
    // TODO(port): inner-slice lifetime — see Entry.paths note.
    pub entry_files: &'a MultiArrayList<packed_map::Shared>,
}
// PORT NOTE: Zig `GetResult.deinit` only freed `mappings`; Rust drops it automatically — no `impl Drop` needed.

impl SourceMapStore {
    /// This is used in exactly one place: remapping errors.
    /// In that function, an arena allows reusing memory between different source maps
    pub fn get_parsed_source_map(
        &mut self,
        script_id: Key,
        arena: &Bump,
    ) -> Option<GetResult<'_>> {
        let index = self.entries.get_index(&script_id)?; // source map was collected.
        let entry = &self.entries.values()[index];

        // SAFETY: SourceId is #[repr(transparent)] over u64; Key.get() is the raw bits.
        let script_id_decoded = SourceId(script_id.get());
        // bun.handleOom(expr) — Rust aborts on OOM by default; just unwrap the inner Result.
        let vlq_bytes = entry
            .render_mappings(script_id_decoded.kind(), arena)
            .expect("OOM");
        // PERF(port): Zig used arena for both `arena` and `gpa` here; render_mappings now returns Vec<u8> (global alloc).

        match source_map::mapping::parse(
            &vlq_bytes,
            None,
            i32::try_from(entry.paths.len()).unwrap(),
            0, // unused
            Default::default(),
        ) {
            source_map::mapping::ParseResult::Fail(fail) => {
                Output::debug_warn(format_args!(
                    "Failed to re-parse source map: {}",
                    bstr::BStr::new(&fail.msg)
                ));
                None
            }
            source_map::mapping::ParseResult::Success(psm) => Some(GetResult {
                index: EntryIndex::init(u32::try_from(index).unwrap()),
                mappings: psm.mappings,
                file_paths: &entry.paths,
                entry_files: &entry.files,
            }),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/SourceMapStore.zig (567 lines)
//   confidence: medium
//   todos:      14
//   notes:      owner()/@fieldParentPtr borrowck conflicts; Entry.paths inner-slice lifetime placeholder; LinearFifo API assumed; sourceContents() is stale Zig.
// ──────────────────────────────────────────────────────────────────────────

use core::ffi::c_void;
use core::fmt;
use core::sync::atomic::AtomicU32;

use crate::Ordinal; // TODO(b2-blocked): bun_core::Ordinal — local shim

use crate::mapping;
use crate::vlq::VLQ;
use crate::{
    BakeSourceProvider, DevServerSourceProvider, InternalSourceMap, Mapping, ParseUrl,
    ParseUrlResultHint, SourceMapLoadHint, SourceProviderMap,
};

/// ParsedSourceMap can be acquired by different threads via the thread-safe
/// source map store (SavedSourceMap), so the reference count must be thread-safe.
pub struct ParsedSourceMap {
    // bun.ptr.ThreadSafeRefCount → intrusive atomic count; managed via
    // `bun_ptr::IntrusiveArc<ParsedSourceMap>`. `ref`/`deref` are methods on IntrusiveArc.
    pub ref_count: AtomicU32,

    pub input_line_count: usize,
    pub mappings: mapping::List,
    /// Set when this map's mappings are backed by an InternalSourceMap blob (e.g.
    /// embedded in a `bun build --compile` executable) instead of a materialized
    /// `Mapping.List`. The blob's bytes are borrowed (they live in the standalone
    /// module graph's section), so `deinit` does not free them.
    pub internal: Option<InternalSourceMap>,

    /// If this is empty, this implies that the source code is a single file
    /// transpiled on-demand. If there are items, then it means this is a file
    /// loaded without transpilation but with external sources. This array
    /// maps `source_index` to the correct filename.
    pub external_source_names: Vec<Box<[u8]>>,
    /// In order to load source contents from a source-map after the fact,
    /// a handle to the underlying source provider is stored. Within this pointer,
    /// a flag is stored if it is known to be an inline or external source map.
    ///
    /// Source contents are large, we don't preserve them in memory. This has
    /// the downside of repeatedly re-decoding sourcemaps if multiple errors
    /// are emitted (specifically with Bun.inspect / unhandled; the ones that
    /// rely on source contents)
    pub underlying_provider: SourceContentPtr,

    pub is_standalone_module_graph: bool,
}

impl Default for ParsedSourceMap {
    fn default() -> Self {
        Self {
            ref_count: AtomicU32::new(1),
            input_line_count: 0,
            mappings: mapping::List::default(),
            internal: None,
            external_source_names: Vec::new(),
            underlying_provider: SourceContentPtr::NONE,
            is_standalone_module_graph: false,
        }
    }
}

#[repr(u8)] // Zig: enum(u2) — Rust has no u2; packed into SourceContentPtr by shift below
#[derive(Copy, Clone, Eq, PartialEq)]
enum SourceProviderKind {
    Zig = 0,
    Bake = 1,
    DevServer = 2,
}

pub enum AnySourceProvider {
    Zig(*mut SourceProviderMap),
    Bake(*mut BakeSourceProvider),
    DevServer(*mut DevServerSourceProvider),
}

impl AnySourceProvider {
    pub fn ptr(&self) -> *mut c_void {
        match self {
            AnySourceProvider::Zig(p) => (*p).cast::<c_void>(),
            AnySourceProvider::Bake(p) => (*p).cast::<c_void>(),
            AnySourceProvider::DevServer(p) => (*p).cast::<c_void>(),
        }
    }

    pub fn get_source_map(
        &self,
        source_filename: &[u8],
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) -> Option<ParseUrl> {
        match self {
            // SAFETY: pointers originate from SourceContentPtr::from_*_provider and are
            // FFI handles whose lifetime is tied to the JSC SourceProvider; valid while
            // the ParsedSourceMap is reachable.
            AnySourceProvider::Zig(p) => unsafe {
                (**p).get_source_map(source_filename, load_hint, result)
            },
            AnySourceProvider::Bake(p) => unsafe {
                (**p).get_source_map(source_filename, load_hint, result)
            },
            AnySourceProvider::DevServer(p) => unsafe {
                (**p).get_source_map(source_filename, load_hint, result)
            },
        }
    }
}

/// Zig: `packed struct(u64) { load_hint: SourceMapLoadHint, kind: SourceProviderKind, data: u60 }`
/// Field order is low-bit-first: bits 0..2 = load_hint, bits 2..4 = kind, bits 4..64 = data.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct SourceContentPtr(u64);

impl SourceContentPtr {
    const LOAD_HINT_SHIFT: u32 = 0;
    const LOAD_HINT_MASK: u64 = 0b11;
    const KIND_SHIFT: u32 = 2;
    const KIND_MASK: u64 = 0b11;
    const DATA_SHIFT: u32 = 4;
    const DATA_MASK: u64 = (1u64 << 60) - 1;

    pub const NONE: SourceContentPtr = SourceContentPtr(0);

    const fn new(load_hint: SourceMapLoadHint, kind: SourceProviderKind, data: u64) -> Self {
        Self(
            ((load_hint as u64) & Self::LOAD_HINT_MASK) << Self::LOAD_HINT_SHIFT
                | ((kind as u64) & Self::KIND_MASK) << Self::KIND_SHIFT
                | (data & Self::DATA_MASK) << Self::DATA_SHIFT,
        )
    }

    #[inline]
    pub fn load_hint(self) -> SourceMapLoadHint {
        // Only ever written via `new()`/`set_load_hint()` from a valid
        // discriminant; the 2-bit field never holds 0b11.
        match ((self.0 >> Self::LOAD_HINT_SHIFT) & Self::LOAD_HINT_MASK) as u8 {
            1 => SourceMapLoadHint::IsInlineMap,
            2 => SourceMapLoadHint::IsExternalMap,
            v => {
                debug_assert_eq!(v, 0);
                SourceMapLoadHint::None
            }
        }
    }

    #[inline]
    pub fn set_load_hint(&mut self, hint: SourceMapLoadHint) {
        self.0 = (self.0 & !(Self::LOAD_HINT_MASK << Self::LOAD_HINT_SHIFT))
            | ((hint as u64) & Self::LOAD_HINT_MASK) << Self::LOAD_HINT_SHIFT;
    }

    #[inline]
    fn kind(self) -> SourceProviderKind {
        // Only ever written via `new()` from a valid discriminant.
        match ((self.0 >> Self::KIND_SHIFT) & Self::KIND_MASK) as u8 {
            0 => SourceProviderKind::Zig,
            1 => SourceProviderKind::Bake,
            v => {
                debug_assert_eq!(v, 2);
                SourceProviderKind::DevServer
            }
        }
    }

    #[inline]
    pub fn data(self) -> u64 {
        (self.0 >> Self::DATA_SHIFT) & Self::DATA_MASK
    }

    pub fn from_provider(p: *const SourceProviderMap) -> SourceContentPtr {
        Self::new(
            SourceMapLoadHint::None,
            SourceProviderKind::Zig,
            u64::try_from(p as usize).expect("int cast"),
        )
    }

    pub fn from_bake_provider(p: *mut BakeSourceProvider) -> SourceContentPtr {
        Self::new(
            SourceMapLoadHint::None,
            SourceProviderKind::Bake,
            u64::try_from(p as usize).expect("int cast"),
        )
    }

    pub fn from_dev_server_provider(p: *const DevServerSourceProvider) -> SourceContentPtr {
        Self::new(
            SourceMapLoadHint::None,
            SourceProviderKind::DevServer,
            u64::try_from(p as usize).expect("int cast"),
        )
    }

    pub fn provider(self) -> Option<AnySourceProvider> {
        // Zig returns `?AnySourceProvider` but every match arm yields a value; the
        // optionality is implicit (data == 0 ⇒ null pointer). Preserve that here.
        let data = self.data() as usize;
        match self.kind() {
            SourceProviderKind::Zig => Some(AnySourceProvider::Zig(data as *mut SourceProviderMap)),
            SourceProviderKind::Bake => {
                Some(AnySourceProvider::Bake(data as *mut BakeSourceProvider))
            }
            SourceProviderKind::DevServer => Some(AnySourceProvider::DevServer(
                data as *mut DevServerSourceProvider,
            )),
        }
    }
}

impl ParsedSourceMap {
    /// Thread-safe ref-count helpers (Zig: `ThreadSafeRefCount.ref/deref`).
    ///
    /// PORT NOTE: Zig uses an *intrusive* count (`bun.new` + embedded
    /// `ref_count`, freed via `bun.destroy`). The Rust port allocates every
    /// table-stored `ParsedSourceMap` via `Arc::into_raw` (see
    /// `SavedSourceMap::get_with_content` and `ParseUrl.map:
    /// Option<Arc<ParsedSourceMap>>`), so the strong count lives in the `Arc`
    /// header *before* the data pointer. Reconstituting that pointer with
    /// `heap::take` would free an interior offset and trips
    /// `mi_validate_block_from_ptr` (mimalloc free.c:123). Route through
    /// `Arc::{increment,decrement}_strong_count` instead — same observable
    /// `ref()`/`deref()` semantics as the Zig spec, with the allocator that
    /// actually owns the bytes. The embedded `ref_count` field is kept for
    /// layout/ABI parity but is NOT the live counter.
    ///
    /// # Safety
    /// `this` must come from `Arc::<Self>::into_raw` (or a value the table
    /// stored that way) and must still have at least one strong ref.
    #[inline]
    pub unsafe fn ref_(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live `Arc::into_raw` pointer.
        unsafe { std::sync::Arc::increment_strong_count(this.cast_const()) };
    }

    /// See [`ref_`].
    ///
    /// # Safety
    /// `this` must come from `Arc::<Self>::into_raw` and must still have at
    /// least one strong ref. Drops the allocation when the count reaches 0.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live `Arc::into_raw` pointer.
        unsafe { std::sync::Arc::decrement_strong_count(this.cast_const()) };
    }

    /// Construct a `ParsedSourceMap` whose mappings are backed by an
    /// `InternalSourceMap` blob (e.g. one embedded in a `bun build --compile`
    /// executable's standalone module graph) instead of a materialized
    /// `mapping::List`. The blob's bytes are *borrowed* — `internal` is not
    /// freed on drop (see PORT NOTE on conditional Drop below).
    ///
    /// Mirrors Zig `SourceMap.ParsedSourceMap{ .internal = ism, .input_line_count
    /// = ism.inputLineCount() }` struct-init at the standalone-graph load site.
    pub fn from_internal(internal: InternalSourceMap) -> Self {
        Self {
            input_line_count: internal.input_line_count(),
            internal: Some(internal),
            ..Default::default()
        }
    }

    pub fn is_external(&self) -> bool {
        !self.external_source_names.is_empty()
    }

    pub fn find_mapping(&self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        if let Some(ism) = &self.internal {
            return ism.find(line, column);
        }
        self.mappings.find(line, column)
    }

    pub fn internal_cursor(&self) -> Option<crate::internal_source_map::Cursor> {
        self.internal.as_ref().map(|ism| ism.cursor())
    }

    pub fn standalone_module_graph_data(&self) -> *mut crate::SerializedSourceMap::Loaded {
        debug_assert!(self.is_standalone_module_graph);
        self.underlying_provider.data() as usize as *mut crate::SerializedSourceMap::Loaded
    }

    pub fn memory_cost(&self) -> usize {
        let mappings_cost = if let Some(ism) = &self.internal {
            ism.memory_cost()
        } else {
            self.mappings.memory_cost()
        };
        core::mem::size_of::<ParsedSourceMap>()
            + mappings_cost
            + self.external_source_names.len() * core::mem::size_of::<Box<[u8]>>()
    }

    pub fn write_vlqs<W: bun_io::Write + ?Sized>(&self, writer: &mut W) -> bun_io::Result<()> {
        if let Some(ism) = &self.internal {
            let mut buf = bun_core::MutableString::init_empty();
            ism.append_vlq_to(&mut buf);
            writer.write_all(buf.list.as_slice())?;
            return Ok(());
        }
        let mut last_col: i32 = 0;
        let mut last_src: i32 = 0;
        let mut last_ol: i32 = 0;
        let mut last_oc: i32 = 0;
        let mut current_line: i32 = 0;
        debug_assert_eq!(
            self.mappings.generated().len(),
            self.mappings.original().len()
        );
        debug_assert_eq!(
            self.mappings.generated().len(),
            self.mappings.source_index().len()
        );
        for (i, ((gn, orig), source_index)) in self
            .mappings
            .generated()
            .iter()
            .zip(self.mappings.original())
            .zip(self.mappings.source_index())
            .enumerate()
        {
            if current_line != gn.lines.zero_based() {
                debug_assert!(gn.lines.zero_based() > current_line);
                let inc = gn.lines.zero_based() - current_line;
                writer.splat_byte_all(b';', usize::try_from(inc).expect("int cast"))?;
                current_line = gn.lines.zero_based();
                last_col = 0;
            } else if i != 0 {
                writer.write_byte(b',')?;
            }
            writer.write_all(VLQ::encode(gn.columns.zero_based() - last_col).slice())?;
            last_col = gn.columns.zero_based();
            writer.write_all(VLQ::encode(*source_index - last_src).slice())?;
            last_src = *source_index;
            writer.write_all(VLQ::encode(orig.lines.zero_based() - last_ol).slice())?;
            last_ol = orig.lines.zero_based();
            writer.write_all(VLQ::encode(orig.columns.zero_based() - last_oc).slice())?;
            last_oc = orig.columns.zero_based();
        }
        Ok(())
    }

    pub fn format_vlqs(&self) -> VlqsFmt<'_> {
        VlqsFmt(self)
    }
}

// PORT NOTE: Zig `deinit` conditionally skipped freeing `internal` when
// `is_standalone_module_graph` (the blob borrows bytes from the standalone
// module graph section). The current `InternalSourceMap` stub has no Drop, so
// the conditional is a no-op. When `InternalSourceMap.rs` is un-gated, retype
// the field to `Option<core::mem::ManuallyDrop<InternalSourceMap>>` and drop
// it explicitly only when `!is_standalone_module_graph` — do NOT use
// `mem::forget` (PORTING.md §Forbidden).
// `mappings` and `external_source_names` are dropped automatically.

pub struct VlqsFmt<'a>(&'a ParsedSourceMap);

impl<'a> fmt::Display for VlqsFmt<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut adapter = bun_io::FmtAdapter::new(f);
        self.0.write_vlqs(&mut adapter).map_err(|_| fmt::Error)
    }
}

// ported from: src/sourcemap/ParsedSourceMap.zig

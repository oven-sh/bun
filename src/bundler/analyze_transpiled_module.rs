use core::ffi::{CStr, c_char};
use core::mem::size_of;

use bun_core::{self, err, slice_as_bytes};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from the printer crate
//
// `js_printer` is the sole *producer* of ModuleInfo records (it walks the AST
// during printing); the bundler/runtime only consume the resulting bytes. The
// canonical builder type therefore lives in `bun_js_printer` (moved down to
// bun_js_printer), and is re-exported here so that bundler-side callers — which
// thread a `&mut ModuleInfo` into `js_printer::Options { module_info }` — see
// the *same* nominal type. The duplicate that used to live in this file caused
// `expected ModuleInfo, found analyze_transpiled_module::ModuleInfo` (E0308) at
// the print boundary.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_js_printer::analyze_transpiled_module::{
    FetchParameters, ModuleInfo, StringID, VarKind,
};

/// Downstream name for `FetchParameters` — mirrors how
/// `ModuleInfoDeserialized.requested_modules_values` is consumed in
/// `bundler_jsc::analyze_jsc::to_js_module_record`.
pub type RequestedModuleValue = FetchParameters;

/// Legacy name used by `linker_context::postProcessJSChunk` — the Zig side
/// renamed `ImportAttributes` → `FetchParameters` but the bundler call site
/// still spells `ImportAttributes::None`.
pub type ImportAttributes = FetchParameters;

// ──────────────────────────────────────────────────────────────────────────
// RecordKind
// ──────────────────────────────────────────────────────────────────────────

/// Non-exhaustive `enum(u8)` in Zig — any byte value is representable, so model
/// as a transparent newtype with associated consts (a `#[repr(u8)] enum` would
/// be UB for unknown discriminants read out of the serialized buffer).
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct RecordKind(pub u8);
// SAFETY: `#[repr(transparent)]` over `u8` — no padding, every bit pattern is
// a valid `u8` (Zig modeled this as a non-exhaustive `enum(u8)`). `Pod` lets
// `bytemuck::{cast_slice,try_cast_slice}` reinterpret byte buffers and the
// printer-crate `#[repr(u8)]` enum into `&[RecordKind]` without `unsafe`.
unsafe impl bytemuck::Zeroable for RecordKind {}
unsafe impl bytemuck::Pod for RecordKind {}

impl RecordKind {
    /// var_name
    pub const DECLARED_VARIABLE: Self = Self(0);
    /// let_name
    pub const LEXICAL_VARIABLE: Self = Self(1);
    /// module_name, import_name, local_name
    pub const IMPORT_INFO_SINGLE: Self = Self(2);
    /// module_name, import_name, local_name
    pub const IMPORT_INFO_SINGLE_TYPE_SCRIPT: Self = Self(3);
    /// module_name, import_name = '*', local_name
    pub const IMPORT_INFO_NAMESPACE: Self = Self(4);
    /// export_name, import_name, module_name
    pub const EXPORT_INFO_INDIRECT: Self = Self(5);
    /// export_name, local_name, padding (for local => indirect conversion)
    pub const EXPORT_INFO_LOCAL: Self = Self(6);
    /// export_name, module_name
    pub const EXPORT_INFO_NAMESPACE: Self = Self(7);
    /// module_name
    pub const EXPORT_INFO_STAR: Self = Self(8);

    // PascalCase aliases — `bundler_jsc::analyze_jsc` pattern-matches on these
    // (the SCREAMING_CASE consts above are kept for intra-crate use).
    pub const DeclaredVariable: Self = Self::DECLARED_VARIABLE;
    pub const LexicalVariable: Self = Self::LEXICAL_VARIABLE;
    pub const ImportInfoSingle: Self = Self::IMPORT_INFO_SINGLE;
    pub const ImportInfoSingleTypeScript: Self = Self::IMPORT_INFO_SINGLE_TYPE_SCRIPT;
    pub const ImportInfoNamespace: Self = Self::IMPORT_INFO_NAMESPACE;
    pub const ExportInfoIndirect: Self = Self::EXPORT_INFO_INDIRECT;
    pub const ExportInfoLocal: Self = Self::EXPORT_INFO_LOCAL;
    pub const ExportInfoNamespace: Self = Self::EXPORT_INFO_NAMESPACE;
    pub const ExportInfoStar: Self = Self::EXPORT_INFO_STAR;

    pub fn len(self) -> Result<usize, bun_core::Error> {
        match self {
            Self::DECLARED_VARIABLE | Self::LEXICAL_VARIABLE => Ok(1),
            Self::IMPORT_INFO_SINGLE => Ok(3),
            Self::IMPORT_INFO_SINGLE_TYPE_SCRIPT => Ok(3),
            Self::IMPORT_INFO_NAMESPACE => Ok(3),
            Self::EXPORT_INFO_INDIRECT => Ok(3),
            Self::EXPORT_INFO_LOCAL => Ok(3),
            Self::EXPORT_INFO_NAMESPACE => Ok(2),
            Self::EXPORT_INFO_STAR => Ok(1),
            _ => Err(err!("InvalidRecordKind")),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Flags
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub struct Flags: u8 {
        const CONTAINS_IMPORT_META = 1 << 0;
        const IS_TYPESCRIPT        = 1 << 1;
        const HAS_TLA              = 1 << 2;
        // _padding: u5 = 0
    }
}

impl Flags {
    /// Zig: `Flags.contains_import_meta` packed-struct field. Exposed as a
    /// method so downstream callers (e.g. `bundler_jsc::analyze_jsc`) can read
    /// the bit without depending on the bitflags const name.
    #[inline]
    pub const fn contains_import_meta(self) -> bool {
        self.contains(Flags::CONTAINS_IMPORT_META)
    }
    /// Zig: `Flags.is_typescript` packed-struct field.
    #[inline]
    pub const fn is_typescript(self) -> bool {
        self.contains(Flags::IS_TYPESCRIPT)
    }
    /// Zig: `Flags.has_tla` packed-struct field.
    #[inline]
    pub const fn has_tla(self) -> bool {
        self.contains(Flags::HAS_TLA)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ModuleInfoDeserialized
// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ModuleInfoError {
    #[error("BadModuleInfo")]
    BadModuleInfo,
}
bun_core::named_error_set!(ModuleInfoError);

/// All slice fields are **self-referential** views into `owner`
/// (`Owner::AllocatedSlice`) or into the parent `ModuleInfo`'s `Vec` storage
/// (`Owner::ModuleInfo`). They are stored as [`bun_ptr::RawSlice`] (raw fat
/// pointers) because Rust references cannot express the self-borrow.
///
/// Alignment: the on-disk format pads every multi-byte field to a 4-byte
/// offset, and [`Self::create`] allocates the backing buffer with 4-byte
/// alignment ([`MODULE_INFO_ALIGN`]), so every `RawSlice<T>` here is properly
/// aligned for `T` and `.slice()` is sound. (Zig used `[]align(1) const T`
/// because its allocator didn't guarantee the base; we do instead.)
pub struct ModuleInfoDeserialized {
    pub strings_buf: bun_ptr::RawSlice<u8>,
    pub strings_lens: bun_ptr::RawSlice<u32>,
    pub requested_modules_keys: bun_ptr::RawSlice<StringID>,
    pub requested_modules_values: bun_ptr::RawSlice<FetchParameters>,
    pub buffer: bun_ptr::RawSlice<StringID>,
    pub record_kinds: bun_ptr::RawSlice<RecordKind>,
    pub flags: Flags,
    pub owner: Owner,
}

pub enum Owner {
    /// `Box<ModuleInfo>` whose internal vectors back the raw slice fields.
    ModuleInfo(*mut ModuleInfo),
    AllocatedSlice {
        /// [`MODULE_INFO_ALIGN`]-aligned heap slice from [`dupe_aligned`];
        /// freed in `deinit` via [`free_aligned_dup`].
        slice: *mut [u8],
    },
}

impl ModuleInfoDeserialized {
    // ── safe accessors ───────────────────────────────────────────────────
    // All slice fields are non-null self-referential views into `self.owner`
    // (see struct docs). They are initialized in every constructor (`create` /
    // `into_deserialized`), the backing allocation is immutable and outlives
    // `&self`, and no `&mut` alias to that storage is ever handed out — so
    // materialising `&[T]` for `'_ self` (via `RawSlice::slice`) is sound.
    //
    // Alignment: every constructor guarantees each view is aligned for its
    // element type — `create` allocates a `MODULE_INFO_ALIGN`-aligned buffer
    // and `bytes_as_slice` rejects misaligned sub-slices; `into_deserialized`
    // borrows from typed `Vec<T>` storage which is naturally aligned.

    #[inline]
    pub fn strings_buf(&self) -> &[u8] {
        self.strings_buf.slice()
    }
    #[inline]
    pub fn strings_lens(&self) -> &[u32] {
        self.strings_lens.slice()
    }
    #[inline]
    pub fn requested_modules_keys(&self) -> &[StringID] {
        self.requested_modules_keys.slice()
    }
    #[inline]
    pub fn requested_modules_values(&self) -> &[FetchParameters] {
        self.requested_modules_values.slice()
    }
    #[inline]
    pub fn buffer(&self) -> &[StringID] {
        self.buffer.slice()
    }
    #[inline]
    pub fn record_kinds(&self) -> &[RecordKind] {
        self.record_kinds.slice()
    }

    /// Consumes the heap allocation containing `self` (and, for
    /// `Owner::ModuleInfo`, the enclosing `ModuleInfo`). Not `Drop` because it
    /// deallocates the object itself and is invoked across FFI on a raw `*mut`.
    ///
    /// # Safety
    /// `this` must have been produced by [`Self::create`] (heap box) or by
    /// [`ModuleInfoExt::into_deserialized`].
    pub unsafe fn deinit(this: *mut ModuleInfoDeserialized) {
        // SAFETY: caller contract — see fn doc above.
        unsafe {
            match (*this).owner {
                Owner::ModuleInfo(mi) => {
                    // PORT NOTE: Zig recovered the parent via
                    // `@fieldParentPtr("_deserialized", self)`. The Rust port
                    // stores the `*mut ModuleInfo` directly because the printer
                    // crate's `ModuleInfo` no longer embeds this struct.
                    drop(bun_core::heap::take(mi));
                    drop(bun_core::heap::take(this));
                }
                Owner::AllocatedSlice { slice } => {
                    free_aligned_dup(slice);
                    drop(bun_core::heap::take(this));
                }
            }
        }
    }

    #[inline]
    fn eat<'a>(rem: &mut &'a [u8], len: usize) -> Result<&'a [u8], ModuleInfoError> {
        if rem.len() < len {
            return Err(ModuleInfoError::BadModuleInfo);
        }
        let res = &rem[..len];
        *rem = &rem[len..];
        Ok(res)
    }

    #[inline]
    fn eat_c<'a, const N: usize>(rem: &mut &'a [u8]) -> Result<&'a [u8; N], ModuleInfoError> {
        let (head, tail) = rem
            .split_first_chunk::<N>()
            .ok_or(ModuleInfoError::BadModuleInfo)?;
        *rem = tail;
        Ok(head)
    }

    pub fn create(source: &[u8]) -> Result<Box<ModuleInfoDeserialized>, ModuleInfoError> {
        // Copy into a `MODULE_INFO_ALIGN`-aligned buffer so the typed
        // sub-slices below (whose offsets the format pads to 4 bytes) are
        // properly aligned for `&[T]` materialisation.
        let duped_raw: *mut [u8] = dupe_aligned(source);
        // On error, reclaim the allocation.
        let guard = scopeguard::guard(duped_raw, |p| unsafe { free_aligned_dup(p) });

        // SAFETY: `duped_raw` is a valid, exclusively-owned allocation.
        let mut rem: &[u8] = unsafe { &*duped_raw };

        let record_kinds_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let record_kinds = bytes_as_slice::<RecordKind>(Self::eat(
            &mut rem,
            record_kinds_len as usize * size_of::<RecordKind>(),
        )?)?;
        let _ = Self::eat(&mut rem, ((4 - (record_kinds_len % 4)) % 4) as usize)?; // alignment padding

        let buffer_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let buffer = bytes_as_slice::<StringID>(Self::eat(
            &mut rem,
            buffer_len as usize * size_of::<StringID>(),
        )?)?;

        let requested_modules_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let requested_modules_keys = bytes_as_slice::<StringID>(Self::eat(
            &mut rem,
            requested_modules_len as usize * size_of::<StringID>(),
        )?)?;
        let requested_modules_values = bytes_as_slice::<FetchParameters>(Self::eat(
            &mut rem,
            requested_modules_len as usize * size_of::<FetchParameters>(),
        )?)?;

        let flags = Flags::from_bits_retain(Self::eat_c::<1>(&mut rem)?[0]);
        let _ = Self::eat(&mut rem, 3)?; // alignment padding

        let strings_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let strings_lens = bytes_as_slice::<u32>(Self::eat(
            &mut rem,
            strings_len as usize * size_of::<u32>(),
        )?)?;
        let strings_buf: &[u8] = rem;

        // Disarm the errdefer: ownership moves into the result.
        let duped_raw = scopeguard::ScopeGuard::into_inner(guard);

        // All six views borrow `duped_raw` (the boxed allocation moved into
        // `owner` below); they stay valid and at a stable address for the
        // lifetime of every `RawSlice` copied from this struct. `RawSlice::new`
        // erases the borrow lifetime — the structural invariant is upheld by
        // `owner` outliving the views.
        Ok(Box::new(ModuleInfoDeserialized {
            strings_buf: bun_ptr::RawSlice::new(strings_buf),
            strings_lens: bun_ptr::RawSlice::new(strings_lens),
            requested_modules_keys: bun_ptr::RawSlice::new(requested_modules_keys),
            requested_modules_values: bun_ptr::RawSlice::new(requested_modules_values),
            buffer: bun_ptr::RawSlice::new(buffer),
            record_kinds: bun_ptr::RawSlice::new(record_kinds),
            flags,
            owner: Owner::AllocatedSlice { slice: duped_raw },
        }))
    }

    /// Wrapper around `create` for use when loading from a cache (transpiler
    /// cache or standalone module graph). Returns `None` instead of panicking on
    /// corrupt/truncated data.
    pub fn create_from_cached_record(source: &[u8]) -> Option<Box<ModuleInfoDeserialized>> {
        // PORT NOTE: Zig matched on error.OutOfMemory → bun.outOfMemory(); in
        // Rust, allocation failure aborts via the global arena, so only
        // BadModuleInfo remains.
        match Self::create(source) {
            Ok(v) => Some(v),
            Err(ModuleInfoError::BadModuleInfo) => None,
        }
    }

    pub fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let record_kinds = self.record_kinds();
        writer.write_all(&(record_kinds.len() as u32).to_le_bytes())?;
        writer.write_all(slice_as_bytes(record_kinds))?;
        let pad = (4 - (record_kinds.len() % 4)) % 4;
        writer.write_all(&[0u8; 4][..pad])?; // alignment padding

        let buffer = self.buffer();
        writer.write_all(&(buffer.len() as u32).to_le_bytes())?;
        writer.write_all(slice_as_bytes(buffer))?;

        let rm_keys = self.requested_modules_keys();
        writer.write_all(&(rm_keys.len() as u32).to_le_bytes())?;
        writer.write_all(slice_as_bytes(rm_keys))?;
        writer.write_all(slice_as_bytes(self.requested_modules_values()))?;

        writer.write_all(&[self.flags.bits()])?;
        writer.write_all(&[0u8; 3])?; // alignment padding

        let strings_lens = self.strings_lens();
        writer.write_all(&(strings_lens.len() as u32).to_le_bytes())?;
        writer.write_all(slice_as_bytes(strings_lens))?;
        writer.write_all(self.strings_buf())?;
        Ok(())
    }
}

/// Maximum element alignment appearing in the serialized format
/// (`u32` / `StringID` / `FetchParameters`). The writer pads every multi-byte
/// field to this boundary, and [`dupe_aligned`] allocates the backing buffer
/// at this alignment, so every typed sub-slice is properly aligned.
const MODULE_INFO_ALIGN: usize = core::mem::align_of::<u32>();

// Compile-time guard: if a wider element type is ever added to the format,
// bump `MODULE_INFO_ALIGN` accordingly.
const _: () = {
    assert!(core::mem::align_of::<StringID>() <= MODULE_INFO_ALIGN);
    assert!(core::mem::align_of::<FetchParameters>() <= MODULE_INFO_ALIGN);
    assert!(core::mem::align_of::<RecordKind>() <= MODULE_INFO_ALIGN);
};

/// Allocate a [`MODULE_INFO_ALIGN`]-aligned copy of `source`.
/// Paired with [`free_aligned_dup`].
fn dupe_aligned(source: &[u8]) -> *mut [u8] {
    if source.is_empty() {
        // Non-null, well-aligned, len-0 — valid input for `&*` and for
        // `free_aligned_dup` (which no-ops on len 0).
        return core::ptr::slice_from_raw_parts_mut(MODULE_INFO_ALIGN as *mut u8, 0);
    }
    let layout = std::alloc::Layout::from_size_align(source.len(), MODULE_INFO_ALIGN)
        .expect("module-info buffer too large");
    // SAFETY: layout has non-zero size (checked above).
    let ptr = unsafe { std::alloc::alloc(layout) };
    if ptr.is_null() {
        std::alloc::handle_alloc_error(layout);
    }
    // SAFETY: `ptr` is a fresh `source.len()`-byte allocation; `source` is a
    // valid readable slice; the regions cannot overlap.
    unsafe { core::ptr::copy_nonoverlapping(source.as_ptr(), ptr, source.len()) };
    core::ptr::slice_from_raw_parts_mut(ptr, source.len())
}

/// # Safety
/// `slice` must have been returned by [`dupe_aligned`] and not yet freed.
unsafe fn free_aligned_dup(slice: *mut [u8]) {
    let len = slice.len();
    if len == 0 {
        return;
    }
    // SAFETY: caller contract — `slice` came from `dupe_aligned`, which
    // allocated with this exact layout.
    unsafe {
        std::alloc::dealloc(
            slice as *mut u8,
            std::alloc::Layout::from_size_align_unchecked(len, MODULE_INFO_ALIGN),
        );
    }
}

/// Reinterpret a byte sub-slice of the [`MODULE_INFO_ALIGN`]-aligned backing
/// buffer as `&[T]`. Returns `BadModuleInfo` if `bytes` is not aligned for `T`
/// or its length is not a multiple of `size_of::<T>()` (i.e. the format's
/// internal padding was violated).
///
/// (Zig used `std.mem.bytesAsSlice` → `[]align(1) const T`; Rust has no
/// under-aligned reference type, so we guarantee alignment instead via
/// `bytemuck::try_cast_slice`, which checks both alignment and size.)
#[inline]
fn bytes_as_slice<T: bytemuck::AnyBitPattern>(bytes: &[u8]) -> Result<&[T], ModuleInfoError> {
    bytemuck::try_cast_slice(bytes).map_err(|_| ModuleInfoError::BadModuleInfo)
}

// ──────────────────────────────────────────────────────────────────────────
// Extension shims over the printer-crate types
// ──────────────────────────────────────────────────────────────────────────

/// Extension constructor: `StringID::from_raw(u32)` — used by
/// `linker_context::generateChunksInParallel` when rewriting cross-chunk
/// specifier IDs.
pub trait StringIDExt {
    fn from_raw(raw: u32) -> StringID;
}
impl StringIDExt for StringID {
    #[inline]
    fn from_raw(raw: u32) -> StringID {
        StringID(raw)
    }
}

/// Bridges the printer-crate `ModuleInfo` to the raw-pointer FFI
/// `ModuleInfoDeserialized` view kept in this crate.
pub trait ModuleInfoExt {
    /// # Safety
    /// `this` must originate from `heap::alloc(ModuleInfo::create(..))`.
    unsafe fn destroy_raw(this: *mut ModuleInfo);
    /// Finalize and box the raw-pointer `ModuleInfoDeserialized` view, taking
    /// ownership of `self`. Replaces the Zig pattern of writing into the
    /// embedded `_deserialized` field and handing out a `&mut` to it.
    fn into_deserialized(self: Box<Self>) -> Box<ModuleInfoDeserialized>;
}

impl ModuleInfoExt for ModuleInfo {
    #[inline]
    unsafe fn destroy_raw(this: *mut ModuleInfo) {
        // SAFETY: caller contract — `this` is `heap::alloc` output.
        drop(unsafe { bun_core::heap::take(this) });
    }
    fn into_deserialized(mut self: Box<Self>) -> Box<ModuleInfoDeserialized> {
        // PORT NOTE: Zig wrote a self-referential `_deserialized` view inside
        // `ModuleInfo` during `finalize()`. The Rust printer-crate `ModuleInfo`
        // exposes a borrowed `as_deserialized()` instead; here we materialise the
        // raw-pointer FFI shape and tie its lifetime to the leaked `Box<ModuleInfo>`.
        if !self.finalized {
            let _ = self.finalize();
        }
        // PORT NOTE: reshaped for borrowck — capture lifetime-erased `RawSlice`
        // views before `heap::into_raw(self)` consumes the box.
        let (strings_buf, strings_lens, rm_keys, rm_values, buffer, record_kinds, flags);
        {
            let view = self.as_deserialized();
            strings_buf = bun_ptr::RawSlice::new(view.strings_buf);
            strings_lens = bun_ptr::RawSlice::new(view.strings_lens);
            rm_keys = bun_ptr::RawSlice::new(view.requested_modules_keys);
            rm_values = bun_ptr::RawSlice::new(view.requested_modules_values);
            buffer = bun_ptr::RawSlice::new(view.buffer);
            // Printer's `RecordKind` is `#[repr(u8)] NoUninit` with the same
            // discriminant layout as this crate's `#[repr(transparent)] u8`
            // `RecordKind` (Pod) — `bytemuck::cast_slice` is the safe reinterpret.
            record_kinds =
                bun_ptr::RawSlice::new(bytemuck::cast_slice::<_, RecordKind>(view.record_kinds));
            let mut f = Flags::empty();
            f.set(Flags::CONTAINS_IMPORT_META, view.flags.contains_import_meta);
            f.set(Flags::IS_TYPESCRIPT, view.flags.is_typescript);
            f.set(Flags::HAS_TLA, view.flags.has_tla);
            flags = f;
        }
        // All six views point into the `Box<ModuleInfo>`'s vectors, moved into
        // `owner` below; they stay valid and stable for the lifetime of every
        // `RawSlice` copied from this struct.
        Box::new(ModuleInfoDeserialized {
            strings_buf,
            strings_lens,
            requested_modules_keys: rm_keys,
            requested_modules_values: rm_values,
            buffer,
            record_kinds,
            flags,
            owner: Owner::ModuleInfo(bun_core::heap::into_raw(self)),
        })
    }
}

// zig__renderDiff, zig__ModuleInfoDeserialized__toJSModuleRecord, and the
// JSModuleRecord/IdentifierArray opaques: see bun_bundler_jsc::analyze_jsc
// (Zig `comptime { _ = @import }` force-reference dropped per porting guide.)

#[unsafe(no_mangle)]
pub extern "C" fn zig__ModuleInfo__destroy(info: *mut ModuleInfo) {
    // SAFETY: C++ caller passes a pointer obtained from `ModuleInfo::create`.
    drop(unsafe { bun_core::heap::take(info) });
}

#[unsafe(no_mangle)]
pub extern "C" fn zig__ModuleInfoDeserialized__deinit(info: *mut ModuleInfoDeserialized) {
    // SAFETY: C++ caller passes a pointer obtained from `create` or
    // `ModuleInfoExt::into_deserialized`.
    unsafe { ModuleInfoDeserialized::deinit(info) }
}

#[unsafe(no_mangle)]
pub extern "C" fn zig_log(msg: *const c_char) {
    // SAFETY: caller passes a NUL-terminated C string.
    let bytes = unsafe { bun_core::ffi::cstr(msg) }.to_bytes();
    // Zig: `Output.errorWriter().print("{s}\n", .{bytes}) catch {}`.
    bun_core::Output::print_error(format_args!("{}\n", bstr::BStr::new(bytes)));
}

// ported from: src/bundler/analyze_transpiled_module.zig

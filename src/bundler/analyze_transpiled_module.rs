use core::ptr::NonNull;

use bun_core;

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
    FetchParameters, ModuleInfo, ModulePhase, StringID,
};

/// Downstream name for `FetchParameters` — mirrors how
/// `ModuleInfoDeserialized.requested_modules_values` is consumed in
/// `bundler_jsc::analyze_jsc::to_js_module_record`.
pub type RequestedModuleValue = FetchParameters;

// ──────────────────────────────────────────────────────────────────────────
// RecordKind
// ──────────────────────────────────────────────────────────────────────────

/// Any byte value is representable, so model
/// as a transparent newtype with associated consts (a `#[repr(u8)] enum` would
/// be UB for unknown discriminants read out of the serialized buffer).
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct RecordKind(pub u8);
// SAFETY: `#[repr(transparent)]` over `u8` — no padding, every bit pattern is
// a valid `u8`. `Pod` lets
// `bytemuck::{cast_slice,try_cast_slice}` reinterpret byte buffers and the
// printer-crate `#[repr(u8)]` enum into `&[RecordKind]` without `unsafe`.
unsafe impl bytemuck::Zeroable for RecordKind {}
// SAFETY: see above — `#[repr(transparent)]` over `u8`, so no padding and every
// bit pattern is valid; `RecordKind` is `Copy + 'static` with no interior refs.
unsafe impl bytemuck::Pod for RecordKind {}

impl RecordKind {
    /// module_name, import_name, local_name, fetch_parameters
    pub(crate) const IMPORT_INFO_SINGLE: Self = Self(0);
    /// module_name, import_name, local_name, fetch_parameters
    pub(crate) const IMPORT_INFO_SINGLE_TYPE_SCRIPT: Self = Self(1);
    /// module_name, import_name = '*', local_name, fetch_parameters
    pub(crate) const IMPORT_INFO_NAMESPACE: Self = Self(2);
    /// export_name, import_name, module_name, fetch_parameters
    pub(crate) const EXPORT_INFO_INDIRECT: Self = Self(3);
    /// export_name, local_name, padding, fetch_parameters (for local => indirect conversion)
    pub(crate) const EXPORT_INFO_LOCAL: Self = Self(4);
    /// export_name, module_name, fetch_parameters
    pub(crate) const EXPORT_INFO_NAMESPACE: Self = Self(5);
    /// module_name, fetch_parameters
    pub(crate) const EXPORT_INFO_STAR: Self = Self(6);
    /// module_name, import_name = '*', local_name, fetch_parameters (ModulePhase::Defer)
    pub(crate) const IMPORT_INFO_NAMESPACE_DEFER: Self = Self(7);

    // PascalCase aliases — `bundler_jsc::analyze_jsc` pattern-matches on these
    // (the SCREAMING_CASE consts above are kept for intra-crate use).
    pub const ImportInfoSingle: Self = Self::IMPORT_INFO_SINGLE;
    pub const ImportInfoSingleTypeScript: Self = Self::IMPORT_INFO_SINGLE_TYPE_SCRIPT;
    pub const ImportInfoNamespace: Self = Self::IMPORT_INFO_NAMESPACE;
    pub const ImportInfoNamespaceDefer: Self = Self::IMPORT_INFO_NAMESPACE_DEFER;
    pub const ExportInfoIndirect: Self = Self::EXPORT_INFO_INDIRECT;
    pub const ExportInfoLocal: Self = Self::EXPORT_INFO_LOCAL;
    pub const ExportInfoNamespace: Self = Self::EXPORT_INFO_NAMESPACE;
    pub const ExportInfoStar: Self = Self::EXPORT_INFO_STAR;
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
    /// Exposed as a
    /// method so downstream callers (e.g. `bundler_jsc::analyze_jsc`) can read
    /// the bit without depending on the bitflags const name.
    #[inline]
    pub const fn contains_import_meta(self) -> bool {
        self.contains(Flags::CONTAINS_IMPORT_META)
    }
    #[inline]
    pub const fn is_typescript(self) -> bool {
        self.contains(Flags::IS_TYPESCRIPT)
    }
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

/// A validated view over a serialized module record: the body bytes written
/// by `bun_js_printer::analyze_transpiled_module::ModuleInfoDeserialized::serialize_body`
/// plus the string table its ids index. `to_js_module_record` walks the body
/// in place; nothing is widened or copied.
///
/// `body` / `table` are lifetime-erased: they point either into the
/// executable's mapped section (`'static`) or into `owned`, which lives as long
/// as `self`.
pub struct ModuleInfoDeserialized {
    body: Body<'static>,
    table: ModuleInfoStringTable<'static>,
    pub flags: Flags,
    /// Backing storage for `body`/`table`: `None` when they live in the
    /// executable's mapped section — the ids then index the shared string
    /// table and identifiers come from the VM-wide slots
    /// (`Bun__VM__sharedModuleInfoIdentifiers`) rather than a per-record array.
    owned: Option<Box<[u8]>>,
}

/// The body split into its regions; every count has been bounds-checked
/// against the byte length, but ids are validated as they are read.
#[derive(Clone, Copy)]
pub struct Body<'a> {
    pub id_width: u8,
    /// `kind | fetch-kind << 3 | same-name << 6` per record.
    pub record_tags: &'a [u8],
    /// `phase | fetch-kind << 1` per requested module.
    pub requested_tags: &'a [u8],
    /// Requested-module ids, then record ids, at `id_width` bytes each.
    pub ids: &'a [u8],
}

impl<'a> Body<'a> {
    fn parse(body: &'a [u8]) -> Result<(Flags, Self), ModuleInfoError> {
        let mut r = Reader { rem: body };
        let &[flags, id_width, 0, 0] = r.bytes(4)? else {
            return Err(ModuleInfoError::BadModuleInfo);
        };
        width(id_width)?;
        let requested_count = r.u32()? as usize;
        let record_count = r.u32()? as usize;
        if requested_count.saturating_add(record_count) > r.rem.len() {
            return Err(ModuleInfoError::BadModuleInfo);
        }
        let record_tags = r.bytes(record_count)?;
        let requested_tags = r.bytes(requested_count)?;
        Ok((
            Flags::from_bits_retain(flags),
            Body {
                id_width,
                record_tags,
                requested_tags,
                ids: r.rem,
            },
        ))
    }
}

/// Reads ids off a [`Body`] in order, mapping the two sentinels back to
/// `STAR_NAMESPACE` / `STAR_DEFAULT` and rejecting anything else out of range.
pub struct IdCursor<'a> {
    rem: &'a [u8],
    width: usize,
    count: u32,
}
impl IdCursor<'_> {
    #[inline]
    pub fn next_id(&mut self) -> Result<StringID, ModuleInfoError> {
        if self.rem.len() < self.width {
            return Err(ModuleInfoError::BadModuleInfo);
        }
        let v = read_uint(self.rem, self.width);
        self.rem = &self.rem[self.width..];
        match v.checked_sub(self.count) {
            None => Ok(StringID(v)),
            Some(0) => Ok(StringID::STAR_NAMESPACE),
            Some(1) => Ok(StringID::STAR_DEFAULT),
            Some(_) => Err(ModuleInfoError::BadModuleInfo),
        }
    }
    /// A fetch-parameter slot: kinds 0..=3 are constants, 4 reads a string id.
    #[inline]
    pub fn next_fetch(&mut self, kind: u8) -> Result<FetchParameters, ModuleInfoError> {
        Ok(match kind {
            0 => FetchParameters::None,
            1 => FetchParameters::Javascript,
            2 => FetchParameters::Webassembly,
            3 => FetchParameters::Json,
            4 => match self.next_id()? {
                id if id.0 < self.count => FetchParameters(id.0),
                _ => return Err(ModuleInfoError::BadModuleInfo),
            },
            _ => return Err(ModuleInfoError::BadModuleInfo),
        })
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.rem.is_empty()
    }
}

impl ModuleInfoDeserialized {
    #[inline]
    pub fn body(&self) -> &Body<'_> {
        &self.body
    }
    #[inline]
    pub fn table(&self) -> &ModuleInfoStringTable<'_> {
        &self.table
    }
    #[inline]
    pub fn ids(&self) -> IdCursor<'_> {
        IdCursor {
            rem: self.body.ids,
            width: self.body.id_width as usize,
            count: self.table.count,
        }
    }
    /// Whether the ids index the executable's shared string table (and so
    /// the VM-wide identifier slots).
    #[inline]
    pub fn shared(&self) -> bool {
        self.owned.is_none()
    }
    /// Ids below this are strings; the rest are sentinels.
    #[inline]
    pub fn strings_count(&self) -> usize {
        self.table.count as usize
    }
    /// The WTF-8 bytes of string `id`, or `None` if out of bounds (corrupt input).
    #[inline]
    pub fn string(&self, id: u32) -> Option<&[u8]> {
        self.table.get(id)
    }

    /// Consumes the heap allocation containing `self`.
    ///
    /// # Safety
    /// `this` must have been produced by one of the constructors below.
    pub(crate) unsafe fn deinit(this: *mut ModuleInfoDeserialized) {
        // SAFETY: caller contract — see fn doc above.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// The self-contained form (a module's own string table followed by its
    /// body, as the runtime transpiler cache stores it). The bytes are copied
    /// once; the record views the copy.
    pub(crate) fn create(source: &[u8]) -> Result<Box<ModuleInfoDeserialized>, ModuleInfoError> {
        let owned: Box<[u8]> = source.into();
        // SAFETY: `owned` is moved into the returned struct and never
        // reallocated, so views into its heap buffer stay valid for `self`'s
        // lifetime; the `'static` is an erased self-borrow, not exposed.
        let bytes: &'static [u8] = unsafe { &*core::ptr::from_ref::<[u8]>(&owned) };
        let table = ModuleInfoStringTable::parse(bytes)?;
        let (flags, body) = Body::parse(&bytes[table.byte_len..])?;
        Ok(Box::new(ModuleInfoDeserialized {
            body,
            table,
            flags,
            owned: Some(owned),
        }))
    }

    /// Wrapper around `create` for use when loading from a cache. Returns
    /// `None` on corrupt/truncated data.
    pub fn create_from_cached_record(source: &[u8]) -> Option<Box<ModuleInfoDeserialized>> {
        Self::create(source).ok()
    }

    /// A body inside the executable whose ids index the string table the
    /// executable shares between all its modules (`StandaloneModuleGraph`).
    /// Nothing is copied.
    pub fn create_with_table(
        table: &ModuleInfoStringTable<'static>,
        body: &'static [u8],
    ) -> Option<Box<ModuleInfoDeserialized>> {
        let (flags, body) = Body::parse(body).ok()?;
        Some(Box::new(ModuleInfoDeserialized {
            body,
            table: *table,
            flags,
            owned: None,
        }))
    }
}

struct Reader<'a> {
    rem: &'a [u8],
}
impl<'a> Reader<'a> {
    fn bytes(&mut self, len: usize) -> Result<&'a [u8], ModuleInfoError> {
        if self.rem.len() < len {
            return Err(ModuleInfoError::BadModuleInfo);
        }
        let (head, rest) = self.rem.split_at(len);
        self.rem = rest;
        Ok(head)
    }
    fn u32(&mut self) -> Result<u32, ModuleInfoError> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
}
#[inline]
fn read_uint(b: &[u8], width: usize) -> u32 {
    match width {
        1 => b[0] as u32,
        2 => u16::from_le_bytes([b[0], b[1]]) as u32,
        _ => u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
    }
}
fn width(b: u8) -> Result<usize, ModuleInfoError> {
    match b {
        1 | 2 | 4 => Ok(b as usize),
        _ => Err(ModuleInfoError::BadModuleInfo),
    }
}

/// Borrowed view over a serialized
/// `bun_js_printer::analyze_transpiled_module::ModuleInfoStringTable`
/// (layout documented there).
#[derive(Clone, Copy)]
pub struct ModuleInfoStringTable<'a> {
    count: u32,
    offset_width: usize,
    /// `count + 1` offsets at `offset_width` bytes each.
    offsets: &'a [u8],
    buf: &'a [u8],
    /// Bytes the table occupies at the front of the slice it was parsed from.
    byte_len: usize,
}
impl<'a> ModuleInfoStringTable<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self, ModuleInfoError> {
        if bytes.is_empty() {
            return Ok(Self {
                count: 0,
                offset_width: 1,
                offsets: &[0],
                buf: &[],
                byte_len: 0,
            });
        }
        let mut r = Reader { rem: bytes };
        let &[offset_width, 0, 0, 0] = r.bytes(4)? else {
            return Err(ModuleInfoError::BadModuleInfo);
        };
        let offset_width = width(offset_width)?;
        let count = r.u32()?;
        let offsets_len = (count as usize)
            .checked_add(1)
            .and_then(|n| n.checked_mul(offset_width))
            .ok_or(ModuleInfoError::BadModuleInfo)?;
        let offsets = r.bytes(offsets_len)?;
        let total = read_uint(&offsets[offsets_len - offset_width..], offset_width) as usize;
        let buf = r.bytes(total)?;
        Ok(Self {
            count,
            offset_width,
            offsets,
            buf,
            byte_len: bytes.len() - r.rem.len(),
        })
    }
    /// `[offset, len]` of string `id` within `buf`, bounds-checked.
    #[inline]
    fn range(&self, id: u32) -> Option<[u32; 2]> {
        if id >= self.count {
            return None;
        }
        let at = id as usize * self.offset_width;
        let start = read_uint(&self.offsets[at..], self.offset_width);
        let end = read_uint(&self.offsets[at + self.offset_width..], self.offset_width);
        if start > end || end as usize > self.buf.len() {
            return None;
        }
        Some([start, end - start])
    }
    #[inline]
    pub fn get(&self, id: u32) -> Option<&'a [u8]> {
        let [offset, len] = self.range(id)?;
        Some(&self.buf[offset as usize..(offset + len) as usize])
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Extension shims over the printer-crate types
// ──────────────────────────────────────────────────────────────────────────

/// Extension constructor: `StringID::from_raw(u32)` — used by
/// `linker_context::generateChunksInParallel` when rewriting cross-chunk
/// specifier IDs.
pub(crate) trait StringIDExt {
    fn from_raw(raw: u32) -> StringID;
}
impl StringIDExt for StringID {
    #[inline]
    fn from_raw(raw: u32) -> StringID {
        StringID(raw)
    }
}

/// Bridges the printer-crate `ModuleInfo` builder to the serialized view
/// JSC consumes.
pub trait ModuleInfoExt {
    /// Finalize and box the raw-pointer `ModuleInfoDeserialized` view, taking
    /// ownership of `self`.
    fn into_deserialized(self: Box<Self>) -> Box<ModuleInfoDeserialized>;
}

impl ModuleInfoExt for ModuleInfo {
    fn into_deserialized(mut self: Box<Self>) -> Box<ModuleInfoDeserialized> {
        let bytes = bun_js_printer::serialize_module_info(Some(&mut self))
            .expect("finalize cannot fail after printing");
        ModuleInfoDeserialized::create(&bytes).expect("just serialized")
    }
}

// zig__renderDiff, zig__ModuleInfoDeserialized__toJSModuleRecord, and the
// JSModuleRecord/IdentifierArray opaques: see bun_bundler_jsc::analyze_jsc

#[unsafe(no_mangle)]
extern "C" fn zig__ModuleInfoDeserialized__deinit(info: *mut ModuleInfoDeserialized) {
    // SAFETY: C++ caller passes a non-null pointer obtained from `create` or
    // `ModuleInfoExt::into_deserialized`.
    let info = unsafe { NonNull::new(info).unwrap_unchecked() };
    // SAFETY: `info` is a valid, exclusively-owned pointer; `deinit` is its only destructor.
    unsafe { ModuleInfoDeserialized::deinit(info.as_ptr()) }
}

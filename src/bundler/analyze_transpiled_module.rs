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

    pub fn len(self) -> crate::Result<usize> {
        match self {
            Self::IMPORT_INFO_SINGLE => Ok(4),
            Self::IMPORT_INFO_SINGLE_TYPE_SCRIPT => Ok(4),
            Self::IMPORT_INFO_NAMESPACE => Ok(4),
            Self::IMPORT_INFO_NAMESPACE_DEFER => Ok(4),
            Self::EXPORT_INFO_INDIRECT => Ok(4),
            Self::EXPORT_INFO_LOCAL => Ok(4),
            Self::EXPORT_INFO_NAMESPACE => Ok(3),
            Self::EXPORT_INFO_STAR => Ok(2),
            _ => Err(crate::Error::InvalidRecordKind),
        }
    }

    /// Number of trailing slots holding a bitcast `FetchParameters` rather
    /// than a `StringID`. Every record kind has exactly one trailing FP slot.
    pub fn trailing_fetch_parameters_slots(self) -> usize {
        1
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

/// All slice fields are **self-referential** views into `owner`
/// (`Owner::Decoded`'s boxed slices) or into the parent `ModuleInfo`'s `Vec`
/// storage (`Owner::ModuleInfo`). They are stored as [`bun_ptr::RawSlice`] (raw fat
/// pointers) because Rust references cannot express the self-borrow.
///
pub struct ModuleInfoDeserialized {
    /// When the ids index the executable's shared module-info string table:
    /// that table. Identifiers then come from the VM-wide slots
    /// (`Bun__VM__moduleInfoIdentifiers`), filled on first use, and
    /// `strings_buf` / `string_ranges` are empty.
    pub(crate) shared_table: Option<ModuleInfoStringTable<'static>>,
    /// Base the `string_ranges` offsets index: the decoded copy of a module's
    /// own table, or the live `ModuleInfo`'s string buffer.
    pub(crate) strings_buf: bun_ptr::RawSlice<u8>,
    /// `(offset, len)` into `strings_buf` per local string id.
    pub(crate) string_ranges: bun_ptr::RawSlice<[u32; 2]>,
    pub(crate) requested_modules_keys: bun_ptr::RawSlice<StringID>,
    pub(crate) requested_modules_values: bun_ptr::RawSlice<FetchParameters>,
    pub(crate) requested_modules_phases: bun_ptr::RawSlice<u8>,
    pub(crate) buffer: bun_ptr::RawSlice<StringID>,
    pub(crate) record_kinds: bun_ptr::RawSlice<RecordKind>,
    pub flags: Flags,
    pub(crate) owner: Owner,
}

pub enum Owner {
    /// `Box<ModuleInfo>` whose internal vectors back the raw slice fields,
    /// plus the `string_ranges` derived from its length list.
    ModuleInfo(*mut ModuleInfo, Box<[[u32; 2]]>),
    /// Decoded from the wire format by [`ModuleInfoDeserialized::create`].
    Decoded(Box<Decoded>),
}

/// The fixed-width in-memory layout the wire format decodes into: one `u32`
/// arena (`[string ranges | requested keys | requested values | buffer]`) and
/// one byte arena (`[record_kinds | requested phases | strings?]` — the string
/// bytes only when the table they came from does not outlive the record).
pub struct Decoded {
    words: Box<[u32]>,
    bytes: Box<[u8]>,
}

impl Drop for ModuleInfoDeserialized {
    fn drop(&mut self) {
        if let Owner::ModuleInfo(mi, _) = self.owner {
            // SAFETY: `owner` is the unique owner of the leaked `Box<ModuleInfo>`.
            drop(unsafe { bun_core::heap::take(mi) });
        }
    }
}

impl ModuleInfoDeserialized {
    // ── safe accessors ───────────────────────────────────────────────────
    // All slice fields are non-null self-referential views into `self.owner`
    // (see struct docs). They are initialized in every constructor (`create` /
    // `into_deserialized`), the backing allocation is immutable and outlives
    // `&self`, and no `&mut` alias to that storage is ever handed out — so
    // materialising `&[T]` for `'_ self` (via `RawSlice::slice`) is sound.
    //
    // Both constructors borrow from typed `Vec<T>` / `Box<[T]>` storage,
    // which is naturally aligned.

    /// Ids below this are strings; the rest are sentinels.
    #[inline]
    pub fn strings_count(&self) -> usize {
        match &self.shared_table {
            Some(table) => table.count as usize,
            None => self.string_ranges.len(),
        }
    }
    #[inline]
    pub fn shared_table(&self) -> Option<&ModuleInfoStringTable<'static>> {
        self.shared_table.as_ref()
    }
    /// The WTF-8 bytes of string `id`, or `None` if out of bounds (corrupt input).
    #[inline]
    pub fn string(&self, id: usize) -> Option<&[u8]> {
        if let Some(table) = &self.shared_table {
            return table.get(u32::try_from(id).ok()?);
        }
        let [offset, len] = *self.string_ranges.slice().get(id)?;
        self.strings_buf
            .slice()
            .get(offset as usize..offset as usize + len as usize)
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
    pub fn requested_modules_phases(&self) -> &[u8] {
        self.requested_modules_phases.slice()
    }
    #[inline]
    pub fn buffer(&self) -> &[StringID] {
        self.buffer.slice()
    }
    #[inline]
    pub fn record_kinds(&self) -> &[RecordKind] {
        self.record_kinds.slice()
    }

    /// Consumes the heap allocation containing `self`.
    ///
    /// # Safety
    /// `this` must have been produced by [`Self::create`] (heap box) or by
    /// [`ModuleInfoExt::into_deserialized`].
    pub(crate) unsafe fn deinit(this: *mut ModuleInfoDeserialized) {
        // SAFETY: caller contract — see fn doc above.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// Decodes the self-contained form (a module's own string table followed
    /// by its body, as the runtime transpiler cache stores it).
    pub(crate) fn create(source: &[u8]) -> Result<Box<ModuleInfoDeserialized>, ModuleInfoError> {
        let table = ModuleInfoStringTable::parse(source)?;
        let body = &source[table.byte_len..];
        Self::decode(&table, None, body)
    }

    /// Decodes a body whose ids index `table`, the string table an executable
    /// shares between all its modules (`StandaloneModuleGraph`). The record
    /// keeps the table's ids and references its bytes in place.
    pub fn create_with_table(
        table: &ModuleInfoStringTable<'static>,
        body: &[u8],
    ) -> Option<Box<ModuleInfoDeserialized>> {
        Self::decode(table, Some(*table), body).ok()
    }

    /// Widens the body wire format written by
    /// `bun_js_printer::analyze_transpiled_module::ModuleInfoDeserialized::serialize_body`
    /// (layout documented there) into the fixed `u32` layout
    /// `to_js_module_record` reads: one `u32` arena
    /// `[string ranges? | requested keys | requested values | buffer]` and one
    /// byte arena `[record_kinds | requested phases | strings?]` — the string
    /// ranges and bytes only when the table is the module's own (it does not
    /// outlive `body`); with a `shared_table` the ids are left as they are.
    fn decode(
        table: &ModuleInfoStringTable<'_>,
        shared_table: Option<ModuleInfoStringTable<'static>>,
        body: &[u8],
    ) -> Result<Box<ModuleInfoDeserialized>, ModuleInfoError> {
        use ModuleInfoError::BadModuleInfo;
        let mut r = Reader { rem: body };
        let &[flags, id_width, 0, 0] = r.bytes(4)? else {
            return Err(BadModuleInfo);
        };
        let flags = Flags::from_bits_retain(flags);
        let id_width = width(id_width)?;
        let requested_count = r.u32()? as usize;
        let record_count = r.u32()? as usize;
        // Every counted item takes at least one byte below; reject headers
        // that would over-allocate before reading anything.
        if requested_count + record_count > r.rem.len() {
            return Err(BadModuleInfo);
        }
        let record_tags = r.bytes(record_count)?;
        let requested_tags = r.bytes(requested_count)?;
        let mut buffer_len = 0usize;
        for &tag in record_tags {
            buffer_len += RecordKind(tag & 0b111).len().map_err(|_| BadModuleInfo)?;
        }

        struct Ids {
            table_count: u32,
            id_width: usize,
        }
        impl Ids {
            fn id(&mut self, r: &mut Reader<'_>) -> Result<u32, ModuleInfoError> {
                let v = r.uint(self.id_width)?;
                Ok(match v.checked_sub(self.table_count) {
                    None => v,
                    Some(0) => StringID::STAR_NAMESPACE.0,
                    Some(1) => StringID::STAR_DEFAULT.0,
                    Some(_) => return Err(ModuleInfoError::BadModuleInfo),
                })
            }
            fn fetch(&mut self, r: &mut Reader<'_>, kind: u8) -> Result<u32, ModuleInfoError> {
                Ok(match kind {
                    0 => FetchParameters::None.0,
                    1 => FetchParameters::Javascript.0,
                    2 => FetchParameters::Webassembly.0,
                    3 => FetchParameters::Json.0,
                    4 => self.id(r)?,
                    _ => return Err(ModuleInfoError::BadModuleInfo),
                })
            }
        }
        let table_count = table.count;
        let mut ids = Ids {
            table_count,
            id_width,
        };
        let mut words: Vec<u32> = Vec::with_capacity(2 * requested_count + buffer_len);
        // requested keys, then values
        words.resize(2 * requested_count, 0);
        for (n, &tag) in requested_tags.iter().enumerate() {
            if tag >> 1 > 4 {
                return Err(BadModuleInfo);
            }
            words[n] = ids.id(&mut r)?;
            words[requested_count + n] = ids.fetch(&mut r, tag >> 1)?;
        }
        for &tag in record_tags {
            let kind = RecordKind(tag & 0b111);
            let same_name = tag & (1 << 6) != 0;
            match kind {
                RecordKind::IMPORT_INFO_SINGLE | RecordKind::IMPORT_INFO_SINGLE_TYPE_SCRIPT => {
                    let module_name = ids.id(&mut r)?;
                    let import_name = ids.id(&mut r)?;
                    let local_name = if same_name {
                        import_name
                    } else {
                        ids.id(&mut r)?
                    };
                    words.extend([module_name, import_name, local_name]);
                }
                RecordKind::IMPORT_INFO_NAMESPACE | RecordKind::IMPORT_INFO_NAMESPACE_DEFER => {
                    let module_name = ids.id(&mut r)?;
                    words.extend([module_name, StringID::STAR_NAMESPACE.0, ids.id(&mut r)?]);
                }
                RecordKind::EXPORT_INFO_INDIRECT => {
                    let export_name = ids.id(&mut r)?;
                    let import_name = ids.id(&mut r)?;
                    words.extend([export_name, import_name, ids.id(&mut r)?]);
                }
                RecordKind::EXPORT_INFO_LOCAL => {
                    let export_name = ids.id(&mut r)?;
                    words.extend([export_name, ids.id(&mut r)?, u32::MAX]);
                }
                RecordKind::EXPORT_INFO_NAMESPACE => {
                    let export_name = ids.id(&mut r)?;
                    words.extend([export_name, ids.id(&mut r)?]);
                }
                RecordKind::EXPORT_INFO_STAR => words.push(ids.id(&mut r)?),
                _ => return Err(BadModuleInfo),
            }
            words.push(ids.fetch(&mut r, (tag >> 3) & 0b111)?);
        }
        if !r.rem.is_empty() {
            return Err(BadModuleInfo);
        }
        debug_assert_eq!(words.len(), 2 * requested_count + buffer_len);

        // A module's own table does not outlive `body`: copy its bytes and
        // build `(offset, len)` ranges. A shared table is referenced as is.
        let strings_count = if shared_table.is_some() {
            0
        } else {
            table_count as usize
        };
        let mut all_words: Vec<u32> = Vec::with_capacity(2 * strings_count + words.len());
        for id in 0..strings_count as u32 {
            let [offset, len] = table.range(id).ok_or(BadModuleInfo)?;
            all_words.extend([offset, len]);
        }
        all_words.extend_from_slice(&words);
        drop(words);
        let strings_bytes: &[u8] = if shared_table.is_some() {
            &[]
        } else {
            table.buf
        };
        let mut bytes: Vec<u8> =
            Vec::with_capacity(record_count + requested_count + strings_bytes.len());
        bytes.extend(record_tags.iter().map(|&tag| tag & 0b111));
        bytes.extend(requested_tags.iter().map(|&tag| tag & 1));
        bytes.extend_from_slice(strings_bytes);

        let decoded = Box::new(Decoded {
            words: all_words.into(),
            bytes: bytes.into(),
        });
        let (string_ranges, rest) = decoded.words.split_at(2 * strings_count);
        let (requested_keys, rest) = rest.split_at(requested_count);
        let (requested_values, buffer) = rest.split_at(requested_count);
        let (record_kinds, rest) = decoded.bytes.split_at(record_count);
        let (requested_phases, strings_buf) = rest.split_at(requested_count);
        // All views borrow the boxed `Decoded` moved into `owner` below; its two
        // heap slices stay at a stable address for the struct's lifetime.
        // `StringID` / `FetchParameters` / `RecordKind` / `[u32; 2]` are
        // plain-old-data over `u32` / `u8`, so `cast_slice` is a safe reinterpret.
        Ok(Box::new(ModuleInfoDeserialized {
            shared_table,
            strings_buf: bun_ptr::RawSlice::new(strings_buf),
            string_ranges: bun_ptr::RawSlice::new(bytemuck::cast_slice(string_ranges)),
            requested_modules_keys: bun_ptr::RawSlice::new(bytemuck::cast_slice(requested_keys)),
            requested_modules_values: bun_ptr::RawSlice::new(bytemuck::cast_slice(
                requested_values,
            )),
            requested_modules_phases: bun_ptr::RawSlice::new(requested_phases),
            buffer: bun_ptr::RawSlice::new(bytemuck::cast_slice(buffer)),
            record_kinds: bun_ptr::RawSlice::new(bytemuck::cast_slice(record_kinds)),
            flags,
            owner: Owner::Decoded(decoded),
        }))
    }

    /// Wrapper around `create` for use when loading from a cache (transpiler
    /// cache or standalone module graph). Returns `None` instead of panicking on
    /// corrupt/truncated data.
    pub fn create_from_cached_record(source: &[u8]) -> Option<Box<ModuleInfoDeserialized>> {
        // Allocation failure aborts via the global arena, so only
        // BadModuleInfo remains.
        Self::create(source).ok()
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
    fn uint(&mut self, width: usize) -> Result<u32, ModuleInfoError> {
        Ok(read_uint(self.bytes(width)?, width))
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

/// Bridges the printer-crate `ModuleInfo` to the raw-pointer FFI
/// `ModuleInfoDeserialized` view kept in this crate.
pub trait ModuleInfoExt {
    /// Finalize and box the raw-pointer `ModuleInfoDeserialized` view, taking
    /// ownership of `self`.
    fn into_deserialized(self: Box<Self>) -> Box<ModuleInfoDeserialized>;
}

impl ModuleInfoExt for ModuleInfo {
    fn into_deserialized(mut self: Box<Self>) -> Box<ModuleInfoDeserialized> {
        // The printer-crate `ModuleInfo`
        // exposes a borrowed `as_deserialized()`; here we materialise the
        // raw-pointer FFI shape and tie its lifetime to the leaked `Box<ModuleInfo>`.
        if !self.finalized {
            let _ = self.finalize();
        }
        // Reshaped for borrowck — capture lifetime-erased `RawSlice`
        // views before `heap::into_raw(self)` consumes the box.
        let (strings_buf, ranges, rm_keys, rm_values, rm_phases, buffer, record_kinds, flags);
        {
            let view = self.as_deserialized();
            strings_buf = bun_ptr::RawSlice::new(view.strings_buf);
            let mut offset = 0u32;
            ranges = view
                .strings_lens
                .iter()
                .map(|&len| {
                    let range = [offset, len];
                    offset += len;
                    range
                })
                .collect::<Box<[[u32; 2]]>>();
            rm_keys = bun_ptr::RawSlice::new(view.requested_modules_keys);
            rm_values = bun_ptr::RawSlice::new(view.requested_modules_values);
            // Printer's `ModulePhase` is `#[repr(u8)] NoUninit` — safe to view as `&[u8]`.
            rm_phases = bun_ptr::RawSlice::new(bytemuck::cast_slice::<_, u8>(
                view.requested_modules_phases,
            ));
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
        // The views point into the `Box<ModuleInfo>`'s vectors (and `ranges`), moved into
        // `owner` below; they stay valid and stable for the lifetime of every
        // `RawSlice` copied from this struct.
        Box::new(ModuleInfoDeserialized {
            shared_table: None,
            strings_buf,
            // Boxed slice: its heap address is stable across the move into `owner`.
            string_ranges: bun_ptr::RawSlice::new(&ranges),
            requested_modules_keys: rm_keys,
            requested_modules_values: rm_values,
            requested_modules_phases: rm_phases,
            buffer,
            record_kinds,
            flags,
            owner: Owner::ModuleInfo(bun_core::heap::into_raw(self), ranges),
        })
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

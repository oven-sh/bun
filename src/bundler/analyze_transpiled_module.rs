use core::ffi::{c_char, CStr};
use core::mem::size_of;

use bun_core::{self, err};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from the printer crate
//
// `js_printer` is the sole *producer* of ModuleInfo records (it walks the AST
// during printing); the bundler/runtime only consume the resulting bytes. The
// canonical builder type therefore lives in `bun_js_printer` (MOVE_DOWN per
// CYCLEBREAK), and is re-exported here so that bundler-side callers — which
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
impl From<ModuleInfoError> for bun_core::Error {
    fn from(_e: ModuleInfoError) -> Self {
        err!("BadModuleInfo")
    }
}

/// All slice fields are **self-referential** raw views into `owner`
/// (`Owner::AllocatedSlice`) or into the parent `ModuleInfo`'s `Vec` storage
/// (`Owner::ModuleInfo`). They are stored as raw fat pointers because Rust
/// references cannot express the self-borrow, and the non-`u8` element types
/// were `align(1)` slices in Zig (i.e. not naturally aligned).
///
/// TODO(port): element reads of `strings_lens` / `requested_modules_*` /
/// `buffer` must use `read_unaligned` — the backing bytes are 1-byte aligned.
pub struct ModuleInfoDeserialized {
    pub strings_buf: *const [u8],
    pub strings_lens: *const [u32],
    pub requested_modules_keys: *const [StringID],
    pub requested_modules_values: *const [FetchParameters],
    pub buffer: *const [StringID],
    pub record_kinds: *const [RecordKind],
    pub flags: Flags,
    pub owner: Owner,
}

pub enum Owner {
    /// `Box<ModuleInfo>` whose internal vectors back the raw slice fields.
    ModuleInfo(*mut ModuleInfo),
    AllocatedSlice {
        /// `Box::<[u8]>::into_raw` — freed in `deinit`.
        slice: *mut [u8],
    },
}

impl ModuleInfoDeserialized {
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
                    drop(Box::from_raw(mi));
                    drop(Box::from_raw(this));
                }
                Owner::AllocatedSlice { slice } => {
                    drop(Box::from_raw(slice));
                    drop(Box::from_raw(this));
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
        if rem.len() < N {
            return Err(ModuleInfoError::BadModuleInfo);
        }
        // SAFETY: bounds checked above; first N bytes form a [u8; N].
        let res = unsafe { &*(rem.as_ptr() as *const [u8; N]) };
        *rem = &rem[N..];
        Ok(res)
    }

    pub fn create(source: &[u8]) -> Result<Box<ModuleInfoDeserialized>, ModuleInfoError> {
        let duped: Box<[u8]> = Box::from(source);
        // Stabilize the address so the raw slice fields can borrow into it.
        let duped_raw: *mut [u8] = Box::into_raw(duped);
        // On error, reclaim the allocation.
        let guard = scopeguard::guard(duped_raw, |p| unsafe { drop(Box::from_raw(p)) });

        // SAFETY: `duped_raw` is a valid, exclusively-owned allocation.
        let mut rem: &[u8] = unsafe { &*duped_raw };

        let record_kinds_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let record_kinds = bytes_as_slice::<RecordKind>(Self::eat(
            &mut rem,
            record_kinds_len as usize * size_of::<RecordKind>(),
        )?);
        let _ = Self::eat(&mut rem, ((4 - (record_kinds_len % 4)) % 4) as usize)?; // alignment padding

        let buffer_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let buffer = bytes_as_slice::<StringID>(Self::eat(
            &mut rem,
            buffer_len as usize * size_of::<StringID>(),
        )?);

        let requested_modules_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let requested_modules_keys = bytes_as_slice::<StringID>(Self::eat(
            &mut rem,
            requested_modules_len as usize * size_of::<StringID>(),
        )?);
        let requested_modules_values = bytes_as_slice::<FetchParameters>(Self::eat(
            &mut rem,
            requested_modules_len as usize * size_of::<FetchParameters>(),
        )?);

        let flags = Flags::from_bits_retain(Self::eat_c::<1>(&mut rem)?[0]);
        let _ = Self::eat(&mut rem, 3)?; // alignment padding

        let strings_len = u32::from_le_bytes(*Self::eat_c::<4>(&mut rem)?);
        let strings_lens = bytes_as_slice::<u32>(Self::eat(
            &mut rem,
            strings_len as usize * size_of::<u32>(),
        )?);
        let strings_buf: *const [u8] = rem;

        // Disarm the errdefer: ownership moves into the result.
        let duped_raw = scopeguard::ScopeGuard::into_inner(guard);

        Ok(Box::new(ModuleInfoDeserialized {
            strings_buf,
            strings_lens,
            requested_modules_keys,
            requested_modules_values,
            buffer,
            record_kinds,
            flags,
            owner: Owner::AllocatedSlice { slice: duped_raw },
        }))
    }

    /// Wrapper around `create` for use when loading from a cache (transpiler
    /// cache or standalone module graph). Returns `None` instead of panicking on
    /// corrupt/truncated data.
    pub fn create_from_cached_record(source: &[u8]) -> Option<Box<ModuleInfoDeserialized>> {
        // PORT NOTE: Zig matched on error.OutOfMemory → bun.outOfMemory(); in
        // Rust, allocation failure aborts via the global allocator, so only
        // BadModuleInfo remains.
        match Self::create(source) {
            Ok(v) => Some(v),
            Err(ModuleInfoError::BadModuleInfo) => None,
        }
    }

    pub fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // SAFETY: all raw slice fields are valid for the lifetime of `self`
        // (they borrow from `self.owner` or the parent `ModuleInfo`).
        unsafe {
            let record_kinds = &*self.record_kinds;
            writer.write_all(&(record_kinds.len() as u32).to_le_bytes())?;
            writer.write_all(slice_as_bytes(record_kinds))?;
            let pad = (4 - (record_kinds.len() % 4)) % 4;
            writer.write_all(&[0u8; 4][..pad])?; // alignment padding

            let buffer = &*self.buffer;
            writer.write_all(&(buffer.len() as u32).to_le_bytes())?;
            writer.write_all(slice_as_bytes(buffer))?;

            let rm_keys = &*self.requested_modules_keys;
            writer.write_all(&(rm_keys.len() as u32).to_le_bytes())?;
            writer.write_all(slice_as_bytes(rm_keys))?;
            writer.write_all(slice_as_bytes(&*self.requested_modules_values))?;

            writer.write_all(&[self.flags.bits()])?;
            writer.write_all(&[0u8; 3])?; // alignment padding

            let strings_lens = &*self.strings_lens;
            writer.write_all(&(strings_lens.len() as u32).to_le_bytes())?;
            writer.write_all(slice_as_bytes(strings_lens))?;
            writer.write_all(&*self.strings_buf)?;
        }
        Ok(())
    }
}

/// Reinterpret a byte slice as `*const [T]` without alignment requirements
/// (Zig: `std.mem.bytesAsSlice` producing `[]align(1) const T`).
#[inline]
fn bytes_as_slice<T>(bytes: &[u8]) -> *const [T] {
    debug_assert!(bytes.len() % size_of::<T>() == 0);
    core::ptr::slice_from_raw_parts(bytes.as_ptr().cast::<T>(), bytes.len() / size_of::<T>())
}

/// Reinterpret `&[T]` as bytes (Zig: `std.mem.sliceAsBytes`). `T` must be POD.
#[inline]
fn slice_as_bytes<T: Copy>(s: &[T]) -> &[u8] {
    // SAFETY: T is Copy/POD with no padding for the types used here
    // (u8/u32-transparent newtypes); reading their bytes is sound.
    unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<u8>(), core::mem::size_of_val(s)) }
}

// ──────────────────────────────────────────────────────────────────────────
// Extension shims over the printer-crate types
//
// The bundler-side callers (`postProcessJSChunk`, `generateChunksInParallel`,
// `RuntimeTranspilerStore`) were written against an earlier `Result`-returning
// API. The canonical printer-crate `ModuleInfo` returns by value (allocation
// failure aborts). These extension methods preserve the old call shapes so a
// single re-export commit doesn't have to touch every call site.
// ──────────────────────────────────────────────────────────────────────────

/// Extension constructor: `StringID::from_raw(u32)`.
pub trait StringIDExt {
    fn from_raw(raw: u32) -> StringID;
}
impl StringIDExt for StringID {
    #[inline]
    fn from_raw(raw: u32) -> StringID {
        StringID(raw)
    }
}

/// `Result`-shaped wrappers over `bun_js_printer::analyze_transpiled_module::ModuleInfo`.
pub trait ModuleInfoExt {
    fn create(is_typescript: bool) -> Result<Box<ModuleInfo>, bun_alloc::AllocError>;
    /// # Safety
    /// `this` must originate from `Box::into_raw(ModuleInfo::create(..))`.
    unsafe fn destroy(this: *mut ModuleInfo);
    fn str(&mut self, value: &[u8]) -> Result<StringID, bun_alloc::AllocError>;
    fn add_var(&mut self, name: StringID, kind: VarKind) -> Result<(), bun_alloc::AllocError>;
    fn request_module(
        &mut self,
        import_record_path: StringID,
        fetch_parameters: FetchParameters,
    ) -> Result<(), bun_alloc::AllocError>;
    fn add_import_info_single(
        &mut self,
        module_name: StringID,
        import_name: StringID,
        local_name: StringID,
        only_used_as_type: bool,
    ) -> Result<(), bun_alloc::AllocError>;
    fn add_import_info_namespace(
        &mut self,
        module_name: StringID,
        local_name: StringID,
    ) -> Result<(), bun_alloc::AllocError>;
    /// Finalize and box the raw-pointer `ModuleInfoDeserialized` view, taking
    /// ownership of `self`. Replaces the Zig pattern of writing into the
    /// embedded `_deserialized` field and handing out a `&mut` to it.
    fn into_deserialized(self: Box<Self>) -> Box<ModuleInfoDeserialized>;
}

impl ModuleInfoExt for ModuleInfo {
    #[inline]
    fn create(is_typescript: bool) -> Result<Box<ModuleInfo>, bun_alloc::AllocError> {
        Ok(ModuleInfo::create(is_typescript))
    }
    #[inline]
    unsafe fn destroy(this: *mut ModuleInfo) {
        // SAFETY: caller contract — `this` is `Box::into_raw` output.
        drop(unsafe { Box::from_raw(this) });
    }
    #[inline]
    fn str(&mut self, value: &[u8]) -> Result<StringID, bun_alloc::AllocError> {
        Ok(ModuleInfo::str(self, value))
    }
    #[inline]
    fn add_var(&mut self, name: StringID, kind: VarKind) -> Result<(), bun_alloc::AllocError> {
        ModuleInfo::add_var(self, name, kind);
        Ok(())
    }
    #[inline]
    fn request_module(
        &mut self,
        import_record_path: StringID,
        fetch_parameters: FetchParameters,
    ) -> Result<(), bun_alloc::AllocError> {
        ModuleInfo::request_module(self, import_record_path, fetch_parameters);
        Ok(())
    }
    #[inline]
    fn add_import_info_single(
        &mut self,
        module_name: StringID,
        import_name: StringID,
        local_name: StringID,
        only_used_as_type: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        ModuleInfo::add_import_info_single(
            self,
            module_name,
            import_name,
            local_name,
            only_used_as_type,
        );
        Ok(())
    }
    #[inline]
    fn add_import_info_namespace(
        &mut self,
        module_name: StringID,
        local_name: StringID,
    ) -> Result<(), bun_alloc::AllocError> {
        ModuleInfo::add_import_info_namespace(self, module_name, local_name);
        Ok(())
    }
    fn into_deserialized(mut self: Box<Self>) -> Box<ModuleInfoDeserialized> {
        // PORT NOTE: Zig wrote a self-referential `_deserialized` view inside
        // `ModuleInfo` during `finalize()`. The Rust printer-crate `ModuleInfo`
        // exposes a borrowed `as_deserialized()` instead; here we materialise the
        // raw-pointer FFI shape and tie its lifetime to the leaked `Box<ModuleInfo>`.
        let _ = self.finalize();
        let view = self.as_deserialized();
        let mut flags = Flags::empty();
        flags.set(Flags::CONTAINS_IMPORT_META, view.flags.contains_import_meta);
        flags.set(Flags::IS_TYPESCRIPT, view.flags.is_typescript);
        flags.set(Flags::HAS_TLA, view.flags.has_tla);
        let res = Box::new(ModuleInfoDeserialized {
            strings_buf: view.strings_buf as *const [u8],
            strings_lens: view.strings_lens as *const [u32],
            requested_modules_keys: view.requested_modules_keys as *const [StringID],
            requested_modules_values: view.requested_modules_values as *const [FetchParameters],
            buffer: view.buffer as *const [StringID],
            // SAFETY: printer's `RecordKind` is `#[repr(u8)]` with the same
            // discriminant layout as this crate's transparent-newtype `RecordKind`.
            record_kinds: core::ptr::slice_from_raw_parts(
                view.record_kinds.as_ptr().cast::<RecordKind>(),
                view.record_kinds.len(),
            ),
            flags,
            owner: Owner::ModuleInfo(Box::into_raw(self)),
        });
        res
    }
}

// zig__renderDiff, zig__ModuleInfoDeserialized__toJSModuleRecord, and the
// JSModuleRecord/IdentifierArray opaques: see bun_bundler_jsc::analyze_jsc
// (Zig `comptime { _ = @import }` force-reference dropped per porting guide.)

#[unsafe(no_mangle)]
pub extern "C" fn zig__ModuleInfo__destroy(info: *mut ModuleInfo) {
    // SAFETY: C++ caller passes a pointer obtained from `ModuleInfo::create`.
    drop(unsafe { Box::from_raw(info) });
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
    let bytes = unsafe { CStr::from_ptr(msg) }.to_bytes();
    // Zig: `Output.errorWriter().print("{s}\n", .{bytes}) catch {}`.
    bun_core::Output::print_error(format_args!("{}\n", bstr::BStr::new(bytes)));
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/analyze_transpiled_module.zig (397 lines)
//   confidence: medium
//   todos:      4
//   notes:      ModuleInfo/StringID/VarKind/FetchParameters re-exported from bun_js_printer (canonical producer); ModuleInfoDeserialized kept local as the raw-pointer FFI view; non-u8 deserialized slices are align(1) and need read_unaligned.
// ──────────────────────────────────────────────────────────────────────────

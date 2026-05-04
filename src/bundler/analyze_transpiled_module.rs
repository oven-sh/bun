use core::ffi::{c_char, CStr};
use core::mem::{offset_of, size_of, MaybeUninit};

use bun_collections::ArrayHashMap;
use bun_core::{self, err};
use bun_str::strings;
use bun_wyhash;

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

// ──────────────────────────────────────────────────────────────────────────
// ModuleInfoDeserialized
// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ModuleInfoError {
    #[error("BadModuleInfo")]
    BadModuleInfo,
}
impl From<ModuleInfoError> for bun_core::Error {
    fn from(e: ModuleInfoError) -> Self {
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
    ModuleInfo,
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
    /// `this` must have been produced by [`Self::create`] (heap box) or be the
    /// `_deserialized` field of a `Box<ModuleInfo>` after `finalize()`.
    pub unsafe fn deinit(this: *mut ModuleInfoDeserialized) {
        match (*this).owner {
            Owner::ModuleInfo => {
                // SAFETY: `this` points to `ModuleInfo._deserialized`; recover
                // the parent via container_of (Zig: @fieldParentPtr).
                let mi = (this as *mut u8)
                    .sub(offset_of!(ModuleInfo, _deserialized))
                    .cast::<ModuleInfo>();
                ModuleInfo::destroy(mi);
            }
            Owner::AllocatedSlice { slice } => {
                drop(Box::from_raw(slice));
                drop(Box::from_raw(this));
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
// StringMapKey / StringContext
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct StringMapKey(u32);

pub struct StringContext<'a> {
    pub strings_buf: &'a [u8],
    pub strings_lens: &'a [u32],
}

impl<'a> StringContext<'a> {
    pub fn hash(&self, s: &[u8]) -> u32 {
        bun_wyhash::hash(s) as u32
    }

    pub fn eql(&self, fetch_key: &[u8], item_key: StringMapKey, item_i: usize) -> bool {
        let start = item_key.0 as usize;
        let len = self.strings_lens[item_i] as usize;
        strings::eql_long(fetch_key, &self.strings_buf[start..start + len], true)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ModuleInfo
// ──────────────────────────────────────────────────────────────────────────

pub struct ModuleInfo {
    /// all strings in wtf-8. index in hashmap = StringID
    // TODO(port): Zig uses `ArrayHashMapUnmanaged(StringMapKey, void, void, true)`
    // with an *adapted* context (`StringContext`) for lookup-by-slice. The
    // `bun_collections::ArrayHashMap` API needs an adapted-getOrPut entry point
    // to express this; placeholder key/value types kept identical.
    strings_map: ArrayHashMap<StringMapKey, ()>,
    strings_buf: Vec<u8>,
    strings_lens: Vec<u32>,
    requested_modules: ArrayHashMap<StringID, FetchParameters>,
    buffer: Vec<StringID>,
    record_kinds: Vec<RecordKind>,
    flags: Flags,
    exported_names: ArrayHashMap<StringID, ()>,
    finalized: bool,

    /// only initialized after `.finalize()` is called
    _deserialized: MaybeUninit<ModuleInfoDeserialized>,
}

/// Re-exported at module scope to mirror Zig's `ModuleInfo.FetchParameters`
/// being referenced from `ModuleInfoDeserialized` field types.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct FetchParameters(pub u32);

impl FetchParameters {
    pub const NONE: Self = Self(u32::MAX);
    pub const JAVASCRIPT: Self = Self(u32::MAX - 1);
    pub const WEBASSEMBLY: Self = Self(u32::MAX - 2);
    pub const JSON: Self = Self(u32::MAX - 3);
    // _ => host_defined: cast to StringID

    pub fn host_defined(value: StringID) -> FetchParameters {
        FetchParameters(value.0)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum VarKind {
    Declared,
    Lexical,
}

impl ModuleInfo {
    pub fn as_deserialized(&mut self) -> &mut ModuleInfoDeserialized {
        debug_assert!(self.finalized);
        // SAFETY: `finalize()` writes `_deserialized` before setting `finalized = true`.
        unsafe { self._deserialized.assume_init_mut() }
    }

    pub fn add_var(&mut self, name: StringID, kind: VarKind) -> Result<(), bun_alloc::AllocError> {
        match kind {
            VarKind::Declared => self.add_declared_variable(name),
            VarKind::Lexical => self.add_lexical_variable(name),
        }
    }

    fn _add_record(
        &mut self,
        kind: RecordKind,
        data: &[StringID],
    ) -> Result<(), bun_alloc::AllocError> {
        debug_assert!(!self.finalized);
        debug_assert!(data.len() == kind.len().expect("unreachable"));
        self.record_kinds.push(kind);
        self.buffer.extend_from_slice(data);
        Ok(())
    }

    pub fn add_declared_variable(&mut self, id: StringID) -> Result<(), bun_alloc::AllocError> {
        self._add_record(RecordKind::DECLARED_VARIABLE, &[id])
    }

    pub fn add_lexical_variable(&mut self, id: StringID) -> Result<(), bun_alloc::AllocError> {
        self._add_record(RecordKind::LEXICAL_VARIABLE, &[id])
    }

    pub fn add_import_info_single(
        &mut self,
        module_name: StringID,
        import_name: StringID,
        local_name: StringID,
        only_used_as_type: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        self._add_record(
            if only_used_as_type {
                RecordKind::IMPORT_INFO_SINGLE_TYPE_SCRIPT
            } else {
                RecordKind::IMPORT_INFO_SINGLE
            },
            &[module_name, import_name, local_name],
        )
    }

    pub fn add_import_info_namespace(
        &mut self,
        module_name: StringID,
        local_name: StringID,
    ) -> Result<(), bun_alloc::AllocError> {
        self._add_record(
            RecordKind::IMPORT_INFO_NAMESPACE,
            &[module_name, StringID::STAR_NAMESPACE, local_name],
        )
    }

    pub fn add_export_info_indirect(
        &mut self,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
    ) -> Result<(), bun_alloc::AllocError> {
        if self._has_or_add_exported_name(export_name)? {
            return Ok(()); // a syntax error will be emitted later in this case
        }
        self._add_record(
            RecordKind::EXPORT_INFO_INDIRECT,
            &[export_name, import_name, module_name],
        )
    }

    pub fn add_export_info_local(
        &mut self,
        export_name: StringID,
        local_name: StringID,
    ) -> Result<(), bun_alloc::AllocError> {
        if self._has_or_add_exported_name(export_name)? {
            return Ok(()); // a syntax error will be emitted later in this case
        }
        self._add_record(
            RecordKind::EXPORT_INFO_LOCAL,
            &[export_name, local_name, StringID(u32::MAX)],
        )
    }

    pub fn add_export_info_namespace(
        &mut self,
        export_name: StringID,
        module_name: StringID,
    ) -> Result<(), bun_alloc::AllocError> {
        if self._has_or_add_exported_name(export_name)? {
            return Ok(()); // a syntax error will be emitted later in this case
        }
        self._add_record(RecordKind::EXPORT_INFO_NAMESPACE, &[export_name, module_name])
    }

    pub fn add_export_info_star(
        &mut self,
        module_name: StringID,
    ) -> Result<(), bun_alloc::AllocError> {
        self._add_record(RecordKind::EXPORT_INFO_STAR, &[module_name])
    }

    pub fn _has_or_add_exported_name(
        &mut self,
        name: StringID,
    ) -> Result<bool, bun_alloc::AllocError> {
        // TODO(port): ArrayHashMap fetchPut equivalent
        if self.exported_names.fetch_put(name, ()).is_some() {
            return Ok(true);
        }
        Ok(false)
    }

    pub fn create(is_typescript: bool) -> Box<ModuleInfo> {
        Box::new(ModuleInfo::init(is_typescript))
    }

    fn init(is_typescript: bool) -> ModuleInfo {
        let mut flags = Flags::default();
        if is_typescript {
            flags |= Flags::IS_TYPESCRIPT;
        }
        ModuleInfo {
            strings_map: ArrayHashMap::default(),
            strings_buf: Vec::new(),
            strings_lens: Vec::new(),
            exported_names: ArrayHashMap::default(),
            requested_modules: ArrayHashMap::default(),
            buffer: Vec::new(),
            record_kinds: Vec::new(),
            flags,
            finalized: false,
            _deserialized: MaybeUninit::uninit(),
        }
    }

    // `deinit` deleted: all owned fields are `Vec`/`ArrayHashMap` and drop
    // automatically. `ModuleInfoDeserialized` holds only raw pointers (no Drop).

    /// # Safety
    /// `this` must originate from `Box::into_raw(ModuleInfo::create(..))`.
    pub unsafe fn destroy(this: *mut ModuleInfo) {
        drop(Box::from_raw(this));
    }

    pub fn str(&mut self, value: &[u8]) -> Result<StringID, bun_alloc::AllocError> {
        self.strings_buf.reserve(value.len());
        self.strings_lens.reserve(1);
        // TODO(port): `ArrayHashMap::get_or_put_adapted` taking `StringContext`
        // (hash by bytes, eql against stored offset+len). Placeholder uses a
        // hypothetical adapted API; Phase B must wire the real one.
        let gpres = self.strings_map.get_or_put_adapted(
            value,
            StringContext {
                strings_buf: &self.strings_buf,
                strings_lens: &self.strings_lens,
            },
        );
        if gpres.found_existing {
            return Ok(StringID(u32::try_from(gpres.index).unwrap()));
        }

        *gpres.key_ptr = StringMapKey(self.strings_buf.len() as u32);
        *gpres.value_ptr = ();
        // PERF(port): was appendSliceAssumeCapacity / appendAssumeCapacity
        self.strings_buf.extend_from_slice(value);
        self.strings_lens.push(value.len() as u32);
        Ok(StringID(u32::try_from(gpres.index).unwrap()))
    }

    pub fn request_module(
        &mut self,
        import_record_path: StringID,
        fetch_parameters: FetchParameters,
    ) -> Result<(), bun_alloc::AllocError> {
        // jsc only records the attributes of the first import with the given
        // import_record_path. so only put if not exists.
        let gpres = self.requested_modules.get_or_put(import_record_path);
        if !gpres.found_existing {
            *gpres.value_ptr = fetch_parameters;
        }
        Ok(())
    }

    /// Replace all occurrences of `old_id` with `new_id` in records and
    /// `requested_modules`. Used to fix up cross-chunk import specifiers after
    /// final paths are computed.
    pub fn replace_string_id(&mut self, old_id: StringID, new_id: StringID) {
        debug_assert!(!self.finalized);
        // Replace in record buffer
        for item in self.buffer.iter_mut() {
            if *item == old_id {
                *item = new_id;
            }
        }
        // Replace in requested_modules keys (preserving insertion order)
        if let Some(idx) = self.requested_modules.get_index(&old_id) {
            self.requested_modules.keys_mut()[idx] = new_id;
            // TODO(port): ArrayHashMap::re_index() equivalent; `catch {}` discarded OOM.
            let _ = self.requested_modules.re_index();
        }
    }

    /// find any exports marked as 'local' that are actually 'indirect' and fix them
    pub fn finalize(&mut self) -> Result<(), bun_alloc::AllocError> {
        debug_assert!(!self.finalized);

        #[derive(Clone, Copy)]
        struct Ip {
            module_name: StringID,
            import_name: StringID,
            record_kinds_idx: usize,
            is_namespace: bool,
        }

        let mut local_name_to_module_name: ArrayHashMap<StringID, Ip> = ArrayHashMap::default();
        {
            let mut i: usize = 0;
            for (idx, &k) in self.record_kinds.iter().enumerate() {
                if k == RecordKind::IMPORT_INFO_SINGLE
                    || k == RecordKind::IMPORT_INFO_SINGLE_TYPE_SCRIPT
                {
                    local_name_to_module_name.put(
                        self.buffer[i + 2],
                        Ip {
                            module_name: self.buffer[i],
                            import_name: self.buffer[i + 1],
                            record_kinds_idx: idx,
                            is_namespace: false,
                        },
                    );
                } else if k == RecordKind::IMPORT_INFO_NAMESPACE {
                    local_name_to_module_name.put(
                        self.buffer[i + 2],
                        Ip {
                            module_name: self.buffer[i],
                            import_name: StringID::STAR_NAMESPACE,
                            record_kinds_idx: idx,
                            is_namespace: true,
                        },
                    );
                }
                i += k.len().expect("unreachable");
            }
        }

        {
            let mut i: usize = 0;
            // PORT NOTE: reshaped for borrowck — Zig iterates `record_kinds.items`
            // by `*k` and also indexes into it via `ip.record_kinds_idx` inside
            // the loop body. Iterate by index to avoid overlapping &mut.
            for j in 0..self.record_kinds.len() {
                let k = self.record_kinds[j];
                if k == RecordKind::EXPORT_INFO_LOCAL {
                    if let Some(ip) = local_name_to_module_name.get(&self.buffer[i + 1]).copied() {
                        // `import * as z from M; export { z }` is a Namespace export per
                        // spec; encode it as indirect with import_name = STAR_NAMESPACE
                        // so the record stays the same length and toJSModuleRecord
                        // dispatches to addNamespaceExport.
                        self.record_kinds[j] = RecordKind::EXPORT_INFO_INDIRECT;
                        self.buffer[i + 1] = ip.import_name;
                        self.buffer[i + 2] = ip.module_name;
                        // In TypeScript, the re-exported import may target a type-only
                        // export that was elided. Convert the import to SingleTypeScript
                        // so JSC tolerates it being NotFound during linking.
                        if !ip.is_namespace && self.flags.contains(Flags::IS_TYPESCRIPT) {
                            self.record_kinds[ip.record_kinds_idx] =
                                RecordKind::IMPORT_INFO_SINGLE_TYPE_SCRIPT;
                        }
                    }
                }
                i += k.len().expect("unreachable");
            }
        }

        self._deserialized.write(ModuleInfoDeserialized {
            strings_buf: self.strings_buf.as_slice() as *const [u8],
            strings_lens: self.strings_lens.as_slice() as *const [u32],
            requested_modules_keys: self.requested_modules.keys() as *const [StringID],
            requested_modules_values: self.requested_modules.values() as *const [FetchParameters],
            buffer: self.buffer.as_slice() as *const [StringID],
            record_kinds: self.record_kinds.as_slice() as *const [RecordKind],
            flags: self.flags,
            owner: Owner::ModuleInfo,
        });

        self.finalized = true;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StringID
// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct StringID(pub u32);

impl StringID {
    pub const STAR_DEFAULT: Self = Self(u32::MAX);
    pub const STAR_NAMESPACE: Self = Self(u32::MAX - 1);
}

// zig__renderDiff, zig__ModuleInfoDeserialized__toJSModuleRecord, and the
// JSModuleRecord/IdentifierArray opaques: see bun_bundler_jsc::analyze_jsc
// (Zig `comptime { _ = @import }` force-reference dropped per porting guide.)

#[unsafe(no_mangle)]
pub extern "C" fn zig__ModuleInfo__destroy(info: *mut ModuleInfo) {
    // SAFETY: C++ caller passes a pointer obtained from `ModuleInfo::create`.
    unsafe { ModuleInfo::destroy(info) }
}

#[unsafe(no_mangle)]
pub extern "C" fn zig__ModuleInfoDeserialized__deinit(info: *mut ModuleInfoDeserialized) {
    // SAFETY: C++ caller passes a pointer obtained from `create` or
    // `ModuleInfo::as_deserialized`.
    unsafe { ModuleInfoDeserialized::deinit(info) }
}

#[unsafe(no_mangle)]
pub extern "C" fn zig_log(msg: *const c_char) {
    // SAFETY: caller passes a NUL-terminated C string.
    let bytes = unsafe { CStr::from_ptr(msg) }.to_bytes();
    let _ = bun_core::Output::error_writer().print_bytes_ln(bytes);
    // TODO(port): exact equivalent of `errorWriter().print("{s}\n", .{span})`
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/analyze_transpiled_module.zig (397 lines)
//   confidence: medium
//   todos:      7
//   notes:      ModuleInfoDeserialized is self-referential (raw *const [T] into owner); ArrayHashMap needs adapted-context get_or_put + re_index/keys_mut; non-u8 deserialized slices are align(1) and need read_unaligned.
// ──────────────────────────────────────────────────────────────────────────

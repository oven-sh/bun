//! JavaScript printer — translates the AST back to source text.
//! Port of src/js_printer/js_printer.zig.
//!
//! B-2 UN-GATED. The `Printer<'a, W, ...>` struct and its full method surface
//! (`print_expr`, `print_stmt`, `print_binding`, `print_property`, …) now
//! compile against the real `bun_ast::{e,s,b,g,op,expr,stmt}`
//! types. The top-level `print` / `print_with_writer{,_and_platform}` /
//! `print_common_js` / `get_source_map_builder` driver fns are live at crate
//! root (the `__gated_entry_points` wrapper has been flattened). Remaining
//! `` islands are leaf optimizations blocked on lower-tier surface
//! (see TODO(b2-blocked) markers below): the template-inlining fold, the
//! ESM-to-CJS __export emission path, `print_dev_server_module`, the source-map
//! self-borrow in `init`, and the `print_ast` minify-renamer driver / `print_json`.

#![allow(unused, nonstandard_style, clippy::all)]
#![warn(unused_must_use)]
#![feature(adt_const_params)]

use bun_collections::VecExt;

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_ast::{ImportKind, ImportRecord};
use bun_core::MutableString;
use bun_core::Output;
use bun_core::strings;
use bun_core::strings::CodepointIterator;
use bun_options_types::bundle_enums as bundle_opts;
use bun_sys::Fd;

/// Local stand-in for `bun_core::Encoding` that derives `ConstParamTy` so it can
/// be used as a const-generic parameter (`const ENCODING: Encoding`). The variant set is
/// identical; convert at the boundary if a `strings::Encoding` is ever needed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Encoding {
    Ascii,
    Utf8,
    Latin1,
    Utf16,
}

/// Byte-sink trait used by the string-escape helpers and `StdWriterAdapter`.
/// Re-exported from `bun_io` (canonical in `bun_core::io`); any `bun_io::Write`
/// — `Vec<u8>`, `MutableString`, `&mut dyn bun_io::Write` — satisfies this.
pub use bun_io::Write;

use bun_ast as js_ast;
use js_ast::Ref;
/// `lexer::*` — the printer only consumes the pure identifier/keyword
/// classifiers, all of which live in `bun_ast::lexer_tables`. Aliased so the
/// `lexer::is_identifier(...)` spelling matches the Zig path.
mod lexer {
    pub use bun_ast::lexer_tables::*;
}
use bun_ast::ImportRecordFlags;

use bun_sourcemap as SourceMap;

pub use bun_options_types::schema::api::CssInJsBehavior;

/// `fs.Path` from `src/resolver/fs.zig`. The resolver crate is a sibling
/// tier-4 crate; the canonical struct was MOVED DOWN to `bun_paths::fs::Path`
/// so both the resolver and the printer can name it without a dep cycle.
pub use bun_paths::fs::Path as FsPath;

// ──────────────────────────────────────────────────────────────────────────
// renamer — Phase-A draft in `renamer.rs`. The five former leak sites
// have been replaced with `bumpalo::Bump`-backed allocation (PORTING.md §Forbidden);
// renamed-name strings are arena-owned and typed `*const [u8]` (PORTING.md §Allocators).
// Phase B threads the AST `'bump` lifetime to replace the raw pointers.
// ──────────────────────────────────────────────────────────────────────────
#[path = "renamer.rs"]
pub mod renamer;
use renamer as rename;

/// Map of mangled property `Ref` → final mangled name bytes.
/// Zig: `std.AutoArrayHashMapUnmanaged(Ref, []const u8)` (values borrow bundler arena).
// PERF(port): Zig values were arena-borrowed `[]const u8`; Box<[u8]> here owns —
// revisit if profiling shows allocation pressure during link.
pub type MangledProps = bun_collections::ArrayHashMap<Ref, Box<[u8]>>;

/// js_printer is the sole producer of ModuleInfo records; the bundler/runtime
/// only consume the serialized form.
pub mod analyze_transpiled_module {
    use bun_collections::{ArrayHashMap, HashMap, VecExt};
    use bun_core::slice_as_bytes;

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum RecordKind {
        /// var_name
        DeclaredVariable,
        /// let_name
        LexicalVariable,
        /// module_name, import_name, local_name
        ImportInfoSingle,
        /// module_name, import_name, local_name
        ImportInfoSingleTypeScript,
        /// module_name, import_name = '*', local_name
        ImportInfoNamespace,
        /// export_name, import_name, module_name
        ExportInfoIndirect,
        /// export_name, local_name, padding (for local => indirect conversion)
        ExportInfoLocal,
        /// export_name, module_name
        ExportInfoNamespace,
        /// module_name
        ExportInfoStar,
    }
    impl RecordKind {
        pub fn len(self) -> usize {
            match self {
                Self::DeclaredVariable | Self::LexicalVariable => 1,
                Self::ImportInfoSingle => 3,
                Self::ImportInfoSingleTypeScript => 3,
                Self::ImportInfoNamespace => 3,
                Self::ExportInfoIndirect => 3,
                Self::ExportInfoLocal => 3,
                Self::ExportInfoNamespace => 2,
                Self::ExportInfoStar => 1,
            }
        }
        #[inline]
        pub fn try_from_u8(v: u8) -> Option<Self> {
            Some(match v {
                0 => Self::DeclaredVariable,
                1 => Self::LexicalVariable,
                2 => Self::ImportInfoSingle,
                3 => Self::ImportInfoSingleTypeScript,
                4 => Self::ImportInfoNamespace,
                5 => Self::ExportInfoIndirect,
                6 => Self::ExportInfoLocal,
                7 => Self::ExportInfoNamespace,
                8 => Self::ExportInfoStar,
                _ => return None,
            })
        }
    }

    /// Zig: `packed struct(u8)`. Kept as plain bools for ergonomic field access
    /// (`mi.flags.contains_import_meta = true`); bitcast at the (de)serialize boundary.
    #[derive(Clone, Copy, Default)]
    pub struct Flags {
        pub contains_import_meta: bool,
        pub is_typescript: bool,
        pub has_tla: bool,
    }
    impl Flags {
        #[inline]
        pub fn to_byte(self) -> u8 {
            (self.contains_import_meta as u8)
                | ((self.is_typescript as u8) << 1)
                | ((self.has_tla as u8) << 2)
        }
        #[inline]
        pub fn from_byte(b: u8) -> Self {
            Self {
                contains_import_meta: b & 0b001 != 0,
                is_typescript: b & 0b010 != 0,
                has_tla: b & 0b100 != 0,
            }
        }
    }

    // SAFETY: `#[repr(u8)]` enum with no fields → single initialized byte, no padding.
    unsafe impl bytemuck::NoUninit for RecordKind {}

    /// Index into `ModuleInfo`'s interned-string table. Two reserved sentinels.
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    pub struct StringID(pub u32);
    // SAFETY: `#[repr(transparent)]` over `u32`.
    unsafe impl bytemuck::Zeroable for StringID {}
    // SAFETY: `#[repr(transparent)]` over `u32` (Pod).
    unsafe impl bytemuck::Pod for StringID {}
    impl StringID {
        pub const STAR_DEFAULT: Self = Self(u32::MAX);
        pub const STAR_NAMESPACE: Self = Self(u32::MAX - 1);
    }

    /// Zig: `enum(u32)` with open range — non-reserved values bitcast to `StringID`.
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct FetchParameters(pub u32);
    // SAFETY: `#[repr(transparent)]` over `u32`.
    unsafe impl bytemuck::Zeroable for FetchParameters {}
    // SAFETY: `#[repr(transparent)]` over `u32` (Pod).
    unsafe impl bytemuck::Pod for FetchParameters {}
    #[allow(non_upper_case_globals)]
    impl FetchParameters {
        pub const None: Self = Self(u32::MAX);
        pub const Javascript: Self = Self(u32::MAX - 1);
        pub const Webassembly: Self = Self(u32::MAX - 2);
        pub const Json: Self = Self(u32::MAX - 3);
        #[inline]
        pub fn host_defined(value: StringID) -> Self {
            Self(value.0)
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum VarKind {
        Declared,
        Lexical,
    }

    /// Borrowing view over a finalized/serialized `ModuleInfo`.
    /// Zig kept this self-referentially inside `ModuleInfo`; Rust builds it on demand
    /// (`ModuleInfo::as_deserialized`) or borrows from an owned byte buffer
    /// (`ModuleInfoDeserializedOwned::as_ref`).
    pub struct ModuleInfoDeserialized<'a> {
        pub strings_buf: &'a [u8],
        pub strings_lens: &'a [u32],
        pub requested_modules_keys: &'a [StringID],
        pub requested_modules_values: &'a [FetchParameters],
        pub buffer: &'a [StringID],
        pub record_kinds: &'a [RecordKind],
        pub flags: Flags,
    }
    impl<'a> ModuleInfoDeserialized<'a> {
        pub fn serialize<W: std::io::Write>(&self, w: &mut W) -> std::io::Result<()> {
            w.write_all(
                &u32::try_from(self.record_kinds.len())
                    .unwrap()
                    .to_le_bytes(),
            )?;
            // `RecordKind: NoUninit` (#[repr(u8)]) → safe byte view.
            w.write_all(slice_as_bytes(self.record_kinds))?;
            let pad = (4 - (self.record_kinds.len() % 4)) % 4;
            w.write_all(&[0u8; 4][..pad])?; // alignment padding

            w.write_all(&u32::try_from(self.buffer.len()).unwrap().to_le_bytes())?;
            w.write_all(slice_as_bytes(self.buffer))?;

            w.write_all(
                &u32::try_from(self.requested_modules_keys.len())
                    .unwrap()
                    .to_le_bytes(),
            )?;
            w.write_all(slice_as_bytes(self.requested_modules_keys))?;
            w.write_all(slice_as_bytes(self.requested_modules_values))?;

            w.write_all(&[self.flags.to_byte()])?;
            w.write_all(&[0u8; 3])?; // alignment padding

            w.write_all(
                &u32::try_from(self.strings_lens.len())
                    .unwrap()
                    .to_le_bytes(),
            )?;
            w.write_all(slice_as_bytes(self.strings_lens))?;
            w.write_all(self.strings_buf)?;
            Ok(())
        }
    }

    /// Heap byte buffer with guaranteed 4-byte alignment.
    ///
    /// `as_ref()` below reinterprets interior ranges as `&[u32]` / `&[StringID]` /
    /// `&[FetchParameters]` via `bytemuck::cast_slice`. A plain `Box<[u8]>` only
    /// guarantees `align(1)`, so forming an aligned `&[u32]` from it is UB. The Zig
    /// sibling sidesteps this by typing the fields `[]align(1) const u32`
    /// (analyze_transpiled_module.zig); Rust has no under-aligned slice type, so we
    /// instead over-align the allocation by storing `Box<[u32]>` and viewing it as
    /// bytes — no raw alloc/dealloc, and `Send`/`Sync` are auto-derived.
    struct AlignedBytes {
        /// 4-byte-aligned backing storage (length rounded up to a whole `u32`).
        words: Box<[u32]>,
        /// Logical byte length (`<= words.len() * 4`); trailing pad bytes are zero.
        len: usize,
    }
    impl AlignedBytes {
        fn copy_from(src: &[u8]) -> Self {
            let mut words = vec![0u32; src.len().div_ceil(4)].into_boxed_slice();
            bytemuck::cast_slice_mut::<u32, u8>(&mut words)[..src.len()].copy_from_slice(src);
            Self {
                words,
                len: src.len(),
            }
        }
    }
    impl core::ops::Deref for AlignedBytes {
        type Target = [u8];
        #[inline]
        fn deref(&self) -> &[u8] {
            &bytemuck::cast_slice::<u32, u8>(&self.words)[..self.len]
        }
    }

    /// Owns a duplicated byte buffer and exposes a `ModuleInfoDeserialized` view into it.
    /// Replaces Zig's `.owner = .allocated_slice` arm.
    pub struct ModuleInfoDeserializedOwned {
        #[allow(dead_code)]
        backing: AlignedBytes,
        // `RecordKind` is a `#[repr(u8)]` enum (not all bit patterns valid), so
        // the validated discriminants are decoded once in `create()` and owned
        // here instead of being reinterpreted from `backing` on every `as_ref()`.
        record_kinds: Box<[RecordKind]>,
        // Offsets/lengths into `backing` — reconstructed as slices in `as_ref()`.
        buffer: (usize, usize),
        requested_modules_keys: (usize, usize),
        requested_modules_values: (usize, usize),
        strings_lens: (usize, usize),
        strings_buf: (usize, usize),
        flags: Flags,
    }
    impl ModuleInfoDeserializedOwned {
        pub fn create(source: &[u8]) -> Result<Box<Self>, BadModuleInfo> {
            let duped = AlignedBytes::copy_from(source);
            let mut off = 0usize;
            macro_rules! eat {
                ($len:expr) => {{
                    let len = $len;
                    if duped.len() < off + len {
                        return Err(BadModuleInfo);
                    }
                    let r = (off, len);
                    off += len;
                    r
                }};
            }
            macro_rules! eat_u32 {
                () => {{
                    let (o, _) = eat!(4);
                    u32::from_le_bytes(
                        duped[o..o + 4]
                            .try_into()
                            .expect("infallible: size matches"),
                    ) as usize
                }};
            }

            let record_kinds_len = eat_u32!();
            let (rk_off, rk_len) = eat!(record_kinds_len * core::mem::size_of::<RecordKind>());
            // Validate + decode every record-kind byte into an owned `Box<[RecordKind]>`.
            // `RecordKind` is a `#[repr(u8)]` enum, so any byte outside 0..=8 is invalid;
            // `source` may come from an on-disk cache (`create_from_cached_record`), so it
            // is untrusted. Decoding once here lets `as_ref()` hand out `&[RecordKind]`
            // without an `unsafe` reinterpret.
            let mut record_kinds = Vec::with_capacity(rk_len);
            for &b in &duped[rk_off..rk_off + rk_len] {
                match RecordKind::try_from_u8(b) {
                    Some(k) => record_kinds.push(k),
                    None => return Err(BadModuleInfo),
                }
            }
            let record_kinds = record_kinds.into_boxed_slice();
            let _ = eat!((4 - (record_kinds_len % 4)) % 4); // alignment padding

            let buffer_len = eat_u32!();
            let buffer = eat!(buffer_len * core::mem::size_of::<StringID>());

            let requested_modules_len = eat_u32!();
            let requested_modules_keys =
                eat!(requested_modules_len * core::mem::size_of::<StringID>());
            let requested_modules_values =
                eat!(requested_modules_len * core::mem::size_of::<FetchParameters>());

            let (flags_off, _) = eat!(1);
            let flags = Flags::from_byte(duped[flags_off]);
            let _ = eat!(3); // alignment padding

            let strings_len = eat_u32!();
            let strings_lens = eat!(strings_len * core::mem::size_of::<u32>());
            let strings_buf = (off, duped.len() - off);

            Ok(Box::new(Self {
                backing: duped,
                record_kinds,
                buffer,
                requested_modules_keys,
                requested_modules_values,
                strings_lens,
                strings_buf,
                flags,
            }))
        }
        /// Wrapper around `create` for cache loads; returns `None` on corrupt data.
        pub fn create_from_cached_record(source: &[u8]) -> Option<Box<Self>> {
            Self::create(source).ok()
        }
        pub fn as_ref(&self) -> ModuleInfoDeserialized<'_> {
            let bytes: &[u8] = &self.backing;
            #[inline(always)]
            fn sub<T: bytemuck::Pod>(bytes: &[u8], (off, len): (usize, usize)) -> &[T] {
                // `create` derives every (off, len) from `count * size_of::<T>()`
                // and pads to 4-byte boundaries; `AlignedBytes` guarantees a
                // 4-aligned base — so `cast_slice`'s align/size checks pass.
                bytemuck::cast_slice(&bytes[off..off + len])
            }
            ModuleInfoDeserialized {
                record_kinds: &self.record_kinds,
                buffer: sub::<StringID>(bytes, self.buffer),
                requested_modules_keys: sub::<StringID>(bytes, self.requested_modules_keys),
                requested_modules_values: sub::<FetchParameters>(
                    bytes,
                    self.requested_modules_values,
                ),
                strings_lens: sub::<u32>(bytes, self.strings_lens),
                strings_buf: &bytes[self.strings_buf.0..self.strings_buf.0 + self.strings_buf.1],
                flags: self.flags,
            }
        }
    }

    #[derive(Debug)]
    pub struct BadModuleInfo;

    /// Insertion-ordered (key, value) store with O(1) duplicate-key rejection.
    /// Stand-in for Zig's `AutoArrayHashMapUnmanaged` until `bun_collections::ArrayHashMap`
    /// grows slice-yielding `keys()`/`values()`.
    // PERF(port): two allocations + a side HashMap; revisit with a real IndexMap.
    struct OrderedMap<K: Eq + core::hash::Hash + Copy, V> {
        keys: Vec<K>,
        values: Vec<V>,
        index: HashMap<K, usize>,
    }
    impl<K: Eq + core::hash::Hash + Copy, V> Default for OrderedMap<K, V> {
        fn default() -> Self {
            Self {
                keys: Vec::new(),
                values: Vec::new(),
                index: HashMap::default(),
            }
        }
    }
    impl<K: Eq + core::hash::Hash + Copy, V> OrderedMap<K, V> {
        fn keys(&self) -> &[K] {
            &self.keys
        }
        fn values(&self) -> &[V] {
            &self.values
        }
        /// Returns `true` if `key` was already present (Zig `getOrPut().found_existing`).
        fn insert_if_absent(&mut self, key: K, value: V) -> bool {
            if self.index.contains_key(&key) {
                return true;
            }
            self.index.insert(key, self.keys.len());
            self.keys.push(key);
            self.values.push(value);
            false
        }
        #[allow(dead_code)]
        fn swap_remove(&mut self, key: &K) -> Option<V> {
            let i = self.index.remove(key)?;
            self.keys.swap_remove(i);
            let v = self.values.swap_remove(i);
            if i < self.keys.len() {
                self.index.insert(self.keys[i], i);
            }
            Some(v)
        }
        /// Replace `old` with `new` **in place**, preserving insertion order.
        /// Mirrors Zig `keys()[idx] = new; reIndex()`.
        fn rename_key(&mut self, old: &K, new: K) -> bool {
            let Some(i) = self.index.remove(old) else {
                return false;
            };
            self.keys[i] = new;
            self.index.insert(new, i);
            true
        }
    }

    pub struct ModuleInfo {
        /// all strings in wtf-8. index in hashmap = StringID
        // Zig used an adapted ArrayHashMap keyed by offset; Rust keys by content
        // directly (wyhash via bun_collections::HashMap) and keeps the parallel
        // buf/lens vectors for the on-wire format.
        strings_map: HashMap<Vec<u8>, u32>,
        strings_buf: Vec<u8>,
        strings_lens: Vec<u32>,
        requested_modules: OrderedMap<StringID, FetchParameters>,
        buffer: Vec<StringID>,
        record_kinds: Vec<RecordKind>,
        pub flags: Flags,
        exported_names: HashMap<StringID, ()>,
        pub finalized: bool,
    }

    impl ModuleInfo {
        pub fn create(is_typescript: bool) -> Box<Self> {
            Box::new(Self::init(is_typescript))
        }
        fn init(is_typescript: bool) -> Self {
            Self {
                strings_map: HashMap::default(),
                strings_buf: Vec::new(),
                strings_lens: Vec::new(),
                requested_modules: OrderedMap::default(),
                buffer: Vec::new(),
                record_kinds: Vec::new(),
                flags: Flags {
                    is_typescript,
                    ..Flags::default()
                },
                exported_names: HashMap::default(),
                finalized: false,
            }
        }
        pub fn destroy(self: Box<Self>) {
            drop(self);
        }

        pub fn as_deserialized(&self) -> ModuleInfoDeserialized<'_> {
            debug_assert!(self.finalized);
            ModuleInfoDeserialized {
                strings_buf: &self.strings_buf,
                strings_lens: &self.strings_lens,
                requested_modules_keys: self.requested_modules.keys(),
                requested_modules_values: self.requested_modules.values(),
                buffer: &self.buffer,
                record_kinds: &self.record_kinds,
                flags: self.flags,
            }
        }

        pub fn add_var(&mut self, name: StringID, kind: VarKind) {
            match kind {
                VarKind::Declared => self.add_declared_variable(name),
                VarKind::Lexical => self.add_lexical_variable(name),
            }
        }

        fn add_record(&mut self, kind: RecordKind, data: &[StringID]) {
            debug_assert!(!self.finalized);
            debug_assert_eq!(data.len(), kind.len());
            self.record_kinds.push(kind);
            self.buffer.extend_from_slice(data);
        }
        pub fn add_declared_variable(&mut self, id: StringID) {
            self.add_record(RecordKind::DeclaredVariable, &[id]);
        }
        pub fn add_lexical_variable(&mut self, id: StringID) {
            self.add_record(RecordKind::LexicalVariable, &[id]);
        }
        pub fn add_import_info_single(
            &mut self,
            module_name: StringID,
            import_name: StringID,
            local_name: StringID,
            only_used_as_type: bool,
        ) {
            self.add_record(
                if only_used_as_type {
                    RecordKind::ImportInfoSingleTypeScript
                } else {
                    RecordKind::ImportInfoSingle
                },
                &[module_name, import_name, local_name],
            );
        }
        pub fn add_import_info_namespace(&mut self, module_name: StringID, local_name: StringID) {
            self.add_record(
                RecordKind::ImportInfoNamespace,
                &[module_name, StringID::STAR_NAMESPACE, local_name],
            );
        }
        pub fn add_export_info_indirect(
            &mut self,
            export_name: StringID,
            import_name: StringID,
            module_name: StringID,
        ) {
            if self.has_or_add_exported_name(export_name) {
                return;
            } // a syntax error will be emitted later in this case
            self.add_record(
                RecordKind::ExportInfoIndirect,
                &[export_name, import_name, module_name],
            );
        }
        pub fn add_export_info_local(&mut self, export_name: StringID, local_name: StringID) {
            if self.has_or_add_exported_name(export_name) {
                return;
            } // a syntax error will be emitted later in this case
            self.add_record(
                RecordKind::ExportInfoLocal,
                &[export_name, local_name, StringID(u32::MAX)],
            );
        }
        pub fn add_export_info_namespace(&mut self, export_name: StringID, module_name: StringID) {
            if self.has_or_add_exported_name(export_name) {
                return;
            } // a syntax error will be emitted later in this case
            self.add_record(RecordKind::ExportInfoNamespace, &[export_name, module_name]);
        }
        pub fn add_export_info_star(&mut self, module_name: StringID) {
            self.add_record(RecordKind::ExportInfoStar, &[module_name]);
        }

        fn has_or_add_exported_name(&mut self, name: StringID) -> bool {
            self.exported_names.insert(name, ()).is_some()
        }

        /// Read-only view of the interned string table — `(buf, lens)` —
        /// safe to call before `finalize()`. Unlike `as_deserialized()` this
        /// does not assert `finalized`; it exists so the bundler can rewrite
        /// cross-chunk specifier StringIDs (which must happen pre-finalize
        /// because `replace_string_id` debug-asserts `!finalized`).
        pub fn strings(&self) -> (&[u8], &[u32]) {
            (&self.strings_buf, &self.strings_lens)
        }

        pub fn str(&mut self, value: &[u8]) -> StringID {
            if let Some(&idx) = self.strings_map.get(value) {
                return StringID(idx);
            }
            let idx = u32::try_from(self.strings_lens.len()).unwrap();
            self.strings_buf.extend_from_slice(value);
            self.strings_lens.push(u32::try_from(value.len()).unwrap());
            // PERF(port): Zig avoided this owned-key dupe via adapted hashmap over
            // strings_buf offsets; revisit with a raw-entry API.
            self.strings_map.insert(value.to_vec(), idx);
            StringID(idx)
        }

        pub fn request_module(
            &mut self,
            import_record_path: StringID,
            fetch_parameters: FetchParameters,
        ) {
            // jsc only records the attributes of the first import with the given import_record_path. so only put if not exists.
            self.requested_modules
                .insert_if_absent(import_record_path, fetch_parameters);
        }

        /// Replace all occurrences of `old_id` with `new_id` in records and requested_modules.
        /// Used to fix up cross-chunk import specifiers after final paths are computed.
        pub fn replace_string_id(&mut self, old_id: StringID, new_id: StringID) {
            debug_assert!(!self.finalized);
            for item in self.buffer.iter_mut() {
                if *item == old_id {
                    *item = new_id;
                }
            }
            // Zig: `requested_modules.keys()[idx] = new_id; reIndex()` — must preserve
            // insertion order (serialized verbatim into ModuleInfo for JSC).
            self.requested_modules.rename_key(&old_id, new_id);
        }

        /// find any exports marked as 'local' that are actually 'indirect' and fix them
        pub fn finalize(&mut self) -> Result<(), ()> {
            debug_assert!(!self.finalized);
            #[derive(Clone, Copy)]
            struct LocalImport {
                module_name: StringID,
                import_name: StringID,
                record_kinds_idx: usize,
                is_namespace: bool,
            }
            let mut local_name_to_module_name: HashMap<StringID, LocalImport> = HashMap::default();
            {
                let mut i = 0usize;
                for (idx, &k) in self.record_kinds.iter().enumerate() {
                    if matches!(
                        k,
                        RecordKind::ImportInfoSingle | RecordKind::ImportInfoSingleTypeScript
                    ) {
                        local_name_to_module_name.insert(
                            self.buffer[i + 2],
                            LocalImport {
                                module_name: self.buffer[i],
                                import_name: self.buffer[i + 1],
                                record_kinds_idx: idx,
                                is_namespace: false,
                            },
                        );
                    } else if k == RecordKind::ImportInfoNamespace {
                        local_name_to_module_name.insert(
                            self.buffer[i + 2],
                            LocalImport {
                                module_name: self.buffer[i],
                                import_name: StringID::STAR_NAMESPACE,
                                record_kinds_idx: idx,
                                is_namespace: true,
                            },
                        );
                    }
                    i += k.len();
                }
            }
            {
                let mut i = 0usize;
                // Can't borrow self.record_kinds mutably while reading buffer; collect fixups.
                let mut ts_fixups: Vec<usize> = Vec::new();
                for k in self.record_kinds.iter_mut() {
                    let klen = k.len();
                    if *k == RecordKind::ExportInfoLocal {
                        if let Some(ip) =
                            local_name_to_module_name.get(&self.buffer[i + 1]).copied()
                        {
                            // `import * as z from M; export { z }` is a Namespace export per
                            // spec; encode it as indirect with import_name = STAR_NAMESPACE
                            // so the record stays the same length and toJSModuleRecord
                            // dispatches to addNamespaceExport.
                            *k = RecordKind::ExportInfoIndirect;
                            self.buffer[i + 1] = ip.import_name;
                            self.buffer[i + 2] = ip.module_name;
                            // In TypeScript, the re-exported import may target a type-only
                            // export that was elided. Convert the import to SingleTypeScript
                            // so JSC tolerates it being NotFound during linking.
                            if !ip.is_namespace && self.flags.is_typescript {
                                ts_fixups.push(ip.record_kinds_idx);
                            }
                        }
                    }
                    i += klen;
                }
                for idx in ts_fixups {
                    self.record_kinds[idx] = RecordKind::ImportInfoSingleTypeScript;
                }
            }
            self.finalized = true;
            Ok(())
        }
    }
}

/// Cold path — called at most once per print to persist output. Dispatch lives
/// on the parser-tier `RuntimeTranspilerCache` (`TranspilerCacheImpl`
/// link-interface); the printer just holds the raw pointer.
pub type RuntimeTranspilerCacheRef = core::ptr::NonNull<bun_ast::RuntimeTranspilerCache>;

use bun_core::fmt::hex2_upper; // remaining `\xHH` site below
use bun_core::printer::{
    FIRST_ASCII, FIRST_HIGH_SURROGATE, LAST_ASCII, LAST_LOW_SURROGATE, bmp_escape,
    surrogate_pair_escape,
};

/// For support JavaScriptCore
const ASCII_ONLY_ALWAYS_ON_UNLESS_MINIFYING: bool = true;

pub fn write_module_id(writer: &mut impl core::fmt::Write, module_id: u32) {
    debug_assert!(module_id != 0); // either module_id is forgotten or it should be disabled
    writer.write_str("$").expect("unreachable");
    write!(writer, "{:x}", module_id).expect("unreachable");
}

// PERF(port): was comptime monomorphization (`comptime CodePointType: type`) — Zig
// instantiated per code-unit type; Rust callers widen to i32 at the boundary.
// PERF(port): `ascii_only` is a *runtime* arg (was `const ASCII_ONLY`) so the large
// callers (`write_pre_quoted_string_inner`, `estimate_length_for_utf8`) collapse to a
// single monomorphization instead of one per (ascii_only × quote_char × …) combo —
// see the comment on `write_pre_quoted_string`.
#[inline]
pub fn can_print_without_escape(c: i32, ascii_only: bool) -> bool {
    if c <= LAST_ASCII as i32 {
        c >= FIRST_ASCII as i32
            && c != i32::from(b'\\')
            && c != i32::from(b'"')
            && c != i32::from(b'\'')
            && c != i32::from(b'`')
            && c != i32::from(b'$')
    } else {
        !ascii_only
            && c != 0xFEFF
            && c != 0x2028
            && c != 0x2029
            && (c < FIRST_HIGH_SURROGATE as i32 || c > LAST_LOW_SURROGATE as i32)
    }
}

const INDENTATION_SPACE_BUF: [u8; 128] = [b' '; 128];
const INDENTATION_TAB_BUF: [u8; 128] = [b'\t'; 128];

pub fn best_quote_char_for_string<T>(str: &[T], allow_backtick: bool) -> u8
where
    T: Copy + Into<u32>,
{
    let mut single_cost: usize = 0;
    let mut double_cost: usize = 0;
    let mut backtick_cost: usize = 0;
    let mut i: usize = 0;
    let n = str.len().min(1024);
    while i < n {
        // Loop invariant `i < n ≤ str.len()`; LLVM elides the bounds check.
        match str[i].into() {
            0x27 /* ' */ => single_cost += 1,
            0x22 /* " */ => double_cost += 1,
            0x60 /* ` */ => backtick_cost += 1,
            0x0A /* \n */ => {
                single_cost += 1;
                double_cost += 1;
            }
            0x5C /* \\ */ => {
                i += 1;
            }
            0x24 /* $ */ => {
                if i + 1 < str.len() && str[i + 1].into() == u32::from(b'{') {
                    backtick_cost += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }

    if allow_backtick && backtick_cost < single_cost.min(double_cost) {
        return b'`';
    }
    if single_cost < double_cost {
        return b'\'';
    }
    b'"'
}

#[derive(Clone, Copy)]
pub struct Whitespacer {
    pub normal: &'static [u8],
    pub minify: &'static [u8],
}

// NOTE: Zig `Whitespacer.append` was comptime string concatenation
// (`.{ .normal = this.normal ++ str, .minify = this.minify ++ str }`).
// Rust `const fn` can't concatenate `&'static [u8]` at compile time without
// `const_format::concatcp!` at the call site, and a runtime no-op stub would
// silently emit wrong bytes. Callers must inline the concatenated literals
// (see e.g. SExportStar) instead of calling `.append()`.

#[doc(hidden)]
pub const fn _ws_minify_len(s: &[u8]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < s.len() {
        if s[i] != b' ' {
            n += 1;
        }
        i += 1;
    }
    n
}

#[doc(hidden)]
pub const fn _ws_minify<const N: usize>(s: &[u8]) -> [u8; N] {
    let mut out = [0u8; N];
    let mut i = 0;
    let mut j = 0;
    while i < s.len() {
        if s[i] != b' ' {
            out[j] = s[i];
            j += 1;
        }
        i += 1;
    }
    out
}

/// Compile-time helper: produce a `Whitespacer` whose `.minify` strips spaces.
/// Zig computed `.minify` at comptime by stripping ' ' (js_printer.zig:92-108).
#[macro_export]
macro_rules! ws {
    ($s:expr) => {{
        const NORMAL: &'static [u8] = $s;
        const N: usize = $crate::_ws_minify_len(NORMAL);
        const MINIFY: [u8; N] = $crate::_ws_minify::<N>(NORMAL);
        $crate::Whitespacer {
            normal: NORMAL,
            minify: &MINIFY,
        }
    }};
}

// PERF(port): `ascii_only`/`quote_char` are runtime args (were `const`) — collapses
// the monomorphization fan-out; the inner branches are cheap and well-predicted.
pub fn estimate_length_for_utf8(input: &[u8], ascii_only: bool, quote_char: u8) -> usize {
    let mut remaining = input;
    let mut len: usize = 2; // for quotes

    while let Some(i) = strings::index_of_needs_escape_for_java_script_string(remaining, quote_char)
    {
        let i = i as usize;
        len += i;
        remaining = &remaining[i..];
        let char_len = strings::wtf8_byte_sequence_length_with_invalid(remaining[0]);
        let bytes: [u8; 4] = match char_len {
            // 0 is not returned by `wtf8_byte_sequence_length_with_invalid`
            1 => [remaining[0], 0, 0, 0],
            2 => [remaining[0], remaining[1], 0, 0],
            3 => [remaining[0], remaining[1], remaining[2], 0],
            4 => [remaining[0], remaining[1], remaining[2], remaining[3]],
            _ => unreachable!(),
        };
        let c = strings::decode_wtf8_rune_t::<i32>(&bytes, char_len, 0);
        if can_print_without_escape(c, ascii_only) {
            len += char_len as usize;
        } else if c <= 0xFFFF {
            len += 6;
        } else {
            len += 12;
        }
        remaining = &remaining[char_len as usize..];
    }
    // Zig's `else` on `while` runs when the condition fails (i.e. `None`).
    if remaining.as_ptr() == input.as_ptr() {
        // PORT NOTE: reshaped — Zig returns `remaining.len + 2` when *no* escape was ever found.
        // The branch above already handled the loop body; falling out of the loop with no
        // iterations means "no escapes anywhere".
    }
    // TODO(port): the original `while ... else { return remaining.len + 2 }` returns early when
    // index_of_needs_escape returns null at the *first* check. The current shape returns `len`
    // (which equals 2) plus nothing for `remaining`. Match Zig precisely.
    len + remaining.len()
}

/// Thin const-generic facade kept for source-stable call sites (and external
/// callers in other crates that pass literal const args). It forwards to the
/// single non-generic-over-(quote/ascii/json) [`write_pre_quoted_string_inner`]
/// so the large escaping loop is monomorphized once per `(W, ENCODING)` instead
/// of once per `(W, QUOTE_CHAR, ASCII_ONLY, JSON, ENCODING)` — that fan-out was a
/// meaningful slice of this crate's `.text`. `#[inline]` so the wrapper itself
/// (a single tail call) costs nothing.
#[inline]
pub fn write_pre_quoted_string<
    W,
    const QUOTE_CHAR: u8,
    const ASCII_ONLY: bool,
    const JSON: bool,
    const ENCODING: Encoding,
>(
    text_in: &[u8],
    writer: &mut W,
) -> Result<(), bun_core::Error>
where
    W: Write + ?Sized,
{
    write_pre_quoted_string_inner::<W, ENCODING>(text_in, writer, QUOTE_CHAR, ASCII_ONLY, JSON)
}

/// `quote_char` / `ascii_only` / `json` are runtime args (were `const`): the
/// branches on them are cheap and well-predicted, and collapsing the
/// monomorphizations keeps the hot transpile pages dense (see the facade above).
/// `ENCODING` stays `const` — it changes the code-unit indexing structure of the
/// loop, so a per-encoding copy is genuinely different code.
#[inline(never)]
pub fn write_pre_quoted_string_inner<W, const ENCODING: Encoding>(
    text_in: &[u8],
    writer: &mut W,
    quote_char: u8,
    ascii_only: bool,
    json: bool,
) -> Result<(), bun_core::Error>
where
    W: Write + ?Sized,
{
    // TODO(port): for ENCODING == Utf16, Zig reinterprets `text_in` as []const u16 via bytesAsSlice.
    // In Rust we keep `text_in: &[u8]` and index by code-unit width below.
    debug_assert!(
        !(json && quote_char != b'"'),
        "for json, quote_char must be '\"'"
    );

    // PORT NOTE: this is a large hot-path function; logic is ported 1:1 but the
    // utf16 path needs &[u16] handling.
    let text = text_in;
    let mut i: usize = 0;
    let n: usize = match ENCODING {
        Encoding::Utf16 => text.len() / 2,
        _ => text.len(),
    };

    macro_rules! code_unit_at {
        ($idx:expr) => {
            match ENCODING {
                Encoding::Utf16 => {
                    let lo = text[$idx * 2];
                    let hi = text[$idx * 2 + 1];
                    u16::from_le_bytes([lo, hi]) as i32
                }
                _ => text[$idx] as i32,
            }
        };
    }

    while i < n {
        let width: u8 = match ENCODING {
            Encoding::Latin1 | Encoding::Ascii => 1,
            Encoding::Utf8 => strings::wtf8_byte_sequence_length_with_invalid(text[i]),
            Encoding::Utf16 => 1,
        };
        let clamped_width = (width as usize).min(n.saturating_sub(i));
        let c: i32 = match ENCODING {
            Encoding::Utf8 => {
                let bytes: [u8; 4] = match clamped_width {
                    1 => [text[i], 0, 0, 0],
                    2 => [text[i], text[i + 1], 0, 0],
                    3 => [text[i], text[i + 1], text[i + 2], 0],
                    4 => [text[i], text[i + 1], text[i + 2], text[i + 3]],
                    _ => unreachable!(),
                };
                strings::decode_wtf8_rune_t::<i32>(&bytes, width, 0)
            }
            Encoding::Ascii => {
                debug_assert!(text[i] <= 0x7F);
                text[i] as i32
            }
            Encoding::Latin1 => text[i] as i32,
            Encoding::Utf16 => {
                // TODO: if this is a part of a surrogate pair, we could parse the whole codepoint in order
                // to emit it as a single \u{result} rather than two paired \uLOW\uHIGH.
                // eg: "\u{10334}" will convert to "𐌴" without this.
                code_unit_at!(i)
            }
        };

        if can_print_without_escape(c, ascii_only) {
            match ENCODING {
                Encoding::Ascii | Encoding::Utf8 => {
                    let remain = &text[i + clamped_width..];
                    if let Some(j) =
                        strings::index_of_needs_escape_for_java_script_string(remain, quote_char)
                    {
                        let j = j as usize;
                        let text_chunk = &text[i..i + clamped_width];
                        writer.write_all(text_chunk)?;
                        i += clamped_width;
                        writer.write_all(&remain[..j])?;
                        i += j;
                    } else {
                        writer.write_all(&text[i..])?;
                        i = n;
                        break;
                    }
                }
                Encoding::Latin1 | Encoding::Utf16 => {
                    let mut codepoint_bytes = [0u8; 4];
                    let codepoint_len = strings::encode_wtf8_rune(&mut codepoint_bytes, c as u32);
                    writer.write_all(&codepoint_bytes[..codepoint_len])?;
                    i += clamped_width;
                }
            }
            continue;
        }
        match c {
            0x07 => {
                writer.write_all(b"\\x07")?;
                i += 1;
            }
            0x08 => {
                writer.write_all(b"\\b")?;
                i += 1;
            }
            0x0C => {
                writer.write_all(b"\\f")?;
                i += 1;
            }
            0x0A => {
                if quote_char == b'`' {
                    writer.write_all(b"\n")?;
                } else {
                    writer.write_all(b"\\n")?;
                }
                i += 1;
            }
            0x0D => {
                writer.write_all(b"\\r")?;
                i += 1;
            }
            // \v
            0x0B => {
                writer.write_all(b"\\v")?;
                i += 1;
            }
            // "\\"
            0x5C => {
                writer.write_all(b"\\\\")?;
                i += 1;
            }
            0x22 => {
                if quote_char == b'"' {
                    writer.write_all(b"\\\"")?;
                } else {
                    writer.write_all(b"\"")?;
                }
                i += 1;
            }
            0x27 => {
                if quote_char == b'\'' {
                    writer.write_all(b"\\'")?;
                } else {
                    writer.write_all(b"'")?;
                }
                i += 1;
            }
            0x60 => {
                if quote_char == b'`' {
                    writer.write_all(b"\\`")?;
                } else {
                    writer.write_all(b"`")?;
                }
                i += 1;
            }
            0x24 => {
                if quote_char == b'`' {
                    let next = if i + clamped_width < n {
                        Some(code_unit_at!(i + clamped_width))
                    } else {
                        None
                    };
                    if next == Some(b'{' as i32) {
                        writer.write_all(b"\\$")?;
                    } else {
                        writer.write_all(b"$")?;
                    }
                } else {
                    writer.write_all(b"$")?;
                }
                i += 1;
            }
            0x09 => {
                if quote_char == b'`' {
                    writer.write_all(b"\t")?;
                } else {
                    writer.write_all(b"\\t")?;
                }
                i += 1;
            }
            _ => {
                i += width as usize;

                if c <= 0xFF && !json {
                    let h = hex2_upper(c as u8);
                    writer.write_all(&[b'\\', b'x', h[0], h[1]])?;
                } else if c <= 0xFFFF {
                    writer.write_all(&bmp_escape(c as u32))?;
                } else {
                    writer.write_all(&surrogate_pair_escape(c as u32))?;
                }
            }
        }
    }
    Ok(())
}

pub fn quote_for_json(
    text: &[u8],
    bytes: &mut MutableString,
    ascii_only: bool,
) -> Result<(), bun_core::Error> {
    // Zig: `comptime ascii_only: bool`. We now thread `ascii_only` at runtime so
    // the heavy escaper isn't monomorphized per ascii_only/quote-char combo.
    bytes.grow_if_needed(estimate_length_for_utf8(text, ascii_only, b'"'))?;
    bytes.append_char(b'"')?;
    write_pre_quoted_string_inner::<_, { Encoding::Utf8 }>(text, bytes, b'"', ascii_only, true)?;
    bytes.append_char(b'"').expect("unreachable");
    Ok(())
}

pub fn write_json_string<W: Write + ?Sized, const ENCODING: Encoding>(
    input: &[u8],
    writer: &mut W,
) -> Result<(), bun_core::Error> {
    writer.write_all(b"\"")?;
    write_pre_quoted_string_inner::<_, ENCODING>(input, writer, b'"', false, true)?;
    writer.write_all(b"\"")?;
    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// SourceMapHandler / Options — gated on bun_sourcemap::Chunk::Builder and the
// real bun_js_parser::{runtime, Ast::*} surface.
// ───────────────────────────────────────────────────────────────────────────
// TODO(b2-blocked): bun_sourcemap::Chunk::Builder
// TODO(b2-blocked): bun_ast::runtime::Runtime::Imports
// TODO(b2-blocked): bun_ast::Ast::CommonJSNamedExports
pub struct SourceMapHandler<'a> {
    pub ctx: NonNull<()>,
    pub callback: fn(*mut (), SourceMap::Chunk, &bun_ast::Source) -> Result<(), bun_core::Error>,
    _marker: core::marker::PhantomData<&'a mut ()>,
}

/// PORTING.md §Dispatch — manual vtable. Zig's `For(comptime Type, handler)` monomorphized
/// a typed callback into an erased thunk at comptime. Rust cannot bake a *runtime* fn pointer
/// into a captureless `fn(*mut (), ..)` thunk, so the handler is moved to a trait method and
/// the thunk is monomorphized over `T: OnSourceMapChunk` instead.
pub trait OnSourceMapChunk {
    fn on_source_map_chunk(
        &mut self,
        chunk: SourceMap::Chunk,
        source: &bun_ast::Source,
    ) -> Result<(), bun_core::Error>;
}

impl<'a> SourceMapHandler<'a> {
    pub fn on_source_map_chunk(
        &self,
        chunk: SourceMap::Chunk,
        source: &bun_ast::Source,
    ) -> Result<(), bun_core::Error> {
        (self.callback)(self.ctx.as_ptr(), chunk, source)
    }

    pub fn for_<T: OnSourceMapChunk>(ctx: &'a mut T) -> SourceMapHandler<'a> {
        // Monomorphized erased thunk: cast `*mut ()` back to `*mut T` and forward to the trait.
        fn thunk<T: OnSourceMapChunk>(
            p: *mut (),
            chunk: SourceMap::Chunk,
            source: &bun_ast::Source,
        ) -> Result<(), bun_core::Error> {
            // SAFETY: `p` was constructed from `&'a mut T` in `for_` below; the `'a` lifetime
            // on `SourceMapHandler` ties the handler's lifetime to the borrow, so `p` is a
            // valid, exclusive `*mut T` for as long as the handler exists.
            unsafe { (*p.cast::<T>()).on_source_map_chunk(chunk, source) }
        }
        SourceMapHandler {
            // Type-erased to `*mut ()` and cast back to `*mut T` inside the thunk before dereference.
            ctx: NonNull::from(ctx).cast::<()>(),
            callback: thunk::<T>,
            _marker: core::marker::PhantomData,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────
use js_ast::runtime;
use js_ast::{CommonJSNamedExports, TsEnumsMap};

pub struct Options<'a> {
    pub bundling: bool,
    pub transform_imports: bool,
    pub to_commonjs_ref: Ref,
    pub to_esm_ref: Ref,
    pub require_ref: Option<Ref>,
    pub import_meta_ref: Ref,
    pub hmr_ref: Ref,
    pub indent: Indentation,
    pub runtime_imports: runtime::Imports,
    pub module_hash: u32,
    pub source_path: Option<FsPath<'a>>,
    // allocator dropped — global mimalloc (this is an AST crate but Options.allocator is the global default)
    // TODO(port): source_map_allocator was Option<Allocator>; arena-backed in some callers
    pub source_map_handler: Option<SourceMapHandler<'a>>,
    pub source_map_builder: Option<&'a mut SourceMap::chunk::Builder>,
    // TODO(b2-blocked): bun_options_types::schema::api::CssInJsBehavior — local stand-in.
    pub css_import_behavior: CssInJsBehavior,
    pub target: bun_ast::Target,

    pub runtime_transpiler_cache: Option<RuntimeTranspilerCacheRef>,
    pub module_info: Option<&'a mut analyze_transpiled_module::ModuleInfo>,
    pub input_files_for_dev_server: Option<&'a [bun_ast::Source]>,

    /// Borrowed from `BundledAst.commonjs_named_exports`. Zig passed the
    /// unmanaged `StringArrayHashMap` header by value (shallow copy of
    /// shared storage); the printer only reads from it.
    pub commonjs_named_exports: Option<&'a CommonJSNamedExports>,
    pub commonjs_named_exports_deoptimized: bool,
    pub commonjs_module_exports_assigned_deoptimized: bool,
    pub commonjs_named_exports_ref: Ref,
    pub commonjs_module_ref: Ref,

    pub minify_whitespace: bool,
    pub minify_identifiers: bool,
    pub minify_syntax: bool,
    pub print_dce_annotations: bool,

    pub transform_only: bool,
    pub inline_require_and_import_errors: bool,
    pub has_run_symbol_renamer: bool,

    pub require_or_import_meta_for_source_callback: RequireOrImportMetaCallback,

    /// The module type of the importing file (after linking), used to determine interop helper behavior.
    /// Controls whether __toESM uses Node ESM semantics (isNodeMode=1 for .esm) or respects __esModule markers.
    pub input_module_type: bundle_opts::ModuleType,
    pub module_type: bundle_opts::Format,

    // /// Used for cross-module inlining of import items when bundling
    // const_values: Ast.ConstValuesMap = .{},
    /// Borrowed from `LinkerGraph.ts_enums` (one shared map for the whole
    /// bundle). Zig passed the unmanaged map header by value; the printer
    /// only reads from it.
    pub ts_enums: Option<&'a TsEnumsMap>,

    // If we're writing out a source map, this table of line start indices lets
    // us do binary search on to figure out what line a given AST node came from
    /// Borrowed from `LinkerGraph.files[i].line_offset_table`. The same
    /// source can print into multiple part-ranges/chunks, so the table must
    /// not be consumed. `get_source_map_builder` shallow-copies it into the
    /// builder (`ManuallyDrop`, never freed on the bundler path — matches
    /// Zig `printWithWriter`).
    pub line_offset_tables: Option<&'a SourceMap::line_offset_table::List>,

    pub mangled_props: Option<&'a crate::MangledProps>,
}

impl<'a> Options<'a> {
    pub fn require_or_import_meta_for_source(
        &self,
        id: u32,
        was_unwrapped_require: bool,
    ) -> RequireOrImportMeta {
        if self
            .require_or_import_meta_for_source_callback
            .ctx
            .is_none()
        {
            return RequireOrImportMeta::default();
        }
        self.require_or_import_meta_for_source_callback
            .call(id, was_unwrapped_require)
    }
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        Self {
            bundling: false,
            transform_imports: true,
            to_commonjs_ref: Ref::NONE,
            to_esm_ref: Ref::NONE,
            require_ref: None,
            import_meta_ref: Ref::NONE,
            hmr_ref: Ref::NONE,
            indent: Indentation::default(),
            runtime_imports: runtime::Imports::default(),
            module_hash: 0,
            source_path: None,
            source_map_handler: None,
            source_map_builder: None,
            css_import_behavior: CssInJsBehavior::Facade,
            target: bun_ast::Target::Browser,
            runtime_transpiler_cache: None,
            module_info: None,
            input_files_for_dev_server: None,
            commonjs_named_exports: None,
            commonjs_named_exports_deoptimized: false,
            commonjs_module_exports_assigned_deoptimized: false,
            commonjs_named_exports_ref: Ref::NONE,
            commonjs_module_ref: Ref::NONE,
            minify_whitespace: false,
            minify_identifiers: false,
            minify_syntax: false,
            print_dce_annotations: true,
            transform_only: false,
            inline_require_and_import_errors: true,
            has_run_symbol_renamer: false,
            require_or_import_meta_for_source_callback: RequireOrImportMetaCallback::default(),
            input_module_type: bundle_opts::ModuleType::Unknown,
            module_type: bundle_opts::Format::Esm,
            ts_enums: None,
            line_offset_tables: None,
            mangled_props: None,
        }
    }
}

use bun_ast::{Indentation, IndentationCharacter};

/// Downstream-compat: `print_json` callers pass this. The Zig spec passes the
/// full `Options` struct; only the fields any caller actually sets are surfaced
/// here and forwarded into `Options { .. }` inside `print_json`.
#[derive(Default)]
pub struct PrintJsonOptions<'a> {
    pub indent: Indentation,
    pub mangled_props: Option<&'a MangledProps>,
    pub minify_whitespace: bool,
}

// `print_json` lives below the `Printer` impl (after `__gated_printer`) so it
// can name `Printer<...>` directly; see the bottom of this file.

// ───────────────────────────────────────────────────────────────────────────
// RequireOrImportMeta
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct RequireOrImportMeta {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    pub wrapper_ref: Ref,
    pub exports_ref: Ref,
    pub is_wrapper_async: bool,
    pub was_unwrapped_require: bool,
}

// Clone/Copy: bitwise OK — `ctx` is a non-owning opaque backref the caller
// keeps alive for the print pass; `callback` is POD.
#[derive(Clone, Copy)]
pub struct RequireOrImportMetaCallback {
    pub ctx: Option<NonNull<()>>,
    pub callback: fn(*mut (), u32, bool) -> RequireOrImportMeta,
}

impl Default for RequireOrImportMetaCallback {
    fn default() -> Self {
        fn noop(_: *mut (), _: u32, _: bool) -> RequireOrImportMeta {
            RequireOrImportMeta::default()
        }
        Self {
            ctx: None,
            callback: noop,
        }
    }
}

/// PORTING.md §Dispatch — manual vtable. Zig's `init(comptime Context, ctx, callback)`
/// `@ptrCast`-erased the typed callback at comptime. Rust monomorphizes the erased thunk
/// over `T: RequireOrImportMetaSource` instead, so `callback` stays a captureless `fn`.
pub trait RequireOrImportMetaSource {
    fn require_or_import_meta_for_source(
        &mut self,
        id: u32,
        was_unwrapped_require: bool,
    ) -> RequireOrImportMeta;
}

impl RequireOrImportMetaCallback {
    pub fn call(&self, id: u32, was_unwrapped_require: bool) -> RequireOrImportMeta {
        (self.callback)(self.ctx.unwrap().as_ptr(), id, was_unwrapped_require)
    }

    pub fn init<T: RequireOrImportMetaSource>(ctx: &mut T) -> Self {
        fn thunk<T: RequireOrImportMetaSource>(
            p: *mut (),
            id: u32,
            was_unwrapped_require: bool,
        ) -> RequireOrImportMeta {
            // SAFETY: `p` was constructed from `&mut T` in `init` below; caller guarantees
            // `ctx` outlives this `RequireOrImportMetaCallback` (same contract as the Zig
            // `*anyopaque` erasure), so the cast-back deref is valid and exclusive.
            unsafe { (*p.cast::<T>()).require_or_import_meta_for_source(id, was_unwrapped_require) }
        }
        Self {
            // Type-erased to `*mut ()` and cast back to `*mut T` inside the thunk before dereference.
            ctx: Some(NonNull::from(ctx).cast::<()>()),
            callback: thunk::<T>,
        }
    }
}

fn is_identifier_or_numeric_constant_or_property_access(expr: &js_ast::Expr) -> bool {
    use js_ast::ExprData;
    match &expr.data {
        ExprData::EIdentifier(_) | ExprData::EDot(_) | ExprData::EIndex(_) => true,
        ExprData::ENumber(e) => e.value.is_infinite() || e.value.is_nan(),
        _ => false,
    }
}

pub enum PrintResult {
    Result(PrintResultSuccess),
    Err(bun_core::Error),
}

pub struct PrintResultSuccess {
    pub code: Box<[u8]>,
    pub source_map: Option<SourceMap::Chunk>,
}

// do not make this a packed struct
// stage1 compiler bug:
// > /optional-chain-with-function.js: Evaluation failed: TypeError: (intermediate value) is not a function
// this test failure was caused by the packed struct implementation
#[derive(enumset::EnumSetType)]
pub enum ExprFlag {
    ForbidCall,
    ForbidIn,
    HasNonOptionalChainParent,
    ExprResultIsUnused,
}

pub type ExprFlagSet = enumset::EnumSet<ExprFlag>;

impl ExprFlag {
    #[inline]
    pub fn none() -> ExprFlagSet {
        ExprFlagSet::empty()
    }
    #[inline]
    pub fn forbid_call() -> ExprFlagSet {
        ExprFlag::ForbidCall.into()
    }
    // PORT NOTE: Zig had `ForbidAnd` referencing `.forbid_and` which doesn't exist in the enum — dead code.
    #[inline]
    pub fn has_non_optional_chain_parent() -> ExprFlagSet {
        ExprFlag::HasNonOptionalChainParent.into()
    }
    #[inline]
    pub fn expr_result_is_unused() -> ExprFlagSet {
        ExprFlag::ExprResultIsUnused.into()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ImportVariant {
    PathOnly,
    ImportStar,
    ImportDefault,
    ImportStarAndImportDefault,
    ImportItems,
    ImportItemsAndDefault,
    ImportItemsAndStar,
    ImportItemsAndDefaultAndStar,
}

impl ImportVariant {
    #[inline]
    pub fn has_items(self) -> Self {
        match self {
            Self::ImportDefault => Self::ImportItemsAndDefault,
            Self::ImportStar => Self::ImportItemsAndStar,
            Self::ImportStarAndImportDefault => Self::ImportItemsAndDefaultAndStar,
            _ => Self::ImportItems,
        }
    }

    // We always check star first so don't need to be exhaustive here
    #[inline]
    pub fn has_star(self) -> Self {
        match self {
            Self::PathOnly => Self::ImportStar,
            _ => self,
        }
    }

    // We check default after star
    #[inline]
    pub fn has_default(self) -> Self {
        match self {
            Self::PathOnly => Self::ImportDefault,
            Self::ImportStar => Self::ImportStarAndImportDefault,
            _ => self,
        }
    }

    pub fn determine(record: &ImportRecord, s_import: &js_ast::S::Import) -> ImportVariant {
        let mut variant = ImportVariant::PathOnly;

        if record
            .flags
            .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
        {
            variant = variant.has_star();
        }

        if !record
            .flags
            .contains(ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT)
        {
            if !record
                .flags
                .contains(ImportRecordFlags::CONTAINS_DEFAULT_ALIAS)
            {
                if let Some(default_name) = &s_import.default_name {
                    if default_name.ref_.is_some() {
                        variant = variant.has_default();
                    }
                }
            } else {
                variant = variant.has_default();
            }
        }

        if !s_import.items.is_empty() {
            variant = variant.has_items();
        }

        variant
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ClauseItemAs {
    Import,
    Var,
    Export,
    ExportFrom,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IsTopLevel {
    Yes,
    VarOnly,
    No,
}

/// `MAY_HAVE_MODULE_INFO = IS_BUN_PLATFORM && !REWRITE_ESM_TO_CJS`
// TODO(port): const-generic associated const — written as a free fn until adt_const_params lands.
#[inline(always)]
pub const fn may_have_module_info(is_bun_platform: bool, rewrite_esm_to_cjs: bool) -> bool {
    is_bun_platform && !rewrite_esm_to_cjs
}

// PORT NOTE: Zig defined `TopLevelAndIsExport`/`TopLevel` as conditional zero-size structs when
// !may_have_module_info. In Rust we use one shape; dead-code elimination removes the unused
// fields when MAY_HAVE_MODULE_INFO is false.
#[derive(Clone, Copy, Default)]
pub struct TopLevelAndIsExport {
    pub is_export: bool,
    pub is_top_level: Option<analyze_transpiled_module::VarKind>,
}

#[derive(Clone, Copy)]
pub struct TopLevel {
    pub is_top_level: IsTopLevel,
}

impl TopLevel {
    #[inline]
    pub fn init(is_top_level: IsTopLevel) -> Self {
        Self { is_top_level }
    }
    pub fn sub_var(self) -> Self {
        if self.is_top_level == IsTopLevel::No {
            return Self::init(IsTopLevel::No);
        }
        Self::init(IsTopLevel::VarOnly)
    }
    #[inline]
    pub fn is_top_level(self) -> bool {
        self.is_top_level != IsTopLevel::No
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Printer (NewPrinter) — the impl body is the bulk of this crate and touches
// nearly every bun_js_parser AST node type. `bun_js_parser` now links, but the
// per-node API surface (op tables, FnFlags, BindingData dispatch, EString
// `.data()` accessor, ImportRecord flag fields) does not yet match the shapes
// the Phase-A draft assumed (~300 mismatches). Re-gated until those land.
// ───────────────────────────────────────────────────────────────────────────
// TODO(b2-blocked): bun_ast::g::FnFlags
// TODO(b2-blocked): bun_ast::binding::Data
// TODO(b2-blocked): bun_ast::op::{TABLE::get_ptr_const, Code::is_prefix}
// TODO(b2-blocked): bun_ast::e::EString::data
// TODO(b2-blocked): bun_ast::ImportRecordFlags field-style accessors (contains_import_star/wrap_with_to_esm/handles_import_errors)
// TODO(b2-blocked): bun_ast::ImportRecord::module_id
pub mod __gated_printer {
    use super::*;
    use bun_ast::ImportRecordTag;
    use bun_ptr::BackRef;
    use js_ast::Symbol;
    use js_ast::binding::{Binding, Data as BindingData, Tag as BindingTag};
    use js_ast::expr::{Data as ExprData, Expr};
    use js_ast::op::{Level, Op as OpInfo};
    use js_ast::stmt::{Data as StmtData, Stmt, Tag as StmtTag};
    use js_ast::{b as B, e as E, g as G, op as Op, s as S};

    // ──────────────────────────────────────────────────────────────────────────
    // Phase-B local helpers — bridge gaps between Phase-A draft and the real
    // lower-tier crate API surface without editing those crates.
    // ──────────────────────────────────────────────────────────────────────────

    /// Re-borrow an arena-owned `StoreSlice<T>` for the print pass. Kept as a
    /// free fn (vs. calling `.slice()` inline) so the ~50 call sites stay
    /// `.zig`-diffable; the printer only ever reads these.
    #[inline(always)]
    pub(crate) fn slice_of<'a, T>(p: js_ast::StoreSlice<T>) -> &'a [T] {
        p.slice()
    }
    /// `EnumSet<T>` field-style mutation as used by the Zig (`flags.x = true`).
    #[inline(always)]
    pub(crate) fn set_flag<T: enumset::EnumSetType>(
        set: &mut enumset::EnumSet<T>,
        flag: T,
        on: bool,
    ) {
        if on {
            set.insert(flag);
        } else {
            set.remove(flag);
        }
    }

    pub(crate) use bun_core::strings::encode_wtf8_rune as encode_wtf8_rune_t;
    /// `fn NewPrinter(...) type` → generic struct.
    pub struct Printer<
        'a,
        W,
        const ASCII_ONLY: bool,
        const REWRITE_ESM_TO_CJS: bool,
        const IS_BUN_PLATFORM: bool,
        const IS_JSON: bool,
        const GENERATE_SOURCE_MAP: bool,
    > {
        pub import_records: &'a [ImportRecord],

        pub needs_semicolon: bool,
        pub stmt_start: i32,
        pub options: Options<'a>,
        pub export_default_start: i32,
        pub arrow_expr_start: i32,
        pub for_of_init_start: i32,
        pub prev_op: Op::Code,
        pub prev_op_end: i32,
        pub prev_num_end: i32,
        pub prev_reg_exp_end: i32,
        pub call_target: Option<ExprData>,
        pub writer: W,

        pub has_printed_bundled_import_statement: bool,

        pub renamer: rename::Renamer<'a, 'a>,
        pub prev_stmt_tag: StmtTag,
        pub source_map_builder: SourceMap::chunk::Builder,

        pub symbol_counter: u32,

        pub temporary_bindings: Vec<B::Property>,

        pub binary_expression_stack: Vec<BinaryExpressionVisitor<'a>>,

        pub was_lazy_export: bool,
        // PORT NOTE: Zig used `if (!may_have_module_info) void else ?*ModuleInfo` — in Rust we always
        // carry the Option and gate at call sites with MAY_HAVE_MODULE_INFO.
        pub module_info: Option<&'a mut analyze_transpiled_module::ModuleInfo>,

        /// Arena for transient allocations during printing (rope flattening,
        /// UTF-16→UTF-8 transcoding). Zig: `p.options.allocator`.
        pub bump: &'a bun_alloc::Arena,
    }

    /// The handling of binary expressions is convoluted because we're using
    /// iteration on the heap instead of recursion on the call stack to avoid
    /// stack overflow for deeply-nested ASTs. See the comments for the similar
    /// code in the JavaScript parser for details.
    pub struct BinaryExpressionVisitor<'ast> {
        // Inputs
        // PORT NOTE: Zig stored `*const E.Binary`; Phase A keeps the StoreRef so the
        // visitor stack can outlive the by-value `Expr` argument to `print_expr`.
        pub e: js_ast::StoreRef<E::Binary>,
        _phantom: core::marker::PhantomData<&'ast ()>,
        pub level: Level,
        pub flags: ExprFlagSet,

        // Input for visiting the left child
        pub left_level: Level,
        pub left_flags: ExprFlagSet,

        // "Local variables" passed from "checkAndPrepare" to "visitRightAndFinish"
        pub entry: &'static OpInfo,
        pub wrap: bool,
        pub right_level: Level,
    }

    impl<'ast> Default for BinaryExpressionVisitor<'ast> {
        #[cold]
        #[inline(never)]
        fn default() -> Self {
            // TODO(port): `entry` defaulted to `undefined` in Zig; we need a sentinel &'static OpInfo.
            unreachable!("construct via fields")
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Printer methods
    // ───────────────────────────────────────────────────────────────────────────

    impl<
        'a,
        W,
        const ASCII_ONLY: bool,
        const REWRITE_ESM_TO_CJS: bool,
        const IS_BUN_PLATFORM: bool,
        const IS_JSON: bool,
        const GENERATE_SOURCE_MAP: bool,
    > Printer<'a, W, ASCII_ONLY, REWRITE_ESM_TO_CJS, IS_BUN_PLATFORM, IS_JSON, GENERATE_SOURCE_MAP>
    where
        W: WriterTrait,
    {
        pub const MAY_HAVE_MODULE_INFO: bool = IS_BUN_PLATFORM && !REWRITE_ESM_TO_CJS;

        /// When Printer is used as a io.Writer, this represents it's error type, aka nothing.
        // (Zig: `pub const Error = error{};`) — inherent associated types are
        // unstable; callers can name `core::convert::Infallible` directly.

        /// Reborrow the optional `ModuleInfo` for the duration of `&mut self`.
        /// Callers that need to interleave other `&mut self` calls (e.g.
        /// `name_for_symbol`) must fetch those values *before* calling this, then
        /// re-call `module_info()` — see PORTING.md §Forbidden re: lifetime-extend.
        #[inline]
        fn module_info(&mut self) -> Option<&mut analyze_transpiled_module::ModuleInfo> {
            if !Self::MAY_HAVE_MODULE_INFO {
                return None;
            }
            self.module_info.as_deref_mut()
        }

        // BinaryExpressionVisitor::checkAndPrepare
        fn binary_check_and_prepare(&mut self, v: &mut BinaryExpressionVisitor<'a>) -> bool {
            let e = v.e;

            let entry: &'static OpInfo = Op::TABLE.get_ptr_const(e.op);
            let e_level = entry.level;
            v.entry = entry;
            v.wrap = v.level.gte(e_level)
                || (e.op == Op::Code::BinIn && v.flags.contains(ExprFlag::ForbidIn));

            // Destructuring assignments must be parenthesized
            let n = self.writer.written();
            if n == self.stmt_start || n == self.arrow_expr_start {
                if let ExprData::EObject(_) = e.left.data {
                    v.wrap = true;
                }
            }

            if v.wrap {
                self.print(b"(");
                v.flags.insert(ExprFlag::ForbidIn);
            }

            v.left_level = e_level.sub(1);
            v.right_level = e_level.sub(1);

            if Op::Code::is_right_associative(e.op) {
                v.left_level = e_level;
            }

            if Op::Code::is_left_associative(e.op) {
                v.right_level = e_level;
            }

            match e.op {
                // "??" can't directly contain "||" or "&&" without being wrapped in parentheses
                Op::Code::BinNullishCoalescing => {
                    if let ExprData::EBinary(left) = &e.left.data {
                        if matches!(left.op, Op::Code::BinLogicalAnd | Op::Code::BinLogicalOr) {
                            v.left_level = Level::Prefix;
                        }
                    }
                    if let ExprData::EBinary(right) = &e.right.data {
                        if matches!(right.op, Op::Code::BinLogicalAnd | Op::Code::BinLogicalOr) {
                            v.right_level = Level::Prefix;
                        }
                    }
                }
                // "**" can't contain certain unary expressions
                Op::Code::BinPow => {
                    match &e.left.data {
                        ExprData::EUnary(left) => {
                            if Op::Code::unary_assign_target(left.op) == js_ast::AssignTarget::None
                            {
                                v.left_level = Level::Call;
                            }
                        }
                        ExprData::EAwait(_) | ExprData::EUndefined(_) | ExprData::ENumber(_) => {
                            v.left_level = Level::Call;
                        }
                        ExprData::EBoolean(_) | ExprData::EBranchBoolean(_) => {
                            // When minifying, booleans are printed as "!0 and "!1"
                            if self.options.minify_syntax {
                                v.left_level = Level::Call;
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }

            // Special-case "#foo in bar"
            if matches!(e.left.data, ExprData::EPrivateIdentifier(_)) && e.op == Op::Code::BinIn {
                let private = match &e.left.data {
                    ExprData::EPrivateIdentifier(p) => p,
                    _ => unreachable!(),
                };
                let name = self.name_for_symbol(private.ref_);
                self.add_source_mapping_for_name(e.left.loc, name, private.ref_);
                self.print_identifier(name);
                self.binary_visit_right_and_finish(v);
                return false;
            }

            v.left_flags = ExprFlagSet::empty();

            if v.flags.contains(ExprFlag::ForbidIn) {
                v.left_flags.insert(ExprFlag::ForbidIn);
            }

            if e.op == Op::Code::BinComma {
                v.left_flags.insert(ExprFlag::ExprResultIsUnused);
            }

            true
        }

        // BinaryExpressionVisitor::visitRightAndFinish
        fn binary_visit_right_and_finish(&mut self, v: &BinaryExpressionVisitor<'a>) {
            let e = v.e;
            let entry = v.entry;
            let mut flags = ExprFlagSet::empty();

            if e.op != Op::Code::BinComma {
                self.print_space();
            }

            if entry.is_keyword {
                self.print_space_before_identifier();
                self.print(entry.text);
            } else {
                self.print_space_before_operator(e.op);
                self.print(entry.text);
                self.prev_op = e.op;
                self.prev_op_end = self.writer.written();
            }

            self.print_space();

            // The result of the right operand of the comma operator is unused if the caller doesn't use it
            if e.op == Op::Code::BinComma && v.flags.contains(ExprFlag::ExprResultIsUnused) {
                flags.insert(ExprFlag::ExprResultIsUnused);
            }

            if v.flags.contains(ExprFlag::ForbidIn) {
                flags.insert(ExprFlag::ForbidIn);
            }

            self.print_expr(e.right, v.right_level, flags);

            if v.wrap {
                self.print(b")");
            }
        }

        pub fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
            self.print(bytes);
            Ok(())
        }

        pub fn write_byte_n_times(&mut self, byte: u8, n: usize) -> Result<(), bun_core::Error> {
            let bytes = [byte; 256];
            let mut remaining = n;
            while remaining > 0 {
                let to_write = remaining.min(bytes.len());
                self.write_all(&bytes[..to_write])?;
                remaining -= to_write;
            }
            Ok(())
        }

        pub fn write_bytes_n_times(
            &mut self,
            bytes: &[u8],
            n: usize,
        ) -> Result<(), bun_core::Error> {
            for _ in 0..n {
                self.write_all(bytes)?;
            }
            Ok(())
        }

        fn fmt(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), bun_core::Error> {
            // PERF(port): Zig used std.fmt.count + bufPrint into reserved space (no heap).
            // TODO(port): implement `count` over fmt::Arguments to match.
            let mut buf: Vec<u8> = Vec::new();
            Write::write_fmt(&mut buf, format_args!("{}", args)).expect("unreachable");
            self.writer.write_reserved(&buf)
        }

        pub fn print_buffer(&mut self, str: &[u8]) {
            self.writer.print_slice(str);
        }

        /// Fixed-size raw write into pre-reserved space (mirrors Zig's
        /// `p.writer.reserve(N) ...; p.writer.advance(N)` open-code on the
        /// number/identifier hot path). Skips the short-write/error bookkeeping
        /// in `print_slice`.
        #[inline(always)]
        fn print_reserved_n<const N: usize>(&mut self, bytes: &[u8; N]) {
            self.writer.write_reserved(bytes).expect("unreachable");
        }

        /// Polymorphic print: bytes or single char.
        pub fn print(&mut self, str: impl PrintArg) {
            str.print_into(&mut self.writer);
        }

        #[inline]
        pub fn unindent(&mut self) {
            self.options.indent.count = self.options.indent.count.saturating_sub(1);
        }
        #[inline]
        pub fn indent(&mut self) {
            self.options.indent.count += 1;
        }

        pub fn print_indent(&mut self) {
            if self.options.indent.count == 0 || self.options.minify_whitespace {
                return;
            }

            let indentation_buf: &[u8; 128] = match self.options.indent.character {
                IndentationCharacter::Space => &INDENTATION_SPACE_BUF,
                IndentationCharacter::Tab => &INDENTATION_TAB_BUF,
            };

            let mut i: usize = self.options.indent.count * self.options.indent.scalar;

            while i > 0 {
                let amt = i.min(indentation_buf.len());
                self.print(&indentation_buf[..amt]);
                i -= amt;
            }
        }

        pub fn mangled_prop_name(&mut self, ref_: Ref) -> &'a [u8] {
            let ref_ = self.symbols().follow(ref_);
            // TODO: we don't support that
            if let Some(mangled_props) = self.options.mangled_props {
                if let Some(name) = mangled_props.get(&ref_) {
                    return name;
                }
            }
            self.name_for_symbol(ref_)
        }

        #[inline]
        pub fn print_space(&mut self) {
            if !self.options.minify_whitespace {
                self.print(b" ");
            }
        }
        #[inline]
        pub fn print_newline(&mut self) {
            if !self.options.minify_whitespace {
                self.print(b"\n");
            }
        }
        #[inline]
        pub fn print_semicolon_after_statement(&mut self) {
            if !self.options.minify_whitespace {
                self.print(b";\n");
            } else {
                self.needs_semicolon = true;
            }
        }
        pub fn print_semicolon_if_needed(&mut self) {
            if self.needs_semicolon {
                self.print(b";");
                self.needs_semicolon = false;
            }
        }

        fn print_equals(&mut self) {
            if self.options.minify_whitespace {
                self.print(b"=");
            } else {
                self.print(b" = ");
            }
        }

        fn print_global_bun_import_statement(&mut self, import: &S::Import) {
            if !IS_BUN_PLATFORM {
                unreachable!();
            }
            self.print_internal_bun_import(import, Some(b"globalThis.Bun"));
        }

        fn print_internal_bun_import(
            &mut self,
            import: &S::Import,
            statement: Option<&'static [u8]>,
        ) {
            if !IS_BUN_PLATFORM {
                unreachable!();
            }

            if import.star_name_loc.is_some() {
                self.print(b"var ");
                self.print_symbol(import.namespace_ref);
                self.print_space();
                self.print(b"=");
                self.print_space_before_identifier();
                match statement {
                    None => self.print_require_or_import_expr(
                        import.import_record_index,
                        false,
                        &[],
                        Expr::EMPTY,
                        Level::Lowest,
                        ExprFlag::none(),
                    ),
                    Some(s) => self.print(s),
                }
                self.print_semicolon_after_statement();
                self.print_indent();
            }

            if let Some(default) = &import.default_name {
                self.print_semicolon_if_needed();
                self.print(b"var ");
                self.print_symbol(default.ref_.expect("infallible: ref bound"));
                match statement {
                    None => {
                        self.print_equals();
                        self.print_require_or_import_expr(
                            import.import_record_index,
                            false,
                            &[],
                            Expr::EMPTY,
                            Level::Lowest,
                            ExprFlag::none(),
                        );
                    }
                    Some(s) => {
                        self.print_equals();
                        self.print(s);
                    }
                }
                self.print_semicolon_after_statement();
            }

            if slice_of(import.items).len() > 0 {
                self.print_semicolon_if_needed();
                self.print_whitespacer(ws!(b"var {"));

                if !import.is_single_line {
                    self.print_newline();
                    self.indent();
                    self.print_indent();
                }

                for (i, item) in slice_of(import.items).iter().enumerate() {
                    if i > 0 {
                        self.print(b",");
                        self.print_space();
                        if !import.is_single_line {
                            self.print_newline();
                            self.print_indent();
                        }
                    }
                    self.print_clause_item_as(item, ClauseItemAs::Var);
                }

                if !import.is_single_line {
                    self.print_newline();
                    self.unindent();
                } else {
                    self.print_space();
                }

                self.print_whitespacer(ws!(b"} = "));

                if import.star_name_loc.is_none() && import.default_name.is_none() {
                    match statement {
                        None => self.print_require_or_import_expr(
                            import.import_record_index,
                            false,
                            &[],
                            Expr::EMPTY,
                            Level::Lowest,
                            ExprFlag::none(),
                        ),
                        Some(s) => self.print(s),
                    }
                } else if let Some(name) = &import.default_name {
                    self.print_symbol(name.ref_.expect("infallible: ref bound"));
                } else {
                    self.print_symbol(import.namespace_ref);
                }

                self.print_semicolon_after_statement();
            }

            // Record var declarations for module_info. printGlobalBunImportStatement
            // bypasses printDeclStmt/printBinding, so we must record vars explicitly.
            // PORT NOTE: reshaped for borrowck — compute names before borrowing module_info.
            if Self::MAY_HAVE_MODULE_INFO && self.module_info.is_some() {
                if import.star_name_loc.is_some() {
                    let name = self.name_for_symbol(import.namespace_ref);
                    let mi = self.module_info().expect("infallible: module_info enabled");
                    let id = mi.str(name);
                    mi.add_var(id, analyze_transpiled_module::VarKind::Declared);
                }
                if let Some(default) = &import.default_name {
                    let name = self.name_for_symbol(default.ref_.expect("infallible: ref bound"));
                    let mi = self.module_info().expect("infallible: module_info enabled");
                    let id = mi.str(name);
                    mi.add_var(id, analyze_transpiled_module::VarKind::Declared);
                }
                for item in slice_of(import.items).iter() {
                    let name = self.name_for_symbol(item.name.ref_.expect("infallible: ref bound"));
                    let mi = self.module_info().expect("infallible: module_info enabled");
                    let id = mi.str(name);
                    mi.add_var(id, analyze_transpiled_module::VarKind::Declared);
                }
            }
        }

        #[inline]
        pub fn print_space_before_identifier(&mut self) {
            if self.writer.written() > 0
                && (lexer::is_identifier_continue(self.writer.prev_char() as i32)
                    || self.writer.written() == self.prev_reg_exp_end)
            {
                self.print(b" ");
            }
        }

        #[inline]
        pub fn maybe_print_space(&mut self) {
            match self.writer.prev_char() {
                0 | b' ' | b'\n' => {}
                _ => self.print(b" "),
            }
        }

        pub fn print_dot_then_prefix(&mut self) -> Level {
            self.print(b".then(() => ");
            Level::Comma
        }

        #[inline]
        pub fn print_undefined(&mut self, loc: bun_ast::Loc, level: Level) {
            if self.options.minify_syntax {
                if level.gte(Level::Prefix) {
                    self.add_source_mapping(loc);
                    self.print(b"(void 0)");
                } else {
                    self.print_space_before_identifier();
                    self.add_source_mapping(loc);
                    self.print(b"void 0");
                }
            } else {
                self.print_space_before_identifier();
                self.add_source_mapping(loc);
                self.print(b"undefined");
            }
        }

        pub fn print_body(&mut self, stmt: Stmt, tlmtlo: TopLevel) {
            match &stmt.data {
                StmtData::SBlock(block) => {
                    self.print_space();
                    self.print_block(
                        stmt.loc,
                        slice_of(block.stmts),
                        Some(block.close_brace_loc),
                        tlmtlo,
                    );
                    self.print_newline();
                }
                _ => {
                    self.print_newline();
                    self.indent();
                    self.print_stmt(stmt, tlmtlo).expect("unreachable");
                    self.unindent();
                }
            }
        }

        pub fn print_block_body(&mut self, stmts: &[Stmt], tlmtlo: TopLevel) {
            for stmt in stmts {
                self.print_semicolon_if_needed();
                self.print_stmt(*stmt, tlmtlo).expect("unreachable");
            }
        }

        pub fn print_block(
            &mut self,
            loc: bun_ast::Loc,
            stmts: &[Stmt],
            close_brace_loc: Option<bun_ast::Loc>,
            tlmtlo: TopLevel,
        ) {
            self.add_source_mapping(loc);
            self.print(b"{");
            if !stmts.is_empty() {
                // @branchHint(.likely)
                self.print_newline();
                self.indent();
                self.print_block_body(stmts, tlmtlo);
                self.unindent();
                self.print_indent();
            }
            if let Some(cbl) = close_brace_loc {
                if cbl.start > loc.start {
                    self.add_source_mapping(cbl);
                }
            }
            self.print(b"}");
            self.needs_semicolon = false;
        }

        pub fn print_two_blocks_in_one(
            &mut self,
            loc: bun_ast::Loc,
            stmts: &[Stmt],
            prepend: &[Stmt],
        ) {
            self.add_source_mapping(loc);
            self.print(b"{");
            self.print_newline();

            self.indent();
            self.print_block_body(prepend, TopLevel::init(IsTopLevel::No));
            self.print_block_body(stmts, TopLevel::init(IsTopLevel::No));
            self.unindent();
            self.needs_semicolon = false;

            self.print_indent();
            self.print(b"}");
        }

        pub fn print_decls(
            &mut self,
            keyword: &'static [u8],
            decls_: &[G::Decl],
            flags: ExprFlagSet,
            tlm: TopLevelAndIsExport,
        ) {
            self.print(keyword);
            self.print_space();
            let mut decls = decls_;

            if decls.is_empty() {
                // "var ;" is invalid syntax
                // assert we never reach it
                unreachable!();
            }

            if bun_core::FeatureFlags::SAME_TARGET_BECOMES_DESTRUCTURING {
                // Minify
                //
                //    var a = obj.foo, b = obj.bar, c = obj.baz;
                //
                // to
                //
                //    var {a, b, c} = obj;
                //
                // Caveats:
                //   - Same consecutive target
                //   - No optional chaining
                //   - No computed property access
                //   - Identifier bindings only
                'brk: {
                    if decls.len() <= 1 {
                        break 'brk;
                    }
                    let first_decl = &decls[0];
                    let second_decl = &decls[1];

                    if !matches!(first_decl.binding.data, BindingData::BIdentifier(_)) {
                        break 'brk;
                    }
                    if second_decl.value.is_none()
                        || !matches!(second_decl.value.as_ref().unwrap().data, ExprData::EDot(_))
                        || !matches!(second_decl.binding.data, BindingData::BIdentifier(_))
                    {
                        break 'brk;
                    }

                    let Some(target_value) = &first_decl.value else {
                        break 'brk;
                    };
                    let ExprData::EDot(target_e_dot) = &target_value.data else {
                        break 'brk;
                    };
                    let target_ref = if matches!(target_e_dot.target.data, ExprData::EIdentifier(_))
                        && target_e_dot.optional_chain.is_none()
                    {
                        match &target_e_dot.target.data {
                            ExprData::EIdentifier(id) => id.ref_,
                            _ => unreachable!(),
                        }
                    } else {
                        break 'brk;
                    };

                    let second_e_dot = match &second_decl.value.as_ref().unwrap().data {
                        ExprData::EDot(d) => d,
                        _ => unreachable!(),
                    };
                    if !matches!(second_e_dot.target.data, ExprData::EIdentifier(_))
                        || second_e_dot.optional_chain.is_some()
                    {
                        break 'brk;
                    }

                    let second_ref = match &second_e_dot.target.data {
                        ExprData::EIdentifier(id) => id.ref_,
                        _ => unreachable!(),
                    };
                    if !second_ref.eql(target_ref) {
                        break 'brk;
                    }

                    {
                        // Reset the temporary bindings array early on
                        let mut temp_bindings = core::mem::take(&mut self.temporary_bindings);
                        temp_bindings.reserve(2);
                        // PERF(port): was appendAssumeCapacity — profile
                        temp_bindings.push(B::Property {
                            flags: Default::default(),
                            key: Expr::init(
                                E::String::init(&target_e_dot.name),
                                target_e_dot.name_loc,
                            ),
                            value: decls[0].binding,
                            default_value: None,
                        });
                        temp_bindings.push(B::Property {
                            flags: Default::default(),
                            key: Expr::init(
                                E::String::init(&second_e_dot.name),
                                second_e_dot.name_loc,
                            ),
                            value: decls[1].binding,
                            default_value: None,
                        });

                        decls = &decls[2..];
                        while !decls.is_empty() {
                            let decl = &decls[0];

                            if decl.value.is_none()
                                || !matches!(decl.value.as_ref().unwrap().data, ExprData::EDot(_))
                                || !matches!(decl.binding.data, BindingData::BIdentifier(_))
                            {
                                break;
                            }

                            let e_dot = match &decl.value.as_ref().unwrap().data {
                                ExprData::EDot(d) => *d,
                                _ => unreachable!(),
                            };
                            if !matches!(e_dot.target.data, ExprData::EIdentifier(_))
                                || e_dot.optional_chain.is_some()
                            {
                                break;
                            }

                            let ref_ = match &e_dot.target.data {
                                ExprData::EIdentifier(id) => id.ref_,
                                _ => unreachable!(),
                            };
                            if !ref_.eql(target_ref) {
                                break;
                            }

                            temp_bindings.push(B::Property {
                                flags: Default::default(),
                                key: Expr::init(E::String::init(&e_dot.name), e_dot.name_loc),
                                value: decl.binding,
                                default_value: None,
                            });
                            decls = &decls[1..];
                        }
                        let mut b_object = B::Object {
                            // SAFETY: `temp_bindings`' heap buffer is stable until the
                            // matching clear()/drop below; `print_binding` only reads it.
                            properties: js_ast::StoreSlice::new_mut(temp_bindings.as_mut_slice()),
                            is_single_line: true,
                        };
                        // PORT NOTE: `Binding::init(*B.Object, loc)` is gated upstream;
                        // inline its body — it just tags the union and copies `loc`.
                        // `from_bump` wraps a `&mut T` as a non-null arena ref; here the
                        // pointee is a stack local but `print_binding` only reads it and
                        // returns before `b_object` is dropped (same as the prior `&raw mut`).
                        let binding = Binding {
                            loc: target_e_dot.target.loc,
                            data: BindingData::BObject(js_ast::StoreRef::from_bump(&mut b_object)),
                        };
                        self.print_binding(binding, tlm);
                        // Zig defer (js_printer.zig:1252): if recursion replaced
                        // `self.temporary_bindings`, drop our local; else clear+restore.
                        if self.temporary_bindings.capacity() > 0 {
                            drop(temp_bindings);
                        } else {
                            temp_bindings.clear();
                            self.temporary_bindings = temp_bindings;
                        }
                    }

                    self.print_whitespacer(ws!(b" = "));
                    self.print_expr(second_e_dot.target, Level::Comma, flags);

                    if decls.is_empty() {
                        return;
                    }

                    self.print(b",");
                    self.print_space();
                }
            }

            {
                self.print_binding(decls[0].binding, tlm);

                if let Some(value) = &decls[0].value {
                    self.print_whitespacer(ws!(b" = "));
                    self.print_expr(*value, Level::Comma, flags);
                }
            }

            for decl in &decls[1..] {
                self.print(b",");
                self.print_space();

                self.print_binding(decl.binding, tlm);

                if let Some(value) = &decl.value {
                    self.print_whitespacer(ws!(b" = "));
                    self.print_expr(*value, Level::Comma, flags);
                }
            }
        }

        #[inline]
        pub fn add_source_mapping(&mut self, location: bun_ast::Loc) {
            if !GENERATE_SOURCE_MAP {
                return;
            }
            self.source_map_builder
                .add_source_mapping(location, self.writer.slice());
        }

        #[inline]
        pub fn add_source_mapping_for_name(
            &mut self,
            location: bun_ast::Loc,
            _name: &[u8],
            _ref: Ref,
        ) {
            if !GENERATE_SOURCE_MAP {
                return;
            }
            // TODO: esbuild does this to make the source map more accurate with E.NameOfSymbol
            self.add_source_mapping(location);
        }

        pub fn print_symbol(&mut self, ref_: Ref) {
            debug_assert!(!ref_.is_empty()); // Invalid Symbol
            let name = self.name_for_symbol(ref_);
            self.print_identifier(name);
        }

        pub fn print_clause_alias(&mut self, alias: &[u8]) {
            debug_assert!(!alias.is_empty());

            if !strings::contains_non_bmp_code_point_or_is_invalid_identifier(alias) {
                self.print_space_before_identifier();
                self.print_identifier(alias);
            } else {
                self.print_string_literal_utf8(alias, false);
            }
        }

        pub fn print_fn_args(
            &mut self,
            open_paren_loc: Option<bun_ast::Loc>,
            args: &[G::Arg],
            has_rest_arg: bool,
            // is_arrow can be used for minifying later
            _is_arrow: bool,
        ) {
            let wrap = true;

            if wrap {
                if let Some(loc) = open_paren_loc {
                    self.add_source_mapping(loc);
                }
                self.print(b"(");
            }

            for (i, arg) in args.iter().enumerate() {
                if i != 0 {
                    self.print(b",");
                    self.print_space();
                }

                if has_rest_arg && i + 1 == args.len() {
                    self.print(b"...");
                }

                self.print_binding(arg.binding, TopLevelAndIsExport::default());

                if let Some(default) = &arg.default {
                    self.print_whitespacer(ws!(b" = "));
                    self.print_expr(*default, Level::Comma, ExprFlag::none());
                }
            }

            if wrap {
                self.print(b")");
            }
        }

        pub fn print_func(&mut self, func: &G::Fn) {
            self.print_fn_args(
                Some(func.open_parens_loc),
                slice_of(func.args),
                func.flags.contains(G::FnFlags::HasRestArg),
                false,
            );
            self.print_space();
            self.print_block(
                func.body.loc,
                slice_of(func.body.stmts),
                None,
                TopLevel::init(IsTopLevel::No),
            );
        }

        pub fn print_class(&mut self, class: &G::Class) {
            if let Some(extends) = &class.extends {
                self.print(b" extends");
                self.print_space();
                self.print_expr(*extends, Level::New.sub(1), ExprFlag::none());
            }

            self.print_space();

            self.add_source_mapping(class.body_loc);
            self.print(b"{");
            self.print_newline();
            self.indent();

            for item in slice_of(class.properties).iter() {
                self.print_semicolon_if_needed();
                self.print_indent();

                if item.kind == G::PropertyKind::ClassStaticBlock {
                    self.print(b"static");
                    self.print_space();
                    let csb = item.class_static_block_ref().unwrap();
                    self.print_block(
                        csb.loc,
                        csb.stmts.slice(),
                        None,
                        TopLevel::init(IsTopLevel::No),
                    );
                    self.print_newline();
                    continue;
                }

                self.print_property(item);

                if item.value.is_none() {
                    self.print_semicolon_after_statement();
                } else {
                    self.print_newline();
                }
            }

            self.needs_semicolon = false;
            self.unindent();
            self.print_indent();
            if class.close_brace_loc.start > class.body_loc.start {
                self.add_source_mapping(class.close_brace_loc);
            }
            self.print(b"}");
        }

        pub fn best_quote_char_for_e_string(str: &E::String, allow_backtick: bool) -> u8 {
            if IS_JSON {
                return b'"';
            }
            if str.is_utf8() {
                best_quote_char_for_string(str.slice8(), allow_backtick)
            } else {
                best_quote_char_for_string(str.slice16(), allow_backtick)
            }
        }

        pub fn print_whitespacer(&mut self, spacer: Whitespacer) {
            if self.options.minify_whitespace {
                self.print(spacer.minify);
            } else {
                self.print(spacer.normal);
            }
        }

        pub fn print_non_negative_float(&mut self, float: f64) {
            // Is this actually an integer?
            // PORT NOTE: @setRuntimeSafety(false) / @setFloatMode(.optimized) have no Rust equivalent.
            let floored = float.floor();
            let remainder = float - floored;
            let is_integer = remainder == 0.0;
            if float < (u64::MAX >> 12) as f64 /* maxInt(u52) */ && is_integer {
                // In JavaScript, numbers are represented as 64 bit floats
                // However, they could also be signed or unsigned int 32 (when doing bit shifts)
                // In this case, it's always going to unsigned since that conversion has already happened.
                let val = float as u64;
                if let Some(e) = bun_core::fmt::pow10_exp_1e4_to_1e9(val) {
                    self.print(b"1e");
                    self.print(&[b'0' + e]);
                    return;
                }
                let mut buf = bun_core::fmt::ItoaBuf::new();
                self.print(bun_core::fmt::itoa(&mut buf, val));
                return;
            }

            // TODO(port): Zig "{d}" on f64 — need shortest-round-trip formatter (ryu) to match output exactly.
            let _ = self.fmt(format_args!("{}", float));
        }

        pub fn print_string_characters_utf8(&mut self, text: &[u8], quote: u8) {
            debug_assert!(matches!(quote, b'\'' | b'"' | b'`'));
            let mut writer = self.writer.std_writer();
            let _ = write_pre_quoted_string_inner::<_, { Encoding::Utf8 }>(
                text,
                &mut writer,
                quote,
                ASCII_ONLY,
                false,
            );
        }

        pub fn print_string_characters_utf16(&mut self, text: &[u16], quote: u8) {
            debug_assert!(matches!(quote, b'\'' | b'"' | b'`'));
            let slice: &[u8] = bytemuck::cast_slice(text);
            let mut writer = self.writer.std_writer();
            let _ = write_pre_quoted_string_inner::<_, { Encoding::Utf16 }>(
                slice,
                &mut writer,
                quote,
                ASCII_ONLY,
                false,
            );
        }

        pub fn is_unbound_eval_identifier(&self, value: Expr) -> bool {
            match &value.data {
                ExprData::EIdentifier(ident) => {
                    if ident.ref_.is_source_contents_slice() {
                        return false;
                    }
                    let Some(symbol) = self.symbols().get_const(self.symbols().follow(ident.ref_))
                    else {
                        return false;
                    };
                    symbol.kind == js_ast::symbol::Kind::Unbound
                        && symbol.original_name.slice() == b"eval"
                }
                _ => false,
            }
        }

        #[inline]
        fn symbols(&self) -> &js_ast::symbol::Map {
            self.renamer.symbols()
        }

        /// Borrowck-reshape helper: `Renamer::name_for_symbol` returns a slice
        /// borrowing `&mut self.renamer`, which conflicts with the immediately
        /// following `self.print_*` call. The returned bytes always point into
        /// either the AST arena (`Symbol::original_name: *const [u8]`) or the
        /// `Source::contents` buffer — both are kept alive for `'a` by the
        /// caller of `Printer::init`. Detach the borrow to a raw ptr per the
        /// Phase-A ARENA convention (matching `slice_of` for AST fields).
        /// // PORT NOTE: reshaped for borrowck — Phase B threads `'bump` through Renamer.
        #[inline]
        fn name_for_symbol(&mut self, ref_: Ref) -> &'a [u8] {
            let p = std::ptr::from_ref::<[u8]>(self.renamer.name_for_symbol(ref_));
            // SAFETY: arena/source-backed; outlives 'a (see renamer.rs SAFETY notes).
            unsafe { &*p }
        }

        // Emitting a `throw` shim is a diagnostic/error path — keep it out of the
        // hot `.text` so it lands in `.text.unlikely` even without PGO.
        #[cold]
        #[inline(never)]
        pub fn print_require_error(&mut self, text: &[u8]) {
            self.print(b"(()=>{throw new Error(\"Cannot require module \"+");
            self.print_string_literal_utf8(text, false);
            self.print(b");})()");
        }

        #[inline]
        pub fn import_record(&self, import_record_index: usize) -> &'a ImportRecord {
            // PORT NOTE: detached from `&self` so callers can interleave `&mut self` printing.
            &self.import_records[import_record_index]
        }

        pub fn is_unbound_identifier(&self, expr: &Expr) -> bool {
            let ExprData::EIdentifier(id) = &expr.data else {
                return false;
            };
            let ref_ = id.ref_;
            let Some(symbol) = self.symbols().get_const(self.symbols().follow(ref_)) else {
                return false;
            };
            symbol.kind == js_ast::symbol::Kind::Unbound
        }

        pub fn print_require_or_import_expr(
            &mut self,
            import_record_index: u32,
            was_unwrapped_require: bool,
            leading_interior_comments: &[G::Comment],
            import_options: Expr,
            level_: Level,
            flags: ExprFlagSet,
        ) {
            let _ = leading_interior_comments; // TODO:

            let mut level = level_;
            let wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
            if wrap {
                self.print(b"(");
            }
            // PORT NOTE: Zig used `defer if (wrap) p.print(")")`. We close at every `return` below.

            debug_assert!(self.import_records.len() > import_record_index as usize);
            let record = self.import_record(import_record_index as usize);
            let module_type = self.options.module_type;

            if IS_BUN_PLATFORM {
                // "bun" is not a real module. It's just globalThis.Bun.
                //
                //  transform from:
                //      const foo = await import("bun")
                //      const bar = require("bun")
                //
                //  transform to:
                //      const foo = await Promise.resolve(globalThis.Bun)
                //      const bar = globalThis.Bun
                //
                if record.tag == ImportRecordTag::Bun {
                    if record.kind == ImportKind::Dynamic {
                        self.print(b"Promise.resolve(globalThis.Bun)");
                        if wrap {
                            self.print(b")");
                        }
                        return;
                    } else if record.kind == ImportKind::Require || record.kind == ImportKind::Stmt
                    {
                        self.print(b"globalThis.Bun");
                        if wrap {
                            self.print(b")");
                        }
                        return;
                    }
                }
            }

            if record.source_index.is_valid() {
                let mut meta = self.options.require_or_import_meta_for_source(
                    record.source_index.get(),
                    was_unwrapped_require,
                );

                // Don't need the namespace object if the result is unused anyway
                if flags.contains(ExprFlag::ExprResultIsUnused) {
                    meta.exports_ref = Ref::NONE;
                }

                // Internal "import()" of async ESM
                if record.kind == ImportKind::Dynamic && meta.is_wrapper_async {
                    self.print_space_before_identifier();
                    self.print_symbol(meta.wrapper_ref);
                    self.print(b"()");
                    if meta.exports_ref.is_valid() {
                        let _ = self.print_dot_then_prefix();
                        self.print_space_before_identifier();
                        self.print_symbol(meta.exports_ref);
                        self.print_dot_then_suffix();
                    }
                    if wrap {
                        self.print(b")");
                    }
                    return;
                }

                // Internal "require()" or "import()"
                let has_side_effects = meta.wrapper_ref.is_valid()
                    || meta.exports_ref.is_valid()
                    || meta.was_unwrapped_require
                    || self.options.input_files_for_dev_server.is_some();
                if record.kind == ImportKind::Dynamic {
                    self.print_space_before_identifier();
                    self.print(b"Promise.resolve()");
                    if has_side_effects {
                        level = self.print_dot_then_prefix();
                    }
                }

                // Make sure the comma operator is properly wrapped
                let wrap_comma_operator = meta.exports_ref.is_valid()
                    && meta.wrapper_ref.is_valid()
                    && level.gte(Level::Comma);
                if wrap_comma_operator {
                    self.print(b"(");
                }

                // Wrap this with a call to "__toESM()" if this is a CommonJS file
                let wrap_with_to_esm = record.flags.contains(ImportRecordFlags::WRAP_WITH_TO_ESM);
                if wrap_with_to_esm {
                    self.print_space_before_identifier();
                    self.print_symbol(self.options.to_esm_ref);
                    self.print(b"(");
                }

                if let Some(input_files) = self.options.input_files_for_dev_server {
                    debug_assert!(module_type == bundle_opts::Format::InternalBakeDev);
                    self.print_space_before_identifier();
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".require(");
                    let path = &input_files[record.source_index.get() as usize].path;
                    self.print_string_literal_utf8(path.pretty, false);
                    self.print(b")");
                } else if !meta.was_unwrapped_require {
                    // Call the wrapper
                    if meta.wrapper_ref.is_valid() {
                        self.print_space_before_identifier();
                        self.print_symbol(meta.wrapper_ref);
                        self.print(b"()");

                        if meta.exports_ref.is_valid() {
                            self.print(b",");
                            self.print_space();
                        }
                    }

                    // Return the namespace object if this is an ESM file
                    if meta.exports_ref.is_valid() {
                        // Wrap this with a call to "__toCommonJS()" if this is an ESM file
                        let wrap_with_to_cjs = record
                            .flags
                            .contains(ImportRecordFlags::WRAP_WITH_TO_COMMONJS);
                        if wrap_with_to_cjs {
                            self.print_symbol(self.options.to_commonjs_ref);
                            self.print(b"(");
                        }
                        self.print_symbol(meta.exports_ref);
                        if wrap_with_to_cjs {
                            self.print(b")");
                        }
                    }
                } else {
                    if !meta.exports_ref.is_empty() {
                        self.print_symbol(meta.exports_ref);
                    }
                }

                if wrap_with_to_esm {
                    if self.options.input_module_type == bundle_opts::ModuleType::Esm {
                        self.print(b",");
                        self.print_space();
                        self.print(b"1");
                    }
                    self.print(b")");
                }

                if wrap_comma_operator {
                    self.print(b")");
                }
                if record.kind == ImportKind::Dynamic && has_side_effects {
                    self.print_dot_then_suffix();
                }
                if wrap {
                    self.print(b")");
                }
                return;
            }

            // External "require()"
            if record.kind != ImportKind::Dynamic {
                self.print_space_before_identifier();

                if self.options.inline_require_and_import_errors {
                    if record.path.is_disabled
                        && record
                            .flags
                            .contains(ImportRecordFlags::HANDLES_IMPORT_ERRORS)
                    {
                        self.print_require_error(&record.path.text);
                        if wrap {
                            self.print(b")");
                        }
                        return;
                    }

                    if record.path.is_disabled {
                        self.print_disabled_import();
                        if wrap {
                            self.print(b")");
                        }
                        return;
                    }
                }

                let wrap_with_to_esm = record.flags.contains(ImportRecordFlags::WRAP_WITH_TO_ESM);

                if module_type == bundle_opts::Format::InternalBakeDev {
                    self.print_space_before_identifier();
                    self.print_symbol(self.options.hmr_ref);
                    if record.tag == ImportRecordTag::Builtin {
                        self.print(b".builtin(");
                    } else {
                        self.print(b".require(");
                    }
                    let path = &record.path;
                    self.print_string_literal_utf8(&path.pretty, false);
                    self.print(b")");
                    if wrap {
                        self.print(b")");
                    }
                    return;
                } else if wrap_with_to_esm {
                    self.print_space_before_identifier();
                    self.print_symbol(self.options.to_esm_ref);
                    self.print(b"(");
                }

                if let Some(ref_) = self.options.require_ref {
                    self.print_symbol(ref_);
                } else {
                    self.print(b"require");
                }

                self.print(b"(");
                self.print_import_record_path(record);
                self.print(b")");

                if wrap_with_to_esm {
                    self.print(b")");
                }
                if wrap {
                    self.print(b")");
                }
                return;
            }

            // External import()
            self.add_source_mapping(record.range.loc);

            self.print_space_before_identifier();

            // Wrap with __toESM if importing a CommonJS module
            let wrap_with_to_esm = record.flags.contains(ImportRecordFlags::WRAP_WITH_TO_ESM);

            // Allow it to fail at runtime, if it should
            if module_type != bundle_opts::Format::InternalBakeDev {
                self.print(b"import(");
                self.print_import_record_path(record);
            } else {
                self.print_symbol(self.options.hmr_ref);
                self.print(b".dynamicImport(");
                let path = &record.path;
                self.print_string_literal_utf8(&path.pretty, false);
            }

            if !import_options.is_missing() {
                self.print_whitespacer(ws!(b", "));
                self.print_expr(import_options, Level::Comma, ExprFlagSet::empty());
            }

            self.print(b")");

            // For CJS modules, unwrap the default export and convert to ESM
            if wrap_with_to_esm {
                self.print(b".then((m)=>");
                self.print_symbol(self.options.to_esm_ref);
                self.print(b"(m.default");
                if self.options.input_module_type == bundle_opts::ModuleType::Esm {
                    self.print(b",1");
                }
                self.print(b"))");
            }

            if wrap {
                self.print(b")");
            }
        }

        #[inline]
        pub fn print_pure(&mut self) {
            if self.options.print_dce_annotations {
                self.print_whitespacer(ws!(b"/* @__PURE__ */ "));
            }
        }

        pub fn print_string_literal_e_string(&mut self, str: &E::String, allow_backtick: bool) {
            let quote = Self::best_quote_char_for_e_string(str, allow_backtick);
            self.print(quote);
            self.print_string_characters_e_string(str, quote);
            self.print(quote);
        }

        pub fn print_string_literal_utf8(&mut self, str: &[u8], allow_backtick: bool) {
            // TODO(b2-blocked): bun_core::wtf8_validate_slice — debug-only assert dropped.

            let quote = if !IS_JSON {
                best_quote_char_for_string(str, allow_backtick)
            } else {
                b'"'
            };

            self.print(quote);
            self.print_string_characters_utf8(str, quote);
            self.print(quote);
        }

        fn print_clause_item(&mut self, item: &js_ast::ClauseItem) {
            self.print_clause_item_as(item, ClauseItemAs::Import)
        }

        fn print_export_clause_item(&mut self, item: &js_ast::ClauseItem) {
            self.print_clause_item_as(item, ClauseItemAs::Export)
        }

        fn print_export_from_clause_item(&mut self, item: &js_ast::ClauseItem) {
            self.print_clause_item_as(item, ClauseItemAs::ExportFrom)
        }

        fn print_clause_item_as(&mut self, item: &js_ast::ClauseItem, as_: ClauseItemAs) {
            let name = self.name_for_symbol(item.name.ref_.expect("infallible: ref bound"));

            match as_ {
                ClauseItemAs::Import => {
                    if name == item.alias.slice() {
                        self.print_identifier(name);
                    } else {
                        self.print_clause_alias(item.alias.slice());
                        self.print(b" as ");
                        self.add_source_mapping(item.alias_loc);
                        self.print_identifier(name);
                    }
                }
                ClauseItemAs::Var => {
                    self.print_clause_alias(item.alias.slice());
                    if name != item.alias.slice() {
                        self.print(b":");
                        self.print_space();
                        self.print_identifier(name);
                    }
                }
                ClauseItemAs::Export => {
                    self.print_identifier(name);
                    if name != item.alias.slice() {
                        self.print(b" as ");
                        self.add_source_mapping(item.alias_loc);
                        self.print_clause_alias(item.alias.slice());
                    }
                }
                ClauseItemAs::ExportFrom => {
                    // In `export { x } from 'mod'`, the "name" on the left of `as`
                    // refers to an export of the other module, not a local binding.
                    // It's stored as the raw source text on `item.original_name`
                    // (ECMAScript allows this to be a string literal like `"a b c"`)
                    // and the item's ref points to a synthesized intermediate symbol
                    // whose display name may be mangled by a minifier. We must print
                    // `original_name` via `printClauseAlias` so string literals stay
                    // quoted and mangling can't corrupt the foreign-module name.
                    let original = item.original_name.slice();
                    let from_name = if !original.is_empty() { original } else { name };
                    self.print_clause_alias(from_name);

                    if from_name != item.alias.slice() {
                        self.print(b" as ");
                        self.add_source_mapping(item.alias_loc);
                        self.print_clause_alias(item.alias.slice());
                    }
                }
            }
        }

        #[inline]
        pub fn can_print_identifier_utf16(&self, name: &[u16]) -> bool {
            if ASCII_ONLY || ASCII_ONLY_ALWAYS_ON_UNLESS_MINIFYING {
                lexer::is_latin1_identifier_u16(name)
            } else {
                lexer::is_identifier_utf16(name)
            }
        }

        fn print_raw_template_literal(&mut self, bytes: &[u8]) {
            if IS_JSON || !ASCII_ONLY {
                self.print(bytes);
                return;
            }

            // Translate any non-ASCII to unicode escape sequences
            // Note that this does not correctly handle malformed template literal strings
            // template literal strings can contain invalid unicode code points
            // and pretty much anything else
            //
            // we use WTF-8 here, but that's still not good enough.
            //
            let mut ascii_start: usize = 0;
            let mut is_ascii = false;
            let mut iter = CodepointIterator::init(bytes);
            let mut cursor = strings::Cursor::default();

            while iter.next(&mut cursor) {
                match cursor.c as u32 {
                    // unlike other versions, we only want to mutate > 0x7F
                    0..=LAST_ASCII => {
                        if !is_ascii {
                            ascii_start = (cursor.i as usize);
                            is_ascii = true;
                        }
                    }
                    _ => {
                        if is_ascii {
                            self.print(&bytes[ascii_start..(cursor.i as usize)]);
                            is_ascii = false;
                        }

                        match cursor.c as u32 {
                            c @ 0..=0xFFFF => self.print(&bmp_escape(c)[..]),
                            _ => {
                                self.print(b"\\u{");
                                let _ = self.fmt(format_args!("{:x}", cursor.c));
                                self.print(b"}");
                            }
                        }
                    }
                }
            }

            if is_ascii {
                self.print(&bytes[ascii_start..]);
            }
        }

        pub fn print_expr(&mut self, expr: Expr, level: Level, in_flags: ExprFlagSet) {
            let mut flags = in_flags;

            match &expr.data {
                ExprData::EMissing(_) => {}
                ExprData::EUndefined(_) => {
                    self.add_source_mapping(expr.loc);
                    self.print_undefined(expr.loc, level);
                }
                ExprData::ESuper(_) => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"super");
                }
                ExprData::ENull(_) => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"null");
                }
                ExprData::EThis(_) => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"this");
                }
                ExprData::ESpread(e) => {
                    self.add_source_mapping(expr.loc);
                    self.print(b"...");
                    self.print_expr(e.value, Level::Comma, ExprFlag::none());
                }
                ExprData::ENewTarget(_) => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"new.target");
                }
                ExprData::EImportMeta(_) => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    if self.options.module_type == bundle_opts::Format::InternalBakeDev {
                        debug_assert!(self.options.hmr_ref.is_valid());
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".importMeta");
                    } else if !self.options.import_meta_ref.is_valid() {
                        // Most of the time, leave it in there
                        if let Some(mi) = self.module_info() {
                            mi.flags.contains_import_meta = true;
                        }
                        self.print(b"import.meta");
                    } else {
                        // Note: The bundler will not hit this code path. The bundler will replace
                        // the ImportMeta AST node with a regular Identifier AST node.
                        //
                        // This is currently only used in Bun's runtime for CommonJS modules
                        // referencing import.meta
                        //
                        // TODO: This assertion trips when using `import.meta` with `--format=cjs`
                        debug_assert!(self.options.module_type == bundle_opts::Format::Cjs);

                        self.print_symbol(self.options.import_meta_ref);
                    }
                }
                ExprData::EImportMetaMain(data) => {
                    if self.options.module_type == bundle_opts::Format::Esm
                        && self.options.target != bun_ast::Target::Node
                    {
                        // Node.js doesn't support import.meta.main
                        // Most of the time, leave it in there
                        if data.inverted {
                            self.add_source_mapping(expr.loc);
                            self.print(b"!");
                        } else {
                            self.print_space_before_identifier();
                            self.add_source_mapping(expr.loc);
                        }
                        if let Some(mi) = self.module_info() {
                            mi.flags.contains_import_meta = true;
                        }
                        self.print(b"import.meta.main");
                    } else {
                        debug_assert!(
                            self.options.module_type != bundle_opts::Format::InternalBakeDev
                        );

                        self.print_space_before_identifier();
                        self.add_source_mapping(expr.loc);

                        if let Some(require) = self.options.require_ref {
                            self.print_symbol(require);
                        } else {
                            self.print(b"require");
                        }

                        if data.inverted {
                            self.print_whitespacer(ws!(b".main != "));
                        } else {
                            self.print_whitespacer(ws!(b".main == "));
                        }

                        if self.options.target == bun_ast::Target::Node {
                            // "__require.module"
                            if let Some(require) = self.options.require_ref {
                                self.print_symbol(require);
                                self.print(b".module");
                            } else {
                                self.print(b"module");
                            }
                        } else if self.options.commonjs_module_ref.is_valid() {
                            self.print_symbol(self.options.commonjs_module_ref);
                        } else {
                            self.print(b"module");
                        }
                    }
                }
                ExprData::ESpecial(special) => match special {
                    E::Special::ModuleExports => {
                        self.print_space_before_identifier();
                        self.add_source_mapping(expr.loc);

                        if self.options.commonjs_module_exports_assigned_deoptimized {
                            if self.options.commonjs_module_ref.is_valid() {
                                self.print_symbol(self.options.commonjs_module_ref);
                            } else {
                                self.print(b"module");
                            }
                            self.print(b".exports");
                        } else {
                            self.print_symbol(self.options.commonjs_named_exports_ref);
                        }
                    }
                    E::Special::HotEnabled => {
                        debug_assert!(
                            self.options.module_type == bundle_opts::Format::InternalBakeDev
                        );
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".indirectHot");
                    }
                    E::Special::HotData => {
                        debug_assert!(
                            self.options.module_type == bundle_opts::Format::InternalBakeDev
                        );
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".data");
                    }
                    E::Special::HotAccept => {
                        debug_assert!(
                            self.options.module_type == bundle_opts::Format::InternalBakeDev
                        );
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".accept");
                    }
                    E::Special::HotAcceptVisited => {
                        debug_assert!(
                            self.options.module_type == bundle_opts::Format::InternalBakeDev
                        );
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".acceptSpecifiers");
                    }
                    E::Special::HotDisabled => {
                        debug_assert!(
                            self.options.module_type != bundle_opts::Format::InternalBakeDev
                        );
                        self.print_expr(
                            Expr {
                                data: ExprData::EUndefined(E::Undefined {}),
                                loc: expr.loc,
                            },
                            level,
                            in_flags,
                        );
                    }
                    E::Special::ResolvedSpecifierString(index) => {
                        debug_assert!(
                            self.options.module_type == bundle_opts::Format::InternalBakeDev
                        );
                        self.print_string_literal_utf8(
                            self.import_record(*index as usize).path.pretty,
                            true,
                        );
                    }
                },
                ExprData::ECommonjsExportIdentifier(id) => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);

                    // PORT NOTE: reshaped for borrowck — find the matching index first,
                    // then drop the immutable iter borrow before printing.
                    let mut found: Option<usize> = None;
                    if let Some(exports) = self.options.commonjs_named_exports {
                        for (idx, value) in exports.values().iter().enumerate() {
                            if value
                                .loc_ref
                                .ref_
                                .expect("infallible: ref bound")
                                .eql(id.ref_)
                            {
                                found = Some(idx);
                                break;
                            }
                        }
                    }
                    if let Some(idx) = found {
                        let exports = self.options.commonjs_named_exports.unwrap();
                        // `commonjs_named_exports` keys borrow `'a` (Options<'a>); capture
                        // as `BackRef<[u8]>` so the `&self` borrow is dropped before the
                        // `&mut self` print calls below.
                        let key = BackRef::<[u8]>::new(&exports.keys()[idx][..]);
                        let value_loc_ref = exports.values()[idx].loc_ref;
                        let value_needs_decl = exports.values()[idx].needs_decl;
                        struct V {
                            loc_ref: js_ast::LocRef,
                            needs_decl: bool,
                        }
                        let value = V {
                            loc_ref: value_loc_ref,
                            needs_decl: value_needs_decl,
                        };
                        if self.options.commonjs_named_exports_deoptimized || value.needs_decl {
                            if self.options.commonjs_module_exports_assigned_deoptimized
                                && id.base() == E::CommonJSExportIdentifierBase::ModuleDotExports
                                && self.options.commonjs_module_ref.is_valid()
                            {
                                self.print_symbol(self.options.commonjs_module_ref);
                                self.print(b".exports");
                            } else {
                                self.print_symbol(self.options.commonjs_named_exports_ref);
                            }

                            let key: &[u8] = key.get();
                            if lexer::is_identifier(key) {
                                self.print(b".");
                                self.print(key);
                            } else {
                                self.print(b"[");
                                self.print_string_literal_utf8(key, false);
                                self.print(b"]");
                            }
                        } else {
                            self.print_symbol(value.loc_ref.ref_.expect("infallible: ref bound"));
                        }
                    }
                }
                ExprData::ENew(e) => {
                    let has_pure_comment = e.can_be_unwrapped_if_unused == E::CallUnwrap::IfUnused
                        && self.options.print_dce_annotations;
                    let wrap =
                        level.gte(Level::Call) || (has_pure_comment && level.gte(Level::Postfix));

                    if wrap {
                        self.print(b"(");
                    }

                    if has_pure_comment {
                        self.print_pure();
                    }

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"new");
                    self.print_space();
                    self.print_expr(e.target, Level::New, ExprFlag::forbid_call());
                    let args = e.args.slice();
                    if !args.is_empty() || level.gte(Level::Postfix) {
                        self.print(b"(");

                        if !args.is_empty() {
                            self.print_expr(args[0], Level::Comma, ExprFlag::none());
                            for arg in &args[1..] {
                                self.print(b",");
                                self.print_space();
                                self.print_expr(*arg, Level::Comma, ExprFlag::none());
                            }
                        }

                        if e.close_parens_loc.start > expr.loc.start {
                            self.add_source_mapping(e.close_parens_loc);
                        }

                        self.print(b")");
                    }

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::ECall(e) => {
                    let mut wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
                    let mut target_flags = ExprFlag::none();
                    if e.optional_chain.is_none() {
                        target_flags = ExprFlag::has_non_optional_chain_parent();
                    } else if flags.contains(ExprFlag::HasNonOptionalChainParent) {
                        wrap = true;
                    }

                    let has_pure_comment = e.can_be_unwrapped_if_unused == E::CallUnwrap::IfUnused
                        && self.options.print_dce_annotations;
                    if has_pure_comment && level.gte(Level::Postfix) {
                        wrap = true;
                    }

                    if wrap {
                        self.print(b"(");
                    }

                    if has_pure_comment {
                        let was_stmt_start = self.stmt_start == self.writer.written();
                        self.print_pure();
                        if was_stmt_start {
                            self.stmt_start = self.writer.written();
                        }
                    }
                    // We only want to generate an unbound eval() in CommonJS
                    self.call_target = Some(e.target.data.clone());

                    let is_unbound_eval = !e.is_direct_eval
                        && self.is_unbound_eval_identifier(e.target)
                        && e.optional_chain.is_none();

                    if is_unbound_eval {
                        self.print(b"(0,");
                        self.print_space();
                        self.print_expr(e.target, Level::Postfix, ExprFlag::none());
                        self.print(b")");
                    } else {
                        self.print_expr(e.target, Level::Postfix, target_flags);
                    }

                    if e.optional_chain == Some(js_ast::OptionalChain::Start) {
                        self.print(b"?.");
                    }
                    self.print(b"(");
                    let args = e.args.slice();

                    if !args.is_empty() {
                        self.print_expr(args[0], Level::Comma, ExprFlag::none());
                        for arg in &args[1..] {
                            self.print(b",");
                            self.print_space();
                            self.print_expr(*arg, Level::Comma, ExprFlag::none());
                        }
                    }
                    if e.close_paren_loc.start > expr.loc.start {
                        self.add_source_mapping(e.close_paren_loc);
                    }
                    self.print(b")");
                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::ERequireMain => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);

                    if let Some(require_ref) = self.options.require_ref {
                        self.print_symbol(require_ref);
                        self.print(b".main");
                    } else if self.options.module_type == bundle_opts::Format::InternalBakeDev {
                        self.print(b"false"); // there is no true main entry point
                    } else {
                        self.print(b"require.main");
                    }
                }
                ExprData::ERequireCallTarget => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);

                    if let Some(require_ref) = self.options.require_ref {
                        self.print_symbol(require_ref);
                    } else if self.options.module_type == bundle_opts::Format::InternalBakeDev {
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".require");
                    } else {
                        self.print(b"require");
                    }
                }
                ExprData::ERequireResolveCallTarget => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);

                    if let Some(require_ref) = self.options.require_ref {
                        self.print_symbol(require_ref);
                        self.print(b".resolve");
                    } else if self.options.module_type == bundle_opts::Format::InternalBakeDev {
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".requireResolve");
                    } else {
                        self.print(b"require.resolve");
                    }
                }
                ExprData::ERequireString(e) => {
                    if !REWRITE_ESM_TO_CJS {
                        self.print_require_or_import_expr(
                            e.import_record_index,
                            e.unwrapped_id != u32::MAX,
                            &[],
                            Expr::EMPTY,
                            level,
                            flags,
                        );
                    }
                }
                ExprData::ERequireResolveString(e) => {
                    let wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
                    if wrap {
                        self.print(b"(");
                    }

                    self.print_space_before_identifier();

                    if let Some(require_ref) = self.options.require_ref {
                        self.print_symbol(require_ref);
                        self.print(b".resolve");
                    } else if self.options.module_type == bundle_opts::Format::InternalBakeDev {
                        self.print_symbol(self.options.hmr_ref);
                        self.print(b".requireResolve");
                    } else {
                        self.print(b"require.resolve");
                    }

                    self.print(b"(");
                    self.print_string_literal_utf8(
                        &self.import_record(e.import_record_index as usize).path.text,
                        true,
                    );
                    self.print(b")");

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EImport(e) => {
                    // Handle non-string expressions
                    if e.is_import_record_null() {
                        let wrap = level.gte(Level::New) || flags.contains(ExprFlag::ForbidCall);
                        if wrap {
                            self.print(b"(");
                        }

                        self.print_space_before_identifier();
                        self.add_source_mapping(expr.loc);
                        if self.options.module_type == bundle_opts::Format::InternalBakeDev {
                            self.print_symbol(self.options.hmr_ref);
                            self.print(b".dynamicImport(");
                        } else {
                            self.print(b"import(");
                        }
                        // TODO: leading_interior_comments
                        self.print_expr(e.expr, Level::Comma, ExprFlag::none());

                        if !e.options.is_missing() {
                            self.print_whitespacer(ws!(b", "));
                            self.print_expr(e.options, Level::Comma, ExprFlagSet::empty());
                        }

                        // TODO: leading_interior_comments
                        self.print(b")");
                        if wrap {
                            self.print(b")");
                        }
                    } else {
                        self.print_require_or_import_expr(
                            e.import_record_index,
                            false,
                            &[], // e.leading_interior_comments,
                            e.options,
                            level,
                            flags,
                        );
                    }
                }
                ExprData::EDot(e) => {
                    let is_optional_chain = e.optional_chain == Some(js_ast::OptionalChain::Start);

                    let mut wrap = false;
                    if e.optional_chain.is_none() {
                        flags.insert(ExprFlag::HasNonOptionalChainParent);

                        // Inline cross-module TypeScript enum references here
                        if let Some(inlined) =
                            self.try_to_get_imported_enum_value(e.target, &e.name)
                        {
                            self.print_inlined_enum(inlined, &e.name, level);
                            return;
                        }
                    } else {
                        if flags.contains(ExprFlag::HasNonOptionalChainParent) {
                            wrap = true;
                            self.print(b"(");
                        }
                        flags.remove(ExprFlag::HasNonOptionalChainParent);
                    }
                    flags &= ExprFlag::HasNonOptionalChainParent | ExprFlag::ForbidCall;

                    self.print_expr(e.target, Level::Postfix, flags);

                    if lexer::is_identifier(&e.name) {
                        if is_optional_chain {
                            self.print(b"?.");
                        } else {
                            if self.prev_num_end == self.writer.written() {
                                // "1.toString" is a syntax error, so print "1 .toString" instead
                                self.print(b" ");
                            }
                            self.print(b".");
                        }

                        self.add_source_mapping(e.name_loc);
                        self.print_identifier(&e.name);
                    } else {
                        if is_optional_chain {
                            self.print(b"?.[");
                        } else {
                            self.print(b"[");
                        }
                        self.print_string_literal_utf8(&e.name, false);
                        self.print(b"]");
                    }

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EIndex(e) => {
                    let mut wrap = false;
                    if e.optional_chain.is_none() {
                        flags.insert(ExprFlag::HasNonOptionalChainParent);

                        if let Some(mut str) = e.index.data.as_e_string() {
                            str.resolve_rope_if_needed(self.bump);
                            if str.is_utf8() {
                                if let Some(value) =
                                    self.try_to_get_imported_enum_value(e.target, str.slice8())
                                {
                                    self.print_inlined_enum(value, str.slice8(), level);
                                    return;
                                }
                            }
                        }
                    } else {
                        if flags.contains(ExprFlag::HasNonOptionalChainParent) {
                            wrap = true;
                            self.print(b"(");
                        }
                        flags.remove(ExprFlag::HasNonOptionalChainParent);
                    }

                    self.print_expr(e.target, Level::Postfix, flags);

                    let is_optional_chain_start =
                        e.optional_chain == Some(js_ast::OptionalChain::Start);
                    if is_optional_chain_start {
                        self.print(b"?.");
                    }

                    match &e.index.data {
                        ExprData::EPrivateIdentifier(priv_) => {
                            if !is_optional_chain_start {
                                self.print(b".");
                            }
                            self.add_source_mapping(e.index.loc);
                            self.print_symbol(priv_.ref_);
                        }
                        _ => {
                            self.print(b"[");
                            self.add_source_mapping(e.index.loc);
                            self.print_expr(e.index, Level::Lowest, ExprFlag::none());
                            self.print(b"]");
                        }
                    }

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EIf(e) => {
                    let wrap = level.gte(Level::Conditional);
                    if wrap {
                        self.print(b"(");
                        flags.remove(ExprFlag::ForbidIn);
                    }
                    self.print_expr(e.test_, Level::Conditional, flags);
                    self.print_space();
                    self.print(b"?");
                    self.print_space();
                    self.print_expr(e.yes, Level::Yield, ExprFlag::none());
                    self.print_space();
                    self.print(b":");
                    self.print_space();
                    flags.insert(ExprFlag::ForbidIn);
                    self.print_expr(e.no, Level::Yield, flags);
                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EArrow(e) => {
                    let wrap = level.gte(Level::Assign);

                    if wrap {
                        self.print(b"(");
                    }

                    if e.is_async {
                        self.add_source_mapping(expr.loc);
                        self.print_space_before_identifier();
                        self.print(b"async");
                        self.print_space();
                    }

                    self.print_fn_args(
                        if e.is_async { None } else { Some(expr.loc) },
                        &e.args,
                        e.has_rest_arg,
                        true,
                    );
                    self.print_whitespacer(ws!(b" => "));

                    let mut was_printed = false;
                    if e.body.stmts.len() == 1 && e.prefer_expr {
                        if let StmtData::SReturn(ret) = slice_of(e.body.stmts)[0].data {
                            if let Some(val) = &ret.value {
                                self.arrow_expr_start = self.writer.written();
                                self.print_expr(*val, Level::Comma, ExprFlag::ForbidIn.into());
                                was_printed = true;
                            }
                        }
                    }

                    if !was_printed {
                        self.print_block(
                            e.body.loc,
                            slice_of(e.body.stmts),
                            None,
                            TopLevel::init(IsTopLevel::No),
                        );
                    }

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EFunction(e) => {
                    let n = self.writer.written();
                    let wrap = self.stmt_start == n || self.export_default_start == n;

                    if wrap {
                        self.print(b"(");
                    }

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    if e.func.flags.contains(G::FnFlags::IsAsync) {
                        self.print(b"async ");
                    }
                    self.print(b"function");
                    if e.func.flags.contains(G::FnFlags::IsGenerator) {
                        self.print(b"*");
                        self.print_space();
                    }

                    if let Some(sym) = &e.func.name {
                        self.print_space_before_identifier();
                        self.add_source_mapping(sym.loc);
                        self.print_symbol(sym.ref_.unwrap_or_else(|| {
                            Output::panic(format_args!(
                                "internal error: expected E.Function's name symbol to have a ref"
                            ))
                        }));
                    }

                    self.print_func(&e.func);
                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EClass(e) => {
                    let n = self.writer.written();
                    let wrap = self.stmt_start == n || self.export_default_start == n;
                    if wrap {
                        self.print(b"(");
                    }

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"class");
                    if let Some(name) = &e.class_name {
                        self.print(b" ");
                        self.add_source_mapping(name.loc);
                        self.print_symbol(name.ref_.unwrap_or_else(|| {
                            Output::panic(format_args!(
                                "internal error: expected E.Class's name symbol to have a ref"
                            ))
                        }));
                    }
                    self.print_class(&e);
                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EArray(e) => {
                    self.add_source_mapping(expr.loc);
                    self.print(b"[");
                    let items = e.items.slice();
                    if !items.is_empty() {
                        if !e.is_single_line {
                            self.indent();
                        }

                        for (i, item) in items.iter().enumerate() {
                            if i != 0 {
                                self.print(b",");
                                if e.is_single_line {
                                    self.print_space();
                                }
                            }
                            if !e.is_single_line {
                                self.print_newline();
                                self.print_indent();
                            }
                            self.print_expr(*item, Level::Comma, ExprFlag::none());

                            if i == items.len() - 1 && matches!(item.data, ExprData::EMissing(_)) {
                                // Make sure there's a comma after trailing missing items
                                self.print(b",");
                            }
                        }

                        if !e.is_single_line {
                            self.unindent();
                            self.print_newline();
                            self.print_indent();
                        }
                    }

                    if e.close_bracket_loc.start > expr.loc.start {
                        self.add_source_mapping(e.close_bracket_loc);
                    }

                    self.print(b"]");
                }
                ExprData::EObject(e) => {
                    let n = self.writer.written();
                    let wrap = if IS_JSON {
                        false
                    } else {
                        self.stmt_start == n || self.arrow_expr_start == n
                    };

                    if wrap {
                        self.print(b"(");
                    }
                    self.add_source_mapping(expr.loc);
                    self.print(b"{");
                    let props = e.properties.slice();
                    if !props.is_empty() {
                        if !e.is_single_line {
                            self.indent();
                        }

                        if e.is_single_line && !IS_JSON {
                            self.print_space();
                        } else {
                            self.print_newline();
                            self.print_indent();
                        }
                        self.print_property(&props[0]);

                        if props.len() > 1 {
                            for property in &props[1..] {
                                self.print(b",");
                                if e.is_single_line && !IS_JSON {
                                    self.print_space();
                                } else {
                                    self.print_newline();
                                    self.print_indent();
                                }
                                self.print_property(property);
                            }
                        }

                        if e.is_single_line && !IS_JSON {
                            self.print_space();
                        } else {
                            self.unindent();
                            self.print_newline();
                            self.print_indent();
                        }
                    }
                    if e.close_brace_loc.start > expr.loc.start {
                        self.add_source_mapping(e.close_brace_loc);
                    }
                    self.print(b"}");
                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EBoolean(e) | ExprData::EBranchBoolean(e) => {
                    self.add_source_mapping(expr.loc);
                    if self.options.minify_syntax {
                        if level.gte(Level::Prefix) {
                            self.print(if e.value { b"(!0)" } else { b"(!1)" });
                        } else {
                            self.print(if e.value { b"!0" } else { b"!1" });
                        }
                    } else {
                        self.print_space_before_identifier();
                        self.print(if e.value {
                            b"true".as_slice()
                        } else {
                            b"false".as_slice()
                        });
                    }
                }
                ExprData::EString(e) => {
                    let mut e = *e;
                    e.resolve_rope_if_needed(self.bump);
                    self.add_source_mapping(expr.loc);

                    // If this was originally a template literal, print it as one as long as we're not minifying
                    if e.prefer_template && !self.options.minify_syntax {
                        self.print(b"`");
                        self.print_string_characters_e_string(&e, b'`');
                        self.print(b"`");
                        return;
                    }

                    self.print_string_literal_e_string(&e, true);
                }
                ExprData::ETemplate(e) => {
                    if e.tag.is_none() && (self.options.minify_syntax || self.was_lazy_export) {
                        // Zig: `var part = part.*` — `TemplatePart` is structurally
                        // `Copy` but `EString` doesn't derive it; field-wise copy.
                        #[inline]
                        fn part_clone(p: &E::TemplatePart) -> E::TemplatePart {
                            E::TemplatePart {
                                value: p.value,
                                tail_loc: p.tail_loc,
                                tail: match &p.tail {
                                    E::TemplateContents::Cooked(c) => {
                                        E::TemplateContents::Cooked(c.shallow_clone())
                                    }
                                    E::TemplateContents::Raw(r) => E::TemplateContents::Raw(*r),
                                },
                            }
                        }

                        let mut replaced: Vec<E::TemplatePart> = Vec::new();
                        for (i, _part) in e.parts().iter().enumerate() {
                            let mut part = part_clone(_part);
                            let inlined_value: Option<Expr> = match &part.value.data {
                                ExprData::ENameOfSymbol(e2) => Some(Expr::init(
                                    E::String::init(self.mangled_prop_name(e2.ref_)),
                                    part.value.loc,
                                )),
                                ExprData::EDot(_) => {
                                    // TODO: handle inlining of dot properties
                                    None
                                }
                                _ => None,
                            };

                            if let Some(value) = inlined_value {
                                if replaced.is_empty() {
                                    replaced.extend(e.parts()[..i].iter().map(part_clone));
                                }
                                part.value = value;
                                replaced.push(part);
                            } else if !replaced.is_empty() {
                                replaced.push(part);
                            }
                        }

                        if !replaced.is_empty() {
                            // Zig: `var copy = e.*; copy.parts = &replaced;` — build a
                            // local `Template` (not a StoreRef alias) so `fold`'s
                            // `mem::take(self.head)` doesn't clobber the AST node.
                            // `replaced` outlives `copy`/`fold()`; wrap as a StoreSlice
                            // over the local Vec to match `Template.parts`.
                            let parts_slice = js_ast::StoreSlice::new_mut(replaced.as_mut_slice());
                            let mut copy = E::Template {
                                tag: e.tag,
                                parts: parts_slice,
                                head: match &e.head {
                                    E::TemplateContents::Cooked(c) => {
                                        E::TemplateContents::Cooked(c.shallow_clone())
                                    }
                                    E::TemplateContents::Raw(r) => E::TemplateContents::Raw(*r),
                                },
                            };
                            let e2 = copy.fold(self.bump, expr.loc);
                            match &e2.data {
                                ExprData::EString(s) => {
                                    self.print(b'"');
                                    self.print_string_characters_utf8(s.slice8(), b'"');
                                    self.print(b'"');
                                    return;
                                }
                                ExprData::ETemplate(t) => {
                                    // SAFETY: e is &mut behind the AST arena pointer
                                    // TODO(port): Zig mutated `e.* = e2.data.e_template.*` — needs &mut access through arena.
                                    let _ = t;
                                }
                                _ => {}
                            }
                        }

                        // Convert no-substitution template literals into strings if it's smaller
                        if e.parts().is_empty() {
                            self.add_source_mapping(expr.loc);
                            self.print_string_characters_e_string(&e.head.cooked(), b'`');
                            return;
                        }
                    }

                    if let Some(tag) = &e.tag {
                        self.add_source_mapping(expr.loc);
                        // Optional chains are forbidden in template tags
                        // PORT NOTE: `Expr::is_optional_chain` is gated upstream; inline its body.
                        let is_optional_chain = match &expr.data {
                            ExprData::EDot(d) => d.optional_chain.is_some(),
                            ExprData::EIndex(i) => i.optional_chain.is_some(),
                            ExprData::ECall(c) => c.optional_chain.is_some(),
                            _ => false,
                        };
                        if is_optional_chain {
                            self.print(b"(");
                            self.print_expr(*tag, Level::Lowest, ExprFlag::none());
                            self.print(b")");
                        } else {
                            self.print_expr(*tag, Level::Postfix, ExprFlag::none());
                        }
                    } else {
                        self.add_source_mapping(expr.loc);
                    }

                    self.print(b"`");
                    let mut e = *e;
                    match &mut e.head {
                        E::TemplateContents::Raw(raw) => self.print_raw_template_literal(raw),
                        E::TemplateContents::Cooked(cooked) => {
                            if cooked.is_present() {
                                cooked.resolve_rope_if_needed(self.bump);
                                self.print_string_characters_e_string(cooked, b'`');
                            }
                        }
                    }

                    for part in e.parts().iter() {
                        self.print(b"${");
                        self.print_expr(part.value, Level::Lowest, ExprFlag::none());
                        self.print(b"}");
                        match &part.tail {
                            E::TemplateContents::Raw(raw) => self.print_raw_template_literal(raw),
                            E::TemplateContents::Cooked(cooked) => {
                                if cooked.is_present() {
                                    // PORT NOTE: `parts` is `*mut [TemplatePart]` but accessed `&[T]`
                                    // here. Zig mutates in place; Rust resolves a local copy of the
                                    // EString header (the rope chain is StoreRef-linked and Copy) and
                                    // prints from that — the arena node stays roped.
                                    let mut local = E::EString { ..*cooked };
                                    local.resolve_rope_if_needed(self.bump);
                                    self.print_string_characters_e_string(&local, b'`');
                                }
                            }
                        }
                    }
                    self.print(b"`");
                }
                ExprData::ERegExp(e) => {
                    self.add_source_mapping(expr.loc);
                    self.print_reg_exp_literal(e);
                }
                ExprData::EBigInt(e) => {
                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(&e.value[..]);
                    self.print(b'n');
                }
                ExprData::ENumber(e) => {
                    self.add_source_mapping(expr.loc);
                    self.print_number(e.value, level);
                }
                ExprData::EIdentifier(e) => {
                    let name = self.name_for_symbol(e.ref_);
                    let wrap = self.writer.written() == self.for_of_init_start && name == b"let";

                    if wrap {
                        self.print(b"(");
                    }

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print_identifier(name);

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EImportIdentifier(e) => {
                    // Potentially use a property access instead of an identifier
                    let mut did_print = false;

                    let ref_ = if self.options.module_type != bundle_opts::Format::InternalBakeDev {
                        self.symbols().follow(e.ref_)
                    } else {
                        e.ref_
                    };
                    // PORT NOTE: reshaped for borrowck — `get_const` borrows self;
                    // capture as `BackRef` so the `&self` borrow is dropped before the
                    // `&mut self` print calls below. Symbol table is arena-backed and
                    // outlives the print pass (BackRef invariant).
                    let symbol = BackRef::<Symbol>::new(self.symbols().get_const(ref_).unwrap());

                    if symbol.import_item_status == js_ast::ImportItemStatus::Missing {
                        self.print_undefined(expr.loc, level);
                        did_print = true;
                    } else if let Some(namespace) = &symbol.namespace_alias {
                        if (namespace.import_record_index as usize) < self.import_records.len() {
                            let import_record =
                                self.import_record(namespace.import_record_index as usize);
                            if namespace.was_originally_property_access {
                                let mut wrap = false;
                                did_print = true;

                                if let Some(target) = &self.call_target {
                                    wrap = e.was_originally_identifier()
                                        && matches!(target, ExprData::EIdentifier(id) if id.ref_.eql(e.ref_));
                                }

                                if wrap {
                                    self.print_whitespacer(ws!(b"(0, "));
                                }
                                self.print_space_before_identifier();
                                self.add_source_mapping(expr.loc);
                                self.print_namespace_alias(import_record, namespace);

                                if wrap {
                                    self.print(b")");
                                }
                            } else if import_record
                                .flags
                                .contains(ImportRecordFlags::WAS_ORIGINALLY_REQUIRE)
                                && import_record.path.is_disabled
                            {
                                self.add_source_mapping(expr.loc);

                                if import_record
                                    .flags
                                    .contains(ImportRecordFlags::HANDLES_IMPORT_ERRORS)
                                {
                                    self.print_require_error(&import_record.path.text);
                                } else {
                                    self.print_disabled_import();
                                }
                                did_print = true;
                            }
                        }

                        if !did_print {
                            did_print = true;

                            let wrap = if let Some(target) = &self.call_target {
                                e.was_originally_identifier()
                                    && matches!(target, ExprData::EIdentifier(id) if id.ref_.eql(e.ref_))
                            } else {
                                false
                            };

                            if wrap {
                                self.print_whitespacer(ws!(b"(0, "));
                            }

                            self.print_space_before_identifier();
                            self.add_source_mapping(expr.loc);
                            self.print_symbol(namespace.namespace_ref);
                            let alias = namespace.alias.slice();
                            if lexer::is_identifier(alias) {
                                self.print(b".");
                                // TODO: addSourceMappingForName
                                self.print_identifier(alias);
                            } else {
                                self.print(b"[");
                                // TODO: addSourceMappingForName
                                self.print_string_literal_utf8(alias, false);
                                self.print(b"]");
                            }

                            if wrap {
                                self.print(b")");
                            }
                        }
                    }

                    if !did_print {
                        self.print_space_before_identifier();
                        self.add_source_mapping(expr.loc);
                        self.print_symbol(e.ref_);
                    }
                }
                ExprData::EAwait(e) => {
                    let wrap = level.gte(Level::Prefix);
                    if wrap {
                        self.print(b"(");
                    }

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"await");
                    self.print_space();
                    self.print_expr(e.value, Level::Prefix.sub(1), ExprFlag::none());

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EYield(e) => {
                    let wrap = level.gte(Level::Assign);
                    if wrap {
                        self.print(b"(");
                    }

                    self.print_space_before_identifier();
                    self.add_source_mapping(expr.loc);
                    self.print(b"yield");

                    if let Some(val) = &e.value {
                        if e.is_star {
                            self.print(b"*");
                        }
                        self.print_space();
                        self.print_expr(*val, Level::Yield, ExprFlag::none());
                    }

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EUnary(e) => {
                    let entry: &'static OpInfo = Op::TABLE.get_ptr_const(e.op);
                    let wrap = level.gte(entry.level);

                    if wrap {
                        self.print(b"(");
                    }

                    if !Op::Code::is_prefix(e.op) {
                        self.print_expr(e.value, Level::Postfix.sub(1), ExprFlag::none());
                    }

                    if entry.is_keyword {
                        self.print_space_before_identifier();
                        self.add_source_mapping(expr.loc);
                        self.print(entry.text);
                        self.print_space();
                    } else {
                        self.print_space_before_operator(e.op);
                        if Op::Code::is_prefix(e.op) {
                            self.add_source_mapping(expr.loc);
                        }
                        self.print(entry.text);
                        self.prev_op = e.op;
                        self.prev_op_end = self.writer.written();
                    }

                    if Op::Code::is_prefix(e.op) {
                        // Never turn "typeof (0, x)" into "typeof x" or "delete (0, x)" into "delete x"
                        if (e.op == Op::Code::UnTypeof && !e.flags.contains(E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER) && self.is_unbound_identifier(&e.value))
                        || (e.op == Op::Code::UnDelete && !e.flags.contains(E::UnaryFlags::WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS) && is_identifier_or_numeric_constant_or_property_access(&e.value))
                    {
                        self.print(b"(0,");
                        self.print_space();
                        self.print_expr(e.value, Level::Prefix.sub(1), ExprFlag::none());
                        self.print(b")");
                    } else {
                        self.print_expr(e.value, Level::Prefix.sub(1), ExprFlag::none());
                    }
                    }

                    if wrap {
                        self.print(b")");
                    }
                }
                ExprData::EBinary(e) => {
                    // The handling of binary expressions is convoluted because we're using
                    // iteration on the heap instead of recursion on the call stack to avoid
                    // stack overflow for deeply-nested ASTs.
                    let mut v = BinaryExpressionVisitor {
                        e: *e,
                        _phantom: core::marker::PhantomData,
                        level,
                        flags,
                        left_level: Level::Lowest,
                        left_flags: ExprFlag::none(),
                        entry: Op::TABLE.get_ptr_const(e.op),
                        wrap: false,
                        right_level: Level::Lowest,
                    };

                    // Use a single stack to reduce allocation overhead
                    let stack_bottom = self.binary_expression_stack.len();

                    loop {
                        if !self.binary_check_and_prepare(&mut v) {
                            break;
                        }

                        let left = v.e.left;
                        let left_binary = if let ExprData::EBinary(b) = &left.data {
                            Some(*b)
                        } else {
                            None
                        };

                        // Stop iterating if iteration doesn't apply to the left node
                        if left_binary.is_none() {
                            self.print_expr(left, v.left_level, v.left_flags);
                            self.binary_visit_right_and_finish(&v);
                            break;
                        }

                        // Only allocate heap memory on the stack for nested binary expressions
                        let lb = left_binary.unwrap();
                        let next = BinaryExpressionVisitor {
                            e: lb,
                            _phantom: core::marker::PhantomData,
                            level: v.left_level,
                            flags: v.left_flags,
                            left_level: Level::Lowest,
                            left_flags: ExprFlag::none(),
                            entry: Op::TABLE.get_ptr_const(lb.op), // overwritten in checkAndPrepare
                            wrap: false,
                            right_level: Level::Lowest,
                        };
                        self.binary_expression_stack.push(v);
                        v = next;
                    }

                    // Process all binary operations from the deepest-visited node back toward
                    // our original top-level binary operation
                    while self.binary_expression_stack.len() > stack_bottom {
                        let last = self.binary_expression_stack.pop().unwrap();
                        self.binary_visit_right_and_finish(&last);
                    }
                }
                ExprData::EInlinedEnum(e) => {
                    self.print_expr(e.value, level, flags);
                    if !self.options.minify_whitespace && !self.options.minify_identifiers {
                        self.print(b" /* ");
                        self.print(&e.comment[..]);
                        self.print(b" */");
                    }
                }
                ExprData::ENameOfSymbol(e) => {
                    let name = self.mangled_prop_name(e.ref_);
                    self.add_source_mapping_for_name(expr.loc, name, e.ref_);

                    if !self.options.minify_whitespace && e.has_property_key_comment {
                        self.print(b" /* @__KEY__ */");
                    }

                    self.print(b'"');
                    self.print_string_characters_utf8(name, b'"');
                    self.print(b'"');
                }
                ExprData::EJsxElement(_) | ExprData::EPrivateIdentifier(_) => {
                    if cfg!(debug_assertions) {
                        // TODO(port): @tagName(expr.data) — ExprData lacks IntoStaticStr.
                        Output::panic(format_args!(
                            "Unexpected expression of type {:?}",
                            core::mem::discriminant(&expr.data)
                        ));
                    }
                }
            }
        }

        pub fn print_space_before_operator(&mut self, next: Op::Code) {
            if self.prev_op_end == self.writer.written() {
                let prev = self.prev_op;
                // "+ + y" => "+ +y"
                // "+ ++ y" => "+ ++y"
                // "x + + y" => "x+ +y"
                // "x ++ + y" => "x+++y"
                // "x + ++ y" => "x+ ++y"
                // "-- >" => "-- >"
                // "< ! --" => "<! --"
                if ((prev == Op::Code::BinAdd || prev == Op::Code::UnPos)
                    && (next == Op::Code::BinAdd
                        || next == Op::Code::UnPos
                        || next == Op::Code::UnPreInc))
                    || ((prev == Op::Code::BinSub || prev == Op::Code::UnNeg)
                        && (next == Op::Code::BinSub
                            || next == Op::Code::UnNeg
                            || next == Op::Code::UnPreDec))
                    || (prev == Op::Code::UnPostDec && next == Op::Code::BinGt)
                    || (prev == Op::Code::UnNot
                        && next == Op::Code::UnPreDec
                        && self.writer.written() > 1
                        && self.writer.prev_prev_char() == b'<')
                {
                    self.print(b" ");
                }
            }
        }

        #[inline]
        pub fn print_dot_then_suffix(&mut self) {
            self.print(b")");
        }

        // This assumes the string has already been quoted.
        pub fn print_string_characters_e_string(&mut self, str: &E::String, c: u8) {
            if !str.is_utf8() {
                self.print_string_characters_utf16(str.slice16(), c);
            } else {
                self.print_string_characters_utf8(str.slice8(), c);
            }
        }

        pub fn print_namespace_alias(
            &mut self,
            _import_record: &ImportRecord,
            namespace: &G::NamespaceAlias,
        ) {
            self.print_symbol(namespace.namespace_ref);

            // In the case of code like this:
            // module.exports = require("foo")
            // if "foo" is bundled
            // then we access it as the namespace symbol itself
            // that means the namespace alias is empty
            if namespace.alias.is_empty() {
                return;
            }

            if lexer::is_identifier(namespace.alias.slice()) {
                self.print(b".");
                self.print_identifier(namespace.alias.slice());
            } else {
                self.print(b"[");
                self.print_string_literal_utf8(namespace.alias.slice(), false);
                self.print(b"]");
            }
        }

        pub fn print_reg_exp_literal(&mut self, e: &E::RegExp) {
            let n = self.writer.written();

            // Avoid forming a single-line comment
            if n > 0 && self.writer.prev_char() == b'/' {
                self.print(b" ");
            }

            if IS_BUN_PLATFORM {
                // Translate any non-ASCII to unicode escape sequences
                let mut ascii_start: usize = 0;
                let mut is_ascii = false;
                let mut iter = CodepointIterator::init(&e.value);
                let mut cursor = strings::Cursor::default();
                while iter.next(&mut cursor) {
                    match cursor.c as u32 {
                        FIRST_ASCII..=LAST_ASCII => {
                            if !is_ascii {
                                ascii_start = (cursor.i as usize);
                                is_ascii = true;
                            }
                        }
                        _ => {
                            if is_ascii {
                                self.print(&e.value[ascii_start..(cursor.i as usize)]);
                                is_ascii = false;
                            }

                            match cursor.c as u32 {
                                c @ 0..=0xFFFF => self.print(&bmp_escape(c)[..]),
                                c => self.print(&surrogate_pair_escape(c)[..]),
                            }
                        }
                    }
                }

                if is_ascii {
                    self.print(&e.value[ascii_start..]);
                }
            } else {
                // UTF8 sequence is fine
                self.print(&e.value[..]);
            }

            // Need a space before the next identifier to avoid it turning into flags
            self.prev_reg_exp_end = self.writer.written();
        }

        pub fn print_property(&mut self, item_in: &G::Property) {
            // PORT NOTE: Zig took G.Property by value (Copy in Zig). Rust's
            // G::Property isn't `Copy`, so take a borrow and shallow-copy the
            // mutable bits we may rewrite (key + flags).
            let mut item = G::Property {
                kind: item_in.kind,
                flags: item_in.flags,
                class_static_block: item_in.class_static_block,
                key: item_in.key,
                value: item_in.value,
                initializer: item_in.initializer,
                // PERF(port): Vec not Copy — re-slice instead of move.
                ts_decorators: bun_alloc::AstAlloc::vec(),
                // TODO(port): ts_decorators not used by the printer; Vec is !Copy so omit the copy.
                ts_metadata: Default::default(),
                // TODO(port): ts_metadata not used by the printer; not Copy.
            };
            if !IS_JSON {
                if item.kind == G::PropertyKind::Spread {
                    self.print(b"...");
                    self.print_expr(
                        item.value.expect("infallible: prop has value"),
                        Level::Comma,
                        ExprFlag::none(),
                    );
                    return;
                }

                // Handle key syntax compression for cross-module constant inlining of enums
                if self.options.minify_syntax
                    && item.flags.contains(js_ast::flags::Property::IsComputed)
                {
                    if let ExprData::EDot(dot) =
                        &item.key.as_ref().expect("infallible: prop has key").data
                    {
                        if let Some(value) =
                            self.try_to_get_imported_enum_value(dot.target, dot.name.slice())
                        {
                            match value {
                                js_ast::InlinedEnumValueDecoded::String(str) => {
                                    // Arena-owned `*const EString` (encoded non-null at NaN-box time);
                                    // wrap via the safe `From<NonNull>` ctor — printer only reads it.
                                    let sref = js_ast::StoreRef::from(
                                        NonNull::new(str.cast_mut())
                                            .expect("inlined enum string non-null"),
                                    );
                                    item.key.as_mut().unwrap().data = ExprData::EString(sref);
                                    // Problematic key names must stay computed for correctness
                                    if !sref.eql_comptime(b"__proto__")
                                        && !sref.eql_comptime(b"constructor")
                                        && !sref.eql_comptime(b"prototype")
                                    {
                                        set_flag(
                                            &mut item.flags,
                                            js_ast::flags::Property::IsComputed,
                                            false,
                                        );
                                    }
                                }
                                js_ast::InlinedEnumValueDecoded::Number(num) => {
                                    item.key.as_mut().unwrap().data =
                                        ExprData::ENumber(E::Number { value: num });
                                    set_flag(
                                        &mut item.flags,
                                        js_ast::flags::Property::IsComputed,
                                        false,
                                    );
                                }
                            }
                        }
                    }
                }

                if item.flags.contains(js_ast::flags::Property::IsStatic) {
                    self.print(b"static");
                    self.print_space();
                }

                match item.kind {
                    G::PropertyKind::Get => {
                        self.print_space_before_identifier();
                        self.print(b"get");
                        self.print_space();
                    }
                    G::PropertyKind::Set => {
                        self.print_space_before_identifier();
                        self.print(b"set");
                        self.print_space();
                    }
                    G::PropertyKind::AutoAccessor => {
                        self.print_space_before_identifier();
                        self.print(b"accessor");
                        self.print_space();
                    }
                    _ => {}
                }

                if let Some(val) = &item.value {
                    if let ExprData::EFunction(func) = &val.data {
                        if item.flags.contains(js_ast::flags::Property::IsMethod) {
                            if func.func.flags.contains(G::FnFlags::IsAsync) {
                                self.print_space_before_identifier();
                                self.print(b"async");
                            }
                            if func.func.flags.contains(G::FnFlags::IsGenerator) {
                                self.print(b"*");
                            }
                            if func.func.flags.contains(G::FnFlags::IsGenerator)
                                && func.func.flags.contains(G::FnFlags::IsAsync)
                            {
                                self.print_space();
                            }
                        }
                    }

                    // If var is declared in a parent scope and var is then written via destructuring pattern, key is null
                    if item.key.is_none() {
                        self.print_expr(*val, Level::Comma, ExprFlag::none());
                        return;
                    }
                }
            }

            let key = item.key.expect("infallible: prop has key");

            if !IS_JSON && item.flags.contains(js_ast::flags::Property::IsComputed) {
                self.print(b"[");
                self.print_expr(key, Level::Comma, ExprFlag::none());
                self.print(b"]");

                if let Some(val) = &item.value {
                    if let ExprData::EFunction(func) = &val.data {
                        if item.flags.contains(js_ast::flags::Property::IsMethod) {
                            self.print_func(&func.func);
                            return;
                        }
                    }
                    self.print(b":");
                    self.print_space();
                    self.print_expr(*val, Level::Comma, ExprFlag::none());
                }

                if let Some(initial) = &item.initializer {
                    self.print_initializer(*initial);
                }
                return;
            }

            match &key.data {
                ExprData::EPrivateIdentifier(priv_) => {
                    if IS_JSON {
                        unreachable!();
                    }
                    self.add_source_mapping(key.loc);
                    self.print_symbol(priv_.ref_);
                }
                ExprData::EString(key_str) => {
                    let mut key_str = *key_str;
                    self.add_source_mapping(key.loc);
                    if key_str.is_utf8() {
                        key_str.resolve_rope_if_needed(self.bump);
                        self.print_space_before_identifier();
                        let mut allow_shorthand = true;
                        if !IS_JSON && lexer::is_identifier(key_str.slice8()) {
                            self.print_identifier(key_str.slice8());
                        } else {
                            allow_shorthand = false;
                            self.print_string_literal_e_string(&key_str, false);
                        }

                        // Use a shorthand property if the names are the same
                        if let Some(val) = &item.value {
                            match &val.data {
                                ExprData::EIdentifier(e) => {
                                    if key_str.slice8() == self.name_for_symbol(e.ref_) {
                                        if let Some(initial) = &item.initializer {
                                            self.print_initializer(*initial);
                                        }
                                        if allow_shorthand {
                                            return;
                                        }
                                    }
                                }
                                ExprData::EImportIdentifier(e) => 'inner: {
                                    let ref_ = self.symbols().follow(e.ref_);
                                    if self.options.input_files_for_dev_server.is_some() {
                                        break 'inner;
                                    }
                                    if let Some(symbol) = self.symbols().get_const(ref_) {
                                        if symbol.namespace_alias.is_none()
                                            && key_str.slice8() == self.name_for_symbol(e.ref_)
                                        {
                                            if let Some(initial) = &item.initializer {
                                                self.print_initializer(*initial);
                                            }
                                            if allow_shorthand {
                                                return;
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else if !IS_JSON && self.can_print_identifier_utf16(key_str.slice16()) {
                        self.print_space_before_identifier();
                        self.print_identifier_utf16(key_str.slice16())
                            .expect("unreachable");

                        // Use a shorthand property if the names are the same
                        if let Some(val) = &item.value {
                            match &val.data {
                                ExprData::EIdentifier(e) => {
                                    if item.flags.contains(js_ast::flags::Property::WasShorthand)
                                        || strings::utf16_eql_string(
                                            key_str.slice16(),
                                            self.name_for_symbol(e.ref_),
                                        )
                                    {
                                        if let Some(initial) = &item.initializer {
                                            self.print_initializer(*initial);
                                        }
                                        return;
                                    }
                                }
                                ExprData::EImportIdentifier(e) => {
                                    let ref_ = self.symbols().follow(e.ref_);
                                    if let Some(symbol) = self.symbols().get_const(ref_) {
                                        if symbol.namespace_alias.is_none()
                                            && strings::utf16_eql_string(
                                                key_str.slice16(),
                                                self.name_for_symbol(e.ref_),
                                            )
                                        {
                                            if let Some(initial) = &item.initializer {
                                                self.print_initializer(*initial);
                                            }
                                            return;
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else {
                        let c = best_quote_char_for_string(key_str.slice16(), false);
                        self.print(c);
                        self.print_string_characters_utf16(key_str.slice16(), c);
                        self.print(c);
                    }
                }
                _ => {
                    if IS_JSON {
                        unreachable!();
                    }
                    self.print_expr(key, Level::Lowest, ExprFlagSet::empty());
                }
            }

            if item.kind != G::PropertyKind::Normal && item.kind != G::PropertyKind::AutoAccessor {
                if IS_JSON {
                    unreachable!("item.kind must be normal in json");
                }
                if let ExprData::EFunction(func) = &item
                    .value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .data
                {
                    self.print_func(&func.func);
                    return;
                }
            }

            if let Some(val) = &item.value {
                if let ExprData::EFunction(f) = &val.data {
                    if item.flags.contains(js_ast::flags::Property::IsMethod) {
                        self.print_func(&f.func);
                        return;
                    }
                }
                self.print(b":");
                self.print_space();
                self.print_expr(*val, Level::Comma, ExprFlagSet::empty());
            }

            if IS_JSON {
                debug_assert!(item.initializer.is_none());
            }

            if let Some(initial) = &item.initializer {
                self.print_initializer(*initial);
            }
        }

        pub fn print_initializer(&mut self, initial: Expr) {
            self.print_space();
            self.print(b"=");
            self.print_space();
            self.print_expr(initial, Level::Comma, ExprFlag::none());
        }

        pub fn print_binding(&mut self, binding: Binding, tlm: TopLevelAndIsExport) {
            match &binding.data {
                BindingData::BMissing(_) => {}
                BindingData::BIdentifier(b) => {
                    let b = b.get();
                    self.print_space_before_identifier();
                    self.add_source_mapping(binding.loc);
                    self.print_symbol(b.r#ref);
                    if Self::MAY_HAVE_MODULE_INFO {
                        // PORT NOTE: reshaped for borrowck — fetch name before borrowing module_info.
                        let local_name = self.name_for_symbol(b.r#ref);
                        if let Some(mi) = self.module_info() {
                            let name_id = mi.str(local_name);
                            if let Some(vk) = tlm.is_top_level {
                                mi.add_var(name_id, vk);
                            }
                            if tlm.is_export {
                                mi.add_export_info_local(name_id, name_id);
                            }
                        }
                    }
                }
                BindingData::BArray(b) => {
                    let b = b.get();
                    let items = slice_of(b.items);
                    self.print(b"[");
                    if !items.is_empty() {
                        if !b.is_single_line {
                            self.indent();
                        }

                        for (i, item) in items.iter().enumerate() {
                            if i != 0 {
                                self.print(b",");
                                if b.is_single_line {
                                    self.print_space();
                                }
                            }

                            if !b.is_single_line {
                                self.print_newline();
                                self.print_indent();
                            }

                            let is_last = i + 1 == items.len();
                            if b.has_spread && is_last {
                                self.print(b"...");
                            }

                            self.print_binding(item.binding, tlm);
                            self.maybe_print_default_binding_value(item);

                            // Make sure there's a comma after trailing missing items
                            if is_last && matches!(item.binding.data, BindingData::BMissing(_)) {
                                self.print(b",");
                            }
                        }

                        if !b.is_single_line {
                            self.unindent();
                            self.print_newline();
                            self.print_indent();
                        }
                    }
                    self.print(b"]");
                }
                BindingData::BObject(b) => {
                    let b = b.get();
                    let properties = slice_of(b.properties);
                    self.print(b"{");
                    if !properties.is_empty() {
                        if !b.is_single_line {
                            self.indent();
                        }

                        for (i, property) in properties.iter().enumerate() {
                            if i != 0 {
                                self.print(b",");
                            }

                            if b.is_single_line {
                                self.print_space();
                            } else {
                                self.print_newline();
                                self.print_indent();
                            }

                            if property.flags.contains(js_ast::flags::Property::IsSpread) {
                                self.print(b"...");
                            } else {
                                if property.flags.contains(js_ast::flags::Property::IsComputed) {
                                    self.print(b"[");
                                    self.print_expr(property.key, Level::Comma, ExprFlag::none());
                                    self.print(b"]:");
                                    self.print_space();

                                    self.print_binding(property.value, tlm);
                                    self.maybe_print_default_binding_value(property);
                                    continue;
                                }

                                match &property.key.data {
                                    ExprData::EString(str) => {
                                        let mut str = *str;
                                        str.resolve_rope_if_needed(self.bump);
                                        self.add_source_mapping(property.key.loc);

                                        if str.is_utf8() {
                                            self.print_space_before_identifier();
                                            if lexer::is_identifier(str.slice8()) {
                                                self.print_identifier(str.slice8());

                                                // Use a shorthand property if the names are the same
                                                if let BindingData::BIdentifier(id) =
                                                    &property.value.data
                                                {
                                                    let id = id.get();
                                                    if str.slice8()
                                                        == self.name_for_symbol(id.r#ref)
                                                    {
                                                        if Self::MAY_HAVE_MODULE_INFO {
                                                            if let Some(mi) = self.module_info() {
                                                                let name_id = mi.str(str.slice8());
                                                                if let Some(vk) = tlm.is_top_level {
                                                                    mi.add_var(name_id, vk);
                                                                }
                                                                if tlm.is_export {
                                                                    mi.add_export_info_local(
                                                                        name_id, name_id,
                                                                    );
                                                                }
                                                            }
                                                        }
                                                        self.maybe_print_default_binding_value(
                                                            property,
                                                        );
                                                        continue;
                                                    }
                                                }
                                            } else {
                                                self.print_string_literal_utf8(str.slice8(), false);
                                            }
                                        } else if self.can_print_identifier_utf16(str.slice16()) {
                                            self.print_space_before_identifier();
                                            self.print_identifier_utf16(str.slice16())
                                                .expect("unreachable");

                                            // Use a shorthand property if the names are the same
                                            if let BindingData::BIdentifier(id) =
                                                &property.value.data
                                            {
                                                let id = id.get();
                                                if strings::utf16_eql_string(
                                                    str.slice16(),
                                                    self.name_for_symbol(id.r#ref),
                                                ) {
                                                    if Self::MAY_HAVE_MODULE_INFO {
                                                        // PORT NOTE: reshaped for borrowck — bump access first.
                                                        let str8 = str.slice(self.bump);
                                                        if let Some(mi) = self.module_info() {
                                                            let name_id = mi.str(str8);
                                                            if let Some(vk) = tlm.is_top_level {
                                                                mi.add_var(name_id, vk);
                                                            }
                                                            if tlm.is_export {
                                                                mi.add_export_info_local(
                                                                    name_id, name_id,
                                                                );
                                                            }
                                                        }
                                                    }
                                                    self.maybe_print_default_binding_value(
                                                        property,
                                                    );
                                                    continue;
                                                }
                                            }
                                        } else {
                                            self.print_expr(
                                                property.key,
                                                Level::Lowest,
                                                ExprFlag::none(),
                                            );
                                        }
                                    }
                                    _ => {
                                        self.print_expr(
                                            property.key,
                                            Level::Lowest,
                                            ExprFlag::none(),
                                        );
                                    }
                                }

                                self.print(b":");
                                self.print_space();
                            }

                            self.print_binding(property.value, tlm);
                            self.maybe_print_default_binding_value(property);
                        }

                        if !b.is_single_line {
                            self.unindent();
                            self.print_newline();
                            self.print_indent();
                        } else {
                            self.print_space();
                        }
                    }
                    self.print(b"}");
                }
            }
        }

        pub fn maybe_print_default_binding_value<P: HasDefaultValue>(&mut self, property: &P) {
            if let Some(default) = property.default_value() {
                self.print_space();
                self.print(b"=");
                self.print_space();
                self.print_expr(default, Level::Comma, ExprFlag::none());
            }
        }

        pub fn print_stmt(&mut self, stmt: Stmt, tlmtlo: TopLevel) -> Result<(), bun_core::Error> {
            let prev_stmt_tag = self.prev_stmt_tag;
            // Zig: `defer { p.prev_stmt_tag = std.meta.activeTag(stmt.data); }`
            // PORT NOTE: reshaped for borrowck — scopeguard would hold `&mut self.prev_stmt_tag`
            // across the whole match body and conflict with every `&mut self` call below. Instead
            // we assign `self.prev_stmt_tag = new_tag` at every return point (early + tail).
            let new_tag = stmt.data.tag();

            match &stmt.data {
                StmtData::SComment(s) => {
                    self.print_indent();
                    self.add_source_mapping(stmt.loc);
                    self.print_indented_comment(s.text.slice());
                }
                StmtData::SFunction(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    let name = s.func.name.as_ref().unwrap_or_else(|| {
                        Output::panic(format_args!(
                            "Internal error: expected func to have a name ref"
                        ))
                    });
                    let name_ref = name.ref_.unwrap_or_else(|| {
                        Output::panic(format_args!("Internal error: expected func to have a name"))
                    });

                    if s.func.flags.contains(G::FnFlags::IsExport) {
                        if !REWRITE_ESM_TO_CJS {
                            self.print(b"export ");
                        }
                    }
                    if s.func.flags.contains(G::FnFlags::IsAsync) {
                        self.print(b"async ");
                    }
                    self.print(b"function");
                    if s.func.flags.contains(G::FnFlags::IsGenerator) {
                        self.print(b"*");
                        self.print_space();
                    } else {
                        self.print_space_before_identifier();
                    }

                    self.add_source_mapping(name.loc);
                    let local_name = self.name_for_symbol(name_ref);
                    self.print_identifier(local_name);
                    self.print_func(&s.func);

                    if Self::MAY_HAVE_MODULE_INFO {
                        if let Some(mi) = self.module_info() {
                            let name_id = mi.str(local_name);
                            // function declarations are lexical (block-scoped in modules);
                            // only record at true top-level, not inside blocks.
                            if tlmtlo.is_top_level == IsTopLevel::Yes {
                                mi.add_var(name_id, analyze_transpiled_module::VarKind::Lexical);
                            }
                            if s.func.flags.contains(G::FnFlags::IsExport) {
                                mi.add_export_info_local(name_id, name_id);
                            }
                        }
                    }

                    self.print_newline();

                    if REWRITE_ESM_TO_CJS && s.func.flags.contains(G::FnFlags::IsExport) {
                        self.print_indent();
                        self.print_bundled_export(local_name, local_name);
                        self.print_semicolon_after_statement();
                    }
                }
                StmtData::SClass(s) => {
                    // Give an extra newline for readaiblity
                    if prev_stmt_tag != StmtTag::SEmpty {
                        self.print_newline();
                    }

                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    let name_ref = s
                        .class
                        .class_name
                        .as_ref()
                        .unwrap()
                        .ref_
                        .expect("infallible: ref bound");
                    if s.is_export {
                        if !REWRITE_ESM_TO_CJS {
                            self.print(b"export ");
                        }
                    }

                    self.print(b"class ");
                    self.add_source_mapping(s.class.class_name.as_ref().unwrap().loc);
                    let name_str = self.name_for_symbol(name_ref);
                    self.print_identifier(name_str);
                    self.print_class(&s.class);

                    if Self::MAY_HAVE_MODULE_INFO {
                        if let Some(mi) = self.module_info() {
                            let name_id = mi.str(name_str);
                            if tlmtlo.is_top_level == IsTopLevel::Yes {
                                mi.add_var(name_id, analyze_transpiled_module::VarKind::Lexical);
                            }
                            if s.is_export {
                                mi.add_export_info_local(name_id, name_id);
                            }
                        }
                    }

                    if REWRITE_ESM_TO_CJS && s.is_export {
                        self.print_semicolon_after_statement();
                    } else {
                        self.print_newline();
                    }

                    if REWRITE_ESM_TO_CJS {
                        if s.is_export {
                            self.print_indent();
                            let n = self.name_for_symbol(name_ref);
                            self.print_bundled_export(n, n);
                            self.print_semicolon_after_statement();
                        }
                    }
                }
                StmtData::SEmpty(_) => {
                    if prev_stmt_tag == StmtTag::SEmpty && self.options.indent.count == 0 {
                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }
                    self.print_indent();
                    self.add_source_mapping(stmt.loc);
                    self.print(b";");
                    self.print_newline();
                }
                StmtData::SExportDefault(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"export default ");

                    match s.value {
                        js_ast::StmtOrExpr::Expr(expr) => {
                            // Functions and classes must be wrapped to avoid confusion with their statement forms
                            self.export_default_start = self.writer.written();
                            self.print_expr(expr, Level::Comma, ExprFlag::none());
                            self.print_semicolon_after_statement();

                            if Self::MAY_HAVE_MODULE_INFO {
                                if let Some(mi) = self.module_info() {
                                    let default_id = mi.str(b"default");
                                    mi.add_export_info_local(
                                        default_id,
                                        analyze_transpiled_module::StringID::STAR_DEFAULT,
                                    );
                                    mi.add_var(
                                        analyze_transpiled_module::StringID::STAR_DEFAULT,
                                        analyze_transpiled_module::VarKind::Lexical,
                                    );
                                }
                            }
                            self.prev_stmt_tag = new_tag;
                            return Ok(());
                        }
                        js_ast::StmtOrExpr::Stmt(s2) => {
                            match &s2.data {
                                StmtData::SFunction(func) => {
                                    self.print_space_before_identifier();

                                    if func.func.flags.contains(G::FnFlags::IsAsync) {
                                        self.print(b"async ");
                                    }
                                    self.print(b"function");

                                    if func.func.flags.contains(G::FnFlags::IsGenerator) {
                                        self.print(b"*");
                                        self.print_space();
                                    } else {
                                        self.maybe_print_space();
                                    }

                                    let func_name: Option<&[u8]> =
                                        func.func.name.as_ref().map(|name| {
                                            self.name_for_symbol(
                                                name.ref_.expect("infallible: ref bound"),
                                            )
                                        });
                                    if let Some(fn_name) = func_name {
                                        self.print_identifier(fn_name);
                                    }

                                    self.print_func(&func.func);

                                    if Self::MAY_HAVE_MODULE_INFO {
                                        if let Some(mi) = self.module_info() {
                                            let local_name = match func_name {
                                            Some(f) => mi.str(f),
                                            None => analyze_transpiled_module::StringID::STAR_DEFAULT,
                                        };
                                            let default_id = mi.str(b"default");
                                            mi.add_export_info_local(default_id, local_name);
                                            mi.add_var(
                                                local_name,
                                                analyze_transpiled_module::VarKind::Lexical,
                                            );
                                        }
                                    }

                                    self.print_newline();
                                }
                                StmtData::SClass(class) => {
                                    self.print_space_before_identifier();

                                    let class_name: Option<&[u8]> = class.class.class_name.as_ref().map(|name|
                                    self.name_for_symbol(name.ref_.unwrap_or_else(|| Output::panic(format_args!("Internal error: Expected class to have a name ref"))))
                                );
                                    if let Some(name) = &class.class.class_name {
                                        self.print(b"class ");
                                        let n = self.name_for_symbol(
                                            name.ref_.expect("infallible: ref bound"),
                                        );
                                        self.print_identifier(n);
                                    } else {
                                        self.print(b"class");
                                    }

                                    self.print_class(&class.class);

                                    if Self::MAY_HAVE_MODULE_INFO {
                                        if let Some(mi) = self.module_info() {
                                            let local_name = match class_name {
                                            Some(f) => mi.str(f),
                                            None => analyze_transpiled_module::StringID::STAR_DEFAULT,
                                        };
                                            let default_id = mi.str(b"default");
                                            mi.add_export_info_local(default_id, local_name);
                                            mi.add_var(
                                                local_name,
                                                analyze_transpiled_module::VarKind::Lexical,
                                            );
                                        }
                                    }

                                    self.print_newline();
                                }
                                _ => Output::panic(format_args!(
                                    "Internal error: unexpected export default stmt data"
                                )),
                            }
                        }
                    }
                }
                StmtData::SExportStar(s) => {
                    // Give an extra newline for readaiblity
                    if !prev_stmt_tag.is_export_like() {
                        self.print_newline();
                    }
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);

                    if s.alias.is_some() {
                        // Zig: ws("export *").append(" as ") — append() concatenates verbatim to
                        // BOTH fields (js_printer.zig:86-88), so minify keeps the " as " literal.
                        self.print_whitespacer(Whitespacer {
                            normal: b"export * as ",
                            minify: b"export* as ",
                        });
                    } else {
                        self.print_whitespacer(ws!(b"export * from "));
                    }

                    if let Some(alias) = &s.alias {
                        self.print_clause_alias(alias.original_name.slice());
                        self.print(b" ");
                        self.print_whitespacer(ws!(b"from "));
                    }

                    let irp = &self.import_record(s.import_record_index as usize).path.text;
                    self.print_import_record_path(
                        self.import_record(s.import_record_index as usize),
                    );
                    self.print_semicolon_after_statement();

                    if Self::MAY_HAVE_MODULE_INFO {
                        if let Some(mi) = self.module_info() {
                            let irp_id = mi.str(irp);
                            mi.request_module(
                                irp_id,
                                analyze_transpiled_module::FetchParameters::None,
                            );
                            if let Some(alias) = &s.alias {
                                let alias_id = mi.str(alias.original_name.slice());
                                mi.add_export_info_namespace(alias_id, irp_id);
                            } else {
                                mi.add_export_info_star(irp_id);
                            }
                        }
                    }
                }
                StmtData::SExportClause(s) => {
                    if REWRITE_ESM_TO_CJS {
                        self.print_indent();
                        self.print_space_before_identifier();
                        self.add_source_mapping(stmt.loc);

                        match slice_of(s.items).len() {
                            0 => {}
                            // Object.assign(__export, {prop1, prop2, prop3});
                            _ => {
                                self.print(b"Object.assign");
                                self.print(b"(");
                                self.print_module_export_symbol();
                                self.print(b",");
                                self.print_space();
                                self.print(b"{");
                                self.print_space();
                                let last = slice_of(s.items).len() - 1;
                                for (i, item) in slice_of(s.items).iter().enumerate() {
                                    // PORT NOTE: reshaped for borrowck — detach symbol from
                                    // `&self` via `BackRef` (arena-backed table outlives print).
                                    let symbol = BackRef::<Symbol>::new(
                                        self.symbols()
                                            .get_with_link_const(
                                                item.name.ref_.expect("infallible: ref bound"),
                                            )
                                            .unwrap(),
                                    );
                                    let name = symbol.original_name.slice();
                                    let mut did_print = false;

                                    if let Some(namespace) = &symbol.namespace_alias {
                                        let import_record = self
                                            .import_record(namespace.import_record_index as usize);
                                        if namespace.was_originally_property_access {
                                            self.print_identifier(name);
                                            self.print(b": () => ");
                                            self.print_namespace_alias(import_record, namespace);
                                            did_print = true;
                                        }
                                    }

                                    if !did_print {
                                        self.print_clause_alias(item.alias.slice());
                                        if name != item.alias.slice() {
                                            self.print(b":");
                                            self.print_space_before_identifier();
                                            self.print_identifier(name);
                                        }
                                    }

                                    if i < last {
                                        self.print(b",");
                                    }
                                }
                                self.print(b"})");
                                self.print_semicolon_after_statement();
                            }
                        }
                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }

                    // Give an extra newline for export default for readability
                    if !prev_stmt_tag.is_export_like() {
                        self.print_newline();
                    }

                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"export");
                    self.print_space();

                    if slice_of(s.items).is_empty() {
                        self.print(b"{}");
                        self.print_semicolon_after_statement();
                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }

                    // PORT NOTE: Zig wraps `s.items` in an ArrayListUnmanaged and uses swapRemove
                    // in-place. `ClauseItem` isn't `Clone`, so build a Vec of arena borrows
                    // instead and swap-remove the borrows.
                    // TODO(port): lifetime — Zig mutates `s.items` in place; Phase B may write back.
                    let mut array: Vec<&js_ast::ClauseItem> = slice_of(s.items).iter().collect();
                    {
                        let mut i: usize = 0;
                        while i < array.len() {
                            let item = array[i];

                            if !item.original_name.slice().is_empty() {
                                // PORT NOTE: reshaped for borrowck — detach symbol from
                                // `&self` via `BackRef` (arena-backed; outlives the print pass).
                                let symbol = self
                                    .symbols()
                                    .get_const(item.name.ref_.expect("infallible: ref bound"))
                                    .map(BackRef::<Symbol>::new);
                                if let Some(symbol) = symbol {
                                    if let Some(namespace) = &symbol.namespace_alias {
                                        let import_record = self
                                            .import_record(namespace.import_record_index as usize);
                                        if namespace.was_originally_property_access {
                                            self.print(b"var ");
                                            self.print_symbol(
                                                item.name.ref_.expect("infallible: ref bound"),
                                            );
                                            self.print_equals();
                                            self.print_namespace_alias(import_record, namespace);
                                            self.print_semicolon_after_statement();
                                            array.swap_remove(i);

                                            if i < array.len() {
                                                self.print_indent();
                                                self.print_space_before_identifier();
                                                self.print(b"export");
                                                self.print_space();
                                            }

                                            continue;
                                        }
                                    }
                                }
                            }

                            i += 1;
                        }

                        if array.is_empty() {
                            self.prev_stmt_tag = new_tag;
                            return Ok(());
                        }
                        // s.items = array.items; — TODO(port): write back into AST
                    }

                    self.print(b"{");

                    if !s.is_single_line {
                        self.indent();
                    } else {
                        self.print_space();
                    }

                    for (i, item) in array.iter().enumerate() {
                        if i != 0 {
                            self.print(b",");
                            if s.is_single_line {
                                self.print_space();
                            }
                        }

                        if !s.is_single_line {
                            self.print_newline();
                            self.print_indent();
                        }

                        let name =
                            self.name_for_symbol(item.name.ref_.expect("infallible: ref bound"));
                        self.print_export_clause_item(item);

                        if Self::MAY_HAVE_MODULE_INFO {
                            if let Some(mi) = self.module_info() {
                                let alias_id = mi.str(item.alias.slice());
                                let name_id = mi.str(name);
                                mi.add_export_info_local(alias_id, name_id);
                            }
                        }
                    }

                    if !s.is_single_line {
                        self.unindent();
                        self.print_newline();
                        self.print_indent();
                    } else {
                        self.print_space();
                    }

                    self.print(b"}");
                    self.print_semicolon_after_statement();
                }
                StmtData::SExportFrom(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);

                    let import_record = self.import_record(s.import_record_index as usize);

                    self.print_whitespacer(ws!(b"export {"));

                    if !s.is_single_line {
                        self.indent();
                    } else {
                        self.print_space();
                    }

                    for (i, item) in slice_of(s.items).iter().enumerate() {
                        if i != 0 {
                            self.print(b",");
                            if s.is_single_line {
                                self.print_space();
                            }
                        }
                        if !s.is_single_line {
                            self.print_newline();
                            self.print_indent();
                        }
                        self.print_export_from_clause_item(item);
                    }

                    if !s.is_single_line {
                        self.unindent();
                        self.print_newline();
                        self.print_indent();
                    } else {
                        self.print_space();
                    }

                    self.print_whitespacer(ws!(b"} from "));
                    let irp = &import_record.path.text;
                    self.print_import_record_path(import_record);
                    self.print_semicolon_after_statement();

                    if Self::MAY_HAVE_MODULE_INFO && self.module_info.is_some() {
                        // PORT NOTE: reshaped for borrowck — re-borrow module_info per item so
                        // `name_for_symbol` (which needs `&mut self`) can run between uses.
                        let irp_id = {
                            let mi = self.module_info().expect("infallible: module_info enabled");
                            let id = mi.str(irp);
                            mi.request_module(id, analyze_transpiled_module::FetchParameters::None);
                            id
                        };
                        for item in slice_of(s.items).iter() {
                            let name = self
                                .name_for_symbol(item.name.ref_.expect("infallible: ref bound"));
                            let mi = self.module_info().expect("infallible: module_info enabled");
                            let alias_id = mi.str(item.alias.slice());
                            let name_id = mi.str(name);
                            mi.add_export_info_indirect(alias_id, name_id, irp_id);
                        }
                    }
                }
                StmtData::SLocal(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    match s.kind {
                        S::Kind::KConst => {
                            self.print_decl_stmt(s.is_export, b"const", s.decls.slice(), tlmtlo)
                        }
                        S::Kind::KLet => {
                            self.print_decl_stmt(s.is_export, b"let", s.decls.slice(), tlmtlo)
                        }
                        S::Kind::KVar => {
                            self.print_decl_stmt(s.is_export, b"var", s.decls.slice(), tlmtlo)
                        }
                        S::Kind::KUsing => {
                            self.print_decl_stmt(s.is_export, b"using", s.decls.slice(), tlmtlo)
                        }
                        S::Kind::KAwaitUsing => self.print_decl_stmt(
                            s.is_export,
                            b"await using",
                            s.decls.slice(),
                            tlmtlo,
                        ),
                    }
                }
                StmtData::SIf(s) => {
                    self.print_indent();
                    self.print_if(s, stmt.loc, tlmtlo.sub_var());
                }
                StmtData::SDoWhile(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"do");
                    let sub_var = tlmtlo.sub_var();
                    match s.body.data {
                        StmtData::SBlock(block) => {
                            self.print_space();
                            self.print_block(
                                s.body.loc,
                                slice_of(block.stmts),
                                Some(block.close_brace_loc),
                                sub_var,
                            );
                            self.print_space();
                        }
                        _ => {
                            self.print_newline();
                            self.indent();
                            self.print_stmt(s.body, sub_var).expect("unreachable");
                            self.print_semicolon_if_needed();
                            self.unindent();
                            self.print_indent();
                        }
                    }

                    self.print(b"while");
                    self.print_space();
                    self.print(b"(");
                    self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
                    self.print(b")");
                    self.print_semicolon_after_statement();
                }
                StmtData::SForIn(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"for");
                    self.print_space();
                    self.print(b"(");
                    self.print_for_loop_init(s.init);
                    self.print_space();
                    self.print_space_before_identifier();
                    self.print(b"in");
                    self.print_space();
                    self.print_expr(s.value, Level::Lowest, ExprFlag::none());
                    self.print(b")");
                    self.print_body(s.body, tlmtlo.sub_var());
                }
                StmtData::SForOf(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"for");
                    if s.is_await {
                        self.print(b" await");
                    }
                    self.print_space();
                    self.print(b"(");
                    self.for_of_init_start = self.writer.written();
                    self.print_for_loop_init(s.init);
                    self.print_space();
                    self.print_space_before_identifier();
                    self.print(b"of");
                    self.print_space();
                    self.print_expr(s.value, Level::Comma, ExprFlag::none());
                    self.print(b")");
                    self.print_body(s.body, tlmtlo.sub_var());
                }
                StmtData::SWhile(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"while");
                    self.print_space();
                    self.print(b"(");
                    self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
                    self.print(b")");
                    self.print_body(s.body, tlmtlo.sub_var());
                }
                StmtData::SWith(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"with");
                    self.print_space();
                    self.print(b"(");
                    self.print_expr(s.value, Level::Lowest, ExprFlag::none());
                    self.print(b")");
                    self.print_body(s.body, tlmtlo.sub_var());
                }
                StmtData::SLabel(s) => {
                    if !self.options.minify_whitespace && self.options.indent.count > 0 {
                        self.print_indent();
                    }
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print_symbol(s.name.ref_.unwrap_or_else(|| {
                        Output::panic(format_args!(
                            "Internal error: expected label to have a name"
                        ))
                    }));
                    self.print(b":");
                    self.print_body(s.stmt, tlmtlo.sub_var());
                }
                StmtData::STry(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"try");
                    self.print_space();
                    let sub_var_try = tlmtlo.sub_var();
                    self.print_block(s.body_loc, slice_of(s.body), None, sub_var_try);

                    if let Some(catch_) = &s.catch_ {
                        self.print_space();
                        self.add_source_mapping(catch_.loc);
                        self.print(b"catch");
                        if let Some(binding) = &catch_.binding {
                            self.print_space();
                            self.print(b"(");
                            self.print_binding(*binding, TopLevelAndIsExport::default());
                            self.print(b")");
                        }
                        self.print_space();
                        self.print_block(catch_.body_loc, slice_of(catch_.body), None, sub_var_try);
                    }

                    if let Some(finally) = &s.finally {
                        self.print_space();
                        self.print(b"finally");
                        self.print_space();
                        self.print_block(finally.loc, slice_of(finally.stmts), None, sub_var_try);
                    }

                    self.print_newline();
                }
                StmtData::SFor(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"for");
                    self.print_space();
                    self.print(b"(");

                    if let Some(init_) = &s.init {
                        self.print_for_loop_init(*init_);
                    }

                    self.print(b";");

                    if let Some(test_) = &s.test_ {
                        self.print_expr(*test_, Level::Lowest, ExprFlag::none());
                    }

                    self.print(b";");
                    self.print_space();

                    if let Some(update) = &s.update {
                        self.print_expr(*update, Level::Lowest, ExprFlag::none());
                    }

                    self.print(b")");
                    self.print_body(s.body, tlmtlo.sub_var());
                }
                StmtData::SSwitch(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"switch");
                    self.print_space();
                    self.print(b"(");
                    self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
                    self.print(b")");
                    self.print_space();
                    self.print(b"{");
                    self.print_newline();
                    self.indent();

                    for c in slice_of(s.cases).iter() {
                        self.print_semicolon_if_needed();
                        self.print_indent();

                        if let Some(val) = &c.value {
                            self.print(b"case");
                            self.print_space();
                            self.print_expr(*val, Level::LogicalAnd, ExprFlag::none());
                        } else {
                            self.print(b"default");
                        }

                        self.print(b":");

                        let sub_var_case = tlmtlo.sub_var();
                        let c_body = slice_of(c.body);
                        if c_body.len() == 1 {
                            if let StmtData::SBlock(block) = &c_body[0].data {
                                self.print_space();
                                self.print_block(
                                    c_body[0].loc,
                                    slice_of(block.stmts),
                                    Some(block.close_brace_loc),
                                    sub_var_case,
                                );
                                self.print_newline();
                                continue;
                            }
                        }

                        self.print_newline();
                        self.indent();
                        for st in c_body.iter() {
                            self.print_semicolon_if_needed();
                            self.print_stmt(*st, sub_var_case).expect("unreachable");
                        }
                        self.unindent();
                    }

                    self.unindent();
                    self.print_indent();
                    self.print(b"}");
                    self.print_newline();
                    self.needs_semicolon = false;
                }
                StmtData::SImport(s) => {
                    debug_assert!((s.import_record_index as usize) < self.import_records.len());
                    debug_assert!(self.options.module_type != bundle_opts::Format::InternalBakeDev);

                    let record: &ImportRecord = self.import_record(s.import_record_index as usize);
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);

                    if IS_BUN_PLATFORM {
                        if record.tag == ImportRecordTag::Bun {
                            self.print_global_bun_import_statement(&s);
                            self.prev_stmt_tag = new_tag;
                            return Ok(());
                        }
                    }

                    if record.path.is_disabled {
                        if record
                            .flags
                            .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                        {
                            self.print(b"var ");
                            self.print_symbol(s.namespace_ref);
                            self.print_equals();
                            self.print_disabled_import();
                            self.print_semicolon_after_statement();
                        }

                        if !slice_of(s.items).is_empty() || s.default_name.is_some() {
                            self.print_indent();
                            self.print_space_before_identifier();
                            self.print_whitespacer(ws!(b"var {"));

                            if let Some(default_name) = &s.default_name {
                                self.print_space();
                                self.print(b"default:");
                                self.print_space();
                                self.print_symbol(
                                    default_name.ref_.expect("infallible: ref bound"),
                                );

                                if !slice_of(s.items).is_empty() {
                                    self.print_space();
                                    self.print(b",");
                                    self.print_space();
                                    for (i, item) in slice_of(s.items).iter().enumerate() {
                                        self.print_clause_item_as(item, ClauseItemAs::Var);
                                        if i < slice_of(s.items).len() - 1 {
                                            self.print(b",");
                                            self.print_space();
                                        }
                                    }
                                }
                            } else {
                                for (i, item) in slice_of(s.items).iter().enumerate() {
                                    self.print_clause_item_as(item, ClauseItemAs::Var);
                                    if i < slice_of(s.items).len() - 1 {
                                        self.print(b",");
                                        self.print_space();
                                    }
                                }
                            }

                            self.print(b"}");
                            self.print_equals();

                            if record
                                .flags
                                .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                            {
                                self.print_symbol(s.namespace_ref);
                                self.print_semicolon_after_statement();
                            } else {
                                self.print_disabled_import();
                                self.print_semicolon_after_statement();
                            }
                        }

                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }

                    if record
                        .flags
                        .contains(ImportRecordFlags::HANDLES_IMPORT_ERRORS)
                        && record.path.is_disabled
                        && record.kind.is_common_js()
                    {
                        self.prev_stmt_tag = new_tag;
                        return Ok(());
                    }

                    self.print(b"import");

                    let mut item_count: usize = 0;

                    if let Some(name) = &s.default_name {
                        self.print(b" ");
                        self.print_symbol(name.ref_.expect("infallible: ref bound"));
                        item_count += 1;
                    }

                    if !slice_of(s.items).is_empty() {
                        if item_count > 0 {
                            self.print(b",");
                        }
                        self.print_space();

                        self.print(b"{");
                        if !s.is_single_line {
                            self.indent();
                        } else {
                            self.print_space();
                        }

                        for (i, item) in slice_of(s.items).iter().enumerate() {
                            if i != 0 {
                                self.print(b",");
                                if s.is_single_line {
                                    self.print_space();
                                }
                            }
                            if !s.is_single_line {
                                self.print_newline();
                                self.print_indent();
                            }
                            self.print_clause_item(item);
                        }

                        if !s.is_single_line {
                            self.unindent();
                            self.print_newline();
                            self.print_indent();
                        } else {
                            self.print_space();
                        }
                        self.print(b"}");
                        item_count += 1;
                    }

                    if record
                        .flags
                        .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                    {
                        if item_count > 0 {
                            self.print(b",");
                        }
                        self.print_space();
                        self.print_whitespacer(ws!(b"* as"));
                        self.print(b" ");
                        self.print_symbol(s.namespace_ref);
                        item_count += 1;
                    }

                    if item_count > 0 {
                        if !self.options.minify_whitespace
                            || record
                                .flags
                                .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                            || slice_of(s.items).is_empty()
                        {
                            self.print(b" ");
                        }
                        self.print_whitespacer(ws!(b"from "));
                    }

                    self.print_import_record_path(record);

                    // backwards compatibility: previously, we always stripped type
                    if IS_BUN_PLATFORM {
                        if let Some(loader) = record.loader {
                            use bun_ast::Loader;
                            match loader {
                                Loader::Jsx => {
                                    self.print_whitespacer(ws!(b" with { type: \"jsx\" }"))
                                }
                                Loader::Js => {
                                    self.print_whitespacer(ws!(b" with { type: \"js\" }"))
                                }
                                Loader::Ts => {
                                    self.print_whitespacer(ws!(b" with { type: \"ts\" }"))
                                }
                                Loader::Tsx => {
                                    self.print_whitespacer(ws!(b" with { type: \"tsx\" }"))
                                }
                                Loader::Css => {
                                    self.print_whitespacer(ws!(b" with { type: \"css\" }"))
                                }
                                Loader::File => {
                                    self.print_whitespacer(ws!(b" with { type: \"file\" }"))
                                }
                                Loader::Json => {
                                    self.print_whitespacer(ws!(b" with { type: \"json\" }"))
                                }
                                Loader::Jsonc => {
                                    self.print_whitespacer(ws!(b" with { type: \"jsonc\" }"))
                                }
                                Loader::Toml => {
                                    self.print_whitespacer(ws!(b" with { type: \"toml\" }"))
                                }
                                Loader::Yaml => {
                                    self.print_whitespacer(ws!(b" with { type: \"yaml\" }"))
                                }
                                Loader::Json5 => {
                                    self.print_whitespacer(ws!(b" with { type: \"json5\" }"))
                                }
                                Loader::Wasm => {
                                    self.print_whitespacer(ws!(b" with { type: \"wasm\" }"))
                                }
                                Loader::Napi => {
                                    self.print_whitespacer(ws!(b" with { type: \"napi\" }"))
                                }
                                Loader::Base64 => {
                                    self.print_whitespacer(ws!(b" with { type: \"base64\" }"))
                                }
                                Loader::Dataurl => {
                                    self.print_whitespacer(ws!(b" with { type: \"dataurl\" }"))
                                }
                                Loader::Text => {
                                    self.print_whitespacer(ws!(b" with { type: \"text\" }"))
                                }
                                Loader::Bunsh => {
                                    self.print_whitespacer(ws!(b" with { type: \"sh\" }"))
                                }
                                Loader::Sqlite | Loader::SqliteEmbedded => {
                                    self.print_whitespacer(ws!(b" with { type: \"sqlite\" }"))
                                }
                                Loader::Html => {
                                    self.print_whitespacer(ws!(b" with { type: \"html\" }"))
                                }
                                Loader::Md => {
                                    self.print_whitespacer(ws!(b" with { type: \"md\" }"))
                                }
                            }
                        }
                    }
                    self.print_semicolon_after_statement();

                    if Self::MAY_HAVE_MODULE_INFO && self.module_info.is_some() {
                        // PORT NOTE: reshaped for borrowck — `module_info()` borrows `&mut self`,
                        // so we re-borrow it between `name_for_symbol` calls instead of holding
                        // a single long-lived `mi` across the whole block. `irp_id` is Copy.
                        let import_record_path = &record.path.text;
                        let irp_id = {
                            let mi = self.module_info().expect("infallible: module_info enabled");
                            let irp_id = mi.str(import_record_path);
                            use analyze_transpiled_module::FetchParameters as FP;
                            let fetch_parameters: FP = if IS_BUN_PLATFORM {
                                if let Some(loader) = record.loader {
                                    use bun_ast::Loader;
                                    match loader {
                                        Loader::Json => FP::Json,
                                        Loader::Jsx => FP::host_defined(mi.str(b"jsx")),
                                        Loader::Js => FP::host_defined(mi.str(b"js")),
                                        Loader::Ts => FP::host_defined(mi.str(b"ts")),
                                        Loader::Tsx => FP::host_defined(mi.str(b"tsx")),
                                        Loader::Css => FP::host_defined(mi.str(b"css")),
                                        Loader::File => FP::host_defined(mi.str(b"file")),
                                        Loader::Jsonc => FP::host_defined(mi.str(b"jsonc")),
                                        Loader::Toml => FP::host_defined(mi.str(b"toml")),
                                        Loader::Yaml => FP::host_defined(mi.str(b"yaml")),
                                        Loader::Wasm => FP::host_defined(mi.str(b"wasm")),
                                        Loader::Napi => FP::host_defined(mi.str(b"napi")),
                                        Loader::Base64 => FP::host_defined(mi.str(b"base64")),
                                        Loader::Dataurl => FP::host_defined(mi.str(b"dataurl")),
                                        Loader::Text => FP::host_defined(mi.str(b"text")),
                                        Loader::Bunsh => FP::host_defined(mi.str(b"sh")),
                                        Loader::Sqlite | Loader::SqliteEmbedded => {
                                            FP::host_defined(mi.str(b"sqlite"))
                                        }
                                        Loader::Html => FP::host_defined(mi.str(b"html")),
                                        Loader::Json5 => FP::host_defined(mi.str(b"json5")),
                                        Loader::Md => FP::host_defined(mi.str(b"md")),
                                    }
                                } else {
                                    FP::None
                                }
                            } else {
                                FP::None
                            };
                            mi.request_module(irp_id, fetch_parameters);
                            irp_id
                        };

                        if let Some(name) = &s.default_name {
                            let local_name =
                                self.name_for_symbol(name.ref_.expect("infallible: ref bound"));
                            let mi = self.module_info().expect("infallible: module_info enabled");
                            let local_name_id = mi.str(local_name);
                            mi.add_var(local_name_id, analyze_transpiled_module::VarKind::Lexical);
                            let default_id = mi.str(b"default");
                            mi.add_import_info_single(irp_id, default_id, local_name_id, false);
                        }

                        for item in slice_of(s.items).iter() {
                            let local_name = self
                                .name_for_symbol(item.name.ref_.expect("infallible: ref bound"));
                            let mi = self.module_info().expect("infallible: module_info enabled");
                            let local_name_id = mi.str(local_name);
                            mi.add_var(local_name_id, analyze_transpiled_module::VarKind::Lexical);
                            let alias_id = mi.str(item.alias.slice());
                            mi.add_import_info_single(irp_id, alias_id, local_name_id, false);
                        }

                        if record
                            .flags
                            .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                        {
                            let local_name = self.name_for_symbol(s.namespace_ref);
                            let mi = self.module_info().expect("infallible: module_info enabled");
                            let local_name_id = mi.str(local_name);
                            mi.add_var(local_name_id, analyze_transpiled_module::VarKind::Lexical);
                            mi.add_import_info_namespace(irp_id, local_name_id);
                        }
                    }
                }
                StmtData::SBlock(s) => {
                    self.print_indent();
                    self.print_block(
                        stmt.loc,
                        slice_of(s.stmts),
                        Some(s.close_brace_loc),
                        tlmtlo.sub_var(),
                    );
                    self.print_newline();
                }
                StmtData::SDebugger(_) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"debugger");
                    self.print_semicolon_after_statement();
                }
                StmtData::SDirective(s) => {
                    if IS_JSON {
                        unreachable!();
                    }
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print_string_literal_utf8(s.value.slice(), false);
                    self.print_semicolon_after_statement();
                }
                StmtData::SBreak(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"break");
                    if let Some(label) = &s.label {
                        self.print(b" ");
                        self.print_symbol(label.ref_.expect("infallible: ref bound"));
                    }
                    self.print_semicolon_after_statement();
                }
                StmtData::SContinue(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"continue");
                    if let Some(label) = &s.label {
                        self.print(b" ");
                        self.print_symbol(label.ref_.expect("infallible: ref bound"));
                    }
                    self.print_semicolon_after_statement();
                }
                StmtData::SReturn(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"return");
                    if let Some(value) = s.value {
                        self.print_space();
                        self.print_expr(value, Level::Lowest, ExprFlag::none());
                    }
                    self.print_semicolon_after_statement();
                }
                StmtData::SThrow(s) => {
                    self.print_indent();
                    self.print_space_before_identifier();
                    self.add_source_mapping(stmt.loc);
                    self.print(b"throw");
                    self.print_space();
                    self.print_expr(s.value, Level::Lowest, ExprFlag::none());
                    self.print_semicolon_after_statement();
                }
                StmtData::SExpr(s) => {
                    if !self.options.minify_whitespace && self.options.indent.count > 0 {
                        self.print_indent();
                    }
                    self.stmt_start = self.writer.written();
                    self.print_expr(s.value, Level::Lowest, ExprFlag::expr_result_is_unused());
                    self.print_semicolon_after_statement();
                }
                other => {
                    let name: &'static str = other.tag().into();
                    Output::panic(format_args!("Unexpected tag in printStmt: .{}", name));
                }
            }
            self.prev_stmt_tag = new_tag;
            Ok(())
        }

        #[inline]
        pub fn print_module_export_symbol(&mut self) {
            self.print(b"module.exports");
        }

        pub fn print_import_record_path(&mut self, import_record: &ImportRecord) {
            if IS_JSON {
                unreachable!();
            }

            let quote = best_quote_char_for_string(&import_record.path.text, false);
            if import_record
                .flags
                .contains(ImportRecordFlags::PRINT_NAMESPACE_IN_PATH)
                && !import_record.path.is_file()
            {
                self.print(quote);
                self.print_string_characters_utf8(&import_record.path.namespace, quote);
                self.print(b":");
                self.print_string_characters_utf8(&import_record.path.text, quote);
                self.print(quote);
            } else {
                self.print(quote);
                self.print_string_characters_utf8(&import_record.path.text, quote);
                self.print(quote);
            }
        }

        pub fn print_bundled_import(&mut self, record: ImportRecord, s: &S::Import) {
            if record.flags.contains(ImportRecordFlags::IS_INTERNAL) {
                return;
            }

            let import_record = self.import_record(s.import_record_index as usize);
            let is_disabled = import_record.path.is_disabled;
            let module_id = import_record.module_id;

            // If the bundled import was disabled and only imported for side effects we can skip it
            if record.path.is_disabled {
                if self.symbols().get_const(s.namespace_ref).is_none() {
                    return;
                }
            }

            match ImportVariant::determine(&record, s) {
                ImportVariant::PathOnly => {
                    if !is_disabled {
                        self.print_call_module_id(module_id);
                        self.print_semicolon_after_statement();
                    }
                }
                ImportVariant::ImportItemsAndDefault | ImportVariant::ImportDefault => {
                    if !is_disabled {
                        self.print(b"var $");
                        self.print_module_id(module_id);
                        self.print_equals();
                        self.print_load_from_bundle(s.import_record_index);

                        if let Some(default_name) = &s.default_name {
                            self.print(b", ");
                            self.print_symbol(default_name.ref_.expect("infallible: ref bound"));
                            self.print(b" = (($");
                            self.print_module_id(module_id);
                            self.print(b" && \"default\" in $");
                            self.print_module_id(module_id);
                            self.print(b") ? $");
                            self.print_module_id(module_id);
                            self.print(b".default : $");
                            self.print_module_id(module_id);
                            self.print(b")");
                        }
                    } else {
                        if let Some(default_name) = &s.default_name {
                            self.print(b"var ");
                            self.print_symbol(default_name.ref_.expect("infallible: ref bound"));
                            self.print_equals();
                            self.print_disabled_import();
                        }
                    }
                    self.print_semicolon_after_statement();
                }
                ImportVariant::ImportStarAndImportDefault => {
                    self.print(b"var ");
                    self.print_symbol(s.namespace_ref);
                    self.print_equals();
                    self.print_load_from_bundle(s.import_record_index);

                    if let Some(default_name) = &s.default_name {
                        self.print(b",");
                        self.print_space();
                        self.print_symbol(default_name.ref_.expect("infallible: ref bound"));
                        self.print_equals();

                        if !IS_BUN_PLATFORM {
                            self.print(b"(");
                            self.print_symbol(s.namespace_ref);
                            self.print_whitespacer(ws!(b" && \"default\" in "));
                            self.print_symbol(s.namespace_ref);
                            self.print_whitespacer(ws!(b" ? "));
                            self.print_symbol(s.namespace_ref);
                            self.print_whitespacer(ws!(b".default : "));
                            self.print_symbol(s.namespace_ref);
                            self.print(b")");
                        } else {
                            self.print_symbol(s.namespace_ref);
                        }
                    }
                    self.print_semicolon_after_statement();
                }
                ImportVariant::ImportStar => {
                    self.print(b"var ");
                    self.print_symbol(s.namespace_ref);
                    self.print_equals();
                    self.print_load_from_bundle(s.import_record_index);
                    self.print_semicolon_after_statement();
                }
                _ => {
                    self.print(b"var $");
                    self.print_module_id_assume_enabled(module_id);
                    self.print_equals();
                    self.print_load_from_bundle(s.import_record_index);
                    self.print_semicolon_after_statement();
                }
            }
        }

        pub fn print_load_from_bundle(&mut self, import_record_index: u32) {
            self.print_load_from_bundle_without_call(import_record_index);
            self.print(b"()");
        }

        #[inline]
        fn print_disabled_import(&mut self) {
            self.print_whitespacer(ws!(b"(() => ({}))"));
        }

        pub fn print_load_from_bundle_without_call(&mut self, import_record_index: u32) {
            let record = self.import_record(import_record_index as usize);
            if record.path.is_disabled {
                self.print_disabled_import();
                return;
            }
            self.print_module_id(self.import_record(import_record_index as usize).module_id);
        }

        pub fn print_call_module_id(&mut self, module_id: u32) {
            self.print_module_id(module_id);
            self.print(b"()");
        }

        #[inline]
        fn print_module_id(&mut self, module_id: u32) {
            debug_assert!(module_id != 0); // either module_id is forgotten or it should be disabled
            self.print_module_id_assume_enabled(module_id);
        }

        #[inline]
        fn print_module_id_assume_enabled(&mut self, module_id: u32) {
            self.print(b"$");
            let _ = self.fmt(format_args!("{:x}", module_id));
        }

        pub fn print_bundled_rexport(&mut self, name: &[u8], import_record_index: u32) {
            self.print(b"Object.defineProperty(");
            self.print_module_export_symbol();
            self.print(b",");
            self.print_string_literal_utf8(name, true);
            self.print_whitespacer(ws!(b",{get: () => ("));
            self.print_load_from_bundle(import_record_index);
            self.print_whitespacer(ws!(b"), enumerable: true, configurable: true})"));
        }

        // We must use Object.defineProperty() to handle re-exports from ESM -> CJS
        pub fn print_bundled_export(&mut self, name: &[u8], identifier: &[u8]) {
            self.print(b"Object.defineProperty(");
            self.print_module_export_symbol();
            self.print(b",");
            self.print_string_literal_utf8(name, true);
            self.print(b",{get: () => ");
            self.print_identifier(identifier);
            self.print(b", enumerable: true, configurable: true})");
        }

        pub fn print_for_loop_init(&mut self, init_st: Stmt) {
            match &init_st.data {
                StmtData::SExpr(s) => {
                    self.print_expr(
                        s.value,
                        Level::Lowest,
                        ExprFlag::ForbidIn | ExprFlag::ExprResultIsUnused,
                    );
                }
                StmtData::SLocal(s) => {
                    let flags = ExprFlag::ForbidIn.into();
                    match s.kind {
                        S::Kind::KVar => self.print_decls(
                            b"var",
                            s.decls.slice(),
                            flags,
                            TopLevelAndIsExport::default(),
                        ),
                        S::Kind::KLet => self.print_decls(
                            b"let",
                            s.decls.slice(),
                            flags,
                            TopLevelAndIsExport::default(),
                        ),
                        S::Kind::KConst => self.print_decls(
                            b"const",
                            s.decls.slice(),
                            flags,
                            TopLevelAndIsExport::default(),
                        ),
                        S::Kind::KUsing => self.print_decls(
                            b"using",
                            s.decls.slice(),
                            flags,
                            TopLevelAndIsExport::default(),
                        ),
                        S::Kind::KAwaitUsing => self.print_decls(
                            b"await using",
                            s.decls.slice(),
                            flags,
                            TopLevelAndIsExport::default(),
                        ),
                    }
                }
                // for(;)
                StmtData::SEmpty(_) => {}
                _ => Output::panic(format_args!("Internal error: Unexpected stmt in for loop")),
            }
        }

        pub fn print_if(&mut self, s: &S::If, loc: bun_ast::Loc, tlmtlo: TopLevel) {
            self.print_space_before_identifier();
            self.add_source_mapping(loc);
            self.print(b"if");
            self.print_space();
            self.print(b"(");
            self.print_expr(s.test_, Level::Lowest, ExprFlag::none());
            self.print(b")");

            match &s.yes.data {
                StmtData::SBlock(block) => {
                    self.print_space();
                    self.print_block(
                        s.yes.loc,
                        slice_of(block.stmts),
                        Some(block.close_brace_loc),
                        tlmtlo,
                    );
                    if s.no.is_some() {
                        self.print_space();
                    } else {
                        self.print_newline();
                    }
                }
                _ => {
                    if Self::wrap_to_avoid_ambiguous_else(&s.yes.data) {
                        self.print_space();
                        self.print(b"{");
                        self.print_newline();

                        self.indent();
                        self.print_stmt(s.yes, tlmtlo).expect("unreachable");
                        self.unindent();
                        self.needs_semicolon = false;

                        self.print_indent();
                        self.print(b"}");

                        if s.no.is_some() {
                            self.print_space();
                        } else {
                            self.print_newline();
                        }
                    } else {
                        self.print_newline();
                        self.indent();
                        self.print_stmt(s.yes, tlmtlo).expect("unreachable");
                        self.unindent();

                        if s.no.is_some() {
                            self.print_indent();
                        }
                    }
                }
            }

            if let Some(no_block) = &s.no {
                self.print_semicolon_if_needed();
                self.print_space_before_identifier();
                self.add_source_mapping(no_block.loc);
                self.print(b"else");

                match &no_block.data {
                    StmtData::SBlock(block) => {
                        self.print_space();
                        self.print_block(no_block.loc, slice_of(block.stmts), None, tlmtlo);
                        self.print_newline();
                    }
                    StmtData::SIf(s_if) => {
                        self.print_if(s_if, no_block.loc, tlmtlo);
                    }
                    _ => {
                        self.print_newline();
                        self.indent();
                        self.print_stmt(*no_block, tlmtlo).expect("unreachable");
                        self.unindent();
                    }
                }
            }
        }

        pub fn wrap_to_avoid_ambiguous_else(s_: &StmtData) -> bool {
            let mut s = s_;
            loop {
                match s {
                    StmtData::SIf(index) => {
                        if let Some(no) = &index.no {
                            s = &no.data;
                        } else {
                            return true;
                        }
                    }
                    StmtData::SFor(current) => s = &current.body.data,
                    StmtData::SForIn(current) => s = &current.body.data,
                    StmtData::SForOf(current) => s = &current.body.data,
                    StmtData::SWhile(current) => s = &current.body.data,
                    StmtData::SWith(current) => s = &current.body.data,
                    StmtData::SLabel(current) => s = &current.stmt.data,
                    _ => return false,
                }
            }
        }

        pub fn try_to_get_imported_enum_value(
            &self,
            target: Expr,
            name: &[u8],
        ) -> Option<js_ast::InlinedEnumValueDecoded> {
            if let ExprData::EImportIdentifier(id) = &target.data {
                let ref_ = self.symbols().follow(id.ref_);
                if let Some(symbol) = self.symbols().get_const(ref_) {
                    if symbol.kind == js_ast::symbol::Kind::TsEnum {
                        if let Some(enum_value) = self.options.ts_enums.and_then(|m| m.get(&ref_)) {
                            if let Some(value) = enum_value.get(name) {
                                return Some(value.decode());
                            }
                        }
                    }
                }
            }
            None
        }

        pub fn print_inlined_enum(
            &mut self,
            inlined: js_ast::InlinedEnumValueDecoded,
            comment: &[u8],
            level: Level,
        ) {
            match inlined {
                js_ast::InlinedEnumValueDecoded::Number(num) => self.print_number(num, level),
                // TODO: extract printString
                js_ast::InlinedEnumValueDecoded::String(str) => self.print_expr(
                    // Arena-owned `*const EString` (encoded non-null at NaN-box time);
                    // wrap via the safe `From<NonNull>` ctor — printer only reads it.
                    Expr {
                        data: ExprData::EString(js_ast::StoreRef::from(
                            NonNull::new(str.cast_mut()).expect("inlined enum string non-null"),
                        )),
                        loc: bun_ast::Loc::EMPTY,
                    },
                    level,
                    ExprFlagSet::empty(),
                ),
            }

            if !self.options.minify_whitespace && !self.options.minify_identifiers {
                // TODO: rewrite this to handle </script>
                if !strings::contains(comment, b"*/") {
                    self.print(b" /* ");
                    self.print(comment);
                    self.print(b" */");
                }
            }
        }

        pub fn print_decl_stmt(
            &mut self,
            is_export: bool,
            keyword: &'static [u8],
            decls: &[G::Decl],
            tlmtlo: TopLevel,
        ) {
            if !REWRITE_ESM_TO_CJS && is_export {
                self.print(b"export ");
            }
            let tlm: TopLevelAndIsExport = if Self::MAY_HAVE_MODULE_INFO {
                TopLevelAndIsExport {
                    is_export,
                    is_top_level: if keyword == b"var" {
                        if tlmtlo.is_top_level() {
                            Some(analyze_transpiled_module::VarKind::Declared)
                        } else {
                            None
                        }
                    } else {
                        // let/const are block-scoped: only record at true top-level,
                        // not inside blocks where subVar() downgrades to .var_only.
                        if tlmtlo.is_top_level == IsTopLevel::Yes {
                            Some(analyze_transpiled_module::VarKind::Lexical)
                        } else {
                            None
                        }
                    },
                }
            } else {
                TopLevelAndIsExport::default()
            };
            self.print_decls(keyword, decls, ExprFlag::none(), tlm);
            self.print_semicolon_after_statement();
            // TODO(b2-blocked): bun_ast::runtime::Imports::__export — the
            // full `runtime.rs` is ``-gated upstream; the active
            // `parser.rs::Runtime::Imports` stub is a fieldless unit struct.

            if REWRITE_ESM_TO_CJS && is_export && !decls.is_empty() {
                // PORT NOTE: Zig stored `?GeneratedSymbol`; the Rust `runtime::Imports`
                // flattens this to `Option<Ref>`, so no `.ref_` projection.
                let export_ref = self.options.runtime_imports.__export.unwrap();
                for decl in decls {
                    self.print_indent();
                    self.print_symbol(export_ref);
                    self.print(b"(");
                    self.print_space_before_identifier();
                    self.print_module_export_symbol();
                    self.print(b",");
                    self.print_space();

                    match &decl.binding.data {
                        BindingData::BIdentifier(ident) => {
                            let ident = ident.get();
                            self.print(b"{");
                            self.print_space();
                            self.print_symbol(ident.r#ref);
                            if self.options.minify_whitespace {
                                self.print(b":()=>(");
                            } else {
                                self.print(b": () => (");
                            }
                            self.print_symbol(ident.r#ref);
                            self.print(b") }");
                        }
                        BindingData::BObject(obj) => {
                            let obj = obj.get();
                            self.print(b"{");
                            self.print_space();
                            for prop in slice_of(obj.properties).iter() {
                                if let BindingData::BIdentifier(ident) = &prop.value.data {
                                    let ident = ident.get();
                                    self.print_symbol(ident.r#ref);
                                    if self.options.minify_whitespace {
                                        self.print(b":()=>(");
                                    } else {
                                        self.print(b": () => (");
                                    }
                                    self.print_symbol(ident.r#ref);
                                    self.print(b"),");
                                    self.print_newline();
                                }
                            }
                            self.print(b"}");
                        }
                        _ => {
                            self.print_binding(decl.binding, TopLevelAndIsExport::default());
                        }
                    }
                    self.print(b")");
                    self.print_semicolon_after_statement();
                }
            }
        }

        pub fn print_identifier(&mut self, identifier: &[u8]) {
            if ASCII_ONLY {
                self.print_identifier_ascii_only(identifier);
            } else {
                self.print(identifier);
            }
        }

        fn print_identifier_ascii_only(&mut self, identifier: &[u8]) {
            // Fast path: ~all identifiers are pure ASCII. A single SIMD scan + one
            // print() beats the per-byte CodepointIterator loop below. Valid JS
            // identifier bytes in the ASCII range are [$_a-zA-Z0-9], so the < 0x80
            // check is equivalent to the FIRST_ASCII..=LAST_ASCII range here.
            if strings::is_all_ascii(identifier) {
                self.print(identifier);
                return;
            }

            let mut ascii_start: usize = 0;
            let mut is_ascii = false;
            let mut iter = CodepointIterator::init(identifier);
            let mut cursor = strings::Cursor::default();
            while iter.next(&mut cursor) {
                match cursor.c as u32 {
                    FIRST_ASCII..=LAST_ASCII => {
                        if !is_ascii {
                            ascii_start = (cursor.i as usize);
                            is_ascii = true;
                        }
                    }
                    _ => {
                        if is_ascii {
                            self.print(&identifier[ascii_start..(cursor.i as usize)]);
                            is_ascii = false;
                        }
                        self.print(b"\\u{");
                        let _ = self.fmt(format_args!("{:x}", cursor.c));
                        self.print(b"}");
                    }
                }
            }

            if is_ascii {
                self.print(&identifier[ascii_start..]);
            }
        }

        pub fn print_identifier_utf16(&mut self, name: &[u16]) -> Result<(), bun_core::Error> {
            let n = name.len();
            let mut i: usize = 0;

            type CodeUnitType = u32;
            while i < n {
                let mut c: CodeUnitType = name[i] as CodeUnitType;
                i += 1;

                if strings::u16_is_lead(name[i - 1]) && i < n {
                    // INTENTIONALLY no `u16_is_trail` check — matches Zig js_printer.zig:5311.
                    c = strings::u16_get_supplementary(name[i - 1], name[i]);
                    i += 1;
                }

                if ASCII_ONLY && c > LAST_ASCII {
                    match c {
                        0..=0xFFFF => self.print(&bmp_escape(c)[..]),
                        _ => {
                            self.print(b"\\u");
                            let mut tmp = [0u8; 4];
                            let len = encode_wtf8_rune_t(&mut tmp, c as u32);
                            self.writer
                                .write_reserved(&tmp[..len])
                                .expect("unreachable");
                        }
                    }
                    continue;
                }

                {
                    let mut tmp = [0u8; 4];
                    let len = encode_wtf8_rune_t(&mut tmp, c as u32);
                    self.writer
                        .write_reserved(&tmp[..len])
                        .expect("unreachable");
                }
            }
            Ok(())
        }

        pub fn print_number(&mut self, value: f64, level: Level) {
            let abs_value = value.abs();
            if value.is_nan() {
                self.print_space_before_identifier();
                self.print(b"NaN");
            } else if value.is_infinite() {
                let is_neg_inf = value.is_sign_negative();
                let wrap = ((!self.options.has_run_symbol_renamer || self.options.minify_syntax)
                    && level.gte(Level::Multiply))
                    || (is_neg_inf && level.gte(Level::Prefix));

                if wrap {
                    self.print(b"(");
                }

                if is_neg_inf {
                    self.print_space_before_operator(Op::Code::UnNeg);
                    self.print(b"-");
                } else {
                    self.print_space_before_identifier();
                }

                // If we are not running the symbol renamer, we must not print "Infinity".
                if IS_JSON || (!self.options.minify_syntax && self.options.has_run_symbol_renamer) {
                    self.print(b"Infinity");
                } else if self.options.minify_whitespace {
                    self.print(b"1/0");
                } else {
                    self.print(b"1 / 0");
                }

                if wrap {
                    self.print(b")");
                }
            } else if !value.is_sign_negative() {
                self.print_space_before_identifier();
                self.print_non_negative_float(abs_value);
                // Remember the end of the latest number
                self.prev_num_end = self.writer.written();
            } else if level.gte(Level::Prefix) {
                // Expressions such as "(-1).toString" need to wrap negative numbers.
                // Instead of testing for "value < 0" we test for "signbit(value)" and
                // "!isNaN(value)" because we need this to be true for "-0" and "-0 < 0"
                // is false.
                self.print(b"(-");
                self.print_non_negative_float(abs_value);
                self.print(b")");
            } else {
                self.print_space_before_operator(Op::Code::UnNeg);
                self.print(b"-");
                self.print_non_negative_float(abs_value);
                // Remember the end of the latest number
                self.prev_num_end = self.writer.written();
            }
        }

        pub fn print_indented_comment(&mut self, _text: &[u8]) {
            let mut text = _text;
            if text.starts_with(b"/*") {
                // Re-indent multi-line comments
                while let Some(newline_index) = strings::index_of_char(text, b'\n') {
                    let newline_index = newline_index as usize;
                    // Skip over \r if it precedes \n
                    if newline_index > 0 && text[newline_index - 1] == b'\r' {
                        self.print(&text[..newline_index - 1]);
                        self.print(b"\n");
                    } else {
                        self.print(&text[..newline_index + 1]);
                    }
                    self.print_indent();
                    text = &text[newline_index + 1..];
                }
                self.print(text);
                self.print_newline();
            } else {
                // Print a mandatory newline after single-line comments
                if !text.is_empty() && text[text.len() - 1] == b'\r' {
                    text = &text[..text.len() - 1];
                }
                self.print(text);
                self.print(b"\n");
            }
        }

        pub fn init(
            writer: W,
            bump: &'a bun_alloc::Arena,
            import_records: &'a [ImportRecord],
            opts: Options<'a>,
            renamer: rename::Renamer<'a, 'a>,
            source_map_builder: SourceMap::chunk::Builder,
        ) -> Self {
            let mut printer = Self {
                bump,
                import_records,
                needs_semicolon: false,
                stmt_start: -1,
                options: opts,
                export_default_start: -1,
                arrow_expr_start: -1,
                for_of_init_start: -1,
                prev_op: Op::Code::BinAdd,
                prev_op_end: -1,
                prev_num_end: -1,
                prev_reg_exp_end: -1,
                call_target: None,
                writer,
                has_printed_bundled_import_statement: false,
                renamer,
                prev_stmt_tag: StmtTag::SEmpty,
                source_map_builder,
                symbol_counter: 0,
                temporary_bindings: Vec::new(),
                binary_expression_stack: Vec::new(),
                was_lazy_export: false,
                module_info: None,
            };
            // Spec js_printer.zig:5454-5460 caches `line_offset_tables.items(.byte_offset_to_start_of_line)`
            // into `line_offset_table_byte_offset_list`. The Rust `Builder` field is `&'static [u32]`
            // pending Phase-B lifetime threading, so instead of caching a self-borrow here,
            // `Builder::add_source_mapping` derives the slice on demand from `line_offset_tables`
            // via `ListExt::items_byte_offset_to_start_of_line()` (see Chunk.rs).
            let _ = GENERATE_SOURCE_MAP;
            printer
        }

        pub fn print_dev_server_module(
            &mut self,
            source: &bun_ast::Source,
            ast: &js_ast::Ast,
            part: &js_ast::Part,
        ) {
            self.indent();
            self.print_indent();

            self.print_string_literal_utf8(source.path.pretty, false);

            let stmts = slice_of(part.stmts);
            let func = &stmts[0]
                .data
                .s_expr()
                .unwrap()
                .value
                .data
                .e_function()
                .expect("infallible: variant checked")
                .func;

            // Special-case lazy-export AST
            if ast.has_lazy_export {
                // @branchHint(.unlikely)
                self.print_fn_args(
                    Some(func.open_parens_loc),
                    slice_of(func.args),
                    func.flags.contains(G::FnFlags::HasRestArg),
                    false,
                );
                self.print_space();
                self.print(b"{\n");
                let body_stmts = slice_of(func.body.stmts);
                let lazy = body_stmts[0].data.s_lazy_export().unwrap();
                if !matches!(*lazy, ExprData::EUndefined(_)) {
                    self.indent();
                    self.print_indent();
                    self.print_symbol(self.options.hmr_ref);
                    self.print(b".cjs.exports = ");
                    self.print_expr(
                        Expr {
                            data: *lazy,
                            loc: body_stmts[0].loc,
                        },
                        Level::Comma,
                        ExprFlagSet::empty(),
                    );
                    self.print(b"; // bun .s_lazy_export\n");
                    self.unindent();
                }
                self.print_indent();
                self.print(b"},\n");
                return;
            }
            // ESM is represented by an array tuple [ dependencies, exports, starImports, load, async ];
            else if ast.exports_kind == js_ast::ExportsKind::Esm {
                self.print(b": [ [");
                // Print the dependencies.
                if stmts.len() > 1 {
                    self.indent();
                    self.print(b"\n");
                    for stmt in &stmts[1..] {
                        self.print_indent();
                        let import = stmt.data.s_import().unwrap();
                        let record = self.import_record(import.import_record_index as usize);
                        self.print_string_literal_utf8(&record.path.pretty, false);

                        let item_count = u32::from(import.default_name.is_some())
                            + u32::try_from(slice_of(import.items).len()).expect("int cast");
                        let _ = self.fmt(format_args!(", {},", item_count));
                        if item_count == 0 {
                            // Add a comment explaining why the number could be zero
                            self.print(if import.star_name_loc.is_some() {
                                b" // namespace import".as_slice()
                            } else {
                                b" // bare import".as_slice()
                            });
                        } else {
                            if import.default_name.is_some() {
                                self.print(b" \"default\",");
                            }
                            for item in slice_of(import.items).iter() {
                                self.print(b" ");
                                self.print_string_literal_utf8(item.alias.slice(), false);
                                self.print(b",");
                            }
                        }
                        self.print(b"\n");
                    }
                    self.unindent();
                    self.print_indent();
                }
                self.print(b"], [");

                // Print the exports
                if ast.named_exports.count() > 0 {
                    self.indent();
                    let mut len: usize = usize::MAX;
                    for key in ast.named_exports.keys() {
                        if len > 120 {
                            self.print_newline();
                            self.print_indent();
                            len = 0;
                        } else {
                            self.print(b" ");
                        }
                        len += key.len();
                        self.print_string_literal_utf8(key, false);
                        self.print(b",");
                    }
                    self.unindent();
                    self.print_newline();
                    self.print_indent();
                }
                self.print(b"], [");

                // Print export stars
                self.indent();
                let mut had_any_stars = false;
                for &star in ast.export_star_import_records.iter() {
                    let record = self.import_record(star as usize);
                    if record.path.is_disabled {
                        continue;
                    }
                    had_any_stars = true;
                    self.print_newline();
                    self.print_indent();
                    self.print_string_literal_utf8(&record.path.pretty, false);
                    self.print(b",");
                }
                self.unindent();
                if had_any_stars {
                    self.print_newline();
                    self.print_indent();
                }
                self.print(b"], ");

                // Print the code
                if !ast.top_level_await_keyword.is_empty() {
                    self.print(b"async");
                }
                self.print_fn_args(
                    Some(func.open_parens_loc),
                    slice_of(func.args),
                    func.flags.contains(G::FnFlags::HasRestArg),
                    false,
                );
                self.print(b" => {\n");
                self.indent();
                self.print_block_body(slice_of(func.body.stmts), TopLevel::init(IsTopLevel::No));
                self.unindent();
                self.print_indent();
                self.print(b"}, ");

                // Print isAsync
                self.print(if !ast.top_level_await_keyword.is_empty() {
                    b"true".as_slice()
                } else {
                    b"false".as_slice()
                });
                self.print(b"],\n");
            } else {
                debug_assert!(ast.exports_kind == js_ast::ExportsKind::Cjs);
                self.print_func(func);
                self.print(b",\n");
            }

            self.unindent();
        }
    }
} // mod __gated_printer

// ───────────────────────────────────────────────────────────────────────────
// PrintArg helper trait (Zig's `anytype` for `print()`)
// ───────────────────────────────────────────────────────────────────────────

pub trait PrintArg {
    fn print_into<W: WriterTrait>(self, w: &mut W);
}
impl PrintArg for u8 {
    fn print_into<W: WriterTrait>(self, w: &mut W) {
        w.print_byte(self);
    }
}
// PORT NOTE: Zig `print(str: anytype)` matched `comptime_int, u16, u8` and narrowed via
// `@as(u8, @intCast(str))` before `writeByte`. Mirror that for `u16` so wide-int char callers
// (e.g. UTF-16 iteration) compile and emit one byte identically.
impl PrintArg for u16 {
    #[inline]
    fn print_into<W: WriterTrait>(self, w: &mut W) {
        w.print_byte(self as u8);
    }
}
impl PrintArg for &[u8] {
    fn print_into<W: WriterTrait>(self, w: &mut W) {
        w.print_slice(self);
    }
}
impl<const N: usize> PrintArg for &[u8; N] {
    fn print_into<W: WriterTrait>(self, w: &mut W) {
        w.print_slice(self);
    }
}

/// Trait covering `B::ArrayItem` / `B::Property` for `maybe_print_default_binding_value`.
pub trait HasDefaultValue {
    fn default_value(&self) -> Option<js_ast::Expr>;
}
impl HasDefaultValue for js_ast::b::Property {
    #[inline]
    fn default_value(&self) -> Option<js_ast::Expr> {
        self.default_value
    }
}
impl HasDefaultValue for js_ast::ArrayBinding {
    #[inline]
    fn default_value(&self) -> Option<js_ast::Expr> {
        self.default_value
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Writer (NewWriter)
// ───────────────────────────────────────────────────────────────────────────

pub struct WriteResult {
    pub off: u32,
    pub len: usize,
    pub end_off: u32,
}

/// Backend operations a `Writer` context provides. Mirrors the comptime fn-pointer
/// params of Zig's `NewWriter(...)`.
pub trait WriterContext {
    fn write_byte(&mut self, char: u8) -> Result<usize, bun_core::Error>;
    fn write_all(&mut self, buf: &[u8]) -> Result<usize, bun_core::Error>;
    fn get_last_byte(&self) -> u8;
    fn get_last_last_byte(&self) -> u8;
    fn reserve_next(&mut self, count: u64) -> Result<*mut u8, bun_core::Error>;
    fn advance_by(&mut self, count: u64);
    fn slice(&self) -> &[u8];
    fn get_mutable_buffer(&mut self) -> &mut MutableString;
    fn take_buffer(&mut self) -> MutableString;
    fn get_written(&self) -> &[u8];
    fn flush(&mut self) -> Result<(), bun_core::Error> {
        Ok(())
    }
    fn done(&mut self) -> Result<(), bun_core::Error> {
        Ok(())
    }
    // TODO(port): copyFileRange optional method (`@hasDecl` check in Zig)
}

/// Abstracted writer interface used by `Printer` (the methods Printer calls on `p.writer`).
pub trait WriterTrait {
    fn written(&self) -> i32;
    fn prev_char(&self) -> u8;
    fn prev_prev_char(&self) -> u8;
    fn print_byte(&mut self, b: u8);
    fn print_slice(&mut self, s: &[u8]);
    fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error>;
    fn advance(&mut self, count: u64);
    /// Reserve `bytes.len()`, memcpy `bytes` into the reserved region, then advance.
    /// Centralizes the open-coded `reserve + copy_nonoverlapping + advance` triplet
    /// (Zig js_printer.zig:874, 1505-1573, 5332, 5340 all open-code this).
    #[inline]
    fn write_reserved(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        let ptr = self.reserve(bytes.len() as u64)?;
        // SAFETY: `reserve(n)` returns a writable region of >= n bytes owned by the
        // writer's internal buffer, which is disjoint from caller-provided `bytes`.
        unsafe { core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()) };
        self.advance(bytes.len() as u64);
        Ok(())
    }
    fn slice(&self) -> &[u8];
    fn get_error(&self) -> Result<(), bun_core::Error>;
    fn done(&mut self) -> Result<(), bun_core::Error>;
    fn std_writer(&mut self) -> StdWriterAdapter<'_, Self>
    where
        Self: Sized,
    {
        StdWriterAdapter(self)
    }
    fn take_buffer(&mut self) -> MutableString;
    // TODO(port): get_mutable_buffer / ctx access for source-map chunk generation
}

pub struct StdWriterAdapter<'a, W: ?Sized>(&'a mut W);
impl<'a, W: WriterTrait + ?Sized> Write for StdWriterAdapter<'a, W> {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        self.0.print_slice(bytes);
        Ok(())
    }
}

pub struct Writer<C: WriterContext> {
    pub ctx: C,
    pub written: i32,
    // Used by the printer
    pub prev_char: u8,
    pub prev_prev_char: u8,
    pub err: Option<bun_core::Error>,
    pub orig_err: Option<bun_core::Error>,
}

impl<C: WriterContext> Writer<C> {
    pub fn init(ctx: C) -> Self {
        Self {
            ctx,
            written: -1,
            prev_char: 0,
            prev_prev_char: 0,
            err: None,
            orig_err: None,
        }
    }

    pub fn std_writer_write(&mut self, bytes: &[u8]) -> Result<usize, core::convert::Infallible> {
        self.print_slice(bytes);
        Ok(bytes.len())
    }

    pub fn is_copy_file_range_supported() -> bool {
        // TODO(port): @hasDecl(ContextType, "copyFileRange")
        false
    }

    pub fn copy_file_range(
        ctx: C,
        in_file: Fd,
        start: usize,
        end: usize,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): ctx.sendfile(in_file, start, end)
        let _ = (ctx, in_file, start, end);
        Ok(())
    }

    pub fn get_mutable_buffer(&mut self) -> &mut MutableString {
        self.ctx.get_mutable_buffer()
    }
    pub fn take_buffer(&mut self) -> MutableString {
        self.ctx.take_buffer()
    }
    pub fn slice(&self) -> &[u8] {
        self.ctx.slice()
    }

    pub fn get_error(&self) -> Result<(), bun_core::Error> {
        if let Some(e) = self.orig_err {
            return Err(e);
        }
        if let Some(e) = self.err {
            return Err(e);
        }
        Ok(())
    }

    #[inline]
    pub fn prev_char(&self) -> u8 {
        self.ctx.get_last_byte()
    }
    #[inline]
    pub fn prev_prev_char(&self) -> u8 {
        self.ctx.get_last_last_byte()
    }

    pub fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> {
        self.ctx.reserve_next(count)
    }

    pub fn advance(&mut self, count: u64) {
        self.ctx.advance_by(count);
        // PERF(port): @intCast — output never approaches 2 GiB; checked add of
        // a u64→i32 here was a measurable branch in the per-token print path.
        // Keep Zig's debug-mode @intCast contract without paying for it in release.
        debug_assert!(count <= i32::MAX as u64);
        self.written = self.written.wrapping_add(count as i32);
    }

    pub fn write_all(&mut self, bytes: &[u8]) -> Result<usize, bun_core::Error> {
        let written = self.written.max(0);
        self.print_slice(bytes);
        debug_assert!(self.written >= 0);
        Ok((self.written as usize).wrapping_sub(written as usize))
    }

    #[inline]
    pub fn print_byte(&mut self, b: u8) {
        match self.ctx.write_byte(b) {
            Ok(n) => {
                self.written = self.written.wrapping_add(n as i32);
                if n == 0 {
                    self.err = Some(bun_core::err!("WriteFailed"));
                }
            }
            Err(err) => {
                self.orig_err = Some(err);
                self.err = Some(bun_core::err!("WriteFailed"));
            }
        }
    }

    #[inline]
    pub fn print_slice(&mut self, s: &[u8]) {
        match self.ctx.write_all(s) {
            Ok(n) => {
                self.written = self.written.wrapping_add(n as i32);
                if n < s.len() {
                    self.err = Some(if n == 0 {
                        bun_core::err!("WriteFailed")
                    } else {
                        bun_core::err!("PartialWrite")
                    });
                }
            }
            Err(err) => {
                self.orig_err = Some(err);
                self.err = Some(bun_core::err!("WriteFailed"));
            }
        }
    }

    pub fn flush(&mut self) -> Result<(), bun_core::Error> {
        self.ctx.flush()
    }
    pub fn done(&mut self) -> Result<(), bun_core::Error> {
        self.ctx.done()
    }
}

impl<C: WriterContext> WriterTrait for Writer<C> {
    #[inline]
    fn written(&self) -> i32 {
        self.written
    }
    #[inline]
    fn prev_char(&self) -> u8 {
        self.prev_char()
    }
    #[inline]
    fn prev_prev_char(&self) -> u8 {
        self.prev_prev_char()
    }
    #[inline]
    fn print_byte(&mut self, b: u8) {
        self.print_byte(b)
    }
    #[inline]
    fn print_slice(&mut self, s: &[u8]) {
        self.print_slice(s)
    }
    #[inline]
    fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> {
        self.reserve(count)
    }
    #[inline]
    fn advance(&mut self, count: u64) {
        self.advance(count)
    }
    #[inline]
    fn slice(&self) -> &[u8] {
        self.slice()
    }
    #[inline]
    fn get_error(&self) -> Result<(), bun_core::Error> {
        self.get_error()
    }
    #[inline]
    fn done(&mut self) -> Result<(), bun_core::Error> {
        self.done()
    }
    #[inline]
    fn take_buffer(&mut self) -> MutableString {
        self.take_buffer()
    }
}

// `&mut W` forwards to `W` so `printWithWriter(*BufferPrinter, ...)` works.
impl<W: WriterTrait> WriterTrait for &mut W {
    #[inline]
    fn written(&self) -> i32 {
        (**self).written()
    }
    #[inline]
    fn prev_char(&self) -> u8 {
        (**self).prev_char()
    }
    #[inline]
    fn prev_prev_char(&self) -> u8 {
        (**self).prev_prev_char()
    }
    #[inline]
    fn print_byte(&mut self, b: u8) {
        (**self).print_byte(b)
    }
    #[inline]
    fn print_slice(&mut self, s: &[u8]) {
        (**self).print_slice(s)
    }
    #[inline]
    fn reserve(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> {
        (**self).reserve(count)
    }
    #[inline]
    fn advance(&mut self, count: u64) {
        (**self).advance(count)
    }
    #[inline]
    fn slice(&self) -> &[u8] {
        (**self).slice()
    }
    #[inline]
    fn get_error(&self) -> Result<(), bun_core::Error> {
        (**self).get_error()
    }
    #[inline]
    fn done(&mut self) -> Result<(), bun_core::Error> {
        (**self).done()
    }
    #[inline]
    fn take_buffer(&mut self) -> MutableString {
        (**self).take_buffer()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// DirectWriter / BufferWriter
// ───────────────────────────────────────────────────────────────────────────

pub struct DirectWriter {
    pub handle: Fd,
}

impl DirectWriter {
    pub fn write(&mut self, buf: &[u8]) -> Result<usize, bun_core::Error> {
        // TODO(port): Zig used std.posix.write directly. Route via bun_sys::write.
        bun_sys::write(self.handle, buf)
            .map_err(|e| bun_core::Error::from_errno(i32::from(e.errno)))
    }
    pub fn write_all(&mut self, buf: &[u8]) -> Result<(), bun_core::Error> {
        let _ = self.write(buf)?;
        Ok(())
    }
}

pub struct BufferWriter {
    pub buffer: MutableString,
    /// Watermark into `buffer.list` set by `done()`. Zig stored `written: []u8` aliasing
    /// `buffer`; Rust can't keep a self-borrowing slice in a field, so store the length and
    /// reslice on read (`written()` / `written_without_trailing_zero()`). Avoids the O(n)
    /// `to_vec().into_boxed_slice()` copy the previous port did on every `done()`.
    pub written_len: usize,
    pub sentinel: &'static bun_core::ZStr, // TODO(port): lifetime — Zig stored a sentinel slice into `buffer`
    pub append_null_byte: bool,
    pub append_newline: bool,
}

impl BufferWriter {
    pub fn get_mutable_buffer(&mut self) -> &mut MutableString {
        &mut self.buffer
    }

    pub fn take_buffer(&mut self) -> MutableString {
        core::mem::replace(&mut self.buffer, MutableString::init_empty())
    }

    pub fn get_written(&self) -> &[u8] {
        self.buffer.list.as_slice()
    }

    /// Slice set by `done()` — zero-cost reslice of `buffer` (matches Zig's `ctx.written`).
    pub fn written(&self) -> &[u8] {
        &self.buffer.list[..self.written_len]
    }

    pub fn init() -> BufferWriter {
        BufferWriter {
            buffer: MutableString::init_empty(),
            written_len: 0,
            sentinel: bun_core::ZStr::EMPTY,
            append_null_byte: false,
            append_newline: false,
        }
    }

    /// Like [`init`], but pre-sizes the output buffer. The transpiled output is
    /// almost always within a small factor of the source length, so reserving up
    /// front avoids the repeated grow+`memmove` the `Vec` doubling would
    /// otherwise do as the printer appends token-by-token. (`MutableString::init`
    /// is a no-op when `capacity == 0`.)
    pub fn with_capacity(capacity: usize) -> BufferWriter {
        BufferWriter {
            buffer: MutableString::init(capacity).unwrap_or_else(|_| MutableString::init_empty()),
            written_len: 0,
            sentinel: bun_core::ZStr::EMPTY,
            append_null_byte: false,
            append_newline: false,
        }
    }

    pub fn print(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), bun_core::Error> {
        Write::write_fmt(&mut self.buffer.list, format_args!("{}", args))
    }

    pub fn write_byte_n_times(&mut self, byte: u8, n: usize) -> Result<(), bun_core::Error> {
        self.buffer.append_char_n_times(byte, n)?;
        Ok(())
    }
    // alias
    pub fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<(), bun_core::Error> {
        self.write_byte_n_times(byte, n)
    }

    #[inline]
    pub fn write_byte(&mut self, byte: u8) -> Result<usize, bun_core::Error> {
        self.buffer.append_char(byte)?;
        Ok(1)
    }

    #[inline]
    pub fn write_all(&mut self, bytes: &[u8]) -> Result<usize, bun_core::Error> {
        self.buffer.append(bytes)?;
        Ok(bytes.len())
    }

    #[inline]
    pub fn slice(&self) -> &[u8] {
        self.buffer.list.as_slice()
    }

    /// `prev_char` for the printer. The 2-byte window the printer queries is
    /// derived lazily from the tail of `buffer` here (a rare query site) rather
    /// than maintained after every `write_byte`/`write_all` (the hot path).
    #[inline]
    pub fn get_last_byte(&self) -> u8 {
        let list = &self.buffer.list;
        let len = list.len();
        if len >= 1 { list[len - 1] } else { 0 }
    }
    #[inline]
    pub fn get_last_last_byte(&self) -> u8 {
        let list = &self.buffer.list;
        let len = list.len();
        if len >= 2 { list[len - 2] } else { 0 }
    }

    pub fn reserve_next(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> {
        let n = usize::try_from(count).expect("int cast");
        // SAFETY: caller treats as write-only; advance_by() commits via commit_spare.
        Ok(unsafe { bun_core::vec::reserve_spare_bytes(&mut self.buffer.list, n) }.as_mut_ptr())
    }

    pub fn advance_by(&mut self, count: u64) {
        let count_usize = usize::try_from(count).expect("int cast");
        // SAFETY: reserve_next reserved and the caller initialized [len..len+count).
        unsafe { bun_core::vec::commit_spare(&mut self.buffer.list, count_usize) };
    }

    pub fn reset(&mut self) {
        self.buffer.reset();
        self.written_len = 0;
    }

    pub fn written_without_trailing_zero(&self) -> &[u8] {
        let mut written = &self.buffer.list[..self.written_len];
        while !written.is_empty() && written[written.len() - 1] == 0 {
            written = &written[..written.len() - 1];
        }
        written
    }

    pub fn done(&mut self) -> Result<(), bun_core::Error> {
        if self.append_newline {
            self.append_newline = false;
            self.buffer.append_char(b'\n')?;
        }

        if self.append_null_byte {
            // TODO(port): self.sentinel = self.buffer.slice_with_sentinel() — borrows buffer
            self.written_len = self.buffer.list.len();
        } else {
            self.written_len = self.buffer.list.len();
        }
        Ok(())
    }

    pub fn flush(&mut self) -> Result<(), bun_core::Error> {
        Ok(())
    }
}

impl WriterContext for BufferWriter {
    #[inline]
    fn write_byte(&mut self, c: u8) -> Result<usize, bun_core::Error> {
        self.write_byte(c)
    }
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<usize, bun_core::Error> {
        self.write_all(buf)
    }
    #[inline]
    fn get_last_byte(&self) -> u8 {
        self.get_last_byte()
    }
    #[inline]
    fn get_last_last_byte(&self) -> u8 {
        self.get_last_last_byte()
    }
    #[inline]
    fn reserve_next(&mut self, count: u64) -> Result<*mut u8, bun_core::Error> {
        self.reserve_next(count)
    }
    #[inline]
    fn advance_by(&mut self, count: u64) {
        self.advance_by(count)
    }
    #[inline]
    fn slice(&self) -> &[u8] {
        self.slice()
    }
    #[inline]
    fn get_mutable_buffer(&mut self) -> &mut MutableString {
        self.get_mutable_buffer()
    }
    #[inline]
    fn take_buffer(&mut self) -> MutableString {
        self.take_buffer()
    }
    #[inline]
    fn get_written(&self) -> &[u8] {
        self.get_written()
    }
    #[inline]
    fn flush(&mut self) -> Result<(), bun_core::Error> {
        self.flush()
    }
    #[inline]
    fn done(&mut self) -> Result<(), bun_core::Error> {
        self.done()
    }
}

pub type BufferPrinter = Writer<BufferWriter>;

// ───────────────────────────────────────────────────────────────────────────
// Format / GenerateSourceMap
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Esm,
    Cjs,
    // bun.js must escape non-latin1 identifiers in the output This is because
    // we load JavaScript as a UTF-8 buffer instead of a UTF-16 buffer
    // JavaScriptCore does not support UTF-8 identifiers when the source code
    // string is loaded as const char* We don't want to double the size of code
    // in memory...
    EsmAscii,
    CjsAscii,
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum GenerateSourceMap {
    Disable,
    Lazy,
    Eager,
}

impl GenerateSourceMap {
    /// Const-fn helpers so a `bool` const-generic can pick the variant inside a
    /// `{ ... }` const argument (`generic_const_exprs` rejects raw `if`).
    pub const fn lazy_if(generate: bool) -> Self {
        if generate { Self::Lazy } else { Self::Disable }
    }
    pub const fn eager_if(generate: bool) -> Self {
        if generate { Self::Eager } else { Self::Disable }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Top-level print entry points — `get_source_map_builder` / `print` /
// `print_with_writer{,_and_platform}` / `print_common_js` are live (the
// `bun_crash_handler::current_action` / `bun_core::perf::trace` /
// `bun_sourcemap::chunk::Builder: Default` blockers are all real now, so the
// former `__gated_entry_points` wrapper has been flattened away).
// `print_ast` is live (borrowck reshape: `opts` re-reads routed through
// `printer.options`, `*mut Symbol` for `must_not_be_renamed`, raw-ptr
// `Scope.parent` backref). `print_json` remains individually re-gated on
// lower-tier surface (see TODO(b2-blocked) markers inline).
// ───────────────────────────────────────────────────────────────────────────
use self::__gated_printer::{Printer, slice_of};
use js_ast::Ast;

// PORT NOTE: Zig had `comptime generate_source_map`; Rust's `generic_const_exprs`
// can't compute a non-`bool` const-generic from a `bool` const-generic without
// viral `where` clauses, and the body only does runtime branches anyway. The
// `IS_BUN_PLATFORM` axis stays const so `prepend_count` is still a compile-time
// constant in the monomorphized callers.
pub fn get_source_map_builder<const IS_BUN_PLATFORM: bool>(
    generate_source_map: GenerateSourceMap,
    opts: &mut Options,
    source: &bun_ast::Source,
    tree: &Ast,
) -> SourceMap::chunk::Builder {
    if generate_source_map == GenerateSourceMap::Disable {
        // TODO(port): Zig returned `undefined` here.
        return SourceMap::chunk::Builder::default();
    }

    let precomputed = opts.line_offset_tables.take();
    let mut builder = SourceMap::chunk::Builder {
        source_map: SourceMap::chunk::SourceMapFormat::init(
            // opts.source_map_allocator orelse opts.allocator — allocator dropped
            IS_BUN_PLATFORM && generate_source_map == GenerateSourceMap::Lazy,
        ),
        cover_lines_without_mappings: true,
        approximate_input_line_count: tree.approximate_newline_count,
        prepend_count: IS_BUN_PLATFORM && generate_source_map == GenerateSourceMap::Lazy,
        // PORT NOTE: Zig copied `opts.line_offset_tables orelse generate(...)`
        // by value (shallow copy of the unmanaged `MultiArrayList` header).
        // `Options.line_offset_tables` is now a borrow into shared linker
        // state; mirror Zig's bitwise copy via `ptr::read` into a
        // `ManuallyDrop` so dropping the `Builder` never frees borrowed
        // storage. When no table is supplied (the runtime/transpiler path) we
        // leave this `EMPTY` and let the builder build it lazily on the first
        // mapping (see `set_deferred_line_offset_table` below) — matching the
        // Zig transpiler, which only builds the table on demand.
        line_offset_tables: core::mem::ManuallyDrop::new(match precomputed {
            // SAFETY: `borrowed` points to a valid `List` owned by the caller
            // (e.g. `LinkerGraph.files[i].line_offset_table`). The bitwise
            // copy aliases that storage; it is wrapped in `ManuallyDrop` and
            // never dropped, so ownership stays with the caller.
            Some(borrowed) => unsafe { core::ptr::read(borrowed) },
            None => SourceMap::line_offset_table::List::EMPTY,
        }),
        ..Default::default()
    };
    if precomputed.is_none() && generate_source_map == GenerateSourceMap::Lazy {
        // Defer table construction to the first `add_source_mapping` call:
        // modules that emit no mappings (asset/JSON shims, empty modules,
        // fully-stripped files) never pay the full-source scan + allocation.
        builder.set_deferred_line_offset_table(
            // allocator dropped
            &source.contents,
            i32::try_from(tree.approximate_newline_count).expect("int cast"),
        );
    }
    builder
}

// ───────────────────────────────────────────────────────────────────────────
// Top-level print entry points
// ───────────────────────────────────────────────────────────────────────────

pub fn print_ast<'a, W: WriterTrait, const ASCII_ONLY: bool, const GENERATE_SOURCE_MAP: bool>(
    _writer: W,
    bump: &'a bun_alloc::Arena,
    tree: &'a Ast,
    symbols: js_ast::symbol::Map,
    source: &'a bun_ast::Source,
    opts: Options<'a>,
) -> Result<usize, bun_core::Error> {
    let _restore =
        bun_crash_handler::scoped_action(bun_crash_handler::Action::Print(source.path.text));

    // PORT NOTE: Zig declared `renamer`/`no_op_renamer` undefined and assigned per
    // branch. `Renamer<'r,'src>` is invariant in `'src` (it holds `&'r mut
    // NoOpRenamer<'src>`), so the two arms must agree on `'src`; constructing the
    // `MinifyRenamer` variant inline (rather than via `to_renamer() ->
    // Renamer<'static,'static>`) lets inference unify it with the no-op arm.
    let mut no_op_renamer;
    // PORT NOTE: hoisted out of the `minify_identifiers` arm so the
    // `&'r mut MinifyRenamer` borrow stored in `renamer` outlives the branch.
    let mut minify_renamer;
    let renamer: rename::Renamer<'_, '_>;
    // PORT NOTE: Zig copied `tree.module_scope` to a stack local and re-pointed
    // children's `parent` at the local. `Scope` isn't `Copy` here and the only
    // consumer (`compute_reserved_names_for_scope`) walks `members`/`generated`/
    // `children` — never `parent` — so we re-point at the in-place
    // `tree.module_scope` instead (lives for `'a`, strictly safer than the Zig
    // stack-local backref).
    let module_scope = &tree.module_scope;
    let stable_source_indices = [source.index.0];
    if opts.minify_identifiers {
        let mut reserved_names = rename::compute_initial_reserved_names(opts.module_type)?;
        for child in module_scope.children.slice() {
            // `StoreRef<Scope>` has safe `DerefMut`; copy the handle to a mut
            // local so the write goes through the encapsulated arena invariant
            // rather than an open-coded `(*ptr).field = …`.
            let mut child = *child;
            child.parent = Some(NonNull::from(module_scope).into());
        }

        rename::compute_reserved_names_for_scope(module_scope, &symbols, &mut reserved_names);
        minify_renamer = rename::MinifyRenamer::init(
            symbols,
            tree.nested_scope_slot_counts.clone(),
            reserved_names,
        )?;

        let mut top_level_symbols = rename::StableSymbolCountArray::new();

        let uses_exports_ref = tree.uses_exports_ref;
        let uses_module_ref = tree.uses_module_ref;
        let exports_ref = tree.exports_ref;
        let module_ref = tree.module_ref;
        let parts = &tree.parts;

        // PORT NOTE: `symbols` was moved into `minify_renamer`; reach it through
        // the renamer for the post-init `must_not_be_renamed` pass (Zig held a
        // by-value copy).
        let dont_break_the_code = [tree.module_ref, tree.exports_ref, tree.require_ref];
        for ref_ in dont_break_the_code {
            if let Some(symbol) = minify_renamer.symbols.get_mut(ref_) {
                symbol.must_not_be_renamed = true;
            }
        }

        for named_export in tree.named_exports.values() {
            if let Some(symbol) = minify_renamer.symbols.get_mut(named_export.ref_) {
                symbol.must_not_be_renamed = true;
            }
        }

        if uses_exports_ref {
            minify_renamer.accumulate_symbol_use_count(
                &mut top_level_symbols,
                exports_ref,
                1,
                &stable_source_indices,
            )?;
        }
        if uses_module_ref {
            minify_renamer.accumulate_symbol_use_count(
                &mut top_level_symbols,
                module_ref,
                1,
                &stable_source_indices,
            )?;
        }

        for part in parts.slice() {
            minify_renamer.accumulate_symbol_use_counts(
                &mut top_level_symbols,
                &part.symbol_uses,
                &stable_source_indices,
            )?;
            for declared_ref in part.declared_symbols.refs() {
                minify_renamer.accumulate_symbol_use_count(
                    &mut top_level_symbols,
                    *declared_ref,
                    1,
                    &stable_source_indices,
                )?;
            }
        }

        top_level_symbols.sort_unstable_by(rename::StableSymbolCount::less_than);

        minify_renamer.allocate_top_level_symbol_slots(&top_level_symbols)?;
        let mut minifier = tree.char_freq.as_ref().unwrap().compile();
        minify_renamer.assign_names_by_frequency(&mut minifier)?;

        renamer = rename::Renamer::MinifyRenamer(&mut *minify_renamer);
    } else {
        no_op_renamer = rename::NoOpRenamer::init(symbols, source);
        renamer = no_op_renamer.to_renamer();
    }

    // defer: if minify_identifiers { renamer.deinit() } — Drop handles.

    // Spec js_printer.zig:6024 — `is_bun_platform = ascii_only` for printAst.
    type PrinterType<'a, W, const A: bool, const G: bool> =
        Printer<'a, W, A, false, /*IS_BUN_PLATFORM=*/ A, false, G>;
    let mut writer = _writer;
    // Pre-size the output buffer ~proportional to the source. Transpiled output
    // is almost always within a small factor of the input, so reserving up front
    // keeps the per-token appends below from repeatedly growing+memmoving the
    // backing `Vec`. Cheap no-op on a reused (already-grown) writer.
    let _ = writer.reserve(source.contents().len() as u64);

    let mut opts = opts;
    let source_map_builder = get_source_map_builder::<ASCII_ONLY>(
        GenerateSourceMap::lazy_if(GENERATE_SOURCE_MAP),
        &mut opts,
        source,
        tree,
    );
    let mut printer = PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::init(
        writer,
        bump,
        tree.import_records.slice(),
        opts,
        renamer,
        source_map_builder,
    );
    // `defer { if (generate_source_map) printer.source_map_builder.line_offset_tables.deinit(opts.allocator); }`
    // — `Builder.line_offset_tables` is `ManuallyDrop` (see field comment), and
    // on this path it was freshly generated by `get_source_map_builder` (no
    // caller of `print_ast` supplies a borrowed table), so free it explicitly.
    let _line_offset_tables_guard = scopeguard::guard(
        &raw mut printer.source_map_builder.line_offset_tables,
        |p| {
            if GENERATE_SOURCE_MAP {
                // SAFETY: `p` points into `printer`, which outlives this guard;
                // dropped exactly once here.
                let tables = unsafe { &mut *p };
                // `MultiArrayList::Drop` only frees the column buffer — it does
                // NOT drop column elements (Zig allocated these into the arena
                // so it didn't matter there). The per-row `columns_for_non_ascii`
                // Vec<i32>s live on the global heap in the Rust port; drain them
                // before dropping the SoA storage to avoid leaking them.
                for v in tables.items_mut::<"columns_for_non_ascii", Vec<i32>>() {
                    core::mem::take(v);
                }
                unsafe { core::mem::ManuallyDrop::drop(tables) };
            }
        },
    );
    printer.was_lazy_export = tree.has_lazy_export;
    // PORT NOTE: borrowck reshape — `opts` was moved into `Printer::init`; mirror
    // Zig's post-init `printer.module_info = opts.module_info` by taking it back
    // out of `printer.options` (see `print_with_writer_and_platform`).
    if PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::MAY_HAVE_MODULE_INFO {
        printer.module_info = printer.options.module_info.take();
    }
    // PERF(port): was stack-fallback allocator for binary_expression_stack
    printer.binary_expression_stack = Vec::new();

    if !printer.options.bundling
        && tree.uses_require_ref
        && tree.exports_kind == js_ast::ExportsKind::Esm
        && printer.options.target == bun_ast::Target::Bun
    {
        // Hoist the `var {require}=import.meta;` declaration. Previously,
        // `import.meta.require` was inlined into transpiled files, which
        // meant calling `func.toString()` on a function with `require`
        // would observe `import.meta.require` inside of the source code.
        // https://github.com/oven-sh/bun/issues/15738#issuecomment-2574283514
        //
        // This is never a symbol collision because `uses_require_ref` means
        // `require` must be an unbound variable.
        printer.print(b"var {require}=import.meta;");

        if PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::MAY_HAVE_MODULE_INFO {
            if let Some(mi) = printer.module_info.as_deref_mut() {
                mi.flags.contains_import_meta = true;
                let s = mi.str(b"require");
                mi.add_var(s, analyze_transpiled_module::VarKind::Declared);
            }
        }
    }

    for part in tree.parts.slice() {
        for stmt in slice_of(part.stmts).iter() {
            printer.print_stmt(*stmt, TopLevel::init(IsTopLevel::Yes))?;
            printer.writer.get_error()?;
            printer.print_semicolon_if_needed();
        }
    }

    let have_module_info = PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::MAY_HAVE_MODULE_INFO
        && printer.module_info.is_some();
    if have_module_info {
        printer
            .module_info
            .as_mut()
            .unwrap()
            .finalize()
            .map_err(|()| bun_core::Error::OUT_OF_MEMORY)?;
    }

    let mut source_maps_chunk: Option<SourceMap::Chunk> = if GENERATE_SOURCE_MAP {
        if printer.options.source_map_handler.is_some() {
            // PORT NOTE: Zig used `printer.writer.ctx.getWritten()`; WriterTrait
            // exposes the same buffer via `slice()` (cf. print_with_writer_and_platform).
            Some(
                printer
                    .source_map_builder
                    .generate_chunk(printer.writer.slice()),
            )
        } else {
            None
        }
    } else {
        None
    };
    // defer: if let Some(chunk) = &mut source_maps_chunk { chunk.deinit() } — Drop handles.

    if let Some(cache) = printer.options.runtime_transpiler_cache {
        let mut srlz_res: Vec<u8> = Vec::new();
        if have_module_info {
            printer
                .module_info
                .as_ref()
                .unwrap()
                .as_deserialized()
                .serialize(&mut srlz_res)?;
        }
        // SAFETY: caller guarantees the cache outlives the print call.
        unsafe { &mut *cache.as_ptr() }.put(
            printer.writer.slice(),
            source_maps_chunk
                .as_ref()
                .map(|c| c.buffer.list.as_slice())
                .unwrap_or(b""),
            &srlz_res,
        );
    }

    if GENERATE_SOURCE_MAP {
        if let Some(handler) = &printer.options.source_map_handler {
            handler.on_source_map_chunk(source_maps_chunk.take().unwrap(), source)?;
        }
    }

    printer.writer.done()?;

    Ok(usize::try_from(printer.writer.written().max(0)).expect("int cast"))
}

pub fn print_json<W: WriterTrait>(
    _writer: W,
    expr: js_ast::Expr,
    source: &bun_ast::Source,
    opts: PrintJsonOptions<'_>,
) -> Result<usize, bun_core::Error> {
    // NewPrinter(ascii_only=false, Writer, rewrite_esm_to_cjs=false, is_bun_platform=false, is_json=true, generate_source_map=false)
    type PrinterType<'a, W> = Printer<'a, W, false, false, false, true, false>;
    let writer = _writer;
    // PORT NOTE: Zig built a throwaway `Ast.initTest(&parts)` (wrapping `expr` in
    // an `S.SExpr`/Part) solely so the printer could read its default-empty
    // `import_records` and `symbols` for the no-op renamer; the body then calls
    // `printExpr(expr, ...)` directly without ever walking those parts. Rust
    // constructs the same empty inputs without round-tripping through `Ast`.
    let bump = bun_alloc::Arena::new();
    let mut no_op =
        rename::NoOpRenamer::init(js_ast::symbol::Map::init_list(vec![Vec::new()]), source);

    let full_opts = Options {
        indent: opts.indent,
        mangled_props: opts.mangled_props,
        minify_whitespace: opts.minify_whitespace,
        ..Default::default()
    };
    let mut printer = PrinterType::<W>::init(
        writer,
        &bump,
        &[], // ast.import_records.slice()
        full_opts,
        no_op.to_renamer(),
        SourceMap::chunk::Builder::default(), // undefined
    );
    // PERF(port): was stack-fallback allocator
    printer.binary_expression_stack = Vec::new();

    printer.print_expr(expr, js_ast::op::Level::Lowest, ExprFlagSet::empty());
    printer.writer.get_error()?;
    printer.writer.done()?;

    Ok(usize::try_from(printer.writer.written().max(0)).expect("int cast"))
}

pub fn print<'a, const GENERATE_SOURCE_MAPS: bool>(
    bump: &'a bun_alloc::Arena,
    target: bun_ast::Target,
    ast: &Ast,
    source: &bun_ast::Source,
    opts: Options<'a>,
    import_records: &'a [ImportRecord],
    parts: &[js_ast::Part],
    renamer: rename::Renamer<'a, 'a>,
) -> PrintResult {
    let _trace = bun_core::perf::trace("JSPrinter.print");

    // Pre-size the output buffer ~proportional to the source so the per-token
    // appends below don't repeatedly grow+memmove the backing `Vec`.
    let buffer_writer = BufferWriter::with_capacity(source.contents().len());
    let mut buffer_printer = BufferPrinter::init(buffer_writer);

    print_with_writer::<&mut BufferPrinter, GENERATE_SOURCE_MAPS>(
        &mut buffer_printer,
        bump,
        target,
        ast,
        source,
        opts,
        import_records,
        parts,
        renamer,
    )
}

pub fn print_with_writer<'a, W: WriterTrait, const GENERATE_SOURCE_MAPS: bool>(
    writer: W,
    bump: &'a bun_alloc::Arena,
    target: bun_ast::Target,
    ast: &Ast,
    source: &bun_ast::Source,
    opts: Options<'a>,
    import_records: &'a [ImportRecord],
    parts: &[js_ast::Part],
    renamer: rename::Renamer<'a, 'a>,
) -> PrintResult {
    if target.is_bun() {
        print_with_writer_and_platform::<W, true, GENERATE_SOURCE_MAPS>(
            writer,
            bump,
            ast,
            source,
            opts,
            import_records,
            parts,
            renamer,
        )
    } else {
        print_with_writer_and_platform::<W, false, GENERATE_SOURCE_MAPS>(
            writer,
            bump,
            ast,
            source,
            opts,
            import_records,
            parts,
            renamer,
        )
    }
}

/// The real one
pub fn print_with_writer_and_platform<
    'a,
    W: WriterTrait,
    const IS_BUN_PLATFORM: bool,
    const GENERATE_SOURCE_MAPS: bool,
>(
    mut writer: W,
    bump: &'a bun_alloc::Arena,
    ast: &Ast,
    source: &bun_ast::Source,
    opts: Options<'a>,
    import_records: &'a [ImportRecord],
    parts: &[js_ast::Part],
    renamer: rename::Renamer<'a, 'a>,
) -> PrintResult {
    let _restore =
        bun_crash_handler::scoped_action(bun_crash_handler::Action::Print(source.path.text));

    // See `print_ast`: pre-size the output buffer to avoid grow+memmove churn.
    let _ = writer.reserve(source.contents().len() as u64);

    type PrinterType<'a, W, const B: bool, const G: bool> =
        Printer<'a, W, /*ASCII_ONLY=*/ B, false, B, false, G>;
    let module_type = opts.module_type;
    let mut opts = opts;
    let source_map_builder = get_source_map_builder::<IS_BUN_PLATFORM>(
        GenerateSourceMap::eager_if(GENERATE_SOURCE_MAPS),
        &mut opts,
        source,
        ast,
    );
    let mut printer = PrinterType::<W, IS_BUN_PLATFORM, GENERATE_SOURCE_MAPS>::init(
        writer,
        bump,
        import_records,
        opts,
        renamer,
        source_map_builder,
    );
    printer.was_lazy_export = ast.has_lazy_export;
    // PORT NOTE: `Printer::init` already moved `opts.module_info` (it's a field of
    // `Options`); the Phase-A draft re-assigned it post-construction, which is a
    // use-after-move in Rust. The field already lives on `printer.options.module_info`
    // and `printer.module_info` was set to `None` by `init`, so mirror Zig by
    // taking it back out of `printer.options`.
    if PrinterType::<W, IS_BUN_PLATFORM, GENERATE_SOURCE_MAPS>::MAY_HAVE_MODULE_INFO {
        printer.module_info = printer.options.module_info.take();
    }
    // PERF(port): was stack-fallback allocator
    printer.binary_expression_stack = Vec::new();
    // defer: temporary_bindings.deinit / writer.* = printer.writer.* — handled by move-out below.

    // `Index::is_runtime` ⇔ `index.value == 0` (src/js_parser/ast/base.zig).
    if module_type == bundle_opts::Format::InternalBakeDev && source.index.0 != 0 {
        printer.print_dev_server_module(source, ast, &parts[0]);
    } else {
        // The IIFE wrapper is done in `postProcessJSChunk`, so we just manually
        // trigger an indent.
        if module_type == bundle_opts::Format::Iife {
            printer.indent();
        }

        for part in parts {
            for stmt in slice_of(part.stmts).iter() {
                if let Err(err) = printer.print_stmt(*stmt, TopLevel::init(IsTopLevel::Yes)) {
                    return PrintResult::Err(err);
                }
                if let Err(err) = printer.writer.get_error() {
                    return PrintResult::Err(err);
                }
                printer.print_semicolon_if_needed();
            }
        }
    }

    if let Err(err) = printer.writer.done() {
        // In bundle_v2, this is backed by an arena, but incremental uses
        // `dev.allocator` for this buffer, so it must be freed.
        // TODO(port): printer.source_map_builder.source_map.ctx.data.deinit() — Drop handles.
        return PrintResult::Err(err);
    }

    // TODO(port): need ctx accessor on WriterTrait for getWritten()
    let written = printer.writer.slice(); // PORT NOTE: Zig used printer.writer.ctx.getWritten()
    let source_map: Option<SourceMap::Chunk> = if GENERATE_SOURCE_MAPS {
        'brk: {
            if written.is_empty() || printer.source_map_builder.source_map.should_ignore() {
                // Drop handles cleanup
                break 'brk None;
            }
            let chunk = printer.source_map_builder.generate_chunk(written);
            debug_assert!(!chunk.should_ignore);
            break 'brk Some(chunk);
        }
    } else {
        None
    };

    let mut buffer: MutableString = printer.writer.take_buffer();

    PrintResult::Result(PrintResultSuccess {
        code: buffer.take_slice().into(),
        source_map,
    })
}

pub fn print_common_js<
    'a,
    W: WriterTrait,
    const ASCII_ONLY: bool,
    const GENERATE_SOURCE_MAP: bool,
>(
    _writer: W,
    bump: &'a bun_alloc::Arena,
    tree: &'a Ast,
    symbols: js_ast::symbol::Map,
    source: &'a bun_ast::Source,
    opts: Options<'a>,
) -> Result<usize, bun_core::Error> {
    let _restore =
        bun_crash_handler::scoped_action(bun_crash_handler::Action::Print(source.path.text));

    type PrinterType<'a, W, const A: bool, const G: bool> =
        Printer<'a, W, A, true, false, false, G>;
    let mut writer = _writer;
    // See `print_ast`: pre-size the output buffer to avoid grow+memmove churn.
    let _ = writer.reserve(source.contents().len() as u64);
    let mut opts = opts;
    let mut renamer = rename::NoOpRenamer::init(symbols, source);
    let source_map_builder = get_source_map_builder::<false>(
        GenerateSourceMap::lazy_if(GENERATE_SOURCE_MAP),
        &mut opts,
        source,
        tree,
    );
    let mut printer = PrinterType::<W, ASCII_ONLY, GENERATE_SOURCE_MAP>::init(
        writer,
        bump,
        tree.import_records.slice(),
        opts,
        renamer.to_renamer(),
        source_map_builder,
    );
    // `defer { if (generate_source_map) printer.source_map_builder.line_offset_tables.deinit(opts.allocator); }`
    // — `Builder.line_offset_tables` is `ManuallyDrop` (see field comment), and
    // on this path it was freshly generated by `get_source_map_builder`, so
    // free it explicitly. Mirrors `print_ast` above; this was missing here and
    // leaked the SoA buffer + every per-row `columns_for_non_ascii` Vec on the
    // CommonJS print path.
    let _line_offset_tables_guard = scopeguard::guard(
        &raw mut printer.source_map_builder.line_offset_tables,
        |p| {
            if GENERATE_SOURCE_MAP {
                // SAFETY: `p` points into `printer`, which outlives this guard;
                // dropped exactly once here.
                let tables = unsafe { &mut *p };
                // `MultiArrayList::Drop` does not drop column elements; drain
                // the global-heap Vec<i32>s before dropping the SoA storage.
                for v in tables.items_mut::<"columns_for_non_ascii", Vec<i32>>() {
                    core::mem::take(v);
                }
                unsafe { core::mem::ManuallyDrop::drop(tables) };
            }
        },
    );
    // PERF(port): was stack-fallback allocator
    printer.binary_expression_stack = Vec::new();

    for part in tree.parts.slice() {
        for stmt in slice_of(part.stmts).iter() {
            printer.print_stmt(*stmt, TopLevel::init(IsTopLevel::Yes))?;
            printer.writer.get_error()?;
            printer.print_semicolon_if_needed();
        }
    }

    // Add a couple extra newlines at the end
    printer.writer.print_slice(b"\n\n");

    if GENERATE_SOURCE_MAP {
        if let Some(handler) = &printer.options.source_map_handler {
            let chunk = printer
                .source_map_builder
                .generate_chunk(printer.writer.slice());
            handler.on_source_map_chunk(chunk, source)?;
        }
    }

    printer.writer.done()?;

    Ok(usize::try_from(printer.writer.written().max(0)).expect("int cast"))
}

/// Serializes ModuleInfo to an owned byte slice. Returns null on failure.
/// The caller is responsible for freeing the returned slice.
pub fn serialize_module_info(
    module_info: Option<&mut analyze_transpiled_module::ModuleInfo>,
) -> Option<Box<[u8]>> {
    let mi = module_info?;
    if !mi.finalized {
        if mi.finalize().is_err() {
            return None;
        }
    }
    let deserialized = mi.as_deserialized();
    let mut buf: Vec<u8> = Vec::new();
    if deserialized.serialize(&mut buf).is_err() {
        return None;
    }
    Some(buf.into_boxed_slice())
}

// ported from: src/js_printer/js_printer.zig

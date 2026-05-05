//! Port of `src/logger/logger.zig`.
//!
//! TODO(port): OWNERSHIP — almost every `[]const u8` field in this module has
//! mixed/ambiguous ownership in the Zig original (see the comment on
//! `Location::deinit`: "don't really know what's safe to deinit here!"). Strings
//! are sometimes literals, sometimes `allocator.dupe` results, sometimes slices
//! into `Source.contents` or a `StringBuilder` arena. Phase A keeps them as
//! `&'static [u8]` to mirror the Zig `[]const u8` shape without lifetime params;
//! Phase B must decide on a real ownership story (likely `bun_str::String` or a
//! `'source` lifetime threaded through `Location`/`Data`/`Msg`).

use core::fmt;

use bun_alloc::AllocError;
#[allow(unused_imports)]
use bun_core::Output;

// TODO(b1): bun_core::StringBuilder missing — local stub surface until B-2.
#[derive(Default)]
pub struct StringBuilder;
#[allow(unused_variables)]
impl StringBuilder {
    pub fn count(&mut self, s: &[u8]) { let _ = s; }
    pub fn append(&mut self, s: &'static [u8]) -> &'static [u8] { s }
    pub fn allocate(&mut self) -> Result<(), AllocError> { Ok(()) }
}

// TODO(b1): bun_paths crate not yet linked — local stub of fs::Path so `Source`
// stays structurally intact. Real impl: bun_paths (MOVE_DOWN from bun_resolver::fs).
#[allow(dead_code)]
pub mod fs {
    #[derive(Clone, Default)]
    pub struct PathName;
    #[derive(Clone, Default)]
    pub struct Path {
        pub text: &'static [u8],
        pub namespace: &'static [u8],
        pub name: PathName,
    }
    impl Path {
        pub fn init(text: &'static [u8]) -> Path {
            Path { text, namespace: b"", name: PathName }
        }
    }
}

// TYPE_ONLY (CYCLEBREAK §logger): moved-in locally so the import drop doesn't dangle.
// Canonical definition is here now; bun_js_parser re-exports `bun_logger::Index`.
#[repr(transparent)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Index(pub u32);
impl Index {
    pub const fn source(i: u32) -> Self {
        Index(i)
    }
    pub const fn invalid() -> Self {
        Index(u32::MAX)
    }
    pub const fn is_valid(self) -> bool {
        self.0 != u32::MAX
    }
}

// TYPE_ONLY moved down from bun_options_types (T3→T2). Canonical definition lives here;
// move-in: bun_options_types re-exports `pub use bun_logger::ImportKind`.
// Variants mirror src/options_types/import_record.zig:1-25 exactly (discriminants matter
// for serialization). Label tables stay in options_types (they pull in EnumArray).
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub enum ImportKind {
    /// An entry point provided to `bun run` or `bun`
    EntryPointRun = 0,
    /// An entry point provided to `bun build` or `Bun.build`
    EntryPointBuild = 1,
    /// An ES6 import or re-export statement
    #[default]
    Stmt = 2,
    /// A call to "require()"
    Require = 3,
    /// An "import()" expression with a string argument
    Dynamic = 4,
    /// A call to "require.resolve()"
    RequireResolve = 5,
    /// A CSS "@import" rule
    At = 6,
    /// A CSS "@import" rule with import conditions
    AtConditional = 7,
    /// A CSS "url(...)" token
    Url = 8,
    /// A CSS "composes" property
    Composes = 9,
    HtmlManifest = 10,
    Internal = 11,
}

// ───────────────────────────────────────────────────────────────────────────
// Ref / Symbol — MOVE_DOWN from bun_js_parser::ast (T4→T2, CYCLEBREAK §css/§ini).
//
// Canonical definitions live here now; bun_js_parser re-exports
// `pub use bun_logger::{Ref, Symbol, SymbolKind, ImportItemStatus, NamespaceAlias, symbol};`.
// Source: src/js_parser/ast/base.zig (Ref), src/js_parser/ast/Symbol.zig,
//         src/js_parser/ast/G.zig (NamespaceAlias),
//         src/js_parser/js_parser.zig (ImportItemStatus).
// ───────────────────────────────────────────────────────────────────────────

use bun_collections::BabyList;

/// Tag bits of `Ref` (Zig: anonymous `enum(u2)` field).
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RefTag {
    Invalid = 0,
    AllocatedName = 1,
    SourceContentsSlice = 2,
    Symbol = 3,
}

/// Packed-u64 symbol reference: `{inner_index: u31, tag: u2, source_index: u31}`.
///
/// Layout matches `src/js_parser/ast/base.zig:Ref` exactly (LSB-first packing) so
/// `as_u64()` hashes identically to the Zig original.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Ref(u64);

/// Zig `Ref.Int = u31`; we mask to 31 bits in pack/unpack.
pub type RefInt = u32;

impl Ref {
    const INNER_MASK: u64 = (1u64 << 31) - 1;
    const SRC_SHIFT: u32 = 33;

    /// Represents a null state without using an extra bit.
    pub const NONE: Ref = Ref(0); // tag=Invalid, inner=0, src=0

    #[inline]
    const fn pack(inner: u32, tag: RefTag, src: u32) -> Ref {
        Ref((inner as u64 & Self::INNER_MASK)
            | ((tag as u64) << 31)
            | ((src as u64 & Self::INNER_MASK) << Self::SRC_SHIFT))
    }

    #[inline]
    pub const fn inner_index(self) -> u32 {
        (self.0 & Self::INNER_MASK) as u32
    }
    #[inline]
    pub const fn source_index(self) -> u32 {
        (self.0 >> Self::SRC_SHIFT) as u32 & Self::INNER_MASK as u32
    }
    #[inline]
    pub const fn tag(self) -> RefTag {
        match (self.0 >> 31) as u8 & 0b11 {
            0 => RefTag::Invalid,
            1 => RefTag::AllocatedName,
            2 => RefTag::SourceContentsSlice,
            _ => RefTag::Symbol,
        }
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
    #[inline]
    pub const fn is_valid(self) -> bool {
        !matches!(self.tag(), RefTag::Invalid)
    }
    #[inline]
    pub const fn is_symbol(self) -> bool {
        matches!(self.tag(), RefTag::Symbol)
    }
    #[inline]
    pub const fn is_source_contents_slice(self) -> bool {
        matches!(self.tag(), RefTag::SourceContentsSlice)
    }
    #[inline]
    pub fn is_source_index_null(i: u32) -> bool {
        i == Self::INNER_MASK as u32 // maxInt(u31)
    }

    pub fn init(inner_index: u32, source_index: u32, is_source_contents_slice: bool) -> Ref {
        let tag = if is_source_contents_slice {
            RefTag::SourceContentsSlice
        } else {
            RefTag::AllocatedName
        };
        Self::pack(inner_index, tag, source_index)
    }

    pub fn init_source_end(old: Ref) -> Ref {
        debug_assert!(old.is_valid());
        Self::init(
            old.inner_index(),
            old.source_index(),
            matches!(old.tag(), RefTag::SourceContentsSlice),
        )
    }

    #[inline]
    pub const fn as_u64(self) -> u64 {
        self.0
    }
    #[inline]
    pub fn hash64(self) -> u64 {
        // Zig: `bun.hash(&@as([8]u8, @bitCast(key.asU64())))` (wyhash of the 8 bytes).
        // TODO(port): route through bun_wyhash once that crate exposes a public
        // `hash(seed, &[u8])`. The packed u64 is already collision-free per
        // (source, inner, tag), so identity is acceptable for Phase A HashMap use;
        // only on-disk hash stability needs the wyhash mixing.
        self.0
    }
    #[inline]
    pub fn hash(self) -> u32 {
        self.hash64() as u32
    }
    #[inline]
    pub const fn eql(self, other: Ref) -> bool {
        self.0 == other.0
    }
    /// deprecated alias
    #[inline]
    pub const fn is_null(self) -> bool {
        self.is_empty()
    }
}

impl Default for Ref {
    fn default() -> Self {
        Ref::NONE
    }
}

impl fmt::Debug for Ref {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Ref[inner={}, src={}, .{:?}]",
            self.inner_index(),
            self.source_index(),
            self.tag()
        )
    }
}

/// `js_ast.ImportItemStatus` (src/js_parser/js_parser.zig:42).
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ImportItemStatus {
    #[default]
    None = 0,
    /// The linker doesn't report import/export mismatch errors
    Generated = 1,
    /// The printer will replace this import with "undefined"
    Missing = 2,
}

/// `js_ast.G.NamespaceAlias` (src/js_parser/ast/G.zig:8).
#[derive(Clone, Debug)]
pub struct NamespaceAlias {
    pub namespace_ref: Ref,
    pub alias: Str,
    pub was_originally_property_access: bool,
    pub import_record_index: u32,
}

impl Default for NamespaceAlias {
    fn default() -> Self {
        NamespaceAlias {
            namespace_ref: Ref::NONE,
            alias: b"",
            was_originally_property_access: false,
            import_record_index: u32::MAX,
        }
    }
}

/// `js_ast.Symbol.Kind` (src/js_parser/ast/Symbol.zig:192).
/// Re-exported as `SymbolKind` for css consumers (`bun_logger::SymbolKind`).
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum SymbolKind {
    /// An unbound symbol is one that isn't declared in the file it's referenced in.
    Unbound,
    /// Function args, function statements, `var` — hoisted to nearest fn/module scope.
    Hoisted,
    HoistedFunction,
    /// Weird catch-clause-identifier hoisting special case.
    CatchIdentifier,
    /// Generator/async functions: not hoisted, but can overwrite prior fn of same name.
    GeneratorOrAsyncFunction,
    /// The special "arguments" variable inside functions.
    Arguments,
    /// Classes can merge with TypeScript namespaces.
    Class,
    /// A class-private identifier (i.e. "#foo").
    PrivateField,
    PrivateMethod,
    PrivateGet,
    PrivateSet,
    PrivateGetSetPair,
    PrivateStaticField,
    PrivateStaticMethod,
    PrivateStaticGet,
    PrivateStaticSet,
    PrivateStaticGetSetPair,
    /// Labels are in their own namespace.
    Label,
    /// TypeScript enums can merge with TypeScript namespaces and other TS enums.
    TsEnum,
    /// TypeScript namespaces can merge with classes, functions, TS enums, other TS namespaces.
    TsNamespace,
    /// In TypeScript, imports may silently collide with module symbols (type-only).
    Import,
    /// Assigning to a "const" symbol will throw a TypeError at runtime.
    Constant,
    /// CSS identifiers renamed to be unique to the file they are in.
    LocalCss,
    /// All other symbols that don't have special behavior.
    #[default]
    Other,
}

impl SymbolKind {
    #[inline]
    pub const fn is_private(self) -> bool {
        (self as u8) >= (SymbolKind::PrivateField as u8)
            && (self as u8) <= (SymbolKind::PrivateStaticGetSetPair as u8)
    }
    #[inline]
    pub const fn is_hoisted(self) -> bool {
        matches!(self, SymbolKind::Hoisted | SymbolKind::HoistedFunction)
    }
    #[inline]
    pub const fn is_hoisted_or_function(self) -> bool {
        matches!(
            self,
            SymbolKind::Hoisted | SymbolKind::HoistedFunction | SymbolKind::GeneratorOrAsyncFunction
        )
    }
    #[inline]
    pub const fn is_function(self) -> bool {
        matches!(
            self,
            SymbolKind::HoistedFunction | SymbolKind::GeneratorOrAsyncFunction
        )
    }
}

/// `js_ast.Symbol.SlotNamespace`.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SlotNamespace {
    MustNotBeRenamed,
    Default,
    Label,
    PrivateName,
    MangledProp,
}

/// `js_ast.Symbol` (src/js_parser/ast/Symbol.zig).
///
/// Zig packs this to 88 bytes; Rust layout is left to the compiler (no `repr(C)`)
/// since cross-language ABI is not needed post-port.
/// PERF(port): was `comptime { assert(@sizeOf(Symbol) == 88) }` — re-tighten in Phase B.
#[derive(Clone, Debug)]
pub struct Symbol {
    /// Name from the parser. Printed names may be renamed; do not use during printing.
    pub original_name: Str,
    /// Set for symbols representing items in an ES6 import clause.
    pub namespace_alias: Option<NamespaceAlias>,
    /// Used by the parser for single-pass parsing.
    pub link: Ref,
    /// Estimate of use count (zero ⇒ unused, e.g. type-only TS imports).
    pub use_count_estimate: u32,
    /// Do not access directly — use `chunk_index()`.
    pub chunk_index: u32,
    /// Do not access directly — use `nested_scope_slot()`.
    pub nested_scope_slot: u32,
    pub did_keep_name: bool,
    pub must_start_with_capital_letter_for_jsx: bool,
    pub kind: SymbolKind,
    pub must_not_be_renamed: bool,
    pub import_item_status: ImportItemStatus,
    pub private_symbol_must_be_lowered: bool,
    pub remove_overwritten_function_declaration: bool,
    /// Used in HMR to decide when live-binding code is needed.
    pub has_been_assigned_to: bool,
}

impl Default for Symbol {
    fn default() -> Self {
        Symbol {
            original_name: b"",
            namespace_alias: None,
            link: Ref::NONE,
            use_count_estimate: 0,
            chunk_index: Symbol::INVALID_CHUNK_INDEX,
            nested_scope_slot: Symbol::INVALID_NESTED_SCOPE_SLOT,
            did_keep_name: true,
            must_start_with_capital_letter_for_jsx: false,
            kind: SymbolKind::Other,
            must_not_be_renamed: false,
            import_item_status: ImportItemStatus::None,
            private_symbol_must_be_lowered: false,
            remove_overwritten_function_declaration: false,
            has_been_assigned_to: false,
        }
    }
}

// NOTE: Zig nested decls `Symbol.{Kind,Use,List,NestedList,Map}` cannot be inherent
// associated types on stable Rust. Consumers use the flat names below; bun_js_parser
// re-exports them under its own `Symbol` namespace if it needs the nested path.
pub use symbol::List as SymbolList;
pub use symbol::Map as SymbolMap;
pub use symbol::NestedList as SymbolNestedList;

impl Symbol {
    const INVALID_CHUNK_INDEX: u32 = u32::MAX;
    pub const INVALID_NESTED_SCOPE_SLOT: u32 = u32::MAX;

    /// For generating cross-chunk imports/exports for code splitting.
    #[inline]
    pub fn chunk_index(&self) -> Option<u32> {
        (self.chunk_index != Self::INVALID_CHUNK_INDEX).then_some(self.chunk_index)
    }
    #[inline]
    pub fn nested_scope_slot(&self) -> Option<u32> {
        (self.nested_scope_slot != Self::INVALID_NESTED_SCOPE_SLOT).then_some(self.nested_scope_slot)
    }
    #[inline]
    pub fn has_link(&self) -> bool {
        !matches!(self.link.tag(), RefTag::Invalid)
    }
    #[inline]
    pub fn is_hoisted(&self) -> bool {
        self.kind.is_hoisted()
    }

    pub fn slot_namespace(&self) -> SlotNamespace {
        if self.kind == SymbolKind::Unbound || self.must_not_be_renamed {
            return SlotNamespace::MustNotBeRenamed;
        }
        if self.kind.is_private() {
            return SlotNamespace::PrivateName;
        }
        match self.kind {
            SymbolKind::Label => SlotNamespace::Label,
            _ => SlotNamespace::Default,
        }
    }

    pub fn merge_contents_with(&mut self, old: &Symbol) {
        self.use_count_estimate += old.use_count_estimate;
        if old.must_not_be_renamed {
            self.original_name = old.original_name;
            self.must_not_be_renamed = true;
        }
        // TODO: MustStartWithCapitalLetterForJSX
    }

    // Zig re-exported the Kind helpers under the parent struct (`Symbol.isKindHoisted` etc.).
    #[inline] pub const fn is_kind_function(k: SymbolKind) -> bool { k.is_function() }
    #[inline] pub const fn is_kind_hoisted(k: SymbolKind) -> bool { k.is_hoisted() }
    #[inline] pub const fn is_kind_hoisted_or_function(k: SymbolKind) -> bool { k.is_hoisted_or_function() }
    #[inline] pub const fn is_kind_private(k: SymbolKind) -> bool { k.is_private() }
}

/// `js_ast.Symbol.Use`.
#[derive(Clone, Copy, Debug, Default)]
pub struct SymbolUse {
    pub count_estimate: u32,
}

/// `js_ast.Symbol.{List,NestedList,Map}` — exposed as `bun_logger::symbol` so css's
/// `bun_logger::symbol::{Map, List}` forward-refs resolve.
pub mod symbol {
    #[allow(unused_imports)]
    use super::{BabyList, Ref, Symbol};

    pub type List = BabyList<Symbol>;
    pub type NestedList = BabyList<List>;

    /// Two-level array indexed by `(source_index, inner_index)`. See comment on `Ref`.
    pub struct Map {
        pub symbols_for_source: NestedList,
    }

    // TODO(b1): bun_collections::BabyList stub lacks Default/at/mut_/append — gate
    // impl until B-2 un-gates the real BabyList.
    #[cfg(any())]
    impl Map {
        pub fn init_list(list: NestedList) -> Map {
            Map { symbols_for_source: list }
        }

        pub fn init_with_one_list(list: List) -> Map {
            let mut nested = NestedList::default();
            // PERF(port): Zig used `fromBorrowedSliceDangerous((&list)[0..1])` (no alloc).
            // BabyList::append owns; revisit if this shows up in profiles.
            let _ = nested.append(list);
            Map { symbols_for_source: nested }
        }

        pub fn get(&self, r: Ref) -> Option<&mut Symbol> {
            if Ref::is_source_index_null(r.source_index()) || r.is_source_contents_slice() {
                return None;
            }
            // SAFETY: matches Zig's `.mut(ref.innerIndex())` on a `*const Map` —
            // the symbol table is single-owner per parse and never aliased across
            // threads. TODO(port): tighten to `&mut self` once callers are ported.
            unsafe {
                let nested = &mut *(core::ptr::addr_of!(self.symbols_for_source)
                    as *mut NestedList);
                Some(nested.mut_(r.source_index() as usize).mut_(r.inner_index() as usize))
            }
        }

        pub fn get_const(&self, r: Ref) -> Option<&Symbol> {
            if Ref::is_source_index_null(r.source_index()) || r.is_source_contents_slice() {
                return None;
            }
            Some(
                self.symbols_for_source
                    .at(r.source_index() as usize)
                    .at(r.inner_index() as usize),
            )
        }

        pub fn get_with_link(&self, r: Ref) -> Option<&mut Symbol> {
            let symbol = self.get(r)?;
            if symbol.has_link() {
                let link = symbol.link;
                return Some(self.get(link).unwrap_or(symbol));
            }
            Some(symbol)
        }

        pub fn get_with_link_const(&self, r: Ref) -> Option<&Symbol> {
            let symbol = self.get_const(r)?;
            if symbol.has_link() {
                return Some(self.get_const(symbol.link).unwrap_or(symbol));
            }
            Some(symbol)
        }

        pub fn merge(&self, old: Ref, new: Ref) -> Ref {
            if old.eql(new) {
                return new;
            }
            let old_symbol = match self.get(old) {
                Some(s) => s,
                None => return new,
            };
            if old_symbol.has_link() {
                let old_link = old_symbol.link;
                old_symbol.link = self.merge(old_link, new);
                return old_symbol.link;
            }
            let new_symbol = match self.get(new) {
                Some(s) => s,
                None => return new,
            };
            if new_symbol.has_link() {
                let new_link = new_symbol.link;
                new_symbol.link = self.merge(old, new_link);
                return new_symbol.link;
            }
            old_symbol.link = new;
            // SAFETY: old_symbol/new_symbol point at distinct slots (old != new checked above).
            let old_ro: &Symbol = unsafe { &*(old_symbol as *const Symbol) };
            new_symbol.merge_contents_with(old_ro);
            new
        }

        /// Equivalent to `followSymbols` in esbuild.
        pub fn follow(&self, r: Ref) -> Ref {
            let symbol = match self.get(r) {
                Some(s) => s,
                None => return r,
            };
            if !symbol.has_link() {
                return r;
            }
            let link = self.follow(symbol.link);
            if !symbol.link.eql(link) {
                symbol.link = link;
            }
            link
        }

        pub fn follow_all(&self) {
            // PERF(port): was `bun.perf.trace("Symbols.followAll")`.
            for i in 0..self.symbols_for_source.len {
                let list = self.symbols_for_source.at(i as usize);
                for j in 0..list.len {
                    // SAFETY: see `get` — single-owner table.
                    let sym = unsafe {
                        &mut *(list.at(j as usize) as *const Symbol as *mut Symbol)
                    };
                    if !sym.has_link() {
                        continue;
                    }
                    sym.link = self.follow(sym.link);
                }
            }
        }

        // NOTE: `assignChunkIndex` / `dump` omitted — they reference
        // `js_ast.DeclaredSymbol` / `Output.prettyln` (T4). bun_js_parser keeps
        // those as inherent helpers on its re-exported `symbol::Map`.
    }
}

// TODO(b0-move-in): bun_paths must define `PathContentsPair` (TYPE_ONLY from bun_resolver::fs).
// Local mirror so init_file / init_recycled_file resolve until paths' move-in lands.
#[allow(dead_code)]
mod fs_ext {
    pub struct PathContentsPair {
        pub path: super::fs::Path,
        pub contents: &'static [u8],
    }
}
use fs_ext::PathContentsPair;
// TODO(b1): bun_schema::api missing — `to_api` methods gated behind #[cfg(any())].
// TODO(b1): bun_str::strings missing — callers gated; local re-export of the
// minimal subset bun_core already stubs so non-gated code paths still resolve.
#[allow(unused_imports)]
use bun_core::strings;

// In Zig: `const string = []const u8;`
type Str = &'static [u8];
// TODO(port): lifetime — see module-level note. `Str` is a stand-in for the Zig
// `[]const u8` struct-field pattern; Phase B should replace with the real type.

// ───────────────────────────────────────────────────────────────────────────
// Kind
// ───────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum Kind {
    Err = 0,
    Warn = 1,
    Note = 2,
    Debug = 3,
    Verbose = 4,
}

impl Kind {
    #[inline]
    pub fn should_print(self, other: Level) -> bool {
        match other {
            Level::Err => matches!(self, Kind::Err | Kind::Note),
            Level::Warn => matches!(self, Kind::Err | Kind::Warn | Kind::Note),
            Level::Info | Level::Debug => self != Kind::Verbose,
            Level::Verbose => true,
        }
    }

    #[inline]
    pub fn string(self) -> &'static [u8] {
        match self {
            Kind::Err => b"error",
            Kind::Warn => b"warn",
            Kind::Note => b"note",
            Kind::Debug => b"debug",
            Kind::Verbose => b"verbose",
        }
    }

    #[cfg(any())] // TODO(b1): bun_schema::api missing
    #[inline]
    pub fn to_api(self) -> api::MessageLevel {
        match self {
            Kind::Err => api::MessageLevel::Err,
            Kind::Warn => api::MessageLevel::Warn,
            Kind::Note => api::MessageLevel::Note,
            _ => api::MessageLevel::Debug,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Loc
// ───────────────────────────────────────────────────────────────────────────

// Do not mark these as packed
// https://github.com/ziglang/zig/issues/15715
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Loc {
    pub start: i32,
}

impl Default for Loc {
    fn default() -> Self {
        Loc { start: -1 }
    }
}

impl Loc {
    pub const EMPTY: Loc = Loc { start: -1 };

    #[inline]
    pub fn to_nullable(self) -> Option<Loc> {
        if self.start == -1 { None } else { Some(self) }
    }

    // Zig: `pub const toUsize = i;`
    #[inline]
    pub fn to_usize(&self) -> usize {
        self.i()
    }

    #[inline]
    pub fn i(&self) -> usize {
        usize::try_from(self.start.max(0)).unwrap()
    }

    #[inline]
    pub fn eql(self, other: Loc) -> bool {
        self.start == other.start
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.eql(Self::EMPTY)
    }

    pub fn json_stringify(&self, writer: &mut impl JsonWriter) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer.write_i32(self.start)
    }
}

// TODO(port): `writer: anytype` for jsonStringify — the Zig calls `writer.write(self.start)`.
// Model as a small trait until the real serializer exists.
pub trait JsonWriter {
    fn write_i32(&mut self, v: i32) -> Result<(), bun_core::Error>;
    fn write_i32_pair(&mut self, v: [i32; 2]) -> Result<(), bun_core::Error>;
}

// ───────────────────────────────────────────────────────────────────────────
// Location
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Location {
    // Field ordering optimized to reduce padding:
    // - 16-byte fields first: string (ptr+len), ?string (ptr+len+null flag)
    // - 8-byte fields next: usize
    // - 4-byte fields last: i32
    // This eliminates padding between differently-sized fields.
    pub file: Str,
    pub namespace: Str,
    /// Text on the line, avoiding the need to refetch the source code
    pub line_text: Option<Str>,
    /// Number of bytes this location should highlight.
    /// 0 to just point at a single character
    pub length: usize,
    // TODO: document or remove
    pub offset: usize,

    /// 1-based line number.
    /// Line <= 0 means there is no line and column information.
    // TODO: move to `bun.Ordinal`
    pub line: i32,
    // TODO: figure out how this is interpreted, convert to `bun.Ordinal`
    // original docs: 0-based, in bytes.
    // but there is a place where this is emitted in output, implying one based character offset
    pub column: i32,
}

impl Default for Location {
    fn default() -> Self {
        Location {
            file: b"",
            namespace: b"file",
            line_text: None,
            length: 0,
            offset: 0,
            line: 0,
            column: 0,
        }
    }
}

impl Location {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += self.file.len();
        cost += self.namespace.len();
        if let Some(text) = self.line_text {
            cost += text.len();
        }
        cost
    }

    pub fn count(&self, builder: &mut StringBuilder) {
        builder.count(self.file);
        builder.count(self.namespace);
        if let Some(text) = self.line_text {
            builder.count(text);
        }
    }

    pub fn clone(&self) -> Result<Location, AllocError> {
        // TODO(port): lifetime — Zig dupes `file` and `line_text` here; with
        // `Str = &'static [u8]` the dupe is a no-op. Revisit when ownership lands.
        Ok(Location {
            file: self.file,
            namespace: self.namespace,
            line: self.line,
            column: self.column,
            length: self.length,
            line_text: self.line_text,
            offset: self.offset,
        })
    }

    pub fn clone_with_builder(&self, string_builder: &mut StringBuilder) -> Location {
        Location {
            file: string_builder.append(self.file),
            namespace: self.namespace,
            line: self.line,
            column: self.column,
            length: self.length,
            line_text: self.line_text.map(|t| string_builder.append(t)),
            offset: self.offset,
        }
    }

    #[cfg(any())] // TODO(b1): bun_schema::api missing
    pub fn to_api(&self) -> api::Location {
        api::Location {
            file: self.file,
            namespace: self.namespace,
            line: self.line,
            column: self.column,
            line_text: self.line_text.unwrap_or(b""),
            offset: self.offset as u32, // @truncate
        }
    }

    // don't really know what's safe to deinit here!
    // Zig: `pub fn deinit(_: *Location, _: std.mem.Allocator) void {}`
    // → no Drop impl needed.

    pub fn init(
        file: Str,
        namespace: Str,
        line: i32,
        column: i32,
        length: u32,
        line_text: Option<Str>,
    ) -> Location {
        Location {
            file,
            namespace,
            line,
            column,
            length: length as usize,
            line_text,
            offset: length as usize,
        }
    }

    pub fn init_or_null(_source: Option<&Source>, r: Range) -> Option<Location> {
        #[cfg(any())] // TODO(b1): bun_str::strings::trim_left + Source::init_error_position gated
        if let Some(source) = _source {
            if r.is_empty() {
                return Some(Location {
                    file: source.path.text,
                    namespace: source.path.namespace,
                    line: -1,
                    column: -1,
                    length: 0,
                    line_text: Some(b""),
                    offset: 0,
                });
            }
            let data = source.init_error_position(r.loc);
            let mut full_line = &source.contents[data.line_start..data.line_end];
            if full_line.len() > 80 + data.column_count {
                full_line = &full_line[data.column_count.max(40) - 40
                    ..(data.column_count + 40).min(full_line.len() - 40) + 40];
            }

            return Some(Location {
                file: source.path.text,
                namespace: source.path.namespace,
                line: usize2loc(data.line_count).start,
                column: usize2loc(data.column_count).start,
                length: if r.len > -1 {
                    u32::try_from(r.len).unwrap() as usize
                } else {
                    1
                },
                line_text: Some(bun_str::strings::trim_left(full_line, b"\n\r")),
                // TODO(port): lifetime — `line_text` here borrows from `source.contents`
                offset: usize::try_from(r.loc.start.max(0)).unwrap(),
            });
        }
        let _ = r;
        None
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Data
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Data {
    pub text: Str,
    pub location: Option<Location>,
}

impl Default for Data {
    fn default() -> Self {
        Data { text: b"", location: None }
    }
}

impl Data {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += self.text.len();
        if let Some(loc) = &self.location {
            cost += loc.memory_cost();
        }
        cost
    }

    // Zig `deinit` frees `text` and calls `location.deinit()` (no-op).
    // TODO(port): lifetime — Phase B MUST retype `text` to `Box<[u8]>` (Zig
    // `Data.deinit` calls `allocator.free(d.text)`, so per PORTING.md the field
    // is owned). At that point this becomes an automatic `Drop` and the
    // `Box::leak` stopgap in `alloc_print` is removed. With `Str` it's a no-op.

    pub fn clone_line_text(&self, should: bool) -> Result<Data, AllocError> {
        if !should || self.location.is_none() || self.location.as_ref().unwrap().line_text.is_none()
        {
            return self.clone();
        }

        // TODO(port): lifetime — Zig dupes `line_text` here.
        let new_line_text = self.location.as_ref().unwrap().line_text.unwrap();
        let mut new_location = self.location.clone().unwrap();
        new_location.line_text = Some(new_line_text);
        Ok(Data {
            text: self.text,
            location: Some(new_location),
        })
    }

    pub fn clone(&self) -> Result<Data, AllocError> {
        Ok(Data {
            text: if !self.text.is_empty() {
                // TODO(port): lifetime — Zig dupes here.
                self.text
            } else {
                b""
            },
            location: match &self.location {
                Some(l) => Some(l.clone()?),
                None => None,
            },
        })
    }

    pub fn clone_with_builder(&self, builder: &mut StringBuilder) -> Data {
        Data {
            text: if !self.text.is_empty() {
                builder.append(self.text)
            } else {
                b""
            },
            location: self.location.as_ref().map(|l| l.clone_with_builder(builder)),
        }
    }

    pub fn count(&self, builder: &mut StringBuilder) {
        builder.count(self.text);
        if let Some(loc) = &self.location {
            loc.count(builder);
        }
    }

    #[cfg(any())] // TODO(b1): bun_schema::api missing
    pub fn to_api(&self) -> api::MessageData {
        api::MessageData {
            text: self.text,
            location: self.location.as_ref().map(|l| l.to_api()),
        }
    }

    #[allow(unused_variables)]
    pub fn write_format<const ENABLE_ANSI_COLORS: bool>(
        &self,
        to: &mut impl fmt::Write,
        kind: Kind,
        redact_sensitive_information: bool,
    ) -> fmt::Result {
        // TODO(b1): Output::{color_map,pretty_fmt,enable_ansi_colors_stderr} +
        // bun_core::fmt + bun_str::strings missing — gate draft body.
        #[cfg(any())]
        {
        if self.text.is_empty() {
            return Ok(());
        }

        // TODO(port): `Output.color_map.get("...")` is a comptime lookup into a
        // ComptimeStringMap of ANSI escape strings. Model as associated consts.
        let message_color: &'static str = match kind {
            Kind::Err => Output::color_map::B,
            Kind::Note => Output::color_map::BLUE,
            _ => const_format::concatcp!(Output::color_map::D, Output::color_map::B),
        };

        let color_name: &'static str = match kind {
            Kind::Err => Output::color_map::RED,
            Kind::Note => Output::color_map::BLUE,
            _ => Output::color_map::D,
        };

        if let Some(location) = &self.location {
            if let Some(line_text_) = location.line_text {
                let line_text_right_trimmed =
                    bun_str::strings::trim_right(line_text_, b" \r\n\t");
                let line_text =
                    bun_str::strings::trim_left(line_text_right_trimmed, b"\n\r");
                if location.column > 0 && !line_text.is_empty() {
                    let mut line_offset_for_second_line: usize =
                        usize::try_from(location.column - 1).unwrap();

                    if location.line > -1 {
                        let bold = matches!(kind, Kind::Err | Kind::Warn);
                        // bold the line number for error but dim for the attached note
                        if bold {
                            write!(
                                to,
                                "{}",
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!(
                                    "<b>{} | <r>",
                                    location.line
                                ))
                            )?;
                        } else {
                            write!(
                                to,
                                "{}",
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!(
                                    "<d>{} | <r>",
                                    location.line
                                ))
                            )?;
                        }
                        // PERF(port): was comptime bool dispatch on `bold` — profile in Phase B

                        line_offset_for_second_line += fmt_count(format_args!("{} | ", location.line));
                    }

                    write!(
                        to,
                        "{}\n",
                        bun_core::fmt::fmt_javascript(
                            line_text,
                            bun_core::fmt::FmtJavaScriptOpts {
                                enable_colors: ENABLE_ANSI_COLORS,
                                redact_sensitive_information,
                            },
                        )
                    )?;

                    write_n_bytes(to, b' ', line_offset_for_second_line)?;
                    if ENABLE_ANSI_COLORS && !message_color.is_empty() {
                        to.write_str(message_color)?;
                        to.write_str(color_name)?;
                        // always bold the ^
                        to.write_str(Output::color_map::B)?;

                        to.write_char('^')?;

                        to.write_str("\x1b[0m\n")?;
                    } else {
                        to.write_str("^\n")?;
                    }
                }
            }
        }

        if ENABLE_ANSI_COLORS {
            to.write_str(color_name)?;
        }

        write!(to, "{}", bstr::BStr::new(kind.string()))?;

        write!(
            to,
            "{}",
            Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!("<r><d>: <r>"))
        )?;

        if ENABLE_ANSI_COLORS {
            to.write_str(message_color)?;
        }

        write!(
            to,
            "{}",
            Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!(
                "{}<r>",
                bstr::BStr::new(self.text)
            ))
        )?;

        if let Some(location) = &self.location {
            if !location.file.is_empty() {
                to.write_str("\n")?;
                write_n_bytes(
                    to,
                    b' ',
                    (kind.string().len() + ": ".len()) - "at ".len(),
                )?;

                write!(
                    to,
                    "{}",
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!(
                        "<d>at <r><cyan>{}<r>",
                        bstr::BStr::new(location.file)
                    ))
                )?;

                if location.line > 0 && location.column > -1 {
                    write!(
                        to,
                        "{}",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!(
                            "<d>:<r><yellow>{}<r><d>:<r><yellow>{}<r>",
                            location.line, location.column
                        ))
                    )?;
                } else if location.line > -1 {
                    write!(
                        to,
                        "{}",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!(
                            "<d>:<r><yellow>{}<r>",
                            location.line
                        ))
                    )?;
                }

                if cfg!(debug_assertions) {
                    // TODO(port): the Zig gates this on
                    // `std.mem.indexOf(u8, @typeName(@TypeOf(to)), "fs.file") != null` —
                    // i.e. comptime reflection on the writer's type name to detect
                    // a real file writer (vs Bun.inspect). No Rust equivalent;
                    // Phase B should plumb an explicit flag.
                    if false && Output::enable_ansi_colors_stderr() {
                        write!(
                            to,
                            "{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>(format_args!(
                                " <d>byte={}<r>",
                                location.offset
                            ))
                        )?;
                    }
                }
            }
        }

        Ok(())
        } // end #[cfg(any())]
        todo!("Data::write_format — gated until Output/fmt deps land")
    }
}

// Helper: Zig `to.splatByteAll(b, n)`
#[allow(dead_code)] // TODO(b1): only caller (Data::write_format) is gated
fn write_n_bytes(to: &mut impl fmt::Write, b: u8, n: usize) -> fmt::Result {
    for _ in 0..n {
        to.write_char(b as char)?;
    }
    Ok(())
}

// Helper: Zig `std.fmt.count(fmt, args)` — count rendered bytes without allocating.
#[allow(dead_code)] // TODO(b1): only caller (Data::write_format) is gated
fn fmt_count(args: fmt::Arguments<'_>) -> usize {
    struct Counter(usize);
    impl fmt::Write for Counter {
        fn write_str(&mut self, s: &str) -> fmt::Result {
            self.0 += s.len();
            Ok(())
        }
    }
    let mut c = Counter(0);
    let _ = fmt::write(&mut c, args);
    c.0
}

// ───────────────────────────────────────────────────────────────────────────
// BabyString
// ───────────────────────────────────────────────────────────────────────────

// Zig: `packed struct(u32) { offset: u16, len: u16 }`
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct BabyString(u32);

impl BabyString {
    #[inline]
    pub const fn new(offset: u16, len: u16) -> Self {
        // Zig packed-struct field order is LSB-first: offset = low 16, len = high 16.
        BabyString((offset as u32) | ((len as u32) << 16))
    }

    #[inline]
    pub const fn offset(self) -> u16 {
        self.0 as u16
    }

    #[inline]
    pub const fn len(self) -> u16 {
        (self.0 >> 16) as u16
    }

    pub fn r#in(parent: &[u8], text: &[u8]) -> BabyString {
        // TODO(b1): bun_str::strings::index_of missing — inline bstr fallback.
        let off = bstr::ByteSlice::find(parent, text).expect("unreachable");
        BabyString::new(off as u16, text.len() as u16) // @truncate
    }

    pub fn slice<'a>(self, container: &'a [u8]) -> &'a [u8] {
        let off = self.offset() as usize;
        &container[off..off + self.len() as usize]
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Msg
// ───────────────────────────────────────────────────────────────────────────

pub struct Msg {
    pub kind: Kind,
    pub data: Data,
    pub metadata: Metadata,
    pub notes: Box<[Data]>,
    pub redact_sensitive_information: bool,
}

impl Default for Msg {
    fn default() -> Self {
        Msg {
            kind: Kind::Err,
            data: Data::default(),
            metadata: Metadata::Build,
            notes: Box::default(),
            redact_sensitive_information: false,
        }
    }
}

impl Msg {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += self.data.memory_cost();
        for note in self.notes.iter() {
            cost += note.memory_cost();
        }
        cost
    }

    // Zig: `pub const fromJS/toJS = @import("../logger_jsc/...")`
    // → deleted; `to_js`/`from_js` live as extension-trait methods in `bun_logger_jsc`.

    pub fn count(&self, builder: &mut StringBuilder) {
        self.data.count(builder);
        for note in self.notes.iter() {
            note.count(builder);
        }
    }

    pub fn clone(&self) -> Result<Msg, AllocError> {
        let mut notes = Vec::with_capacity(self.notes.len());
        for n in self.notes.iter() {
            notes.push(n.clone()?);
        }
        Ok(Msg {
            kind: self.kind,
            data: self.data.clone()?,
            metadata: self.metadata,
            notes: notes.into_boxed_slice(),
            redact_sensitive_information: self.redact_sensitive_information,
        })
    }

    pub fn clone_with_builder(&self, notes: &mut [Data], builder: &mut StringBuilder) -> Msg {
        Msg {
            kind: self.kind,
            data: self.data.clone_with_builder(builder),
            metadata: self.metadata,
            notes: if !self.notes.is_empty() {
                'brk: {
                    for (i, note) in self.notes.iter().enumerate() {
                        notes[i] = note.clone_with_builder(builder);
                    }
                    // TODO(port): lifetime — Zig returns a sub-slice of the
                    // caller-provided `notes` buffer; with `Box<[Data]>` we copy.
                    break 'brk notes[0..self.notes.len()].to_vec().into_boxed_slice();
                }
            } else {
                Box::default()
            },
            redact_sensitive_information: self.redact_sensitive_information,
        }
    }

    #[cfg(any())] // TODO(b1): bun_schema::api missing
    pub fn to_api(&self) -> Result<api::Message, AllocError> {
        let mut notes = vec![api::MessageData::default(); self.notes.len()].into_boxed_slice();
        let msg = api::Message {
            level: self.kind.to_api(),
            data: self.data.to_api(),
            // PORT NOTE: reshaped for borrowck — fill `notes` before moving into struct.
            notes: Box::default(), // placeholder, set below
            on: api::MessageMeta {
                resolve: if let Metadata::Resolve(r) = &self.metadata {
                    r.specifier.slice(self.data.text)
                } else {
                    b""
                },
                build: matches!(self.metadata, Metadata::Build),
            },
        };

        for (i, note) in self.notes.iter().enumerate() {
            notes[i] = note.to_api();
        }

        Ok(api::Message { notes, ..msg })
    }

    #[cfg(any())] // TODO(b1): bun_schema::api missing
    pub fn to_api_from_list(list: &[Msg]) -> Result<Box<[api::Message]>, AllocError> {
        // PORT NOTE: Zig took `comptime ListType: type, list: ListType` and read
        // `list.items`; collapsed to `&[Msg]`.
        let mut out_list = Vec::with_capacity(list.len());
        for item in list {
            out_list.push(item.to_api()?);
        }
        Ok(out_list.into_boxed_slice())
    }

    // Zig `deinit` frees `data`, each `note`, and `notes` slice — all handled by Drop
    // once ownership is real. No explicit Drop body needed beyond field drops.

    pub fn write_format<const ENABLE_ANSI_COLORS: bool>(
        &self,
        to: &mut impl fmt::Write,
    ) -> fmt::Result {
        self.data.write_format::<ENABLE_ANSI_COLORS>(
            to,
            self.kind,
            self.redact_sensitive_information,
        )?;

        if !self.notes.is_empty() {
            to.write_str("\n")?;
        }

        for note in self.notes.iter() {
            to.write_str("\n")?;
            note.write_format::<ENABLE_ANSI_COLORS>(
                to,
                Kind::Note,
                self.redact_sensitive_information,
            )?;
        }
        Ok(())
    }

    pub fn format_writer(&self, writer: &mut impl fmt::Write) -> fmt::Result {
        // PORT NOTE: Zig had an unused `comptime _: bool` param; dropped.
        if let Some(location) = &self.data.location {
            write!(
                writer,
                "{}: {}\n{}\n{}:{}:{} ({})",
                bstr::BStr::new(self.kind.string()),
                bstr::BStr::new(self.data.text),
                bstr::BStr::new(location.line_text.unwrap_or(b"")),
                bstr::BStr::new(location.file),
                location.line,
                location.column,
                location.offset,
            )
        } else {
            write!(
                writer,
                "{}: {}",
                bstr::BStr::new(self.kind.string()),
                bstr::BStr::new(self.data.text),
            )
        }
    }

    pub fn format_no_writer(&self, formatter_func: fn(fmt::Arguments<'_>)) {
        let location = self.data.location.as_ref().unwrap();
        formatter_func(format_args!(
            "\n\n{}: {}\n{}\n{}:{}:{} ({})",
            bstr::BStr::new(self.kind.string()),
            bstr::BStr::new(self.data.text),
            bstr::BStr::new(location.line_text.unwrap()),
            bstr::BStr::new(location.file),
            location.line,
            location.column,
            location.offset,
        ));
    }
}

#[derive(Copy, Clone)]
pub enum Metadata {
    Build,
    Resolve(MetadataResolve),
}

#[derive(Copy, Clone)]
pub struct MetadataResolve {
    pub specifier: BabyString,
    pub import_kind: ImportKind,
    pub err: bun_core::Error,
}

impl Default for MetadataResolve {
    fn default() -> Self {
        MetadataResolve {
            specifier: BabyString::new(0, 0),
            import_kind: ImportKind::default(),
            err: bun_core::err!("ModuleNotFound"),
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Range
// ───────────────────────────────────────────────────────────────────────────

// Do not mark these as packed
// https://github.com/ziglang/zig/issues/15715
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Range {
    pub loc: Loc,
    pub len: i32,
}

impl Default for Range {
    fn default() -> Self {
        Range { loc: Loc::EMPTY, len: 0 }
    }
}

/// CYCLEBREAK(b0) MOVE_DOWN: was `bun_js_parser::lexer::rangeOfIdentifier`.
/// Moved into logger to break logger→js_parser. Mirrors lexer.zig:3113-3148.
/// TODO(b0-move-in): full Unicode `isIdentifierStart/Continue` tables — currently
/// ASCII + `#`/`\` only; non-ASCII identifiers get a Range with len up to the
/// first non-ASCII byte (only affects error-highlight width, not correctness).
pub fn range_of_identifier(contents: &[u8], loc: Loc) -> Range {
    if loc.start < 0 || (loc.start as usize) >= contents.len() {
        return Range::NONE;
    }
    let text = &contents[loc.start as usize..];
    let mut i = 0usize;
    if text.first() == Some(&b'#') {
        i = 1;
    }
    let is_start = |c: u8| c.is_ascii_alphabetic() || c == b'_' || c == b'$' || c == b'\\';
    let is_cont = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c == b'\\';
    if i < text.len() && is_start(text[i]) {
        i += 1;
        while i < text.len() && is_cont(text[i]) {
            i += 1;
        }
    }
    Range { loc, len: i32::try_from(i).unwrap() }
}

impl Range {
    /// Deprecated: use `NONE`
    #[allow(non_upper_case_globals)]
    pub const None: Range = Self::NONE;
    pub const NONE: Range = Range { loc: Loc::EMPTY, len: 0 };

    pub fn r#in<'a>(self, buf: &'a [u8]) -> &'a [u8] {
        if self.loc.start < 0 || self.len <= 0 {
            return b"";
        }
        let slice = &buf[usize::try_from(self.loc.start).unwrap()..];
        &slice[0..(usize::try_from(self.len).unwrap()).min(buf.len())]
    }

    pub fn contains(self, k: i32) -> bool {
        k >= self.loc.start && k < self.loc.start + self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0 && self.loc.start == Loc::EMPTY.start
    }

    pub fn end(&self) -> Loc {
        Loc { start: self.loc.start + self.len }
    }

    pub fn end_i(&self) -> usize {
        // std.math.lossyCast(usize, ...) — saturates negatives to 0.
        (self.loc.start + self.len).max(0) as usize
    }

    pub fn json_stringify(&self, writer: &mut impl JsonWriter) -> Result<(), bun_core::Error> {
        writer.write_i32_pair([self.loc.start, self.len + self.loc.start])
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Log
// ───────────────────────────────────────────────────────────────────────────

pub struct Log {
    pub warnings: u32,
    pub errors: u32,
    pub msgs: Vec<Msg>,
    pub level: Level,

    pub clone_line_text: bool,
}

impl Default for Log {
    fn default() -> Self {
        Log {
            warnings: 0,
            errors: 0,
            msgs: Vec::new(),
            level: if cfg!(debug_assertions) { Level::Info } else { Level::Warn },
            clone_line_text: false,
        }
    }
}

#[repr(i8)]
#[derive(
    Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, enum_map::Enum, strum::IntoStaticStr,
)]
pub enum Level {
    Verbose, // 0
    Debug,   // 1
    Info,    // 2
    Warn,    // 3
    Err,     // 4
}

impl Level {
    pub fn at_least(self, other: Level) -> bool {
        (self as i8) <= (other as i8)
    }

    // Zig: `pub const label: std.EnumArray(Level, string)`
    pub const LABEL: std::sync::LazyLock<enum_map::EnumMap<Level, &'static [u8]>> =
        std::sync::LazyLock::new(|| {
            use enum_map::enum_map;
            enum_map! {
                Level::Verbose => b"verbose" as &[u8],
                Level::Debug => b"debug",
                Level::Info => b"info",
                Level::Warn => b"warn",
                Level::Err => b"error",
            }
        });

    // Zig: `pub const Map = bun.ComptimeStringMap(Level, ...)`
    pub const MAP: phf::Map<&'static [u8], Level> = phf::phf_map! {
        b"verbose" => Level::Verbose,
        b"debug" => Level::Debug,
        b"info" => Level::Info,
        b"warn" => Level::Warn,
        b"error" => Level::Err,
    };

    // Zig: `pub const fromJS = @import("../logger_jsc/...")`
    // → deleted; lives in `bun_logger_jsc`.
}

// Zig: `pub var default_log_level = Level.warn;`
// TODO(port): mutable global — Zig mutates this at runtime (CLI flag). Phase B
// should pick `AtomicI8` or thread it through config.
pub static mut DEFAULT_LOG_LEVEL: Level = Level::Warn;

impl Log {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        for msg in &self.msgs {
            cost += msg.memory_cost();
        }
        cost
    }

    #[inline]
    pub fn has_errors(&self) -> bool {
        self.errors > 0
    }

    pub fn reset(&mut self) {
        self.msgs.clear();
        self.warnings = 0;
        self.errors = 0;
    }

    pub fn has_any(&self) -> bool {
        (self.warnings + self.errors) > 0
    }

    #[cfg(any())] // TODO(b1): bun_schema::api missing
    pub fn to_api(&self) -> Result<api::Log, AllocError> {
        let mut warnings: u32 = 0;
        let mut errors: u32 = 0;
        for msg in &self.msgs {
            errors += (msg.kind == Kind::Err) as u32;
            warnings += (msg.kind == Kind::Warn) as u32;
        }

        Ok(api::Log {
            warnings,
            errors,
            msgs: Msg::to_api_from_list(&self.msgs)?,
        })
    }

    pub fn init() -> Log {
        // SAFETY: single-threaded init-time read; see TODO on DEFAULT_LOG_LEVEL.
        let level = unsafe { DEFAULT_LOG_LEVEL };
        Log {
            msgs: Vec::new(),
            level,
            ..Default::default()
        }
    }

    pub fn init_comptime() -> Log {
        Log {
            msgs: Vec::new(),
            ..Default::default()
        }
    }

    #[inline]
    pub fn add_debug_fmt(
        &mut self,
        source: Option<&Source>,
        l: Loc,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        if !Kind::Debug.should_print(self.level) {
            return Ok(());
        }
        let text = alloc_print(args)?;
        self.add_formatted_msg(
            Kind::Debug,
            source,
            Range { loc: l, ..Default::default() },
            text,
            Box::default(),
            true,
            false,
        )
    }

    #[cold]
    pub fn add_verbose(
        &mut self,
        source: Option<&Source>,
        loc: Loc,
        text: Str,
    ) -> Result<(), AllocError> {
        if Kind::Verbose.should_print(self.level) {
            self.add_msg(Msg {
                kind: Kind::Verbose,
                data: range_data(source, Range { loc, ..Default::default() }, text),
                ..Default::default()
            })?;
        }
        Ok(())
    }

    // Zig: `pub const toJS/toJSAggregateError/toJSArray = @import("../logger_jsc/...")`
    // → deleted; live in `bun_logger_jsc`.

    pub fn clone_to(&mut self, other: &mut Log) -> Result<(), AllocError> {
        let mut notes_count: usize = 0;

        for msg in &self.msgs {
            for note in msg.notes.iter() {
                notes_count += (!note.text.is_empty()) as usize;
            }
        }

        if notes_count > 0 {
            // TODO(port): lifetime — Zig allocates one shared `[Data; notes_count]`
            // buffer in `other`'s allocator and re-slices each `msg.notes` into it.
            // With `Box<[Data]>` per-Msg we instead deep-copy each notes slice.
            for msg in &mut self.msgs {
                msg.notes = msg.notes.to_vec().into_boxed_slice();
            }
        }

        other.msgs.extend(self.msgs.iter().map(Msg::clone).collect::<Result<Vec<_>, _>>()?);
        // PORT NOTE: reshaped for borrowck — Zig appendSlice moves the (now
        // re-sliced) Msgs; here we clone since `self` retains them.
        other.warnings += self.warnings;
        other.errors += self.errors;
        Ok(())
    }

    pub fn append_to(&mut self, other: &mut Log) -> Result<(), AllocError> {
        self.clone_to(other)?;
        self.msgs.clear();
        self.msgs.shrink_to_fit();
        Ok(())
    }

    pub fn clone_to_with_recycled(
        &mut self,
        other: &mut Log,
        recycled: bool,
    ) -> Result<(), AllocError> {
        let dest_start = other.msgs.len();
        other.msgs.extend(self.msgs.iter().map(Msg::clone).collect::<Result<Vec<_>, _>>()?);
        other.warnings += self.warnings;
        other.errors += self.errors;

        if recycled {
            let mut string_builder = StringBuilder::default();
            let mut notes_count: usize = 0;
            for msg in &self.msgs {
                msg.count(&mut string_builder);
                notes_count += msg.notes.len();
            }

            string_builder.allocate()?;
            let mut notes_buf = vec![Data::default(); notes_count];
            let mut note_i: usize = 0;

            // PORT NOTE: reshaped for borrowck — Zig zips `self.msgs` with the
            // tail of `other.msgs`; index instead.
            for (k, msg) in self.msgs.iter().enumerate() {
                let j = dest_start + k;
                other.msgs[j] =
                    msg.clone_with_builder(&mut notes_buf[note_i..], &mut string_builder);
                note_i += msg.notes.len();
            }
        }
        Ok(())
    }

    pub fn append_to_with_recycled(
        &mut self,
        other: &mut Log,
        recycled: bool,
    ) -> Result<(), AllocError> {
        self.clone_to_with_recycled(other, recycled)?;
        self.msgs.clear();
        self.msgs.shrink_to_fit();
        Ok(())
    }

    pub fn append_to_maybe_recycled(
        &mut self,
        other: &mut Log,
        source: &Source,
    ) -> Result<(), AllocError> {
        self.append_to_with_recycled(other, source.contents_is_recycled)
    }

    // TODO: remove `deinit` because it does not de-initialize the log; it clears it
    pub fn clear_and_free(&mut self) {
        self.msgs.clear();
        self.msgs.shrink_to_fit();
        // self.warnings = 0;
        // self.errors = 0;
    }
}

// PORT NOTE: Zig `Log.deinit` only does `msgs.clearAndFree()` — field-free-only,
// so per PORTING.md no `impl Drop` is emitted (Vec<Msg> drops automatically).
// The mid-life semantic operation is exposed as `clear_and_free` above.

impl Log {
    #[cold]
    pub fn add_verbose_with_notes(
        &mut self,
        source: Option<&Source>,
        loc: Loc,
        text: Str,
        notes: Box<[Data]>,
    ) -> Result<(), AllocError> {
        if !Kind::Verbose.should_print(self.level) {
            return Ok(());
        }

        self.add_msg(Msg {
            kind: Kind::Verbose,
            data: range_data(source, Range { loc, ..Default::default() }, text),
            notes,
            ..Default::default()
        })
    }

    /// Shared, non-generic tail for the `add*Fmt` family. The public wrappers
    /// are `inline` and only do the per-call-site `allocPrint(fmt, args)`; the
    /// rest (counter bump, rangeData, cloneLineText, addMsg) lives here so it
    /// isn't re-stamped for every distinct format string. ~165 callers of
    /// `addErrorFmt` alone used to duplicate this body.
    #[cold]
    #[inline(never)]
    fn add_formatted_msg(
        &mut self,
        kind: Kind,
        source: Option<&Source>,
        r: Range,
        text: Str,
        notes: Box<[Data]>,
        clone: bool,
        redact: bool,
    ) -> Result<(), AllocError> {
        match kind {
            Kind::Err => self.errors += 1,
            Kind::Warn => self.warnings += 1,
            _ => {}
        }
        let mut data = range_data(source, r, text);
        if clone {
            data = data.clone_line_text(self.clone_line_text)?;
        }
        self.add_msg(Msg {
            kind,
            data,
            notes,
            redact_sensitive_information: redact,
            ..Default::default()
        })
    }

    #[inline]
    fn add_resolve_error_with_level<const DUPE_TEXT: bool, const IS_ERR: bool>(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
        specifier_arg: &[u8],
        import_kind: ImportKind,
        err: bun_core::Error,
    ) -> Result<(), AllocError> {
        let text = alloc_print(args)?;
        // TODO: fix this. this is stupid, it should be returned in allocPrint.
        // PORT NOTE: Zig reads `args.@"0"` (first tuple element) for the
        // specifier; with `fmt::Arguments` that's opaque, so callers must pass
        // `specifier_arg` explicitly.
        let specifier = BabyString::r#in(text, specifier_arg);
        if IS_ERR {
            self.errors += 1;
        } else {
            self.warnings += 1;
        }

        let data = if DUPE_TEXT {
            'brk: {
                let mut _data = range_data(source, r, text);
                if let Some(loc) = &mut _data.location {
                    if let Some(_line) = loc.line_text {
                        // TODO(port): lifetime — Zig dupes `line` here.
                        loc.line_text = Some(_line);
                    }
                }
                break 'brk _data;
            }
        } else {
            range_data(source, r, text)
        };

        let msg = Msg {
            // .kind = if (comptime error_type == .err) Kind.err else Kind.warn,
            kind: if IS_ERR { Kind::Err } else { Kind::Warn },
            data,
            metadata: Metadata::Resolve(MetadataResolve {
                specifier,
                import_kind,
                err,
            }),
            ..Default::default()
        };

        self.add_msg(msg)
    }

    #[cold]
    pub fn add_resolve_error(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
        specifier_arg: &[u8],
        import_kind: ImportKind,
        err: bun_core::Error,
    ) -> Result<(), AllocError> {
        // Always dupe the line_text from the source to ensure the Location data
        // outlives the source's backing memory (which may be arena-allocated).
        self.add_resolve_error_with_level::<true, true>(
            source, r, args, specifier_arg, import_kind, err,
        )
    }

    #[cold]
    pub fn add_resolve_error_with_text_dupe(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
        specifier_arg: &[u8],
        import_kind: ImportKind,
    ) -> Result<(), AllocError> {
        self.add_resolve_error_with_level::<true, true>(
            source,
            r,
            args,
            specifier_arg,
            import_kind,
            bun_core::err!("ModuleNotFound"),
        )
    }

    #[cold]
    pub fn add_range_error(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: Str,
    ) -> Result<(), AllocError> {
        self.errors += 1;
        self.add_msg(Msg {
            kind: Kind::Err,
            data: range_data(source, r, text),
            ..Default::default()
        })
    }

    #[inline]
    pub fn add_range_error_fmt(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        let text = alloc_print(args)?;
        self.add_formatted_msg(Kind::Err, source, r, text, Box::default(), true, false)
    }

    #[inline]
    pub fn add_range_error_fmt_with_notes(
        &mut self,
        source: Option<&Source>,
        r: Range,
        notes: Box<[Data]>,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        let text = alloc_print(args)?;
        self.add_formatted_msg(Kind::Err, source, r, text, notes, true, false)
    }

    #[inline]
    pub fn add_error_fmt(
        &mut self,
        source: Option<&Source>,
        l: Loc,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        let text = alloc_print(args)?;
        self.add_formatted_msg(
            Kind::Err,
            source,
            Range { loc: l, ..Default::default() },
            text,
            Box::default(),
            true,
            false,
        )
    }

    // TODO(dylan-conway): rename and replace `addErrorFmt`
    #[inline]
    pub fn add_error_fmt_opts(
        &mut self,
        args: fmt::Arguments<'_>,
        opts: AddErrorOptions<'_>,
    ) -> Result<(), AllocError> {
        let text = alloc_print(args)?;
        self.add_formatted_msg(
            Kind::Err,
            opts.source,
            Range { loc: opts.loc, len: opts.len },
            text,
            Box::default(),
            true,
            opts.redact_sensitive_information,
        )
    }

    /// Use a bun.sys.Error's message in addition to some extra context.
    #[allow(unused_variables)]
    pub fn add_sys_error(
        &mut self,
        e: &bun_sys::Error,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        // TODO(b1): bun_sys::Error::get_error_code_tag_name + coreutils_error_map gated.
        #[cfg(any())]
        {
        let Some((tag_name, sys_errno)) = e.get_error_code_tag_name() else {
            return self.add_error_fmt(None, Loc::EMPTY, args);
        };
        // TODO(port): Zig does comptime fmt-string concat `"{s}: " ++ fmt` and
        // tuple concat `.{x} ++ args`. With `fmt::Arguments` we compose at the
        // value level instead.
        let prefix = bun_sys::coreutils_error_map::get(sys_errno).unwrap_or(tag_name);
        self.add_error_fmt(
            None,
            Loc::EMPTY,
            format_args!("{}: {}", bstr::BStr::new(prefix), args),
        )
        } // end #[cfg(any())]
        self.add_error_fmt(None, Loc::EMPTY, args)
    }

    #[cold]
    pub fn add_zig_error_with_note(
        &mut self,
        err: bun_core::Error,
        note_args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        self.errors += 1;

        let notes: Box<[Data]> =
            Box::new([range_data(None, Range::NONE, alloc_print(note_args)?)]);

        // TODO(b1): bun_core::Error::name() missing — gate draft body.
        #[cfg(any())]
        {
        self.add_msg(Msg {
            kind: Kind::Err,
            data: range_data(None, Range::NONE, err.name().as_bytes()),
            notes,
            ..Default::default()
        })
        }
        let _ = err;
        self.add_msg(Msg { kind: Kind::Err, notes, ..Default::default() })
    }

    #[cold]
    pub fn add_range_warning(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: Str,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        self.warnings += 1;
        self.add_msg(Msg {
            kind: Kind::Warn,
            data: range_data(source, r, text).clone_line_text(self.clone_line_text)?,
            ..Default::default()
        })
    }

    #[inline]
    pub fn add_warning_fmt(
        &mut self,
        source: Option<&Source>,
        l: Loc,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        let text = alloc_print(args)?;
        self.add_formatted_msg(
            Kind::Warn,
            source,
            Range { loc: l, ..Default::default() },
            text,
            Box::default(),
            true,
            false,
        )
    }

    #[cold]
    pub fn add_warning_fmt_line_col(
        &mut self,
        filepath: &[u8],
        line: u32,
        col: u32,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        self.add_warning_fmt_line_col_with_notes(filepath, line, col, args, Box::default())
    }

    #[cold]
    pub fn add_warning_fmt_line_col_with_notes(
        &mut self,
        filepath: &[u8],
        line: u32,
        col: u32,
        args: fmt::Arguments<'_>,
        notes: Box<[Data]>,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        self.warnings += 1;

        // TODO: do this properly

        // TODO(b1): lifetime — `Location.file: &'static [u8]` vs borrowed `filepath`.
        // Gate draft body until Phase-B ownership rework.
        #[cfg(any())]
        {
        let data = Data {
            text: alloc_print(args)?,
            location: Some(Location {
                // TODO(port): lifetime — `filepath` is borrowed.
                file: filepath,
                line: i32::try_from(line).unwrap(),
                column: i32::try_from(col).unwrap(),
                ..Default::default()
            }),
        }
        .clone_line_text(self.clone_line_text)?;

        self.add_msg(Msg {
            kind: Kind::Warn,
            data,
            notes,
            ..Default::default()
        })
        } // end #[cfg(any())]
        let _ = (filepath, line, col, args, notes);
        todo!("add_warning_fmt_line_col_with_notes — gated on Location ownership")
    }

    // (Zig has a large commented-out `addWarningFmtLineColWithNote` here — omitted.)

    #[inline]
    pub fn add_range_warning_fmt(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        let text = alloc_print(args)?;
        self.add_formatted_msg(Kind::Warn, source, r, text, Box::default(), true, false)
    }

    #[cold]
    pub fn add_range_warning_fmt_with_note(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
        note_args: fmt::Arguments<'_>,
        note_range: Range,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        self.warnings += 1;

        let notes: Box<[Data]> =
            Box::new([range_data(source, note_range, alloc_print(note_args)?)]);

        self.add_msg(Msg {
            kind: Kind::Warn,
            data: range_data(source, r, alloc_print(args)?),
            notes,
            ..Default::default()
        })
    }

    #[inline]
    pub fn add_range_warning_fmt_with_notes(
        &mut self,
        source: Option<&Source>,
        r: Range,
        notes: Box<[Data]>,
        args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        let text = alloc_print(args)?;
        self.add_formatted_msg(Kind::Warn, source, r, text, notes, true, false)
    }

    #[cold]
    pub fn add_range_error_fmt_with_note(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
        note_args: fmt::Arguments<'_>,
        note_range: Range,
    ) -> Result<(), AllocError> {
        if !Kind::Err.should_print(self.level) {
            return Ok(());
        }
        self.errors += 1;

        let notes: Box<[Data]> =
            Box::new([range_data(source, note_range, alloc_print(note_args)?)]);

        self.add_msg(Msg {
            kind: Kind::Err,
            data: range_data(source, r, alloc_print(args)?),
            notes,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_warning(
        &mut self,
        source: Option<&Source>,
        l: Loc,
        text: Str,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        self.warnings += 1;
        self.add_msg(Msg {
            kind: Kind::Warn,
            data: range_data(source, Range { loc: l, ..Default::default() }, text),
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_warning_with_note(
        &mut self,
        source: Option<&Source>,
        l: Loc,
        warn: Str,
        note_args: fmt::Arguments<'_>,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        self.warnings += 1;

        let notes: Box<[Data]> = Box::new([range_data(
            source,
            Range { loc: l, ..Default::default() },
            alloc_print(note_args)?,
        )]);

        self.add_msg(Msg {
            kind: Kind::Warn,
            data: range_data(None, Range::NONE, warn),
            notes,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_range_debug(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: Str,
    ) -> Result<(), AllocError> {
        if !Kind::Debug.should_print(self.level) {
            return Ok(());
        }
        self.add_msg(Msg {
            kind: Kind::Debug,
            data: range_data(source, r, text),
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_range_debug_with_notes(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: Str,
        notes: Box<[Data]>,
    ) -> Result<(), AllocError> {
        if !Kind::Debug.should_print(self.level) {
            return Ok(());
        }
        // log.de += 1;
        self.add_msg(Msg {
            kind: Kind::Debug,
            data: range_data(source, r, text),
            notes,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_range_error_with_notes(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: Str,
        notes: Box<[Data]>,
    ) -> Result<(), AllocError> {
        self.errors += 1;
        self.add_msg(Msg {
            kind: Kind::Err,
            data: range_data(source, r, text),
            notes,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_range_warning_with_notes(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: Str,
        notes: Box<[Data]>,
    ) -> Result<(), AllocError> {
        if !Kind::Warn.should_print(self.level) {
            return Ok(());
        }
        self.warnings += 1;
        self.add_msg(Msg {
            // PORT NOTE: Zig has `.kind = .warning` here which doesn't exist in
            // `Kind`; presumed dead code / typo for `.warn`.
            kind: Kind::Warn,
            data: range_data(source, r, text),
            notes,
            ..Default::default()
        })
    }

    pub fn add_msg(&mut self, msg: Msg) -> Result<(), AllocError> {
        self.msgs.push(msg);
        // PERF(port): Vec::push aborts on OOM in Rust; Result kept for API compat.
        Ok(())
    }

    #[cold]
    pub fn add_error(
        &mut self,
        _source: Option<&Source>,
        loc: Loc,
        text: Str,
    ) -> Result<(), AllocError> {
        self.errors += 1;
        self.add_msg(Msg {
            kind: Kind::Err,
            data: range_data(_source, Range { loc, ..Default::default() }, text),
            ..Default::default()
        })
    }

    // TODO(dylan-conway): rename and replace `addError`
    #[cold]
    pub fn add_error_opts(
        &mut self,
        text: Str,
        opts: AddErrorOptions<'_>,
    ) -> Result<(), AllocError> {
        self.errors += 1;
        self.add_msg(Msg {
            kind: Kind::Err,
            data: range_data(opts.source, Range { loc: opts.loc, len: opts.len }, text),
            redact_sensitive_information: opts.redact_sensitive_information,
            ..Default::default()
        })
    }

    pub fn add_symbol_already_declared_error(
        &mut self,
        source: &Source,
        name: &[u8],
        new_loc: Loc,
        old_loc: Loc,
    ) -> Result<(), AllocError> {
        let note_text = {
            use std::io::Write;
            let mut v = Vec::new();
            let _ = write!(
                &mut v,
                "\"{}\" was originally declared here",
                bstr::BStr::new(name)
            );
            // TODO(port): lifetime — leak to get &'static for now.
            Box::leak(v.into_boxed_slice()) as &'static [u8]
        };
        let notes: Box<[Data]> = Box::new([range_data(
            Some(source),
            source.range_of_identifier(old_loc),
            note_text,
        )]);

        self.add_range_error_fmt_with_notes(
            Some(source),
            source.range_of_identifier(new_loc),
            notes,
            format_args!("\"{}\" has already been declared", bstr::BStr::new(name)),
        )
    }

    pub fn print(&self, to: &mut impl fmt::Write) -> fmt::Result {
        // TODO(b1): Output::enable_ansi_colors_stderr missing.
        #[cfg(any())]
        if Output::enable_ansi_colors_stderr() {
            self.print_with_enable_ansi_colors::<true>(to)
        } else {
            self.print_with_enable_ansi_colors::<false>(to)
        }
        self.print_with_enable_ansi_colors::<false>(to)
    }

    pub fn print_with_enable_ansi_colors<const ENABLE_ANSI_COLORS: bool>(
        &self,
        to: &mut impl fmt::Write,
    ) -> fmt::Result {
        let mut needs_newline = false;
        if self.warnings > 0 && self.errors > 0 {
            // Print warnings at the top
            // errors at the bottom
            // This is so if you're reading from a terminal
            // and there are a bunch of warnings
            // You can more easily see where the errors are
            for msg in &self.msgs {
                if msg.kind != Kind::Err {
                    if msg.kind.should_print(self.level) {
                        if needs_newline {
                            to.write_str("\n\n")?;
                        }
                        msg.write_format::<ENABLE_ANSI_COLORS>(to)?;
                        needs_newline = true;
                    }
                }
            }

            for msg in &self.msgs {
                if msg.kind == Kind::Err {
                    if msg.kind.should_print(self.level) {
                        if needs_newline {
                            to.write_str("\n\n")?;
                        }
                        msg.write_format::<ENABLE_ANSI_COLORS>(to)?;
                        needs_newline = true;
                    }
                }
            }
        } else {
            for msg in &self.msgs {
                if msg.kind.should_print(self.level) {
                    if needs_newline {
                        to.write_str("\n\n")?;
                    }
                    msg.write_format::<ENABLE_ANSI_COLORS>(to)?;
                    needs_newline = true;
                }
            }
        }

        if needs_newline {
            to.write_str("\n")?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct AddErrorOptions<'a> {
    pub source: Option<&'a Source>,
    pub loc: Loc,
    pub len: i32,
    pub redact_sensitive_information: bool,
}

#[inline]
pub fn alloc_print(args: fmt::Arguments<'_>) -> Result<Str, AllocError> {
    // TODO(port): Zig `allocPrint` runs `Output.prettyFmt(fmt, enable_ansi_colors)`
    // at comptime to rewrite `<red>..<r>` markup in the format string before
    // formatting. With `fmt::Arguments` the format string is opaque; Phase B
    // needs a `pretty_format_args!` macro that does the rewrite at the callsite.
    // For now, render args verbatim and pass through `Output::pretty_runtime`.
    use std::io::Write;
    let mut v = Vec::new();
    // TODO(b1): Output::{enable_ansi_colors_stderr,pretty_fmt} missing — render verbatim.
    #[cfg(any())]
    if Output::enable_ansi_colors_stderr() {
        let _ = write!(&mut v, "{}", Output::pretty_fmt::<true>(args));
    } else {
        let _ = write!(&mut v, "{}", Output::pretty_fmt::<false>(args));
    }
    let _ = write!(&mut v, "{}", args);
    // TODO(port): lifetime — Zig returns an allocator-owned slice that the Log
    // takes ownership of via Data.text. Leaking here is a stopgap until
    // `Data.text` is `Box<[u8]>`.
    Ok(Box::leak(v.into_boxed_slice()))
}

#[inline]
pub fn usize2loc(loc: usize) -> Loc {
    Loc { start: i32::try_from(loc).unwrap() }
}

// ───────────────────────────────────────────────────────────────────────────
// Source
// ───────────────────────────────────────────────────────────────────────────

pub struct Source {
    pub path: fs::Path,

    pub contents: Str,
    pub contents_is_recycled: bool,

    /// Lazily-generated human-readable identifier name that is non-unique
    /// Avoid accessing this directly most of the  time
    pub identifier_name: Str,

    pub index: Index,
}

impl Default for Source {
    fn default() -> Self {
        Source {
            path: fs::Path::default(),
            contents: b"",
            contents_is_recycled: false,
            identifier_name: b"",
            index: Index::source(0),
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct ErrorPosition {
    pub line_start: usize,
    pub line_end: usize,
    pub column_count: usize,
    pub line_count: usize,
}

impl Source {
    #[cfg(any())] // TODO(b1): bun_core::fmt::FormatValidIdentifier + fs::PathName::fmt_identifier missing
    pub fn fmt_identifier(&self) -> bun_core::fmt::FormatValidIdentifier<'_> {
        self.path.name.fmt_identifier()
    }

    pub fn identifier_name(&mut self) -> Result<Str, bun_core::Error> {
        // TODO(port): narrow error set
        if !self.identifier_name.is_empty() {
            return Ok(self.identifier_name);
        }

        debug_assert!(!self.path.text.is_empty());
        // TODO(b1): fs::PathName::non_unique_name_string missing — gate.
        #[cfg(any())]
        {
        let name = self.path.name.non_unique_name_string()?;
        self.identifier_name = name;
        Ok(name)
        }
        todo!("Source::identifier_name — fs::PathName stub")
    }

    pub fn range_of_identifier(&self, loc: Loc) -> Range {
        // CYCLEBREAK(b0): MOVE_DOWN bun_js_parser::lexer::range_of_identifier → logger.
        // Local impl mirrors src/js_parser/lexer.zig:range_of_identifier — scan from `loc`
        // while bytes are JS identifier-part.
        range_of_identifier(self.contents, loc)
    }

    pub fn is_web_assembly(&self) -> bool {
        if self.contents.len() < 4 {
            return false;
        }

        let bytes = u32::from_ne_bytes(self.contents[0..4].try_into().unwrap());
        bytes == 0x6d73_6100 // "\0asm"
    }

    pub fn init_empty_file(filepath: Str) -> Source {
        let path = fs::Path::init(filepath);
        Source { path, contents: b"", ..Default::default() }
    }

    pub fn init_file(file: PathContentsPair) -> Result<Source, bun_core::Error> {
        let mut source = Source {
            path: file.path,
            contents: file.contents,
            ..Default::default()
        };
        source.path.namespace = b"file";
        Ok(source)
    }

    pub fn init_recycled_file(file: PathContentsPair) -> Result<Source, bun_core::Error> {
        let mut source = Source {
            path: file.path,
            contents: file.contents,
            contents_is_recycled: true,
            ..Default::default()
        };
        source.path.namespace = b"file";
        Ok(source)
    }

    pub fn init_path_string(path_string: Str, contents: Str) -> Source {
        let path = fs::Path::init(path_string);
        Source { path, contents, ..Default::default() }
    }

    pub fn text_for_range(&self, r: Range) -> &[u8] {
        &self.contents[r.loc.i()..r.end_i()]
    }

    #[allow(unused_variables)]
    pub fn range_of_operator_before(&self, loc: Loc, op: &[u8]) -> Range {
        // TODO(b1): bun_str::strings::index missing — gate draft body.
        #[cfg(any())]
        {
        let text = &self.contents[0..loc.i()];
        let index = strings::index(text, op);
        if index >= 0 {
            return Range {
                loc: Loc { start: loc.start + index },
                len: i32::try_from(op.len()).unwrap(),
            };
        }

        Range { loc, ..Default::default() }
        } // end #[cfg(any())]
        Range { loc, ..Default::default() }
    }

    pub fn range_of_string(&self, loc: Loc) -> Range {
        if loc.start < 0 {
            return Range::NONE;
        }

        let text = &self.contents[loc.i()..];

        if text.is_empty() {
            return Range::NONE;
        }

        let quote = text[0];

        if quote == b'"' || quote == b'\'' {
            let mut i: usize = 1;
            let mut c: u8;
            while i < text.len() {
                c = text[i];

                if c == quote {
                    return Range { loc, len: i32::try_from(i + 1).unwrap() };
                } else if c == b'\\' {
                    i += 1;
                }
                i += 1;
            }
        }

        Range { loc, len: 0 }
    }

    #[allow(unused_variables)]
    pub fn range_of_operator_after(&self, loc: Loc, op: &[u8]) -> Range {
        // TODO(b1): bun_str::strings::index missing — gate draft body.
        #[cfg(any())]
        {
        let text = &self.contents[loc.i()..];
        let index = strings::index(text, op);
        if index >= 0 {
            return Range {
                loc: Loc { start: loc.start + index },
                len: i32::try_from(op.len()).unwrap(),
            };
        }

        Range { loc, ..Default::default() }
        } // end #[cfg(any())]
        Range { loc, ..Default::default() }
    }

    #[allow(unused_variables)]
    pub fn init_error_position(&self, offset_loc: Loc) -> ErrorPosition {
        // TODO(b1): bun_str::strings::CodepointIterator missing — gate draft body.
        #[cfg(any())]
        {
        debug_assert!(!offset_loc.is_empty());
        let mut prev_code_point: i32 = 0;
        let offset: usize =
            (usize::try_from(offset_loc.start).unwrap()).min(self.contents.len().max(1) - 1);

        let contents = self.contents;

        let mut iter_ = strings::CodepointIterator {
            bytes: &self.contents[0..offset],
            i: 0,
        };
        let mut iter = strings::codepoint_iterator::Cursor::default();

        let mut line_start: usize = 0;
        let mut line_count: usize = 1;
        let mut column_number: usize = 1;

        while iter_.next(&mut iter) {
            match iter.c {
                0x0A => {
                    // '\n'
                    column_number = 1;
                    line_start = iter.width as usize + iter.i as usize;
                    if prev_code_point != ('\r' as i32) {
                        line_count += 1;
                    }
                }
                0x0D => {
                    // '\r'
                    column_number = 0;
                    line_start = iter.width as usize + iter.i as usize;
                    line_count += 1;
                }
                0x2028 | 0x2029 => {
                    line_start = iter.width as usize + iter.i as usize; // These take three bytes to encode in UTF-8
                    line_count += 1;
                    column_number = 1;
                }
                _ => {
                    column_number += 1;
                }
            }

            prev_code_point = iter.c;
        }

        iter_ = strings::CodepointIterator {
            bytes: &self.contents[offset..],
            i: 0,
        };

        iter = strings::codepoint_iterator::Cursor::default();
        // Scan to the end of the line (or end of file if this is the last line)
        let mut line_end: usize = contents.len();

        'loop_: while iter_.next(&mut iter) {
            match iter.c {
                0x0D | 0x0A | 0x2028 | 0x2029 => {
                    line_end = offset + iter.i as usize;
                    break 'loop_;
                }
                _ => {}
            }
        }

        ErrorPosition {
            line_start: if line_start > 0 { line_start - 1 } else { line_start },
            line_end,
            line_count,
            column_count: column_number,
        }
        } // end #[cfg(any())]
        todo!("Source::init_error_position — gated on bun_str::strings::CodepointIterator")
    }

    #[allow(unused_variables)]
    pub fn line_col_to_byte_offset(
        source_contents: &[u8],
        start_line: usize,
        start_col: usize,
        line: usize,
        col: usize,
    ) -> Option<usize> {
        // TODO(b1): bun_str::strings::CodepointIterator missing — gate draft body.
        #[cfg(any())]
        {
        let mut iter_ = strings::CodepointIterator {
            bytes: source_contents,
            i: 0,
        };
        let mut iter = strings::codepoint_iterator::Cursor::default();

        let mut line_count: usize = start_line;
        let mut column_number: usize = start_col;

        let _ = iter_.next(&mut iter);
        loop {
            let c = iter.c;
            if !iter_.next(&mut iter) {
                break;
            }
            match c {
                0x0A => {
                    // '\n'
                    column_number = 1;
                    line_count += 1;
                }
                0x0D => {
                    // '\r'
                    column_number = 1;
                    line_count += 1;
                    if iter.c == ('\n' as i32) {
                        let _ = iter_.next(&mut iter);
                    }
                }
                0x2028 | 0x2029 => {
                    line_count += 1;
                    column_number = 1;
                }
                _ => {
                    column_number += 1;
                }
            }

            if line_count == line && column_number == col {
                return Some(iter.i as usize);
            }
            if line_count > line {
                return None;
            }
        }
        None
        } // end #[cfg(any())]
        None
    }
}

pub fn range_data(source: Option<&Source>, r: Range, text: Str) -> Data {
    Data { text, location: Location::init_or_null(source, r) }
}

// ───────────────────────────────────────────────────────────────────────────
// File → Source helpers — MOVE_DOWN from bun_sys::File (T1 cannot name T2).
//
// Source: src/sys/File.zig:436 `toSourceAt` / `toSource`. Exposed both as free
// fns and as an extension trait so callers can write `File::to_source(...)`-ish
// code via `use bun_logger::FileSourceExt`.
// ───────────────────────────────────────────────────────────────────────────

// TODO(b1): bun_sys::file gated, bun_str crate missing — provide local stub type
// and gate the bodies/trait. Un-gate in B-2 once bun_sys::file lands.
#[derive(Default, Clone, Copy)]
pub struct ToSourceOptions {
    pub convert_bom: bool,
}

#[cfg(any())]
mod file_source_ext_draft {
use super::*;
pub use bun_sys::file::ToSourceOptions;

/// Read `path` (relative to `dir_fd`) into memory and wrap it in a `Source`.
pub fn to_source_at(
    dir_fd: impl Into<bun_sys::file::File>,
    path: &bun_str::ZStr,
    opts: ToSourceOptions,
) -> bun_sys::Result<Source> {
    let bytes = match bun_sys::file::File::read_from(dir_fd, path) {
        bun_sys::Maybe::Err(err) => return bun_sys::Maybe::Err(err),
        bun_sys::Maybe::Ok(bytes) => bytes,
    };
    let bytes = if opts.convert_bom {
        // TODO(port): bun_str::strings::Bom::{detect, remove_and_convert_to_utf8_and_free}
        // not yet ported — pass through unchanged for now.
        bytes
    } else {
        bytes
    };
    // TODO(port): OWNERSHIP — `Source.contents` is `&'static [u8]` in Phase A (see
    // module-level note). Leak the heap buffer until Phase B threads a real lifetime
    // or moves `contents` to `Vec<u8>`/`bun_str::String`.
    let contents: &'static [u8] = Box::leak(bytes.into_boxed_slice());
    let path_bytes: &'static [u8] = Box::leak(path.as_bytes().to_vec().into_boxed_slice());
    bun_sys::Maybe::Ok(Source::init_path_string(path_bytes, contents))
}

/// `to_source_at` rooted at the process CWD.
pub fn to_source(path: &bun_str::ZStr, opts: ToSourceOptions) -> bun_sys::Result<Source> {
    to_source_at(bun_sys::Fd::cwd(), path, opts)
}

/// Extension trait so `bun_sys::File` callers get the old static-method shape back.
pub trait FileSourceExt {
    fn to_source_at(
        dir_fd: Self,
        path: &bun_str::ZStr,
        opts: ToSourceOptions,
    ) -> bun_sys::Result<Source>
    where
        Self: Sized;
    fn to_source(path: &bun_str::ZStr, opts: ToSourceOptions) -> bun_sys::Result<Source>;
}

impl FileSourceExt for bun_sys::file::File {
    fn to_source_at(
        dir_fd: Self,
        path: &bun_str::ZStr,
        opts: ToSourceOptions,
    ) -> bun_sys::Result<Source> {
        to_source_at(dir_fd, path, opts)
    }
    fn to_source(path: &bun_str::ZStr, opts: ToSourceOptions) -> bun_sys::Result<Source> {
        to_source(path, opts)
    }
}
} // end #[cfg(any())] mod file_source_ext_draft

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/logger/logger.zig (1522 lines)
//   confidence: medium
//   todos:      21
//   notes:      string-field ownership is intentionally deferred (see module doc); `Output.prettyFmt` comptime markup rewrite needs a callsite macro; `add_resolve_error*` gained explicit `specifier_arg` param (Zig used `args.@"0"`).
// ──────────────────────────────────────────────────────────────────────────

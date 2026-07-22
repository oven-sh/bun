#![feature(allocator_api)]
// `#[thread_local]` for the per-node-allocation hot-path TLS
// (`DATA_STORE_OVERRIDE`, `Expr/Stmt::data::Store::{INSTANCE,
// MEMORY_ALLOCATOR, DISABLE_RESET}`, `store_ast_alloc_heap::ARENA`): bare
// `__thread` slot, vs the `thread_local!`
// macro's `LocalKey` wrapper. All are `Cell<*mut _>` / `Cell<bool>` (no
// destructor, const init).
#![feature(thread_local)]
//! TODO: OWNERSHIP — almost every byte-slice field in this module has
//! mixed/ambiguous ownership. Strings are sometimes literals, sometimes heap
//! copies, sometimes slices into `Source.contents` or a `StringBuilder` arena.
//! They are kept as `&'static [u8]` to avoid lifetime params; a real ownership
//! story (likely `bun_core::String` or a `'source` lifetime threaded through
//! `Location`/`Data`/`Msg`) is still needed.

use core::fmt;
use std::borrow::Cow;

// `bun_alloc::AllocError` removed — the `add_*` / `clone` family is now
// infallible (`Vec::push` / `io::Write` on `Vec<u8>` cannot fail in Rust).
use bun_core::Output;

// TODO: swap to `bun_core::StringBuilder` once `clone_with_builder` is
// reshaped to use `append_raw` (canonical's `append` borrows `&mut self`, which
// breaks the `'static` slice pass-through this stub fakes).
#[derive(Default)]
pub struct StringBuilder;
impl StringBuilder {
    pub(crate) fn count(&mut self, s: &[u8]) {
        let _ = s;
    }
    pub(crate) fn allocate(&mut self) {}
}

// Discriminants are wire-stable for serialization.
#[repr(u8)]
#[derive(
    Clone, Copy, PartialEq, Eq, Hash, Debug, Default, enum_map::Enum, strum::IntoStaticStr,
)]
pub enum ImportKind {
    /// An entry point provided to `bun run` or `bun`
    #[strum(serialize = "entry_point_run")]
    EntryPointRun = 0,
    /// An entry point provided to `bun build` or `Bun.build`
    #[strum(serialize = "entry_point_build")]
    EntryPointBuild = 1,
    /// An ES6 import or re-export statement
    #[default]
    #[strum(serialize = "stmt")]
    Stmt = 2,
    /// A call to "require()"
    #[strum(serialize = "require")]
    Require = 3,
    /// An "import()" expression with a string argument
    #[strum(serialize = "dynamic")]
    Dynamic = 4,
    /// A call to "require.resolve()"
    #[strum(serialize = "require_resolve")]
    RequireResolve = 5,
    /// A CSS "@import" rule
    #[strum(serialize = "at")]
    At = 6,
    /// A CSS "@import" rule with import conditions
    #[strum(serialize = "at_conditional")]
    AtConditional = 7,
    /// A CSS "url(...)" token
    #[strum(serialize = "url")]
    Url = 8,
    /// A CSS "composes" property
    #[strum(serialize = "composes")]
    Composes = 9,
    #[strum(serialize = "html_manifest")]
    HtmlManifest = 10,
    #[strum(serialize = "internal")]
    Internal = 11,
}

// E0015: EnumMap indexing isn't const; the lookup table is folded into match
// arms inside label()/error_label() below — zero runtime init (PORTING.md §Concurrency: prefer no-lock over OnceLock
// when the data is pure const).
//
// If these are changed, make sure to update
// - src/js/builtins/codegen/replacements.ts
// - packages/bun-types/bun.d.ts

impl ImportKind {
    #[inline]
    pub fn label(self) -> &'static [u8] {
        match self {
            ImportKind::EntryPointRun => b"entry-point-run",
            ImportKind::EntryPointBuild => b"entry-point-build",
            ImportKind::Stmt => b"import-statement",
            ImportKind::Require => b"require-call",
            ImportKind::Dynamic => b"dynamic-import",
            ImportKind::RequireResolve => b"require-resolve",
            ImportKind::At => b"import-rule",
            ImportKind::AtConditional => b"",
            ImportKind::Url => b"url-token",
            ImportKind::Composes => b"composes",
            ImportKind::Internal => b"internal",
            ImportKind::HtmlManifest => b"html_manifest",
        }
    }

    #[inline]
    pub fn error_label(self) -> &'static [u8] {
        match self {
            ImportKind::EntryPointRun => b"entry point (run)",
            ImportKind::EntryPointBuild => b"entry point (build)",
            ImportKind::Stmt => b"import",
            ImportKind::Require => b"require()",
            ImportKind::Dynamic => b"import()",
            ImportKind::RequireResolve => b"require.resolve()",
            ImportKind::At => b"@import",
            ImportKind::AtConditional => b"",
            ImportKind::Url => b"url()",
            ImportKind::Internal => b"<bun internal>",
            ImportKind::Composes => b"composes",
            ImportKind::HtmlManifest => b"HTML import",
        }
    }

    #[inline]
    pub fn is_common_js(self) -> bool {
        matches!(self, Self::Require | Self::RequireResolve)
    }

    pub fn is_from_css(self) -> bool {
        self == Self::AtConditional
            || self == Self::At
            || self == Self::Url
            || self == Self::Composes
    }

    // `to_api()` lives in `bun_ast::ImportKindExt` — depends on
    // `schema::api::ImportKind` which sits in a higher-tier crate.
}

// ───────────────────────────────────────────────────────────────────────────
// Ref / Symbol
// ───────────────────────────────────────────────────────────────────────────

/// Tag bits of `Ref`.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum RefTag {
    Invalid = 0,
    AllocatedName = 1,
    SourceContentsSlice = 2,
    Symbol = 3,
}

/// Packed-u64 symbol reference: `{inner_index: u28, user: u3, tag: u2, source_index: u31}`.
///
/// LSB-first packing for the `tag`/`source_index` fields, with 3 bits stolen
/// from `inner_index` (31 → 28 bits, max 268M symbols/file —
/// three.js peaks at ~50K) so that `E::Identifier` / `E::ImportIdentifier` /
/// `E::CommonJSExportIdentifier` can pack their boolean side-flags inline,
/// shrinking `expr::Data` from 24→16 bytes and `Expr` from 32→24. The
/// rarely-set flags (`with`-stmt guard, known-pure-global hints) ride in
/// otherwise-dead bits instead of forcing 8 bytes of struct padding on every
/// identifier node.
///
/// User bits are *not* part of the ref's identity: `eq`/`hash`/`eql`/`as_u64`
/// all mask them off, so `id.ref_` (which may carry flags) compares/hashes
/// identically to the symbol-table key it indexes. `pack()` always writes 0
/// into the user-bit lane, so for every `Ref` constructed via `new`/`init`
/// the masking is a no-op and hashing is bit-identical to the pre-shrink
/// layout — preserving output sha-identity.
///
/// `packed(4)` lowers the alignment to 4 without changing the single-scalar
/// representation, so `Ref` is still passed/returned in one register and
/// `self.0` is still one `mov`. The align-4 part is what lets the inline
/// identifier payloads — and therefore `expr::Data` and `Expr` — pack into 16
/// bytes. All accessors take `self` by value (`Copy`), so the packed-field
/// reference restriction never applies.
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct Ref(u64);

const _: () = assert!(core::mem::size_of::<Ref>() == 8);
const _: () = assert!(core::mem::align_of::<Ref>() == 4);

/// We mask to 31 bits for `source_index`, 28 for `inner_index`.
pub type RefInt = u32;

impl Ref {
    const INNER_MASK: u64 = (1u64 << 31) - 1;
    /// `inner_index` width — 28 bits, leaving 3 user bits.
    /// `debug_assert!` in `pack()` catches any source large enough to overflow
    /// (would require >268M symbols or a >268MB source-contents-slice offset).
    const INNER_BITS: u64 = (1u64 << 28) - 1;
    /// Bits 28..31 — opaque per-node flags (E::Identifier side-effect hints,
    /// E::ImportIdentifier `was_originally_identifier`, E::CommonJSExportIdentifier
    /// `base`). Never set by `pack()`; only via `set_user_bit`. Masked out of
    /// identity (`eq`/`hash`/`as_u64`).
    const USER_BITS_MASK: u64 = 0b111 << 28;
    const SRC_SHIFT: u32 = 33;

    /// Represents a null state without using an extra bit.
    pub const NONE: Ref = Ref(0); // tag=Invalid, inner=0, src=0

    /// Raw 64-bit representation **including** user bits. For round-tripping
    /// through external pointer-packed storage (e.g. css `IdentOrRef`). Differs
    /// from [`Self::as_u64`], which masks user bits for hashing/equality.
    #[inline]
    pub const fn to_raw_bits(self) -> u64 {
        self.0
    }
    /// Reconstruct from a value previously returned by [`Self::to_raw_bits`].
    #[inline]
    pub const fn from_raw_bits(bits: u64) -> Ref {
        Ref(bits)
    }

    /// General constructor exposing all three packed fields. Prefer `init` for
    /// the common source-contents/allocated-name case; this exists for callers
    /// that need to set `tag` explicitly (e.g. `RefTag::Symbol`).
    #[inline]
    pub const fn new(inner_index: RefInt, source_index: RefInt, tag: RefTag) -> Ref {
        Self::pack(inner_index, tag, source_index)
    }

    #[inline]
    const fn pack(inner: u32, tag: RefTag, src: u32) -> Ref {
        debug_assert!(
            (inner as u64) <= Self::INNER_BITS,
            "Ref.inner_index overflows 28 bits — file has >268M symbols or >268MB source slice",
        );
        Ref((inner as u64 & Self::INNER_BITS)
            | ((tag as u64) << 31)
            | ((src as u64 & Self::INNER_MASK) << Self::SRC_SHIFT))
    }

    #[inline]
    pub const fn inner_index(self) -> u32 {
        (self.0 & Self::INNER_BITS) as u32
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
        // Mask user bits so a flagged `Ref::NONE` (e.g. the define-template
        // `E::Identifier::init(Ref::NONE).with_can_be_removed_if_unused(true)`)
        // still reports null — keeps `is_empty`/`is_null` consistent with
        // `eq`/`hash`/`eql`/`as_u64`, which all ignore the user-bit lane.
        (self.0 & !Self::USER_BITS_MASK) == 0
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
    pub(crate) fn is_source_index_null(i: u32) -> bool {
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

    /// Identity bits (user/flag lane masked off). For all refs constructed via
    /// `new`/`init`/`pack` this equals the raw `self.0` (user bits are 0 there),
    /// so wyhash output is unchanged vs the pre-shrink layout.
    #[inline]
    pub(crate) const fn as_u64(self) -> u64 {
        self.0 & !Self::USER_BITS_MASK
    }

    // ── User bits (E::Identifier-family side flags) ──────────────────────
    // Three spare bits at 28..31, freed by narrowing `inner_index` to u28.
    // These ride along on the inline `pub ref_: Ref` field of identifier
    // expression nodes so the node fits in 8 bytes (the niche-free size of
    // every other inline `expr::Data` payload). They are masked out of
    // identity (eq/hash/as_u64/inner_index) so `id.ref_` remains a valid
    // symbol-map key regardless of flag state.
    #[inline]
    pub(crate) const fn user_bit(self, n: u32) -> bool {
        debug_assert!(n < 3);
        (self.0 >> (28 + n)) & 1 != 0
    }
    #[inline]
    pub(crate) fn set_user_bit(&mut self, n: u32, v: bool) {
        debug_assert!(n < 3);
        let bit = 1u64 << (28 + n);
        self.0 = (self.0 & !bit) | ((v as u64) << (28 + n));
    }
    #[inline]
    pub(crate) const fn with_user_bit(mut self, n: u32, v: bool) -> Ref {
        debug_assert!(n < 3);
        let bit = 1u64 << (28 + n);
        self.0 = (self.0 & !bit) | ((v as u64) << (28 + n));
        self
    }
    /// Identity bits only (user/flag lane zeroed). Use when handing a
    /// flag-carrying `E::Identifier.ref_` to a context that stores its own
    /// flags in the same lane (e.g. `E::ImportIdentifier::new`), so stale
    /// `can_be_removed_if_unused`/`call_can_be_unwrapped_if_unused` bits don't
    /// leak across node kinds.
    #[inline]
    pub(crate) const fn without_user_bits(self) -> Ref {
        Ref(self.0 & !Self::USER_BITS_MASK)
    }
    /// Replace the identity bits with those of `self` while keeping `src`'s
    /// user-bit lane. Used by `handle_identifier`'s `id_clone.ref_ = result.ref`
    /// assignment — the flags ride in `ref_` and would otherwise be silently
    /// zeroed by a whole-word write.
    #[inline]
    pub const fn with_user_bits_from(self, src: Ref) -> Ref {
        Ref((self.0 & !Self::USER_BITS_MASK) | (src.0 & Self::USER_BITS_MASK))
    }
    #[inline]
    pub const fn eql(self, other: Ref) -> bool {
        // User-bit lane is not part of identity — see type-level doc.
        self.as_u64() == other.as_u64()
    }
    /// deprecated alias
    #[inline]
    pub const fn is_null(self) -> bool {
        self.is_empty()
    }
    /// `Ref::NONE` → `None`, otherwise `Some(self)`. For sites that previously
    /// stored `Option<Ref>` and want option combinators on the sentinel form.
    #[inline]
    pub fn to_nullable(self) -> Option<Ref> {
        if self.is_empty() { None } else { Some(self) }
    }
}

impl Default for Ref {
    fn default() -> Self {
        Ref::NONE
    }
}

// Identity excludes the user-bit lane (bits 28..31). For every Ref produced by
// `pack()` those bits are 0, so this is bit-identical to `#[derive(...)]` on
// the raw u64 — the mask only matters for `E::Identifier.ref_` & friends where
// flag bits may be set, and there it ensures `HashMap<Ref, _>` lookups via
// `id.ref_` resolve to the same bucket as the flag-free symbol-table key.
impl PartialEq for Ref {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.eql(*other)
    }
}
impl Eq for Ref {}
impl core::hash::Hash for Ref {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.as_u64().hash(state)
    }
}

impl fmt::Display for Ref {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Ref[inner={}, src={}, .{}]",
            self.inner_index(),
            self.source_index(),
            <&'static str>::from(self.tag()),
        )
    }
}

impl fmt::Debug for Ref {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

// Local mirror of `bun_resolver::fs`'s path+contents pair (canonical home would
// be `bun_paths`); defined here so init_file / init_recycled_file resolve.
// `pub` so `bun_bundler::Transpiler::parse_maybe` can construct it for
// `Source::init_recycled_file`.
/// A [`Source`]'s path paired with its raw bytes (used by virtual-module
/// injection: `BundleV2`'s `additional_files`, `Bun.build` inputs).
#[derive(Clone, Copy)]
pub struct PathContentsPair {
    pub path: bun_paths::fs::Path<'static>,
    pub contents: &'static [u8],
}

type Str = &'static [u8];
// `Str` is a lifetime-erased byte-slice alias; see the module-level OWNERSHIP
// note for the real ownership story.

// ───────────────────────────────────────────────────────────────────────────
// api — hand-written slice of `bun.schema.api` consumed by
// `Kind/Location/Data/Msg/Log::to_api`. The full
// peechy → .rs codegen (`bun_api`) will supersede this; field shapes are kept
// faithful so the generated diff stays reviewable. Lives here (not `bun_api`)
// ───────────────────────────────────────────────────────────────────────────
pub mod api {
    #[derive(Clone, Default, Debug)]
    pub struct Log {
        pub warnings: u32,
        pub errors: u32,
    }
}

/// `[]const u8` parameter shim — accepts `&str` / `&[u8]` (any lifetime)
/// and erases to the crate-wide `Str` (`&'static [u8]`) lie so callers in either
/// string flavour compile against the same signatures.
/// Removable together with `Str` once a `'source` lifetime is threaded through
/// (see the module-level OWNERSHIP note).
pub trait IntoStr {
    fn into_str(self) -> Str;
}
impl IntoStr for &[u8] {
    #[inline]
    fn into_str(self) -> Str {
        // SAFETY: lifetime erasure; see module-level OWNERSHIP note.
        unsafe { bun_collections::detach_lifetime(self) }
    }
}
impl IntoStr for &str {
    #[inline]
    fn into_str(self) -> Str {
        self.as_bytes().into_str()
    }
}
impl<const N: usize> IntoStr for &[u8; N] {
    #[inline]
    fn into_str(self) -> Str {
        self[..].into_str()
    }
}

/// Owned/borrowed → `Cow<'static, [u8]>` for `Data.text`. Superset of the old
/// `impl Into<Cow<'static, [u8]>>` bound on [`range_data`] that additionally
/// admits `&'static str` (so `concat!()` literals work) and `&[u8; N]`.
pub trait IntoText {
    fn into_text(self) -> Cow<'static, [u8]>;
}
impl IntoText for Cow<'static, [u8]> {
    #[inline]
    fn into_text(self) -> Cow<'static, [u8]> {
        self
    }
}
impl IntoText for &'static [u8] {
    #[inline]
    fn into_text(self) -> Cow<'static, [u8]> {
        Cow::Borrowed(self)
    }
}
impl<const N: usize> IntoText for &'static [u8; N] {
    #[inline]
    fn into_text(self) -> Cow<'static, [u8]> {
        Cow::Borrowed(self)
    }
}
impl IntoText for &'static str {
    #[inline]
    fn into_text(self) -> Cow<'static, [u8]> {
        Cow::Borrowed(self.as_bytes())
    }
}
impl IntoText for Vec<u8> {
    #[inline]
    fn into_text(self) -> Cow<'static, [u8]> {
        Cow::Owned(self)
    }
}
impl IntoText for String {
    #[inline]
    fn into_text(self) -> Cow<'static, [u8]> {
        Cow::Owned(self.into_bytes())
    }
}
impl IntoText for Box<[u8]> {
    #[inline]
    fn into_text(self) -> Cow<'static, [u8]> {
        Cow::Owned(self.into_vec())
    }
}

/// Sink adapter for [`Log::print`] — lets callers pass either a borrowed
/// `fmt::Write` impl or the `*mut bun_core::io::Writer` returned by
/// `Output::error_writer()` (the dominant call shape across the tree).
pub trait IntoLogWrite {
    type W: fmt::Write;
    fn into_log_write(self) -> Self::W;
}
impl<'a, W: fmt::Write> IntoLogWrite for &'a mut W {
    type W = &'a mut W;
    #[inline]
    fn into_log_write(self) -> &'a mut W {
        self
    }
}
/// `fmt::Write` view over a `*mut bun_core::io::Writer`.
pub struct IoWriterAdapter(*mut bun_core::io::Writer);
impl fmt::Write for IoWriterAdapter {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        if self.0.is_null() {
            return Ok(());
        }
        // SAFETY: `Output::error_writer()` returns a pointer to a long-lived
        // adapter header (see bun_core::io::Writer); callers hold it only for
        // the duration of this `print` call.
        unsafe { (*self.0).write_all(s.as_bytes()) }.map_err(|_| fmt::Error)
    }
}
impl IntoLogWrite for *mut bun_core::io::Writer {
    type W = IoWriterAdapter;
    #[inline]
    fn into_log_write(self) -> IoWriterAdapter {
        IoWriterAdapter(self)
    }
}
// NOTE: a `&mut *mut Writer` blanket can't coexist with the generic
// `&mut W: fmt::Write` impl above (coherence reservation). Callers holding a
// `&mut *mut Writer` deref to `*mut Writer` and hit the impl above.

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
}

// ───────────────────────────────────────────────────────────────────────────
// Loc
// ───────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
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

    #[inline]
    pub fn to_usize(self) -> usize {
        self.i()
    }

    #[inline]
    pub fn i(self) -> usize {
        usize::try_from(self.start.max(0)).expect("int cast")
    }

    #[inline]
    pub fn eql(self, other: Loc) -> bool {
        self.start == other.start
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.eql(Self::EMPTY)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Location
// ───────────────────────────────────────────────────────────────────────────

pub struct Location {
    // Field ordering optimized to reduce padding:
    // - 16-byte fields first: string (ptr+len), ?string (ptr+len+null flag)
    // - 8-byte fields next: usize
    // - 4-byte fields last: i32
    // This eliminates padding between differently-sized fields.
    //
    // `file` / `line_text` are `Cow` (not `Str`) because
    // `Location::clone()` must deep-dupe them so a
    // `BuildMessage`/`ResolveMessage` that outlives the
    // `Source.contents` it borrowed from doesn't read poisoned memory. The
    // borrowed arm covers the common case where the slice points into
    // arena-owned source text.
    pub file: Cow<'static, [u8]>,
    pub namespace: Str,
    /// Text on the line, avoiding the need to refetch the source code
    pub line_text: Option<Cow<'static, [u8]>>,
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

// NOT `#[derive(Clone)]`. `file` / `line_text` are
// `Cow<'static, [u8]>` whose `Borrowed` arm may carry a lifetime-erased view
// into `Source.contents` (see `init_or_null`, `css_parser.rs`, `error.rs`,
// `JSBundler.rs`). The derived `Cow::clone` would re-borrow that pointer, so a
// `BuildMessage` cloned via `Option<Location>::clone()` / `Vec<Data>::clone()`
// could outlive the source buffer and read poisoned memory. Instead,
// every `Clone` of a `Location` deep-dupes its borrowed bytes.
impl Clone for Location {
    fn clone(&self) -> Self {
        Location {
            file: Cow::Owned(self.file.to_vec()),
            namespace: self.namespace,
            line: self.line,
            column: self.column,
            length: self.length,
            line_text: self.line_text.as_deref().map(|t| Cow::Owned(t.to_vec())),
            offset: self.offset,
        }
    }
}

impl Default for Location {
    fn default() -> Self {
        Location {
            file: Cow::Borrowed(b""),
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
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += self.file.len();
        cost += self.namespace.len();
        if let Some(text) = &self.line_text {
            cost += text.len();
        }
        cost
    }

    pub(crate) fn count(&self, builder: &mut StringBuilder) {
        builder.count(self.file.as_ref().into_str());
        builder.count(self.namespace);
        if let Some(text) = &self.line_text {
            builder.count(text.as_ref().into_str());
        }
    }

    pub(crate) fn clone(&self) -> Location {
        // The trait `Clone` impl above does the deep-dupe (so the duped bytes
        // outlive the original `Source.contents`); this inherent shim forwards
        // to it.
        <Self as Clone>::clone(self)
    }

    pub(crate) fn clone_with_builder(&self, _string_builder: &mut StringBuilder) -> Location {
        // The local
        // `StringBuilder` stub above is a no-op that returns its input, so a
        // `Cow::Borrowed(append(s))` would alias `self`'s storage and dangle
        // after `self.msgs.clear()` in `append_to_with_recycled`. Deep-copy
        // here instead — same end-state as the real builder, just without the
        // single-buffer packing.
        Location {
            file: Cow::Owned(self.file.to_vec()),
            namespace: self.namespace,
            line: self.line,
            column: self.column,
            length: self.length,
            line_text: self.line_text.as_deref().map(|t| Cow::Owned(t.to_vec())),
            offset: self.offset,
        }
    }

    // No Drop impl needed.

    pub fn init(
        file: Str,
        namespace: Str,
        line: i32,
        column: i32,
        length: u32,
        line_text: Option<Str>,
    ) -> Location {
        Location {
            file: Cow::Borrowed(file),
            namespace,
            line,
            column,
            length: length as usize,
            line_text: line_text.map(Cow::Borrowed),
            offset: length as usize,
        }
    }

    pub fn init_or_null(_source: Option<&Source>, r: Range) -> Option<Location> {
        Self::init_or_null_impl(_source, r, None)
    }

    /// `init_or_null`, but computing the line/column through a
    /// [`LineColumnTracker`] so repeated diagnostics against the same source
    /// don't rescan it from the start for every message.
    fn init_or_null_tracked(
        _source: Option<&Source>,
        r: Range,
        tracker: &mut LineColumnTracker,
    ) -> Option<Location> {
        Self::init_or_null_impl(_source, r, Some(tracker))
    }

    fn init_or_null_impl(
        _source: Option<&Source>,
        r: Range,
        tracker: Option<&mut LineColumnTracker>,
    ) -> Option<Location> {
        if let Some(source) = _source {
            if r.is_empty() {
                return Some(Location {
                    file: Cow::Borrowed(source.path.text),
                    namespace: source.path.namespace,
                    line: -1,
                    column: -1,
                    length: 0,
                    line_text: Some(Cow::Borrowed(b"")),
                    offset: 0,
                });
            }
            let data = match tracker {
                Some(tracker) => tracker.error_position(source, r.loc),
                None => source.init_error_position(r.loc),
            };
            let mut full_line = &source.contents[data.line_start..data.line_end];
            // Window a long line to ~120 bytes around the error. Bounds are
            // BYTE offsets; the gate keeps the original shape (no left trim for
            // an error in the last 80 bytes) so `write_format`'s caret aligns.
            let offset_in_line = clamp_error_offset(&source.contents, r.loc)
                .saturating_sub(data.line_start)
                .min(full_line.len());
            if full_line.len() > 80 + offset_in_line {
                let mut lo = offset_in_line.saturating_sub(40);
                let mut hi = (offset_in_line + 80).min(full_line.len());
                while lo > 0 && !bun_core::strings::is_utf8_char_boundary(full_line[lo]) {
                    lo -= 1;
                }
                while hi < full_line.len()
                    && !bun_core::strings::is_utf8_char_boundary(full_line[hi])
                {
                    hi += 1;
                }
                full_line = &full_line[lo..hi];
            }

            return Some(Location {
                file: Cow::Borrowed(source.path.text),
                namespace: source.path.namespace,
                line: usize2loc(data.line_count).start,
                column: usize2loc(data.column_count).start,
                length: if r.len > -1 {
                    u32::try_from(r.len).expect("int cast") as usize
                } else {
                    1
                },
                // `source_backing` in `Transpiler::parse_*` is RAII and
                // drops on the parse-error path *before* `process_fetch_log`
                // clones the `Msg` into a `BuildMessage`, so own the bytes here
                // instead of borrowing `source.contents`. `full_line` is
                // bounded (≤ ~120 bytes) and only materialized on diagnostic
                // paths.
                line_text: Some(Cow::Owned(bun_core::trim_left(full_line, b"\n\r").to_vec())),
                offset: usize::try_from(r.loc.start.max(0)).expect("int cast"),
            });
        }
        None
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Data
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Data {
    pub text: Cow<'static, [u8]>,
    pub location: Option<Location>,
}

impl Default for Data {
    fn default() -> Self {
        Data {
            text: Cow::Borrowed(b""),
            location: None,
        }
    }
}

impl Data {
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += self.text.len();
        if let Some(loc) = &self.location {
            cost += loc.memory_cost();
        }
        cost
    }

    // `text` is `Cow<'static, [u8]>`: `Owned` frees on `Drop`, `Borrowed` is a
    // `&'static` literal — nothing to free. No explicit `Drop` body needed.

    pub fn clone_line_text(&self, should: bool) -> Data {
        if !should || self.location.is_none() || self.location.as_ref().unwrap().line_text.is_none()
        {
            return self.clone();
        }

        let new_line_text = self
            .location
            .as_ref()
            .unwrap()
            .line_text
            .as_deref()
            .unwrap()
            .to_vec();
        let mut new_location = self.location.clone().unwrap();
        new_location.line_text = Some(Cow::Owned(new_line_text));
        Data {
            text: self.text.clone(),
            location: Some(new_location),
        }
    }

    pub fn clone(&self) -> Data {
        Data {
            text: if !self.text.is_empty() {
                // `Cow::clone` only deep-copies the `Owned` arm; force the dupe
                // so a `Borrowed` `text` (rare today, but the type permits it)
                // can't alias recycled storage in the cloned `Msg`.
                Cow::Owned(self.text.to_vec())
            } else {
                Cow::Borrowed(b"")
            },
            location: self.location.as_ref().map(Location::clone),
        }
    }

    pub(crate) fn clone_with_builder(&self, builder: &mut StringBuilder) -> Data {
        Data {
            text: if !self.text.is_empty() {
                // The local `StringBuilder`
                // is a no-op stub (returns its input), so a bare `Cow::clone`
                // would leave a `Borrowed` arm aliasing `self`'s storage and
                // dangle after `self.msgs.clear()` in
                // `append_to_with_recycled`. Deep-copy — same end-state as the
                // real builder, just without the single-buffer packing.
                Cow::Owned(self.text.to_vec())
            } else {
                Cow::Borrowed(b"")
            },
            location: self
                .location
                .as_ref()
                .map(|l| l.clone_with_builder(builder)),
        }
    }

    pub(crate) fn count(&self, builder: &mut StringBuilder) {
        builder.count(&self.text);
        if let Some(loc) = &self.location {
            loc.count(builder);
        }
    }

    pub(crate) fn write_format<const ENABLE_ANSI_COLORS: bool>(
        &self,
        to: &mut impl fmt::Write,
        kind: Kind,
        redact_sensitive_information: bool,
    ) -> fmt::Result {
        if self.text.is_empty() {
            return Ok(());
        }

        // Local wrapper around `bun_core::pretty_fmt!` so the const-generic
        // `ENABLE_ANSI_COLORS` selects the right compile-time template at each call
        // site (the macro pattern-matches a literal `true`/`false` token).
        macro_rules! pretty_write {
            ($fmt:literal $(, $arg:expr)* $(,)?) => {
                if ENABLE_ANSI_COLORS {
                    write!(to, bun_core::pretty_fmt!($fmt, true) $(, $arg)*)
                } else {
                    write!(to, bun_core::pretty_fmt!($fmt, false) $(, $arg)*)
                }
            };
        }

        // `pub const &'static str` — accepted by `const_format::concatcp!` below.
        use bun_core::output::ansi::{BLUE, BOLD as B, DIM as D, RED};

        let message_color: &'static str = match kind {
            Kind::Err => B,
            Kind::Note => BLUE,
            _ => const_format::concatcp!(D, B),
        };

        let color_name: &'static str = match kind {
            Kind::Err => RED,
            Kind::Note => BLUE,
            _ => D,
        };

        if let Some(location) = &self.location {
            if let Some(line_text_) = location.line_text.as_deref() {
                let line_text_right_trimmed = bun_core::trim_right(line_text_, b" \r\n\t");
                let line_text = bun_core::trim_left(line_text_right_trimmed, b"\n\r");
                if location.column > 0 && !line_text.is_empty() {
                    let mut line_offset_for_second_line: usize =
                        usize::try_from(location.column - 1).expect("int cast");

                    if location.line > -1 {
                        let bold = matches!(kind, Kind::Err | Kind::Warn);
                        // bold the line number for error but dim for the attached note
                        if bold {
                            pretty_write!("<b>{} | <r>", location.line)?;
                        } else {
                            pretty_write!("<d>{} | <r>", location.line)?;
                        }

                        line_offset_for_second_line +=
                            bun_core::fmt::digit_count(location.line) + " | ".len();
                    }

                    writeln!(
                        to,
                        "{}",
                        bun_core::fmt::fmt_javascript(
                            line_text,
                            bun_core::fmt::HighlighterOptions {
                                enable_colors: ENABLE_ANSI_COLORS,
                                redact_sensitive_information,
                                ..Default::default()
                            },
                        )
                    )?;

                    write_n_bytes(to, b' ', line_offset_for_second_line)?;
                    if ENABLE_ANSI_COLORS && !message_color.is_empty() {
                        to.write_str(message_color)?;
                        to.write_str(color_name)?;
                        // always bold the ^
                        to.write_str(B)?;

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

        pretty_write!("<r><d>: <r>")?;

        if ENABLE_ANSI_COLORS {
            to.write_str(message_color)?;
        }

        pretty_write!("{}<r>", bstr::BStr::new(&*self.text))?;

        if let Some(location) = &self.location {
            if !location.file.is_empty() {
                to.write_str("\n")?;
                write_n_bytes(to, b' ', (kind.string().len() + ": ".len()) - "at ".len())?;

                pretty_write!("<d>at <r><cyan>{}<r>", bstr::BStr::new(&location.file))?;

                if location.line > 0 && location.column > -1 {
                    pretty_write!(
                        "<d>:<r><yellow>{}<r><d>:<r><yellow>{}<r>",
                        location.line,
                        location.column,
                    )?;
                } else if location.line > -1 {
                    pretty_write!("<d>:<r><yellow>{}<r>", location.line)?;
                }
            }
        }

        Ok(())
    }
}

fn write_n_bytes(to: &mut impl fmt::Write, b: u8, n: usize) -> fmt::Result {
    for _ in 0..n {
        to.write_char(b as char)?;
    }
    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// BabyString
// ───────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct BabyString(u32);

impl BabyString {
    #[inline]
    pub(crate) const fn new(offset: u16, len: u16) -> Self {
        // LSB-first packing: offset = low 16 bits, len = high 16.
        BabyString((offset as u32) | ((len as u32) << 16))
    }

    #[inline]
    pub(crate) const fn offset(self) -> u16 {
        self.0 as u16
    }

    #[inline]
    pub(crate) const fn len(self) -> u16 {
        (self.0 >> 16) as u16
    }

    pub fn r#in(parent: &[u8], text: &[u8]) -> BabyString {
        // bun_core::strings::index_of deliberately returns None for an empty
        // needle, but an empty `text` reaches this path via resolve errors for
        // `import ""`, so short-circuit it here to offset 0.
        if text.is_empty() {
            return BabyString::new(0, 0);
        }
        let off = bun_core::strings::index_of(parent, text).expect("unreachable");
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
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += self.data.memory_cost();
        for note in self.notes.iter() {
            cost += note.memory_cost();
        }
        cost
    }

    // `to_js`/`from_js` live as extension-trait methods in `bun_logger_jsc`.

    pub(crate) fn count(&self, builder: &mut StringBuilder) {
        self.data.count(builder);
        for note in self.notes.iter() {
            note.count(builder);
        }
    }

    pub fn clone(&self) -> Msg {
        let mut notes = Vec::with_capacity(self.notes.len());
        for n in self.notes.iter() {
            notes.push(n.clone());
        }
        Msg {
            kind: self.kind,
            data: self.data.clone(),
            metadata: self.metadata,
            notes: notes.into_boxed_slice(),
            redact_sensitive_information: self.redact_sensitive_information,
        }
    }

    pub(crate) fn clone_with_builder(
        &self,
        notes: &mut [Data],
        builder: &mut StringBuilder,
    ) -> Msg {
        Msg {
            kind: self.kind,
            data: self.data.clone_with_builder(builder),
            metadata: self.metadata,
            notes: if !self.notes.is_empty() {
                'brk: {
                    for (i, note) in self.notes.iter().enumerate() {
                        notes[i] = note.clone_with_builder(builder);
                    }
                    break 'brk notes[0..self.notes.len()].to_vec().into_boxed_slice();
                }
            } else {
                Box::default()
            },
            redact_sensitive_information: self.redact_sensitive_information,
        }
    }

    // No explicit Drop body needed beyond field drops.

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
    pub err: crate::Error,
}

impl Default for MetadataResolve {
    fn default() -> Self {
        MetadataResolve {
            specifier: BabyString::new(0, 0),
            import_kind: ImportKind::default(),
            err: crate::Error::ModuleNotFound,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Range
// ───────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Range {
    pub loc: Loc,
    pub len: i32,
}

impl Default for Range {
    fn default() -> Self {
        Range {
            loc: Loc::EMPTY,
            len: 0,
        }
    }
}

/// Was `bun_js_parser::lexer::rangeOfIdentifier`.
/// Moved into logger to break logger→js_parser. Includes the full Unicode
/// `isIdentifierStart/Continue` tables (via `bun_core::identifier`) and
/// `\u{...}` escape skipping.
pub(crate) fn range_of_identifier(contents: &[u8], loc: Loc) -> Range {
    if loc.start < 0 || (loc.start as usize) >= contents.len() {
        return Range::NONE;
    }
    let text = &contents[loc.start as usize..];
    let mut r = Range { loc, len: 0 };
    if text.is_empty() {
        return r;
    }
    let end = text.len() as u32;

    let iter = bun_core::strings::CodepointIterator::init(text);
    let mut cursor = bun_core::strings::Cursor::default();
    if !iter.next(&mut cursor) {
        return r;
    }

    // Handle private names
    if cursor.c == '#' as i32 {
        if !iter.next(&mut cursor) {
            r.len = 1;
            return r;
        }
    }

    // Skip over bracketed unicode escapes such as "\u{10000}". The cursor is
    // positioned on a `\`; advance `cursor.i` one past the closing `}` and
    // zero `cursor.width` so the next decode starts exactly there (the manual
    // advance already consumed the backslash's width — leaving `width` set
    // would skip the byte after `}`).
    let skip_bracketed_escape = |cursor: &mut bun_core::strings::Cursor| {
        if cursor.i + 2 < end
            && text[cursor.i as usize + 1] == b'u'
            && text[cursor.i as usize + 2] == b'{'
        {
            cursor.i += 2;
            while cursor.i < end {
                if text[cursor.i as usize] == b'}' {
                    cursor.i += 1;
                    break;
                }
                cursor.i += 1;
            }
            cursor.width = 0;
        }
    };

    if bun_core::identifier::is_identifier_start(cursor.c) || cursor.c == '\\' as i32 {
        // An identifier may *start* with an escape (e.g. `\u{61}bc`); skip it
        // here too, or the loop below reads the `u`/`{` as ordinary codepoints
        // and truncates the range at the `{`.
        if cursor.c == '\\' as i32 {
            skip_bracketed_escape(&mut cursor);
        }
        while iter.next(&mut cursor) {
            if cursor.c == '\\' as i32 {
                skip_bracketed_escape(&mut cursor);
            } else if !lexer_tables::is_identifier_continue(cursor.c) {
                r.len = i32::try_from(cursor.i).expect("int cast");
                return r;
            }
        }

        // EOF inside the identifier: the cursor holds the *start* offset and
        // width of the last codepoint read — include that codepoint.
        r.len = i32::try_from(cursor.i + cursor.width as u32).expect("int cast");
    }

    r
}

impl Range {
    /// Deprecated: use `NONE`
    #[allow(non_upper_case_globals)]
    pub const None: Range = Self::NONE;
    pub const NONE: Range = Range {
        loc: Loc::EMPTY,
        len: 0,
    };

    pub fn contains(self, k: i32) -> bool {
        k >= self.loc.start && k < self.loc.start + self.len
    }

    pub fn is_empty(self) -> bool {
        self.len == 0 && self.loc.start == Loc::EMPTY.start
    }

    pub fn end(self) -> Loc {
        Loc {
            start: self.loc.start + self.len,
        }
    }

    pub fn end_i(self) -> usize {
        // Saturates negatives to 0.
        (self.loc.start + self.len).max(0) as usize
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

    /// Owned backing storage for `Location.{file,line_text}` (and similar)
    /// that came from transient buffers (e.g. native-plugin C strings): a
    /// side-vector of `Box<[u8]>` owned by the `Log`; [`Log::dupe`] returns a
    /// lifetime-erased borrow into the just-pushed box. The borrow is valid
    /// for the life of `self` because `Box<[u8]>` is heap-stable across `Vec`
    /// growth. See PORTING.md §Allocators (arena pattern).
    pub owned_strings: Vec<Box<[u8]>>,

    /// Incremental line/column scanner for the messages this log creates, so
    /// a flood of diagnostics against one source doesn't rescan it from byte
    /// 0 for every message; see [`LineColumnTracker`]. Boxed and allocated
    /// lazily by the first located diagnostic: most logs never report
    /// anything, and `Log` is embedded by value in types that are sensitive
    /// to its size (e.g. `TaskError` in the isolated installer).
    pub line_column_tracker: Option<Box<LineColumnTracker>>,
}

impl Default for Log {
    fn default() -> Self {
        Log {
            warnings: 0,
            errors: 0,
            msgs: Vec::new(),
            level: if cfg!(debug_assertions) {
                Level::Info
            } else {
                Level::Warn
            },
            clone_line_text: false,
            owned_strings: Vec::new(),
            line_column_tracker: None,
        }
    }
}

impl Log {
    /// Copy `s` into
    /// storage owned by this `Log` and return a `&'static [u8]` view. The
    /// returned slice is valid for as long as `self` lives (the box is never
    /// moved out of `owned_strings`); `'static` is a lifetime erasure matching
    /// the `Str` alias used by `Location`/`Msg`. NOT a leak — the bytes free
    /// when the `Log` drops.
    pub fn dupe(&mut self, s: &[u8]) -> &'static [u8] {
        if s.is_empty() {
            return b"";
        }
        let boxed: Box<[u8]> = Box::from(s);
        // SAFETY: ARENA — `boxed` is about to be pushed into `self.owned_strings`
        // and never removed; its heap allocation is stable across the `Vec`'s
        // growth, so the returned slice is valid for the life of `self`.
        let view: &'static [u8] = unsafe { bun_collections::detach_lifetime(&boxed[..]) };
        self.owned_strings.push(boxed);
        view
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
// SAFETY: `#[repr(i8)]`, five variants, no payload — 1 byte, no padding.
bun_core::unsafe_impl_atom!(Level);

impl Level {
    pub fn at_least(self, other: Level) -> bool {
        (self as i8) <= (other as i8)
    }

    pub const MAP: __ComptimeStringMap_LEVEL_MAP = __ComptimeStringMap_LEVEL_MAP(());

    // `from_js` lives in `bun_logger_jsc`.
}

bun_core::comptime_string_map! {
    /// Backing map for [`Level::MAP`].
    pub static LEVEL_MAP: Level = {
        b"verbose" => Level::Verbose,
        b"debug" => Level::Debug,
        b"info" => Level::Info,
        b"warn" => Level::Warn,
        b"error" => Level::Err,
    };
}

// PORTING.md §Global mutable state: written by CLI startup, read by every
// `Log::init()` (including from bundler worker threads). `AtomicCell<Level>`
// — Acquire/Release, no `unsafe` at call sites.
pub static DEFAULT_LOG_LEVEL: bun_core::AtomicCell<Level> = bun_core::AtomicCell::new(Level::Warn);

impl Log {
    /// [`range_data`], but with the line/column computed through this log's
    /// [`LineColumnTracker`] so successive diagnostics against the same
    /// source resume the previous scan instead of restarting from byte 0.
    fn tracked_range_data(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: impl IntoText,
    ) -> Data {
        let location = if source.is_some() {
            Location::init_or_null_tracked(
                source,
                r,
                self.line_column_tracker.get_or_insert_default(),
            )
        } else {
            Location::init_or_null(source, r)
        };
        Data {
            text: text.into_text(),
            location,
        }
    }

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
        // Drop the per-source scan cache with the messages it was built for;
        // its identity check is pointer-based, so don't let it outlive the
        // logical reuse boundary.
        self.line_column_tracker = None;
    }

    pub fn has_any(&self) -> bool {
        (self.warnings + self.errors) > 0
    }

    pub fn to_api(&self) -> api::Log {
        let mut warnings: u32 = 0;
        let mut errors: u32 = 0;
        for msg in &self.msgs {
            errors += (msg.kind == Kind::Err) as u32;
            warnings += (msg.kind == Kind::Warn) as u32;
        }

        api::Log { warnings, errors }
    }

    pub fn init() -> Log {
        let level = DEFAULT_LOG_LEVEL.load();
        Log {
            msgs: Vec::new(),
            level,
            ..Default::default()
        }
    }

    /// Alias of [`Log::init`].
    #[inline]
    pub fn new() -> Log {
        Log::init()
    }

    pub fn init_comptime() -> Log {
        Log {
            msgs: Vec::new(),
            ..Default::default()
        }
    }

    #[inline]
    pub fn add_debug_fmt(&mut self, source: Option<&Source>, l: Loc, args: fmt::Arguments<'_>) {
        if !Kind::Debug.should_print(self.level) {
            return;
        }
        let text = alloc_print(args);
        self.add_formatted_msg(
            Kind::Debug,
            source,
            Range {
                loc: l,
                ..Default::default()
            },
            text,
            Box::default(),
            true,
            false,
        )
    }

    // `to_js`/`to_js_aggregate_error`/`to_js_array` live in `bun_logger_jsc`.

    pub fn clone_to_with_recycled(&mut self, other: &mut Log, recycled: bool) {
        let dest_start = other.msgs.len();
        other.msgs.extend(self.msgs.iter().map(Msg::clone));
        other.warnings += self.warnings;
        other.errors += self.errors;

        if recycled {
            let mut string_builder = StringBuilder;
            let mut notes_count: usize = 0;
            for msg in &self.msgs {
                msg.count(&mut string_builder);
                notes_count += msg.notes.len();
            }

            string_builder.allocate();
            let mut notes_buf = vec![Data::default(); notes_count];
            let mut note_i: usize = 0;

            // Index instead of zipping `self.msgs` with the tail of
            // `other.msgs` to satisfy borrowck.
            for (k, msg) in self.msgs.iter().enumerate() {
                let j = dest_start + k;
                other.msgs[j] =
                    msg.clone_with_builder(&mut notes_buf[note_i..], &mut string_builder);
                note_i += msg.notes.len();
            }
        }
    }

    pub fn append_to_with_recycled(&mut self, other: &mut Log, recycled: bool) {
        self.clone_to_with_recycled(other, recycled);
        self.msgs.clear();
        self.msgs.shrink_to_fit();
        // See `append_to` — keep `owned_strings` backing alive for the moved msgs.
        other.owned_strings.append(&mut self.owned_strings);
        // See `reset` — the scan cache goes with the messages.
        self.line_column_tracker = None;
    }

    pub fn append_to_maybe_recycled(&mut self, other: &mut Log, source: &Source) {
        self.append_to_with_recycled(other, source.contents_is_recycled)
    }

    // TODO: remove `deinit` because it does not de-initialize the log; it clears it
    pub fn clear_and_free(&mut self) {
        self.msgs.clear();
        self.msgs.shrink_to_fit();
        // self.warnings = 0;
        // self.errors = 0;
        // See `reset` — the scan cache goes with the messages.
        self.line_column_tracker = None;
    }
}

// No `impl Drop` is needed (Vec<Msg> drops automatically). The mid-life
// semantic operation is exposed as `clear_and_free` above.

impl Log {
    /// Shared, non-generic tail for the `add*Fmt` family. The public wrappers
    /// are `inline` and only do the per-call-site formatting; the
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
        text: Cow<'static, [u8]>,
        notes: Box<[Data]>,
        clone: bool,
        redact: bool,
    ) {
        match kind {
            Kind::Err => self.errors += 1,
            Kind::Warn => self.warnings += 1,
            _ => {}
        }
        let mut data = self.tracked_range_data(source, r, text);
        if clone {
            data = data.clone_line_text(self.clone_line_text);
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
        err: crate::Error,
    ) {
        let text = alloc_print(args);
        // TODO: fix this. this is stupid, the specifier should be returned by
        // `alloc_print`. `fmt::Arguments` is opaque, so callers must pass
        // `specifier_arg` explicitly.
        let specifier = BabyString::r#in(&text, specifier_arg);
        if IS_ERR {
            self.errors += 1;
        } else {
            self.warnings += 1;
        }

        let data = if DUPE_TEXT {
            'brk: {
                let mut _data = self.tracked_range_data(source, r, text);
                if let Some(loc) = &mut _data.location {
                    if let Some(_line) = loc.line_text.as_deref() {
                        loc.line_text = Some(Cow::Owned(_line.to_vec()));
                    }
                }
                break 'brk _data;
            }
        } else {
            self.tracked_range_data(source, r, text)
        };

        let msg = Msg {
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
        err: crate::Error,
    ) {
        // Always dupe the line_text from the source to ensure the Location data
        // outlives the source's backing memory (which may be arena-allocated).
        self.add_resolve_error_with_level::<true, true>(
            source,
            r,
            args,
            specifier_arg,
            import_kind,
            err,
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
    ) {
        self.add_resolve_error_with_level::<true, true>(
            source,
            r,
            args,
            specifier_arg,
            import_kind,
            crate::Error::ModuleNotFound,
        )
    }

    #[cold]
    pub fn add_range_error(&mut self, source: Option<&Source>, r: Range, text: Str) {
        self.errors += 1;
        let data = self.tracked_range_data(source, r, text);
        self.add_msg(Msg {
            kind: Kind::Err,
            data,
            ..Default::default()
        })
    }

    #[inline]
    pub fn add_range_error_fmt(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
    ) {
        let text = alloc_print(args);
        self.add_formatted_msg(Kind::Err, source, r, text, Box::default(), true, false)
    }

    #[inline]
    pub fn add_range_error_fmt_with_notes(
        &mut self,
        source: Option<&Source>,
        r: Range,
        notes: Box<[Data]>,
        args: fmt::Arguments<'_>,
    ) {
        let text = alloc_print(args);
        self.add_formatted_msg(Kind::Err, source, r, text, notes, true, false)
    }

    #[inline]
    pub fn add_error_fmt<'a>(
        &mut self,
        source: impl Into<Option<&'a Source>>,
        l: Loc,
        args: fmt::Arguments<'_>,
    ) {
        let text = alloc_print(args);
        self.add_formatted_msg(
            Kind::Err,
            source.into(),
            Range {
                loc: l,
                ..Default::default()
            },
            text,
            Box::default(),
            true,
            false,
        )
    }

    // TODO(dylan-conway): rename and replace `addErrorFmt`
    #[inline]
    pub fn add_error_fmt_opts(&mut self, args: fmt::Arguments<'_>, opts: AddErrorOptions<'_>) {
        let text = alloc_print(args);
        self.add_formatted_msg(
            Kind::Err,
            opts.source,
            Range {
                loc: opts.loc,
                len: opts.len,
            },
            text,
            Box::default(),
            true,
            opts.redact_sensitive_information,
        )
    }

    /// Use a bun.sys.Error's message in addition to some extra context.
    pub fn add_sys_error(&mut self, e: &bun_sys::Error, args: fmt::Arguments<'_>) {
        let Some((tag_name, sys_errno)) = e.get_error_code_tag_name() else {
            return self.add_error_fmt(None, Loc::EMPTY, args);
        };
        let prefix = bun_sys::coreutils_error_map::get(sys_errno).unwrap_or(tag_name);
        self.add_error_fmt(None, Loc::EMPTY, format_args!("{}: {}", prefix, args))
    }

    #[cold]
    pub fn add_zig_error_with_note(
        &mut self,
        err_name: &'static str,
        note_args: fmt::Arguments<'_>,
    ) {
        self.errors += 1;

        let notes: Box<[Data]> = Box::new([range_data(None, Range::NONE, alloc_print(note_args))]);

        let data = self.tracked_range_data(None, Range::NONE, err_name.as_bytes());
        self.add_msg(Msg {
            kind: Kind::Err,
            data,
            notes,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_range_warning(&mut self, source: Option<&Source>, r: Range, text: Str) {
        if !Kind::Warn.should_print(self.level) {
            return;
        }
        self.warnings += 1;
        let data = self
            .tracked_range_data(source, r, text)
            .clone_line_text(self.clone_line_text);
        self.add_msg(Msg {
            kind: Kind::Warn,
            data,
            ..Default::default()
        })
    }

    #[inline]
    pub fn add_warning_fmt(&mut self, source: Option<&Source>, l: Loc, args: fmt::Arguments<'_>) {
        if !Kind::Warn.should_print(self.level) {
            return;
        }
        let text = alloc_print(args);
        self.add_formatted_msg(
            Kind::Warn,
            source,
            Range {
                loc: l,
                ..Default::default()
            },
            text,
            Box::default(),
            true,
            false,
        )
    }

    #[cold]
    pub fn add_warning_fmt_line_col(
        &mut self,
        filepath: Str,
        line: u32,
        col: u32,
        args: fmt::Arguments<'_>,
    ) {
        self.add_warning_fmt_line_col_with_notes(filepath, line, col, args, Box::default())
    }

    #[cold]
    pub fn add_warning_fmt_line_col_with_notes(
        &mut self,
        filepath: Str,
        line: u32,
        col: u32,
        args: fmt::Arguments<'_>,
        notes: Box<[Data]>,
    ) {
        if !Kind::Warn.should_print(self.level) {
            return;
        }
        self.warnings += 1;

        // TODO: do this properly

        let data = Data {
            text: alloc_print(args),
            location: Some(Location {
                // `Location.file` borrows the lifetime-erased `Str`; see the
                // module-level OWNERSHIP note.
                file: Cow::Borrowed(filepath),
                line: i32::try_from(line).expect("int cast"),
                column: i32::try_from(col).expect("int cast"),
                ..Default::default()
            }),
        }
        .clone_line_text(self.clone_line_text);

        self.add_msg(Msg {
            kind: Kind::Warn,
            data,
            notes,
            ..Default::default()
        })
    }

    #[inline]
    pub fn add_range_warning_fmt(
        &mut self,
        source: Option<&Source>,
        r: Range,
        args: fmt::Arguments<'_>,
    ) {
        if !Kind::Warn.should_print(self.level) {
            return;
        }
        let text = alloc_print(args);
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
    ) {
        if !Kind::Warn.should_print(self.level) {
            return;
        }
        self.warnings += 1;

        let notes: Box<[Data]> =
            Box::new([self.tracked_range_data(source, note_range, alloc_print(note_args))]);

        let data = self.tracked_range_data(source, r, alloc_print(args));
        self.add_msg(Msg {
            kind: Kind::Warn,
            data,
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
    ) {
        let text = alloc_print(args);
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
    ) {
        if !Kind::Err.should_print(self.level) {
            return;
        }
        self.errors += 1;

        let notes: Box<[Data]> =
            Box::new([self.tracked_range_data(source, note_range, alloc_print(note_args))]);

        let data = self.tracked_range_data(source, r, alloc_print(args));
        self.add_msg(Msg {
            kind: Kind::Err,
            data,
            notes,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_warning(&mut self, source: Option<&Source>, l: Loc, text: Str) {
        if !Kind::Warn.should_print(self.level) {
            return;
        }
        self.warnings += 1;
        let data = self.tracked_range_data(
            source,
            Range {
                loc: l,
                ..Default::default()
            },
            text,
        );
        self.add_msg(Msg {
            kind: Kind::Warn,
            data,
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
    ) {
        if !Kind::Warn.should_print(self.level) {
            return;
        }
        self.warnings += 1;

        let notes: Box<[Data]> = Box::new([self.tracked_range_data(
            source,
            Range {
                loc: l,
                ..Default::default()
            },
            alloc_print(note_args),
        )]);

        let data = self.tracked_range_data(None, Range::NONE, warn);
        self.add_msg(Msg {
            kind: Kind::Warn,
            data,
            notes,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_range_debug(&mut self, source: Option<&Source>, r: Range, text: Str) {
        if !Kind::Debug.should_print(self.level) {
            return;
        }
        let data = self.tracked_range_data(source, r, text);
        self.add_msg(Msg {
            kind: Kind::Debug,
            data,
            ..Default::default()
        })
    }

    #[cold]
    pub fn add_range_error_with_notes(
        &mut self,
        source: Option<&Source>,
        r: Range,
        text: impl IntoText,
        notes: Box<[Data]>,
    ) {
        self.errors += 1;
        let data = self.tracked_range_data(source, r, text);
        self.add_msg(Msg {
            kind: Kind::Err,
            data,
            notes,
            ..Default::default()
        })
    }

    pub fn add_msg(&mut self, msg: Msg) {
        self.msgs.push(msg);
    }

    #[cold]
    pub fn add_error(&mut self, _source: Option<&Source>, loc: Loc, text: impl IntoText) {
        self.errors += 1;
        let data = self.tracked_range_data(
            _source,
            Range {
                loc,
                ..Default::default()
            },
            text,
        );
        self.add_msg(Msg {
            kind: Kind::Err,
            data,
            ..Default::default()
        })
    }

    // TODO(dylan-conway): rename and replace `addError`
    #[cold]
    pub fn add_error_opts(&mut self, text: Str, opts: AddErrorOptions<'_>) {
        self.errors += 1;
        let data = self.tracked_range_data(
            opts.source,
            Range {
                loc: opts.loc,
                len: opts.len,
            },
            text,
        );
        self.add_msg(Msg {
            kind: Kind::Err,
            data,
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
    ) {
        let note_text = alloc_print(format_args!(
            "\"{}\" was originally declared here",
            bstr::BStr::new(name)
        ));
        let notes: Box<[Data]> = Box::new([self.tracked_range_data(
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

    pub fn print<W: IntoLogWrite>(&self, to: W) -> fmt::Result {
        let mut w = to.into_log_write();
        if Output::ENABLE_ANSI_COLORS_STDERR.load(core::sync::atomic::Ordering::Relaxed) {
            self.print_with_enable_ansi_colors::<true>(&mut w)
        } else {
            self.print_with_enable_ansi_colors::<false>(&mut w)
        }
    }

    pub(crate) fn print_with_enable_ansi_colors<const ENABLE_ANSI_COLORS: bool>(
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

#[derive(Clone, Copy, Default)]
pub struct AddErrorOptions<'a> {
    pub source: Option<&'a Source>,
    pub loc: Loc,
    pub len: i32,
    pub redact_sensitive_information: bool,
}

/// Downstream-compat alias: some callers (`bunfig.rs`, `PnpmMatcher.rs`) spell
/// the option-struct as `bun_ast::ErrorOpts { .. }`. Same layout as
/// `AddErrorOptions`.
pub type ErrorOpts<'a> = AddErrorOptions<'a>;

/// Call-site helper: rewrites `<red>..<r>` markup
/// in the *literal* format string via `bun_core::pretty_fmt!` (compile-time),
/// then formats. Expands to a `fmt::Arguments` so it drops in wherever a
/// pre-built `fmt::Arguments` was previously passed to `alloc_print`.
///
/// Callers that build messages with markup must use this (or `alloc_print!`) so
/// the tags are converted/stripped; passing a raw `format_args!` through the
/// function form below leaves the markup verbatim.
#[macro_export]
macro_rules! pretty_format_args {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {{
        if ::bun_core::Output::ENABLE_ANSI_COLORS_STDERR
            .load(::core::sync::atomic::Ordering::Relaxed)
        {
            ::core::format_args!(::bun_core::pretty_fmt!($fmt, true) $(, $arg)*)
        } else {
            ::core::format_args!(::bun_core::pretty_fmt!($fmt, false) $(, $arg)*)
        }
    }};
}

/// `alloc_print!(fmt, args..)` — owned-buffer form of `pretty_format_args!`.
#[macro_export]
macro_rules! alloc_print {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::alloc_print($crate::pretty_format_args!($fmt $(, $arg)*))
    };
}

/// `add_error_pretty!(log, source, loc, "<red>...<r>", args..)` — call-site
/// helper that rewrites `<tag>` markup in the *literal* format string
/// at compile time (via `bun_core::pretty_fmt!`) before interpolation, then
/// calls `Log::add_error_fmt`. Use this instead of
/// `add_error_fmt(.., format_args!("<red>..."))` so markup is converted/stripped
/// rather than stored literally in the message text. Only one branch executes,
/// so each `$arg` evaluates exactly once.
#[macro_export]
macro_rules! add_error_pretty {
    ($log:expr, $src:expr, $loc:expr, $fmt:literal $(, $arg:expr)* $(,)?) => {
        if ::bun_core::Output::ENABLE_ANSI_COLORS_STDERR
            .load(::core::sync::atomic::Ordering::Relaxed)
        {
            $log.add_error_fmt(
                $src,
                $loc,
                ::core::format_args!(::bun_core::pretty_fmt!($fmt, true) $(, $arg)*),
            )
        } else {
            $log.add_error_fmt(
                $src,
                $loc,
                ::core::format_args!(::bun_core::pretty_fmt!($fmt, false) $(, $arg)*),
            )
        }
    };
}

/// Warning counterpart of [`add_error_pretty!`].
#[macro_export]
macro_rules! add_warning_pretty {
    ($log:expr, $src:expr, $loc:expr, $fmt:literal $(, $arg:expr)* $(,)?) => {
        if ::bun_core::Output::ENABLE_ANSI_COLORS_STDERR
            .load(::core::sync::atomic::Ordering::Relaxed)
        {
            $log.add_warning_fmt(
                $src,
                $loc,
                ::core::format_args!(::bun_core::pretty_fmt!($fmt, true) $(, $arg)*),
            )
        } else {
            $log.add_warning_fmt(
                $src,
                $loc,
                ::core::format_args!(::bun_core::pretty_fmt!($fmt, false) $(, $arg)*),
            )
        }
    };
}

#[inline]
pub fn alloc_print(args: fmt::Arguments<'_>) -> Cow<'static, [u8]> {
    // Markup conversion happens over the *format-string literal only*;
    // interpolated values are never inspected for `<..>` markup.
    // With `fmt::Arguments` the literal is opaque, so callers that need markup
    // conversion must go through `pretty_format_args!` / `alloc_print!` above
    // (which do the rewrite at the macro call site). The function form here
    // renders `args` verbatim: do NOT run a runtime markup pass over the
    // rendered bytes, or user-supplied argument values containing `<`
    // (`<stdin>`, `Array<string>`, JSX/HTML snippets) get mangled.
    use std::io::Write;
    let mut v = Vec::new();
    let _ = write!(&mut v, "{}", args);
    // `Cow::Owned`: the `Log` takes ownership via `Data.text` and `Data`'s
    // `Drop` frees it.
    Cow::Owned(v)
}

#[inline]
pub fn usize2loc(loc: usize) -> Loc {
    Loc {
        start: i32::try_from(loc).expect("int cast"),
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Source
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Source {
    pub path: bun_paths::fs::Path<'static>,

    /// `Cow` so `source_from_file` / `File::to_source_at` can hand
    /// back a heap buffer without leaking (PORTING.md §Forbidden). Borrowed
    /// arm covers parser/transpiler-fed
    /// arena slices (via `IntoStr`). Prefer the `.contents()` accessor at
    /// call-sites — it derefs to `&[u8]` regardless of arm.
    pub contents: Cow<'static, [u8]>,
    pub contents_is_recycled: bool,

    /// Lazily-generated human-readable identifier name that is non-unique
    /// Avoid accessing this directly most of the  time
    ///
    /// `Cow` because the cached value is produced by
    /// `MutableString::ensure_valid_identifier` (owned `Box<[u8]>`); per
    /// PORTING.md §Forbidden this cannot be `&'static [u8]` + leak.
    pub identifier_name: Cow<'static, [u8]>,

    pub index: Index,
}

impl Default for Source {
    fn default() -> Self {
        Source {
            path: bun_paths::fs::Path::default(),
            contents: Cow::Borrowed(b""),
            contents_is_recycled: false,
            identifier_name: Cow::Borrowed(b""),
            index: Index::source(0),
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct ErrorPosition {
    pub(crate) line_start: usize,
    pub(crate) line_end: usize,
    pub(crate) column_count: usize,
    pub(crate) line_count: usize,
}

/// Scanner state shared by [`Source::init_error_position`] and
/// [`LineColumnTracker`] — the loop locals of the error-position scan,
/// captured after consuming every codepoint before some byte offset.
#[derive(Clone, Copy)]
struct ErrorPositionState {
    line_start: usize,
    line_count: usize,
    column_number: usize,
    prev_code_point: i32,
}

impl Default for ErrorPositionState {
    fn default() -> Self {
        ErrorPositionState {
            line_start: 0,
            line_count: 1,
            column_number: 1,
            prev_code_point: 0,
        }
    }
}

impl ErrorPositionState {
    /// Consume the codepoints of `contents[from..to]`, updating line/column
    /// exactly the way `Source::init_error_position` always has (`\r` resets
    /// the column to 0, `\r\n` counts as a single line break, U+2028/U+2029
    /// are line breaks). Returns `true` if a line break was crossed.
    fn advance(&mut self, contents: &[u8], from: usize, to: usize) -> bool {
        use bun_core::strings::{CodepointIterator, Cursor};
        let iter_ = CodepointIterator::init(&contents[from..to]);
        let mut iter = Cursor::default();
        let mut crossed_line_break = false;

        while iter_.next(&mut iter) {
            match iter.c {
                0x0A => {
                    // '\n'
                    self.column_number = 1;
                    self.line_start = from + iter.width as usize + iter.i as usize;
                    if self.prev_code_point != ('\r' as i32) {
                        self.line_count += 1;
                    }
                    crossed_line_break = true;
                }
                0x0D => {
                    // '\r'
                    self.column_number = 0;
                    self.line_start = from + iter.width as usize + iter.i as usize;
                    self.line_count += 1;
                    crossed_line_break = true;
                }
                0x2028 | 0x2029 => {
                    // These take three bytes to encode in UTF-8
                    self.line_start = from + iter.width as usize + iter.i as usize;
                    self.line_count += 1;
                    self.column_number = 1;
                    crossed_line_break = true;
                }
                _ => {
                    // Columns count UTF-16 code units (JSC/V8 stack traces, the
                    // source-map spec, and the CSS logger all agree on this).
                    self.column_number += 1 + (iter.c > 0xFFFF) as usize;
                }
            }

            self.prev_code_point = iter.c;
        }

        crossed_line_break
    }

    fn to_error_position(self, line_end: usize) -> ErrorPosition {
        ErrorPosition {
            line_start: if self.line_start > 0 {
                self.line_start - 1
            } else {
                self.line_start
            },
            line_end,
            line_count: self.line_count,
            column_count: self.column_number,
        }
    }
}

/// Byte offset of the line break at or after `offset` (the end of the line
/// containing `offset`), or the end of the file if this is the last line.
fn scan_line_end(contents: &[u8], offset: usize) -> usize {
    use bun_core::strings::{CodepointIterator, Cursor};
    let iter_ = CodepointIterator::init(&contents[offset..]);
    let mut iter = Cursor::default();

    while iter_.next(&mut iter) {
        match iter.c {
            0x0D | 0x0A | 0x2028 | 0x2029 => return offset + iter.i as usize,
            _ => {}
        }
    }

    contents.len()
}

/// Clamp a diagnostic `Loc` into `contents` the way `init_error_position`
/// always has.
#[inline]
fn clamp_error_offset(contents: &[u8], offset_loc: Loc) -> usize {
    (usize::try_from(offset_loc.start).expect("int cast")).min(contents.len().max(1) - 1)
}

/// Incremental line/column scanner for diagnostics (the esbuild
/// `LineColumnTracker` approach). [`Source::init_error_position`] walks the
/// source from byte 0 on every call, so a parse that reports many diagnostics
/// against one file pays O(diagnostics × file size) just computing their
/// positions — a few hundred KB of malformed JSONC that errors on nearly
/// every token used to take minutes. The [`Log`] owns one of these:
/// diagnostics for the same source at non-decreasing offsets resume the
/// previous scan, so N diagnostics cost O(file size + N) in total. Results
/// are identical to `Source::init_error_position`.
#[derive(Default)]
pub struct LineColumnTracker {
    /// Identity of the tracked source (`contents` and `path.text` pointers +
    /// lengths, stored as `usize` so the tracker stays `Send`). A diagnostic
    /// for a different source resets the scan.
    contents_ptr: usize,
    contents_len: usize,
    path_ptr: usize,
    path_len: usize,
    cursors: [ScanCursor; 4],
}

#[derive(Clone, Copy, Default)]
struct ScanCursor {
    offset: usize,
    state: ErrorPositionState,
    line_end: Option<usize>,
}

impl LineColumnTracker {
    fn matches(&self, source: &Source) -> bool {
        self.contents_ptr == source.contents.as_ptr() as usize
            && self.contents_len == source.contents.len()
            && self.path_ptr == source.path.text.as_ptr() as usize
            && self.path_len == source.path.text.len()
    }

    fn reset_for(&mut self, source: &Source) {
        *self = LineColumnTracker {
            contents_ptr: source.contents.as_ptr() as usize,
            contents_len: source.contents.len(),
            path_ptr: source.path.text.as_ptr() as usize,
            path_len: source.path.text.len(),
            ..Default::default()
        };
    }

    /// [`Source::init_error_position`], resuming from the previous call's
    /// offset when possible instead of rescanning from the start.
    pub(crate) fn error_position(&mut self, source: &Source, offset_loc: Loc) -> ErrorPosition {
        debug_assert!(!offset_loc.is_empty());
        let contents: &[u8] = &source.contents;
        let offset = clamp_error_offset(contents, offset_loc);

        if !self.matches(source) {
            self.reset_for(source);
        }

        if offset < contents.len() && contents[offset] & 0xC0 == 0x80 {
            return source.init_error_position(offset_loc);
        }

        let Some(index) = self.cursors.iter().position(|c| c.offset <= offset) else {
            return source.init_error_position(offset_loc);
        };
        let cursor = &mut self.cursors[index];

        if cursor.state.advance(contents, cursor.offset, offset) {
            cursor.line_end = None;
        }
        cursor.offset = offset;

        let line_end = match cursor.line_end {
            Some(line_end) => line_end,
            None => {
                let line_end = scan_line_end(contents, offset);
                cursor.line_end = Some(line_end);
                line_end
            }
        };

        cursor.state.to_error_position(line_end)
    }
}

impl Source {
    /// Borrowed view of the source bytes. Provided as a method so callers that
    /// were written against a future owning-`contents` shape (`Vec<u8>`/`Cow`)
    /// don't need to change when the field type flips.
    #[inline]
    pub fn contents(&self) -> &[u8] {
        &self.contents
    }

    pub fn fmt_identifier(&self) -> bun_core::fmt::FormatValidIdentifier<'_> {
        self.path.name().fmt_identifier()
    }

    pub fn range_of_identifier(&self, loc: Loc) -> Range {
        // Scan from `loc` while bytes are JS identifier-part.
        range_of_identifier(&self.contents, loc)
    }

    pub fn is_web_assembly(&self) -> bool {
        if self.contents.len() < 4 {
            return false;
        }

        let bytes = u32::from_ne_bytes(
            self.contents[0..4]
                .try_into()
                .expect("infallible: size matches"),
        );
        bytes == 0x6d73_6100 // "\0asm"
    }

    pub fn init_empty_file(filepath: impl IntoStr) -> Source {
        let path = bun_paths::fs::Path::init(filepath.into_str());
        Source {
            path,
            contents: Cow::Borrowed(b""),
            ..Default::default()
        }
    }

    pub fn init_recycled_file(file: &PathContentsPair) -> crate::Result<Source> {
        let mut source = Source {
            path: file.path,
            contents: Cow::Borrowed(file.contents),
            contents_is_recycled: true,
            ..Default::default()
        };
        source.path.namespace = b"file";
        Ok(source)
    }

    pub fn init_path_string(path_string: impl IntoStr, contents: impl IntoStr) -> Source {
        let path = bun_paths::fs::Path::init(path_string.into_str());
        Source {
            path,
            contents: Cow::Borrowed(contents.into_str()),
            ..Default::default()
        }
    }

    /// `init_path_string` with heap-owned contents — used by `source_from_file`
    /// so the read buffer is dropped with the `Source` instead of leaked.
    pub fn init_path_string_owned(path_string: impl IntoStr, contents: Vec<u8>) -> Source {
        let path = bun_paths::fs::Path::init(path_string.into_str());
        Source {
            path,
            contents: Cow::Owned(contents),
            ..Default::default()
        }
    }

    pub fn text_for_range(&self, r: Range) -> &[u8] {
        &self.contents[r.loc.i()..r.end_i()]
    }

    pub fn range_of_operator_before(&self, loc: Loc, op: &[u8]) -> Range {
        let text = &self.contents[0..loc.i()];
        let index = bun_core::strings::index(text, op);
        if index >= 0 {
            return Range {
                loc: Loc {
                    start: loc.start + index,
                },
                len: i32::try_from(op.len()).expect("int cast"),
            };
        }

        Range {
            loc,
            ..Default::default()
        }
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
                    return Range {
                        loc,
                        len: i32::try_from(i + 1).expect("int cast"),
                    };
                } else if c == b'\\' {
                    i += 1;
                }
                i += 1;
            }
        }

        Range { loc, len: 0 }
    }

    pub(crate) fn init_error_position(&self, offset_loc: Loc) -> ErrorPosition {
        debug_assert!(!offset_loc.is_empty());
        let contents: &[u8] = &self.contents;
        let offset = clamp_error_offset(contents, offset_loc);

        let mut state = ErrorPositionState::default();
        state.advance(contents, 0, offset);

        // Scan to the end of the line (or end of file if this is the last line)
        state.to_error_position(scan_line_end(contents, offset))
    }

    /// Byte offset of 1-based (`line`, `col`) in `source_contents`, resuming the
    /// scan from (`start_line`, `start_col`). Columns count UTF-16 code units,
    /// the convention of JSC stack traces and source-map mappings.
    pub fn line_col_to_byte_offset(
        source_contents: &[u8],
        start_line: u64,
        start_col: u64,
        line: u64,
        col: u64,
    ) -> Option<usize> {
        use bun_core::strings::{CodepointIterator, Cursor};
        let iter_ = CodepointIterator::init(source_contents);
        let mut iter = Cursor::default();

        let mut line_count: u64 = start_line;
        let mut column_number: u64 = start_col;

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
                    column_number += if c > 0xFFFF { 2 } else { 1 };
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
    }
}

pub fn range_data(source: Option<&Source>, r: Range, text: impl IntoText) -> Data {
    Data {
        text: text.into_text(),
        location: Location::init_or_null(source, r),
    }
}

// ───────────────────────────────────────────────────────────────────────────
// File → Source helpers — `bun_sys` (T1) cannot name `Source` (this crate),
// so the file→Source conversions live here as free fns.
// ───────────────────────────────────────────────────────────────────────────

#[derive(Default, Clone, Copy)]
pub struct ToSourceOptions {
    pub convert_bom: bool,
}

/// Read `path` (rooted at cwd) into memory and wrap it in a `Source`.
///
/// MOVE_DOWN from `bun_sys::File::to_source` (T1 cannot name T2).
pub fn source_from_file(path: &bun_core::ZStr, opts: ToSourceOptions) -> bun_sys::Maybe<Source> {
    source_from_file_at(bun_sys::Fd::cwd(), path, opts)
}

/// Read `path` (relative to `dir_fd`) into memory and wrap it in a `Source`.
///
/// MOVE_DOWN from `bun_sys::File::to_source_at` (T1 cannot name T2).
fn source_from_file_at(
    dir_fd: bun_sys::Fd,
    path: &bun_core::ZStr,
    opts: ToSourceOptions,
) -> bun_sys::Maybe<Source> {
    let mut bytes = bun_sys::file::File::read_from(dir_fd, path)?;
    if opts.convert_bom {
        if let Some(bom) = bun_core::strings::BOM::detect(&bytes) {
            bytes = bom.remove_and_convert_to_utf8_and_free(bytes);
        }
    }
    // `path` is caller-owned; goes through the `IntoStr` borrow shim
    // (same as every other `Source` constructor). `bytes` is owned by the
    // returned `Source` via `Cow::Owned` — no leaking.
    Ok(Source::init_path_string_owned(path.as_bytes(), bytes))
}

/// `source_from_file_at` rooted at the process CWD.
pub fn to_source(path: &bun_core::ZStr, opts: ToSourceOptions) -> bun_sys::Result<Source> {
    source_from_file(path, opts)
}

// ───────────────────────────────────────────────────────────────────────────
// AST type modules — the full Expr/Stmt/Binding/Symbol/Scope/Op tree.
// One canonical definition; bun_parsers/bun_css/bun_js_parser/bun_js_printer
// all consume these.
// ───────────────────────────────────────────────────────────────────────────

pub mod ast_memory_allocator;
pub mod b;
pub mod base;
pub mod binding;
pub mod char_freq;
pub mod e;
pub mod error;
pub use error::{Error, Result};
pub mod expr;
pub mod fold_string_addition;
pub mod g;
pub mod known_global;
pub mod new_store;
pub mod op;
pub mod s;
pub mod scope;
pub mod server_component_boundary;
pub mod stmt;
pub mod symbol;
pub mod ts;
pub mod use_directive;

pub mod lexer_log;
pub use lexer_log::LexerLog;
pub mod lexer_tables;
pub mod nodes;
pub mod runtime;

pub mod ast_result;
pub mod import_record;
pub mod loader;
pub mod target;

pub use ast_result::{
    Ast, CommonJSNamedExport, CommonJSNamedExports, ConstValuesMap, NamedExports, NamedImports,
    TopLevelSymbolToParts, TsEnumsMap,
};
pub use import_record::{Flags as ImportRecordFlags, ImportRecord, Tag as ImportRecordTag};
pub use loader::{Loader, LoaderHashTable, LoaderOptional, SideEffects};
pub use target::Target;
pub mod transpiler_cache;
// Glob re-export: `link_interface!` emits `#[doc(hidden)]` type aliases that
// the `link_impl_*!` macro addresses as `$crate::__TranspilerCacheImpl__*`.
// `$crate` resolves to this crate root, so the aliases must be reachable here.
pub use transpiler_cache::*;

pub use ast_memory_allocator::ASTMemoryAllocator;
pub use b as B;
pub use base::{Index, IndexInt};
pub use binding::Binding;
pub use char_freq::CharFreq;
pub use e as E;
pub use e::CallUnwrap as CanBeUnwrapped;
pub use expr::{Data as ExprData, Expr, PrimitiveType as KnownPrimitive, Tag as ExprTag};
pub use g as G;
pub use g::NamespaceAlias;
pub use nodes::*;
pub use op as Op;
pub use op::Code as OpCode;
pub use s as S;
pub use s::Kind as LocalKind;
pub use scope::Scope;
pub use stmt::{Data as StmtData, Stmt, Tag as StmtTag};
pub use symbol::{Kind as SymbolKind, List as SymbolList, Symbol};
pub use ts::{TSNamespaceMember, TSNamespaceMemberMap, TSNamespaceScope};
pub use use_directive::UseDirective;

/// `Part.{SymbolUseMap, SymbolPropertyUseMap, List}` — module-style alias so
/// `crate::part::{SymbolUseMap, List}` resolves.
pub mod part {
    pub use crate::nodes::{
        Part, PartList as List, PartSymbolPropertyUseMap as SymbolPropertyUseMap,
        PartSymbolUseMap as SymbolUseMap,
    };
}

/// `TypeScript` — namespace surface for AST type-def files (`G.rs` needs

/// `flags` — bitset enums on AST nodes (`G.rs`/`B.rs` import `crate::flags`).
pub mod flags {
    use enumset::{EnumSet, EnumSetType};

    #[derive(EnumSetType, Debug)]
    pub enum JSXElement {
        IsKeyAfterSpread,
        HasAnyDynamic,
    }
    pub type JSXElementBitset = EnumSet<JSXElement>;

    #[derive(EnumSetType, Debug)]
    pub enum Property {
        IsComputed,
        IsMethod,
        IsStatic,
        WasShorthand,
        IsSpread,
    }
    pub type PropertySet = EnumSet<Property>;
    pub const PROPERTY_NONE: PropertySet = EnumSet::empty();

    #[derive(EnumSetType, Debug)]
    pub enum Function {
        IsAsync,
        IsGenerator,
        HasRestArg,
        HasIfScope,

        IsForwardDeclaration,

        /// This is true if the function is a method
        IsUniqueFormalParameters,

        /// Only applicable to function statements.
        IsExport,

        /// A `// eslint-disable… react-hooks/…` comment was scanned at or before
        /// this function's body close. The React Compiler skips such functions.
        HasReactHooksSuppression,
    }
    pub type FunctionSet = EnumSet<Function>;
    pub const FUNCTION_NONE: FunctionSet = EnumSet::empty();
}

/// Detected indentation of a [`Source`] (tab vs N-space). The JSON/TOML lexers
/// record this so a `package.json` round-trip preserves the user's formatting;
/// `bun_js_printer::Options.indent` consumes it. Default: 2 spaces.
#[derive(Clone, Copy)]
pub struct Indentation {
    pub scalar: usize,
    pub count: usize,
    pub character: IndentationCharacter,
}

impl Default for Indentation {
    fn default() -> Self {
        Self {
            scalar: 2,
            count: 0,
            character: IndentationCharacter::Space,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IndentationCharacter {
    Tab,
    Space,
}

// ───────────────────────────────────────────────────────────────────────────
// Store helpers — debug guards + thread-local side-arena lifecycle for the
// AST `NewStore` slabs.
// ───────────────────────────────────────────────────────────────────────────

/// `DebugOnlyDisabler<T>` — debug-build re-entrancy guard around Store
/// access. No-op in release; in debug, `assert()` panics while the per-type
/// disable count is non-zero.
///
/// Rust cannot declare a generic `#[thread_local]` static, so the debug
/// build keeps one thread-local `TypeId` multiset (each `disable()`
/// pushes `TypeId::of::<T>()`, each `enable()` pops one occurrence; the
/// membership count is the per-type counter).
pub struct DebugOnlyDisabler<T>(core::marker::PhantomData<T>);

#[cfg(debug_assertions)]
mod debug_disabler_state {
    std::thread_local! {
        /// Multiset of currently-disabled store types (one entry per
        /// outstanding `disable()`); debug builds only.
        pub(super) static DISABLED: core::cell::RefCell<Vec<core::any::TypeId>> =
            const { core::cell::RefCell::new(Vec::new()) };
    }
}

impl<T: 'static> DebugOnlyDisabler<T> {
    #[inline]
    pub(crate) fn assert() {
        #[cfg(debug_assertions)]
        debug_disabler_state::DISABLED.with(|d| {
            assert!(
                !d.borrow().contains(&core::any::TypeId::of::<T>()),
                "[{}] called while disabled (did you forget to call enable?)",
                core::any::type_name::<T>(),
            );
        });
    }
    #[inline]
    pub(crate) fn disable() {
        #[cfg(debug_assertions)]
        debug_disabler_state::DISABLED.with(|d| d.borrow_mut().push(core::any::TypeId::of::<T>()));
    }
    #[inline]
    pub(crate) fn enable() {
        #[cfg(debug_assertions)]
        debug_disabler_state::DISABLED.with(|d| {
            let mut v = d.borrow_mut();
            let pos = v
                .iter()
                .rposition(|t| *t == core::any::TypeId::of::<T>())
                .expect("DebugOnlyDisabler::enable without matching disable");
            v.remove(pos);
        });
    }
    /// RAII scope: `disable()` now, `enable()` on drop.
    #[inline]
    pub fn scope() -> DebugOnlyDisablerScope<T> {
        Self::disable();
        DebugOnlyDisablerScope(core::marker::PhantomData)
    }
}

/// Guard returned by [`DebugOnlyDisabler::scope`]; re-enables on drop.
#[must_use = "disabler is re-enabled on drop; bind to a named local"]
pub struct DebugOnlyDisablerScope<T: 'static>(core::marker::PhantomData<T>);
impl<T: 'static> Drop for DebugOnlyDisablerScope<T> {
    #[inline]
    fn drop(&mut self) {
        DebugOnlyDisabler::<T>::enable();
    }
}

/// Per-thread side [`bun_alloc::ast_alloc::AstAllocState`] that backs
/// `AstAlloc` while the bundler's `Stmt.Data.Store` / `Expr.Data.Store`
/// block-store is active and **no** `ASTMemoryAllocator` scope is in effect.
/// See `NewStore::reset` for the leak this closes.
pub mod store_ast_alloc_heap {
    use core::cell::Cell;
    use core::ptr;

    use bun_alloc::ast_alloc::{self, AstAllocState};

    /// Address of this thread's installed side state (the "entered" flag and
    /// the identity check for `reset()`/`exit()`). Never dereferenced.
    #[thread_local]
    static STATE_ID: Cell<*const AstAllocState> = Cell::new(ptr::null());
    /// The `AST_ALLOC` occupant displaced by `enter()`, restored by `exit()`.
    #[thread_local]
    static PREVIOUS: Cell<Option<Box<AstAllocState>>> = Cell::new(None);

    /// `true` iff the state this module installed is the one currently active
    /// (i.e. no other scope is stacked on top of it).
    fn owns_active_state() -> bool {
        core::ptr::eq(ast_alloc::active_state_id(), STATE_ID.get())
    }

    pub(crate) fn enter() {
        if bun_core::getenv_z(bun_core::zstr!("BUN_DISABLE_STORE_AST_HEAP")).is_some() {
            return;
        }
        if !STATE_ID.get().is_null() {
            return;
        }
        let state = ast_alloc::acquire_state();
        STATE_ID.set(&raw const *state);
        PREVIOUS.set(ast_alloc::swap_state(Some(state)));
    }

    pub fn reset() {
        if STATE_ID.get().is_null() {
            enter();
            return;
        }
        // Skip if another scope's state is stacked on top — resetting it
        // would free that scope's live data.
        if !owns_active_state() {
            debug_assert!(
                false,
                "store_ast_alloc_heap::reset while another AstAllocState is installed"
            );
            return;
        }
        ast_alloc::reset_active_state();
    }

    pub(crate) fn exit() {
        if STATE_ID.get().is_null() {
            return;
        }
        // Skip if another scope's state is stacked on top.
        if !owns_active_state() {
            debug_assert!(
                false,
                "store_ast_alloc_heap::exit while another AstAllocState is installed"
            );
            return;
        }
        STATE_ID.set(ptr::null());
        if let Some(state) = ast_alloc::swap_state(PREVIOUS.take()) {
            ast_alloc::release_state(state);
        }
    }
}

// ── DATA_STORE_OVERRIDE ────────────────────────────────────────────────────
// Thread-local override arena for `Expr`/`Stmt` boxed payloads.
//
// When non-null, `Expr::init`
// allocates boxed payloads into this arena instead of the long-lived block
// store, so a scoped caller (YAML/TOML/JSONC parse) can bulk-free the whole
// tree by dropping the arena. Set/restored by `ASTMemoryAllocator::Scope`.
#[thread_local]
static DATA_STORE_OVERRIDE: core::cell::Cell<*const bun_alloc::Arena> =
    core::cell::Cell::new(core::ptr::null());

#[inline]
fn data_store_override() -> *const bun_alloc::Arena {
    DATA_STORE_OVERRIDE.get()
}
#[inline]
fn set_data_store_override(p: *const bun_alloc::Arena) {
    DATA_STORE_OVERRIDE.set(p);
}

/// Copy `bytes` into the active AST arena so the slice shares the same
/// lifetime as the `StoreRef`-backed `Expr` nodes that reference it
/// (bulk-freed on Store reset). Callers
/// building an `EString` from a scratch buffer must intern the bytes here, not
/// into a function-local bump, or `EString.data` dangles when that bump drops.
/// The lifetime is erased per the `StoreStr` convention — arena ownership, not
/// a leak.
pub fn data_store_dupe_str(bytes: &[u8]) -> &'static [u8] {
    let ov = DATA_STORE_OVERRIDE.get();
    if !ov.is_null() {
        // SAFETY: override is installed by an RAII `ASTMemoryAllocator::Scope`
        // that outlives this call, so `*ov` is a live `Arena`. The returned
        // slice is borrowed from that arena; its lifetime is widened to
        // `'static` per the `StoreStr` convention (arena ownership, bulk-freed
        // on scope drop — callers must not hold it past that boundary). This is
        // lifetime erasure, not a value cast, so no safe `bytemuck`/`as`
        // equivalent exists.
        return unsafe {
            let dup: *const [u8] = (*ov).alloc_slice_copy(bytes);
            &*dup
        };
    }
    // No override arena: allocate in the thread-local AST heap (`AstAlloc`),
    // which is reset alongside the Expr/Stmt stores. `AstAlloc` is a `'static`
    // ZST, so `Vec::leak` already yields `&'static mut [u8]` — no `transmute`
    // needed. Storage lives until `store_ast_alloc_heap::reset()`; callers must
    // not hold the slice across that boundary (same contract as every
    // `StoreRef`/`StoreStr`).
    let mut v: Vec<u8, bun_alloc::AstAlloc> = bun_alloc::AstAlloc::vec();
    v.extend_from_slice(bytes);
    v.leak()
}

/// RAII scope for [`store_ast_alloc_heap`]: `enter()` on construction,
/// `reset()` via [`Self::reset`], `exit()` on drop.
#[must_use = "side-arena heap lives until this guard drops"]
pub struct StoreAstAllocHeap(());
impl StoreAstAllocHeap {
    #[inline]
    pub fn new() -> Self {
        store_ast_alloc_heap::enter();
        Self(())
    }
    #[inline]
    pub fn reset(&self) {
        store_ast_alloc_heap::reset();
    }
}
impl Drop for StoreAstAllocHeap {
    #[inline]
    fn drop(&mut self) {
        store_ast_alloc_heap::exit();
    }
}

/// RAII guard that resets the thread-local `Stmt.Data.Store` and
/// `Expr.Data.Store` slabs on scope exit.
#[must_use = "store reset runs on drop; bind to a named local"]
pub struct StoreResetGuard(());
impl StoreResetGuard {
    #[inline]
    pub fn new() -> Self {
        Self(())
    }
}
impl Drop for StoreResetGuard {
    #[inline]
    fn drop(&mut self) {
        stmt::data::Store::reset();
        expr::data::Store::reset();
    }
}

/// Idempotently create both thread-local AST node stores (`Expr.Data.Store`
/// + `Stmt.Data.Store`). Safe to call repeatedly — `Store::create()` is a
/// no-op once the slab (or an `ASTMemoryAllocator` override) is installed,
/// so no `Once` guard is needed (and a process-global `Once` would be wrong
/// anyway: the backing `INSTANCE` is `#[thread_local]`).
#[inline]
pub fn initialize_store() {
    expr::data::Store::create();
    stmt::data::Store::create();
}

/// Create both AST node stores on first call, **reset** them on every
/// subsequent call. Maps to `Store::begin()` (create-or-reset) on each
/// slab, so callers that re-enter — e.g. the install pipeline parsing many
/// `package.json`s — get a fresh arena each time without re-allocating.
#[inline]
pub fn initialize_store_or_reset() {
    expr::data::Store::begin();
    stmt::data::Store::begin();
}

/// RAII guard that pins the thread-local `disable_reset` flag on both AST
/// `Store`s for its scope.
#[must_use = "disable_reset is cleared on drop; bind to a named local"]
pub struct DisableStoreReset(());
impl DisableStoreReset {
    #[inline]
    pub fn new() -> Self {
        expr::data::Store::set_disable_reset(true);
        stmt::data::Store::set_disable_reset(true);
        Self(())
    }
}
impl Drop for DisableStoreReset {
    #[inline]
    fn drop(&mut self) {
        expr::data::Store::set_disable_reset(false);
        stmt::data::Store::set_disable_reset(false);
    }
}

#[cfg(test)]
mod range_of_identifier_tests {
    use super::*;

    fn len_of(src: &[u8]) -> i32 {
        range_of_identifier(src, Loc { start: 0 }).len
    }

    #[test]
    fn terminated_identifier() {
        assert_eq!(len_of(b"foo = 1"), 3);
        assert_eq!(len_of(b"x;"), 1);
    }

    #[test]
    fn identifier_at_eof_includes_last_codepoint() {
        assert_eq!(len_of(b"foo"), 3);
        assert_eq!(len_of(b"x"), 1);
        // Multibyte final codepoint: 'é' is 2 bytes.
        assert_eq!(len_of("aé".as_bytes()), 3);
    }

    #[test]
    fn private_names() {
        assert_eq!(len_of(b"#"), 1);
        assert_eq!(len_of(b"#foo = 1"), 4);
        assert_eq!(len_of(b"#foo"), 4);
    }

    #[test]
    fn bracketed_escape_does_not_swallow_terminator() {
        // `a\u{41}` is 7 bytes; the `.` must terminate the range.
        assert_eq!(len_of(b"a\\u{41}.x"), 7);
        assert_eq!(len_of(b"a\\u{41} = 1"), 7);
    }

    #[test]
    fn leading_bracketed_escape() {
        assert_eq!(len_of(b"\\u{61}bc = 1"), 8);
        assert_eq!(len_of(b"\\u{61}"), 6);
    }

    #[test]
    fn non_identifier_start() {
        assert_eq!(len_of(b"1abc"), 0);
        assert_eq!(len_of(b" foo"), 0);
    }
}

#[cfg(test)]
mod line_column_tracker_tests {
    use super::*;

    fn check_corpus_entry(contents: &[u8]) {
        let source = Source::init_path_string(b"tracker-test.js" as &[u8], contents);
        let len = contents.len();

        // Non-decreasing offsets (the parser/lexer pattern): every result must
        // match a from-scratch scan.
        let mut tracker = LineColumnTracker::default();
        for offset in 0..len.max(1) {
            let loc = usize2loc(offset);
            let expected = source.init_error_position(loc);
            let got = tracker.error_position(&source, loc);
            assert_eq!(
                (
                    expected.line_start,
                    expected.line_end,
                    expected.line_count,
                    expected.column_count
                ),
                (
                    got.line_start,
                    got.line_end,
                    got.line_count,
                    got.column_count
                ),
                "forward scan diverged at offset {offset} of {contents:?}"
            );
        }

        // Repeated, backwards, and strided offsets against a reused tracker.
        let mut tracker = LineColumnTracker::default();
        let mut offsets: Vec<usize> = (0..len.max(1)).step_by(3).collect();
        offsets.extend((0..len.max(1)).rev().step_by(7));
        offsets.extend([0, len.max(1) - 1, 0, len / 2, len / 2]);
        for offset in offsets {
            let loc = usize2loc(offset);
            let expected = source.init_error_position(loc);
            let got = tracker.error_position(&source, loc);
            assert_eq!(
                (
                    expected.line_start,
                    expected.line_end,
                    expected.line_count,
                    expected.column_count
                ),
                (
                    got.line_start,
                    got.line_end,
                    got.line_count,
                    got.column_count
                ),
                "mixed-order scan diverged at offset {offset} of {contents:?}"
            );
        }
    }

    #[test]
    fn line_column_tracker_matches_full_scan() {
        let corpus: &[&[u8]] = &[
            b"",
            b"x",
            b"hello world, no newline at all but a reasonably long single line of text",
            b"line one\nline two\nline three\n",
            b"crlf one\r\ncrlf two\r\nno trailing",
            b"lone\rcarriage\rreturns\r",
            b"\n\n\n\n",
            b"\r\n\r\n\r\r\n\n",
            "unicode \u{2028} separator \u{2029} and emoji \u{1F600}\u{1F600} plus \u{00E9}\u{4E2D}\u{6587}\nsecond line \u{00E9}\n".as_bytes(),
            b"mixed\ninvalid \xff\xfe bytes \x80 here\r\nlast line",
            b"[{\"\":[{\"\":[{\"\":[{\"\":[{\"\":[{\"\":[{\"\":[{\"\":[{\"\":[{\"\":",
        ];
        for contents in corpus {
            check_corpus_entry(contents);
        }
    }

    #[test]
    fn line_column_tracker_interleaved_diagnostic_streams_match_full_scan() {
        let statement = b"try {} catch ([a,a,a,a,a,a,a,a,a,a,a,a, `]) {}\n";
        let mut contents = Vec::new();
        for _ in 0..12 {
            contents.extend_from_slice(statement);
        }
        let source = Source::init_path_string(b"tracker-test.js" as &[u8], contents.as_slice());

        let mut offsets = Vec::new();
        for statement_index in 0..12usize {
            let start = statement_index * statement.len();
            let first_binding = start + 15;
            offsets.push(start + statement.len() - 6);
            for duplicate in 1..12usize {
                offsets.push(first_binding);
                offsets.push(first_binding + duplicate * 2);
            }
        }

        let mut tracker = LineColumnTracker::default();
        for offset in offsets {
            let loc = usize2loc(offset);
            let expected = source.init_error_position(loc);
            let got = tracker.error_position(&source, loc);
            assert_eq!(
                (
                    expected.line_start,
                    expected.line_end,
                    expected.line_count,
                    expected.column_count
                ),
                (
                    got.line_start,
                    got.line_end,
                    got.line_count,
                    got.column_count
                ),
                "interleaved scan diverged at offset {offset}"
            );
        }
    }

    #[test]
    fn line_column_tracker_resets_for_a_different_source() {
        let a = Source::init_path_string(b"a.js" as &[u8], b"first\nsource\nhere" as &[u8]);
        let b = Source::init_path_string(
            b"b.js" as &[u8],
            b"a totally different\r\nsecond source\r\nwith more lines\r\n" as &[u8],
        );

        let mut tracker = LineColumnTracker::default();
        for (source, offset) in [
            (&a, 8usize),
            (&b, 30),
            (&a, 10),
            (&b, 40),
            (&b, 45),
            (&a, 2),
        ] {
            let loc = usize2loc(offset);
            let expected = source.init_error_position(loc);
            let got = tracker.error_position(source, loc);
            assert_eq!(
                (
                    expected.line_start,
                    expected.line_end,
                    expected.line_count,
                    expected.column_count
                ),
                (
                    got.line_start,
                    got.line_end,
                    got.line_count,
                    got.column_count
                ),
                "diverged at offset {offset} of {:?}",
                bstr::BStr::new(source.contents())
            );
        }
    }

    #[test]
    fn error_position_counts_utf16_columns() {
        // `]` sits at UTF-16 unit index 18 (1-based col 19); the two U+1F600
        // take two UTF-16 units each. Previously columns counted codepoints
        // and this returned 17.
        let src = "const a = \"\u{1F600}\u{1F600}\"; ]".as_bytes();
        let source = Source::init_path_string(b"t.js" as &[u8], src);
        let pos = source.init_error_position(usize2loc(src.len() - 1));
        assert_eq!(pos.column_count, 19);

        // BMP-only control: `é` is one UTF-16 unit, so astral vs BMP lines
        // with the same layout must agree.
        let bmp = "const a = \"\u{00E9}\u{00E9}\u{00E9}\u{00E9}\"; ]".as_bytes();
        let bmp_source = Source::init_path_string(b"t.js" as &[u8], bmp);
        let bmp_pos = bmp_source.init_error_position(usize2loc(bmp.len() - 1));
        assert_eq!(bmp_pos.column_count, 19);
    }
}

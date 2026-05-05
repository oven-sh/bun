//! Port of `src/js_parser/js_parser.zig`.
//!
//! NOTE on arena slices: this is the AST crate. Nearly every `[]const u8` /
//! `[]T` struct field in the Zig points into either the source text or the
//! parser arena and is bulk-freed at end-of-parse. Per PORTING.md, Phase A
//! does **not** add lifetime params to structs; arena-owned slices are typed
//! as raw `*const [T]` / `*mut [T]` here. Phase B threads a crate-wide
//! `'bump` and rewrites these to `&'bump [T]` / `&'bump mut [T]`.

use core::fmt;

use bun_collections::{ArrayHashMap, BabyList, MultiArrayList, StringHashMap};
use bun_core::Output;
use bun_logger as logger;

// ─── re-exports (see bottom-of-file `@import` block in the .zig) ────────────
// Zig file-structs `@import("./ast/Foo.zig")` become `pub use` of the module's
// primary type. Module path segments are snake_cased per PORTING.md.
// TODO(port): verify module names once ast/*.rs land in Phase B.
//
// TODO(b1): the real `ast/` and `parser` modules are gated behind `#[cfg(any())]`
// until B-2 un-gating. The Phase-A draft bodies are preserved on disk in
// `src/js_parser/ast/*.rs` and `src/js_parser/parser.rs`; an inline stub
// `pub mod ast { … }` below exposes the minimal opaque type surface needed
// for the rest of this file to type-check.
#[cfg(any())]
pub mod ast;
#[cfg(any())]
pub mod parser;
#[cfg(any())]
#[path = "lexer.rs"]
pub mod lexer;
#[cfg(any())]
#[path = "lexer_tables.rs"]
pub mod lexer_tables;
#[cfg(any())]
#[path = "runtime.rs"]
pub mod runtime;

/// B-1 stub surface for `ast/*`. Every type is opaque; methods `todo!()`.
/// Real Phase-A drafts live in `src/js_parser/ast/*.rs` (gated above).
#[cfg(not(any()))]
#[allow(non_snake_case, dead_code)]
pub mod ast {
    pub mod base {
        #[derive(Copy, Clone, Hash, PartialEq, Eq, Default, Debug)]
        pub struct Ref(pub u64);
        impl Ref {
            pub const NONE: Ref = Ref(u64::MAX);
            pub fn inner_index(self) -> u32 { todo!("b1-stub") }
        }
        #[derive(Copy, Clone, Default, Debug)]
        pub struct RefCtx;
        #[derive(Copy, Clone, Default, Debug)]
        pub struct RefFields;
        #[derive(Copy, Clone, Default, Debug)]
        pub struct RefHashCtx;
        #[derive(Copy, Clone, Default, Debug)]
        pub struct RefTag;

        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        pub struct Index(pub u32);
        impl Index {
            pub const INVALID: Index = Index(u32::MAX);
            pub fn get(self) -> u32 { self.0 }
        }
        pub trait IndexExt { type Int; }
        impl IndexExt for Index { type Int = u32; }
    }
    pub mod ast_memory_allocator { #[derive(Default)] pub struct ASTMemoryAllocator; }
    pub mod ast { #[derive(Default)] pub struct Ast; }
    pub mod binding { #[derive(Copy, Clone, Default)] pub struct Binding; }
    pub mod bundled_ast { #[derive(Default)] pub struct BundledAst; }
    pub mod expr {
        #[derive(Copy, Clone, Default)]
        pub struct Expr;
        #[derive(Copy, Clone)]
        pub struct Data; // opaque tag — real variant set lives in ast/Expr.rs
    }
    pub mod stmt {
        #[derive(Copy, Clone, Default)]
        pub struct Stmt;
        #[derive(Copy, Clone)]
        pub struct Data; // opaque tag — real variant set lives in ast/Stmt.rs
    }
    pub mod scope { #[derive(Default)] pub struct Scope; }
    pub mod server_component_boundary { #[derive(Default)] pub struct ServerComponentBoundary; }
    pub mod symbol {
        #[derive(Copy, Clone, Default)]
        pub struct Symbol;
        #[derive(Copy, Clone, Default)]
        pub struct Use;
        #[derive(Copy, Clone, Default)]
        pub struct SlotNamespace;
        pub const INVALID_NESTED_SCOPE_SLOT: u32 = u32::MAX;
        /// Stub for `std.EnumArray(SlotNamespace, u32)`.
        #[derive(Clone, Default)]
        pub struct SlotNamespaceCountsArray(pub [u32; 4]);
        impl SlotNamespaceCountsArray {
            pub fn init_fill(v: u32) -> Self { Self([v; 4]) }
            pub fn values(&self) -> core::slice::Iter<'_, u32> { self.0.iter() }
            pub fn values_mut(&mut self) -> core::slice::IterMut<'_, u32> { self.0.iter_mut() }
        }
    }
    pub mod b { #[derive(Copy, Clone, Default)] pub struct B; }
    pub mod new_store { #[derive(Default)] pub struct NewStore; }
    pub mod use_directive { #[derive(Copy, Clone, Default)] pub struct UseDirective; }
    pub mod char_freq { pub const CHAR_FREQ_COUNT: usize = 64; }
    pub mod ts {
        #[derive(Default)] pub struct TSNamespaceMember;
        #[derive(Default)] pub struct TSNamespaceMemberMap;
        #[derive(Default)] pub struct TSNamespaceScope;
    }
    pub mod e {
        #[derive(Copy, Clone, Default)] pub struct String;
        #[derive(Copy, Clone, Default)] pub struct Undefined;
        #[derive(Copy, Clone, Default)] pub struct Identifier;
        #[derive(Copy, Clone, Default)] pub struct Function;
    }
    pub mod g {}
    pub mod op {}
    pub mod s {}
}

pub use crate::ast::ast_memory_allocator::ASTMemoryAllocator;
pub use crate::ast::ast::Ast;
pub use crate::ast::binding::Binding;
pub type BindingNodeIndex = Binding;
pub use crate::ast::bundled_ast::BundledAst;
pub use crate::ast::e as E;
pub use crate::ast::expr::Expr;
pub type ExprNodeIndex = Expr;
pub use crate::ast::g as G;
// `pub const Macro = @import("../js_parser_jsc/Macro.zig");` — *_jsc alias → DELETED (PORTING.md §Idiom map)
pub use crate::ast::op as Op;
pub use crate::ast::s as S;
pub use crate::ast::scope::Scope;
pub use crate::ast::server_component_boundary::ServerComponentBoundary;
pub use crate::ast::stmt::Stmt;
pub type StmtNodeIndex = Stmt;
pub use crate::ast::symbol::Symbol;
pub use crate::ast::b::B;
pub use crate::ast::new_store::NewStore;
pub use crate::ast::use_directive::UseDirective;

pub use crate::ast::char_freq as CharFreq;
use crate::ast::char_freq::CHAR_FREQ_COUNT;

pub use crate::ast::ts as TS;
pub use crate::ast::ts::{TSNamespaceMember, TSNamespaceMemberMap, TSNamespaceScope};

pub use crate::ast::base::{Index, Ref, RefCtx, RefFields, RefHashCtx, RefTag};

pub use bun_collections::BabyList as BabyListAlias; // `pub const BabyList = bun.BabyList;`
// TODO(port): Zig re-exports BabyList under the same name; Rust can't shadow
// the `use` above. Callers should use `bun_collections::BabyList` directly.

use crate::ast::symbol; // for symbol::Use, symbol::SlotNamespace

// ─── arena-slice helpers (Phase-A raw-pointer stand-ins for &'bump [T]) ─────
// TODO(port): replace with &'bump [u8] / &'bump mut [T] in Phase B.
type ArenaStr = *const [u8];
#[inline]
const fn empty_arena_str() -> ArenaStr {
    core::ptr::slice_from_raw_parts(core::ptr::NonNull::<u8>::dangling().as_ptr(), 0)
}
#[inline]
const fn empty_arena_slice_mut<T>() -> *mut [T] {
    core::ptr::slice_from_raw_parts_mut(core::ptr::NonNull::<T>::dangling().as_ptr(), 0)
}

// ─────────────────────────────────────────────────────────────────────────────

/// This is the index to the automatically-generated part containing code that
/// calls "__export(exports, { ... getters ... })". This is used to generate
/// getters on an exports object for ES6 export statements, and is both for
/// ES6 star imports and CommonJS-style modules. All files have one of these,
/// although it may contain no statements if there is nothing to export.
pub const NAMESPACE_EXPORT_PART_INDEX: u32 = 0;

// There are three types.
// 1. Expr (expression)
// 2. Stmt (statement)
// 3. Binding
// Q: "What's the difference between an expression and a statement?"
// A:  > Expression: Something which evaluates to a value. Example: 1+2/x
//     > Statement: A line of code which does something. Example: GOTO 100
//     > https://stackoverflow.com/questions/19132/expression-versus-statement/19224#19224

// Expr, Binding, and Stmt each wrap a Data:
// Data is where the actual data where the node lives.
// There are four possible versions of this structure:
// [ ] 1.  *Expr, *Stmt, *Binding
// [ ] 1a. *Expr, *Stmt, *Binding something something dynamic dispatch
// [ ] 2.  *Data
// [x] 3.  Data.(*) (The union value in Data is a pointer)
// I chose #3 mostly for code simplification -- sometimes, the data is modified in-place.
// But also it uses the least memory.
// Since Data is a union, the size in bytes of Data is the max of all types
// So with #1 or #2, if S.Function consumes 768 bits, that means Data must be >= 768 bits
// Which means "true" in code now takes up over 768 bits, probably more than what v8 spends
// Instead, this approach means Data is the size of a pointer.
// It's not really clear which approach is best without benchmarking it.
// The downside with this approach is potentially worse memory locality, since the data for the node is somewhere else.
// But it could also be better memory locality due to smaller in-memory size (more likely to hit the cache)
// only benchmarks will provide an answer!
// But we must have pointers somewhere in here because can't have types that contain themselves

/// Slice that stores capacity and length in the same space as a regular slice.
pub type ExprNodeList = BabyList<Expr>;

// TODO(port): &'bump mut [Stmt] / &'bump mut [Binding] once 'bump is threaded.
pub type StmtNodeList = *mut [Stmt];
pub type BindingNodeList = *mut [Binding];

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ImportItemStatus {
    None,
    /// The linker doesn't report import/export mismatch errors
    Generated,
    /// The printer will replace this import with "undefined"
    Missing,
}

impl ImportItemStatus {
    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum AssignTarget {
    None = 0,
    /// "a = b"
    Replace = 1,
    /// "a += b"
    Update = 2,
}

impl AssignTarget {
    // TODO(port): narrow error set
    pub fn json_stringify(&self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(*self))
    }
}

#[derive(Copy, Clone)]
pub struct LocRef {
    pub loc: logger::Loc,

    // TODO: remove this optional and make Ref a function getter
    // That will make this struct 128 bits instead of 192 bits and we can remove some heap allocations
    pub ref_: Option<Ref>,
}

impl Default for LocRef {
    fn default() -> Self {
        Self { loc: logger::Loc::EMPTY, ref_: None }
    }
}

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
    // Zig `Fields = std.enums.EnumFieldStruct(Property, bool, false)` + `init(fields)`:
    // in Rust, construct directly via `Property::IsComputed | Property::IsMethod` etc.
    // TODO(port): if many call sites use the struct-init form, add a builder macro.

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
    }
    pub type FunctionSet = EnumSet<Function>;
    pub const FUNCTION_NONE: FunctionSet = EnumSet::empty();
}
pub use flags as Flags;

pub struct ClauseItem {
    /// The local alias used for the imported/exported symbol in the current module.
    /// For imports: `import { foo as bar }` - "bar" is the alias
    /// For exports: `export { foo as bar }` - "bar" is the alias
    /// For re-exports: `export { foo as bar } from 'path'` - "bar" is the alias
    pub alias: ArenaStr,
    pub alias_loc: logger::Loc,
    /// Reference to the actual symbol being imported/exported.
    /// For imports: `import { foo as bar }` - ref to the symbol representing "foo" from the source module
    /// For exports: `export { foo as bar }` - ref to the local symbol "foo"
    /// For re-exports: `export { foo as bar } from 'path'` - ref to an intermediate symbol
    pub name: LocRef,

    /// This is the original name of the symbol stored in "Name". It's needed for
    /// "SExportClause" statements such as this:
    ///
    ///   export {foo as bar} from 'path'
    ///
    /// In this case both "foo" and "bar" are aliases because it's a re-export.
    /// We need to preserve both aliases in case the symbol is renamed. In this
    /// example, "foo" is "OriginalName" and "bar" is "Alias".
    pub original_name: ArenaStr,
}

impl ClauseItem {
    pub const DEFAULT_ALIAS: &'static [u8] = b"default";
}

impl Default for ClauseItem {
    fn default() -> Self {
        Self {
            alias: empty_arena_str(),
            alias_loc: logger::Loc::EMPTY,
            name: LocRef::default(),
            original_name: empty_arena_str(),
        }
    }
}

#[derive(Clone)]
pub struct SlotCounts {
    pub slots: symbol::SlotNamespaceCountsArray,
}

impl Default for SlotCounts {
    fn default() -> Self {
        Self { slots: symbol::SlotNamespaceCountsArray::init_fill(0) }
    }
}

impl SlotCounts {
    pub fn union_max(&mut self, other: SlotCounts) {
        // TODO(port): `enum_map::EnumMap` exposes `.values()`; the Zig iterates raw arrays.
        for (a, b) in self.slots.values_mut().zip(other.slots.values()) {
            if *a < *b {
                *a = *b;
            }
        }
    }
}

pub struct NameMinifier {
    pub head: Vec<u8>,
    pub tail: Vec<u8>,
}

impl NameMinifier {
    pub const DEFAULT_HEAD: &'static [u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
    pub const DEFAULT_TAIL: &'static [u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";

    pub fn init() -> NameMinifier {
        NameMinifier { head: Vec::new(), tail: Vec::new() }
    }

    pub fn number_to_minified_name(
        &mut self,
        name: &mut Vec<u8>,
        i_: isize,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        name.clear();
        let mut i = i_;
        let mut j = usize::try_from(i.rem_euclid(54)).unwrap();
        name.extend_from_slice(&self.head[j..j + 1]);
        i = i.div_euclid(54);

        while i > 0 {
            i -= 1;
            j = usize::try_from(i.rem_euclid(CHAR_FREQ_COUNT as isize)).unwrap();
            name.extend_from_slice(&self.tail[j..j + 1]);
            i = i.div_euclid(CHAR_FREQ_COUNT as isize);
        }
        Ok(())
    }

    pub fn default_number_to_minified_name(i_: isize) -> core::result::Result<Vec<u8>, bun_alloc::AllocError> {
        let mut i = i_;
        let mut j = usize::try_from(i.rem_euclid(54)).unwrap();
        let mut name: Vec<u8> = Vec::new();
        name.extend_from_slice(&Self::DEFAULT_HEAD[j..j + 1]);
        i = i.div_euclid(54);

        while i > 0 {
            i -= 1;
            j = usize::try_from(i.rem_euclid(CHAR_FREQ_COUNT as isize)).unwrap();
            name.extend_from_slice(&Self::DEFAULT_TAIL[j..j + 1]);
            i = i.div_euclid(CHAR_FREQ_COUNT as isize);
        }

        Ok(name)
    }
}

#[repr(u8)] // Zig: enum(u1)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum OptionalChain {
    /// "a?.b"
    Start,

    /// "a?.b.c" => ".c" is OptionalChain::Continuation
    /// "(a?.b).c" => ".c" is None
    Continuation,
}

impl OptionalChain {
    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

pub struct EnumValue {
    pub loc: logger::Loc,
    pub ref_: Ref,
    pub name: ArenaStr,
    pub value: Option<ExprNodeIndex>,
}

impl EnumValue {
    pub fn name_as_e_string(&self, bump: &bun_alloc::Arena) -> E::String {
        #[cfg(any())]
        {
            // SAFETY: `name` is a valid arena slice for the lifetime of the parse.
            let name = unsafe { &*self.name };
            E::String::init_re_encode_utf8(name, bump)
        }
        #[cfg(not(any()))]
        {
            let _ = bump;
            todo!("b1-stub: EnumValue::name_as_e_string")
        }
    }
}

pub struct Catch {
    pub loc: logger::Loc,
    pub binding: Option<BindingNodeIndex>,
    pub body: StmtNodeList,
    pub body_loc: logger::Loc,
}

pub struct Finally {
    pub loc: logger::Loc,
    pub stmts: StmtNodeList,
}

pub struct Case {
    pub loc: logger::Loc,
    pub value: Option<ExprNodeIndex>,
    pub body: StmtNodeList,
}

pub struct ArrayBinding {
    pub binding: BindingNodeIndex,
    pub default_value: Option<ExprNodeIndex>,
}

/// TLA => Top Level Await
#[derive(Copy, Clone)]
pub struct TlaCheck {
    pub depth: u32,
    pub parent: <Index as crate::ast::base::IndexExt>::Int, // Index.Int
    pub import_record_index: <Index as crate::ast::base::IndexExt>::Int,
}
// TODO(port): `Index.Int` — assumed associated type/alias on Index; adjust to concrete `u32` if simpler.

impl Default for TlaCheck {
    fn default() -> Self {
        Self {
            depth: 0,
            parent: Index::INVALID.get(),
            import_record_index: Index::INVALID.get(),
        }
    }
}

pub struct Span {
    pub text: ArenaStr,
    pub range: logger::Range,
}

impl Default for Span {
    fn default() -> Self {
        Self { text: empty_arena_str(), range: logger::Range::default() }
    }
}

/// Inlined enum values can only be numbers and strings
/// This type special cases an encoding similar to JSValue, where nan-boxing is used
/// to encode both a 64-bit pointer or a 64-bit float using 64 bits.
#[derive(Copy, Clone)]
pub struct InlinedEnumValue {
    pub raw_data: u64,
}

#[derive(Copy, Clone)]
pub enum InlinedEnumValueDecoded {
    // LIFETIMES.tsv: ARENA → *const e::String
    String(*const E::String),
    Number(f64),
}

impl InlinedEnumValue {
    /// See JSCJSValue.h in WebKit for more details
    const DOUBLE_ENCODE_OFFSET: u64 = 1 << 49;
    /// See PureNaN.h in WebKit for more details
    const PURE_NAN: f64 = f64::from_bits(0x7ff8000000000000);

    fn purify_nan(value: f64) -> f64 {
        if value.is_nan() { Self::PURE_NAN } else { value }
    }

    pub fn encode(decoded: InlinedEnumValueDecoded) -> InlinedEnumValue {
        let encoded = InlinedEnumValue {
            raw_data: match decoded {
                InlinedEnumValueDecoded::String(ptr) => (ptr as usize as u64) & 0x0000_FFFF_FFFF_FFFF, // @truncate to u48
                InlinedEnumValueDecoded::Number(num) => {
                    Self::purify_nan(num).to_bits() + Self::DOUBLE_ENCODE_OFFSET
                }
            },
        };
        if cfg!(debug_assertions) {
            debug_assert!(match encoded.decode() {
                InlinedEnumValueDecoded::String(str_) => match decoded {
                    InlinedEnumValueDecoded::String(orig) => core::ptr::eq(str_, orig),
                    _ => false,
                },
                InlinedEnumValueDecoded::Number(num) => match decoded {
                    InlinedEnumValueDecoded::Number(orig) =>
                        num.to_bits() == Self::purify_nan(orig).to_bits(),
                    _ => false,
                },
            });
        }
        encoded
    }

    pub fn decode(self) -> InlinedEnumValueDecoded {
        if self.raw_data > 0x0000_FFFF_FFFF_FFFF {
            InlinedEnumValueDecoded::Number(f64::from_bits(self.raw_data - Self::DOUBLE_ENCODE_OFFSET))
        } else {
            // SAFETY: encoded from a valid arena `*const E::String` (see `encode`); low 48 bits hold the address.
            InlinedEnumValueDecoded::String(self.raw_data as usize as *const E::String)
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ExportsKind {
    // This file doesn't have any kind of export, so it's impossible to say what
    // kind of file this is. An empty file is in this category, for example.
    None,

    // The exports are stored on "module" and/or "exports". Calling "require()"
    // on this module returns "module.exports". All imports to this module are
    // allowed but may return undefined.
    Cjs,

    // All export names are known explicitly. Calling "require()" on this module
    // generates an exports object (stored in "exports") with getters for the
    // export names. Named imports to this module are only allowed if they are
    // in the set of export names.
    Esm,

    // Some export names are known explicitly, but others fall back to a dynamic
    // run-time object. This is necessary when using the "export * from" syntax
    // with either a CommonJS module or an external module (i.e. a module whose
    // export names are not known at compile-time).
    //
    // Calling "require()" on this module generates an exports object (stored in
    // "exports") with getters for the export names. All named imports to this
    // module are allowed. Direct named imports reference the corresponding export
    // directly. Other imports go through property accesses on "exports".
    EsmWithDynamicFallback,

    // Like "EsmWithDynamicFallback", but the module was originally a CommonJS
    // module.
    EsmWithDynamicFallbackFromCjs,
}

impl ExportsKind {
    pub fn is_dynamic(self) -> bool {
        matches!(
            self,
            Self::Cjs | Self::EsmWithDynamicFallback | Self::EsmWithDynamicFallbackFromCjs
        )
    }

    pub fn is_esm_with_dynamic_fallback(self) -> bool {
        matches!(self, Self::EsmWithDynamicFallback | Self::EsmWithDynamicFallbackFromCjs)
    }

    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }

    pub fn to_module_type(self) -> bun_options_types::BundleEnums::ModuleType {
        use bun_options_types::BundleEnums::ModuleType;
        #[cfg(any())]
        {
            match self {
                Self::None => ModuleType::Unknown,
                Self::Cjs => ModuleType::Cjs,
                Self::EsmWithDynamicFallback
                | Self::EsmWithDynamicFallbackFromCjs
                | Self::Esm => ModuleType::Esm,
            }
        }
        // TODO(b1): bun_options_types::BundleEnums::ModuleType variants missing.
        #[cfg(not(any()))]
        { let _ = self; let _: ModuleType; todo!("b1-stub: ExportsKind::to_module_type") }
    }
}

#[derive(Copy, Clone)]
pub struct DeclaredSymbol {
    pub ref_: Ref,
    pub is_top_level: bool,
}

pub struct DeclaredSymbolList {
    pub entries: MultiArrayList<DeclaredSymbol>,
}

impl Default for DeclaredSymbolList {
    fn default() -> Self {
        // TODO(b1): bun_collections::MultiArrayList missing Default impl.
        todo!("b1-stub: DeclaredSymbolList::default")
    }
}

// TODO(b1): bun_collections::MultiArrayList stub surface lacks
// items_ref/clone/len/append_*/ensure_*/clear_*/slice. Preserve draft body.
#[cfg(any())]
impl DeclaredSymbolList {
    pub fn refs(&self) -> &[Ref] {
        // TODO(port): MultiArrayList column accessor name (`items(.ref)` in Zig).
        self.entries.items_ref()
    }

    pub fn to_owned_slice(&mut self) -> DeclaredSymbolList {
        core::mem::take(self)
    }

    pub fn clone(&self) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        Ok(DeclaredSymbolList { entries: self.entries.clone() })
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn append(&mut self, entry: DeclaredSymbol) -> core::result::Result<(), bun_alloc::AllocError> {
        self.ensure_unused_capacity(1)?;
        self.append_assume_capacity(entry);
        Ok(())
    }

    pub fn append_list(&mut self, other: DeclaredSymbolList) -> core::result::Result<(), bun_alloc::AllocError> {
        self.ensure_unused_capacity(other.len())?;
        self.append_list_assume_capacity(other);
        Ok(())
    }

    pub fn append_list_assume_capacity(&mut self, other: DeclaredSymbolList) {
        // PERF(port): was assume_capacity
        self.entries.append_list_assume_capacity(other.entries);
    }

    pub fn append_assume_capacity(&mut self, entry: DeclaredSymbol) {
        // PERF(port): was assume_capacity
        self.entries.append_assume_capacity(entry);
    }

    pub fn ensure_total_capacity(&mut self, count: usize) -> core::result::Result<(), bun_alloc::AllocError> {
        self.entries.ensure_total_capacity(count)
    }

    pub fn ensure_unused_capacity(&mut self, count: usize) -> core::result::Result<(), bun_alloc::AllocError> {
        self.entries.ensure_unused_capacity(count)
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.entries.clear_retaining_capacity();
    }

    // `deinit` → Drop on MultiArrayList; no explicit body needed.

    pub fn init_capacity(capacity: usize) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        let mut entries = MultiArrayList::<DeclaredSymbol>::default();
        entries.ensure_unused_capacity(capacity)?;
        Ok(DeclaredSymbolList { entries })
    }

    pub fn from_slice(entries: &[DeclaredSymbol]) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        let mut this = Self::init_capacity(entries.len())?;
        // errdefer this.deinit() → Drop handles it
        for entry in entries {
            this.append_assume_capacity(*entry);
        }
        Ok(this)
    }
}
// TODO(port): allocator threading — Zig passes `std.mem.Allocator` to every
// MultiArrayList op. bun_collections::MultiArrayList owns its allocator (global
// mimalloc); if Phase B needs arena-backed SoA storage, add a `&'bump Bump`
// param here.

impl DeclaredSymbol {
    fn for_each_top_level_symbol_with_type<C>(
        decls: &mut DeclaredSymbolList,
        ctx: &mut C,
        f: impl Fn(&mut C, Ref),
    ) {
        #[cfg(any())]
        {
            let entries = decls.entries.slice();
            let is_top_level = entries.items_is_top_level();
            let refs = entries.items_ref();

            // TODO: SIMD
            debug_assert_eq!(is_top_level.len(), refs.len());
            for (top, ref_) in is_top_level.iter().zip(refs.iter()) {
                if *top {
                    // PERF(port): was @call(bun.callmod_inline, ...) — relies on inlining.
                    f(ctx, *ref_);
                }
            }
        }
        #[cfg(not(any()))]
        { let _ = (decls, ctx, f); todo!("b1-stub") }
    }

    pub fn for_each_top_level_symbol<C>(
        decls: &mut DeclaredSymbolList,
        ctx: &mut C,
        f: impl Fn(&mut C, Ref),
    ) {
        Self::for_each_top_level_symbol_with_type(decls, ctx, f);
    }
}

#[derive(Copy, Clone)]
pub struct Dependency {
    pub source_index: Index,
    pub part_index: u32, // Index.Int
}

impl Default for Dependency {
    fn default() -> Self {
        Self { source_index: Index::INVALID, part_index: 0 }
    }
}

pub type DependencyList = BabyList<Dependency>;

pub type ExprList = Vec<Expr>;
pub type StmtList = Vec<Stmt>;
pub type BindingList = Vec<Binding>;
// PERF(port): Zig `std.array_list.Managed` — these may be arena-backed in
// callers; revisit with bumpalo::collections::Vec if profiling shows churn.

/// Each file is made up of multiple parts, and each part consists of one or
/// more top-level statements. Parts are used for tree shaking and code
/// splitting analysis. Individual parts of a file can be discarded by tree
/// shaking and can be assigned to separate chunks (i.e. output files) by code
/// splitting.
pub struct Part {
    pub stmts: *mut [Stmt],   // TODO(port): &'bump mut [Stmt]
    pub scopes: *mut [*mut Scope], // TODO(port): &'bump mut [&'bump mut Scope]

    /// Each is an index into the file-level import record list
    pub import_record_indices: PartImportRecordIndices,

    /// All symbols that are declared in this part. Note that a given symbol may
    /// have multiple declarations, and so may end up being declared in multiple
    /// parts (e.g. multiple "var" declarations with the same name). Also note
    /// that this list isn't deduplicated and may contain duplicates.
    pub declared_symbols: DeclaredSymbolList,

    /// An estimate of the number of uses of all symbols used within this part.
    pub symbol_uses: PartSymbolUseMap,

    /// This tracks property accesses off of imported symbols. We don't know
    /// during parsing if an imported symbol is going to be an inlined enum
    /// value or not. This is only known during linking. So we defer adding
    /// a dependency on these imported symbols until we know whether the
    /// property access is an inlined enum value or not.
    pub import_symbol_property_uses: PartSymbolPropertyUseMap,

    /// The indices of the other parts in this file that are needed if this part
    /// is needed.
    pub dependencies: DependencyList,

    /// If true, this part can be removed if none of the declared symbols are
    /// used. If the file containing this part is imported, then all parts that
    /// don't have this flag enabled must be included.
    pub can_be_removed_if_unused: bool,

    /// This is used for generated parts that we don't want to be present if they
    /// aren't needed. This enables tree shaking for these parts even if global
    /// tree shaking isn't enabled.
    pub force_tree_shaking: bool,

    /// This is true if this file has been marked as live by the tree shaking
    /// algorithm.
    pub is_live: bool,

    pub tag: PartTag,
}

pub type PartImportRecordIndices = BabyList<u32>;
pub type PartList = BabyList<Part>;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PartTag {
    None,
    JsxImport,
    Runtime,
    CjsImports,
    ReactFastRefresh,
    DirnameFilename,
    BunTest,
    DeadDueToInlining,
    CommonjsNamedExport,
    ImportToConvertFromRequire,
}

// Zig: std.ArrayHashMapUnmanaged(Ref, Symbol.Use, RefHashCtx, false)
// TODO(port): bun_collections::ArrayHashMap must accept a custom hasher ctx (RefHashCtx).
pub type PartSymbolUseMap = ArrayHashMap<Ref, symbol::Use>;
pub type PartSymbolPropertyUseMap = ArrayHashMap<Ref, StringHashMap<symbol::Use>>;

impl Default for Part {
    fn default() -> Self {
        #[cfg(any())]
        {
            Self {
                stmts: empty_arena_slice_mut::<Stmt>(),
                scopes: empty_arena_slice_mut::<*mut Scope>(),
                import_record_indices: PartImportRecordIndices::default(),
                declared_symbols: DeclaredSymbolList::default(),
                symbol_uses: PartSymbolUseMap::default(),
                import_symbol_property_uses: PartSymbolPropertyUseMap::default(),
                dependencies: DependencyList::default(),
                can_be_removed_if_unused: false,
                force_tree_shaking: false,
                is_live: false,
                tag: PartTag::None,
            }
        }
        // TODO(b1): bun_collections::BabyList missing Default impl.
        #[cfg(not(any()))]
        todo!("b1-stub: Part::default")
    }
}

impl Part {
    // TODO(port): narrow error set
    pub fn json_stringify(&self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        // SAFETY: `stmts` is a valid arena slice for the lifetime of the parse.
        writer.write(unsafe { &*self.stmts })
    }
}

// NOTE: shadows the prelude `Result` for this module — all error-union return
// types in this file are spelled `core::result::Result<T, E>` to disambiguate.
pub enum Result {
    AlreadyBundled(AlreadyBundled),
    Cached,
    Ast(Ast),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AlreadyBundled {
    Bun,
    BunCjs,
    Bytecode,
    BytecodeCjs,
}

pub enum StmtOrExpr {
    Stmt(Stmt),
    Expr(Expr),
}

impl StmtOrExpr {
    pub fn to_expr(self) -> Expr {
        #[cfg(any())]
        {
            match self {
                StmtOrExpr::Expr(expr) => expr,
                StmtOrExpr::Stmt(stmt) => match stmt.data {
                    crate::ast::stmt::Data::SFunction(s) => {
                        Expr::init(E::Function { func: s.func }, stmt.loc)
                    }
                    crate::ast::stmt::Data::SClass(s) => Expr::init_class(s.class, stmt.loc),
                    // TODO(port): Expr::init signature — Zig is `Expr.init(E.Function, .{...}, loc)`
                    // (comptime type + payload). Rust likely uses per-variant constructors.
                    other => Output::panic(format_args!(
                        "Unexpected statement type in default export: .{}",
                        <&'static str>::from(&other)
                    )),
                },
            }
        }
        #[cfg(not(any()))]
        {
            let _ = self;
            todo!("b1-stub: StmtOrExpr::to_expr")
        }
    }
}

pub struct NamedImport {
    /// Parts within this file that use this import
    pub local_parts_with_uses: BabyList<u32>,

    /// The original export name from the source module being imported.
    /// Examples:
    /// - `import { foo } from 'module'` → alias = "foo"
    /// - `import { foo as bar } from 'module'` → alias = "foo" (original export name)
    /// - `import * as ns from 'module'` → alias_is_star = true, alias = ""
    /// This field is used by the bundler to match imports with their corresponding
    /// exports and for error reporting when imports can't be resolved.
    pub alias: Option<ArenaStr>,
    pub alias_loc: Option<logger::Loc>,
    pub namespace_ref: Option<Ref>,
    pub import_record_index: u32,

    /// If true, the alias refers to the entire export namespace object of a
    /// module. This is no longer represented as an alias called "*" because of
    /// the upcoming "Arbitrary module namespace identifier names" feature:
    /// https://github.com/tc39/ecma262/pull/2154
    pub alias_is_star: bool,

    /// It's useful to flag exported imports because if they are in a TypeScript
    /// file, we can't tell if they are a type or a value.
    pub is_exported: bool,
}

#[derive(Copy, Clone)]
pub struct NamedExport {
    pub ref_: Ref,
    pub alias_loc: logger::Loc,
}

#[repr(u8)] // Zig: enum(u4)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum StrictModeKind {
    SloppyMode,
    ExplicitStrictMode,
    ImplicitStrictModeImport,
    ImplicitStrictModeExport,
    ImplicitStrictModeTopLevelAwait,
    ImplicitStrictModeClass,
}

impl StrictModeKind {
    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

pub fn printmem(args: fmt::Arguments<'_>) {
    // `defer Output.flush()` → executes after print; emulate ordering explicitly.
    #[cfg(any())]
    {
        Output::init_test();
        Output::print(args);
        Output::flush();
    }
    // TODO(b1): bun_core::Output::{init_test,print,flush} missing from stub surface.
    let _ = args;
}

// TODO(b1): `thiserror` not in this crate's deps; hand-roll Display/Error.
#[derive(Debug, Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ToJSError {
    #[strum(serialize = "Cannot convert argument type to JS")]
    CannotConvertArgumentTypeToJS,
    #[strum(serialize = "Cannot convert identifier to JS. Try a statically-known value")]
    CannotConvertIdentifierToJS,
    MacroError,
    OutOfMemory,
    JSError,
    JSTerminated,
}
impl fmt::Display for ToJSError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str(<&'static str>::from(*self)) }
}
impl core::error::Error for ToJSError {}

impl From<ToJSError> for bun_core::Error {
    fn from(e: ToJSError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
        // TODO(port): bun_core::Error construction API (interned tag).
    }
}

/// Say you need to allocate a bunch of tiny arrays
/// You could just do separate allocations for each, but that is slow
/// With std.ArrayList, pointers invalidate on resize and that means it will crash.
/// So a better idea is to batch up your allocations into one larger allocation
/// and then just make all the arrays point to different parts of the larger allocation
pub struct Batcher<T> {
    // TODO(port): &'bump mut [T] once arena lifetime is threaded.
    pub head: *mut [T],
}

impl<T> Batcher<T> {
    pub fn init(bump: &bun_alloc::Arena, count: usize) -> core::result::Result<Self, bun_alloc::AllocError> {
        // TODO(port): bumpalo alloc_slice for uninit T — Zig `allocator.alloc(Type, count)`.
        #[cfg(any())]
        {
            let all = bump.alloc_slice_fill_default(count);
            Ok(Self { head: all as *mut [T] })
        }
        #[cfg(not(any()))]
        { let _ = (bump, count); todo!("b1-stub: Batcher::init") }
    }

    pub fn done(&mut self) {
        // SAFETY: `head` is always a valid (possibly empty) arena slice.
        debug_assert!(unsafe { (&*self.head).is_empty() }); // count to init() was too large, overallocation
    }

    pub fn eat(&mut self, value: T) -> *mut T {
        // PORT NOTE: Zig source `@ptrCast(&this.head.eat1(value).ptr)` appears to
        // intend `this.eat1(value).ptr` cast to *T. Porting the apparent intent.
        let slice = self.eat1(value);
        // SAFETY: eat1 returns a 1-element subslice of the arena allocation.
        unsafe { (*slice).as_mut_ptr() }
    }

    pub fn eat1(&mut self, value: T) -> *mut [T] {
        // SAFETY: `head` is a valid arena slice with at least 1 element remaining
        // (caller contract — Zig would panic on bounds).
        unsafe {
            let head = &mut *self.head;
            let (prev, rest) = head.split_at_mut(1);
            prev[0] = value;
            self.head = rest as *mut [T];
            prev as *mut [T]
        }
    }

    pub fn next<const N: usize>(&mut self, values: [T; N]) -> *mut [T] {
        // SAFETY: `head` is a valid arena slice with at least N elements remaining.
        unsafe {
            let head = &mut *self.head;
            let (prev, rest) = head.split_at_mut(N);
            for (dst, src) in prev.iter_mut().zip(values) {
                *dst = src;
            }
            self.head = rest as *mut [T];
            prev as *mut [T]
        }
    }
}
// Zig: `pub fn NewBatcher(comptime Type: type) type` → Rust generic struct above.
pub type NewBatcher<T> = Batcher<T>;

// ─── helper trait for jsonStringify (Zig `writer: anytype` with `.write`) ───
// TODO(port): replace with the actual JSON writer protocol once ported.
pub trait JsonWriter {
    fn write<V: ?Sized>(&mut self, value: &V) -> core::result::Result<(), bun_core::Error>;
}

// ═════════════════════════════════════════════════════════════════════════
// MOVE-IN (CYCLEBREAK §→js_parser): symbols pulled DOWN from higher-tier
// crates so lower-tier callers (css, interchange, js_parser itself) can
// resolve them here without forming a cycle. Ground truth for each port is
// the named .zig file, NOT the sibling .rs (which may already forward-ref).
// ═════════════════════════════════════════════════════════════════════════

// ─── from bun_jsc::math (src/jsc/jsc.zig) ───────────────────────────────────
pub mod math {
    /// `Number.MAX_SAFE_INTEGER` (2^53 - 1)
    pub const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;
    /// `Number.MIN_SAFE_INTEGER` (-(2^53 - 1))
    pub const MIN_SAFE_INTEGER: f64 = -9007199254740991.0;

    unsafe extern "C" {
        // Zig: `extern "c" fn Bun__JSC__operationMathPow(f64, f64) f64;`
        fn Bun__JSC__operationMathPow(x: f64, y: f64) -> f64;
    }

    /// JSC-compatible `Math.pow` (matches WebKit's `operationMathPow` corner-case
    /// handling for NaN/±∞/±0 — `std::powf` differs on a handful of inputs).
    #[inline]
    pub fn pow(x: f64, y: f64) -> f64 {
        // SAFETY: pure FFI, no pointers, no errno.
        unsafe { Bun__JSC__operationMathPow(x, y) }
    }
}

// ─── from bun_js_printer::Options::Indentation (src/js_printer/js_printer.zig) ─
#[derive(Copy, Clone, Debug)]
pub struct Indentation {
    pub scalar: usize,
    pub count: usize,
    pub character: IndentationCharacter,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum IndentationCharacter {
    Tab,
    Space,
}

// Zig nests `Character` inside the struct; Rust callers that wrote
// `Indentation::Character::Space` use the top-level enum directly.
// TODO(port): inherent associated types are unstable — if many call sites
// need the nested path, gate behind `#![feature(inherent_associated_types)]`.

impl Default for Indentation {
    fn default() -> Self {
        Self { scalar: 2, count: 0, character: IndentationCharacter::Space }
    }
}

// ─── from bun_bundler::v2::MangledProps (src/bundler/bundle_v2.zig) ─────────
// Zig: `std.AutoArrayHashMapUnmanaged(Ref, []const u8)`
// LIFETIMES.tsv: value slices point into the parser arena → raw `*const [u8]`
// pending crate-wide `'bump`.
pub type MangledProps = ArrayHashMap<Ref, *const [u8]>;

// ─── from bun_jsc::RuntimeTranspilerCache (src/jsc/RuntimeTranspilerCache.zig) ─
// Only the surface the parser touches (input_hash / exports_kind / get) lives
// here. The on-disk encode/decode + Metadata + Entry machinery stay in
// `bun_jsc` and operate on `*mut RuntimeTranspilerCache` via the vtable below;
// they need `bun.sys`/`bun.String`/hashing which are tier-6 deps.
pub struct RuntimeTranspilerCache {
    pub input_hash: Option<u64>,
    pub input_byte_length: Option<u64>,
    pub features_hash: Option<u64>,
    pub exports_kind: ExportsKind,
    /// Set by `get()` when a cache hit returns transpiled output. Owned by
    /// `output_code_allocator` on the jsc side; parser only inspects presence.
    pub output_code: Option<bun_string::String>,
    /// Opaque storage for `bun_jsc::RuntimeTranspilerCache::Entry` — the
    /// concrete type lives in tier-6 and is round-tripped via the vtable.
    pub entry: Option<*mut ()>,

    /// Dispatch slot — `bun_jsc` writes `&JSC_TRANSPILER_CACHE_VTABLE` at init.
    /// `None` ⇒ caching disabled (e.g. wasm builds, `--no-transpiler-cache`).
    pub vtable: Option<&'static RuntimeTranspilerCacheVTable>,
}

/// Manual vtable per PORTING.md §Dispatch (cold path: at most twice per parse).
/// Low tier (`js_parser`) names no `bun_jsc` types; high tier owns the impls.
// PERF(port): was direct call into bun.jsc — acceptable, callee does file I/O.
pub struct RuntimeTranspilerCacheVTable {
    /// Zig `RuntimeTranspilerCache.get(source, parser_options, used_jsx) bool`.
    /// `parser_options` is passed as `*const ()` because `parser::Options`
    /// would be a forward edge here; the jsc impl casts it back.
    pub get: unsafe fn(
        this: *mut RuntimeTranspilerCache,
        source: *const logger::Source,
        parser_options: *const (),
        used_jsx: bool,
    ) -> bool,
    /// Zig `RuntimeTranspilerCache.is_disabled` — runtime flag, not const.
    pub is_disabled: fn() -> bool,
}

impl RuntimeTranspilerCache {
    #[inline]
    pub fn get(
        &mut self,
        source: &logger::Source,
        parser_options: *const (),
        used_jsx: bool,
    ) -> bool {
        match self.vtable {
            // SAFETY: `self` is a valid &mut; vtable contract per §Dispatch.
            Some(vt) => unsafe { (vt.get)(self as *mut _, source as *const _, parser_options, used_jsx) },
            None => false,
        }
    }

    #[inline]
    pub fn is_disabled(&self) -> bool {
        self.vtable.map_or(true, |vt| (vt.is_disabled)())
    }
}

// ─── from bun_bundler::defines (src/bundler/defines.zig) ────────────────────
// TODO(b1): gated — depends on un-stubbed `ast::expr::Data` variants,
// `bun_interchange::json::parse_env_json`, `crate::lexer`, and `bun_str`.
#[cfg(any())]
pub mod defines {
    use bun_collections::{ArrayHashMap, StringHashMap};
    use bun_logger as logger;
    use bun_str as strings;

    use crate::ast::base::Ref;
    use crate::ast::e as E;
    use crate::ast::expr;
    use crate::lexer as js_lexer;

    // Zig: `bun.StringArrayHashMap(string)` / `bun.StringHashMap(DefineData)`
    pub type RawDefines = ArrayHashMap<Box<[u8]>, Box<[u8]>>;
    pub type UserDefines = StringHashMap<DefineData>;
    pub type UserDefinesArray = ArrayHashMap<Box<[u8]>, DefineData>;

    pub type IdentifierDefine = DefineData;

    #[derive(Clone)]
    pub struct DotDefine {
        // ARENA: parts borrow the original define key string.
        pub parts: *const [*const [u8]],
        pub data: DefineData,
    }

    bitflags::bitflags! {
        // Zig: `packed struct(u8) { _padding: u3, valueless, can_be_removed_if_unused,
        //        call_can_be_unwrapped_if_unused: E.CallUnwrap (u2), method_call_must_be_replaced_with_undefined }`
        // Packed LSB-first → bit positions below match the Zig layout exactly.
        #[derive(Copy, Clone, Default)]
        pub struct DefineDataFlags: u8 {
            const VALUELESS                                  = 1 << 3;
            const CAN_BE_REMOVED_IF_UNUSED                   = 1 << 4;
            // bits 5..7 hold `E::CallUnwrap` (2 bits) — read via accessor below.
            const METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED = 1 << 7;
        }
    }
    const CALL_UNWRAP_SHIFT: u8 = 5;
    const CALL_UNWRAP_MASK: u8 = 0b11 << CALL_UNWRAP_SHIFT;

    #[derive(Clone)]
    pub struct DefineData {
        pub value: expr::Data<'static>,
        // Not using a slice here shrinks the size from 48 bytes to 40 bytes.
        pub original_name_ptr: Option<*const u8>,
        pub original_name_len: u32,
        pub flags: DefineDataFlags,
    }

    impl Default for DefineData {
        fn default() -> Self {
            Self {
                value: expr::Data::EUndefined(E::Undefined {}),
                original_name_ptr: None,
                original_name_len: 0,
                flags: DefineDataFlags::empty(),
            }
        }
    }

    impl DefineData {
        #[inline]
        pub fn original_name(&self) -> Option<&[u8]> {
            if self.original_name_len > 0 {
                // SAFETY: ptr/len were set together from a borrowed slice; the
                // owning string outlives the Define (caller contract).
                Some(unsafe {
                    core::slice::from_raw_parts(self.original_name_ptr.unwrap(), self.original_name_len as usize)
                })
            } else {
                None
            }
        }

        /// True if accessing this value is known to not have any side effects. For
        /// example, a bare reference to "Object.create" can be removed because it
        /// does not have any observable side effects.
        #[inline]
        pub fn can_be_removed_if_unused(&self) -> bool {
            self.flags.contains(DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED)
        }

        /// True if a call to this value is known to not have any side effects. For
        /// example, a bare call to "Object()" can be removed because it does not
        /// have any observable side effects.
        #[inline]
        pub fn call_can_be_unwrapped_if_unused(&self) -> E::CallUnwrap {
            // SAFETY: 2-bit field, all 3 used values (<4) are valid discriminants.
            unsafe {
                core::mem::transmute::<u8, E::CallUnwrap>(
                    (self.flags.bits() & CALL_UNWRAP_MASK) >> CALL_UNWRAP_SHIFT,
                )
            }
        }

        #[inline]
        pub fn method_call_must_be_replaced_with_undefined(&self) -> bool {
            self.flags.contains(DefineDataFlags::METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED)
        }

        #[inline]
        pub fn valueless(&self) -> bool {
            self.flags.contains(DefineDataFlags::VALUELESS)
        }

        pub fn init_boolean(value: bool) -> DefineData {
            DefineData {
                value: expr::Data::EBoolean(E::Boolean { value }),
                flags: DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED,
                ..Default::default()
            }
        }

        pub fn init_static_string(str_: &'static E::String<'static>) -> DefineData {
            DefineData {
                // Zig `@constCast` — Expr.Data stores *mut; the static is never mutated.
                value: expr::Data::EString(str_ as *const _ as *mut _),
                flags: DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED,
                ..Default::default()
            }
        }

        pub fn merge(a: &DefineData, b: &DefineData) -> DefineData {
            let mut flags = DefineDataFlags::empty();
            if a.can_be_removed_if_unused() {
                flags |= DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED;
            }
            flags = DefineDataFlags::from_bits_retain(
                flags.bits() | ((a.call_can_be_unwrapped_if_unused() as u8) << CALL_UNWRAP_SHIFT),
            );
            // TODO: investigate if this is correct. This is what it was before. But that looks strange.
            if a.method_call_must_be_replaced_with_undefined()
                || b.method_call_must_be_replaced_with_undefined()
            {
                flags |= DefineDataFlags::VALUELESS;
                flags |= DefineDataFlags::METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED;
            }
            DefineData {
                value: b.value.clone(),
                flags,
                original_name_ptr: b.original_name_ptr,
                original_name_len: b.original_name_len,
            }
        }

        pub fn parse(
            key: &[u8],
            value_str: &[u8],
            value_is_undefined: bool,
            method_call_must_be_replaced_with_undefined: bool,
            log: &mut logger::Log,
            bump: &bun_alloc::Arena,
        ) -> core::result::Result<DefineData, bun_core::Error> {
            for part in key.split(|&c| c == b'.') {
                if !js_lexer::is_identifier(part) {
                    if strings::eql(part, key) {
                        log.add_error_fmt(
                            None,
                            logger::Loc::default(),
                            bump,
                            format_args!("define key \"{}\" must be a valid identifier", strings::fmt(key)),
                        )?;
                    } else {
                        log.add_error_fmt(
                            None,
                            logger::Loc::default(),
                            bump,
                            format_args!(
                                "define key \"{}\" contains invalid identifier \"{}\"",
                                strings::fmt(part),
                                strings::fmt(value_str)
                            ),
                        )?;
                    }
                    break;
                }
            }

            // check for nested identifiers
            let mut is_ident = true;
            for part in value_str.split(|&c| c == b'.') {
                if !js_lexer::is_identifier(part) || js_lexer::Keywords::has(part) {
                    is_ident = false;
                    break;
                }
            }

            let mut flags = DefineDataFlags::empty();
            if value_is_undefined {
                flags |= DefineDataFlags::VALUELESS;
            }
            if method_call_must_be_replaced_with_undefined {
                flags |= DefineDataFlags::METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED;
            }

            if is_ident {
                // Special-case undefined. it's not an identifier here
                // https://github.com/evanw/esbuild/issues/1407
                let value = if value_is_undefined || value_str == b"undefined" {
                    expr::Data::EUndefined(E::Undefined {})
                } else {
                    expr::Data::EIdentifier(E::Identifier {
                        ref_: Ref::NONE,
                        can_be_removed_if_unused: true,
                        ..Default::default()
                    })
                };
                flags |= DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED;
                return Ok(DefineData {
                    value,
                    original_name_ptr: if value_str.is_empty() { None } else { Some(value_str.as_ptr()) },
                    original_name_len: value_str.len() as u32,
                    flags,
                });
            }

            // Value is JSON — round-trip through the env-JSON parser.
            let source = logger::Source {
                contents: value_str,
                path: bun_paths::fs::Path::init_with_namespace("defines.json", "internal"),
                ..Default::default()
            };
            // TODO(b0-genuine): same-tier T4 dep on bun_interchange::json — direct call.
            let expr = bun_interchange::json::parse_env_json(&source, log, bump)?;
            let cloned = expr.data.deep_clone(bump)?;
            if expr.is_primitive_literal() {
                flags |= DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED;
            }
            Ok(DefineData {
                value: cloned,
                original_name_ptr: if value_str.is_empty() { None } else { Some(value_str.as_ptr()) },
                original_name_len: value_str.len() as u32,
                flags,
            })
        }
    }

    pub struct Define {
        pub identifiers: StringHashMap<IdentifierDefine>,
        pub dots: StringHashMap<Vec<DotDefine>>,
        pub drop_debugger: bool,
    }

    impl Define {
        // Zig: `pub const Data = DefineData;` — Rust callers import `DefineData` directly.

        pub fn for_identifier(&self, name: &[u8]) -> Option<&IdentifierDefine> {
            if let Some(data) = self.identifiers.get(name) {
                return Some(data);
            }
            // TODO(port): pure_global_identifier_map lives in
            // bun_bundler::defines_table — moves down with the rest of the
            // table in a later pass (large comptime string map).
            None
        }

        pub fn insert(
            &mut self,
            bump: &bun_alloc::Arena,
            key: &[u8],
            value: DefineData,
        ) -> core::result::Result<(), bun_alloc::AllocError> {
            // If it has a dot, then it's a DotDefine.
            // e.g. process.env.NODE_ENV
            if let Some(last_dot) = strings::last_index_of_char(key, b'.') {
                let tail = &key[last_dot + 1..];
                let remainder = &key[..last_dot];
                let count = remainder.iter().filter(|&&c| c == b'.').count() + 1;
                let parts = bump.alloc_slice_fill_default::<*const [u8]>(count + 1);
                for (i, split) in remainder.split(|&c| c == b'.').enumerate() {
                    parts[i] = split as *const [u8];
                }
                parts[count] = tail as *const [u8];

                // "NODE_ENV"
                let entry = self.dots.entry(tail.into()).or_default();
                for part in entry.iter_mut() {
                    // ["process", "env"] === ["process", "env"]
                    if are_parts_equal(part.parts, parts) {
                        part.data = DefineData::merge(&part.data, &value);
                        return Ok(());
                    }
                }
                entry.push(DotDefine { data: value, parts: parts as *const [_] });
            } else {
                // e.g. IS_BROWSER
                self.identifiers.insert(key.into(), value);
            }
            Ok(())
        }

        pub fn init(
            user_defines: Option<UserDefines>,
            string_defines: Option<UserDefinesArray>,
            drop_debugger: bool,
            omit_unused_global_calls: bool,
            bump: &bun_alloc::Arena,
        ) -> core::result::Result<Box<Define>, bun_alloc::AllocError> {
            let _ = omit_unused_global_calls;
            let mut define = Box::new(Define {
                identifiers: StringHashMap::default(),
                dots: StringHashMap::default(),
                drop_debugger,
            });
            // TODO(port): Step 1/2 — load global_no_side_effect_* tables from
            // bun_bundler::defines_table once that table moves down. Omitting
            // here is safe-ish: only affects pure-annotation tree shaking.

            // Step 3. Load user data into hash tables
            if let Some(user_defines) = user_defines {
                for (k, v) in user_defines.into_iter() {
                    define.insert(bump, &k, v)?;
                }
            }
            // Step 4. Load environment data into hash tables.
            if let Some(string_defines) = string_defines {
                for (k, v) in string_defines.into_iter() {
                    define.insert(bump, &k, v)?;
                }
            }
            Ok(define)
        }
    }

    fn are_parts_equal(a: *const [*const [u8]], b: &[*const [u8]]) -> bool {
        // SAFETY: `a` was constructed from a valid arena slice in `insert`.
        let a = unsafe { &*a };
        if a.len() != b.len() {
            return false;
        }
        for i in 0..a.len() {
            // SAFETY: each part is a valid borrow of the original key slice.
            if unsafe { &*a[i] } != unsafe { &*b[i] } {
                return false;
            }
        }
        true
    }
}

// ─── from bun_js_printer::renamer (src/js_printer/renamer.zig) ──────────────
// Only the slot-assignment helpers the parser calls (`P.rs:6658`) live here;
// the full `NumberRenamer`/`MinifyRenamer` machinery stays in `bun_js_printer`
// (it depends on the printer's name-buffer and reserved-names tables).
// TODO(b1): gated — depends on un-stubbed `Scope.members`, `Symbol.nested_scope_slot`.
#[cfg(any())]
pub mod renamer {
    use crate::ast::base::Ref;
    use crate::ast::scope::Scope;
    use crate::ast::symbol::{self, Symbol, SlotNamespace, INVALID_NESTED_SCOPE_SLOT};
    use crate::SlotCounts;

    pub fn assign_nested_scope_slots(
        _allocator: &bun_alloc::Arena,
        module_scope: &mut Scope,
        symbols: &mut [Symbol],
    ) -> SlotCounts {
        let mut slot_counts = SlotCounts::default();
        let mut sorted_members: Vec<u32> = Vec::new();

        // Temporarily set the nested scope slots of top-level symbols to valid so
        // they aren't renamed in nested scopes. This prevents us from accidentally
        // assigning nested scope slots to variables declared using "var" in a nested
        // scope that are actually hoisted up to the module scope to become a top-
        // level symbol.
        const VALID_SLOT: u32 = 0;
        for member in module_scope.members.values() {
            symbols[member.ref_.inner_index() as usize].nested_scope_slot = VALID_SLOT;
        }
        for ref_ in module_scope.generated.slice() {
            symbols[ref_.inner_index() as usize].nested_scope_slot = VALID_SLOT;
        }

        for child in module_scope.children.slice() {
            // SAFETY: child scopes are arena-allocated and live for the parse.
            let child = unsafe { &mut *child.as_ptr() };
            slot_counts.union_max(assign_nested_scope_slots_helper(
                &mut sorted_members,
                child,
                symbols,
                SlotCounts::default(),
            ));
        }

        // Then set the nested scope slots of top-level symbols back to zero. Top-
        // level symbols are not supposed to have nested scope slots.
        for member in module_scope.members.values() {
            symbols[member.ref_.inner_index() as usize].nested_scope_slot = INVALID_NESTED_SCOPE_SLOT;
        }
        for ref_ in module_scope.generated.slice() {
            symbols[ref_.inner_index() as usize].nested_scope_slot = INVALID_NESTED_SCOPE_SLOT;
        }

        slot_counts
    }

    pub fn assign_nested_scope_slots_helper(
        sorted_members: &mut Vec<u32>,
        scope: &mut Scope,
        symbols: &mut [Symbol],
        slot_to_copy: SlotCounts,
    ) -> SlotCounts {
        let mut slot = slot_to_copy;

        // Sort member map keys for determinism
        {
            sorted_members.clear();
            sorted_members.reserve(scope.members.len());
            for member in scope.members.values() {
                sorted_members.push(member.ref_.inner_index());
            }
            sorted_members.sort_unstable();

            // Assign slots for this scope's symbols. Only do this if the slot is
            // not already assigned. Nested scopes have copies of symbols from parent
            // scopes and we want to use the slot from the parent scope, not child scopes.
            for &inner_index in sorted_members.iter() {
                let symbol = &mut symbols[inner_index as usize];
                let ns = symbol.slot_namespace();
                if ns != SlotNamespace::MustNotBeRenamed && symbol.nested_scope_slot().is_none() {
                    symbol.nested_scope_slot = slot.slots[ns];
                    slot.slots[ns] += 1;
                }
            }
        }

        for ref_ in scope.generated.slice() {
            let symbol = &mut symbols[ref_.inner_index() as usize];
            let ns = symbol.slot_namespace();
            if ns != SlotNamespace::MustNotBeRenamed && symbol.nested_scope_slot().is_none() {
                symbol.nested_scope_slot = slot.slots[ns];
                slot.slots[ns] += 1;
            }
        }

        // Labels are always declared in a nested scope, so we don't need to check.
        if let Some(ref_) = scope.label_ref {
            let symbol = &mut symbols[ref_.inner_index() as usize];
            let ns = SlotNamespace::Label;
            symbol.nested_scope_slot = slot.slots[ns];
            slot.slots[ns] += 1;
        }

        // Assign slots for the symbols of child scopes
        let mut slot_counts = slot.clone();
        for child in scope.children.slice() {
            // SAFETY: child scopes are arena-allocated and live for the parse.
            let child = unsafe { &mut *child.as_ptr() };
            slot_counts.union_max(assign_nested_scope_slots_helper(
                sorted_members,
                child,
                symbols,
                slot.clone(),
            ));
        }

        slot_counts
    }

    #[derive(Copy, Clone)]
    pub struct StableSymbolCount {
        pub stable_source_index: u32,
        pub ref_: Ref,
        pub count: u32,
    }

    pub type StableSymbolCountArray = Vec<StableSymbolCount>;

    impl StableSymbolCount {
        pub fn less_than(i: &StableSymbolCount, j: &StableSymbolCount) -> bool {
            if i.count > j.count { return true; }
            if i.count < j.count { return false; }
            if i.stable_source_index < j.stable_source_index { return true; }
            if i.stable_source_index > j.stable_source_index { return false; }
            i.ref_.inner_index() < j.ref_.inner_index()
        }
    }

    // Zig: `js_parser.renamer` re-exports the printer module wholesale; the
    // remaining types (`NoOpRenamer`, `NumberRenamer`, `MinifyRenamer`,
    // `SymbolSlot`, `Renamer` union) are only consumed by the printer and
    // bundler — they stay in `bun_js_printer` and import the helpers above.
    // TODO(port): if Phase B shows another js_parser caller, hoist further.
    #[allow(unused_imports)]
    use symbol as _;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/js_parser.zig (711 lines)
//   confidence: medium
//   todos:      23
//   notes:      arena slices typed as raw *const/*mut [T] pending crate-wide 'bump; MultiArrayList/ArrayHashMap APIs assumed; Expr::init/stmt::Data variant names guessed; local `enum Result` shadows prelude so all error unions spelled core::result::Result; @tagName enums use #[strum(serialize_all = "snake_case")]
// ──────────────────────────────────────────────────────────────────────────

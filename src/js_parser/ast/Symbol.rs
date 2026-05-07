use bun_collections::VecExt;

use crate::ImportItemStatus;
use crate::ast::base::{Ref, RefInt};
use crate::ast::g as G;

pub struct Symbol {
    /// This is the name that came from the parser. Printed names may be renamed
    /// during minification or to avoid name collisions. Do not use the original
    /// name during printing.
    // TODO(port): arena-owned slice (parser/AST crate) — raw fat ptr for now; revisit
    // ownership model (StoreRef / &'bump [u8]) in Phase B.
    pub original_name: *const [u8],

    /// This is used for symbols that represent items in the import clause of an
    /// ES6 import statement. These should always be referenced by EImportIdentifier
    /// instead of an EIdentifier. When this is present, the expression should
    /// be printed as a property access off the namespace instead of as a bare
    /// identifier.
    ///
    /// For correctness, this must be stored on the symbol instead of indirectly
    /// associated with the Ref for the symbol somehow. In ES6 "flat bundling"
    /// mode, re-exported symbols are collapsed using MergeSymbols() and renamed
    /// symbols from other files that end up at this symbol must be able to tell
    /// if it has a namespace alias.
    pub namespace_alias: Option<G::NamespaceAlias>,

    /// Used by the parser for single pass parsing.
    pub link: Ref,

    /// An estimate of the number of uses of this symbol. This is used to detect
    /// whether a symbol is used or not. For example, TypeScript imports that are
    /// unused must be removed because they are probably type-only imports. This
    /// is an estimate and may not be completely accurate due to oversights in the
    /// code. But it should always be non-zero when the symbol is used.
    pub use_count_estimate: u32,

    /// This is for generating cross-chunk imports and exports for code splitting.
    ///
    /// Do not use this directly. Use `chunkIndex()` instead.
    pub chunk_index: u32,

    /// This is used for minification. Symbols that are declared in sibling scopes
    /// can share a name. A good heuristic (from Google Closure Compiler) is to
    /// assign names to symbols from sibling scopes in declaration order. That way
    /// local variable names are reused in each global function like this, which
    /// improves gzip compression:
    ///
    ///   function x(a, b) { ... }
    ///   function y(a, b, c) { ... }
    ///
    /// The parser fills this in for symbols inside nested scopes. There are three
    /// slot namespaces: regular symbols, label symbols, and private symbols.
    ///
    /// Do not use this directly. Use `nestedScopeSlot()` instead.
    pub nested_scope_slot: u32,

    pub did_keep_name: bool,

    pub must_start_with_capital_letter_for_jsx: bool,

    /// The kind of symbol. This is used to determine how to print the symbol
    /// and how to deal with conflicts, renaming, etc.
    pub kind: Kind,

    /// Certain symbols must not be renamed or minified. For example, the
    /// "arguments" variable is declared by the runtime for every function.
    /// Renaming can also break any identifier used inside a "with" statement.
    pub must_not_be_renamed: bool,

    /// We automatically generate import items for property accesses off of
    /// namespace imports. This lets us remove the expensive namespace imports
    /// while bundling in many cases, replacing them with a cheap import item
    /// instead:
    ///
    ///   import * as ns from 'path'
    ///   ns.foo()
    ///
    /// That can often be replaced by this, which avoids needing the namespace:
    ///
    ///   import {foo} from 'path'
    ///   foo()
    ///
    /// However, if the import is actually missing then we don't want to report a
    /// compile-time error like we do for real import items. This status lets us
    /// avoid this. We also need to be able to replace such import items with
    /// undefined, which this status is also used for.
    pub import_item_status: ImportItemStatus,

    /// --- Not actually used yet -----------------------------------------------
    /// Sometimes we lower private symbols even if they are supported. For example,
    /// consider the following TypeScript code:
    ///
    ///   class Foo {
    ///     #foo = 123
    ///     bar = this.#foo
    ///   }
    ///
    /// If "useDefineForClassFields: false" is set in "tsconfig.json", then "bar"
    /// must use assignment semantics instead of define semantics. We can compile
    /// that to this code:
    ///
    ///   class Foo {
    ///     constructor() {
    ///       this.#foo = 123;
    ///       this.bar = this.#foo;
    ///     }
    ///     #foo;
    ///   }
    ///
    /// However, we can't do the same for static fields:
    ///
    ///   class Foo {
    ///     static #foo = 123
    ///     static bar = this.#foo
    ///   }
    ///
    /// Compiling these static fields to something like this would be invalid:
    ///
    ///   class Foo {
    ///     static #foo;
    ///   }
    ///   Foo.#foo = 123;
    ///   Foo.bar = Foo.#foo;
    ///
    /// Thus "#foo" must be lowered even though it's supported. Another case is
    /// when we're converting top-level class declarations to class expressions
    /// to avoid the TDZ and the class shadowing symbol is referenced within the
    /// class body:
    ///
    ///   class Foo {
    ///     static #foo = Foo
    ///   }
    ///
    /// This cannot be converted into something like this:
    ///
    ///   var Foo = class {
    ///     static #foo;
    ///   };
    ///   Foo.#foo = Foo;
    ///
    /// --- Not actually used yet -----------------------------------------------
    pub private_symbol_must_be_lowered: bool,

    pub remove_overwritten_function_declaration: bool,

    /// Used in HMR to decide when live binding code is needed.
    pub has_been_assigned_to: bool,
}

// TODO(port): Zig asserts @sizeOf(Symbol) == 88 and @alignOf(Symbol) == @alignOf([]const u8).
// Rust default repr reorders fields and Option<NamespaceAlias> niche may differ; verify in
// Phase B (likely needs #[repr(C)] or manual packing if the size is load-bearing).
// const _: () = assert!(core::mem::size_of::<Symbol>() == 88);
// const _: () = assert!(core::mem::align_of::<Symbol>() == core::mem::align_of::<*const [u8]>());

const INVALID_CHUNK_INDEX: u32 = u32::MAX;
pub const INVALID_NESTED_SCOPE_SLOT: u32 = u32::MAX;

impl Default for Symbol {
    fn default() -> Self {
        Self {
            original_name: std::ptr::from_ref::<[u8]>(&[]),
            namespace_alias: None,
            link: Ref::NONE,
            use_count_estimate: 0,
            chunk_index: INVALID_CHUNK_INDEX,
            nested_scope_slot: INVALID_NESTED_SCOPE_SLOT,
            did_keep_name: true,
            must_start_with_capital_letter_for_jsx: false,
            kind: Kind::Other,
            must_not_be_renamed: false,
            import_item_status: ImportItemStatus::None,
            private_symbol_must_be_lowered: false,
            remove_overwritten_function_declaration: false,
            has_been_assigned_to: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, enum_map::Enum)]
pub enum SlotNamespace {
    MustNotBeRenamed,
    Default,
    Label,
    PrivateName,
    MangledProp,
}

// Zig: `pub const CountsArray = std.EnumArray(SlotNamespace, u32);` (nested decl).
// Inherent associated types are nightly-only; expose as a free alias.
pub type SlotNamespaceCountsArray = enum_map::EnumMap<SlotNamespace, u32>;

impl Symbol {
    /// This is for generating cross-chunk imports and exports for code splitting.
    #[inline]
    pub fn chunk_index(&self) -> Option<u32> {
        let i = self.chunk_index;
        if i == INVALID_CHUNK_INDEX { None } else { Some(i) }
    }

    #[inline]
    pub fn nested_scope_slot(&self) -> Option<u32> {
        let i = self.nested_scope_slot;
        if i == INVALID_NESTED_SCOPE_SLOT { None } else { Some(i) }
    }

    pub fn slot_namespace(&self) -> SlotNamespace {
        let kind = self.kind;

        if kind == Kind::Unbound || self.must_not_be_renamed {
            return SlotNamespace::MustNotBeRenamed;
        }

        if kind.is_private() {
            return SlotNamespace::PrivateName;
        }

        match kind {
            // Kind::MangledProp => SlotNamespace::MangledProp,
            Kind::Label => SlotNamespace::Label,
            _ => SlotNamespace::Default,
        }
    }

    #[inline]
    pub fn has_link(&self) -> bool {
        // Zig: `self.link.tag != .invalid`
        self.link.is_valid()
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Kind {
    /// An unbound symbol is one that isn't declared in the file it's referenced
    /// in. For example, using "window" without declaring it will be unbound.
    Unbound,

    /// This has special merging behavior. You're allowed to re-declare these
    /// symbols more than once in the same scope. These symbols are also hoisted
    /// out of the scope they are declared in to the closest containing function
    /// or module scope. These are the symbols with this kind:
    ///
    /// - Function arguments
    /// - Function statements
    /// - Variables declared using "var"
    Hoisted,
    HoistedFunction,

    /// There's a weird special case where catch variables declared using a simple
    /// identifier (i.e. not a binding pattern) block hoisted variables instead of
    /// becoming an error:
    ///
    ///   var e = 0;
    ///   try { throw 1 } catch (e) {
    ///     print(e) // 1
    ///     var e = 2
    ///     print(e) // 2
    ///   }
    ///   print(e) // 0 (since the hoisting stops at the catch block boundary)
    ///
    /// However, other forms are still a syntax error:
    ///
    ///   try {} catch (e) { let e }
    ///   try {} catch ({e}) { var e }
    ///
    /// This symbol is for handling this weird special case.
    CatchIdentifier,

    /// Generator and async functions are not hoisted, but still have special
    /// properties such as being able to overwrite previous functions with the
    /// same name
    GeneratorOrAsyncFunction,

    /// This is the special "arguments" variable inside functions
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

    /// Labels are in their own namespace
    Label,

    /// TypeScript enums can merge with TypeScript namespaces and other TypeScript
    /// enums.
    TsEnum,

    /// TypeScript namespaces can merge with classes, functions, TypeScript enums,
    /// and other TypeScript namespaces.
    TsNamespace,

    /// In TypeScript, imports are allowed to silently collide with symbols within
    /// the module. Presumably this is because the imports may be type-only.
    /// Import statement namespace references should NOT have this set.
    Import,

    /// Assigning to a "const" symbol will throw a TypeError at runtime
    Constant,

    // CSS identifiers that are renamed to be unique to the file they are in
    LocalCss,

    /// This annotates all other symbols that don't have special behavior.
    Other,
}

impl Kind {
    // TODO(port): Zig std.json.stringify protocol — `writer.write(@tagName(self))` writes a
    // JSON string value (with quotes). Verify the Rust JSON writer trait used in Phase B.
    pub fn json_stringify<W: core::fmt::Write>(self, writer: &mut W) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer
            .write_str(<&'static str>::from(self))
            .map_err(|_| bun_core::err!("WriteFailed"))
    }

    #[inline]
    pub fn is_private(self) -> bool {
        (self as u8) >= (Kind::PrivateField as u8) && (self as u8) <= (Kind::PrivateStaticGetSetPair as u8)
    }

    #[inline]
    pub fn is_hoisted(self) -> bool {
        matches!(self, Kind::Hoisted | Kind::HoistedFunction)
    }

    #[inline]
    pub fn is_hoisted_or_function(self) -> bool {
        matches!(self, Kind::Hoisted | Kind::HoistedFunction | Kind::GeneratorOrAsyncFunction)
    }

    #[inline]
    pub fn is_function(self) -> bool {
        matches!(self, Kind::HoistedFunction | Kind::GeneratorOrAsyncFunction)
    }
}

#[derive(Default, Clone, Copy)]
pub struct Use {
    pub count_estimate: u32,
}

pub type List = Vec<Symbol>;
pub type NestedList = Vec<List>;

impl Symbol {
    pub fn merge_contents_with(&mut self, old: &mut Symbol) {
        self.use_count_estimate += old.use_count_estimate;
        if old.must_not_be_renamed {
            self.original_name = old.original_name;
            self.must_not_be_renamed = true;
        }

        // TODO: MustStartWithCapitalLetterForJSX
    }
}

#[derive(Default)]
pub struct Map {
    // This could be represented as a "map[Ref]Symbol" but a two-level array was
    // more efficient in profiles. This appears to be because it doesn't involve
    // a hash. This representation also makes it trivial to quickly merge symbol
    // maps from multiple files together. Each file only generates symbols in a
    // single inner array, so you can join the maps together by just make a
    // single outer array containing all of the inner arrays. See the comment on
    // "Ref" for more detail.
    pub symbols_for_source: NestedList,
}

impl Map {
    // Debug-only dump of the symbol table.
    pub fn dump(&self) {
        for (i, symbols) in self.symbols_for_source.slice().iter().enumerate() {
            bun_core::prettyln!(
                "\n\n-- Source ID: {} ({} symbols) --\n",
                i,
                symbols.len(),
            );
            for (inner_index, symbol) in symbols.slice().iter().enumerate() {
                let display_ref = if symbol.has_link() {
                    symbol.link
                } else {
                    Ref::new(
                        inner_index as u32, // @truncate
                        i as u32,           // @truncate
                        crate::ast::base::RefTag::Symbol,
                    )
                };
                // SAFETY: original_name is an arena-owned slice valid for the lifetime of
                // symbols_for_source (the parser/AST arena outlives this Map).
                let name = unsafe { &*symbol.original_name };
                bun_core::prettyln!(
                    " name: {}\n  tag: {}\n       {}",
                    bstr::BStr::new(name),
                    <&'static str>::from(symbol.kind),
                    display_ref,
                );
            }
        }
        bun_core::output::flush();
    }

    // PORT NOTE: takes `&self` (not `&mut self`) — the only caller
    // (`computeCrossChunkDependencies::walk`) runs concurrently across worker
    // threads with each touching disjoint per-chunk symbol slots. The write
    // goes through the raw `*mut Symbol` returned by `get()` (provenance from
    // Vec's raw `NonNull`, independent of the `&self` borrow), so no
    // whole-map `&mut` is asserted. See `get()` SOUNDNESS note.
    pub fn assign_chunk_index(&self, decls_: &crate::DeclaredSymbolList, chunk_index: u32) {
        use crate::DeclaredSymbol;
        struct Iterator<'a> {
            map: &'a Map,
            chunk_index: u32,
        }

        impl Iterator<'_> {
            pub fn next(&mut self, ref_: Ref) {
                // SAFETY: ref_ is a valid top-level symbol ref produced by the parser; Map
                // contains an entry for it. `get()` derives *mut from Vec's raw NonNull
                // (write provenance preserved); storage is not reallocated during iteration.
                // Raw-ptr write — no `&mut` materialized.
                let symbol = self.map.get(ref_).unwrap();
                unsafe { (*symbol).chunk_index = self.chunk_index };
            }
        }
        DeclaredSymbol::for_each_top_level_symbol(
            decls_,
            &mut Iterator { map: self, chunk_index },
            Iterator::next,
        );
    }

    pub fn merge(&mut self, old: Ref, new: Ref) -> Ref {
        if old.eql(new) {
            return new;
        }

        // Union-find with path compression. Zig holds two aliasing *Symbol into the same
        // NestedList; we mirror that with raw-pointer-only access — no `&mut Symbol` is
        // materialized across the recursive `&mut self` calls. `get()` derives *mut from
        // Vec's raw `NonNull` (write provenance preserved, independent of `&self`
        // borrow); backing storage is never reallocated during merge.
        let old_symbol = self.get(old).unwrap();
        // SAFETY: valid in-bounds ptr from `get()`; see note above.
        if unsafe { (*old_symbol).has_link() } {
            let old_link = unsafe { (*old_symbol).link };
            let merged = self.merge(old_link, new);
            // SAFETY: storage not reallocated by recursion; ptr still valid.
            unsafe { (*old_symbol).link = merged };
            return merged;
        }

        let new_symbol = self.get(new).unwrap();
        // SAFETY: valid in-bounds ptr from `get()`; see note above.
        if unsafe { (*new_symbol).has_link() } {
            let new_link = unsafe { (*new_symbol).link };
            let merged = self.merge(old, new_link);
            // SAFETY: storage not reallocated by recursion; ptr still valid.
            unsafe { (*new_symbol).link = merged };
            return merged;
        }

        // SAFETY: `old != new` (checked above) so old_symbol/new_symbol are disjoint
        // elements; materializing both `&mut` here is sound (cf. split_at_mut). Neither
        // outlives this block.
        unsafe {
            (*old_symbol).link = new;
            (&mut *new_symbol).merge_contents_with(&mut *old_symbol);
        }
        new
    }

    // Returns a raw *mut Symbol because callers (merge/follow/assign_chunk_index/
    // get_with_link) hold aliasing pointers into the NestedList and/or recurse through
    // &mut self while holding the pointer. Mirrors Zig's `*const Map -> ?*Symbol`
    // (interior mutability via Vec's raw `[*]T` ptr field).
    //
    // SOUNDNESS: the *mut is derived directly from `Vec.ptr: NonNull<T>` — a raw
    // pointer field whose provenance is independent of the `&self` borrow used to read
    // it. We deliberately do NOT go through `.slice()`/`.at()` (which produce `&[T]`/`&T`
    // and would yield read-only provenance, making any later write UB). Callers may write
    // through the result as long as the backing storage is not reallocated and they do
    // not materialize overlapping `&mut`.
    pub fn get(&self, ref_: Ref) -> Option<*mut Symbol> {
        if Ref::is_source_index_null(ref_.source_index()) || ref_.is_source_contents_slice() {
            return None;
        }
        let src = ref_.source_index() as usize;
        let idx = ref_.inner_index() as usize;
        debug_assert!(src < self.symbols_for_source.len());
        // SAFETY: src in-bounds (parser-produced ref); raw-ptr field read — no `&` to the
        // element is created. idx in-bounds of the inner list.
        unsafe {
            let inner: *mut List = self.symbols_for_source.as_ptr().cast_mut().add(src);
            debug_assert!(idx < (*inner).len());
            Some((*inner).as_mut_ptr().add(idx))
        }
    }

    pub fn get_const(&self, ref_: Ref) -> Option<&Symbol> {
        if Ref::is_source_index_null(ref_.source_index()) || ref_.is_source_contents_slice() {
            return None;
        }
        Some(
            self.symbols_for_source
                .at(ref_.source_index() as usize)
                .at(ref_.inner_index() as usize),
        )
    }

    pub fn init(source_count: usize) -> Map {
        // Zig: `arena.alloc([]Symbol, sourceCount)` (default_allocator) then NestedList.init.
        // Per PORTING.md §Allocators (non-arena path), use Vec → Vec.
        let mut v: Vec<List> = Vec::with_capacity(source_count);
        v.resize_with(source_count, List::default);
        Map { symbols_for_source: NestedList::move_from_list(v) }
    }

    // PORT NOTE: Zig aliased the caller's stack `[1]List` slot directly; that's
    // unsound in Rust (would dangle on return). Take ownership of `list` and
    // box it into a one-element NestedList instead.
    // PERF(port): one extra allocation vs Zig — profile in Phase B (single
    // caller is the printer one-shot, cold).
    pub fn init_with_one_list(list: List) -> Map {
        Self::init_list(NestedList::move_from_list(vec![list]))
    }

    pub fn init_list(list: NestedList) -> Map {
        Map { symbols_for_source: list }
    }

    pub fn get_with_link(&self, ref_: Ref) -> Option<*mut Symbol> {
        let symbol_ptr = self.get(ref_)?;
        // SAFETY: ptr from get() is valid while storage is not reallocated. Read-only
        // access here; raw deref avoids holding a `&mut` we don't need.
        if unsafe { (*symbol_ptr).has_link() } {
            let link = unsafe { (*symbol_ptr).link };
            return Some(self.get(link).unwrap_or(symbol_ptr));
        }
        Some(symbol_ptr)
    }

    pub fn get_with_link_const(&self, ref_: Ref) -> Option<&Symbol> {
        let symbol = self.get_const(ref_)?;
        if symbol.has_link() {
            return Some(self.get_const(symbol.link).unwrap_or(symbol));
        }
        Some(symbol)
    }

    pub fn follow_all(&mut self) {
        // TODO(b2-blocked): bun_perf::trace("Symbols.followAll") — RAII guard
        // PORT NOTE: reshaped for borrowck — iterate via raw ptrs (same aliasing model as
        // `get`). follow() does not reallocate symbols_for_source. Derive *mut from the
        // raw NonNull fields directly (NOT via `.slice()`, which would yield read-only
        // provenance).
        let outer_len = self.symbols_for_source.len();
        let outer = self.symbols_for_source.as_ptr().cast_mut();
        for src in 0..outer_len {
            // SAFETY: src in-bounds; raw-ptr field reads — no `&` created.
            let (base, inner_len) = unsafe {
                let inner: *mut List = outer.add(src);
                ((*inner).as_mut_ptr(), (*inner).len())
            };
            for i in 0..inner_len {
                // SAFETY: in-bounds; storage stable across follow(). Raw-ptr access — no
                // `&mut` held across the `follow(&self, ..)` call.
                let symbol = unsafe { base.add(i) };
                if !unsafe { (*symbol).has_link() } {
                    continue;
                }
                let link = unsafe { (*symbol).link };
                let resolved = Self::follow(self, link);
                unsafe { (*symbol).link = resolved };
            }
        }
    }

    /// Equivalent to followSymbols in esbuild
    pub fn follow(&self, ref_: Ref) -> Ref {
        let Some(symbol_ptr) = self.get(ref_) else {
            return ref_;
        };
        // SAFETY: see note on `get` — union-find path compression mutates through *mut
        // derived from Vec's raw NonNull. Raw-ptr-only access; no `&mut` held across
        // the recursive call (which may write other symbols' `link` fields).
        if !unsafe { (*symbol_ptr).has_link() } {
            return ref_;
        }

        let cur_link = unsafe { (*symbol_ptr).link };
        let link = Self::follow(self, cur_link);

        // SAFETY: storage not reallocated by recursion; ptr still valid.
        if !unsafe { (*symbol_ptr).link }.eql(link) {
            unsafe { (*symbol_ptr).link = link };
        }

        link
    }
}

impl Symbol {
    #[inline]
    pub fn is_hoisted(&self) -> bool {
        Symbol::is_kind_hoisted(self.kind)
    }

    // Zig: pub const isKindFunction = Symbol.Kind.isFunction; (etc.)
    // Rust cannot alias inherent methods; forward explicitly.
    #[inline]
    pub fn is_kind_function(kind: Kind) -> bool {
        kind.is_function()
    }
    #[inline]
    pub fn is_kind_hoisted(kind: Kind) -> bool {
        kind.is_hoisted()
    }
    #[inline]
    pub fn is_kind_hoisted_or_function(kind: Kind) -> bool {
        kind.is_hoisted_or_function()
    }
    #[inline]
    pub fn is_kind_private(kind: Kind) -> bool {
        kind.is_private()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Symbol.zig (487 lines)
//   confidence: medium
//   todos:      11
//   notes:      Map::get returns *mut Symbol derived from Vec NonNull (union-find aliasing, raw-ptr-only access); original_name is arena raw slice; size_of==88 assert disabled
// ──────────────────────────────────────────────────────────────────────────

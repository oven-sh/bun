use bun_collections::BabyList;
use bun_core::Output;
use bun_alloc::Arena; // bumpalo::Bump re-export

use crate::ast::declared_symbol::DeclaredSymbol;
use crate::ast::G;
use crate::ast::ImportItemStatus;
use crate::ast::Ref;

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
            original_name: &[] as *const [u8],
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

impl SlotNamespace {
    // std.EnumArray(SlotNamespace, u32)
    pub type CountsArray = enum_map::EnumMap<SlotNamespace, u32>;
}

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
        // TODO(port): verify Ref::tag field/variant path
        self.link.tag != crate::ast::ref_::Tag::Invalid
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

pub type List = BabyList<Symbol>;
pub type NestedList = BabyList<List>;

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
    pub fn dump(&self) {
        // TODO(port): Output.prettyln formatting — verify bun_core::Output API
        for (i, symbols) in self.symbols_for_source.slice().iter().enumerate() {
            Output::prettyln(format_args!(
                "\n\n-- Source ID: {} ({} symbols) --\n\n",
                i,
                symbols.len()
            ));
            for (inner_index, symbol) in symbols.slice().iter().enumerate() {
                let display_ref = if symbol.has_link() {
                    symbol.link
                } else {
                    Ref {
                        source_index: i as u32,        // @truncate
                        inner_index: inner_index as u32, // @truncate
                        tag: crate::ast::ref_::Tag::Symbol,
                    }
                };
                // SAFETY: original_name is an arena-owned slice valid for the lifetime of
                // symbols_for_source (the parser/AST arena outlives this Map).
                let name = unsafe { &*symbol.original_name };
                Output::prettyln(format_args!(
                    " name: {}\n  tag: {}\n       {}\n",
                    bstr::BStr::new(name),
                    <&'static str>::from(symbol.kind),
                    display_ref,
                ));
            }
        }
        Output::flush();
    }

    pub fn assign_chunk_index(&mut self, decls_: DeclaredSymbol::List, chunk_index: u32) {
        struct Iterator<'a> {
            map: &'a mut Map,
            chunk_index: u32,
        }

        impl<'a> Iterator<'a> {
            pub fn next(&mut self, ref_: Ref) {
                // SAFETY: ref_ is a valid top-level symbol ref produced by the parser; Map
                // contains an entry for it.
                let symbol = unsafe { &mut *self.map.get(ref_).unwrap() };
                symbol.chunk_index = self.chunk_index;
            }
        }
        let mut decls = decls_;

        DeclaredSymbol::for_each_top_level_symbol(
            &mut decls,
            Iterator { map: self, chunk_index },
            Iterator::next,
        );
    }

    pub fn merge(&mut self, old: Ref, new: Ref) -> Ref {
        if old.eql(new) {
            return new;
        }

        // TODO(port): lifetime — union-find with path compression; Zig holds two aliasing
        // *Symbol into the same NestedList. Using raw pointers to preserve the algorithm
        // exactly. Revisit with a sound interior-mutability design in Phase B.
        // SAFETY: `old` and `new` are distinct refs (checked above for equality); the
        // backing storage is not reallocated during this call.
        let old_symbol = unsafe { &mut *self.get(old).unwrap() };
        if old_symbol.has_link() {
            let old_link = old_symbol.link;
            old_symbol.link = self.merge(old_link, new);
            return old_symbol.link;
        }

        // SAFETY: see above — `new` is distinct from `old`; backing storage not reallocated
        // during this call.
        let new_symbol = unsafe { &mut *self.get(new).unwrap() };

        if new_symbol.has_link() {
            let new_link = new_symbol.link;
            new_symbol.link = self.merge(old, new_link);
            return new_symbol.link;
        }

        old_symbol.link = new;
        new_symbol.merge_contents_with(old_symbol);
        new
    }

    // TODO(port): lifetime — returns a raw *mut Symbol because callers (merge/follow/
    // assign_chunk_index/get_with_link) hold aliasing mutable refs into the NestedList and/or
    // recurse through &mut self while holding the pointer. The Zig signature is
    // `*const Map -> ?*Symbol` (interior mutability via BabyList.mut). Phase B should decide
    // on Cell/UnsafeCell or a `&mut self` reshape.
    pub fn get(&self, ref_: Ref) -> Option<*mut Symbol> {
        if Ref::is_source_index_null(ref_.source_index()) || ref_.is_source_contents_slice() {
            return None;
        }

        Some(
            self.symbols_for_source
                .at(ref_.source_index())
                .mut_(ref_.inner_index()),
        )
    }

    pub fn get_const(&self, ref_: Ref) -> Option<&Symbol> {
        if Ref::is_source_index_null(ref_.source_index()) || ref_.is_source_contents_slice() {
            return None;
        }

        Some(
            self.symbols_for_source
                .at(ref_.source_index())
                .at(ref_.inner_index()),
        )
    }

    pub fn init(source_count: usize, bump: &Arena) -> Result<Map, bun_alloc::AllocError> {
        // TODO(port): Zig does `allocator.alloc([]Symbol, sourceCount)` then `NestedList.init(...)`.
        // Verify whether callers pass an arena or default_allocator; using arena per AST-crate rule.
        let symbols_for_source: NestedList =
            NestedList::init(bump.alloc_slice_fill_default::<List>(source_count));
        Ok(Map { symbols_for_source })
    }

    pub fn init_with_one_list(list: List) -> Map {
        // SAFETY: caller must keep `list` alive for the lifetime of the returned Map —
        // mirrors Zig's `fromBorrowedSliceDangerous((&list)[0..1])`.
        // TODO(port): this borrows a by-value parameter; in Zig the slice points at the
        // caller's stack/heap copy. Phase B must ensure `list` outlives the Map.
        let baby_list = BabyList::<List>::from_borrowed_slice_dangerous(core::slice::from_ref(&list));
        Self::init_list(baby_list)
    }

    pub fn init_list(list: NestedList) -> Map {
        Map { symbols_for_source: list }
    }

    pub fn get_with_link(&self, ref_: Ref) -> Option<*mut Symbol> {
        let symbol_ptr = self.get(ref_)?;
        // SAFETY: ptr from get() is valid while self is borrowed and storage is not reallocated.
        let symbol = unsafe { &mut *symbol_ptr };
        if symbol.has_link() {
            return Some(self.get(symbol.link).unwrap_or(symbol_ptr));
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
        // TODO(port): bun.perf.trace — assuming RAII guard with Drop calling .end()
        let _trace = bun_core::perf::trace("Symbols.followAll");
        for list in self.symbols_for_source.slice() {
            for symbol_ptr in list.slice_mut() {
                // PORT NOTE: reshaped for borrowck — iterate raw, follow via &self
                // SAFETY: follow() does not reallocate symbols_for_source.
                let symbol = unsafe { &mut *(symbol_ptr as *mut Symbol) };
                if !symbol.has_link() {
                    continue;
                }
                symbol.link = Self::follow(self, symbol.link);
            }
        }
    }

    /// Equivalent to followSymbols in esbuild
    pub fn follow(&self, ref_: Ref) -> Ref {
        let Some(symbol_ptr) = self.get(ref_) else {
            return ref_;
        };
        // SAFETY: see note on `get` — union-find path compression mutates through *mut.
        let symbol = unsafe { &mut *symbol_ptr };
        if !symbol.has_link() {
            return ref_;
        }

        let link = Self::follow(self, symbol.link);

        if !symbol.link.eql(link) {
            symbol.link = link;
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
//   notes:      Map::get returns *mut Symbol (union-find aliasing); original_name is arena raw slice; size_of==88 assert disabled
// ──────────────────────────────────────────────────────────────────────────

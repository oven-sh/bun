use core::sync::atomic::{AtomicU32, Ordering};
use std::cell::Cell;

use crate::ImportItemStatus;
use crate::base::Ref;
use crate::g as G;

pub struct Symbol {
    /// This is the name that came from the parser. Printed names may be renamed
    /// during minification or to avoid name collisions. Do not use the original
    /// name during printing.
    // Arena-owned slice (parser/AST crate). `StoreStr` is the lifetime-erased
    // `[u8]` wrapper used uniformly across AST string fields; it derefs to
    // `[u8]` and is valid until the owning arena resets.
    pub original_name: crate::StoreStr,

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
    ///
    /// Boxed: this is `None` for the overwhelming majority of symbols, so we
    /// pay 8 bytes inline instead of ~32. `AstBox` so the header lives in the
    /// same spill heap as the rest of the per-file AST and is reclaimed on
    /// reset (`Symbol` is held in `ArenaVec<'a, Symbol>`; `Drop` is not
    /// guaranteed to run).
    pub namespace_alias: Option<bun_alloc::AstBox<G::NamespaceAlias>>,

    /// Used by the parser for single pass parsing.
    ///
    /// `Cell` because union-find (`merge`/`follow`) mutates this through
    /// `&Symbol` while other shared refs to the same table are live. `Ref` is
    /// `Copy`, so `Cell<Ref>` is zero-cost and lets those algorithms run
    /// without raw-pointer writes.
    pub link: Cell<Ref>,

    /// An estimate of the number of uses of this symbol. This is used to detect
    /// whether a symbol is used or not. For example, TypeScript imports that are
    /// unused must be removed because they are probably type-only imports. This
    /// is an estimate and may not be completely accurate due to oversights in the
    /// code. But it should always be non-zero when the symbol is used.
    pub use_count_estimate: u32,

    /// This is for generating cross-chunk imports and exports for code splitting.
    ///
    /// Do not use this directly. Use `chunkIndex()` instead.
    ///
    /// `AtomicU32` (not plain `u32`) because [`Map::assign_chunk_index`] is
    /// invoked from worker threads in
    /// `compute_cross_chunk_dependencies::walk()` while other threads hold a
    /// shared `&LinkerGraph` (and thus `&Symbol`). The linker invariant is
    /// that all declarations of a given top-level symbol are placed in a
    /// single chunk, so cross-thread writes target disjoint slots — but the
    /// invariant is data-dependent, not type-checked, and a plain `u32` write
    /// through a slot reachable from `&` is UB regardless. Relaxed ordering
    /// is sufficient: the worker-pool join supplies the happens-before edge
    /// to the post-pass reader (`compute_cross_chunk_dependencies_with_chunk_metas`).
    pub chunk_index: AtomicU32,

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

    /// The kind of symbol. This is used to determine how to print the symbol
    /// and how to deal with conflicts, renaming, etc.
    pub kind: Kind,

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

    /// Packed boolean state — see [`SymbolFlags`]. Six former `bool` fields
    /// collapsed into one byte.
    pub flags: SymbolFlags,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, Eq, PartialEq, Default, Debug)]
    pub struct SymbolFlags: u8 {
        const DID_KEEP_NAME = 1 << 0;

        const MUST_START_WITH_CAPITAL_LETTER_FOR_JSX = 1 << 1;

        /// Certain symbols must not be renamed or minified. For example, the
        /// "arguments" variable is declared by the runtime for every function.
        /// Renaming can also break any identifier used inside a "with" statement.
        const MUST_NOT_BE_RENAMED = 1 << 2;

        const REMOVE_OVERWRITTEN_FUNCTION_DECLARATION = 1 << 4;

        /// Used in HMR to decide when live binding code is needed.
        const HAS_BEEN_ASSIGNED_TO = 1 << 5;
    }
}

macro_rules! symbol_flag_accessors {
    ($($getter:ident, $setter:ident => $flag:ident;)*) => {
        impl Symbol {
            $(
                #[inline]
                pub fn $getter(&self) -> bool {
                    self.flags.contains(SymbolFlags::$flag)
                }
                #[inline]
                pub fn $setter(&mut self, v: bool) {
                    self.flags.set(SymbolFlags::$flag, v)
                }
            )*
        }
    };
}

symbol_flag_accessors! {
    must_start_with_capital_letter_for_jsx, set_must_start_with_capital_letter_for_jsx => MUST_START_WITH_CAPITAL_LETTER_FOR_JSX;
    must_not_be_renamed, set_must_not_be_renamed => MUST_NOT_BE_RENAMED;
    remove_overwritten_function_declaration, set_remove_overwritten_function_declaration => REMOVE_OVERWRITTEN_FUNCTION_DECLARATION;
    has_been_assigned_to, set_has_been_assigned_to => HAS_BEEN_ASSIGNED_TO;
}

const _: () = assert!(core::mem::size_of::<Option<bun_alloc::AstBox<G::NamespaceAlias>>>() == 8);
const _: () = assert!(core::mem::size_of::<Symbol>() <= 48);

const INVALID_CHUNK_INDEX: u32 = u32::MAX;
pub const INVALID_NESTED_SCOPE_SLOT: u32 = u32::MAX;

impl Default for Symbol {
    fn default() -> Self {
        Self {
            original_name: crate::StoreStr::EMPTY,
            namespace_alias: None,
            link: Cell::new(Ref::NONE),
            use_count_estimate: 0,
            chunk_index: AtomicU32::new(INVALID_CHUNK_INDEX),
            nested_scope_slot: INVALID_NESTED_SCOPE_SLOT,
            kind: Kind::Other,
            import_item_status: ImportItemStatus::None,
            flags: SymbolFlags::DID_KEEP_NAME,
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

// Inherent associated types are nightly-only; expose as a free alias.
pub(crate) type SlotNamespaceCountsArray = enum_map::EnumMap<SlotNamespace, u32>;

impl Symbol {
    /// This is for generating cross-chunk imports and exports for code splitting.
    #[inline]
    pub fn chunk_index(&self) -> Option<u32> {
        let i = self.chunk_index.load(Ordering::Relaxed);
        if i == INVALID_CHUNK_INDEX {
            None
        } else {
            Some(i)
        }
    }

    #[inline]
    pub fn nested_scope_slot(&self) -> Option<u32> {
        let i = self.nested_scope_slot;
        if i == INVALID_NESTED_SCOPE_SLOT {
            None
        } else {
            Some(i)
        }
    }

    pub fn slot_namespace(&self) -> SlotNamespace {
        let kind = self.kind;

        if kind == Kind::Unbound || self.must_not_be_renamed() {
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
        self.link.get().is_valid()
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
    #[inline]
    pub(crate) fn is_private(self) -> bool {
        (self as u8) >= (Kind::PrivateField as u8)
            && (self as u8) <= (Kind::PrivateStaticGetSetPair as u8)
    }

    #[inline]
    pub(crate) fn is_hoisted(self) -> bool {
        matches!(self, Kind::Hoisted | Kind::HoistedFunction)
    }

    #[inline]
    pub(crate) fn is_hoisted_or_function(self) -> bool {
        matches!(
            self,
            Kind::Hoisted | Kind::HoistedFunction | Kind::GeneratorOrAsyncFunction
        )
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

pub type List<'a> = bun_alloc::ArenaVec<'a, Symbol>;
/// `Map.symbols_for_source` storage. Decoupled from [`List`] (which is
/// arena-backed): the linker clones every per-source symbol table here so it
/// can mutate them independently of the parsed `BundledAst.symbols`, and those
/// clones are owned for the link lifetime — global allocator, no arena tag.
pub type NestedList = Vec<Vec<Symbol>>;

impl Symbol {
    pub(crate) fn merge_contents_with(&mut self, old: &mut Symbol) {
        self.use_count_estimate += old.use_count_estimate;
        if old.must_not_be_renamed() {
            self.original_name = old.original_name;
            self.set_must_not_be_renamed(true);
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
        for (i, symbols) in self.symbols_for_source.iter().enumerate() {
            bun_core::prettyln!("\n\n-- Source ID: {} ({} symbols) --\n", i, symbols.len(),);
            for (inner_index, symbol) in symbols.iter().enumerate() {
                let display_ref = if symbol.has_link() {
                    symbol.link.get()
                } else {
                    Ref::new(
                        inner_index as u32, // @truncate
                        i as u32,           // @truncate
                        crate::base::RefTag::Symbol,
                    )
                };
                // SAFETY: original_name is an arena-owned slice valid for the lifetime of
                // symbols_for_source (the parser/AST arena outlives this Map).
                let name = symbol.original_name.slice();
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

    // Takes `&self` (not `&mut self`) — the only caller
    // (`computeCrossChunkDependencies::walk`) runs concurrently across worker
    // threads. `Symbol.chunk_index` is `AtomicU32`, so the per-slot write is a
    // sound interior mutation through `&Symbol`; no raw-pointer or `&mut Map`
    // escape is needed. Relaxed ordering: see the field doc — the worker-pool
    // join is the only required happens-before edge, and the linker invariant
    // places all declarations of a given symbol in a single chunk (same
    // worker), so cross-thread writes target disjoint slots. A
    // `debug_assert!` documents that invariant.
    pub fn assign_chunk_index(&self, decls_: &crate::DeclaredSymbolList, chunk_index: u32) {
        use crate::DeclaredSymbol;
        struct Iterator<'a> {
            map: &'a Map,
            chunk_index: u32,
        }

        impl Iterator<'_> {
            fn next(&mut self, ref_: Ref) {
                let symbol = self.map.get_const(ref_).unwrap();
                // Thread-confinement invariant: a top-level symbol's
                // declarations are all assigned to one chunk, so any prior
                // value is either INVALID or this same chunk (overwrite from a
                // sibling `var` decl in the same chunk — see esbuild comment in
                // `walk`). If this fires, two chunks raced on one symbol.
                debug_assert!(
                    {
                        let prev = symbol.chunk_index.load(Ordering::Relaxed);
                        prev == INVALID_CHUNK_INDEX || prev == self.chunk_index
                    },
                    "Symbol.chunk_index reassigned across chunks (linker partition invariant broken)",
                );
                symbol
                    .chunk_index
                    .store(self.chunk_index, Ordering::Relaxed);
            }
        }
        DeclaredSymbol::for_each_top_level_symbol(
            decls_,
            &mut Iterator {
                map: self,
                chunk_index,
            },
            Iterator::next,
        );
    }

    pub fn merge(&mut self, old: Ref, new: Ref) -> Ref {
        if old.eql(new) {
            return new;
        }

        // Union-find with path compression. `link` is `Cell<Ref>`, so all link
        // reads/writes go through safe shared access (`get_const`). Backing
        // storage is never reallocated during merge, so re-looking-up after the
        // recursive call is cheap and the borrow ends before the `&mut self`
        // recursion.
        let old_link = self.get_const(old).unwrap().link.get();
        if old_link.is_valid() {
            let merged = self.merge(old_link, new);
            self.get_const(old).unwrap().link.set(merged);
            return merged;
        }

        let new_link = self.get_const(new).unwrap().link.get();
        if new_link.is_valid() {
            let merged = self.merge(old, new_link);
            self.get_const(new).unwrap().link.set(merged);
            return merged;
        }

        self.get_const(old).unwrap().link.set(new);
        // `merge_contents_with` mutates non-Cell fields (use_count_estimate,
        // must_not_be_renamed, original_name) on `new` while reading `old`.
        let old_symbol = self.get(old).unwrap();
        let new_symbol = self.get(new).unwrap();
        // SAFETY: `old != new` (checked above) so the two slots are disjoint
        // elements of the NestedList; `get()` derives `*mut` from Vec's raw
        // `NonNull` (write provenance preserved). Neither `&mut` outlives this
        // block (cf. split_at_mut).
        unsafe {
            (&mut *new_symbol).merge_contents_with(&mut *old_symbol);
        }
        new
    }

    // Returns a raw *mut Symbol because callers (merge/follow/assign_chunk_index/
    // get_with_link) hold aliasing pointers into the NestedList and/or recurse through
    // &mut self while holding the pointer.
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
            let inner: *mut Vec<Symbol> = self.symbols_for_source.as_ptr().cast_mut().add(src);
            debug_assert!(idx < (*inner).len());
            Some((*inner).as_mut_ptr().add(idx))
        }
    }

    pub fn get_const(&self, ref_: Ref) -> Option<&Symbol> {
        if Ref::is_source_index_null(ref_.source_index()) || ref_.is_source_contents_slice() {
            return None;
        }
        let src = ref_.source_index() as usize;
        let idx = ref_.inner_index() as usize;
        debug_assert!(src < self.symbols_for_source.len());
        // SAFETY: the validity guards above are exhaustive — every Ref with a
        // non-null source index and a non-SourceContentsSlice tag was emitted
        // by the parser as an index into this table (`declare_symbol` /
        // `new_symbol` write `inner_index = symbols.len()` then push) or
        // minted by the linker (`LinkerGraph::generate_symbol`, which appends
        // to the same per-source Vec). Both indices are therefore in-bounds.
        // The bundler never fabricates Refs from untrusted input.
        //
        // (Formerly a separate `get_unchecked` method — inlined: it had no
        // external callers, so the unchecked fast path need not be public
        // API surface. `follow()` below uses checked indexing for the same
        // lookup; this site keeps the unchecked path for the printer's hot
        // inner loop, narrowed to where the guard is visible.)
        Some(unsafe {
            let inner = self.symbols_for_source.as_ptr().add(src);
            debug_assert!(idx < (*inner).len());
            &*(*inner).as_ptr().add(idx)
        })
    }

    pub fn init(source_count: usize) -> Map {
        let mut v: NestedList = Vec::with_capacity(source_count);
        v.resize_with(source_count, Vec::new);
        Map {
            symbols_for_source: v,
        }
    }

    // Takes ownership of `list` and boxes it into a one-element NestedList.
    // PERF: one extra allocation — profile if needed (single caller is the
    // printer one-shot, cold).
    // OWNERSHIP: returned `Map` is *owned*; the `Vec<List>` allocated here leaks if a
    // consumer parks it in `ManuallyDrop` (e.g. renamer.rs `MinifyRenamer.symbols`).
    pub fn init_with_one_list(list: Vec<Symbol>) -> Map {
        Self::init_list(vec![list])
    }

    pub fn init_list(list: NestedList) -> Map {
        Map {
            symbols_for_source: list,
        }
    }

    /// Safe `&mut` lookup via the `Vec`/`Vec<Symbol>` backing storage. Mirrors
    /// [`get_const`] but returns a unique borrow tied to `&mut self`, so callers
    /// that only need to flip a flag (e.g. `must_not_be_renamed`) don't need the
    /// raw `*mut Symbol` from [`get`] + an open-coded `(*ptr).field = ...`.
    pub fn get_mut(&mut self, ref_: Ref) -> Option<&mut Symbol> {
        if Ref::is_source_index_null(ref_.source_index()) || ref_.is_source_contents_slice() {
            return None;
        }
        let src = ref_.source_index() as usize;
        let idx = ref_.inner_index() as usize;
        self.symbols_for_source.get_mut(src)?.get_mut(idx)
    }

    pub fn get_with_link_const(&self, ref_: Ref) -> Option<&Symbol> {
        let symbol = self.get_const(ref_)?;
        if symbol.has_link() {
            return Some(self.get_const(symbol.link.get()).unwrap_or(symbol));
        }
        Some(symbol)
    }

    pub fn follow_all(&mut self) {
        // The returned `Ctx` is RAII and ends the span on drop.
        let _trace = bun_perf::trace(bun_perf::PerfEvent::SymbolsFollowAll);
        // `link` is `Cell<Ref>`, so we can iterate the table by shared ref and
        // mutate `link` in place; `follow()` only takes `&self` and only touches
        // `link`, so the nested shared borrows coexist.
        for symbols in self.symbols_for_source.iter() {
            for symbol in symbols.iter() {
                if !symbol.has_link() {
                    continue;
                }
                let resolved = self.follow(symbol.link.get());
                symbol.link.set(resolved);
            }
        }
    }

    /// Equivalent to followSymbols in esbuild.
    ///
    /// An iterative two-phase walk so the per-hop work is just two raw
    /// pointer adds and a load — no call frame, no `Option` unwrap, no
    /// repeated tag/null guards. Every node on the path from `ref_` to the
    /// union-find root has its `link` rewritten to the root (full path
    /// compression).
    pub fn follow(&self, ref_: Ref) -> Ref {
        // Entry guard — `ref_` may be `Ref::None` / a SourceContentsSlice ref
        // (callers pass arbitrary Refs read out of AST nodes). After this,
        // `symbol` is a valid in-bounds slot.
        let Some(symbol) = self.get_const(ref_) else {
            return ref_;
        };
        let mut link = symbol.link.get();
        // `has_link()` is `link.is_valid()` (tag != RefTag::Invalid). This is
        // the overwhelmingly common exit — most symbols are roots, especially
        // after `follow_all` has run once.
        if !link.is_valid() {
            return ref_;
        }

        // Phase 1: find the root. `link.is_valid()` holds here. The only
        // writers of `Symbol::link` are (a) the default `Ref::NONE`
        // (tag=Invalid — rejected by `is_valid()` above), (b) `merge()`,
        // which stores a Ref that came from `declare_symbol` / `new_symbol` /
        // `LinkerGraph::generate_symbol`, and (c) prior `follow()` path
        // compression, which stores a `root` that itself satisfied (b). All
        // such refs satisfy the in-bounds contract (see `get_const`):
        // `(source_index, inner_index)` with tag ∈ {Symbol, AllocatedName},
        // never `SourceContentsSlice` and never the null source sentinel.
        let outer = self.symbols_for_source.as_slice();
        let lookup = |r: Ref| -> &Symbol {
            debug_assert!(!r.is_source_contents_slice());
            &outer[r.source_index() as usize][r.inner_index() as usize]
        };

        let mut root = link;
        loop {
            let next = lookup(root).link.get();
            if !next.is_valid() {
                break;
            }
            root = next;
        }

        // Phase 2: path compression. Rewrite `link` on the entry node and every
        // intermediate node to point directly at `root`. The `!=` gate avoids
        // a redundant store when the chain was already length-1. `link` is
        // `Cell<Ref>`, so writes go through `&Symbol` safely.
        if !link.eql(root) {
            symbol.link.set(root);
            loop {
                let p = lookup(link);
                let next = p.link.get();
                // `next.eql(root)` ⇔ `p.link` already points at root —
                // saves a redundant store on the last intermediate plus the
                // otherwise-wasted lookup of `root` itself.
                if next.eql(root) || !next.is_valid() {
                    break;
                }
                p.link.set(root);
                link = next;
            }
        }

        root
    }
}

impl Symbol {
    #[inline]
    pub fn is_hoisted(&self) -> bool {
        Symbol::is_kind_hoisted(self.kind)
    }

    // Rust cannot alias inherent methods; forward explicitly.
    #[inline]
    pub fn is_kind_function(kind: Kind) -> bool {
        kind.is_function()
    }
    #[inline]
    pub(crate) fn is_kind_hoisted(kind: Kind) -> bool {
        kind.is_hoisted()
    }
    #[inline]
    pub(crate) fn is_kind_hoisted_or_function(kind: Kind) -> bool {
        kind.is_hoisted_or_function()
    }
    #[inline]
    pub fn is_kind_private(kind: Kind) -> bool {
        kind.is_private()
    }
}

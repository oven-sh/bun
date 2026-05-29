use core::sync::atomic::{AtomicU32, Ordering};
use std::cell::Cell;

use crate::ImportItemStatus;
use crate::base::Ref;
use crate::g as G;

pub struct Symbol {
    pub original_name: crate::StoreStr,

    pub namespace_alias: Option<G::NamespaceAlias>,

    pub link: Cell<Ref>,

    pub use_count_estimate: u32,

    pub chunk_index: AtomicU32,

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

    pub import_item_status: ImportItemStatus,

    pub private_symbol_must_be_lowered: bool,

    pub remove_overwritten_function_declaration: bool,

    /// Used in HMR to decide when live binding code is needed.
    pub has_been_assigned_to: bool,
}

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

    Hoisted,
    HoistedFunction,

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
    pub fn is_private(self) -> bool {
        (self as u8) >= (Kind::PrivateField as u8)
            && (self as u8) <= (Kind::PrivateStaticGetSetPair as u8)
    }

    #[inline]
    pub fn is_hoisted(self) -> bool {
        matches!(self, Kind::Hoisted | Kind::HoistedFunction)
    }

    #[inline]
    pub fn is_hoisted_or_function(self) -> bool {
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
pub type NestedList = Vec<Vec<Symbol>>;

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

    pub fn assign_chunk_index(&self, decls_: &crate::DeclaredSymbolList, chunk_index: u32) {
        use crate::DeclaredSymbol;
        struct Iterator<'a> {
            map: &'a Map,
            chunk_index: u32,
        }

        impl Iterator<'_> {
            pub(crate) fn next(&mut self, ref_: Ref) {
                let symbol = self.map.get_const(ref_).unwrap();
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
        // Zig: `arena.alloc([]Symbol, sourceCount)` (default_allocator) then NestedList.init.
        let mut v: NestedList = Vec::with_capacity(source_count);
        v.resize_with(source_count, Vec::new);
        Map {
            symbols_for_source: v,
        }
    }

    pub fn init_with_one_list(list: Vec<Symbol>) -> Map {
        Self::init_list(vec![list])
    }

    pub fn init_list(list: NestedList) -> Map {
        Map {
            symbols_for_source: list,
        }
    }

    pub fn get_mut(&mut self, ref_: Ref) -> Option<&mut Symbol> {
        if Ref::is_source_index_null(ref_.source_index()) || ref_.is_source_contents_slice() {
            return None;
        }
        let src = ref_.source_index() as usize;
        let idx = ref_.inner_index() as usize;
        self.symbols_for_source.get_mut(src)?.get_mut(idx)
    }

    pub fn get_with_link(&self, ref_: Ref) -> Option<*mut Symbol> {
        let symbol_ptr = self.get(ref_)?;
        // Read `link` through the safe shared accessor (same indices as `get`);
        // the raw `*mut` is only forwarded to the caller, never derefed here.
        let symbol = self.get_const(ref_)?;
        if symbol.has_link() {
            return Some(self.get(symbol.link.get()).unwrap_or(symbol_ptr));
        }
        Some(symbol_ptr)
    }

    pub fn get_with_link_const(&self, ref_: Ref) -> Option<&Symbol> {
        let symbol = self.get_const(ref_)?;
        if symbol.has_link() {
            return Some(self.get_const(symbol.link.get()).unwrap_or(symbol));
        }
        Some(symbol)
    }

    pub fn follow_all(&mut self) {
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

        if !link.eql(root) {
            symbol.link.set(root);
            loop {
                let p = lookup(link);
                let next = p.link.get();
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

// ported from: src/js_parser/ast/Symbol.zig

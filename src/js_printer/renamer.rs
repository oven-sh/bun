use core::cmp::Ordering;
use core::mem::ManuallyDrop;
use std::io::Write as _;

use bun_alloc::Arena as Bump;

use bun_ast as js_ast;
use bun_ast::lexer_tables::{
    self as js_lexer, KEYWORDS as Keywords, STRICT_MODE_RESERVED_WORDS as StrictModeReservedWords,
};
use bun_ast::symbol;
use bun_ast::symbol::{INVALID_NESTED_SCOPE_SLOT, SlotNamespace};
use bun_ast::{Ref, Symbol};
use bun_collections::hive_array::Fallback as HiveArrayFallback;
use bun_collections::{HashMap, StringHashMap, VecExt};
use bun_core::Output;
use bun_core::{MutableString, immutable as strings};
use bun_options_types::Format;
use enum_map::EnumMap;

/// Renamed-name strings are either borrowed from `Symbol.original_name` (AST
/// arena) or duped into the renamer's `bumpalo::Bump` arena. `StoreStr` is the
/// arena-backed lifetime-erased slice wrapper that centralises the raw deref
/// (one `unsafe` in `StoreStr::slice`), so the renamer's name-table reads stay
/// safe. Phase B may later thread `'bump` and rewrite to `&'bump [u8]`.
type NameStr = bun_ast::StoreStr;

#[inline]
const fn name_str_empty() -> NameStr {
    bun_ast::StoreStr::EMPTY
}

/// Const array for `inline for (SlotNamespace.values)` translation. Skips
/// `MustNotBeRenamed` (Zig's `inline for` over the renameable namespaces).
const SLOT_NAMESPACES: [SlotNamespace; 4] = [
    SlotNamespace::Default,
    SlotNamespace::Label,
    SlotNamespace::PrivateName,
    SlotNamespace::MangledProp,
];

pub struct NoOpRenamer<'a> {
    // PORT NOTE: Zig `Symbol.Map` is a non-owning `BabyList(BabyList(Symbol))`
    // slice header passed by value (renamer.zig:2,126,452 — no `deinit` ever
    // frees it). In the Rust port `symbol::Map` is `Vec<Vec<Symbol>>` (owning).
    // Unlike `MinifyRenamer`/`NumberRenamer` (which the bundler builds over a
    // *borrowed* `LinkerGraph.symbols` and so wrap in `ManuallyDrop`),
    // `NoOpRenamer` is only constructed by `print_ast`/`print_common_js`, whose
    // callers always pass an *owned* Map freshly built by
    // `Map::init_with_one_list(mem::take(&mut ast.symbols))`. Owning + dropping
    // here is required: `ManuallyDrop` leaked the per-file `Vec<Symbol>` on
    // every transpile (require-cache.test.ts "files transpiled and loaded don't
    // leak the output source code" — `await import()` re-transpiles each
    // iteration, so the leak compounds to OOM).
    pub symbols: symbol::Map,
    pub source: &'a bun_ast::Source,
}

impl<'a> NoOpRenamer<'a> {
    pub fn init(symbols: symbol::Map, source: &'a bun_ast::Source) -> NoOpRenamer<'a> {
        NoOpRenamer { symbols, source }
    }

    #[inline]
    pub fn original_name(&self, ref_: Ref) -> &[u8] {
        self.name_for_symbol(ref_)
    }

    pub fn name_for_symbol(&self, ref_: Ref) -> &[u8] {
        if ref_.is_source_contents_slice() {
            return &self.source.contents[ref_.source_index() as usize
                ..(ref_.source_index() + ref_.inner_index()) as usize];
        }

        let resolved = self.symbols.follow(ref_);

        if let Some(symbol) = self.symbols.get_const(resolved) {
            // SAFETY: `original_name` is an AST-arena slice that outlives the renamer.
            symbol.original_name.slice()
        } else {
            // TODO(port): include `self.source.path.text` once `bun_paths::fs::Path<'static>`
            // exposes the text accessor.
            Output::panic(format_args!("Invalid symbol {}", ref_));
        }
    }

    pub fn to_renamer(&mut self) -> Renamer<'_, 'a> {
        Renamer::NoOpRenamer(self)
    }
}

// PORT NOTE: two lifetime params — `'r` is the borrow of the underlying renamer,
// `'src` is `NoOpRenamer`'s borrow of the `Source`. The Zig `Renamer` was a
// tag+ptr union that erased both; using `&'a mut NoOpRenamer<'a>` would make
// `'a` invariant and lock the source borrow to the renamer borrow.
pub enum Renamer<'r, 'src> {
    NumberRenamer(&'r mut NumberRenamer),
    NoOpRenamer(&'r mut NoOpRenamer<'src>),
    MinifyRenamer(&'r mut MinifyRenamer),
}

impl<'r, 'src> Renamer<'r, 'src> {
    pub fn symbols(&self) -> &symbol::Map {
        match self {
            Renamer::NumberRenamer(r) => &r.symbols,
            Renamer::NoOpRenamer(r) => &r.symbols,
            Renamer::MinifyRenamer(r) => &r.symbols,
        }
    }

    pub fn name_for_symbol(&mut self, ref_: Ref) -> &[u8] {
        match self {
            Renamer::NumberRenamer(r) => r.name_for_symbol(ref_),
            Renamer::NoOpRenamer(r) => r.name_for_symbol(ref_),
            Renamer::MinifyRenamer(r) => r.name_for_symbol(ref_),
        }
    }

    pub fn original_name(&self, ref_: Ref) -> Option<&[u8]> {
        match self {
            Renamer::NumberRenamer(r) => Some(r.original_name(ref_)),
            Renamer::NoOpRenamer(r) => Some(r.original_name(ref_)),
            Renamer::MinifyRenamer(r) => r.original_name(ref_),
        }
    }
}

// PORT NOTE: Zig `Renamer.deinit` freed NumberRenamer/MinifyRenamer internals.
// In Rust all three variants are `&'r mut` (caller-owned, Drop on caller's
// storage). No explicit deinit needed.

#[derive(Clone, Copy)]
pub struct SymbolSlot {
    // Most minified names are under 15 bytes
    // Instead of allocating a string for every symbol slot
    // We can store the string inline!
    // But we have to be very careful of where it's used.
    // Or we WILL run into memory bugs.
    pub name: TinyString,
    pub count: u32,
    pub needs_capital_for_jsx: bool,
}

impl Default for SymbolSlot {
    fn default() -> Self {
        SymbolSlot {
            name: TinyString::String(name_str_empty()),
            count: 0,
            needs_capital_for_jsx: false,
        }
    }
}

pub type SymbolSlotList = EnumMap<symbol::SlotNamespace, Vec<SymbolSlot>>;

#[derive(Clone, Copy, Default)]
pub struct InlineString {
    pub bytes: [u8; 15],
    pub len: u8,
}

impl InlineString {
    pub fn init(str_: &[u8]) -> InlineString {
        let mut this = InlineString::default();
        this.len = u8::try_from(str_.len().min(15)).expect("int cast");
        for (b, c) in this.bytes[0..this.len as usize]
            .iter_mut()
            .zip(&str_[0..this.len as usize])
        {
            *b = *c;
        }
        this
    }

    // do not make this *const or you will run into memory bugs.
    // we cannot let the compiler decide to copy this struct because
    // that would cause this to become a pointer to stack memory.
    pub fn slice(&mut self) -> &[u8] {
        &self.bytes[0..self.len as usize]
    }
}

#[derive(Clone, Copy)]
pub enum TinyString {
    InlineString(InlineString),
    // Arena-owned slice when len > 15 (allocated from `MinifyRenamer.arena`).
    String(NameStr),
}

impl TinyString {
    pub fn init(input: &[u8], arena: &Bump) -> Result<TinyString, bun_alloc::AllocError> {
        if input.len() <= 15 {
            Ok(TinyString::InlineString(InlineString::init(input)))
        } else {
            // Zig: `allocator.dupe(u8, input)` — allocate into the renamer arena.
            let duped: &[u8] = arena.alloc_slice_copy(input);
            Ok(TinyString::String(bun_ast::StoreStr::new(duped)))
        }
    }

    // do not make this *const or you will run into memory bugs.
    // we cannot let the compiler decide to copy this struct because
    // that would cause this to become a pointer to stack memory.
    pub fn slice(&mut self) -> &[u8] {
        match self {
            TinyString::InlineString(s) => s.slice(),
            // `StoreStr::slice` centralises the arena-backed deref; the payload
            // outlives `self` (the arena lives on the owning renamer).
            TinyString::String(s) => s.slice(),
        }
    }
}

pub struct MinifyRenamer {
    pub reserved_names: StringHashMap<u32>,
    pub slots: SymbolSlotList,
    pub top_level_symbol_to_slot: TopLevelSymbolSlotMap,
    // PORT NOTE: see `NoOpRenamer.symbols` — non-owning view; Zig
    // `MinifyRenamer.deinit` (renamer.zig:156) never frees `symbols`.
    pub symbols: ManuallyDrop<symbol::Map>,
    /// Backs `TinyString::String` slot-name allocations (Zig: `this.allocator`).
    pub arena: Bump,
}

// TODO(port): Zig used `std.HashMapUnmanaged(Ref, usize, RefCtx, 80)` —
// bun_collections::HashMap should be parameterized with RefCtx hasher.
pub type TopLevelSymbolSlotMap = HashMap<Ref, usize>;

impl MinifyRenamer {
    pub fn init(
        symbols: symbol::Map,
        first_top_level_slots: js_ast::SlotCounts,
        reserved_names: StringHashMap<u32>,
    ) -> Result<Box<MinifyRenamer>, bun_alloc::AllocError> {
        let mut slots = SymbolSlotList::default();

        for (ns, &count) in first_top_level_slots.slots.iter() {
            let count = count as usize;
            let mut v = Vec::with_capacity(count);
            v.resize(count, SymbolSlot::default());
            slots[ns] = v;
        }

        Ok(Box::new(MinifyRenamer {
            symbols: ManuallyDrop::new(symbols),
            reserved_names,
            slots,
            top_level_symbol_to_slot: TopLevelSymbolSlotMap::default(),
            arena: Bump::new(),
        }))
    }

    pub fn to_renamer(&mut self) -> Renamer<'_, 'static> {
        Renamer::MinifyRenamer(self)
    }

    pub fn name_for_symbol(&mut self, ref_: Ref) -> &[u8] {
        let ref_ = self.symbols.follow(ref_);
        let symbol: &Symbol = self.symbols.get_const(ref_).unwrap();

        let ns = symbol.slot_namespace();
        if ns == SlotNamespace::MustNotBeRenamed {
            // SAFETY: `original_name` is an AST-arena slice that outlives the renamer.
            return symbol.original_name.slice();
        }

        let i = match symbol
            .nested_scope_slot()
            .map(|s| s as usize)
            .or_else(|| self.top_level_symbol_to_slot.get(&ref_).copied())
        {
            Some(i) => i,
            // SAFETY: as above.
            None => return symbol.original_name.slice(),
        };

        // This has to be a pointer because the string might be stored inline
        self.slots[ns][i].name.slice()
    }

    pub fn original_name(&self, _ref: Ref) -> Option<&[u8]> {
        None
    }

    pub fn accumulate_symbol_use_counts(
        &mut self,
        top_level_symbols: &mut Vec<StableSymbolCount>,
        symbol_uses: &js_ast::part::SymbolUseMap,
        stable_source_indices: &[u32],
    ) -> Result<(), bun_alloc::AllocError> {
        // PORT NOTE: ArrayHashMap exposes parallel keys()/values() slices, no .iter().
        for (key, value) in symbol_uses.keys().iter().zip(symbol_uses.values().iter()) {
            self.accumulate_symbol_use_count(
                top_level_symbols,
                *key,
                value.count_estimate,
                stable_source_indices,
            )?;
        }
        Ok(())
    }

    pub fn accumulate_symbol_use_count(
        &mut self,
        top_level_symbols: &mut Vec<StableSymbolCount>,
        ref_: Ref,
        count: u32,
        stable_source_indices: &[u32],
    ) -> Result<(), bun_alloc::AllocError> {
        let mut ref_ = self.symbols.follow(ref_);
        let mut symbol: &Symbol = self.symbols.get_const(ref_).unwrap();

        while let Some(alias) = &symbol.namespace_alias {
            let new_ref = self.symbols.follow(alias.namespace_ref);
            if new_ref.eql(ref_) {
                break;
            }
            ref_ = new_ref;
            symbol = self.symbols.get_const(new_ref).unwrap();
        }

        let ns = symbol.slot_namespace();
        if ns == SlotNamespace::MustNotBeRenamed {
            return Ok(());
        }

        if let Some(i) = symbol.nested_scope_slot() {
            let slot = &mut self.slots[ns][i as usize];
            slot.count += count;
            if symbol.must_start_with_capital_letter_for_jsx {
                slot.needs_capital_for_jsx = true;
            }
            return Ok(());
        }

        top_level_symbols.push(StableSymbolCount {
            stable_source_index: stable_source_indices[ref_.source_index() as usize],
            ref_,
            count,
        });
        Ok(())
    }

    pub fn allocate_top_level_symbol_slots(
        &mut self,
        top_level_symbols: &[StableSymbolCount],
    ) -> Result<(), bun_alloc::AllocError> {
        for stable in top_level_symbols {
            let symbol: &Symbol = self.symbols.get_const(stable.ref_).unwrap();
            // PORT NOTE: reshaped for borrowck — capture symbol fields before mut-borrowing slots
            let ns = symbol.slot_namespace();
            let must_start_with_capital = symbol.must_start_with_capital_letter_for_jsx;
            let slots = &mut self.slots[ns];

            let gpe = self.top_level_symbol_to_slot.get_or_put(stable.ref_)?;
            if gpe.found_existing {
                let slot = &mut slots[*gpe.value_ptr];
                slot.count += stable.count;
                if must_start_with_capital {
                    slot.needs_capital_for_jsx = true;
                }
            } else {
                *gpe.value_ptr = slots.len();
                slots.push(SymbolSlot {
                    name: TinyString::String(name_str_empty()),
                    count: stable.count,
                    needs_capital_for_jsx: must_start_with_capital,
                });
            }
        }
        Ok(())
    }

    pub fn assign_names_by_frequency(
        &mut self,
        name_minifier: &js_ast::NameMinifier,
    ) -> Result<(), bun_core::Error> {
        let mut name_buf: Vec<u8> = Vec::with_capacity(64);

        let mut sorted: Vec<SlotAndCount> = Vec::new();

        // PERF(port): was `inline for` over enum values — profile
        for &ns in SLOT_NAMESPACES.iter() {
            let slots = &mut self.slots[ns];
            sorted.clear();
            sorted.extend(slots.iter().enumerate().map(|(i, slot)| SlotAndCount {
                slot: u32::try_from(i).expect("int cast"),
                count: slot.count,
            }));
            sorted.sort_unstable_by(SlotAndCount::less_than);

            let mut next_name: isize = 0;

            for data in sorted.iter() {
                name_minifier.number_to_minified_name(&mut name_buf, next_name)?;
                next_name += 1;

                // Make sure we never generate a reserved name. We only have to worry
                // about collisions with reserved identifiers for normal symbols, and we
                // only have to worry about collisions with keywords for labels. We do
                // not have to worry about either for private names because they start
                // with a "#" character.
                match ns {
                    symbol::SlotNamespace::Default => {
                        while self.reserved_names.contains_key(name_buf.as_slice()) {
                            name_minifier.number_to_minified_name(&mut name_buf, next_name)?;
                            next_name += 1;
                        }

                        if slots[data.slot as usize].needs_capital_for_jsx {
                            while name_buf[0] >= b'a' && name_buf[0] <= b'z' {
                                name_minifier.number_to_minified_name(&mut name_buf, next_name)?;
                                next_name += 1;
                            }
                        }
                    }
                    symbol::SlotNamespace::Label => {
                        while js_lexer::keyword(name_buf.as_slice()).is_some() {
                            name_minifier.number_to_minified_name(&mut name_buf, next_name)?;
                            next_name += 1;
                        }
                    }
                    symbol::SlotNamespace::PrivateName => {
                        name_buf.insert(0, b'#');
                    }
                    _ => {}
                }

                slots[data.slot as usize].name =
                    TinyString::init(name_buf.as_slice(), &self.arena).expect("unreachable");
            }
        }
        Ok(())
    }
}

pub fn assign_nested_scope_slots(
    module_scope: &js_ast::Scope,
    symbols: &mut [Symbol],
) -> js_ast::SlotCounts {
    let mut slot_counts = js_ast::SlotCounts::default();
    let mut sorted_members: Vec<u32> = Vec::new();

    // Temporarily set the nested scope slots of top-level symbols to valid so
    // they aren't renamed in nested scopes. This prevents us from accidentally
    // assigning nested scope slots to variables declared using "var" in a nested
    // scope that are actually hoisted up to the module scope to become a top-
    // level symbol.
    let valid_slot: u32 = 0;
    for member in module_scope.members.values() {
        symbols[member.ref_.inner_index() as usize].nested_scope_slot = valid_slot;
    }
    for ref_ in module_scope.generated.slice() {
        symbols[ref_.inner_index() as usize].nested_scope_slot = valid_slot;
    }

    for child in module_scope.children.slice() {
        // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
        slot_counts.union_max(assign_nested_scope_slots_helper(
            &mut sorted_members,
            child,
            symbols,
            js_ast::SlotCounts::default(),
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
    scope: &js_ast::Scope,
    symbols: &mut [Symbol],
    slot_to_copy: js_ast::SlotCounts,
) -> js_ast::SlotCounts {
    let mut slot = slot_to_copy;

    // Sort member map keys for determinism
    {
        sorted_members.clear();
        sorted_members.extend(scope.members.values().map(|m| m.ref_.inner_index()));
        let sorted_members_buf = sorted_members.as_mut_slice();
        sorted_members_buf.sort_unstable();

        // Assign slots for this scope's symbols. Only do this if the slot is
        // not already assigned. Nested scopes have copies of symbols from parent
        // scopes and we want to use the slot from the parent scope, not child scopes.
        for &inner_index in sorted_members_buf.iter() {
            let symbol = &mut symbols[inner_index as usize];
            let ns = symbol.slot_namespace();
            if ns != symbol::SlotNamespace::MustNotBeRenamed && symbol.nested_scope_slot().is_none()
            {
                symbol.nested_scope_slot = slot.slots[ns];
                slot.slots[ns] += 1;
            }
        }
    }

    for ref_ in scope.generated.slice() {
        let symbol = &mut symbols[ref_.inner_index() as usize];
        let ns = symbol.slot_namespace();
        if ns != symbol::SlotNamespace::MustNotBeRenamed && symbol.nested_scope_slot().is_none() {
            symbol.nested_scope_slot = slot.slots[ns];
            slot.slots[ns] += 1;
        }
    }

    // Labels are always declared in a nested scope, so we don't need to check.
    if let Some(ref_) = scope.label_ref {
        let symbol = &mut symbols[ref_.inner_index() as usize];
        let ns = symbol::SlotNamespace::Label;
        symbol.nested_scope_slot = slot.slots[ns];
        slot.slots[ns] += 1;
    }

    // Assign slots for the symbols of child scopes
    let mut slot_counts = slot.clone();
    for child in scope.children.slice() {
        // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
        slot_counts.union_max(assign_nested_scope_slots_helper(
            sorted_members,
            child,
            symbols,
            slot.clone(),
        ));
    }

    slot_counts
}

#[derive(Clone, Copy)]
pub struct StableSymbolCount {
    pub stable_source_index: u32,
    pub ref_: Ref,
    pub count: u32,
}

pub type StableSymbolCountArray = Vec<StableSymbolCount>;

impl StableSymbolCount {
    pub fn less_than(i: &StableSymbolCount, j: &StableSymbolCount) -> Ordering {
        if i.count > j.count {
            return Ordering::Less;
        }
        if i.count < j.count {
            return Ordering::Greater;
        }
        if i.stable_source_index < j.stable_source_index {
            return Ordering::Less;
        }
        if i.stable_source_index > j.stable_source_index {
            return Ordering::Greater;
        }

        i.ref_.inner_index().cmp(&j.ref_.inner_index())
    }
}

// PORT NOTE: Zig `packed struct(u64)`. Packed layout is not load-bearing here
// (never bitcast/FFI — only sorted in a local Vec), so two named u32 fields
// instead of a #[repr(transparent)] u64 with shift accessors.
#[repr(C)]
#[derive(Clone, Copy)]
struct SlotAndCount {
    slot: u32,
    count: u32,
}

type SlotAndCountArray = Vec<SlotAndCount>;

impl SlotAndCount {
    fn less_than(a: &SlotAndCount, b: &SlotAndCount) -> Ordering {
        if a.count > b.count || (a.count == b.count && a.slot < b.slot) {
            Ordering::Less
        } else {
            Ordering::Greater
        }
    }
}

pub struct NumberRenamer {
    // PORT NOTE: see `NoOpRenamer.symbols` — non-owning view; Zig
    // `NumberRenamer.deinit` (renamer.zig:462) never frees `symbols`.
    pub symbols: ManuallyDrop<symbol::Map>,
    pub names: Box<[Vec<NameStr>]>,
    // PERF(port): Zig had separate allocator/temp_allocator; global mimalloc now
    pub number_scope_pool: HiveArrayFallback<NumberScope, 128>,
    // PERF(port): was arena bulk-free for NumberScope pool + name temp buffers
    pub root: NumberScope,
    /// Backs renamed-name slices written into `names` (Zig: `r.allocator`).
    pub arena: Bump,
    // PERF(port): was StackFallbackAllocator(512) — profile
}

impl NumberRenamer {
    pub fn to_renamer(&mut self) -> Renamer<'_, 'static> {
        Renamer::NumberRenamer(self)
    }

    pub fn original_name(&self, ref_: Ref) -> &[u8] {
        if ref_.is_source_contents_slice() {
            unreachable!();
        }

        let resolved = self.symbols.follow(ref_);
        // SAFETY: `original_name` is an AST-arena slice that outlives the renamer.
        self.symbols
            .get_const(resolved)
            .unwrap()
            .original_name
            .slice()
    }

    pub fn assign_name(&mut self, scope: &mut NumberScope, input_ref: Ref) {
        let ref_ = self.symbols.follow(input_ref);

        // Don't rename the same symbol more than once
        let inner: &mut Vec<NameStr> = &mut self.names[ref_.source_index() as usize];
        if inner.len() > ref_.inner_index() as usize && inner[ref_.inner_index() as usize].len() > 0
        {
            return;
        }

        // Don't rename unbound symbols, symbols marked as reserved names, labels, or private names
        let symbol: &Symbol = self.symbols.get_const(ref_).unwrap();
        if symbol.slot_namespace() != SlotNamespace::Default {
            return;
        }

        // SAFETY: `original_name` is an AST-arena slice that outlives the renamer.
        let original_name: &[u8] = symbol.original_name.slice();
        // PERF(port): Zig reset stack-fallback FBA here; arena reset semantics differ
        let name: NameStr = match scope.find_unused_name(&self.arena, original_name) {
            UnusedName::Renamed(name) => name,
            UnusedName::NoCollision => symbol.original_name,
        };
        let new_len = inner.len().max(ref_.inner_index() as usize + 1);
        if inner.len() < new_len {
            inner.resize(new_len, name_str_empty());
        }
        inner[ref_.inner_index() as usize] = name;
    }

    pub fn init(
        symbols: symbol::Map,
        root_names: StringHashMap<u32>,
    ) -> Result<Box<NumberRenamer>, bun_alloc::AllocError> {
        let len = symbols.symbols_for_source.len();
        let names: Box<[Vec<NameStr>]> = core::iter::repeat_with(Vec::<NameStr>::default)
            .take(len)
            .collect();

        // PERF(port): HiveArray.Fallback was bound to arena.arena() in Zig
        let number_scope_pool = HiveArrayFallback::<NumberScope, 128>::init();

        let mut root = NumberScope::default();
        root.name_counts = root_names;

        // TODO(b2-blocked): bun_core::env_var::BUN_DUMP_SYMBOLS — typed accessor
        // not yet declared upstream; debug-only `symbols.dump()` call elided.

        // PORT NOTE: Zig @memset(sliceAsBytes(names), 0) — Vec::default() is already zeroed.

        Ok(Box::new(NumberRenamer {
            symbols: ManuallyDrop::new(symbols),
            names,
            number_scope_pool,
            root,
            arena: Bump::new(),
        }))
    }

    pub fn assign_names_recursive(
        &mut self,
        scope: &js_ast::Scope,
        source_index: u32,
        parent: Option<bun_ptr::ParentRef<NumberScope>>,
        sorted: &mut Vec<u32>,
    ) {
        let s: *mut NumberScope = self.number_scope_pool.get();
        // SAFETY: `s` is a valid pool slot (HiveArrayFallback::get never returns null).
        unsafe {
            s.write(NumberScope {
                parent,
                name_counts: StringHashMap::default(),
            });
        }

        self.assign_names_recursive_with_number_scope(s, scope, source_index, sorted);

        // PORT NOTE: Zig `defer { s.deinit(); pool.put(s) }` — fn is infallible,
        // so no scopeguard needed; cleanup runs unconditionally below.
        // SAFETY: s came from number_scope_pool.get() and was initialized above;
        // `put` drops `name_counts` in place before recycling the slot.
        unsafe { self.number_scope_pool.put(s) };
    }

    fn assign_names_in_scope(
        &mut self,
        s: &mut NumberScope,
        scope: &js_ast::Scope,
        source_index: u32,
        sorted: &mut Vec<u32>,
    ) {
        {
            sorted.clear();
            sorted.extend(scope.members.values().map(|value_ref| {
                debug_assert!(!value_ref.ref_.is_source_contents_slice());
                value_ref.ref_.inner_index()
            }));
            debug_assert_eq!(sorted.len(), scope.members.count());
            sorted.sort_unstable();

            for &inner_index in sorted.iter() {
                self.assign_name(
                    s,
                    Ref::init(
                        u32::try_from(inner_index).expect("int cast"),
                        source_index,
                        false,
                    ),
                );
            }
        }

        for ref_ in scope.generated.slice() {
            self.assign_name(s, *ref_);
        }
    }

    pub fn assign_names_recursive_with_number_scope(
        &mut self,
        initial_scope: *mut NumberScope,
        scope_: &js_ast::Scope,
        source_index: u32,
        sorted: &mut Vec<u32>,
    ) {
        let mut s: *mut NumberScope = initial_scope;
        let mut scope = scope_;
        // TODO(port): defer cleanup of `s` if s != initial_scope — handled at end

        loop {
            if scope.members.count() > 0 || scope.generated.len_u32() > 0 {
                let new_child_scope: *mut NumberScope = self.number_scope_pool.get();
                // SAFETY: `new_child_scope` is a valid pool slot.
                unsafe {
                    new_child_scope.write(NumberScope {
                        // `s` is non-null (either `initial_scope` or a fresh
                        // pool slot from a prior iteration); the new child
                        // outlives this `ParentRef` only until `put()` below.
                        parent: Some(bun_ptr::ParentRef::from(
                            core::ptr::NonNull::new(s).expect("number_scope non-null"),
                        )),
                        name_counts: StringHashMap::default(),
                    });
                }
                s = new_child_scope;

                // SAFETY: s is a valid pool slot just initialized above
                self.assign_names_in_scope(unsafe { &mut *s }, scope, source_index, sorted);
            }

            if scope.children.len_u32() == 1 {
                // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
                scope = scope.children.at(0).get();
            } else {
                break;
            }
        }

        // Symbols in child scopes may also have to be renamed to avoid conflicts
        for child in scope.children.slice() {
            // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
            self.assign_names_recursive_with_number_scope(s, child, source_index, sorted);
        }

        // PORT NOTE: Zig (renamer.zig:594-598) only put the final `s` because
        // both the pool fallback (`.init(renamer.arena.allocator())`) and
        // `name_counts` data lived in arenas bulk-freed by `NumberRenamer.deinit
        // -> arena.deinit()`. The Rust port moved both to the global heap
        // (HiveArrayFallback::init() uses Box, StringHashMap uses global alloc),
        // so we must walk the parent chain and `put` every intermediate scope
        // we allocated in the loop above — not just the deepest one.
        while s != initial_scope {
            // SAFETY: `s` is a pool slot we allocated and initialized in the
            // loop above; every such slot has `parent: Some(...)`. Read parent
            // before `put` (which drops/frees the slot).
            let parent = unsafe { (*s).parent }
                .map(|p| p.as_mut_ptr())
                .unwrap_or(initial_scope);
            // SAFETY: `s` came from `number_scope_pool.get()` in the loop above
            // and was fully initialized; `put` drops `name_counts` in place
            // before recycling/freeing the slot.
            unsafe { self.number_scope_pool.put(s) };
            s = parent;
        }
    }

    pub fn add_top_level_symbol(&mut self, ref_: Ref) {
        // PORT NOTE: reshaped for borrowck — root is a field of self
        // TODO(port): self.assign_name needs &mut self AND &mut self.root simultaneously
        let root: *mut NumberScope = &raw mut self.root;
        // SAFETY: assign_name does not touch self.root through `self`
        self.assign_name(unsafe { &mut *root }, ref_);
    }

    pub fn add_top_level_declared_symbols(
        &mut self,
        declared_symbols: &mut js_ast::DeclaredSymbolList,
    ) {
        js_ast::DeclaredSymbol::for_each_top_level_symbol(declared_symbols, self, |r, ref_| {
            r.add_top_level_symbol(ref_)
        });
    }

    pub fn name_for_symbol(&self, ref_: Ref) -> &[u8] {
        if ref_.is_source_contents_slice() {
            unreachable!("Unexpected unbound symbol!\n{}", ref_);
        }

        let resolved = self.symbols.follow(ref_);

        let source_index = resolved.source_index();
        let inner_index = resolved.inner_index();

        let renamed_list = &self.names[source_index as usize];

        if renamed_list.len() > inner_index as usize {
            let renamed: NameStr = renamed_list[inner_index as usize];
            if renamed.raw_len() > 0 {
                // `StoreStr::slice` centralises the deref; allocated from
                // `self.arena` or borrows an AST-arena `original_name`, both
                // of which outlive `self`.
                return renamed.slice();
            }
        }

        // SAFETY: `original_name` is an AST-arena slice that outlives the renamer.
        self.symbols.symbols_for_source[source_index as usize][inner_index as usize]
            .original_name
            .slice()
    }
}

#[derive(Default)]
pub struct NumberScope {
    /// Backreference to the enclosing `NumberScope`. The parent is either
    /// `NumberRenamer::root` or a pool slot allocated earlier in the same
    /// `assign_names_recursive_with_number_scope` call, both of which strictly
    /// outlive this child (children are `put()` back before their parent), so
    /// `ParentRef::get()` is sound without per-site `unsafe`.
    pub parent: Option<bun_ptr::ParentRef<NumberScope>>,
    pub name_counts: StringHashMap<u32>,
}

pub enum NameUse {
    Unused,
    SameScope(u32),
    Used,
}

impl NameUse {
    pub fn find(this: &NumberScope, name: &[u8]) -> NameUse {
        // This version doesn't allocate
        #[cfg(debug_assertions)]
        debug_assert!(js_lexer::is_identifier(name));

        // avoid rehashing the same string over for each scope
        let ctx = bun_collections::StringHashMapContext::pre(name);

        if let Some(&count) = this.name_counts.get_adapted(name, &ctx) {
            return NameUse::SameScope(count);
        }

        let mut s: Option<bun_ptr::ParentRef<NumberScope>> = this.parent;

        while let Some(scope) = s {
            // `ParentRef<NumberScope>: Deref` — safe backref deref under the
            // parent-outlives-child invariant documented on the field.
            if scope.name_counts.contains_adapted(name, &ctx) {
                return NameUse::Used;
            }
            s = scope.parent;
        }

        NameUse::Unused
    }
}

pub enum UnusedName {
    NoCollision,
    Renamed(NameStr),
}

/// Fast-path for `MutableString::ensure_valid_identifier`: returns `true` iff
/// `s` is a non-empty ASCII identifier (`[A-Za-z_$][A-Za-z0-9_$]*`). This is
/// the exact condition under which Zig's `ensureValidIdentifier` returns the
/// input slice unchanged (modulo the strict-mode-reserved-word remap, handled
/// by the caller). The Rust port of that function currently always allocates
/// a `Box<[u8]>` even on the borrow path — see its `TODO(port)` — so hoisting
/// this check into the renamer restores Zig's zero-alloc behaviour for the
/// overwhelmingly common case (`symbol.original_name` is parser-produced and
/// almost always satisfies this).
#[inline]
fn is_simple_ascii_identifier(s: &[u8]) -> bool {
    let Some((&first, rest)) = s.split_first() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == b'_' || first == b'$') {
        return false;
    }
    for &c in rest {
        if !(c.is_ascii_alphanumeric() || c == b'_' || c == b'$') {
            return false;
        }
    }
    true
}

impl NumberScope {
    /// Caller must use an arena allocator
    pub fn find_unused_name(&mut self, arena: &Bump, input_name: &[u8]) -> UnusedName {
        // PORT NOTE: Zig's `MutableString.ensureValidIdentifier` borrows the
        // input when it is already a valid ASCII identifier; the Rust port
        // always heap-allocates (Box<[u8]>). Skip the call entirely for the
        // common case so this stays alloc-free, matching the .zig fast path.
        // The strict-mode-reserved-word remap (`let` → `_let`, etc.) is the
        // only transform that fires for an otherwise-valid ASCII name, so
        // gate on that too and fall through to the full normalizer when it
        // would apply.
        let owned_name;
        let mut name: &[u8] = if is_simple_ascii_identifier(input_name)
            && !bun_ast::lexer_tables::is_strict_mode_reserved_word(input_name)
        {
            input_name
        } else {
            owned_name = MutableString::ensure_valid_identifier(input_name).expect("unreachable");
            &owned_name
        };
        // PORT NOTE: hoisted from inside the match arm so `name` (which may borrow
        // it) stays valid through the trailing `eql_long`/dupe.
        let mut mutable_name = MutableString::init_empty();

        match NameUse::find(self, name) {
            NameUse::Unused => {}
            use_ => {
                let mut tries: u32 = if matches!(use_, NameUse::Used) {
                    1
                } else {
                    // To avoid O(n^2) behavior, the number must start off being the number
                    // that we used last time there was a collision with this name. Otherwise
                    // if there are many collisions with the same name, each name collision
                    // would have to increment the counter past all previous name collisions
                    // which is a O(n^2) time algorithm. Only do this if this symbol comes
                    // from the same scope as the previous one since sibling scopes can reuse
                    // the same name without problems.
                    match use_ {
                        NameUse::SameScope(n) => n,
                        _ => unreachable!(),
                    }
                };

                let prefix = name;

                tries += 1;

                mutable_name
                    .grow_if_needed(prefix.len() + 4)
                    .expect("unreachable");
                mutable_name.append_slice(prefix).expect("unreachable");
                mutable_name.append_int(tries as u64).expect("unreachable");

                match NameUse::find(self, mutable_name.slice()) {
                    NameUse::Unused => {
                        if matches!(use_, NameUse::SameScope(_)) {
                            // PORT NOTE: `StringHashMap::get_or_put` owns a boxed
                            // copy of `prefix` on insert, so the Zig key-dupe dance
                            // is unnecessary here.
                            let existing =
                                self.name_counts.get_or_put(prefix).expect("unreachable");
                            *existing.value_ptr = tries;
                        }
                        name = mutable_name.slice();
                    }
                    cur_use => loop {
                        mutable_name.reset_to(prefix.len());
                        mutable_name.append_int(tries as u64).expect("unreachable");

                        tries += 1;

                        match NameUse::find(self, mutable_name.slice()) {
                            NameUse::Unused => {
                                if matches!(cur_use, NameUse::SameScope(_)) {
                                    // PORT NOTE: as above — map owns its key copy.
                                    let existing =
                                        self.name_counts.get_or_put(prefix).expect("unreachable");
                                    *existing.value_ptr = tries;
                                }

                                name = mutable_name.slice();
                                break;
                            }
                            _ => {}
                        }
                    },
                }
            }
        }

        // Each name starts off with a count of 1 so that the first collision with
        // "name" is called "name2"
        if strings::eql_long(name, input_name, true) {
            self.name_counts
                .put_no_clobber(input_name, 1)
                .expect("unreachable");
            return UnusedName::NoCollision;
        }

        // Zig: `allocator.dupe(u8, name)` — allocate into the renamer arena.
        let duped: &[u8] = arena.alloc_slice_copy(name);
        let name: NameStr = bun_ast::StoreStr::new(duped);

        self.name_counts
            .put_no_clobber(duped, 1)
            .expect("unreachable");
        UnusedName::Renamed(name)
    }
}

pub struct ExportRenamer {
    pub string_buffer: MutableString,
    pub used: StringHashMap<u32>,
    pub count: isize,
    /// Backs renamed export-name slices returned to the caller (Zig: caller's allocator).
    pub arena: Bump,
}

impl ExportRenamer {
    pub fn init() -> ExportRenamer {
        ExportRenamer {
            string_buffer: MutableString::init_empty(),
            used: StringHashMap::default(),
            count: 0,
            arena: Bump::new(),
        }
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.used.clear();
        self.string_buffer.reset();
        // Per-chunk in `computeCrossChunkDependencies`. The method *name* is
        // already `clear_retaining_capacity`; honour that for the arena too.
        self.arena.reset_retain_with_limit(8 * 1024 * 1024);
    }

    pub fn next_renamed_name(&mut self, input: &[u8]) -> &[u8] {
        let entry = self.used.get_or_put(input).expect("unreachable");
        let mut tries: u32 = 1;
        if entry.found_existing {
            loop {
                self.string_buffer.reset();
                write!(
                    self.string_buffer.writer(),
                    "{}{}",
                    bstr::BStr::new(input),
                    tries
                )
                .expect("unreachable");
                tries += 1;
                let attempt: &[u8] = self.string_buffer.slice();
                // PORT NOTE: reshaped for borrowck — `get_or_put` borrows `self.used`
                // mutably, so allocate the arena copy first.
                let to_use: &[u8] = self.arena.alloc_slice_copy(attempt);
                let entry = self.used.get_or_put(to_use).expect("unreachable");
                if !entry.found_existing {
                    // PORT NOTE: `StringHashMap` owns a boxed copy of the key on
                    // insert; the Zig key-ptr write is unnecessary.
                    *entry.value_ptr = tries;

                    let entry = self.used.get_or_put(input).expect("unreachable");
                    *entry.value_ptr = tries;
                    // `to_use` borrows `self.arena` (disjoint from `self.used`
                    // above); returnable directly under split-borrow rules.
                    return to_use;
                }
            }
        } else {
            *entry.value_ptr = tries;
        }

        // PORT NOTE: Zig returned `entry.key_ptr.*` (the map's owned copy of `input`).
        // `StringHashMap` does not expose a key pointer; allocate a copy in `self.arena`
        // so the returned slice is tied to `&self` (sub-borrow of `&mut self`).
        self.arena.alloc_slice_copy(input)
    }

    pub fn next_minified_name(&mut self) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): narrow error set
        let name = js_ast::NameMinifier::default_number_to_minified_name(self.count)?;
        self.count += 1;
        Ok(name)
    }
}

pub fn compute_initial_reserved_names(
    output_format: Format,
) -> Result<StringHashMap<u32>, bun_alloc::AllocError> {
    #[cfg(target_arch = "wasm32")]
    {
        unreachable!();
    }

    let mut names = StringHashMap::<u32>::default();

    const EXTRAS: [&[u8]; 2] = [b"Promise", b"Require"];

    const CJS_NAMES: [&[u8]; 2] = [b"exports", b"module"];

    let cjs_names_len: u32 = if output_format == Format::Cjs {
        CJS_NAMES.len() as u32
    } else {
        0
    };

    names.ensure_total_capacity(
        cjs_names_len as usize
            + (Keywords.len() + StrictModeReservedWords.len() + 1 + EXTRAS.len()),
    )?;

    for keyword in Keywords.keys() {
        // PERF(port): was assume_capacity
        names.put_assume_capacity(keyword, 1);
    }

    for keyword in StrictModeReservedWords.iter() {
        // PERF(port): was assume_capacity
        names.put_assume_capacity(keyword, 1);
    }

    // Node contains code that scans CommonJS modules in an attempt to statically
    // detect the set of export names that a module will use. However, it doesn't
    // do any scope analysis so it can be fooled by local variables with the same
    // name as the CommonJS module-scope variables "exports" and "module". Avoid
    // using these names in this case even if there is not a risk of a name
    // collision because there is still a risk of node incorrectly detecting
    // something in a nested scope as an top-level export.
    if output_format == Format::Cjs {
        for name in CJS_NAMES {
            // PERF(port): was assume_capacity
            names.put_assume_capacity(name, 1);
        }
    }

    for extra in EXTRAS {
        // PERF(port): was assume_capacity
        names.put_assume_capacity(extra, 1);
    }

    Ok(names)
}

pub fn compute_reserved_names_for_scope(
    scope: &js_ast::Scope,
    symbols: &symbol::Map,
    names: &mut StringHashMap<u32>,
) {
    // PORT NOTE: Zig copied `names_.*` to a local and wrote back via defer.
    // In Rust we mutate through &mut directly.

    for member in scope.members.values() {
        let symbol: &Symbol = symbols.get_const(member.ref_).unwrap();
        if symbol.kind == symbol::Kind::Unbound || symbol.must_not_be_renamed {
            // SAFETY: `original_name` is an AST-arena slice.
            names
                .put(symbol.original_name.slice(), 1)
                .expect("unreachable");
        }
    }

    for ref_ in scope.generated.slice() {
        let symbol: &Symbol = symbols.get_const(*ref_).unwrap();
        if symbol.kind == symbol::Kind::Unbound || symbol.must_not_be_renamed {
            // SAFETY: `original_name` is an AST-arena slice.
            names
                .put(symbol.original_name.slice(), 1)
                .expect("unreachable");
        }
    }

    // If there's a direct "eval" somewhere inside the current scope, continue
    // traversing down the scope tree until we find it to get all reserved names
    if scope.contains_direct_eval {
        for child in scope.children.slice() {
            // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
            if child.contains_direct_eval {
                compute_reserved_names_for_scope(child, symbols, names);
            }
        }
    }
}

// ported from: src/js_printer/renamer.zig

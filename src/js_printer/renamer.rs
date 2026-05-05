use core::cmp::Ordering;
use std::io::Write as _;

// TYPE_ONLY: bun_bundler::options::Format → bun_options_types::Format
use bun_options_types::Format;
use bun_collections::{BabyList, HashMap, HiveArray, StringHashMap};
use bun_core::Output;
use bun_js_parser as js_ast;
use bun_js_parser::lexer as js_lexer;
use bun_js_parser::{Ref, Symbol};
use bun_logger as logger;
use bun_str::{strings, MutableString};
use enum_map::EnumMap;

// TODO(port): lifetime — renamed-name strings are either borrowed from
// `Symbol.original_name` (AST arena) or duped into the renamer's allocator.
// Phase A models them as `&'static [u8]`; Phase B should thread `'bump`.
type NameStr = &'static [u8];

pub struct NoOpRenamer<'a> {
    pub symbols: js_ast::symbol::Map,
    pub source: &'a logger::Source,
}

impl<'a> NoOpRenamer<'a> {
    pub fn init(symbols: js_ast::symbol::Map, source: &'a logger::Source) -> NoOpRenamer<'a> {
        NoOpRenamer { symbols, source }
    }

    #[inline]
    pub fn original_name(&self, ref_: Ref) -> &[u8] {
        self.name_for_symbol(ref_)
    }

    pub fn name_for_symbol(&self, ref_: Ref) -> &[u8] {
        if ref_.is_source_contents_slice() {
            return &self.source.contents
                [ref_.source_index() as usize..(ref_.source_index() + ref_.inner_index()) as usize];
        }

        let resolved = self.symbols.follow(ref_);

        if let Some(symbol) = self.symbols.get_const(resolved) {
            symbol.original_name
        } else {
            Output::panic(format_args!(
                "Invalid symbol {} in {}",
                ref_,
                bstr::BStr::new(&self.source.path.text)
            ));
        }
    }

    pub fn to_renamer(&mut self) -> Renamer<'_> {
        Renamer::NoOpRenamer(self)
    }
}

pub enum Renamer<'a> {
    NumberRenamer(&'a mut NumberRenamer),
    NoOpRenamer(&'a mut NoOpRenamer<'a>),
    MinifyRenamer(Box<MinifyRenamer>),
}

impl<'a> Renamer<'a> {
    pub fn symbols(&self) -> &js_ast::symbol::Map {
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
// In Rust, NumberRenamer is &'a mut (caller-owned, Drop on caller's stack) and
// MinifyRenamer is Box<_> (Drop on enum drop). No explicit deinit needed.

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
            name: TinyString::String(b""),
            count: 0,
            needs_capital_for_jsx: false,
        }
    }
}

pub type SymbolSlotList = EnumMap<js_ast::symbol::SlotNamespace, Vec<SymbolSlot>>;

#[derive(Clone, Copy, Default)]
pub struct InlineString {
    pub bytes: [u8; 15],
    pub len: u8,
}

impl InlineString {
    pub fn init(str_: &[u8]) -> InlineString {
        let mut this = InlineString::default();
        this.len = u8::try_from(str_.len().min(15)).unwrap();
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
    // TODO(port): lifetime — heap-duped when len > 15; arena-owned in Zig.
    String(NameStr),
}

impl TinyString {
    pub fn init(input: &[u8]) -> Result<TinyString, bun_alloc::AllocError> {
        if input.len() <= 15 {
            Ok(TinyString::InlineString(InlineString::init(input)))
        } else {
            // TODO(port): lifetime — Zig used allocator.dupe; leak into 'static for Phase A
            let duped: Box<[u8]> = Box::<[u8]>::from(input);
            Ok(TinyString::String(Box::leak(duped)))
        }
    }

    // do not make this *const or you will run into memory bugs.
    // we cannot let the compiler decide to copy this struct because
    // that would cause this to become a pointer to stack memory.
    pub fn slice(&mut self) -> &[u8] {
        match self {
            TinyString::InlineString(s) => s.slice(),
            TinyString::String(s) => s,
        }
    }
}

pub struct MinifyRenamer {
    pub reserved_names: StringHashMap<u32>,
    pub slots: SymbolSlotList,
    pub top_level_symbol_to_slot: TopLevelSymbolSlotMap,
    pub symbols: js_ast::symbol::Map,
}

// TODO(port): Zig used `std.HashMapUnmanaged(Ref, usize, RefCtx, 80)` —
// bun_collections::HashMap should be parameterized with RefCtx hasher.
pub type TopLevelSymbolSlotMap = HashMap<Ref, usize>;

impl MinifyRenamer {
    pub fn init(
        symbols: js_ast::symbol::Map,
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
            symbols,
            reserved_names,
            slots,
            top_level_symbol_to_slot: TopLevelSymbolSlotMap::default(),
        }))
    }

    pub fn to_renamer(self: Box<Self>) -> Renamer<'static> {
        Renamer::MinifyRenamer(self)
    }

    pub fn name_for_symbol(&mut self, ref_: Ref) -> &[u8] {
        let ref_ = self.symbols.follow(ref_);
        let symbol = self.symbols.get(ref_).unwrap();

        let ns = symbol.slot_namespace();
        if ns == js_ast::symbol::SlotNamespace::MustNotBeRenamed {
            return symbol.original_name;
        }

        let i = match symbol
            .nested_scope_slot()
            .or_else(|| self.top_level_symbol_to_slot.get(&ref_).copied())
        {
            Some(i) => i,
            None => return symbol.original_name,
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
        for (key, value) in symbol_uses.iter() {
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
        let mut symbol = self.symbols.get(ref_).unwrap();

        while let Some(alias) = &symbol.namespace_alias {
            let new_ref = self.symbols.follow(alias.namespace_ref);
            if new_ref.eql(ref_) {
                break;
            }
            ref_ = new_ref;
            symbol = self.symbols.get(new_ref).unwrap();
        }

        let ns = symbol.slot_namespace();
        if ns == js_ast::symbol::SlotNamespace::MustNotBeRenamed {
            return Ok(());
        }

        if let Some(i) = symbol.nested_scope_slot() {
            let slot = &mut self.slots[ns][i];
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
            let symbol = self.symbols.get(stable.ref_).unwrap();
            let ns = symbol.slot_namespace();
            let must_start_with_capital = symbol.must_start_with_capital_letter_for_jsx;
            // PORT NOTE: reshaped for borrowck — capture symbol fields before mut-borrowing slots
            let slots = &mut self.slots[ns];

            let existing = self.top_level_symbol_to_slot.get_or_put(stable.ref_);
            if existing.found_existing {
                let slot = &mut slots[*existing.value];
                slot.count += stable.count;
                if must_start_with_capital {
                    slot.needs_capital_for_jsx = true;
                }
            } else {
                *existing.value = slots.len();
                slots.push(SymbolSlot {
                    name: TinyString::String(b""),
                    count: stable.count,
                    needs_capital_for_jsx: must_start_with_capital,
                });
            }
        }
        Ok(())
    }

    pub fn assign_names_by_frequency(
        &mut self,
        name_minifier: &mut js_ast::NameMinifier,
    ) -> Result<(), bun_core::Error> {
        let mut name_buf: Vec<u8> = Vec::with_capacity(64);

        let mut sorted: Vec<SlotAndCount> = Vec::new();

        // PERF(port): was `inline for` over enum values — profile in Phase B
        for ns in js_ast::symbol::SlotNamespace::values() {
            let slots = &mut self.slots[ns];
            sorted.clear();
            sorted.reserve(slots.len().saturating_sub(sorted.len()));
            // SAFETY: SlotAndCount is POD; we overwrite every element below.
            unsafe { sorted.set_len(slots.len()) };

            for (i, (elem, slot)) in sorted.iter_mut().zip(slots.iter()).enumerate() {
                *elem = SlotAndCount {
                    slot: u32::try_from(i).unwrap(),
                    count: slot.count,
                };
            }
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
                    js_ast::symbol::SlotNamespace::Default => {
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
                    js_ast::symbol::SlotNamespace::Label => {
                        while js_lexer::Keywords::has(name_buf.as_slice()) {
                            name_minifier.number_to_minified_name(&mut name_buf, next_name)?;
                            next_name += 1;
                        }
                    }
                    js_ast::symbol::SlotNamespace::PrivateName => {
                        name_buf.insert(0, b'#');
                    }
                    _ => {}
                }

                slots[data.slot as usize].name =
                    TinyString::init(name_buf.as_slice()).expect("unreachable");
            }
        }
        Ok(())
    }
}

pub fn assign_nested_scope_slots(
    module_scope: &mut js_ast::Scope,
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
        symbols[member.ref_.inner_index() as usize].nested_scope_slot =
            Symbol::INVALID_NESTED_SCOPE_SLOT;
    }
    for ref_ in module_scope.generated.slice() {
        symbols[ref_.inner_index() as usize].nested_scope_slot = Symbol::INVALID_NESTED_SCOPE_SLOT;
    }

    slot_counts
}

pub fn assign_nested_scope_slots_helper(
    sorted_members: &mut Vec<u32>,
    scope: &mut js_ast::Scope,
    symbols: &mut [Symbol],
    slot_to_copy: js_ast::SlotCounts,
) -> js_ast::SlotCounts {
    let mut slot = slot_to_copy;

    // Sort member map keys for determinism
    {
        sorted_members.clear();
        sorted_members
            .reserve(scope.members.count().saturating_sub(sorted_members.len()));
        // SAFETY: u32 is POD; every element is written below before read.
        unsafe { sorted_members.set_len(scope.members.count()) };
        let sorted_members_buf = sorted_members.as_mut_slice();
        let mut i: usize = 0;
        for member in scope.members.values() {
            sorted_members_buf[i] = member.ref_.inner_index();
            i += 1;
        }
        sorted_members_buf.sort_unstable();

        // Assign slots for this scope's symbols. Only do this if the slot is
        // not already assigned. Nested scopes have copies of symbols from parent
        // scopes and we want to use the slot from the parent scope, not child scopes.
        for &inner_index in sorted_members_buf.iter() {
            let symbol = &mut symbols[inner_index as usize];
            let ns = symbol.slot_namespace();
            if ns != js_ast::symbol::SlotNamespace::MustNotBeRenamed
                && symbol.nested_scope_slot().is_none()
            {
                symbol.nested_scope_slot = slot.slots[ns];
                slot.slots[ns] += 1;
            }
        }
    }

    for ref_ in scope.generated.slice() {
        let symbol = &mut symbols[ref_.inner_index() as usize];
        let ns = symbol.slot_namespace();
        if ns != js_ast::symbol::SlotNamespace::MustNotBeRenamed
            && symbol.nested_scope_slot().is_none()
        {
            symbol.nested_scope_slot = slot.slots[ns];
            slot.slots[ns] += 1;
        }
    }

    // Labels are always declared in a nested scope, so we don't need to check.
    if let Some(ref_) = scope.label_ref {
        let symbol = &mut symbols[ref_.inner_index() as usize];
        let ns = js_ast::symbol::SlotNamespace::Label;
        symbol.nested_scope_slot = slot.slots[ns];
        slot.slots[ns] += 1;
    }

    // Assign slots for the symbols of child scopes
    let mut slot_counts = slot;
    for child in scope.children.slice() {
        slot_counts.union_max(assign_nested_scope_slots_helper(
            sorted_members,
            child,
            symbols,
            slot,
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
    pub symbols: js_ast::symbol::Map,
    pub names: Box<[BabyList<NameStr>]>,
    // PERF(port): Zig had separate allocator/temp_allocator; global mimalloc now
    pub number_scope_pool: HiveArray<NumberScope, 128>,
    // PERF(port): was arena bulk-free for NumberScope pool + name temp buffers
    pub root: NumberScope,
    // PERF(port): was StackFallbackAllocator(512) — profile in Phase B
}

impl NumberRenamer {
    pub fn to_renamer(&mut self) -> Renamer<'_> {
        Renamer::NumberRenamer(self)
    }

    pub fn original_name(&self, ref_: Ref) -> &[u8] {
        if ref_.is_source_contents_slice() {
            unreachable!();
        }

        let resolved = self.symbols.follow(ref_);
        self.symbols.get_const(resolved).unwrap().original_name
    }

    pub fn assign_name(&mut self, scope: &mut NumberScope, input_ref: Ref) {
        let ref_ = self.symbols.follow(input_ref);

        // Don't rename the same symbol more than once
        let inner: &mut BabyList<NameStr> = &mut self.names[ref_.source_index() as usize];
        if inner.len > ref_.inner_index() && !inner.at(ref_.inner_index()).is_empty() {
            return;
        }

        // Don't rename unbound symbols, symbols marked as reserved names, labels, or private names
        let symbol = self.symbols.get(ref_).unwrap();
        if symbol.slot_namespace() != js_ast::symbol::SlotNamespace::Default {
            return;
        }

        // PERF(port): Zig reset stack-fallback FBA here; arena reset semantics differ
        let name: NameStr = match scope.find_unused_name(symbol.original_name) {
            UnusedName::Renamed(name) => name,
            UnusedName::NoCollision => symbol.original_name,
        };
        let new_len = inner.len.max(ref_.inner_index() + 1);
        if inner.cap <= new_len {
            let prev_cap = inner.len;
            inner
                .ensure_unused_capacity((new_len - prev_cap) as usize)
                .expect("unreachable");
            // SAFETY: ptr[prev_cap..cap] is allocated, we zero it before exposing.
            unsafe {
                let to_write = core::slice::from_raw_parts_mut(
                    inner.ptr.add(prev_cap as usize),
                    (inner.cap - prev_cap) as usize,
                );
                core::ptr::write_bytes(to_write.as_mut_ptr(), 0, to_write.len());
            }
        }
        inner.len = new_len;
        *inner.mut_(ref_.inner_index()) = name;
    }

    pub fn init(
        symbols: js_ast::symbol::Map,
        root_names: StringHashMap<u32>,
    ) -> Result<Box<NumberRenamer>, bun_alloc::AllocError> {
        let len = symbols.symbols_for_source.len();
        let names: Box<[BabyList<NameStr>]> =
            vec![BabyList::<NameStr>::default(); len].into_boxed_slice();

        // PERF(port): HiveArray.Fallback was bound to arena.allocator() in Zig
        let number_scope_pool = HiveArray::<NumberScope, 128>::new();

        let mut root = NumberScope::default();
        root.name_counts = root_names;

        #[cfg(all(debug_assertions, not(windows)))]
        {
            // TODO(port): std.posix.getenv — use bun_core::env_var
            if bun_core::env_var::get("BUN_DUMP_SYMBOLS").is_some() {
                symbols.dump();
            }
        }

        // PORT NOTE: Zig @memset(sliceAsBytes(names), 0) — BabyList::default() is already zeroed.

        Ok(Box::new(NumberRenamer {
            symbols,
            names,
            number_scope_pool,
            root,
        }))
    }

    pub fn assign_names_recursive(
        &mut self,
        scope: &mut js_ast::Scope,
        source_index: u32,
        parent: Option<*const NumberScope>,
        sorted: &mut Vec<u32>,
    ) {
        let s = self.number_scope_pool.get();
        *s = NumberScope {
            parent,
            name_counts: StringHashMap::default(),
        };

        self.assign_names_recursive_with_number_scope(s, scope, source_index, sorted);

        // PORT NOTE: Zig `defer { s.deinit(); pool.put(s) }` — fn is infallible,
        // so no scopeguard needed; cleanup runs unconditionally below.
        // SAFETY: s came from number_scope_pool.get()
        unsafe {
            core::ptr::drop_in_place(s);
        }
        self.number_scope_pool.put(s);
    }

    fn assign_names_in_scope(
        &mut self,
        s: &mut NumberScope,
        scope: &mut js_ast::Scope,
        source_index: u32,
        sorted: &mut Vec<u32>,
    ) {
        {
            sorted.clear();
            sorted.reserve(scope.members.count().saturating_sub(sorted.len()));
            // SAFETY: u32 is POD; every slot written before read.
            unsafe { sorted.set_len(scope.members.count()) };
            let mut remaining: &mut [u32] = sorted.as_mut_slice();
            for value_ref in scope.members.values() {
                #[cfg(debug_assertions)]
                debug_assert!(!value_ref.ref_.is_source_contents_slice());

                remaining[0] = value_ref.ref_.inner_index();
                remaining = &mut remaining[1..];
            }
            debug_assert!(remaining.is_empty());
            sorted.sort_unstable();

            for &inner_index in sorted.iter() {
                self.assign_name(
                    s,
                    Ref::init(u32::try_from(inner_index).unwrap(), source_index, false),
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
        scope_: &mut js_ast::Scope,
        source_index: u32,
        sorted: &mut Vec<u32>,
    ) {
        let mut s: *mut NumberScope = initial_scope;
        let mut scope = scope_;
        // TODO(port): defer cleanup of `s` if s != initial_scope — handled at end

        loop {
            if scope.members.count() > 0 || scope.generated.len > 0 {
                let new_child_scope = self.number_scope_pool.get();
                *new_child_scope = NumberScope {
                    parent: Some(s as *const NumberScope),
                    name_counts: StringHashMap::default(),
                };
                s = new_child_scope;

                // SAFETY: s is a valid pool slot just initialized above
                self.assign_names_in_scope(unsafe { &mut *s }, scope, source_index, sorted);
            }

            if scope.children.len == 1 {
                // SAFETY: children.ptr[0] valid when len == 1
                scope = unsafe { &mut *scope.children.ptr };
                // TODO(port): BabyList<*Scope> indexing — verify element type
            } else {
                break;
            }
        }

        // Symbols in child scopes may also have to be renamed to avoid conflicts
        for child in scope.children.slice() {
            self.assign_names_recursive_with_number_scope(s, child, source_index, sorted);
        }

        if s != initial_scope {
            // SAFETY: s is a pool slot we allocated in the loop above
            unsafe {
                core::ptr::drop_in_place(s);
            }
            self.number_scope_pool.put(s);
        }
    }

    pub fn add_top_level_symbol(&mut self, ref_: Ref) {
        // PORT NOTE: reshaped for borrowck — root is a field of self
        // TODO(port): self.assign_name needs &mut self AND &mut self.root simultaneously
        let root: *mut NumberScope = &mut self.root;
        // SAFETY: assign_name does not touch self.root through `self`
        self.assign_name(unsafe { &mut *root }, ref_);
    }

    pub fn add_top_level_declared_symbols(
        &mut self,
        declared_symbols: js_ast::DeclaredSymbol::List,
    ) {
        let mut decls = declared_symbols;
        js_ast::DeclaredSymbol::for_each_top_level_symbol(&mut decls, self, Self::add_top_level_symbol);
    }

    pub fn name_for_symbol(&self, ref_: Ref) -> &[u8] {
        if ref_.is_source_contents_slice() {
            unreachable!("Unexpected unbound symbol!\n{}", ref_);
        }

        let resolved = self.symbols.follow(ref_);

        let source_index = resolved.source_index();
        let inner_index = resolved.inner_index();

        let renamed_list = &self.names[source_index as usize];

        if renamed_list.len > inner_index {
            let renamed = *renamed_list.at(inner_index);
            if !renamed.is_empty() {
                return renamed;
            }
        }

        self.symbols
            .symbols_for_source
            .at(source_index)
            .at(inner_index)
            .original_name
    }
}

#[derive(Default)]
pub struct NumberScope {
    pub parent: Option<*const NumberScope>,
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

        let mut s: Option<*const NumberScope> = this.parent;

        while let Some(scope_ptr) = s {
            // SAFETY: parent backref points to a live ancestor NumberScope
            let scope = unsafe { &*scope_ptr };
            if scope.name_counts.contains_adapted(name, &ctx) {
                return NameUse::Used;
            }
            s = scope.parent;
        }

        NameUse::Unused
    }
}

enum UnusedName {
    NoCollision,
    Renamed(NameStr),
}

impl NumberScope {
    /// Caller must use an arena allocator
    pub fn find_unused_name(&mut self, input_name: &[u8]) -> UnusedName {
        // PERF(port): was arena temp_allocator — profile in Phase B
        let mut name: &[u8] =
            MutableString::ensure_valid_identifier(input_name).expect("unreachable");

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

                let mut mutable_name = MutableString::init_empty();
                mutable_name
                    .grow_if_needed(prefix.len() + 4)
                    .expect("unreachable");
                mutable_name.append_slice(prefix).expect("unreachable");
                mutable_name.append_int(tries).expect("unreachable");

                match NameUse::find(self, mutable_name.slice()) {
                    NameUse::Unused => {
                        name = mutable_name.slice();

                        if matches!(use_, NameUse::SameScope(_)) {
                            let existing = self
                                .name_counts
                                .get_or_put(prefix)
                                .expect("unreachable");
                            if !existing.found_existing {
                                if strings::eql_long(input_name, prefix, true) {
                                    *existing.key = input_name;
                                } else {
                                    // TODO(port): lifetime — duped into renamer allocator
                                    *existing.key = Box::leak(Box::<[u8]>::from(prefix));
                                }
                            }

                            *existing.value = tries;
                        }
                    }
                    cur_use => loop {
                        mutable_name.reset_to(prefix.len());
                        mutable_name.append_int(tries).expect("unreachable");

                        tries += 1;

                        match NameUse::find(self, mutable_name.slice()) {
                            NameUse::Unused => {
                                if matches!(cur_use, NameUse::SameScope(_)) {
                                    let existing = self
                                        .name_counts
                                        .get_or_put(prefix)
                                        .expect("unreachable");
                                    if !existing.found_existing {
                                        if strings::eql_long(input_name, prefix, true) {
                                            *existing.key = input_name;
                                        } else {
                                            // TODO(port): lifetime — duped into renamer allocator
                                            *existing.key = Box::leak(Box::<[u8]>::from(prefix));
                                        }
                                    }

                                    *existing.value = tries;
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

        // TODO(port): lifetime — duped into renamer allocator (was `allocator.dupe`)
        let name: NameStr = Box::leak(Box::<[u8]>::from(name));

        self.name_counts
            .put_no_clobber(name, 1)
            .expect("unreachable");
        UnusedName::Renamed(name)
    }
}

pub struct ExportRenamer {
    pub string_buffer: MutableString,
    pub used: StringHashMap<u32>,
    pub count: isize,
}

impl ExportRenamer {
    pub fn init() -> ExportRenamer {
        ExportRenamer {
            string_buffer: MutableString::init_empty(),
            used: StringHashMap::default(),
            count: 0,
        }
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.used.clear();
        self.string_buffer.reset();
    }

    pub fn next_renamed_name(&mut self, input: &[u8]) -> &[u8] {
        let mut entry = self.used.get_or_put(input).expect("unreachable");
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
                let attempt = self.string_buffer.slice();
                entry = self.used.get_or_put(attempt).expect("unreachable");
                if !entry.found_existing {
                    // TODO(port): lifetime — duped into string_buffer allocator
                    let to_use: NameStr = Box::leak(Box::<[u8]>::from(attempt));
                    *entry.key = to_use;
                    *entry.value = tries;

                    entry = self.used.get_or_put(input).expect("unreachable");
                    *entry.value = tries;
                    return to_use;
                }
            }
        } else {
            *entry.value = tries;
        }

        *entry.key
    }

    pub fn next_minified_name(&mut self) -> Result<&[u8], bun_core::Error> {
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
            + (js_lexer::Keywords::keys().len()
                + js_lexer::StrictModeReservedWords::keys().len()
                + 1
                + EXTRAS.len()),
    )?;

    for keyword in js_lexer::Keywords::keys() {
        // PERF(port): was assume_capacity
        names.put_assume_capacity(keyword, 1);
    }

    for keyword in js_lexer::StrictModeReservedWords::keys() {
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
    symbols: &js_ast::symbol::Map,
    names: &mut StringHashMap<u32>,
) {
    // PORT NOTE: Zig copied `names_.*` to a local and wrote back via defer.
    // In Rust we mutate through &mut directly.

    for member in scope.members.values() {
        let symbol = symbols.get(member.ref_).unwrap();
        if symbol.kind == js_ast::symbol::Kind::Unbound || symbol.must_not_be_renamed {
            names
                .put(symbol.original_name, 1)
                .expect("unreachable");
        }
    }

    for ref_ in scope.generated.slice() {
        let symbol = symbols.get(*ref_).unwrap();
        if symbol.kind == js_ast::symbol::Kind::Unbound || symbol.must_not_be_renamed {
            names
                .put(symbol.original_name, 1)
                .expect("unreachable");
        }
    }

    // If there's a direct "eval" somewhere inside the current scope, continue
    // traversing down the scope tree until we find it to get all reserved names
    if scope.contains_direct_eval {
        for child in scope.children.slice() {
            if child.contains_direct_eval {
                compute_reserved_names_for_scope(child, symbols, names);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_printer/renamer.zig (956 lines)
//   confidence: medium
//   todos:      13
//   notes:      NameStr Box::leak sites need Phase-B 'bump threading (AST arena); StringHashMap get_or_put API shape assumed
// ──────────────────────────────────────────────────────────────────────────

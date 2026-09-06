use core::cmp::Ordering;
use core::mem::ManuallyDrop;
use std::io::Write as _;

use bun_alloc::Arena as Bump;

use bun_ast as js_ast;
use bun_ast::lexer_tables::{
    self as js_lexer, KEYWORDS as Keywords, STRICT_MODE_RESERVED_WORDS as StrictModeReservedWords,
};
use bun_ast::symbol;
use bun_ast::symbol::SlotNamespace;
use bun_ast::{Ref, Symbol};
use bun_collections::{HashMap, StringHashMap, VecExt};
use bun_core::Output;
use bun_core::{MutableString, strings};
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

/// The renameable slot namespaces. Skips `MustNotBeRenamed`.
const SLOT_NAMESPACES: [SlotNamespace; 4] = [
    SlotNamespace::Default,
    SlotNamespace::Label,
    SlotNamespace::PrivateName,
    SlotNamespace::MangledProp,
];

/// Lifetime-erased name slice used as the `NumberRenamer` interner key. Every
/// key points either at `Symbol::original_name` (an AST-arena slice that
/// strictly outlives the renamer) or at bytes bump-allocated from the
/// renamer's own `arena`, so the borrow contract documented on
/// `StoreStr::slice` is always satisfied.
#[derive(Clone, Copy)]
pub struct NameKey(NameStr);

impl NameKey {
    #[inline]
    fn as_bytes(&self) -> &[u8] {
        self.0.slice()
    }
}

impl core::hash::Hash for NameKey {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // Must match `<[u8] as Hash>::hash` so `Borrow<[u8]>` lookups agree.
        self.as_bytes().hash(state);
    }
}

impl PartialEq for NameKey {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.as_bytes() == other.as_bytes()
    }
}
impl Eq for NameKey {}

impl core::borrow::Borrow<[u8]> for NameKey {
    #[inline]
    fn borrow(&self) -> &[u8] {
        self.as_bytes()
    }
}

pub struct NoOpRenamer<'a> {
    // `symbol::Map` is `Vec<Vec<Symbol>>` (owning). Unlike `MinifyRenamer`/`NumberRenamer` (which the bundler builds over a
    // *borrowed* `LinkerGraph.symbols` and so wrap in `ManuallyDrop`),
    // `NoOpRenamer` is only constructed by `print_ast` / `print_json`, whose
    // callers always pass an *owned* Map freshly built by
    // `Map::init_with_one_list(mem::take(&mut ast.symbols))`. Owning + dropping
    // here is required: `ManuallyDrop` leaked the per-file `Vec<Symbol>` on
    // every transpile (require-cache.test.ts "files transpiled and loaded don't
    // leak the output source code" — `await import()` re-transpiles each
    // iteration, so the leak compounds to OOM).
    pub(crate) symbols: symbol::Map,
    pub(crate) source: &'a bun_ast::Source,
}

impl<'a> NoOpRenamer<'a> {
    pub(crate) fn init(symbols: symbol::Map, source: &'a bun_ast::Source) -> NoOpRenamer<'a> {
        NoOpRenamer { symbols, source }
    }

    fn name_for_symbol(&self, ref_: Ref) -> &[u8] {
        if ref_.is_source_contents_slice() {
            return &self.source.contents[ref_.source_index() as usize
                ..(ref_.source_index() + ref_.inner_index()) as usize];
        }

        let resolved = self.symbols.follow(ref_);

        if let Some(symbol) = self.symbols.get_const(resolved) {
            // SAFETY: `original_name` is an AST-arena slice that outlives the renamer.
            symbol.original_name.slice()
        } else {
            Output::panic(format_args!(
                "Invalid symbol {} in {}",
                ref_,
                bstr::BStr::new(self.source.path.text)
            ));
        }
    }

    pub(crate) fn to_renamer(&mut self) -> Renamer<'_, 'a> {
        Renamer::NoOpRenamer(self)
    }
}

// Two lifetime params — `'r` is the borrow of the underlying renamer,
// `'src` is `NoOpRenamer`'s borrow of the `Source`. Erasing both with a
// single lifetime via `&'a mut NoOpRenamer<'a>` would make
// `'a` invariant and lock the source borrow to the renamer borrow.
pub enum Renamer<'r, 'src> {
    NumberRenamer(&'r mut NumberRenamer),
    NoOpRenamer(&'r mut NoOpRenamer<'src>),
    MinifyRenamer(&'r mut MinifyRenamer),
}

impl<'r, 'src> Renamer<'r, 'src> {
    pub(crate) fn symbols(&self) -> &symbol::Map {
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
}

#[derive(Clone, Copy)]
pub struct SymbolSlot {
    // Most minified names are under 15 bytes
    // Instead of allocating a string for every symbol slot
    // We can store the string inline!
    // But we have to be very careful of where it's used.
    // Or we WILL run into memory bugs.
    pub(crate) name: TinyString,
    pub(crate) count: u32,
    pub(crate) needs_capital_for_jsx: bool,
    /// Named ahead of `assign_names_by_frequency` (`MinifyRenamer::pin`).
    pub(crate) pinned: bool,
}

impl Default for SymbolSlot {
    fn default() -> Self {
        SymbolSlot {
            name: TinyString::String(name_str_empty()),
            count: 0,
            needs_capital_for_jsx: false,
            pinned: false,
        }
    }
}

pub(crate) type SymbolSlotList = EnumMap<symbol::SlotNamespace, Vec<SymbolSlot>>;

#[derive(Clone, Copy, Default)]
pub struct InlineString {
    pub(crate) bytes: [u8; 15],
    pub(crate) len: u8,
}

impl InlineString {
    fn init(str_: &[u8]) -> InlineString {
        let mut this = InlineString {
            len: u8::try_from(str_.len().min(15)).expect("int cast"),
            ..Default::default()
        };
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
    fn slice(&mut self) -> &[u8] {
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
    fn init(input: &[u8], arena: &Bump) -> Result<TinyString, bun_alloc::AllocError> {
        if input.len() <= 15 {
            Ok(TinyString::InlineString(InlineString::init(input)))
        } else {
            let duped: &[u8] = arena.alloc_slice_copy(input);
            Ok(TinyString::String(bun_ast::StoreStr::new(duped)))
        }
    }

    // do not make this *const or you will run into memory bugs.
    // we cannot let the compiler decide to copy this struct because
    // that would cause this to become a pointer to stack memory.
    fn slice(&mut self) -> &[u8] {
        match self {
            TinyString::InlineString(s) => s.slice(),
            // `StoreStr::slice` centralises the arena-backed deref; the payload
            // outlives `self` (the arena lives on the owning renamer).
            TinyString::String(s) => s.slice(),
        }
    }
}

pub struct MinifyRenamer {
    pub(crate) reserved_names: StringHashMap<u32>,
    pub(crate) slots: SymbolSlotList,
    pub(crate) top_level_symbol_to_slot: TopLevelSymbolSlotMap,
    pub(crate) symbols: ManuallyDrop<symbol::Map>,
    pub(crate) owns_symbols: bool,
    /// Backs `TinyString::String` slot-name allocations.
    pub(crate) arena: Bump,
    /// Set once use counts are in; `finish` names the slots with it. Kept
    /// here so the bundler can pin cross-chunk names between the two steps.
    pub name_minifier: Option<js_ast::NameMinifier>,
}

impl Drop for MinifyRenamer {
    fn drop(&mut self) {
        if self.owns_symbols {
            // SAFETY: `owns_symbols` is only set on the owned-Map path; dropped exactly once.
            unsafe { ManuallyDrop::drop(&mut self.symbols) };
        }
    }
}

pub(crate) type TopLevelSymbolSlotMap = HashMap<Ref, usize>;

impl MinifyRenamer {
    pub fn init(
        symbols: symbol::Map,
        first_top_level_slots: &js_ast::SlotCounts,
        mut reserved_names: StringHashMap<u32>,
    ) -> Result<Box<MinifyRenamer>, bun_alloc::AllocError> {
        let mut slots = SymbolSlotList::default();

        for (ns, &count) in first_top_level_slots.slots.iter() {
            let count = count as usize;
            let mut v = Vec::with_capacity(count);
            v.resize(count, SymbolSlot::default());
            slots[ns] = v;
        }

        // #14586: here, not in `compute_initial_reserved_names`, so `NumberRenamer` keeps user `$` verbatim.
        reserved_names.put(b"$", 1).expect("unreachable");

        Ok(Box::new(MinifyRenamer {
            symbols: ManuallyDrop::new(symbols),
            owns_symbols: false,
            reserved_names,
            slots,
            top_level_symbol_to_slot: TopLevelSymbolSlotMap::default(),
            arena: Bump::new(),
            name_minifier: None,
        }))
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

    pub fn accumulate_symbol_use_counts(
        &mut self,
        top_level_symbols: &mut Vec<StableSymbolCount>,
        symbol_uses: &js_ast::part::SymbolUseMap,
        stable_source_indices: &[u32],
    ) -> Result<(), bun_alloc::AllocError> {
        // ArrayHashMap exposes parallel keys()/values() slices, no .iter().
        for (key, value) in symbol_uses.keys().iter().zip(symbol_uses.values().iter()) {
            self.accumulate_symbol_use_count(
                top_level_symbols,
                *key,
                value.count_estimate(),
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
        let ref_ = self.symbols.follow_printed(ref_);
        let symbol: &Symbol = self.symbols.get_const(ref_).unwrap();

        let ns = symbol.slot_namespace();
        if ns == SlotNamespace::MustNotBeRenamed {
            return Ok(());
        }

        if let Some(i) = symbol.nested_scope_slot() {
            let slot = &mut self.slots[ns][i as usize];
            slot.count += count;
            if symbol.must_start_with_capital_letter_for_jsx() {
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
        // Upper bound (a ref can repeat across files); sizes the map and the
        // default namespace, where nearly all top-level symbols live, once.
        self.top_level_symbol_to_slot
            .ensure_total_capacity(top_level_symbols.len())?;
        self.slots[SlotNamespace::Default].reserve(top_level_symbols.len());
        for stable in top_level_symbols {
            let symbol: &Symbol = self.symbols.get_const(stable.ref_).unwrap();
            // Reshaped for borrowck — capture symbol fields before mut-borrowing slots
            let ns = symbol.slot_namespace();
            let must_start_with_capital = symbol.must_start_with_capital_letter_for_jsx();
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
                    pinned: false,
                });
            }
        }
        Ok(())
    }

    /// Names this renamer will not hand out (keywords, unbound globals, pinned names).
    pub fn reserved_names(&self) -> &StringHashMap<u32> {
        &self.reserved_names
    }

    /// The accumulated use count of a top-level symbol in this chunk, if it has one.
    pub fn top_level_count(&self, ref_: Ref) -> Option<u32> {
        let ref_ = self.symbols.follow(ref_);
        let slot = *self.top_level_symbol_to_slot.get(&ref_)?;
        let ns = self.symbols.get_const(ref_).unwrap().slot_namespace();
        Some(self.slots[ns][slot].count)
    }

    /// Gives top-level symbol `ref_` the name `name` ahead of
    /// `assign_names_by_frequency`, which then hands `name` to nothing else.
    /// Used for bindings that cross chunks, so every chunk calls them the same.
    pub fn pin(&mut self, ref_: Ref, name: &[u8]) -> Result<(), bun_alloc::AllocError> {
        let ref_ = self.symbols.follow(ref_);
        let Some(&slot) = self.top_level_symbol_to_slot.get(&ref_) else {
            return Ok(());
        };
        let ns = self.symbols.get_const(ref_).unwrap().slot_namespace();
        let slot = &mut self.slots[ns][slot];
        slot.name = TinyString::init(name, &self.arena)?;
        slot.pinned = true;
        self.reserved_names.put(name, 1)?;
        Ok(())
    }

    /// Names every slot not already pinned, using the `name_minifier` stored
    /// by the accumulate step.
    pub fn finish(&mut self) -> Result<(), crate::Error> {
        let name_minifier = self
            .name_minifier
            .take()
            .expect("name_minifier set before finish");
        let result = self.assign_names_by_frequency(&name_minifier);
        self.name_minifier = Some(name_minifier);
        result
    }

    pub fn assign_names_by_frequency(
        &mut self,
        name_minifier: &js_ast::NameMinifier,
    ) -> Result<(), crate::Error> {
        let mut name_buf: Vec<u8> = Vec::with_capacity(64);

        let mut sorted: Vec<SlotAndCount> = Vec::new();

        for &ns in SLOT_NAMESPACES.iter() {
            let slots = &mut self.slots[ns];
            sorted.clear();
            sorted.extend(
                slots
                    .iter()
                    .enumerate()
                    .filter(|(_, slot)| !slot.pinned)
                    .map(|(i, slot)| SlotAndCount {
                        slot: u32::try_from(i).expect("int cast"),
                        count: slot.count,
                    }),
            );
            sorted.sort_unstable_by(|a, b| SlotAndCount::less_than(*a, *b));

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

#[derive(Clone, Copy)]
pub struct StableSymbolCount {
    pub(crate) stable_source_index: u32,
    pub(crate) ref_: Ref,
    pub(crate) count: u32,
}

pub(crate) type StableSymbolCountArray = Vec<StableSymbolCount>;

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

#[repr(C)]
#[derive(Clone, Copy)]
struct SlotAndCount {
    slot: u32,
    count: u32,
}

impl SlotAndCount {
    fn less_than(a: SlotAndCount, b: SlotAndCount) -> Ordering {
        // Sort by descending count, then ascending slot.
        b.count.cmp(&a.count).then_with(|| a.slot.cmp(&b.slot))
    }
}

pub struct NumberRenamer {
    // See `NoOpRenamer.symbols` — non-owning view.
    pub(crate) symbols: ManuallyDrop<symbol::Map>,
    pub(crate) names: Box<[Vec<NameStr>]>,
    /// Backs top-level renamed-name slices in `names` and interned keys.
    pub(crate) arena: Bump,
    /// Every name seen in the chunk's root scope → index into `slots`.
    ids: NameIds,
    /// By name id: who holds that name in the root scope.
    slots: Vec<NameSlot>,
}

type NameIds = bun_collections::hashbrown::HashMap<NameKey, u32, bun_wyhash::BuildHasher>;
/// Name id -> index into `NestedRenamer::slots`, for the names the file's
/// nested scopes bind or renumber; every other id reads the root's slot.
type OverlayMap =
    bun_collections::hashbrown::HashMap<u32, u32, core::hash::BuildHasherDefault<IdHasher>>;

/// Name ids are dense small integers; multiply-shift spreads them for
/// hashbrown's top-bit tag.
#[derive(Default)]
struct IdHasher(u64);

impl core::hash::Hasher for IdHasher {
    #[inline]
    fn write(&mut self, _: &[u8]) {
        unreachable!()
    }
    #[inline]
    fn write_u32(&mut self, n: u32) {
        self.0 = u64::from(n).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy)]
struct NameSlot {
    /// The scope holding this name (`ROOT_SCOPE`, or a `NestedRenamer`
    /// scope serial), or `NO_SCOPE`.
    scope: u32,
    /// Next collision counter for the name in that scope.
    count: u32,
    /// The symbol holding the name, or `Ref::NONE` for reserved names and
    /// counter-only entries, which every inner scope must avoid.
    owner: Ref,
}

const NO_SCOPE: u32 = 0;
const ROOT_SCOPE: u32 = 1;

impl NameSlot {
    const EMPTY: NameSlot = NameSlot {
        scope: NO_SCOPE,
        count: 0,
        owner: Ref::NONE,
    };
}

enum NameUse {
    Unused,
    SameScope(u32),
    Used,
}

/// The name table a binding is checked against: the chunk's root scope
/// (`NumberRenamer`) or one file's nested scopes over it (`NestedRenamer`).
trait NameScopes {
    /// Copies a made-up name (`foo2`) somewhere that outlives printing.
    fn keep_name(&self, name: &[u8]) -> NameStr;
    /// Serial number of the scope being named.
    fn scope(&self) -> u32;
    fn id_of(&self, name: &[u8]) -> Option<u32>;
    /// `name` must outlive the renamer (an AST `original_name` or a slice of
    /// `arena()`).
    fn intern(&mut self, name: NameStr) -> u32;
    fn slot(&self, id: u32) -> NameSlot;
    /// Give `id` to the current scope.
    fn set_slot(&mut self, id: u32, slot: NameSlot);
    /// Whether the scope being named references `owner`, the symbol holding
    /// a name in an enclosing scope. When it does not, the binding may shadow
    /// it: `owner` only took that name because whatever held it further out
    /// is not referenced beneath `owner`'s scope either.
    fn sees(&self, owner: Ref) -> bool;

    fn find(&self, id: Option<u32>) -> NameUse {
        let Some(id) = id else {
            return NameUse::Unused;
        };
        let slot = self.slot(id);
        if slot.scope == NO_SCOPE {
            NameUse::Unused
        } else if slot.scope == self.scope() {
            NameUse::SameScope(slot.count)
        } else if slot.owner.is_empty() || self.sees(slot.owner) {
            NameUse::Used
        } else {
            NameUse::Unused
        }
    }

    /// Takes `name` for `owner` in the current scope if free, else the first
    /// free `name2`, `name3`, …. `None`: `name` itself was free.
    fn find_unused_name(&mut self, input_name: NameStr, owner: Ref) -> Option<NameStr> {
        let owned_name = valid_identifier_for(input_name.slice());
        let normalized = owned_name.is_some();
        let name: &[u8] = owned_name.as_deref().unwrap_or_else(|| input_name.slice());

        let id = self.id_of(name);
        let use_ = self.find(id);
        if let NameUse::Unused = use_ {
            let unchanged = !normalized || strings::eql_long(name, input_name.slice(), true);
            let name = if unchanged {
                input_name
            } else {
                self.keep_name(name)
            };
            let id = match id {
                Some(id) => id,
                None => self.intern(name),
            };
            let scope = self.scope();
            self.set_slot(
                id,
                NameSlot {
                    scope,
                    count: 1,
                    owner,
                },
            );
            return if unchanged { None } else { Some(name) };
        }

        // To avoid O(n^2) behavior, the number must start off being the number
        // used last time there was a collision with this name in this scope;
        // sibling scopes can reuse the same numbers.
        let prefix_id = id.unwrap();
        let mut tries: u32 = match use_ {
            NameUse::SameScope(count) => count,
            _ => 1,
        };
        let mut candidate = numbered_name_buffer(name);
        loop {
            tries += 1;
            write_numbered_name(&mut candidate, name.len(), tries);
            let candidate_id = self.id_of(candidate.slice());
            if let NameUse::Unused = self.find(candidate_id) {
                let scope = self.scope();
                // Where to resume for the next collision in this scope.
                let prefix_slot = self.slot(prefix_id);
                self.set_slot(
                    prefix_id,
                    NameSlot {
                        scope,
                        count: tries,
                        owner: if prefix_slot.scope == scope {
                            prefix_slot.owner
                        } else {
                            Ref::NONE
                        },
                    },
                );
                let renamed = self.keep_name(candidate.slice());
                let candidate_id = match candidate_id {
                    Some(id) => id,
                    None => self.intern(renamed),
                };
                self.set_slot(
                    candidate_id,
                    NameSlot {
                        scope,
                        count: 1,
                        owner,
                    },
                );
                return Some(renamed);
            }
        }
    }
}

/// `name` made a valid identifier (`let` → `_let`, non-ASCII escapes), or
/// `None` when it already is one.
fn valid_identifier_for(name: &[u8]) -> Option<Box<[u8]>> {
    // `MutableString::ensure_valid_identifier` always heap-allocates, even
    // when the input is already a valid ASCII identifier; the strict-mode
    // reserved-word remap is the only transform that fires for an
    // otherwise-valid ASCII name.
    if is_simple_ascii_identifier(name)
        && !bun_ast::lexer_tables::is_strict_mode_reserved_word(name)
    {
        debug_assert!(js_lexer::is_identifier(name));
        return None;
    }
    let valid = MutableString::ensure_valid_identifier(name).expect("unreachable");
    debug_assert!(js_lexer::is_identifier(&valid));
    Some(valid)
}

fn numbered_name_buffer(name: &[u8]) -> MutableString {
    let mut candidate = MutableString::init_empty();
    candidate
        .grow_if_needed(name.len() + 4)
        .expect("unreachable");
    candidate.append_slice(name).expect("unreachable");
    candidate
}

/// `candidate[..prefix_len]` followed by `n`.
fn write_numbered_name(candidate: &mut MutableString, prefix_len: usize, n: u32) {
    candidate.reset_to(prefix_len);
    candidate.append_int(u64::from(n)).expect("unreachable");
}

fn intern_into(ids: &mut NameIds, next_id: u32, name: NameStr) -> (u32, bool) {
    use bun_collections::hashbrown::hash_map::RawEntryMut;
    match ids.raw_entry_mut().from_key(name.slice()) {
        RawEntryMut::Occupied(o) => (*o.get(), false),
        RawEntryMut::Vacant(v) => {
            v.insert(NameKey(name), next_id);
            (next_id, true)
        }
    }
}

fn store_name(names: &mut Vec<NameStr>, inner_index: u32, name: NameStr) {
    let new_len = names.len().max(inner_index as usize + 1);
    if names.len() < new_len {
        names.resize(new_len, name_str_empty());
    }
    names[inner_index as usize] = name;
}

impl NameScopes for NumberRenamer {
    fn keep_name(&self, name: &[u8]) -> NameStr {
        NameStr::new(self.arena.alloc_slice_copy(name))
    }
    fn scope(&self) -> u32 {
        ROOT_SCOPE
    }
    fn id_of(&self, name: &[u8]) -> Option<u32> {
        self.ids.get(name).copied()
    }
    fn intern(&mut self, name: NameStr) -> u32 {
        let (id, new) = intern_into(&mut self.ids, self.slots.len() as u32, name);
        if new {
            self.slots.push(NameSlot::EMPTY);
        }
        id
    }
    fn slot(&self, id: u32) -> NameSlot {
        self.slots[id as usize]
    }
    fn set_slot(&mut self, id: u32, slot: NameSlot) {
        self.slots[id as usize] = slot;
    }
    fn sees(&self, _owner: Ref) -> bool {
        // Top-level symbols of the whole chunk share one scope.
        true
    }
}

impl NumberRenamer {
    pub fn init(
        symbols: symbol::Map,
        root_names: &StringHashMap<u32>,
    ) -> Result<Box<NumberRenamer>, bun_alloc::AllocError> {
        let len = symbols.symbols_for_source.len();
        let names: Box<[Vec<NameStr>]> = core::iter::repeat_with(Vec::<NameStr>::default)
            .take(len)
            .collect();
        let symbol_count: usize = symbols.symbols_for_source.iter().map(|s| s.len()).sum();

        let mut r = Box::new(NumberRenamer {
            symbols: ManuallyDrop::new(symbols),
            names,
            arena: Bump::new(),
            ids: NameIds::with_capacity_and_hasher(
                root_names.len() + symbol_count / 4,
                Default::default(),
            ),
            slots: Vec::with_capacity(root_names.len() + symbol_count / 4),
        });
        // `root_names` owns its keys and is dropped by the caller; copy them.
        for (key, &count) in root_names.iter() {
            let duped = NameStr::new(r.arena.alloc_slice_copy(&**key));
            let id = r.intern(duped);
            r.slots[id as usize] = NameSlot {
                scope: ROOT_SCOPE,
                count,
                owner: Ref::NONE,
            };
        }

        // Debug-only, presence-checked symbol dump.
        #[cfg(debug_assertions)]
        if bun_core::env_var::BUN_DUMP_SYMBOLS.get().is_some() {
            r.symbols.dump();
        }

        Ok(r)
    }

    pub fn add_top_level_symbol(&mut self, input_ref: Ref) {
        let ref_ = self.symbols.follow(input_ref);

        // Don't rename the same symbol more than once
        let inner: &Vec<NameStr> = &self.names[ref_.source_index() as usize];
        if inner.len() > ref_.inner_index() as usize && inner[ref_.inner_index() as usize].len() > 0
        {
            return;
        }

        // Don't rename unbound symbols, symbols marked as reserved names, labels, or private names
        let symbol: &Symbol = self.symbols.get_const(ref_).unwrap();
        if symbol.slot_namespace() != SlotNamespace::Default {
            return;
        }

        let original_name = symbol.original_name;
        let name = self
            .find_unused_name(original_name, ref_)
            .unwrap_or(original_name);
        store_name(
            &mut self.names[ref_.source_index() as usize],
            ref_.inner_index(),
            name,
        );
    }

    /// Gives top-level symbol `ref_` the name `name` (taken to be free in the
    /// root scope) so later symbols are numbered around it. Used for bindings
    /// that cross chunks, so every chunk calls them the same.
    pub fn pin_top_level_symbol(&mut self, ref_: Ref, name: &[u8]) {
        let ref_ = self.symbols.follow(ref_);
        if self.symbols.get_const(ref_).unwrap().slot_namespace() != SlotNamespace::Default {
            return;
        }
        let name = NameStr::new(self.arena.alloc_slice_copy(name));
        let id = self.intern(name);
        self.slots[id as usize] = NameSlot {
            scope: ROOT_SCOPE,
            count: 1,
            owner: ref_,
        };
        store_name(
            &mut self.names[ref_.source_index() as usize],
            ref_.inner_index(),
            name,
        );
    }

    pub fn add_top_level_declared_symbols(
        &mut self,
        declared_symbols: &mut js_ast::DeclaredSymbolList,
    ) {
        js_ast::DeclaredSymbol::for_each_top_level_symbol(declared_symbols, self, |r, ref_| {
            r.add_top_level_symbol(ref_)
        });
    }

    /// Takes the names a `NestedRenamer` over this renamer assigned.
    pub fn absorb(&mut self, nested: NestedNames) {
        self.names[nested.source_index as usize] = nested.names;
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
                // `self.arena` (or a bundler worker arena) or borrows an AST-arena `original_name`, both
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

/// Names the nested scopes of one file once every top-level symbol of the
/// chunk is named (`NumberRenamer`), which it only reads; files can run in
/// parallel. `into_names` hands the result back for `NumberRenamer::absorb`.
pub struct NestedRenamer<'r> {
    root: &'r NumberRenamer,
    uses: &'r ScopeUses<'r>,
    source_index: u32,
    /// This file's names; starts as the top-level ones.
    names: Vec<NameStr>,
    /// Name id (the root's ids, then `local_ids`) -> index in `slots` of the
    /// innermost enclosing scope's slot for that name; ids not present read
    /// the root's slot. Slots of scopes already left are dropped, so a present
    /// slot is always an enclosing one.
    overlay: OverlayMap,
    /// Ids `root.slots.len()..next_local_id` are this file's `local_ids`.
    next_local_id: u32,
    slots: Vec<NameSlot>,
    /// Names first seen in this file's nested scopes.
    local_ids: NameIds,
    /// `(id, 0)` for an id the scope added to `overlay`, else `(id, 1 + the
    /// index it mapped to)`; restored on scope exit.
    undo: Vec<(u32, u32)>,
    /// The AST scope being named and its serial number (from `ROOT_SCOPE + 1`).
    scope: u32,
    next_scope: u32,
    ast_scope: *const js_ast::Scope,
    arena: &'r bun_alloc::Arena,
}

pub struct NestedNames {
    source_index: u32,
    names: Vec<NameStr>,
}

impl<'r> NameScopes for NestedRenamer<'r> {
    fn keep_name(&self, name: &[u8]) -> NameStr {
        NameStr::new(self.arena.alloc_slice_copy(name))
    }
    fn scope(&self) -> u32 {
        self.scope
    }
    fn id_of(&self, name: &[u8]) -> Option<u32> {
        self.root
            .ids
            .get(name)
            .or_else(|| self.local_ids.get(name))
            .copied()
    }
    fn intern(&mut self, name: NameStr) -> u32 {
        debug_assert!(self.root.ids.get(name.slice()).is_none());
        let (id, new) = intern_into(&mut self.local_ids, self.next_local_id, name);
        if new {
            self.next_local_id += 1;
        }
        id
    }
    fn slot(&self, id: u32) -> NameSlot {
        match self.overlay.get(&id) {
            None => self
                .root
                .slots
                .get(id as usize)
                .copied()
                .unwrap_or(NameSlot::EMPTY),
            Some(&local) => self.slots[local as usize],
        }
    }
    fn set_slot(&mut self, id: u32, slot: NameSlot) {
        debug_assert_eq!(slot.scope, self.scope);
        match self.overlay.entry(id) {
            bun_collections::hashbrown::hash_map::Entry::Occupied(mut entry) => {
                let local = *entry.get();
                if self.slots[local as usize].scope == self.scope {
                    self.slots[local as usize] = slot;
                } else {
                    self.undo.push((id, local + 1));
                    *entry.get_mut() = self.slots.len() as u32;
                    self.slots.push(slot);
                }
            }
            bun_collections::hashbrown::hash_map::Entry::Vacant(entry) => {
                self.undo.push((id, 0));
                entry.insert(self.slots.len() as u32);
                self.slots.push(slot);
            }
        }
    }
    fn sees(&self, owner: Ref) -> bool {
        // SAFETY: `ast_scope` is the live scope `assign_names_recursive` is
        // visiting.
        self.uses.sees(owner, unsafe { &*self.ast_scope })
    }
}

impl<'r> NestedRenamer<'r> {
    /// `arena`: where made-up names go; must outlive printing (the bundler
    /// passes the worker thread's arena).
    pub fn new(
        root: &'r NumberRenamer,
        uses: &'r ScopeUses<'r>,
        source_index: u32,
        arena: &'r bun_alloc::Arena,
    ) -> Self {
        let symbol_count = root.symbols.symbols_for_source[source_index as usize].len();
        let mut names = Vec::with_capacity(symbol_count);
        names.extend_from_slice(&root.names[source_index as usize]);
        names.resize(symbol_count, name_str_empty());
        NestedRenamer {
            root,
            uses,
            source_index,
            names,
            overlay: OverlayMap::default(),
            next_local_id: root.slots.len() as u32,
            slots: Vec::new(),
            local_ids: NameIds::default(),
            undo: Vec::new(),
            scope: ROOT_SCOPE,
            next_scope: ROOT_SCOPE + 1,
            ast_scope: core::ptr::null(),
            arena,
        }
    }

    pub fn into_names(self) -> NestedNames {
        NestedNames {
            source_index: self.source_index,
            names: self.names,
        }
    }

    fn assign_name(&mut self, input_ref: Ref) {
        let symbols = &self.root.symbols;
        let ref_ = symbols.follow(input_ref);
        // A link out of the file leads to a top-level symbol, already named.
        if ref_.source_index() != self.source_index {
            debug_assert!(!self.root.name_for_symbol(ref_).is_empty());
            return;
        }
        // Don't rename the same symbol more than once
        if self.names[ref_.inner_index() as usize].len() > 0 {
            return;
        }
        // Don't rename unbound symbols, symbols marked as reserved names, labels, or private names
        let symbol: &Symbol = symbols.get_const(ref_).unwrap();
        if symbol.slot_namespace() != SlotNamespace::Default {
            return;
        }
        let original_name = symbol.original_name;
        let name = self
            .find_unused_name(original_name, ref_)
            .unwrap_or(original_name);
        self.names[ref_.inner_index() as usize] = name;
    }

    /// Names `scope` and everything below it.
    pub fn assign_names_recursive(&mut self, scope: &js_ast::Scope, sorted: &mut Vec<u32>) {
        let parent = (self.scope, self.ast_scope);
        let undo_mark = self.undo.len();
        let slots_mark = self.slots.len();
        self.scope = self.next_scope;
        self.next_scope += 1;
        self.ast_scope = scope;

        sorted.clear();
        sorted.extend(scope.members.values().map(|value_ref| {
            debug_assert!(!value_ref.ref_.is_source_contents_slice());
            value_ref.ref_.inner_index()
        }));
        debug_assert_eq!(sorted.len(), scope.members.count());
        sorted.sort_unstable();
        for i in 0..sorted.len() {
            self.assign_name(Ref::new(
                sorted[i],
                self.source_index,
                bun_ast::RefTag::Symbol,
            ));
        }
        for ref_ in scope.generated.slice() {
            self.assign_name(*ref_);
        }

        for child in scope.children.slice() {
            self.assign_names_recursive(child, sorted);
        }

        for &(id, prev) in self.undo[undo_mark..].iter().rev() {
            match prev {
                0 => {
                    self.overlay.remove(&id);
                }
                local => {
                    self.overlay.insert(id, local - 1);
                }
            }
        }
        self.undo.truncate(undo_mark);
        self.slots.truncate(slots_mark);
        (self.scope, self.ast_scope) = parent;
    }
}

/// Fast-path for `MutableString::ensure_valid_identifier`: returns `true` iff
/// `s` is a non-empty ASCII identifier (`[A-Za-z_$][A-Za-z0-9_$]*`), for which
/// that function returns the input unchanged (modulo the strict-mode reserved
/// word remap, handled by the caller) but still allocates.
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

/// One file's `Ast::scope_uses`, indexed on first use so the number renamer
/// can ask whether a nested binding would capture a reference to an enclosing
/// binding of the same name.
pub struct ScopeUses<'a> {
    source_index: u32,
    list: &'a js_ast::ast_result::ScopeUseList,
    parts: &'a [js_ast::Part],
    parts_live: &'a bun_collections::AutoBitSet,
    symbols: &'a symbol::Map,
    index: core::cell::OnceCell<ScopeUseIndex>,
}

/// Scopes are numbered in pre-order (`Scope::visit_span`), so a scope
/// together with everything inside it is the span `[first, last]`.
#[derive(Default)]
struct ScopeUseIndex {
    /// `scope_indices[offsets[i]..offsets[i + 1]]`: the scopes that reference
    /// this file's symbol `i`, ascending.
    offsets: Vec<u32>,
    scope_indices: Vec<u32>,
    /// Printed symbols the linker added uses of: no scope on record, so they
    /// may be printed anywhere in the file.
    everywhere: HashMap<Ref, ()>,
    /// `(printed symbol, this file's symbol that prints as it)` where the two
    /// differ (linked import items, hoisted duplicates, namespace members).
    /// Sorted.
    aliases: Vec<(u64, u32)>,
}

impl<'a> ScopeUses<'a> {
    pub fn new(
        source_index: u32,
        list: &'a js_ast::ast_result::ScopeUseList,
        parts: &'a [js_ast::Part],
        parts_live: &'a bun_collections::AutoBitSet,
        symbols: &'a symbol::Map,
    ) -> Self {
        ScopeUses {
            source_index,
            list,
            parts,
            parts_live,
            symbols,
            index: core::cell::OnceCell::new(),
        }
    }

    /// Whether a binding in `scope` would capture a reference to `symbol`,
    /// i.e. whether `symbol` is referenced in `scope` or anywhere inside it.
    /// A function body or catch block also sees its parameter scope, which it
    /// cannot redeclare.
    pub fn sees(&self, symbol: Ref, scope: &js_ast::Scope) -> bool {
        let scope = match (scope.kind, scope.parent.as_deref()) {
            (js_ast::scope::Kind::FunctionBody, Some(parent)) => parent,
            (js_ast::scope::Kind::Block, Some(parent))
                if parent.kind == js_ast::scope::Kind::CatchBinding =>
            {
                parent
            }
            _ => scope,
        };
        let Some(span) = scope.visit_span() else {
            return true;
        };
        if !self.list.tracked {
            return true;
        }
        let index = self.index.get_or_init(|| ScopeUseIndex::build(self));
        if index.everywhere.contains_key(&symbol) {
            return true;
        }
        if symbol.source_index() == self.source_index
            && self.sees_own(index, symbol.inner_index(), span)
        {
            return true;
        }
        let key = symbol.to_raw_bits();
        let i = index.aliases.partition_point(|&(printed, _)| printed < key);
        index.aliases[i..]
            .iter()
            .take_while(|&&(printed, _)| printed == key)
            .any(|&(_, own)| self.sees_own(index, own, span))
    }

    /// For a symbol of this file, by inner index.
    fn sees_own(&self, index: &ScopeUseIndex, symbol: u32, (first, last): (u32, u32)) -> bool {
        let (lo, hi) = (
            index.offsets[symbol as usize],
            index.offsets[symbol as usize + 1],
        );
        let scopes = &index.scope_indices[lo as usize..hi as usize];
        let i = scopes.partition_point(|&at| at < first);
        if scopes.get(i).is_some_and(|&at| at <= last) {
            return true;
        }
        let spans = self.list.spans.as_slice();
        let i = spans.partition_point(|s| s.symbol < symbol);
        spans[i..]
            .iter()
            .take_while(|s| s.symbol == symbol)
            .any(|s| s.first <= last && first <= s.last)
    }
}

impl ScopeUseIndex {
    fn build(file: &ScopeUses<'_>) -> ScopeUseIndex {
        let mut index = ScopeUseIndex::default();

        for (part_index, part) in file.parts.iter().enumerate() {
            if !file.parts_live.is_set(part_index) {
                continue;
            }
            for (ref_, use_) in part
                .symbol_uses
                .keys()
                .iter()
                .zip(part.symbol_uses.values())
            {
                if use_.has_unscoped() {
                    index
                        .everywhere
                        .insert(file.symbols.follow_printed(*ref_), ());
                }
            }
        }

        let file_symbols = &file.symbols.symbols_for_source[file.source_index as usize];
        for (inner, symbol) in file_symbols.iter().enumerate() {
            if !symbol.has_link() && symbol.namespace_alias.is_none() {
                continue;
            }
            let own = Ref::new(inner as u32, file.source_index, bun_ast::RefTag::Symbol);
            let printed = file.symbols.follow_printed(own);
            if printed != own {
                index.aliases.push((printed.to_raw_bits(), inner as u32));
            }
        }
        index.aliases.sort_unstable();

        // Bucket the points by symbol (counting sort), then order each
        // symbol's scopes.
        let points = file.list.points.as_slice();
        // `offsets[i]` = end of bucket `i`; filling each bucket from its end
        // turns it into the start.
        let mut offsets = vec![0u32; file_symbols.len() + 1];
        for point in points {
            offsets[point.symbol as usize] += 1;
        }
        for i in 1..offsets.len() {
            offsets[i] += offsets[i - 1];
        }
        let mut scope_indices = vec![0u32; points.len()];
        for point in points.iter().rev() {
            let slot = &mut offsets[point.symbol as usize];
            *slot -= 1;
            scope_indices[*slot as usize] = point.scope;
        }
        for symbol in 0..file_symbols.len() {
            scope_indices[offsets[symbol] as usize..offsets[symbol + 1] as usize].sort_unstable();
        }
        index.offsets = offsets;
        index.scope_indices = scope_indices;
        index
    }
}

pub struct ExportRenamer {
    pub(crate) string_buffer: MutableString,
    pub(crate) used: StringHashMap<u32>,
    pub(crate) count: isize,
    /// Backs renamed export-name slices returned to the caller.
    pub(crate) arena: Bump,
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
        if !entry.found_existing {
            *entry.value_ptr = 1;
            // `StringHashMap` does not expose a key pointer; allocate a copy in
            // `self.arena` so the returned slice is tied to `&self`.
            return self.arena.alloc_slice_copy(input);
        }

        // Resume from the last suffix handed out for this prefix so N collisions
        // on the same name stay O(N) total (see `NumberScope::find_unused_name`).
        let mut tries: u32 = *entry.value_ptr;
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
            if self.used.contains_key(attempt) {
                continue;
            }
            // `StringHashMap::put` boxes the key itself; the arena copy below is
            // only for the caller's returned slice (`string_buffer` is reused).
            self.used.put(attempt, 1).expect("unreachable");
            *self.used.get_mut(input).expect("unreachable") = tries;
            return self.arena.alloc_slice_copy(attempt);
        }
    }

    pub fn next_minified_name(&mut self) -> Result<Vec<u8>, crate::Error> {
        loop {
            let name = js_ast::NameMinifier::default_number_to_minified_name(self.count)?;
            self.count += 1;
            if !self.used.contains_key(name.as_slice()) {
                return Ok(name);
            }
        }
    }

    /// Mark `name` as taken so neither `next_renamed_name` nor
    /// `next_minified_name` hands it out. Used for an entry point chunk's own
    /// export names, which share the chunk's `export {}` namespace with the
    /// cross-chunk exports.
    pub fn reserve_name(&mut self, name: &[u8]) {
        let entry = self.used.get_or_put(name).expect("unreachable");
        if !entry.found_existing {
            *entry.value_ptr = 1;
        }
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
        names.put_assume_capacity(keyword, 1);
    }

    for keyword in StrictModeReservedWords.iter() {
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
            names.put_assume_capacity(name, 1);
        }
    }

    for extra in EXTRAS {
        names.put_assume_capacity(extra, 1);
    }

    Ok(names)
}

pub fn compute_reserved_names_for_scope(
    scope: &js_ast::Scope,
    symbols: &symbol::Map,
    names: &mut StringHashMap<u32>,
) {
    for member in scope.members.values() {
        let symbol: &Symbol = symbols.get_const(member.ref_).unwrap();
        if symbol.kind == symbol::Kind::Unbound || symbol.must_not_be_renamed() {
            // SAFETY: `original_name` is an AST-arena slice.
            names
                .put(symbol.original_name.slice(), 1)
                .expect("unreachable");
        }
    }

    for ref_ in scope.generated.slice() {
        let symbol: &Symbol = symbols.get_const(*ref_).unwrap();
        if symbol.kind == symbol::Kind::Unbound || symbol.must_not_be_renamed() {
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

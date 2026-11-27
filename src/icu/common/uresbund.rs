//! Resource bundles: the cache of bundle files, locale fallback, aliases and lookups. ICU4C: uresbund.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::bytes::{I32s, U16s};
use crate::common::charstr::SmallChars;
use crate::common::cstring::{find_last_byte, split_once, until_nul};
use crate::common::localefallback_data::*;
use crate::common::maps::Map;
use crate::common::memory::{
    self, Appendable, best_effort, fail_on_oom, oom_checked, try_box, try_map_insert, try_push,
    try_to_vec,
};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::udata::{bundle_may_be_replaced, searches_files};
use crate::common::uinvchar::{append_invariant_chars, invariant_chars, invariant_prefix};
use crate::common::uloc::{
    Language, Script, Subtag, Subtags, UKeywordsContext, find_row, uloc_get_default,
    uloc_get_parent, uloc_get_script, ulocimp_get_base_name_to, ulocimp_get_keyword_value,
};
use crate::common::umutex::StaticMap;
use crate::common::unicode::uloc::{ULOC_FULLNAME_CAPACITY, ULOC_KEYWORD_AND_VALUES_CAPACITY};
use crate::common::unicode::ures::*;
use crate::common::uresdata::*;
use crate::common::utypes::*;
use bun_core::strings;
use std::ffi::{CStr, CString};
use std::fmt::NumBuffer;
use std::hash::{Hash, Hasher};
use std::ops::Range;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::Relaxed};

pub(crate) const ROOT_LOCALE_NAME: &[u8] = b"root";

const POOL: &[u8] = b"pool";

const URES_MAX_ALIAS_LEVEL: u32 = 256;

/// Bounds the loops that aliases or `%%Parent` can make endless.
const MAX_ITERATIONS: u32 = 0x2000;

/// A tree of ICU's data (`U_ICUDATA_...`, or `None` for the main tree), or the package that an alias names.
pub(crate) type Tree = Option<&'static [u8]>;

/// A loaded bundle file, or a placeholder for a missing one. It is never freed.
pub(crate) struct UResourceDataEntry {
    name: CString,
    tree: Tree,
    /// Set under the lock of the cache, after the links of the ancestors and only if it closes no cycle.
    parent: OnceLock<Entry>,
    /// The final target of `%%ALIAS`.
    alias: Option<Entry>,
    pub(crate) data: ResourceData,
    /// `U_MISSING_RESOURCE_ERROR` for a placeholder, another error if the pool bundle or the alias is unusable.
    bogus: UErrorCode,
    /// Whether the root table can have a key like "%%Parent", which sorts before digits and letters.
    may_have_links: bool,
}

pub(crate) type Entry = &'static UResourceDataEntry;

type Name = Subtag<{ ULOC_FULLNAME_CAPACITY as usize - 1 }>;

impl UResourceDataEntry {
    #[inline(always)]
    fn new(name: &[u8], tree: Tree, data: ResourceData) -> Result<Box<Self>, UErrorCode> {
        try_box(Self {
            name: memory::try_cstring(name)?,
            tree,
            parent: OnceLock::new(),
            alias: None,
            data,
            bogus: U_ZERO_ERROR,
            may_have_links: false,
        })
    }

    fn name(&self) -> &[u8] {
        self.name.as_bytes()
    }

    fn parent(&self) -> Option<Entry> {
        self.parent.get().copied()
    }

    fn lacks_parent(&self) -> bool {
        self.parent().is_none() && !self.data.no_fallback && self.name() != ROOT_LOCALE_NAME
    }

    /// Iterates over the entry and its ancestors.
    fn chain(&'static self) -> impl Iterator<Item = Entry> {
        std::iter::successors(Some(self), |entry| entry.parent())
    }

    fn cache_key(&self) -> CacheKey<'_> {
        CacheKey {
            name: self.name(),
            tree: self.tree,
        }
    }

    fn resolved(&'static self) -> Entry {
        self.alias.unwrap_or(self)
    }

    fn root_item(&self, key: &[u8]) -> Option<Resource> {
        self.data.table_item_by_key(self.data.root_res, key)
    }

    /// Returns the name of a bundle in `%%ALIAS` or `%%Parent`.
    fn link(&self, key: &[u8]) -> Option<U16s<'static>> {
        let name = self.may_have_links.then(|| self.root_item(key))??;
        res_get_data_string(&self.data, name).map(DataString::units)
    }

    fn has_root_as_parent(&self) -> bool {
        self.may_have_links && self.root_item(b"%%ParentIsRoot").is_some()
    }

    /// Returns how an item counts that is inherited from this bundle.
    fn as_fallback(&self) -> Opened {
        if self.name() == uloc_get_default().to_bytes() || self.name() == ROOT_LOCALE_NAME {
            Opened::Default
        } else {
            Opened::Parent
        }
    }
}

#[derive(PartialEq, Eq)]
struct CacheKey<'a> {
    name: &'a [u8],
    tree: Tree,
}

impl Hash for CacheKey<'_> {
    /// Omits the lengths, which would double the cost. Only keys that split one string at different places collide.
    fn hash<H: Hasher>(&self, state: &mut H) {
        state.write(self.name);
        state.write(self.tree.unwrap_or_default());
    }
}

static CACHE: StaticMap<CacheKey<'static>, Entry> = StaticMap::new();

/// Set before a bundle that may come from a file enters the cache.
static MAY_HAVE_FILES: AtomicBool = AtomicBool::new(false);

/// Whether all items get their key and their path. The linked data need keys only for items by index, and paths only for others.
#[inline]
fn keeps_places() -> bool {
    MAY_HAVE_FILES.load(Relaxed)
}

/// Inserts `entry` unless the cache has its key by now, and returns the cached entry, resolved.
fn insert_entry(entry: Box<UResourceDataEntry>) -> Result<Entry, UErrorCode> {
    let entry = CACHE.get_or_insert_by(
        entry,
        |cache, new| cache.get(&new.cache_key()).copied(),
        |new| {
            let entry: Entry = Box::leak(new);
            (entry.cache_key(), entry)
        },
    )?;
    Ok(entry.resolved())
}

fn name_or_root(name: &[u8]) -> &[u8] {
    if name.is_empty() {
        ROOT_LOCALE_NAME
    } else {
        name
    }
}

#[cold]
fn missing_entry(name: &[u8], tree: Tree) -> Result<Entry, UErrorCode> {
    let mut entry = UResourceDataEntry::new(name, tree, ResourceData::empty())?;
    entry.bogus = U_MISSING_RESOURCE_ERROR;
    insert_entry(entry)
}

enum Found {
    /// The entry, or the target of its `%%ALIAS`.
    Cached(Entry),
    New(Box<UResourceDataEntry>),
    /// The file is missing or malformed, and has no placeholder.
    Missing,
}

fn look_up(name: &[u8], tree: Tree) -> Result<Found, UErrorCode> {
    if let Some(entry) = CACHE.with_lock(|cache| cache.get(&CacheKey { name, tree }).copied()) {
        return Ok(Found::Cached(entry.resolved()));
    }
    match res_load(tree, name) {
        Ok(data) => UResourceDataEntry::new(name, tree, data).map(Found::New),
        Err(U_MEMORY_ALLOCATION_ERROR) => Err(U_MEMORY_ALLOCATION_ERROR),
        Err(_) => Ok(Found::Missing),
    }
}

/// Returns the entry for a name that a bundle refers to, which is a placeholder if the file is missing.
fn init_entry(name: &[u8], tree: Tree, is_for_pool: bool) -> Result<Entry, UErrorCode> {
    let name = name_or_root(name);
    let entry = match look_up(name, tree)? {
        Found::Cached(entry) => entry,
        Found::New(entry) => finish_entry(entry, is_for_pool)?,
        Found::Missing => missing_entry(name, tree)?,
    };
    match entry.bogus {
        U_ZERO_ERROR | U_MISSING_RESOURCE_ERROR => Ok(entry),
        code => Err(code),
    }
}

/// Returns a placeholder or `None` for a missing file. Fails only for want of memory.
#[inline(always)]
fn find_entry(name: &[u8], tree: Tree) -> Result<Option<Entry>, UErrorCode> {
    let name = name_or_root(name);
    match look_up(name, tree)? {
        Found::Cached(entry) => Ok(Some(entry)),
        Found::New(entry) => finish_entry(entry, false).map(Some),
        Found::Missing if searches_files()? => remember_missing(name, tree),
        Found::Missing => Ok(None),
    }
}

/// Saves later searches of the file system. JavaScript chooses the names, so their number is limited.
#[cold]
fn remember_missing(name: &[u8], tree: Tree) -> Result<Option<Entry>, UErrorCode> {
    static ROOM: AtomicU32 = AtomicU32::new(1024);
    match ROOM.try_update(Relaxed, Relaxed, |room| room.checked_sub(1)) {
        Ok(_) => missing_entry(name, tree).map(Some),
        Err(_) => Ok(None),
    }
}

/// Caches `entry` and returns it, resolved. ICU4C: uresbund.cpp, init_entry
#[inline(never)]
fn finish_entry(
    mut entry: Box<UResourceDataEntry>,
    is_for_pool: bool,
) -> Result<Entry, UErrorCode> {
    match prepare_entry(&mut entry, is_for_pool)? {
        Some(alias) => follow_bundle_aliases(entry, alias, is_for_pool),
        None => insert_entry(entry),
    }
}

/// Attaches the pool bundle and returns `%%ALIAS`. What a pool bundle leads to cannot use one.
#[inline(always)]
fn prepare_entry(
    entry: &mut UResourceDataEntry,
    is_for_pool: bool,
) -> Result<Option<U16s<'static>>, UErrorCode> {
    if bundle_may_be_replaced(entry.name())? {
        MAY_HAVE_FILES.store(true, Relaxed);
    }
    if entry.data.uses_pool_bundle {
        let attached = if is_for_pool || entry.name() == POOL {
            Err(U_TOO_MANY_ALIASES_ERROR)
        } else {
            init_entry(POOL, entry.tree, true).and_then(|pool| entry.data.use_pool(&pool.data))
        };
        if let Err(code) = attached {
            entry.bogus = code;
            return oom_checked(None);
        }
    }
    let first_key = entry.data.key_by_index(entry.data.root_res, 0);
    entry.may_have_links = first_key.is_some_and(|key| key.first_byte() <= b'%');
    Ok(entry.link(b"%%ALIAS").filter(|alias| !alias.is_empty()))
}

#[inline(never)]
fn follow_bundle_aliases(
    mut entry: Box<UResourceDataEntry>,
    mut alias: U16s,
    mut is_for_pool: bool,
) -> Result<Entry, UErrorCode> {
    let tree = entry.tree;
    // The aliases that lead to `entry`. They are cached when their target is known. A repeated name is a cycle.
    let mut pending: Vec<Box<UResourceDataEntry>> = Vec::new();
    entry.alias = loop {
        let mut name = SmallChars::new();
        name.add_each(invariant_prefix(alias.iter()));
        let name = oom_checked(name_or_root(&name))?;
        if entry.name() == name || pending.iter().any(|other| other.name() == name) {
            entry.bogus = U_TOO_MANY_ALIASES_ERROR;
            break None;
        }
        let mut next = match look_up(name, tree)? {
            Found::Cached(target) => break Some(target),
            Found::New(next) => next,
            Found::Missing => break Some(missing_entry(name, tree)?),
        };
        is_for_pool |= entry.name() == POOL;
        match prepare_entry(&mut next, is_for_pool)? {
            Some(next_alias) => alias = next_alias,
            None => break Some(insert_entry(next)?),
        }
        try_push(&mut pending, std::mem::replace(&mut entry, next))?;
    };
    let target = insert_entry(entry)?;
    while let Some(mut entry) = pending.pop() {
        entry.alias = Some(target);
        insert_entry(entry)?;
    }
    Ok(target)
}

fn chop_locale(name: &[u8]) -> Option<&[u8]> {
    find_last_byte(name, b'_').map(|at| name.slice(..at))
}

fn name_or_und(name: &[u8]) -> &[u8] {
    if name.is_empty() { b"und" } else { name }
}

/// Of the names without a '_', only the substrings of "nb nn" have their `%%Parent` read.
fn may_have_parent(name: &[u8]) -> Option<&[u8]> {
    (matches!(name, [b'n' | b'b' | b' ', ..]) && strings::contains(b"nb nn", name)).then_some(name)
}

#[cold]
fn load_parents(entry: Entry, chopped_name: Option<&[u8]>) -> Result<(), UErrorCode> {
    load_parents_from(
        entry,
        chopped_name.or_else(|| may_have_parent(entry.name())),
    )
}

/// Links `entry` up to root, or up to an unusable ancestor. `name` is the parent unless `%%Parent` names one, `None` is root.
#[cold]
fn load_parents_from(entry: Entry, name: Option<&[u8]>) -> Result<(), UErrorCode> {
    let mut parents = ParentChain {
        inline: [entry; _],
        len: 1,
        heap: Vec::new(),
        last: entry,
    };
    let mut result = name.map_or(Ok(()), |name| parents.find_except_root(name));
    // If the chain ends with root, `add` appends nothing.
    if result.is_ok() && parents.last.parent().is_none() {
        result = parents.add(ROOT_LOCALE_NAME).map(drop);
    }
    // After a failed allocation nothing is linked, so that a later call builds the whole chain.
    memory::check_oom()?;
    // From the root end, because readers do not take the lock.
    let links = parents.chain().array_windows().rev();
    CACHE.with_lock(|_| {
        for &[child, parent] in links {
            // Another thread may have entered the same cycle at another entry.
            if !parent.chain().any(|ancestor| std::ptr::eq(ancestor, child)) {
                child.parent.get_or_init(|| parent);
            }
        }
    });
    result
}

/// An entry and the ancestors found so far, not linked yet.
struct ParentChain {
    inline: [Entry; 6],
    /// The entries are in `heap` if `len` exceeds the size of `inline`.
    len: usize,
    heap: Vec<Entry>,
    last: Entry,
}

impl ParentChain {
    fn chain(&self) -> &[Entry] {
        self.inline.get(..self.len).unwrap_or(&self.heap)
    }

    // ICU4C: uresbund.cpp, loadParentsExceptRoot
    fn find_except_root(&mut self, first: &[u8]) -> Result<(), UErrorCode> {
        let (mut explicit, mut name);
        name = first;
        while self.last.parent().is_none()
            && !self.last.data.no_fallback
            && !self.last.has_root_as_parent()
        {
            if let Some(parent) = self.last.link(b"%%Parent")
                && (1..=Name::CAPACITY).contains(&parent.len())
            {
                explicit = Name::new(invariant_prefix(parent.iter()));
                name = &explicit;
                if name == ROOT_LOCALE_NAME {
                    break;
                }
            }
            if !self.add(name)? {
                break;
            }
            // The name that was asked for is cut, also if it is an alias.
            let Some(next) = chop_locale(name).or_else(|| may_have_parent(name)) else {
                break;
            };
            name = next;
        }
        Ok(())
    }

    /// Appends the bundle `name`. Returns `false` and appends nothing if that would close a cycle.
    fn add(&mut self, name: &[u8]) -> Result<bool, UErrorCode> {
        let parent = init_entry(name, self.last.tree, false)?;
        // The entries in `chain` have no parent yet, so the chain of `parent` ends at the first one that it reaches.
        let end = parent.chain().fold(parent, |_, ancestor| ancestor);
        if self.chain().iter().any(|&found| std::ptr::eq(found, end)) {
            return Ok(false);
        }
        if let Some(slot) = self.inline.get_mut(self.len) {
            *slot = parent;
        } else {
            let inline = self.inline.get(..self.len).unwrap_or_default();
            memory::try_extend_from_slice(&mut self.heap, inline)?;
            try_push(&mut self.heap, parent)?;
        }
        (self.len, self.last) = (self.len + 1, parent);
        Ok(true)
    }
}

/// A language, alone or with a script or a region.
type ShortName = ArrayVec<u8, { Language::CAPACITY + 1 + Script::CAPACITY }>;

fn language_with(language: &[u8], subtag: &[u8]) -> ShortName {
    let mut name = ShortName::from_slice(language);
    name.push(b'_');
    name.extend(subtag);
    name
}

fn get_default_script(language: &[u8], region: &[u8]) -> &'static [u8] {
    let of_region = if region.is_empty() {
        None
    } else {
        find_row::<6, _>(REGIONAL_DEFAULT_SCRIPTS, &language_with(language, region))
    };
    of_region
        .or_else(|| find_row::<3, _>(DEFAULT_SCRIPTS, language))
        .unwrap_or(b"Latn")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UResOpenType {
    /// Falls back to the parents, then to the default locale, then to root.
    LocaleDefaultRoot,
    /// Skips the default locale and the table of parents.
    LocaleRoot,
}

enum ParentName<'a> {
    Borrowed(&'a [u8]),
    Composed(ShortName),
}

/// Returns the name to try after `name` in a search that started with `orig_name`. ICU4C: uresbund.cpp, getParentLocaleID
fn get_parent_locale_id<'a>(
    name: &'a [u8],
    orig_name: &[u8],
    open_type: UResOpenType,
) -> Option<ParentName<'a>> {
    let subtags = match Subtags::parse(name) {
        Ok(subtags)
            if !name.ends_with(b"_")
                && subtags
                    .variant()
                    .is_ok_and(|(variant, _)| variant.is_empty()) =>
        {
            subtags
        }
        _ => {
            return chop_locale(name).map(|parent| ParentName::Borrowed(name_or_und(parent)));
        }
    };
    let use_tables = open_type == UResOpenType::LocaleDefaultRoot;
    if use_tables && let Some([digit]) = find_row::<10, _>(PARENT_LOCALES, name) {
        return Some(ParentName::Borrowed(PARENTS.at((digit - b'0').into())));
    }
    let (language, script, region) = (&*subtags.language(), &*subtags.script(), &*subtags.region());
    let parent = if !script.is_empty() && !region.is_empty() {
        language_with(
            language,
            if get_default_script(language, region) == script {
                region
            } else {
                script
            },
        )
    } else if !region.is_empty() {
        // `orig_name` parses: if its language is too long, no truncation of it both parses and has a region.
        let orig_script = uloc_get_script(orig_name).ok().soft_unwrap();
        language_with(
            language,
            if orig_script.is_empty() {
                get_default_script(language, region)
            } else {
                &orig_script
            },
        )
    } else if !script.is_empty()
        && !language.is_empty()
        && (!use_tables || get_default_script(language, &[]) == script)
    {
        ShortName::from_slice(language)
    } else {
        return None;
    };
    Some(ParentName::Composed(parent))
}

/// Where a `..._and_tell` function found its result.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Opened {
    Requested,
    /// A bundle: a parent of the requested locale, which can be root. An item: in an ancestor that is not `Default`.
    Parent,
    /// A bundle: the default locale, one of its parents, or root as the last resort. An item: in the default locale or root.
    Default,
}

struct Search<'a> {
    tree: Tree,
    default_locale: &'a [u8],
    open_type: UResOpenType,
    opened: Opened,
    /// Whether the search has ended at an unusable bundle.
    has_failed: bool,
    /// Whether the last missing name is neither root nor a prefix of the default locale.
    try_default: bool,
}

impl Search<'_> {
    /// Returns the first existing bundle among `orig_name` and its fallbacks.
    fn find_first_existing(&mut self, orig_name: &[u8]) -> Result<Option<Entry>, UErrorCode> {
        let (mut name, mut composed);
        name = orig_name;
        while !self.has_failed {
            let is_other_script = |entry: Entry| {
                name == b"sr_ME"
                    && orig_name.starts_with(b"sr_Cyrl")
                    && entry.name().starts_with(b"sr_Latn")
            };
            match find_entry(name, self.tree)?.map(|entry| (entry, entry.bogus)) {
                Some((entry, U_ZERO_ERROR)) if !is_other_script(entry) => return Ok(Some(entry)),
                None | Some((_, U_ZERO_ERROR | U_MISSING_RESOURCE_ERROR)) => {
                    self.opened = Opened::Parent;
                }
                Some(_) => {
                    self.has_failed = true;
                    break;
                }
            }
            // Empty first: some processors stall on `memcmp` with the dangling pointer of an empty slice.
            self.try_default = !name.is_empty()
                && !self.default_locale.starts_with(name)
                && name != ROOT_LOCALE_NAME;
            match get_parent_locale_id(name, orig_name, self.open_type) {
                Some(ParentName::Borrowed(parent)) => name = parent,
                Some(ParentName::Composed(parent)) => {
                    composed = parent;
                    name = &composed;
                }
                None => break,
            }
        }
        Ok(None)
    }

    #[inline(always)]
    fn find_with_parents(&mut self, orig_name: &[u8]) -> Result<Option<Entry>, UErrorCode> {
        let orig_name = orig_name.slice(..orig_name.len().min(Name::CAPACITY));
        let found = self.find_first_existing(orig_name)?;
        if let Some(found) = found.filter(|found| found.lacks_parent()) {
            load_parents(found, chop_locale(found.name()).map(name_or_und))?;
        }
        Ok(found)
    }
}

// ICU4C: uresbund.cpp, entryOpen
fn entry_open(
    tree: Tree,
    locale_id: &[u8],
    open_type: UResOpenType,
) -> Result<(Entry, Opened), UErrorCode> {
    let default_locale = uloc_get_default().to_bytes();
    let mut search = Search {
        tree,
        default_locale,
        open_type,
        opened: Opened::Requested,
        has_failed: false,
        try_default: true,
    };
    if let Some(found) = search.find_with_parents(locale_id)? {
        return Ok((found, search.opened));
    }
    let mut found = None;
    if open_type == UResOpenType::LocaleDefaultRoot && search.try_default {
        // The full ID, with its keywords.
        found = search.find_with_parents(default_locale)?;
        search.has_failed = false;
    }
    if found.is_none() {
        found = search.find_first_existing(ROOT_LOCALE_NAME)?;
    }
    Ok((found.ok_or(U_MISSING_RESOURCE_ERROR)?, Opened::Default))
}

// ICU4C: uresbund.cpp, entryOpenDirect
fn entry_open_direct(tree: Tree, name: &[u8]) -> Result<Entry, UErrorCode> {
    let entry = find_entry(name, tree)?.ok_or(U_MISSING_RESOURCE_ERROR)?;
    if entry.bogus != U_ZERO_ERROR {
        return Err(entry.bogus);
    }
    if entry.lacks_parent() && entry.name().len() <= Name::CAPACITY {
        match chop_locale(entry.name()) {
            Some(ROOT_LOCALE_NAME) => load_parents_from(entry, None)?,
            chopped => load_parents(entry, chopped)?,
        }
    }
    Ok(entry)
}

fn open_with_type(
    tree: Tree,
    locale_id: &[u8],
    open_type: UResOpenType,
    opened: &mut Opened,
) -> Result<UResourceBundle, UErrorCode> {
    let mut base_name = SmallChars::new();
    fail_on_oom(|| ulocimp_get_base_name_to(locale_id, &mut base_name))
        .map_err(|_| U_ILLEGAL_ARGUMENT_ERROR)?;
    let entry;
    (entry, *opened) = entry_open(tree, &base_name, open_type)?;
    Ok(UResourceBundle {
        has_fallback: !entry.data.no_fallback,
        ..UResourceBundle::root(entry, entry)
    })
}

pub(crate) fn ures_open(tree: Tree, locale_id: &[u8]) -> Result<UResourceBundle, UErrorCode> {
    let open_type = UResOpenType::LocaleDefaultRoot;
    open_with_type(tree, locale_id, open_type, &mut Opened::Requested)
}

pub(crate) fn ures_open_and_tell(
    tree: Tree,
    locale_id: &[u8],
) -> Result<(UResourceBundle, Opened), UErrorCode> {
    let (open_type, mut opened) = (UResOpenType::LocaleDefaultRoot, Opened::Requested);
    Ok((
        open_with_type(tree, locale_id, open_type, &mut opened)?,
        opened,
    ))
}

pub(crate) fn ures_open_no_default(
    tree: Tree,
    locale_id: &[u8],
) -> Result<UResourceBundle, UErrorCode> {
    let open_type = UResOpenType::LocaleRoot;
    open_with_type(tree, locale_id, open_type, &mut Opened::Requested)
}

/// Opens the bundle `name`, or the target of its `%%ALIAS`, and no other in its place.
pub(crate) fn ures_open_direct(tree: Tree, name: &[u8]) -> Result<UResourceBundle, UErrorCode> {
    entry_open_direct(tree, name).map(|entry| UResourceBundle::root(entry, entry))
}

pub(crate) struct UResourceBundle {
    resource: ResourceValue,
    /// `None` for the root table, an item of an array and an item at a path of several keys. See `keeps_places`.
    key: Option<DataKey>,
    /// The keys from the root table, like "calendar/gregorian/". See `keeps_places`.
    path: Option<SmallChars>,
    /// Whether `get_by_key` falls back to the root tables of the ancestors.
    has_fallback: bool,
    /// The index of the next item of the iteration.
    next: usize,
    size: usize,
}

fn split_at_separator(path: &[u8]) -> (&[u8], Option<&[u8]>) {
    split_once(path, RES_PATH_SEPARATOR)
}

/// Appends `keys`, then a separator unless the path is empty or ends with one.
fn append_keys(path: &mut SmallChars, keys: &[u8]) {
    path.add_all(keys);
    if path.last().is_some_and(|&last| last != RES_PATH_SEPARATOR) {
        path.add(RES_PATH_SEPARATOR);
    }
}

/// Returns a copy of `package` that is never freed. Only data name packages, which bounds their number.
#[cold]
fn intern_package(package: &[u8]) -> Result<&'static [u8], UErrorCode> {
    static PACKAGES: StaticMap<&[u8], &[u8]> = StaticMap::new();
    if let Some(known) = PACKAGES.get(package) {
        return Ok(known);
    }
    PACKAGES.get_or_insert_by(
        try_to_vec(package)?,
        |packages, new| packages.get(&**new).copied(),
        |new| {
            let package: &[u8] = new.leak();
            (package, package)
        },
    )
}

/// What names an item in its container.
#[derive(Clone, Copy)]
enum Place<'a> {
    Keys(&'a [u8]),
    Index(usize),
    Unnamed,
}

impl From<Option<DataKey>> for Place<'_> {
    fn from(key: Option<DataKey>) -> Self {
        key.map_or(Self::Unnamed, |key| Self::Keys(key.as_bytes()))
    }
}

/// An alias whose keys are being followed.
struct AliasWalk {
    alias: ResourceValue,
    /// The number of aliases that led to this one.
    depth: u32,
    keys: SmallChars,
    /// The part of `keys` that leads from `container` to the current item.
    step: Range<usize>,
    container: ResourceValue,
    has_resolved_item: bool,
    rounds: u32,
    /// The key of the target, which is `container`, if there are no keys.
    counterpart_key: Option<DataKey>,
}

/// The bundle, the alias and the depth.
type TargetKey = (*const UResourceDataEntry, Resource, u32);

impl AliasWalk {
    /// `open` comes next.
    #[inline]
    fn new(alias: ResourceValue, depth: u32) -> Self {
        Self {
            alias,
            depth,
            keys: SmallChars::new(),
            step: 0..0,
            container: alias,
            has_resolved_item: false,
            rounds: 1,
            counterpart_key: None,
        }
    }

    /// Parses "/LOCALE/keys", "/package/bundle/keys" or "bundle/keys", and starts at the root table of the bundle.
    fn open(&mut self) -> Result<(), UErrorCode> {
        const LOCALE: &[u8] = b"/LOCALE/";
        let text = self.alias.get_alias_string();
        let text = text.map_err(|_| U_INVALID_FORMAT_ERROR)?;
        let entry = if text.slice_clamped(0..LOCALE.len()).eq_bytes(LOCALE) && !keeps_places() {
            append_invariant_chars(&mut self.keys, text.slice(LOCALE.len()..).iter())?;
            self.alias.valid_locale_entry
        } else {
            self.open_any(text)?
        };
        self.container = self.alias.with(entry, entry.data.root_res);
        Ok(())
    }

    fn open_any(&mut self, text: U16s) -> Result<Entry, UErrorCode> {
        if text.is_empty() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let text: SmallChars = invariant_chars(text.iter())?;
        let text = split_once(&text, 0).0;
        let opened = self.alias.valid_locale_entry;
        let (tree, rest) = match text.strip_prefix(b"/").map(split_at_separator) {
            Some((b"LOCALE", keys)) => {
                self.keys.add_all(keys.unwrap_or_default());
                return oom_checked(opened);
            }
            Some((b"ICUDATA", rest)) => (None, rest.unwrap_or_default()),
            Some((package, rest)) => (Some(intern_package(package)?), rest.unwrap_or_default()),
            None => (opened.tree, text),
        };
        let (name, keys) = split_at_separator(rest);
        self.keys.add_all(keys.unwrap_or_default());
        oom_checked(entry_open_direct(tree, name)?)
    }

    fn is_done(&self) -> bool {
        self.step.end == self.keys.len()
    }

    fn target_key(&self) -> TargetKey {
        (self.alias.entry, self.alias.res, self.depth)
    }

    /// An alias without keys, at `place` in the item at `container_path`, leads to the same place in the other bundle.
    #[cold]
    fn find_counterpart(&mut self, container_path: &[u8], place: Place) -> Result<(), UErrorCode> {
        debug_assert!(keeps_places());
        let (data, res) = (self.container.get_data(), &mut self.container.res);
        let keys = if let Place::Keys(keys) = place {
            keys
        } else {
            &[]
        };
        for path in [container_path, keys] {
            let mut rest = path;
            let found = res_find_resource(data, *res, &mut rest).ok_or(U_MISSING_RESOURCE_ERROR)?;
            if !path.is_empty() {
                let followed = path.slice(..path.len() - rest.len());
                self.counterpart_key = res_find_last_key(data, *res, followed);
            }
            *res = found;
        }
        if let Place::Index(index) = place {
            *res = (data.item_by_index(*res, index)).ok_or(U_MISSING_RESOURCE_ERROR)?;
        }
        Ok(())
    }

    /// Follows the keys up to the next item that is no container. If one is missing, starts again in the parent bundle.
    #[inline]
    fn next_item(&mut self) -> Result<ResourceValue, UErrorCode> {
        let (keys, mut from, mut start) = (&*self.keys, self.container, self.step.end);
        loop {
            let mut rest = keys.slice(start..);
            if let Some(res) = res_find_resource(from.get_data(), from.res, &mut rest) {
                (self.container, self.step) = (from, start..keys.len() - rest.len());
                return Ok(ResourceValue { res, ..from });
            }
            let parent = from.entry.parent().ok_or(U_MISSING_RESOURCE_ERROR)?;
            self.rounds += 1;
            if self.rounds == MAX_ITERATIONS {
                return Err(U_TOO_MANY_ALIASES_ERROR);
            }
            (from, start) = (from.with(parent, parent.data.root_res), 0);
        }
    }

    #[cold]
    fn key_of_item(&self) -> Option<DataKey> {
        let step = self.keys.slice(self.step.clone());
        if step.is_empty() {
            self.counterpart_key
        } else {
            res_find_last_key(self.container.get_data(), self.container.res, step)
        }
    }

    /// Becomes the walk of `alias`, the current item, and returns what it was.
    fn enter(&mut self, alias: ResourceValue) -> Result<Self, UErrorCode> {
        let outer = std::mem::replace(self, Self::new(alias, self.depth + 1));
        self.open()?;
        if self.keys.is_empty() {
            let path = if outer.has_resolved_item {
                &*outer.keys
            } else {
                &[]
            };
            self.find_counterpart(path, outer.key_of_item().into())?;
        }
        Ok(outer)
    }
}

/// The walks that wait for the target of their current item. The first one has keys left.
#[derive(Default)]
struct OuterWalks {
    walks: Vec<AliasWalk>,
    count: u32,
    /// The targets of aliases with keys. Without them nested aliases can take exponential time.
    targets: Map<TargetKey, ResourceValue>,
}

impl OuterWalks {
    /// Returns the target of `alias`, the current item of `walk`, if it is known. Else `walk` becomes the walk of `alias`.
    #[cold]
    fn enter(
        &mut self,
        walk: &mut AliasWalk,
        alias: ResourceValue,
    ) -> Result<Option<ResourceValue>, UErrorCode> {
        let known =
            (self.targets).get(&(std::ptr::from_ref(alias.entry), alias.res, walk.depth + 1));
        if known.is_none() {
            try_push(&mut self.walks, walk.enter(alias)?)?;
            self.count = self.count.saturating_add(1);
        }
        Ok(known.copied())
    }

    /// Replaces `walk`, which has led to `target`, with the first one that has keys left.
    #[cold]
    #[cfg_attr(mordant, allow(error_collapsed_to_bool))] // A target that is not remembered only costs time.
    fn leave(&mut self, walk: &mut AliasWalk, target: ResourceValue) {
        const REMEMBER_FROM: u32 = 64;
        while let Some(outer) = walk.is_done().then(|| self.walks.pop()).flatten() {
            if self.count >= REMEMBER_FROM && !walk.keys.is_empty() {
                _ = best_effort(|| try_map_insert(&mut self.targets, walk.target_key(), target));
            }
            *walk = outer;
        }
    }
}

/// `alias` is at `place` in `container`. ICU4C: uresbund.cpp, getAliasTargetAsResourceBundle
fn resolve_alias(
    alias: ResourceValue,
    container: Option<&UResourceBundle>,
    place: Place,
) -> Result<UResourceBundle, UErrorCode> {
    let mut walk = AliasWalk::new(alias, 0);
    walk.open()?;
    if walk.keys.is_empty() {
        walk.find_counterpart(container.map_or(&[], UResourceBundle::path), place)?;
    }
    let mut outer: Option<OuterWalks> = None;
    // The keys of the first alias count, except that a single key yields to the alias that it leads to.
    let mut path = None;
    loop {
        let mut item = walk.next_item()?;
        let is_last = walk.is_done() && outer.as_ref().is_none_or(|it| it.walks.is_empty());
        if item.is_alias() {
            if walk.depth + 1 == URES_MAX_ALIAS_LEVEL {
                return Err(U_TOO_MANY_ALIASES_ERROR);
            } else if is_last {
                let keys = walk.enter(item)?.keys;
                if path.is_none() && strings::contains_char(&keys, RES_PATH_SEPARATOR) {
                    path = Some(keys);
                }
                continue;
            }
            match outer.get_or_insert_default().enter(&mut walk, item)? {
                Some(target) => item = target,
                None => continue,
            }
        } else if is_last {
            let key = keeps_places().then(|| walk.key_of_item()).flatten();
            let mut path = match path {
                None if walk.keys.is_empty() => key.map(|key| SmallChars::of(key.as_bytes())),
                None => Some(walk.keys),
                path => path,
            };
            path.iter_mut().for_each(|path| append_keys(path, &[]));
            return UResourceBundle::new(item, key, path);
        }
        if let Some(outer) = &mut outer {
            outer.leave(&mut walk, item);
        }
        (walk.container, walk.has_resolved_item) = (item, true);
    }
}

impl UResourceBundle {
    fn root(entry: Entry, valid_locale_entry: Entry) -> Self {
        let res = entry.data.root_res;
        Self {
            resource: ResourceValue {
                entry,
                valid_locale_entry,
                res,
            },
            key: None,
            path: None,
            has_fallback: false,
            next: 0,
            size: entry.data.count_items(res).unwrap_or(0),
        }
    }

    /// `resource` is not an alias.
    #[inline]
    fn new(
        resource: ResourceValue,
        key: Option<DataKey>,
        path: Option<SmallChars>,
    ) -> Result<Self, UErrorCode> {
        Ok(Self {
            resource,
            key,
            path,
            has_fallback: false,
            next: 0,
            size: resource
                .get_data()
                .count_items(resource.res)
                .ok_or(U_INVALID_FORMAT_ERROR)?,
        })
    }

    #[inline]
    fn data(&self) -> &'static ResourceData {
        self.resource.get_data()
    }

    fn path(&self) -> &[u8] {
        self.path.as_deref().unwrap_or_default()
    }

    #[inline]
    pub(crate) fn get_type(&self) -> UResType {
        self.resource.get_type()
    }

    pub(crate) fn get_key(&self) -> Option<&'static [u8]> {
        self.key.map(DataKey::as_bytes)
    }

    pub(crate) fn get_data_key(&self) -> Option<DataKey> {
        self.key
    }

    pub(crate) fn get_size(&self) -> usize {
        self.size
    }

    /// The name of the bundle file that contains the resource.
    pub(crate) fn get_name(&self) -> &'static CStr {
        &self.resource.entry.name
    }

    /// The name of the bundle file that was opened.
    pub(crate) fn get_valid_locale(&self) -> &'static CStr {
        &self.resource.valid_locale_entry.name
    }

    /// Returns a view that reads tables and arrays without creating a bundle for each item.
    pub(crate) fn get_value(&self) -> ResourceValue {
        self.resource
    }

    pub(crate) fn get_string(&self) -> Result<U16s<'static>, UErrorCode> {
        self.resource.get_string()
    }

    pub(crate) fn get_data_string(&self) -> Result<DataString, UErrorCode> {
        self.resource.get_data_string()
    }

    pub(crate) fn get_int_vector(&self) -> Result<I32s<'static>, UErrorCode> {
        self.resource.get_int_vector()
    }

    pub(crate) fn get_int(&self) -> Result<i32, UErrorCode> {
        self.resource.get_int()
    }

    /// Creates the bundle for the item at `keys`, or for its target if it is an alias.
    fn item(&self, item: ResourceValue, keys: &[u8]) -> Result<Self, UErrorCode> {
        if item.is_alias() {
            return resolve_alias(item, Some(self), Place::Keys(keys));
        } else if keeps_places() {
            return self.item_with_key(item, keys);
        }
        Self::new(item, None, Some(self.path_with(keys)))
    }

    #[inline(always)]
    fn path_with(&self, keys: &[u8]) -> SmallChars {
        let mut path = SmallChars::new();
        if let Some(own) = &self.path {
            path.add_all(own);
        }
        append_keys(&mut path, keys);
        path
    }

    /// The item has a key if `keys` is its key in this table or in the root table of an ancestor.
    #[cold]
    fn item_with_key(&self, item: ResourceValue, keys: &[u8]) -> Result<Self, UErrorCode> {
        let data = item.get_data();
        let table = if std::ptr::eq(data, self.data()) {
            self.resource.res
        } else {
            data.root_res
        };
        let key = (data.find_key(table, keys))
            .filter(|_| data.table_item_by_key(table, keys) == Some(item.res));
        Self::new(item, key, Some(self.path_with(keys)))
    }

    /// Reads `item`, or its target if it is an alias.
    #[inline(always)]
    fn string_of(&self, item: ResourceValue, place: Place) -> Result<DataString, UErrorCode> {
        if item.is_alias() {
            self.string_of_alias(item, place)
        } else {
            item.get_data_string()
        }
    }

    #[inline(never)]
    fn string_of_alias(&self, alias: ResourceValue, at: Place) -> Result<DataString, UErrorCode> {
        resolve_alias(alias, Some(self), at)?.get_data_string()
    }

    /// Returns `None` if this resource is neither a table nor an array: it is its own only item.
    #[inline]
    fn find_by_index(&self, i: usize) -> Result<Option<ResourceValue>, UErrorCode> {
        if i >= self.size {
            return Err(U_MISSING_RESOURCE_ERROR);
        }
        let res = self.data().item_by_index(self.resource.res, i);
        Ok(res.map(|res| ResourceValue {
            res,
            ..self.resource
        }))
    }

    #[cold]
    fn resolve_alias_at(&self, i: usize, alias: ResourceValue) -> Result<Self, UErrorCode> {
        let key = self.data().key_by_index(self.resource.res, i);
        let place = key.map_or(Place::Index(i), |key| Place::Keys(key.as_bytes()));
        resolve_alias(alias, Some(self), place)
    }

    #[cold]
    fn item_with_path(&self, i: usize, item: ResourceValue) -> Result<Self, UErrorCode> {
        let key = self.data().key_by_index(self.resource.res, i);
        let mut digits = NumBuffer::new();
        let name = key.map_or_else(|| i.format_into(&mut digits).as_bytes(), |it| it.as_bytes());
        Self::new(item, key, Some(self.path_with(name)))
    }

    #[cold]
    fn copy(&self) -> Self {
        Self {
            path: self.path.as_deref().map(SmallChars::of),
            ..*self
        }
    }

    /// The target of an alias has its own key.
    pub(crate) fn get_by_index(&self, i: usize) -> Result<Self, UErrorCode> {
        let Some(item) = self.find_by_index(i)? else {
            return Ok(self.copy());
        };
        if item.is_alias() {
            self.resolve_alias_at(i, item)
        } else if keeps_places() {
            self.item_with_path(i, item)
        } else {
            Self::new(item, self.data().key_by_index(self.resource.res, i), None)
        }
    }

    /// Yields the key of `get_by_index(i)` for each `i`.
    pub(crate) fn keys_of_items(
        &self,
    ) -> impl Iterator<Item = Result<Option<DataKey>, UErrorCode>> {
        let table = self.resource.get_table().ok();
        (0..self.size).map(
            move |i| match table.and_then(|table| table.key_unless_alias(i)) {
                None => self.key_of_item(i),
                key => Ok(key),
            },
        )
    }

    #[cold]
    fn key_of_item(&self, i: usize) -> Result<Option<DataKey>, UErrorCode> {
        Ok(self.get_by_index(i)?.key)
    }

    /// Returns `None` if the item of a table or an array is not a string. Fails if the target of an alias is not.
    #[inline]
    pub(crate) fn get_data_string_by_index(
        &self,
        i: usize,
    ) -> Result<Option<DataString>, UErrorCode> {
        match self.find_by_index(i)? {
            Some(item) if item.is_alias() => {
                self.resolve_alias_at(i, item)?.get_data_string().map(Some)
            }
            Some(item) => Ok(item.get_data_string().ok()),
            None => self.get_data_string().map(Some),
        }
    }

    pub(crate) fn has_next(&self) -> bool {
        self.next < self.size
    }

    /// Returns the index of the next item and increments it. The increment stays if reading the item fails.
    pub(crate) fn advance(&mut self) -> Result<usize, UErrorCode> {
        if !self.has_next() {
            return Err(U_INDEX_OUTOFBOUNDS_ERROR);
        }
        self.next += 1;
        Ok(self.next - 1)
    }

    pub(crate) fn get_next_resource(&mut self) -> Result<Self, UErrorCode> {
        let i = self.advance()?;
        self.get_by_index(i)
    }

    /// Returns the key of the next item in this table, also if the item is an alias.
    pub(crate) fn get_next_key(&self) -> Option<DataKey> {
        self.data().key_by_index(self.resource.res, self.next)
    }

    // ICU4C: uresbund.cpp, ures_getByKey, getFallbackData
    #[inline]
    pub(crate) fn find_by_key(&self, key: &[u8]) -> Result<ResourceValue, UErrorCode> {
        if !ures_is_table(res_get_type(self.resource.res)) {
            return Err(U_RESOURCE_TYPE_MISMATCH);
        }
        if let Some(res) = self.data().table_item_by_key(self.resource.res, key) {
            return Ok(ResourceValue {
                res,
                ..self.resource
            });
        }
        let first = self.resource.entry.parent().filter(|_| self.has_fallback);
        std::iter::successors(first, |entry| entry.parent())
            .find_map(|parent| Some(self.resource.with(parent, parent.root_item(key)?)))
            .ok_or(U_MISSING_RESOURCE_ERROR)
    }

    pub(crate) fn get_by_key(&self, key: &[u8]) -> Result<Self, UErrorCode> {
        self.item(self.find_by_key(key)?, key)
    }

    /// `get_by_key(key)?.get_value()`
    #[inline]
    pub(crate) fn get_value_by_key(&self, key: &[u8]) -> Result<ResourceValue, UErrorCode> {
        let item = self.find_by_key(key)?;
        if item.is_alias() {
            return self.item(item, key).map(|target| target.resource);
        }
        Ok(item)
    }

    /// Replaces `self` with the result of `get_by_key`. A failure leaves `self` unchanged.
    pub(crate) fn descend(&mut self, key: &[u8]) -> Result<(), UErrorCode> {
        self.get_by_key(key).map(|found| *self = found)
    }

    pub(crate) fn get_data_string_by_key(&self, key: &[u8]) -> Result<DataString, UErrorCode> {
        self.string_of(self.find_by_key(key)?, Place::Keys(key))
    }

    pub(crate) fn get_string_by_key(&self, key: &[u8]) -> Result<U16s<'static>, UErrorCode> {
        self.get_data_string_by_key(key).map(DataString::units)
    }
}

fn skip_segment(path: &[u8]) -> &[u8] {
    split_at_separator(path).1.unwrap_or_default()
}

/// Joins `path` and `keys`. If an alias led from `orig_path` to a `path` with n more segments, n segments of `keys` are dropped.
fn create_path(mut orig_path: &[u8], path: &[u8], mut keys: &[u8]) -> SmallChars {
    let mut extra = path;
    while !orig_path.is_empty() && !extra.is_empty() {
        (orig_path, extra) = (skip_segment(orig_path), skip_segment(extra));
    }
    while !extra.is_empty() && !keys.is_empty() {
        (extra, keys) = (skip_segment(extra), skip_segment(keys));
    }
    let mut created = SmallChars::of(path);
    created.add_all(keys);
    created
}

/// What `find_in_parents` finds.
struct Inherited {
    item: ResourceValue,
    /// See `keeps_places`.
    key: Option<DataKey>,
    /// The target of the last alias on the way to the item.
    helper: Option<UResourceBundle>,
}

impl UResourceBundle {
    /// `keys` may be a path like "NumberElements/latn/symbols". ICU4C: uresbund.cpp, ures_getByKeyWithFallback
    pub(crate) fn get_by_key_with_fallback(&self, keys: &[u8]) -> Result<Self, UErrorCode> {
        match self.find_by_path(keys)? {
            Some(item) => self.item(item, keys),
            None => self.inherited_item(&self.find_in_parents(keys)?, keys),
        }
    }

    pub(crate) fn get_by_key_with_fallback_and_tell(
        &self,
        keys: &[u8],
    ) -> Result<(Self, Opened), UErrorCode> {
        if let Some(item) = self.find_by_path(keys)? {
            return Ok((self.item(item, keys)?, Opened::Requested));
        }
        let inherited = self.find_in_parents(keys)?;
        let found = self.inherited_item(&inherited, keys)?;
        Ok((found, inherited.item.entry.as_fallback()))
    }

    #[inline(always)]
    fn inherited_item(&self, inherited: &Inherited, keys: &[u8]) -> Result<Self, UErrorCode> {
        let &Inherited { item, key, .. } = inherited;
        let mut found = if item.is_alias() {
            resolve_alias(item, Some(self), key.into())?
        } else {
            Self::new(item, key, None)?
        };
        let path = match &inherited.helper.as_ref().unwrap_or(self).path {
            Some(path) => create_path(self.path(), path, keys),
            None if skip_segment(found.path()).is_empty() => SmallChars::of(keys),
            None => create_path(self.path(), found.path(), keys),
        };
        append_keys(found.path.insert(path), &[]);
        Ok(found)
    }

    /// Follows tables only. Returns `None` if this bundle lacks the item. An empty path gives the table itself.
    fn find_by_path(&self, keys: &[u8]) -> Result<Option<ResourceValue>, UErrorCode> {
        let (mut res, mut rest) = (self.resource.res, keys);
        if !ures_is_table(res_get_type(res)) {
            return Err(U_RESOURCE_TYPE_MISMATCH);
        }
        while !rest.is_empty() {
            let (key, after) = split_at_separator(rest);
            let Some(item) = self.data().table_item_by_key(res, key) else {
                return Ok(None);
            };
            (res, rest) = (item, after.unwrap_or_default());
        }
        Ok(Some(ResourceValue {
            res,
            ..self.resource
        }))
    }

    fn find_in_parents(&self, keys: &[u8]) -> Result<Inherited, UErrorCode> {
        debug_assert!(
            self.path.is_some() || self.resource.res == self.data().root_res || keeps_places()
        );
        let mut entry = self.resource.entry;
        let mut helper: Option<Self> = None;
        let mut aliases = 0;
        let mut did_root_once = false;
        loop {
            match entry.parent() {
                Some(parent) => entry = parent,
                None if did_root_once => return Err(U_MISSING_RESOURCE_ERROR),
                // The last bundle is searched once more, to follow the aliases on the path.
                None => did_root_once = true,
            }
            let path = create_path(self.path(), helper.as_ref().unwrap_or(self).path(), keys);
            let (mut rest, mut container) = (&*path, entry.data.root_res);
            let mut step = rest;
            while let Some(res) = res_find_resource(&entry.data, container, &mut rest) {
                let item = self.resource.with(entry, res);
                if rest.is_empty() {
                    let key = keeps_places()
                        .then(|| res_find_last_key(&entry.data, container, step))
                        .flatten();
                    return Ok(Inherited { item, key, helper });
                }
                step = rest;
                if item.is_alias() {
                    aliases += 1;
                    if aliases == MAX_ITERATIONS {
                        return Err(U_TOO_MANY_ALIASES_ERROR);
                    }
                    let target = helper.insert(resolve_alias(item, Some(self), Place::Unnamed)?);
                    (entry, container) = (target.resource.entry, target.resource.res);
                }
            }
        }
    }

    pub(crate) fn get_string_by_key_with_fallback(
        &self,
        keys: &[u8],
    ) -> Result<DataString, UErrorCode> {
        let string = match self.find_by_path(keys)? {
            Some(item) => self.string_of(item, Place::Keys(keys))?,
            None => {
                let Inherited { item, key, .. } = self.find_in_parents(keys)?;
                self.string_of(item, key.into())?
            }
        };
        if string.is_empty_sets() {
            Err(U_MISSING_RESOURCE_ERROR)
        } else {
            Ok(string)
        }
    }
}

/// Passes the resource at `path`, or `bundle` if `path` is empty, to `sink`, first from this bundle and then from each ancestor.
#[cfg_attr(mordant, allow(defaulted_failure))] // An ancestor need not have the resource.
pub(crate) fn ures_get_all_items_with_fallback(
    bundle: &UResourceBundle,
    path: &[u8],
    sink: &mut dyn ResourceSink,
) -> Result<(), UErrorCode> {
    let (mut found, mut bundle) = (None, bundle);
    if !path.is_empty() {
        bundle = found.insert(bundle.get_by_key_with_fallback(path)?);
    }
    for _ in 1..MAX_ITERATIONS {
        sink.put(&bundle.resource)?;
        let Some(parent) = bundle.resource.entry.parent() else {
            return Ok(());
        };
        let root = UResourceBundle::root(parent, bundle.resource.valid_locale_entry);
        let in_parent = match bundle.path() {
            [] => Ok(root),
            path => root.get_by_key_with_fallback(path),
        };
        let Ok(in_parent) = in_parent else {
            return Ok(());
        };
        bundle = found.insert(in_parent);
    }
    Err(U_TOO_MANY_ALIASES_ERROR)
}

type ChildSink<'a> = dyn FnMut(&'static [u8], &ResourceValue) -> Result<(), UErrorCode> + 'a;

/// Passes the items of each table at `path` one by one, with aliases resolved.
pub(crate) fn ures_get_all_children_with_fallback(
    bundle: &UResourceBundle,
    path: &[u8],
    put: &mut ChildSink,
) -> Result<(), UErrorCode> {
    let mut put_children = |table: &ResourceValue| -> Result<(), UErrorCode> {
        for (key, value) in table.get_table()?.iter() {
            if value.is_alias() {
                put_alias_target(value, &mut |target| put(key, target))?;
            } else {
                put(key, &value)?;
            }
        }
        Ok(())
    };
    ures_get_all_items_with_fallback(bundle, path, &mut put_children)
}

/// Passes the target of `alias` to `put` and, if it is a table, the tables that it inherits from.
fn put_alias_target(
    alias: ResourceValue,
    put: &mut dyn FnMut(&ResourceValue) -> Result<(), UErrorCode>,
) -> Result<(), UErrorCode> {
    let mut target = resolve_alias(alias, None, Place::Unnamed)?;
    put(&target.resource)?;
    if target.get_type() != URES_TABLE {
        return Ok(());
    }
    let (mut entry, mut aliases) = (target.resource.entry, 0);
    while let Some(parent) = entry.parent() {
        entry = parent;
        let Some(res) = res_find_resource(&parent.data, parent.data.root_res, &mut target.path())
        else {
            continue;
        };
        let mut value = alias.with(parent, res);
        if value.is_alias() {
            aliases += 1;
            if aliases == MAX_ITERATIONS {
                return Err(U_TOO_MANY_ALIASES_ERROR);
            }
            target = resolve_alias(value, None, Place::Unnamed)?;
            value = target.resource;
            entry = value.entry;
        }
        if value.get_type() != URES_TABLE {
            return Err(U_INTERNAL_PROGRAM_ERROR);
        }
        put(&value)?;
    }
    Ok(())
}

const DEFAULT_TAG: &[u8] = b"default";

/// Returns the `%%Parent` of `bundle`, even an inherited one (uz_Arab_AF skips uz_Arab), or else the truncated `locale_id`.
fn get_parent_for_functional_equivalent(locale_id: &[u8], bundle: &UResourceBundle) -> SmallChars {
    let explicit = bundle.get_string_by_key(b"%%Parent");
    match explicit.and_then(|parent| invariant_chars::<SmallChars>(parent.iter())) {
        Ok(parent) if !parent.is_empty() => parent,
        _ => SmallChars::of(uloc_get_parent(until_nul(locale_id))),
    }
}

/// Returns the bundle for `locale`, and its table `calendar` if neither needs fallback.
fn open_calendars(locale: &[u8]) -> Result<(UResourceBundle, Option<UResourceBundle>), UErrorCode> {
    let (bundle, opened) = ures_open_and_tell(None, until_nul(locale))?;
    let calendars = match bundle.find_by_path(b"calendar") {
        Ok(Some(item)) if opened == Opened::Requested => bundle.item(item, b"calendar").ok(),
        _ => None,
    };
    Ok((bundle, calendars))
}

/// Returns the first `calendar/default` from `base_name` on, or nothing.
fn default_calendar(base_name: &[u8]) -> Result<SmallChars, UErrorCode> {
    let mut name = SmallChars::of(base_name);
    for _ in 1..MAX_ITERATIONS {
        let (bundle, calendars) = open_calendars(&name)?;
        let default = calendars
            .and_then(|calendars| calendars.get_string_by_key(DEFAULT_TAG).ok())
            .and_then(|default| invariant_chars::<SmallChars>(default.iter()).ok())
            .unwrap_or_default();
        let found = bundle.get_name().to_bytes();
        if !default.is_empty() || found == ROOT_LOCALE_NAME {
            return Ok(default);
        }
        name = if found == &*name {
            get_parent_for_functional_equivalent(found, &bundle)
        } else {
            SmallChars::of(found)
        };
    }
    Err(U_TOO_MANY_ALIASES_ERROR)
}

/// Returns the name of the first bundle from `base_name` on that has the calendar. After a failure there is only one round.
fn bundle_with_calendar(
    base_name: &[u8],
    calendar: &[u8],
    status: &mut Result<(), UErrorCode>,
) -> Option<SmallChars> {
    let mut name = SmallChars::of(base_name);
    for round in 1..MAX_ITERATIONS {
        let opened = open_calendars(&name).inspect_err(|&code| *status = Err(code));
        let (bundle, calendars) = opened.ok()?;
        if calendars.is_some_and(|all| all.get_by_key(until_nul(calendar)).is_ok()) {
            return Some(SmallChars::of(name_or_root(&name)));
        } else if name.is_empty() || status.is_err() {
            return None;
        }
        // After 512 bytes `base_name` has only values of keywords or a row of "_POSIX". They do not change the bundle.
        let found = name.get(..512).filter(|_| round == 1).unwrap_or(&name);
        name = get_parent_for_functional_equivalent(found, &bundle);
    }
    *status = Err(U_TOO_MANY_ALIASES_ERROR);
    None
}

fn find_calendar_type(base_name: &[u8], requested: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    const CAPACITY: usize =
        (ULOC_FULLNAME_CAPACITY + 1 + ULOC_KEYWORD_AND_VALUES_CAPACITY) as usize;
    let mut status = Ok(());
    let default = default_calendar(base_name).inspect_err(|&code| status = Err(code));
    let default = default.unwrap_or_default();
    let mut calendar = if requested.is_empty() {
        &default
    } else {
        requested
    };
    let mut bundle = bundle_with_calendar(base_name, calendar, &mut status);
    if bundle.is_none() && calendar != &*default {
        calendar = &default;
        bundle = bundle_with_calendar(base_name, calendar, &mut status);
    }
    status?;
    let bundle = bundle.ok_or(U_MISSING_RESOURCE_ERROR)?;
    let equivalent = memory::try_concat(&[&bundle, b"@calendar=", calendar])?;
    if equivalent.len() > CAPACITY {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    let terminated = equivalent.get(..CAPACITY - 1).unwrap_or(&equivalent);
    ulocimp_get_keyword_value(until_nul(terminated), b"calendar")
}

/// Returns the keyword if a bundle has that calendar, else the default. ICU4C: uresbund.cpp, ures_getFunctionalEquivalent
pub(crate) fn ures_get_calendar_type(locale_id: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    let mut requested = ulocimp_get_keyword_value(locale_id, b"calendar")?;
    if requested == DEFAULT_TAG {
        requested.clear();
    }
    let mut base_name = SmallChars::new();
    ulocimp_get_base_name_to(locale_id, &mut base_name)?;
    fail_on_oom(|| find_calendar_type(&base_name, &requested))
}

/// Returns the keys of the table `keyword` in all bundles of a tree, except "default" and "private-...".
pub(crate) fn ures_get_keyword_values(
    tree: Tree,
    keyword: &[u8],
) -> Result<UKeywordsContext, UErrorCode> {
    let installed = ures_open_direct(tree, b"res_index")?.get_by_key(b"InstalledLocales")?;
    let mut values = Vec::new();
    for locale in installed.keys_of_items().map_while(Result::transpose) {
        let Ok(bundle) = &ures_open(tree, locale?.as_bytes()) else {
            continue;
        };
        let Ok(table) = &bundle.get_by_key(keyword) else {
            continue;
        };
        for key in table.keys_of_items().map_while(Result::ok).flatten() {
            let name = key.as_bytes();
            if !matches!(name, b"" | DEFAULT_TAG)
                && !name.starts_with(b"private-")
                && !strings::split(&values, b"\0").any(|value| value == name)
            {
                values.add_all(name);
                values.add(0);
            }
        }
    }
    oom_checked(UKeywordsContext::new(values))
}

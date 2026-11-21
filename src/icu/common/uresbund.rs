//! Resource bundles: the cache of bundle files, locale fallback, aliases and lookups. ICU4C: uresbund.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::bytes::{I32s, U16s};
use crate::common::charstr::SmallChars;
use crate::common::cstring::{find_last_byte, split_once};
use crate::common::localefallback_data::*;
use crate::common::memory::{self, Appendable, fail_on_oom, oom_checked, try_box};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::soft_assert::soft_unreachable;
use crate::common::uinvchar::{invariant_chars, invariant_prefix};
use crate::common::uloc::{
    Language, Script, Subtag, Subtags, UKeywordsContext, find_row, uloc_get_default,
    uloc_get_parent, uloc_get_script, ulocimp_get_base_name_to, ulocimp_get_keyword_value,
};
use crate::common::umutex::StaticMap;
use crate::common::unicode::uloc::ULOC_FULLNAME_CAPACITY;
use crate::common::unicode::ures::*;
use crate::common::uresdata::*;
use crate::common::utypes::*;
use bun_core::strings;
use std::ffi::{CStr, CString};
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;

pub(crate) const ROOT_LOCALE_NAME: &[u8] = b"root";

/// Bounds the aliases or parents that one step follows, which only damaged data make a cycle of.
const MAX_LINKS: u32 = 32;

/// The tree of the package that has a bundle: one of the `U_ICUDATA_...` constants, or `None` for the main tree.
pub(crate) type Tree = Option<&'static [u8]>;

/// A loaded bundle file. It is never freed.
pub(crate) struct UResourceDataEntry {
    name: CString,
    tree: Tree,
    /// Set only after the parent has its own ancestors, so that every chain of parents is finite.
    parent: OnceLock<Entry>,
    /// The final target of `%%ALIAS`.
    alias: Option<Entry>,
    pub(crate) data: ResourceData,
}

pub(crate) type Entry = &'static UResourceDataEntry;

type Name = Subtag<{ ULOC_FULLNAME_CAPACITY as usize - 1 }>;

impl UResourceDataEntry {
    fn name(&self) -> &[u8] {
        self.name.as_bytes()
    }

    fn parent(&self) -> Option<Entry> {
        self.parent.get().copied()
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
}

/// Returns the name of a bundle in `%%ALIAS` or `%%Parent`.
fn linked_name(data: &ResourceData, key: &[u8]) -> Option<Name> {
    let name = res_get_data_string(data, data.table_item_by_key(data.root_res, key)?)?.units();
    (1..=Name::CAPACITY)
        .contains(&name.len())
        .then(|| Name::new(invariant_prefix(name.iter())))
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

/// Returns the entry for `name` or its `%%ALIAS`, `None` if that file is missing or malformed, `Err` if its pool or alias is unusable.
fn find_entry(name: &[u8], tree: Tree, depth: u32) -> Result<Option<Entry>, UErrorCode> {
    let name = if name.is_empty() {
        ROOT_LOCALE_NAME
    } else {
        name
    };
    match CACHE.with_lock(|cache| cache.get(&CacheKey { name, tree }).copied()) {
        Some(entry) => Ok(Some(entry.resolved())),
        None => load_entry(name, tree, depth),
    }
}

// ICU4C: uresbund.cpp, init_entry
fn load_entry(name: &[u8], tree: Tree, depth: u32) -> Result<Option<Entry>, UErrorCode> {
    let mut data = match res_load(tree, name) {
        Ok(data) => data,
        Err(U_MEMORY_ALLOCATION_ERROR) => return Err(U_MEMORY_ALLOCATION_ERROR),
        Err(_) => return Ok(None),
    };
    if depth == MAX_LINKS {
        return Err(U_TOO_MANY_ALIASES_ERROR);
    }
    if data.uses_pool_bundle {
        let pool = find_entry(b"pool", tree, depth + 1)?.ok_or(U_INVALID_FORMAT_ERROR)?;
        data.use_pool(&pool.data)?;
    }
    let alias = match linked_name(&data, b"%%ALIAS") {
        Some(alias) => match find_entry(&alias, tree, depth + 1)? {
            None => return Ok(None),
            target => target,
        },
        None => None,
    };
    let entry = try_box(UResourceDataEntry {
        name: memory::try_cstring(name)?,
        tree,
        parent: OnceLock::new(),
        alias,
        data,
    })?;
    let entry = CACHE.get_or_insert_by(
        entry,
        |cache, new| cache.get(&new.cache_key()).copied(),
        |new| {
            let entry: Entry = Box::leak(new);
            (entry.cache_key(), entry)
        },
    )?;
    Ok(Some(entry.resolved()))
}

fn chop_locale(name: &[u8]) -> Option<&[u8]> {
    find_last_byte(name, b'_').map(|at| name.slice(..at))
}

/// Links `entry` to its ancestors up to root. ICU4C: uresbund.cpp, loadParentsExceptRoot
fn load_parents(entry: Entry, depth: u32) -> Result<(), UErrorCode> {
    let name = entry.name();
    if entry.parent().is_some() || entry.data.no_fallback || name == ROOT_LOCALE_NAME {
        return Ok(());
    }
    if depth == MAX_LINKS {
        return Err(U_TOO_MANY_ALIASES_ERROR);
    }
    let chopped = chop_locale(name);
    // Of the names without a '_', only these have their `%%Parent` read.
    let explicit = (chopped.is_some() || matches!(name, b"nb" | b"nn"))
        .then(|| linked_name(&entry.data, b"%%Parent"))
        .flatten();
    let names = std::iter::successors(explicit.as_deref().or(chopped), |name| chop_locale(name));
    for name in names.chain([ROOT_LOCALE_NAME]) {
        if let Some(parent) = find_entry(name, entry.tree, 0)? {
            load_parents(parent, depth + 1)?;
            entry.parent.get_or_init(|| parent);
            break;
        }
    }
    Ok(())
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
            return chop_locale(name).map(|parent| {
                ParentName::Borrowed(if parent.is_empty() { b"und" } else { parent })
            });
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

/// The name under which `ures_open_and_tell` found the bundle.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Opened {
    Requested,
    /// A parent of the requested locale, which can be root.
    Parent,
    /// The default locale, one of its parents, or root as the last resort.
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
    /// Returns the first existing bundle among `orig_name` and its fallbacks, linked to its parents.
    fn find_first_existing(&mut self, orig_name: &[u8]) -> Result<Option<Entry>, UErrorCode> {
        let orig_name = orig_name.slice(..orig_name.len().min(Name::CAPACITY));
        let (mut name, mut composed);
        name = orig_name;
        while !self.has_failed {
            let is_other_script = |entry: Entry| {
                name == b"sr_ME"
                    && orig_name.starts_with(b"sr_Cyrl")
                    && entry.name().starts_with(b"sr_Latn")
            };
            match find_entry(name, self.tree, 0) {
                Ok(Some(entry)) if !is_other_script(entry) => {
                    return load_parents(entry, 0).map(|()| Some(entry));
                }
                Ok(_) => self.opened = Opened::Parent,
                Err(_) => {
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
        oom_checked(None)
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
    if let Some(found) = search.find_first_existing(locale_id)? {
        return Ok((found, search.opened));
    }
    let mut found = None;
    if open_type == UResOpenType::LocaleDefaultRoot && search.try_default {
        // The full ID, with its keywords.
        found = search.find_first_existing(default_locale)?;
        search.has_failed = false;
    }
    if found.is_none() {
        found = search.find_first_existing(ROOT_LOCALE_NAME)?;
    }
    Ok((found.ok_or(U_MISSING_RESOURCE_ERROR)?, Opened::Default))
}

fn entry_open_direct(tree: Tree, name: &[u8]) -> Result<Entry, UErrorCode> {
    let entry = find_entry(name, tree, 0)?.ok_or(U_MISSING_RESOURCE_ERROR)?;
    load_parents(entry, 0).map(|()| entry)
}

fn open_with_type(
    tree: Tree,
    locale_id: &[u8],
    open_type: UResOpenType,
) -> Result<(UResourceBundle, Opened), UErrorCode> {
    let mut base_name = SmallChars::new();
    fail_on_oom(|| ulocimp_get_base_name_to(locale_id, &mut base_name))
        .map_err(|_| U_ILLEGAL_ARGUMENT_ERROR)?;
    let (entry, opened) = entry_open(tree, &base_name, open_type)?;
    let bundle = UResourceBundle {
        has_fallback: true,
        ..UResourceBundle::root(entry, entry)
    };
    Ok((bundle, opened))
}

pub(crate) fn ures_open(tree: Tree, locale_id: &[u8]) -> Result<UResourceBundle, UErrorCode> {
    Ok(ures_open_and_tell(tree, locale_id)?.0)
}

pub(crate) fn ures_open_and_tell(
    tree: Tree,
    locale_id: &[u8],
) -> Result<(UResourceBundle, Opened), UErrorCode> {
    open_with_type(tree, locale_id, UResOpenType::LocaleDefaultRoot)
}

pub(crate) fn ures_open_no_default(
    tree: Tree,
    locale_id: &[u8],
) -> Result<UResourceBundle, UErrorCode> {
    Ok(open_with_type(tree, locale_id, UResOpenType::LocaleRoot)?.0)
}

/// Opens the bundle `name` and no other in its place.
pub(crate) fn ures_open_direct(tree: Tree, name: &[u8]) -> Result<UResourceBundle, UErrorCode> {
    entry_open_direct(tree, name).map(|entry| UResourceBundle::root(entry, entry))
}

pub(crate) struct UResourceBundle {
    resource: ResourceValue,
    /// Only an item of a table that was fetched by index has it.
    key: Option<DataKey>,
    /// The keys from the root table, like "calendar/gregorian/". An item that was fetched by index has none, so no fallback.
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

/// Resolves "/LOCALE/keys" in the bundle that was opened, and "/ICUDATA/bundle/keys" in the main tree.
fn resolve_alias(alias: ResourceValue) -> Result<UResourceBundle, UErrorCode> {
    follow_alias(alias, &mut { MAX_LINKS })
}

/// `budget` bounds the recursion and the restarts. ICU4C: uresbund.cpp, getAliasTargetAsResourceBundle
fn follow_alias(alias: ResourceValue, budget: &mut u32) -> Result<UResourceBundle, UErrorCode> {
    *budget = budget.checked_sub(1).ok_or(U_TOO_MANY_ALIASES_ERROR)?;
    let text: SmallChars = invariant_chars(alias.get_alias_string()?.iter())?;
    let (mut entry, path) = if let Some(path) = text.strip_prefix(b"/LOCALE/") {
        (alias.valid_locale_entry, path)
    } else if let Some((name, Some(path))) = text.strip_prefix(b"/ICUDATA/").map(split_at_separator)
    {
        (entry_open_direct(None, name)?, path)
    } else {
        soft_unreachable();
        return Err(U_UNSUPPORTED_ERROR);
    };
    let (mut rest, mut container) = (path, entry.data.root_res);
    loop {
        let Some(res) = res_find_resource(&entry.data, container, &mut rest) else {
            entry = entry.parent().ok_or(U_MISSING_RESOURCE_ERROR)?;
            (rest, container) = (path, entry.data.root_res);
            continue;
        };
        let item = alias.with(entry, res);
        let mut found = if item.is_alias() {
            follow_alias(item, budget)?
        } else {
            UResourceBundle::new(item, None)?
        };
        if rest.is_empty() {
            append_keys(found.path.insert(SmallChars::new()), path);
            return Ok(found);
        }
        (entry, container) = (found.resource.entry, found.resource.res);
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
    fn new(resource: ResourceValue, path: Option<SmallChars>) -> Result<Self, UErrorCode> {
        Ok(Self {
            resource,
            key: None,
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
            return resolve_alias(item);
        }
        let mut path = SmallChars::of(self.path());
        append_keys(&mut path, keys);
        Self::new(item, Some(path))
    }

    /// A resource that is neither a table nor an array is its own only item.
    #[inline]
    fn find_by_index(&self, i: usize) -> Result<ResourceValue, UErrorCode> {
        if i >= self.size {
            return Err(U_MISSING_RESOURCE_ERROR);
        }
        let res = self.data().item_by_index(self.resource.res, i);
        Ok(res.map_or(self.resource, |res| ResourceValue {
            res,
            ..self.resource
        }))
    }

    pub(crate) fn get_by_index(&self, i: usize) -> Result<Self, UErrorCode> {
        let item = self.find_by_index(i)?;
        if item.is_alias() {
            return resolve_alias(item);
        }
        Ok(Self {
            key: self.data().key_by_index(self.resource.res, i),
            ..Self::new(item, None)?
        })
    }

    /// Returns `None` if the item of a table or an array is not a string.
    #[inline]
    pub(crate) fn get_data_string_by_index(
        &self,
        i: usize,
    ) -> Result<Option<DataString>, UErrorCode> {
        Ok(without_alias(self.find_by_index(i)?)?
            .get_data_string()
            .ok())
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

    /// Replaces `self` with the result of `get_by_key`. A failure leaves `self` unchanged.
    pub(crate) fn descend(&mut self, key: &[u8]) -> Result<(), UErrorCode> {
        self.get_by_key(key).map(|found| *self = found)
    }

    pub(crate) fn get_data_string_by_key(&self, key: &[u8]) -> Result<DataString, UErrorCode> {
        without_alias(self.find_by_key(key)?)?.get_data_string()
    }

    pub(crate) fn get_string_by_key(&self, key: &[u8]) -> Result<U16s<'static>, UErrorCode> {
        self.get_data_string_by_key(key).map(DataString::units)
    }
}

#[inline]
fn without_alias(item: ResourceValue) -> Result<ResourceValue, UErrorCode> {
    if item.is_alias() {
        Ok(resolve_alias(item)?.resource)
    } else {
        Ok(item)
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

impl UResourceBundle {
    /// `keys` may be a path like "NumberElements/latn/symbols".
    pub(crate) fn get_by_key_with_fallback(&self, keys: &[u8]) -> Result<Self, UErrorCode> {
        if let Some(item) = self.find_by_path(keys)? {
            return self.item(item, keys);
        }
        let (item, helper) = self.find_in_parents(keys)?;
        let mut found = if item.is_alias() {
            resolve_alias(item)?
        } else {
            Self::new(item, None)?
        };
        let path = match &helper.as_ref().unwrap_or(self).path {
            Some(path) => create_path(self.path(), path, keys),
            None if skip_segment(found.path()).is_empty() => SmallChars::of(keys),
            None => create_path(self.path(), found.path(), keys),
        };
        append_keys(found.path.insert(path), &[]);
        Ok(found)
    }

    /// Returns `None` if this bundle lacks the item or has an alias on the way to it. An empty path gives the table itself.
    fn find_by_path(&self, keys: &[u8]) -> Result<Option<ResourceValue>, UErrorCode> {
        if !ures_is_table(res_get_type(self.resource.res)) {
            return Err(U_RESOURCE_TYPE_MISMATCH);
        }
        let mut rest = keys;
        let res = res_find_resource(self.data(), self.resource.res, &mut rest);
        Ok(res.filter(|_| rest.is_empty()).map(|res| ResourceValue {
            res,
            ..self.resource
        }))
    }

    /// Returns the item and `helper`, the target of the last alias on the path to the item.
    fn find_in_parents(&self, keys: &[u8]) -> Result<(ResourceValue, Option<Self>), UErrorCode> {
        debug_assert!(self.path.is_some() || self.resource.res == self.data().root_res);
        let mut entry = self.resource.entry;
        let mut helper: Option<Self> = None;
        let mut budget = MAX_LINKS;
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
            while let Some(res) = res_find_resource(&entry.data, container, &mut rest) {
                let item = self.resource.with(entry, res);
                if rest.is_empty() {
                    return Ok((item, helper));
                }
                if item.is_alias() {
                    let target = helper.insert(follow_alias(item, &mut budget)?);
                    (entry, container) = (target.resource.entry, target.resource.res);
                }
            }
        }
    }

    pub(crate) fn get_string_by_key_with_fallback(
        &self,
        keys: &[u8],
    ) -> Result<DataString, UErrorCode> {
        let item = match self.find_by_path(keys)? {
            Some(item) => item,
            None => self.find_in_parents(keys)?.0,
        };
        let value = without_alias(item)?;
        if value.is_no_inheritance_marker() {
            Err(U_MISSING_RESOURCE_ERROR)
        } else {
            value.get_data_string()
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
    for _ in 0..MAX_LINKS {
        sink.put(&bundle.resource)?;
        let Some(parent) = bundle.resource.entry.parent() else {
            return Ok(());
        };
        let root = UResourceBundle::root(parent, bundle.resource.valid_locale_entry);
        let Ok(in_parent) = root.get_by_key_with_fallback(bundle.path()) else {
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
    let mut budget = MAX_LINKS;
    let mut target = follow_alias(alias, &mut budget)?;
    put(&target.resource)?;
    if target.get_type() != URES_TABLE {
        return Ok(());
    }
    let mut entry = target.resource.entry;
    while let Some(parent) = entry.parent() {
        entry = parent;
        let Some(res) = res_find_resource(&parent.data, parent.data.root_res, &mut target.path())
        else {
            continue;
        };
        let mut value = alias.with(parent, res);
        if value.is_alias() {
            target = follow_alias(value, &mut budget)?;
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

/// Returns the first `calendar/default` along `%%Parent`, even an inherited one: uz_Arab_AF skips uz_Arab.
fn default_calendar(base_name: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    let mut name = SmallChars::of(base_name);
    for _ in 0..MAX_LINKS {
        let (bundle, opened) = ures_open_and_tell(None, &name)?;
        if opened == Opened::Requested
            && let Ok(Some(default)) = bundle.find_by_path(b"calendar/default")
        {
            return invariant_chars(default.get_string()?.iter());
        }
        let found = bundle.get_name().to_bytes();
        if found == ROOT_LOCALE_NAME {
            return Err(U_MISSING_RESOURCE_ERROR);
        }
        name = if found != &*name {
            SmallChars::of(found)
        } else if let Ok(parent) = bundle.get_string_by_key(b"%%Parent") {
            invariant_chars(parent.iter())?
        } else {
            SmallChars::of(uloc_get_parent(found))
        };
    }
    Err(U_TOO_MANY_ALIASES_ERROR)
}

/// Returns the keyword if root, with all calendars, has it, else the default. ICU4C: uresbund.cpp, ures_getFunctionalEquivalent
pub(crate) fn ures_get_calendar_type(locale_id: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    let requested = ulocimp_get_keyword_value(locale_id, b"calendar")?;
    if !matches!(&*requested, b"" | b"default")
        && (ures_open_direct(None, ROOT_LOCALE_NAME)?.get_by_key(b"calendar")?)
            .find_by_key(&requested)
            .is_ok()
    {
        return Ok(requested);
    }
    let mut base_name = SmallChars::new();
    ulocimp_get_base_name_to(locale_id, &mut base_name)?;
    oom_checked(default_calendar(&base_name)?)
}

/// Returns the keys of the table `keyword` in all bundles of a tree, except "default" and "private-...".
pub(crate) fn ures_get_keyword_values(
    tree: Tree,
    keyword: &[u8],
) -> Result<UKeywordsContext, UErrorCode> {
    let installed = ures_open_direct(tree, b"res_index")?.get_by_key(b"InstalledLocales")?;
    let mut values = Vec::new();
    for (locale, _) in installed.resource.get_table()?.iter() {
        let table = ures_open(tree, locale)?.get_by_key(keyword)?;
        for (key, _) in table.resource.get_table()?.iter_data_keys() {
            let name = key.as_bytes();
            if name != b"default"
                && !name.starts_with(b"private-")
                && !strings::split(&values, b"\0").any(|value| value == name)
            {
                values.add_all(key.as_c_str().to_bytes_with_nul());
            }
        }
    }
    oom_checked(UKeywordsContext::new(values))
}

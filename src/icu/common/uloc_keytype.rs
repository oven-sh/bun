//! Maps between `-u-ca-gregory` and `@calendar=gregorian`, by `keyTypeData.res`. ICU4C: uloc_keytype.cpp

use crate::common::bytes::U16s;
use crate::common::charstr::{CharStrings, SmallChars, Span};
use crate::common::maps::Map;
use crate::common::memory::{self, Appendable};
use crate::common::sorting::sort_in_place_by;
use crate::common::uinvchar::invariant_prefix;
use crate::common::umutex::OnceBox;
use crate::common::uresdata::DataKey;
use crate::common::uresimp::{UResourceBundle, ures_open_direct};
use crate::common::utypes::UErrorCode;
use std::ffi::CStr;

/// A name of a key or a type. The C API returns pointers to names.
#[derive(Clone, Copy)]
enum Name {
    /// The resource key itself.
    Key(&'static CStr),
    /// A converted copy in `NameMap::strings`.
    Converted(Span),
}

#[derive(Clone, Copy)]
struct Names {
    legacy: Name,
    bcp: Name,
}

/// Selects one of the two names.
type NameSelector = fn(Names) -> Name;

const LEGACY: NameSelector = |names| names.legacy;
const BCP: NameSelector = |names| names.bcp;

/// A case-insensitive map from legacy names, BCP 47 names and aliases to entries.
struct NameMap {
    entries: Vec<Names>,
    /// Names in lower case, each with the index of its entry.
    index: Vec<(Span, u32)>,
    strings: CharStrings,
}

impl NameMap {
    fn try_with_capacity(entries: usize) -> Result<Self, UErrorCode> {
        let (index, strings) = (memory::try_with_capacity(entries)?, CharStrings::default());
        Ok(Self {
            entries: memory::try_with_capacity(entries)?,
            index,
            strings,
        })
    }

    fn add_name(&mut self, name: &[u8], entry: usize) -> Result<(), UErrorCode> {
        let mut lower = SmallChars::new();
        lower.add_each(name.iter().map(u8::to_ascii_lowercase));
        memory::try_push(&mut self.index, (self.strings.add(&lower)?, entry as u32))
    }

    /// Adds an entry. `legacy` is `name_from_key(key)`; an empty `bcp` stands for `legacy`. Call `sorted` before `find`.
    fn push(&mut self, key: &'static CStr, legacy: &[u8], bcp: &[u8]) -> Result<(), UErrorCode> {
        self.add_name(legacy, self.entries.len())?;
        let legacy = if legacy == key.to_bytes() {
            Name::Key(key)
        } else {
            Name::Converted(self.strings.add(legacy)?)
        };
        let mut names = Names {
            legacy,
            bcp: legacy,
        };
        if !bcp.is_empty() {
            self.add_name(bcp, self.entries.len())?;
            names.bcp = Name::Converted(self.strings.add(bcp)?);
        }
        memory::try_push(&mut self.entries, names)
    }

    /// Sorts the index, and keeps the last entry of each name.
    fn sorted(mut self) -> Self {
        let name = |entry: &(Span, u32)| self.strings.get(entry.0);
        sort_in_place_by(&mut self.index, |a, b| {
            name(a).cmp(name(b)).then(b.1.cmp(&a.1))
        });
        self.index.dedup_by(|a, b| name(a) == name(b));
        self
    }

    /// Returns the index of the entry.
    fn find(&self, name: &[u8]) -> Option<usize> {
        let lower = || name.iter().map(u8::to_ascii_lowercase);
        let at = self
            .index
            .binary_search_by(|&(known, _)| self.strings.get(known).iter().copied().cmp(lower()))
            .ok()?;
        self.index.get(at).map(|&(_, entry)| entry as usize)
    }

    fn c_str(&self, name: Name) -> &CStr {
        match name {
            Name::Key(key) => key,
            Name::Converted(span) => self.strings.get_c_str(span),
        }
    }

    fn get_name(&self, name: &[u8], select: NameSelector) -> Option<&CStr> {
        self.entries
            .get(self.find(name)?)
            .map(|&names| self.c_str(select(names)))
    }
}

struct KeyTypeData {
    keys: NameMap,
    /// The types of each entry of `keys`.
    types: Vec<NameMap>,
}

impl KeyTypeData {
    fn types_of(&self, key: &[u8]) -> Option<&NameMap> {
        self.types.get(self.keys.find(key)?)
    }
}

fn invariant_bytes(text: U16s) -> SmallChars {
    let mut chars = SmallChars::new();
    chars.add_each(invariant_prefix(text.iter()));
    chars
}

fn bcp_name_of(entry: &UResourceBundle) -> Result<SmallChars, UErrorCode> {
    entry.get_string().map(invariant_bytes)
}

fn key_of(entry: &UResourceBundle) -> &'static CStr {
    entry.get_data_key().map_or(c"", DataKey::as_c_str)
}

/// Returns the name for a resource key. Keys of time zones have ':' in place of '/'.
fn name_from_key(key: &CStr, is_zone: bool) -> SmallChars {
    let mut name = SmallChars::new();
    name.add_each(
        key.to_bytes()
            .iter()
            .map(|&c| if is_zone && c == b':' { b'/' } else { c }),
    );
    name
}

/// Maps each alias to the last type whose name is the alias target.
fn add_aliases(
    types: &mut NameMap,
    select: NameSelector,
    mut aliases: UResourceBundle,
    is_zone: bool,
) -> Result<(), UErrorCode> {
    let mut last_entry = Map::default();
    memory::try_map_reserve(&mut last_entry, types.entries.len())?;
    for (entry, &names) in types.entries.iter().enumerate() {
        memory::insert_within_capacity(
            &mut last_entry,
            types.c_str(select(names)).to_bytes(),
            entry,
        );
    }
    let mut found = Vec::new();
    while aliases.has_next() {
        let alias = &aliases.get_next_resource()?;
        let target = alias.get_string()?;
        if let Some(&entry) = last_entry.get(&*invariant_bytes(target)) {
            found.add((key_of(alias), entry));
        }
    }
    drop(last_entry);
    found
        .into_iter()
        .try_for_each(|(alias, entry)| types.add_name(&name_from_key(alias, is_zone), entry))
}

// ICU4C: uloc_keytype.cpp, initFromResourceBundle
fn load() -> Result<KeyTypeData, UErrorCode> {
    let data = ures_open_direct(None, b"keyTypeData")?;
    let mut key_map = data.get_by_key(b"keyMap")?;
    let type_map = data.get_by_key(b"typeMap")?;
    let [type_alias, bcp_type_alias] =
        [&b"typeAlias"[..], b"bcpTypeAlias"].map(|table| data.get_by_key(table).ok());
    let aliases_of =
        |table: &Option<UResourceBundle>, key: &[u8]| table.as_ref()?.get_by_key(key).ok();

    let mut keys = NameMap::try_with_capacity(key_map.get_size())?;
    let mut types_of_keys = memory::try_with_capacity(key_map.get_size())?;
    while key_map.has_next() {
        let entry = &key_map.get_next_resource()?;
        let (key, bcp) = (key_of(entry), bcp_name_of(entry)?);
        let legacy = key.to_bytes();
        let is_zone = legacy == b"timezone";
        let mut types_of_key = type_map.get_by_key(legacy)?;
        let mut types = NameMap::try_with_capacity(types_of_key.get_size())?;
        while types_of_key.has_next() {
            let entry = &types_of_key.get_next_resource()?;
            let key = key_of(entry);
            // Special types name a syntax. Values that match are well-formed, so the fallbacks return them unchanged.
            if !matches!(
                key.to_bytes(),
                b"CODEPOINTS" | b"REORDER_CODE" | b"RG_KEY_VALUE"
            ) {
                types.push(key, &name_from_key(key, is_zone), &bcp_name_of(entry)?)?;
            }
        }
        if let Some(aliases) = aliases_of(&type_alias, legacy) {
            add_aliases(&mut types, LEGACY, aliases, is_zone)?;
        }
        let bcp_key = if bcp.is_empty() { legacy } else { &bcp };
        if let Some(aliases) = aliases_of(&bcp_type_alias, bcp_key) {
            add_aliases(&mut types, BCP, aliases, false)?;
        }
        keys.push(key, legacy, &bcp)?;
        types_of_keys.add(types.sorted());
    }
    Ok(KeyTypeData {
        keys: keys.sorted(),
        types: types_of_keys,
    })
}

fn data() -> Option<&'static KeyTypeData> {
    static DATA: OnceBox<Result<KeyTypeData, UErrorCode>> = OnceBox::new();
    DATA.get_or_init_caching_err(load).ok()
}

pub(crate) fn ulocimp_to_bcp_key(name: &[u8]) -> Option<&'static CStr> {
    data()?.keys.get_name(name, BCP)
}

pub(crate) fn ulocimp_to_legacy_key(name: &[u8]) -> Option<&'static CStr> {
    data()?.keys.get_name(name, LEGACY)
}

pub(crate) fn ulocimp_to_bcp_type(key: &[u8], name: &[u8]) -> Option<&'static CStr> {
    data()?.types_of(key)?.get_name(name, BCP)
}

pub(crate) fn ulocimp_to_legacy_type(key: &[u8], name: &[u8]) -> Option<&'static CStr> {
    data()?.types_of(key)?.get_name(name, LEGACY)
}

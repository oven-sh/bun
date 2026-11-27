//! CLDR's region codes with their aliases and successors. ICU4C: region.cpp

use crate::common::charstr::SmallChars;
use crate::common::locresdata::find_replacement;
use crate::common::maps::Map;
use crate::common::memory::{defer_oom, try_collect, try_map_insert, try_push};
use crate::common::udata::searches_files;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::Subtag;
use crate::common::umutex::OnceBox;
use crate::common::unicode::ures::URES_ARRAY;
use crate::common::unistr::from_invariant;
use crate::common::uresimp::*;
use crate::common::utypes::*;

struct Region {
    /// Empty if the code is longer.
    id: Subtag<4>,
    /// The only preferred value of a deprecated region.
    successor: Option<usize>,
}

/// All `usize` values are indexes into `regions`.
#[derive(Default)]
struct Regions {
    regions: Vec<Region>,
    ids: Map<Vec<u16>, usize>,
    aliases: Map<Vec<u16>, usize>,
}

fn key_of(bundle: &UResourceBundle) -> Vec<u16> {
    from_invariant(bundle.get_key().unwrap_or_default())
}

/// Fails if an alias among the items does not lead to a string.
fn check_members(members: &UResourceBundle) -> Result<(), UErrorCode> {
    (0..members.get_size()).try_for_each(|i| members.get_data_string_by_index(i).map(drop))
}

impl Regions {
    /// Later steps overwrite the results of earlier steps. ICU4C: region.cpp, Region::loadRegionData
    fn load() -> Result<Self, UErrorCode> {
        let metadata_alias = ures_open_direct(None, b"metadata")?.get_by_key(b"alias")?;
        let aliases = metadata_alias.get_by_key(b"territory")?;
        let supplemental_data = ures_open_direct(None, b"supplementalData")?;
        let mut code_mappings = supplemental_data.get_by_key(b"codeMappings")?;
        let id_validity = supplemental_data.get_by_key(b"idValidity")?;
        let region_list = id_validity.get_by_key(b"region")?;
        let regular = region_list.get_by_key(b"regular")?;
        let macroregions = region_list.get_by_key(b"macroregion")?;
        let mut unknown = region_list.get_by_key(b"unknown")?;
        let mut containment = supplemental_data.get_by_key(b"territoryContainment")?;
        let mut continents = containment.get_by_key(b"001")?;
        let mut groupings = containment.get_by_key(b"grouping")?;

        let mut this = Self::default();
        this.load_codes(regular)?;
        this.load_codes(macroregions)?;
        while unknown.has_next() {
            this.add_code(ures_get_next_unicode_string(&mut unknown)?.0)?;
        }
        let mut never_deprecated = try_collect([&b"001"[..], b"ZZ", b"QO"].map(from_invariant))?;
        while continents.has_next() {
            let continent = ures_get_next_unicode_string(&mut continents)?.0;
            try_push(&mut never_deprecated, continent)?;
        }
        while groupings.has_next() {
            let members = groupings.get_next_resource()?;
            let grouping = key_of(&members);
            if this.ids.contains_key(&grouping) {
                check_members(&members)?;
            }
            try_push(&mut never_deprecated, grouping)?;
        }
        this.load_aliases(aliases)?;
        while code_mappings.has_next() {
            this.load_code_mapping(&code_mappings.get_next_resource()?)?;
        }
        for id in never_deprecated {
            if let Some(region) = this.by_id_mut(&id) {
                region.successor = None;
            }
        }
        while containment.has_next() {
            let members = containment.get_next_resource()?;
            if !matches!(
                members.get_key(),
                Some(b"containedGroupings" | b"deprecated")
            ) {
                check_members(&members)?;
            }
        }
        Ok(this)
    }

    /// Expands ranges: "AC~G" is AC, AD, AE, AF, AG.
    fn load_codes(&mut self, mut list: UResourceBundle) -> Result<(), UErrorCode> {
        const RANGE_MARKER: u16 = b'~' as u16;
        const MAX_RANGE: u16 = 4096;
        while list.has_next() {
            let name = ures_get_next_unicode_string(&mut list)?.0;
            if name.len() > 6 {
                return Err(U_BUFFER_OVERFLOW_ERROR);
            }
            let mut parts = name.splitn(2, |&c| c == RANGE_MARKER);
            let (Some([prefix @ .., first]), Some(end)) = (parts.next(), parts.next()) else {
                self.add_code(name)?;
                continue;
            };
            let last = end.first().copied().unwrap_or(0xffff);
            if last == 0xffff || last.saturating_sub(*first) >= MAX_RANGE {
                return Err(U_INVALID_FORMAT_ERROR);
            }
            for c in *first..=last {
                let code = prefix.iter().copied().chain([c]).take_while(|&c| c != 0);
                self.add_code(try_collect(code)?)?;
            }
        }
        Ok(())
    }

    fn load_aliases(&mut self, mut aliases: UResourceBundle) -> Result<(), UErrorCode> {
        const SPACE: u16 = b' ' as u16;
        while aliases.has_next() {
            let alias = aliases.get_next_resource()?;
            let from = key_of(&alias);
            let to = alias.get_string_by_key(b"replacement")?.try_to_vec()?;
            if !self.ids.contains_key(&from) {
                if let Some(&region) = self.ids.get(&to) {
                    try_map_insert(&mut self.aliases, from, region)?;
                    continue;
                }
                self.add_code(key_of(&alias))?;
            }
            // A space terminates a code, so a trailing space adds no empty code.
            let mut known = to
                .split_inclusive(|&c| c == SPACE)
                .filter_map(|code| self.ids.get(code.strip_suffix(&[SPACE]).unwrap_or(code)));
            let successor = known.next().filter(|_| known.next().is_none()).copied();
            if let Some(region) = self.by_id_mut(&from) {
                region.successor = successor;
            }
        }
        Ok(())
    }

    /// An entry has the code, a number and a code of three letters.
    fn load_code_mapping(&mut self, mapping: &UResourceBundle) -> Result<(), UErrorCode> {
        if mapping.get_type() != URES_ARRAY || mapping.get_size() != 3 {
            return Ok(());
        }
        check_members(mapping)?;
        if let Some(&region) = self.ids.get(&ures_get_unicode_string_by_index(mapping, 0)?) {
            let three_letters = ures_get_unicode_string_by_index(mapping, 2)?;
            try_map_insert(&mut self.aliases, three_letters, region)?;
        }
        Ok(())
    }

    fn add_code(&mut self, code: Vec<u16>) -> Result<(), UErrorCode> {
        if self.ids.contains_key(&code) {
            return Ok(());
        }
        let short = code.iter().copied().filter(|_| code.len() <= 4);
        let region = Region {
            id: Subtag::new(invariant_prefix(short)),
            successor: None,
        };
        try_map_insert(&mut self.ids, code, self.regions.len())?;
        try_push(&mut self.regions, region)
    }

    fn by_id_mut(&mut self, id: &[u16]) -> Option<&mut Region> {
        self.regions.get_mut(*self.ids.get(id)?)
    }
}

#[cold]
fn look_up(code: &[u8]) -> Option<SmallChars> {
    static REGIONS: OnceBox<Result<Regions, UErrorCode>> = OnceBox::new();
    let all = REGIONS.get_or_init_caching_err(Regions::load).ok()?;
    let code = from_invariant(code);
    let index = all.ids.get(&code).or_else(|| all.aliases.get(&code))?;
    let region = all.regions.get(*index)?;
    let current = region
        .successor
        .map_or(Some(region), |it| all.regions.get(it));
    Some(SmallChars::of(&current?.id))
}

/// Resolves an alias or a deprecated code. Without a successor the result is `None`, `code`, or no code of a region.
pub(crate) fn get_region(code: &[u8]) -> Option<SmallChars> {
    if defer_oom(searches_files())? {
        look_up(code)
    } else {
        find_replacement(b"territory", code)
    }
}

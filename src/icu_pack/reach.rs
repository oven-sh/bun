//! What `bun_icu` and its callers can reach in ICU's data.

use crate::resb::{Bundle, Res, split_once};
use bun_icu_format::package::TREES;
use std::collections::{BTreeMap, BTreeSet};

/// The files other than bundles.
pub(crate) const FILES: [&str; 14] = [
    "brkitr/burmesedict.dict",
    "brkitr/char.brk",
    "brkitr/cjdict.dict",
    "brkitr/khmerdict.dict",
    "brkitr/laodict.dict",
    "brkitr/sent.brk",
    "brkitr/sent_el.brk",
    "brkitr/thaidict.dict",
    "brkitr/word.brk",
    "brkitr/word_POSIX.brk",
    "coll/ucadata.icu",
    "nfkc.nrm",
    "uemoji.icu",
    "uts46.nrm",
];

/// ECMA-402's sanctioned units, and the quotients of them that have names of their own.
const UNITS: [(&str, &[&str]); 11] = [
    ("angle", &["degree"]),
    ("area", &["acre", "hectare"]),
    ("concentr", &["percent"]),
    ("consumption", &["liter-per-kilometer", "mile-per-gallon"]),
    (
        "digital",
        &[
            "bit", "byte", "gigabit", "gigabyte", "kilobit", "kilobyte", "megabit", "megabyte",
            "petabyte", "terabit", "terabyte",
        ],
    ),
    (
        "duration",
        &[
            "day",
            "hour",
            "microsecond",
            "millisecond",
            "minute",
            "month",
            "nanosecond",
            "second",
            "week",
            "year",
        ],
    ),
    (
        "length",
        &[
            "centimeter",
            "foot",
            "inch",
            "kilometer",
            "meter",
            "mile",
            "mile-scandinavian",
            "millimeter",
            "yard",
        ],
    ),
    ("mass", &["gram", "kilogram", "ounce", "pound", "stone"]),
    (
        "speed",
        &["kilometer-per-hour", "meter-per-second", "mile-per-hour"],
    ),
    ("temperature", &["celsius", "fahrenheit"]),
    ("volume", &["fluid-ounce", "gallon", "liter", "milliliter"]),
];

pub(crate) fn language_of(name: &str) -> &str {
    split_once(name, b'_').map_or(name, |(language, _)| language)
}

/// Whether `name` is like "de" or "sr_Latn_BA", and not like "root" or "plurals".
pub(crate) fn is_locale(name: &str) -> bool {
    language_of(name).len() <= 3 && name != "res_index"
}

fn has_any(key: &str, letters: &[u8]) -> bool {
    key.bytes().any(|byte| letters.contains(&byte))
}

fn is_plural_form(key: &str) -> bool {
    matches!(key, "zero" | "one" | "two" | "few" | "many" | "other")
}

fn in_calendar(path: &[&str]) -> bool {
    match *path {
        [
            "AmPmMarkers"
            | "AmPmMarkersAbbr"
            | "AmPmMarkersNarrow"
            | "DateTimePatterns"
            | "DateTimePatterns%atTime"
            | "dayNames"
            | "dayOfMonthNames"
            | "intervalFormats"
            | "monthNames"
            | "monthPatterns",
            ..,
        ] => true,
        ["appendItems" | "availableFormats" | "cyclicNameSets" | "dayPeriod"] => true,
        ["appendItems", field] => matches!(
            field,
            "Day"
                | "Day-Of-Week"
                | "Era"
                | "Hour"
                | "Minute"
                | "Month"
                | "Second"
                | "Timezone"
                | "Year"
        ),
        ["availableFormats", skeleton] => !has_any(skeleton, b"QqwWDF"),
        ["cyclicNameSets", set] => matches!(set, "years" | "zodiacs" | "dayParts"),
        ["cyclicNameSets", _, "format"] | ["cyclicNameSets", _, _, "abbreviated"] => true,
        ["dayPeriod", "format", ..] => true,
        ["eras", ..] => !path[path.len() - 1].ends_with("%variant"),
        _ => false,
    }
}

fn in_field(field: &str, path: &[&str]) -> bool {
    let field = split_once(field, b'-').map_or(field, |(field, _width)| field);
    let is_unit = matches!(
        field,
        "year" | "quarter" | "month" | "week" | "day" | "hour" | "minute" | "second"
    );
    match *path {
        [] | ["dn"] => is_unit || matches!(field, "era" | "weekday" | "dayperiod" | "zone"),
        ["relative"] | ["relativeTime", ..] => is_unit,
        ["relative", "0"] => true,
        ["relative", "-2" | "-1" | "1" | "2"] => field != "second",
        _ => false,
    }
}

fn in_numbering_system(path: &[&str]) -> bool {
    match *path {
        [] | ["miscPatterns" | "patterns" | "patternsLong" | "patternsShort" | "symbols"] => true,
        ["miscPatterns", pattern] => pattern == "range",
        ["patterns", pattern] => matches!(
            pattern,
            "accountingFormat" | "currencyFormat" | "decimalFormat" | "percentFormat"
        ),
        [
            "patternsLong" | "patternsShort",
            "currencyFormat" | "decimalFormat",
            ..,
        ] => true,
        ["symbols", symbol] => !matches!(symbol, "list" | "superscriptingExponent"),
        _ => false,
    }
}

fn in_locale(name: &str, path: &[&str]) -> bool {
    match *path {
        ["calendar" | "contextTransforms" | "fields" | "layout" | "NumberElements"] => true,
        ["calendar", _] | ["layout", "characters"] | ["listPattern", ..] => true,
        ["calendar", _, ref rest @ ..] => in_calendar(rest),
        ["contextTransforms", usage] => matches!(
            usage,
            "key" | "keyValue" | "languages" | "script" | "territory" | "variant"
        ),
        ["fields", field, ref rest @ ..] => in_field(field, rest),
        ["NumberElements", system, ref rest @ ..] => {
            system != "minimalPairs" && in_numbering_system(rest)
        }
        ["parse", ..] => name == "root",
        _ => false,
    }
}

/// `cases` are those of the parts of a quotient.
fn in_units(cases: &[String], path: &[&str]) -> bool {
    match *path {
        ["units" | "unitsNarrow" | "unitsShort"] | [_, "compound"] | [_, "compound", "per"] => true,
        [_, category] => UNITS.iter().any(|known| known.0 == category),
        [_, category, unit] => {
            (UNITS.iter()).any(|known| known.0 == category && known.1.contains(&unit))
        }
        [_, _, _, key] if key != "case" => is_plural_form(key) || key == "per",
        ["units", _, _, "case"] => true,
        ["units", _, _, "case", case, ..] => cases.iter().any(|it| it == case),
        _ => false,
    }
}

fn in_zones(path: &[&str]) -> bool {
    match *path {
        ["zoneStrings"] => true,
        [
            _,
            "fallbackFormat" | "gmtFormat" | "hourFormat" | "regionFormat",
        ] => true,
        [_, zone] => has_any(zone, b":"),
        [_, _, name] => matches!(name, "ec" | "lg" | "ls" | "ld" | "sg" | "ss" | "sd"),
        _ => false,
    }
}

fn in_supplemental(name: &str, path: &[&str]) -> bool {
    match (name, path) {
        ("dayPeriods", [table, ..]) => matches!(*table, "locales" | "rules"),
        ("grammaticalFeatures", ["grammaticalData"] | [_, "derivations"] | [_, _, _]) => true,
        ("grammaticalFeatures", [_, _, _, part, ..]) => *part == "component",
        ("icuver", [key]) => *key == "DataVersion",
        ("keyTypeData", [table, ..]) => matches!(
            *table,
            "bcpTypeAlias" | "ianaMap" | "keyMap" | "typeAlias" | "typeMap"
        ),
        ("langInfo", [table, ..]) => *table == "likely",
        ("metaZones", [table, ..]) => {
            matches!(*table, "mapTimezones" | "metazoneInfo" | "primaryZones")
        }
        ("metadata", ["alias"] | [_, _, _] | [_, _, _, "replacement"]) => true,
        ("metadata", [_, kind]) => matches!(
            *kind,
            "language" | "script" | "subdivision" | "territory" | "unit" | "variant"
        ),
        ("supplementalData", ["idValidity", kind, ..]) => *kind == "region",
        ("supplementalData", [table, ..]) => matches!(
            *table,
            "calendarData"
                | "calendarPreferenceData"
                | "cldrVersion"
                | "codeMappings"
                | "idValidity"
                | "territoryContainment"
                | "timeData"
                | "weekData"
        ),
        ("units", ["convertUnits", _, key]) => {
            matches!(*key, "factor" | "offset" | "special" | "target")
        }
        ("units", [table, ..]) => matches!(*table, "convertUnits" | "unitQuantities"),
        ("zoneinfo64", ["Zones", key]) => *key != "links",
        (
            "numberingSystems" | "pluralRanges" | "plurals" | "res_index" | "timezoneTypes"
            | "windowsZones" | "zoneinfo64",
            _,
        ) => true,
        _ => false,
    }
}

/// What the data themselves ask for.
struct Asked<'a> {
    /// Such as "ja" for the numbering system with the rules "ja/SpelloutRules/%spellout-cardinal".
    rule_bundles: BTreeSet<String>,
    /// By language, or "root". ICU4C: number_longnames.cpp, DerivedComponents
    cases: BTreeMap<&'a str, Vec<String>>,
}

impl<'a> Asked<'a> {
    fn new(bundles: &[Bundle<'a>]) -> Self {
        let table = |name: &str, path: &[&str]| {
            let bundle = bundles.iter().find(|it| (it.tree, it.name) == ("", name));
            match bundle.and_then(|it| it.root.at(path)) {
                Some(Res::Table(items)) => items,
                _ => panic!("no table in {name}"),
            }
        };
        let text = |res: &Res| match res {
            Res::String(text) => String::from_utf16_lossy(text),
            _ => panic!("no string"),
        };
        let systems = table("numberingSystems", &["numberingSystems"]).iter();
        let rules = systems.map(|it| text(it.1.get("desc").expect("a description")));
        let derivations = table("grammaticalFeatures", &["grammaticalData", "derivations"]).iter();
        let cases = |rules: &Res| match rules.at(&["component", "case", "per"]) {
            Some(Res::Array(cases)) => cases.iter().map(text).collect(),
            _ => Vec::new(),
        };
        Self {
            rule_bundles: (rules.filter_map(|it| Some(split_once(&it, b'/')?.0.into()))).collect(),
            cases: derivations.map(|it| (it.0, cases(&it.1))).collect(),
        }
    }

    fn cases_of(&self, name: &str) -> &[String] {
        (self.cases.get(language_of(name))).unwrap_or_else(|| &self.cases["root"])
    }
}

/// `path` has the keys of tables, and nothing for arrays.
fn reaches(asked: &Asked, bundle: &Bundle, path: &[&str]) -> bool {
    // Files that `ICU_DATA` names fall back to the root, and can ask it for more than the linked data.
    let is_in_root = bundle.name == "root" && TREES.contains(&bundle.tree.as_bytes());
    if matches!(path, ["%%ALIAS" | "%%Parent"]) || (is_in_root && path.len() > 1) {
        return true;
    }
    match (bundle.tree, path) {
        ("", _) if bundle.no_fallback => in_supplemental(bundle.name, path),
        ("", _) => in_locale(bundle.name, path),
        ("brkitr", ["boundaries", kind]) => matches!(*kind, "grapheme" | "sentence" | "word"),
        ("brkitr", [table, ..]) => matches!(
            *table,
            "boundaries" | "dictionaries" | "exceptions" | "extensions" | "lstm"
        ),
        (
            "coll",
            ["collations"] | ["collations", _] | ["AliasLocales" | "InstalledLocales", ..],
        ) => true,
        ("coll", [_, _, key]) => matches!(*key, "%%CollationBin" | "Sequence"),
        ("curr", ["CurrencyMap", _, key]) => matches!(*key, "id" | "tender"),
        ("curr", [table, ..]) => matches!(
            *table,
            "Currencies"
                | "Currencies%formal"
                | "Currencies%narrow"
                | "CurrencyMap"
                | "CurrencyMeta"
                | "CurrencyPlurals"
                | "CurrencyUnitPatterns"
                | "currencySpacing"
        ),
        ("lang", ["Types" | "Types%short", key, ..]) => *key == "calendar",
        ("lang", ["localeDisplayPattern", key]) => {
            matches!(*key, "pattern" | "separator") || bundle.name == "root"
        }
        ("lang", [table, ..]) => matches!(
            *table,
            "Languages"
                | "Languages%short"
                | "Scripts"
                | "Scripts%short"
                | "Types"
                | "Types%short"
                | "Variants"
                | "localeDisplayPattern"
        ),
        ("rbnf", [table, ..]) => *table == "RBNFRules",
        ("region", [table, ..]) => matches!(*table, "Countries" | "Countries%short"),
        ("unit", _) => in_units(asked.cases_of(bundle.name), path),
        ("zone", _) => in_zones(path),
        _ => false,
    }
}

fn is_opened(asked: &Asked, bundle: &Bundle) -> bool {
    match (bundle.tree, bundle.name) {
        ("" | "coll", "res_index") => true,
        (_, "res_index") | ("", "currencyNumericCodes" | "genderList") => false,
        ("rbnf", name) => {
            let is_on_the_way = |it: &String| it == name || language_of(it) == name;
            name == "root" || asked.rule_bundles.iter().any(is_on_the_way)
        }
        ("translit", _) | ("zone", "tzdbNames") => false,
        _ => true,
    }
}

/// Returns the part of a string that is read.
fn shortened(bundle: &Bundle, path: &[&str], text: &[u16]) -> Vec<u16> {
    match (bundle.tree, bundle.name, path) {
        // What counts is whether there are rules.
        ("coll", _, [.., "Sequence"]) => text[..text.len().min(1)].to_vec(),
        // The first zone is the default.
        ("", "windowsZones", _) => (text
            .iter()
            .copied()
            .take_while(|&unit| unit != u16::from(b' ')))
        .collect(),
        // Samples begin with '@'. A rule cannot be empty.
        ("", "plurals", ["rules", ..]) => {
            let rule = text.iter().take_while(|&&unit| unit != u16::from(b'@'));
            let mut rule: Vec<u16> = rule.copied().collect();
            while rule.pop_if(|last| *last == u16::from(b' ')).is_some() {}
            if rule.is_empty() {
                rule.extend("@integer".encode_utf16());
            }
            rule
        }
        _ => text.to_vec(),
    }
}

/// Otherwise an empty table is the same as none.
fn is_read_without_fallback(bundle: &Bundle, path: &[&str]) -> bool {
    bundle.no_fallback
        || matches!(
            path,
            ["calendar" | "collations"] | ["calendar" | "collations", _]
        )
}

fn reached<'a>(asked: &Asked, bundle: &Bundle, path: &mut Vec<&'a str>, res: &Res<'a>) -> Res<'a> {
    match res {
        Res::String(text) => Res::String(shortened(bundle, path, text)),
        // What counts is whether there is a list.
        Res::Array(_) if *path == ["extensions"] => Res::Array(Vec::new()),
        Res::Array(items) => {
            let items = items.iter().map(|it| reached(asked, bundle, path, it));
            Res::Array(items.collect())
        }
        Res::Table(items) => {
            let mut kept = Vec::new();
            for &(key, ref item) in items {
                path.push(key);
                if reaches(asked, bundle, path) {
                    let item = reached(asked, bundle, path, item);
                    if item != Res::Table(Vec::new()) || is_read_without_fallback(bundle, path) {
                        kept.push((key, item));
                    }
                }
                path.pop();
            }
            Res::Table(kept)
        }
        other => other.clone(),
    }
}

/// The tables that are read only if `ICU_DATA` is set: the bundle that has them, the one that they move to, their keys.
const COLD: [(&str, &str, &[&str]); 2] = [
    (
        "supplementalData",
        "coldRegions",
        &["codeMappings", "idValidity", "territoryContainment"],
    ),
    ("units", "coldUnits", &["convertUnits", "unitQuantities"]),
];

pub(crate) fn is_cold(name: &str) -> bool {
    COLD.iter().any(|cold| cold.1 == name)
}

/// Leaves aliases in the places of the tables.
fn move_cold_tables<'a>(bundles: &mut [Bundle<'a>]) -> [Bundle<'a>; COLD.len()] {
    COLD.map(|(from, name, keys)| {
        let from = bundles
            .iter_mut()
            .find(|it| (it.tree, it.name) == ("", from));
        let Some(Res::Table(tables)) = from.map(|it| &mut it.root) else {
            panic!("no tables for {name}");
        };
        let cold = tables.iter_mut().filter(|it| keys.contains(&it.0));
        let cold = cold.map(|(key, table)| {
            let alias = format!("/ICUDATA/{name}/{key}").encode_utf16().collect();
            (*key, std::mem::replace(table, Res::Alias(alias)))
        });
        Bundle {
            tree: "",
            name,
            no_fallback: true,
            root: Res::Table(cold.collect()),
        }
    })
}

pub(crate) fn reachable(bundles: Vec<Bundle>) -> Vec<Bundle> {
    let asked = Asked::new(&bundles);
    let opened = bundles.into_iter().filter(|it| is_opened(&asked, it));
    let reached = opened.map(|bundle| Bundle {
        root: reached(&asked, &bundle, &mut Vec::new(), &bundle.root),
        ..bundle
    });
    let mut reached: Vec<_> = reached.collect();
    let cold = move_cold_tables(&mut reached);
    reached.extend(cold);
    reached
}

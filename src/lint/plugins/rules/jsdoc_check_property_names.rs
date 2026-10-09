use crate::oxlint::jsdoc::{JSDocFinder, JSDocPluginSettings};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Ensures that property names in JSDoc are not duplicated on the same block and that nested properties have defined roots.
pub struct CheckPropertyNames;

const NO_ROOT: Message = Message::new("", "No root defined for `@property` path.");
const DUPLICATE: Message = Message::new("", "Duplicate @property found.");

impl Rule for CheckPropertyNames {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "check-property-names", Kind::Problem);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        CheckPropertyNames
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|_, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_property_tag_name = settings.resolve_tag_name("property");
                let mut seen: FxHashMap<&[u8], SmallVec<[Span; 1]>> = FxHashMap::default();
                for jsdoc in cx.state.iter_checked(&settings) {
                    // To clear a table takes time in proportion to what it once had.
                    match seen.capacity() > 64 {
                        true => seen = FxHashMap::default(),
                        false => seen.clear(),
                    }
                    for tag in jsdoc.tags().filter(|tag| tag.kind.parsed() == resolved_property_tag_name) {
                        let (_, Some(name_part), _) = tag.type_name_comment() else {
                            continue;
                        };
                        let type_name = name_part.parsed();
                        if let Some(dot_idx) = strings::last_index_of_char(type_name, b'.') {
                            // `foo[].bar` -> `foo[]` -> `foo`
                            let mut parent_name = type_name.get(..dot_idx).unwrap_or_default();
                            while let Some(rest) = parent_name.strip_suffix(b"[]") {
                                parent_name = rest;
                            }
                            if !seen.contains_key(parent_name) {
                                cx.report(name_part.span, NO_ROOT);
                            }
                        }
                        seen.entry(type_name).or_default().push(name_part.span);
                    }
                    for spans in seen.values().filter(|spans| spans.len() > 1) {
                        cx.report(first_in_hash_order(spans).unwrap_or_default(), DUPLICATE);
                    }
                }
            });
        }
        finder
    }
}

/// The first of `spans` in the order of a `FxHashSet<Span>` to which they are added one after the other. oxlint has the places of a
/// report from there.
fn first_in_hash_order(spans: &[Span]) -> Option<Span> {
    let hash = |it: Span| (u64::from(it.start) | (u64::from(it.end) << 32)).wrapping_mul(0xf135_7aea_2e62_a9c5).rotate_left(26);
    let insert = |table: &mut [Option<Span>], it: Span| {
        let (before, after) = table.split_at_mut(hash(it) as usize & table.len().saturating_sub(1));
        if let Some(slot) = after.iter_mut().chain(before).find(|slot| slot.is_none()) {
            *slot = Some(it);
        }
    };
    let mut table: Vec<Option<Span>> = Vec::new();
    for (items, &it) in spans.iter().enumerate() {
        let capacity = match table.len() {
            buckets @ ..8 => buckets.saturating_sub(1),
            buckets => buckets / 8 * 7,
        };
        if items == capacity {
            let buckets = match items + 1 {
                ..4 => 4,
                4..8 => 8,
                wanted => (wanted * 8 / 7).next_power_of_two(),
            };
            let mut grown = vec![None; buckets];
            table.iter().flatten().for_each(|it| insert(&mut grown, *it));
            table = grown;
        }
        insert(&mut table, it);
    }
    table.into_iter().flatten().next()
}

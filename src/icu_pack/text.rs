//! Packs the bundles of locales.

use crate::codes::{Code, push_length, push_number, to_bytes};
use crate::keys::Pools;
use crate::pieces::{self, Level, NUMBERS, NumberCodes, NumberCounts, Texts};
use crate::reach::language_of;
use crate::resb::{Bundle, Res};
use crate::schema::Schema;
use crate::{maps, parallel};
use bun_icu_format::code::code_of;
use bun_icu_format::locales::{Link, Locale};
use bun_icu_format::model::{Map, Model};
use bun_icu_format::package::{PADDING, TREES, keys_of};
use bun_icu_format::record::Record;
use bun_icu_format::schema::{self, Leaf};
use bun_icu_format::text::{self, Levels, operation};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

/// The tree and the chunk in it.
type ChunkId = (usize, usize);

struct Stem<'a> {
    name: &'a str,
    unit: usize,
    /// Itself, unless it is the head of a unit.
    reference: usize,
    link: Option<(&'a str, Vec<u16>)>,
    /// By tree: the hosts that the bundle has, if it exists.
    hosts: Vec<Option<Vec<usize>>>,
    chunks: BTreeMap<ChunkId, Texts>,
}

struct Unit {
    /// In the order of their records.
    stems: Vec<usize>,
    head: usize,
    lead: u16,
}

/// The units that come first, so that they share pages.
const POPULAR: [&str; 32] = [
    "en", "en_001", "es", "de", "fr", "pt", "ja", "zh", "ru", "it", "ko", "zh_Hant", "nl", "pl",
    "tr", "ar", "hi", "id", "vi", "sv", "uk", "cs", "da", "no", "fi", "th", "he", "ro", "hu", "el",
    "fa", "ms",
];

/// Locales, each with those that copy text from it. All others copy from English.
const REFERENCES: [(&str, &str); 27] = [
    ("ak", "vai_Latn"),
    ("az", "tr az_Cyrl kgp lrc ug uz uz_Cyrl"),
    ("bn", "as brx ccp or"),
    ("ceb", "fil so"),
    ("da", "sv no hu fo is kl nn"),
    ("de", "gsw ksh lb nds wae"),
    (
        "es",
        "fr pt ast ca eu gl ia ie kea ku oc qu seh syr vmw yrl",
    ),
    ("fi", "et se smn"),
    ("gd", "ga"),
    (
        "hi",
        "bgc bho doi gu kok kxv_Deva kxv_Orya mai mni mr my ne nqo pa raj sa sd_Deva xnr",
    ),
    ("hsb", "dsb szl"),
    (
        "id",
        "vi he el fa ms bas ckb cy ff_Adlm ha haw jgo jv km mg mi mt mua nmg shn su tg yo",
    ),
    ("ig", "bem nus om sn tn"),
    (
        "it",
        "pl ar ro br dyo fur kkj lij lmo mfe pms rm sc scn sg sq sw to vec",
    ),
    (
        "ki",
        "agq asa bez cgg dav ebu ewo guz jmc kab kam kde kln ksb ksf lag lg ln lu luo luy mas mer mgh nyn rn rof rwk saq sbp shi shi_Latn teo tzm vun xog yav zgh",
    ),
    ("kk", "ba bua cv kk_Arab ky mn sah tk tt"),
    ("nl", "af dua fy nnh"),
    ("ru", "uk be bg ce hy ka os tyv"),
    ("sk", "cs prg"),
    ("sr", "bm bs bs_Cyrl csw eo hr lt lv mgo mk sl sr_Latn yi"),
    ("te", "dz kn kxv_Telu ml si ta"),
    ("th", "lo"),
    ("ti", "am chr gv kw vai"),
    ("ur", "ks ks_Deva mzn pa_Arab ps sd uz_Arab"),
    ("wo", "ff"),
    ("xh", "nd nso rw st tok zu"),
    ("yue", "ja zh ko zh_Hant bo ii yue_Hans za"),
];

pub(crate) struct Text<'a> {
    keys: &'a Pools<'a>,
    schemas: Vec<Schema<'a, 'a>>,
    stems: Vec<Stem<'a>>,
    units: Vec<Unit>,
}

pub(crate) struct Packed {
    pub(crate) locales: Vec<u8>,
    pub(crate) number_codes: Vec<u8>,
    pub(crate) schemas: Vec<Vec<u8>>,
    /// By unit and column.
    pub(crate) cells: Vec<Vec<u8>>,
}

/// A unit as it is written.
struct Written {
    model: Vec<u8>,
    /// By stem and chunk.
    levels: BTreeMap<(usize, ChunkId), Vec<u8>>,
    counts: NumberCounts,
}

fn ascii(text: &[u16]) -> String {
    char::decode_utf16(text.iter().copied())
        .map(|it| it.expect("ASCII"))
        .collect()
}

/// Returns the locale of the same language from which `name` inherits.
fn parent_of<'a>(name: &'a str, links: &BTreeMap<&'a str, Option<String>>) -> Option<&'a str> {
    let chopped = name.trim_end_matches(|it| it != '_').trim_end_matches('_');
    let parent = links[name].as_deref().unwrap_or(chopped);
    let (&parent, _) = links.get_key_value(parent)?;
    (language_of(parent) == language_of(name)).then_some(parent)
}

fn reference_of(head: &str) -> &'static str {
    let has_it = |names: &str| names.split_ascii_whitespace().any(|it| it == head);
    (REFERENCES.iter().find(|it| has_it(it.1))).map_or("en", |it| it.0)
}

impl<'a> Text<'a> {
    pub(crate) fn new(
        bundles: &[&Bundle<'a>],
        keys: &'a Pools<'a>,
        schemas: Vec<Schema<'a, 'a>>,
    ) -> Self {
        let mut by_name: BTreeMap<_, [Option<&Res>; TREES.len()]> = BTreeMap::new();
        for bundle in bundles {
            let tree = TREES.iter().position(|&it| it == bundle.tree.as_bytes());
            by_name.entry(bundle.name).or_default()[tree.expect("a tree")] = Some(&bundle.root);
        }
        let link_of = |root: &Res| {
            ["%%ALIAS", "%%Parent"]
                .into_iter()
                .find_map(|key| match root.get(key) {
                    Some(Res::String(target)) => Some((key, target.clone())),
                    _ => None,
                })
        };
        let links = by_name.iter().map(|(&name, roots)| {
            let links: BTreeSet<_> = roots.iter().flatten().map(|root| link_of(root)).collect();
            assert!(links.len() == 1, "the trees differ in the link of {name}");
            (name, links.into_iter().flatten().next())
        });
        let links: BTreeMap<_, _> = links.collect();
        let parents = links.iter().map(|(&name, link)| {
            let parent = link.as_ref().filter(|link| link.0 == "%%Parent");
            (name, parent.map(|link| ascii(&link.1)))
        });
        let parents: BTreeMap<_, _> = parents.collect();

        // `--trim` keeps "en" and "en_US" when it removes English.
        let head_of = |name: &'a str| match (name, language_of(name)) {
            ("en" | "en_US", _) => "en",
            (_, "en") => "en_001",
            _ => std::iter::successors(Some(name), |it| parent_of(it, &parents))
                .last()
                .expect("the name"),
        };
        let mut heads: Vec<_> = by_name.keys().filter(|&&it| head_of(it) == it).collect();
        heads.sort_by_key(|&head| POPULAR.iter().take_while(|&it| it != head).count());
        let index_of = |name| by_name.keys().position(|&it| it == name).expect("a locale");

        let stems = by_name.iter().map(|(&name, roots)| {
            let mut chunks = BTreeMap::new();
            for (tree, (schema, root)) in schemas.iter().zip(roots).enumerate() {
                for chunk in 0..schema.chunk_count() {
                    let texts = root.and_then(|root| schema.extract(chunk, root));
                    chunks.extend(texts.map(|texts| ((tree, chunk), texts)));
                }
            }
            let hosts = schemas.iter().zip(roots).map(|(schema, root)| {
                let has = |root: &Res, host: usize| root.at(&schema.hosts[host]).is_some();
                root.map(|root| {
                    (1..schema.hosts.len())
                        .filter(|&it| has(root, it))
                        .collect()
                })
            });
            let (head, has_text) = (head_of(name), !chunks.is_empty());
            Stem {
                name,
                unit: heads.iter().position(|&&it| it == head).expect("a unit"),
                reference: index_of(if name == head && has_text {
                    reference_of(name)
                } else {
                    name
                }),
                link: links[name].clone(),
                hosts: hosts.collect(),
                chunks,
            }
        });
        let mut stems: Vec<_> = stems.collect();
        let mut units = Vec::new();
        for (unit, &&head) in heads.iter().enumerate() {
            let mut own: Vec<_> = (0..stems.len())
                .filter(|&it| stems[it].unit == unit)
                .collect();
            own.sort_by_key(|&stem| Reverse(stems[stem].chunks.len()));
            let is_lead = |unit: &u16| unit >> 10 == 0xd800 >> 10;
            let texts = own.iter().flat_map(|&stem| stems[stem].chunks.values());
            let leads = texts.flatten().flatten().flatten().copied().filter(is_lead);
            let leads: Vec<_> = leads.collect::<BTreeSet<_>>().into_iter().collect();
            let lead = if let [only] = leads[..] { only } else { 0 };
            for &stem in own.iter().filter(|_| lead != 0) {
                let texts = stems[stem].chunks.values_mut().flatten().flatten();
                texts.for_each(|text| text.retain(|&unit| unit != lead));
            }
            units.push(Unit {
                stems: own,
                head: index_of(head),
                lead,
            });
        }
        Self {
            keys,
            schemas,
            stems,
            units,
        }
    }

    fn chunks_of<'s>(
        &'s self,
        unit: &'s Unit,
    ) -> impl Iterator<Item = (usize, ChunkId, &'s Texts)> {
        let chunks = |&stem: &usize| {
            self.stems[stem]
                .chunks
                .iter()
                .map(move |it| (stem, *it.0, it.1))
        };
        unit.stems.iter().flat_map(chunks)
    }

    /// Numbers the classes of which units lack the most leaves.
    fn number_classes(&mut self) {
        let mut lacking = BTreeMap::new();
        for unit in &self.units {
            let mut found = BTreeMap::new();
            for (_, (tree, chunk), texts) in self.chunks_of(unit) {
                for (class, text) in self.schemas[tree].classes[chunk].0.iter().zip(texts) {
                    let (leaves, has_any) = found.entry(class).or_insert((0, false));
                    (*leaves, *has_any) = (*leaves + 1, *has_any || text.is_some());
                }
            }
            for (class, (leaves, _)) in found.into_iter().filter(|it| !it.1.1) {
                *lacking.entry(class.clone()).or_insert(0) += leaves;
            }
        }
        let mut lacking: Vec<_> = lacking.into_iter().collect();
        lacking.sort_by_key(|it| Reverse(it.1));
        let numbers = lacking
            .into_iter()
            .map(|it| it.0)
            .zip(1..Leaf::CLASSES as u8);
        let numbers = numbers.collect();
        (self.schemas.iter_mut()).for_each(|it| it.number_classes(&numbers));
    }

    fn chunk(&self, (tree, chunk): ChunkId) -> schema::Chunk<'_> {
        let schema = &self.schemas[tree];
        schema::Schema::new(&schema.bytes).chunk(schema.hosts.len() + chunk)
    }

    fn reference_of(&self, stem: usize) -> Option<usize> {
        Some(self.stems[stem].reference).filter(|&it| it != stem)
    }

    fn map_for<'m>(&self, stem: usize, model: &Model<'m>) -> Map<'m> {
        (self.reference_of(stem)).map_or_default(|_| model.map)
    }

    /// Returns the levels before that of `stem`.
    fn levels_before(
        &self,
        stem: usize,
        chunk: ChunkId,
        written: &BTreeMap<usize, Written>,
        numbers: &text::NumberCodes,
    ) -> Levels<'_> {
        let Some(reference) = self.reference_of(stem) else {
            let mut levels = Levels::new(self.chunk(chunk));
            levels.read_keys(&self.keys.0[&keys_of(chunk.0)].bytes);
            return levels;
        };
        let mut levels = self.levels_before(reference, chunk, written, numbers);
        let unit = &written[&self.stems[reference].unit];
        let model = Model::new(&unit.model);
        if let Some(coded) = unit.levels.get(&(reference, chunk)) {
            let (map, coded) = (
                self.map_for(reference, &model),
                [coded, &[0; 8][..]].concat(),
            );
            (levels.read_level(&model, map, numbers, &coded)).expect("a level");
        }
        levels
    }

    fn write(
        &self,
        unit: &Unit,
        written: &BTreeMap<usize, Written>,
        numbers: &NumberCodes,
        tables: &text::NumberCodes,
    ) -> Written {
        let chunks = self.chunks_of(unit).map(|(stem, chunk, texts)| {
            let levels = self.levels_before(stem, chunk, written, tables);
            (stem, chunk, texts, levels)
        });
        let chunks: Vec<_> = chunks.collect();
        let (mut has, mut pairs) = (1u64, Vec::new());
        for (stem, chunk, texts, levels) in &chunks {
            for (i, (&leaf, text)) in self.chunk(*chunk).leaves().iter().zip(*texts).enumerate() {
                has |= u64::from(text.is_some()) << Leaf::class(leaf);
                let has_pair = self.reference_of(*stem).is_some() && leaf & Leaf::IS_VERBATIM == 0;
                let text = text.as_deref().filter(|_| has_pair);
                pairs.extend(text.map(|text| (&levels.cells()[levels.reference(i).0], text)));
            }
        }
        let mut model = (!has).to_le_bytes().to_vec();
        push_number(&mut model, unit.lead.into());
        model.extend(maps::learn(&pairs));
        let levels = chunks.iter().map(|(stem, chunk, texts, levels)| {
            let map = self.map_for(*stem, &Model::new(&model));
            Level::new(levels, map, self.chunk(*chunk).leaves(), !has, texts)
        });
        let pieces = pieces::write(&levels.collect::<Vec<_>>(), numbers);
        model.extend(pieces.model);
        model.extend([0; PADDING]);
        Written {
            model,
            levels: (chunks.iter().map(|it| (it.0, it.1)).zip(pieces.levels)).collect(),
            counts: pieces.counts,
        }
    }

    /// Writes each unit after the one that it refers to.
    fn write_all(&self, numbers: &NumberCodes) -> BTreeMap<usize, Written> {
        let tables = std::array::from_fn(|i| numbers[i].each_ref().map(|it| code_of(&it.slots, 0)));
        let mut written = BTreeMap::new();
        while written.len() < self.units.len() {
            let is_next = |unit: &usize| {
                let reference = self.reference_of(self.units[*unit].head);
                let is_written = |it: usize| written.contains_key(&self.stems[it].unit);
                !written.contains_key(unit) && reference.is_none_or(is_written)
            };
            let next: Vec<_> = (0..self.units.len()).filter(is_next).collect();
            let write = |&unit: &usize| self.write(&self.units[unit], &written, numbers, &tables);
            let more = parallel::map(&next, write);
            written.extend(next.into_iter().zip(more));
        }
        written
    }

    fn record(&self, stem: usize, tree: usize, unit: &Written) -> Vec<u8> {
        let chunks = self.stems[stem].chunks.range((tree, 0)..(tree + 1, 0));
        let coded = chunks.clone().map(|it| &unit.levels[&(stem, *it.0)][..]);
        let coded: Vec<_> = coded.collect();
        let hosts = self.stems[stem].hosts[tree].iter().flatten().copied();
        let first_chunk = self.schemas[tree].hosts.len();
        let parts: Vec<_> = hosts.chain(chunks.map(|it| first_chunk + it.0.1)).collect();
        let (mut record, mut next) = (Vec::new(), 0);
        if parts.is_empty() {
            return record;
        }
        let runs = parts.chunk_by(|a, b| a + 1 == *b);
        push_length(&mut record, runs.clone().count());
        for run in runs {
            let long = (1 << Record::RUN_BITS) - 1;
            let start = (run[0] - next) << Record::RUN_BITS;
            push_number(&mut record, start | (run.len() - 1).min(long));
            if let Some(rest) = (run.len() - 1).checked_sub(long) {
                push_number(&mut record, rest);
            }
            next = run[0] + run.len();
        }
        let all_but_last = &coded[..coded.len().saturating_sub(1)];
        (all_but_last.iter()).for_each(|it| push_length(&mut record, it.len()));
        record.extend(coded.concat());
        record
    }

    /// Returns the model and the trees.
    fn cells(&self, unit: &Unit, written: &Written) -> Vec<Vec<u8>> {
        let trees = (0..TREES.len()).map(|tree| {
            let record = |&stem: &usize| self.record(stem, tree, written);
            let mut records: Vec<_> = unit.stems.iter().map(record).collect();
            while records.pop_if(|last| last.is_empty()).is_some() {}
            let mut cell = Vec::new();
            if !records.is_empty() {
                push_length(&mut cell, records.len());
                records
                    .iter()
                    .for_each(|it| push_number(&mut cell, it.len()));
                cell.extend(records.concat());
            }
            cell
        });
        let length = if written.levels.is_empty() {
            0
        } else {
            written.model.len() - PADDING
        };
        ([written.model[..length].to_vec()].into_iter().chain(trees)).collect()
    }

    fn locales(&self) -> Vec<u8> {
        let (mut words, mut targets) = (vec![self.stems.len() as u16], Vec::<u16>::new());
        let (first_target, mut offsets) = (1 + Locale::WORDS * self.stems.len(), BTreeMap::new());
        for (index, stem) in self.stems.iter().enumerate() {
            let link = stem.link.as_ref().map_or(0, |(kind, target)| {
                let offset = *offsets.entry(target).or_insert_with(|| {
                    targets.extend(target.iter().chain([&0]));
                    (first_target + targets.len() - 1 - target.len()) as u16
                });
                offset
                    | if *kind == "%%Parent" {
                        Link::IS_PARENT
                    } else {
                        0
                    }
            });
            let record = self.units[stem.unit]
                .stems
                .iter()
                .position(|&it| it == index);
            let trees = stem.hosts.iter().rev();
            let locale = Locale {
                unit: stem.unit,
                reference: stem.reference,
                record: record.filter(|&it| it < 128).expect("seven bits"),
                trees: trees.fold(0, |bits, it| bits << 1 | u8::from(it.is_some())),
                link: Link(link),
            };
            let (name, packed) = (self.keys.of("").offset(stem.name), locale.pack());
            words.extend([name, link, packed as u16, (packed >> 16) as u16]);
        }
        words.extend(targets);
        to_bytes(&words)
    }

    pub(crate) fn pack(mut self) -> Packed {
        self.number_classes();
        let falling: Vec<_> = (0..NUMBERS as u32)
            .map(|it| 0x10000 / (it + 3).pow(2) + 1)
            .collect();
        let mut counts = vec![[falling.clone(), falling]; operation::COUNT];
        let mut passes_left = 2;
        loop {
            let numbers = counts
                .iter()
                .map(|it| it.each_ref().map(|it| Code::new(it)));
            let numbers: NumberCodes = numbers.collect();
            let written = self.write_all(&numbers);
            passes_left -= 1;
            if passes_left > 0 {
                counts.iter_mut().flatten().for_each(|it| it.fill(1));
                for unit in written.values() {
                    let sums = counts.iter_mut().flatten().flatten();
                    let own = unit.counts.iter().flatten().flatten();
                    sums.zip(own).for_each(|(sum, count)| *sum += 8 * count);
                }
                continue;
            }
            let cells =
                (self.units.iter().zip(written.values())).flat_map(|it| self.cells(it.0, it.1));
            let tables = numbers
                .iter()
                .flatten()
                .flat_map(|it| code_of(&it.slots, 0));
            return Packed {
                locales: self.locales(),
                number_codes: tables.flatten().collect(),
                cells: cells.collect(),
                schemas: self.schemas.into_iter().map(|it| it.bytes).collect(),
            };
        }
    }
}

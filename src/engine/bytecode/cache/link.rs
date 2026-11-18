//! Where in the payload each record goes.

use core::ops::Range;
use std::rc::Rc;

use bun_engine_syntax::SourceCache;
use bun_engine_text::{StringRef, Text};
use hashbrown::HashTable;

use super::records::{Root, ScopeNumbers, Target, Unencodable, Writer, Written};
use super::strings::StringTableBuilder;
use super::{CachedLines, FunctionKey, Goal, Key, Loader, Payload};
use crate::bytes::{Sink, size_of_count};
use crate::code::{Code, TooLarge};
use crate::compiler::{Compiler, Instrumentation, Request};
use crate::function::{FunctionInfo, FunctionRef};
use crate::graph::refill;
use crate::host::Host;

/// In the order of the payload.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Region {
    /// Entries that the recorded run loaded, or did not have.
    EarlyEntries,
    /// Functions that it ran, in that order.
    Hot,
    /// Functions that it did not have.
    Unknown,
    LateEntries,
    Cold,
    /// What only errors and tools read.
    Positions,
}

impl Region {
    pub const COUNT: usize = Region::Positions as usize + 1;
}

/// What an earlier run did, in the names that the embedder gives code.
#[derive(Clone, Copy, Default)]
pub struct Hints<'a> {
    pub hot_functions: &'a [u64],
    /// The others that it had. Empty if that is not recorded.
    pub known_functions: &'a [u64],
    pub loaded_entries: &'a [u64],
    pub unloaded_entries: &'a [u64],
}

/// What the embedder calls the code of a text.
#[derive(Clone, Copy)]
pub struct OrderNames<'a> {
    pub entry: Option<u64>,
    pub functions: &'a dyn Fn(FunctionKey) -> Option<u64>,
}

pub struct Linked {
    pub payload: Vec<u8>,
    /// In the order in which they were added.
    pub entries: Vec<u32>,
    pub region_ends: [u32; Region::COUNT],
    /// How many of `Hints::hot_functions` name a function that has code.
    pub named_hot_functions: u32,
    /// In entries that have names at all.
    pub functions_without_name: u32,
}

struct Record {
    region: Region,
    rank: u64,
    bytes: Range<u32>,
    fixups: Range<u32>,
}

impl Record {
    fn is_entry(&self) -> bool {
        matches!(self.region, Region::EarlyEntries | Region::LateEntries)
    }
}

struct Pending {
    record: u32,
    function: FunctionRef,
    /// How many levels of the functions inside get code.
    depth: u32,
}

struct Hot {
    name: u64,
    rank: u32,
    /// The first entry that has it, plus one.
    named_in: u32,
}

#[derive(Default)]
struct Plan {
    hot: HashTable<Hot>,
    known: HashTable<u64>,
    records: Sink<Record>,
    pending: Sink<Pending>,
    functions_without_name: u32,
}

fn set_of(names: impl Iterator<Item = u64>) -> HashTable<u64> {
    let mut set = HashTable::new();
    for name in names {
        set.entry(name, |&it| it == name, |&it| it).or_insert(name);
    }
    set
}

fn has(set: &HashTable<u64>, name: u64) -> bool {
    set.find(name, |&it| it == name).is_some()
}

impl Plan {
    fn add_record(&mut self, region: Region, rank: u64) -> u32 {
        let record = self.records.len() as u32;
        self.records.push(Record {
            region,
            rank,
            bytes: 0..0,
            fixups: 0..0,
        });
        record
    }

    fn place(
        &mut self,
        function: FunctionRef,
        depth: u32,
        around: Region,
        entry: u32,
        names: Option<OrderNames<'_>>,
    ) -> u32 {
        let key = FunctionKey::of(&function);
        let name = key
            .zip(names)
            .and_then(|(key, names)| (names.functions)(key));
        self.functions_without_name +=
            u32::from(name.is_none() && key.is_some() && names.is_some());
        let hot = name.and_then(|name| self.hot.find_mut(name, |it| it.name == name));
        let hot_rank = hot.map(|hot| {
            if hot.named_in == 0 {
                hot.named_in = entry + 1;
            }
            hot.rank
        });
        let in_source =
            u64::from(entry) << 32 | u64::from(key.map_or(function.start, |it| it.start));
        let is_new = !self.known.is_empty() && !name.is_some_and(|name| has(&self.known, name));
        let (region, rank) = match hot_rank {
            // What is inside code that did not run did not run either: its twin did.
            _ if around > Region::Unknown => (Region::Cold, in_source),
            Some(rank) => (Region::Hot, u64::from(rank)),
            // No run can tell of it, and it is small.
            None if key.is_none() && !self.hot.is_empty() => (Region::Hot, u64::MAX),
            None if is_new => (Region::Unknown, in_source),
            None => (Region::Cold, in_source),
        };
        let record = self.add_record(region, rank);
        self.pending.push(Pending {
            record,
            function,
            depth,
        });
        record
    }
}

#[derive(Default)]
pub struct Encoder {
    out: Written,
    plan: Plan,
    late_entries: HashTable<u64>,
    entries: Sink<u32>,
    own_strings: StringTableBuilder,
}

/// Where the code of a text goes.
pub struct Output<'a> {
    pub encoder: &'a mut Encoder,
    /// Without it they go in the payload.
    pub strings: Option<&'a mut StringTableBuilder>,
    pub names: Option<OrderNames<'a>>,
    /// Functions that are nested deeper are left out.
    pub depth: u32,
}

/// What gives code to the functions that have none.
type Generate<'a> = &'a mut dyn FnMut(&FunctionInfo) -> Option<Rc<Code>>;

fn generator<'a>(
    compiler: &'a mut Compiler,
    mut request: Request<'a>,
) -> impl FnMut(&FunctionInfo) -> Option<Rc<Code>> {
    move |function| {
        let specialization = function.likely_specialization();
        (compiler.function(request.reborrow(), function, specialization)).ok()
    }
}

impl Output<'_> {
    pub fn add_program(
        self,
        compiler: &mut Compiler,
        request: Request<'_>,
        goal: Goal,
    ) -> Result<(), Unencodable> {
        // So that neither the width in which the text is stored shows, nor what has been parsed before.
        let text = request.source.text();
        let narrowed = (!text.is_latin1() && text.fits_latin1())
            .then(|| StringRef::try_narrowed(text).map_err(|_| Unencodable))
            .transpose()?;
        let source = narrowed.as_ref().unwrap_or(request.source);
        let mut cache = SourceCache::default();
        let mut request = Request {
            source,
            cache: request.cache.map(|_| &mut cache),
            ..request
        };
        let (script, module);
        let root = if goal == Goal::Script {
            script = compiler.script(request.reborrow(), false, None);
            script.as_ref().map(Root::Script)
        } else {
            module = compiler.module(request.reborrow(), false, None);
            module.as_ref().map(Root::Module)
        };
        let (key, host) = (Key::of_program(source, goal), request.host);
        let generate = &mut generator(compiler, request);
        self.add(root.map_err(|_| Unencodable)?, &key, host, Some(generate))
    }

    /// See [`Key::of_builtin`].
    pub fn add_builtin(
        self,
        compiler: &mut Compiler,
        request: Request<'_>,
        function: &FunctionRef,
        stamp: u32,
    ) -> Result<(), Unencodable> {
        let host = request.host;
        let key = Key::of_builtin(request.source, stamp, host);
        let generate = &mut generator(compiler, request);
        self.add(Root::Builtin(function), &key, host, Some(generate))
    }

    /// Leaves nothing behind but strings if it fails.
    pub(crate) fn add(
        mut self,
        root: Root<'_>,
        key: &Key<'_>,
        host: &dyn Host,
        generate: Option<Generate<'_>>,
    ) -> Result<(), Unencodable> {
        let Encoder { out, plan, .. } = &*self.encoder;
        let sizes = (out.records.len(), out.blobs.len(), out.fixups.len());
        let functions_without_name = plan.functions_without_name;
        let first_record = plan.records.len();
        let result = self.add_records(root, key, host, generate);
        let Encoder {
            out, plan, entries, ..
        } = self.encoder;
        if result.is_ok() {
            entries.push(first_record as u32);
            return result;
        }
        out.records.go_back(sizes.0);
        out.blobs.go_back(sizes.1);
        out.fixups.go_back(sizes.2);
        plan.records.go_back(first_record);
        plan.pending.go_back(0);
        plan.functions_without_name = functions_without_name;
        let named_here = entries.len() as u32 + 1;
        (plan.hot.iter_mut())
            .filter(|hot| hot.named_in == named_here)
            .for_each(|hot| hot.named_in = 0);
        result
    }

    fn add_records(
        &mut self,
        root: Root<'_>,
        key: &Key<'_>,
        host: &dyn Host,
        mut generate: Option<Generate<'_>>,
    ) -> Result<(), Unencodable> {
        let (encoder, names) = (&mut *self.encoder, self.names);
        let (plan, entry) = (&mut encoder.plan, encoder.entries.len() as u32);
        let mut writer = Writer {
            out: &mut encoder.out,
            has_own_strings: self.strings.is_none(),
            strings: (self.strings.as_deref_mut()).unwrap_or(&mut encoder.own_strings),
            source: key.source,
            scopes: ScopeNumbers::default(),
            is_unencodable: false,
        };
        let mut around = match names.and_then(|it| it.entry) {
            Some(name) if has(&encoder.late_entries, name) => Region::LateEntries,
            _ => Region::EarlyEntries,
        };
        let mut record = plan.add_record(around, u64::from(entry));
        let mut depth = (self.depth).saturating_add(matches!(root, Root::Builtin(_)).into());
        let (mut function, generates) = (None::<FunctionRef>, generate.is_some());
        loop {
            let starts = (writer.out.records.len(), writer.out.fixups.len());
            let waiting = plan.pending.len();
            let place = &mut |inner: FunctionRef| {
                let depth = depth.checked_sub(1)?;
                (generates || inner.is_stored())
                    .then(|| plan.place(inner, depth, around, entry, names))
            };
            match &function {
                Some(function) => {
                    let (likely, plain) =
                        (function.likely_specialization(), Instrumentation::empty());
                    let code = (function.load_code(likely, plain, host))
                        .or_else(|| generate.as_mut()?(function));
                    writer.function_code(function, &*code.ok_or(Unencodable)?, place);
                }
                None => writer.entry(root, key, place),
            }
            writer.check()?;
            plan.records.check()?;
            plan.pending.check()?;
            let written = &mut plan.records[record as usize];
            written.bytes = starts.0 as u32..writer.out.records.len() as u32;
            written.fixups = starts.1 as u32..writer.out.fixups.len() as u32;
            // Strings are numbered in the order of the source.
            plan.pending[waiting..].reverse();
            let Some(next) = plan.pending.pop() else {
                return Ok(());
            };
            (record, function, depth) = (next.record, Some(next.function), next.depth);
            around = plan.records[record as usize].region;
        }
    }
}

fn filled(len: usize) -> Result<Vec<u32>, TooLarge> {
    let mut numbers = Vec::new();
    refill(&mut numbers, len, 0)?;
    Ok(numbers)
}

fn hash(bytes: &[u8]) -> u64 {
    Text::Latin1(bytes).fingerprint()
}

fn part<'a, T>(all: &'a [T], range: &Range<u32>) -> &'a [T] {
    &all[range.start as usize..range.end as usize]
}

impl Encoder {
    pub fn new(hints: Hints<'_>) -> Encoder {
        let mut encoder = Encoder::default();
        for (rank, &name) in (0..).zip(hints.hot_functions) {
            let entry = (encoder.plan.hot).entry(name, |it| it.name == name, |it| it.name);
            entry.or_insert(Hot {
                name,
                rank,
                named_in: 0,
            });
        }
        encoder.plan.known = set_of(hints.known_functions.iter().copied());
        let loaded = set_of(hints.loaded_entries.iter().copied());
        let unloaded = hints.unloaded_entries.iter().copied();
        encoder.late_entries = set_of(unloaded.filter(|&name| !has(&loaded, name)));
        encoder
    }

    pub fn finish(mut self) -> Result<Linked, TooLarge> {
        self.entries.check()?;
        let (records, fixups) = (&*self.plan.records, &*self.out.fixups);
        let mut order = filled(records.len())?;
        (0..).zip(&mut order).for_each(|(index, it)| *it = index);
        order.sort_unstable_by_key(|&it| {
            let record = &records[it as usize];
            (record.region, record.rank, it)
        });

        let mut offsets = filled(records.len())?;
        let mut region_ends = [0; Region::COUNT];
        let mut end = 0;
        for &index in &order {
            let record = &records[index as usize];
            offsets[index as usize] = end as u32;
            if !record.is_entry() {
                end += size_of_count(record.bytes.len());
            }
            end += record.bytes.len();
            region_ends[record.region as usize..].fill(end);
        }
        let own_strings_at = end as u32;
        let has_own_strings = (fixups.iter()).any(|it| matches!(it.target, Target::OwnStrings));
        if has_own_strings {
            end += self.own_strings.size();
            region_ends[Region::Cold as usize] = end;
        }

        let mut blobs = Sink::default();
        let mut placed = HashTable::<(u64, Range<u32>)>::new();
        for &index in &order {
            for fixup in part(fixups, &records[index as usize].fixups) {
                let value = match &fixup.target {
                    &Target::Record(record) => offsets[record as usize],
                    Target::OwnStrings => own_strings_at,
                    Target::Blob(range) => {
                        let blob = part(&self.out.blobs, range);
                        let hash = hash(blob);
                        let same = placed.find(hash, |it| part(&blobs, &it.1) == blob);
                        let start = same.map_or(blobs.len() as u32, |it| it.1.start);
                        if same.is_none() {
                            blobs.put(blob);
                            blobs.check()?;
                            placed.try_reserve(1, |it| it.0).map_err(|_| TooLarge)?;
                            let range = start..blobs.len() as u32;
                            placed.insert_unique(hash, (hash, range), |it| it.0);
                        }
                        (end as u32).wrapping_add(start)
                    }
                };
                self.out.records[fixup.at as usize..][..size_of::<u32>()]
                    .copy_from_slice(&value.to_le_bytes());
            }
        }
        region_ends[Region::Positions as usize] = end + blobs.len();

        let mut payload = Sink::with_size(end + blobs.len())?;
        for &index in &order {
            let record = &records[index as usize];
            if !record.is_entry() {
                payload.count(record.bytes.len());
            }
            payload.put(part(&self.out.records, &record.bytes));
        }
        if has_own_strings {
            self.own_strings.write(&mut payload);
        }
        payload.put(&blobs);
        for entry in &mut *self.entries {
            *entry = offsets[*entry as usize];
        }
        let named = self.plan.hot.iter().filter(|hot| hot.named_in != 0);
        Ok(Linked {
            payload: payload.finish()?,
            entries: self.entries.finish()?,
            region_ends: region_ends.map(|end| end as u32),
            named_hot_functions: named.count() as u32,
            functions_without_name: self.plan.functions_without_name,
        })
    }
}

/// Of all that an entry has. The same for the same code, wherever a payload has it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Digest {
    pub hash: u64,
    pub records: u32,
}

impl Digest {
    /// `builtin` has no code yet.
    pub fn of(
        loader: &Rc<Loader>,
        (payload, entry): (&Payload, u32),
        key: &Key<'_>,
        host: &dyn Host,
        builtin: Option<&FunctionRef>,
    ) -> Option<Digest> {
        let (script, module);
        let (root, lines) = match (key.goal, builtin) {
            (_, Some(function)) => {
                let loaded = loader.builtin(payload, entry, key, host, function)?;
                (Root::Builtin(function), loaded.lines)
            }
            (Goal::Script, None) => {
                let loaded = loader.script(payload, entry, key, host, None)?;
                script = loaded.root;
                (Root::Script(&script), loaded.lines)
            }
            _ => {
                let loaded = loader.module(payload, entry, key, host, None, true)?;
                module = loaded.root;
                (Root::Module(&module), loaded.lines)
            }
        };
        let mut encoder = Encoder::default();
        let output = Output {
            encoder: &mut encoder,
            strings: None,
            names: None,
            depth: u32::MAX,
        };
        output.add(root, key, host, None).ok()?;
        let records = encoder.plan.records.len() as u32;
        let lines = lines.as_ref().and_then(CachedLines::bytes);
        let hash = hash(&encoder.finish().ok()?.payload) ^ hash(lines.unwrap_or_default());
        Some(Digest { hash, records })
    }
}

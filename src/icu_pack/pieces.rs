//! Chooses the pieces of text of a unit, and how each string is put together.

use crate::codes::{BIT, BitWriter, Code, Cost, log2, push_number, to_bytes};
use bun_icu_format::model::{Map, entry};
use bun_icu_format::schema::Leaf;
use bun_icu_format::text::operation::{self, *};
use bun_icu_format::text::{Levels, MIN_COPY};
use std::cmp::Reverse;
use std::collections::BTreeMap;

/// The numbers after operations are below this.
pub(crate) const NUMBERS: usize = 256;

pub(crate) type NumberCodes = Vec<[Code; 2]>;
pub(crate) type NumberCounts = Vec<[Vec<u32>; 2]>;

/// By leaf. Switches are a digit.
pub(crate) type Texts = Vec<Option<Vec<u16>>>;

#[derive(Clone, Copy, Default)]
struct Step {
    /// An operation, or `operation::COUNT` and the index of a piece.
    symbol: usize,
    numbers: [Option<u8>; 2],
    /// Bits that are not coded, and their number.
    bits: (u16, u8),
}

impl Step {
    /// Returns `None` if a number is too large.
    fn new(operation: u16, numbers: &[usize]) -> Option<Self> {
        let number = |i: usize| numbers.get(i).map(|&it| u8::try_from(it)).transpose().ok();
        Some(Self {
            symbol: operation.into(),
            numbers: [number(0)?, number(1)?],
            bits: (0, 0),
        })
    }

    fn with_bits(operation: u16, numbers: &[usize], bits: usize, count: u32) -> Option<Self> {
        let bits = (bits as u16, count as u8);
        Self::new(operation, numbers).map(|step| Self { bits, ..step })
    }

    fn cost_after_entry(self, codes: &NumberCodes) -> Cost {
        let numbers =
            (0..2).filter_map(|i| Some(codes[self.symbol][i].cost(self.numbers[i]?.into())));
        numbers.sum::<Cost>() + Cost::from(self.bits.1) * BIT
    }
}

/// What a new string has in common with those that are known.
struct NewString<'a> {
    text: &'a [u16],
    reference: Vec<u16>,
    /// The lengths of the common start and end, from the previous string back.
    in_common: Vec<[usize; 2]>,
    /// By position: the cell where the longest match starts, and its length.
    in_cells: Vec<(usize, usize)>,
    start: usize,
}

enum Task<'a> {
    OneOf(Vec<Step>),
    String(NewString<'a>),
}

/// What it takes to write a level of a chunk.
pub(crate) struct Level<'a> {
    has_only_leaves_of_last: bool,
    tasks: Vec<Task<'a>>,
}

fn common_start(a: &[u16], b: &[u16]) -> usize {
    a.iter().zip(b).take_while(|(a, b)| a == b).count()
}

fn common_end(a: &[u16], b: &[u16]) -> usize {
    (a.iter()
        .rev()
        .zip(b.iter().rev())
        .take_while(|(a, b)| a == b))
    .count()
}

impl<'a> Level<'a> {
    /// `levels` has the levels before.
    pub(crate) fn new(
        levels: &Levels,
        map: Map,
        leaves: &[u8],
        lacks: u64,
        texts: &'a Texts,
    ) -> Self {
        let is_expected = |(i, text): (usize, &Option<_>)| text.is_none() || levels.reference(i).1;
        let has_only_leaves_of_last = texts.iter().enumerate().all(is_expected);
        let (verbatim, mut mapped) = (levels.cells(), levels.cells().to_vec());
        map.apply(&mut mapped);
        let (mut own, mut history) = (vec![0], Vec::<&[u16]>::new());
        let (mut tasks, mut skipped) = (Vec::new(), 0);
        let one_of =
            |steps: &[Option<Step>]| Task::OneOf(steps.iter().copied().flatten().collect());
        for (i, (&leaf, text)) in leaves.iter().zip(texts).enumerate() {
            let (reference, is_of_last) = levels.reference(i);
            if lacks >> Leaf::class(leaf) & 1 != 0 || (has_only_leaves_of_last && !is_of_last) {
                continue;
            }
            let Some(text) = text else {
                skipped += 1;
                continue;
            };
            if skipped > 0 {
                tasks.push(one_of(&[Step::new(SKIP, &[skipped - 1])]));
                skipped = 0;
            }
            assert!(text.len() < NUMBERS && !text.contains(&0u16));
            let before = match leaf & Leaf::IS_VERBATIM {
                0 => &mapped[..],
                _ => verbatim,
            };
            let reference = &before[reference];
            let earlier = history.iter().rev().skip(1).enumerate();
            let earlier = earlier
                .filter(|it| it.1 == text)
                .map(|it| Step::new(EARLIER, &[it.0]));
            let previous = history.last().filter(|it| *it == text);
            let previous = previous.map(|_| Step::new(PREVIOUS, &[]));
            let known: Vec<_> = previous.into_iter().chain(earlier).collect();
            let is_reference = reference == text && !text.is_empty();
            if is_reference {
                tasks.push(one_of(&[Step::new(REFERENCE, &[])]));
            } else if known.is_empty() {
                let cells = [before, &own].concat();
                let longest = |at: usize| {
                    let found = (0..cells.len()).filter(|&cell| cells[cell] == text[at]);
                    let found = found.map(|cell| (cell, common_start(&cells[cell..], &text[at..])));
                    found.max_by_key(|it| it.1).unwrap_or_default()
                };
                let in_common = |it: &&_| [common_start(it, text), common_end(it, text)];
                tasks.push(Task::String(NewString {
                    text,
                    reference: reference.to_vec(),
                    in_common: history.iter().rev().map(in_common).collect(),
                    in_cells: (0..text.len()).map(longest).collect(),
                    start: cells.len() + 1,
                }));
            } else {
                tasks.push(one_of(&known));
            }
            if is_reference || known.is_empty() {
                own.extend([&[0], &text[..], &[0]].concat());
            }
            history.push(text);
        }
        if skipped > 0 {
            tasks.push(one_of(&[Step::new(DONE, &[])]));
        }
        Self {
            has_only_leaves_of_last,
            tasks,
        }
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Piece {
    text: Vec<u16>,
    ends: bool,
}

#[derive(Default)]
struct TrieNode {
    children: BTreeMap<u16, usize>,
    /// The symbols of the piece that goes on and of the one that ends.
    symbols: [Option<usize>; 2],
}

const NEVER: Cost = Cost::MAX / 4;
/// What is given up to save the reader a step.
const TIME_OF_OPERATION: Cost = 3 * BIT;
const TIME_OF_PIECE: Cost = BIT;
const AT_START: usize = 0;
const WITHIN: usize = 1;

struct Vocabulary<'a> {
    numbers: &'a NumberCodes,
    pieces: Vec<Piece>,
    trie: Vec<TrieNode>,
    /// By code and symbol.
    costs: [Vec<Cost>; 2],
}

/// A way to get to a position of a string.
#[derive(Clone, Copy)]
struct Way {
    cost: Cost,
    /// From the position to the one that corresponds to it in the reference.
    to_reference: isize,
    /// The index in `in_common` of what counts as the previous string.
    previous: usize,
    step: Step,
    /// The position and the index of the way before the step.
    before: (usize, usize),
}

impl Vocabulary<'_> {
    fn symbol_of(&mut self, piece: Piece) -> usize {
        let mut node = 0;
        for &unit in &piece.text {
            let new = self.trie.len();
            node = *self.trie[node].children.entry(unit).or_insert(new);
            self.trie.resize_with(new.max(node + 1), TrieNode::default);
        }
        *self.trie[node].symbols[usize::from(piece.ends)].get_or_insert_with(|| {
            self.pieces.push(piece);
            self.costs.iter_mut().for_each(|costs| costs.push(NEVER));
            operation::COUNT + self.pieces.len() - 1
        })
    }

    fn cost(&self, code: usize, step: Step) -> Cost {
        match step.symbol {
            ..operation::COUNT => {
                self.costs[code][step.symbol]
                    + step.cost_after_entry(self.numbers)
                    + TIME_OF_OPERATION
            }
            piece => self.costs[code][piece] + TIME_OF_PIECE,
        }
    }

    /// Calls `go(step, position after it, way)` for each step that can follow `way`. One more than the length is the end.
    fn steps(
        &self,
        string: &NewString,
        at: usize,
        way: Way,
        go: &mut impl FnMut(Option<Step>, usize, Way),
    ) {
        let (rest, reference) = (&string.text[at..], &string.reference[..]);
        let end = string.text.len() + 1;
        let lengths = |longest: usize| MIN_COPY..=longest;
        let Some(&next) = rest.first() else {
            return go(Step::new(END, &[]), end, way);
        };
        go(Step::with_bits(UNIT, &[], next.into(), 16), at + 1, way);
        let mut node = 0;
        for (length, unit) in (1..).zip(rest) {
            let Some(&child) = self.trie[node].children.get(unit) else {
                break;
            };
            node = child;
            let step = |symbol| Step {
                symbol,
                ..Step::default()
            };
            let [goes_on, ends] = self.trie[node].symbols.map(|it| it.map(step));
            go(goes_on, at + length, way);
            go(ends.filter(|_| length == rest.len()), end, way);
        }
        for from in (0..reference.len()).filter(|&from| reference[from] == next) {
            let to_reference = from as isize - at as isize;
            let distance = to_reference - way.to_reference;
            let distance = (distance << 1 ^ distance >> (isize::BITS - 1)) as usize;
            let way = Way {
                to_reference,
                ..way
            };
            for length in lengths(common_start(&reference[from..], rest)) {
                let step = match (at, from) {
                    (0, 0) => Step::new(START_OF_REFERENCE, &[length - MIN_COPY]),
                    _ => Step::new(PART_OF_REFERENCE, &[distance, length - MIN_COPY]),
                };
                go(step, at + length, way);
            }
            if reference[from..] == *rest {
                go(Step::new(REST_OF_REFERENCE, &[distance]), end, way);
            }
        }
        let (cell, longest) = string.in_cells[at];
        for length in lengths(longest).skip(2) {
            let bits = (string.start + at).ilog2() + 1;
            let step = Step::with_bits(CELLS, &[length - MIN_COPY], cell, bits);
            go(step, at + length, way);
        }
        for (i, &[start, common_end]) in string.in_common.iter().enumerate() {
            if lengths(common_end).contains(&rest.len()) {
                let step = match rest.len() - MIN_COPY {
                    length if i == way.previous => Step::new(END_OF_PREVIOUS, &[length]),
                    length => Step::new(END_OF_EARLIER, &[i, length]),
                };
                go(step, end, way);
            }
            for length in lengths(start).filter(|_| at == 0) {
                let step = match i {
                    0 => Step::new(START_OF_PREVIOUS, &[length - MIN_COPY]),
                    _ => Step::new(START_OF_EARLIER, &[i - 1, length - MIN_COPY]),
                };
                go(step, length, Way { previous: i, ..way });
            }
        }
    }

    /// Appends the cheapest steps, each with its code.
    fn parse(&self, string: &NewString, out: &mut Vec<(usize, Step)>) {
        const MAX_WAYS: usize = 6;
        let end = string.text.len() + 1;
        let code_at = |at| if at == 0 { AT_START } else { WITHIN };
        let mut ways = vec![Vec::new(); end + 1];
        ways[0].push(Way {
            cost: 0,
            to_reference: 0,
            previous: 0,
            step: Step::default(),
            before: (0, 0),
        });
        for at in 0..end {
            ways[at].sort_by_key(|way| way.cost);
            ways[at].truncate(MAX_WAYS);
            for index in 0..ways[at].len() {
                self.steps(string, at, ways[at][index], &mut |step, to, way| {
                    let Some(step) = step else {
                        return;
                    };
                    let new = Way {
                        cost: way.cost + self.cost(code_at(at), step),
                        step,
                        before: (at, index),
                        ..way
                    };
                    let state = |it: &Way| (it.to_reference, it.previous);
                    match (ways[to].iter_mut()).find(|it| to == end || state(it) == state(&new)) {
                        Some(known) if known.cost <= new.cost => {}
                        Some(known) => *known = new,
                        None if new.cost < NEVER => ways[to].push(new),
                        None => {}
                    }
                });
            }
        }
        let (first, mut at) = (out.len(), (end, 0));
        while at.0 != 0 {
            let way = ways[at.0][at.1];
            out.push((code_at(way.before.0), way.step));
            at = way.before;
        }
        out[first..].reverse();
    }

    fn parse_level(&self, level: &Level) -> Vec<(usize, Step)> {
        let mut steps = Vec::new();
        for task in &level.tasks {
            match task {
                Task::String(string) => self.parse(string, &mut steps),
                Task::OneOf(all) => {
                    let best = all.iter().min_by_key(|&&step| self.cost(AT_START, step));
                    steps.push((AT_START, *best.expect("a step")));
                }
            }
        }
        steps
    }

    /// About what it takes to have a symbol in a code.
    fn cost_of_entry(&self, symbol: usize) -> Cost {
        let units = symbol.checked_sub(operation::COUNT);
        cost_of_entry(units.map_or(0, |piece| self.pieces[piece].text.len()))
    }

    /// Adds the pairs of a piece and another one, or the end, that pay.
    fn add_pairs(&mut self, parsed: &[Vec<(usize, Step)>], sums: [u32; 2]) {
        let mut pairs = BTreeMap::new();
        for &[(code, first), (next_code, second)] in parsed.iter().flat_map(|it| it.array_windows())
        {
            let is_piece = |step: Step| step.symbol >= operation::COUNT;
            if next_code == WITHIN
                && is_piece(first)
                && (is_piece(second) || second.symbol == END.into())
            {
                *pairs
                    .entry((code, first.symbol, second.symbol))
                    .or_insert(0) += 1;
            }
        }
        let mut found = Vec::new();
        for ((code, first, second), count) in pairs {
            let mut piece = self.pieces[first - operation::COUNT].clone();
            match second.checked_sub(operation::COUNT) {
                Some(second) => {
                    piece.text.extend(&self.pieces[second].text);
                    piece.ends = self.pieces[second].ends;
                }
                None => piece.ends = true,
            }
            let (each, once) = (
                log2(sums[code]) - log2(count),
                cost_of_entry(piece.text.len()),
            );
            let now = self.costs[code][first] + self.costs[WITHIN][second] + TIME_OF_PIECE;
            let gain = (count * now).saturating_sub(count * each + once);
            if count > 2 && gain > 0 && piece.text.len() <= entry::MAX_LENGTH {
                found.push((Reverse(gain), piece, code, each + once / count));
            }
        }
        found.sort();
        found.truncate((found.len() / 2).max(20));
        for (_, piece, code, cost) in found {
            let symbol = self.symbol_of(piece);
            self.costs[code][symbol] = self.costs[code][symbol].min(cost);
        }
    }
}

fn cost_of_entry(units: usize) -> Cost {
    (16 + 6 * units as Cost) * BIT
}

/// Returns a text that contains all of `texts`.
fn overlapped(mut texts: Vec<&[u16]>) -> Vec<u16> {
    texts.sort_by_key(|text| (Reverse(text.len()), *text));
    let mut runs: Vec<Vec<u16>> = Vec::new();
    for text in texts {
        if runs.iter().any(|run| find(run, text).is_some()) {
            continue;
        }
        let joined = (1..text.len()).rev().find_map(|shared| {
            runs.iter().enumerate().find_map(|(i, run)| {
                let (start, end) = (&text[..shared], &text[text.len() - shared..]);
                let after = run
                    .ends_with(start)
                    .then(|| [run, &text[shared..]].concat());
                let before = || {
                    run.starts_with(end)
                        .then(|| [text, &run[shared..]].concat())
                };
                Some((i, after.or_else(before)?))
            })
        });
        match joined {
            Some((i, run)) => runs[i] = run,
            None => runs.push(text.to_vec()),
        }
    }
    runs.concat()
}

fn find(whole: &[u16], part: &[u16]) -> Option<usize> {
    (0..whole.len()).find(|&at| whole[at..].starts_with(part))
}

pub(crate) struct Written {
    /// What the model has after the map.
    pub(crate) model: Vec<u8>,
    pub(crate) levels: Vec<Vec<u8>>,
    pub(crate) counts: NumberCounts,
}

/// The symbols that are used, the most frequent first, and their code.
fn code_for(counts: &[u32]) -> (Vec<usize>, Code) {
    let mut symbols: Vec<_> = (0..counts.len()).filter(|&it| counts[it] > 0).collect();
    symbols.sort_by_key(|&it| Reverse(counts[it]));
    let code = Code::new(&symbols.iter().map(|&it| counts[it]).collect::<Vec<_>>());
    (symbols, code)
}

pub(crate) fn write(levels: &[Level], numbers: &NumberCodes) -> Written {
    const ROUNDS: usize = 12;
    let mut vocabulary = Vocabulary {
        numbers,
        pieces: Vec::new(),
        trie: vec![TrieNode::default()],
        costs: [0, 1].map(|_| vec![5 * BIT; operation::COUNT]),
    };
    for task in levels.iter().flat_map(|level| &level.tasks) {
        if let Task::String(string) = task {
            for &unit in string.text {
                let (text, ends) = (vec![unit], false);
                let symbol = vocabulary.symbol_of(Piece { text, ends });
                (vocabulary.costs.iter_mut()).for_each(|costs| costs[symbol] = 6 * BIT);
            }
        }
    }
    let basic_symbols = operation::COUNT + vocabulary.pieces.len();
    for rounds_left in (0..ROUNDS).rev() {
        let parsed: Vec<_> = levels.iter().map(|it| vocabulary.parse_level(it)).collect();
        let counts = count_symbols(&parsed, &vocabulary);
        let sums = counts.each_ref().map(|it| it.iter().sum::<u32>().max(1));
        for (code, counts) in counts.iter().enumerate() {
            let real = (rounds_left < 3).then(|| code_for(counts));
            for (symbol, &count) in counts.iter().enumerate() {
                let can_return =
                    symbol < operation::COUNT || (symbol < basic_symbols && rounds_left > 4);
                vocabulary.costs[code][symbol] = match count {
                    0 if can_return => log2(sums[code]) + vocabulary.cost_of_entry(symbol),
                    0 => NEVER,
                    _ => log2(sums[code]) - log2(count),
                };
            }
            for (value, &symbol) in real.iter().flat_map(|it| &it.0).enumerate() {
                vocabulary.costs[code][symbol] = real.as_ref().expect("a code").1.cost(value);
            }
        }
        if rounds_left > 2 {
            vocabulary.add_pairs(&parsed, sums);
        }
        for (code, counts) in counts.iter().enumerate().filter(|_| rounds_left > 1) {
            for (symbol, &count) in counts.iter().enumerate().filter(|it| *it.1 > 0) {
                vocabulary.costs[code][symbol] += vocabulary.cost_of_entry(symbol) / count;
            }
        }
    }
    let parsed: Vec<_> = levels.iter().map(|it| vocabulary.parse_level(it)).collect();
    let codes = count_symbols(&parsed, &vocabulary).map(|counts| code_for(&counts));

    let symbols = || codes.iter().flat_map(|it| &it.0);
    let piece = |symbol: &usize| vocabulary.pieces.get(symbol.wrapping_sub(operation::COUNT));
    let text = overlapped(symbols().filter_map(piece).map(|it| &it.text[..]).collect());
    let entries = symbols().map(|symbol| {
        piece(symbol).map_or(entry::FIRST_OPERATION + *symbol as u16, |piece| {
            let offset = symbols().count() + find(&text, &piece.text).expect("the piece");
            assert!(offset < (entry::FIRST_OPERATION >> entry::OFFSET_SHIFT).into());
            let ends = if piece.ends { entry::ENDS } else { 0 };
            (offset as u16) << entry::OFFSET_SHIFT | ends | (piece.text.len() - 1) as u16
        })
    });
    let mut model = Vec::new();
    push_number(&mut model, codes[AT_START].0.len());
    for (_, code) in &codes {
        push_number(&mut model, code.slots.len());
        model.extend(&code.slots);
    }
    model.extend(to_bytes(
        &entries.chain(text.iter().copied()).collect::<Vec<_>>(),
    ));

    let values = codes.each_ref().map(|it| {
        let values =
            it.0.iter()
                .enumerate()
                .map(|(value, &symbol)| (symbol, value));
        values.collect::<BTreeMap<_, _>>()
    });
    let mut counts = vec![[vec![0; NUMBERS], vec![0; NUMBERS]]; operation::COUNT];
    let levels = levels.iter().zip(parsed).map(|(level, steps)| {
        let mut bits = BitWriter::default();
        bits.put(level.has_only_leaves_of_last.into(), 1);
        for (code, step) in steps {
            bits.put_value(&codes[code].1, values[code][&step.symbol]);
            for (i, number) in step.numbers.into_iter().flatten().enumerate() {
                bits.put_value(&numbers[step.symbol][i], number.into());
                counts[step.symbol][i][usize::from(number)] += 1;
            }
            bits.put(step.bits.0.into(), step.bits.1.into());
        }
        bits.bytes
    });
    Written {
        levels: levels.collect(),
        model,
        counts,
    }
}

fn count_symbols(parsed: &[Vec<(usize, Step)>], vocabulary: &Vocabulary) -> [Vec<u32>; 2] {
    let mut counts = [0, 1].map(|_| vec![0; operation::COUNT + vocabulary.pieces.len()]);
    (parsed.iter().flatten()).for_each(|&(code, step)| counts[code][step.symbol] += 1);
    counts
}

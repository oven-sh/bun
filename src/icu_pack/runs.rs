//! Writes maps of code points.

use crate::codes::to_bytes;
use bun_icu_format::runs::{BLOCK_SHIFT, Block, Segment};
use std::collections::BTreeMap;

pub(crate) const BLOCK_LENGTH: usize = 1 << BLOCK_SHIFT;

type Values = [Option<u32>; BLOCK_LENGTH];

/// A block with more runs is expanded faster if it is `Dense`.
const MAX_RUNS: u32 = 39;

#[derive(Clone, Copy, PartialEq)]
enum Form {
    Runs,
    Sparse,
    Dense,
}

fn write_block_as(values: &Values, shift: u32, step: u32, form: Form) -> Vec<u8> {
    let without_steps = |(i, value): (u32, &Option<u32>)| {
        value.map(|value| i64::from(value >> shift) - i64::from(step * i))
    };
    let offsets: Vec<_> = (0..).zip(values).map(without_steps).collect();
    let starts_run = |i: usize| match form {
        Form::Runs => i == 0 || offsets[i] != offsets[i - 1],
        Form::Sparse => offsets[i].is_some(),
        Form::Dense => true,
    };
    let starts: Vec<_> = (0..BLOCK_LENGTH).filter(|&i| starts_run(i)).collect();
    let before_lowest = offsets.iter().flatten().min().map_or(0, |it| it - 1);
    let field = |&i: &usize| match offsets[i] {
        Some(offset) => (offset - before_lowest) as u64,
        None => Block::ABSENT.into(),
    };
    let fields: Vec<_> = starts.iter().map(field).collect();
    let width = fields
        .iter()
        .max()
        .map_or(0, |it| u64::BITS - it.leading_zeros())
        .next_multiple_of(if form == Form::Dense { 8 } else { 1 });
    let low_bits = values
        .iter()
        .flatten()
        .next()
        .map_or(0, |it| it % (1 << shift));
    let base = ((before_lowest as u32) << shift).wrapping_add(low_bits);
    let parameters = (step << Block::SHIFT_BITS | shift) << Block::WIDTH_BITS | width;
    let is_sparse = form == Form::Sparse;
    let parameters = parameters as u16 | if is_sparse { Block::IS_SPARSE } else { 0 };

    let mut block = (starts.iter().map(|&i| 1u64 << i).sum::<u64>())
        .to_le_bytes()
        .to_vec();
    block.extend(base.to_le_bytes());
    block.extend(parameters.to_le_bytes());
    let (mut bits, mut count) = (0u64, 0);
    for field in fields {
        (bits, count) = (bits | field << count, count + width);
        while count >= 8 {
            block.push(bits as u8);
            (bits, count) = (bits >> 8, count - 8);
        }
    }
    block.extend((count > 0).then_some(bits as u8));
    block.resize(block.len().next_multiple_of(2), 0);
    block
}

fn write_block(values: &Values) -> Vec<u8> {
    let first = values.iter().flatten().next().copied().unwrap_or(0);
    let differing = values
        .iter()
        .flatten()
        .fold(0, |bits, it| bits | it ^ first);
    let shifts = 0..=differing.trailing_zeros().min(31);
    let steps = shifts.flat_map(|shift| (0..1 << Block::STEP_BITS).map(move |step| (shift, step)));
    let shortest = |forms: &[Form]| {
        let ways = (steps.clone()).flat_map(|step| forms.iter().map(move |&form| (step, form)));
        let blocks = ways.map(|((shift, step), form)| write_block_as(values, shift, step, form));
        blocks.min_by_key(Vec::len).expect("a way")
    };
    let block = shortest(&[Form::Runs, Form::Sparse]);
    match block[..8].iter().map(|it| it.count_ones()).sum() {
        ..=MAX_RUNS => block,
        _ => shortest(&[Form::Dense]),
    }
}

/// No segment has both BMP and supplementary code points.
pub(crate) fn write(values: &BTreeMap<u32, u32>) -> Vec<u8> {
    const BMP: u32 = 0x10000 >> BLOCK_SHIFT;
    if values.is_empty() {
        return Vec::new();
    }
    let mut blocks: BTreeMap<u32, Values> = BTreeMap::new();
    for (&c, &value) in values {
        let block = blocks.entry(c >> BLOCK_SHIFT).or_insert([None; _]);
        block[c as usize % BLOCK_LENGTH] = Some(value);
    }
    let numbers: Vec<_> = blocks.keys().copied().collect();
    let segments = numbers.chunk_by(|&a, &b| match (a, b) {
        (..BMP, ..BMP) => b - a <= 16,
        (BMP.., _) => b - a <= 256,
        _ => false,
    });
    let segments: Vec<_> = segments.map(|it| it[0]..it[it.len() - 1] + 1).collect();

    let (mut header, mut directory) = (vec![segments.len() as u16], Vec::new());
    let before_directory = 1 + Segment::WORDS * segments.len();
    let words = before_directory + segments.iter().map(|it| it.len()).sum::<usize>();
    let mut written = Vec::new();
    for segment in segments {
        let base = (words + written.len() / 2 - 1) / Segment::BASE_WORDS;
        let at = before_directory + directory.len();
        header.extend([segment.start as usize, segment.len(), at, base].map(|it| it as u16));
        let mut offsets = BTreeMap::new();
        directory.extend(segment.map(|number| {
            blocks.get(&number).map_or(0, |values| {
                *offsets
                    .entry(write_block(values))
                    .or_insert_with_key(|block| {
                        let offset = words + written.len() / 2 - Segment::BASE_WORDS * base;
                        written.extend(block);
                        u16::try_from(offset).expect("16 bits")
                    })
            })
        }));
    }
    written.extend([0; Block::PADDING]);
    [to_bytes(&header), to_bytes(&directory), written].concat()
}

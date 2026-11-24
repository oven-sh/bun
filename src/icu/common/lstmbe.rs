//! Engines for Thai and Burmese that take the place of the dictionary if the data have a model. ICU4C: lstmbe.cpp

use crate::common::brkiter::BreakIterator;
use crate::common::bytes::I32s;
use crate::common::charstr::SmallChars;
use crate::common::cstring::{find_last_byte, until_nul};
use crate::common::locid::Locale;
use crate::common::maps::Map;
use crate::common::memory::{Appendable as _, try_box, try_filled, try_map_insert};
use crate::common::rbbi::UBRK_DONE;
use crate::common::slice_ext::{SliceExt as _, to_index};
use crate::common::uinvchar::invariant_chars;
use crate::common::uresimp::{U_ICUDATA_BRKITR, ures_open, ures_open_direct};
use crate::common::utypes::{
    U_BUFFER_OVERFLOW_ERROR, U_ILLEGAL_ARGUMENT_ERROR, U_INVALID_FORMAT_ERROR, UErrorCode,
};
use std::ops::Range;

// ICU4C: lstmbe.cpp, LSTMClass
const BEGIN: usize = 0;
const SINGLE: usize = 3;

const MIN_WORD_SPAN: usize = 4;
const MAX_CLUSTER_LENGTH: usize = 10;

/// Rows of `d2` floats.
struct Matrix {
    data: I32s<'static>,
    d2: usize,
}

impl Matrix {
    fn row(&self, i: usize) -> impl Iterator<Item = f32> + use<> {
        self.data
            .slice(i * self.d2..(i + 1) * self.d2)
            .iter()
            .map(|bits| f32::from_bits(bits as u32))
    }
}

struct Weights {
    w: Matrix,
    u: Matrix,
    b: Matrix,
}

pub(crate) struct LSTMBreakEngine {
    /// Maps each token of the model, as UTF-16 bytes in the data, to its row of `embedding`.
    dict: Map<&'static [u8], usize>,
    /// Whether a token is a grapheme cluster or a code point.
    embeds_clusters: bool,
    hunits: usize,
    embedding: Matrix,
    forward: Weights,
    backward: Weights,
    output_w: Matrix,
    output_b: Matrix,
}

fn assign(dest: &mut [f32], values: impl Iterator<Item = f32>) {
    dest.iter_mut()
        .zip(values)
        .for_each(|(slot, value)| *slot = value);
}

/// Adds `a` times `b` to `sums`. The order of the terms of a sum matters: rounding can decide a boundary.
fn add_dot_product(sums: &mut [f32], a: impl Iterator<Item = f32>, b: &Matrix) {
    for (j, a_j) in a.enumerate() {
        sums.iter_mut()
            .zip(b.row(j))
            .for_each(|(sum, b_ji)| *sum += a_j * b_ji);
    }
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// Computes one step of an LSTM with a forget gate. `ifco` is scratch space.
fn compute(
    weights: &Weights,
    x: impl Iterator<Item = f32>,
    h: &mut [f32],
    c: &mut [f32],
    ifco: &mut [f32],
) {
    assign(ifco, weights.b.row(0));
    add_dot_product(ifco, x, &weights.w);
    add_dot_product(ifco, h.iter().copied(), &weights.u);
    let hunits = h.len();
    for (unit, (h, c)) in h.iter_mut().zip(c).enumerate() {
        let gate = |number: usize| ifco.at(number * hunits + unit);
        *c = *c * sigmoid(gate(1)) + sigmoid(gate(0)) * gate(2).tanh();
        *h = c.tanh() * sigmoid(gate(3));
    }
}

/// Returns the index of the first maximum.
fn max_index(numbers: [f32; 4]) -> usize {
    (1..4).fold(0, |max, i| {
        if numbers.at(i) > numbers.at(max) {
            i
        } else {
            max
        }
    })
}

/// Calls `add` with each cluster. ICU4C: lstmbe.cpp, GraphemeClusterVectorizer::vectorize
fn grapheme_clusters(
    text: &[u16],
    range: Range<usize>,
    add: &mut dyn FnMut(Range<usize>),
) -> Result<(), UErrorCode> {
    let mut iter = BreakIterator::create_character_rules(&Locale::get_default())?;
    iter.set_finds_clusters();
    if range.start != 0 {
        iter.preceding(text, range.start as i32);
    }
    let mut last = range.start;
    while last < range.end {
        let current = match iter.next(text) {
            UBRK_DONE => range.end,
            current => range.end.min(to_index(current)),
        };
        if current <= range.start {
            continue;
        }
        if current - last > MAX_CLUSTER_LENGTH {
            return Err(U_BUFFER_OVERFLOW_ERROR);
        }
        add(last..current);
        last = current;
    }
    Ok(())
}

impl LSTMBreakEngine {
    // ICU4C: lstmbe.cpp, CreateLSTMDataForScript, LSTMData::LSTMData
    #[cold]
    pub(crate) fn new(script_name: &[u8]) -> Result<Box<Self>, UErrorCode> {
        let root = ures_open(Some(U_ICUDATA_BRKITR), b"")?;
        let file = (root.get_by_key_with_fallback(b"lstm")?).get_string_by_key(script_name)?;
        let file: SmallChars = invariant_chars(file.iter())?;
        // Without a '.' the name is empty.
        let name = file.slice(..find_last_byte(&file, b'.').unwrap_or(0));
        let model = ures_open_direct(Some(U_ICUDATA_BRKITR), until_nul(name))?;

        let embedding_size = model.get_by_key(b"embeddings")?.get_int()?;
        let hunits = model.get_by_key(b"hunits")?.get_int()?;
        let embedding_type = model.get_string_by_key(b"type")?.until_nul();
        model.get_string_by_key(b"model")?;
        let mut data = model.get_by_key(b"data")?.get_int_vector()?;
        let strings = model.get_by_key_with_fallback(b"dict")?;
        let strings = strings.get_value().get_array()?;
        let mut dict = Map::default();
        for (index, value) in strings.iter().enumerate() {
            let token = value.get_string()?.until_nul();
            try_map_insert(&mut dict, token.as_bytes(), index)?;
        }

        let embeds_clusters = embedding_type.eq_bytes(b"graphclust");
        // No overflow: resource integers have 28 bits.
        let (rows, e, h) = (
            strings.get_size() + 1,
            i64::from(embedding_size),
            i64::from(hunits),
        );
        if !embeds_clusters && !embedding_type.eq_bytes(b"codepoints")
            || e < 0
            || h < 0
            || (data.len() as i64) < rows as i64 * e + 8 * h * (e + h + 2) + 4
        {
            return Err(U_INVALID_FORMAT_ERROR);
        }

        let (embedding_size, hunits) = (to_index(embedding_size), to_index(hunits));
        let mut matrix = |d1: usize, d2: usize| {
            let matrix = Matrix {
                data: data.slice(0..d1 * d2),
                d2,
            };
            data = data.slice(d1 * d2..);
            matrix
        };
        let embedding = matrix(rows, embedding_size);
        let mut weights = || Weights {
            w: matrix(embedding_size, 4 * hunits),
            u: matrix(hunits, 4 * hunits),
            b: matrix(1, 4 * hunits),
        };
        let (forward, backward) = (weights(), weights());
        let (output_w, output_b) = (matrix(2 * hunits, 4), matrix(1, 4));
        try_box(Self {
            dict,
            embeds_clusters,
            hunits,
            embedding,
            forward,
            backward,
            output_w,
            output_b,
        })
    }

    /// Returns the last index of `token` in the data, or the number of distinct tokens if `token` is unknown.
    fn string_to_index(&self, token: &[u16]) -> usize {
        let mut bytes = [[0; 2]; MAX_CLUSTER_LENGTH];
        bytes
            .iter_mut()
            .zip(token)
            .for_each(|(bytes, unit)| *bytes = unit.to_ne_bytes());
        self.dict
            .get(bytes.slice(..token.len()).as_flattened())
            .copied()
            .unwrap_or(self.dict.len())
    }

    /// Appends the boundaries inside `range`, which has BMP characters only. ICU4C: lstmbe.cpp, LSTMBreakEngine::divideUpDictionaryRange
    #[inline(never)]
    pub(crate) fn divide_up(
        &self,
        text: &[u16],
        range: Range<usize>,
        found_breaks: &mut Vec<i32>,
        finds_clusters: bool,
    ) -> Result<(), UErrorCode> {
        if range.len() > i32::MAX as usize / 4 {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        if range.len() <= MIN_WORD_SPAN || self.embeds_clusters && finds_clusters {
            return Ok(());
        }
        // The start and the embedding row of each token.
        let mut tokens = Vec::new();
        let mut add = |token: Range<usize>| {
            tokens.add((token.start as i32, self.string_to_index(text.slice(token))));
        };
        if self.embeds_clusters {
            grapheme_clusters(text, range, &mut add)?;
        } else {
            range.for_each(|i| add(i..i + 1));
        }

        let hunits = self.hunits;
        let mut scratch = try_filled(0.0, (tokens.len() + 6).saturating_mul(hunits))?;
        let (ifco, rest) = scratch.split_soft_mut(4 * hunits);
        let (c, rest) = rest.split_soft_mut(hunits);
        let (h, h_backward) = rest.split_soft_mut(hunits);

        for (i, &(_, index)) in tokens.iter().enumerate().rev() {
            compute(&self.backward, self.embedding.row(index), h, c, ifco);
            h_backward.copy_at(i * hunits, h);
        }

        h.fill(0.0);
        c.fill(0.0);
        for (i, &(offset, index)) in tokens.iter().enumerate() {
            compute(&self.forward, self.embedding.row(index), h, c, ifco);
            let mut logp = [0.0; 4];
            assign(&mut logp, self.output_b.row(0));
            let hidden = h
                .iter()
                .chain(h_backward.slice(i * hunits..(i + 1) * hunits));
            add_dot_product(&mut logp, hidden.copied(), &self.output_w);
            if matches!(max_index(logp), BEGIN | SINGLE) && i != 0 {
                found_breaks.add(offset);
            }
        }
        Ok(())
    }
}

//! A histogram as bytes, in the format of Node.js: a CBOR (RFC 8949) map with integer keys.
//! - https://github.com/nodejs/node/blob/v26.12.1/doc/api/perf_hooks.md#histogramexport

use crate::{EMPTY_MIN, Ewma, Histogram};

mod major {
    pub(super) const UINT: u8 = 0;
    pub(super) const ARRAY: u8 = 4;
    pub(super) const MAP: u8 = 5;
}
const FLOAT64: u8 = 0xfb;

/// Unknown keys are refused in version 1 and skipped in version 2.
const STRICT_VERSION: u64 = 1;
const VERSION: u64 = 2;

mod key {
    pub(super) const VERSION: u64 = 0;
    pub(super) const LOWEST: u64 = 1;
    pub(super) const HIGHEST: u64 = 2;
    pub(super) const FIGURES: u64 = 3;
    pub(super) const TOTAL_COUNT: u64 = 4;
    pub(super) const MIN: u64 = 5;
    pub(super) const MAX: u64 = 6;
    pub(super) const NORMALIZING_INDEX_OFFSET: u64 = 7;
    pub(super) const CONVERSION_RATIO: u64 = 8;
    pub(super) const COUNTS_LEN: u64 = 9;
    pub(super) const COUNTS: u64 = 10;
    pub(super) const EWMA: u64 = 11;
}

mod ewma_key {
    pub(super) const ALPHA: u64 = 0;
    pub(super) const MEAN: u64 = 1;
    pub(super) const VARIANCE: u64 = 2;
    pub(super) const ERROR_RATE: u64 = 3;
    pub(super) const THRESHOLD: u64 = 4;
}

struct Writer(Vec<u8>);

impl Writer {
    fn head(&mut self, major: u8, argument: u64) {
        let major = major << 5;
        let bytes = argument.to_be_bytes();
        let [.., b4, b5, b6, b7] = bytes;
        match argument {
            0..=23 => self.0.push(major | b7),
            24..=0xff => self.0.extend([major | 24, b7]),
            0x100..=0xffff => self.0.extend([major | 25, b6, b7]),
            0x1_0000..=0xffff_ffff => self.0.extend([major | 26, b4, b5, b6, b7]),
            _ => {
                self.0.push(major | 27);
                self.0.extend(bytes);
            }
        }
    }

    fn uint(&mut self, key: u64, value: u64) {
        self.head(major::UINT, key);
        self.head(major::UINT, value);
    }

    fn float(&mut self, key: u64, value: f64) {
        self.head(major::UINT, key);
        self.0.push(FLOAT64);
        self.0.extend(value.to_be_bytes());
    }
}

/// `None` from any method means that the bytes are not what is expected.
struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn take<const N: usize>(&mut self) -> Option<[u8; N]> {
        let (taken, rest) = self.0.split_first_chunk()?;
        self.0 = rest;
        Some(*taken)
    }

    fn skip(&mut self, len: u64) -> Option<()> {
        self.0 = self.0.get(usize::try_from(len).ok()?..)?;
        Some(())
    }

    /// The major type and the argument of the next item. No item has an indefinite length.
    fn head(&mut self) -> Option<(u8, u64)> {
        let [first] = self.take()?;
        let argument = match first & 0x1f {
            info @ 0..=23 => u64::from(info),
            24 => u64::from(u8::from_be_bytes(self.take()?)),
            25 => u64::from(u16::from_be_bytes(self.take()?)),
            26 => u64::from(u32::from_be_bytes(self.take()?)),
            27 => u64::from_be_bytes(self.take()?),
            _ => return None,
        };
        Some((first >> 5, argument))
    }

    fn argument_of(&mut self, major: u8) -> Option<u64> {
        let (found, argument) = self.head()?;
        (found == major).then_some(argument)
    }

    /// An unsigned integer of at most `max`.
    fn uint(&mut self, max: u64) -> Option<u64> {
        self.argument_of(major::UINT).filter(|&value| value <= max)
    }

    /// How many items an array has, or how many pairs a map. Each takes at least a byte.
    fn len_of(&mut self, major: u8) -> Option<u64> {
        self.argument_of(major)
            .filter(|&len| len <= self.0.len() as u64)
    }

    /// An unsigned integer or a float64.
    fn number(&mut self) -> Option<f64> {
        if self.0.first() == Some(&FLOAT64) {
            self.skip(1)?;
            return Some(f64::from_be_bytes(self.take()?));
        }
        Some(self.argument_of(major::UINT)? as f64)
    }

    /// Skips an item with everything in it, which is nested at most 16 deep.
    fn skip_item(&mut self, depth: u32) -> Option<()> {
        if depth > 16 {
            return None;
        }
        let (major, argument) = self.head()?;
        match major {
            // An integer, and a simple value or a float: `head` has read its bytes as the argument.
            0 | 1 | 7 => Some(()),
            // A string.
            2 | 3 => self.skip(argument),
            4 | 5 => {
                if argument > self.0.len() as u64 {
                    return None;
                }
                let items = if major == 4 { argument } else { argument * 2 };
                (0..items).try_for_each(|_| self.skip_item(depth + 1))
            }
            // A tag.
            _ => self.skip_item(depth + 1),
        }
    }
}

/// Whether `key`, which is below 64, is not in `seen` yet. It is afterwards.
fn first_time(seen: &mut u64, key: u64) -> bool {
    let bit = 1 << key;
    let first = *seen & bit == 0;
    *seen |= bit;
    first
}

impl Histogram {
    /// Everything but [`Self::exceeds`] and [`Self::reset_count`].
    ///
    /// Node.js: the minimum and the maximum are the values as they were recorded. Here they are the edges of their slots,
    /// which is what both report after an import.
    pub fn export(&self) -> Vec<u8> {
        let has_ewma = self.ewma.alpha > 0.0;
        let offset = self.normalizing_index_offset;
        // The first slot is that of 0, which HdrHistogram does not take for a minimum.
        let min = self.counts().find(|&(index, _)| index != 0);

        let mut out = Writer(Vec::new());
        out.head(major::MAP, if has_ewma { 12 } else { 11 });
        out.uint(key::VERSION, VERSION);
        out.uint(key::LOWEST, self.lowest_discernible_value);
        out.uint(key::HIGHEST, self.highest_trackable_value);
        out.uint(key::FIGURES, u64::from(self.significant_figures));
        out.uint(key::TOTAL_COUNT, self.count);
        out.uint(
            key::MIN,
            min.map_or(EMPTY_MIN, |(index, _)| self.slot(index).lowest),
        );
        out.uint(key::MAX, self.max());
        out.uint(key::NORMALIZING_INDEX_OFFSET, offset as u64);
        out.float(key::CONVERSION_RATIO, self.conversion_ratio);
        out.uint(key::COUNTS_LEN, self.slot_count() as u64);
        out.head(major::UINT, key::COUNTS);
        out.head(major::ARRAY, self.counts().count() as u64 * 2);
        let mut previous = 0;
        let not_wrapped = self.counts().filter(|&(index, _)| index >= offset);
        let wrapped = self.counts().filter(|&(index, _)| index < offset);
        let wrapped = wrapped.map(|(index, n)| (index + self.slot_count(), n));
        for (index, n) in not_wrapped.chain(wrapped) {
            let index = index - offset;
            out.uint((index - previous) as u64, n);
            previous = index;
        }
        if has_ewma {
            out.head(major::UINT, key::EWMA);
            out.head(major::MAP, 5);
            out.float(ewma_key::ALPHA, self.ewma.alpha);
            out.float(ewma_key::MEAN, self.ewma.mean);
            out.float(ewma_key::VARIANCE, self.ewma.variance);
            out.float(ewma_key::ERROR_RATE, self.ewma.error_rate);
            out.uint(ewma_key::THRESHOLD, self.ewma.threshold);
        }
        out.0
    }

    /// `None` unless `bytes` start with what [`Self::export`] or Node.js writes.
    ///
    /// Node.js: the minimum and the maximum are whatever the bytes say. Here they are those of the counts.
    pub fn import(bytes: &[u8]) -> Option<Self> {
        const MAX_I64: u64 = i64::MAX as u64;
        const MAX_I32: u64 = i32::MAX as u64;
        let mut reader = Reader(bytes);
        let mut version = STRICT_VERSION;
        let (mut lowest, mut highest, mut figures) = (1, MAX_I64, 3);
        let mut total_count = None;
        let mut counts_len = 0;
        let mut offset = 0;
        let mut conversion_ratio = 1.0;
        let mut counts = Vec::new();
        let mut ewma = Ewma::default();
        let (mut seen, mut seen_of_ewma) = (0, 0);
        let mut unknown_keys = false;

        // This length is not limited by that of the bytes, as a failed read ends the loop.
        for _ in 0..reader.argument_of(major::MAP)? {
            let key = reader.argument_of(major::UINT)?;
            if key > key::EWMA {
                reader.skip_item(0)?;
                unknown_keys = true;
                continue;
            }
            if !first_time(&mut seen, key) {
                return None;
            }
            match key {
                key::VERSION => {
                    version = reader
                        .uint(VERSION)
                        .filter(|&version| version >= STRICT_VERSION)?;
                }
                key::LOWEST => lowest = reader.uint(MAX_I64)?,
                key::HIGHEST => highest = reader.uint(MAX_I64)?,
                key::FIGURES => figures = reader.uint(MAX_I32)?,
                key::TOTAL_COUNT => total_count = Some(reader.uint(MAX_I64)?),
                key::MIN | key::MAX => _ = reader.uint(MAX_I64)?,
                key::NORMALIZING_INDEX_OFFSET => offset = reader.uint(MAX_I32)?,
                key::CONVERSION_RATIO => conversion_ratio = reader.number()?,
                key::COUNTS_LEN => counts_len = reader.uint(MAX_I32)?,
                key::COUNTS => {
                    let len = reader.len_of(major::ARRAY)?;
                    if len % 2 != 0 {
                        return None;
                    }
                    counts.reserve_exact(len as usize / 2);
                    let mut index = 0;
                    for pair in 0..len / 2 {
                        let delta = reader.uint(MAX_I32)?;
                        let n = reader.uint(MAX_I64)?;
                        // Only the first one, which is the index itself, can be 0.
                        if pair > 0 && delta == 0 {
                            return None;
                        }
                        index += delta;
                        counts.push((index, n));
                    }
                }
                _ => {
                    for _ in 0..reader.argument_of(major::MAP)? {
                        let key = reader.argument_of(major::UINT)?;
                        if key > ewma_key::THRESHOLD {
                            reader.skip_item(0)?;
                            unknown_keys = true;
                            continue;
                        }
                        if !first_time(&mut seen_of_ewma, key) {
                            return None;
                        }
                        match key {
                            ewma_key::ALPHA => ewma.alpha = reader.number()?,
                            ewma_key::MEAN => ewma.mean = reader.number()?,
                            ewma_key::VARIANCE => ewma.variance = reader.number()?,
                            ewma_key::ERROR_RATE => ewma.error_rate = reader.number()?,
                            _ => ewma.threshold = reader.uint(MAX_I64)?,
                        }
                    }
                }
            }
        }
        if version == STRICT_VERSION && unknown_keys {
            return None;
        }

        let mut histogram = Self::new(lowest, highest, u32::try_from(figures).ok()?)?;
        if histogram.slot_count() as u64 != counts_len || offset >= counts_len {
            return None;
        }
        for (index, n) in counts {
            histogram.count = histogram
                .count
                .checked_add(n)
                .filter(|&count| count <= MAX_I64)?;
            if index >= counts_len {
                return None;
            }
            if n > 0 && !histogram.add_at(((index + offset) % counts_len) as usize, n) {
                return None;
            }
        }
        histogram.normalizing_index_offset = offset as usize;
        histogram.conversion_ratio = conversion_ratio;
        if total_count.is_some_and(|total_count| total_count != histogram.count) {
            return None;
        }
        histogram.ewma = if ewma.alpha > 0.0 {
            Ewma {
                // Node.js: what it is for the half-life that this one stands for, which is not always the same and
                // which there is none of for 1.
                alpha: if ewma.alpha <= 1.0 { ewma.alpha } else { 0.0 },
                // The bytes do not say. `subtract` can leave averages and no values.
                // Node.js: always, so the first value after an empty histogram is averaged with 0.
                initialized: histogram.count > 0
                    || ewma.mean != 0.0
                    || ewma.variance != 0.0
                    || ewma.error_rate != 0.0,
                ..ewma
            }
        } else {
            Ewma {
                threshold: ewma.threshold,
                ..Ewma::default()
            }
        };
        Some(histogram)
    }
}

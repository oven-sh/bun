//! What stands in for the kernels. It keeps to the same contracts, but takes the first match and makes simpler codes.

use super::*;
use core::slice::{from_raw_parts, from_raw_parts_mut};

pub(super) unsafe fn highway_deflate_parse(
    batch: &RawBatch,
    _scratch: *mut MaybeUninit<u8>,
    tokens: *mut MaybeUninit<Token>,
    parsed: &mut Parsed,
) {
    let ([first, hashed], [mut at, stop]) = (batch.hashed, batch.parsed);
    // SAFETY: `parse()` has checked these lengths.
    let (bytes, tokens) = unsafe {
        (
            from_raw_parts(batch.bytes, batch.end as usize + BACK),
            from_raw_parts_mut(tokens, max_tokens((batch.end - at) as usize)),
        )
    };
    let mut distances = [u16::from(batch.finder == 1); MAX_BATCH + MAX_OVERRUN];
    for table in batch.tables[..batch.table_count.into()].iter().rev() {
        // SAFETY: the mask is the last index.
        let entries = unsafe { from_raw_parts_mut(table.entries, table.mask as usize + 1) };
        for (at, found) in (first..hashed).zip(&mut distances) {
            let gram = &bytes[at as usize..][..table.gram_len as usize];
            let hash =
                (gram.iter()).fold(0, |hash: u32, &it| hash.wrapping_mul(61) ^ u32::from(it));
            if batch.finder == 3 && hash % 3 != 0 {
                continue;
            }
            let stamp = batch.stamp.wrapping_add(at);
            let entry = &mut entries[(hash & table.mask) as usize];
            let distance = stamp.wrapping_sub(core::mem::replace(entry, stamp));
            if distance <= batch.max_distance
                && distance <= at - batch.oldest
                && bytes[(at - distance) as usize..].starts_with(gram)
            {
                *found = distance as u16;
            }
        }
    }

    let min_len = u32::from(batch.costs.distances[0] / LITERAL_COST) + 1;
    let mut has_one_literal = false;
    while at < stop {
        let distance = u32::from(distances[(at - first) as usize]);
        let is_equal = |&at: &u32| bytes[at as usize] == bytes[(at - distance) as usize];
        let len = (at..batch.end).take(258).take_while(is_equal).count() as u32;
        let byte = u32::from(bytes[at as usize]);
        let token = if (1..=at - batch.oldest).contains(&distance) && len >= min_len {
            (at, has_one_literal) = (at + len, false);
            parsed.candidates += 2;
            if len == 258 && at >= stop && !batch.ends_input {
                parsed.run_distance = distance;
            }
            Token::for_match(len, distance)
        } else {
            parsed.tokens -= u32::from(has_one_literal);
            (at, has_one_literal) = (at + 1, !has_one_literal);
            match has_one_literal {
                true => Token(byte | 511 << 23),
                false => Token(u32::from(bytes[at as usize - 2]) | byte << 23),
            }
        };
        tokens[parsed.tokens as usize].write(token);
        parsed.tokens += 1;
    }
    parsed.position = at;
}

pub(super) unsafe fn highway_deflate_end_of_run(
    bytes: *const u8,
    at: usize,
    end: usize,
    distance: usize,
) -> usize {
    // SAFETY: `end_of_run()` has checked the length.
    let bytes = unsafe { from_raw_parts(bytes, end) };
    (at..end)
        .find(|&at| bytes[at] != bytes[at - distance])
        .unwrap_or(end)
}

/// The symbol and the number of extra bits.
fn first_symbol(index: u32) -> (u32, u32) {
    let extra_bits = ((index % 256) | 4).ilog2() - 2;
    match index {
        ..256 => (index, 0),
        511 => (285, 0),
        _ => (
            257 + 4 * extra_bits + ((index % 256) >> extra_bits),
            extra_bits,
        ),
    }
}

pub(super) unsafe fn highway_deflate_count(
    tokens: *const Token,
    count: usize,
    frequencies: &mut Frequencies,
) {
    frequencies.fill(0);
    // SAFETY: the caller passes a slice.
    for &Token(token) in unsafe { from_raw_parts(tokens, count) } {
        frequencies[first_symbol(token % 512).0 as usize] += 1;
        match token as usize >> 23 {
            511 => {}
            second => frequencies[second + second / 256 * 32] += 1,
        }
    }
    frequencies.swap(288, 289);
}

fn make_code(frequencies: &[u16], max_len: usize, code: &mut Code) -> u32 {
    let mut missing = 2usize.saturating_sub(frequencies.iter().filter(|&&it| it != 0).count());
    let mut used = 0;
    for (symbol, &frequency) in (0..).zip(frequencies) {
        if frequency != 0 || missing != 0 {
            missing -= usize::from(frequency == 0);
            (code.symbols[used], code.lens[used]) = (symbol, max_len as u16);
            used += 1;
        }
    }
    let frequency = |at: usize| u32::from(frequencies[usize::from(code.symbols[at])]);
    // Shortens what gains most for the room it takes.
    let mut left = (1 << max_len) - used;
    for least in (0..31).rev().map(|it| 1 << it >> 1) {
        for at in (0..1 + max_len * usize::from(least == 0)).flat_map(|_| 0..used) {
            let (len, more) = (code.lens[at], 1 << (max_len - usize::from(code.lens[at])));
            if len > 1 && more <= left && frequency(at) << len >= least {
                (code.lens[at], left) = (len - 1, left - more);
            }
        }
    }
    let mut word = 0u16;
    for len in 1..15 {
        for at in (0..used).filter(|&at| code.lens[at] == len) {
            code.words[at] = u32::from(word.reverse_bits()) << 16 | u32::from(len);
            word += 1;
        }
        word <<= 1;
    }
    code.used = used as u32;
    (0..used)
        .map(|at| frequency(at) * u32::from(code.lens[at]))
        .sum()
}

/// 0 if there is none.
fn word(code: &Code, symbol: u32) -> u32 {
    let at = code.symbols[..code.used as usize].binary_search(&(symbol as u16));
    at.map_or(0, |at| code.words[at])
}

/// Passes symbols of the precode, their extra bits, and how many these are.
fn tell(code: &Code, mut put: impl FnMut(u32, u32, u32)) {
    let mut next = 0;
    for (&symbol, &len) in code.symbols[..code.used as usize].iter().zip(&code.lens) {
        while next < symbol {
            let zeros = (symbol - next).min(138);
            match u32::from(zeros) {
                zeros @ 11.. => put(18, zeros - 11, 7),
                zeros @ 3.. => put(17, zeros - 3, 3),
                zeros => (0..zeros).for_each(|_| put(0, 0, 0)),
            }
            next += zeros;
        }
        put(len.into(), 0, 0);
        next += 1;
    }
}

pub(super) fn highway_deflate_make_codes(frequencies: &Frequencies, dynamic: &mut Dynamic) -> u32 {
    let [litlen, offset, precode] = &mut dynamic.codes;
    let mut bits = 14 + 3 * 19 + make_code(&frequencies[..288], 14, litlen);
    bits += make_code(&frequencies[288..], 14, offset);
    let mut told = [0; 19];
    for code in [litlen, offset] {
        tell(code, |symbol, _, extra_bits| {
            told[symbol as usize] += 1;
            bits += extra_bits;
        });
    }
    bits + make_code(&told, 7, precode)
}

pub(super) unsafe fn highway_deflate_start_block(
    dynamic: &mut Dynamic,
    codes: &mut Codes,
    bits: &mut Bits,
) -> usize {
    let [litlen, offset, precode] = &dynamic.codes;
    let with_room =
        |word: u32, extra_bits: u32| (word >> extra_bits & !31) + word % 32 + extra_bits;
    for (code, at) in codes.first.iter_mut().zip(0..) {
        let (symbol, extra_bits) = first_symbol(at);
        *code = with_room(word(litlen, symbol), extra_bits) | at.unbounded_shl(32 - extra_bits);
    }
    codes.second[..256].copy_from_slice(&codes.first[..256]);
    for (code, symbol) in codes.second[256..].iter_mut().zip(0..30) {
        *code = with_room(word(offset, symbol), (symbol / 2).max(1) - 1);
    }
    codes.second.swap(256, 257);
    codes.end_of_block = word(litlen, 256);

    let mut written = 0;
    let mut put = |value: u32, count: u32| {
        bits.value |= u64::from(value) << bits.count;
        bits.count += count as usize;
        dynamic.header[written..][..8].copy_from_slice(&bits.value.to_le_bytes());
        written += bits.count / 8;
        (bits.value, bits.count) = (bits.value >> (bits.count & !7), bits.count % 8);
    };
    let last = |code: &Code| u32::from(code.symbols[code.used as usize - 1] % 32);
    put(last(litlen) | last(offset) << 5 | 15 << 10, 14);
    for symbol in [
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
    ] {
        put(word(precode, symbol) % 32, 3);
    }
    for code in [litlen, offset] {
        tell(code, |symbol, extra, extra_bits| {
            let word = word(precode, symbol);
            put(word >> (32 - word % 32), word % 32);
            put(extra, extra_bits);
        });
    }
    written
}

pub(super) fn highway_deflate_sum(frequencies: &Frequencies, sums: &mut [Sums; 3]) {
    for (sums, range) in sums.iter_mut().zip([0..256, 256..288, 288..320]) {
        for frequency in frequencies[range].iter().map(|&it| u32::from(it)) {
            sums.symbols += frequency;
            sums.different += u32::from(frequency != 0);
            sums.times_log += frequency * log2(frequency);
        }
    }
}

pub(super) unsafe fn highway_deflate_write(
    tokens: *const Token,
    count: usize,
    codes: &Codes,
    out: *mut MaybeUninit<u8>,
    room: usize,
    bits: &mut Bits,
) -> usize {
    // SAFETY: the caller passes two slices.
    let (tokens, out) = unsafe { (from_raw_parts(tokens, count), from_raw_parts_mut(out, room)) };
    let mut written = 0;
    let pairs = tokens.iter().map(|&Token(token)| {
        let second = codes.second[token as usize >> 23];
        [
            codes.first[token as usize % 512],
            second | token >> 10 << 19,
        ]
    });
    for pair in pairs.chain([[codes.end_of_block, 0]]) {
        let Some(word) = out.get_mut(written..written + 8) else {
            return usize::MAX;
        };
        for code in pair {
            bits.value |= u64::from(code) >> (32 - code % 32) << bits.count;
            bits.count += code as usize % 32;
        }
        word.write_copy_of_slice(&bits.value.to_le_bytes());
        written += bits.count / 8;
        (bits.value, bits.count) = (bits.value >> (bits.count & !7), bits.count % 8);
    }
    written
}

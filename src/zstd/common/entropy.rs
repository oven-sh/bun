//! `entropy_common.c`: the headers of FSE and Huffman tables.

use super::fse_decompress::{Spread, fse_decompress_weights};
use super::{FSE_MIN_TABLELOG, FSE_TABLELOG_ABSOLUTE_MAX, HUF_TABLELOG_MAX};
use crate::error::{Error, Result};
use crate::util::{BUG, SliceExt, highbit32, read_le32};

/// What [`read_ncount`] found besides the counts.
pub(crate) struct NCount {
    /// How many bytes of the input the header takes.
    pub(crate) size: usize,
    pub(crate) max_symbol_value: u32,
    pub(crate) table_log: u32,
}

/// `FSE_readNCount`: `normalized_counter` has room for the symbols up to `max_symbol_value`.
pub(crate) fn read_ncount(
    normalized_counter: &mut [i16],
    max_symbol_value: u32,
    header: &[u8],
) -> Result<NCount> {
    match read_valid_ncount(normalized_counter, max_symbol_value, header) {
        Some(ncount) => Ok(ncount),
        None => read_any_ncount(normalized_counter, max_symbol_value, header),
    }
}

/// The same for a header that has nothing wrong with it and is not at the very end of `header`.
fn read_valid_ncount(
    normalized_counter: &mut [i16],
    max_symbol_value: u32,
    header: &[u8],
) -> Option<NCount> {
    /// The bits from `position` on, from the lowest on: `MIN_LOADED` of them or more, then zeroes.
    #[inline(always)]
    fn load(header: &[u8], position: usize) -> Option<u64> {
        let bytes = header.get(position / 8..position / 8 + 8)?;
        Some(u64::from_le_bytes(bytes.try_into().ok()?) >> (position % 8))
    }
    const MIN_LOADED: u32 = 57;
    /// After how many bits more are loaded. The 17 that are left are enough for a count.
    const MAX_USED: u32 = 40;

    // As few as there usually are, and as many as can be cleared without a call.
    let counts = normalized_counter.first_chunk_mut::<64>()?;
    *counts = [0; 64];
    let counts = counts.get_mut(..(max_symbol_value as usize + 1).min(64))?;
    // `bits` is what comes `used` bits after `position`.
    let mut position = 0usize;
    let mut bits = load(header, 0)?;
    let table_log = (bits & 0xF) as u32 + FSE_MIN_TABLELOG;
    if table_log > FSE_TABLELOG_ABSOLUTE_MAX {
        return None;
    }
    bits >>= 4;
    let mut used = 4;
    let mut remaining = (1i32 << table_log) + 1;
    let mut threshold = 1i32 << table_log;
    let mut nb_bits = table_log + 1;
    let mut symbol = 0usize;

    loop {
        if used > MAX_USED {
            position += used as usize;
            used = 0;
            bits = load(header, position)?;
        }

        // With `max` for `2 * threshold - 1 - remaining`: a value below `max` is stored with a bit less, and one from
        // `threshold + max` on stands for `max` less. Written so that little has to wait for `remaining`.
        let low = bits as i32 & (threshold - 1);
        let all = bits as i32 & (2 * threshold - 1);
        let count_bits = nb_bits - u32::from(low + remaining < 2 * threshold - 1);
        bits >>= count_bits;
        used += count_bits;
        // The stored value is the count plus one, and a count of -1 takes one slot.
        let count;
        if all + remaining >= 3 * threshold - 1 {
            count = all + remaining - 2 * threshold;
            remaining = 2 * threshold - all;
        } else {
            count = low - 1;
            remaining -= count.abs();
        }
        *counts.get_mut(symbol)? = count as i16;
        symbol += 1;
        if remaining < threshold {
            if remaining <= 1 {
                break;
            }
            nb_bits = remaining.ilog2() + 1;
            threshold = 1 << (nb_bits - 1);
        }

        if count == 0 {
            // Each pair of set bits stands for three more symbols of count 0.
            let mut repeats = (!bits).trailing_zeros() / 2;
            if 2 * repeats + 2 > MIN_LOADED - used {
                position += used as usize;
                used = 0;
                bits = load(header, position)?;
                repeats = (!bits).trailing_zeros() / 2;
                if 3 * repeats as usize > counts.len() {
                    return None;
                }
            }
            symbol += 3 * repeats as usize + (bits >> (2 * repeats) & 3) as usize;
            bits >>= 2 * repeats + 2;
            used += 2 * repeats + 2;
        }
    }
    if remaining != 1 {
        return None;
    }
    Some(NCount {
        size: (position + used as usize).div_ceil(8),
        max_symbol_value: symbol as u32 - 1,
        table_log,
    })
}

/// The same as the C code does it.
fn read_any_ncount(
    normalized_counter: &mut [i16],
    max_symbol_value: u32,
    header: &[u8],
) -> Result<NCount> {
    if header.len() < 8 {
        let mut buffer = [0u8; 8];
        buffer.write_at(0, header)?;
        let ncount = read_any_ncount(normalized_counter, max_symbol_value, &buffer)?;
        if ncount.size > header.len() {
            return Err(Error::CorruptionDetected);
        }
        return Ok(ncount);
    }

    let iend = header.len() as isize;
    let mut ip: isize = 0;
    let load = |ip: isize, bit_count: i32| -> Result<u32> {
        Ok(read_le32(header, ip as usize)? >> (bit_count & 31))
    };
    let max_sv1 = max_symbol_value + 1;
    let mut charnum: u32 = 0;
    let mut previous0 = false;

    normalized_counter.sub_mut(..max_sv1 as usize)?.fill(0);
    let mut bit_stream = read_le32(header, 0)?;
    let mut nb_bits = ((bit_stream & 0xF) + FSE_MIN_TABLELOG) as i32;
    if nb_bits > FSE_TABLELOG_ABSOLUTE_MAX as i32 {
        return Err(Error::TableLogTooLarge);
    }
    bit_stream >>= 4;
    let mut bit_count: i32 = 4;
    let table_log = nb_bits as u32;
    let mut remaining: i32 = (1 << nb_bits) + 1;
    let mut threshold: i32 = 1 << nb_bits;
    nb_bits += 1;

    loop {
        if previous0 {
            // Each pair of set bits stands for three more symbols of count 0.
            let mut repeats = ((!bit_stream | 0x8000_0000).trailing_zeros() >> 1) as i32;
            while repeats >= 12 {
                charnum += 3 * 12;
                if ip <= iend - 7 {
                    ip += 3;
                } else {
                    bit_count -= (8 * (iend - 7 - ip)) as i32;
                    bit_count &= 31;
                    ip = iend - 4;
                }
                bit_stream = load(ip, bit_count)?;
                repeats = ((!bit_stream | 0x8000_0000).trailing_zeros() >> 1) as i32;
            }
            charnum += 3 * repeats as u32;
            bit_stream >>= 2 * repeats;
            bit_count += 2 * repeats;

            charnum += bit_stream & 3;
            bit_count += 2;

            if charnum >= max_sv1 {
                break;
            }

            if ip <= iend - 7 || ip + (bit_count >> 3) as isize <= iend - 4 {
                ip += (bit_count >> 3) as isize;
                bit_count &= 7;
            } else {
                bit_count -= (8 * (iend - 4 - ip)) as i32;
                bit_count &= 31;
                ip = iend - 4;
            }
            bit_stream = load(ip, bit_count)?;
        }
        {
            let max = (2 * threshold - 1) - remaining;
            let mut count: i32;

            if (bit_stream & (threshold - 1) as u32) < max as u32 {
                count = (bit_stream & (threshold - 1) as u32) as i32;
                bit_count += nb_bits - 1;
            } else {
                count = (bit_stream & (2 * threshold - 1) as u32) as i32;
                if count >= threshold {
                    count -= max;
                }
                bit_count += nb_bits;
            }

            // The stored value is the count plus one, and a count of -1 takes one slot.
            count -= 1;
            if count >= 0 {
                remaining -= count;
            } else {
                remaining += count;
            }
            normalized_counter.put(charnum as usize, count as i16)?;
            charnum += 1;
            previous0 = count == 0;

            if remaining < threshold {
                if remaining <= 1 {
                    break;
                }
                nb_bits = highbit32(remaining as u32) as i32 + 1;
                threshold = 1 << (nb_bits - 1);
            }
            if charnum >= max_sv1 {
                break;
            }

            if ip <= iend - 7 || ip + (bit_count >> 3) as isize <= iend - 4 {
                ip += (bit_count >> 3) as isize;
                bit_count &= 7;
            } else {
                bit_count -= (8 * (iend - 4 - ip)) as i32;
                bit_count &= 31;
                ip = iend - 4;
            }
            bit_stream = load(ip, bit_count)?;
        }
    }
    if remaining != 1 {
        return Err(Error::CorruptionDetected);
    }
    if charnum > max_sv1 {
        return Err(Error::MaxSymbolValueTooSmall);
    }
    if bit_count > 32 {
        return Err(Error::CorruptionDetected);
    }
    ip += ((bit_count + 7) >> 3) as isize;
    Ok(NCount {
        size: ip as usize,
        max_symbol_value: charnum - 1,
        table_log,
    })
}

/// What [`huf_read_stats`] found besides the weights and how many symbols have each.
pub(crate) struct HufStats {
    /// How many bytes of the input the header takes.
    pub(crate) size: usize,
    pub(crate) nb_symbols: u32,
    pub(crate) table_log: u32,
}

/// `weights`, which are fewer than 4, then zeroes.
fn pad(weights: &[u8]) -> [u8; 4] {
    let mut padded = [0; 4];
    for (to, &weight) in padded.iter_mut().zip(weights) {
        *to = weight;
    }
    padded
}

/// `HUF_readStats`
pub(crate) fn huf_read_stats(
    huff_weight: &mut [u8; 256],
    rank_stats: &mut [u32; HUF_TABLELOG_MAX as usize + 1],
    src: &[u8],
) -> Result<HufStats> {
    huf_read_stats_wksp(huff_weight, rank_stats, src, &mut Spread::new())
}

/// `HUF_readStats_wksp`
pub(crate) fn huf_read_stats_wksp(
    huff_weight: &mut [u8; 256],
    rank_stats: &mut [u32; HUF_TABLELOG_MAX as usize + 1],
    src: &[u8],
    spread: &mut Spread,
) -> Result<HufStats> {
    let Some((&first, rest)) = src.split_first() else {
        return Err(Error::SrcSizeWrong);
    };
    let mut i_size = usize::from(first);
    let o_size;

    if i_size >= 128 {
        // Not compressed: two weights to a byte.
        o_size = i_size - 127;
        i_size = o_size.div_ceil(2);
        if i_size + 1 > src.len() {
            return Err(Error::SrcSizeWrong);
        }
        if o_size >= huff_weight.len() {
            return Err(Error::CorruptionDetected);
        }
        let (pairs, _) = huff_weight.as_chunks_mut::<2>();
        for (pair, &byte) in pairs.iter_mut().zip(rest.sub(..i_size)?) {
            *pair = [byte >> 4, byte & 15];
        }
    } else {
        if i_size + 1 > src.len() {
            return Err(Error::SrcSizeWrong);
        }
        o_size = fse_decompress_weights(huff_weight.sub_mut(..255)?, rest.sub(..i_size)?, spread)?;
    }

    // Four counts of each weight: one that is incremented again and again has to be waited for.
    let mut counts = [[0u32; 16]; 4];
    let mut all_bits = 0;
    let (fours, others) = huff_weight.sub(..o_size)?.as_chunks::<4>();
    for weights in fours.iter().chain(&[pad(others)]) {
        all_bits |= u32::from_le_bytes(*weights);
        for (&weight, counts) in weights.iter().zip(&mut counts) {
            if let Some(count) = counts.get_mut(usize::from(weight) % 16) {
                *count += 1;
            }
        }
    }
    let [counts0, counts1, counts2, counts3] = &counts;
    let mut ranks = [0u32; 16];
    for (weight, rank) in ranks.iter_mut().enumerate() {
        *rank =
            counts0.at(weight)? + counts1.at(weight)? + counts2.at(weight)? + counts3.at(weight)?;
    }
    let Some((valid, too_large)) = ranks.split_first_chunk() else {
        return Err(BUG);
    };
    if all_bits & 0xF0F0_F0F0 != 0 || too_large.iter().any(|&rank| rank != 0) {
        return Err(Error::CorruptionDetected);
    }
    *rank_stats = *valid;
    // Those that complete the last four.
    if let Some(rank) = rank_stats.first_mut() {
        *rank -= (4 - others.len()) as u32;
    }
    let weight_total = (rank_stats.iter().enumerate().skip(1))
        .map(|(weight, &rank)| rank << (weight - 1))
        .sum::<u32>();
    if weight_total == 0 {
        return Err(Error::CorruptionDetected);
    }

    // The last symbol's weight is not stored: it completes the total to a power of 2.
    let table_log = highbit32(weight_total) + 1;
    if table_log > HUF_TABLELOG_MAX {
        return Err(Error::CorruptionDetected);
    }
    let total = 1u32 << table_log;
    let rest = total - weight_total;
    let verif = 1u32 << highbit32(rest);
    let last_weight = highbit32(rest) + 1;
    if verif != rest {
        return Err(Error::CorruptionDetected);
    }
    huff_weight.put(o_size, last_weight as u8)?;
    *rank_stats.at_mut(last_weight as usize)? += 1;

    let [_, rank1, ..] = *rank_stats;
    if rank1 < 2 || rank1 & 1 != 0 {
        return Err(Error::CorruptionDetected);
    }

    Ok(HufStats {
        size: i_size + 1,
        nb_symbols: o_size as u32 + 1,
        table_log,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::fse::write_ncount;

    #[test]
    fn the_quick_way_reads_what_the_careful_way_reads() -> Result<()> {
        let mut state = 1u64;
        let mut random = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let nb_headers = if cfg!(miri) { 300 } else { 100_000 };
        let mut nb_quick = 0;
        for index in 0..nb_headers {
            let max_symbol_value = [35, 52, 31, 255, 7].at(index % 5)?;
            let mut header = [0u8; 48];
            for byte in &mut header {
                *byte = random() as u8;
            }
            if index % 2 == 0 {
                header[0] = header[0] & 0xF0 | (random() % 8) as u8;
            } else {
                // A few symbols, far from each other.
                let table_log = 5 + random() as u32 % 5;
                let mut counts = [0i16; 64];
                let mut left = 1i16 << table_log;
                while left > 0 {
                    let count = 1 + (random() % left as u64) as i16;
                    *counts.at_mut(random() as usize % (max_symbol_value.min(63) + 1))? += count;
                    left -= count;
                }
                let last = counts.iter().rposition(|&count| count != 0).unwrap_or(0);
                write_ncount(&mut header, &counts, last as u32, table_log)?;
            }
            let max_symbol_value = max_symbol_value as u32;
            let (mut quick, mut careful) = ([1i16; 256], [1i16; 256]);
            let Some(read) = read_valid_ncount(&mut quick, max_symbol_value, &header) else {
                continue;
            };
            nb_quick += 1;
            let expected = read_any_ncount(&mut careful, max_symbol_value, &header)?;
            assert_eq!(
                (read.size, read.max_symbol_value, read.table_log),
                (expected.size, expected.max_symbol_value, expected.table_log)
            );
            let nb_symbols = read.max_symbol_value as usize + 1;
            assert_eq!(quick.sub(..nb_symbols)?, careful.sub(..nb_symbols)?);
        }
        assert!(nb_quick > nb_headers / 4);
        Ok(())
    }
}

#![allow(clippy::indexing_slicing, clippy::unwrap_used)]

mod made_up;

use super::*;
use crate::StreamingDecoder;
use bun_sema_standalone as _;
use made_up::{Random, made_up};

const CASES: u64 = if cfg!(miri) { 3 } else { 400 };

fn decoder(dictionary: &[u8]) -> Box<Decoder> {
    Box::new(Decoder::with_dictionary(dictionary).unwrap())
}

/// The output is left out after an error, since how much there is depends on the pieces.
fn in_pieces(decoder: &mut Decoder, input: &[u8], len: usize) -> Result<Vec<u8>, DecodeError> {
    let mut out = Vec::new();
    for mut piece in input.chunks(len) {
        loop {
            out.reserve(5000);
            let status = append_with(&mut out, 5000, |out| decoder.decompress(&mut piece, out))?;
            if status != DecodeStatus::NeedsOutput && !decoder.has_more_output() {
                break;
            }
        }
    }
    Ok(out)
}

/// With a length that makes it complete, if there is one nearby.
fn completed(seed: u64, dictionary: &[u8]) -> Vec<u8> {
    let open = made_up(seed, None);
    let len = in_pieces(&mut decoder(dictionary), &open, usize::MAX).map_or(0, |out| out.len());
    (len.saturating_sub(if cfg!(miri) { 1 } else { 150 })..len)
        .map(|len| made_up(seed, Some(len)))
        .find(|it| (decoder(dictionary).decompress_whole(it, &mut Vec::new(), len)).is_some())
        .unwrap_or(open)
}

#[test]
fn fast_loops_agree_with_the_careful_one() {
    let (mut decoded, mut finished) = (0, 0);
    for seed in 0..CASES {
        let dictionary = made_up(seed + 1, None);
        let dictionary = &dictionary[..dictionary.len() * usize::from(seed % 4 == 0)];
        let input = completed(seed, dictionary);
        let expected = in_pieces(&mut decoder(dictionary), &input, 1);
        decoded += expected.as_ref().map_or(0, Vec::len);
        for len in [100, usize::MAX] {
            let actual = in_pieces(&mut decoder(dictionary), &input, len);
            assert!(actual == expected, "{seed} in pieces of {len}");
        }

        let (mut whole, mut out) = (decoder(dictionary), b"kept".to_vec());
        if whole.decompress_whole(&input, &mut out, 1 << 24).is_some() {
            finished += 1;
            assert!(
                out[..4] == *b"kept" && Ok(&out[4..]) == expected.as_deref(),
                "{seed}"
            );
            whole = decoder(dictionary);
            let max = out.len() - 5;
            assert_eq!(whole.decompress_whole(&input, &mut out, max), None);
        }
        assert!(in_pieces(&mut whole, &input, 999) == expected, "{seed}");
    }
    assert!(cfg!(miri) || decoded > 1_000_000 && finished > CASES / 8);
}

#[test]
fn nothing_of_an_earlier_stream_gets_out() {
    let used_for = |byte: u8| {
        let mut spare = SpareTables::default();
        let stored = [&[0xF0, 0xFF, 0x1F][..], &[byte; 1 << 16], &[3]].concat();
        let complete = (0..=CASES / 8).map(|seed| completed(seed + u64::from(byte), &[]));
        for input in complete.chain([stored]) {
            let mut decoder = decoder(&[]);
            decoder.swap_tables(&mut spare);
            _ = in_pieces(&mut decoder, &input, usize::MAX);
            decoder.state = State::StreamHeader;
            decoder.swap_tables(&mut spare);
        }
        assert!(spare.window.starts_with(&[byte; 1 << 16]) && spare.codes.is_some());
        spare
    };
    let mut spares = [SpareTables::default(), used_for(0x55), used_for(0xAA)];
    for seed in 0..10 * CASES {
        let (mut input, mut random) = (made_up(seed / 10, None), Random(seed));
        for _ in 0..seed % 3 {
            let within = input.len() >> random.below(4);
            input[random.below(within)] ^= 1 << random.below(8);
        }
        let [fresh, a, b] = spares.each_mut().map(|spare| {
            let (mut decoder, mut out) = (decoder(&[]), Vec::with_capacity(1 << 20));
            decoder.swap_tables(spare);
            let status = (input.chunks(700)).try_for_each(|mut piece| {
                append_with(&mut out, 1 << 20, |out| decoder.decompress(&mut piece, out)).map(drop)
            });
            spare.codes = decoder.codes.take().map(|mut codes| {
                codes.reader = PrefixCodeReader::new().ok().unwrap();
                (codes.literal_map, codes.distance_map) = Default::default();
                codes
            });
            decoder.ring.swap_bytes(&mut spare.window);
            let byte = spare.window.last().copied().unwrap_or(0);
            spare.window.fill(byte.wrapping_add(1));
            (status, out)
        });
        assert!(fresh == a && a == b, "{seed}");
        spares[0] = SpareTables::default();
    }
}

#[test]
fn tables_stay_in_the_middle_of_a_stream() {
    let input = (0..).map(|seed| made_up(seed, None));
    let mut input = input.filter(|it| in_pieces(&mut decoder(&[]), it, usize::MAX).is_ok());
    let (input, mut decoder) = (input.next().unwrap(), decoder(&[]));
    let (first, second) = input.split_at(input.len() / 2);
    in_pieces(&mut decoder, first, usize::MAX).unwrap();
    decoder.swap_tables(&mut SpareTables::default());
    in_pieces(&mut decoder, second, usize::MAX).unwrap();
}

#[test]
fn a_body_goes_on_after_it_began_in_the_output() {
    for seed in 0..CASES {
        let input = completed(seed, &[]);
        let Ok(expected) = in_pieces(&mut decoder(&[]), &input, usize::MAX) else {
            continue;
        };
        let (mut decoder, mut all) = (StreamingDecoder::default(), Vec::new());
        let max_output = [300, 3000, 1 << 24][seed as usize % 3];
        for mut piece in input.chunks(input.len() / 3 + 1) {
            loop {
                let mut out = Vec::new();
                let used = decoder.decompress(piece, &mut out, max_output, false);
                piece = &piece[used.unwrap_or(piece.len())..];
                all.extend_from_slice(&out);
                if out.len() < max_output {
                    break;
                }
            }
        }
        assert!(all == expected, "{seed}");
    }
}

fn packed(fields: &[&[(usize, usize)]]) -> Vec<u8> {
    let bits = |&(count, value): &(usize, usize)| (0..count).map(move |bit| (value >> bit) % 2);
    let bits: Vec<_> = fields.concat().iter().flat_map(bits).collect();
    let byte = |bits: &[usize]| bits.iter().rfold(0, |byte, &bit| 2 * byte + bit as u8);
    bits.chunks(8).map(byte).collect()
}

const WINDOW_OF_1_KB: [(usize, usize); 1] = [(7, 0b010_0001)];

/// One literal and a copy.
fn run_of(len: usize) -> [(usize, usize); 8] {
    let codes = [(12, 1 + 16 * 97), (14, 1 + 16 * 399), (10, 1 + 16 * 16)];
    let [a, b, c] = codes;
    [
        (3, 2),
        (20, len - 1),
        (14, 0),
        a,
        b,
        c,
        (24, len - 2119),
        (1, 0),
    ]
}

fn metadata(bytes: usize, len: usize) -> [(usize, usize); 2] {
    [(6, 6 + 16 * bytes), (8 * bytes, len - 1)]
}

#[test]
fn lengths_that_are_only_announced_get_no_memory() {
    let skips = packed(&[&WINDOW_OF_1_KB, &run_of(300_000), &metadata(3, 1 << 24)]);
    let codes = [(20, 5 + 16 * 0x6261), (14, 1 + 16 * 136), (10, 1 + 16 * 16)];
    let last = packed(&[&WINDOW_OF_1_KB, &[(4, 9), (24, 0xFF_FFFF), (13, 0)], &codes]);
    for input in [skips, last] {
        let (mut decoder, mut out) = (decoder(&[]), Vec::new());
        for mut piece in [&input[..], &[0]] {
            let status = decoder.decompress_appending(&mut piece, &mut out, usize::MAX);
            assert_eq!(status, Ok(DecodeStatus::NeedsInput));
            assert!(out.capacity() < 2 * out.len() + 10_000);
        }
    }
}

#[test]
fn a_limit_that_stays_bounds_the_memory() {
    let input = packed(&[&WINDOW_OF_1_KB, &run_of(1 << 20), &[(2, 3)]]);
    let (mut decoder, mut rest, mut out) = (decoder(&[]), &input[..], vec![0; 1 << 18]);
    while out.len() < 300_000 {
        let status = decoder.decompress_appending(&mut rest, &mut out, 300_000);
        assert_eq!(status, Ok(DecodeStatus::NeedsOutput));
    }
    assert!(out.capacity() < 600_000);
}

#[test]
fn the_ratio_so_far_is_believed_within_limits() {
    let head = packed(&[&WINDOW_OF_1_KB, &run_of(1 << 20), &metadata(2, 60_000)]);
    let (input, mut out) = ([&head[..], &[0; 60_000], &[3]].concat(), Vec::new());
    let len = decoder(&[]).decompress_whole(&input, &mut out, usize::MAX);
    assert_eq!((len, out.len()), (Some(input.len()), 1 << 20));
    assert!(out.capacity() < 16 << 20);
}

#[test]
fn output_that_keeps_exceeding_guesses_doubles() {
    let (mut ring, mut out, mut starts) = (RingBuffer::default(), Vec::new(), Vec::new());
    ring.begin_in(&mut out, usize::MAX, 1000);
    for _ in 0..1 << 12 {
        let begun = ring.begin_meta_block(1000, false, DecodeError::AllocRingBuffer1);
        assert!(begun.is_ok() && ring.make_room(1000, Some(0)).is_ok());
        assert!(matches!(ring.append(&[0; 1000]), Ok(1000)));
        starts.push(ring.bytes_mut().as_ptr());
    }
    starts.dedup();
    assert!(starts.len() <= 16);
}

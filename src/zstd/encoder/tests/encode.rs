//! What test/js/bun/util/zstd-golden cannot bring about or see. The lengths and hashes are those of zstd 1.5.7.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use bun_highway::zstd::COUNT_MIN;
use bun_zstd_decoder::{Dictionary, Error, Output, Result, Status, XxHash64, decompress};
use bun_zstd_encoder::EndDirective::{Continue, End, Flush};
use bun_zstd_encoder::{DEFAULT_LEVEL, Encoder, compress, compress_bound};
use common::*;

thread_local! {
    /// How many allocations are granted before one is refused.
    static GRANTS: Cell<Option<usize>> = const { Cell::new(None) };
}

struct Refusing;

// SAFETY: what is not refused is left to `System`.
unsafe impl GlobalAlloc for Refusing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let grants = GRANTS.get();
        GRANTS.set(grants.and_then(|it| it.checked_sub(1)));
        if grants == Some(0) {
            return std::ptr::null_mut();
        }
        // SAFETY: the caller's promises are passed on.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: as above.
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Refusing = Refusing;

const FORMAT: u32 = 10;
const LEVEL: u32 = 100;
const HASH_LOG: u32 = 102;
const CHAIN_LOG: u32 = 103;
const STRATEGY: u32 = 107;
const TARGET_BLOCK_LEN: u32 = 130;

fn noise(len: usize) -> Vec<u8> {
    let words = (0..len as u64).map(|it| XxHash64::hash(&it.to_le_bytes()));
    words.flat_map(u64::to_le_bytes).take(len).collect()
}

#[test]
fn refused_memory_is_an_error() -> Result<()> {
    let input = sample(34_000);
    let mut out = Vec::with_capacity(4 * input.len());
    let by_strategy = (1..=9).map(|strategy| {
        vec![
            (WINDOW_LOG, 17),
            (HASH_LOG, 12),
            (CHAIN_LOG, 12),
            (STRATEGY, strategy),
        ]
    });
    let others = [
        vec![(WINDOW_LOG, 12), (STRATEGY, 4)],
        vec![(WINDOW_LOG, 14), (TARGET_BLOCK_LEN, 1340)],
        vec![(WINDOW_LOG, 14), (LONG_DISTANCE, 1)],
        vec![(WINDOW_LOG, 14), (STRATEGY, 7), (LONG_DISTANCE, 1)],
    ];
    for parameters in by_strategy.chain(others) {
        for dictionary in [&[], DICTIONARY] {
            three_frames(&mut encoder(&parameters, dictionary)?, &input, &mut out)?;
            let expected = summary(&out);
            for grants in 0.. {
                let mut encoder = encoder(&parameters, dictionary)?;
                GRANTS.set(Some(grants));
                let result = three_frames(&mut encoder, &input, &mut out);
                if GRANTS.take().is_some() {
                    assert_eq!((result, summary(&out)), (Ok(()), expected));
                    break;
                }
                assert_eq!(result, Err(Error::MemoryAllocation));

                encoder.reset_session();
                three_frames(&mut encoder, &input, &mut out)?;
                assert_eq!(summary(&out), expected, "{parameters:?} {grants}");
            }
        }
    }

    GRANTS.set(Some(0));
    let result = Encoder::new(DEFAULT_LEVEL).load_dictionary(DICTIONARY);
    assert_eq!(result, Err(Error::MemoryAllocation));

    for grants in 0.. {
        out.clear();
        GRANTS.set(Some(grants));
        let result = compress(
            &input,
            &mut Output::spare_capacity(&mut out, usize::MAX),
            19,
        );
        if GRANTS.take().is_some() {
            assert_eq!((result, summary(&out)), (Ok(()), (11260, 0x65D0_0CE6)));
            break;
        }
        assert_eq!(result, Err(Error::MemoryAllocation));
    }
    Ok(())
}

#[test]
fn memory_that_frames_do_not_need_is_given_up() -> Result<()> {
    let (small, large) = (sample(300), sample(40_000));
    let mut out = Vec::with_capacity(2 * large.len());
    let mut encoder = encoder(&[], &[])?;
    let mut frames_until_it_allocates = |encoder: &mut Encoder, input: &[u8], most| {
        (1..=most).find(|_| {
            out.clear();
            GRANTS.set(Some(0));
            let result = write(encoder, input, End, usize::MAX, &mut out);
            GRANTS.set(None);
            result.is_err()
        })
    };
    let complete = Ok(Status::Complete);
    // Tables for the entropy stage are allocated when they are first used, and there are two of each.
    for input in [&large, &large, &small] {
        assert_eq!(step(&mut encoder, input, 50_000, End).2, complete);
    }
    assert_eq!(frames_until_it_allocates(&mut encoder, &large, 200), None);
    assert_eq!(frames_until_it_allocates(&mut encoder, &small, 100), None);
    assert_eq!(frames_until_it_allocates(&mut encoder, &large, 1), None);
    let frames = frames_until_it_allocates(&mut encoder, &small, 200);
    assert_eq!(frames, Some(129));
    Ok(())
}

#[test]
fn too_little_room_is_an_error() -> Result<()> {
    let inputs = [
        vec![],
        vec![7; 5],
        sample(60),
        sample(700),
        sample(3000),
        noise(300),
        vec![7; 140_000],
        [vec![7; 131_072], sample(2000)].concat(),
        [noise(131_072), vec![7; 3]].concat(),
    ];
    for input in inputs {
        let levels = [1, -1, 3, 6, 19].into_iter();
        for level in levels.take(if input.len() > 3000 { 1 } else { 5 }) {
            let mut expected = Vec::with_capacity(compress_bound(input.len()).unwrap());
            let mut out = Output::spare_capacity(&mut expected, usize::MAX);
            compress(&input, &mut out, level)?;
            drop(out);

            let few = (0..expected.len().min(64)).chain((64..expected.len().min(2000)).step_by(37));
            for room in few.chain(expected.len().saturating_sub(24)..expected.len()) {
                let result = compress(&input, &mut Output::slice(&mut vec![0; room]), level);
                assert_eq!(result, Err(Error::DstSizeTooSmall), "{level} {room}");
            }
            // From here on it may or may not be enough.
            for room in expected.len()..expected.len() + 24 {
                let mut room = vec![0; room];
                let mut out = Output::slice(&mut room);
                match compress(&input, &mut out, level).map(|()| out.written()) {
                    Ok(len) => {
                        drop(out);
                        let mut back = Vec::with_capacity(input.len());
                        let mut out = Output::spare_capacity(&mut back, usize::MAX);
                        decompress(&room[..len], &mut out, None)?;
                        drop(out);
                        assert!(back == input);
                    }
                    Err(error) => assert_eq!(error, Error::DstSizeTooSmall),
                }
            }
        }
    }
    Ok(())
}

/// The kernels give up before the room is exhausted.
#[test]
fn literals_fit_in_as_little_room_with_kernels() -> Result<()> {
    let input: Vec<_> = (noise(8800).chunks(2).map(|it| it[0] & it[1])).collect();
    let fits = |room| -> Result<_> {
        let mut room = vec![0; room];
        let mut out = Output::slice(&mut room);
        compress(&input, &mut out, 1)?;
        let len = out.written();
        drop(out);
        Ok(summary(&room[..len]))
    };
    for count_min in [usize::MAX, 4096] {
        COUNT_MIN.set(count_min);
        assert_eq!(fits(3700), Err(Error::DstSizeTooSmall));
        for room in 3701..3900 {
            assert_eq!(fits(room)?, (3694, 0x5E63_B143));
        }
    }
    Ok(())
}

#[test]
fn kernels_do_not_change_the_output() -> Result<()> {
    let input = sample(150_000);
    for parameters in [[(LEVEL, 1)], [(LEVEL, 17)], [(TARGET_BLOCK_LEN, 1340)]] {
        for dictionary in [&[], DICTIONARY] {
            let [mut without, mut with] = [0; 2].map(|_| Vec::with_capacity(4 * input.len()));
            for (count_min, out) in [(usize::MAX, &mut without), (0, &mut with)] {
                COUNT_MIN.set(count_min);
                three_frames(&mut encoder(&parameters, dictionary)?, &input, out)?;
            }
            assert!(with == without);
        }
    }
    Ok(())
}

/// The blocks for the first part gain little each. The codes that all share are long for the last part.
#[test]
fn small_blocks_are_given_up_if_the_last_one_grows_too_much() -> Result<()> {
    const LAST_PART: usize = 83_000;
    let byte = |(index, random): (usize, &[u8; 3])| match u16::from_le_bytes([random[0], random[1]])
    {
        _ if random[2] < 3 => 0,
        random if index < LAST_PART => (random % 180) as u8,
        random => (180 + random % 76) as u8,
    };
    let noise = noise(300_000);
    let mut input: Vec<_> = noise.as_chunks().0.iter().enumerate().map(byte).collect();
    for at in (550..LAST_PART).step_by(550) {
        input.copy_within(at - 40..at - 35, at);
    }
    let mut encoder = encoder(&[(LEVEL, 5), (TARGET_BLOCK_LEN, 1340)], &[])?;
    let mut out = Vec::with_capacity(compress_bound(input.len()).unwrap());
    write(&mut encoder, &input, End, usize::MAX, &mut out)?;
    assert!(out.len() == 12 + input.len() && out.ends_with(&input));
    Ok(())
}

#[test]
fn matches_end_where_blocks_do() -> Result<()> {
    let input = sample(6000);
    for (block_len, expected) in [(10, (7723, 0x11B5_CCD9)), (11, (7169, 0x3BD5_8B28))] {
        let mut encoder = encoder(&[(LEVEL, 19)], &[])?;
        encoder.set_pledged_len(Some(input.len() as u64))?;
        let mut out = Vec::with_capacity(2 * input.len());
        for block in input.chunks(block_len) {
            write(&mut encoder, block, Flush, usize::MAX, &mut out)?;
        }
        write(&mut encoder, &[], End, usize::MAX, &mut out)?;
        assert_eq!(summary(&out), expected);
    }
    Ok(())
}

#[test]
fn there_has_to_be_room_for_the_longest_header() {
    let empty_frame = |room| compress(&[], &mut Output::slice(&mut vec![0; room]), 1);
    assert_eq!(empty_frame(17), Err(Error::DstSizeTooSmall));
    assert_eq!(empty_frame(18), Ok(()));
}

#[test]
fn fields_of_the_header_are_as_short_as_possible() -> Result<()> {
    let header = |id: u32, pledged| -> Result<_> {
        let dictionary = [&DICTIONARY[..4], &id.to_le_bytes(), &DICTIONARY[8..]].concat();
        let mut encoder = encoder(&[(WINDOW_LOG, 10)], &dictionary)?;
        encoder.set_pledged_len(pledged)?;
        let mut out = Vec::with_capacity(100);
        write(&mut encoder, b"a", Flush, usize::MAX, &mut out)?;
        Ok(out[4..out.len() - 4].to_vec())
    };
    let ids: [(_, &[_]); _] = [
        (0, &[0, 0]),
        (1, &[1, 0, 1]),
        (0xFF, &[1, 0, 0xFF]),
        (0x100, &[2, 0, 0, 1]),
        (0xFFFF, &[2, 0, 0xFF, 0xFF]),
        (0x1_0000, &[3, 0, 0, 0, 1, 0]),
    ];
    for (id, expected) in ids {
        assert_eq!(header(id, None)?, expected);
    }
    let sizes: [(_, &[_]); _] = [
        (0xFF, &[0x20, 0xFF]),
        (0x100, &[0x60, 0, 0]),
        (0x400, &[0x60, 0, 3]),
        (0x401, &[0x40, 0, 1, 3]),
        (0x1_00FF, &[0x40, 0, 0xFF, 0xFF]),
        (0x1_0100, &[0x80, 0, 0, 1, 1, 0]),
        (0xFFFF_FFFE, &[0x80, 0, 0xFE, 0xFF, 0xFF, 0xFF]),
        (0xFFFF_FFFF, &[0xC0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0, 0]),
    ];
    for (size, expected) in sizes {
        assert_eq!(header(0, Some(size))?, expected);
    }
    Ok(())
}

#[test]
fn the_bound_has_a_margin_for_short_inputs() {
    let bounds = [
        (0, Some(64)),
        (255, Some(318)),
        (256, Some(320)),
        (2048, Some(2119)),
        (2049, Some(2119)),
        (131_071, Some(131_582)),
        (131_072, Some(131_584)),
        (1 << 32, Some((1 << 32) + (1 << 24))),
        (0xFF00_FF00_FF00_FE00, Some(0xFFFF_FFFF_FFFF_FEFE)),
        (0xFF00_FF00_FF00_FEFF, Some(usize::MAX - 2)),
        (0xFF00_FF00_FF00_FF00, None),
        (usize::MAX, None),
    ];
    for (len, bound) in bounds {
        assert_eq!(compress_bound(len), bound, "{len}");
    }
}

#[test]
fn parameters_have_limits() {
    let set = |key, value| Encoder::new(DEFAULT_LEVEL).set_parameter(key, value);
    let limited = [
        (FORMAT, 0, 1),
        (WINDOW_LOG, 10, 31),
        (HASH_LOG, 6, 30),
        (CHAIN_LOG, 6, 30),
        (104, 1, 30),
        (105, 3, 7),
        (106, 0, 131_072),
        (STRATEGY, 1, 9),
        (LONG_DISTANCE, 0, 2),
        (161, 6, 30),
        (162, 4, 4096),
        (163, 1, 8),
        (164, 0, 25),
    ];
    for (key, min, max) in limited {
        for value in [0, min, max] {
            assert_eq!(set(key, value), Ok(()), "{key} {value}");
        }
        let below = if min == 1 { -1 } else { min - 1 };
        for value in [i32::MIN, below, max + 1, i32::MAX] {
            let result = set(key, value);
            assert_eq!(result, Err(Error::ParameterOutOfBound), "{key} {value}");
        }
    }

    let clamped = [LEVEL, 200, CHECKSUM, 202, WORKERS, JOB_LEN, 402];
    for key in clamped {
        for value in [i32::MIN, -1, 0, i32::MAX] {
            assert_eq!(set(key, value), Ok(()), "{key} {value}");
        }
    }

    for value in [i32::MIN, 0, 1, 131_072] {
        assert_eq!(set(TARGET_BLOCK_LEN, value), Ok(()));
    }
    let result = set(TARGET_BLOCK_LEN, 131_073);
    assert_eq!(result, Err(Error::ParameterOutOfBound));

    let is_known = |key| {
        key == TARGET_BLOCK_LEN || clamped.contains(&key) || limited.iter().any(|it| it.0 == key)
    };
    for key in (0..=500).filter(|&key| !is_known(key)) {
        assert_eq!(set(key, 0), Err(Error::ParameterUnsupported), "{key}");
    }
}

#[test]
fn settings_change_between_frames() -> Result<()> {
    let input = sample(20_000);
    let mut encoder = encoder(&[], &[])?;
    assert_eq!(
        step(&mut encoder, &input, 0, Continue),
        (input.len(), 0, Ok(Status::Complete))
    );
    assert_eq!(encoder.set_parameter(CHECKSUM, 1), Err(Error::StageWrong));
    assert_eq!(encoder.set_pledged_len(Some(1)), Err(Error::StageWrong));
    assert_eq!(encoder.load_dictionary(DICTIONARY), Err(Error::StageWrong));
    encoder.reset_session();

    let changes: [(&[_], &[u8], _); _] = [
        (&[(LEVEL, 19), (CHECKSUM, 1)], &[], (12185, 0xACD8_1077)),
        (
            &[(WINDOW_LOG, 12), (LONG_DISTANCE, 1), (162, 8)],
            &[],
            (14366, 0xCDBD_8D8E),
        ),
        (
            &[(LEVEL, 7), (LONG_DISTANCE, 0)],
            DICTIONARY,
            (14827, 0xED54_51CB),
        ),
        (
            &[(LEVEL, 1), (TARGET_BLOCK_LEN, 1)],
            &input[..3000],
            (14632, 0x1FE7_4F84),
        ),
        (
            &[(LEVEL, 0), (WINDOW_LOG, 0), (TARGET_BLOCK_LEN, 0)],
            &[],
            (13712, 0xDA54_ED7C),
        ),
        (
            &[(WORKERS, -1), (JOB_LEN, 0), (STRATEGY, 6)],
            &[],
            (12851, 0x4A76_895F),
        ),
        (&[(STRATEGY, 0)], &[], (13712, 0xDA54_ED7C)),
    ];
    let mut out = Vec::with_capacity(4 * input.len());
    for (parameters, dictionary, expected) in changes {
        encoder.load_dictionary(dictionary)?;
        for &(key, value) in parameters {
            encoder.set_parameter(key, value)?;
        }
        three_frames(&mut encoder, &input, &mut out)?;
        assert_eq!(summary(&out), expected, "{parameters:?}");

        let mut back = Vec::with_capacity(3 * input.len());
        let mut back_out = Output::spare_capacity(&mut back, usize::MAX);
        decompress(&out, &mut back_out, Some(&Dictionary::new(dictionary)?))?;
        drop(back_out);
        assert!(back == [&input[..], &input[..500], &input[..]].concat());
    }
    Ok(())
}

#[test]
fn a_step_tells_whether_output_is_left() -> Result<()> {
    let mut encoder = encoder(&[(WINDOW_LOG, 10)], &[])?;
    let input = noise(1500);
    let steps = [
        (0..1000, 0, Continue, (1000, 0, Status::Complete)),
        // A block is full, and there is no room for it.
        (1000..1100, 9, Continue, (24, 9, Status::Pending)),
        (1024..1100, 1023, Continue, (0, 1023, Status::Pending)),
        (1024..1100, 1, Continue, (76, 1, Status::Complete)),
        (1100..1100, 78, Flush, (0, 78, Status::Pending)),
        (1100..1100, 1, Flush, (0, 1, Status::Complete)),
        (1100..1100, 0, Flush, (0, 0, Status::Complete)),
        (1100..1200, 102, End, (100, 102, Status::Pending)),
        // The frame ends whatever the directive, and what comes with that step is left for the next one.
        (1200..1500, 50, Continue, (0, 1, Status::Complete)),
        (1200..1500, 400, End, (300, 310, Status::Complete)),
    ];
    for (range, room, directive, (consumed, written, status)) in steps {
        let result = step(&mut encoder, &input[range.clone()], room, directive);
        assert_eq!(result, (consumed, written, Ok(status)), "{range:?} {room}");
    }
    Ok(())
}

#[test]
fn an_error_undoes_the_step_and_stays() -> Result<()> {
    let mut encoder = encoder(&[(WINDOW_LOG, 10), (CHECKSUM, 1)], &[])?;
    let input = noise(3000);
    let failed = (0, 0, Err(Error::SrcSizeWrong));
    for pledged in [2999, 3001] {
        encoder.set_pledged_len(Some(pledged))?;
        assert_eq!(step(&mut encoder, &input[..1], 0, Continue).0, 1);
        assert_eq!(step(&mut encoder, &input[1..], 4000, End), failed);
        assert_eq!(step(&mut encoder, &[], 4000, End), failed);
        assert_eq!(encoder.set_pledged_len(None), Err(Error::SrcSizeWrong));
        encoder.reset_session();
    }

    // The pledge is forgotten, and the parameters are not.
    encoder.set_pledged_len(Some(1))?;
    encoder.reset_session();
    assert_eq!(step(&mut encoder, &input[..1], 0, Continue).0, 1);
    let result = step(&mut encoder, &input[1..], 4000, End);
    assert_eq!(result, (2999, 6 + 3 * 3 + 3000 + 4, Ok(Status::Complete)));
    Ok(())
}

#[test]
fn a_damaged_dictionary_is_refused_when_a_frame_starts() -> Result<()> {
    // The largest of its recent offsets is 8.
    let content_start = 112;
    for len in 8..content_start + 8 {
        let mut encoder = encoder(&[], &DICTIONARY[..len])?;
        for _ in 0..2 {
            let result = step(&mut encoder, b"a", 100, End);
            assert_eq!(result, (0, 0, Err(Error::DictionaryCorrupted)), "{len}");
            encoder.reset_session();
        }
    }
    for len in [7, content_start + 8] {
        let result = step(&mut encoder(&[], &DICTIONARY[..len])?, b"a", 100, End);
        assert_eq!(result.2, Ok(Status::Complete), "{len}");
    }
    Ok(())
}

#[test]
fn what_is_a_dictionary_for_the_decoder_is_one_for_the_encoder() -> Result<()> {
    let mut accepted = 0;
    for position in 8..112 {
        for bit in 0..8 {
            let mut changed = DICTIONARY.to_vec();
            changed[position] ^= 1 << bit;
            let result = step(&mut encoder(&[], &changed)?, b"a", 100, End).2;
            let is_accepted = Dictionary::new(&changed).is_ok();
            assert_eq!(result.is_ok(), is_accepted, "{position} {bit}");
            accepted += usize::from(is_accepted);
        }
    }
    assert_eq!(accepted, 143);
    Ok(())
}

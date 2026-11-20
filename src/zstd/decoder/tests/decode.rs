//! The fixtures are from zstd 1.5.7: its CLI, and `decodecorpus` for generated.zst. All their frames have a checksum.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use bun_zstd_decoder::{
    ContentSize, Decoder, Dictionary, Error, FrameLen, Output, Result, SpareTables, Status,
    TableDescription, XxHash64, decompress, decompress_with, decompressed_size, frame_content_size,
    frame_len, may_start_frame, read_huffman_weights, read_normalized_counts,
};

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

/// Whether all was granted.
fn with_grants<T>(grants: usize, run: impl FnOnce() -> T) -> (bool, T) {
    GRANTS.set(Some(grants));
    let result = run();
    (GRANTS.take().is_some(), result)
}

const DICTIONARY: &[u8] = include_bytes!("fixtures/dictionary");

struct Fixture {
    frames: &'static [u8],
    dictionary: &'static [u8],
    len: usize,
    hash: u64,
}

const FIXTURES: [Fixture; 5] = [
    Fixture {
        frames: include_bytes!("fixtures/generated.zst"),
        dictionary: &[],
        len: 122576,
        hash: 0x718B_275C_41EA_4A2A,
    },
    Fixture {
        frames: include_bytes!("fixtures/small-window.zst"),
        dictionary: &[],
        len: 40000,
        hash: 0x4328_9FE3_4E28_8052,
    },
    Fixture {
        frames: include_bytes!("fixtures/literals.zst"),
        dictionary: &[],
        len: 24000,
        hash: 0x1677_E591_A46B_0D8F,
    },
    Fixture {
        frames: include_bytes!("fixtures/some-predefined-tables.zst"),
        dictionary: DICTIONARY,
        len: 150,
        hash: 0xE8A3_6C1D_A92C_DF01,
    },
    Fixture {
        frames: include_bytes!("fixtures/with-dictionary.zst"),
        dictionary: DICTIONARY,
        len: 700,
        hash: 0xB6E5_C177_FEF5_5DA5,
    },
];

fn hex(digits: &str) -> Vec<u8> {
    let digits: Vec<_> = digits.chars().filter_map(|it| it.to_digit(16)).collect();
    let (pairs, _) = digits.as_chunks();
    pairs
        .iter()
        .map(|[high, low]| (high << 4 | low) as u8)
        .collect()
}

fn at_once(src: &[u8], room: usize) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(room);
    decompress(src, &mut Output::spare_capacity(&mut out, room), None)?;
    Ok(out)
}

/// `out` has room for all.
fn stream(
    decoder: &mut Decoder,
    mut src: &[u8],
    [input_step, output_step]: [usize; 2],
    out: &mut Vec<u8>,
) -> Result<()> {
    loop {
        let (input, written) = (&src[..input_step.min(src.len())], out.len());
        let (consumed, status) = decoder.step(input, &mut Output::spare_capacity(out, output_step));
        src = &src[consumed..];
        if status? == Status::Complete && src.is_empty() {
            return Ok(());
        }
        assert!(consumed != 0 || out.len() != written);
    }
}

fn byte_by_byte(src: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(1 << 18);
    stream(&mut Decoder::new(), src, [1, usize::MAX], &mut out)?;
    Ok(out)
}

#[test]
fn fixtures_decode_at_once() -> Result<()> {
    for fixture in FIXTURES {
        let dictionary = Dictionary::new(fixture.dictionary)?;
        for slack in [0, 1, 31, 32, 33] {
            let mut slice = vec![0xAA; fixture.len + slack];
            let mut out = Output::slice(&mut slice);
            decompress(fixture.frames, &mut out, Some(&dictionary))?;
            assert_eq!(out.written(), fixture.len);
            drop(out);
            assert_eq!(XxHash64::hash(&slice[..fixture.len]), fixture.hash);

            let mut vec = Vec::with_capacity(1 + fixture.len + slack);
            vec.push(7);
            let mut out = Output::spare_capacity(&mut vec, fixture.len);
            decompress(fixture.frames, &mut out, Some(&dictionary))?;
            drop(out);
            assert_eq!((vec[0], &vec[1..]), (7, &slice[..fixture.len]));
        }
        let mut short = vec![0; fixture.len - 1];
        let result = decompress(
            fixture.frames,
            &mut Output::slice(&mut short),
            Some(&dictionary),
        );
        assert_eq!(result, Err(Error::DstSizeTooSmall));
    }
    Ok(())
}

#[test]
fn fixtures_decode_in_pieces() -> Result<()> {
    let mut decoder = Decoder::new();
    for fixture in FIXTURES {
        decoder.load_dictionary(fixture.dictionary)?;
        for steps in [
            [1, 1 << 20],
            [1 << 20, 3],
            [7, 13],
            [1000, 999],
            [1 << 20, 1 << 20],
        ] {
            let mut out = Vec::with_capacity(fixture.len);
            stream(&mut decoder, fixture.frames, steps, &mut out)?;
            assert_eq!(
                (out.len(), XxHash64::hash(&out)),
                (fixture.len, fixture.hash)
            );
        }
    }
    Ok(())
}

#[test]
fn refused_memory_is_an_error() {
    for fixture in FIXTURES {
        for in_pieces in [false, true] {
            for grants in 0.. {
                let mut out = Vec::with_capacity(fixture.len);
                let (was_granted, result) = with_grants(grants, || {
                    if in_pieces {
                        let mut decoder = Decoder::new();
                        decoder.load_dictionary(fixture.dictionary)?;
                        stream(&mut decoder, fixture.frames, [100, 100], &mut out)
                    } else {
                        let dictionary = Dictionary::new(fixture.dictionary)?;
                        let mut out = Output::spare_capacity(&mut out, usize::MAX);
                        decompress(fixture.frames, &mut out, Some(&dictionary))
                    }
                });
                if was_granted {
                    assert_eq!((result, out.len()), (Ok(()), fixture.len));
                    break;
                }
                assert_eq!(result, Err(Error::MemoryAllocation));
            }
        }
    }
}

#[test]
fn a_byte_that_is_repeated_0_times_takes_no_room() {
    let out = at_once(&hex("28b52ffd 0000 030000 61"), 0);
    assert_eq!(out.map(|it| it.capacity()), Ok(0));
}

#[test]
fn raw_literals_take_no_memory() {
    let frame = [
        hex("28b52ffd 0000 200000 61626364 9d0900 c412"),
        vec![7; 300],
        hex("01 00 000002"),
    ];
    let (frame, mut out) = (frame.concat(), [0; 307]);
    GRANTS.set(Some(0));
    let result = decompress(&frame, &mut Output::slice(&mut out), None);
    GRANTS.set(None);
    assert_eq!((result, &out[..8]), (Ok(()), &b"abcdabc\x07"[..]));
}

#[test]
fn the_memory_of_tables_passes_to_the_next_call() {
    let frame = |block| hex(&format!("28b52ffd 0000 200000 61626364 {block}"));
    let mut spare = SpareTables::default();
    let mut decode = |grants, frame: &[u8]| {
        let mut out = [0; 7];
        let (_, result) = with_grants(grants, || {
            decompress_with(&mut spare, frame, &mut Output::slice(&mut out), None)
        });
        result.map(|()| out)
    };
    let valid = frame("3d0000 00 01 54 000200 07");
    assert_eq!(decode(0, &valid), Err(Error::MemoryAllocation));
    assert_eq!(decode(1, &valid), Ok(*b"abcdabc"));
    // One kind of table after the other is repeated, then all.
    for block in [
        "350000 00 01 d4 0200 07",
        "350000 00 01 74 0000 07",
        "350000 00 01 5c 0002 07",
        "250000 00 01 fc 07",
    ] {
        let repeats = frame(block);
        assert_eq!(decode(0, &repeats), Err(Error::CorruptionDetected));
        assert_eq!(decode(0, &valid), Ok(*b"abcdabc"));
        let both = [&valid[..], &repeats].concat();
        assert_eq!(byte_by_byte(&both), Err(Error::CorruptionDetected));
    }
}

#[test]
fn a_stream_repeats_no_tables_that_were_swapped() -> Result<()> {
    let frame = hex("28b52ffd 0000 200000 61626364 3c0000 00 01 54 000200 07 250000 00 01 fc 07");
    let used = || {
        let (mut decoder, mut spare) = (Decoder::new(), SpareTables::default());
        let (_, status) = decoder.step_growing(&frame, &mut Vec::new(), usize::MAX);
        decoder.swap_tables(&mut spare);
        status.map(|_| spare)
    };
    let (mut decoder, mut out) = (Decoder::new(), Vec::with_capacity(4096));
    decoder.swap_tables(&mut used()?);
    let (_, (_, status)) = with_grants(0, || decoder.step_growing(&frame, &mut out, usize::MAX));
    assert_eq!((status?, &out[..]), (Status::Complete, &b"abcdabcdab"[..]));

    let (start, last_block) = frame.split_at(frame.len() - 7);
    decoder.step_growing(start, &mut out, usize::MAX).1?;
    decoder.swap_tables(&mut used()?);
    let (_, status) = decoder.step_growing(last_block, &mut out, usize::MAX);
    assert_eq!(status, Err(Error::CorruptionDetected));
    Ok(())
}

#[test]
fn refused_memory_is_an_error_for_a_growing_output() {
    let [_, fixture, ..] = FIXTURES;
    for step in [fixture.frames.len(), fixture.frames.len() - 1] {
        for grants in 0.. {
            let mut out = Vec::new();
            let (was_granted, (_, status)) = with_grants(grants, || {
                Decoder::new().step_growing(&fixture.frames[..step], &mut out, usize::MAX)
            });
            if was_granted {
                assert_eq!((status.is_ok(), XxHash64::hash(&out)), (true, fixture.hash));
                break;
            }
            assert_eq!(status, Err(Error::MemoryAllocation));
        }
    }
}

#[test]
fn no_changed_byte_goes_unnoticed() -> Result<()> {
    let [.., fixture] = FIXTURES;
    let dictionary = Dictionary::new(fixture.dictionary)?;
    for index in 0..fixture.frames.len() {
        for bit in 0..8 {
            let mut frame = fixture.frames.to_vec();
            frame[index] ^= 1 << bit;
            let mut out = [0; 2000];
            let result = decompress(&frame, &mut Output::slice(&mut out), Some(&dictionary));
            assert!(result.is_err() || XxHash64::hash(&out[..fixture.len]) == fixture.hash);
        }
    }
    Ok(())
}

#[test]
fn unusual_frames_decode() {
    let frames = [
        ("28b52ffd 2000 010000", 0),
        // No literals and no sequences, and two bytes to say that there are no sequences.
        ("28b52ffd 0000 150000 0000", 0),
        ("28b52ffd 0000 250000 0861 8000", 1),
        ("28b52ffd a001000200 020010 00 0b0000 00", 131073),
        (
            "28b52ffd 2027 c50000 80f3f1f0ecebc6c5c7f09d43000000e0e0 06580100603e52",
            39,
        ),
        // A stream of literals with none in it.
        ("28b52ffd 0000 3d0000 02c000 8010 01 00", 0),
        ("28b52ffd c000 ffffffffffffffff 190000 616263", 3),
        ("502a4d18 00000000", 0),
        ("5f2a4d18 02000000 ffff 28b52ffd 2001 090000 61", 1),
    ];
    for (frame, len) in frames {
        let frame = hex(frame);
        assert_eq!(at_once(&frame, len).map(|out| out.len()), Ok(len));
        assert_eq!(byte_by_byte(&frame), at_once(&frame, len));
        let mut out = Vec::with_capacity(len);
        let result = stream(&mut Decoder::new(), &frame, [usize::MAX; 2], &mut out);
        assert_eq!(result.map(|()| out), at_once(&frame, len));
    }
}

#[test]
fn invalid_frames_are_refused() {
    let frames = [
        ("28b52ffe 2000 010000", Error::PrefixUnknown),
        ("28b52ffd 2800 010000", Error::FrameParameterUnsupported),
        ("28b52ffd 00b0 010000", Error::WindowTooLarge),
        ("28b52ffd 210700 010000", Error::DictionaryWrong),
        (
            "28b52ffd 2328b52ffd 2002 110000 6869",
            Error::DictionaryWrong,
        ),
        ("28b52ffd 2401 090000 61 00000000", Error::ChecksumWrong),
        ("28b52ffd 0000 070000", Error::CorruptionDetected),
        ("28b52ffd 0000 050000", Error::CorruptionDetected),
        (
            "28b52ffd 2005 100000 6869 010000",
            Error::CorruptionDetected,
        ),
        ("28b52ffd 0000 0b2000 78", Error::CorruptionDetected),
        ("28b52ffd 0000 250000 0861 00 00", Error::CorruptionDetected),
        (
            "28b52ffd 0000 2d0000 130000 01 00",
            Error::DictionaryCorrupted,
        ),
        (
            "28b52ffd 0000 2d0000 560000 01 00",
            Error::LiteralsHeaderWrong,
        ),
        (
            "28b52ffd 0000 450000 12c000 8010 07 00 00",
            Error::CorruptionDetected,
        ),
        (
            "28b52ffd 0000 3d0000 12c000 8010 07 00",
            Error::CorruptionDetected,
        ),
        (
            "28b52ffd 0000 550000 728001 04207e1f02aa 00",
            Error::CorruptionDetected,
        ),
        (
            "28b52ffd 0000 450000 0800 02 00 2f430bae",
            Error::CorruptionDetected,
        ),
        (
            "28b52ffd 0000 250000 00 01 fc 01",
            Error::CorruptionDetected,
        ),
        (
            "28b52ffd 0000 250000 00 01 01 01",
            Error::CorruptionDetected,
        ),
        (
            "28b52ffd 200d 350000 106162 04 00 b0",
            Error::CorruptionDetected,
        ),
        ("28b52ffd 0000 150000 00 01", Error::SrcSizeWrong),
        ("28b52ffd 0000 150000 08 61", Error::SrcSizeWrong),
        ("28b52ffd 0000 150000 10 61", Error::CorruptionDetected),
    ];
    for (frame, error) in frames {
        assert_eq!(at_once(&hex(frame), 4096), Err(error), "{frame}");
        assert_eq!(byte_by_byte(&hex(frame)), Err(error), "{frame}");
        for step in [6, usize::MAX] {
            let result = stream(
                &mut Decoder::new(),
                &hex(frame),
                [step, 4096],
                &mut Vec::with_capacity(4096),
            );
            assert_eq!(result, Err(error), "{frame}");
        }
    }
}

#[test]
fn input_is_a_whole_number_of_frames() {
    let frame = hex("28b52ffd 2001 090000 61");
    assert_eq!(at_once(&[], 0), Ok(Vec::new()));
    assert_eq!(at_once(&frame.repeat(2), 2), Ok(b"aa".to_vec()));
    for len in 1..frame.len() {
        assert_eq!(at_once(&frame[..len], 9), Err(Error::SrcSizeWrong));
    }
    for extra in 1..12 {
        let input = [&frame[..], &[0; 12][..extra]].concat();
        assert_eq!(at_once(&input, 9), Err(Error::SrcSizeWrong));
    }
    assert_eq!(
        at_once(&hex("502a4d18 01000000"), 0),
        Err(Error::SrcSizeWrong)
    );
    let too_long = hex("502a4d18 f8ffffff");
    assert_eq!(at_once(&too_long, 0), Err(Error::FrameParameterUnsupported));
}

#[test]
fn blocks_fit_in_the_window_and_in_the_output() {
    let larger_than_window = hex("28b52ffd 2001 150000 0000");
    assert_eq!(at_once(&larger_than_window, 9), Err(Error::SrcSizeWrong));
    assert_eq!(
        byte_by_byte(&larger_than_window),
        Err(Error::CorruptionDetected)
    );
    let one_match = hex("28b52ffd 0000 080000 61 3d0000 00 01 54 000200 04");
    assert_eq!(at_once(&one_match, 4), Ok(b"aaaa".to_vec()));
    assert_eq!(at_once(&one_match, 1), Err(Error::DstSizeTooSmall));
}

#[test]
fn sizes_are_read_from_headers() {
    let known = hex("28b52ffd 6400 00 030800 61 00000000");
    let unknown = hex("28b52ffd 0000 010000");
    let skippable = hex("502a4d18 01000000 00");
    let huge = hex("28b52ffd e0 0000000000000080 010000");
    assert_eq!(frame_content_size(&known[..7]), ContentSize::Known(256));
    assert_eq!(frame_content_size(&known[..6]), ContentSize::Invalid);
    assert_eq!(frame_content_size(&unknown), ContentSize::Unknown);
    assert_eq!(frame_content_size(&skippable), ContentSize::Known(0));

    let all = |frames: &[&[u8]]| decompressed_size(&frames.concat());
    assert_eq!(all(&[]), ContentSize::Known(0));
    assert_eq!(all(&[&known, &skippable, &known]), ContentSize::Known(512));
    assert_eq!(all(&[&known, &unknown]), ContentSize::Unknown);
    assert_eq!(all(&[&known, &[0]]), ContentSize::Invalid);
    assert_eq!(all(&[&known[..14]]), ContentSize::Invalid);
    assert_eq!(all(&[&huge, &huge]), ContentSize::Invalid);
    let reserved = hex("28b52ffd e0 feffffffffffffff 010000");
    assert_eq!(all(&[&reserved]), ContentSize::Invalid);

    let lens = [0, 5, 7, 10, 14].map(|len| frame_len(&known[..len]));
    assert_eq!(
        lens,
        [5, 7, 10, 15, 15].map(|len| Ok(FrameLen::AtLeast(len)))
    );
    assert_eq!(frame_len(&known.repeat(2)), Ok(FrameLen::Complete(15)));
    assert_eq!(frame_len(&skippable[..8]), Ok(FrameLen::AtLeast(9)));
    assert_eq!(frame_len(&skippable), Ok(FrameLen::Complete(9)));
    assert_eq!(frame_len(b"\x28\xb5\x00"), Err(Error::PrefixUnknown));
}

fn step(decoder: &mut Decoder, input: &[u8], room: usize) -> (usize, usize, Result<Status>) {
    let mut out = vec![0; room];
    let mut out = Output::slice(&mut out);
    let (consumed, status) = decoder.step(input, &mut out);
    (consumed, out.written(), status)
}

#[test]
fn the_last_byte_is_consumed_when_all_output_is_out() {
    let frame = hex("28b52ffd 2003 190000 616263");
    let mut decoder = Decoder::new();
    assert_eq!(step(&mut decoder, &frame, 1), (11, 1, Ok(Status::Pending)));
    assert_eq!(
        step(&mut decoder, &frame[11..], 1),
        (0, 1, Ok(Status::Pending))
    );
    assert_eq!(step(&mut decoder, &[], 1), (0, 1, Ok(Status::Pending)));
    assert_eq!(
        step(&mut decoder, &frame[11..], 1),
        (1, 0, Ok(Status::Complete))
    );
}

#[test]
fn a_frame_waits_for_input_and_room() {
    let frame = hex("28b52ffd 0000 190000 616263");
    let wait = |decoder: &mut Decoder, room| {
        for _ in 0..20 {
            assert_eq!(step(decoder, &[], room), (0, 0, Ok(Status::Pending)));
        }
        decoder.idle_steps()
    };
    let mut decoder = Decoder::new();
    assert_eq!(step(&mut decoder, &frame[..5], 0).0, 5);
    assert_eq!(wait(&mut decoder, 0), 0);
    assert_eq!(step(&mut decoder, &frame[5..11], 0).0, 6);
    assert_eq!(wait(&mut decoder, 0), 20);
    assert_eq!(step(&mut decoder, &[], 9), (0, 2, Ok(Status::Pending)));
    assert_eq!(wait(&mut decoder, 9), 20);
    let rest = step(&mut decoder, &frame[11..], 9);
    assert_eq!(rest, (1, 1, Ok(Status::Complete)));

    assert_eq!(step(&mut decoder, &frame[..11], 9).0, 11);
    assert_eq!(wait(&mut decoder, 9), 20);
    decoder.reset_session();
    assert_eq!(decoder.idle_steps(), 0);
}

#[test]
fn an_error_undoes_the_step_and_stays() {
    let mut decoder = Decoder::new();
    let failed = (0, 0, Err(Error::CorruptionDetected));
    assert_eq!(
        step(&mut decoder, &hex("28b52ffd 0000 080000 61 070000"), 9),
        failed
    );
    let frame = hex("28b52ffd 2001 090000 61");
    assert_eq!(step(&mut decoder, &frame, 9), failed);
    assert_eq!(
        decoder.set_parameter(100, 10),
        Err(Error::CorruptionDetected)
    );
    decoder.reset_session();
    assert_eq!(step(&mut decoder, &frame, 9), (10, 1, Ok(Status::Complete)));
}

#[test]
fn an_error_undoes_a_call() {
    let mut vec = Vec::with_capacity(16);
    vec.extend(b"keep");
    let frame = hex("28b52ffd 2403 190000 616263 00000000");
    let result = decompress(&frame, &mut Output::spare_capacity(&mut vec, 9), None);
    assert_eq!(
        (result, &vec[..]),
        (Err(Error::ChecksumWrong), &b"keep"[..])
    );
}

#[test]
fn a_new_session_keeps_the_settings() -> Result<()> {
    let [.., fixture] = FIXTURES;
    let mut decoder = Decoder::new();
    decoder.load_dictionary(fixture.dictionary)?;
    decoder.set_parameter(100, 10)?;
    let larger = hex("28b52ffd 0001 010000");
    for _ in 0..2 {
        assert_eq!(step(&mut decoder, &larger, 0).2, Err(Error::WindowTooLarge));
        decoder.reset_session();
        assert_eq!(
            step(&mut decoder, fixture.frames, 700).2,
            Ok(Status::Complete)
        );
    }
    Ok(())
}

#[test]
fn a_new_session_starts_from_nothing() {
    let mut decoder = Decoder::new();
    let frame = hex("28b52ffd 0000 190000 616263");
    // Two of the three bytes of a block header
    assert_eq!(step(&mut decoder, &frame[..8], 9).0, 8);
    decoder.reset_session();
    assert_eq!(step(&mut decoder, &frame, 9), (12, 3, Ok(Status::Complete)));
}

#[test]
fn a_refused_dictionary_replaces_the_one_before() -> Result<()> {
    let [.., fixture] = FIXTURES;
    let mut decoder = Decoder::new();
    decoder.load_dictionary(fixture.dictionary)?;
    let result = decoder.load_dictionary(&fixture.dictionary[..20]);
    assert_eq!(result, Err(Error::DictionaryCorrupted));
    let result = step(&mut decoder, fixture.frames, 700).2;
    assert_eq!(result, Err(Error::DictionaryWrong));
    Ok(())
}

#[test]
fn a_window_that_stays_too_large_is_given_up() {
    // Windows of 1, 2.5 and 3.5 KiB
    let [small, medium, large] =
        ["00", "0a", "0e"].map(|window| hex(&format!("28b52ffd 00{window} 010000")));
    let frames_until_it_allocates = |decoder: &mut Decoder, frame: &[u8]| {
        (1..200).find(|_| {
            let mut out = Output::slice(&mut []);
            GRANTS.set(Some(0));
            let (_, status) = decoder.step(frame, &mut out);
            GRANTS.set(None);
            status == Err(Error::MemoryAllocation)
        })
    };

    let mut decoder = Decoder::new();
    assert_eq!(step(&mut decoder, &medium, 0).2, Ok(Status::Complete));
    assert_eq!(frames_until_it_allocates(&mut decoder, &small), None);

    assert_eq!(step(&mut decoder, &large, 0).2, Ok(Status::Complete));
    for _ in 0..100 {
        assert_eq!(step(&mut decoder, &small, 0).2, Ok(Status::Complete));
    }
    assert_eq!(step(&mut decoder, &large, 0).2, Ok(Status::Complete));
    assert_eq!(frames_until_it_allocates(&mut decoder, &large), None);
    assert_eq!(frames_until_it_allocates(&mut decoder, &small), Some(128));
}

#[test]
fn the_default_limit_is_128_mib() -> Result<()> {
    let header = |size: u32| [&hex("28b52ffd a0")[..], &size.to_le_bytes()].concat();
    let mut decoder = Decoder::new();
    let result = step(&mut decoder, &header((1 << 27) + 2), 0).2;
    assert_eq!(result, Err(Error::WindowTooLarge));
    decoder.reset_session();
    let at_limit = header((1 << 27) + 1);
    GRANTS.set(Some(0));
    let (_, status) = decoder.step(&at_limit, &mut Output::slice(&mut []));
    assert_eq!(status, Err(Error::MemoryAllocation));

    decoder.reset_session();
    decoder.set_parameter(100, 0)?;
    // It gets as far as asking for the memory.
    let at_limit = header(1 << 27);
    GRANTS.set(Some(0));
    let (_, status) = decoder.step(&at_limit, &mut Output::slice(&mut []));
    assert_eq!(status, Err(Error::MemoryAllocation));
    decoder.reset_session();
    let result = step(&mut decoder, &header((1 << 27) + 1), 0).2;
    assert_eq!(result, Err(Error::WindowTooLarge));
    Ok(())
}

#[test]
fn huffman_codes_have_at_most_12_bits() {
    let table_log = |weights| read_huffman_weights(&hex(weights)).map(|it| it.table_log);
    assert_eq!(table_log("8b cba987654321"), Ok(12));
    // The last two are compressed: 13 in the place of 12, and 16 in front of 1.
    for weights in [
        "8d cccba987654321",
        "0e 608e8c88909ce4df974838b34d52",
        "06 10f0fb6f3b05",
    ] {
        assert_eq!(table_log(weights), Err(Error::CorruptionDetected));
    }
}

#[test]
fn what_is_missing_first_decides_on_the_error() {
    // A sequence, and a stream for it without the mark at its end
    let frame = hex("28b52ffd 0000 250000 00 01 00 00");
    assert_eq!(at_once(&frame, 0), Err(Error::DstSizeTooSmall));
    assert_eq!(at_once(&frame, 1), Err(Error::CorruptionDetected));

    // A sequence that is too long, and not all in its stream
    let frame = hex("28b52ffd 802c 0b000000 450000 310f 01 54 140202 07");
    assert_eq!(at_once(&frame, 11), Err(Error::DstSizeTooSmall));
    assert_eq!(at_once(&frame, 4096), Err(Error::CorruptionDetected));

    // Blocks that end with their literals
    for blocks in ["0d0000 00", "3c0000 12c000 8010 03 00 250000 134000 03"] {
        let frame = hex(&format!("28b52ffd 0000 {blocks}"));
        assert_eq!(at_once(&frame, 9), Err(Error::CorruptionDetected));
    }
}

#[test]
fn short_content_needs_no_window() -> Result<()> {
    let mut out = Vec::new();
    let frame = hex("28b52ffd 4090 e802 431f00 61");
    Decoder::new().step_growing(&frame, &mut out, 1000).1?;
    assert_eq!(out, [b'a'; 1000]);
    Ok(())
}

#[test]
fn a_growing_output_seldom_moves() -> Result<()> {
    let frame = hex("28b52ffd 6000 03 032000 61");
    let (mut decoder, mut out, mut moves) = (Decoder::new(), Vec::new(), 0);
    for _ in 0..1000 {
        let capacity = out.capacity();
        decoder.step_growing(&frame, &mut out, usize::MAX).1?;
        moves += usize::from(out.capacity() != capacity);
    }
    assert_eq!((out.len(), moves), (1000 << 10, 11));

    let frame = hex("28b52ffd a000000100 030008 61");
    let (mut out, mut moves) = (vec![0; 2 << 20], 0);
    for _ in 0..96 {
        let capacity = out.capacity();
        decoder.step_growing(&frame, &mut out, usize::MAX).1?;
        moves += usize::from(out.capacity() != capacity);
        assert!(out.capacity() <= out.len() / 4 * 5);
    }
    assert_eq!((out.len(), moves), (8 << 20, 7));

    let mut out = Vec::with_capacity((2 << 20) + 4);
    out.resize(2 << 20, 0);
    let one_match = hex("28b52ffd 0000 080000 61 3d0000 00 01 54 000200 04");
    decoder.step_growing(&one_match, &mut out, usize::MAX).1?;
    assert_eq!((&out[2 << 20..], out.capacity()), (&b"aaaa"[..], out.len()));
    Ok(())
}

#[test]
#[cfg_attr(miri, ignore = "takes tens of megabytes")]
fn a_growing_output_takes_what_the_content_needs() -> Result<()> {
    let block = |last| hex(&format!("0{last}0010 61"));
    let blocks = |count: usize| [block(2).repeat(count - 1), block(3)].concat();
    let known = [hex("28b52ffd 8038 00000002"), blocks(256)].concat();
    let mut out = Vec::with_capacity(4 << 20);
    Decoder::new()
        .step_growing(&known, &mut out, usize::MAX)
        .1?;
    assert_eq!((out.len(), out.capacity()), (32 << 20, (32 << 20) + 32));
    // It doubles only if more follows. The last block is a literal and a match.
    let last_block = hex("450000 0861 01 54 010200 04");
    let known = [
        hex("28b52ffd 8038 04002000"),
        block(2).repeat(16),
        last_block,
    ]
    .concat();
    for (input, capacity) in [(known.clone(), 5 << 19), (known.repeat(2), 4 << 20)] {
        let mut out = Vec::with_capacity(2 << 20);
        Decoder::new()
            .step_growing(&input, &mut out, usize::MAX)
            .1?;
        assert_eq!((out.len(), out.capacity()), ((2 << 20) + 4, capacity));
    }
    let too_short = [hex("28b52ffd c038 0000000000010000"), blocks(2)].concat();
    let mut out = Vec::new();
    let (_, status) = Decoder::new().step_growing(&too_short, &mut out, usize::MAX);
    assert_eq!((status, out.len()), (Err(Error::CorruptionDetected), 0));
    assert!(out.capacity() <= 1 << 20);

    let large_window = hex("28b52ffd 0090 090000 61");
    let (_, status) = Decoder::new().step_growing(&large_window, &mut out, usize::MAX);
    assert_eq!(status, Err(Error::WindowTooLarge));
    let small_content = hex("28b52ffd 4090 e802 431f00 61");
    Decoder::new()
        .step_growing(&small_content, &mut out, usize::MAX)
        .1?;
    assert_eq!(out, [b'a'; 1000]);
    Ok(())
}

#[test]
fn what_is_lent_counts_once_it_is_committed() {
    let (mut slice, mut vec) = ([0; 4], Vec::with_capacity(9));
    for mut out in [
        Output::slice(&mut slice),
        Output::spare_capacity(&mut vec, 4),
    ] {
        assert_eq!(out.append(b"a"), 1);
        out.lend(2).copy_from_slice(b"abc");
        out.commit(1);
        assert_eq!((out.lend(9).len(), out.written(), out.room()), (4, 2, 2));
        assert_eq!(out.append(b"xyz"), 2);
        out.rewind(3);
    }
    assert_eq!((&slice, &vec[..]), (b"abxy", &b"abx"[..]));
}

#[test]
#[cfg_attr(miri, ignore = "takes megabytes")]
fn only_large_outputs_touch_pages_ahead() {
    const GROUP: usize = 128 << 10;
    // `early` is how far ahead of a group the 3 bytes start.
    for (len, early, is_ring, touched) in [
        (0, 0, false, 0),
        (1 << 20, 0, true, 0),
        (1 << 20, 0, false, 31),
        ((1 << 20) + GROUP, 2, false, 31),
        ((1 << 20) + GROUP, 3, false, 0),
    ] {
        for lends in [false, true] {
            let mut vec = vec![0xAA; 2 << 20];
            let start = len + vec.as_ptr().addr().wrapping_neg() % GROUP - early;
            vec.truncate(start);
            let mut out = if is_ring {
                Output::resume_ring(&mut vec, start, usize::MAX)
            } else {
                Output::spare_capacity(&mut vec, usize::MAX)
            };
            if lends {
                out.lend(3);
            } else {
                out.append(b"abc");
            }
            drop(out);
            // SAFETY: all of it was initialized, and nothing undoes that.
            unsafe { vec.set_len(2 << 20) };
            let changed = vec[start + 3..].iter().filter(|it| **it != 0xAA);
            assert_eq!(changed.count(), touched);
        }
    }
}

#[test]
fn a_sequence_fails_the_same_however_the_block_arrives() {
    let frames = [
        [
            hex("28b52ffd 842b 440c0000 9d0100 b5b391 27 00 15 00000000 99e9d851 2f"),
            vec![0xFF; 40],
        ]
        .concat(),
        hex("28b52ffd 8437 24000000 6d0000 b146 02 60 0b1360e0 3f277032 08 c268e2bd"),
        hex("28b52ffd 802c 0b000000 450000 310f 01 54 140202 07"),
    ];
    for frame in frames {
        for step in [1, 7, frame.len() - 1] {
            let mut out = Vec::with_capacity(1 << 17);
            let result = stream(&mut Decoder::new(), &frame, [step, usize::MAX], &mut out);
            assert_eq!(result, Err(Error::DstSizeTooSmall));
        }
    }
}

#[test]
fn long_copies_land_at_every_distance_from_their_source() {
    let from: Vec<u8> = (0..5000).map(|it: u32| (it % 251) as u8).collect();
    let mut vec = Vec::<u8>::with_capacity(4096 + 40 + from.len());
    let same_in_page = from.as_ptr().addr().wrapping_sub(vec.as_ptr().addr()) % 4096;
    for (start, lent) in (same_in_page..same_in_page + 40).zip([0, 3000].into_iter().cycle()) {
        vec.resize(start, 0);
        let mut out = Output::spare_capacity(&mut vec, usize::MAX);
        out.lend(lent);
        assert_eq!(out.append(&from), from.len());
        drop(out);
        assert!(vec[start..] == from);
        vec[start..].fill(0);
        assert_eq!(Output::slice(&mut vec[start..]).append(&from), from.len());
        assert!(vec[start..] == from);
    }
}

#[test]
fn errors_are_named_as_in_zstd() {
    let error = Error::ChecksumWrong;
    assert_eq!(
        (error as u8, error.name()),
        (22, c"ZSTD_error_checksum_wrong")
    );
    assert_eq!(error.to_string(), "Restored data doesn't match checksum");
}

#[test]
fn magic_numbers_are_told_from_their_start() {
    for bytes in ["28", "28b52f", "28b52ffd00", "5f", "502a4d18"] {
        assert!(may_start_frame(&hex(bytes)));
    }
    for bytes in ["", "29", "28b52e", "28b52ffe", "60", "502a4d19"] {
        assert!(!may_start_frame(&hex(bytes)));
    }
}

#[test]
fn the_window_is_limited() {
    let mut decoder = Decoder::new();
    for (value, result) in [
        (9, Err(Error::ParameterOutOfBound)),
        (31, Ok(())),
        (0, Ok(())),
    ] {
        assert_eq!(decoder.set_parameter(100, value), result);
    }
    for value in [32, -1] {
        assert_eq!(
            decoder.set_parameter(100, value),
            Err(Error::ParameterOutOfBound)
        );
    }
    assert_eq!(
        decoder.set_parameter(1000, 0),
        Err(Error::ParameterUnsupported)
    );

    assert_eq!(decoder.set_parameter(100, 10), Ok(()));
    let complete = (9, 0, Ok(Status::Complete));
    assert_eq!(
        step(&mut decoder, &hex("28b52ffd 0000 010000"), 0),
        complete
    );
    let larger = hex("28b52ffd 0001 010000");
    assert_eq!(
        step(&mut decoder, &larger, 0),
        (0, 0, Err(Error::WindowTooLarge))
    );
    let mut decoder = Decoder::new();
    assert_eq!(step(&mut decoder, &larger, 0), complete);
    let too_large = (0, 0, Err(Error::WindowTooLarge));
    assert_eq!(
        step(&mut decoder, &hex("28b52ffd 0089 010000"), 0),
        too_large
    );
}

#[test]
fn settings_change_between_frames() {
    let mut decoder = Decoder::new();
    assert_eq!(step(&mut decoder, &[0x28], 0), (1, 0, Ok(Status::Pending)));
    assert_eq!(decoder.set_parameter(100, 10), Err(Error::StageWrong));
    assert_eq!(decoder.load_dictionary(b"abc"), Err(Error::StageWrong));
}

#[test]
fn raw_dictionaries_are_history() -> Result<()> {
    // No literals, and 5 bytes from 2 back.
    let frame = hex("28b52ffd 0000 3d0000 00 01 54 000202 05");
    let mut out = [0; 5];
    decompress(
        &frame,
        &mut Output::slice(&mut out),
        Some(&Dictionary::raw(b"xyz")),
    )?;
    assert_eq!(&out, b"yzyzy");
    decompress(
        &frame,
        &mut Output::slice(&mut out),
        Some(&Dictionary::new(b"raw content")?),
    )?;
    assert_eq!(&out, b"ntntn");
    let short = Dictionary::new(b"z")?;
    let result = decompress(&frame, &mut Output::slice(&mut out), Some(&short));
    assert_eq!(result, Err(Error::CorruptionDetected));
    Ok(())
}

#[test]
fn all_of_a_trained_dictionary_is_history() -> Result<()> {
    let patch = hex("28b52ffd 640007 7d0000 204e455721 02001d4045d90de08740 e3faf1c7");
    let mut out = Vec::with_capacity(DICTIONARY.len());
    let dictionary = Dictionary::new(DICTIONARY)?;
    let mut spare = Output::spare_capacity(&mut out, DICTIONARY.len());
    decompress(&patch, &mut spare, Some(&dictionary))?;
    drop(spare);
    assert!(out == [&DICTIONARY[..1500], b"NEW!", &DICTIONARY[1504..]].concat());
    Ok(())
}

#[test]
fn damaged_dictionaries_are_refused() {
    for len in 8..120 {
        let result = Dictionary::new(&DICTIONARY[..len]).err();
        assert_eq!(result, Some(Error::DictionaryCorrupted));
        let result = Decoder::new().load_dictionary(&DICTIONARY[..len]);
        assert_eq!(result, Err(Error::DictionaryCorrupted));
    }
}

#[test]
fn table_and_tree_descriptions_are_read() -> Result<()> {
    let mut counts = [9; 4];
    let description = read_normalized_counts(&hex("10 a3 0f"), &mut counts)?;
    let expected = TableDescription {
        len: 3,
        max_symbol: 3,
        table_log: 5,
    };
    assert_eq!((description, counts), (expected, [16, 0, 0, 16]));
    for (src, symbols) in [("10 a3", 4), ("10 a3 0f", 3), ("0b", 4), ("", 4)] {
        let result = read_normalized_counts(&hex(src), &mut counts[..symbols]);
        assert_eq!(result, Err(Error::CorruptionDetected));
    }

    let mut counts = [0; 100];
    let description = read_normalized_counts(&hex("10e3ffffffffffffff3e"), &mut counts)?;
    assert_eq!(
        (description.max_symbol, counts[0], counts[90]),
        (90, 16, 16)
    );

    let tree = read_huffman_weights(&hex("84 43 20 10 ff"))?;
    assert_eq!((tree.symbol_count, tree.table_log, tree.len), (6, 4, 4));
    assert_eq!(tree.weights[..6], [4, 3, 2, 0, 1, 1]);
    assert_eq!(tree.rank_counts[..6], [1, 2, 1, 1, 1, 0]);
    // The last three: too many states, a weight too high for as many, and no end of weights that take no bits.
    let sources = ["", "84 43 20", "80 00", "80 20", "81 d1", "82 13 30", "01"];
    for src in sources
        .into_iter()
        .chain(["03 f2 0f 01", "05 11 f8 fd 01 01", "04 f0 03 00 04"])
    {
        assert_eq!(
            read_huffman_weights(&hex(src)).err(),
            Some(Error::CorruptionDetected)
        );
    }
    Ok(())
}

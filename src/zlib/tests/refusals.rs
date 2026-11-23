use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::fmt::Debug;

use bun_core::vec::BorrowedBuf;
use bun_zlib::deflate::{self, Flush, compress};
use bun_zlib::inflate::{Container, SPARE_CAPACITY, Status};
use bun_zlib::{Deflater, Error, Inflater, Result};

use crate::deflate::{options, raw};
use crate::samples::Random;
use crate::writer::Writer;

thread_local! {
    /// How many allocations are granted, and how many are refused after them.
    static GRANTS: Cell<Option<(usize, usize)>> = const { Cell::new(None) };
    static BYTES_IN_USE: Cell<usize> = const { Cell::new(0) };
}

struct Refusing;

// SAFETY: what is not refused is left to `System`.
unsafe impl GlobalAlloc for Refusing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        match GRANTS.get() {
            Some((0, refusals)) => {
                GRANTS.set((refusals > 1).then_some((0, refusals - 1)));
                return std::ptr::null_mut();
            }
            Some((grants, refusals)) => GRANTS.set(Some((grants - 1, refusals))),
            None => {}
        }
        BYTES_IN_USE.update(|bytes| bytes.wrapping_add(layout.size()));
        // SAFETY: the caller's promises are passed on.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        BYTES_IN_USE.update(|bytes| bytes.wrapping_sub(layout.size()));
        // SAFETY: as above.
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Refusing = Refusing;

/// Each allocation alone, and with all that follow. One that cannot be refused ends the process.
fn refuse_each_allocation<T: PartialEq + Debug>(run: impl Fn() -> Result<T>) {
    let expected = run().unwrap();
    for refusals in [1, usize::MAX] {
        for grants in 0.. {
            GRANTS.set(Some((grants, refusals)));
            let result = run();
            let was_refused = GRANTS.take().is_none_or(|it| it.1 < refusals);
            match result {
                Err(error) => assert!(was_refused && matches!(error, Error::Alloc(_)), "{grants}"),
                Ok(result) => assert!(result == expected, "{grants}"),
            }
            if !was_refused {
                assert!(grants > 0);
                break;
            }
        }
    }
}

#[test]
fn refused_memory_is_an_error_when_deflating() {
    let input = Random::new(1).mixed(200_000, 1 << 15);
    for (level, strategy) in [(0, 0), (1, 0), (2, 0), (6, 0), (9, 0), (6, 2), (6, 3)] {
        for (window_bits, memory_level) in [(9, 1), (9, 9), (15, 1), (15, 9)] {
            let options = options(level, strategy, window_bits, memory_level);
            refuse_each_allocation(|| {
                let mut out = Vec::new();
                compress(
                    &input[..40_000],
                    &mut out,
                    deflate::Container::Gzip,
                    options,
                )?;
                Ok(out)
            });
            refuse_each_allocation(|| {
                let (mut out, mut pieces) = (Vec::new(), input.chunks(70_000));
                let mut deflater = Deflater::new(deflate::Container::Zlib, options)?;
                deflater.set_dictionary(&input[..40_000])?;
                deflater.deflate_limited(&mut &input[..9], &mut out, 99, Flush::Partial)?;
                pieces.try_for_each(|it| deflater.deflate_to_vec(it, &mut out, Flush::Sync))?;
                Ok(out)
            });
        }
    }
}

#[test]
fn refused_memory_is_an_error_when_inflating() {
    let input = Random::new(1).mixed(100_000, 1 << 15);
    let stored = |is_last| {
        let mut stream = Writer::default();
        stream
            .stored(is_last, &input[..999])
            .fixed(true)
            .copy(9, 999);
        stream.end_block().finish()
    };
    let lengths = [
        [vec![8; 226], vec![9; 60]].concat(),
        [vec![4; 2], vec![5; 28]].concat(),
    ];
    let mut all_symbols = Writer::default();
    all_symbols
        .dynamic(true, &lengths[0], &lengths[1])
        .literals(b"a")
        .end_block();
    let mut long_period = Writer::default();
    long_period.fixed(true).literals(b"abcde");
    (0..300).for_each(|_| _ = long_period.copy(258, 5));
    for stream in [
        raw(&input, 0, 8),
        raw(&input, 1, 8),
        raw(&input, 6, 8),
        stored(false),
        stored(true),
        all_symbols.finish(),
        long_period.end_block().finish(),
    ] {
        for (dictionary, piece) in [(0, 500), (0, stream.len()), (100, stream.len())] {
            refuse_each_allocation(|| {
                let (mut inflater, mut out) = (Inflater::new(Container::Raw), Vec::new());
                inflater.set_dictionary(&input[..dictionary])?;
                for mut piece in stream.chunks(piece) {
                    inflater.inflate_to_vec(&mut piece, &mut out, usize::MAX)?;
                }
                Ok(out)
            });
        }
    }
}

#[test]
fn an_inflater_that_was_refused_memory_goes_on_only_after_reset() {
    let stream = raw(b"abcabcabc", 6, 8);
    let (mut inflater, mut out) = (Inflater::new(Container::Raw), Vec::with_capacity(99));
    GRANTS.set(Some((0, 1)));
    let refused = inflater.set_dictionary(b"abc").unwrap_err();
    assert_eq!(
        inflater.inflate_to_vec(&mut &stream[..], &mut out, 99),
        Err(refused)
    );
    inflater.reset();
    GRANTS.set(Some((0, 1)));
    for _ in 0..2 {
        assert_eq!(
            inflater.inflate_to_vec(&mut &stream[..], &mut out, 99),
            Err(refused)
        );
    }
    inflater.reset();
    assert_eq!(
        inflater.inflate_to_vec(&mut &stream[..], &mut out, 99),
        Ok(Status::StreamEnd)
    );
    assert_eq!(out, b"abcabcabc");
}

#[test]
fn a_vec_that_cannot_be_doubled_grows_by_an_eighth() {
    let stream = raw(&[7; 14_000], 0, 8);
    for (max, capacity, status) in [
        (usize::MAX, 94_096, Status::StreamEnd),
        (9000, 89_000, Status::NeedsOutput),
    ] {
        let (mut inflater, mut out) = (Inflater::new(Container::Raw), vec![7; 80_000]);
        GRANTS.set(Some((0, 1)));
        assert_eq!(
            inflater.inflate_to_vec(&mut &stream[..], &mut out, max),
            Ok(status)
        );
        assert_eq!(out.capacity(), capacity);
        assert!(out == vec![7; capacity.min(94_000)]);
    }
}

/// Of many lengths, each with a flush behind it.
fn messages(window_bits: u8, flush: Flush) -> (Vec<u8>, Vec<Vec<u8>>) {
    let input = Random::new(3).mixed(150_000, 1 << window_bits);
    let options = options(6, 0, window_bits, 8);
    let mut deflater = Deflater::new(deflate::Container::Raw, options).unwrap();
    let mut rest = &input[..];
    let messages = [100, 3000, 33_500, 40, 20_000, 700, 70_000, 5, 9000, 13_655].map(|len| {
        let (mut message, piece) = (Vec::new(), rest.split_off(..len).unwrap());
        deflater.deflate_to_vec(piece, &mut message, flush).unwrap();
        message
    });
    (input, messages.into())
}

fn kept_window(window_bits: u8) -> usize {
    [2560, 3072, 4096, 6144, 10_240, 14_336, 24_576, 33_856][usize::from(window_bits) - 8]
}

#[test]
fn little_more_than_the_window_is_kept_between_messages() {
    for (window_bits, piece) in (8..16).flat_map(|bits| [(bits, usize::MAX), (bits, 50)]) {
        let (input, messages) = messages(window_bits.max(9), Flush::Sync);
        let mut out = Vec::with_capacity(input.len() + 1);
        let before = BYTES_IN_USE.get();
        let mut inflater = Inflater::with_window_bits(Container::Raw, window_bits).unwrap();
        for message in &messages {
            for mut piece in message.chunks(piece) {
                let status = inflater.inflate_to_vec(&mut piece, &mut out, usize::MAX);
                assert_eq!(status, Ok(Status::NeedsInput));
            }
            assert_eq!(BYTES_IN_USE.get() - before, kept_window(window_bits));
        }
        assert!(out == input);

        out.clear();
        let status = inflater.inflate_to_vec(&mut &raw(&input, 6, 8)[..], &mut out, 50_000);
        assert_eq!(status, Ok(Status::NeedsOutput));
        inflater.reset_and_wait();
        assert_eq!(BYTES_IN_USE.get(), before);

        let status = inflater.inflate_to_vec(&mut &messages[0][..], &mut out, usize::MAX);
        assert_eq!(status, Ok(Status::NeedsInput));
        assert_eq!(BYTES_IN_USE.get() - before, kept_window(window_bits));
    }
}

/// With the list of lengths that they are built from.
const TABLES: usize = 14_464;

#[test]
fn only_the_tables_are_kept_as_well_wherever_the_input_ends() {
    for window_bits in 9..16 {
        for (flush, piece, room, tables, held_back) in [
            (Flush::Partial, usize::MAX, usize::MAX, 0, 0),
            (Flush::Block, usize::MAX, usize::MAX, TABLES, 258),
            (Flush::Sync, 7, usize::MAX, TABLES, 0),
            (Flush::Sync, 3001, usize::MAX, TABLES, 0),
            (Flush::Sync, usize::MAX, 9001, 0, 0),
        ] {
            let (input, messages) = messages(window_bits, flush);
            let mut out = Vec::with_capacity(input.len() + 1);
            let before = BYTES_IN_USE.get();
            let mut inflater = Inflater::with_window_bits(Container::Raw, window_bits).unwrap();
            for mut piece in messages.iter().flat_map(|it| it.chunks(piece)) {
                let mut status = Status::NeedsOutput;
                while status == Status::NeedsOutput {
                    let result = inflater.inflate_to_vec_and_wait(&mut piece, &mut out, room);
                    status = result.unwrap();
                }
                assert_eq!(status, Status::NeedsInput);
                assert!(BYTES_IN_USE.get() - before <= kept_window(window_bits) + tables);
            }
            assert!(input.starts_with(&out) && out.len() + held_back >= input.len());
        }
    }
}

#[test]
fn stored_and_fixed_blocks_wait_without_tables() {
    let (mut random, mut stream) = (Random::new(10), Writer::default());
    let lengths = [vec![8; 226], vec![9; 60]].concat();
    stream.dynamic(false, &lengths, &[[4; 2].as_slice(), &[5; 28]].concat());
    stream.literals(&random.bytes(4000)).end_block();
    stream.stored(false, &random.bytes(20)).fixed(true);
    stream.literals(&random.bytes(20)).copy(258, 512);
    let stream = stream.end_block().finish();
    let expected = crate::plain::inflate(&stream, &[]).bytes;
    for (cut, tables) in [(100, TABLES), (35, 0), (10, 0)] {
        let (head, tail) = stream.split_at(stream.len() - cut);
        let mut inflater = Inflater::with_window_bits(Container::Raw, 9).unwrap();
        let mut out = Vec::with_capacity(9999);
        let before = BYTES_IN_USE.get();
        let status = inflater.inflate_to_vec_and_wait(&mut &*head, &mut out, usize::MAX);
        assert_eq!(status, Ok(Status::NeedsInput));
        assert_eq!(BYTES_IN_USE.get() - before, kept_window(9) + tables);
        let status = inflater.inflate_to_vec_and_wait(&mut &*tail, &mut out, usize::MAX);
        assert!(status == Ok(Status::StreamEnd) && out == expected);
    }
}

#[test]
fn short_or_stored_messages_do_not_take_the_memory_for_long_ones() {
    for (window_bits, level, len, piece) in [
        (9, 0, 5000, 450),
        (9, 1, 1500, 9999),
        (14, 0, 60_000, 8000),
        (14, 0, 60_000, 9000),
    ] {
        let stream = raw(&Random::new(4).bytes(len), level, 8);
        let mut inflater = Inflater::with_window_bits(Container::Raw, window_bits).unwrap();
        let mut out = Vec::with_capacity(99_999);
        let before = BYTES_IN_USE.get();
        inflater.set_dictionary(&[7; 500]).unwrap();
        for mut piece in stream[..stream.len() - 1].chunks(piece) {
            let status = inflater.inflate_to_vec(&mut piece, &mut out, usize::MAX);
            assert_eq!(status, Ok(Status::NeedsInput));
            assert!(BYTES_IN_USE.get() - before <= kept_window(window_bits));
        }
    }
}

#[test]
fn reset_keeps_the_memory_for_the_next_stream() {
    let stream = raw(&Random::new(6).mixed(50_000, 512), 6, 8);
    let (mut inflater, mut out) = (Inflater::new(Container::Raw), Vec::with_capacity(50_001));
    for grants in [None, Some((0, usize::MAX))] {
        out.clear();
        GRANTS.set(grants);
        let status = inflater.inflate_to_vec(&mut &stream[..], &mut out, usize::MAX);
        GRANTS.set(None);
        assert_eq!(status, Ok(Status::StreamEnd));
        inflater.reset();
    }
}

#[test]
fn one_call_with_spare_capacity_needs_no_window() {
    let input = Random::new(6).mixed(50_000, 512);
    let stream = raw(&input, 6, 8);
    let mut out = Vec::with_capacity(input.len() + SPARE_CAPACITY);
    let (mut inflater, before) = (Inflater::new(Container::Raw), BYTES_IN_USE.get());
    let status = inflater.inflate_to_vec(&mut &stream[..], &mut out, usize::MAX);
    assert!(status == Ok(Status::StreamEnd) && out == input);
    assert_eq!(BYTES_IN_USE.get() - before, TABLES);
}

#[test]
fn nor_does_one_with_a_vec_that_has_to_grow() {
    let digits = Random::new(6).bytes(99_000).into_iter().map(|it| it % 8);
    let digits: Vec<u8> = digits.collect();
    let repeated = digits[..900].repeat(99);
    for (input, capacity) in [
        (&digits[..], 0),
        (&digits, 9000),
        (&digits[..900], 32),
        (&digits[..900], 900),
        (&repeated, 0),
    ] {
        let stream = raw(input, 6, 8);
        let mut out = Vec::with_capacity(capacity);
        let (mut inflater, before) = (Inflater::new(Container::Raw), BYTES_IN_USE.get());
        let status = inflater.inflate_to_vec(&mut &stream[..], &mut out, usize::MAX);
        assert!(status == Ok(Status::StreamEnd) && out == input);
        let grown = out.capacity() - capacity;
        assert_eq!(BYTES_IN_USE.get() - before, TABLES + grown);
    }
}

#[test]
fn a_vec_that_is_just_long_enough_is_left_as_it_is() {
    let input = Random::new(6).mixed(50_000, 512);
    let stream = raw(&input, 6, 8);
    let mut out = Vec::with_capacity(input.len());
    let status = Inflater::new(Container::Raw).inflate_to_vec(&mut &stream[..], &mut out, 99_999);
    assert!(status == Ok(Status::StreamEnd) && out == input);
    assert_eq!(out.capacity(), input.len());
}

#[test]
fn a_vec_that_cannot_grow_is_the_end_of_the_stream() {
    let stream = raw(&[7; 9000], 0, 8);
    let (mut inflater, mut out) = (Inflater::new(Container::Raw), Vec::with_capacity(5000));
    let mut input = &stream[..];
    GRANTS.set(Some((0, 2)));
    let refused = inflater.inflate_to_vec(&mut input, &mut out, usize::MAX);
    assert!(matches!(refused, Err(Error::Alloc(_))) && out == [7; 5000]);
    assert_eq!(
        inflater.inflate_to_vec(&mut input, &mut out, usize::MAX),
        refused
    );
}

#[test]
fn also_in_the_middle_of_a_match() {
    let mut stream = Writer::default();
    stream.stored(false, &[7; 4990]).fixed(true).copy(99, 80);
    let stream = stream.end_block().finish();
    // The window is allocated in the first call that has to keep something.
    for (earlier, grants) in [(0, 1), (999, 0)] {
        let (mut inflater, mut out) = (Inflater::new(Container::Raw), Vec::with_capacity(5000));
        let (mut first, mut rest) = stream.split_at(earlier);
        let status = inflater.inflate_to_vec(&mut first, &mut out, usize::MAX);
        assert_eq!(status, Ok(Status::NeedsInput));
        GRANTS.set(Some((grants, 2)));
        let refused = inflater.inflate_to_vec(&mut rest, &mut out, usize::MAX);
        assert!(matches!(refused, Err(Error::Alloc(_))) && out == [7; 5000]);
        let again = inflater.inflate_to_vec(&mut rest, &mut out, usize::MAX);
        assert_eq!((again, out.len()), (refused, 5000));
    }
}

#[test]
fn reset_and_wait_keeps_nothing_after_a_refusal() {
    let stream = raw(&Random::new(6).mixed(50_000, 512), 6, 8);
    for grants in 0..3 {
        let (mut inflater, mut out) = (Inflater::new(Container::Raw), Vec::with_capacity(50_001));
        let before = BYTES_IN_USE.get();
        GRANTS.set(Some((grants, 1)));
        let status = inflater.inflate_to_vec(&mut &stream[..], &mut out, usize::MAX);
        assert!(matches!(status, Err(Error::Alloc(_))));
        inflater.reset_and_wait();
        assert_eq!(BYTES_IN_USE.get(), before);
    }
}

#[test]
fn stored_bytes_join_what_a_small_window_has_from_its_last_lap() {
    for len in (33_000..34_200).step_by(37) {
        let mut first = Writer::default();
        first.fixed(false).literals(b"abcdefg");
        (0..len / 200).for_each(|_| _ = first.copy(200, 7));
        first.literals(&Random::new(5).bytes(len % 200)).end_block();
        let stream = first.stored(false, &[9; 300]).fixed(true).copy(258, 512);
        let stream = stream.end_block().finish();
        let expected = crate::plain::inflate(&stream, &[]).bytes;
        let mut inflater = Inflater::with_window_bits(Container::Raw, 9).unwrap();
        let (mut out, (head, tail)) = (Vec::new(), stream.split_at(stream.len() - 100));
        for mut piece in [head, tail] {
            inflater
                .inflate_to_vec(&mut piece, &mut out, usize::MAX)
                .unwrap();
        }
        inflater.reset_and_wait();
        assert!(out == expected, "{len}");
        let status = inflater.inflate_to_vec(&mut &stream[..], &mut out, usize::MAX);
        assert!(status == Ok(Status::StreamEnd) && out[expected.len()..] == expected);
    }
}

#[test]
fn refused_memory_is_an_error_between_messages_or_not_needed() {
    let (_, messages) = messages(10, Flush::Sync);
    refuse_each_allocation(|| {
        let (mut inflater, mut out) = (Inflater::with_window_bits(Container::Raw, 10)?, Vec::new());
        for message in &messages {
            inflater.inflate_to_vec(&mut &message[..], &mut out, usize::MAX)?;
        }
        Ok(out)
    });
    refuse_each_allocation(|| {
        let (mut inflater, mut out) = (Inflater::with_window_bits(Container::Raw, 10)?, Vec::new());
        for mut piece in messages.iter().flat_map(|it| it.chunks(1000)) {
            inflater.inflate_to_vec_and_wait(&mut piece, &mut out, usize::MAX)?;
        }
        Ok(out)
    });
}

#[test]
fn refused_memory_is_an_error_where_a_small_window_needs_more() {
    let bytes = Random::new(7).bytes(3100);
    for len in (2420..2450).chain(3060..3090) {
        let mut stream = Writer::default();
        stream.stored(false, &bytes[..len]).fixed(true).copy(9, len);
        let stream = stream.end_block().finish();
        let expected = [&bytes[..len], &bytes[..9]].concat();
        refuse_each_allocation(|| {
            let mut room = [0; 3200];
            let mut inflater = Inflater::with_window_bits(Container::Raw, 9)?;
            let (mut input, (first, rest)) = (&stream[..], room.split_at_mut(1));
            inflater.inflate(&mut input, BorrowedBuf::from(first).unfilled())?;
            let status = inflater.inflate(&mut input, BorrowedBuf::from(rest).unfilled())?;
            assert!(status == Status::StreamEnd && room.starts_with(&expected));
            Ok(())
        });
    }
}

#[test]
fn spare_capacity_is_enough_behind_the_last_block_too() {
    let mut stream = Writer::default();
    stream.fixed(false).literals(&[7; 900]).end_block();
    // An empty fixed block does not get as far as the output.
    let only_the_end: Vec<_> = (0..257).map(|it| u8::from(it == 256)).collect();
    stream.dynamic(true, &only_the_end, &[1]);
    let stream = stream.end_block().finish();
    let mut out = Vec::with_capacity(900 + SPARE_CAPACITY);
    let status = Inflater::new(Container::Raw).inflate_to_vec(&mut &stream[..], &mut out, 9999);
    assert!(status == Ok(Status::StreamEnd) && out == [7; 900]);
    assert_eq!(out.capacity(), 900 + SPARE_CAPACITY);
}

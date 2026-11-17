use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::fmt::Debug;

use bun_zlib::deflate::{self, Flush, compress};
use bun_zlib::inflate::{Container, Status};
use bun_zlib::{Deflater, Error, Inflater, Result};

use crate::deflate::{options, raw};
use crate::samples::Random;
use crate::writer::Writer;

thread_local! {
    /// How many allocations are granted, and how many are refused after them.
    static GRANTS: Cell<Option<(usize, usize)>> = const { Cell::new(None) };
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

/// Once for each allocation, from which on all are refused. One that cannot be refused ends the process.
fn refuse_each_allocation<T: PartialEq + Debug>(run: impl Fn() -> Result<T>) {
    let expected = run().unwrap();
    for grants in 0.. {
        GRANTS.set(Some((grants, usize::MAX)));
        let result = run();
        let was_refused = matches!(GRANTS.take(), Some((0, ..usize::MAX)));
        match result {
            Err(error) => assert!(was_refused && matches!(error, Error::Alloc(_)), "{grants}"),
            Ok(result) => assert_eq!(result, expected),
        }
        if !was_refused {
            assert!(grants > 0);
            return;
        }
    }
}

#[test]
fn refused_memory_is_an_error_when_deflating() {
    let input = Random::new(1).mixed(300_000, 1 << 15);
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
                let (mut out, mut pieces) = (Vec::new(), input.chunks(100_000));
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
        stream.stored(is_last, &input[..999]).fixed(true).copy(9, 9);
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

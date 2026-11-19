//! One test, as what refuses memory goes for all threads. The length and the hash are those of zstd 1.5.7.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use bun_zstd_decoder::{Error, Result, Status};
use bun_zstd_encoder::EndDirective::{Continue, End};
use common::*;

/// How many allocations are granted before one is refused.
static GRANTS: AtomicUsize = AtomicUsize::new(usize::MAX);
/// The threads of `std` ask for no more, and cannot do without.
const ALWAYS_GRANTED: usize = 64;

struct Refusing;

// SAFETY: what is not refused is left to `System`.
unsafe impl GlobalAlloc for Refusing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.size() > ALWAYS_GRANTED && GRANTS.fetch_sub(1, Ordering::SeqCst) == 0 {
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

#[test]
fn workers() -> Result<()> {
    let input = sample(600_000);
    let mut out = Vec::with_capacity(4 * input.len());
    let parameters = [
        (WINDOW_LOG, 18),
        (LONG_DISTANCE, 1),
        (CHECKSUM, 1),
        (WORKERS, 2),
        (JOB_LEN, 1),
    ];
    let expected = (681_380, 0xFDEA_E3EA);

    let mut encoder = encoder(&parameters, DICTIONARY)?;
    three_frames(&mut encoder, &input, &mut out)?;
    assert_eq!(summary(&out), expected);

    // Once the end is in the making, the frame does not continue.
    let before = step(&mut encoder, &input, 0, End);
    assert_eq!(before, (input.len(), 0, Ok(Status::Pending)));
    let after = step(&mut encoder, &[], 100, Continue);
    assert_eq!(after, (0, 0, Err(Error::StageWrong)));

    // Jobs that nobody waits for any more
    let mut encoder = common::encoder(&parameters, &[])?;
    write(&mut encoder, &input, Continue, 1, &mut out)?;

    // A section that is full is not the last one, also if it has to wait for its turn until the end is asked for.
    let mut waiting = common::encoder(&[(WORKERS, 1), (JOB_LEN, 1)], &[])?;
    let sections = input[..1 << 16].repeat(32);
    let taken = step(&mut waiting, &sections, 0, Continue);
    assert_eq!(taken, (sections.len(), 0, Ok(Status::Pending)));
    let more = step(&mut waiting, b"a", 0, Continue);
    assert_eq!(more, (0, 0, Ok(Status::Pending)));
    out.clear();
    write(&mut waiting, &[], End, usize::MAX, &mut out)?;
    assert_eq!(summary(&out), (26581, 0x0FD7_92CD));

    drop((encoder, waiting));
    for grants in 0.. {
        let mut encoder = common::encoder(&parameters, DICTIONARY)?;
        GRANTS.store(grants, Ordering::SeqCst);
        let result = three_frames(&mut encoder, &input, &mut out);
        if GRANTS.swap(usize::MAX, Ordering::SeqCst) <= grants {
            assert_eq!((result, summary(&out)), (Ok(()), expected));
            break;
        }
        assert_eq!(result, Err(Error::MemoryAllocation));
    }
    Ok(())
}

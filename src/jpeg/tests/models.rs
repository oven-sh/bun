//! Files that no encoder makes, on all targets, and memory that is refused at a given point.
// They would take Miri hours.
#![cfg(not(miri))]

use bun_jpeg::{Decoder, Error, Result, encode};
use bun_simd::target::{Target, reset_cpu, set_cpu};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

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

struct Noise(u32);

impl Noise {
    fn below(&mut self, end: u32) -> u32 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.0 >> 8) % end
    }
}

const SAMPLINGS: [&[u8]; 10] = [
    &[0x11],
    &[0x11, 0x11, 0x11],
    &[0x21, 0x11, 0x11],
    &[0x22, 0x11, 0x11],
    &[0x12, 0x11, 0x11],
    &[0x41, 0x11, 0x11],
    &[0x22, 0x21, 0x12],
    &[0x42, 0x11, 0x11],
    &[0x11, 0x22, 0x11],
    &[0x22, 0x11, 0x11, 0x22],
];

/// One coefficient in `rare` is not zero, and has up to `bits` bits.
fn handmade(
    sampling: &[u8],
    [width, height]: [u16; 2],
    rare: u32,
    bits: u32,
    step: u32,
) -> Vec<u8> {
    let (mut noise, count) = (Noise(u32::from(width) + rare), sampling.len() as u8);
    let mut file = vec![0xff, 0xd8, 0xff, 0xdb, 0, 67, 0];
    file.extend((0..64).map(|_| 1 + noise.below(step) as u8));
    file.extend([0xff, 0xc1, 0, 8 + 3 * count, 8]);
    file.extend([height, width].map(u16::to_be_bytes).as_flattened());
    file.push(count);
    file.extend((1..).zip(sampling).flat_map(|(id, &it)| [id, it, 0]));
    // The code of a symbol is its number, in 5 bits or in 9.
    for (class, len, symbols) in [(0, 5, 16), (0x10, 9, 255)] {
        file.extend([0xff, 0xc4]);
        file.extend((19 + u16::from(symbols)).to_be_bytes());
        file.push(class);
        file.extend((1..=16).map(|it| if it == len { symbols } else { 0 }));
        file.extend(0..symbols);
    }
    file.extend([0xff, 0xda, 0, 6 + 2 * count, count]);
    file.extend((1..=count).flat_map(|id| [id, 0]));
    file.extend([0, 63, 0]);

    let (mut pending, mut pending_len) = (0_u64, 0);
    let mut put = |value: u32, len: u32| {
        (pending, pending_len) = (pending << len | u64::from(value), pending_len + len);
        while pending_len >= 8 {
            pending_len -= 8;
            let byte = (pending >> pending_len) as u8;
            file.extend(&[byte, 0][..1 + usize::from(byte == 255)]);
        }
    };
    let units = |len: u16, factor: u8| len.div_ceil(8 * u16::from(factor));
    let most = sampling.iter().max().unwrap();
    let mut last = [0; 4];
    for _ in 0..units(width, most >> 4) * units(height, most & 15) {
        for (factors, last) in sampling.iter().zip(&mut last) {
            for _ in 0..(factors >> 4) * (factors & 15) {
                let first = noise.below(2 << bits.min(10)) as i32 - (1 << bits.min(10));
                let difference = first - std::mem::replace(last, first);
                let len = 32 - difference.unsigned_abs().leading_zeros();
                put(len, 5);
                put((difference + (difference >> 31)) as u32 % (1 << len), len);
                let (mut zeros, end) = (0, noise.below(100).min(63));
                for _ in 0..end {
                    if noise.below(rare) != 0 {
                        zeros += 1;
                        continue;
                    }
                    (0..zeros / 16).for_each(|_| put(0xf0, 9));
                    let len = bits - noise.below(bits.min(3));
                    put((zeros % 16) << 4 | len, 9);
                    put(noise.below(1 << len), len);
                    zeros = 0;
                }
                if zeros != 0 || end < 63 {
                    put(0, 9);
                }
            }
        }
    }
    put(127, 7);
    file.extend([0xff, 0xd9]);
    file
}

fn decode(file: &[u8], eighths: u8) -> Result<Vec<u8>> {
    Ok(Decoder::new(file)?.decode(eighths)?.rgba)
}

fn checksum(all: impl Iterator<Item = Result<Vec<u8>>>) -> u64 {
    all.flat_map(Result::unwrap).fold(0, |sum, byte| {
        (sum ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3)
    })
}

#[test]
fn all_targets_compute_as_recorded() {
    /// For each scale.
    const DECODED: [u64; 8] = [
        15743601822941763740,
        16502997668221030971,
        362140896952207475,
        17756117549895758462,
        3276280959555890203,
        12207723581573916250,
        9814106646496953643,
        9060786259739186454,
    ];
    /// Sequential, progressive, and all differences between the channels.
    const ENCODED: [u64; 3] = [
        7211205825736633479,
        6194059263543628808,
        12590485651827366021,
    ];
    let mut files = Vec::new();
    for sampling in SAMPLINGS {
        files.push(handmade(sampling, [500, 300], 30, 9, 1));
        files.push(handmade(sampling, [1100, 20], 4, 5, 4));
        files.push(handmade(sampling, [200, 40], 200, 14, 255));
        files.push(handmade(sampling, [90, 40], 1, 12, 9));
        files.push(handmade(sampling, [400, 200], 40, 2, 99));
        files.push(handmade(sampling, [400, 300], 25, 1, 99));
        files.extend((1..70).map(|width| handmade(sampling, [width, 1 + width % 35], 9, 4, 9)));
    }
    let mut noise = Noise(1);
    let rgba: Vec<u8> = (0..4 << 18).map(|_| noise.below(256) as u8).collect();
    let extremes: Vec<u8> = rgba.iter().map(|it| it % 2 * 255).collect();
    let color = |i: u32| {
        let [r, b] = [i % 1024 / 2, i / 2048];
        let least = r.min(b).min(255);
        [r - least, 255 - least, b - least, 255].map(|it| it.min(255) as u8)
    };
    let colors: Vec<u8> = (0..1 << 20).flat_map(color).collect();
    let small = (1..=100).map(|it| (it, 1 + it % 37, it as u8));
    let sizes: Vec<_> = small.chain([(1100, 18, 90), (512, 512, 100)]).collect();
    for &target in Target::ALL {
        if !set_cpu(target) {
            continue;
        }
        let decoded = [1, 2, 3, 4, 5, 6, 7, 8]
            .map(|eighths| checksum(files.iter().map(|it| decode(it, eighths))));
        let [a, b] = [(&rgba, false), (&extremes, true)].map(|(rgba, is_progressive)| {
            checksum(sizes.iter().map(|&(width, height, quality)| {
                let rgba = &rgba[..(4 * width * height) as usize];
                encode(rgba, width, height, quality, is_progressive, None)
            }))
        });
        let c = checksum([encode(&colors, 1024, 1024, 100, false, None)].into_iter());
        assert_eq!((decoded, [a, b, c]), (DECODED, ENCODED), "{target:?}");
    }
    reset_cpu();
}

fn refuse_each_allocation(run: impl Fn() -> Result<Vec<u8>>) {
    let granted = run();
    assert!(granted.is_ok());
    for grants in 0.. {
        GRANTS.set(Some(grants));
        let result = run();
        if GRANTS.take().is_some() {
            break;
        }
        assert!(result == granted || matches!(result, Err(Error::Alloc(_))));
    }
}

#[test]
fn a_refusal_is_an_error() {
    for sampling in SAMPLINGS {
        let file = handmade(sampling, [70, 35], 9, 4, 9);
        (1..=8).for_each(|eighths| refuse_each_allocation(|| decode(&file, eighths)));
    }
    for is_progressive in [false, true] {
        refuse_each_allocation(|| encode(&[9; 4 * 70 * 35], 70, 35, 80, is_progressive, None));
    }
}

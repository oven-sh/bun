//! `Buffer.swap16` and so on, and the mask of WebSocket frames.

use bun_simd::prelude::*;
use core::{cell::Cell, hint::select_unpredictable, sync::atomic::AtomicU8};

#[simd]
fn swap_vector<T: Unsigned, W: Width>(mut data: &[AtomicU8]) {
    let v = Simd::<u8, W, S>::load(data).bitcast::<T>();
    v.swap_bytes().bitcast::<u8>().store_at(&mut data, 0);
}

/// It stays in a general register.
#[simd]
fn swap_word<U: Unsigned, W: Width>(mut data: &[AtomicU8], swap: impl Fn(U) -> U) {
    let word = swap(Simd::<u8, W, S>::load(data).bitcast::<U>().lane::<0>());
    Simd::<U, W, S>::splat(word)
        .bitcast::<u8>()
        .store_at(&mut data, 0);
}

/// From the part for the bit `n` of the length on, or `unused` if the bit is clear. It takes no branch.
#[inline(always)]
fn part<'a>(data: &'a [AtomicU8], n: usize, unused: &'a [AtomicU8]) -> &'a [AtomicU8] {
    select_unpredictable(
        data.len() & n != 0,
        &data[data.len() & !(2 * n - 1)..],
        unused,
    )
}

/// What is behind the last multiple of 16 bytes.
#[kernel]
#[inline(always)]
fn swap_words<T: Unsigned>(data: &[AtomicU8]) {
    let unused = &[const { AtomicU8::new(0) }; 8];
    swap_word::<u64, B8, S>(part(data, 8, unused), |it| match size_of::<T>() {
        2 => (it & 0x00ff_00ff_00ff_00ff) << 8 | it >> 8 & 0x00ff_00ff_00ff_00ff,
        4 => it.swap_bytes().rotate_left(32),
        _ => it.swap_bytes(),
    });
    if data.len().is_multiple_of(8) {
        return;
    }
    if size_of::<T>() <= 4 {
        swap_word::<u32, B4, S>(part(data, 4, unused), |it| {
            it.swap_bytes().rotate_left(8 * size_of::<T>() as u32)
        });
    }
    if size_of::<T>() == 2 {
        swap_word::<u16, B2, S>(part(data, 2, unused), u16::swap_bytes);
    }
}

/// For fewer than 32 bytes.
#[kernel]
#[inline(always)]
fn swap_few<T: Unsigned>(data: &[AtomicU8]) {
    if has!(sse2) {
        let unused = &[const { AtomicU8::new(0) }; 16];
        swap_vector::<T, B16, S>(part(data, 16, unused));
    } else if data.len() >= 16 {
        swap_vector::<T, B16, S>(data);
    }
    swap_words::here::<T, S>(data)
}

/// For fewer than 64.
#[kernel]
#[inline(always)]
fn swap_some<T: Unsigned>(data: &[AtomicU8]) {
    let unused = &[const { AtomicU8::new(0) }; 32];
    swap_vector::<T, B32, S>(part(data, 32, unused));
    swap_few::here::<T, S>(&data[data.len() & 32..])
}

#[kernel]
fn swap_many<T: Unsigned>(data: &[AtomicU8]) {
    let mut whole = &data[..data.len() / size_of::<T>() * size_of::<T>()];
    // Smaller loads wait less for what was just written.
    if u8xN::LANES > 32 && data.len() < 384 {
        return u8x32::over(whole).map_into(&mut whole, |v| {
            v.bitcast::<T>().swap_bytes().bitcast::<u8>()
        });
    }
    over(whole).map_into(&mut whole, |v: u8xN<S>| {
        v.bitcast::<T>().swap_bytes().bitcast::<u8>()
    })
}

/// Reverses the bytes of each `T`. What is left at the end is not changed.
#[inline(always)]
pub(crate) fn swap_bytes<T: Unsigned>(data: &[AtomicU8]) {
    if cfg!(target_arch = "x86_64") && data.len() < 64 {
        swap_some::baseline::<T>(data)
    } else if data.len() < 32 {
        swap_few::baseline::<T>(data)
    } else {
        swap_many::<T>(data)
    }
}

/// `to` can be `from`.
#[simd]
fn fill_with_mask<E: Readable<u8>>(mask: [u8; 4], mut to: impl Sink<u8>, from: &[E]) {
    let whole = from.len() & !3;
    for at in 0..from.len() & 3 {
        to.part(..)
            .write(whole + at, [from[whole + at].value() ^ mask[at]]);
    }
    let mask = u8xN::repeat(&mask);
    over(&from[..whole]).map_into(&mut to, |v| v ^ mask);
}

#[kernel]
fn mask_into(mask: [u8; 4], to: &mut [u8], from: &[u8]) {
    fill_with_mask(mask, to, from)
}

#[kernel]
fn mask_in_place(mask: [u8; 4], data: &mut [u8]) {
    let data = Cell::from_mut(data).as_slice_of_cells();
    fill_with_mask(mask, data, data)
}

/// With `skip_mask`, it is a copy.
pub fn fill_with_skip_mask(mask: [u8; 4], output: &mut [u8], input: &[u8], skip_mask: bool) {
    let output = &mut output[..input.len()];
    if skip_mask {
        return output.copy_from_slice(input);
    }
    mask_into(mask, output, input)
}

pub fn fill_with_skip_mask_inplace(mask: [u8; 4], buf: &mut [u8], skip_mask: bool) {
    if skip_mask {
        return;
    }
    // A load waits for a store with a mask.
    if cfg!(target_arch = "x86_64") && buf.len() < 128 {
        return mask_in_place::baseline(mask, buf);
    }
    mask_in_place(mask, buf)
}

// What the files sinks*.rs share.
use bun_simd::{mem::*, target::*, text::*, *};
use core::cell::Cell;
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

fn inputs() -> impl Iterator<Item = (Vec<u8>, Vec<u8>)> {
    (0..if cfg!(miri) { 20 } else { 300 })
        .chain([1000, 2049].into_iter().filter(|_| !cfg!(miri)))
        .map(|n| ((0..n).map(|i| ((i * 37 + n) % 127) as u8).collect(), (0..n).map(|i| (i * 11 % 101) as u8).collect()))
}
fn atomics(x: &[u8]) -> Vec<AtomicU8> {
    x.iter().map(|&it| AtomicU8::new(it)).collect()
}
fn cells(x: &[u8]) -> Vec<Cell<u8>> {
    x.iter().map(|&it| Cell::new(it)).collect()
}

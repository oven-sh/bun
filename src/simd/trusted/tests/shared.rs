//! Each access touches its bytes and no others.
#![cfg(all(unix, not(miri), any(target_arch = "x86_64", target_arch = "aarch64")))]
#![feature(portable_simd)]
use bun_simd_trusted::{Features, SharedOutU8, SharedU8, copy_to_shared, detected, shared::*};
use core::simd::Simd;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

const ROOM: usize = 1 << 16;

fn fenced() -> &'static mut [AtomicU8] {
    unsafe extern "C" {
        fn mmap(
            at: usize,
            len: usize,
            protection: i32,
            flags: i32,
            fd: i32,
            offset: i64,
        ) -> *mut AtomicU8;
        fn mprotect(at: *mut AtomicU8, len: usize, protection: i32) -> i32;
    }
    let is_linux = cfg!(any(target_os = "linux", target_os = "android"));
    let private_anonymous = if is_linux { 0x22 } else { 0x1002 };
    // SAFETY: a new mapping, which is never unmapped. The slice is the part that is accessible.
    unsafe {
        let all = mmap(0, 3 * ROOM, 0, private_anonymous, -1, 0);
        assert_eq!(mprotect(all.add(ROOM), ROOM, 3), 0);
        core::slice::from_raw_parts_mut(all.add(ROOM), ROOM)
    }
}

fn reset(room: &[AtomicU8]) {
    room.iter()
        .enumerate()
        .for_each(|(i, byte)| byte.store((i % 251) as u8, Relaxed));
}

fn changed(room: &[AtomicU8]) -> Vec<usize> {
    (0..ROOM)
        .filter(|&i| room[i].load(Relaxed) != (i % 251) as u8)
        .collect()
}

type Group<B, const N: usize> = [[B; N]; 3];

fn group<B, const N: usize>(bytes: &[B]) -> &Group<B, N> {
    bytes.as_chunks().0.first_chunk().unwrap()
}

fn whole<T: AsBytes<N>, const N: usize>(
    feature: &str,
    loads: [unsafe fn(&Group<SharedU8, N>) -> T; 3],
    stores: [unsafe fn(T, &Group<SharedOutU8, N>); 2],
) {
    if !detected().contains(Features::named(&[feature])) {
        return;
    }
    let room = fenced();
    for start in [0, 1, 77, ROOM - 3 * N - 1, ROOM - 3 * N] {
        let (from, to) = (
            group(SharedU8::from_slice(&room[start..])),
            group(SharedOutU8::from_slice(&room[start..])),
        );
        reset(room);
        // SAFETY: the CPU has the feature.
        let loaded = loads.map(|load| unsafe { load(from) }.to_bytes());
        for store in stores {
            // SAFETY: the CPU has the feature.
            unsafe { store(T::from_bytes([255; N]), to) };
        }
        let before: Vec<_> = (start..start + 3 * N).map(|i| (i % 251) as u8).collect();
        assert_eq!(loaded.as_flattened(), before);
        let stored = (start..start + N).chain(start + 2 * N..start + 3 * N);
        assert_eq!(changed(room), stored.collect::<Vec<_>>());
    }
}

trait AsBytes<const N: usize> {
    fn from_bytes(bytes: [u8; N]) -> Self;
    fn to_bytes(self) -> [u8; N];
}

impl AsBytes<4> for u32 {
    fn from_bytes(bytes: [u8; 4]) -> Self {
        Self::from_ne_bytes(bytes)
    }
    fn to_bytes(self) -> [u8; 4] {
        self.to_ne_bytes()
    }
}

impl AsBytes<8> for u64 {
    fn from_bytes(bytes: [u8; 8]) -> Self {
        Self::from_ne_bytes(bytes)
    }
    fn to_bytes(self) -> [u8; 8] {
        self.to_ne_bytes()
    }
}

impl<const N: usize> AsBytes<N> for Simd<u8, N> {
    fn from_bytes(bytes: [u8; N]) -> Self {
        bytes.into()
    }
    fn to_bytes(self) -> [u8; N] {
        self.into()
    }
}

const BASELINE: &str = if cfg!(target_arch = "x86_64") {
    "sse2"
} else {
    "neon"
};

#[test]
fn bytes_4() {
    let loads = [load4::<3, 0>, load4::<3, 1>, load4::<3, 2>];
    whole(BASELINE, loads, [store4::<3, 0>, store4::<3, 2>]);
}

#[test]
fn bytes_8() {
    let loads = [load8::<3, 0>, load8::<3, 1>, load8::<3, 2>];
    whole(BASELINE, loads, [store8::<3, 0>, store8::<3, 2>]);
}

#[test]
fn bytes_16() {
    let loads = [load16::<3, 0>, load16::<3, 1>, load16::<3, 2>];
    whole(BASELINE, loads, [store16::<3, 0>, store16::<3, 2>]);
}

#[cfg(target_arch = "x86_64")]
#[test]
fn bytes_16_vex() {
    let loads = [load16_vex::<3, 0>, load16_vex::<3, 1>, load16_vex::<3, 2>];
    whole("avx", loads, [store16_vex::<3, 0>, store16_vex::<3, 2>]);
}

#[cfg(target_arch = "x86_64")]
#[test]
fn bytes_32() {
    let loads = [load32::<3, 0>, load32::<3, 1>, load32::<3, 2>];
    whole("avx", loads, [store32::<3, 0>, store32::<3, 2>]);
}

#[cfg(target_arch = "x86_64")]
#[test]
fn bytes_64() {
    let loads = [load64::<3, 0>, load64::<3, 1>, load64::<3, 2>];
    whole("avx512f", loads, [store64::<3, 0>, store64::<3, 2>]);
}

#[test]
fn bytes_2() {
    let room = fenced();
    reset(room);
    for start in [0, 1, 77, ROOM - 3, ROOM - 2] {
        let two = SharedU8::from_slice(&room[start..]).first_chunk().unwrap();
        let want = [start, start + 1].map(|i| (i % 251) as u8);
        assert_eq!(SharedU8::get_two(two), want);
    }
}

#[test]
fn copies() {
    let (other, room) = (fenced(), fenced());
    reset(other);
    let before = AtomicU8::get_mut_slice(other).to_vec();
    for len in (0..300).chain([1000, 4096, 5000, ROOM / 2]) {
        let end = ROOM - len;
        for (from, to) in [(0, end), (end, 0), (1, 77), (77, 1), (77, 77)] {
            let mut want = before.clone();
            want.copy_within(from..from + len, to);
            for (is_same, more) in [(false, [0, 9]), (false, [9, 0]), (true, [0, 0])] {
                AtomicU8::get_mut_slice(room).copy_from_slice(&before);
                let source = if is_same { &*room } else { &*other };
                let [from, to] = [(from, more[0]), (to, more[1])]
                    .map(|(start, more)| start..ROOM.min(start + len + more));
                let shorter = from.len().min(to.len());
                let (from, to) = (&source[from], &room[to]);
                let copied =
                    copy_to_shared(SharedU8::from_slice(from), SharedOutU8::from_slice(to));
                assert_eq!((copied, shorter), (len, len));
                assert!(AtomicU8::get_mut_slice(room) == want);
            }
        }
    }
}

fn masked<const N: usize>(
    feature: &str,
    are_last: bool,
    load: unsafe fn(&[SharedU8]) -> Simd<u8, N>,
    store: unsafe fn(Simd<u8, N>, &[SharedOutU8]),
) {
    if !detected().contains(Features::named(&[feature])) {
        return;
    }
    let room = fenced();
    for len in 0..N + 6 {
        for start in [0, 77, ROOM - len] {
            let bytes = &room[start..start + len];
            let (text, to) = (SharedU8::from_slice(bytes), SharedOutU8::from_slice(bytes));
            reset(room);
            let skipped = if are_last { N - len.min(N) } else { 0 };
            let want = |byte: fn(usize) -> u8| -> [u8; N] {
                core::array::from_fn(|lane| match lane.wrapping_sub(skipped) {
                    i if i < len => byte(start + i),
                    _ => 0,
                })
            };
            let before = want(|i| (i % 251) as u8);
            // SAFETY: the CPU has the feature.
            unsafe {
                assert_eq!(load(text).to_array(), before);
                store(Simd::splat(255), to);
                // With what was stored still in a register.
                assert_eq!(load(text).to_array(), want(|_| 255));
            }
            assert_eq!(
                changed(room),
                (start..start + len.min(N)).collect::<Vec<_>>()
            );
            // SAFETY: the CPU has the feature.
            unsafe { store(before.into(), to) };
            assert_eq!(changed(room), []);
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[test]
fn masked_64() {
    masked(
        "avx512bw",
        false,
        load64_masked::<false>,
        store64_masked::<false>,
    );
    masked(
        "avx512bw",
        true,
        load64_masked::<true>,
        store64_masked::<true>,
    );
}

#[cfg(target_arch = "aarch64")]
#[test]
fn masked_16() {
    masked("sve", false, load16_masked, store16_masked);
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
fn last_lanes_of_plain<T: core::simd::SimdElement + From<u8> + Eq + core::fmt::Debug>() {
    let room = fenced();
    let size = size_of::<T>();
    // SAFETY: nothing else refers to the room, which is aligned to a page and has zeros.
    let room: &mut [T] =
        unsafe { core::slice::from_raw_parts_mut(room.as_ptr().cast_mut().cast(), ROOM / size) };
    let byte = |i: usize| {
        if i.is_multiple_of(size) {
            1 + i as u8
        } else {
            0
        }
    };
    let bytes = Simd::from_array(core::array::from_fn(byte));
    for len in 0..64 / size + 3 {
        let (end, skipped) = (room.len(), 64 - (len * size).min(64));
        for start in [0, 77, end - len] {
            let to = bun_simd_trusted::Out::from(&mut room[start..start + len]);
            let filled = to.fill_from_last(bytes);
            let want = (skipped..64).step_by(size).map(|i| T::from(byte(i)));
            assert_eq!(filled, want.collect::<Vec<_>>());
            let (fit, mut want) = (filled.len(), bytes);
            want[..skipped].fill(0);
            assert_eq!(load64_masked::<true>(&room[start..start + len]), want);
            room[start..start + fit].fill(T::from(0));
            assert!(room.iter().all(|&lane| lane == T::from(0)));
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[test]
fn last_lanes() {
    if detected().contains(Features::named(&["avx512bw"])) {
        // SAFETY: the CPU has the feature.
        unsafe {
            last_lanes_of_plain::<u8>();
            last_lanes_of_plain::<u16>();
            last_lanes_of_plain::<u32>();
            last_lanes_of_plain::<u64>();
        }
    }
}

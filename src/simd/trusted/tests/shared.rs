//! Each access touches its bytes and no others.
#![cfg(all(unix, not(miri), any(target_arch = "x86_64", target_arch = "aarch64")))]
#![feature(portable_simd)]
use bun_simd_trusted::{Features, detected};
use core::simd::{Simd, ToBytes};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

const ROOM: usize = 1 << 16;

fn fenced() -> &'static [AtomicU8] {
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
        core::slice::from_raw_parts(all.add(ROOM), ROOM)
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

macro_rules! whole {
    ($($feature:literal $T:ty: $load:ident $store:ident;)*) => {$(
        #[test]
        #[allow(unused_unsafe)]
        fn $load() {
            use bun_simd_trusted::shared::{$load, $store};
            const N: usize = size_of::<$T>();
            if !detected().contains(Features::named(&[$feature])) {
                return;
            }
            let room = fenced();
            for start in [0, 1, 77, ROOM - 3 * N - 1, ROOM - 3 * N] {
                let group: &[[AtomicU8; N]; 3] = room[start..].as_chunks().0.first_chunk().unwrap();
                reset(room);
                let ones = <$T>::from_ne_bytes([255; N].into());
                // SAFETY: the CPU has the feature.
                let loaded = unsafe {
                    let loaded = [$load::<3, 0>(group), $load::<3, 1>(group), $load::<3, 2>(group)];
                    $store::<3, 0>(ones, group);
                    $store::<3, 2>(ones, group);
                    loaded
                };
                let loaded = loaded.map(|v| <[u8; N]>::from(v.to_ne_bytes()));
                let before: Vec<_> = (start..start + 3 * N).map(|i| (i % 251) as u8).collect();
                assert_eq!(loaded.as_flattened(), before);
                let stored = (start..start + N).chain(start + 2 * N..start + 3 * N);
                assert_eq!(changed(room), stored.collect::<Vec<_>>());
            }
        }
    )*};
}

#[cfg(target_arch = "x86_64")]
whole! {
    "sse2" u32: load4 store4;
    "sse2" u64: load8 store8;
    "sse2" Simd<u8, 16>: load16 store16;
    "avx" Simd<u8, 16>: load16_vex store16_vex;
    "avx" Simd<u8, 32>: load32 store32;
    "avx512f" Simd<u8, 64>: load64 store64;
}

#[cfg(target_arch = "aarch64")]
whole! {
    "neon" u32: load4 store4;
    "neon" u64: load8 store8;
    "neon" Simd<u8, 16>: load16 store16;
}

#[cfg(target_arch = "x86_64")]
#[test]
fn masked() {
    use bun_simd_trusted::shared::{load_fitting, store_fitting};
    if !detected().contains(Features::named(&["avx512bw"])) {
        return;
    }
    let room = fenced();
    for len in 0..70 {
        for start in [0, 77, ROOM - len] {
            let text = &room[start..start + len];
            reset(room);
            let want: [u8; 64] = core::array::from_fn(|i| {
                if i < len {
                    ((start + i) % 251) as u8
                } else {
                    0
                }
            });
            // SAFETY: the CPU has the feature.
            unsafe {
                assert_eq!(load_fitting(text).to_array(), want);
                store_fitting(Simd::splat(255), text);
                // With what was stored still in a register.
                assert!(
                    load_fitting(text)[len.min(64)..]
                        .iter()
                        .all(|&lane| lane == 0)
                );
            }
            assert_eq!(
                changed(room),
                (start..start + len.min(64)).collect::<Vec<_>>()
            );
        }
    }
}

//! How src/simd/detect.rs asks the system: the real one against libc and instructions, and made-up ones that fail in each way.
#![allow(dead_code, unreachable_pub)]
#![cfg(all(target_os = "linux", not(miri), target_arch = "aarch64"))]
#![cfg_attr(any(bun_simd_sanitize = "cfi", bun_simd_sanitize = "kcfi"), feature(sanitize))]
#![allow(
    dead_code, unused_features, unused_imports, unused_macros, unused_macro_rules, unused_unsafe,
    non_upper_case_globals, clippy::duplicate_mod
)]
#[macro_use(rules)]
extern crate bun_simd_macros;
#[allow(unused_imports)]
use bun_simd_macros::join as __join;
use std::{cell::RefCell, ffi::*};

macro_rules! select {
    (fake miri => $a:tt any $p:tt => { core::arch::global_asm! $g:tt; unsafe extern "C" { #$link:tt safe static getauxval: $t:ty; $($more:tt)* } $($it:tt)* } $($others:tt)*) => {
        static getauxval: $t = None; unsafe extern "C" { $($more)* } $($it)*
    };
    // The registers are those of `man 2 syscall`. With other text, the real kernel is called and the tests fail.
    ($on:ident fake_kernel
        target_arch = "aarch64" => { core::arch::asm!("svc 0", in("x8") $n:ident, inlateout("x0") $a:ident, in("x1") $b:ident, in("x2") $c:ident,
            in("x3") $zero:ident, in("x4") zero, clobber_abi("C"), options(nostack)) }
    ) => { $a = crate::kernel($n as _, [$a as _, $b as _, $c as _, $zero as _]) as _ };
    ($on:ident fake_kernel $($arms:tt)*) => { core::cfg_select! { $($arms)* } };
    (fake target_arch = "aarch64" => { core $($it:tt)* } $($arms:tt)*) => { select! { fake fake_kernel target_arch = "aarch64" => { core $($it)* } $($arms)* } };
    (libc target_arch = "aarch64" => { core $($it:tt)* } $($arms:tt)*) => { select! { libc fake_kernel target_arch = "aarch64" => { core $($it)* } $($arms)* } };
    (miri miri => { $($it:tt)* } $($others:tt)*) => { $($it)* };
    (bsd miri => $a:tt any $p:tt => $b:tt all $q:tt => { $($it:tt)* } $($others:tt)*) => { $($it)* };
    (darwin miri => $a:tt any $p:tt => $b:tt all $q:tt => $c:tt target_vendor = "apple" => { $($it:tt)* } $($others:tt)*) => { $($it)* pub fn hwcap() -> [u64; 2] { [0; 2] } };
    (windows miri => $a:tt any $p:tt => $b:tt all $q:tt => $c:tt target_vendor = "apple" => $d:tt target_os = "windows" => { #$link:tt $($it:tt)* } $($others:tt)*) => {
        $($it)* pub fn hwcap() -> [u64; 2] { [0; 2] }
    };
    (none miri => $a:tt any $p:tt => $b:tt all $q:tt => $c:tt target_vendor = "apple" => $d:tt target_os = "windows" => $e:tt _ => { $($it:tt)* }) => { $($it)* };
    ($on:ident $($arms:tt)*) => { core::cfg_select! { $($arms)* } };
}
#[bun_simd_macros::rules]
macro_rules! systems { ($($name:ident)*) => { $(#[path = ".."] mod $name {
    macro_rules! cfg_select {
        (miri => decode $$($$arms:tt)*) => { core::cfg_select! { miri => decode $$($$arms)* } };
        ($$($$arms:tt)*) => { select! { $name $$($$arms)* } };
    }
    pub mod detect;
})* }; }
systems! { real fake libc miri none bsd darwin windows }

unsafe extern "C" {
    safe fn getauxval(key: c_ulong) -> c_ulong;
    fn syscall(number: c_long, ...) -> c_long;
}

#[derive(Default)]
struct Kernel {
    files: Vec<c_long>,
    read: (c_long, Vec<c_ulong>),
    prctl: (c_long, Vec<c_ulong>),
    log: String,
}
thread_local! { static KERNEL: RefCell<Kernel> = RefCell::default(); }

/// `asm/unistd.h`: openat, read, close, prctl.
const NUMBERS: [c_long; 4] = [56, 63, 57, 167];
fn kernel(number: c_long, [a, b, c, zero]: [c_long; 4]) -> c_long {
    let write = |words: &[c_ulong]| {
        assert!(size_of_val(words) == c as usize, "{c} bytes");
        unsafe { std::ptr::copy(words.as_ptr(), std::ptr::with_exposed_provenance_mut(b as usize), words.len()) }
    };
    assert_eq!(zero, 0);
    KERNEL.with_borrow_mut(|it| match NUMBERS.iter().position(|it| *it == number) {
        Some(0) => {
            assert_eq!(
                (a, unsafe { CStr::from_ptr(std::ptr::with_exposed_provenance(b as usize)) }, c),
                (-100, c"/proc/self/auxv", 0o4000 | 0o2000000)
            );
            it.log += "open ";
            it.files.remove(0)
        }
        Some(1) => {
            it.log += &format!("read{a} ");
            write(&it.read.1);
            it.read.0
        }
        Some(2) => {
            it.log += &format!("close{a} ");
            assert_eq!([b, c], [0; 2]);
            0
        }
        Some(_) => {
            it.log += "prctl ";
            assert_eq!(a, i32::from_be_bytes(*b"AUXV") as c_long);
            write(&it.prctl.1);
            it.prctl.0
        }
        None => panic!("call {number}"),
    })
}
/// All 64 words, with keys at the first, second and last place. A value is also a key.
fn vector(hwcap: c_ulong, hwcap2: c_ulong) -> Vec<c_ulong> {
    let mut words = vec![99; 64];
    words[..4].copy_from_slice(&[6, 26, 16, hwcap]);
    words[62..].copy_from_slice(&[26, hwcap2]);
    words
}

#[test]
fn without_libc() {
    for (files, read, prctl, log, want) in [
        (&[5][..], 8, 0, "open read5 close5 ", [1, 2, 26, 0]),
        (&[3], 1, 0, "open read3 close3 ", [1, 2, 26, 0]),
        (&[5], 0, 1, "open read5 close5 prctl ", [3, 4, 26, 0]),
        (&[5], -22, 8, "open read5 close5 prctl ", [3, 4, 26, 0]),
        (&[-1], 8, 8, "open prctl ", [3, 4, 26, 0]),
        (&[-2], 8, 0, "open prctl ", [0; 4]),
        (&[-2], 8, -1, "open prctl ", [0; 4]),
        (&[5], 0, -22, "open read5 close5 prctl ", [0; 4]),
        (&[0, 0], 8, 8, "open open ", [0; 4]),
    ] {
        KERNEL.set(Kernel {
            files: files.to_vec(),
            read: (read, vector(1, 2)),
            prctl: (prctl, vector(3, 4)),
            ..Default::default()
        });
        assert_eq!(
            (fake::detect::os::auxv([16, 26, 6, 7]), KERNEL.take().log.as_str()),
            (want, log),
            "{files:?} {read} {prctl}"
        );
    }
    KERNEL.set(Kernel { files: vec![3], read: (8, vector(7, 9)), ..Default::default() });
    assert_eq!(fake::detect::os::hwcap(), [7, 9]);
}

#[test]
fn words_of_linux() {
    unsafe extern "C" {
        static __ehdr_start: u8;
        static _end: u8;
    }
    let start = (&raw const __ehdr_start).addr() as c_ulong;
    let stack = (&raw const start).addr() as c_ulong;
    let end = (&raw const _end).addr() as c_ulong;
    for (entry, near) in
        [(start, true), (getauxval(9), true), (start - 1, false), (end, false), (stack, false), (0, false)]
    {
        for (a, b) in (0..512).flat_map(|b| [(!0, b << 8), (1 << 22, b << 8 | 1)]) {
            let mut words = vector(a, b);
            words[4..6].copy_from_slice(&[9, entry]);
            KERNEL.set(Kernel { files: vec![3, 3], read: (8, words), ..Default::default() });
            assert_eq!(fake::detect::os::hwcap(), [if near { a } else { a ^ 1 << 22 }, b], "{entry:x}");
        }
    }
    KERNEL.set(Kernel { files: vec![3, 3], read: (8, vector(!(1 << 22), 5)), ..Default::default() });
    assert_eq!((fake::detect::os::hwcap(), KERNEL.take().files.len()), ([!(1 << 22), 5], 1));
}

#[test]
fn with_libc_and_the_kernel() {
    use real::detect::os::*;
    let keys = [16, 26, 6, 999];
    assert_eq!(
        (auxv(keys), from_kernel(keys), hwcap()),
        (keys.map(|it| getauxval(it)), keys.map(|it| getauxval(it)), [getauxval(16), getauxval(26)])
    );
    assert!(getauxval(6) >= 4096);
    assert_eq!((libc::detect::os::auxv(keys), KERNEL.take().log.as_str()), (auxv(keys), ""));
}

/// An error has to come back as a negative number, and no file stays open.
#[test]
fn without_files() {
    let limit = |new: [u64; 2]| unsafe {
        unsafe extern "C" {
            #[cfg_attr(target_env = "musl", link_name = "prlimit")]
            fn prlimit64(process: c_int, what: c_int, new: *const [u64; 2], old: *mut [u64; 2]) -> c_int;
        }
        let mut old = [0; 2];
        assert_eq!(prlimit64(0, 7, std::ptr::null(), &mut old), 0);
        assert_eq!(prlimit64(0, 7, &[new[0], old[1]], std::ptr::null_mut()), 0);
        old
    };
    {
        unsafe extern "C" {
            fn fork() -> c_int;
            fn waitpid(child: c_int, status: &mut c_int, options: c_int) -> c_int;
            fn _exit(code: c_int) -> !;
        }
        let child = unsafe { fork() };
        if child == 0 {
            let next = || unsafe {
                let file = syscall(NUMBERS[0], -100 as c_long, c"/".as_ptr(), 0 as c_long);
                syscall(NUMBERS[2], file);
                file
            };
            let (before, page) = (next(), real::detect::os::from_kernel([6]));
            let closed = next() == before;
            limit([0; 2]);
            let mut words = [0 as c_ulong; 64];
            let tells = unsafe {
                syscall(
                    NUMBERS[3],
                    0x4155_5856 as c_long,
                    words.as_mut_ptr(),
                    size_of_val(&words),
                    0 as c_long,
                    0 as c_long,
                )
            } > 0;
            let found = real::detect::os::from_kernel([6]);
            // QEMU makes its copy of the file in memory, and the kernel tells of QEMU.
            unsafe {
                _exit(
                    if closed && page == [getauxval(6)] && (found == page || found == [if tells { 4096 } else { 0 }]) {
                        0
                    } else {
                        1
                    },
                )
            }
        }
        let mut status = -1;
        assert_eq!((unsafe { waitpid(child, &mut status, 0) }, status), (child, 0));
    }
}

#[test]
fn all_is_what_the_system_says() {
    let want = real::detect::decode(getauxval(16), getauxval(26));
    assert_eq!(real::detect::all(), want);
}

#[test]
fn systems_that_tell_nothing() {
    assert_eq!([miri::detect::os::hwcap(), none::detect::os::hwcap()], [[0; 2]; 2]);
}

mod aarch64 {
    use super::*;
    thread_local! { static ANSWER: std::cell::Cell<(c_int, u32)> = const { std::cell::Cell::new((0, 0)) }; }
    #[unsafe(no_mangle)]
    extern "C" fn elf_aux_info(key: c_int, to: &mut c_ulong, size: c_int) -> c_int {
        assert_eq!(size, 8);
        *to = 100 + key as c_ulong;
        (key == ANSWER.get().0) as c_int * ANSWER.get().1 as c_int
    }
    #[unsafe(no_mangle)]
    extern "C" fn sysctlbyname(
        name: *const c_char,
        to: &mut u32,
        size: &mut usize,
        new: *mut c_void,
        new_size: usize,
    ) -> c_int {
        assert!(unsafe { CStr::from_ptr(name) } == c"a.b" && *size == 4 && new.is_null() && new_size == 0 && *to == 0);
        *to = ANSWER.get().1;
        ANSWER.get().0
    }
    #[unsafe(no_mangle)]
    extern "system" fn IsProcessorFeaturePresent(feature: u32) -> i32 {
        if feature == ANSWER.get().1 { ANSWER.get().0 } else { 0 }
    }

    #[test]
    fn other_systems() {
        // AT_HWCAP and AT_HWCAP2 of sys/elf_common.h, and ENOENT.
        for (answer, want) in [((0, 0), [125, 126]), ((25, 2), [0, 126]), ((26, 1), [125, 0])] {
            ANSWER.set(answer);
            assert_eq!(bsd::detect::os::hwcap(), want);
        }
        for (answer, want) in [((0, 1), true), ((0, 2), true), ((0, 0), false), ((-1, 1), false), ((1, 1), false)] {
            ANSWER.set(answer);
            assert_eq!(darwin::detect::os::has(c"a.b"), want);
        }
        for (answer, want) in [((1, 30), true), ((-1, 30), true), ((0, 30), false), ((1, 31), false)] {
            ANSWER.set(answer);
            assert_eq!(windows::detect::os::has(30), want);
        }
    }

    #[test]
    fn midr() {
        let mut midr = 0u64;
        if getauxval(16) & 1 << 11 != 0 {
            unsafe { std::arch::asm!("mrs {}, S3_0_C0_C0_0", out(reg) midr) };
            assert_ne!(midr, 0)
        }
        assert_eq!(real::detect::os::midr(), midr);
        for hwcap in [0, !(1 << 11), getauxval(16) & 1 << 11] {
            KERNEL.set(Kernel { files: vec![3, 3], read: (8, vector(hwcap, !0)), ..Default::default() });
            assert_eq!(fake::detect::os::midr(), if hwcap & 1 << 11 != 0 { midr } else { 0 });
        }
    }
}

//! What the CPU has and the operating system allows, by the names of `#[target_feature]`. The compiler can't check this
//! file completely, and `gate.rs` trusts its tables.
//!
//! There are no locks and no allocations, so a signal handler can be the first caller. A feature that is there may go
//! unnoticed. One that is reported has to be there.

#![allow(dead_code)]

/// Whether there is a token.
#[allow(unused_macros)]
macro_rules! any {
    () => {
        false
    };
    ($($it:tt)+) => {
        true
    };
}
/// == in constants.
#[inline(always)]
pub(crate) const fn same_text(a: &str, b: &str) -> bool {
    let (a, b, mut i) = (a.as_bytes(), b.as_bytes(), 0);
    if a.len() != b.len() {
        return false;
    }
    while i < a.len() && a[i] == b[i] {
        i += 1
    }
    i == a.len()
}

macro_rules! features {
    (|$($arg:ident: $t:ty),*| { $($setup:tt)* } $($name:tt = $test:expr,)*) => {
        pub(crate) const NAMES: &[&str] = &[$($name),*];
        /// Without a loop, so that it is folded.
        #[inline(always)]
        pub(crate) const fn index(name: &str) -> Option<u32> {
            let mut i = 0;
            $(if name.len() == $name.len() && same_text(name, $name) { return Some(i); } i += 1;)*
            let _ = i;
            None
        }
        pub(crate) const BASELINE: u64 = {
            let (mut all, mut bit) = (0, 1u128);
            $(if cfg!(target_feature = $name) { all |= bit } bit <<= 1;)*
            let _ = bit;
            all as u64
        };
        #[allow(unused)]
        pub(crate) fn decode($($arg: $t),*) -> u64 {
            $($setup)*
            let (mut found, mut i) = (0, 0);
            $(found |= ((cfg!(target_feature = $name) || $test) as u64) << i; i += 1;)*
            let _ = i;
            found
        }
    };
}

cfg_select! {
    all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2") => {
        #[cfg(target_arch = "x86")]
        use core::arch::x86::*;
        #[cfg(target_arch = "x86_64")]
        use core::arch::x86_64::*;

        // Intel SDM, volume 2A, CPUID. AMX is left out: Linux grants it only on request.
        features! {
            |cpuid: impl Fn(u32, u32) -> [u32; 4], xcr0: impl FnOnce() -> u64| {
                // For a leaf that it doesn't have, an Intel CPU returns the highest that it has.
                let (basic, extended) = (cpuid(0, 0), cpuid(1 << 31, 0)[0]);
                let leaf = |has: bool, leaf, sub| if has { cpuid(leaf, sub) } else { [0; 4] };
                let [a1, _, c1, _] = leaf(basic[0] >= 1, 1, 0);
                let [a7, b7, c7, d7] = leaf(basic[0] >= 7, 7, 0);
                // Some hypervisors ignore the subleaf.
                let next = leaf(a7 >= 1, 7, 1);
                let [a71, _, _, d71] = if next == [a7, b7, c7, d7] { [0; 4] } else { next };
                let [_, _, c81, _] = leaf((0x8000_0001..0x8001_0000).contains(&extended), 0x8000_0001, 0);
                let bit = |word: u32, n: u32| word >> n & 1 != 0;
                // The registers that the system saves.
                let saved = if bit(c1, 26) && bit(c1, 27) { xcr0() } else { 0 };
                // Westmere has no AVX.
                let westmere = a1 == 0x206c0;
                // For golang/go#80285.
                let ymm = saved & 0b110 == 0b110 && bit(c1, 28) && !westmere && !cfg!(target_os = "netbsd");
                // macOS turns these on thread by thread. See also golang/go#49233.
                let zmm = ymm && saved & 0xe0 == 0xe0 && bit(b7, 16) && bit(c1, 12) && bit(c1, 29) && !cfg!(target_vendor = "apple");
                // Erratum SKL052: Pentium and Celeron report BMI. They have neither it nor AVX.
                let bmi = ymm || vendor(basic) != CpuVendor::Intel;
            }
            "sse2" = true, "sse3" = bit(c1, 0), "pclmulqdq" = bit(c1, 1), "ssse3" = bit(c1, 9), "cmpxchg16b" = bit(c1, 13),
            "sse4.1" = bit(c1, 19), "sse4.2" = bit(c1, 20), "movbe" = bit(c1, 22), "popcnt" = bit(c1, 23),
            "aes" = bit(c1, 25), "ermsb" = bit(b7, 9), "adx" = bit(b7, 19), "sha" = bit(b7, 29), "gfni" = bit(c7, 8),
            "bmi1" = bmi && bit(b7, 3), "bmi2" = bmi && bit(b7, 8), "lzcnt" = bit(c81, 5),
            "avx" = ymm, "fma" = ymm && bit(c1, 12), "f16c" = ymm && bit(c1, 29), "avx2" = ymm && bit(b7, 5),
            "vaes" = ymm && bit(c7, 9), "vpclmulqdq" = ymm && bit(c7, 10),
            "sha512" = ymm && bit(a71, 0), "sm3" = ymm && bit(a71, 1), "sm4" = ymm && bit(a71, 2),
            "avxvnni" = ymm && bit(a71, 4), "avxifma" = ymm && bit(a71, 23), "avxvnniint8" = ymm && bit(d71, 4),
            "avxneconvert" = ymm && bit(d71, 5), "avxvnniint16" = ymm && bit(d71, 10),
            "avx512f" = zmm, "avx512dq" = zmm && bit(b7, 17), "avx512ifma" = zmm && bit(b7, 21),
            "avx512cd" = zmm && bit(b7, 28), "avx512bw" = zmm && bit(b7, 30), "avx512vl" = zmm && bit(b7, 31),
            "avx512vbmi" = zmm && bit(c7, 1), "avx512vbmi2" = zmm && bit(c7, 6), "avx512vnni" = zmm && bit(c7, 11),
            "avx512bitalg" = zmm && bit(c7, 12), "avx512vpopcntdq" = zmm && bit(c7, 14),
            "avx512vp2intersect" = zmm && bit(d7, 8), "avx512fp16" = zmm && bit(d7, 23), "avx512bf16" = zmm && bit(a71, 5),
        }

        /// An enclave can't run the instruction, and Miri doesn't have it.
        fn cpuid(leaf: u32, sub: u32) -> [u32; 4] {
            if cfg!(any(miri, target_env = "sgx")) {
                return [0; 4];
            }
            let CpuidResult { eax, ebx, ecx, edx } = __cpuid_count(leaf, sub);
            [eax, ebx, ecx, edx]
        }

        /// The signature, the name of the vendor, and the last extended leaf. A CPUID takes microseconds in a virtual machine.
        static SEEN: [AtomicU32; 5] = [const { AtomicU32::new(0) }; 5];
        use core::sync::atomic::{AtomicU32, Ordering::Relaxed};

        fn read() -> u64 {
            let cpuid = |leaf, sub| {
                let all = cpuid(leaf, sub);
                match leaf {
                    0 => (1..4).for_each(|i| SEEN[i].store(all[i], Relaxed)),
                    1 => SEEN[0].store(all[0], Relaxed),
                    0x8000_0000 => SEEN[4].store(all[0], Relaxed),
                    _ => {}
                }
                all
            };
            // SAFETY: CS can be read at all levels of privilege. `decode` calls this only if CPUID reports XSAVE and OSXSAVE, and
            // then XCR0 can be read.
            #[allow(unsafe_code)]
            decode(cpuid, || unsafe {
                // For a driver, Windows saves XMM only, unless it is asked for more.
                let mut segment = 3u32;
                if cfg!(target_os = "windows") {
                    core::arch::asm!("mov {:e}, cs", out(reg) segment, options(nomem, nostack, preserves_flags));
                }
                if segment & 3 == 3 { _xgetbv(0) } else { 0 }
            })
        }

        fn vendor([_, b, c, d]: [u32; 4]) -> CpuVendor {
            // Not `as_flattened`: with -Zshare-generics, the kernels of other crates would call this crate's copy.
            match &(b as u128 | (d as u128) << 32 | (c as u128) << 64).to_le_bytes()[..12] {
                b"GenuineIntel" => CpuVendor::Intel,
                b"AuthenticAMD" => CpuVendor::Amd,
                b"HygonGenuine" => CpuVendor::Hygon,
                b"CentaurHauls" | b"  Shanghai  " => CpuVendor::Zhaoxin,
                _ => CpuVendor::Other,
            }
        }

        fn model() -> CpuModel {
            let [_, b, c, d] = cpuid(0, 0);
            model_of([cpuid(1, 0)[0], b, c, d])
        }
        /// As `read` saw it.
        pub(crate) fn first_model() -> CpuModel {
            let seen = |i: usize| SEEN[i].load(Relaxed);
            let all = [seen(0), seen(1), seen(2), seen(3)];
            if all.contains(&0) { model() } else { model_of(all) }
        }
        fn model_of(all: [u32; 4]) -> CpuModel {
            let a = all[0];
            let family = (a >> 8 & 15) + if a >> 8 & 15 == 15 { a >> 20 & 255 } else { 0 };
            let model = a >> 4 & 15 | if family >= 6 { a >> 12 & 0xf0 } else { 0 };
            CpuModel { vendor: vendor(all), family: family as u16, model: model as u16, stepping: a as u8 & 15 }
        }

        /// FP512 of AMD: the units for vectors have 512 bits. It is for speed only.
        pub(crate) fn fp512() -> bool {
            let seen = SEEN[4].load(Relaxed);
            (0x8000_001a..0x8001_0000).contains(&if seen == 0 { cpuid(1 << 31, 0)[0] } else { seen })
                && cpuid(0x8000_001a, 0)[0] & 8 != 0
        }
    }
    target_arch = "aarch64" => {
        /// The columns are the bits of HWCAP and, from 64 on, HWCAP2 (`asm/hwcap.h` of Linux, which the BSDs follow), the
        /// names after `hw.optional.` on Darwin, and `PF_ARM_*` of `winnt.h`. All have to be set. None means unknown.
        /// SVE has bits of its own for "i8mm" and "bf16".
        macro_rules! arm {
            ($($name:tt [$($bit:literal)*] [$($key:literal)*] [$($pf:literal)*] $(or [$or_key:literal])?,)*) => { cfg_select! {
                all(target_vendor = "apple", not(miri)) => { features! {
                    |has: impl Fn(&core::ffi::CStr) -> bool| {}
                    $($name = (any!($($key)*) $(&& has(key!($key)))*) $(|| has(key!($or_key)))?,)*
                } }
                all(target_os = "windows", not(miri)) => { features! {
                    // Frames with SVE registers need an unwinder that knows `alloc_z`. That is untested.
                    |asks: impl Fn(u32) -> bool| {
                        let part = asks(66) && !asks(57) || asks(68) && !asks(52);
                        let has = |it| asks(it) && !(it == 46 && part);
                    }
                    $($name = any!($($pf)*) && !(cfg!(panic = "unwind") && $name.starts_with("sve")) $(&& has($pf))*,)*
                } }
                _ => { features! {
                    |hwcap: u64, hwcap2: u64| {
                        // The big cores of Exynos 9810 stop at ARMv8.0, and Android 8 reports what the little ones have. Its
                        // kernel is one of those before 4.11, which lack bit 11 and up. It also runs programs for Linux.
                        let old = hwcap >> 11 == 0 || cfg!(target_os = "android") && hwcap >> 11 & 1 == 0;
                        let all = if old { hwcap as u128 & 0xff } else { hwcap as u128 | (hwcap2 as u128) << 64 };
                        let part = (all >> 77 & !(all >> 73) | all >> 78 & !(all >> 76)) & 1 != 0;
                        let bsd = cfg!(target_os = "openbsd") || cfg!(target_os = "freebsd");
                        let all = if part || bsd { all & !(1 << 22) } else { all };
                    }
                    $($name = any!($($bit)*) $(&& all >> $bit & 1 != 0)*,)*
                } }
            } };
        }
        #[allow(unused_macros)]
        macro_rules! key {
            ($key:literal) => {
                const {
                    match core::ffi::CStr::from_bytes_with_nul(concat!("hw.optional.", $key, "\0").as_bytes()) {
                        Ok(it) => it,
                        _ => panic!(),
                    }
                }
            };
        }

        arm! {
            "neon" [0 1] [] [19],
            "crc" [7] ["armv8_crc32"] [31] or ["arm.FEAT_CRC32"],
            // To the compiler, "aes" includes PMULL, "sha2" SHA-1, "sha3" SHA-512, and "sm4" SM3.
            "aes" [1 3 4] ["arm.FEAT_AES" "arm.FEAT_PMULL"] [30],
            "sha2" [1 5 6] ["arm.FEAT_SHA1" "arm.FEAT_SHA256"] [30],
            "sha3" [1 5 6 17 21] ["arm.FEAT_SHA3" "arm.FEAT_SHA512"] [30 64 65],
            "sm4" [1 18 19] [] [],
            "lse" [8] ["arm.FEAT_LSE"] [34],
            "fp16" [0 1 9 10] ["arm.FEAT_FP16"] [67],
            // Windows has no flag for RDM. ARMv8.1 requires it, and dot products require ARMv8.1.
            "rdm" [1 12] ["arm.FEAT_RDM"] [43],
            "jsconv" [0 13] ["arm.FEAT_JSCVT"] [44],
            // Nor for FCMA. ARMv8.3 requires it, and SVE2 requires ARMv9.
            "fcma" [1 14] ["arm.FEAT_FCMA"] [46 47],
            "rcpc" [15] ["arm.FEAT_LRCPC"] [45],
            "dotprod" [1 20] ["arm.FEAT_DotProd"] [43],
            // Nor for FHM. ARMv8.4 requires it with FP16, which SVE requires.
            "fhm" [1 9 10 23] ["arm.FEAT_FHM" "arm.FEAT_FP16"] [46 47 67],
            "frintts" [72] ["arm.FEAT_FRINTTS"] [],
            "i8mm" [1 77] ["arm.FEAT_I8MM"] [66],
            "bf16" [1 78] ["arm.FEAT_BF16"] [68],
            // Some kernels report the extensions of SVE where only SME has them, so all of these check for SVE.
            "sve" [1 22] [] [46],
            "sve2" [1 22 65] [] [46 47],
            "sve2-aes" [1 22 65 3 4 66 67] [] [46 47 30 49 50],
            "sve2-bitperm" [1 22 65 68] [] [46 47 51],
            "sve2-sha3" [1 22 65 5 6 17 21 69] [] [46 47 30 64 65 55],
            "sve2-sm4" [1 22 65 18 19 70] [] [],
        }

        #[allow(clippy::unnecessary_cast, reason = "ILP32")]
        fn read() -> u64 {
            cfg_select! {
                miri => decode(0, 0),
                any(target_vendor = "apple", target_os = "windows") => decode(os::has),
                any(target_os = "linux", target_os = "android", target_os = "freebsd", target_os = "openbsd") => {
                    let [a, b] = os::hwcap();
                    decode(a as u64, b as u64)
                }
                // At EL0 the ID registers trap, and so does the one that tells the level.
                _ => decode(0, 0),
            }
        }

        fn model() -> CpuModel {
            let midr = os::midr();
            let vendor = match midr >> 24 & 255 {
                0x41 => CpuVendor::Arm,
                0x51 => CpuVendor::Qualcomm,
                0x61 => CpuVendor::Apple,
                _ if cfg!(target_vendor = "apple") => CpuVendor::Apple,
                _ => CpuVendor::Other,
            };
            CpuModel {
                vendor,
                family: (midr >> 24 & 255) as u16,
                model: (midr >> 4 & 0xfff) as u16,
                stepping: (midr >> 16 & 0xf0 | midr & 15) as u8,
            }
        }
    }
    _ => {
        features! { | | {} "simd128" = false, "relaxed-simd" = false, }
        fn read() -> u64 {
            decode()
        }
        fn model() -> CpuModel {
            CpuModel::UNKNOWN
        }
        pub(crate) fn fp512() -> bool {
            false
        }
        pub(crate) fn first_model() -> CpuModel {
            model()
        }
    }
}

#[cfg(target_arch = "aarch64")]
#[allow(unsafe_code)]
pub(crate) mod os {
    #[allow(unused_imports)]
    use core::ffi::*;

    cfg_select! {
        miri => {
            pub fn hwcap() -> [c_ulong; 2] {
                [0; 2]
            }
        }
        any(target_os = "linux", target_os = "android") => {
            // A word with the address of `getauxval`, or null.
            // With `.weakref`, the symbol is weak only where nothing else names it.
            core::arch::global_asm!(
                ".ifndef __bun_simd_getauxval",
                ".weakref __bun_simd_weak_getauxval, getauxval",
                ".pushsection .data.rel.ro.__bun_simd_getauxval, \"awG\", %progbits, __bun_simd_getauxval, comdat",
                ".weak __bun_simd_getauxval",
                ".hidden __bun_simd_getauxval",
                ".balign 8",
                #[cfg(not(target_abi = "pauthtest"))]
                "__bun_simd_getauxval: .dc.a __bun_simd_weak_getauxval",
                // A pointer has to be signed there.
                #[cfg(target_abi = "pauthtest")]
                "__bun_simd_getauxval: .dc.a 0",
                ".popsection",
                ".endif",
                // The linker defines it, if it can.
                ".weak __ehdr_start",
            );
            // SAFETY: the word above is null or an address. If a program has `getauxval`, it is that of its C library, which takes any number. The byte is not read.
            unsafe extern "C" {
                #[link_name = "__bun_simd_getauxval"]
                safe static getauxval: Option<extern "C" fn(c_ulong) -> c_ulong>;
                static __ehdr_start: u8;
            }

            #[inline(never)]
            pub fn hwcap() -> [c_ulong; 2] {
                use core::sync::atomic::{AtomicPtr, Ordering::Relaxed};
                // Instructions can be too far from address 0.
                static START: AtomicPtr<u8> = AtomicPtr::new((&raw const __ehdr_start).cast_mut());
                let [a, b] = auxv([16, 26]);
                if !cfg!(target_os = "linux") || a >> 22 & 1 == 0 {
                    return [a, b];
                }
                let ([entry, _], start) = (auxv([9; 2]), core::hint::black_box(&START).load(Relaxed).addr());
                // The highest byte can be a tag.
                let end = (((&raw const START).addr() as u64) << 8 >> 8) as usize;
                let far_entry = start == 0 || !(start..end).contains(&(entry as usize));
                [if far_entry { a & !(1 << 22) } else { a }, b]
            }

            /// 0 for what is not known.
            pub fn auxv<const N: usize>(keys: [c_ulong; N]) -> [c_ulong; N] {
                if from_libc(16).is_some() { keys.map(|key| from_libc(key).unwrap_or(0)) } else { from_kernel(keys) }
            }

            /// CFI knows nothing of an address that assembly takes. A copy of this in another library would not find the word.
            #[inline(never)]
            #[cfg_attr(any(bun_simd_sanitize = "cfi", bun_simd_sanitize = "kcfi"), sanitize(cfi = "off", kcfi = "off"))]
            fn from_libc(key: c_ulong) -> Option<c_ulong> {
                Some(getauxval?(key))
            }

            pub fn from_kernel<const N: usize>(keys: [c_ulong; N]) -> [c_ulong; N] {
                // Emulators and Valgrind have their own version of the file, so it comes first.
                let mut words = [0; 64];
                let file = syscall(Call::Open);
                // A filter of seccomp can return 0 for a call that it skips.
                let again = if file == 0 { syscall(Call::Open) } else { -1 };
                if again > 0 {
                    syscall(Call::Close(again));
                }
                // Then nothing is known.
                if let 0..=2 = file {
                    if again != 0 {
                        syscall(Call::Close(file));
                    }
                    return [0; N];
                }
                let read = file > 0 && (syscall(Call::Read(file, &mut words)) > 0, syscall(Call::Close(file))).0;
                if !read && syscall(Call::GetAuxv(&mut words)) <= 0 {
                    return [0; N];
                }
                keys.map(|key| words.as_chunks().0.iter().find(|[k, _]| *k == key).map_or(0, |[_, value]| *value))
            }

            /// As wide as a register.
            type Word = i64;
            enum Call<'a> {
                Open,
                Read(Word, &'a mut [c_ulong]),
                Close(Word),
                GetAuxv(&'a mut [c_ulong]),
            }
            const NUMBERS: [Word; 4] = [56, 63, 57, 167];

            fn syscall(call: Call<'_>) -> Word {
                let address = |to: &mut [c_ulong]| to.as_mut_ptr().expose_provenance() as Word;
                let (number, [mut a, b, c]) = match call {
                    // openat(AT_FDCWD, path, O_RDONLY | O_NONBLOCK | O_CLOEXEC)
                    Call::Open => {
                        (NUMBERS[0], [-100, c"/proc/self/auxv".as_ptr().expose_provenance() as Word, 0o2004000])
                    }
                    Call::Read(file, to) => (NUMBERS[1], [file, address(to), size_of_val(to) as Word]),
                    Call::Close(file) => (NUMBERS[2], [file, 0, 0]),
                    // prctl(PR_GET_AUXV, ..) of Linux 6.4
                    Call::GetAuxv(to) => (NUMBERS[3], [0x4155_5856, address(to), size_of_val(to) as Word]),
                };
                let zero: Word = 0;
                // SAFETY: the kernel reads the path, or writes no more than the length. The file is one that was opened above.
                unsafe {
                    // tests/system.rs puts made-up answers of the system here.
                    cfg_select! {
                        target_arch = "aarch64" => {
                            core::arch::asm!("svc 0", in("x8") number, inlateout("x0") a, in("x1") b, in("x2") c,
                        in("x3") zero, in("x4") zero, clobber_abi("C"), options(nostack))
                        }
                    }
                };
                a
            }
        }
        all(target_arch = "aarch64", any(target_os = "freebsd", target_os = "openbsd")) => {
            #[repr(i32)]
            enum Size {
                OfWord = size_of::<c_ulong>() as i32,
            }
            // SAFETY: it writes no more than the size.
            unsafe extern "C" {
                safe fn elf_aux_info(key: c_int, to: &mut c_ulong, size: Size) -> c_int;
            }

            pub fn hwcap() -> [c_ulong; 2] {
                [25, 26].map(|key| {
                    let mut value = 0;
                    if elf_aux_info(key, &mut value, Size::OfWord) == 0 { value } else { 0 }
                })
            }
        }
        target_vendor = "apple" => {
            // SAFETY: as in sys/sysctl.h.
            unsafe extern "C" {
                fn sysctlbyname(
                    name: *const c_char,
                    to: *mut c_void,
                    size: *mut usize,
                    new: *mut c_void,
                    new_size: usize,
                ) -> c_int;
            }

            pub fn has(name: &CStr) -> bool {
                let (mut value, mut size) = (0u32, size_of::<u32>());
                // SAFETY: it reads the name, writes no more than `size` bytes, and sets nothing.
                let status = unsafe {
                    sysctlbyname(name.as_ptr(), (&raw mut value).cast(), &mut size, core::ptr::null_mut(), 0)
                };
                status == 0 && value != 0
            }
        }
        target_os = "windows" => {
            // SAFETY: it takes any number. A driver with this import is not loaded.
            #[link(name = "kernel32", kind = "raw-dylib")]
            unsafe extern "system" {
                safe fn IsProcessorFeaturePresent(feature: u32) -> i32;
            }

            pub fn has(feature: u32) -> bool {
                IsProcessorFeaturePresent(feature) != 0
            }
        }
        _ => {
            pub fn hwcap() -> [c_ulong; 2] {
                [0; 2]
            }
        }
    }

    /// 0 if it is not known.
    pub fn midr() -> u64 {
        #[allow(unused_mut)]
        let mut midr = 0;
        #[cfg(all(
            not(miri),
            any(target_os = "linux", target_os = "android", target_os = "freebsd", target_os = "openbsd")
        ))]
        if hwcap()[0] >> 11 & 1 != 0 {
            // SAFETY: HWCAP_CPUID says that the kernel emulates this.
            unsafe { core::arch::asm!("mrs {}, MIDR_EL1", out(reg) midr, options(nomem, nostack, preserves_flags)) };
        }
        midr
    }
}

pub(crate) fn has(mask: u64) -> bool {
    all() & mask == mask
}

/// Bit `i` tells whether the CPU has `NAMES[i]`.
#[inline]
pub(crate) fn all() -> u64 {
    const { assert!(NAMES.len() < 64) };
    cfg_select! {
        target_has_atomic = "64" => {
            use core::sync::atomic::{AtomicU64, Ordering::Relaxed};
            const KNOWN: u64 = 1 << 63;
            static CACHE: AtomicU64 = AtomicU64::new(0);
            /// Threads that race can store different values, if a system call fails. Each is true.
            #[cold]
            fn fill() -> u64 {
                let bits = read() | KNOWN;
                CACHE.store(bits, Relaxed);
                bits
            }
            let bits = CACHE.load(Relaxed);
            (if bits == 0 { fill() } else { bits }) & !KNOWN
        }
        _ => read(),
    }
}

pub(crate) const fn mask(names: &[&str]) -> u64 {
    let (mut mask, mut i) = (0, 0);
    while i < names.len() {
        let mut bit = 0;
        while !same_text(NAMES[bit], names[i]) {
            bit += 1;
        }
        mask |= 1 << bit;
        i += 1;
    }
    mask
}

/// The features that can be detected, named as in `#[target_feature]`, and whether they can be used here. It is for logs.
///
/// ```
/// # use bun_simd::target::cpu_features;
/// let found: Vec<&str> = cpu_features().filter(|it| it.1).map(|it| it.0).collect();
/// println!("{found:?}");
/// ```
pub fn cpu_features() -> impl Iterator<Item = (&'static str, bool)> {
    NAMES.iter().enumerate().map(|(bit, &name)| (name, all() >> bit & 1 != 0))
}

/// Who designed a CPU.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[non_exhaustive]
#[allow(missing_docs)]
pub enum CpuVendor {
    Intel,
    Amd,
    Hygon,
    Zhaoxin,
    Arm,
    Apple,
    Qualcomm,
    Other,
}

/// See [`cpu_model`]. The numbers are 0 where the system doesn't tell.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[non_exhaustive]
pub struct CpuModel {
    #[allow(missing_docs)]
    pub vendor: CpuVendor,
    /// As in `/proc/cpuinfo`: "cpu family", or "CPU implementer" on Arm.
    pub family: u16,
    /// "model", or "CPU part".
    pub model: u16,
    /// "stepping", or 16 times "CPU variant" plus "CPU revision".
    pub stepping: u8,
}

impl CpuModel {
    const UNKNOWN: CpuModel = CpuModel { vendor: CpuVendor::Other, family: 0, model: 0, stepping: 0 };
}

/// The core that this thread happens to run on. It is for tuning and for logs, and it is not cached.
#[cold]
pub fn cpu_model() -> CpuModel {
    model()
}

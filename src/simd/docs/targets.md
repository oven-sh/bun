# Targets

A target is a level plus features. Both are named by *words*. The first in the list that the CPU supports is used, and `portable` ends each list.

```text
#[simd]                                                  // icelake, avx2 + aes, sse4, neon, wasm + relaxed, wasm
#[simd(icelake, avx2 + vaes, avx2, sse4 + aes, neon + aes + sha3, neon + aes, neon)]
#[simd(avx2 + sha512, sve2, default)]                    // more than the default
#[simd(Upto<B32>)]                                       // the default up to that width, for work that is no wider
#[simd(no_downclock)]                                    // the default, but 64 bytes only with fast_zmm
#[simd(avx2 + sha + "adx", avx2 + sha, avx2)]            // a feature in quotes is for core::arch
#[simd(sse4 + bmi)]                                      // for scalar code, such as readers of bits: no AVX
#[simd("bmi2" + fast_pdep)]                              // no vectors, and not on Zen 1 and 2
#[simd(crate::codec)]                                    // the list of that module; also super, or one of another crate
targets!(avx2, sse4, neon);                              // among the items of a file; also by a path
```

| Level | First in | Has, with all above it | Can have |
| --- | --- | --- | --- |
| `sse2` | all of x86-64 | | |
| `sse4` | Nehalem | x86-64-v2: `crc32c` | `aes` (with PCLMULQDQ) < `gfni`; `sha`; `bmi` (BMI1, BMI2, LZCNT) |
| `avx2` | Haswell, Zen 1 | x86-64-v3: `bmi`, `fma`, F16C | `aes` < `vaes` (with VPCLMULQDQ) < `gfni` < `vnni`; `aes` < `sha`; all of these < `dot` (AVX-VNNI-INT8) = `ifma` < `sha512` = `sm4` |
| `avx512` | Skylake-X | x86-64-v4: `masked` | `aes` < `vnni` < `bf16`; `narrow` (vectors of 32 bytes) |
| `icelake` | Ice Lake, Zen 4 | VBMI, VBMI2, BITALG, VPOPCNTDQ, `aes`, `gfni`, `ifma`, `vaes`, `vnni` | `sha` < `bf16` < `fp16`; `narrow` |
| `neon` | all of AArch64 | `fma` | `aes` (with PMULL) = `sha` < `sha3` = `sha512` < `sm4` (with SM3); `crc` = `crc32c` |
| `neon82` | Neoverse N1, Apple M1 | `crc`, `crc32c`, `dot`, RDM | `aes` < `sha3` < `sm4`; `fcma`; `fp16` |
| `neon86` | Neoverse V1, Apple M2 | `bf16`, `fp16`, `i8mm` | `aes` < `sha3` < `sm4`; `fcma` = `fhm` |
| `sve2` | Neoverse N2, V2 | `fcma`, `fhm`, `masked` | `aes` < `sha3` < `sm4` |
| `wasm` | chosen at compile time | | `relaxed` |

A word brings those to the left of its `<`: `avx2 + gfni` is `avx2 + aes + vaes + gfni`. Words with `=` bring each other.
The same words work in `#[kernel(..)]`, `#[only(..)]`, `has!(gfni)`, `pick! { gfni => a, _ => b }` and `target!(avx2 + sha)`, and
a typo is an error. There a level means "at least", and `B16`, `B32` and `B64` are words for the width, in lists only after `Upto`. A feature in quotes is named as in `#[target_feature]`. The kernel and what is inlined into it have it, and elsewhere functions with `#[only]`.
Words for what only some CPUs do fast go with any level: `fast_pdep` (not Zen 1 and 2; on Arm, Neoverse with SVE2 on Linux), `fast_gather`, `fast_zmm` (no lower clock), `full_zmm` (an instruction on 64 bytes doesn't take two steps: Intel, and Zen 5 but for its mobile parts), `fast_compress_store`, and on Arm `fast_sha3` (Apple, Neoverse N3) and `fast_clmul` (Apple, and cores with BF16 but for Neoverse N and Cortex-A). They choose the version and answer `has!`, and in functions with a mark the first two also the form of `extract_bits`, `deposit_bits`, gathers and `lookup`.

Operations never disappear without a feature: they are slower. macOS has no AVX-512. SVE is used on Linux from 6.3 on, with `rseq` (not on Android 15, nor in QEMU's user mode), and on Windows with `panic = "abort"`.
`portable` uses only what the whole program is compiled for, and runs anywhere. On x86-64 it has the code of `sse2`. Targets after the first that the whole program is compiled for are never chosen, `portable` too, and only compiled for `f::to`.
`avx2 + dot` and `avx2 + sha512` were tested in an emulator only (Bochs).

The default follows the flags: `avx2` for `sse4` with `-Ctarget-cpu=x86-64-v3` (but for `Upto<B16>`), and on AArch64 the best target that the program is compiled for, such as `neon82 + aes + fp16` with `neoverse-n1`, also on macOS. Dot products and CRCs follow the flags on `neon` too.
It has no `avx512`: on Skylake-X and Cascade Lake, 512 bits lower the clock for the code around them. For a program that spends half of its time or more in kernels on long inputs,
`#[simd(icelake, avx512 + aes, default)]` took 0.6 to 1.0 of the time there. Each further target adds about a fifth to the code and the build on x86-64. For 64 bytes test `has!(avx512)` or `Native::<S>::BYTES`, not `has!(icelake)`.
`no_downclock` is for kernels that multiply, and take a small part of the time: on Ice Lake, products of integers in 64 bytes slow down the code around them by up to 25%. It stands for `icelake + fast_zmm, icelake + narrow, Upto<B32>`, so a test by `set_cpu` wants `with("fast_zmm")` too.
`narrow` sets `Native` only: wider vectors, some operations and the loops that LLVM vectorizes still take registers of 64 bytes. Outside of the `mod` or kernel that has the list, `#[only]` and `pick!` need `B64` or `icelake | narrow`: `icelake` or `avx512` alone doesn't compile for it.

## What a word brings

These come with it on all CPUs in the tables of LLVM, GCC, QEMU and Bochs. Where a hypervisor or the firmware hides one of those, the next target of the list wins.
A feature in quotes, `avx2 + "gfni"`, brings only what the compiler implies.

| Level | Word | Brings | First in |
| --- | --- | --- | --- |
| `sse4` | `gfni` | `aes` | Tremont |
| `avx2` | `sha`, `vaes` | `aes` | Zen 1, Zen 3 |
| | `gfni` | `vaes` | Ice Lake, Zen 4 |
| | `vnni` | `gfni` | Alder Lake, Zen 5 |
| | `dot`, `ifma` | each other, `vnni`, `sha` | Sierra Forest, Arrow Lake |
| | `sha512`, `sm4` | each other, `dot` | Arrow Lake-S, Lunar Lake |
| `avx512` | `vnni` | `aes` | Cascade Lake |
| | `bf16` | `vnni` | Cooper Lake |
| `icelake` | `bf16` | `sha` | Zen 4 |
| | `fp16` | `bf16` | Sapphire Rapids |
| `neon` to `sve2` | `sha3` | `aes` | Apple A13 |
| | `sm4` | `sha3` | Neoverse V1 |

## Detection

The first call of a kernel detects the CPU, without locks or allocations. x86 is asked by `cpuid`. On AArch64 the crate asks Linux, Android, FreeBSD, OpenBSD, Darwin or Windows.
It needs no C library on Linux. Elsewhere there is only what the program is compiled for. A driver for Windows gets no AVX. BMI goes with it on Intel. What the program is compiled for stays.

For a list of levels, also with `aes`, `crc` and `narrow`, a call is one load, one `and` and one indirect jump, with the arguments in registers. Other features add
a load and up to a cycle.

## Other architectures

They run `portable`, which has no vectors there: on 32-bit Arm, RISC-V and IBM Z, bytes mostly share general registers, on IBM Z also `u16`, and the rest goes lane by lane. 32-bit Arm, RISC-V, POWER, IBM Z and LoongArch were tested in QEMU only. Bun is built for none of them, and nothing is promised there.

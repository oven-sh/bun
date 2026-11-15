# bun_simd

SIMD with runtime dispatch, in safe Rust. You write a kernel once. It is compiled once per target, and the first call picks the best copy that the CPU can run. The crate needs nightly Rust. It needs `alloc`, but neither `std` nor another crate of Bun.

```rust
#![forbid(unsafe_code)]

#[bun_simd::foreach_target]
mod simd {
    use isa::U8;

    #[export]
    pub fn index_of_quote(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| v.simd_eq(b'"') | v.simd_eq(b'\''))
    }

    #[export]
    pub fn to_upper(text: &mut [u8]) {
        U8::map_in_place(text, |v| v ^ v.in_range(b'a'..=b'z').select(0x20, 0));
    }
}

fn main() {
    assert_eq!(simd::index_of_quote(b"it's"), Some(2));
    let mut text = *b"it's";
    simd::to_upper(&mut text);
    assert_eq!(&text, b"IT'S");
}
```

| Folder        | Crate                  | Contents                                                                    |
| ------------- | ---------------------- | --------------------------------------------------------------------------- |
| `.`           | `bun_simd`             | Vectors, loops over slices, dispatch. `forbid(unsafe_code)`                 |
| `trusted`     | `bun_simd_trusted`     | All the `unsafe`, and the detection that it relies on                       |
| `macros`      | `bun_simd_macros`      | The attributes that copy a module. They emit no `unsafe`                    |
| `kernels`     | `bun_simd_kernels`     | Ports of Bun's kernels. `forbid(unsafe_code)`                               |
| `conformance` | `bun_simd_conformance` | Compares and times them against the kernels on Highway, inside a canary Bun |

## Writing a kernel

In a module with `#[foreach_target]`:

- `isa` has the types of the target: `U8`, `I16`, `F32` and so on fill a register. `Vector<T, N>` has up to 64 bytes.
- `isa::x128` has the same types for 128 bits. A nested module with `#[foreach_width]` is compiled as `full` and as `x128`.
- `#[export]` adds a function of the same name to the module itself, which dispatches. It can be generic only over lifetimes. It gets the attributes after `#[export]`, and `cfg` and comments before it.
- `this_target` is the name of the copy: `use other::simd::this_target::helper;`
- Trait methods, `const fn` and functions from a macro outside the module do not get the features of the target. They can use only the ops that need no intrinsic, and run baseline code unless they are inlined.
- `#[inline(always)]` becomes `#[rustc_force_inline]`. Use it only on functions that no other crate calls. If rustc reports a recursion limit, raise `#![recursion_limit]`. A closure with the attribute loses the features until it is inlined, and cannot call such a function.
- These do not compile: `async`, `unsafe` and `extern` functions, `#[inline(always)]` in a macro inside the module, and a fragment of several tokens from a macro around it.
- Name the module `simd`. The allowlists in `scripts/verify-baseline-static` match that name.

An op has the name that `core::simd` gives it, where there is one.

| File                   | Contents                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `vector.rs`, `mask.rs` | The ops that are the same code on every target                                         |
| `portable.rs`          | The definition of the other ops. `x86.rs` and `neon.rs` implement them with intrinsics |
| `algo.rs`              | `position`, `rposition`, `zip_find_map`, `count`, `map` and others, for any length     |
| `matches.rs`           | The indices that `zip_find_map` has found                                              |
| `bit_indices.rs`       | From a bitmask to a list of positions                                                  |
| `trusted/output.rs`    | `Out` and `Writer`, for output to memory that may be uninitialized                     |
| `partial.rs`           | Loads and stores for a slice that is shorter than a vector                             |
| `source.rs`            | `load`, from plain or from shared memory                                               |
| `sink.rs`              | Output of bytes, to plain or to shared memory                                          |

`load` and `store` take an array of the size of the vector, so they need no bounds check. Cut a slice with `as_chunks`, `first_chunk` and `split_last_chunk`.

A kernel that fills a buffer takes an `Out<'a, T>` and returns the `&'a mut [T]` that it has written. The caller needs no zeros to start with, and does not have to trust a count:

```rust
#![forbid(unsafe_code)]
use bun_simd::Out;

#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn invert<'a>(from: &[u8], to: Out<'a, u8>) -> &'a mut [u8] {
        isa::U8::map(from, to, |v| !v)
    }
}

fn main() {
    let mut all = vec![1];
    bun_simd::extend_vec(&mut all, 2, |out| simd::invert(&[0, 255], out));
    assert_eq!(all, [1, 255, 0]);
    simd::invert(&[7], all[..].as_mut().into());
    assert_eq!(all, [248, 255, 0]);
}
```

`extend_vec` reserves the room. `spare_capacity` does not allocate, and can fill several vectors at once.

Call ops in `for` loops and in the closures that you pass to `algo.rs`. LLVM may not inline a closure that goes through an adapter of `core`, such as `array::map`. Compile a crate with kernels at `opt-level` 2 or 3. With `-Zshare-generics`, it needs LTO.

How LLVM unrolls a loop depends on the CPU that the build is tuned for. `#[rustc_unroll(never)]` and `#[rustc_unroll(4)]` settle it. If each turn of a loop waits for the one before, `opaque` keeps LLVM from reordering the sum or from moving it to vectors.

## Ops of your own

A `Vector` converts to and from a `Simd`, so all of `core::simd` is at hand. So are the intrinsics that take no pointer, in a module for each target:

```rust
#![feature(portable_simd)]
#![forbid(unsafe_code)]

mod ops {
    pub mod portable {
        use bun_simd::{Isa, Vector};
        use core::simd::prelude::*;

        #[inline(always)]
        pub fn mul_high<const N: usize, I: Isa>(a: Vector<u16, N, I>, b: u16) -> Vector<u16, N, I> {
            ((Simd::from(a).cast::<u32>() * Simd::splat(b.into())) >> 16).cast().into()
        }
    }

    #[cfg(target_arch = "x86_64")]
    pub mod avx2 {
        use bun_simd::avx2::U16;
        use core::{arch::x86_64::*, simd::Simd};

        #[inline]
        #[target_feature(enable = "avx2")]
        pub fn mul_high(a: U16, b: u16) -> U16 {
            Simd::from(_mm256_mulhi_epu16(Simd::from(a).into(), Simd::splat(b).into())).into()
        }
    }

    pub use portable as avx512_icl;
    pub use portable as avx512_skx;
    pub use portable as sse4;
    pub use portable as sve2;
    pub use portable as neon;
    pub use portable as portable64;
    pub use portable as portable32;
}

#[bun_simd::foreach_target]
mod simd {
    use ops::this_target::mul_high;

    #[export]
    pub fn scale(samples: &mut [u16], by: u16) {
        isa::U16::map_in_place(samples, |v| mul_high(v, by));
    }
}

fn main() {
    let mut samples = [1000; 50];
    simd::scale(&mut samples, 1 << 15);
    assert_eq!(samples, [500; 50]);
}
```

In Bun, lints keep `core::simd` and `core::arch` out of the kernels. Add the op to this crate.

## Targets

| Target       | Bits | CPUs                                         |
| ------------ | ---- | -------------------------------------------- |
| `avx512_icl` | 512  | Ice Lake and later with AVX-512, Zen 4 and 5 |
| `avx512_skx` | 512  | Skylake-X, Cascade Lake, Cooper Lake         |
| `avx2`       | 256  | Haswell and later, Zen 1 to 3                |
| `sse4`       | 128  | Nehalem and later                            |
| `sve2`       | 128  | Neoverse N2 and V2, Cortex-A510 and later    |
| `neon`       | 128  | All of AArch64                               |
| `portable`   | 128  | All others                                   |

`trusted/target.rs` lists the features of each. A program has no copies below the target that it is compiled for. If one copy is left, the call is direct. Builds for Apple have no `sve2`. The big-endian, ILP32 and soft-float variants of x86-64 and AArch64 are not supported.

| Attribute                               | Copies                       |
| --------------------------------------- | ---------------------------- |
| `#[export]`                             | All but `avx512_skx`         |
| `#[export(long_running)]`               | All                          |
| `#[export(up_to = avx2)]`               | None for x86-64 above `avx2` |
| `#[export(up_to = avx2, up_to = neon)]` | `avx2`, `sse4` and `neon`    |
| `#[export(baseline)]`                   | The lowest of each family    |

Before Ice Lake, a core can lower its clock for about 0.7 ms after any 512-bit instruction. On a busy Cascade Lake server, one short search every 0.5 ms takes the clock from 3.1 to 2.7 GHz for all the code around it. So a kernel has to ask for `avx512_skx`. Ask only if one call runs long enough to make up for that.

## Why it is safe

rustc rejects a call to a `#[target_feature]` function from a function that lacks one of the features. It also rejects a safe pointer to it there. The functions in a copy have the attribute, and so does every op that calls an intrinsic. `if_supported!` is the only way in. It checks a list of features, then calls a function with the same list, which returns the pointer.

The other ops are `core::simd`, which is safe with any features. No op outside of `trusted` calls an intrinsic that takes a pointer. A wrong kernel returns a wrong result or panics. `rejected.md` has the attempts to get around this.

What you have to trust:

- **Detection.** A feature counts only if the CPU reports it and the system saves its registers. The same has to hold for every feature that it implies. `trusted/os.rs` makes the queries. The decoders are pure functions of the answers.
- **`if_supported!` and `AtomicFn`**, which stores the chosen pointer.
- **`opaque`**, which is `asm!` without an instruction.
- **`Out`, `Writer` and `spare_capacity`.** They write only initialized values, and count them. Miri runs their tests.
- **Access to shared memory.** A `SharedArrayBuffer` can change while a kernel reads it, so it is never a `&[u8]`. It is a `&[SharedU8]` for input and a `&[AtomicU8]` for output. Rust has no vector access that may race. `trusted/shared.rs` has an `asm!` load and store for each width, which stand for a relaxed access to each byte. This relies on the CPU not to tear a byte. The loops do not depend on two reads giving the same value.

## What the ops avoid

| Not emitted                                | Why                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| An AVX-512 mask near the end of a page     | 160 ns instead of 3 on Cascade Lake if the next page is missing or untouched                                                         |
| `vpcompress*` to memory                    | [Microcoded on Zen 4](https://lemire.me/blog/2025/02/14/avx-512-gotcha-avoid-compressing-words-to-memory-with-amd-zen-4-processors/) |
| `vpcompress*` that zeroes                  | [False dependency on Zen 4 and 5](https://github.com/golang/go/issues/81609)                                                         |
| `pext`, `pdep`                             | Microcoded on AMD before Zen 3                                                                                                       |
| Gathers, scatters, `vmaskmov`, `pcmpistr*` | Slow on many cores                                                                                                                   |
| SSE encodings in a copy for AVX2 or above  | A penalty at each switch between the two encodings                                                                                   |

LLVM can still pick such an instruction for plain code in a kernel. Read the disassembly of a new kernel.

## Tests

| Command                                                  | What it checks                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun run rust:test -p bun_simd`                          | Ops and loops against plain code, the dispatch, the programs in `rejected.md`            |
| `bun run rust:test -p bun_simd -- --include-ignored`     | The same with more inputs and alignments                                                 |
| `bun run rust:test -p bun_simd_kernels`                  | Kernels against plain code, on every target of the machine and the portable ones         |
| `bun run rust:test -p bun_simd_trusted`                  | Detection against what rustc knows of features and CPUs, `asm!` next to missing pages    |
| `bun run rust:miri -p bun_simd_kernels`                  | The kernels on the portable targets: uninitialized output, data races                    |
| `bun bd test test/internal/simd.test.ts`                 | Kernels, next to missing pages, against Highway. An instruction of each detected feature |
| The same with `BUN_SIMD_BENCHMARK=1`, on a release build | Prints times                                                                             |
| `bun scripts/verify-baseline.ts --simd-cpus`             | The same on emulated CPUs, and the instructions of each copy against its target          |

With the feature `test_support`, `limit_to` picks a target for the thread and nothing is cached. `portable32` and `portable64` then run a kernel at those widths on any machine.

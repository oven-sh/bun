# bun_simd

SIMD with dispatch at run time, in safe Rust. You write a kernel once. It is compiled once per target, and the first call picks the best copy that the CPU can run. The crate needs nightly Rust. It needs neither `std` nor another crate of Bun.

```rust
#![forbid(unsafe_code)]

#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn index_of_quote(text: &[u8]) -> usize {
        isa::find_first(text, |v| v.eq(b'"') | v.eq(b'\''))
    }

    #[export]
    pub fn to_upper(text: &mut [u8]) {
        isa::map_in_place(text, |v| v ^ v.in_range(b'a', b'z').to_vec() & 0x20);
    }
}

fn main() {
    assert_eq!(simd::index_of_quote(b"it's"), 2);
    let mut text = *b"it's";
    simd::to_upper(&mut text);
    assert_eq!(&text, b"IT'S");
}
```

| Folder        | Crate                  | What it has                                                                 |
| ------------- | ---------------------- | --------------------------------------------------------------------------- |
| `.`           | `bun_simd`             | The ops of each target, the drivers, the dispatch. `forbid(unsafe_code)`    |
| `trusted`     | `bun_simd_trusted`     | All the `unsafe`, and what it relies on                                     |
| `macros`      | `bun_simd_macros`      | The macros that copy a module. `forbid(unsafe_code)`, and they emit none    |
| `kernels`     | `bun_simd_kernels`     | Ports of Bun's kernels. `forbid(unsafe_code)`                               |
| `conformance` | `bun_simd_conformance` | Compares and times them against the kernels on Highway, inside a canary Bun |

## Writing a kernel

In a module with `#[foreach_target]`:

- `isa` has the ops of the target. `spec.rs` says what each op means.
- `isa::x128` has the same ops for 128 bits. A module with `#[foreach_width]` is compiled as `full` and as `x128`.
- `this_target` is the name of the copy: `use other::simd::this_target::helper;`
- A function with `#[export]` gets a function of the same name in the module itself, which dispatches. It cannot be generic.
- A load or a store takes an array of the size of a vector. Cut a slice with `as_chunks`, `first_chunk` and `split_last_chunk`.
- The drivers handle every length: `find_first`, `find_first_within`, `find_last`, `count`, `map`, `map_in_place`, `map_to_shared`. `Short` is for a text shorter than a vector, `bits_of` for a block of 64 bytes.
- `#[inline(always)]` works on free functions only.
- Trait methods and `const fn` do not get the features of the target, so they cannot call ops.
- Call ops in `for` loops and in the closures that you pass to a driver. A closure that goes to an adapter of `core`, such as `array::map`, may not be inlined.

## Targets

| Target       | Bits | CPUs                                          |
| ------------ | ---- | --------------------------------------------- |
| `avx512_icl` | 512  | Ice Lake and later with AVX-512, Zen 4 and 5  |
| `avx512_skx` | 512  | Skylake-X, Cascade Lake, Cooper Lake          |
| `avx2`       | 256  | Haswell and later, Zen 1 to 3                 |
| `sse4`       | 128  | Nehalem and later                             |
| `neon`       | 128  | All of AArch64                                |
| `portable`   | 128  | All others. It is the specification, and slow |

`trusted/gate.rs` lists the features of each. A program has no copies below the target that it is compiled for, and it calls directly where one copy is left.

| Attribute                 | Copies                    |
| ------------------------- | ------------------------- |
| `#[export]`               | All but `avx512_skx`      |
| `#[export(long_running)]` | All                       |
| `#[export(up_to = avx2)]` | `avx2` and below          |
| `#[export(baseline)]`     | The lowest of each family |

Before Ice Lake, a core can lower its clock for about 0.7 ms after any instruction on 512 bits. On a busy Cascade Lake server, one short search every 0.5 ms takes the clock from 3.1 to 2.7 GHz for all the code around it. So a kernel has to ask for `avx512_skx`. Ask only if one call runs long enough to make up for that.

## Why it is safe

rustc refuses a call to a function with `#[target_feature]` from one that lacks a feature, and refuses to make a safe pointer of it there. Every op and every function in a copy has the attribute. `if_supported!` is the one way in: it checks the features, and then calls a function with those features that returns the pointer. One list in `trusted/gate.rs` feeds the check, the attribute and the macros.

Ops are made of `core::simd` and of the intrinsics that take no pointer. A kernel that is wrong returns a wrong result or panics.

What has to be trusted:

- **Detection.** A feature counts only if the CPU reports it, the system saves its registers, and the same holds for all features that the compiler uses along with it. `trusted/os.rs` asks. The rest are pure functions of the answers.
- **`if_supported!` and `AtomicFn`**, which keeps the pointer that was picked.
- **Access to shared memory.** A `SharedArrayBuffer` can change while a kernel reads it, so it is a `&[AtomicU8]` and never a `&[u8]`. Rust has no vector access that is allowed to race. `trusted/shared.rs` has one instruction of `asm!` for each width, which stands for a relaxed access to each byte. This relies on the CPU not to tear a byte. The drivers read such a text once where the result depends on it.

## What the ops avoid

| Not emitted                                      | Why                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| A masked access near the end of a page           | 160 ns in the place of 3 on Cascade Lake if the next page is missing or untouched                                                    |
| `vpcompress*` to memory                          | [Microcoded on Zen 4](https://lemire.me/blog/2025/02/14/avx-512-gotcha-avoid-compressing-words-to-memory-with-amd-zen-4-processors/) |
| `vpcompress*` that zeroes                        | [False dependency on Zen 4 and 5](https://github.com/golang/go/issues/81609)                                                         |
| `pext`, `pdep`                                   | Microcoded on AMD before Zen 3                                                                                                       |
| Gathers, scatters, `vmaskmov`, `pcmpistr*`       | Slow on many cores                                                                                                                   |
| The encodings of SSE in a copy for AVX2 or above | A penalty at each change between the two                                                                                             |

LLVM can still pick such an instruction for plain code in a kernel. Read the disassembly of a new kernel.

## Tests

| Command                                                  | What it checks                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `bun run rust:test -p bun_simd`                          | Ops against `spec.rs`, drivers against loops, programs that rustc has to reject        |
| `bun run rust:test -p bun_simd -- --include-ignored`     | The same for all pairs of 16 bits and all alignments                                   |
| `bun run rust:test -p bun_simd_kernels`                  | Kernels against loops, on every target of the machine and the portable ones            |
| `bun run rust:test -p bun_simd_trusted`                  | Detection against what rustc knows of features and CPUs, `asm!` next to missing pages  |
| `bun bd test test/internal/simd.test.ts`                 | Kernels against Highway next to missing pages, an instruction of each detected feature |
| The same with `BUN_SIMD_BENCHMARK=1`, on a release build | Prints times                                                                           |
| `bun scripts/verify-baseline.ts --simd-cpus`             | The same on emulated CPUs, and the instructions of each copy against its target        |

With the feature `test_support`, `limit_to` picks a target for the thread, nothing is cached, and `portable32` and `portable64` run a kernel at those widths on any machine and under Miri.

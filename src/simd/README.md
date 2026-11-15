# bun_simd

SIMD with runtime dispatch, in safe Rust. You write a kernel once. It is compiled once per target, and the first call picks the best copy that the CPU can run. The crate needs nightly Rust. It does not need `std` or another crate of Bun.

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
- `#[export]` adds a function of the same name to the module itself, which dispatches. It cannot be generic.
- `this_target` is the name of the copy: `use other::simd::this_target::helper;`
- Trait methods, `const fn` and functions from a macro outside the module do not get the features of the target. They can use only the ops that need no intrinsic, and run baseline code unless they are inlined.
- `#[inline(always)]` becomes `#[rustc_force_inline]`. Use it only on functions that no other crate calls. If rustc reports a recursion limit, raise `#![recursion_limit]`.
- Name the module `simd`. The allowlists in `scripts/verify-baseline-static` match that name.

An op has the name that `core::simd` gives it, where there is one.

| File                   | Contents                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `vector.rs`, `mask.rs` | The ops that are the same code on every target                                         |
| `portable.rs`          | The definition of the other ops. `x86.rs` and `neon.rs` implement them with intrinsics |
| `algo.rs`              | `position`, `rposition`, `count`, `map` and others, for slices of any length           |
| `partial.rs`           | Loads and stores for a slice that is shorter than a vector                             |
| `source.rs`            | `load`, from plain or from shared memory                                               |

`load` and `store` take an array of the size of the vector, so they need no bounds check. Cut a slice with `as_chunks`, `first_chunk` and `split_last_chunk`.

Call ops in `for` loops and in the closures that you pass to `algo.rs`. LLVM may not inline a closure that goes through an adapter of `core`, such as `array::map`.

## Targets

| Target       | Bits | CPUs                                         |
| ------------ | ---- | -------------------------------------------- |
| `avx512_icl` | 512  | Ice Lake and later with AVX-512, Zen 4 and 5 |
| `avx512_skx` | 512  | Skylake-X, Cascade Lake, Cooper Lake         |
| `avx2`       | 256  | Haswell and later, Zen 1 to 3                |
| `sse4`       | 128  | Nehalem and later                            |
| `neon`       | 128  | All of AArch64                               |
| `portable`   | 128  | All others                                   |

`trusted/target.rs` lists the features of each. A program has no copies below the target that it is compiled for. If one copy is left, the call is direct.

| Attribute                 | Copies                    |
| ------------------------- | ------------------------- |
| `#[export]`               | All but `avx512_skx`      |
| `#[export(long_running)]` | All                       |
| `#[export(up_to = avx2)]` | `avx2` and below          |
| `#[export(baseline)]`     | The lowest of each family |

Before Ice Lake, a core can lower its clock for about 0.7 ms after any 512-bit instruction. On a busy Cascade Lake server, one short search every 0.5 ms takes the clock from 3.1 to 2.7 GHz for all the code around it. So a kernel has to ask for `avx512_skx`. Ask only if one call runs long enough to make up for that.

## Why it is safe

rustc rejects a call to a `#[target_feature]` function from a function that lacks one of the features. It also rejects a safe pointer to it there. The functions in a copy have the attribute, and so does every op that calls an intrinsic. `if_supported!` is the only way in. It checks a list of features, then calls a function with the same list, which returns the pointer.

The other ops are `core::simd`, which is safe with any features. No op calls an intrinsic that takes a pointer. A wrong kernel returns a wrong result or panics. `rejected.md` has the attempts to get around this.

What you have to trust:

- **Detection.** A feature counts only if the CPU reports it and the system saves its registers. The same has to hold for every feature that it implies. `trusted/os.rs` makes the queries. The decoders are pure functions of the answers.
- **`if_supported!` and `AtomicFn`**, which stores the chosen pointer.
- **Access to shared memory.** A `SharedArrayBuffer` can change while a kernel reads it, so it is a `&[AtomicU8]` and never a `&[u8]`. Rust has no vector access that may race. `trusted/shared.rs` has one `asm!` instruction for each width, which stands for a relaxed access to each byte. This relies on the CPU not to tear a byte. The loops do not depend on two reads giving the same value.

## What the ops avoid

| Not emitted                                | Why                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| A masked access near the end of a page     | 160 ns instead of 3 on Cascade Lake if the next page is missing or untouched                                                         |
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

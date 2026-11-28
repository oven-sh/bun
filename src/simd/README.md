# bun_simd

Safe SIMD with dispatch at run time. Write a kernel once: it is compiled for each target, and a call runs the best version that the CPU supports.

- **Safe.** Kernels need no `unsafe`.
- **On its own.** It is `no_std`, detects the CPU itself, and depends on nothing but its macros (`src/simd_macros`). Keep it that way: what is about Bun goes into `src/simd_kernels`, or into the crate that calls it.
- **Familiar names**, from `std::simd`, the scalar methods, slices and `Iterator`.
- **Every operation on every target**, for lanes from `u8` to `f64`, `f16` and `bf16`, in vectors of up to 512 bytes. A missing instruction only makes it slower.
- **Loops over slices** that take care of the tail.

```rust
#![forbid(unsafe_code)]

/// What kernels use.
#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;

    /// The first call detects the CPU.
    #[kernel]
    pub fn sum(bytes: &[u8]) -> u64 {
        over(bytes).sum_wide()
    }

    /// The closure gets a register of bytes.
    #[kernel]
    pub fn find_quote(text: &[u8]) -> Option<usize> {
        over(text).position(|v| v.simd_eq(b'"') | v.simd_eq(b'\''))
    }

    /// The loop can be your own.
    #[kernel]
    pub fn parity(bytes: &[u8]) -> u8 {
        let (vectors, rest) = over(bytes).exact(); // Whole registers, and the tail.
        let mut all = u8xN::load_or_default(rest);
        for v in vectors {
            all ^= v;
        }
        all.reduce_xor()
    }
}

fn main() {
    assert_eq!(simd::sum(&[2; 100]), 200);
    assert_eq!(simd::find_quote(b"say 'hi'"), Some(4));
    assert_eq!(simd::parity(&[7; 101]), 7);
}
```

Read [the guide][guide], find operations in [the index][index], and see [the page on speed][speed]. [Larger programs][programs] is about many files, objects and traits. [A table][highway] maps the names of
[Highway](https://github.com/google/highway), which inspired the crate.

## Names

- In marked code the target is the type parameter `S`. Types say it, as in `fn is_quote(v: u8xN<S>)`, and expressions leave it to the compiler.
- Constructors are functions of the type, and the rest are methods: `u8xN::load(slice)`, `v.store(slice)`. `u8xN` fills a register, and `u8x16` is fixed.
- A number or an array can stand for a vector: `v & 0x0f`, `m.select(0x20, 0)`.
- A plain name acts on the whole vector and gives the same result on all CPUs. What depends on the CPU ends in `_relaxed`. Functions such as `exp` have one result with FMA, and one without. Payloads of NaN can differ, and so can minima and maxima with a signaling NaN.

## In Bun

Add `bun_simd.workspace = true` to the dependencies of the crate, and the crate to those with `opt-level = 3` in the dev profile of the root `Cargo.toml`: without optimization kernels are slow.
A new target, or a kernel with features in quotes, needs lines in `scripts/verify-baseline-static/allowlist-*.txt`. `bun run rust:test -p bun_simd` runs the quick tests, on each target that the CPU has. `--features slow-tests` adds those that compare each operation with a scalar model. CI runs them on x64 and arm64 after a change in this directory or of the toolchain.
`cargo doc -p bun_simd --open` shows the pages with their links.

It needs LLVM 23 or later, also in a linker that makes code, and no flags. Rust 1.99 is enough.
What doesn't fit a width or an array is an [error of the build][panics], which `cargo check` and clippy don't show.
If a new compiler says "too big for the target architecture" of an operation in code that was built before, `--cfg bun_simd_misfits_panic` turns these errors into [panics], and leaves right programs as they are.
rust-analyzer sets `cfg(miri)`, which grays out some modules, unless `cargo.cfgs` has `!miri`.

## Safety

A crate with kernels can keep `#![forbid(unsafe_code)]`. Accesses are checked against the bounds of slices, and [can panic][panics]. An "unspecified" result is some value, which can differ between targets.
As all safe Rust, it relies on the compiler, and on the unsafe code of other crates. It also relies on what the CPU and the system report, and on the default modes of floating point (MXCSR, FPCR).

The crate itself has `unsafe` at about 75 sites: for dispatch, detection, instructions, accesses to memory, casts and hints to the compiler. Most modules forbid it.

## Targets

A target is a level plus features, such as `avx2 + aes`. The first in the list that the CPU supports is used, and `portable`, which runs anywhere, ends each list. Other architectures are skipped. A level has all to its left: `has!(neon)` holds on `sve2`.

| | Levels |
| --- | --- |
| x86-64 | `sse2` `sse4` `avx2` `avx512` `icelake` (the last two not on macOS) |
| AArch64 | `neon` `neon82` `neon86` `sve2` |

[The page on targets][targets] has all words, and the architectures that Bun is not built for.

## License

MIT, as Bun. `NOTICE` names what follows other projects, and `LICENSE-APACHE` is for what follows Highway.

[guide]: docs/guide.md
[speed]: docs/speed.md
[index]: docs/index.md
[programs]: docs/programs.md
[highway]: docs/highway.md
[targets]: docs/targets.md
[panics]: docs/panics.md

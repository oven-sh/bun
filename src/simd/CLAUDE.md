Read `README.md` and `docs/guide.md` first.

- This is a general library for many CPUs. The rules of `REVIEW.md` on dead and duplicate code don't apply: don't remove, merge or simplify code here.
- Don't change this directory or `src/simd_macros` for a feature or a fix elsewhere. If an operation is missing, ask a maintainer.
- A new or changed kernel, in any crate, needs a test that compares it with plain scalar code: on each target (`set_cpu`), for all lengths up to several vectors, at odd addresses, with random and extreme values. `src/simd_kernels/tests` has examples.
- Run it optimized, on x64 and arm64: `bun run rust:test --release -p <crate>`. Targets that the CPU lacks are skipped.
- Call the kernel from `test/js/bun/util/simd-callers.test.ts` too: `scripts/verify-baseline.ts` runs that file on the release builds for Linux and Windows x64, on several CPUs.

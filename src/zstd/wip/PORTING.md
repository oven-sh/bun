# Porting zstd 1.5.7 to safe Rust for Bun (`src/zstd`, crate `bun_zstd`)

Goal: replace the C library with a port that gives **byte-for-byte the same compressed output, the same decompressed
output and the same error codes** as the C code, for every input. It is checked by differential tests against the C
library, so "equivalent but different" algorithms are wrong whenever they can change a single output byte.

## Where things are

- C source (pin f8745da6 = v1.5.7, with Bun's two patches): `/root/zstd-ref/zstd/lib/`
- The same without comments/asserts-noise, quicker to read: `/root/zstd-ref/stripped/` (read the original when a
  comment would help to understand intent)
- The Rust crate: `/root/repos/oven-sh/bun/src/zstd/` (`common/`, `decompress/` are done and are the style reference;
  `compress/internal.rs` is the port of `zstd_compress_internal.h` and is what the parts of the compressor share)
- Reference C static libs: `/root/zstd-ref/build/ref/libzstd.a` (as Bun built it), `/root/zstd-ref/build/noasm/`
- Differential harness (not part of the repo): `/root/zstd-ref/harness/` (`src/c.rs` has the FFI to the C lib). Build:
  `. ~/.bun-dev-env && cd /root/zstd-ref/harness && RUSTFLAGS="--cap-lints=warn" cargo build --release`
  It is built with overflow checks and debug assertions ON, on purpose.
- Type-check the crate: `. ~/.bun-dev-env && cd /root/repos/oven-sh/bun && cargo check -p bun_zstd` (dead-code errors
  for items that nothing calls yet are expected while the port is incomplete; every other error is yours to fix).
  Lints: `cargo clippy -p bun_zstd` must have no finding in your files other than dead code.

## Hard rules

1. `#![forbid(unsafe_code)]`. No `unsafe`, no `core::arch`, no `std::simd`, no new dependencies.
2. **No panics**: the crate denies `clippy::indexing_slicing`, `unwrap_used`, `expect_used`, `panic`, `unreachable`.
   No `a[i]`, no `&a[i..j]`, no `.unwrap()`. Use `crate::util::SliceExt` (`at`, `at_mut`, `put`, `sub`, `sub_mut`,
   `span`, `span_mut`, `array_at`, `array_at_mut`, `move_within`, `write_at`) and `read_le16/24/32/64`,
   `write_le16/24/32/64`, all of which return `crate::error::Result<T>` (`Err(ErrorCode::Generic)` = "broken
   invariant, no input should cause it") and are used with `?`. Also avoid the std methods that panic
   (`split_at`, `copy_from_slice` on lengths that are not provably equal, `copy_within`, `chunks(0)`, `/ 0`, ...).
   Destructuring fixed arrays (`let [a, b, c] = arr;`), iterators, `zip`, `as_chunks`, `first_chunk`, `get` are good.
   An index masked to a power-of-two array length (`arr.get(i & (N - 1))`) lets LLVM drop the check.
3. **No arithmetic overflow**: debug and fuzz builds have overflow checks, and a failed check aborts the process.
   Wherever the C code relies on unsigned wrap-around (index arithmetic such as `curr - matchIndex`, `(U32)(a - b)`,
   hash multiplications, `offset_1 > maxRep` tricks, `x - 1` on a possibly-0 value) use `wrapping_*`. Shifts by a
   value that is not provably less than the width need a mask or `checked_sh*`. Casts: `as` truncates like C.
   Keep the C integer widths (`U32` -> `u32`, `size_t` -> `usize`, `int` -> `i32`, `U64` -> `u64`, `BYTE` -> `u8`,
   `S16`/`short` -> `i16`). All of Bun's targets are 64-bit little-endian, so drop `MEM_32bits()` branches and
   big-endian branches.
4. Functions that return `size_t` with error codes return `Result<usize>`; `ERROR(x)` is `Err(ErrorCode::X)`
   (`src/zstd/error.rs`). Keep the **same error code in the same order of checks**. Void C functions that need checked
   accesses return `Result<()>`.
5. Pointers become positions (`usize`) into slices. Never keep a reference where C keeps a pointer into a buffer
   that is mutated or that someone else owns: pass the slice down as a parameter.
6. Workspaces (`void* workSpace, size_t wkspSize`) become local arrays/structs or typed scratch structs. If a
   `wkspSize` check can fail for some *input* (not just for a programming error) keep it, computed from the C sizes.
7. C "templates" (FORCE_INLINE_TEMPLATE functions specialised by constant arguments, macro-generated variants) become
   `#[inline(always)]` generic functions with `const` generic parameters (or plain arguments that are constants at
   the call sites), plus small non-inline wrappers/dispatch `match`es, so that each variant is compiled separately as
   in C.
8. Drop what cannot be reached (listed per task), BMI2/ASM/NEON/SSE variants (keep the portable scalar code path that
   gives the same result), tracing, DEBUGLOG, and `assert`s (a few `debug_assert!`s on real invariants are welcome).
   PREFETCH is dropped.
9. Performance matters (this replaces optimised C): keep the structure of the hot loops, avoid allocation in them,
   avoid bounds checks where a cheap restructuring (iterators, chunking, masks, hoisted sub-slices) removes them, mark
   hot small helpers `#[inline(always)]`. But correctness and exact equivalence come first.

## Style

- Rust names in snake_case derived from the C names without the `ZSTD_`/`HUF_`/`FSE_`/`HIST_` prefix where the module
  already says it (e.g. `HUF_buildCTable_wksp` -> `huf::build_ctable`). Every ported function gets a one-line doc
  comment that starts with the C name in backticks: ``/// `HUF_buildCTable_wksp` `` plus a short sentence only if it
  says something a reader needs (a precondition, what is returned).
- Items are `pub(crate)` at most (`unreachable_pub` is denied), private when only the module uses them.
- Comments: few, short, plain English, about the code as it is. Never mention the porting process, this
  document, a conversation or "the original"; say "the C code" only when explaining a deliberate difference.
  No commented-out code. No `TODO`.
- `rustfmt` (run `cargo fmt -p bun_zstd`), lines up to 120 columns in comments. `#[rustfmt::skip]` on big tables.
- Workspace lints are strict (see `[workspace.lints]` in `/root/repos/oven-sh/bun/Cargo.toml`), e.g.
  `needless_pass_by_value`, `trivially_copy_pass_by_ref`, `large_types_passed_by_value`, `manual_memcpy`,
  `redundant_clone`, `precedence`, `implicit_saturating_sub`, `manual_swap`; `too_many_arguments`,
  `needless_range_loop` and `collapsible_if` are allowed.
- Do not edit files that are not yours (listed per task). If `compress/internal.rs`, `util.rs` or `common/` lacks
  something you need, add a helper to your own file and say so in your report.
- Do not run `git commit`, `git add`, `git stash` or anything else that changes the repository's history or index.

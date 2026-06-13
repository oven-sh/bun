# Pass 5 — Inverse Audit: Fuzzing a "Safe" Public API

**Audit type:** P5-D3 inverse audit. The bulk of this audit enumerates and
analyzes `unsafe` sites. The inverse question is: *do Bun's ostensibly-safe
public APIs (no `unsafe` in their signatures) actually stay panic-free on
adversarial input?*

**Status:** Completed. One crash class found (debug-only diagnostic-path
panic, fuzz-environment-induced; see Findings). 6.1 M additional executions
clean.

## Target picked + why

**Target: `bun_semver::Version::parse_utf8(&[u8]) -> ParseResult<u64>`**

Why this target:

- **Public, safe-signature.** No `unsafe` keyword in the function signature
  or its caller-visible types. A consumer who never types `unsafe` reasonably
  expects "no panic, no crash on any input bytes."
- **Pure Rust, no FFI in the parser itself.** `bun_semver` is a small,
  self-contained crate. The semver parser is unsigned-integer arithmetic +
  byte iteration; it doesn't talk to JSC, the event loop, or any C++.
- **Hot path.** Every `package.json` dependency string, every npm registry
  response, every lockfile entry feeds through this parser. If it panics on
  some attacker-controlled byte sequence, the whole package manager
  inherits the panic surface.
- **Mirrors a real porting risk.** `Version.rs` was recently ported from
  Zig; the Zig version used `std.fmt.parseUnsigned(u64, s, 10) catch null`
  and silently coerced overflow to zero. The Rust port preserves this but
  adds a debug-build `pretty_errorln!` diagnostic that is the proximate
  cause of the panic this fuzz run uncovered.

## Cargo.toml + harness body (so reviewers can re-run)

Layout used:

```text
.unsafe-audit/fuzz-inverse/
    Cargo.toml              # standalone (NOT a workspace member)
    build.rs                # compiles stubs.c
    stubs.c                 # scalar fallbacks for highway_* / simdutf__* C symbols
    fuzz_targets/parse.rs   # libfuzzer harness
    corpus/parse/           # 852 raw / 673 minimized seed inputs (post-run)
    artifacts/parse/        # crashes libfuzzer saves
    known-crashes/          # crashes recorded for re-test (moved out of artifacts)
```

`.unsafe-audit/fuzz-inverse/Cargo.toml`:

```toml
[package]
name = "bun_semver_fuzz_inverse"
version = "0.0.0"
edition = "2024"
publish = false

# Standalone crate — NOT a workspace member.
[workspace]

[package.metadata]
cargo-fuzz = true

[dependencies]
libfuzzer-sys = "0.4"
bun_semver = { path = "../../src/semver" }

[build-dependencies]
cc = "1"

[[bin]]
name = "parse"
path = "fuzz_targets/parse.rs"
test = false
doc = false
bench = false

[profile.release]
debug = 1
```

`fuzz_targets/parse.rs` (final form — includes the post-finding filter
that lets fuzzing continue past the known SOURCE_SET artifact):

```rust
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Skip inputs that hit the known SOURCE_SET panic path
    // (any run of 20+ consecutive ASCII digits — they may overflow u64
    // in parse_version_number and trigger the debug-only pretty_errorln!).
    // Real Bun callers init SOURCE per-thread, so this is fuzz-env-only.
    let mut run = 0usize;
    for &b in data {
        if b.is_ascii_digit() {
            run += 1;
            if run >= 20 { return; }
        } else { run = 0; }
    }
    let _ = bun_semver::Version::parse_utf8(data);
});
```

`build.rs` compiles `stubs.c`, a small C file providing scalar fallbacks for
the 9 `highway_*` symbols and 4 `simdutf__*` symbols normally supplied by the
main `bun bd` build (Google Highway SIMD + simdutf C++ libraries are linked
into `libbun_rust.a` by the top-level build, but `cargo fuzz` builds in
isolation). The fallbacks have the same observable semantics; they are
scalar (slow) but correctness, not speed, is what fuzzing needs. The
`simdutf__base64_*` stubs `abort()` if invoked so a hypothetical crash
through that path can't be misread as a parser bug.

### Reproducer

```bash
cd <repo-root>
cargo +nightly fuzz build parse --fuzz-dir .unsafe-audit/fuzz-inverse
cargo +nightly fuzz run parse --fuzz-dir .unsafe-audit/fuzz-inverse -- -max_total_time=120
```

Reproduce the minimal crash directly:

```bash
printf '66666666666666666666' > /tmp/repro.bin
/tmp/cargo-target/x86_64-unknown-linux-gnu/release/parse /tmp/repro.bin
# => thread '<unnamed>' panicked at src/bun_core/output.rs:1337:5:
#    assertion failed: SOURCE_SET.get()
```

## Run statistics

### Initial run (before filter — found crash)

```text
Run 1: cargo fuzz run parse -- -max_total_time=120
  executions:      16,817 before first crash
  exec/sec:        ~50k (estimated; libfuzzer reported 0 because crash hit
                   inside first second of mutation, before exec/sec stabilized)
  new units:       253 corpus units found before crash
  peak RSS:        40 MB
  slowest unit:    0 sec (no slow inputs)
  crash @ exec 16,817: 24-byte input, libfuzzer auto-minimization failed
                       below 24 bytes (coverage-equivalent), but the
                       semantically-minimal trigger is 20 bytes:
                       "66666666666666666666"
```

### Continuation run (with filter excluding 20+ digit runs)

```text
Run 2: cargo fuzz run parse -- -max_total_time=120
  executions:      6,140,701   <-- 6.14 MILLION runs, zero crashes
  exec/sec:        50,749
  new units:       3,912 corpus units added
  peak RSS:        465 MB (libfuzzer corpus growth)
  slowest unit:    0 sec  (no slow inputs; fast parser)
  crashes:         0
```

### Final coverage snapshot (replay corpus with runs=0)

```text
  corpus on disk:  852 files, total 151,793 bytes (max 4,082 b)
  minimized:       673 / 852 keepers
  edges covered:   544
  features:        2,432
```

## Crash — the one we found

### Reproducer

20 bytes:

```text
6666 6666 6666 6666 6666     (twenty '6's, 0x36)
```

(`0x36` repeated 20 times; equivalent to ASCII `"66666666666666666666"`.)

The libfuzzer-saved minimal artifact is 24 bytes
(`.unsafe-audit/fuzz-inverse/known-crashes/crash-035d0f8e4cb3161f86d185a3fa0ff045c7904ef3`)
because libfuzzer couldn't reduce coverage-equivalent length — but any
20-byte all-`'6'` slice (or any ≥20-digit run > `u64::MAX ≈ 1.844e19`)
triggers the same crash.

### Panic site

```text
thread '<unnamed>' panicked at src/bun_core/output.rs:1337:5:
assertion failed: SOURCE_SET.get()

stack backtrace:
   3: with_dest_writer<…>          at src/bun_core/output.rs:1337:5
   4: print_to                      at src/bun_core/output.rs:1421:5
   5: parse_version_number<u64>     at src/semver/Version.rs:710:21
   6: parse<u64>
   7: parse_utf8<u64>               at src/semver/Version.rs:122:9
```

### Mechanism

`parse_version_number` reads consecutive ASCII digits into a 20-byte stack
buffer, then calls `T::parse_ascii::<u64>` on the slice. `u64::MAX` is 20
digits (`18446744073709551615`), so any 20-digit run greater than that
overflows; `parse_ascii` returns `None`. Source:

```rust
// src/semver/Version.rs:704
if cfg!(debug_assertions) {
    return match T::parse_ascii(&bytes[0..byte_i as usize]) {
        Some(v) => Some(v),
        None => {
            // TODO(port): Output.prettyErrorln with @errorName — Rust parse
            // error doesn't carry a Zig-style tag name.
            bun_core::pretty_errorln!(
                "ERROR parsing version: \"{}\", bytes: {}",
                bstr::BStr::new(input),
                bstr::BStr::new(&bytes[0..byte_i as usize]),
            );
            Some(T::ZERO)
        }
    };
}

Some(T::parse_ascii(&bytes[0..byte_i as usize]).unwrap_or(T::ZERO))
```

`pretty_errorln!` ultimately calls `bun_core::output::with_dest_writer`,
which `debug_assert!`s `SOURCE_SET.get()`. `SOURCE_SET` is a thread-local
`Cell<bool>` set by `Source::init`/`Source::configure_thread`. Anything that
calls a `print_to`-family function from a thread that hasn't been configured
panics on `assertion failed: SOURCE_SET.get()`.

### Is this reachable in real Bun?

**Not from the official `bun` CLI.** Two reasons:

1. `bun`'s main entry initializes `Source` at startup, so the main thread
   always has `SOURCE_SET.get() == true`.
2. Every worker thread that touches `bun_semver` calls
   `Output::Source::configure_thread()` at thread startup, e.g.
   `src/install/PackageManagerTask.rs:214` and
   `src/threading/ThreadPool.rs:1196-1198`.

So this crash is a **fuzz-harness artifact** — a property of running
`bun_semver` from a bare libfuzzer binary that never wired up `Source`.

### But it surfaces two real findings

**Finding 1 (latent fragility):** The contract is *implicit*. Any future
caller — a new worker pool, an FFI embedder using `bun_semver` as a Rust
library, a unit test that imports the crate directly without configuring
output — will panic on debug-overflow inputs. The parser doesn't document
that it requires output initialization, and the `pretty_errorln!` call
itself is `cfg!(debug_assertions)`-guarded code that *should* be inert
diagnostic paint, not a hard runtime requirement.

**Finding 2 (silent vs. loud divergence):** Release builds silently coerce
u64 overflow to zero (`unwrap_or(T::ZERO)`), so `"66666666666666666666.0.0"`
parses as `0.0.0`. Debug builds emit a stderr diagnostic *and* return zero.
A more honest API would return `ParseResult::Err` on overflow in *both*
profiles, propagating the error to the caller (the lockfile / install path
already handles parse failures). This matches how npm itself rejects such
inputs.

### Suggested fix (out of scope for the audit, recorded for completeness)

Replace the `cfg!(debug_assertions)` branch with:

```rust
match T::parse_ascii(&bytes[0..byte_i as usize]) {
    Some(v) => Some(v),
    None => None,   // propagate overflow to caller
}
```

…and let `parse` itself decide whether to fall back to zero or surface the
error. This (a) eliminates the latent panic surface, (b) removes the
debug-vs-release semantic gap, and (c) drops a call into `bun_core::output`
from a code path that should be allocation-free and side-effect-free.

## Conclusion

**~6.16 M total executions across two 120-second runs, one crash class.**

The single crash class is a debug-only diagnostic-path panic reachable only
when the caller hasn't initialized `bun_core::output::Source` for the current
thread — a precondition Bun's main and worker threads always satisfy, but
the parser's contract doesn't advertise. For this overflow path, release
builds do not hit the diagnostic and instead silently coerce overflow to
zero.

Post-filter (excluding 20+ digit runs), **6,140,701 mutated inputs ran
without finding an additional crash**. This is useful negative evidence for
the exercised `bun_semver::Version` parser surface (separator handling, tag
parsing, build-metadata, pre-release identifiers, UTF-8 quirks), but it is a
fuzz result, not a proof of panic-freedom.

This **partially supports** the inverse-audit goal ("safe-signature parser
APIs should not crash on adversarial inputs"). The qualification: a debug-only
diagnostic in the parser introduces a fragile precondition (thread-local
output state) that isn't documented in the function's safe signature. The
fix is straightforward (drop the diagnostic or replace the unwrap-to-zero
with a real error). The fuzz run did not identify a release-mode crash in
this target.

## Re-running

```bash
# Build (re-uses cached compilation of bun_semver)
cargo +nightly fuzz build parse --fuzz-dir .unsafe-audit/fuzz-inverse

# 2-minute fuzz with the existing corpus
cargo +nightly fuzz run parse --fuzz-dir .unsafe-audit/fuzz-inverse \
    -- -max_total_time=120 -print_final_stats=1

# Replay corpus with no mutation (coverage report)
cargo +nightly fuzz run parse --fuzz-dir .unsafe-audit/fuzz-inverse \
    -- -runs=0 -print_final_stats=1

# Reproduce the saved crash
cargo +nightly fuzz run parse --fuzz-dir .unsafe-audit/fuzz-inverse \
    .unsafe-audit/fuzz-inverse/known-crashes/crash-035d0f8e4cb3161f86d185a3fa0ff045c7904ef3

# 20-byte manual minimal repro
printf '66666666666666666666' > /tmp/repro.bin
/tmp/cargo-target/x86_64-unknown-linux-gnu/release/parse /tmp/repro.bin
```

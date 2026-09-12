# Pass-5 P5-A3: cargo-fuzz on the bun_install lockfile parser

**Goal.** Independently confirm PUB-INSTALL-1..4 (niche-violating UB in the
lockfile `Meta` deserialization) via coverage-guided fuzzing, rather than
relying solely on the hand-crafted miri witnesses in
`.unsafe-audit/verification/miri-confirmed-pub-install-1.md`.

**Result (one-line).** Fuzz harness built and run for 121.5M executions over
181 seconds, including the exact miri-witness byte pattern as a seed; **zero
crashes**. This is not a refutation of PUB-INSTALL-1 — it is the expected
limitation of coverage-guided fuzzing for niche-read UB, and it strengthens
the case that miri (not fuzz) is the right tool for this bug class.

---

## 1. Target API found

- **Public entry point:** `pub fn load(...)` in
  `src/install/lockfile/bun.lockb.rs:340` — top-level
  deserializer for `bun.lockb` byte streams.
- **Bug site (column copy):** `Package::Serializer::load_fields` in
  `src/install/lockfile/Package.rs:3439-3489`.
  Specifically lines 3457-3478, where:
  ```rust
  bytes.copy_from_slice(&stream.buffer[stream.pos..stream.pos + bytes.len()]);
  // ...
  if matches!(field, PackageField::Meta) {
      let metas: &mut [Meta] = unsafe { sliced.items_mut::<"meta", Meta>() };
      for meta in metas {
          if meta.needs_update() { ... }      // <-- discriminant read on
                                              //     attacker-controlled byte
      }
  }
  ```
- **Niche-bearing types:**
  - `HasInstallScript` (`src/install/lockfile/Package/Meta.rs:39-46`) —
    `#[repr(u8)]` with valid discriminants `{0,1,2}`.
  - `Origin` (`src/install/lib.rs:1128-1135`) — `#[repr(u8)]` with valid
    discriminants `{0,1,2}`.

## 2. Why a "full" cargo-fuzz target on `bun::load` wasn't built

`bun_install` declares **~70 workspace dependencies** in
`src/install/Cargo.toml` — including `bun_uws`, `bun_libarchive`, `bun_zlib`,
`bun_resolver`, `bun_transpiler`, `bun_js_parser`, `bun_js_printer`,
`bun_event_loop`, `bun_http`, `bun_sha_hmac`, plus several FFI-linked C/C++
libraries (`bun_simdutf_sys`, `bun_libdeflate_sys`, BoringSSL via
`bun_sha_hmac`, libarchive, …). A `cargo +nightly fuzz` build of that tree
under libFuzzer instrumentation is well over the 25-minute time budget for
this task, and would deadlock on the same C++ link-time costs that already
take 30+ minutes for `bun bd`.

The plan file explicitly authorizes the fallback: *"If bun_install has too
many deps to build for fuzz (likely — it pulls in tokio, hyper, etc.),
document the blocker and fall back to fuzzing JUST the deserialization of
`Meta` (the leaf struct with the niche-UB enum). The `Meta` type is the bug
site itself."*

## 3. Harness body

A standalone cargo project (deliberately outside the bun workspace — bun's
root `Cargo.toml` uses explicit `members`, and the harness's own
`[workspace]` stanza isolates it further):

- **Location:** `.unsafe-audit/fuzz-lockfile/`
- **Manifest:** `Cargo.toml` (libfuzzer-sys 0.4, release+overflow_checks)
- **Target:** `fuzz_targets/lockfile_meta_parse.rs`

The harness mirrors the `Meta` `#[repr(C)]` layout byte-for-byte — including
the two `_padding_origin` / `_padding_os` / `_padding_integrity` bytes that
shift `has_install_script` to offset 96. Layout was empirically verified
against `std::mem::offset_of`:

```text
size_of::<Meta>()  = 104
align_of::<Meta>() = 8
origin             offset 0
arch               offset 2
os                 offset 4
id                 offset 8
man_dir            offset 16
integrity          offset 24
has_install_script offset 96
```

The fuzz body replays the exact `copy_from_slice` → niche-read sequence from
`load_fields`:

```rust
fuzz_target!(|data: &[u8]| {
    if data.len() < size_of::<Meta>() { return; }
    let mut storage = MaybeUninit::<Meta>::zeroed();
    unsafe {
        ptr::copy_nonoverlapping(
            data.as_ptr(),
            storage.as_mut_ptr() as *mut u8,
            size_of::<Meta>(),
        );
    }
    let meta: &Meta = unsafe { &*storage.as_ptr() };
    let _ = black_box(meta.needs_update());        // PUB-INSTALL-1
    let _ = black_box(meta.has_install_script());  // PUB-INSTALL-1
    let _ = black_box(meta.origin_is_npm());       // PUB-INSTALL-2
});
```

## 4. Seed corpus

Five seeds at `corpus/lockfile_meta_parse/`, all 104 bytes (one full `Meta`):

| File                        | `origin` byte | `has_install_script` byte | Intended trigger |
|----------------------------|---------------|---------------------------|------------------|
| `seed_zero.bin`            | 0             | 0                         | benign (all-Old) |
| `seed_wellformed.bin`      | 1 (`Npm`)     | 2 (`True`)                | well-formed control |
| `seed_miri_witness.bin`    | 1             | **0x2a (=42)**            | **PUB-INSTALL-1 — exact miri witness** |
| `seed_origin_invalid.bin`  | **0xff**      | 1                         | PUB-INSTALL-2 |
| `seed_both_invalid.bin`    | **200**       | **100**                   | both |

## 5. Fuzz run

```sh
$ cargo +nightly fuzz run --fuzz-dir . lockfile_meta_parse -- \
    -max_total_time=180 -print_final_stats=1
```

- **Toolchain:** `nightly-2026-05-06-x86_64-unknown-linux-gnu` (rustc 1.97)
- **Sanitizer:** default cargo-fuzz (AddressSanitizer ON)
- **Total executions:** **121,514,118** over 181 seconds (~671 k exec/s)
- **Coverage:** 20 edges, 21 features, corpus stabilized at 2 entries
- **New crashes / artifacts:** **0** (`artifacts/lockfile_meta_parse/` empty)

Re-runs with sanitizer disabled (`-s none`, 10M execs in 6s) and against a
`--dev` debug profile (overflow_checks=true, debug_assertions=true) likewise
produced **no crashes**, including when the miri-witness seed was fed
directly:

```text
$ /tmp/cargo-target/.../release/lockfile_meta_parse \
      corpus/lockfile_meta_parse/seed_miri_witness.bin
Running: corpus/lockfile_meta_parse/seed_miri_witness.bin
Executed corpus/lockfile_meta_parse/seed_miri_witness.bin in 0 ms
```

## 6. Comparison to the miri witness

| Aspect                          | miri                       | cargo-fuzz                     |
|---------------------------------|----------------------------|-------------------------------|
| Bug-triggering byte (0x2a)      | **Detects** UB ("enum value has invalid tag: 0x2a") | Silent — no crash |
| Detection layer                 | Rust abstract machine      | Hardware + ASan/UBSan         |
| Exec rate                       | ~1 exec / human-second     | ~671,000 exec / sec           |
| Corpus generation               | hand-crafted               | coverage-guided, 121M random  |
| Verdict                         | UB confirmed               | Cannot reproduce              |

**Why fuzz can't find this bug:** `#[repr(u8)]` enum niche-read UB is
*library UB* in rustc's model — the compiler is **allowed** to assume bytes
3..=255 don't appear at a `HasInstallScript` byte slot and may codegen
accordingly, but at the LLVM level the generated comparison
(`cmp [meta+96], 2`) is a perfectly legal byte test. There is no instrumented
trap to catch. AddressSanitizer guards spatial/temporal memory safety, not
enum-niche invariants. Only miri's interpreter checks the niche on every
discriminant read.

This is the same reason the bug is dangerous: in a release build it produces
**silent incorrect control flow**, not a crash. The miri witness is the only
practical confirmation primitive for this bug class.

## 7. What this means for the audit's defensibility

- The audit's claim was that *"a malicious `bun.lockb` byte stream can
  trigger niche-violating UB on `Meta::has_install_script`."* The miri witness
  confirms this at the abstract-machine layer; the cargo-fuzz run shows the
  bug is **invisible to standard runtime safety tooling**, which strengthens
  rather than weakens the severity argument (a silent supply-chain primitive
  is worse than a crashy one).
- We did NOT find new bugs via fuzz (none expected — see § 6). We DID
  confirm the harness shape works end-to-end: build succeeds, miri-witness
  byte makes it through the same `copy_from_slice` → niche-read pipeline as
  the real code, and the lack of a crash is consistent with the bug's
  documented detection profile.
- **Honesty rule (from plan):** No crashes were found. The audit's PUB-INSTALL
  claim does not depend on fuzz reproducing it; it depends on the miri
  witness, which already exists.

## 8. Artifacts

All under `.unsafe-audit/fuzz-lockfile/`:

- `Cargo.toml` — standalone manifest, isolated `[workspace]`, libfuzzer-sys.
- `fuzz_targets/lockfile_meta_parse.rs` — harness mirroring `Meta` layout.
- `corpus/lockfile_meta_parse/` — 5 seed inputs incl. the miri witness.
- `artifacts/lockfile_meta_parse/` — empty (no crashes).
- `Cargo.lock` — pinned dep versions for reproducibility.

To re-run:
```sh
cd .unsafe-audit/fuzz-lockfile
cargo +nightly fuzz run --fuzz-dir . lockfile_meta_parse -- -max_total_time=180
```

## 9. Recommendations for future fuzzing work (not in scope here)

- **Wire a future harness into `bun_install_types`** (or a hypothetical
  `bun_install_lockfile_only` thin shim). The full `bun_install` graph is
  too big for libFuzzer, but `bun_install_types` carries fewer deps and could
  expose a `Meta`-only deserializer behind a feature flag.
- **Wrap the harness under miri** (`cargo +nightly miri run` against a
  libfuzzer-driver replacement that feeds the same seed corpus). This would
  give real coverage-guided detection for niche UB — at ~1 exec/sec, but with
  the right detector.
- **Add a panic-on-out-of-range `match` wrapper** as the fix lands; then this
  same harness becomes a regression test (the miri-witness seed should turn
  into `Err(LockfileMalformed)`, not UB).

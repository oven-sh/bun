# w3-rust-codegen-flags — SKEPTIC

Scripts used for the re-derivations: `/tmp/skep/f4.py`, `/tmp/skep/f9.py`
(both run against `/tmp/canary/nm-dem.txt` and the real ELF section table of
`/tmp/canary/bun-linux-x64-profile/bun-profile`). The full disassembly of the
stripped canary is at `/tmp/skep/dis.txt`.

---

## VERDICT P1 (rust-flags/build-std-features-exact-spelling): **CONFIRMED**
-- with one quantified precision haircut. I re-derived the 0.1723 MB
**by ADDRESS, independently, from scratch** and reproduced every number
**exactly**: hit=156 addrs, PURE=147 / **180,648 B** (178,275 `.text` +
2,368 `.data` + 5 `.bss`), SHARED(excluded)=9 / **838 B**. I then attacked
every leg of the perf/reachability argument and could not break it — the
symbolizer is not *cold*, it is **UNREACHABLE** after `main()`'s 2nd
statement (0 `RUST_BACKTRACE` readers anywhere in `src/`+`scripts/`, exactly
ONE `set_hook` call site, no `take_hook`, the only gate is a compile-time
`const ENABLE: bool = true` at `crash_handler/lib.rs:562`). All THREE of the
report's corrections to SYNTHESIS2 row 8 are real, and #1 is **build-breaking
and proven word-for-word**: `rustc -Zbuild-std-features=panic-unwind foo.rs`
→ `error: unknown unstable option: 'build-std-features'` (I ran it on the
pinned toolchain). It is a **cargo** arg; row 8's "rust.ts:~380" spelling, if
put in the `rustflags` array (line 404+) instead of `args` (line 399), fails
the build. The F2 feature-exactness chain is now proven END-TO-END from
primary sources, including the one citation the report could only reach over
the network (verified below).

The haircut: **up to 4,307 B of the 180,648 B do NOT free.** The report's
classifier includes `std::sys::backtrace::{_print*,lock,BacktraceLock,
output_filename}` and the libunwind tracer (12 of the 147 addresses). But
std's `default_hook` body (`panicking.rs:240-312`, read from the installed
pinned rust-src) is **NOT** `feature = "backtrace"`-gated — only the gimli
SYMBOLIZE backend is (`backtrace/src/symbolize/mod.rs:444`:
`any(not(backtrace_in_libstd), feature = "backtrace")` → `noop` otherwise).
So the trace-and-print loop survives and prints raw `<unknown>` frames. True
delta: **176.3-180.6 KB = 0.168-0.172 MB.** Rounds to the same **0.17 MB**
— SYNTHESIS2 row 8's banked number is UNAFFECTED — but the report's
"CONFIRMED to the symbol" is ~2% high. Two corollaries: (a) the stated
regression is even MILDER than the report claims (a pre-`set_hook` panic with
`RUST_BACKTRACE=1` still gets an *unsymbolized* frame list, not nothing);
(b) the report's own F2(c) `backtrace-trace-only` aside already implied this.

P1 claims **0 new MB** and explicitly says "credit the 0.17 ONCE, to row 8."
Correct. **Not new money. Not a duplicate violation — it IS row 8, labelled.**

---

## EVIDENCE (every F, re-derived from primary sources)

### F8 — nm-dem.txt is DECIMAL radix: **CONFIRMED, DISPOSITIVE**
- `llvm-readelf-21 -S bun-profile`: `.text` vaddr `0x16c4a00`, size `0x344e35a`
  → `.text` = `[23,874,048, 78,785,882)` **decimal**.
- First `nm-dem.txt` symbol addr `0000000024033152`: as DECIMAL = 24,033,152
  (inside `.text`); as HEX = 604,385,618 (impossible). **QED.**
- Sum of all `.text` sizes BY ADDRESS, parsed decimal: **51.78 MiB** (60,405
  uniq addrs) vs real `.text` 52.31 MiB. A hex parse gives garbage.
- `size-facts.md:77` itself says `--radix=d`. The trap is real: the 16-digit
  zero-padded fields LOOK like nm's default hex. The report's own oracle
  (`Cache>::with_global` size field `0000000000018637` = 18,637 B) verified.
- **This is a genuinely load-bearing cross-cutting fact. Every wave-3 number
  from nm-dem.txt must be re-checked against it.**

### F4 — the 0.1723 MB derivation: **CONFIRMED TO THE BYTE, minus ≤4,307 B**
Independent script (`/tmp/skep/f4.py`), different code, same methodology:
```
hit addrs=156  PURE=147 (180,648 B = 0.1723 MiB)  SHARED(excl)=9 (838 B)
by section: {'t': 178275, 'b': 5, 'd': 2368}
top: 18637 gimli::Cache::with_global | 10833 gimli::Context::new |
     9376 miniz_oxide::inflate::core::decompress | 8254 gimli Unit::new | ...
```
Every figure matches the report. The 9 SHARED exclusions are all ICF-folded
`RawVec<T>::grow_one` (102 B each) aliased with live `bun_css`/`bun_install`/
`bun_ast` types — correctly excluded; I printed every alias group.
**Classifier completeness audit (things the report did NOT check):**
- `object::` (crate-qualified `object::read|elf|pe|macho`): **0** symbols. ✓
- `std::backtrace::` (the public API module): **0** symbols. ✓
- `std::panicking::default_hook`: 2 addrs / 818 B — SURVIVE, correctly NOT
  counted. `__rust_begin_short_backtrace::<T>` (16 addrs, 39 KB): these are
  the `std::thread::spawn` trampolines, nothing to do with the symbolizer —
  correctly NOT counted.
- False negative: `std::panic::get_backtrace_style` (179 B) + `SHOULD_CAPTURE`
  (1 B, `.bss`). Immaterial (and they survive anyway).
- **THE OVER-COUNT** (the one real error I found): 12 of the 147 PURE
  addresses = **4,307 B** are the PRINT LOOP + TRACER, not the symbolizer:
  `_print_fmt` + its closures, `lock`/`LOCK`/`BacktraceLock` + its
  `drop_in_place`, `output_filename`, `BacktraceFrameFmt::print_raw_with_column`,
  `backtrace_rs::backtrace::libunwind::trace::trace_fn`. I read the pinned
  rust-src: `sys/mod.rs:10 pub mod backtrace;` and `lib.rs:713-715
  mod backtrace_rs;` are **unconditional**; the `default_hook` call to
  `lock.print(err, PrintFmt)` (`panicking.rs:287-292`) is **unconditional**.
  Only `symbolize/mod.rs:444`'s cfg_if flips gimli→noop. So those 12 live on.
- Not counted anywhere (real upside): the anonymous `.rodata` string literals
  the 147 functions reference. Roughly offsets the over-count.

### F5 — derive(Debug) from the flag angle: **CONFIRMED to the byte**
- `<T as core::fmt::Debug>::fmt` by address: **116 uniq / 29,202 B** — EXACT.
- `core::slice::sort::` (dead-end 6's aside): **442 uniq / 684,898 B** — EXACT.
- `std::io::error::Error` is #1 at **2,823 B** — EXACT.
- `rustc -Z help`: "`none` prints nothing **and disables `{:?}`**" — the
  exact user-visible regression the report claims, from rustc's own help text.
- Nit: "7 of the top 10 are MANUAL impls" is really 6-7 of 10 (my top-10 has
  `Discriminant<bun_ast::expr::Data>`, not `Vec<u8>`). Immaterial.
- Dead-end #1 verdict **CONFIRMED dead**, and it correctly closes the brief's
  assigned item (a) WITHOUT re-proposing GT#8 / SYNTHESIS2's CONFIRMED-ZERO
  row. No duplication.

### F1 — the flag set: **CONFIRMED, every line number exact**
`rust.ts`: `:380 if (tier3 || cfg.release || cfg.asan)`; `:399
args.push("-Zbuild-std=core,alloc,std,proc_macro,panic_abort")` (in `args`,
the cargo argv); `rustflags` array starts at `:404`; `:418` static reloc;
`:422` frame pointers; `:451 -Cllvm-args=-addrsig`; `:466` target-cpu;
`:524 if (cfg.release && !cfg.assertions)` / `:525 -Zlocation-detail=none`;
`:592 if (cfg.crossLangLto)` → `:605/:606/:636/:649`;
`:716 if (cfg.crossLangLto)` → `:744 CARGO_PROFILE_RELEASE_LTO =
cfg.darwin || cfg.windows ? "off" : "fat"`. `config.ts:771` and `:800` exact.
`rustc 1.97.0-nightly (e95e73209)` + `cargo 1.97.0-nightly (4f9b52075)`: exact.
**Windows story CONFIRMED:** on a native Windows release, `crossLangLto=false`
(config.ts:800) and `lto=false` (config.ts:771) → `:744` never runs → the
workspace `Cargo.toml [profile.release] lto="fat"` applies → rustc emits
MACHINE CODE with its own intra-Rust fat LTO. `rust.ts:719-721`'s own comment
says exactly this. `-Cllvm-args` IS live on Windows.

### F2 — `-Zbuild-std-features=panic-unwind` exactness: **CONFIRMED END-TO-END**
This is the one F I could prove MORE completely than the report did:
- **(a)** I fetched cargo `standard_lib.rs` at the pinned commit `4f9b52075`.
  The default is literally `vec!["panic-unwind", "backtrace", "default"]`,
  and `CliFeatures::from_command_line(&features, false, /*uses_default_
  features*/ **false**)` — `default` is NOT implied in EITHER branch, so it
  must be (and is) explicit in the default list and absent from the proposal.
- **(b)** Installed pinned rust-src `library/sysroot/Cargo.toml`:
  `default = ["panic-unwind"]` — verbatim. So `{panic-unwind,backtrace,default}`
  resolves to `{panic-unwind,backtrace}` and `{panic-unwind}` = current minus
  backtrace, EXACTLY. Wave 1's "silently changes other std features" worry is
  proven unfounded on this nightly.
- **(c)** `library/std/Cargo.toml`: `backtrace = ['addr2line/rustc-dep-of-std',
  'object/rustc-dep-of-std', 'miniz_oxide/rustc-dep-of-std']` — verbatim.
  `backtrace-trace-only` + its "# Disable symbolization ... For use with
  -Zbuild-std" comment — verbatim.
- **Windows downgrade PROVEN** (the report only asserted it): std's Cargo.toml
  `[target.'cfg(not(all(windows, target_env = "msvc", not(target_vendor =
  "uwp"))))'.dependencies] miniz_oxide, addr2line` — the gimli deps are
  EXCLUDED on windows-msvc. dbghelp backend. The 0.17 does not transfer.
  Credit ~0 on Windows is correct.
- Also: `rust.ts:804-805` — bun ALREADY passes `-Zbuild-std-features=
  compiler-builtins-mem` for the windows shim, so the flag has an in-tree
  precedent on the exact pinned toolchain.

### F3 — the reachability root: **CONFIRMED and STRENGTHENED**
- `grep -rn 'Backtrace' src/ --include=*.rs` (the TYPE, capital B): **0 hits**.
- Cargo.lock: gimli/addr2line/miniz_oxide/object/rustc-demangle/backtrace =
  **0 of 6**; 281 packages total ✓.
- `bun_bin/lib.rs:153` `main`, `:158 bun_core::init_argv`, `:161
  bun_crash_handler::init()` — exact.
- `crash_handler/lib.rs:1749 pub fn init() { if !ENABLE { return; } ...
  :1783 install_hooks(); }` → `:1799 std::panic::set_hook(Box::new(
  rust_panic_hook))`. `ENABLE` is `pub(crate) const ENABLE: bool = true;`
  (`:562`) — a **compile-time dev toggle, not user-reachable**. No `take_hook`
  anywhere in the tree. The `:1796-1798` comment is quoted accurately.
- `rust_panic_hook` (`:1806-1835`) reads only `info.payload()`. Accurate.
- `:3183-3202`: spawns external `llvm-symbolizer`/`llvm-symbolizer-21`/
  `pdb-addr2line`. Accurate.
- **Strongest fact, which the report under-sold:** `RUST_BACKTRACE` has
  **ZERO readers** in all of `src/` and `scripts/`. Today, on the shipped
  canary, `RUST_BACKTRACE=1` is already a no-op for every post-`set_hook`
  panic. The 0.17 MB is not cold, it is statically-linked-but-unreachable.
- **TWO THINGS THE REPORT MISSED (neither hurts it):**
  1. `anyhow 1.0.102` IS in Cargo.lock — it `std::backtrace::Backtrace::
     capture()`s on nightly. But it enters ONLY via `packages/
     bun-native-plugin-rs` (the plugin-author SDK), not `bun_bin`, and the
     canary has **0** `std::backtrace::` symbols. Empirically dead. The PR
     description should mention it preemptively.
  2. **`src/bun_core/Global.rs:160-167` contains a STALE doc comment**
     claiming "the *current*-stack path below uses `std::backtrace` and
     stays symbolicated." There is no such code (0 `Backtrace` hits). A
     reviewer grepping `std::backtrace` will hit it and bounce the PR. Fix
     it in the same change.

### F6 — `-Zlocation-detail=none` already fully effective: **CONFIRMED**
- `<redacted>` count in the stripped canary: **1** — EXACT.
- The surviving `.rs` strings are all explicit `todo!("… (file.rs:N)")`
  MESSAGE literals, including the report's exact example
  `(src/bundler/bundle_v2.rs:3288)`. **Nit: I count 8, not 6**
  (OutputFile.rs:291; bundle_v2.rs:3288/3413/7063; production.rs:1431;
  LinkerGraph.rs:770; p.rs:7959/7966). ~300 B; 0 bytes is left on the axis
  either way. `rust.ts:513-526` and `crash_handler/lib.rs:1824-1826` quoted
  accurately.

### F7 — `-Cllvm-args` inert on the linux release: **CONFIRMED** (could not refute)
Three independent legs: (1) bun's own `rust.ts:593` "emit LLVM bitcode (not
machine code) into the .a" + `:730-737` "rustc pre-merges every crate into
ONE summary-less regular-LTO module, which lld then merges" + the
`rust_lto_fix` edge (which only makes sense on bitcode) → the Rust
contribution to the linux link IS bitcode; all MachineFunction/MC passes for
it run inside lld's LTO backend, not rustc. (2) lld's LTO config sets
`Options.EmitAddrsig = (icf == Safe)` itself — the F7 addrsig corollary,
verbatim. (3) `rust.ts:442-448`'s own stated rationale for
`-Cllvm-args=-addrsig` is the Windows/non-LTO `.pdata` problem (#53159) —
bun's comment agrees with F7. **An additional proof the report did not
have:** rustc's codegen backend forces `merge_functions = false` for the
`PreLinkFatLTO`/`PreLinkThinLTO` stages (i.e. exactly the `-Clinker-plugin-
lto` stages). So rustc's `-Zmerge-functions` is provably dead on linux too.
w3-machine-outliner's entire linux proposal depends on this fact; it holds.

### F9 — the stack-protector GT#7 correction: **CONFIRMED EXACTLY**
On the real stripped canary (`/tmp/canary/bun-linux-x64/bun`):
- `llvm-readelf --dyn-syms` → `UND __stack_chk_fail@GLIBC_2.4`: **present**.
- `llvm-objdump -d | grep -c 'fs:0x28'` → **1082**. `stack_chk_fail` → **400**.
  Both EXACT.
- I bisected every `fs:0x28` address into the decimal nm-dem.txt symbol
  table: **317 unique enclosing functions** — EXACT. 252 begin with `std::`
  literally, and every single one of the remaining 65 is ALSO
  libstdc++/libsupc++ (return-type-prefixed `void std::__facet_shims…`/
  `std::__convert_to_v`/`std::__cxx11::basic_string`; libsupc++ EH internals
  `get_adjusted_ptr`/`get_ttype_entry`/`_GLOBAL__sub_I_eh_alloc.cc`;
  `__gnu_cxx`; `__cxxabiv1`; `__cxa_*`; `__gxx_personality_v0`;
  `__dynamic_cast`; the `d_*` cp-demangle family). **100% prebuilt
  libstdc++/libsupc++. 0 from bun / JSC / ICU / any dep bun compiles.**
  libstdc++ is statically linked (not in NEEDED).
- The dominant namespaces (`__facet_shims`/`moneypunct`/`numpunct`/`locale`)
  are exactly Tier-B1's iostream/locale set, consistent with "239/317".
- **So: GT#7's "NO stack protector on linux" is LITERALLY FALSE as an
  absolute; the report's correction is airtight — AND GT#7's INTENT (no
  accidental flag taxes bun's own ~60k functions) fully survives. ~6-10 KB,
  not a flag bun controls. Correct to record and not chase.**

### F10 / dead-end #2/#8 — **CONFIRMED** (one terminology nit)
- `Cargo.toml:352 lol_html = { path = "vendor/lolhtml" }` — exact line.
  NIT: `Cargo.toml:105`'s own comment calls it a "**non-member** path
  dependency", not a "workspace" member. Same conclusion (one cargo build,
  one `CARGO_ENCODED_RUSTFLAGS`).
- `deps/lolhtml.ts`: `build: () => ({ kind: "none" })` — exact; FETCH-only.
  `scripts/build/CLAUDE.md`'s "`cargo` — invoke cargo build (lolhtml)" is
  indeed STALE (the line is still there today).
- `-Cpanic=immediate-abort` at `rust.ts:832` is REAL, with the `:827-828`
  comment: "the new (nightly ≥ 2025-12) spelling of the old
  `-Zbuild-std-features=panic_immediate_abort`". Dead-end #2's disqualifier
  (destroys `rust_panic_hook`'s payload → destroys bun.report's panic
  message) is correct and verified against `:1829-1834`.

---

## THE ONE OMISSION (challenges "EXHAUSTED", not the money)

The report's F7/dead-end-#7 sweep names every relevant flag EXCEPT
**`-Zvirtual-function-elimination`** (in `rustc -Z help` on the pinned
nightly: "enables dead virtual function elimination optimization. Requires
`-Clto[=[fat,yes]]`"). I disposition it so nobody re-opens it:
(a) it is known-incompatible with `-Clinker-plugin-lto` (bun's linux path);
(b) the canary has **0** named Rust vtable symbols (`grep '::{vtable'` →
0), so the `dyn Trait` surface in bun is near-zero and the ceiling is ~0;
(c) it is an unstable, miscompile-prone flag. **0 MB. Properly dead.**
(Also unnamed but ~0: `-Zoom=abort` — bun routes alloc failure through its
own handler.) The "EXHAUSTED" headline survives; the enumeration was 99%.

## DUPLICATION / DISCARDED-LIST CHECK: **CLEAN**
- P1 **IS** SYNTHESIS2 TIER-A row 8. The report says so in its first
  sentence, books 0.172 against row 8's 0.17, and instructs the synthesizer
  to credit once. This is the correct handling, not a duplicate.
- Nothing from SYNTHESIS2 §D (DISCARDED) is re-opened. Dead-end #1
  CONFIRMS the `derive(Debug)` CONFIRMED-ZERO row (as the brief explicitly
  assigned — "CONFIRM from the flag angle ... not to re-propose"). Dead-end
  #5 cites the already-shipped `-Zlocation-detail`. Dead-end #3 defers to
  the single A-GATED `share-generics` row. Dead-end #7's
  `-Cmin-function-alignment`/frame-pointers entries stay perf-locked.
- No byte is claimed twice.

## WHAT THE SYNTHESIZER SHOULD TAKE (actionable, all zero new MB)
1. **P1's exact 3-line change IS the literal Tier-A row-8 PR text.** Use it
   verbatim, with one wording fix in its comment: the gate does NOT "mirror"
   `:524` — it is `:524`'s condition **plus `!cfg.asan`** (intentional, per
   its own next sentence). And add the `Global.rs:160-167` stale-comment fix
   to the same PR so a `std::backtrace` grep comes back clean.
2. **F8 (decimal radix) must be broadcast.** It is dispositive, trivially
   re-checkable (the `.text` address-range test above), and invalidates any
   wave-3 number whose script did `int(size, 16)`.
3. **F9 is a real, exact correction to GT#7** — already re-proven here to
   the function. Record it; it is not money.
4. **F7 is the fact `w3-machine-outliner` cannot proceed without** — now
   independently supported by three legs including rustc's PreLink
   MergeFunctions disable.
5. The "Rust `-C`/`-Z` flag space is EXHAUSTED" headline **STANDS**, with
   `-Zvirtual-function-elimination` added to the dead list at ~0.

## credible NEW (non-duplicate) total MB for this unit: 0
(linux 0, windows 0 — exactly as the report self-declares. Its value is the
PR-ready spelling for an already-banked row, one build-breaking correction to
that row, and three verified ground-truth/methodology facts other units
depend on. The flag avenue is closed; I could not find a byte it missed.)

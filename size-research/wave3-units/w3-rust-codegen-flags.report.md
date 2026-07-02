# w3-rust-codegen-flags

## REPORT

### unit: w3-rust-codegen-flags

### headline
The Rust `-C`/`-Z` flag space is **EXHAUSTED**. After two passes (this unit +
w2-rust-{mono,debug-fmt,cold-crates}) there is **no new money** in rustc/cargo
flags. Every lever either (a) is already set, (b) is already a banked SYNTHESIS2
row, or (c) is a real perf/diagnosability regression. The value of this unit is:
1. The **mechanical proof** that `-Zbuild-std-features=panic-unwind` (SYNTHESIS2
   row 8, 0.17 MB) is EXACTLY right on the pinned toolchain, plus the correct
   file, the correct ARG LIST (not RUSTFLAGS), and a gate correction that
   preserves the `release-assertions` debug experience. (My brief's item (e).)
2. Two **factual corrections to the ground truth** that will prevent other
   units from over-counting: (i) `nm-dem.txt` sizes are DECIMAL (`--radix=d`)
   — I over-counted 3.8x before catching it, and so will anyone else;
   (ii) GT#7's "NO stack protector on linux" is false in the absolute: the
   shipped canary has **400 `call __stack_chk_fail` sites / 1,082 `%fs:0x28`
   canary accesses across 317 functions** — all from the prebuilt
   **libstdc++/libsupc++** (not a flag bun controls; ~6-10 KB; 239/317 are
   inside Tier-B1's iostream set).
3. A **coordination fact w3-machine-outliner needs**: on the linux release
   (`crossLangLto=true`), rustc emits BITCODE — `-Cllvm-args=<backend-opt>`
   never reaches codegen. The machine outliner / MergeFunctions must be a
   LINKER flag (`-Wl,-mllvm,...`) to affect the linux binary. On Windows
   (no LTO) the rustc spelling DOES work.

### findings (the evidence)

**F1. The release build's exact rustc/cargo flag set, read from source.**
`scripts/build/rust.ts`:
- `:380` — `if (tier3 || cfg.release || cfg.asan)` →
  `:399 args.push("-Zbuild-std=core,alloc,std,proc_macro,panic_abort")`.
  **`-Zbuild-std` IS active on every release build. NO `-Zbuild-std-features`
  is passed.**
- `:418` `-Crelocation-model=static` (linux/freebsd) — its own comment
  documents a measured ~561 KiB `.data.rel.ro`→`.rodata` move. Already done.
- `:422` `-Cforce-frame-pointers=yes` — deliberate (bun.report). Perf-locked.
- `:451` `-Cllvm-args=-addrsig`.
- `:466` `-Ctarget-cpu=haswell`.
- `:524-526` `if (cfg.release && !cfg.assertions) rustflags.push("-Zlocation-detail=none")`.
- `:592-650` `if (cfg.crossLangLto)`: `-Clinker-plugin-lto`,
  `-Cembed-bitcode=yes`, and (linux) `-Zsplit-lto-unit`,
  `-Cforce-unwind-tables=no`.
- `:744` `CARGO_PROFILE_RELEASE_LTO = "fat"` on linux (rustc PRE-MERGES every
  crate into one summary-less bitcode module; `rust-lto-fix-cli.ts` bolts on a
  regular-LTO summary; lld then LTO's the union).
`scripts/build/config.ts:771` `ltoDefault = release && (linux || darwinCross)
&& ci && !assertions && !asan`; `:800` `crossLangLto = lto && !(windows &&
host==windows)`. → **linux CI release: crossLangLto = TRUE (rust is bitcode).
windows release: lto = FALSE (rust is MACHINE CODE; rustc's own intra-Rust
`lto="fat"` applies).**
`Cargo.toml:130-135` `[profile.release] lto="fat", codegen-units=1,
debug="line-tables-only", panic="abort"` — matches GT#6 exactly.
Pinned toolchain: `rust-toolchain.toml` → `nightly-2026-05-06` =
`rustc 1.97.0-nightly (e95e73209)` + `cargo 1.97.0-nightly (4f9b52075)`.
Both are installed locally and were queried directly.

**F2. (brief item e) `-Zbuild-std-features=panic-unwind` is mechanically
EXACT on the pinned toolchain.** Three independent facts:
(a) cargo's default when `-Zbuild-std-features` is absent, read at the exact
    shipped cargo commit
    (`gh api repos/rust-lang/cargo/contents/src/cargo/core/compiler/standard_lib.rs?ref=4f9b52075`,
    lines 81-88): `vec!["panic-unwind", "backtrace", "default"]`.
(b) the pinned nightly's `library/sysroot/Cargo.toml` (read from the installed
    rust-src at `$SYSROOT/lib/rustlib/src/rust/library/sysroot/Cargo.toml`):
    `[features] default = ["panic-unwind"]`. → explicitly passing
    `panic-unwind` alone loses NOTHING from `default`. **Wave 1's worry that
    the explicit list "silently changes OTHER std features" is UNFOUNDED on
    this nightly** (on pre-2024 nightlies `default` also carried
    `std_detect_file_io` / `std_detect_dlsym_getauxval`; those features no
    longer exist).
(c) `library/std/Cargo.toml`: `backtrace = ['addr2line/rustc-dep-of-std',
    'object/rustc-dep-of-std', 'miniz_oxide/rustc-dep-of-std']`. There is
    also a NEWER feature, `backtrace-trace-only` ("Disable symbolization in
    backtraces. For use with -Zbuild-std"), which keeps
    `std::backtrace::Backtrace::capture()` (addresses) and drops only the
    symbolizer — a zero-risk fallback IF bun ever needed the std API.
    Today bun has ZERO callers, so plain `panic-unwind` is strictly better.

**F3. The symbolizer's reachability root is `std::panicking::default_hook`,
which bun makes dead at the 2nd statement of `main()`.**
- `grep -rn 'Backtrace::capture|backtrace::|Backtrace\b' src/ --include=*.rs`
  → **0** callers of the std backtrace API anywhere in bun.
- `Cargo.lock` (281 packages): `gimli`, `addr2line`, `miniz_oxide`, `object`,
  `rustc-demangle`, `backtrace` → **0 of 6 present.** They exist in the canary
  ONLY via `-Zbuild-std`'s `backtrace` std feature. Zero false positives.
- bun's crash handler symbolizes by **spawning the external** `llvm-symbolizer`
  / `pdb-addr2line` binaries (`src/crash_handler/lib.rs:3186-3199`), never the
  in-process Rust symbolizer.
- `src/bun_bin/lib.rs:153-161`: `main()` statement 1 = `bun_core::init_argv`,
  statement 2 = `bun_crash_handler::init()` →
  `src/crash_handler/lib.rs:1783 install_hooks()` →
  `:1799 std::panic::set_hook(Box::new(rust_panic_hook))`. The std
  `default_hook` (the ONLY caller of the symbolizer, via `panic_with_hook`'s
  `Hook::Default` arm) is **statically linked but dynamically unreachable for
  the entire process lifetime** after that line. The `rust_panic_hook` body
  (`:1806-1828`) reads only `info.payload()` (the message string) — it never
  touches `std::backtrace`.
- The maintainers' own comment (`:1796-1798`): "Without this hook, a bare
  `panic!` would print the std default hook..." — i.e. the std default hook is
  explicitly the thing they do NOT want.

**F4. The symbolizer's size, measured correctly (by ADDRESS, ICF-alias-
corrected, DECIMAL radix).** Classifier: any symbol whose demangled name
contains `gimli::` / `addr2line::` / `miniz_oxide::` / `backtrace_rs::` /
`rustc_demangle::` / `std::sys::backtrace::{_print,output_filename,
BacktraceLock,lock}`. Substring (NOT prefix) matching is REQUIRED: the
symbolizer is monomorphized over `gimli::EndianSlice<LittleEndian>` and
LTO-inlined into `<core::cell::once::OnceCell<...addr2line...>>::try_init`,
`core::slice::sort::*::<gimli::...>`, etc., so a `^gimli::` prefix sees only
6% of it. Then dedupe BY ADDRESS and EXCLUDE any address that also carries a
non-symbolizer name (9 such: ICF-folded `RawVec<T>::grow_one` bodies shared
with live `bun_css`/`bun_install` types, 838 B — those bytes do NOT free).
Result (`python3` over `/tmp/canary/nm-dem.txt`, script at
`/tmp/w3-rust-codegen-flags/{aliascheck,final}.py`):

    PURE set: 147 addresses, 180,648 B = 0.1723 MB
      by section: .text 178,275  .data 2,368  .bss 5
    SHARED (excluded): 9 addresses, 838 B
    top: gimli::Cache::with_global 18,637 | gimli::Context::new 10,833 |
         miniz_oxide::inflate::core::decompress 9,376 |
         gimli::read::dwarf::Unit::new 8,254 | OnceCell<addr2line::Lines>
         try_init 7,898 | rustc_demangle DemangleStyle::fmt 3,184 | ...

**0.1723 MB. == SYNTHESIS2 row 8's banked 0.17 MB, CONFIRMED to the symbol.
This is NOT new money.** (I first derived 0.662 MB by mis-parsing
nm-dem.txt's DECIMAL sizes as hex — see F8.)

**F5. (brief item a) derive(Debug) from the flag angle: CONFIRMED ~0, and
here is WHY.** Every `<T as core::fmt::Debug>::fmt` in the canary, by
address: **116 impls, 29,202 B = 28.5 KB total.** Why only 116 survive out
of hundreds of `derive(Debug)`s in `src/`: rustc's demand-driven
**monomorphization collector** (not LTO — so it holds on Windows too; GT#8)
only codegens a `Debug::fmt` something CALLS. The ONLY callers are:
  (1) `core::result::unwrap_failed(msg, &dyn Debug) -> !` — every
      `Result<T,E>::unwrap()/expect()` roots `<E as Debug>::fmt` through a
      vtable. This is why the biggest survivors are error types:
      `std::io::error::Error` (2,823 B, #1), `core::num::ParseIntError`,
      `cssparser::BasicParseErrorKind`, `lol_html::SelectorError`.
  (2) A literal `{:?}` in a LIVE user-visible format string.
  (3) Derived impls of FIELD types of (1)/(2), recursively.
7 of the top 10 are MANUAL impls in std / 3rd-party crates
(`std::io::Error`, `core::time::Duration`, `str`, `OsStr`, `bstr::BStr`,
`core::alloc::Layout`, `Vec<u8>`) that `-Zfmt-debug=shallow` would NOT
touch (shallow only stubs DERIVED impls).
→ ceiling: `-Zfmt-debug=none` < 29 KB AND it makes `{:?}` render NOTHING
   (user-visible error messages like `panic: {err:?}` become empty);
   `-Zfmt-debug=shallow` < ~15 KB AND collapses every `{:?}` of a bun type
   to just the type name. **DEAD both ways, now quantified.**

**F6. (brief item b) `-Zlocation-detail=none` is ALREADY SHIPPED and FULLY
EFFECTIVE; nothing is left.** The stripped canary contains exactly **1**
`<redacted>` string (the single shared `Location::file` all `#[track_caller]`
sites now point at, collapsed by lld's string merge) and only **6** `.rs`
strings — and those 6 are explicit `todo!("... (src/bundler/bundle_v2.rs:3288)")`
MESSAGE literals written by bun developers, not Locations (~250 B total).
The maintainers' own design rationale is written at `rust.ts:513-526` and
restated at `crash_handler/lib.rs:1824-1826` ("the location would be
`<redacted>:0:0` anyway"). **0 bytes left on this axis.**

**F7. (brief item d) `-Cllvm-args` is INERT on the linux release — the
critical fact w3-machine-outliner needs.** Under `-Clinker-plugin-lto`
(linux, `rust.ts:605`) rustc emits BITCODE; the MachineFunction passes
(MachineOutliner, ICF addrsig emission, trap-unreachable lowering, the
MergeFunctions pass placement) run inside **lld's LTO backend**, driven by
lld's own `cl::opt` namespace, not rustc's. `-Cllvm-args=X` parses `X` into
rustc's process-local LLVM `cl::opt`s — options that only act at ISel/MC
time never make it into the bitcode. Consequences:
  - `-Cllvm-args=-enable-machine-outliner` in RUSTFLAGS does **NOTHING** on
    linux. The only spelling that reaches the linux binary is a LINKER flag:
    `-Wl,-mllvm,-enable-machine-outliner` (or `--plugin-opt=`) in `flags.ts`
    `linkFlags` — which then covers Rust AND C++ AND the WebKit `-lto`
    prebuilts in one LTO unit, as a **RELINK-ONLY** experiment.
  - On **Windows** (no LTO, `config.ts:771`), rustc codegens machine code, so
    `-Cllvm-args=...` in RUSTFLAGS IS live there.
  - Corollary: the existing `rust.ts:451 -Cllvm-args=-addrsig` is a no-op on
    the linux LTO path (lld's LTO emits addrsig itself when `--icf=safe` is
    requested) and is load-bearing only for the non-LTO (Windows / local
    release) path. 0 bytes either way; worth a comment update, not a change.
  - Same logic: `-Ztrap-unreachable` (the `ud2` after noreturn calls) is
    decided by lld's TargetMachine on linux (default FALSE on
    x86_64-linux-gnu), so the knob is already moot there.

**F8. METHODOLOGY TRAP (every wave-3 unit must know this).**
`/tmp/canary/nm-dem.txt` was produced with `--radix=d`: the address AND the
size columns are **DECIMAL**. A script that does `int(size, 16)` inflates a
5-digit size by ~5.4x. I produced a "0.662 MB breakthrough" this way before
a spot-check against a raw `grep` of the file caught it. The
by-ADDRESS-not-by-NAME rule from SYNTHESIS2 §E.7 is necessary but not
sufficient; the radix is a SECOND independent trap.
Verification oracle anyone can run: `grep 'Cache>::with_global::<' nm-dem.txt`
→ size column reads `0000000000018637`; the real symbol is 18,637 B, not
0x18637 = 99,895 B.

**F9. GT#7 CORRECTION: there ARE stack-protector instances in the shipped
linux canary — but not from anything a flag controls.**
`llvm-readelf --dyn-syms bun` → `UND __stack_chk_fail@GLIBC_2.4`.
`llvm-objdump -d bun | grep -c 'fs:0x28'` → **1,082** canary loads/checks;
`grep -c stack_chk_fail` → **400** fail-call sites; mapping each `%fs:0x28`
back to its enclosing symbol in the unstripped profile → **317 unique
protected functions**, and their namespaces are: 252 `std::` (libstdc++),
plus `__gnu_cxx`, `__cxxabiv1`, `__gxx_personality_v0`, `__dynamic_cast`,
and the `d_*` family (= `cp-demangle.c`, the `__cxa_demangle` impl).
**All 317 are from the statically-linked prebuilt libstdc++/libsupc++**,
which the distro GCC builds with `-fstack-protector-strong`. ZERO are from
bun's own code, JSC, ICU, or any dep bun compiles (GT#7 holds for those).
Size: ~6-10 KB (317 x ~20-30 B). **239 of the 317 are inside Tier-B1's
iostream/locale set** (they go away with B1); the residue is `__cxa_demangle`
(SYNTHESIS2 already lists it as LOAD-BEARING) + EH personality. Not money;
not a flag; a precise correction so nobody chases the `__stack_chk_fail`
symbol again.

**F10. Other facts established for completeness.**
- `lol_html` (the one vendored RUST crate) is a **workspace path dependency**
  (`Cargo.toml:352`), built inside the ONE `cargo build -p bun_bin` with the
  full `CARGO_ENCODED_RUSTFLAGS`. The `deps/lolhtml.ts` entry is FETCH-only
  (`build: () => ({ kind: "none" })`). No second, differently-flagged Rust
  build exists. (The `scripts/build/CLAUDE.md` line "`cargo` — invoke cargo
  build (lolhtml)" is stale documentation.)
- `-Zbuild-std`'s explicit crate list does NOT build `test`; `proc_macro` is
  built for the host resolver only and **0** `proc_macro::` / `std_detect::` /
  `object::` / `panic_unwind::` symbols exist in the canary.
- `std::process::` (9 B), `std::net::` (0), `std::sync::mpmc/mpsc` (0),
  `std::fs::` (558 B), `compiler_builtins` (2.2 KB): there is NO hidden dead
  std subsystem beyond the backtrace feature.
- rustc default symbol mangling on this nightly is v0 (confirmed by the
  `{closure#0}`/`::<T>` demangled shapes). Affects only `.strtab`, which the
  post-link strip removes. 0.
- x86_64-unknown-linux-gnu target-spec: `"default-uwtable": true` (countered
  by `rust.ts:649 -Cforce-unwind-tables=no` on the linux LTO path; the rust.ts
  comment "the prebuilt std bitcode keeps its own uwtable attrs" is STALE —
  with `-Zbuild-std` std is rebuilt with the same flag), `"plt-by-default":
  false`, `relro-level: full`.

### proposals

#### P1 — rust-flags/build-std-features-exact-spelling
*(This is NOT new money. It is the mechanical verification + the literal
copy-pasteable change for SYNTHESIS2 TIER-A ROW 8 ("std-backtrace-off",
0.17 MB), which SYNTHESIS2 only sketched as "rust.ts:~380". It closes my
brief's explicitly-assigned item (e). Credit the 0.17 ONCE, to row 8.)*

- **saving_mb: 0.172 linux** (ALREADY BANKED as row 8's 0.17 — do NOT add).
  Derivation (BY ADDRESS, decimal, ICF-pure): 147 unique addresses carrying
  only symbolizer names, 180,648 B (178,275 .text + 2,368 .data + 5 .bss)
  = 0.1723 MiB. Full breakdown in F4. Independently matches, to 2 decimal
  places, the number two wave-2 units and their skeptics converged on.
- **confidence: very high.** The root set is provably closed (F3): 0 bun
  callers, 0 Cargo.lock entries, one reachability root
  (`std::panicking::default_hook`) made dead at `main()`'s 2nd statement.
- **perf: neutral** (literally never-executed code after `set_hook`). Arguably
  a micro-improvement: 0.17 MB less file to mmap and relocate. No hot path
  touches any of the 147 functions.
- **regression (precise, word-for-word for the PR):** a Rust panic occurring
  in the window between `main()` entry and `std::panic::set_hook` at
  `crash_handler/lib.rs:1799` — i.e. inside `bun_core::init_argv` or the
  first half of `bun_crash_handler::init()` — with `RUST_BACKTRACE=1` set,
  no longer prints a Rust-native symbolized backtrace. It STILL prints
  `thread 'main' panicked at <location>: <message>` and still aborts into
  bun's signal handlers. After `set_hook`, behavior is byte-identical to
  today (bun's hook never reads `RUST_BACKTRACE` or `std::backtrace`).
  `std::backtrace::Backtrace::capture()` (0 bun callers) becomes disabled.
  Nothing else.
- **windows: yes but small (~0.02-0.06 MB, cite SYNTHESIS2's 0.06; credit 0).**
  On `*-windows-msvc`, std's `backtrace` feature selects the **dbghelp**
  symbolizer backend, NOT gimli/addr2line/miniz_oxide — so the 0.17 does not
  transfer. The flag is still correct and harmless to apply unconditionally.
- **files + the literal change** (`scripts/build/rust.ts`, inside the existing
  `if (tier3 || cfg.release || cfg.asan)` block, immediately AFTER line 399):

  ```ts
  args.push("-Zbuild-std=core,alloc,std,proc_macro,panic_abort");   // :399 (existing)
  // Drop std's default `backtrace` feature. It pulls the in-process DWARF
  // symbolizer (gimli + addr2line + miniz_oxide + rustc-demangle, 0.17 MB
  // of .text) whose ONLY caller is std::panicking::default_hook — which bun
  // replaces with its own hook as the 2nd statement of main()
  // (bun_bin/lib.rs:161 -> crash_handler install_hooks). bun has zero
  // std::backtrace callers and none of the symbolizer crates are in
  // Cargo.lock; crash reports symbolize out-of-process (llvm-symbolizer /
  // bun.report). `sysroot`'s `default` feature on the pinned nightly is
  // exactly ["panic-unwind"], so this is precisely "current minus backtrace".
  // Gate mirrors -Zlocation-detail=none (rust.ts:524): release-assertions /
  // release-asan keep the symbolized std backtrace for local debugging.
  if (cfg.release && !cfg.assertions && !cfg.asan) {
    args.push("-Zbuild-std-features=panic-unwind");
  }
  ```

  **THREE implementation corrections vs what SYNTHESIS2 row 8 says:**
  1. It is a **CARGO arg** (belongs in the `args` array next to `-Zbuild-std`
     at line 399), NOT a RUSTFLAG. rustc has no `-Zbuild-std-features`; putting
     it in the `rustflags` array (which starts at line 404 — the "rust.ts:~380"
     hint is ambiguous between the two) fails the build with
     `error: unknown unstable option`.
  2. It needs the `!cfg.assertions && !cfg.asan` gate, mirroring the existing
     `-Zlocation-detail=none` gate at `:524`. An unconditional append inside
     the `:380` block would ALSO strip the symbolized backtrace from
     `release-assertions` / `release-asan` builds, whose documented purpose
     is "panic messages are read locally" (`rust.ts:521-522`). Row 8 as
     written regresses those developer profiles.
  3. CI oracle (add to the release job, exactly as row 8's skeptic asked):
     `llvm-nm --demangle build/release/bun | grep -cE 'gimli::|addr2line::|miniz_oxide::|rustc_demangle::'`
     must print `0`.
- **effort: small** (the 3 lines above).
- **relink_only: NO** — `-Zbuild-std` feeds cargo, so it is a full
  `cargo build -p bun_bin` rebuild + relink (std + every dependent crate
  recompiles). ~40 min serialized.

*(No other proposal. Everything else I examined is a dead end below.)*

### dead_ends

1. **`-Zfmt-debug=none` / `=shallow` (brief item a). DEAD — quantified.**
   Total `<T as core::fmt::Debug>::fmt` in the canary: **116 impls, 29,202 B
   = 28.5 KB** (F5). `none`'s ceiling is <29 KB AND it makes every `{:?}` in
   a live format string (user-visible error output) render NOTHING.
   `shallow` only stubs DERIVED impls; 7 of the top 10 survivors are MANUAL
   impls in std/3rd-party crates, so its ceiling is <~15 KB, and it still
   collapses `{:?}` of every bun type to just the type name. The flag-angle
   reason the number is tiny (and holds on Windows, where there is no LTO):
   rustc's **demand-driven monomorphization collector** never codegens an
   uncalled Debug impl; the 116 survivors are each rooted by a live
   `Result::unwrap()/expect()` (`unwrap_failed` takes `&dyn Debug`) or a
   live `{:?}`. Independently re-proves GT#8 / the entire
   w2-rust-debug-fmt avenue from the flag side, as the brief asked.

2. **`-Cpanic=immediate-abort` (the last panic lever; the shim build already
   uses it at `rust.ts:832`). DEAD — it breaks bun's OWN crash reporting.**
   It removes the `fmt::Arguments` payload at EVERY panic site — but
   `rust_panic_hook` (`crash_handler/lib.rs:1806-1828`) reads
   `info.payload().downcast_ref::<&str|String>()` to put the panic MESSAGE
   into the bun.report trace string. With `immediate-abort` there is no
   hook, no payload, and no message: a `panic!("...{dynamic}...")` carrying
   runtime state becomes a bare `ud2` (SIGILL). The maintainers deliberately
   chose `panic=abort` + hook + `-Zlocation-detail=none` as the line; this
   crosses it. (The shim uses it ONLY because it is a `#![no_std]` launcher
   PE with no crash reporter.) Size not quantified further — the lever is
   qualitatively disqualified regardless of magnitude.

3. **`-Zshare-generics=on` (brief item c). ALREADY BANKED** — SYNTHESIS2
   A-GATED row, 0.25 MB, one proposal across two wave-2 units. w2-rust-mono
   F4/F7 did the per-family quantification (0.461 by-name → 0.25-0.29
   corrected) and F7 confirmed the flag appears nowhere in the build.
   I add nothing; see SYNTHESIS2 for the benchmark gate. One new supporting
   fact: because `-Zbuild-std` is active, `core`/`alloc`/`std` are ORDINARY
   crates in the graph, so `share-generics` also de-duplicates the std
   generics — w2-rust-mono's count already includes them. Do not re-count.

4. **`-Cllvm-args=-enable-machine-outliner` / rustc-side `-Zmerge-functions`
   (brief item d). INERT on the linux release.** Owned by the F7 mechanism.
   Hand off to w3-machine-outliner: the linux lever is
   `linkFlags: -Wl,-mllvm,-enable-machine-outliner` in `flags.ts`
   (RELINK-ONLY), which covers Rust + C++ + the WebKit `-lto` prebuilts in
   one shot. The RUSTFLAGS spelling is live only on Windows (no LTO) and on
   local non-LTO linux release builds. 0 new money claimed here.

5. **`-Zlocation-detail` (brief item b). CLOSED — 0 bytes left.** Already
   shipped at `rust.ts:524`; exactly 1 `<redacted>` string and 6 explicit
   `todo!()` message strings (~250 B) remain in the stripped canary (F6).

6. **`optimize_for_size` std feature** (`-Zbuild-std-features=panic-unwind,
   optimize_for_size`). Its own doc line: "Choose algorithms that are
   optimized for binary size **instead of runtime performance**" (it swaps
   driftsort for insertion/heapsort, etc.). PERF-LOCKED by definition.
   Noting it because `core::slice::sort::*` is 684,898 B / 442 addresses in
   the canary (by address, decimal) — a large, tempting target — but the
   ONLY flag-level lever for it is this one, and it is dead. The non-flag
   levers are w2-rust-mono P2/P4 + its un-claimed follow-on pool.

7. **`-Csymbol-mangling-version`**: only affects `.strtab`; stripped. 0.
   **`-Zno-unique-section-names`**: output `.shstrtab` is already tiny. 0.
   **`-Zdefault-visibility=hidden`**: `.dynsym` is already minimal. 0.
   **`-Ztrap-unreachable=no`**: moot (F7 — lld's backend decides on linux;
   LLVM's `TargetOptions::TrapUnreachable` defaults false on
   x86_64-linux-gnu). 0.
   **`-Zpanic-in-drop=abort`**: moot under `panic=abort`. 0.
   **`-Zcross-crate-inline-threshold` / `-Zinline-mir*`**: change the
   MIR-level inlining that full LTO re-decides anyway; size effect
   unpredictable in sign, perf effect unpredictable in sign, and no way to
   bound either from the shipped binary. Not worth a 40-min rebuild per
   guess. DEAD.
   **`-Zhint-mostly-unused`**, **`-Zno-embed-metadata`**: compile-time /
   rlib-size only. 0.
   **`-Cmin-function-alignment`**: function alignment is 0.52 MB but
   perf-locked (both syntheses). DEAD.
   **`-Cforce-frame-pointers=yes`**: deliberate (bun.report). Perf-locked.
   **Per-package `opt-level="z"` on `std`/`core`/`alloc`**: pre-killed by
   SYNTHESIS2 §E.5's rule (un-foldable O3/optsize twins of every shared
   generic) AND the perf constraint (std IS the hot path). DEAD.
   **rustc-side stack protector (`-Zstack-protector`)**: already `none`
   (rustc's default on every target); the 317 protected functions in the
   canary are the prebuilt libstdc++ (F9), not reachable by any rust or
   clang flag bun sets. DEAD, with the GT#7 correction on record.
   **`-Zthreads`**: local-only, 0 size. **PGO flags**: unwired in CI
   (SYNTHESIS2 §E.6). Not a size item.

8. **The "lol_html gets different rustflags" hypothesis (the /GS- shape).
   FALSE.** It is a workspace path dep inside the one cargo build (F10).

### overlaps

- **SYNTHESIS2 TIER-A row 8** (`std-backtrace-off`, 0.17): P1 IS that row.
  Confirms its number to the symbol, corrects its implementation spec on
  three points, and downgrades its Windows transfer to ~0 (dbghelp backend,
  not gimli). **Credit the 0.17 exactly once.**
- **w3-machine-outliner**: F7/dead-end #4 is the mechanics it needs — the
  LINUX lever is a `-Wl,-mllvm,...` LINKER flag (relink-only), not a
  RUSTFLAG; the rustc spelling is Windows-only.
- **w3-lto-pipeline**: one un-quantified lead I could not resolve from the
  flag space — on linux, the rust code goes through **TWO** full LTO
  pipelines (rustc's `CARGO_PROFILE_RELEASE_LTO=fat` pre-merge at
  `rust.ts:744`, documented in `rust-lto-fix-cli.ts`'s header as required
  for the `EnableSplitLTOUnit` consistency check, THEN lld's full-LTO on
  the union). If rustc's pre-merge also runs the O3 LTO optimization
  pipeline before handing the module to lld, the inliner runs twice over
  all Rust code. `lto="off"` is explicitly documented as broken
  (`rust.ts:737-743`), so the only possible lever is inside rustc's
  pre-merge pass selection. I cannot quantify or even sign it; flagging it
  only because nobody has named it.
- **w3-binary-archaeology / the synthesizer / EVERY wave-3 unit**: F8 (the
  decimal-radix trap) is a cross-cutting methodology correction. Any
  wave-3 number derived from `nm-dem.txt` with a hex parse is 2-6x
  inflated.
- **w3-cpp-compile-flags**: F9 (the 317 libstdc++ stack-protector
  functions) is in their lane nominally, but the answer is "not a flag
  bun controls" — included here so they do not re-derive it.

### bottom line for the synthesizer
New linux money from this unit: **0 MB.** New Windows money: **0 MB.**
What it delivers instead: (1) the exact, PR-ready spelling + gate for an
already-banked 0.17 MB TIER-A row that was otherwise likely to be
implemented wrong twice over; (2) two ground-truth corrections (the
nm-dem.txt radix, the libstdc++ stack protector) that protect other
units' numbers; (3) the `-Cllvm-args`-is-inert-under-LTO fact that
w3-machine-outliner's entire linux proposal depends on; (4) a defensible
"this avenue is exhausted" with every `-C`/`-Z` flag individually
dispositioned. Per the preamble, the dead ends are the deliverable.

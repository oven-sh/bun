# REPORT
## unit: w3-ci-pipeline-audit

**Scope of this unit:** Dylan's "could be a subtle build step in CI". Audit end-to-end:
`.buildkite/ci.mjs`, `scripts/build/{ci,profiles,flags,config,bun}.ts`, `scripts/binary-size.ts`,
`.buildkite/scripts/*`, `.github/workflows/release.yml`, `packages/bun-release/`.
**Top-line verdict first, because it is the most valuable single sentence this unit can produce:
the CI pipeline is HONEST. There is no hidden MB between the size annotation and the user's
disk.** I `cmp`'d the real GitHub-release `bun-linux-x64/bun` against the tracked binary for
BOTH 1.3.14 and the canary — byte-identical, both — and I account for every byte of the real
Windows PE. Dylan's hypothesized mystery step does not exist. What I DID find is ~33 KB of
new, byte-exact, zero-perf-cost linux items (a literal bug class: all-zero data shipped as
file bytes because of 1-2 sentinel bytes), a Windows parity item worth 0.173 MB, one upgraded
confirmation of a Tier-B row, and several load-bearing facts other wave-3 units need.

---

### findings

**F1. (Q1) The tracked bytes ARE the released bytes on Linux — proven with `cmp`, not argued.**
`scripts/build/ci.ts:420-423` (`packageAndUpload`): after the strip rule runs,
`binary-size:<triplet>` meta-data := `statSync(output.strippedExe).size`, and the SAME
`strippedExe` is zipped into `<triplet>.zip` by `cmake -E tar cfv --format=zip`. That zip
flows unchanged through `.buildkite/scripts/upload-release.sh` → `gh release upload` + S3.
I downloaded the real release assets (`gh release download`) and ran:
```
cmp rcanary/bun-linux-x64/bun /tmp/canary/bun-linux-x64/bun   -> IDENTICAL (76,889,912 B)
cmp r1314/bun-linux-x64/bun   /tmp/official/bun-linux-x64/bun -> IDENTICAL (92,752,752 B)
```
92,752,752 B = 88.46 MiB and 76,889,912 B = 73.33 MiB — exactly size-facts' ledger.
`packages/bun-release/` (npm channel) only `chmod`s the binary (`fs.ts:135`,
`upload-npm.ts:156`); it never re-strips or rewrites. **The ledger's linux baselines are
exact; nothing is hidden.**

**F2. (Q1) The ONE exception is Windows: Authenticode signing happens AFTER size tracking.**
`ci.mjs:944-973` (`getWindowsSignStep`) + `.buildkite/scripts/sign-windows-artifacts.ps1`:
a dedicated `windows-sign` step downloads `<triplet>.zip` from `*-build-bun`, runs
`smctl sign` on `bun.exe` IN PLACE, re-packs with the same `cmake -E tar --format=zip`,
and re-uploads under the SAME name; `upload-release.sh` pins to `--step windows-sign`
(ci.mjs:1041). This runs AFTER `binary-size:<triplet>` is recorded.
Measured from the real PEs:
  - bun-v1.3.14 `bun.exe`: `CertificateTableSize: 0x2858` = **10,328 bytes**, starting
    exactly at end-of-`.reloc` (0x5DE8800); file = 98,480,216 B = **93.92 MiB** (the exact
    1.3.14 windows baseline in size-facts).
  - canary `bun.exe`: `CertificateTableRVA/Size: 0x0` — UNSIGNED. `ci.mjs:1574`:
    *"DigiCert charges per signature, so canary builds are never signed."* File =
    79,821,312 B; every byte accounted for (Σ RawDataSize + 1,024 header bytes = 79,821,312).
**Consequence:** the ledger's 93.92 MiB windows baseline INCLUDES a 10,328-byte signature
that the CI tracker's number (recorded pre-sign) never will. A ~10 KB pessimistic skew, not
a saving. Also: `binary-size.ts:128-131`'s comment "Windows binaries differ by several MB
between [canary and release]" is NOT reproducible as a same-commit build delta — the ONLY
build-arg difference is `--canary=off` (ci.mjs:573-574 → `IS_CANARY:bool` +
`CANARY_REVISION:&str` in `buildOptionsRs.ts:51-52`). PR #29500's "several MB" was
cross-commit noise. Do not chase it.

**F3. (Q2) Strip per platform — CONFIRMED, and the linux residual after PR #33224 is 656 B.**
- linux (all abis) → GNU `strip` (binutils, `tools.ts:504-507`) with `--strip-all`
  [+ `-R .eh_frame -R .eh_frame_hdr -R .gcc_except_table`, gnu-abi-only, `flags.ts:1465-1467`].
- darwin → `llvm-strip` + Mach-O section removals + an ad-hoc re-sign.
- **windows → NO STRIP: a literal file copy** (`bun.ts:726-735`). I VERIFIED this is
  correct, not a gap: the canary PE has `PointerToSymbolTable: 0x0` (no COFF symtab) and
  its only debug artifact is the 28-byte debug-directory entry + a 97-byte CodeView record.
  lld-link output is already "stripped".
- The on-disk canary PREDATES PR #33224 (it still has `.symtab` 25,104 + `.strtab` 16,376 +
  legacy `.hash` 8,104). I re-ran #33224's exact strip spelling on it: **-41,632 B**.
  **That is ALREADY BANKED in the -56.7 KB #33224 number. Do not re-count it.**
- NEW residual after #33224: GNU `strip --strip-all` leaves `.comment` (276 B — the
  compiler/linker version strings) and `.note.stapsdt` (232 B — libstdc++'s 3
  `libstdcxx:{throw,catch,rethrow}` SDT probes from the statically-linked `libstdc++.a`).
  Measured by running the exact strip invocation plus the two `-R`s: **-656 B**.

**F4. (Q3) The `.bun` section in the LINUX release binary is 16,384 bytes of PURE ZEROS,
plus 11,100 bytes of zero alignment padding in front of it — 27,484 bytes of nothing.**
Measured: `dd`+`od` over the canary's `.bun` (file 0x493c000, 16,384 B) → 0 nonzero bytes;
the 0x49394a4→0x493c000 gap (11,100 B) → 0 nonzero bytes. Root cause,
`src/jsc/bindings/c-bindings.cpp:1057-1078`:
```c
#define BLOB_HEADER_ALIGNMENT 16 * 1024
struct BlobHeader { uint64_t size; uint8_t data[]; } __attribute__((aligned(BLOB_HEADER_ALIGNMENT)));
extern "C" BlobHeader __attribute__((section(".bun"), aligned(BLOB_HEADER_ALIGNMENT), used)) BUN_COMPILED = { 0 };
```
An over-aligned struct's `sizeof` rounds up to its alignment, so an 8-byte header becomes
a 16,384-byte object, AND the section's 16 KB `sh_addralign` forces the 11,100-byte file pad.
**PROVEN not load-bearing on ELF** (read all three consumers): `exe_format/elf.rs:213`
`write_bun_section` places the payload at `align_up(max_vaddr_end, page_size)` — it is
independent of the original section's size/alignment — and only writes 8 bytes at the
original offset; `elf.rs:439 find_bun_section` reads only `sh_offset` + the index (no
size/alignment check); the runtime (`StandaloneModuleGraph.rs:346`) reads the 8-byte
vaddr via `Bun__getStandaloneModuleGraphELFVaddr()`. Windows has NO compile-time `.bun`
section at all (the PE path ADDS one, `pe.rs:542`). macOS is DIFFERENT (the 16 KB object
is a real data container there — `size` is a LENGTH, the payload lives in `data[]`); gate
the change to ELF and do not touch darwin.
Bonus in the same span: `.bun_err` (2,788 B, ALL ZEROS). It is the Rust `err!` macro's
per-site `AtomicU16` interning slots; `src/bun_core/lib.rs:1134`'s own doc comment says
they *"land in `.bss` for free"* — **they do not**, because
`#[unsafe(link_section = ".bun_err")]` makes LLVM emit the output section `@progbits`
(LLVM's `getELFSectionType` only emits `SHT_NOBITS` for names matching `.bss`/`.bss.*`/
`.tbss`/`.tbss.*`). A 2,788-byte gap between the author's stated intent and the binary.

**F5. `bun_core::output::SOURCE` — 8,528 bytes in `.tdata`, of which exactly 2 are nonzero.**
The canary's `.tdata` is 9,080 B (1.3.14's was 280 B — this is a post-1.3.14 regression)
and only 42 bytes of it are nonzero. The unstripped symbol table attributes 8,528 B to
`bun_core::output::SOURCE::{const#0}::__RUST_STD_INTERNAL_VAL` (shndx 20 = `.tdata`).
Byte-level: the only 2 nonzero bytes are at SOURCE+8523 and SOURCE+8527, both `0x80` —
the high bytes of two little-endian `0x80000000` u32s.
Source chain (all read): `src/bun_core/output.rs:273`
`static SOURCE: RefCell<Source> = const { RefCell::new(Source::ZEROED) }` →
`Source::ZEROED.{raw_stream,raw_error_stream} = Self::ZEROED_STREAM = File::ZEROED =
Fd::INVALID` → `src/bun_core/util.rs:945`: `pub const INVALID: Fd = Fd(i32::MIN)`.
Two 4-byte sentinel fds drag the whole `RefCell<Source>` — **including its two all-zero
`[u8; 4096]` buffers (8,192 B)** — from `.tbss` (zero file bytes) into `.tdata`
(file-backed, AND memcpy'd by glibc into every thread's TLS block at `pthread_create`).
The constant is literally NAMED `ZEROED` and documented as "Field-wise placeholder value".

**F6. B6 windows confirmation (new EVIDENCE, not new money).** The two 16,384-byte
all-zero WTF/JSC config sections (`__DATA,__jsc_opcodes`, `__DATA,__wtf_config`) that
SYNTHESIS2 B6 owns on linux are **also present in the WINDOWS canary PE** as two
`__DATA,_` COFF sections with `RawDataSize: 16384` each. B6's windows column was
"probably"; it is now **YES, +32,768 B windows**.

**F7. (Q4) Windows LTO — confirmed OFF, and bounded as a SIZE GROWTH, not a saving.**
Two independent sources: `config.ts:760-781`
(`ltoDefault = release && (linux || darwinCross) && ci && !assertions && !asan` —
windows is not in the default; the comment documents a *"LLVM ThinLTO backend pipeline
miscompiles JSC on x86-64"* correctness blocker AND *"the regular-LTO route for COFF ...
hasn't been built yet"*) and `ci.mjs:160-164` (*"All three [windows] lanes build without
LTO for now"*). BOUND, confirming SYNTHESIS2 §E: full LTO GREW linux `.text` by ~3.5 MB
(size-facts), and the compensating `-fwhole-program-vtables` vtable collapse is gated
`c.unix && c.lto` so COFF would never get it. And empirically from MY windows binary:
windows non-LTO `.text` (56,386,048) is only **1.028×** linux LTO `.text` (54,846,298) —
windows is NOT paying a multi-MB LTO tax. **DEAD END. Do not spend budget here.**

**F8. (Q5 — CROSS-UNIT, IMPORTANT) The final release link is performed by `rust-lld`
(LLD 22.1.4), NOT clang-21's lld, and the LTO backend that codegen'd the shipped `.text`
is LLVM 22 (rustc's).** The canary's `.comment`:
```
Linker: LLD 22.1.4 (/checkout/src/llvm-project/llvm eaab4d9841b9a8a12783d927b2df2291c1c79269)
Ubuntu clang version 21.1.5 (++20251023083255+...)
rustc version 1.97.0-nightly (e95e73209 2026-05-05)
```
This is the `wantRustLld` swap at `config.ts:814-850`: rustc 1.97's bundled LLVM (22) >
clang's (21), so cross-language LTO requires rust-lld for the whole link. Per
`flags.ts:1372`, rust-lld is built WITHOUT zlib/zstd. **Any w3-machine-outliner /
w3-lto-pipeline proposal that passes `-Wl,-mllvm,...` or `-plugin-opt=...` at LINK time
is talking to LLVM 22's lld/LTO backend, not LLVM 21's.** Also note the leaked
`/checkout/src/llvm-project` rustc-bootstrap path (part of GT#4's ~131 stray bytes).

**F9. Windows PE ground truth (no prior wave had the real `bun.exe`).** Canary
(79,821,312 B): `.text` 56,386,048 | `.rdata` 21,731,328 | `.data` raw 257,536
(VirtualSize 2,293,944) | `.pdata` 933,888 | `.tls` raw 23,552 | `_RDATA` 512 |
`__DATA,_`×2 16,384 each | `.rsrc` 272,384 (bun.ico — #33224's windows -252 KB) |
`.reloc` 181,760 | headers 1,024. The canary's CodeView record leaks
`/var/lib/buildkite-agent/build/build/release-windows-x64/bun-profile.pdb` (97 B;
`/PDBALTPATH:bun-profile.pdb` would fix it; sub-noise). `PointerToSymbolTable: 0x0`.

**F10. Negative results (valuable — nobody should re-chase these).**
- The `.data` section is 92.5% zeros (183,968 of 199,280 B). Per-symbol scan: 131,080 B
  = the two `bmalloc_megapage_table`s = **SYNTHESIS2 B5 exactly (0.125 MB), already
  claimed.** The remaining 52,888 zero bytes are diffuse across ~20 symbols (sqlite
  `FuncDef` arrays ~12 KB — writable because sqlite hash-chains `pNext` into them at
  init; libpas `theap_main` 7.6 KB; rust `LazyLock<BigStruct>` one-nonzero-byte statics
  ~8 KB, e.g. `DOTENV_SINGLETON` 1,183/1,184 zero, `hosted_git_info::CONFIGS` 727/728).
  Poor effort/byte; not a proposal.
- musl: the musl release binary's `.eh_frame`+`.eh_frame_hdr` is only **6,352 B** (libstdc++
  is DYNAMIC on musl, `flags.ts:1203-1205`), so the gnu-only `-R .eh_frame` gate does NOT
  hide a MB there. (musl DOES still carry the #33224 `.symtab`/`.strtab`/`.hash` residual —
  #33224 fixes it too.)
- No `PT_GNU_RELRO` (`-z norelro`, flags.ts:1257) and no PIE (`-fno-pic -Wl,-no-pie`,
  flags.ts:1245 *"we don't need ASLR"*) — both deliberate; both SAVE bytes. Cited because
  they make P4's parity argument.
- The ~20 codegen steps (`codegen.ts`) emit sources only; no dev/debug-mode leak into the
  release binary that isn't already owned by EJ1/EJ2/EJ3/gc-*.

---

### proposals

**P1. `bun-section-elf-dealign` — drop the ELF `.bun` section's 16 KB over-alignment**
- **saving_mb: 0.0234** (= **24,576 B**, standalone). DERIVATION BY ADDRESS from the real
  canary's shdrs: the span from end-of-`.data.rel.ro` (file 0x49389c0) to end-of-`.got.plt`
  (0x4949040) is 0x10680 = 67,200 B and today contains
  `.bun_err`(2,788) + pad(11,100) + `.bun`(16,384) + `__jsc_opcodes`(16,384) +
  `__wtf_config`(16,384) + `.dynamic`(496) + `.got`(696) + `.got.plt`(2,968) = 67,200.
  With `.bun` at natural alignment (16 B object, align 8) the same span becomes
  2,788 + 4 + 16 + 2,888(4K re-pad before `__jsc_opcodes`) + 32,768 + 4,160 = 42,624.
  67,200 - 42,624 = **24,576**. Additive interactions: **+2,888 more if B6 also lands**
  (the config sections become NOBITS so the 4K re-pad disappears) and **+4,088 more with
  P1b below** → combined P1a+P1b standalone = **28,664 B**.
- **confidence:** high (every consumer of the section read; all three are size/alignment
  independent on ELF; the 16 KB content is measured 100% zero).
- **risk:** low. ONLY change the ELF (`#else // __linux__ / __FreeBSD__`) arm of
  c-bindings.cpp — the DARWIN arm (`__BUN,__bun`) uses the 16 KB object as a REAL payload
  container (`BUN_COMPILED.size` is a LENGTH there) and must not change. Windows is
  unaffected (no compile-time `.bun`). Validation: `bun build --compile` a hello-world on
  the new binary and run it (the existing `test/bundler/bundler_compile.test.ts` suite).
- **perf:** neutral (cold static data that is never read on the non-compiled path; the
  `--compile` path is a one-shot CLI command).
- **regression:** none. `write_bun_section`/`find_bun_section`/the runtime vaddr read are
  all size/alignment agnostic (F4).
- **windows:** no (no `.bun` section in the base `bun.exe`).
- **files / change:** `src/jsc/bindings/c-bindings.cpp:1057-1078`. Keep
  `BLOB_HEADER_ALIGNMENT` = 16 KB for the `OS(DARWIN)` arm; for the ELF arm declare a
  separate 8-aligned type, e.g.:
  ```c
  #else // __linux__ / __FreeBSD__
  // ELF: only the 8-byte `size` (a vaddr written by `bun build --compile`) is ever
  // used; the payload is appended past the image (see exe_format/elf.rs). A 16K
  // alignment here only bloats the base binary with 16K of zeros + 11K of padding.
  struct BlobHeaderElf { uint64_t size; } __attribute__((aligned(8)));
  extern "C" BlobHeaderElf __attribute__((section(".bun"), used)) BUN_COMPILED = { 0 };
  extern "C" uint64_t* Bun__getStandaloneModuleGraphELFVaddr() { return &BUN_COMPILED.size; }
  #endif
  ```
  (Or, lower-diff: `#if OS(DARWIN)` / `#else` the `BLOB_HEADER_ALIGNMENT` macro itself.)
- **effort:** small.  **relink_only:** no — one C++ TU recompile + relink (still minutes;
  it is NOT a 40-minute full rebuild if the object cache is warm).

**P1b. `bun-err-to-nobits` — make `.bun_err` the `.bss` the author intended**
- **saving_mb: 0.0039** (= **4,088 B** incremental ON TOP of P1; **0 B WITHOUT P1** — the
  2,788 B it frees are currently absorbed as extra 16K alignment padding before `.bun`, so
  these two MUST land together or P1b is a no-op). Combined P1+P1b = **28,664 B = 0.0273 MB**.
- **confidence:** high (2,788 B measured 100% zero; the doc comment states the intent).
- **risk:** low. The `err!` slots are written lazily at first use; semantics unchanged.
- **perf:** neutral.
- **regression:** the author's stated locality goal ("the whole set occupies one page")
  is weakened if lld scatters `.bss.bun_err` among other `.bss` inputs; in practice lld
  keeps same-named input sections contiguous within the output `.bss`. Call this out in
  the PR; it is a cold-path (error interning) concern either way.
- **windows:** no (`.bun_err` is `cfg(target_os = "linux"|"android")`).
- **files / change:** `src/bun_core/lib.rs:1146`, one string:
  `link_section = ".bun_err"` → `link_section = ".bss.bun_err"`
  (LLVM's `getELFSectionType` emits `SHT_NOBITS` for `.bss.*`-prefixed names; lld then
  merges it into the output `.bss`). Also fix the now-wrong `.bun_err` mention in the
  doc comment at lib.rs:~1135.
- **effort:** small.  **relink_only:** no (rust recompile of `bun_core`).

**P2. `output-source-tdata-to-tbss` — 2 sentinel bytes cost 8.5 KB of TLS init image**
- **saving_mb: 0.0078-0.0081** (= **8,192-8,528 B** linux, byte-exact). DERIVATION BY
  ADDRESS: `llvm-readelf --syms` on the unstripped canary places
  `bun_core::output::SOURCE::{const#0}::__RUST_STD_INTERNAL_VAL` (8,528 B) in shndx 20 =
  `.tdata` (sh_size 0x2378 = 9,080). A byte scan of SOURCE's 8,528 bytes in the shipped
  binary finds EXACTLY 2 nonzero bytes (SOURCE+8523, SOURCE+8527, both 0x80 = the high
  bytes of two LE `0x80000000` u32s = two `Fd(i32::MIN)`). Removing the 2 nonzero bytes
  moves all 8,528 to `.tbss` (-8,528 file B); moving only the two all-zero `[u8;4096]`
  buffers out moves 8,192.
- **confidence:** high for the number; the FIX has two shapes (below) — the maintainers
  should pick.
- **risk:** low-medium (output.rs is the hot stdout/stderr path and has documented
  self-referential fields; see the two shapes).
- **perf: IMPROVEMENT** (beyond the file bytes). `.tdata` is the ELF TLS init image:
  glibc `memcpy`s it into EVERY thread's static TLS block at `pthread_create`. Shrinking
  it 9,080→~550 B removes an ~8.5 KB memcpy per thread created, for a process that spawns
  a worker/libuv/JSC-concurrent-GC thread pool at startup. (Cite: glibc
  `csu/libc-tls.c` / `nptl/allocatestack.c` `__pthread_init_static_tls` →
  `memcpy(dtv, map->l_tls_initimage, map->l_tls_initimage_size)`.)
- **regression:** shape-dependent; see below. Both preserve the documented
  "a pre-init read fails loudly instead of aliasing fd 0" property.
- **windows:** likely ~8 KB too (the canary's COFF `.tls` is fully file-backed:
  RawDataSize 23,552 ≈ VirtualSize 23,361 — lld-link emits the whole TLS template raw),
  but `util.rs:947` already defines windows `Fd::INVALID = Fd(0)`, so verify before
  banking it. Claim **linux only**.
- **files / change:** `src/bun_core/output.rs:272-380`. TWO acceptable shapes:
  - **(a) preferred, -8,528 B:** `raw_stream`/`raw_error_stream: File` →
    `Option<File>`, `ZEROED` initializes them to `None` (all-zero bytes: `Option<File>`
    around a non-niche `i32` newtype puts `None`'s discriminant at 0). `init()` sets
    `Some(file)`. Every read site already `debug_assert!(SOURCE_SET.get())`; add
    `.expect("output::Source read before init")` — which is a STRICTLY LOUDER version of
    the `Fd::INVALID`-EBADF defense the comment asks for. Cost: one well-predicted
    branch on reads that already do a TLS access + `RefCell` borrow.
  - **(b) zero-semantic-change, -8,192 B:** split the two all-zero
    `stdout_buffer`/`stderr_buffer: [u8;4096]` out of `Source` into a sibling
    `thread_local!` with an all-zero `const` init (→ `.tbss`); `Source` holds pointers to
    them, set in `init()` — the exact BORROW_FIELD pattern output.rs already uses for
    `buffered_stream`/`stream`. Same per-thread 'static lifetime.
  - Do NOT take the 1-line temptation of `ZEROED_STREAM = File::from_raw(Fd(0))`: it
    deletes the documented fd-0-aliasing defense.
- **effort:** small (a) / medium (b).  **relink_only:** no (rust recompile of `bun_core`).

**P3. `strip-drop-comment-and-stapsdt` — finish what PR #33224 started**
- **saving_mb: 0.0006** (= **656 B**, MEASURED: ran the exact post-#33224 strip on the
  canary → 76,848,280 B; adding `-R .comment -R .note.stapsdt` → 76,847,624 B).
- **confidence:** certain (measured on the real binary).
- **risk:** none. `.comment` is the toolchain-version strings (GCC 13.1 / LLD 22.1.4 /
  clang 21.1.5 / rustc 1.97.0-nightly — also a toolchain-version LEAK); `.note.stapsdt`
  is libstdc++'s 3 SystemTap `libstdcxx:{throw,catch,rethrow}` probes, dead because
  bun compiles with `-fno-exceptions` and nothing registers SDT providers.
- **perf:** neutral (non-alloc sections; never mapped).
- **regression:** none. (Do NOT go further to `--strip-sections`: see dead_ends.)
- **windows:** no (different mechanism; the PE has no such sections).
- **files / change:** `scripts/build/flags.ts:1432-1469` (`stripFlags`), one new entry:
  ```ts
  {
    flag: ["-R", ".comment", "-R", ".note.stapsdt"],
    when: c => c.linux && c.release,
    desc: "Drop toolchain-version strings + libstdc++'s dead SystemTap probes (--strip-all keeps non-symbol sections)",
  },
  ```
- **effort:** trivial.  **relink_only: YES — strip-only, seconds.** (Appending `-R`s does
  NOT hit the `--strip-all` last-flag-wins downgrade that #33224 fixed — that enum is
  only assigned by `--strip-all/--strip-debug/--strip-unneeded/--discard-all`, not `-R`.)

**P4. (W) `windows-fixed-base-drop-reloc` — the ASLR parity twin of /GS-**
- **saving_mb: 0.173 windows-ONLY** (= **181,800 B** = the canary PE's `.reloc`
  RawDataSize 181,760 + its 40-byte section-header entry; DERIVED by address from the
  real `bun.exe` — the `.reloc` span [0x4BF3400, 0x4C1FA00) is the final 181,760 file
  bytes, so dropping it is a 1:1 file-size reduction).
- **confidence:** high on the byte count; **this row needs the SAME explicit Jarred/Dylan
  policy sign-off as /GS-** — read the next field before banking it.
- **risk / regression — STATE IT HONESTLY:** `/FIXED` removes the base-relocation table
  AND clears `IMAGE_DLL_CHARACTERISTICS_DYNAMIC_BASE`, i.e. it disables ASLR for the main
  image. The PARITY ARGUMENT, in the project's own words: `flags.ts:1243-1245` compiles
  linux bun `-fno-pic -Wl,-no-pie` with the comment *"No PIE (we don't need ASLR; simpler
  codegen)"*, and the shipped linux binary has no `PT_GNU_RELRO` either (`-z norelro`,
  flags.ts:1257). So windows `bun.exe` is paying 181,760 bytes for a mitigation bun's
  flagship platform deliberately does not have — the EXACT shape of the /GS- argument the
  maintainers already accepted (SYNTHESIS2 row 1). Functional notes for the reviewer:
  (i) a 64-bit EXE's preferred base (0x140000000) is essentially never occupied, so the
  image always loads; (ii) Windows "Mandatory ASLR" Exploit Protection cannot REBASE a
  relocs-stripped image but still LOADS it at the preferred base; (iii) `/guard:cf` is
  OFF on bun-windows (w2-windows-delta), so there is no CFG interaction; (iv)
  `src/exe_format/pe.rs::add_bun_section` (the `--compile` writer) appends a new section
  and does not depend on `.reloc`. Validation: the full windows test suite + a
  `bun build --compile` round-trip. **If the maintainers veto the ASLR removal, this row
  is dead; do not argue.**
- **perf:** neutral-to-improvement (the loader skips the base-relocation fixup pass).
- **windows:** windows-ONLY. (The brief says windows is essentially solved; this is
  surplus margin, ranked below every linux row.)
- **files / change:** `scripts/build/flags.ts` linkerFlags, windows release block
  (~:990-1012, the array that already carries `/OPT:REF /OPT:SAFEICF /OPT:lldtailmerge
  /DEBUG:FULL`): append `"/FIXED"`.
- **effort:** trivial.  **relink_only: YES (minutes).**

---

### dead_ends

- **D1. Windows full LTO for size.** CONFIRMED off (config.ts:760-781 + ci.mjs:160-164,
  two documented blockers). BOUNDED as a NET GROWTH: full LTO grew linux `.text` by
  ~3.5 MB and the compensating `-fwhole-program-vtables` is `c.unix && c.lto`-gated.
  Empirically windows non-LTO `.text` is already only 1.028× linux LTO `.text`. This
  confirms SYNTHESIS2 §E's "Windows full LTO is a PERF lever, not a size one". CLOSED.
- **D2. Stripping the ELF section-header table** (`--strip-sections`, measured -2,504 B):
  breaks `bun build --compile` — `src/exe_format/elf.rs:439 find_bun_section` walks the
  shdr table BY NAME on the running binary's own file. This independently re-proves the
  DISCARDED list's "packers break --compile's section lookup".
- **D3. Zip compression level.** The CI metric and the target are the UNCOMPRESSED binary
  (`ci.ts:422 statSync(strippedExe).size`, and `binary-size.ts:346` reads the
  *uncompressed* field from the zip central directory). The zip is cosmetic.
- **D4. The "several MB windows canary-vs-release gap"** (`binary-size.ts:128-131`,
  PR #29500): not a per-commit build delta. The only same-commit mechanism is the
  10,328-byte Authenticode cert. Nothing to mine.
- **D5. musl `.eh_frame`.** The gnu-only gate on `--no-eh-frame-hdr`/`-R .eh_frame`
  looked like ~1 MB on the musl lanes; the REAL musl binary has only 6,352 B of
  `.eh_frame` (libstdc++ is dynamic on musl). Measured, dead.
- **D6. Removing the PE debug directory / CodeView record.** ~125 bytes; bun.report
  symbolication needs the PDB GUID+age. (The leaked 97-byte build PATH is fixable with
  lld-link's `/PDBALTPATH:bun-profile.pdb` — reproducibility hygiene, ~60 B, below noise,
  part of GT#4's already-counted ~131 stray bytes.)
- **D7. The 10,328-byte Authenticode signature** is mandatory (SmartScreen/Defender);
  it is a ~10 KB metric-bookkeeping note, not a lever.
- **D8. The 52,888 B of zero `.data` beyond B5's megapage tables.** Diffuse across ~20
  symbols spanning sqlite, libpas, and rust `LazyLock<BigStruct>` statics; each needs an
  individual upstream/source change. Poor effort/byte ratio.
- **D9. The codegen steps.** No debug-mode or dev-define leaks into the release binary
  that are not already owned by existing rows.

### overlaps

- **SYNTHESIS2 B5** (libpas megapage → bss, 0.125): independently CONFIRMED from the raw
  `.data` bytes (the two `bmalloc_megapage_table`s are 65,540/65,544 zero each). Not
  re-counted.
- **SYNTHESIS2 B6** (config sections → nobits, 0.032): windows column UPGRADED from
  "probably" to **YES (+32,768 B windows)** with PE evidence (F6). B6 also interacts with
  my P1 (+2,888 B to P1 if B6 lands; I claimed P1's number WITHOUT that).
- **PR #33224**: the strip-downgrade half re-measured on the real canary at -41,632 B;
  already banked, explicitly not re-counted. My P3 is the 656-byte residual.
- **F8 (rust-lld / LLVM 22 LTO backend)** is a REQUIRED input for `w3-machine-outliner`
  and `w3-lto-pipeline` (their `-plugin-opt`/`-mllvm` proposals target LLVM 22's lld, and
  it lacks zlib/zstd).
- **P4 (.reloc)** shares its policy gate with `w2-windows-delta`'s /GS- (SYNTHESIS2 row 1).
- The linux PLT surface (`.plt` 5,904 + `.got.plt` 2,968 + `.rela.plt` 8,832; `-z lazy`
  deliberate at flags.ts:1256) and the 1,012-entry `.dynsym` belong to
  `w3-cpp-compile-flags`; I did not claim them.

### honest total for this unit
New, skeptic-ready, zero-perf-cost LINUX bytes: **P1+P1b 28,664 + P2 8,192-8,528 +
P3 656 = 37,512-37,848 B ≈ 0.036 MB.** Plus 0.173 MB windows-only (policy-gated).
The real deliverables are the three negative certainties (the pipeline is byte-honest;
windows LTO is a growth; the strip axis is exhausted at 656 B) and the rust-lld fact
(F8) that other wave-3 units' linker proposals depend on.

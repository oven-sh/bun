# SKEPTIC — w3-binary-archaeology

Every number below was RE-DERIVED by me, independently, BY ADDRESS from
`/tmp/canary/nm-dem.txt` / the real `.rodata` file offsets (vaddr − 0x200000),
the REAL source files, and the LIVE canary (`/tmp/canary/bun-linux-x64/bun -e`).
Radix note: nm-dem.txt is `--radix=d`; column 1 = address, column 2 = size,
BOTH decimal. Deduped by address with `awk '!seen[$1]++'` everywhere.

---

## VERDICT P1 (ba-zstd-cold-embedded-assets): **WEAKENED** — 0.170 MB hard, 0.220 ceiling (not 0.224); sub-item (e) is REFUTED on a misread consumer; group (d) is not address-reproducible

**Size, reproduced.** For every asset the report gave a vaddr for, I `dd`'d the
exact `[vaddr−0x200000, +n)` window from the SHIPPED canary, checked the content
prefix AND the 10 bytes past each end, and ran the canary's own
`Bun.zstdCompressSync(.,{level:19})`. Result — **identical to the report's table,
to the byte**:

| group | my raw | my zstd19 | my save | report's save |
|---|---|---|---|---|
| (a) completions (bun.zsh/fish/bash) | 56,816 | 11,033 | **45,783** | 45,783 ✓ |
| (b) bake/browser JS (10 assets) | 192,133 | 68,472 | **123,661** | 123,661 ✓ |
| (c) FFI.h only (the one vaddr given) | 11,822 | 3,162 | 8,660 | (part of 21,646) |
| (e) welcome-page.html.gz → zstd of the HTML | 22,166 | 18,534 | 3,632 | 3,632 ✓ |

Boundary cross-check passed: `bun.bash` ends exactly where `bun.zsh` begins
(0x11e1d8b+8671 = 0x11e3f6a) which ends exactly where `bun.fish` begins;
`FFI.h`'s tail is immediately followed by a tinycc header (`/* --- The`).
Total I can reproduce BY ADDRESS: **178,104 B**.

**(e) is REFUTED — the report misread the ONE consumer.** The report's change
is "swap `gunzipSync` for `bun_zstd::decompress_alloc` at its one reader."
There is NO `gunzipSync`. `src/runtime/server/RequestContext.rs:1006-1008`:

```rust
resp.write_header(b"content-encoding", b"gzip");
resp.write_header_int(b"content-length", WELCOME_PAGE_HTML_GZ.len() as u64);
ctx.end(WELCOME_PAGE_HTML_GZ, ctx.should_close_connection());
```

The gzip blob **IS the HTTP wire format**, sent verbatim as
`Content-Encoding: gzip` (and `RequestContext.rs:4432` is its only embed site).
Re-encoding it as zstd forces either (a) `Content-Encoding: zstd` — a protocol
/compat behavior change (curl, older Safari, anything that doesn't send
`Accept-Encoding: zstd` gets garbage), or (b) a per-request re-gzip — a perf
regression. **Subtract 3,632 B and drop (e).** 22,166 bytes of `.rodata` are
NOT recoverable here.

**(c)-remainder (18,418 B) and ALL of (d) (53,837 B → saves 39,760) give NO
vaddrs.** I could not reproduce them by address. The unit's own
`measure.ts:48-56` derives (d) by walking `src/runtime/cli/init`
(84,778 B/disk) + `src/runtime/cli/create/projects` (8,411 B), so 53,837 is the
right order — plausible but, by the rules I was given, **unverifiable**. I
downgrade, not refute.

**Perf: CONFIRMED — and I found a STRONGER argument than the report gave.**
Every one of these is real (I read them):
1. `src/resolver/node_fallbacks.rs:28-35` — the maintainer-shipped precedent,
   comment quoted verbatim ("Release builds embed the zstd-compressed
   `<name>.js.zst` … decompress it lazily on first access"). Its mechanism
   (`::bun_zstd::decompress_alloc` → `::bun_core::Once<String>`) is at :42-60.
2. `src/runtime/bake/bake_body.rs:1440-1456` — `bake.client.js` is ALREADY
   heap-copied into a `static CLIENT: OnceLock<Box<[u8]>>`; the in-tree comment
   literally says **"the cost is negligible"**. The "RSS does not change" claim
   is true as written.
3. **NEW, the load-bearing one** — `src/bun_core/util.rs:3168-3188`: the
   `cfg(not(bun_codegen_embed))` (debug-build) arm of `runtime_embed_file!` is
   **ALREADY** `__CELL.get_or_init(|| …)` over a `$crate::Once<String>`. Every
   call site already tolerates a lazily-initialized value today; a release-mode
   zstd `Once` introduces no lifecycle shape a debug build hasn't exercised for
   years. This is the cleanest "why is this safe" a reviewer can ask for.
4. Every consumer I read is cold: `js_parser/parser.rs:465-476,521-522`
   (`Fallback::error_js/css` = the fallback error PAGE, not the parse loop —
   I checked this specifically because an asset "in the parser" is a hot-path
   tripwire); `bake/DevServer.rs:5494-5496` (dev error HTML, text appended to a
   buffer); `bake_body.rs:508-522,593` (one-shot framework setup);
   `cli/shell_completions.rs:10-12` (three `include_bytes!`, CLI one-shot);
   `ffi/mod.rs:232` (written to a temp file for tinycc).

**Windows: yes (all `include_str!`/`include_bytes!` → PE `.rdata`), ~0.22.**

**Duplication:** group (a) is INDEPENDENTLY re-derived at the *same* numbers by
`w3-weird-ideas` **W3 (`completions-zstd`)** — a confidence boost, but the
synthesizer must credit those 45,783 B ONCE across the wave. No wave-1/2
duplication; P1 ANSWERS SYNTHESIS2 §E lead #4, it does not re-open anything.

**Honest P1 number: 0.170 MB hard (by-address-verified), 0.220 ceiling.**

---

## VERDICT P2 (ba-root-certs-pem-to-der): **CONFIRMED** — 0.049 MB (0.084 zstd variant); byte-exact; perf is a documented improvement

**Size, reproduced to the BYTE from the real header.** I parsed
`packages/bun-usockets/src/crypto/root_certs.h` (197,527 B) myself:
120 certs, PEM strlen sums match the `.len=` fields, `.rodata.str1.1`
footprint (strlen+NUL each) = **179,722 B**, base64-decoded DER total =
**128,018 B**, saving = **51,704 B** — ALL identical to the report.
0/120 decode failures. The canary's own `zstdCompressSync(der,{level:19})`
gives 91,338 B → **88,384 B** saved (report 88,273; 0.1%).
`grep -a -c '-----BEGIN CERTIFICATE-----'` on the canary = 120; no 2nd copy.

**Perf: CONFIRMED as an IMPROVEMENT.** Every cited line is real and exact:
- `root_certs.cpp:56-76`: `BIO_new_mem_buf` + `PEM_read_bio_X509` per cert.
- `root_certs.cpp:152-153`: the ONE `std::call_once`.
- `root_certs.cpp:305`: the same file's Windows system-cert path ALREADY uses
  `d2i_X509(NULL, &data, …)` — the in-file precedent.
- `src/http/HTTPThread.rs:1307-1315`: documents this init as "~0.7 ms CPU and
  ~400 KB heap" AND shows the maintainers already lazified it so a cached
  `bun install` skips it entirely.
- **Stronger than the report cited** — `root_certs.cpp:256-261`: a maintainer
  comment that this exact once-per-process parse is what kept
  `Bun.connect({tls:true})` "under the node-tls-server.test.ts 100ms cold-path
  budget". `d2i_X509` on DER is strictly cheaper than `PEM_read_bio_X509`
  (which internally base64-decodes THEN calls `d2i_X509`).

**Live surface, run on the real canary:** `tls.rootCertificates.length === 120`,
element 0 is `-----BEGIN CERTIFICATE-----\nMIIEkTCC…-----END CERTIFICATE-----`
(no trailing newline); `tls.getCACertificates().length === 120`.

**Consumer audit: CONFIRMED closed.** `us_raw_root_certs` has exactly ONE
non-trivial consumer, `src/jsc/bindings/NodeTLS.cpp:24`
(`getBundledRootCertificates`); `context.c:43` is a 1-line forwarder. No other
path reads the raw PEM TEXT.

**Regression the report UNDERSTATED (does not change the verdict):**
`NodeTLS.cpp:28-31` returns `{raw.str, raw.len}` VERBATIM, and bun's PEM uses
**72-char** base64 lines. OpenSSL's `PEM_write_bio_X509` emits **64**. A naive
lazy re-render silently changes the bytes of a public API's return value. The
implementer must render 72-char lines explicitly (or cache the exact strings).
Note: bun's 72 already differs from Node's 64, so there is no byte-for-byte
Node contract today; any PEM parser accepts both. One extra line in the PR.

**Windows: yes.** Same header on all platforms.

**Duplication:** SAME 179,722 bytes as `w3-weird-ideas` **W2
(`rootcerts-zstd`)**. The two designs are NOT equivalent and **P2 is strictly
better**: W2 keeps PEM + zstd (78,132 B saved, a pure lazy-decompress that then
holds 180 KB of PEM on the heap forever); P2's DER form (51,704) is a perf
IMPROVEMENT with ZERO new heap, and P2's DER+zstd variant (88,384) beats W2's
number because DER is smaller than PEM before zstd even runs. Synthesizer:
take P2, drop W2, credit the bytes once. Not a wave-1/2 duplicate.

---

## VERDICT P3 (ba-highway-dead-isa-targets): **CONFIRMED (UPGRADED to 0.053 MB)** — the strongest, most novel finding of the unit

**Size, re-derived by address:** `N_SSSE3::` = 48 unique addrs = **27,729 B**;
`N_SSE4::` = 46 unique addrs = **27,441 B**; **zero** addresses shared between
them (no ICF folds); combined unique-address total = **55,170 B = 0.0526 MB**.
The report's 54,898 is 272 B LOW (it filtered to `bun::/bun_image::` and
dropped 2 `hwy::N_SSSE3::detail::*` rodata tables that ALSO go away).
All 7 shipped targets total 210,196 B by address.

**Root cause, re-verified EMPIRICALLY (not just by reading):**
- `clang-21 -march=haswell -E -dM` defines `__AVX2__ __PCLMUL__ __SSSE3__
  __SSE4_1__ __BMI2__ __FMA__ __F16C__` but **NOT `__AES__`**; `-maes` adds it.
- `scripts/build/flags.ts:71-77`: `-march=nehalem` when `c.baseline`,
  `-march=haswell` when `!c.baseline`. Both flag tables the report names exist
  (`cpuTargetFlags` :49, `bunOnlyFlags` :580).
- `vendor/highway/hwy/detect_targets.h` — every line number checks out:
  `:618-622` `HWY_BASELINE_SSE4` needs `HWY_WANT_SSE4 || (SSE4 && PCLMUL_AES)`;
  `:625-629` `HWY_BASELINE_AVX2` needs `HWY_BASELINE_SSE4 != 0`;
  `:738` static = lowest-enabled-baseline bit; `:970-971`
  `HWY_TARGETS = attainable & ((static-1)|static)`. Without `__AES__` this
  yields EXACTLY the 7 observed targets; with it, EXACTLY 5 (SSSE3+SSE4 gone).
  `HWY_WANT_SSE4` is documented at `:45`.

**Unreachability, PROVEN two independent ways:**
1. `packages/bun-release/src/platform.ts:9-11` — the installer's `avx2` gate
   routes no-AVX2 CPUs to the `-baseline` artifact.
2. The canary contains **9,469 unconditional AVX2-only opcodes**
   (`vpermd/vpbroadcastd/vperm2i128/vpsllvd/vpgatherdd`) throughout `.text`.
   A no-AVX2 machine SIGILLs on bun-linux-x64 regardless of Highway.

**THE upstream citation that proves perf-neutrality** (the report MISSED this
— and it's the exact thing the maintainers asked for):

> `vendor/highway/hwy/targets.h:360-366` — `GetIndex()` "must be in the header
> file so it uses the value of HWY_CHOSEN_TARGET_MASK_TARGETS defined in the
> translation unit that calls it … **This means we only enable those targets
> that were actually compiled in this module.**"

This ONE comment settles every residual risk: (a) the per-TU `HWY_TARGETS`
mismatch between bun's 5 TUs and the separately-compiled `targets.cc`
(`scripts/build/deps/highway.ts` is a DirectBuild with its own cflags) is safe
**by Highway's documented design**, so `-DHWY_WANT_SSE4=1` in `bunOnlyFlags` is
sufficient and correct; (b) on AVX2+ hardware `GetIndex()` returns the SAME
table index before and after — the N_AVX2 function bodies are byte-for-byte
unchanged; the ONLY emitted-code difference is the 64-bit AND-mask immediate
inside the inlined `GetIndex()`.

Secondary checks: `HWY_STATIC_DISPATCH` has **ZERO** call sites in bun's src
(all 55 dispatch sites are `HWY_DYNAMIC_DISPATCH`/`HWY_EXPORT`); **ZERO**
`AESRound`/`CLMul` callers in the 5 highway TUs (so `HWY_WANT_SSE4`'s implied
AES/PCLMUL promise is never exercised). The "BONUS" latent-perf-bug claim is
accurate: `HWY_STATIC_TARGET` IS SSSE3 on today's flagship build.

**Recommended spelling:** `-DHWY_WANT_SSE4=1` in `bunOnlyFlags`, gated
`c.x64 && !c.baseline` — it changes ZERO compiler ISA features (no `-maes`
policy discussion needed) and is Highway's own documented override.

**Windows: yes, ~0.05** — windows x64 also ships a `-baseline` variant and uses
the same `cpuTargetFlags` table.

**Duplication: NONE.** `w3-cpp-compile-flags` and `w3-dep-internals` have ZERO
mentions of SSSE3/HWY_WANT/`-maes`/root_certs. Not in SYNTHESIS2's table or its
DISCARDED list. **This is a genuinely new, byte-exact, perf-improving Tier-A
item that no other unit found.**

---

## VERDICT P4 (ba-bun-section-nobits): **REFUTED** — the design BREAKS `bun build --compile`; the report's load-bearing premise about the writer is factually false

The SIZE diagnosis is right (`.bun` = 16,384 B of `0x00`, PROGBITS WA
align 16384 @ 0x4b50000, symbol `BUN_COMPILED` at that address, PLUS 11,100 B
of file alignment padding the report didn't even count). The FIX is wrong.

The report's stated verification burden — "`write_bun_section` must accept a
`SHT_NOBITS` source section (**it rewrites the ELF and grows the section to the
real payload size anyway**)" — has a FALSE parenthetical. I read the code:

- `src/exe_format/elf.rs:208-212` (its own doc comment): "We **always append**
  rather than writing in-place because `.bun` is in the middle of a `PT_LOAD`
  segment". It never grows `.bun`.
- `elf.rs:355-364` is the kill shot:
  ```rust
  // Write the vaddr of the appended data at the ORIGINAL .bun section location
  // (where BUN_COMPILED symbol points). At runtime, BUN_COMPILED.size will be
  // this vaddr (always non-zero), which the runtime dereferences as a pointer.
  // Non-standalone binaries have BUN_COMPILED.size = 0, so 0 means "no data".
  write_u64_le(&mut self.data[...bun_section_offset...][..8], new_vaddr);
  ```
  The **first 8 FILE bytes of the PROGBITS `.bun` section are an indirection
  slot.** The runtime (`c-bindings.cpp:1078-1082`,
  `Bun__getStandaloneModuleGraphELFVaddr` → `&BUN_COMPILED.size`) reads that
  u64 from the MEMORY-MAPPED section and dereferences it.
- `elf.rs:226` even states the contract in a comment: "BlobHeader is
  `aligned(16K)` + **PROGBITS** with WA flags".

**With `SHT_NOBITS`, BOTH halves fail:**
1. `bun_section_offset` (a NOBITS section's `sh_offset`) aliases some OTHER
   section's file bytes ⇒ `write_u64_le` SILENTLY CORRUPTS them.
2. `BUN_COMPILED` is a FIXED link-time symbol address; the kernel loader maps
   NOBITS as anonymous ZERO pages ⇒ the compiled standalone reads
   `size == 0` ⇒ "no data" ⇒ **every `bun build --compile` binary produced
   by the changed bun silently fails to load its embedded module graph.**

No, "teach the writer to accept NOBITS" is NOT a small change: lld places a
NOBITS `.bun` in the RW segment's file-less (p_memsz-only) tail; file-backing
those 8 bytes means file-backing EVERYTHING from `p_filesz` up to `.bun`'s
vaddr — the entire `.bss` (1.77 MB in the canary). The opposite of a size win.
And the writer's own doc comment (`elf.rs:205-208`) says the whole design
exists to preserve "the mmap-at-execve contract (no file I/O at startup)", so
"re-read the file" is an already-rejected alternative.

**The salvageable piece** (a DIFFERENT, unwritten proposal): keep PROGBITS,
change `BLOB_HEADER_ALIGNMENT` (`c-bindings.cpp:1058`, `16*1024`) to 8 **on
Linux only** — `sizeof(BlobHeader)` drops from 16,384 to 8 and the 11,100 B of
alignment padding vanishes too, for **~27 KB**, MORE than P4 claimed. But the
16 KB is shared with the Darwin `__BUN,__bun` variable (`c-bindings.cpp:1069`)
where 16,384 is the Apple-Silicon page size, so it needs a per-platform split
and a maintainer decision. The report's justification for this alternative
("if 16 KB of headroom is not required by `write_bun_section`'s in-place
path") references an in-place path that DOES NOT EXIST. Do not ship P4 as
written; if someone wants the bytes, write the `aligned(8)`-on-Linux PR
fresh and test `bun build --compile` + the standalone's self-load.

**`w3-weird-ideas` W4 (`bun-sections-nobits`) makes the IDENTICAL mistake**
("a small elf.rs change that MUST be tested") and must be refuted with P4.

---

## F-findings (not proposals — record corrections I checked)

- **F7(a) CONFIRMED EXACTLY.** The canary contains **399** `callq
  *__stack_chk_fail` sites (I counted them in the full disassembly). GT#7's
  literal "there is NO stack protector" is technically false; the report's
  footnote (all from prebuilt distro libstdc++.a/libgcc, ~0.019 MB, a subset
  of Tier-B row B1) is a correct and NECESSARY record correction — a reviewer
  who greps will otherwise "refute" GT#7.
- **F7(b)** (the 42,288 B second-strip = PR #33224, already banked, 0 new):
  correct bookkeeping; I did not re-run the strip.
- **F1 / F4**: the `.rodata` is 21,623,360 B (0x149f240) and `.text`
  54,977,370 B from `readelf -SW` — consistent with the report's census input.
  I did NOT independently rebuild the census.
- **F6 (the 1.31 MB outliner extrapolation)** is NOT a proposal of this unit
  and carries no perf claim; it is input data for `w3-machine-outliner`. Not
  verdicted here. Its own warning ("do NOT use my 13 MB loose number") is
  important — the synthesizer must enforce it.

---

## Wave-1/2 duplication sweep: CLEAN
None of P1-P4 appears in SYNTHESIS2's ranked table, its TIER-C list, or its
DISCARDED list. P1 and P2 ANSWER SYNTHESIS2 §E lead #4 ("sweep .rodata for
every other large, cold, compressible table"), they do not re-open it. P3 is a
compiler-flag interaction, NOT in the "closed" clang-cl set (that was Windows
/GS- adjacent) nor the "linker flags beyond --icf=all" set.

## Intra-wave-3 duplication (for the synthesizer)
- P1 group (a) ≡ `w3-weird-ideas` W3 (SAME 45,783 B). Credit once.
- P2 ≡ `w3-weird-ideas` W2 (SAME 179,722 B). **P2's DER design is strictly
  better** (perf IMPROVEMENT, zero new heap, and its zstd variant's number is
  bigger). Take P2, drop W2.
- P4 ≡ `w3-weird-ideas` W4's `.bun` half. **BOTH REFUTED** by `elf.rs:355-364`.
- P3 has NO duplicate anywhere. It is this unit's unique contribution.

---

## credible NEW (non-duplicate) total MB for this unit: **0.27 hard, 0.32 credible**

| | MB | basis |
|---|---|---|
| P1 | **0.170** hard / 0.220 ceiling | 178,104 B reproduced by address; (e) refuted −3,632; group (d)+(c)-rest unverifiable |
| P2 | **0.049** (0.084 with the zstd variant) | byte-exact; perf IMPROVEMENT |
| P3 | **0.053** | byte-exact by address; perf-neutral by Highway's own design doc |
| P4 | **0** | REFUTED |

**Hard (every byte I reproduced at an address): 0.170 + 0.049 + 0.053 = 0.272 MB.**
**Credible: 0.220 + 0.049 + 0.053 = 0.322 MB (0.357 with P2's zstd variant).**

The report's own bottom line (0.325 certain / 0.376 ceiling) is OVERSTATED by
~0.02-0.05: it counted the refuted P1(e), the refuted P4, and 40 KB of group-(d)
bytes it never located. The remaining ~0.27 MB is among the best-evidenced
money in wave 3: every byte at a named address in the shipped binary, two
proposals with in-tree maintainer precedent, and one (P3) with an upstream
design-doc citation that proves perf-neutrality without a benchmark.

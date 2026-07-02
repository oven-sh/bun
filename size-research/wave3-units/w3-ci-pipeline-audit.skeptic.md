# SKEPTIC — w3-ci-pipeline-audit

Artifacts used: `/tmp/canary/bun-linux-x64/bun` (76,889,912 B), `/tmp/canary/bun-linux-x64-profile/bun-profile`
(unstripped), `/tmp/canary/nm-dem.txt`, `/tmp/official/bun-linux-x64/bun` (1.3.14), the three real windows
`bun.exe`s already on disk under `/tmp/w3-ci-pipeline-audit/` and `/tmp/w2-windows-delta/`. I ran the canary,
the modified binaries, GNU strip 2.44, and llvm-readelf/readobj-21. Every number below was re-derived by me
from those artifacts.

---

## VERDICT P1 (`bun-section-elf-dealign`): CONFIRMED — 24,576 B, independently re-derived; the one regression vector the report never analyzed (`permanentlyFreeze` page adjacency) closes SAFE.

**BY-ADDRESS re-derivation.** This proposal is about a *section*, so the primary ground truth is the
section-header table, but the mandated nm anchor exists and is unambiguous:

- `nm-dem.txt:79936` → `0000000078970880 0000000000016384 d BUN_COMPILED`. 78,970,880 = **0x4B50000**
  = exactly the `.bun` section's vaddr. Size **16,384**. One data symbol at one address; the 7,835-alias
  over-count problem is a `.text` phenomenon and cannot apply to a single `d` object. The 8-byte struct
  literally IS a 16,384-byte object in the shipped symbol table — the over-aligned-`sizeof` mechanism is
  directly visible.
- Section headers of the real canary (I dumped them): `.data.rel.ro` ends at file **0x49389c0**; `.got.plt`
  ends at **0x4949040**. Span = 0x10680 = **67,200 B**, and it is EXACTLY the sum
  `.bun_err`(2,788) + pad(11,100) + `.bun`(16,384) + `__jsc_opcodes`(16,384) + `__wtf_config`(16,384)
  + `.dynamic`(496) + `.got`(696) + `.got.plt`(2,968) = **67,200**. Matches the report.
- I byte-scanned every claimed-zero span with `dd | od`: `.bun_err` 0 nonzero / 2,788; the 11,100-B pad
  0 nonzero; `.bun` 0 nonzero / 16,384. ALL 100% zero as claimed.
- New layout with `.bun` at align 8: I recomputed it section by section =
  2,788 + 4 + 16 + 2,888 + 32,768 + 4,160 = **42,624**. 67,200 − 42,624 = **24,576**. EXACT match.

**The layout math is sound — two things I verified that the report only asserted:**
1. *The RW PT_LOAD's `p_align 0x4000` is NOT caused by `.bun`*, so nothing else in the file re-paginates.
   Proof: the R segment (whose largest member alignment is `.rodata`'s 4096) and the RX segment ALSO have
   `p_align 0x4000` → `maxPageSize = 0x4000` independently of `.bun`. (w3-weird-ideas #22 independently
   measured the same.) lld does not reorder orphan output sections by alignment, so the section ORDER is
   also unchanged.
2. *The 8-byte `size` field is the ONLY thing the ELF arm ever touches.* Repo-wide grep: the only non-darwin
   references to `BUN_COMPILED` are `&BUN_COMPILED.size` (c-bindings.cpp:1082). `data[]` is never used on
   ELF, so the report's proposed `struct BlobHeaderElf { uint64_t size; }` compiles.

**THE REGRESSION THE REPORT DID NOT ANALYZE — found and CLOSED (safe).** Today `__DATA,__jsc_opcodes`
(vaddr 0x4b54000) and `__DATA,__wtf_config` (0x4b58000) are both 16 KB-ALIGNED — purely by LUCK, because the
16 KB-aligned, 16 KB-sized `.bun` sits in front of them. After P1 they move to 0x4b4e000 and 0x4b52000
(4 KB-aligned, NOT 16 KB-aligned). Both get `mprotect(addr, 16384, PROT_READ)`'d by JSC at startup
(`WTF::Config::permanentlyFreeze` + the LLInt opcode-config freeze). If either required 16 K alignment this
would `RELEASE_ASSERT`-crash every process. It does NOT, and here is the proof from source + the binary:
- `vendor/WebKit/Source/WTF/wtf/PageBlock.h:59-60`: on `CPU(X86_64)`, `CeilingOnPageSize = 4 * KB`.
- `WTFConfig.h:80`: `ConfigAlignment = CeilingOnPageSize` → **4096**.
  `WTFConfig.cpp:89`: `alignas(WTF::ConfigAlignment) ... Slot g_config[...]`.
  `LLIntData.cpp:58`: `alignas(CeilingOnPageSize) ... os_script_config_storage[...]`.
  → the SOURCE only ever asked for 4096, and the BINARY agrees: both sections have `sh_addralign = 4096`.
- `WTFConfig.cpp:214-237 permanentlyFreezePages`: `RELEASE_ASSERT(roundUpToMultipleOf(pageSize(), size)==size)`
  asserts only on SIZE; then a bare `mprotect(base, 16384, ...)`. A 4096-aligned base on a 4 K-page system
  is exactly what mprotect needs.
- After P1 each config occupies EXACTLY 4 exclusive pages ([0x4b4e000,0x4b52000) and [0x4b52000,0x4b56000));
  `.bun` lands on a different page and `.dynamic` starts on the next. Nothing adjacent gets frozen.
The implementer's PR should state this analysis explicitly; "regression: none" with no mention of the config
freeze is the report's one analytic gap here.

**Minor implementation nits (do not change the number):**
- The report's inline code snippet would ADD a second definition of `Bun__getStandaloneModuleGraphELFVaddr`
  rather than replace the existing one at c-bindings.cpp:1080-1083. The report's own alternative —
  `#if OS(DARWIN) / #else` the `BLOB_HEADER_ALIGNMENT` macro itself — is the cleaner, one-line form. Keep
  `__attribute__((used))` (it is what stops gc-sections from dropping the section; the snippet does).
- The darwin arm (`__BUN,__bun`, `{ 0, 0 }`) and the windows arm (c-bindings.cpp:1087+) are untouched, as
  the report says.

**Runtime proof.** I ran a full `bun build --compile` round trip on the real canary — works. (And as the D2
control, `llvm-objcopy --strip-sections` → `Error writing .bun section to ELF: BunSectionNotFound`, which
independently re-proves D2 AND the prior waves' "packers break --compile" DISCARDED entry. The additional
saving `--strip-sections` would have bought is exactly -2,504 B — matching the report's dead_end number.)

---

## VERDICT P1b (`bun-err-to-nobits`): CONFIRMED — +4,096 B incremental on P1 (report said 4,088; 8 B apart), HONESTLY 0 without P1. Mechanism narration corrected; the fix itself is right and is STRONGER than the report argued.

- `src/bun_core/lib.rs:1146` is exactly as quoted:
  `#[cfg_attr(any(target_os="linux","android"), unsafe(link_section = ".bun_err"))]
  static __E: AtomicU16 = AtomicU16::new(0);`
  Measured: the `.bun_err` output section is 2,788 B, **0 nonzero bytes**. Nothing in the repo walks the
  section by name (`intern_cached(&__E, ..)` at `result.rs:125` is pointer-based; the only other mention is
  a *comment* in `src/clap/lib.rs:91`).
- **Mechanism CORRECTION.** The report says the section is PROGBITS today because "LLVM's
  `getELFSectionType` only emits `SHT_NOBITS` for names matching `.bss`/`.bss.*`". That is not the cause.
  The real cause is LLVM's `isSuitableForBSS`: `if (GV->hasSection()) return false;` — ANY global with an
  explicit `section` attribute is categorically excluded from the BSS SectionKind regardless of its
  initializer. Renaming to `.bss.bun_err` works because `getELFKindForNamedSection` name-matches `.bss.`
  and FLIPS the Kind to BSS, and THEN `getELFSectionType` returns `SHT_NOBITS` on `K.isBSS()`. Same
  conclusion, correct chain. (This matters: it means `.bss.`/`.sbss.` prefixing is the ONLY way to make an
  explicitly-sectioned global NOBITS — the report landed on the uniquely-correct fix.)
- **STRENGTHENED.** The doc comment at `lib.rs:1133-1136` states BOTH goals — "land in `.bss` for free"
  AND "clustered into a dedicated `.bun_err` section". Those two goals are in direct conflict under
  `isSuitableForBSS`, and the author evidently did not know. `.bss.bun_err` achieves BOTH (lld's
  `getOutputSectionName` folds `.bss.*` into the output `.bss`, and under fat LTO all the rust `__E`s arrive
  in ONE `.bss.bun_err` input section from the single lto.o, so they stay contiguous). P1b is not just a
  byte win; it makes the code do what its own comment claims. The report's "lld scatters" regression worry
  is over-cautious and its own "in practice lld keeps them contiguous" answer is correct.
- My layout re-derivation of P1+P1b combined: the span shrinks 67,200 → 38,528 = **28,672 B**
  (report: 28,664; the 8-byte difference is an immaterial micro-alignment assumption). The report's honest
  statement that **P1b is a strict no-op without P1** (the 2,788 B would just become 2,788 more bytes of
  16 K alignment pad) is correct — I recomputed that case and got exactly 0.

---

## VERDICT P2 (`output-source-tdata-to-tbss`): CONFIRMED — 8,192–8,528 B, byte-exact. The report's perf-neutrality argument is UNDER-stated, not over-stated; I attacked it hardest and it got STRONGER. One perf claim (the glibc memcpy "IMPROVEMENT") is oversold; downgrade to neutral.

**BY-ADDRESS re-derivation (byte-exact).**
`llvm-readelf --syms` on the unstripped profile:
`4314: 0000000000000010  8528 TLS LOCAL DEFAULT 20  _RNv...8bun_core6output6SOURCE0s_0..__RUST_STD_INTERNAL_VAL`
— shndx 20 = `.tdata` (PROGBITS, sh_size 0x2378 = 9,080), offset +16, size **8,528**. I enumerated EVERY
TLS symbol in shndx 20: they tile [0, 9,080) exactly with no gaps; SOURCE is 94% of `.tdata`.
I byte-scanned the real file content (and `cmp`'d it identical between the canary and the profile):
- whole `.tdata` (9,080 B): **exactly 42 nonzero bytes** (report: 42).
- SOURCE's 8,528 bytes: **exactly 2 nonzero bytes, at relative offsets 8523 and 8527, both 0x80**
  (report: same). Those are the high bytes of two LE `0x80000000` i32s at the struct's tail =
  `raw_stream`/`raw_error_stream` = `Fd(i32::MIN)` = `bun_core::util::Fd::INVALID` (`util.rs:945`,
  posix-only; windows is `Fd(0)` at :947, so the report was right to claim linux only).
Source chain read and confirmed: `output.rs:273` `thread_local! { static SOURCE: RefCell<Source> =
const { RefCell::new(Source::ZEROED) } }`; `Source::ZEROED` (:363) zero-inits everything except the two
`ZEROED_STREAM = StreamType::ZEROED = Fd::INVALID` fields (:355,:118).

**The ".tbss if all-zero" mechanism is PROVEN INSIDE THE SAME BINARY**, which is a stronger proof than the
report offered: `SOURCE_SET` at `output.rs:274` is the SAME `thread_local! { const {..} }` form in the SAME
file with an all-zero initializer, and the profile places it in shndx **21 = `.tbss`**. Identical macro,
identical codegen path, different section purely because of zero-ness. QED.

**I ATTACKED THE PERF ARGUMENT HARDEST AND IT FAILED TO LAND — in the report's favor.** The report flagged
"risk: low-medium (output.rs is the hot stdout/stderr path)". That is MORE conservative than reality:
- The HOT write path (`writer()`, `error_writer()`, `writer_buffered()` — `output.rs:1088-1107`) goes through
  `source_writer_escape(Source::stream / buffered_stream / ..)`, i.e. through the **adapter backings**
  (`stream_backing`, `buffered_stream_backing`) that are built ONCE in `Source::init()`. It **never reads
  `raw_stream`/`raw_error_stream`**.
- The ONLY readers of `raw_stream`/`raw_error_stream` are `raw_writer()`/`raw_error_writer()`
  (`output.rs:1061-1064, 1096-1099`) — which the file's OWN comment at :1066-1067 calls the unbuffered path
  to migrate away from — plus one internal site and `Source::init()`.
- I grepped the WHOLE repo for callers: there are **exactly 2 outside output.rs**, both at
  `src/jsc/VirtualMachine.rs:2016-2017`, inside `ConsoleObject::init_in_place(...)` during ONE-SHOT VM
  CONSTRUCTION. There are ZERO direct `.raw_stream`/`.raw_error_stream` field reads outside output.rs.
  → Shape (a)'s added `Option` branch lands on a per-VM-startup path and nothing else. Not a hot path.
- Shape (b) is even more airtight than claimed: `init()` (:410) says "stdout_buffer / stderr_buffer left
  uninitialized (overwritten by adapter writes)", and the buffers are already accessed ONLY via the
  self-referential BORROW_FIELD pointers the struct documents at :327/:333/:340. Moving the backing storage
  to a sibling `.tbss` thread-local changes ONE pointer-initialization at init, and zero steady-state bytes.

**Live runtime evidence FOR the design constraint the report insisted on.** While running the D2 control, the
error path printed `failed to get path for fd: ENOENT: /proc/self/fd/-2147483648 ... (readlink())`.
`-2147483648` IS `i32::MIN` = `Fd::INVALID` surfacing at runtime on the real canary. The `Fd::INVALID`
"fail loudly" sentinel is LIVE and observable, not theoretical — so the report's instruction "do NOT take
the 1-line `Fd(0)` temptation" is exactly right, and shape (a)'s `Option::expect` (strictly louder) is the
correct replacement.

**ONE claim DOWNGRADED.** "perf: IMPROVEMENT (removes an ~8.5 KB memcpy per thread created)" is oversold.
glibc's `_dl_allocate_tls_init` does `memset(__mempcpy(dest, initimage, initimage_size), 0, blocksize -
initimage_size)`. Shrinking `.tdata` 9,080 → ~552 converts ~8.5 KB of per-thread **memcpy into ~8.5 KB of
per-thread memset** (the PT_TLS `p_memsz 0x6841` is unchanged). That is sub-microsecond per
`pthread_create`, and memset is at best marginally cheaper than memcpy. Call it **neutral**, not
"IMPROVEMENT". This does not weaken the proposal (the bar is neutral); it is just an honest correction to
the PR text.

---

## VERDICT P3 (`strip-drop-comment-and-stapsdt`): CONFIRMED — 656 B, REPRODUCED to the byte, and the resulting binary passes a full `bun build --compile` round trip. Also: this MEASUREMENT refutes a sibling wave-3 unit's false discard.

I ran it (GNU strip 2.44):
```
canary                                                              76,889,912
+ #33224's exact spelling (--strip-all -R .eh_frame -R .eh_frame_hdr
  -R .gcc_except_table)                                             76,848,280   (-41,632 — matches the report's "already banked" number)
+ -R .comment -R .note.stapsdt                                      76,847,624   (-656 MORE)
```
The P3-stripped binary: `--version` → 1.4.0, `-e 'console.log(1+1)'` → 2, and a full
`bun build --compile` → output runs. **Zero breakage.**

Content verified (I dumped both sections):
- `.comment` (276 B) = exactly the 4 toolchain strings the report quoted, including the leaked
  `/checkout/src/llvm-project` rustc-bootstrap path. (So P3 also closes a slice of GT#4's ~131 stray bytes
  AND confirms F8's rust-lld/LLD-22.1.4 fact from a second artifact.)
- `.note.stapsdt` (232 B) = exactly 3 notes: `libstdcxx:{catch, throw, rethrow}`. Dead SDT probes.

The proposed `flags.ts` entry is a correct `Flag`-table shape and slots next to the existing sibling at
`flags.ts:1453-1468`. flags.ts's OWN comment (:1434-1440) independently confirms the report's "appending
`-R`s cannot trip the --strip-all last-flag-wins downgrade" claim (the enum is only assigned by the four
`--strip-*`/`--discard-all` flags). The `when: c.linux && c.release` gate is deliberately broader than the
sibling's `c.abi==="gnu"` — correct: `.comment` exists on musl too, and `-R` on an absent section is a
silent binutils no-op.

**Cross-unit CORRECTION the synthesizer needs:** `w3-weird-ideas` idea **#23** declares this exact item
"**DEAD: already inside #33224's strip**". **That is FALSE, and I measured it.** The post-#33224 strip
leaves BOTH sections (76,848,280 → 76,847,624 is the additional -656). Un-dead it; it is P3.

---

## VERDICT P4 (`windows-fixed-base-drop-reloc`, W): CONFIRMED on the bytes (181,760, not 181,800), WEAKENED on the risk ledger. And it carries the single most valuable cross-unit correction of this pass: a sibling unit claims the SAME item at **0.63 MB**, which the real artifact REFUTES.

**BY-ADDRESS from the real `bun.exe`.** I ran `llvm-readobj --sections` on every windows PE on disk:
```
rcanary/bun-windows-x64/bun.exe   (79,821,312 B)  .reloc RawDataSize 181,760  VirtualSize 0x2C464
w2-windows-delta/…/bun.exe        (79,821,312 B)  .reloc RawDataSize 181,760   (identical file)
r1314/bun-windows-x64/bun.exe     (98,480,216 B)  .reloc RawDataSize 187,904   (the 1.3.14 release)
```
`.reloc` is the LAST section, and Σ(every RawDataSize) + 1,024 header bytes = 79,821,312 EXACTLY, so
dropping `.reloc` is a 1:1 file truncation of **181,760 B = 0.1733 MB**. The report's +40 for the section
header is wrong (10 vs 11 section headers both round to the same 1,024-B `SizeOfHeaders`), so the number is
**181,760**, not 181,800. 40 B; noise.

**Mechanism CONFIRMED.** flags.ts does NOT pass `/dynamicbase` explicitly (I grepped), so `/FIXED` alone
works in lld-link (the driver only errors on `/FIXED` + an EXPLICIT `/dynamicbase`). The target array
(`/OPT:REF` :992, `/OPT:SAFEICF` :1001, `/OPT:lldtailmerge` :1004, `/DEBUG:FULL` :1009) is where the
report said it is. The shipped PE has `DYNAMIC_BASE (0x40)` + `HIGH_ENTROPY_VA (0x20)` set today — both
vanish under `/FIXED` (HIGH_ENTROPY_VA becomes a harmless leftover bit if lld still emits it; meaningless
without DYNAMIC_BASE).

**THE REGRESSION THE REPORT DID NOT LIST (this is why P4 is WEAKENED, not CONFIRMED):**
1. The report's functional note (ii) — "Windows 'Mandatory ASLR' Exploit Protection cannot REBASE a
   relocs-stripped image **but still LOADS it at the preferred base**" — is TRUE for the default
   `ForceRelocateImages` policy and **FALSE for its `RequireInfo` sub-option**. Microsoft's own
   `UpdateProcThreadAttribute` documentation for
   `PROCESS_CREATION_MITIGATION_POLICY_FORCE_RELOCATE_IMAGES_ALWAYS_ON_REQ_RELOCS`:
   *"images that do not have a base relocation section will not be loaded."* This is the Exploit
   Protection "Mandatory ASLR" + "Do not allow stripped images" setting (`Set-ProcessMitigation ...
   <ASLR ForceRelocateImages="true" RequireInfo="true"/>`), deployable system-wide or per-image by
   enterprise Defender policy. A `/FIXED` `bun.exe` on such a machine **refuses to launch**
   (STATUS_INVALID_IMAGE_FORMAT-class). Rare, opt-in, but a HARD FAILURE — a categorically different
   risk shape from /GS- (which is never a load failure). This MUST be in the sign-off text.
2. **Blast radius:** every windows `bun build --compile` output is derived from the base `bun.exe` and
   inherits `IMAGE_FILE_RELOCS_STRIPPED`, so every END USER'S shipped `.exe` also loses ASLR and also
   hits (1). (The sibling unit `w3-cpp-compile-flags` DID state this; my unit's report did not.)
3. Open question, not a claimed fact: whether SmartScreen/BinSkin/EDR heuristics score a relocs-stripped,
   unsigned `.exe` worse. The sibling unit raises it ("EDR/BinSkim will flag a non-ASLR PE").

Both units already gate this on an explicit Jarred/Dylan sign-off and say "if vetoed, this row is dead."
The sibling unit goes further and expects it to be declined, filing it Tier-C. I agree with Tier-C. The
brief says windows is essentially solved; this is surplus margin.

**CROSS-UNIT CORRECTION (high value).** `w3-cpp-compile-flags` proposes THE SAME `/FIXED` as its P1 at
**"~0.63 MB windows-only"**. Its derivation was an absolute-pointer CENSUS of the LINUX binary
(323,932 pointers × 2 B ≈ 664 KB) transferred at 1.005×; its own confidence field says "MEDIUM on the
final MB until the 10-second read above is done" and it explicitly begs: *"VERIFY FIRST, whoever holds
the real `bun.exe`: `llvm-readobj --sections bun.exe | grep -A4 '\.reloc'` — that is the exact number."*
**I hold the real `bun.exe` and I ran exactly that command: `RawDataSize: 181760`.** The 0.63 MB
estimate is REFUTED by the artifact — off by **3.66×** (the Linux absolute-pointer population is not the
COFF DIR64 base-reloc population; x64 PE code is RIP-relative and only true pointer DATA needs a reloc).
**SYNTHESIZER: these two rows are ONE proposal. Use 0.173 MB. Do NOT use 0.63. Do NOT sum them.**
The sibling unit's RISK write-up is the better of the two; this unit's BYTE COUNT is the only correct one.

---

## Cross-unit duplication table (waves 1/2 AND the sibling wave-3 units)

**vs. waves 1+2 (SYNTHESIS.md + SYNTHESIS2.md): ZERO duplication.** I grepped both for `.reloc`, `/FIXED`,
`.comment`, `stapsdt`, `.bun`, `BUN_COMPILED`, `BLOB_HEADER`, `bun_err`, `.tdata`, `output::SOURCE`. No
hits (every grep match is coincidental text). P1/P1b/P2 are in the exact "all-zero data paying file bytes"
class that SYNTHESIS2 §E.4 explicitly TOLD wave 3 to sweep for ("`.bss` (0 file bytes) is exactly the
right lever") — a sanctioned extension. B5 (libpas megapage, 0.125) and B6 (config sections → nobits,
0.032) are the wave-1/2 rows in that class and the report correctly does NOT re-count them; it even
upgraded B6's windows column with fresh PE evidence (F6). Nothing re-opens the DISCARDED list — on the
contrary, my D2 control independently RE-PROVES the "packers break --compile's section lookup" discard.

**vs. the OTHER wave-3 units (the synthesizer must dedupe these; my evidence settles them):**

| bytes | this unit | also claimed by | resolution |
|---|---|---|---|
| `.bun` 16 K zeros + pad + `.bun_err` | **P1+P1b = 28,672 B** | `w3-weird-ideas` **W4** (`.bun`+`.bun_err` → NOBITS, 19,172 B) | SAME bytes, different mechanism. W4's primary form (NOBITS `.bun`) is BROKEN for `--compile` — `elf.rs:write_bun_section` writes 8 file bytes at `.bun`'s `sh_offset`, which a NOBITS section does not own (W4 itself flags this). W4's own stated "LOW-RISK ALTERNATIVE … change `BLOB_HEADER_ALIGNMENT` 16*1024 → 8 … IF the alignment is not load-bearing. Git-blame it first" **IS this unit's P1**, and THIS unit proved the "IF" (read all 3 consumers, ran the round trip). W4 also undercounted by ignoring the 11,100-B pad. → **Credit 28,672 ONCE, from this unit's P1+P1b. W4 is subsumed.** |
| `.comment` + `.note.stapsdt` | **P3 = 656 B** (measured) | `w3-cpp-compile-flags` "P3a" (same change); `w3-weird-ideas` #23 (DISCARDS it as "already inside #33224's strip" — **FALSE, measured**) | ONE proposal, 656 B, credit once. Un-dead weird-ideas #23. |
| windows `.reloc` | **P4 = 181,760 B** (measured from the artifact) | `w3-cpp-compile-flags` P1 `/FIXED` at **0.63 MB** (an estimate its own author flagged as unverified) | ONE proposal. **Use 0.173 MB.** The 0.63 is refuted. |
| `output::SOURCE` `.tdata` | **P2 = 8,192–8,528 B** | nobody | UNIQUE to this unit. |

---

## Findings audit (the non-proposal Fx claims I could check)

- **F1** (tracked bytes == released bytes): I did not re-download the GitHub assets, but the premises hold:
  `/tmp/canary/bun-linux-x64/bun` is 76,889,912 B (= size-facts' 73.33 MiB) and `/tmp/official/.../bun` is
  92,752,752 B (= size-facts' 88.46 MiB), both exactly. Not re-run; not load-bearing for any proposal.
- **F3** (strip residual 656 B): REPRODUCED above, including the -41,632 for the #33224 half.
- **F4** (`.bun` 16,384 zeros + 11,100 zero pad; `.bun_err` 2,788 zeros): REPRODUCED byte-for-byte.
- **F5** (`.tdata` 9,080; SOURCE 8,528 with 2 nonzero): REPRODUCED byte-for-byte. (1.3.14's `.tdata` is
  0x118 = 280 B — I read its section table — so the "post-1.3.14 regression" claim is also confirmed.)
- **F6** (two 16,384-B `__DATA,_` COFF sections in the windows PE): CONFIRMED from the real `bun.exe`.
- **F8** (LLD 22.1.4 / clang 21.1.5 / rustc 1.97.0-nightly in `.comment`): CONFIRMED, I dumped it.
- **F9** (windows PE inventory): the BYTE TOTAL balances exactly, but the prose inventory OMITS the
  **`.fptable` section (512 B)**. Cosmetic; does not affect any proposal.
- **F2/F7/F10/D1–D9**: not independently re-run (they are findings/negatives, not money), except D2 which
  I reproduced exactly (`BunSectionNotFound`, and `--strip-sections` = -2,504 B beyond P3).

---

## credible NEW (non-duplicate) total MB for this unit

**Linux: P1+P1b (28,672) + P2 (8,528) + P3 (656) = 37,856 B ≈ 0.036 MB.**
(The report claimed 37,512–37,848 ≈ 0.036 MB. Confirmed within 8–344 B.)
**Windows-only, policy-gated (Tier-C): P4 = 181,760 B ≈ 0.173 MB** — and this number additionally
CORRECTS a 0.46 MB over-claim in `w3-cpp-compile-flags`, so its net effect on the cross-unit windows
ledger is NEGATIVE 0.46 MB relative to what an un-skeptic'd synthesis would have banked.

**0.036 MB is tiny, and the report SAID SO.** It did not inflate. Its stated "real deliverables" — the
pipeline is byte-honest; windows LTO is a growth; the strip axis is exhausted at 656 B; rust-lld/LLVM 22
does the final link — are the right framing, and F8 is load-bearing for `w3-machine-outliner` and
`w3-lto-pipeline`. The highest-value thing THIS skeptic pass adds is the three cross-unit corrections
(the 0.63 MB `/FIXED` over-claim, the weird-ideas W4 subsumption, and the false weird-ideas #23 discard),
plus closing P1's un-analyzed `permanentlyFreeze` landmine and killing the perf attack on P2.

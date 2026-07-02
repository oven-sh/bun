# SKEPTIC: w3-code-patterns

Method: every number below was re-derived INDEPENDENTLY. I did not use the unit's
`q.py`; I wrote my own address-dedupe tool (`/tmp/skeptic/q2.py`, one row per
address). Byte diffs and disassembly were done against the REAL unstripped
`/tmp/canary/bun-linux-x64-profile/bun-profile` using my own independently-derived
VMA->file delta (`readelf -SW`: `.text` Addr 0x16c4a00 / Off 0x14c3a00 -> 0x201000 =
2,101,248; the unit's delta is correct). Perf tests were run on the LIVE canary
(`/tmp/canary/bun-linux-x64/bun -e ...`). All four bun source files and both WebKit
`LazyProperty*.h` headers were read.

---

## VERDICT CP-1 (lazy-common-strings, 0.168 MB): **CONFIRMED**
-- size re-derived to the byte BY ADDRESS; the perf argument survives every attack
I could mount; two copy-paste defects in the snippet must be fixed before the PR.

## VERDICT CP-2 (cli-asset-zstd, 0.101 MB): **WEAKENED**
-- the DERIVATION reproduces exactly, but it measures ONE solid archive while the
"files + change" prescribes PER-FILE `.zst` (the node_fallbacks shape), which I
measured at only **0.085 MB**. Honest band 0.085-0.101; the 0.101 needs a
per-command-archive mechanism the report did not describe. Also 0.044 MB of it is
co-claimed by a wave-3 sibling.

## VERDICT CP-3 (root-certs-zstd-bss, 0.074 MB): **WEAKENED**
-- size and perf CONFIRMED (I got a slightly BETTER number: 0.075). But the
report's "regression: none" is **FALSE**: `us_internal_raw_root_certs`
(`root_certs.cpp:167-170`) bypasses the `std::call_once` the design relies on, and
its consumer `tls.rootCertificates` works TODAY with zero TLS connections (proven
on the live canary). Shipped verbatim, CP-3 breaks a public `node:tls` API. The
fix is 5 lines, but the ledger is wrong. Also a TRIPLE-duplicate within wave 3.

---

# EVIDENCE

## CP-1

### Size: re-derived BY ADDRESS, byte-exact (my `/tmp/skeptic/q2.py`)

```
LazyProperty<.*>::callFunc                              809 addrs  849,443 B  [by_name==by_addr]
callFunc<Bun::CommonStrings::initialize          (A1)   103 addrs   54,347 B
callFunc<Bun::Http2CommonStrings::initialize     (A2)    61 addrs   36,905 B
callFunc<WebCore::HTTPHeaderIdentifiers          (A3)    94 addrs   72,004 B
callFunc<Bun::MarkdownTagStrings::initialize     (A4)    30 addrs   17,574 B
                                                 TOTAL  288 addrs  180,830 B
```
`by_name == by_addr` for all 809 -> ZERO are ICF-folded on today's `--icf=safe`
binary, exactly as claimed. Monosize clusters reproduce exactly: A1 = 100x522 +
2x712 + 1x723; A2 = 61x605; A3 = 94x766; A4 = 27x605 + 3x413.

### Byte-identity: reproduced with my own `dd` + `cmp`
- two of the 100x522-B A1 bodies: **27/522 differing bytes**.
- two of the 94x766-B A3 bodies: **18/766 differing bytes**.
Both are pure relocation divergence -> neither `--icf=safe` (address-taken via the
`static constexpr FuncType theFunc` at `LazyPropertyInlines.h:52` -- VERIFIED in the
vendored header) nor `--icf=all` (divergent relocation targets) can EVER fold them.
**Fully additive with SYNTHESIS2 row 5. Source-only fix. CONFIRMED.**

### Disassembly of the 522-B body at VMA 45856992 (`$_102`): matches the source exactly
`pushq`/preamble -> recursion-guard on `initializingTag` -> `DeferTerminationForAWhile`
inc -> `WTF::AtomStringImpl::addLiteral(span)` with **`$0x6, %edx`** (length 6) ->
the inlined `length==0 / length==1 / vm.smallStrings` checks -> `JSC::JSString::create`
-> `StringImpl::~StringImpl` + `fastFree` -> store + write barrier
(`Heap::addToRememberedSet`) -> `undoDeferTerminationSlow` tail. `$_102` is the
100th `NOT_BUILTIN_NAMES` entry = `macro(x25519, "x25519")` -- **6 chars. The literal
length in the disassembly matches the source macro entry. Airtight.**

One NIT: the report says the length==0/==1 fast paths "can NEVER fire for a
multi-char compile-time literal". 12 of the 100 literals in `BunCommonStrings.h` ARE
single-char (`jwkD "d"`, `jwkE "e"`, ... `jwkY "y"`), and A4's 3x413-B outliers are
exactly the 3 single-char markdown tags (`p`,`a`,`u`) the compiler DID fold. Does not
change a single byte of the claim; the 180,830 total is what matters.

### Source verification: all 4 files real, all 4 line numbers correct
- `BunCommonStrings.h:127` named `m_commonString_##name` members; 3 + 100 macro
  entries = 103. YES.
- `BunHttp2CommonStrings.h:101` `m_names[61]` array ALREADY EXISTS. YES.
- `BunMarkdownTagStrings.h:67` `m_strings[MARKDOWN_TAG_STRINGS_COUNT]` (=30)
  ALREADY EXISTS. YES.
- `HTTPHeaderIdentifiers.h:109-111` INTERLEAVED `m_##name##String; m_##name##Identifier;`
  pairs. `HTTPHeaderIdentifiers.cpp:48-51` `identifierFor(vm, HTTPHeaderName)` via a
  member-fn-ptr table ALREADY EXISTS. YES.
- `LazyProperty.h:50-51`: `Initializer` carries `OwnerType* owner` AND
  `LazyProperty& property`. YES.
- `LazyPropertyInlines.h:52`: `static constexpr FuncType theFunc = &callFunc<Func>`.
  YES.

### Perf attack: FAILED (the argument survives)
- `LazyProperty::getInitializedOnMainThread` (`LazyProperty.h:93-101`) is the ONLY
  hot path and is NOT TOUCHED: `if (m_pointer & lazyTag) [[unlikely]] {...};
  return bit_cast<ElementType*>(m_pointer);`
- I hunted for a HOT CALLER and found one: `Bun__HTTPMethod__toJS`
  (`BunCommonStrings.cpp:89-144`) = `request.method` in `Bun.serve`, per request.
  It calls `globalObject->commonStrings().httpGETString(globalObject)` -- the
  ACCESSOR, whose fast path is IDENTICAL before/after. Converting the named member
  `m_commonString_httpGET` (struct offset K) to `m_strings[IDX]` (struct offset
  base+IDX*8, a DIFFERENT compile-time constant) produces the SAME single
  `mov disp(%reg),%rax`. **The changed code -- the callFunc body -- runs at most once
  per (string, globalObject). Unattackable.**
- For A3 stage 2, replacing the member-fn-ptr indirect dispatch in
  `HTTPHeaderIdentifiers::stringFor/identifierFor` with a direct array index is a
  strict IMPROVEMENT.
- `initialize()` / the `HTTPHeaderIdentifiers()` ctor run once per globalObject /
  per VM. Not a perf surface.

### Two copy-paste defects the PR MUST fix (do not affect the 0.168)
1. **Wrong string constructor in the Stage-1 snippet if copied to Stage 2.** The
   Stage-1 snippet uses `jsOwnedString(init.vm, kLits[...])`. That IS what
   `BunMarkdownTagStrings.cpp:17` and `BunHttp2CommonStrings.cpp:17` use (correct
   for Stage 1). But `BunCommonStrings.cpp:26` (Stage 2, the 100-entry family) uses
   **`jsString(init.vm, AtomString(lit))`** -- an ATOMIZED string. Swapping it for
   `jsOwnedString` changes interning semantics. The report's own regression line
   ("the init still produces jsOwnedString(vm, <the same atomized literal>)")
   conflates the two. Each file's ONE shared lambda must keep ITS OWN existing
   constructor expression. One-word fix; would otherwise ship wrong.
2. **The `defaultGlobalObject(init.owner)->xxxStrings()` recovery rests on a silent
   invariant.** I grepped all 25 `commonStrings()/markdownTagStrings()/
   http2CommonStrings()/httpHeaderIdentifiers()` call sites: EVERY one passes the
   same globalObject as receiver and argument (the one superficial exception,
   `S3Error.cpp:41` `defaultGlobalObject(g)->commonStrings().s3ErrorString(g)`, is
   idempotent under the recovery since `defaultGlobalObject(defaultGlobalObject(g))
   == defaultGlobalObject(g)`). So the design is SOUND TODAY. But a FUTURE
   `gA->commonStrings().xString(gB)` with `defaultGlobalObject(gB) != gA` silently
   yields the wrong string / OOB. Add one `RELEASE_ASSERT(&init.property >=
   &self.m_strings[0] && &init.property < &self.m_strings[N])` -- 2 instructions,
   runs once. For A3 the recovery (`WebCore::clientData(init.vm)
   ->httpHeaderIdentifiers()`, a per-VM singleton) is already what the CURRENT
   lambda does at `HTTPHeaderIdentifiers.cpp:10` and is airtight with no assert
   needed.

### One OVERSTATED sub-claim (fallback form only)
The FALLBACK estimate (`288x(628-110) - 1,500 = 0.141 MB`) assumes a ~110-B
per-thunk residue. From my disassembly of the real 522-B body, the residue that
CANNOT move into a `NEVER_INLINE initLazyLiteral(const Initializer&, ASCIILiteral)`
helper -- the recursion guard, the `DeferTerminationForAWhile` RAII inc/dec + its
`undoDeferTerminationSlow` cold tail, the two `RELEASE_ASSERT`s + `WTFCrashWithInfo`
tails, prologue/epilogue, and the `callq` itself -- is **~200-240 B, not 110 B**.
Real fallback saving is ~0.10-0.11 MB, not 0.141. **Only the fallback.** The PRIMARY
design (ONE lambda type per file => the WHOLE body collapses) is unaffected:
180,830 - (5-6 surviving bodies ~3.5 KB) + (new `kLits` tables 191 x 16 B = 3,056 B,
since `ASCIILiteral` = `std::span<const char>` = 16 B) - (the 288->~5 `theFunc` 8-B
statics, ~2.3 KB back) = ~0.168 MB. **CONFIRMED.**

### One IMPRECISE census claim (affects NO proposal)
The F1 table's buckets B/C/D/E (`initGeneratedLazyClasses` 202,552 / `JSGlobalObject::init`
249,759 / `finishCreation` 163,692 / other 52,610) are produced by a SUBSTRING
classifier. The 92 bucket-B symbols are really
`LazyProperty::callFunc<JSC::LazyClassStructure::initLater<initGeneratedLazyClasses()::$_N>::'lambda'>`
(NESTED lambdas), so a name-anchored regex gives a DIFFERENT B/C/D split (I got
B=0, C=139,127/210, D=77,858/73, other=451,628/238 for the same 849,443 total).
Buckets A1-A4 are unambiguous either way and the proposal touches only those.
Whoever consumes the B/C/D handoff numbers (w3-lto-pipeline,
w3-webkit-build-options) should re-derive them.

### Duplication: NONE in waves 1/2
I grepped all 24 wave-1/wave-2 output files. The ONLY `LazyProperty`/`callFunc`/
`CommonStrings` mention is `w2-generated-classes.report.md:105` -- the 92
`initGeneratedLazyClasses` lambdas (bucket B), which CP-1 EXPLICITLY EXCLUDES.
SYNTHESIS2 row 14 (BunBuiltinNames) is a different file and different symbols
(425 `Identifier`s, not the 103 `JSString` LazyProperties; `BunCommonStrings` only
READS 3 of them via `WebCore::builtinNames(init.vm)`). Row 9 (gc-1) is
`subspaceForImpl` in `BunClientData.h` / `generate-classes.ts` -- zero shared
addresses with A1-A4. Row 5 (`--icf=all`): fully additive (byte-proven above).
Not in the DISCARDED list: the callFunc bodies are 413-766 B each, BELOW
w2-symbol-hunt's exhaustive >=4 KB census, so CP-1 does NOT re-open "the
entire >=4 KB symbol population ... is EMPTY".

### WAVE-3 SIBLING overlap (the synthesizer must handle)
`w3-machine-outliner.report.md:213` independently found the 94-copy A3 family
(`8,178 B | 18 | 94 | callFunc<HTTPHeaderIdentifiers::$_93>`) via instruction
repetition. Its outliner mechanism can recover AT MOST 8,178 B of A3's 72,004 B
(it cannot share the relocation-divergent portions). The report's overlaps section
ALREADY flags this correctly ("If both land, CP-1 first"). **Count the 8,178 B
once; CP-1 subsumes it.**

---

## CP-2

### Derivation reproduces -- but measures a DIFFERENT mechanism than it prescribes
Re-running the unit's own `/tmp/w3-code-patterns/assets2.ts` under the canary:
`74 files, raw=128,937, zstd22(ONE solid archive)=23,484, SAVING=105,453 B = 0.101 MB`.
EXACT. The `node_fallbacks.rs:34-71` precedent (`create_source_code_getter!` ->
per-file `.zst` + `bun_zstd::decompress_alloc` + `bun_core::Once`) is real and
verbatim, including the quoted comment.

My independent measurement (`/tmp/skeptic/perfile.ts`), same file set:
```
ONE solid archive        = 24,391  -> saving 107,584 B = 0.103 MB
per-COMMAND archive (x4) = 26,414  -> saving 105,561 B = 0.101 MB
PER-FILE (node_fallbacks shape, the one the "files + change" describes)
                         = 43,197  -> saving  88,778 B = 0.085 MB
```
**The "files + change" prescribes per-file `.zst`; the 0.101 needs a per-command
(or solid) archive + index.** Honest band: **0.085-0.101**. The per-command
archive is the right design and a trivial codegen change, so 0.101 is
RECOVERABLE -- but the report as written is internally inconsistent. WEAKENED.

### Perf: CONFIRMED cold
- The 3 `*_COMPLETIONS` consts have exactly ONE consumer
  (`shell_completions.rs:21-23`), dispatched ONLY via `cli/mod.rs:1308`
  `Tag::InstallCompletionsCommand => exec_install_completions()`. One-shot.
- `bun init`/`bun create` are terminal scaffolding commands. No hot caller exists.
- zstd is already statically linked (cited in the proposal; `bun_zstd` is in the
  node_fallbacks dep graph).

### Implementation gaps not named (both mechanical)
1. `init_command.rs:1737+` puts the `include_bytes!` inside `const
   TemplateFile::new(name, bytes)` arrays. A `const` slot cannot hold a lazy
   getter. `TemplateFile` must grow a `get: fn() -> &'static [u8]` (exactly the
   `FallbackModule { code: fn }` shape node_fallbacks already uses), or the
   per-tree-archive+offset-index form.
2. `src/runtime/test_runner/harness/fixtures.rs` wraps its 4 `include_bytes!` in a
   `bun_core::comptime_string_map!` (a const perfect-hash table) -- cannot be
   lazified per-file. Exclude those 4 (~6 KB); below noise.

### WAVE-3 SIBLING DUPLICATE (must be counted once)
**`w3-weird-ideas` proposal `W3 completions-zstd` claims the SAME 56,816 B of
`completions/bun.{bash,zsh,fish}` for -0.0437 MB** (its lines 338-353). That is
44% of CP-2's raw bytes. CP-2 strictly SUBSUMES W3. Credit once.

### NOT a wave-1/2 duplicate
SYNTHESIS2 row 19 (`runtime.js x4` in `ParseTask.rs`, `src/bundler/`) is disjoint
from CP-2's filter. `w2-rust-cold-crates` only sizes `init_command.rs`'s FUNCTION
bodies (30,037 B of `.text`), not its `.rodata` data -- different bytes. Not in
DISCARDED.

---

## CP-3

### Size: CONFIRMED, independently, from the LIVE canary's own JS API
```
$ bun -e 'const t=require("node:tls"); ...'   # /tmp/canary/bun-linux-x64/bun
rootCertificates.length = 120
total PEM bytes         = 179,602        <- EXACT match to the .rodata extraction
PEM  zstd22 = 100,889  -> saving  78,713 B = 0.075 MB   (report: 101,551 / 0.074)
DER  raw    = 128,018  (EXACT)   DER zstd22 = 91,338
```
My number is 662 B BETTER (the report's .rodata slice included the 120 NUL
terminators). **0.074-0.075 CONFIRMED.**
- `grep -ac -- '-----BEGIN CERTIFICATE-----' bun` -> 120. `root_certs.h` = 197,527 B.
  The ONLY named canary symbols: `root_certs` (1,920 B = 120 x sizeof(us_cert_string_t)
  = 120 x 16) and `us_internal_init_root_certs(...)::root_cert_instances_once`
  (4 B, `.bss`) -- **the `std::call_once` is PROVEN from the symbol table.**
  The PEM text has NO symbol -> every symbol sweep (incl. w2-symbol-hunt's
  exhaustive >=4 KB census) is blind to it. F5's "why nobody found it" is TRUE.
- Grepped all 24 wave-1/2 files for `root_cert|rootCertificates|BEGIN CERTIFICATE`:
  **ZERO hits.** The report's "Verified unclaimed" is correct.
- The generators (`generate-root-certs.{mjs,pl}`) and `root_certs.cpp` exist at
  the named paths.

### THE REGRESSION THE REPORT MISSED -- and explicitly DENIED
`root_certs.cpp:167-170`:
```c
extern "C" int us_internal_raw_root_certs(struct us_cert_string_t **out) {
  *out = root_certs;      // <-- reads root_certs[] DIRECTLY. No call_once.
  return root_certs_size;
}
```
Consumer chain: `NodeTLS.cpp:24` `us_raw_root_certs(&out)` (-> `context.c:43` ->
`us_internal_raw_root_certs`) then the loop at `NodeTLS.cpp:29-33` reads
`out[i].str/.len` to build the `tls.rootCertificates` JSArray. **I PROVED on the
live canary that this path fires with ZERO TLS connections** (`tls.rootCertificates
.length === 120` from a bare `-e`). CP-3's design puts the decompress "inside the
EXISTING std::call_once" of `us_internal_init_root_certs` -- which this reader
NEVER calls. Shipped verbatim, `require('node:tls').rootCertificates` and
`tls.getCACertificates('bundled')` return 120 empty/garbage strings on any process
that touches them before a TLS handshake. The report's regression line --
"none functionally: tls.rootCertificates / Bun::getBundledRootCertificates read the
same array of the same bytes" -- is the opposite of the truth.

FIX (5 lines, does not change the 0.074): add a
`static const us_cert_string_t* us_get_root_certs(void)` whose OWN `std::call_once`
does the zstd decompress + pointer fixup, and route BOTH
`us_internal_init_root_certs` (line 156) AND `us_internal_raw_root_certs` (line 168)
through it. `tls.rootCertificates` then pays the one-time 0.2-ms decompress on a
documented-slow, one-shot getter -- still correct, still lazy.

**The sibling `w3-binary-archaeology` ALREADY FOUND this exact reader** (its lines
223-225 name `NodeTLS.cpp:24 -> us_internal_raw_root_certs, root_certs.cpp:167-170`
under a "regression:" heading). CP-3's regression analysis is strictly worse than
its sibling's.

### TRIPLE WAVE-3 DUPLICATE (synthesizer: count ONCE)
The same ~0.074 MB is proposed by THREE wave-3 units:
1. `w3-code-patterns/CP-3` (this one) -- PEM->zstd, WRONG regression ledger.
2. `w3-binary-archaeology` -- the DER variant, CORRECT regression ledger (names the
   bypass reader), also proposes a clean `us_internal_raw_root_certs` hook.
3. `w3-weird-ideas` -- same PEM->zstd, 0.0745.
`w3-code-patterns` finished first (05:02 vs 05:17 vs 05:34) so it is the first
finder; but the version to IMPLEMENT is `w3-binary-archaeology`'s.

### Windows / RSS ledger: honest as stated
PE `.bss` = 0 file bytes; `root_certs.h` is cross-platform. The ~180 KB anon-RSS
cost for TLS-using processes is carried explicitly and has the real
`patches/lshpack/bss-huff-tables.patch` precedent. Not in any DISCARDED list.

---

# DISCARDED-LIST RE-OPEN CHECK: CLEAN
None of CP-1/2/3 duplicates a SYNTHESIS2 row or re-opens its DISCARDED section:
- NOT re-opening "the entire >=4 KB symbol population outside ICU is EMPTY": CP-1's
  bodies are each <1 KB; CP-3's PEM is unnamed merged-string `.rodata`; CP-2's
  blobs are data, not `.text` symbols. All three are STRUCTURALLY invisible to
  the >=4 KB symbol census -- the unit's own point, and it is correct.
- NOT row 14 (BunBuiltinNames), NOT row 9/gc-1 (subspaceForImpl), NOT row 19
  (runtime.js), NOT row 6 (brotli, same MECHANISM different bytes), NOT any
  perf-locked item.
- The unit's F7 dead_ends all spot-checked and confirmed directionally
  (ErrorCode machinery is NOT a stamp; `BUN_DEBUG_` strings in the canary = 2;
  every family is far below the 0.2 MB bar).

---

# credible NEW (non-duplicate) total MB for this unit: **0.34**

Breakdown and caveats the synthesizer needs:
- ALL 0.34 is NEW relative to waves 1+2 (zero overlap with any SYNTHESIS2 row
  or DISCARDED item; verified by grep over all 24 files).
- CP-1 = **0.168** (CONFIRMED to the byte; uniquely this unit's).
- CP-2 = **0.085 as written / 0.101 with the per-command-archive fix**; 0.044 of
  it is co-claimed by `w3-weird-ideas/W3`.
- CP-3 = **0.074-0.075** (size CONFIRMED; design broken as written but trivially
  fixable) -- a THREE-WAY wave-3 claim. Count once; implement
  `w3-binary-archaeology`'s version.
- Strictly-unique-to-THIS-unit, after removing the 0.044 + 0.074 co-claimed with
  siblings: **~0.22-0.23 MB.**

Refuting was the success criterion; I could not refute CP-1 despite a full
independent re-derivation, a hot-caller hunt, a live-canary API test, and a
source audit of all four files. It is the single strongest, most byte-proven,
lowest-risk C++ source proposal I have seen in this workflow.

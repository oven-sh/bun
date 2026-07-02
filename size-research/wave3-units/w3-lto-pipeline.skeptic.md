# SKEPTIC — w3-lto-pipeline

All checks run against the REAL shipped artifacts: `/tmp/canary/nm-dem.txt`,
`/tmp/canary/bun-linux-x64-profile/bun-profile` (disassembled by address range),
`/tmp/canary/bun-linux-x64-profile/bun-profile.linker-map`,
`/tmp/canary/bun-linux-x64/bun` (executed), the unit's own non-LTO reference
`/workspace/bun/build/release/bun-profile`, and the EXACT CI LLVM
(`opt-21`/`clang-21` = **21.1.8**, matching `scripts/build/tools.ts:267`).
Scratch evidence: `/tmp/skeptic-lto/` (`t1/t2/t3_*.ll` + the `opt-21` runs,
`abg_lto.asm`, `abg_non.asm`, `jt_lto.asm`, `jgo_lto.asm`, `reverify.py`,
`lp2_derive.py`).

---

## VERDICTS

**VERDICT LP-1 (`w3-lto-pipeline/LP-1-cold-callsite-threshold`): WEAKENED** —
the MECHANISM is real and I strengthened it (a shipping `-Wl,-mllvm,X`
precedent already exists at `flags.ts:873`, which the unit missed), the
saving_mb is honestly declared UNKNOWN (so there is nothing to bank and
nothing to refute numerically — the unit said so itself), but the ONE
confidence claim it did make — **"HIGH on sign (non-negative)"** — is
**EMPIRICALLY FALSE**. I constructed a realistic IR counterexample
(single-cold-caller internal callee under an `!prof`-cold branch, the shape of
every JSC/WTF `UNLIKELY()` slow-path helper) and ran it through the real
`opt-21 -passes='lto<O2>'`: at the default `inline-cold-callsite-threshold=45`
the callee is inlined AND its body DCE'd (smaller); at LP-1's `=0` the body
survives standalone AND the call remains (LARGER). The net sign over 52 MB of
.text is genuinely unknown, not "non-negative". Keep it exactly as the unit
framed it — a free relink-only experiment, NOT a banked row — but strike the
sign-confidence sentence before it reaches FINAL.md.

**VERDICT LP-2 (`w3-lto-pipeline/LP-2-minsize-one-shot`): CONFIRMED — and
UNDERSOLD by ~3x.** Every one of the 14 target symbols re-derived by ADDRESS
from `nm-dem.txt`: each is exactly ONE text record at ONE unique address (zero
ICF aliasing), and the sum is **byte-exact: 744,778 B**. The central
InlineCost claim ("`LastCallToStaticBonus` is preserved under `minsize`, so
the single-caller body-merge still happens") is **EMPIRICALLY PROVEN** on LLVM
21.1.8 (test T1). But the unit's MAGNITUDE MODEL is wrong: it priced only the
codegen-density effect (744,778 × 5-12% = 0.04-0.09) and IGNORED the
inliner-threshold effect of the very `updateThreshold()` code it quoted. I
proved that effect too (test T2: a `minsize` caller DECLINES every
multi-caller callee of cost > 5 while a normal caller still inlines it), AND I
disassembled the two biggest non-JITThunks targets to show their LTO growth is
dominantly that reversible multi-caller duplication (86% for
`addBuiltinGlobals`, proven by a deleted-body audit the unit never ran).
**Just those two symbols' reversible duplication (~0.088 MB) already reaches
the top of the unit's 0.04-0.09 band, and the change-list-covered set is
~0.14 MB.** Also: the described change covers only 617,476 B of the
744,778 B base (3 bun-owned symbols + the 48,719 B lambda are summed but
assigned no change), and the perf claim omits the `hyperfine 'bun --version'`
tripwire that its own cited precedent (SYNTHESIS2 Tier-A row 12) carries.

---

## EVIDENCE

### A. Every F-section foundation I checked, checked out (the unit's homework is excellent)

| claim | my re-derivation | verdict |
|---|---|---|
| F4 canary .text, addr-deduped | **54,292,438 B / 60,385 addrs** | EXACT |
| F4 non-LTO .text, addr-deduped | **50,985,516 B / 80,272 addrs** | EXACT |
| F4 net LTO growth | +3,306,922 B | EXACT |
| F1 linker map: input sections from `bun-profile.lto.o` | `grep -c` = **89,562** | EXACT |
| F1 no ThinLTO / `--lto-partitions>1` | 0 `bun-profile.lto.N.o` in the map | CONFIRMED |
| F1 `-fno-lto` exception (`workaround-missing-symbols.cpp`) | 61 map hits; `flags.ts:1534-1543` verbatim | CONFIRMED |
| F1 toolchain | `tools.ts:267` = `"21.1.8"`; installed `opt-21` = 21.1.8 | EXACT |
| F1 flags.ts:480-500 (full-LTO-because-ThinLTO-miscompiles-JSC, `axobject-query` repro) | verbatim | CONFIRMED |
| F1 `-fwhole-program-vtables` at :518, `-O3` at :272, `-fvisibility=hidden` at :372 | all present | CONFIRMED |
| F2: all 16 claimed cl::opt defaults on `opt-21` | all 16 match (225/325/45/45/2/3000/525/5/25/0/0/0/0/3/500/150) | EXACT |
| F3: `lto<O2>` has bare `ipsccp`, `globaldce<vfe…>` 3x, `wholeprogramdevirt`, `lowertypetests` 2x; NO `forceattrs`/`mergefunc`/`hotcoldsplit`/`partial-inliner`/func-spec | pipeline dumped and grepped | CONFIRMED (I count 80 passes, unit said 78 — comma-split noise) |
| F3: `lto-pre-link<O3>` HAS `forceattrs` + bare `ipsccp` | yes | CONFIRMED |
| "minor doc bug": `flags.ts:904` says 275 but LLVM 21's threshold is 250 | `/usr/lib/llvm-21/include/llvm/Analysis/InlineCost.h:46: const int OptAggressiveThreshold = 250;` | CONFIRMED at the exact header:line |
| F4 commit skew = 7, none touches `webkit.ts` | `git log d816daf47..eba370b69` = 7; 0 hits on the file | CONFIRMED |
| non-LTO reference is real & non-LTO | `configure.json={"profile":"release"}`, `grep -c flto build.ninja`=0, stripped `bun`=73,235,984 B | CONFIRMED |
| `bun:jsc` has no runtime option-setting API (so `setOptionWithoutAlias` is startup-only) | ran the canary; 35 exports, no `setOption*` | CONFIRMED |
| F7 LOLJIT / typedArray / D2 vtable counts | within 0.3-1.2% (bucket-regex noise only); D2's 87%-already-eliminated argument robust either way | CONFIRMED |

F2/F3/F6/D1/D3/D4/D7/D8's LLVM-mechanism foundations are all independently
verified. **D2 (VFE) is a genuinely valuable, correctly-closed dead end** that
would otherwise have cost someone a rebuild.

### B. The three empirical inliner tests (LLVM 21.1.8, `opt-21 -passes='lto<O2>'`)

```
T1  minsize caller + SINGLE-live-use internal callee (cost ~45 >> threshold 5)
    -> callee GONE (inlined + DCE'd).
    PROVES LP-2's claim: LastCallToStaticBonus survives minsize.

T2  minsize caller + the SAME callee with TWO callers
    -> callee body SURVIVES; the minsize caller KEEPS the `call`;
       the non-minsize caller inlined it.
    PROVES the mechanism the unit's 5-12% estimate OMITTED: [[clang::minsize]]
    on a caller is a per-caller "decline all multi-caller inlining above cost 5".

T3  single-cold-caller internal callee at an !prof-cold (1:2000) callsite
    default -inline-cold-callsite-threshold=45 -> callee GONE (inlined+DCE'd)
    LP-1's  -inline-cold-callsite-threshold=0  -> callee body KEPT + the call
    The LP-1 change made THIS module LARGER. Counterexample to "HIGH on sign".
```

Mechanically: `Cost` starts at `-(CallPenalty(25) + InstrCost(5)*nargs)` before
accumulating, so threshold 0 does NOT mean "never inline at cold sites" — it
means "inline only when it is a net size win AT THE SITE". The unit's "≤9 IR
instructions at threshold 45" also under-counts (it is ~14-18 once the callsite
bonus is included). Neither changes the proposal; both change the rhetoric.

### C. The one substantive ERROR in the unit's analysis (F5 proof #1 / D5 / its "§E.3 CLOSED" claim)

The unit asserts that the LTO growth of `JSGlobalObject::init` (#6) and
`Zig::GlobalObject::addBuiltinGlobals` (#29) is "the same shape" as
`JITThunks::initialize` — i.e. single-caller body RELOCATION, hence a ~0 size
lever — and on that basis declares SYNTHESIS2's two §E.3 "need a MEASUREMENT"
items **CLOSED** ("pure relocation. Outlining either gains ~0 bytes. Do not
send anyone back there."). **Disassembly of the real canary refutes this for
both #6 and #29.**

| symbol | instrs | calls | top call targets |
|---|---:|---:|---|
| LTO `JITThunks::initialize` (211,699 B) | 44,613 | 3,431 | `LinkBuffer::linkCode` **105x**, `finalizeCode…` **105x**, `~LinkBuffer` **105x**, `~AbstractMacroAssembler` **105x** — i.e. **105 whole thunk-generator bodies merged in**. RELOCATION. The unit is RIGHT here. |
| LTO `JSGlobalObject::init` (99,581 B) | 20,848 | 1,801 | `putDirectWithoutTransition` 182x, `Structure::Structure` 76x, `JSFunction::create` 72x, `StringImpl::~StringImpl` 240x, the allocator slow-path lambda 130x |
| LTO `addBuiltinGlobals` (48,121 B) | 10,725 | 644 | `JSFunction::create` 45+26x, `UnlinkedFunctionExecutable::link` 45x, `putDirectInternal` 31x, `StringImpl::~StringImpl` 111x, `didAllocate` 43x |
| non-LTO `addBuiltinGlobals` (12,219 B) — the CONTROL | 2,670 | 190 | — |

For `init`/`addBuiltinGlobals`, EVERY call target is MULTI-caller public JSC
API whose standalone body is alive in the canary. The paired counts are the
tell: 111 calls to `~StringImpl()` (the SLOW path) mean 111 inline-expanded
`deref()` FAST paths; 43 `didAllocate` calls mean 43 inline-expanded allocator
fast paths.

**I also ran the deleted-body audit on `addBuiltinGlobals` — the test the
unit's F5 proof #1 used for #9/#1 but never ran for #29 — and it SPLITS the
delta.** Exactly TWO single-caller bodies were absorbed (present non-LTO,
ABSENT from the canary): `WebCore::StreamInternalsBuiltinFunctions::init`
(2,561 B) and `WebCore::TransformStreamInternalsBuiltinFunctions::init`
(2,426 B). Together: **4,987 B = 14% of the +35,902 delta is RELOCATION**
(and it explains the 2x `streamInternalsCreateFIFOCodeExecutable` + 45x
`JSFunction::create(FunctionExecutable…)` calls in the disassembly — those
are the absorbed bodies' internals). The OTHER **86% (30,915 B)** has NO
corresponding deleted body and is inline-COPIED fast paths of alive
multi-caller JSC primitives: **DUPLICATION** — exactly what T2 proves
`[[clang::minsize]]` reverses (the 14% relocation part is `LastCallToStatic`
and stays merged, correctly, per T1).

Consequences:
1. **F5's headline "(b) ceiling as a size lever ≈ 0 MB" is WRONG as stated.**
   The correct statement: the RELOCATION component of (b) has a ~0 ceiling
   (proven for JITThunks); the cross-TU DUPLICATION component of (b) is real
   and ≈0.2 MB across just the LP-2 set, and LP-2 is the lever.
2. **D5's "the +2.7 MiB of multi-caller duplication ... no flag can separate
   it from hot-path inlining WITHOUT PGO" is self-refuted by LP-2.** A
   per-CALLER `minsize` annotation on a proven-cold caller IS the separator;
   no global flag is needed and no PGO is needed. The unit proposed it and
   then failed to connect it to its own D5.
3. **Do NOT carry the "CLOSES SYNTHESIS2 §E.3" line into FINAL.md.** It is
   right for `JITThunks::initialize` (and proves SYNTHESIS2 B6's downgrade)
   and WRONG for `JSGlobalObject::init` + `addBuiltinGlobals`.

### D. LP-2 re-derived and completed: the full per-symbol ledger

Every LTO size byte-exact from `nm-dem.txt` (one unique address each); every
non-LTO size from the unit's own `nm-local-dem.txt` (same method).

| symbol | LTO B | non-LTO B | Δ | shape | in the unit's change list? |
|---|---:|---:|---:|---|---|
| `JSC::JITThunks::initialize(VM&)` | 211,699 | 20,490 | +191,209 | RELOCATION (proven) | yes (WebKit) |
| `JSC::JSGlobalObject::init(VM&)` | 99,581 | 38,130 | +61,451 | **DUPLICATION (proven)** | yes (WebKit) |
| `JSC::BytecodeIntrinsicRegistry::BIR(VM&)` | 59,084 | 43,080 | +16,004 | WebKit, unclassified | yes |
| `JSC::Options::initializeWithOptionsCustomization::$_0` | 48,719 | 57,229 | −8,510 | LTO SHRANK it | **NO** (a lambda; non-trivial to annotate) |
| `Zig::GlobalObject::addBuiltinGlobals(VM&)` | 48,121 | 12,219 | +35,902 | **DUPLICATION (proven)** | yes (`ZigGlobalObject.cpp:2929`) |
| `WebCore::ReadableStreamInternalsBuiltinFunctions::init` | 47,764 | 12,686 | +35,078 | duplication (same generator) | yes (`bundle-functions.ts:718`) |
| `JSC::Options::setOptionWithoutAlias` | 43,367 | 55,095 | −11,728 | LTO SHRANK it | yes |
| `JSC::VM::VM(…)` | 41,860 | 19,838 | +22,022 | WebKit | yes |
| `WebCore::BunBuiltinNames::~BunBuiltinNames()` | 39,075 | 28,866 | +10,209 | bun-owned | **NO** |
| `WebCore::WritableStreamInternalsBuiltinFunctions::init` | 25,196 | 6,611 | +18,585 | duplication | yes |
| `WebCore::DOMIsoSubspaces::~DOMIsoSubspaces()` | 24,541 | 8,809 | +15,732 | bun-owned | **NO** |
| `JSC::IPInt::initialize()` | 22,290 | 26,584 | −4,294 | LTO SHRANK it | yes |
| `WebCore::ReadableByteStreamInternalsBuiltinFunctions::init` | 18,514 | 4,856 | +13,658 | duplication | yes |
| `WebCore::JSVMClientData::JSVMClientData(…)` | 14,967 | 488 | +14,479 | bun-owned | **NO** |
| **TOTAL** | **744,778** | **334,981** | **+409,797** | | |

- The 4 uncovered rows total **127,302 B (17.1%)** of the base the unit
  summed. All 3 bun-owned ones are trivial to reach:
  `src/js/builtins/BunBuiltinNames.h:243` (dtor already explicitly declared),
  `src/jsc/bindings/webcore/DOMIsoSubspaces.h` (dtor is implicit — needs an
  explicit declaration + the attribute), `src/jsc/bindings/BunClientData.h`
  (`class JSVMClientData`). The `$_0` lambda needs a C++23 lambda attribute.
- The `inline void ${basename}BuiltinFunctions::init(JSC::JSGlobalObject&)`
  template at `src/codegen/bundle-functions.ts:718` is real and IS the single
  place that covers all three `*BuiltinFunctions::init` at once. Confirmed.

**Refined LP-2 saving.** The saving is bounded BELOW by the DUPLICATION
component of (LTO − nonLTO) over the annotated symbols (T2 proves `minsize`'s
Threshold-5 declines all of it and the callee bodies already exist), PLUS ~5%
codegen on the rest.
- **HARD (disassembly + deleted-body audit, both done):**
  `addBuiltinGlobals` duplication = **30,915 B**.
- **Disassembly-proven, deleted-body audit not done** (the call-target
  signature is the pure duplication shape; no `*::init`-family absorption
  analog exists for it): `JSGlobalObject::init` +61,451.
- **Same bun codegen template as `abg`, same cross-module-call shape** (3
  symbols): +35,078 +18,585 +13,658 = +67,321 B. These are LEAF generators
  (they absorb nothing), so their deltas are ~all duplication.
- Sum = 159,687 B; after a ~15% haircut on the two unaudited classes for
  undiscovered absorptions: **≈0.14 MB.** (My OWN first pass over-claimed
  0.157 by missing the 4,987 B of `abg` relocation; the deleted-body audit
  above is the correction.)
- NOT banked (real but I will not inflate): the 4 uncovered symbols' +54,899,
  `VM::VM`+BIR's +38,026, and ~5-8% codegen on the ~0.53 MB of
  relocation/shrunk giants (+~15-30 KB). Plausible full-set total
  **0.20-0.28 MB**.

**I raise LP-2 from the unit's 0.05 to a credible 0.14 MB**, band 0.10-0.22.
This is the scope the unit ACTUALLY DESCRIBED (the covered symbols), using
the correct mechanism, with the biggest term audited two independent ways.
One 14-minute LTO relink of the oven-sh/bun half alone would settle it exactly.

### E. Regressions / costs the unit did not list

1. **LP-2 perf: the missing tripwire.** Every target runs at every `bun`
   process start (`VM::VM` → `JITThunks::initialize`; `JSGlobalObject::init`
   → `addBuiltinGlobals` → `JSVMClientData` → the `*BuiltinFunctions::init`;
   the dtors at every Worker teardown). The de-inlining T2 proves is real
   means the startup path gains O(thousands) of extra `call`s — I bound this
   at ~10-20 µs against a ~8-12 ms startup (below noise), but it is not
   LITERALLY zero. The unit's own cited precedent (SYNTHESIS2 Tier-A row 12,
   `#[optimize(size)]` on cold CLI fns) carries an explicit
   **"Tripwire: `hyperfine 'bun --version'`"**. LP-2 must carry the same line.
   (The maintainers are doing perf validation anyway; this names the test.)
2. **LP-2's WebKit half is an upstream-merge liability the unit did not
   price.** The 6 JSC SOURCE-file annotations (`JITThunks.cpp`,
   `JSGlobalObject.cpp`, `VM.cpp`, `Options.cpp`, `IPInt.cpp`,
   `BytecodeIntrinsicRegistry.h` + a new `WTF_MINSIZE` in `Compiler.h`) each
   become a conflict on every oven-sh/WebKit rebase — unlike SYNTHESIS2's
   Tier-B rows, which are Dockerfile flags and `PlatformEnable.h` gates.
   **AND the WebKit half is the LOW-value half** (JITThunks is proven
   relocation → minsize gets ~5% codegen only). **Recommendation to the
   synthesizer: SPLIT LP-2.** The oven-sh/bun-only half
   (`ZigGlobalObject.cpp:2929` + `bundle-functions.ts:718` + the 3 omitted
   bun files) carries ~75% of the proven value (~0.12-0.15 MB), is ONE
   small PR with zero rebase cost, and is the literal, copy-pasteable thing
   FINAL.md wants. The WebKit half is a separate, lower-priority follow-up.
3. **LP-2 / SYNTHESIS2 row 14 interaction (conditional).** LP-2 correctly
   EXCLUDES the `BunBuiltinNames` CTOR (row 14's 0.12) but INCLUDES the DTOR
   (39,075 B). Row 14 as written ("replace the 425-name ctor with a
   `constexpr ASCIILiteral[]` + a loop") leaves the 425 individual `Identifier`
   members — the dtor is unchanged and there is NO double-count. But if row
   14's implementer instead collapses the members into an
   `Identifier m_names[425]` ARRAY (the natural design), the dtor collapses
   to a loop too and LP-2 loses ~36 KB. State the conditional; do not
   double-bank.
4. **LP-1's sign** (§B/T3). Not a user regression; a false confidence label.
5. A few-KB one-time tax neither proposal mentions: a `minsize` caller can
   force a previously-100%-inlined `linkonce_odr` helper to materialize one
   standalone body. Bounded at single-digit KB; noise.

### F. Wave-1 / wave-2 duplication audit

- **LP-2 is NOT a duplicate of any SYNTHESIS2 row and is 100% NEW money.**
  - It is NOT wave-1 B6 (B6 proposed OUTLINING, which SYNTHESIS2 correctly
    refuted as size-neutral for JITThunks and this unit re-proves). LP-2's
    `minsize` is a different, working mechanism. SYNTHESIS2 banked **0** for
    this whole population (B6 "Removed from the totals"; §E.3 items are
    explicitly UNBANKED leads). So the 0.14 is all new.
  - §E.3 item 3 ASKED for exactly this measurement on `addBuiltinGlobals` +
    `JSGlobalObject::init`; LP-2 answers it. A continuation, not a dup.
  - Row 14 (`BunBuiltinNames` ctor): LP-2 excludes it; see §E.3 above.
  - Byte-disjoint from row 9/gc-1 (`subspaceForImpl` copies live inside
    `*::create()`/`subspaceFor<>()` bodies, not inside `init`/`abg`), from B2
    (LOLJIT addresses), and from EJ1/EJ2 (`.rodata` JS source, not `.text`).
- **LP-1 is genuinely NEW** — `inline-cold-callsite-threshold` appears nowhere
  in either synthesis. It is NOT on SYNTHESIS2's perf-locked list
  (it is not -Os/-Oz-globally, not a `--lto-O` change).
- **The dead_ends re-open NOTHING.** D8 explicitly defers to the already-closed
  `--lto-O`. D2 (VFE) is new and correctly killed. D4's MergeFunctions handoff
  to `w3-machine-outliner` is explicitly not counted. The unit's overlaps
  section (B2 LOLJIT, §E.1 regalloc, §E.6 PGO) is careful and does not
  double-count.
- **ONE thing the unit did that helps other units and must not be lost:** the
  `flags.ts:904` "275" is a real doc bug (verified against
  `InlineCost.h:46 = 250`), and `flags.ts:873`'s existing
  `-Wl,-mllvm,-whole-program-visibility` (whose comment at :871 literally
  says "`-mllvm reaches the underlying cl::opt directly`") is the in-repo
  precedent that makes LP-1 a two-line, obviously-plumbed PR.

---

## credible NEW (non-duplicate) total MB for this unit: 0.14

(LP-2 only, raised from the unit's 0.05 on disassembly + deleted-body audit +
empirical-inliner evidence; band 0.10-0.22, with a further +0.05-0.10
available by completing the change list. LP-1 contributes 0 — unbankable by
its own admission, and its one confidence claim is refuted. The unit's real
value, beyond the 0.14, is its F-section characterization — F1-F4 and
D1-D3/D7 are byte-exact and close real dead ends — minus the ONE correction
in §C that must not reach FINAL.md.)

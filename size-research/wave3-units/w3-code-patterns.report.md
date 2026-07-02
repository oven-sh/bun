# REPORT

### unit: w3-code-patterns

## Methodology note (applies to every number below)

Every size is **address-deduped** from `/tmp/canary/nm-dem.txt` (the wave-2 counting
lesson). The query tool at `/tmp/w3-code-patterns/q.py` keeps ONE row per address and
prints both the by-address and by-name totals so the over-count is visible. All raw-byte
proofs were done against `/tmp/canary/bun-linux-x64-profile/bun-profile` (VMA→file
offset delta `0x16c4a00 - 0x14c3a00 = 0x201000`). Everything I was told not to
duplicate (SYNTHESIS2's table + DISCARDED list, GT#1–#8) I checked against BY NAME
before claiming anything; the overlaps section names every interaction.

---

### findings

**F1. THE BIG PATTERN: `JSC::LazyProperty<_,_>::callFunc<Lambda>` — 0.810 MB / 809
instantiations.** Every `someLazyProperty.initLater([](const Initializer& init){...})`
call site creates a UNIQUE stateless-lambda TYPE, and
`vendor/WebKit/Source/JavaScriptCore/runtime/LazyPropertyInlines.h:52` materializes
`static constexpr FuncType theFunc = &callFunc<Func>;` — **one `.text` function per
lambda type**. The canary has **809 of them at 809 distinct addresses totalling
849,443 B**:

```
$ python3 q.py sum 'LazyProperty<.*>::callFunc'
match_lines=809 unique_addrs=809 bytes_by_addr=849443 (0.810 MB)
```

Partition by the function that registered the lambda (`/tmp/w3-code-patterns/lazyclass.py`):

| bucket | bytes | n | avg | owner | prior claim |
|---|---|---|---|---|---|
| A1 `Bun::CommonStrings::initialize()` | 54,347 | 103 | 527 | `src/jsc/bindings/BunCommonStrings.cpp` | **NONE** |
| A2 `Bun::Http2CommonStrings::initialize()` | 36,905 | 61 | 605 | `src/jsc/bindings/BunHttp2CommonStrings.cpp` | **NONE** |
| A3 `WebCore::HTTPHeaderIdentifiers::HTTPHeaderIdentifiers()` | 72,004 | 94 | 766 | `src/jsc/bindings/webcore/HTTPHeaderIdentifiers.cpp` | **NONE** |
| A4 `Bun::MarkdownTagStrings::initialize()` | 17,574 | 30 | 585 | `src/jsc/bindings/BunMarkdownTagStrings.cpp` | **NONE** |
| B `Zig::GlobalObject::initGeneratedLazyClasses()` | 202,552 | 92 | 2,201 | `src/codegen/generate-classes.ts:2607-2626` | **partially gc-1** (SYNTHESIS2 row 9 claims the `subspaceForImpl` cold body INSIDE these; I exclude this bucket entirely) |
| C `JSC::JSGlobalObject::init` | 249,759 | 257 | 971 | **oven-sh/WebKit** (upstream) | none (distinct from wave-1 B6's "the 100 KB `init()` body itself") |
| D `Zig::GlobalObject::finishCreation` | 163,692 | 109 | 1,501 | `src/jsc/bindings/ZigGlobalObject.cpp` | **NONE** — but each lambda builds a DIFFERENT class; not a uniform stamp (see leads) |
| E other bun-owned `initLater` | 52,610 | 63 | 835 | misc | none |
| **TOTAL** | **849,443** | **809** | | | |

**F2. Buckets A1–A4 are a textbook STAMP: N copies of ONE body differing only in
relocations.** Evidence, on the real shipped binary:
- Size clusters are MONOSIZE: A1 = **100 × exactly 522 B** (the
  `_NOT_BUILTIN_NAMES` literal variant; `BunCommonStrings.h` has 100 of these + 3
  builtin-names-backed) + 3 larger. A2 = **61 × exactly 605 B**. A3 = **94 × exactly
  766 B**. A4 = 27 × 605 B + 3 × 413 B.
- **RAW BYTE DIFF** of two of the 100 × 522-B bodies: **27 of 522 bytes differ** (all
  at relocation offsets). Two of the 94 × 766-B bodies: **18 of 766 bytes differ.**
  Normalized-instruction diff (operands stripped): **0 lines.**
- **Disassembly of one 522-B body** (`Bun::CommonStrings::initialize()::$_102` at VMA
  45856992): the LazyProperty bookkeeping (~60 B), then a FULLY-INLINED
  `jsString(vm, AtomString(literal))` — `WTF::AtomStringImpl::addLiteral` call,
  `JSC::JSString::create` call, the StringImpl destructor/refcount dance, the
  **length==0 / length==1 / vm.smallStrings fast paths that can NEVER fire for a
  multi-char compile-time literal** — ~460 B of identical machinery per copy.
- **Why no linker flag can ever fix it:** (a) every one of the 809 is ADDRESS-TAKEN
  (`LazyPropertyInlines.h:52`), so `--icf=safe` (already on, GT#5) skips them by
  construction; (b) their relocations point at DIFFERENT string literals, so
  `--icf=all` (SYNTHESIS2 row 5) cannot fold them either. Byte-proven
  relocation-divergent bodies are the exact class the row-13 redis skeptic
  established can ONLY be fixed in source. **⇒ CP-1 is fully ADDITIVE with row 5.**

**F3. The design is already bun's own idiom — HALF of it exists.** `LazyProperty<O,E>
::Initializer` carries `LazyProperty& property` (`LazyProperty.h:51`) — a reference
to the EXACT field being initialized. So ONE shared lambda can derive its index via
`&init.property - &self.m_strings[0]` (well-defined: both into the same array) and
read an `ASCIILiteral` table. And:
- `BunMarkdownTagStrings.h:67` **ALREADY declares a plain array**
  `LazyProperty<...,JSString> m_strings[MARKDOWN_TAG_STRINGS_COUNT];`
- `BunHttp2CommonStrings.h:101` **ALREADY declares** `m_names[61];`
  Both STILL pay 30 / 61 callFunc copies only because the X-macro closes over a
  per-index literal, producing a per-index lambda TYPE.
- `BunCommonStrings.h:127` and `HTTPHeaderIdentifiers.h:110-111` use NAMED members.
- `HTTPHeaderIdentifiers.cpp:44-50` ALREADY has the index API
  (`identifierFor(vm, HTTPHeaderName)` via a member-fn-ptr table).

**F4. PERF IS PROVABLY UNTOUCHED (cite, don't benchmark).**
`LazyProperty::get()` (`LazyProperty.h:~93-99`) is: load `m_pointer`, test `lazyTag`,
return the cached pointer. `callFunc<F>` runs **AT MOST ONCE per (field, GlobalObject)**
— after the first call `m_pointer` holds the value and the lazy branch is never taken
again. The hot accessor `m_strings[ConstIdx].getInitializedOnMainThread(this)` compiles
to the SAME constant struct offset as the named member did. 100% of the reclaimed bytes
are from code that executes at most a handful of times per process.

**F5. 0.171 MB of PEM root CA text is hiding in `.rodata.str1` with NO symbol.**
`grep -ac 'BEGIN CERTIFICATE' /tmp/canary/bun-linux-x64/bun` → **120**. The exact
shipped bytes, extracted from the canary's `.rodata`:
```
certs: 120   PEM bytes: 179,602 (0.171 MB)   equivalent DER: 128,018
Bun.zstdCompressSync(PEM, {level:22}) -> 101,551 B   (-78,051 = -0.074 MB)
Bun.zstdCompressSync(DER, {level:22}) ->  91,449 B   (-88,153 = -0.084 MB)
```
Source: `packages/bun-usockets/src/crypto/root_certs.h` (197,527 B of C string
literals), consumed by `us_internal_init_root_certs(x509_st**, stack_st_X509*&)`,
which is ALREADY behind a `std::call_once` (`nm` shows the 4-byte
`us_internal_init_root_certs(...)::root_cert_instances_once` flag in `.bss`) and fires
on the first TLS connection that needs the bundled store. **Why no prior unit found
it:** the 120 certs live in the linker's merged-string section under NO named symbol
(the only named symbol is the 1,920-B pointer array `root_certs`), so every
symbol-table sweep (including w2-symbol-hunt's exhaustive ≥4 KB bucketing) is blind to
it. Only a content scan finds it. Verified unclaimed: `grep -li 'root_cert\|PEM'
/tmp/wf2/out/*.md /tmp/wf/out/SYNTHESIS.md` → no hits.

**F6. 125 KB of one-shot CLI scaffolding assets are embedded RAW.** Enumerated EVERY
`include_bytes!`/`include_str!` in `src/*.rs` (excluding the already-zstd'd
`node-fallbacks` and `BUN_CODEGEN_DIR` targets) and **proved each file's presence in
the shipped canary by searching a 64-byte window from its middle**
(`/tmp/w3-code-patterns/assets2.ts`, run under the canary):
```
files=74  PROVEN-in-canary raw = 128,937 B
ONE zstd-22 archive of the proven set = 23,484 B
SAVING = 105,453 B = 0.101 MB
```
The 74 = `completions/bun.{bash,zsh,fish}` (56,816 B; `bun completions`), the
`src/runtime/cli/init/**` templates (3 react trees + defaults + `rule.md`; `bun init`),
and `src/runtime/cli/create/projects/**` (`bun create`). Correctly NOT in the linux
canary: `uninstall.ps1` (windows-cfg), `fuzzilli-reprl.ts`, `incremental_visualizer.html`.
**The precedent is IN-TREE and verbatim:** `src/resolver/node_fallbacks.rs:28-71`
already zstd-precompresses its polyfills at codegen time and lazily
`bun_zstd::decompress_alloc`s into a `bun_core::Once` — its own comment:
*"everything else stops paying ~1 MB of .rodata for the plain text."*
Also confirmed `src/runtime/ffi/{libtcc1.c, ffi-*.h}` = 18,418 B → 4,952 B zstd
(-0.013 MB) on the `bun:ffi` `cc()` one-shot path; below the bar alone, folds into
the same mechanism.

**F7. Every other lead in the brief, answered.**
- **ErrorCode machinery (brief lead 2):** ALREADY optimally factored. The 320
  `$ERR_*` calls in `src/js/` are rewritten by `src/codegen/replacements.ts:18-29` to
  `$makeErrorWithCode(<int>, ...)` — ONE host fn (`ErrorCode.cpp:1824`) + ONE 24-B/row
  `constexpr ErrorCodeData errors[]` table. Total `Bun::ERR_*`/`throwError`/
  `createError`/`jsFunctionMakeError*` by address: **38,558 B**. Not a stamp.
- **Error MESSAGE templates (lead 4):** NOT duplicated. The format strings live only
  in `ErrorCode.cpp`; the JS side passes raw args through `$makeErrorWithCode`.
- **`include_str!`/`concatcp!` (lead 1):** `runtime.js` × 4 is SYNTHESIS2 row 19
  (claimed). `node_fallbacks.rs` is ALREADY zstd'd. The rest is in F5/F6.
- **Giant cross-boundary tables (lead 3):** HTTP status reason phrases appear 2-3×
  and errno descriptions 2× in the binary; the whole duplicated set is **< 8 KB**.
  The MIME table exists ONCE (Rust `bun_http_types`) but its `ComptimeStringMap`
  perfect-hash `__key_index` compiles to **30,059 B of CODE** + an 18,944-B value
  table for a 2,309-entry extension map; the whole 60-symbol `ComptimeStringMap`
  family is only **75,998 B** total (address-deduped). Below the 0.2 MB bar.
- **`declare_scope!`/`scoped_log!` in release (lead 2):** correctly dead-strips —
  only 2 `BUN_DEBUG_` strings in the whole canary.
- **`ALWAYS_INLINE` (lead 5):** in bun's C++, the only size-relevant one is
  `WebCore::subspaceForImpl` at `BunClientData.h:184` == SYNTHESIS2 row 9 / gc-1.
  Rust `#[inline(always)]` (557 sites) is w2-rust-mono's census territory; nothing new.

**F8. The rest of the 0.81 MB + other big stamp families — correctly handed off,
not claimed.** (All address-deduped.)
- `void WTF::dataLog<...>` — **186,547 B / 618 copies** in a RELEASE build; JSC's
  verbose-dump printing. → w3-webkit-build-options.
- `JSC::Wasm::FunctionParser<Ctx>::{validationFail,fail}` — **183,972 B / 178** cold
  error-message builders (×2-3 `Ctx`). → w3-webkit-build-options.
- `std::once_flag::_Prepare_execution::...::__invoke` — **114,517 B / 258**; 66+ are
  `JSC::LLInt::returnLocationThunk`. → w3-webkit-build-options.
- `WTF::tryMakeStringImplFromAdaptersInternal<...>` — 116,003 B / 82 `makeString`
  tuples. → w3-webkit-build-options.
- `<NewServer<SSL,DEBUG>>::*` — 494,380 B / 388 addrs (`set_routes` 111,515 / 4,
  `listen` 43,272 / 4). **Already found by w2-rust-mono and "recorded for wave 3".**
  I verified their verdict: all 4 combos are LIVE (`DEBUG` =
  `Bun.serve({development:true})`, `BunObject.rs:1705-1711`), and the interior of
  `set_routes` (`mod.rs:1981`) is threaded through `uws::App<SSL>`'s SSL-typed
  router + `trampoline::<SSL,DEBUG>` function pointers at 8 sites, so the
  "non-generic `set_routes_inner`" extraction needs an SSL-erased `App` shim.
  Their "~0.14 recoverable, invasive for the value" assessment stands. NOT banked.

---

### proposals

#### CP-1 — Collapse the 288 lazy-JSString `initLater` lambdas in bun's 4 common-string tables to 4

- **id:** `w3-code-patterns/CP-1-lazy-common-strings`
- **saving_mb: 0.168** (band 0.14–0.17)
  - **Derivation, BY ADDRESS from `/tmp/canary/nm-dem.txt`** (commands re-run and
    verified; `q.py` at `/tmp/w3-code-patterns/q.py` always dedupes by address):
    ```
    q.py sum 'callFunc<Bun::CommonStrings::initialize'       = 103 addrs, 54,347 B  (A1)
    q.py sum 'callFunc<Bun::Http2CommonStrings::initialize'  =  61 addrs, 36,905 B  (A2)
    q.py sum 'callFunc<Bun::MarkdownTagStrings::initialize'  =  30 addrs, 17,574 B  (A4)
    lazyclass.py (HTTPHeaderIdentifiers callFunc partition)  =  94 addrs, 72,004 B  (A3)
                                                       TOTAL = 288 addrs, 180,830 B
    ```
    (A3's 94 `static constexpr FuncType theFunc` 8-B data statics from
    `LazyPropertyInlines.h:52` add a further +752 B that ALSO collapse to 1;
    not counted.)
    After the fix each file keeps ONE (or two, for BunCommonStrings' two macro
    variants) `callFunc<F>` body. Floor = 180,830 − 6 × ~750 B ≈ **176,300 B
    = 0.168 MB**. The conservative fallback form (a `NEVER_INLINE` shared helper,
    keeping 288 ~110-B thunks) is 288×(628−110) − 1,500 ≈ **147,700 B = 0.141 MB**.
  - Both numbers are from mono-size clusters (F2) whose per-copy size I read off the
    real binary, not an average.
- **confidence:** high. The byte-identity is raw-byte-proven (F2); the `Initializer`
  API contract is cited (F3); two of the four files already have the required array.
- **perf: neutral** (provably, F4). The hot `LazyProperty::get()` fast path and every
  `xString(globalObject)` accessor compile to byte-identical code. The only changed
  code runs at most once per (string, globalObject).
- **regression:** none. Semantics are unchanged: the init still produces
  `jsOwnedString(vm, <the same atomized literal>)`. The ONLY behavioral delta is in
  `BunCommonStrings`' THREE builtin-names-backed entries, which would go from
  "re-wrap the `BunBuiltinNames` Identifier's StringImpl" to
  "`AtomString(literal)` finds the already-atomized entry" — same `JSString*`
  identity class, one extra one-time atom-table hash lookup. (If that is objectionable,
  keep those 3 on their own lambda; the saving drops by 3 × ~700 B.)
- **windows: yes, ~0.17** (pure cross-platform C++ in oven-sh/bun;
  SYNTHESIS2's measured ~1.0x transfer rule).
- **files + change (copy-pasteable shape):**
  - **Stage 1 (SMALL, -0.051 MB): the 2 files where the array ALREADY exists.**
    `src/jsc/bindings/BunMarkdownTagStrings.cpp:14-18` and
    `src/jsc/bindings/BunHttp2CommonStrings.cpp` — in each, replace the per-entry
    `#define ..._LAZY_PROPERTY_DEFINITION(name, str, idx) this->m_strings[idx].initLater([](auto& init){ init.set(jsOwnedString(init.vm, str)); });`
    + the N-way X-macro expansion in `initialize()` with:
    ```cpp
    #define ..._LITERAL_ENTRY(name, str, idx) str,
    static constexpr ASCIILiteral kLits[COUNT] = { ..._EACH_NAME(..._LITERAL_ENTRY) };
    void XxxStrings::initialize() {
        for (auto& p : m_strings)
            p.initLater([](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) {
                auto& self = defaultGlobalObject(init.owner)->xxxStrings();   // the existing accessor
                init.set(jsOwnedString(init.vm, kLits[&init.property - &self.m_strings[0]]));
            });
    }
    ```
    ONE lambda type ⇒ ONE `callFunc<F>`. `&init.property - &m_strings[0]` is
    defined behavior (both point into the same array object, `...Strings.h:67`/`:101`).
  - **Stage 2 (MEDIUM, -0.117 MB):** same transformation for
    `src/jsc/bindings/BunCommonStrings.{h,cpp}` (convert the 103 named
    `m_commonString_##name` members at `BunCommonStrings.h:127` to
    `m_strings[Index::COUNT]` + an enum; the `##nameString(globalObject)` accessor
    at `:120` becomes `m_strings[Index::name].getInitializedOnMainThread(...)` — same
    machine code) and `src/jsc/bindings/webcore/HTTPHeaderIdentifiers.{h,cpp}` (the
    94 `m_##name##String` at `:110` → an array indexed by `HTTPHeaderName`; the index
    API `identifierFor(vm, HTTPHeaderName)` ALREADY exists at
    `HTTPHeaderIdentifiers.cpp:48`, and this also deletes the two member-fn-ptr
    dispatch tables there).
  - **Fallback form** if the header reshuffle is rejected: add ONE
    `NEVER_INLINE static JSString* initLazyLiteral(const ...::Initializer&, ASCIILiteral)`
    helper per file and call it from the existing macro. 4 one-line macro edits,
    ZERO header change, -0.141 MB.
- **effort:** small (stage 1) / medium (stage 2). No codegen, no WebKit change.
- **relink_only:** NO — a normal `ninja` incremental C++ rebuild of 4 TUs.

#### CP-2 — zstd the one-shot CLI scaffolding assets (the in-tree `node_fallbacks.rs` pattern)

- **id:** `w3-code-patterns/CP-2-cli-asset-zstd`
- **saving_mb: 0.101**
  - **Derivation:** measured byte-exact by `/tmp/w3-code-patterns/assets2.ts` run
    under the CANARY. 74 `include_bytes!` targets, each PROVEN present in
    `/tmp/canary/bun-linux-x64/bun` by a 64-byte mid-file probe; raw = 128,937 B;
    ONE `Bun.zstdCompressSync(concat, {level:22})` archive = 23,484 B;
    **saving = 105,453 B = 0.101 MB.**
- **confidence:** high (the saving is a direct compression measurement of the exact
  shipped bytes; the mechanism already ships in the same repo).
- **perf: one-time-lazy(`bun init` / `bun create` / `bun completions` /
  `bun install-completions` ONLY).** Those are scaffolding commands that write files
  and exit; the single 23-KB zstd decompress (<0.1 ms; bun already links zstd) is
  unobservable against the `mkdir`+`write`+`spawn(npm-install)` they are about to do.
  **ZERO bytes are decompressed on `bun run`/`install`/`test`/`build`/`Bun.serve`.**
  Precedent cited verbatim from the repo: `src/resolver/node_fallbacks.rs:28-71`
  (the `create_source_code_getter!` macro: embed `<name>.js.zst`,
  `bun_zstd::decompress_alloc` once into `bun_core::Once<String>`).
- **regression:** none. The decompressed bytes are identical; the templates are
  written to the user's disk byte-for-byte the same.
- **windows: yes, ~0.10** (the same assets are `include_bytes!`d on windows;
  `uninstall.ps1` joins the set there for a small extra).
- **files + change:**
  1. New codegen step (or a ~30-line extension to the EXISTING fallback
     precompressor `src/node-fallbacks/build-fallbacks.ts`) that writes
     `<BUN_CODEGEN_DIR>/cli-assets/<path>.zst` for each asset.
  2. In `src/runtime/cli/init_command.rs`, `src/runtime/cli/create/
     SourceFileProjectGenerator.rs`, `src/runtime/cli/shell_completions.rs`: replace
     each `include_bytes!("<path>")` with the SAME `create_source_code_getter!`-shaped
     macro `node_fallbacks.rs` uses (`#[cfg(bun_codegen_embed)]` → embed `.zst` +
     `bun_zstd::decompress_alloc` into a `bun_core::Once`; otherwise read from
     `BUN_CODEGEN_DIR`). That macro should be HOISTED into `bun_core` (it is
     currently private to `node_fallbacks.rs`) — one implementation, two users.
  3. Optional +0.013 MB: `src/runtime/ffi/{libtcc1.c, ffi-*.h}` (the `bun:ffi cc()`
     one-shot path) through the same macro.
- **effort:** small-medium. **relink_only:** NO (rust rebuild).

#### CP-3 — Root CA store: zstd the 179,602 B of PEM text, decompress once inside the existing `std::call_once`

- **id:** `w3-code-patterns/CP-3-root-certs-zstd-bss`
- **saving_mb: 0.074**  (the cleaner PEM→DER alternative is **0.049** and is a
  strict PERF IMPROVEMENT — see below)
  - **Derivation:** the 120 PEM blocks extracted from the canary's `.rodata` total
    **179,602 B**; `Bun.zstdCompressSync(exact_shipped_bytes, {level:22})` =
    **101,551 B**; saving = **78,051 B = 0.074 MB**. (DER equivalent: 128,018 B raw,
    91,449 B zstd.) All numbers measured by running the canary on its own bytes.
- **confidence:** high on size (a direct measurement); medium on the exact patch
  shape (uSockets C, not Rust).
- **perf: one-time-lazy(the first TLS connection that uses the BUNDLED CA store).**
  The consumer `us_internal_init_root_certs` is ALREADY gated by
  `std::call_once(root_cert_instances_once, ...)` and already does 120
  `PEM_read_bio_X509` parses at that moment; a 0.2-ms zstd decompress added in
  front of it is the size-facts-sanctioned shape, and **the DER variant REMOVES 120
  base64 decodes** (a strict improvement).
- **regression:** none functionally: `tls.rootCertificates` /
  `Bun::getBundledRootCertificates` read the same array of the same bytes, now in
  `.bss`. **Honest ledger line (same as SYNTHESIS2 row 6's †):** the `.bss` form costs
  ~180 KB of private anon RSS for TLS-USING processes (file-backed shared `.rodata` →
  anon). Precedent the maintainers already shipped:
  `patches/lshpack/bss-huff-tables.patch` — 786 KB of this exact tradeoff.
- **windows: yes, 0.074** (PE `.bss` = 0 file bytes, verified by the row-6 skeptic;
  `root_certs.h` is in the windows binary too).
- **files + change:**
  - `packages/bun-usockets/generate-root-certs.mjs` + `generate-root-certs.pl`
    (the header's own listed generators): instead of emitting 120 PEM
    C-string literals into `root_certs.h`, emit ONE
    `static const unsigned char root_certs_zst[101551] = {...}` + a 120-entry
    `(offset, length)` index.
  - `packages/bun-usockets/src/crypto/root_certs.cpp` (`us_internal_init_root_certs`):
    inside the EXISTING `std::call_once`, `ZSTD_decompress` into a
    file-static `.bss` buffer, then point the existing `root_certs[]` array into it.
    (bun already statically links zstd.)
  - **Alternative with a better perf story (0.049 MB + IMPROVEMENT):** emit the DER
    bytes instead of PEM and swap the 120 `PEM_read_bio_X509` for `d2i_X509`.
    `tls.rootCertificates` then PEM-encodes lazily on first read (it is a cold,
    documented-as-slow Node API).
- **effort:** medium. **relink_only:** NO (a uSockets C rebuild).

**TOTAL for this unit's proposals: 0.168 + 0.101 + 0.074 = 0.343 MB linux, ~0.34 MB
windows.** All three are disjoint from every SYNTHESIS2 row and from each other, and
all three are additive with `--icf=all` (row 5).

---

### dead_ends

- **The ErrorCode machinery (brief lead 2) is NOT a stamp.** 320 codes → ONE
  `jsFunctionMakeErrorWithCode` host function + ONE 24-B/entry `constexpr` table;
  the JS `$ERR_X(...)` calls are codegen-rewritten to `$makeErrorWithCode(int,...)`
  (`replacements.ts:18-29`). By address: 38,558 B total. Already optimally factored.
- **Node error MESSAGE templates are NOT duplicated** across the JS/C++ boundary
  (brief lead 4). The templates live only in `ErrorCode.cpp`.
- **Cross-boundary table duplication (brief lead 3) is noise.** HTTP reason phrases
  appear 2–3×, errno descriptions 2×; the whole duplicated set is < 8 KB.
- **`declare_scope!`/`scoped_log!` correctly dead-strip** (brief lead 2): 2 residual
  `BUN_DEBUG_` strings in the whole 73 MB canary.
- **`include_str!` of `runtime.js` × 4** — SYNTHESIS2 row 19; nothing else in the
  `include_*!`/`concatcp!` population was duplicated.
- **The node-fallbacks polyfills** are ALREADY zstd'd + lazy (`node_fallbacks.rs`).
  Nobody should propose that; it is the precedent CP-2 follows.
- **The `ComptimeStringMap` family** — 75,998 B total; the 30,059-B MIME
  `__key_index` dominates and is below the 0.2 MB bar on its own.
- **`NewServer<SSL,DEBUG>` / `run_tasks<Callbacks>` / `bun_css::parse_entirely`
  / `js_printer`'s const bools** — all found and adjudicated by
  `w2-rust-mono`; I verified their conclusions rather than re-claiming (F8). All 4
  `NewServer` combos are live (`Bun.serve({development})`).
- **The `initGeneratedLazyClasses` bucket (B, 202,552 B)** is NOT a claim here: its
  shared substrate is gc-1's `subspaceForImpl` plus the `allocateCell<Structure>` /
  `Structure::create` fast-path inlined 3-5× per class; I verified the per-class
  `createPrototype/createConstructor` functions are NOT duplicated (only 0.025 MB
  standalone) — LTO correctly chose inline-the-only-caller. The residue is an
  LTO-inlining issue, not a source stamp.
- **`core::ptr::drop_in_place` (225 KB / 750)** — w2-rust-mono's own verdict stands:
  per-type by definition, not a lever.

### overlaps

- **`w2-generated-classes` / SYNTHESIS2 row 9 (gc-1, 0.167):** row 9 claims the
  `subspaceForImpl` cold body, 92 of whose LTO-inlined sites are inside my bucket B.
  **I claim NONE of bucket B.** CP-1 is buckets A1-A4 only (JSString lambdas in 4
  files gc-1 never touches). Zero shared bytes.
- **SYNTHESIS2 row 5 (`icf=all`):** fully additive (F2: every CP-1 body is
  address-taken AND relocation-divergent, so icf never folds them).
- **SYNTHESIS2 row 6 (brotli-tables-to-.bss):** CP-3 uses the identical mechanism
  and the identical `patches/lshpack/bss-huff-tables.patch` precedent, and carries
  the SAME honest RSS ledger line. Different bytes.
- **EJ1/EJ2 (rows 3/18):** CP-2 does not touch `InternalModuleRegistryConstants`
  or `combinedSourceCodeBuffer`.
- **`w2-rust-mono`:** I re-found and CITED (did not re-claim) their `NewServer`,
  `run_tasks`, `parse_entirely` findings; they explicitly recorded `NewServer` for
  wave 3 and I return it with a confirmation of their verdict.
- **`w3-machine-outliner`:** the 809 `callFunc<F>` bodies are exactly the
  "repeated ≥8-instruction sequences across functions" their pass hunts — but the
  x86 outliner can only share instructions WITHOUT divergent relocations, so it
  would recover at best a fraction of CP-1's bytes. If both land, CP-1 first.
- **`w3-lto-pipeline` / `w3-webkit-build-options`:** buckets C (249,759 B, JSC's own
  `JSGlobalObject::init` lambdas) and D (163,692 B, `Zig::GlobalObject::finishCreation`)
  + the `dataLog` (186 K), Wasm `validationFail` (184 K), LLInt `call_once` (114 K),
  and `makeString` adapter (116 K) families are their territory; I supply the
  address-deduped census. Bucket D's mechanism is the `Structure::create` /
  `allocateCell<T>` inlining chain — the same class as SYNTHESIS2 §E lead 3.
- **`w3-binary-archaeology`:** my root-cert find (F5) lives in the UNNAMED merged-
  string `.rodata.str1` section — a symbol-walk and an nm-based entropy-by-symbol
  map will BOTH miss it. Flagging so their §2 sliding-window scan names it.

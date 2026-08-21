# PASS 4 — Config-File Parsers Unsafe-Code Audit

**Scope:** Bun's attacker-controlled file-input parsers (`.env`, `.ini`/`.npmrc`,
JSON5, TOML, YAML, `bunfig.toml`).

**Crates in scope:**

| crate          | path                      | total unsafe sites |
|----------------|---------------------------|-------------------:|
| `bun_dotenv`   | `src/dotenv/`             | 2                  |
| `bun_ini`      | `src/ini/`                | 8                  |
| `bun_parsers`  | `src/parsers/`            | 28                 |
| `bun_bunfig`   | `src/bunfig/`             | 6                  |
| **total**      |                           | **44**             |

`bun_parsers` houses the JSON, JSON5, TOML, and YAML parsers in one crate;
there is no separate `bun_yaml` / `bun_toml` / `bun_json5` crate. The runtime
exposes them as `Bun.YAML.parse`, `Bun.TOML.parse`, `Bun.JSON5.parse`,
`Bun.JSONC.parse` (`src/runtime/api/{YAMLObject,TOMLObject,JSON5Object,JSONCObject}.rs`).

**Headline:** **0 T1 findings.** All 44 sites fall into well-bounded
zig-port patterns (`unsafe { &mut *raw }` / `unsafe { &*raw }` for raw-pointer
provenance, Phase-A lifetime laundering through `'static`, `from_utf8_unchecked`
on ASCII-validated slices, and one Phase-A `'static` cast through
`detach_lifetime`). **1 T2 finding** (stacked-borrows aliasing during
`Parser::parse` while also holding `&parser.arena`, in `bun_ini`). The rest are
T3 or T4.

The lexers proper — `parsers/toml/lexer.rs` (51K), `parsers/json5.rs` (39K) —
contain **zero unsafe blocks**. TOML and JSON5 tokenization is entirely
bounds-checked safe Rust over `&self.source.contents[..]`. Step / peek go
through `bun_core::strings::lexer_step::next_codepoint`, which is itself a
safe-Rust UTF-8 stepper. **No `slice::from_raw_parts(buf.as_ptr().add(off), len)`
of attacker-controlled length appears anywhere in any of the tokenizers.**

---

## 1. Per-crate attack surface

### 1.1 `bun_dotenv` — `.env` files

- **Input reachability:** local `.env` / `.env.local` / `.env.development.local`
  files from disk; also `process.env` (already trusted by OS). Not directly
  JS-exposed via `Bun.dotenv.parse(...)` etc. — `.env` is loaded once at
  startup by `Loader::load_*`. Attacker model is "developer is told to run
  `bun foo.ts` in a malicious repo that contains a hostile `.env`".
- **Parser entry:** `Parser::parse_bytes::<O, IS_PROCESS, EXPAND>` →
  `parse_key`, `parse_quoted`, `parse_value` (`env_loader.rs:1048-1167`).
- **Tokenizer style:** byte-at-a-time, `self.src: &'a [u8]`, `self.pos: usize`,
  every read is `self.src[i]` (bounds-checked).
- **Heap state:** `value_buffer: Vec<u8>` re-used across calls for escape
  decoding; ordinary safe-Rust `push`/`extend`.
- **String interning:** none — keys/values become `Box<[u8]>` in the
  `Map: HashTable` (address-stable storage).

### 1.2 `bun_ini` — `.npmrc` (and any INI consumer)

- **Input reachability:** project-level / user-level `.npmrc` from disk
  during `bun install`. Not JS-exposed via `Bun.ini.parse(userInput)`.
  Attacker model is hostile `.npmrc` in a cloned repo or in `$HOME`.
- **Parser entry:** `Parser::parse(&mut self, bump: &'a Arena)` at
  `ini/lib.rs:330`; called from `load_npmrc` at line 1338.
- **Tokenizer style:** line-based safe-Rust split; per-line `prepare_str`,
  `next_dot` etc. all operate on `&[u8]` slices.
- **Output AST:** `Expr` tree allocated into `parser.arena: Arena` (mimalloc
  bump). All strings are bump-allocated; no interning by attacker key.
- **Notable lifetime-laundering site:** `load_npmrc` at 1352-1360 (analysed
  below in §3.1).

### 1.3 `bun_parsers` — JSON / JSON5 / TOML / YAML

- **Input reachability:** **all four parsers are JS-exposed** as `Bun.JSON`,
  `Bun.JSONC.parse`, `Bun.JSON5.parse`, `Bun.TOML.parse`, `Bun.YAML.parse`
  (`runtime/api/{JSON5,JSONC,TOML,YAML}Object.rs`). Input is an arbitrary JS
  string materialised into a `Source` via `super::with_text_format_source`.
  This is **the** highest attacker priority surface in this pass.
- **Sub-modules:**
  - `json_lexer.rs` — JSON lexer (also serves JSONC). Tokenises `'\\u..'`,
    integer / float / bigint literals. 5 unsafe sites.
  - `json.rs` — JSON / JSONC parser, 1 unsafe site.
  - `json5.rs` — JSON5 parser, **0 unsafe sites**.
  - `toml.rs` — TOML driver, 15 unsafe sites (all are
    rope / object pointer-aliasing in the AST builder, *not* tokenization).
  - `toml/lexer.rs` — TOML lexer, **0 unsafe sites**.
  - `yaml.rs` — YAML parser + lexer, 7 unsafe sites (per inventory; 9 by
    raw `grep "unsafe "` because two are inside macro definitions and
    counted once in the inventory).
- **AST storage:** `bun_alloc::MimallocArena` per parse + `bun_ast::Expr` Store.
  Both are address-stable; the `Expr` Store further protects every `Expr`
  pointee from reallocation.
- **Rope structure:** TOML's `js_ast::e::Rope` is a singly-linked list of
  `(Expr, *mut Rope)` segments allocated into the bump. Every `unsafe { &*rope.next }`
  is preceded by `if !rope.next.is_null()` or equivalent (§3.2 below).

### 1.4 `bun_bunfig` — `bunfig.toml` / `bunfig.json`

- **Input reachability:** project-root `bunfig.toml` (or `bunfig.json`),
  global `~/.bunfig.toml`. Loaded once at CLI startup from disk. Not
  JS-exposed. Attacker model is hostile `bunfig.toml` in a cloned repo.
- **Parser entry:** `Bunfig::parse(cmd, source, ctx)` at `bunfig.rs:1108`;
  dispatches to `bun_parsers::toml::TOML::parse` or `…json::parser::*` based
  on extension. **All 6 unsafe sites are around the process-global `*mut Log`,
  not around parser internals** — `bun_bunfig` itself does not tokenise.

---

## 2. Inventory by category

```
 17 other                  (mostly `unsafe { &mut *raw }` macro / port idioms)
 11 zig_port_mut_ref       (single-provenance Log/Parser raw-pointer pattern)
  8 zig_port_shared_ref    (rope.next walks in TOML)
  5 ptr_cast               (NonNull → &T deref of AST-store pointee)
  3 raw_ptr_lifecycle      (slice-from-raw_parts)
  3 slice_from_raw         (same set as raw_ptr_lifecycle)
  2 ptr_intrinsic          (Box from_raw / SinglyLinkedList raw next link)
  1 raw_cast               (`*mut DotEnvLoader<'_> as *mut DotEnvLoader<'static>`)
```

Tier projection before site-by-site review: **0 T1, 1–2 T2, ~35 T3, ~7 T4**.

---

## 3. Per-site verdicts (Tiered)

### 3.1 T2 — Stacked-borrows aliasing in `bun_ini::load_npmrc`

**File:** `src/ini/lib.rs:1338-1361`

```rust
pub fn load_npmrc(... env: &mut DotEnvLoader<'_>, npmrc_path: &ZStr, ...) -> OOM<()> {
    let contents: &'static [u8] = source.contents.as_ref().into_str();           // 1352
    let env = unsafe {
        &mut *(env as *mut DotEnvLoader<'_> as *mut DotEnvLoader<'static>)        // 1355
    };
    let mut parser = Parser::init(npmrc_path.as_bytes(), contents, env);
    // SAFETY: arena outlives all bump-allocated slices used below
    let bump: &Arena = unsafe { &*(&raw const parser.arena) };                    // 1360
    parser.parse(bump)?;                                                          // 1361
    // ...
    let out_obj: &E::Object = unsafe {                                            // 1545
        &*parser.out.data.e_object().expect("ini parser always yields object").as_ptr()
    };
```

**Three coupled hazards:**

1. **1352** — `source.contents.as_ref().into_str()` is the codebase-wide
   `Str = &'static [u8]` shim (`bun_ast::IntoStr`) which laundres `&[u8]`
   to `&'static`. The underlying memory is `source.contents`, borrowed from
   the caller of `load_npmrc`. Safe in practice: `parser` is dropped before
   `load_npmrc` returns, well before `source` could go away. Idiomatic
   throughout `bun_ast::Source` callers in Phase-A.

2. **1355** — bit-identical `'static` cast of `&mut DotEnvLoader<'_>`. Same
   Phase-A laundering rationale; `parser`'s lifetime is bounded by this
   function, and the JS caller (or `Cli::start`) is the long-lived owner of
   the env loader.

3. **1360** — `let bump: &Arena = unsafe { &*(&raw const parser.arena) };`
   followed immediately by `parser.parse(bump)?`. Here `parser.parse` takes
   `&mut self`; under Stacked Borrows the `&mut self` reborrow invalidates
   the prior `&parser.arena`. The borrow stack would unwind on every
   bump-allocation that reaches through `bump`.

   In practice this **does not produce UB at the language-runtime level**
   because:
   - `Arena` is `mi_heap_t*`-backed with interior mutability (the `heap` field
     is `NonNull<mi_heap_t>` and allocations go through `*const mi_heap_t`),
     so `&Arena` -> alloc never produces a write through the `&Arena`-tagged
     borrow.
   - The `&parser.arena` borrow is read-only with respect to the Arena
     struct itself, and is never re-derived; it is just *used* during
     `parse(bump)`.

   Still, **Miri / Stacked Borrows would reject this aliasing pattern**.
   The author explicitly flags it: "TODO(port): borrowck — `parser.arena`
   is borrowed while `parser` is `&mut`. Phase B should restructure Parser
   so the bump is passed externally."

**Verdict:** T2. Not exploitable at machine-code level, but a real
borrow-rule violation flagged by Stacked Borrows. Fixed in Phase B by
extracting the arena out of `Parser` (the documented plan).

**Recommended remediation (post-Phase-B):**
```rust
let arena = Arena::new();
let mut parser = Parser::init_with_arena(&arena, npmrc_path.as_bytes(), &source.contents, env);
parser.parse(&arena)?;
```
That removes both the `&parser.arena` reborrow *and* the `'static` casts —
`Parser` would carry a `&'b Arena` instead of owning one, so its lifetime
binds naturally.

---

### 3.2 T3 — TOML `rope.next` walks (`unsafe { &*rope.next }`)

**File:** `src/parsers/toml.rs:51,59,74,105,114,127`

```rust
// SAFETY: rope.next non-null (checked) and arena-owned.
return obj.set_rope(unsafe { &*rope.next }, bump, value);
```

Each deref is guarded by either an explicit `if !rope.next.is_null()` or
by being inside a branch reached only after `rope.next.is_null() == false`.
Ropes are allocated into `bump: &Bump` (`MimallocArena`), so `rope.next` is
address-stable for the parse and outlives `set_rope` / `get_or_put_array`.
The Rust port replaces Zig's `*Rope` walk with the same shape but in
recursive method calls; the alternative — turning Rope into a safe `Vec<Expr>` —
would require rewriting `js_ast::e::Rope`, which is shared with `bun_json`
and `bun_bunfig`.

**Verdict:** T3 — zig-port idiom, correct given Rope's arena lifetime
invariant.

---

### 3.3 T3 — TOML `HashMapPool` freelist (`toml.rs:188,220`)

```rust
unsafe {
    *list = if (*node).next.is_null() { None } else { Some((*node).next) };
    (*node).data.clear();
}
// ...
unsafe { (*node).next = list.unwrap_or(core::ptr::null_mut()) };
```

The `HashMapPool` is a thread-local intrusive `SinglyLinkedList` of
`HashMap` nodes. `Node`s are produced exclusively by `heap::into_raw(Box::new(Node {...}))`
and consumed by `get()` / `release()`. The `next` pointer is overwritten on
every `release()` (the comment explains why: a sticky-bit folding into
`Option` requires rewriting `next` on the release path because nodes
returning via `release` may carry a stale `next` from a prior prepend).

**However**: this module is dead code in the Zig source (commented in
`toml.zig`'s sibling) and is also unreachable from the ported TOML parser —
the parser uses `self.bump` directly for its rope allocator. The TODO
explicitly says "verify and delete in Phase B if truly unused".

**Verdict:** T3 (correct as written, intrusive-list invariants well documented),
but should be **deleted** in Phase B. Recommend filing a follow-up.

---

### 3.4 T3 — TOML AST-store raw-pointer aliasing (`toml.rs:188,368,374,468,598,610,645,661`)

These all share the pattern: a JS-AST node (`E::Object`, `E::Array`) lives
in the per-thread Expr Store, but Rust borrow rules conflict with the Zig
pattern of holding a `*E.Object` while also reborrowing `&mut self`. The
port pulls a `NonNull<…>` out via `expr.data.e_object().expect(…).as_ptr()`
and then derefs through `unsafe { (*obj).…() }` / `unsafe { &mut *obj }`.

The Expr Store guarantees pointer stability: a `NonNull<E::Object>` returned
by `as_ptr()` remains valid as long as the Expr Store outlives it
(per-thread, reset between parses by `bun_ast::StoreResetGuard`). The
`obj`/`array`/`head` pointers always alias into the bump-allocated AST and
do not escape `parse_value_inner` / `run_parser` — they're scratch.

**Verdict:** T3. Borrow-checker workaround, not a true unsafety. Phase B
candidate for cleanup (the AST Store could expose a `&mut` shape that
sidesteps the conflict).

---

### 3.5 T3 — JSON lexer `&mut *self.log` (`json_lexer.rs:210,333` and `json.rs:357`)

```rust
fn log_mut(&mut self) -> &mut bun_ast::Log {
    // SAFETY: see struct doc — `log` is the only handle to the `Log` for
    // the lifetime of the parse; no `&mut Log` is held elsewhere
    unsafe { &mut *self.log }
}
```

`self.log: *mut bun_ast::Log`. The `Lexer` is constructed once per parse with
a single `*mut Log`. The struct doc cites the "single provenance chain"
invariant. The `MAYBE_AUTO_QUOTE` retry path at `json.rs:357` explicitly
rebuilds the lexer through the *same* `*mut Log` (via `log_ptr()`) so the
provenance chain is preserved even across reset.

**Verdict:** T3 — standard zig-port single-provenance pattern, well-doc'd.

---

### 3.6 T3 — JSON lexer `from_utf8_unchecked` on ASCII-only number text (`json_lexer.rs:836,967`)

```rust
// SAFETY: scanned bytes are ASCII digits/underscores.
let s = unsafe { core::str::from_utf8_unchecked(text) };
match s.parse::<f64>() { ... }
```

Two sites, both inside `parse_numeric_literal_or_dot`. The scan loop at
lines 761-814 / 854-… only `self.step()`s when the current code-point is
`'0'..='9' | '_' | '.' | 'e' | 'E' | '+' | '-' | 'A'..='F' | 'a'..='f'`
(plus radix prefix chars `'b' | 'B' | 'o' | 'O' | 'x' | 'X'`). Every one of
these is single-byte ASCII, so `text = self.raw() = &self.source.contents[self.start..self.end]`
is provably ASCII at both safety sites.

**Verdict:** T3. The two cheaper alternatives are
`str::from_utf8(text).expect("ASCII")` (allocates the error path) or
`std::str::from_utf8(text).unwrap_unchecked()` (still unsafe). Using
`unsafe` here is principled. Add a `debug_assert!(text.is_ascii())` for
belt-and-braces (already-known-cheap recommendation; recommended but not
required for soundness).

---

### 3.7 T3 — JSON lexer dead `Utf16` arm (`json_lexer.rs:575-580`)

```rust
StringLiteralFormat::Utf16 => {
    // SAFETY: when Utf16, the raw-content slice was produced from a
    // `[]const u16` reinterpreted as bytes; len is the u16 count.
    // (JSON path never sets Utf16 — only the JSX rescan does.)
    let s16 = unsafe {
        core::slice::from_raw_parts(
            self.string_literal_raw_content.as_ptr().cast::<u16>(),
            self.string_literal_raw_content.len(),
        )
    };
    Ok(js_ast::E::String::init_utf16(s16))
}
```

`string_literal_raw_format` is set at exactly one place in this file
(`line 549`) to either `Ascii` or `NeedsDecode` — the `Utf16` variant is
**dead code in the JSON lexer**, retained for layout-symmetry with the JSX
lexer. If it were ever reached, soundness would depend on:
- the underlying allocation having u16 alignment (NOT guaranteed: source
  bytes are u8-aligned),
- `len` being interpreted as a u16 count when the slice carries `len`-bytes.

Both assumptions would silently produce UB if the variant ever escaped the
"only JSX rescan sets this" invariant. The variant is unreachable today;
the hazard is *defensive code rot* — not a current bug.

**Verdict:** T3 with footnote. **Recommend**: replace the body with
`unreachable!("JSON lexer never sets Utf16 format")` and delete the unsafe
block. The Zig source's symmetry rationale doesn't carry through Rust's
exhaustiveness checking — Rust requires the arm, but
`unreachable_unchecked()` would be wrong (still allows UB if reached);
`unreachable!()` is correct.

---

### 3.8 T3 — YAML `StringBuilder` raw back-pointer to `Parser` (`yaml.rs:894,904,908,917,1198,1230,1344,3849,5673`)

```rust
pub struct StringBuilder<'a, Enc: Encoding> {
    parser: *mut Parser<'a, Enc>,
    pub str: YamlString<Enc>,
}
impl ... {
    fn parser(&self) -> &Parser<'a, Enc> { unsafe { &*self.parser } }
    fn parser_mut(&mut self) -> &mut Parser<'a, Enc> { unsafe { &mut *self.parser } }
}
```

This is the YAML scalar-builder back-reference. Zig stored `parser: *Parser(enc)`
on the `StringBuilder`; Rust would normally express this as
`&'a mut Parser<'a, Enc>`, but that ties the builder's borrow to the
parser's input lifetime (invariant under `&mut`), which both fails the
borrow-checker at `string_builder()` and aliases with the `&mut Parser`
that drives scanning. The doc-comment is explicit:

> "Use a raw backref (the LIFETIMES.tsv BACKREF resolution). Private —
> invariant-bearing raw backref; reach via `parser()` / `parser_mut()`."

`scan_plain_scalar` constructs the `StringBuilder` from `self: &mut Parser`
and stores `std::ptr::from_mut(self)` so the builder, the `ScalarResolverCtx`,
and any temporaries all share **one** raw pointer with identical provenance.
The macro at `yaml.rs:3847-3851` enforces "re-derive on every access, never
hold two live `&mut`":

```rust
macro_rules! parser { () => { unsafe { &mut *parser } }; }
```

`input` (line 917) returns `&'a [Enc::Unit]` decoupled from `&self`, so it
can be hoisted above a `match &mut self.str` without tripping borrowck.
`pos` is `Pos(usize)` and `input[pos.cast()]` is bounds-checked.

**Verdict:** T3 — extensively documented zig-port single-provenance
pattern. The unsafe-fn marker on `string_builder_raw` (line 5673) propagates
the invariant to callers (only `scan_plain_scalar` calls it).

---

### 3.9 T3 — YAML `from_raw_parts::<u16>` for `Utf16` encoding (`yaml.rs:1782`)

```rust
EncodingKind::Utf16 => {
    // SAFETY: `Enc::Unit == u16` when `KIND == Utf16`;
    // reinterpret with the same element count for E::String::init_utf16
    let s16 = unsafe {
        core::slice::from_raw_parts(s.as_ptr().cast::<u16>(), s.len())
    };
    E::String::init_utf16(s16)
}
```

This is a *real* `Utf16` arm (unlike the JSON one — YAML supports UTF-16
input). The encoding type is a `const`-generic `Enc: Encoding` parameter
where `Enc::KIND == EncodingKind::Utf16` implies `Enc::Unit == u16`. So
`s.as_ptr(): *const u16` already, the `.cast::<u16>()` is a no-op cast,
and `s.len()` is already the u16-element count. The unsafe call is
literally `from_raw_parts(s.as_ptr(), s.len())` with a tautological cast.

This could be expressed as `bytemuck::cast_slice` if `Enc::Unit: NoUninit + AnyBitPattern`,
or rewritten as a trait method returning `&[u16]` directly when
`KIND == Utf16`. **Recommend**: replace with safe-Rust via a trait method
`Enc::as_utf16_slice(s: &[Enc::Unit]) -> Option<&[u16]>`. Low priority;
the current expression is provably correct.

**Verdict:** T3 — tautological cast, sound but expressible without unsafe.

---

### 3.10 T3 — `bun_dotenv` lifetime extension for proxy URL (`env_loader.rs:359`)

```rust
let extend = |s: &[u8]| -> &'a [u8] {
    unsafe { core::slice::from_raw_parts(s.as_ptr(), s.len()) }
};
```

In `Loader::get_http_proxy`, returned `URL<'a>` borrows env-var bytes
that the closure widens from the closure-inferred lifetime to `'a` (the
`Loader<'a>` borrow of `map: &'a mut Map`). The values are `Box<[u8]>`
inside `HashTable` buckets; bucket payloads are address-stable across
rehashes (the boxes themselves are moved by the table, but the heap they
point to is fixed). Bun does not overwrite or remove the proxy env vars
after first read, so the slice is valid for `'a`.

**Verdict:** T3 — well-documented, matches Zig contract. Phase B could
restructure `Map::get` to return `&'a [u8]` directly instead of going
through a closure-inferred lifetime, removing the need for `extend`.

---

### 3.11 T3 — `bun_dotenv` libc environ ingest (`env_loader.rs:632`)

```rust
let env = unsafe { bun_core::ffi::cstr(_env) }.to_bytes();
```

`bun_sys::environ()` returns `&[*const c_char]`; libc guarantees each
entry is NUL-terminated. `cstr` constructs a `CStr` via
`CStr::from_ptr(_env)`. Trusted-source OS data; not attacker-controlled at
this layer (the attacker would have to control `execve` args, which is a
different threat model).

**Verdict:** T3 — OS invariant.

---

### 3.12 T3 — `bun_ini` raw pointers into AST tree (`ini/lib.rs:535,1083,1090,1097,1545,1851`)

Mirrors the TOML/JSON pattern (§3.4 / §3.5): `head: *mut E::Object` and
`rope: *mut Rope` carry the active position in the parser's growing AST,
because the Zig source held `*E.Object` / `*Rope` in the same shape. Each
unsafe deref is preceded by a null check or by construction-time
guarantee (e.g. line 1097 derefs `head` which was just `std::ptr::from_mut(rope_head)`).

Line 1851 (`unsafe { &mut *s.as_ptr() }`) is the `E::EString` interior-mutable
cache mutation; `s.as_ptr()` returns `NonNull<EString>` from the AST Store,
and `slice(bump)` mutates only the resolved-data cache field. This is a
standard Bun-AST pattern shared by `bun_install::pnpm.rs`,
`bun_install::package_json.rs`, etc.

**Verdict:** T3.

---

### 3.13 T3 — `bun_bunfig` process-global `*mut Log` access
(`bunfig/arguments.rs:73,75,78,127,146`, `bunfig/bunfig.rs:1120`)

```rust
let log_ptr: *mut bun_ast::Log = ctx.log;
let log: &mut bun_ast::Log = unsafe { &mut *log_ptr };
```

`ctx.log` is the process-global `Log` written once during single-threaded
CLI startup. The pattern of "copy raw pointer out, deref later" is a
borrow-stacking workaround so the `&mut Log` does not borrow `ctx`
(`Parser::parse` needs `&mut ctx` alongside `&mut log`). Likewise
`(*graph).flags` in `load_config` (line 146): `StandaloneModuleGraph::get()`
returns a non-null process-global pointer when `Some`.

**Verdict:** T3 — process-singleton invariant on a single-threaded path.

---

## 4. T4 sites (port-only, no remediation needed)

The following sites are mechanical zig-port patterns with no soundness
concern and are flagged for completeness:

| file:line | pattern | note |
|---|---|---|
| `parsers/json_lexer.rs:210` | `unsafe { &mut *self.log }` | trait-impl forward; same as 333 |
| `parsers/toml.rs:51,59,74,105,114,127` | `unsafe { &*rope.next }` | null-checked rope walk |
| `parsers/toml.rs:188,220` | `unsafe { (*node).next = ... }` | dead-code pool freelist |
| `parsers/toml.rs:368,374,468,598,610,645,661` | AST-pointer aliasing | borrowck workaround |
| `parsers/yaml.rs:904,908,917,1198,1230,1344,3849` | StringBuilder backref deref | single-provenance |
| `parsers/yaml.rs:5673` | `unsafe fn string_builder_raw` | propagates invariant |
| `bunfig/arguments.rs:73,75,78,127,146` | `*mut Log` / `*mut StandaloneGraph` | process singleton |
| `bunfig/bunfig.rs:1120` | `*mut Log` | same |
| `ini/lib.rs:535,1083,1090,1097,1545` | rope / head AST pointer | borrowck workaround |
| `ini/lib.rs:1851` | `EString::as_ptr()` deref | AST store interior mut |

---

## 5. NEGATIVE FINDINGS (what was *not* found)

These are the parser-specific hazards the audit was hunting for. Each is
explicitly enumerated as **not present**:

### 5.1 No `slice::from_raw_parts(buf.as_ptr().add(off), len)` with attacker-controlled `off + len`

Searched: `from_raw_parts`, `get_unchecked`, `add(`, `byte_add`, `offset(`
across all parser files. The three `from_raw_parts` sites that exist
(json_lexer:575, yaml:1783, dotenv:359) are:

- json_lexer:575 — unreachable (dead Utf16 arm); see §3.7.
- yaml:1783 — tautological `*const u16 -> *const u16` cast with `s.len()`
  unchanged; the underlying slice was already a `&[u16]`.
- dotenv:359 — `from_raw_parts(s.as_ptr(), s.len())` to launder closure
  lifetime to `'a`; no offset arithmetic.

**No site computes `ptr.add(N)` from a tokenizer offset and crosses into
unsafe.** All tokenizers (`toml/lexer.rs`, `json5.rs`, `yaml.rs`'s scanner,
`json_lexer.rs`'s `step()`, `dotenv`'s `parse_*`) use bounds-checked
`self.src[i]` / `&self.src[start..end]` indexing exclusively.

### 5.2 No `bun_core::strings::intern` (or similar) with attacker-controlled keys

`bun_wyhash::hash` is used by `bun_collections::HashTable` for key hashing,
but the hash output never feeds back into pointer arithmetic in
attacker-reachable paths. Keys are stored as `Box<[u8]>` (dotenv) or as
arena-allocated bytes (ini, parsers). There is no Bun-side "intern this
attacker string into a shared pool" call in any of the parsers; the closest
analogue is the `E::EString` resolved-data cache (`ini/lib.rs:1851`), which
caches the parsed string per-AST-node and is single-threaded.

WebKit's `AtomString` is *not* used by these parsers — strings flow through
`bun_core::String::clone_utf8` at the JS boundary, which produces a plain
`WTFStringImpl` (atomic refcount, not interned).

### 5.3 No integer overflow in section-name / key length (u32 vs usize)

Section / key / value lengths in the .env, .ini, TOML, JSON, JSON5 parsers
are tracked as `usize`. The only `as u32` casts in scanning paths are:

- `toml/lexer.rs:153`: `self.line_number += (cp == '\n') as u32` — bool to u32.
- `toml/lexer.rs:1030,1043,1086,1123`: `c3 as u32` where `c3 == hex digit`,
  always in `[0, 'f']`.
- `yaml.rs:879,5689`: `*b as u32` where `b: u8` — widening, never narrowing.

The one `i32::try_from(usize)` in `Pos::loc()` (`yaml.rs:327`) uses
`.expect("int cast")` — would panic, not silently truncate. Safe under
the attacker-controls-input model (a >2 GiB YAML file causes a controlled
panic in the host fn, caught by Rust's panic = abort and propagated as a
JS exception).

### 5.4 No allocator misuse with arenas

`bun_alloc::MimallocArena` (= `Bump`) is used as the parser's per-parse
arena. The arena-gotcha noted in `src/CLAUDE.md` (Drop doesn't run on
arena reset) is not violated by any of these parsers — every `Expr`
value in the arena is plain data (no `Box`, no fd, no refcount). The TOML
parser's `HashMapPool` (§3.3) uses a separate `heap::into_raw(Box::new(...))`
allocator, *not* the arena, precisely because its `HashMap` does own heap
storage — recommended for deletion as dead code regardless.

### 5.5 No quoting / escape-handling unsafe

The escape decoders — `dotenv::Parser::parse_quoted` (line 1096), TOML
lexer escape handling (lines 1015-1200 in `toml/lexer.rs`), JSON5 escape
decoding, YAML's `string_builder.append_*` — all operate in safe Rust.
Backslash, embedded newlines in quoted strings, `\uXXXX` (in JSON / JSON5
/ TOML), `\u{XXXXXX}` (JSON5), and YAML's `\xXX` / `\uXXXX` / `\UXXXXXXXX`
are all decoded in safe Rust. `strings::encode_wtf8_rune` at
`toml/lexer.rs:1182` is itself a safe-Rust function in `bun_core::strings`.

### 5.6 No YAML alias-cycle hazard

`Parser::anchors` (`yaml.rs:2309`) maps anchor name → already-resolved
`Expr`. Anchor resolution at `yaml.rs:3461` is a HashMap `.get().clone()` —
no recursion, no expansion-time dereference. The classical YAML
"billion laughs" / alias-cycle DoS does not apply because aliases resolve
to AST nodes, not to source text fragments that get re-parsed.

Recursive descent into nested mappings / sequences IS guarded by
`bun_core::StackCheck` (line 2316 / 2338); deep nesting raises a controlled
`ParseError::StackOverflow` via `stack_check.is_safe_to_recurse()`.

### 5.7 No TOML datetime out-of-range hazard

TOML dates parse through safe-Rust paths in `toml/lexer.rs`; the lexer
produces a string literal for the source range and leaves date semantics
to the consumer. Out-of-range dates do not enter unsafe code.

### 5.8 No `unsafe impl Send/Sync` on parser types

None of `TOML`, `YAML::Parser`, `JSON5Parser`, `ini::Parser`,
`dotenv::Parser`, `Bunfig` has an `unsafe impl Send` / `Sync`. All parsing
is single-threaded per parse.

---

## 6. Summary table

| crate | sites | T1 | T2 | T3 | T4 |
|---|---:|---:|---:|---:|---:|
| `bun_dotenv` | 2 | 0 | 0 | 2 | 0 |
| `bun_ini` | 8 | 0 | 1 | 7 | 0 |
| `bun_parsers` (json/json5/toml/yaml) | 28 | 0 | 0 | 16 | 12 |
| `bun_bunfig` | 6 | 0 | 0 | 6 | 0 |
| **total** | **44** | **0** | **1** | **31** | **12** |

The "T3" / "T4" split is judgement-call: T3 = unsafe is justified but the
invariant is non-obvious and worth documenting / preserving; T4 =
mechanical zig-port idiom with a one-line SAFETY comment that fully
characterises the contract.

---

## 7. Recommendations (Phase B)

1. **`bun_ini::load_npmrc`** (§3.1): Restructure `Parser` so the arena is
   external. This removes the only T2 and also removes both `'static`
   casts. **Highest-value cleanup** in the surveyed crates.

2. **`bun_parsers::toml::hash_map_pool`** (§3.3): Delete entirely; it is
   dead code from the Zig port (Zig source has the module commented out)
   and is unreachable from the live TOML parser.

3. **`bun_parsers::json_lexer::to_e_string` Utf16 arm** (§3.7): Replace
   the unsafe `from_raw_parts` body with `unreachable!("…")`. Defensive
   code rot mitigation; the JSON lexer never sets `Utf16`.

4. **`bun_parsers::yaml::to_string` Utf16 arm** (§3.9): Replace tautological
   `cast::<u16>()` with a trait-method `Enc::as_utf16_slice(s)`. Removes a
   real (but currently sound) `from_raw_parts` from a JS-attacker-reachable
   path.

5. **`bun_dotenv::get_http_proxy::extend`** (§3.10): Restructure
   `Map::get` to return `&'a [u8]`, removing the lifetime-launder
   closure.

6. **All AST-pointer-aliasing sites in TOML / INI** (§3.4 / §3.12):
   Long-term, evolve `bun_ast::Expr` Store to expose a
   `with_mut<F>(&self, F)` shape that gives safe `&mut E::Object` while
   preserving stable pointers. This is a cross-cutting refactor; not
   parser-specific.

7. **Belt-and-braces `debug_assert!(text.is_ascii())`** (§3.6): One-line
   add in the two JSON-numeric `from_utf8_unchecked` sites.

---

## 8. Methodology notes & limits

- **Inventory source:** `.unsafe-audit/unsafe-inventory.jsonl`
  (11044 sites total). Filtered to `crate ∈ {bun_dotenv, bun_ini,
  bun_parsers, bun_bunfig}`.
- **Inventory completeness check:** Raw `grep -c unsafe` on `yaml.rs`
  reports 9 matches; inventory reports 7. The two-line delta is two
  macro-internal `unsafe { &mut *parser }` expressions at lines 1344 and
  3849; the inventory's AST counter de-dupes per macro definition. Both
  are analysed in §3.8.
- **Lexer hand-audit:** `toml/lexer.rs` (51 KB), `json5.rs` (39 KB) read
  end-to-end at the API surface (step/peek/parse). Confirmed both have
  **zero unsafe blocks**.
- **JS exposure trace:** `runtime/api/{YAMLObject,TOMLObject,JSON5Object,JSONCObject}.rs`
  read at parse entry points. YAML / TOML / JSON5 / JSONC are all
  JS-exposed via `Bun.YAML.parse(...)` etc. — these are the highest
  attacker priority surfaces.
- **What this audit does not cover:** the JS-side glue functions that
  marshal `Bun.X.parse(jsString)` → `Source` → parser. Those are part of
  `bun_runtime` and were covered in PASS3 (`PASS3-bun-runtime-deep-dive` /
  `PASS3-bun-jsc-deep-dive`).
- **Confidence:** high. The parser surface is small (4 crates, 44 unsafe
  sites total) and every site has a stated invariant. The T2 in
  `load_npmrc` is the only place where the stated invariant does not
  match Rust's borrow rules — and even there, the runtime UB is suppressed
  by mimalloc's interior-mutability shape.

---

## 9. Disposition

- **T1 count: 0**
- **T2 count: 1** (`ini/lib.rs:1360` — `&parser.arena` reborrowed alongside
  `parser.parse(&mut self)`; Stacked-Borrows violation, not runtime UB).
- **Action items:** 7 Phase-B follow-ups itemised in §7.

This is a strong-positive audit. The fact that the tokenizers themselves
(`toml/lexer.rs`, `json5.rs`, and the YAML scanner driver) host **zero
unsafe blocks** is the headline — every byte-level scan is safe Rust.
What unsafe exists is concentrated at AST-builder pointer-aliasing and
process-global log handles, none of which trust attacker input for
soundness.

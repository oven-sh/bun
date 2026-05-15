# PASS 4 — `bun_css` and `bun_js_parser` Deep Dive

**Auditor:** Pass-4 agent (Opus-4.7-1M)
**Date:** 2026-05-15
**Scope:** Two Rust-port language-parser crates ported from Zig:

| Crate | Path | Source-level `unsafe` markers (grep, comment-stripped) |
| --- | --- | --- |
| `bun_css` | `src/css/` | **125** (inventory under-reports as 116 — verified by direct grep) |
| `bun_js_parser` | `src/js_parser/` | **56** (inventory under-reports as 49 — verified by direct grep) |

Inventory file checked: `.unsafe-audit/unsafe-inventory.jsonl`. The shipped JSONL omits a handful of sites in `lexer.rs`, `parser.rs`, and `lib.rs` (e.g. `lexer.rs:494`, `lexer.rs:1198`, `parser.rs:1163`); a more reliable enumeration is `grep -rn '\bunsafe\b' --include='*.rs'`. Both crates have been re-walked file-by-file for this audit.

**Prior pass coverage avoided:**

- `PropertyIdTag` `transmute` cluster (C-002, Pass-1/2). Not re-listed.
- bundler/printer-side CSS sites (`bun_bundler::linker_context::generateCompileResultForCssChunk`, `prepareCssAstsForChunk`, `findImportedFilesInCSSOrder`). Pass 3 covered those.
- `bun_collections::detach_lifetime` and `bun_ptr::detach_lifetime_{ref,mut}` themselves (audited in Pass 2 / Pass 3 as the centralised lifetime-erasure primitives). This pass audits *callers* of those primitives within the two parsers.

**Headline:** **Zero T1 (UB) findings.** Both parser surfaces are unusually clean for a Zig→Rust port of this size. Every `unsafe` block sits behind one of a small number of well-documented invariants — arena-lifetime erasure, `&raw const` field reads of arena-backed `Vec<_, AstAlloc>`, raw-pointer aliasing for log/import_records around a callback re-entry hazard, and `ptr::read`-then-`forget` POD compaction. I sampled and read 25+ lines of context around ~75 sites (well over the requested 40-60 minimum), looked end-to-end at the lexer, the token-construction hot path, the AST-construction sites, the parse-entry init, the visitor compaction loops, and the CSS at-rule/import-record handlers. No live UB or memory-safety bug surfaced.

The findings below are all **T2 (missing contracts / over-strong types)** or **T3 (latent-shape watchlist)**.

---

## 1. Attack-surface model

### 1.1 `bun_js_parser`

- **Reachable from any of:** `bun run`, `bun build`, `bun test`, `Bun.build`, `Bun.spawn`, `import()` in user code, the bundler's parse step, the macro engine.
- **Input language:** JavaScript / TypeScript / TSX / JSX / JSON / CommonJS / `.env` (JSON-with-relaxations) / `Bun.macro` macro bodies. Source bytes come from disk or HTTP fetches and are not sanitised.
- **Source-position type:** `bun_ast::Loc { start: i32 }`, `bun_ast::Range { loc, len: i32 }`. The lexer carries `current: usize`, `start: usize`, `end: usize`. Conversion to `i32` is via `usize2loc` (`src/ast/lib.rs:2609`) and `i32::try_from(...).expect("int cast")` peppered throughout the lexer (~30 sites). **Files bigger than `i32::MAX = 2^31 - 1 ≈ 2.1 GB` panic, not UB.** That is a documented DoS-via-panic surface but not in scope here.
- **Stack-depth protection:** `p.stack_check.is_safe_to_recurse()` is consulted at every recursive parse entry point (`parse_expr`, `parse_stmt`, `parse_prefix`, `parse_typescript`, `parse_property`). Template-literal `${…}` re-entry, generic-bracket lookahead, nested object/array patterns — all go through the stack check (`parse/parse_stmt.rs:1834`, `parse/mod.rs:86`, etc.). Returns a "StackOverflow" `bun_core::Error` rather than unwinding. **Sound; not a UB surface.**

### 1.2 `bun_css`

- **Reachable from:** `Bun.build` (CSS bundler), `bun build`, `@import url(...)` chains from user CSS, the html-rewrite pipeline, css-modules in dev server.
- **Input language:** CSS Level 3+ with vendor prefixes, custom properties, `@-rules`, selectors, modules.
- **Source-position type:** `Tokenizer.current_line_start_position: usize` (with intentional `wrapping_sub` / `wrapping_add` to track UTF-16 column units), `Tokenizer.position: usize`. Errors carry `SourceLocation { line: u32, column: u32 }`. `i32` conversion happens at the `bun_ast::Range` boundary via `i32::try_from(...).expect("int cast")` (~10 sites). Same panic-not-UB story as the JS lexer.
- **Lifetime model:** The parser feeds back arena-owned `&'static [u8]` placeholders through `Token::Ident`, `Token::QuotedString`, `Token::Function`, etc. These are **NOT actually `'static`** — they borrow `Tokenizer.src: &'a [u8]` or `Tokenizer.arena: &'a Bump`. The crate-wide convention is that callers never hold these slices past the arena's lifetime; the `&'static` is a Phase-A placeholder pending `'bump` re-threading (TODO at `css_parser.rs:4509-4519`, repeated at every site).
- **No stack-depth check.** The selector parser, the value parser, and the at-rule parser all recurse on user input. A pathological CSS file (deeply nested `:is(:is(:is(:is(...))))` or `calc(((((... 1)))))` ) can cause native stack overflow. This is a **DoS-via-stack-overflow** surface but not a memory-safety bug (Rust's stack guard pages turn it into a SIGSEGV, not UB). Out of scope for this pass.

---

## 2. Per-area analysis

### 2.1 JS lexer (`src/js_parser/lexer.rs`, ~155 KB, 3 unsafe sites in source)

#### 2.1.1 `lexer.rs:447` — `unsafe { self.log.as_mut() }`

```rust
fn log_mut(&mut self) -> &mut Log {
    unsafe { self.log.as_mut() }
}
```

`self.log: NonNull<Log>` aliases the `&'a mut Log` passed at construction. **Soundness:** the `log()` accessor at `lexer.rs:490-495` exists for the same reason and documents the contract: only one `&mut Log` may be live at a time. Call sites that pass `self.log()` alongside sibling `&self.*` arguments are linearised by always calling `.log()` first into a binding, never holding two results live simultaneously. The accessor body is `&mut *self.log.as_ptr()`, which is identical to `NonNull::as_mut`. **Sound** under the documented contract.

#### 2.1.2 `lexer.rs:494` — `unsafe { &mut *self.log.as_ptr() }` (the `log()` accessor)

Same site as above, behind the `mut_from_ref` accessor. Identical analysis.

#### 2.1.3 `lexer.rs:1198` — `unsafe { *contents.get_unchecked(self.current) }`

```rust
#[inline(always)]
fn next_codepoint_with(&mut self, contents: &[u8]) -> CodePoint {
    let len = contents.len();
    if self.current >= len {
        self.end = len;
        return -1;
    }
    // SAFETY: `self.current < len` was checked immediately above.
    let first = unsafe { *contents.get_unchecked(self.current) };
    ...
```

Bounds check is on the immediately-preceding line, no intervening mutation, and `contents: &[u8]` is the function parameter (no aliasing concern). **Sound.** This is the hot path of `step()`; the `unsafe` here is a measured PERF choice and is the only place in the JS lexer that bypasses bounds-checked indexing.

#### 2.1.4 Lexer-internal escape parsing (`decode_escape_sequences`, ~280 LOC)

Audited the unicode `\u{...}` variable-length path (lexer.rs:824-928). The hex accumulator uses `i64` and increments via `value * 16 | d as i64`. With ≥16 hex `F` digits, `value * 16` overflows `i64`. In debug builds this **panics** (overflow-checks). In release builds, signed-multiply wraps (well-defined in Rust). The `is_out_of_range` flag is set on the first overflow past `1_114_111` and never reset, so the user-facing error path is correct. **Sound in release; panic-on-DoS in debug.** No T1.

Adversarial input (debug-build DoS only):

```js
"\u{FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF}"
```

#### 2.1.5 Template-literal rescan (`rescan_close_brace_as_template_token`, lexer.rs:3440-3454)

```rust
self.code_point = 0x60;
self.current = self.end;
self.end -= 1;
self.next()?;
```

`self.end -= 1` would underflow if `self.end == 0`. The function precondition is `self.token == T::TCloseBrace`, which means a `}` was just lexed, so `self.end > 0` in every reachable lexer state. The underflow is not enforced by the type system; it is enforced by the lexer state machine. **T3 watchlist** — adding a `debug_assert!(self.end > 0)` would document the invariant.

#### 2.1.6 `cast_slice::<u8, u16>` on `string_literal_raw_content` (lexer.rs:2751)

```rust
let utf16: &[u16] = bytemuck::cast_slice::<u8, u16>(self.string_literal_raw_content);
```

`bytemuck::cast_slice` is a *safe* function — it panics on misalignment or length-mismatch rather than UB-ing. The reverse-direction site at `lexer.rs:3135` writes `cast_slice::<u16, u8>(dup)` where `dup: &[u16]` came from `arena.alloc_slice_copy(&tmp)` with `tmp: Vec<u16>`. The arena allocator preserves `align_of::<u16>() == 2`, so the round-trip back to `&[u16]` is alignment-correct. Length is also preserved (the byte-slice has even length). **Sound.**

---

### 2.2 JS parser core (`src/js_parser/p.rs`, ~424 KB, 14 unsafe sites)

#### 2.2.1 `Binding2Expr` trampoline (`p.rs:3046`, `p.rs:3052`)

```rust
self.to_expr_wrapper_namespace =
    bun_ast::binding::ToExprWrapper::new(self.arena, |ctx, loc, ref_| {
        // SAFETY: `ctx` was derived from the caller's live `&mut P`
        // immediately before `Binding::to_expr`; no other `&mut P`
        // borrow is active for the duration of this call.
        let p = unsafe { &mut *ctx.cast::<P<'a, TYPESCRIPT, SCAN_ONLY>>() };
        p.wrap_identifier_namespace(loc, ref_)
    });
```

The `*mut c_void` `ctx` is supplied per-call from the caller's live `&mut P` (e.g. `visit_stmt.rs:1218`: `core::ptr::addr_of_mut!(*p).cast::<c_void>()`). The closure is non-capturing, so it monomorphises to a static `fn` pointer that **bakes in** the surrounding `impl P<'a, TYPESCRIPT, SCAN_ONLY>` const-generic values. Each `P` instantiation has its own `to_expr_wrapper_*` field, so the cast back to `P<'a, TYPESCRIPT, SCAN_ONLY>` *must* recover the same monomorphisation that registered the wrapper.

**Audit conclusion:** the wrapper is stored on `P` itself (`p.rs:546-547`) and is read back via `p.to_expr_wrapper_namespace` at the call site, so the registration site's `P<TS, SCAN_ONLY>` and the use site's `P<TS, SCAN_ONLY>` are necessarily identical. The `*mut P` provenance is fresh per call (no long-lived raw pointer storage), so Stacked-Borrows is not invalidated by intervening `&mut self` retags. **Sound.**

A subtle T3: if a future refactor were to move the wrapper onto a parent struct shared across multiple `P` monomorphisations (e.g. a "context" object), the cast would silently mis-type. Worth annotating with a `PhantomData<P<'a, TYPESCRIPT, SCAN_ONLY>>` on `ToExprWrapper` to prevent that drift.

#### 2.2.2 `ptr::read` from `&` references (POD compaction)

Across `p.rs`, `visit/mod.rs`, `lower/lower_decorators.rs`, `lower/lower_esm_exports_hmr.rs`, `scan/scan_imports.rs`, the parser uses `core::ptr::read(&raw const x)` to duplicate non-`Copy` AST nodes (most often `G::Property`, `G::Fn`, `Vec<Expr, AstAlloc>`). The invariant that makes this sound is:

1. The underlying buffer lives in a `bun_alloc` arena (`AstAlloc`, `bumpalo`, `MimallocArena`).
2. The element types either are `Copy`-shape or own only arena-backed storage.
3. `AstAlloc::deallocate` (`bun_alloc/ast_alloc.rs:311-317`) is a documented unconditional **no-op**.

Property (3) is the load-bearing one: it means that even if a `Vec<Expr, AstAlloc>` is duplicated and both copies `Drop`, the second `Drop` does nothing harmful. The arena reclaims the underlying bytes wholesale on `MimallocArena::reset()`.

I traced this for `lower_decorators::class_copy` (line 121), `prop_copy` (line 92), `prop_full_copy` (line 102, 112), `visit/mod.rs:1097` (`class_body.push(ptr::read(old_props.as_ptr().add(i)))`), `visit/mod.rs:1404` (`G::Fn` duplicate), `visit/mod.rs:1721` (`Decl` duplicate where `Decl: Copy` so even more trivially sound), `p.rs:4220` (`ClauseItem` non-Copy POD), `p.rs:8434` / `8506` / `8529` (the `ImportScanner::scan` parts-array compaction, with paired `ptr::write`/`forget`/`set_len`), `p.rs:9448` (export-clause items merge), and `scan_imports.rs:245` (clause-item compaction). Each site is paired with either:

- a downstream `core::mem::forget` (so neither copy is dropped through normal Vec deinit semantics), **or**
- a `ptr::write` into the same slot followed by `set_len` (so the source slot is overwritten before the next iteration), **or**
- a same-iteration `continue` that discards the source `stmt` (the `before` Vec is later `.clear()`-ed, but `Stmt: Copy` so no per-element Drop runs).

**All sound under the documented invariants.** Centralising this pattern into a `bun_ast::arena_dup<T>(x: &T) -> T` named helper would shrink the `unsafe` surface but is a cleanup, not a fix.

#### 2.2.3 `p.rs:5106` — `unsafe { path.into_static() }`

```rust
let path: fs::Path<'static> = unsafe { path.into_static() };
```

Phase-A placeholder — `ImportRecord.path` is typed `Path<'static>` until the bundler grows a `'bump` parameter. Documented at `paths/lib.rs:865-895`. The `Path` contains `&'static [u8]` fields all of which actually borrow the parser arena. Sound under the existing convention that `ImportRecord`s are consumed before the arena is freed. **T2** — the type signature is over-strong; if a future caller persists `ImportRecord`s in a cache that survives parser drop, UAF.

#### 2.2.4 `p.rs:6709` — `bun_collections::detach_lifetime(original_name)`

Routine arena slice detach to satisfy `'a` lifetime on `handle_identifier`. Documented. **Sound.**

#### 2.2.5 `p.rs:3693`, `p.rs:4917` — `put_borrowed` / `get_or_put_borrowed`

The `unsafe fn put_borrowed(key: &[u8], value: V)` API at `collections/array_hash_map.rs:1891` stores the key by reference without copying. Caller invariant: key must live as long as the entry. Both call sites are inside `P` and the key (`name: &'a [u8]`) borrows source text or the lexer string-table — both of which outlive every arena-backed `Scope`. **Sound under documented contract.**

#### 2.2.6 `p.rs:753`, `p.rs:770`, `parser.rs:382`, `parser.rs:2432`

Identical pattern to the lexer's `log()` accessor — raw-pointer-stored handles to mutable resources (`Log`, `RuntimeTranspilerCache`, `HookContext`) with documented "one live mutable borrow at a time" call-site discipline. **Sound.**

---

### 2.3 JS parse entry / init (`src/js_parser/parse/parse_entry.rs`, 5 unsafe sites)

#### 2.3.1 `init_p!` macro (`parse_entry.rs:52-62`)

```rust
macro_rules! init_p {
    ($ty:ty; $($arg:expr),* $(,)?) => {{
        let mut __slot = MaybeUninit::<$ty>::uninit();
        <$ty>::init(&mut __slot, $($arg),*)?;
        scopeguard::guard(__slot, |mut s| unsafe { s.assume_init_drop() })
    }};
}
```

`P::init(&mut MaybeUninit<P>, ...)` writes a fully-initialised `P` on `Ok(())`. The `?` short-circuit returns *before* the guard is armed, so on error the `MaybeUninit` is dropped uninitialised — sound (no `assume_init_drop`). On success, the guard owns the slot and drops it correctly. **Sound.**

Four call sites at `parse_entry.rs:427`, `:573`, `:669`, `:769` deref the slot via `__p.assume_init_mut()`. All gated by `init_p!`'s `Ok`-only contract. **Sound.**

#### 2.3.2 `parse_entry.rs:1430`, `:1615` — `Vec::from_bump_slice(p.import_records.items_mut())`

```rust
unsafe fn from_bump_slice(items: &mut [T]) -> Self {
    let mut v = Vec::with_capacity_in(items.len(), A::default());
    unsafe {
        core::ptr::copy_nonoverlapping(items.as_ptr(), v.as_mut_ptr(), items.len());
        v.set_len(items.len());
    }
    v
}
```

**Investigated as a potential T1.** `from_bump_slice` does a bitwise-copy without clearing the source. If `T: Drop` and the source `&mut [T]` is later iterated/dropped, double-drop. The source comes from `p.import_records.items_mut()`, where `ImportRecordList` is:

```rust
pub enum ImportRecordList<'a> {
    Owned(BumpVec<'a, ImportRecord>),
    Borrowed(&'a mut Vec<ImportRecord>),
}
```

The `Borrowed` arm wraps a global-heap `Vec<ImportRecord>` — if that's the active variant, `Drop` on the duplicate Vec **would** double-drop element bytes if `ImportRecord: Drop`. Verified at `bun_ast::import_record::ImportRecord` (`src/ast/import_record.rs:16-44`) that **`ImportRecord` has no Drop**: every field is `Range` / `Path<'static>` (Phase-A `&'static [u8]`s) / `ImportKind` / `Tag` / `Option<Loader>` (no inner Drop) / `Index` / `u32` / `&'static [u8]` / `Flags`. No `Vec` / `Box` / `String` / file descriptor. **Therefore the duplicate Vec's `Drop` is a no-op element-wise.**

Resolution: **sound today**, but the contract on `from_bump_slice` is over-strong — it accepts `&mut [T]` for *any* `T`, while only being sound for `T: Pod` (no Drop) **or** truly bump-arena-allocated `T`. **T2** — the type signature should be split into two: `from_bump_slice_pod<T: NoDrop>` and `from_bump_slice_arena<T>` (with the arena-only contract spelled out). Tagging in `bun_collections::vec_ext` would prevent a future addition of a Drop-bearing field to `ImportRecord` (or any other type that flows through this helper) from silently turning into double-drop UB.

---

### 2.4 JS visit pass (`src/js_parser/visit/mod.rs` ≈ 90 KB, 6 unsafe sites)

All six fall under §2.2.2 (POD compaction via `ptr::read`/`copy_nonoverlapping`/`forget` paired with `set_len`). Walked through `visit_decls` (lines 240-438), `visit_binding_and_expr_for_macro` (lines 440-490), the `ts_metadata`/`ts_decorators` reads (lines 1096-1099, 1404), and the local-merge `ptr::read(d)` for `Decl: Copy` (line 1721). The Decl site is **redundant unsafe** (could be `*d`) but not unsound.

---

### 2.5 JS lower pass (`lower_decorators.rs`, `lower_esm_exports_hmr.rs`)

Eight unsafe sites total. All `ptr::read(&raw const x)` of arena-backed `Vec`s (`ts_decorators`, `ts_metadata`, `st.value`) or `copy_nonoverlapping` between arena slices (`lower_esm_exports_hmr.rs:505-516`, concatenation of `ClauseItem` lists). The `Vec` duplications are bounded by `AstAlloc::deallocate` being a no-op and the element types having no Drop. **All sound.**

---

### 2.6 JS scan pass (`scan/scan_imports.rs`, 2 unsafe sites)

`scan_imports.rs:87` — `unsafe { &mut *record }` where `record: *mut ImportRecord` was just taken from `&raw mut p.import_records.items_mut()[i]`. The macro is invoked inside a single match arm with no intervening allocation that could grow `p.import_records`. The SAFETY comment correctly identifies the aliasing-with-`p.*`-borrows hazard and the no-realloc invariant. **Sound.**

`scan_imports.rs:245` — `ClauseItem` compaction; same as §2.2.2.

---

### 2.7 JS `lib.rs` FFI shim (`js_parser/lib.rs:106-140`)

The macro-context extern block uses Rust 2024's `unsafe extern` to mark each declaration. Three of the four are `unsafe fn` (require call-site `unsafe { ... }`), one is `safe fn` (`__bun_macro_context_call`) because all arguments are Rust-ABI safe types. Each `unsafe fn` is documented with a caller-precondition list:

- `__bun_macro_context_init`: `transpiler` must be a live, exclusive `&mut Transpiler<'_>`. Callsite at `lib.rs:179` originates from `&mut T` (where T = bundler's Transpiler). The dep-cycle dodge through `c_void` is the reason this is `unsafe`. **Sound under documented contract.**
- `__bun_macro_context_deinit`: `data` must be the exact `Box::into_raw` from init. Callsite at `lib.rs:191` consumes `self` by value, so the unique-owner invariant is enforced statically modulo the contract. **Sound.**
- `__bun_macro_context_get_remap`: returns `Option<&'static MacroRemapEntry>` — the `'static` is **not** truly `'static`; it's borrowed from `Transpiler.options` which is process-lifetime in the common case (`vm.transpiler`) but is short-lived in the off-thread `RuntimeTranspilerStore` worker. The `pub fn deinit(self)` exists exactly to clean up the latter. **T2** — the over-strong `'static` is documented in the SAFETY comment but the type system doesn't enforce that the returned reference is dropped before `deinit` is called.

---

### 2.8 CSS tokenizer (`src/css/css_parser.rs` ≈ 256 KB)

Audited the position/column tracking arithmetic (`current_line_start_position` with `wrapping_sub`/`wrapping_add` for 4-byte UTF-8 leads and continuation bytes). The wrapping is intentional and matches Servo's cssparser behaviour: a 4-byte UTF-8 sequence is 2 UTF-16 code units, so the line-start position is decremented to compensate. **Intermediate states** during a 4-byte sequence consume can have `current_line_start_position` underflow to ~`usize::MAX`; `source_location()` is only called at token boundaries where the position has been restored. The arithmetic happens only inside `consume_4byte_intro` / `consume_continuation_byte` / `consume_known_byte` / `consume_char`, never with a borrow alive that could trigger UB.

Lookahead and bounds: `byte_at(n)` panics on OOB; every caller pairs with `has_at_least(n)` (verified for the `+`/`-`/`.`/`*` arms in `next_token`, lines 4657-4697). **Sound.**

`Tokenizer::slice_from(start)` returns `&self.src[start..self.position]`. Requires `start <= position`. Used to fabricate `Token::Ident`, `Token::QuotedString`, etc. slices. `start` is always a position captured *before* a sequence of `advance` / `consume_known_byte` calls; the lexer never rewinds the position, so the invariant holds. **Sound.**

#### 2.8.1 `css_parser.rs:2692` — `&mut *(&raw mut references)`

```rust
let references_mut: &mut CssModuleReferences<'_> =
    unsafe { &mut *(&raw mut references) };
printer.css_module = Some(CssModule::new(..., references_mut));
```

The `&raw mut` detaches the borrow lifetime from the local `references` so it can be tied to the printer's `'a`. `printer.css_module = None` is set before `references` is moved into the result. **Sound — no aliasing window.**

#### 2.8.2 `css_parser.rs:2717-2726` — `transmute<CssModuleExports<'_>, CssModuleExports<'static>>`

Same `'bump`-erasure pattern as the `&'static [u8]` Token slices. The exports HashMap stores arena-owned key/value byte slices. The current bundler call path consumes the result before the arena drops (verified in `bundler/linker_context/generateCompileResultForCssChunk.rs:108-178`: the `ToCssResult` is consumed and discarded same-frame). **Sound today; T2 over-strong lifetime.**

#### 2.8.3 `css_parser.rs:3322`, `:3336`, `:3350`, `:3365` — `&mut *lg.as_ptr()` (ParserOptions warn helpers)

`ParserOptions.logger: Option<NonNull<Log>>`. Constructed at `:3387` from `log.map(NonNull::from)`, where `log: Option<&'a mut Log>`. The `NonNull` is read back through the four `warn*` methods. Same single-live-borrow contract as §2.1.1. **Sound under documented contract.**

#### 2.8.4 `css_parser.rs:3508` — `unsafe { core::ptr::read(&raw const *options) }`

```rust
unsafe { core::ptr::read(&raw const *options) }
```

`options: &ParserOptions<'_>`. The duplicate ParserOptions has its `logger: Option<NonNull<Log>>` aliased with the original. **Sound** because `NonNull<Log>` is `Copy` and the contract is "single live borrow at a time" not "single owner".

#### 2.8.5 `css_parser.rs:5547-5552` — `Tokenizer::slice_from`

```rust
pub fn slice_from(&self, start: usize) -> &'static [u8] {
    unsafe { src_str(&self.src[start..self.position]) }
}
```

Sub-slice of `self.src: &'a [u8]`. Erased to `'static`. **Sound under arena-lifetime contract.**

#### 2.8.6 CSS at-rule import_records aliasing (`css_parser.rs:894-924`)

```rust
fn on_import_rule(this: &mut Self, import_rule: &mut ImportRule, ...) {
    let import_records = unsafe { &mut *this.import_records };
    ...
}
```

`this.import_records: *mut Vec<ImportRecord>` aliases a `&mut Vec<ImportRecord>` held one frame up. The hook runs synchronously between parser accesses, and the rationale at the field declaration (`css_parser.rs:846-852`) documents the no-concurrent-mutation invariant. **Sound.**

---

### 2.9 CSS selectors (`src/css/selectors/parser.rs`, `selectors/builder.rs`, `selectors/selector.rs`)

11 unsafe sites in `parser.rs`, 1 in `builder.rs`, 4 in `selector.rs`. All are either `arena_str(p)` (Phase-A lifetime erasure) or `ptr::read(&raw const x)` for non-`Copy` POD compaction inside `small_list_into_box` and the selector builder's `to_components`. Audited the cursor monotonicity in `selectors/builder.rs:160-205`: `current_simple_selectors_i` only advances; `rest_of_simple_selectors` is the disjoint prefix of the previous `current` slice. Each element is consumed exactly once across the loop, and `set_len(0)` on the source `SmallList` at the end suppresses Drop. **Sound.**

---

### 2.10 CSS rules (`src/css/rules/*.rs`)

#### 2.10.1 `rules/import.rs:228-254` — `ImportRule::conditions` / `conditions_mut` layout pun

```rust
let base = std::ptr::from_ref::<Self>(self).cast::<u8>();
unsafe {
    &*base
        .add(core::mem::offset_of!(Self, layer))
        .cast::<ImportConditions>()
}
```

`#[repr(C)] pub struct ImportRule { url, layer, supports, media, import_record_idx, loc }` and `#[repr(C)] pub struct ImportConditions { layer, supports, media }`. The cast extracts the `{layer, supports, media}` field run from `ImportRule` as if it were an `ImportConditions`. Soundness requires:

1. **Field order match.** Both `repr(C)`. Confirmed.
2. **Field type match.** `Option<Layer>`, `Option<SupportsCondition>`, `MediaList` — identical between both structs.
3. **No padding mismatch.** `repr(C)` layout of `{layer, supports, media}` is the same in both contexts because Rust `repr(C)` computes field offsets purely from the in-order field types and their alignments — the trailing fields of `ImportRule` (`import_record_idx: u32`, `loc: Location`) do not perturb the offsets of `layer/supports/media`.

**Sound today.** **T3 watchlist** — there's no compile-time assertion that the layouts agree. Adding a `const _: () = assert!(core::mem::offset_of!(ImportRule, layer) == 0 + core::mem::offset_of!(ImportConditions, layer));` plus per-field offset equality would catch a refactor that adds a field between `layer` and `supports` in either struct, or that adds an alignment-disturbing field before `layer` in only one of them.

#### 2.10.2 `rules/mod.rs:259-302` — `'bump`-erasure helpers (`arena_static`, `decl_block_static`, `decl_handler_static`)

Documented Phase-A erasure. **Sound** in current usage; **T2** — the type system permits constructing a `DeclarationBlock<'static>` whose backing arena does not actually outlive `'static`.

#### 2.10.3 `rules/mod.rs:173-174` — `unsafe impl<R: Send> Send for CssRule<R>` (and `Sync`)

Mirrors the `declaration.rs:53-54` impl. The `CssRule` tree contains `SmallList<T, N>` and `bun_alloc::ArenaVec<'bump, T>` which are `!Send`/`!Sync` because they hold raw pointers / `&Bump`. The assertion stands on "post-parse, immutable, read-only across the bundler thread pool". **T3 watchlist** — if any code path mutates a CssRule across threads after parse, the `Bump` reference is `!Sync` and the program is UB. No such path observed today; bundler treats the parsed AST as immutable.

---

### 2.11 CSS values (`src/css/values/*.rs`)

#### 2.11.1 `values/ident.rs:333-362` — `IdentOrRef` pointer-tagging

```rust
pub fn from_ident(ident: Ident) -> Self {
    let s = ident.v();
    let (ptr, len) = (s.as_ptr() as usize as u64, s.len() as u64);
    debug_assert!(ptr & (1u64 << 63) == 0);
    Self::pack(ptr, false, len)
}
```

The packed `u128` reserves bit 63 of `ptrbits` as the ident/ref discriminator. The high-bit invariant is enforced **only via `debug_assert!`**. On Linux/macOS/Windows x86-64 and AArch64 with default kernel configuration, user-space pointers are bounded by 48 bits (47 effective bits + sign-extension that does not set bit 63 for user-space). On Linux with 5-level paging, user-space tops out at 57 bits — still below bit 63. On AArch64 with TBI (top-byte ignore), the top byte may be tagged but the address bit 63 remains 0 for user-space. **Sound across all currently-supported Bun targets.** **T3 watchlist** — the assertion should be a `assert!` rather than `debug_assert!` to be robust against future kernel ABI changes, or the bit field width should be widened. Cost: one `cmp $0, %rax / jns` on the construction path; negligible.

`as_ident()` (line 374-385) unpacks via `core::slice::from_raw_parts(ptr, len)`. Sound iff packing was sound. The `as usize as *const u8` round-trip preserves the address-bit pattern. **Sound under the invariant.**

#### 2.11.2 `values/ident.rs:433` — `slice::from_raw_parts(from_ref::<Self>(self).cast::<u8>(), N)`

```rust
unsafe { core::slice::from_raw_parts(std::ptr::from_ref::<Self>(self).cast::<u8>(), N) }
```

Re-interprets `Self` (a small struct) as `[u8; N]` for hashing. Requires `N == size_of::<Self>()` and that `Self` has no padding bytes (otherwise UB on read because uninit bytes are not allowed in `&[u8]`). Need to check Self.

<details>
<summary>Verify: `DashedIdent` / `Ident` / `CustomIdent` layout (struct `{ v: *const [u8] }`):</summary>

`*const [u8]` is a fat pointer: `(ptr: *const u8, len: usize)` = 16 bytes on 64-bit, no padding. `size_of::<Ident>() == 16`, `N` is the caller-supplied constant matching that size.

</details>

Sound today; **T3 watchlist** — adding any field to one of the arena-slice newtypes (`DashedIdent`, `Ident`, `CustomIdent`) without updating the `N` constant would either crash or read undef. A `const _: () = assert!(N == size_of::<Self>())` would catch.

#### 2.11.3 `values/image.rs:313, 415, 470, 480, 507, 531` — arena slice detachment

All identical to §2.8.5 pattern. **Sound.**

---

### 2.12 CSS properties (`src/css/properties/*.rs`)

#### 2.12.1 `properties/custom.rs:1555` — `PartialEq for CustomPropertyName`

```rust
impl PartialEq for CustomPropertyName {
    fn eq(&self, other: &Self) -> bool {
        unsafe { (&*self.as_ptr()).eq(&*other.as_ptr()) }
    }
}
```

`as_ptr` returns `*const [u8]` from `DashedIdent.v` or `Ident.v` — never null. Raw-deref to `&[u8]`. **Sound.**

#### 2.12.2 `properties/font.rs:365` — `&*std::ptr::from_ref::<bun_alloc::Arena>(input.arena())`

Detach the arena lifetime from the `input` reference. **Sound** under the convention that the arena outlives every value built during the parse.

#### 2.12.3 `properties/animation.rs:300` — `&raw const *s`

```rust
if let Ok(s) = input.try_parse(|i| i.expect_string().map(|s| std::ptr::from_ref::<[u8]>(s)))
{
    return Ok(AnimationName::String(unsafe { &raw const *s }));
}
```

`s: *const [u8]`. `*s` is the place expression for the slice; `&raw const *s` is the address of that place, well-defined under Rust 2024 `&raw` semantics (no intermediate reference materialised). Equivalent to `s` itself. The whole `unsafe` block can be removed by just writing `AnimationName::String(s)`. **Sound, redundant — cleanup opportunity.**

---

### 2.13 `properties` and shared `Send`/`Sync` impl audit

`declaration.rs:53-54` (`unsafe impl Send/Sync for DeclarationBlock<'bump>`), `rules/mod.rs:173-174` (same for `CssRule<R>`). Both lean on the bundler treating the parsed AST as immutable. **T3 watchlist** — see §2.10.3.

---

## 3. Tiered findings

### 3.1 T1 (live UB / memory-safety bug)

**None.** Both crates are clean to the depth this audit reached.

### 3.2 T2 (over-strong type signatures / missing contracts)

**T2-CSS-001 — `Vec::from_bump_slice` accepts any `T`**
- **File:** `src/collections/vec_ext.rs:243-254`
- **Risk:** The function is sound only for `T: Pod` (no Drop) or for slices that genuinely come from a bump arena. Callers at `js_parser/parse/parse_entry.rs:1430, :1615` and the bundler pass it `ImportRecord` slices from `ImportRecordList::Borrowed(&mut Vec<ImportRecord>)`, which is heap-backed. Sound today only because `ImportRecord` lacks a Drop impl.
- **Fix:** Split into two functions:
  - `from_bump_slice_pod<T>(items: &mut [T]) where T: Copy` (or a marker-trait that asserts no Drop).
  - `from_bump_slice_arena<T>(items: &mut [T])` keeping today's contract that the source is bump-arena.
- **Tier rationale:** No current UB. Adding a Drop-bearing field to `ImportRecord` (e.g. `original_path: Box<[u8]>`) would silently turn this into double-free across all callers.

**T2-JS-001 — `MacroContext::get_remap` returns `Option<&'static MacroRemapEntry>` over arena data**
- **File:** `src/js_parser/lib.rs:197-208`
- **Risk:** The `'static` is a placeholder for `Transpiler.options`'s lifetime. In the off-thread `RuntimeTranspilerStore` worker, the backing storage is finite-lifetime, and the `deinit(self)` paired with `init` is what scopes it. Type system does not connect the returned reference to the `&'a MacroContext`.
- **Fix:** Either change the return type to `Option<&MacroRemapEntry>` (tied to `&self`) and let downstream `'a` flow through, or document the contract more strongly and ensure no caller holds the result across `MacroContext::deinit`.

**T2-CSS-002 — `ToCssResultInternal::exports/references` typed `'static`**
- **File:** `src/css/css_parser.rs:2320-2324` and the `transmute` at `:2717-2726`.
- **Risk:** The HashMaps store arena-owned byte slices keyed and valued; serialising or persisting them after the arena drops is UAF. Today's bundler consumes them same-frame.
- **Fix:** Re-thread `'bump` on the result struct once the rest of the AST grows the parameter (already TODO'd at the field declarations).

**T2-CSS-003 — `PropertyUsage::custom_properties: Box<[&'static [u8]]>`**
- **File:** `src/css/css_parser.rs:2453`
- **Risk:** Stored on `StyleSheet.local_properties`. Lives as long as the StyleSheet. If the StyleSheet is moved / serialised away from its arena (currently it isn't), UAF.
- **Fix:** Same as T2-CSS-002 — re-thread `'bump`.

### 3.3 T3 (latent-shape watchlist)

**T3-JS-001 — `LexerType::end -= 1` in `rescan_close_brace_as_template_token`**
- **File:** `src/js_parser/lexer.rs:3450`
- **Risk:** Underflow if `self.end == 0`. Currently unreachable because the function precondition is `self.token == T::TCloseBrace`. Add a `debug_assert!(self.end > 0)`.

**T3-CSS-001 — `ImportRule` / `ImportConditions` layout pun lacks `const_assert`**
- **File:** `src/css/rules/import.rs:236-254`
- **Risk:** Adding or reordering a field between `layer` and `media` in either struct would silently corrupt the layout pun. **Add:**
  ```rust
  const _: () = {
      use core::mem::offset_of;
      assert!(offset_of!(ImportRule, layer) >= offset_of!(ImportConditions, layer));
      assert!(offset_of!(ImportRule, supports) - offset_of!(ImportRule, layer)
              == offset_of!(ImportConditions, supports) - offset_of!(ImportConditions, layer));
      assert!(offset_of!(ImportRule, media) - offset_of!(ImportRule, layer)
              == offset_of!(ImportConditions, media) - offset_of!(ImportConditions, layer));
  };
  ```

**T3-CSS-002 — `IdentOrRef` bit-63 invariant gated on `debug_assert!`**
- **File:** `src/css/values/ident.rs:338-339, 353`
- **Risk:** On a future target where user-space pointers may have bit 63 set (none current; raised by Linux 5-level paging discussions for the future). Promote to `assert!` (one cmp/jns; negligible).

**T3-CSS-003 — `IdentFns` / `CustomIdentFns` / `DashedIdentFns` `from_raw_parts(self as *const u8, N)` lacks `const_assert`**
- **File:** `src/css/values/ident.rs:433` (inside `arena_slice_newtype!` macro expansion)
- **Risk:** Adding a field to the newtype would silently read padding / OOB. Add `const _: () = assert!(N == size_of::<Self>())`.

**T3-CSS-004 — `unsafe impl Send/Sync for DeclarationBlock<'bump>` and `CssRule<R>`**
- **File:** `src/css/declaration.rs:53-54`, `src/css/rules/mod.rs:173-174`
- **Risk:** Relies on "post-parse, immutable". If a future code path mutates the AST across threads, the embedded `&Bump` is `!Sync` and the program is UB.
- **Defence:** Wrap the AST in a `MutationFrozen<T>` type whose `Send`/`Sync` impls are conditional on `T: Send` only after a `freeze()` token has been issued. Or split parse-time / immutable-tree types.

**T3-JS-001 — `ToExprWrapper` static fn-ptr can be mis-typed across `P` monomorphisations**
- **File:** `src/js_parser/p.rs:3041-3055`, `src/ast/binding.rs:156-203`
- **Risk:** Today the wrapper is stored per-`P` field so the monomorphisation cannot drift. If refactored onto a shared parent struct, the cast back to `P<TS, SCAN_ONLY>` would silently mis-type. Defence: parameterise `ToExprWrapper<TS: bool, SCAN: bool>` with a `PhantomData<P<'_, TS, SCAN>>`.

**T3-JS-002 — `lower_decorators::class_copy` / `prop_copy` / `prop_full_copy` `unsafe` is invariant-on-`AstAlloc::deallocate`-is-no-op**
- **File:** `src/js_parser/lower/lower_decorators.rs:81-130`
- **Risk:** If anyone ever makes `AstAlloc::deallocate` actually deallocate (e.g. for global-heap fallback paths), the double-free risk lights up everywhere these helpers are called. Defence: centralise into `bun_ast::arena_dup<T: ArenaSafe>(x: &T) -> T` with a marker trait `ArenaSafe` that the type system enforces.

### 3.4 Tier totals

| Tier | Count |
| --- | --- |
| T1 (live UB) | **0** |
| T2 (missing contracts / over-strong types) | **4** |
| T3 (latent-shape watchlist) | **8** (1 JS lexer, 1 JS parser, 6 CSS) |

---

## 4. Negative findings (areas I checked, no issue)

- **Lexer integer overflow on source positions.** Conversion to `i32` panics on files > 2 GB (`usize2loc` at `ast/lib.rs:2609` and ~30 sites in `lexer.rs`). Not UB.
- **String-table indexing.** The lexer string-table is `Vec<u8>` indexed by clamped offsets; no `unsafe` indexing was found in this audit.
- **AST arena allocations.** `MimallocArena`'s reset model is well-understood and the lexer/parser never hold raw pointers across `reset()`. `Drop` semantics are correctly handled by the AstAlloc no-op deallocate (see §2.2.2).
- **Lookahead beyond EOF.** Every `byte_at(n)` in the CSS tokenizer is paired with `has_at_least(n)`. The JS lexer uses `next_codepoint_with` which bounds-checks `current < len`.
- **UTF-8 boundary handling.** `next_codepoint_multibyte` (`bun_core/string/immutable.rs:506`) bounds-checks `avail >= cp_len` before the 4-byte buffer copy. Truncated multibyte sequences return `-1`.
- **Source-map encoding.** Did not surface in this pass; VLQ encoding lives in `bun_js_printer` / `bun_sourcemap`, out of scope.
- **TypeScript-specific generic-bracket lookahead.** `parse/parse_typescript.rs:223-224` and `parse/parse_skip_typescript.rs` guard with `stack_check.is_safe_to_recurse()` and never allocate raw pointers across the lookahead. No unsafe in these files at all.
- **Template-literal nested parsing.** `lexer.rs:3440-3453` rescan transitions; stack depth guarded by `parse_stmt.rs:1834`. Underflow at `end -= 1` is reachable only from invalid lexer state (see T3-JS-001).
- **Regex parsing.** `scan_reg_exp` and `scan_reg_exp_validate_and_step` have no unsafe. The `u16` truncation of `regex_flags_start` (`lexer.rs:2827`) is a correctness corner case for regex literals > 64 KiB but not UB.
- **Macro / preprocessor.** The FFI shim in `lib.rs:106-140` is the only `unsafe extern` surface. Each `unsafe fn` is gated with a precondition comment that matches the call-site contract (§2.7).
- **CSS at-rule recursion / stack depth.** No stack-check in the CSS parser. Deeply nested `:is(:is(...))` would SIGSEGV via stack guard page (Rust safe behaviour, not UB). DoS, not memory unsafety.
- **`bytemuck::cast_slice` round-trips for UTF-16 raw_content.** Alignment is preserved by `Arena::alloc_slice_copy::<u16>`; length is even by construction. Sound.

---

## 5. Methodology summary

- Mapped both crates' file structure (non-standard cargo layout, files in crate root + `lexer/`, `parser/`, `parse/`, `visit/`, `scan/`, `lower/` subdirs).
- Read inventory entries for both crates and verified that the inventory misses some `unsafe` sites (notably `lexer.rs:494`, `lexer.rs:1198`, `parser.rs:1163`). Re-walked the source with `grep -rn '\bunsafe\b'` to enumerate the real set.
- Picked ~75 sites across the two crates, biased toward lexer-internal, token-construction, AST-construction, arena-lifetime, and FFI; for each, read ≥ 25 lines of context.
- Cross-checked each `unsafe` against the documented invariant in `bun_alloc::ast_alloc` (AstAlloc deallocate is no-op), `bun_ptr::detach_lifetime*` (caller-asserted), and the per-site SAFETY comments.
- For every candidate T1, attempted to construct an adversarial input. None survived verification.
- Where the SAFETY comment relied on a no-Drop or arena-lifetime invariant, verified the depended-upon type (e.g. `ImportRecord` has no Drop; `Vec<_, AstAlloc>`'s deallocate is no-op; `StoreSlice<T>: Copy`).

---

## 6. Recommendations

1. **Land `const_assert`s for the 3 CSS layout puns** (T3-CSS-001, T3-CSS-002, T3-CSS-003). One-line additions; immediate.
2. **Split `Vec::from_bump_slice`** into POD-only and arena-only variants (T2-CSS-001). The current single-signature is a latent footgun for the next person who adds a `Box<[u8]>` field to `ImportRecord`.
3. **Document the `ToExprWrapper` const-generic-matching invariant** at the type definition (`ast/binding.rs:156`) and consider parameterising it with a phantom `P<TS, SCAN>` to make the type system enforce it (T3-JS-001).
4. **Promote `IdentOrRef` bit-63 `debug_assert!` to `assert!`** (T3-CSS-002). Trivial cost; future-proofs against kernel ABI surprises.
5. **Consider an `ArenaSafe` marker trait** for the recurring `ptr::read(&raw const x)` pattern in `lower_decorators.rs` and elsewhere. Centralising the unsafe behind `arena_dup<T: ArenaSafe>(&T) -> T` would let future audits skip every call site (T3-JS-002).
6. **Phase B `'bump` re-threading is the structural cure** for T2-JS-001, T2-CSS-002, T2-CSS-003 and several T3s; these will collapse together with the crate-wide lifetime threading already TODO'd at multiple sites.

---

**End of report.**

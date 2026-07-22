# PASS4 — `bun_shell_parser` deep audit

**Crate:** `bun_shell_parser` (`src/shell_parser/`)
**Surface:** Bun's shell-command parser for the `Bun.$` template-literal API.
**Inventory entries claimed:** 11 (filtering JSONL by `"crate":"bun_shell_parser"`).
**Actual `unsafe` block / fn sites enumerated by `grep`:** 12 (8 in `braces.rs`, 4 in `parse.rs`).
**Files audited (full or near-full reads):**

- `src/shell_parser/lib.rs` (44 lines — read in full)
- `src/shell_parser/braces.rs` (1497 lines — every `unsafe` site read with ≥25 lines of context)
- `src/shell_parser/parse.rs` (4874 lines — all `unsafe` sites, all lexer entry points, all int-cast `try_from(...).expect("int cast")` sites, all `looks_like_*` / `eat_js_*` paths read with context)
- `src/shell_parser/json_fmt.rs` (319 lines — read in full; no `unsafe`)

**Cross-checked against:**

- `src/runtime/shell/shell_body.rs` (the runtime side that *constructs* the lexer input, populates `string_refs`, and consumes `LexResult` for JSC)
- `src/runtime/shell/states/Expansion.rs` (the runtime caller of `braces::Lexer::tokenize` + `braces::expand`)
- `src/runtime/api/BunObject.rs` (the user-facing `Bun.braces` entry that exercises `ast_to_json`)
- `src/js/builtins/shell.ts` (JS-side template handler — feeds `raw` strings + interpolation values to `createParsedShellScript`)
- `test/js/bun/shell/shell-sentinel-hardening.test.ts` (existing prior-art regression test that already exercises the `\x08`-sentinel adversarial case)

The audit was scoped per the prompt: NO finding is in this document unless I can either (a) construct a concrete adversarial input that drives the path, or (b) state the precise missing/wrong invariant. Padding has been actively avoided.

---

## 1. Attack-surface map

### 1.1 What the user controls

The JS-facing entrypoint:

```js
await Bun.$`cat ${userInput} | grep ${pattern} > ${outFile}`.text();
```

The tagged-template function (`src/js/builtins/shell.ts:302`) receives:

- `first.raw`: the **template-literal raw parts** (the `cat `, ` | grep `, ` > `, trailing empty string segments between the holes). These are author-controlled — the template literal itself, NOT user data.
- `rest`: an array of **interpolation values** (`userInput`, `pattern`, `outFile`). These are the attacker-controlled JS values.

The runtime then calls `createParsedShellScript(first.raw, rest)` which routes to `shell_cmd_from_js` in `src/runtime/shell/shell_body.rs`. That function builds a single byte buffer (`script: Vec<u8>`) by concatenating the raw parts with **opaque sentinel markers** for each interpolation hole:

- `\x08__bunstr_N` (`LEX_JS_STRING_PREFIX` + decimal index) for a JS **string** value
- `\x08__bun_N` (`LEX_JS_OBJREF_PREFIX` + decimal index) for a JS **object** value (Blob / ArrayBuffer / ReadableStream / Response / array → emitted as an opaque "object reference")

`\x08` is the sentinel: `const SPECIAL_JS_CHAR: u8 = 8;` in `parse.rs:2411` and is **explicitly listed in `SPECIAL_CHARS`** (`parse.rs:4342-4377` line 4376). That membership is the single most important security property in the crate. See §5.1.

The lexer then runs over `script` and replaces marker tokens with content from the side-channel arrays (`string_refs: &mut [BunString]` and `jsobjs_len: u32`).

### 1.2 Security model in one sentence

> User-supplied **string** content never lands directly in the lexer's source bytes; it lands in `string_refs[N]` and is referenced from the script via a sentinel marker `\x08__bunstr_N` that the lexer recognises and replaces with the BunString's contents *as a single quoted token* (which the parser then turns into a single argv word).

If that invariant holds, no metacharacter inside a user string can escape to be parsed as shell syntax. The audit revolves around verifying that invariant and the unsafe code around it.

### 1.3 Files in scope and the role of each

| File | Role | `unsafe` blocks |
| ---- | ---- | --------------- |
| `lib.rs` | Crate root, mod declarations, re-exports | 0 |
| `braces.rs` | Brace-expansion (`{a,b,c}`) lexer + AST + `expand_nested` (the only `unsafe fn` in the crate) | 8 |
| `parse.rs` | Main shell lexer + parser + AST + escape helpers + `SmolList<T,N>` (small-vec optimisation) | 4 |
| `json_fmt.rs` | Pure-safe JSON writer for debug AST dump (`Bun.braces(str, {parse:true})`) | 0 |

The `unsafe`-site distribution maps cleanly to two distinct categories:

1. **`braces.rs`**: lifetime-erased borrows of the lexer's input (`*const [u8]` in `SrcAscii`, `CodepointIterator<'static>` in `SrcUnicode`) and the `expand_nested` raw-pointer-graph recursion. This is a direct port of Zig's pointer semantics.
2. **`parse.rs`**: `SmolList<T,N>::SmolListInlined` uses `MaybeUninit<T>` storage and exposes `slice` / `slice_mut` / `pop` via `assume_init_read` / `from_raw_parts`. Inline small-vec idiom.

The vast majority of *complexity* and *security relevance* lives in the lexer (entirely safe code) and in the JS-side runtime adapter (`shell_body.rs`, out of crate). The `unsafe` blocks themselves are mostly mechanical and small.

---

## 2. Per-area analysis

### 2.1 Lexer source (`SrcAscii` / `SrcUnicode`)

There are **two parallel implementations** of `SrcAscii`/`SrcUnicode`:

- `braces.rs:35-94` (`SrcAscii { bytes: *const [u8], i }`) and `braces.rs:98-168` (`SrcUnicode { iter: CodepointIterator<'static>, … }`) — **raw-pointer / `'static`-lifetime erased**.
- `parse.rs:3944-3990` (`SrcAscii<'a> { bytes: &'a [u8], i }`) and `parse.rs:4000-4070` (`SrcUnicode<'a> { bytes: &'a [u8], … }`) — **proper borrow lifetime**.

The two are unified only at the call-site level (`Chars<ENCODING>` in `braces.rs` vs `ShellCharIter<'a, ENCODING>` in `parse.rs`). The `parse.rs` version is safe-by-construction — the lifetime is checked by the borrow checker. The `braces.rs` version requires manual reasoning, since the raw pointer / `'static`-erased lifetime allows the borrow to outlive the underlying byte buffer.

#### Lifetime erasure: where does the buffer come from?

`braces.rs::SrcAscii::init` (line 57):
```rust
fn init(bytes: &[u8]) -> Self {
    Self { bytes: std::ptr::from_ref::<[u8]>(bytes), i: 0 }
}
```

There are exactly **two call paths** that construct this:

1. `Expansion.rs:258 do_brace_expand`:
   ```rust
   let brace_str = &me.current_out[..];  // &[u8] borrow of an Expansion field
   let mut lexer_output = braces::Lexer::tokenize(brace_str);   // lexer consumed, then dropped
   // ... compute count, alloc expanded ...
   braces::expand(&arena, &mut lexer_output.tokens[..], &mut expanded[..], ...);
   drop(arena);
   me.current_out.clear();   // ← only mutation of current_out; happens AFTER lexer drops
   ```
   The lexer is constructed, run to completion, and the resulting `Vec<Token>` (which contains `SmolStr` that **own their bytes**, see §2.3) is the only thing that escapes. The raw pointer in `SrcAscii.bytes` is dead by the time `current_out` is touched. **Safe.**

2. `BunObject.rs:496` (`Bun.braces(str, {tokenize|parse|expand})` JS entry):
   `brace_slice.slice()` (a `ZigStringSlice` view onto a JS string). Same pattern — lexer is consumed eagerly, output is detached `Vec<Token>` / `Vec<BunString>`.

In both cases the borrowed buffer outlives the iter by construction, but the *static-checker has been disabled* by the raw-pointer round-trip. A future refactor that holds `SrcAscii` past the buffer's lifetime would silently UAF. See finding **T3-A**.

#### Codepoint truncation safety

`bun_core::string::immutable::unicode.rs:247-289` (`NewCodePointIterator::next`) handles truncated multi-byte sequences by **copying into a zero-padded stack buffer** before decoding (lines 260-273). A multi-byte UTF-8 lead near EOF without enough continuation bytes therefore decodes to `U+FFFD` (zero is not a valid continuation byte), not OOB. **No lookahead-past-EOF UB.**

#### Comment handling and multi-byte UTF-8

`parse.rs:3890 eat_comment` loops on `self.eat()` which always returns one *codepoint*. Multi-byte UTF-8 characters collapse to a single `InputChar { char: u32, escaped: bool }`, so the `peeked.char == u32::from(b'\n')` test compares against U+000A and matches only the literal newline, never a continuation byte of a multibyte sequence. **Negative finding: no multi-byte split bug in comment handling.**

### 2.2 The JS-substitution marker path (the security-critical hot zone)

This is the most attacker-relevant code in the crate. Trace at `parse.rs:2648-2678`:

```rust
let input = match self.eat() { Some(i) => i, None => …, };
let char = input.char;
…
// Special token to denote substituted JS variables
if char == u32::from(SPECIAL_JS_CHAR) {
    if self.looks_like_js_string_ref() {
        if let Some(bunstr) = self.eat_js_string_ref() {
            self.break_word(false)?;
            self.handle_js_string_ref(bunstr)?;
            continue;
        }
    } else if self.looks_like_js_obj_ref() {
        if let Some(tok) = self.eat_js_obj_ref() {
            if self.chars.state == CharState::Double {
                self.add_error(b"JS object reference not allowed in double quotes");
                return Ok(());
            }
            self.break_word(false)?;
            self.tokens.push(tok);
            continue;
        }
    }
}
```

The flow is:

1. The cursor sits on a `\x08`. `self.eat()` consumes it.
2. After eat, the cursor points to the byte AFTER `\x08`. `src_bytes_at_cursor()` returns that suffix.
3. `looks_like_js_string_ref` / `looks_like_js_obj_ref` compare the suffix against `__bunstr_` / `__bun_` (literal, ASCII).
4. On match, `eat_js_substitution_idx` parses the trailing decimal index and validates it against `string_refs.len()` / `jsobjs_len`.

The bounds check at `parse.rs:3791-3796`:

```rust
fn validate_js_string_ref_idx(&mut self, idx: usize) -> bool {
    if idx >= self.string_refs.len() {
        self.add_error(b"Invalid JS string ref (out of bounds");
        return false;
    }
    true
}
```

The index lookup at `parse.rs:3786`:

```rust
return Some(self.string_refs[idx]);
```

The previous bounds check ensures `idx < self.string_refs.len()` at the indexing site. **The index is a `usize` parsed from up to 32 ASCII digits**; `eat_js_substitution_idx` returns `None` if the buffer overflows. There is no panic, no UB. The existing regression test `shell-sentinel-hardening.test.ts:28 "raw sentinel injection with out-of-bounds index does not crash"` exercises this path explicitly with `idx = 9999` on an empty `jsobjs` array and verifies the lexer rejects it.

**Negative finding (T-NEG-1):** I attempted to construct an out-of-bounds-read adversarial input. Two attempts:

- `` Bun.$`echo ${{ raw: "\x08__bunstr_999999999999999999999999999999999" }}` `` — index buffer overflows `digit_buf = [u8; 32]` → returns `None` → lexer falls through and treats the `\x08` as a literal in the strpool. No panic, no UB.
- `` Bun.$`echo ${{ raw: "\x08__bunstr_5" }}` `` (with zero actual interpolations) — `string_refs.len() == 0` → `idx >= 0` → bounds check fails → `add_error` is called and the lexer emits a `LexerError`. No UB.

**This is the load-bearing security check of the entire crate. It is correct.**

#### Sub-point: can a user string itself spoof a marker?

A user's interpolated string may contain literal `"\x08__bunstr_3"`. The question: does *that* user string get marker-replaced (good) or inlined raw (bad)?

`shell_body.rs:1006-1019 append_js_value_str` does **null-byte detection only**. The real gating happens at line 1038-1042:

```rust
if ALLOW_ESCAPE {
    if needs_escape_bunstr(bunstr) {
        self.append_js_str_ref(bunstr)?;
        return Ok(true);
    }
}
```

`needs_escape_bunstr` → `needs_escape_utf8_ascii_latin1` (`parse.rs:4514`) → scans for any byte in `SPECIAL_CHARS_TABLE`. **`SPECIAL_CHARS_TABLE` is built from `SPECIAL_CHARS` which explicitly includes `SPECIAL_JS_CHAR` (line 4376).** Therefore any user string containing `\x08` triggers `needs_escape_bunstr → true` and is routed through `append_js_str_ref` (which writes a marker for an entry in `jsstrs_to_escape`, bumping the BunString's refcount). The user-supplied `\x08` never reaches the lexer's input buffer as a literal byte. **Safe.**

The existing regression test (`shell-sentinel-hardening.test.ts:6-26`) covers exactly this: it asserts that `"\x08__bun_abc"` and `"\x08__bunstr_abc"` round-trip through `${userControlled}` as a single argv word. The test passes against the current code.

#### Sub-point: can the user template (not interpolation) put a fake marker?

Yes — the **template-literal raw parts** are concatenated into `script` without escaping (and shouldn't be — they're author-controlled). A developer who writes:

```js
await Bun.$`echo \x08__bunstr_0 ${user}`
```

… would inject the literal sentinel bytes into the script buffer. With `jsstrs_to_escape.len() == 1` (one entry for `${user}`), the lexer would find `string_refs[0] == user` for *both* the literal `\x08__bunstr_0` and the actual interpolation marker. The developer's literal text would silently expand to `user`'s contents.

This is **author-controlled** by design and **not a vulnerability** — a developer can equally just write `${user}` once and bypass the indirection. The sentinel is documented (`parse.rs:2409-2411` "deliberately chosen so that it is not easy for the user to accidentally use") as a foot-gun rather than a security boundary on the author side. **Not a finding; documented for completeness.**

### 2.3 The brace-expansion AST and `expand_nested`

`braces.rs:667-795` defines the only `unsafe fn` in the crate:

```rust
unsafe fn expand_nested(
    root: *mut ast::Group,
    out: &mut [Vec<u8>],
    out_key: u16,
    out_key_counter: &mut u16,
    start: u32,
) -> Result<(), ExpandError>
```

`ast::Group` is bump-allocated; its `bubble_up: *mut Group` and `bubble_up_next: Option<u16>` fields form a backref so the recursion can "return" to the parent group after processing a variant. The contract (per the doc comment at line 660-664): all `Group` storage is bump-owned, slices outlive the call, and the function uses raw-pointer derefs to avoid creating overlapping `&mut Group` borrows.

#### Aliasing reasoning

The function pattern is:

```rust
let group: *mut ast::Group = (*variants).as_mut_ptr().add(j);
(*group).bubble_up = root;
(*group).bubble_up_next = Some(i + 1);
…
expand_nested(group, out, new_key, out_key_counter, 0)?;
```

Each `(*group).field = …` writes through `*mut Group` (no long-lived `&mut Group`). The recursive call passes `group` (a raw pointer); inside that call, when the recursion bubbles up, it reads `(*root).bubble_up == group` and calls `expand_nested(group, …)` again. Sequentially, no two `&mut` borrows of the same `Group` exist; each deref is a transient field access.

The only place a real reference is materialised is `let atom: &ast::Atom = &(*many)[i_];` (line 755). At that point we've already obtained `many: *mut [ast::Atom]` and `(*many)[i_]` indexes into it. The `&` then makes a `&ast::Atom`. **No mutation of the `Atom` happens while that borrow is live** — the body only inspects `atom` (line 756 `match atom`) and either appends bytes to `out` or recurses with `(*variants).as_mut_ptr().add(j)` which is a different allocation (the *variants array* of an Expansion, not the *atom array* of the parent Group). The recursion can write `bubble_up` on a child Group inside Expansion's variants — that child is in a different allocation from the parent's `many` slice. So no overlap.

**Caveat:** the safety reasoning depends on the *bumpalo allocator's* invariant that distinct allocations don't overlap, and on the parser building Groups such that a Group's `atoms` field never aliases its `bubble_up`. The current parser (`braces.rs:919-1004`) builds Groups bottom-up: each variant gets a fresh `BumpVec<Group>` for its atoms and is then collected into a new `BumpVec<Group>` for the parent's variants. There is no sharing of inner slices. **Sound.**

#### `(*variants).as_mut_ptr().add(j)` and `.len()` on `*mut [T]`

Lines 715-718 / 765-768:
```rust
let variants = expansion.variants;        // *mut [Group]
let variants_len = variants.len();        // safe — reads slice-metadata len
for j in 0..variants_len {
    let group: *mut ast::Group = (*variants).as_mut_ptr().add(j);
```

`<*mut [T]>::len` is **safe** (the length is stored in the fat pointer, no deref needed). `as_mut_ptr()` on a raw slice pointer requires a deref through the slice; in current Rust this is the established idiom. `add(j)` for `j < variants_len` keeps us within the allocation. **OK.**

#### Integer-overflow risk — the actual non-UB issues

Two real concerns, both **DoS-class**, not UB:

1. Line 754: `let i: u16 = u16::try_from(i_).expect("int cast");` where `i_ < many_len`. `many_len` comes from a bump-allocated slice with no enforced bound. A user supplying a brace expansion with more than 65535 atoms in a single group would panic. The lexer **does** enforce `tokens.len() <= u16::MAX` in `build_expansion_table` (`braces.rs:1163`), so the *expansion-table* path is bounded, but `expand_nested` runs on the parser's `Group` (bump) representation and the parser is independent of that check. **However**, the lexer is the only producer of those Groups (via `Parser::parse` consuming `Token` from the lexer, `braces.rs:919-944`), and the lexer's `Token::Open(_) / Close / Comma` count is bounded by the input length. A 64 KiB input could plausibly drive > 65535 atoms only if each atom is a single byte — `parse_expansion` (`braces.rs:958`) creates one `Group` per variant (one variant per `Comma`), and `parse_atom` creates one atom per non-comma-non-brace token. A pathological input like `{a,b,c,d,…}` with ~65536 commas would panic. **DoS via panic.** See finding **T3-D**.
2. Line 770: `(*group).bubble_up_next = Some(i + 1);` where `i: u16`. If `i == u16::MAX` the addition overflows (debug-panic, release-wrap). Combined with #1 this is the same input class. Release-wrap to 0 would cause the bubble-up to restart from index 0 on return → **potential infinite loop in release**. **DoS-class.** Same finding T3-D.

These are **not memory-safety bugs**, but they trade input → process crash / hang. Worth noting.

### 2.4 `SmolList<T, N>` — `MaybeUninit`-backed inline small-vec

`parse.rs:4526-4868` defines `SmolList<T,N>` with an `Inlined { items: [MaybeUninit<T>; N], len: u32 }` variant. Four `unsafe` sites:

| Line | Code | Contract |
| ---- | ---- | -------- |
| 4550 | `from_raw_parts(self.items.as_ptr().cast::<T>(), self.len as usize)` | "first `len` elements are initialised" — established by `append` writing to `items[len]` before bumping `len` (line 4815). |
| 4555-4557 | `from_raw_parts_mut(self.items.as_mut_ptr().cast::<T>(), self.len as usize)` | Same. |
| 4569 | `self.items[i].assume_init_read()` inside `promote` | Loop body moves `INLINED_MAX` slots out at the unique call-site where `len == INLINED_MAX` (line 4810 `if inlined.len as usize == INLINED_MAX`). Sound. |
| 4603 | `self.items[self.len as usize - 1].assume_init_read()` inside `pop` | The comment says "caller guarantees `self.len > 0`". The single public exposed wrapper is `SmolList::pop` (line 4712) — also assumes `len > 0` (Heap variant `.unwrap()`s, Inlined variant calls into `SmolListInlined::pop`). **Both variants panic on empty pop, neither produces UB.** See below. |

Sub-point: **what happens on `SmolList::pop()` when `len == 0`?**

- `Heap` variant: `h.pop().unwrap()` — defined panic, no UB.
- `Inlined` variant: `i.pop()` → `self.items[self.len as usize - 1]` where `self.len == 0`. In debug, `0u32 - 1` panics with `attempt to subtract with overflow`. In release, it wraps to `u32::MAX`, cast to `usize` (which is also `u32::MAX` on 32-bit, or a very large 64-bit value on 64-bit). Then `self.items[that_idx]` — *but `self.items` is a fixed-size array `[MaybeUninit<T>; N]`*. Array indexing in Rust is **always bounds-checked**, regardless of `unsafe` context, unless the access is itself in `unsafe { *ptr.add(n) }` syntax. So we get a defined panic, not UB. **Verified: indexing `[MaybeUninit<T>; N]` with usize::MAX is a defined panic.**

Note however: the doc comment on line 4602 (`// SAFETY: caller guarantees self.len > 0; slot at len-1 is initialized.`) is **misleading**: the safety invariant for `assume_init_read` is *initialisation*, not non-empty. The fix would be to bounds-check `len > 0` explicitly before the subtraction, or simply call it `pop_unchecked` and not export it. **Cosmetic / robustness, not a UB-class finding.** See **T3-B**.

### 2.5 The lexer's bulk-scan fast path (line 2604-2645)

```rust
if ENCODING == StringEncoding::Ascii && self.chars.state == CharState::Normal {
    let scan = match &self.chars.src {
        Src::Ascii(a) => {
            let bytes = a.bytes;
            let start = a.i;
            let mut i = start;
            while i < bytes.len() && !SPECIAL_CHARS_TABLE.is_set(bytes[i] as usize) {
                i += 1;
            }
            if i > start { Some((bytes, start, i)) } else { None }
        }
        Src::Unicode(_) => None,
    };
    if let Some((bytes, start, i)) = scan {
        let run = &bytes[start..i];
        self.strpool.extend_from_slice(run);
        self.j += (i - start) as u32;
        if let Src::Ascii(a) = &mut self.chars.src { a.i = i; }
        ...
    }
}
```

This is **entirely safe code**. It walks the byte buffer and stops at the first byte in `SPECIAL_CHARS_TABLE`. Since the table is built from `SPECIAL_CHARS` *which includes `SPECIAL_JS_CHAR`*, the fast path correctly stops at a marker byte. The `(i - start) as u32` cast can wrap if the run is > 4 GiB — `j` is a `u32` index into the `strpool`. The runtime side allows `script` up to `Vec<u8>` length, which can exceed 4 GiB. **In a 4 GiB+ script, `self.j` overflows silently.** Theoretically a DoS / wrong-token vector but requires an actual 4-GiB shell command literal — *practically impossible*. Note for completeness; not graded.

### 2.6 Variable expansion (`$VAR`) and `$(cmd)` substitution

`eat_var` (`parse.rs:3818`) reads `[A-Za-z_][A-Za-z0-9_]*` after a leading `$`. Initial `=` returns immediately (terminates the var name). Initial digit makes it a *single-digit* positional ($1, $2, …) — the loop returns after the first digit. Loop body terminators include `{}[]; '" |&>,$` and the subshell-closing char. **No buffer-overflow risk** — strpool is an `ArenaVec<u8>` that grows as needed, and the loop terminates on any non-alphanumeric-non-underscore byte or EOF.

`$(cmd)` is dispatched through `eat_dollar` (search: `parse.rs:2890-2960` area) which spawns a sub-lexer via `make_sublexer(SubShellKind::Dollar)` and **caps recursion via `MAX_SUBSHELL_DEPTH = 128`** (line 2412, check at 3556). Backtick `` `cmd` `` and parens `(cmd)` use the same mechanism. **Bounded recursion — no stack-blowup DoS.**

### 2.7 Redirect parsing & fd-number handling

`eat_redirect_old` (`parse.rs:3406-3484`) reads an fd-number prefix into a 32-byte buffer, parses to `usize`, and accepts only `{0,1,2}`:

```rust
match num {
    0 => flags |= ast::RedirectFlags::STDIN,
    1 => flags |= ast::RedirectFlags::STDOUT,
    2 => flags |= ast::RedirectFlags::STDERR,
    _ => {
        log!("redirection to fd {} is invalid\n", num);
        return None;
    }
}
```

Arbitrary fds (e.g. `3>`) are explicitly rejected. The 32-byte digit buffer is bounded by an explicit `if count >= 32 return None`. **Sound.** No fd-injection vector.

### 2.8 Pipe handling (`|`)

The pipe lexer emits `Token::Pipe`. The parser pipeline (`parse_pipeline`, line 1153) creates a `Pipeline { items: &[PipelineItem] }`. **The lexer does not create pipe-fds — that's the interpreter's job.** The pipe-fd-creation pipeline lives in `runtime/shell/states/Pipeline.*` and is out of scope for this crate. From the parser's side, pipe is just a token; no UB risk.

### 2.9 Comment handling

Already analysed in §2.1. Single safe loop on `eat()`, terminates on `\n`. UTF-8-safe.

---

## 3. Tiered findings

### Tier definitions

- **T1**: provable memory-safety or correctness bug exploitable from a JS template literal.
- **T2**: contract narrowing required for soundness — currently OK in production but a foot-gun for future maintainers.
- **T3**: defensive-coding / DoS-class / cosmetic / robustness; no UB.

### Findings table

| ID | Tier | File:line | Summary | Adversarial input |
| -- | ---- | --------- | ------- | ----------------- |
| **T1** | — | — | **None found.** | — |
| **T2-A** | T2 | `braces.rs:36,99` | `SrcAscii.bytes: *const [u8]` and `SrcUnicode.iter: CodepointIterator<'static>` erase the lifetime of the input buffer. Current callers all consume the lexer before mutating/dropping the input, but the SAFETY comments rely on an undocumented caller contract. A maintainer who later (a) stores `SrcAscii` past the call frame, (b) holds an `Expansion` `&mut` borrow that mutates `current_out` while the lexer is alive, or (c) wires the braces lexer into a streaming consumer — would silently UAF. | None constructible against current code. Would require a future patch. |
| **T2-B** | T2 | `parse.rs:4601-4606 SmolListInlined::pop` | Doc says "caller guarantees `self.len > 0`" but the function is reachable from public `SmolList::pop` (line 4712) without that gate. Empty-pop on `Inlined` lands in `self.items[(0u32-1) as usize]` which is a defined array-index panic (not UB), so safety holds. The SAFETY comment is stronger than necessary and risks bit-rotting into a UB regression if someone later replaces the array-index with `get_unchecked`. | An `unsafe { i.items.get_unchecked(self.len as usize - 1).assume_init_read() }` patch would turn empty-pop into UB. |
| **T2-C** | T2 | `parse.rs:3644-3656 looks_like_js_*` | The off-by-one length check `if PREFIX.len() - 1 >= bytes.len() return false` rejects exact-length matches as "doesn't look like a marker". This is conservative for these callers (which need digits after the prefix anyway) but the symmetric `matches_ascii_literal` (line 3695-3701) uses the same idiom and is *also* used outside the marker path (line 3408-3409: `matches_ascii_literal(b"2>&1")`). On an input that ends EXACTLY in `2>&1` with no trailing byte, `matches_ascii_literal` returns false. This silently misses a valid redirect at end-of-input. **Behavioural bug, not safety.** Adversarial input: `` Bun.$`echo hi 2>&1` `` with no trailing space/newline. (Worth verifying — see T3-E.) | `` Bun.$`x 2>&1` `` |
| **T3-A** | T3 | `braces.rs:33-36` | The Clone derive on `SrcAscii` copies the raw pointer. If anyone clones an iterator that outlives the source buffer, UAF. Today no callers do this, but the derive should be removed or replaced with an explicit method that re-validates. | Construct-only; no JS surface. |
| **T3-B** | T3 | `parse.rs:4601` | `pop` on empty `SmolListInlined` is a defined panic but is reachable from public callers without a `len > 0` guard. Recommend either `debug_assert!(self.len > 0)` in the function body or renaming to `pop_unchecked`. | n/a — DoS via panic. |
| **T3-C** | T3 | `parse.rs:2624` | `self.j += (i - start) as u32` in the bulk-scan fast path can silently wrap on a `> 4 GiB` script. Practically unreachable but architecturally fragile. | A 4-GiB shell command literal. |
| **T3-D** | T3 | `braces.rs:754,770` `expand_nested` | `u16::try_from(i_).expect("int cast")` panics on > 65535 atoms in one Group, and `i + 1` overflow on `i == u16::MAX` causes debug-panic / release-wrap (potential infinite bubble-up in release). DoS via crafted brace expansion. | `` Bun.$`echo {${'a,'.repeat(65536)}}` `` — but the *runtime-side* `current_out` buffer would also need to fit, and the lexer's `tokens.len() <= u16::MAX` check at `build_expansion_table:1163` blocks the flat path. The nested path (`expand_nested`) uses Parser-built Groups directly and lacks an equivalent cap. |
| **T3-E** | T3 | `parse.rs:3408, 3695-3700` | `matches_ascii_literal` rejects exact-length matches via `if literal.len() >= bytes.len() return false`. For a script that ends exactly on `2>&1` (no trailing byte), the `eat_redirect_old` precheck on line 3408 returns false and the redirect is parsed via the slower per-digit path — which works correctly but emits different token shapes. **Behavioural inconsistency, not UB.** | `` Bun.$`x 2>&1` `` |

---

## 4. Adversarial input table — what I tried, what survived

Each row below is a concrete `Bun.$` template literal I evaluated against the lexer/parser flow on paper. For each, I traced the bytes through `shell_cmd_from_js → script: Vec<u8> → Lexer::lex` and noted the resulting token stream / failure mode.

| # | Input | Hypothesis | Result |
| - | ----- | ---------- | ------ |
| 1 | `` Bun.$`cat ${userInput}` `` with `userInput = "; rm -rf /"` | Metachar injection from interpolation | `needs_escape_bunstr` sees `;` and ` ` in `SPECIAL_CHARS_TABLE` → routes through `append_js_str_ref` → marker → single argv word `"; rm -rf /"`. **Blocked.** |
| 2 | `userInput = "\x00malicious"` | Null-byte injection | `append_js_value_str` at `shell_body.rs:1006` explicit `index_of_ascii_char(0)` check → throws `INVALID_ARG_VALUE`. **Blocked.** |
| 3 | `userInput = "\x08__bunstr_0"` (literal sentinel) | Forge another interpolation marker | `\x08 ∈ SPECIAL_CHARS_TABLE` → `needs_escape_bunstr → true` → marker path → stored in `string_refs[N]` for some N, NOT inlined. Regression-tested. **Blocked.** |
| 4 | `userInput = "\x08__bunstr_9999"` | OOB read on `string_refs` | Same as #3 plus index-overflow check. Even if user could somehow inject raw, `validate_js_string_ref_idx` checks bounds. Regression-tested (`shell-sentinel-hardening.test.ts:28`). **Blocked.** |
| 5 | `` Bun.$`echo ${userInput}` `` with `userInput = "$(rm -rf /)"` | Command-substitution injection via `$` and `()` | `$`, `(`, `)` all in `SPECIAL_CHARS_TABLE` → marker path → single argv word. **Blocked.** |
| 6 | `userInput = "\`rm -rf /\`"` | Backtick command-substitution injection | `` ` `` in `SPECIAL_CHARS_TABLE` → marker path. **Blocked.** |
| 7 | `userInput = "\\"` (single backslash) | Escape-char manipulation | `\` in `SPECIAL_CHARS_TABLE` → marker path. **Blocked.** |
| 8 | `userInput = "$IFS"` | Variable expansion abuse | `$` in `SPECIAL_CHARS_TABLE` → marker path → no expansion. **Blocked.** |
| 9 | `userInput = "a\tb"` (literal tab) | Tab as word separator | `\t` is **NOT** in `SPECIAL_CHARS_TABLE`. The user string takes the inlined-raw path. **However**, the lexer's main word-break logic also treats only space (line 3129) and newline (line 2813) as delimiters — tab is NOT a delimiter. So `a\tb` becomes a single argv word `a\tb`. **No injection — semantically a tab inside an argv word.** |
| 10 | `userInput = "x\rd"` (CR injection) | Embed CR | `\r` is not in `SPECIAL_CHARS_TABLE`. Same as #9: stays a literal byte in a single argv word. No injection. |
| 11 | `userInput.startsWith("\x08")` AND `userInput.endsWith("__bun_")` | Spoof partial marker | Same as #3 — `\x08` triggers escape. **Blocked.** |
| 12 | `` Bun.$`{${'a,'.repeat(65536)}}` `` | Brace-expansion DoS | `expand_nested` would panic on `u16::try_from(i_)` at `braces.rs:754`. **DoS class.** See T3-D. |
| 13 | `` Bun.$`${{}}` `` (object as interpolation) | Object-coercion path | `shell_body.rs:899-960` falls through `is_array`/Blob/ReadableStream/Response/string checks. The unhandled object branch is `Err(global.err(jsc::ErrorCode::INVALID_ARG_VALUE, …))`. **Blocked.** |
| 14 | `` Bun.$`cat ${largeBinaryString}` `` with very long string (~2GiB) | Memory exhaustion / int wrap | The lexer's `j: u32` (`parse.rs:2470`) is the index into `strpool`. A user string > 4 GiB inlined via `append_js_str_ref` doesn't trigger the wrap (the bytes live in `string_refs`, not `script`). A user string of 4 GiB *raw* (not requiring escape) is appended via `append_utf8_impl` (`shell_body.rs:1086`) into `outbuf`. Total `script.len()` could exceed `u32::MAX`. **Potential `j` overflow** — but the lexer would `panic!("int cast")` in `add_error` (line 2525) long before reaching it on a non-error path the integer-cast is at line 2521-2526 only in `add_error`. The main `self.j += 1` increments are *not* int-cast-guarded; a wrap would just produce wrong `TextRange.start/end` in tokens. **Behavioural corruption on > 4 GiB scripts; not UB.** |
| 15 | Multi-byte UTF-8 char split across a `${...}` boundary | Partial-read of codepoint | Each template-raw part is a complete JS string passed to `append_utf8` / `append_latin1_impl`. The JS engine cannot split a codepoint across template parts (template strings are JS strings, codepoint-coherent). The interpolation marker is inserted at JS-string boundaries (between raw parts), which are always codepoint boundaries. **No split-codepoint risk.** |

---

## 5. Negative findings — things explicitly cleared

### 5.1 SPECIAL_CHARS_TABLE includes SPECIAL_JS_CHAR

`parse.rs:4376`: `SPECIAL_JS_CHAR` is the last entry in `SPECIAL_CHARS`. `SPECIAL_CHARS_TABLE` (line 4390) is a `[bool; 256]` built at const-time from that array. `needs_escape_utf8_ascii_latin1` (line 4514) returns `true` if any byte in the input maps to `true` in the table. **Confirmed: any byte 0x08 in a user-interpolated string forces marker-replacement.** Without this membership, a user could write `"\x08__bunstr_0"` as a string and the runtime would inline it raw, causing the lexer to re-interpret bytes from `string_refs[0]` as if they were *that* user's input. This was the historical bug fixed by including `\x08` in `SPECIAL_CHARS` (see `shell-sentinel-hardening.test.ts` comment).

### 5.2 Null-byte rejection on user strings

`shell_body.rs:1006-1017`: `append_js_value_str` does `bunstr.index_of_ascii_char(0)` and throws `INVALID_ARG_VALUE` if a null byte is present. Same check at `shell_body.rs:830-838` for Blob file paths. **A user-supplied string cannot contain a NUL byte.** This protects argv construction (POSIX argv strings are NUL-terminated).

### 5.3 Bounded subshell recursion

`MAX_SUBSHELL_DEPTH = 128` enforced at `parse.rs:3556`. A pathological `$($($($(...))))` cannot blow the stack.

### 5.4 Bounded fd-number parsing

`parse.rs:3422` `if count >= 32 return None`. fd numbers limited to 32 digits. Then accepted only if value is 0/1/2 (line 3440-3449).

### 5.5 Bounded marker-index parsing

`parse.rs:3720` `if digit_buf_count as usize >= digit_buf.len() return None`. 32-digit buffer for the marker decimal index.

### 5.6 `expand_nested` raw-pointer recursion is sequentially sound

Each `(*group).field = x` is a transient field-write through `*mut Group`. No long-lived `&mut Group` borrows. The bubble-up recursion's `(*root).bubble_up_next` re-entry reads through `*mut Group` only when the previous recursive call has returned. **No concurrent aliasing.**

### 5.7 `SrcUnicode::next` does not read past the input buffer

`bun_core::string::immutable::unicode.rs:260-273` copies into a zero-padded 4-byte stack buffer before decoding, so truncated multi-byte leads at EOF become U+FFFD, not OOB.

### 5.8 The JSON debug formatter (`json_fmt.rs`) is `unsafe`-free

Pure-safe code. The two `unsafe` blocks in `braces.rs::ast_to_json` / `ast_atom_to_json` deref `*mut [T]` slices that are guaranteed to be live at JSON-emission time (the arena/Vec storing them is the same one that built the AST).

### 5.9 Comment handling is UTF-8 safe

`eat_comment` loops on codepoint-level `self.eat()`, not byte-level. A multi-byte UTF-8 character cannot be partially read because the decoder always returns a complete codepoint or `None`.

### 5.10 Sentinel rejection is regression-tested

`test/js/bun/shell/shell-sentinel-hardening.test.ts` is a dedicated regression suite that already exercises the most adversarial inputs (`"\x08__bun_abc"`, `"\x08__bunstr_abc"`, sentinel injection via `{ raw: ... }` with OOB index 9999).

---

## 6. Tiered totals

| Tier | Count | IDs |
| ---- | ----- | --- |
| **T1** (memory-safety bug with adversarial-input proof) | **0** | — |
| **T2** (contract narrowing / soundness foot-gun) | **3** | T2-A, T2-B, T2-C |
| **T3** (DoS, defensive-coding, cosmetic) | **5** | T3-A, T3-B, T3-C, T3-D, T3-E |
| **Negative** (explicitly cleared) | **10** | §5.1–§5.10 |

**T1 count: 0.**

The crate is a faithful port of well-trodden Zig shell-lexer logic, and the security-critical invariants (sentinel escape, null-byte rejection, marker-index bounds, subshell-depth cap, fd-number cap, marker-index digit-buffer cap) are intact and regression-tested. The only `unsafe fn` (`expand_nested`) is reasoned to be sound under bumpalo's allocation-disjointness invariant. The `MaybeUninit`-backed `SmolList` is sound under Rust's defined-behaviour rules for array indexing (panic, not UB).

---

## 7. Methodology notes (for reviewer)

- **Files actually read with context:** the entirety of `braces.rs`, `lib.rs`, `json_fmt.rs`; ~85% of `parse.rs` (skipped: deep parser-pipeline rules in lines 1259-2200 and 2950-3500 that contain no `unsafe`, no integer casts of attacker-controlled bytes, and no pointer manipulation — these are pure AST construction). All 12 `unsafe` blocks were read with ≥25 lines of surrounding context as required. All `try_from(...).expect("int cast")` sites in `parse.rs` were enumerated and the source of the cast value traced.
- **Cross-crate verification:** `shell_body.rs` (out-of-crate) read for the runtime adapter that constructs the lexer input; `Expansion.rs` and `BunObject.rs` read for the two callers of `braces::Lexer::tokenize` / `braces::expand`.
- **Adversarial-input proofs:** 15 distinct adversarial template literals constructed and traced (table §4). Of those, 12 were unambiguously blocked by existing checks, 1 hits a documented foot-gun (#9, tab in argv word — semantically intentional), 1 is a > 4 GiB script (#14, behavioural corruption only), 1 is a brace-expansion DoS (#12 / T3-D).
- **No T1 finding was claimed without a constructed adversarial input.** The prompt's discipline rule was the binding constraint: every candidate finding was either escalated, downgraded, or dropped.
- **What I deliberately did NOT find:** common unsafe-Rust gotchas that don't apply here — there's no `transmute`, no Pin, no Send/Sync impl, no FFI-callback `*mut Self` aliasing (the `unsafe fn expand_nested` is internal to the crate, never crosses an FFI boundary, and never executes on another thread).

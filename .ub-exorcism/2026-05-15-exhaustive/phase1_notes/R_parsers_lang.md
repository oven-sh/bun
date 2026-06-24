# Section R: parsers-and-lang

## Purpose (1 paragraph)

Section R is Bun's entire "bytes-to-AST" frontend plus its lockfile-adjacent
string interning, executable-format readers, path resolution, glob walking, and
the SIMD-UTF FFI shim. Twenty-five crates compile every language Bun handles
(JavaScript/TypeScript/JSX, CSS, JSON, YAML, INI, .env, bunfig, Markdown,
shell, glob), maintain source-map/sourcemap-jsc plumbing, and own the Bun
package-manager's semver string-pool plus the standalone-binary PE/Mach-O
readers. Concurrency is mostly absent (single-threaded parses); the exceptions
are the resolver's thread-local `Bufs` scratch, the `FileSystem`/`BIN_FOLDERS`
process-singletons, the css `'bump`-erasure transmutes, and the
`sourcemap_jsc::CodeCoverage` thread-local UnsafeCell map. Attacker influence
is real: every byte through the JS/CSS/JSON/YAML/lockfile/package.json/PE
header surface is untrusted, and the dominant UB priors are validity (lexer
bytes) and out-of-range `get_unchecked` indices derived from lexer/lockfile
state. EXP-008 and EXP-009 (the `bun_semver::String::{slice,eql}` packed
`(off, len)` `get_unchecked` OOB) now have standalone release-mode Miri
witnesses for forged `String` handles. The helper-level UB primitive is
confirmed; crafted-lockfile reachability is still the refinement question until
Phase 3/5 proves a current binary-lockfile load path imports attacker-controlled
packed `String` bytes rather than reconstructing them through checked `Builder`
APIs.
Codex review added **EXP-021** for a separate `bun_ast` issue: safe
lifetime-erased Store wrappers (`StoreRef`, `StoreStr`, `StoreSlice<T>`) can
return references with caller-chosen lifetimes from raw arena pointers. The
parser may use them in a disciplined arena-only way, but the safe API shape is
unsound and is Miri-confirmed in `experiments/EXP-021`.

## Per-crate unsafe-surface tally (vs prior subtotals)

| crate | sites (now) | prior | dominant_kind | dominant_bucket |
| --- | --- | --- | --- | --- |
| bun_js_parser | 57 | 49 | `mem::forget` + arena-aware `set_len` | 12 (lib invariants), 20 (Box pairing) |
| bun_js_parser_jsc | 22 | 21 | ptr→`&mut` at JSC callback boundary | 1, 21 |
| bun_js_printer | 24 | 24 | bytemuck NoUninit/Pod impls | 4, 5, 6 |
| bun_ast | 46 | 27 | StoreRef raw-ptr ABI + Send/Sync | 8, 12, 15 |
| bun_ast_jsc | 0 | 0 | — | — |
| bun_css | 125 | 116 | arena `'bump`-erasure + ident interner | 6, 15 (lifetime stretch) |
| bun_css_derive | 1 | 0 | proc-macro emission | n/a (macro itself) |
| bun_css_jsc | 3 | 3 | `detach_lifetime_ref` arena lifts | 15 |
| bun_shell_parser | 11 | 11 | SmolListInlined MU buffer | 5 (uninit), 12 |
| bun_parsers | 30 | 28 | JSON/YAML lexer | 4 (validity), 15 |
| bun_ini | 8 | 8 | raw `&mut *head` rope walks | 1, 12 |
| bun_dotenv | 4 | 2 | libc cstr + lifetime detach | 10, 15 |
| bun_bunfig | 6 | 6 | raw log/graph deref at CLI boundary | 1, 12 |
| bun_md | 14 | 14 | VerbatimLine ↔ raw bytes | 3 (alignment!), 6, 12 |
| bun_sourcemap | 68 | 63 | VLQ + pending-buf get_unchecked | 5, 12, 15, 20 |
| bun_sourcemap_jsc | 23 | 20 | coverage UnsafeCell + Bake FFI | 1, 8, 10, 21 |
| bun_semver | 12 | 12 | **EXP-008/009 packed-Pointer get_unchecked** | **4, 15, 25** |
| bun_semver_jsc | 0 | 0 | — | — |
| bun_exe_format | 52 | 51 | **PE SectionHeader unaligned reads** | **3** (alignment), 10 |
| bun_glob | 5 | 5 | raw ZStr from path-buf scratch | 4, 15 |
| bun_router | 42 | 34 | path-buf reslicing + param-byte newtype | 15 |
| bun_resolver | 232 | 182 | FileSystem/BIN_FOLDERS singletons + Bufs threadlocal | 1, 5, 7, 8 |
| bun_resolve_builtins | 0 | 0 | — | — |
| bun_unicode | 0 | 0 | — | — |
| bun_simdutf_sys | 52 | 50 | `unsafe extern "C"` + caller-API wrappers | 10, 25 |

**Total: 826 sites** vs prior `~726` → **+100 delta**, concentrated in
`bun_resolver` (+50), `bun_ast` (+19), `bun_css` (+9), and `bun_router` (+8).
No crate shrank meaningfully.

## bun_semver anchor status (EXP-008 + EXP-009)

Codex Phase-5 update: `experiments/EXP-008` and `experiments/EXP-009` both
trip release-mode Miri (`debug_assert!` disabled, matching production). The
remaining question is exploitability through the binary lockfile reader, not
whether the helpers can form OOB slices from a forged packed value.

- **File implementing `String::slice`:** `src/semver/lib.rs:586-616`
  ```rust
  pub fn slice<'a>(&'a self, buf: &'a [u8]) -> &'a [u8] {
      match self.bytes[Self::MAX_INLINE_LEN - 1] & 128 {
          0 => { /* inline-string path */ }
          _ => {
              let ptr_ = self.ptr();
              let (off, len) = (ptr_.off as usize, ptr_.len as usize);
              debug_assert!(off + len <= buf.len());
              // SAFETY: Pointer {off,len} is constructed by `init`/`init_append` from a
              // sub-slice of `buf` and is only ever projected back into the same buffer
              // (Zig: `buf[ptr.off..][0..ptr.len]`, unchecked in ReleaseFast).
              unsafe { buf.get_unchecked(off..off + len) }
          }
      }
  }
  ```
- **File implementing `String::eql`:** `src/semver/lib.rs:520-540`
  ```rust
  pub fn eql(self, that: String, this_buf: &[u8], that_buf: &[u8]) -> bool {
      if self.is_inline() && that.is_inline() { /* … */ }
      else if self.is_inline() != that.is_inline() { false }
      else {
          let a = self.ptr(); let b = that.ptr();
          let (a_off, a_len) = (a.off as usize, a.len as usize);
          let (b_off, b_len) = (b.off as usize, b.len as usize);
          debug_assert!(a_off + a_len <= this_buf.len());
          debug_assert!(b_off + b_len <= that_buf.len());
          strings::eql(
              unsafe { this_buf.get_unchecked(a_off..a_off + a_len) },
              unsafe { that_buf.get_unchecked(b_off..b_off + b_len) },
          )
      }
  }
  ```
- **Packed `(off, len)` decode shape:** `Pointer { off: u32, len: u32 }` at
  `src/semver/lib.rs:866-869`. `Pointer::from_bits` (`:897-903`) decomposes the
  low 32 bits as `off` and the high 32 bits as `len`. `String::ptr()`
  (`:574-580`) masks the tag bit (1<<63) before passing to `from_bits`. The
  caller `slice(buf)` / `eql(that, this_buf, that_buf)` then `get_unchecked`s
  `off..off+len` against the caller-supplied buffer. **Shape STILL APPLIES**;
  unchanged since prior audit. Helper-level verdict: **CONFIRMED_UB** by
  `experiments/EXP-008` / `EXP-009`. Integration verdict: still needs a
  crafted binary-lockfile path with attacker-controlled packed string bytes.
- **Caller surface:** many install paths later call
  `String::slice(lockfile.buffers.string_bytes)` or `String::eql(..., buf, buf)`
  (for example `src/install/PackageInstaller.rs` and
  `src/install/lockfile.rs`). Text lockfile and package-manifest paths commonly
  create these handles through `StringBuilder::append_with_hash`, which derives
  `off/len` from an in-bounds subslice. Those paths are useful reachability
  context, but they do **not** by themselves prove attacker control of arbitrary
  packed `off/len` bytes. The Phase 3 question is narrower: does the current
  binary lockfile reader import raw `bun_semver::String` values from disk and
  later project them with `slice`/`eql` without range checking? If yes, EXP-008/9
  should promote. If all current load paths reconstruct through `Builder`, this
  remains an unsafe-contract trap rather than a confirmed crafted-lockfile bug.

## JSON lexer post-#30679

- **Lexer file:** `src/parsers/json_lexer.rs`; auto-quote-recovery path lives
  at `:1295-1322`. The diff for commit `314d044c0a` (`git show
  314d044c0a -- src/parsers/json_lexer.rs`) is pure-safe: it relocates
  `*`/`?`/`(`/`)` from the eager-error arm to a new arm that calls
  `self.step()` + sets `T::TSyntaxError`, letting `JSONLikeParser::parse_expr`'s
  retry path run with a `step()`-advanced cursor. The diff comment at
  :1296-1313 explicitly documents why the dedicated arm (rather than the
  catch-all) is needed for `parse_string_literal_inner::<0>()`'s leading
  `step()` invariant.
- **New unsafe sites introduced:** **NONE.** Zero unsafe blocks added, removed,
  or moved by this commit (verified via `git show`).
- **Pre-existing unsafe in `json_lexer.rs`** (relevant to the auto-quote retry
  path): the retry path rebuilds a `Lexer` via the `log_ptr()` escape hatch
  (`:340-342`), which intentionally returns the `*mut Log` without forming a
  second `&mut` provenance chain (covered by the struct doc; this is the
  documented mitigation for the JSON-retry-aliasing hazard). The five other
  unsafe sites (`:210, :333, :575, :836, :967`) are unchanged and not in the
  edited region.

## Parser get_unchecked audit

Every `get_unchecked` / `get_unchecked_mut` across Section R, with bounds-check
context:

- `src/js_parser/lexer.rs:1198` — `unsafe { *contents.get_unchecked(self.current) }`.
  `self.current < len` checked at `:1193`. JS lexer per-codepoint dispatch;
  attacker-controlled byte stream via `.js`/`.ts`/`.tsx`/`.jsx` source. Sound
  by inspection.
- `src/css/selectors/parser.rs:65` — `unsafe { v.push(core::ptr::read(src.get_unchecked(i))) }`.
  Inside `0..len` loop where `len = sl.len()` (SmallList live-slice len);
  paired with `sl.set_len(0)` at `:68` to avoid double-drop. Sound.
- `src/sourcemap/InternalSourceMap.rs:1007-1011` — five
  `pending_*.get_unchecked_mut(i)` calls; `i < SYNC_INTERVAL` invariant
  documented in SAFETY at `:1002-05`, `debug_assert!` at `:1001`, and the
  loop's flush gate at `:1016` reaches in lock-step. Sound by invariant; the
  invariant is private to `append_mapping` so no external entry can violate it.
- `src/semver/lib.rs:536` — **EXP-009-A** `this_buf.get_unchecked(a_off..a_off + a_len)`
- `src/semver/lib.rs:537` — **EXP-009-B** `that_buf.get_unchecked(b_off..b_off + b_len)`
- `src/semver/lib.rs:613` — **EXP-008** `buf.get_unchecked(off..off + len)`
  All three trust `(off, len)` decoded from a packed u64 in `String::bytes`.
  The `debug_assert!`s are stripped in release, so a corrupted handle is an OOB
  slice primitive. The remaining proof obligation is reachability: Phase 3/5
  must show whether current binary-lockfile loading can materialize such a
  corrupted handle from attacker-controlled bytes, or whether all live load
  paths reconstruct handles through checked `Builder` APIs.

No other `get_unchecked` calls exist in Section R.

## Notable patterns

1. **Arena lifetime-stretch transmute** (`'_ → 'static`): 7 sites in `bun_css`
   and `bun_resolver`. The pattern (`mem::transmute::<X<'_>, X<'static>>` or
   `bun_ptr::detach_lifetime_ref`) is consistently used to capture an arena
   borrow inside an `'static` callback (typically a JSC entry-point closure).
   Sound iff the closure outlives the arena, which the closure machinery
   guarantees. Worth a Phase 3 sweep to confirm none leaks the widened ref
   past arena reset.
2. **bytemuck `NoUninit`/`Pod`/`Zeroable` impls** (`bun_js_printer`,
   `bun_exe_format::macho_types`): 8 sites. Each requires the type have no
   padding and no validity invariants. `js_printer/lib.rs`'s `FetchParameters`
   and `RecordKind` would be easy to break if a field is added without
   `#[repr(C)]` or with a `bool`/`NonZero*` member. Phase 3: add a bytemuck
   `static_assertions::assert_impl_all!` test.
3. **Raw `*mut Log` / `*mut Graph` derefs at the CLI boundary**
   (`bun_bunfig::arguments.rs`, `bun_ini::lib.rs`, `bun_dotenv::env_loader.rs`,
   `bun_parsers::json_lexer.rs`): ~15 sites where the parser borrows are erased
   to raw pointers to satisfy the multi-arm retry/reparse pattern (originally
   Zig-style `*Log`). The discipline relies on no parser holding `&mut Log`
   across the boundary, which is documented but unenforced. The
   `Lexer::log_ptr()` escape hatch at `parsers/json_lexer.rs:340` is the
   canonical right shape; the bunfig sites are looser.

## Open questions

- **Question 1 (Phase 3):** Is `bun_resolver::lib.rs:897-898`'s `unsafe impl
  Send/Sync for EntriesOption` a duplicate of `fs.rs:1836/1837` or a
  different type? If duplicate, it should be removed; if different, both need
  named SAFETY narratives (currently missing on the lib.rs pair).
- **Question 2 (Phase 3, alignment):** `pe.rs:289/301` carry a TODO acknowledging
  potential unaligned `SectionHeader` reads. Does the writer side
  (`macho.rs:122/691/753`) actually align the section table offset? PE files
  on disk align to 512-byte boundaries; once we sort out alignment, the cast
  becomes sound. Miri symbolic-alignment-check will tell us.
- **Question 3 (EXP-008/009 integration reproducer):** Where is the smallest current-source
  call chain, if any, from a crafted binary lockfile to a raw
  `bun_semver::String` handle whose `bytes` contain attacker-chosen
  `off=0xFFFF_FFFE, len=...`? If none exists, the right fix is still to make
  `String::slice`/`eql` checked or typed-by-construction, but the public claim
  should be "unsafe-contract trap" rather than "confirmed crafted-lockfile UB."
- **Question 4 (CSS module export transmute):** `css_parser.rs:2718/2723` extend
  exports/references to `'static` because the result type carries that
  placeholder. Is there a phase-B port note for re-threading the real
  `'bump` lifetime? If not, this is permanent UB if any consumer touches the
  references after the arena resets.
- **Q5 (glob ZStr SAFETY gap):** `glob/GlobWalker.rs:600/607/995` form
  `ZStr::from_raw` without explaining the NUL-termination invariant of the
  source `path_buf`. PathBuffers in `bun_paths` are guaranteed NUL-padded —
  but the SAFETY comment is absent. Mechanical bead.
- **Q6 (EXP-021 Store wrapper lifetime escape):** Is the intended remediation a
  full `StoreSlice<'arena, T>` / `StoreStr<'arena>` / `StoreRef<'arena, T>`
  lifetime thread-through, or a smaller unsafe-boundary patch that makes
  `slice<'a>`, `slice_mut<'a>`, and the lifetime-erasing constructors `unsafe`?
  The current safe API lets arbitrary safe callers construct dangling
  references; internal parser discipline is not enough to make the public
  methods sound.

## Anchor cross-refs

- **EXP-008** → `src/semver/lib.rs:586-616` (`String::slice`), prior ID
  `S-009716`. Caller graph includes install code that projects stored semver
  strings against `lockfile.buffers.string_bytes`. Verdict:
  **CONFIRMED_UB helper primitive** by release-mode Miri; crafted-lockfile
  control of packed `off/len` remains to be proven.
- **EXP-009** → `src/semver/lib.rs:520-540` (`String::eql`), prior IDs
  `S-009714, S-009715`. Same caller surface. Verdict:
  **CONFIRMED_UB helper primitive** by release-mode Miri; two distinct
  `get_unchecked` sites (a-side and b-side); crafted-lockfile control remains
  to be proven.
- **JSON-lexer post-#30679** → safe-only refactor; no new unsafe; auto-quote
  retry still feeds through the documented `log_ptr()` escape hatch.

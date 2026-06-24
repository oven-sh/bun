# Section R: parsers-and-lang — Phase 1 Unsafe-Surface Inventory

Format (per row): `file:line | site_kind | bucket(s) | safety_status | macro_status | prior_audit_id | notes`

Buckets: 1 aliasing, 2 provenance, 3 alignment, 4 validity, 5 uninit, 6 transmute,
7 races, 8 Send/Sync, 9 Pin, 10 FFI, 12 library-trait invariants, 13 ZST tricks,
14 *const→write, 15 lifetime/escape OOB, 17 atomic ordering, 20 dangling Box/allocator,
21 FFI callback aliasing, 23 observed type changes, 25 caller-API contract.

This file enumerates the highest-signal sites per crate (anchored, hazardous, or
representative); per-crate mapper-local counts and dominant kinds are in
`phase1_notes/R_parsers_lang.md`. The row table is intentionally not a 1:1
site listing: boilerplate Zig-port raw-deref sites are summarised as groups,
and Phase 2 should re-normalize any count used for public headline math.

## bun_semver — EXP-008 / EXP-009 anchors (HIGHEST SIGNAL)

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/semver/lib.rs:536` | unsafe_block `get_unchecked` | 15+4+25 | PRESENT_STRONG (532-534) | SOURCE_DIRECT | S-009714 | **EXP-009 anchor `String::eql`** — `this_buf.get_unchecked(a_off..a_off+a_len)`; `a_off,a_len` decoded from packed u64 in `bytes`; debug_assert at :530; helper UB Miri-confirmed in release mode |
| `src/semver/lib.rs:537` | unsafe_block `get_unchecked` | 15+4+25 | PRESENT_STRONG (532-534) | SOURCE_DIRECT | S-009715 | **EXP-009 anchor `String::eql`** — `that_buf.get_unchecked(b_off..b_off+b_len)`; same shape; debug_assert at :531; helper UB Miri-confirmed in release mode |
| `src/semver/lib.rs:613` | unsafe_block `get_unchecked` | 15+4+25 | PRESENT_STRONG (609-612) | SOURCE_DIRECT | S-009716 | **EXP-008 anchor `String::slice`** — `buf.get_unchecked(off..off+len)`; debug_assert at :608; SAFETY cites Zig ReleaseFast invariant; helper UB Miri-confirmed in release mode |
| `src/semver/SemverQuery.rs:131-132` | unsafe_impl Send/Sync | 8 | MISSING | SOURCE_DIRECT | S-009717/8 | `List` carries refcell pointers; no SAFETY narrative |
| `src/semver/SemverQuery.rs:261-262` | unsafe_impl Send/Sync | 8 | MISSING | SOURCE_DIRECT | S-009719/20 | `Group` shape mirrors `List` |
| `src/semver/Version.rs:*` | unsafe_block (6 sites, mostly arena `from_raw_parts`) | 15+2 | PRESENT_WEAK | SOURCE_DIRECT | S-009721..6 | tagged-string / Tag refs into the same lockfile buf |

## bun_parsers — JSON lexer post-commit 314d044c0a

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/parsers/json_lexer.rs:210` | unsafe_block `&mut *self.log` | 1+12 | MISSING (impl), references struct doc | SOURCE_DIRECT | S-004341 | Trait-impl version; struct doc covers it but trait method itself has no `// SAFETY` |
| `src/parsers/json_lexer.rs:333` | unsafe_block `&mut *self.log` | 1+12 | PRESENT_STRONG (:330-332) | SOURCE_DIRECT | S-004342 | Public `log_mut` — names provenance-singleton invariant |
| `src/parsers/json_lexer.rs:340` | function `log_ptr` (escape hatch) | 1+2 | PRESENT_STRONG (struct doc) | SOURCE_DIRECT | n/a | Raw `*mut Log` for `MAYBE_AUTO_QUOTE` retry — feeds new `Lexer::init` without forming a 2nd `&mut` chain |
| `src/parsers/json_lexer.rs:575` | unsafe_block `slice::from_raw_parts` (u8→u16) | 3+5+6+15 | PRESENT_STRONG (:572-574) | SOURCE_DIRECT | S-004343 | UTF-16 reinterpret of raw byte slice; SAFETY notes JSON path never sets Utf16 — only JSX rescan does. Alignment depends on rescan source |
| `src/parsers/json_lexer.rs:836` | unsafe_block `str::from_utf8_unchecked` | 4 | PRESENT_STRONG (:835) | SOURCE_DIRECT | S-004344 | "scanned bytes are ASCII digits/underscores" — pre-validated by lexer scan |
| `src/parsers/json_lexer.rs:967` | unsafe_block `str::from_utf8_unchecked` | 4 | PRESENT_STRONG (:966) | SOURCE_DIRECT | S-004345 | "scanned bytes are ASCII (digits/./e/+/-)" — pre-validated |
| `src/parsers/json_lexer.rs:1298-1322` | safe-only diff in commit 314d044c0a | n/a | n/a | SOURCE_DIRECT | n/a | **No new unsafe introduced** by auto-quote-recovery change; switches `*`/`?`/`(`/`)` from eager error to `T::TSyntaxError` after `self.step()` |
| `src/parsers/json.rs:849/853/857` | unsafe_block `StoreRef::from_raw` | 12+25 | PRESENT_STRONG (:847-848) | SOURCE_DIRECT | n/a | Empty-singleton StoreRef bypass — explains `T: !Sync` constraint |
| `src/parsers/yaml.rs:1783` | unsafe_block `from_raw_parts<u16>` | 3+5+6 | PRESENT_WEAK | SOURCE_DIRECT | n/a | YAML scalar UTF-16 reinterpret; same alignment hazard as json_lexer:575 |
| `src/parsers/yaml.rs:4224` | unsafe `from_raw(u8)` Level enum | 4 | MISSING | SOURCE_DIRECT | n/a | YAML IndentIndicator; checked via TryFrom path? Verify in phase 3 |

## bun_js_parser — Lexer get_unchecked + parser scope discipline

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/js_parser/lexer.rs:1198` | unsafe_block `get_unchecked` | 15 | PRESENT_STRONG (:1197) | SOURCE_DIRECT | S-* | **Sole `get_unchecked` in JS lexer**; `self.current < len` checked at :1193; index from attacker-influenced JS source |
| `src/js_parser/parse/parse_entry.rs:60` | unsafe `MaybeUninit::assume_init_drop` (guard arm) | 5 | PRESENT_STRONG (:50-58) | MACRO_GENERATED (parse_entry macro) | n/a | Arming `scopeguard::guard` only after init; comment explicitly warns: "unsafe to arm before init" |
| `src/js_parser/parse/parse_entry.rs:427/573/669/769` | unsafe `MaybeUninit::assume_init_mut/_ref` | 5 | PRESENT_WEAK | MACRO_GENERATED | n/a | Per-flavour parser entry trampolines; init proven by prior body |
| `src/js_parser/parse/parse_entry.rs:890` | unsafe (set_len + bitwise copy) | 1+5+12 | PRESENT_WEAK | MACRO_GENERATED | n/a | "ownership transferred into parts via bitwise copy + set_len(0)" — arena-aware drop discipline |
| `src/js_parser/p.rs:8453/8475/8493/8515` | unsafe `mem::forget(part)` cluster | 12+20 | MISSING / WEAK | SOURCE_DIRECT | S-* | TS namespace flattening; arena-aware to suppress double-free against later `set_len(parts_end)` at :8533 |
| `src/js_parser/lib.rs:384-385` | unsafe_impl Send/Sync for `DefineData` | 8 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Define table refs |
| `src/js_parser/defines_table.rs:208/210` | unsafe_impl Sync/Send `SyncDefineData` | 8 | PRESENT_STRONG (above lines) | SOURCE_DIRECT | S-* | Cited as "safe to share immutably — interior is &'static" |
| `src/js_parser/parser.rs:612/1163` | unsafe `from_utf8_unchecked` | 4 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Const-context for static-ascii lexer keywords |
| `src/js_parser/parser.rs:1246` | unsafe block (enum tag transmute) | 4+6 | PRESENT_STRONG (cites 3-value bitmask) | SOURCE_DIRECT | S-* | "mask admits 3, which would be UB to transmute. Exhaustive match" — calls out fix |

## bun_js_parser_jsc — Macro / Worker FFI

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/js_parser_jsc/Macro.rs:131/232/251/253/291/328/350` | unsafe_block ptr→&mut | 1+10+21 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Boundary derefs across JSC callback; SAFETY mostly says "single-thread macro worker" |
| `src/js_parser_jsc/Macro.rs:308` | unsafe `Box::<MacroContext>::from_raw` | 12+20 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Pairing for `into_raw` upstream; finalizer arm |
| `src/js_parser_jsc/Macro.rs:1125` | `unsafe extern "C"` block (binding decls) | 10 | n/a (decl) | SOURCE_DIRECT | n/a | FFI imports for Macro__* helpers |

## bun_js_printer — bytemuck NoUninit/Pod impls

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/js_printer/lib.rs:167/174/176/187/189` | unsafe_impl `bytemuck::NoUninit`/`Zeroable`/`Pod` | 4+5+6+8 | PRESENT_WEAK | SOURCE_DIRECT | S-* | 5 zero-padding impls for serialize buckets (RecordKind, StringID, FetchParameters) — bytemuck contract: no uninit/padding bytes |

## bun_ast — Store/StoreRef raw-pointer ABI

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/ast/nodes.rs:39-40` | unsafe_impl Send/Sync `StoreRef<T>` | 8 | PRESENT_STRONG | SOURCE_DIRECT | S-* | Conditional `T: Send`/`T: Sync` — sound |
| `src/ast/nodes.rs:52-82` | `pub fn from_raw` / `NonNull::new_unchecked` | 2+4+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Two ctor paths: checked `expect("…null pointer")` and unchecked (line 82) |
| `src/ast/nodes.rs:167-168, 339-340` | unsafe_impl Send/Sync `StoreStr`, `StoreSlice<T>` | 8 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Backing memory is arena, lifetime-erased; `StoreSlice<T>` is unconditionally Send/Sync (EXP-019, Miri-confirmed safe-code `Cell<u32>` data race in `experiments/EXP-019`) |
| `src/ast/nodes.rs:204-208, 393-413` | safe lifetime-erased `slice<'a>` / `slice_mut<'a>` over raw pointers | 1+5+15 | CONFIRMED_UB_SHAPE | SOURCE_DIRECT | EXP-021 | Safe constructors (`StoreStr::new`, `StoreSlice::new`, `From<&[T]>`) plus caller-chosen-lifetime reborrow can create dangling `&[T]`; Miri-confirmed in `experiments/EXP-021` mirror |
| `src/ast/e.rs:1424` | unsafe_block `from_raw_parts<u16>` | 3+5+6 | PRESENT_WEAK | SOURCE_DIRECT | S-* | E::String UTF-16 reinterpret — alignment risk |
| `src/ast/lib.rs:3313` | unsafe `Box::from_raw(arena)` | 12+20 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Arena teardown — matches `Box::into_raw` upstream |
| `src/ast/loader.rs:79` | (loader enum, comment notes "no transmute-to-enum") | n/a | n/a | SOURCE_DIRECT | n/a | Documentation marker — bars a forbidden pattern |

## bun_css — CSS parser arena lifetime stretches (densest crate)

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/css/css_parser.rs:2718` | unsafe `transmute<'_ → 'static>` `CssModuleExports` | 6+15 | PRESENT_STRONG (:2712-14) | SOURCE_DIRECT | S-* | `'bump`-erasure to a "static placeholder" struct |
| `src/css/css_parser.rs:2723` | unsafe `transmute<'_ → 'static>` `CssModuleReferences` | 6+15 | PRESENT_STRONG | SOURCE_DIRECT | S-* | Same shape, references arm |
| `src/css/declaration.rs:253` | unsafe `detach_lifetime_ref(&Bump)` | 15 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Stretch input arena to `'static` for closure capture |
| `src/css/css_parser.rs:1115/1574/2269` | unsafe `detach_lifetime_ref(self.arena)` | 15 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Same pattern — recurs in 3 codegen hot paths |
| `src/css/values/ident.rs:381/391/434` | unsafe `slice::from_raw_parts` + transparent u128 read | 3+6+12 | PRESENT_STRONG (430-432) | SOURCE_DIRECT | S-* | Atom interner — reads 2 leading bytes via raw cast for tag check |
| `src/css/selectors/parser.rs:65` | unsafe `ptr::read(get_unchecked(i))` | 1+5+15 | PRESENT_STRONG (:62-64) | SOURCE_DIRECT | S-* | SmallList move-out; pairs with `set_len(0)` at :68 to suppress double-drop |
| `src/css/selectors/builder.rs:213-214` | unsafe `set_len(0)` (×2) | 12+20 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Suppress source-side Drop |
| `src/css/declaration.rs:53-54` | unsafe_impl Send/Sync `DeclarationBlock<'bump>` | 8 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Conditional missing |
| `src/css/rules/mod.rs:173-174` | unsafe_impl Send/Sync `CssRule<R>` | 8 | PRESENT_WEAK | SOURCE_DIRECT | S-* | `R: Send`/`R: Sync` gating — sound |
| `src/css/rules/import.rs:16/42/165` | `#[repr(C)]` POD types | 10 | n/a | SOURCE_DIRECT | n/a | ImportConditions layout pun w/ Zig `@ptrCast` — see comment :229-231 |
| `src/css/css_parser.rs:971` | unsafe `enclosing_layer.v.set_len(len)` | 5+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Layer-stack truncation |

## bun_css_jsc / bun_css_derive

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/css_jsc/css_internals.rs:109/317` | unsafe `detach_lifetime_ref(&Arena)` | 15 | PRESENT_STRONG | SOURCE_DIRECT | S-* | Lift `'a` to `'static` for the JSC entry-point closure |
| `src/css_jsc/css_internals.rs:142` | unsafe `&mut *(&raw mut log)` | 1+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Boundary log handle |
| `src/css_derive/*` | 1 unsafe site (proc-macro emission) | n/a | n/a | MACRO_GENERATED | n/a | Macro itself; verify emitted unsafe rendezvous via cargo-expand in Phase 3 |

## bun_shell_parser — SmolListInlined MU buffer

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/shell_parser/parse.rs:4550/4556` | unsafe `from_raw_parts(MU.as_ptr().cast::<T>(), len)` | 1+5+15 | PRESENT_STRONG (:4549/4554) | SOURCE_DIRECT | S-* | SmolListInlined live-slice view; alignment OK (MU<T> aligned to T); index discipline depends on `len <= INLINED_MAX` |
| `src/shell_parser/parse.rs:4569` | unsafe `items[i].assume_init_read()` (×N in promote) | 5+12 | PRESENT_STRONG (:4566-68) | SOURCE_DIRECT | S-* | Move all INLINED_MAX out — caller guarantee `len == INLINED_MAX` |
| `src/shell_parser/parse.rs:4603` | unsafe `items[len-1].assume_init_read()` (pop) | 5+12 | PRESENT_STRONG (:4602) | SOURCE_DIRECT | S-* | Pre-condition `self.len > 0`; not bounds-checked here |
| `src/shell_parser/parse.rs:4795-4799` | safe-only refactor of prior `assume_init_mut` get() | n/a | n/a | SOURCE_DIRECT | n/a | Comment cites prior UB: "debug-only over assume_init_mut, i.e. UB on OOB in release" — now safe |
| `src/shell_parser/braces.rs:123` | unsafe `slice::from_raw_parts(bytes.as_ptr(), bytes.len())` | 15 | MISSING | SOURCE_DIRECT | S-* | Identity reslice — possibly redundant; investigate |

## bun_ini / bun_dotenv / bun_bunfig — config parsers

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/ini/lib.rs:535/1089/1096/1103` | unsafe `&mut *head` / `&mut *rope` | 1+12 | PRESENT_STRONG | SOURCE_DIRECT | S-* | Rope traversal; explicit "no overlapping borrow" comments above each |
| `src/ini/lib.rs:1361` | unsafe `&mut *(env as *mut DotEnvLoader<'_> as *mut DotEnvLoader<'static>)` | 1+6+15 | PRESENT_STRONG | SOURCE_DIRECT | S-* | Double-cast lifetime stretch |
| `src/ini/lib.rs:1366` | unsafe `&*(&raw const parser.arena)` | 1+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Reborrow arena via raw — avoid `&mut`/`&` overlap |
| `src/ini/lib.rs:1551/1857` | unsafe `&mut *s.as_ptr()` (×2) | 1+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Patch arena-stored EString in place |
| `src/dotenv/env_loader.rs:359` | unsafe `slice::from_raw_parts(s.as_ptr(), s.len())` | 15+6 | PRESENT_STRONG (above closure) | SOURCE_DIRECT | S-* | Lifetime detacher — "free of transmute (PORTING.md §Forbidden)" |
| `src/dotenv/env_loader.rs:632` | unsafe `bun_core::ffi::cstr(_env)` | 4+10 | MISSING | SOURCE_DIRECT | S-* | C env var: trust libc's NUL terminator |
| `src/bunfig/bunfig.rs:1120` | unsafe `&mut *log_ptr` | 1+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Boundary log handle |
| `src/bunfig/arguments.rs:73/75/78/127/146` | unsafe `(*log_ptr).field` / `&mut *log` / `(*graph).flags` | 1+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | CLI argument parse boundary; raw `*mut Log` and `*mut Graph` derefs |

## bun_md — Block parser POD bytes

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/md/blocks.rs:937` | unsafe `slice::from_raw_parts(self.current_block_lines.as_ptr().cast::<u8>(), …)` | 3+5+6+12 | PRESENT_STRONG (:935) | SOURCE_DIRECT | S-* | VerbatimLine[]→[u8] reinterpret for serialize; VerbatimLine `#[repr(C)]`+POD claim |
| `src/md/containers.rs:222` | unsafe `slice::from_raw_parts(bytes_ptr.add(off).cast::<VerbatimLine>(), n_lines)` | 3+6+12+15 | PRESENT_STRONG (:219-221) | SOURCE_DIRECT | S-* | Deserialize inverse; **alignment depends on `bytes_ptr.add(off)` being VerbatimLine-aligned** |
| `src/md/ref_defs.rs:369` | unsafe `slice::from_raw_parts(line_ptr, n_lines)` | 5+15 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Reference-def line buffer view |

## bun_sourcemap — VLQ writer + InternalSourceMap pending buffers

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/sourcemap/InternalSourceMap.rs:1007-1011` | unsafe `*pending_X.get_unchecked_mut(i)` (×5) | 15 | PRESENT_STRONG (:1002-05) | SOURCE_DIRECT | S-* | `i < SYNC_INTERVAL` invariant between flushes; debug_assert at :1001 |
| `src/sourcemap/InternalSourceMap.rs:193/210` | unsafe `slice::from_raw_parts(_mut)` + `Box::from_raw` | 5+12+15+20 | PRESENT_WEAK | SOURCE_DIRECT | S-* | C-side mapping buffer adoption (paired alloc/free) |
| `src/sourcemap/InternalSourceMap.rs:413` | `ptr::slice_from_raw_parts(ptr::null(), 0)` | 4 | n/a (safe constructor at root) | SOURCE_DIRECT | n/a | Null-zero-len placeholder used as raw slice handle |
| `src/sourcemap/InternalSourceMap.rs:1249-1264` | unsafe `slice::from_raw_parts(sync_entries.as_ptr().cast::<u8>(), sync_bytes)` | 3+6+12 | PRESENT_STRONG | SOURCE_DIRECT | S-* | SoA serialize; comment "no uninit bytes are exposed by set_len" |
| `src/sourcemap/Chunk.rs:617/677` | unsafe `slice::from_raw_parts(contents.as_ptr(), contents.len())` | 15 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Identity reslice; possibly redundant — verify in Phase 3 |
| `src/sourcemap/lib.rs:89/466/567` | unsafe `slice::from_raw_parts(d.ptr, d.length)` + UnsafeCell ZST handle | 5+8+10+13 | PRESENT_STRONG (:89) | SOURCE_DIRECT | S-* | Opaque C++ `SourceProviderMap` ZST handle — UnsafeCell at offset 0 grants exterior mutability |
| `src/sourcemap/Mapping.rs:154-155` | (comment) MultiArrayList rebuild | n/a | n/a | SOURCE_DIRECT | n/a | Documents why no `set_len` here |

## bun_sourcemap_jsc — Coverage + SourceProvider

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/sourcemap_jsc/source_provider.rs:17/37/55/61/73/74` | `unsafe extern "C"` decl + 5 callsites | 1+10+21 | PRESENT_WEAK | SOURCE_DIRECT | S-* | BakeSourceProvider FFI; SAFETY on the &*slice deref at :74 names "C++ keeps slice alive" |
| `src/sourcemap_jsc/JSSourceMap.rs:295/326` | unsafe (UnsafeCell `as_ptr()` derive) | 1+8 | PRESENT_STRONG | SOURCE_DIRECT | S-* | Interior-mutability via JSCell-like wrapper |
| `src/sourcemap_jsc/CodeCoverage.rs:100/391/401/459-470/483/874/890/901/923` | unsafe blocks (thread-local UnsafeCell + raw slice views) | 1+5+8+15 | PRESENT_STRONG (:393, :468) | SOURCE_DIRECT | S-* | Coverage Bytemap; explicit non-null/aligned check before `from_raw_parts`; thread-local discipline cited |

## bun_exe_format — PE/Mach-O headers (alignment hazard cluster)

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/exe_format/pe.rs:289` | unsafe `data.as_ptr().add(start).cast::<SectionHeader>()` + `from_raw_parts` | **3**+10+15 | PRESENT_WEAK + TODO at :288 | SOURCE_DIRECT | EXP-093 | **Confirmed after Phase 1:** Miri symbolic-alignment rejects an odd section-header offset (`phase5_experiment_results/EXP-093.log`) |
| `src/exe_format/pe.rs:301` | mut counterpart | **3**+10+15 | PRESENT_WEAK + TODO at :300 | SOURCE_DIRECT | EXP-093 | Same TODO; mut typed-slice construction over byte storage |
| `src/exe_format/pe.rs:396/676` | similar SectionHeader views | 3+10+15 | PRESENT_WEAK | SOURCE_DIRECT | EXP-093 | Same alignment risk for the typed view; `:676` copy-from-stack-bytes remains sound |
| `src/exe_format/pe.rs:905/917` | DOSHeader / PEHeader reads | 3+10+15 | PRESENT_STRONG | SOURCE_DIRECT | EXP-093 | Bounds-checked; alignment unchecked |
| `src/exe_format/pe.rs:932` | `unsafe extern "C"` decls | 10 | n/a | SOURCE_DIRECT | n/a | `Bun__getStandaloneModuleGraphPE{Length,Data}` |
| `src/exe_format/macho.rs:74/529/665` | unsafe (all-zero-init POD reads) | 4+10 | PRESENT_STRONG | SOURCE_DIRECT | S-* | "all-zero is a valid segment_command_64 / CodeDirectory (#[repr(C)] POD, no NonZero/NonNull)" |
| `src/exe_format/macho.rs:122` | unsafe `slice::from_raw_parts_mut` | **3**+5+15 | PRESENT_WEAK | SOURCE_DIRECT | EXP-095 | Section write window; later follow-up confirmed typed mutable slice over byte storage is the same alignment class as EXP-093 |
| `src/exe_format/macho.rs:366/371/392/403` | unsafe `&mut *cmd_ptr.cast::<macho::*_command>()` | **3**+10+15 | PRESENT_WEAK | SOURCE_DIRECT | EXP-095 | Load-command mutation path violates `macho_types.rs` module contract to use unaligned read/write for on-disk POD structs |
| `src/exe_format/macho.rs:719` | unsafe `slice::from_raw_parts(data.as_ptr().add(off), PAGE_SIZE)` | 15+3 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Code signing page reader |
| `src/exe_format/macho.rs:219/691/753` | unsafe `data.set_len(...)` | 5+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Buffer truncation/resize; trusts no uninit exposed |
| `src/exe_format/macho_types.rs:196/198/200` | `unsafe impl bytemuck::NoUninit` (CodeDirectory, BlobIndex, SuperBlob) | 5+8 | PRESENT_WEAK | SOURCE_DIRECT | S-* | bytemuck contract on packed wire types |

## bun_glob — GlobWalker raw ZStr

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/glob/GlobWalker.rs:600/607/995` | unsafe `ZStr::from_raw(ptr, len)` (×3) | 4+15 | MISSING | SOURCE_DIRECT | S-* | Requires NUL at `ptr[len]`; trust path_buf invariant — **no SAFETY narrative present** |
| `src/glob/GlobWalker.rs:996-997` | unsafe `slice::from_raw_parts` | 5+15 | MISSING | SOURCE_DIRECT | S-* | symlink_full_path view |
| `src/glob/GlobWalker.rs:1542` | unsafe `ptr::copy(src.as_ptr(), dst, copy_len)` | 1+2+15 | MISSING | SOURCE_DIRECT | S-* | Path buffer copy |

## bun_router — Path matching scratch

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/router/lib.rs:69` | unsafe `slice::from_raw_parts(s.as_ptr(), s.len())` | 15 | MISSING | SOURCE_DIRECT | S-* | Identity reslice — same redundancy hazard as `sourcemap::Chunk:617` |
| `src/router/lib.rs:945` | safe `pub fn set_len(&mut self, len: u16)` (param store) | n/a | n/a | SOURCE_DIRECT | n/a | Param-byte writer — not actually unsafe |
| `src/router/lib.rs:1101/1202` | unsafe `slice::from_raw_parts(route_file_buf.as_ptr(), …)` | 15 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Stretching `'a` of a scratch buf |
| `src/router/lib.rs:1892` | `param.set_len(i - param.offset())` | n/a (safe newtype) | n/a | SOURCE_DIRECT | n/a | Param byte-store newtype |

## bun_resolver — DirInfo cache + Bufs thread-local (DENSEST CRATE)

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/resolver/lib.rs:273/293` | unsafe `(*INSTANCE.get()).assume_init_mut()/_ref()` | 1+5+7+8 | PRESENT_STRONG (:272, :290-292) | SOURCE_DIRECT | S-* | FileSystem singleton; assumes init via INSTANCE_LOADED Acquire ordering |
| `src/resolver/lib.rs:3461` | unsafe `Box::<Bufs>::new_uninit().assume_init()` | 5+4 | PRESENT_STRONG (:3454-60) | SOURCE_DIRECT | S-* | `Bufs` is **every-bit-pattern valid** (cited) — sound; leaks via `Box::leak` for threadlocal scratch |
| `src/resolver/lib.rs:4259-4263` | unsafe `transmute<Option<&'_ dyn>, Option<&'a dyn>>` | 6+15 | PRESENT_STRONG (:4252-58) | SOURCE_DIRECT | S-* | trait-object lifetime widen; comment notes vtable layout identical |
| `src/resolver/lib.rs:7554/7782/7822/7886/9595` | unsafe `(*BIN_FOLDERS.get()).assume_init_*()` | 1+5+7+8 | PRESENT_WEAK (mostly) | SOURCE_DIRECT | S-* | Same INSTANCE pattern for BIN_FOLDERS; some sites lack SAFETY narrative |
| `src/resolver/lib.rs:7099/8186` | unsafe `DirInfoRef::from_raw(dir_info_ptr)` | 12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | DirInfo singleton — pairs w/ BSSMap |
| `src/resolver/lib.rs:2181/2188` | unsafe `slice::from_raw_parts(*ptr, *len)` | 15 | PRESENT_WEAK | SOURCE_DIRECT | S-* | RawSlice projection |
| `src/resolver/dir_info.rs:62-71` | `pub const unsafe fn from_raw` `DirInfoRef` | 12 | PRESENT_STRONG (:70) | SOURCE_DIRECT | S-* | Centralizes prior open-coded `from_raw(ptr::from_mut(d))` |
| `src/resolver/fs.rs:1836/1837/1841/1842` | unsafe_impl Send/Sync `EntriesOption`, `Entry` | 8 | PRESENT_STRONG (:546, :1835) | SOURCE_DIRECT | S-* | `SyncUnsafeCell`-backed entry cache; cites concurrent-reader discipline |
| `src/resolver/fs.rs:2503/2531/2540` | unsafe `slice::from_raw_parts_mut(slot.as_mut_ptr().cast::<u8>(), len)` + `NonNull::new_unchecked` | 5+15 | PRESENT_WEAK | SOURCE_DIRECT | S-* | Scratch buf views |
| `src/resolver/fs.rs:2689/2729` | unsafe `set_len(read_count + 1)` | 5+12 | PRESENT_WEAK | SOURCE_DIRECT | S-* | After read-loop fills + writes NUL |
| `src/resolver/lib.rs:897-898` | unsafe_impl Send/Sync `EntriesOption` (duplicate?) | 8 | MISSING | SOURCE_DIRECT | S-* | Verify in Phase 3 — possible duplicate vs fs.rs |
| `src/resolver/package_json.rs:2432/2673/3178` | unsafe (threadlocal UnsafeCell) | 7+8 | PRESENT_STRONG ("threadlocal UnsafeCell; finalize does not recurse") | SOURCE_DIRECT | S-* | package.json hash-cons finalize |

## bun_resolve_builtins / bun_unicode / bun_semver_jsc / bun_ast_jsc

- **All four:** 0 unsafe sites. Pure-safe boundary crates.

## bun_simdutf_sys — FFI declarations + thin wrappers

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/simdutf_sys/simdutf.rs:3` | `#[repr(C)] struct SIMDUTFResult { status, count }` | 10 | n/a | SOURCE_DIRECT | n/a | C ABI return; `Status(i32)` `#[repr(transparent)]` newtype avoids enum-tag UB |
| `src/simdutf_sys/simdutf.rs:20-48` | `#[repr(transparent)] struct Status(i32)` w/ associated consts | 4+6+10 | PRESENT_STRONG (:16-19) | SOURCE_DIRECT | n/a | **Deliberately not `#[repr(i32)] enum`** — C may return values outside named set, which would be UB; comment is explicit |
| `src/simdutf_sys/simdutf.rs:50-739` | `unsafe extern "C"` decl block (~80 fns) | 10 | n/a (decls) | SOURCE_DIRECT | n/a | All simdutf__* C bindings |
| `src/simdutf_sys/simdutf.rs:745-767` | nested `unsafe extern "C"` (base64) | 10 | n/a | SOURCE_DIRECT | n/a | base64 family |
| `src/simdutf_sys/simdutf.rs:769..` | ~50 `unsafe { simdutf__*(...) }` wrappers | 10+25 | PRESENT_WEAK (most cite output capacity contract) | SOURCE_DIRECT | S-* | Caller-API contract — output buffer length precondition |
| `src/simdutf_sys/simdutf.rs:790-792` | `pub unsafe fn encode_raw` (caller-API) | 10+25 | PRESENT_STRONG (:786-789) | SOURCE_DIRECT | n/a | Documents preconditions: valid for `encode_len` writes, no overlap |

---

## Cross-cuts (callouts for Phase 3)

- **Alignment cluster** (bucket 3): `exe_format/pe.rs:289/301/396/676/905/917`, `exe_format/macho.rs:122/366/371/392/403`, `md/containers.rs:222`, `parsers/json_lexer.rs:575`, `parsers/yaml.rs:1783`, `ast/e.rs:1424` — these reinterpret raw bytes as typed pointers or typed slices and therefore need an explicit alignment proof or an unaligned-read refactor. `pe.rs` already carries TODOs acknowledging the risk; `macho_types.rs` explicitly says Mach-O wire structs should use unaligned reads/writes. Later follow-up promoted the PE cluster to EXP-093, the Mach-O cluster to EXP-095, and the UTF-16 cluster to EXP-088; all three have Miri evidence.
- **Lifetime-stretch transmute cluster** (bucket 15): `css/css_parser.rs:2718/2723`, `css/declaration.rs:253`, `css/css_parser.rs:1115/1574/2269`, `resolver/lib.rs:4259`, `ini/lib.rs:1361` — pattern of `'_ → 'static` or `&dyn` lifetime widening for ad-hoc capture. Sound iff the borrow is dropped before the underlying buffer.
- **MISSING-SAFETY hotspots:** `glob/GlobWalker.rs:600/607/995/1542` (4 sites no SAFETY); `dotenv/env_loader.rs:632` (libc cstr); `router/lib.rs:69`; `resolver/lib.rs:897-898` (duplicate Send/Sync). Phase 3 should bead these.
- **bun_install crosscuts:** `String::slice`/`eql` callers — `src/install/PackageInstaller.rs:9`, `src/install/PackageInstall.rs:11`, `src/install/PackageManifestMap.rs:3` use these via `bun_semver::{String, string::Builder}`. Builder-created strings encode a packed `(off, len)` that later feeds `slice(string_bytes)` / `eql(other, this_buf, that_buf)`. The OOB primitive is real for any corrupted `String` handle; crafted-lockfile reachability still needs a concrete load path that imports attacker-controlled packed `String` bytes rather than reconstructing them through checked `Builder` APIs.

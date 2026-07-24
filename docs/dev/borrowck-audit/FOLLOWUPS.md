# Follow-up findings from the borrowck audit

Three additional lists that fell out of reading the 371 sites but are scoped beyond them.

## 1. Untagged lifetime-erasure call sites (potential UAF hazard)

The `bun_ptr` helpers `detach_lifetime`, `str_detached`, `BackRef::new/from`, `RawSlice::new/from` erase a borrow's lifetime. They exist for good reason (arena-backed data, FFI back-pointers) but are `unsafe`-equivalent: if the underlying buffer reallocates while the erased reference is live, that's a use-after-free.

The main audit found 6 cases where the "reshaped for borrowck" comment marked an allocation that was actually required because the Zig code would have dangled (see README "Correctness findings"). Those 6 were only caught because the porter reached for `.to_vec()` instead of `detach_lifetime`. Sites that reached for `detach_lifetime` instead got no such safety net.

| scope | count |
|---|---:|
| All `detach_lifetime`/`str_detached`/`BackRef::{new,from}`/`RawSlice::{new,from}` call sites outside `src/bun_ptr/` | 609 |
| ...not within 8 lines of a "reshaped for borrowck" comment | 586 |
| ...in `src/install/` (where the confirmed realloc hazard lives) | 50 |
| **High-risk**: erase a slice near `string_bytes`/`.str(`/`str_buf` (known-growable buffer) | **14** |

Full site list: [`erasure-untagged.txt`](erasure-untagged.txt) (586 lines)
High-risk subset: [`erasure-highrisk.txt`](erasure-highrisk.txt) (14 lines)

The 14 high-risk sites should be audited first: for each, confirm the erased slice is NOT read after any operation that may grow the backing buffer.

**Proposed action**: add a clippy-style lint (or grep-based CI check) that flags any `detach_lifetime`/`RawSlice::new` on a `lockfile.str()`-derived or `string_bytes`-derived slice without an adjacent `// SAFETY:` comment.

## 2. Algorithmic regressions (not just memory)

Eight of the 371 reshapes turned O(n) into O(n·m) or worse by allocating inside a loop. These are already in bucket B2 as memory fixes, but the perf impact is worth calling out separately:

| site | complexity change | impact |
|---|---|---|
| `src/bundler/defines.rs:209` | O(n) → O(n²) | fresh `Vec` + `extend_from_slice` per duplicate-key insert |
| `src/js_parser/lib.rs:539` | O(n) → O(n²) | same pattern, plus deep-clones each `DotDefine` |
| `src/install/PackageManager/PackageManagerEnqueue.rs:111` | O(n·m) → O(n·m·k) | deep-clones `Dependency` (with boxed semver tree) per inner-loop step to read two scalars |
| `src/install/yarn.rs:1381` | +alloc per edge | `Vec<&[u8]>` clone per dep edge in nested entry×dep loop |
| `src/shell_parser/braces.rs:626,676,745` | +alloc per recursion | `Vec<u8>` prefix snapshot per brace expansion level |
| `src/runtime/shell/builtin/seq.rs:196` | 2× peak memory | clones full output buffer (unbounded: `seq 1 1e7` ≈ 70MB → 140MB peak) |

## 3. God-object hotspots

Files ranked by borrowck-fight density (site count, with raw-ptr-launder weighted 2× since those indicate structural aliasing). High scores mean the struct layout is fighting Rust: one `&mut self` method needs simultaneous access to multiple sub-fields.

| file | score | what's fighting |
|---|---:|---|
| `src/install/PackageManager/PackageManagerEnqueue.rs` | 34 | `&mut PackageManager` vs `&lockfile` / `&string_bytes` slice / `&options` |
| `src/bundler/bundle_v2.rs` | 20 | `&mut self.graph` vs `&self` elsewhere |
| `src/jsc/VirtualMachine.rs` | 13 | `rare_data()` takes `&mut self` vs `&vm` needed by callees |
| `src/js_printer/lib.rs` | 12 | `symbols()` borrows `&self` vs `&mut self` print state |
| `src/install/PackageManager/runTasks.rs` | 12 | same as Enqueue |
| `src/runtime/api/bun/h2_frame_parser.rs` | 11 | `self.streams` map vs `&mut self` dispatch (reentrant JS) |
| `src/install/PackageInstaller.rs` | 11 | `&mut self` vs `&self.node_modules` / `&self.lockfile` |
| `src/paths/resolve_path.rs` | 11 | sub-slice of `buf` returned then `buf` mutated |
| `src/http/lib.rs` | 9 | body `&mut MutableString` held across `&mut self` |
| `src/runtime/jsc_hooks.rs` | 9 | event-loop tick re-enters VM (legitimate) |

The top 5 account for ~90 of the 371 sites. A one-time "split into borrowable field-group view structs" refactor for `PackageManager` and `BundleV2` would eliminate ~50 sites structurally and prevent new ones from accumulating. Handoff C1/C2 start on this but stop at the per-method level; a deeper pass would introduce e.g. `struct PackageManagerView<'a> { lockfile: &'a Lockfile, options: &'a Options, log: &'a mut Log, ... }` as the canonical argument shape.

## Data files

- [`erasure-untagged.txt`](erasure-untagged.txt): 586 lifetime-erasure call sites not covered by the main audit
- [`erasure-highrisk.txt`](erasure-highrisk.txt): 14 sites erasing slices into known-growable buffers

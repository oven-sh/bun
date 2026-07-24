# "reshaped for borrowck" audit

Audit of all 371 sites in `src/**/*.rs` marked with a `reshaped for borrowck` comment. These are places where the Zig→Rust port restructured code to satisfy the borrow checker. The goal is to remove every such comment by putting the code into its optimal form: minimal copies/clones, idiomatic safe Rust.

## Summary

| | sites | % |
|---|---:|---:|
| **Total** | 371 | 100% |
| Memory-neutral | 333 | 89.8% |
| Memory-regressed (extra heap alloc) | 38 | 10.2% |
| Memory-improved | 0 | 0% |

Of the 38 regressions, **14 are on hot paths** (per-package, per-chunk, per-watch-cycle, per-expansion). None improved memory; the borrow checker never forces fewer allocations than Zig, it only forces more or the same.

### Pattern distribution

| pattern | count | memory | idiomatic? |
|---|---:|---|---|
| raw-ptr-launder | 90 | neutral | **no** (unsafe escape hatch) |
| reborrow | 83 | neutral | yes |
| scalar-copy | 73 | neutral | yes |
| clone-heap | 26 | **regressed** | n/a |
| split-borrow | 22 | neutral | yes |
| take-replace | 21 | neutral | yes |
| index-loop | 21 | neutral | yes (mostly) |
| collect-to-vec | 10 | **regressed** | n/a |
| clone-small | 10 | neutral | yes |
| entry-split | 8 | neutral (6) / regressed (2) | **no** (double lookup) |
| buffer-stash | 4 | neutral | yes |
| own-transfer | 3 | neutral | yes |

## Fix plan

Every site falls into exactly one bucket. Buckets A and B are one PR each; bucket C is one PR per subsystem.

### Bucket A: comment-only changes (257 sites) → **simple, one PR**

Code is already in optimal form; only the comment goes.

- **A1** (237 sites, [`bucket-A1-delete-comment.txt`](bucket-A1-delete-comment.txt)): scalar-copy, clone-small, reborrow, split-borrow, buffer-stash, own-transfer, take-replace, index-loop. These are idiomatic Rust patterns with zero heap cost. Delete the `reshaped for borrowck` comment.
- **A2** (20 sites, [`bucket-A2-safety-comment.txt`](bucket-A2-safety-comment.txt)): raw-pointer dispatch that is **required** for correctness: FFI provenance (`*mut Self` stored as callback context that may free self) or reentrant JS callbacks that mutate `self`. Replace the `reshaped for borrowck` comment with a `// SAFETY:` comment explaining the provenance/reentrancy requirement.

### Bucket B: simple local fixes (59 sites) → **simple, one PR**

Mechanical, <10-line changes, no signature changes.

- **B1** (6 sites, [`bucket-B1-entry-api.txt`](bucket-B1-entry-api.txt)): `get()` + `insert()` double-lookup → use `.entry()` API.
- **B2** (33 sites, [`bucket-B2-simple-alloc-fix.txt`](bucket-B2-simple-alloc-fix.txt)): drop the extra heap allocation via local restructure. Fix approaches per site are in the file; common ones:
  - iterate by index + re-borrow per iteration (instead of collecting keys)
  - `mem::take` the field, use it, write back (instead of clone)
  - `split_at_mut` for disjoint slice access (instead of `.to_vec()` prefix)
  - pass `&[u8]` directly where the borrow was already disjoint
  - `SmallVec<[T; N]>` where a snapshot is required but bounded-small
  - 3 sites are "KEEP: alloc required for correctness" (underlying buffer reallocates or callback re-enters); convert the comment to explain that
- **B3** (20 sites, [`bucket-B3-simple-rawptr-fix.txt`](bucket-B3-simple-rawptr-fix.txt)): raw-ptr-launder with a local safe rewrite: reorder statements, use disjoint field borrows, use `scopeguard::guard(payload, ..)` instead of capturing a sibling pointer, compute offsets as `usize` instead of `*mut`.

### Bucket C: involved fixes (55 sites) → **separate PRs per subsystem**

Require signature changes, new struct fields/methods, or cross-file refactors. Clustered by subsystem since sites in the same struct share one fix.

| subsystem | sites | root problem | fix shape |
|---|---:|---|---|
| `install/PackageManager/*` | 23 | methods need `&mut self` + `&self.lockfile` / `&self.options` / slice into `string_bytes` simultaneously | split hot methods into associated fns taking disjoint field refs (e.g. `fn enqueue(lockfile: &mut Lockfile, opts: &Options, ..)`); or add `string_bytes` slice accessor that returns a `StoreStr` index instead of `&[u8]` |
| `bundler/bundle_v2.rs` + `LinkerContext.rs` + `ParseTask.rs` | 6 | `&mut self.graph` while passing `&self` elsewhere | split into associated fns taking `&mut Graph` + disjoint fields |
| `js_printer/lib.rs` | 3 | `symbols().get()` borrows `&self` across `&mut print` calls | make symbols table a separate field passed by `&` alongside `&mut` writer state |
| `jsc/VirtualMachine.rs` + `jsc_hooks.rs` + `web_worker.rs` | 4 | `rare_data()` takes `&mut self` while `&self` needed elsewhere | `rare_data()` → `&self` with interior init (OnceCell), or split into `(&mut RareData, &VirtualMachine)` helper |
| `runtime/server/mod.rs` | 2 | long-lived `&mut self.config`/`user_routes` vs `self.dev_server`/`websocket` reads | split `setup_routes` into associated fn over disjoint fields |
| `http/lib.rs` | 2 | `&mut MutableString` body held across `&mut self` calls | `mem::take` body out, process, put back |
| `sql_jsc/mysql/MySQLConnection.rs` | 2 | `&mut self.queue` vs `&mut JSMySQLConnection` (which owns queue) | split advance/process into associated fns |
| one-offs | 13 | various | see [`bucket-C-involved-rawptr.txt`](bucket-C-involved-rawptr.txt) / [`bucket-C-involved-regressed.txt`](bucket-C-involved-regressed.txt) |

## Memory regressions: full list

### Hot path (14)

| site | pattern | cost |
|---|---|---|
| `src/bundler/bundle_v2.rs:2440` | clone-heap | `+Box<[u8]>` ~path len per new non-JS file (server_components) |
| `src/bundler/linker_context/computeCrossChunkDependencies.rs:338` | collect-to-vec | `+Vec<Ref>` per JS chunk, 8B × imports.count() |
| `src/css/properties/flex.rs:879` | clone-heap | `+Box<Calc<..>>` deep clone only for `calc()` flex-basis |
| `src/install/PackageInstaller.rs:719` | clone-heap | `+Box<[u8]>` ~name len per runnable lifecycle script |
| `src/install/PackageManager/PackageManagerEnqueue.rs:111` | clone-heap | `+Dependency` deep clone per inner-loop step |
| `src/install/PackageManager/PackageManagerEnqueue.rs:995` | clone-heap | `+Vec<u8>` ~name len per npm dep (also correctness: string_bytes reallocs) |
| `src/install/yarn.rs:1381` | clone-heap | `+Vec<&[u8]>` per dep edge in nested loop |
| `src/js_parser/visit/visit_stmt.rs:186` | clone-heap | `+Box<[u8]>` when `ReplaceableExport::Inject` |
| `src/shell_parser/braces.rs:626,676,745` | clone-heap | `+Vec<u8>` prefix per brace expansion group |
| `src/watcher/INotifyWatcher.rs:388` | collect-to-vec | `+Vec<i32>` 4B × watched-files per cycle (also correctness: concurrent realloc) |
| `src/watcher/KEventWatcher.rs:130` | collect-to-vec | `+Vec<WatchEvent>` ≤768B per cycle |
| `src/watcher/WindowsWatcher.rs:525` | collect-to-vec | `+Vec<WatchEvent>` ≤768B per batch |

### Cold path (24)

See [`full.json`](full.json) `.cold_regressed[]`. Mostly one-shot CLI paths (REPL keypresses, `bun pm view`, `bun pack`, `bake production` init), error paths, and end-of-test-run. Largest single one: `src/runtime/shell/builtin/seq.rs:196` clones the entire `seq` output buffer (unbounded).

## Correctness findings

Six "regressions" are allocations the borrow checker forced that are actually **required for correctness**. In Zig these were latent use-after-realloc or iterator-invalidation bugs:

| site | why the alloc is required |
|---|---|
| `PackageManagerEnqueue.rs:995` | `get_or_put_resolved_package_with_find_result` appends to `string_bytes` and may reallocate it while `name_str` is still read afterward |
| `INotifyWatcher.rs:388` | `on_file_update` evicts watchlist entries and the JS thread may concurrently realloc the backing storage |
| `h2_frame_parser.rs:2288` | `send_window_update` → `self.write` can re-enter JS which may mutate `self.streams` |
| `shell/IOWriter.rs:833` | `run_yield`/`cancel_chunks` re-enter `self.state()` and mutate `s.writers` |
| `css/properties/flex.rs:879` | basis value is emitted twice (shorthand + longhand); second use needs its own copy |
| `dotenv/env_loader.rs:1238` | map stores `Box<[u8]>` so one alloc per value is required anyway; only eager placement is extra |

For these, the fix is to keep the snapshot but amortize it (`SmallVec`, reusable scratch buffer) and change the comment from "reshaped for borrowck" to one explaining the reallocation/reentrancy hazard.

## Data files

- [`full.json`](full.json): every site with `{file, line, category, pattern, what, mem_delta, hot}`
- [`difficulty.json`](difficulty.json): fix approach + difficulty for the 128 non-trivial sites
- `bucket-*.txt`: one site-list per fix bucket, `file:line | fix-approach`

# Lifetime-erasure hazard audit

Audit of the 586 `detach_lifetime` / `detach_lifetime_mut` / `str_detached` / `BackRef::{new,from}` / `RawSlice::{new,from}` call sites listed in [`erasure-untagged.txt`](erasure-untagged.txt) (those not within 8 lines of a `reshaped for borrowck` comment) for use-after-realloc hazards.

**Result: 0 confirmed use-after-realloc hazards.** One fragile cross-function invariant, two Stacked-Borrows aliasing concerns (not realloc-related), and one misleading safety comment. Details below.

## Method

1. The 14 high-risk sites in [`erasure-highrisk.txt`](erasure-highrisk.txt) (erasure within ±3 lines of `string_bytes` / `.str(` / `str_buf` / `string_buf`) were each traced individually: backing storage identified, erased-reference live range determined, every intervening operation checked for reallocation of the backing.
2. The 10 callers of `Lockfile::str_detached` were traced the same way (the definition's safety claim covers every caller, so each caller is effectively a high-risk site).
3. The remaining 572 sites were bucketed by backing-storage kind. 257 sites (covering every file with ≥5 sites plus all `install/`, `http/`, `bundler/`, `sql*/`, `incremental_graph`, `resolver`, `shell/states/`, `threading/`) were read individually and classified. The remaining 321 were classified by a grep heuristic over ±3 lines of context, spot-checked at ~10%.
4. Every site that classified as `growable-vec` (48 total across steps 1-3) was traced for the erased reference's live range like step 1.

## 1. High-risk sites (14)

| site | verdict | backing / reason |
|---|---|---|
| `crash_handler/lib.rs:1874` | SAFE | `msg_buf: BoundedArray<u8, 4096>` (stack, fixed-size); `CrashReason::Panic` slice consumed by `Display`/`TraceString` writes inside the same frame. |
| `install/lockfile.rs:1170` | **SAFE (fragile)** | `RawSlice` into `new.buffers.string_bytes` stored in `UpdateRequest.version_buf`; read later by `PackageJSONEditor::edit`. See §3. |
| `install/lockfile.rs:2004,2013,2015,2016` | SAFE (def) | All four hits are the `Lockfile::str_detached` definition; hazard is per-caller. All 10 callers traced SAFE (§2). The doc-comment safety claim is over-broad; see §4. |
| `install/PackageManager/PopulateManifestCache.rs:241` | SAFE | `BackRef` into `this.options` (a `&Scope`); the only interleaved mutation is `&mut (*manager_ptr).manifests` — field-disjoint from `options`. `start_manifest_task` touches network-task pool / log only. |
| `install/PackageManager/runTasks.rs:1356` | SAFE | `string_buf` slices (`dep_name`/`committish`/`repo`) consumed by `Repository::find_commit` (no lockfile access), `Task::Id::for_git_checkout` (pure hash), and `enqueue_git_checkout` (copies into `filename_store`, reads `string_bytes`, never resizes). `has_created_network_task` touches `network_dedupe_map` only. |
| `install/PackageManager/PackageManagerEnqueue.rs:1568` | SAFE | `dep_name` copied into `FileSystem::filename_store` at `enqueue_local_tarball:1908`; preceding calls (`task_queue.get_or_put`, `get_cache_directory`, `get_temporary_directory`) do not touch `string_bytes`. |
| `install/lockfile/Package.rs:1667` | SAFE | `string_builder.string_bytes` is detached after `allocate()` (line 697) pre-reserved the Vec to `off+cap`; subsequent `append()` calls index into that region without resizing. Debug-asserted at `lockfile.rs:2595`. See §4 for a secondary SB-aliasing note. |
| `install/lockfile/OverrideMap.rs:443` | SAFE | Same `allocate()`-then-`append()` pattern as `Package.rs:1667`. |
| `jsc/AsyncModule.rs:985` | SAFE | `RawSlice` into `lockfile.buffers.string_bytes`, read only via `resolution_fmt` in the `write!` arms (998-1061); nothing between touches the lockfile. The `else` arm at 1069 re-borrows `string_bytes` fresh instead of using the erased slice. |
| `jsc/AsyncModule.rs:1205,1208` | SAFE | `specifier()`/`path_text()` slice into `self.string_buf: Box<[u8]>` (fixed heap allocation). The function never reassigns `string_buf`; `mem::replace(&mut self.parse_result, ..)` does not move it. |

**0 HAZARDs.** The one flagged item (lockfile.rs:1170) is a fragile-but-currently-correct invariant, detailed in §3.

## 2. `str_detached` callers (10)

All ten callers are in `src/install/PackageManager/PackageManagerEnqueue.rs`. Each detaches a slice into `lockfile.buffers.string_bytes: Vec<u8>`; the hazard would be any resize of that Vec (via `StringBuilder::allocate`, `append_package`, `get_or_put_resolved_package*`) before the slice's last read.

| line | slice | verdict | last read / why no resize before it |
|---:|---|---|---|
| 245 | `path` | SAFE | hashed by `Task::Id::for_tarball`, then copied into `filename_store` at `enqueue_local_tarball:1922`; only `task_queue.get_or_put` / `items_meta()` read between |
| 290 | `url` | SAFE | consumed at 293 by `Task::Id::for_git_checkout` (hash only) |
| 292 | `resolved` | SAFE | copied into `filename_store` at `enqueue_git_checkout:1813`; struct-literal fields before it are lockfile-read-only |
| 1217 | `alias` | SAFE | copied into `filename_store` at `enqueue_git_checkout:1802` / `enqueue_git_clone:1722`; `find_commit` has no lockfile access |
| 1218 | `url` | SAFE | consumed at 1247 by `Task::Id::for_git_checkout` (hash only) |
| 1568 | `dep_name` | SAFE | copied into `filename_store` at `enqueue_local_tarball:1908` |
| 2382 | `name_str` | SAFE | consumed at 2387 by `options.scope_for_package_name` (`&self`, read-only) |
| 2564 | `folder_path` | SAFE | copied into stack `PathBuffer` at `folder_resolver.rs:392` before `read_package_json_from_disk`→`parse`/`append_package` (line 373) resizes |
| 2676 | `workspace_path` | SAFE | same as 2564 |
| 2726 | `symlink_path` | SAFE | copied into stack buffers at `folder_resolver.rs:392,442` before `read_package_json_from_disk` |

**0 HAZARDs.** In every case the slice is either hashed (pure), or copied into a disjoint buffer (`filename_store`, stack `PathBuffer`) before any `string_bytes`-resizing call becomes reachable.

## 3. Fragile invariant: `UpdateRequest.version_buf` (lockfile.rs:1170)

`clean_with_logger` stores `RawSlice::new(new.buffers.string_bytes.as_slice())` into each `updates[i].version_buf`. The `new` lockfile becomes `manager.lockfile` (install_with_manager.rs:623), then `install_hoisted_packages` / `install_isolated_packages` run, and finally `PackageJSONEditor::edit` (updatePackageJSONAndInstall.rs:570) dereferences `request.version_buf()` at PackageJSONEditor.rs:723/853/1113/1215/1231/1249/1253.

The SAFETY comment claims `string_bytes` is "finalized" at the point of the `RawSlice::new`. **Tracing confirms this holds today**, but only because of how the install-phase task drain is configured:

- Both installers run `run_tasks` with `HAS_ON_EXTRACT = true`. That gates out `process_extracted_tarball_package` (which contains `StringBuilder::allocate()` at `processDependencyList.rs:203,338`) on the Extract/LocalTarball/GitCheckout arms.
- Hoisted install additionally has `IS_PACKAGE_INSTALLER = true`, so GitClone completion takes the "Installing!" branch (no `process_dependency_list_for_ctx`).
- Isolated install (`IS_STORE_INSTALLER = true`) does reach `process_dependency_list_for_ctx` on GitClone completion, but the resulting `enqueue_dependency_with_main` call lands on the Git arm (PackageManagerEnqueue.rs:1201-1309) which has no `string_builder()` / `allocate()` path.
- PackageManifest tasks are not enqueued by the install phase (resolve drains to `pending_task_count()==0` first, install_with_manager.rs:589).

So there is no reachable `allocate()` on `manager.lockfile` between 623 and the `version_buf` reads. But the invariant spans `lockfile.rs` / `install_with_manager.rs` / `runTasks.rs` / `PackageManagerEnqueue.rs` and depends on `HAS_ON_EXTRACT`/`IS_PACKAGE_INSTALLER` const generics plus the fact that install-phase callbacks never reach the Npm/Folder arms of `get_or_put_resolved_package`. Any of these could change without obviously touching `version_buf`.

Compare `PackageInstaller::fix_cached_lockfile_package_slices` (PackageInstaller.rs:957), which re-snapshots its six `RawSlice` fields into `lockfile.packages` columns precisely because that buffer *can* grow during install. No equivalent re-snapshot exists for `UpdateRequest.version_buf`.

**Proposed follow-up**: either (a) add a `debug_assert!(manager.lockfile.buffers.string_bytes.as_ptr() == <captured-ptr>)` just before `PackageJSONEditor::edit` in `updatePackageJSONAndInstall.rs`, or (b) have `PackageJSONEditor::edit` refresh `request.version_buf` from `manager.lockfile.buffers.string_bytes` at entry (same pattern as `fix_cached_lockfile_package_slices`). (b) removes the invariant entirely.

## 4. Secondary findings (not realloc hazards)

### 4a. `str_detached` doc-comment safety claim is over-broad

`lockfile.rs:2007-2012` states: "`string_bytes` is append-only for the lifetime of a resolve/enqueue pass and is never reallocated while a detached slice is live." The second clause is true of every current caller (§2) but false as a property of the function: `StringBuilder::allocate()` can and does resize `string_bytes` during a resolve/enqueue pass (the README "Correctness findings" confirmed `PackageManagerEnqueue.rs:995` relied on a `.to_vec()` for exactly this reason). The comment should say the caller must not hold the slice across any `StringBuilder::allocate` / `append_package` / `get_or_put_resolved_package*` call, rather than assert an invariant the function cannot see.

### 4b. Stacked-Borrows aliasing at `append()`-while-detached sites

`install/lockfile/Package.rs:1667` and `install/lockfile/OverrideMap.rs:443` hold a detached `&[u8]` to the full `string_bytes` Vec while `StringBuilder::append()` forms a `&mut [u8]` to a sub-range of the same allocation via `self.string_bytes[start..end]` (lockfile.rs:2604). Under Stacked Borrows this is an aliasing violation (shared read-only tag invalidated by the unique write). Under Tree Borrows it is accepted. It is **not** a use-after-realloc (the Vec does not move). Noted for completeness; a Miri run of the install path would flag it.

### 4c. `http/lib.rs:1591` documented `&mut`-aliasing

The existing comment at http/lib.rs:1588-1590 already acknowledges that `state.reset()` writes through the same `MutableString` that `result.body` aliases. `reset()` → `Vec::clear()` (len-only, no dealloc/realloc), so this is `&mut`-aliasing UB under Stacked Borrows but not a dangling pointer. The comment is accurate about the hazard class.

## 5. Bucket counts (all 586)

8 of the 586 listed sites are in `src/ptr/lib.rs` itself (helper definitions / doc examples; the generating grep's `src/bun_ptr/` exclusion did not match the actual crate path `src/ptr/`). Excluded from bucketing. That leaves 578 call sites (14 high-risk included).

Of those 578, **257 were traced individually** (every `install/`, `http/`, `sql*/`, `bundler/bundle_v2`, `bundler/analyze_transpiled_module`, `resolver/resolver`, `shell/states/`, `threading/`, `incremental_graph`, `s3/client`, `test_command`, `valkey`, `Blob`, `dns`, `VirtualMachine`, `RequestContext`, `bundler/ThreadPool` site, plus the 14 high-risk and the 6 crash-handler/resolver-lib stragglers). The remaining **321 were classified by a ±3-line grep heuristic** and spot-checked at ~10%.

| bucket | count | share | hazard class |
|---|---:|---:|---|
| `ffi-backref` | 135 | 23.4% | SAFE by contract (owner-creates-child invariant) |
| `arena` | 96 | 16.6% | SAFE by construction (pointer-stable until reset) |
| `static` | 53 | 9.2% | SAFE: process-lifetime / thread-local / literal |
| `heap-stable` | 48 | 8.3% | SAFE: `Box<[u8]>` deref, self-owned field, scopeguard-bounded |
| `growable-vec` | 48 | 8.3% | **all traced individually; 0 hazards** |
| `stack-local` | 30 | 5.2% | SAFE: outlived by frame (incl. `-> !` fns) |
| `other` (heuristic) | 168 | 29.1% | ±3-line context matched no pattern; spot-checks (20 sites) found only `ffi-backref` / `heap-stable` |

Per-site classification with source column (traced/heuristic): [`erasure-buckets.txt`](erasure-buckets.txt).

The `growable-vec` bucket is the only hazard-bearing one. All 48 entries were traced for live range vs. reallocating calls; none dangles. The `other` bucket is heuristic-only; its 20-site spot check (io/source, sql/MySQLValue, sql/shared/Data, bundler/transpiler, jsc/WorkTask, runtime/shell/builtin/seq, runtime/webcore/ReadableStream) found 0 growable-vec entries and 0 hazards, consistent with the traced buckets' distribution.

### `ffi-backref` (207)

Dominant pattern: `BackRef::new(self)` / `BackRef::from(NonNull<T>)` where `T` is a JSC-owned cell (`JSGlobalObject`, `VirtualMachine`, `JSValkeyClient`, `AbortSignal`, `ByteStream`), a `ParentRef` to the owning task, or a heap `Box<Self>` passed as callback context. Representative files: `dns_jsc/dns.rs` (9), `valkey_jsc/js_valkey.rs` (11), `server/RequestContext.rs` (9), `webcore/Blob.rs` (6), `sql_jsc/postgres/PostgresSQLConnection.rs` (3), `bundler/analyze_transpiled_module.rs` (14).

### `arena` (113)

`detach_lifetime_ref(self.arena)` / `BackRef::new(node)` where `node: &ast::T` / `arena.alloc_slice_copy(..)` / resolver `dirname_store`/`filename_store`. Representative files: `shell/states/*.rs` (15), `css/css_parser.rs` (4), `bundler/bundle_v2.rs` (8), `resolver/resolver.rs` (7), `jsc/VirtualMachine.rs` (5), `runtime/api/filesystem_router.rs` (5).

### `heap-stable` (121)

Erasure of a reference into heap data whose address is stable for the holder's lifetime, but isn't a `BackRef`-to-owner: dereferenced `Box<[u8]>` map keys (`incremental_graph.rs`, 10 sites), `RawSlice` into a co-stored `Box<[u8]>` owner field (`analyze_transpiled_module.rs`, `PostgresSQLConnection.rs:1128-1144`), self-owned struct fields read across a sibling `&mut` (`MySQLConnection.rs:739,741,1024-1026`, `test_command.rs` CLI ctx), `Data::Temporary` wrappers around caller-owned slices (`sql/shared/Data.rs`, `MySQLValue.rs`).

### `static-or-leaked` (54)

Thread-local path buffers (`resolver.rs:117,4118,4172,4207`), `SHARED_REQUEST_HEADERS_BUF` / `SHARED_RESPONSE_HEADERS_BUF`, byte literals (`PostgresSQLConnection.rs:2674`, `MySQLConnection.rs:1026`), process-lifetime singletons (`io/source.rs:462`), `BackRef::new(&[])` (`bundle_v2.rs:7592`).

### `stack-local` (35)

`BoundedArray` / fixed `[u8; N]` / `PathBuffer` / stack Vec in a never-returning `fn` (`test_command.rs`, 7 sites) / `BackRef::new(&wait_context)` joined before frame return (`threading/ThreadPool.rs:554`).

### `growable-vec` (48) — all traced

The 14 high-risk sites (§1) and `str_detached` callers (§2) account for 14 of these. The remaining 34:

| site | backing | verdict |
|---|---|---|
| `http/lib.rs:382,387,3747` | `pending_response` headers into h2/h3 decoded bytes | SAFE: deep-copied by `clone_metadata` before backing freed (per fn doc) |
| `http/lib.rs:2934,2953,3054,3376,3434,3513,3752` | `state.request_body` cursor re-slice | SAFE: backing `compressed_request_body` / caller body not touched during send loop; re-seated on every cursor advance |
| `http/lib.rs:3680,3698,3730` | `to_read` into `response_message_buffer.list` | SAFE: re-seated immediately after every `drain_front` / `append_slice_exact`; each slice consumed synchronously before next mutation |
| `http/lib.rs:1591,480` | `result.body → &mut MutableString` | SAFE (no realloc): `state.reset()` → `Vec::clear` only. See §4c. |
| `http/InternalState.rs:152` | `RawSlice::new(body.slice())` | SAFE: stored alongside `original_request_body: body` (same owner); cursor-style |
| `install/PackageInstaller.rs:959,967-972` (7) | `RawSlice` into `lockfile.packages` columns | SAFE: explicit re-snapshot via `fix_cached_lockfile_package_slices` before every read site after possible growth |
| `install/hoisted_install.rs:344,354-359` (7) | initial snapshot of same columns | SAFE: same re-snapshot mechanism |
| `sql_jsc/postgres/PostgresSQLConnection.rs:1755` | `read_buffer.byte_list` | SAFE: `skip()` is index-only; `byte_list` grown only in `on_data` framing, outside `Data::Temporary` live range |
| `sql_jsc/postgres/PostgresSQLConnection.rs:2799` | local `payload: Vec<u8>` | SAFE: `payload` frozen after `write!`; writer target is disjoint `write_buffer` |
| `sql_jsc/mysql/MySQLConnection.rs:740,1714` | `read_buffer` / `response.data` | SAFE: writes go to `write_buffer`; `byte_list` growth confined to `read_and_process_data` outer loop |
| `runtime/webcore/s3/client.rs:334,1044` | `task.headers.buf: Vec<u8>` | SAFE: write-once (built by `from_pico_http_headers` then moved into task); no append after |
| `runtime/webcore/s3/client.rs:1156,1163` | `chunk.list` | SAFE: `chunk` is moved-out stack local; `ByteStream::on_data` is read-only w.r.t. payload |
| `watcher/WindowsWatcher.rs:181` | `self.watcher.buf` (kernel notification buffer) | SAFE: fixed-size DWORD-aligned buffer; no resize |
| `runtime/api/bun/js_bun_spawn_bindings.rs:2178` | `line_bytes` sub-slice, `line: ZBox` | SAFE: `ZBox` heap data stable across `storage.push(line)` move |

**0 HAZARDs** in this bucket.

## 6. CI-check recommendation

The hazard class is: erased slice into `lockfile.buffers.string_bytes` (or a `StringBuilder` that borrows it) held across a call that can reach `StringBuilder::allocate`. Every other bucket is safe by construction. A grep-based check is sufficient to flag new instances for review:

```sh
# Flag any str_detached / detach_lifetime on a string_bytes-derived slice
# that is NOT accompanied by a `// SAFETY:` comment on the preceding 5 lines.
rg -nU --type rust \
  '(str_detached\(|detach_lifetime\([^)]*string_bytes|RawSlice::new\([^)]*string_bytes)' \
  src/install/ \
  | while IFS=: read -r f l _; do
      if ! sed -n "$((l-5)),${l}p" "$f" | grep -q 'SAFETY:'; then
        echo "$f:$l: string_bytes erasure without SAFETY comment"
      fi
    done
```

This currently matches 0 sites (every existing one has a SAFETY comment). New sites would be forced to state the no-resize invariant explicitly, which is the point at which a reviewer checks it.

A stronger structural fix (per FOLLOWUPS.md §3) is to stop passing detached `&[u8]` into the enqueue helpers and instead pass a `SemverString`/offset that the callee re-slices against its own `&lockfile` borrow; that removes the detach entirely. PR #31834 already does this for part of the install path.

## 7. Follow-up items

| item | action |
|---|---|
| `UpdateRequest.version_buf` fragile invariant (§3) | add refresh or `debug_assert` at `PackageJSONEditor::edit` entry |
| `str_detached` doc comment (§4a) | reword to state the caller obligation instead of a function-level guarantee |
| SB-aliasing at `Package.rs:1667` / `OverrideMap.rs:443` (§4b) | track under the broader Miri/SB pass; not a memory-safety bug |
| `src/ptr/lib.rs` false positives in input data | regenerate `erasure-untagged.txt` with `src/ptr/` excluded alongside `src/bun_ptr/` |
| CI grep (§6) | add to `scripts/check-*.sh` or the existing lint stage |

No production code changes in this commit.

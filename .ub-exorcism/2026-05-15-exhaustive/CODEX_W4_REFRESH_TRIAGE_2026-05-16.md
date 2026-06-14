# Codex W4 Refresh Triage — 2026-05-16

This file triages what must be refreshed after upstream `origin/main` advanced
from audited base `4d443e5402` to latest fetched `e750984db6`.

## Remote Drift Summary

```text
4d443e5402 audited base used by 2026-05-15-exhaustive
e750984db6 latest fetched origin/main on 2026-05-16
```

New commits:

```text
e750984db6 cargo fmt
880ee8929f Clean up Zig-port phase comments and trivial lint warnings (#30877)
e520065ebb Harden 36 reachable security findings across runtime, install, parsers, http (#30722)
f7c692ae9c Fix worker teardown crash from missing dupeRef on synthetic-module specifiers (#30882)
8438ff7baa resolver: split the port's module wrapper into files; type the extern-Rust pointers (#30880)
f85020a32f hooks: deny direct rustfmt, point at cargo fmt --all (#30881)
2a3d0e7d29 resolver: keep forward slashes when imports target is a package specifier (#30845)
```

## Broad Diff Impact

`git diff --name-only 4d443e5402..origin/main -- src packages/bun-native-plugin-rs`
touches 686 Rust/package files. A naive intersection with registry source
anchors hits 77 EXP entries. This is too broad for a meaningful first pass
because the range includes a repo-wide cargo-fmt cleanup and resolver
reorganization.

## High-Value First Refresh: Commit `e520065ebb`

The material commit is:

```text
e520065ebb Harden 36 reachable security findings across runtime, install, parsers, http (#30722)
```

`git show --stat e520065ebb -- src packages/bun-native-plugin-rs` reports 31
Rust files changed, 716 insertions, 118 deletions.

Registry intersections with those 31 files:

| EXP | live verdict in this run | touched file(s) | refresh action |
|---|---|---|---|
| EXP-011 | `CONFIRMED_UB` | `src/http/lib.rs` | Re-check picohttp NUL-write / shared-provenance claim; likely candidate for `FIXED_BY_e520065ebb` or `PARTIALLY_FIXED`. |
| EXP-039 | `NO_EVIDENCE` after Codex correction | `src/runtime/socket/Listener.rs` | W4 re-check found `e520065ebb` did not target the `ptr::read` window, but the audit itself overcounted: only `:235` / `:317` have allocation-prone `take_protos()` before `mem::forget`; Bun's supported profiles abort on panic. Keep as unwind-regression guard, not current production UB. |
| EXP-057 | `CONFIRMED_UB` | `src/sql_jsc/postgres/PostgresSQLConnection.rs` | Re-check the caller-chosen-lifetime cluster member in Postgres SQL JSC. |
| EXP-072 | `CONFIRMED_UB` | `src/runtime/server/server_body.rs` | Re-check HiveArray deprecated raw-slot caller coverage. |
| EXP-082 | `CONFIRMED_UB` | `src/runtime/webcore/Blob.rs` | Re-check `Blob: Send + Sync` / JS-thread-affinity safe-API contract. |
| EXP-088 | `CONFIRMED_UB` | `src/parsers/yaml.rs` | Re-check YAML caller in the UTF-16 narrowed-provenance cluster. |
| EXP-017 | `NO_EVIDENCE` | `src/runtime/webcore/Blob.rs` | Regression guard only; verify it remains no-evidence after Blob changes. |
| EXP-020 | `DEFERRED` | `src/http/lib.rs` | Strict-provenance migration; verify commit did not accidentally fix or worsen the URL/http pointer path. |

## Correct Refresh Order

1. Start from latest fetched `origin/main@e750984db6` in a fresh
   `claude/ub-exorcist-refresh-YYYYMMDD` branch.
2. Re-check the six touched `CONFIRMED_UB` rows above first.
3. Then re-run a broader `git diff --name-only 4d443e5402..origin/main`
   intersection for the remaining confirmed entries.
4. Only after the refresh table exists should `FINAL_UB_REPORT.md` be updated
   from pinned-base wording to latest-main wording.

## Direct Diff Read of `e520065ebb` Intersections

Codex re-read the exact `e520065ebb^..e520065ebb` hunks for the six
confirmed-entry intersections. Result: the commit is a substantial security
hardening pass, but it does **not** close five of the six UB entries below. The
sixth (`EXP-039`) was not fixed by the commit either; it was separately demoted
by the panic-policy/source-scope correction.

| EXP | Latest-main status after direct diff read | Evidence |
|---|---|---|
| EXP-011 | Still live on `origin/main@e750984db6` | `e520065ebb` does not touch `src/picohttp/lib.rs`; latest `src/picohttp/lib.rs:363-383` still passes `buf.as_ptr()` to `phr_parse_request` and then writes `unsafe { path_ptr.cast_mut().add(path_len).write(0) }`. The `src/http/lib.rs` hunk was unrelated. |
| EXP-039 | Demoted to `NO_EVIDENCE` by audit correction, not fixed by `e520065ebb` | `e520065ebb` adds `active_connections` checks around reused handler freeing, but does not target the `ptr::read` / `mem::forget` panic window. Separate source re-check found only `Listener.rs:235` and `:317` have allocation-prone `take_protos()` before `mem::forget`; `panic = "abort"` makes this an unwind-regression guard. |
| EXP-057 | Still live for the Postgres cluster member | The Postgres hunk bounds SCRAM iteration count and salt sizes around `:2694+`. It does not change `PostgresSQLConnection::vm_mut(&self) -> &'static mut VirtualMachine` at `:218` or `event_loop(&self) -> &'static mut EventLoop` at `:228`, which are the EXP-057 cluster anchors in this file. |
| EXP-072 | Still live for the `server_body.rs` caller | The `server_body.rs` hunk changes IPv6 loopback authorization (`starts_with(b"::1")` to equality). It does not change `(*this.request_pool).get()` at `src/runtime/server/server_body.rs:3415`, the deprecated HiveArray raw-slot caller. |
| EXP-082 | Still live | The `Blob.rs` hunk copies proxy URL href bytes before re-entrant JS/env access. That is a good lifetime hardening fix, but `src/jsc/webcore_types.rs:90-96` still has `unsafe impl Send` + `Sync` for `Blob`, and `Blob::global_this(&self) -> Option<&JSGlobalObject>` remains safe at `:224-230`. |
| EXP-088 | Still live | The `yaml.rs` hunk fixes scalar resolver boolean precedence around `.inf` parsing. It does not change `E::String::init_utf16` / `slice16` in `src/ast/e.rs:1412-1458` or the YAML UTF-16 call at `src/parsers/yaml.rs:1777-1785`. |

Non-confirmed intersections:

| EXP | Status |
|---|---|
| EXP-017 | Remains `NO_EVIDENCE`; the Blob proxy-href fix does not create a new post-publication callback write path. |
| EXP-020 | Remains `DEFERRED`; the `src/http/lib.rs` hunk does not address the strict-provenance URL/int-pointer reconstruction family. |

## Other Material Source Commits

### `f7c692ae9c` — upstream fixed an additional refcount bug not counted in this registry

`f7c692ae9c Fix worker teardown crash from missing dupeRef on synthetic-module
specifiers (#30882)` touches only `src/runtime/jsc_hooks.rs`, but it is
important for report defensibility. The commit message describes a real
post-run upstream fix: synthetic-module `ResolvedSource` producers copied
`specifier` / `source_url` by value (`*specifier`) even though
`~SourceProvider()` later derefs both fields. On audited base `4d443e5402`,
the affected `bun:main`, `bun:wrap`, `macro:`, standalone-graph, and embedded
sqlite paths therefore handed C++ borrowed `BunString` references without the
extra +1 ownership the destructor expects. Latest `origin/main@e750984db6`
uses `specifier.dupe_ref()` for those fields.

**Status:** `FIXED_UPSTREAM_AFTER_RUN`, not a live latest-main finding.

**Audit implication:** this is an externally discovered refcount/lifetime bug
that the UB registry did not promote as an EXP. Phase-1 K did identify
`OwnedResolvedSource::into_ffi()` / `mem::forget(self)` as the one true
ResolvedSource ownership-transfer surface, but the run did not follow that
invariant into every synthetic-module producer. Do not market the registry as
"every bug Bun had at `4d443e5402`"; market it as 70 confirmed registry
witnesses (after later Codex promotions through EXP-111 and the EXP-109
demotion) plus this W4-discovered upstream-fixed miss.

### `8438ff7baa` — resolver split / typed extern-Rust pointers

This commit reorganizes the resolver and removes several unnecessary erased
`*mut ()` / `*mut c_void` casts in favor of typed `NonNull<T>`. It intersects
several registry files, but direct source reads show it does not close the
confirmed entries below:

| EXP | Latest-main status after `8438ff7baa` | Evidence |
|---|---|---|
| EXP-026 | Still live | `src/runtime/jsc_hooks.rs:timer_all_mut()` is unchanged, and latest `src/runtime/timer/mod.rs` still has `get_timeout(&mut self, ...)` / `drain_timers(&mut self, ...)` plus the in-source TODO that the call-site auto-ref creates a live `&mut All` for the frame. |
| EXP-044 | Still live | Latest `src/bundler/bundle_v2.rs` still has `Resolve::run_on_js_thread(&mut self)` and `Load::run_on_js_thread(&mut self)` forming `unsafe { &mut *self.bv2 }.plugins_mut()` at lines ~1212 and ~1361. The line numbers shifted, but the `&mut BundleV2` reborrow shape remains. |
| EXP-079 | Still live | Latest `src/bundler/transpiler.rs:260-266` still has safe `pub fn env_mut(&self) -> &'a mut dot_env::Loader<'a>` returning `unsafe { &mut *self.env }`. The `NonNull<Log>` cleanup does not touch this safe-API aliasing issue. |
| EXP-084 | Still live | Latest `src/jsc/VirtualMachine.rs` still declares `unsafe impl Sync` and `unsafe impl Send`, and safe `as_mut(&self)` / `get_mut()` still route through TLS-backed `get_mut_ptr().unwrap_unchecked()`. The resolver log-pointer type cleanup does not touch the safe cross-thread trap. |

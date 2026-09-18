# Bench targets for (B) clusters

Companion to `B-001-and-B-002-perf-only.md`. Maps every B-candidate-hot and
(B-UNMEASURED) site to the Bun benchmark that exercises its hot path. All
benches live in `bench/` and are runnable via the standard
`bun run <snippet>` invocation.

Codex pass 2 note: any older `B-PROVEN-HOT` label in this file should be read
as "candidate hot" until the benchmark log is attached to the audit.

## Harness

For each cluster member:

```bash
# Baseline (default build)
cargo build --release -p bun_bin
hyperfine --warmup 3 --runs 10 -N \
    'BUN=./build/release/bun-debug bun bench/snippets/<target>.mjs'

# safe-only build. The feature is package-scoped; the root crate must either
# declare a passthrough `safe-only` feature or pass package-qualified features
# for every touched crate.
cargo build --release -p bun_bin --features bun_bin/safe-only
hyperfine --warmup 3 --runs 10 -N \
    'BUN=./build/release/bun-debug bun bench/snippets/<target>.mjs'
```

Numbers go into `B-001-bench.md` and `B-002-bench.md` after the
implementation PR lands.

## Per-cluster mapping

### B-001 (`compiler_hint`)

| Site                                                                      | Bench target                                        | Hot-path role                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `bun_bundler/transpiler.rs:1932`                                          | `bench/bundle/index.ts`                             | Data-loader dispatch (JSON/TOML/YAML import)             |
| `bun_event_loop/MiniEventLoop.rs:301,311`                                 | `bench/snippets/http-hello.js`                      | Every IO callback (FilePoll → event loop dispatch)       |
| `bun_event_loop/MiniEventLoop.rs:302`                                     | `bench/snippets/native-overhead.mjs`                | Same as above                                            |
| `bun_install/lockfile/Tree.rs:1131`                                       | `bench/install/` (next-forge fixture)               | Inner loop of `hoist_dependency` (~120k calls/install)   |
| `bun_install/PackageManagerTask.rs:284,542,545`                           | `bench/install/`                                    | Per-package manifest completion (network IO bound)       |
| `bun_jsc/generated.rs:409,464,494,622`                                    | `bench/snippets/native-overhead.mjs` (startup)      | TLS config conversion at `Bun.serve` startup             |
| `bun_runtime/api/js_bundle_completion_task.rs:504,599,621,755`            | `bench/bundle/index.ts`                             | Once per `Bun.build()` completion                        |
| `bun_runtime/bake/DevServer.rs:5913`                                      | `bench/snippets/http-hello.js` (with `--inspect`)   | `inspector()` accessor on every DevServer request        |
| `bun_alloc/lib.rs:1486` (`secure_zero`)                                   | `bench/crypto/random.mjs`                           | Sensitive memory clearing on `Bun.SSLConfig` drop        |
| `bun_runtime/api/crash_handler_jsc.rs:92`                                 | (test-only, no bench)                               | Deliberate SEGV for crash-handler test                   |

### B-002 (`unchecked_index`)

| Site                                                                      | Bench target                                                       | Hot-path role                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `bun_base64/lib.rs:606,622`                                               | `bench/snippets/atob.mjs`, `bench/snippets/buffer-base64.mjs`      | Per-byte base64 decode                                 |
| `bun_core/string/immutable.rs:486`                                        | `bench/snippets/buffer-to-string.mjs`                              | Every UTF-8 codepoint walk (JSC string ops)            |
| `bun_core/string/immutable.rs:1499`                                       | `bench/scanner/scan.bun.js`, `bench/bundle/index.ts`               | Lexer keyword/prefix matching                          |
| `bun_css/selectors/parser.rs:65`                                          | `bench/snippets/markdown.mjs`                                      | CSS `SmallList::into_box` drain                        |
| `bun_http/HTTPThread.rs:987` (`ThreadCell`, mis-tagged)                   | `bench/snippets/http-hello.js`                                     | Cross-thread `HTTP_THREAD` access (debug-check skip)   |
| `bun_install/lockfile/Tree.rs:1020`                                       | `bench/install/`                                                   | Inner `deps[dep_id]` lookup in hoist                   |
| `bun_io/lib.rs:683,821`                                                   | `bench/snippets/http-hello.js`, `bench/snippets/cat/bun.js`        | IO request loop access                                 |
| `bun_semver/lib.rs:536,537,613`                                           | `bench/snippets/semver.mjs`                                        | Pointer projection in every semver compare             |
| `bun_sourcemap/InternalSourceMap.rs:1006`                                 | `bench/sourcemap/`, `bench/bundle/index.ts`                        | `append_mapping` per emitted source-map entry          |

### `slice_from_raw` (B-PROVEN-HOT subset)

| Site cluster                                                              | Bench target                                                       | Hot-path role                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `bun_alloc/lib.rs:2599-2831` (string pool internals)                      | `bench/install/` (manifest parse)                                  | ~10M slice fabrications per `bun install`              |
| `bun_alloc/MimallocArena.rs:460,500,532`                                  | `bench/bundle/index.ts`                                            | Arena `dupe`/`init_with` in parser                     |
| `bun_collections/multi_array_list.rs:508,521,555-562,779,792`             | `bench/bundle/index.ts`, `bench/scanner/scan.bun.js`               | Columnar AST data layout — every AST walk              |
| `bun_collections/bit_set.rs:839,853,971`                                  | `bench/bundle/index.ts`                                            | Bundler's reachability bit-sets                        |
| `bun_core/string/mod.rs:1780,1890,2083`                                   | All string-touching benches                                        | `WTFStringImpl` ↔ `&[u8]` projection                   |
| `bun_jsc/array_buffer.rs:291,564,574,614`                                 | `bench/snippets/buffer-create.mjs`, `buffer-read.js`               | `ArrayBuffer` Rust-side view                           |

## What "regression" means

For each site, the criterion is a > 5% p50 throughput delta between the
`default` and `safe-only` builds on the listed bench, replicated across two
machines. A < 5% delta is consistent with measurement noise on the Linux CI
fleet (and within the ±2% inter-run variance observed for these benches).

The companion `B-001-bench.md` / `B-002-bench.md` artifacts get written after
the first `safe-only` implementation PR (above) merges and the lane runs for
its first stable week.

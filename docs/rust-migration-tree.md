# Zig directory restructure → 1:1 `.rs` tracking

Goal: `src/<crate>/**/*.zig` ↔ `crates/bun_<crate>/src/**/*.rs`. One `git mv` pass (Zig-only, no behavior change), then agents create the parallel `.rs` per file. The spine HTML auto-generates from a `find` diff.

## Mapping (current → target)

| Current                                                                                                                                                            | → `src/<crate>/`                              | Rust crate                                                | Notes                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/sys.zig`, `src/sys/`, `src/fd.zig`                                                                                                                            | `src/sys/`                                    | `bun_sys`                                                 | already close                                                             |
| `src/string/`, `src/string.zig`, `src/bun.js/bindings/ZigString.zig` (the type, not bindings)                                                                      | `src/str/`                                    | `bun_str`                                                 |                                                                           |
| `src/allocators/`, `src/memory_allocator.zig`, `src/hive_array.zig`, `src/baby_list.zig`, `src/multi_array_list.zig`                                               | `src/alloc/`                                  | `bun_alloc` (only `mi_*` + `Arena`); rest stays per-crate | hive_array/baby_list become per-crate copies, not shared                  |
| `src/thread_pool.zig`, `src/work_pool.zig`                                                                                                                         | `src/threadpool/`                             | `bun_threadpool`                                          |                                                                           |
| `src/async/`, `src/bun.js/event_loop/` (Task, ConcurrentTask, EventLoopTimer, AutoFlusher, DeferredTaskQueue, MiniEventLoop), `src/bun.js/api/Timer/`              | `src/async/`                                  | `bun_async`                                               | **§6 relocation** — these are under `jsc.*` namespace but have no JSC dep |
| `src/deps/uws.zig` (Loop/Socket/Context FFI)                                                                                                                       | `src/async/uws.zig`                           | `bun_async::uws`                                          | FFI decls only                                                            |
| `src/http.zig`, `src/http/`                                                                                                                                        | `src/http/`                                   | `bun_http`                                                | move `Method.toJS`, `H2Client.zig:44-46` → `runtime/http_jsc/`            |
| `src/ast/`, `src/js_lexer*.zig`, `src/js_parser.zig`, `src/js_printer.zig`, `src/js_ast.zig`                                                                       | `src/ast/`                                    | `bun_ast`                                                 |                                                                           |
| `src/toml/`, `src/yaml/`, `src/json5_*.zig`, `src/md/`                                                                                                             | `src/ast/{toml,yaml,jsonc,md}/`               | `bun_ast` submods                                         |                                                                           |
| `src/install/` minus `install_binding.zig`, `npm.zig:jsFunction*`, `security_scanner.zig`                                                                          | `src/install/core/`                           | `bun_install_core`                                        |                                                                           |
| `src/install/{install_binding,security_scanner}.zig`, `npm.zig` JS fns                                                                                             | `src/install/jsc/`                            | `bun_install_jsc`                                         |                                                                           |
| `src/bundler/` minus `JSBundleCompletionTask`, plugin host                                                                                                         | `src/bundler/core/`                           | `bun_bundler_core`                                        | move `HardcodedModule.Alias` → `src/resolve_builtins/`                    |
| `src/bundler/` JS-touching                                                                                                                                         | `src/bundler/jsc/`                            | `bun_bundler_jsc`                                         |                                                                           |
| `src/css/`                                                                                                                                                         | `src/css/`                                    | `bun_css`                                                 |                                                                           |
| `src/resolver/`, `src/ModuleLoader/HardcodedModule.zig`                                                                                                            | `src/resolve_builtins/` + `src/ast/resolver/` | split: builtins map (no jsc) vs resolver (uses ast)       |                                                                           |
| `src/semver.zig`, `src/install/semver/`                                                                                                                            | `src/semver/`                                 | `bun_semver`                                              |                                                                           |
| `src/url.zig`, `src/bun.js/URL.zig`                                                                                                                                | `src/url/`                                    | `bun_url`                                                 |                                                                           |
| **— JSC boundary —**                                                                                                                                               |                                               |                                                           |                                                                           |
| `src/bun.js/jsc.zig`, `bindings/JSValue.zig`, `bindings/JSRef.zig`, `Strong.zig`, `bindings/CallFrame.zig`, `jsc/host_fn.zig`, `bindings/MarkedArgumentBuffer.zig` | `src/jsc/`                                    | `bun_jsc`                                                 | the §5 primitives                                                         |
| `src/bun.js/bindings/*.{h,cpp}`, `headers-handwritten.h`, codegen output                                                                                           | `src/jsc/bindings/` (stays C++)               | —                                                         | unchanged                                                                 |
| **— Runtime —**                                                                                                                                                    |                                               |                                                           |                                                                           |
| `src/bun.js/api/**/*.zig` (every `.classes.ts` impl)                                                                                                               | `src/runtime/api/`                            | `bun_runtime`                                             | one subdir per class (`glob/`, `socket/`, `server/`, ...)                 |
| `src/bun.js/webcore/`                                                                                                                                              | `src/runtime/webcore/`                        | `bun_runtime`                                             |                                                                           |
| `src/bun.js/node/`                                                                                                                                                 | `src/runtime/node/`                           | `bun_runtime`                                             |                                                                           |
| `src/sql/{postgres,mysql,shared}/` (protocol)                                                                                                                      | `src/sql/`                                    | `bun_sql_core`                                            | already split for MySQL; do Postgres                                      |
| `src/sql/**/js/`                                                                                                                                                   | `src/runtime/sql/`                            | `bun_runtime`                                             |                                                                           |
| `src/valkey/`                                                                                                                                                      | `src/valkey/` (proto) + `src/runtime/valkey/` | split                                                     |                                                                           |
| **— Deferred —**                                                                                                                                                   |                                               |                                                           |                                                                           |
| `src/shell/`                                                                                                                                                       | `src/shell/`                                  | —                                                         | stays                                                                     |
| `src/bake/`                                                                                                                                                        | `src/bake/`                                   | —                                                         | stays                                                                     |
| `src/cli/`                                                                                                                                                         | `src/cli/`                                    | `bun_cli` (late)                                          |                                                                           |
| `src/crash_handler.zig`                                                                                                                                            | `src/panic/`                                  | `bun_panic` calls into it                                 |                                                                           |

## The `git mv` pass (P-1, before any Rust)

One mechanical Zig-only PR per crate-dir, in this order (each compiles green):

1. `src/async/` ← event_loop pieces + uws Loop FFI (the §6 relocation — biggest churn, ~40 import fixups)
2. `src/jsc/` ← JSValue/JSRef/Strong/CallFrame/host_fn out of `bun.js/bindings/`
3. `src/install/{core,jsc}/` split
4. `src/bundler/{core,jsc}/` split
5. `src/http/` ← flatten `http.zig` + move `Method.toJS` etc. to `runtime/http_jsc/`
6. `src/runtime/` ← rename `src/bun.js/{api,webcore,node}` (largest mv, pure rename)
7. `src/ast/` ← absorb js_lexer/parser/printer + toml/yaml/md
8. `src/{str,alloc,threadpool,semver,url,resolve_builtins,panic}/` ← small moves

After: `find src -maxdepth 1 -name "*.zig" | wc -l` should be near-zero (only `bun.zig`, `main.zig`, `build.zig`).

## Tracking: `.rs` per `.zig`

```
src/http/HTTPThread.zig          ←→  crates/bun_http/src/thread.rs
src/runtime/api/glob.zig         ←→  crates/bun_runtime/src/api/glob.rs
src/jsc/JSRef.zig                ←→  crates/bun_jsc/src/jsref.rs
```

`scripts/migration-status.ts` (run nightly + on every `rust-port` PR):

```ts
// for every src/<crate>/**/*.zig:
//   rs = crates/bun_<crate>/src/<same-path-snake_case>.rs
//   status = !exists(rs) ? "todo"
//          : (zig file has `// PORTED: rust` header) ? "done"
//          : "wip"
// emit docs/rust-migration-spine.html with per-file lights + LOC bar
// emit docs/rust-migration-status.json for CI gate
```

A `.zig` flips to `done` when:

- parallel `.rs` exists
- the `.zig` file's only remaining export is `pub const __ported_to_rust = true;` (or it's deleted)
- `impl: "rust"` in the owning `.classes.ts` (for runtime/)

## Why this ordering matters

The `git mv` pass **is** the §6 relocation table from the plan — it's the prerequisite that makes the Layer-1-⊬-`bun_jsc` rule enforceable in Zig _before_ any Rust exists. Do it first; it derisks the crate boundary and gives agents an unambiguous target path for every file.

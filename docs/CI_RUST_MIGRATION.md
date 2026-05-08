# CI: Zig → Rust migration

Status: **applied** (branch `claude/phase-h-ci-rust`). This document records
what changed in the CI split-build path and how to dry-run it before flipping
the BuildKite pipeline on `main`.

## What changed

| Before | After |
|---|---|
| `BuildMode = "zig-only"` | `BuildMode = "rust-only"` |
| `emitZigOnly()` → `bun-zig.o` | `emitRustOnly()` → `libbun_rust.a` (`bun_rust.lib` on Windows) |
| `<target>-build-zig` step key | `<target>-build-rust` |
| `dl("zig")` in link-only | `dl("rust")` |
| `zigObjectPaths(cfg)` in link-only | `[rustLibPath(cfg)]` |
| `ci-zig-only` profile | `ci-rust-only` profile |
| `bun run zig:check` / `zig:check-all` | `bun run rust:check` / `rust:check-all` |
| `bun run fmt:zig` | `bun run fmt:rust` (`cargo fmt --all`) |
| `bun run watch` (`zig build check --watch`) | `cargo watch -x check` |
| Zig error → BuildKite annotation | rustc `error[Exxxx]:` → annotation (`scripts/utils.mjs`) |

`scripts/build/zig.ts` is **kept** (the `.zig` files remain in-tree as the
porting spec) but is no longer on the default build path: `rules.ts` no
longer registers `zig_fetch`/`zig_build`, and `bun.ts` no longer imports
`emitZig`/`zigObjectPaths`.

## Cross-compilation matrix

Zig bundled a libc + SDK for every target, so one Linux box could
cross-compile `bun-zig.o` for *every* platform. Cargo does not — it
delegates to a host C toolchain for any `cc`-crate / `bindgen` / archive
step. The boundary is therefore "does the host have a C cross-toolchain
for the target", not "does rustc support the triple". See
`rustCanCrossFromLinux()` in `scripts/build/rust.ts`.

| Target | Triple | Cross from Linux? | Agent |
|---|---|---|---|
| linux-x64-gnu | `x86_64-unknown-linux-gnu` | yes | shared `r8g.2xlarge` |
| linux-aarch64-gnu | `aarch64-unknown-linux-gnu` | yes | shared `r8g.2xlarge` |
| linux-x64-musl | `x86_64-unknown-linux-musl` | yes | shared `r8g.2xlarge` |
| linux-aarch64-musl | `aarch64-unknown-linux-musl` | yes | shared `r8g.2xlarge` |
| linux-aarch64-android | `aarch64-linux-android` | yes (NDK in image) | shared `r8g.2xlarge` |
| freebsd-x64 | `x86_64-unknown-freebsd` | yes (Tier 2, staticlib only) | shared `r8g.2xlarge` |
| darwin-x64 / aarch64 | `*-apple-darwin` | **no** — `cc` build scripts need osxcross | `build-darwin` queue |
| windows-x64 / aarch64 | `*-pc-windows-msvc` | **no** — needs MSVC SDK or `cargo-xwin` | Azure Windows agent |

Future: once `cargo-xwin` and an osxcross SDK are baked into the Linux
build image, darwin/windows can move back to the shared cross-compile box
and the `getRustAgent()` darwin/windows branches collapse.

## Artifact contract

`build-rust` uploads (relative to `buildDir`):

```
rust-target/<triple>/<profile>/libbun_rust.a.gz   (posix)
rust-target/<triple>/<profile>/bun_rust.lib       (windows)
```

`build-bun` (link-only) downloads `*` from both `<target>-build-cpp` and
`<target>-build-rust`, recursively gunzips, and `emitLinkOnly()` references
the archive at `rustLibPath(cfg)` — same formula on both ends, so any path
drift fails loudly with "file not found" at link time.

## Agent image requirements

Every image that runs `build-rust` (the shared Linux box, the `build-darwin`
queue, and the Windows agents) needs:

- `rustup` with the **exact** nightly from `rust-toolchain.toml`
  (`nightly-2026-05-06` at time of writing).
- Components: `rust-src` (for `-Zbuild-std` on Tier-3 targets).
- `rustup target add` for every triple in the matrix above that the agent
  builds. `bootstrap.sh` already installs the host triple; the Linux
  cross-compile image additionally needs the full linux/freebsd/android set.

The pinned nightly is forwarded to cargo via `RUSTUP_TOOLCHAIN` (see
`emitRust()` in `scripts/build/rust.ts`), so a stale system default
toolchain on the agent is harmless as long as the pinned one is installed.

## Dry-run plan

1. **Local configure smoke test** — for each `BuildMode`:
   ```sh
   bun scripts/build.ts --profile=ci-rust-only --os=linux --arch=x64 --abi=gnu --configure-only
   bun scripts/build.ts --profile=ci-cpp-only  --configure-only
   bun scripts/build.ts --profile=ci-link-only --configure-only
   ```
   Inspect `build/release/build.ninja` — `rust-only` should contain exactly
   one `rust_build` edge with `libbun_rust.a` as its output and `bun` as a
   phony alias for it.

2. **Pipeline YAML diff** — generate without uploading:
   ```sh
   node .buildkite/ci.mjs --dry-run > /tmp/pipeline.yml
   ```
   Grep for `build-zig` / `zig-only` (should be **0**), `build-rust`
   (should be one per build platform), and verify each `*-build-bun` step's
   `depends_on` lists `*-build-cpp` + `*-build-rust`.

3. **Annotation parser** — `scripts/utils.mjs` `parseAnnotations()` now
   recognizes `error[E0xxx]:` headers. Sanity check:
   ```sh
   echo 'error[E0308]: mismatched types
     --> src/http/lib.rs:553:5' | node -e '
       import("./scripts/utils.mjs").then(u =>
         console.log(u.parseAnnotations(require("fs").readFileSync(0, "utf8"))))'
   ```

4. **Branch CI** — push to a `ci/` branch (BuildKite picks it up without
   touching `main`). Watch the `build-rust` jobs land their artifact under
   `rust-target/…/libbun_rust.a.gz` and the `build-bun` job find it.

## Rollback

`BuildMode` is the only type-level change; reverting the `"rust-only"`
literal to `"zig-only"` and restoring the `emitZig` import in `bun.ts`
brings the old path back. `zig.ts` was not deleted.

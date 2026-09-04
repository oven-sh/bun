# Vendored dependencies

One file per dependency. Each file exports a `Dependency` object that tells
the build system where to fetch the source, how to build it, and what
libraries/headers it provides.

## Adding a dependency

1. Copy `hdrhistogram.ts` (the simplest direct dep) to `<name>.ts`
2. Fill in `name`, `repo`, `commit`, `sources`, `includes`, `provides.includes`
3. Add `import { <name> } from "./<name>.ts"` + entry in `allDeps` array in `index.ts`
4. `bun run scripts/build/phase3-test.ts` to verify it builds

That's it. For most deps you're done. If the dep needs more than a source
list (host tools, code generators, intermediate executables), use
`kind: "custom"` and emit the edges from the dep's own module with the same
`cc`/`cxx`/`link` primitives — see `deps/icu.ts` and `deps/webkit.ts`.

**`name` must match the directory on disk** (`vendor/<name>/`). If your repo
is `oven-sh/WebKit`, name it `"WebKit"` — that's what `git clone` creates.
Case-sensitive filesystems enforce this.

**Ordering in `allDeps` matters:**

- Put deps with `fetchDeps: ["X"]` AFTER X in the list
- Link order: deps that PROVIDE symbols go after deps that USE them

## Removing a dependency

1. Delete `<name>.ts`
2. Remove from `allDeps` in `index.ts`
3. If any other dep has `fetchDeps: ["<name>"]`, remove that reference

## Updating a commit

Change the `commit` field. That's it. The build system computes a source
identity hash from `sha256(commit + patch_contents)` — changing the commit
invalidates `.ref`, triggers re-fetch, and everything downstream rebuilds.

The `.github/workflows/update-<name>.yml` jobs do this automatically by
sed'ing the `const <NAME>_COMMIT = "..."` line. If you rename that
constant, update the workflow too.

**For `direct` deps:** the source list is hardcoded, so a bump that adds
or removes a `.c`/`.cpp` upstream needs a matching list edit here. CI
catches a missed addition (link error on the unresolved symbol); a
removed file fails at compile. Either way the auto-bump PR goes red,
which is the cue to diff the upstream `CMakeLists.txt`.

## Iterating on a dep from a local checkout

To hack on a vendored dep (e.g. chase a bug in the mimalloc or libuv fork)
without cutting a commit and bumping the pin each round, point the build at
a git clone:

```sh
git clone https://github.com/oven-sh/mimalloc ~/code/mimalloc
bun bd --local-deps=mimalloc=~/code/mimalloc test foo.test.ts
```

Any `github` dep the graph compiles or includes can be redirected
(so not lolhtml or rust-argon2, which cargo reads from `vendor/` via the workspace
`Cargo.toml` — point that path at your checkout instead); several at once
with `name=path,name=path`. Cross-dep references (`depSourceDir()`, e.g.
lsquic's `-I` into boringssl) follow the redirect. The checkout is compiled
as-is — no fetch, no `.ref` stamp, and the dep's `patches` are **not**
applied (they target the pinned tarball), so start the clone from the pinned
commit if you want an identical baseline. Switching a dep between pinned and
local moves its `-I` path, so the first build after the switch recompiles
every TU that sees the dep's headers; after that, edits are picked up
incrementally: `direct`/`custom` deps through the compiler depfiles,
`cargo` deps by re-invoking cargo every run. The build banner shows
`local:<name>` while this is on. Don't edit `vendor/<name>/` in place
instead — it is wiped whenever the pin or patches change. For WebKit this is
what `bun run build:local` does (`--webkit=source --local-deps=WebKit=...`).

## Common fields

```ts
export const mydep: Dependency = {
  name: "mydep",

  // A GitHub commit (no git history, just the files at `commit`). Fetched
  // from GitHub's archive endpoint, or — with `sparse: ["/dir/", ...]` —
  // as a sparse git fetch of only those paths (WebKit `--webkit=source`:
  // GitHub won't serve archives of a repo that size, and JSC is ~3% of it).
  // Most deps use this.
  //
  // Other kinds: `tarball` (a release tarball by URL, e.g. ICU), `prebuilt`
  // (download pre-compiled .a, e.g. WebKit on macOS/Windows), `local` (any
  // fetched dep becomes one via `--local-deps`, see below), `in-tree` (source
  // in src/).
  source: () => ({ kind: "github", repo: "owner/repo", commit: "..." }),

  // Optional: macro name for bun_dependency_versions.h (process.versions).
  // Omit if this dep shouldn't appear there.
  versionMacro: "MYDEP",

  // Optional: .patch files applied after extraction, or overlay files
  // copied into source root (e.g. inject a CMakeLists.txt).
  patches: ["patches/mydep/fix-something.patch"],

  // Optional: deps whose SOURCE must be ready before this one builds
  // (for -I cross-dep headers). See libarchive for an example.
  fetchDeps: ["zlib"],

  // How to build. `direct` lists sources explicitly; emitDirect compiles
  // each as a first-class cc/cxx edge and the resulting .o's go straight
  // into bun's link line. See `DirectBuild` in ../source.ts for all
  // optional fields (lang/pic/defines/headers/codegen/forbidUndefined).
  build: cfg => ({
    kind: "direct",
    sources: ["src/foo.c", "src/bar.c"],
    includes: [".", "include"],
    // defines: { MYDEP_STATIC: 1 },
    // cflags: ["-std=c11"],
    // headers: { "config.h": "..." },   // Hand-written config.h.
  }),

  // What this dep exposes to bun's own compile. `libs` is ignored for
  // direct builds (the .o's are already on the link line); `includes`
  // are relative to the SOURCE dir.
  provides: cfg => ({
    libs: [],
    includes: ["include"],
    // defines: ["MY_DEP_STATIC=1"],  // Preprocessor defines for bun's compile.
  }),

  // Optional: skip this dep on some platforms.
  enabled: cfg => !cfg.windows,
};
```

## Build types

- **`direct`**: Sources compiled as first-class `cc` edges in our ninja
  graph — no sub-process. Best for deps with a stable, small file list and
  no configure-time codegen we can't replicate. See `DirectBuild` in
  `../source.ts`. No sub-process configure, and LTO sees across the dep
  boundary into bun's call sites.
- **`custom`**: The dep's module emits its own edges (`CustomBuild` in
  `../source.ts`) and returns objects + include dirs. For deps with host
  tools / codegen chains: ICU, WebKit.
- **`cargo`**: Rust deps (currently lolhtml and rust-argon2). See `CargoBuild` in `../source.ts`.
- **`none`**: Header-only or prebuilt. No build step; `.ref` stamp is the output.

## Worked examples

- **hdrhistogram.ts** / **libdeflate.ts** — simplest direct deps
- **mimalloc.ts** — direct build, single unity TU compiled as C++
- **tinycc.ts** — direct build with a build-time codegen tool
- **zlib.ts** — direct build with per-source SIMD `-m` flags + `.h.in` substitution
- **libarchive.ts** / **cares.ts** — direct build with hand-written per-target config.h
- **boringssl.ts** — direct build with NASM assembly (win-x64) and a large gen/ manifest; `forbidUndefined` (with libuv.ts) keeps a dep that bun points at mimalloc from calling libc's allocator behind its back
- **sqlite.ts** — direct build, in-tree source (lives in `src/`, not `vendor/`)
- **libuv.ts** — `enabled: cfg => cfg.windows` for a platform-only dep
- **lolhtml.ts** — cargo build with rustflags
- **icu.ts** — `custom`: tarball source, host tool, generated data object
- **webkit.ts** — `custom` (sparse github source, ~120 codegen edges, PCH, intermediate executables) and `prebuilt`

## How the fetch works

Each fetched dep gets one ninja build statement with `restat = 1`:

- **fetch** → `vendor/<name>/.ref` stamp
  - Downloads the tarball (or sparse git fetch), extracts, applies patches
  - `.ref` contains `sha256(commit + sparse + patches)[:16]`
  - restat: if identity unchanged, no write, downstream pruned

The dep's sources are declared as implicit outputs of that edge, so the
compile edges that follow wait for it; from there they are ordinary
`cc`/`cxx` edges with depfiles.

`custom` deps (ICU, WebKit, bootstrap*cmds) are the
exception to "fetch is a ninja edge": configure describes their graph \_from*
the tree (ICU's `sources.txt`, JSC's `Sources.txt`, header directories), so
`configure.ts` fetches them itself (`prefetchConfigureSources`) whenever the
tree is missing or its `.ref` is stale, before `emitBun` runs. The
`dep_fetch` edge is still emitted for them; by the time ninja runs it is a
restat no-op that just anchors the `.ref` stamp in the graph.

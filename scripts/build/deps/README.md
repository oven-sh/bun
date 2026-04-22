# Vendored dependencies

One file per dependency. Each file exports a `Dependency` object that tells
the build system where to fetch the source, how to build it, and what
libraries/headers it provides.

## Adding a dependency

1. Copy `hdrhistogram.ts` (the simplest direct dep) to `<name>.ts`
2. Fill in `name`, `repo`, `commit`, `sources`, `includes`, `provides.includes`
3. Add `import { <name> } from "./<name>.ts"` + entry in `allDeps` array in `index.ts`
4. `bun run scripts/build/phase3-test.ts` to verify it builds

That's it. For most deps you're done. If the dep's build is too entangled
to list sources by hand (zlib-ng's per-file SIMD flags are about the
limit), use `kind: "nested-cmake"` instead — see `NestedCmakeBuild` in
`../source.ts` for the fields.

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

## Common fields

```ts
export const mydep: Dependency = {
  name: "mydep",

  // Source tarball. Fetched from GitHub's archive endpoint (no git history,
  // just the files at `commit`). Most deps use this.
  //
  // Other kinds: `prebuilt` (download pre-compiled .a, e.g. WebKit default),
  // `local` (user manages vendor/<name>/ manually — only WebKit uses this
  // because its clone is too slow to automate), `in-tree` (source in src/).
  source: () => ({ kind: "github-archive", repo: "owner/repo", commit: "..." }),

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
  // optional fields (lang/pic/defines/headers/codegen).
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
  `../source.ts`. Prefer this over `nested-cmake` when feasible: it skips a
  cmake configure (often 5–20s of try_compile probes) and lets LTO see
  across the dep boundary into bun's call sites.
- **`nested-cmake`**: Runs `cmake --fresh -B ...` then `cmake --build`.
  See `NestedCmakeBuild` in `../source.ts` for all fields.
- **`cargo`**: Rust deps (currently just lolhtml). See `CargoBuild` in `../source.ts`.
- **`none`**: Header-only or prebuilt. No build step; `.ref` stamp is the output.

## Worked examples

- **hdrhistogram.ts** / **libdeflate.ts** — simplest direct deps
- **mimalloc.ts** — direct build, single unity TU compiled as C++
- **tinycc.ts** — direct build with a build-time codegen tool
- **zlib.ts** — direct build with per-source SIMD `-m` flags + `.h.in` substitution
- **libarchive.ts** / **cares.ts** — direct build with hand-written per-target config.h
- **boringssl.ts** — direct build with NASM assembly (win-x64) and a large gen/ manifest
- **sqlite.ts** — direct build, in-tree source (lives in `src/`, not `vendor/`)
- **libuv.ts** — `enabled: cfg => cfg.windows` for a platform-only dep
- **lolhtml.ts** — cargo build with rustflags
- **webkit.ts** — `nested-cmake` (`sourceSubdir`, `preBuild`) and `prebuilt`

## How the three-step build works

Each dep becomes three ninja build statements, each with `restat = 1`:

1. **fetch** → `vendor/<name>/.ref` stamp
   - Downloads tarball, extracts, applies patches
   - `.ref` contains `sha256(commit + patches)[:16]`
   - restat: if identity unchanged, no write, downstream pruned
2. **configure** → `buildDir/deps/<name>/CMakeCache.txt`
   - `cmake --fresh -B <dir> -D...`
   - `--fresh` drops the cache so stale -D values don't persist
   - restat: inner cmake might not touch cache
3. **build** → `.a` files
   - `cmake --build <dir> --target ...`
   - restat: inner ninja no-ops if nothing changed

`restat` is what makes incremental builds fast — if step N was a no-op,
ninja prunes everything after it.

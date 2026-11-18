# Vendored dependencies

One file per dependency. Each file exports a `Dependency` object that tells
the build system where to fetch the source, how to build it, and what
libraries/headers it provides.

## Adding a dependency

1. Copy `brotli.ts` (the simplest direct dep) to `<name>.ts`
2. Fill in `name`, `repo`, `commit`, `sources`, `includes`, `provides.includes`
3. Add `import { <name> } from "./<name>.ts"` + entry in `allDeps` array in `index.ts`
4. Add the name to `DepName` in `../source.ts`
5. `bun run build --target=<name>` to verify it builds

That's it. For most deps you're done. A dep with generators of its own adds
`steps` to the same `direct` spec.

**`name` is the directory on disk** (`vendor/<name>/`) and the ninja target.

**Ordering in `allDeps` matters:**

- Put deps with `fetchDeps: ["X"]` AFTER X in the list
- Link order: deps that PROVIDE symbols go after deps that USE them

## Removing a dependency

1. Delete `<name>.ts`
2. Remove from `allDeps` in `index.ts`, and from `DepName` in `../source.ts`
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

Any fetched dep the graph compiles or includes can be redirected
(so not lolhtml or rust-argon2, which cargo reads from `vendor/` via the workspace
`Cargo.toml` — point that path at your checkout instead); several at once
with `name=path,name=path`. Cross-dep references (`depSourceDir()`, e.g.
lsquic's `-I` into boringssl) follow the redirect. The checkout is compiled
as-is — no fetch, no `.ref` stamp, and the dep's `patches` are **not**
applied (they target the pinned tarball), so start the clone from the pinned
commit if you want an identical baseline. Switching a dep between pinned and
local moves its `-I` path, so the first build after the switch recompiles
every TU that sees the dep's headers; after that, edits are picked up
incrementally through the compiler depfiles. The
build banner shows `local:<name>` while this is on. Don't edit
`vendor/<name>/` in place instead — it is wiped whenever the pin or patches
change.

## ICU

`--icu=bundled`, the default but for macOS, compiles the release tarball that
`icu.ts` pins by checksum. The tarball, unlike ICU's repository, holds the data
as one ready package, which `../icu/data.ts` filters and compresses
(`../icu/items.ts` has the lists), so none of ICU's own tools is built.

`--icu=system` links the host's ICU (74 or later on Linux), or the static build
whose `include/` and `lib/` are in `$BUN_ICU_ROOT`.

`--local-deps=icu=<dir>` takes a directory laid out like the tarball. From a
clone of unicode-org/icu that is `icu4c/`, with the package and then the
patches (ICU's own tools do not link once they are applied):

```sh
mkdir icu/build && cd icu/build
../icu4c/source/configure --with-data-packaging=archive && make -j
cp data/out/icudt*l.dat ../icu4c/source/data/in/
for patch in $BUN/patches/icu/*.patch; do patch -d ../icu4c -p1 < $patch; done
```

To update: change `ICU_VERSION` and `ICU_SHA256`, compare the source lists with
`source/{common,i18n}/sources.txt`, and drop the patches the release has.

## Common fields

```ts
export const mydep: Dependency = {
  name: "mydep",

  // Source tarball. Fetched from GitHub's archive endpoint (no git history,
  // just the files at `commit`). Most deps use this.
  //
  // Other kinds: `tarball` (a source release, checked against its sha256),
  // `prebuilt` (download a release tarball, e.g. the Node.js headers),
  // `local` (user-managed checkout: what a fetched dep becomes via
  // `--local-deps`, see above), `in-tree` (source in src/), `system`
  // (already on the machine).
  source: () => ({ kind: "github-archive", repo: "owner/repo", commit: "..." }),

  // Optional: macro name for bun_dependency_versions.h (process.versions).
  // Omit if this dep shouldn't appear there.
  versionMacro: "MYDEP",

  // Optional: .patch files applied after extraction.
  patches: ["patches/mydep/fix-something.patch"],

  // Optional: deps whose SOURCE must be ready before this one builds
  // (for -I cross-dep headers). See lsquic for an example.
  fetchDeps: ["zlib"],

  // How to build. `direct` lists sources explicitly; emitDirect compiles
  // each as a first-class cc/cxx edge and the resulting .o's go straight
  // into bun's link line. See `DirectBuild` in ../source.ts for all
  // optional fields (lang/pic/defines/headers/codegen/steps/libs/forbidUndefined).
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
    // linkFlags: ["-lmydep"],        // Libraries the linker finds by name.
  }),

  // Optional: skip this dep on some platforms.
  enabled: cfg => !cfg.windows,
};
```

## Build types

- **`direct`**: Sources compiled as first-class `cc` edges in our ninja
  graph — no sub-process, no cmake configure, one job pool for everything, and
  LTO sees across the dep boundary into bun's call sites. See `DirectBuild` in
  `../source.ts`.
- **`cargo`**: Rust deps (currently lolhtml and rust-argon2). See `CargoBuild` in `../source.ts`.
- **`none`**: Header-only, prebuilt or the system's. No build step; the fetch stamp, if any, is the output.

## Worked examples

- **brotli.ts** — simplest direct dep
- **mimalloc.ts** — direct build, single unity TU compiled as C++
- **tinycc.ts** — direct build with a build-time codegen tool
- **zlib.ts** — direct build with per-source SIMD `-m` flags + `.h.in` substitution
- **cares.ts** — direct build with hand-written per-target config.h
- **boringssl.ts** — direct build with NASM assembly (win-x64) and a large gen/ manifest; `forbidUndefined` (with libuv.ts) keeps a dep that bun points at mimalloc from calling libc's allocator behind its back
- **sqlite.ts** — direct build, in-tree source (lives in `src/`, not `vendor/`)
- **libuv.ts** — `enabled: cfg => cfg.windows` for a platform-only dep
- **lolhtml.ts** — cargo build with rustflags
- **icu.ts** — `tarball` source, with a host tool and a step whose output one source embeds; or `system` source: nothing fetched or built, libraries named for the link

## How a dep builds

1. **fetch** → `vendor/<name>/.ref` stamp (`restat = 1`)
   - Downloads tarball, extracts, applies patches
   - `.ref` contains `sha256(commit + patches)[:16]`
   - restat: if identity unchanged, no write, downstream pruned
2. **compile** → one `cc`/`cxx`/`nasm` edge per source, after the fetch
   (order-only) and the dep's generated headers; the objects are inputs of
   bun's link

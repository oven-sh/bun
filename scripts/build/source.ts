/**
 * Source acquisition and external-build orchestration for vendored dependencies.
 *
 * Three-step dance per dep, each a ninja `build` with `restat = 1`:
 *
 *   1. fetch:     tarball → vendor/<name>/  (outputs: .ref stamp)
 *   2. configure: cmake -B ... -D...        (outputs: CMakeCache.txt)
 *   3. build:     cmake --build ...         (outputs: .a files)
 *
 * restat means: if the output mtime is unchanged after the command (e.g. fetch
 * was a no-op because .ref already matches), ninja prunes downstream. This is
 * what makes incremental builds fast.
 *
 * Source lives in `vendor/<name>/` (gitignored). Build output lives in
 * `buildDir/deps/<name>/`. This supports "local" dep mode where the user edits
 * vendored source directly — the fetch step is skipped and no .ref is written.
 *
 * Tarballs are cached in `cacheDir/tarballs/<identity-hash>.tar.gz` so
 * re-extraction after a failed patch doesn't re-download.
 */

import { existsSync, globSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { ar, cc, cxx, nasm } from "./compile.ts";
import type { BuildType, Config } from "./config.ts";
import { assert } from "./error.ts";
import { computeSourceIdentity, fetchCliPath } from "./fetch-cli.ts";
import { computeDepFlags } from "./flags.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { quote, quoteArgs, slash } from "./shell.ts";
import { streamPath } from "./stream.ts";

/**
 * If the source dir exists with a stale (or missing) identity stamp,
 * delete it. Called at configure time so ninja's startup stat sees the
 * headers as missing — correctly marking dependent .o files dirty.
 *
 * See emitFetch() comment for the full why.
 *
 * Only called for github-archive deps (via emitFetch). Local-mode deps
 * (WebKit) never go through here — their source is user-managed, we
 * never touch vendor/WebKit/. Identity is commit + patch-content, NOT
 * disk content, so hand-edits to vendor/<dep>/*.c are preserved (identity
 * still matches, no wipe).
 */
function invalidateStaleSource(srcDir: string, refStamp: string, commit: string, patchPaths: string[]): void {
  if (!existsSync(srcDir)) return;

  const patchContents = patchPaths.map(p => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // Missing patch → identity won't match → wipe. The fetch will
      // fail later with a clearer "patch file not found" error.
      return "<missing>";
    }
  });
  const expected = computeSourceIdentity(commit, patchContents);

  let current = "";
  try {
    current = readFileSync(refStamp, "utf8").trim();
  } catch {
    // .ref missing but srcDir exists — can't verify what's there. Could
    // be stale from a previous commit, could be a manual rm. Either way:
    // untrusted, wipe.
  }

  if (current !== expected) {
    rmSync(srcDir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where a dependency's source comes from.
 */
export type Source =
  | {
      kind: "github-archive";
      /** "owner/repo" */
      repo: string;
      /**
       * Commit sha or tag. Both work for github archive URLs
       * (`/archive/<ref>.tar.gz`). Prefer commit shas — tags can move,
       * breaking the identity hash. If upstream only publishes tags
       * (e.g. brotli `v1.1.0`), fine, but be aware a retag will silently
       * change what we fetch.
       */
      commit: string;
    }
  | {
      /**
       * Source is edited directly in vendor/<name>/. No fetch, no .ref stamp.
       * The user is responsible for putting the source there.
       */
      kind: "local";
      /**
       * Absolute path to the source. Defaults to vendor/<name>/. Override
       * when the source lives outside the worktree (e.g. a shared WebKit
       * clone reused across worktrees).
       */
      path?: string;
      /** Custom hint for the "source not found" error. */
      hint?: string;
    }
  | {
      /**
       * Source lives in the bun repo itself, not vendor/. Used for sqlite
       * (src/bun.js/bindings/sqlite/). The path IS the source dir — no fetch,
       * build output still goes to buildDir/deps/<name>/.
       */
      kind: "in-tree";
      /** Path relative to repo root. */
      path: string;
    }
  | {
      /**
       * Pre-compiled binaries from a release tarball. No build step —
       * download + extract IS the acquisition. Use with `build: {kind:"none"}`.
       *
       * Currently only WebKit uses this. Other deps may migrate here if/when
       * we ship prebuilt .a files for them.
       *
       * Identity check: we write a `.identity` stamp file after successful
       * extraction. If it matches on next fetch, skip download (restat prunes).
       * Simpler than WebKit's CMake approach (check package.json contents) —
       * we control the stamp, so we use a consistent mechanism.
       */
      kind: "prebuilt";
      /** Download URL. Typically a GitHub release asset. */
      url: string;
      /**
       * Identity string for the stamp. Changing this triggers re-download.
       * Usually a version sha or a hash of (version + config flags that
       * affect which tarball you need).
       */
      identity: string;
      /**
       * Paths to delete (relative to destDir) after extraction. WebKit
       * deletes `include/unicode` on macOS (conflicts with system ICU
       * headers); nodejs-headers deletes openssl/uv (conflict with
       * BoringSSL/our libuv). Most deps won't need it.
       *
       * Paths, not a shell command — cross-platform via fs.rm, no quoting
       * through ninja.
       */
      rmAfterExtract?: string[];
      /**
       * Where extracted files land. Default: `vendor/<name>/`. Prebuilt deps
       * (WebKit, nodejs-headers) override to `cacheDir/<name>-<version>/`.
       */
      destDir?: string;
    };

/**
 * How to build a dependency once its source is available.
 */
export type BuildSpec =
  | NestedCmakeBuild
  | CargoBuild
  | DirectBuild
  | {
      /** No build step — headers-only or prebuilt binaries. */
      kind: "none";
    };

/** A source file with extra per-file flags (e.g. SIMD `-mavx2`). */
export interface DirectSource {
  path: string;
  cflags: string[];
}

/** A header derived from a template in the source tree. */
export interface HeaderSubst {
  /** Template path relative to srcDir (e.g. "zlib.h.in"). */
  from: string;
  /**
   * Literal replacements applied via `String.split(from).join(to)` — no
   * regex. cmake's `configure_file(@ONLY)` is exactly this: each `@VAR@`
   * token swaps for a fixed string. Order is as given.
   */
  replace?: Array<[from: string, to: string]>;
}

/**
 * Compile sources directly into our ninja graph — no cmake/cargo sub-process.
 *
 * Each source becomes a `cc`/`cxx`/`nasm` build edge; outputs are archived
 * into `buildDir/deps/<name>/lib<name>.a`. Flags are the same globals that
 * nested-cmake deps get (computeDepFlags) so ASAN/optimization/target stay
 * consistent.
 */
export interface DirectBuild {
  kind: "direct";
  /**
   * C/.S sources relative to srcDir. A bare string compiles with the dep's
   * shared flags; the object form appends per-file cflags (used for SIMD
   * kernels that need `-m<isa>` while the rest of the dep does not).
   */
  sources: Array<string | DirectSource>;
  /**
   * Compile sources as C++ even when they're .c files. Uses cxxflags from
   * computeDepFlags and prepends `-x c++`. Mimalloc needs this — its public
   * headers are read by both C++ TUs and the allocator implementation, and
   * C/C++ can disagree on struct layout for trailing flexible arrays.
   */
  lang?: "c" | "cxx";
  /**
   * Same semantics as NestedCmakeBuild.pic. true → -fPIC; false (default)
   * → on darwin add -fno-pic -fno-pie to undo apple-clang's PIC default,
   * elsewhere nothing. Windows is a no-op either way.
   */
  pic?: boolean;
  /**
   * Preprocessor defines. Value type controls the emitted form:
   *   true    → -DNAME
   *   number  → -DNAME=42
   *   string  → -DNAME=\"value\"  (shell-quoted C string literal)
   * The shell escaping is handled here; callers pass plain strings.
   */
  defines?: Record<string, string | number | true>;
  /**
   * Extra flags beyond computeDepFlags globals. `cflags` go to every
   * source; `cxxflags` only to .cc/.cpp/.cxx (or .c when `lang: "cxx"`
   * forces C-as-C++). Use `cxxflags` for `-std=c++NN`/`-fno-rtti`/etc.
   * when a dep mixes C and C++ sources.
   */
  cflags?: string[];
  cxxflags?: string[];
  /** Flags for `.asm` sources (nasm). Separate because nasm doesn't share clang's argv shape. */
  nasmflags?: string[];
  /** Include dirs relative to srcDir (no -I prefix). "." for the root. */
  includes?: string[];
  /**
   * Headers written to buildDir/deps/<name>/. Key is the output filename;
   * buildDir is added to -I so sources find them. Two value forms:
   *
   *   string       Literal contents written at configure time. For
   *                autotools-style `#include "config.h"` where we
   *                hand-write the answers instead of probing.
   *
   *   HeaderSubst  Derived from a template in srcDir at build time
   *                (ninja edge). For *.h.in files where the upstream
   *                header is too large to inline but the substitution
   *                is trivial.
   */
  headers?: Record<string, string | HeaderSubst>;
  /**
   * Bulk header staging: copy source headers into a flattened tree under
   * buildDir/deps/<name>/. Each entry copies every file matching `glob`
   * (relative to srcDir) to `<dest>/<basename>`. WebKit's cross-layer
   * includes (`<bmalloc/X.h>`, `<wtf/X.h>`) expect this — the source tree
   * has the files spread across multiple dirs.
   *
   * `glob` is evaluated at configure time against srcDir. `from` is an
   * explicit list (token-expanded), used for build-time targets that
   * don't exist at configure (DerivedSources headers).
   */
  forwardHeaders?: Array<{ dest: string } & ({ glob: string } | { from: string[] })>;
  /**
   * Build-time generators that produce headers/sources the library
   * compiles. Each becomes its own ninja edge; all outputs are implicit
   * inputs to every cc/cxx in this dep.
   */
  codegen?: DirectCodegen[];
}

/**
 * One codegen step. Two tool shapes:
 *
 *   { tool: "foo.c", toolDefines? }
 *     Compile a C source to a host executable, then run it. Compiled
 *     WITHOUT sanitizers — it runs once and gets discarded, so sanitizer
 *     coverage is useless and risks compiler-rt/OS incompatibility
 *     (macOS 26.4 ASAN deadlock, Linux ASLR/shadow-map collision).
 *
 *   { interpreter: "ruby" | "python3" | ..., script: "path/to/gen.rb" }
 *     Run an existing script via the named interpreter. For deps whose
 *     codegen is Ruby/Python (WebKit's offlineasm, *.lut.h tables).
 *
 * Paths use explicit `$SRC/` (→ srcDir) and `$BUILD/` (→ buildDir/deps/
 * <name>) tokens; everything else is passed through verbatim, so flag
 * arguments and bare values (`--out`, `X86_64`) aren't mis-resolved.
 * `$out` expands to outputs[0] (single-output sugar).
 */
export type DirectCodegen =
  | (DirectCodegenBase & { tool: string; toolDefines?: Record<string, string | number | true> })
  | (DirectCodegenBase & { interpreter: string; script?: string })
  | DirectCodegenLinkedTool;

/**
 * Compile+link a C++ source against earlier deps' objects into a
 * build-time executable. The binary IS the codegen output — subsequent
 * script steps reference it as an input/arg.
 *
 * For tools that need real struct layouts from the target build: JSC's
 * LLInt extractors link bmalloc+WTF, and offlineasm reads embedded
 * magic-number tables from the resulting binary to learn field offsets.
 * Unlike the bare `tool` variant, compiles WITH the dep's flags (not a
 * sanitizer-free host build) — the whole point is matching the real ABI.
 */
export interface DirectCodegenLinkedTool {
  /** Single C++ source. `$SRC/` token. */
  linkedTool: string;
  /** Output binary path. `$BUILD/` token. */
  outputs: [string];
  /** Extra compile flags beyond the dep's own cxxflags. */
  toolCxxflags?: string[];
  /**
   * Names of deps whose objects/libs link into the tool. Must be in
   * `fetchDeps` so they're built first.
   */
  toolDeps: string[];
  /** System link flags (`-licuuc -lpthread` etc.). */
  toolLibs?: string[];
  /** Generated headers the tool source includes. `$BUILD/` tokens. */
  inputs?: string[];
}

interface DirectCodegenBase {
  /** Argv. `$SRC/`, `$BUILD/`, `$out` tokens expanded; rest verbatim. */
  args: string[];
  /** Generated outputs. `$BUILD/` prefix; first one is `$out`. */
  outputs: string[];
  /**
   * Extra inputs the generator reads. `$SRC/` or `$BUILD/` prefix.
   * Declared as implicit inputs so editing them re-runs the step. The
   * script/tool itself is always tracked.
   */
  inputs?: string[];
  /** Working directory token (`$SRC/...` or `$BUILD/...`). Defaults to `$SRC`. */
  cwd?: string;
  /**
   * Capture the tool's stdout to this path (token-expanded). For
   * generators that print to stdout instead of taking an output flag
   * (Perl create_hash_table → *.lut.h).
   */
  stdout?: string;
}

export interface NestedCmakeBuild {
  kind: "nested-cmake";
  /**
   * CMake targets to build (cmake --build --target X --target Y).
   * If unspecified, the lib names from `provides.libs` are used as targets
   * (most deps name their target the same as the output library).
   */
  targets?: string[];
  /**
   * Extra cmake -D args (beyond the toolchain/flag forwarding we do
   * automatically). Just the args, no -D prefix — we add it.
   */
  args: Record<string, string>;
  /**
   * Extra C flags appended to CMAKE_C_FLAGS for this dep (beyond global
   * dep flags). APPENDED, not replacing globals.
   */
  extraCFlags?: string[];
  extraCxxFlags?: string[];
  /**
   * Build type for this dep. Defaults to cfg.buildType. Some deps force
   * Release (lshpack — its debug build exposes asan symbols we can't link).
   */
  buildType?: BuildType;
  /**
   * Subdirectory within the build dir where libraries land.
   * E.g. cares puts them in "lib/", hdrhistogram in "src/". Default: root.
   */
  libSubdir?: string;
  /**
   * Subdirectory within the SOURCE dir containing CMakeLists.txt.
   * E.g. zstd's cmake files live at `build/cmake/`, not the repo root.
   * Becomes the `-S` arg to cmake. Default: source root.
   */
  sourceSubdir?: string;
  /**
   * If true, add -fPIC to C/CXX flags (non-windows). This also SUPPRESSES
   * the default apple -fno-pic -fno-pie — you can't have both.
   *
   * Most deps don't need this (we link statically into a non-PIE executable),
   * but some build intermediate tools or have internal shared libs that
   * require PIC. cares/highway/libarchive set it.
   */
  pic?: boolean;
  /**
   * Script to run before cmake configure. Outputs become implicit inputs
   * to configure — if they change (or don't exist), reconfigure.
   *
   * Used when a dep needs a non-cmake build step whose output cmake
   * configure reads. Currently: ICU on Windows (build-icu.ps1 →
   * msbuild → libs that WebKit's cmake needs via -DICU_ROOT).
   */
  preBuild?: PreBuildSpec;
}

export interface PreBuildSpec {
  /** Command argv. First element is the executable. */
  command: string[];
  /** Working directory (absolute). */
  cwd: string;
  /**
   * Output files (absolute paths). These become implicit inputs to cmake
   * configure, so configure waits on them and re-runs if they change.
   * Also the ninja outputs — if missing, preBuild runs.
   */
  outputs: string[];
}

export interface CargoBuild {
  kind: "cargo";
  /**
   * Subdirectory within the source dir containing the Cargo.toml to build.
   * E.g. lolhtml's C bindings crate lives at `c-api/`, not the repo root
   * (which is the pure-rust crate).
   */
  manifestDir: string;
  /**
   * Output library basename (no prefix/suffix). Cargo always names the output
   * after the crate's `[lib] name`, which may differ from the directory name.
   */
  libName: string;
  /**
   * Rust target triple override. Cargo defaults to the host triple, which
   * is usually what we want — but cross-compiles (e.g. arm64-windows on an
   * x64 windows CI runner) need this explicitly.
   *
   * When set, cargo's output path changes to `<target-dir>/<triple>/<profile>/`.
   */
  rustTarget?: string;
  /**
   * RUSTFLAGS for this build. Passed via CARGO_ENCODED_RUSTFLAGS with
   * unit-separator (\x1f) encoding so multi-word flags work.
   */
  rustflags?: string[];
}

/**
 * What a dependency provides to bun's build: libraries to link, headers to
 * include, defines to set. All paths are resolved to absolute during
 * `resolveDep`.
 */
export interface Provides {
  /**
   * Library outputs to link. Paths relative to the dep's BUILD directory
   * (or its libSubdir if set). May be bare names ("mimalloc" → libmimalloc.a)
   * or exact paths ("CMakeFiles/mimalloc-obj.dir/src/static.c.o").
   *
   * Ignored for `direct` builds — emitDirect names the archive
   * `lib<dep.name>` and returns that path itself.
   */
  libs: string[];
  /** Include directories. Paths relative to the dep's SOURCE directory. */
  includes: string[];
  /** Preprocessor defines to add to bun's compilation. */
  defines?: string[];
  /**
   * Source files (relative to the SOURCE dir) that bun compiles directly
   * into its own binary — no nested build producing a `.a`. Declared as
   * implicit outputs of the fetch rule so ninja knows where they come from;
   * bun.ts adds them to its C/C++ source lists.
   *
   * Most deps provide `.a` files via `libs`. This is for the rare case of
   * a single-file dep with no build system (picohttpparser: one .c file).
   */
  sources?: string[];
}

/**
 * A vendored dependency definition. Lives in scripts/build/deps/<name>.ts.
 */
export interface Dependency {
  name: string;

  /** Where source comes from. Evaluated per-config so local mode can be dynamic. */
  source: (cfg: Config) => Source;

  /**
   * Patch files to apply after extraction. Paths relative to repo root.
   * Patches are included in the source identity hash — changing a patch
   * invalidates the fetched source and triggers re-fetch.
   *
   * Files ending in `.patch` are applied with `git apply`. Other files are
   * OVERLAYS — copied into the source root as-is. Useful for injecting a
   * CMakeLists.txt into a project that lacks one (tinycc).
   *
   * Function form allows conditional patches (e.g. zlib's arm64-windows
   * machine-type fix is only needed on that target).
   */
  patches?: string[] | ((cfg: Config) => string[]);

  /**
   * Other deps that must be BUILT before this dep's configure runs.
   * Used for header-level dependencies — e.g. libarchive needs zlib's
   * headers at configure time (`check_include_file("zlib.h")`). zlib-ng
   * generates `zlib.h` during its own cmake configure, so libarchive must
   * wait for zlib's full build, not just its source fetch.
   *
   * Resolves to the named dep's build outputs (lib files for nested-cmake,
   * source stamp for header-only). Order-only on configure, implicit on
   * build. Does NOT link the other dep's libs (that's `provides.libs`).
   */
  fetchDeps?: string[];

  /** How to build. */
  build: (cfg: Config) => BuildSpec;

  /** What the dep provides to bun's build. */
  provides: (cfg: Config) => Provides;

  /**
   * Whether this dep participates in the build at all. Defaults to always-on.
   * E.g. libuv is windows-only, tinycc is disabled on windows-arm64.
   */
  enabled?: (cfg: Config) => boolean;

  /**
   * Macro name suffix for `bun_dependency_versions.h` — becomes
   * `BUN_DEP_<macro>` / `BUN_VERSION_<macro>`. The value is derived from
   * `source(cfg)`: `github-archive.commit`, `prebuilt.identity`, etc.
   *
   * Omit for deps that shouldn't appear in `process.versions` (e.g.
   * nodejs-headers — they're build-time only). The naming is constrained
   * by what BunProcess.cpp already expects; some have `_HASH` suffix for
   * historical reasons.
   */
  versionMacro?: string;
}

/**
 * Resolved dependency — absolute paths ready for link()/cxx() calls.
 */
export interface ResolvedDep {
  name: string;
  /**
   * Absolute paths to .a/.lib files for link(). Populated by nested-cmake/
   * cargo/prebuilt deps, and by `direct` deps when `cfg.archiveDeps` is on.
   */
  libs: string[];
  /**
   * Absolute paths to .o/.obj files for link(). Populated by `direct` deps
   * when `cfg.archiveDeps` is off (the default) — the dep's sources are
   * compiled in our graph and the resulting objects go straight into bun's
   * link line / cpp-only archive instead of an intermediate `.a`.
   */
  objects: string[];
  /** Absolute include paths for -I flags. */
  includes: string[];
  defines: string[];
  /**
   * Absolute paths to .c/.cpp files bun compiles directly (from
   * Provides.sources). Empty for most deps — they provide .a files.
   */
  sources: string[];
  /**
   * The final build output(s). Use these as implicit inputs on anything
   * downstream that needs this dep built first.
   * For nested-cmake deps, these ARE the libs. For header-only deps, this is
   * the source stamp (.ref).
   */
  outputs: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Ninja rule registration (call once)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Register ninja rules shared by all deps. Call once before any resolveDep().
 */
export function registerDepRules(n: Ninja, cfg: Config): void {
  // Shell quoting: tool/script paths may contain spaces (e.g. cargo
  // in "C:\Program Files\Rust\..."). quote() passes through safe paths
  // unchanged so there's no cost on the common case. Host shell syntax
  // (dep rules don't run in zig-only cross-compile, so host == target,
  // but use host.os for consistency with other modules).
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const fetchCli = q(fetchCliPath);
  // cmake rules only registered when cmake is present. emitNestedCmake()
  // asserts at the use site so the error is "this dep needs cmake", not
  // a cryptic "unknown rule dep_configure" from ninja.
  const cmake = cfg.cmake !== undefined ? q(cfg.cmake) : undefined;

  // stream.ts wraps commands to give live prefixed output while ninja runs
  // them in parallel. Ninja buffers non-console subprocess output (confirmed
  // in subprocess-posix.cc / status_printer.cc — BuildEdgeFinished receives
  // the full buffer only when the command exits), but FDs > 2 are inherited
  // through posix_spawn/CreateProcessA unchanged. build.ts dups stderr into
  // FD 3; stream.ts writes prefixed lines to FD 3; output lands on the
  // terminal directly. Deps run 4-at-a-time, every line streams live.
  const stream = `${cfg.jsRuntime} ${q(streamPath)} $name`;

  // Fetch: downloads github archive tarball, extracts, patches, writes .ref.
  // The command encodes: name, repo, commit, dest path, cache path, and patch
  // files. If any of those change, the ninja command string changes, and ninja
  // re-runs fetch. The fetch script is also an implicit input.
  n.rule("dep_fetch", {
    command: `${stream} ${cfg.jsRuntime} ${fetchCli} dep $name $repo $commit $dest $cache $patches`,
    description: "fetch $name",
    restat: true,
    pool: "dep",
  });

  // Prebuilt fetch: download tarball with pre-compiled .a/.lib files, extract,
  // write .identity stamp. Used for WebKit prebuilt (and any future deps that
  // ship prebuilts). Outputs are the lib files directly; stamp confirms
  // identity for restat.
  //
  // $rm_paths: space-separated paths (relative to dest) to delete after
  // extraction. Trailing positional args to fetch-cli, may be empty.
  n.rule("dep_fetch_prebuilt", {
    command: `${stream} ${cfg.jsRuntime} ${fetchCli} prebuilt $name $url $dest $identity $rm_paths`,
    description: "fetch $name (prebuilt)",
    restat: true,
    pool: "dep",
  });

  // Configure: runs cmake in the dep source dir, outputs CMakeCache.txt.
  // The full cmake args are baked into $args per-build — flag changes
  // invalidate configure, which invalidates the .a outputs.
  //
  // --fresh (cmake 3.24+) drops the cache before configuring. This matters
  // because cmake caches -D values: if a previous configure set -DFOO=ON and
  // this one doesn't pass -DFOO at all, cmake keeps the cached ON. Since ninja
  // only reruns this rule when $args actually changed (tracked in .ninja_log),
  // we always want a clean slate when it does run.
  if (cmake !== undefined) {
    n.rule("dep_configure", {
      command: `${stream} --cwd=$srcdir ${cmake} --fresh -B$builddir $args`,
      description: "cmake $name",
      restat: true,
      pool: "dep",
    });

    // Build: runs cmake --build. Restat is critical — if no source changed in
    // the dep, cmake --build is a no-op (inner ninja re-stats), and our restat
    // prunes everything downstream.
    n.rule("dep_build", {
      command: `${stream} ${cmake} --build $builddir --config $buildtype $targets`,
      description: "build $name",
      restat: true,
      pool: "dep",
    });
  }

  // Cargo build: runs `cargo build` in the manifest dir. Only registered
  // if cargo is available — a missing rust toolchain makes ninja fail with
  // a clear "unknown build rule 'dep_cargo'" instead of a cryptic sh error.
  //
  // Env is passed via stream.ts --env (ninja has no native env support).
  // restat: cargo's incremental build doesn't touch unchanged outputs.
  if (cfg.cargo !== undefined) {
    n.rule("dep_cargo", {
      command: `${stream} --cwd=$manifestdir $env ${q(cfg.cargo)} build $args`,
      description: "cargo $name",
      restat: true,
      pool: "dep",
    });
  }

  // preBuild: runs an arbitrary command before cmake configure. Used for
  // build steps that live outside cmake (ICU via msbuild on Windows).
  // restat: if outputs are unchanged (script is idempotent), prune
  // downstream re-configure.
  n.rule("dep_prebuild", {
    command: `${stream} --cwd=$cwd $cmd`,
    description: "prebuild $name",
    restat: true,
    pool: "dep",
  });

  // DirectBuild host tool: compile+link in one clang invocation with NO
  // cfg target/arch flags — the tool runs on the build host. cc()/link()
  // would add --target which breaks cross-compiles.
  n.rule("dep_host_cc", {
    command: `${q(cfg.cc)} $flags -o $out $in`,
    description: "host-cc $out",
  });

  // DirectBuild linked tool: link a C++ object against earlier deps'
  // objects/libs into a build-time executable. Uses a response file —
  // bmalloc+WTF is ~350 .o paths. clang++ as linker driver so the C++
  // runtime and (when cfg.asan) the asan runtime are picked up
  // automatically.
  n.rule("dep_link_tool", {
    command: `${q(cfg.cxx)} @$out.rsp $ldflags -o $out`,
    description: "link-tool $out",
    rspfile: "$out.rsp",
    rspfile_content: "$in_newline",
  });

  // DirectBuild codegen: runs a host tool built by this graph to produce a
  // header. cwd is the dep source dir so the tool sees its inputs; output
  // path is absolute. restat: no-op if the header content is unchanged.
  n.rule("dep_codegen", {
    command: `${stream} --cwd=$cwd $tool $args`,
    description: "codegen $name",
    restat: true,
  });

  // DirectBuild header substitution: literal string replacement on a
  // template file (cmake's configure_file(@ONLY) without the cmake).
  // restat is what makes this cheap — if the output text is unchanged
  // (unmodified template, same replacements), downstream .o files are
  // pruned via their depfile entries.
  n.rule("dep_subst", {
    command: `${cfg.jsRuntime} ${fetchCli} subst $in $out $pairs`,
    description: "subst $out",
    restat: true,
  });

  // DirectBuild forwarding-header copy. Same role as cmake's `cmake -E
  // copy_if_different` — restat prunes downstream when unchanged.
  // Forwarding header: symlink, not copy. WebKit's headers use
  // `#pragma once`; the same file reached via the source subdir AND the
  // flattened forwarding tree must dedupe by inode or it redefines every
  // class. cmake's WEBKIT_SYMLINK_FILES does the same.
  //
  // $target carries the absolute source path — ninja's $in is relative
  // to buildDir, but a symlink's target resolves relative to the link's
  // own directory, so $in there would point nowhere.
  //
  // Windows: NTFS symlinks need admin or Developer Mode. Fall back to a
  // one-line `#include "abs"` wrapper instead — clang's #pragma once
  // dedupes by content there, and the wrapper itself has no declarations.
  n.rule("dep_fwd", {
    command: hostWin ? `cmd /c (echo #include "$target") > $out` : `ln -sfn $target $out`,
    description: "fwd $out",
    restat: true,
  });

  // The `dep` pool: depth-4 balances two concerns. Each nested cmake/cargo
  // build spawns its own -j parallelism; running all 15 at once would
  // oversubscribe cores badly (15 × nproc jobs). Four-at-a-time keeps CPU
  // saturated without thrashing. Output streams live via FD 3 regardless —
  // the pool is purely about scheduling, not display.
  n.pool("dep", 4);
}

// ───────────────────────────────────────────────────────────────────────────
// Resolution — emit ninja rules, return absolute paths
// ───────────────────────────────────────────────────────────────────────────

/**
 * Path to a dep's source tree. Does NOT handle in-tree sources — use
 * the per-dep `srcDir` computed in resolveDep() for that.
 * Both "github-archive" and "local" sources live here — the difference is
 * whether WE manage it (fetch + .ref stamp) or the USER manages it.
 */
export function depSourceDir(cfg: Config, name: string): string {
  return resolve(cfg.vendorDir, name);
}

/**
 * Path to a dep's fetch stamp. Used by zig-only mode to depend on zstd's
 * source being on disk without resolving the full dep graph.
 */
export function depSourceStamp(cfg: Config, name: string): string {
  return resolve(depSourceDir(cfg, name), ".ref");
}

/**
 * Path to a dep's cmake build output. Separate from source so multiple
 * profiles (debug/release) don't clash.
 */
export function depBuildDir(cfg: Config, name: string): string {
  return resolve(cfg.buildDir, "deps", name);
}

/**
 * Resolve a dependency: emit ninja rules for fetch → configure → build,
 * return absolute paths for linking.
 *
 * If the dep is disabled (enabled() returns false), returns null. Caller
 * should skip.
 */
export function resolveDep(
  n: Ninja,
  cfg: Config,
  dep: Dependency,
  resolved: ReadonlyMap<string, ResolvedDep>,
): ResolvedDep | null {
  if (dep.enabled && !dep.enabled(cfg)) {
    return null;
  }

  const source = dep.source(cfg);
  const buildSpec = dep.build(cfg);
  const provides = dep.provides(cfg);

  // ─── Prebuilt: entire acquisition is download + extract. No build step. ───
  // Handled separately because there's no "source dir" in the usual sense —
  // the extracted tarball IS the output, and `provides.libs` are paths into
  // it directly. buildSpec is ignored (should be `{kind:"none"}` but we
  // don't enforce it — the dep definition knows what it's doing).
  if (source.kind === "prebuilt") {
    return emitPrebuilt(n, cfg, dep.name, source, provides);
  }

  // Source directory. For in-tree deps (sqlite), this points into the bun
  // repo instead of vendor/. Local deps can override via `path` to point
  // outside the worktree. Everything else is vendor/<name>/.
  const srcDir =
    source.kind === "in-tree"
      ? resolve(cfg.cwd, source.path)
      : source.kind === "local" && source.path
        ? source.path
        : depSourceDir(cfg, dep.name);

  // Resolve conditional patches. Same list for the whole configure run —
  // we don't want patches changing between emitFetch and the hash check.
  const patches = dep.patches === undefined ? [] : typeof dep.patches === "function" ? dep.patches(cfg) : dep.patches;

  // Sources bun compiles directly (from Provides.sources). Resolved to
  // absolute paths for (a) the ResolvedDep return and (b) declaring as
  // implicit outputs of fetch so ninja knows where they come from.
  const resolvedSources = (provides.sources ?? []).map(s => resolve(srcDir, s));

  // DirectBuild sources are ALSO compiled in our ninja graph, so they need
  // the same implicit-output-of-fetch treatment. Include the codegen tool
  // source, its input, and any HeaderSubst templates — all read at build
  // time from the fetched tree.
  const directSources: string[] = [];
  if (buildSpec.kind === "direct") {
    for (const s of buildSpec.sources) {
      const p = typeof s === "string" ? s : s.path;
      // $BUILD/ sources are codegen outputs, not fetch outputs.
      if (!p.startsWith("$BUILD/")) directSources.push(resolve(srcDir, p));
    }
    for (const h of Object.values(buildSpec.headers ?? {})) {
      if (typeof h !== "string") directSources.push(resolve(srcDir, h.from));
    }
    // Only $SRC/ tokens are fetched from the source tree; $BUILD/ paths are
    // produced by earlier codegen steps (declared as outputs there).
    const srcTok = (s: string) => (s.startsWith("$SRC/") ? resolve(srcDir, s.slice(5)) : undefined);
    for (const cg of buildSpec.codegen ?? []) {
      const main = "tool" in cg ? cg.tool : "linkedTool" in cg ? cg.linkedTool : cg.script;
      const t = main !== undefined ? srcTok(main) : undefined;
      if (t) directSources.push(t);
      const args = "linkedTool" in cg ? [] : cg.args;
      for (const a of [...args, ...(cg.inputs ?? [])]) {
        const r = srcTok(a);
        if (r) directSources.push(r);
      }
    }
  }

  // ─── Step 1: source acquisition ───
  // Emits a ninja node producing the "source is ready" stamp.
  // For github-archive: this runs fetchCli which downloads/extracts/patches.
  // For local/in-tree: source is already on disk; we use a sentinel file
  //   (CMakeLists.txt) as the stamp. Editing it → reconfigure.
  let sourceStamp: string;
  if (source.kind === "github-archive") {
    sourceStamp = emitFetch(n, cfg, dep.name, source, patches, [...resolvedSources, ...directSources]);
  } else {
    // Local/in-tree: no .ref to write. Use the build system's manifest file
    // as the stamp — touching it triggers reconfigure/rebuild.
    //   cmake deps → CMakeLists.txt (in sourceSubdir if set, e.g. zstd)
    //   cargo deps → Cargo.toml (in manifestDir)
    //   header-only → source dir itself (no build = no manifest needed)
    let stampDir: string;
    let stampFile: string;
    if (buildSpec.kind === "nested-cmake") {
      stampDir = buildSpec.sourceSubdir ? resolve(srcDir, buildSpec.sourceSubdir) : srcDir;
      stampFile = "CMakeLists.txt";
    } else if (buildSpec.kind === "cargo") {
      stampDir = resolve(srcDir, buildSpec.manifestDir);
      stampFile = "Cargo.toml";
    } else {
      stampDir = srcDir;
      stampFile = "";
    }
    sourceStamp = stampFile ? resolve(stampDir, stampFile) : stampDir;

    const modeName = source.kind === "in-tree" ? "in-tree" : "local";
    assert(existsSync(sourceStamp), `${modeName} dep "${dep.name}" source not found at ${stampDir}`, {
      hint:
        source.kind === "in-tree"
          ? `Expected ${stampFile || "source"} at ${source.path}/ — check deps/${dep.name}.ts`
          : (source.hint ?? `Clone the dep to vendor/${dep.name}/ manually`),
    });
  }

  // ─── Resolve fetchDeps → extra inputs on configure + build ───
  // These are deps that must be BUILT before we configure (not link).
  // E.g. libarchive's configure runs check_include_file("zlib.h"), and
  // zlib-ng generates zlib.h during its own cmake configure — so we depend
  // on zlib's lib output (which implies its configure ran).
  //
  // On CONFIGURE: order-only. Configure needs the headers to exist, but
  //   doesn't track their content — feature detection is cached in
  //   CMakeCache.txt regardless.
  //
  // On BUILD: implicit. If the cross-dep rebuilds (commit bump), its
  //   headers may have changed; our .o files track them via the inner
  //   ninja's .d files. Restat prunes downstream when nothing changed.
  const fetchDepStamps = (dep.fetchDeps ?? []).flatMap(d => {
    const r = resolved.get(d);
    assert(r, `${dep.name}: fetchDeps references '${d}' but it wasn't resolved first — fix allDeps ordering`);
    return r.outputs;
  });

  // ─── Step 2+3: build ───
  let libs: string[];
  let objects: string[] = [];
  let outputs: string[];

  if (buildSpec.kind === "nested-cmake") {
    const result = emitNestedCmake(n, cfg, dep.name, buildSpec, {
      srcDir,
      sourceStamp,
      provides,
      fetchDepStamps,
      // Local-mode deps: always re-invoke inner build. We can't track
      // source changes reliably (git checkout preserves mtimes of files
      // unchanged between commits). The inner ninja detects what's stale.
      alwaysBuild: source.kind === "local",
    });
    libs = result.libs;
    outputs = result.libs;
  } else if (buildSpec.kind === "cargo") {
    const result = emitCargo(n, cfg, dep.name, buildSpec, { srcDir, sourceStamp });
    libs = result.libs;
    outputs = result.libs;
  } else if (buildSpec.kind === "direct") {
    const result = emitDirect(n, cfg, dep.name, buildSpec, { srcDir, sourceStamp, fetchDepStamps, resolved });
    libs = result.libs;
    objects = result.objects;
    // outputs is the "downstream needs me built" signal — for direct deps
    // that's the generated headers + source stamp, NOT the .o files (those
    // are link inputs, not include-order dependencies).
    outputs = result.headerOutputs;
  } else {
    // No build step. Source stamp is the only output. For deps with
    // provides.sources (picohttpparser), emitBun adds a phony pointing at
    // the compiled .o files so `--target <name>` actually compiles them.
    libs = [];
    outputs = [sourceStamp];
  }

  // ─── Resolve include paths ───
  // Includes are relative to the SOURCE dir (in-tree or vendor). Not the
  // cmake subdir — e.g. zstd's headers are at vendor/zstd/lib/, not
  // vendor/zstd/build/cmake/lib/.
  //
  // Includes CAN be absolute — for deps whose headers land in the BUILD dir
  // (generated during configure), the `provides` function computes absolute
  // paths itself using `depBuildDir()`. Relative paths resolve against srcDir.
  const includes = provides.includes.map(inc => {
    if (isAbsolute(inc)) return inc;
    return inc === "." ? srcDir : resolve(srcDir, inc);
  });

  return {
    name: dep.name,
    libs,
    objects,
    includes,
    defines: provides.defines ?? [],
    sources: resolvedSources,
    outputs,
  };
}

/**
 * Compute the lib paths a dep produces WITHOUT emitting ninja rules.
 *
 * Used by link-only mode: artifacts (the .a/.lib files) are downloaded
 * from cpp-only's buildkite upload into the SAME paths this returns.
 * Ninja sees them as source files (no build rule) — errors cleanly if
 * download failed.
 *
 * Must stay in sync with the path computation inside emitNestedCmake /
 * emitCargo / emitPrebuilt — that's the contract between cpp-only
 * (producer) and link-only (consumer). If those emit-side paths change,
 * change this too.
 */
export function computeDepLibs(cfg: Config, dep: Dependency): string[] {
  if (dep.enabled && !dep.enabled(cfg)) {
    return [];
  }

  const source = dep.source(cfg);
  const buildSpec = dep.build(cfg);
  const provides = dep.provides(cfg);

  // Prebuilt: provides.libs are paths relative to destDir.
  if (source.kind === "prebuilt") {
    const destDir = source.destDir ?? depSourceDir(cfg, dep.name);
    return provides.libs.map(lib => resolve(destDir, lib));
  }

  // nested-cmake: provides.libs are bare names (prefix/suffix added) or
  // paths with "." (used as-is), relative to buildDir/libSubdir.
  // preBuild outputs (ICU) are absolute paths already — appended.
  if (buildSpec.kind === "nested-cmake") {
    const buildDir = depBuildDir(cfg, dep.name);
    const libDir = buildSpec.libSubdir ? resolve(buildDir, buildSpec.libSubdir) : buildDir;
    const libs = provides.libs.map(lib =>
      lib.includes(".") ? resolve(libDir, lib) : resolve(libDir, `${cfg.libPrefix}${lib}${cfg.libSuffix}`),
    );
    if (buildSpec.preBuild !== undefined) {
      libs.push(...buildSpec.preBuild.outputs);
    }
    return libs;
  }

  // cargo: single lib in targetDir/<triple?>/<profile>/.
  if (buildSpec.kind === "cargo") {
    const targetDir = depBuildDir(cfg, dep.name);
    const profile = cfg.release ? "release" : "debug";
    const outSubdir = buildSpec.rustTarget ? join(buildSpec.rustTarget, profile) : profile;
    return [resolve(targetDir, outSubdir, `${cfg.libPrefix}${buildSpec.libName}${cfg.libSuffix}`)];
  }

  // direct: single lib<name>.a when archiveDeps; otherwise the dep's .o
  // files are folded into libbun.a in cpp-only and there's no separate
  // artifact for link-only to fetch.
  if (buildSpec.kind === "direct") {
    if (!cfg.archiveDeps) return [];
    const buildDir = depBuildDir(cfg, dep.name);
    return [resolve(buildDir, `${cfg.libPrefix}${dep.name}${cfg.libSuffix}`)];
  }

  // none: no libs (header-only or directly-compiled sources).
  return [];
}

/**
 * Emit a ninja fetch rule. Returns absolute path to the .ref stamp.
 *
 * The .ref stamp contains the "source identity": hash(commit + patch contents).
 * If the identity matches what's on disk, fetch is a no-op (and restat kicks in).
 * If it doesn't match, fetch blows away the source dir and re-extracts.
 */
function emitFetch(
  n: Ninja,
  cfg: Config,
  name: string,
  source: Extract<Source, { kind: "github-archive" }>,
  patches: string[],
  compiledSources: string[],
): string {
  const srcDir = depSourceDir(cfg, name);
  const refStamp = resolve(srcDir, ".ref");
  const patchPaths = patches.map(p => resolve(cfg.cwd, p));

  // ─── Preemptive stale-source cleanup ───
  // If vendor/<dep>/ exists but .ref is missing OR doesn't match the
  // expected identity, wipe the source dir NOW (configure-time, before
  // ninja starts). This forces header files to be missing when ninja does
  // its startup stat, correctly marking .o files that depend on them as
  // dirty — so they recompile on THIS build, not the next one.
  //
  // Without this: ninja stats everything at startup. Stale headers still
  // have OLD mtimes. .o files look clean. Fetch runs, headers get NEW
  // mtimes. Too late — ninja already scheduled .o as clean. You'd need
  // a SECOND build to pick up the header changes. This closes that gap.
  //
  // Only deletes when identity is demonstrably wrong — normal no-op
  // builds skip it (identity matches, nothing touched).
  invalidateStaleSource(srcDir, refStamp, source.commit, patchPaths);

  n.build({
    outputs: [refStamp],
    // Source files bun compiles directly (picohttpparser.c). Declaring
    // them as outputs tells ninja "fetch creates these" — otherwise ninja
    // errors "missing and no known rule to make it" on fresh checkouts.
    ...(compiledSources.length > 0 && { implicitOutputs: compiledSources }),
    rule: "dep_fetch",
    inputs: [],
    // fetch-cli.ts (which has fetchDep) + patch files. Not this file —
    // it's configure-time ninja emission, not fetch logic.
    implicitInputs: [fetchCliPath, ...patchPaths],
    vars: {
      name,
      repo: source.repo,
      commit: source.commit,
      dest: srcDir,
      cache: resolve(cfg.cacheDir, "tarballs"),
      // Pass patches space-separated. Shell-safe because patch paths are
      // under our control (no spaces in repo paths per convention).
      patches: patchPaths.join(" "),
    },
  });

  // Phony convenience target: `ninja clone-<name>`
  n.phony(`clone-${name}`, [refStamp]);

  return refStamp;
}

/**
 * Emit a prebuilt fetch rule. Returns a complete ResolvedDep — no further
 * build steps needed, the tarball IS the output.
 *
 * `provides.libs` and `provides.includes` are paths relative to the
 * extracted directory (`destDir` or the default `vendor/<name>/`).
 */
function emitPrebuilt(
  n: Ninja,
  cfg: Config,
  name: string,
  source: Extract<Source, { kind: "prebuilt" }>,
  provides: Provides,
): ResolvedDep {
  // Dest dir: default to vendor/<name>/, but deps like WebKit override to
  // a shared cache location (WebKit's ~200MB, you don't want it per-buildDir).
  const destDir = source.destDir ?? depSourceDir(cfg, name);
  const stamp = resolve(destDir, ".identity");

  // Libs: paths relative to destDir. Unlike nested-cmake (where bare names
  // get libX.a prefix/suffix), prebuilt tarballs ship full filenames — we
  // take `provides.libs` entries as-is relative to destDir.
  const libs = provides.libs.map(lib => resolve(destDir, lib));
  const includes = provides.includes.map(inc => {
    if (isAbsolute(inc)) return inc;
    return inc === "." ? destDir : resolve(destDir, inc);
  });

  // Outputs: stamp + all libs. Stamp is the explicit output; libs are
  // implicit (so deleting them correctly retriggers fetch, and restat
  // prunes downstream when fetch was a no-op).
  n.build({
    outputs: [stamp],
    implicitOutputs: libs,
    rule: "dep_fetch_prebuilt",
    inputs: [],
    // Only fetch-cli.ts. download.ts has a lot of shared helpers — editing
    // those shouldn't re-download a multi-hundred-MB WebKit tarball.
    implicitInputs: [fetchCliPath],
    vars: {
      name,
      url: source.url,
      dest: destDir,
      identity: source.identity,
      // Space-separated relative paths. No quoting needed — paths are
      // under our control (include/node/openssl etc.), no spaces.
      rm_paths: (source.rmAfterExtract ?? []).join(" "),
    },
  });
  // Downstream should depend on: libs if there are any (compile-link deps),
  // otherwise the stamp (header-only deps like nodejs-headers — downstream
  // just needs the files to EXIST, stamp proves extraction happened).
  const outputs = libs.length > 0 ? libs : [stamp];
  n.phony(name, outputs);

  return {
    name,
    libs,
    objects: [],
    includes,
    defines: provides.defines ?? [],
    sources: [],
    outputs,
  };
}

interface EmitNestedCmakeInput {
  /** Resolved source dir (vendor/<name> or in-tree path). */
  srcDir: string;
  /** The "source is ready" file (vendor/<name>/.ref or CMakeLists.txt). */
  sourceStamp: string;
  provides: Provides;
  /**
   * Cross-dep source stamps. Order-only on configure (existence suffices),
   * implicit on build (content changes must trigger rebuild).
   */
  fetchDepStamps: string[];
  /**
   * Always re-invoke the inner build. For `local` mode deps where we can't
   * track source changes (git checkout doesn't touch unchanged files). The
   * inner ninja does its own staleness check; restat=1 prunes our downstream
   * when it's a no-op. Matches CMake's `add_custom_target ALL`.
   */
  alwaysBuild: boolean;
}

/**
 * Emit ninja configure + build rules for a nested cmake project.
 * Returns resolved absolute library paths.
 */
function emitNestedCmake(
  n: Ninja,
  cfg: Config,
  name: string,
  spec: NestedCmakeBuild,
  input: EmitNestedCmakeInput,
): { libs: string[] } {
  assert(cfg.cmake !== undefined, `dep "${name}" needs cmake but it wasn't found`, {
    hint: "Install cmake (>= 3.24), or use --webkit=direct/prebuilt to avoid the only nested-cmake deps",
  });
  const { srcDir, sourceStamp, provides, fetchDepStamps, alwaysBuild } = input;
  const buildDir = depBuildDir(cfg, name);
  const cacheFile = resolve(buildDir, "CMakeCache.txt");
  const buildType = spec.buildType ?? cfg.buildType;
  // Shell quoting follows HOST (the shell runs there). Always matches
  // cfg.windows in modes that reach here (we don't cross-compile deps),
  // but stays explicit for the pattern.
  const hostWin = cfg.host.os === "windows";

  // cmake source dir (where CMakeLists.txt lives). Usually srcDir, but
  // some projects nest it (zstd: vendor/zstd/build/cmake/).
  const cmakeSrcDir = spec.sourceSubdir ? resolve(srcDir, spec.sourceSubdir) : srcDir;

  // ─── Assemble cmake configure args ───
  const args: string[] = [];

  // slash() on all tool paths: cmake writes some -D values verbatim into
  // generated .cmake files (e.g. CMakeRCCompiler.cmake), then re-parses
  // them — `\U` in `C:\Users\...` becomes an invalid escape. CMake
  // normalizes CMAKE_C_COMPILER itself but not RC/MT/LINKER.

  // Toolchain forwarding — same compiler/archiver as bun.
  args.push(`-DCMAKE_C_COMPILER=${slash(cfg.cc)}`);
  args.push(`-DCMAKE_CXX_COMPILER=${slash(cfg.cxx)}`);
  args.push(`-DCMAKE_AR=${slash(cfg.ar)}`);
  if (cfg.ranlib !== undefined) {
    args.push(`-DCMAKE_RANLIB=${slash(cfg.ranlib)}`);
  }
  if (cfg.linux && cfg.ld) {
    // Force lld for any executable the dep build produces (e.g. codegen tools).
    // Most deps are static-lib-only so this usually doesn't matter, but when
    // it does (dep builds a tool to generate a header), using lld keeps the
    // toolchain consistent.
    args.push(`-DCMAKE_EXE_LINKER_FLAGS=--ld-path=${cfg.ld}`);
    args.push(`-DCMAKE_SHARED_LINKER_FLAGS=--ld-path=${cfg.ld}`);
  }
  if (cfg.windows) {
    // Windows-specific toolchain forwarding. When CMAKE_C_COMPILER is
    // an explicit path, cmake's find_program for the supporting tools
    // (rc, mt, linker) may not search the compiler's directory — it
    // searches PATH. We resolved these at configure time; pass them
    // explicitly rather than relying on cmake's detection.
    //
    // NOT setting TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY: it stops
    // try_compile from linking, which makes check_function_exists and
    // check_library_exists always succeed → libarchive "finds" fork,
    // posix_spawnp, libmd on Windows. If llvm-mt is missing, better to
    // fail fast at "compiler works" than mis-detect every feature.
    args.push(`-DCMAKE_LINKER=${slash(cfg.ld)}`);
    if (cfg.rc !== undefined) args.push(`-DCMAKE_RC_COMPILER=${slash(cfg.rc)}`);
    if (cfg.mt !== undefined) args.push(`-DCMAKE_MT=${slash(cfg.mt)}`);
  }
  if (cfg.ccache !== undefined) {
    args.push(`-DCMAKE_C_COMPILER_LAUNCHER=${slash(cfg.ccache)}`);
    args.push(`-DCMAKE_CXX_COMPILER_LAUNCHER=${slash(cfg.ccache)}`);
  }
  // Both may be undefined in zig-only cross-compile (no xcode on the linux
  // CI box); that's fine — the cmake rules are emitted but never pulled.
  // If pulled without an SDK, cmake fails with its own clear error.
  if (cfg.darwin && cfg.osxDeploymentTarget !== undefined && cfg.osxSysroot !== undefined) {
    args.push(`-DCMAKE_OSX_DEPLOYMENT_TARGET=${cfg.osxDeploymentTarget}`);
    args.push(`-DCMAKE_OSX_SYSROOT=${cfg.osxSysroot}`);
  }

  // Generator + build type. BUILD_SHARED_LIBS=OFF by default — every dep
  // wants static, and many (boringssl, zlib, highway...) rely on this
  // being set globally rather than having their own MY_LIB_SHARED=OFF flag.
  args.push(`-DCMAKE_GENERATOR=Ninja`);
  args.push(`-DCMAKE_BUILD_TYPE=${buildType}`);
  args.push(`-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`);
  args.push(`-DBUILD_SHARED_LIBS=OFF`);

  // Windows MSVC runtime: CMP0091 NEW (CMake 3.15+) uses this property
  // instead of injecting /MD into CMAKE_<LANG>_FLAGS_<CONFIG>. Without
  // setting it, CMake defaults to MultiThreadedDLL and appends -MD after
  // our /MT in CMAKE_C_FLAGS, poisoning vendor libs with
  // /DEFAULTLIB:msvcrt.lib → link fails with CRT conflict or worse,
  // silently pulls in the dynamic CRT.
  if (cfg.windows) {
    const rt = cfg.debug ? "MultiThreadedDebug" : "MultiThreaded";
    args.push(`-DCMAKE_MSVC_RUNTIME_LIBRARY=${rt}`);
  }

  // Compiler flags — GLOBAL flags only. These are the dep-safe subset:
  // CPU target, optimization level, debug info, visibility, sections.
  // NO -Werror, NO bun-specific constexpr limits.
  const depFlags = computeDepFlags(cfg);
  let cflags = depFlags.cflags.join(" ");
  let cxxflags = depFlags.cxxflags.join(" ");

  // PIC handling:
  //   spec.pic=true  → add -fPIC (non-windows), also tell cmake
  //   spec.pic=false → on apple, add -fno-pic -fno-pie (apple clang defaults
  //     to PIC; the resulting .o can't link into our non-PIE executable)
  //
  // Windows has no PIC concept (all code is relocatable), so both branches
  // are guarded — no-op there.
  if (spec.pic) {
    if (!cfg.windows) {
      cflags += " -fPIC";
      cxxflags += " -fPIC";
    }
    args.push(`-DCMAKE_POSITION_INDEPENDENT_CODE=ON`);
  } else if (cfg.darwin) {
    cflags += " -fno-pic -fno-pie";
    cxxflags += " -fno-pic -fno-pie";
  }

  // Dep-specific extra flags. Appended to globals, not replacing them.
  if (spec.extraCFlags) cflags += " " + spec.extraCFlags.join(" ");
  if (spec.extraCxxFlags) cxxflags += " " + spec.extraCxxFlags.join(" ");

  args.push(`-DCMAKE_C_FLAGS=${cflags}`);
  args.push(`-DCMAKE_CXX_FLAGS=${cxxflags}`);

  // Dep-specific -D args go LAST so a dep can override anything above
  // if it really needs to. (Rare — we don't expect deps to fight the
  // toolchain settings, but boringssl's build system is known to be picky.)
  for (const [k, v] of Object.entries(spec.args)) {
    args.push(`-D${k}=${v}`);
  }

  // ─── Emit preBuild node (if specified) ───
  // Runs before configure. Outputs are implicit inputs to configure — if
  // they change (or don't exist), reconfigure. Restat prunes downstream
  // when the script is a no-op (e.g. ICU already built at this profile).
  let preBuildOutputs: string[] = [];
  if (spec.preBuild !== undefined) {
    preBuildOutputs = spec.preBuild.outputs;
    n.build({
      outputs: preBuildOutputs,
      rule: "dep_prebuild",
      inputs: [],
      // Rebuild if source changed (the script itself is under srcDir).
      implicitInputs: [sourceStamp],
      vars: {
        name,
        cwd: spec.preBuild.cwd,
        cmd: quoteArgs(spec.preBuild.command, hostWin),
      },
    });
    n.phony(`prebuild-${name}`, preBuildOutputs);
  }

  // ─── Emit configure node ───
  n.build({
    outputs: [cacheFile],
    rule: "dep_configure",
    inputs: [],
    // Configure re-runs if: source changed, cmake binary changed, preBuild
    // outputs changed. fetchDeps stamps are order-only — can't configure
    // until cross-dep headers are on disk (libarchive's check_include_file
    // for zlib.h runs at configure time).
    implicitInputs: [sourceStamp, cfg.cmake, ...preBuildOutputs],
    orderOnlyInputs: fetchDepStamps,
    vars: {
      name,
      srcdir: cmakeSrcDir,
      builddir: buildDir,
      args: quoteArgs(args, hostWin),
    },
  });
  n.phony(`configure-${name}`, [cacheFile]);

  // ─── Resolve library output paths ───
  // Provides.libs can be bare names ("mimalloc" → libmimalloc.a) or paths
  // with a dot ("CMakeFiles/.../static.c.o" → use as-is).
  const libDir = spec.libSubdir ? resolve(buildDir, spec.libSubdir) : buildDir;
  const libs = provides.libs.map(lib => {
    if (lib.includes(".")) {
      return resolve(libDir, lib);
    }
    return resolve(libDir, `${cfg.libPrefix}${lib}${cfg.libSuffix}`);
  });

  // Targets default to lib names — most deps name their cmake target
  // the same as the output library (libuv's "uv_a" → libuv_a.a).
  const targets = spec.targets ?? provides.libs.filter(l => !l.includes("."));

  // ─── Emit build node ───
  // fetchDeps stamps are implicit (not order-only like on configure) because
  // a cross-dep re-fetch may have changed headers our .o files track — we
  // must re-invoke the inner build so ITS ninja can detect and rebuild.
  const buildImplicits = [cacheFile, sourceStamp, ...fetchDepStamps];
  if (alwaysBuild) {
    // Local-mode: inner build always runs. Its own ninja checks staleness.
    // restat=1 prunes our downstream when the .a files didn't change.
    buildImplicits.push(n.always());
  }

  n.build({
    outputs: libs,
    rule: "dep_build",
    inputs: [],
    implicitInputs: buildImplicits,
    vars: {
      name,
      builddir: buildDir,
      buildtype: buildType,
      targets: targets.map(t => `--target ${t}`).join(" "),
    },
  });

  // preBuild outputs are produced by dep_prebuild (not dep_build), but
  // link still needs them. Append here so they flow to the resolved dep
  // — NOT to dep_build outputs (that would double-declare).
  const allLibs = [...libs, ...preBuildOutputs];
  n.phony(name, allLibs);

  return { libs: allLibs };
}

interface EmitCargoInput {
  srcDir: string;
  sourceStamp: string;
}

/**
 * Emit a ninja build rule for a cargo project. Returns the single static lib
 * cargo produces.
 *
 * Cargo's build model is self-contained — no separate configure step. We
 * just point it at a manifest dir, set the target dir, and let it resolve
 * everything. Its own incremental build is reliable, so restat=1 on the
 * rule keeps our downstream no-ops fast.
 */
function emitCargo(n: Ninja, cfg: Config, name: string, spec: CargoBuild, input: EmitCargoInput): { libs: string[] } {
  const hostWin = cfg.host.os === "windows";
  assert(cfg.cargo !== undefined, `dep "${name}" requires cargo but no rust toolchain was found`, {
    hint: "Install rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
  });

  const { srcDir, sourceStamp } = input;
  const manifestDir = resolve(srcDir, spec.manifestDir);
  const targetDir = depBuildDir(cfg, name);
  const profile = cfg.release ? "release" : "debug";

  // ─── Resolve output path ───
  // Cargo's staticlib output layout:
  //   <target-dir>/<profile>/{lib}<name>.{a,lib}           (no --target)
  //   <target-dir>/<triple>/<profile>/{lib}<name>.{a,lib}  (with --target)
  // Follows platform convention (cfg.libPrefix/libSuffix).
  const outSubdir = spec.rustTarget ? join(spec.rustTarget, profile) : profile;
  const lib = resolve(targetDir, outSubdir, `${cfg.libPrefix}${spec.libName}${cfg.libSuffix}`);

  // ─── Build args ───
  const args: string[] = ["--locked", "--target-dir", targetDir];
  if (cfg.release) args.push("--release");
  if (spec.rustTarget) args.push("--target", spec.rustTarget);

  // ─── Environment ───
  // CARGO_ENCODED_RUSTFLAGS: the separator is U+001F (unit separator), not
  // space. This is cargo's way of passing multi-argument flags unambiguously.
  const env: Record<string, string> = {
    CARGO_TERM_COLOR: "always",
  };
  if (cfg.cargoHome !== undefined) env.CARGO_HOME = cfg.cargoHome;
  if (cfg.rustupHome !== undefined) env.RUSTUP_HOME = cfg.rustupHome;

  if (spec.rustflags && spec.rustflags.length > 0) {
    // The \x1f encoding is deliberate — see cargo's docs on CARGO_ENCODED_RUSTFLAGS.
    env.CARGO_ENCODED_RUSTFLAGS = spec.rustflags.join("\x1f");
  }

  // Windows: pin the linker to MSVC's link.exe. Without this, if Git Bash
  // is in PATH, its /usr/bin/link (GNU hard-link tool) shadows the real
  // linker and cargo's link step fails with a baffling error.
  if (cfg.windows && cfg.msvcLinker !== undefined) {
    // Triple-specific linker env var. Cargo reads CARGO_TARGET_<TRIPLE>_LINKER
    // where <TRIPLE> is uppercased with hyphens→underscores.
    const triple = spec.rustTarget ?? (cfg.arm64 ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc");
    const envKey = `CARGO_TARGET_${triple.toUpperCase().replace(/-/g, "_")}_LINKER`;
    env[envKey] = cfg.msvcLinker;
  }

  // ─── Emit build node ───
  n.build({
    outputs: [lib],
    rule: "dep_cargo",
    inputs: [],
    // Rebuild if source changed or cargo binary changed. Cargo's own
    // dependency tracking handles file-level granularity below manifestDir.
    implicitInputs: [sourceStamp, cfg.cargo],
    vars: {
      name,
      manifestdir: manifestDir,
      args: quoteArgs(args, hostWin),
      // stream.ts's --env=K=V format. Values platform-quoted since ninja
      // passes the command line through the host's argv parser; stream.ts
      // receives them as proper argv entries.
      env: Object.entries(env)
        .map(([k, v]) => `--env=${k}=${quote(v, hostWin)}`)
        .join(" "),
    },
  });
  n.phony(name, [lib]);

  return { libs: [lib] };
}

// ---------------------------------------------------------------------------
// Direct — compile sources inline into our ninja graph
// ---------------------------------------------------------------------------

interface EmitDirectInput {
  srcDir: string;
  sourceStamp: string;
  fetchDepStamps: string[];
  /**
   * Deps resolved before this one. linkedTool codegen looks up its
   * `toolDeps` here to get their object/lib lists.
   */
  resolved: ReadonlyMap<string, ResolvedDep>;
}

/**
 * Compile a dep's sources directly — no cmake/cargo sub-process.
 *
 * Each .c becomes a `cc` build edge with the same global flags nested-cmake
 * deps get (computeDepFlags), so ASAN/opt/target stay consistent with the
 * rest of the build. Objects land under obj/vendor/<name>/ (via objectPath)
 * and get archived into buildDir/deps/<name>/lib<name>.a.
 *
 * If spec.codegen is set, first compile+link the tool WITHOUT sanitizers,
 * run it to produce the header, and make all library objects depend on it.
 * The no-sanitize policy is the point of DirectBuild existing: host tools
 * are disposable and inherit compiler-rt/OS incompatibilities for no gain.
 */
function emitDirect(
  n: Ninja,
  cfg: Config,
  name: string,
  spec: DirectBuild,
  input: EmitDirectInput,
): { libs: string[]; objects: string[]; headerOutputs: string[] } {
  const { srcDir, sourceStamp, fetchDepStamps } = input;
  const buildDir = depBuildDir(cfg, name);
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);

  n.comment(`─── ${name} (direct) ───`);

  // Library flags: globals (includes ASAN when cfg.asan) + dep's own includes
  // and defines. Same base as what gets forwarded to nested cmake via
  // CMAKE_C_FLAGS / CMAKE_CXX_FLAGS. `lang` picks the flag set; the compile
  // function is chosen per-file by extension below.
  const depFlags = computeDepFlags(cfg);
  const isCxx = spec.lang === "cxx";
  const baseFlags = isCxx ? depFlags.cxxflags : depFlags.cflags;

  // PIC: mirror emitNestedCmake's handling so direct deps get the same
  // codegen as cmake deps would. spec.pic → -fPIC; otherwise on darwin
  // undo apple-clang's PIC default to match the non-PIE final binary.
  const picFlags: string[] = [];
  if (spec.pic) {
    if (!cfg.windows) picFlags.push("-fPIC");
  } else if (cfg.darwin) {
    picFlags.push("-fno-pic", "-fno-pie");
  }

  const incFlags = (spec.includes ?? []).map(i => `-I${q(resolve(srcDir, i))}`);
  const defFlags = Object.entries(spec.defines ?? {}).map(([k, v]) => defineFlag(k, v));
  const libFlags = [...baseFlags, ...picFlags, ...incFlags, ...defFlags, ...(spec.cflags ?? [])];

  // Sources must exist before compile attempts. sourceStamp (or the fetch
  // .ref) is order-only: we don't want every .o recompiling when the stamp
  // mtime bumps but the .c files are unchanged — the depfile knows better.
  const orderOnly = [sourceStamp, ...fetchDepStamps];

  // ─── Generated headers (optional) ───
  // Literal-string headers are written at configure time via writeIfChanged
  // (mtime only moves when contents change). HeaderSubst headers become
  // ninja edges — their template lives in srcDir, which doesn't exist
  // until fetch runs. Either way buildDir goes on -I and the outputs are
  // implicit inputs to every cc edge.
  const headers = Object.entries(spec.headers ?? {});
  const needsBuildDirInc =
    headers.length > 0 || (spec.codegen?.length ?? 0) > 0 || (spec.forwardHeaders?.length ?? 0) > 0;
  const generated: string[] = [];
  if (headers.length > 0) {
    mkdirSync(buildDir, { recursive: true });
    for (const [h, body] of headers) {
      const out = resolve(buildDir, h);
      if (typeof body === "string") {
        writeIfChanged(out, body === "" ? "/* stub — generated at configure */\n" : body);
      } else {
        n.build({
          outputs: [out],
          rule: "dep_subst",
          inputs: [resolve(srcDir, body.from)],
          implicitInputs: [fetchCliPath],
          orderOnlyInputs: orderOnly,
          vars: { pairs: quoteArgs((body.replace ?? []).flat(), hostWin) },
        });
        generated.push(out);
      }
    }
  }

  // ─── Forwarding headers (optional) ───
  // One copy edge per matched file. Glob is configure-time (the source
  // tree must exist — local-mode WebKit guarantees that). Outputs are
  // implicit inputs to every cc/cxx so depfile tracking is exact.
  for (const fh of spec.forwardHeaders ?? []) {
    const destDir = resolve(buildDir, fh.dest);
    mkdirSync(destDir, { recursive: true });
    const srcs =
      "glob" in fh
        ? globSync(fh.glob, { cwd: srcDir }).map(s => resolve(srcDir, s))
        : fh.from.map(s => s.replaceAll("$BUILD/", buildDir + "/").replaceAll("$SRC/", srcDir + "/"));
    for (const abs of srcs) {
      const out = resolve(destDir, basename(abs));
      n.build({
        outputs: [out],
        rule: "dep_fwd",
        inputs: [abs],
        orderOnlyInputs: orderOnly,
        // Absolute target — symlink resolution is relative-to-link,
        // and Windows wants forward slashes in the #include.
        vars: { target: slash(abs) },
      });
      generated.push(out);
    }
  }

  // ─── Codegen (optional) ───
  // Token expansion: $SRC/ → srcDir, $BUILD/ → this dep's buildDir,
  // $out → first output. Anything without a token passes through verbatim
  // so flag args (`--out`, `X86_64`) aren't path-mangled.
  const tok = (s: string, out0: string): string => {
    if (s === "$out") return out0;
    if (s === "$SRC") return srcDir;
    if (s === "$BUILD") return buildDir;
    // Replace anywhere in the string so flag-attached paths like
    // `-I$BUILD/DerivedSources/` expand too.
    return s.replaceAll("$SRC/", srcDir + "/").replaceAll("$BUILD/", buildDir + "/");
  };

  for (const [i, cg] of (spec.codegen ?? []).entries()) {
    const outs = cg.outputs.map(o => tok(o, ""));
    const out0 = outs[0]!;
    // Ensure output dirs exist (generators rarely mkdir themselves).
    for (const o of outs) mkdirSync(resolve(o, ".."), { recursive: true });

    if ("linkedTool" in cg) {
      // Linked tool: compile a C++ source WITH this dep's flags (so the
      // ABI matches the real build) and link against earlier deps'
      // objects/libs. The binary IS the codegen output — subsequent
      // script steps reference it as an input/arg. JSC's LLInt
      // extractors are the canonical case: they embed magic-number
      // tables that offlineasm reads from the binary to learn struct
      // field offsets, so the layout must be exact.
      const toolSrc = tok(cg.linkedTool, "");
      const cgInputs = (cg.inputs ?? []).map(p => tok(p, ""));
      const toolObj = cxx(n, cfg, toolSrc, {
        flags: [...libFlags, ...(spec.cxxflags ?? []), `-I${q(buildDir)}`, ...(cg.toolCxxflags ?? [])],
        orderOnlyInputs: orderOnly,
        // Tool source includes generated headers from prior steps.
        implicitInputs: [...generated, ...cgInputs],
      });
      const linkInputs: string[] = [toolObj];
      for (const d of cg.toolDeps) {
        const r = input.resolved.get(d);
        assert(r, `${name}: linkedTool dep '${d}' not resolved — add it to fetchDeps and allDeps before this dep`);
        linkInputs.push(...r.objects, ...r.libs);
      }
      n.build({
        outputs: outs,
        rule: "dep_link_tool",
        inputs: linkInputs,
        vars: { ldflags: (cg.toolLibs ?? []).join(" ") },
      });
      generated.push(...outs);
      continue;
    }

    let toolExe: string;
    let toolInput: string;
    if ("tool" in cg) {
      // Host tool: runs at build time to generate headers, so it must
      // target the BUILD host, not the bun target. cc()/link() add cfg's
      // target/arch flags which break cross-compiles (musl CI: "file
      // format not recognized"). Emit a bare clang invocation instead —
      // no opt, no target triple, just the tool defines and -w. Compile+
      // link in one go so host-arch objects never land in obj/.
      toolInput = tok(cg.tool, out0);
      // Host exe suffix: clang on Windows auto-appends .exe to `-o foo`.
      toolExe = resolve(buildDir, `codegen-tool-${i}${cfg.host.exeSuffix}`);
      const toolDefs = Object.entries(cg.toolDefines ?? {}).map(([k, v]) => defineFlag(k, v));
      n.build({
        outputs: [toolExe],
        rule: "dep_host_cc",
        inputs: [toolInput],
        orderOnlyInputs: orderOnly,
        vars: { flags: ["-w", ...toolDefs].join(" ") },
      });
    } else {
      // Script: invoke an interpreter, optionally with a script as the
      // first positional arg. dep_codegen's command is `$tool $args` —
      // pack the script into $tool so the rule shape stays uniform.
      // script may be omitted for tools that take everything as flags
      // (mig — `mig -D... -sheader X.h file.defs`).
      toolInput = cg.script !== undefined ? tok(cg.script, out0) : "";
      toolExe = cg.script !== undefined ? `${q(cg.interpreter)} ${q(toolInput)}` : q(cg.interpreter);
    }

    const argv = cg.args.map(a => tok(a, out0));
    const extraInputs = (cg.inputs ?? []).map(p => tok(p, out0));
    const cwd = cg.cwd ? tok(cg.cwd, out0) : srcDir;
    if (cwd !== srcDir) mkdirSync(cwd, { recursive: true });
    const stdoutFlag = cg.stdout !== undefined ? `--stdout=${q(tok(cg.stdout, out0))} ` : "";

    n.build({
      outputs: outs,
      rule: "dep_codegen",
      inputs: "tool" in cg ? [toolExe] : toolInput ? [toolInput] : [],
      implicitInputs: extraInputs,
      orderOnlyInputs: orderOnly,
      vars: {
        name,
        cwd,
        tool: stdoutFlag + ("tool" in cg ? q(toolExe) : toolExe),
        args: quoteArgs(argv, hostWin),
      },
    });
    generated.push(...outs);
  }

  // ─── Compile + archive ───
  // Generated headers (codegen + subst) are implicit inputs to every .o —
  // library sources include them. buildDir goes on -I so #include "foo.h"
  // finds literal, subst, and codegen headers alike.
  const implicit = generated;
  const genInc = needsBuildDirInc ? [`-I${q(buildDir)}`] : [];

  const objects = spec.sources.map(s => {
    const path = typeof s === "string" ? s : s.path;
    const extra = typeof s === "string" ? [] : s.cflags;
    // $BUILD/-prefixed sources are codegen outputs (unified bundles,
    // JSCBuiltins.cpp); everything else resolves against srcDir.
    const abs = path.startsWith("$BUILD/") ? resolve(buildDir, path.slice(7)) : resolve(srcDir, path);
    // .asm → nasm() (NASM syntax, Windows-x64). .c/.S → cc() (clang's
    // integrated assembler handles .S), prepending `-x c++` when lang:"cxx"
    // forces a C source through the C++ frontend (mimalloc). Everything
    // else (.cc/.cpp/.cxx) → cxx().
    if (path.endsWith(".asm")) {
      return nasm(n, cfg, abs, { flags: [...(spec.nasmflags ?? []), ...extra], orderOnlyInputs: orderOnly });
    }
    const isC = path.endsWith(".c");
    const isAsm = path.endsWith(".S");
    const asCxx = !isAsm && (!isC || isCxx);
    const opts = {
      flags: [
        ...(isC && isCxx ? ["-x", "c++"] : []),
        ...libFlags,
        ...(asCxx ? (spec.cxxflags ?? []) : []),
        ...genInc,
        ...extra,
      ],
      orderOnlyInputs: orderOnly,
      implicitInputs: implicit,
    };
    return isC || isAsm ? cc(n, cfg, abs, opts) : cxx(n, cfg, abs, opts);
  });

  // Default: hand the objects straight to bun's link line — no intermediate
  // archive. With cfg.archiveDeps the old per-dep .a is produced instead
  // (useful for bisecting duplicate-symbol issues, since a .a only
  // contributes members the linker actually pulls).
  if (cfg.archiveDeps) {
    const lib = ar(n, cfg, join("deps", name, `${cfg.libPrefix}${name}${cfg.libSuffix}`), objects);
    n.phony(name, [lib]);
    return { libs: [lib], objects: [], headerOutputs: [lib] };
  }
  // Phony pulls the objects, or the generated outputs if there are none
  // (codegen-only layer like webkit-jsc during bring-up).
  n.phony(name, objects.length > 0 ? objects : generated);
  // headerOutputs: what downstream needs to wait on for HEADERS to be
  // ready. For no-archive direct deps that's the generated header set
  // (subst/literal/codegen) plus the source stamp — not the .o files.
  return { libs: [], objects, headerOutputs: [...generated, sourceStamp] };
}

/**
 * Format a -D flag. String values become shell-escaped C string literals
 * (-DNAME=\"val\" → compiler sees "val"); numbers/true pass through bare.
 */
function defineFlag(name: string, value: string | number | true): string {
  if (value === true) return `-D${name}`;
  if (typeof value === "number") return `-D${name}=${value}`;
  return `-D${name}=\\"${value}\\"`;
}

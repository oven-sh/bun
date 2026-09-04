/**
 * Source acquisition and build orchestration for vendored dependencies.
 *
 * Per dep: a fetch edge (tarball → vendor/<name>/, output: .ref stamp) with
 * `restat = 1`, then the dep's compile edges in our own graph (direct/custom),
 * a cargo edge, or a prebuilt download.
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

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ar, cc, cxx, nasm } from "./compile.ts";
import type { Config } from "./config.ts";
import { registerIcuRules } from "./deps/icu.ts";
import { gitArchiveUrl, githubArchiveUrl } from "./download.ts";
import { assert } from "./error.ts";
import { assertManagedSource, fetchCliPath, fetchDep, sourceIsCurrent } from "./fetch-cli.ts";
import { computeDepFlags } from "./flags.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { quote, quoteArgs } from "./shell.ts";
import { streamPath } from "./stream.ts";

/**
 * If the source dir exists with a stale (or missing) identity stamp,
 * delete it. Called at configure time so ninja's startup stat sees the
 * headers as missing — correctly marking dependent .o files dirty.
 *
 * See emitFetch() comment for the full why.
 *
 * Only called for github deps (via emitFetch). Local-mode deps never go
 * through here — their source is user-managed. Identity is commit + sparse
 * set + patch-content, NOT disk content, so hand-edits to vendor/<dep>/*.c
 * are preserved (identity still matches, no wipe).
 */
function invalidateStaleSource(
  name: string,
  srcDir: string,
  refStamp: string,
  ref: string,
  sparse: string[],
  patchPaths: string[],
): void {
  if (!existsSync(srcDir)) return;
  assertManagedSource(name, srcDir, refStamp);
  // .ref missing counts as stale: can't verify what's there (previous commit,
  // manual rm) — untrusted, wipe. A missing patch file also mismatches; the
  // fetch then fails with the clearer "patch file not found".
  if (!sourceIsCurrent(srcDir, ref, sparse, patchPaths)) {
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
      /**
       * A commit of a GitHub repository, extracted into vendor/<name>/. Fetched
       * as the `/archive/<commit>.tar.gz` tarball, or — when `sparse` is set —
       * as a shallow, blobless, sparse `git fetch` of just those paths
       * (download.ts gitArchive). Either way the result is a plain tree with a
       * `.ref` identity stamp; no `.git`.
       */
      kind: "github";
      /** "owner/repo" */
      repo: string;
      /**
       * Commit sha or tag. Prefer commit shas — tags can move, breaking the
       * identity hash. If upstream only publishes tags (e.g. brotli
       * `v1.1.0`), fine, but be aware a retag will silently change what we
       * fetch.
       */
      commit: string;
      /**
       * git sparse-checkout patterns (non-cone: gitignore syntax, `/`-anchored
       * to the repo root). Only these paths are downloaded and extracted. For
       * repositories where the build wants a small part of a large tree —
       * GitHub refuses archive tarballs for those anyway (WebKit: HTTP 422).
       * Part of the source identity: changing the set re-fetches.
       */
      sparse?: string[];
    }
  | {
      /**
       * A source release tarball at a fixed URL (one top-level directory,
       * stripped on extraction), for upstreams that publish generated files
       * only in their release tarballs (ICU: the prebuilt data package).
       * Fetched, cached, patched and stamped exactly like a github archive.
       */
      kind: "tarball";
      url: string;
      /** SHA-256 of the file at `url` (hex). Verified before extraction; also the identity the .ref stamp is derived from. */
      sha256: string;
      /** Reported in process.versions / bun_dependency_versions.h. */
      version: string;
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
       * (src/jsc/bindings/sqlite/). The path IS the source dir — no fetch,
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
  | CargoBuild
  | DirectBuild
  | CustomBuild
  | {
      /** No build step — headers-only or prebuilt binaries. */
      kind: "none";
    };

/**
 * A dep whose graph is emitted by its own module (WebKit: codegen chain,
 * two intermediate executables, a test binary — more than DirectBuild
 * describes). The emitter uses the same compile.ts primitives every other
 * edge does; it just decides the shape itself. `includes` in the result are
 * absolute; `provides.includes` is ignored for custom deps.
 */
export interface CustomBuild {
  kind: "custom";
  /**
   * Reads the source tree at CONFIGURE time (file lists, globbed dirs), so
   * configure fetches it before emitting — see prefetchConfigureSources.
   */
  emit: (n: Ninja, cfg: Config, ctx: CustomBuildContext) => CustomBuildResult;
}

export interface CustomBuildResult {
  /** Compiled objects. They go straight onto bun's link line (and into cpp-only's archive on CI) — no intermediate .a. */
  objects: string[];
  /** Absolute include dirs for consumers (replaces provides.includes). */
  includes: string[];
  /** The "headers are ready" signal for consumers' compiles (see ResolvedDep.outputs). */
  outputs: string[];
  /** See ResolvedDep.extras. */
  extras?: string[];
  /** See ResolvedDep.configureInputs. */
  configureInputs?: string[];
}

export interface CustomBuildContext {
  srcDir: string;
  /** Stamps to order every edge after — this dep's source stamp plus the `fetchDeps` outputs. */
  ready: string[];
  /** Deps resolved before this one (allDeps order) — for linking test executables against them. */
  resolved: ReadonlyMap<string, ResolvedDep>;
}

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
 * into `buildDir/deps/<name>/lib<name>.a`. Flags are the dep globals
 * (computeDepFlags) so ASAN/optimization/target stay consistent.
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
   * true → -fPIC; false (default)
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
  /** Extra C flags beyond computeDepFlags globals. */
  cflags?: string[];
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
   * Build-time host tool that generates headers the library sources
   * include. Compiled WITHOUT sanitizers — it runs once on the build
   * machine and gets discarded, so sanitizer coverage is useless and
   * risks compiler-rt/OS incompatibility (macOS 26.4 ASAN deadlock,
   * Linux ASLR/shadow-map collision).
   */
  codegen?: DirectCodegen;
  /**
   * Fail the build if any object of this dep still has an undefined
   * reference to one of `symbols` (llvm-nm over the objects, once they
   * exist). `except` lists sources, as spelled in `sources`, that may
   * reference them. Names are matched with and without the Mach-O leading
   * underscore. The use so far: deps whose allocations bun routes to
   * mimalloc must not reach the C library's allocator behind its back, see
   * LIBC_ALLOCATION_SYMBOLS. Skipped when llvm-nm was not found (cfg.nm).
   */
  forbidUndefined?: ForbidUndefined;
}

export interface ForbidUndefined {
  symbols: readonly string[];
  except?: readonly string[];
}

/**
 * The C library's heap entry points, for `DirectBuild.forbidUndefined`. Only
 * Linux redirects these to mimalloc globally (deps/mimalloc.ts); on Windows
 * and macOS a dep reaches mimalloc only through its own allocator hooks, and
 * a stray malloc() lands on the C runtime heap without anything failing, so
 * the objects are the one place this is checkable.
 */
export const LIBC_ALLOCATION_SYMBOLS: readonly string[] = [
  "malloc",
  "calloc",
  "realloc",
  "free",
  "strdup",
  "_strdup",
  "wcsdup",
  "_wcsdup",
];

export interface DirectCodegen {
  /** Tool source relative to srcDir. Compiled+linked to a host executable. */
  tool: string;
  /** Defines for the tool only. Same typing rules as DirectBuild.defines. */
  toolDefines?: Record<string, string | number | true>;
  /**
   * Argv for the tool. "$out" is replaced with the output path; everything
   * else is resolved relative to srcDir. Tool runs with srcDir as cwd.
   */
  args: string[];
  /** Generated output relative to buildDir/deps/<name>/. */
  output: string;
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
  /**
   * Tier 3 targets (e.g. aarch64-unknown-freebsd) have no prebuilt std, so
   * `rustup target add` (dep_cargo_cross rule) won't help. When true, passes
   * `-Zbuild-std=std,panic_abort` so cargo builds std from source. Requires
   * nightly cargo + `rustup component add rust-src`.
   */
  buildStd?: boolean;
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
   * Resolves to the named dep's build outputs (lib files for cargo,
   * generated headers for custom, source stamp for header-only). Order-only on configure, implicit on
   * build. Does NOT link the other dep's libs (that's `provides.libs`).
   */
  fetchDeps?: string[] | ((cfg: Config) => string[]);

  /** How to build. */
  build: (cfg: Config) => BuildSpec;

  /** What the dep provides to bun's build. */
  provides: (cfg: Config) => Provides;

  /**
   * Whether this dep participates in the build at all. Defaults to always-on.
   * E.g. libuv is windows-only, tinycc is disabled on Android/FreeBSD.
   */
  enabled?: (cfg: Config) => boolean;

  /**
   * Macro name suffix for `bun_dependency_versions.h` — becomes
   * `BUN_VERSION_<macro>`. The value is derived from
   * `source(cfg)`: `github.commit`, `prebuilt.identity`, etc.
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
   * Absolute paths to .a/.lib files for link(). Populated by cargo/prebuilt
   * deps, and by `direct` deps when `cfg.archiveDeps` is on.
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
   * For cargo deps, these ARE the libs. For header-only deps, this is
   * the source stamp (.ref).
   */
  outputs: string[];
  /**
   * Stamps of this dep's `forbidUndefined` checks. Whatever the objects go
   * into next waits for them: the per-dep archive here when cfg.archiveDeps,
   * otherwise bun.ts's archive or link.
   */
  checks: string[];
  /**
   * Extra artifacts the dep produces that ship next to bun but that nothing
   * in bun's graph consumes (WebKit's testFFI executable, run by the test
   * suite). Added to the default targets so a plain build produces them.
   */
  extras: string[];
  /**
   * Files and directories in the dep's source tree that configure read to
   * describe the graph (WebKit's Sources.txt, the header dirs it globs).
   * They are inputs of the reconfigure edge, so editing them in a
   * `--local-deps` clone and running bare `ninja` re-runs configure.
   */
  configureInputs: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Ninja rule registration (call once)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Register ninja rules shared by all deps. Call once before any resolveDep().
 */
export function registerDepRules(n: Ninja, cfg: Config): void {
  registerIcuRules(n, cfg);
  // Shell quoting: tool/script paths may contain spaces (e.g. cargo
  // in "C:\Program Files\Rust\..."). quote() passes through safe paths
  // unchanged so there's no cost on the common case. Host shell syntax
  // (dep rules don't run in rust-only cross-compile, so host == target,
  // but use host.os for consistency with other modules).
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const fetchCli = q(fetchCliPath);

  // stream.ts wraps commands to give live prefixed output while ninja runs
  // them in parallel. Ninja buffers non-console subprocess output (confirmed
  // in subprocess-posix.cc / status_printer.cc — BuildEdgeFinished receives
  // the full buffer only when the command exits), but FDs > 2 are inherited
  // through posix_spawn/CreateProcessA unchanged. build.ts dups stderr into
  // FD 3; stream.ts writes prefixed lines to FD 3; output lands on the
  // terminal directly. Deps run 4-at-a-time, every line streams live.
  const stream = `${cfg.jsRuntime} ${q(streamPath)} $name`;

  // Fetch: downloads a source tree (archive tarball, release tarball, or
  // sparse git fetch), extracts, patches, writes .ref. The command encodes:
  // name, url, identity ref, dest path, cache path, and patch files. If any
  // of those change, the ninja command string changes, and ninja re-runs
  // fetch. The fetch script is also an implicit input.
  n.rule("dep_fetch", {
    command: `${stream} ${cfg.jsRuntime} ${fetchCli} dep $name $url $ref $dest $cache $patches`,
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
    // Cross-compile variant: ensure the rust std for the target triple is
    // installed before building. CI images install rustup as a different
    // user/HOME than the build runs under, so the target may be missing even
    // though `rustup target add` ran at image-build time. `rustup toolchain
    // install --force` reinstalls missing components rather than trusting
    // "the dir exists" — also repairs a partially auto-installed pinned
    // toolchain (no distributable manifest, which would otherwise error with
    // `Missing manifest in toolchain '<channel>-<host>'` before cargo even
    // ran). ~70ms no-op when complete. Same pattern as `rust_build_cross` in
    // rust.ts — see the longer comment there.
    const rustup = q(join(dirname(cfg.cargo), `rustup${cfg.host.exeSuffix}`));
    const cargoCrossEnsure =
      cfg.rustToolchain !== undefined
        ? `${stream} $env ${rustup} -q toolchain install ${cfg.rustToolchain} --force --no-self-update --component rust-src --target $rust_target`
        : `${stream} $env ${rustup} -q target add $rust_target`;
    // Windows: ninja runs commands via CreateProcess (no shell) — wrap in
    // `cmd /c "..."` so `&&` is interpreted as a chain operator instead of
    // being passed as a literal arg. See rust.ts `rust_build_cross`.
    const cargoCrossChain = `${cargoCrossEnsure} && ${stream} --cwd=$manifestdir $env ${q(cfg.cargo)} build $args`;
    n.rule("dep_cargo_cross", {
      command: hostWin ? `cmd /c "${cargoCrossChain}"` : cargoCrossChain,
      description: "cargo $name ($rust_target)",
      restat: true,
      pool: "dep",
    });
  }

  // DirectBuild host tool: compile+link in one clang invocation with NO
  // cfg target/arch flags — the tool runs on the build host. cc()/link()
  // would add --target which breaks cross-compiles. cfg.hostCc (not cfg.cc):
  // for windows targets cc is clang-cl, which does not take this GNU-style
  // command line — host tools use the plain clang driver.
  n.rule("dep_host_cc", {
    command: `${q(cfg.hostCc)} $flags -o $out $in`,
    description: "host-cc $out",
  });

  // DirectBuild codegen: runs a host tool built by this graph to produce a
  // header, and every other generator a dep runs (WebKit's offlineasm /
  // ruby / python / perl scripts, ICU's data repack, migcom's flex/bison).
  // `$opts` are stream.ts's own: --cwd=DIR, --env=K=V, --stdout=PATH (for
  // generators that print their output; written only when it changed) — so
  // no `sh -c`/`cmd /c`, `cd`, `env` or `> $out` is spelled per host.
  // restat: generators that leave an unchanged output alone prune their
  // dependents.
  n.rule("dep_codegen", {
    command: `${stream} $opts $cmd`,
    description: "$desc",
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

  // DirectBuild.forbidUndefined: llvm-nm over the dep's objects, listed in a
  // response file like the ar rule's (boringssl alone has ~330 of them).
  // The stamp is only written when nothing is referenced, and (restat) left
  // alone when it already exists.
  n.rule("dep_check_undefined", {
    command: `${cfg.jsRuntime} ${fetchCli} check-undefined $name $nm $out.rsp $out $symbols`,
    description: "check undefined symbols in $name",
    rspfile: "$out.rsp",
    rspfile_content: "$in_newline",
    restat: true,
  });

  // The `dep` pool: depth-4 balances two concerns. Each cargo
  // build spawns its own -j parallelism; running them all at once would
  // oversubscribe cores badly (15 × nproc jobs). Four-at-a-time keeps CPU
  // saturated without thrashing. Output streams live via FD 3 regardless —
  // the pool is purely about scheduling, not display.
  n.pool("dep", 4);
}

// ───────────────────────────────────────────────────────────────────────────
// Resolution — emit ninja rules, return absolute paths
// ───────────────────────────────────────────────────────────────────────────

/**
 * Path to a dep's source tree: its `--local-deps` checkout if redirected,
 * else vendor/<name>/. Cross-dep references (lsquic's -I into boringssl,
 * boringssl's nasm -I) go through here so they follow a redirect too. Does
 * NOT handle in-tree sources — use the per-dep
 * `srcDir` computed in resolveDep() for those.
 */
export function depSourceDir(cfg: Config, name: string): string {
  return cfg.localDeps[name] ?? resolve(cfg.vendorDir, name);
}

/**
 * Path to a dep's cmake build output. Separate from source so multiple
 * profiles (debug/release) don't clash.
 */
export function depBuildDir(cfg: Config, name: string): string {
  return resolve(cfg.buildDir, "deps", name);
}

/**
 * The dep's source, with `--local-deps` applied: a dep named there is
 * redirected from its pinned github commit to the local checkout.
 * Only fetched (github/tarball) sources can be redirected.
 */
export function depSource(cfg: Config, dep: Dependency): Source {
  const source = dep.source(cfg);
  const localPath = cfg.localDeps[dep.name];
  if (localPath === undefined) return source;
  assert(
    source.kind === "github" || source.kind === "tarball",
    `--local-deps: ${dep.name} has a ${source.kind} source; only fetched (github/tarball) deps can be redirected`,
    dep.name === "WebKit"
      ? { hint: "WebKit is redirectable with --webkit=source (a prebuilt has no source tree)" }
      : {},
  );
  return {
    kind: "local",
    path: localPath,
    hint: `--local-deps points ${dep.name} at ${localPath} — put ${source.kind === "github" ? `a clone of ${source.repo}` : `the extracted ${source.url}`} there`,
  };
}

/** What the fetch machinery needs from a fetchable source: the URL to get and the identity seed. */
function fetchSpec(source: Extract<Source, { kind: "github" | "tarball" }>): {
  url: string;
  ref: string;
  sparse: string[];
} {
  if (source.kind === "tarball") return { url: source.url, ref: `sha256:${source.sha256}`, sparse: [] };
  const sparse = source.sparse ?? [];
  return {
    url:
      sparse.length > 0
        ? gitArchiveUrl(source.repo, source.commit, sparse)
        : githubArchiveUrl(source.repo, source.commit),
    // The commit alone seeds github identities (so adding this field changed no stamp).
    ref: source.commit,
    sparse,
  };
}

/**
 * Fetch, at configure time, the source of every dep whose graph can only be
 * described with the tree on disk (every CustomBuild — WebKit's file lists
 * live in its own Sources.txt, ICU's in sources.txt). Same fetch,
 * same identity stamp as the ninja `dep_fetch` edge, which is still emitted
 * and is then a no-op; this just runs it early. A no-op itself when the stamp
 * already matches, so the always-configure cost stays a stat.
 */
export async function prefetchConfigureSources(cfg: Config, deps: readonly Dependency[]): Promise<void> {
  for (const dep of deps) {
    if (dep.enabled && !dep.enabled(cfg)) continue;
    const source = depSource(cfg, dep);
    if (source.kind !== "github" && source.kind !== "tarball") continue;
    const build = dep.build(cfg);
    if (build.kind !== "custom") continue;
    const srcDir = depSourceDir(cfg, dep.name);
    const patches = dep.patches === undefined ? [] : typeof dep.patches === "function" ? dep.patches(cfg) : dep.patches;
    const patchPaths = patches.map(p => resolve(cfg.cwd, p));
    const { url, ref, sparse } = fetchSpec(source);
    if (sourceIsCurrent(srcDir, ref, sparse, patchPaths)) continue;
    await fetchDep(dep.name, url, ref, srcDir, resolve(cfg.cacheDir, "tarballs"), patchPaths);
  }
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

  const source = depSource(cfg, dep);
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
      directSources.push(resolve(srcDir, typeof s === "string" ? s : s.path));
    }
    for (const h of Object.values(buildSpec.headers ?? {})) {
      if (typeof h !== "string") directSources.push(resolve(srcDir, h.from));
    }
    if (buildSpec.codegen !== undefined) {
      directSources.push(resolve(srcDir, buildSpec.codegen.tool));
      for (const a of buildSpec.codegen.args) {
        if (a !== "$out") directSources.push(resolve(srcDir, a));
      }
    }
  }

  // ─── Step 1: source acquisition ───
  // Emits a ninja node producing the "source is ready" stamp.
  // For github: this runs fetchCli which downloads/extracts/patches.
  // For local/in-tree: source is already on disk; we use a sentinel file
  //   (CMakeLists.txt) as the stamp. Editing it → reconfigure.
  let sourceStamp: string | undefined;
  if (source.kind === "github" || source.kind === "tarball") {
    sourceStamp = emitFetch(n, cfg, dep.name, source, patches, [...resolvedSources, ...directSources]);
  } else {
    // Local/in-tree: no .ref to write. Use the build system's manifest file
    // as the stamp — touching it triggers reconfigure/rebuild.
    //   cargo deps → Cargo.toml (in manifestDir)
    //   direct/custom/header-only → none: the sources are on disk before
    //     ninja starts, so the compiler depfiles see edits directly. (Stamping
    //     the directory would rebuild the PCH whenever a top-level entry moved.)
    let stampDir: string;
    let stampFile: string;
    if (buildSpec.kind === "cargo") {
      stampDir = resolve(srcDir, buildSpec.manifestDir);
      stampFile = "Cargo.toml";
    } else {
      stampDir = srcDir;
      stampFile = "";
    }
    sourceStamp = stampFile ? resolve(stampDir, stampFile) : undefined;

    const modeName = source.kind === "in-tree" ? "in-tree" : "local";
    assert(existsSync(sourceStamp ?? stampDir), `${modeName} dep "${dep.name}" source not found at ${stampDir}`, {
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
  // On BUILD: implicit. If the cross-dep rebuilds (commit bump), its
  //   headers may have changed; our .o files track them via the inner
  //   ninja's .d files. Restat prunes downstream when nothing changed.
  const fetchDeps = typeof dep.fetchDeps === "function" ? dep.fetchDeps(cfg) : (dep.fetchDeps ?? []);
  const fetchDepStamps = fetchDeps.flatMap(d => {
    const r = resolved.get(d);
    assert(r, `${dep.name}: fetchDeps references '${d}' but it wasn't resolved first — fix allDeps ordering`);
    return r.outputs;
  });

  // ─── Step 2+3: build ───
  let libs: string[];
  let objects: string[] = [];
  let outputs: string[];
  let checks: string[] = [];
  let customIncludes: string[] | undefined;
  let extras: string[] = [];
  let depConfigureInputs: string[] = [];

  if (buildSpec.kind === "cargo") {
    const result = emitCargo(n, cfg, dep.name, buildSpec, { srcDir, sourceStamp: sourceStamp! }); // .ref or Cargo.toml
    libs = result.libs;
    outputs = result.libs;
  } else if (buildSpec.kind === "direct") {
    const result = emitDirect(n, cfg, dep.name, buildSpec, { srcDir, sourceStamp, fetchDepStamps });
    libs = result.libs;
    objects = result.objects;
    checks = result.checks;
    // outputs is the "downstream needs me built" signal — for direct deps
    // that's the generated headers + source stamp, NOT the .o files (those
    // are link inputs, not include-order dependencies).
    outputs = result.headerOutputs;
  } else if (buildSpec.kind === "custom") {
    const ready = [...(sourceStamp === undefined ? [] : [sourceStamp]), ...fetchDepStamps];
    const result = buildSpec.emit(n, cfg, { srcDir, ready, resolved });
    libs = [];
    objects = result.objects;
    outputs = result.outputs;
    customIncludes = result.includes;
    extras = result.extras ?? [];
    depConfigureInputs = result.configureInputs ?? [];
  } else {
    // No build step. The fetch stamp (if any) is the only output. For deps
    // with provides.sources (picohttpparser), emitBun adds a phony pointing
    // at the compiled .o files so `--target <name>` actually compiles them.
    libs = [];
    outputs = sourceStamp === undefined ? [] : [sourceStamp];
  }

  // ─── Resolve include paths ───
  // Includes are relative to the SOURCE dir (in-tree or vendor). Not the
  // cmake subdir — e.g. zstd's headers are at vendor/zstd/lib/, not
  // vendor/zstd/build/cmake/lib/.
  //
  // Includes CAN be absolute — for deps whose headers land in the BUILD dir
  // (generated during configure), the `provides` function computes absolute
  // paths itself using `depBuildDir()`. Relative paths resolve against srcDir.
  const includes = (customIncludes ?? provides.includes).map(inc => {
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
    checks,
    extras,
    configureInputs: depConfigureInputs,
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
 * Must stay in sync with the path computation inside emitCargo /
 * emitPrebuilt — that's the contract between cpp-only
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

  // custom: objects only, folded into cpp-only's archive like direct deps'.

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
  source: Extract<Source, { kind: "github" | "tarball" }>,
  patches: string[],
  compiledSources: string[],
): string {
  const srcDir = depSourceDir(cfg, name);
  const refStamp = resolve(srcDir, ".ref");
  const patchPaths = patches.map(p => resolve(cfg.cwd, p));
  const { url, ref, sparse } = fetchSpec(source);

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
  invalidateStaleSource(name, srcDir, refStamp, ref, sparse, patchPaths);

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
      // Quoted: a sparse git URL carries gitignore-syntax patterns (`*`, `!`).
      url: quote(url, cfg.host.os === "windows"),
      ref: quote(ref, cfg.host.os === "windows"),
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

  // Libs: prebuilt tarballs ship full filenames — `provides.libs` entries
  // are taken as-is relative to destDir.
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
    checks: [],
    extras: [],
    configureInputs: [],
    includes,
    defines: provides.defines ?? [],
    sources: [],
    outputs,
  };
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
  if (spec.buildStd) args.push("-Zbuild-std=std,panic_abort");

  // ─── Environment ───
  // CARGO_ENCODED_RUSTFLAGS: the separator is U+001F (unit separator), not
  // space. This is cargo's way of passing multi-argument flags unambiguously.
  const env: Record<string, string> = {
    CARGO_TERM_COLOR: "always",
  };
  if (cfg.cargoHome !== undefined) env.CARGO_HOME = cfg.cargoHome;
  if (cfg.rustupHome !== undefined) env.RUSTUP_HOME = cfg.rustupHome;
  // Pin the toolchain explicitly. `vendor/` is commonly a symlink shared
  // across worktrees; rustup's directory walk from manifestDir resolves
  // through the symlink and picks up the *target* worktree's
  // `rust-toolchain.toml`. The dep then bundles a libstd that doesn't match
  // the workspace staticlib's, and the link dies on duplicate
  // `rust_eh_personality`. RUSTUP_TOOLCHAIN overrides the directory walk.
  if (cfg.rustToolchain !== undefined) env.RUSTUP_TOOLCHAIN = cfg.rustToolchain;

  // Path remapping (CI reproducibility) — mirrors the C/C++
  // `-ffile-prefix-map` entries in flags.ts and the same block in rust.ts,
  // so vendored Rust deps built here (lol-html) don't embed the absolute
  // checkout path in `file!()`/panic locations/debuginfo either.
  const rustflags: string[] = [...(spec.rustflags ?? [])];
  if (cfg.ci) {
    rustflags.push(`--remap-path-prefix=${cfg.cwd}=.`);
    rustflags.push(`--remap-path-prefix=${cfg.vendorDir}=vendor`);
  }

  if (rustflags.length > 0) {
    // The \x1f encoding is deliberate — see cargo's docs on CARGO_ENCODED_RUSTFLAGS.
    env.CARGO_ENCODED_RUSTFLAGS = rustflags.join("\x1f");
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

  // Cross-compile (Android): cargo's default `cc` linker can't handle the
  // foreign ELF objects. Use our clang as the linker driver and pass
  // --target/--sysroot through, same as the C/C++ deps do via globalFlags.
  // The cdylib output also wants -lunwind, which lives in the NDK's
  // bundled clang resource dir (not the sysroot), so we add that -L too.
  if (cfg.crossTarget !== undefined && spec.rustTarget !== undefined) {
    const envKey = `CARGO_TARGET_${spec.rustTarget.toUpperCase().replace(/-/g, "_")}_LINKER`;
    env[envKey] = cfg.cc;
    const linkArgs = [`-Clink-arg=--target=${cfg.crossTarget}`];
    if (cfg.sysroot !== undefined) linkArgs.push(`-Clink-arg=--sysroot=${cfg.sysroot}`);
    if (cfg.androidNdkRuntimeDir !== undefined) {
      const llvmArch = cfg.arm64 ? "aarch64" : "x86_64";
      linkArgs.push(`-Clink-arg=-L${join(cfg.androidNdkRuntimeDir, llvmArch)}`);
    }
    env.CARGO_ENCODED_RUSTFLAGS = [...rustflags, ...linkArgs].join("\x1f");
  }

  // ─── Emit build node ───
  // dep_cargo_cross prepends `rustup target add` for Tier 2 cross targets.
  // Tier 3 targets (buildStd=true) have no prebuilt std, so target-add would
  // fail — they use plain dep_cargo with -Zbuild-std instead.
  const cross = cfg.crossTarget !== undefined && spec.rustTarget !== undefined && !spec.buildStd;
  n.build({
    outputs: [lib],
    rule: cross ? "dep_cargo_cross" : "dep_cargo",
    inputs: [],
    // Rebuild if source changed, cargo binary changed, or the pinned
    // toolchain changed. Cargo's own dependency tracking handles file-level
    // granularity below manifestDir. `rust-toolchain.toml` matters because
    // the dep's staticlib bundles a copy of libstd — if the workspace
    // staticlib is built with a different nightly, the two archives carry
    // mismatched std hashes and both get pulled into the link, colliding on
    // unmangled symbols like `rust_eh_personality`.
    implicitInputs: [sourceStamp, cfg.cargo, resolve(cfg.cwd, "rust-toolchain.toml")],
    vars: {
      name,
      manifestdir: manifestDir,
      args: quoteArgs(args, hostWin),
      ...(cross ? { rust_target: spec.rustTarget! } : {}),
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
  /** Fetch `.ref` stamp; undefined for local/in-tree sources (already on disk). */
  sourceStamp: string | undefined;
  fetchDepStamps: string[];
}

/**
 * Compile a dep's sources directly — no cmake/cargo sub-process.
 *
 * Each .c becomes a `cc` build edge with the dep globals
 * (computeDepFlags), so ASAN/opt/target stay consistent with the
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
): { libs: string[]; objects: string[]; headerOutputs: string[]; checks: string[] } {
  const { srcDir, sourceStamp, fetchDepStamps } = input;
  const buildDir = depBuildDir(cfg, name);
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);

  n.comment(`─── ${name} (direct) ───`);

  // Library flags: globals (includes ASAN when cfg.asan) + dep's own includes
  // and defines. `lang` picks the flag set; the compile function is chosen
  // per-file by extension below.
  const depFlags = computeDepFlags(cfg);
  const isCxx = spec.lang === "cxx";
  const baseFlags = isCxx ? depFlags.cxxflags : depFlags.cflags;

  // PIC: spec.pic → -fPIC; otherwise on darwin undo apple-clang's PIC
  // default to match the non-PIE final binary.
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
  const orderOnly = [...(sourceStamp === undefined ? [] : [sourceStamp]), ...fetchDepStamps];

  // ─── Generated headers (optional) ───
  // Literal-string headers are written at configure time via writeIfChanged
  // (mtime only moves when contents change). HeaderSubst headers become
  // ninja edges — their template lives in srcDir, which doesn't exist
  // until fetch runs. Either way buildDir goes on -I and the outputs are
  // implicit inputs to every cc edge.
  const headers = Object.entries(spec.headers ?? {});
  const needsBuildDirInc = headers.length > 0 || spec.codegen !== undefined;
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

  // ─── Codegen (optional) ───
  let generatedHeader: string | undefined;
  if (spec.codegen !== undefined) {
    const cg = spec.codegen;
    const toolSrc = resolve(srcDir, cg.tool);
    // Host exe suffix: clang on Windows auto-appends .exe to `-o foo`, so
    // the ninja output name must match or the edge is permanently dirty.
    const toolOut = resolve(buildDir, `codegen-tool${cfg.host.exeSuffix}`);

    // Host tool: runs at build time to generate headers, so it must target
    // the BUILD host, not the bun target. cc()/link() add cfg's target/arch
    // flags which break cross-compiles (musl CI: "file format not
    // recognized"). Emit a bare clang invocation instead — no opt, no
    // target triple, just the tool defines and -w. Compile+link in one go
    // so host-arch objects never land in obj/ (which would dirty ccache
    // for the target build).
    const toolDefs = Object.entries(cg.toolDefines ?? {}).map(([k, v]) => defineFlag(k, v));
    n.build({
      outputs: [toolOut],
      rule: "dep_host_cc",
      inputs: [toolSrc],
      orderOnlyInputs: orderOnly,
      vars: { flags: ["-w", ...toolDefs].join(" ") },
    });
    const toolExe = toolOut;

    // Run tool. "$out" in args expands to the generated header's absolute
    // path; other args resolve against srcDir. Tool runs with srcDir as
    // cwd so relative input paths it opens internally Just Work.
    generatedHeader = resolve(buildDir, cg.output);
    const argv = cg.args.map(a => (a === "$out" ? generatedHeader! : resolve(srcDir, a)));

    n.build({
      outputs: [generatedHeader],
      rule: "dep_codegen",
      inputs: [toolExe],
      vars: {
        name,
        desc: `codegen ${name} ${cg.output}`,
        opts: `--cwd=${q(srcDir)}`,
        cmd: quoteArgs([toolExe, ...argv], hostWin),
      },
    });
  }

  // ─── Compile + archive ───
  // Generated headers (codegen + subst) are implicit inputs to every .o —
  // library sources include them. buildDir goes on -I so #include "foo.h"
  // finds literal, subst, and codegen headers alike.
  if (generatedHeader !== undefined) generated.push(generatedHeader);
  const implicit = generated;
  const genInc = needsBuildDirInc ? [`-I${q(buildDir)}`] : [];

  const objects = spec.sources.map(s => {
    const path = typeof s === "string" ? s : s.path;
    const extra = typeof s === "string" ? [] : s.cflags;
    const abs = resolve(srcDir, path);
    // .asm → nasm() (NASM syntax, x64). .c/.S → cc() (clang's
    // integrated assembler handles .S), prepending `-x c++` when lang:"cxx"
    // forces a C source through the C++ frontend (mimalloc). Everything
    // else (.cc/.cpp/.cxx) → cxx().
    if (path.endsWith(".asm")) {
      return nasm(n, cfg, abs, { flags: [...(spec.nasmflags ?? []), ...extra], orderOnlyInputs: orderOnly });
    }
    const isC = path.endsWith(".c");
    const isAsm = path.endsWith(".S");
    const opts = {
      flags: [...(isC && isCxx ? ["-x", "c++"] : []), ...libFlags, ...genInc, ...extra],
      orderOnlyInputs: orderOnly,
      implicitInputs: implicit,
    };
    return isC || isAsm ? cc(n, cfg, abs, opts) : cxx(n, cfg, abs, opts);
  });

  const checks = spec.forbidUndefined === undefined ? [] : emitForbidUndefined(n, cfg, name, spec, objects, buildDir);

  // Default: hand the objects straight to bun's link line — no intermediate
  // archive. With cfg.archiveDeps the old per-dep .a is produced instead
  // (useful for bisecting duplicate-symbol issues, since a .a only
  // contributes members the linker actually pulls).
  if (cfg.archiveDeps) {
    // ar's output dir + the per-source obj dirs both need pre-creating —
    // configure.ts:mkdirAll only sees `output.objects`, which is empty
    // in this branch.
    mkdirSync(buildDir, { recursive: true });
    for (const o of objects) mkdirSync(resolve(o, ".."), { recursive: true });
    const lib = ar(n, cfg, join("deps", name, `${cfg.libPrefix}${name}${cfg.libSuffix}`), objects, checks);
    n.phony(name, [lib]);
    return { libs: [lib], objects: [], headerOutputs: [lib], checks };
  }
  n.phony(name, [...objects, ...checks]);
  // headerOutputs: what downstream needs to wait on for HEADERS to be
  // ready. For no-archive direct deps that's the generated header set
  // (subst/literal/codegen) plus the fetch stamp — not the .o files.
  return {
    libs: [],
    objects,
    headerOutputs: sourceStamp === undefined ? generated : [...generated, sourceStamp],
    checks,
  };
}

/**
 * The `forbidUndefined` edge: every object except the `except` sources' goes
 * in, the stamp comes out. Returns the stamp, or nothing when llvm-nm is
 * unavailable. The objects are in `spec.sources` order, which is how the
 * exceptions are mapped onto them.
 */
function emitForbidUndefined(
  n: Ninja,
  cfg: Config,
  name: string,
  spec: DirectBuild,
  objects: string[],
  buildDir: string,
): string[] {
  const { symbols, except = [] } = spec.forbidUndefined!;
  assert(symbols.length > 0, `${name}: forbidUndefined.symbols is empty`);
  const sourcePaths = spec.sources.map(src => (typeof src === "string" ? src : src.path));
  for (const exception of except) {
    assert(
      sourcePaths.includes(exception),
      `${name}: forbidUndefined.except lists ${exception}, which is not one of its sources`,
    );
  }
  const checked = objects.filter((_, i) => !except.includes(sourcePaths[i]!));
  assert(checked.length > 0, `${name}: forbidUndefined excepts every source`);
  if (cfg.nm === undefined) return [];

  mkdirSync(buildDir, { recursive: true });
  const stamp = resolve(buildDir, ".undefined-symbols-checked");
  n.build({
    outputs: [stamp],
    rule: "dep_check_undefined",
    inputs: checked,
    implicitInputs: [fetchCliPath],
    vars: { name, nm: quote(cfg.nm, cfg.host.os === "windows"), symbols: symbols.join(",") },
  });
  return [stamp];
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

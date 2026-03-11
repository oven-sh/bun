/**
 * The bun executable target — orchestrates everything.
 *
 * This is where all the phases come together:
 *   - resolve all deps → lib paths + include dirs
 *   - emit codegen → generated .cpp/.h/.zig
 *   - emit zig build → bun-zig.o
 *   - build PCH from root.h (implicit deps: WebKit libs + all codegen)
 *   - compile all C/C++ with the PCH
 *   - link everything → bun-debug (or bun-profile, bun-asan, etc.)
 *   - smoke test: run `<exe> --revision` to catch load-time failures
 *
 * ## Build modes
 *
 * `cfg.mode` controls what we actually produce:
 *   - "full": everything (default, local dev)
 *   - "cpp-only": compile to libbun.a, skip zig/link (CI upstream) — TODO(ci-split)
 *   - "link-only": link pre-built artifacts (CI downstream) — TODO(ci-split)
 *
 * cpp-only/link-only are for the CI split where C++ and zig build in
 * parallel on separate machines then meet for linking.
 */

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { emitCodegen, zigFilesGeneratedIntoSrc, type CodegenOutputs } from "./codegen.ts";
import { ar, cc, cxx, link, pch } from "./compile.ts";
import { bunExeName, shouldStrip, type Config } from "./config.ts";
import { generateDepVersionsHeader } from "./depVersionsHeader.ts";
import { allDeps } from "./deps/index.ts";
import { zstd } from "./deps/zstd.ts";
import { assert } from "./error.ts";
import { bunIncludes, computeFlags, extraFlagsFor, linkDepends } from "./flags.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { quote, slash } from "./shell.ts";
import { computeDepLibs, depSourceStamp, resolveDep, type ResolvedDep } from "./source.ts";
import type { Sources } from "./sources.ts";
import { streamPath } from "./stream.ts";
import { emitZig } from "./zig.ts";

// ───────────────────────────────────────────────────────────────────────────
// Executable naming
// ───────────────────────────────────────────────────────────────────────────

// Re-exported for existing importers (configure.ts, ci.ts). These live
// in config.ts now so flags.ts can use bunExeName without circular import.
export { bunExeName, shouldStrip };

/**
 * System libraries to link. Platform-dependent.
 */
function systemLibs(cfg: Config): string[] {
  const libs: string[] = [];

  if (cfg.linux) {
    libs.push("-lc", "-lpthread", "-ldl");
    // libatomic: static by default (CI distros ship it), dynamic on Arch-like.
    // The static path needs to be the actual file path for lld to find it;
    // dynamic uses -l syntax. We emit what CMake does: bare libatomic.a gets
    // found in lib search paths, -latomic.so doesn't exist so we use -latomic.
    if (cfg.staticLibatomic) {
      libs.push("-l:libatomic.a");
    } else {
      libs.push("-latomic");
    }
    // Linux local WebKit: link system ICU (prebuilt bundles its own).
    // Assumes system ICU is in default lib paths — true on most distros.
    if (cfg.webkit === "local") {
      libs.push("-licudata", "-licui18n", "-licuuc");
    }
  }

  if (cfg.darwin) {
    // icucore: system ICU framework.
    // resolv: DNS resolution (getaddrinfo et al).
    libs.push("-licucore", "-lresolv");
  }

  if (cfg.windows) {
    // Explicit .lib: these go after /link so no auto-suffixing by the
    // clang-cl driver. lld-link auto-appends .lib but link.exe doesn't;
    // explicit is portable.
    libs.push(
      "winmm.lib",
      "bcrypt.lib",
      "ntdll.lib",
      "userenv.lib",
      "dbghelp.lib",
      "crypt32.lib",
      "wsock32.lib", // ws2_32 + wsock32 — wsock32 has TransmitFile (sendfile equiv)
      "ws2_32.lib",
      "delayimp.lib", // required for /delayload: in release
    );
  }

  return libs;
}

// ───────────────────────────────────────────────────────────────────────────
// Main orchestration
// ───────────────────────────────────────────────────────────────────────────

/**
 * Output of `emitBun()`. Paths to the produced artifacts and resolved
 * deps — used by configure.ts for mkdir + default-target selection, and
 * by ci.ts for artifact upload.
 *
 * Optional fields are present only when the mode produces them:
 *   full:      exe, strippedExe?, dsym?, zigObjects, objects, deps, codegen
 *   cpp-only:  archive, objects, deps, codegen
 *   zig-only:  zigObjects, deps (zstd), codegen
 *   link-only: exe, strippedExe?, dsym?
 */
export interface BunOutput {
  /** Linked executable (bun-debug, bun-profile). Full/link-only. */
  exe?: string;
  /** Stripped `bun`. Plain release full/link-only. */
  strippedExe?: string | undefined;
  /** .dSYM bundle (darwin plain release). Added to default targets so ninja builds it. */
  dsym?: string | undefined;
  /** libbun.a — all C/C++ objects archived. cpp-only. */
  archive?: string;
  /** All resolved deps (full libs list). Empty in link-only (paths computed separately). */
  deps: ResolvedDep[];
  /** All codegen outputs. Not present in link-only. */
  codegen?: CodegenOutputs;
  /** The zig object file(s). Empty in cpp-only. */
  zigObjects: string[];
  /** All compiled .o files. Empty in link-only/zig-only. */
  objects: string[];
}

/**
 * Emit the full bun build graph. Returns the output executable path.
 *
 * Call after `registerAllRules(n, cfg)`. `sources` is the globbed file
 * snapshot from `globAllSources()` — passed in so globbing happens once.
 */
export function emitBun(n: Ninja, cfg: Config, sources: Sources): BunOutput {
  // Split modes get minimal graphs — separate functions.
  if (cfg.mode === "zig-only") {
    return emitZigOnly(n, cfg, sources);
  }
  if (cfg.mode === "link-only") {
    return emitLinkOnly(n, cfg);
  }

  const exeName = bunExeName(cfg);

  n.comment("════════════════════════════════════════════════════════════════");
  n.comment(`  Building ${exeName}`);
  n.comment("════════════════════════════════════════════════════════════════");
  n.blank();

  // ─── Step 1: resolve all deps ───
  n.comment("─── Dependencies ───");
  n.blank();
  const deps: ResolvedDep[] = [];
  for (const dep of allDeps) {
    const resolved = resolveDep(n, cfg, dep);
    if (resolved !== null) deps.push(resolved);
  }

  // Collect all dep lib paths, include dirs, output stamps, and directly-
  // compiled source files (deps like picohttpparser that provide .c files
  // instead of a .a — we compile those alongside bun's own sources).
  const depLibs: string[] = [];
  const depIncludes: string[] = [];
  const depOutputs: string[] = []; // PCH order-only-deps on these
  const depCSources: string[] = [];
  for (const d of deps) {
    depLibs.push(...d.libs);
    depIncludes.push(...d.includes);
    depOutputs.push(...d.outputs);
    depCSources.push(...d.sources);
  }

  // ─── Step 2: codegen ───
  const codegen = emitCodegen(n, cfg, sources);

  // ─── Step 3: zig ───
  // zstd source must be FETCHED (not built) before zig runs — build.zig
  // @cImports zstd headers. The fetch stamp is the order-only dep.
  //
  // Filter codegen-into-src .zig files from the glob result — they're
  // OUTPUTS of steps above, not inputs to zig build. Leaving them in
  // would create a cycle (or a fresh-build error: file doesn't exist yet).
  //
  // cpp-only: skip zig entirely (runs on a separate CI machine).
  let zigObjects: string[] = [];
  if (cfg.mode !== "cpp-only") {
    const codegenZigSet = new Set(zigFilesGeneratedIntoSrc.map(p => resolve(cfg.cwd, p)));
    const zigSources = sources.zig.filter(f => !codegenZigSet.has(f));
    zigObjects = emitZig(n, cfg, {
      codegenInputs: codegen.zigInputs,
      codegenOrderOnly: codegen.zigOrderOnly,
      zigSources,
      zstdStamp: depSourceStamp(cfg, "zstd"),
    });
  }

  // ─── Step 4: configure-time generated header + assemble flags ───
  // bun_dependency_versions.h — written at configure time, not a ninja rule.
  // BunProcess.cpp includes it for process.versions. writeIfNotChanged
  // semantics so bumping an unrelated dep doesn't recompile everything.
  generateDepVersionsHeader(cfg);

  const flags = computeFlags(cfg);

  // Full include set: bun's own + all dep includes + buildDir (for the
  // generated versions header).
  const allIncludes = [...bunIncludes(cfg), cfg.buildDir, ...depIncludes];
  const includeFlags = allIncludes.map(inc => `-I${inc}`);
  const defineFlags = flags.defines.map(d => `-D${d}`);

  // Final flag arrays for compile.
  const cxxFlagsFull = [...flags.cxxflags, ...includeFlags, ...defineFlags];
  const cFlagsFull = [...flags.cflags, ...includeFlags, ...defineFlags];

  // ─── Step 5: PCH ───
  // In CI, only the cpp-only job uses PCH — full mode skips it since the
  // cpp-only artifacts are what actually get used downstream.
  //
  // Not on Windows: matches cmake (BuildBun.cmake:868 gated on NOT WIN32).
  // clang-cl's /Yc//Yu flags exist but the wrapper+stub mechanism here
  // is built around clang's -emit-pch model. If Windows PCH is wanted
  // later, see compile.ts TODO(windows) for what needs wiring.
  const usePch = !cfg.windows && (!cfg.ci || cfg.mode === "cpp-only");
  let pchOut: { pch: string; wrapperHeader: string } | undefined;

  if (usePch) {
    n.comment("─── PCH ───");
    n.blank();
    // Dep outputs are IMPLICIT inputs (not order-only). The crucial case is
    // local WebKit: headers live in buildDir and get REGENERATED by dep_build
    // mid-run. At startup, ninja sees old headers via PCH's depfile → thinks
    // PCH is fresh. dep_build then regenerates them. cxx fails with "file
    // modified since PCH was built". As implicit inputs, restat sees the .a
    // changed → PCH rebuilds → one-build convergence. See the pch() docstring.
    //
    // Codegen stays order-only: those outputs only change if inputs change,
    // and inputs don't change mid-build. cppAll (not all) — bake/.zig outputs
    // are zig-only; pulling them here would run bake-codegen in cpp-only CI
    // mode where it fails on the pinned bun version (see cppAll docstring).
    // Scripts that emit undeclared .h also emit a .cpp/.h in cppAll, so they
    // still run. cxx transitively waits: cxx → PCH → deps+cppAll.
    pchOut = pch(n, cfg, "src/bun.js/bindings/root.h", {
      flags: cxxFlagsFull,
      implicitInputs: depOutputs,
      orderOnlyInputs: codegen.cppAll,
    });
  }

  // ─── Step 6: compile C/C++ ───
  n.comment("─── C/C++ compilation ───");
  n.blank();

  // Source lists: from the pre-globbed snapshot + platform extras.
  const cxxSources = [...sources.cxx];
  const cSources = [...sources.c];

  // Windows-only cpp sources (rescle — PE resource editor for --compile).
  if (cfg.windows) {
    cxxSources.push(
      resolve(cfg.cwd, "src/bun.js/bindings/windows/rescle.cpp"),
      resolve(cfg.cwd, "src/bun.js/bindings/windows/rescle-binding.cpp"),
    );
  }

  // Sources provided directly by deps (picohttpparser.c). These are
  // declared as implicit outputs of their fetch rules, so ninja knows
  // where they come from; we compile them like any other .c file.
  cSources.push(...depCSources);

  // Codegen .cpp files — compiled like regular sources.
  cxxSources.push(...codegen.cppSources);
  cxxSources.push(...codegen.bindgenV2Cpp);

  // All deps must be ready (headers extracted, libs built) before compile.
  // ORDER-ONLY, not implicit: the compiler's .d depfile tracks ACTUAL header
  // dependencies on subsequent builds. Order-only ensures first-build ordering;
  // after that, touching libJavaScriptCore.a doesn't recompile every .c file
  // (.c files don't include JSC headers — depfile knows this).
  //
  // PCH is different: it has IMPLICIT deps on depOutputs because root.h
  // transitively includes WebKit headers, and the PCH encodes those. If
  // WebKit headers change (lib rebuilt), PCH must invalidate. The depfile
  // mechanism doesn't work for PCH-invalidation because the .cpp's depfile
  // says "depends on root.h.pch", not on what root.h.pch was built from.
  const depOrderOnly = [...depOutputs, ...codegen.cppAll];

  // Compile all .cpp with PCH.
  const cxxObjects: string[] = [];
  for (const src of cxxSources) {
    const relSrc = relative(cfg.cwd, src);
    const extraFlags = extraFlagsFor(cfg, relSrc);
    const opts: Parameters<typeof cxx>[3] = {
      flags: [...cxxFlagsFull, ...extraFlags],
    };
    if (pchOut !== undefined) {
      // PCH has implicit deps on depOutputs. cxx has implicit dep on PCH.
      // Transitively: cxx waits for deps. No need for order-only here.
      opts.pch = pchOut.pch;
      opts.pchHeader = pchOut.wrapperHeader;
    } else {
      // No PCH (windows) — each cxx needs direct ordering on deps.
      // Order-only: depfile tracks actual headers after first build.
      opts.orderOnlyInputs = depOrderOnly;
    }
    cxxObjects.push(cxx(n, cfg, src, opts));
  }

  // Compile all .c files. No PCH. Order-only on deps for first-build ordering.
  const cObjects: string[] = [];
  for (const src of cSources) {
    cObjects.push(
      cc(n, cfg, src, {
        flags: cFlagsFull,
        orderOnlyInputs: depOrderOnly,
      }),
    );
  }

  const allObjects = [...cxxObjects, ...cObjects];

  // ─── Step 7: cpp-only → archive and return ───
  // CI's build-cpp step: archive all .o into libbun.a, stop. The sibling
  // build-zig step produces bun-zig.o independently; build-bun downloads
  // both artifacts and links them. Archive name uses the exe name (not
  // just "libbun") so asan/debug variants are distinguishable in artifacts.
  if (cfg.mode === "cpp-only") {
    n.comment("─── Archive (cpp-only) ───");
    n.blank();
    const archiveName = `${cfg.libPrefix}${exeName}${cfg.libSuffix}`;
    const archive = ar(n, cfg, archiveName, allObjects);
    n.phony("bun", [archive]);
    n.default(["bun"]);
    return { archive, deps, codegen, zigObjects, objects: allObjects };
  }

  // ─── Step 7: link ───
  n.comment("─── Link ───");
  n.blank();

  // Windows resources (.rc → .res): icon, VersionInfo. Compiled at link
  // time (not archived in cpp-only) — .res is small and the .rc depends
  // on cfg.version which the link step already has. Matches cmake's
  // behavior of adding WINDOWS_RESOURCES to add_executable in link-only.
  const windowsRes = cfg.windows ? [emitWindowsResources(n, cfg)] : [];

  // Full link.
  const exe = link(n, cfg, exeName, [...allObjects, ...zigObjects, ...windowsRes], {
    libs: depLibs,
    flags: [...flags.ldflags, ...systemLibs(cfg), ...manifestLinkFlags(cfg)],
    implicitInputs: linkImplicitInputs(cfg),
  });

  // ─── Step 8: post-link (strip + dsymutil) ───
  // Plain release only: produce stripped `bun` alongside `bun-profile`.
  // Debug/asan/etc. keep symbols (you want them for debugging).
  let strippedExe: string | undefined;
  let dsym: string | undefined;
  if (shouldStrip(cfg)) {
    strippedExe = emitStrip(n, cfg, exe, flags.stripflags);
    // darwin: extract debug symbols from the UNSTRIPPED exe into a .dSYM
    // bundle. dsymutil reads DWARF from bun-profile, writes bun-profile.dSYM.
    // Must run BEFORE stripping could discard sections it needs (we don't
    // strip bun-profile itself, only copy → bun, so this is safe).
    if (cfg.darwin) {
      dsym = emitDsymutil(n, cfg, exe, exeName);
    }
  }

  // Phony `bun` target for convenience — only when strip DIDN'T produce a
  // literal file named `bun` (which would collide with the phony). When
  // strip runs, `ninja bun` builds the actual stripped file; no phony needed.
  if (strippedExe === undefined) {
    n.phony("bun", [exe]);
  }

  // ─── Step 9: smoke test ───
  // Run `<exe> --revision`. If it exits non-zero or crashes, something
  // broke at load time (missing symbol, static initializer blowup, ABI
  // mismatch). Catching this HERE is much better than "CI passes, user
  // runs bun, it segfaults".
  //
  // Linux+ASAN quirk: some systems need ASLR disabled (`setarch -R`) for
  // ASAN binaries to run from subprocesses (shadow memory layout conflict
  // with ELF_ET_DYN_BASE, see sanitizers/856). We try with setarch first,
  // fall back to direct invocation.
  emitSmokeTest(n, cfg, exe, exeName);

  return { exe, strippedExe, dsym, deps, codegen, zigObjects, objects: allObjects };
}

/**
 * zig-only mode: emit just the zig build graph. CI's build-zig step uses
 * this to cross-compile bun-zig.o on a linux box for all target platforms
 * (zig cross-compiles cleanly; target set via --os/--arch overrides).
 *
 * Needs:
 *   - zstd FETCHED (build.zig @cImports its headers) — not built
 *   - codegen (zig subset: embedFiles, generated .zig modules)
 *   - zig compiler downloaded + zig build
 *
 * Does NOT need: any dep built, any cxx, PCH, link. ninja only pulls
 * what's depended on — zstd's configure/build rules are emitted but
 * unused (its .ref stamp is the only dependency from emitZig).
 */
function emitZigOnly(n: Ninja, cfg: Config, sources: Sources): BunOutput {
  n.comment("════════════════════════════════════════════════════════════════");
  n.comment(`  Building bun-zig.o (zig-only, target: ${cfg.os}-${cfg.arch})`);
  n.comment("════════════════════════════════════════════════════════════════");
  n.blank();

  // Only dep: zstd, for @cImport headers. resolveDep emits its
  // fetch/configure/build; emitZig only depends on the fetch stamp.
  const zstdDep = resolveDep(n, cfg, zstd);
  assert(zstdDep !== null, "zstd resolveDep returned null — should never be skipped");

  // Codegen: emitted fully, but only zigInputs/zigOrderOnly are pulled.
  // The cpp-related outputs (cppSources, bindgenV2Cpp) have no consumer
  // in this graph — ninja skips them.
  const codegen = emitCodegen(n, cfg, sources);

  const codegenZigSet = new Set(zigFilesGeneratedIntoSrc.map(p => resolve(cfg.cwd, p)));
  const zigSources = sources.zig.filter(f => !codegenZigSet.has(f));
  const zigObjects = emitZig(n, cfg, {
    codegenInputs: codegen.zigInputs,
    codegenOrderOnly: codegen.zigOrderOnly,
    zigSources,
    zstdStamp: depSourceStamp(cfg, "zstd"),
  });

  n.phony("bun", zigObjects);
  n.default(["bun"]);

  return { deps: [zstdDep], codegen, zigObjects, objects: [] };
}

/**
 * link-only mode: link artifacts downloaded from sibling buildkite steps.
 * CI's build-bun step. Build.ts downloads into buildDir BEFORE ninja runs;
 * ninja sees the files as source inputs (no build rule — errors cleanly
 * if download failed or paths drift).
 *
 * Expected artifacts (same paths cpp-only/zig-only produced):
 *   - libbun-profile.a            — from cpp-only's ar()
 *   - bun-zig.o                   — from zig-only
 *   - deps/<name>/lib<name>.a     — from cpp-only's dep builds
 *   - cache/webkit-<hash>/lib/... — WebKit prebuilt (same cache path)
 */
function emitLinkOnly(n: Ninja, cfg: Config): BunOutput {
  const exeName = bunExeName(cfg);

  n.comment("════════════════════════════════════════════════════════════════");
  n.comment(`  Linking ${exeName} (link-only — artifacts from buildkite)`);
  n.comment("════════════════════════════════════════════════════════════════");
  n.blank();

  // Dep lib paths — computed, not built. Must match cpp-only's output
  // paths exactly; computeDepLibs() and emitNestedCmake()'s path logic
  // share the same formula. If they drift, link fails with "file not
  // found" — loud enough to catch in CI.
  const depLibs: string[] = [];
  for (const dep of allDeps) {
    depLibs.push(...computeDepLibs(cfg, dep));
  }

  // Archive from cpp-only: same name cpp-only emits (exe name + lib
  // prefix/suffix, e.g. libbun-profile.a).
  const archive = resolve(cfg.buildDir, `${cfg.libPrefix}${exeName}${cfg.libSuffix}`);

  // bun-zig.o from zig-only: same path emitZig writes to.
  // Hardcoded filename — emitZig uses "bun-zig.o" regardless of platform
  // (zig outputs ELF-like obj format by default; -Dobj_format=obj for
  // windows → COFF, but filename stays the same).
  const zigObj = resolve(cfg.buildDir, "bun-zig.o");

  // Only need ldflags + stripflags (no cflags/cxxflags — no compile).
  const flags = computeFlags(cfg);

  n.comment("─── Link ───");
  n.blank();

  // Windows resources: compiled here, not downloaded from cpp-only.
  // .res is small; .rc substitution depends on cfg.version which link-only
  // knows. Matches cmake's BUN_LINK_ONLY adding WINDOWS_RESOURCES directly.
  const windowsRes = cfg.windows ? [emitWindowsResources(n, cfg)] : [];

  const exe = link(n, cfg, exeName, [archive, zigObj, ...windowsRes], {
    libs: depLibs,
    flags: [...flags.ldflags, ...systemLibs(cfg), ...manifestLinkFlags(cfg)],
    implicitInputs: linkImplicitInputs(cfg),
  });

  // Strip + smoke test — same as full mode.
  let strippedExe: string | undefined;
  let dsym: string | undefined;
  if (shouldStrip(cfg)) {
    strippedExe = emitStrip(n, cfg, exe, flags.stripflags);
    if (cfg.darwin) dsym = emitDsymutil(n, cfg, exe, exeName);
  }
  if (strippedExe === undefined) n.phony("bun", [exe]);
  emitSmokeTest(n, cfg, exe, exeName);

  return {
    exe,
    strippedExe,
    dsym,
    deps: [], // no ResolvedDep — we only computed lib paths
    zigObjects: [zigObj],
    objects: [],
  };
}

/**
 * Smoke test: run the built executable with --revision. If it crashes or
 * errors, the build failed — typically means a link-time issue that the
 * linker didn't catch (missing symbol only referenced at init, ICU ABI
 * mismatch, etc.).
 */
function emitSmokeTest(n: Ninja, cfg: Config, exe: string, exeName: string): void {
  const stamp = resolve(cfg.buildDir, `${exeName}.smoke-test-passed`);

  // Linux+ASAN: wrap in `setarch <arch> -R` to disable ASLR. Fall back
  // to direct invocation if setarch fails (not all systems have it).
  // The `|| true` on the outer command isn't there — if BOTH fail, we
  // want the rule to error.
  const envWrap = "env BUN_DEBUG_QUIET_LOGS=1";
  let testCmd: string;
  if (cfg.linux && cfg.asan) {
    const arch = cfg.x64 ? "x86_64" : "aarch64";
    testCmd = `${envWrap} setarch ${arch} -R ${exe} --revision || ${envWrap} ${exe} --revision`;
  } else if (cfg.windows) {
    // Windows: no setarch, no env wrapper syntax differences matter for
    // this simple case. cmd /c handles the pipe.
    testCmd = `${exe} --revision`;
  } else {
    testCmd = `${envWrap} ${exe} --revision`;
  }

  // stream.ts --console: passthrough + ninja Windows buffering fix.
  // sh -c with parens: testCmd may contain `||` (ASAN setarch fallback);
  // without grouping, `a || b && touch` parses as `a || (b && touch)` —
  // stamp wouldn't get written when setarch succeeds.
  const q = (p: string) => quote(p, cfg.windows);
  const wrap = `${q(cfg.bun)} ${q(streamPath)} check --console`;
  n.rule("smoke_test", {
    command: cfg.windows
      ? `${wrap} cmd /c "${testCmd} && type nul > $out"`
      : `${wrap} sh -c '( ${testCmd} ) && touch $out'`,
    description: `${exeName} --revision`,
    // pool = console: user wants to see the revision output.
    pool: "console",
  });

  n.build({
    outputs: [stamp],
    rule: "smoke_test",
    inputs: [exe],
  });

  // Phony target — `ninja check` runs the smoke test.
  n.phony("check", [stamp]);
}

/**
 * Strip the linked executable → plain `bun`. Returns absolute path to
 * the stripped output.
 *
 * Input (bun-profile) is NOT modified — strip writes a new file via `-o`.
 * The profile binary keeps its symbols for profiling/debugging release crashes.
 */
function emitStrip(n: Ninja, cfg: Config, inputExe: string, stripflags: string[]): string {
  const out = resolve(cfg.buildDir, "bun" + cfg.exeSuffix);

  // Windows: strip equivalent is handled at link time (/OPT:REF etc), no
  // separate strip binary. The "stripped" bun is just a copy.
  if (cfg.windows) {
    // Copy as-is. /OPT:REF already applied at link.
    n.rule("strip", {
      command: `cmd /c "copy /Y $in $out"`,
      description: "copy $out (windows: no strip)",
    });
  } else {
    n.rule("strip", {
      command: `${quote(cfg.strip, false)} $stripflags $in -o $out`,
      description: "strip $out",
    });
  }

  n.build({
    outputs: [out],
    rule: "strip",
    inputs: [inputExe],
    vars: cfg.windows ? {} : { stripflags: stripflags.join(" ") },
  });

  return out;
}

/**
 * Extract debug symbols from the linked (unstripped) executable into a
 * .dSYM bundle. darwin-only.
 *
 * Runs dsymutil on bun-profile (which has full DWARF). The .dSYM lets you
 * symbolicate crash logs from the stripped `bun` — lldb/Instruments find
 * it automatically by UUID.
 */
function emitDsymutil(n: Ninja, cfg: Config, inputExe: string, exeName: string): string {
  assert(cfg.darwin, "dsymutil is darwin-only");
  assert(cfg.dsymutil !== undefined, "dsymutil not found in toolchain");

  const out = resolve(cfg.buildDir, `${exeName}.dSYM`);

  // --flat: single-file .dSYM (not a bundle directory). Simpler to upload
  //   as a CI artifact.
  // --keep-function-for-static: keep symbols for static functions (more
  //   complete backtraces).
  // --object-prefix-map: rewrite DWARF path prefixes so debuggers find
  //   source in the repo root rather than the build machine's absolute path.
  // -j: parallelism. Use all cores (dsymutil parallelizes per compile unit).
  //   CMake uses CMAKE_BUILD_PARALLEL_LEVEL; we use nproc equivalent via
  //   a subshell.
  // stream.ts --console for pool:console consistency (no-op on darwin).
  const q = (p: string) => quote(p, false); // darwin-only → posix
  const wrap = `${q(cfg.bun)} ${q(streamPath)} dsym --console`;
  n.rule("dsymutil", {
    command: `${wrap} sh -c '${cfg.dsymutil} $in --flat --keep-function-for-static --object-prefix-map .=${cfg.cwd} -o $out -j $$(sysctl -n hw.ncpu)'`,
    description: "dsymutil $out",
    // Not restat — dsymutil always writes.
    pool: "console", // Can take a while, show progress
  });

  n.build({
    outputs: [out],
    rule: "dsymutil",
    inputs: [inputExe],
  });

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Windows resources (.rc → .res)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Template-substitute windows-app-info.rc and compile it with llvm-rc.
 * Returns the path to the .res output (to be linked like an object file).
 *
 * The .rc file provides:
 *   - Icon (bun.ico)
 *   - VS_VERSION_INFO resource (ProductName, FileVersion, CompanyName, ...)
 *
 * This resource section is what rescle's ResourceUpdater modifies when
 * `bun build --compile --windows-title ...` runs. Without it, the copied
 * bun.exe has no VersionInfo to update and rescle silently does nothing.
 *
 * The manifest (longPathAware + SegmentHeap) is embedded at link time via
 * /MANIFESTINPUT — see manifestLinkFlags().
 */
function emitWindowsResources(n: Ninja, cfg: Config): string {
  assert(cfg.windows, "emitWindowsResources is windows-only");
  assert(cfg.rc !== undefined, "llvm-rc not found in toolchain");

  // ─── Template substitution (configure time) ───
  // The .rc uses @VAR@ cmake-style placeholders. Substitute and write to
  // buildDir (not codegenDir — link-only doesn't create codegenDir).
  // writeIfChanged → mtime preserved → no spurious rc rebuild when the
  // substituted content hasn't changed.
  const rcTemplate = resolve(cfg.cwd, "src/windows-app-info.rc");
  const ico = resolve(cfg.cwd, "src/bun.ico");
  const rcIn = readFileSync(rcTemplate, "utf8");
  const [major = "0", minor = "0", patch = "0"] = cfg.version.split(".");
  const versionWithTag = cfg.canary ? `${cfg.version}-canary.${cfg.canaryRevision}` : cfg.version;
  // slash(): rc parses .rc as C-like source; backslashes in the ICON path
  // string would need escaping. Forward slashes work for Windows file APIs.
  const rcOut = rcIn
    .replace(/@Bun_VERSION_MAJOR@/g, major)
    .replace(/@Bun_VERSION_MINOR@/g, minor)
    .replace(/@Bun_VERSION_PATCH@/g, patch)
    .replace(/@Bun_VERSION_WITH_TAG@/g, versionWithTag)
    .replace(/@BUN_ICO_PATH@/g, slash(ico));
  const rcFile = resolve(cfg.buildDir, "windows-app-info.rc");
  writeIfChanged(rcFile, rcOut);

  // ─── Compile .rc → .res (ninja time) ───
  // llvm-rc: /FO sets output. `#include "windows.h"` in the .rc resolves
  // via the INCLUDE env var set by the VS dev shell (vs-shell.ps1).
  const resFile = resolve(cfg.buildDir, "windows-app-info.res");
  n.rule("rc", {
    command: `${quote(cfg.rc, true)} /FO $out $in`,
    description: "rc $out",
  });
  n.build({
    outputs: [resFile],
    rule: "rc",
    inputs: [rcFile],
    // .ico is embedded by rc at compile time — rebuild if it changes.
    // The template is NOT tracked here: it's substituted at configure
    // time, so template edits need a reconfigure (happens rarely).
    implicitInputs: [ico],
  });

  return resFile;
}

/**
 * Linker flags to embed bun.exe.manifest into the executable.
 * The manifest enables longPathAware (paths > MAX_PATH) and SegmentHeap
 * (Windows 10+ low-fragmentation heap).
 */
function manifestLinkFlags(cfg: Config): string[] {
  if (!cfg.windows) return [];
  const manifest = resolve(cfg.cwd, "src/bun.exe.manifest");
  return [`/MANIFEST:EMBED`, `/MANIFESTINPUT:${manifest}`];
}

/**
 * Files the linker reads via ldflags that ninja should track for relinking
 * (symbol lists, linker script, manifest). CMake's LINK_DEPENDS equivalent.
 */
function linkImplicitInputs(cfg: Config): string[] {
  const files = linkDepends(cfg);
  if (cfg.windows) files.push(resolve(cfg.cwd, "src/bun.exe.manifest"));
  return files;
}

// ───────────────────────────────────────────────────────────────────────────
// Pre-flight checks
// ───────────────────────────────────────────────────────────────────────────

/**
 * Validate config before emitting. Catches obvious problems at configure
 * time instead of cryptic build failures later.
 */
export function validateBunConfig(cfg: Config): void {
  // All modes now implemented. Kept as a hook for future validation
  // (e.g. incompatible option combos).
  void cfg;
}

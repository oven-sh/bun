/**
 * The bun executable target — orchestrates everything.
 *
 * This is where all the phases come together:
 *   - resolve all deps → lib paths + include dirs
 *   - emit codegen → generated .cpp/.h/.rs
 *   - emit cargo build → libbun_rust.a
 *   - build PCH from root-pch.h (implicit deps: WebKit libs + all codegen)
 *   - compile all C/C++ with the PCH
 *   - link everything → bun-debug (or bun-profile, bun-asan, etc.)
 *   - smoke test: run `<exe> --revision` to catch load-time failures
 *
 * ## Build modes
 *
 * `cfg.mode` controls what we actually produce:
 *   - "full": everything (default, local dev)
 *   - "cpp-only": compile to libbun.a, skip rust/link (CI upstream)
 *   - "rust-only": codegen + cargo → libbun_rust.a (CI upstream)
 *   - "link-only": link pre-built artifacts (CI downstream)
 *
 * cpp-only/rust-only/link-only are for the CI split where C++ and Rust
 * build in parallel on separate machines then meet for linking.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { Sources } from "../glob-sources.ts";
import { emitCodegen, type CodegenOutputs } from "./codegen.ts";
import { ar, cc, cxx, link, pch } from "./compile.ts";
import { bunExeName, shouldStrip, type Config } from "./config.ts";
import { generateDepVersionsHeader } from "./depVersionsHeader.ts";
import { allDeps } from "./deps/index.ts";
import { lolhtml } from "./deps/lolhtml.ts";
import { assert } from "./error.ts";
import { bunIncludes, computeFlags, extraFlagsFor, linkDepends } from "./flags.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { emitRust, linkerMapPath, rustLibPath } from "./rust.ts";
import { quote, slash } from "./shell.ts";
import { emitShims } from "./shims.ts";
import { computeDepLibs, resolveDep, type ResolvedDep } from "./source.ts";
import { streamPath } from "./stream.ts";
import { generateUnifiedSources } from "./unified.ts";

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
    if (cfg.abi === "android") {
      // bionic: pthread/dl/rt are folded into libc; no separate libatomic
      // (compiler-rt builtins). -llog for __android_log_*.
      libs.push("-lc", "-lm", "-llog");
    } else {
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
    }
    // Linux local WebKit: link system ICU (prebuilt bundles its own).
    // Assumes system ICU is in default lib paths — true on most distros.
    // Android: no system ICU; the local WebKit build must bundle it.
    if (cfg.webkit === "local" && cfg.abi !== "android") {
      libs.push("-licudata", "-licui18n", "-licuuc");
    }
  }

  if (cfg.darwin) {
    // icucore: system ICU framework.
    // resolv: DNS resolution (getaddrinfo et al).
    libs.push("-licucore", "-lresolv");
  }

  if (cfg.freebsd) {
    // pthread/m: explicit on FreeBSD (not folded into libc).
    // execinfo: backtrace() — separate library on FreeBSD.
    // kvm/procstat/elf/util: process introspection for node:os and crash handler.
    libs.push("-lc", "-lpthread", "-lm", "-lexecinfo", "-lkvm", "-lprocstat", "-lelf", "-lutil");
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
 *   full:      exe, strippedExe?, dsym?, rustObjects, objects, deps, codegen
 *   cpp-only:  archive, objects, deps, codegen
 *   rust-only: rustObjects, deps (lolhtml), codegen
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
  /** The Rust staticlib path(s). Empty in cpp-only. */
  rustObjects: string[];
  /** All compiled .o files. Empty in link-only/rust-only. */
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
  if (cfg.mode === "rust-only") {
    return emitRustOnly(n, cfg, sources);
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
  const depsByName = new Map<string, ResolvedDep>();
  for (const dep of allDeps) {
    const resolved = resolveDep(n, cfg, dep, depsByName);
    if (resolved !== null) {
      deps.push(resolved);
      depsByName.set(dep.name, resolved);
    }
  }

  // Collect all dep lib paths, include dirs, output stamps, and directly-
  // compiled source files (deps like picohttpparser that provide .c files
  // instead of a .a — we compile those alongside bun's own sources).
  const depLibs: string[] = [];
  const depObjects: string[] = [];
  const depIncludes: string[] = [];
  // Outputs of deps that provide headers — used as implicit inputs on PCH/cc/
  // no-PCH cxx so a dep rebuild invalidates compiles that #include its headers
  // (the .a is the signal — see comment at the PCH step). Deps with no provided
  // includes (tinycc, lolhtml) are skipped: nothing to invalidate, and a tinycc
  // no-op rebuild (ar has no restat) would otherwise cascade to a full PCH+cxx
  // rebuild. Link still gets every dep via depLibs/depObjects.
  const depHeaderSignal: string[] = [];
  for (const d of deps) {
    depLibs.push(...d.libs);
    depObjects.push(...d.objects);
    depIncludes.push(...d.includes);
    // d.outputs is the "headers are ready" signal: for nested-cmake/
    // prebuilt that's the .a/stamp (headers are undeclared side-effects),
    // for direct deps it's the generated-header set + source stamp.
    if (d.includes.length > 0) depHeaderSignal.push(...d.outputs);
  }

  // ─── Step 2: codegen ───
  const codegen = emitCodegen(n, cfg, sources);

  // ─── Step 3: rust ───
  // One cargo invocation produces a single staticlib that occupies the
  // same slot in the link as the C++ archive. Rust `include!`s codegen
  // `.rs` outputs (written as side effects of the generate-classes /
  // bundle-modules / generate-jssink edges), so the codegen output set
  // is forwarded as implicit inputs to order it first.
  //
  // cpp-only: skip rust entirely (runs on a separate CI machine).
  let rustObjects: string[] = [];
  if (cfg.mode !== "cpp-only") {
    rustObjects = emitRust(n, cfg, {
      codegenInputs: codegen.rustInputs,
      codegenOrderOnly: codegen.rustOrderOnly,
      rustSources: sources.rust,
      // lol-html is consumed as a path dep of `bun_lolhtml_sys`, not built
      // into a separate archive — cargo needs `vendor/lolhtml/` on disk
      // before it resolves the manifest. The `.ref` stamp's content is the
      // pinned commit, so a bump re-invokes cargo.
      vendorStamps: depsByName.get("lolhtml")?.outputs ?? [],
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
  const usePch = !cfg.ci || cfg.mode === "cpp-only";
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
    // and inputs don't change mid-build. cppAll (not all) — bake/.rs outputs
    // are rust-only; pulling them here would run bake-codegen in cpp-only CI
    // mode where it fails on the pinned bun version (see cppAll docstring).
    // Scripts that emit undeclared .h also emit a .cpp/.h in cppAll, so they
    // still run. cxx transitively waits: cxx → PCH → deps+cppAll.
    pchOut = pch(n, cfg, "src/jsc/bindings/root-pch.h", {
      flags: cxxFlagsFull,
      implicitInputs: depHeaderSignal,
      orderOnlyInputs: codegen.cppAll,
    });
  }

  // ─── Step 6: compile C/C++ ───
  n.comment("─── C/C++ compilation ───");
  n.blank();

  // Source lists: from the pre-globbed snapshot + platform extras.
  // Unified sources: bundle the globbed .cpp into N-per-TU wrappers (see
  // unified.ts for N). Generated at configure time; depfiles track the underlying
  // .cpp files so editing one rebuilds its bundle. Codegen .cpp are kept
  // separate — those are already large single TUs (ZigGeneratedClasses.cpp
  // is 3.3 MB) and bundling them would serialize work. Always called so
  // stale bundles are pruned even with --unifiedSources=false.
  const split = generateUnifiedSources(cfg, sources.cxx);
  const cxxSources = [...split.unified, ...split.standalone];
  const cSources = [...sources.c];

  // Sources that must NOT use the PCH. Anything that needs to set defines
  // before <Windows.h> (UNICODE, WIN32_LEAN_AND_MEAN opt-outs, etc.) goes
  // here — root-pch.h transitively includes Windows.h via WTF, so the
  // force-include would lock those in before the source can speak.
  const noPchSources = new Set<string>();

  // Windows-only cpp sources (rescle — PE resource editor for --compile).
  if (cfg.windows) {
    // rescle.h does `#define UNICODE` before including ATL; with PCH the
    // headers are already past in MBCS mode and ATL's TCHAR mismatches.
    const rescle = resolve(cfg.cwd, "src/jsc/bindings/windows/rescle.cpp");
    const rescleBinding = resolve(cfg.cwd, "src/jsc/bindings/windows/rescle-binding.cpp");
    cxxSources.push(rescle, rescleBinding);
    noPchSources.add(rescle);
    noPchSources.add(rescleBinding);
  }

  // Deps with provides.sources compiled in the loop below so each dep's
  // phony can point at its own .o files.

  // Codegen .cpp files — compiled like regular sources.
  cxxSources.push(...codegen.cppSources);
  cxxSources.push(...codegen.bindgenV2Cpp);

  // All deps must be ready (headers extracted, libs built) before compile.
  //
  // depHeaderSignal are IMPLICIT inputs, not order-only. A locally-built dep's
  // sub-build (e.g. WebKit) rewrites forwarding headers as an undeclared side
  // effect of the edge whose declared outputs are only lib*.a. Depfiles record
  // those headers, but ninja stats them BEFORE the sub-build runs — so with
  // order-only, any compile that #includes a dep header lags one build behind
  // a dep rebuild (observed: uv-posix-*.c → wtf/Compiler.h).
  // Implicit deps on the libs make "dep rebuilt" itself the invalidation
  // signal. Cost is negligible: if the libs changed you're relinking anyway.
  //
  // codegen.cppAll stays order-only: those headers ARE declared ninja outputs
  // with restat, so depfile tracking is exact and doesn't lag.
  //
  // PCH also has implicit deps on depHeaderSignal (see above). When PCH is enabled,
  // cxx inherits the dep transitively via its implicit dep on the PCH, so we
  // don't add it again.
  const codegenOrderOnly = codegen.cppAll;

  // Compile all .cpp with PCH.
  // Emit compile_commands.json entries for the ORIGINAL bundled .cpp files
  // too — clangd looks up flags by the file you opened, and a bundled source
  // has no ninja edge of its own. Same flags as the bundle (no PCH listed —
  // clangd parses standalone, and the PCH path is build-internal).
  for (const src of split.bundled) {
    n.addCompileCommand({
      directory: cfg.buildDir,
      file: src,
      arguments: [cfg.cxx, ...cxxFlagsFull, "-c", src],
    });
  }

  const cxxObjects: string[] = [];
  for (const src of cxxSources) {
    const relSrc = relative(cfg.cwd, src);
    const extraFlags = extraFlagsFor(cfg, relSrc);
    const opts: Parameters<typeof cxx>[3] = {
      flags: [...cxxFlagsFull, ...extraFlags],
    };
    if (pchOut !== undefined && !noPchSources.has(src)) {
      // PCH has implicit deps on depHeaderSignal. cxx has implicit dep on PCH.
      // Transitively: cxx waits for deps. No need to repeat them here.
      opts.pch = pchOut.pch;
      opts.pchHeader = pchOut.wrapperHeader;
    } else {
      // No PCH (CI full mode, or per-file opt-out) — each cxx needs the dep
      // signal directly.
      opts.implicitInputs = depHeaderSignal;
      opts.orderOnlyInputs = codegenOrderOnly;
    }
    cxxObjects.push(cxx(n, cfg, src, opts));
  }

  // Compile all .c files. No PCH — dep signal applied directly.
  const cObjects: string[] = [];
  const compileC = (src: string): string => {
    const obj = cc(n, cfg, src, {
      flags: cFlagsFull,
      implicitInputs: depHeaderSignal,
      orderOnlyInputs: codegenOrderOnly,
    });
    cObjects.push(obj);
    return obj;
  };
  for (const src of cSources) compileC(src);

  // Deps that contribute source files for bun to compile directly (via
  // provides.sources) instead of building a lib. Compile them here with
  // bun's full flag set and give each a phony so `--target <name>` builds
  // its .o files. libs.length === 0 guard: deps with a build step already
  // got a phony in resolveDep — don't emit a duplicate.
  for (const d of deps) {
    if (d.sources.length === 0 || d.libs.length > 0) continue;
    n.phony(d.name, d.sources.map(compileC));
  }

  // Dep objects (when !cfg.archiveDeps) are linked alongside bun's own
  // objects — same response file, same archive in cpp-only mode. With
  // cfg.archiveDeps they live in depLibs as .a files instead.
  const allObjects = [...cxxObjects, ...cObjects, ...depObjects];

  // ─── Step 7: cpp-only → archive and return ───
  // CI's build-cpp step: archive all .o into libbun.a, stop. The sibling
  // build-rust step produces libbun_rust.a independently; build-bun
  // downloads both artifacts and links them. Archive name uses the exe
  // name (not just "libbun") so asan/debug variants are distinguishable.
  if (cfg.mode === "cpp-only") {
    n.comment("─── Archive (cpp-only) ───");
    n.blank();
    const archiveName = `${cfg.libPrefix}${exeName}${cfg.libSuffix}`;
    const archive = ar(n, cfg, archiveName, allObjects);

    // Upload dep libs as soon as they're built — they're ready ~minutes
    // before the archive (WebKit copies from prefetch in seconds; lolhtml
    // builds in ~30s), so the upload overlaps the cxx compile instead of
    // waiting for it. Own pool so it doesn't take a compile slot. ci.ts's
    // uploadArtifacts() then only handles the archive.
    let depUploadStamp: string | undefined;
    if (cfg.buildkite && depLibs.length > 0) {
      n.pool("bk_upload", 1);
      n.rule("bk_upload", {
        // Paths relative to buildDir (ninja's cwd) so artifact names match
        // what link-only's downloadArtifacts() expects. ; is the agent's
        // default delimiter — quoted so the host shell doesn't split it.
        // Stamp written only after the agent exits 0 so a failed upload
        // re-runs on the next ninja invocation.
        command:
          cfg.host.os === "windows"
            ? `cmd /c buildkite-agent artifact upload "$paths" && type nul > $out`
            : `buildkite-agent artifact upload '$paths' && touch $out`,
        description: "buildkite upload dep libs",
        pool: "bk_upload",
      });
      depUploadStamp = resolve(cfg.buildDir, ".dep-libs-uploaded");
      n.build({
        outputs: [depUploadStamp],
        rule: "bk_upload",
        inputs: depLibs,
        vars: { paths: depLibs.map(p => relative(cfg.buildDir, p)).join(";") },
      });
    }

    // depLibs explicit in the phony: deps with no provided includes (tinycc,
    // lolhtml) aren't in depHeaderSignal, so the archive doesn't pull them
    // transitively — but link-only still needs them uploaded.
    n.phony("bun", [archive, ...depLibs, ...(depUploadStamp ? [depUploadStamp] : [])]);
    n.default(["bun"]);
    return { archive, deps, codegen, rustObjects, objects: allObjects };
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
  // The Rust staticlib goes into `$in` between bun's own objects and the
  // dependency archives so symbol resolution order is preserved: C++
  // objects create the `Bun__*` undefined refs, the Rust archive satisfies
  // them (and `main`, via crt1.o) and in turn references JSC/WTF, depLibs
  // satisfies those. Every `#[no_mangle]` export the C++ side touches is
  // reached transitively from those roots, so no `--whole-archive` wrapping
  // is needed; if a member ever isn't, `rustLinkFlags()` in rust.ts is the
  // wrapping helper.
  const shims = emitShims(n, cfg);
  const linkObjects = [...allObjects, ...rustObjects, ...windowsRes];
  const ldflags = [...flags.ldflags, ...systemLibs(cfg), ...manifestLinkFlags(cfg), ...shims.ldflags];
  const exe = link(n, cfg, exeName, linkObjects, {
    libs: depLibs,
    flags: ldflags,
    implicitInputs: [...linkImplicitInputs(cfg), ...shims.implicitInputs],
    // Declare the `-Wl,-Map=` side-product so `perf` symbolication picks it
    // up. Linux release only — the map flag itself is gated identically in
    // flags.ts.
    linkerMapOutput: cfg.linux && cfg.release && !cfg.asan && !cfg.valgrind ? linkerMapPath(cfg) : undefined,
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

  return { exe, strippedExe, dsym, deps, codegen, rustObjects, objects: allObjects };
}

/**
 * rust-only mode: emit just the cargo build graph. CI's build-rust step
 * uses this to compile libbun_rust.a in parallel with build-cpp; target
 * set via --os/--arch overrides (cargo `--target <triple>`).
 *
 * Needs:
 *   - lolhtml FETCHED (path dep of `bun_lolhtml_sys`) — not built separately
 *   - codegen (Rust `include!`s/`include_bytes!`s the same generated set)
 *   - cargo build → libbun_rust.a
 *
 * Does NOT need: any C dep built, any cxx, PCH, link. ninja only pulls
 * what's depended on — lolhtml's configure/build rules are emitted but
 * unused (only its `.ref` fetch stamp is depended on by emitRust).
 *
 * Cross-compilation: see `rustCanCrossFromLinux()` in rust.ts for which
 * targets share a linux runner vs need a native agent.
 */
function emitRustOnly(n: Ninja, cfg: Config, sources: Sources): BunOutput {
  n.comment("════════════════════════════════════════════════════════════════");
  n.comment(`  Building libbun_rust.a (rust-only, target: ${cfg.os}-${cfg.arch})`);
  n.comment("════════════════════════════════════════════════════════════════");
  n.blank();

  // Only dep: lolhtml, fetched as a cargo path dependency. resolveDep
  // emits its fetch; emitRust depends on the fetch stamp via vendorStamps.
  const lolhtmlDep = resolveDep(n, cfg, lolhtml, new Map());
  assert(lolhtmlDep !== null, "lolhtml resolveDep returned null — should never be skipped");

  // Codegen: emitted fully, but only the embed-input subset is pulled.
  // The cpp-related outputs (cppSources, bindgenV2Cpp) have no consumer
  // in this graph — ninja skips them.
  const codegen = emitCodegen(n, cfg, sources);

  const rustObjects = emitRust(n, cfg, {
    codegenInputs: codegen.rustInputs,
    codegenOrderOnly: codegen.rustOrderOnly,
    rustSources: sources.rust,
    vendorStamps: lolhtmlDep.outputs,
  });

  n.phony("bun", rustObjects);
  n.default(["bun"]);

  return { deps: [lolhtmlDep], codegen, rustObjects, objects: [] };
}

/**
 * link-only mode: link artifacts downloaded from sibling buildkite steps.
 * CI's build-bun step. Build.ts downloads into buildDir BEFORE ninja runs;
 * ninja sees the files as source inputs (no build rule — errors cleanly
 * if download failed or paths drift).
 *
 * Expected artifacts (same paths cpp-only/rust-only produced):
 *   - libbun-profile.a            — from cpp-only's ar()
 *   - libbun_rust.a / bun_rust.lib — from rust-only's cargo (rustLibPath)
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

  // libbun_rust.a from rust-only: same path emitRust writes to. Shared
  // helper so both sides of the CI split agree (cargo's
  // `<target-dir>/<triple>/<profile>/` layout).
  const rustObjects = [rustLibPath(cfg)];

  // Only need ldflags + stripflags (no cflags/cxxflags — no compile).
  const flags = computeFlags(cfg);

  n.comment("─── Link ───");
  n.blank();

  // Windows resources: compiled here, not downloaded from cpp-only.
  // .res is small; .rc substitution depends on cfg.version which link-only
  // knows. Matches cmake's BUN_LINK_ONLY adding WINDOWS_RESOURCES directly.
  const windowsRes = cfg.windows ? [emitWindowsResources(n, cfg)] : [];

  const shims = emitShims(n, cfg);
  const linkObjects = [archive, ...rustObjects, ...windowsRes];
  const ldflags = [...flags.ldflags, ...systemLibs(cfg), ...manifestLinkFlags(cfg), ...shims.ldflags];
  const exe = link(n, cfg, exeName, linkObjects, {
    libs: depLibs,
    flags: ldflags,
    implicitInputs: [...linkImplicitInputs(cfg), ...shims.implicitInputs],
    linkerMapOutput: cfg.linux && cfg.release && !cfg.asan && !cfg.valgrind ? linkerMapPath(cfg) : undefined,
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
    rustObjects,
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
  // Cross-compiled binaries can't run on the build host. Skip the smoke
  // test entirely — `ninja check` becomes a no-op alias for the exe.
  if (cfg.crossTarget !== undefined) {
    n.phony("check", [exe]);
    return;
  }
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
  const wrap = `${cfg.jsRuntime} ${q(streamPath)} check --console`;
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
  const wrap = `${cfg.jsRuntime} ${q(streamPath)} dsym --console`;
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
  // build.ninja encodes both absolute -I/-D paths derived from cfg.cwd and
  // buildDir-relative source paths (../../src/...). If buildDir is reached
  // through a symlink that escapes this checkout — e.g. a sibling worktree
  // symlinking its build/ at ours to "share" artifacts — a configure from
  // that worktree overwrites our build.ninja with its own absolute paths
  // while the relative ones still resolve against whichever cwd ninja is
  // launched from. The result is the same header included via two distinct
  // realpaths, defeating #pragma once and producing redefinition errors (or
  // PCH macro mismatches) the next time the rightful owner builds. Refuse
  // up front so the misconfigured worktree fails loudly instead of poisoning
  // a neighbour. An explicit --build-dir pointing outside the repo is still
  // permitted; only a symlink masquerading as a path under cwd is rejected.
  if (existsSync(cfg.buildDir)) {
    const realCwd = realpathSync(cfg.cwd);
    const realBuild = realpathSync(cfg.buildDir);
    const rel = relative(realCwd, realBuild);
    const escapes = rel.startsWith("..") || rel === "";
    const claimedRel = relative(cfg.cwd, cfg.buildDir);
    const claimsInside = !claimedRel.startsWith("..") && claimedRel !== "";
    assert(
      !(claimsInside && escapes),
      `buildDir '${cfg.buildDir}' resolves to '${realBuild}', outside the source tree '${realCwd}'.\n` +
        `A symlinked build/ shared between worktrees corrupts build.ninja for both. ` +
        `Remove the symlink and let this worktree own its build directory ` +
        `(ccache already shares object files across checkouts).`,
    );
  }
  // Also reject the common shape directly: <cwd>/build as a symlink. This
  // catches the race before the first configure ever creates buildDir.
  const buildParent = resolve(cfg.cwd, "build");
  if (cfg.buildDir.startsWith(buildParent + sep) && existsSync(buildParent)) {
    assert(
      !lstatSync(buildParent).isSymbolicLink(),
      `'${buildParent}' is a symlink (→ ${realpathSync(buildParent)}). ` +
        `Sharing build/ between worktrees corrupts build.ninja for both — ` +
        `remove the symlink; ccache already shares compiled objects.`,
    );
  }

  // Cross-language LTO needs an lld at least as new as the LLVM that emitted
  // the rust bitcode. `resolveConfig()` swaps `cfg.ld` to `cfg.rustLld` when
  // rustc's LLVM is newer than clang's; if `rustLld` couldn't be discovered
  // (rustc/rustup missing, pinned toolchain not installed, agent provisioned
  // without it), the build would proceed with the stale lld and fail at link
  // time with an opaque `error: ... .rcgu.o: Invalid record`. Fail at
  // configure time instead with a hint that points at the real problem.
  if (
    cfg.crossLangLto &&
    cfg.rustToolchain !== undefined &&
    cfg.rustLlvmVersion !== undefined &&
    cfg.clangVersion !== undefined
  ) {
    const rustMajor = Number.parseInt(cfg.rustLlvmVersion.split(".")[0] ?? "", 10);
    const clangMajor = Number.parseInt(cfg.clangVersion.split(".")[0] ?? "", 10);
    if (Number.isFinite(rustMajor) && Number.isFinite(clangMajor) && rustMajor > clangMajor) {
      assert(
        cfg.ld === cfg.rustLld,
        `Cross-language LTO is on and rustc's LLVM (${cfg.rustLlvmVersion}) is newer than clang's ` +
          `(${cfg.clangVersion}), but rustc's bundled lld wasn't found — the link would fail with ` +
          `"Invalid record" reading libbun_rust.a's bitcode. Install the pinned toolchain on this ` +
          `host (\`rustup toolchain install ${cfg.rustToolchain}\`), upgrade clang/lld to LLVM ` +
          `${rustMajor}+, or disable LTO with \`--lto=off\`.`,
      );
    }
  }
}

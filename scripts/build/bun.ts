/**
 * The bun executable target — orchestrates everything.
 *
 * This is where all the phases come together:
 *   - emit codegen → generated .cpp/.h/.rs
 *   - emit the Rust crate graph → libbun_runtime.a
 *   - resolve all deps → lib paths + include dirs
 *   - build PCH from root-pch.h (implicit deps: WebKit libs + all codegen)
 *   - compile all C/C++ with the PCH
 *   - link everything → bun-debug (or bun-profile, bun-asan, etc.)
 *   - smoke test: run `<exe> --revision` to catch load-time failures
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Sources } from "../glob-sources.ts";
import { binaryExpectations, exportList, shimExpectations } from "./binary-expectations.ts";
import { emitCodegen, type CodegenOutputs } from "./codegen.ts";
import { cc, cxx, link, pch } from "./compile.ts";
import { bunExeName, shouldStrip, type Config } from "./config.ts";
import { generateDepVersionsHeader } from "./depVersionsHeader.ts";
import { allDeps } from "./deps/index.ts";
import { lolhtml } from "./deps/lolhtml.ts";
import { rustArgon2 } from "./deps/rust-argon2.ts";
import { assert } from "./error.ts";
import {
  bunIncludes,
  computeFlags,
  exportListPath,
  extraFlagsFor,
  linkDepends,
  linkerMapOutputs,
  versionScriptPath,
} from "./flags.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { emitRust, windowsShimPath } from "./rust.ts";
import { quote, slash } from "./shell.ts";
import { emitShims, machoPostlinkCommand, machoPostlinkImplicitInputs } from "./shims.ts";
import { resolveDep, type Dependency, type DepName, type ResolvedDep } from "./source.ts";
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
    // kvm/procstat/elf: process introspection for node:os and crash handler.
    // libutil (openpty) is linked statically: its soname bumped .so.9 → .so.10
    // between 14.x and 15.0, so a dynamic NEEDED entry from the 14.3 sysroot
    // fails to load on 15.x (#40530). Every other lib here kept its soname.
    libs.push("-lc", "-lpthread", "-lm", "-lexecinfo", "-lkvm", "-lprocstat", "-lelf", "-l:libutil.a");
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
 */
export interface BunOutput {
  /** Linked executable (bun-debug, bun-profile). */
  exe: string;
  /** Stripped `bun`. Plain release. */
  strippedExe?: string | undefined;
  /** .dSYM bundle (darwin plain release). Added to default targets so ninja builds it. */
  dsym?: string | undefined;
  /** All resolved deps (full libs list). */
  deps: ResolvedDep[];
  /** All codegen outputs. */
  codegen: CodegenOutputs;
  /** All compiled .o files. */
  objects: string[];
}

/**
 * Emit the full bun build graph. Returns the output executable path.
 *
 * Call after `registerAllRules(n, cfg)`. `sources` is the globbed file
 * snapshot from `globAllSources()` — passed in so globbing happens once.
 */
export function emitBun(n: Ninja, cfg: Config, sources: Sources): BunOutput {
  const exeName = bunExeName(cfg);

  n.comment("════════════════════════════════════════════════════════════════");
  n.comment(`  Building ${exeName}`);
  n.comment("════════════════════════════════════════════════════════════════");
  n.blank();

  // ─── Step 1: codegen + rust ───
  // Emitted before the deps: ninja breaks scheduling ties by emission order, and the Rust crate chain is the critical path (see the compile pool in compile.ts).
  const codegen = emitCodegen(n, cfg, sources);
  const depsByName = new Map<DepName, ResolvedDep>();

  // Each Rust crate produces an rlib the link takes beside the C/C++
  // objects. Rust `include!`s codegen
  // `.rs` outputs (written as side effects of the generate-classes /
  // bundle-modules / generate-jssink edges), so the codegen output set
  // is forwarded to order the workspace crates after it (order-only; the
  // crates' dep-info then tracks exactly the files they read).
  // lol-html is a direct path dep of `bun_runtime`/`bun_bundler`
  // (`lol_html = { path = "vendor/lolhtml" }` in the workspace Cargo.toml),
  // not built into a separate archive — cargo needs `vendor/lolhtml/` on
  // disk before it can plan the crate graph. The `.ref` stamp's content is
  // the pinned commit, so a bump re-plans.
  const lolhtmlDep = resolveDep(n, cfg, lolhtml, depsByName);
  assert(lolhtmlDep !== null, "lolhtml resolveDep returned null — should never be skipped");
  depsByName.set(lolhtml.name, lolhtmlDep);
  const rustArgon2Dep = resolveDep(n, cfg, rustArgon2, depsByName);
  assert(rustArgon2Dep !== null, "rust-argon2 resolveDep returned null — should never be skipped");
  depsByName.set(rustArgon2.name, rustArgon2Dep);
  const rustObjects = emitRust(n, cfg, {
    codegenOrderOnly: codegen.rustInputs,
    rustSources: sources.rust,
    vendorStamps: [...lolhtmlDep.outputs, ...rustArgon2Dep.outputs],
    shimValidations: emitShimVerify(n, cfg),
  });

  // ─── Step 2: resolve all deps ───
  n.comment("─── Dependencies ───");
  n.blank();
  const deps: ResolvedDep[] = [];
  for (const dep of allDeps) {
    const resolved = depsByName.get(dep.name) ?? resolveDep(n, cfg, dep, depsByName);
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
  const depDefines: string[] = [];
  // Outputs of deps that provide headers — used as implicit inputs on PCH/cc/
  // no-PCH cxx so a dep rebuild invalidates compiles that #include its headers
  // (the .a is the signal — see comment at the PCH step). Deps with no provided
  // includes (tinycc, lolhtml) are skipped: nothing to invalidate, and a tinycc
  // no-op rebuild (ar has no restat) would otherwise cascade to a full PCH+cxx
  // rebuild. Link still gets every dep via depLibs/depObjects.
  const depHeaderSignal: string[] = [];
  // forbidUndefined stamps (source.ts): validations of whatever the dep
  // objects go into next, the archive or the link — a dep that regrows a
  // forbidden reference fails that build without delaying the link.
  const depChecks: string[] = [];
  for (const d of deps) {
    depLibs.push(...d.libs);
    depObjects.push(...d.objects);
    depChecks.push(...d.checks);
    depIncludes.push(...d.includes);
    depDefines.push(...d.defines);
    // d.outputs is the "headers are ready" signal: for nested-cmake/
    // prebuilt that's the .a/stamp (headers are undeclared side-effects),
    // for direct deps it's the generated-header set + source stamp.
    if (d.includes.length > 0) depHeaderSignal.push(...d.outputs);
  }

  // ─── Step 3: configure-time generated header + assemble flags ───
  // bun_dependency_versions.h — written at configure time, not a ninja rule.
  // BunProcess.cpp includes it for process.versions. writeIfNotChanged
  // semantics so bumping an unrelated dep doesn't recompile everything.
  generateDepVersionsHeader(cfg);

  const flags = computeFlags(cfg);

  // Full include / define set: bun's own + what deps provide + buildDir (for
  // the generated versions header).
  const allIncludes = [...bunIncludes(cfg), cfg.buildDir, ...depIncludes];
  const includeFlags = allIncludes.map(inc => `-I${inc}`);
  const defineFlags = [...flags.defines, ...depDefines].map(d => `-D${d}`);

  // Final flag arrays for compile.
  const cxxFlagsFull = [...flags.cxxflags, ...includeFlags, ...defineFlags];
  const cFlagsFull = [...flags.cflags, ...includeFlags, ...defineFlags];

  // The codegen outputs compiles wait for, behind one phony so each compile
  // edge names one order-only input instead of repeating the list (the ninja
  // idiom: order-only inputs never dirty an edge; depfiles track the reads).
  const codegenReady = resolve(cfg.buildDir, "obj", ".codegen-ready");
  n.phony(codegenReady, codegen.cppAll);

  // ─── Step 4: PCH ───
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
  // and inputs don't change mid-build. cppAll (not all): what the C++ side
  // reads. Scripts that emit undeclared .h also emit a .cpp/.h in cppAll, so
  // they still run. cxx transitively waits: cxx → PCH → deps+cppAll.
  const pchOut = pch(n, cfg, "src/jsc/bindings/root-pch.h", {
    flags: cxxFlagsFull,
    implicitInputs: depHeaderSignal,
    orderOnlyInputs: [codegenReady],
  });

  // ─── Step 5: compile C/C++ ───
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

  // highway_json.cpp is compiled -O2 even in debug profiles (see its
  // fileOverrides entry in flags.ts); a TU at a different -O level than the
  // PCH cannot use the PCH ("__OPTIMIZE__ ... was disabled in precompiled
  // file"). It only includes highway + libc headers anyway.
  if (cfg.debug) {
    noPchSources.add(resolve(cfg.cwd, "src/jsc/bindings/highway_json.cpp"));
    noPchSources.add(resolve(cfg.cwd, "src/jsc/bindings/highway_xml.cpp"));
  }

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
  const codegenOrderOnly = [codegenReady];

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
    if (!noPchSources.has(src)) {
      // PCH has implicit deps on depHeaderSignal. cxx has implicit dep on PCH.
      // Transitively: cxx waits for deps. No need to repeat them here.
      opts.pch = pchOut.pch;
      opts.pchHeader = pchOut.wrapperHeader;
    } else {
      // Per-file PCH opt-out — this cxx needs the dep signal directly.
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

  // InternalModuleRegistryConstants.S — `.incbin`s the bundled JS module sources
  // so InternalModuleRegistry.cpp sees a tiny {offset, length} table instead of
  // megabytes of byte-array initializers. The `.bin` payload is an implicit
  // input: `.incbin` is opaque to depfiles, and the `.S` itself rarely changes.
  // cFlagsFull carries --target/--sysroot/-march so a cross-compile's
  // preprocessor picks the right __APPLE__/_WIN32 branch and object format.
  cObjects.push(
    cc(n, cfg, codegen.internalModulesAsm, {
      flags: cFlagsFull,
      implicitInputs: [codegen.internalModulesBin],
    }),
  );

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
  // objects, in the same response file. With cfg.archiveDeps they live in
  // depLibs as .a files instead.
  const allObjects = [...cxxObjects, ...cObjects, ...depObjects];

  // ─── Step 6: link ───
  n.comment("─── Link ───");
  n.blank();

  // Windows resources (.rc → .res): icon, VersionInfo. A link input of its
  // own, never archived: .res is small and the .rc depends on cfg.version.
  const windowsRes = cfg.windows ? [emitWindowsResources(n, cfg)] : [];

  // The Rust crates' rlibs go into `$in` between bun's own objects and the
  // dependency archives. An rlib is an archive: a member is linked when
  // something needs a symbol it defines. C++ objects create the `Bun__*`
  // undefined refs, the rlibs satisfy them (and `main`, via crt1.o) and in
  // turn reference JSC/WTF, depLibs satisfies those. Every `#[no_mangle]`
  // export the C++ side touches is reached from those roots.
  const shims = emitShims(n, cfg);
  const depLink = lazyDepObjects(cfg, depObjects);
  const linkObjects = [...cxxObjects, ...cObjects, ...depLink.eager, ...rustObjects, ...windowsRes];
  const ldflags = [...flags.ldflags, ...systemLibs(cfg), ...shims.ldflags];
  const exe = link(n, cfg, exeName, linkObjects, {
    libs: depLibs,
    lazyObjects: depLink.lazy,
    flags: ldflags,
    implicitInputs: [...linkImplicitInputs(cfg), ...shims.implicitInputs],
    // Declare the maps the release link writes as side-products (`perf`
    // symbolication on linux; the order file tracer's symbol table on windows).
    linkerMapOutputs: linkerMapOutputs(cfg),
    // Static scans: the deps' forbidden-symbol checks on the objects going
    // in, the smoke test on the executable coming out.
    validations: [...depChecks, ...postLinkChecks(cfg, exeName)],
  });

  // ─── Step 7: post-link (strip, dsymutil, smoke test) ───
  const { strippedExe, dsym } = emitPostLink(n, cfg, exe, exeName, flags.stripflags, [
    ...linkObjects,
    ...depLink.lazy,
    ...depLibs,
  ]);

  return { exe, strippedExe, dsym, deps, codegen, objects: allObjects };
}

/**
 * Split the link's dependency objects into the ones passed eagerly and the ones
 * the linker may leave out (LinkOpts.lazyObjects): a dependency is a library,
 * and only the translation units something references belong in bun.
 *
 * On COFF the lazy ones are the assembler-produced objects: their sections are
 * not COMDATs, so /OPT:REF cannot drop them and one nothing calls (BoringSSL's
 * AES-GCM-SIV, unused on Windows by design) would ship whole. Compiled objects
 * stay eager there; /OPT:REF drops their unreferenced COMDATs.
 *
 * Elsewhere every dependency object is lazy. `--gc-sections` / `-dead_strip`
 * would remove the unreferenced code anyway, but only after LTO has seen it:
 * a call from a file nothing uses (spake25519.cc calling
 * x25519_ge_frombytes_vartime) counts as a second caller and stops the helper
 * being inlined into the one that ships.
 */
export function lazyDepObjects(cfg: Config, depObjects: string[]): { eager: string[]; lazy: string[] } {
  if (!cfg.windows) return { eager: [], lazy: depObjects };
  const isAssemblerOutput = (obj: string) => /\.(asm|S)\.obj$/i.test(obj);
  return { eager: depObjects.filter(o => !isAssemblerOutput(o)), lazy: depObjects.filter(isAssemblerOutput) };
}

/**
 * Post-link steps: strip, dsymutil, the `bun` phony, and the `--revision`
 * smoke test.
 *
 * Centralized because the smoke_test and dsymutil edges must be ordered
 * after strip — their rule commands wrap through `cfg.jsRuntime`
 * (process.execPath), which can BE the strip output when `bun` on PATH
 * resolves into the build directory (build/release/bun). Without the
 * ordering, ninja runs strip and the wrapper exec concurrently (both
 * depend only on `exe`) and the wrapper fails with "Permission denied" on
 * the half-written file. Open-coding this in each mode already caused one
 * call site to be missed (#30539), so the invariant lives here.
 */
export function emitPostLink(
  n: Ninja,
  cfg: Config,
  exe: string,
  exeName: string,
  stripflags: string[],
  linkInputs: string[],
): { strippedExe: string | undefined; dsym: string | undefined } {
  // Plain release only: produce stripped `bun` alongside `bun-profile`.
  // Debug/asan/valgrind/assertions keep symbols (you want them for
  // debugging).
  let strippedExe: string | undefined;
  let dsym: string | undefined;
  if (shouldStrip(cfg)) {
    strippedExe = emitStrip(n, cfg, exe, stripflags);
    // darwin: extract debug symbols from the UNSTRIPPED exe into a .dSYM
    // bundle. dsymutil reads DWARF from bun-profile, writes
    // bun-profile.dSYM. The input exe is never stripped in-place (strip
    // writes a new file via -o), so the read is safe.
    if (cfg.darwin) dsym = emitDsymutil(n, cfg, exe, exeName, strippedExe);
  }

  // `bun` phony — only when strip didn't produce a literal file named
  // `bun` (which would collide with the phony). When strip runs, `ninja
  // bun` builds the stripped file; no phony needed.
  if (strippedExe === undefined) n.phony("bun", [exe]);

  // Run `<exe> --revision`. If it exits non-zero or crashes, something
  // broke at load time (missing symbol, static initializer blowup, ABI
  // mismatch). Catching this HERE is much better than "CI passes, user
  // runs bun, it segfaults".
  //
  // Linux+ASAN quirk: some systems need ASLR disabled (`setarch -R`) for
  // ASAN binaries to run from subprocesses (shadow memory layout conflict
  // with ELF_ET_DYN_BASE, see sanitizers/856). We try with setarch first,
  // fall back to direct invocation.
  // The smoke test and the static scans: validations of the link
  // edge (they run whenever the executable is relinked, see postLinkChecks)
  // and, for running them by name, the `check` phony.
  n.phony("check", [
    ...emitSmokeTest(n, cfg, exe, exeName, strippedExe),
    ...emitBinaryVerify(n, cfg, exe, exeName, strippedExe),
    ...emitDuplicateSymbolCheck(n, cfg, exeName, linkInputs, strippedExe),
  ]);

  return { strippedExe, dsym };
}

/** Stamp of the `<exe> --revision` smoke test, when the host can run the target. */
function smokeTestStamp(cfg: Config, exeName: string): string | undefined {
  return cfg.canRunOnHost ? resolve(cfg.buildDir, `${exeName}.smoke-test-passed`) : undefined;
}

/** Stamp of verify-binary.ts' scans of the executable, when the LLVM readers are available. */
function binaryVerifyStamp(cfg: Config, exeName: string): string | undefined {
  return binaryVerifyTools(cfg) !== undefined ? resolve(cfg.buildDir, `${exeName}.binary-verified`) : undefined;
}

/** Stamp of the duplicate-definition scan of the link inputs (its report is `<exe>.duplicate-symbols.txt`). */
function duplicateSymbolsStamp(cfg: Config, exeName: string): string | undefined {
  // COFF objects need llvm-objdump to tell COMDAT from strong (verify-binary.ts coffDefinitions).
  return cfg.nm !== undefined && !(cfg.windows && cfg.objdump === undefined)
    ? resolve(cfg.buildDir, `${exeName}.duplicate-symbols-checked`)
    : undefined;
}

function binaryVerifyTools(cfg: Config): { nm: string; readobj: string; objdump: string; cxxfilt: string } | undefined {
  const { nm, readobj, objdump, cxxfilt } = cfg;
  return nm !== undefined && readobj !== undefined && objdump !== undefined && cxxfilt !== undefined
    ? { nm, readobj, objdump, cxxfilt }
    : undefined;
}

/**
 * The checks emitPostLink attaches to an executable, as the stamp paths the
 * link edge names as its ninja validations — so `ninja bun` (or anything
 * that relinks it) runs them, without making them inputs of anything.
 */
export function postLinkChecks(cfg: Config, exeName: string): string[] {
  return [smokeTestStamp(cfg, exeName), binaryVerifyStamp(cfg, exeName), duplicateSymbolsStamp(cfg, exeName)].filter(
    (p): p is string => p !== undefined,
  );
}

const verifyBinaryPath = resolve(import.meta.dirname, "verify-binary.ts");

/**
 * verify-binary.ts' static scans of the linked executable — exported
 * symbols, dynamic libraries and symbol-version ceilings, forbidden imports,
 * static initializers, hardening bits, debug info — against what
 * binary-expectations.ts says this target should look like. The
 * expectations are serialized now; the scan runs as a validation of the link.
 */
/**
 * Only CI fails on a finding. Local builds (`cfg.ci` unset) run the static
 * scans and print the same report as warnings, so a toolchain or distro
 * difference on a dev machine never costs the binary. In CI, ASan and debug
 * builds also only warn: the expectations describe the binaries that ship, and
 * those builds are for finding bugs with.
 */
export function binaryChecksWarnOnly(cfg: Config): boolean {
  return !cfg.ci || cfg.asan || cfg.debug;
}

function emitBinaryVerify(
  n: Ninja,
  cfg: Config,
  exe: string,
  exeName: string,
  strippedExe: string | undefined,
): string[] {
  const stamp = binaryVerifyStamp(cfg, exeName);
  const tools = binaryVerifyTools(cfg);
  if (stamp === undefined || tools === undefined) return [];
  const spec = resolve(cfg.buildDir, `${exeName}.verify.json`);
  writeIfChanged(spec, JSON.stringify({ name: exeName, exe, tools, expect: binaryExpectations(cfg) }, null, 2) + "\n");
  const q = (p: string) => quote(p, cfg.windows);
  n.rule("binary_verify", {
    command: `${cfg.jsRuntime} ${q(streamPath)} check --label=${exeName} --stamp=$out ${cfg.jsRuntime} ${q(verifyBinaryPath)}${binaryChecksWarnOnly(cfg) ? " --warn-only" : ""} binary $spec`,
    description: `check ${exeName} exports, dynamic deps, initializers, hardening`,
  });
  n.build({
    outputs: [stamp],
    rule: "binary_verify",
    inputs: [exe],
    // linkDepends: the export lists in src/ the check reads (also link inputs).
    implicitInputs: [
      spec,
      verifyBinaryPath,
      resolve(import.meta.dirname, "binary-expectations.ts"),
      ...linkDepends(cfg),
    ],
    // Same reason as emitSmokeTest: never run while strip is mid-write when
    // the wrapper runtime is <buildDir>/bun itself.
    ...(strippedExe !== undefined ? { orderOnlyInputs: [strippedExe] } : {}),
    vars: { spec: q(spec) },
  });
  return [stamp];
}

/**
 * The same scan for the Windows `.bin/` shim, against `shimExpectations()`. Returns the stamp, which the shim's
 * rustc edge names as a validation: whenever the shim is relinked, it is checked.
 */
function emitShimVerify(n: Ninja, cfg: Config): string[] {
  const tools = binaryVerifyTools(cfg);
  if (!cfg.windows || tools === undefined) return [];
  const name = "bun-shim-impl";
  const exe = windowsShimPath(cfg);
  const stamp = resolve(cfg.buildDir, `${name}.binary-verified`);
  const spec = resolve(cfg.buildDir, `${name}.verify.json`);
  writeIfChanged(spec, JSON.stringify({ name, exe, tools, expect: shimExpectations() }, null, 2) + "\n");
  const q = (p: string) => quote(p, cfg.windows);
  n.rule("shim_verify", {
    command: `${cfg.jsRuntime} ${q(streamPath)} check --label=${name} --stamp=$out ${cfg.jsRuntime} ${q(verifyBinaryPath)}${binaryChecksWarnOnly(cfg) ? " --warn-only" : ""} binary $spec`,
    description: `check ${name} imports, size, hardening`,
  });
  n.build({
    outputs: [stamp],
    rule: "shim_verify",
    inputs: [exe],
    implicitInputs: [spec, verifyBinaryPath, resolve(import.meta.dirname, "binary-expectations.ts")],
    vars: { spec: q(spec) },
  });
  return [stamp];
}

/**
 * A symbol with two strong external definitions among the link inputs: the
 * linker takes one silently when the other is an archive member it never
 * loads. verify-binary.ts scans every object and archive on the link line;
 * the report also lists weak definitions whose sizes differ (informational).
 */
function emitDuplicateSymbolCheck(
  n: Ninja,
  cfg: Config,
  exeName: string,
  linkInputs: string[],
  strippedExe: string | undefined,
): string[] {
  const stamp = duplicateSymbolsStamp(cfg, exeName);
  if (stamp === undefined) return [];
  const report = resolve(cfg.buildDir, `${exeName}.duplicate-symbols.txt`);
  const q = (p: string) => quote(p, cfg.windows);
  // While rustc's LLVM is ahead of clang's, libbun_runtime carries bitcode clang's llvm-nm/objdump can't
  // read — whole bitcode objects under cross-language LTO, and even without it the `__LLVM,__bitcode`
  // section rustc embeds in compiler_builtins on Mach-O. Use the tools rustup ships for rustc's LLVM
  // (component llvm-tools, `<sysroot>/lib/rustlib/<host>/bin`); they read clang's older output too. If
  // they are missing the scan reports every unreadable input and fails, with a hint.
  const rustBin =
    cfg.rustLlvmNewer && cfg.rustSysroot !== undefined && cfg.rustHostTriple !== undefined
      ? join(cfg.rustSysroot, "lib", "rustlib", cfg.rustHostTriple, "bin")
      : undefined;
  const rustTool = (name: string, fallback: string): string => {
    const p = rustBin !== undefined ? join(rustBin, name + cfg.host.exeSuffix) : undefined;
    return p !== undefined && existsSync(p) ? p : fallback;
  };
  const nm = rustTool("llvm-nm", cfg.nm!);
  const objdump = cfg.windows ? rustTool("llvm-objdump", cfg.objdump!) : undefined;
  // The report is always written; $out is the stamp, written only on success.
  n.rule("duplicate_symbols", {
    command: `${cfg.jsRuntime} ${q(streamPath)} check --label=${exeName} --elapsed --stamp=$out ${cfg.jsRuntime} ${q(verifyBinaryPath)}${binaryChecksWarnOnly(cfg) ? " --warn-only" : ""} duplicates ${q(nm)} $out.rsp ${q(report)}${objdump !== undefined ? ` ${q(objdump)}` : ""}`,
    description: `check ${exeName} link inputs for duplicate definitions`,
    rspfile: "$out.rsp",
    rspfile_content: "$in_newline",
  });
  n.build({
    outputs: [stamp],
    rule: "duplicate_symbols",
    inputs: linkInputs,
    implicitInputs: [verifyBinaryPath],
    ...(strippedExe !== undefined ? { orderOnlyInputs: [strippedExe] } : {}),
  });
  return [stamp];
}

/**
 * Smoke test: run the built executable with --revision. If it crashes or
 * errors, the build failed — typically means a link-time issue that the
 * linker didn't catch (missing symbol only referenced at init, ICU ABI
 * mismatch, etc.).
 *
 * `strippedExe` is the strip output (release builds only), added as an
 * order-only input so this rule never runs while strip is mid-write; see
 * emitPostLink for why.
 */
function emitSmokeTest(n: Ninja, cfg: Config, exe: string, exeName: string, strippedExe: string | undefined): string[] {
  // Skip when the binary can't run on this host (different os/arch/abi) —
  // `ninja check` then just depends on the exe.
  const stamp = smokeTestStamp(cfg, exeName);
  if (stamp === undefined) return [exe];

  // Linux+ASAN: wrap in `setarch <arch> -R` to disable ASLR. Fall back
  // to direct invocation if setarch fails (not all systems have it).
  // The `|| true` on the outer command isn't there — if BOTH fail, we
  // want the rule to error.
  const q = (p: string) => quote(p, cfg.windows);
  let testCmd: string;
  if (cfg.linux && cfg.asan) {
    const arch = cfg.x64 ? "x86_64" : "aarch64";
    // sh -c with parens: without grouping the `||` fallback would swallow a
    // failure of the first form.
    testCmd = `sh -c '( setarch ${arch} -R ${q(exe)} --revision || ${q(exe)} --revision )'`;
  } else {
    testCmd = `${q(exe)} --revision`;
  }

  // stream.ts prefix mode: the revision prints as `[check] <version>`, the
  // same label/colour as the other post-link checks; --stamp writes $out
  // when the command exits 0.
  n.rule("smoke_test", {
    command: `${cfg.jsRuntime} ${q(streamPath)} check --label=${exeName} --elapsed --stamp=$out --env=BUN_DEBUG_QUIET_LOGS=1 ${testCmd}`,
    description: `check ${exeName} --revision`,
  });

  n.build({
    outputs: [stamp],
    rule: "smoke_test",
    inputs: [exe],
    ...(strippedExe !== undefined ? { orderOnlyInputs: [strippedExe] } : {}),
  });
  return [stamp];
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
  // separate strip binary. The "stripped" bun is just a copy. Copy command
  // follows the HOST shell (cmd natively, cp when cross-compiling).
  if (cfg.windows) {
    // Copy as-is. /OPT:REF already applied at link.
    n.rule("copy_exe", {
      command: cfg.host.os === "windows" ? `cmd /c "copy /Y $in $out"` : `cp $in $out`,
      description: "copy $out (windows: no strip)",
    });
  } else {
    // Darwin cross: llvm-strip regenerates a bare linker-style ad-hoc
    // signature on its output, dropping the entitlements the link step
    // embedded — so the stripped `bun` needs its own postlink pass.
    // (machoPostlinkCommand is "" everywhere else.)
    n.rule("strip", {
      command: `${quote(cfg.strip, false)} $stripflags $in -o $out${machoPostlinkCommand(cfg)}`,
      description: "strip $out",
    });
  }

  const postlinkInputs = machoPostlinkImplicitInputs(cfg);
  const node = {
    outputs: [out],
    inputs: [inputExe],
    ...(postlinkInputs.length > 0 ? { implicitInputs: postlinkInputs } : {}),
  };
  if (cfg.windows) n.build({ ...node, rule: "copy_exe" });
  else n.build({ ...node, rule: "strip", vars: { stripflags: stripflags.join(" ") } });

  return out;
}

/**
 * Extract debug symbols from the linked (unstripped) executable into a
 * .dSYM bundle. darwin-only.
 *
 * Runs dsymutil on bun-profile (which has full DWARF). The .dSYM lets you
 * symbolicate crash logs from the stripped `bun` — lldb/Instruments find
 * it automatically by UUID.
 *
 * `strippedExe` is order-only for the same reason as emitSmokeTest: the
 * `cfg.jsRuntime` wrapper may be the strip output itself.
 */
function emitDsymutil(n: Ninja, cfg: Config, inputExe: string, exeName: string, strippedExe: string): string {
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
  //   CMake uses CMAKE_BUILD_PARALLEL_LEVEL; we use the host's core-count
  //   command via a subshell (sysctl on a darwin host, nproc when
  //   cross-compiling from linux).
  // stream.ts --console for pool:console consistency (no-op on darwin).
  const q = (p: string) => quote(p, false); // darwin/linux host → posix
  const ncpu = cfg.host.os === "linux" ? "nproc" : "sysctl -n hw.ncpu";
  const wrap = `${cfg.jsRuntime} ${q(streamPath)} dsym --console`;
  n.rule("dsymutil", {
    command: `${wrap} sh -c '${cfg.dsymutil} $in --flat --keep-function-for-static --object-prefix-map .=${cfg.cwd} -o $out -j $$(${ncpu})'`,
    description: "dsymutil $out",
    // Not restat — dsymutil always writes.
    pool: "console", // Can take a while, show progress
  });

  n.build({
    outputs: [out],
    rule: "dsymutil",
    inputs: [inputExe],
    orderOnlyInputs: [strippedExe],
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
 *   - The application manifest (longPathAware + SegmentHeap) as an
 *     RT_MANIFEST resource. Embedding it here instead of via the linker's
 *     /MANIFEST:EMBED keeps the link independent of the linker's manifest
 *     tooling: lld-link only handles /MANIFEST:EMBED itself when built with
 *     libxml2 and otherwise shells out to mt.exe — rustc's bundled lld-link
 *     (used for the cross-language-LTO links) has neither, and mt.exe does
 *     not exist on non-Windows hosts. The resource route produces the same
 *     RT_MANIFEST id-1 resource with any linker.
 *
 * This resource section is what rescle's ResourceUpdater modifies when
 * `bun build --compile --windows-title ...` runs. Without it, the copied
 * bun.exe has no VersionInfo to update and rescle silently does nothing.
 */
function emitWindowsResources(n: Ninja, cfg: Config): string {
  assert(cfg.windows, "emitWindowsResources is windows-only");
  assert(cfg.rc !== undefined, "llvm-rc not found in toolchain");

  // ─── Template substitution (configure time) ───
  // The .rc uses @VAR@ cmake-style placeholders. Substitute and write to
  // buildDir.
  // writeIfChanged → mtime preserved → no spurious rc rebuild when the
  // substituted content hasn't changed.
  const rcTemplate = resolve(cfg.cwd, "src/windows-app-info.rc");
  const ico = resolve(cfg.cwd, "src/bun.ico");
  const manifest = resolve(cfg.cwd, "src/bun.exe.manifest");
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
    .replace(/@BUN_ICO_PATH@/g, slash(ico))
    .replace(/@BUN_MANIFEST_PATH@/g, slash(manifest));
  const rcFile = resolve(cfg.buildDir, "windows-app-info.rc");
  writeIfChanged(rcFile, rcOut);

  // ─── Compile .rc → .res (ninja time) ───
  // llvm-rc: /FO sets output. `#include "windows.h"` in the .rc resolves
  // via the INCLUDE env var set by the VS dev shell (vs-shell.ps1) on a
  // Windows host; when cross-compiling there is no dev shell, so the SDK
  // and MSVC include dirs from the winsysroot are passed explicitly.
  const hostWin = cfg.host.os === "windows";
  const rcFlags: string[] = [];
  if (cfg.winsysroot !== undefined) {
    const includeDirs = windowsSysrootIncludeDirs(cfg.winsysroot);
    // The include dirs are baked into the rc edge at configure time, so the
    // sysroot must already be populated (configure.ts fetches it in CI
    // before emitBun). An empty set would only surface later as a cryptic
    // llvm-rc "windows.h not found" — fail here with the real cause instead.
    assert(
      includeDirs.length > 0,
      `Windows sysroot at ${cfg.winsysroot} has no MSVC/SDK include dirs — is it a complete xwin splat?`,
    );
    for (const dir of includeDirs) {
      rcFlags.push("/I", quote(dir, hostWin));
    }
  }
  const resFile = resolve(cfg.buildDir, "windows-app-info.res");
  n.rule("rc", {
    command: `${quote(cfg.rc, hostWin)} $rcflags /FO $out $in`,
    description: "rc $out",
  });
  n.build({
    outputs: [resFile],
    rule: "rc",
    inputs: [rcFile],
    // .ico and the manifest are embedded by rc at compile time — rebuild if
    // they change. The template is NOT tracked here: it's substituted at
    // configure time, so template edits need a reconfigure (happens rarely).
    implicitInputs: [ico, manifest],
    vars: { rcflags: rcFlags.join(" ") },
  });

  return resFile;
}

/**
 * Include dirs inside an xwin-style Windows sysroot, for tools that don't
 * understand `/winsysroot` themselves (llvm-rc). Layout:
 *   <root>/VC/Tools/MSVC/<ver>/include
 *   <root>/Windows Kits/10/Include/<sdkver>/{ucrt,shared,um}
 * The SDK "Include" dir is title-case in a real VS/SDK copy and lowercase
 * in an xwin winsysroot-style splat — accept either.
 */
function windowsSysrootIncludeDirs(winsysroot: string): string[] {
  const dirs: string[] = [];
  const msvcRoot = resolve(winsysroot, "VC", "Tools", "MSVC");
  if (existsSync(msvcRoot)) {
    for (const ver of readdirSync(msvcRoot)) {
      const d = resolve(msvcRoot, ver, "include");
      if (existsSync(d)) dirs.push(d);
    }
  }
  const sdkRoot = resolve(winsysroot, "Windows Kits", "10");
  const sdkInclude = ["Include", "include"].map(name => resolve(sdkRoot, name)).find(existsSync);
  if (sdkInclude !== undefined) {
    for (const ver of readdirSync(sdkInclude)) {
      for (const sub of ["ucrt", "shared", "um"]) {
        const d = resolve(sdkInclude, ver, sub);
        if (existsSync(d)) dirs.push(d);
      }
    }
  }
  return dirs;
}

/**
 * Files the linker reads via ldflags that ninja should track for relinking
 * (symbol lists, linker script). CMake's LINK_DEPENDS equivalent.
 * (The Windows manifest is no longer a link input — it's embedded by the
 * resource compiler; see emitWindowsResources.)
 */
function linkImplicitInputs(cfg: Config): string[] {
  // The ELF export list is the version script's `global:` block, written here so the link can take it as a file.
  if (cfg.linux || cfg.freebsd) writeIfChanged(exportListPath(cfg), exportList(versionScriptPath(cfg)));
  return linkDepends(cfg);
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
  // (A skewed native macOS host never gets here: Apple's ld has no lld to
  // swap, so config.ts turns cross-language LTO off there instead.)
  if (
    cfg.crossLangLto &&
    cfg.rustToolchain !== undefined &&
    cfg.rustLlvmVersion !== undefined &&
    cfg.clangVersion !== undefined
  ) {
    const rustMajor = Number.parseInt(cfg.rustLlvmVersion.split(".")[0] ?? "", 10);
    const clangMajor = Number.parseInt(cfg.clangVersion.split(".")[0] ?? "", 10);
    if (Number.isFinite(rustMajor) && Number.isFinite(clangMajor) && rustMajor > clangMajor) {
      // `cfg.ld` must be one of rustc's bundled lld flavors. On ELF targets
      // it's `cfg.rustLld` exactly; on darwin/windows cross targets it's the
      // ld64.lld / lld-link sibling from the same gcc-ld/ directory.
      assert(
        cfg.rustLld !== undefined && (cfg.ld === cfg.rustLld || dirname(cfg.ld) === dirname(cfg.rustLld)),
        `Cross-language LTO is on and rustc's LLVM (${cfg.rustLlvmVersion}) is newer than clang's ` +
          `(${cfg.clangVersion}), but rustc's bundled lld wasn't found — the link would fail with ` +
          `"Invalid record" reading libbun_runtime.a's bitcode. Install the pinned toolchain on this ` +
          `host (\`rustup toolchain install ${cfg.rustToolchain}\`), upgrade clang/lld to LLVM ` +
          `${rustMajor}+, or disable LTO with \`--lto=off\`.`,
      );
    }
  }

  // --local-deps names must match a dep — a typo would otherwise silently
  // build the pinned tarball while the banner claims `local:<typo>`.
  // Keyed by string: these names are the user's.
  const depsByName = new Map<string, Dependency>(allDeps.map(d => [d.name, d]));
  for (const [name, path] of Object.entries(cfg.localDeps)) {
    const dep = depsByName.get(name);
    assert(dep !== undefined, `--local-deps: unknown dep '${name}'`, {
      hint: `Known deps: ${[...depsByName.keys()].sort().join(", ")}`,
    });
    assert(
      !dep.enabled || dep.enabled(cfg),
      `--local-deps: ${name} is disabled for ${cfg.os}-${cfg.arch}${cfg.abi ? `-${cfg.abi}` : ""} in this configuration, so the checkout at ${path} would never be built`,
      { hint: `Drop ${name} from --local-deps, or build a target/config where its \`enabled\` predicate holds` },
    );
    // A dep the graph fetches but never reads (no build step, no sources, no
    // includes — lolhtml, which cargo consumes through the workspace
    // Cargo.toml's `path = "vendor/lolhtml"`) can't be redirected from here.
    const provides = dep.provides(cfg);
    assert(
      dep.build(cfg).kind !== "none" || (provides.sources ?? []).length > 0 || provides.includes.length > 0,
      `--local-deps: ${name} is only fetched by the build graph, never compiled or included by it, so redirecting it to ${path} would change nothing`,
      {
        hint: `Point ${name}'s real consumer at the checkout instead (for a cargo path dependency: the workspace Cargo.toml)`,
      },
    );
  }
}

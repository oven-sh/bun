/**
 * WebKit (bmalloc + WTF + JavaScriptCore, JSCOnly port) built directly in our
 * ninja graph — no cmake. This is what `--webkit=source` uses.
 *
 * What WebKit's cmake does, and where it lives here:
 *
 *   source lists            read from WebKit's own CMakeLists.txt / Sources.txt
 *                           at configure time (cmake-lists.ts), so a WebKit bump
 *                           never needs a list edited here
 *   cmakeconfig.h           webkit-config-header.ts (writeIfChanged)
 *   framework headers       forwarding stubs written at configure time:
 *                           <bmalloc/X.h>, <JavaScriptCore/X.h> flattened dirs
 *   DerivedSources codegen  ~17 ruby/python/perl edges + one per .lut.h
 *   unified bundles         WebKit's generate-unified-source-bundles.py, run at
 *                           configure time (it only writes #include lists)
 *   LLInt                   settings extractor exe → offsets extractor exe →
 *                           LLIntAssembly.h, each parsed by offlineasm (ruby)
 *   compile/archive         cc/cxx/pch/ar from compile.ts with dep flags, so
 *                           target/cpu/lto/asan come from flags.ts like every dep
 *
 * Configure needs the WebKit tree on disk (it reads Sources.txt etc.), so the
 * fetch for this dep runs at configure time when the tree is missing or stale
 * (source.ts prefetchConfigureSources) instead of as the first ninja edge.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { cmakeVars, evaluateCMake, type CMakeVars } from "../cmake-lists.ts";
import { ar, cc, cxx, link, pch } from "../compile.ts";
import type { Config } from "../config.ts";
import { BuildError, assert } from "../error.ts";
import { computeDepFlags, computeTargetLinkFlags, systemLibs } from "../flags.ts";
import { writeIfChanged } from "../fs.ts";
import type { Ninja } from "../ninja.ts";
import { quote, quoteArgs } from "../shell.ts";
import { depBuildDir, depSourceDir, type CustomBuildContext } from "../source.ts";
import { buildsIcu, icuIncludes } from "./icu.ts";
import { cmakeConfigHeader, inspectorFeatureDefines } from "./webkit-config-header.ts";

export interface WebKitDirectResult {
  libs: string[];
  includes: string[];
  /** testFFI — shipped in the CI artifact for jsc-stress/testFFI.test.ts. */
  extras: string[];
  /**
   * What a bun TU that includes JSC headers must wait for: the source tree
   * and every generated header — all declared outputs with restat, so this
   * is exact and bun's C++ compiles alongside JSC's instead of after the
   * archives (nested-cmake mode has to hand over the libs here, because its
   * headers are undeclared side effects of the lib edge).
   */
  outputs: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Platform description → the variables WebKit's CMakeLists branch on
// ───────────────────────────────────────────────────────────────────────────

function offlineAsmBackend(cfg: Config): string {
  return cfg.x64 ? "X86_64" : "ARM64";
}

function platformVars(cfg: Config, W: string, B: string): CMakeVars {
  const systemName = cfg.darwin ? "Darwin" : cfg.windows ? "Windows" : cfg.freebsd ? "FreeBSD" : "Linux";
  const JSC = join(W, "Source", "JavaScriptCore");
  return cmakeVars({
    PORT: "JSCOnly",
    WIN32: cfg.windows,
    MSVC: cfg.windows,
    APPLE: cfg.darwin,
    UNIX: !cfg.windows,
    ANDROID: cfg.abi === "android",
    CMAKE_SYSTEM_NAME: systemName,
    CMAKE_SYSTEM_PROCESSOR: cfg.x64 ? "x86_64" : "aarch64",
    CMAKE_BUILD_TYPE: cfg.buildType,
    CMAKE_C_COMPILER_ID: "Clang",
    CMAKE_CXX_COMPILER_ID: "Clang",
    COMPILER_IS_GCC_OR_CLANG: true,
    COMPILER_IS_CLANG: true,
    WTF_CPU_X86_64: cfg.x64,
    WTF_CPU_ARM64: cfg.arm64,
    WTF_CPU_ARM: false,
    WTF_CPU_MIPS: false,
    WTF_CPU_RISCV64: false,
    WTF_CPU_LOONGARCH64: false,
    WTF_OS_LINUX: cfg.linux,
    WTF_OS_UNIX: !cfg.windows,
    WTF_OS_WINDOWS: cfg.windows,
    WTF_OS_MAC_OS_X: cfg.darwin,
    WTF_OS_DARWIN: cfg.darwin,
    WTF_OS_FUCHSIA: false,
    EVENT_LOOP_TYPE: "Bun",
    LOWERCASE_EVENT_LOOP_TYPE: "bun",
    ENABLE_REMOTE_INSPECTOR: true,
    USE_INSPECTOR_SOCKET_SERVER: true,
    USE_BUN_JSC_ADDITIONS: true,
    USE_BUN_EVENT_LOOP: true,
    USE_MIMALLOC: !cfg.asan,
    USE_EXTERNAL_MIMALLOC: !cfg.asan,
    USE_SYSTEM_MALLOC: false,
    USE_LIBPAS: true,
    USE_CAPSTONE: false,
    USE_GLIB: false,
    USE_LIBBACKTRACE: false,
    USE_APPLE_INTERNAL_SDK: false,
    ENABLE_STATIC_JSC: true,
    ENABLE_JIT: true,
    ENABLE_DFG_JIT: true,
    ENABLE_FTL_JIT: true,
    ENABLE_C_LOOP: false,
    ENABLE_WEBASSEMBLY: true,
    ENABLE_SAMPLING_PROFILER: true,
    ENABLE_JSC_GLIB_API: false,
    ENABLE_MALLOC_HEAP_BREAKDOWN: false,
    ENABLE_JAVASCRIPT_SHELL: true,
    ATOMICS_REQUIRE_LIBATOMIC: false,
    DEVELOPER_MODE: false,
    CMAKE_SOURCE_DIR: W,
    CMAKE_BINARY_DIR: B,
    WTF_DIR: join(W, "Source", "WTF"),
    JAVASCRIPTCORE_DIR: JSC,
    BMALLOC_DIR: join(W, "Source", "bmalloc"),
    THIRDPARTY_DIR: join(W, "Source", "ThirdParty"),
    JavaScriptCore_DERIVED_SOURCES_DIR: join(B, "JavaScriptCore", "DerivedSources"),
    WTF_DERIVED_SOURCES_DIR: join(B, "WTF", "DerivedSources"),
    JavaScriptCore_FRAMEWORK_HEADERS_DIR: join(B, "JavaScriptCore", "Headers"),
    JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS_DIR: join(B, "JavaScriptCore", "PrivateHeaders"),
    WTF_FRAMEWORK_HEADERS_DIR: join(B, "WTF", "Headers"),
    bmalloc_FRAMEWORK_HEADERS_DIR: join(B, "bmalloc", "Headers"),
    // Scripts run from the source tree here; cmake copies them first.
    JavaScriptCore_SCRIPTS_DIR: join(JSC, "Scripts"),
    WTF_SCRIPTS_DIR: join(W, "Source", "WTF", "Scripts"),
  });
}

/** Evaluate one component's CMakeLists.txt (+ PlatformJSCOnly.cmake, + include()d .cmake files). */
function readLists(cfg: Config, W: string, B: string, cmakeLists: string): CMakeVars {
  const vars = platformVars(cfg, W, B);
  const dir = dirname(cmakeLists);
  vars.set("CMAKE_CURRENT_SOURCE_DIR", [dir]);
  vars.set("CMAKE_CURRENT_LIST_DIR", [dir]);
  vars.set("CMAKE_CURRENT_BINARY_DIR", [join(B, relative(join(W), dir))]);
  const opts = {
    resolveInclude: (arg: string, from: string) => (arg.endsWith(".cmake") ? resolve(dirname(from), arg) : undefined),
    onCommand: (name: string, _args: string[], file: string) => {
      if (name === "webkit_include_config_files_if_exists") {
        const platform = resolve(dirname(file), "PlatformJSCOnly.cmake");
        if (existsSync(platform)) evaluateCMake(platform, vars, opts);
      }
    },
  };
  evaluateCMake(cmakeLists, vars, opts);
  return vars;
}

function list(vars: CMakeVars, name: string, base: string): string[] {
  const v = vars.get(name);
  assert(v !== undefined, `WebKit CMakeLists no longer sets ${name} — update webkit-direct.ts`);
  return v.map(p => resolve(base, p));
}

// ───────────────────────────────────────────────────────────────────────────
// Forwarding headers
// ───────────────────────────────────────────────────────────────────────────

/**
 * cmake copies (bmalloc, WTF) or symlinks (JSC) each framework header into a
 * flat `<Framework>/Headers/<framework>/` dir so `<JavaScriptCore/X.h>` works
 * from any subdirectory. A one-line `#include` stub does the same job on every
 * host OS, and the compiler's depfile then names the real header too.
 */
function writeForwardingHeaders(dir: string, headers: string[]): void {
  mkdirSync(dir, { recursive: true });
  const wanted = new Set<string>();
  for (const h of headers) {
    wanted.add(basename(h));
    writeStub(join(dir, basename(h)), h);
  }
  // Drop stubs for headers WebKit deleted, or a stale include would still
  // resolve. Only one-line stubs are ours to remove.
  for (const entry of readdirSync(dir)) {
    if (wanted.has(entry) || !lstatSync(join(dir, entry)).isFile()) continue;
    const text = readFileSync(join(dir, entry), "utf8");
    if (text.startsWith('#include "') && text.split("\n").length <= 2) rmSync(join(dir, entry));
  }
}

/**
 * One stub. If something other than a regular file sits at `path` (a symlink
 * left by a `--webkit=local` cmake build in the same build dir points INTO the
 * source tree), remove it first — writing through it would overwrite the real
 * header with a stub that includes itself.
 */
function writeStub(path: string, target: string): void {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (st !== undefined && !st.isFile()) rmSync(path, { recursive: true, force: true });
  writeIfChanged(path, `#include "${target.replaceAll("\\", "/")}"\n`);
}

// ───────────────────────────────────────────────────────────────────────────
// The emitter
// ───────────────────────────────────────────────────────────────────────────

/** The three archives, in link order (users before providers). */
export function webKitDirectLibs(cfg: Config): string[] {
  const libDir = join(depBuildDir(cfg, "WebKit"), "lib");
  return ["JavaScriptCore", "WTF", "bmalloc"].map(name => join(libDir, `${cfg.libPrefix}${name}${cfg.libSuffix}`));
}

export function emitWebKitDirect(n: Ninja, cfg: Config, ctx: CustomBuildContext): WebKitDirectResult {
  const { srcDir: W, ready, resolved } = ctx;
  assert(!cfg.windows && !cfg.darwin, "webkit=source direct build: only ELF targets are wired up so far", {
    hint: "Use --webkit=prebuilt (default) or --webkit=local on this platform for now.",
  });

  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const B = depBuildDir(cfg, "WebKit");
  const SRC = join(W, "Source");
  const JSC = join(SRC, "JavaScriptCore");
  const WTF = join(SRC, "WTF");
  const BM = join(SRC, "bmalloc");
  const DS = join(B, "JavaScriptCore", "DerivedSources");
  const jscHeaders = join(B, "JavaScriptCore", "Headers");
  const jscPrivateHeaders = join(B, "JavaScriptCore", "PrivateHeaders");
  const bmallocHeaders = join(B, "bmalloc", "Headers");
  const binDir = join(B, "bin");
  const libDir = join(B, "lib");

  assert(existsSync(join(JSC, "Sources.txt")), `WebKit source tree not present at ${W}`, {
    hint: "configure fetches it before emitting the graph — this is a bug in prefetchConfigureSources",
  });

  for (const d of [DS, join(DS, "yarr"), join(DS, "inspector"), join(DS, "runtime"), binDir, libDir]) {
    mkdirSync(d, { recursive: true });
  }

  n.comment("─── WebKit (direct: bmalloc + WTF + JavaScriptCore) ───");

  // ─── Source lists from WebKit's cmake ───
  const bmVars = readLists(cfg, W, B, join(BM, "CMakeLists.txt"));
  const wtfVars = readLists(cfg, W, B, join(WTF, "wtf", "CMakeLists.txt"));
  const jscVars = readLists(cfg, W, B, join(JSC, "CMakeLists.txt"));

  // ─── cmakeconfig.h ───
  writeIfChanged(join(B, "cmakeconfig.h"), cmakeConfigHeader(cfg));

  // ─── Forwarding headers ───
  // bmalloc.h includes "mimalloc.h" as a flattened sibling; cmake copies it in
  // from WebKit's vendored mimalloc, here it is the mimalloc bun links.
  const useMimalloc = !cfg.asan;
  const mimallocInclude = join(depSourceDir(cfg, "mimalloc"), "include");
  writeForwardingHeaders(join(bmallocHeaders, "bmalloc"), [
    ...list(bmVars, "bmalloc_PUBLIC_HEADERS", BM).filter(h => basename(h) !== "mimalloc.h"),
    ...(bmVars.get("bmalloc_PRIVATE_HEADERS") ?? []).map(p => resolve(BM, p)),
    ...(useMimalloc ? [join(mimallocInclude, "mimalloc.h")] : []),
  ]);
  // Consumers see both <bmalloc/X.h> and the bare "X.h" siblings bmalloc's
  // own headers include (libpas headers, mimalloc.h) — cmake gets the latter
  // from physically flattening copies into one dir.
  const bmallocConsumerIncludes = [bmallocHeaders, join(bmallocHeaders, "bmalloc")];
  writeForwardingHeaders(
    join(jscHeaders, "JavaScriptCore"),
    list(jscVars, "JavaScriptCore_PUBLIC_FRAMEWORK_HEADERS", JSC),
  );
  writeForwardingHeaders(
    join(jscPrivateHeaders, "JavaScriptCore"),
    list(jscVars, "JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS", JSC),
  );

  // ─── Flags ───
  const depFlags = computeDepFlags(cfg);
  // WebKit's own additions on top of the dep-global flags
  // (WebKitCompilerFlags.cmake). The global -fno-[asynchronous-]unwind-tables
  // stand: the prebuilt is compiled that way too (its CMAKE_CXX_FLAGS come
  // last and carry them). The DWARF flags are WebKit's debug-info size
  // reductions; JSC's templates make them matter.
  const webkitCommon = [
    "-fno-strict-aliasing",
    ...(cfg.windows ? [] : ["-gsimple-template-names", "-mllvm", "-dwarf-linkage-names=Abstract"]),
    ...(cfg.windows || cfg.darwin ? [] : ["-fdebug-types-section"]),
  ];
  const webkitCxx = [...depFlags.cxxflags, ...webkitCommon, "-std=c++23"];
  const webkitC = [...depFlags.cflags, ...webkitCommon];
  // Same PIC policy as bun's own objects (bunOnlyFlags): non-PIE executable
  // everywhere but Android, whose loader requires PIE.
  const pic = cfg.abi === "android" ? ["-fPIC"] : cfg.unix ? ["-fno-pic", "-fno-pie"] : [];
  webkitCxx.push(...pic);
  webkitC.push(...pic);
  // ICU: ours (deps/icu.ts) everywhere but macOS; static, so consumers
  // define U_STATIC_IMPLEMENTATION like the prebuilt build does.
  const icuFlags = buildsIcu(cfg)
    ? ["-DU_STATIC_IMPLEMENTATION=1", ...icuIncludes(cfg, depSourceDir(cfg, "icu")).map(i => `-I${q(i)}`)]
    : [];
  const commonDefines = [
    "-DBUILDING_JSCONLY__",
    "-DBUILDING_WEBKIT",
    "-DBUILDING_WITH_CMAKE",
    "-DHAVE_CONFIG_H",
    "-DPAS_BMALLOC=1",
    // WebKit's USE_CXX_STDLIB_ASSERTIONS default: the standard library's own
    // hardening (libstdc++ on gnu/musl, libc++ elsewhere).
    ...(cfg.linux && cfg.abi !== "android"
      ? ["-D_GLIBCXX_ASSERTIONS=1"]
      : ["-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE"]),
    ...(cfg.assertions ? ["-DASSERT_ENABLED=1"] : []),
  ];
  // Everything below waits for the tree and for mimalloc's headers
  // (order-only: depfiles track real header edits; stamps only say "fetched").
  const treeReady = ready;

  // ─── bmalloc ───
  const bmIncludes = [
    B,
    BM,
    join(BM, "bmalloc"),
    join(BM, "libpas", "src", "libpas"),
    ...(useMimalloc ? [mimallocInclude] : []),
  ];
  const bmFlagsCommon = [
    ...commonDefines,
    "-DBUILDING_bmalloc",
    "-D_GNU_SOURCE",
    ...(useMimalloc ? ["-DUSE_MIMALLOC=1"] : []),
    ...bmIncludes.map(i => `-I${q(i)}`),
    "-Wno-cast-align",
    "-Wno-missing-field-initializers",
  ];
  const bmObjects: string[] = [];
  for (const src of list(bmVars, "bmalloc_SOURCES", BM)) {
    // bmalloc_SOURCES' .c members are set LANGUAGE CXX in cmake.
    const flags = src.endsWith(".c") ? ["-x", "c++", ...webkitCxx, ...bmFlagsCommon] : [...webkitCxx, ...bmFlagsCommon];
    bmObjects.push(
      src.endsWith(".c")
        ? cc(n, cfg, src, { flags, orderOnlyInputs: treeReady })
        : cxx(n, cfg, src, { flags, orderOnlyInputs: treeReady }),
    );
  }
  for (const src of list(bmVars, "bmalloc_C_SOURCES", BM)) {
    bmObjects.push(cc(n, cfg, src, { flags: [...webkitC, ...bmFlagsCommon], orderOnlyInputs: treeReady }));
  }
  const [libJSCPath, libWTFPath, libbmallocPath] = webKitDirectLibs(cfg) as [string, string, string];
  const libbmalloc = ar(n, cfg, libbmallocPath, bmObjects);
  n.phony("bmalloc", [libbmalloc]);

  // ─── WTF ───
  const wtfIncludes = [
    B,
    ...list(wtfVars, "WTF_PRIVATE_INCLUDE_DIRECTORIES", join(WTF, "wtf")),
    ...bmallocConsumerIncludes,
  ];
  const wtfFlags = [
    ...webkitCxx,
    ...commonDefines,
    "-DBUILDING_WTF",
    "-DSTATICALLY_LINKED_WITH_bmalloc",
    ...wtfIncludes.map(i => `-I${q(i)}`),
    ...icuFlags,
  ];
  const wtfObjects = list(wtfVars, "WTF_SOURCES", join(WTF, "wtf")).map(src =>
    cxx(n, cfg, src, { flags: wtfFlags, orderOnlyInputs: treeReady }),
  );
  const libWTF = ar(n, cfg, libWTFPath, wtfObjects);
  n.phony("WTF", [libWTF]);

  // ─── JavaScriptCore: codegen ───
  const ruby = "ruby";
  const python = hostWin ? "python" : "python3";
  const perl = "perl";
  const gen = (opts: {
    outputs: string[];
    cmd: string[];
    inputs: string[];
    desc: string;
    cwd?: string;
    env?: Record<string, string>;
    implicitOutputs?: string[];
  }): void => {
    const envPrefix = Object.entries(opts.env ?? {})
      .map(([k, v]) => `${k}=${q(v)}`)
      .join(" ");
    n.build({
      outputs: opts.outputs,
      ...(opts.implicitOutputs !== undefined && { implicitOutputs: opts.implicitOutputs }),
      rule: "webkit_gen",
      inputs: opts.inputs,
      orderOnlyInputs: treeReady,
      vars: {
        desc: opts.desc,
        cwd: q(opts.cwd ?? DS),
        cmd: (envPrefix ? `env ${envPrefix} ` : "") + quoteArgs(opts.cmd, hostWin),
      },
    });
  };
  /** `cmd > out` — for generators that print to stdout. */
  const genStdout = (out: string, cmd: string[], inputs: string[], desc: string): void => {
    n.build({
      outputs: [out],
      rule: "webkit_gen_stdout",
      inputs,
      orderOnlyInputs: treeReady,
      vars: { desc, cmd: quoteArgs(cmd, hostWin) },
    });
  };

  const generatedHeaders: string[] = [];
  /**
   * Generated .cpp files. They are compiled by being #included from unified
   * bundles (or listed in JavaScriptCore_SOURCES), so like the headers they
   * must exist before any JSC TU compiles.
   */
  const generatedSources: string[] = [];

  // LUT tables (create_hash_table, perl).
  const hashLut = join(JSC, "create_hash_table");
  for (const src of list(jscVars, "JavaScriptCore_OBJECT_LUT_SOURCES", JSC)) {
    const out = join(DS, `${basename(src).replace(/\.[^.]+$/, "")}.lut.h`);
    genStdout(out, [perl, hashLut, src], [hashLut, src], `lut ${basename(out)}`);
    generatedHeaders.push(out);
  }
  {
    const out = join(DS, "Lexer.lut.h");
    const table = join(JSC, "parser", "Keywords.table");
    genStdout(out, [perl, hashLut, table], [hashLut, table], "lut Lexer.lut.h");
    generatedHeaders.push(out);
  }

  // Bytecodes.
  const bytecodeOutputs = [
    "Bytecodes.h",
    "InitBytecodes.asm",
    "BytecodeStructs.h",
    "BytecodeIndices.h",
    "BytecodeDumperGenerated.cpp",
  ].map(f => join(DS, f));
  gen({
    outputs: bytecodeOutputs,
    cmd: [
      ruby,
      join(JSC, "generator", "main.rb"),
      "--bytecodes_h",
      join(DS, "Bytecodes.h"),
      "--init_bytecodes_asm",
      join(DS, "InitBytecodes.asm"),
      "--bytecode_structs_h",
      join(DS, "BytecodeStructs.h"),
      "--bytecode_indices_h",
      join(DS, "BytecodeIndices.h"),
      join(JSC, "bytecode", "BytecodeList.rb"),
      "--wasm_json",
      join(JSC, "wasm", "wasm.json"),
      "--bytecode_dumper",
      join(DS, "BytecodeDumperGenerated.cpp"),
    ],
    inputs: [
      join(JSC, "bytecode", "BytecodeList.rb"),
      join(JSC, "wasm", "wasm.json"),
      ...readdirSync(join(JSC, "generator"))
        .filter(f => f.endsWith(".rb"))
        .map(f => join(JSC, "generator", f)),
    ],
    desc: "Bytecodes",
  });
  generatedHeaders.push(join(DS, "Bytecodes.h"), join(DS, "BytecodeStructs.h"), join(DS, "BytecodeIndices.h"));
  generatedSources.push(join(DS, "BytecodeDumperGenerated.cpp"));

  // Air opcodes (writes into cwd).
  gen({
    outputs: [join(DS, "AirOpcode.h"), join(DS, "AirOpcodeGenerated.h")],
    implicitOutputs: [join(DS, "AirOpcodeUtils.h")],
    cmd: [ruby, join(JSC, "b3", "air", "opcode_generator.rb"), join(JSC, "b3", "air", "AirOpcode.opcodes")],
    inputs: [join(JSC, "b3", "air", "opcode_generator.rb"), join(JSC, "b3", "air", "AirOpcode.opcodes")],
    desc: "AirOpcode",
  });
  generatedHeaders.push(join(DS, "AirOpcode.h"), join(DS, "AirOpcodeGenerated.h"), join(DS, "AirOpcodeUtils.h"));

  // Keyword lookup, lexer/yarr unicode tables, regex tables.
  genStdout(
    join(DS, "KeywordLookup.h"),
    [python, join(JSC, "KeywordLookupGenerator.py"), join(JSC, "parser", "Keywords.table")],
    [join(JSC, "KeywordLookupGenerator.py"), join(JSC, "parser", "Keywords.table")],
    "KeywordLookup.h",
  );
  generatedHeaders.push(join(DS, "KeywordLookup.h"));
  {
    const script = join(JSC, "parser", "generateLexerUnicodePropertyTables.py");
    const out = join(DS, "LexerUnicodePropertyTables.h");
    gen({
      outputs: [out],
      cmd: [python, script, join(JSC, "ucd", "UnicodeData.txt"), out],
      inputs: [script, join(JSC, "ucd", "UnicodeData.txt")],
      desc: "LexerUnicodePropertyTables.h",
    });
    generatedHeaders.push(out);
  }
  {
    const script = join(JSC, "yarr", "create_regex_tables");
    const out = join(DS, "yarr", "RegExpJitTables.h");
    gen({ outputs: [out], cmd: [python, script, out], inputs: [script], desc: "RegExpJitTables.h" });
    generatedHeaders.push(out);
  }
  {
    const script = join(JSC, "yarr", "generateYarrUnicodePropertyTables.py");
    const out = join(DS, "yarr", "UnicodePatternTables.h");
    const ucd = join(JSC, "ucd");
    gen({
      outputs: [out],
      cmd: [python, script, ucd, out],
      inputs: [script, join(JSC, "yarr", "hasher.py"), ...readdirSync(ucd).map(f => join(ucd, f))],
      desc: "UnicodePatternTables.h",
    });
    generatedHeaders.push(out);
  }
  {
    const script = join(JSC, "yarr", "generateYarrCanonicalizeUnicode");
    const out = join(DS, "yarr", "YarrCanonicalizeUnicode.cpp");
    gen({
      outputs: [out],
      cmd: [python, script, join(JSC, "ucd", "CaseFolding.txt"), out],
      inputs: [script, join(JSC, "ucd", "CaseFolding.txt")],
      desc: "YarrCanonicalizeUnicode.cpp",
    });
    generatedSources.push(out);
  }

  // Wasm generators.
  for (const [scriptName, outName] of [
    ["generateWasmOpsHeader.py", "WasmOps.h"],
    ["generateWasmOMGIRGeneratorInlinesHeader.py", "WasmOMGIRGeneratorInlines.h"],
  ] as const) {
    const script = join(JSC, "wasm", scriptName);
    const out = join(DS, outName);
    gen({
      outputs: [out],
      cmd: [python, script, join(JSC, "wasm", "wasm.json"), out],
      inputs: [script, join(JSC, "wasm", "generateWasm.py"), join(JSC, "wasm", "wasm.json")],
      desc: outName,
    });
    generatedHeaders.push(out);
  }

  // JS builtins.
  {
    const scriptsDir = join(JSC, "Scripts");
    const script = join(scriptsDir, "generate-js-builtins.py");
    const builtins = list(jscVars, "JavaScriptCore_BUILTINS_SOURCES", JSC);
    const generatorScripts = [
      ...readdirSync(scriptsDir)
        .filter(f => f.endsWith(".py"))
        .map(f => join(scriptsDir, f)),
      ...readdirSync(join(scriptsDir, "wkbuiltins"))
        .filter(f => f.endsWith(".py"))
        .map(f => join(scriptsDir, "wkbuiltins", f)),
    ];
    gen({
      outputs: [join(DS, "JSCBuiltins.cpp"), join(DS, "JSCBuiltins.h")],
      cmd: [python, script, "--framework", "JavaScriptCore", "--output-directory", DS, "--combined", ...builtins],
      inputs: [...builtins, ...generatorScripts],
      desc: "JSCBuiltins",
    });
    generatedHeaders.push(join(DS, "JSCBuiltins.h"));
    // JSCBuiltins.cpp is compiled via JavaScriptCore_SOURCES (cmake appends it there).
    generatedSources.push(join(DS, "JSCBuiltins.cpp"));
  }

  // Inspector protocol.
  {
    const scriptsDir = join(JSC, "Scripts");
    const combined = join(DS, "CombinedDomains.json");
    const domains = list(jscVars, "JavaScriptCore_INSPECTOR_DOMAINS", JSC);
    gen({
      outputs: [combined],
      cmd: [
        python,
        join(scriptsDir, "generate-combined-inspector-json.py"),
        ...domains,
        inspectorFeatureDefines(cfg),
        combined,
      ],
      inputs: [join(scriptsDir, "generate-combined-inspector-json.py"), ...domains],
      desc: "CombinedDomains.json",
    });
    const inspectorScripts = join(JSC, "inspector", "scripts");
    const outDir = join(DS, "inspector");
    const outputs = [
      "InspectorAlternateBackendDispatchers.h",
      "InspectorBackendDispatchers.cpp",
      "InspectorBackendDispatchers.h",
      "InspectorFrontendDispatchers.cpp",
      "InspectorFrontendDispatchers.h",
      "InspectorProtocolObjects.cpp",
      "InspectorProtocolObjects.h",
      "InspectorBackendCommands.js",
    ].map(f => join(outDir, f));
    gen({
      outputs,
      cmd: [
        python,
        join(inspectorScripts, "generate-inspector-protocol-bindings.py"),
        "--outputDir",
        outDir,
        "--framework",
        "JavaScriptCore",
        combined,
      ],
      inputs: [
        combined,
        ...readdirSync(inspectorScripts)
          .filter(f => f.endsWith(".py"))
          .map(f => join(inspectorScripts, f)),
        ...readdirSync(join(inspectorScripts, "codegen"))
          .filter(f => f.endsWith(".py"))
          .map(f => join(inspectorScripts, "codegen", f)),
      ],
      desc: "InspectorProtocolBindings",
    });
    generatedHeaders.push(...outputs.filter(f => f.endsWith(".h")));
    generatedSources.push(...outputs.filter(f => f.endsWith(".cpp")));
  }

  // JSCWebPreferenceOptions.h (from WTF's unified preferences yaml).
  {
    const script = join(WTF, "Scripts", "GeneratePreferences.rb");
    const yaml = join(WTF, "Scripts", "Preferences", "UnifiedWebPreferences.yaml");
    const template = join(JSC, "Scripts", "PreferencesTemplates", "JSCWebPreferenceOptions.h.erb");
    const out = join(DS, "JSCWebPreferenceOptions.h");
    gen({
      outputs: [out],
      cmd: [ruby, script, "--frontend", "JavaScriptCore", "--outputDir", DS, "--template", template, yaml],
      inputs: [script, yaml, template],
      desc: "JSCWebPreferenceOptions.h",
    });
    generatedHeaders.push(out);
  }

  // Generated headers that cmake also exposes as <JavaScriptCore/X.h>.
  writeForwardingStubsInto(join(jscPrivateHeaders, "JavaScriptCore"), [
    join(DS, "Bytecodes.h"),
    join(DS, "JSCBuiltins.h"),
    join(DS, "JSCWebPreferenceOptions.h"),
    join(DS, "WasmOps.h"),
    join(DS, "inspector", "InspectorAlternateBackendDispatchers.h"),
    join(DS, "inspector", "InspectorBackendDispatchers.h"),
    join(DS, "inspector", "InspectorFrontendDispatchers.h"),
    join(DS, "inspector", "InspectorProtocolObjects.h"),
  ]);

  // ─── JavaScriptCore: LLInt ───
  const offlineasm = join(JSC, "offlineasm");
  const llintAsm = list(jscVars, "LLINT_ASM", JSC);
  const offlineAsmRb = list(jscVars, "OFFLINE_ASM", JSC);
  const lowLevelInterpreterAsm = join(JSC, "llint", "LowLevelInterpreter.asm");
  const backend = offlineAsmBackend(cfg);
  // asm.rb only (OFFLINE_ASM_FORMAT_ARGS); the two extractor generators take just the backend.
  const offlineAsmFormatArgs =
    cfg.linux || cfg.freebsd ? ["--binary-format=ELF"] : cfg.windows ? ["--platform=Windows"] : [];
  const buildVariants = "normal";

  const llintDesiredSettings = join(DS, "LLIntDesiredSettings.h");
  gen({
    outputs: [llintDesiredSettings],
    cmd: [
      ruby,
      join(offlineasm, "generate_settings_extractor.rb"),
      `-I${DS}/`,
      lowLevelInterpreterAsm,
      llintDesiredSettings,
      backend,
    ],
    inputs: [...llintAsm, ...offlineAsmRb, join(DS, "InitBytecodes.asm")],
    desc: "LLIntDesiredSettings.h",
  });

  // ─── JavaScriptCore: compile flags ───
  const jscIncludes = [
    jscHeaders,
    jscPrivateHeaders,
    B,
    join(jscPrivateHeaders, "JavaScriptCore"),
    ...list(jscVars, "JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES", JSC),
    DS,
    join(DS, "inspector"),
    join(DS, "runtime"),
    join(DS, "yarr"),
    WTF, // <wtf/X.h> straight from the source tree (cmake copies to WTF/Headers)
    ...bmallocConsumerIncludes,
  ];
  const jscFlagsNoTarget = [
    ...webkitCxx,
    "-ffp-contract=off",
    "-fno-slp-vectorize",
    ...commonDefines,
    "-DSTATICALLY_LINKED_WITH_WTF",
    "-DSTATICALLY_LINKED_WITH_bmalloc",
    ...[...new Set(jscIncludes)].map(i => `-I${q(i)}`),
    ...icuFlags,
  ];
  const jscFlags = [...jscFlagsNoTarget, "-DBUILDING_JavaScriptCore"];

  // All codegen must exist before any JSC TU compiles; after that the
  // depfiles know exactly which TU reads which header.
  const codegenReady = [...treeReady, ...generatedHeaders, ...generatedSources];

  // The extractors are real executables for the TARGET (offlineasm parses
  // them, nothing runs them), so they link with the same toolchain flags bun
  // does: triple/sysroot, lld, C++ runtime, PIE policy.
  const exeLinkFlags = [
    ...computeTargetLinkFlags(cfg),
    ...(cfg.asan ? ["-fsanitize=address"] : []),
    ...(cfg.windows ? [] : ["-Wl,--gc-sections"]),
  ];

  // LLIntSettingsExtractor: target executable, parsed (not run) by offlineasm.
  const settingsObj = cxx(n, cfg, join(JSC, "llint", "LLIntSettingsExtractor.cpp"), {
    flags: [...jscFlagsNoTarget, "-DBUILDING_LLIntSettingsExtractor"],
    implicitInputs: [llintDesiredSettings],
    orderOnlyInputs: codegenReady,
  });
  const settingsExe = link(n, cfg, join(binDir, "LLIntSettingsExtractor"), [settingsObj], {
    libs: [],
    flags: exeLinkFlags,
  });

  const llintDesiredOffsets = join(DS, "LLIntDesiredOffsets.h");
  gen({
    outputs: [llintDesiredOffsets],
    cmd: [
      ruby,
      join(offlineasm, "generate_offset_extractor.rb"),
      `-I${DS}/`,
      lowLevelInterpreterAsm,
      settingsExe,
      llintDesiredOffsets,
      backend,
      buildVariants,
    ],
    inputs: [
      settingsExe,
      ...llintAsm,
      ...offlineAsmRb,
      join(DS, "InitBytecodes.asm"),
      join(DS, "AirOpcode.h"),
      join(DS, "WasmOps.h"),
    ],
    desc: "LLIntDesiredOffsets.h",
  });

  const offsetsObj = cxx(n, cfg, join(JSC, "llint", "LLIntOffsetsExtractor.cpp"), {
    flags: [...jscFlagsNoTarget, "-DBUILDING_LLIntOffsetsExtractor"],
    implicitInputs: [llintDesiredOffsets],
    orderOnlyInputs: codegenReady,
  });
  const offsetsExe = link(n, cfg, join(binDir, "LLIntOffsetsExtractor"), [offsetsObj], {
    libs: [],
    flags: exeLinkFlags,
  });

  const llintAssembly = join(DS, "LLIntAssembly.h");
  gen({
    outputs: [llintAssembly],
    cmd: [
      ruby,
      join(offlineasm, "asm.rb"),
      `-I${DS}/`,
      lowLevelInterpreterAsm,
      offsetsExe,
      llintAssembly,
      buildVariants,
      ...offlineAsmFormatArgs,
    ],
    inputs: [offsetsExe, ...llintAsm, ...offlineAsmRb, join(DS, "InitBytecodes.asm")],
    env: { CMAKE_CXX_COMPILER_ID: "Clang", GCC_OFFLINEASM_SOURCE_MAP: "OFF" },
    desc: "LLIntAssembly.h",
  });

  // ─── JavaScriptCore: sources (unified bundles) ───
  const unifiedListFiles = list(jscVars, "JavaScriptCore_UNIFIED_SOURCE_LIST_FILES", JSC);
  const bundleScript = join(WTF, "Scripts", "generate-unified-source-bundles.py");
  const bundled = spawnSync(
    python,
    [
      bundleScript,
      "--derived-sources-path",
      DS,
      "--source-tree-path",
      JSC,
      "--ignore-header-groups",
      ...unifiedListFiles,
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  if (bundled.error)
    throw new BuildError("Failed to run python for WebKit unified source bundling", {
      cause: bundled.error,
      hint: `Is ${python} in PATH?`,
    });
  if (bundled.status !== 0) {
    throw new BuildError(`generate-unified-source-bundles.py failed:\n${bundled.stderr}`, { file: bundleScript });
  }
  // Output is a cmake list: bundle files (absolute) plus the @no-unify
  // members (relative to the source tree, or bare names of generated sources
  // in DerivedSources), headers included — same disambiguation as
  // WEBKIT_COMPUTE_SOURCES.
  const jscSources = [
    ...bundled.stdout
      .split(/[;\r\n]+/)
      .map(s => s.trim())
      .filter(s => /\.(cpp|c|cc)$/.test(s))
      .map(s => (s.startsWith("/") ? s : !s.includes("/") && !existsSync(join(JSC, s)) ? join(DS, s) : join(JSC, s))),
    ...list(jscVars, "JavaScriptCore_SOURCES", JSC),
  ];

  const prefixHeader = join(JSC, "JavaScriptCorePrefix.h");
  const jscPch = pch(n, cfg, prefixHeader, {
    flags: jscFlags,
    orderOnlyInputs: codegenReady,
    implicitInputs: [join(B, "cmakeconfig.h")],
  });

  const jscObjects: string[] = [];
  for (const src of jscSources) {
    const isC = src.endsWith(".c");
    jscObjects.push(
      isC
        ? cc(n, cfg, src, {
            flags: [
              ...webkitC,
              ...commonDefines,
              "-DBUILDING_JavaScriptCore",
              ...jscIncludes.map(i => `-I${q(i)}`),
              ...icuFlags,
            ],
            orderOnlyInputs: codegenReady,
          })
        : cxx(n, cfg, src, {
            flags: jscFlags,
            pch: jscPch.pch,
            pchHeader: jscPch.wrapperHeader,
            orderOnlyInputs: codegenReady,
          }),
    );
  }
  // LowLevelInterpreter.cpp: the inline-asm interpreter. Never LTO'd (the
  // asm labels must stay in one object), no PCH, waits for LLIntAssembly.h.
  jscObjects.push(
    cxx(n, cfg, join(JSC, "llint", "LowLevelInterpreter.cpp"), {
      flags: [...jscFlags.filter(f => !f.startsWith("-flto")), "-fno-lto"],
      implicitInputs: [llintAssembly],
      orderOnlyInputs: codegenReady,
    }),
  );

  const libJSC = ar(n, cfg, libJSCPath, jscObjects);
  n.phony("JavaScriptCore", [libJSC]);

  // testFFI: JSC's bun:ffi C++/ABI test executable (ffi/tests/testFFI.cpp),
  // run by test/js/bun/jsc-stress/testFFI.test.ts. Linking it also proves the
  // three archives + ICU + mimalloc resolve standalone before bun does.
  const testFFIObj = cxx(n, cfg, join(JSC, "ffi", "tests", "testFFI.cpp"), {
    flags: [...jscFlagsNoTarget, "-DBUILDING_testFFI", "-DSTATICALLY_LINKED_WITH_JavaScriptCore"],
    pch: jscPch.pch,
    pchHeader: jscPch.wrapperHeader,
    orderOnlyInputs: codegenReady,
  });
  const depLink = (name: string): string[] => {
    const r = resolved.get(name);
    return r === undefined ? [] : [...r.libs, ...r.objects];
  };
  const testFFI = link(n, cfg, join(binDir, "testFFI"), [testFFIObj, ...depLink("mimalloc")], {
    libs: [libJSC, libWTF, libbmalloc, ...depLink("icu")],
    flags: [...exeLinkFlags, ...systemLibs(cfg)],
  });
  n.phony("testFFI", [testFFI]);
  n.phony("jsc-codegen", [...generatedHeaders, ...generatedSources]);

  const libs = [libJSC, libWTF, libbmalloc];
  n.phony("WebKit", [...libs, testFFI]);

  return {
    libs,
    extras: [testFFI],
    outputs: [...treeReady, ...generatedHeaders],
    includes: [
      B,
      jscHeaders,
      join(jscHeaders, "JavaScriptCore"),
      jscPrivateHeaders,
      join(jscPrivateHeaders, "JavaScriptCore"),
      ...bmallocConsumerIncludes,
      WTF,
    ],
  };
}

/** Forwarding stubs for generated headers into an existing framework dir (no stale-stub sweep). */
function writeForwardingStubsInto(dir: string, headers: string[]): void {
  mkdirSync(dir, { recursive: true });
  for (const h of headers) writeStub(join(dir, basename(h)), h);
}

/**
 * Ninja rules for the edges above. Registered from registerDepRules so they
 * exist before any dep emits.
 */
export function registerWebKitDirectRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  // Generators write several outputs and are deterministic; restat prunes
  // downstream when a re-run produces identical bytes (offlineasm and the
  // python generators only rewrite on change).
  n.rule("webkit_gen", {
    command: hostWin ? `cmd /c "cd /d $cwd && $cmd"` : `cd $cwd && $cmd`,
    description: "gen $desc",
    restat: true,
  });
  n.rule("webkit_gen_stdout", {
    command: hostWin
      ? `cmd /c "$cmd > $out"`
      : `$cmd > $out.tmp && { cmp -s $out.tmp $out && rm $out.tmp || mv $out.tmp $out; }`,
    description: "gen $desc",
    restat: true,
  });
}

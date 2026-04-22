/**
 * WebKit DirectBuild — JavaScriptCore layer.
 *
 * Three pieces:
 *   1. DerivedSources/ — ~120 generated headers/.cpp via Ruby/Python/Perl
 *      (105 of them are the same `create_hash_table` pattern). Plus the
 *      LLInt offlineasm chain which compiles+runs two C++ extractor tools.
 *   2. Unified-source bundles — generate-unified-source-bundles.rb over
 *      Sources.txt → ~166 `#include "X.cpp"` rollups.
 *   3. Compile — bundles + ~22 standalone sources + DerivedSources/*.cpp.
 *
 * Codegen entries are hand-written (12 unique generators) rather than
 * auto-mapped from cmake's build.ninja — the auto-map is brittle around
 * shell-quoted multi-word args and cmake's flat-staged Scripts/ copies.
 */

import { execFileSync } from "node:child_process";
import { globSync } from "node:fs";
import type { Config } from "../../config.ts";
import type { Dependency, DirectCodegen } from "../../source.ts";
import { depBuildDir } from "../../source.ts";
import { webkitSrcDir } from "../webkit.ts";
import { webkitDirectSource } from "./bmalloc.ts";
import { commonDefines, icuPrefix, layerData, lutTables, webkitCFlags, webkitCxxFlags } from "./common.ts";

const layer = layerData.JavaScriptCore;
const SRC_INCLUDES = layer.includes.filter(i => i.startsWith("$SRC/")).map(i => i.replace("$SRC/", ""));

/**
 * Run generate-unified-source-bundles.py at configure time to learn
 * the bundle filenames it will emit. cmake does the same via
 * execute_process. The script also writes the bundle .cpp files as a
 * side effect, so the codegen step at build time is just a re-run for
 * staleness (it's a no-op when Sources.txt is unchanged).
 */
function unifiedBundles(cfg: Config): { bundles: string[]; nonUnified: string[] } {
  const src = webkitSrcDir(cfg);
  const jscSrc = `${src}/Source/JavaScriptCore`;
  const ds = `${depBuildDir(cfg, "webkit-jsc")}/DerivedSources`;
  const out = execFileSync(
    "python3",
    [
      `${src}/Source/WTF/Scripts/generate-unified-source-bundles.py`,
      "--derived-sources-path",
      ds,
      "--source-tree-path",
      jscSrc,
      `${jscSrc}/Sources.txt`,
      `${jscSrc}/inspector/remote/SourcesSocket.txt`,
    ],
    { encoding: "utf8" },
  );
  // Default mode prints a cmake-semicolon list interleaving bundle paths
  // (absolute, under <ds>/unified-sources/) with the @no-unify standalone
  // sources (relative to source-tree-path). Split them apart so the
  // standalone list comes from the same source of truth.
  const bundles: string[] = [];
  const nonUnified: string[] = [];
  for (const p of out.trim().split(";")) {
    if (p.includes("/unified-sources/")) {
      bundles.push(`$BUILD/DerivedSources/unified-sources/${p.split("/").pop()!}`);
    } else if (p.endsWith(".cpp") || p.endsWith(".c")) {
      // Relative source path; .h entries are header-only markers — skip.
      nonUnified.push(`Source/JavaScriptCore/${p}`);
    }
  }
  return { bundles, nonUnified };
}

const JSC = "$SRC/Source/JavaScriptCore";
const DS = "$BUILD/DerivedSources";

// Subdirs whose *.h are flattened into <JavaScriptCore/X.h>. JSC's own
// headers include each other through that prefix (MarkedBlock.h →
// <JavaScriptCore/CellAttributes.h>), so the flattened tree is needed
// for JSC's compile, not just external consumers.
// prettier-ignore
const FORWARD_SUBDIRS = [
  "API", "assembler", "b3", "builtins", "bytecode", "bytecompiler",
  "debugger", "dfg", "domjit", "heap", "inspector", "inspector/agents",
  "inspector/augmentable", "inspector/remote", "inspector/remote/socket",
  "interpreter", "jit", "llint", "lol", "parser", "profiler", "runtime",
  "tools", "wasm", "wasm/debugger", "wasm/js", "yarr",
];

// ───────────────────────────────────────────────────────────────────────────
// DerivedSources codegen — hand-written generator entries
// ───────────────────────────────────────────────────────────────────────────

/** 105 hash tables: `perl create_hash_table <in.cpp>` → stdout. */
function lutCodegen(): DirectCodegen[] {
  return lutTables.map(t => ({
    interpreter: "perl",
    script: `${JSC}/create_hash_table`,
    args: [t.in],
    outputs: [t.out.replace("$BUILD/JavaScriptCore", "$BUILD")],
    stdout: "$out",
  }));
}

/** Glob $SRC paths at configure time so the entry stays declarative. */
function srcGlob(cfg: Config, pattern: string): string[] {
  return globSync(pattern.replace("$SRC/", ""), { cwd: webkitSrcDir(cfg) }).map(p => `$SRC/${p}`);
}

// The inspector-domain combiner filters conditional domains by checking
// this space-separated list. Matches what cmake passes from
// FEATURE_DEFINES_WITH_SPACE_SEPARATOR.
const inspectorFeatureDefines = [
  "ENABLE_JIT",
  "ENABLE_DFG_JIT",
  "ENABLE_FTL_JIT",
  "ENABLE_WEBASSEMBLY",
  "ENABLE_REMOTE_INSPECTOR",
  "ENABLE_SAMPLING_PROFILER",
  "ENABLE_RESOURCE_USAGE",
  "USE_BUN_JSC_ADDITIONS",
].join(" ");

function jscCodegen(cfg: Config): DirectCodegen[] {
  const arch = cfg.arm64 ? "ARM64" : "X86_64";
  const builtinsJs = srcGlob(cfg, `${JSC}/builtins/*.js`);
  const protocolJson = srcGlob(cfg, `${JSC}/inspector/protocol/*.json`);

  return [
    // Bytecode generator → 5 outputs.
    {
      interpreter: "ruby",
      script: `${JSC}/generator/main.rb`,
      args: [
        "--bytecodes_h",
        `${DS}/Bytecodes.h`,
        "--init_bytecodes_asm",
        `${DS}/InitBytecodes.asm`,
        "--bytecode_structs_h",
        `${DS}/BytecodeStructs.h`,
        "--bytecode_indices_h",
        `${DS}/BytecodeIndices.h`,
        `${JSC}/bytecode/BytecodeList.rb`,
        "--wasm_json",
        `${JSC}/wasm/wasm.json`,
        "--bytecode_dumper",
        `${DS}/BytecodeDumperGenerated.cpp`,
      ],
      outputs: [
        `${DS}/Bytecodes.h`,
        `${DS}/InitBytecodes.asm`,
        `${DS}/BytecodeStructs.h`,
        `${DS}/BytecodeIndices.h`,
        `${DS}/BytecodeDumperGenerated.cpp`,
      ],
      inputs: [`${JSC}/bytecode/BytecodeList.rb`, `${JSC}/wasm/wasm.json`],
    },

    // B3 Air opcodes.
    {
      interpreter: "ruby",
      script: `${JSC}/b3/air/opcode_generator.rb`,
      args: [`${JSC}/b3/air/AirOpcode.opcodes`],
      outputs: [`${DS}/AirOpcode.h`, `${DS}/AirOpcodeGenerated.h`],
      inputs: [`${JSC}/b3/air/AirOpcode.opcodes`],
      cwd: DS,
    },

    // JS builtins (.js → embedded C++).
    {
      interpreter: "python3",
      script: `${JSC}/Scripts/generate-js-builtins.py`,
      args: [
        "--framework",
        "JavaScriptCore",
        "--output-directory",
        DS,
        "--combined",
        ...builtinsJs,
        `${JSC}/inspector/InjectedScriptSource.js`,
      ],
      outputs: [`${DS}/JSCBuiltins.cpp`, `${DS}/JSCBuiltins.h`],
      inputs: builtinsJs,
    },

    // Wasm op tables.
    {
      interpreter: "python3",
      script: `${JSC}/wasm/generateWasmOpsHeader.py`,
      args: [`${JSC}/wasm/wasm.json`, "$out"],
      outputs: [`${DS}/WasmOps.h`],
    },
    {
      interpreter: "python3",
      script: `${JSC}/wasm/generateWasmOMGIRGeneratorInlinesHeader.py`,
      args: [`${JSC}/wasm/wasm.json`, "$out"],
      outputs: [`${DS}/WasmOMGIRGeneratorInlines.h`],
    },

    // Yarr regex tables.
    {
      interpreter: "python3",
      script: `${JSC}/yarr/create_regex_tables`,
      args: ["$out"],
      outputs: [`${DS}/RegExpJitTables.h`],
    },
    {
      interpreter: "python3",
      script: `${JSC}/yarr/generateYarrUnicodePropertyTables.py`,
      args: [`${JSC}/ucd`, "$out"],
      outputs: [`${DS}/yarr/UnicodePatternTables.h`],
    },
    {
      interpreter: "python3",
      script: `${JSC}/yarr/generateYarrCanonicalizeUnicode`,
      args: [`${JSC}/ucd/CaseFolding.txt`, "$out"],
      outputs: [`${DS}/yarr/YarrCanonicalizeUnicode.cpp`],
    },

    // Lexer keyword + Unicode tables.
    {
      interpreter: "python3",
      script: `${JSC}/KeywordLookupGenerator.py`,
      args: [`${JSC}/parser/Keywords.table`],
      outputs: [`${DS}/KeywordLookup.h`],
      stdout: "$out",
    },
    {
      interpreter: "python3",
      script: `${JSC}/parser/generateLexerUnicodePropertyTables.py`,
      args: [`${JSC}/ucd/UnicodeData.txt`, "$out"],
      outputs: [`${DS}/LexerUnicodePropertyTables.h`],
    },

    // Inspector protocol — two-stage: combine JSON domains, then bindings.
    // Second positional arg is the feature-define list (space-separated,
    // single argv entry) the generator uses to filter conditional domains.
    {
      interpreter: "python3",
      script: `${JSC}/Scripts/generate-combined-inspector-json.py`,
      args: [...protocolJson, inspectorFeatureDefines, "$out"],
      outputs: [`${DS}/CombinedDomains.json`],
      inputs: protocolJson,
    },
    {
      interpreter: "python3",
      script: `${JSC}/inspector/scripts/generate-inspector-protocol-bindings.py`,
      args: ["--framework", "JavaScriptCore", "--outputDir", `${DS}/inspector`, `${DS}/CombinedDomains.json`],
      outputs: [
        `${DS}/inspector/InspectorAlternateBackendDispatchers.h`,
        `${DS}/inspector/InspectorBackendDispatchers.cpp`,
        `${DS}/inspector/InspectorBackendDispatchers.h`,
        `${DS}/inspector/InspectorFrontendDispatchers.cpp`,
        `${DS}/inspector/InspectorFrontendDispatchers.h`,
        `${DS}/inspector/InspectorProtocolObjects.cpp`,
        `${DS}/inspector/InspectorProtocolObjects.h`,
        `${DS}/inspector/InspectorBackendCommands.js`,
      ],
      inputs: [`${DS}/CombinedDomains.json`],
    },

    // ─── LLInt offlineasm chain (steps 1/5: settings header) ───
    // generate_settings_extractor.rb runs over the .asm sources and emits
    // a C++ header full of #ifdef'd magic-number tables. This step has no
    // compiled-tool dependency; the next four (compile LLIntSettingsExtractor,
    // run it, compile LLIntOffsetsExtractor, asm.rb) need the tool variant
    // and are added by llintCodegen() below.
    {
      interpreter: "ruby",
      script: `${JSC}/offlineasm/generate_settings_extractor.rb`,
      args: [`-I${DS}/`, `${JSC}/llint/LowLevelInterpreter.asm`, "$out", arch],
      outputs: [`${DS}/LLIntDesiredSettings.h`],
      inputs: [`${JSC}/llint/LowLevelInterpreter.asm`, `${DS}/InitBytecodes.asm`],
    },
  ];
}

/**
 * The LLInt offlineasm chain — JSC's interpreter is written in a custom
 * .asm DSL; offlineasm (Ruby) translates it to native assembly. To do
 * that it needs the *exact* byte offsets of every JSC struct field the
 * interpreter touches, which depend on the target's compiler/flags/ABI.
 *
 * The trick: compile a C++ file that embeds those offsets next to magic
 * numbers, link it into a real executable (so the layout matches the
 * actual build), then have Ruby read the magic numbers out of the binary.
 * Two rounds: SettingsExtractor learns which offlineasm settings apply,
 * then OffsetsExtractor learns the offsets under those settings.
 *
 * Chain: settings_extractor.rb → LLIntDesiredSettings.h
 *      → compile+link LLIntSettingsExtractor (← bmalloc+WTF+ICU)
 *      → offset_extractor.rb (reads that binary) → LLIntDesiredOffsets.h
 *      → compile+link LLIntOffsetsExtractor
 *      → asm.rb (reads that binary) → LLIntAssembly.h
 */
function llintCodegen(cfg: Config): DirectCodegen[] {
  const arch = cfg.arm64 ? "ARM64" : "X86_64";
  const fmt = cfg.darwin ? "MachO" : cfg.windows ? "PE" : "ELF";
  // System ICU + pthread; the extractors barely use them but WTF symbols
  // pull them in. asan flag goes on the link line so the runtime is found.
  const icu = icuPrefix(cfg);
  const sysLibs = cfg.windows
    ? ["icuuc.lib", "icuin.lib", "icudt.lib"]
    : [
        ...(icu !== undefined ? [`-L${icu}/lib`] : []),
        "-licuuc",
        "-licui18n",
        "-licudata",
        "-lpthread",
        "-ldl",
        ...(cfg.asan ? ["-fsanitize=address"] : []),
      ];
  const toolDeps = ["webkit-wtf", "webkit-bmalloc"];

  return [
    // 2/5: compile+link SettingsExtractor (reads LLIntDesiredSettings.h
    //      from step 1, which is in jscCodegen).
    {
      linkedTool: `${JSC}/llint/LLIntSettingsExtractor.cpp`,
      toolDeps,
      toolLibs: sysLibs,
      outputs: [`$BUILD/LLIntSettingsExtractor${cfg.exeSuffix}`],
    },
    // 3/5: ruby reads the binary → LLIntDesiredOffsets.h.
    {
      interpreter: "ruby",
      script: `${JSC}/offlineasm/generate_offset_extractor.rb`,
      args: [
        `-I${DS}/`,
        `${JSC}/llint/LowLevelInterpreter.asm`,
        `$BUILD/LLIntSettingsExtractor${cfg.exeSuffix}`,
        "$out",
        arch,
        "normal",
      ],
      outputs: [`${DS}/LLIntDesiredOffsets.h`],
      inputs: [
        `$BUILD/LLIntSettingsExtractor${cfg.exeSuffix}`,
        `${DS}/InitBytecodes.asm`,
        `${DS}/WasmOps.h`,
        `${DS}/AirOpcode.h`,
      ],
    },
    // 4/5: compile+link OffsetsExtractor (reads LLIntDesiredOffsets.h).
    {
      linkedTool: `${JSC}/llint/LLIntOffsetsExtractor.cpp`,
      toolDeps,
      toolLibs: sysLibs,
      outputs: [`$BUILD/LLIntOffsetsExtractor${cfg.exeSuffix}`],
    },
    // 5/5: asm.rb reads that binary → LLIntAssembly.h.
    {
      interpreter: "ruby",
      script: `${JSC}/offlineasm/asm.rb`,
      args: [
        `-I${DS}/`,
        `${JSC}/llint/LowLevelInterpreter.asm`,
        `$BUILD/LLIntOffsetsExtractor${cfg.exeSuffix}`,
        "$out",
        "normal",
        `--binary-format=${fmt}`,
      ],
      outputs: [`${DS}/LLIntAssembly.h`],
      inputs: [`$BUILD/LLIntOffsetsExtractor${cfg.exeSuffix}`, `${DS}/InitBytecodes.asm`],
      cwd: DS,
    },
  ];
}

export const webkitJSC: Dependency = {
  name: "webkit-jsc",
  enabled: cfg => cfg.webkit === "direct",
  fetchDeps: ["webkit-bmalloc", "webkit-wtf"],

  source: webkitDirectSource,

  build: cfg => {
    const { bundles, nonUnified } = unifiedBundles(cfg);
    // The remote-inspector backend's posix/win32 socket impl isn't in
    // Sources.txt (Platform*.cmake adds it).
    const remoteSocket = cfg.windows
      ? "Source/JavaScriptCore/inspector/remote/socket/win/RemoteInspectorSocketWin.cpp"
      : "Source/JavaScriptCore/inspector/remote/socket/posix/RemoteInspectorSocketPOSIX.cpp";
    return {
      kind: "direct",
      pic: true,
      sources: [
        ...bundles,
        ...nonUnified,
        remoteSocket,
        `${DS}/JSCBuiltins.cpp`,
        // cmake builds this as a separate LowLevelInterpreterLib OBJECT
        // target — it #includes LLIntAssembly.h to emit the interpreter's
        // native assembly (vmEntry*, jsc_llint_*, wasm trampolines).
        "Source/JavaScriptCore/llint/LowLevelInterpreter.cpp",
      ],
      includes: [
        ...SRC_INCLUDES,
        // <wtf/X.h> resolves directly from Source/WTF (forwarding tree is a
        // 1:1 mirror).
        "Source/WTF",
      ],
      defines: {
        ...commonDefines,
        BUILDING_JavaScriptCore: true,
        STATICALLY_LINKED_WITH_WTF: true,
        STATICALLY_LINKED_WITH_bmalloc: true,
        ...(cfg.linux && { _GNU_SOURCE: true, _GLIBCXX_ASSERTIONS: 1 }),
      },
      cflags: [
        ...webkitCFlags(cfg),
        `-I${depBuildDir(cfg, "webkit-bmalloc")}`,
        `-I${depBuildDir(cfg, "webkit-jsc")}/DerivedSources`,
        `-I${depBuildDir(cfg, "webkit-jsc")}/DerivedSources/inspector`,
        `-I${depBuildDir(cfg, "webkit-jsc")}/DerivedSources/yarr`,
      ],
      cxxflags: webkitCxxFlags(cfg),
      forwardHeaders: [
        ...FORWARD_SUBDIRS.map(d => ({
          glob: `Source/JavaScriptCore/${d}/*.h`,
          dest: "JavaScriptCore",
        })),
        // A handful of DerivedSources headers are also reached via the
        // <JavaScriptCore/X.h> prefix. Explicit list — they don't exist
        // at configure time so glob can't find them.
        {
          dest: "JavaScriptCore",
          from: [
            `${DS}/Bytecodes.h`,
            `${DS}/JSCBuiltins.h`,
            `${DS}/WasmOps.h`,
            `${DS}/inspector/InspectorAlternateBackendDispatchers.h`,
            `${DS}/inspector/InspectorBackendDispatchers.h`,
            `${DS}/inspector/InspectorFrontendDispatchers.h`,
            `${DS}/inspector/InspectorProtocolObjects.h`,
          ],
        },
      ],
      codegen: [
        ...jscCodegen(cfg),
        ...llintCodegen(cfg),
        ...lutCodegen(),
        // Unified-source bundles: 166 #include-rollup .cpp files. cmake runs
        // this at configure time via execute_process; here it's a normal
        // codegen step so the bundles regenerate when Sources.txt changes.
        {
          interpreter: "python3",
          script: "$SRC/Source/WTF/Scripts/generate-unified-source-bundles.py",
          args: [
            "--derived-sources-path",
            DS,
            "--source-tree-path",
            `${JSC}`,
            `${JSC}/Sources.txt`,
            `${JSC}/inspector/remote/SourcesSocket.txt`,
          ],
          outputs: bundles,
          inputs: [`${JSC}/Sources.txt`, `${JSC}/inspector/remote/SourcesSocket.txt`],
          cwd: DS,
          // Script prints its file list to stdout; we only need that at
          // configure (unifiedBundles() parses it). Sink the build-time
          // re-run's output instead of streaming it as [webkit-jsc] noise.
          stdout: "$BUILD/.unified-sources-list",
        },
      ],
    };
  },

  // What bun's own bindings need: the flattened <JavaScriptCore/X.h> tree,
  // <wtf/X.h> via Source/WTF, <bmalloc/X.h> via webkit-bmalloc's forwarding,
  // and the buildDir holding cmakeconfig.h. Mirrors webkit.ts's local-mode
  // provides() but with our per-layer buildDirs.
  provides: cfg => {
    const jscBuild = depBuildDir(cfg, "webkit-jsc");
    return {
      libs: [],
      includes: [
        // cmakeconfig.h + the bmalloc/ forwarding tree.
        depBuildDir(cfg, "webkit-bmalloc"),
        // <JavaScriptCore/X.h> (flattened forwarding) + the bare X.h some
        // bun headers use.
        jscBuild,
        `${jscBuild}/JavaScriptCore`,
        `${jscBuild}/DerivedSources`,
        // <wtf/X.h> — Source/WTF mirrors it 1:1, no staging needed.
        "Source/WTF",
      ],
    };
  },
};

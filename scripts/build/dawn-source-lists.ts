/**
 * Writes scripts/build/deps/dawn-sources.ts: the files, generated files and defines that make up Dawn's `webgpu_dawn`
 * library on each OS. Run it after changing a commit in deps/dawn.ts, or an option below:
 *
 *   bun scripts/build/dawn-source-lists.ts
 *
 * Dawn's CMake files decide what is in the library, through ~400 targets and their dependencies, so cmake answers:
 * this configures Dawn for each OS, which compiles nothing and works for all three on any host, and reads the
 * closure of the library out of what cmake generated. It needs cmake, ninja, python3 and clang on PATH.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { dawnDeps } from "./deps/dawn.ts";
import { BuildError } from "./error.ts";
import { fetchCliPath } from "./fetch-cli.ts";
import { writeIfChanged } from "./fs.ts";

const operatingSystems = ["linux", "darwin", "windows"] as const;
type OperatingSystem = (typeof operatingSystems)[number];

const repo = resolve(import.meta.dirname, "..", "..");
const vendor = (name: string) => join(repo, "vendor", name);
const output = join(import.meta.dirname, "deps", "dawn-sources.ts");

/** No windows, no samples, tests or tools, one backend for each OS beside Null, and no shader language but WGSL in. */
const options: Record<string, string> = {
  CMAKE_BUILD_TYPE: "Release",
  CMAKE_EXPORT_COMPILE_COMMANDS: "ON",
  DAWN_BUILD_MONOLITHIC_LIBRARY: "STATIC",
  DAWN_BUILD_SAMPLES: "OFF",
  DAWN_BUILD_TESTS: "OFF",
  DAWN_BUILD_PROTOBUF: "OFF",
  DAWN_USE_GLFW: "OFF",
  DAWN_USE_X11: "OFF",
  DAWN_USE_WAYLAND: "OFF",
  DAWN_USE_WINDOWS_UI: "OFF",
  DAWN_ENABLE_NULL: "ON",
  DAWN_ENABLE_DESKTOP_GL: "OFF",
  DAWN_ENABLE_OPENGLES: "OFF",
  DAWN_ENABLE_D3D11: "OFF",
  DAWN_ENABLE_SPIRV_VALIDATION: "OFF",
  TINT_BUILD_TESTS: "OFF",
  TINT_BUILD_CMD_TOOLS: "OFF",
  TINT_BUILD_SPV_READER: "OFF",
  TINT_BUILD_WGSL_WRITER: "OFF",
  TINT_BUILD_GLSL_WRITER: "OFF",
  TINT_BUILD_GLSL_VALIDATOR: "OFF",
  TINT_BUILD_IR_BINARY: "OFF",
  TINT_ENABLE_IR_DUMPING: "OFF",
  DAWN_ABSEIL_DIR: vendor("abseil-cpp"),
  DAWN_SPIRV_HEADERS_DIR: vendor("spirv-headers"),
  DAWN_VULKAN_HEADERS_DIR: vendor("vulkan-headers"),
  DAWN_VULKAN_UTILITY_LIBRARIES_DIR: vendor("vulkan-utility-libraries"),
  DAWN_JINJA2_DIR: join(vendor("jinja2"), "src", "jinja2"),
  DAWN_MARKUPSAFE_DIR: join(vendor("markupsafe"), "src", "markupsafe"),
  // Nothing is compiled, so no compiler is tried.
  CMAKE_C_COMPILER_WORKS: "1",
  CMAKE_CXX_COMPILER_WORKS: "1",
  CMAKE_TRY_COMPILE_TARGET_TYPE: "STATIC_LIBRARY",
};

const optionsOf: Record<OperatingSystem, Record<string, string>> = {
  linux: {
    CMAKE_SYSTEM_NAME: "Linux",
    CMAKE_C_COMPILER: "clang",
    CMAKE_CXX_COMPILER: "clang++",
    DAWN_ENABLE_VULKAN: "ON",
  },
  darwin: {
    CMAKE_SYSTEM_NAME: "Darwin",
    CMAKE_SYSTEM_PROCESSOR: "arm64",
    CMAKE_OSX_SYSROOT: "/",
    CMAKE_C_COMPILER: "clang",
    CMAKE_CXX_COMPILER: "clang++",
    CMAKE_OBJC_COMPILER: "clang",
    CMAKE_OBJCXX_COMPILER: "clang++",
    CMAKE_OBJC_COMPILER_WORKS: "1",
    CMAKE_OBJCXX_COMPILER_WORKS: "1",
    // What find_library() would look for in an SDK.
    CoreGraphicsFramework: "-framework CoreGraphics",
    FoundationFramework: "-framework Foundation",
    MetalFramework: "-framework Metal",
  },
  windows: {
    CMAKE_SYSTEM_NAME: "Windows",
    CMAKE_SYSTEM_PROCESSOR: "AMD64",
    CMAKE_C_COMPILER: "clang-cl",
    CMAKE_CXX_COMPILER: "clang-cl",
    CMAKE_RC_COMPILER: "llvm-rc",
    CMAKE_MT: "llvm-mt",
    CMAKE_LINKER: "lld-link",
    DAWN_ENABLE_VULKAN: "OFF",
  },
};

/** What deps/dawn.ts and the build's own flags say, what only a shared library reads, and what only a window does. */
const definesLeftOut =
  /^(NDEBUG|WIN32|_WINDOWS|NOMINMAX|WIN32_LEAN_AND_MEAN|[A-Z_]+_IMPLEMENTATION|DAWN_ENABLE_RENDERDOC|DAWN_SUPPORTS_GLFW_FOR_WINDOWING)$/;

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.error) throw new BuildError(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new BuildError(`${command} ${args.slice(0, 4).join(" ")} … exited with ${result.status}`, {
      hint: `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-30).join("\n"),
    });
  }
  return result.stdout;
}

interface Lists {
  dawn: Set<string>;
  abseil: Set<string>;
  generatedSources: Set<string>;
  generatedHeaders: Set<string>;
  defines: Set<string>;
}

/**
 * Where the SPIR-V writer is on, Dawn's CMake files configure SPIRV-Tools, and then nothing of it is part of the
 * library. So Bun has no such dep, and this fetches the commit that Dawn names for as long as cmake wants to read it.
 */
function fetchSpirvTools(scratch: string): string {
  const commit = /KhronosGroup\/SPIRV-Tools@([0-9a-f]{40})/.exec(readFileSync(join(vendor("dawn"), "DEPS"), "utf8"));
  if (!commit) throw new BuildError("vendor/dawn/DEPS names no commit of KhronosGroup/SPIRV-Tools");
  const dest = join(scratch, "spirv-tools");
  fetch("spirv-tools", "KhronosGroup/SPIRV-Tools", commit[1]!, dest, scratch);
  return dest;
}

/** As a build does it: nothing, where `dest` already holds that commit. */
function fetch(name: string, githubRepo: string, commit: string, dest: string, scratch: string): void {
  run(process.execPath, [fetchCliPath, "dep", name, githubRepo, commit, dest, join(scratch, "tarballs")], repo);
}

function listsOf(os: OperatingSystem, spirvTools: string): Lists {
  const build = mkdtempSync(join(tmpdir(), `dawn-${os}-`));
  try {
    const defined = Object.entries({ ...options, ...optionsOf[os], DAWN_SPIRV_TOOLS_DIR: spirvTools }).map(
      ([name, value]) => `-D${name}=${value}`,
    );
    run("cmake", ["-G", "Ninja", "-S", vendor("dawn"), "-B", build, ...defined], repo);
    const library = `src/dawn/native/${os === "windows" ? "webgpu_dawn.lib" : "libwebgpu_dawn.a"}`;
    const inputs = run("ninja", ["-t", "inputs", library], build).split("\n").filter(Boolean);
    const inBuild = (path: string) => relative(build, resolve(build, path)).split(sep).join("/");
    const objects = new Set(inputs.filter(path => /\.(o|obj)$/.test(path)).map(inBuild));

    const lists: Lists = {
      dawn: new Set(),
      abseil: new Set(),
      generatedSources: new Set(),
      generatedHeaders: new Set(
        inputs
          .map(inBuild)
          .filter(path => path.startsWith("gen/") && /\.(h|inl)$/.test(path))
          .map(path => path.slice("gen/".length)),
      ),
      defines: new Set(),
    };
    const roots: Array<[root: string, list: Set<string>]> = [
      [vendor("dawn"), lists.dawn],
      [vendor("abseil-cpp"), lists.abseil],
      [join(build, "gen"), lists.generatedSources],
    ];
    const commands: Array<{ file: string; output: string; command: string }> = JSON.parse(
      readFileSync(join(build, "compile_commands.json"), "utf8"),
    );
    for (const { file, output, command } of commands) {
      // The C++20 module of webgpu_cpp.h, which nothing imports.
      if (!objects.has(inBuild(output)) || file.endsWith(".ixx")) continue;
      const found = roots.find(([root]) => file.startsWith(root + sep));
      if (!found) throw new BuildError(`${file} is part of webgpu_dawn and in none of the trees it is made of`);
      found[1].add(relative(found[0], file).split(sep).join("/"));
      if (found[1] === lists.abseil) continue;
      for (const [, define] of command.matchAll(/(?:^|\s)[-/]D(\S+)/g)) {
        if (!definesLeftOut.test(define!.split("=")[0]!)) lists.defines.add(define!);
      }
    }
    return lists;
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
}

/** `{ "linux darwin": [..] }`: each entry under the systems that have it. */
function bySystems(lists: Record<OperatingSystem, Set<string>>): Record<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const entry of [...new Set(operatingSystems.flatMap(os => [...lists[os]]))].sort()) {
    const systems = operatingSystems.filter(os => lists[os].has(entry)).join(" ");
    grouped.set(systems, [...(grouped.get(systems) ?? []), entry]);
  }
  return Object.fromEntries([...grouped].sort(([a], [b]) => b.length - a.length || (a < b ? -1 : 1)));
}

/** As prettier prints it. */
export function printLists(lists: Record<string, readonly string[]>): string {
  const areKeysQuoted = Object.keys(lists).some(systems => systems.includes(" "));
  const rows = Object.entries(lists).map(([systems, entries]) => {
    const key = areKeysQuoted ? JSON.stringify(systems) : systems;
    const row = `  ${key}: [${entries.map(entry => JSON.stringify(entry)).join(", ")}],`;
    return row.length <= 120
      ? row
      : `  ${key}: [\n${entries.map(entry => `    ${JSON.stringify(entry)},\n`).join("")}  ],`;
  });
  return rows.length === 0 ? "{}" : `{\n${rows.join("\n")}\n}`;
}

function main(): void {
  const scratch = mkdtempSync(join(tmpdir(), "dawn-source-lists-"));
  let all: Record<OperatingSystem, Lists>;
  try {
    for (const dep of dawnDeps) {
      // None of them asks the configuration where its source is.
      const source = dep.source(undefined as never);
      if (source.kind !== "github-archive" || dep.patches) throw new BuildError(`${dep.name}: not a plain archive`);
      fetch(dep.name, source.repo, source.commit, vendor(dep.name), scratch);
    }
    const spirvTools = fetchSpirvTools(scratch);
    all = Object.fromEntries(operatingSystems.map(os => [os, listsOf(os, spirvTools)])) as typeof all;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const list = (key: keyof Lists) =>
    printLists(bySystems(Object.fromEntries(operatingSystems.map(os => [os, all[os][key]])) as never));
  const text = `// Written by scripts/build/dawn-source-lists.ts, which says when to run it again.
// Each list is under the systems that have its entries.

export type DawnLists = Readonly<Record<string, readonly string[]>>;

/** Relative to vendor/dawn. */
export const dawnSources: DawnLists = ${list("dawn")};

/** Relative to vendor/abseil-cpp. */
export const abseilSources: DawnLists = ${list("abseil")};

/** Relative to the folder Dawn's generators write. */
export const dawnGeneratedSources: DawnLists = ${list("generatedSources")};

/** Relative to the folder Dawn's generators write. */
export const dawnGeneratedHeaders: DawnLists = ${list("generatedHeaders")};

export const dawnDefines: DawnLists = ${list("defines")};
`;
  console.log(writeIfChanged(output, text) ? `wrote ${relative(repo, output)}` : "nothing changed");
}

if (import.meta.main) main();

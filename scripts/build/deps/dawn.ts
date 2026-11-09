/**
 * Dawn — Chromium's implementation of WebGPU, with Tint, its WGSL compiler. Behind `navigator.gpu` in a build with
 * `--webgpu=on` (src/runtime/webgpu/), which calls the C API of `webgpu.h`.
 *
 * What is built is Dawn's `webgpu_dawn` library without windows or surfaces: one backend for each OS (Vulkan, Metal,
 * Direct3D 12) and Null, which runs nothing and needs no GPU. The drivers are loaded when an adapter is asked for:
 * libvulkan.so.1, d3d12.dll, dxgi.dll and the HLSL compiler. Metal is linked.
 *
 * DirectBuild: ~570 sources of Dawn and ~100 of Abseil. Which ones, and with which defines, is in dawn-sources.ts,
 * which ../dawn-source-lists.ts writes from Dawn's own CMake files. Dawn generates `webgpu.h` and its tables from
 * `dawn.json` with python and jinja2, in the three steps below.
 *
 * Dawn names its dependencies by commit in its DEPS file. The Khronos ones here are those commits. Abseil, jinja2 and
 * markupsafe are copies in Chromium's tree there, which GitHub does not have, so here they are upstream releases.
 *
 * After changing a commit: `bun scripts/build/dawn-source-lists.ts`.
 */

import { join, resolve } from "node:path";
import type { Config } from "../config.ts";
import type { Dependency, DepName, GenStep } from "../source.ts";
import { depBuildDir, depSourceDir } from "../source.ts";
import {
  abseilSources,
  dawnDefines,
  dawnGeneratedHeaders,
  dawnGeneratedSources,
  type DawnLists,
  dawnSources,
} from "./dawn-sources.ts";

const DAWN_COMMIT = "66f899221d41dbc6d6257350c4b654a9b375c7f2";
const ABSEIL_COMMIT = "2065f4ded0558c6f89fee67c8e5228feb4eb960e"; // 20260817.0
const SPIRV_HEADERS_COMMIT = "6efe5ae6b7c6ad29da3f2cc3f164b9c3d72b78b1";
const VULKAN_HEADERS_COMMIT = "9fbc2a782ee3f8a4db64e7d991e23da75e893f44";
const VULKAN_UTILITY_LIBRARIES_COMMIT = "271510bc50a1ecc65e62ca07dbf6b8dfe530dfd0";
const JINJA2_COMMIT = "15206881c006c79667fe5154fe80c01c65410679"; // 3.1.6
const MARKUPSAFE_COMMIT = "28ace20b140d15c083e1cbc163ee6b7778ba098c"; // 3.0.2

const enabled = (cfg: Config): boolean => cfg.webgpu;

/** What the sources of the Metal backend import. Dawn's CMake files also link Cocoa, which only windows need. */
export const dawnFrameworks = ["CoreVideo", "Foundation", "IOKit", "IOSurface", "Metal", "QuartzCore"] as const;

function listFor(lists: DawnLists, cfg: Config): string[] {
  const system = cfg.windows ? "windows" : cfg.darwin ? "darwin" : "linux";
  return Object.entries(lists).flatMap(([systems, entries]) => (systems.split(" ").includes(system) ? entries : []));
}

/** Dawn and Abseil see each other's inline code, so both are compiled with these. */
function languageFlags(cfg: Config): string[] {
  return cfg.windows
    ? ["/std:c++20", "/GR-", "/EHsc", "/bigobj", "/utf-8", "/Zc:preprocessor", "-w"]
    : ["-std=c++20", "-fno-exceptions", "-fno-rtti", "-fvisibility=hidden", "-w"];
}

const windowsDefines = { NOMINMAX: true, WIN32_LEAN_AND_MEAN: true, _CRT_SECURE_NO_WARNINGS: true } as const;

/** Only read: headers, or the python that Dawn's generators import. */
function sourceOnly(name: DepName, repo: string, commit: string, when = enabled): Dependency {
  return {
    name,
    source: () => ({ kind: "github-archive", repo, commit }),
    build: () => ({ kind: "none" }),
    provides: () => ({ libs: [], includes: [] }),
    enabled: when,
  };
}

const usesVulkan = (cfg: Config): boolean => cfg.webgpu && cfg.linux;

export const spirvHeaders = sourceOnly("spirv-headers", "KhronosGroup/SPIRV-Headers", SPIRV_HEADERS_COMMIT, usesVulkan);
export const vulkanHeaders = sourceOnly(
  "vulkan-headers",
  "KhronosGroup/Vulkan-Headers",
  VULKAN_HEADERS_COMMIT,
  usesVulkan,
);
export const vulkanUtilityLibraries = sourceOnly(
  "vulkan-utility-libraries",
  "KhronosGroup/Vulkan-Utility-Libraries",
  VULKAN_UTILITY_LIBRARIES_COMMIT,
  usesVulkan,
);
export const jinja2 = sourceOnly("jinja2", "pallets/jinja", JINJA2_COMMIT);
export const markupsafe = sourceOnly("markupsafe", "pallets/markupsafe", MARKUPSAFE_COMMIT);

export const abseil: Dependency = {
  name: "abseil-cpp",
  source: () => ({ kind: "github-archive", repo: "abseil/abseil-cpp", commit: ABSEIL_COMMIT }),
  build: cfg => ({
    kind: "direct",
    lang: "cxx",
    sources: listFor(abseilSources, cfg),
    includes: ["."],
    defines: cfg.windows ? windowsDefines : {},
    cflags: languageFlags(cfg),
  }),
  provides: () => ({ libs: [], includes: [] }),
  enabled,
};

/** Where Dawn's generators write. `include/dawn/webgpu.h` is there. */
export const dawnGeneratedDir = (cfg: Config): string => join(depBuildDir(cfg, "dawn"), "gen");

export const dawn: Dependency = {
  name: "dawn",
  versionMacro: "DAWN",
  source: () => ({ kind: "github-archive", repo: "google/dawn", commit: DAWN_COMMIT }),
  fetchDeps: cfg => [
    "abseil-cpp",
    "jinja2",
    "markupsafe",
    ...(usesVulkan(cfg) ? (["spirv-headers", "vulkan-headers", "vulkan-utility-libraries"] as const) : []),
  ],

  build: cfg => {
    const src = depSourceDir(cfg, "dawn");
    const gen = dawnGeneratedDir(cfg);
    const generated = (path: string) => join(gen, path);
    const headers = listFor(dawnGeneratedHeaders, cfg);
    const sources = listFor(dawnGeneratedSources, cfg);

    const sysGenerator = join(cfg.cwd, "src", "codegen", "generate-webgpu-sys.ts");
    const commitFile = "dawn-commit.txt";
    const python = cfg.host.os === "windows" ? "python" : "python3";
    const inGenerator = (name: string) => join(src, "generator", name);
    const inDawn = (name: string) => join(src, "src", "dawn", name);
    const step = (desc: string, script: string, args: string[], inputs: string[], isOutput: RegExp): GenStep => ({
      desc,
      cwd: src,
      cmd: [
        python,
        inGenerator(script),
        ...args,
        "--template-dir",
        inGenerator("templates"),
        "--root-dir",
        src,
        "--output-dir",
        gen,
        "--jinja2-path",
        join(depSourceDir(cfg, "jinja2"), "src", "jinja2"),
        "--markupsafe-path",
        join(depSourceDir(cfg, "markupsafe"), "src", "markupsafe"),
      ],
      // The templates come and go with these: one fetch writes them all.
      inputs: [
        inGenerator(script),
        inGenerator("generator_lib.py"),
        ...inputs,
        resolve(depSourceDir(cfg, "jinja2"), ".ref"),
        resolve(depSourceDir(cfg, "markupsafe"), ".ref"),
      ],
      outputs: [...headers, ...sources].filter(path => isOutput.test(path)).map(generated),
    });
    const json = ["dawn.json", "dawn_wire.json", "dawn_native.json", "dawn_kotlin.json", "webgpu_kt_docs.json"];
    const isVersion = /\/dawn_version\.h$/;
    const isGpuInfo = /\/GPUInfo_autogen\./;

    return {
      kind: "direct",
      sources: [],
      // The generator would ask git for HEAD, and vendor/dawn is inside Bun's repository.
      headers: { [commitFile]: DAWN_COMMIT },
      steps: [
        step(
          "webgpu.h, Dawn's tables",
          "dawn_json_generator.py",
          [
            "--dawn-json",
            inDawn("dawn.json"),
            "--wire-json",
            inDawn("dawn_wire.json"),
            "--native-json",
            inDawn("dawn_native.json"),
            "--kotlin-json",
            inDawn("dawn_kotlin.json"),
            "--webgpu-kt-docs",
            inDawn("webgpu_kt_docs.json"),
            "--targets",
            "headers,cpp_headers,native_utils,webgpu_dawn_native_proc",
          ],
          json.map(inDawn),
          /^(?!.*(\/dawn_version\.h$|\/GPUInfo_autogen\.))/,
        ),
        step(
          "GPUInfo_autogen",
          "dawn_gpu_info_generator.py",
          ["--gpu-info-json", inDawn("gpu_info.json")],
          [inDawn("gpu_info.json")],
          isGpuInfo,
        ),
        step(
          "dawn_version.h",
          "dawn_version_generator.py",
          [
            "gen",
            "--dawn-dir",
            src,
            "--version-json",
            inDawn("dawn_version.json"),
            "--version-file",
            join(depBuildDir(cfg, "dawn"), commitFile),
          ],
          [inDawn("dawn_version.json")],
          isVersion,
        ),
        {
          desc: "webgpu_sys.rs",
          cwd: cfg.cwd,
          cmd: [cfg.bun, sysGenerator, generated("include/dawn/webgpu.h"), join(cfg.codegenDir, "webgpu_sys.rs")],
          inputs: [sysGenerator, join(cfg.cwd, "src", "codegen", "helpers.ts"), generated("include/dawn/webgpu.h")],
          outputs: [join(cfg.codegenDir, "webgpu_sys.rs")],
        },
      ],
      groups: [
        {
          name: "webgpu_dawn",
          sources: [...listFor(dawnSources, cfg), ...sources.map(generated)],
          includes: [
            ".",
            "include",
            "src/dawn/partition_alloc",
            generated("include"),
            generated("src"),
            depSourceDir(cfg, "abseil-cpp"),
            ...(usesVulkan(cfg)
              ? [
                  join(depSourceDir(cfg, "spirv-headers"), "include"),
                  join(depSourceDir(cfg, "vulkan-headers"), "include"),
                  join(depSourceDir(cfg, "vulkan-utility-libraries"), "include"),
                ]
              : []),
          ],
          cflags: [
            ...listFor(dawnDefines, cfg).map(define => `-D${define}`),
            ...(cfg.windows ? Object.keys(windowsDefines).map(define => `-D${define}`) : []),
            ...(cfg.debug || cfg.assertions ? ["-DDAWN_ENABLE_ASSERTS"] : []),
            // Otherwise Dawn writes to stdout and stderr. What its instance has to say goes to `on_log` (instance.rs).
            "-DDAWN_DISABLE_LOGGING",
            ...(cfg.darwin ? ["-fno-objc-arc"] : []),
          ],
          cxxflags: languageFlags(cfg),
          orderOnly: headers.map(generated),
        },
      ],
      consumerOutputs: [generated("include/dawn/webgpu.h")],
    };
  },

  provides: cfg => ({
    libs: [],
    includes: [join(depSourceDir(cfg, "dawn"), "include"), join(dawnGeneratedDir(cfg), "include")],
  }),
  enabled,
};

/** In the order of `allDeps`: what Dawn reads comes before it. */
export const dawnDeps: readonly Dependency[] = [
  spirvHeaders,
  vulkanHeaders,
  vulkanUtilityLibraries,
  jinja2,
  markupsafe,
  abseil,
  dawn,
];

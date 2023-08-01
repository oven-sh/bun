import fs from "fs";
import path from "path";
import { sliceSourceCode } from "./builtin-parser";
import { cap, fmtCPPString, readdirRecursive, resolveSyncOrNull } from "./helpers";
import { createAssertClientJS, createLogClientJS } from "./client-js";

let start = performance.now();
function mark(log: string) {
  const now = performance.now();
  console.log(`${log} (${(now - start).toFixed(0)}ms)`);
  start = now;
}

const BASE = path.join(import.meta.dir, "../");
const TMP = path.join(BASE, "out/tmp");

const moduleList = ["bun", "node", "thirdparty", "internal"]
  .flatMap(dir => readdirRecursive(path.join(BASE, dir)))
  .filter(file => file.endsWith(".js") || (file.endsWith(".ts") && !file.endsWith(".d.ts")))
  .map(file => file.slice(BASE.length))
  .sort();

const internalRegistry = new Map();

// Build Registry
for (let i = 0; i < moduleList.length; i++) {
  const prefix = moduleList[i].startsWith("node/") ? "node:" : moduleList[i].startsWith("bun:") ? "bun/" : undefined;
  if (prefix) {
    const id = prefix + moduleList[i].slice(prefix.length).replaceAll(".", "/").slice(0, -3);
    internalRegistry.set(id, i);
  }
}

// Native Module registry
const nativeModuleH = fs.readFileSync(path.join(BASE, "../bun.js/modules/_NativeModule.h"), "utf8");
const nativeModuleDefine = nativeModuleH.match(/BUN_FOREACH_NATIVE_MODULE\(macro\)\s*\\\n((.*\\\n)*\n)/);
if (!nativeModuleDefine) {
  throw new Error(
    "Could not find BUN_FOREACH_NATIVE_MODULE in _NativeModule.h. Knowing native module IDs is a part of the codegen process.",
  );
}
let nextNativeModuleId = 0;
const nativeModuleIds: Record<string, number> = {};
const nativeModuleEnums: Record<string, string> = {};
const nativeModuleEnumToId: Record<string, number> = {};
for (const [_, idString, enumValue] of nativeModuleDefine[0].matchAll(/macro\((.*?),(.*?)\)/g)) {
  const processedIdString = JSON.parse(idString.trim().replace(/_s$/, ""));
  const processedEnumValue = enumValue.trim();
  const processedNumericId = nextNativeModuleId++;
  nativeModuleIds[processedIdString] = processedNumericId;
  nativeModuleEnums[processedIdString] = processedEnumValue;
  nativeModuleEnumToId[processedEnumValue] = processedNumericId;
}

mark("Scan internal registry");

function codegenRequireId(id: string) {
  return `(__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, ${id}) || __intrinsic__createInternalModuleById(${id}))`;
}

function codegenRequireNativeModule(id: string) {
  return `(__intrinsic__requireNativeModule(${id}))`;
}

globalThis.requireTransformer = (specifier: string, from: string) => {
  // this one is deprecated
  if (specifier === "$shared") specifier = "./internal/shared.ts";

  const directMatch = internalRegistry.get(specifier);
  if (directMatch) return codegenRequireId(`${directMatch}/*${specifier}*/`);

  if (specifier in nativeModuleIds) {
    return `__intrinsic__requireNativeModule(${JSON.stringify(specifier)})`;
  }

  const relativeMatch =
    resolveSyncOrNull(specifier, path.join(BASE, path.dirname(from))) ?? resolveSyncOrNull(specifier, BASE);

  if (relativeMatch) {
    const found = moduleList.indexOf(path.relative(BASE, relativeMatch));
    if (found === -1) {
      throw new Error(
        `Builtin Bundler: "${specifier}" cannot be imported here because it doesn't get a module ID. Only files in "src/js" besides "src/js/builtins" can be used here.`,
      );
    }
    return codegenRequireId(`${found}/*${path.relative(BASE, relativeMatch)}*/`);
  }

  throw new Error(`Builtin Bundler: Could not resolve "${specifier}" in ${from}. These cannot be relative.`);
};

// Preprocess builtins
const bundledEntryPoints: string[] = [];
for (let i = 0; i < moduleList.length; i++) {
  try {
    const input = fs.readFileSync(path.join(BASE, moduleList[i]), "utf8");
    const processed = sliceSourceCode("{" + input.replace(/export\s*{\s*}\s*;/g, ""), true, x =>
      globalThis.requireTransformer(x, moduleList[i]),
    );
    let fileToTranspile = `// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/${moduleList[i]}

$$capture_start$$(function() {
${processed.result.slice(1)}
return __intrinsic__exports;
}).$$capture_end$$;`;

    // Attempt to optimize "$exports = ..." to a variableless return
    // otherwise, declare $exports so it works.
    let exportOptimization = false;
    fileToTranspile = fileToTranspile.replace(
      /__intrinsic__exports\s*=\s*(.*|.*\{[^\}]*}|.*\([^\)]*\));?\n\s*return\s*__intrinsic__exports;/g,
      (_, a) => {
        exportOptimization = true;
        return "return " + a + ";";
      },
    );
    if (!exportOptimization) {
      fileToTranspile = fileToTranspile
        .replaceAll("__intrinsic__exports", "$")
        .replace("$$capture_start$$(function() {", "$$$$capture_start$$$$(function() {var $;");
    }
    const outputPath = path.join(TMP, moduleList[i].slice(0, -3) + ".ts");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, fileToTranspile);
    bundledEntryPoints.push(outputPath);
  } catch (error) {
    console.error(error);
    console.error(`While processing: ${moduleList[i]}`);
    process.exit(1);
  }
}

mark("Preprocess modules");

const config = ({ debug }: { debug?: boolean }) => ({
  entrypoints: bundledEntryPoints,
  minify: { syntax: true, whitespace: !debug },
  root: TMP,
  define: {
    IS_BUN_DEVELOPMENT: String(!!debug),
    __intrinsic__debug: debug ? "$debug_log_enabled" : "false",
  },
});
const bundled_dev = await Bun.build(config({ debug: true }));
const bundled_prod = await Bun.build(config({}));
// const bundled_linux = await Bun.build(config({ platform: "linux" }));
// const bundled_darwin = await Bun.build(config({ platform: "darwin" }));
// const bundled_win32 = await Bun.build(config({ platform: "win32" }));
for (const bundled of [bundled_dev, bundled_prod /*, bundled_linux, bundled_darwin, bundled_win32*/]) {
  if (!bundled.success) {
    console.error(bundled.logs);
    process.exit(1);
  }
}

mark("Bundle modules");

const bundledOutputs = {
  host: new Map(),
  prod: new Map(),
  // linux: new Map(),
  // darwin: new Map(),
  // win32: new Map(),
};

for (const [name, bundle, outputs] of [
  ["modules_dev", bundled_dev, bundledOutputs.host],
  ["bundled_prod", bundled_prod, bundledOutputs.prod],
  // ["modules_linux", bundled_linux, bundledOutputs.linux],
  // ["modules_darwin", bundled_darwin, bundledOutputs.darwin],
  // ["modules_win32", bundled_win32, bundledOutputs.win32],
] as const) {
  for (const file of bundle.outputs) {
    const output = await file.text();
    let captured = output.match(/\$\$capture_start\$\$([\s\S]+)\.\$\$capture_end\$\$/)![1];
    let usesDebug = output.includes("$debug_log");
    let usesAssert = output.includes("$assert");
    captured =
      captured
        .replace(/^\((async )?function\(/, "($1function (")
        .replace(/]\s*,\s*__(debug|assert)_end__\)/g, ")")
        .replace(/]\s*,\s*__debug_end__\)/g, ")")
        .replace(/__intrinsic__lazy\(/g, "globalThis[globalThis.Symbol.for('Bun.lazy')](")
        .replace(/__intrinsic__/g, "@") + "\n";
    captured = captured.replace(
      /function\s*\(.*?\)\s*{/,
      '$&"use strict";' +
        (usesDebug
          ? createLogClientJS(
              file.path.replace(".js", ""),
              idToPublicSpecifierOrEnumName(file.path).replace(/^node:|^bun:/, ""),
            )
          : "") +
        (usesAssert ? createAssertClientJS(idToPublicSpecifierOrEnumName(file.path).replace(/^node:|^bun:/, "")) : ""),
    );
    const outputPath = path.join(BASE, "out", name, file.path);
    if (name === "modules_dev") {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, captured);
    }
    outputs.set(file.path.replace(".js", ""), captured);
  }
}

mark("Postprocesss modules");

function idToEnumName(id: string) {
  return id
    .replace(/\.[mc]?[tj]s$/, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .map(x => (["jsc", "ffi", "vm", "tls", "os", "ws", "fs", "dns"].includes(x) ? x.toUpperCase() : cap(x)))
    .join("");
}

function idToPublicSpecifierOrEnumName(id: string) {
  id = id.replace(/\.[mc]?[tj]s$/, "");
  if (id.startsWith("node/")) {
    return "node:" + id.slice(5).replaceAll(".", "/");
  } else if (id.startsWith("bun/")) {
    return "bun:" + id.slice(4).replaceAll(".", "/");
  } else if (id.startsWith("internal/")) {
    return "internal:" + id.slice(9).replaceAll(".", "/");
  } else if (id.startsWith("thirdparty/")) {
    return id.slice(11).replaceAll(".", "/");
  }
  return idToEnumName(id);
}

// This is a file with a single macro that is used in defining InternalModuleRegistry.h
fs.writeFileSync(
  path.join(BASE, "out/InternalModuleRegistry+numberOfModules.h"),
  `#define BUN_INTERNAL_MODULE_COUNT ${moduleList.length}\n`,
);

// This code slice is used in InternalModuleRegistry.h for inlining the enum. I dont think we
// actually use this enum but it's probably a good thing to include.
fs.writeFileSync(
  path.join(BASE, "out/InternalModuleRegistry+enum.h"),
  `${
    moduleList
      .map((id, n) => {
        return `${idToEnumName(id)} = ${n},`;
      })
      .join("\n") + "\n"
  }
`,
);

// This code slice is used in InternalModuleRegistry.cpp. It defines the loading function for modules.
fs.writeFileSync(
  path.join(BASE, "out/InternalModuleRegistry+createInternalModuleById.h"),
  `JSValue InternalModuleRegistry::createInternalModuleById(JSGlobalObject* globalObject, VM& vm, Field id)
{
  switch (id) {
    // JS internal modules
    ${moduleList
      .map((id, n) => {
        return `case Field::${idToEnumName(id)}: {
      INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "${idToPublicSpecifierOrEnumName(id)}"_s, ${JSON.stringify(
          id.replace(/\.[mc]?[tj]s$/, ".js"),
        )}_s, InternalModuleRegistryConstants::${idToEnumName(id)}Code);
    }`;
      })
      .join("\n    ")}
  }
}
`,
);

// This header is used by InternalModuleRegistry.cpp, and should only be included in that file.
// It inlines all the strings for the module IDs.
fs.writeFileSync(
  path.join(BASE, "out/InternalModuleRegistryConstants.h"),
  // we dont use process.platform, but if we wanted to make use of it, we could switch to the
  // commented version that inlines process.platform
  `#pragma once

namespace Bun {
namespace InternalModuleRegistryConstants {

${moduleList
  .map(
    (id, n) =>
      `static constexpr ASCIILiteral ${idToEnumName(id)}Code = ${fmtCPPString(
        bundledOutputs.prod.get(id.slice(0, -3)),
      )}_s;`,
  )
  .join("\n")}
}
}`,
  //   `#pragma once

  // namespace Bun {
  // namespace InternalModuleRegistryConstants {

  // #if __APPLE__
  // ${moduleList
  //   .map(
  //     (id, n) =>
  //       `static constexpr ASCIILiteral ${idToEnumName(id)}Code = ${fmtCPPString(
  //         bundledOutputs.darwin.get(id.slice(0, -3)),
  //       )}_s;`,
  //   )
  //   .join("\n")}
  // #elif _WIN32
  // ${moduleList
  //   .map(
  //     (id, n) =>
  //       `static constexpr ASCIILiteral ${idToEnumName(id)}Code = ${fmtCPPString(
  //         bundledOutputs.win32.get(id.slice(0, -3)),
  //       )}_s;`,
  //   )
  //   .join("\n")}
  // #else
  // // Not 100% accurate, but basically inlining linux on non-windows non-mac platforms.
  // ${moduleList
  //   .map(
  //     (id, n) =>
  //       `static constexpr ASCIILiteral ${idToEnumName(id)}Code = ${fmtCPPString(
  //         bundledOutputs.linux.get(id.slice(0, -3)),
  //       )}_s;`,
  //   )
  //   .join("\n")}
  // #endif

  // }
  // }`,
);

// This is a generated enum for zig code (exports.zig)
fs.writeFileSync(
  path.join(BASE, "out/ResolvedSourceTag.zig"),
  `pub const ResolvedSourceTag = enum(u32) {
    // Predefined
    javascript = 0,
    package_json_type_module = 1,
    wasm = 2,
    object = 3,
    file = 4,
    esm = 5,

    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as \`(1 << 9) & id\`
${moduleList.map((id, n) => `    @"${idToPublicSpecifierOrEnumName(id)}" = ${(1 << 9) | n},`).join("\n")}
    // Native modules run through a different system using ESM registry.
${Object.entries(nativeModuleIds)
  .map(([id, n]) => `    @"${id}" = ${(1 << 10) | n},`)
  .join("\n")}
};
`,
);

// This is a generated enum for c++ code (headers-handwritten.h)
fs.writeFileSync(
  path.join(BASE, "out/SyntheticModuleType.h"),
  `enum SyntheticModuleType : uint32_t {
    JavaScript = 0,
    PackageJSONTypeModule = 1,
    Wasm = 2,
    ObjectModule = 3,
    File = 4,
    ESM = 5,

    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as \`(1 << 9) & id\`
    InternalModuleRegistryFlag = 1 << 9,
${moduleList.map((id, n) => `    ${idToEnumName(id)} = ${(1 << 9) | n},`).join("\n")}
    
    // Native modules run through the same system, but with different underlying initializers.
    // They also have bit 10 set to differentiate them from JS builtins.
    NativeModuleFlag = (1 << 10) | (1 << 9),
${Object.entries(nativeModuleEnumToId)
  .map(([id, n]) => `    ${id} = ${(1 << 10) | n},`)
  .join("\n")}
};

`,
);

// This is used in ModuleLoader.cpp to link to all the headers for native modules.
fs.writeFileSync(
  path.join(BASE, "out/NativeModuleImpl.h"),
  Object.values(nativeModuleEnums)
    .map(value => `#include "../../bun.js/modules/${value}Module.h"`)
    .join("\n") + "\n",
);

// This is used for debug builds for the base path for dynamic loading
fs.writeFileSync(
  path.join(BASE, "out/DebugPath.h"),
  `// Using __FILE__ does not give an absolute file path
// This is a workaround for that.
#define BUN_DYNAMIC_JS_LOAD_PATH "${path.join(BASE, "out/")}"
`,
);

mark("Generate Code");

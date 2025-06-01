// This script is run when you change anything in src/js/*
//
// Documentation is in src/js/README.md
//
// Originally, the builtin bundler only supported function files, but then the module files were
// added to this, which has made this entire setup extremely convoluted and a mess.
//
// One day, this entire setup should be rewritten, but also it would be cool if Bun natively
// supported macros that aren't json value -> json value. Otherwise, I'd use a real JS parser/ast
// library, instead of RegExp hacks.
import fs from "fs";
import { mkdir, writeFile } from "fs/promises";
import { builtinModules } from "node:module";
import path from "path";
import jsclasses from "./../bun.js/bindings/js_classes";
import { sliceSourceCode } from "./builtin-parser";
import { createAssertClientJS, createLogClientJS } from "./client-js";
import { getJS2NativeCPP, getJS2NativeZig } from "./generate-js2native";
import { cap, declareASCIILiteral, writeIfNotChanged } from "./helpers";
import { createInternalModuleRegistry } from "./internal-module-registry-scanner";
import { define } from "./replacements";

const BASE = path.join(import.meta.dir, "../js");
const debug = process.argv[2] === "--debug=ON";
const CMAKE_BUILD_ROOT = process.argv[3];

const timeString = 'Bundled "src/js" for ' + (debug ? "development" : "production");
console.time(timeString);

if (!CMAKE_BUILD_ROOT) {
  console.error("Usage: bun bundle-modules.ts --debug=[OFF|ON] <CMAKE_WORK_DIR>");
  process.exit(1);
}

globalThis.CMAKE_BUILD_ROOT = CMAKE_BUILD_ROOT;
const bundleBuiltinFunctions = require("./bundle-functions").bundleBuiltinFunctions;

const TMP_DIR = path.join(CMAKE_BUILD_ROOT, "tmp_modules");
const CODEGEN_DIR = path.join(CMAKE_BUILD_ROOT, "codegen");
const JS_DIR = path.join(CMAKE_BUILD_ROOT, "js");

const t = new Bun.Transpiler({ loader: "tsx" });

let start = performance.now();
const silent = process.env.BUN_SILENT === "1";
function markVerbose(log: string) {
  const now = performance.now();
  console.log(`${log} (${(now - start).toFixed(0)}ms)`);
  start = now;
}

const mark = silent ? (log: string) => {} : markVerbose;

const { moduleList, nativeModuleIds, nativeModuleEnumToId, nativeModuleEnums, requireTransformer, nativeStartIndex } =
  createInternalModuleRegistry(BASE);
globalThis.requireTransformer = requireTransformer;

// these logs surround a very weird issue where writing files and then bundling sometimes doesn't
// work, so i have lot of debug logs that blow up the console because not sure what is going on.
// that is also the reason for using `retry` when theoretically writing a file the first time
// should actually write the file.
const verbose = Bun.env.VERBOSE ? console.log : () => {};
async function retry(n, fn) {
  var err;
  while (n > 0) {
    try {
      await fn();
      return;
    } catch (e) {
      err = e;
      n--;
      await Bun.sleep(5);
    }
  }
  throw err;
}

// Preprocess builtins
const bundledEntryPoints: string[] = [];
for (let i = 0; i < nativeStartIndex; i++) {
  try {
    let input = fs.readFileSync(path.join(BASE, moduleList[i]), "utf8");

    if (!/\bexport\s+(?:function|class|const|default|{)/.test(input)) {
      if (input.includes("module.exports")) {
        throw new Error(
          "Do not use CommonJS module.exports in ESM modules. Use `export default { ... }` instead. See src/js/README.md",
        );
      } else {
        throw new Error("Internal modules must have at least one ESM export statement. See src/js/README.md");
      }
    }

    // TODO: there is no reason this cannot be converted automatically.
    // import { ... } from '...' -> `const { ... } = require('...')`
    const scannedImports = t.scanImports(input);
    for (const imp of scannedImports) {
      if (imp.kind === "import-statement") {
        var isBuiltin = true;
        try {
          if (!builtinModules.includes(imp.path)) {
            requireTransformer(imp.path, moduleList[i]);
          }
        } catch {
          isBuiltin = false;
        }
        if (isBuiltin) {
          const err = new Error(
            `Cannot use ESM import statement within builtin modules. Use require("${imp.path}") instead. See src/js/README.md (from ${moduleList[i]})`,
          );
          err.name = "BunError";
          err.fileName = moduleList[i];
          throw err;
        }
      }
    }

    let importStatements: string[] = [];

    const processed = sliceSourceCode(
      "{" +
        input
          .replace(
            /\bimport(\s*type)?\s*(\{[^}]*\}|(\*\s*as)?\s[a-zA-Z0-9_$]+)\s*from\s*['"][^'"]+['"]/g,
            stmt => (importStatements.push(stmt), ""),
          )
          .replace(/export\s*{\s*}\s*;/g, ""),
      true,
      x => requireTransformer(x, moduleList[i]),
    );
    let fileToTranspile = `// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/${moduleList[i]}
${importStatements.join("\n")}

${processed.result.slice(1).trim()}
;$$EXPORT$$(__intrinsic__exports).$$EXPORT_END$$;
`;

    // Attempt to optimize "$exports = ..." to a variableless return
    // otherwise, declare $exports so it works.
    let exportOptimization = false;
    fileToTranspile = fileToTranspile.replace(
      /__intrinsic__exports\s*=\s*(.*|.*\{[^\}]*}|.*\([^\)]*\))\n+\s*\$\$EXPORT\$\$\(__intrinsic__exports\).\$\$EXPORT_END\$\$;/,
      (_, a) => {
        exportOptimization = true;
        return "$$EXPORT$$(" + a.replace(/;$/, "") + ").$$EXPORT_END$$;";
      },
    );
    if (!exportOptimization) {
      fileToTranspile = `var $;` + fileToTranspile.replaceAll("__intrinsic__exports", "$");
    }
    const outputPath = path.join(TMP_DIR, moduleList[i].slice(0, -3) + ".ts");

    await mkdir(path.dirname(outputPath), { recursive: true });
    if (!fs.existsSync(path.dirname(outputPath))) {
      verbose("directory did not exist after mkdir twice:", path.dirname(outputPath));
    }

    fileToTranspile = "// @ts-nocheck\n" + fileToTranspile;

    try {
      await writeFile(outputPath, fileToTranspile);
      if (!fs.existsSync(outputPath)) {
        verbose("file did not exist after write:", outputPath);
        throw new Error("file did not exist after write: " + outputPath);
      }
      verbose("wrote to", outputPath, "successfully");
    } catch {
      await retry(3, async () => {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, fileToTranspile);
        if (!fs.existsSync(outputPath)) {
          verbose("file did not exist after write:", outputPath);
          throw new Error("file did not exist after write: " + outputPath);
        }
        verbose("wrote to", outputPath, "successfully later");
      });
    }
    bundledEntryPoints.push(outputPath);
  } catch (error) {
    console.error(error);
    console.error(`While processing: ${moduleList[i]}`);
    process.exit(1);
  }
}

mark("Preprocess modules");

// directory caching stuff breaks this sometimes. CLI rules
const config_cli = [
  process.execPath,
  "build",
  ...bundledEntryPoints,
  ...(debug ? [] : ["--minify-syntax"]),
  "--root",
  TMP_DIR,
  "--target",
  "bun",
  ...builtinModules.map(x => ["--external", x]).flat(),
  ...Object.keys(define)
    .map(x => [`--define`, `${x}=${define[x]}`])
    .flat(),
  "--define",
  `IS_BUN_DEVELOPMENT=${String(!!debug)}`,
  "--define",
  `__intrinsic__debug=${debug ? "$debug_log_enabled" : "false"}`,
  "--outdir",
  path.join(TMP_DIR, "modules_out"),
];
verbose("running: ", config_cli);
const out = Bun.spawnSync({
  cmd: config_cli,
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});
if (out.exitCode !== 0) {
  console.error(out.stderr.toString());
  process.exit(out.exitCode);
}

mark("Bundle modules");

const outputs = new Map();

for (const entrypoint of bundledEntryPoints) {
  const file_path = entrypoint.slice(TMP_DIR.length + 1).replace(/\.ts$/, ".js");
  const file = Bun.file(path.join(TMP_DIR, "modules_out", file_path));
  const output = await file.text();
  let captured = `(function (){${output.replace("// @bun\n", "").trim()}})`;
  let usesDebug = output.includes("$debug_log");
  let usesAssert = output.includes("$assert");
  captured =
    captured
      .replace(/\$\$EXPORT\$\$\((.*)\).\$\$EXPORT_END\$\$;/, "return $1")
      .replace(/]\s*,\s*__(debug|assert)_end__\)/g, ")")
      .replace(/]\s*,\s*__debug_end__\)/g, ")")
      .replace(/import.meta.require\((.*?)\)/g, (expr, specifier) => {
        throw new Error(`Builtin Bundler: do not use import.meta.require() (in ${file_path}))`);
      })
      .replace(/return \$\nexport /, "return")
      .replace(/__intrinsic__/g, "@")
      .replace(/__no_intrinsic__/g, "") + "\n";
  captured = captured.replace(
    /function\s*\(.*?\)\s*{/,
    '$&"use strict";' +
      (usesDebug
        ? createLogClientJS(
            file_path.replace(".js", ""),
            idToPublicSpecifierOrEnumName(file_path).replace(/^node:|^bun:/, ""),
          )
        : "") +
      (usesAssert ? createAssertClientJS(idToPublicSpecifierOrEnumName(file_path).replace(/^node:|^bun:/, "")) : ""),
  );
  const errors = [...captured.matchAll(/@bundleError\((.*)\)/g)];
  if (errors.length) {
    throw new Error(`Errors in ${entrypoint}:\n${errors.map(x => x[1]).join("\n")}`);
  }

  const outputPath = path.join(JS_DIR, file_path);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, captured);
  outputs.set(file_path.replace(".js", ""), captured);
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
  if (id === "internal-for-testing.ts") return "bun:internal-for-testing"; // not in the `bun/` folder because it's added conditionally
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

await bundleBuiltinFunctions({
  requireTransformer,
});

mark("Bundle Functions");

// This is a file with a single macro that is used in defining InternalModuleRegistry.h
writeIfNotChanged(
  path.join(CODEGEN_DIR, "InternalModuleRegistry+numberOfModules.h"),
  `#define BUN_INTERNAL_MODULE_COUNT ${moduleList.length}
#define BUN_NATIVE_MODULE_START_INDEX ${nativeStartIndex}
`,
);

// This code slice is used in InternalModuleRegistry.h for inlining the enum. I dont think we
// actually use this enum but it's probably a good thing to include.
writeIfNotChanged(
  path.join(CODEGEN_DIR, "InternalModuleRegistry+enum.h"),
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
writeIfNotChanged(
  path.join(CODEGEN_DIR, "InternalModuleRegistry+createInternalModuleById.h"),
  `// clang-format off
JSValue InternalModuleRegistry::createInternalModuleById(JSGlobalObject* globalObject, VM& vm, Field id)
{
  switch (id) {
    // JS internal modules
    ${moduleList
      .map((id, n) => {
        const inner =
          n >= nativeStartIndex
            ? `return generateNativeModule(globalObject, vm, generateNativeModule_${nativeModuleEnums[id]});`
            : `INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "${idToPublicSpecifierOrEnumName(id)}"_s, ${JSON.stringify(
                id.replace(/\.[mc]?[tj]s$/, ".js"),
              )}_s, InternalModuleRegistryConstants::${idToEnumName(id)}Code, "builtin://${id
                .replace(/\.[mc]?[tj]s$/, "")
                .replace(/[^a-zA-Z0-9]+/g, "/")}"_s);`;
        return `case Field::${idToEnumName(id)}: {
      ${inner}
    }`;
      })
      .join("\n    ")}
    default: {
      __builtin_unreachable();
    }
  }
  __builtin_unreachable();
}
`,
);

// This header is used by InternalModuleRegistry.cpp, and should only be included in that file.
// It inlines all the strings for the module IDs.
//
// We cannot use ASCIILiteral's `_s` operator for the module source code because for long
// strings it fails a constexpr assert. Instead, we do that assert in JS before we format the string
if (!debug) {
  writeIfNotChanged(
    path.join(CODEGEN_DIR, "InternalModuleRegistryConstants.h"),
    `// clang-format off
#pragma once

namespace Bun {
namespace InternalModuleRegistryConstants {
  ${moduleList
    .slice(0, nativeStartIndex)
    .map((id, n) => {
      const out = outputs.get(id.slice(0, -3).replaceAll("/", path.sep));
      if (!out) {
        throw new Error(`Missing output for ${id}`);
      }
      return declareASCIILiteral(`${idToEnumName(id)}Code`, out);
    })
    .join("\n")}
}
}`,
  );
} else {
  // In debug builds, we write empty strings to prevent recompilation. These are loaded from disk instead.
  writeIfNotChanged(
    path.join(CODEGEN_DIR, "InternalModuleRegistryConstants.h"),
    `// clang-format off
#pragma once

namespace Bun {
namespace InternalModuleRegistryConstants {
  ${moduleList
    .slice(0, nativeStartIndex)
    .map((id, n) => `${declareASCIILiteral(`${idToEnumName(id)}Code`, "")}`)
    .join("\n")}
}
}`,
  );
}

// This is a generated enum for zig code (exports.zig)
writeIfNotChanged(
  path.join(CODEGEN_DIR, "ResolvedSourceTag.zig"),
  `// zig fmt: off
pub const ResolvedSourceTag = enum(u32) {
    javascript = 0,
    package_json_type_module = 1,
    package_json_type_commonjs = 2,
    wasm = 3,
    object = 4,
    file = 5,
    esm = 6,
    json_for_object_loader = 7,
    /// Generate an object with "default" set to all the exports, including a "default" property
    exports_object = 8,
    /// Generate a module that only exports default the input JSValue
    export_default_object = 9,
    /// Signal upwards that the matching value in 'require.extensions' should be used.
    common_js_custom_extension = 10,

    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as \`(1 << 9) & id\`
${moduleList
  .slice(0, nativeStartIndex)
  .map((id, n) => `    @"${idToPublicSpecifierOrEnumName(id)}" = ${(1 << 9) | n},`)
  .join("\n")}
    // Native modules come after the JS modules
${Object.entries(nativeModuleEnumToId)
  .map(([id, n], i) => `    @"${moduleList[nativeStartIndex + i]}" = ${(1 << 9) | (n + nativeStartIndex)},`)
  .join("\n")}
};
`,
);

// This is a generated enum for c++ code (headers-handwritten.h)
writeIfNotChanged(
  path.join(CODEGEN_DIR, "SyntheticModuleType.h"),
  `enum SyntheticModuleType : uint32_t {
    JavaScript = 0,
    PackageJSONTypeModule = 1,
    PackageJSONTypeCommonJS = 2,
    Wasm = 3,
    ObjectModule = 4,
    File = 5,
    ESM = 6,
    JSONForObjectLoader = 7,
    ExportsObject = 8,
    ExportDefaultObject = 9,
    CommonJSCustomExtension = 10,
    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as \`(1 << 9) & id\`
    InternalModuleRegistryFlag = 1 << 9,
${moduleList
  .slice(0, nativeStartIndex)
  .map((id, n) => `    ${idToEnumName(id)} = ${(1 << 9) | n},`)
  .join("\n")}
    // Native modules come after the JS modules
${Object.entries(nativeModuleEnumToId)
  .map(([id, n], i) => `    ${id} = ${(1 << 9) | (i + nativeStartIndex)},`)
  .join("\n")}
};

`,
);

// This is used in ModuleLoader.cpp to link to all the headers for native modules.
writeIfNotChanged(
  path.join(CODEGEN_DIR, "NativeModuleImpl.h"),
  Object.values(nativeModuleEnums)
    .map(value => `#include "../../bun.js/modules/${value}Module.h"`)
    .join("\n") + "\n",
);

writeIfNotChanged(path.join(CODEGEN_DIR, "GeneratedJS2Native.h"), getJS2NativeCPP());

// zig will complain if this file is outside of the module
const js2nativeZigPath = path.join(import.meta.dir, "../bun.js/bindings/GeneratedJS2Native.zig");
writeIfNotChanged(js2nativeZigPath, getJS2NativeZig(js2nativeZigPath));

const generatedDTSPath = path.join(CODEGEN_DIR, "generated.d.ts");
writeIfNotChanged(
  generatedDTSPath,
  (() => {
    let dts = `
// GENERATED TEMP FILE - DO NOT EDIT
// generated by ${import.meta.path}

declare module "module" {
  global {
    interface PropertyDescriptor {
      __proto__?: any;
    }

    interface Function {
      readonly $call: Function.prototype["call"];
      readonly $apply: Function.prototype["apply"];
    }

    namespace NodeJS {
      interface Require {

`;

    dts += `        (id: "bun"): typeof import("bun");\n`;
    dts += `        (id: "bun:test"): typeof import("bun:test");\n`;
    dts += `        (id: "bun:jsc"): typeof import("bun:jsc");\n`;

    for (let i = 0; i < nativeStartIndex; i++) {
      const id = moduleList[i];
      const out = outputs.get(id.slice(0, -3).replaceAll("/", path.sep));
      if (!out) {
        throw new Error(`Missing output for ${id}`);
      }
      let internalName = idToPublicSpecifierOrEnumName(id);
      if (internalName.startsWith("internal:")) internalName = internalName.replace(":", "/");

      dts += `        (id: "${internalName}"): typeof import("${path.join(BASE, id)}").default;\n`;
    }

    dts += `
      }
    }
  }
}
`;

    for (const [name] of jsclasses) {
      dts += `\ndeclare function $inherits${name}(value: any): boolean;`;
    }

    return dts;
  })(),
);

mark("Generate Code");

if (!silent) {
  console.log("");
  console.timeEnd(timeString);
  console.log(
    `  %s kb`,
    Math.floor(
      (moduleList
        .slice(0, nativeStartIndex)
        .reduce((a, b) => a + outputs.get(b.slice(0, -3).replaceAll("/", path.sep)).length, 0) +
        globalThis.internalFunctionJSSize) /
        1000,
    ),
  );
  console.log(`  %s internal modules`, nativeStartIndex);
  console.log(`  %s native modules`, Object.keys(nativeModuleIds).length);
  console.log(
    `  %s internal functions across %s files`,
    globalThis.internalFunctionCount,
    globalThis.internalFunctionFileCount,
  );
}

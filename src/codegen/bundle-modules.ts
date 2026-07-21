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
import * as esbuild from "esbuild";
import fs from "fs";
import { mkdir, writeFile } from "fs/promises";
import { builtinModules } from "node:module";
import path from "path";
import jsclasses from "./../jsc/bindings/js_classes";
import { sliceSourceCode } from "./builtin-parser";
import { createAssertClientJS, createLogClientJS } from "./client-js";
import { getJS2NativeCPP, getJS2NativeRust } from "./generate-js2native";
import { cap, declareASCIILiteral, sleep, writeIfNotChanged } from "./helpers";
import { createInternalModuleRegistry } from "./internal-module-registry-scanner";
import { define } from "./replacements";

const BASE = path.join(import.meta.dirname, "../js");
const debug = process.argv[2] === "--debug=ON";
const CMAKE_BUILD_ROOT = process.argv[3];

const timeString = 'Bundled "src/js" for ' + (debug ? "development" : "production");
console.time(timeString);

if (!CMAKE_BUILD_ROOT) {
  console.error("Usage: bun bundle-modules.ts --debug=[OFF|ON] <CMAKE_WORK_DIR>");
  process.exit(1);
}

globalThis.CMAKE_BUILD_ROOT = CMAKE_BUILD_ROOT;
const { bundleBuiltinFunctions } = await import("./bundle-functions");

const TMP_DIR = path.join(CMAKE_BUILD_ROOT, "tmp_modules");
const CODEGEN_DIR = path.join(CMAKE_BUILD_ROOT, "codegen");
const JS_DIR = path.join(CMAKE_BUILD_ROOT, "js");

// Lightweight scan for top-level ESM import/export statements. src/js/* is
// preprocessed before bundling so we only need the statement *kind* (builtin
// import, default export, named runtime export), not the full shape.
function scanImportsExports(src: string) {
  const noComments = src.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const imports: { kind: "import-statement"; path: string }[] = [];
  for (const m of noComments.matchAll(/^\s*import\s+(?!type\b)[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/gm)) {
    imports.push({ kind: "import-statement", path: m[2] });
  }
  for (const m of noComments.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) {
    imports.push({ kind: "import-statement", path: m[2] });
  }
  // Column-0 only (excludes `declare namespace { … }` members) and runtime
  // bindings only (excludes `export type` / `export interface`).
  const body = noComments.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const exports: string[] = [];
  if (/^export\s+default\b/m.test(body)) exports.push("default");
  if (/^export\s+(?:async\s+)?(?:function|class|const|let|var|\{)/m.test(body)) {
    exports.push("*named*");
  }
  return { imports, exports };
}

let start = performance.now();
const silent = process.env.BUN_SILENT === "1" || process.env.CLAUDECODE;
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
const verbose = process.env.VERBOSE ? console.log : () => {};
async function retry(n, fn) {
  var err;
  while (n > 0) {
    try {
      await fn();
      return;
    } catch (e) {
      err = e;
      n--;
      await sleep(5);
    }
  }
  throw err;
}

const bunRepoRoot = path.join(CMAKE_BUILD_ROOT, "..", "..");

// Preprocess builtins
const bundledEntryPoints: string[] = [];
for (let i = 0; i < nativeStartIndex; i++) {
  try {
    const file = path.join(BASE, moduleList[i]);
    let input = fs.readFileSync(file, "utf8");

    if (!/\bexport\s+(?:function|class|const|default|{)/.test(input)) {
      if (input.includes("module.exports")) {
        throw new Error(
          "Do not use CommonJS module.exports in ESM modules. Use `export default { ... }` instead. See src/js/README.md",
        );
      } else {
        throw new Error(
          `Internal modules must have at least one ESM export statement in '${path.relative(bunRepoRoot, file)}' — see src/js/README.md`,
        );
      }
    }

    // TODO: there is no reason this cannot be converted automatically.
    // import { ... } from '...' -> `const { ... } = require('...')`
    const scannedImports = scanImportsExports(input);
    for (const imp of scannedImports.imports) {
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
          err["fileName"] = moduleList[i];
          throw err;
        }
      }
    }

    if (scannedImports.exports.includes("default") && scannedImports.exports.length > 1) {
      const err = new Error(
        `Using \`export default\` AND named exports together in builtin modules is unsupported. See src/js/README.md (from ${moduleList[i]})`,
      );
      err.name = "BunError";
      err["fileName"] = moduleList[i];
      throw err;
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
// Leading \`export {}\`: these bodies can reference \`exports\`/\`module\` as plain
// locals; without an unambiguous ESM marker esbuild guesses CommonJS and
// wraps the file in __commonJS(), which the JSC builtin parser rejects.
export {};
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

const modulesResult = await esbuild.build({
  entryPoints: bundledEntryPoints,
  absWorkingDir: process.cwd(),
  outbase: TMP_DIR,
  outdir: path.join(TMP_DIR, "modules_out"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "esnext",
  // JSC's builtin loader asserts `view.is8Bit()` — the source must be
  // Latin-1, so escape everything outside ASCII.
  charset: "ascii",
  // Syntax minification is on in both debug and release: the $bundleError
  // checks below depend on dead-branch elimination after the define
  // substitutions, which esbuild only folds with minifySyntax on.
  minifySyntax: true,
  keepNames: true,
  external: builtinModules.flatMap(x => [x, "node:" + x]),
  legalComments: "none",
  define: {
    ...define,
    IS_BUN_DEVELOPMENT: String(!!debug),
    __intrinsic__debug: debug ? "$debug_log_enabled" : "false",
  },
  supported: { "using": false },
  logLevel: "warning",
  write: true,
});
if (modulesResult.errors.length) {
  for (const err of modulesResult.errors) console.error(err);
  process.exit(1);
}

mark("Bundle modules");

const outputs = new Map();

for (const entrypoint of bundledEntryPoints) {
  const file_path = entrypoint.slice(TMP_DIR.length + 1).replace(/\.ts$/, ".js");
  const output = fs
    .readFileSync(path.join(TMP_DIR, "modules_out", file_path), "utf8")
    .replace(/^(?:\/\/[^\n]*\n)+/, "")
    // esbuild's keepNames `__name` reads user-overridable Object.defineProperty
    // and trusts its return value as the binding; neutralize both.
    .replace(
      /var __name = .*;$/m,
      'var __name = (t, v) => { try { __defProp(t, "name", { __proto__: null, value: v, configurable: !0 }); } catch {} return t; };',
    );
  // Trailing newline before `})` is load-bearing: esbuild preserves `//!`
  // legal comments, and a `//!` on the final line would swallow the wrapper
  // close.
  let captured = `(function (){${output.trim()}\n})`;
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
  // JSC's builtin loader asserts view.is8Bit(). esbuild's ascii charset covers
  // string literals but not comments, and 0x80-0xFF is multi-byte UTF-8 on
  // disk -> loads as 16-bit; escape every non-ASCII codepoint.
  captured = captured.replace(/[^\x00-\x7F]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
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
  const leakedExport = captured.match(/^export\b.*/m);
  if (leakedExport) {
    throw new Error(
      `Builtin Bundler: ${file_path} contains a top-level \`${leakedExport[0].slice(0, 60)}\` after ` +
        `postprocessing; JSC rejects export inside the builtin function wrapper.`,
    );
  }
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
        const moduleName = idToPublicSpecifierOrEnumName(id);
        const fileBase = JSON.stringify(id.replace(/\.[mc]?[tj]s$/, ".js"));
        const urlString = "builtin://" + id.replace(/\.[mc]?[tj]s$/, "").replace(/[^a-zA-Z0-9]+/g, "/");
        const inner =
          n >= nativeStartIndex
            ? `return generateNativeModule(globalObject, vm, generateNativeModule_${nativeModuleEnums[id]});`
            : `INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, "${moduleName}"_s, ${fileBase}_s, InternalModuleRegistryConstants::${idToEnumName(id)}Code, "${urlString}"_s);`;
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

// This is a generated map for rust code (included by the `resolved_source_tag` module in
// src/jsc/lib.rs). Keys are the canonical builtin specifier strings fed to
// `ResolvedSourceTag::from_name`.
writeIfNotChanged(
  path.join(CODEGEN_DIR, "generated_resolved_source_tag.rs"),
  `// Generated by src/codegen/bundle-modules.ts — do not edit.
// Canonical builtin-module specifier -> InternalModuleRegistry tag (\`(1 << 9) | id\`),
// kept in lock-step with SyntheticModuleType.h.
bun_core::comptime_string_map! {
static INTERNAL_MODULE_TAG: ResolvedSourceTag = {
${moduleList
  .slice(0, nativeStartIndex)
  .flatMap((id, n) => {
    const name = idToPublicSpecifierOrEnumName(id);
    const entry = `    b"${name}" => ResolvedSourceTag(${(1 << 9) | n}),`;
    // Rust's HardcodedModule surfaces this module as its npm specifier, so alias it to the same tag.
    return name === "vercel_fetch" ? [entry, `    b"@vercel/fetch" => ResolvedSourceTag(${(1 << 9) | n}),`] : [entry];
  })
  .join("\n")}
    // Native modules come after the JS modules.
${Object.entries(nativeModuleEnumToId)
  .map(
    ([_id, n], i) =>
      `    b"${moduleList[nativeStartIndex + i]}" => ResolvedSourceTag(${(1 << 9) | (n + nativeStartIndex)}),`,
  )
  .join("\n")}
};
}
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
    .map(value => `#include "../../jsc/modules/${value}Module.h"`)
    .join("\n") + "\n",
);

writeIfNotChanged(path.join(CODEGEN_DIR, "GeneratedJS2Native.h"), getJS2NativeCPP());

// Rust sibling: include!()'d by src/runtime/generated_js2native.rs
writeIfNotChanged(path.join(CODEGEN_DIR, "generated_js2native.rs"), getJS2NativeRust());

const generatedDTSPath = path.join(CODEGEN_DIR, "generated.d.ts");
writeIfNotChanged(
  generatedDTSPath,
  (() => {
    let dts = `
// GENERATED TEMP FILE - DO NOT EDIT
// generated by ${import.meta.filename}

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
      dts += `\ndeclare function $inherits${name}(value: any): value is ${name};`;
    }

    return dts;
  })(),
);

mark("Generate Code");

const evalFiles = fs.globSync(path.join(BASE, "eval", "*.ts"));
for (const file of evalFiles) {
  const {
    outputFiles: [output],
  } = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    minify: !debug,
    platform: "node",
    format: "esm",
    target: "esnext",
    write: false,
    supported: { "using": false },
    define: {
      "process.platform": JSON.stringify(process.env.TARGET_PLATFORM ?? process.platform),
      "process.arch": JSON.stringify(process.env.TARGET_ARCH ?? process.arch),
    },
  });
  writeIfNotChanged(path.join(CODEGEN_DIR, "eval", path.basename(file)), output.text);
}

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

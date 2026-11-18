// This script is run when you change anything in src/js/*
//
// Documentation is in src/js/README.md
//
// The brief summary of how this works is that I (@paperclover) wrote an insane
// "JS lexer" using nothing but regular expressions. With lots of battle
// testing, this works on basically all input. For all content not inside of a
// string literal or comment, another set of regular expressions are performed
// on the value to do a few magic things.
//
// - Access to JSC's intrinsic syntax (`@foo()`) is done by just replacing all
//   $s with @s. This is great because in source code, TypeScript types can
//   model these relationships well. `@` is also how you refer to private slots
//   within objects. So you can do `{ $data: data }` to store what appears to
//   be an empty object to JS.
// - Auto-prefixing known global identifiers with `@`, `AbortSignal` -> `@AbortSignal`
//   to refer to the private slot.
// - Some magic macros (see replacements.ts) such as `$assert()` (which forcibly
//   deletes the argument in a release build, unlike a define macro), and the
//   magical `$cpp` and `$bindgen` bindgen stuff -- a story for another day.
//
// Part of the transpilation process involves removing type annotations. And
// that is done with Bun's bundler. But we need to construct an IIFE, and the
// bundler did not have an IIFE mode. Let's wrap the input around markers:
//
//   $$capture_start$$(() => { YOUR IIFE }).$$capture_end$$
//
// The bundler won't rename those unbound globals, and it can be nicely sliced
// back out by another regular expression.
//
// For builtin modules, those are converted from ES statements into a `return`
// statement, with a hoisted variable named `$`. The code is weirdly split in
// bundle-module.ts, but ever since the bindgen system was thrown together, the
// two processors had to share global compilation state.
//
// Since this experience in 2024, I've learned that some things that
// technically CAN be done, SHOULD NOT be done. Someone please rewrite this
// within Bun's bundler directly, or via a nice JS parse -> AST tool.
//
// All the sources are concatenated into one big string. For each function there
// is a row in a constant table and a generator that links it, so that nothing is
// made of a function before it is first used.
import assert from "assert";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { builtinFunctionFiles, builtinFunctionIds, firstBuiltinFunctionId } from "./builtin-function-ids";
import { sliceSourceCode } from "./builtin-parser";
import { createAssertClientJS, createLogClientJS } from "./client-js";
import { getJS2NativeDTS } from "./generate-js2native";
import { cap, checkAscii, low, writeIfNotChanged } from "./helpers";
import { beginGuardedBody, endGuardedBody, removableFeatures } from "./removable-entry-points.ts";
import {
  applyGlobalReplacements,
  assertNoDestructuredGlobalThis,
  assertNoStoredFunctionBehindComma,
  define,
} from "./replacements";

const PARALLEL = false;
const KEEP_TMP = true;

if (import.meta.main) {
  throw new Error("This script is not meant to be run directly");
}

const CMAKE_BUILD_ROOT = globalThis.CMAKE_BUILD_ROOT;
if (!CMAKE_BUILD_ROOT) {
  throw new Error("CMAKE_BUILD_ROOT is not defined");
}

const SRC_DIR = path.join(import.meta.dir, "../js/builtins");
const CODEGEN_DIR = path.join(CMAKE_BUILD_ROOT, "./codegen");
const TMP_DIR = path.join(CMAKE_BUILD_ROOT, "./tmp_functions");

interface ParsedBuiltin {
  name: string;
  params: string[];
  directives: Record<string, any>;
  source: string;
  async: boolean;
  enums: string[];
}

interface BundledBuiltin {
  name: string;
  directives: Record<string, any>;
  constructAbility: string;
  functionName: string;
  source: string;
  params: string[];
  visibility: string;
  sourceOffset: number;
}

/** The fields of `BuiltinSourceMetadata`. */
function builtinSourceMetadata(source: string): (number | boolean)[] {
  const isAsyncFunction = source.startsWith("(async function (");
  if (!isAsyncFunction && !source.startsWith("(function ("))
    throw new Error(
      `expected a built-in function to begin with "(function (" or "(async function (", but it begins with ${source.slice(0, 20)}`,
    );
  const parametersStart = "function (".length + (isAsyncFunction ? "async ".length : 0);
  let commas = 0;
  let insideCurlyBrackets = false;
  let sawOneParameter = false;
  let hasRestParameter = false;
  for (let i = parametersStart + 1; source[i] !== ")"; i++) {
    if (i >= source.length) throw new Error("the parameter list of a built-in function has no closing parenthesis");
    if (source[i] === "}") insideCurlyBrackets = false;
    else if (source[i] === "{" || insideCurlyBrackets) {
      insideCurlyBrackets = true;
      continue;
    } else if (source[i] === ",") commas++;
    else if (!" \t\v\f\xa0".includes(source[i]!)) sawOneParameter = true;
    if (source.startsWith("...", i)) {
      hasRestParameter = true;
      i += 2;
    }
  }
  const parameterCount = (commas ? commas + 1 : sawOneParameter ? 1 : 0) - (hasRestParameter ? 1 : 0);
  let isInStrictContext = false;
  for (let i = 0; i + 1 + "use strict".length < source.length && !isInStrictContext; i++)
    isInStrictContext = (source[i] === '"' || source[i] === "'") && source.startsWith("use strict", i + 1);
  const [end, isGenerator] = [source.lastIndexOf("}") + 1, false];
  return [parametersStart, parameterCount, end, isAsyncFunction, isGenerator, isInStrictContext];
}

/**
 * Source .ts file --> Array<bundled js function code>
 */
async function processFileSplit(filename: string): Promise<{ functions: BundledBuiltin[]; internal: boolean }> {
  const basename = path.basename(filename, ".ts");
  let contents = readFileSync(filename, "utf8");

  contents = applyGlobalReplacements(contents);
  const originalContents = contents;

  // first approach doesnt work perfectly because we actually need to split each function declaration
  // and then compile those separately

  const consumeWhitespace = /^\s*/;
  const consumeTopLevelContent =
    /^(\/\*|\/\/|type|import|interface|\$|const enum|export (?:async )?function|(?:async )?function)/;
  const consumeEndOfType = /;|.(?=export|type|interface|\$|\/\/|\/\*|function|const enum)/;

  const functions: ParsedBuiltin[] = [];
  let directives: Record<string, any> = {};
  const bundledFunctions: BundledBuiltin[] = [];
  let internal = false;
  const topLevelEnums: { name: string; code: string }[] = [];

  while (contents.length) {
    contents = contents.replace(consumeWhitespace, "");
    if (!contents.length) break;
    const match = contents.match(consumeTopLevelContent);
    if (!match) {
      const pos = originalContents.length - contents.length;
      let lineNumber = 1;
      let columnNumber = 1;
      let lineStartPos = 0;
      for (let i = 0; i < pos; i++) {
        if (originalContents[i] === "\n") {
          lineNumber++;
          columnNumber = 1;
          lineStartPos = i + 1;
        } else {
          columnNumber++;
        }
        if (i === pos) {
          break;
        }
      }
      const lineEndPos = lineStartPos + originalContents.slice(lineStartPos).indexOf("\n");
      throw new SyntaxError(
        "Could not process input:\n" +
          originalContents.slice(lineStartPos, lineEndPos) +
          "\n" +
          " ".repeat(pos - lineStartPos) +
          "^" +
          "\n    at " +
          filename +
          ":" +
          lineNumber +
          ":" +
          columnNumber,
      );
    }
    contents = contents.slice(match.index!);
    if (match[1] === "import") {
      // TODO: we may want to do stuff with these
      const i = contents.indexOf(";");
      contents = contents.slice(i + 1);
    } else if (match[1] === "/*") {
      const i = contents.indexOf("*/") + 2;
      internal ||= contents.slice(0, i).includes("@internal");
      contents = contents.slice(i);
    } else if (match[1] === "//") {
      const i = contents.indexOf("\n") + 1;
      internal ||= contents.slice(0, i).includes("@internal");
      contents = contents.slice(i);
    } else if (match[1] === "type" || match[1] === "export type") {
      const i = contents.search(consumeEndOfType);
      contents = contents.slice(i + 1);
    } else if (match[1] === "interface") {
      contents = sliceSourceCode(contents, false).rest;
    } else if (match[1] === "const enum") {
      const { result, rest } = sliceSourceCode(contents, false);
      const i = result.indexOf("{\n");
      // Support const enums in module scope.
      topLevelEnums.push({
        name: result.slice("const enum ".length, i).trim(),
        code: "\n" + result,
      });

      contents = rest;
    } else if (match[1] === "$") {
      const directive = contents.match(/^\$([a-zA-Z0-9]+)(?:\s*=\s*([^\r\n]+?))?\s*;?\r?\n/);
      if (!directive) {
        throw new SyntaxError("Could not parse directive:\n" + contents.slice(0, contents.indexOf("\n")));
      }
      const name = directive[1];
      let value;
      try {
        value = directive[2] ? JSON.parse(directive[2]) : true;
      } catch (error) {
        throw new SyntaxError("Could not parse directive value " + directive[2] + " (must be JSON parsable)");
      }
      if (name === "constructor") {
        directives.ConstructAbility = "CanConstruct";
      } else {
        directives[name] = value;
      }
      contents = contents.slice(directive[0].length);
    } else if (match[1] === "export function" || match[1] === "export async function") {
      // consume async token and function name
      const nameMatch = contents.match(/^export\s+(async\s+)?function\s([_a-zA-Z0-9]+)\s*/);
      if (!nameMatch)
        throw new SyntaxError("Could not parse function name:\n" + contents.slice(0, contents.indexOf("\n")));
      const async = Boolean(nameMatch[1]);
      const name = nameMatch[2];
      var remaining = contents.slice(nameMatch[0].length);

      // remove type parameters
      if (remaining.startsWith("<")) {
        var cursor = 1; // skip peeked '<'
        var depth = 1; // already entered first bracket pair
        for (; depth > 0 && cursor < remaining.length; cursor++) {
          switch (remaining[cursor]) {
            case "<":
              depth++;
              break;
            case ">":
              depth--;
              break;
          }
        }

        if (depth > 0) {
          throw new SyntaxError(
            `Function ${name} has an unclosed generic type. Missing ${depth} closing angle bracket(s).`,
          );
        }
        remaining = remaining.slice(cursor).trimStart();
      }

      // parse function parameters
      assert(
        remaining.startsWith("("),
        new SyntaxError(`Function ${name} is missing parameter list start. Found:\n\n\t${remaining.slice(0, 100)}`),
      );
      const paramMatch = remaining.match(/^\(([^)]*)\)(?:\s*:\s*([^{\n]+))?\s*{?/);
      if (!paramMatch)
        throw new SyntaxError(
          `Could not parse parameters for function ${name}:\n` + contents.slice(0, contents.indexOf("\n")),
        );
      const paramString = paramMatch[1];
      const params =
        paramString.trim().length === 0 ? [] : paramString.split(",").map(x => x.replace(/:.+$/, "").trim());
      if (params[0] === "this") {
        params.shift();
      }

      const { result, rest } = sliceSourceCode(remaining.slice(paramMatch[0].length - 1), true, x =>
        globalThis.requireTransformer(x, SRC_DIR + "/" + basename),
      );

      const source = result.trim().slice(2, -1);
      const constEnumsUsedInFunction: string[] = [];
      if (topLevelEnums.length) {
        // If the function references a top-level const enum let's add the code
        // to the top-level scope of the function so that the transpiler will
        // inline all the values and strip out the enum object.
        for (const { name, code } of topLevelEnums) {
          // Only include const enums which are referenced in the function source.
          if (source.includes(name)) {
            constEnumsUsedInFunction.push(code);
          }
        }
      }

      functions.push({
        name,
        params,
        directives,
        source,
        async,
        enums: constEnumsUsedInFunction,
      });
      contents = rest;
      directives = {};
    } else if (match[1] === "function" || match[1] === "async function") {
      const fnname = contents.match(/^function ([a-zA-Z0-9]+)\(([^)]*)\)(?:\s*:\s*([^{\n]+))?\s*{?/)![1];
      throw new SyntaxError("All top level functions must be exported: " + fnname);
    } else {
      throw new Error("TODO: parse " + match[1]);
    }
  }

  for (const fn of functions) {
    const tmpFile = path.join(TMP_DIR, `${basename}.${fn.name}.ts`);
    assertNoStoredFunctionBehindComma(fn.source, `${basename}.ts (${fn.name})`);

    // not sure if this optimization works properly in jsc builtins
    // const useThis = fn.usesThis;
    const useThis = true;

    // TODO: we should use format=IIFE so we could bundle imports and extra functions.
    writeFileSync(
      tmpFile,
      `// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ${path.relative(TMP_DIR, filename)}
${fn.enums.join("\n")}
// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(${fn.async ? "async " : ""}${
        useThis
          ? `function(${fn.params.join(",")})`
          : `${fn.params.length === 1 ? fn.params[0] : `(${fn.params.join(",")})`}=>`
      } {${fn.source}}).$$capture_end$$;
`,
    );
    await Bun.sleep(1);
    const build = await Bun.build({
      entrypoints: [tmpFile],
      define,
      target: "bun",
      minify: { syntax: true, whitespace: false, keepNames: true },
    });
    // TODO: Wait a few versions before removing this
    if (!build.success) {
      throw new AggregateError(build.logs, "Failed bundling builtin function " + fn.name + " from " + basename + ".ts");
    }
    if (build.outputs.length !== 1) {
      throw new Error("expected one output");
    }
    let output = (await build.outputs[0].text()).replaceAll("// @bun\n", "");
    assertNoDestructuredGlobalThis(output, `${basename}.ts (${fn.name})`);
    let usesDebug = output.includes("$debug_log");
    let usesAssert = output.includes("$assert");
    const captured = output.match(/\$\$capture_start\$\$([\s\S]+)\.\$\$capture_end\$\$/)![1];
    const finalReplacement =
      captured
        .replace(
          /function\s*\(.*?\)\s*{/,
          '$&"use strict";' +
            (usesDebug ? createLogClientJS("BUILTINS", fn.name) : "") +
            (usesAssert ? createAssertClientJS(fn.name) : ""),
        )
        .replace(/^\((async )?function\(/, "($1function (")
        .replace(/__intrinsic__/g, "@")
        .replace(/__no_intrinsic__/g, "") + "\n";

    const errors = [...finalReplacement.matchAll(/@bundleError\((.*)\)/g)];
    if (errors.length) {
      throw new Error(`Errors in ${basename}.ts:\n${errors.map(x => x[1]).join("\n")}`);
    }

    bundledFunctions.push({
      name: fn.name,
      directives: fn.directives,
      source: finalReplacement,
      params: fn.params,
      visibility: fn.directives.visibility ?? (fn.directives.linkTimeConstant ? "Private" : "Public"),
      constructAbility: fn.directives.ConstructAbility ?? "CannotConstruct",

      // Not known yet.
      sourceOffset: 0,

      functionName: fn.directives.getter ? `get ${fn.name}` : (fn.directives.overriddenName ?? fn.name),
    });
  }

  return {
    functions: bundledFunctions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    internal,
  };
}

const files: Array<{ basename: string; functions: BundledBuiltin[]; internal: boolean }> = [];
async function processFunctionFile(x: string) {
  const basename = path.basename(x, ".ts");
  try {
    files.push({
      basename,
      ...(await processFileSplit(x)),
    });
  } catch (error) {
    console.error("Failed to process file: " + basename + ".ts");
    console.error(error);
    process.exit(1);
  }
}

interface BundleBuiltinFunctionsArgs {
  requireTransformer: (x: string, filename: string) => string;
  /** Where WebCoreJSBuiltins.d.ts goes. */
  typesDir: string;
}

export async function bundleBuiltinFunctions({ requireTransformer, typesDir }: BundleBuiltinFunctionsArgs) {
  mkdirSync(TMP_DIR, { recursive: true });
  const filesToProcess = [...builtinFunctionFiles(SRC_DIR).values()];

  // Bun seems to crash if this is parallelized, :(
  if (PARALLEL) {
    await Promise.all(filesToProcess.map(processFunctionFile));
  } else {
    for (const x of filesToProcess) {
      await processFunctionFile(x);
    }
  }

  let combinedSourceCode = "";
  // Compute source offsets
  {
    for (const { basename, functions } of files) {
      for (const fn of functions) {
        checkAscii(fn.source);
        fn.sourceOffset = combinedSourceCode.length;
        combinedSourceCode += fn.source;

        // If you want to see the individual function sources:
        // if (true) {
        //   Bun.write(CODEGEN_DIR + "/functions/" + low(basename) + cap(fn.name) + ".js", fn.source + "\n");
        // }
      }
    }
  }

  const additionalPrivateNames = new Set(
    files.filter(file => file.internal).flatMap(file => file.functions.map(fn => fn.name)),
  );

  const ids = builtinFunctionIds(SRC_DIR);
  const idOf = (basename: string, name: string) => {
    const id = ids.get(`${basename}.ts\t${name}`);
    if (id === undefined) throw new Error(`${basename}.ts: no id was assigned to the built-in function ${name}`);
    return id;
  };
  files
    .flatMap(({ basename, functions }) => functions.map(fn => idOf(basename, fn.name)))
    .forEach((id, index) => {
      if (id !== firstBuiltinFunctionId + index)
        throw new Error("The built-in functions must follow each other in the combined text in the order of their ids");
    });

  const all = files.flatMap(({ basename, functions }) =>
    functions.map(fn => ({ ...fn, generator: `${low(basename)}${cap(fn.name)}CodeGenerator` })),
  );

  const bundledCPP = `// Generated by ${import.meta.path}
#include "root.h"
#include "WebCoreJSBuiltins.h"

// The builtin function sources are linked at the start of bun_internal_modules_data
// (see bundle-modules.ts / InternalModuleRegistryConstants.S).
extern "C" const char bun_internal_modules_data[];

extern "C" const char* Bun__textOfBuiltinFunctions()
{
    ${beginGuardedBody(removableFeatures(), "BuiltinSourceText", "ReturnDefault", "const char*")}
    return WTF::opaque(static_cast<const char*>(bun_internal_modules_data));
    ${endGuardedBody}
}

namespace WebCore {

struct BuiltinFunction {
    ASCIILiteral name;
    unsigned sourceOffset;
    JSC::BuiltinSourceMetadata metadata;
    JSC::ImplementationVisibility visibility;
    JSC::ConstructAbility constructAbility;
};

static constexpr BuiltinFunction builtinFunctions[] = {
${all
  .map(
    fn =>
      `    { "${fn.functionName}"_s, ${fn.sourceOffset}, { ${builtinSourceMetadata(fn.source).join(", ")} }, JSC::ImplementationVisibility::${fn.visibility}, JSC::ConstructAbility::${fn.constructAbility} },`,
  )
  .join("\n")}
};

static NEVER_INLINE JSC::BuiltinCode linkBuiltinFunction(JSC::VM& vm, unsigned index)
{
    auto& function = builtinFunctions[index];
    return JSC::linkStaticBuiltin(vm, Bun__textOfBuiltinFunctions() + function.sourceOffset, function.metadata, function.name, function.visibility, function.constructAbility);
}

${all.map((fn, index) => `JSC::BuiltinCode ${fn.generator}(JSC::VM& vm) { return linkBuiltinFunction(vm, ${index}); }`).join("\n")}

} // namespace WebCore
`;

  const bundledHeader = `// Generated by ${import.meta.path}
// Do not edit by hand.
#pragma once
#include "root.h"

namespace WebCore {

// Each call makes a new executable, for the functions of one realm.
${all.map(fn => `JSC::BuiltinCode ${fn.generator}(JSC::VM&);`).join("\n")}

} // namespace WebCore
`;

  // Handle builtin names
  let privateNames: string[];
  {
    const BunBuiltinNamesHeader = require("fs").readFileSync(
      path.join(import.meta.dir, "../js/builtins/BunBuiltinNames.h"),
      "utf8",
    );
    let definedBuiltinNamesStartI = BunBuiltinNamesHeader.indexOf(
      "#define BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME",
    );
    let definedBuiltinNamesMacroEndI = BunBuiltinNamesHeader.indexOf(
      "--- END of BUN_COMMON_PRIVATE_IDENTIFIERS_EACH_PROPERTY_NAME ---",
    );
    const definedBuiltinNames = BunBuiltinNamesHeader.slice(definedBuiltinNamesStartI, definedBuiltinNamesMacroEndI)
      .split("\n")
      .map(x => x.trim())
      .filter(x => x.startsWith("macro("))
      .map(x => x.slice(x.indexOf("(") + 1, x.indexOf(")")))
      .map(x => x.trim())
      .sort();

    const uniqueDefinedBuiltinNames = new Set();
    for (let name of definedBuiltinNames) {
      const prevSize = uniqueDefinedBuiltinNames.size;
      uniqueDefinedBuiltinNames.add(name);
      if (uniqueDefinedBuiltinNames.size === prevSize) {
        throw new Error(`Duplicate private name "${name}" in BunBuiltinNames.h`);
      }
    }
    for (let additionalPrivateName of additionalPrivateNames) {
      if (uniqueDefinedBuiltinNames.has(additionalPrivateName)) {
        additionalPrivateNames.delete(additionalPrivateName);
      }
    }

    let additionalPrivateNamesHeader = `// Generated by ${import.meta.path}
#pragma once

#ifndef BUN_ADDITIONAL_BUILTIN_NAMES
#define BUN_ADDITIONAL_BUILTIN_NAMES(macro) \\
  ${Array.from(additionalPrivateNames)
    .map(x => `macro(${x})`)
    .join(" \\\n  ")}
#endif
`;

    writeIfNotChanged(path.join(CODEGEN_DIR, "BunBuiltinNames+extras.h"), additionalPrivateNamesHeader);
    privateNames = [...definedBuiltinNames, ...additionalPrivateNames];
  }
  writeIfNotChanged(path.join(CODEGEN_DIR, "WebCoreJSBuiltins.h"), bundledHeader);
  writeIfNotChanged(path.join(CODEGEN_DIR, "WebCoreJSBuiltins.cpp"), bundledCPP);

  // Generate TS types
  let dts = `// Generated by \`bun src/js/builtins/codegen\`
    // Do not edit by hand.
    type RemoveThis<F> = F extends (this: infer T, ...args: infer A) => infer R ? (...args: A) => R : F;
    `;

  for (const { basename, functions, internal } of files) {
    if (internal) {
      dts += `\n// ${basename}.ts\n`;
      for (const fn of functions) {
        dts += `declare const \$${fn.name}: RemoveThis<typeof import("${path.relative(
          typesDir,
          path.join(SRC_DIR, basename),
        )}")[${JSON.stringify(fn.name)}]>;\n`;
      }
    }
  }

  dts += getJS2NativeDTS();

  writeIfNotChanged(path.join(typesDir, "WebCoreJSBuiltins.d.ts"), dts);

  const totalJSSize = files.reduce(
    (acc, { functions }) => acc + functions.reduce((acc, fn) => acc + fn.source.length, 0),
    0,
  );

  if (!KEEP_TMP) {
    await rmSync(TMP_DIR, { recursive: true });
  }

  globalThis.internalFunctionJSSize = totalJSSize;
  globalThis.internalFunctionCount = files.reduce((acc, { functions }) => acc + functions.length, 0);
  globalThis.internalFunctionFileCount = files.length;

  // bundle-modules.ts prepends this to InternalModuleRegistryConstants.bin so the
  // same linked blob carries both the builtin function sources and the internal
  // module sources. `privateNames` lists every private name registered by BunBuiltinNames.
  return { combinedSourceCode, privateNames };
}

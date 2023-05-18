import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { LoaderKeys } from "../../api/schema";

const MINIFY = process.argv.includes("--minify");

// This is a list of extra syntax replacements to do.
const replacements: Replacement[] = [
  { from: /\bthrow new TypeError\b/g, to: "$throwTypeError" },
  { from: /\bthrow new RangeError\b/g, to: "$throwRangeError" },
  { from: /\bthrow new OutOfMemoryError\b/g, to: "$throwOutOfMemoryError" },
  { from: /\bthrow notImplementedIssue\(([0-9]+),(.*?)\)/g, to: "$throwTypeError($1, $2)" },
];

// This is a list of globals we should access using @ notation
// undefined -> __intrinsic__undefined -> @undefined
const globalsToPrefix = [
  "AbortSignal",
  "Array",
  "Buffer",
  "Bun",
  "Infinity",
  "Loader",
  "Promise",
  "ReadableByteStreamController",
  "ReadableStream",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "TransformStream",
  "TransformStreamDefaultController",
  "Uint8Array",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
  "isNaN",
  "undefined",
];

// These enums map to $<enum>IdToLabel and $<enum>LabelToId
// Make sure to define in ./builtins.d.ts
const enums = {
  Loader: LoaderKeys,
  ImportKind: [
    "entry-point",
    "import-statement",
    "require-call",
    "dynamic-import",
    "require-resolve",
    "import-rule",
    "url-token",
    "internal",
  ],
};

// These identifiers have typedef but not present at runtime (converted with replacements)
// If they are present in the bundle after runtime, we warn at the user.
const warnOnIdentifiersNotPresentAtRuntime = ["OutOfMemoryError", "notImplementedIssue"];

type Replacement = string | { from: string | RegExp; to: string };

const SRC_DIR = path.join(import.meta.dir, "js");
const CPP_OUT_DIR = path.join(import.meta.dir);
const OUT_DIR = path.join(import.meta.dir, "out");
const TMP_DIR = path.join(import.meta.dir, "out/tmp");

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);
if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
mkdirSync(TMP_DIR);

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Applies source code replacements as defined in `replacements` */
function applyReplacements(src: string) {
  let result = src.replace(/\$([a-zA-Z0-9_]+)\b/gm, `__intrinsic__$1`);
  for (const replacement of replacements) {
    if (typeof replacement === "string") {
      result = result.replace(new RegExp("\\b" + escapeRegex(replacement) + "\\b", "g"), "__intrinsic__" + replacement);
    } else {
      result = result.replace(replacement.from, replacement.to.replaceAll("$", "__intrinsic__"));
    }
  }
  return result;
}

/** makes this into a valid c++ string literal */
function createCPPString(str: string) {
  return (
    '"' +
    str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/\?/g, "\\?") + // https://stackoverflow.com/questions/1234582
    '"'
  );
}

function cap(str: string) {
  return str[0].toUpperCase() + str.slice(1);
}

/**
 * Slices a string until it hits a }, but keeping in mind JS comments,
 * regex, template literals, comments, and matching {
 *
 * Used to extract function bodies without parsing the code.
 */
function sliceSourceCode(contents: string, replace: boolean): { result: string; rest: string } {
  let bracketCount = 0;
  let i = 0;
  let result = "";
  while (contents.length) {
    // TODO: template literal, regexp
    // these are important because our replacement logic would replace intrinsics
    // within these, when it should remain as the literal dollar.
    // but this isn't used in the codebase
    i = contents.match(/\/\*|\/\/|'|"|{|}/)?.index ?? contents.length;
    result += replace ? applyReplacements(contents.slice(0, i)) : contents.slice(0, i);
    contents = contents.slice(i);
    if (!contents.length) break;
    if (contents.startsWith("/*")) {
      i = contents.slice(2).indexOf("*/") + 2;
    } else if (contents.startsWith("//")) {
      i = contents.slice(2).indexOf("\n") + 1;
    } else if (contents.startsWith("'")) {
      i = contents.slice(1).match(/(?<!\\)'/)!.index! + 2;
    } else if (contents.startsWith('"')) {
      i = contents.slice(1).match(/(?<!\\)"/)!.index! + 2;
    } else if (contents.startsWith("`")) {
      // todo: edge case
      i = contents.slice(1).match(/(?<!\\)`/)!.index! + 2;
    } else if (contents.startsWith("{")) {
      bracketCount++;
      i = 1;
    } else if (contents.startsWith("}")) {
      bracketCount--;
      if (bracketCount === 0) {
        result += "}";
        contents = contents.slice(1);
        break;
      }
      i = 1;
    } else {
      throw new Error("TODO");
    }
    result += contents.slice(0, i);
    contents = contents.slice(i);
  }

  return { result, rest: contents };
}

/** Converts an enum object to --define arguments */

const define = {
  "process.env.NODE_ENV": "development",
  "process.platform": process.platform,
  "process.arch": process.arch,
};

for (const name in enums) {
  const value = enums[name];
  if (typeof value !== "object") throw new Error("Invalid enum object " + name + " defined in " + import.meta.file);
  if (typeof value === null) throw new Error("Invalid enum object " + name + " defined in " + import.meta.file);
  const keys = Array.isArray(value) ? value : Object.keys(value).filter(k => !k.match(/^[0-9]+$/));
  define[`__intrinsic__${name}IdToLabel`] = "[" + keys.map(k => `"${k}"`).join(", ") + "]";
  define[`__intrinsic__${name}LabelToId`] = "{" + keys.map(k => `"${k}": ${keys.indexOf(k)}`).join(", ") + "}";
}

for (const name of globalsToPrefix) {
  define[name] = "__intrinsic__" + name;
}

interface ParsedBuiltin {
  name: string;
  params: string[];
  directives: Record<string, any>;
  source: string;
}
interface BundledBuiltin {
  name: string;
  directives: Record<string, any>;
  source: string;
  params: string[];
}

/**
 * Source .ts file --> Array<bundled js function code>
 */
async function processFileSplit(filename: string): Promise<BundledBuiltin[]> {
  const basename = path.basename(filename, ".ts");
  let contents = await Bun.file(filename).text();

  // first approach doesnt work perfectly because we actually need to split each function declaration
  // and then compile those separately

  const consumeWhitespace = /^\s*/;
  const consumeTopLevelContent = /^(\/\*|\/\/|type|import|interface|\$|export function)/;

  const functions: ParsedBuiltin[] = [];
  let directives: Record<string, any> = {};
  const bundledFunctions: BundledBuiltin[] = [];

  while (contents.length) {
    contents = contents.replace(consumeWhitespace, "");
    if (!contents.length) break;
    const match = contents.match(consumeTopLevelContent);
    if (!match) {
      throw new SyntaxError("Could not process input:\n" + contents.slice(0, contents.indexOf("\n")));
    }
    contents = contents.slice(match.index!);
    if (match[1] === "import") {
      // TODO: we may want to do stuff with these
      const i = contents.indexOf(";");
      contents = contents.slice(i + 1);
    } else if (match[1] === "/*") {
      const i = contents.indexOf("*/") + 2;
      contents = contents.slice(i);
    } else if (match[1] === "//") {
      const i = contents.indexOf("\n") + 1;
      contents = contents.slice(i);
    } else if (match[1] === "type") {
      contents = sliceSourceCode(contents, false).rest;
    } else if (match[1] === "interface") {
      contents = sliceSourceCode(contents, false).rest;
    } else if (match[1] === "$") {
      const directive = contents.match(/^\$([a-zA-Z0-9]+)(?:\s*=\s*([^\n]+?))?\s*;?\n/);
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
      directives[name] = value;
      contents = contents.slice(directive[0].length);
    } else if (match[1] === "export function") {
      const declaration = contents.match(/^export function ([a-zA-Z0-9]+)\(([^)]*)\)(?:\s*:\s*([^{\n]+))?\s*{?/);
      if (!declaration)
        throw new SyntaxError("Could not parse function declaration:\n" + contents.slice(0, contents.indexOf("\n")));

      const name = declaration[1];
      const paramString = declaration[2];
      const params =
        paramString.trim().length === 0 ? [] : paramString.split(",").map(x => x.replace(/:.+$/, "").trim());
      if (params[0] === "this") {
        params.shift();
      }

      const { result, rest } = sliceSourceCode(contents.slice(declaration[0].length - 1), true);
      functions.push({
        name,
        params,
        directives,
        source: result.trim().slice(1, -1),
      });
      contents = rest;
      directives = {};
    } else {
      throw new Error("TODO: parse " + match[1]);
    }
  }

  for (const fn of functions) {
    const tmpFile = path.join(TMP_DIR, `${basename}.${fn.name}.ts`);
    // TODO: we should use format=IIFE so we could bundle imports and extra functions.
    await writeFileSync(
      tmpFile,
      `// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ${path.relative(TMP_DIR, filename)}

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(${fn.params.join(", ")}) {$UseStrict$();${fn.source}}).$$capture_end$$;
`,
    );
    const build = await Bun.build({
      entrypoints: [tmpFile],
      define,
      minify: MINIFY || {
        syntax: true,
      },
    });
    if (!build.success) {
      throw new AggregateError(build.logs, "Failed bundling builtin function " + fn.name + " from " + basename + ".ts");
    }
    if (build.outputs.length !== 1) {
      throw new Error("expected one output");
    }
    const output = await build.outputs[0].text();
    const captured = output.match(/\$\$capture_start\$\$([\s\S]+)\.\$\$capture_end\$\$/)![1];
    const finalReplacement = captured.replace(/\$UseStrict\$\(\)/, '"use strict"').replace(/__intrinsic__/g, "@");

    bundledFunctions.push({
      name: fn.name,
      directives: fn.directives,
      source: finalReplacement,
      params: fn.params,
    });

    // debug
    Bun.write(path.join(OUT_DIR, `${basename}.${fn.name}.js`), finalReplacement);
  }
  return bundledFunctions;
}

// const files = [
//   {
//     basename: "CountQueuingStrategy",
//     functions: await processFileSplit("js/CountQueuingStrategy.ts"),
//   },
//   {
//     basename: "ConsoleObject",
//     functions: await processFileSplit("js/ConsoleObject.ts"),
//   },
//   {
//     basename: "BundlerPlugin",
//     functions: await processFileSplit("js/BundlerPlugin.ts"),
//   },
// ];
const files = await Promise.all(
  readdirSync(SRC_DIR)
    .filter(x => x.endsWith(".ts"))
    .map(async x => {
      const basename = path.basename(x, ".ts");
      return {
        basename,
        functions: await processFileSplit(path.join(SRC_DIR, x)),
      };
    }),
);

console.log(files);

// C++ codegen
let cpp = `#include "config.h"
#include "WebCoreJSBuiltins.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/ImplementationVisibility.h>
#include <JavaScriptCore/Intrinsic.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/VM.h>

namespace WebCore {

`;

for (const { basename, functions } of files) {
  cpp += `/* ${basename}.ts */\n`;

  for (const fn of functions) {
    const name = `${basename}${fn.name}Code`;
    cpp += `// ${fn.name}
const JSC::ConstructAbility s_${name}ConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_${name}ConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_${name}ImplementationVisibility = JSC::ImplementationVisibility::Public;
const int s_${name}Length = ${fn.source.length};
static const JSC::Intrinsic s_${name}Intrinsic = JSC::NoIntrinsic;
const char* const s_${name} = ${createCPPString(fn.source)};

`;
  }
  cpp += `#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \\
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \\
{\\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \\
    return clientData->builtinFunctions().${basename}Builtins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().${basename}Builtins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \\
}
WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

`;
}

cpp += `
} // namespace WebCore
`;

// C++ Header codegen
let h = `#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
`;

for (const { basename, functions } of files) {
  h += `/* ${basename}.ts */\n`;

  for (const fn of functions) {
    const name = `${basename}${cap(fn.name)}Code`;
    h += `// ${fn.name}
#define WEBCORE_BUILTIN_${basename.toUpperCase()}_${fn.name.toUpperCase()} 1
extern const char* const s_${name};
extern const int s_${name}Length;
extern const JSC::ConstructAbility s_${name}ConstructAbility;
extern const JSC::ConstructorKind s_${name}ConstructorKind;
extern const JSC::ImplementationVisibility s_${name}ImplementationVisibility;

`;
  }
  h += `#define WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_DATA(macro) \\\n`;
  for (const fn of functions) {
    h += `    macro(${fn.name}, ${basename}${cap(fn.name)}, ${fn.params.length}) \\\n`;
  }
  h += "\n";
  h += `#define WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(macro) \\\n`;
  for (const fn of functions) {
    const name = `${basename}${cap(fn.name)}Code`;
    const displayName = fn.directives.getter
      ? `"get ${fn.name}"_s`
      : fn.directives.overriddenName
      ? `"${fn.directives.overriddenName}"_s`
      : "ASCIILiteral()";
    h += `    macro(${name}, ${fn.name}, ${displayName}, s_${name}Length) \\\n`;
  }
  h += "\n";
  h += `#define WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(macro) \\\n`;
  for (const fn of functions) {
    h += `    macro(${fn.name}) \\\n`;
  }
  h += `
#define DECLARE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \\
    JSC::FunctionExecutable* codeName##Generator(JSC::VM&);

WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DECLARE_BUILTIN_GENERATOR)
#undef DECLARE_BUILTIN_GENERATOR

class ${basename}BuiltinsWrapper : private JSC::WeakHandleOwner {
public:
    explicit ${basename}BuiltinsWrapper(JSC::VM& vm)
        : m_vm(vm)
        WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(INITIALIZE_BUILTIN_NAMES)
#define INITIALIZE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) , m_##name##Source(JSC::makeSource(StringImpl::createWithoutCopying(s_##name, length), { }))
        WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(INITIALIZE_BUILTIN_SOURCE_MEMBERS)
#undef INITIALIZE_BUILTIN_SOURCE_MEMBERS
    {
    }

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
    JSC::UnlinkedFunctionExecutable* name##Executable(); \
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \
    JSC::SourceCode m_##name##Source;\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \
inline JSC::UnlinkedFunctionExecutable* ${basename}BuiltinsWrapper::name##Executable() \
{\
    if (!m_##name##Executable) {\
        JSC::Identifier executableName = functionName##PublicName();\
        if (overriddenName)\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\
    }\
    return m_##name##Executable.get();\
}
WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ${basename}BuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}
`;
}

h += `
} // namespace WebCore
`;

Bun.write(path.join(CPP_OUT_DIR, `WebCoreJSBuiltins.cpp`), cpp);
Bun.write(path.join(CPP_OUT_DIR, `WebCoreJSBuiltins.h`), h);

const totalJSSize = files.reduce(
  (acc, { functions }) => acc + functions.reduce((acc, fn) => acc + fn.source.length, 0),
  0,
);
console.log("Generated builtins");
console.log(
  `Embedded JS size: ${totalJSSize} bytes across ${files.reduce(
    (acc, { functions }) => acc + functions.length,
    0,
  )} functions`,
);
console.log(`[${performance.now().toFixed(1)}ms]`);

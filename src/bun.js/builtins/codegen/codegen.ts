import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { sliceSourceCode } from "./builtin-parser";
import { applyGlobalReplacements, enums, globalsToPrefix } from "./replacements";
import { cap, fmtCPPString, low } from "./helpers";

console.log("Bundling Bun builtins...");

const MINIFY = process.argv.includes("--minify") || process.argv.includes("-m");
const PARALLEL = process.argv.includes("--parallel") || process.argv.includes("-p");

const SRC_DIR = path.join(import.meta.dir, "../js");
const CPP_OUT_DIR = path.join(import.meta.dir, "../");
const OUT_DIR = path.join(import.meta.dir, "../out");
const TMP_DIR = path.join(import.meta.dir, "../out/tmp");

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);
if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
mkdirSync(TMP_DIR);

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
  usesThis: boolean;
  async: boolean;
}
interface BundledBuiltin {
  name: string;
  directives: Record<string, any>;
  isGetter: boolean;
  isConstructor: boolean;
  isLinkTimeConstant: boolean;
  isNakedConstructor: boolean;
  intrinsic: string;
  overriddenName: string;
  source: string;
  params: string[];
  visibility: string;
}

/**
 * Source .ts file --> Array<bundled js function code>
 */
async function processFileSplit(filename: string): Promise<BundledBuiltin[]> {
  const basename = path.basename(filename, ".ts");
  let contents = await Bun.file(filename).text();

  contents = applyGlobalReplacements(contents);

  // first approach doesnt work perfectly because we actually need to split each function declaration
  // and then compile those separately

  const consumeWhitespace = /^\s*/;
  const consumeTopLevelContent = /^(\/\*|\/\/|type|import|interface|\$|export (?:async )?function|(?:async )?function)/;
  const consumeEndOfType = /;|.(?=export|type|interface|\$|\/\/|\/\*|function)/;

  const functions: ParsedBuiltin[] = [];
  let directives: Record<string, any> = {};
  const bundledFunctions: BundledBuiltin[] = [];
  let internal = false;

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
      if (name === "constructor") {
        throw new SyntaxError("$constructor not implemented");
      }
      if (name === "nakedConstructor") {
        throw new SyntaxError("$nakedConstructor not implemented");
      }
      directives[name] = value;
      contents = contents.slice(directive[0].length);
    } else if (match[1] === "export function" || match[1] === "export async function") {
      const declaration = contents.match(
        /^export\s+(async\s+)?function\s+([a-zA-Z0-9]+)\s*\(([^)]*)\)(?:\s*:\s*([^{\n]+))?\s*{?/,
      );
      if (!declaration)
        throw new SyntaxError("Could not parse function declaration:\n" + contents.slice(0, contents.indexOf("\n")));

      const async = !!declaration[1];
      const name = declaration[2];
      const paramString = declaration[3];
      const params =
        paramString.trim().length === 0 ? [] : paramString.split(",").map(x => x.replace(/:.+$/, "").trim());
      if (params[0] === "this") {
        params.shift();
      }

      const { result, rest, usesThis } = sliceSourceCode(contents.slice(declaration[0].length - 1), true);
      functions.push({
        name,
        params,
        directives,
        source: result.trim().slice(1, -1),
        usesThis,
        async,
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

    // not sure if this optimization works properly in jsc builtins
    // const useThis = fn.usesThis;
    const useThis = true;

    // TODO: we should use format=IIFE so we could bundle imports and extra functions.
    await Bun.write(
      tmpFile,
      `// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ${path.relative(TMP_DIR, filename)}

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(${fn.async ? "async " : ""}${
        useThis
          ? `function(${fn.params.join(",")})`
          : `${fn.params.length === 1 ? fn.params[0] : `(${fn.params.join(",")})`}=>`
      } {${useThis ? "$UseStrict$();" : ""}${fn.source}}).$$capture_end$$;
`,
    );
    await Bun.sleep(1);
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
      visibility: fn.directives.visibility ?? (fn.directives.linkTimeConstant ? "Private" : "Public"),
      isGetter: !!fn.directives.getter,
      isConstructor: !!fn.directives.constructor,
      isLinkTimeConstant: !!fn.directives.linkTimeConstant,
      isNakedConstructor: !!fn.directives.nakedConstructor,
      intrinsic: fn.directives.intrinsic ?? "NoIntrinsic",
      overriddenName: fn.directives.getter
        ? `"get ${fn.name}"_s`
        : fn.directives.overriddenName
        ? `"${fn.directives.overriddenName}"_s`
        : "ASCIILiteral()",
    });

    // debug
    await Bun.write(path.join(OUT_DIR, `${basename}.${fn.name}.js`), finalReplacement);
  }
  return bundledFunctions;
}

// const filesToProcess = readdirSync(SRC_DIR).filter(x => x.endsWith(".ts"));
const filesToProcess = [
  "ByteLengthQueuingStrategy.ts",
  "BundlerPlugin.ts",
  "ConsoleObject.ts",
  "CountQueuingStrategy.ts",
  "ImportMetaObject.ts",
  "JSBufferConstructor.ts",
  "JSBufferPrototype.ts",
  "ProcessObjectInternals.ts",
  "ReadableByteStreamController.ts",
  "ReadableByteStreamInternals.ts",
];

const files: Array<{ basename: string; functions: BundledBuiltin[] }> = [];
async function processFile(x: string) {
  const basename = path.basename(x, ".ts");
  try {
    files.push({
      basename,
      functions: await processFileSplit(path.join(SRC_DIR, x)),
    });
  } catch (error) {
    console.error("Failed to process file: " + basename + ".ts");
    console.error(error);
    process.exit(1);
  }
}

// Bun seems to crash if this is parallelized, :(
if (PARALLEL) {
  await Promise.all(filesToProcess.map(processFile));
} else {
  for (const x of filesToProcess) {
    await processFile(x);
  }
}

// C++ codegen
let cpp = `#include "config.h"
`;

for (const { basename } of files) {
  cpp += `#include "${basename}Builtins.h"
`;
}

cpp += `#include "WebCoreJSClientData.h"
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/ImplementationVisibility.h>
#include <JavaScriptCore/Intrinsic.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/VM.h>

namespace WebCore {

`;

for (const { basename, functions } of files) {
  cpp += `/* ${basename}.ts */\n`;
  const lowerBasename = low(basename);

  for (const fn of functions) {
    const name = `${lowerBasename}${cap(fn.name)}Code`;
    cpp += `// ${fn.name}
const JSC::ConstructAbility s_${name}ConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_${name}ConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_${name}ImplementationVisibility = JSC::ImplementationVisibility::${fn.visibility};
const int s_${name}Length = ${fn.source.length};
static const JSC::Intrinsic s_${name}Intrinsic = JSC::NoIntrinsic;
const char* const s_${name} = ${fmtCPPString(fn.source)};

`;
  }
  cpp += `#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \\
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \\
{\\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \\
    return clientData->builtinFunctions().${lowerBasename}Builtins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().${lowerBasename}Builtins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \\
}
WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

`;
}

cpp += `
} // namespace WebCore
`;

// C++ Header codegen
for (const { basename, functions } of files) {
  let h = `#pragma once

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
/* ${basename}.ts */
`;
  const lowerBasename = low(basename);

  for (const fn of functions) {
    const name = `${lowerBasename}${cap(fn.name)}Code`;
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
    h += `    macro(${fn.name}, ${lowerBasename}${cap(fn.name)}, ${fn.params.length}) \\\n`;
  }
  h += "\n";
  h += `#define WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(macro) \\\n`;
  for (const fn of functions) {
    const name = `${lowerBasename}${cap(fn.name)}Code`;
    h += `    macro(${name}, ${fn.name}, ${fn.overriddenName}, s_${name}Length) \\\n`;
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

#define EXPOSE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \\
    JSC::UnlinkedFunctionExecutable* name##Executable(); \\
    const JSC::SourceCode& name##Source() const { return m_##name##Source; }
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(EXPOSE_BUILTIN_EXECUTABLES)
#undef EXPOSE_BUILTIN_EXECUTABLES

    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_IDENTIFIER_ACCESSOR)

    void exportNames();

private:
    JSC::VM& m_vm;

    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_NAMES)

#define DECLARE_BUILTIN_SOURCE_MEMBERS(name, functionName, overriddenName, length) \\
    JSC::SourceCode m_##name##Source;\\
    JSC::Weak<JSC::UnlinkedFunctionExecutable> m_##name##Executable;
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS

};

#define DEFINE_BUILTIN_EXECUTABLES(name, functionName, overriddenName, length) \\
inline JSC::UnlinkedFunctionExecutable* ${basename}BuiltinsWrapper::name##Executable() \\
{\\
    if (!m_##name##Executable) {\\
        JSC::Identifier executableName = functionName##PublicName();\\
        if (overriddenName)\\
            executableName = JSC::Identifier::fromString(m_vm, overriddenName);\\
        m_##name##Executable = JSC::Weak<JSC::UnlinkedFunctionExecutable>(JSC::createBuiltinExecutable(m_vm, m_##name##Source, executableName, s_##name##ImplementationVisibility, s_##name##ConstructorKind, s_##name##ConstructAbility), this, &m_##name##Executable);\\
    }\\
    return m_##name##Executable.get();\\
}
WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DEFINE_BUILTIN_EXECUTABLES)
#undef DEFINE_BUILTIN_EXECUTABLES

inline void ${basename}BuiltinsWrapper::exportNames()
{
#define EXPORT_FUNCTION_NAME(name) m_vm.propertyNames->appendExternalName(name##PublicName(), name##PrivateName());
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(EXPORT_FUNCTION_NAME)
#undef EXPORT_FUNCTION_NAME
}

} // namespace WebCore
`;

  await Bun.write(path.join(CPP_OUT_DIR, "cpp", basename + `Builtins.h`), h);
}

await Bun.write(path.join(CPP_OUT_DIR, `NewBuiltinGenerator.cpp`), cpp);

const totalJSSize = files.reduce(
  (acc, { functions }) => acc + functions.reduce((acc, fn) => acc + fn.source.length, 0),
  0,
);
console.log(
  `Embedded JS size: ${totalJSSize} bytes (across ${files.reduce(
    (acc, { functions }) => acc + functions.length,
    0,
  )} functions, ${files.length} files)`,
);
console.log(`[${performance.now().toFixed(1)}ms]`);

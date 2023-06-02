import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { sliceSourceCode } from "./builtin-parser";
import { applyGlobalReplacements, enums, globalsToPrefix } from "./replacements";
import { cap, fmtCPPString, low } from "./helpers";

console.log("Bundling Bun builtins...");

const MINIFY = process.argv.includes("--minify") || process.argv.includes("-m");
const PARALLEL = process.argv.includes("--parallel") || process.argv.includes("-p");
const KEEP_TMP = process.argv.includes("--keep-tmp") || process.argv.includes("-k");

const SRC_DIR = path.join(import.meta.dir, "../");
const OUT_DIR = path.join(SRC_DIR, "../out");
const TMP_DIR = path.join(SRC_DIR, "../out/tmp");

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
async function processFileSplit(filename: string): Promise<{ functions: BundledBuiltin[]; internal: boolean }> {
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

      const { result, rest } = sliceSourceCode(contents.slice(declaration[0].length - 1), true);
      functions.push({
        name,
        params,
        directives,
        source: result.trim().slice(1, -1),
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
      } {${fn.source}}).$$capture_end$$;
`,
    );
    await Bun.sleep(1);
    const build = await Bun.build({
      entrypoints: [tmpFile],
      define,
      minify: true,
    });
    if (!build.success) {
      throw new AggregateError(build.logs, "Failed bundling builtin function " + fn.name + " from " + basename + ".ts");
    }
    if (build.outputs.length !== 1) {
      throw new Error("expected one output");
    }
    const output = await build.outputs[0].text();
    const captured = output.match(/\$\$capture_start\$\$([\s\S]+)\.\$\$capture_end\$\$/)![1];
    const finalReplacement =
      (fn.directives.sloppy ? captured : captured.replace(/function\s*\(.*?\)\s*{/, '$&"use strict";'))
        .replace(/^\((async )?function\(/, "($1function (")
        .replace(/__intrinsic__/g, "@") + "\n";

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
  }

  return {
    functions: bundledFunctions,
    internal,
  };
}

const filesToProcess = readdirSync(SRC_DIR).filter(x => x.endsWith(".ts") && !x.endsWith(".d.ts"));

const files: Array<{ basename: string; functions: BundledBuiltin[]; internal: boolean }> = [];
async function processFile(x: string) {
  const basename = path.basename(x, ".ts");
  try {
    files.push({
      basename,
      ...(await processFileSplit(path.join(SRC_DIR, x))),
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
let bundledCPP = `// Generated by \`bun src/js/builtins/codegen\`
// Do not edit by hand.
namespace Zig { class GlobalObject; }
#include "root.h"
#include "config.h"
#include "JSDOMGlobalObject.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/JSObjectInlines.h>

namespace WebCore {

`;

for (const { basename, functions } of files) {
  bundledCPP += `/* ${basename}.ts */\n`;
  const lowerBasename = low(basename);
  for (const fn of functions) {
    const name = `${lowerBasename}${cap(fn.name)}Code`;
    bundledCPP += `// ${fn.name}
const JSC::ConstructAbility s_${name}ConstructAbility = JSC::ConstructAbility::CannotConstruct;
const JSC::ConstructorKind s_${name}ConstructorKind = JSC::ConstructorKind::None;
const JSC::ImplementationVisibility s_${name}ImplementationVisibility = JSC::ImplementationVisibility::${fn.visibility};
const int s_${name}Length = ${fn.source.length};
static const JSC::Intrinsic s_${name}Intrinsic = JSC::NoIntrinsic;
const char* const s_${name} = ${fmtCPPString(fn.source)};

`;
  }
  bundledCPP += `#define DEFINE_BUILTIN_GENERATOR(codeName, functionName, overriddenName, argumentCount) \\
JSC::FunctionExecutable* codeName##Generator(JSC::VM& vm) \\
{\\
    JSVMClientData* clientData = static_cast<JSVMClientData*>(vm.clientData); \\
    return clientData->builtinFunctions().${lowerBasename}Builtins().codeName##Executable()->link(vm, nullptr, clientData->builtinFunctions().${lowerBasename}Builtins().codeName##Source(), std::nullopt, s_##codeName##Intrinsic); \\
}
WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(DEFINE_BUILTIN_GENERATOR)
#undef DEFINE_BUILTIN_GENERATOR

`;
}

bundledCPP += `

JSBuiltinInternalFunctions::JSBuiltinInternalFunctions(JSC::VM& vm)
    : m_vm(vm)
`;

for (const { basename, internal } of files) {
  if (internal) {
    bundledCPP += `    , m_${low(basename)}(vm)\n`;
  }
}

bundledCPP += `
{
    UNUSED_PARAM(vm);
}

template<typename Visitor>
void JSBuiltinInternalFunctions::visit(Visitor& visitor)
{
`;
for (const { basename, internal } of files) {
  if (internal) bundledCPP += `    m_${low(basename)}.visit(visitor);\n`;
}

bundledCPP += `
    UNUSED_PARAM(visitor);
}

template void JSBuiltinInternalFunctions::visit(AbstractSlotVisitor&);
template void JSBuiltinInternalFunctions::visit(SlotVisitor&);

SUPPRESS_ASAN void JSBuiltinInternalFunctions::initialize(Zig::GlobalObject& globalObject)
{
    UNUSED_PARAM(globalObject);
`;

for (const { basename, internal } of files) {
  if (internal) {
    bundledCPP += `    m_${low(basename)}.init(globalObject);\n`;
  }
}

bundledCPP += `
    JSVMClientData& clientData = *static_cast<JSVMClientData*>(m_vm.clientData);
    Zig::GlobalObject::GlobalPropertyInfo staticGlobals[] = {
`;

for (const { basename, internal } of files) {
  if (internal) {
    bundledCPP += `#define DECLARE_GLOBAL_STATIC(name) \\
    Zig::GlobalObject::GlobalPropertyInfo( \\
        clientData.builtinFunctions().${low(basename)}Builtins().name##PrivateName(), ${low(
      basename,
    )}().m_##name##Function.get() , JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly),
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(DECLARE_GLOBAL_STATIC)
  #undef DECLARE_GLOBAL_STATIC
  `;
  }
}

bundledCPP += `
    };
    globalObject.addStaticGlobals(staticGlobals, std::size(staticGlobals));
    UNUSED_PARAM(clientData);
}

} // namespace WebCore
`;

// C++ Header codegen
let bundledHeader = `// Generated by \`bun src/js/builtins/codegen\`
// Do not edit by hand.
#pragma once
namespace Zig { class GlobalObject; }
#include "root.h"
#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/WeakInlines.h>

namespace JSC {
class FunctionExecutable;
}

namespace WebCore {
`;
for (const { basename, functions, internal } of files) {
  bundledHeader += `/* ${basename}.ts */
`;
  const lowerBasename = low(basename);

  for (const fn of functions) {
    const name = `${lowerBasename}${cap(fn.name)}Code`;
    bundledHeader += `// ${fn.name}
#define WEBCORE_BUILTIN_${basename.toUpperCase()}_${fn.name.toUpperCase()} 1
extern const char* const s_${name};
extern const int s_${name}Length;
extern const JSC::ConstructAbility s_${name}ConstructAbility;
extern const JSC::ConstructorKind s_${name}ConstructorKind;
extern const JSC::ImplementationVisibility s_${name}ImplementationVisibility;

`;
  }
  bundledHeader += `#define WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_DATA(macro) \\\n`;
  for (const fn of functions) {
    bundledHeader += `    macro(${fn.name}, ${lowerBasename}${cap(fn.name)}, ${fn.params.length}) \\\n`;
  }
  bundledHeader += "\n";
  bundledHeader += `#define WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(macro) \\\n`;
  for (const fn of functions) {
    const name = `${lowerBasename}${cap(fn.name)}Code`;
    bundledHeader += `    macro(${name}, ${fn.name}, ${fn.overriddenName}, s_${name}Length) \\\n`;
  }
  bundledHeader += "\n";
  bundledHeader += `#define WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(macro) \\\n`;
  for (const fn of functions) {
    bundledHeader += `    macro(${fn.name}) \\\n`;
  }
  bundledHeader += `
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
`;

  if (internal) {
    bundledHeader += `class ${basename}BuiltinFunctions {
public:
    explicit ${basename}BuiltinFunctions(JSC::VM& vm) : m_vm(vm) { }

    void init(JSC::JSGlobalObject&);
    template<typename Visitor> void visit(Visitor&);

public:
    JSC::VM& m_vm;

#define DECLARE_BUILTIN_SOURCE_MEMBERS(functionName) \\
    JSC::WriteBarrier<JSC::JSFunction> m_##functionName##Function;
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(DECLARE_BUILTIN_SOURCE_MEMBERS)
#undef DECLARE_BUILTIN_SOURCE_MEMBERS
};

inline void ${basename}BuiltinFunctions::init(JSC::JSGlobalObject& globalObject)
{
#define EXPORT_FUNCTION(codeName, functionName, overriddenName, length) \\
    m_##functionName##Function.set(m_vm, &globalObject, JSC::JSFunction::create(m_vm, codeName##Generator(m_vm), &globalObject));
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_CODE(EXPORT_FUNCTION)
#undef EXPORT_FUNCTION
}

template<typename Visitor>
inline void ${basename}BuiltinFunctions::visit(Visitor& visitor)
{
#define VISIT_FUNCTION(name) visitor.append(m_##name##Function);
    WEBCORE_FOREACH_${basename.toUpperCase()}_BUILTIN_FUNCTION_NAME(VISIT_FUNCTION)
#undef VISIT_FUNCTION
}

template void ${basename}BuiltinFunctions::visit(JSC::AbstractSlotVisitor&);
template void ${basename}BuiltinFunctions::visit(JSC::SlotVisitor&);
    `;
  }
}
bundledHeader += `class JSBuiltinFunctions {
public:
    explicit JSBuiltinFunctions(JSC::VM& vm)
        : m_vm(vm)
`;

for (const { basename } of files) {
  bundledHeader += `        , m_${low(basename)}Builtins(m_vm)\n`;
}

bundledHeader += `
  {
`;

for (const { basename, internal } of files) {
  if (internal) {
    bundledHeader += `        m_${low(basename)}Builtins.exportNames();\n`;
  }
}

bundledHeader += `    }
`;

for (const { basename } of files) {
  bundledHeader += `    ${basename}BuiltinsWrapper& ${low(basename)}Builtins() { return m_${low(
    basename,
  )}Builtins; }\n`;
}

bundledHeader += `
private:
    JSC::VM& m_vm;
`;

for (const { basename } of files) {
  bundledHeader += `    ${basename}BuiltinsWrapper m_${low(basename)}Builtins;\n`;
}

bundledHeader += `;
};

class JSBuiltinInternalFunctions {
public:
    explicit JSBuiltinInternalFunctions(JSC::VM&);

    template<typename Visitor> void visit(Visitor&);
    void initialize(Zig::GlobalObject&);
`;

for (const { basename, internal } of files) {
  if (internal) {
    bundledHeader += `    ${basename}BuiltinFunctions& ${low(basename)}() { return m_${low(basename)}; }\n`;
  }
}

bundledHeader += `
private:
    JSC::VM& m_vm;
`;

for (const { basename, internal } of files) {
  if (internal) {
    bundledHeader += `    ${basename}BuiltinFunctions m_${low(basename)};\n`;
  }
}

bundledHeader += `
};

} // namespace WebCore
`;

await Bun.write(path.join(OUT_DIR, "WebCoreJSBuiltins.h"), bundledHeader);
await Bun.write(path.join(OUT_DIR, "WebCoreJSBuiltins.cpp"), bundledCPP);

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
        OUT_DIR,
        path.join(SRC_DIR, basename),
      )}")[${JSON.stringify(fn.name)}]>;\n`;
    }
  }
}

await Bun.write(path.join(OUT_DIR, "WebCoreJSBuiltins.d.ts"), dts);

const totalJSSize = files.reduce(
  (acc, { functions }) => acc + functions.reduce((acc, fn) => acc + fn.source.length, 0),
  0,
);

if (!KEEP_TMP) {
  await rmSync(TMP_DIR, { recursive: true });
}

console.log(
  `Embedded JS size: %s bytes (across %s functions, %s files)`,
  totalJSSize,
  files.reduce((acc, { functions }) => acc + functions.length, 0),
  files.length,
);
console.log(`[${performance.now().toFixed(1)}ms]`);

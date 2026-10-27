// Writes the table of built-ins of JavaScriptCore's ahead-of-time compiler, for the builds that link a JavaScriptCore
// with the compiler in it (emitBuiltinTable in scripts/build/deps/webkit.ts). Bun does not use the compiler, so this is
// the table of the programs that WebKit's own build links (jsc, testFFI): the engine's entries, and those of the host
// that stands in for Bun there.
//
// ./host is Source/JavaScriptCore/aot/tests/host of oven-sh/WebKit at WEBKIT_VERSION, unchanged. A release of WebKit has
// the generator and the engine's half, but not that folder.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeIfNotChanged } from "../helpers.ts";

const [webkit, out] = process.argv.slice(2);
if (webkit === undefined || out === undefined) throw new Error("usage: index.ts <prebuilt WebKit> <out>");

const aot = join(webkit, "Source", "JavaScriptCore", "aot");
const generator = (name: string) => import(join(aot, "builtins", "generator", name));
const { buildModel } = await generator("build-model.ts");
const { collectRuntimeFunctions } = await generator("collect-runtime-functions.ts");
const { Problems } = await generator("declarations.ts");
const { arraysHeader, emitEngineCode, engineDeclarationsName, engineFeaturesOf } = await generator("engine.ts");
const { parseEngineDeclarations } = await generator("engine-declarations.ts");
const { loadDeclarationFiles } = await generator("load-declaration-files.ts");
const { collectOwnProperties } = await generator("own-properties.ts");
const { loadSchema } = await import(join(aot, "ir", "generator", "load.ts"));

const engineFile = join(aot, "builtins", "generated", engineDeclarationsName);
const engine = parseEngineDeclarations(readFileSync(engineFile, "utf8"), engineFile);

// collectStandInHost() in the generator's engine.ts, which finds the files through a list that is not in a release.
const host = join(import.meta.dirname, "host");
const problems = new Problems();
const declarationFiles = readdirSync(host)
  .filter(name => name.endsWith(".builtins.ts"))
  .sort()
  .map(name => join(host, name));
const declared = [
  ...(await loadDeclarationFiles(declarationFiles, "Host", host)),
  ...collectOwnProperties(host, "own-properties.txt", problems),
];
const functions = collectRuntimeFunctions(
  { javaScriptCore: null, declared: [...engine.declarations, ...declared], frontEndFunctions: [] },
  problems,
);
problems.throwIfAny();

const schema = loadSchema(join(aot, "ir", "AOTSchema.def"));
const features = engineFeaturesOf(engine.declarations);
const model = buildModel({
  declarations: [...engine.declarations, ...declared, ...functions],
  schema,
  features,
  engineFiles: engine.engineFiles,
  syntaxUses: null,
});
const table: Map<string, string> = emitEngineCode(model, schema, features).table;

// The release has the header of the table that its own programs were linked with.
const shipped = readFileSync(join(webkit, "include", "JavaScriptCore", arraysHeader), "utf8");
if (table.get(arraysHeader)?.trim() !== shipped.trim()) {
  throw new Error(
    `${host} is not the stand-in host of this WebKit. Copy Source/JavaScriptCore/aot/tests/host of oven-sh/WebKit at WEBKIT_VERSION over it.`,
  );
}
table.delete(arraysHeader);

// Bun compiles the table beside its own sources, where a header of the engine is a header of a framework.
for (const [name, text] of table) {
  writeIfNotChanged(
    join(out, name),
    text
      .replace('#include "config.h"', '#include "root.h"')
      .replace(/^#include "(\w+\.h)"$/gm, (include, header) =>
        header === "root.h" ? include : `#include <JavaScriptCore/${header}>`,
      ),
  );
}

// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/collect-runtime-functions.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/collect-runtime-functions.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/collect-runtime-functions.ts") =
  await import(engineFile("builtins/generator/collect-runtime-functions.ts"));

export const {
  collectRuntimeFunctions,
  declarationOf,
  engineBuiltinSources,
  engineFunctions,
  exportedFunctionsOf,
  exportedNameOf,
  findExportedFunctions,
  functionBounds,
  keyOf,
  sourceOf,
} = engineModule;

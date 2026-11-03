// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/engine.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/engine.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/engine.ts") =
  await import(engineFile("builtins/generator/engine.ts"));

export const {
  arraysHeader,
  collectEngine,
  emitEngineCode,
  engineDeclarationsName,
  engineFeaturesOf,
  generateForEngine,
} = engineModule;

// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/emit-cpp-bindings.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-cpp-bindings.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-cpp-bindings.ts") =
  await import(engineFile("builtins/generator/emit-cpp-bindings.ts"));

export const { emitEngineBindings, emitHostBindings } = engineModule;

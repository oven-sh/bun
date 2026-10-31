// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/engine-declarations.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/engine-declarations.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/engine-declarations.ts") =
  await import(engineFile("builtins/generator/engine-declarations.ts"));

export const { parseEngineDeclarations, serializeEngineDeclarations } = engineModule;

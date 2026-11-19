// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/build-model.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-model.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-model.ts") =
  await import(engineFile("builtins/generator/build-model.ts"));

export const { buildModel } = engineModule;

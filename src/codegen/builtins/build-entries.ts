// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/build-entries.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-entries.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-entries.ts") =
  await import(engineFile("builtins/generator/build-entries.ts"));

export const { buildClasses, buildEntries, buildFunctions, buildLayouts, isObjectKind, resolveOwnSlot } = engineModule;
export const ModelBuilder = engineModule.ModelBuilder;
export type ModelBuilder = InstanceType<typeof engineModule.ModelBuilder>;

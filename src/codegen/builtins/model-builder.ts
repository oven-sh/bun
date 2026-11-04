// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/model-builder.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/model-builder.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/model-builder.ts") =
  await import(engineFile("builtins/generator/model-builder.ts"));

export const { addFlag, defaultMutabilityOf, functionPrototypePath, isObjectKind, keyOfFunction, linkTo } =
  engineModule;
export const ModelBuilder = engineModule.ModelBuilder;
export type ModelBuilder = InstanceType<typeof engineModule.ModelBuilder>;

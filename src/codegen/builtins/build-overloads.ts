// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/build-overloads.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-overloads.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-overloads.ts") =
  await import(engineFile("builtins/generator/build-overloads.ts"));

export const {
  applyUses,
  buildOverloads,
  buildParameter,
  deriveHeaps,
  deriveUsesOfResult,
  mayRefuseValueBeforeConversion,
  resolveImplementation,
  typeOfPropertyWithoutWrittenType,
} = engineModule;
export const OverloadContext = engineModule.OverloadContext;
export type OverloadContext = InstanceType<typeof engineModule.OverloadContext>;

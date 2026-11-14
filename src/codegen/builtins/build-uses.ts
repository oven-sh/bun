// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/build-uses.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-uses.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/build-uses.ts") =
  await import(engineFile("builtins/generator/build-uses.ts"));

export const { applyUses, applyWrittenUses, deriveHeaps, deriveUsesOfResult } = engineModule;
export const OverloadContext = engineModule.OverloadContext;
export type OverloadContext = InstanceType<typeof engineModule.OverloadContext>;

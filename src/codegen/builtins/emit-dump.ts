// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/emit-dump.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-dump.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-dump.ts") =
  await import(engineFile("builtins/generator/emit-dump.ts"));

export const { dumpOf, dumpOverload, dumpType } = engineModule;

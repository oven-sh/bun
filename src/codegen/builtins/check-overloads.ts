// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/check-overloads.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-overloads.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-overloads.ts") =
  await import(engineFile("builtins/generator/check-overloads.ts"));

export const { checkOverloads, checkResultLayouts, describeOverload, kindVectors, leavesOf } = engineModule;

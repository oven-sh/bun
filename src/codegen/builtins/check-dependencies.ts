// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/check-dependencies.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-dependencies.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-dependencies.ts") =
  await import(engineFile("builtins/generator/check-dependencies.ts"));

export const { checkDependencies, describeUndescribedResults, summarizeUndescribedResults } = engineModule;

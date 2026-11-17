// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/collect-static-tables.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/collect-static-tables.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/collect-static-tables.ts") =
  await import(engineFile("builtins/generator/collect-static-tables.ts"));

export const { collectStaticTables, parseHashTable } = engineModule;

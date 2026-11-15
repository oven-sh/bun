// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/check-direct-entries.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-direct-entries.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-direct-entries.ts") =
  await import(engineFile("builtins/generator/check-direct-entries.ts"));

export const { checkDirectEntries } = engineModule;

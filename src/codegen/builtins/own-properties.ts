// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/own-properties.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/own-properties.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/own-properties.ts") =
  await import(engineFile("builtins/generator/own-properties.ts"));

export const { collectOwnProperties, formatAttributes, formatOwnProperties, isListableName, parseOwnProperties } =
  engineModule;

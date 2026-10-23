// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/check-operand-types.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-operand-types.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-operand-types.ts") =
  await import(engineFile("builtins/generator/check-operand-types.ts"));

export const { checkOperandTypes } = engineModule;

// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/check.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check.ts") =
  await import(engineFile("builtins/generator/check.ts"));

export const { checkFieldsHoldingOnlyWhatIsStored, checkModel, checkMutability, checkSchemaWords } = engineModule;

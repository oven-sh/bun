// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/check-host-uses.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-host-uses.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-host-uses.ts") =
  await import(engineFile("builtins/generator/check-host-uses.ts"));

export const { checkHostUses, checkNamesReadByNativeCode } = engineModule;

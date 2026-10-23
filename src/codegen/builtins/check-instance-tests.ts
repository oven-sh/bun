// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/check-instance-tests.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-instance-tests.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/check-instance-tests.ts") =
  await import(engineFile("builtins/generator/check-instance-tests.ts"));

export const { checkInstanceTests } = engineModule;

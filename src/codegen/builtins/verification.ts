// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/verification.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/verification.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/verification.ts") =
  await import(engineFile("builtins/generator/verification.ts"));

export const { applyTextHashes, readVerifiedHashes, reportStaleEntries } = engineModule;

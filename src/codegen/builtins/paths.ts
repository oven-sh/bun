// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/paths.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/paths.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/paths.ts") =
  await import(engineFile("builtins/generator/paths.ts"));

export const {
  compareBytes,
  cppConstantOfName,
  globalThisPath,
  holderPathOf,
  isHiddenRootComponent,
  joinPath,
  memberPathOf,
  nativeFunctionsPath,
  parsePath,
  pathOfClassMember,
  pathOfNativeBinding,
  pathOfNativeFunction,
  qualifiedTokenOf,
  registeredSymbolPrefix,
  symbolPrefix,
  textOfPath,
  tokenOf,
} = engineModule;

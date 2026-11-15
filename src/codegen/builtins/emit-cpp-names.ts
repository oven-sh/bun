// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/emit-cpp-names.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-cpp-names.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-cpp-names.ts") =
  await import(engineFile("builtins/generator/emit-cpp-names.ts"));

export const {
  classTokensArray,
  classTokensType,
  emitCppNames,
  hashOfBuiltinTokens,
  nameArraysOf,
  namedBuiltinsOf,
  namedListsOf,
  slotTokenOf,
  textNameSlotsArray,
  textNamesArray,
} = engineModule;

// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/emit-rust-ids.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-rust-ids.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-rust-ids.ts") =
  await import(engineFile("builtins/generator/emit-rust-ids.ts"));

export const {
  capitalize,
  emitArray,
  emitCount,
  emitEnum,
  emitRustIds,
  emitSlice,
  fileHeader,
  formatBuiltinId,
  formatBuiltinName,
  formatByteString,
  formatClass,
  formatLinkTimeConstant,
  formatModule,
  formatOption,
  formatRuntimeFunction,
  formatString,
  formatStruct,
  formatWellKnownSymbol,
  sortByBytes,
  sortModules,
  sortStrictly,
  sortUniqueNumbers,
} = engineModule;

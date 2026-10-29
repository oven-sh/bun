// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/emit-rust-table.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-rust-table.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-rust-table.ts") =
  await import(engineFile("builtins/generator/emit-rust-table.ts"));

export const { emitRustTable } = engineModule;

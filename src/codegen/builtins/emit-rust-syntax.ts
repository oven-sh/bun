// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/emit-rust-syntax.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-rust-syntax.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/emit-rust-syntax.ts") =
  await import(engineFile("builtins/generator/emit-rust-syntax.ts"));

export const { emitRustSyntax } = engineModule;

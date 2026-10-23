// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/declarations.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/declarations.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/declarations.ts") =
  await import(engineFile("builtins/generator/declarations.ts"));

export const { leftOutOf, proofs, runtimeFunctionRoles, symbolsNaming } = engineModule;
export const DeclarationFile = engineModule.DeclarationFile;
export type DeclarationFile = InstanceType<typeof engineModule.DeclarationFile>;
export const GeneratorError = engineModule.GeneratorError;
export type GeneratorError = InstanceType<typeof engineModule.GeneratorError>;
export const Problems = engineModule.Problems;
export type Problems = InstanceType<typeof engineModule.Problems>;

// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/load-declaration-files.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/load-declaration-files.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/load-declaration-files.ts") =
  await import(engineFile("builtins/generator/load-declaration-files.ts"));

export const {
  engineDeclarationFiles,
  hostDeclarationFiles,
  libraryModuleName,
  loadDeclarationFiles,
  registerLibraryModule,
} = engineModule;

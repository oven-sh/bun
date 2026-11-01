// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/model.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/model.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/model.ts") =
  await import(engineFile("builtins/generator/model.ts"));

export const {
  builtinFlags,
  hostReadUses,
  implementationKinds,
  instanceTests,
  keyKinds,
  nameKinds,
  noHostNumber,
  overloadFlags,
  placeKinds,
  propertyActionKinds,
  prototypeLinks,
  targetArchitectures,
  typePartKinds,
} = engineModule;

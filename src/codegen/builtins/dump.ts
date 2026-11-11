// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/dump.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/dump.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/dump.ts") =
  await import(engineFile("builtins/generator/dump.ts"));

export const {
  builtinFlags,
  builtinKinds,
  callModes,
  callbackResultUses,
  callbackTimes,
  calleeKinds,
  canonicalTextOf,
  capabilities,
  contentsSlots,
  conversionProtocols,
  conversions,
  freshnesses,
  implementationKinds,
  instanceTests,
  integrityLevels,
  iterationKinds,
  mutabilities,
  needsDifferentialTest,
  operandRoles,
  operandUses,
  origins,
  parameterModes,
  primitives,
  pristineAspects,
  propertyActionKinds,
  protocolKeys,
  protocols,
  prototypeLinks,
  rangeRules,
  scopes,
  targetPlatforms,
  typedResultForms,
} = engineModule;

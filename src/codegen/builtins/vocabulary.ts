// The file is the engine's: Source/JavaScriptCore/aot/builtins/generator/vocabulary.ts. This one hands on what it exports.
import { engineFile } from "../engine-directory.ts";

export type * from "../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/vocabulary.ts";

const engineModule: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/builtins/generator/vocabulary.ts") =
  await import(engineFile("builtins/generator/vocabulary.ts"));

export const {
  builtinKinds,
  builtinMarks,
  callModes,
  callbackResultUses,
  callbackTimes,
  calleeKinds,
  capabilities,
  contentsSlots,
  conversionProtocols,
  conversions,
  conversionsFailingByValue,
  directValueTypes,
  directiveKinds,
  effectsOfHeapCapability,
  errorKinds,
  freshnesses,
  hostReadContexts,
  integrityLevels,
  intrinsicPositions,
  iterationKinds,
  iteratorRootClasses,
  maximumDirectParameterCount,
  mutabilities,
  namesProbedOnIterators,
  nativeCallKinds,
  operandRoles,
  operandUses,
  origins,
  parameterModes,
  primitives,
  pristineAspects,
  pristineTests,
  promiseStatuses,
  protocolKeys,
  protocols,
  protocolsProbedOnAnyObject,
  rangeRules,
  realmParameter,
  scopes,
  sharingModes,
  targetPlatforms,
  textsOfPrimitiveKeys,
  typedArrayTypes,
  typedResultForms,
} = engineModule;

import type { Schema } from "../aot-schema/load.ts";
import { lowerFirst } from "../aot-schema/names.ts";
import { GeneratorError } from "./declarations.ts";
import {
  capabilityEnumerators,
  emitArray,
  formatASCIILiteral,
  formatEnumerator,
  joinBlocks,
} from "./emit-cpp-support.ts";
import { fileHeader } from "./emit-rust-ids.ts";
import {
  builtinFlags,
  hostReadUses,
  implementationKinds,
  instanceTests,
  keyKinds,
  overloadFlags,
  placeKinds,
  propertyActionKinds,
  prototypeLinks,
  targetArchitectures,
  typePartKinds,
} from "./model.ts";
import {
  builtinKinds,
  callbackResultUses,
  callbackTimes,
  calleeKinds,
  callModes,
  capabilities,
  conversions,
  freshnesses,
  integrityLevels,
  iterationKinds,
  mutabilities,
  operandRoles,
  origins,
  parameterModes,
  primitives,
  pristineTests,
  rangeRules,
  scopes,
  targetPlatforms,
} from "./vocabulary.ts";

type Numbering = "Dense" | "Flags";

interface WordList {
  cppEnum: string;
  numbering: Numbering;
  words: readonly string[];
  enumerators: readonly string[];
}

function dense(cppEnum: string, words: readonly string[]): WordList {
  return { cppEnum, numbering: "Dense", words, enumerators: words };
}

function flags(cppEnum: string, words: readonly string[]): WordList {
  return { cppEnum, numbering: "Flags", words, enumerators: words };
}

function schemaWords(lists: ReadonlyMap<string, readonly string[]>, name: string): readonly string[] {
  const words = lists.get(name);
  if (words === undefined) throw new GeneratorError(`AOTSchema.def does not declare ${name}`);
  return words;
}

function collectWordLists(schema: Schema): WordList[] {
  return [
    dense("BuiltinKind", builtinKinds),
    dense("BuiltinCallMode", callModes),
    dense("BuiltinOrigin", origins),
    dense("BuiltinScope", scopes),
    dense("BuiltinMutability", mutabilities),
    dense("BuiltinConversion", conversions),
    dense("BuiltinParameterMode", parameterModes),
    dense("BuiltinFreshness", freshnesses),
    dense("BuiltinCallbackTimes", callbackTimes),
    dense("BuiltinCallbackResultUse", callbackResultUses),
    dense("BuiltinIntegrityLevel", integrityLevels),
    dense("BuiltinRangeRule", rangeRules),
    dense("BuiltinCallee", calleeKinds),
    { ...dense("BuiltinCapability", capabilities), enumerators: capabilities.map(word => capabilityEnumerators[word]) },
    dense("BuiltinTypePartKind", typePartKinds),
    dense("BuiltinPlaceKind", placeKinds),
    dense("BuiltinKeyKind", keyKinds),
    dense("BuiltinPropertyActionKind", propertyActionKinds),
    dense("BuiltinImplementationKind", implementationKinds),
    dense("BuiltinInstanceTest", instanceTests),
    dense("BuiltinPristineTest", pristineTests),
    dense("BuiltinPrototypeLink", prototypeLinks),
    dense("BuiltinHostReadUse", hostReadUses),
    dense("IterationKind", iterationKinds),
    dense("AbstractHeap", schema.heaps),
    dense("InlineBuiltin", [...schema.inlineBuiltins.keys()]),
    dense("ContentsSlot", schemaWords(schema.enums, "ContentsSlot")),
    dense("TypedResultForm", schemaWords(schema.enums, "TypedResultForm")),
    flags("BuiltinPlatform", targetPlatforms),
    flags("BuiltinArchitecture", targetArchitectures),
    flags("BuiltinPrimitive", primitives),
    flags("BuiltinOperandRole", operandRoles),
    flags("BuiltinFlag", builtinFlags),
    flags("BuiltinOverloadFlag", overloadFlags),
    flags("OperandUse", schemaWords(schema.flags, "OperandUse")),
    flags("Protocol", schemaWords(schema.flags, "Protocol")),
    flags("PristineAspects", schemaWords(schema.flags, "PristineAspects")),
  ];
}

function formatEnumeratorValue(numbering: Numbering, position: number): string {
  switch (numbering) {
    case "Dense":
      return String(position);
    case "Flags":
      return `1u << ${position}`;
  }
}

function emitWordList({ cppEnum, numbering, words, enumerators }: WordList): string {
  const array = emitArray(`inline constexpr ASCIILiteral ${lowerFirst(cppEnum)}Words`, words.map(formatASCIILiteral));
  const assertions = enumerators.map((enumerator, position) => {
    const value = `static_cast<unsigned>(${formatEnumerator(cppEnum, enumerator)})`;
    return `static_assert(${value} == ${formatEnumeratorValue(numbering, position)});`;
  });
  return [array, ...assertions].join("\n");
}

export function emitCppWords(schema: Schema): string {
  const blocks = [
    `${fileHeader}#pragma once`,
    "#if ENABLE(AOT)",
    '#include "AOTBuiltinTable.h"',
    "namespace JSC { namespace AOT {",
    ...collectWordLists(schema).map(emitWordList),
    "} } // namespace JSC::AOT",
    "#endif // ENABLE(AOT)",
  ];
  return `${joinBlocks(blocks)}\n`;
}

import type {
  DumpedCallback,
  DumpedClass,
  DumpedEntry,
  DumpedHandlerCall,
  DumpedImplementation,
  DumpedKey,
  DumpedLayout,
  DumpedOperand,
  DumpedOverload,
  DumpedParameter,
  DumpedPlace,
  DumpedPropertyAction,
  DumpedResult,
  DumpedSlot,
  DumpedTransfer,
  DumpedType,
  DumpedTypePart,
  TableDump,
} from "./dump.ts";
import { slotTokenOf } from "./emit-cpp-names.ts";
import {
  builtinFlags,
  type ModelBuiltin,
  type ModelCallback,
  type ModelClass,
  type ModelHandlerCall,
  type ModelImplementation,
  type ModelKey,
  type ModelLayout,
  type ModelName,
  type ModelOperand,
  type ModelOverload,
  type ModelParameter,
  type ModelPlace,
  type ModelPropertyAction,
  type ModelResult,
  type ModelSlot,
  type ModelTransfer,
  type ModelType,
  type ModelTypePart,
  type NameKind,
  type TableModel,
} from "./model.ts";
import { registeredSymbolPrefix, symbolPrefix } from "./paths.ts";
import {
  operandRoles,
  operandUses,
  primitives,
  pristineAspects,
  protocols,
  targetPlatforms,
  type Primitive,
} from "./vocabulary.ts";

const namePrefixes: Readonly<Record<NameKind, string>> = {
  Text: "",
  WellKnownSymbol: symbolPrefix,
  RegisteredSymbol: registeredSymbolPrefix,
};

function inListOrder<Word extends string>(list: readonly Word[], words: readonly Word[]): Word[] {
  return list.filter(word => words.includes(word));
}

function spellingOf(name: ModelName): string {
  return namePrefixes[name.kind] + name.text;
}

function tokenOrNull(item: { token: string } | null): string | null {
  return item === null ? null : item.token;
}

function dumpOperand(operand: ModelOperand): DumpedOperand {
  switch (operand.operand) {
    case "Receiver":
      return "this";
    case "Argument":
      return { argument: operand.index };
    case "ArgumentsFrom":
      return { argumentsFrom: operand.index };
  }
}

function dumpOptionalOperand(operand: ModelOperand | null): DumpedOperand | null {
  return operand === null ? null : dumpOperand(operand);
}

function dumpTypePart(part: ModelTypePart): DumpedTypePart {
  switch (part.part) {
    case "Instance":
      return {
        part: "Instance",
        class: part.class.token,
        pristine: inListOrder(pristineAspects, part.pristine),
        isOfClassItself: part.isOfClassItself,
        contents: part.contents.map(({ slot, type }) => ({ slot: slotTokenOf(slot), type: dumpType(type) })),
      };
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
      return { part: part.part };
    case "Layout":
      return { part: "Layout", layout: part.layout.token };
    case "Builtin":
      return { part: "Builtin", builtin: part.builtin.token };
    case "Operand":
    case "CallbackResult":
    case "Prototype":
      return { part: part.part, operand: dumpOperand(part.operand) };
    case "IteratedValues":
      return { part: part.part, operand: dumpOperand(part.operand), isSettled: part.isSettled };
    case "Slot":
      return { part: "Slot", operand: dumpOperand(part.operand), slot: slotTokenOf(part.slot) };
  }
}

function hasPrimitive(type: ModelType, primitive: Primitive): boolean {
  return type.primitives.includes(primitive) || (primitive === "Number" && type.integers !== null);
}

export function dumpType(type: ModelType): DumpedType {
  const { integers } = type;
  return {
    isAnything: type.isAnything,
    hasAnyObject: type.hasAnyObject,
    hasAnyFunction: type.hasAnyFunction,
    hasPlainData: type.hasPlainData,
    primitives: primitives.filter(primitive => hasPrimitive(type, primitive)),
    integers: integers === null ? null : { minimum: integers.minimum.value, maximum: integers.maximum.value },
    stringLiterals: type.stringLiterals.map(spellingOf),
    freshness: type.freshness,
    parts: type.parts.map(dumpTypePart),
  };
}

function dumpPlace(place: ModelPlace): DumpedPlace {
  switch (place.place) {
    case "None":
    case "Result":
    case "NativeMemory":
      return { place: place.place };
    case "Operand":
    case "OwnValues":
    case "Prototype":
      return { place: place.place, operand: dumpOperand(place.operand) };
    case "IteratedValues":
      return { place: place.place, operand: dumpOperand(place.operand), isSettled: place.isSettled };
    case "Slot":
      return { place: "Slot", operand: dumpOperand(place.operand), slot: slotTokenOf(place.slot) };
    case "ResultSlot":
      return { place: "ResultSlot", slot: slotTokenOf(place.slot) };
    case "ResultField":
      return { place: "ResultField", index: place.index, holdsOnlyWhatIsStored: place.holdsOnlyWhatIsStored };
    case "NewValue":
      return { place: "NewValue", type: dumpType(place.type) };
    case "Member":
      return {
        place: "Member",
        operand: dumpOperand(place.operand),
        path: place.path.map(step => (step === null ? null : spellingOf(step))),
        firstStep: place.firstStep,
      };
    case "NativeCell":
      return { place: "NativeCell", cell: place.cell.text };
  }
}

function dumpKey(key: ModelKey): DumpedKey {
  switch (key.key) {
    case "None":
    case "Any":
    case "Indexes":
      return { key: key.key };
    case "Operand":
    case "ElementsOf":
      return { key: key.key, operand: dumpOperand(key.operand) };
    case "Names":
      return { key: "Names", names: key.names.map(spellingOf) };
  }
}

function dumpTransfer(transfer: ModelTransfer): DumpedTransfer {
  return { from: dumpPlace(transfer.from), to: dumpPlace(transfer.to) };
}

function dumpHandlerCall(call: ModelHandlerCall): DumpedHandlerCall {
  return {
    callee: dumpPlace(call.callee),
    times: call.times,
    thisValue: dumpPlace(call.thisValue),
    arguments: call.arguments.map(dumpPlace),
    resultUse: call.resultUse,
  };
}

function dumpCallback(callback: ModelCallback): DumpedCallback {
  return {
    callee: dumpOperand(callback.callee),
    times: callback.times,
    constructs: callback.constructs,
    newTarget: dumpPlace(callback.newTarget),
    thisValue: dumpPlace(callback.thisValue),
    arguments: callback.arguments.map(dumpPlace),
    spreadArguments: dumpPlace(callback.spreadArguments),
    resultUse: callback.resultUse,
    resultTo: dumpPlace(callback.resultTo),
  };
}

function dumpPropertyAction(action: ModelPropertyAction): DumpedPropertyAction {
  return {
    action: action.action,
    object: dumpOperand(action.object),
    key: dumpKey(action.key),
    value: dumpPlace(action.value),
    integrityLevel: action.integrityLevel,
  };
}

function dumpParameter(parameter: ModelParameter): DumpedParameter {
  return {
    operand: dumpOperand(parameter.operand),
    mode: parameter.mode,
    accepted: dumpType(parameter.accepted),
    conversion: parameter.conversion,
    converted: dumpType(parameter.converted),
    refused: dumpType(parameter.refused),
    admitted: parameter.admitted === null ? null : dumpType(parameter.admitted),
    uses: inListOrder(operandUses, parameter.uses),
    roles: inListOrder(operandRoles, parameter.roles),
    protocols: inListOrder(protocols, parameter.protocols),
    namedMembers: parameter.namedMembers.map(spellingOf),
    calledMembers: parameter.calledMembers.map(spellingOf),
    convertedMembers: parameter.convertedMembers.map(spellingOf),
  };
}

function dumpResult(result: ModelResult): DumpedResult {
  const typesByPlatform = result.typesByPlatform.map(({ platform, type }) => ({ platform, type: dumpType(type) }));
  return {
    type: dumpType(result.type),
    typesByPlatform: typesByPlatform.length === 0 ? undefined : typesByPlatform,
    rangeRule: result.rangeRule,
    rangeOperand: dumpOptionalOperand(result.rangeOperand),
    substringOf: dumpOptionalOperand(result.substringOf),
    typedResultForm: result.typedResultForm,
    typedResultSource: dumpOptionalOperand(result.typedResultSource),
    iteratedOperand: dumpOptionalOperand(result.iteratedOperand),
    iterationKind: result.iterationKind,
    prototypeSource: dumpOptionalOperand(result.prototypeSource),
    properties: result.properties.map(({ name, type }) => ({ name: spellingOf(name), type: dumpType(type) })),
  };
}

function dumpImplementation(implementation: ModelImplementation): DumpedImplementation {
  const plain: DumpedImplementation = {
    how: implementation.how,
    otherwise: null,
    callee: "None",
    inlineBuiltin: null,
    maximumArgumentCount: null,
    function: null,
  };
  switch (implementation.how) {
    case "Generic":
    case "Number":
    case "Cell":
    case "CachedGetter":
    case "OwnSlot":
      return plain;
    case "HostCall":
      return { ...plain, callee: implementation.callee, function: implementation.function?.id ?? null };
    case "Compiled":
      return { ...plain, callee: implementation.callee, function: implementation.function.id };
    case "Inline": {
      const { otherwise } = implementation;
      const called = otherwise === null ? plain : dumpImplementation(otherwise);
      return {
        how: "Inline",
        otherwise: otherwise === null ? null : otherwise.how,
        callee: called.callee,
        inlineBuiltin: implementation.builtin,
        maximumArgumentCount: implementation.maximumArgumentCount,
        function: called.function,
      };
    }
  }
}

export function dumpOverload(overload: ModelOverload): DumpedOverload {
  const { flags, receiver, effects, flow, code } = overload;
  return {
    token: `${overload.builtin.token}/${overload.indexInBuiltin}`,
    path: overload.builtin.text,
    mode: overload.mode,
    isProvenByConstruction: flags.includes("IsProvenByConstruction"),
    isUndeclared: flags.includes("IsUndeclared"),
    textHash: overload.textHash,
    receiver: receiver === null ? null : dumpParameter(receiver),
    parameters: overload.parameters.map(dumpParameter),
    result: dumpResult(overload.result),
    capability: effects.capability,
    throws: flags.includes("Throws"),
    onlyPropagatesErrors: flags.includes("OnlyPropagatesErrors"),
    runsOnlyOperandCode: flags.includes("RunsOnlyOperandCode"),
    readsStateBeforeConversions: flags.includes("ReadsStateBeforeConversions"),
    isSpecialCase: flags.includes("IsSpecialCase"),
    ...(flags.includes("ResultIsDeclaredOnly") ? { resultIsDeclaredOnly: true as const } : {}),
    reads: [...effects.reads],
    writes: [...effects.writes],
    transfers: flow.transfers.map(dumpTransfer),
    callbacks: flow.callbacks.map(dumpCallback),
    propertyActions: flow.propertyActions.map(dumpPropertyAction),
    handlerCalls: flow.handlerCalls.map(dumpHandlerCall),
    implementation: dumpImplementation(code.implementation),
    model: code.model === null ? null : code.model.id,
  };
}

function dumpEntry(builtin: ModelBuiltin): DumpedEntry {
  const { prototype } = builtin;
  return {
    id: builtin.id,
    token: builtin.token,
    path: builtin.text,
    kind: builtin.kind,
    origin: builtin.origin,
    scope: builtin.scope,
    mutability: builtin.mutability,
    platforms: inListOrder(targetPlatforms, builtin.platforms),
    flags: inListOrder(builtinFlags, builtin.flags),
    holder: tokenOrNull(builtin.holder),
    name: builtin.name.text,
    isSymbolName: builtin.name.kind !== "Text",
    prototypeLink: prototype.link,
    inheritsFrom: prototype.link === "Builtin" ? prototype.builtin.token : null,
    instanceClass: tokenOrNull(builtin.instanceClass),
    sameObjectAs: tokenOrNull(builtin.sameObjectAs),
    overloads: builtin.overloads.map(dumpOverload),
  };
}

function dumpSlot(slot: ModelSlot): DumpedSlot {
  return {
    token: slotTokenOf(slot),
    name: slot.name.text,
    owner: slot.owner.token,
    heap: slot.heap,
    contentsSlot: slot.contentsSlot,
    holds: slot.holds === null ? null : dumpType(slot.holds),
  };
}

function dumpClass(builtinClass: ModelClass): DumpedClass {
  return {
    token: builtinClass.token,
    origin: builtinClass.origin,
    parent: tokenOrNull(builtinClass.parent),
    constructor: tokenOrNull(builtinClass.constructor),
    prototype: tokenOrNull(builtinClass.prototype),
    instanceTest: builtinClass.instanceTest,
    isPrimitiveWrapper: builtinClass.isPrimitiveWrapper,
    isNeverPristine: builtinClass.isNeverPristine,
    pristineTest: builtinClass.pristineTest,
    hasClosureInstances: builtinClass.hasClosureInstances,
    definesCharactersOnNewInstances: builtinClass.definesCharactersOnNewInstances,
    namesDefinedOnNewInstances:
      builtinClass.namesDefinedOnNewInstances?.toSorted((left, right) => left.number - right.number).map(spellingOf) ??
      null,
    slots: builtinClass.slots.map(dumpSlot),
    stateHeap: builtinClass.stateHeap,
  };
}

function dumpLayout(layout: ModelLayout): DumpedLayout {
  return {
    token: layout.token,
    isTuple: layout.isTuple,
    fields: layout.fields.map(field => ({
      name: field.name === null ? null : spellingOf(field.name),
      isOptional: field.isOptional,
      type: dumpType(field.type),
    })),
  };
}

export function dumpOf(model: TableModel): TableDump {
  return {
    entries: model.builtins.map(dumpEntry),
    classes: model.classes.map(dumpClass),
    layouts: model.layouts.map(dumpLayout),
  };
}

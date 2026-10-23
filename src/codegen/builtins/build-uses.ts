import type { ModelBuilder, WrittenSignature } from "./build-entries.ts";
import type { OperandScope, TypeInterner } from "./build-types.ts";
import type { SignatureDeclaration, Source } from "./declarations.ts";
import { isSameOperand } from "./dispatch.ts";
import { everything } from "./lib.ts";
import type {
  ModelBuiltin,
  ModelCallback,
  ModelClass,
  ModelEffects,
  ModelFunction,
  ModelHandlerCall,
  ModelKey,
  ModelLayout,
  ModelName,
  ModelOperand,
  ModelParameter,
  ModelPlace,
  ModelPropertyAction,
  ModelSlot,
  ModelTransfer,
  ModelType,
  ModelTypePart,
} from "./model.ts";
import {
  operandRoles,
  operandUses,
  protocols,
  type CallbackTimes,
  type CalleeKind,
  type HandlerSpec,
  type Heap,
  type KeySpec,
  type MemberPath,
  type OperandName,
  type OperandRole,
  type OperandUse,
  type PlaceSpec,
  type Protocol,
  type SlotName,
  type UseSpec,
} from "./vocabulary.ts";

type UseOf<Use extends UseSpec["use"]> = Extract<UseSpec, { use: Use }>;
type KeyedUse = UseOf<
  | "ReadsByKey"
  | "StoresByKey"
  | "DeletesByKey"
  | "TestsByKey"
  | "AssignsFrom"
  | "DefinesFrom"
  | "DefinesName"
  | "DefinesGetter"
  | "DefinesSetter"
  | "ReadsGetter"
  | "ReadsSetter"
  | "TakesDescriptor"
  | "TakesDescriptorMap"
  | "DescribesOwnProperties"
  | "DescribesResult"
>;
type ObjectStateUse = UseOf<"ChangesIntegrity" | "ChangesPrototype" | "BecomesPrototype">;
type OperandPart = Extract<
  ModelTypePart,
  { part: "Operand" | "Slot" | "IteratedValues" | "CallbackResult" | "Prototype" }
>;
type ContentsExtent = ModelSlot | "State" | "EverySlot" | "Properties";

export interface EntryContext {
  builder: ModelBuilder;
  types: TypeInterner;
  builtin: ModelBuiltin;
  hostCallee: CalleeKind;
  libraryFunction: ModelFunction | null;
}

interface ContentsAccess {
  readonly slots: Set<ModelSlot>;
  hasState: boolean;
  isEverySlot: boolean;
  hasProperties: boolean;
}

export interface OperandState {
  readonly parameter: ModelParameter;
  readonly uses: Set<OperandUse>;
  readonly roles: Set<OperandRole>;
  readonly protocols: Set<Protocol>;
  readonly protocolsOfContents: Set<Protocol>;
  readonly namedMembers: Set<ModelName>;
  readonly calledMembers: Set<ModelName>;
  readonly membersListedByEntry: Set<ModelName>;
  hasEveryMember: boolean;
  callsEveryMember: boolean;
  readsPrototypeLink: boolean;
  readonly reads: ContentsAccess;
  readonly writes: ContentsAccess;
}

const receiverOperand: ModelOperand = { operand: "Receiver" };
const descriptorMembers = ["value", "get", "set", "writable", "enumerable", "configurable"] as const;
const objectHeaps: readonly Heap[] = [
  "ObjectFields",
  "NamedProperties",
  "Elements",
  "ArrayStorage",
  "ShapeWords",
  "OrderWords",
];
// Some properties lie in the state of a class: the elements of a typed array under their indexes, the lastIndex of a regular expression. A store or a definition by key writes there.
const heapsBehindProperties: readonly Heap[] = ["TypedArrayElements", "RegExpState"];
// Where the classes keep what their instances hold. An operand that may be any object may be an instance of any of them. What a protocol
// reads of it the compiler knows by the type of the operand; what native code reads without one only the entry says.
const heapsOfContentsOfClasses: readonly Heap[] = [
  "TypedArrayStorage",
  "TypedArrayElements",
  "CollectionStorage",
  "CollectionEntries",
  "InternalFields",
  "RegExpState",
  "PromiseState",
  "ExternalState",
];
const prototypeHeap: Heap = "PrototypeLinks";
const noPlace: ModelPlace = { place: "None" };
const noKey: ModelKey = { key: "None" };
const resultPlace: ModelPlace = { place: "Result" };

const usesByCallbackTimes: Readonly<Record<CallbackTimes, readonly OperandUse[]>> = {
  Later: ["CallsRepeatedly", "Retains"],
  Repeatedly: ["CallsRepeatedly"],
  PerElement: ["CallsPerElement"],
  Once: [],
  PerEvent: ["CallsRepeatedly", "Retains"],
};

function keyOfOperand(operand: ModelOperand): string {
  switch (operand.operand) {
    case "Receiver":
      return operand.operand;
    case "Argument":
    case "ArgumentsFrom":
      return `${operand.operand} ${operand.index}`;
  }
}

function isSamePlace(left: ModelPlace, right: ModelPlace): boolean {
  switch (left.place) {
    case "None":
    case "Result":
    case "NativeMemory":
      return right.place === left.place;
    case "Operand":
    case "OwnValues":
    case "Prototype":
      return right.place === left.place && isSameOperand(left.operand, right.operand);
    case "IteratedValues":
      if (right.place !== left.place || left.isSettled !== right.isSettled) return false;
      return isSameOperand(left.operand, right.operand);
    case "Slot":
      return right.place === "Slot" && isSameOperand(left.operand, right.operand) && left.slot === right.slot;
    case "ResultSlot":
      return right.place === "ResultSlot" && left.slot === right.slot;
    case "ResultField":
      if (right.place !== "ResultField" || left.holdsOnlyWhatIsStored !== right.holdsOnlyWhatIsStored) return false;
      return left.index === right.index;
    case "NewValue":
      return right.place === "NewValue" && left.type === right.type;
    case "Member":
      return (
        right.place === "Member" && left.firstStep === right.firstStep && isSameOperand(left.operand, right.operand)
      );
    case "NativeCell":
      return right.place === "NativeCell" && left.cell === right.cell;
  }
}

function mayBeObjectOutsideClasses(type: ModelType): boolean {
  const hasObjectFlag = type.isAnything || type.hasAnyObject || type.hasAnyFunction || type.hasPlainData;
  return hasObjectFlag || type.parts.some(part => part.part !== "Instance");
}

const mayBeObject = (type: ModelType): boolean => mayBeObjectOutsideClasses(type) || type.parts.length > 0;

function instanceClassesOf(types: readonly ModelType[]): ModelClass[] {
  const classes = new Set<ModelClass>();
  for (const type of types) {
    for (const part of type.parts) if (part.part === "Instance") classes.add(part.class);
  }
  return [...classes];
}

function collectOperandParts(type: ModelType, visited: Set<ModelType>, found: OperandPart[]): void {
  if (visited.has(type)) return;
  visited.add(type);
  for (const part of type.parts) {
    switch (part.part) {
      case "Operand":
      case "Slot":
      case "IteratedValues":
      case "CallbackResult":
      case "Prototype":
        found.push(part);
        break;
      case "Instance":
        for (const contents of part.contents) collectOperandParts(contents.type, visited, found);
        break;
      case "InstanceOfReceiverClass":
      case "TypedArrayOfReceiverElementType":
      case "Layout":
      case "Builtin":
        break;
    }
  }
}

function operandPartsOf(type: ModelType): OperandPart[] {
  const found: OperandPart[] = [];
  collectOperandParts(type, new Set(), found);
  return found;
}

function placeOfPart(part: OperandPart): ModelPlace | null {
  switch (part.part) {
    case "Operand":
      return { place: "Operand", operand: part.operand };
    case "Slot":
      return { place: "Slot", operand: part.operand, slot: part.slot };
    case "IteratedValues":
      return { place: "IteratedValues", operand: part.operand, isSettled: part.isSettled };
    case "Prototype":
      return { place: "Prototype", operand: part.operand };
    case "CallbackResult":
      return null;
  }
}

const internNames = (builder: ModelBuilder, texts: readonly string[]): ModelName[] =>
  texts.map(text => builder.internComponent(text));

const createContentsAccess = (): ContentsAccess => ({
  slots: new Set(),
  hasState: false,
  isEverySlot: false,
  hasProperties: false,
});

function createOperandState(parameter: ModelParameter): OperandState {
  return {
    parameter,
    uses: new Set(parameter.uses),
    roles: new Set(parameter.roles),
    protocols: new Set(parameter.protocols),
    protocolsOfContents: new Set(),
    namedMembers: new Set(parameter.namedMembers),
    calledMembers: new Set(parameter.calledMembers),
    membersListedByEntry: new Set(),
    hasEveryMember: false,
    callsEveryMember: false,
    readsPrototypeLink: false,
    reads: createContentsAccess(),
    writes: createContentsAccess(),
  };
}

// One word says on which objects all protocols of an operand run.
function finishParameter(state: OperandState): ModelParameter {
  const uses = new Set(state.uses);
  if (state.protocolsOfContents.size > 0) {
    const runsOnOperand = state.protocols.size > 0 || uses.has("AppliesTransitively");
    uses.add(runsOnOperand ? "AppliesTransitively" : "AppliesToContents");
  }
  return {
    ...state.parameter,
    uses: operandUses.filter(use => uses.has(use)),
    roles: operandRoles.filter(role => state.roles.has(role)),
    protocols: protocols.filter(protocol => state.protocols.has(protocol) || state.protocolsOfContents.has(protocol)),
    namedMembers: state.hasEveryMember ? [] : [...state.namedMembers],
    calledMembers: state.callsEveryMember ? [] : [...state.calledMembers],
    convertedMembers: state.roles.has("FunctionsAreConvertedUnderNamesOnly") ? [...state.membersListedByEntry] : [],
  };
}

export class OverloadContext implements OperandScope {
  readonly builder: ModelBuilder;
  readonly types: TypeInterner;
  readonly builtin: ModelBuiltin;
  readonly hostCallee: CalleeKind;
  readonly libraryFunction: ModelFunction | null;
  readonly signature: SignatureDeclaration;
  readonly source: Source;
  readonly transfers: ModelTransfer[] = [];
  readonly callbacks: ModelCallback[] = [];
  readonly handlerCalls: ModelHandlerCall[] = [];
  readonly propertyActions: ModelPropertyAction[] = [];
  resultType: ModelType;
  readonly #operands = new Map<OperandName, ModelOperand>();
  readonly #states = new Map<string, OperandState>();

  constructor(entry: EntryContext, written: WrittenSignature) {
    this.builder = entry.builder;
    this.types = entry.types;
    this.builtin = entry.builtin;
    this.hostCallee = entry.hostCallee;
    this.libraryFunction = entry.libraryFunction;
    this.signature = written.signature;
    this.source = written.source;
    this.resultType = entry.types.never;
  }

  report(message: string): void {
    this.builder.problems.add(this.source, `${this.builtin.text}: ${message}`);
  }

  declare(parameter: ModelParameter): void {
    if (this.#operands.has(parameter.name)) this.report(`two operands are named ${parameter.name}`);
    else this.#operands.set(parameter.name, parameter.operand);
    this.#states.set(keyOfOperand(parameter.operand), createOperandState(parameter));
  }

  get states(): OperandState[] {
    return [...this.#states.values()];
  }

  get hasReceiver(): boolean {
    return this.stateOf(receiverOperand) !== undefined;
  }

  stateOf(operand: ModelOperand): OperandState | undefined {
    return this.#states.get(keyOfOperand(operand));
  }

  finishReceiver(): ModelParameter | null {
    const state = this.stateOf(receiverOperand);
    return state === undefined ? null : finishParameter(state);
  }

  finishParameters(): ModelParameter[] {
    return this.states.filter(state => state.parameter.operand.operand !== "Receiver").map(finishParameter);
  }

  operandOf(name: OperandName, source: Source): ModelOperand | null {
    const operand = this.#operands.get(name);
    if (operand !== undefined) return operand;
    const { mode } = this.signature;
    this.builder.problems.add(source, `${this.builtin.text}: this ${mode} signature has no operand named ${name}`);
    return null;
  }

  classesOf(operand: ModelOperand): readonly ModelClass[] {
    const state = this.stateOf(operand);
    return state === undefined ? [] : instanceClassesOf([state.parameter.accepted, state.parameter.converted]);
  }

  get resultClasses(): readonly ModelClass[] {
    const classes = new Set<ModelClass>();
    for (const part of this.resultType.parts) {
      switch (part.part) {
        case "Instance":
          classes.add(part.class);
          break;
        case "InstanceOfReceiverClass":
        case "TypedArrayOfReceiverElementType":
          for (const receiverClass of this.classesOf(receiverOperand)) classes.add(receiverClass);
          break;
        case "Layout":
        case "Builtin":
        case "Operand":
        case "Slot":
        case "IteratedValues":
        case "CallbackResult":
        case "Prototype":
          break;
      }
    }
    return [...classes];
  }
}

function resolveSlot(
  context: OverloadContext,
  classes: readonly ModelClass[],
  name: SlotName,
  holder: string,
): ModelSlot | null {
  if (classes.length === 0) {
    context.report(`${holder} is not declared as an instance of a class, so it has no slot "${name}"`);
    return null;
  }
  const slots = new Set<ModelSlot>();
  let isInEveryClass = true;
  for (const owner of classes) {
    const slot = owner.slots.find(candidate => candidate.name.text === name);
    if (slot !== undefined) {
      slots.add(slot);
      continue;
    }
    context.report(`class ${owner.token} has no slot "${name}"`);
    isInEveryClass = false;
  }
  if (slots.size > 1) {
    context.report(`"${name}" is a different slot in each class of ${holder}: write one signature for each class`);
  }
  const [slot] = slots;
  return isInEveryClass && slots.size === 1 ? slot : null;
}

function findLayoutField(layout: ModelLayout, field: string | number): number | null {
  if (typeof field === "number") {
    return Number.isInteger(field) && field >= 0 && field < layout.fields.length ? field : null;
  }
  const index = layout.fields.findIndex(candidate => candidate.name !== null && candidate.name.text === field);
  return index < 0 ? null : index;
}

function resolveResultField(context: OverloadContext, field: string | number): number | null {
  const layouts = context.resultType.parts.flatMap(part => (part.part === "Layout" ? [part.layout] : []));
  if (layouts.length === 0) {
    context.report(`the result has no layout, so it has no field ${field}`);
    return null;
  }
  const indexes = new Set<number>();
  let isInEveryLayout = true;
  for (const layout of layouts) {
    const index = findLayoutField(layout, field);
    if (index !== null) {
      indexes.add(index);
      continue;
    }
    context.report(`the layout ${layout.token} has no field ${field}`);
    isInEveryLayout = false;
  }
  if (indexes.size > 1) context.report(`the field ${field} has a different index in each layout of the result`);
  const [index] = indexes;
  return isInEveryLayout && indexes.size === 1 ? index : null;
}

function resolvePlace(context: OverloadContext, spec: PlaceSpec): ModelPlace | null {
  switch (spec.place) {
    case "Operand":
    case "OwnValues":
    case "Prototype": {
      const operand = context.operandOf(spec.operand, context.source);
      return operand === null ? null : { place: spec.place, operand };
    }
    case "IteratedValues": {
      const operand = context.operandOf(spec.operand, context.source);
      return operand === null ? null : { place: spec.place, operand, isSettled: spec.isSettled ?? false };
    }
    case "Slot": {
      const operand = context.operandOf(spec.operand, context.source);
      if (operand === null) return null;
      const slot = resolveSlot(context, context.classesOf(operand), spec.slot, spec.operand);
      return slot === null ? null : { place: "Slot", operand, slot };
    }
    case "Result":
    case "NativeMemory":
      return { place: spec.place };
    case "ResultSlot": {
      const slot = resolveSlot(context, context.resultClasses, spec.slot, "the result");
      return slot === null ? null : { place: "ResultSlot", slot };
    }
    case "ResultField": {
      const index = resolveResultField(context, spec.field);
      if (index === null) return null;
      return { place: "ResultField", index, holdsOnlyWhatIsStored: spec.holdsOnlyWhatIsStored ?? false };
    }
    case "NewValue":
      return { place: "NewValue", type: context.types.intern(spec.value, context, context.source) };
    case "Member": {
      const operand = context.operandOf(spec.operand, context.source);
      return operand === null ? null : memberPlaceOf(context, operand, spec.path);
    }
    case "NativeCell":
      return { place: "NativeCell", cell: context.builder.internName(spec.cell, "Text") };
  }
}

function memberPlaceOf(context: OverloadContext, operand: ModelOperand, path: MemberPath): ModelPlace | null {
  if (path.length === 0) {
    context.report("the path of a member has at least one step");
    return null;
  }
  const { builder } = context;
  const names = path.map(step => (step === null ? null : builder.internComponent(step)));
  return { place: "Member", operand, path: names, firstStep: builder.numberMemberPath(path) };
}

function resolveTarget(context: OverloadContext, spec: PlaceSpec): ModelPlace | null {
  const place = resolvePlace(context, spec);
  if (place === null) return null;
  switch (place.place) {
    case "Slot":
    case "Result":
    case "ResultSlot":
    case "ResultField":
    case "NativeMemory":
    case "NativeCell":
      return place;
    case "None":
    case "Operand":
    case "IteratedValues":
    case "OwnValues":
    case "NewValue":
    case "Prototype":
    case "Member":
      context.report(`a value cannot be stored in the place ${place.place}`);
      return null;
  }
}

function resolveKey(context: OverloadContext, spec: KeySpec): ModelKey | null {
  switch (spec.key) {
    case "Operand":
    case "ElementsOf": {
      const operand = context.operandOf(spec.operand, context.source);
      return operand === null ? null : { key: spec.key, operand };
    }
    case "Names":
      return { key: "Names", names: internNames(context.builder, spec.names) };
    case "Indexes":
    case "Any":
      return { key: spec.key };
  }
}

function addUses(context: OverloadContext, operand: ModelOperand, ...uses: readonly OperandUse[]): void {
  const state = context.stateOf(operand);
  for (const use of uses) state?.uses.add(use);
}

function addProtocols(context: OverloadContext, operand: ModelOperand, ...run: readonly Protocol[]): void {
  const state = context.stateOf(operand);
  for (const protocol of run) state?.protocols.add(protocol);
}

function listNamedMembers(state: OperandState, names: readonly ModelName[]): void {
  if (names.length === 0) state.hasEveryMember = true;
  for (const name of names) state.namedMembers.add(name);
}

function listCalledMembers(state: OperandState, names: readonly ModelName[]): void {
  if (names.length === 0) state.callsEveryMember = true;
  for (const name of names) state.calledMembers.add(name);
}

function addNamedMembers(context: OverloadContext, operand: ModelOperand, names: readonly ModelName[]): void {
  const state = context.stateOf(operand);
  if (state === undefined) return;
  state.protocols.add("Named");
  listNamedMembers(state, names);
}

function recordAccess(access: ContentsAccess, extents: readonly ContentsExtent[]): void {
  for (const extent of extents) {
    if (extent === "State") access.hasState = true;
    else if (extent === "EverySlot") access.isEverySlot = true;
    else if (extent === "Properties") access.hasProperties = true;
    else access.slots.add(extent);
  }
}

function recordRead(context: OverloadContext, operand: ModelOperand, ...extents: readonly ContentsExtent[]): void {
  const state = context.stateOf(operand);
  if (state === undefined) return;
  state.uses.add("ReadsContents");
  recordAccess(state.reads, extents);
}

function recordWrite(context: OverloadContext, operand: ModelOperand, ...extents: readonly ContentsExtent[]): void {
  const state = context.stateOf(operand);
  if (state === undefined) return;
  state.uses.add("WritesContents");
  recordAccess(state.writes, extents);
}

function recordSource(context: OverloadContext, place: ModelPlace, valueUse: OperandUse): void {
  switch (place.place) {
    case "Operand":
      addUses(context, place.operand, valueUse);
      return;
    case "Slot":
      recordRead(context, place.operand, place.slot);
      addUses(context, place.operand, "RetainsContents");
      return;
    case "IteratedValues":
      recordRead(context, place.operand, "EverySlot");
      addUses(context, place.operand, "RetainsContents");
      return;
    case "OwnValues":
      recordRead(context, place.operand, "EverySlot", "Properties");
      addUses(context, place.operand, "RetainsContents");
      return;
    case "Prototype": {
      const state = context.stateOf(place.operand);
      if (state !== undefined) state.readsPrototypeLink = true;
      addUses(context, place.operand, "RetainsContents");
      return;
    }
    case "NewValue":
      for (const part of operandPartsOf(place.type)) {
        const source = placeOfPart(part);
        if (source !== null) recordSource(context, source, valueUse);
      }
      return;
    case "Member": {
      const names = place.path.filter(step => step !== null);
      recordRead(context, place.operand, "Properties");
      addUses(context, place.operand, "RetainsContents");
      if (names.length > 0) addNamedMembers(context, place.operand, names);
      if (names.length < place.path.length) addProtocols(context, place.operand, "OwnKeys", "OwnValues");
      return;
    }
    case "None":
    case "Result":
    case "ResultSlot":
    case "ResultField":
    case "NativeMemory":
    case "NativeCell":
      return;
  }
}

function recordTarget(context: OverloadContext, place: ModelPlace): void {
  if (place.place !== "Slot") return;
  recordWrite(context, place.operand, place.slot);
  if (place.slot.contentsSlot !== null) recordWrite(context, place.operand, "State");
}

function addTransfer(context: OverloadContext, from: ModelPlace, to: ModelPlace, valueUse: OperandUse): void {
  recordSource(context, from, valueUse);
  recordTarget(context, to);
  const isRecorded = context.transfers.some(other => isSamePlace(other.from, from) && isSamePlace(other.to, to));
  if (!isRecorded) context.transfers.push({ from, to });
}

function addStore(context: OverloadContext, from: ModelPlace, target: PlaceSpec): void {
  const to = resolveTarget(context, target);
  if (to !== null) addTransfer(context, from, to, "Retains");
}

function applyCallback(context: OverloadContext, callee: ModelOperand, use: UseOf<"Calls">): void {
  const passedPlaceOf = (spec: PlaceSpec | undefined): ModelPlace => {
    const place = spec === undefined ? noPlace : (resolvePlace(context, spec) ?? noPlace);
    recordSource(context, place, "PassesToUserCode");
    return place;
  };
  const resultTo = use.resultTo === undefined ? noPlace : (resolveTarget(context, use.resultTo) ?? noPlace);
  recordTarget(context, resultTo);
  addUses(context, callee, "Calls", ...usesByCallbackTimes[use.times]);
  context.callbacks.push({
    callee,
    times: use.times,
    constructs: use.constructs ?? false,
    newTarget: passedPlaceOf(use.newTarget),
    thisValue: passedPlaceOf(use.thisValue),
    arguments: (use.arguments ?? []).map(passedPlaceOf),
    spreadArguments: passedPlaceOf(use.spreadArguments),
    resultUse: use.result ?? "Escapes",
    resultTo,
  });
}

function applyHandlerCall(context: OverloadContext, callee: ModelPlace | null, use: HandlerSpec): void {
  if (callee === null) return;
  const passedPlaceOf = (spec: PlaceSpec | undefined): ModelPlace => {
    const place = spec === undefined ? noPlace : (resolvePlace(context, spec) ?? noPlace);
    recordSource(context, place, "PassesToUserCode");
    return place;
  };
  recordSource(context, callee, "Retains");
  context.handlerCalls.push({
    callee,
    times: use.times,
    thisValue: passedPlaceOf(use.thisValue),
    arguments: (use.arguments ?? []).map(passedPlaceOf),
    resultUse: use.result ?? "Escapes",
  });
}

function applyReadByKey(context: OverloadContext, object: ModelOperand, use: UseOf<"ReadsByKey">): void {
  const key = resolveKey(context, use.key);
  const value = resolveTarget(context, use.to);
  if (key === null || value === null) return;
  recordRead(context, object, "Properties");
  recordTarget(context, value);
  if (value.place !== "NativeMemory") addUses(context, object, "RetainsContents");
  if (key.key === "Names") addNamedMembers(context, object, key.names);
  else addProtocols(context, object, "OwnValues");
  context.propertyActions.push({ action: "ReadsByKey", object, key, value, integrityLevel: null });
}

function applyStoreByKey(
  context: OverloadContext,
  object: ModelOperand,
  use: UseOf<"StoresByKey" | "DefinesName">,
): void {
  const key = resolveKey(context, use.key);
  const value = resolvePlace(context, use.value);
  if (key === null || value === null) return;
  addUses(context, object, use.use);
  recordWrite(context, object, "Properties");
  recordSource(context, value, "Retains");
  context.propertyActions.push({ action: use.use, object, key, value, integrityLevel: null });
}

function applyAccessorDefinition(
  context: OverloadContext,
  object: ModelOperand,
  use: UseOf<"DefinesGetter" | "DefinesSetter">,
): void {
  const key = resolveKey(context, use.key);
  const value = resolvePlace(context, use.value);
  if (key === null || value === null) return;
  addUses(context, object, "TakesDescriptor");
  recordWrite(context, object, "Properties");
  recordSource(context, value, "Retains");
  context.propertyActions.push({ action: use.use, object, key, value, integrityLevel: null });
}

function applyAccessorRead(
  context: OverloadContext,
  object: ModelOperand,
  use: UseOf<"ReadsGetter" | "ReadsSetter">,
): void {
  const key = resolveKey(context, use.key);
  const value = resolveTarget(context, use.to);
  if (key === null || value === null) return;
  recordRead(context, object, "Properties");
  recordTarget(context, value);
  if (value.place !== "NativeMemory") addUses(context, object, "RetainsContents");
  context.propertyActions.push({ action: use.use, object, key, value, integrityLevel: null });
}

function applyDescriptor(
  context: OverloadContext,
  object: ModelOperand,
  use: UseOf<"TakesDescriptor" | "TakesDescriptorMap">,
): void {
  const key = use.use === "TakesDescriptor" ? resolveKey(context, use.key) : noKey;
  const name = use.use === "TakesDescriptor" ? use.descriptor : use.descriptors;
  const descriptor = context.operandOf(name, context.source);
  if (key === null || descriptor === null) return;
  addUses(context, object, "TakesDescriptor");
  recordWrite(context, object, "Properties");
  recordRead(context, descriptor, "Properties");
  addUses(context, descriptor, "RetainsContents");
  addNamedMembers(context, descriptor, internNames(context.builder, descriptorMembers));
  if (use.use === "TakesDescriptorMap") {
    addProtocols(context, descriptor, "OwnKeys", "OwnValues");
    addUses(context, descriptor, "AppliesTransitively");
  }
  const value: ModelPlace = { place: "Operand", operand: descriptor };
  context.propertyActions.push({ action: use.use, object, key, value, integrityLevel: null });
}

function applyKeyedUse(context: OverloadContext, object: ModelOperand, use: KeyedUse): void {
  switch (use.use) {
    case "ReadsByKey":
      applyReadByKey(context, object, use);
      return;
    case "StoresByKey":
    case "DefinesName":
      applyStoreByKey(context, object, use);
      return;
    case "DefinesGetter":
    case "DefinesSetter":
      applyAccessorDefinition(context, object, use);
      return;
    case "ReadsGetter":
    case "ReadsSetter":
      applyAccessorRead(context, object, use);
      return;
    case "DeletesByKey": {
      const key = resolveKey(context, use.key);
      if (key === null) return;
      addUses(context, object, "DeletesByKey");
      recordWrite(context, object, "Properties");
      context.propertyActions.push({ action: "DeletesByKey", object, key, value: noPlace, integrityLevel: null });
      return;
    }
    case "TestsByKey": {
      const key = resolveKey(context, use.key);
      if (key === null) return;
      context.propertyActions.push({ action: "TestsByKey", object, key, value: noPlace, integrityLevel: null });
      return;
    }
    case "AssignsFrom": {
      const sources = context.operandOf(use.sources, context.source);
      if (sources === null) return;
      const value: ModelPlace = { place: "OwnValues", operand: sources };
      addUses(context, object, "AssignsFrom", "StoresByKey");
      recordWrite(context, object, "Properties");
      recordSource(context, value, "Retains");
      addProtocols(context, sources, "OwnKeys", "OwnValues");
      context.propertyActions.push({ action: "AssignsFrom", object, key: noKey, value, integrityLevel: null });
      return;
    }
    case "DefinesFrom": {
      const source = context.operandOf(use.source, context.source);
      if (source === null) return;
      const value: ModelPlace = { place: "OwnValues", operand: source };
      addUses(context, object, "TakesDescriptor");
      recordWrite(context, object, "Properties");
      recordSource(context, value, "Retains");
      addUses(context, source, "RetainsContents");
      addProtocols(context, source, "OwnKeys");
      context.propertyActions.push({ action: "DefinesFrom", object, key: noKey, value, integrityLevel: null });
      return;
    }
    case "TakesDescriptor":
    case "TakesDescriptorMap":
      applyDescriptor(context, object, use);
      return;
    case "DescribesOwnProperties":
      context.propertyActions.push({ action: use.use, object, key: noKey, value: resultPlace, integrityLevel: null });
      return;
    case "DescribesResult":
      recordRead(context, object, "Properties");
      addUses(context, object, "RetainsContents", "AppliesTransitively");
      addNamedMembers(context, object, internNames(context.builder, descriptorMembers));
      addProtocols(context, object, "OwnKeys", "OwnValues");
      context.propertyActions.push({ action: use.use, object, key: noKey, value: resultPlace, integrityLevel: null });
      return;
  }
}

function applyBecomesPrototype(context: OverloadContext, object: ModelOperand, use: UseOf<"BecomesPrototype">): void {
  const value = resolvePlace(context, use.of);
  if (value === null) return;
  switch (value.place) {
    case "Operand":
      addUses(context, value.operand, "ChangesPrototype");
      break;
    case "Result":
      break;
    case "None":
    case "Slot":
    case "IteratedValues":
    case "OwnValues":
    case "ResultSlot":
    case "ResultField":
    case "NewValue":
    case "NativeMemory":
    case "Prototype":
    case "Member":
    case "NativeCell":
      context.report(`an operand becomes the prototype of the result or of an operand, not of ${value.place}`);
      return;
  }
  addUses(context, object, "BecomesPrototype", "Retains");
  context.propertyActions.push({ action: "BecomesPrototype", object, key: noKey, value, integrityLevel: null });
}

function applyObjectStateUse(context: OverloadContext, object: ModelOperand, use: ObjectStateUse): void {
  switch (use.use) {
    case "ChangesIntegrity": {
      const integrityLevel = use.level;
      addUses(context, object, "ChangesIntegrity");
      context.propertyActions.push({ action: "ChangesIntegrity", object, key: noKey, value: noPlace, integrityLevel });
      return;
    }
    case "ChangesPrototype": {
      const prototype = context.operandOf(use.to, context.source);
      if (prototype === null) return;
      addUses(context, object, "ChangesPrototype");
      addUses(context, prototype, "BecomesPrototype", "Retains");
      const value: ModelPlace = { place: "Operand", operand: prototype };
      context.propertyActions.push({ action: "ChangesPrototype", object, key: noKey, value, integrityLevel: null });
      return;
    }
    case "BecomesPrototype":
      applyBecomesPrototype(context, object, use);
      return;
  }
}

function applyContentsUse(
  context: OverloadContext,
  state: OperandState,
  use: UseOf<"ReadsContents" | "WritesContents">,
): void {
  const { operand, name } = state.parameter;
  const extent =
    use.slot === undefined ? "EverySlot" : resolveSlot(context, context.classesOf(operand), use.slot, name);
  if (extent === null) return;
  if (use.use === "ReadsContents") recordRead(context, operand, extent);
  else recordWrite(context, operand, extent);
}

function applyProtocols(context: OverloadContext, state: OperandState, use: UseOf<"Runs">): void {
  const run = use.on === "Contents" ? state.protocolsOfContents : state.protocols;
  for (const protocol of use.protocols) {
    if (typeof protocol === "string") {
      run.add(protocol);
    } else if ("named" in protocol) {
      run.add("Named");
      const names = internNames(context.builder, protocol.named);
      listNamedMembers(state, names);
      for (const name of names) state.membersListedByEntry.add(name);
    } else {
      run.add("CallsNamed");
      listCalledMembers(state, internNames(context.builder, protocol.calls));
    }
  }
  if (use.on === "ReachableObjects") state.uses.add("AppliesTransitively");
}

function claimEverything(state: OperandState): void {
  for (const use of operandUses) state.uses.add(use);
  for (const protocol of protocols) state.protocols.add(protocol);
  state.hasEveryMember = true;
  state.callsEveryMember = true;
  recordAccess(state.reads, ["EverySlot", "Properties"]);
  recordAccess(state.writes, ["EverySlot", "Properties"]);
}

function applyUse(context: OverloadContext, state: OperandState, use: UseSpec): void {
  const { operand } = state.parameter;
  switch (use.use) {
    case "Retains":
      addStore(context, { place: "Operand", operand }, use.in);
      return;
    case "Returns":
      addTransfer(context, { place: "Operand", operand }, resultPlace, "Returns");
      return;
    case "RetainsContents":
      addStore(context, { place: "OwnValues", operand }, use.in);
      if (use.transitively) state.uses.add("AppliesTransitively");
      return;
    case "RetainsSettledValues":
      addStore(context, { place: "IteratedValues", operand, isSettled: true }, use.in);
      return;
    case "RetainsIteratedValues":
      addStore(context, { place: "IteratedValues", operand, isSettled: false }, use.in);
      return;
    case "Calls":
      applyCallback(context, operand, use);
      return;
    case "CallsMember":
      applyHandlerCall(context, memberPlaceOf(context, operand, use.path), use);
      return;
    case "CallsKept":
      applyHandlerCall(context, resolvePlace(context, { place: "NativeCell", cell: use.cell }), use);
      return;
    case "RetainsMember": {
      const from = memberPlaceOf(context, operand, use.path);
      if (from !== null) addStore(context, from, use.in);
      return;
    }
    case "Creates": {
      const from = resolvePlace(context, { place: "NewValue", value: use.value });
      if (from !== null) addStore(context, from, use.in);
      return;
    }
    case "ReturnsKept": {
      const from = resolvePlace(context, { place: "NativeCell", cell: use.cell });
      if (from !== null) addTransfer(context, from, resultPlace, "Returns");
      return;
    }
    case "ReadsByKey":
    case "StoresByKey":
    case "DeletesByKey":
    case "TestsByKey":
    case "AssignsFrom":
    case "DefinesFrom":
    case "DefinesName":
    case "DefinesGetter":
    case "DefinesSetter":
    case "ReadsGetter":
    case "ReadsSetter":
    case "TakesDescriptor":
    case "TakesDescriptorMap":
    case "DescribesOwnProperties":
    case "DescribesResult":
      applyKeyedUse(context, operand, use);
      return;
    case "ChangesIntegrity":
    case "ChangesPrototype":
    case "BecomesPrototype":
      applyObjectStateUse(context, operand, use);
      return;
    case "MovesElements":
      state.uses.add("MovesElements");
      recordRead(context, operand, "EverySlot");
      recordWrite(context, operand, "EverySlot");
      return;
    case "ReadsContents":
    case "WritesContents":
      applyContentsUse(context, state, use);
      return;
    case "Role":
      state.roles.add(use.role);
      return;
    case "Runs":
      applyProtocols(context, state, use);
      return;
    case "Everything":
      claimEverything(state);
      return;
  }
}

export function applyUses(context: OverloadContext, operand: ModelOperand, uses: readonly UseSpec[]): void {
  const state = context.stateOf(operand);
  if (state === undefined) return;
  for (const use of uses) applyUse(context, state, use);
}

export function applyWrittenUses(context: OverloadContext): void {
  const { uses = {}, isUndeclared } = context.signature;
  for (const name of Object.keys(uses)) context.operandOf(name, context.source);
  for (const { parameter } of context.states) {
    const { name, operand, accepted, converted } = parameter;
    const isWritten = !isUndeclared && Object.hasOwn(uses, name);
    if (isWritten) {
      applyUses(context, operand, uses[name]!);
      continue;
    }
    if (!isUndeclared && !mayBeObject(accepted) && !mayBeObject(converted)) continue;
    if (!isUndeclared) {
      if (context.source.proof === "HandWritten") context.report(`${name} may hold an object and has no uses`);
      const { builder, builtin, source } = context;
      builder.operandsWithoutUses.push({ builtin, operand: name, source });
    }
    applyUses(context, operand, [everything]);
  }
}

function deriveFlowOfPart(context: OverloadContext, part: ModelTypePart, to: ModelPlace, valueUse: OperandUse): void {
  switch (part.part) {
    case "Operand":
    case "Slot":
    case "IteratedValues":
    case "Prototype": {
      const from = placeOfPart(part);
      if (from !== null) addTransfer(context, from, to, valueUse);
      return;
    }
    case "CallbackResult":
    case "Instance":
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
    case "Layout":
    case "Builtin":
      return;
  }
}

export function deriveUsesOfResult(context: OverloadContext): void {
  for (const part of context.resultType.parts) {
    deriveFlowOfPart(context, part, resultPlace, "Returns");
    if (part.part !== "Instance") continue;
    for (const { slot, type } of part.contents) {
      for (const inner of type.parts) {
        deriveFlowOfPart(context, inner, { place: "ResultSlot", slot }, "Retains");
        if (inner.part !== "Instance") continue;
        const holder = `a ${inner.class.token} in the slot "${slot.name.text}" of the result`;
        for (const nested of inner.contents.flatMap(contents => operandPartsOf(contents.type))) {
          const source = placeOfPart(nested);
          if (source !== null) recordSource(context, source, "Retains");
          else context.report(`${holder} holds the result of a callback, and a callback stores its result in a place`);
        }
      }
    }
  }
}

function heapsOfClass({ slots, stateHeap }: ModelClass): readonly Heap[] {
  const heaps = slots.map(slot => slot.heap);
  if (stateHeap !== null) heaps.push(stateHeap);
  return heaps.length > 0 ? heaps : objectHeaps;
}

function heapsOfAccess({ parameter, protocols }: OperandState, access: ContentsAccess, isWrite: boolean): Heap[] {
  const types = [parameter.accepted, parameter.converted];
  const classes = instanceClassesOf(types);
  const heaps = Array.from(access.slots, slot => slot.heap);
  if (access.hasState) heaps.push(...classes.flatMap(({ stateHeap }) => stateHeap ?? []));
  if (access.isEverySlot) heaps.push(...classes.flatMap(heapsOfClass));
  const hasObjectHeaps = access.hasProperties
    ? types.some(mayBeObject)
    : access.isEverySlot && types.some(mayBeObjectOutsideClasses);
  if (isWrite && access.hasProperties) {
    const ofClasses = classes.flatMap(heapsOfClass);
    const isAnyObject = types.some(mayBeObjectOutsideClasses);
    heaps.push(...heapsBehindProperties.filter(heap => isAnyObject || ofClasses.includes(heap)));
  }
  const isReadByNativeCodeAlone = !isWrite && access.isEverySlot && protocols.size === 0;
  if (isReadByNativeCodeAlone && types.some(mayBeObjectOutsideClasses)) heaps.push(...heapsOfContentsOfClasses);
  return hasObjectHeaps ? [...heaps, ...objectHeaps] : heaps;
}

function orderHeaps(context: OverloadContext, heaps: ReadonlySet<Heap>): Heap[] {
  const declared = context.builder.schema.heaps;
  for (const heap of heaps) if (!declared.includes(heap)) context.report(`the schema declares no heap ${heap}`);
  return declared.filter(heap => heaps.has(heap));
}

export function deriveHeaps(context: OverloadContext): ModelEffects {
  const { capability, reads: writtenReads, writes: writtenWrites } = context.signature;
  const reads = new Set<Heap>(writtenReads);
  const writes = new Set<Heap>(writtenWrites);
  for (const state of context.states) {
    for (const heap of heapsOfAccess(state, state.reads, false)) reads.add(heap);
    for (const heap of heapsOfAccess(state, state.writes, true)) writes.add(heap);
    if (state.readsPrototypeLink) reads.add(prototypeHeap);
    if (state.uses.has("ChangesPrototype")) writes.add(prototypeHeap);
  }
  return { capability, reads: orderHeaps(context, reads), writes: orderHeaps(context, writes) };
}

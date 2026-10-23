import { Problems } from "./declarations.ts";
import {
  capabilityEnumerators,
  checkDenseIds,
  emitArray,
  emitArrayOfConstants,
  formatAggregate,
  formatEnumerator,
  formatId,
  formatName,
  formatOperand,
  formatOptionSet,
  formatUnlessDefault,
  formatUnlessEmpty,
  formatUnlessZero,
  joinBlocks,
  Pool,
  wrapFile,
  type AggregateMember,
} from "./emit-cpp-support.ts";
import {
  overloadFlags,
  type ModelCallback,
  type ModelCode,
  type ModelDispatch,
  type ModelDispatchBranch,
  type ModelDispatchNode,
  type ModelDispatchTarget,
  type ModelEffects,
  type ModelFlow,
  type ModelHandlerCall,
  type ModelImplementation,
  type ModelKey,
  type ModelName,
  type ModelOverload,
  type ModelParameter,
  type ModelPlace,
  type ModelPropertyAction,
  type ModelResult,
  type ModelResultProperty,
  type ModelTransfer,
  type TableModel,
} from "./model.ts";
import { operandRoles, operandUses, protocols, type Heap, type InlineBuiltinName } from "./vocabulary.ts";

type CalledImplementation = Extract<ModelImplementation, { how: "Generic" | "HostCall" | "Compiled" }>;
type InlineImplementation = Extract<ModelImplementation, { how: "Inline" }>;

interface Pools {
  names: Pool;
  places: Pool;
  parameters: Pool;
  transfers: Pool;
  callbacks: Pool;
  handlerCalls: Pool;
  propertyActions: Pool;
  resultProperties: Pool;
  dispatchBranches: Pool;
  results: Pool;
  effects: Pool;
  flows: Pool;
  codes: Pool;
}

const inlineParameterCount = 4;
const receiverPointerType = "BuiltinRecordPointer<BuiltinParameter, BuiltinRecordPool::Parameters>";
const textHashPattern = /^[0-9a-f]{16}$/;
const decimalPattern = /^(0|[1-9][0-9]*)$/;

function createPools(): Pools {
  return {
    names: new Pool("BuiltinName", "builtinTableNamesOfOverloads", true),
    places: new Pool("BuiltinPlace", "places"),
    parameters: new Pool("BuiltinParameter", "builtinTableParameters", true),
    transfers: new Pool("BuiltinTransfer", "builtinTableTransfers", true),
    callbacks: new Pool("BuiltinCallback", "builtinTableCallbacks", true),
    handlerCalls: new Pool("BuiltinHandlerCall", "builtinTableHandlerCalls", true),
    propertyActions: new Pool("BuiltinPropertyAction", "builtinTablePropertyActions", true),
    resultProperties: new Pool("BuiltinResultProperty", "builtinTableResultProperties", true),
    dispatchBranches: new Pool("BuiltinDispatchBranch", "builtinTableDispatchBranches", true),
    results: new Pool("BuiltinResult", "builtinTableResultsOfOverloads", true),
    effects: new Pool("BuiltinEffects", "builtinTableEffectsOfOverloads", true),
    flows: new Pool("BuiltinFlow", "builtinTableFlowsOfOverloads", true),
    codes: new Pool("BuiltinCode", "builtinTableCodeOfOverloads", true),
  };
}

function isByte(text: string): boolean {
  return decimalPattern.test(text) && Number(text) <= 0xff;
}

function checkInlineImplementation(
  overload: ModelOverload,
  implementation: InlineImplementation,
  problems: Problems,
): void {
  const { builtin, parameters, maximumArgumentCount } = implementation;
  const path = overload.builtin.text;
  if (parameters.length > inlineParameterCount) {
    const capacity = `BuiltinImplementation::inlineParameters holds ${inlineParameterCount}`;
    problems.add(overload.source, `${path}: ${builtin} has ${parameters.length} parameters, and ${capacity}`);
  }
  for (const parameter of parameters) {
    if (!isByte(parameter))
      problems.add(overload.source, `${path}: the parameter ${parameter} of ${builtin} is not a number from 0 to 255`);
  }
  if (maximumArgumentCount !== null && !isByte(String(maximumArgumentCount))) {
    const message = `the maximum argument count ${maximumArgumentCount} of ${builtin} is not a number from 0 to 255`;
    problems.add(overload.source, `${path}: ${message}`);
  }
}

function checkOverload(overload: ModelOverload, problems: Problems): void {
  const { implementation } = overload.code;
  if (!textHashPattern.test(overload.textHash)) {
    const message = `the text hash ${JSON.stringify(overload.textHash)} is not 16 hex digits`;
    problems.add(overload.source, `${overload.builtin.text}: ${message}`);
  }
  if (implementation.how === "Inline") checkInlineImplementation(overload, implementation, problems);
}

function checkModel(model: TableModel): void {
  const problems = new Problems();
  checkDenseIds("BuiltinOverloadID", model.overloads, problems);
  checkDenseIds("BuiltinDispatchNodeID", model.dispatchNodes, problems);
  for (const overload of model.overloads) checkOverload(overload, problems);
  problems.throwIfAny();
}

function orderWords<Word extends string>(vocabulary: readonly Word[], words: readonly Word[]): Word[] {
  return [...new Set(words)].sort((left, right) => vocabulary.indexOf(left) - vocabulary.indexOf(right));
}

function formatWordSet<Word extends string>(
  cppSet: string,
  cppEnum: string,
  vocabulary: readonly Word[],
  words: readonly Word[],
): string {
  const ordered = orderWords(vocabulary, words);
  if (ordered.length === vocabulary.length) return `${cppSet}::all()`;
  return `${cppSet} ${formatOptionSet(cppEnum, ordered) ?? "{ }"}`;
}

function formatNames(names: readonly ModelName[], pools: Pools): string | null {
  return pools.names.add(names.map(name => formatName(name)));
}

function formatNameStretch(names: readonly ModelName[], pools: Pools): string | null {
  return pools.names.addStretch(names.map(name => formatName(name)));
}

function formatHeaps(heaps: readonly Heap[]): string | null {
  const enumerators = formatOptionSet("AbstractHeap", heaps);
  return enumerators === null ? null : `AbstractHeaps ${enumerators}`;
}

function formatInlineBuiltin(name: InlineBuiltinName | null): string | null {
  return name === null ? null : formatEnumerator("InlineBuiltin", name);
}

function formatPlace(place: ModelPlace, pools: Pools): string | null {
  const kind: AggregateMember = ["kind", formatEnumerator("BuiltinPlaceKind", place.place)];
  switch (place.place) {
    case "None":
      return null;
    case "Operand":
    case "OwnValues":
    case "Prototype":
      return formatAggregate([kind, ["operand", formatOperand(place.operand)]]);
    case "IteratedValues":
      return formatAggregate([
        kind,
        ["operand", formatOperand(place.operand)],
        ["isSettled", place.isSettled ? "true" : null],
      ]);
    case "Slot":
      return formatAggregate([
        kind,
        ["operand", formatOperand(place.operand)],
        ["slot", formatId("BuiltinSlotID", place.slot)],
      ]);
    case "Result":
    case "NativeMemory":
      return formatAggregate([kind]);
    case "ResultSlot":
      return formatAggregate([kind, ["slot", formatId("BuiltinSlotID", place.slot)]]);
    case "ResultField":
      return formatAggregate([
        kind,
        ["fieldIndex", formatUnlessZero(place.index)],
        ["holdsOnlyWhatIsStored", place.holdsOnlyWhatIsStored ? "true" : null],
      ]);
    case "NewValue":
      return formatAggregate([kind, ["newValueType", formatId("BuiltinTypeID", place.type)]]);
    case "Member":
      return formatAggregate([
        kind,
        ["operand", formatOperand(place.operand)],
        ["memberPath", pools.names.add(place.path.map(step => (step === null ? "BuiltinName()" : formatName(step))))],
        ["firstMemberStep", formatUnlessZero(place.firstStep)],
      ]);
    case "NativeCell":
      return formatAggregate([kind, ["nativeCell", formatName(place.cell)]]);
  }
}

function formatKey(key: ModelKey, pools: Pools): string | null {
  const kind: AggregateMember = ["kind", formatEnumerator("BuiltinKeyKind", key.key)];
  switch (key.key) {
    case "None":
      return null;
    case "Any":
    case "Indexes":
      return formatAggregate([kind]);
    case "Names":
      return formatAggregate([kind, ["names", formatNames(key.names, pools)]]);
    case "Operand":
    case "ElementsOf":
      return formatAggregate([kind, ["operand", formatOperand(key.operand)]]);
  }
}

function formatTransfer(transfer: ModelTransfer, pools: Pools): string {
  return formatAggregate([
    ["from", formatPlace(transfer.from, pools)],
    ["to", formatPlace(transfer.to, pools)],
  ]);
}

function formatHandlerCall(call: ModelHandlerCall, pools: Pools): string {
  return formatAggregate([
    ["callee", formatPlace(call.callee, pools)],
    ["times", formatUnlessDefault("BuiltinCallbackTimes", call.times, "PerEvent")],
    ["thisValue", formatPlace(call.thisValue, pools)],
    ["arguments", pools.places.add(call.arguments.map(place => formatPlace(place, pools) ?? "{ }"))],
    ["resultUse", formatUnlessDefault("BuiltinCallbackResultUse", call.resultUse, "Escapes")],
  ]);
}

function formatCallback(callback: ModelCallback, pools: Pools): string {
  return formatAggregate([
    ["callee", formatOperand(callback.callee)],
    ["times", formatUnlessDefault("BuiltinCallbackTimes", callback.times, "Later")],
    ["constructs", callback.constructs ? "true" : null],
    ["newTarget", formatPlace(callback.newTarget, pools)],
    ["thisValue", formatPlace(callback.thisValue, pools)],
    ["arguments", pools.places.add(callback.arguments.map(place => formatPlace(place, pools) ?? "{ }"))],
    ["spreadArguments", formatPlace(callback.spreadArguments, pools)],
    ["resultUse", formatUnlessDefault("BuiltinCallbackResultUse", callback.resultUse, "Escapes")],
    ["resultTo", formatPlace(callback.resultTo, pools)],
  ]);
}

function formatPropertyAction(action: ModelPropertyAction, pools: Pools): string {
  const { integrityLevel } = action;
  return formatAggregate([
    ["kind", formatEnumerator("BuiltinPropertyActionKind", action.action)],
    ["object", formatOperand(action.object)],
    ["key", formatKey(action.key, pools)],
    ["value", formatPlace(action.value, pools)],
    [
      "integrityLevel",
      integrityLevel === null ? null : formatUnlessDefault("BuiltinIntegrityLevel", integrityLevel, "NonExtensible"),
    ],
  ]);
}

function formatParameter(parameter: ModelParameter, pools: Pools): string {
  return formatAggregate([
    ["operand", formatOperand(parameter.operand)],
    ["mode", formatUnlessDefault("BuiltinParameterMode", parameter.mode, "Required")],
    ["conversion", formatUnlessDefault("BuiltinConversion", parameter.conversion, "None")],
    ["accepted", formatId("BuiltinTypeID", parameter.accepted)],
    ["converted", formatId("BuiltinTypeID", parameter.converted)],
    ["refused", formatId("BuiltinTypeID", parameter.refused)],
    ["admitted", formatId("BuiltinTypeID", parameter.admitted)],
    ["uses", formatWordSet("OperandUses", "OperandUse", operandUses, parameter.uses)],
    ["roles", formatOptionSet("BuiltinOperandRole", orderWords(operandRoles, parameter.roles))],
    ["protocols", formatWordSet("Protocols", "Protocol", protocols, parameter.protocols)],
    ["namedMembers", formatNameStretch(parameter.namedMembers, pools)],
    ["calledMembers", formatNameStretch(parameter.calledMembers, pools)],
    ["convertedMembers", formatNameStretch(parameter.convertedMembers, pools)],
  ]);
}

// The table is compiled for one platform, so a record holds the type that the result has there.
function formatResultType({ type, typesByPlatform }: ModelResult): string {
  const [first, ...others] = typesByPlatform;
  if (first === undefined) return formatId("BuiltinTypeID", type);
  const exceptions = others
    .filter(other => other.type !== first.type)
    .map(
      other =>
        `targetOfThisBuild().platform == BuiltinPlatform::${other.platform} ? ${formatId("BuiltinTypeID", other.type)} : `,
    );
  return `${exceptions.join("")}${formatId("BuiltinTypeID", first.type)}`;
}

function formatResult(result: ModelResult, pools: Pools): string {
  const { iterationKind } = result;
  return formatAggregate([
    ["type", formatResultType(result)],
    ["rangeRule", formatUnlessDefault("BuiltinRangeRule", result.rangeRule, "None")],
    ["rangeOperand", formatOperand(result.rangeOperand)],
    ["substringOf", formatOperand(result.substringOf)],
    ["typedResultForm", formatUnlessDefault("TypedResultForm", result.typedResultForm, "None")],
    ["typedResultSource", formatOperand(result.typedResultSource)],
    ["iteratedOperand", formatOperand(result.iteratedOperand)],
    ["iterationKind", iterationKind === null ? null : formatUnlessDefault("IterationKind", iterationKind, "Values")],
    ["prototypeSource", formatOperand(result.prototypeSource)],
    ["properties", pools.resultProperties.addStretch(result.properties.map(formatResultProperty))],
  ]);
}

function formatEffects(effects: ModelEffects): string | null {
  return formatUnlessEmpty([
    ["capability", formatUnlessDefault("BuiltinCapability", capabilityEnumerators[effects.capability], "JS")],
    ["reads", formatHeaps(effects.reads)],
    ["writes", formatHeaps(effects.writes)],
  ]);
}

function formatFlow(flow: ModelFlow, pools: Pools): string | null {
  const callbacks = flow.callbacks.map(callback => formatCallback(callback, pools));
  const propertyActions = flow.propertyActions.map(action => formatPropertyAction(action, pools));
  return formatUnlessEmpty([
    ["transfers", pools.transfers.addStretch(flow.transfers.map(transfer => formatTransfer(transfer, pools)))],
    ["callbacks", pools.callbacks.addStretch(callbacks)],
    ["propertyActions", pools.propertyActions.addStretch(propertyActions)],
    ["handlerCalls", pools.handlerCalls.addStretch(flow.handlerCalls.map(call => formatHandlerCall(call, pools)))],
  ]);
}

function formatCallee(implementation: CalledImplementation | null): string | null {
  if (implementation === null || implementation.how === "Generic") return null;
  return formatUnlessDefault("BuiltinCallee", implementation.callee, "None");
}

function formatLibraryFunction(implementation: CalledImplementation | null): string | null {
  if (implementation === null || implementation.how === "Generic") return null;
  return formatId("RuntimeFunctionID", implementation.function);
}

function formatInlineParameters(parameters: readonly string[]): string | null {
  if (parameters.length === 0) return null;
  const padding = Array<string>(inlineParameterCount - parameters.length).fill("0");
  return `{ ${[...parameters, ...padding].join(", ")} }`;
}

function formatImplementation(implementation: ModelImplementation): string | null {
  const kindEnumerator = formatUnlessDefault("BuiltinImplementationKind", implementation.how, "Generic");
  const kind: AggregateMember = ["kind", kindEnumerator];
  switch (implementation.how) {
    case "Generic":
    case "HostCall":
    case "Compiled":
      return formatUnlessEmpty([
        kind,
        ["callee", formatCallee(implementation)],
        ["function", formatLibraryFunction(implementation)],
      ]);
    case "Inline": {
      const { otherwise, maximumArgumentCount } = implementation;
      return formatAggregate([
        kind,
        ["otherwise", otherwise === null ? null : formatEnumerator("BuiltinImplementationKind", otherwise.how)],
        ["callee", formatCallee(otherwise)],
        ["inlineBuiltin", formatInlineBuiltin(implementation.builtin)],
        ["inlineParameters", formatInlineParameters(implementation.parameters)],
        ["maximumArgumentCount", maximumArgumentCount === null ? null : String(maximumArgumentCount)],
        ["function", formatLibraryFunction(otherwise)],
      ]);
    }
    case "Number":
    case "Cell":
    case "CachedGetter":
      return formatAggregate([kind]);
    case "OwnSlot":
      return formatAggregate([
        kind,
        [
          "ownSlot",
          formatAggregate([
            ["structure", formatId("RealmStructureID", implementation.structure)],
            ["offset", formatUnlessZero(implementation.offset)],
          ]),
        ],
      ]);
  }
}

function formatResultProperty({ name, type }: ModelResultProperty): string {
  return formatAggregate([
    ["name", formatName(name)],
    ["type", formatId("BuiltinTypeID", type)],
  ]);
}

function formatCode(code: ModelCode, pools: Pools): string | null {
  return formatUnlessEmpty([
    ["implementation", formatImplementation(code.implementation)],
    ["model", formatId("RuntimeFunctionID", code.model)],
    ["fieldsForm", formatInlineBuiltin(code.fieldsForm)],
    ["prefixForm", formatInlineBuiltin(code.prefixForm)],
    ["prefixProperties", pools.resultProperties.addStretch(code.prefixProperties.map(formatResultProperty))],
    ["listForm", formatInlineBuiltin(code.listForm)],
  ]);
}

function formatOverload(overload: ModelOverload, pools: Pools): string {
  const { receiver } = overload;
  return formatAggregate([
    ["textHash", `0x${overload.textHash}ULL`],
    ["builtin", formatId("BuiltinID", overload.builtin)],
    ["mode", formatUnlessDefault("BuiltinCallMode", overload.mode, "Call")],
    ["flags", formatOptionSet("BuiltinOverloadFlag", orderWords(overloadFlags, overload.flags)) ?? "{ }"],
    [
      "receiver",
      receiver === null
        ? null
        : pools.parameters.addIndexedElement(receiverPointerType, formatParameter(receiver, pools)),
    ],
    [
      "parameters",
      pools.parameters.addStretch(overload.parameters.map(parameter => formatParameter(parameter, pools))),
    ],
    ["result", pools.results.addNumberedElement(formatResult(overload.result, pools))],
    ["effects", pools.effects.addNumberedElement(formatEffects(overload.effects) ?? "{ }")],
    ["flow", pools.flows.addNumberedElement(formatFlow(overload.flow, pools) ?? "{ }")],
    ["code", pools.codes.addNumberedElement(formatCode(overload.code, pools) ?? "{ }")],
  ]);
}

function formatDispatchTarget(target: ModelDispatchTarget): string {
  if ("node" in target) return formatAggregate([["node", formatId("BuiltinDispatchNodeID", target.node)]]);
  return formatAggregate([["overload", formatId("BuiltinOverloadID", target.overload)]]);
}

function formatDispatchBranch(branch: ModelDispatchBranch): string {
  return formatAggregate([
    ["tested", formatId("BuiltinTypeID", branch.tested)],
    ["target", formatDispatchTarget(branch.target)],
  ]);
}

function formatDispatchNode(node: ModelDispatchNode, pools: Pools): string {
  return formatAggregate([
    ["operand", formatOperand(node.operand)],
    ["branches", pools.dispatchBranches.addStretch(node.branches.map(formatDispatchBranch))],
  ]);
}

function formatDispatch(dispatch: ModelDispatch): string {
  return formatAggregate([
    ["builtin", formatId("BuiltinID", dispatch.builtin)],
    ["mode", formatUnlessDefault("BuiltinCallMode", dispatch.mode, "Call")],
    ["root", formatDispatchTarget(dispatch.root)],
  ]);
}

export function emitCppOverloads(model: TableModel): string {
  checkModel(model);
  const pools = createPools();
  const overloads = model.overloads.map(overload => formatOverload(overload, pools));
  const dispatches = model.dispatches.map(formatDispatch);
  const dispatchNodes = model.dispatchNodes.map(node => formatDispatchNode(node, pools));
  const body = joinBlocks([
    pools.names.emit(),
    pools.places.emit(),
    pools.parameters.emit(),
    pools.transfers.emit(),
    pools.callbacks.emit(),
    pools.handlerCalls.emit(),
    pools.propertyActions.emit(),
    pools.resultProperties.emit(),
    pools.dispatchBranches.emit(),
    pools.results.emit(),
    pools.effects.emit(),
    pools.flows.emit(),
    pools.codes.emit(),
    emitArrayOfConstants("BuiltinPackedOverload", "builtinTableOverloads", "overload", overloads),
    emitArray("constinit const BuiltinDispatch builtinTableDispatches", dispatches),
    emitArray("constinit const BuiltinDispatchNode builtinTableDispatchNodes", dispatchNodes),
  ]);
  return wrapFile(["AOTBuiltinTable.h", "AOTBuiltinTableArrays.h"], body);
}

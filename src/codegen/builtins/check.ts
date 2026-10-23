import type { EffectsSummary, Schema } from "../aot-schema/load.ts";
import { cap } from "../helpers.ts";
import { isObjectKind } from "./build-entries.ts";
import { admits } from "./build-types.ts";
import { checkDependencies } from "./check-dependencies.ts";
import { checkDirectEntries } from "./check-direct-entries.ts";
import { checkHostUses, checkNamesReadByNativeCode } from "./check-host-uses.ts";
import { checkInstanceTests } from "./check-instance-tests.ts";
import { checkOperandTypes } from "./check-operand-types.ts";
import { checkOverloads, describeOverload } from "./check-overloads.ts";
import type { Problems } from "./declarations.ts";
import { describeOperand, isSameOperand, parameterAt } from "./dispatch.ts";
import { slotTokenOf } from "./emit-cpp-names.ts";
import { defaultMutabilityOf } from "./model-builder.ts";
import type {
  ModelBuiltin,
  ModelCallback,
  ModelClass,
  ModelCondition,
  ModelFunction,
  ModelHandlerCall,
  ModelImplementation,
  ModelKey,
  ModelName,
  ModelOperand,
  ModelOverload,
  ModelParameter,
  ModelPlace,
  ModelRealmStructure,
  ModelType,
  ModelTypePart,
  TableModel,
} from "./model.ts";
import { globalThisPath } from "./paths.ts";
import {
  contentsSlots,
  conversionProtocols,
  effectsOfHeapCapability,
  operandUses,
  pristineAspects,
  protocols,
  typedResultForms,
  type BuiltinKind,
  type CallbackTimes,
  type FeatureName,
  type InlineBuiltinName,
  type OperandRole,
  type Primitive,
} from "./vocabulary.ts";

const allocatorHeap = "AllocatorState";
const promiseClassToken = "Promise";
const functionClassToken = "Function";
const engineFileExtension = ".ts";
const cppIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const maximumOwnSlotOffset = 0xff;

const restatedLists = [
  { list: "operandUses", words: operandUses, declaredAs: "flags", name: "OperandUse" },
  { list: "protocols", words: protocols, declaredAs: "flags", name: "Protocol" },
  { list: "pristineAspects", words: pristineAspects, declaredAs: "flags", name: "PristineAspects" },
  { list: "contentsSlots", words: contentsSlots, declaredAs: "enums", name: "ContentsSlot" },
  { list: "typedResultForms", words: typedResultForms, declaredAs: "enums", name: "TypedResultForm" },
] as const;

const functionKinds: ReadonlySet<BuiltinKind> = new Set(["Constructor", "Function", "Method", "Accessor"]);
const privateAliasKinds: ReadonlySet<BuiltinKind> = new Set(["Method", "Accessor", "Function"]);

const describeFunction = (named: ModelFunction): string => `${named.file}: ${named.name}`;
const describeGuard = (feature: FeatureName | null): string => feature ?? "no feature";
const describeMissingInlineBuiltin = (name: InlineBuiltinName): string =>
  `the schema declares no inline built-in ${name}`;
const describeMissingSlowPath = (name: InlineBuiltinName): string =>
  `the inline built-in ${name} gets no slow path here, and the schema does not declare it optionalSlowPath`;

function report(problems: Problems, overload: ModelOverload, message: string): void {
  problems.add(overload.source, `${describeOverload(overload)}: ${message}`);
}

const operandsOf = (overload: ModelOverload): readonly ModelParameter[] =>
  overload.receiver === null ? overload.parameters : [overload.receiver, ...overload.parameters];

const instanceClassesOf = (type: ModelType): ModelClass[] =>
  type.parts.flatMap(part => (part.part === "Instance" ? [part.class] : []));

function parametersNamedBy(overload: ModelOverload, operand: ModelOperand): readonly ModelParameter[] {
  if (operand.operand === "ArgumentsFrom") {
    const { index } = operand;
    const following = overload.parameters.filter(
      ({ operand: declared }) => declared.operand !== "Receiver" && declared.index >= index,
    );
    if (following.length > 0) return following;
  }
  const parameter = parameterAt(overload, operand);
  return parameter === null ? [] : [parameter];
}

function convertsTo(overload: ModelOverload, operand: ModelOperand, primitive: Primitive): boolean {
  const named = parametersNamedBy(overload, operand);
  return named.length > 0 && named.every(parameter => admits(parameter.converted, primitive));
}

function operandOfPlace(place: ModelPlace): ModelOperand | null {
  switch (place.place) {
    case "Operand":
    case "Slot":
    case "IteratedValues":
    case "OwnValues":
    case "Prototype":
    case "Member":
      return place.operand;
    case "None":
    case "Result":
    case "ResultSlot":
    case "ResultField":
    case "NewValue":
    case "NativeMemory":
    case "NativeCell":
      return null;
  }
}

function operandOfKey(key: ModelKey): ModelOperand | null {
  switch (key.key) {
    case "Operand":
    case "ElementsOf":
      return key.operand;
    case "None":
    case "Names":
    case "Indexes":
    case "Any":
      return null;
  }
}

function placesOf(overload: ModelOverload): ModelPlace[] {
  const { transfers, callbacks, propertyActions, handlerCalls } = overload.flow;
  return [
    ...handlerCalls.flatMap(({ callee, thisValue, arguments: passed }) => [callee, thisValue, ...passed]),
    ...transfers.flatMap(({ from, to }) => [from, to]),
    ...callbacks.flatMap(({ newTarget, thisValue, arguments: passed, spreadArguments, resultTo }) => [
      newTarget,
      thisValue,
      ...passed,
      spreadArguments,
      resultTo,
    ]),
    ...propertyActions.map(action => action.value),
  ];
}

function collectParts(type: ModelType, visited: Set<ModelType>, parts: ModelTypePart[]): void {
  if (visited.has(type)) return;
  visited.add(type);
  for (const part of type.parts) {
    parts.push(part);
    if (part.part !== "Instance") continue;
    for (const contents of part.contents) collectParts(contents.type, visited, parts);
  }
}

function partsOf(overload: ModelOverload): ModelTypePart[] {
  const parts: ModelTypePart[] = [];
  const visited = new Set<ModelType>();
  collectParts(overload.result.type, visited, parts);
  for (const place of placesOf(overload)) {
    if (place.place === "NewValue") collectParts(place.type, visited, parts);
  }
  return parts;
}

function hasSlowPath(implementation: ModelImplementation): boolean {
  switch (implementation.how) {
    case "Inline":
      return implementation.otherwise !== null;
    case "Generic":
    case "HostCall":
    case "Compiled":
      return true;
    case "Number":
    case "Cell":
    case "CachedGetter":
    case "OwnSlot":
      return false;
  }
}

function reportSharedTokens(items: Iterable<readonly [token: string, text: string]>, problems: Problems): void {
  const firstTexts = new Map<string, string>();
  for (const [token, text] of items) {
    const firstText = firstTexts.get(token);
    if (firstText === undefined) firstTexts.set(token, text);
    else problems.add(null, `${firstText} and ${text} have the same token ${token}`);
  }
}

function formatComponent({ kind, text }: ModelName, isFirst: boolean): string {
  switch (kind) {
    case "RegisteredSymbol":
      return `[Symbol.for("${text}")]`;
    case "WellKnownSymbol":
      return `[Symbol.${text}]`;
    case "Text":
      return isFirst ? text : `.${text}`;
  }
}

// Neither half of the table holds the text of an entry: BuiltinTable::textOf() and text_of() in lookup.rs write it like this.
function checkTextsFollowFromNames(model: TableModel, problems: Problems): void {
  for (const builtin of model.builtins) {
    const names = [builtin.name];
    for (let holder = builtin.holder; holder !== null && holder.text !== globalThisPath; holder = holder.holder) {
      names.unshift(holder.name);
    }
    const text = names.map((name, index) => formatComponent(name, index === 0)).join("");
    if (text !== builtin.text)
      problems.add(null, `${builtin.text} is ${text} by its name and the names of its holders`);
  }
}

function reportRepeated(itemKind: string, values: readonly string[], problems: Problems): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) problems.add(null, `two ${itemKind} are named ${value}`);
    seen.add(value);
  }
}

export function checkSchemaWords(schema: Schema, problems: Problems): void {
  for (const { list, words, declaredAs, name } of restatedLists) {
    const declared = schema[declaredAs].get(name);
    if (declared === undefined) {
      problems.add(null, `vocabulary.ts restates ${name} as ${list}, and the schema's ${declaredAs} have no ${name}`);
    } else if (declared.join(" ") !== words.join(" ")) {
      problems.add(
        null,
        `${list} in vocabulary.ts is "${words.join(" ")}", and ${name} in the schema is "${declared.join(" ")}"`,
      );
    }
  }
}

function checkSchemaSymbols(model: TableModel, schema: Schema, problems: Problems): void {
  const declared = schema.enums.get("WellKnownSymbol");
  if (declared === undefined) {
    problems.add(null, "the schema has no enum WellKnownSymbol");
    return;
  }
  const constants = new Map<string, ModelBuiltin>();
  for (const builtin of model.builtins) {
    if (builtin.constant?.constant === "Symbol") constants.set(cap(builtin.constant.name.text), builtin);
  }
  for (const symbol of declared) {
    if (!constants.has(symbol)) problems.add(null, `no entry is the well-known symbol ${symbol} of the schema`);
  }
  for (const [symbol, builtin] of constants) {
    if (declared.includes(symbol)) continue;
    problems.add(null, `${builtin.text} is a well-known symbol, and WellKnownSymbol in the schema has no ${symbol}`);
  }
  for (const { kind, text } of model.names) {
    if (kind !== "WellKnownSymbol" || constants.has(cap(text))) continue;
    problems.add(null, `@@${text} is written as a well-known symbol, and no entry Symbol.${text} is one`);
  }
}

function checkSchemaExternals(model: TableModel, schema: Schema, problems: Problems): void {
  const tokensByExternal = new Map<string, ReadonlySet<string>>([
    ["Builtin", new Set(model.builtins.map(builtin => builtin.token))],
    ["BuiltinClass", new Set(model.classes.map(builtinClass => builtinClass.token))],
    ["BuiltinName", new Set(model.names.flatMap(name => name.cppConstant ?? []))],
    ["BuiltinLayout", new Set(model.layouts.map(layout => layout.token))],
    ["BuiltinSlot", new Set(model.slots.map(slotTokenOf))],
  ]);
  for (const [external, members] of schema.externals) {
    const tokens = tokensByExternal.get(external);
    for (const member of members) {
      if (tokens?.has(member)) continue;
      problems.add(null, `the schema names ${member} of ${external}, and the table has no such token`);
    }
  }
}

function checkUniqueTokens(model: TableModel, problems: Problems): void {
  const nameConstants = model.names.flatMap(({ cppConstant, kind, text }): [string, string][] =>
    cppConstant === null ? [] : [[cppConstant, `the ${kind} name ${text}`]],
  );
  const slotTokens = model.slots.map((slot): [string, string] => [
    slotTokenOf(slot),
    `the slot ${slot.name.text} of ${slot.owner.token}`,
  ]);
  reportSharedTokens(
    model.builtins.map(({ token, text }): [string, string] => [token, text]),
    problems,
  );
  reportSharedTokens(nameConstants, problems);
  reportSharedTokens(
    model.classes.map(({ token }): [string, string] => [token, `a class ${token}`]),
    problems,
  );
  reportSharedTokens(slotTokens, problems);
  reportSharedTokens(
    model.layouts.map(({ token }): [string, string] => [token, `a layout ${token}`]),
    problems,
  );
  reportSharedTokens(
    model.modules.map(({ token, specifier }): [string, string] => [token, `the module ${specifier}`]),
    problems,
  );
}

function inheritedObjectOf(builtin: ModelBuiltin): ModelBuiltin | null {
  if (builtin.prototype.link !== "Builtin") return null;
  return builtin.prototype.builtin.sameObjectAs ?? builtin.prototype.builtin;
}

function checkInheritance(model: TableModel, problems: Problems): void {
  const finished = new Set<ModelBuiltin>();
  for (const builtin of model.builtins) {
    const chain = new Set<ModelBuiltin>();
    let current: ModelBuiltin | null = builtin;
    while (current !== null && !finished.has(current) && !chain.has(current)) {
      chain.add(current);
      current = inheritedObjectOf(current);
    }
    if (current !== null && chain.has(current)) {
      const links = [...chain];
      const cycle = links.slice(links.indexOf(current));
      const through = cycle.length > 1 ? cycle.slice(1) : cycle;
      problems.add(null, `${current.text} inherits from itself through ${through.map(link => link.text).join(", ")}`);
    }
    for (const link of chain) finished.add(link);
  }
}

function checkClosureInstances(model: TableModel, problems: Problems): void {
  for (const builtinClass of model.classes) {
    if (!builtinClass.hasClosureInstances) continue;
    let ancestor = builtinClass.parent;
    while (ancestor !== null && ancestor.token !== functionClassToken) ancestor = ancestor.parent;
    if (ancestor === null) {
      problems.add(null, `the class ${builtinClass.token} has closure instances, so it extends ${functionClassToken}`);
    }
  }
}

function checkInstancesThatAreEntries(model: TableModel, problems: Problems): void {
  for (const builtinClass of model.classes) {
    if (!builtinClass.instancesAreEntries) continue;
    const { constructor, prototype, token } = builtinClass;
    if (constructor !== null)
      problems.add(null, `the instances of ${token} are entries, and it has a constructor, which makes others`);
    const isInstance = (builtin: ModelBuiltin): boolean =>
      builtin.prototype.link === "Builtin" && builtin.prototype.builtin === prototype;
    if (prototype === null || !model.builtins.some(isInstance)) {
      problems.add(null, `the instances of ${token} are entries, and no entry inherits from its prototype`);
    }
  }
}

// The flow analysis writes what the types say onto each new instance, and takes nothing else for what native code puts there.
function checkTypesOfNamesDefinedOnNewInstances(model: TableModel, problems: Problems): void {
  for (const builtinClass of model.classes) {
    const { token, namesDefinedOnNewInstances, typesOfNamesDefinedOnNewInstances, namesMadeByStaticMembers } =
      builtinClass;
    const isListed = (name: ModelName): boolean => namesDefinedOnNewInstances?.includes(name) ?? false;
    for (const { name, type } of typesOfNamesDefinedOnNewInstances) {
      if (!isListed(name))
        problems.add(
          null,
          `the class ${token} gives ${name.text} a type, and namesDefinedOnNewInstances does not list it`,
        );
      if (type.isAnything || type.hasAnyObject || type.hasAnyFunction || type.hasPlainData || type.parts.length > 0) {
        problems.add(null, `the class ${token} gives ${name.text} a type that is not made of primitives alone`);
      }
    }
    for (const { name } of namesMadeByStaticMembers) {
      if (!isListed(name))
        problems.add(
          null,
          `the class ${token} says what makes ${name.text}, and namesDefinedOnNewInstances does not list it`,
        );
      if (builtinClass.constructor === null)
        problems.add(null, `the class ${token} says which static member makes ${name.text}, and it has no constructor`);
    }
    if (builtinClass.constructorOnlyReadsPrototypeOfNewTarget && builtinClass.constructor === null) {
      problems.add(null, `the class ${token} says what its constructor reads, and it has none`);
    }
  }
}

function extendsClass(builtinClass: ModelClass, ancestor: ModelClass): boolean {
  let current: ModelClass | null = builtinClass;
  while (current !== null && current !== ancestor) current = current.parent;
  return current !== null;
}

// The test compares with the Structures that closures are created with, which inherit from Function.prototype.
function checkPristineTests(model: TableModel, problems: Problems): void {
  const functionClass = model.classes.find(builtinClass => builtinClass.token === functionClassToken);
  for (const { pristineTest, isNeverPristine, prototype, token, instanceStructureCppExpression } of model.classes) {
    if (pristineTest === "Mark") continue;
    if (!isNeverPristine) {
      problems.add(
        null,
        `the class ${token} has the test ${pristineTest}, so no mark of a Structure answers for it: it is isNeverPristine`,
      );
    }
    if (pristineTest === "InstanceStructure") {
      if (instanceStructureCppExpression === null) {
        problems.add(
          null,
          `the class ${token} has the test ${pristineTest} and does not name the Structure of its instances (instanceStructureCppExpression)`,
        );
      }
      continue;
    }
    if (prototype === null || prototype !== functionClass?.prototype) {
      problems.add(
        null,
        `the class ${token} has the test ${pristineTest}, and its prototype is not that of ${functionClassToken}`,
      );
    }
  }
}

function hasAttachments({ attachments }: ModelBuiltin): boolean {
  return Object.values(attachments).some(value => (Array.isArray(value) ? value.length > 0 : value !== null));
}

function checkSameObjects(model: TableModel, problems: Problems): void {
  for (const builtin of model.builtins) {
    const original = builtin.sameObjectAs;
    if (original === null) continue;
    const relation = `${builtin.text} is the same object as ${original.text}`;
    if (original.sameObjectAs !== null) {
      problems.add(null, `${relation}, which is the same object as ${original.sameObjectAs.text}`);
    }
    if (!isObjectKind(original.kind)) problems.add(null, `${relation}, which is a ${original.kind} and not an object`);
    if (builtin.overloads.length > 0) problems.add(null, `${relation}, so it has no overloads of its own`);
    if (builtin.members.length > 0) problems.add(null, `${relation}, so it has no members of its own`);
    if (builtin.constant !== null || hasAttachments(builtin)) {
      problems.add(null, `${relation}, so it has no columns of its own`);
    }
  }
}

function checkHolders(model: TableModel, problems: Problems): void {
  for (const builtin of model.builtins) {
    const { holder } = builtin;
    if (holder === null) continue;
    if (!isObjectKind(holder.kind)) {
      problems.add(null, `the holder of ${builtin.text} is a ${holder.kind}, which is not an object`);
    }
    const missing = builtin.platforms.filter(platform => !holder.platforms.includes(platform));
    if (missing.length > 0) {
      problems.add(null, `${builtin.text} exists on ${missing.join(", ")}, where its holder ${holder.text} does not`);
    }
  }
}

const receiverClassesOf = ({ receiver }: ModelOverload): ModelClass[] =>
  receiver === null ? [] : [receiver.accepted, receiver.converted].flatMap(instanceClassesOf);

function resultClassesOf(overload: ModelOverload): ModelClass[] {
  return overload.result.type.parts.flatMap(part => {
    switch (part.part) {
      case "Instance":
        return [part.class];
      case "InstanceOfReceiverClass":
      case "TypedArrayOfReceiverElementType":
        return receiverClassesOf(overload);
      case "Layout":
      case "Builtin":
      case "Operand":
      case "Slot":
      case "IteratedValues":
      case "CallbackResult":
      case "Prototype":
        return [];
    }
  });
}

const actionsStoringWhatTheyRead: readonly string[] = ["ReadsByKey", "ReadsGetter", "ReadsSetter"];

function placesStoredInto(overload: ModelOverload): ModelPlace[] {
  const { transfers, callbacks, propertyActions } = overload.flow;
  return [
    ...transfers.map(({ to }) => to),
    ...callbacks.map(({ resultTo }) => resultTo),
    ...propertyActions.flatMap(action => (actionsStoringWhatTheyRead.includes(action.action) ? [action.value] : [])),
  ];
}

// "It holds only what is stored" is said where a record stores, and by every record that stores into the field.
export function checkFieldsHoldingOnlyWhatIsStored(overload: ModelOverload, problems: Problems): void {
  const stored = placesStoredInto(overload).filter(place => place.place === "ResultField");
  for (const place of placesOf(overload)) {
    if (place.place !== "ResultField" || !place.holdsOnlyWhatIsStored) continue;
    if (!stored.includes(place))
      report(
        problems,
        overload,
        `field ${place.index} of the result is said to hold only what is stored there by a record that stores nothing into it`,
      );
    else if (stored.some(other => other.index === place.index && !other.holdsOnlyWhatIsStored))
      report(
        problems,
        overload,
        `one record says that field ${place.index} of the result holds only what is stored there, and another that stores into it does not`,
      );
  }
}

function checkResultPlaces(overload: ModelOverload, problems: Problems): void {
  checkFieldsHoldingOnlyWhatIsStored(overload, problems);
  const classes = resultClassesOf(overload);
  const layouts = overload.result.type.parts.flatMap(part => (part.part === "Layout" ? [part.layout] : []));
  for (const place of placesOf(overload)) {
    if (place.place === "ResultSlot") {
      const { slot } = place;
      if (classes.length > 0 && classes.every(resultClass => resultClass.slots.includes(slot))) continue;
      report(problems, overload, `${slot.name.text} is not a slot of every class of the result`);
    } else if (place.place === "ResultField") {
      const { index } = place;
      if (layouts.length > 0 && layouts.every(layout => index < layout.fields.length)) continue;
      report(problems, overload, `${index} is not a field of every layout of the result`);
    }
  }
}

function checkResults(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    const { type } = overload.result;
    const namesReceiverClass = type.parts.some(
      part => part.part === "InstanceOfReceiverClass" || part.part === "TypedArrayOfReceiverElementType",
    );
    if (namesReceiverClass && receiverClassesOf(overload).length === 0) {
      report(problems, overload, "b.sameClass and b.sameElementType need a receiver that is an instance");
    }
    checkResultPlaces(overload, problems);
    if (type.freshness !== "No" && overload.effects.capability === "none") {
      report(problems, overload, 'it returns a new object, so its capability is "heap" or "js"');
    }
  }
}

function checkEffects(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    const { capability, reads, writes } = overload.effects;
    if (reads.includes(allocatorHeap) || writes.includes(allocatorHeap)) {
      report(problems, overload, `the capability says whether it allocates, so ${allocatorHeap} is not listed`);
    }
    if (capability === "js") continue;
    if (overload.flags.includes("RunsOnlyOperandCode")) {
      report(problems, overload, `runsOnlyOperandCode goes with the capability "js", not "${capability}"`);
    }
    for (const { callee, times } of overload.flow.callbacks) {
      if (isCalledAfterReturn(times)) continue;
      report(problems, overload, `it calls ${describeOperand(callee)} before it returns, so its capability is "js"`);
    }
    if (overload.flow.handlerCalls.some(({ times }) => !isCalledAfterReturn(times))) {
      report(problems, overload, 'it calls a handler before it returns, so its capability is "js"');
    }
    if (overload.proof === "ByConstruction") continue;
    for (const { operand, conversion, protocols: run } of operandsOf(overload)) {
      const written = run.filter(protocol => !conversionProtocols[conversion].includes(protocol));
      if (written.length === 0) continue;
      const subject = describeOperand(operand);
      report(problems, overload, `it runs ${written.join(", ")} of ${subject}, so its capability is "js"`);
    }
  }
}

const isCalledAfterReturn = (times: CallbackTimes): boolean => times === "Later" || times === "PerEvent";

const isRestOperand = (place: ModelPlace): boolean =>
  place.place === "Operand" && place.operand.operand === "ArgumentsFrom";

function checkCallback(overload: ModelOverload, callback: ModelCallback, problems: Problems): void {
  const callee = parameterAt(overload, callback.callee);
  if (callee === null) {
    report(problems, overload, `it calls ${describeOperand(callback.callee)}, which it does not have`);
  } else if (!admits(callee.accepted, "Function") && !admits(callee.converted, "Function")) {
    report(problems, overload, `it calls ${describeOperand(callback.callee)}, which is never a function`);
  }
  if ((callback.resultUse === "Stored") !== (callback.resultTo.place !== "None")) {
    report(problems, overload, 'the result "Stored" of a callback and the place it is stored in go together');
  }
  const restPosition = callback.arguments.findIndex(isRestOperand);
  const isForwardedLast = restPosition === callback.arguments.length - 1 && callback.spreadArguments.place === "None";
  if (restPosition !== -1 && !isForwardedLast) {
    report(problems, overload, "a rest operand among the arguments of a callback is the last one, with no spreadArgs");
  }
  const hasElements = operandsOf(overload).some(
    ({ uses, protocols: run }) => uses.includes("ReadsContents") || run.includes("Iterate"),
  );
  if (callback.times === "PerElement" && !hasElements) {
    report(problems, overload, "a callback per element needs an operand whose contents are read or that is iterated");
  }
}

function checkHandlerCall(
  overload: ModelOverload,
  { callee, times, resultUse }: ModelHandlerCall,
  problems: Problems,
): void {
  if (resultUse !== "Escapes" && resultUse !== "Ignored") {
    report(problems, overload, `the result of a handler escapes or is ignored, and is not ${resultUse}`);
  }
  if (times === "PerElement") report(problems, overload, "a handler is not called per element");
  if (callee.place !== "Member") return;
  if (!isCalledAfterReturn(times)) {
    report(problems, overload, "a member that is called before the call returns is written with b.calls");
  }
  const holder = parameterAt(overload, callee.operand);
  if (callee.path.length > 1 && holder !== null && !holder.uses.includes("AppliesTransitively")) {
    const subject = describeOperand(callee.operand);
    report(
      problems,
      overload,
      `a path of several steps reads what ${subject} holds, so the protocols of ${subject} run transitively`,
    );
  }
}

function checkCallbacks(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    const { callbacks, handlerCalls } = overload.flow;
    for (const callback of callbacks) checkCallback(overload, callback, problems);
    for (const call of handlerCalls) checkHandlerCall(overload, call, problems);
    for (const part of partsOf(overload)) {
      if (part.part !== "CallbackResult") continue;
      const { operand } = part;
      const reachesType = callbacks.some(
        ({ callee, resultUse }) =>
          isSameOperand(callee, operand) && (resultUse === "Returned" || resultUse === "Stored"),
      );
      if (reachesType) continue;
      report(
        problems,
        overload,
        `a type has the result of ${describeOperand(operand)}, so a callback of it has the result "Returned" or "Stored"`,
      );
    }
  }
}

function checkPropertyActions(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    for (const { action, object, key, value } of overload.flow.propertyActions) {
      for (const operand of [object, operandOfKey(key), operandOfPlace(value)]) {
        if (operand === null || parameterAt(overload, operand) !== null) continue;
        report(problems, overload, `${action} names ${describeOperand(operand)}, which it does not have`);
      }
      if (key.key === "Names" && key.names.length === 0) report(problems, overload, `${action} lists no name`);
    }
  }
}

function needsText(role: OperandRole): boolean {
  switch (role) {
    case "EvaluatedAsText":
    case "ModuleSpecifier":
    case "ReadAsCharacters":
      return true;
    case "Locale":
    case "ContentKey":
    case "ReplacesContents":
    case "MembersAreOnlyInspected":
    case "KeysAreNotListed":
    case "MembersAreOfObjectsOnly":
    case "FunctionsAreConvertedUnderNamesOnly":
    case "BecomesLengthOfReceiver":
    case "CopiesHolesToResult":
      return false;
  }
}

function checkRoles(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    for (const { operand, roles, converted } of operandsOf(overload)) {
      const textRoles = roles.filter(needsText);
      if (textRoles.length === 0 || admits(converted, "String")) continue;
      report(problems, overload, `${describeOperand(operand)} is ${textRoles.join(", ")} and is never a string`);
    }
  }
}

const holdsStrings = (type: ModelType): boolean =>
  type.parts.some(part => part.part === "Instance" && part.contents.some(({ type: held }) => admits(held, "String")));

function checkRangeRules(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    const { type, rangeRule, rangeOperand, substringOf } = overload.result;
    if (rangeRule !== "None" && !admits(type, "Number")) {
      report(problems, overload, `the range rule ${rangeRule} needs a result with numbers`);
    }
    if (rangeRule !== "None" && (rangeOperand === null || !convertsTo(overload, rangeOperand, "Number"))) {
      report(problems, overload, `the range rule ${rangeRule} applies to an operand that is a number`);
    }
    if (substringOf === null) continue;
    if (!admits(type, "String") && !holdsStrings(type)) {
      report(problems, overload, "substringOf needs a result with strings, or an array that holds them");
    }
    if (!convertsTo(overload, substringOf, "String")) {
      report(problems, overload, `substringOf names ${describeOperand(substringOf)}, which is never a string`);
    }
  }
}

function checkIteration(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    const { type, iteratedOperand } = overload.result;
    if (iteratedOperand === null) continue;
    const subject = describeOperand(iteratedOperand);
    const iterated = parameterAt(overload, iteratedOperand);
    if (iterated === null) {
      report(problems, overload, `iterates names ${subject}, which it does not have`);
      continue;
    }
    if (type.freshness === "No") report(problems, overload, "iterates needs a result that is a new object");
    const classes = instanceClassesOf(iterated.converted);
    for (const iteratedClass of classes) {
      if (iteratedClass.slots.some(slot => slot.indexInType !== null)) continue;
      report(problems, overload, `iterates: the class ${iteratedClass.token} has no slot that is part of its type`);
    }
    if (classes.length > 0 && !iterated.uses.includes("Retains")) {
      report(problems, overload, `the iterator retains ${subject}, so a use of ${subject} stores or retains it`);
    }
  }
}

function checkPrototypeSources(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    const { type, prototypeSource, properties } = overload.result;
    if (properties.length > 0 && type.freshness === "No") {
      report(problems, overload, "resultProperties needs a result that is a new object");
    }
    if (prototypeSource === null) continue;
    if (parameterAt(overload, prototypeSource) === null) {
      report(problems, overload, `prototypeSource names ${describeOperand(prototypeSource)}, which it does not have`);
    }
    if (type.freshness === "No") report(problems, overload, "prototypeSource needs a result that is a new object");
  }
}

function checkTypedResults(model: TableModel, problems: Problems): void {
  const promiseClass = model.classes.find(builtinClass => builtinClass.token === promiseClassToken);
  for (const overload of model.overloads) {
    const { type, typedResultForm, typedResultSource } = overload.result;
    if (typedResultForm === "None") continue;
    if (typedResultSource === null || parameterAt(overload, typedResultSource) === null) {
      report(problems, overload, `typedResultForm ${typedResultForm} names a source it does not have`);
      continue;
    }
    if (overload.code.model !== null) {
      report(
        problems,
        overload,
        `typedResultForm ${typedResultForm} is applied with the records, which a model replaces`,
      );
    }
    const isTypedByCaller =
      type.isAnything ||
      type.hasPlainData ||
      type.parts.some(
        part =>
          (part.part === "Instance" && part.class === promiseClass) ||
          (part.part === "Operand" && isSameOperand(part.operand, typedResultSource)),
      );
    if (isTypedByCaller) continue;
    report(
      problems,
      overload,
      `typedResultForm ${typedResultForm} needs a result that is plain data, anything, a Promise or its source`,
    );
  }
}

function checkImplementationKind(overload: ModelOverload, problems: Problems): void {
  const { builtin, mode } = overload;
  const { implementation } = overload.code;
  const accessesProperty = builtin.kind === "DataProperty" && (mode === "Get" || mode === "Set");
  const callsNothing =
    implementation.how === "Generic" ||
    implementation.how === "OwnSlot" ||
    (implementation.how === "Inline" && !hasSlowPath(implementation));
  if (accessesProperty && !callsNothing) {
    report(
      problems,
      overload,
      `${builtin.text} is a property, so it is b.generic, b.ownSlot or b.inline without otherwise`,
    );
  }
  if (implementation.how === "CachedGetter" && (builtin.kind !== "Accessor" || mode !== "Get")) {
    report(problems, overload, "only the Get overload of an accessor is a cached getter");
  }
}

const instanceClassOfHolder = ({ holder }: ModelBuiltin): ModelClass | null =>
  holder !== null && holder.kind === "Prototype" ? holder.instanceClass : null;

function isOnlyInstancesOf(type: ModelType, instanceClass: ModelClass): boolean {
  const hasOtherValues =
    type.isAnything ||
    type.hasAnyObject ||
    type.hasAnyFunction ||
    type.hasPlainData ||
    type.primitives.length > 0 ||
    type.integers !== null ||
    type.stringLiterals.length > 0;
  if (hasOtherValues || type.parts.length === 0) return false;
  return type.parts.every(part => part.part === "Instance" && extendsClass(part.class, instanceClass));
}

function checkCustomGetter(overload: ModelOverload, problems: Problems): void {
  const { builtin, mode, receiver } = overload;
  const { implementation } = overload.code;
  if (implementation.how !== "HostCall") return;
  const { callee, customGetter } = implementation;
  if ((callee === "CustomGetter") !== (customGetter !== null)) {
    report(problems, overload, "the callee CustomGetter and the symbol of the native getter go together");
  }
  if (customGetter === null) return;
  const instanceClass = instanceClassOfHolder(builtin);
  if (builtin.kind !== "Accessor" || mode !== "Get" || instanceClass === null) {
    report(problems, overload, "only the Get overload of an accessor of a prototype enters a custom getter");
    return;
  }
  if (builtin.origin !== "Host") {
    report(
      problems,
      overload,
      `${customGetter} is bound with the functions of the host, and the entry is the engine's`,
    );
  }
  if (!builtin.attachments.nativeSymbols.includes(customGetter)) {
    report(problems, overload, `${customGetter} is entered by its address, so nativeSymbols lists it`);
  }
  const isTested = instanceClass.instanceTest !== "None";
  if (!isTested || receiver === null || !isOnlyInstancesOf(receiver.accepted, instanceClass)) {
    report(
      problems,
      overload,
      `${customGetter} does not test its receiver, so the overload takes only instances of ${instanceClass.token}, which has an instance test`,
    );
  }
}

function namesDefinedOnInstancesOf(builtinClass: ModelClass): Set<ModelName> | null {
  const names = new Set<ModelName>();
  for (let current: ModelClass | null = builtinClass; current !== null; current = current.parent) {
    if (current.namesDefinedOnNewInstances === null) return null;
    for (const name of current.namesDefinedOnNewInstances) names.add(name);
  }
  return names;
}

const describeNames = (names: readonly ModelName[]): string => `[${names.map(name => name.text).join(", ")}]`;

function isSameStructure(structure: ModelRealmStructure, getter: string, names: readonly ModelName[]): boolean {
  return (
    structure.getter === getter &&
    structure.names.length === names.length &&
    structure.names.every((name, index) => name === names[index])
  );
}

function checkOwnSlot(overload: ModelOverload, model: TableModel, problems: Problems): void {
  const { builtin, mode, source } = overload;
  const { implementation } = overload.code;
  if (implementation.how !== "OwnSlot") return;
  const { structure, offset } = implementation;
  const { getter, names } = structure;
  const instanceClass = instanceClassOfHolder(builtin);
  const isOwnProperty = builtin.kind === "DataProperty" && builtin.flags.includes("IsOwnPropertyOfInstances");
  if (!isOwnProperty || mode !== "Get" || instanceClass === null) {
    report(problems, overload, "only the Get overload of an own property of the instances of a class is an own slot");
    return;
  }
  if (source.origin !== "Engine") {
    report(
      problems,
      overload,
      `a getter of JSGlobalObject answers the Structure ${getter}, so a declaration file of the engine names it`,
    );
  }
  if (!cppIdentifierPattern.test(getter)) {
    report(problems, overload, `${JSON.stringify(getter)} is not the name of a getter of JSGlobalObject`);
  }
  if (!overload.result.type.isAnything && builtin.mutability !== "AlwaysLocked") {
    report(
      problems,
      overload,
      "a store to the property keeps the Structure, so an own slot that is not AlwaysLocked holds b.any",
    );
  }
  if (offset !== names.length - 1 || names.at(-1) !== builtin.name || offset > maximumOwnSlotOffset) {
    report(
      problems,
      overload,
      `the names ${describeNames(names)} do not put ${builtin.name.text} at the offset ${offset}`,
    );
  }
  if (new Set(names).size !== names.length) {
    report(problems, overload, `the names ${describeNames(names)} list a property twice`);
  }
  const defined = namesDefinedOnInstancesOf(instanceClass);
  for (const name of names) {
    if (defined === null || defined.has(name)) continue;
    report(
      problems,
      overload,
      `namesDefinedOnNewInstances of ${instanceClass.token} and the classes above does not list ${name.text}`,
    );
  }
  const ahead = names.slice(0, -1);
  if (ahead.length > 0 && !model.realmStructures.some(other => isSameStructure(other, getter, ahead))) {
    report(
      problems,
      overload,
      `it comes after ${describeNames(ahead)}, and ${ahead.at(-1)?.text} is no own slot of ${getter} after the others`,
    );
  }
}

function checkInlineSlowPath(overload: ModelOverload, schema: Schema, problems: Problems): void {
  const { implementation } = overload.code;
  if (implementation.how !== "Inline") return;
  const declared = schema.inlineBuiltins.get(implementation.builtin);
  if (declared === undefined) report(problems, overload, describeMissingInlineBuiltin(implementation.builtin));
  else if (!hasSlowPath(implementation) && !declared.hasOptionalSlowPath) {
    report(problems, overload, describeMissingSlowPath(implementation.builtin));
  }
  const { maximumArgumentCount } = implementation;
  if (maximumArgumentCount !== null && !hasSlowPath(implementation)) {
    report(
      problems,
      overload,
      `the inline built-in ${implementation.builtin} takes at most ${maximumArgumentCount} arguments here, so a call with more needs otherwise`,
    );
  }
}

function effectsBeyondOverload(overload: ModelOverload, declared: EffectsSummary, schema: Schema): string[] {
  const { capability, reads, writes } = overload.effects;
  const ofCapability =
    capability === "none" ? [] : effectsOfHeapCapability.flatMap(name => schema.namedEffects.get(name) ?? []);
  const readHeaps = new Set<string>([...reads, ...ofCapability.flatMap(effects => effects.reads)]);
  const writtenHeaps = new Set<string>([...writes, ...ofCapability.flatMap(effects => effects.writes)]);
  const flags = {
    unknownCode: declared.isUnknownCode,
    "reads(all)": declared.readsAllHeaps,
    "writes(all)": declared.writesAllHeaps,
    throws: declared.throws && !overload.flags.includes("Throws"),
    collects: declared.collects && !ofCapability.some(effects => effects.collects),
    suspends: declared.suspends,
    terminates: declared.terminates,
  };
  return [
    ...declared.reads.filter(heap => !readHeaps.has(heap)).map(heap => `reads(${heap})`),
    ...declared.writes.filter(heap => !writtenHeaps.has(heap)).map(heap => `writes(${heap})`),
    ...Object.entries(flags).flatMap(([word, isBeyond]) => (isBeyond ? [word] : [])),
  ];
}

function checkInlineEffects(overload: ModelOverload, schema: Schema, problems: Problems): void {
  const { implementation, fieldsForm, prefixForm } = overload.code;
  if (overload.effects.capability === "js" && !overload.flags.includes("RunsOnlyOperandCode")) return;
  // Not the list form: the call that it replaces reads the list too, which no overload states.
  const rows = [implementation.how === "Inline" ? implementation.builtin : null, fieldsForm, prefixForm];
  for (const row of new Set(rows)) {
    const declared = row === null ? undefined : schema.inlineBuiltins.get(row)?.effects;
    if (declared === undefined || declared === "asOverload") continue;
    const beyond = effectsBeyondOverload(overload, declared, schema);
    if (beyond.length === 0) continue;
    report(
      problems,
      overload,
      `the inline built-in ${row} declares effects that the overload does not have: ${beyond.join(", ")}`,
    );
  }
}

function checkFunctionPlatforms(builtin: ModelBuiltin, named: ModelFunction, problems: Problems): void {
  const missing = builtin.platforms.filter(platform => !named.platforms.includes(platform));
  if (missing.length === 0) return;
  problems.add(
    null,
    `${builtin.text}: ${describeFunction(named)} is missing on ${missing.join(", ")}, unlike the entry`,
  );
}

function checkImplementations(model: TableModel, schema: Schema, problems: Problems): void {
  for (const overload of model.overloads) {
    checkImplementationKind(overload, problems);
    checkCustomGetter(overload, problems);
    checkOwnSlot(overload, model, problems);
    checkInlineSlowPath(overload, schema, problems);
    checkInlineEffects(overload, schema, problems);
    const flowModel = overload.code.model;
    if (flowModel === null) continue;
    checkFunctionPlatforms(overload.builtin, flowModel, problems);
    if (flowModel.implements.length === 0) continue;
    report(problems, overload, `${describeFunction(flowModel)} is its model, and it also implements an overload`);
  }
  for (const named of model.functions) {
    for (const builtin of named.implements) checkFunctionPlatforms(builtin, named, problems);
  }
}

function checkOverloadForms(overload: ModelOverload, schema: Schema, problems: Problems): void {
  const { fieldsForm, prefixForm, prefixProperties, listForm } = overload.code;
  const { type } = overload.result;
  if (prefixProperties.length > 0 && prefixForm === null) {
    report(problems, overload, "prefixProperties lists what the prefix form returns, so the overload has a prefixForm");
  }
  for (const form of [fieldsForm, prefixForm, listForm]) {
    if (form === null || schema.inlineBuiltins.has(form)) continue;
    report(problems, overload, describeMissingInlineBuiltin(form));
  }
  for (const form of [fieldsForm, prefixForm]) {
    if (form === null) continue;
    if (schema.inlineBuiltins.get(form)?.hasOptionalSlowPath === false) {
      report(problems, overload, describeMissingSlowPath(form));
    }
    if (type.freshness !== "Yes" && type.freshness !== "Unaliased") {
      report(problems, overload, `${form} replaces the result object, so the result is .fresh or .unaliased`);
    }
  }
  if (fieldsForm !== null && !type.parts.some(part => part.part === "Layout")) {
    report(problems, overload, `${fieldsForm} returns the fields of the result, so the result has a layout`);
  }
}

function checkAppendForm(
  builtin: ModelBuiltin,
  calls: readonly ModelOverload[],
  schema: Schema,
  problems: Problems,
): void {
  const { appendForm } = builtin.attachments;
  if (appendForm === null) return;
  const declared = schema.inlineBuiltins.get(appendForm);
  if (declared === undefined) problems.add(null, `${builtin.text}: ${describeMissingInlineBuiltin(appendForm)}`);
  for (const overload of calls) {
    if (!admits(overload.result.type, "String")) {
      report(problems, overload, `${appendForm} appends the result, which is never a string`);
    }
    if (declared?.hasOptionalSlowPath === false && !hasSlowPath(overload.code.implementation)) {
      report(problems, overload, describeMissingSlowPath(appendForm));
    }
  }
}

function checkTextForm(builtin: ModelBuiltin, calls: readonly ModelOverload[], problems: Problems): void {
  const { jsonTextForm } = builtin.attachments;
  if (jsonTextForm === null) return;
  const { argument, builtin: form } = jsonTextForm;
  if (form.kind !== "Function") problems.add(null, `${builtin.text}: its jsonTextForm ${form.text} is not a function`);
  if (argument.operand === "Receiver") problems.add(null, `${builtin.text}: jsonTextForm takes an argument, not this`);
  for (const overload of calls) {
    if (parameterAt(overload, argument) !== null) continue;
    report(problems, overload, `jsonTextForm names ${describeOperand(argument)}, which it does not have`);
  }
}

function checkLiteralPartsForm(builtin: ModelBuiltin, problems: Problems): void {
  const { literalPartsForm } = builtin.attachments;
  if (literalPartsForm === null) return;
  const { argument, names, builtin: form } = literalPartsForm;
  if (form.kind !== "Function") {
    problems.add(null, `${builtin.text}: its literalPartsForm ${form.text} is not a function`);
  }
  if (!builtin.overloads.some(overload => parameterAt(overload, argument) !== null)) {
    problems.add(null, `${builtin.text}: literalPartsForm names ${describeOperand(argument)}, which no overload has`);
  }
  // The literal is the last argument of the call.
  const taken = (argument.operand === "Argument" ? argument.index : 0) + names.length;
  for (const overload of form.overloads) {
    if (overload.mode === "Call" && overload.receiver === null && overload.parameters.length === taken) continue;
    report(problems, overload, `${builtin.text} calls it with ${taken} arguments and without this`);
  }
}

function checkForms(model: TableModel, schema: Schema, problems: Problems): void {
  for (const overload of model.overloads) checkOverloadForms(overload, schema, problems);
  for (const builtin of model.builtins) {
    const calls = builtin.overloads.filter(({ mode, flags }) => mode === "Call" && !flags.includes("IsUndeclared"));
    checkAppendForm(builtin, calls, schema, problems);
    checkTextForm(builtin, calls, problems);
    checkLiteralPartsForm(builtin, problems);
  }
}

const mayBeObject = (type: ModelType): boolean =>
  type.isAnything || type.hasAnyObject || type.hasAnyFunction || type.hasPlainData || type.parts.length > 0;

function conditionsOf({ attachments }: ModelBuiltin): ModelCondition[] {
  const { featureUses, unseenCodeCondition, moduleLoads, calledFunctions } = attachments;
  return [
    ...featureUses.map(use => use.condition),
    unseenCodeCondition,
    ...moduleLoads.map(load => load.condition),
    ...calledFunctions.map(called => called.condition),
  ].flatMap(condition => condition ?? []);
}

// The analysis follows an object that the table names or gives a class, and a store into one is no store into an object nobody knows.
const answersWhatNobodyKnows = (overload: ModelOverload): boolean =>
  overload.flags.includes("IsUndeclared") || overload.result.type.isAnything || overload.result.type.parts.length === 0;

// Of the objects of the host, the analysis notes a store only into one that keeps strings.
const answersHostObjectWithoutNotedStores = (model: TableModel, overload: ModelOverload): boolean =>
  overload.flow.transfers.some(
    ({ from, to }) =>
      to.place === "Result" &&
      from.place === "NativeCell" &&
      model.hostObjects.some(object => object.cell === from.cell && !object.keepsStringsOfStoredValues),
  );

function inheritsFrom(builtin: ModelBuiltin, ancestor: ModelBuiltin | null): boolean {
  let current: ModelBuiltin | null = builtin;
  while (current !== null && current !== ancestor)
    current = current.prototype.link === "Builtin" ? current.prototype.builtin : null;
  return current !== null;
}

function checkConditions(model: TableModel, problems: Problems): void {
  for (const builtin of model.builtins) {
    for (const { operand, isOneOf, startsWith, calledOn, hasProperty, objectNobodyKnowsIsWritten } of conditionsOf(
      builtin,
    )) {
      if (calledOn !== null && !inheritsFrom(calledOn, builtin.holder)) {
        problems.add(
          null,
          `${builtin.text}: a condition is about a call on ${calledOn.text}, which does not inherit the method`,
        );
      }
      const reads = builtin.overloads.filter(overload => overload.mode === "Get");
      if (
        objectNobodyKnowsIsWritten &&
        !reads.every(
          overload => answersWhatNobodyKnows(overload) && !answersHostObjectWithoutNotedStores(model, overload),
        )
      ) {
        problems.add(
          null,
          `${builtin.text}: a condition is about stores into what the entry answers, and the table describes that object`,
        );
      }
      if (hasProperty === null) continue;
      if (operand === null || isOneOf.length + startsWith.length > 0) {
        problems.add(
          null,
          `${builtin.text}: a condition is about the property ${hasProperty.text} of an operand or about its text`,
        );
        continue;
      }
      const isEverObject = builtin.overloads.some(overload => {
        const parameter = parameterAt(overload, operand);
        return parameter !== null && (mayBeObject(parameter.accepted) || mayBeObject(parameter.converted));
      });
      if (isEverObject) continue;
      problems.add(
        null,
        `${builtin.text}: a condition asks for the property ${hasProperty.text} of ${describeOperand(operand)}, which is never an object`,
      );
    }
  }
}

// The clock, the locale, the time zone, the state of a generator of random numbers.
const heapsOutsideOperands: readonly string[] = ["ExternalState", "RuntimeState"];

// With the same operands it answers the same: a call with constant operands is made at build time, and its answer stands in its place.
function checkDeterministic(model: TableModel, problems: Problems): void {
  for (const builtin of model.builtins) {
    if (!builtin.flags.includes("IsDeterministic")) continue;
    for (const overload of builtin.overloads) {
      const { capability, reads } = overload.effects;
      const runsOtherCode = capability === "js" && !overload.flags.includes("RunsOnlyOperandCode");
      if (!runsOtherCode && !reads.some(heap => heapsOutsideOperands.includes(heap))) continue;
      report(
        problems,
        overload,
        `${builtin.text} is deterministic, so it reads none of ${heapsOutsideOperands.join(", ")} and runs no code but that of its operands`,
      );
    }
  }
}

// Code that no operand names throws what it likes, and an entry that neither allocates nor runs the code of an operand has nothing to hand on.
function checkPropagatedErrors(model: TableModel, problems: Problems): void {
  for (const overload of model.overloads) {
    if (!overload.flags.includes("OnlyPropagatesErrors")) continue;
    const { capability } = overload.effects;
    if (capability === "js" && !overload.flags.includes("RunsOnlyOperandCode")) {
      report(
        problems,
        overload,
        "b.propagated says that it throws what its operands throw, and it runs code that no operand names",
      );
    }
    if (capability === "none") {
      report(
        problems,
        overload,
        'b.propagated goes with the capability "heap" or "js": with "none" there is no memory to lack and no code of an operand',
      );
    }
  }
}

function checkLockedObjects(model: TableModel, problems: Problems): void {
  for (const builtin of model.builtins) {
    if (!builtin.flags.includes("IsLockedObject") || builtin.flags.includes("ListsAllMembers")) continue;
    problems.add(null, `${builtin.text} is a locked object, so own-properties.txt lists all its members`);
  }
}

function checkObjectsWithLockedMembers(model: TableModel, problems: Problems): void {
  for (const builtin of model.builtins) {
    const { flags, prototype, scope, text } = builtin;
    if (flags.includes("IsClosedToOtherNames") && !flags.includes("HasLockedMembers")) {
      problems.add(
        null,
        `${text} is closed to other names, and start-up closes it where it locks the members: it locks none`,
      );
    }
    if (!flags.includes("HasLockedMembers")) continue;
    if (flags.includes("IsLockedObject")) problems.add(null, `${text} is a locked object, which locks its members too`);
    if (!flags.includes("ListsAllMembers")) {
      problems.add(null, `${text} locks its members, so own-properties.txt lists all of them`);
    }
    if (scope !== "Realm")
      problems.add(null, `${text} locks its members, and start-up finds only an object of the realm`);
    if (!model.membersLockedByName.some(member => member.holder === builtin)) {
      problems.add(
        null,
        `${text} locks its members, and start-up visits a holder for the members it locks there: it has none`,
      );
    }
    const inheritsFromLockedObject =
      prototype.link === "Null" ||
      (prototype.link === "Builtin" &&
        (prototype.builtin.flags.includes("IsLockedObject") || prototype.builtin.flags.includes("HasLockedMembers")));
    if (!inheritsFromLockedObject) {
      problems.add(null, `${text} closes keys, and a lookup that misses goes on to an object that is not locked`);
    }
  }
}

export function checkMutability(model: Pick<TableModel, "builtins">, problems: Problems): void {
  for (const builtin of model.builtins) {
    const { holder } = builtin;
    if (builtin.mutability === "ChangesOnItsOwn" && isObjectKind(builtin.kind)) {
      problems.add(
        null,
        `${builtin.text} is an object and changes on its own: a read of it answers that object, so it lies there until the program writes. What its holder only inherits is a member of the object that has it`,
      );
    }
    if (builtin.mutability !== "AlwaysLocked" || holder === null) continue;
    const isLockedByDefault = defaultMutabilityOf(builtin) === "AlwaysLocked";
    if (isLockedByDefault || holder.scope === "Realm") continue;
    problems.add(
      null,
      `${builtin.text} is AlwaysLocked, and nothing locks it: ${holder.text} is not a locked object, and start-up locks a name only on an object of the realm`,
    );
  }
}

function checkSyntax(model: TableModel, problems: Problems): void {
  for (const { name, meaning } of [...model.syntax.intrinsics, ...model.syntax.prefixedGlobals]) {
    if (meaning.intrinsic !== "Construct") continue;
    const constructed = meaning.builtin.sameObjectAs ?? meaning.builtin;
    if (constructed.overloads.some(overload => overload.mode === "Construct")) continue;
    problems.add(null, `$${name.text} constructs ${constructed.text}, which has no Construct overload`);
  }
  for (const builtin of model.builtins) {
    if (!builtin.flags.includes("HasPrivateAlias") || privateAliasKinds.has(builtin.kind)) continue;
    problems.add(null, `privateAlias ${builtin.text}: it is not a method, an accessor or a function`);
  }
}

function checkEngineFiles(model: TableModel, problems: Problems): void {
  const functionFiles = new Set(model.functions.map(named => named.file));
  for (const { name } of model.engineFiles) {
    if (functionFiles.has(name.slice(0, -engineFileExtension.length))) continue;
    problems.add(null, `${name} is an engine file, and the table has no function from it`);
  }
}

function collectBuiltinsWrittenInJavaScript(model: TableModel): Set<ModelBuiltin> {
  return new Set(
    model.functions.flatMap(({ role, implements: implemented }) =>
      role === "EngineBuiltin" || role === "HostBuiltin" ? implemented : [],
    ),
  );
}

function checkGuards(model: TableModel, problems: Problems): void {
  const owners = new Map<string, { feature: FeatureName | null; builtin: ModelBuiltin }>();
  const writtenInJavaScript = collectBuiltinsWrittenInJavaScript(model);
  for (const builtin of model.builtins) {
    if (builtin.origin !== "Engine") continue;
    const { featureUses, nativeSymbols } = builtin.attachments;
    const feature = featureUses.find(use => use.isGuard)?.feature ?? null;
    const runsNativeFunction = functionKinds.has(builtin.kind) && !writtenInJavaScript.has(builtin);
    if (feature !== null && nativeSymbols.length === 0 && runsNativeFunction) {
      problems.add(
        null,
        `${builtin.text} is guarded by ${feature} and names no native function: give it a static table or nativeSymbols, or implement it with b.compiled`,
      );
    }
    for (const symbol of nativeSymbols) {
      const owner = owners.get(symbol);
      if (owner === undefined) owners.set(symbol, { feature, builtin });
      else if (owner.feature !== feature) {
        problems.add(
          null,
          `${symbol} belongs to ${describeGuard(owner.feature)} through ${owner.builtin.text} and to ${describeGuard(feature)} through ${builtin.text}`,
        );
      }
    }
  }
}

function checkHostReads(model: TableModel, problems: Problems): void {
  const readExports = model.hostReads.map(({ context, exportName }) => `${context} ${exportName.text}`);
  reportRepeated("host reads", readExports, problems);
  for (const { context, exportName, use } of model.hostReads) {
    if (use.read !== "PassedTo") continue;
    const { builtin, argument } = use;
    const position: ModelOperand = { operand: "Argument", index: argument };
    const takesArgument = builtin.overloads.some(
      overload => overload.mode === "Call" && parameterAt(overload, position) !== null,
    );
    if (takesArgument) continue;
    problems.add(
      null,
      `the host passes the export ${exportName.text} of ${context} to ${builtin.text}, and no Call overload has ${describeOperand(position)}`,
    );
  }
}

function collectLinkedFunctions(model: TableModel): Set<ModelFunction> {
  return new Set(
    model.syntax.intrinsics.flatMap(({ meaning }) =>
      meaning.intrinsic === "LinkedFunction" ? [meaning.function] : [],
    ),
  );
}

function isNamedByOverload({ role, implements: implemented }: ModelFunction): boolean {
  return role === "Model" || implemented.length > 0;
}

function checkStartup(model: TableModel, problems: Problems): void {
  const { modules, functionsCalledWithLoads, moduleLoaderFunctions } = model.startup;
  const specifiers = modules.map(module => module.specifier);
  reportRepeated("start-up modules", specifiers, problems);
  const startupFunctions = functionsCalledWithLoads.map(called => called.function);
  reportRepeated("functions called with the start-up loads", startupFunctions.map(describeFunction), problems);
  reportRepeated("module loader functions", moduleLoaderFunctions.map(describeFunction), problems);
  const lists: readonly ReadonlySet<ModelFunction>[] = [
    new Set(model.builtins.flatMap(builtin => builtin.attachments.calledFunctions.map(called => called.function))),
    new Set(startupFunctions),
    new Set(moduleLoaderFunctions),
  ];
  const linkedFunctions = collectLinkedFunctions(model);
  for (const candidate of model.functions) {
    const listCount = lists.filter(list => list.has(candidate)).length;
    if (listCount > 1) {
      problems.add(
        null,
        `${describeFunction(candidate)} is in ${listCount} of callsFunctions, the functions called with the start-up loads and the module loader functions`,
      );
    }
    if (listCount > 0) continue;
    if (isNamedByOverload(candidate) || linkedFunctions.has(candidate)) continue;
    problems.add(
      null,
      `nothing names ${describeFunction(candidate)}: say with callsFunctions which built-ins native code calls it for, implement an overload with it, list it in b.startup, or leave it out with b.excluded`,
    );
  }
}

export function checkModel(model: TableModel, schema: Schema, problems: Problems): void {
  checkSchemaWords(schema, problems);
  checkSchemaSymbols(model, schema, problems);
  checkSchemaExternals(model, schema, problems);
  checkUniqueTokens(model, problems);
  checkTextsFollowFromNames(model, problems);
  checkInheritance(model, problems);
  checkClosureInstances(model, problems);
  checkInstancesThatAreEntries(model, problems);
  checkTypesOfNamesDefinedOnNewInstances(model, problems);
  checkPristineTests(model, problems);
  checkInstanceTests(model, problems);
  checkSameObjects(model, problems);
  checkHolders(model, problems);
  checkOperandTypes(model, problems);
  checkResults(model, problems);
  checkEffects(model, problems);
  checkCallbacks(model, problems);
  checkPropertyActions(model, problems);
  checkRoles(model, problems);
  checkRangeRules(model, problems);
  checkIteration(model, problems);
  checkPrototypeSources(model, problems);
  checkTypedResults(model, problems);
  checkImplementations(model, schema, problems);
  checkDirectEntries(model, problems);
  checkForms(model, schema, problems);
  checkConditions(model, problems);
  checkDeterministic(model, problems);
  checkPropagatedErrors(model, problems);
  checkLockedObjects(model, problems);
  checkObjectsWithLockedMembers(model, problems);
  checkMutability(model, problems);
  checkSyntax(model, problems);
  checkEngineFiles(model, problems);
  checkGuards(model, problems);
  checkHostReads(model, problems);
  checkHostUses(model, problems);
  checkNamesReadByNativeCode(model, problems);
  checkStartup(model, problems);
  checkOverloads(model, problems);
  checkDependencies(model, problems);
}

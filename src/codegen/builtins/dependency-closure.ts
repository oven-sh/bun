import type {
  ModelBuiltin,
  ModelClass,
  ModelCondition,
  ModelFlow,
  ModelFunction,
  ModelModule,
  ModelName,
  ModelOperand,
  ModelOverload,
  ModelParameter,
  ModelPlace,
  ModelTransfer,
  ModelType,
  ModelTypePart,
  TableModel,
} from "./model.ts";
import { operandUses } from "./vocabulary.ts";

export interface LoadedModule {
  isConditional: boolean;
  /** The exports that native code reads off what the module answers. null: nobody has written down which. */
  exportsRead: ReadonlySet<string> | null;
}

/** What an entry calls only where the operand of the call at a position is one of some texts. */
export interface CallsForTexts {
  argument: number;
  texts: readonly ModelName[];
  calls: Set<ModelFunction>;
}

export interface RuntimeDependencies {
  loads: Map<ModelModule, LoadedModule>;
  calls: Set<ModelFunction>;
  /** Of the entry that is named, by the position and the texts. What is reached by value has none: nobody sees its calls. */
  callsForTexts: Map<string, CallsForTexts>;
  implementedBy: Set<ModelFunction>;
  namedBy: Map<ModelModule | ModelFunction, ModelBuiltin>;
}

export interface UndescribedResult {
  builtin: ModelBuiltin;
  reason: string;
}

interface HandedOutValues {
  objects: readonly ModelBuiltin[];
  undescribedValue: string | null;
}

const nothingHandedOut: HandedOutValues = { objects: [], undescribedValue: null };

function createDependencies(): RuntimeDependencies {
  return { loads: new Map(), calls: new Set(), callsForTexts: new Map(), implementedBy: new Set(), namedBy: new Map() };
}

function addLoad(dependencies: RuntimeDependencies, module: ModelModule, load: LoadedModule): void {
  const known = dependencies.loads.get(module);
  if (known === undefined) {
    dependencies.loads.set(module, load);
    return;
  }
  dependencies.loads.set(module, {
    isConditional: known.isConditional && load.isConditional,
    exportsRead:
      known.exportsRead === null || load.exportsRead === null ? null : known.exportsRead.union(load.exportsRead),
  });
}

function addCallsForTexts(
  dependencies: RuntimeDependencies,
  key: string,
  { argument, texts, calls }: CallsForTexts,
): void {
  const known = dependencies.callsForTexts.get(key);
  if (known === undefined) dependencies.callsForTexts.set(key, { argument, texts, calls: new Set(calls) });
  else for (const called of calls) known.calls.add(called);
}

// The front end has the text of the program and nothing else.
function textsDecidingCall(condition: ModelCondition): Pick<CallsForTexts, "argument" | "texts"> | null {
  const { operand, isOneOf, startsWith, hasProperty } = condition;
  const asksMore =
    startsWith.length > 0 ||
    hasProperty !== null ||
    condition.buildAdmitsRuntimeCode ||
    condition.callRunsOtherCode ||
    condition.objectNobodyKnowsIsWritten;
  if (operand === null || operand.operand !== "Argument" || isOneOf.length === 0 || asksMore) return null;
  return { argument: operand.index, texts: isOneOf };
}

function mergeDependencies(into: RuntimeDependencies, from: RuntimeDependencies): void {
  for (const [module, load] of from.loads) addLoad(into, module, load);
  for (const called of from.calls) into.calls.add(called);
  for (const [key, listed] of from.callsForTexts) addCallsForTexts(into, key, listed);
  for (const implementation of from.implementedBy) into.implementedBy.add(implementation);
  for (const [dependency, builtin] of from.namedBy) {
    if (!into.namedBy.has(dependency)) into.namedBy.set(dependency, builtin);
  }
}

function collectCompiledFunctions(functions: readonly ModelFunction[]): Map<ModelBuiltin, ModelFunction[]> {
  const compiledFunctions = new Map<ModelBuiltin, ModelFunction[]>();
  for (const compiled of functions) {
    for (const builtin of compiled.implements) {
      compiledFunctions.set(builtin, [...(compiledFunctions.get(builtin) ?? []), compiled]);
    }
  }
  return compiledFunctions;
}

// What an operand leaves in a native cell is the program's own. What native code makes there comes out through a handler.
const isHandedOut = ({ from, to }: ModelTransfer): boolean =>
  to.place !== "NativeMemory" && (to.place !== "NativeCell" || from.place === "NewValue");

function handedOutPlacesOf({ transfers, callbacks, propertyActions, handlerCalls }: ModelFlow): ModelPlace[] {
  return [
    ...transfers.filter(isHandedOut).map(({ from }) => from),
    ...handlerCalls.flatMap(call => [call.thisValue, ...call.arguments]),
    ...callbacks.flatMap(callback => [
      callback.newTarget,
      callback.thisValue,
      ...callback.arguments,
      callback.spreadArguments,
    ]),
    ...propertyActions.map(action => action.value),
  ];
}

const claimsEveryUse = ({ uses }: ModelParameter): boolean => uses.length === operandUses.length;

const objectsOfClass = ({ constructor, prototype }: ModelClass): ModelBuiltin[] =>
  [constructor, prototype].filter((object): object is ModelBuiltin => object !== null);

function collectClassObjects(classes: readonly ModelClass[]): Map<ModelClass, ModelBuiltin[]> {
  const objects = new Map(classes.map((builtinClass): [ModelClass, ModelBuiltin[]] => [builtinClass, []]));
  for (const derived of classes) {
    for (let ancestor: ModelClass | null = derived; ancestor !== null; ancestor = ancestor.parent) {
      objects.get(ancestor)?.push(...objectsOfClass(derived));
    }
  }
  return objects;
}

function linkedObjectsOf({ prototype, instanceClass }: ModelBuiltin): ModelBuiltin[] {
  const inherited = prototype.link === "Builtin" ? [prototype.builtin] : [];
  return instanceClass === null ? inherited : [...inherited, ...objectsOfClass(instanceClass)];
}

const receiverObjectOf = ({ holder }: ModelBuiltin): ModelBuiltin | null =>
  holder === null || holder.kind === "Prototype" ? null : holder;

function rootOf(builtin: ModelBuiltin): ModelBuiltin {
  let root = builtin;
  while (root.holder !== null) root = root.holder;
  return root;
}

const isStoredValue = ({ kind, flags }: ModelBuiltin): boolean =>
  kind === "DataProperty" && !flags.includes("IsLazilyCreated");

const isKnownByNameOnly = (builtin: ModelBuiltin): boolean =>
  isStoredValue(builtin) && builtin.overloads.every(({ proof }) => proof === "Structure");

class HandedOutValueCollector {
  readonly objects = new Set<ModelBuiltin>();
  undescribedValue: string | null = null;
  readonly #classObjects: ReadonlyMap<ModelClass, readonly ModelBuiltin[]>;
  readonly #receiverObject: ModelBuiltin | null;
  readonly #visited = new Set<ModelType>();

  constructor(classObjects: ReadonlyMap<ModelClass, readonly ModelBuiltin[]>, receiverObject: ModelBuiltin | null) {
    this.#classObjects = classObjects;
    this.#receiverObject = receiverObject;
  }

  addOverload(overload: ModelOverload): void {
    const { mode, effects, flags, receiver, parameters } = overload;
    this.#addType(overload.result.type, `the result of ${mode}`);
    for (const place of handedOutPlacesOf(overload.flow)) this.#addPlace(place, `a value ${mode} passes on`);
    if (effects.capability === "js" && !flags.includes("RunsOnlyOperandCode")) {
      this.#addUndescribedValue(`${mode} can run JavaScript that no operand names`);
    }
    if ((receiver !== null && claimsEveryUse(receiver)) || parameters.some(claimsEveryUse)) {
      this.#addUndescribedValue(`${mode} has an operand with every use`);
    }
  }

  #addUndescribedValue(reason: string): void {
    this.undescribedValue ??= reason;
  }

  #addPlace(place: ModelPlace, role: string): void {
    switch (place.place) {
      case "NewValue":
        this.#addType(place.type, role);
        return;
      case "Slot":
        this.#addOperand(place.operand);
        if (place.slot.holds !== null) this.#addType(place.slot.holds, role);
        return;
      case "ResultSlot":
        if (place.slot.holds !== null) this.#addType(place.slot.holds, role);
        return;
      case "Operand":
      case "IteratedValues":
      case "OwnValues":
      case "Member":
        this.#addOperand(place.operand);
        return;
      case "Prototype":
        this.#addUndescribedValue(`${role} is the prototype of an operand`);
        return;
      case "None":
      case "Result":
      case "ResultField":
      case "NativeMemory":
      case "NativeCell":
        return;
    }
  }

  #addOperand(operand: ModelOperand): void {
    if (operand.operand === "Receiver" && this.#receiverObject !== null) this.objects.add(this.#receiverObject);
  }

  #addType(type: ModelType, role: string): void {
    if (this.#visited.has(type)) return;
    this.#visited.add(type);
    if (type.isAnything) this.#addUndescribedValue(`${role} is anything`);
    else if (type.hasAnyObject) this.#addUndescribedValue(`${role} is any object`);
    else if (type.hasAnyFunction) this.#addUndescribedValue(`${role} is any function`);
    for (const part of type.parts) this.#addPart(part, role);
  }

  #addPart(part: ModelTypePart, role: string): void {
    switch (part.part) {
      case "Instance":
        for (const object of this.#classObjects.get(part.class) ?? []) this.objects.add(object);
        for (const slot of part.class.slots) {
          const held = part.contents.find(contents => contents.slot === slot)?.type ?? slot.holds;
          const heldRole = `${slot.name.text} of the ${part.class.token} in ${role}`;
          if (held === null) this.#addUndescribedValue(`${heldRole} is not declared`);
          else this.#addType(held, heldRole);
        }
        return;
      case "Layout":
        for (const field of part.layout.fields) this.#addType(field.type, role);
        return;
      case "Builtin":
        this.objects.add(part.builtin);
        return;
      case "Slot":
        this.#addOperand(part.operand);
        if (part.slot.holds !== null) this.#addType(part.slot.holds, role);
        return;
      case "Operand":
      case "IteratedValues":
        this.#addOperand(part.operand);
        return;
      case "Prototype":
        this.#addUndescribedValue(`${role} is the prototype of an operand`);
        return;
      case "InstanceOfReceiverClass":
      case "TypedArrayOfReceiverElementType":
      case "CallbackResult":
        return;
    }
  }
}

export class DependencyClosure {
  readonly #builtins: readonly ModelBuiltin[];
  readonly #classObjects: ReadonlyMap<ModelClass, readonly ModelBuiltin[]>;
  readonly #hostClassObjects: readonly ModelBuiltin[];
  readonly #engineClassObjects: ReadonlySet<ModelBuiltin>;
  readonly #namespacesWrittenInJavaScript: ReadonlySet<ModelBuiltin>;
  readonly #compiledFunctions: ReadonlyMap<ModelBuiltin, readonly ModelFunction[]>;
  readonly #handedOut = new Map<ModelBuiltin, HandedOutValues>();
  readonly #reachable = new Map<string, RuntimeDependencies>();

  constructor(model: TableModel) {
    const classesOf = (origin: ModelClass["origin"]): ModelClass[] =>
      model.classes.filter(builtinClass => builtinClass.origin === origin);
    this.#builtins = model.builtins;
    this.#classObjects = collectClassObjects(model.classes);
    this.#hostClassObjects = classesOf("Host")
      .filter(builtinClass => !builtinClass.instancesAreEntries)
      .flatMap(objectsOfClass);
    this.#engineClassObjects = new Set(classesOf("Engine").flatMap(objectsOfClass));
    this.#namespacesWrittenInJavaScript = new Set(
      model.modules.filter(module => module.hasSource).map(module => module.namespace),
    );
    this.#compiledFunctions = collectCompiledFunctions(model.functions);
  }

  dependenciesOf(builtin: ModelBuiltin): RuntimeDependencies {
    const dependencies = createDependencies();
    this.#addOwnDependencies(dependencies, builtin, null);
    mergeDependencies(dependencies, this.#reachableFrom(this.#handedOutBy(builtin)));
    if (this.#engineClassObjects.has(builtin)) {
      mergeDependencies(dependencies, this.#reachableFrom({ objects: [builtin], undescribedValue: null }));
    }
    for (const [key, listed] of dependencies.callsForTexts) {
      listed.calls = listed.calls.difference(dependencies.calls);
      if (listed.calls.size === 0) dependencies.callsForTexts.delete(key);
    }
    return dependencies;
  }

  dependenciesOfEveryProgram(): RuntimeDependencies {
    const dependencies = createDependencies();
    for (const builtin of this.#builtins) {
      if (DependencyClosure.isInEveryProgram(builtin)) mergeDependencies(dependencies, this.dependenciesOf(builtin));
    }
    return dependencies;
  }

  dependenciesOfAnyHostObject(): RuntimeDependencies {
    return this.#reachableFrom({ objects: [], undescribedValue: "" });
  }

  undescribedResults(): UndescribedResult[] {
    return this.#builtins.flatMap(builtin => {
      const reason = this.#handedOutBy(builtin).undescribedValue;
      return reason === null ? [] : [{ builtin, reason }];
    });
  }

  static isInEveryProgram(builtin: ModelBuiltin): boolean {
    return builtin.origin === "Engine" || builtin.flags.includes("IsCompilerHelper");
  }

  #isMadeByHostCode(builtin: ModelBuiltin): boolean {
    if (DependencyClosure.isInEveryProgram(builtin)) return false;
    if (this.#namespacesWrittenInJavaScript.has(rootOf(builtin))) return false;
    const { holder } = builtin;
    const isOnEngineObject = holder !== null && holder.origin === "Engine" && !holder.flags.includes("IsGlobalObject");
    return !(isOnEngineObject && isKnownByNameOnly(builtin));
  }

  /** `reachedWith`: the entry is reached by value, together with these. null: it is the entry that is named. */
  #addOwnDependencies(
    dependencies: RuntimeDependencies,
    builtin: ModelBuiltin,
    reachedWith: ReadonlySet<ModelBuiltin> | null,
  ): void {
    const isReachedByValue = reachedWith !== null;
    const own = createDependencies();
    for (const { module, exports, condition } of builtin.attachments.moduleLoads) {
      addLoad(own, module, {
        isConditional: isReachedByValue || condition !== null,
        exportsRead: exports === null ? null : new Set(exports.map(({ name }) => name.text)),
      });
    }
    for (const { function: called, condition } of builtin.attachments.calledFunctions) {
      const decided = condition === null ? null : textsDecidingCall(condition);
      if (condition === null || decided === null) {
        own.calls.add(called);
      } else if (reachedWith === null) {
        const key = `${decided.argument} ${decided.texts.map(text => text.number).join(",")}`;
        addCallsForTexts(own, key, { ...decided, calls: new Set([called]) });
      } else if (
        condition.calledOn === null ||
        reachedWith.has(condition.calledOn.sameObjectAs ?? condition.calledOn)
      ) {
        // A row about calls on one object takes that object.
        own.calls.add(called);
      }
    }
    for (const compiled of this.#compiledFunctions.get(builtin) ?? []) own.implementedBy.add(compiled);
    for (const { code } of builtin.overloads) {
      if (code.model !== null) own.implementedBy.add(code.model);
    }
    for (const dependency of [...own.loads.keys(), ...own.calls, ...own.implementedBy]) {
      own.namedBy.set(dependency, builtin);
    }
    mergeDependencies(dependencies, own);
  }

  #handedOutBy(builtin: ModelBuiltin): HandedOutValues {
    let handedOut = this.#handedOut.get(builtin);
    if (handedOut === undefined) {
      handedOut = this.#isMadeByHostCode(builtin) ? this.#collectHandedOutValues(builtin) : nothingHandedOut;
      this.#handedOut.set(builtin, handedOut);
    }
    return handedOut;
  }

  #collectHandedOutValues(builtin: ModelBuiltin): HandedOutValues {
    const collector = new HandedOutValueCollector(this.#classObjects, receiverObjectOf(builtin));
    for (const overload of builtin.overloads) collector.addOverload(overload);
    return {
      objects: [...collector.objects].sort((left, right) => left.id - right.id),
      undescribedValue: collector.undescribedValue,
    };
  }

  #reachableFrom(roots: HandedOutValues): RuntimeDependencies {
    const key = `${roots.undescribedValue !== null}:${roots.objects.map(object => object.id).join(",")}`;
    let dependencies = this.#reachable.get(key);
    if (dependencies === undefined) {
      dependencies = this.#computeReachable(roots);
      this.#reachable.set(key, dependencies);
    }
    return dependencies;
  }

  #computeReachable(roots: HandedOutValues): RuntimeDependencies {
    const dependencies = createDependencies();
    const visited = new Set<ModelBuiltin>();
    const reached: ModelBuiltin[] = [];
    const workList: ModelBuiltin[] = [];
    let hasHostClasses = false;
    const addHandedOut = ({ objects, undescribedValue }: HandedOutValues): void => {
      workList.push(...objects);
      if (undescribedValue === null || hasHostClasses) return;
      hasHostClasses = true;
      workList.push(...this.#hostClassObjects);
    };
    addHandedOut(roots);
    for (let next = workList.pop(); next !== undefined; next = workList.pop()) {
      const builtin = next.sameObjectAs ?? next;
      if (visited.has(builtin) || builtin.flags.includes("IsGlobalObject")) continue;
      visited.add(builtin);
      if (DependencyClosure.isInEveryProgram(builtin)) {
        workList.push(...builtin.members.filter(member => !DependencyClosure.isInEveryProgram(member)));
        continue;
      }
      reached.push(builtin);
      workList.push(...builtin.members, ...linkedObjectsOf(builtin));
      addHandedOut(this.#handedOutBy(builtin));
    }
    for (const builtin of reached) this.#addOwnDependencies(dependencies, builtin, visited);
    return dependencies;
  }
}

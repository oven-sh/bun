import { types } from "node:util";
import { describeError, describeEvent, describeKey, describeOrigin } from "./behaviors";
import type { LogEvent, Origin } from "./log";
import type { Realm } from "./members";
import { selectOverload, type Call } from "./operands";
import { hasIndexedElements, internalsOf } from "./references";
import { candidateOf, isReentrant, valueOf, type Run } from "./runs";
import { compareSnapshots, type Change } from "./snapshots";
import {
  claimsEveryUse,
  columnOf,
  conversionProtocols,
  covers,
  describeOperand,
  isIndexKey,
  isObject,
  keyCovers,
  keysOfProtocols,
  parameterOf,
  spellingOf,
  unreachable,
  type DumpedCallback,
  type DumpedHandlerCall,
  type DumpedOverload,
  type DumpedParameter,
  type DumpedPlace,
  type DumpedPropertyAction,
  type DumpedType,
  type OperandName,
  type OperandUse,
  type PropertyActionKind,
  type Protocol,
} from "./table-description";
import {
  createTypeContext,
  findMismatch,
  includesSame,
  isContentOf,
  isInSlot,
  isIteratedFrom,
  operandValuesOf,
  prototypeBefore,
  resultsOfCalls,
  type TypeContext,
} from "./types";

export type Difference = { column: string; message: string; set: string };

const maxHeldDepth = 4;
const maxHeldObjects = 200;
const toPrimitiveKeys = ["@@toPrimitive", "valueOf", "toString"];
const iterationKeys = ["@@iterator", "@@asyncIterator", "next", "return", "throw", "done", "value"];
const readingActions: readonly PropertyActionKind[] = ["ReadsByKey", "ReadsGetter", "ReadsSetter"];
const storingActions: readonly PropertyActionKind[] = ["StoresByKey", "AssignsFrom"];
const definingActions: readonly PropertyActionKind[] = [
  "StoresByKey",
  "AssignsFrom",
  "DefinesName",
  "TakesDescriptor",
  "TakesDescriptorMap",
  "DefinesGetter",
  "DefinesSetter",
];
const accessorActions: readonly PropertyActionKind[] = [
  "TakesDescriptor",
  "TakesDescriptorMap",
  "DefinesGetter",
  "DefinesSetter",
];

const changingTraps: readonly LogEvent["trap"][] = [
  "set",
  "defineProperty",
  "deleteProperty",
  "setPrototypeOf",
  "preventExtensions",
];

const usesAnObjectMayRefuse: readonly OperandUse[] = [
  "StoresByKey",
  "AssignsFrom",
  "DeletesByKey",
  "TakesDescriptor",
  "ChangesIntegrity",
  "ChangesPrototype",
  "DefinesName",
  "WritesContents",
  "MovesElements",
];

const isOutOfMemoryError = (error: unknown): boolean =>
  error instanceof RangeError && (error.message === "Out of memory" || error.message === "Maximum call stack size exceeded.");

function acceptsOnlyObjects(type: DumpedType): boolean {
  const present = type.primitives.filter(primitive => !["NotPassed", "Undefined", "Null"].includes(primitive));
  return !type.isAnything && present.length === 0 && type.stringLiterals.length === 0;
}

class Comparison {
  readonly realm: Realm;
  readonly call: Call;
  readonly overload: DumpedOverload;
  readonly run: Run;
  readonly types: TypeContext;
  readonly differences = new Map<string, Difference>();
  readonly earlierResults: WeakSet<object>;
  #callCounts = new Map<OperandName, number>();

  constructor(realm: Realm, call: Call, overload: DumpedOverload, run: Run, earlierResults: WeakSet<object>) {
    this.earlierResults = earlierResults;
    this.realm = realm;
    this.call = call;
    this.overload = overload;
    this.run = run;
    this.types = createTypeContext(realm, run);
    this.types.isStoredInResultSlot = (slot, value) => this.isStoredInResultSlot(slot, value);
  }

  isStoredInResultSlot(slot: string, value: unknown): boolean {
    const { transfers, callbacks, propertyActions, throws } = this.overload;
    const origin = this.originOf(value);
    if (origin?.kind === "Content" && origin.content === "Thrown") return true;
    // Native code rejects a promise with an error that it makes, which `throws` says.
    if (slot === "PromiseReason" && throws && !origin && types.isNativeError(value)) return true;
    const isSlot = (place: DumpedPlace) => place.place === "ResultSlot" && place.slot === slot;
    if (transfers.some(({ from, to }) => isSlot(to) && this.placeAdmits(from, value))) return true;
    if (callbacks.some(({ callee, resultTo }) => isSlot(resultTo) && includesSame(resultsOfCalls(this.run, callee), value))) return true;
    return propertyActions.some(({ action, object, value: target }) => {
      if (!readingActions.includes(action) || !isSlot(target)) return false;
      return !isObject(value) || isContentOf(origin, object);
    });
  }

  report(column: string, message: string): void {
    if (!this.differences.has(column)) this.differences.set(column, { column, message, set: this.run.set.name });
  }

  get result(): unknown {
    return this.run.completion.kind === "Returned" ? this.run.completion.value : undefined;
  }

  // A built-in object is the same object for everybody: that it is also passed as an operand says nothing about where it may turn up.
  originOf(value: unknown): Origin | undefined {
    if (!isObject(value) || this.realm.isKnownObject(value)) return undefined;
    const index = this.run.args.indexOf(value);
    if (index !== -1) return { kind: "Operand", operand: index };
    if (value === this.run.receiver) return { kind: "Operand", operand: "this" };
    return this.run.log.originOf(value) ?? this.originOfHeldObject(value);
  }

  // An object without a log that an operand held before the call.
  originOfHeldObject(value: object): Origin | undefined {
    const state = this.run.before.get(value);
    if (!state || state.isOnPrototypeChain || state.depth === 0) return undefined;
    const operand: OperandName = state.root === 0 ? "this" : state.root - 1;
    return { kind: "Content", operand, content: "Property", key: undefined, depth: state.depth };
  }

  actionsOn(operand: OperandName, kinds: readonly PropertyActionKind[]): DumpedPropertyAction[] {
    return this.overload.propertyActions.filter(action => kinds.includes(action.action) && covers(action.object, operand));
  }

  actionCoversKey(action: DumpedPropertyAction, key: PropertyKey): boolean {
    if (action.action === "AssignsFrom" || action.action === "TakesDescriptorMap") return true;
    return keyCovers(action.key, key, operand => operandValuesOf(this.run, operand));
  }

  hasActionFor(operand: OperandName, kinds: readonly PropertyActionKind[], key: PropertyKey | undefined): boolean {
    return this.actionsOn(operand, kinds).some(action => key === undefined || this.actionCoversKey(action, key));
  }

  // Paths of names that a transfer or a handler starts at the operand.
  memberPathsOf(operand: OperandName): (string | null)[][] {
    const { transfers, handlerCalls, callbacks } = this.overload;
    const places: DumpedPlace[] = [
      ...transfers.map(({ from }) => from),
      ...handlerCalls.flatMap(({ callee, thisValue, arguments: passed }) => [callee, thisValue, ...passed]),
      ...callbacks.flatMap(({ newTarget, thisValue, arguments: passed, spreadArguments }) => [newTarget, thisValue, spreadArguments, ...passed]),
    ];
    return places.flatMap(place => (place.place === "Member" && covers(place.operand, operand) ? [place.path] : []));
  }

  isOnMemberPath(operand: OperandName, key: PropertyKey, depth: number): boolean {
    return this.memberPathsOf(operand).some(path => depth < path.length && (path[depth] === null || path[depth] === spellingOf(key)));
  }

  isNamed(parameter: DumpedParameter, key: PropertyKey): boolean {
    const spelling = spellingOf(key);
    const { protocols, namedMembers, calledMembers } = parameter;
    if (keysOfProtocols(parameter).has(spelling)) return true;
    if (protocols.includes("Named") && (namedMembers.length === 0 || namedMembers.includes(spelling))) return true;
    return protocols.includes("CallsNamed") && (calledMembers.length === 0 || calledMembers.includes(spelling));
  }

  readsKey(parameter: DumpedParameter, operand: OperandName, key: PropertyKey, isOwnKey: boolean, depth: number): boolean {
    if (this.isNamed(parameter, key) || this.isOnMemberPath(operand, key, depth)) return true;
    const { protocols } = parameter;
    if (protocols.includes("OwnValues") && (isOwnKey || isIndexKey(key) || protocols.includes("PrototypeChain"))) return true;
    // The iterator of the engine's arrays reads these from what it iterates.
    if (protocols.includes("Iterate") && (isIndexKey(key) || key === "length")) return true;
    if (depth > 0 && !this.hasAnyUse(parameter, "AppliesTransitively")) return false;
    return this.hasActionFor(operand, depth === 0 ? [...readingActions, ...definingActions, "DeletesByKey"] : readingActions, key);
  }

  // b.handedOver: native code reads, calls, keeps and passes on such an operand, and does not change it. Flow takes what goes into
  // native memory for escaped, a call that runs other code lets whatever has escaped be read and called, and no pass takes a
  // summary of an operand from such an entry.
  isHandedOver(parameter: DumpedParameter): boolean {
    const { capability, runsOnlyOperandCode } = this.overload;
    return capability === "js" && !runsOnlyOperandCode && this.goesIntoNativeMemory(parameter);
  }

  goesIntoNativeMemory(parameter: DumpedParameter): boolean {
    const operand = JSON.stringify(parameter.operand);
    return this.overload.transfers.some(
      ({ from, to }) => to.place === "NativeMemory" && from.place === "Operand" && JSON.stringify(from.operand) === operand,
    );
  }

  // [1].toLocaleString(locales, options) hands both on to Number.prototype.toLocaleString: a method of the engine that a protocol of
  // another operand runs unseen may be given what has gone into native memory, and has an entry of its own.
  isHandedToMethodsOfEngine(parameter: DumpedParameter): boolean {
    if (!this.goesIntoNativeMemory(parameter)) return false;
    return this.operandNames().some(other => {
      const otherParameter = parameterOf(this.overload, other);
      if (otherParameter === null || otherParameter === parameter) return false;
      if (this.mayRunMethodsOfEngine(otherParameter, other)) return true;
      // What it holds may be a primitive, whose methods are the engine's.
      return this.hasAnyProtocol(otherParameter, "CallsNamed") && this.hasAnyUse(otherParameter, "AppliesToContents", "AppliesTransitively");
    });
  }

  hasAnyProtocol({ protocols }: DumpedParameter, ...wanted: Protocol[]): boolean {
    return wanted.some(protocol => protocols.includes(protocol));
  }

  hasAnyUse({ uses }: DumpedParameter, ...wanted: OperandUse[]): boolean {
    return wanted.some(use => uses.includes(use));
  }

  readsPrototype(operand: OperandName): boolean {
    const isPrototypeOf = (place: DumpedPlace) => place.place === "Prototype" && covers(place.operand, operand);
    const { transfers, result } = this.overload;
    return transfers.some(({ from }) => isPrototypeOf(from)) || (result.prototypeSource !== null && covers(result.prototypeSource, operand));
  }

  coversTrap(parameter: DumpedParameter, event: LogEvent, depth: number): boolean {
    const { operand } = event.origin;
    const { trap, key, isOwnKey } = event;
    switch (trap) {
      case "get":
        return this.readsKey(parameter, operand, key!, isOwnKey, depth);
      case "has":
        return this.hasAnyProtocol(parameter, "PrototypeChain") || this.readsKey(parameter, operand, key!, isOwnKey, depth);
      case "getOwnPropertyDescriptor":
        return this.hasAnyProtocol(parameter, "OwnKeys", "OwnValues") || this.readsKey(parameter, operand, key!, isOwnKey, depth);
      case "ownKeys":
        return this.hasAnyProtocol(parameter, "OwnKeys", "OwnValues");
      case "getPrototypeOf":
        return (
          this.hasAnyProtocol(parameter, "PrototypeChain", "HasInstance") ||
          this.readsPrototype(operand) ||
          this.hasAnyUse(parameter, "ChangesPrototype")
        );
      case "isExtensible":
        return (
          this.hasAnyProtocol(parameter, "OwnKeys", "PrototypeChain") ||
          this.hasAnyUse(parameter, "ChangesIntegrity", "ChangesPrototype")
        );
      case "set":
        return this.hasActionFor(operand, storingActions, key);
      case "defineProperty":
        return this.hasActionFor(operand, definingActions, key) || this.hasAnyUse(parameter, "ChangesIntegrity");
      case "deleteProperty":
        return this.hasActionFor(operand, ["DeletesByKey"], key);
      case "setPrototypeOf":
        return this.hasAnyUse(parameter, "ChangesPrototype");
      case "preventExtensions":
        return this.hasAnyUse(parameter, "ChangesIntegrity");
      case "apply":
      case "construct":
        return false;
      default:
        return unreachable(trap);
    }
  }

  isRunByConversion(parameter: DumpedParameter, { origin, trap, key }: LogEvent): boolean {
    const protocols = conversionProtocols[parameter.conversion];
    const name = origin.kind === "Content" && (trap === "apply" || origin.content === "Getter") ? origin.key : key;
    if (name === undefined) return false;
    const spelling = spellingOf(name);
    if (protocols.includes("ToPrimitive") && toPrimitiveKeys.includes(spelling)) return true;
    if (!protocols.includes("Named")) return false;
    // The conversion of a dictionary converts each member in turn.
    return parameter.namedMembers.includes(spelling) || (parameter.protocols.includes("ToPrimitive") && toPrimitiveKeys.includes(spelling));
  }

  // A typed array makes a number of what is stored under an index, and an array of what is stored as its length. The effects take a
  // store by key into what may be such an object to run code that nobody lists.
  isRunByStore({ origin, trap, key }: LogEvent): boolean {
    const name = origin.kind === "Content" && (trap === "apply" || origin.content === "Getter") ? origin.key : key;
    if (name === undefined || !toPrimitiveKeys.includes(spellingOf(name))) return false;
    return this.overload.propertyActions.some(({ action, object, value }) => {
      if (!storingActions.includes(action) || value.place !== "Operand" || !covers(value.operand, origin.operand)) return false;
      return operandValuesOf(this.run, object).some(holder => ArrayBuffer.isView(holder) || Array.isArray(holder));
    });
  }

  // What a thenable hands to the functions that it is called with is in the hands of whoever made them, by the doing of its own code.
  isSettledByThenable(parameter: DumpedParameter, { origin }: LogEvent): boolean {
    if (origin.kind !== "Content" || origin.content !== "Value" || types.isPromise(valueOf(this.run, origin.operand))) return false;
    return this.callsMember(parameter, "then", 1);
  }

  placeAdmits(place: DumpedPlace, value: unknown): boolean {
    const { run } = this;
    switch (place.place) {
      case "None":
        return value === undefined;
      case "Operand": {
        const passed = operandValuesOf(run, place.operand);
        if (passed.length === 0) return value === undefined;
        return includesSame(passed, value) || passed.some(operand => this.isWrapperOf(value, operand));
      }
      case "Slot":
        return (
          isInSlot(this.types, value, place.operand, place.slot) ||
          // What the call itself puts there, which a callback that throws keeps out.
          this.overload.transfers.some(
            ({ from, to }) =>
              from.place === "Operand" && JSON.stringify(to) === JSON.stringify(place) && this.placeAdmits(from, value),
          )
        );
      case "OwnValues": {
        if (!isObject(value)) return true;
        const origin = this.originOf(value);
        return isContentOf(origin, place.operand) && (origin.depth === 1 || this.appliesTransitively(origin.operand));
      }
      case "IteratedValues":
        return isIteratedFrom(this.types, value, place.operand, place.isSettled);
      case "Prototype":
        return operandValuesOf(run, place.operand).some(operand => prototypeBefore(run, operand) === value);
      case "Result":
        // What a callback returns becomes the result, so a later call may be handed what an earlier one returned.
        return (
          value === this.result ||
          run.completion.kind === "Threw" ||
          this.overload.callbacks.some(
            ({ callee, resultUse }) => resultUse === "Returned" && includesSame(resultsOfCalls(run, callee), value),
          )
        );
      case "NewValue":
        return findMismatch(this.types, place.type, value) === undefined;
      case "Member": {
        if (!isObject(value)) return true;
        const origin = this.originOf(value);
        const last = place.path[place.path.length - 1];
        if (!isContentOf(origin, place.operand)) return false;
        return last === null || (origin.key !== undefined && spellingOf(origin.key) === last);
      }
      case "ResultSlot":
      case "ResultField":
      case "NativeMemory":
      case "NativeCell":
        return true;
      default:
        return unreachable(place);
    }
  }

  // ToObject of a primitive operand.
  isWrapperOf(value: unknown, operand: unknown): boolean {
    if (!isObject(value) || isObject(operand) || !types.isBoxedPrimitive(value)) return false;
    return Object.is(value.valueOf(), operand);
  }

  appliesTransitively(operand: OperandName): boolean {
    return parameterOf(this.overload, operand)?.uses.includes("AppliesTransitively") ?? false;
  }

  describeValue(value: unknown): string {
    if (!isObject(value)) return typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : String(value);
    const origin = this.originOf(value);
    if (origin) return describeOrigin(origin);
    if (value === this.result) return "the result";
    const kind = this.realm.isKnownObject(value) ? "an existing" : "a new";
    return `${kind} ${typeof value === "function" ? "function" : (this.realm.classesOf(value)[0] ?? "object")}`;
  }

  checkPassedValues(
    column: string,
    { thisValue, arguments: declared }: DumpedCallback | DumpedHandlerCall,
    spread: DumpedPlace,
    event: LogEvent,
  ): void {
    if (event.trap === "apply" && !this.placeAdmits(thisValue, event.thisValue)) {
      this.report(`${column}.thisValue`, `this is ${this.describeValue(event.thisValue)} (${describeEvent(event)})`);
    }
    const last = declared.at(-1);
    const takesRest = last?.place === "Operand" && typeof last.operand === "object" && "argumentsFrom" in last.operand;
    event.passedValues.forEach((value, index) => {
      const place = declared[index] ?? (takesRest ? last : spread);
      if (this.placeAdmits(place, value)) return;
      this.report(`${column}.arguments`, `argument ${index} is ${this.describeValue(value)} (${describeEvent(event)})`);
    });
  }

  admitsPassedValues({ thisValue, arguments: declared, spreadArguments }: DumpedCallback, event: LogEvent): boolean {
    if (event.trap === "apply" && !this.placeAdmits(thisValue, event.thisValue)) return false;
    const last = declared.at(-1);
    const takesRest = last?.place === "Operand" && typeof last.operand === "object" && "argumentsFrom" in last.operand;
    return event.passedValues.every((value, index) =>
      this.placeAdmits(declared[index] ?? (takesRest ? last : spreadArguments), value),
    );
  }

  checkTimes(column: string, times: DumpedCallback["times"], event: LogEvent, calls: number): void {
    const isAfterReturn = times === "Later" || times === "PerEvent";
    if (event.isLate && !isAfterReturn) this.report(`${column}.times`, `${times}, and it was called after the call returned`);
    if (!event.isLate && isAfterReturn) this.report(`${column}.times`, `${times}, and it was called before the call returned`);
    if (calls > 1 && times === "Once") this.report(`${column}.times`, `${times}, and it was called ${calls} times`);
  }

  checkCallOfOperand(event: LogEvent): void {
    const { operand } = event.origin;
    const { callbacks } = this.overload;
    const declared = callbacks.filter(callback => covers(callback.callee, operand));
    if (declared.length === 0) {
      this.report("callbacks", `${describeOperand(operand)} was called (${describeEvent(event)})`);
      return;
    }
    const constructs = event.trap === "construct";
    const ofThisKind = declared.filter(other => other.constructs === constructs);
    const atThisTime = ofThisKind.filter(other => this.isAtDeclaredTime(other, event));
    const choices = atThisTime.length > 0 ? atThisTime : ofThisKind;
    // A fold declares its first call and the later ones apart.
    const callback = choices.find(other => this.admitsPassedValues(other, event)) ?? choices[0];
    if (!callback) {
      this.report("callbacks.constructs", `${describeOperand(operand)} was ${constructs ? "constructed" : "called"}`);
      return;
    }
    const calls = (this.#callCounts.get(operand) ?? 0) + 1;
    this.#callCounts.set(operand, calls);
    const column = `callbacks[${callbacks.indexOf(callback)}]`;
    if (declared.length === 1) this.checkTimes(column, callback.times, event, calls);
    this.checkPassedValues(column, callback, callback.spreadArguments, event);
  }

  isAtDeclaredTime({ times }: DumpedCallback, event: LogEvent): boolean {
    return event.isLate === (times === "Later" || times === "PerEvent");
  }

  findHandler(subject: object, origin: Extract<Origin, { kind: "Content" }>): DumpedHandlerCall | undefined {
    const { log } = this.run;
    const holder = log.originOf(log.holderOf(subject));
    const holderKey = holder?.kind === "Content" ? holder.key : undefined;
    return this.overload.handlerCalls.find(({ callee }) => {
      if (callee.place !== "Member" || !covers(callee.operand, origin.operand) || origin.key === undefined) return false;
      const [before, last] = [callee.path[callee.path.length - 2], callee.path[callee.path.length - 1]];
      // ["routes", every own value] is not `valueOf` of what is held under "port".
      if (typeof before === "string" && holderKey !== undefined && before !== spellingOf(holderKey)) return false;
      return callee.path.length === origin.depth && (last === null || last === spellingOf(origin.key));
    });
  }

  checkCallOfMember(parameter: DumpedParameter, event: LogEvent, origin: Extract<Origin, { kind: "Content" }>): void {
    const column = columnOf(this.overload, origin.operand);
    const { key, content, operand, depth } = origin;
    if (content === "Getter") {
      if (!this.readsKey(parameter, operand, key!, true, depth - 1)) {
        this.report(`${column}.protocols`, `a getter ran: ${describeEvent(event)}`);
      }
      return;
    }
    if (content === "Setter") {
      if (!this.hasActionFor(operand, storingActions, key)) this.report(`${column}.uses`, `a setter ran: ${describeEvent(event)}`);
      return;
    }
    const handler = this.findHandler(event.subject, origin);
    if (handler) {
      const handlerColumn = `handlerCalls[${this.overload.handlerCalls.indexOf(handler)}]`;
      this.checkPassedValues(handlerColumn, handler, { place: "None" }, event);
      return;
    }
    if (key === undefined || !this.callsMember(parameter, key, depth)) {
      this.report(`${column}.protocols`, `a member was called: ${describeEvent(event)}`);
    }
  }

  callsMember(parameter: DumpedParameter, key: PropertyKey, depth: number): boolean {
    const spelling = spellingOf(key);
    const { protocols, calledMembers } = parameter;
    const isWithinReach = depth <= 1 || this.hasAnyUse(parameter, "AppliesTransitively", "AppliesToContents");
    if (protocols.includes("Iterate") && iterationKeys.includes(spelling)) return true;
    const convertsMembers =
      protocols.includes("Named") && protocols.includes("ToPrimitive") && !parameter.roles.includes("MembersAreOnlyInspected");
    if (depth === 2 && convertsMembers && toPrimitiveKeys.includes(spelling)) return true;
    if (!isWithinReach) return false;
    if (protocols.includes("CallsNamed") && (calledMembers.length === 0 || calledMembers.includes(spelling))) return true;
    if (spelling === "constructor") return protocols.includes("Species");
    if (spelling === "prototype") return false;
    return keysOfProtocols(parameter).has(spelling);
  }

  // A built-in looks at something that an operand holds.
  checkTrapOnContent(parameter: DumpedParameter, event: LogEvent, origin: Extract<Origin, { kind: "Content" }>): void {
    const { content, key, depth } = origin;
    if (content === "Thrown") return;
    const { protocols, roles } = parameter;
    if ((content === "Iterator" || content === "IteratorResult") && this.hasAnyProtocol(parameter, "Iterate", "CallsNamed")) return;
    if (key === "constructor" && protocols.includes("Species")) return;
    const eventKey = event.key === undefined ? undefined : spellingOf(event.key);
    const convertsMembers = protocols.includes("ToPrimitive") && !roles.includes("MembersAreOnlyInspected");
    const isNamedMember = content === "Property" && key !== undefined && depth === 1 && this.isNamed(parameter, key);
    if (isNamedMember && convertsMembers && eventKey !== undefined && toPrimitiveKeys.includes(eventKey)) return;
    if (event.key !== undefined && this.isOnMemberPath(origin.operand, event.key, depth)) return;
    const reachesContents = this.hasAnyUse(parameter, "AppliesTransitively") || (depth === 1 && this.hasAnyUse(parameter, "AppliesToContents"));
    if (reachesContents && this.coversTrap(parameter, event, depth)) return;
    const column = columnOf(this.overload, origin.operand);
    this.report(`${column}.uses`, `the built-in works on what the operand holds: ${describeEvent(event)}`);
  }

  checkTrapOnCallbackResult(parameter: DumpedParameter, event: LogEvent, origin: Extract<Origin, { kind: "CallbackResult" }>): void {
    const { callee, operand } = origin;
    if (callee.kind === "Operand") {
      const callbacks = this.overload.callbacks.filter(callback => covers(callback.callee, operand));
      if (callbacks.some(callback => callback.resultUse === "Escapes")) return;
      this.report("callbacks.resultUse", `the built-in works on the result of the callback: ${describeEvent(event)}`);
      return;
    }
    if (this.hasAnyUse(parameter, "AppliesTransitively") || this.hasAnyProtocol(parameter, "ToJSON", "Iterate", "Species")) return;
    const column = columnOf(this.overload, operand);
    this.report(`${column}.uses`, `the built-in works on what a member returned: ${describeEvent(event)}`);
  }

  checkEvent(event: LogEvent): void {
    const { origin } = event;
    const { operand } = origin;
    const parameter = parameterOf(this.overload, operand);
    if (parameter === null) {
      const subject = operand === "this" ? "the entry declares no receiver" : "no parameter takes the argument";
      this.report(columnOf(this.overload, operand), `${subject}, and it was used: ${describeEvent(event)}`);
      return;
    }
    if (claimsEveryUse(parameter)) return;
    const isInOtherHands = this.isHandedOver(parameter) || this.isHandedToMethodsOfEngine(parameter);
    if (isInOtherHands && !changingTraps.includes(event.trap)) return;
    if (origin.kind !== "Operand" && this.mayRunMethodsOfEngine(parameter, operand)) return;
    if (event.isDuringStep) {
      if (!this.hasAnyUse(parameter, "Retains", "RetainsContents")) {
        this.report(`${columnOf(this.overload, operand)}.uses`, `the result uses it: ${describeEvent(event)}`);
      }
      return;
    }
    if (this.isResolutionOfPromise(event) || this.isReturnedByOperandCode(event)) return;
    if (this.isRunByStore(event) || this.isSettledByThenable(parameter, event)) return;
    if (this.overload.capability !== "js" && !event.isLate && !this.isRunByConversion(parameter, event)) {
      this.report("capability", `code of an operand ran: ${describeEvent(event)}`);
    }
    if (event.isLate && !this.hasAnyUse(parameter, "Retains", "RetainsContents")) {
      this.report(`${columnOf(this.overload, operand)}.uses`, `it is used after the call returned: ${describeEvent(event)}`);
    }
    const isCall = event.trap === "apply" || event.trap === "construct";
    switch (origin.kind) {
      case "Operand":
        if (isCall) this.checkCallOfOperand(event);
        else if (!this.coversTrap(parameter, event, 0)) {
          this.report(`${columnOf(this.overload, operand)}.protocols`, describeEvent(event));
        }
        return;
      case "Content":
        if (isCall) this.checkCallOfMember(parameter, event, origin);
        else this.checkTrapOnContent(parameter, event, origin);
        return;
      case "CallbackResult":
        this.checkTrapOnCallbackResult(parameter, event, origin);
        return;
      default:
        return unreachable(origin);
    }
  }

  // A protocol that finds a method of the engine on an untracked instance runs it unseen, and that method has an entry of its own.
  mayRunMethodsOfEngine(parameter: DumpedParameter, operand: OperandName): boolean {
    const { log } = this.run;
    const value = valueOf(this.run, operand);
    if (!isObject(value) || types.isProxy(value)) return false;
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype || log.isProxy(prototype)) return false;
    return this.hasAnyProtocol(parameter, "ToPrimitive", "CallsNamed", "ToJSON", "Thenable", "Iterate", "Species");
  }

  // A value that goes into the value slot of a promise resolves it, which looks for `then` and calls it.
  isResolutionOfPromise({ key, origin, trap }: LogEvent): boolean {
    const name = trap === "apply" && origin.kind === "Content" ? origin.key : key;
    if (name !== "then") return false;
    const { transfers, callbacks, result } = this.overload;
    const isValueSlot = (place: DumpedPlace) => (place.place === "ResultSlot" || place.place === "Slot") && place.slot === "PromiseValue";
    if (transfers.some(({ to }) => isValueSlot(to)) || callbacks.some(({ resultTo }) => isValueSlot(resultTo))) return true;
    return result.type.parts.some(part => part.part === "Instance" && part.class === "Promise" && part.contents.length > 0);
  }

  // What the built-in does with it is judged as what it does with the result of that code.
  isReturnedByOperandCode(event: LogEvent): boolean {
    if (event.origin.kind === "CallbackResult") return false;
    const { events } = this.run.log;
    const subjects = [this.run.log.holderOf(event.subject) ?? event.subject, valueOf(this.run, event.origin.operand)];
    const returnedBy = events.find(
      other =>
        other.origin.kind === "Operand" &&
        other.origin.operand !== event.origin.operand &&
        other.outcome &&
        "returned" in other.outcome &&
        subjects.includes(other.outcome.returned),
    );
    if (!returnedBy || events.indexOf(returnedBy) > events.indexOf(event)) return false;
    const { operand } = returnedBy.origin;
    const parameter = parameterOf(this.overload, operand);
    if (parameter && !claimsEveryUse(parameter)) {
      this.checkTrapOnCallbackResult(parameter, event, { kind: "CallbackResult", operand, callee: returnedBy.origin, call: 0 });
    }
    return true;
  }

  // Where a value of an operand may go, by the transfers, the actions and the callbacks.
  isSourceOf(place: DumpedPlace, origin: Origin, value: unknown): boolean {
    if (place.place === "NewValue") return findMismatch(this.types, place.type, value) === undefined;
    if (place.place === "None" || !("operand" in place) || !covers(place.operand, origin.operand)) return false;
    if (origin.kind === "Operand") return place.place === "Operand";
    if (origin.kind === "CallbackResult") return false;
    if (place.place === "Operand") return false;
    return this.placeAdmits(place, value) || this.appliesTransitively(origin.operand);
  }

  // Code of an operand may hand a value of another operand back to the built-in.
  originsOf(value: unknown): Origin[] {
    const origin = this.originOf(value);
    if (!origin) return [];
    const returnedBy = this.run.log.events.flatMap((event): Origin[] =>
      event.outcome && "returned" in event.outcome && event.outcome.returned === value
        ? [{ kind: "CallbackResult", operand: event.origin.operand, callee: event.origin, call: 0 }]
        : [],
    );
    return [origin, ...returnedBy];
  }

  isKeptInResult(origin: Origin, value: unknown): boolean {
    if (origin.kind === "Content" && origin.content === "Thrown") return true;
    // The body of a generator is code, and flow connects what it yields with what a step answers.
    if (origin.kind === "Content" && origin.content === "Iterated" && types.isGeneratorObject(valueOf(this.run, origin.operand))) return true;
    if (this.isNamedInType(this.overload.result.type, value, 0)) return true;
    // What is reached through an operand that the result holds is reached through the result.
    const holder: Origin = { kind: "Operand", operand: origin.operand };
    if (origin.kind === "Content" && this.isOriginKeptInResult(holder, valueOf(this.run, origin.operand))) return true;
    return this.originsOf(value).concat(origin).some(other => this.isOriginKeptInResult(other, value));
  }

  // A part that names an operand further inside a result type has no transfer: flow connects it as it stands.
  isNamedInType(type: DumpedType, value: unknown, depth: number): boolean {
    return type.parts.some(part => {
      if (part.part === "Instance") return depth < 4 && part.contents.some(({ type: held }) => this.isNamedInType(held, value, depth + 1));
      if (part.part === "Layout") {
        const fields = this.realm.table.layouts.get(part.layout)?.fields ?? [];
        return depth < 4 && fields.some(field => this.isNamedInType(field.type, value, depth + 1));
      }
      if (part.part === "Builtin" || part.part === "InstanceOfReceiverClass" || part.part === "TypedArrayOfReceiverElementType") return false;
      return findMismatch(this.types, { ...type, primitives: [], parts: [part] }, value) === undefined;
    });
  }

  isKeptInOperand(holder: OperandName, origin: Origin, value: unknown): boolean {
    return this.originsOf(value).concat(origin).some(other => this.isOriginKeptInOperand(holder, other, value));
  }

  isOriginKeptInResult(origin: Origin, value: unknown): boolean {
    const { transfers, callbacks, propertyActions } = this.overload;
    const reachesResult = (place: DumpedPlace) =>
      ["Result", "ResultSlot", "ResultField", "NativeMemory", "NativeCell"].includes(place.place);
    if (transfers.some(({ from, to }) => reachesResult(to) && this.isSourceOf(from, origin, value))) return true;
    if (origin.kind === "CallbackResult") {
      return callbacks.some(
        ({ callee, resultUse }) => covers(callee, origin.operand) && ["Returned", "Stored", "Escapes"].includes(resultUse),
      ) || origin.callee.kind !== "Operand";
    }
    return propertyActions.some(
      ({ action, object, value: target }) =>
        (action === "BecomesPrototype" && origin.kind === "Operand" && covers(object, origin.operand) && target.place === "Result") ||
        (action === "DescribesResult" && origin.kind === "Content" && covers(object, origin.operand)) ||
        (readingActions.includes(action) && origin.kind === "Content" && covers(object, origin.operand) && reachesResult(target)),
    );
  }

  isOriginKeptInOperand(holder: OperandName, origin: Origin, value: unknown): boolean {
    const { transfers, callbacks, propertyActions } = this.overload;
    const isHolder = (place: DumpedPlace) =>
      place.place === "NativeMemory" || (place.place === "Slot" && covers(place.operand, holder));
    if (transfers.some(({ from, to }) => isHolder(to) && this.isSourceOf(from, origin, value))) return true;
    if (origin.kind === "CallbackResult") {
      return callbacks.some(({ callee, resultUse, resultTo }) => {
        if (!covers(callee, origin.operand)) return false;
        return resultUse === "Escapes" || (resultUse === "Stored" && isHolder(resultTo));
      });
    }
    return propertyActions.some(action => {
      if (action.action === "ChangesPrototype") return covers(action.object, holder) && this.isSourceOf(action.value, origin, value);
      if (action.action === "BecomesPrototype") {
        return origin.kind === "Operand" && covers(action.object, origin.operand) && this.placeNames(action.value, holder);
      }
      if (!definingActions.includes(action.action) || !covers(action.object, holder)) return false;
      if (action.action === "TakesDescriptor" || action.action === "TakesDescriptorMap") {
        return origin.kind === "Content" && this.placeNames(action.value, origin.operand);
      }
      return this.isSourceOf(action.value, origin, value);
    });
  }

  placeNames(place: DumpedPlace, operand: OperandName): boolean {
    return "operand" in place && covers(place.operand, operand);
  }

  usesColumnOf(origin: Origin): string {
    return origin.kind === "CallbackResult" ? "callbacks.resultUse" : `${columnOf(this.overload, origin.operand)}.uses`;
  }

  isUnchecked(origin: Origin): boolean {
    const parameter = parameterOf(this.overload, origin.operand);
    return parameter !== null && (claimsEveryUse(parameter) || this.isHandedOver(parameter));
  }

  forEachHeldValue(root: object, visit: (value: object, origin: Origin) => void): void {
    const { log } = this.run;
    const visited = new Set<object>([root]);
    const walk = (holder: object, depth: number) => {
      if (types.isProxy(holder) || depth > maxHeldDepth || visited.size > maxHeldObjects) return;
      const held: unknown[] = internalsOf(holder, log).map(({ value }) => value);
      for (const key of Reflect.ownKeys(holder)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(holder, key)!;
        // Every Event has the one getter of isTrusted as its own: an accessor that stays as it is and that no operand brought is the class's.
        const accessors = [descriptor.get, descriptor.set].filter(accessor => descriptor.configurable || log.originOf(accessor));
        held.push(descriptor.value, ...accessors);
      }
      for (const value of held) {
        if (!isObject(value) || visited.has(value)) continue;
        visited.add(value);
        const origin = this.originOf(value);
        if (origin) visit(value, origin);
        else if (!this.realm.isKnownObject(value)) walk(value, depth + 1);
      }
      const prototype = Reflect.getPrototypeOf(holder);
      const prototypeOrigin = this.originOf(prototype);
      if (prototype && prototypeOrigin && !visited.has(prototype)) visit(prototype, prototypeOrigin);
    };
    walk(root, 0);
  }

  hasRunSpeciesCode(): boolean {
    return this.run.log.events.some(({ origin }) => origin.kind === "Content" && origin.key === "constructor");
  }

  checkFreshness(result: object): void {
    const { freshness } = this.overload.result.type;
    if (freshness === "No" || (freshness === "UnlessSpecies" && this.hasRunSpeciesCode())) return;
    const origin = this.originOf(result);
    if (origin) this.report("result.type.freshness", `the result is ${describeOrigin(origin)}`);
    else if (this.realm.isKnownObject(result)) this.report("result.type.freshness", "the result existed before the call");
    else if (this.isSameWhenRepeated(result)) this.report("result.type.freshness", "a second call gave the same object");
    const seenBy = this.run.log.events.find(
      event => !event.isLate && (event.thisValue === result || event.passedValues.includes(result)),
    );
    if (seenBy) this.report("result.type.freshness", `code of an operand received the result: ${describeEvent(seenBy)}`);
  }

  checkSubstring(result: unknown): void {
    const { substringOf } = this.overload.result;
    if (substringOf === null || typeof result !== "string") return;
    const sources = operandValuesOf(this.run, substringOf).filter(value => typeof value === "string");
    if (sources.length > 0 && !sources.some(source => source.includes(result))) {
      this.report("result.substringOf", `${JSON.stringify(result.slice(0, 40))} is no part of the operand`);
    }
  }

  checkResult(result: unknown): void {
    const { overload } = this;
    const mismatch = findMismatch(this.types, overload.result.type, result);
    if (mismatch !== undefined) this.report("result.type", `the result is ${mismatch}`);
    this.checkSubstring(result);
    this.checkRepeated(result);
    if (!isObject(result)) return;
    this.checkFreshness(result);
    const origin = this.originOf(result);
    if (origin) {
      if (!this.isUnchecked(origin) && !this.isKeptInResult(origin, result)) {
        this.report(this.usesColumnOf(origin), `${describeOrigin(origin)} is returned`);
      }
      return;
    }
    if (this.realm.isKnownObject(result) || this.isSameWhenRepeated(result)) return;
    // Code of an operand made the object, so what it holds is that code's doing.
    if (this.hasRunSpeciesCode() || this.isReturnedByCode(result)) return;
    if (overload.capability === "none") this.report("capability", "the call allocated an object");
    this.forEachHeldValue(result, (value, held) => {
      if (this.isUnchecked(held) || this.isKeptInResult(held, value)) return;
      const parameter = parameterOf(overload, held.operand);
      if (parameter && this.mayRunMethodsOfEngine(parameter, held.operand)) return;
      this.report(this.usesColumnOf(held), `the result holds ${describeOrigin(held)}`);
    });
  }

  isReturnedByCode(value: unknown): boolean {
    return this.run.log.events.some(({ outcome }) => outcome && "returned" in outcome && outcome.returned === value);
  }

  isSameWhenRepeated(result: unknown): boolean {
    const { repeated } = this.run;
    if (isObject(result) && this.earlierResults.has(result)) return true;
    return repeated?.kind === "Returned" && Object.is(repeated.value, result);
  }

  checkRepeated(result: unknown): void {
    const { repeated } = this.run;
    if (!repeated || (repeated.kind === "Returned" && Object.is(repeated.value, result))) return;
    const { entry, mode } = this.call;
    const outcome = repeated.kind === "Threw" ? "threw" : `gave ${this.describeValue(repeated.value)} after ${this.describeValue(result)}`;
    // What a native binding answers is made by each evaluation and read from no location. The location of an accessor holds the
    // getter: what that answers to another object than its holder is said by the columns of the overload.
    const isAskedOfHolder = entry.holder !== null && this.run.receiver === this.realm.valueOf(entry.holder);
    const readsLocation = mode === "Get" && entry.kind !== "NativeBinding" && (entry.kind !== "Accessor" || isAskedOfHolder);
    if (readsLocation && entry.mutability !== "ChangesOnItsOwn" && this.run.log.events.length === 0) {
      this.report("mutability", `${entry.mutability}, and a second read ${outcome}`);
    }
    const isPrimitive = !isObject(result) && !(repeated.kind === "Returned" && isObject(repeated.value));
    const { capability, runsOnlyOperandCode, writes } = this.overload;
    const isOpaque = capability === "js" && !runsOnlyOperandCode;
    if (mode === "Call" && isPrimitive && writes.length === 0 && capability === "none" && !isOpaque) {
      this.report("writes", `a second call ${outcome}, and calls that write nothing may be merged or moved`);
    }
    if (mode === "Call" && entry.flags.includes("IsDeterministic") && isPrimitive) {
      this.report("flags.IsDeterministic", `a second call ${outcome}`);
    }
  }

  isOutsideAccepted(operand: OperandName, parameter: DumpedParameter): boolean {
    const isPristine = candidateOf(this.run.set, operand)?.kind === "Pristine";
    return findMismatch(this.types, parameter.accepted, valueOf(this.run, operand)) !== undefined || !isPristine;
  }

  operandNames(): OperandName[] {
    return ["this", ...this.run.args.keys()];
  }

  // The IR's own conversion throws for an operand that it cannot convert. An operand outside a strict type is tested before a call
  // is taken for a call of the overload, and flow lets every call throw an error of the engine.
  hasOperandOutsideAcceptedType(): boolean {
    return this.operandNames().some(operand => {
      const parameter = parameterOf(this.overload, operand);
      return parameter !== null && findMismatch(this.types, parameter.accepted, valueOf(this.run, operand)) !== undefined;
    });
  }

  // Flow and effects take any protocol on what may be a proxy to throw any value.
  mayThrowInTrap(): boolean {
    return this.operandNames().some(operand => {
      const parameter = parameterOf(this.overload, operand);
      return parameter !== null && parameter.protocols.length > 0 && types.isProxy(valueOf(this.run, operand));
    });
  }

  // The effects let a call throw by rule where an operand is outside what the entry admits, where a protocol needs a member that an operand may lack or
  // hold something else under, and where a use changes an object, which may refuse the change.
  mayFailOnOperand(): boolean {
    return this.operandNames().some(operand => {
      const parameter = parameterOf(this.overload, operand);
      if (parameter === null) return false;
      const value = valueOf(this.run, operand);
      if (parameter.admitted !== null && findMismatch(this.types, parameter.admitted, value) !== undefined) return true;
      if (operand === "this" && (value === undefined || value === null)) return true;
      if (this.hasAnyProtocol(parameter, "Iterate", "CallsNamed", "Species", "HasInstance")) return true;
      const mayLackPrimitive = isObject(value) || typeof value === "symbol" || typeof value === "bigint";
      if (mayLackPrimitive && this.hasAnyProtocol(parameter, "ToPrimitive")) return true;
      return isObject(value) && this.hasAnyUse(parameter, ...usesAnObjectMayRefuse);
    });
  }

  checkThrow(error: unknown): void {
    const origin = this.originOf(error);
    if (origin || (this.overload.throws && !this.overload.onlyPropagatesErrors)) return;
    if (this.hasOperandOutsideAcceptedType() || this.mayThrowInTrap()) return;
    if (this.overload.capability === "js" && !this.overload.runsOnlyOperandCode) return;
    if (this.overload.onlyPropagatesErrors && (this.mayFailOnOperand() || isOutOfMemoryError(error))) return;
    this.report("throws", `the call threw ${describeError(error)}`);
  }

  // Flow takes a call with such an operand to throw: nothing is stored, called or returned.
  findRefusedOperand(): OperandName | undefined {
    return this.operandNames().find(operand => {
      const parameter = parameterOf(this.overload, operand);
      if (parameter === null || parameter.conversion !== "None" || !acceptsOnlyObjects(parameter.accepted)) return false;
      return this.isNeverAccepted(parameter.accepted, valueOf(this.run, operand));
    });
  }

  isNeverAccepted(type: DumpedType, value: unknown): boolean {
    if (!isObject(value)) return findMismatch(this.types, type, value) !== undefined;
    if (type.hasAnyObject || type.hasPlainData) return false;
    if (type.hasAnyFunction && typeof value === "function") return false;
    const classes = this.realm.classesOf(value);
    return type.parts.every(part => {
      if (part.part !== "Instance") return false;
      return this.realm.table.classes.get(part.class)?.instanceTest !== "None" && !classes.includes(part.class);
    });
  }

  heapsWrittenBy(change: Change): string[] {
    const { object } = change;
    const description = this.realm.classesOf(object).map(token => this.realm.table.classes.get(token)).find(Boolean);
    const slotHeaps = description?.slots.map(slot => slot.heap) ?? [];
    const stateHeaps = description?.stateHeap ? [description.stateHeap] : [];
    switch (change.kind) {
      case "Internal":
        return [...slotHeaps, ...stateHeaps];
      case "Prototype":
        return ["PrototypeLinks"];
      case "PreventExtensions":
      case "Attributes":
      case "Reorder":
        return ["ShapeWords"];
      case "Define":
      case "Store":
      case "DefineAccessor":
      case "Delete":
        if (hasIndexedElements(object) && (isIndexKey(change.key) || change.key === "length")) return [...slotHeaps, ...stateHeaps];
        if (description?.slots.some(slot => slot.name === change.key)) return slotHeaps;
        return ["NamedProperties", "ObjectFields", "Elements", "ShapeWords"];
      default:
        return unreachable(change);
    }
  }

  checkWrittenHeaps(change: Change, description: string): void {
    const { capability, runsOnlyOperandCode, writes } = this.overload;
    if (capability === "js" && !runsOnlyOperandCode) return;
    const heaps = this.heapsWrittenBy(change);
    if (heaps.length > 0 && !heaps.some(heap => writes.includes(heap))) {
      this.report("writes", `${description}, which is in ${heaps.join(" or ")}`);
    }
  }

  isContentsChange(change: Change): boolean {
    if (change.kind === "Internal") return true;
    if (!("key" in change)) return false;
    const { object, key } = change;
    if (hasIndexedElements(object) && (isIndexKey(key) || key === "length")) return true;
    return types.isRegExp(object) && key === "lastIndex";
  }

  isChangeDeclared(parameter: DumpedParameter, operand: OperandName, change: Change): boolean {
    if (this.isContentsChange(change) && this.hasAnyUse(parameter, "WritesContents", "MovesElements")) return true;
    switch (change.kind) {
      case "Internal":
        return false;
      case "Define":
      case "Store":
        return this.hasActionFor(operand, definingActions, change.key);
      case "DefineAccessor":
        return this.hasActionFor(operand, accessorActions, change.key);
      case "Delete":
        return this.hasActionFor(operand, ["DeletesByKey"], change.key);
      case "Attributes":
        return this.hasActionFor(operand, accessorActions, change.key) || this.hasAnyUse(parameter, "ChangesIntegrity");
      case "Reorder":
        return true;
      case "PreventExtensions":
        return this.hasAnyUse(parameter, "ChangesIntegrity");
      case "Prototype":
        return this.hasAnyUse(parameter, "ChangesPrototype");
      default:
        return unreachable(change);
    }
  }

  describeChange(change: Change, subject: string): string {
    const detail = "key" in change ? describeKey(change.key) : change.kind === "Internal" ? ` ${change.slot} ${change.name ?? ""}` : "";
    return `${change.kind}${detail} on ${subject}`;
  }

  // The store that a Set is.
  isStoreOfSet(change: Change): boolean {
    if (this.call.mode !== "Set" || !("key" in change)) return false;
    return change.object === this.run.log.targetOf(this.run.receiver) && change.key === this.realm.keyOf(this.call.entry);
  }

  isBufferOfOperand(object: object): boolean {
    if (!types.isAnyArrayBuffer(object)) return false;
    return [this.run.receiver, ...this.run.args].some(operand => ArrayBuffer.isView(operand) && this.run.before.get(operand)?.internals.some(({ value }) => value === object));
  }

  // One object may be passed as several operands, and a built-in object as any: the change is that of the operand that declares it.
  originOfChanged(change: Change): Origin | undefined {
    const { object } = change;
    const passedAs = this.operandNames().filter(operand => valueOf(this.run, operand) === object);
    const declaring = passedAs.find(operand => {
      const parameter = parameterOf(this.overload, operand);
      return parameter !== null && (claimsEveryUse(parameter) || this.isChangeDeclared(parameter, operand, change));
    });
    const operand = declaring ?? passedAs[0];
    if (operand !== undefined) return { kind: "Operand", operand };
    return this.originOf(object) ?? (this.realm.isKnownObject(object) ? undefined : this.run.log.originOf(object));
  }

  // A method of the engine that was found through a tracked object changes what its own entry says.
  isChangedByMethodOfEngine({ object }: Change): boolean {
    const { log } = this.run;
    return log.events.some(
      ({ trap, subject, thisValue }) => trap === "apply" && log.holderOf(subject) !== undefined && log.targetOf(thisValue) === object,
    );
  }

  checkChange(change: Change): void {
    if (this.isStoreOfSet(change) || this.isBufferOfOperand(change.object)) return;
    if (this.isChangedByMethodOfEngine(change)) return;
    const origin = this.originOfChanged(change);
    if (!origin) {
      const subject = `${this.describeValue(change.object)}, which is no operand`;
      this.report("writes", this.describeChange(change, subject));
      return;
    }
    if (origin.kind === "CallbackResult" || (origin.kind === "Content" && origin.content === "Thrown")) return;
    const parameter = parameterOf(this.overload, origin.operand);
    const column = columnOf(this.overload, origin.operand);
    const description = this.describeChange(change, describeOrigin(origin));
    if (parameter === null) return this.report(column, `it is not declared, and it was changed: ${description}`);
    if (claimsEveryUse(parameter) || this.mayRunMethodsOfEngine(parameter, origin.operand)) return;
    this.checkWrittenHeaps(change, description);
    if (origin.kind === "Content") {
      if (!this.hasAnyUse(parameter, "AppliesTransitively")) this.report(`${column}.uses`, `what the operand holds was changed: ${description}`);
      return;
    }
    if (!this.isChangeDeclared(parameter, origin.operand, change)) this.report(`${column}.uses`, description);
    if (!("values" in change)) return;
    for (const value of change.values) {
      const held = this.originOf(value);
      if (!held || this.isUnchecked(held)) continue;
      if (held.operand === origin.operand && held.kind !== "CallbackResult") continue;
      if (this.isKeptInOperand(origin.operand, held, value)) continue;
      this.report(this.usesColumnOf(held), `${describeOrigin(origin)} holds ${describeOrigin(held)} after the call`);
    }
  }

  checkYielded(value: unknown): void {
    const check = (held: unknown) => {
      const origin = this.originOf(held);
      if (!origin || this.isUnchecked(origin) || this.isKeptInResult(origin, held)) return;
      this.report(this.usesColumnOf(origin), `the result yields ${describeOrigin(origin)}`);
    };
    check(value);
    if (isObject(value) && !this.originOf(value)) this.forEachHeldValue(value, check);
  }

  checkRegExpState(): void {
    const { capability, runsOnlyOperandCode, writes } = this.overload;
    if (!this.run.hasChangedRegExpState || writes.includes("RegExpState")) return;
    if (capability === "js" && !runsOnlyOperandCode) return;
    if (this.run.log.events.length > 0) return;
    const runsOtherEntries = this.operandNames().some(operand => {
      const parameter = parameterOf(this.overload, operand);
      return parameter !== null && (claimsEveryUse(parameter) || this.mayRunMethodsOfEngine(parameter, operand));
    });
    if (runsOtherEntries) return;
    this.report("writes", "the call changed the static properties of RegExp, which are in RegExpState");
  }

  // What a function without a log does with the values it is given is not known.
  mayCallUnloggedFunction(): boolean {
    return this.operandNames().some(operand => {
      const value = valueOf(this.run, operand);
      if (typeof value !== "function" || this.run.log.isProxy(value)) return false;
      const parameter = parameterOf(this.overload, operand);
      return parameter !== null && (parameter.protocols.length > 0 || this.hasAnyUse(parameter, "Calls", "Retains", "PassesToUserCode"));
    });
  }

  compare(): Difference[] {
    const { run } = this;
    const refused = this.findRefusedOperand();
    if (this.mayCallUnloggedFunction()) {
      if (run.completion.kind === "Threw" && refused === undefined) this.checkThrow(run.completion.error);
      return [...this.differences.values()];
    }
    for (const event of run.log.events) this.checkEvent(event);
    if (run.completion.kind === "Threw") {
      if (refused === undefined) this.checkThrow(run.completion.error);
    } else if (refused !== undefined) {
      const column = `${columnOf(this.overload, refused)}.accepted`;
      this.report(column, `the call returned with ${this.describeValue(valueOf(run, refused))} as ${describeOperand(refused)}`);
    } else {
      this.checkResult(run.completion.value);
      for (const value of run.yielded) this.checkYielded(value);
    }
    if (!isReentrant(run.set)) for (const change of compareSnapshots(run.before, run.after)) this.checkChange(change);
    this.checkRegExpState();
    return [...this.differences.values()];
  }
}

export type Checked = { overload: DumpedOverload; differences: Difference[] };

export function selectFor(realm: Realm, call: Call, run: Run): DumpedOverload | undefined {
  const overload = selectOverload(realm, call, {
    receiver: run.receiver,
    args: run.args,
    isPristine: operand => candidateOf(run.set, operand)?.kind === "Pristine",
  });
  if (overload.isUndeclared) return undefined;
  const isHolderRequired = call.entry.flags.includes("RequiresHolderAsThis") && call.mode === "Call" && !overload.receiver?.accepted.isAnything;
  if (isHolderRequired && run.receiver !== realm.valueOf(call.entry.holder)) return undefined;
  return overload;
}

// earlierResults: the objects that earlier calls of the same built-in returned, to which this one is added.
export function compare(realm: Realm, call: Call, run: Run, earlierResults = new WeakSet<object>()): Checked | undefined {
  const overload = selectFor(realm, call, run);
  if (!overload) return undefined;
  const differences = new Comparison(realm, call, overload, run, earlierResults).compare();
  if (run.completion.kind === "Returned" && isObject(run.completion.value)) earlierResults.add(run.completion.value);
  return { overload, differences };
}

export function formatDifference(overload: DumpedOverload, { column, message, set }: Difference): string {
  return `${overload.token} (${overload.path}) ${column}: ${message} [${set}]`;
}

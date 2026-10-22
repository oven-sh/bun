import { types } from "node:util";
import {
  everyCandidate,
  findCandidate,
  hugeArrayLikes,
  Unavailable,
  undefinedCandidate,
  type Candidate,
} from "./instances";
import { Log } from "./log";
import type { Realm } from "./members";
import { hasIndexedElements, internalsOf } from "./references";
import type { OperandSet } from "./runs";
import {
  admitsAtom,
  classesNamedAt,
  isIndexKey,
  isNarrowerThanItsKinds,
  isObject,
  parameterOf,
  takes,
  type Atom,
  type CallMode,
  type DumpedEntry,
  type DumpedOverload,
  type DumpedParameter,
  type DumpedType,
  type OperandName,
} from "./table-description";
import { findPrimitiveMismatch } from "./types";

export type Call = { entry: DumpedEntry; mode: CallMode; overloads: DumpedOverload[] };
export type PassedOperands = {
  receiver: unknown;
  args: readonly unknown[];
  isPristine(operand: OperandName): boolean;
};

export const neverCalled: ReadonlyMap<RegExp, string> = new Map([
  [/^process\.(exit|reallyExit|abort|kill|_kill|execve|dlopen|_debugProcess|_debugEnd|binding|_linkedBinding)$/, "it ends, replaces or signals a process"],
  [/^process\.(chdir|umask|setuid|setgid|seteuid|setegid|setgroups|initgroups|_rawDebug|_startProfilerIdleNotifier|_stopProfilerIdleNotifier)$/, "it changes the state of the process"],
  [/^process\.(stdin|stdout|stderr|openStdin)\b/, "it takes over a standard stream"],
  [/^%EventEmitter%\.prototype\.(removeAllListeners|off|removeListener|emit|setMaxListeners)$/, "with process as its receiver it takes away or runs the handlers of the process"],
  [/^Bun\.(sleepSync|spawn|spawnSync|openInEditor|serve|listen|connect|udpSocket|build|\$|plugin|generateHeapSnapshot|shrink)$/, "it blocks, starts a process or opens a socket"],
  [/^(alert|confirm|prompt)$/, "it waits for input"],
  [/^Atomics\.(wait|waitAsync|pause)$/, "it blocks the thread"],
  [/^(Worker|WebSocket|fetch|postMessage)$/, "it starts a thread or opens a connection"],
  [/^%ModuleRequire%/, "it loads whatever its operand names"],
  [/^bun:(ffi|test|jsc|sqlite|internal-for-testing)\./, "it reaches outside JavaScript"],
  [/^ShadowRealm\.prototype\.importValue$/, "it loads whatever its operand names"],
]);

export function reasonNeverCalled(path: string): string | undefined {
  for (const [pattern, reason] of neverCalled) if (pattern.test(path)) return reason;
  return undefined;
}

export function atomOf(realm: Realm, value: unknown, isPassed: boolean, namedClasses: readonly string[]): Atom {
  if (!isPassed) return "NotPassed";
  switch (typeof value) {
    case "undefined":
      return "Undefined";
    case "boolean":
      return "Boolean";
    case "number":
      return "Number";
    case "string":
      return "String";
    case "symbol":
      return "Symbol";
    case "bigint":
      return "BigInt";
    case "object":
      if (value === null) return "Null";
      break;
    case "function":
      break;
  }
  const classes = realm.classesOf(value);
  const named = namedClasses.find(token => classes.includes(token));
  if (named !== undefined) return { class: named };
  return typeof value === "function" ? "Function" : "OtherObject";
}

function isPlainData(value: unknown, depth: number): boolean {
  if (!isObject(value)) return true;
  if (depth > 6 || types.isProxy(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)!;
    return Object.hasOwn(descriptor, "value") && isPlainData(descriptor.value, depth + 1);
  });
}

const scratchLog = new Log();

function contentsOf(value: object, contentsSlot: string | null): unknown[] {
  const held = internalsOf(value, scratchLog)
    .filter(({ slot }) => slot === contentsSlot)
    .map(internal => internal.value);
  if (contentsSlot !== "Element" || !hasIndexedElements(value)) return held;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)!;
    if (isIndexKey(key) && Object.hasOwn(descriptor, "value")) held.push(descriptor.value);
  }
  return held;
}

// Whether a value that is passed lies in the type of a parameter, which names no operand.
export function admitsValue(realm: Realm, type: DumpedType, value: unknown, isPristine: boolean): boolean {
  if (type.isAnything) return true;
  if (!isObject(value)) return findPrimitiveMismatch(type, value) === undefined;
  if (type.hasAnyObject || (type.hasAnyFunction && typeof value === "function")) return true;
  if (type.hasPlainData && isPlainData(value, 0)) return true;
  const classes = realm.classesOf(value);
  return type.parts.some(part => {
    switch (part.part) {
      case "Instance":
        if (!classes.includes(part.class)) return false;
        if (part.pristine.length > 0 && (!isPristine || realm.table.classes.get(part.class)?.isNeverPristine)) return false;
        return part.contents.every(({ slot, type: held }) =>
          contentsOf(value, realm.table.slots.get(slot)?.contentsSlot ?? null).every(content =>
            admitsValue(realm, held, content, true),
          ),
        );
      case "Layout":
        return !types.isProxy(value) && typeof value !== "function";
      case "Builtin":
        return realm.valueOf(part.builtin) === value;
      default:
        return false;
    }
  });
}

function valuesAt({ receiver, args }: PassedOperands, parameter: DumpedParameter): [OperandName, unknown][] {
  const { operand } = parameter;
  if (operand === "this") return [["this", receiver]];
  if ("argument" in operand) return [[operand.argument, args[operand.argument]]];
  return args.slice(operand.argumentsFrom).map((value, index) => [operand.argumentsFrom + index, value]);
}

function meetsNarrowTypes(realm: Realm, overload: DumpedOverload, passed: PassedOperands): boolean {
  const parameters = overload.receiver ? [overload.receiver, ...overload.parameters] : overload.parameters;
  return parameters
    .filter(parameter => isNarrowerThanItsKinds(realm.table, parameter))
    .every(parameter =>
      valuesAt(passed, parameter).every(([operand, value]) =>
        admitsValue(realm, parameter.accepted, value, passed.isPristine(operand)),
      ),
    );
}

// The leaf of the generator's decision tree for these values: candidates are filtered by the kind of the receiver and of each
// argument from left to right, a kind that nobody takes leaves all, and of the rest the first whose narrow types hold is taken.
export function selectOverload(realm: Realm, { overloads }: Call, passed: PassedOperands): DumpedOverload {
  const { table } = realm;
  const testsReceiver = overloads.some(({ receiver }) => receiver !== null && !receiver.accepted.isAnything);
  const argumentCount = Math.max(...overloads.map(overload => overload.parameters.length));
  const positions: OperandName[] = [...(testsReceiver ? ["this" as const] : []), ...Array(argumentCount).keys()];
  let candidates = overloads;
  for (const position of positions) {
    if (candidates.length === 1) break;
    const isPassed = position === "this" || position < passed.args.length;
    const value = position === "this" ? passed.receiver : passed.args[position];
    const atom = atomOf(realm, value, isPassed, classesNamedAt(table, overloads, position));
    let takers = candidates.filter(candidate => takes(table, parameterOf(candidate, position), atom));
    if (takers.length === 0 && atom === "NotPassed") {
      takers = candidates.filter(candidate => takes(table, parameterOf(candidate, position), "Undefined"));
    }
    if (takers.length > 0) candidates = takers;
  }
  return candidates.find(candidate => meetsNarrowTypes(realm, candidate, passed)) ?? candidates[candidates.length - 1];
}

type Sample = { value: unknown; isAvailable: boolean };
const samples = new WeakMap<Candidate, Sample>();

function sampleOf(candidate: Candidate): Sample {
  const known = samples.get(candidate);
  if (known) return known;
  let sample: Sample;
  if (candidate.prepare) return { value: undefined, isAvailable: false };
  try {
    sample = { value: candidate.create(new Log(), 0, { receiver: undefined }), isAvailable: true };
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    sample = { value: undefined, isAvailable: false };
  }
  samples.set(candidate, sample);
  return sample;
}

function isAccepted(realm: Realm, parameter: DumpedParameter, candidate: Candidate): boolean {
  const { instanceOf } = candidate;
  if (instanceOf !== undefined) return admitsAtom(realm.table, parameter.accepted, { class: instanceOf });
  const { value, isAvailable } = sampleOf(candidate);
  return isAvailable && admitsValue(realm, parameter.accepted, value, candidate.kind === "Pristine");
}

const literalCandidates = new Map<string, Candidate>();

function literalCandidate(value: string | number): Candidate {
  const name = `primitive:${Bun.inspect(value)}`;
  const known = everyCandidate.find(candidate => candidate.name === name) ?? literalCandidates.get(name);
  if (known) return known;
  const candidate: Candidate = { name, kind: "Primitive", create: () => value };
  literalCandidates.set(name, candidate);
  return candidate;
}

function candidatesNamedBy({ accepted }: DumpedParameter): Candidate[] {
  const named = accepted.stringLiterals.map(literalCandidate);
  if (accepted.integers === null) return named;
  const { minimum, maximum } = accepted.integers;
  return [...named, ...[minimum, maximum, minimum - 1, maximum + 1].map(literalCandidate)];
}

function constructedCandidates(realm: Realm, { accepted }: DumpedParameter): Candidate[] {
  return accepted.parts.flatMap((part): Candidate[] => {
    // There is one, and everybody shares it.
    if (part.part === "Builtin") return [{ name: `builtin:${part.builtin}`, kind: "Pristine", create: () => realm.valueOf(part.builtin) }];
    if (part.part !== "Instance") return [];
    // There is one, and everybody shares it: it is passed only where nothing else will do.
    if (part.class === "Crypto") return [{ name: "crypto", kind: "Pristine", create: () => crypto }];
    const classConstructor = realm.valueOf(realm.table.classes.get(part.class)?.constructor ?? null);
    if (typeof classConstructor !== "function") return [];
    return [
      {
        name: `constructed:${part.class}`,
        kind: "Pristine",
        create(log, operand) {
          try {
            const value = Reflect.construct(classConstructor, []);
            log.identify(value, { kind: "Operand", operand });
            return value;
          } catch (error) {
            throw new Unavailable(`new ${part.class}() threw`, { cause: error });
          }
        },
      },
    ];
  });
}

function hintedNames(parameter: DumpedParameter): string[] {
  const { uses, protocols, namedMembers, accepted } = parameter;
  const hints: string[] = [];
  if (uses.includes("Calls") || (accepted.hasAnyFunction && !accepted.hasAnyObject)) hints.push("callback:object");
  if (namedMembers.includes("value") && namedMembers.includes("get")) {
    hints.push(protocols.includes("OwnKeys") ? "descriptorMap" : "descriptor:data");
  }
  if (protocols.includes("Iterate")) hints.push("iterable");
  if (protocols.includes("Thenable")) hints.push("thenable");
  return [...hints, "object:proxy", "primitive:1", 'primitive:"a"', "primitive:true", "primitive:1n", "primitive:Symbol(s)"];
}

const preferredCandidates = new WeakMap<DumpedParameter, Candidate | null>();

// A value inside the accepted type, so that a set made of these selects the overload and the call goes as far as it can.
function preferredCandidate(realm: Realm, parameter: DumpedParameter): Candidate | undefined {
  const known = preferredCandidates.get(parameter);
  if (known !== undefined) return known ?? undefined;
  const ordered = [
    ...hintedNames(parameter).map(findCandidate),
    ...candidatesNamedBy(parameter),
    ...everyCandidate.filter(candidate => candidate.kind === "Pristine"),
    ...everyCandidate,
    ...constructedCandidates(realm, parameter),
  ];
  const taken = parameter.conversion === "None" ? undefined : ordered.find(candidate => sampleOf(candidate).isAvailable);
  const preferred = ordered.find(candidate => isAccepted(realm, parameter, candidate)) ?? taken;
  preferredCandidates.set(parameter, preferred ?? null);
  return preferred;
}

function holderCandidate(realm: Realm, { entry, mode }: Call): Candidate {
  const isCalledWithoutReceiver = entry.holder === "GlobalThis" && (mode === "Call" || mode === "Construct");
  const holder = isCalledWithoutReceiver ? undefined : realm.valueOf(entry.holder);
  return { name: "holder", kind: "Pristine", create: () => holder };
}

function describeSet(receiver: Candidate, args: readonly Candidate[]): string {
  return `${receiver.name}(${args.map(candidate => candidate.name).join(", ")})`;
}

function createSet(receiver: Candidate, args: Candidate[], surplusCount = 0): OperandSet {
  return { name: describeSet(receiver, args), receiver, arguments: args, surplusCount };
}

const restCount = 2;

function baseArgumentsOf(realm: Realm, overload: DumpedOverload): Candidate[] | undefined {
  const args: Candidate[] = [];
  for (const parameter of overload.parameters) {
    if (parameter.accepted.primitives.length === 1 && parameter.accepted.primitives[0] === "NotPassed") break;
    const preferred = preferredCandidate(realm, parameter);
    if (!preferred) return undefined;
    for (let count = parameter.mode === "Rest" ? restCount : 1; count > 0; count--) args.push(preferred);
  }
  return args;
}

function shorterCounts(overload: DumpedOverload, widest: number): number[] {
  const required = overload.parameters.filter(parameter => parameter.mode === "Required").length;
  return Array.from({ length: Math.max(widest - required, 0) }, (_, index) => required + index);
}

const combinedPrimitives = [
  ...["1", "0", "-1", "1.5", "-0", "NaN", "Infinity", "-2147483649"].map(text => `primitive:${text}`),
  ...['"a"', '""', '"\u{1F600}x"'].map(text => `primitive:${text}`),
  ...["undefined", "null"].map(text => `primitive:${text}`),
];
const maxCombinedPositions = 3;

function combinationsOf(receiver: Candidate, base: Candidate[]): OperandSet[] {
  if (base.length < 2 || base.length > maxCombinedPositions) return [];
  const values = combinedPrimitives.flatMap(name => everyCandidate.find(candidate => candidate.name === name) ?? []);
  let vectors: Candidate[][] = [[]];
  for (let position = 0; position < base.length; position++) {
    vectors = vectors.flatMap(vector => values.map(value => [...vector, value]));
  }
  return vectors.map(vector => createSet(receiver, vector));
}

// A length between these makes the built-in allocate and fill gigabytes.
const allocatesByLength = /^(%TypedArray%|\w+Array|ArrayBuffer|SharedArrayBuffer|Buffer(\.\w+)?|String\.prototype\.(repeat|padStart|padEnd)|Bun\.allocUnsafe|\w*ArrayBuffer\.prototype\.\w+)$/;
const smallestHugeLength = 2 ** 24;
const largestHugeLength = 2 ** 40;

function isHugeLength(candidate: Candidate): boolean {
  if (candidate.kind !== "Primitive") return false;
  const { value } = sampleOf(candidate);
  return typeof value === "number" && value >= smallestHugeLength && value <= largestHugeLength;
}

const takesHugeArrayLikes = /^Array\.prototype\.(push|pop|at)$/;
const surplusArguments = ["object:proxy", "object:convertsToNumber"].map(findCandidate);
const otherReceivers = ["primitive:undefined", "object:proxy", "callback:object"].map(findCandidate);

function receiversOf(realm: Realm, call: Call, overload: DumpedOverload): { base: Candidate | undefined; others: Candidate[] } {
  const { entry } = call;
  const isOwnPropertyOfInstances = entry.flags.includes("IsOwnPropertyOfInstances");
  const isReadFromHolder = entry.kind === "DataProperty" && !isOwnPropertyOfInstances;
  if (overload.receiver === null || isReadFromHolder || entry.flags.includes("RequiresHolderAsThis")) {
    const base = holderCandidate(realm, call);
    const isFixed = overload.mode !== "Call" || entry.flags.includes("RequiresHolderAsThis");
    return { base, others: isFixed ? [] : otherReceivers };
  }
  const holder = holderCandidate(realm, call);
  const base = preferredCandidate(realm, overload.receiver) ?? (isAccepted(realm, overload.receiver, holder) ? holder : undefined);
  const named = [
    ...candidatesNamedBy(overload.receiver),
    ...constructedCandidates(realm, overload.receiver),
    ...(takesHugeArrayLikes.test(entry.path) ? hugeArrayLikes : []),
  ];
  const others = [...everyCandidate, ...named].filter(candidate => candidate !== base);
  // A read of the name from any other value is not a use of the entry.
  if (entry.kind !== "DataProperty") return { base, others };
  const instanceClass = realm.table.dump.classes.find(({ prototype }) => prototype === entry.holder)?.token;
  const instances = others.filter(candidate => {
    const { value, isAvailable } = sampleOf(candidate);
    return isAvailable && instanceClass !== undefined && realm.classesOf(value).includes(instanceClass);
  });
  return { base: instances[0], others: instances.slice(1) };
}

export function operandSetsFor(realm: Realm, call: Call): OperandSet[] {
  const sets = new Map<string, OperandSet>();
  const avoidsHugeLengths = allocatesByLength.test(call.entry.path);
  const consumesIterator = /^Iterator\.prototype\./.test(call.entry.path);
  const add = (set: OperandSet) => {
    if (avoidsHugeLengths && set.arguments.some(isHugeLength)) return;
    // Each step of an asynchronous generator gives a promise, which never says that the iteration is done.
    if (consumesIterator && set.receiver.name === "asyncGenerator") return;
    if (!sets.has(set.name)) sets.set(set.name, set);
  };
  const hasRest = call.overloads.some(({ parameters }) => parameters.at(-1)?.mode === "Rest");
  const widestCount = Math.max(...call.overloads.map(({ parameters }) => parameters.length));

  for (const overload of call.overloads) {
    if (overload.isUndeclared) continue;
    const { base: receiver, others } = receiversOf(realm, call, overload);
    const base = baseArgumentsOf(realm, overload);
    if (!receiver || !base) continue;

    add(createSet(receiver, base));
    for (const count of shorterCounts(overload, base.length)) add(createSet(receiver, base.slice(0, count)));
    for (const other of others) add(createSet(other, base));
    base.forEach((_, position) => {
      const parameter = parameterOf(overload, position)!;
      for (const candidate of [...everyCandidate, ...candidatesNamedBy(parameter)]) {
        add(createSet(receiver, base.with(position, candidate)));
      }
    });
    if (!hasRest && call.mode !== "Get") {
      const padding = Array<Candidate>(Math.max(widestCount - base.length, 0)).fill(undefinedCandidate);
      add(createSet(receiver, [...base, ...padding, ...surplusArguments], surplusArguments.length));
    }
    for (const set of combinationsOf(receiver, base)) add(set);
  }
  return [...sets.values()];
}

export function baseSetOf(realm: Realm, call: Call, overload: DumpedOverload): OperandSet | undefined {
  const { base: receiver } = receiversOf(realm, call, overload);
  const args = baseArgumentsOf(realm, overload);
  return receiver && args && createSet(receiver, args);
}

export function withArgument(set: OperandSet, position: number, candidate: Candidate): OperandSet {
  return createSet(set.receiver, set.arguments.with(position, candidate), set.surplusCount);
}

export function withReceiver(set: OperandSet, candidate: Candidate): OperandSet {
  return createSet(candidate, set.arguments, set.surplusCount);
}

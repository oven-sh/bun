import { types } from "node:util";
import {
  candidatesForTheirClass,
  everyCandidate,
  everyFamily,
  familyOfTheHost,
  findCandidate,
  findCandidateIfAny,
  hugeArrayLikes,
  Unavailable,
  undefinedCandidate,
  type Candidate,
  type Family,
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
  [/^process\.(exit|reallyExit|abort|kill|_kill|execve|dlopen|_debugProcess|_debugEnd)$/, "it ends, replaces or signals a process"],
  [/^process\.(umask|setuid|setgid|seteuid|setegid|setgroups|initgroups|_startProfilerIdleNotifier|_stopProfilerIdleNotifier|setUncaughtExceptionCaptureCallback)$/, "it changes the state of the process"],
  [/^process\.(stdin|openStdin)\b/, "it takes over a standard stream"],
  [/^Bun\.(sleepSync|spawn|spawnSync|openInEditor|serve|listen|connect|udpSocket|build|\$|plugin|generateHeapSnapshot|shrink)$/, "it blocks, starts a process or opens a socket"],
  [/^Atomics\.wait$/, "it blocks the thread"],
  [/^%NodeJSFS%\.prototype\.(close|ftruncate)(Sync|Cb)?$|^native:Bindgen:(udp_socket\.bind\.ts:dgram(Close|Adopt|Bind|Listen)Fd|node_cluster_binding\.bind\.ts:clusterCloseHandle)$|^%NativeFunctions%\.(Udp_socketBindTsDgram(Close|Adopt|Bind|Listen)Fd|Node_cluster_bindingBindTsClusterCloseHandle)$/, "it closes, cuts or takes over whichever descriptor its operand numbers, those of the test too"],
  [/^(Worker|WebSocket)$/, "it starts a thread or opens a connection"],
  [/^native:Bindgen:(node_cluster_binding\.bind\.ts:clusterRawBind|udp_socket\.bind\.ts:connect)$/, "it asks the name servers about every string that is no address, and waits for them"],
  [/^bun:(ffi|test|jsc|sqlite|internal-for-testing)\./, "it reaches outside JavaScript"],
  [/^native:Bindgen:bake_plugins\.bind\.ts:setPages$/, "it changes how modules are loaded"],
  [/^%CompilerHelpers%\.(ownEntriesFlat|definePropertiesFrom)$/, "it works on the instance of a compiled program, and this process has none"],
  [/^%CompilerHelpers%\.plainQuery(Entries|Keys|Values)$/, "the compiler hands it what another helper answered for the same operands, and takes that on trust"],
  [/^%CompilerHelpers%\..*_inRanges$/, "the compiler hands it bounds that it has clamped itself, and takes them on trust"],
  [/^%PrivateGlobals%\.(makeErrorWithCode|inherits)$/, "a call spells out a number, and by it native code takes the other operands on trust: the table does not say which"],
]);

// Only the code of Bun and of the engine names these, and they take the kinds of their operands on trust: with a value outside the
// declared types there is no such call, and native code may do anything.
const takesOperandsOnTrust = /^%LinkTimeConstant:|^%NodeHTTPInternalBinding%\.setServer|^%(CompilerHelpers|PrivateGlobals|NativeFunctions|NodeURLFunctions)%\./;

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

// The compiler asks it of the class of the operand, not of the class that the parameter names: a view of any kind stands for %TypedArray%,
// of which there is no instance.
function mayBePristine(realm: Realm, classOfValue: string): boolean {
  const description = realm.table.classes.get(classOfValue);
  return description !== undefined && (description.pristineTest !== "Mark" || !description.isNeverPristine);
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
        if (part.pristine.length > 0 && (!isPristine || !mayBePristine(realm, classes[0]))) return false;
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
type TestedPosition = { position: OperandName; classes: string[] };
const testedPositions = new WeakMap<readonly DumpedOverload[], TestedPosition[]>();

function testedPositionsOf({ table }: Realm, overloads: readonly DumpedOverload[]): TestedPosition[] {
  return testedPositions.getOrInsertComputed(overloads, () => {
    const testsReceiver = overloads.some(({ receiver }) => receiver !== null && !receiver.accepted.isAnything);
    const argumentCount = Math.max(...overloads.map(overload => overload.parameters.length));
    const positions: OperandName[] = [...(testsReceiver ? ["this" as const] : []), ...Array(argumentCount).keys()];
    return positions.map(position => ({ position, classes: classesNamedAt(table, overloads, position) }));
  });
}

export function selectOverload(realm: Realm, { overloads }: Call, passed: PassedOperands): DumpedOverload {
  const { table } = realm;
  let candidates = overloads;
  for (const { position, classes } of testedPositionsOf(realm, overloads)) {
    if (candidates.length === 1) break;
    const isPassed = position === "this" || position < passed.args.length;
    const value = position === "this" ? passed.receiver : passed.args[position];
    const atom = atomOf(realm, value, isPassed, classes);
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

function withoutNamedBuiltins(type: DumpedType): DumpedType {
  return { ...type, parts: type.parts.filter(part => part.part !== "Builtin") };
}

function isAccepted(realm: Realm, parameter: DumpedParameter, candidate: Candidate): boolean {
  const { instanceOf } = candidate;
  // One object is the built-in that a type names, and an instance that is made for the set is not it.
  if (instanceOf !== undefined) return admitsAtom(realm.table, withoutNamedBuiltins(parameter.accepted), { class: instanceOf });
  const { value, isAvailable } = sampleOf(candidate);
  return isAvailable && admitsValue(realm, parameter.accepted, value, candidate.kind === "Pristine");
}

const literalCandidates = new Map<string, Candidate>();

function literalCandidate(value: string | number): Candidate {
  const name = `primitive:${Bun.inspect(value)}`;
  const known = findCandidateIfAny(name) ?? literalCandidates.get(name);
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
    const made = candidatesForTheirClass.filter(({ instanceOf }) => instanceOf !== undefined && realm.table.isSameOrSubclass(instanceOf, part.class));
    if (made.length > 0) return made;
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
  if (namedMembers.includes("parallelization")) hints.push("options:littleWork");
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

// What a call did, as far as it tells the call from one with other operands.
export type Outcome = {
  signature: string;
  // Per operand that is an object with a log: the names that were looked for in it, and whether anything else was asked of it.
  asked: Map<OperandName, { names: Set<PropertyKey>; isMoreThanNames: boolean }>;
};
export type Outcomes = ReadonlyMap<string, Outcome>;

// Of the values that did the same when they were passed alone, one stands for all.
function combinationsOf({ receiver, base }: Product, outcomes: Outcomes): OperandSet[] {
  const values = combinedPrimitives.map(findCandidate);
  let vectors: Candidate[][] = [[]];
  for (let position = 0; position < base.length; position++) {
    // A value that was not passed alone is of a family that is not told from others here.
    const bySignature = Map.groupBy(values, value => outcomes.get(describeSet(receiver, base.with(position, value)))?.signature);
    const taken = Array.from(bySignature.values(), ([first]) => first);
    vectors = vectors.flatMap(vector => taken.map(value => [...vector, value]));
  }
  return vectors.map(vector => createSet(receiver, vector));
}

// A length between these makes the built-in allocate and fill gigabytes.
const allocatesByLength = /^(%CompilerHelpers%\.(\w+Array|array\w+)|%TypedArray%|\w+Array|ArrayBuffer|SharedArrayBuffer|Buffer(\.\w+)?|String\.prototype\.(repeat|padStart|padEnd)|Bun\.allocUnsafe|\w*ArrayBuffer\.prototype\.\w+)$/;
const smallestHugeLength = 2 ** 24;
const largestHugeLength = 2 ** 40;

function isHugeLength(candidate: Candidate): boolean {
  if (candidate.kind !== "Primitive" && candidate.kind !== "Pristine") return false;
  const { value } = sampleOf(candidate);
  const length = value instanceof Date ? value.getTime() : value;
  return typeof length === "number" && length >= smallestHugeLength && length <= largestHugeLength;
}

// A number outside these makes the built-in fill gigabytes or compute for seconds, on this thread or on others: native code takes a negative one for a large one.
const worksByNumber = /^%NodeCryptoBindingCrypto%\.(scrypt|pbkdf2|argon2)|^Bun\.password\./;
const largestAmountOfWork = 16;

function isMuchWork(candidate: Candidate): boolean {
  if (candidate.kind !== "Primitive") return false;
  const { value } = sampleOf(candidate);
  return typeof value === "number" && (value < 0 || value > largestAmountOfWork);
}

const takesHugeArrayLikes = /^Array\.prototype\.(push|pop|at)$/;
const surplusArguments = ["object:proxy", "object:convertsToNumber"].map(findCandidate);
const otherReceivers = ["primitive:undefined", "object:proxy", "callback:object"].map(findCandidate);

type Receivers = { base: Candidate | undefined; others: Candidate[]; isAnyOther?: boolean };

// `isAnyOther`: every candidate may stand in its place as well.
function receiversOf(realm: Realm, call: Call, overload: DumpedOverload): Receivers {
  const { entry } = call;
  const isOwnPropertyOfInstances = entry.flags.includes("IsOwnPropertyOfInstances");
  const isReadFromHolder = entry.kind === "DataProperty" && !isOwnPropertyOfInstances;
  // Of an entry that wants its holder as `this` an overload may say what it does with any other.
  const wantsHolder = entry.flags.includes("RequiresHolderAsThis") && !overload.receiver?.accepted.isAnything;
  if (overload.receiver === null || isReadFromHolder || wantsHolder) {
    const base = holderCandidate(realm, call);
    const isFixed = overload.mode !== "Call" || wantsHolder;
    return { base, others: isFixed ? [] : otherReceivers };
  }
  const holder = holderCandidate(realm, call);
  const base = preferredCandidate(realm, overload.receiver) ?? (isAccepted(realm, overload.receiver, holder) ? holder : undefined);
  const named = [
    ...candidatesNamedBy(overload.receiver),
    ...constructedCandidates(realm, overload.receiver),
    ...(takesHugeArrayLikes.test(entry.path) ? hugeArrayLikes : []),
  ];
  // A read of the name from any other value is not a use of the entry.
  if (entry.kind !== "DataProperty") return { base, others: named, isAnyOther: true };
  const others = [...everyCandidate, ...named].filter(candidate => candidate !== base);
  const instanceClass = realm.table.dump.classes.find(({ prototype }) => prototype === entry.holder)?.token;
  const instances = others.filter(candidate => {
    const { value, isAvailable } = sampleOf(candidate);
    return isAvailable && instanceClass !== undefined && realm.classesOf(value).includes(instanceClass);
  });
  return { base: instances[0], others: instances.slice(1) };
}

const atomsOfFamilies: Record<string, Atom> = {
  undefined: "Undefined",
  null: "Null",
  boolean: "Boolean",
  number: "Number",
  string: "String",
  symbol: "Symbol",
  bigint: "BigInt",
};
const classesOfFamilies = new WeakMap<Realm, Map<Family, Set<string>>>();

function classesIn(realm: Realm, family: Family): Set<string> {
  return classesOfFamilies
    .getOrInsertComputed(realm, () => new Map())
    .getOrInsertComputed(family, () => {
      const members = [...family.scouts, ...family.others];
      return new Set(members.flatMap(member => (member.instanceOf === undefined ? realm.classesOf(sampleOf(member).value) : realm.table.ancestryOf(member.instanceOf))));
    });
}

type NamesOfCandidate = { names: Set<PropertyKey>; hasNoPrototype: boolean };
const namesOfCandidates = new WeakMap<Candidate, NamesOfCandidate>();

function namesOf(candidate: Candidate): NamesOfCandidate {
  return namesOfCandidates.getOrInsertComputed(candidate, () => {
    const log = new Log();
    const target = log.targetOf(candidate.create(log, 0, { receiver: undefined }) as object);
    return { names: new Set(Reflect.ownKeys(target)), hasNoPrototype: Reflect.getPrototypeOf(target) === null };
  });
}

// Whatever it is passed, a call takes a thirtieth of a second or more: it is made with the scouts alone.
const takesLong = /^%NodeCryptoBindingCrypto%\.scrypt(Sync)?$|^Bun\.gc$/;

const plainObject = findCandidate("object:plain");
const recordingObject = findCandidate("object:proxy");
const booleanValue = findCandidate("primitive:true");

/** One position of a call, with the other operands fixed: which candidates stand in it. */
export class Sweep {
  readonly #realm: Realm;
  readonly #waiting: Family[] = [];
  readonly #passed = new Set<Candidate>();
  readonly #first: Candidate[] = [];

  constructor(
    realm: Realm,
    { entry, overloads }: Call,
    readonly operand: OperandName,
    readonly createSet: (candidate: Candidate) => OperandSet,
    named: readonly Candidate[],
  ) {
    this.#realm = realm;
    const parameters = overloads.flatMap(overload => parameterOf(overload, operand) ?? []);
    const classes = classesNamedAt(realm.table, overloads, operand);
    for (const family of everyFamily()) {
      const isNamed = this.#isNamed(family, parameters, classes);
      // The engine has no test for a class of the host.
      if (!isNamed && family.name === familyOfTheHost && entry.origin === "Engine") continue;
      this.#first.push(...family.scouts);
      if (takesLong.test(entry.path)) continue;
      if (isNamed) this.#first.push(...family.others);
      else if (family.others.length > 0) this.#waiting.push(family);
    }
    this.#first.push(...named);
  }

  // The table tells the family from others in this position, so what it says of the family is asked of each member.
  #isNamed(family: Family, parameters: readonly DumpedParameter[], classes: readonly string[]): boolean {
    const types = parameters.flatMap(({ accepted, refused }) => [accepted, refused]).filter(type => !type.isAnything);
    if (family.kind === "Primitives") return types.some(type => admitsAtom(this.#realm.table, type, atomsOfFamilies[family.name]));
    if (family.kind === "Names") return false;
    if (family.name === "functions" && types.some(type => type.hasAnyFunction && !type.hasAnyObject)) return true;
    return classes.length > 0 && classes.some(token => classesIn(this.#realm, family).has(token));
  }

  #take(candidates: readonly Candidate[]): OperandSet[] {
    const taken = candidates.filter(candidate => !this.#passed.has(candidate));
    for (const candidate of taken) this.#passed.add(candidate);
    return taken.map(this.createSet);
  }

  first(): OperandSet[] {
    return this.#take(this.#first);
  }

  /** What the outcomes so far show to be told apart in this position and has not been passed yet. */
  next(outcomes: Outcomes): OperandSet[] {
    const outcomeOf = (candidate: Candidate) => outcomes.get(this.createSet(candidate).name);
    const ofPlainObject = outcomeOf(plainObject)?.signature;
    const ofRecordingObject = outcomeOf(recordingObject)?.signature;
    const ofBoolean = outcomeOf(booleanValue)?.signature;
    const sets: OperandSet[] = [];
    for (const family of this.#waiting.slice()) {
      if (family.kind === "Names") {
        sets.push(...this.#take(this.#findAnswering(family, outcomeOf)));
        continue;
      }
      // What is asked of a scout with a log shows, so it is held against a plain object with a log.
      const isTold = family.scouts.some(scout => {
        const other = family.kind === "Primitives" ? ofBoolean : scout.kind === "Instrumented" ? ofRecordingObject : ofPlainObject;
        return outcomeOf(scout)?.signature !== other;
      });
      if (!isTold) continue;
      this.#waiting.splice(this.#waiting.indexOf(family), 1);
      sets.push(...this.#take(family.others));
    }
    return sets;
  }

  // An ordinary object is told from another by what it answers, and only to what it is asked.
  #findAnswering(family: Family, outcomeOf: (candidate: Candidate) => Outcome | undefined): Candidate[] {
    const asked = new Set<PropertyKey>();
    let isMoreThanNames = false;
    for (const candidate of this.#passed) {
      const ofOperand = outcomeOf(candidate)?.asked.get(this.operand);
      if (!ofOperand) continue;
      for (const name of ofOperand.names) asked.add(name);
      isMoreThanNames ||= ofOperand.isMoreThanNames;
    }
    if (isMoreThanNames) return family.others;
    if (asked.size === 0) return [];
    return family.others.filter(candidate => {
      const { names, hasNoPrototype } = namesOf(candidate);
      return hasNoPrototype || names.size === 0 || !names.isDisjointFrom(asked);
    });
  }
}

type Product = { receiver: Candidate; base: Candidate[] };
export type Plan = {
  sets: OperandSet[];
  sweeps: Sweep[];
  isTried(set: OperandSet): boolean;
  /** Primitives in several positions at once, once the sweeps are done. */
  combinations(outcomes: Outcomes): OperandSet[];
};

export function planFor(realm: Realm, call: Call): Plan {
  const avoidsHugeLengths = allocatesByLength.test(call.entry.path);
  const consumesIterator = /^Iterator\.prototype\./.test(call.entry.path);
  const avoidsMuchWork = worksByNumber.test(call.entry.path);
  const isTried = (set: OperandSet) => {
    if (avoidsHugeLengths && set.arguments.some(isHugeLength)) return false;
    if (avoidsMuchWork && set.arguments.some(isMuchWork)) return false;
    // Each step of an asynchronous generator gives a promise, which never says that the iteration is done.
    return !(consumesIterator && set.receiver.name === "asyncGenerator");
  };
  const sets: OperandSet[] = [];
  const sweeps: Sweep[] = [];
  const products: Product[] = [];
  const hasRest = call.overloads.some(({ parameters }) => parameters.at(-1)?.mode === "Rest");
  const widestCount = Math.max(...call.overloads.map(({ parameters }) => parameters.length));

  for (const overload of call.overloads) {
    if (overload.isUndeclared) continue;
    const { base: receiver, others, isAnyOther } = receiversOf(realm, call, overload);
    const base = baseArgumentsOf(realm, overload);
    if (!receiver || !base) continue;

    sets.push(createSet(receiver, base));
    for (const count of shorterCounts(overload, base.length)) sets.push(createSet(receiver, base.slice(0, count)));
    if (isAnyOther) sweeps.push(new Sweep(realm, call, "this", other => createSet(other, base), others));
    else for (const other of others) sets.push(createSet(other, base));
    base.forEach((_, position) => {
      const named = candidatesNamedBy(parameterOf(overload, position)!);
      sweeps.push(new Sweep(realm, call, position, candidate => createSet(receiver, base.with(position, candidate)), named));
    });
    if (!hasRest && call.mode !== "Get") {
      const padding = Array<Candidate>(Math.max(widestCount - base.length, 0)).fill(undefinedCandidate);
      sets.push(createSet(receiver, [...base, ...padding, ...surplusArguments], surplusArguments.length));
    }
    if (base.length >= 2 && base.length <= maxCombinedPositions && !takesLong.test(call.entry.path)) products.push({ receiver, base });
  }
  return { sets, sweeps, isTried, combinations: outcomes => products.flatMap(product => combinationsOf(product, outcomes)) };
}

function isWithinDeclaredTypes(realm: Realm, overload: DumpedOverload, set: OperandSet): boolean {
  const required = overload.parameters.filter(parameter => parameter.mode === "Required").length;
  if (overload.isUndeclared || set.arguments.length < required) return false;
  if (overload.receiver !== null && !isAccepted(realm, overload.receiver, set.receiver)) return false;
  return set.arguments.every((candidate, position) => {
    const parameter = parameterOf(overload, position);
    return parameter !== null && isAccepted(realm, parameter, candidate);
  });
}

// A call spells such a number out, the code of an error or the number of a class, and native code looks it up without a test.
function isNumberThatIsSpelledOut({ overloads }: Call, set: OperandSet, position: number): boolean {
  const ranges = overloads.flatMap(overload => parameterOf(overload, position)?.accepted.integers ?? []);
  if (ranges.length === 0) return true;
  if (position >= set.arguments.length) return false;
  const { value } = sampleOf(set.arguments[position]);
  const isInRange = ({ minimum, maximum }: { minimum: number; maximum: number }) => (value as number) >= minimum && (value as number) <= maximum;
  const least = Math.min(...ranges.map(({ minimum }) => minimum));
  const most = Math.max(...ranges.map(({ maximum }) => maximum));
  return Number.isInteger(value) && !Object.is(value, -0) && isInRange({ minimum: least, maximum: most });
}

// The front end asks whether the mapper is undefined in front of the call, and writes another helper where it is.
function isMapperThatIsNeverPassed({ entry }: Call, set: OperandSet): boolean {
  return entry.path === "%CompilerHelpers%.arrayFromLength" && (set.arguments.length < 2 || set.arguments[1] === undefinedCandidate);
}

type KindOfEntry = { allocatesByLength: boolean; takesOperandsOnTrust: boolean };
const kindsOfEntries = new WeakMap<DumpedEntry, KindOfEntry>();

export function isCallThatExists(realm: Realm, call: Call, set: OperandSet): boolean {
  const kind = kindsOfEntries.getOrInsertComputed(call.entry, ({ path }) => ({
    allocatesByLength: allocatesByLength.test(path),
    takesOperandsOnTrust: takesOperandsOnTrust.test(path),
  }));
  if (isMapperThatIsNeverPassed(call, set)) return false;
  if (kind.allocatesByLength && set.arguments.some(isHugeLength)) return false;
  if (!kind.takesOperandsOnTrust) return true;
  const widest = Math.max(...call.overloads.map(({ parameters }) => parameters.length));
  for (let position = 0; position < widest; position++) if (!isNumberThatIsSpelledOut(call, set, position)) return false;
  return call.overloads.some(overload => isWithinDeclaredTypes(realm, overload, set));
}

/** Whether a value that the candidate makes lies in the type of the parameter. */
export function mayStandFor(realm: Realm, parameter: DumpedParameter, candidate: Candidate): boolean {
  const { value, isAvailable } = sampleOf(candidate);
  return isAvailable && admitsValue(realm, parameter.accepted, value, true);
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

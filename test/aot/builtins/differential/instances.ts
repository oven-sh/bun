import { noInline } from "bun:jsc";
import type { ContentKind, Log, Origin } from "./log";
import { isObject, type OperandName } from "./table-description";

export type ValueKind = "Primitive" | "Pristine" | "Customized" | "Instrumented";
export type CreationContext = { receiver: unknown };
export type Candidate = {
  name: string;
  kind: ValueKind;
  // Code of the candidate changes other operands, so a change of an operand says nothing about the built-in.
  isReentrant?: boolean;
  // For a value that takes time to make: its class, how to make the next one, and how to let it go after the call.
  instanceOf?: string;
  prepare?(): Promise<void>;
  release?(): void;
  create(log: Log, operand: OperandName, context: CreationContext): unknown;
};
type Create = Candidate["create"];

export class Unavailable extends Error {}
export const elementsPerCollection = 3;

export function operandOrigin(operand: OperandName): Origin {
  return { kind: "Operand", operand };
}

export function contentOrigin(operand: OperandName, content: ContentKind, key?: PropertyKey, depth = 1): Origin {
  return { kind: "Content", operand, content, key, depth };
}

export function createContent(log: Log, operand: OperandName, content: ContentKind, key?: PropertyKey, depth = 1): object {
  return log.track({}, contentOrigin(operand, content, key, depth));
}

function identifyContent<T extends object>(log: Log, value: T, origin: Origin): T {
  log.identify(value, origin);
  return value;
}

function createContents(log: Log, operand: OperandName, content: ContentKind, count = elementsPerCollection): object[] {
  return Array.from({ length: count }, (_, index) => createContent(log, operand, content, index));
}

type Answer = (call: number, thisValue: unknown, args: unknown[]) => unknown;

// A built-in that calls until it is told to stop is told so by an exception.
const maxCallsOfCallback = 300;

export function createCallback(log: Log, origin: Origin, answer: Answer): Function {
  let calls = 0;
  return log.track(function (this: unknown, ...args: unknown[]) {
    if (calls >= maxCallsOfCallback) throw new Error("the callback was called too often");
    return answer(calls++, this, args);
  }, origin);
}

function answerWithObjects(log: Log, callee: Origin): Answer {
  return call => log.track({}, { kind: "CallbackResult", operand: callee.operand, callee, call });
}

function primitive(value: unknown, name = Bun.inspect(value)): Candidate {
  return { name: `primitive:${name}`, kind: "Primitive", create: () => value };
}

function identified(kind: ValueKind, name: string, create: Create, isReentrant = false): Candidate {
  return {
    name,
    kind,
    isReentrant,
    create(log, operand, context) {
      const value = create(log, operand, context);
      if (isObject(value) && log.originOf(value) === undefined) log.identify(value, operandOrigin(operand));
      return value;
    },
  };
}

const pristine = (name: string, create: Create) => identified("Pristine", name, create);
const customized = (name: string, create: Create) => identified("Customized", name, create);
const instrumented = (name: string, create: Create) => identified("Instrumented", name, create);

function concatenate(left: string, right: string): string {
  return left + right;
}
// Inlined, the sum of two constants is folded into a flat string.
noInline(concatenate);

export const undefinedCandidate = primitive(undefined);

export const numbers: Candidate[] = [
  1, 0, 2, -1, 3, 8, 16, 65, 1.5, -0, NaN, Infinity, -Infinity, 0.1, -1.5, 255, 256, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1,
  2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53, -(2 ** 53), 1e21, 1e-7, Number.MAX_VALUE, Number.MIN_VALUE, 8.64e15, 8.64e15 + 1,
].map(value => primitive(value));

export const strings: Candidate[] = [
  ...["a", "", "abc", "1", "-1", "1.5", " 12 ", "0x1f", "ab ab", "A", "length", "a,b", "\u{1F600}x", "\uD800", "ß", "İ", "en-US", "utf8", "2020-01-01T00:00:00Z", "{\"a\":1}", "http://localhost/a?b=c", "default", "number", "string", "set-cookie", "calendar", "hex", "region", "#ff0000"].map(
    value => primitive(value),
  ),
  { name: "primitive:rope", kind: "Primitive", create: () => concatenate("ab", "cdefghijklmnopqrstuvwxyz") },
  { name: "primitive:long", kind: "Primitive", create: () => "ab".repeat(600) },
];

export const otherPrimitives: Candidate[] = [
  undefinedCandidate,
  primitive(null),
  primitive(true),
  primitive(false),
  primitive(Symbol("s"), "Symbol(s)"),
  primitive(Symbol.iterator, "Symbol.iterator"),
  primitive(Symbol.for("registered"), "Symbol.for"),
  primitive(1n),
  primitive(0n),
  primitive(-1n),
  primitive(2n ** 64n),
  primitive(-(2n ** 63n) - 1n),
];

export const primitives: Candidate[] = [...numbers, ...strings, ...otherPrimitives];

function createProperties(log: Log, operand: OperandName): Record<string, object> {
  return { a: createContent(log, operand, "Property", "a"), b: createContent(log, operand, "Property", "b") };
}

// Every lookup that misses the own properties reaches the proxy, so an ordinary object shows which names are looked for.
function withLoggingPrototype<T extends object>(log: Log, operand: OperandName, value: T): T {
  const prototype = Object.create(Reflect.getPrototypeOf(value));
  Reflect.setPrototypeOf(value, log.track(prototype, operandOrigin(operand)));
  return value;
}

function createAccessor(log: Log, operand: OperandName, key: PropertyKey, answer: Answer): PropertyDescriptor {
  return {
    get: createCallback(log, contentOrigin(operand, "Getter", key), answer) as () => unknown,
    set: createCallback(log, contentOrigin(operand, "Setter", key), () => undefined) as () => void,
    enumerable: true,
    configurable: true,
  };
}

function createObjectWithAccessors(log: Log, operand: OperandName): object {
  const contents = createProperties(log, operand);
  return Object.defineProperties(
    {},
    { a: createAccessor(log, operand, "a", () => contents.a), b: createAccessor(log, operand, "b", () => contents.b) },
  );
}

function createConverting(log: Log, operand: OperandName, number: unknown, text: unknown): object {
  return {
    valueOf: createCallback(log, contentOrigin(operand, "Property", "valueOf"), () => number),
    toString: createCallback(log, contentOrigin(operand, "Property", "toString"), () => text),
  };
}

function throwTracked(log: Log, operand: OperandName): never {
  throw log.track(new Error("thrown by an operand"), contentOrigin(operand, "Thrown"));
}

const plainObjects: Candidate[] = [
  instrumented("object:proxy", (log, operand) => log.track(createProperties(log, operand), operandOrigin(operand))),
  instrumented("object:ordinary", (log, operand) => withLoggingPrototype(log, operand, createProperties(log, operand))),
  instrumented("object:accessors", createObjectWithAccessors),
  instrumented("object:empty", (log, operand) => log.track({}, operandOrigin(operand))),
  instrumented("object:convertsToNumber", (log, operand) => createConverting(log, operand, 1, "1")),
  instrumented("object:convertsToString", (log, operand) => createConverting(log, operand, "a", "a")),
  instrumented("object:convertsToBigInt", (log, operand) => createConverting(log, operand, 1n, "1")),
  instrumented("object:toPrimitive", (log, operand) => ({
    [Symbol.toPrimitive]: createCallback(log, contentOrigin(operand, "Property", Symbol.toPrimitive), () => 1),
  })),
  instrumented("object:conversionThrows", (log, operand) => ({
    [Symbol.toPrimitive]: createCallback(log, contentOrigin(operand, "Property", Symbol.toPrimitive), () =>
      throwTracked(log, operand),
    ),
  })),
  instrumented("object:conversionGivesObject", (log, operand) => createConverting(log, operand, {}, {})),
  customized("object:plain", (log, operand) => createProperties(log, operand)),
  customized("object:primitives", () => ({ a: 1, b: "x", c: null, d: undefined, e: true })),
  customized("object:nullPrototype", (log, operand) => Object.assign(Object.create(null), createProperties(log, operand))),
  customized("object:frozen", (log, operand) => Object.freeze(createProperties(log, operand))),
  customized("object:sealed", (log, operand) => Object.seal(createProperties(log, operand))),
  customized("object:notExtensible", (log, operand) => Object.preventExtensions(createProperties(log, operand))),
  customized("object:symbolKeys", (log, operand) => ({
    [Symbol("own")]: createContent(log, operand, "Property"),
    [Symbol.toStringTag]: "Tagged",
  })),
  customized("object:indexKeys", (log, operand) => ({
    1: createContent(log, operand, "Property", "1"),
    0: createContent(log, operand, "Property", "0"),
    b: 1,
    a: 2,
  })),
  instrumented("arrayLike:proxy", (log, operand) =>
    log.track(
      { length: 2, 0: createContent(log, operand, "Property", "0"), 1: createContent(log, operand, "Property", "1") },
      operandOrigin(operand),
    ),
  ),
  instrumented("arrayLike:ordinary", (log, operand) =>
    withLoggingPrototype(log, operand, { length: 3, 0: createContent(log, operand, "Property", "0") }),
  ),
  instrumented("arrayLike:objectLength", (log, operand) => ({
    length: Object.assign(createConverting(log, operand, 1, "1")),
    0: createContent(log, operand, "Property", "0"),
  })),
  customized("arrayLike:negativeLength", () => ({ length: -1, 0: 1 })),
  instrumented("descriptor:data", (log, operand) =>
    log.track(
      { value: createContent(log, operand, "Property", "value"), writable: true, enumerable: true, configurable: true },
      operandOrigin(operand),
    ),
  ),
  instrumented("descriptor:accessor", (log, operand) =>
    log.track(
      {
        get: createCallback(log, contentOrigin(operand, "Property", "get"), () => 1),
        set: createCallback(log, contentOrigin(operand, "Property", "set"), () => undefined),
        enumerable: true,
        configurable: true,
      },
      operandOrigin(operand),
    ),
  ),
  instrumented("descriptorMap", (log, operand) =>
    log.track(
      {
        c: log.track(
          { value: createContent(log, operand, "Property", "value", 2), writable: true, enumerable: true, configurable: true },
          contentOrigin(operand, "Property", "c"),
        ),
      },
      operandOrigin(operand),
    ),
  ),
  instrumented("thenable", (log, operand) =>
    log.track(
      {
        then: createCallback(log, contentOrigin(operand, "Property", "then"), (_, __, [resolve]) => {
          if (typeof resolve === "function") resolve(createContent(log, operand, "Value"));
        }),
      },
      operandOrigin(operand),
    ),
  ),
  instrumented("thenable:rejects", (log, operand) =>
    log.track(
      {
        then: createCallback(log, contentOrigin(operand, "Property", "then"), (_, __, [, reject]) => {
          if (typeof reject === "function") reject(createContent(log, operand, "Value"));
        }),
      },
      operandOrigin(operand),
    ),
  ),
  instrumented("toJSON", (log, operand) => {
    const origin = contentOrigin(operand, "Property", "toJSON");
    return log.track({ toJSON: createCallback(log, origin, answerWithObjects(log, origin)) }, operandOrigin(operand));
  }),
  instrumented("setLike", (log, operand) => {
    const elements = createContents(log, operand, "Iterated", 2);
    return log.track(
      {
        size: 2,
        has: createCallback(log, contentOrigin(operand, "Property", "has"), () => true),
        keys: createCallback(log, contentOrigin(operand, "Property", "keys"), () => elements.values()),
      },
      operandOrigin(operand),
    );
  }),
];

type IterableOptions = { throwsAt?: number; isAsync?: boolean };

function createIterator(
  log: Log,
  operand: OperandName,
  values: unknown[],
  { throwsAt }: IterableOptions = {},
  origin = contentOrigin(operand, "Iterator"),
): object {
  const depth = origin.kind === "Operand" ? 1 : 2;
  const createResult = (done: boolean, value: unknown) =>
    log.track({ done, value }, contentOrigin(operand, "IteratorResult", undefined, depth));
  const next = createCallback(log, contentOrigin(operand, "Property", "next", depth), call => {
    if (call === throwsAt) throwTracked(log, operand);
    return call < values.length ? createResult(false, values[call]) : createResult(true, undefined);
  });
  const close = createCallback(log, contentOrigin(operand, "Property", "return", depth), () => createResult(true, undefined));
  return log.track({ next, return: close }, origin);
}

function createIterable(log: Log, operand: OperandName, values: unknown[], options: IterableOptions = {}): object {
  const key = options.isAsync ? Symbol.asyncIterator : Symbol.iterator;
  const method = createCallback(log, contentOrigin(operand, "Property", key), () =>
    createIterator(log, operand, values, options),
  );
  return log.track({ [key]: method }, operandOrigin(operand));
}

function createPairs(log: Log, operand: OperandName): object[] {
  return Array.from({ length: 2 }, () =>
    log.track(
      [createContent(log, operand, "Key", undefined, 2), createContent(log, operand, "Value", undefined, 2)],
      contentOrigin(operand, "Iterated"),
    ),
  );
}

const iterables: Candidate[] = [
  instrumented("iterable", (log, operand) => createIterable(log, operand, createContents(log, operand, "Iterated"))),
  instrumented("iterable:pairs", (log, operand) => createIterable(log, operand, createPairs(log, operand))),
  instrumented("iterable:primitives", (log, operand) => createIterable(log, operand, [1, "a", undefined, -0, 1n])),
  instrumented("iterable:strings", (log, operand) => createIterable(log, operand, ["a", "b"])),
  instrumented("iterable:empty", (log, operand) => createIterable(log, operand, [])),
  instrumented("iterable:throws", (log, operand) =>
    createIterable(log, operand, createContents(log, operand, "Iterated"), { throwsAt: 1 }),
  ),
  instrumented("iterable:async", (log, operand) =>
    createIterable(log, operand, createContents(log, operand, "Iterated"), { isAsync: true }),
  ),
  instrumented("iterable:promises", (log, operand) =>
    createIterable(log, operand, [
      identifyContent(log, Promise.resolve(createContent(log, operand, "Value", undefined, 2)), contentOrigin(operand, "Iterated")),
      1,
    ]),
  ),
  instrumented("iterator", (log, operand) =>
    createIterator(log, operand, createContents(log, operand, "Iterated"), {}, operandOrigin(operand)),
  ),
  pristine("generator", (log, operand) => {
    const values = createContents(log, operand, "Iterated");
    return (function* () {
      yield* values;
    })();
  }),
  pristine("asyncGenerator", (log, operand) => {
    const values = createContents(log, operand, "Iterated");
    return (async function* () {
      yield* values;
    })();
  }),
  pristine("arrayIterator", (log, operand) => createContents(log, operand, "Iterated").values()),
  pristine("mapIterator", (log, operand) => new Map([[createContent(log, operand, "Iterated"), 1]]).keys()),
  pristine("setIterator", (log, operand) => new Set(createContents(log, operand, "Iterated")).values()),
  pristine("stringIterator", () => "a\u{1F600}"[Symbol.iterator]()),
  pristine("regExpStringIterator", () => "ab ab".matchAll(/(a)(b)?/g)),
  pristine("iteratorHelper", (log, operand) => createContents(log, operand, "Iterated").values().map(value => value)),
  pristine("wrappedIterator", (log, operand) => Iterator.from(createIterator(log, operand, createContents(log, operand, "Iterated")) as any)),
  pristine("headersIterator", () => new Headers({ a: "1" }).entries()),
  pristine("searchParamsIterator", () => new URLSearchParams("a=1").entries()),
  pristine("segmentIterator", () => new Intl.Segmenter("en").segment("ab")[Symbol.iterator]()),
];

// What code of one operand can do to another while a built-in runs.
export function changeState(value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length > 1) value.length = 1;
    else value.push(1.5, "text");
  } else if (value instanceof Map || value instanceof Set) {
    value.clear();
  } else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer && !value.buffer.detached) {
    if (value.buffer.resizable) value.buffer.resize(1);
    else value.buffer.transfer();
  } else if (value instanceof ArrayBuffer && !value.detached) {
    if (value.resizable) value.resize(1);
    else value.transfer();
  } else if (value instanceof Date) {
    value.setTime(NaN);
  } else if (value instanceof RegExp) {
    value.lastIndex = 1;
  }
}

function callbackCandidate(name: string, createAnswer: (log: Log, origin: Origin, context: CreationContext) => Answer): Candidate {
  return instrumented(`callback:${name}`, (log, operand, context) => {
    const origin = operandOrigin(operand);
    return createCallback(log, origin, createAnswer(log, origin, context));
  });
}

const callbacks: Candidate[] = [
  callbackCandidate("object", answerWithObjects),
  callbackCandidate("true", () => () => true),
  callbackCandidate("false", () => () => false),
  callbackCandidate("number", () => call => (call % 2 ? 1 : -1)),
  callbackCandidate("undefined", () => () => undefined),
  callbackCandidate("string", () => () => "a"),
  callbackCandidate("NaN", () => () => NaN),
  callbackCandidate("firstArgument", () => (_, __, [first]) => first),
  callbackCandidate("throws", (log, origin) => () => throwTracked(log, origin.operand)),
  callbackCandidate("array", (log, origin) => call => [
    log.track({}, { kind: "CallbackResult", operand: origin.operand, callee: origin, call }),
  ]),
  callbackCandidate("promise", (log, origin) => call =>
    Promise.resolve(log.track({}, { kind: "CallbackResult", operand: origin.operand, callee: origin, call })),
  ),
  {
    ...callbackCandidate("changesReceiver", (_, __, context) => () => {
      changeState(context.receiver);
      return true;
    }),
    isReentrant: true,
  },
  {
    ...instrumented("object:conversionChangesReceiver", (log, operand, context) => ({
      valueOf: createCallback(log, contentOrigin(operand, "Property", "valueOf"), () => {
        changeState(context.receiver);
        return 1;
      }),
    })),
    isReentrant: true,
  },
  customized("function:class", () => class {}),
  customized("function:arrow", () => () => 1),
  customized("function:bound", (log, operand) =>
    function (this: unknown) {
      return this;
    }.bind(createContent(log, operand, "State", "boundThis")),
  ),
  customized("function:async", () => async function () {}),
  customized("function:generator", () => function* () {}),
];

const bytesPerBuffer = 16;

function createBytes(count: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: count }, (_, index) => index + 1);
}

function detach<View extends { buffer: ArrayBufferLike }>(view: View): View {
  (view.buffer as ArrayBuffer).transfer();
  return view;
}

function shrinkToNothing<View extends { buffer: ArrayBufferLike }>(view: View): View {
  (view.buffer as ArrayBuffer).resize(0);
  return view;
}

const createResizable = (byteLength: number) => new ArrayBuffer(byteLength, { maxByteLength: byteLength * 2 });

const numberArrays = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float16Array,
  Float32Array,
  Float64Array,
];
const bigIntArrays = [BigInt64Array, BigUint64Array];

const typedArrays: Candidate[] = [
  ...numberArrays.map(constructor => pristine(`filled:${constructor.name}`, () => new constructor([1, 2, 3]))),
  ...bigIntArrays.map(constructor => pristine(`filled:${constructor.name}`, () => new constructor([1n, 2n, 3n]))),
  pristine("edges:Float64Array", () => new Float64Array([-0, NaN, Infinity, 1.5])),
  pristine("edges:Int32Array", () => new Int32Array([-(2 ** 31), 2 ** 31 - 1, -1])),
  pristine("edges:Uint32Array", () => new Uint32Array([2 ** 32 - 1, 2 ** 31])),
  pristine("edges:BigUint64Array", () => new BigUint64Array([2n ** 64n - 1n])),
  pristine("empty:Uint8Array", () => new Uint8Array(0)),
  pristine("detached:Uint8Array", () => detach(new Uint8Array([1, 2, 3]))),
  pristine("lengthTracking:Uint8Array", () => new Uint8Array(createResizable(4))),
  pristine("outOfBounds:Uint8Array", () => shrinkToNothing(new Uint8Array(createResizable(4), 0, 4))),
  pristine("offset:Uint8Array", () => new Uint8Array(createBytes(bytesPerBuffer).buffer, 4, 4)),
  pristine("shared:Int32Array", () => new Int32Array(new SharedArrayBuffer(bytesPerBuffer))),
  pristine("shared:BigInt64Array", () => new BigInt64Array(new SharedArrayBuffer(bytesPerBuffer))),
  customized("subclass:Uint8Array", () => new (class extends Uint8Array {})([1, 2, 3])),
  instrumented("loggingPrototype:Uint8Array", (log, operand) => withLoggingPrototype(log, operand, new Uint8Array([1, 2, 3]))),
  instrumented("species:Uint8Array", (log, operand) => withSpecies(log, operand, new Uint8Array([1, 2, 3]), Uint8Array)),
  pristine("filled:Buffer", () => Buffer.from(createBytes(8))),
  pristine("empty:Buffer", () => Buffer.alloc(0)),
  pristine("text:Buffer", () => Buffer.from("héllo wörld \u{1F600}")),
  pristine("detached:Buffer", () => detach(Buffer.from(createBytes(8).buffer))),
];

const buffers: Candidate[] = [
  pristine("filled:ArrayBuffer", () => createBytes(bytesPerBuffer).buffer),
  pristine("empty:ArrayBuffer", () => new ArrayBuffer(0)),
  pristine("detached:ArrayBuffer", () => detach(createBytes(bytesPerBuffer)).buffer),
  pristine("resizable:ArrayBuffer", () => createResizable(8)),
  pristine("filled:SharedArrayBuffer", () => new SharedArrayBuffer(bytesPerBuffer)),
  pristine("growable:SharedArrayBuffer", () => new SharedArrayBuffer(8, { maxByteLength: 16 })),
  pristine("filled:DataView", () => new DataView(createBytes(bytesPerBuffer).buffer)),
  pristine("empty:DataView", () => new DataView(new ArrayBuffer(0))),
  pristine("detached:DataView", () => detach(new DataView(createBytes(bytesPerBuffer).buffer))),
  pristine("lengthTracking:DataView", () => new DataView(createResizable(bytesPerBuffer))),
  pristine("outOfBounds:DataView", () => shrinkToNothing(new DataView(createResizable(bytesPerBuffer), 0, bytesPerBuffer))),
];

function withSpecies<T extends object>(log: Log, operand: OperandName, value: T, base: Function): T {
  const origin = contentOrigin(operand, "Property", "constructor");
  const subclass = class extends (base as any) {};
  Reflect.defineProperty(value, "constructor", { value: log.track(subclass, origin), writable: true, configurable: true });
  return value;
}

function withAccessorElement(log: Log, operand: OperandName): unknown[] {
  const elements: unknown[] = createContents(log, operand, "Element");
  const held = elements[1];
  Reflect.defineProperty(elements, 1, createAccessor(log, operand, "1", () => held));
  return elements;
}

const arrays: Candidate[] = [
  pristine("filled:Array", (log, operand) => createContents(log, operand, "Element")),
  pristine("empty:Array", () => []),
  pristine("numbers:Array", () => [1, 2, 3]),
  pristine("doubles:Array", () => [1.5, -0, NaN, 3]),
  pristine("strings:Array", () => ["b", "a", "c"]),
  pristine("mixed:Array", (log, operand) => [1, "a", undefined, null, createContent(log, operand, "Element", 4), 1n, -0]),
  pristine("holes:Array", (log, operand) => {
    const elements = createContents(log, operand, "Element");
    delete elements[1];
    return elements;
  }),
  pristine("onlyHoles:Array", () => new Array(elementsPerCollection)),
  pristine("nested:Array", (log, operand) => [
    log.track([createContent(log, operand, "Element", 0, 2)], contentOrigin(operand, "Element", 0)),
    identifyContent(log, [createContent(log, operand, "Element", 0, 2), 1], contentOrigin(operand, "Element", 1)),
  ]),
  pristine("pairs:Array", (log, operand) =>
    Array.from({ length: 2 }, (_, index) =>
      identifyContent(
        log,
        [createContent(log, operand, "Key", undefined, 2), createContent(log, operand, "Value", undefined, 2)],
        contentOrigin(operand, "Element", index),
      ),
    ),
  ),
  pristine("stringPairs:Array", () => [
    ["a", "1"],
    ["b", "2"],
  ]),
  pristine("one:Array", (log, operand) => [createContent(log, operand, "Element", 0)]),
  customized("sparse:Array", (log, operand) => {
    const elements: unknown[] = [];
    elements[5000] = createContent(log, operand, "Element", 5000);
    return elements;
  }),
  customized("frozen:Array", (log, operand) => Object.freeze(createContents(log, operand, "Element"))),
  customized("sealed:Array", (log, operand) => Object.seal(createContents(log, operand, "Element"))),
  customized("fixedLength:Array", (log, operand) =>
    Object.defineProperty(createContents(log, operand, "Element"), "length", { writable: false }),
  ),
  customized("ownProperty:Array", (log, operand) =>
    Object.assign(createContents(log, operand, "Element"), { extra: createContent(log, operand, "Property", "extra") }),
  ),
  customized("subclass:Array", (log, operand) => (class extends Array {}).from(createContents(log, operand, "Element"))),
  customized("notSpreadable:Array", (log, operand) =>
    Object.assign(createContents(log, operand, "Element"), { [Symbol.isConcatSpreadable]: false }),
  ),
  instrumented("accessorElement:Array", withAccessorElement),
  instrumented("loggingPrototype:Array", (log, operand) =>
    withLoggingPrototype(log, operand, createContents(log, operand, "Element")),
  ),
  instrumented("species:Array", (log, operand) => withSpecies(log, operand, createContents(log, operand, "Element"), Array)),
  instrumented("proxy:Array", (log, operand) => log.track(createContents(log, operand, "Element"), operandOrigin(operand))),
  pristine("arguments", (log, operand) =>
    (function () {
      return arguments;
    })(...createContents(log, operand, "Element")),
  ),
];

function createEntries(log: Log, operand: OperandName): [object, object][] {
  return Array.from({ length: elementsPerCollection }, () => [
    createContent(log, operand, "Key"),
    createContent(log, operand, "Value"),
  ]);
}

const collections: Candidate[] = [
  pristine("filled:Map", (log, operand) => new Map(createEntries(log, operand))),
  pristine("empty:Map", () => new Map()),
  pristine("primitives:Map", () => new Map<unknown, unknown>([[1, "a"], ["b", -0], [NaN, undefined]])),
  pristine("filled:Set", (log, operand) => new Set(createContents(log, operand, "Element"))),
  pristine("empty:Set", () => new Set()),
  pristine("primitives:Set", () => new Set([1, "a", NaN, undefined])),
  pristine("filled:WeakMap", (log, operand) => new WeakMap(createEntries(log, operand))),
  pristine("filled:WeakSet", (log, operand) => new WeakSet(createContents(log, operand, "Element"))),
  pristine("filled:WeakRef", (log, operand) => new WeakRef(createContent(log, operand, "State", "target"))),
  pristine("filled:FinalizationRegistry", (log, operand) =>
    new FinalizationRegistry(createCallback(log, contentOrigin(operand, "State", "cleanup"), () => undefined) as () => void),
  ),
  customized("subclass:Map", (log, operand) => new (class extends Map {})(createEntries(log, operand))),
  customized("subclass:Set", (log, operand) => new (class extends Set {})(createContents(log, operand, "Element"))),
  instrumented("loggingPrototype:Map", (log, operand) => withLoggingPrototype(log, operand, new Map(createEntries(log, operand)))),
  instrumented("loggingPrototype:Set", (log, operand) =>
    withLoggingPrototype(log, operand, new Set(createContents(log, operand, "Element"))),
  ),
];

function withHandledRejection<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

const promises: Candidate[] = [
  pristine("fulfilled:Promise", (log, operand) => Promise.resolve(createContent(log, operand, "Value"))),
  pristine("pending:Promise", () => new Promise(() => {})),
  pristine("rejected:Promise", (log, operand) => withHandledRejection(Promise.reject(createContent(log, operand, "State", "reason")))),
  pristine("primitive:Promise", () => Promise.resolve(1)),
  customized("subclass:Promise", (log, operand) => (class extends Promise<unknown> {}).resolve(createContent(log, operand, "Value"))),
  instrumented("species:Promise", (log, operand) =>
    withSpecies(log, operand, Promise.resolve(createContent(log, operand, "Value")), Promise),
  ),
  instrumented("ownThen:Promise", (log, operand) =>
    Object.assign(Promise.resolve(1), {
      then: createCallback(log, contentOrigin(operand, "Property", "then"), (_, __, [resolve]) => {
        if (typeof resolve === "function") resolve(createContent(log, operand, "Value"));
      }),
    }),
  ),
];

function withLastIndex(expression: RegExp, lastIndex: unknown): RegExp {
  return Object.assign(expression, { lastIndex });
}

const regExps: Candidate[] = [
  pristine("global:RegExp", () => /(a)(b)?/g),
  pristine("plain:RegExp", () => /(a)(b)?/),
  pristine("empty:RegExp", () => new RegExp("")),
  pristine("sticky:RegExp", () => /(a)(b)?/y),
  pristine("namedGroups:RegExp", () => /(?<first>a)(?<second>b)?/g),
  pristine("indices:RegExp", () => /(a)(b)?/dg),
  pristine("unicode:RegExp", () => /./gu),
  pristine("emptyGlobal:RegExp", () => /(?:)/g),
  pristine("advanced:RegExp", () => withLastIndex(/(a)(b)?/g, 1)),
  pristine("pastEnd:RegExp", () => withLastIndex(/(a)(b)?/g, 100)),
  customized("negativeLastIndex:RegExp", () => withLastIndex(/(a)(b)?/g, -1)),
  customized("fixedLastIndex:RegExp", () => Object.defineProperty(/(a)(b)?/g, "lastIndex", { writable: false })),
  instrumented("objectLastIndex:RegExp", (log, operand) => withLastIndex(/(a)(b)?/g, createConverting(log, operand, 0, "0"))),
  instrumented("ownExec:RegExp", (log, operand) =>
    Object.assign(/(a)(b)?/g, { exec: createCallback(log, contentOrigin(operand, "Property", "exec"), () => null) }),
  ),
  instrumented("ownExecMatches:RegExp", (log, operand) => {
    const origin = contentOrigin(operand, "Property", "exec");
    return Object.assign(/(a)(b)?/, {
      exec: createCallback(log, origin, call =>
        log.track(Object.assign(["a"], { index: 0, input: "a" }), { kind: "CallbackResult", operand, callee: origin, call }),
      ),
    });
  }),
  instrumented("loggingPrototype:RegExp", (log, operand) => withLoggingPrototype(log, operand, /(a)(b)?/g)),
  instrumented("species:RegExp", (log, operand) => withSpecies(log, operand, /(a)(b)?/g, RegExp)),
  customized("subclass:RegExp", () => new (class extends RegExp {})("(a)(b)?", "g")),
];

function available(create: () => unknown): Create {
  return () => {
    try {
      return create();
    } catch (error) {
      throw new Unavailable("the value cannot be made", { cause: error });
    }
  };
}

const otherInstances: Candidate[] = [
  pristine("valid:Date", () => new Date(86_400_000)),
  pristine("invalid:Date", () => new Date(NaN)),
  pristine("early:Date", () => new Date(-8.64e15)),
  instrumented("loggingPrototype:Date", (log, operand) => withLoggingPrototype(log, operand, new Date(0))),
  pristine("filled:Error", (log, operand) => new Error("message", { cause: createContent(log, operand, "Property", "cause") })),
  pristine("filled:TypeError", () => new TypeError("message")),
  pristine("filled:AggregateError", (log, operand) => new AggregateError(createContents(log, operand, "Element"), "message")),
  customized("subclass:Error", () => new (class extends Error {})("message")),
  pristine("boxed:Number", () => new Number(1.5)),
  pristine("boxed:String", () => new String("ab")),
  pristine("boxed:Boolean", () => new Boolean(false)),
  pristine("boxed:Symbol", () => Object(Symbol("boxed"))),
  pristine("boxed:BigInt", () => Object(1n)),
  customized("revoked:Proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return proxy;
  }),
  customized("revokedFunction:Proxy", () => {
    const { proxy, revoke } = Proxy.revocable(function () {}, {});
    revoke();
    return proxy;
  }),
  customized("constructor:Array", () => class extends Array {}),
  customized("constructor:Promise", () => class extends Promise<unknown> {}),
  customized("constructor:Uint8Array", () => class extends Uint8Array {}),
  pristine("filled:Headers", available(() => new Headers({ a: "1", b: "2" }))),
  pristine("filled:Request", available(() => new Request("http://localhost/a", { method: "POST", body: "text" }))),
  pristine("filled:Response", available(() => new Response("text", { status: 201, headers: { a: "1" } }))),
  pristine("filled:URL", available(() => new URL("http://user:pw@localhost:81/a/b?c=d#e"))),
  pristine("filled:URLSearchParams", available(() => new URLSearchParams("a=1&b=2&a=3"))),
  pristine("filled:Blob", available(() => new Blob(["text"], { type: "text/plain" }))),
  pristine("filled:File", available(() => new File(["text"], "name.txt"))),
  pristine("filled:FormData", available(() => {
    const form = new FormData();
    form.append("a", "1");
    return form;
  })),
  pristine("filled:AbortSignal", available(() => new AbortController().signal)),
  pristine("aborted:AbortSignal", available(() => AbortSignal.abort())),
  pristine("filled:ReadableStream", available(() => new Blob(["text"]).stream())),
  pristine("filled:TextEncoder", available(() => new TextEncoder())),
  pristine("filled:TextDecoder", available(() => new TextDecoder())),
  pristine("filled:EventTarget", available(() => new EventTarget())),
  pristine("filled:Event", available(() => new Event("a"))),
  pristine("filled:IntlCollator", available(() => new Intl.Collator("en"))),
  pristine("filled:IntlNumberFormat", available(() => new Intl.NumberFormat("en"))),
  pristine("filled:IntlDateTimeFormat", available(() => new Intl.DateTimeFormat("en", { timeZone: "UTC" }))),
  pristine("filled:IntlLocale", available(() => new Intl.Locale("en-US"))),
  pristine("filled:IntlSegmenter", available(() => new Intl.Segmenter("en"))),
  pristine("filled:IntlPluralRules", available(() => new Intl.PluralRules("en"))),
  pristine("filled:IntlListFormat", available(() => new Intl.ListFormat("en"))),
  pristine("filled:IntlRelativeTimeFormat", available(() => new Intl.RelativeTimeFormat("en"))),
  pristine("filled:IntlDisplayNames", available(() => new Intl.DisplayNames("en", { type: "region" }))),
  pristine("filled:IntlDurationFormat", available(() => new (Intl as any).DurationFormat("en"))),
  pristine("filled:IntlSegments", available(() => new Intl.Segmenter("en").segment("ab cd"))),
  customized("options:type", () => ({ type: "region", style: "long" })),
  pristine("file:Blob", available(() => Bun.file("differential-scratch.txt"))),
  pristine("filled:Timeout", available(() => {
    const timeout = setTimeout(() => {}, 1);
    clearTimeout(timeout);
    return timeout;
  })),
  ...["Instant", "Duration", "PlainDate", "PlainTime", "PlainDateTime", "PlainYearMonth", "PlainMonthDay", "ZonedDateTime"].map(name =>
    pristine(`filled:Temporal${name}`, available(() => {
      const texts: Record<string, string> = {
        Instant: "2020-01-01T00:00:00Z",
        Duration: "P1D",
        PlainDate: "2020-01-01",
        PlainTime: "01:02:03",
        PlainDateTime: "2020-01-01T01:02:03",
        PlainYearMonth: "2020-01",
        PlainMonthDay: "01-01",
        ZonedDateTime: "2020-01-01T00:00:00+00:00[UTC]",
      };
      return (globalThis as any).Temporal[name].from(texts[name]);
    })),
  ),
  pristine("filled:WebAssemblyGlobal", available(() => new WebAssembly.Global({ value: "i32", mutable: true }, 1))),
  pristine("filled:WebAssemblyMemory", available(() => new WebAssembly.Memory({ initial: 1 }))),
  pristine("filled:WebAssemblyTable", available(() => new WebAssembly.Table({ initial: 1, element: "anyfunc" }))),
  pristine("filled:WebAssemblyModule", available(() => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])))),
  pristine("filled:WebAssemblyInstance", available(
    () => new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))),
  )),
  pristine("filled:DisposableStack", available(() => new DisposableStack())),
  pristine("filled:AsyncDisposableStack", available(() => new AsyncDisposableStack())),
  pristine("filled:ShadowRealm", available(() => new (globalThis as any).ShadowRealm())),
];

// A built-in that visits every index never comes back from these.
export const hugeArrayLikes: Candidate[] = [
  customized("arrayLike:hugeLength", () => ({ length: 2 ** 53 - 1 })),
  customized("arrayLike:lengthPastArrays", () => ({ length: 2 ** 32 })),
];

export const objects: Candidate[] = [
  ...plainObjects,
  ...callbacks,
  ...iterables,
  ...arrays,
  ...collections,
  ...promises,
  ...regExps,
  ...typedArrays,
  ...buffers,
  ...otherInstances,
];

export const everyCandidate: Candidate[] = [...objects, ...primitives];
// Instances that are dear to make: one is passed only where a parameter names its class.
export const candidatesForTheirClass: Candidate[] = [];

export function findCandidate(name: string): Candidate {
  const candidate = everyCandidate.find(other => other.name === name);
  if (!candidate) throw new Error(`no candidate is named ${name}`);
  return candidate;
}

// An object that answers one name with a given value, for a name that a built-in was seen to read.
export function createMemberProbe(key: PropertyKey, held: "Object" | "Function"): Candidate {
  const name = `member:${String(key)}:${held}`;
  return instrumented(name, (log, operand) => {
    const origin = contentOrigin(operand, "Property", key);
    const value = held === "Object" ? log.track({}, origin) : createCallback(log, origin, answerWithObjects(log, origin));
    return log.track({ [key]: value }, operandOrigin(operand));
  });
}

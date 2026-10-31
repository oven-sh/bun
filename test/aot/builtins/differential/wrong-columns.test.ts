// For each thing an entry can leave out: a function that does it, an entry that says so and passes, and the same entry without
// that word, which must be reported in that column.
import { expect } from "bun:test";
import { types } from "node:util";
import { describe, test } from "../../supported";
import {
  action,
  anyFunction,
  anyObject,
  anything,
  argument,
  callback,
  differencesOf,
  differingColumnsOf,
  instanceOf,
  integers,
  newValue,
  operandPlace,
  operandType,
  otherwise,
  overload,
  parameter,
  primitive,
  returning,
  type EntryChanges,
} from "./fixtures";
import type { DumpedOverload } from "./table-description";

type Case = {
  title: string;
  double: Function;
  declared: DumpedOverload;
  wrong: DumpedOverload;
  column: string;
  entry?: EntryChanges;
  wrongEntry?: EntryChanges;
  // Another overload, which claims nothing, takes what the parameters of this one do not.
  hasOtherwise?: boolean;
};

const first = argument(0);
const second = argument(1);
const objectHeaps = ["NamedProperties", "ObjectFields", "ShapeWords", "Elements"];
const ignored = () => {};
const pristineArray = instanceOf("Array");
pristineArray.parts = [{ part: "Instance", class: "Array", pristine: ["Storage", "Names"], contents: [] }];

const sizeOf = Reflect.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const timeOf = Date.prototype.getTime;
const byteAt = Uint8Array.prototype.at;
const lengthOfView = Reflect.getOwnPropertyDescriptor(Reflect.getPrototypeOf(Uint8Array.prototype)!, "length")!.get!;

function requireObject(value: unknown): void {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") throw new TypeError();
}

function withParameters(declared: DumpedOverload, ...parameters: DumpedOverload["parameters"]): DumpedOverload {
  return { ...declared, parameters };
}

const readsName = overload({ parameters: [parameter(first, { protocols: ["Named"], namedMembers: ["name"] })] });
const converts = overload({
  parameters: [parameter(first, { accepted: primitive("Number"), conversion: "ToNumber", protocols: ["ToPrimitive"] })],
  capability: "none",
  ...returning(primitive("Number")),
});
const listsKeys = overload({ parameters: [parameter(first, { protocols: ["OwnKeys"] })], throws: true });
const callsOnce = overload({
  parameters: [parameter(first, { accepted: anyFunction, uses: ["Inspects", "Calls"] })],
  callbacks: [callback(first, { arguments: [newValue(integers(1, 1))] })],
  throws: true,
});
const callsLater = overload({
  parameters: [parameter(first, { accepted: anyFunction, uses: ["Inspects", "Retains", "Calls", "CallsRepeatedly"] })],
  callbacks: [callback(first, { times: "Later" })],
  transfers: [{ from: operandPlace(first), to: { place: "NativeMemory" } }],
  capability: "heap",
  throws: true,
});
const returnsOperand = overload({
  parameters: [parameter(first, { uses: ["Inspects", "Returns"] })],
  transfers: [{ from: operandPlace(first), to: { place: "Result" } }],
  capability: "none",
  ...returning(operandType(first)),
});
const wrapsOperand = overload({
  parameters: [parameter(first, { uses: ["Inspects", "Retains"] })],
  transfers: [{ from: operandPlace(first), to: { place: "ResultSlot", slot: "ArrayElement" } }],
  capability: "heap",
  ...returning(instanceOf("Array", { freshness: "Yes" })),
});
const storesByName = overload({
  parameters: [
    parameter(first, { accepted: anyObject, uses: ["Inspects", "WritesContents", "StoresByKey"] }),
    parameter(second, { uses: ["Inspects", "Retains"] }),
  ],
  propertyActions: [
    action({ action: "StoresByKey", object: first, key: { key: "Names", names: ["x"] }, value: operandPlace(second) }),
  ],
  writes: objectHeaps,
  throws: true,
});
const deletesName = overload({
  parameters: [parameter(first, { accepted: anyObject, uses: ["Inspects", "WritesContents", "DeletesByKey"] })],
  propertyActions: [action({ action: "DeletesByKey", object: first, key: { key: "Names", names: ["a"] } })],
  writes: objectHeaps,
  throws: true,
});
const freezes = overload({
  parameters: [
    parameter(first, { accepted: anyObject, uses: ["Inspects", "ChangesIntegrity"], protocols: ["OwnKeys"] }),
  ],
  propertyActions: [action({ action: "ChangesIntegrity", object: first, integrityLevel: "Frozen" })],
  writes: objectHeaps,
  throws: true,
});
const clearsPrototype = overload({
  parameters: [parameter(first, { accepted: anyObject, uses: ["Inspects", "ChangesPrototype"] })],
  writes: ["PrototypeLinks"],
  throws: true,
});
const appends = overload({
  parameters: [parameter(first, { accepted: pristineArray, uses: ["Inspects", "ReadsContents", "WritesContents"] })],
  capability: "heap",
  reads: ["Elements", "ArrayStorage"],
  writes: ["Elements", "ArrayStorage"],
  throws: true,
});
const countsElements = overload({
  parameters: [parameter(first, { accepted: pristineArray, uses: ["Inspects", "ReadsContents"] })],
  capability: "none",
  reads: ["ArrayStorage"],
  ...returning(integers(0, 2 ** 32 - 1)),
});
const convertsElements = overload({
  parameters: [
    parameter(first, {
      accepted: pristineArray,
      uses: ["Inspects", "ReadsContents", "AppliesToContents"],
      protocols: ["ToPrimitive"],
    }),
  ],
  reads: ["Elements", "ArrayStorage"],
  throws: true,
});
const readsResultOfCallback = overload({
  parameters: [parameter(first, { accepted: anyFunction, uses: ["Inspects", "Calls"] })],
  callbacks: [callback(first, { resultUse: "Escapes" })],
  throws: true,
});
const usesReceiver = overload({
  receiver: parameter("this", { protocols: ["Named"], namedMembers: ["name"] }),
  throws: true,
});
const takesObject = overload({ parameters: [parameter(first, { accepted: anything })], capability: "none" });
const readsLengthFirst = overload({
  receiver: parameter("this", { accepted: pristineArray, uses: ["Inspects", "ReadsContents"] }),
  parameters: [parameter(first, { accepted: primitive("Number"), conversion: "ToNumber", protocols: ["ToPrimitive"] })],
  capability: "none",
  reads: ["ArrayStorage"],
  readsStateBeforeConversions: true,
  ...returning(primitive("Number")),
});
const toNumber = { accepted: primitive("Number"), conversion: "ToNumber", protocols: ["ToPrimitive"] } as const;
const refusesOtherReceivers = overload({
  receiver: parameter("this", { accepted: instanceOf("Map"), uses: ["Inspects", "ReadsContents"] }),
  parameters: [parameter(first, toNumber)],
  capability: "none",
  reads: ["CollectionStorage"],
  throws: true,
  ...returning(primitive("Number")),
});
const convertsReceiverFirst = overload({
  receiver: parameter("this", { accepted: primitive("String"), conversion: "ToString", protocols: ["ToPrimitive"] }),
  parameters: [parameter(first, toNumber)],
  throws: true,
  ...returning(primitive("String")),
});
const readsDateLast = overload({
  receiver: parameter("this", { accepted: instanceOf("Date"), uses: ["Inspects", "ReadsContents"] }),
  parameters: [parameter(first, toNumber)],
  capability: "none",
  reads: ["InternalFields"],
  throws: true,
  ...returning(primitive("Number")),
});
const readsLengthOfArgumentFirst = overload({
  parameters: [
    parameter(first, { accepted: pristineArray, uses: ["Inspects", "ReadsContents"] }),
    parameter(second, toNumber),
  ],
  capability: "none",
  reads: ["ArrayStorage"],
  readsStateBeforeConversions: true,
  ...returning(primitive("Number")),
});
const refusesNegativeIndex = overload({
  parameters: [parameter(first, { accepted: primitive("Number") }), parameter(second, toNumber)],
  capability: "none",
  throws: true,
  readsStateBeforeConversions: true,
  ...returning(primitive("Number")),
});
const convertsAnything = overload({
  parameters: [parameter(first, { protocols: ["ToPrimitive"] })],
  throws: true,
  ...returning(primitive("String")),
});
const walksEverything = overload({
  parameters: [
    parameter(first, {
      uses: ["Inspects", "ReadsContents", "AppliesTransitively"],
      protocols: ["OwnKeys", "OwnValues", "ToPrimitive", "ToJSON"],
    }),
  ],
  throws: true,
  ...returning(primitive("String", "Undefined")),
});
const sumsBytesOfAnything = overload({
  parameters: [parameter(first, { uses: ["Inspects", "ReadsContents"] })],
  capability: "none",
  reads: [...objectHeaps, "TypedArrayStorage", "TypedArrayElements"],
  ...returning(primitive("Number")),
});
const convertsBoth = overload({
  parameters: [first, second].map(operand =>
    parameter(operand, { accepted: primitive("Number"), conversion: "ToNumber", protocols: ["ToPrimitive"] }),
  ),
  capability: "none",
  ...returning(primitive("Number")),
});
const counts = overload({ capability: "none", writes: ["RuntimeState"], ...returning(primitive("Number")) });

function storeUnderName(holder: any, value: unknown): void {
  requireObject(holder);
  holder.x = value;
}

let shared: object = {};
let counter = 0;

const cases: Case[] = [
  {
    title: "a member that is read",
    double: (value: any) => void value?.name,
    declared: readsName,
    wrong: withParameters(readsName, parameter(first)),
    column: "parameters[0].protocols",
  },
  {
    title: "a conversion",
    double: (value: any) => +value,
    declared: converts,
    wrong: withParameters(converts, parameter(first, { accepted: primitive("Number") })),
    column: "parameters[0].protocols",
  },
  {
    title: "a list of the own keys",
    double: (value: any) => void Reflect.ownKeys(value),
    declared: listsKeys,
    wrong: withParameters(listsKeys, parameter(first)),
    column: "parameters[0].protocols",
  },
  {
    title: "a call of an operand",
    double: (called: Function) => void called(1),
    declared: callsOnce,
    wrong: { ...callsOnce, callbacks: [] },
    column: "callbacks",
  },
  {
    title: "an argument of a callback",
    double: (called: Function) => void called(1),
    declared: callsOnce,
    wrong: { ...callsOnce, callbacks: [callback(first)] },
    column: "callbacks[0].arguments",
  },
  {
    title: "the type of an argument of a callback",
    double: (called: Function) => void called(1),
    declared: callsOnce,
    wrong: { ...callsOnce, callbacks: [callback(first, { arguments: [newValue(primitive("String"))] })] },
    column: "callbacks[0].arguments",
  },
  {
    title: "this of a callback",
    double: (called: Function) => void Reflect.apply(called, shared, [1]),
    declared: {
      ...callsOnce,
      callbacks: [callback(first, { thisValue: newValue(anyObject), arguments: callsOnce.callbacks[0].arguments })],
    },
    wrong: callsOnce,
    column: "callbacks[0].thisValue",
  },
  {
    title: "a second call of a callback",
    double: (called: Function) => void (called(1), called(1)),
    declared: { ...callsOnce, callbacks: [{ ...callsOnce.callbacks[0], times: "Repeatedly" }] },
    wrong: callsOnce,
    column: "callbacks[0].times",
  },
  {
    title: "a call after the return",
    double: (called: Function) => {
      if (typeof called !== "function") throw new TypeError();
      queueMicrotask(() => {
        try {
          called();
        } catch {}
      });
    },
    declared: callsLater,
    wrong: { ...callsLater, callbacks: [callback(first)] },
    column: "callbacks[0].times",
  },
  {
    title: "an operand that is kept",
    double: (called: Function) => {
      if (typeof called !== "function") throw new TypeError();
      queueMicrotask(() => {
        try {
          called();
        } catch {}
      });
    },
    declared: callsLater,
    wrong: withParameters(callsLater, parameter(first, { accepted: anyFunction, uses: ["Inspects", "Calls"] })),
    column: "parameters[0].uses",
  },
  {
    title: "an operand that is returned",
    double: (value: unknown) => value,
    declared: returnsOperand,
    wrong: { ...returnsOperand, transfers: [], ...returning(anything) },
    column: "parameters[0].uses",
  },
  {
    title: "an operand in the result",
    double: (value: unknown) => [value],
    declared: wrapsOperand,
    wrong: { ...wrapsOperand, transfers: [] },
    column: "parameters[0].uses",
  },
  {
    title: "a store under a name",
    double: storeUnderName,
    declared: storesByName,
    wrong: { ...storesByName, propertyActions: [] },
    column: "parameters[0].uses",
  },
  {
    title: "the value of a store",
    double: storeUnderName,
    declared: storesByName,
    wrong: {
      ...storesByName,
      propertyActions: [{ ...storesByName.propertyActions[0], value: newValue(primitive("Number")) }],
    },
    column: "parameters[1].uses",
  },
  {
    title: "the heap of a store",
    double: storeUnderName,
    declared: storesByName,
    wrong: { ...storesByName, writes: [] },
    column: "writes",
  },
  {
    title: "a deletion",
    double: (holder: any) => {
      requireObject(holder);
      delete holder.a;
    },
    declared: deletesName,
    wrong: { ...deletesName, propertyActions: [] },
    column: "parameters[0].uses",
  },
  {
    title: "a raised integrity level",
    double: (holder: object) => {
      requireObject(holder);
      Object.freeze(holder);
    },
    declared: freezes,
    wrong: withParameters(freezes, parameter(first, { accepted: anyObject, protocols: ["OwnKeys"] })),
    column: "parameters[0].uses",
  },
  {
    title: "another prototype",
    double: (holder: object) => {
      requireObject(holder);
      Object.setPrototypeOf(holder, null);
    },
    declared: clearsPrototype,
    wrong: withParameters(clearsPrototype, parameter(first, { accepted: anyObject })),
    column: "parameters[0].uses",
  },
  {
    title: "a store to the contents",
    hasOtherwise: true,
    double: (array: unknown[]) => {
      if (!Array.isArray(array)) throw new TypeError();
      Array.prototype.push.call(array, 1);
    },
    declared: appends,
    wrong: withParameters(appends, parameter(first, { accepted: pristineArray, uses: ["Inspects", "ReadsContents"] })),
    column: "parameters[0].uses",
  },
  {
    title: "the heap that the result depends on",
    hasOtherwise: true,
    double: (array: unknown[]) => array.length,
    declared: countsElements,
    wrong: { ...countsElements, reads: [] },
    column: "reads",
  },
  {
    title: "work on what an operand holds",
    hasOtherwise: true,
    double: (array: unknown[]) => {
      if (!Array.isArray(array)) throw new TypeError();
      for (let index = 0; index < array.length; index++)
        if (Object.hasOwn(array, index)) String(Reflect.getOwnPropertyDescriptor(array, index)!.value);
    },
    declared: convertsElements,
    wrong: withParameters(
      convertsElements,
      parameter(first, { accepted: pristineArray, uses: ["Inspects", "ReadsContents"] }),
    ),
    column: "parameters[0].uses",
  },
  {
    title: "work on the result of a callback",
    double: (called: Function) => void called()?.name,
    declared: readsResultOfCallback,
    wrong: { ...readsResultOfCallback, callbacks: [callback(first)] },
    column: "callbacks.resultUse",
  },
  {
    title: "an exception",
    double: () => {
      throw new TypeError();
    },
    declared: overload({ capability: "heap", throws: true }),
    wrong: overload({ capability: "heap" }),
    column: "throws",
  },
  {
    title: "a kind of result",
    double: () => "text",
    declared: overload({ capability: "none", ...returning(primitive("String")) }),
    wrong: overload({ capability: "none", ...returning(primitive("Number")) }),
    column: "result.type",
  },
  {
    title: "negative zero among integers",
    double: () => -0,
    declared: overload({ capability: "none", ...returning(primitive("Number")) }),
    wrong: overload({ capability: "none", ...returning(integers(-1, 1)) }),
    column: "result.type",
  },
  {
    title: "an integer outside the range",
    double: () => 2 ** 31,
    declared: overload({ capability: "none", ...returning(integers(0, 2 ** 31)) }),
    wrong: overload({ capability: "none", ...returning(integers(0, 2 ** 31 - 1)) }),
    column: "result.type",
  },
  {
    title: "the class of the result",
    double: () => new Map(),
    declared: overload({ capability: "heap", ...returning(instanceOf("Map")) }),
    wrong: overload({ capability: "heap", ...returning(instanceOf("Set")) }),
    column: "result.type",
  },
  {
    title: "a result that is not new",
    double: () => shared,
    declared: overload({ capability: "none", ...returning(anyObject) }),
    wrong: overload({ capability: "none", ...returning({ ...anyObject, freshness: "Yes" }) }),
    column: "result.type.freshness",
  },
  {
    title: "an allocation",
    double: () => ({}),
    declared: overload({ capability: "heap", ...returning(anyObject) }),
    wrong: overload({ capability: "none", ...returning(anyObject) }),
    column: "capability",
  },
  {
    title: "code of an operand",
    double: (value: any) => void value?.name,
    declared: readsName,
    wrong: { ...readsName, capability: "heap" },
    column: "capability",
  },
  {
    title: "a surplus argument",
    double: (_: unknown, surplus: any) => void surplus?.name,
    declared: withParameters(
      readsName,
      parameter(first),
      parameter(second, { protocols: ["Named"], namedMembers: ["name"] }),
    ),
    wrong: withParameters(readsName, parameter(first)),
    column: "parameters",
  },
  {
    title: "a use of this",
    double: function (this: any) {
      void this.name;
    },
    declared: usesReceiver,
    wrong: { ...usesReceiver, receiver: null },
    column: "receiver",
  },
  {
    title: "a value that is taken where only objects are accepted",
    double: ignored,
    declared: takesObject,
    wrong: withParameters(takesObject, parameter(first, { accepted: anyObject })),
    column: "parameters[0].accepted",
  },
  {
    title: "the heap of a class, where native code reads whatever object it is given",
    double: (value: unknown) =>
      types.isUint8Array(value) && Reflect.apply(lengthOfView, value, []) > 0 ? Reflect.apply(byteAt, value, [0]) : 0,
    declared: sumsBytesOfAnything,
    wrong: { ...sumsBytesOfAnything, reads: objectHeaps },
    column: "reads",
  },
  {
    title: "nothing, where a protocol of the operand reads the memory",
    double: (value: unknown) => `${value}`,
    declared: convertsAnything,
    wrong: convertsAnything,
    column: "",
  },
  {
    title: "nothing, where the protocols run on all that the operand reaches",
    double: (value: unknown) => JSON.stringify(value),
    declared: walksEverything,
    wrong: walksEverything,
    column: "",
  },
  {
    title: "state that is read before a conversion",
    hasOtherwise: true,
    double: function (this: unknown[], value: unknown) {
      const { length } = this;
      return length + Number(value);
    },
    declared: readsLengthFirst,
    wrong: { ...readsLengthFirst, readsStateBeforeConversions: false },
    column: "readsStateBeforeConversions",
  },
  {
    title: "state of an argument that is read before a conversion",
    hasOtherwise: true,
    double: (list: unknown[], value: unknown) => {
      const { length } = list;
      return length + Number(value);
    },
    declared: readsLengthOfArgumentFirst,
    wrong: { ...readsLengthOfArgumentFirst, readsStateBeforeConversions: false },
    column: "readsStateBeforeConversions",
  },
  {
    title: "a value that is refused before a conversion",
    hasOtherwise: true,
    double: (index: unknown, value: unknown) => {
      if (typeof index !== "number") throw new TypeError();
      if (index < 0) throw new RangeError();
      return index + Number(value);
    },
    declared: refusesNegativeIndex,
    wrong: { ...refusesNegativeIndex, readsStateBeforeConversions: false },
    column: "readsStateBeforeConversions",
  },
  {
    title: "nothing, where a receiver that the entry does not take is refused before a conversion",
    double: function (this: unknown, value: unknown) {
      if (!types.isMap(this)) throw new TypeError();
      return Number(value) + Reflect.apply(sizeOf, this, []);
    },
    declared: refusesOtherReceivers,
    wrong: refusesOtherReceivers,
    column: "",
  },
  {
    title: "nothing, where the receiver is converted before the arguments",
    double: function (this: unknown, value: unknown) {
      const text = `${this}`;
      return text + Number(value);
    },
    declared: convertsReceiverFirst,
    wrong: convertsReceiverFirst,
    column: "",
  },
  {
    title: "nothing, where a conversion makes the receiver an invalid date",
    hasOtherwise: true,
    double: function (this: unknown, value: unknown) {
      if (!types.isDate(this)) throw new TypeError();
      return Number(value) + Reflect.apply(timeOf, this, []);
    },
    declared: readsDateLast,
    wrong: readsDateLast,
    column: "",
  },
  {
    title: "the order of the conversions",
    double: (left: unknown, right: unknown) => Number(left) + Number(right),
    declared: convertsBoth,
    wrong: convertsBoth,
    column: "",
  },
  {
    title: "a result that changes on its own",
    double: () => counter++,
    declared: counts,
    wrong: { ...counts, writes: [] },
    column: "writes",
  },
  {
    title: "a result that depends on more than the operands",
    double: () => counter++,
    declared: counts,
    wrong: counts,
    wrongEntry: { flags: ["IsDeterministic"] },
    column: "flags.IsDeterministic",
  },
];

describe("an entry that leaves out", () => {
  for (const { title, double, declared, wrong, column, entry, wrongEntry, hasOtherwise } of cases) {
    const others = hasOtherwise ? [otherwise] : [];
    test(title, async () => {
      expect(await differencesOf(double, [declared, ...others], entry)).toEqual([]);
      if (column !== "")
        expect(await differingColumnsOf(double, [wrong, ...others], wrongEntry ?? entry)).toContain(column);
    });
  }

  test("conversions in another order than the parameters", async () => {
    const backwards = (left: unknown, right: unknown) => Number(right) + Number(left);
    expect(await differingColumnsOf(backwards, [convertsBoth])).toContain("parameters");
  });
});

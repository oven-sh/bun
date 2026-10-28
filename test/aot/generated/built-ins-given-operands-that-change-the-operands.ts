// Every function, method, constructor and accessor of the language that the table of built-ins lists is called with an operand that carries code of the program: conversions, getters, members that
// are called, iterators, callbacks, proxies, thenables and heirs of built-in classes. That code changes something the call works on while the call is under way: the receiver, another
// operand or the operand itself gets a property, loses one, has one redefined, gets another prototype, is frozen, grows, shrinks, or holds values of another kind. The case looks at all
// of them behind the call, with reads of its own. Accessors are read and stored to on such a receiver. Other operands carry no code and hold the operands beside them, so that one object
// reaches the call twice. The calls follow from the table, so a new row is called too.
//
//   bun built-ins-given-operands-that-change-the-operands.ts <aot_builtin_table.json>                      prints the programs' names and how many rows are not called
//   bun built-ins-given-operands-that-change-the-operands.ts <aot_builtin_table.json> <folder> [regexp]    writes the programs there; CASES_IN_ONE_PROGRAM=1 writes a program for each case
//   bun built-ins-given-operands-that-change-the-operands.ts <aot_builtin_table.json> --names | --text <name>    for the test: the names as JSON, the text of one program
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Type = {
  isAnything: boolean;
  hasAnyObject: boolean;
  hasAnyFunction: boolean;
  primitives: string[];
  stringLiterals: string[];
  parts: { part: string; class?: string }[];
};
type Parameter = { mode: string; accepted: Type; namedMembers: string[]; calledMembers: string[] };
type Overload = { mode: string; parameters: Parameter[] };
type Entry = { path: string; kind: string; origin: string; overloads: Overload[] };
export type Table = { entries: Entry[] };

// What can be changed, and how a case looks at it.
type Sort =
  "object" | "array" | "bytes" | "buffer" | "map" | "set" | "regexp" | "date" | "function" | "other" | "primitive";
type Sample = { text: string; sort: Sort };

const receivers: Record<string, Sample> = {
  Array: { text: "[1, 2, 3]", sort: "array" },
  "%TypedArray%": { text: "new Uint8Array([1, 2, 3, 4])", sort: "bytes" },
  Uint8Array: { text: "new Uint8Array([1, 2, 3, 4])", sort: "bytes" },
  ArrayBuffer: { text: "new ArrayBuffer(8, { maxByteLength: 16 })", sort: "buffer" },
  SharedArrayBuffer: { text: "new SharedArrayBuffer(8, { maxByteLength: 16 })", sort: "other" },
  DataView: { text: "new DataView(new ArrayBuffer(16))", sort: "other" },
  Map: { text: "new Map([[1, 1], [2, 2]])", sort: "map" },
  Set: { text: "new Set([1, 2])", sort: "set" },
  WeakMap: { text: "new WeakMap([[other, 1]])", sort: "other" },
  WeakSet: { text: "new WeakSet([other])", sort: "other" },
  WeakRef: { text: "new WeakRef(other)", sort: "other" },
  RegExp: { text: "/a/g", sort: "regexp" },
  Date: { text: "new Date(0)", sort: "date" },
  Promise: { text: "Promise.resolve(1)", sort: "other" },
  Error: { text: 'new Error("m")', sort: "other" },
  Function: { text: "function (first) { return first; }", sort: "function" },
  Object: { text: "{ a: 1, b: 2 }", sort: "object" },
  String: { text: '"abcabc"', sort: "primitive" },
  Number: { text: "1.5", sort: "primitive" },
  Boolean: { text: "true", sort: "primitive" },
  BigInt: { text: "1n", sort: "primitive" },
  Symbol: { text: 'Symbol("y")', sort: "primitive" },
  Iterator: { text: "[1, 2, 3].values()", sort: "other" },
  "%ArrayIterator%": { text: "list.values()", sort: "other" },
  "%MapIterator%": { text: "new Map([[1, 1]]).entries()", sort: "other" },
  "%SetIterator%": { text: "new Set([1]).values()", sort: "other" },
  "%StringIterator%": { text: '"ab"[Symbol.iterator]()', sort: "other" },
  "%RegExpStringIterator%": { text: '"aa".matchAll(/a/g)', sort: "other" },
  "%IteratorHelper%": { text: "list.values().map(each => each)", sort: "other" },
  "%WrapForValidIterator%": { text: "Iterator.from({ next: () => ({ done: false, value: 1 }) })", sort: "other" },
  "%Generator%": { text: "(function* () { for (;;) yield 1; })()", sort: "other" },
  "%AsyncGenerator%": { text: "(async function* () { for (;;) yield 1; })()", sort: "other" },
  "%AsyncIterator%": { text: "(async function* () { for (;;) yield 1; })()", sort: "other" },
  DisposableStack: { text: "new DisposableStack()", sort: "other" },
  AsyncDisposableStack: { text: "new AsyncDisposableStack()", sort: "other" },
  "Intl.Collator": { text: 'new Intl.Collator("en")', sort: "other" },
  "Intl.DateTimeFormat": { text: 'new Intl.DateTimeFormat("en", { timeZone: "UTC" })', sort: "other" },
  "Intl.DisplayNames": { text: 'new Intl.DisplayNames("en", { type: "region" })', sort: "other" },
  "Intl.DurationFormat": { text: 'new Intl.DurationFormat("en")', sort: "other" },
  "Intl.ListFormat": { text: 'new Intl.ListFormat("en")', sort: "other" },
  "Intl.Locale": { text: 'new Intl.Locale("en")', sort: "other" },
  "Intl.NumberFormat": { text: 'new Intl.NumberFormat("en")', sort: "other" },
  "Intl.PluralRules": { text: 'new Intl.PluralRules("en")', sort: "other" },
  "Intl.RelativeTimeFormat": { text: 'new Intl.RelativeTimeFormat("en")', sort: "other" },
  "Intl.Segmenter": { text: 'new Intl.Segmenter("en")', sort: "other" },
  "%IntlSegments%": { text: 'new Intl.Segmenter("en").segment("ab")', sort: "other" },
  "%IntlSegmentIterator%": { text: 'new Intl.Segmenter("en").segment("ab")[Symbol.iterator]()', sort: "other" },
  "Temporal.Duration": { text: "new Temporal.Duration(1, 2)", sort: "other" },
  "Temporal.Instant": { text: "new Temporal.Instant(0n)", sort: "other" },
  "Temporal.PlainDate": { text: "new Temporal.PlainDate(2020, 1, 2)", sort: "other" },
  "Temporal.PlainDateTime": { text: "new Temporal.PlainDateTime(2020, 1, 2, 3, 4)", sort: "other" },
  "Temporal.PlainMonthDay": { text: "new Temporal.PlainMonthDay(1, 2)", sort: "other" },
  "Temporal.PlainTime": { text: "new Temporal.PlainTime(1, 2)", sort: "other" },
  "Temporal.PlainYearMonth": { text: "new Temporal.PlainYearMonth(2020, 1)", sort: "other" },
  "Temporal.ZonedDateTime": { text: 'new Temporal.ZonedDateTime(0n, "UTC")', sort: "other" },
};

// They evaluate text, wait, answer differently each time, or are no part of an executable.
const notCalled =
  /^(new )?(eval|Function|ShadowRealm|WebAssembly|FinalizationRegistry|console)\b|^(new )?%(Async)?(Generator)?Function%|^%LinkTimeConstant|^Atomics\.(wait|waitAsync)$|^(Date\.now|Math\.random|Error\.captureStackTrace|Date)$|^Temporal\.Now\b|^%AsyncFromSyncIterator%|toLocale|^Date\.prototype\.(toString|toDateString|toTimeString|getTimezoneOffset)$|^Function\.prototype\.toString$/;

export type Callable = {
  label: string;
  receiver: Sample | null;
  /** The call, given the name of the receiver and the texts of the operands. */
  call: (receiver: string, operands: string[]) => string;
  /** The same on another receiver, where that is not written `.call(..)`. */
  callOn?: (receiver: string, operands: string[]) => string;
  parameters: Parameter[];
};

const accessOf = (path: string) => /(\.[A-Za-z_$][\w$]*|\[Symbol\.\w+\])$/.exec(path)?.[0] ?? "";

export function listCallables(table: Table): { callables: Callable[]; left: string[] } {
  const callables: Callable[] = [];
  const left: string[] = [];
  for (const entry of table.entries) {
    if (entry.origin !== "Engine") continue;
    if (entry.kind === "Accessor") {
      const access = accessOf(entry.path);
      const holder = entry.path.slice(0, entry.path.length - access.length);
      const receiver = holder.endsWith(".prototype") ? receivers[holder.slice(0, -".prototype".length)] : undefined;
      if (!receiver || holder.includes("%") || notCalled.test(entry.path)) {
        left.push(entry.path);
        continue;
      }
      const key = access.startsWith(".") ? JSON.stringify(access.slice(1)) : access.slice(1, -1);
      for (const overload of entry.overloads)
        if (overload.mode === "Get")
          callables.push({
            label: `get ${entry.path}`,
            receiver,
            call: self => `${self}${access}`,
            callOn: self => `Reflect.get(${holder}, ${key}, ${self})`,
            parameters: [],
          });
        else if (overload.mode === "Set")
          callables.push({
            label: `set ${entry.path}`,
            receiver,
            call: (self, operands) => `(${self}${access} = ${operands[0]})`,
            callOn: (self, operands) => `Reflect.set(${holder}, ${key}, ${operands[0]}, ${self})`,
            parameters: overload.parameters.slice(0, 1),
          });
      continue;
    }
    if (!["Function", "Method", "Constructor"].includes(entry.kind)) continue;
    for (const mode of ["Call", "Construct"]) {
      const overloads = entry.overloads.filter(overload => overload.mode === mode);
      if (overloads.length === 0) continue;
      const path = entry.path.replace(/^%TypedArray%(?=\.(from|of)$)/, "Uint8Array");
      const label = mode === "Construct" ? `new ${path}` : path;
      if (notCalled.test(label)) {
        left.push(label);
        continue;
      }
      const longest = overloads.reduce((a, b) => (b.parameters.length > a.parameters.length ? b : a));
      const parameters = longest.parameters.map((parameter, index) => ({
        ...parameter,
        namedMembers: [...new Set(overloads.flatMap(each => each.parameters[index]?.namedMembers ?? []))],
        calledMembers: [...new Set(overloads.flatMap(each => each.parameters[index]?.calledMembers ?? []))],
      }));
      const access = accessOf(entry.path);
      const holder = entry.path.slice(0, entry.path.length - access.length);
      if (entry.kind === "Method" && holder.endsWith(".prototype")) {
        const receiver = receivers[holder.slice(0, -".prototype".length)];
        if (!receiver) {
          left.push(entry.path);
          continue;
        }
        callables.push({
          label: entry.path,
          receiver,
          call: (self, operands) => `${self}${access}(${operands.join(", ")})`,
          parameters,
        });
      } else if (path.includes("%")) left.push(label);
      else
        callables.push({
          label,
          receiver: null,
          call: (_, operands) => `${label}(${operands.join(", ")})`,
          parameters,
        });
    }
  }
  return { callables, left };
}

// An operand for a parameter that carries no code. Where the function takes an object or an array it is one that the code of the other operand may change.
function sampleOf(parameter: Parameter | undefined): string {
  if (!parameter) return "other";
  const { accepted } = parameter;
  const classes = accepted.parts.map(part => part.class);
  if (accepted.stringLiterals.length > 0) return JSON.stringify(accepted.stringLiterals[0]);
  if (accepted.hasAnyFunction && !accepted.isAnything) return "function (each) { return each; }";
  if (classes.includes("Array")) return "list";
  if (accepted.isAnything || accepted.hasAnyObject) return "other";
  for (const name of classes)
    if (name && receivers[name] && receivers[name].sort !== "primitive") return receivers[name].text;
  if (accepted.primitives.includes("Number")) return "1";
  if (accepted.primitives.includes("String")) return '"a"';
  if (accepted.primitives.includes("Boolean")) return "true";
  if (accepted.primitives.includes("BigInt")) return "1n";
  if (accepted.primitives.includes("Symbol")) return "Symbol.iterator";
  return "undefined";
}

const isName = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);
const keyText = (name: string) =>
  name.startsWith("@@") ? `[Symbol.${name.slice(2)}]` : isName(name) ? name : `[${JSON.stringify(name)}]`;

const traps = [
  "get",
  "set",
  "has",
  "deleteProperty",
  "ownKeys",
  "getOwnPropertyDescriptor",
  "defineProperty",
  "getPrototypeOf",
  "setPrototypeOf",
  "isExtensible",
  "preventExtensions",
  "apply",
  "construct",
];
const proxyOf = (target: string) =>
  `new Proxy(${target}, { ${traps.map(trap => `${trap}(...passed) { change(); return Reflect.${trap}(...passed); }`).join(", ")} })`;
const steps =
  "{ next() { change(); return { done: count++ > 1, value: [count, count] }; }, return() { change(); return {}; } }";
const readNames = [
  "length",
  "constructor",
  "then",
  "name",
  "message",
  "cause",
  "flags",
  "lastIndex",
  "source",
  "size",
  "has",
  "keys",
  "next",
  "done",
  "value",
  "get",
  "set",
  "enumerable",
  "configurable",
  "writable",
  "raw",
  "index",
  "@@toStringTag",
  "@@isConcatSpreadable",
  "@@species",
  "@@match",
];
const fieldNames = [
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
  "millisecond",
  "years",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "initial",
  "maximum",
  "byteOffset",
  "maxByteLength",
  "start",
  "end",
];
const heir = (base: string, passed: string, more = "") =>
  `new (class extends ${base} { static get [Symbol.species]() { change(); return ${base}; } ${more} })(${passed})`;

// The operand. Its code calls change().
type Kind = {
  name: string;
  sort: Sort;
  write(parameter: Parameter | undefined): string;
  /** It carries no code. It holds the other operands, so that one object reaches the call both as an operand and inside another. The call is made three times. */
  holdsTheOthers?: true;
};
const kinds: Kind[] = [
  {
    name: "to-primitive",
    sort: "object",
    write: () => `{ a: 1, b: 2, [Symbol.toPrimitive]: hint => (change(), hint === "number" ? 1 : "a") }`,
  },
  {
    name: "value-of-and-to-string",
    sort: "object",
    write: () => `{ a: 1, b: 2, valueOf: () => (change(), 1), toString: () => (change(), "a") }`,
  },
  {
    name: "getters",
    sort: "object",
    write: parameter =>
      `{ a: 1, b: 2, ${[
        ...new Set([...readNames, ...(parameter?.namedMembers ?? []), ...(parameter?.calledMembers ?? [])]),
      ]
        .filter(name => name !== "__proto__" && name !== "a" && name !== "b")
        .map(name => `get ${keyText(name)}() { change(); return undefined; }`)
        .join(", ")} }`,
  },
  {
    name: "getters-of-numbers",
    sort: "object",
    write: parameter =>
      `{ a: 1, b: 2, ${[...new Set([...fieldNames, ...(parameter?.namedMembers ?? [])])]
        .filter(name => isName(name) && name !== "__proto__" && name !== "a" && name !== "b")
        .map(name => `get ${name}() { change(); return 1; }`)
        .join(", ")} }`,
  },
  {
    name: "array-like",
    sort: "object",
    write: () =>
      `{ a: 1, b: 2, get length() { change(); return 2; }, get 0() { change(); return 1; }, get 1() { change(); return 2; } }`,
  },
  {
    name: "iterable",
    sort: "object",
    write: () => `{ a: 1, b: 2, [Symbol.iterator]() { change(); return ${steps}; } }`,
  },
  { name: "iterator", sort: "object", write: () => `{ a: 1, b: 2, ...${steps} }` },
  {
    name: "async-iterable",
    sort: "object",
    write: () =>
      `{ a: 1, b: 2, [Symbol.asyncIterator]() { change(); return { next() { change(); return Promise.resolve({ done: count++ > 1, value: count }); } }; } }`,
  },
  {
    name: "callback",
    sort: "function",
    write: () =>
      `function (...passed) { change(); return passed.length > 1 && typeof passed[1] === "number" ? passed[0] : 1; }`,
  },
  { name: "thenable", sort: "object", write: () => `{ a: 1, b: 2, then(resolve) { change(); resolve(1); } }` },
  { name: "to-json", sort: "object", write: () => `{ a: 1, b: 2, toJSON() { change(); return 1; } }` },
  {
    name: "set-like",
    sort: "object",
    write: () => `{ a: 1, b: 2, size: 2, has() { change(); return true; }, keys() { change(); return ${steps}; } }`,
  },
  {
    name: "descriptor",
    sort: "object",
    write: () =>
      `{ a: 1, b: 2, get value() { change(); return 1; }, get writable() { change(); return true; }, get enumerable() { change(); return true; }, get configurable() { change(); return true; } }`,
  },
  {
    name: "descriptors",
    sort: "object",
    write: () =>
      `{ a: { get value() { change(); return 1; }, configurable: true, writable: true, enumerable: true }, b: { get get() { change(); return undefined; }, configurable: true } }`,
  },
  {
    name: "own-accessors",
    sort: "object",
    write: () =>
      `{ get a() { change(); return 1; }, set a(value) { change(); }, get b() { change(); return 2; }, set b(value) { change(); } }`,
  },
  {
    name: "array-of-objects",
    sort: "array",
    write: () =>
      `[{ toString: () => (change(), "a"), valueOf: () => (change(), 1) }, { toString: () => (change(), "b"), valueOf: () => (change(), 2) }, 3]`,
  },
  {
    name: "array-with-an-accessor",
    sort: "array",
    write: () =>
      `Object.defineProperty([1, 2, 3], 1, { get() { change(); return 2; }, set(value) { change(); }, configurable: true, enumerable: true })`,
  },
  { name: "proxy-of-an-object", sort: "other", write: () => proxyOf("{ a: 1, b: 2 }") },
  { name: "proxy-of-an-array", sort: "other", write: () => proxyOf("[1, 2, 3]") },
  { name: "proxy-of-a-function", sort: "other", write: () => proxyOf("function () { return 1; }") },
  { name: "heir-of-array", sort: "array", write: () => heir("Array", "1, 2, 3") },
  { name: "heir-of-bytes", sort: "bytes", write: () => heir("Uint8Array", "4") },
  { name: "heir-of-buffer", sort: "buffer", write: () => heir("ArrayBuffer", "8") },
  {
    name: "heir-of-promise",
    sort: "other",
    write: () =>
      heir("Promise", "resolve => resolve(1)", "then(...passed) { change(); return super.then(...passed); }"),
  },
  {
    name: "heir-of-regexp",
    sort: "regexp",
    write: () =>
      heir(
        "RegExp",
        '"a", "g"',
        "exec(text) { change(); return super.exec(text); } get flags() { change(); return super.flags; }",
      ),
  },
  {
    name: "regexp-with-exec",
    sort: "regexp",
    write: () =>
      `Object.assign(/a/g, { exec(text) { change(); return count++ > 1 ? null : Object.assign(["a"], { index: count, input: text }); } })`,
  },
  {
    name: "heir-of-map",
    sort: "map",
    write: () =>
      heir(
        "Map",
        "[[1, 1], [2, 2]]",
        "set(...passed) { change(); return super.set(...passed); } get(key) { change(); return super.get(key); } has(key) { change(); return super.has(key); }",
      ),
  },
  {
    name: "heir-of-set",
    sort: "set",
    write: () =>
      heir(
        "Set",
        "[1, 2]",
        "add(value) { change(); return super.add(value); } has(value) { change(); return super.has(value); } keys() { change(); return super.keys(); } get size() { change(); return super.size; }",
      ),
  },
  {
    name: "constructor",
    sort: "function",
    write: () =>
      `class { constructor(...passed) { change(); return typeof passed[0] === "function" ? new Promise(passed[0]) : typeof passed[0] === "number" ? new Array(passed[0]) : this; } static resolve(value) { change(); return Promise.resolve(value); } }`,
  },
];

const kindsThatHoldTheOthers: Kind[] = [
  {
    name: "object-that-holds-the-others",
    sort: "object",
    holdsTheOthers: true,
    write: () => `{ a: other, b: list, 0: other, 1: list }`,
  },
  { name: "array-that-holds-the-others", sort: "array", holdsTheOthers: true, write: () => `[other, list, other]` },
];

const everySort: [string, string][] = [
  ["add", "it.added = 1;"],
  ["prototype", "Object.setPrototypeOf(it, Object.create(Object.getPrototypeOf(it), { inherited: { value: 7 } }));"],
  ["freeze", "Object.freeze(it);"],
  ["prevent-extensions", "Object.preventExtensions(it);"],
];
const changesOf: Record<Sort, [string, string][]> = {
  object: [
    ...everySort,
    ["delete", "delete it.a;"],
    ["other-kind", 'it.a = "s";'],
    ["accessor", 'Object.defineProperty(it, "a", { get: () => 9, configurable: true });'],
    ["read-only", 'Object.defineProperty(it, "b", { value: 8, writable: false });'],
    ["hidden", 'Object.defineProperty(it, "a", { enumerable: false });'],
    ["index", "it[0] = 6;"],
    ["many", 'for (let at = 0; at < 70; at++) it["k" + at] = at;'],
  ],
  array: [
    ...everySort,
    ["grow", "it.push(4, 5);"],
    ["shrink", "it.length = 1;"],
    ["empty", "it.length = 0;"],
    ["text", 'it[0] = "s";'],
    ["fraction", "it[1] = 1.5;"],
    ["hole", "delete it[1];"],
    ["far", "it[40] = 1;"],
    ["very-far", "it[1000000] = 1;"],
    ["accessor", "Object.defineProperty(it, 0, { get: () => 9, configurable: true });"],
    ["shift", "it.shift();"],
    ["reverse", "it.reverse();"],
  ],
  bytes: [
    ["add", "it.added = 1;"],
    ["prototype", everySort[1][1]],
    ["detach", "it.buffer.transfer();"],
    ["store", "it[0] = 9; it[3] = 8;"],
  ],
  buffer: [
    ["add", "it.added = 1;"],
    ["detach", "it.transfer();"],
    ["resize", "it.resize(4);"],
    ["grow", "it.resize(16);"],
  ],
  map: [...everySort, ["clear", "it.clear();"], ["set", "it.set(5, 5); it.set(1, 9);"], ["delete", "it.delete(2);"]],
  set: [...everySort, ["clear", "it.clear();"], ["more", "it.add(5);"], ["delete", "it.delete(2);"]],
  regexp: [
    ...everySort,
    ["last-index", "it.lastIndex = 1;"],
    ["compile", 'it.compile("b", "gi");'],
    ["own-exec", "it.exec = () => null;"],
    ["fixed-last-index", 'Object.defineProperty(it, "lastIndex", { writable: false });'],
  ],
  date: [...everySort, ["time", "it.setTime(5);"], ["invalid", "it.setTime(NaN);"]],
  function: [
    ...everySort,
    ["own-prototype", "it.prototype = { made: 1 };"],
    ["name", 'Object.defineProperty(it, "name", { value: "renamed" });'],
    ["length", 'Object.defineProperty(it, "length", { value: 9 });'],
  ],
  other: everySort,
  primitive: [],
};
const common = "it.added, it.inherited, Object.isFrozen(it), Object.isExtensible(it)";
const looks: Record<Sort, string> = {
  object: `[it.a, it.b, it[0], typeof it.a, "a" in it, Object.keys(it).length > 9 ? "many" : Object.keys(it).join("|"), ${common}]`,
  array: `[it.length, it[0], it[1], it[2], it[3], 1 in it, typeof it[0], ${common}]`,
  bytes: `[it.length, it[0], it[3], it.byteLength, it.added, it.inherited]`,
  buffer: `[it.byteLength, it.detached, it.added]`,
  map: `[it.size, it.get(1), it.has(2), it.has(5), ${common}]`,
  set: `[it.size, it.has(1), it.has(2), it.has(5), ${common}]`,
  regexp: `[it.lastIndex, it.source, it.flags, typeof it.exec, ${common}]`,
  date: `[it.getTime(), ${common}]`,
  function: `[typeof it.prototype, it.name, it.length, ${common}]`,
  other: `[${common}]`,
  primitive: "[]",
};
const lookAt = (name: string, sort: Sort) => looks[sort].replace(/\bit\b/g, name) + ".join()";

export type Case = { victim: string; change: string; at: number };
type Plan = { callable: Callable; position: number; kind: Kind };
const victimsOf = ({ callable, position, kind }: Plan): [string, Sort][] => [
  ...(callable.receiver && position >= 0 && callable.receiver.sort !== "primitive"
    ? ([["receiver", callable.receiver.sort]] as [string, Sort][])
    : []),
  ["other", "object"],
  ["list", "array"],
  ["operand", kind.sort],
];

// Position -1: the operand stands in the place of the receiver.
function writeCase(name: string, plan: Plan, wanted: Case | null): string {
  const { callable, position, kind } = plan;
  const chosen = kind.holdsTheOthers ? null : wanted;
  const victims = victimsOf(plan);
  const sort = chosen ? victims.find(([victim]) => victim === chosen.victim)![1] : "other";
  const text = chosen
    ? changesOf[sort].find(([change]) => change === chosen.change)![1].replace(/\bit\b/g, chosen.victim)
    : "";
  const count = Math.max(callable.parameters.length, position + 1);
  const operands = Array.from({ length: count }, (_, index) =>
    index === position ? "operand" : sampleOf(callable.parameters[index]),
  );
  const call =
    position >= 0
      ? callable.call("receiver", operands)
      : callable.callOn
        ? callable.callOn("operand", operands)
        : callable.call("receiver", []).replace(/\(\)$/, `.call(${["operand", ...operands].join(", ")})`);
  const looksAt = `[${victims.map(([victim, each]) => lookAt(victim, each)).join(", ")}].join(" ; ")`;
  return [
    `function ${name}() {`,
    `  let ran = 0, count = 0, isLooking = true;`,
    `  const other = { a: 1, b: 2 }, list = [1, 2, 3];`,
    ...(callable.receiver ? [`  const receiver = ${callable.receiver.text};`] : []),
    `  const change = () => { if (isLooking || ran++ !== ${chosen?.at ?? -1}) return; ${text} };`,
    `  const operand = ${kind.write(callable.parameters[position])};`,
    `  let outcome, behind;`,
    `  isLooking = false;`,
    `  try { ${kind.holdsTheOthers ? "for (let turn = 0; turn < 3; turn++) " : ""}outcome = show(${call}); } catch (error) { outcome = "throws " + (error instanceof Error ? error.name : typeof error); }`,
    `  isLooking = true;`,
    `  try { behind = ${looksAt}; } catch (error) { behind = "throws " + error.name; }`,
    `  isLooking = false;`,
    `  return [outcome, ran, behind, () => { isLooking = true; try { return ran + " ; " + ${looksAt}; } catch (error) { return ran + " ; throws " + error.name; } }];`,
    `}`,
  ].join("\n");
}

const prologue = `
function show(value, depth = 0) {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return value + "n";
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  if (value instanceof Promise) return "promise";
  if (value instanceof Error) return value.name + ": " + value.message;
  if (depth > 1) return "..";
  if (Array.isArray(value)) { const parts = []; for (let at = 0; at < Math.min(value.length, 8); at++) parts.push(at in value ? show(value[at], depth + 1) : "hole"); return "[" + parts.join() + "]" + value.length; }
  if (ArrayBuffer.isView(value)) return "view " + value.byteLength;
  if (value instanceof Map || value instanceof Set) return "size " + value.size;
  const names = Reflect.ownKeys(value).filter(key => typeof key === "string").slice(0, 8);
  return Object.prototype.toString.call(value) + "{" + names.map(key => { const own = Object.getOwnPropertyDescriptor(value, key); return key + ":" + ("value" in own ? show(own.value, depth + 1) : "accessor"); }).join() + "}";
}
`;
const epilogue = (names: string[], labels: string[]) => `
process.on("unhandledRejection", () => {});
const cases = [${names.join(", ")}];
const labels = ${JSON.stringify(labels)};
const later = [];
for (let chosen = 0; chosen < cases.length; chosen++) {
  const [outcome, ran, behind, look] = cases[chosen]();
  console.log(labels[chosen] + " | " + outcome + " | " + ran + " | " + behind);
  later.push(look);
}
for (let turn = 0; turn < 12; turn++) await null;
for (let chosen = 0; chosen < cases.length; chosen++) console.log(labels[chosen] + " later | " + later[chosen]());
`;

const show = new Function(`${prologue}\nreturn show;`)();

/** How often the code of the operand runs, inside the call and in the jobs behind it, in this very process. */
async function timesTheCodeRuns(plan: Plan): Promise<number> {
  try {
    const [, ranInside, , look] = new Function("show", `${writeCase("probe", plan, null)}\nreturn probe();`)(show);
    if (ranInside === 0) for (let turn = 0; turn < 12; turn++) await null;
    return Number(look().split(" ; ")[0]);
  } catch {
    return 0;
  }
}

/** `plans`: a case for each of them, in which nothing is changed. */
export type Program = { name: string; cases: Case[]; plan: Plan; plans?: Plan[] };

const nameOf = ({ callable, position, kind }: Plan) =>
  `${callable.label}, ${position < 0 ? "this" : position}, ${kind.name}`;
const plansOf = (callable: Callable): Plan[] =>
  Array.from(
    { length: callable.parameters.length + (callable.receiver ? 2 : 1) },
    (_, index) => index - (callable.receiver ? 1 : 0),
  ).flatMap(position => kinds.map(kind => ({ callable, position, kind })));

/** Null where the call runs no code of the operand. */
export async function programOf(plan: Plan): Promise<Program | null> {
  const times = await timesTheCodeRuns(plan);
  if (times === 0) return null;
  const cases = victimsOf(plan).flatMap(([victim, sort]) =>
    changesOf[sort].flatMap(([change]) => [0, 1].filter(at => at < times).map(at => ({ victim, change, at }))),
  );
  return { name: nameOf(plan), cases, plan };
}

export async function listPrograms(
  table: Table,
  wanted = (name: string) => true,
): Promise<{ programs: Program[]; left: string[] }> {
  const { callables, left } = listCallables(table);
  const programs: Program[] = [];
  process.on("unhandledRejection", () => {});
  for (const callable of callables) {
    const before = programs.length;
    for (const plan of plansOf(callable)) {
      const program = wanted(nameOf(plan)) ? await programOf(plan) : null;
      if (program) programs.push(program);
    }
    if (programs.length === before) left.push(`${callable.label} (runs no code of an operand)`);
    const plans = plansOf(callable)
      .filter(plan => plan.kind === kinds[0])
      .flatMap(plan => kindsThatHoldTheOthers.map(kind => ({ ...plan, kind })));
    const name = `${callable.label}, operands that hold the others`;
    if (wanted(name)) programs.push({ name, cases: [], plan: plans[0], plans });
  }
  return { programs, left };
}

export function textOf(program: Program, cases = program.cases): string {
  if (program.plans) {
    const names = program.plans.map((_, index) => `case${index}`);
    return (
      prologue +
      program.plans.map((plan, index) => writeCase(names[index], plan, null)).join("\n") +
      epilogue(
        names,
        program.plans.map(plan => `${plan.position < 0 ? "this" : plan.position} ${plan.kind.name}`),
      )
    );
  }
  const names = cases.map((_, index) => `case${index}`);
  return (
    prologue +
    cases.map((each, index) => writeCase(names[index], program.plan, each)).join("\n") +
    epilogue(
      names,
      cases.map(each => `${each.victim} ${each.change} ${each.at}`),
    )
  );
}

if (import.meta.main) {
  const [tablePath, folder, filterText] = process.argv.slice(2);
  const table: Table = JSON.parse(readFileSync(tablePath, "utf8"));
  const fileOf = (name: string) => name.replace(/[^\w.%-]+/g, "_");
  if (folder === "--text") console.log(textOf((await listPrograms(table, name => name === filterText)).programs[0]));
  else if (folder === "--names")
    console.log(JSON.stringify((await listPrograms(table)).programs.map(program => program.name)));
  else if (folder === undefined) {
    const { programs, left } = await listPrograms(table);
    for (const program of programs) console.log(program.name, program.cases.length);
    console.log(`${programs.length} programs; not called: ${left.join(" ")}`);
  } else {
    mkdirSync(folder, { recursive: true });
    const filter = new RegExp(filterText ?? ".");
    const { programs, left } = await listPrograms(table, name => filter.test(name));
    let count = 0;
    for (const program of programs) {
      if (process.env.CASES_IN_ONE_PROGRAM === "1" && !program.plans)
        for (const each of program.cases)
          (writeFileSync(
            join(folder, `${fileOf(program.name)}__${each.victim}-${each.change}-${each.at}.mjs`),
            textOf(program, [each]),
          ),
            count++);
      else (writeFileSync(join(folder, `${fileOf(program.name)}.mjs`), textOf(program)), count++);
    }
    console.log(
      `${count} programs, ${programs.reduce((sum, each) => sum + each.cases.length, 0)} cases, ${left.length} rows not called`,
    );
  }
  process.exit(0);
}

import type { TableType } from "./table";

export interface ClassSample {
  base: string;
  make(constructor: string): string;
  empty?: string;
  numbers?: string;
  items?: string;
  setup?: string[];
}

const made = (base: string, passed: string, more: Partial<ClassSample> = {}): ClassSample => ({
  base,
  make: constructor => `new ${constructor}(${passed})`,
  ...more,
});
const only = (text: string, more: Partial<ClassSample> = {}): ClassSample => ({ base: "", make: () => text, ...more });

const typedArray = (name: string, isBig = false) =>
  made(name, isBig ? "[1n, 2n, 3n]" : "[1, 2, 3]", { empty: `new ${name}(0)` });

export const itemSetup = [
  "class Item {",
  "  constructor(size) {",
  "    this.size = size;",
  "  }",
  "  double() {",
  "    return this.size * 2;",
  "  }",
  "}",
  "const item = new Item(1.5);",
];

export const classSamples: Record<string, ClassSample> = {
  Array: {
    base: "Array",
    make: constructor => (constructor === "Array" ? '[1.5, item, "two"]' : `new ${constructor}(1.5, item, "two")`),
    empty: "[]",
    numbers: "[1, 2, 3]",
    items: "[item, item, item]",
  },
  Map: made("Map", '[["first", 1.5], ["second", item]]', {
    empty: "new Map()",
    numbers: 'new Map([["first", 1], ["second", 2]])',
    items: 'new Map([["first", item], ["second", item]])',
  }),
  Set: made("Set", "[1.5, item]", { empty: "new Set()", numbers: "new Set([1, 2])", items: "new Set([item])" }),
  WeakMap: made("WeakMap", "[[key, item]]", { setup: ["const key = { name: 1 };"], empty: "new WeakMap()" }),
  WeakSet: made("WeakSet", "[key]", { setup: ["const key = { name: 1 };"], empty: "new WeakSet()" }),
  WeakRef: made("WeakRef", "key", { setup: ["const key = { name: 1 };"] }),
  Promise: made("Promise", "resolve => resolve(item)"),
  RegExp: made("RegExp", '"(a)(?<rest>n)?(?<none>x)?", "g"'),
  Date: made("Date", "86400000.5"),
  Error: made("Error", '"message"'),
  ArrayBuffer: made("ArrayBuffer", "8, { maxByteLength: 16 }", { empty: "new ArrayBuffer(0)" }),
  SharedArrayBuffer: made("SharedArrayBuffer", "8, { maxByteLength: 16 }", { empty: "new SharedArrayBuffer(0)" }),
  DataView: made("DataView", "new ArrayBuffer(16)"),
  TypedArray: typedArray("Uint8Array"),
  Int8Array: typedArray("Int8Array"),
  Uint8Array: typedArray("Uint8Array"),
  Uint8ClampedArray: typedArray("Uint8ClampedArray"),
  Int16Array: typedArray("Int16Array"),
  Uint16Array: typedArray("Uint16Array"),
  Int32Array: typedArray("Int32Array"),
  Uint32Array: typedArray("Uint32Array"),
  Float16Array: typedArray("Float16Array"),
  Float32Array: typedArray("Float32Array"),
  Float64Array: typedArray("Float64Array"),
  BigInt64Array: typedArray("BigInt64Array", true),
  BigUint64Array: typedArray("BigUint64Array", true),
  Buffer: only('Buffer.from("banana and more text, 24")', { empty: "Buffer.alloc(0)" }),
  Object: only('{ first: 1.5, second: "two", third: item }', {
    empty: "{}",
    numbers: "{ first: 1, second: 2 }",
    items: "{ first: item, second: item }",
  }),
  String: only('"banana"', { empty: '""' }),
  Number: only("1.5"),
  Boolean: only("true"),
  BigInt: only("5n"),
  Symbol: only('Symbol.for("name")'),
  Function: only("function work(first, second) {\n  return second;\n}"),
  BoundFunction: only("function work(first, second) {\n  return second;\n}.bind(null, 1)"),
  Iterator: only('[1.5, item, "two"].values()', { empty: "[].values()", items: "[item, item].values()" }),
  ArrayIterator: only('[item, "two"].values()', { empty: "[].values()" }),
  MapIterator: only('new Map([["first", item]]).entries()', { empty: "new Map().entries()" }),
  SetIterator: only('new Set([item, "two"]).values()', { empty: "new Set().values()" }),
  StringIterator: only('"ab"[Symbol.iterator]()', { empty: '""[Symbol.iterator]()' }),
  RegExpStringIterator: only('"banana".matchAll(/(a)(n)?/g)', { empty: '"x".matchAll(/a/g)' }),
  IteratorHelper: only('[item, "two"].values().map(value => value)', { empty: "[].values().map(value => value)" }),
  Generator: only("numbers()", {
    setup: ["function* numbers() {", "  const sent = yield 1.5;", '  yield sent ?? "two";', "  return item;", "}"],
  }),
  AsyncGenerator: only("numbers()", {
    setup: [
      "async function* numbers() {",
      "  const sent = yield 1.5;",
      '  yield sent ?? "two";',
      "  return item;",
      "}",
    ],
  }),
  DisposableStack: made("DisposableStack", ""),
  AsyncDisposableStack: made("AsyncDisposableStack", ""),
  FinalizationRegistry: made("FinalizationRegistry", "() => {}"),
  URL: made("URL", '"https://user:secret@example.com:8080/a/b?first=1&second=two#part"'),
  URLSearchParams: made("URLSearchParams", '"first=1&second=two&first=3"', { empty: "new URLSearchParams()" }),
  Headers: made("Headers", '{ first: "1", second: "two" }', { empty: "new Headers()" }),
  Request: made("Request", '"https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } }'),
  Response: made("Response", '"[1.5]", { status: 201, headers: { first: "1" } }'),
  Blob: made("Blob", '["[1.5", ", 2]"], { type: "text/plain" }', { empty: "new Blob([])" }),
  EventEmitter: made("EventEmitter", "", { setup: ['import { EventEmitter } from "node:events";'] }),
  EventTarget: made("EventTarget", ""),
  Event: made("Event", '"ready"'),
  Performance: only("performance"),
  TextEncoder: made("TextEncoder", ""),
  TextDecoder: made("TextDecoder", ""),
  ReadableStream: made(
    "ReadableStream",
    '{\n  start(controller) {\n    controller.enqueue(new TextEncoder().encode("[1.5]"));\n    controller.close();\n  },\n}',
  ),
  HeadersIterator: only('new Headers({ first: "1" }).entries()'),
  URLSearchParamsIterator: only('new URLSearchParams("first=1").entries()'),
  CryptoHasher: made("Bun.CryptoHasher", '"sha256"'),
  MD4: made("Bun.MD4", ""),
  MD5: made("Bun.MD5", ""),
  SHA1: made("Bun.SHA1", ""),
  SHA224: made("Bun.SHA224", ""),
  SHA256: made("Bun.SHA256", ""),
  SHA384: made("Bun.SHA384", ""),
  SHA512: made("Bun.SHA512", ""),
  SHA512_256: made("Bun.SHA512_256", ""),
  Glob: made("Bun.Glob", '"*.js"'),
  Crypto: only("crypto"),
  IntlCollator: made("Intl.Collator", '"en"'),
  IntlDateTimeFormat: made("Intl.DateTimeFormat", '"en", { timeZone: "UTC" }'),
  IntlNumberFormat: made("Intl.NumberFormat", '"en"'),
  IntlPluralRules: made("Intl.PluralRules", '"en"'),
  IntlListFormat: made("Intl.ListFormat", '"en"'),
  IntlRelativeTimeFormat: made("Intl.RelativeTimeFormat", '"en"'),
  IntlSegmenter: made("Intl.Segmenter", '"en"'),
  IntlDisplayNames: made("Intl.DisplayNames", '"en", { type: "region" }'),
  IntlLocale: made("Intl.Locale", '"en-US"'),
  IntlDurationFormat: made("Intl.DurationFormat", '"en"'),
  IntlSegmentIterator: only('new Intl.Segmenter("en").segment("ab")[Symbol.iterator]()'),
  Timeout: only("setTimeout(() => {}, 0)"),
  Immediate: only("setImmediate(() => {})"),
};

export const holderClasses: Record<string, string> = {
  "%TypedArray%": "TypedArray",
  "%Generator%": "Generator",
  "%AsyncGenerator%": "AsyncGenerator",
  "%ArrayIterator%": "ArrayIterator",
  "%MapIterator%": "MapIterator",
  "%SetIterator%": "SetIterator",
  "%StringIterator%": "StringIterator",
  "%RegExpStringIterator%": "RegExpStringIterator",
  "%IteratorHelper%": "IteratorHelper",
  "%IntlSegmentIterator%": "IntlSegmentIterator",
  "%HeadersIterator%": "HeadersIterator",
  "%URLSearchParamsIterator%": "URLSearchParamsIterator",
  "%Timeout%": "Timeout",
  "%Immediate%": "Immediate",
  "%AsyncIterator%": "AsyncGenerator",
  "Intl.Collator": "IntlCollator",
  "Intl.DateTimeFormat": "IntlDateTimeFormat",
  "Intl.NumberFormat": "IntlNumberFormat",
  "Intl.PluralRules": "IntlPluralRules",
  "Intl.ListFormat": "IntlListFormat",
  "Intl.RelativeTimeFormat": "IntlRelativeTimeFormat",
  "Intl.Segmenter": "IntlSegmenter",
  "Intl.DisplayNames": "IntlDisplayNames",
  "Intl.Locale": "IntlLocale",
  "Intl.DurationFormat": "IntlDurationFormat",
  "Bun.CryptoHasher": "CryptoHasher",
  "Bun.MD4": "MD4",
  "Bun.MD5": "MD5",
  "Bun.SHA1": "SHA1",
  "Bun.SHA224": "SHA224",
  "Bun.SHA256": "SHA256",
  "Bun.SHA384": "SHA384",
  "Bun.SHA512": "SHA512",
  "Bun.SHA512_256": "SHA512_256",
  "Bun.Glob": "Glob",
};

export const staticHolders: Record<string, string> = {
  "%TypedArray%": "Uint8Array",
};

export interface Candidate {
  text: string;
  class?: string;
  isFunction?: boolean;
}

export type Flavor = "mixed" | "numbers" | "empty" | "items";

const integerConversions = ["ToIntegerOrInfinity", "ToLength", "ToIndex", "ToInt32", "ToUint32"];
const texts = ['"an"', '"-"', '"x"'];

export interface Position {
  index: number;
  conversion: string;
  followsFunction: boolean;
}

export function candidatesOf(
  type: TableType,
  flavor: Flavor,
  position: Position = { index: 0, conversion: "None", followsFunction: false },
): Candidate[] {
  const candidates: Candidate[] = [];
  const { index } = position;
  for (const part of type.parts) {
    if (part.part !== "Instance" || part.class === undefined) continue;
    const sample = classSamples[part.class];
    if (sample === undefined) continue;
    const text =
      (flavor === "empty" && sample.empty) ||
      (flavor === "numbers" && sample.numbers) ||
      (flavor === "items" && sample.items) ||
      sample.make(sample.base);
    candidates.push({ text, class: part.class });
  }
  if (type.hasAnyFunction) candidates.push({ text: "callback", isFunction: true });
  if (type.stringLiterals.length > 0) candidates.push({ text: JSON.stringify(type.stringLiterals[0]) });
  if (type.integers !== null) {
    const { minimum, maximum } = type.integers;
    for (const value of [index + 1, 2, 0, 16, 10]) {
      if (value >= minimum && value <= maximum) candidates.push({ text: String(value) });
    }
    if (candidates.length === 0) candidates.push({ text: String(minimum) });
  }
  for (const primitive of type.primitives) {
    if (primitive === "Number" && type.integers === null) {
      if (integerConversions.includes(position.conversion))
        candidates.push({ text: String(index + 1) }, { text: "2" }, { text: "0" }, { text: "16" });
      else candidates.push({ text: `${index + 1}.5` }, { text: String(index + 1) }, { text: "0" }, { text: "16" });
    }
    if (primitive === "String")
      candidates.push({ text: texts[index] ?? '"an"' }, { text: '"utf8"' }, { text: '"en"' }, { text: '"1"' });
    if (primitive === "Boolean") candidates.push({ text: "true" });
    if (primitive === "BigInt") candidates.push({ text: "5n" });
    if (primitive === "Symbol") candidates.push({ text: 'Symbol.for("name")' });
    if (primitive === "Null") candidates.push({ text: "null" });
  }
  if (type.isAnything) {
    const kinds: Candidate[] = [
      { text: flavor === "numbers" ? '"text"' : `${index + 1}.5` },
      { text: flavor === "numbers" ? "1.5" : (texts[index] ?? '"an"') },
      { text: '{ first: 1.5, second: "two", third: item }' },
      { text: '[1.5, item, "two"]', class: "Array" },
      { text: '[["first", 1.5], ["second", item]]', class: "Array" },
      { text: "callback", isFunction: true },
    ];
    if (flavor === "items") candidates.push({ text: "item" });
    if (position.followsFunction) candidates.push(kinds[2], kinds[0], kinds[1], ...kinds.slice(3));
    else candidates.push(...kinds);
  }
  if (type.hasAnyObject || type.hasPlainData) {
    candidates.push(
      { text: '{ first: 1.5, second: "two", third: item }' },
      { text: '[1.5, item, "two"]', class: "Array" },
      { text: '[["first", 1.5], ["second", item]]', class: "Array" },
    );
  }
  if (type.primitives.includes("Undefined")) candidates.push({ text: "undefined" });
  return candidates;
}

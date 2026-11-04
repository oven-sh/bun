// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// The type that a parsed value goes to is also found behind a generic function: at the type arguments and the destinations of its calls. The calls that run here yield `unknown`, so the values are looked at by code that knows nothing of the type.
import { describe, parseEveryText } from "./texts";
const namedInCode = ["function", "id", "name", "ok", "note", "a", "b", "c", "d", "e", "first", "second", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "sku", "quantity", "items", "tags", "owner", "age", "value", "next", "label", "children", "kind", "radius", "side", "color", "level", "mode", "zero", "flag", "nothing", "anything", "unknown", "object", "when", "table", "run", "big", "constructor", "toString", "list", "left", "right", "sites", "text", "incoming"];
console.log(namedInCode.length);

interface Flat {
  id: number;
  name: string;
  ok: boolean;
  note: string | null;
}
interface WithOptional {
  a: number;
  b?: string;
  c: number;
  d?: boolean;
  e?: number[];
}
interface OptionalFirst {
  first?: number;
  second: string;
}
interface ManyOptional {
  p?: number;
  q: number;
  r?: number;
  s: number;
  t?: number;
  u: number;
  v?: number;
  w: number;
  x?: number;
  y: number;
}
interface Item {
  sku: string;
  quantity: number;
}
interface Order {
  id: number;
  items: Item[];
  tags: string[];
  owner: { name: string; age: number };
}
interface Chain {
  value: number;
  next: Chain | null;
}
interface Tree {
  label: string;
  children: Tree[];
}
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "dot" };
enum Color {
  Red,
  Green,
  Blue,
}
enum Level {
  Low = "low",
  High = "high",
}
interface WithLiterals {
  color: Color;
  level: Level;
  mode: "on" | "off";
  zero: 0;
  flag: true;
  nothing: null;
}
interface WithLooseMembers {
  anything: any;
  unknown: unknown;
  object: object;
}
interface WithIndex {
  id: number;
  [key: string]: number;
}
interface Unsatisfiable {
  id: number;
  when: Date;
}
interface OptionallyUnsatisfiable {
  id: number;
  when?: Date;
  table?: Map<string, number>;
  run?: () => void;
  big?: bigint;
}
interface NamedLikeObjectMembers {
  constructor: number;
  toString: string;
}
interface ReadonlyMembers {
  readonly id: number;
  readonly list: readonly number[];
}
type Pair = [number, string];
type Prefixed = `id-${number}`;
interface WithTemplate {
  id: Prefixed;
}
type Both = { left: number } & { right: string };

const neverTrue = Date.now() < 0;
const sites: [string, (text: string) => unknown][] = [];

function readFlat<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readFlat<Flat>("null"));
sites.push(["Flat", text => readFlat<unknown>(text)]);

function readWithOptional<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readWithOptional<WithOptional>("null"));
sites.push(["WithOptional", text => readWithOptional<unknown>(text)]);

function readOptionalFirst<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readOptionalFirst<OptionalFirst>("null"));
sites.push(["OptionalFirst", text => readOptionalFirst<unknown>(text)]);

function readManyOptional<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readManyOptional<ManyOptional>("null"));
sites.push(["ManyOptional", text => readManyOptional<unknown>(text)]);

function readOrder<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readOrder<Order>("null"));
sites.push(["Order", text => readOrder<unknown>(text)]);

function readChain<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readChain<Chain>("null"));
sites.push(["Chain", text => readChain<unknown>(text)]);

function readTree<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readTree<Tree>("null"));
sites.push(["Tree", text => readTree<unknown>(text)]);

function readShape<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readShape<Shape>("null"));
sites.push(["Shape", text => readShape<unknown>(text)]);

function readWithLiterals<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readWithLiterals<WithLiterals>("null"));
sites.push(["WithLiterals", text => readWithLiterals<unknown>(text)]);

function readWithLooseMembers<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readWithLooseMembers<WithLooseMembers>("null"));
sites.push(["WithLooseMembers", text => readWithLooseMembers<unknown>(text)]);

function readWithIndex<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readWithIndex<WithIndex>("null"));
sites.push(["WithIndex", text => readWithIndex<unknown>(text)]);

function readOptionallyUnsatisfiable<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readOptionallyUnsatisfiable<OptionallyUnsatisfiable>("null"));
sites.push(["OptionallyUnsatisfiable", text => readOptionallyUnsatisfiable<unknown>(text)]);

function readReadonlyMembers<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readReadonlyMembers<ReadonlyMembers>("null"));
sites.push(["ReadonlyMembers", text => readReadonlyMembers<unknown>(text)]);

function readWithTemplate<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readWithTemplate<WithTemplate>("null"));
sites.push(["WithTemplate", text => readWithTemplate<unknown>(text)]);

function readBoth<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readBoth<Both>("null"));
sites.push(["Both", text => readBoth<unknown>(text)]);

function readPair<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readPair<Pair>("null"));
sites.push(["Pair", text => readPair<unknown>(text)]);

function readFlatList<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readFlatList<Flat[]>("null"));
sites.push(["Flat[]", text => readFlatList<unknown>(text)]);

function readFlatLists<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readFlatLists<Flat[][]>("null"));
sites.push(["Flat[][]", text => readFlatLists<unknown>(text)]);

function readOrderList<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readOrderList<Order[]>("null"));
sites.push(["Order[]", text => readOrderList<unknown>(text)]);

function readShapeList<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readShapeList<Shape[]>("null"));
sites.push(["Shape[]", text => readShapeList<unknown>(text)]);

function readFlatOrNull<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readFlatOrNull<Flat | null>("null"));
sites.push(["Flat | null", text => readFlatOrNull<unknown>(text)]);

function readNumbers<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readNumbers<number[]>("null"));
sites.push(["number[]", text => readNumbers<unknown>(text)]);

function readStrings<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readStrings<string[]>("null"));
sites.push(["string[]", text => readStrings<unknown>(text)]);

function readMixed<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readMixed<(number | string | null)[]>("null"));
sites.push(["(number | string | null)[]", text => readMixed<unknown>(text)]);

function readFlatTable<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readFlatTable<Record<string, Flat>>("null"));
sites.push(["Record<string, Flat>", text => readFlatTable<unknown>(text)]);

function readNumberTable<T>(text: string): T {
  return JSON.parse(text);
}
if (neverTrue) console.log(readNumberTable<Record<string, number>>("null"));
sites.push(["Record<string, number>", text => readNumberTable<unknown>(text)]);

class Incoming {
  #text: string;
  constructor(text: string) {
    this.#text = text;
  }
  json<T = any>(): Promise<T> {
    return Promise.resolve(this.#text).then((text: string) => JSON.parse(text));
  }
}
async function castBehindAwait(incoming: Incoming): Promise<number> {
  const order = (await incoming.json()) as Order;
  return order.items.length;
}
if (neverTrue) console.log(await castBehindAwait(new Incoming("null")));

parseEveryText(sites);

for (const text of ['{"id":7,"items":[{"sku":"a","quantity":1}],"tags":["t"],"owner":{"name":"o","age":30}}', '{"items":[],"id":7,"tags":[],"owner":{"age":1,"name":"o"},"more":true}', "[1]", "{"]) {
  try {
    const value: unknown = await new Incoming(text).json();
    console.log(describe(value, 0), JSON.stringify(value));
  } catch (error) {
    console.log("threw", (error as Error).name + ":", (error as Error).message);
  }
}

// FILE: texts.ts
export function describe(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : "n" + String(value);
  if (typeof value === "string") {
    let out = "s";
    for (let i = 0; i < value.length && i < 40; i++) out += value.charCodeAt(i).toString(36) + ".";
    return out + value.length;
  }
  if (typeof value !== "object") return typeof value + ":" + String(value);
  if (depth > 12) return "deep";
  if (Array.isArray(value)) {
    let out = Object.getPrototypeOf(value) === Array.prototype ? "[" : "[!prototype ";
    for (let i = 0; i < value.length && i < 50; i++) out += describe(value[i], depth + 1) + ",";
    return out + "]" + value.length + (Object.keys(value).length === value.length ? "" : "!keys");
  }
  let out = Object.getPrototypeOf(value) === Object.prototype ? "{" : "{!prototype ";
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    out += String(key) + (descriptor.writable && descriptor.enumerable && descriptor.configurable ? ":" : "!attributes:") + describe(descriptor.value, depth + 1) + ",";
  }
  let listed = "";
  for (const key in value as object) listed += key + ",";
  return out + "}" + (listed === Object.keys(value as object).join(",") + (listed === "" ? "" : ",") ? "" : "!for-in " + listed);
}

type Member = [string, string];
function join(members: Member[], open: string, colon: string, comma: string, close: string): string {
  return open + members.map(member => member[0] + colon + member[1]).join(comma) + close;
}
function compact(members: Member[]): string {
  return join(members, "{", ":", ",", "}");
}

const bases: Member[][] = [
  [
    ['"id"', "1"],
    ['"name"', '"n"'],
    ['"ok"', "true"],
    ['"note"', "null"],
  ],
  [
    ['"a"', "1"],
    ['"b"', '"x"'],
    ['"c"', "2.5"],
    ['"d"', "false"],
    ['"e"', "[1,2]"],
  ],
  [
    ['"first"', "1"],
    ['"second"', '"s"'],
  ],
  [
    ['"p"', "1"],
    ['"q"', "2"],
    ['"r"', "3"],
    ['"s"', "4"],
    ['"t"', "5"],
    ['"u"', "6"],
    ['"v"', "7"],
    ['"w"', "8"],
    ['"x"', "9"],
    ['"y"', "10"],
  ],
  [
    ['"id"', "7"],
    ['"items"', '[{"sku":"a","quantity":1},{"sku":"b","quantity":2}]'],
    ['"tags"', '["t","u"]'],
    ['"owner"', '{"name":"o","age":30}'],
  ],
  [
    ['"value"', "1"],
    ['"next"', '{"value":2,"next":{"value":3,"next":null}}'],
  ],
  [
    ['"label"', '"root"'],
    ['"children"', '[{"label":"a","children":[]},{"label":"b","children":[{"label":"c","children":[]}]}]'],
  ],
  [
    ['"kind"', '"circle"'],
    ['"radius"', "2"],
  ],
  [
    ['"kind"', '"square"'],
    ['"side"', "3"],
  ],
  [['"kind"', '"dot"']],
  [
    ['"color"', "1"],
    ['"level"', '"high"'],
    ['"mode"', '"off"'],
    ['"zero"', "0"],
    ['"flag"', "true"],
    ['"nothing"', "null"],
  ],
  [
    ['"anything"', '{"z":1,"a":[2,{"b":3}]}'],
    ['"unknown"', "[null]"],
    ['"object"', "{}"],
  ],
  [
    ['"id"', "1"],
    ['"more"', "2"],
    ['"0"', "3"],
  ],
  [
    ['"id"', "1"],
    ['"when"', '"2020-01-01T00:00:00.000Z"'],
  ],
  [
    ['"constructor"', "1"],
    ['"toString"', '"s"'],
  ],
  [
    ['"id"', "1"],
    ['"list"', "[1,2,3]"],
  ],
  [
    ['"x"', "1"],
    ['"y"', "2"],
  ],
  [['"id"', '"id-5"']],
  [
    ['"left"', "1"],
    ['"right"', '"r"'],
  ],
];

const otherValues = [
  "null",
  "true",
  "false",
  "0",
  "-0",
  "-0.0",
  "0e0",
  "1",
  "-1",
  "1.5",
  "1.0",
  "1e2",
  "1E+2",
  "100e-2",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967296",
  "9007199254740991",
  "9007199254740992",
  "9007199254740993",
  "123456789012345678901234567890",
  "0.1",
  "0.30000000000000004",
  "5e-324",
  "2e-324",
  "1.7976931348623157e308",
  "1e309",
  "-1e309",
  "1e-400",
  '""',
  '"s"',
  '"1"',
  '"null"',
  '"\\n\\t\\"\\\\\\/\\b\\f\\r"',
  '"\\u0000"',
  '"\\u0041"',
  '"\\ud800"',
  '"\\udc00x"',
  '"\\ud83d\\ude00"',
  '"é"',
  '"中文"',
  '"😀"',
  '"  "',
  '"\u007f"',
  '"circle"',
  '"on"',
  '"low"',
  '"id-"',
  '"id-1e3"',
  "[]",
  "[1]",
  "[[]]",
  '["a"]',
  "[null]",
  "[{}]",
  "{}",
  '{"a":1}',
  '{"id":1}',
  '{"length":0}',
  '{"__proto__":null}',
  '{"__proto__":{"polluted":true}}',
];

const malformedValues = [
  "",
  " ",
  "01",
  "-",
  "+1",
  ".5",
  "1.",
  "1e",
  "1e+",
  "0x10",
  "1_000",
  "NaN",
  "Infinity",
  "-Infinity",
  "undefined",
  "nul",
  "nulll",
  "True",
  "tru",
  "'s'",
  '"',
  '"\\"',
  '"\\x41"',
  '"\\u12"',
  '"\\u12g4"',
  '"\n"',
  '"\t"',
  '"\u0000"',
  '"\u001f"',
  "[",
  "]",
  "[1,]",
  "[,1]",
  "[1 2]",
  "[1,,2]",
  "{",
  "}",
  '{"a"}',
  '{"a":}',
  '{"a":1,}',
  '{,"a":1}',
  "{a:1}",
  "{'a':1}",
  '{"a":1 "b":2}',
  '{"a"::1}',
  "/**/1",
  "1//",
  "1n",
];

const extraKeys = ['"extra"', '"__proto__"', '"constructor"', '"toString"', '"hasOwnProperty"', '"0"', '"1"', '"-1"', '"1e3"', '"4294967295"', '"4294967294"', '""', '" "', '"a b"', '"\\u0065xtra"', '"é"', '"中"', '"length"', '"then"'];

function escapeFirstCharacter(key: string): string {
  return '"\\u' + key.charCodeAt(1).toString(16).padStart(4, "0") + key.slice(2);
}

export const texts: string[] = [];
for (const base of bases) {
  texts.push(compact(base));
  texts.push(join(base, "{ ", ": ", ", ", " }"));
  texts.push(join(base, "{", ": ", ",", "}"));
  texts.push(join(base, "{", " :", " ,", "}"));
  texts.push(join(base, "{\n  ", ": ", ",\n  ", "\n}"));
  texts.push(join(base, "{\r\n\t", ":\t", ",\r\n\t", "\r\n}"));
  texts.push(" \t\r\n" + compact(base) + " \t\r\n");
  texts.push(join(base, "{\f", ":", ",", "}"));
  texts.push(join(base, "{", ":\v", ",", "}"));
  texts.push(join(base, "{", ":", ", ", "}"));
  texts.push("﻿" + compact(base));
  texts.push(compact(base) + "﻿");
  texts.push(compact(base) + "x");
  texts.push(compact(base) + compact(base));
  texts.push(compact(base) + ",");
  texts.push(compact(base) + "\u0000");
  texts.push("[" + compact(base) + "]");
  texts.push("[" + compact(base) + "," + compact(base) + "]");
  texts.push("[ " + compact(base) + " , " + compact(base) + " ]");
  texts.push("[[" + compact(base) + "],[]]");
  texts.push("[" + compact(base) + ",null]");
  texts.push("[" + compact(base) + ",1]");
  texts.push('{"k":' + compact(base) + ',"__proto__":' + compact(base) + ',"0":' + compact(base) + "}");
  texts.push(compact([...base].reverse()));
  texts.push(join([...base].reverse(), "{ ", " : ", " , ", " }"));
  for (let at = 0; at < base.length; at++) {
    const without = base.filter((_, index) => index !== at);
    texts.push(compact(without));
    texts.push(join(without, "{ ", ": ", ", ", " }"));
    texts.push(compact([...without, base[at]!]));
    texts.push(compact([base[at]!, ...without]));
    texts.push(compact([...base, base[at]!]));
    texts.push(compact([...base.slice(0, at + 1), base[at]!, ...base.slice(at + 1)]));
    texts.push(compact([...base, [base[at]![0], '"other"']]));
    texts.push(compact([[base[at]![0], "[0]"], ...base]));
    texts.push(compact(base.map((member, index): Member => (index === at ? [escapeFirstCharacter(member[0]), member[1]] : member))));
    for (const value of otherValues) texts.push(compact(base.map((member, index): Member => (index === at ? [member[0], value] : member))));
    for (const value of malformedValues) texts.push(compact(base.map((member, index): Member => (index === at ? [member[0], value] : member))));
    for (const key of extraKeys) texts.push(compact([...base.slice(0, at), [key, "1"], ...base.slice(at)]));
  }
  for (const key of extraKeys) {
    texts.push(compact([...base, [key, "1"]]));
    texts.push(compact([...base, [key, '{"a":[1]}']]));
    texts.push(join([...base, [key, "null"]], "{ ", ": ", ", ", " }"));
  }
  const whole = compact(base);
  for (let length = 0; length < whole.length; length++) texts.push(whole.slice(0, length));
}
for (const value of otherValues) texts.push(value, " " + value + " ", "[" + value + "]", "[" + value + "," + value + "]", "[1," + value + "]", '[1,"a",' + value + "]");
for (const value of malformedValues) texts.push(value, "[" + value + "]", "[1," + value + "]");

let nested = "null";
for (let depth = 0; depth < 3000; depth++) nested = '{"value":' + depth + ',"next":' + nested + "}";
texts.push(nested);
let branches = '{"label":"leaf","children":[]}';
for (let depth = 0; depth < 3000; depth++) branches = '{"label":"' + depth + '","children":[' + branches + "]}";
texts.push(branches);
texts.push("[".repeat(3000) + "]".repeat(3000));
texts.push("[".repeat(3000));
const many: string[] = [];
for (let index = 0; index < 5000; index++) many.push('{"id":' + index + ',"name":"n' + (index % 17) + '","ok":' + (index % 2 === 0) + ',"note":' + (index % 3 === 0 ? "null" : '"x"') + "}");
texts.push("[" + many.join(",") + "]");
texts.push("[" + many.join(",") + ',{"id":"last"}]');
texts.push('"' + "a".repeat(100000) + '"');
texts.push('{"id":1,"name":"' + "中".repeat(5000) + '","ok":true,"note":"' + "b".repeat(70000) + '"}');

function mix(hash: number, text: string): number {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}

const isVerbose = false;
export function parseEveryText(sites: [string, (text: string) => unknown][]) {
  for (const [name, parse] of sites) {
    let hash = 0;
    let thrown = 0;
    for (let at = 0; at < texts.length; at++) {
      let line: string;
      try {
        const value = parse(texts[at]!);
        line = describe(value, 0) + " " + mix(0, JSON.stringify(value) ?? "undefined");
      } catch (error) {
        thrown++;
        line = "threw " + (error as Error).name + ": " + (error as Error).message;
      }
      if (isVerbose) console.log(name, at, line.slice(0, 300));
      hash = mix(hash, line);
    }
    console.log(name, texts.length, "texts,", thrown, "thrown,", hash);
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: readFlat castBehindAwait Incoming json
// CHECK-LABEL: function {{*}}name="readFlat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_2]] site=[[w_3]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="castBehindAwait"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="json"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="json" calleeName="incoming.json"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Promise<undefined|null|[[L_6]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Await v4, v1
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v7 = PropGet v6 key="items"
// CHECK-NEXT: v8 = PropGet v7 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Convert v9 declared={type=number|object site=[[w_9]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Incoming"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_11]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: PrivateSet v4, v7, v6 layout=[[L_4]] field=1
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="json"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_14]]} results=[{type=undefined|null|Promise<undefined|null|[[L_15]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Promise" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="resolve"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v7 = PrivateGet v0, v6 layout=[[L_4]] field=1
// CHECK-NEXT: v8 = Call v5, v3, v7 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = PropGet v9 key="then"
// CHECK-NEXT: v11 = NewClosure function=[[f_16]]
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeKey="then" calleeName="then"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Promise<undefined|null|[[L_15]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }

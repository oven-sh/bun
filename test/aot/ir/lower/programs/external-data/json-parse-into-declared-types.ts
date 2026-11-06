// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// JSON.parse(text) whose result goes to a declared type is parsed by code compiled for that type where the text is compact and has the declared keys in the declared order, and by JSON.parse itself otherwise. Whatever the text is, an object or array that comes out is what JSON.parse makes of it. A primitive for an object or an array type throws a TypeError at the cast, annotation, parameter or result. A cast refuses no object, so an object passes `as Flat[]` and an object that is no text passes `as string`. `x!` tests nothing.
import { describe, parseEveryText } from "./texts";
const namedInCode = ["id", "name", "ok", "note", "a", "b", "c", "d", "e", "first", "second", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "sku", "quantity", "items", "tags", "owner", "age", "value", "next", "label", "children", "kind", "radius", "side", "color", "level", "mode", "zero", "flag", "nothing", "anything", "unknown", "object", "when", "table", "run", "big", "constructor", "toString", "list", "left", "right", "sites", "text", "held", "notTexts", "get", "enumerable", "configurable", "extra01", "extra02", "extra03", "extra04", "extra05", "extra06", "extra07", "extra08", "extra09", "extra10", "extra11", "extra12", "extra13", "extra14", "extra15", "extra16"];
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
interface ManyMore {
  extra01?: number;
  extra02?: number;
  extra03?: number;
  extra04?: number;
  extra05?: number;
  extra06?: number;
  extra07?: number;
  extra08?: number;
  extra09?: number;
  extra10?: number;
  extra11?: number;
  extra12?: number;
  extra13?: number;
  extra14?: number;
  extra15?: number;
  extra16?: number;
}
interface LargeFlat extends Flat, ManyMore {}
interface LargeOrder extends Order, ManyMore {}
interface LargeTree extends ManyMore {
  label: string;
  children: LargeTree[];
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
type Prefixed = `id-${number}`;
interface WithTemplate {
  id: Prefixed;
}
type Both = { left: number } & { right: string };

const sites: [string, (text: string) => unknown][] = [
  ["cast to Flat", text => JSON.parse(text) as Flat],
  [
    "annotated Flat",
    text => {
      const value: Flat = JSON.parse(text);
      return value;
    },
  ],
  ["returned Flat", (text): Flat => JSON.parse(text)],
  ["argument Flat", text => takeFlat(JSON.parse(text))],
  ["property Flat", text => holdFlat(text).held],
  [
    "assigned Flat",
    text => {
      let value: Flat = { id: 0, name: "", ok: false, note: null };
      value = JSON.parse(text);
      return value;
    },
  ],
  ["element Flat", text => listOfFlat(text)[0]],
  ["non-null Flat", text => JSON.parse(text)! as Flat],
  ["through unknown Flat", text => JSON.parse(text) as unknown as Flat],
  ["Flat or undefined", text => JSON.parse(text) as Flat | undefined],
  ["Flat or null", text => JSON.parse(text) as Flat | null],
  ["Flat[]", text => JSON.parse(text) as Flat[]],
  ["Flat[][]", text => JSON.parse(text) as Flat[][]],
  ["WithOptional", text => JSON.parse(text) as WithOptional],
  ["OptionalFirst", text => JSON.parse(text) as OptionalFirst],
  ["ManyOptional", text => JSON.parse(text) as ManyOptional],
  ["Order", text => JSON.parse(text) as Order],
  ["Order[]", text => JSON.parse(text) as Order[]],
  ["Chain", text => JSON.parse(text) as Chain],
  ["Tree", text => JSON.parse(text) as Tree],
  ["Shape", text => JSON.parse(text) as Shape],
  ["Shape[]", text => JSON.parse(text) as Shape[]],
  ["WithLiterals", text => JSON.parse(text) as WithLiterals],
  ["WithLooseMembers", text => JSON.parse(text) as WithLooseMembers],
  ["WithIndex", text => JSON.parse(text) as WithIndex],
  ["Record of number", text => JSON.parse(text) as Record<string, number>],
  ["Record of Flat", text => JSON.parse(text) as Record<string, Flat>],
  ["Unsatisfiable", text => JSON.parse(text) as Unsatisfiable],
  ["OptionallyUnsatisfiable", text => JSON.parse(text) as OptionallyUnsatisfiable],
  ["NamedLikeObjectMembers", text => JSON.parse(text) as NamedLikeObjectMembers],
  ["ReadonlyMembers", text => JSON.parse(text) as ReadonlyMembers],
  ["WithTemplate", text => JSON.parse(text) as WithTemplate],
  ["Both", text => JSON.parse(text) as Both],
  ["LargeFlat", text => JSON.parse(text) as LargeFlat],
  ["LargeFlat[]", text => JSON.parse(text) as LargeFlat[]],
  ["LargeOrder", text => JSON.parse(text) as LargeOrder],
  ["LargeTree", text => JSON.parse(text) as LargeTree],
  ["LargeFlat or LargeOrder", text => JSON.parse(text) as LargeFlat | LargeOrder],
  ["Record of LargeFlat", text => JSON.parse(text) as Record<string, LargeFlat>],
  ["generic", text => parseAs<Flat>(text)],
  ["with a reviver", text => JSON.parse(text, (_key, value) => (typeof value === "number" ? value + 1 : value)) as Flat],
  ["with undefined as the reviver", text => JSON.parse(text, undefined) as Flat],
];

function takeFlat(value: Flat): Flat {
  return value;
}
function holdFlat(text: string): { held: Flat } {
  return { held: JSON.parse(text) };
}
function listOfFlat(text: string): Flat[] {
  return [JSON.parse(text)];
}
function parseAs<T>(text: string): T {
  return JSON.parse(text);
}

parseEveryText(sites);

let conversions = 0;
const counted = {
  toString() {
    conversions++;
    return '{"id":1,"name":"n","ok":true,"note":null}';
  },
};
const notTexts: unknown[] = [
  1,
  -0,
  null,
  undefined,
  true,
  counted,
  new String('{"id":2,"name":"m","ok":false,"note":"x"}'),
  new Uint8Array([0x7b, 0x7d]),
  new Uint8Array([49]),
  [1],
  ['{"id":3,"name":"l","ok":true,"note":null}'],
  {},
  10n,
  Symbol("text"),
  () => 1,
];
for (const given of notTexts) {
  try {
    console.log("not a text:", describe(JSON.parse(given as string) as Flat, 0), conversions);
  } catch (error) {
    console.log("not a text: threw", error instanceof TypeError ? "TypeError" : (error as Error).name + ": " + (error as Error).message, conversions);
  }
}

const first = JSON.parse('{"id":1,"name":"n","ok":true,"note":null}') as Flat;
const second = JSON.parse('{"id":1,"name":"n","ok":true,"note":null}') as Flat;
console.log(first !== second, first.id + second.id, first.name + second.name, first.ok && second.ok, first.note ?? "none");
(first as any).added = 1;
delete (first as any).name;
first.id = 5;
Object.defineProperty(first, "ok", { get: () => "computed", enumerable: false, configurable: true });
console.log(describe(first, 0), JSON.stringify(first), (first as any).ok);
Object.freeze(second);
try {
  second.id = 9;
} catch (error) {
  console.log((error as Error).name);
}
console.log(describe(second, 0), Object.isFrozen(second));
const spread = { ...(JSON.parse('{"a":1,"b":"x","c":2}') as WithOptional), c: 3 };
console.log(describe(spread, 0), Object.entries(spread).join("|"));
const { a, ...rest } = JSON.parse('{"a":1,"c":2,"d":true}') as WithOptional;
console.log(a, describe(rest, 0));

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
        line = "threw " + (error instanceof TypeError ? "TypeError" : (error as Error).name + ": " + (error as Error).message);
      }
      if (isVerbose) console.log(name, at, line.slice(0, 300));
      hash = mix(hash, line);
    }
    console.log(name, texts.length, "texts,", thrown, "thrown,", hash);
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: holdFlat listOfFlat parseAs toString get
// CHECK-LABEL: function {{*}}name="holdFlat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = NewObject -, v5 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="listOfFlat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|[[L_4]]> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: v5 = NewArray v4 contents=undefined|null|[[L_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|[[L_4]]> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parseAs"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_8]] site=[[w_9]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_8]] site=[[w_9]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="conversions"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="conversions"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_12]]
// CHECK-NEXT: v7 = String string="{\"id\":1,\"name\":\"n\",\"ok\":true,\"note\":null}"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="computed"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }

// JSON.parse(text) whose result goes to a declared type is parsed by code compiled for that type where the text is compact and has the declared keys in the declared order, and by JSON.parse itself otherwise. Whatever the text is, an object or array that comes out is what JSON.parse makes of it. A primitive for an object or an array type throws a TypeError at the cast, annotation, parameter or result. A cast refuses no object, so an object passes `as Flat[]` and an object that is no text passes `as string`. `x!` tests nothing.
// IR+ ^ .* = JSONSourceOpen v
// IR+ JSONStartsWith v\d+ text="\\x22id\\x22:"
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

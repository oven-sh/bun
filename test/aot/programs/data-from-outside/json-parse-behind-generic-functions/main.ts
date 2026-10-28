// The type that a parsed value goes to is also found behind a generic function: at the type arguments and the destinations of its calls. The calls that run here yield `unknown`, so the values are looked at by code that knows nothing of the type.
// IR+ ^ .* = JSONSourceOpen v
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

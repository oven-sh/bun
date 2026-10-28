// A fuzzer of texts, the same for a given seed, that is after the tables which the parser, the writer and the conversions learn: keys that are long, that share their first bytes, that come again, thousands of names, tens of thousands of orders, and now and then thousands of records with names of their own inside one text. Each text is parsed by `JSON.parse(text) as T`, written by JSON.stringify and compared with JSON.parse; values are kept and written again later.

const seed: number = 1;
const rounds: number = 20;

type Point = { x: number; y: number };
type User = { id: number; name: string; email?: string; tags: string[]; active: boolean; note: string | null };
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number; label?: string } | { kind: "path"; points: Point[] };
type Mixed = string | number | boolean | null | { v: number } | number[];
type Triple = [string, number, Point];
type Table = Record<string, number>;
type Points = Record<string, Point>;
type Grid = number[][];
type Tree = { name: string; kids: Tree[] };
type Chain = { value: number; next: Chain | null };
type Loose = { id: number; data: unknown; more: any; bag: Record<string, any> };
type Indexed = { id: number; [key: string]: number | string };
type Literals = { level: "low" | "high" | "é"; code: 1 | 2 | 3; on: true; nothing: null; either: "a" | 7 | false };
type Wide = {
  a0: number; a1: string; a2: boolean; a3?: number; a4: string | null; a5: number[]; a6: Point; a7?: string; a8: number; a9: string;
  b0: number; b1: string; b2: boolean; b3?: number; b4: string | null; b5: number[]; b6: Point; b7?: string; b8: number; b9: string;
  c0: number; c1: string; c2: boolean; c3?: number; c4: string | null; c5: number[]; c6: Point; c7?: string; c8: number; c9: string;
  d0: number; d1: string; d2: boolean; d3?: number; d4: string | null;
};
type Nested = { a: { b: { c: { d: Point[]; e: [number, string] }; f?: Shape }; g: Table }; h: User[] };
type Item = { id: number };
type Holder = { first: number; items: Item[]; last: string };
type Shelf = { label: string; holders: Holder[]; byName: Record<string, Item>; pair: [Item, Point] };

let state = seed >>> 0;
function random(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (limit: number): number => Math.floor(random() * limit);
const chance = (probability: number): boolean => random() < probability;
const choice = <T>(from: readonly T[]): T => from[below(from.length)];

type Make = (depth: number) => string;
const characters = ["a", "b", "z", "A", "0", "9", " ", "-", "_", ".", "/", "é", "ÿ", "Ā", "日", "😀", "\\n", "\\t", '\\"', "\\\\", "\\/", "\\u0041", "\\u00e9", "\\u65e5", "\\ud83d\\ude00", "\\ud800", "\\u0000", "\u007f", " "];
const plainCharacters = ["a", "b", "c", "x", "y", "z", "k"];
function stringOf(length: number, from: readonly string[]): string {
  let text = '"';
  for (let at = 0; at < length; at++) text += choice(from);
  return text + '"';
}
const text: Make = () => (chance(0.6) ? stringOf(below(6), plainCharacters) : chance(0.8) ? stringOf(below(12), characters) : stringOf(20 + below(120), chance(0.5) ? plainCharacters : characters));
const integers = ["0", "1", "2", "3", "7", "10", "42", "255", "999", "1000", "65536", "2147483647", "2147483648", "4294967296", "9007199254740991", "-1", "-7", "-2147483648", "-2147483649"];
const fractions = ["0.5", "-0.5", "1.25", "3.14159", "1e3", "1E3", "1e+3", "1e-3", "-1.5e10", "1.7976931348623157e308", "5e-324", "0.1", "123456789.123456789", "1e21", "12345678901234567890", "-0", "0.0", "1.0", "100e-2"];
const integer: Make = () => (chance(0.7) ? choice(integers) : String(below(100000) - 50000));
const number: Make = depth => (chance(0.6) ? integer(depth) : chance(0.8) ? choice(fractions) : (below(2000000) - 1000000) / 1000 + (chance(0.3) ? "e" + (below(40) - 20) : ""));
const flag: Make = () => (chance(0.5) ? "true" : "false");
const nothing: Make = () => "null";
const constant = (...spellings: string[]): Make => () => choice(spellings);
const either = (...makes: Make[]): Make => depth => choice(makes)(depth);
const list = (item: Make, low = 0, high = 4): Make => depth => {
  const items: string[] = [];
  for (let count = depth > 5 ? low : low + below(high - low + 1); count > 0; count--) items.push(item(depth + 1));
  return "[" + items.join(",") + "]";
};
const tuple = (...items: Make[]): Make => depth => "[" + items.map(item => item(depth + 1)).join(",") + "]";
const keys = ['"k"', '"key"', '"x"', '"y"', '"id"', '"name"', '"kind"', '""', '"0"', '"1"', '"42"', '"-1"', '"a b"', '"é"', '"日本"', '"__proto__"', '"constructor"', '"toString"', '"length"', '"\\u006b"', '"k\\n"', '"a key that is longer than the short ones by far, so that no cache takes it"'];
let names = 0;
function otherKey(declared: readonly string[]): string {
  for (;;) {
    let name = "";
    switch (below(12)) {
      case 0:
        return choice(keys.filter(key => !declared.includes(globalThis.JSON.parse(key))));
      case 1:
        name = "u" + below(50);
        break;
      case 2:
        name = "k".repeat(54 + below(20));
        break;
      case 3:
        name = "k".repeat(54 + below(20)) + below(10);
        break;
      case 4:
        name = "k".repeat(chance(0.02) ? 100000 : chance(0.3) ? 1000 + below(100) : 200 + below(10));
        break;
      case 5:
        name = "prefix00" + "abc".repeat(below(22)).slice(0, below(62));
        break;
      case 6:
        name = "prefix00" + below(300);
        break;
      case 7:
        name = "n" + below(5000);
        break;
      case 8:
      case 9:
        name = "q" + ++names;
        break;
      case 10:
        name = "kkkkkkkk".slice(0, 1 + below(8));
        break;
      default:
        name = "same";
    }
    if (!declared.includes(name)) return '"' + name + '"';
  }
}
const anything: Make = depth => {
  const kind = below(depth > 3 ? 5 : 8);
  if (kind < 5) return [text, number, flag, nothing, integer][kind](depth);
  if (kind === 5) return list(anything)(depth);
  return dictionary(anything)(depth);
};
const dictionary = (held: Make, high = 4): Make => depth => {
  const members: string[] = [];
  for (let count = depth > 5 ? 0 : below(high + 1); count > 0; count--) members.push((chance(0.5) ? otherKey([]) : stringOf(1 + below(5), plainCharacters)) + ":" + held(depth + 1));
  return "{" + members.join(",") + "}";
};
function shuffle<T>(items: T[]): T[] {
  for (let at = items.length - 1; at > 0; at--) {
    const other = below(at + 1);
    const held = items[at];
    items[at] = items[other];
    items[other] = held;
  }
  return items;
}
const record = (members: [string, Make, boolean?][], extra: Make | null = anything): Make => depth => {
  let written: string[] = [];
  for (const [name, make, isOptional] of members) if (!isOptional || chance(0.6)) written.push('"' + name + '":' + make(depth + 1));
  const declared = members.map(member => member[0]);
  if (extra && chance(0.6)) for (let count = 1 + below(chance(0.1) ? 70 : 4); count > 0; count--) written.splice(below(written.length + 1), 0, otherKey(declared) + ":" + (chance(0.5) ? integer(depth) : extra(depth + 1)));
  if (chance(0.5)) written = shuffle(written);
  if (chance(0.05) && written.length) written.splice(below(written.length + 1), 0, choice(written));
  return "{" + written.join(",") + "}";
};

const point = record([["x", number], ["y", number]]);
const user = record([["id", integer], ["name", text], ["email", text, true], ["tags", list(text)], ["active", flag], ["note", either(text, nothing)]]);
const shape = either(record([["kind", constant('"circle"')], ["radius", number]]), record([["kind", constant('"square"')], ["side", number], ["label", text, true]]), record([["kind", constant('"path"')], ["points", list(point)]]));
const tree: Make = depth => record([["name", text], ["kids", list(tree, 0, depth > 3 ? 0 : 3)]])(depth);
const chain: Make = depth => record([["value", number], ["next", depth > 8 || chance(0.3) ? nothing : chain]])(depth);
const wideMembers: [string, Make, boolean?][] = [];
for (const row of ["a", "b", "c", "d"]) {
  const makes: [Make, boolean?][] = [[number], [text], [flag], [number, true], [either(text, nothing)], [list(number)], [point], [text, true], [number], [text]];
  makes.slice(0, row === "d" ? 5 : 10).forEach(([make, isOptional], at) => wideMembers.push([row + at, make, isOptional]));
}

const item = record([["id", integer]]);
const crowd: Make = depth => {
  const items: string[] = [];
  const isLarge = chance(0.03);
  for (let count = isLarge ? 3000 + below(40000) : below(6); count > 0; count--) items.push(isLarge || chance(0.5) ? (count % 2 ? '{"id":' + count + ',"q' + ++names + '":' + count + "}" : '{"q' + ++names + '":"v","id":' + count + ',"same":1}') : item(depth + 1));
  return "[" + items.join(",") + "]";
};
const holder = record([["first", number], ["items", crowd], ["last", text]]);
const shelf = record([["label", text], ["holders", list(holder, 0, 3)], ["byName", dictionary(item)], ["pair", tuple(item, point)]]);

const types: [string, (text: string) => unknown, Make][] = [
  ["Point", text => JSON.parse(text) as Point, point],
  ["User", text => JSON.parse(text) as User, user],
  ["Shape", text => JSON.parse(text) as Shape, shape],
  ["Shape[]", text => JSON.parse(text) as Shape[], list(shape, 0, 6)],
  ["Mixed", text => JSON.parse(text) as Mixed, either(text, number, flag, nothing, record([["v", number]]), list(number))],
  ["Mixed[]", text => JSON.parse(text) as Mixed[], list(either(text, number, flag, nothing, record([["v", number]]), list(number)), 0, 8)],
  ["Triple", text => JSON.parse(text) as Triple, tuple(text, number, point)],
  ["Table", text => JSON.parse(text) as Table, dictionary(number, 8)],
  ["Points", text => JSON.parse(text) as Points, dictionary(point)],
  ["Grid", text => JSON.parse(text) as Grid, list(list(number))],
  ["Tree", text => JSON.parse(text) as Tree, tree],
  ["Chain", text => JSON.parse(text) as Chain, chain],
  ["Loose", text => JSON.parse(text) as Loose, record([["id", number], ["data", anything], ["more", anything], ["bag", dictionary(anything)]])],
  ["Indexed", text => JSON.parse(text) as Indexed, record([["id", number]], either(number, text))],
  ["Literals", text => JSON.parse(text) as Literals, record([["level", constant('"low"', '"high"', '"é"', '"\\u00e9"', '"lo\\u0077"')], ["code", constant("1", "2", "3", "1.0", "2e0", "30e-1")], ["on", constant("true")], ["nothing", nothing], ["either", constant('"a"', "7", "false", "7.0")]])],
  ["Wide", text => JSON.parse(text) as Wide, record(wideMembers)],
  ["Nested", text => JSON.parse(text) as Nested, record([["a", record([["b", record([["c", record([["d", list(point)], ["e", tuple(number, text)]])], ["f", shape, true]])], ["g", dictionary(number)]])], ["h", list(user, 0, 3)]])],
  ["Item", text => JSON.parse(text) as Item, item],
  ["Holder", text => JSON.parse(text) as Holder, holder],
  ["Holder[]", text => JSON.parse(text) as Holder[], list(holder, 0, 3)],
  ["Shelf", text => JSON.parse(text) as Shelf, shelf],
];

function tokens(text: string): string[] {
  const found: string[] = [];
  for (let at = 0; at < text.length; ) {
    let end = at + 1;
    const first = text[at];
    if (first === '"') {
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      end++;
    } else if (/[-0-9a-zA-Z.+]/.test(first)) while (end < text.length && /[-0-9a-zA-Z.+]/.test(text[end])) end++;
    found.push(text.slice(at, end));
    at = end;
  }
  return found;
}

const intruders = ["\u0000", '"', "\\", "{", "}", "[", "]", ",", ":", " ", "\n", "\t", "\r", "0", "1", "9", "-", "+", ".", "e", "E", "n", "t", "f", "u", "a", "/", "'", "\u001f", "\u007f", " ", "ÿ", "Ā", " ", "﻿", "\ud800", "\udc00", "null", "true", "false", "nul", "tru", "1e400", "-0", "{}", "[]", '""', '"\\u0000"', "\\u", "\\u00", "\\ud800"];
const spaces = [" ", "\n", "\t", "\r", "  ", " \n\t\r "];

function mutate(text: string): string {
  switch (below(16)) {
    case 0: {
      const at = below(text.length + 1);
      return text.slice(0, at) + choice(intruders) + text.slice(at + 1);
    }
    case 1: {
      const at = below(text.length + 1);
      return text.slice(0, at) + choice(intruders) + text.slice(at);
    }
    case 2:
      return text.slice(0, below(text.length + 1));
    case 3:
      return text.slice(below(text.length + 1));
    case 4: {
      const at = below(text.length + 1);
      return text.slice(0, at) + text.slice(at + 1 + below(4));
    }
    case 5: {
      const found = tokens(text);
      found.splice(below(found.length), 1 + below(3));
      return found.join("");
    }
    case 6: {
      const found = tokens(text);
      const at = below(found.length);
      found.splice(at, 0, ...found.slice(at, at + 1 + below(4)));
      return found.join("");
    }
    case 7: {
      const found = tokens(text);
      const one = below(found.length);
      const other = below(found.length);
      const held = found[one];
      found[one] = found[other];
      found[other] = held;
      return found.join("");
    }
    case 8:
      return tokens(text).map(token => (chance(0.3) ? choice(spaces) + token : token)).join("") + (chance(0.3) ? choice(spaces) : "");
    case 9:
      return tokens(text).map(token => (token.length > 2 && token[0] === '"' && token[1] !== "\\" && token.charCodeAt(1) < 0xd800 && chance(0.4) ? '"\\u' + token.charCodeAt(1).toString(16).padStart(4, "0") + token.slice(2) : token)).join("");
    case 10: {
      const found = tokens(text);
      const at = below(found.length);
      const levels = chance(0.1) ? 200 + below(3000) : 1 + below(70);
      found[at] = chance(0.5) ? "[".repeat(levels) + found[at] + "]".repeat(levels) : '{"n":'.repeat(levels) + found[at] + "}".repeat(levels);
      return found.join("");
    }
    case 11: {
      const found = tokens(text);
      const at = below(found.length);
      found[at] = choice([text, "null", "0", '""', "[]", "{}", "true", "-0", "1e999", '"' + "x".repeat(below(300)) + '"', "9".repeat(1 + below(40)), "[" + text + "," + text + "]"]);
      return found.join("");
    }
    case 12: {
      const found = tokens(text);
      for (let at = 0; at < found.length; at++) if (/^-?[0-9]/.test(found[at]) && chance(0.5)) found[at] = choice([found[at] + ".0", found[at] + "e0", "-" + found[at], "0" + found[at], found[at] + ".", found[at] + "e", "+" + found[at], found[at] + "0".repeat(below(30)), found[at] + "." + "0".repeat(below(30)) + "1"]);
      return found.join("");
    }
    case 13:
      return choice(["﻿", " ", "\u0000", "//c\n", "[", "{", ""]) + text + choice(["\u0000", " ", "\n", ",", "]", "}", "x", "﻿", text, ""]);
    case 14: {
      const start = below(text.length);
      const piece = text.slice(start, start + 1 + below(20));
      const at = below(text.length + 1);
      return text.slice(0, at) + piece + text.slice(at);
    }
    default:
      return mutate(mutate(text));
  }
}

function represent(text: string): string {
  switch (below(8)) {
    case 0:
      return (text + "Ā").slice(0, -1);
    case 1: {
      const at = below(text.length + 1);
      return text.slice(0, at) + text.slice(at);
    }
    case 2: {
      let rope = "";
      for (let at = 0; at < text.length; at += 7) rope += text.slice(at, at + 7);
      return rope;
    }
    case 3:
      return ("padding " + text + " padding").slice(8, -8);
    default:
      return text;
  }
}

const plainParse: (text: string) => any = globalThis.JSON.parse;

function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (typeof value === "string") return JSON.stringify(value) + value.length;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
}

function deepest(text: string): number {
  let depth = 0;
  let most = 0;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (code === 91 || code === 123) most = Math.max(most, ++depth);
    else if (code === 93 || code === 125) depth--;
  }
  return most;
}

let reported = 0;
function report(what: string, type: string, text: string, typed: string, plain: string): void {
  if (reported++ < 20) console.log(what + " " + type + " seed " + seed + " on " + JSON.stringify(text).slice(0, 600) + "\n  typed: " + typed.slice(0, 400) + "\n  plain: " + plain.slice(0, 400));
}

const kept: { label: string; value: unknown; written: string }[] = [];
let lost = 0;
function keep(label: string, value: unknown, written: string): void {
  const at = below(64);
  const before = kept[at];
  if (before && JSON.stringify(before.value) !== before.written) {
    lost++;
    report("KEPT AND WRITTEN DIFFERENTLY LATER", before.label, before.written, String(JSON.stringify(before.value)), before.written);
  }
  kept[at] = { label, value, written };
}

for (let pass = 0; pass < 2; pass++)
for (const [label, parse, make] of types) {
  let accepted = 0;
  let syntaxErrors = 0;
  let different = 0;
  let texts = 0;
  for (let round = 0; round < rounds; round++) {
    const valid = make(0);
    for (let turn = 0; turn < 6; turn++) {
      const text = represent(turn === 0 ? valid : mutate(valid));
      if (deepest(text) > 1500) continue;
      texts++;
      let typed = "";
      let plain = "";
      let typedValue: unknown;
      let plainValue: unknown;
      try {
        typedValue = parse(text);
        typed = show(typedValue);
      } catch (error: any) {
        typed = error.name + ": " + error.message;
      }
      try {
        plainValue = plainParse(text);
        plain = show(plainValue);
      } catch (error: any) {
        plain = error.name + ": " + error.message;
      }
      if (typed !== plain) {
        different++;
        report("DIFFERENT", label, text, typed, plain);
      } else if (plain.startsWith("SyntaxError")) syntaxErrors++;
      else {
        accepted++;
        const written = String(JSON.stringify(plainValue));
        if (JSON.stringify(typedValue) !== written) {
          different++;
          report("WRITTEN DIFFERENTLY", label, text, String(JSON.stringify(typedValue)), written);
        }
        if (JSON.stringify({ held: typedValue, list: [typedValue] }) !== '{"held":' + written + ',"list":[' + written + "]}") {
          different++;
          report("WRITTEN DIFFERENTLY UNDER A HOLDER", label, text, "", written);
        }
        keep(label, typedValue, written);
      }
    }
  }
  console.log(label + ", pass " + pass + ": " + texts + " texts: " + accepted + " accepted, " + syntaxErrors + " no JSON: " + different + " differ");
}
console.log("kept and written again: " + lost + " differ");

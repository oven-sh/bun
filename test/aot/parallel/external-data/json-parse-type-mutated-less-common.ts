// Fuzzes `JSON.parse(text) as T` with a fixed seed over less common kinds of type: enums, intersections, generics, mapped and utility types, template literals, number keys, interfaces that extend others. Each text is generated to match its type and then mutated. `JSON.parse(text) as T` must throw the same SyntaxError as JSON.parse or return the same value. Texts that contain -0 are left out for the types with enums: json-parse-type-argument-minus-zero-under-an-enum has them.

const seed: number = 1;
const rounds: number = 300;

type Point = { x: number; y: number };
type User = { id: number; name: string; email?: string; tags: string[]; active: boolean; note: string | null };
enum Color { Red, Green, Blue }
enum Level { Low = "low", High = "high" }
type Painted = { color: Color; level: Level; both: Color | Level };
type ByEnum = { kind: Color.Red; r: number } | { kind: Color.Green; g: string } | { kind: Color.Blue; b: boolean };
type Joined = { a: number } & { b: string } & { c?: boolean };
type Box<T> = { value: T; next?: Box<T> };
type Part = Partial<User>;
type Picked = Pick<User, "id" | "name">;
type Omitted = Omit<User, "tags" | "note">;
type Whole = Required<{ a?: number; b?: string }>;
type Fixed = Readonly<{ a: number; list: readonly string[] }>;
type Finite = Record<"a" | "b" | "c", number>;
type IndexKeys = { [key: string]: string };
type Templated = { id: `id-${number}`; path: `/${string}` };
type Undefinable = { a: number | undefined; b?: string | null; c: null | boolean };
type Lists = number[] | string[];
type Within = { v: (number | { w: string | number[] })[] };
type Mapped = { [K in "k1" | "k2" | "k3"]: { [L in "x" | "y"]: number } };
type Empty = {};
type AnyObject = { o: object; p: {} };
type Extended = Point & { z: number; label?: string };
interface Base { id: number }
interface Derived extends Base { name: string; parent?: Derived }

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
const anything: Make = depth => {
  const kind = below(depth > 3 ? 5 : 8);
  if (kind < 5) return [text, number, flag, nothing, integer][kind](depth);
  if (kind === 5) return list(anything)(depth);
  return dictionary(anything)(depth);
};
const dictionary = (held: Make, high = 4): Make => depth => {
  const members: string[] = [];
  for (let count = depth > 5 ? 0 : below(high + 1); count > 0; count--) members.push((chance(0.7) ? choice(keys) : stringOf(1 + below(5), plainCharacters)) + ":" + held(depth + 1));
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
  const others = keys.filter(key => !members.some(member => member[0] === globalThis.JSON.parse(key)));
  if (extra && chance(0.3)) for (let count = 1 + below(chance(0.1) ? 40 : 3); count > 0; count--) written.splice(below(written.length + 1), 0, (chance(0.5) ? choice(others) : '"u' + below(50) + '"') + ":" + extra(depth + 1));
  if (chance(0.25)) written = shuffle(written);
  if (chance(0.05) && written.length) written.splice(below(written.length + 1), 0, choice(written));
  return "{" + written.join(",") + "}";
};

const point = record([["x", number], ["y", number]]);
const user = record([["id", integer], ["name", text], ["email", text, true], ["tags", list(text)], ["active", flag], ["note", either(text, nothing)]]);
const color = constant("0", "1", "2", "1.0", "2e0");
const level = constant('"low"', '"high"', '"lo\\u0077"');
const box = (value: Make): Make => {
  const made: Make = depth => record(depth > 5 ? [["value", value]] : [["value", value], ["next", made, true]])(depth);
  return made;
};
const derived: Make = depth => record([["id", number], ["name", text], ...(depth > 5 ? [] : ([["parent", derived, true]] as [string, Make, boolean?][]))])(depth);
const indexKeys: Make = depth => "{" + Array.from({ length: below(5) }, (_, at) => '"' + (at * 7 + below(5)) + '":' + text(depth)).join(",") + "}";

const types: [string, (text: string) => unknown, Make][] = [
  ["Painted", text => JSON.parse(text) as Painted, record([["color", color], ["level", level], ["both", either(color, level)]])],
  ["ByEnum", text => JSON.parse(text) as ByEnum, either(record([["kind", constant("0", "0.0")], ["r", number]]), record([["kind", constant("1", "1e0")], ["g", text]]), record([["kind", constant("2")], ["b", flag]]))],
  ["ByEnum[]", text => JSON.parse(text) as ByEnum[], list(either(record([["kind", constant("0")], ["r", number]]), record([["kind", constant("1")], ["g", text]]), record([["kind", constant("2")], ["b", flag]])), 0, 6)],
  ["Joined", text => JSON.parse(text) as Joined, record([["a", number], ["b", text], ["c", flag, true]])],
  ["Box<Point>", text => JSON.parse(text) as Box<Point>, box(point)],
  ["Box<string[]>", text => JSON.parse(text) as Box<string[]>, box(list(text))],
  ["Part", text => JSON.parse(text) as Part, record([["id", integer, true], ["name", text, true], ["email", text, true], ["tags", list(text), true], ["active", flag, true], ["note", either(text, nothing), true]])],
  ["Picked", text => JSON.parse(text) as Picked, record([["id", integer], ["name", text]])],
  ["Omitted", text => JSON.parse(text) as Omitted, record([["id", integer], ["name", text], ["email", text, true], ["active", flag]])],
  ["Whole", text => JSON.parse(text) as Whole, record([["a", number], ["b", text]])],
  ["Fixed", text => JSON.parse(text) as Fixed, record([["a", number], ["list", list(text)]])],
  ["Finite", text => JSON.parse(text) as Finite, record([["a", number], ["b", number], ["c", number]])],
  ["IndexKeys", text => JSON.parse(text) as IndexKeys, indexKeys],
  ["Templated", text => JSON.parse(text) as Templated, record([["id", () => '"id-' + below(1000) + '"'], ["path", () => '"/' + "abc".slice(below(3)) + '"']])],
  ["Undefinable", text => JSON.parse(text) as Undefinable, record([["a", number], ["b", either(text, nothing), true], ["c", either(nothing, flag)]])],
  ["Lists", text => JSON.parse(text) as Lists, either(list(number), list(text))],
  ["Within", text => JSON.parse(text) as Within, record([["v", list(either(number, record([["w", either(text, list(number))]])))]])],
  ["Mapped", text => JSON.parse(text) as Mapped, record([["k1", point], ["k2", point], ["k3", point]])],
  ["Empty", text => JSON.parse(text) as Empty, record([])],
  ["AnyObject", text => JSON.parse(text) as AnyObject, record([["o", either(dictionary(anything), list(anything))], ["p", dictionary(anything)]])],
  ["Extended", text => JSON.parse(text) as Extended, record([["x", number], ["y", number], ["z", number], ["label", text, true]])],
  ["Derived", text => JSON.parse(text) as Derived, derived],
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

const holdsEnums = new Set(["Painted", "ByEnum", "ByEnum[]"]);
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
      if (holdsEnums.has(label) && text.includes("-0")) continue;
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
        if (JSON.stringify(typedValue) !== JSON.stringify(plainValue)) {
          different++;
          report("STRINGIFIED DIFFERENTLY", label, text, String(JSON.stringify(typedValue)), String(JSON.stringify(plainValue)));
        }
      }
    }
  }
  console.log(label + ": " + texts + " texts: " + accepted + " accepted, " + syntaxErrors + " invalid JSON: " + different + " differ");
}

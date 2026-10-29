// The half of texts-for-generated-types.ts that runs inside the generated program. It is handed one case per generated type: a
// description of the type, the calls that parse under it, and a function that reads every member through the type beside a twin that
// reads the same members through `any`. It makes texts from the description, spells them in many ways, changes them, and asks of each:
//
//   is it JSON           a parser written here, one character at a time, says so; every call must agree (SyntaxError or not)
//   what comes back      the same value as JSON.parse(text), whether it is a T or not: kinds, order of keys, -0, the last of two equal keys, "__proto__" as a key
//   what typed code sees the reader through the type and the reader through `any` over JSON.parse(text) print the same
//
// A disagreement is one line that starts with "DIFFERS" and holds the type, the text and both answers as JSON.

export type Description =
  | { kind: "number" }
  | { kind: "int32" }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "null" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "anything" }
  | { kind: "object or array" }
  | { kind: "array"; of: Description }
  | { kind: "tuple"; of: Description[] }
  | { kind: "record"; of: Description }
  | { kind: "object"; members: Member[]; rest?: Description }
  | { kind: "union"; of: Description[] }
  | { kind: "named"; index: number };
export type Member = { name: string; optional: boolean; type: Description };

/** Nothing is checked in any of these: what is no T arrives as what JSON.parse gives, and typed code reads what is there. */
export interface Case {
  name: string;
  type: string;
  description: Description;
  /** Parses under the type and reads some members, or none; the value goes nowhere else. A case with this has none of the others. */
  inPart?: (text: string) => string;
  /** Each parses under the type in another way: name and call. */
  parsers?: [string, (text: string) => unknown][];
  readCast?: (text: string) => string;
  readBody?: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  readRequest?: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  readUntyped: (value: any) => string;
  /** What a server does with a request: reads its body as JSON under the type. */
  serve?: (request: Request) => Promise<string>;
  /** Parses under the type, hands the value to `change`, and reads every member through the type. */
  readChanged?: (text: string, change: (value: unknown) => void) => string;
  /** Parses under the type with one of `revivers`: its name and the call. */
  revived?: [keyof typeof revivers, (text: string) => unknown][];
  /** Parses under the type behind an await. */
  parseLater?: (text: string) => Promise<unknown>;
}

class Stopped extends Error {}
let calls = 0;

/** Revivers that change what the text said. */
export const revivers = {
  "numbers and a half": (_: string, held: unknown) => (typeof held === "number" ? held + 0.5 : held),
  "nothing for null": (_: string, held: unknown) => (held === null ? undefined : held),
  "lengths for texts": (_: string, held: unknown) => (typeof held === "string" ? held.length : held),
  "lists in objects": (_: string, held: unknown) => (Array.isArray(held) ? { list: held } : held),
  "stops at the fifth call": (_: string, held: unknown) => {
    if (++calls === 5) throw new Stopped("at the fifth call");
    return held;
  },
  "a boolean removes its neighbors": function (this: any, name: string, held: unknown) {
    if (typeof held === "boolean") for (const other in this) if (other !== name) delete this[other];
    return held;
  },
};

// ---- random numbers

let state = 1;
function next(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
const below = (limit: number): number => next() % limit;
const chance = (probability: number): boolean => next() < probability * 4294967296;
const pick = <T>(from: readonly T[]): T => from[below(from.length)];

// ---- what the slow parser finds

class Found {
  names: string[] = [];
  values: Tree[] = [];
}
type Tree = null | boolean | number | string | Tree[] | Found;

const isIndex = (name: string): boolean => {
  if (name.length === 0 || name.length > 10) return false;
  if (name === "0") return true;
  const first = name.charCodeAt(0);
  if (first < 49 || first > 57) return false;
  for (let at = 1; at < name.length; at++) {
    const unit = name.charCodeAt(at);
    if (unit < 48 || unit > 57) return false;
  }
  return Number(name) < 4294967295;
};

/** The names in the order in which an object lists them: indexes first, ascending, then the others as they were first written. */
function close(table: Map<string, Tree>): Found {
  const found = new Found();
  const indexes: string[] = [];
  for (const name of table.keys()) if (isIndex(name)) indexes.push(name);
  indexes.sort((a, b) => Number(a) - Number(b));
  for (const name of indexes) {
    found.names.push(name);
    found.values.push(table.get(name)!);
  }
  for (const [name, value] of table) {
    if (isIndex(name)) continue;
    found.names.push(name);
    found.values.push(value);
  }
  return found;
}

const noJSON = Symbol("no JSON");
let deepest = 0;

/** JSON as ECMA-404 has it. No recursion: an open array or object is an entry of `open`. */
function slowParse(text: string): Tree | typeof noJSON {
  let at = 0;
  const end = text.length;
  const open: (Tree[] | Map<string, Tree>)[] = [];
  const names: string[] = [];
  deepest = 0;
  const skip = (): void => {
    while (at < end) {
      const unit = text.charCodeAt(at);
      if (unit !== 32 && unit !== 9 && unit !== 10 && unit !== 13) break;
      at++;
    }
  };
  const string = (): string | typeof noJSON => {
    at++;
    let value = "";
    for (;;) {
      if (at >= end) return noJSON;
      const unit = text.charCodeAt(at++);
      if (unit === 34) return value;
      if (unit < 32) return noJSON;
      if (unit !== 92) {
        value += String.fromCharCode(unit);
        continue;
      }
      if (at >= end) return noJSON;
      const escape = text.charCodeAt(at++);
      if (escape === 34) value += '"';
      else if (escape === 92) value += "\\";
      else if (escape === 47) value += "/";
      else if (escape === 98) value += "\b";
      else if (escape === 102) value += "\f";
      else if (escape === 110) value += "\n";
      else if (escape === 114) value += "\r";
      else if (escape === 116) value += "\t";
      else if (escape === 117) {
        if (at + 4 > end) return noJSON;
        let code = 0;
        for (let digit = 0; digit < 4; digit++) {
          const hex = text.charCodeAt(at++);
          if (hex >= 48 && hex <= 57) code = code * 16 + hex - 48;
          else if (hex >= 65 && hex <= 70) code = code * 16 + hex - 55;
          else if (hex >= 97 && hex <= 102) code = code * 16 + hex - 87;
          else return noJSON;
        }
        value += String.fromCharCode(code);
      } else return noJSON;
    }
  };
  const digits = (): boolean => {
    const from = at;
    while (at < end && text.charCodeAt(at) >= 48 && text.charCodeAt(at) <= 57) at++;
    return at > from;
  };
  const number = (): number | typeof noJSON => {
    const from = at;
    if (text.charCodeAt(at) === 45) at++;
    if (at < end && text.charCodeAt(at) === 48) at++;
    else if (!digits()) return noJSON;
    if (at < end && text.charCodeAt(at) === 46) {
      at++;
      if (!digits()) return noJSON;
    }
    if (at < end && (text.charCodeAt(at) === 101 || text.charCodeAt(at) === 69)) {
      at++;
      if (at < end && (text.charCodeAt(at) === 43 || text.charCodeAt(at) === 45)) at++;
      if (!digits()) return noJSON;
    }
    return Number(text.slice(from, at));
  };
  for (;;) {
    // A value starts here.
    skip();
    if (at >= end) return noJSON;
    let value: Tree;
    const unit = text.charCodeAt(at);
    if (unit === 91 || unit === 123) {
      at++;
      skip();
      if (at < end && text.charCodeAt(at) === (unit === 91 ? 93 : 125)) {
        at++;
        value = unit === 91 ? [] : new Found();
        if (open.length + 1 > deepest) deepest = open.length + 1;
      } else {
        open.push(unit === 91 ? [] : new Map());
        if (open.length > deepest) deepest = open.length;
        if (unit === 123) {
          if (at >= end || text.charCodeAt(at) !== 34) return noJSON;
          const name = string();
          if (name === noJSON) return noJSON;
          names.push(name);
          skip();
          if (at >= end || text.charCodeAt(at) !== 58) return noJSON;
          at++;
        }
        continue;
      }
    } else if (unit === 34) {
      const held = string();
      if (held === noJSON) return noJSON;
      value = held;
    } else if (unit === 45 || (unit >= 48 && unit <= 57)) {
      const held = number();
      if (held === noJSON) return noJSON;
      value = held;
    } else if (text.startsWith("true", at)) {
      at += 4;
      value = true;
    } else if (text.startsWith("false", at)) {
      at += 5;
      value = false;
    } else if (text.startsWith("null", at)) {
      at += 4;
      value = null;
    } else return noJSON;
    // A value has ended: it goes into what is open, and what that closes goes on.
    for (;;) {
      skip();
      if (open.length === 0) return at === end ? value : noJSON;
      const holder = open[open.length - 1];
      if (at >= end) return noJSON;
      const mark = text.charCodeAt(at++);
      if (Array.isArray(holder)) {
        holder.push(value);
        if (mark === 44) break;
        if (mark !== 93) return noJSON;
        open.pop();
        value = holder;
      } else {
        holder.set(names.pop()!, value);
        if (mark === 44) {
          skip();
          if (at >= end || text.charCodeAt(at) !== 34) return noJSON;
          const name = string();
          if (name === noJSON) return noJSON;
          names.push(name);
          skip();
          if (at >= end || text.charCodeAt(at) !== 58) return noJSON;
          at++;
          break;
        }
        if (mark !== 125) return noJSON;
        open.pop();
        value = close(holder);
      }
    }
  }
}

// ---- is it a T

let named: Description[] = [];

function valueOf(tree: Tree): unknown {
  if (Array.isArray(tree)) return tree.map(valueOf);
  if (!(tree instanceof Found)) return tree;
  const object = {};
  tree.names.forEach((name, at) =>
    Object.defineProperty(object, name, {
      value: valueOf(tree.values[at]),
      writable: true,
      enumerable: true,
      configurable: true,
    }),
  );
  return object;
}

function fits(description: Description, tree: Tree): boolean {
  switch (description.kind) {
    case "number":
      return typeof tree === "number" && tree - tree === 0;
    case "int32":
      return typeof tree === "number" && Math.floor(tree) === tree && tree >= -2147483648 && tree <= 2147483647;
    case "string":
      return typeof tree === "string";
    case "boolean":
      return typeof tree === "boolean";
    case "null":
      return tree === null;
    case "literal":
      return tree === description.value;
    case "anything":
      return true;
    case "object or array":
      return typeof tree === "object" && tree !== null;
    case "array":
      if (!Array.isArray(tree)) return false;
      for (const item of tree) if (!fits(description.of, item)) return false;
      return true;
    case "tuple":
      if (!Array.isArray(tree) || tree.length !== description.of.length) return false;
      for (let at = 0; at < tree.length; at++) if (!fits(description.of[at], tree[at])) return false;
      return true;
    case "record":
      if (!(tree instanceof Found)) return false;
      for (const value of tree.values) if (!fits(description.of, value)) return false;
      return true;
    case "object": {
      if (!(tree instanceof Found)) return false;
      for (const member of description.members) {
        const at = tree.names.indexOf(member.name);
        if (at < 0 ? !member.optional : !fits(member.type, tree.values[at])) return false;
      }
      if (description.rest) {
        for (let at = 0; at < tree.names.length; at++)
          if (
            !description.members.some(member => member.name === tree.names[at]) &&
            !fits(description.rest, tree.values[at])
          )
            return false;
      }
      return true;
    }
    case "union":
      for (const arm of description.of) if (fits(arm, tree)) return true;
      return false;
    case "named":
      return fits(named[description.index], tree);
  }
}

// ---- one spelling for what the slow parser found and for a value

const spellNumber = (value: number): string => (value === 0 && 1 / value < 0 ? "-0" : String(value));

function spellTree(tree: Tree): string {
  if (tree === null) return "null";
  if (typeof tree === "number") return spellNumber(tree);
  if (typeof tree === "string") return JSON.stringify(tree);
  if (typeof tree === "boolean") return tree ? "true" : "false";
  if (Array.isArray(tree)) {
    let text = "[";
    for (let at = 0; at < tree.length; at++) text += (at ? "," : "") + spellTree(tree[at]);
    return text + "]";
  }
  let text = "{";
  for (let at = 0; at < tree.names.length; at++)
    text += (at ? "," : "") + JSON.stringify(tree.names[at]) + ":" + spellTree(tree.values[at]);
  return text + "}";
}

export function spellValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return spellNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "object") return "<" + typeof value + ">";
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return "<an array below another prototype>";
    let text = "[";
    for (let at = 0; at < value.length; at++)
      text += (at ? "," : "") + (at in value ? spellValue(value[at]) : "<hole>");
    if (Reflect.ownKeys(value).length !== value.length + 1) text += "<more keys>";
    return text + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return "<an object below another prototype>";
  const names = Reflect.ownKeys(value);
  let text = "{";
  for (let at = 0; at < names.length; at++) {
    const name = names[at];
    if (typeof name !== "string") return "<a symbol key>";
    const property = Object.getOwnPropertyDescriptor(value, name)!;
    if (!property.writable || !property.enumerable || !property.configurable || !("value" in property))
      return "<a property that is no plain one>";
    text += (at ? "," : "") + JSON.stringify(name) + ":" + spellValue(property.value);
  }
  return text + "}";
}

/** The same in other ways: for-in, reads by key, Object.entries, a spread. */
function spellValueInOtherWays(value: unknown, way: number): string {
  if (typeof value !== "object" || value === null) return spellValue(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    if (way & 1) value.forEach(item => parts.push(spellValueInOtherWays(item, way)));
    else for (const item of value) parts.push(spellValueInOtherWays(item, way));
    return "[" + parts.join(",") + "]";
  }
  const parts: string[] = [];
  if (way === 0)
    for (const name in value) parts.push(JSON.stringify(name) + ":" + spellValueInOtherWays((value as any)[name], way));
  else if (way === 1)
    for (const [name, held] of Object.entries(value))
      parts.push(JSON.stringify(name) + ":" + spellValueInOtherWays(held, way));
  else if (way === 2) {
    const copy = { ...value } as any;
    for (const name of Object.keys(copy))
      parts.push(JSON.stringify(name) + ":" + spellValueInOtherWays(copy[name], way));
  } else
    for (const name of Object.getOwnPropertyNames(value))
      parts.push(JSON.stringify(name) + ":" + spellValueInOtherWays(Reflect.get(value, name), way));
  return "{" + parts.join(",") + "}";
}

// ---- texts

const wholeNumbers = [
  "0",
  "1",
  "2",
  "7",
  "10",
  "42",
  "255",
  "256",
  "65535",
  "65536",
  "1000000",
  "2147483646",
  "2147483647",
  "-1",
  "-2",
  "-128",
  "-2147483647",
  "-2147483648",
  "1.0",
  "1e0",
  "1E0",
  "0.1e1",
  "10e-1",
  "1e2",
  "100e-2",
  "2147483647.0",
  "2.147483647e9",
  "21474836470e-1",
  "-2147483648.0",
  "-2.147483648e9",
  "0.0",
  "0e0",
  "0e5",
  "0E-5",
  "3.0000",
  "1e9",
  "2e9",
];
const wideNumbers = [
  "2147483648",
  "-2147483649",
  "2147483648.0",
  "2.147483648e9",
  "4294967295",
  "4294967296",
  "-4294967296",
  "4294967297",
  "9007199254740991",
  "9007199254740992",
  "9007199254740993",
  "-9007199254740993",
  "12345678901234567890",
  "18446744073709551615",
  "18446744073709551616",
  "1e10",
  "3e9",
  "1e21",
  "1e22",
  "1e300",
  "1.7976931348623157e308",
  "123456789012345678901234567890",
];
const fractions = [
  "0.5",
  "-0.5",
  "1.5",
  "2147483647.5",
  "-2147483648.5",
  "2147483646.9999999",
  "0.1",
  "1e-1",
  "1e-7",
  "5e-324",
  "2.5e-324",
  "1e-400",
  "-1e-400",
  "4.9e-324",
  "3.141592653589793",
  "0.30000000000000004",
  "1.0000000000000002",
  "0.99999999999999999999",
  "1.00000000000000000001",
  "2147483647.00000000000000001",
  "1e-2",
  "15e-1",
];
const minusZeros = ["-0", "-0.0", "-0e0", "-0E+5", "-0.000e-3", "-0e-400", "-1e-400"];
const tooLarge = [
  "1e309",
  "-1e309",
  "1e400",
  "1E400",
  "1.7976931348623159e308",
  "1e99999",
  "-1e99999",
  "1e2147483648",
  "1e4294967297",
  "1e-4294967297",
  "1e18446744073709551617",
];
const noNumbers = [
  "00",
  "01",
  "-01",
  "+1",
  ".5",
  "1.",
  "-.5",
  "1.e1",
  "1e",
  "1e+",
  "1e-",
  "-",
  "--1",
  "0x10",
  "0b1",
  "0o7",
  "1_000",
  "NaN",
  "Infinity",
  "-Infinity",
  "1n",
  "1f",
  "1e1.5",
  "1..2",
  "0.0.0",
  "١",
  "１",
  "1 2",
  "- 1",
  "1e 5",
];
const long = (): string => {
  const length = pick([20, 40, 100, 400, 1100, 5000]);
  const run = pick(["0", "1", "9", "123456789"])
    .repeat(Math.ceil(length / 9) * 9)
    .slice(0, length);
  return pick([
    () => "1" + run,
    () => "0." + run,
    () => "1." + run,
    () => run.replace(/^0+/, "1") + "e-" + (length - 1),
    () => "0." + "0".repeat(length) + "1e" + (length + 1),
    () => "-" + "1" + run,
    () => "1" + "0".repeat(length) + "e-" + length,
    () => "1e" + "0".repeat(length) + "1",
    () => "1e-" + "0".repeat(length) + "1",
    () => "2147483647." + "0".repeat(length),
    () => "2147483647." + "0".repeat(length) + "1",
  ])();
};

const anyNumber = (): string => {
  const draw = below(100);
  if (draw < 35) return pick(wholeNumbers);
  if (draw < 50) return String(below(200001) - 100000);
  if (draw < 62) return pick(wideNumbers);
  if (draw < 76) return pick(fractions);
  if (draw < 84) return pick(minusZeros);
  if (draw < 90) return pick(tooLarge);
  if (draw < 95) return long();
  return pick(noNumbers);
};

const hex = (unit: number): string => {
  const text = unit.toString(16).padStart(4, "0");
  return "\\u" + (chance(0.5) ? text : text.toUpperCase());
};
const shortEscapes: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "/": "\\/",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/** A JSON string for these UTF-16 units. `escapes` is how many of the units that need no escape get one. */
function spellString(value: string, escapes: number): string {
  let text = '"';
  for (let at = 0; at < value.length; at++) {
    const unit = value.charCodeAt(at);
    const character = value[at];
    if (unit < 32 || unit === 34 || unit === 92)
      text += character in shortEscapes && chance(0.7) ? shortEscapes[character] : hex(unit);
    else if (escapes > 0 && chance(escapes)) text += character === "/" && chance(0.5) ? "\\/" : hex(unit);
    else text += character;
  }
  return text + '"';
}

const pieces = [
  "a",
  "b",
  "z",
  "A",
  "0",
  "9",
  " ",
  "-",
  "_",
  ".",
  "/",
  "\\",
  '"',
  "\n",
  "\t",
  "\0",
  "\x1f",
  "\x7f",
  "\x80",
  "é",
  "ÿ",
  "Ā",
  "日",
  "😀",
  "\ud800",
  "\udc00",
  "\udfff\ud800",
  " ",
  " ",
  "﻿",
  "￿",
  "{",
  "}",
  "[",
  "]",
  ":",
  ",",
  "null",
  "true",
  "__proto__",
];
function anyStringValue(): string {
  const draw = below(100);
  if (draw < 10) return "";
  let length =
    draw < 60
      ? 1 + below(6)
      : draw < 90
        ? 1 + below(24)
        : draw < 98
          ? 60 + below(300)
          : huge
            ? pick([70000, 70000, 1 << 20])
            : pick([1000, 4096]);
  const from = chance(0.5) ? ["a", "b", "c", "x", "y", "z", "k"] : pieces;
  if (length > 400) return pick(from).repeat(length);
  let value = "";
  while (length-- > 0) value += pick(from);
  return value;
}
const brokenStrings = [
  '"',
  '"a',
  '"\\',
  '"\\"',
  '"\\u',
  '"\\u0"',
  '"\\u00"',
  '"\\u004"',
  '"\\u00g0"',
  '"\\x41"',
  '"\\\'"',
  '"\\a"',
  '"\\u{41}"',
  '"\\U0041"',
  '"\n"',
  '"\t"',
  '"\0"',
  '"\x1f"',
  "'a'",
  "`a`",
  '"a""',
  '""a"',
  '"\\ud800',
  "a",
  '"\\0"',
  '"\\v"',
  '"\\\n"',
];
const anyString = (): string =>
  chance(0.04) ? pick(brokenStrings) : spellString(anyStringValue(), pick([0, 0, 0, 0.1, 0.5, 1]));

const oddNames = [
  "__proto__",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "length",
  "prototype",
  "then",
  "toJSON",
  "",
  " ",
  "0",
  "1",
  "2",
  "10",
  "-0",
  "-1",
  "01",
  "1e3",
  "1.5",
  "4294967294",
  "4294967295",
  "4294967296",
  "9007199254740993",
  "NaN",
  "Infinity",
  "undefined",
  "null",
  "true",
  "é",
  "日本",
  "😀",
  "\ud800",
  "\0",
  "a b",
  "a.b",
  "a\nb",
  "k",
  "x",
  "id",
  "name",
  "kind",
  "type",
];

/** A name that is nearly `name`. */
function nearly(name: string): string {
  const draw = below(9);
  const at = name.length ? below(name.length) : 0;
  if (draw === 0) return name + pick(["a", "0", " ", "\0", "_", name]);
  if (draw === 1) return name.slice(0, -1);
  if (draw === 2) return name.slice(1);
  if (draw === 3 && name.length)
    return (
      name.slice(0, at) +
      String.fromCharCode(name.charCodeAt(at) ^ pick([1, 2, 4, 8, 16, 32, 64, 128, 256, 0x100 + 1])) +
      name.slice(at + 1)
    );
  if (draw === 4) return name.toUpperCase() === name ? name.toLowerCase() : name.toUpperCase();
  if (draw === 5 && name.length > 1) return name.slice(0, at) + name.slice(at + 1);
  if (draw === 6 && name.length > 1) return name.slice(at) + name.slice(0, at);
  if (draw === 7) return pick([" ", "\0", "_", "a"]) + name;
  return name.split("").reverse().join("");
}

const space = (): string =>
  spacing === 0 ? "" : chance(spacing) ? pick([" ", "  ", "\n", "\t", "\r\n", " \n\t ", "        "]) : "";
let spacing = 0;
let escaping = 0;
/** How often a place in the text gets something other than its type asks for. */
let oddity = 0;
let budget = 0;
/** One text in hundreds may hold something very long: a string, a list, a run of names. */
let huge = false;

function anything(depth: number): string {
  budget--;
  const draw = below(depth > 4 || budget < 0 ? 6 : 9);
  if (draw < 2) return anyNumber();
  if (draw < 4) return anyString();
  if (draw === 4) return pick(["true", "false"]);
  if (draw === 5) return "null";
  if (draw === 6) {
    const items: string[] = [];
    for (let count = below(5); count > 0; count--) items.push(anything(depth + 1));
    return "[" + space() + items.join(space() + "," + space()) + space() + "]";
  }
  const members: string[] = [];
  for (let count = below(5); count > 0; count--)
    members.push(
      spellString(chance(0.6) ? pick(oddNames) : anyStringValue().slice(0, 40), escaping) +
        space() +
        ":" +
        space() +
        anything(depth + 1),
    );
  return "{" + space() + members.join(space() + "," + space()) + space() + "}";
}

const notJSON = [
  "",
  " ",
  "undefined",
  "nul",
  "nulll",
  "tru",
  "True",
  "NULL",
  "fals",
  "{",
  "}",
  "[",
  "]",
  "[,]",
  "[1,]",
  "[,1]",
  "{,}",
  '{"a"}',
  '{"a":}',
  '{"a":1,}',
  "{a:1}",
  "{'a':1}",
  '{"a" 1}',
  '{"a"::1}',
  "[1 2]",
  "[1;2]",
  "/**/1",
  "1//",
  "1/**/",
  "﻿1",
  " 1",
  "1 ",
  " 1",
  "\v1",
  "\f1",
  "1\0",
  "\0",
  "(1)",
  "1,2",
  "{}{}",
  "[][]",
  '""""',
  "new Date()",
  "<a>",
  "[[[[",
  "]]]]",
  '{"a":{"a":{"a":',
];

function makeNumber(): string {
  const value = below(2001) - 1000;
  if (chance(0.4)) return chance(0.5) ? respell(value + below(1000) / 1000) : anyNumber();
  if (chance(0.15)) return anyNumber();
  return respell(value);
}

/** Another way to write the same number. */
function respell(value: number): string {
  const plain = spellNumber(value);
  if (/[e.]|Inf|NaN/.test(plain)) return plain;
  const draw = below(12);
  if (draw === 0) return plain + ".0";
  if (draw === 1) return plain + "e0";
  if (draw === 2) return plain + "0e-1";
  if (draw === 3) return plain + ".000e+0";
  if (draw === 4) return plain + "00E-2";
  if (draw === 5 && /0$/.test(plain) && plain !== "0" && plain !== "-0") return plain.slice(0, -1) + "e1";
  if (draw === 6) return plain + "." + "0".repeat(pick([17, 30, 400]));
  return plain;
}

/** Something that is nearly this literal. */
function nearlyLiteral(value: string | number | boolean): string {
  if (typeof value === "string")
    return chance(0.7)
      ? spellString(nearly(value), escaping)
      : pick([
          spellString(value, 0).slice(0, -1),
          spellString(value, 0).slice(1),
          "null",
          "0",
          "[" + spellString(value, 0) + "]",
        ]);
  if (typeof value === "number")
    return pick([
      spellNumber(value + 1),
      spellNumber(value - 1),
      spellNumber(-value),
      spellNumber(value) + ".5",
      spellNumber(value) + "e1",
      '"' + value + '"',
      spellNumber(value) + "0",
      value === 0 ? "-0" : "0",
      value === 0 ? "1e-400" : spellNumber(value) + ".00000000000000000001",
      "true",
      "null",
    ]);
  return pick([
    value ? "false" : "true",
    value ? "1" : "0",
    '"' + value + '"',
    "null",
    value ? "tru" : "fals",
    value ? "truee" : "falsee",
  ]);
}

function makeMembers(description: Extract<Description, { kind: "object" }>, depth: number): string {
  type Written = { name: string; text: string };
  const written: Written[] = [];
  const tight = depth > 6 || budget < 0;
  for (const member of description.members) {
    if (member.optional ? tight || chance(0.45) : oddity > 0 && chance(oddity)) continue;
    written.push({ name: member.name, text: make(member.type, depth + 1) });
  }
  const declared = description.members;
  if (!tight && chance(0.25)) {
    const many = huge && depth < 2 && chance(0.3) ? pick([300, 300, 5000]) : 0;
    for (let count = many; count > 0; count--)
      written.push({
        name: pick(["n", "m", "key_"]) + count,
        text: description.rest ? sure(description.rest) : pick(["0", '"a"', "null", "[]", "{}"]),
      });
    for (let count = pick([1, 1, 1, 2, 3, 8]); count > 0; count--) {
      const name =
        declared.length && chance(0.5)
          ? nearly(pick(declared).name)
          : chance(0.7)
            ? pick(oddNames)
            : anyStringValue().slice(0, 30);
      written.splice(below(written.length + 1), 0, {
        name,
        text: description.rest && chance(0.8) ? make(description.rest, depth + 1) : anything(depth + 1),
      });
    }
  }
  if (!tight && declared.length && chance(0.12)) {
    // A declared name written twice or more: each time what its type asks for, or anything.
    for (let count = huge && depth < 2 && chance(0.3) ? 1000 : pick([1, 1, 2, 5]); count > 0; count--) {
      const member = pick(declared);
      written.splice(below(written.length + 1), 0, {
        name: member.name,
        text: chance(0.5) ? make(member.type, depth + 1) : anything(depth + 1),
      });
    }
  }
  if (chance(0.3)) {
    for (let at = written.length - 1; at > 0; at--) {
      const other = below(at + 1);
      [written[at], written[other]] = [written[other], written[at]];
    }
  } else if (written.length > 1 && chance(0.15)) {
    const at = below(written.length - 1);
    [written[at], written[at + 1]] = [written[at + 1], written[at]];
  }
  let text = "{" + space();
  for (let at = 0; at < written.length; at++)
    text +=
      (at ? space() + "," + space() : "") +
      spellString(written[at].name, chance(0.85) ? 0 : pick([0.1, 0.5, 1])) +
      space() +
      ":" +
      space() +
      written[at].text;
  return text + space() + "}";
}

function make(description: Description, depth: number): string {
  budget--;
  if (oddity > 0 && chance(oddity)) {
    const draw = below(depth > 6 || budget < 0 ? 8 : 10);
    if (draw < 6) return anything(depth);
    if (draw < 7) return pick(notJSON);
    if (draw < 8)
      return pick(["null", "[]", "{}", '""', "0", "false", "[null]", '{"":null}', "[[]]", '{"length":0}', '{"0":0}']);
    // Falls through to what the type asks for, wrapped.
    if (draw < 9) return "[" + make(description, depth + 1) + "]";
    return '{"value":' + make(description, depth + 1) + "}";
  }
  switch (description.kind) {
    case "number":
      return makeNumber();
    case "int32":
      return chance(0.6) ? pick(wholeNumbers) : chance(0.5) ? respell(below(4294967296) - 2147483648) : anyNumber();
    case "string":
      return anyString();
    case "boolean":
      return pick(["true", "false"]);
    case "null":
      return "null";
    case "literal":
      if (oddity > 0 && chance(oddity * 4)) return nearlyLiteral(description.value);
      if (typeof description.value === "string")
        return spellString(description.value, chance(0.8) ? 0 : pick([0.2, 1]));
      if (typeof description.value === "number") return respell(description.value);
      return String(description.value);
    case "anything":
      return anything(depth);
    case "object or array":
      return chance(0.5) ? "[" + anything(depth + 1) + "]" : '{"a":' + anything(depth + 1) + "}";
    case "array": {
      if (huge && depth < 2 && chance(0.3)) {
        const item = sure(description.of);
        if (item.length < 40)
          return "[" + (item + ",").repeat(pick([65534, 65535, 65536, 262144])) + make(description.of, depth + 1) + "]";
      }
      let count =
        depth > 6 || budget < 0 ? 0 : chance(0.9) ? below(5) : pick([0, 5, 17, 70]);
      let text = "[" + space();
      for (let at = 0; at < count; at++) text += (at ? space() + "," + space() : "") + make(description.of, depth + 1);
      return text + space() + "]";
    }
    case "tuple": {
      const items = description.of.map(item => make(item, depth + 1));
      if (oddity > 0 && chance(oddity * 2)) {
        if (chance(0.5)) items.pop();
        else items.push(items.length && chance(0.5) ? items[items.length - 1] : anything(depth + 1));
      }
      return "[" + space() + items.join(space() + "," + space()) + space() + "]";
    }
    case "record": {
      const members: string[] = [];
      for (let count = depth > 6 || budget < 0 ? 0 : pick([0, 1, 2, 3, 4, 9]); count > 0; count--)
        members.push(
          spellString(chance(0.5) ? pick(oddNames) : anyStringValue().slice(0, 20), escaping) +
            space() +
            ":" +
            space() +
            make(description.of, depth + 1),
        );
      return "{" + space() + members.join(space() + "," + space()) + space() + "}";
    }
    case "object":
      return makeMembers(description, depth);
    case "union": {
      // Deep down, an arm that ends.
      if (depth > 6 || budget < 0) {
        let least = description.of[0];
        for (const arm of description.of) if (height(arm) < height(least)) least = arm;
        return make(least, depth + 1);
      }
      return make(pick(description.of), depth + 1);
    }
    case "named":
      return make(named[description.index], depth);
  }
}

/** How many levels the smallest value of a type has: what a text that must come to an end goes for. */
let heights: number[] = [];
function height(description: Description): number {
  switch (description.kind) {
    case "tuple":
      return description.of.reduce((most, item) => Math.max(most, 1 + height(item)), 0);
    case "object":
      return description.members.reduce(
        (most, member) => (member.optional ? most : Math.max(most, 1 + height(member.type))),
        0,
      );
    case "union":
      return description.of.reduce((least, arm) => Math.min(least, height(arm)), 1e9);
    case "named":
      return heights[description.index];
    default:
      return 0;
  }
}

const marks = [
  "{",
  "}",
  "[",
  "]",
  ":",
  ",",
  '"',
  "\\",
  " ",
  "0",
  "1",
  "9",
  "-",
  "+",
  ".",
  "e",
  "E",
  "t",
  "f",
  "n",
  "u",
  "a",
  "\n",
  "\0",
  "﻿",
  "é",
  "Ā",
  "\ud800",
  "/",
  "*",
  "'",
  "\v",
  "\f",
  "\x85",
  "\xa0",
  "\u1680",
  "\u180e",
  "\u2000",
  "\u2009",
  "\u200a",
  "\u200b",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
];

function change(text: string, other: string): string {
  const length = text.length;
  if (length === 0) return pick(marks);
  const at = below(length);
  switch (below(14)) {
    case 0:
      return text.slice(0, at);
    case 1:
      return text.slice(at);
    case 2:
      return text.slice(0, at) + text.slice(at + 1);
    case 3:
      return text.slice(0, at) + pick(marks) + text.slice(at + 1);
    case 4:
      return text.slice(0, at) + pick(marks) + text.slice(at);
    case 5: {
      const size = 1 + below(Math.min(40, length - at));
      return text.slice(0, at) + text.slice(at + size);
    }
    case 6: {
      const size = 1 + below(Math.min(40, length - at));
      return text.slice(0, at + size) + text.slice(at);
    }
    case 7:
      return text.slice(0, at) + other.slice(below(other.length + 1));
    case 8: {
      // A number becomes another number.
      const numbers = [...text.matchAll(/-?\d+(\.\d+)?([eE][-+]?\d+)?/g)];
      if (!numbers.length) return text + pick(marks);
      const match = pick(numbers);
      return text.slice(0, match.index) + anyNumber() + text.slice(match.index + match[0].length);
    }
    case 9: {
      // A string, be it a name or a value, becomes another.
      const strings = [...text.matchAll(/"(?:[^"\\]|\\.)*"/g)];
      if (!strings.length) return text + pick(marks);
      const match = pick(strings);
      const inner = match[0].slice(1, -1);
      const replacement = chance(0.5)
        ? spellString(nearly(inner), 0)
        : chance(0.5)
          ? anyString()
          : spellString(pick(oddNames), escaping);
      return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
    }
    case 10: {
      // A word or a bracket pair becomes a value of another kind.
      const words = [...text.matchAll(/true|false|null|\[\]|\{\}|""/g)];
      if (!words.length) return text + pick(marks);
      const match = pick(words);
      return (
        text.slice(0, match.index) +
        pick(["true", "false", "null", "[]", "{}", '""', "0", "-0", "1.5", "[0]", '{"a":0}']) +
        text.slice(match.index + match[0].length)
      );
    }
    case 11:
      return text + pick([" ", "\n", ",", "}", "]", "0", "null", "\0", "//", "﻿", text]);
    case 12:
      return pick([" ", "\n", "﻿", "\0", "[", "{", ",", " ", "//\n", "0"]) + text;
    default: {
      const to = below(length);
      const [low, high] = at < to ? [at, to] : [to, at];
      return text.slice(0, low) + text[high] + text.slice(low + 1, high) + text[low] + text.slice(high + 1);
    }
  }
}

// ---- the same characters held in other ways

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const encoder = new TextEncoder();
const wellFormed = (text: string): boolean => text.isWellFormed();
const holdings = [
  "as it is",
  "16 bits a character",
  "two halves joined",
  "many pieces joined",
  "a part of a longer text",
  "a part of a longer text of 16 bits",
  "decoded from bytes",
  "out of a buffer",
  "from character codes",
] as const;

function hold(text: string, how: (typeof holdings)[number]): string {
  switch (how) {
    case "16 bits a character":
      return (text + "Ā").slice(0, -1);
    case "two halves joined": {
      const at = below(text.length + 1);
      return text.slice(0, at) + text.slice(at);
    }
    case "many pieces joined": {
      let joined = "";
      for (let at = 0; at < text.length;) {
        const size = 1 + below(7);
        joined += text.slice(at, at + size);
        at += size;
      }
      return joined;
    }
    case "a part of a longer text":
      return ('{"before":[1,2,' + text + ',"after"]}').slice(15, 15 + text.length);
    case "a part of a longer text of 16 bits":
      return ("Āā[" + text + "]Ă").slice(3, 3 + text.length);
    case "decoded from bytes":
      return wellFormed(text) ? decoder.decode(encoder.encode(text)) : text;
    case "out of a buffer":
      return wellFormed(text)
        ? Buffer.from(text, "utf8").toString("utf8")
        : Buffer.from(text, "utf16le").toString("utf16le");
    case "from character codes": {
      if (text.length > 5000) return text;
      const codes: number[] = [];
      for (let at = 0; at < text.length; at++) codes.push(text.charCodeAt(at));
      return String.fromCharCode(...codes);
    }
    default:
      return text;
  }
}

// ---- asking

let differences = 0;
let pairs = 0;
/** The heap is kept full on purpose: a RangeError may come out of anything, and ends the question that met it. */
let filling = false;
const counts = { "a T": 0, "no T": 0, "no JSON": 0 };
const plainParse = JSON.parse;

function report(what: string, test: Case, text: string, how: string, expected: string, got: string): void {
  differences++;
  if (differences > 40) return;
  const short = (long: string): string =>
    long.length > 1500 ? long.slice(0, 700) + " ... " + (long.length - 1400) + " more ... " + long.slice(-700) : long;
  console.log(
    "DIFFERS " +
      JSON.stringify({
        what,
        case: test.name,
        type: short(test.type),
        held: how,
        text: short(text),
        length: text.length,
        expected: short(expected),
        got: short(got),
      }),
  );
}

function answerOf(run: () => unknown): { threw: string; value: unknown } {
  try {
    return { threw: "", value: run() };
  } catch (error) {
    if (error instanceof SyntaxError) return { threw: "SyntaxError", value: undefined };
    if (error instanceof RangeError && filling) throw error;
    if (error instanceof RangeError) return { threw: "RangeError", value: undefined };
    if (error instanceof TypeError) return { threw: "TypeError", value: undefined };
    return { threw: "another error: " + String(error), value: undefined };
  }
}

const nameOfError = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : "something thrown that is no error";
function endOf(run: () => string): string {
  try {
    return "prints " + run();
  } catch (error) {
    if (error instanceof RangeError && filling) throw error;
    return nameOfError(error);
  }
}

let trace = false;
let depths = [10, 100, 1000, 5000, 20000, 100000, 1000000];
let deadline = Infinity;

function ask(test: Case, text: string): void {
  const how = pick(holdings);
  pairs++;
  if (trace)
    console.error(
      "ASK " +
        JSON.stringify([test.name, how, text.length > 3000 ? text.slice(0, 3000) : text, text.length]),
    );
  const tree = slowParse(text);
  const deep = deepest > 400;
  if (deepest > 2000) {
    // Too deep for the functions here that call themselves: the calls only have to end in one of the ways they may.
    for (const [name, parse] of test.parsers ?? [["read in part", test.inPart!]]) {
      const answer = answerOf(() => parse(hold(text, how)));
      // A TypeError is the reader's own: it reads a member of what is no object.
      if (
        answer.threw !== (tree === noJSON ? "SyntaxError" : "") &&
        answer.threw !== "RangeError" &&
        !(test.inPart && tree !== noJSON && answer.threw === "TypeError")
      )
        report(
          name + ": ends otherwise",
          test,
          text,
          how,
          tree === noJSON ? "SyntaxError" : "a value",
          answer.threw || "a value",
        );
    }
    return;
  }
  const plain = answerOf(() => plainParse(hold(text, how)));
  if ((tree === noJSON) !== (plain.threw === "SyntaxError"))
    report(
      "JSON.parse without a type and the slow parser",
      test,
      text,
      how,
      tree === noJSON ? "no JSON" : "JSON",
      plain.threw || "a value",
    );
  const expected = tree === noJSON ? "SyntaxError" : "";
  const isAT = tree !== noJSON && fits(test.description, tree);
  counts[tree === noJSON ? "no JSON" : isAT ? "a T" : "no T"]++;
  const spelled = tree === noJSON ? "" : spellTree(tree);
  if (tree !== noJSON && plain.threw === "" && spellValue(plain.value) !== spelled)
    report("what JSON.parse without a type gives", test, text, how, spelled, spellValue(plain.value));
  if (test.inPart) {
    const typed = endOf(() => test.inPart!(hold(text, how)));
    if (deep && typed === "RangeError") return;
    const untyped = tree === noJSON ? "SyntaxError" : endOf(() => test.readUntyped(plain.value));
    if (typed !== untyped) report("typed code reads a part of it otherwise", test, text, how, untyped, typed);
    return;
  }
  for (const [name, parse] of test.parsers!) {
    const answer = answerOf(() => parse(hold(text, how)));
    if (deep && answer.threw === "RangeError") continue;
    if (answer.threw !== expected) {
      report(
        name + ": ends otherwise",
        test,
        text,
        how,
        expected || "a value",
        answer.threw || "a value: " + spellValue(answer.value),
      );
      continue;
    }
    if (expected !== "") continue;
    const got = spellValue(answer.value);
    if (got !== spelled) report(name + ": another value", test, text, how, spelled, got);
    else if (chance(0.25)) {
      const way = below(4);
      const other = spellValueInOtherWays(answer.value, way);
      if (other !== spelled) report(name + ": another value, read in way " + way, test, text, how, spelled, other);
      const written = JSON.stringify(answer.value);
      const writtenPlain = JSON.stringify(plain.value);
      if (written !== writtenPlain)
        report(name + ": JSON.stringify writes it otherwise", test, text, how, writtenPlain, written);
    }
  }
  if (test.revived && !deep && chance(0.3)) {
    const [name, parse] = pick(test.revived);
    calls = 0;
    const reference = answerOf(() => plainParse(hold(text, how), revivers[name]));
    calls = 0;
    const answer = answerOf(() => parse(hold(text, how)));
    if (answer.threw !== reference.threw)
      report(
        "with a reviver, " + name + ": ends otherwise",
        test,
        text,
        how,
        reference.threw || "a value: " + spellValue(reference.value),
        answer.threw || "a value: " + spellValue(answer.value),
      );
    else if (answer.threw === "" && spellValue(answer.value) !== spellValue(reference.value))
      report(
        "with a reviver, " + name + ": another value",
        test,
        text,
        how,
        spellValue(reference.value),
        spellValue(answer.value),
      );
  }
  if (tree !== noJSON && plain.threw === "" && !deep && test.readCast) {
    const cast = endOf(() => test.readCast!(hold(text, how)));
    const untyped = endOf(() => test.readUntyped(plain.value));
    if (cast !== untyped) report("typed code reads it otherwise", test, text, how, untyped, cast);
  }
  if (isAT && !deep && test.readChanged && chance(0.3)) {
    const drawn = next();
    let changed: unknown;
    let after = 0;
    const typed = endOf(() =>
      test.readChanged!(hold(text, how), value => {
        state = drawn;
        changeValue(value);
        after = state;
        changed = value;
      }),
    );
    state = drawn;
    const twin = valueOf(tree as Tree);
    changeValue(twin);
    const same = state === after;
    const untyped = endOf(() => test.readUntyped(twin));
    if (!same) report("the same changes take another course", test, text, how, spellValue(twin), spellValue(changed));
    else if (typed !== untyped)
      report(
        "typed code reads it otherwise after a change",
        test,
        text,
        how,
        untyped + " of " + spellValue(twin),
        typed + " of " + spellValue(changed),
      );
    else if (spellValue(changed) !== spellValue(twin))
      report("another value after a change", test, text, how, spellValue(twin), spellValue(changed));
  }
}

/** Every object and list inside a value, the value itself first. */
function partsOf(value: unknown, into: object[] = []): object[] {
  if (typeof value !== "object" || value === null || into.length > 200) return into;
  into.push(value);
  for (const name of Object.keys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, name)!;
    if ("value" in property) partsOf(property.value, into);
  }
  return into;
}

/** One to four drawn changes of a value. The same numbers drawn give the same changes on a value that is spelled the same. */
function changeValue(value: unknown): void {
  for (let times = 1 + below(4); times > 0; times--) {
    const parts = partsOf(value);
    if (!parts.length) return;
    const part: any = pick(parts);
    const names = Object.keys(part);
    const name = names.length && chance(0.7) ? pick(names) : pick(oddNames);
    // A list does not become billions of elements long.
    if (Array.isArray(part) && (name === "length" || (isIndex(name) && Number(name) > part.length + 5))) continue;
    try {
      switch (below(12)) {
        case 0:
          delete part[name];
          break;
        case 1:
        case 2:
          part[name] = pick<() => unknown>([
            () => 1.5,
            () => "x",
            () => null,
            () => undefined,
            () => ({}),
            () => [],
            () => true,
            () => -0,
            () => 2147483648,
            () => 7,
            () => ({ a: 1 }),
          ])();
          break;
        case 3:
          Object.defineProperty(part, name, { value: 3, writable: true, enumerable: true, configurable: true });
          break;
        case 4:
          Object.defineProperty(part, name, { get: () => 7, enumerable: true, configurable: true });
          break;
        case 5:
          pick([Object.freeze, Object.seal, Object.preventExtensions])(part);
          break;
        case 6:
          if (Array.isArray(part))
            pick<() => unknown>([
              () => part.push(1),
              () => part.pop(),
              () => (part.length = 0),
              () => (part[part.length + 3] = 1),
              () => part.reverse(),
              () => part.unshift("x"),
              () => part.splice(1, 1),
            ])();
          break;
        case 7:
          Object.setPrototypeOf(
            part,
            pick<() => object | null>([() => null, () => ({ inherited: 1 }), () => Object.prototype])(),
          );
          break;
        case 8: {
          const held = part[name];
          delete part[name];
          part[name] = held;
          break;
        }
        case 9:
          Object.defineProperty(part, name, { enumerable: false });
          break;
        case 10:
          Object.assign(part, { added: 1, 0: "zero" });
          break;
        default:
          for (const other of names) part[other] = part[names[0]];
      }
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof RangeError)) throw error;
    }
  }
}

async function askLater(test: Case, text: string): Promise<void> {
  if (!test.parseLater) return;
  pairs++;
  if (trace)
    console.error(
      "ASK LATER " + JSON.stringify([test.name, text.length > 3000 ? text.slice(0, 3000) : text]),
    );
  const tree = slowParse(text);
  if (deepest > 400) return;
  const expected = tree === noJSON ? "SyntaxError" : "a value: " + spellTree(tree);
  let got: string;
  try {
    got = "a value: " + spellValue(await test.parseLater(text));
  } catch (error) {
    got = nameOfError(error);
  }
  if (got !== expected) report("a parse behind an await", test, text, "as it is", expected, got);
}

const strayBytes = [
  [0x80],
  [0xbf],
  [0xc0, 0xaf],
  [0xc0, 0xa2],
  [0xc1, 0xbf],
  [0xc2],
  [0xe0, 0x80, 0x80],
  [0xe0, 0xa0],
  [0xed, 0xa0, 0x80],
  [0xed, 0xb0, 0x80],
  [0xef, 0xbb, 0xbf],
  [0xef, 0xbf, 0xbe],
  [0xf0, 0x80, 0x80, 0x80],
  [0xf0, 0x9f, 0x98],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf5],
  [0xf8, 0x88, 0x80, 0x80, 0x80],
  [0xfe],
  [0xff],
  [0],
  [0xc3, 0xa9],
  [0xc3, 0xbf],
  [0xc4, 0x80],
  [0xe6, 0x97, 0xa5],
  [0xf0, 0x9f, 0x98, 0x80],
];
const lenientDecoder = new TextDecoder();

let server: ReturnType<typeof Bun.serve> | undefined;
let served: Case[] = [];

/** The bytes go to a server of this process over the loopback, whole or in pieces cut at any byte. */
async function askServer(test: Case, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (!test.serve || bytes.length > 100000) return;
  server ??= Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const name = new URL(request.url).pathname.slice(1);
      const wanted = served.find(one => one.name === name)!;
      try {
        // Written as JSON: half a surrogate pair does not survive in the bytes of an answer.
        return new Response(JSON.stringify("prints " + (await wanted.serve!(request))));
      } catch (error) {
        return new Response(JSON.stringify(nameOfError(error)));
      }
    },
  });
  const decoded = lenientDecoder.decode(bytes);
  const tree = slowParse(decoded);
  if (deepest > 400) return;
  pairs++;
  if (trace)
    console.error(
      "ASK SERVER " + JSON.stringify([test.name, Buffer.from(bytes).toString("hex").slice(0, 6000)]),
    );
  const expected = tree === noJSON ? "SyntaxError" : endOf(() => test.readUntyped(plainParse(decoded)));
  let body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array<ArrayBuffer>> = bytes;
  if (chance(0.4) && bytes.length) {
    const pieces: Uint8Array<ArrayBuffer>[] = [];
    for (let at = 0; at < bytes.length;) {
      const size = 1 + below(pick([2, 8, 64, 1000]));
      pieces.push(bytes.slice(at, at + size));
      at += size;
    }
    body = new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(piece);
        controller.close();
      },
    });
  }
  const got = plainParse(await (await fetch(server.url + test.name, { method: "POST", body })).text());
  if (got !== expected)
    report(
      "a server reads a body otherwise",
      test,
      Buffer.from(bytes).toString("hex"),
      body === bytes ? "bytes, here in hex" : "bytes in pieces, here in hex",
      expected,
      got,
    );
}

/** The bytes of a body, read as JSON under a type that nothing checks. */
async function askBody(test: Case, text: string): Promise<void> {
  if (!test.readBody || !test.readRequest) return;
  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(encoder.encode(text));
  for (let times = pick([0, 0, 1, 1, 2, 5]); times > 0; times--) {
    const at = below(bytes.length + 1);
    const stray = pick(strayBytes);
    const keep = chance(0.5) ? at : Math.min(bytes.length, at + stray.length);
    const next = new Uint8Array(at + stray.length + bytes.length - keep);
    next.set(bytes.subarray(0, at));
    next.set(stray, at);
    next.set(bytes.subarray(keep), at + stray.length);
    bytes = next;
  }
  if (chance(0.1)) bytes = bytes.slice(0, below(bytes.length + 1));
  if (chance(0.3)) await askServer(test, bytes);
  pairs++;
  if (trace)
    console.error(
      "ASK BYTES " + JSON.stringify([test.name, Buffer.from(bytes).toString("hex").slice(0, 6000)]),
    );
  const decoded = lenientDecoder.decode(bytes);
  const tree = slowParse(decoded);
  if (deepest > 400) return;
  const expected = tree === noJSON ? "SyntaxError" : endOf(() => test.readUntyped(plainParse(decoded)));
  counts[tree === noJSON ? "no JSON" : fits(test.description, tree) ? "a T" : "no T"]++;
  for (const [name, read] of [
    ["Response", test.readBody],
    ["Request", test.readRequest],
  ] as const) {
    let got: string;
    try {
      got = "prints " + (await read(bytes.slice()));
    } catch (error) {
      got = nameOfError(error);
    }
    if (got !== expected)
      report(
        "typed code reads the body of a " + name + " otherwise",
        test,
        Buffer.from(bytes).toString("hex"),
        "bytes, here in hex",
        expected,
        got,
      );
  }
}

/** A small text that is a value of the type for sure. */
function sure(description: Description): string {
  switch (description.kind) {
    case "number":
      return "0";
    case "int32":
      return "7";
    case "string":
      return '""';
    case "boolean":
      return "true";
    case "null":
      return "null";
    case "literal":
      return JSON.stringify(description.value);
    case "anything":
      return "0";
    case "object or array":
      return "[]";
    case "array":
      return "[]";
    case "tuple":
      return "[" + description.of.map(sure).join(",") + "]";
    case "record":
      return "{}";
    case "object":
      return (
        "{" +
        description.members
          .filter(member => !member.optional)
          .map(member => spellString(member.name, 0) + ":" + sure(member.type))
          .join(",") +
        "}"
      );
    case "union": {
      let least = description.of[0];
      for (const arm of description.of) if (height(arm) < height(least)) least = arm;
      return sure(least);
    }
    case "named":
      return sure(named[description.index]);
  }
}

/** The text in front of and behind a place in a value of `description` where a value of the type `target` stands, or anything if target is -1. */
function around(description: Description, target: number, level: number, open: number[]): [string, string] | undefined {
  const least = sure;
  switch (description.kind) {
    case "anything":
      return target === -1 ? ["", ""] : undefined;
    case "named": {
      if (description.index === target && level > 0) return ["", ""];
      if (open.includes(description.index)) return undefined;
      return around(named[description.index], target, level + 1, [...open, description.index]);
    }
    case "array": {
      const inner = around(description.of, target, level + 1, open);
      return inner && ["[" + inner[0], inner[1] + "]"];
    }
    case "record": {
      const inner = around(description.of, target, level + 1, open);
      return inner && ['{"k":' + inner[0], inner[1] + "}"];
    }
    case "tuple":
      for (let at = 0; at < description.of.length; at++) {
        const inner = around(description.of[at], target, level + 1, open);
        if (!inner) continue;
        const before = description.of
          .slice(0, at)
          .map(item => least(item) + ",")
          .join("");
        const after = description.of
          .slice(at + 1)
          .map(item => "," + least(item))
          .join("");
        return ["[" + before + inner[0], inner[1] + after + "]"];
      }
      return undefined;
    case "object":
      for (const member of description.members) {
        const inner = around(member.type, target, level + 1, open);
        if (!inner) continue;
        let before = "{";
        let after = "";
        let passed = false;
        for (const other of description.members) {
          if (other === member) passed = true;
          else if (other.optional) continue;
          else if (passed) after += "," + spellString(other.name, 0) + ":" + least(other.type);
          else before += spellString(other.name, 0) + ":" + least(other.type) + ",";
        }
        return [before + spellString(member.name, 0) + ":" + inner[0], inner[1] + after + "}"];
      }
      return undefined;
    case "union":
      for (const arm of description.of) {
        const inner = around(arm, target, level + 1, open);
        if (inner) return inner;
      }
      return undefined;
    default:
      return undefined;
  }
}

const mayEnd = (answer: string, ...ways: string[]): boolean => ways.includes(answer);

/** A value nested `levels` deep: the whole of it, the front of it alone, and with something at the bottom that is no T or no JSON. A reader may throw a TypeError of its own. */
function askDeep(test: Case, index: number, levels: number): void {
  oddity = 0;
  spacing = 0;
  escaping = 0;
  const parse =
    test.inPart ?? (test.parsers!.length ? test.parsers![below(test.parsers!.length)][1] : test.parsers![0][1]);
  const texts: [string, string, string[]][] = [];
  const isAT = (text: string): boolean => {
    const tree = slowParse(text);
    return tree !== noJSON && fits(test.description, tree);
  };
  const own = around(test.description, index, 0, [index]);
  if (own && own[0] !== "" && isAT(own[0] + sure(test.description) + own[1])) {
    const bottom = sure(test.description);
    texts.push(["a T", own[0].repeat(levels) + bottom + own[1].repeat(levels), ["", "RangeError"]]);
    texts.push(["the front of a T", own[0].repeat(levels), ["SyntaxError", "RangeError"]]);
    texts.push([
      "a T but for its innermost part",
      own[0].repeat(levels) + '"\\u0000 no such value"' + own[1].repeat(levels),
      ["", "TypeError", "RangeError"],
    ]);
    texts.push([
      "JSON but for its innermost part",
      own[0].repeat(levels) + "nul" + own[1].repeat(levels),
      ["SyntaxError", "RangeError"],
    ]);
    texts.push([
      "a T that ends one level early",
      own[0].repeat(levels) + bottom + own[1].repeat(levels - 1),
      ["SyntaxError", "RangeError"],
    ]);
  }
  const free = around(test.description, -1, 0, [index]);
  if (free && isAT(free[0] + "0" + free[1])) {
    const [front, back] = pick([
      ["[", "]"],
      ['{"a":', "}"],
      ['[{"a":[', "]}]"],
      ['[1,"a",', ",null]"],
    ]);
    texts.push([
      "anything, nested",
      free[0] + front.repeat(levels) + "0" + back.repeat(levels) + free[1],
      ["", "RangeError"],
    ]);
    texts.push(["anything, nested and cut", free[0] + front.repeat(levels), ["SyntaxError", "RangeError"]]);
  }
  texts.push([
    "lists where none are asked for",
    "[".repeat(levels) + "]".repeat(levels),
    ["", "TypeError", "RangeError"],
  ]);
  texts.push([
    "objects where none are asked for",
    '{"a":'.repeat(levels) + "1" + "}".repeat(levels),
    ["", "TypeError", "RangeError"],
  ]);
  for (const [what, text, ways] of texts) {
    pairs++;
    if (trace) console.error("ASK DEEP " + JSON.stringify([test.name, what, levels]));
    const answer = answerOf(() => parse(text));
    if (!mayEnd(answer.threw, ...ways))
      report(
        "nested " + levels + " levels, " + what + ": ends otherwise",
        test,
        text,
        "as it is",
        ways.map(way => way || "a value").join(" or "),
        answer.threw || "a value",
      );
  }
}

/** Texts that grow sixteenfold: the time may grow as they do, not as their square. */
function askGrowth(test: Case, index: number): void {
  oddity = 0;
  spacing = 0;
  escaping = 0;
  const parse = test.inPart ?? test.parsers![0][1];
  const whole = sure(test.description);
  const families: [string, (size: number) => string][] = [];
  const firstBrace = whole.indexOf("{");
  if (firstBrace >= 0) {
    const comma = whole[firstBrace + 1] === "}" ? "" : ",";
    const into = (members: (size: number) => string) => (size: number) =>
      whole.slice(0, firstBrace + 1) + members(size) + comma + whole.slice(firstBrace + 1);
    const list = (size: number, one: (at: number) => string): string =>
      Array.from({ length: size }, (_, at) => one(at)).join(",");
    families.push(["other names", into(size => list(size, at => '"n' + at + '":' + at))]);
    families.push(["one other name again and again", into(size => list(size, () => '"again":1'))]);
    families.push(["other names that are numbers", into(size => list(size, at => '"' + (size - at) + '":1'))]);
    families.push(["other names with escapes", into(size => list(size, at => '"\\u006e' + at + '":1'))]);
    families.push(["other names that hold lists", into(size => list(size, at => '"n' + at + '":[{"a":[]}]'))]);
    const key = /"((?:[^"\\]|\\.)*)":/.exec(whole.slice(firstBrace));
    if (key) {
      families.push(["the first name again and again", into(size => list(size, () => '"' + key[1] + '":null'))]);
      families.push(["names nearly the first", into(size => list(size, at => '"' + key[1] + at + '":null'))]);
    }
  }
  families.push(["white space", size => " ".repeat(size) + whole + "\n".repeat(size)]);
  families.push(["a long string", size => '"' + "a".repeat(size) + '"']);
  families.push(["a long string of escapes", size => '"' + "\\u0061".repeat(size) + '"']);
  families.push(["a long number", size => "1".repeat(size)]);
  families.push(["a long fraction", size => "0." + "1".repeat(size)]);
  families.push(["a list of the value", size => "[" + (whole + ",").repeat(size) + whole + "]"]);
  families.push(["a list of lists", size => "[" + "[],".repeat(size) + "[]]"]);
  families.push(["a list of what is no T", size => "[" + '{"\\u0000":[null]},'.repeat(size) + "0]"]);
  const own = around(test.description, index, 0, [index]);
  if (own && own[0] !== "") {
    const bottom = sure(test.description);
    families.push([
      "nested",
      size => own[0].repeat(Math.min(size, 3000)) + bottom + own[1].repeat(Math.min(size, 3000)),
    ]);
    families.push([
      "nested, wrong at the bottom",
      size => own[0].repeat(Math.min(size, 3000)) + "[[{}]]" + own[1].repeat(Math.min(size, 3000)),
    ]);
  }
  for (const [what, text] of families) {
    const time = (size: number, call: (text: string) => unknown = parse): number => {
      const made = text(size);
      let best = Infinity;
      for (let times = 0; times < 3; times++) {
        const from = performance.now();
        answerOf(() => call(made));
        best = Math.min(best, performance.now() - from);
      }
      pairs += 3;
      return best;
    };
    const small = time(4000);
    const large = time(64000);
    // JSON.parse without a type is the yardstick: what costs it as much is no matter of the type.
    if (large > 100 && large > small * 100 && large > 10 * time(64000, plainParse))
      report(
        "grows faster than the text: " + what,
        test,
        text(40),
        "as it is",
        "about 16 times " + small.toFixed(2) + " ms; without a type " + time(64000, plainParse).toFixed(2) + " ms",
        large.toFixed(2) + " ms",
      );
  }
}

/** What is parsed is kept until no more fits; then some is let go. What was kept must be whole, and every question has its usual answer or ends in a RangeError. */
function fill(cases: Case[], seconds: number): void {
  filling = true;
  let kept: unknown[] = [];
  let witnesses: [string, unknown][] = [];
  let timesFull = 0;
  // Most of the heap is taken by things that have nothing to do with texts, so that a few texts fill the rest.
  const ballast: { at: number }[][] = [];
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const test = pick(cases);
    try {
      for (;;) ballast.push(Array.from({ length: 2000 }, (_, at) => ({ at })));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    ballast.length -= Math.min(ballast.length, pick([1, 1, 2, 4, 16]));
    try {
      for (let count = 0; count < 20000; count++) {
        const text = makeText(test);
        if (chance(0.05)) ask(test, text);
        if (!test.parsers) continue;
        pairs++;
        const answer = answerOf(() => test.parsers![0][1](text));
        if (answer.threw !== "") continue;
        kept.push(answer.value);
        if (chance(0.01) && text.length < 2000) witnesses.push([spellValue(answer.value), answer.value]);
      }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      timesFull++;
      kept = chance(0.3) ? [] : kept.slice(0, kept.length >> 1);
      try {
        for (const [spelled, value] of witnesses)
          if (spellValue(value) !== spelled)
            report(
              "what was kept while the heap filled up has changed",
              test,
              spelled,
              "as it is",
              spelled,
              spellValue(value),
            );
      } catch (again) {
        if (!(again instanceof RangeError)) throw again;
      }
      witnesses = [];
    }
  }
  filling = false;
  console.log("the heap was full " + timesFull + " times");
}

function makeText(test: Case): string {
  spacing = pick([0, 0, 0, 0.1, 0.5]);
  escaping = pick([0, 0, 0, 0.1, 1]);
  oddity = pick([0, 0, 0.02, 0.05, 0.15]);
  budget = pick([30, 100, 100, 400]);
  // Where every allocation collects, a text of a megabyte takes minutes.
  huge = !process.env.BUN_JSC_slowPathAllocsBetweenGCs && chance(0.003);
  return space() + make(test.description, 0) + space();
}

/** One round: every case gets `perCase` texts; some are changed, one is cut at every character. */
export async function round(cases: Case[], perCase: number): Promise<void> {
  for (const test of cases) {
    if (Date.now() > deadline) return;
    let last = "null";
    if (chance(0.3)) askDeep(test, Number(test.name.slice(1)), pick(depths));
    for (let count = perCase >> 2; count > 0; count--) {
      let text = makeText(test);
      if (chance(0.2)) text = change(text, last);
      await askBody(test, text);
      await askLater(test, text);
    }
    for (let count = 0; count < perCase && Date.now() < deadline; count++) {
      // Now and then a text that was made for another type of the program: the two may have names in common.
      let text = chance(0.05) ? makeText(pick(cases)) : makeText(test);
      if (chance(0.35)) for (let times = pick([1, 1, 1, 2, 3, 6]); times > 0; times--) text = change(text, last);
      ask(test, text);
      last = text;
    }
    oddity = 0;
    spacing = 0;
    escaping = 0;
    budget = 40;
    const whole = make(test.description, 0);
    if (whole.length < 400 && chance(0.25)) {
      for (let at = 0; at <= whole.length; at++) ask(test, whole.slice(0, at));
      for (let at = 0; at < whole.length; at++) ask(test, whole.slice(0, at) + pick(marks) + whole.slice(at + 1));
    }
  }
}

export async function run(cases: Case[], descriptions: Description[]): Promise<void> {
  named = descriptions;
  heights = descriptions.map(() => 1e9);
  for (let changed = true; changed;) {
    changed = false;
    descriptions.forEach((description, index) => {
      const now = height(description);
      if (now < heights[index]) {
        heights[index] = now;
        changed = true;
      }
    });
  }
  const option = (name: string, otherwise: number): number => {
    const at = process.argv.indexOf("--" + name);
    return at < 0 ? otherwise : Number(process.argv[at + 1]);
  };
  state = option("seed", 1) | 0;
  trace = process.argv.includes("--trace");
  const only = process.argv.indexOf("--only");
  if (only >= 0) cases = cases.filter(test => test.name === process.argv[only + 1]);
  served = cases;
  const seconds = option("seconds", 0);
  const rounds = option("rounds", 1);
  const perCase = option("texts", 200);
  const started = Date.now();
  if (seconds > 0) deadline = started + seconds * 1000;
  // Where every allocation collects, a million levels take minutes.
  if (process.env.BUN_JSC_slowPathAllocsBetweenGCs) depths = [10, 100, 1000, 5000];
  const levels = option("levels", 1000000);
  depths = depths.filter(depth => depth <= levels);
  if (process.argv.includes("--growth")) {
    for (const test of cases) askGrowth(test, Number(test.name.slice(1)));
    console.log("texts " + pairs + " differences " + differences);
    if (differences) process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--fill")) fill(cases, seconds);
  else
    for (let count = 0; seconds > 0 ? Date.now() - started < seconds * 1000 : count < rounds; count++)
      await round(cases, perCase);
  await server?.stop(true);
  console.log(
    "texts " +
      pairs +
      " a T " +
      counts["a T"] +
      " no T " +
      counts["no T"] +
      " no JSON " +
      counts["no JSON"] +
      " differences " +
      differences,
  );
  if (differences) process.exitCode = 1;
}

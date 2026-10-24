// Writes a TypeScript program that hands live JavaScript values to `validate<T>(value)`: generated types, generated samples of each type, and every sample dressed up in many ways.
//
//   types      objects (plain, strict, with an index signature), optional members, arrays, tuples, records, unions told apart by kind or by a `kind` member, literals, numbers and strings with rules, int32,
//              bigint, unknown, object, and a type that refers to itself. The names of members come from a small pool, so that many types share names in another order and with other kinds of values
//   samples    written as literals in the program, in the declared order and in the opposite one, as instances of a class, and rebuilt name by name from parsed text
//   dressed    one part of the sample at a time. An object: behind a Proxy (that forwards, answers otherwise, hides or adds a key, throws, is revoked, validates the same value again), with an accessor (that
//              answers otherwise the second time, changes its holder, the root or a neighbor, throws, collects), with a key that is hidden, inherited or a symbol, without a prototype, frozen, sealed, with many
//              keys added and deleted, with an index, as a function, a Date, a Map, an Error, a boxed primitive, an arguments object, an instance with a private name, from another realm, cloned, holding itself.
//              An array: behind a Proxy (with another length, other elements), with holes, longer, sparse, with an accessor for an element that shortens, lengthens, empties, fills, reverses or freezes the array
//              in the middle of the walk, with an iterator of its own, of a subclass, with names, frozen, with another prototype that lends elements, in every kind of storage, from another realm; and what looks
//              like an array but is none. A leaf: every kind of number, text in pieces, boxed primitives, and values of every other kind
//
// Each dressed sample is made three times, alike. One goes to a function that validates it and at once reads and writes every member through the type, and keeps the result to itself. One goes to a function that
// hands the result out: it is looked at property by property, without running any code of the value. One is copied and judged by a slow checker that is written here from the documentation and follows the description
// of the type as data. The program prints a line for each answer that does not hold:
//   what was accepted is a T, made of plain data, when it is used   .   it shares no object or array that T describes with the value   .   what happens to the value afterwards does not reach it
//   typed code reads in it, and writes to it, what untyped code does   .   the checker accepts and refuses the same values, and what is accepted has the same members in the same order
// and a last line with the totals.
//
//   bun test/aot/fuzz/live-values-handed-to-validate.ts <seed> <number of types>     prints the program; the program takes [one in how many dressed samples] [seed of that choice]
import { Random } from "./random";

type Description =
  | { k: "string"; min?: number; max?: number; pattern?: string }
  | { k: "number"; int?: boolean; min?: number; max?: number; step?: number; int32?: boolean }
  | { k: "boolean" }
  | { k: "null" }
  | { k: "bigint" }
  | { k: "unknown" }
  | { k: "anyobject" }
  | { k: "literal"; v: string | number | boolean }
  | { k: "array"; e: Description; min?: number; max?: number }
  | { k: "tuple"; es: Description[] }
  | { k: "record"; e: Description }
  | { k: "object"; ms: { key: string; optional: boolean; d: Description }[]; strict: boolean; indexed: boolean }
  | { k: "union"; arms: Description[] }
  | { k: "ref"; to: string };

type Generated = { type: string; d: Description; sample: () => string };

const names = ["id", "name", "kind", "items", "count", "flag", "note", "tags", "inner", "value", "left", "right", "size", "with-dash"];
const isIdentifier = (name: string): boolean => /^[A-Za-z_]\w*$/.test(name);
const keyOf = (name: string): string => (isIdentifier(name) ? name : JSON.stringify(name));
const member = (of: string, name: string): string => (isIdentifier(name) ? `${of}.${name}` : `${of}[${JSON.stringify(name)}]`);

class Types {
  constructor(private random: Random) {}

  text(): Generated {
    const random = this.random;
    const tags: string[] = [];
    const d: Description & { k: "string" } = { k: "string" };
    let low = 0, high = 9, alphabet = "abcXYZ 09-é𝒳"; // prettier-ignore
    if (random.chance(0.3)) { low = d.min = random.between(1, 3); tags.push(`Schema.MinLength<${low}>`); } // prettier-ignore
    if (random.chance(0.3)) { high = d.max = random.between(low + 1, low + 5); tags.push(`Schema.MaxLength<${high}>`); } // prettier-ignore
    if (random.chance(0.2)) { alphabet = "abcdefgh"; d.pattern = "^[a-z]*$"; tags.push('Schema.Pattern<"^[a-z]*$">'); } // prettier-ignore
    const letters = [...alphabet];
    return { type: ["string", ...tags].join(" & "), d, sample: () => JSON.stringify(Array.from({ length: random.between(low, high) }, () => random.pick(letters)).join("")) };
  }

  number(): Generated {
    const random = this.random;
    if (random.chance(0.2)) return { type: "int32", d: { k: "number", int: true, min: -2147483648, max: 2147483647, int32: true }, sample: () => String(random.pick([0, 1, -1, 7, 2147483647, -2147483648, random.between(-1000, 1000)])) };
    const tags: string[] = [];
    const d: Description & { k: "number" } = { k: "number" };
    let low = -50, high = 50, step = 1; // prettier-ignore
    if (random.chance(0.4)) { d.int = true; tags.push("Schema.Int"); } // prettier-ignore
    if (random.chance(0.3)) { low = d.min = random.between(-5, 5); tags.push(`Schema.Min<${low}>`); } // prettier-ignore
    if (random.chance(0.3)) { high = d.max = random.between(low + 10, low + 100); tags.push(`Schema.Max<${high}>`); } // prettier-ignore
    if (d.int && random.chance(0.2)) { step = d.step = random.pick([2, 5]); tags.push(`Schema.MultipleOf<${step}>`); } // prettier-ignore
    const sample = (): string => {
      if (!d.int) return String(random.pick([low, high, random.between(low * 100, high * 100) / 100]));
      const n = random.between(low, high);
      const stepped = n - (((n % step) + step) % step);
      return String(stepped >= low ? stepped : stepped + step);
    };
    return { type: ["number", ...tags].join(" & "), d, sample };
  }

  constant(value: string | number | boolean): Generated {
    return { type: JSON.stringify(value), d: { k: "literal", v: value }, sample: () => JSON.stringify(value) };
  }

  leaf(): Generated {
    const random = this.random;
    return random.weighted<() => Generated>([
      [30, () => this.text()],
      [34, () => this.number()],
      [8, () => ({ type: "boolean", d: { k: "boolean" }, sample: () => String(random.chance(0.5)) })],
      [5, () => ({ type: "null", d: { k: "null" }, sample: () => "null" })],
      [4, () => ({ type: "bigint", d: { k: "bigint" }, sample: () => random.between(-9, 9) + "n" })],
      [5, () => ({ type: "unknown", d: { k: "unknown" }, sample: () => random.pick(["1", '"u"', "null", "[1]", "{ a: 1 }", "undefined"]) })],
      [4, () => ({ type: "object", d: { k: "anyobject" }, sample: () => random.pick(["[1]", "{ a: 1 }", "{}"]) })],
      [10, () => this.constant(random.pick(["a", "bee", "", 0, 1, 42, -3, true, false]))],
    ])();
  }

  object(depth: number, discriminant?: string): Generated {
    const random = this.random;
    const members: [string, boolean, Generated][] = [];
    let chosen = random.sample(names, random.chance(0.1) ? random.between(7, 11) : random.between(1, 5));
    if (discriminant !== undefined) {
      chosen = chosen.filter(name => name !== "kind");
      members.push(["kind", false, this.constant(discriminant)]);
    }
    for (const name of chosen) members.push([name, random.chance(0.3), this.generate(depth - 1)]);
    const mode = discriminant !== undefined ? "plain" : random.pick(["plain", "plain", "plain", "strict", "indexed"]);
    const written = members.map(([name, optional, held]) => `${keyOf(name)}${optional ? "?" : ""}: ${held.type};`).join(" ");
    const d: Description = { k: "object", ms: members.map(([key, optional, held]) => ({ key, optional, d: held.d })), strict: mode === "strict", indexed: mode === "indexed" };
    const sample = (): string => {
      const made: string[] = [];
      for (const [name, optional, held] of members) if (!optional || random.chance(0.6)) made.push(`${keyOf(name)}: ${held.sample()}`);
      if (mode !== "strict" && random.chance(0.3)) made.push("unknownKey: " + random.pick(["1", '"u"', "null", "[1]"]));
      return made.length ? "{ " + made.join(", ") + " }" : "{}";
    };
    if (mode === "indexed") return { type: `{ ${written} [key: string]: unknown; }`, d, sample };
    if (mode === "strict") return { type: `({ ${written} } & Schema.Strict)`, d, sample };
    return { type: `{ ${written} }`, d, sample };
  }

  list(element: Generated, mayBeTagged: boolean): Generated {
    const random = this.random;
    const tags: string[] = [];
    const d: Description & { k: "array" } = { k: "array", e: element.d };
    let low = 0, high = 4; // prettier-ignore
    if (mayBeTagged && random.chance(0.25)) { low = d.min = random.between(1, 2); tags.push(`Schema.MinItems<${low}>`); } // prettier-ignore
    if (mayBeTagged && random.chance(0.25)) { high = d.max = random.between(low + 1, low + 3); tags.push(`Schema.MaxItems<${high}>`); } // prettier-ignore
    return { type: [`(${element.type})[]`, ...tags].join(" & "), d, sample: () => "[" + Array.from({ length: random.between(low, high) }, () => element.sample()).join(", ") + "]" };
  }

  union(arms: Generated[]): Generated {
    return { type: "(" + arms.map(arm => arm.type).join(" | ") + ")", d: { k: "union", arms: arms.map(arm => arm.d) }, sample: () => this.random.pick(arms).sample() };
  }

  generate(depth: number): Generated {
    const random = this.random;
    if (depth <= 0) return this.leaf();
    return random.weighted<() => Generated>([
      [28, () => this.leaf()],
      [26, () => this.object(depth)],
      [16, () => this.list(this.generate(depth - 1), true)],
      [8, () => {
        const elements = Array.from({ length: random.between(1, 3) }, () => this.generate(depth - 1));
        return { type: "[" + elements.map(element => element.type).join(", ") + "]", d: { k: "tuple", es: elements.map(element => element.d) }, sample: () => "[" + elements.map(element => element.sample()).join(", ") + "]" };
      }],
      [8, () => {
        const held = this.generate(depth - 1);
        return { type: `Record<string, ${held.type}>`, d: { k: "record", e: held.d }, sample: () => "{ " + random.sample(["a", "b", "c", '"k-1"'], random.between(0, 3)).map(key => `${key}: ${held.sample()}`).join(", ") + " }" };
      }],
      [7, () => this.union(random.sample(["circle", "square", "none", "line"], random.between(2, 3)).map(kind => this.object(depth - 1, kind)))],
      [7, () => {
        const arms: Generated[] = [this.text(), this.number(), { type: "boolean", d: { k: "boolean" }, sample: () => "true" }, { type: "null", d: { k: "null" }, sample: () => "null" }, this.list(this.leafThatIsTested(), false), this.object(depth - 1)];
        return this.union(random.sample(arms, random.between(2, 4)));
      }],
    ])();
  }

  leafThatIsTested(): Generated {
    return this.random.chance(0.5) ? this.text() : this.number();
  }
}

// Typed code that reads everything that the type describes. `digest` in the program below does the same by the description.
class Reader {
  #next = 0;
  constructor(private random: Random) {}

  name(): string {
    return "x" + this.#next++;
  }

  read(d: Description, e: string): string {
    switch (d.k) {
      case "string":
        return `out.push("s" + ${e}.length + ":" + ${e});`;
      case "number":
        return `out.push("n" + (${e} * 2 + 1) + ":" + (${e} | 0) + ":" + 1 / ${e});`;
      case "boolean":
        return `out.push(${e} ? "T" : "F");`;
      case "null":
        return `out.push(${e} === null ? "null" : "other");`;
      case "bigint":
        return `out.push("b" + (${e} + 1n));`;
      case "unknown":
      case "anyobject":
        return `out.push("u" + typeof ${e});`;
      case "literal":
        return `out.push("l" + typeof ${e} + ${e});`;
      case "array": {
        const [item, index] = [this.name(), this.name()];
        const body = this.read(d.e, item);
        const walk = this.random.pick([
          `for (let ${index} = 0; ${index} < ${e}.length; ${index}++) { const ${item} = ${e}[${index}]; ${body} }`,
          `for (const ${item} of ${e}) { ${body} }`,
          `${e}.forEach(${item} => { ${body} });`,
        ]);
        return `out.push("[" + ${e}.length); ${walk} out.push("]");`;
      }
      case "tuple":
        return `out.push("(" + ${e}.length); ` + d.es.map((element, index) => { const item = this.name(); return `{ const ${item} = ${e}[${index}]; ${this.read(element, item)} }`; }).join(" ") + ` out.push(")");`; // prettier-ignore
      case "record": {
        const [key, item] = [this.name(), this.name()];
        return `out.push("<"); for (const ${key} of Object.keys(${e})) { out.push(${key}); const ${item} = ${e}[${key}]; ${this.read(d.e, item)} } out.push(">");`;
      }
      case "object": {
        const parts = d.ms.map(({ key, optional, d: held }) => {
          const item = this.name();
          const body = this.read(held, item);
          return optional ? `{ const ${item} = ${member(e, key)}; if (${item} !== undefined) { ${body} } else out.push("-"); }` : `{ const ${item} = ${member(e, key)}; ${body} }`;
        });
        return `out.push("{" + Object.keys(${e}).join()); ${parts.join(" ")} out.push("}");`;
      }
      case "union":
        return this.readUnion(d.arms, e);
      case "ref":
        return `use${d.to}(${e}, out);`;
    }
  }

  readUnion(arms: Description[], e: string): string {
    const tests: string[] = [];
    const classOf = (arm: Description): string => (arm.k === "literal" ? typeof arm.v : arm.k);
    const has = (k: string): boolean => arms.some(arm => classOf(arm) === k);
    if (has("string")) tests.push(`if (typeof ${e} === "string") { ${this.read({ k: "string" }, e)} }`);
    if (has("number")) tests.push(`if (typeof ${e} === "number") { ${this.read({ k: "number" }, e)} }`);
    if (has("boolean")) tests.push(`if (typeof ${e} === "boolean") { ${this.read({ k: "boolean" }, e)} }`);
    if (has("null")) tests.push(`if (${e} === null) { out.push("null"); }`);
    const list = arms.find(arm => arm.k === "array");
    if (list) tests.push(`if (Array.isArray(${e})) { ${this.read(list, e)} }`);
    const objects = arms.filter(arm => arm.k === "object") as (Description & { k: "object" })[];
    if (objects.length === 1) tests.push(`{ ${this.read(objects[0], e)} }`);
    else if (objects.length > 1) {
      const cases = objects.map(arm => `case ${JSON.stringify((arm.ms[0].d as { v: string }).v)}: { ${this.read(arm, e)} break; }`);
      tests.push(`{ switch (${e}.kind) { ${cases.join(" ")} } }`);
    } else tests.push(`{ out.push("nothing"); }`);
    return tests.join(" else ");
  }

  // Typed code that writes wherever the type allows it without a look at the rules. `change` in the program below does the same by the description.
  write(d: Description, e: string): string {
    switch (d.k) {
      case "array": {
        const inner = this.writeHeld(d.e, `${e}[0]`);
        const more = d.e.k === "number" ? `${e}.push(7);` : d.e.k === "string" ? `${e}.push("more");` : d.e.k === "boolean" ? `${e}.push(true);` : "";
        return `if (${e}.length > 0) { ${inner} } ${more}`;
      }
      case "tuple":
        return d.es.map((element, index) => this.writeHeld(element, `${e}[${index}]`)).join(" ");
      case "record": {
        const key = this.name();
        return `for (const ${key} of Object.keys(${e})) { ${this.writeHeld(d.e, `${e}[${key}]`)} }`;
      }
      case "object":
        return d.ms
          .map(({ key, optional, d: held }) => {
            const place = member(e, key);
            if (!optional) return this.writeHeld(held, place);
            const fresh = held.k === "number" ? `${place} = 5;` : held.k === "string" ? `${place} = "new";` : held.k === "boolean" ? `${place} = true;` : "";
            const item = this.name();
            if (held.k === "number" || held.k === "string" || held.k === "boolean" || held.k === "bigint") return `if (${place} !== undefined) { ${this.writeHeld(held, place)} } else { ${fresh} }`;
            return `{ const ${item} = ${place}; if (${item} !== undefined) { ${this.write(held, item)} } }`;
          })
          .join(" ");
      default:
        return "";
    }
  }

  writeHeld(d: Description, place: string): string {
    switch (d.k) {
      case "number":
        return d.int32 ? `${place} = (${place} + 1) | 0;` : `${place} = ${place} + 1;`;
      case "string":
        return `${place} = ${place} + "!";`;
      case "boolean":
        return `${place} = !${place};`;
      case "bigint":
        return `${place} = ${place} + 2n;`;
      case "array":
      case "tuple":
      case "record":
      case "object": {
        const item = this.name();
        return `{ const ${item} = ${place}; ${this.write(d, item)} }`;
      }
      default:
        return "";
    }
  }
}

function reversed(literal: string): string {
  // Turns the members of the outermost object literal around. A sample that is no object literal stays as it is.
  if (!literal.startsWith("{ ")) return literal;
  const parts: string[] = [];
  let depth = 0, start = 2, quoted = false; // prettier-ignore
  for (let i = 2; i < literal.length - 2; i++) {
    const c = literal[i];
    if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; continue; } // prettier-ignore
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) { parts.push(literal.slice(start, i)); start = i + 2; } // prettier-ignore
  }
  parts.push(literal.slice(start, literal.length - 2));
  return "{ " + parts.reverse().join(", ") + " }";
}

export function program(seed: number, count: number): string {
  const random = new Random(seed);
  const types = new Types(random);
  const lines = [
    `// Generated by test/aot/fuzz/live-values-handed-to-validate.ts ${seed} ${count}.`,
    'import type { Schema, int32 } from "bun";',
    'import { validate } from "bun:bundle";',
    'import { types as kinds } from "node:util";',
    'import { createContext, runInContext } from "node:vm";',
  ];
  const cases: string[] = [];
  const add = (name: string, type: string, d: Description, samples: string[], isInterface = false): void => {
    lines.push(isInterface ? `interface ${name} ${type}` : `type ${name} = ${type};`);
    // Two sets of the same functions: what the first set is handed never leaves typed code.
    for (const set of ["", "Kept"]) {
      const reader = new Reader(new Random(seed * 1000 + cases.length));
      const refer = (text: string): string => text.replaceAll(/\buse(Tree|Json)\(/g, `use$1${set}(`);
      lines.push(`function use${name}${set}(v: ${name}, out: string[]): void { ${refer(reader.read(d, "v"))} }`);
      lines.push(`function write${name}${set}(v: ${name}): void { ${reader.write(d, "v")} }`);
    }
    lines.push(`function alone${name}(value: unknown): string { const out: string[] = []; const v = validate<${name}>(value); use${name}Kept(v, out); out.push("|"); write${name}Kept(v); use${name}Kept(v, out); return out.join(" "); }`);
    lines.push(`let held${name}: ${name} | undefined;`);
    lines.push(`function take${name}(value: unknown): unknown { held${name} = undefined; return (held${name} = validate<${name}>(value)); }`);
    lines.push(`function read${name}(): string { const out: string[] = []; use${name}(held${name}!, out); return out.join(" "); }`);
    lines.push(`function change${name}(): void { write${name}(held${name}!); }`);
    const isObject = samples[0].startsWith("{");
    const asClass = isObject && d.k === "object" && samples[0] !== "{}";
    if (asClass) {
      const fields = reversed(reversed(samples[0])).slice(2, -2);
      lines.push(`class Class${name} { #hidden = 1; static of(): unknown { const made: any = new Class${name}(); Object.assign(made, { ${fields} }); return made; } get lent(): number { return this.#hidden; } }`);
    }
    const written = [...samples, ...samples.slice(0, 1).map(reversed)].map(sample => `() => (${sample})`);
    if (asClass) written.push(`() => Class${name}.of()`);
    cases.push(`  { name: "${name}", d: ${JSON.stringify(d)}, alone: alone${name}, take: take${name}, read: read${name}, change: change${name}, samples: [${written.join(", ")}] },`);
  };
  for (let i = 0; i < count; i++) {
    const generated = i % 3 ? types.object(3) : types.generate(3);
    add("T" + i, generated.type, generated.d, [generated.sample(), generated.sample()]);
  }
  add("Tree", "{ value: number & Schema.Int; children: Tree[]; parent?: Tree | null }", { k: "object", strict: false, indexed: false, ms: [{ key: "value", optional: false, d: { k: "number", int: true } }, { key: "children", optional: false, d: { k: "array", e: { k: "ref", to: "Tree" } } }, { key: "parent", optional: true, d: { k: "union", arms: [{ k: "ref", to: "Tree" }, { k: "null" }] } }] }, ["{ value: 1, children: [{ value: 2, children: [], parent: null }, { value: 3, children: [{ value: 4, children: [] }] }] }"], true); // prettier-ignore
  lines.push("const cases: Case[] = [", ...cases, "];");
  return lines.join("\n") + "\n" + harness;
}

const harness = String.raw`
type D = any;
type Case = { name: string; d: D; alone: (value: unknown) => string; take: (value: unknown) => unknown; read: () => string; change: () => void; samples: (() => unknown)[] };
const descriptions: Record<string, D> = {};
for (const one of cases) descriptions[one.name] = one.d;
const resolve = (d: D): D => (d.k === "ref" ? descriptions[d.to] : d);

let state = 1;
function reseed(seed: number): void { state = seed >>> 0; }
function next(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
const below = (limit: number): number => next() % limit;
const pick = <T,>(from: readonly T[]): T => from[below(from.length)];

const isObject = (value: any): boolean => (typeof value === "object" && value !== null) || typeof value === "function";
const isList = (value: any): boolean => { try { return Array.isArray(value); } catch { return false; } };

// ---- what the documentation says, by the description, slowly
function countCharacters(text: string): number { let count = 0; for (const _ of text) count++; return count; }
function describesClass(d: D, isArray: boolean, seen: D[] = []): boolean {
  d = resolve(d);
  if (seen.includes(d)) return false;
  if (d.k === "union") return d.arms.some((arm: D) => describesClass(arm, isArray, [...seen, d]));
  return isArray ? d.k === "array" || d.k === "tuple" : d.k === "object" || d.k === "record";
}
function spread(from: any): any {
  const copy: any = {};
  for (const key of Reflect.ownKeys(from)) {
    const property = Reflect.getOwnPropertyDescriptor(from, key);
    if (property === undefined || !property.enumerable) continue;
    Object.defineProperty(copy, key, { value: Reflect.get(from, key, from), writable: true, enumerable: true, configurable: true });
  }
  return copy;
}
function lengthOf(from: any): number {
  const length = +from.length;
  return length > 0 ? Math.min(Math.floor(length), Number.MAX_SAFE_INTEGER) : 0;
}
class Judge {
  copies = new Set<object>();
  // An array is read by its length, once, and then element by element as far as somebody looks.
  unread = new Map<object, { from: any; length: number }>();
  holes = 0;
  depth = 0;
  lengthOf(copy: any[]): number { return this.unread.get(copy)?.length ?? copy.length; }
  read(copy: any[], index: number): void {
    const unread = this.unread.get(copy);
    if (unread === undefined || index < copy.length) return;
    const value = unread.from[index];
    if (value === undefined && !Object.prototype.hasOwnProperty.call(unread.from, index) && ++this.holes > 65536) throw new RangeError("too many holes");
    Object.defineProperty(copy, index, { value, writable: true, enumerable: true, configurable: true });
    if (copy.length === unread.length) this.unread.delete(copy);
  }
  readToEnd(copy: any): void { if (isObject(copy) && this.unread.has(copy)) for (let i = copy.length, length = this.lengthOf(copy); i < length; i++) this.read(copy, i); }
  held(holder: any, key: any, d: D): any {
    const value = holder[key];
    if (!isObject(value) || this.copies.has(value) || (!describesClass(d, true) && !describesClass(d, false))) return value;
    const isArray = Array.isArray(value);
    if (!describesClass(d, isArray)) return value;
    const copy = isArray ? [] : spread(value);
    if (isArray) { const length = lengthOf(value); if (length > 0) this.unread.set(copy, { from: value, length }); }
    this.copies.add(copy);
    Object.defineProperty(holder, key, { value: copy, writable: true, enumerable: true, configurable: true });
    return copy;
  }
  accepts(d: D, holder: any, key: any): boolean {
    if (++this.depth > 400) throw new RangeError("too deep");
    try { return this.acceptsHere(resolve(d), holder, key); } finally { this.depth--; }
  }
  acceptsHere(d: D, holder: any, key: any): boolean {
    const value = this.held(holder, key, d);
    switch (d.k) {
      case "string": {
        if (typeof value !== "string") return false;
        const length = countCharacters(value);
        return !(length < d.min) && !(length > d.max) && (d.pattern === undefined || new RegExp(d.pattern).test(value));
      }
      case "number":
        return typeof value === "number" && value - value === 0 && (!d.int || Math.floor(value) === value) && !(value < d.min) && !(value > d.max) && (d.step === undefined || value % d.step === 0);
      case "boolean": return value === true || value === false;
      case "null": return value === null;
      case "bigint": return typeof value === "bigint";
      case "unknown": this.readToEnd(value); return true;
      case "anyobject": this.readToEnd(value); return isObject(value);
      case "literal": return value === d.v;
      case "array": {
        if (!Array.isArray(value)) return false;
        const length = this.lengthOf(value);
        if (length < d.min || length > d.max) return false;
        for (let i = 0; i < length; i++) { this.read(value, i); if (!this.accepts(d.e, value, i)) return false; }
        return true;
      }
      case "tuple": {
        if (!Array.isArray(value) || this.lengthOf(value) !== d.es.length) return false;
        for (let i = 0; i < d.es.length; i++) { this.read(value, i); if (!this.accepts(d.es[i], value, i)) return false; }
        return true;
      }
      case "record": {
        if (!isObject(value) || Array.isArray(value)) return false;
        for (const name of Object.keys(value)) if (!this.accepts(d.e, value, name)) return false;
        return true;
      }
      case "object": {
        if (!isObject(value) || Array.isArray(value)) return false;
        for (const { key: name, optional, d: held } of d.ms) {
          const has = Object.prototype.hasOwnProperty.call(value, name);
          if (!has && !optional) return false;
          if (optional && (!has || value[name] === undefined)) continue;
          if (!this.accepts(held, value, name)) return false;
        }
        if (d.strict) for (const name of Object.keys(value)) if (!d.ms.some((m: any) => m.key === name)) return false;
        return true;
      }
      case "union":
        return d.arms.some((arm: D) => this.accepts(arm, holder, key));
    }
    throw new Error("no such description");
  }
}

// ---- what a value is made of, found out without running any code of it
const problems: string[] = [];
function look(d: D, value: any, shared: Set<object>, at: string): any {
  d = resolve(d);
  if (!isObject(value)) return value;
  const isArray = isList(value);
  if (!describesClass(d, isArray)) return { "(as it came)": typeof value };
  if (kinds.isProxy(value)) return void problems.push(at + " is a Proxy");
  if (shared.has(value)) problems.push(at + " is an object of the value that was handed over");
  if (Object.getPrototypeOf(value) !== (isArray ? Array.prototype : Object.prototype)) problems.push(at + " has another prototype");
  if (!Object.isExtensible(value)) problems.push(at + " is closed");
  const copy: any = isArray ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (isArray && key === "length") continue;
    const property = Reflect.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in property) || !property.writable || !property.enumerable || !property.configurable) { problems.push(at + "." + String(key) + " is no plain property"); continue; }
    Object.defineProperty(copy, key, { value: look(under(d, key, property.value), property.value, shared, at + "." + String(key)), writable: true, enumerable: true, configurable: true });
  }
  if (isArray && copy.length !== value.length) { problems.push(at + " has holes"); copy.length = value.length; }
  return copy;
}
const nothingDescribed = { k: "unknown" };
function under(d: D, key: any, value: any): D {
  if (typeof key === "symbol") return nothingDescribed;
  switch (d.k) {
    case "array": return d.e;
    case "tuple": return d.es[key] ?? nothingDescribed;
    case "record": return d.e;
    case "object": return d.ms.find((m: any) => m.key === key)?.d ?? nothingDescribed;
    case "union": {
      // Whatever an arm describes there has been copied if that arm was tried.
      const all = d.arms.map((arm: D) => under(resolve(arm), key, value)).filter((inner: D) => inner !== nothingDescribed);
      return all.length === 0 ? nothingDescribed : all.length === 1 ? all[0] : { k: "union", arms: all, loose: true };
    }
  }
  return nothingDescribed;
}
function show(value: any, seen: any[] = []): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (seen.includes(value)) return "(again)";
  if (kinds.isProxy(value)) return "(a Proxy)";
  if (value === globalThis) return "(the global object)";
  if (seen.length > 8) return "(deep)";
  seen = [...seen, value];
  if (Array.isArray(value)) { let text = "["; for (let i = 0; i < value.length && i < 200; i++) { const property = Reflect.getOwnPropertyDescriptor(value, i); text += (i ? "," : "") + (property === undefined ? "hole" : "value" in property ? show(property.value, seen) : "(an accessor)"); } return text + "]#" + value.length; }
  return "{" + Reflect.ownKeys(value).map(key => { const property = Reflect.getOwnPropertyDescriptor(value, key)!; return String(key) + ":" + (property === undefined ? "(gone)" : "value" in property ? show(property.value, seen) : "(an accessor)"); }).join(",") + "}";
}
// What stands where nothing is described is the very value that came: it is compared by kind.
function expected(d: D, value: any): any {
  d = resolve(d);
  if (!isObject(value)) return value;
  const isArray = isList(value);
  if (!describesClass(d, isArray)) return { "(as it came)": typeof value };
  const copy: any = isArray ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (isArray && key === "length") continue;
    Object.defineProperty(copy, key, { value: expected(under(d, key, value[key]), value[key]), writable: true, enumerable: true, configurable: true });
  }
  return copy;
}

// ---- what the typed functions of each type do, by the description
function digest(d: D, e: any, out: string[]): void {
  d = resolve(d);
  switch (d.k) {
    case "string": out.push("s" + e.length + ":" + e); return;
    case "number": out.push("n" + (e * 2 + 1) + ":" + (e | 0) + ":" + 1 / e); return;
    case "boolean": out.push(e ? "T" : "F"); return;
    case "null": out.push(e === null ? "null" : "other"); return;
    case "bigint": out.push("b" + (e + 1n)); return;
    case "unknown": case "anyobject": out.push("u" + ((isObject(e) && !kinds.isProxy(e) ? Reflect.getOwnPropertyDescriptor(e, "(as it came)")?.value : undefined) ?? typeof e)); return;
    case "literal": out.push("l" + typeof e + e); return;
    case "array": out.push("[" + e.length); for (let i = 0; i < e.length; i++) digest(d.e, e[i], out); out.push("]"); return;
    case "tuple": out.push("(" + e.length); for (let i = 0; i < d.es.length; i++) digest(d.es[i], e[i], out); out.push(")"); return;
    case "record": out.push("<"); for (const key of Object.keys(e)) { out.push(key); digest(d.e, e[key], out); } out.push(">"); return;
    case "object":
      out.push("{" + Object.keys(e).join());
      for (const { key, optional, d: held } of d.ms) { if (optional && e[key] === undefined) out.push("-"); else digest(held, e[key], out); }
      out.push("}");
      return;
    case "union": {
      const classOf = (arm: D): string => (arm.k === "literal" ? typeof arm.v : arm.k);
      const has = (k: string): boolean => d.arms.some((arm: D) => classOf(arm) === k);
      if (has("string") && typeof e === "string") return digest({ k: "string" }, e, out);
      if (has("number") && typeof e === "number") return digest({ k: "number" }, e, out);
      if (has("boolean") && typeof e === "boolean") return digest({ k: "boolean" }, e, out);
      if (has("null") && e === null) return void out.push("null");
      const list = d.arms.find((arm: D) => arm.k === "array");
      if (list && Array.isArray(e)) return digest(list, e, out);
      const objects = d.arms.filter((arm: D) => arm.k === "object");
      if (objects.length === 1) return digest(objects[0], e, out);
      if (objects.length === 0) return void out.push("nothing");
      const arm = objects.find((arm: D) => arm.ms[0].d.v === e.kind);
      if (arm) digest(arm, e, out);
      return;
    }
  }
}
function changeHeld(d: D, holder: any, key: any): void {
  d = resolve(d);
  switch (d.k) {
    case "number": holder[key] = d.int32 ? (holder[key] + 1) | 0 : holder[key] + 1; return;
    case "string": holder[key] = holder[key] + "!"; return;
    case "boolean": holder[key] = !holder[key]; return;
    case "bigint": holder[key] = holder[key] + 2n; return;
    case "array": case "tuple": case "record": case "object": change(d, holder[key]); return;
  }
}
function change(d: D, e: any): void {
  switch (d.k) {
    case "array":
      if (e.length > 0 && d.e.k !== "ref") changeHeld(d.e, e, 0);
      if (d.e.k === "number") e.push(7); else if (d.e.k === "string") e.push("more"); else if (d.e.k === "boolean") e.push(true);
      return;
    case "tuple": for (let i = 0; i < d.es.length; i++) if (d.es[i].k !== "ref") changeHeld(d.es[i], e, i); return;
    case "record": for (const key of Object.keys(e)) if (d.e.k !== "ref") changeHeld(d.e, e, key); return;
    case "object":
      for (const { key, optional, d: held } of d.ms) {
        if (held.k === "ref" || held.k === "union") continue;
        if (!optional || e[key] !== undefined) changeHeld(held, e, key);
        else if (held.k === "number") e[key] = 5; else if (held.k === "string") e[key] = "new"; else if (held.k === "boolean") e[key] = true;
      }
      return;
  }
}
function digestBeforeAndAfter(d: D, value: any): string {
  const out: string[] = [];
  digest(d, value, out); out.push("|"); change(resolve(d), value); digest(d, value, out);
  return out.join(" ");
}

// ---- samples and how they are dressed
type Path = (string | number)[];
type Made = { value: any; parts: object[] };
type Dress = { name: string; on: "object" | "array" | "leaf" | "any"; put: (part: any, made: Made, root: () => any, again: (value: any) => void) => any };

function rebuilt(value: any): any {
  if (!isObject(value)) return value;
  if (Array.isArray(value)) return Array.from(value, rebuilt);
  const made = JSON.parse("{}");
  for (const key of Object.keys(value)) made[key] = rebuilt(value[key]);
  return made;
}
function pathsOf(value: any, at: Path, found: Path[]): void {
  found.push(at);
  if (found.length > 40 || !isObject(value)) return;
  if (Array.isArray(value)) value.forEach((item, index) => pathsOf(item, [...at, index], found));
  else for (const key of Object.keys(value)) pathsOf(value[key], [...at, key], found);
}
function collectParts(value: any, parts: object[]): void {
  if (!isObject(value) || parts.includes(value)) return;
  parts.push(value);
  for (const key of Object.keys(value)) collectParts(value[key], parts);
}
const otherRealm = createContext({});
const runInNewContext = (text: string): any => runInContext(text, otherRealm);
let junkOfThisValue: any[] | undefined;
const junk = (): any[] => (junkOfThisValue ??= freshJunk());
const freshJunk = (): any[] => [undefined, null, true, false, 0, -0, 1, -1, 1.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740992, 1e21, 1e308, 5e-324, 0.1 + 0.2, 42, -3,
  "", "a", "bee", "1", "abc", "ABC", "\ud800", "🍞", "x".repeat(40), 1n, -1n, 2n ** 64n, Symbol("s"), Symbol.iterator, [], {}, [1], ["a"], { a: 1 }, { kind: "circle" }, [[]], [null], () => 1, function () {}, class {},
  new Number(1), new String("a"), new Boolean(true), Object(1n), Object(Symbol("o")), new Date(0), new Map([[1, 2]]), new Set([1]), /a/g, new Error("e"), new Uint8Array(2), new Float64Array([1.5]), new ArrayBuffer(8),
  Promise.resolve(1), new WeakMap(), { valueOf() { return 1; } }, { toString() { return "a"; } }, { [Symbol.toPrimitive]() { return 1; } }, { length: 0 }, { length: 1, 0: "a" }, Object.create(null), new Proxy({}, {}), new Proxy([], {}), globalThis, Math, JSON];
const otherThan = (value: any): any => { const all = junk(); for (;;) { const other = pick(all); if (typeof other !== typeof value || isObject(other)) return other; } };
class Marker extends Error {}
function everyTrap(count: () => void): ProxyHandler<any> {
  const handler: any = {};
  for (const name of ["get", "set", "has", "deleteProperty", "ownKeys", "getOwnPropertyDescriptor", "defineProperty", "getPrototypeOf", "setPrototypeOf", "isExtensible", "preventExtensions"])
    handler[name] = (...args: any[]) => { count(); return (Reflect as any)[name](...args); };
  return handler;
}
const keysOf = (part: any): string[] => Object.keys(part);
function accessor(part: any, key: any, get: () => any): any { Object.defineProperty(part, key, { get, enumerable: true, configurable: true }); return part; }
let isChanging = false;
function alter(target: any, how: number): void {
  if (isChanging || !isObject(target) || target === globalThis || target === Math || target === JSON) return;
  isChanging = true;
  try { alterOnce(target, how); } catch {} finally { isChanging = false; }
}
function alterOnce(target: any, how: number): void {
  {
    if (Array.isArray(target)) {
      switch (how % 12) {
        case 0: target.length = 0; return;
        case 1: target.length = target.length >> 1; return;
        case 2: for (let i = 0; i < 40; i++) target.push(otherThan(target[0])); return;
        case 3: target[target.length + 3000] = otherThan(target[0]); return;
        case 4: target.shift(); return;
        case 5: target.reverse(); return;
        case 6: target.fill(otherThan(target[0])); return;
        case 7: Object.setPrototypeOf(target, null); return;
        case 8: Object.freeze(target); return;
        case 9: delete target[target.length - 1]; return;
        case 10: target.unshift(otherThan(target[0]), otherThan(target[0])); return;
        case 11: target.splice(0, target.length, ...Array.from({ length: 300 }, () => otherThan(target[0]))); return;
      }
    }
    const keys = Object.keys(target);
    switch (how % 9) {
      case 0: for (const key of keys) delete target[key]; return;
      case 1: for (const key of keys) target[key] = otherThan(target[key]); return;
      case 2: target["added" + how] = 1; return;
      case 3: Object.freeze(target); return;
      case 4: Object.setPrototypeOf(target, { lent: 1 }); return;
      case 5: for (const key of keys) Object.defineProperty(target, key, { get() { return otherThan(1); }, enumerable: true, configurable: true }); return;
      case 6: for (let i = 0; i < 80; i++) target["k" + i] = i; for (let i = 0; i < 80; i++) delete target["k" + i]; return;
      case 7: if (keys.length) delete target[keys[keys.length - 1]]; return;
      case 8: for (const key of keys) Object.defineProperty(target, key, { enumerable: false }); return;
    }
  }
}
function carrier(which: number): any {
  switch (which % 22) {
    case 0: return function () {};
    case 1: return () => 1;
    case 2: return new Date(0);
    case 3: return new Map();
    case 4: return new Set();
    case 5: return /a/;
    case 6: return new Error("e");
    case 7: return new Number(1);
    case 8: return new String("");
    case 9: return new Boolean(false);
    case 10: return (function (..._: any[]) { return arguments; })();
    case 11: return new Uint8Array(0);
    case 12: return new ArrayBuffer(0);
    case 13: return Promise.resolve();
    case 14: return (function* () {})();
    case 15: return Object(Symbol("c"));
    case 16: return Object(1n);
    case 17: return new (class Named { #own = 1; has(o: any) { return #own in o; } })();
    case 18: return new WeakMap();
    case 19: return new DataView(new ArrayBuffer(1));
    case 20: return class {};
    default: return Object.create({ lent: 1 });
  }
}
function give(target: any, part: any): any {
  for (const key of Object.keys(part)) try { Object.defineProperty(target, key, { value: part[key], writable: true, enumerable: true, configurable: true }); } catch {}
  return target;
}
function storageOf(part: any[], which: number): any[] {
  switch (which % 8) {
    case 0: { const made = new Array(part.length); for (let i = 0; i < part.length; i++) made[i] = part[i]; return made; }
    case 1: { const made: any[] = []; for (let i = part.length - 1; i >= 0; i--) made[i] = part[i]; return made; }
    case 2: { const made = [...part]; made[made.length + 20000] = 1; made.length = part.length; return made; }
    case 3: { const made: any[] = [1, 2, 3]; made.length = 0; made.push(...part); return made; }
    case 4: { const made: any[] = [1.5, 2.5]; made.length = 0; made.push(...part); return made; }
    case 5: return part.slice();
    case 6: return part.map(item => item);
    default: { const made = [...part, 0]; made.pop(); return made; }
  }
}
const dresses: Dress[] = [
  { name: "as it is", on: "any", put: part => part },
  // objects
  { name: "behind a Proxy", on: "object", put: part => new Proxy(part, {}) },
  { name: "behind a Proxy that forwards", on: "object", put: part => new Proxy(part, everyTrap(() => {})) },
  { name: "behind two Proxies", on: "object", put: part => new Proxy(new Proxy(part, {}), everyTrap(() => {})) },
  { name: "behind a Proxy that answers otherwise", on: "object", put: part => { const key = pick(keysOf(part)); const other = otherThan(part[key]); return new Proxy(part, { get: (target, name, receiver) => (name === key ? other : Reflect.get(target, name, receiver)) }); } },
  { name: "behind a Proxy that answers otherwise from the second time on", on: "object", put: part => { const asked = new Set<any>(); const other = otherThan(1); return new Proxy(part, { get: (target, name, receiver) => (asked.has(name) ? other : (asked.add(name), Reflect.get(target, name, receiver))) }); } },
  { name: "behind a Proxy that hides a key", on: "object", put: part => { const key = pick(keysOf(part)); return new Proxy(part, { ownKeys: target => Reflect.ownKeys(target).filter(name => name !== key) }); } },
  { name: "behind a Proxy that adds a key", on: "object", put: part => new Proxy(part, { ownKeys: target => [...Reflect.ownKeys(target), "more"], getOwnPropertyDescriptor: (target, name) => (name === "more" ? { value: 1, enumerable: true, configurable: true, writable: true } : Reflect.getOwnPropertyDescriptor(target, name)), get: (target, name, receiver) => (name === "more" ? 1 : Reflect.get(target, name, receiver)) }) },
  { name: "behind a Proxy that calls every key hidden", on: "object", put: part => new Proxy(part, { getOwnPropertyDescriptor: (target, name) => { const property = Reflect.getOwnPropertyDescriptor(target, name); return property && { ...property, enumerable: false }; } }) },
  { name: "behind a Proxy that throws", on: "object", put: part => { let left = below(8); return new Proxy(part, everyTrap(() => { if (left-- === 0) throw new Marker("thrown by a trap"); })); } },
  { name: "behind a revoked Proxy", on: "object", put: part => { const { proxy, revoke } = Proxy.revocable(part, {}); revoke(); return proxy; } },
  { name: "behind a Proxy that revokes itself", on: "object", put: part => { let left = below(8); const { proxy, revoke } = Proxy.revocable(part, everyTrap(() => { if (left-- === 0) revoke(); })); return proxy; } },
  { name: "behind a Proxy that validates the whole value again", on: "object", put: (part, _, root, again) => { let left = 2; return new Proxy(part, everyTrap(() => { if (left > 0) { left--; again(root()); } })); } },
  { name: "behind a Proxy that changes its target", on: "object", put: part => { let left = below(6); const how = below(9); return new Proxy(part, everyTrap(() => { if (left-- === 0) alter(part, how); })); } },
  { name: "behind a Proxy that changes the root", on: "object", put: (part, made, root) => { let left = below(6); const how = below(36); return new Proxy(part, everyTrap(() => { if (left-- === 0) alter(root(), how); })); } },
  { name: "behind a Proxy that changes another part", on: "object", put: (part, made) => { let left = below(6); const how = below(36); const which = below(16); return new Proxy(part, everyTrap(() => { if (left-- === 0) alter(made.parts[which % made.parts.length], how); })); } },
  { name: "with an accessor", on: "object", put: part => { const key = pick(keysOf(part)); const value = part[key]; return accessor(part, key, () => value); } },
  { name: "with an accessor for every key", on: "object", put: part => { for (const key of keysOf(part)) { const value = part[key]; accessor(part, key, () => value); } return part; } },
  { name: "with an accessor that answers otherwise the second time", on: "object", put: part => { const key = pick(keysOf(part)); const value = part[key]; const other = otherThan(value); let reads = 0; return accessor(part, key, () => (reads++ ? other : value)); } },
  { name: "with an accessor that answers rightly only the second time", on: "object", put: part => { const key = pick(keysOf(part)); const value = part[key]; const other = otherThan(value); let reads = 0; return accessor(part, key, () => (reads++ ? value : other)); } },
  { name: "with an accessor that changes its holder", on: "object", put: part => { const key = pick(keysOf(part)); const value = part[key]; const how = below(9); return accessor(part, key, () => (alter(part, how), value)); } },
  { name: "with an accessor that changes the root", on: "object", put: (part, _, root) => { const key = pick(keysOf(part)); const value = part[key]; const how = below(36); return accessor(part, key, () => (alter(root(), how), value)); } },
  { name: "with an accessor that changes another part", on: "object", put: (part, made) => { const key = pick(keysOf(part)); const value = part[key]; const how = below(36); const which = below(16); return accessor(part, key, () => (alter(made.parts[which % made.parts.length], how), value)); } },
  { name: "with an accessor that changes every part", on: "object", put: (part, made) => { const key = pick(keysOf(part)); const value = part[key]; const how = below(36); return accessor(part, key, () => { for (const other of made.parts) alter(other, how); return value; }); } },
  { name: "with an accessor that throws", on: "object", put: part => accessor(part, pick(keysOf(part)), () => { throw new Marker("thrown by an accessor"); }) },
  { name: "with an accessor that collects", on: "object", put: part => { const key = pick(keysOf(part)); const value = part[key]; return accessor(part, key, () => (Bun.gc(true), value)); } },
  { name: "with an accessor that validates the whole value again", on: "object", put: (part, _, root, again) => { const key = pick(keysOf(part)); const value = part[key]; let left = 2; return accessor(part, key, () => { if (left > 0) { left--; again(root()); } return value; }); } },
  { name: "with a setter alone", on: "object", put: part => (Object.defineProperty(part, pick(keysOf(part)), { set() {}, enumerable: true, configurable: true }), part) },
  { name: "with a hidden key", on: "object", put: part => (Object.defineProperty(part, pick(keysOf(part)), { enumerable: false }), part) },
  { name: "with a key that cannot be written", on: "object", put: part => (Object.defineProperty(part, pick(keysOf(part)), { writable: false }), part) },
  { name: "with a key that cannot be redefined", on: "object", put: part => (Object.defineProperty(part, pick(keysOf(part)), { configurable: false }), part) },
  { name: "with an inherited key", on: "object", put: part => { const key = pick(keysOf(part)); const value = part[key]; delete part[key]; return Object.setPrototypeOf(part, { [key]: value }); } },
  { name: "with every key inherited", on: "object", put: part => Object.create(part) },
  { name: "without a prototype", on: "object", put: part => Object.setPrototypeOf(part, null) },
  { name: "with another prototype", on: "object", put: part => Object.setPrototypeOf(part, { lent: 1, get also() { return 2; } }) },
  { name: "with a Proxy for a prototype", on: "object", put: part => Object.setPrototypeOf(part, new Proxy({}, everyTrap(() => {}))) },
  { name: "with a symbol for a key", on: "object", put: part => ((part[Symbol("more")] = 1), part) },
  { name: "with a well-known symbol for a key", on: "object", put: part => ((part[pick([Symbol.iterator, Symbol.toPrimitive, Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable])] = 1), part) },
  { name: "frozen", on: "object", put: part => Object.freeze(part) },
  { name: "sealed", on: "object", put: part => Object.seal(part) },
  { name: "closed", on: "object", put: part => Object.preventExtensions(part) },
  { name: "with many keys added and deleted", on: "object", put: part => { for (let i = 0; i < 100; i++) part["k" + i] = i; for (let i = 0; i < 100; i++) delete part["k" + i]; return part; } },
  { name: "with its first key deleted and added again", on: "object", put: part => { const key = keysOf(part)[0]; const value = part[key]; delete part[key]; part[key] = value; return part; } },
  { name: "with a key deleted", on: "object", put: part => (delete part[pick(keysOf(part))], part) },
  { name: "with many more keys", on: "object", put: part => { for (let i = 0; i < 70 + below(200); i++) part["k" + i] = i; return part; } },
  { name: "with an index for a key", on: "object", put: part => ((part[below(3)] = otherThan(1)), part) },
  { name: "with a far index for a key", on: "object", put: part => ((part[4000000000] = 1), part) },
  { name: "with a key called __proto__", on: "object", put: part => (Object.defineProperty(part, "__proto__", { value: otherThan(1), enumerable: true, writable: true, configurable: true }), part) },
  { name: "with a key called constructor", on: "object", put: part => ((part.constructor = otherThan(1)), part) },
  { name: "with a key that holds undefined", on: "object", put: part => ((part[pick(keysOf(part))] = undefined), part) },
  { name: "with one more key that holds undefined", on: "object", put: part => ((part[pick(["id", "name", "kind", "items", "count", "flag", "note", "tags", "inner", "value", "left", "right", "size"])] ??= undefined), part) },
  { name: "with the members of another thing", on: "object", put: part => give(carrier(below(22)), part) },
  { name: "with a private name", on: "object", put: part => { class Base { constructor(o: any) { return o; } } class Stamp extends Base { #mark = 1; static has(o: any) { return #mark in o; } } new Stamp(part); return part; } },
  { name: "from another realm", on: "object", put: part => { try { return runInNewContext("(" + JSON.stringify(part) + ")"); } catch { return part; } } },
  { name: "assigned to an object of another realm", on: "object", put: part => give(runInNewContext("({})"), part) },
  { name: "cloned", on: "object", put: part => { try { return structuredClone(part); } catch { return part; } } },
  { name: "parsed", on: "object", put: part => { try { return JSON.parse(JSON.stringify(part)); } catch { return part; } } },
  { name: "spread", on: "object", put: part => ({ ...part }) },
  { name: "made from entries", on: "object", put: part => Object.fromEntries(Object.entries(part)) },
  { name: "holding itself", on: "object", put: part => ((part[pick(keysOf(part))] = part), part) },
  { name: "holding the root", on: "object", put: (part, _, root) => accessor(part, pick(keysOf(part)), () => root()) },
  // arrays
  { name: "an array behind a Proxy", on: "array", put: part => new Proxy(part, {}) },
  { name: "an array behind a Proxy that forwards", on: "array", put: part => new Proxy(part, everyTrap(() => {})) },
  { name: "an array behind a Proxy with another length", on: "array", put: part => { const length = pick<any>([0, 1, part.length + 1, part.length - 1, part.length + 50, -1, NaN, "2", 1.5, 70000, undefined, null, {}, 1n]); return new Proxy(part, { get: (target, name, receiver) => (name === "length" ? length : Reflect.get(target, name, receiver)) }); } },
  { name: "an array behind a Proxy with another element", on: "array", put: part => { const index = String(below(part.length + 1)); const other = otherThan(part[0]); return new Proxy(part, { get: (target, name, receiver) => (name === index ? other : Reflect.get(target, name, receiver)) }); } },
  { name: "an array behind a Proxy that throws", on: "array", put: part => { let left = below(8); return new Proxy(part, everyTrap(() => { if (left-- === 0) throw new Marker("thrown by a trap"); })); } },
  { name: "an array behind a revoked Proxy", on: "array", put: part => { const { proxy, revoke } = Proxy.revocable(part, {}); revoke(); return proxy; } },
  { name: "an array behind a Proxy that revokes itself", on: "array", put: part => { let left = below(8); const { proxy, revoke } = Proxy.revocable(part, everyTrap(() => { if (left-- === 0) revoke(); })); return proxy; } },
  { name: "an array behind a Proxy that changes it", on: "array", put: part => { let left = below(8); const how = below(12); return new Proxy(part, everyTrap(() => { if (left-- === 0) alter(part, how); })); } },
  { name: "an array behind a Proxy that validates the whole value again", on: "array", put: (part, _, root, again) => { let left = 2; return new Proxy(part, everyTrap(() => { if (left > 0) { left--; again(root()); } })); } },
  { name: "an array with a hole", on: "array", put: part => (delete part[below(part.length + 1)], part) },
  { name: "an array that is longer than its elements", on: "array", put: part => ((part.length += 1 + below(5)), part) },
  { name: "an array with an element far out", on: "array", put: part => ((part[part.length + 30000] = part[0]), part) },
  { name: "an array with an accessor for an element", on: "array", put: part => { const index = below(part.length + 1); const value = part[index]; return accessor(part, index, () => value); } },
  { name: "an array with an accessor that answers otherwise the second time", on: "array", put: part => { const index = below(part.length + 1); const value = part[index]; const other = otherThan(value); let reads = 0; return accessor(part, index, () => (reads++ ? other : value)); } },
  { name: "an array with an accessor that changes it", on: "array", put: part => { const index = below(part.length + 1); const value = part[index]; const how = below(12); return accessor(part, index, () => (alter(part, how), value)); } },
  { name: "an array with an accessor that changes the root", on: "array", put: (part, _, root) => { const index = below(part.length + 1); const value = part[index]; const how = below(36); return accessor(part, index, () => (alter(root(), how), value)); } },
  { name: "an array with an accessor that changes every part", on: "array", put: (part, made) => { const index = below(part.length + 1); const value = part[index]; const how = below(36); return accessor(part, index, () => { for (const other of made.parts) alter(other, how); return value; }); } },
  { name: "an array with an accessor that throws", on: "array", put: part => accessor(part, below(part.length + 1), () => { throw new Marker("thrown by an accessor"); }) },
  { name: "an array with an accessor that collects", on: "array", put: part => { const index = below(part.length + 1); const value = part[index]; return accessor(part, index, () => (Bun.gc(true), value)); } },
  { name: "an array with an iterator of its own", on: "array", put: part => { const others = [otherThan(part[0]), ...part]; part[Symbol.iterator] = () => others[Symbol.iterator](); return part; } },
  { name: "an array with an iterator that gives nothing", on: "array", put: part => ((part[Symbol.iterator] = function* () {}), part) },
  { name: "an array with an iterator that changes it", on: "array", put: part => { const how = below(12); part[Symbol.iterator] = function* () { for (let i = 0; i < part.length; i++) { yield part[i]; if (i === 0) alter(part, how); } }; return part; } },
  { name: "an array with an iterator that throws", on: "array", put: part => ((part[Symbol.iterator] = () => { throw new Marker("thrown by an iterator"); }), part) },
  { name: "an array with no iterator", on: "array", put: part => ((part[Symbol.iterator] = undefined), part) },
  { name: "an array of a subclass", on: "array", put: part => { class Sub extends Array { static get [Symbol.species](): any { return Object; } } return Sub.from(part); } },
  { name: "an array of a subclass with an iterator of its own", on: "array", put: part => { const other = otherThan(part[0]); class Sub extends Array { *[Symbol.iterator](): any { yield other; } } return Sub.from({ length: part.length, ...part }); } },
  { name: "an array with a name", on: "array", put: part => ((part.more = 1), part) },
  { name: "an array with a symbol for a key", on: "array", put: part => ((part[Symbol("more")] = 1), part) },
  { name: "a frozen array", on: "array", put: part => Object.freeze(part) },
  { name: "a sealed array", on: "array", put: part => Object.seal(part) },
  { name: "a closed array", on: "array", put: part => Object.preventExtensions(part) },
  { name: "an array whose length cannot be written", on: "array", put: part => Object.defineProperty(part, "length", { writable: false }) },
  { name: "an array without a prototype", on: "array", put: part => Object.setPrototypeOf(part, null) },
  { name: "an array below Object.prototype", on: "array", put: part => Object.setPrototypeOf(part, Object.prototype) },
  { name: "an array with holes below a prototype that lends elements", on: "array", put: part => { const lender: any = Object.create(Array.prototype); const value = part[0]; for (let i = 0; i < 8; i++) lender[i] = value; part.length += 2; delete part[0]; return Object.setPrototypeOf(part, lender); } },
  { name: "an array with holes below a prototype that lends by accessors", on: "array", put: part => { const lender: any = Object.create(Array.prototype); const value = part[0]; const how = below(12); for (let i = 0; i < 8; i++) accessor(lender, i, () => (alter(part, how), value)); part.length += 2; delete part[0]; return Object.setPrototypeOf(part, lender); } },
  { name: "an array below a Proxy", on: "array", put: part => { part.length += 1; return Object.setPrototypeOf(part, new Proxy(Array.prototype, everyTrap(() => {}))); } },
  { name: "an array in another kind of storage", on: "array", put: part => storageOf(part, below(8)) },
  { name: "an array from another realm", on: "array", put: part => { try { return runInNewContext("(" + JSON.stringify(part) + ")"); } catch { return part; } } },
  { name: "an array of another realm with these elements", on: "array", put: part => { const made = runInNewContext("[]"); for (const item of part) made.push(item); return made; } },
  { name: "a cloned array", on: "array", put: part => { try { return structuredClone(part); } catch { return part; } } },
  { name: "an array that holds itself", on: "array", put: part => ((part[below(part.length + 1)] = part), part) },
  { name: "many times as long", on: "array", put: part => { if (part.length === 0) return part; const made: any[] = []; for (let i = 0; i < 3000; i++) made.push(rebuilt(part[i % part.length])); return made; } },
  { name: "what is like an array", on: "array", put: part => pick<() => any>([() => ({ length: part.length, ...part }), () => (function (..._: any[]) { return arguments; })(...part), () => new Set(part), () => Uint8Array.from(part.map(Number)), () => Float64Array.from(part.map(Number)), () => part[Symbol.iterator](), () => Object.assign(Object.create(Array.prototype), { length: part.length, ...part }), () => part.join()])() },
  // leaves
  { name: "another value", on: "leaf", put: part => otherThan(part) },
  { name: "any value", on: "any", put: () => pick(junk()) },
  { name: "text in pieces", on: "leaf", put: part => (typeof part === "string" && part.length > 1 ? part.slice(0, 1) + part.slice(1) : part) },
  { name: "text cut out of a longer one", on: "leaf", put: part => (typeof part === "string" ? ("<<<<<<<<<<<<<<<<<<<<" + part + ">>>>>>>>>>>>>>>>>>>>").slice(20, 20 + part.length) : part) },
  { name: "text in wide characters", on: "leaf", put: part => (typeof part === "string" ? (part + "Ā").slice(0, -1) : part) },
  { name: "text decoded from bytes", on: "leaf", put: part => (typeof part === "string" && part.isWellFormed() ? new TextDecoder().decode(new TextEncoder().encode(part)) : part) },
  { name: "text that has been a key", on: "leaf", put: part => (typeof part === "string" ? Object.keys({ [part]: 1 })[0] : part) },
  { name: "a very long text in pieces", on: "leaf", put: part => { if (typeof part !== "string") return part; let text = part; for (let i = 0; i < 12; i++) text = text + text + "x"; return text; } },
  { name: "a number computed as a fraction", on: "leaf", put: part => (typeof part === "number" ? (part + 0.5) - 0.5 : part) },
  { name: "a number read from a Float64Array", on: "leaf", put: part => (typeof part === "number" ? new Float64Array([part])[0] : part) },
  { name: "a number a little off", on: "leaf", put: part => (typeof part === "number" ? part + pick([1, -1, 0.5, -0.5, 100, -100, 1e-9, 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53]) : part) },
  { name: "not a number with other bits", on: "leaf", put: part => (typeof part === "number" ? new Float64Array(new BigUint64Array([pick([0x7ff8000000000001n, 0xfff8000000000000n, 0xfffe000000000002n, 0xffffffffffffffffn, 0x7ff0000000000001n, 0xfffe00000000000an])]).buffer)[0] : part) },
  { name: "boxed", on: "leaf", put: part => (part === null || part === undefined ? part : Object(part)) },
];

// ---- the runs
let pairs = 0, accepted = 0, refused = 0, threw = 0, failures = 0, refusedWhereATrapThrew = 0;
const oneIn = Number(process.argv[2] ?? 1), choice = Number(process.argv[3] ?? 1);
const only = process.argv[4];
const times = new Map<string, number>();
function fail(what: string, where: string, got: string, wanted: string): void {
  if (failures++ < 40) console.log("DOES NOT HOLD:", what, "|", where, "|", got.slice(0, 400), "|", wanted.slice(0, 400));
}
function make(one: Case, sample: number, isRebuilt: boolean, path: Path, dress: Dress, seed: number, again: (value: any) => void): Made {
  reseed(seed);
  junkOfThisValue = undefined;
  let root: any = one.samples[sample]();
  if (isRebuilt) root = rebuilt(root);
  const made: Made = { value: undefined, parts: [] };
  collectParts(root, made.parts);
  let holder: any, part = root;
  for (const key of path) { holder = part; part = part[key]; }
  const dressed = dress.put(part, made, () => made.value, again);
  if (path.length === 0) root = dressed; else holder[path[path.length - 1]] = dressed;
  made.value = root;
  if (isObject(dressed) && !made.parts.includes(dressed)) made.parts.push(dressed);
  return made;
}
type Answer = { kind: "accepted" | "refused" | "threw"; text: string; value?: any };
function attempt(run: () => any): Answer {
  try {
    const value = run();
    return { kind: "accepted", text: "", value };
  } catch (error: any) {
    if (error instanceof TypeError && Object.prototype.hasOwnProperty.call(error, "issues")) return { kind: "refused", text: "" };
    return { kind: "threw", text: error instanceof Marker ? error.message : Object.prototype.toString.call(error) + (error?.constructor?.name ?? "") };
  }
}
function scramble(made: Made): void {
  for (let i = 0; i < made.parts.length; i++) { alter(made.parts[i], 1); alter(made.parts[i], 6); alter(made.parts[i], 0); }
}
for (const one of cases) {
  if (only !== undefined && only !== "" && one.name !== only) continue;
  for (let sample = 0; sample < one.samples.length; sample++) {
    for (const isRebuilt of [false, true]) {
      const found: Path[] = [];
      pathsOf(one.samples[sample](), [], found);
      for (const path of found) {
        let part: any = one.samples[sample]();
        for (const key of path) part = part[key];
        const kind = Array.isArray(part) ? "array" : isObject(part) ? "object" : "leaf";
        for (let which = 0; which < dresses.length; which++) {
          const dress = dresses[which];
          if (dress.on !== "any" && dress.on !== kind) continue;
          if (kind === "object" && dress.on === "object" && Object.keys(part).length === 0 && /key|accessor|setter|answers|holding/.test(dress.name)) continue;
          const turns = /another value|any value|changes|a little off|members of another|storage|like an array|another length/.test(dress.name) ? 6 : 1;
          for (let turn = 0; turn < turns; turn++) {
            const seed = Math.imul(pairs + 1, 2654435761) ^ choice;
            pairs++;
            if (oneIn > 1 && (Math.imul(seed, 40503) >>> 8) % oneIn !== 0) continue;
            const where = one.name + " sample " + sample + (isRebuilt ? " rebuilt" : "") + " at " + JSON.stringify(path) + " " + dress.name + " seed " + seed;
            if (process.env.SAY_EACH) console.log(where);
            const startedAt = process.env.SAY_TIMES ? performance.now() : 0;

            // The slow checker, on a value of its own.
            const judge = new Judge();
            let isUnderWay = true;
            const judged = make(one, sample, isRebuilt, path, dress, seed, value => { if (isUnderWay) try { new Judge().accepts(one.d, [value], 0); } catch {} });
            const holder = [judged.value];
            const verdict = attempt(() => { if (!judge.accepts(one.d, holder, 0)) throw Object.assign(new TypeError("refused"), { issues: [] }); return holder[0]; });
            isUnderWay = false;
            const wanted = verdict.kind === "accepted" ? expected(one.d, verdict.value) : undefined;

            if (process.env.SAY_EACH) console.log("  the checker:", verdict.kind);
            // Validated and handed out.
            let isTaken = false;
            const first = make(one, sample, isRebuilt, path, dress, seed, value => { if (!isTaken) try { one.take(value); } catch {} });
            const answer = attempt(() => one.take(first.value));
            isTaken = true;
            if (answer.kind === "accepted") accepted++; else if (answer.kind === "refused") refused++; else threw++;
            if ((answer.kind === "accepted") !== (verdict.kind === "accepted")) fail("the checker says " + verdict.kind + " " + verdict.text, where, answer.kind + " " + answer.text + " " + (answer.kind === "accepted" ? show(answer.value) : ""), wanted === undefined ? "" : show(wanted));
            else if (answer.kind !== verdict.kind) refusedWhereATrapThrew++;
            if (answer.kind === "accepted") {
              problems.length = 0;
              const seen = look(one.d, answer.value, new Set(first.parts), "it");
              if (problems.length) fail("what was accepted is plain data of its own", where, problems.join("; "), "");
              const again = [seen];
              let isStillAccepted = false;
              try { isStillAccepted = new Judge().accepts(one.d, [rebuiltAsSeen(seen)], 0); } catch {}
              if (!isStillAccepted) fail("what was accepted is a T", where, show(seen), "");
              if (wanted !== undefined && show(seen) !== show(wanted)) fail("what was accepted is what a copy of the value holds", where, show(seen), show(wanted));
              const out: string[] = [];
              let untyped = "";
              try { digest(one.d, seen, out); untyped = out.join(" "); } catch (error) { untyped = "the untyped reader threw " + error; }
              let typed = "";
              try { typed = one.read(); } catch (error) { typed = "the typed reader threw " + error; }
              if (typed !== untyped) fail("typed code reads what untyped code reads", where, typed, untyped);
              scramble(first);
              let afterwards = "";
              try { afterwards = one.read(); } catch (error) { afterwards = "the typed reader threw " + error; }
              if (afterwards !== typed) fail("what happens to the value afterwards does not reach the copy", where, afterwards, typed);
              try { one.change(); change(resolve(one.d), seen); out.length = 0; digest(one.d, seen, out); untyped = out.join(" "); typed = one.read(); } catch (error) { typed = "a writer or a reader threw " + error; }
              if (typed !== untyped) fail("typed code writes what untyped code writes", where, typed, untyped);
            }

            if (process.env.SAY_EACH) console.log("  handed out:", answer.kind);
            // Validated, read and written by typed code alone.
            let isDone = false;
            const second = make(one, sample, isRebuilt, path, dress, seed, value => { if (!isDone) try { one.alone(value); } catch {} });
            const alone = attempt(() => one.alone(second.value));
            isDone = true;
            if ((alone.kind === "accepted") !== (verdict.kind === "accepted")) fail("kept to typed code, the checker says " + verdict.kind, where, alone.kind + " " + alone.text, "");
            else if (alone.kind === "accepted") {
              let untyped = "";
              try { untyped = digestBeforeAndAfter(one.d, wanted); } catch (error) { untyped = "the untyped reader threw " + error; }
              if (alone.value !== untyped) fail("kept to typed code, it reads and writes what untyped code does", where, alone.value, untyped);
            }
            if (process.env.SAY_TIMES) times.set(dress.name, (times.get(dress.name) ?? 0) + performance.now() - startedAt);
          }
        }
      }
    }
  }
}
// What stood where nothing is described is known by its kind alone. The checker takes anything there but for "object".
function rebuiltAsSeen(seen: any): any {
  if (!isObject(seen)) return seen;
  if (!Array.isArray(seen) && "(as it came)" in seen) return seen["(as it came)"] === "object" || seen["(as it came)"] === "function" ? {} : undefined;
  const copy: any = Array.isArray(seen) ? [] : {};
  for (const key of Reflect.ownKeys(seen)) { if (Array.isArray(seen) && key === "length") continue; Object.defineProperty(copy, key, { value: rebuiltAsSeen(seen[key]), writable: true, enumerable: true, configurable: true }); }
  return copy;
}
if (process.env.SAY_TIMES) for (const [name, time] of [...times].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(Math.round(time), "ms", name);
console.log("dressed samples", pairs, "accepted", accepted, "refused", refused, "threw", threw, "refused where the checker met a throw or the other way round", refusedWhereATrapThrew, "answers that do not hold", failures);
`;


if (import.meta.main) process.stdout.write(program(Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 20)));

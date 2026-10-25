// Writes a TypeScript program that hands values to `validate<T>(value)` and texts to `JSON.parse<T>(text)` where T is full of unions that no tag tells apart.
//
//   types      unions of object types without a tag: a later member says less ({}, { b?: string }, { a: unknown }, Record<string, unknown>, object), members share names with other types, some names are those that every object inherits, indices or __proto__, one member is another with a name
//              more or less, members are alike but for the last leaf far down, two members have the same tag, a tag is optional, a union of literals or a plain string; unions of lists and tuples; all of these
//              below lists, tuples, records, optional members and intersections, and in types that refer to themselves
//   values     made while the program runs, from the description of the type: a sample of one member, a sample of one member with parts of another laid over it, and either of them with one place spoiled:
//              often the last place, so that a member of the union refuses late. Where the type says `unknown` or `object`, or nothing, there are also dates, maps, functions, instances and very long empty lists
//   dressed    as it is, frozen, sealed, without a prototype, with accessors, behind proxies, with holes for undefined, in sparse storage, as a subclass of Array, with a name on a list, with a symbol among the keys, one part in two places;
//              and as text, plainly spelled and with every name escaped
//
// The program judges each answer by the value itself. It has a predicate, written from the documentation, that looks at the value and copies nothing, and it prints a line for each answer that does not hold:
//   the value is accepted if and only if the predicate says so   .   what comes back has, wherever the accepting member describes it, new objects and lists with the members of the value in their order
//   wherever it does not, the very object that went in   .   no new object is in two places   .   no member, element or length is read twice in one place   .   nothing but a TypeError with issues or a RangeError is thrown
// and a last line with the totals.
//
//   bun test/aot/fuzz/unions-handed-to-validate.ts <seed> <number of types>     prints the program; the program takes [values for each type] [seed of the values] [only this type]
import { Random } from "./random";

type Description =
  | { k: "string"; min?: number; max?: number; pattern?: string }
  | { k: "number"; int?: boolean; min?: number; max?: number }
  | { k: "boolean" | "null" | "undefined" | "unknown" | "anyobject" }
  | { k: "literal"; v: string | number | boolean }
  | { k: "array"; e: Description; min?: number; max?: number }
  | { k: "tuple"; es: Description[] }
  | { k: "record"; e: Description }
  | { k: "object"; ms: Member[]; strict?: boolean; index?: Description }
  | { k: "union"; arms: Description[]; text?: string }
  | { k: "ref"; to: string };
type Member = { key: string; optional: boolean; d: Description };
type ObjectDescription = Description & { k: "object" };

function render(d: Description): string {
  switch (d.k) {
    case "string": {
      const rules = [d.min !== undefined && `Schema.MinLength<${d.min}>`, d.max !== undefined && `Schema.MaxLength<${d.max}>`, d.pattern !== undefined && `Schema.Pattern<${JSON.stringify(d.pattern)}>`].filter(Boolean);
      return rules.length ? `(string & ${rules.join(" & ")})` : "string";
    }
    case "number": {
      const rules = [d.int && "Schema.Int", d.min !== undefined && `Schema.Min<${d.min}>`, d.max !== undefined && `Schema.Max<${d.max}>`].filter(Boolean);
      return rules.length ? `(number & ${rules.join(" & ")})` : "number";
    }
    case "anyobject":
      return "object";
    case "literal":
      return JSON.stringify(d.v);
    case "array": {
      const rules = [d.min !== undefined && `Schema.MinItems<${d.min}>`, d.max !== undefined && `Schema.MaxItems<${d.max}>`].filter(Boolean);
      return rules.length ? `(${render(d.e)}[] & ${rules.join(" & ")})` : `${render(d.e)}[]`;
    }
    case "tuple":
      return `[${d.es.map(render).join(", ")}]`;
    case "record":
      return `Record<string, ${render(d.e)}>`;
    case "object": {
      const written = d.ms.map(({ key, optional, d: held }) => `${/^[a-z]+$/.test(key) ? key : JSON.stringify(key)}${optional ? "?" : ""}: ${render(held)}; `).join("") + (d.index ? `[key: string]: ${render(d.index)}; ` : "");
      return d.strict ? `({ ${written}} & Schema.Strict)` : written ? `{ ${written}}` : "{}";
    }
    case "union":
      return d.text ?? `(${d.arms.map(render).join(" | ")})`;
    case "ref":
      return d.to;
    default:
      return d.k;
  }
}

const copyOf = <T>(d: T): T => JSON.parse(JSON.stringify(d));
const oddNames = ["__proto__", "constructor", "toString", "hasOwnProperty", "length", "0", "7", "then"];

class Types {
  constructor(private random: Random) {}

  leaf(): Description {
    const random = this.random;
    return random.weighted<() => Description>([
      [20, () => ({ k: "number" })],
      [6, () => ({ k: "number", int: true })],
      [5, () => ({ k: "number", min: random.between(-2, 2), max: random.between(3, 9) })],
      [20, () => ({ k: "string" })],
      [4, () => ({ k: "string", min: random.between(1, 2) })],
      [3, () => ({ k: "string", max: random.between(1, 3) })],
      [3, () => ({ k: "string", pattern: "^[a-c]*$" })],
      [10, () => ({ k: "boolean" })],
      [6, () => ({ k: "null" })],
      [10, () => ({ k: "literal", v: random.pick(["x", "y", "", 0, 1, 2, true, false]) })],
    ])();
  }

  sayingLittle(): Description {
    const random = this.random;
    return random.weighted<() => Description>([
      [5, () => ({ k: "object", ms: [] })],
      [3, () => ({ k: "object", ms: [{ key: random.pick(["a", "b", "c", "d"]), optional: true, d: this.leaf() }] })],
      [3, () => ({ k: "object", ms: [{ key: random.pick(["a", "b", "c"]), optional: random.chance(0.3), d: { k: random.pick(["unknown", "anyobject"]) } }] })],
      [3, () => ({ k: "record", e: { k: "unknown" } })],
      [2, () => ({ k: "object", ms: [], index: { k: "unknown" } })],
      [2, () => ({ k: "anyobject" })],
    ])();
  }

  object(depth: number, keys = ["a", "b", "c", "d"]): ObjectDescription {
    const random = this.random;
    const ms = random.sample(keys, random.between(1, Math.min(4, keys.length))).map(key => ({ key, optional: random.chance(0.25), d: this.any(depth - 1) }));
    if (random.chance(0.12)) ms[random.below(ms.length)].key = random.pick(oddNames);
    if (random.chance(0.1)) return { k: "object", ms, strict: true };
    if (random.chance(0.08)) return { k: "object", ms, index: { k: "unknown" } };
    return { k: "object", ms };
  }

  list(e: Description): Description {
    const random = this.random;
    const d: Description = { k: "array", e };
    if (random.chance(0.15)) d.min = random.between(1, 3);
    if (random.chance(0.15)) d.max = (d.min ?? 0) + random.between(0, 2);
    return d;
  }

  // The last leaf in the order in which the parts are written.
  withAnotherLastLeaf(d: Description): Description {
    const changed = copyOf(d);
    let at: Description = changed;
    for (;;) {
      const next: Description | undefined = at.k === "object" ? at.ms.at(-1)?.d : at.k === "array" || at.k === "record" ? at.e : at.k === "tuple" ? at.es.at(-1) : at.k === "union" && !at.text ? at.arms.at(-1) : undefined;
      if (next === undefined) break;
      if (next.k !== "object" && next.k !== "array" && next.k !== "record" && next.k !== "tuple" && next.k !== "union") {
        let other = this.leaf();
        while (JSON.stringify(other) === JSON.stringify(next)) other = this.leaf();
        for (const key of Object.keys(next)) delete (next as any)[key];
        Object.assign(next, other);
        break;
      }
      at = next;
    }
    return changed;
  }

  union(depth: number): Description {
    const random = this.random;
    const arms = random.weighted<() => Description[]>([
      [16, () => [...Array.from({ length: random.between(1, 2) }, () => this.object(depth)), this.sayingLittle()]],
      [16, () => Array.from({ length: random.between(2, 4) }, () => this.object(depth, ["a", "b", "c"]))],
      [14, () => {
        const first = this.object(depth + 1);
        return [first, ...Array.from({ length: random.between(1, 2) }, () => this.withAnotherLastLeaf(first))];
      }],
      [12, () => {
        const whole = this.object(depth);
        const part = copyOf(whole);
        if (part.ms.length > 1) part.ms.splice(random.below(part.ms.length), 1);
        else part.ms.push({ key: "e", optional: false, d: this.leaf() });
        if (random.chance(0.3)) part.strict = !part.index;
        return random.shuffled([whole, part]);
      }],
      [14, () => {
        const tags = random.pick<Description[]>([
          [{ k: "literal", v: "x" }, { k: "literal", v: "x" }, { k: "literal", v: "y" }],
          [{ k: "literal", v: "x" }, { k: "union", arms: [{ k: "literal", v: "x" }, { k: "literal", v: "y" }] }],
          [{ k: "literal", v: "x" }, { k: "string" }],
          [{ k: "literal", v: 1 }, { k: "literal", v: 2 }, { k: "number" }],
          [{ k: "literal", v: true }, { k: "literal", v: false }, { k: "literal", v: true }],
          [{ k: "literal", v: "x" }, { k: "literal", v: "y" }],
        ]);
        const tagged: Description[] = tags.map(tag => {
          const arm = this.object(depth, ["a", "b", "c"]);
          arm.ms.splice(random.below(arm.ms.length + 1), 0, { key: "kind", optional: random.chance(0.12), d: tag });
          return arm;
        });
        if (random.chance(0.4)) tagged.splice(random.below(tagged.length + 1), 0, random.chance(0.5) ? this.sayingLittle() : this.object(depth, ["a", "b", "c"]));
        return tagged;
      }],
      [12, () => random.shuffled<Description>([this.list(this.any(depth - 1)), this.list(this.any(depth - 1)), ...(random.chance(0.5) ? [{ k: "tuple", es: Array.from({ length: random.between(1, 3) }, () => this.any(depth - 1)) } as Description] : [])])],
      [10, () => random.sample<Description>([this.leaf(), this.leaf(), { k: "undefined" }, this.list(this.any(depth - 1)), this.object(depth), this.object(depth), { k: "record", e: this.any(depth - 1) }, this.sayingLittle()], random.between(2, 4))],
    ])();
    const union: Description = { k: "union", arms };
    if (!random.chance(0.12) || !arms.every(arm => arm.k === "object" && !arm.strict && !arm.index)) return union;
    const more: Member = { key: "z", optional: random.chance(0.3), d: this.leaf() };
    return { k: "union", arms: arms.map(arm => ({ ...(arm as ObjectDescription), ms: [...(arm as ObjectDescription).ms, more] })), text: `(${render(union)} & ${render({ k: "object", ms: [more] })})` };
  }

  any(depth: number): Description {
    const random = this.random;
    if (depth <= 0) return random.chance(0.12) ? { k: random.pick(["unknown", "anyobject"]) } : this.leaf();
    return random.weighted<() => Description>([
      [22, () => this.leaf()],
      [12, () => this.object(depth)],
      [12, () => this.list(this.any(depth - 1))],
      [5, () => ({ k: "tuple", es: Array.from({ length: random.between(1, 3) }, () => this.any(depth - 1)) })],
      [6, () => ({ k: "record", e: this.any(depth - 1) })],
      [43, () => this.union(depth - 1)],
    ])();
  }

  // A type that refers to itself in more than one member of a union.
  recursive(name: string): Description {
    const random = this.random;
    const self: Description = { k: "ref", to: name };
    const below = (): Member => random.pick<() => Member>([
      () => ({ key: "next", optional: true, d: self }),
      () => ({ key: "next", optional: false, d: { k: "union", arms: [self, { k: "null" }] } }),
      () => ({ key: "all", optional: false, d: { k: "array", e: self } }),
      () => ({ key: "by", optional: true, d: { k: "record", e: self } }),
    ])();
    const arms: Description[] = Array.from({ length: random.between(2, 3) }, () => ({ k: "object", ms: random.shuffled<Member>([{ key: "v", optional: false, d: this.any(1) }, below(), ...(random.chance(0.4) ? [below()] : [])].filter((m, i, all) => all.findIndex(o => o.key === m.key) === i)) }));
    if (random.chance(0.5)) arms.push(this.sayingLittle());
    return { k: "union", arms };
  }
}

export function program(seed: number, count: number): string {
  const random = new Random(seed);
  const types = new Types(random);
  const declared: string[] = [];
  const cases: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = "T" + i;
    const d = random.chance(0.12) ? types.recursive(name) : random.chance(0.75) ? types.union(random.between(1, 2)) : types.any(3);
    declared.push(`type ${name} = ${render(d)};`);
    cases.push(`  { name: ${JSON.stringify(name)}, d: ${JSON.stringify(d)}, take: value => validate<${name}>(value), parse: text => Typed.parse<${name}>(text) },`);
  }
  return `// Seed ${seed}, ${count} types. Written by test/aot/fuzz/unions-handed-to-validate.ts.
import { validate } from "bun:bundle";
import { JSON as Typed, type Schema } from "bun";
${declared.join("\n")}
type D = any;
type Case = { name: string; d: D; take: (value: unknown) => unknown; parse: (text: string) => unknown };
const cases: Case[] = [
${cases.join("\n")}
];
${harness}`;
}

const harness = String.raw`
const byName: Record<string, D> = {};
for (const one of cases) byName[one.name] = one.d;
const resolve = (d: D): D => (d.k === "ref" ? byName[d.to] : d);

let state = 1;
function next(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
const below = (limit: number): number => next() % limit;
const chance = (p: number): boolean => next() < p * 4294967296;
const pick = <T,>(from: readonly T[]): T => from[below(from.length)];

const isObject = (v: any): boolean => (typeof v === "object" && v !== null) || typeof v === "function";
const isOwn = (v: any, key: PropertyKey): boolean => Object.prototype.propertyIsEnumerable.call(v, key);
const put = (o: any, key: PropertyKey, v: any): void => { Object.defineProperty(o, key, { value: v, writable: true, enumerable: true, configurable: true }); };
const countCharacters = (text: string): number => { let n = 0; for (const _ of text) n++; return n; };

// ---- What the documentation says, asked of the value itself. Nothing is copied and nothing is remembered.
class Unsure extends Error {}
// One way to dress a value gives every object a symbol among its enumerable keys: a type that takes no undeclared key refuses it, any other type leaves it out of the copy.
let everyObjectHasASymbol = false;
// An object type matches plain objects. Of a date, a map, a function or an instance the documentation says only that it is none: the predicate answers where a name that has to be there is missing, and else gives no answer.
function isPlain(d: D, v: any): boolean {
  if (!isObject(v) || Array.isArray(v)) return false;
  const prototype = Object.getPrototypeOf(v);
  if (typeof v !== "function" && (prototype === Object.prototype || prototype === null)) return true;
  if (d.k === "object" && d.ms.some((m: any) => !m.optional && !isOwn(v, m.key))) return false;
  throw new Unsure();
}
function accepts(described: D, v: any): boolean {
  const d = resolve(described);
  switch (d.k) {
    case "unknown": return true;
    case "anyobject": return isObject(v);
    case "undefined": return v === undefined;
    case "null": return v === null;
    case "boolean": return typeof v === "boolean";
    case "literal": return v === d.v;
    case "string": return typeof v === "string" && (d.min === undefined || countCharacters(v) >= d.min) && (d.max === undefined || countCharacters(v) <= d.max) && (d.pattern === undefined || new RegExp(d.pattern).test(v));
    case "number": return typeof v === "number" && Number.isFinite(v) && (!d.int || Number.isInteger(v)) && (d.min === undefined || v >= d.min) && (d.max === undefined || v <= d.max);
    case "array": {
      if (!Array.isArray(v) || (d.min !== undefined && v.length < d.min) || (d.max !== undefined && v.length > d.max)) return false;
      if (v.length > 100000) throw new Unsure();
      for (let i = 0; i < v.length; i++) if (!accepts(d.e, v[i])) return false;
      return true;
    }
    case "tuple": return Array.isArray(v) && v.length === d.es.length && d.es.every((e: D, i: number) => accepts(e, v[i]));
    case "record": return isPlain(d, v) && Object.keys(v).every(key => accepts(d.e, v[key]));
    case "object": {
      if (!isPlain(d, v)) return false;
      if (d.strict && everyObjectHasASymbol) return false;
      for (const m of d.ms) {
        if (!isOwn(v, m.key)) { if (m.optional) continue; return false; }
        if (!(m.optional && v[m.key] === undefined) && !accepts(m.d, v[m.key])) return false;
      }
      if (!d.strict && !d.index) return true;
      return Object.keys(v).every(key => d.ms.some((m: any) => m.key === key) || (!d.strict && accepts(d.index, v[key])));
    }
    case "union": {
      // A member that gives no answer leaves the union without one, unless another member takes the value.
      let unsure = false;
      for (const arm of d.arms) { try { if (accepts(arm, v)) return true; } catch (e) { if (!(e instanceof Unsure)) throw e; unsure = true; } }
      if (unsure) throw new Unsure();
      return false;
    }
  }
  throw new Error("no such description " + d.k);
}

// Is r what comes back for v? image: the object that stands for a part of v in the value that was handed in; undefined where a text was handed in, and what the type does not describe is compared by its members.
type Image = ((part: any) => any) | undefined;
function alike(a: any, b: any): boolean {
  if (!isObject(a) || !isObject(b)) return Object.is(a, b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a), others = Object.keys(b);
  return keys.length === others.length && keys.every((key, i) => others[i] === key && alike(a[key], b[key]));
}
function isNewList(r: any, length: number): boolean {
  return Array.isArray(r) && Object.getPrototypeOf(r) === Array.prototype && r.length === length && Reflect.ownKeys(r).length === length + 1;
}
function hasKeysOf(r: any, v: any): boolean {
  if (!isObject(r) || Array.isArray(r) || Object.getPrototypeOf(r) !== Object.prototype) return false;
  const keys = Object.keys(v), others = Reflect.ownKeys(r);
  return keys.length === others.length && keys.every((key, i) => others[i] === key && "value" in Object.getOwnPropertyDescriptor(r, key)!);
}
function agrees(described: D, v: any, r: any, image: Image): boolean {
  const d = resolve(described);
  switch (d.k) {
    case "unknown":
    case "anyobject":
      return !isObject(v) ? Object.is(r, v) : image ? r === image(v) : alike(v, r);
    case "array": return isNewList(r, v.length) && r.every((item: any, i: number) => agrees(d.e, v[i], item, image));
    case "tuple": return isNewList(r, v.length) && r.every((item: any, i: number) => agrees(d.es[i], v[i], item, image));
    case "record": return hasKeysOf(r, v) && Object.keys(v).every(key => agrees(d.e, v[key], r[key], image));
    case "object":
      return hasKeysOf(r, v) && Object.keys(v).every(key => {
        const m = d.ms.find((m: any) => m.key === key);
        if (m) return m.optional && v[key] === undefined ? r[key] === undefined : agrees(m.d, v[key], r[key], image);
        return agrees(d.index ?? { k: "unknown" }, v[key], r[key], image);
      });
    case "union": {
      let unsure = false;
      for (const arm of d.arms) { try { if (accepts(arm, v) && agrees(arm, v, r, image)) return true; } catch (e) { if (!(e instanceof Unsure)) throw e; unsure = true; } }
      if (unsure) throw new Unsure();
      return false;
    }
    default: return Object.is(r, v);
  }
}

// ---- Values
class Instance { x = 1; method() { return 2; } }
const strange: (() => any)[] = [() => new Date(5), () => new Map([[1, 2]]), () => new Set([1]), () => /x/g, () => new Instance(), () => function named() {}, () => new Uint8Array(2), () => Object.assign([], { length: 4294967295 }), () => Object.assign([1, "x"], { length: 70000 }), () => new Error("e"), () => Symbol.for("s"), () => 10n];
const plainThings: (() => any)[] = [() => 1, () => "u", () => null, () => true, () => [1, "x", 3], () => ({ b: 1 }), () => ({ a: [1, "x"], q: { b: "x" } }), () => [], () => ({}), () => [[1], ["x"]], () => undefined];
const junk: (() => any)[] = [() => undefined, () => null, () => true, () => false, () => 0, () => -0, () => 1, () => 2, () => 1.5, () => -3, () => NaN, () => Infinity, () => 1e21, () => "", () => "x", () => "y", () => "abc", () => "zzzz", () => "1", () => [], () => [1], () => ["x"], () => [1, "x"], () => [[1]], () => ({}), () => ({ a: 1 }), () => ({ a: "x" }), () => ({ b: [1] }), () => ({ kind: "x" }), () => ({ kind: "y", a: 1 }), () => [undefined], () => [null]];
let mayBeStrange = true;
const anything = (): any => (mayBeStrange && chance(0.35) ? pick(strange)() : pick(plainThings)());
const letters = ["a", "b", "c", "x", "é", "𝒳", " "];
function sample(described: D, fuel: number): any {
  const d = resolve(described);
  switch (d.k) {
    case "unknown": return anything();
    case "anyobject": for (;;) { const v = anything(); if (isObject(v)) return v; }
    case "undefined": return undefined;
    case "null": return null;
    case "boolean": return chance(0.5);
    case "literal": return d.v;
    case "string": {
      const from = d.pattern ? ["a", "b", "c"] : letters;
      const low = d.min ?? 0, high = d.max ?? low + 3;
      return Array.from({ length: low + below(high - low + 1) }, () => pick(from)).join("");
    }
    case "number": {
      const low = d.min ?? -9, high = d.max ?? 9;
      const n = low + below(high - low + 1);
      return d.int || chance(0.6) || n + 0.5 > high ? n : n + 0.5;
    }
    case "array": {
      const low = d.min ?? 0, high = d.max ?? low + (fuel > 0 ? 4 : 0);
      return Array.from({ length: low + below(high - low + 1) }, () => sample(d.e, fuel - 1));
    }
    case "tuple": return d.es.map((e: D) => sample(e, fuel - 1));
    case "record": {
      const o: any = {};
      for (const key of ["a", "b", "k-1", "z"]) if (fuel > 0 && chance(0.4)) put(o, key, sample(d.e, fuel - 1));
      for (const key of ["__proto__", "7", "constructor", "0"]) if (fuel > 0 && chance(0.06)) put(o, key, sample(d.e, fuel - 1));
      return o;
    }
    case "object": {
      const o: any = {};
      const ms = chance(0.25) ? [...d.ms].reverse() : d.ms;
      for (const m of ms) {
        if (m.optional && (fuel <= 0 || chance(0.4))) continue;
        put(o, m.key, m.optional && chance(0.06) ? undefined : sample(m.d, fuel - 1));
      }
      if (!d.strict) for (const key of ["a", "b", "c", "d", "kind", "other", "__proto__", "constructor", "toString", "3", "length"]) if (!isOwn(o, key) && !d.ms.some((m: any) => m.key === key) && chance(key.length > 5 || key === "3" ? 0.03 : 0.12)) put(o, key, d.index ? sample(d.index, fuel - 1) : chance(0.5) ? anything() : pick(junk)());
      return o;
    }
    case "union": {
      const arms = fuel > 0 ? d.arms : d.arms.filter((arm: D) => !JSON.stringify(arm).includes('"ref"'));
      return sample(pick(arms.length ? arms : d.arms), fuel - 1);
    }
  }
}
type Path = PropertyKey[];
const isLong = (v: any): boolean => Array.isArray(v) && v.length > 1000;
function pathsOf(v: any, at: Path, found: Path[], seen: Set<object>): void {
  found.push(at);
  if (!isObject(v) || seen.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) || isLong(v)) return;
  seen.add(v);
  for (const key of Object.keys(v)) pathsOf(v[key], [...at, key], found, seen);
}
function spoil(root: any): any {
  const paths: Path[] = [];
  pathsOf(root, [], paths, new Set());
  const path = chance(0.45) ? paths[paths.length - 1] : pick(paths);
  if (path.length === 0) return pick(junk)();
  let holder = root;
  for (const key of path.slice(0, -1)) holder = holder[key];
  const key = path[path.length - 1];
  switch (below(Array.isArray(holder) ? 8 : 7)) {
    case 0: if (Array.isArray(holder)) holder.splice(Number(key), 1); else delete holder[key]; break;
    case 1: put(holder, Array.isArray(holder) ? holder.length : pick(["a", "b", "c", "d", "e", "kind", "z", "next", "__proto__", "constructor", "0"]), pick(junk)()); break;
    case 7: holder.length = below(holder.length + 1); break;
    default: put(holder, key, pick(junk)());
  }
  return root;
}
// A sample of one member of a union with parts of a sample of another laid over it.
function mixed(d: D): any {
  const first = sample(d, 3), second = sample(d, 3);
  if (!isObject(first) || !isObject(second) || Array.isArray(first) !== Array.isArray(second) || Object.getPrototypeOf(first) !== Object.getPrototypeOf(second) || isLong(first) || isLong(second)) return first;
  for (const key of Object.keys(second)) if (chance(0.5)) put(first, key, second[key]);
  return first;
}
function make(d: D, seed: number): any {
  state = seed;
  const how = below(10);
  let v = how < 3 ? sample(d, 3) : how < 5 ? mixed(d) : how < 9 ? spoil(chance(0.3) ? mixed(d) : sample(d, 3)) : spoil(spoil(sample(d, 3)));
  isInTwoPlaces = false;
  if (chance(0.1)) v = shareOnePart(v);
  return v;
}
let isInTwoPlaces = false;
function shareOnePart(root: any): any {
  const paths: Path[] = [];
  pathsOf(root, [], paths, new Set());
  const at = (path: Path): any => path.reduce((v: any, key) => v[key], root);
  const containers = paths.filter(path => path.length > 0 && isObject(at(path)));
  if (containers.length < 2) return root;
  const from = pick(containers), to = pick(containers);
  if (from === to || to.length <= from.length && from.slice(0, to.length).every((key, i) => key === to[i]) || from.length <= to.length && to.slice(0, from.length).every((key, i) => key === from[i])) return root;
  put(at(to.slice(0, -1)), to[to.length - 1], at(from));
  isInTwoPlaces = true;
  return root;
}

// ---- Ways to dress a value. Each leaves what the value says as it is. reads counts what is asked of each part.
type Dressed = { value: any; image: (part: any) => any; parts: Set<object>; reads: Map<string, number> };
class Sublist extends Array<any> {}
type Way = { name: string; one: (part: any, id: number, reads: Map<string, number>) => any };
const isOrdinary = (part: any): boolean => Array.isArray(part) ? part.length <= 1000 : Object.getPrototypeOf(part) === Object.prototype;
const count = (reads: Map<string, number>, what: string): void => { reads.set(what, (reads.get(what) ?? 0) + 1); };
const ways: Way[] = [
  { name: "as it is", one: part => part },
  { name: "frozen", one: part => Object.freeze(part) },
  { name: "sealed", one: part => Object.seal(part) },
  { name: "some frozen", one: part => (chance(0.4) ? Object.freeze(part) : part) },
  { name: "no prototype", one: part => (Array.isArray(part) ? part : Object.setPrototypeOf(part, null)) },
  { name: "accessors", one: (part, id, reads) => { for (const key of Object.keys(part)) { const held = part[key]; Object.defineProperty(part, key, { get() { count(reads, id + "." + key); return held; }, enumerable: true, configurable: true }); } return part; } },
  { name: "one accessor", one: (part, id, reads) => { const keys = Object.keys(part); if (keys.length && chance(0.5)) { const key = pick(keys), held = part[key]; Object.defineProperty(part, key, { get() { count(reads, id + "." + key); return held; }, enumerable: true, configurable: true }); } return part; } },
  { name: "proxies", one: (part, id, reads) => new Proxy(part, { get(t, key, r) { if (typeof key === "string") count(reads, id + "." + key); return Reflect.get(t, key, r); } }) },
  { name: "some proxies", one: (part, id, reads) => (chance(0.4) ? new Proxy(part, { get(t, key, r) { if (typeof key === "string") count(reads, id + "." + key); return Reflect.get(t, key, r); } }) : part) },
  { name: "holes", one: part => { if (Array.isArray(part)) for (let i = 0; i < part.length; i++) if (part[i] === undefined) delete part[i]; return part; } },
  { name: "sparse storage", one: part => { if (Array.isArray(part)) { const length = part.length; part[5000000] = 1; part.length = length; } return part; } },
  { name: "subclass of Array", one: part => (Array.isArray(part) ? Sublist.from(part) : part) },
  { name: "a name on a list, a hidden name on an object", one: part => Object.defineProperty(part, "hiddenName", { value: 1, enumerable: Array.isArray(part), configurable: true }) },
  { name: "a symbol key", one: part => (Array.isArray(part) ? part : Object.assign(part, { [Symbol.for("key")]: 1 })) },
  { name: "many names came and went", one: part => { if (!Array.isArray(part)) { for (let i = 0; i < 70; i++) part["t" + i] = i; for (let i = 0; i < 70; i++) delete part["t" + i]; } return part; } },
];
// original and twin are made alike. The twin is dressed, from the leaves up, and each part of the original learns which object stands for it.
function dress(original: any, twin: any, way: Way): Dressed {
  const images = new Map<object, any>(), done = new Map<object, any>(), parts = new Set<object>(), reads = new Map<string, number>();
  let id = 0;
  const walk = (o: any, t: any): any => {
    if (!isObject(t)) return t;
    if (done.has(t)) return done.get(t);
    parts.add(t);
    let dressed = t;
    if (isOrdinary(t)) {
      done.set(t, t);
      for (const key of Object.keys(t)) { const held = walk(o[key], t[key]); if (held !== t[key]) put(t, key, held); }
      dressed = way.one(t, id++, reads);
      parts.add(dressed);
    }
    done.set(t, dressed);
    images.set(o, dressed);
    return dressed;
  };
  const value = walk(original, twin);
  return { value, image: part => images.get(part), parts, reads };
}

// ---- The run
const perType = Number(process.argv[2] ?? 300), firstSeed = Number(process.argv[3] ?? 1), only = process.argv[4];
let pairs = 0, accepted = 0, refused = 0, unsure = 0, bad = 0;
const show = (v: any): string => { try { return (JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x + "n" : typeof x === "function" ? "function" : x === undefined ? "undefined" : typeof x === "symbol" ? "symbol" : typeof x === "number" && !Number.isFinite(x) ? String(x) : isObject(x) && !Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null ? Object.prototype.toString.call(x) : Array.isArray(x) && x.length > 50 ? "list of " + x.length : x)) ?? "undefined").slice(0, 300); } catch (e) { return "?"; } };
function fail(what: string, one: Case, seed: number, way: string, v: any, got: string): void {
  if (bad++ < 60) console.log("DOES NOT HOLD: " + what + " | " + one.name + " seed " + seed + " | " + way + " | value " + show(v) + " | " + got);
}
function newPartsAreInOnePlace(r: any, parts: Set<object>, seen: Set<object>): boolean {
  if (!isObject(r) || parts.has(r)) return true;
  if (seen.has(r)) return false;
  seen.add(r);
  return Reflect.ownKeys(r).every(key => key === "length" || newPartsAreInOnePlace(r[key], parts, seen));
}
function judge(one: Case, seed: number, way: string, v: any, verdict: boolean | undefined, run: () => any, image: Image, parts: Set<object>, reads?: Map<string, number>): void {
  pairs++;
  let result: any, threw: any, isAccepted = false;
  const started = performance.now();
  try { result = run(); isAccepted = true; } catch (e) { threw = e; }
  if (reads) for (const [what, times] of reads) if (times > (isInTwoPlaces ? 2 : 1)) { fail("each part is read once for each place it is in", one, seed, way, v, what + " was read " + times + " times"); break; }
  if (performance.now() - started > 5000) fail("an answer within five seconds", one, seed, way, v, Math.round(performance.now() - started) + " ms");
  if (!isAccepted) {
    refused++;
    if (threw instanceof RangeError) return;
    if (!(threw instanceof TypeError) || !Array.isArray((threw as any).issues) || (threw as any).issues.length === 0) return fail("a refusal is a TypeError with issues", one, seed, way, v, "threw " + String(threw));
    if (verdict === true) fail("a value of the type is accepted", one, seed, way, v, "refused: " + threw.message);
    return;
  }
  accepted++;
  if (verdict === false) return fail("a value that is not of the type is refused", one, seed, way, v, "accepted, came back " + show(result));
  if (verdict === undefined) {
    let holds = true;
    const had = everyObjectHasASymbol;
    everyObjectHasASymbol = false;
    try { holds = accepts(one.d, result); } catch (e) { if (!(e instanceof Unsure)) throw e; }
    everyObjectHasASymbol = had;
    if (!holds) fail("what comes back is of the type", one, seed, way, v, "came back " + show(result));
    return;
  }
  let isRight = true;
  try { isRight = agrees(one.d, v, result, image); } catch (e) { if (!(e instanceof Unsure)) throw e; }
  if (!isRight) return fail("what comes back is the value: new where the type describes it, the same object where it does not", one, seed, way, v, "came back " + show(result));
  if (!newPartsAreInOnePlace(result, parts, new Set())) fail("no new object is in two places", one, seed, way, v, "came back " + show(result));
}
function isText(v: any, seen: Set<object>): boolean {
  if (v === undefined || typeof v === "bigint" || typeof v === "symbol" || typeof v === "function" || (typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)))) return false;
  if (!isObject(v)) return true;
  if (!isOrdinary(v) || seen.has(v)) return false;
  seen.add(v);
  const all = Array.isArray(v) ? Array.from(v, item => isText(item, seen)).every(Boolean) : Object.keys(v).every(key => isText(v[key], seen));
  seen.delete(v);
  return all;
}
const escaped = (text: string): string => text.replace(/"([A-Za-z_])([\w-]*)":/g, (_, first, rest) => '"\\u00' + first.charCodeAt(0).toString(16) + rest + '":');
for (const one of cases) {
  if (only !== undefined && one.name !== only) continue;
  for (let n = 0; n < perType; n++) {
    const seed = (firstSeed * 1000003 + n * 7919) | 0;
    const original = make(one.d, seed);
    let verdict: boolean | undefined;
    try { verdict = accepts(one.d, original); } catch (e) { if (!(e instanceof Unsure) && !(e instanceof RangeError)) throw e; unsure++; }
    for (const way of ways) {
      const twin = make(one.d, seed);
      state = seed ^ 0x5bd1e995;
      const dressed = dress(original, twin, way);
      everyObjectHasASymbol = way.name === "a symbol key";
      let verdictSo = verdict;
      if (everyObjectHasASymbol) try { verdictSo = accepts(one.d, original); } catch (e) { if (!(e instanceof Unsure) && !(e instanceof RangeError)) throw e; verdictSo = undefined; }
      judge(one, seed, way.name, original, verdictSo, () => one.take(dressed.value), dressed.image, dressed.parts, dressed.reads);
      everyObjectHasASymbol = false;
    }
    if (isText(original, new Set())) {
      const text = JSON.stringify(original);
      judge(one, seed, "text", original, verdict, () => one.parse(text), undefined, new Set());
      judge(one, seed, "text with escaped names", original, verdict, () => one.parse(escaped(text)), undefined, new Set());
      judge(one, seed, "text with spaces", original, verdict, () => one.parse(JSON.stringify(original, null, 1)), undefined, new Set());
    }
  }
}
console.log("pairs " + pairs + " accepted " + accepted + " refused " + refused + " values without a sure verdict " + unsure + " answers that do not hold " + bad);
`;

if (import.meta.main) console.log(program(Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 24)));

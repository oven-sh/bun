// A drawn type, texts that fit it, texts that depart from it in a few places and texts that are no JSON, `JSON.parse(text) as T`, and a look at what came of it: the keys in order at every depth,
// the values, reads through the type, and the same again after a few changes. The texts differ in the order of their keys, in keys that are missing, repeated, escaped or beyond the type,
// in numbers at the borders of every representation, and in how the string that holds them was made.
//
// A program is a seed. The same seed always writes the same program.
import { look, Random } from "./every-way-to-look-at-an-object";

type T =
  | { kind: "number" | "string" | "boolean" | "null" | "unknown" }
  | { kind: "literals"; values: string[] }
  | { kind: "union"; of: T[] }
  | { kind: "array"; of: T }
  | { kind: "object"; fields: { name: string; optional: boolean; type: T }[] }
  | { kind: "record"; of: T }
  | { kind: "tuple"; of: T[] };

const fieldNames = ["a", "b", "c", "d", "id", "name", "kind", "value", "items", "next", "x", "y", "ok", "0", "1", "a-b", "__proto__", "constructor", "length", "toString", "é", ""];
const numbers = ["0", "-0", "1", "-1", "1.5", "1e3", "1.0", "1E400", "-1E400", "1e-400", "-1e-400", "2147483647", "2147483648", "-2147483648", "-2147483649", "-2147483647", "-2147483646", "-2147483645", "4294967295", "4294967296", "9007199254740993", "0.1", "123456789012345678901234567890", "255", "256", "-128", "-129", "65535", "65536", "5e-324", "1.7976931348623157e308"];
const strings = ['""', '"s"', '"on"', '"off"', '"o\\u006e"', '"onn"', '"o"', '"\\n"', '"\\ud83d\\ude00"', '"\\ud83d"', '"é"', '"中"', '"a\\"b"', '"\\\\"', '"\\/"', '"__proto__"', '"0"', '"' + "x".repeat(40) + '"'];

function drawType(r: Random, depth: number): T {
  const w = r.int(100);
  if (depth >= 3 || w < 45) {
    const v = r.int(100);
    if (v < 35) return { kind: "number" };
    if (v < 60) return { kind: "string" };
    if (v < 72) return { kind: "boolean" };
    if (v < 86) return { kind: "literals", values: r.pick([['"on"', '"off"'], ['"on"', '"off"', '"auto"', '""'], ["0", "1", "2"], ['"a"', "1", "true"], ["-1", "1000", "70000"], ['"x"']]) };
    if (v < 92) return { kind: "null" };
    return { kind: "unknown" };
  }
  if (w < 60) return { kind: "union", of: [drawType(r, depth + 1), r.pick<T>([{ kind: "null" }, { kind: "string" }, { kind: "number" }, drawType(r, depth + 1)])] };
  if (w < 72) return { kind: "array", of: drawType(r, depth + 1) };
  if (w < 76) return { kind: "record", of: drawType(r, depth + 1) };
  if (w < 80) return { kind: "tuple", of: [drawType(r, depth + 1), drawType(r, depth + 1)] };
  return drawObject(r, depth);
}
function drawObject(r: Random, depth: number): T {
  const names = r.shuffle(fieldNames.slice(0, r.chance(0.75) ? 13 : fieldNames.length)).slice(0, 1 + r.int(depth ? 4 : 7));
  return { kind: "object", fields: names.map(name => ({ name, optional: r.chance(0.3), type: drawType(r, depth + 1) })) };
}
function spell(t: T): string {
  switch (t.kind) {
    case "literals": return t.values.join(" | ");
    case "union": return t.of.map(x => `(${spell(x)})`).join(" | ");
    case "array": return `(${spell(t.of)})[]`;
    case "record": return `Record<string, ${spell(t.of)}>`;
    case "tuple": return `[${t.of.map(spell).join(", ")}]`;
    case "object": return `{ ${t.fields.map(f => `${JSON.stringify(f.name)}${f.optional ? "?" : ""}: ${spell(f.type)}`).join("; ")} }`;
    default: return t.kind;
  }
}
const space = (r: Random) => (r.chance(0.15) ? r.pick([" ", "\n", "\t", "  \r\n "]) : "");
const anything = (r: Random): string => r.pick([r.pick(numbers), r.pick(strings), "true", "false", "null", "{}", "[]", '{"a":1}', "[1]", '[{"a":[]}]', '{"__proto__":{"x":1}}', '{"a":1,"a":2}']);
const escapeKey = (r: Random, name: string) => (r.chance(0.1) && name.length ? '"' + [...name].map(c => (c.length === 1 ? "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0") : c)).join("") + '"' : JSON.stringify(name));

/** A text for the type. `wild` is the chance at each place to write something else than the type says. */
function text(r: Random, t: T, wild: number): string {
  if (r.chance(wild)) return anything(r);
  switch (t.kind) {
    case "number": return r.pick(numbers);
    case "string": return r.pick(strings);
    case "boolean": return r.pick(["true", "false"]);
    case "null": return "null";
    case "unknown": return anything(r);
    case "literals": return r.pick(t.values);
    case "union": return text(r, r.pick(t.of), wild);
    case "array": return "[" + Array.from({ length: r.pick([0, 1, 2, 3, 5]) }, () => space(r) + text(r, t.of, wild)).join(",") + space(r) + "]";
    case "tuple": return "[" + t.of.map(x => text(r, x, wild)).join(",") + "]";
    case "record": return "{" + r.shuffle(["k1", "k2", "a", "0", "__proto__"]).slice(0, r.int(4)).map(k => JSON.stringify(k) + ":" + text(r, t.of, wild)).join(",") + "}";
    case "object": {
      let members = t.fields.filter(f => !f.optional || r.chance(0.6)).map(f => [f.name, text(r, f.type, wild)] as [string, string]);
      if (r.chance(0.5)) members = r.shuffle(members);
      if (wild) {
        if (r.chance(0.25) && members.length) members.splice(r.int(members.length), 1);
        if (r.chance(0.3)) members.splice(r.int(members.length + 1), 0, [r.pick(["extra", "zz", "0", "7", "__proto__", "a", "b", ""]), anything(r)]);
        if (r.chance(0.25) && members.length) { const f = r.pick(t.fields); members.splice(r.int(members.length + 1), 0, [f.name, r.chance(0.5) ? text(r, f.type, 0) : anything(r)]); }
      }
      return "{" + members.map(([k, v]) => space(r) + escapeKey(r, k) + space(r) + ":" + space(r) + v).join(",") + space(r) + "}";
    }
  }
}
function broken(r: Random, good: string): string {
  const at = r.int(good.length + 1);
  return r.pick([good.slice(0, at), good + r.pick(["x", ",", "}", "]", " 1"]), good.slice(0, at) + r.pick([",", ":", "'", "\u0000", "\\", "01", "+1", ".5", "1.", "NaN", "undefined", "tru", "﻿"]) + good.slice(at), "﻿" + good, good.replace(",", ",,"), good.replace(/}$/, ",}")]);
}
/** Reads through the declared type, as far as they can be written without narrowing. */
function reads(t: T, path: string, depth: number, out: string[]): void {
  if (depth > 3) return;
  out.push(path);
  if (t.kind === "object") for (const f of t.fields) reads(f.type, `${path}?.[${JSON.stringify(f.name)}]`, depth + 1, out);
  if (t.kind === "array") { out.push(`${path}?.length`); reads(t.of, `${path}?.[0]`, depth + 1, out); }
  if (t.kind === "tuple") t.of.forEach((x, i) => reads(x, `${path}?.[${i}]`, depth + 1, out));
}

export function program(seed: number): string {
  const r = new Random(seed);
  const parts = [look];
  parts.push(`function deep(v: unknown, depth = 0): string {
  if (v === null || typeof v !== "object") return show(v);
  if (depth > 6) return "..";
  const proto = Object.getPrototypeOf(v);
  const tag = proto === Object.prototype ? "" : proto === Array.prototype ? "" : proto === null ? "null-proto:" : "other-proto:";
  if (Array.isArray(v)) return tag + "[" + v.map(x => deep(x, depth + 1)).join(",") + "]";
  return tag + "{" + Reflect.ownKeys(v).map(k => { const d = Reflect.getOwnPropertyDescriptor(v, k)!; return JSON.stringify(k) + (d.writable && d.enumerable && d.configurable ? "" : "!") + ":" + deep(d.value, depth + 1); }).join(",") + "}";
}
const nothing = process.env.NOBODY_HAS_SET_THIS ?? "";`);
  const count = 1 + r.int(3);
  for (let n = 0; n < count; n++) {
    const t = r.chance(0.8) ? drawObject(r, 0) : drawType(r, 0);
    parts.push(`type T${n} = ${spell(t)};`);
    const list: string[] = [];
    reads(t, "v", 0, list);
    parts.push(`function parse${n}(text: string): T${n} { return JSON.parse(text) as T${n}; }`);
    parts.push(`function reads${n}(v: T${n}): unknown { return [${[...new Set(list)].slice(0, 24).map(p => (t.kind === "object" || t.kind === "array" || t.kind === "tuple" ? p : "v")).join(", ")}]; }`);
    parts.push(`function told${n}(label: string, text: string): void {
  let v: T${n};
  try { v = parse${n}(text); } catch (e) { console.log(label + " | THROWS " + (e as Error).constructor.name); return; }
  console.log(label + " | deep " + deep(v));
  console.log(label + " | reads " + attempt(() => (reads${n} as (v: any) => unknown)(v)));
  console.log(label + " | json " + attempt(() => JSON.stringify(v)));
  console.log(label + " | same " + attempt(() => Bun.deepEquals(v, JSON.parse(text, (k, x) => x), true)));
  if (v !== null && typeof v === "object") { look(label, v); const u: any = v; u.added = 1; for (const k of Object.keys(u).slice(0, 2)) { const x = u[k]; delete u[k]; u[k] = x; } console.log(label + " | changed " + deep(v)); }
}`);
    const texts: string[] = [];
    for (let i = 0; i < 4; i++) texts.push(text(r, t, 0));
    for (let i = 0; i < 8; i++) texts.push(text(r, t, r.pick([0.05, 0.15, 0.4])));
    for (let i = 0; i < 3; i++) texts.push(broken(r, text(r, t, 0)));
    r.shuffle(texts).forEach((x, i) => {
      const literal = JSON.stringify(x);
      const form = r.pick([literal, literal, `${literal} + nothing`, `(" " + ${literal}).slice(1)`, `Buffer.from(${literal}).toString()`, `("\\u4e2d" + ${literal}).slice(1)`, `[...${literal}].join("")`]);
      parts.push(`told${n}("${n}.${i}", ${form});`);
    });
  }
  return parts.join("\n") + "\n";
}

// Random typed programs about element access: arrays of whole numbers, doubles, strings, records and optional elements, and
// Float64Array | Int32Array | Uint8Array | Uint8ClampedArray, are read, stored to, asked (`in`, hasOwn) and deleted from by keys of
// every kind: small indices, the length and beyond, -0, negative, fractional, NaN, 2^31, 2^32 - 2, 2^32 - 1, 2^32, 1e21, Infinity. The
// key comes out of a parameter, a field that holds whole numbers, a field that holds doubles, an optional field joined by ??, a sum, a
// product. Between the accesses stands what changes the kind and the length of an array: push | pop | shift | unshift | splice |
// length = n | fill | reverse | copyWithin | holes made by delete and by a store far beyond the end | a double among whole numbers |
// properties named like keys that are no index | freeze | seal. Every function is warmed with small indices first, and everything
// that is seen is written down.
import { Random } from "./python-random";

const head = `declare const console: { log(...values: unknown[]): void };
type Rec = { id: number };
class Key { whole: number; real: number; maybe?: number; constructor(k: number) { this.whole = k | 0; this.real = k; if (k === k) this.maybe = k; } }
const show = (v: unknown): string => (v === null ? "null" : v === undefined ? "u" : typeof v === "object" ? "r" + (v as Rec).id : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "string" ? "'" + v + "'" : String(v));
const KEYS: number[] = [0, -0, 1, 2, 3, 4, 5, 7, 8, 9, 40, -1, -2, 0.5, 1.5, -0.5, NaN, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, -2147483648, -2147483649, 1e21, Infinity, -Infinity];
const attempt = (f: () => string): string => { try { return f(); } catch (e) { return "THROWS " + (e as Error).name; } };
const all = (a: ArrayLike<unknown>): string => { let s = "#" + a.length + "["; for (let i = 0; i < a.length && i < 14; i++) s += (i in a ? show(a[i]) : "_") + ","; return s + "]" + (a.length < 64 ? Object.keys(a).slice(0, 16).join(".") : "long"); };
`;

export function program(seed: number, functions = 50): { file: string; text: string } {
  const random = new Random(seed);
  const oneOf = (...list: string[]) => random.choice(list);
  const kinds: Record<string, { type: string; literal: string; value: () => string; isTypedArray: boolean }> = {
    ints: { type: "number[]", literal: "[10, 11, 12, 13, 14]", value: () => String(random.randrange(100)), isTypedArray: false },
    doubles: { type: "number[]", literal: "[0.5, 1.5, 2.5, 3.5]", value: () => oneOf("7.25", "-0", "NaN", "3", "1e300"), isTypedArray: false },
    strings: { type: "string[]", literal: '["a", "b", "c", "d"]', value: () => `"s${random.randrange(9)}"`, isTypedArray: false },
    recs: { type: "Rec[]", literal: "[{ id: 0 }, { id: 1 }, { id: 2 }]", value: () => `{ id: ${random.randrange(50)} }`, isTypedArray: false },
    optional: { type: "(number | undefined)[]", literal: "[1, undefined, 3, 4]", value: () => oneOf("undefined", "5", "6.5"), isTypedArray: false },
    empty: { type: "number[]", literal: "[]", value: () => String(random.randrange(9)), isTypedArray: false },
    f64: { type: "Float64Array", literal: "new Float64Array([0.5, 1.5, 2.5, 3.5, 4.5])", value: () => oneOf("7.25", "-0", "NaN", "3"), isTypedArray: true },
    i32: { type: "Int32Array", literal: "new Int32Array([1, 2, 3, 4])", value: () => oneOf("7.9", "-1", "4294967297", "NaN", "3"), isTypedArray: true },
    u8: { type: "Uint8Array", literal: "new Uint8Array([1, 2, 3, 4, 5, 6])", value: () => oneOf("300", "-1", "7.9", "NaN", "3"), isTypedArray: true },
    u8c: { type: "Uint8ClampedArray", literal: "new Uint8ClampedArray([1, 2, 3])", value: () => oneOf("300", "-1", "7.5", "8.5", "NaN"), isTypedArray: true },
  };
  // prettier-ignore
  const key = () => oneOf("k", "k", "key.real", "key.real", "key.whole", "(key.maybe ?? 1e21)", "(key.maybe ?? -0)", "(key.maybe ?? 2)", "(k + 1)", "(k - 1)", "(k * 1)", "(k * 2)", "(-k)", "(key.whole + 1)", "(key.real - key.whole)", "Math.floor(k)", "Math.round(k)", "(k | 0)", "(k >>> 0)", "(k % 4)", "Math.abs(k)", "(k / 2)");

  let text = head;
  for (let f = 0; f < functions; f++) {
    const name = random.choice(Object.keys(kinds));
    const { type, literal, value, isTypedArray } = kinds[name];
    const body = [`  const a: ${type} = ${literal}; let log = "";`];
    for (let statements = random.randrange(4, 11); statements > 0; statements--) {
      const c = random.randrange(22);
      if (c < 5) body.push(`  log += show(a[${key()}]) + ",";`);
      else if (c < 8) body.push(`  a[${key()}] = ${value()};`);
      else if (c === 8) body.push(`  log += (${key()} in a ? "I" : "i") + (Object.hasOwn(a, ${key()}) ? "O" : "o");`);
      else if (c === 9) body.push(`  { const t = a[${key()}]; log += t === undefined ? "none," : show(t) + ","; }`);
      else if (c === 10) body.push(`  for (let i = 0; i < 3; i++) log += show(a[${key()} + i]) + ";";`);
      else if (c === 11) body.push("  log += all(a);");
      else if (c === 12 && !isTypedArray) body.push(`  log += attempt(() => String(delete a[${key()}]));`);
      else if (c === 13 && !isTypedArray) {
        // prettier-ignore
        const changes = [`a.push(${value()});`, "log += show(a.pop());", "log += show(a.shift());", `a.unshift(${value()});`, "a.splice(1, 1);", `a.splice(1, 0, ${value()}, ${value()});`, `a.length = ${random.choice([0, 1, 2, 6, 9])};`, "a.reverse();"];
        body.push("  if (a.length < 64) " + random.choice(changes));
      } else if (c === 14 && !isTypedArray) body.push(`  (a as unknown as Record<string, unknown>)[String(${key()})] = ${value()};`);
      else if (c === 15 && !isTypedArray) body.push("  if (k === 1) " + oneOf("Object.freeze(a);", "Object.seal(a);", "Object.preventExtensions(a);"));
      else if (c === 16) body.push("  if (a.length < 64) " + random.choice(name !== "recs" ? [`a.fill(${value()}, 1, 3);`, "a.copyWithin(0, 1);", "a.reverse();"] : ["a.copyWithin(0, 1);", "a.reverse();"]));
      else if (c === 17) body.push(`  log += a.length + ":" + show(a.at(${oneOf("k", "-1", "0", "key.whole")})) + ",";`);
      else if (c === 18) body.push(`  if (a.length < 64) log += a.indexOf(a[${key()}] as never) + "," + a.includes(a[${key()}] as never) + ",";`);
      else if (c === 19) body.push("  { let s = 0; for (const v of a) { if (s++ > 12) break; log += show(v); } }");
      else if (c === 20 && !isTypedArray) body.push(`  a[a.length + ${random.choice([0, 1, 3, 30])}] = ${value()};`);
      else body.push('  log += show(a[a.length - 1]) + show(a[a.length]) + ",";');
    }
    body.push("  return log + all(a);");
    text += `function f${f}(k: number, key: Key): string {\n${body.join("\n")}\n}\n`;
    text += `{ let warm = 0; for (let i = 0; i < 200; i++) warm += attempt(() => f${f}(i & 3, new Key(i & 3))).length; console.log("f${f}: " + warm + " " + KEYS.map(k => attempt(() => f${f}(k, new Key(k)))).join(" | ")); }\n`;
  }
  return { file: "main.ts", text };
}

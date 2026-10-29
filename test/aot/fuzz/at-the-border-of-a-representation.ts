// Things whose size or contents stand right at a border where an engine changes how it keeps them, and one operation that carries them across.
//
//   lists     arrays of numbers that all fit 8, 16 or 32 bits, are fractions, or hold -0 | NaN; of 0 to 100,001 elements, at each power of two and one beside it; one value from the next wider kind arrives by a store,
//             push, unshift, fill, splice, concat, map, with, copyWithin, a length; elements leave at both ends, again and again, also when the array has names of its own
//   objects   literals and classes of 0 to 1,000 members, at each power of two and one beside it; more names arrive at run time, some leave; subclasses that add members; every member read by name, by key and in order
//   tables    Maps and Sets written as constants, of 0 to 257 entries; asked for what is there and what is not, grown, shrunk, given a key of another kind; switches over as many texts and over single characters
//   switches  over integers: dense, with gaps, negative, at the ends of int32; asked with each case, its neighbors, fractions, -0, NaN, and what is no number
//   texts     characters at the ends of 7, 8 and 16 bits and of the surrogates, alone and joined; texts of no, one and two characters
//   integers  big ones at 2**63 and 2**64 and their neighbors, through every operator and into arrays of 64 bits
//
// After each operation the program prints a digest of the whole thing.
import type { Random } from "./random";

const prelude = `function show(x: unknown): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "bigint") return x + "n";
  if (typeof x === "string") return JSON.stringify(x);
  return String(x);
}
function digestOfList(a: number[]): string {
  let sum = 0;
  let holes = 0;
  let odd = -1;
  for (let i = 0; i < a.length; i++) {
    if (!(i in a)) {
      holes++;
      continue;
    }
    const x = a[i];
    if (odd < 0 && (x !== (x | 0) || Object.is(x, -0))) odd = i;
    if (x === x && x !== Infinity) sum = (sum * 31 + x) % 1000000007;
  }
  const n = a.length;
  return n + " sum " + sum + " holes " + holes + " odd " + odd + " [" + [a[0], a[1], a[n >> 1], a[n - 2], a[n - 1]].map(show).join() + "]" + (Object.keys(a).length === n - holes ? "" : " names " + Object.keys(a).slice(-2).join());
}
function digestOfObject(o: Record<string, unknown>): string {
  let hash = 0;
  let sum = 0;
  const keys = Object.keys(o);
  for (const key of keys) {
    for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
    const value = o[key];
    if (typeof value === "number") sum += value;
    else hash = (hash + String(value).length) | 0;
  }
  let walked = 0;
  for (const key in o) walked += key.length;
  return keys.length + " #" + hash + " sum " + sum + " walked " + walked + " json " + JSON.stringify(o).length;
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).name;
  }
}`;

const sizes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1023, 1024, 1025];
const largeSizes = [4095, 4096, 4097, 9999, 10000, 10001, 65535, 65536, 65537, 99999, 100000, 100001];
const fillings: Record<string, string> = {
  "bits-7": "i % 100",
  "bits-8": "(i % 200) - 100",
  "bits-8-unsigned": "i % 256",
  "bits-16": "(i * 37) % 30000",
  "bits-16-negative": "-((i * 37) % 30000)",
  "bits-32": "i * 65537 + 70000",
  "bits-32-negative": "-(i * 65537) - 70000",
  fractions: "i + 0.5",
  "whole-fractions": "i * 4294967296",
  zeros: "0",
  constant: "7",
};
const arrivals = ["127", "128", "-128", "-129", "255", "256", "32767", "32768", "-32768", "-32769", "65535", "65536", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "0.5", "-0", "NaN", "Infinity", "1e21", "9007199254740992", "1", "0"];
// `a` is the list, `V` what arrives, `M` an index in the middle.
const listSteps: string[] = [
  "a[0] = V;",
  "a[M] = V;",
  "a[a.length - 1] = V;",
  "a[a.length] = V;",
  "a[a.length + 1] = V;",
  "a.push(V);",
  "a.push(V, 1, V);",
  "a.unshift(V);",
  "a.unshift(1, V);",
  "a.fill(V);",
  "a.fill(V, M);",
  "a.fill(V, 0, 1);",
  "a.splice(M, 0, V);",
  "a.splice(M, 1, V, V);",
  "a.splice(0, 1);",
  "a.splice(M, 1);",
  "a.splice(M);",
  "a = a.concat([V]);",
  "a = a.concat(a);",
  "a = [V].concat(a);",
  "a = a.map(x => x + V);",
  "a = a.map(x => (x === 3 ? V : x));",
  "a = a.map(x => x * 2);",
  "a = a.with(Math.min(M, Math.max(0, a.length - 1)), V);",
  "a = [...a, V];",
  "a = [V, ...a];",
  "a = Array.from(a, x => x - V);",
  "a = a.slice(1);",
  "a = a.slice(0, -1);",
  "a = a.filter(x => x !== (V as number));",
  "a = a.toSpliced(M, 1, V);",
  "a = a.toReversed();",
  "a = a.toSorted((l, r) => l - r);",
  "a = a.flatMap(x => (x === 1 ? [V, x] : [x]));",
  "a.copyWithin(0, M);",
  "a.reverse();",
  "a.sort((l, r) => l - r);",
  "a.sort();",
  "a.pop();",
  "a.shift();",
  "a.length = a.length + 1;",
  "a.length = Math.max(0, a.length - 1);",
  "a.length = M;",
  "a.length = 0;",
  "delete a[M];",
  "for (let k = 0; k < 5; k++) a.shift();",
  "for (let k = 0; k < 5; k++) a.unshift(k);",
  "for (let k = 0; k < 40; k++) {\n    a.shift();\n    a.push(k);\n  }",
  "for (let k = 0; k < 40; k++) {\n    a.pop();\n    a.unshift(k);\n  }",
  "for (let k = 0; k < 70; k++) a.push(k === 69 ? V : k);",
  "while (a.length > 1) a.pop();",
  "while (a.length > 1) a.shift();",
  "(a as any).tag = V;",
  "for (let k = 0; k < a.length; k++) a[k] += V;",
  "for (let k = 0; k < a.length; k++) a[k] = a[k] * 256;",
  "for (let k = 0; k < a.length; k++) a[k] = -a[k];",
  "for (let k = 0; k < a.length; k++) a[k] = a[k] / 2;",
  "for (let k = 0; k < a.length; k++) a[k]++;",
  "out += show(a.includes(V)) + show(a.indexOf(V)) + show(a.lastIndexOf(V)) + \" \";",
  "out += show(a.at(-1)) + show(a.at(M)) + show(a.find(x => x === (V as number))) + \" \";",
  "out += show(Math.max(...a.slice(0, 50))) + show(a.reduce((s, x) => s + x, 0)) + \" \";",
  "out += a.slice(0, 4).join() + JSON.stringify(a.slice(-2)) + \" \";",
];

const memberValue = (i: number) => [`${i}`, `${i}.5`, `"t${i}"`, `${i % 2 === 0}`, `${i * 100003}`, `-${i}`][i % 6];
const memberType = (i: number) => ["number", "number", "string", "boolean", "number", "number"][i % 6];
const objectSteps: string[] = [
  'for (let k = 0; k < MORE; k++) o["x" + k] = k;',
  'for (let k = 0; k < MORE; k++) o["x" + k] = k % 2 ? k + 0.5 : "s" + k;',
  "for (let k = 0; k < MORE; k++) o[k] = k;",
  'for (let k = 0; k < MORE; k++) delete o["m" + k];',
  'for (let k = MORE; k >= 0; k--) delete o["m" + k];',
  'delete o.m0;\n  o.m0 = "again";',
  'for (const key of Object.keys(o)) o[key] = typeof o[key] === "number" ? (o[key] as number) + 0.25 : 1;',
  "for (const key of Object.keys(o)) delete o[key];",
  "o = { ...o };",
  "o = { ...o, extra: 1 };",
  "o = Object.assign({}, o, { m1: 2147483648 });",
  "o = JSON.parse(JSON.stringify(o));",
  "o = structuredClone(o);",
  "o = Object.fromEntries(Object.entries(o).reverse());",
  "Object.freeze(o);",
  'Object.defineProperty(o, "m1", { get: () => 5, enumerable: true, configurable: true });',
  'Object.defineProperty(o, "hidden", { value: 1, enumerable: false });',
  "Object.setPrototypeOf(o, { inherited: 1 });",
];

const bigBorders = ["9223372036854775807n", "9223372036854775808n", "-9223372036854775808n", "-9223372036854775809n", "18446744073709551615n", "18446744073709551616n", "4294967295n", "4294967296n", "9007199254740993n", "0n", "-1n"];
const bigReads = ["x + 1n", "x - 1n", "x * x", "x * -1n", "-x", "x / 3n", "x % 7n", "x << 1n", "x >> 1n", "x >> 64n", "x << 64n", "x & 0xffffffffffffffffn", "x | 1n", "x ^ -1n", "~x", "x ** 2n", "BigInt.asIntN(64, x)", "BigInt.asUintN(64, x)", "BigInt.asIntN(63, x)", "BigInt.asUintN(65, x + 1n)", "Number(x)", "x > 9223372036854775807", "(x as any) == 18446744073709551616", "x < 1e19", "new BigInt64Array([x])[0]", "new BigUint64Array([x])[0]", "x.toString(16)", "BigInt(x.toString())", "x === BigInt.asIntN(64, x)", "typeof (x + 1n)", "x ? 1 : 0", "BigInt(Number(x)) - x"];
const characters = [0, 1, 0x7f, 0x80, 0xff, 0x100, 0x17f, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfffe, 0xffff, 0x41, 0x61, 0xdf, 0x130];
const characterReads = ["c.length", "c.charCodeAt(0)", "c.codePointAt(0)", "c + c", '(c + "a").length', '("a" + c).charCodeAt(1)', "c.toUpperCase()", "c.toLowerCase()", 'c === "\\u00ff"', 'c < "a"', 'c > "\\u0100"', "c.repeat(3).length", "[...c].length", "encodeURIComponent(c)", "JSON.stringify(c)", "c.normalize().length", 'c.padStart(3, c)', "c.localeCompare(c)", "new TextEncoder().encode(c).length", '("x" + c + "y").indexOf(c)', '("x" + c + "y").split(c).length', "c.at(0) === c", "c[0] === c", "String.fromCharCode(c.charCodeAt(0) + 1).charCodeAt(0)", "c.trim().length", "/^\\w$/.test(c)", "/^.$/u.test(c)", "(c as any).isWellFormed()", "c.concat(c, c).lastIndexOf(c)", "({ [c]: 1 })[c]", "new Map([[c, 1]]).get(c)"];

export function generate(random: Random): string {
  const names: string[] = [];
  const text: string[] = [prelude];
  const calls: string[] = [];
  const scenes = random.between(4, 8);
  const nameOf = (i: number) => "k" + i.toString(36);
  for (let id = 1; id <= scenes; id++) {
    const family = random.weighted([[6, "list"], [3, "object"], [2, "class"], [3, "table"], [2, "switch"], [1, "text"], [1, "integer"]] as const);
    if (family === "list") {
      const size = random.chance(0.2) ? random.pick(largeSizes) : random.pick(sizes);
      const filling = random.pick(Object.keys(fillings));
      const how = random.pick(["pushed", "sized", "from", "literal"]);
      const count = random.between(2, 6);
      const chosen = Array.from({ length: count }, () => random.pick(listSteps).replaceAll("V", () => random.pick(arrivals)).replace(/\bM\b/g, String(size >> 1)));
      names.push(["list", size, filling, how, count].join("-"));
      const each = fillings[filling];
      const made =
        how === "literal" && size <= 129
          ? `let a: number[] = [${Array.from({ length: size }, (_, i) => `${each.replace(/\bi\b/g, String(i))}`).join(", ")}];`
          : how === "sized"
            ? `let a = new Array<number>(${size});\n  for (let i = 0; i < ${size}; i++) a[i] = ${each};`
            : how === "from"
              ? `let a: number[] = Array.from({ length: ${size} }, (_, i) => ${each});`
              : `let a: number[] = [];\n  for (let i = 0; i < ${size}; i++) a.push(${each});`;
      text.push(`function scene${id}(): void {\n  ${made}\n  let out = digestOfList(a);\n${chosen.map(step => `  try {\n  ${step}\n  } catch (error) {\n    out += " " + (error as Error).name;\n  }\n  out += " | " + digestOfList(a);`).join("\n")}\n  console.log("${id}: " + out);\n}`);
    } else if (family === "object" || family === "class") {
      const size = random.pick([...sizes.filter(n => n <= 257), 1000]);
      const more = random.pick([1, 2, 3, 5, 8, 9, 17, 33, 65, 129, 300]);
      const chosen = random.sample(objectSteps, random.between(1, 4)).map(step => step.replaceAll("MORE", String(more)));
      names.push([family, size, more, chosen.length].join("-"));
      const members = Array.from({ length: size }, (_, i) => i);
      const extra = random.between(0, 9);
      const made =
        family === "object"
          ? `let o: Record<string, unknown> = { ${members.map(i => `m${i}: ${memberValue(i)}`).join(", ")} };`
          : `let o = new Heir${id}() as unknown as Record<string, unknown>;`;
      if (family === "class")
        text.push(`class Base${id} {\n${members.map(i => `  m${i}: ${memberType(i)} = ${memberValue(i)};`).join("\n")}\n  total(): number {\n    return ${members.filter(i => memberType(i) === "number").slice(-6).map(i => `this.m${i}`).join(" + ") || "0"};\n  }\n}\nclass Heir${id} extends Base${id} {\n${Array.from({ length: extra }, (_, i) => `  h${i}: number = ${i + 0.5};`).join("\n")}\n}`);
      text.push(`function scene${id}(): void {\n  ${made}\n  let out = digestOfObject(o)${family === "class" ? ` + " total " + new Heir${id}().total()` : ""};\n${chosen.map(step => `  try {\n  ${step}\n  } catch (error) {\n    out += " " + (error as Error).name;\n  }\n  out += " | " + digestOfObject(o);`).join("\n")}\n  out += " " + show(o.m0) + show(o.m${Math.max(0, size - 1)}) + show(o["m" + ${size >> 1}]) + show(o.x0);\n  console.log("${id}: " + out);\n}`);
    } else if (family === "table") {
      const size = random.pick(sizes.filter(n => n <= 257));
      const form = random.pick(["map", "set", "switch", "record"]);
      names.push(["table", form, size].join("-"));
      const keys = Array.from({ length: size }, (_, i) => nameOf(i * 7 + 1));
      const asked = `[${[...random.sample(keys, 6), "missing", "", "k", "constructor", "__proto__", "toString"].map(key => JSON.stringify(key)).join(", ")}]`;
      if (form === "map")
        text.push(`function scene${id}(): void {\n  const m = new Map<unknown, number>([${keys.map((key, i) => `["${key}", ${i}]`).join(", ")}]);\n  let out = "" + m.size;\n  for (const key of ${asked}) out += " " + show(m.get(key)) + m.has(key);\n  m.set("later", -1);\n  m.delete(${JSON.stringify(keys[0] ?? "none")});\n  out += " " + m.size + [...m.keys()].slice(-2).join();\n  m.set(${random.pick(["5", "0.5", "null", "{}", "-0", "NaN", "1n", "undefined"])}, -2);\n  out += " " + m.size + show([...m.values()].reduce((s, x) => s + x, 0));\n  for (const key of ${asked}) out += show(m.get(key + ""));\n  m.clear();\n  out += m.size + show(m.get("later"));\n  console.log("${id}: " + out);\n}`);
      else if (form === "set")
        text.push(`function scene${id}(): void {\n  const s = new Set<unknown>([${keys.map(key => `"${key}"`).join(", ")}]);\n  let out = "" + s.size;\n  for (const key of ${asked}) out += " " + s.has(key);\n  s.add("later");\n  s.delete(${JSON.stringify(keys[keys.length - 1] ?? "none")});\n  s.add(${random.pick(["5", "0.5", "null", "{}", "-0", "NaN", "1n", "undefined"])});\n  out += " " + s.size + [...s].slice(-3).map(show).join();\n  for (const key of ${asked}) out += s.has(key + "");\n  console.log("${id}: " + out);\n}`);
      else if (form === "switch")
        text.push(`function pick${id}(key: string): number {\n  switch (key) {\n${keys.map((key, i) => `    case "${key}":\n      return ${i};`).join("\n")}\n    default:\n      return -1;\n  }\n}\nfunction scene${id}(): void {\n  let out = "";\n  for (const key of ${asked}) out += " " + pick${id}(key) + pick${id}(key + "") + pick${id}(key.slice(0, 1) + key.slice(1));\n  console.log("${id}: " + out);\n}`);
      else
        text.push(`const record${id}: Record<string, number> = { ${keys.map((key, i) => `${key}: ${i}`).join(", ")} };\nfunction scene${id}(): void {\n  let out = "";\n  for (const key of ${asked}) out += " " + show(record${id}[key]) + (key in record${id}) + Object.hasOwn(record${id}, key);\n  console.log("${id}: " + out);\n}`);
    } else if (family === "switch") {
      const count = random.pick([1, 2, 3, 4, 5, 8, 9, 16, 17, 64, 65, 256, 300]);
      const base = random.pick([0, 1, -5, 100, 2147483647 - count * 3, -2147483648, 65530, -40000]);
      const gap = random.pick([1, 1, 2, 3, 1000, 65537]);
      const cases = Array.from({ length: count }, (_, i) => base + i * gap).filter(value => value <= 2147483647 + 5);
      names.push(["switch", count, base, gap].join("-"));
      const asked = [...new Set(random.sample(cases, 5).flatMap(value => [value - 1, value, value + 1, value + 0.5]))];
      text.push(`function pick${id}(x: number): number {\n  switch (x) {\n${cases.map((value, i) => `    case ${value}:\n      return ${i};`).join("\n")}\n    default:\n      return -1;\n  }\n}\nfunction scene${id}(): void {\n  let out = "";\n  for (const x of [${asked.join(", ")}, -0, NaN, Infinity, 4294967296, -4294967296]) out += " " + pick${id}(x);\n  for (const x of ["${cases[0]}", null, undefined, true, ${cases[0]}n] as any[]) out += " " + pick${id}(x);\n  console.log("${id}: " + out);\n}`);
    } else if (family === "text") {
      const chosen = random.sample(characterReads, random.between(3, 8));
      names.push("text-" + chosen.length);
      text.push(`function read${id}(c: string): string {\n  return [${chosen.map(read => `attempt(() => ${read})`).join(", ")}].join();\n}\nfunction scene${id}(): void {\n  let out = "";\n  for (const code of [${characters.join(", ")}]) out += " " + read${id}(String.fromCharCode(code));\n  out += " " + read${id}("") + " " + read${id}(String.fromCharCode(0xd83d, 0xde00));\n  console.log("${id}: " + out);\n}`);
    } else {
      const chosen = random.sample(bigReads, random.between(3, 8));
      names.push("integer-" + chosen.length);
      text.push(`function read${id}(x: bigint): string {\n  return [${chosen.map(read => `attempt(() => ${read})`).join(", ")}].join();\n}\nfunction scene${id}(): void {\n  let out = "";\n  for (const x of [${bigBorders.join(", ")}]) out += " " + read${id}(x);\n  console.log("${id}: " + out);\n}`);
    }
    calls.push(`scene${id}();`);
  }
  text.push(calls.join("\n"));
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}

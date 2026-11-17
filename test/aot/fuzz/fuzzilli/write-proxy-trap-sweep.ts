// The least programs with proxies: the target, times the traps, times how the handler is made, times where the proxy is kept, times what is done with it, times the loop.
//
//   bun write-proxy-trap-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<target>--<trap>--<handler>--<kept>--<deed>--<loop>.mjs, .cjs or .ts
//   bun write-proxy-trap-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const targets: [name: string, text: string][] = [
  ["object", "{ a: 1, b: 2 }"],
  ["empty", "{}"],
  ["list", "[3, 1, 2]"],
  ["function", "function (x) {\n  return x + 1;\n}"],
  ["instance", "new C()"],
  ["proxy", "new Proxy({ a: 1, b: 2 }, {})"],
  ["frozen", "Object.freeze({ a: 1, b: 2 })"],
  ["with-accessor", "{ a: 1, get b() {\n  return this.a;\n}, set b(v) {\n  this.a = v;\n} }"],
  ["map", "new Map([['a', 1]])"],
  ["without-prototype", "Object.assign(Object.create(null), { a: 1, b: 2 })"],
];
// What stands in the handler.
const traps: [name: string, text: string][] = [
  ["none", ""],
  ["get", "get(t, k, r) {\n  seen.push(typeof k === 'string' ? 'g' + k : 'gs');\n  return Reflect.get(t, k, r);\n},"],
  ["get-changed", "get(t, k) {\n  return k in t ? t[k] : typeof k === 'string' ? 'no' + k : undefined;\n},"],
  ["get-constant", "get() {\n  return 7;\n},"],
  ["set", "set(t, k, v, r) {\n  seen.push('s' + String(k));\n  return Reflect.set(t, k, v, r);\n},"],
  ["set-changed", "set(t, k, v) {\n  t[k] = typeof v === 'number' ? v * 2 : v;\n  return true;\n},"],
  ["set-refused", "set() {\n  return false;\n},"],
  ["has", "has(t, k) {\n  seen.push('h' + String(k));\n  return k !== 'b' && k in t;\n},"],
  ["delete", "deleteProperty(t, k) {\n  seen.push('d' + String(k));\n  return delete t[k];\n},"],
  ["keys", "ownKeys(t) {\n  return Reflect.ownKeys(t).reverse();\n},"],
  [
    "descriptor",
    "getOwnPropertyDescriptor(t, k) {\n  seen.push('o' + String(k));\n  return Reflect.getOwnPropertyDescriptor(t, k);\n},",
  ],
  ["define", "defineProperty(t, k, d) {\n  seen.push('f' + String(k));\n  return Reflect.defineProperty(t, k, d);\n},"],
  ["prototype", "getPrototypeOf() {\n  return C.prototype;\n},"],
  ["apply", "apply(t, self, args) {\n  seen.push('a' + args.length);\n  return args.length;\n},"],
  ["construct", "construct(t, args) {\n  return { a: args.length };\n},"],
  ["get-and-set", "get(t, k) {\n  return t[k] ?? 0;\n},\nset(t, k, v) {\n  t[k] = v;\n  n2++;\n  return true;\n},"],
  ["throws", "get(t, k) {\n  if (k === 'b') throw new RangeError('g');\n  return t[k];\n},"],
  ["all", "get: Reflect.get,\nset: Reflect.set,\nhas: Reflect.has,"],
];
// H is what stands in the handler.
const handlers: [name: string, front: string, text: string][] = [
  ["literal", "", "{\n  H\n}"],
  ["constant", "const handler = {\n  H\n};", "handler"],
  ["inherited", "const above = {\n  H\n};\nconst handler = Object.create(above);", "handler"],
  ["filled-later", "const handler = {};\nconst fill = () => Object.assign(handler, {\n  H\n});", "handler"],
  [
    "removed-later",
    "const handler = {\n  H\n};\nconst fill = () => {\n  for (const k of Object.keys(handler)) delete handler[k];\n};",
    "handler",
  ],
  ["made", "const makeHandler = () => ({\n  H\n});", "makeHandler()"],
  ["frozen", "const handler = Object.freeze({\n  H\n});", "handler"],
];
// P makes the proxy; `p` is how it is reached.
const kept: [name: string, file: string, inside: string][] = [
  ["constant-of-file", "const p = P;", ""],
  ["variable-of-file", "let p = P;\nconst replace = v => {\n  p = v;\n};", ""],
  ["local", "", "const p = P;"],
  ["in-loop", "", "IN-LOOP"],
  ["field", "const box = { p: P };", "const { p } = box;"],
  ["element", "const held = [P];", "const p = held[0];"],
  ["above", "const base = P;", "const p = Object.create(base);"],
  ["argument", "const q = P;", "ARGUMENT"],
  ["or-object", "const q = P;\nconst plain = { a: 5, b: 6 };", "OR-OBJECT"],
  ["class-field", "class Holder {\n  p = P;\n}\nconst holder = new Holder();", "const p = holder.p;"],
  ["closed-over", "const give = (v => () => v)(P);", "const p = give();"],
];
const deeds: [name: string, text: string][] = [
  ["read", "out.push(say(p.a));"],
  ["read-other", "out.push(say(p.b));"],
  ["read-missing", "out.push(say(p.z));"],
  ["read-key", "out.push(say(p[key]));"],
  ["read-index", "out.push(say(p[i]));"],
  ["length", "out.push(say(p.length));"],
  ["store", "p.a = i;\nout.push(say(p.a));"],
  ["store-new", "p.z = i;\nout.push(say(p.z));"],
  ["added", "p.a += 1;\nout.push(say(p.a));"],
  ["stepped", "p.b++;\nout.push(say(p.b));"],
  ["store-key", "p[key] = i;\nout.push(say(p[key]));"],
  ["store-index", "p[0] = i;\nout.push(say(p[0]));"],
  ["has", "out.push('a' in p, 'b' in p);"],
  ["own", "out.push(Object.hasOwn(p, 'a'));"],
  ["deleted", "out.push(delete p.b);\nout.push('b' in p);"],
  ["names", "out.push(Object.keys(p).join('~'));"],
  ["for-in", "for (const k in p) out.push(k);"],
  ["spread", "out.push(say(Object.keys({ ...p }).length));"],
  ["pattern", "const { a, ...r } = p;\nout.push(say(a), Object.keys(r).length);"],
  ["list-pattern", "const [f] = p;\nout.push(say(f));"],
  ["json", "out.push(say(JSON.stringify(p)));"],
  ["called", "out.push(say(p(i)));"],
  ["made", "out.push(say(new p(i)?.a));"],
  ["instance", "out.push(p instanceof C);"],
  ["pushed", "p.push(i);\nout.push(say(p.length));"],
  ["method", "out.push(say(p.hasOwnProperty?.('a')));"],
  ["optional", "out.push(say(p?.a?.b));"],
  ["asked", "out.push(say(ask(p)));"],
  ["stored-by-function", "put(p, i);\nout.push(say(p.a));"],
  ["defined", "Object.defineProperty(p, 'c', { value: i, configurable: true });\nout.push(say(p.c));"],
  ["array", "out.push(Array.isArray(p), typeof p);"],
  ["assigned", "Object.assign(p, { a: i });\nout.push(say(p.a));"],
  ["map-get", "out.push(say(p.get?.('a')));"],
];
const loops: [name: string, text: string][] = [
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["eight", "for (let i = 0; i < 8; i++) {\n  IN\n}"],
  ["many", "for (let i = 0; i < 40; i++) {\n  IN\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  IN\n  i++;\n}"],
  ["down", "for (let i = n; i > 0; i--) {\n  IN\n}"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["of", "for (const i of [0, 3, 1, 2]) {\n  IN\n}"],
  ["callee", "const go = i => {\n  IN\n};\nfor (let i = 0; i < n; i++) go(i);"],
];
const total = targets.length * traps.length * handlers.length * kept.length * deeds.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 2_286_901;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const trap = pick(traps);
  const deed = pick(deeds);
  const keep = pick(kept);
  const target = pick(targets);
  const handler = pick(handlers);
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && target[0] !== "frozen" && trap[0] !== "set-refused";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const inHandler = (text: string) => within(text, "H", trap[1]).replaceAll(/^ *\n/gm, "");
  const make = `new Proxy(${target[1]}, ${inHandler(handler[2])})`;
  const isMade = keep[2] === "IN-LOOP";
  const inside =
    keep[2] === "IN-LOOP"
      ? `const p = ${make};`
      : keep[2] === "OR-OBJECT"
        ? "const p = i & 1 ? q : plain;"
        : keep[2] === "ARGUMENT"
          ? ""
          : keep[2].replaceAll(/\bP\b/g, () => make);
  const turn = [isMade || keep[2] === "OR-OBJECT" ? inside : "", /fill/.test(handler[1]) ? "if (i === 1) fill();" : "", keep[0] === "variable-of-file" ? "if (i === 2) replace({ a: 'plain', b: 'p' });" : "", deed[1]].filter(Boolean).join("\n"); // prettier-ignore
  const body = within(loop[1], "IN", turn);
  const has = (word: RegExp) => word.test(body + make + handler[1] + trap[1] + deed[1]);
  const parameter = keep[2] === "ARGUMENT" ? ", p" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    ...(has(/\bseen\b/) ? ["const seen = [];"] : []),
    ...(has(/\bn2\+\+/) ? ["let n2 = 0;"] : []),
    ...(has(/\bC\b/) ? ["class C {\n  a = 1;\n  b = 2;\n}"] : []),
    ...(has(/\bkey\b/) ? ["let key = 'a';"] : []),
    ...(has(/\bask\(/) ? ["function ask(x) {\n  return x.a;\n}"] : []),
    ...(has(/\bput\(/) ? ["function put(x, v) {\n  x.a = v;\n}"] : []),
    'const say = v => (typeof v === "function" ? "function" : typeof v === "object" && v ? "object" : String(v));',
    ...(handler[1] ? [inHandler(handler[1])] : []),
    ...(keep[1] ? [keep[1].replaceAll(/\bP\b/g, () => make)] : []),
    `function run(n${parameter}) {\n${indent([isMade || keep[2] === "OR-OBJECT" ? "" : inside, body].filter(Boolean).join("\n"), "  ")}\n}`,
    "for (const n of [2, 4]) {",
    "  try {",
    `    run(n${parameter ? ", q" : ""});`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    ...(has(/\bseen\b/) ? ["out.push(seen.join('~'));"] : []),
    ...(has(/\bn2\+\+/) ? ["out.push(n2);"] : []),
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${target[0]}--${trap[0]}--${handler[0]}--${keep[0]}--${deed[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(8, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}

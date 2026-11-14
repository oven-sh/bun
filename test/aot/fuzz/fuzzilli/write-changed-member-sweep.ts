// The least programs of an object whose members are changed by a key: each receiver, times each key, times each change, times each question.
//
//   bun write-changed-member-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<receiver>--<key>--<change>--<question>--<place>.mjs, .cjs or .ts
//   bun write-changed-member-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const receivers: [name: string, text: string][] = [
  ["literal", "const o = { a: 1, b: 2 };"],
  ["empty", "const o = {};"],
  ["instance", "class C {\n  a = 1;\n  b = 'b';\n}\nconst o = new C();"],
  ["list", "const o = [1, 2, 3];"],
  ["function", "const o = function f(a, b) {};"],
  ["bare", "const o = Object.create(null);"],
  ["heir", "const o = Object.create({ a: 1, c: 3 });"],
  ["frozen", "const o = Object.freeze({ a: 1 });"],
  ["sealed", "const o = Object.seal({ a: 1, b: 2 });"],
  ["fixed", "const o = Object.preventExtensions({ a: 1 });"],
  ["getter", "const o = {\n  get a() {\n    return 4;\n  },\n  set b(v) {\n    said.push('set' + tell(v));\n  },\n};"],
  ["typed", "const o = new Uint8Array([1, 2, 3]);"],
  ["arguments", "const o = (function () {\n  return arguments;\n})(1, 2);"],
  ["proxy", "const o = new Proxy({ a: 1 }, {});"],
  ["class", "class o {\n  static a = 1;\n  static m() {}\n}"],
  ["map", "const o = new Map([['a', 1]]);"],
  ["text", "const o = new String('abc');"],
  ["second", "const o = { a: 1 };\nconst p = { a: 1 };\np.a = 'x';"],
];
const keys: string[] = [
  "'a'",
  "'b'",
  "'z'",
  "0",
  "'0'",
  "1",
  "-1",
  "'-1'",
  "4294967294",
  "4294967295",
  "1.5",
  "''",
  "'length'",
  "'constructor'",
  "'__proto__'",
  "'name'",
  "sym",
  "Symbol.iterator",
  "Symbol.toPrimitive",
  "Symbol.toStringTag",
  "given",
  "'a' + given",
  "true",
  "null",
  "[1]",
  "{ toString: () => 'a' }",
  "'prototype'",
  "'toString'",
];
// Each changes `o` at KEY.
const changes: string[] = [
  "Object.defineProperty(o, KEY, { value: 7 });",
  "Object.defineProperty(o, KEY, { value: 7, writable: true, enumerable: true, configurable: true });",
  "Object.defineProperty(o, KEY, { get: () => 8, enumerable: true });",
  "Object.defineProperty(o, KEY, {\n  get() {\n    return tell(this === o);\n  },\n  configurable: true,\n});",
  "Object.defineProperty(o, KEY, { set(v) {}, enumerable: true });",
  "Object.defineProperty(o, KEY, {});",
  "Object.defineProperty(o, KEY, { enumerable: false });",
  "Object.defineProperties(o, { [KEY]: { value: 9, enumerable: true } });",
  "Object.defineProperties(o, { [KEY]: { value: 9, enumerable: true }, q: { get: () => 1, enumerable: true } });",
  "Object.defineProperties(o, { q: { value: 1 }, [KEY]: { get: () => 2 }, [sym]: { value: 's', enumerable: true } });",
  "const d = { [KEY]: { value: 5, writable: true, enumerable: true } };\nObject.defineProperties(o, d);",
  "Object.assign(o, { [KEY]: 6 });",
  "Object.assign(o, { x: 0, [KEY]: 6, [sym]: 's' });",
  "o[KEY] = 10;",
  "o[KEY] ??= 10;",
  "o[KEY] = typeof o[KEY] === 'number' ? o[KEY] + 1 : 1;",
  "o[KEY]++;",
  "delete o[KEY];",
  "Reflect.set(o, KEY, 11);",
  "say(Reflect.set(o, KEY, 11));",
  "say(Reflect.defineProperty(o, KEY, { value: 12, enumerable: true }));",
  "say(Reflect.deleteProperty(o, KEY));",
  "o[KEY] = 1;\nObject.freeze(o);\no[KEY] = 2;",
  "o[KEY] = o;",
  "Object.setPrototypeOf(o, { [KEY]: 'inherited' });",
  "o.__proto__ = { [KEY]: 'inherited' };",
  "Object.defineProperty(o, KEY, Object.getOwnPropertyDescriptor({ get a() {\n  return 3;\n} }, 'a'));",
  "const { [KEY]: taken, ...rest } = o;\nsay(taken, Object.keys(rest).length);",
  "o.__defineGetter__(KEY, () => 13);",
  "[o[KEY], o.w] = [1, 2];",
  "for (o[KEY] of [1, 2]) {\n}",
  "({ [KEY]: o.w } = o);",
];
const asks: string[] = [
  "say(o[KEY]);",
  "say(Object.keys(o).join());",
  "say(JSON.stringify(Object.entries(o)));",
  "say(Object.values(o).length);",
  "let names = '';\nfor (const k in o) names += k + ',';\nsay(names);",
  "say(Reflect.ownKeys(o).map(String).join());",
  "say(Object.getOwnPropertyNames(o).join());",
  "say(Object.getOwnPropertySymbols(o).length);",
  "const c = { ...o };\nsay(Reflect.ownKeys(c).map(String).join());",
  "const c = Object.assign({}, o);\nsay(c[KEY]);",
  "say(KEY in o, Object.hasOwn(o, KEY));",
  "const d = Object.getOwnPropertyDescriptor(o, KEY);\nsay(d?.writable, d?.enumerable, d?.configurable, 'get' in (d ?? {}));",
  "say(Object.prototype.propertyIsEnumerable.call(o, KEY));",
  "o[KEY] = 20;\nsay(o[KEY]);",
  "'use strict';\ntry {\n  o[KEY] = 21;\n  say('stored');\n} catch (e) {\n  say(e.name);\n}",
  "say(delete o[KEY], o[KEY]);",
  "say(Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o));",
  "say(JSON.stringify(Object.getOwnPropertyDescriptors({ ...o })).length);",
  "say(o.length, o.a);",
  "say(o.a, o.b);",
  "say(Object.fromEntries(Object.entries(o))[KEY]);",
  "const { [KEY]: v = 'absent' } = o;\nsay(v);",
  "say(typeof o[KEY]);",
  "say(Reflect.get(o, KEY), Reflect.has(o, KEY));",
  "say(o?.[KEY]?.toString?.().length);",
  "o.late = 1;\nsay(o.late, o[KEY]);",
  "const p = Object.create(o);\np[KEY] = 30;\nsay(p[KEY], o[KEY], Object.hasOwn(p, KEY));",
  "class H {\n  constructor() {\n    return o;\n  }\n}\nclass G extends H {\n  f = 1;\n}\ntry {\n  new G();\n} catch (e) {\n  say(e.name);\n}\nsay(o.f, o[KEY]);",
];
const places: [name: string, text: string][] = [
  ["once", "RECEIVER\nCHANGE\nASK"],
  ["loop", "for (let i = 0; i < n; i++) {\n  RECEIVER\n  CHANGE\n  ASK\n}"],
  [
    "one-receiver",
    "RECEIVER\nfor (let i = 0; i < n; i++) {\n  try {\n    CHANGE\n  } catch (e) {\n    say(e.name);\n  }\n  ASK\n}",
  ],
  [
    "helpers",
    "RECEIVER\nconst change = o => {\n  CHANGE\n};\nconst ask = o => {\n  ASK\n};\nask(o);\nchange(o);\nask(o);\nask({ a: 5 });",
  ],
  ["some", "for (let i = 0; i < n; i++) {\n  RECEIVER\n  if (i % 2) {\n    CHANGE\n  }\n  ASK\n}"],
];
const total = receivers.length * keys.length * changes.length * asks.length * places.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 1_411_201;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const receiver = pick(receivers);
  const key = pick(keys);
  const change = pick(changes);
  const ask = pick(asks);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isKept = cell % 7 === 3;
  const put = (text: string) => text.replaceAll("KEY", () => (isKept ? "key" : key));
  const block = (text: string) => (/^(const|let|class) /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
  const body = within(
    within(within(place[1], "RECEIVER", receiver[1]), "CHANGE", block(put(change))),
    "ASK",
    block(put(ask)),
  );
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v).slice(0, 90));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    "const sym = Symbol('s');",
    `function run(given, n) {\n${indent((isKept ? `const key = ${key};\n` : "") + body, "  ")}\n}`,
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    "said0(() => run('a', 3));",
    "said0(() => run(1, 2));",
    'console.log(said.join(" ").slice(0, 1400));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${receiver[0]}--${keys.indexOf(key)}--${changes.indexOf(change)}--${asks.indexOf(ask)}--${place[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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

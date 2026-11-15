// The least classes of two members: each member, times each other, times what is done with an instance, times how the instance is made, times where, with nothing beside.
//
//   bun write-two-members-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<first>--<second>--<use>--<made>--<place>.mjs, .cjs or .ts
//   bun write-two-members-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const members: string[] = [
  "a = 1;",
  "a = 0.5;",
  "a;",
  "a = [1, 2];",
  "a = { v: 1 };",
  "a = () => this.b;",
  "a = this.b;",
  "b = 2;",
  "b = 't';",
  "['a'] = 3;",
  "[key] = 4;",
  "#p = 1;\nget a() {\n  return this.#p;\n}\nset a(v) {\n  this.#p = v;\n}",
  "get a() {\n  return 7;\n}",
  "set a(v) {\n  this.b = v;\n}",
  "get b() {\n  return this.a;\n}",
  "static a = 5;",
  "static b = 't';",
  "static a() {\n  return this.b;\n}",
  "static get a() {\n  return 8;\n}",
  "static {\n  this.a = 9;\n}",
  "a() {\n  return 1;\n}",
  "a(v) {\n  return this.b ?? v;\n}",
  "b() {\n  return this.a;\n}",
  "*a() {\n  yield 1;\n  yield this.b;\n}",
  "async a() {\n  return 1;\n}",
  "constructor(v) {\n  this.a = v;\n}",
  "constructor(v) {\n  this.a = v;\n  this.b = v;\n}",
  "constructor() {\n  return { a: 'other' };\n}",
  "constructor(...all) {\n  this.a = all.length;\n}",
  "toString() {\n  return 'S' + this.a;\n}",
  "valueOf() {\n  return 3;\n}",
  "[Symbol.iterator]() {\n  return [1, 2][Symbol.iterator]();\n}",
  "[Symbol.toPrimitive](h) {\n  return h === 'number' ? 4 : 'p';\n}",
  "get [Symbol.toStringTag]() {\n  return 'T';\n}",
  "toJSON() {\n  return this.a ?? 'j';\n}",
  "get length() {\n  return 2;\n}",
  "then(f) {\n  f(1);\n}",
  "static [Symbol.hasInstance](v) {\n  return v === 1;\n}",
  "static of(v) {\n  return new this(v);\n}",
  "a = new.target;",
  "b = function () {\n  return this?.a;\n};",
  "static #q = 1;\nstatic a() {\n  return C.#q++;\n}",
  "a = 2147483647;",
  "b = undefined;",
  "get a() {\n  throw new RangeError('g');\n}",
  "arguments = 3;",
  "name = 'n';",
  "static name = 'sn';",
  "constructorless = 1;",
  "a = C.b;",
];
// `o` is the instance, C the class, `x` a number.
const uses: string[] = [
  "say(o.a);",
  "say(o.b);",
  "o.a = x;\nsay(o.a);",
  "o.b = x;\nsay(o.b);",
  "o.c = x;\nsay(o.c);",
  "o.a++;\nsay(o.a);",
  "o.b += 't';\nsay(o.b);",
  "delete o.a;\nsay(o.a);",
  "say(Object.keys(o).join());",
  "say(JSON.stringify(o));",
  "say('a' in o, 'b' in o);",
  "say(Object.hasOwn(o, 'a'));",
  "say(o instanceof C);",
  "say(typeof o.a, typeof o.b);",
  "say(C.a, C.b);",
  "C.a = x;\nsay(C.a);",
  "say(o.a?.(x));",
  "say(o.b?.());",
  "say(C.a?.());",
  "const { a, b = 'd' } = o;\nsay(a, b);",
  "const m = o.a;\ntry {\n  say(typeof m === 'function' ? m(x) : m);\n} catch (e) {\n  say(e.name);\n}",
  "say([...Object.entries(o)].length);",
  "const p = { ...o };\nsay(p.a, p.b, p instanceof C);",
  "const p = Object.create(o);\np.a = x;\nsay(p.a, o.a);",
  "class D extends C {\n  a = super.a;\n}\nsay(new D(x).a);",
  "class D extends C {\n  b() {\n    return super.b?.() ?? this.a;\n  }\n}\nsay(new D(x).b());",
  "class D extends C {\n  constructor(v) {\n    super(v, v);\n    this.z = v;\n  }\n}\nsay(new D(x).z, new D(x).a);",
  "say(String(o).slice(0, 20));",
  "say(+o || 0);",
  "say(o + '');",
  "say(`${o}`.length);",
  "say(o == 3, o > 2);",
  "try {\n  say([...o].join());\n} catch (e) {\n  say(e.name);\n}",
  "for (const k in o) say(k);",
  "say(Object.getOwnPropertyNames(C.prototype).join());",
  "say(Object.getOwnPropertyNames(C).filter(k => k !== 'length').join());",
  "Object.freeze(o);\ntry {\n  o.a = x;\n} catch (e) {\n  say(e.name);\n}\nsay(o.a);",
  "Object.defineProperty(o, 'a', { value: x, configurable: true });\nsay(o.a);",
  "C.prototype.a = x;\nsay(o.a);",
  "C.prototype.b = function () {\n  return 'late';\n};\nsay(typeof o.b);",
  "Object.setPrototypeOf(o, { a: 'up' });\nsay(o.a);",
  "say([o, o].map(v => v.a).join());",
  "say([1].map(() => o.a)[0]);",
  "const q = [new C(1), o, new C(2)];\nsay(q.map(v => v.b).length);",
  "say(o[key]);",
  "o[key] = x;\nsay(o[key]);",
  "say(C.of?.(x)?.a);",
  "say(new C(x).a, new C().b);",
  "say(Reflect.ownKeys(o).length);",
  "say(o.constructor === C);",
  "say(structuredClone({ v: typeof o.a }).v);",
  "say(C.name, C.length);",
  "const s = new Set([o, o]);\nsay(s.size);",
  "say(o?.a?.v, o?.zz?.v);",
  "say(Object.is(o.a, o.a));",
  "o.a ??= x;\nsay(o.a);",
  "o.b ||= x;\nsay(o.b);",
  "say(Object.getOwnPropertyDescriptor(o, 'a')?.writable);",
  "say(Object.prototype.toString.call(o));",
  "await0(o);",
];
const made: [name: string, text: string][] = [
  ["new", "const o = new C(x);"],
  ["reflected", "const o = Reflect.construct(C, [x]);"],
  ["heir", "class H extends C {}\nconst o = new H(x);"],
  ["either", "const o = x & 1 ? new C(x) : new (class extends C {\n  z = 1;\n})(x);"],
  ["listed", "const o = [new C(0), new C(x)][1];"],
  ["kept", "const o = (kept ??= new C(x));"],
];
const places: [name: string, text: string][] = [
  ["once", "const x = 1;\nUSE"],
  ["loop", "for (let x = 0; x < n; x++) {\n  USE\n}"],
  ["three", "for (let x = 0; x < 3; x++) {\n  USE\n}"],
  ["try", "for (let x = 0; x < n; x++) {\n  try {\n    USE\n  } catch (e) {\n    say(e.name);\n  }\n}"],
  ["closure", "[0, 1, 2].forEach(x => {\n  USE\n});"],
];
const total = members.length * members.length * uses.length * made.length * places.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 2_812_501;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const first = pick(members);
  const use = pick(uses);
  const second = pick(members);
  const make = pick(made);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && !/freeze|delete|defineProperty/.test(use);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const hasConstructors = /^constructor\(/.test(first) && /^constructor\(/.test(second);
  const hasPrivates = /#/.test(first) && /#/.test(second);
  const both = hasConstructors || hasPrivates || first === second ? [first] : [first, second];
  const body = within(place[1], "USE", [make[1], use].join("\n"));
  const all = both.join("\n") + body;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    ...(/\bkey\b/.test(all) ? ["let key = 'a';"] : []),
    ...(/\bkept\b/.test(all) ? ["let kept;"] : []),
    ...(/\bawait0\(/.test(all)
      ? [
          "const await0 = o => void Promise.resolve(o).then(v => console.log('awaited', tell(v)), e => console.log('failed', e?.name));",
        ]
      : []),
    `class C {\n${indent(both.join("\n"), "  ")}\n}`,
    `function run(n) {\n${indent(body, "  ")}\n}`,
    "try {",
    "  run(3);",
    "} catch (error) {",
    "  say(error.name);",
    "}",
    'console.log(said.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${members.indexOf(first)}--${members.indexOf(second)}--${uses.indexOf(use)}--${make[0]}--${place[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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

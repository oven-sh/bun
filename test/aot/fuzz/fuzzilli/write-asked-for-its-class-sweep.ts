// What a loop asks by `instanceof`: how the question is written, times how the three classes are written, times who stands in the list, times what is done to a class or to an element and when, times the loop, times how the function is reached.
//
//   bun write-asked-for-its-class-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<question>--<classes>--<list>--<what is done>--<when>--<loop>--<reached>.cjs
//   bun write-asked-for-its-class-sweep.ts count
//   bun write-asked-for-its-class-sweep.ts named <pattern> <folder> [most]
//
// `x instanceof Circle` reads `Circle[Symbol.hasInstance]` and `Circle.prototype` and walks the chain of `x`. A compiler may answer by the shape of `x` for as long as nobody has laid a `Symbol.hasInstance`, exchanged a
// prototype or moved an object to another chain, and may ask in front of a loop whether that still holds.
import { mkdirSync, writeFileSync } from "node:fs";

// K1, K2 and K3 are the classes in the order in which they are asked for, F1, F2 and F3 the fields that their constructors store.
const questions: [name: string, callee: string, asked: string][] = [
  [
    "a-chain-in-a-callee",
    "function kind(s) { return s instanceof K1 ? (s.F1 ?? 10000) : s instanceof K2 ? (s.F2 ?? 20000) : s instanceof K3 ? (s.F3 ?? 30000) : 100000; }",
    "kind(x)",
  ],
  [
    "returns-in-a-callee",
    "function kind(s) { if (s instanceof K1) return s.F1 ?? 10000; if (s instanceof K2) return s.F2 ?? 20000; if (s instanceof K3) return s.F3 ?? 30000; return 100000; }",
    "kind(x)",
  ],
  [
    "a-chain-in-the-turn",
    "",
    "(x instanceof K1 ? (x.F1 ?? 10000) : x instanceof K2 ? (x.F2 ?? 20000) : x instanceof K3 ? (x.F3 ?? 30000) : 100000)",
  ],
  [
    "denied-first",
    "function kind(s) { if (!(s instanceof K1)) return s instanceof K2 ? (s.F2 ?? 20000) : s instanceof K3 ? (s.F3 ?? 30000) : 100000; return s.F1 ?? 10000; }",
    "kind(x)",
  ],
  [
    "joined-by-and-and-or",
    "function kind(s) { return s instanceof K1 && s.F1 > 2 ? 1 : s instanceof K2 || s instanceof K3 ? 50 : 1000; }",
    "kind(x)",
  ],
  [
    "the-answers-are-kept",
    "function kind(s) { const first = s instanceof K1, second = s instanceof K2; return first ? (s.F1 ?? 10000) : second ? (s.F2 ?? 20000) : 100000; }",
    "kind(x)",
  ],
];

const apart =
  "class A { constructor(d) { this.a = d.a; } }\nclass B { constructor(d) { this.b = d.b; this.more = 1; } }\nclass C { constructor(d) { this.c = d.c; this.more = 2; this.last = 3; } }";
const heirs =
  "class A { constructor(d) { this.a = d.a; } }\nclass B extends A { constructor(d) { super(d); this.b = d.b; } }\nclass C extends B { constructor(d) { super(d); this.c = d.c; } }";
const classes: [name: string, written: string, order: string][] = [
  ["three-classes", apart, "A B C"],
  [
    "three-functions",
    "function A(d) { this.a = d.a; }\nfunction B(d) { this.b = d.b; this.more = 1; }\nfunction C(d) { this.c = d.c; this.more = 2; this.last = 3; }",
    "A B C",
  ],
  ["heirs-asked-from-the-base", heirs, "A B C"],
  ["heirs-asked-from-the-last", heirs, "C B A"],
  [
    "three-classes-of-one-text",
    'const make = f => class { constructor(d) { this[f] = d[f]; } };\nconst A = make("a"), B = make("b"), C = make("c");',
    "A B C",
  ],
  [
    "heirs-of-built-ins",
    "class A extends Array { constructor(d) { super(); this.a = d.a; } }\nclass B extends Map { constructor(d) { super(); this.b = d.b; } }\nclass C extends Error { constructor(d) { super(); this.c = d.c; } }",
    "A B C",
  ],
  ["the-third-is-bound", `${apart}\nconst Bound = C.bind(null);`, "A B Bound"],
  [
    "the-second-answers-for-itself",
    apart.replace(
      "class B {",
      'class B { static [Symbol.hasInstance](o) { hits++; return typeof o === "object" && o !== null && "b" in o; }',
    ),
    "A B C",
  ],
];

// What stands at `i`, made of the row `d`. Every fourth is the stranger; the element at 5, which the deeds reach for, is always an instance.
const one = "new makers[i % 3](d)";
const lists: [name: string, made: string][] = [
  ["two-of-the-three", "new makers[i % 2](d)"],
  ["all-three", one],
  ["records-out-of-data-among-them", `i % 4 === 3 ? d : ${one}`],
  ["primitives-among-them", `i % 4 === 3 ? [7, "text", null][i >> 2] : ${one}`],
  ["objects-below-null-among-them", `i % 4 === 3 ? Object.assign(Object.create(null), d) : ${one}`],
  ["proxies-over-instances-among-them", `i % 4 === 3 ? new Proxy(${one}, {}) : ${one}`],
  [
    "instances-below-a-proxy-among-them",
    `i % 4 === 3 ? Object.setPrototypeOf(${one}, new Proxy(makers[i % 3].prototype, {})) : ${one}`,
  ],
  ["objects-below-instances-among-them", `i % 4 === 3 ? Object.create(${one}) : ${one}`],
  [
    "a-revoked-proxy-in-one-chain",
    `i === 7 ? (() => { const made = Proxy.revocable({}, {}), below = Object.setPrototypeOf(${one}, made.proxy); made.revoke(); return below; })() : ${one}`,
  ],
];

const lays = (on: string, entry: string) =>
  `far(Object).defineProperty(far(${on}), far(Symbol).hasInstance, { ${entry}, configurable: true });`;
const deeds: [name: string, done: string][] = [
  ["has-instance-is-laid-on-the-first-and-denies", lays("K1", "value(o) { hits++; return false; }")],
  ["has-instance-is-laid-on-the-third-and-affirms", lays("K3", "value(o) { hits++; return true; }")],
  ["a-getter-of-has-instance-is-laid-on-the-second", lays("K2", "get() { hits++; return undefined; }")],
  ["an-element-ahead-is-laid-below-the-second", "far(Object).setPrototypeOf(all[5], K2.prototype);"],
  ["an-element-ahead-is-laid-below-null", "far(Object).setPrototypeOf(all[5], null);"],
  [
    "the-prototype-of-the-second-is-laid-below-that-of-the-first",
    "try { far(Object).setPrototypeOf(K2.prototype, K1.prototype); } catch { hits += 100; }",
  ],
  [
    "the-first-is-given-the-prototype-of-the-second",
    "try { far(K1).prototype = K2.prototype; } catch { hits += 100; }",
  ],
  ["an-element-ahead-is-exchanged-for-a-record", "all[5] = { a: 1, b: 20, c: 300 };"],
];
const moments = ["before-the-first-call", "between-two-calls", "in-the-second-turn-of-the-third-call"];
const happenings: [deed: string, done: string, when: string][] = [
  ["nothing-is-done", "", "never"],
  ...deeds.flatMap(([deed, done]) => moments.map(when => [deed, done, when] as [string, string, string])),
];

const loops: [name: string, head: string][] = [
  ["for-of", "for (const x of list) {"],
  ["counted", "for (let i = 0; i < list.length; i++) { const x = list[i];"],
];
const ways = ["under-a-key-out-of-data", "in-sight"];

const all = questions.length * classes.length * lists.length * happenings.length * loops.length * ways.length;

function write(at: number) {
  const pick = <T>(from: T[]) => {
    const each = from[at % from.length];
    at = Math.floor(at / from.length);
    return each;
  };
  const reached = pick(ways),
    [loop, head] = pick(loops),
    [deed, done, when] = pick(happenings),
    [list, made] = pick(lists),
    [kinds, written, order] = pick(classes),
    [question, callee, asked] = pick(questions);
  const names = order.split(" ");
  const named = (text: string) =>
    text
      .replace(/\bK([123])\b/g, (_, k) => names[k - 1])
      .replace(/\bF([123])\b/g, (_, k) => names[k - 1].replace("Bound", "C").toLowerCase());
  const inTheTurn = when === moments[2];
  const calls = ["ask();", "ask();", "ask();", "ask();"];
  if (when === moments[0]) calls.unshift("deed();");
  if (when === moments[1]) calls.splice(2, 0, "deed();");
  if (inTheTurn) calls.splice(2, 0, "armed = true;");
  return {
    name: `${question}--${kinds}--${list}--${deed}--${when}--${loop}--${reached}.cjs`,
    text: `"use strict";
let hits = 0, turns = 0, armed = false;
const far = v => [v][JSON.parse("0")];
${written}
const makers = [A, B, C];
const rows = JSON.parse(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ a: (i % 5) + 1, b: ((i % 4) + 1) * 10, c: ((i % 6) + 2) * 100 }))));
const all = rows.map((d, i) => ${made});
function deed() { ${named(done)} }
const trip = { get wire() { if (armed && ++turns === 2) deed(); return 0; } };
${named(callee)}
function walk(list) { let sum = 0; ${head} sum += ${inTheTurn ? "trip.wire + " : ""}${named(asked)}; } return sum; }
const go = ${reached === "in-sight" ? "walk" : `{ walk, idle() { return 0; } }[JSON.parse('"walk"')]`};
function ask() {
  let said;
  try { said = String(go(all)); } catch (error) {
    said = "threw " + error.name;
    try { said += " behind " + go(all.slice(0, 7)); } catch { said += " twice"; }
  }
  console.log(said + " / " + hits);
}
${calls.join("\n")}
`,
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}

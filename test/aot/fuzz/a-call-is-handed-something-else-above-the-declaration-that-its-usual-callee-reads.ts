// Small programs about one place that calls, constructs or asks a member of whatever it is handed. Forty times it is handed one function, class or object of the program. Once, at the top of the file,
// it is handed something else that answers to the same use, and that first run stands above the `let`, `const` or `class` that the usual one reads. The same other thing comes once more at the end.
//
//   the place        a call: alone, in a loop, in two loops, in a `try`, in a callback of `map`, `some`, `forEach`, `reduce`, `sort`, in an iterator helper, beside a generator, `?.()`, `.call`, `Reflect.apply`,
//                    as a member, on both sides of a condition, in the tail of a strict function, in a template; `new`; `super(..)`; two members asked by name
//   something else   a proxy, a bound function, a bound built-in, a function or a class made of text, evaluated text, a proxy with a trap; an object without a prototype, a parsed one, one with an accessor,
//                    one that inherits its members; a parent that `Object.setPrototypeOf` puts in the place of the written one
//   what is read     a text, a text that is appended to, an object, an object in an object, a class, a closure, lists, a number, a map, a set, a pattern, bytes, a big integer, a symbol, a date, a getter
import type { Random } from "./random";

const worlds = [
  [`let W = "abc";`, `W.length`],
  [`let W = "";`, `(W += "x").length`],
  [`const W = { a: 1, b: 2 };`, `W.a + W.b`],
  [`const W = { p: { q: [4, 5] } };`, `W.p.q[1]`],
  [`class W {\nstatic s = 5;\nx = 2;\nm() {\nreturn this.x + W.s;\n}\n}`, `new W().m()`],
  [`const adder = n => m => n + m;\nconst W = adder(1);`, `W(2)`],
  [`const W = [1, 2, 3];`, `W[1] + W.length`],
  [`const W = [1.5, 2.5];`, `W[0] + W[1]`],
  [`let W = 41;`, `W + 1`],
  [`const W = new Map([[1, 2]]);`, `W.get(1) + W.size`],
  [`const W = new Set([1, 2]);`, `W.size + (W.has(2) ? 1 : 0)`],
  [`const W = /a+/;`, `(W.test("caab") ? 3 : 4)`],
  [`const W = new Uint8Array([7, 8, 9]);`, `W[2] + W.length`],
  [`const W = 10n;`, `Number(W + 1n)`],
  [`const S = Symbol("s");\nconst W = { [S]: 6 };`, `W[S]`],
  [`const W = new Date(5);`, `W.getTime()`],
  [`const W = function inner() {\nreturn 9;\n};`, `W() + W.length`],
  [`const W = {\nget v() {\nreturn 3;\n},\n};`, `W.v`],
  [`const W = Object.freeze({ a: 8 });`, `W.a`],
  [`let W = "ab",\nY = "cd";`, `(W + Y).length`],
  [`var W = { k: 2 };`, `W.k`],
] as const;

const turns = [
  (body: string) => body,
  (body: string) => `for (let i = 0; i < 3; i++) {\n${body}\n}`,
  (body: string) =>
    `for (let i = 0; i < 3; i++) {\ntry {\n${body}\n} catch (e) {\ns += "!" + e.constructor.name;\n}\n}`,
] as const;

function usual(use: string, other: string, declaration: string, made: string, name: string, more = ""): string {
  return `const other = ${other};
console.log(String(${use}(other)));
${declaration}
${made}
let total = "";
for (let i = 0; i < 40; i++) total = String(${use}(${name}));
console.log(total, String(${use}(other)), String(${use}(${name}))${more});
`;
}

function call(random: Random, declaration: string, read: string): string {
  const other = random.pick([
    `new Proxy(function () {\nreturn 1;\n}, {})`,
    `function () {\nreturn 1;\n}.bind(null)`,
    `new Function("return 1")`,
    `(0, eval)("(function () { return 1; })")`,
    `Math.max.bind(null, 1)`,
    `new Proxy(() => 1, {\napply() {\nreturn 1;\n},\n})`,
  ]);
  const site = random.pick([
    `function use(f) {\nreturn f();\n}`,
    `function use(f) {\nlet s = 0;\nfor (let i = 0; i < 3; i++) s += f();\nreturn s;\n}`,
    `function use(f) {\nlet s = 0,\ni = 0;\nwhile (i++ < 3) {\ntry {\ns += f();\n} catch (e) {\ns += 100;\n}\n}\nreturn s;\n}`,
    `function use(f) {\nlet s = 0;\nfor (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) s += f();\nreturn s;\n}`,
    `function use(f) {\nreturn [1, 2, 3].map(() => f()).join();\n}`,
    `function use(f) {\nreturn [1, 2, 3].map(f).join();\n}`,
    `function use(f) {\nreturn [1, 2].some(f);\n}`,
    `function use(f) {\nlet s = 0;\n[1, 2].forEach(() => {\ns += f();\n});\nreturn s;\n}`,
    `function use(f) {\nreturn [1, 2].reduce(a => a + f(), 0);\n}`,
    `function use(f) {\nreturn [1, 2]\n.values()\n.map(() => f())\n.toArray()\n.join();\n}`,
    `function* twice() {\nyield 1;\nyield 2;\n}\nfunction use(f) {\nlet s = 0;\nfor (const x of twice()) s += f();\nreturn s;\n}`,
    `function use(f) {\nlet s = 0;\nfor (let i = 0; i < 3; i++) s += f?.() ?? 0;\nreturn s;\n}`,
    `function use(f) {\nlet s = 0;\nfor (let i = 0; i < 3; i++) s += f.call(undefined);\nreturn s;\n}`,
    `function use(f) {\nlet s = 0;\nfor (let i = 0; i < 3; i++) s += Reflect.apply(f, undefined, []);\nreturn s;\n}`,
    `function use(f) {\nconst o = { m: f };\nlet s = 0;\nfor (let i = 0; i < 3; i++) s += o.m();\nreturn s;\n}`,
    `function use(f, n = 3) {\nlet s = 0;\nfor (let i = 0; i < n; i++)\nif (i & 1) s += f();\nelse s += 2 * f();\nreturn s;\n}`,
    `function use(f) {\nreturn [3, 1, 2].sort(() => f() - f()).join();\n}`,
    `"use strict";\nfunction use(f) {\nreturn f();\n}`,
    'function use(f) {\nlet s = "";\nfor (let i = 0; i < 3; i++) s += `${f()},`;\nreturn s;\n}',
    `function use(f) {\nlet s = 0,\ni = 0;\ndo s += f();\nwhile (++i < 3);\nreturn s;\n}`,
  ]);
  return `${site}\n${usual("use", other, declaration, `function g() {\nreturn ${read};\n}`, "g")}`;
}

function construction(random: Random, declaration: string, read: string): string {
  const other = random.pick([
    `new Proxy(\nclass {\nv = 1;\n},\n{},\n)`,
    `class {\nv = 1;\n}.bind(null)`,
    `function () {\nthis.v = 1;\n}.bind(null)`,
    `new Function("this.v = 1")`,
    `new Proxy(function () {}, {\nconstruct() {\nreturn { v: 1 };\n},\n})`,
  ]);
  const made = random.pick([
    `class K {\nv = ${read};\n}`,
    `class K {\nconstructor() {\nthis.v = ${read};\n}\n}`,
    `function K() {\nthis.v = ${read};\n}`,
    `class Base {\nb = 1;\n}\nclass K extends Base {\nv = ${read};\n}`,
    `class Base {\nconstructor(x) {\nthis.b = x;\n}\n}\nclass K extends Base {\nconstructor(...a) {\nsuper(...a);\nthis.v = ${read};\n}\n}`,
    `function K() {\nreturn { v: ${read} };\n}`,
    `class K {\nstatic t = ${read};\nv = K.t;\n}`,
  ]);
  return `function use(C) {\nlet s = "";\n${random.pick(turns)(`s += new C(4).v;`)}\nreturn s;\n}\n${usual("use", other, declaration, made, "K")}`;
}

function parent(random: Random, declaration: string, read: string): string {
  const other = random.pick([
    `function () {\nthis.p = "other";\n}`,
    `class {\np = "other";\n}`,
    `new Proxy(\nclass {\np = "other";\n},\n{},\n)`,
    `class {\np = "other";\n}.bind(null)`,
    `function () {\nreturn { p: "made" };\n}`,
  ]);
  const [below, derived] = random.pick([
    ["D", `class D extends P {\nd = 1;\n}`],
    ["D", `class D extends P {\nconstructor(x) {\nsuper(x);\nthis.d = 1;\n}\n}`],
    ["D", `class D extends P {\nconstructor(...a) {\nsuper(...a);\nthis.d = a.length;\n}\n}`],
    ["D", `class D extends P {\nconstructor(x) {\nconst go = () => super(x);\ngo();\nthis.d = 1;\n}\n}`],
    ["M", `class M extends P {\nm = 2;\n}\nclass D extends M {\nd = 1;\n}`],
  ] as const);
  const swap = `Object.setPrototypeOf(${below}, other);`;
  const back = `Object.setPrototypeOf(${below}, P);`;
  return `function use() {
let s = "";
for (let i = 0; i < 2; i++) {
try {
s += JSON.stringify(new D(i));
} catch (e) {
s += e.constructor.name;
}
}
return s;
}
class P {
constructor(x) {
this.p = reads();
this.x = x;
}
}
${derived}
function reads() {
return ${read};
}
const other = ${other};
${random.chance(0.5) ? `${swap}\nconsole.log(use());\n${back}` : ""}
${declaration}
let total = "";
for (let i = 0; i < 40; i++) total = use();
console.log(total);
${swap}
console.log(use());
${back}
console.log(use());
`;
}

function members(random: Random, declaration: string, read: string): string {
  const both = `next() {\nreturn 1;\n},\ndone() {\nreturn 2;\n},`;
  const other = random.pick([
    `new Proxy({\n${both}\n}, {})`,
    `Object.assign(Object.create(null), {\n${both}\n})`,
    `Object.assign(JSON.parse("{}"), {\n${both}\n})`,
    `{\nget next() {\nreturn () => 1;\n},\ndone() {\nreturn 2;\n},\n}`,
    `{\nnext: function () {\nreturn 1;\n}.bind(null),\ndone: function () {\nreturn 2;\n}.bind(null),\n}`,
    `Object.create({\n${both}\n})`,
    `new (new Function("return class { next() { return 1; } done() { return 2; } }")())()`,
  ]);
  const made = random.pick([
    `const R = {\nnext() {\nreturn ${read};\n},\ndone() {\nreturn 0;\n},\n};`,
    `class RK {\nnext() {\nreturn ${read};\n}\ndone() {\nreturn 0;\n}\n}\nconst R = new RK();`,
    `const R = { next: () => ${read}, done: () => 0 };`,
    `class RK {\nnext = () => ${read};\ndone = () => 0;\n}\nconst R = new RK();`,
  ]);
  return `function use(r) {\nlet s = "";\n${random.pick(turns)(`s += r.next() + r.done();`)}\nreturn s;\n}\n${usual("use", other, declaration, made, "R")}`;
}

function boundMethod(random: Random, declaration: string, read: string): string {
  const other = random.pick([
    `new Proxy(function () {\nreturn 1;\n}, {})`,
    `() => 1`,
    `function () {\nreturn this.k;\n}.bind({ k: 1 })`,
    `new Function("return 1")`,
  ]);
  const made = `class H {\nconstructor() {\nthis.k = 3;\nthis.m = this.m.bind(this);\n}\nm() {\nreturn this.k + ${read};\n}\n}\nconst h = new H();`;
  return `function use(f) {\nlet s = "";\n${random.pick(turns)(`s += f();`)}\nreturn s;\n}\n${usual("use", other, declaration, made, "h.m", `, String(use(H.prototype.m.bind({ k: 10 })))`)}`;
}

export function generate(random: Random): { file: string; text: string } {
  const [declaration, read] = random.pick(worlds);
  const make = random.weighted([
    [5, call],
    [2, construction],
    [2, parent],
    [2, members],
    [1, boundMethod],
  ] as const);
  return { file: "main.js", text: make(random, declaration, read) };
}

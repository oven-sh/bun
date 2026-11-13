// The least programs of two statements: each statement, times each other, times where they stand, times what the variables hold first, with nothing beside.
//
//   bun write-two-statements-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<first>--<second>--<place>--<start>--<scope>.mjs or .ts
//   bun write-two-statements-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `x` is a number, `t` a text, `l` a list, `o` an object, `f` a function, at first.
const statements: string[] = [
  "x++;",
  "x += 1.5;",
  "x = -x;",
  "x = x | 0;",
  "x = x >>> 0;",
  "x = x * 3 % 7;",
  "x = ~x;",
  "x **= 2;",
  "x = Math.max(x, 2);",
  "x = Math.round(x / 2);",
  "x = Number(t.length);",
  "x = parseInt(t, 10) || 0;",
  "x = l.length;",
  "x = l[0] ?? 0;",
  "x = o.a ?? 1;",
  "x = f(x);",
  "x = x > 3 ? 0 : x + 1;",
  "x = NaN;",
  "x = -0;",
  "x = 2147483647;",
  "x += 2147483647;",
  "x = undefined ?? x;",
  "x = +true;",
  "x ||= 4;",
  "x &&= x - 1;",
  "x ??= 2;",
  "t += 'b';",
  "t = t + x;",
  "t = x + t;",
  "t = t.slice(1);",
  "t = t.slice(-1);",
  "t = t.toUpperCase();",
  "t = `${t}-${x}`;",
  "t = t.replace('a', 'zz');",
  "t = t.split('').reverse().join('');",
  "t = t[0] ?? '';",
  "t = String(l);",
  "t = t.padEnd(4, '.');",
  "t = typeof l[1];",
  "t = t.trim() + t.length;",
  "t = JSON.stringify(o);",
  "t = t.repeat(2).slice(0, 6);",
  "t = [t, x].join('/');",
  "t = t.concat(x, true);",
  "t = '' + null;",
  "t = t.at(-1) + t.charCodeAt(0);",
  "l.push(x);",
  "l.pop();",
  "l.shift();",
  "l.unshift(x);",
  "l[l.length] = x;",
  "l[0] = t;",
  "l[5] = x;",
  "l.length = 1;",
  "l = [...l, x];",
  "l = [x, ...l];",
  "l = [...l, , x];",
  "l = l.concat([x]);",
  "l = l.map(v => v);",
  "l = l.filter(v => v !== x);",
  "l = l.slice(1);",
  "l.splice(0, 1, x, t);",
  "l.reverse();",
  "l.sort();",
  "l.fill(x, 0, 1);",
  "l = Array.from(l);",
  "l = l.flat();",
  "delete l[0];",
  "l = [];",
  "l = new Array(3);",
  "l = Array.of(x, t);",
  "[x, l[0]] = [l[0] ?? 0, x];",
  "l = Object.keys(o);",
  "l = Object.values(o);",
  "l = [...t];",
  "l.forEach((v, k) => { l[k] = k; });",
  "l = l.with?.(0, x) ?? l;",
  "l = [l];",
  "l = l.toSorted?.() ?? l;",
  "o.a = x;",
  "o.b = t;",
  "o.c = l;",
  "o[t] = x;",
  "o['a']++;",
  "delete o.a;",
  "o = { ...o, d: x };",
  "o = { a: x };",
  "o = { [t]: x, a: 1 };",
  "o = Object.assign({}, o, { e: 1 });",
  "o = Object.create(o);",
  "o.g = () => x;",
  "Object.defineProperty(o, 'a', { get: () => x, configurable: true });",
  "o = { a: 1, get b() { return this.a; } };",
  "({ a: x = 5, ...o } = o);",
  "o.a ??= 3;",
  "o = Object.fromEntries(Object.entries(o));",
  "o = new C(x);",
  "o.m?.(1);",
  "Object.freeze(o);",
  "o = o?.c ?? o;",
  "o = structuredClone({ a: x });",
  "o = JSON.parse(JSON.stringify(o));",
  "o = new Map([[t, x]]);",
  "o.set?.('k', x);",
  "f = v => v + 1;",
  "f = v => x;",
  "f = function (v) { return arguments.length; };",
  "f = o.g ?? f;",
  "f = ((g) => v => g(v))(f);",
  "f = f.bind(null, 2);",
  "f = (...all) => all.length;",
  "f = (v = x) => v;",
  "f = v => { x++; return x; };",
  "if (x > 2) t += '!';",
  "if (t === 'a') x = 9;",
  "for (const v of l) x += +v || 0;",
  "for (const k in o) t += k;",
  "for (let k = 0; k < 2; k++) x += k;",
  "switch (x) { case 1: t = 'one'; break; case 2: t = 'two'; default: t += '?'; }",
  "try { null.x; } catch (e) { t = e.name; }",
  "try { x = f(x); } finally { t += 'f'; }",
  "out.push(x === l[0]);",
  "out.push(x in l, 'a' in o);",
  "out.push(l.includes(x), l.indexOf(x));",
  "out.push(t < 'b', t == x);",
  "out.push(typeof x, typeof o.a);",
  "out.push(o instanceof C, Array.isArray(l));",
  "out.push([0].map(() => x)[0]);",
  "out.push(show([...l].map(v => typeof v)));",
  "const [p, q = 'd'] = l; out.push(show(p), show(q));",
  "const { a: p, b: q = 'e' } = o; out.push(show(p), show(q));",
  "out.push((() => { try { return x; } finally { x++; } })());",
  "outer: for (;;) { for (;;) { x++; break outer; } }",
  "out.push([...(function* () { yield x; yield t; })()].join());",
  "do { x++; } while (x < 2);",
  "x = l.reduce((s, v) => s + (+v || 0), 0);",
  "l.length && (t = String(l.at(-1)));",
  "x = [1, 2, 3].findIndex(v => v === x);",
  "t = Symbol('s').description + x;",
  "x = new Date(0).getTime() + x;",
  "l = new Uint8Array([x, 2]);",
  "l = new Float64Array(2).fill(x);",
  "x = l.byteLength ?? x;",
  "x = Number(BigInt(Math.trunc(x) || 0) * 2n);",
  "x = (function () { return arguments[0]; })(x);",
  "t = (tag => tag`a${x}b`)((s, v) => s[0] + v + s[1]);",
  "x = o.valueOf === undefined ? 1 : 2;",
  "x = /a+/.exec(t)?.index ?? -1;",
  "t = t.match(/[a-z]/g)?.join('') ?? 'no';",
  "x = [...t.matchAll(/a/g)].length;",
  "l = t.split(/[-/]/);",
  "x = new Set(l).size;",
  "l = [...new Set([x, x, t])];",
  "l = Array.from({ length: 2 }, (_, k) => k + x);",
  "x = Math.hypot(x, 3) | 0;",
  "x = x.toFixed ? +x.toFixed(1) : 0;",
  "class D extends C { m() { return super.m?.() ?? 7; } } x = new D(x).m();",
  "x = Reflect.has(o, 'a') ? 1 : 0;",
  "x = void 0 === x ? 1 : x;",
  "x = (x, 4);",
];
const places: [name: string, text: string][] = [
  ["behind", "A\nB"],
  ["loop", "for (let i = 0; i < n; i++) {\n  A\n  B\n}"],
  ["first-in-loop", "for (let i = 0; i < n; i++) {\n  A\n}\nB"],
  ["second-in-loop", "A\nfor (let i = 0; i < n; i++) {\n  B\n}"],
  ["sometimes", "for (let i = 0; i < n; i++) {\n  if (i & 1) {\n    A\n  } else {\n    B\n  }\n}"],
  [
    "try",
    "for (let i = 0; i < n; i++) {\n  try {\n    A\n    if (i === 1) throw new RangeError('r');\n    B\n  } catch (e) {\n    out.push(e.name);\n  }\n}",
  ],
  ["closure", "const g = () => {\n  A\n};\ng();\nB\ng();"],
  ["closures", "const g = [1].map(() => {\n  A\n  return () => {\n    B\n  };\n});\ng[0]();\ng[0]();"],
  ["twice", "A\nB\nA\nB"],
  ["branch", "if (n > 2) {\n  A\n}\nB"],
];
const starts: [name: string, text: string][] = [
  ["plain", "let x = 1;\nlet t = 'a';\nlet l = [1, 2];\nlet o = { a: 1, b: 't' };\nlet f = v => v;"],
  ["handed", "let x = given.x;\nlet t = given.t;\nlet l = given.l;\nlet o = given.o;\nlet f = given.f;"],
  ["fractions", "let x = 0.5;\nlet t = '';\nlet l = [0.5, 1.5];\nlet o = {};\nlet f = v => v + 0.5;"],
  ["kinds", "let x = given.x;\nlet t = 'ab';\nlet l = [1, 't', null];\nlet o = { a: undefined };\nlet f = given.f;"],
  [
    "parsed",
    "let x = JSON.parse('7');\nlet t = JSON.parse('\\\\\"p\\\\\"');\nlet l = JSON.parse('[1,2]');\nlet o = JSON.parse('{\\\\\"a\\\\\":1}');\nlet f = v => -v;",
  ],
  ["holes", "let x = -1;\nlet t = 'a-b';\nlet l = [1, , 3];\nlet o = { a: [1], c: { a: 2 } };\nlet f = given.f;"],
];
const scopes: [name: string, text: string][] = [
  ["once", "said(() => run({ x: 1, t: 'a', l: [1, 2], o: { a: 1 }, f: v => v }, 3));"],
  [
    "twice",
    "said(() => run({ x: 1, t: 'a', l: [1, 2], o: { a: 1 }, f: v => v }, 3));\nsaid(() => run({ x: 0.5, t: 'q', l: ['t'], o: { b: 2 }, f: () => 3 }, 1));",
  ],
  ["loop", "for (let k = 0; k < 4; k++) said(() => run({ x: k, t: 'a' + k, l: [k], o: { a: k }, f: v => k }, k));"],
];
const total = statements.length * statements.length * places.length * starts.length * scopes.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 2_880_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const first = pick(statements);
  const second = pick(statements);
  const place = pick(places);
  const start = pick(starts);
  const scope = pick(scopes);
  const isTyped = cell % 4 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const block = (text: string) => (/^(const|class|let) /.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
  const body = within(within(place[1], "A", block(first)), "B", block(second));
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "class C {\n  constructor(a) {\n    this.a = a;\n  }\n  m(v) {\n    return this.a;\n  }\n}",
    'const show = v => (typeof v === "function" ? "f" : typeof v === "symbol" ? "s" : Object.is(v, -0) ? "-0" : Array.isArray(v) || ArrayBuffer.isView(v) ? "[" + Array.from(v, w => (typeof w === "object" && w ? "o" : typeof w === "function" ? "f" : String(w))).join() + "]" + Object.keys(v).length : typeof v === "object" && v ? "{" + Object.keys(v).join() + "}" : String(v));',
    "const all = [];",
    `function run(given, n) {\n  const out = [];\n${indent(start[1], "  ")}\n${indent(body, "  ")}\n  out.push(x, t, l, o, f);\n  return out.map(show).join(" ");\n}`,
    "function said(of) {\n  try {\n    all.push(of());\n  } catch (error) {\n    all.push(error.name);\n  }\n}",
    scope[1],
    'console.log(all.join(" | ").slice(0, 1500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${statements.indexOf(first)}--${statements.indexOf(second)}--${place[0]}--${start[0]}--${scope[0]}.${isTyped ? "ts" : "mjs"}`,
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

// The least programs of one function and one call: each function, times each call, times what is handed over, times where, times how often.
//
//   bun write-function-call-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<function>--<call>--<values>--<place>--<scope>.mjs, .cjs or .ts
//   bun write-function-call-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const functions: string[] = [
  "const f = v => v;",
  "const f = v => v + 1;",
  "const f = (v, w) => v + w;",
  "const f = (v, w = 2) => v + w;",
  "const f = (v, w = v) => w;",
  "const f = (...all) => all.length;",
  "const f = (v, ...all) => all;",
  "const f = ([v, w = 3]) => v;",
  "const f = ({ a, b = 4 }) => a ?? b;",
  "const f = ({ a, ...r }) => Object.keys(r).length;",
  "function f(v) {\n  return arguments.length;\n}",
  "function f(v) {\n  arguments[0] = 9;\n  return v;\n}",
  "function f(v) {\n  return this?.a ?? typeof this;\n}",
  "function f(v) {\n  return new.target ? 1 : 0;\n}",
  "function f(v) {\n  if (!(v < 4)) return 'big';\n  return f(v + 1);\n}",
  "function f(v) {\n  return () => v;\n}",
  "function f(v) {\n  let c = v;\n  return () => ++c;\n}",
  "function f(v) {\n  v++;\n  return v;\n}",
  "function f(v) {\n  for (let k = 0; k < 2; k++) v += k;\n  return v;\n}",
  "function f(v) {\n  try {\n    return v.a.b;\n  } catch {\n    return 'caught';\n  }\n}",
  "function f(v) {\n  try {\n    return v;\n  } finally {\n    turns++;\n  }\n}",
  "function f(v) {\n  throw new RangeError('f' + v);\n}",
  "function f(v) {}",
  "function* f(v) {\n  yield v;\n  yield* [v, 2];\n  return 3;\n}",
  "async function f(v) {\n  return v;\n}",
  "const f = function (v) {\n  return v === undefined ? 'none' : [v, v];\n};",
  "const f = function self(v) {\n  return v > 0 && v < 5 ? self(v - 1) : v;\n};",
  "class f {\n  constructor(v) {\n    this.a = v;\n  }\n  m() {\n    return this.a;\n  }\n}",
  "const f = (v => w => v)(1);",
  "const f = ((v, w) => v).bind(null, 5);",
  "const f = { m(v) {\n  return this?.k ?? v;\n}, k: 6 }.m;",
  "const f = v => ({ a: v });",
  "const f = v => [v];",
  "const f = v => v > 1;",
  "const f = v => void turns++;",
  "const f = v => turns++ + (v | 0);",
  "const f = v => typeof v;",
  "const f = v => `${v}!`;",
  "const f = Math.max;",
  "const f = String;",
  "let f = v => v;\nconst late = () => {\n  f = v => 'late' + v;\n};",
  "var f = function (v) {\n  return kept ??= v;\n};",
  "const f = (v, i, l) => i ?? l?.length ?? v;",
  "const f = v => { switch (v) { case 1: return 'one'; case 't': return 't'; default: return v; } };",
  "const f = (a, b) => (a > b ? 1 : a < b ? -1 : 0);",
  "const f = v => Promise.resolve(v);",
  "const f = new Proxy(v => v, {});",
  "const f = v => { const { a = v } = {}; return a; };",
  "const f = (v, w = (() => v)()) => w;",
  "const f = v => eval1(v);",
];
// `x` and `y` are values, `l` is a list, `f` the function.
const calls: string[] = [
  "say(f(x));",
  "say(f());",
  "say(f(x, x));",
  "say(f(x, y, 3));",
  "say(f(...l));",
  "say(f(x, ...l));",
  "say(f.apply(null, l));",
  "say(f.call({ a: x }, x));",
  "say(f.call(null, x));",
  "say(f.bind(null, x)());",
  "say(f?.(x));",
  "say(f(f(x)));",
  "say(f({ a: () => x }));",
  "say(l.map(f).join());",
  "say(l.map(v => f(v)).join());",
  "l.forEach(f);\nsay(turns);",
  "say(l.filter(f).length);",
  "say(l.reduce(f));",
  "say(l.reduce((s, v) => s + String(f(v)), ''));",
  "say([...l].sort(f).join());",
  "say(l.some(f), l.every(f));",
  "say(l.find(f));",
  "say(l.flatMap(f).length);",
  "say(Array.from(l, f).join());",
  "say('abc'.replace('b', f));",
  "say('abc'.replace(/[ab]/g, m => f(m)));",
  "say(new f(x)?.a);",
  "say([...f(x)].length);",
  "for (const v of f(x)) say(v);",
  "const { a, b } = f(x) ?? {};\nsay(a, b);",
  "const [p] = f(x);\nsay(p);",
  "say(f`a${x}b`);",
  "say(typeof f(x));",
  "say(f(x) + 1);",
  "say(f(x) ? 't' : 'f');",
  "say(f(x) === x);",
  "const g = f;\nsay(g(x));",
  "const o = { f, k: 8 };\nsay(o.f(x));",
  "const o = { f, k: 8 };\nsay(o['f'](x));",
  "const row = [f];\nsay(row[0](x));",
  "say((0, f)(x));",
  "say((x > 0 ? f : g0)(x));",
  "const h = v => f(v);\nsay(h(x));",
  "const h = (v = f(x)) => v;\nsay(h(), h(1));",
  "say(Reflect.apply(f, undefined, l));",
  "say(JSON.stringify({ v: f(x) }));",
  "Promise.resolve(x).then(f).then(v => console.log('then', tell(v)), e => console.log('failed', e?.name));",
  "(async () => console.log('awaited', tell(await f(x))))().catch(e => console.log('rejected', e?.name));",
  "say(f(x)?.());",
  "say(f(x)?.m?.());",
  "say(f(undefined), f(null));",
  "say(f('t'), f(0.5));",
  "say(f({ a: x }), f([x]));",
  "late0();\nsay(f(x));",
  "const q = [f(x), f(y)];\nsay(q.length, q[0]);",
  "if (f(x)) say('yes');\nelse say('no');",
  "while (turns < 2) {\n  turns++;\n  say(f(x));\n}",
  "say(Math.max(+f(x) || 0, 2));",
  "say(f.length, f.name === 'f');",
  "say(f(f), f(f(f)));",
];
const values: [name: string, text: string][] = [
  ["integers", "const x = 1;\nconst y = 2;\nconst l = [3, 1, 2];"],
  ["fractions", "const x = 0.5;\nconst y = 1.5;\nconst l = [0.5, 2.5];"],
  ["texts", "const x = 'a';\nconst y = 'b';\nconst l = ['q', 'r'];"],
  ["handed", "const x = given;\nconst y = given;\nconst l = [given, 2];"],
  ["kinds", "const x = given;\nconst y = null;\nconst l = [1, 'u', undefined];"],
  ["objects", "const x = { a: 1 };\nconst y = [2];\nconst l = [{ a: 1 }, [3]];"],
  ["empty", "const x = undefined;\nconst y = '';\nconst l = [];"],
  ["large", "const x = 2147483647;\nconst y = -2147483648;\nconst l = [4294967296, 5];"],
];
const places: [name: string, text: string][] = [
  ["once", "VALUES\nCALL"],
  ["loop", "VALUES\nfor (let i = 0; i < n; i++) {\n  CALL\n}"],
  ["values-in-loop", "for (let i = 0; i < n; i++) {\n  VALUES\n  CALL\n}"],
  ["try", "VALUES\nfor (let i = 0; i < n; i++) {\n  try {\n    CALL\n  } catch (e) {\n    say(e.name);\n  }\n}"],
  ["closure", "VALUES\nconst go = () => {\n  CALL\n};\ngo();\ngo();"],
  ["each", "VALUES\n[0, 1].forEach(i => {\n  CALL\n});"],
];
const scopes: [name: string, inside: boolean, text: string][] = [
  ["of-file", false, "said0(() => run(1, 2));"],
  ["of-file-twice", false, "said0(() => run(1, 2));\nsaid0(() => run('s', 3));"],
  ["local", true, "said0(() => run(1, 2));"],
  ["local-twice", true, "said0(() => run(0.5, 2));\nsaid0(() => run({ a: 2 }, 1));"],
  ["loop", false, "for (let k = 0; k < 4; k++) said0(() => run(k, 2));"],
];
const total = functions.length * calls.length * values.length * places.length * scopes.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 450_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const fn = pick(functions);
  const call = pick(calls);
  const value = pick(values);
  const place = pick(places);
  const scope = pick(scopes);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && !/arguments\[0\] =|typeof this|\.call\(null|\bthis\?/.test(fn + call);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const block = (text: string) => (/^(const|class|let) /.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
  const body = within(within(place[1], "VALUES", value[1]), "CALL", block(call));
  const all = fn + body;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v).slice(0, 30));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    "let turns = 0;",
    ...(/\bkept\b/.test(all) ? ["let kept;"] : []),
    ...(/\beval1\(/.test(all) ? ["const eval1 = v => v;"] : []),
    ...(/\bg0\b/.test(all) ? ["const g0 = v => 'g' + typeof v;"] : []),
    ...(/\blate0\(/.test(all)
      ? [/\blate\b/.test(fn) && !scope[1] ? "const late0 = () => late();" : "const late0 = () => {};"]
      : []),
    ...(scope[1] ? [] : [fn]),
    `function run(given, n) {\n${indent((scope[1] ? fn + "\n" : "") + body, "  ")}\n}`,
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    scope[2],
    'console.log(said.join(" ").slice(0, 1200), turns);',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${functions.indexOf(fn)}--${calls.indexOf(call)}--${value[0]}--${place[0]}--${scope[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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

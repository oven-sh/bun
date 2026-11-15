// The least programs of code that is a text: each text, times each way to run it, times how the text is made, times what is around it.
//
//   bun write-known-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<text>--<way>--<how>--<scope>.mjs, .cjs or .ts
//   bun write-known-text-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const texts: string[] = [
  "1 + 2",
  "x",
  "x + 1",
  "x = 9",
  "x++",
  "typeof x",
  "typeof z",
  "var z = 5; z",
  "let y = 3; y + 1",
  "const x = 4; x",
  "var x = 4",
  "function h(a) { return a + 1; } h(2)",
  "function x() {} typeof x",
  "(a => a * 2)(4)",
  "(() => x)()",
  "class K { m() { return 7; } } new K().m()",
  "typeof this",
  "this === undefined",
  "({ a: 1 })",
  "{ a: 1 }",
  "[1, 2, 3].map(v => v * 2).join()",
  "for (var q = 0, s = 0; q < 5; q++) s += q; s",
  "for (let q = 0; q < 3; q++) x = q; x",
  "if (x > 1) 1; else 2",
  "throw new TypeError('t')",
  "syntax error (",
  "'use strict'; undeclared = 1",
  "undeclared2 = 1",
  "delete x",
  "typeof arguments",
  "try { nope(); } catch (e) { e.name; }",
  "`a${x}b`",
  "/a(.)/.exec('ab')[1]",
  "eval('x')",
  "var f2 = function () { return x; }; f2()",
  "undefined",
  "",
  ";",
  "'use strict'; typeof this",
  "l1: for (;;) { break l1; }",
  "switch (x) { case 1: 'one'; break; default: 'other'; }",
  "function* g() { yield 1; yield x; } [...g()].length",
  "(async () => {})() instanceof Promise",
  "globalThis.kk = 3; kk",
  "var [p1, p2 = x] = [1]; p2",
  "({ ...{ b: 2 } }).b",
  "new Map([[1, 2]]).get(1)",
  "JSON.stringify({ x })",
  "o.k = 5; o.k",
  "o.m()",
  "helper(x)",
  "var helper = 1; helper",
  "x => x",
  "let x; x",
  "return 5",
  "new.target",
  "super.m",
  "await 1",
  "yield",
  "import.meta",
  "0.1 + 0.2",
  "-0",
  "2147483647 + 1",
  "'a' + 1 + 2",
  "x.length",
  "[x, x].length",
  "Math.max(x, 2)",
  "typeof globalThis.kk",
  "var kk = 2; globalThis.kk",
  "function outer() { var x = 7; return eval('x'); } outer()",
];
// Each runs T.
const ways: string[] = [
  "say(eval(T));",
  "say((0, eval)(T));",
  "say(globalThis.eval(T));",
  "const e = eval;\nsay(e(T));",
  "say(eval?.(T));",
  "say(eval.call(null, T));",
  "say(Reflect.apply(eval, null, [T]));",
  "say(new Function(T)());",
  "say(Function('x', T)(3));",
  "say(Function('x', 'return ' + T)(3));",
  "say(new Function('return (' + T + ')')());",
  "say(runInThisContext(T));",
  "say(runInNewContext(T, { x: 8 }));",
  "const script = new Script(T);\nsay(script.runInThisContext());",
  "const script = new Script(T);\nsay(script.runInThisContext());\nsay(script.runInThisContext());",
  "say(eval('(' + T + ')'));",
  "eval(T);",
  "say(eval(T), eval(T));",
  "say(typeof eval(T));",
  "say((() => eval(T))());",
  "say((x => eval(T))(2));",
  "{\n  let x = 'inner';\n  say(eval(T));\n}",
  "const f = new Function(T);\nsay(f());\nsay(f());",
  "const p0 = Object.getPrototypeOf(async function () {}).constructor(T)();\np0.catch(() => {});\nsay(p0 instanceof Promise);",
  "say([...Object.getPrototypeOf(function* () {}).constructor(T)()].length);",
  "with0(T);",
];
const hows: [name: string, text: string, use: string][] = [
  ["literal", "", "TEXT"],
  ["constant", "const text = TEXT;", "text"],
  ["joined", "const text = HALF1 + HALF2;", "text"],
  ["template", "const text = `${TEXT}`;", "text"],
  ["element", "const list = [TEXT, '0'];", "list[0]"],
  ["field", "const row = { text: TEXT };", "row.text"],
  ["call", "const make = () => TEXT;", "make()"],
  ["pieces", "const text = [HALF1, HALF2].join('');", "text"],
  ["either", "const text = given ? TEXT : '0';", "text"],
  ["grown", "let text = '';\nfor (const c of TEXT) text += c;", "text"],
  ["handed", "", "handed"],
];
const scopes: [name: string, text: string][] = [
  ["parameter", "function run(x, given, handed) {\n  IN\n}"],
  ["variable", "function run(given0, given, handed) {\n  var x = given0;\n  IN\n  say(x);\n}"],
  ["let", "function run(given0, given, handed) {\n  let x = given0;\n  IN\n  say(x);\n}"],
  [
    "captured",
    "function run(given0, given, handed) {\n  let x = given0;\n  const get = () => x;\n  IN\n  say(get());\n}",
  ],
  [
    "method",
    "class R {\n  k = 2;\n  m(x, given, handed) {\n    IN\n    return this.k;\n  }\n}\nconst run = (x, given, handed) => say(new R().m(x, given, handed));",
  ],
  ["arrow", "const run = (x, given, handed) => {\n  IN\n  say(x);\n};"],
  ["loop", "function run(given0, given, handed) {\n  for (let x = 0; x < 3; x++) {\n    IN\n  }\n}"],
  ["repeated", "function run(x, given, handed) {\n  for (let i = 0; i < 4; i++) {\n    IN\n  }\n  say(x);\n}"],
  ["catch", "function run(given0, given, handed) {\n  try {\n    throw given0;\n  } catch (x) {\n    IN\n  }\n}"],
  [
    "generator",
    "function* steps(x, given, handed) {\n  IN\n  yield x;\n}\nconst run = (x, given, handed) => say([...steps(x, given, handed)].length);",
  ],
  ["module", "let x = 1;\nfunction run(given0, given, handed) {\n  IN\n  say(x);\n}"],
  ["names", "function run(x, given, handed) {\n  IN\n  say(typeof z, typeof h, typeof f2);\n}"],
  [
    "nested",
    "function run(x, given, handed) {\n  const inner = () => {\n    IN\n    return x;\n  };\n  say(inner(), x);\n}",
  ],
  ["global", "function run(given0, given, handed) {\n  IN\n}"],
];
const total = texts.length * ways.length * hows.length * scopes.length * 3;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 525_527;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const asked = pick(texts);
  const way = pick(ways);
  const how = pick(hows);
  const scope = pick(scopes);
  const text = scope[0] === "generator" && asked.includes("arguments") ? "typeof o" : asked;
  const guard = pick([0, 1, 2]);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const put = (from: string, hole: string, part: string) => from.replaceAll(hole, () => part);
  const half = text.length >> 1;
  const written = (from: string) =>
    put(
      put(put(from, "TEXT", JSON.stringify(text)), "HALF1", JSON.stringify(text.slice(0, half))),
      "HALF2",
      JSON.stringify(text.slice(half)),
    );
  const used = way.replaceAll(/\bT\b/g, () => written(how[2]));
  const inner = `${written(how[1])}${how[1] ? "\n" : ""}${used}`;
  const guarded = guard
    ? `try {\n${indent(inner, "  ")}\n} catch (e) {\n  say(e.name);\n}`
    : `{\n${indent(inner, "  ")}\n}`;
  const imported = ["runInThisContext", "runInNewContext", "Script"].filter(name =>
    new RegExp(`\\b${name}\\b`).test(used),
  );
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(imported.length
      ? [
          isCommon
            ? `const { ${imported.join(", ")} } = require("node:vm");`
            : `import { ${imported.join(", ")} } from "node:vm";`,
        ]
      : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v).slice(0, 30));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    "const helper = v => v;",
    "const o = { k: 1, m: () => 6 };",
    ...(/\bwith0\(/.test(used) ? ["const with0 = t => say(eval(t));"] : []),
    within(scope[1], "IN", guarded),
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    `said0(() => run(1, 2, ${JSON.stringify(text)}));`,
    ...(guard === 2 ? [`said0(() => run('s', 1, ${JSON.stringify(text)}));`] : []),
    'console.log(said.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${texts.indexOf(asked)}--${ways.indexOf(way)}--${how[0]}--${scope[0]}--${guard}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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

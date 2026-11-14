// The least programs that lay names on functions: which function, times who lays the name, times which name, times what it holds, times how the function is reached, times what is done, times the loop.
//
//   bun write-function-name-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<function>--<laid>--<name>--<value>--<reached>--<deed>--<loop>.mjs, .cjs or .ts
//   bun write-function-name-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// F is the function; what stands in front of the loop, or in it.
const functions: [name: string, front: string, inside: string][] = [
  ["declaration", "function F(x) {\n  return x;\n}", ""],
  ["expression", "const F = function (x) {\n  return x;\n};", ""],
  ["arrow", "const F = x => x;", ""],
  ["class", "class F {\n  static s = 1;\n  m() {}\n}", ""],
  ["heir", "class A {\n  static N = 'above';\n  static s = 2;\n}\nclass F extends A {}", ""],
  ["class-with-static", "class F {\n  static N = 5;\n  static up() {\n    return this.N;\n  }\n}", ""],
  [
    "class-with-accessor",
    "class F {\n  static #n = 3;\n  static get N() {\n    return F.#n;\n  }\n  static set N(v) {\n    F.#n = v;\n  }\n}",
    "",
  ],
  ["async", "async function F(x) {\n  return x;\n}", ""],
  ["generator", "function* F(x) {\n  yield x;\n}", ""],
  ["bound", "const F = ((x) => x).bind(null, 1);", ""],
  ["method", "const host = {\n  F(x) {\n    return x;\n  },\n};\nconst F = host.F;", ""],
  ["made", "const make = () => function (x) {\n  return x;\n};\nconst F = make();", ""],
  ["made-in-loop", "", "const F = function () {};"],
  ["arrow-in-loop", "", "const F = () => i;"],
  ["class-in-loop", "", "const F = class {};"],
  ["made-by-callee", "const make = x => function () {\n  return x;\n};", "const F = make(i);"],
  ["one-of-two", "const G = [x => x, function (x) {\n  return x;\n}];", "const F = G[i & 1];"],
  ["variable", "let F = function () {};\nconst again = () => {\n  F = function () {};\n};", ""],
  ["var", "var F = function () {};", ""],
  ["proxy", "const F = new Proxy(function () {}, {});", ""],
];
// N is the name, V what it holds.
const laids: [name: string, front: string, inside: string][] = [
  ["in-front", "F.N = V;", ""],
  ["in-loop", "", "F.N = V;"],
  ["sometimes", "", "if (i & 1) F.N = V;"],
  ["first", "", "if (i === 0) F.N = V;"],
  ["twice", "F.N = 'first';", "F.N = V;"],
  ["by-callee", "", "lay(F, V);"],
  ["assigned", "", "Object.assign(F, { N: V, other: 1 });"],
  ["defined", "", "Object.defineProperty(F, 'N', { value: V, writable: true, configurable: true });"],
  ["fixed", "", "Object.defineProperty(F, 'N', { value: V, configurable: true });"],
  ["accessor", "", "Object.defineProperty(F, 'N', { get: () => V, configurable: true });"],
  ["by-key", "", "F[key] = V;"],
  ["counted", "", "F.N = (F.N ?? 0) + 1;"],
  ["with-others", "", "F.x1 = 1;\nF.N = V;\nF.x2 = 2;"],
  ["never", "", ""],
];
const names: string[] = [
  "count",
  "a",
  "title",
  "length",
  "prototype",
  "valueOf",
  "call",
  "caller",
  "then",
  "constructor",
  "up",
];
const values: [name: string, text: string][] = [
  ["number", "5"],
  ["counter", "i"],
  ["fraction", "i + 0.5"],
  ["text", "'t' + i"],
  ["kinds", "i & 1 ? 'odd' : i"],
  ["object", "{ v: i }"],
  ["list", "[i, 2]"],
  ["function", "() => i"],
  ["itself", "F"],
  ["undefined", "undefined"],
  ["method", "function () {\n  return this === F;\n}"],
];
// How the function is reached.
const reaches: [name: string, text: string, inside: string][] = [
  ["itself", "F", ""],
  ["second-name", "G1", "const G1 = F;"],
  ["argument", "pass(F)", ""],
  ["generated", "gives(F).next().value", ""],
  ["element", "[F][0]", ""],
  ["field", "held.f", "const held = { f: F };"],
  ["choice", "(i & 1 ? F : other)", ""],
  ["maker", "new F.prototype.constructor()", ""],
  ["boxed", "Object(F)", ""],
  ["kept", "last", "last ??= F;"],
];
// R is the function as it is reached.
const deeds: [name: string, text: string][] = [
  ["read", "out.push(say(R.N));"],
  ["read-twice", "out.push(say(R.N) + '|' + say(F.N));"],
  ["sum", "s += +R.N || 0;\nout.push(s);"],
  ["added", "R.N = typeof R.N === 'function' ? 1 : R.N + 1;\nout.push(say(R.N));"],
  ["stepped", "R.N++;\nout.push(say(F.N));"],
  ["stored", "R.N = i * 2;\nout.push(say(F.N));"],
  ["removed", "out.push(say(R.N));\ndelete R.N;\nout.push(say(F.N));"],
  ["has", "out.push('N' in R, Object.hasOwn(R, 'N'));"],
  ["names", "out.push(Object.keys(R).join('/'));"],
  ["called", "out.push(say(R.N?.(1)));"],
  ["inner", "out.push(say(R.N?.v));"],
  ["asked", "out.push(say(ask(R)));"],
  ["by-key", "out.push(say(R[key]));"],
  ["pattern", "const { N: got = 'none' } = R;\nout.push(say(got));"],
  ["typed", "out.push(typeof R.N);"],
  ["through-this", "out.push(say(own.call(R)));"],
];
const loops: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["once", "{\n  const i = 1;\n  IN\n}"],
  ["callee", "const go = i => {\n  IN\n};\nfor (let i = 0; i < n; i++) go(i);"],
  ["each", "[1, 2, 0].forEach(i => {\n  IN\n});"],
  ["nested", "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["while", "let i = 0;\nwhile (i < n) {\n  IN\n  i++;\n}"],
];
const total =
  functions.length * laids.length * names.length * values.length * reaches.length * deeds.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 20_328_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const of = pick(functions);
  const laid = pick(laids);
  const deed = pick(deeds);
  const reach = pick(reaches);
  const value = pick(values);
  const loop = pick(loops);
  const picked = pick(names);
  const key = of[1].includes("static") && /prototype|constructor/.test(picked) ? "size" : picked;
  const isTyped = cell % 4 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const valued = (text: string) => text.replaceAll(/\bV\b/g, value[1]).replaceAll(/\bN\b/g, key);
  const isMadeInside = of[2] !== "";
  const front = laid[1] && !isMadeInside ? laid[1].replaceAll(/\bV\b/g, value[1].replaceAll(/\bi\b/g, "1")) : "";
  const parts = [of[2], isMadeInside ? laid[1] : "", laid[2], reach[2], deed[1].replaceAll(/\bR\b/g, reach[1])].filter(
    Boolean,
  );
  const body = within(loop[1], "IN", valued(parts.join("\n")));
  const uses = (word: RegExp) => word.test(body + front);
  const isCommon = !isTyped && cell % 3 === 0;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    'const say = v => (typeof v === "function" ? "function" : typeof v === "object" && v ? "object" : String(v));',
    ...(uses(/\bkey\b/) ? [`let key = '${key}';`] : []),
    ...(uses(/\bother\)/) ? ["const other = function () {};"] : []),
    ...(uses(/\bpass\(/) ? ["function pass(x) {\n  return x;\n}"] : []),
    ...(uses(/\bgives\(/) ? ["function* gives(x) {\n  yield x;\n}"] : []),
    ...(uses(/\blay\(/) ? [`function lay(f, v) {\n  f.${key} = v;\n}`] : []),
    ...(uses(/\bask\(/) ? [`function ask(f) {\n  return f.${key};\n}`] : []),
    ...(uses(/\bown\.call/) ? [`function own() {\n  return this.${key};\n}`] : []),
    ...(uses(/\blast\b/) ? ["let last;"] : []),
    ...(of[1] ? [of[1].replaceAll(/\bN\b/g, key)] : []),
    ...(of[0] === "variable" && uses(/\bi\b/) ? ["again();"] : []),
    ...(front
      ? ["try {", indent(front.replaceAll(/\bN\b/g, key), "  "), "} catch (error) {", "  out.push(error.name);", "}"]
      : []),
    `function run(n) {\n${uses(/\bs \+=/) ? "  let s = 0;\n" : ""}${indent(body, "  ")}\n}`,
    "for (const n of [2, 4]) {",
    "  try {",
    "    run(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${of[0]}--${laid[0]}--${key}--${value[0]}--${reach[0]}--${deed[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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

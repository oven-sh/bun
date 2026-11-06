// Calls whose arguments are counted at run time: none, a few, thousands, more than any stack holds. At the top of the stack, and at every level on the way up from its end, where each argument more takes eight bytes of what is left.
//
//   callees   functions with no, some and many parameters, a rest parameter, `arguments`, default values, arrows, methods, async functions, generators, async generators, constructors, derived constructors that hand everything on,
//             bound functions, proxies, functions called as values, text that becomes code at run time, and built-ins: Math.max, Math.min, String.fromCharCode, Array.of, push, unshift, concat, Object.assign, path.join, util.format
//   passed by a spread, two spreads with something between, apply, Reflect.apply, call with a spread, bind with a spread, new with a spread, Reflect.construct, super with a spread
//   from      arrays of integers, of doubles, of texts, of objects, of a mix, arrays with holes, array-likes, sets, generators, typed arrays, the arguments object
//
// How many arguments fit differs between a compiled program and plain Bun, so nothing that is printed depends on it: a call answers rightly or fails with a RangeError, and afterward everything works as before.
import type { Random } from "./random";

const prelude = `declare function require(name: string): any;
declare const process: any;
const path = require("node:path");
const util = require("node:util");
const strange = new Set<string>();
const wrong = new Set<string>();
function nothing() {}
process.on("unhandledRejection", nothing);
function note(where: string, error: unknown): void {
  if (!(error instanceof RangeError)) strange.add(where + " " + (error instanceof Error ? error.name : typeof error));
}
function digest(list: ArrayLike<unknown>): string {
  const n = list.length;
  return n + ":" + String(list[0]) + ":" + String(list[n >> 1]) + ":" + String(list[n - 1]);
}
const lists = new Map<number, any[]>();
`;

// `n` is the length.
const sources: readonly (readonly [name: string, make: string])[] = [
  ["integers", `Array.from({ length: n }, (_, at) => at)`],
  ["integers", `Array.from({ length: n }, (_, at) => at)`],
  ["doubles", `Array.from({ length: n }, (_, at) => at + 0.5)`],
  ["texts", `Array.from({ length: n }, (_, at) => "t" + (at & 7))`],
  ["objects", `Array.from({ length: n }, (_, at) => (at & 1 ? [at] : "o" + (at & 3)))`],
  ["a-mix", `Array.from({ length: n }, (_, at) => [at, at + 0.5, "m", null, undefined, true][at % 6])`],
  ["holes", `((list: any[]) => (n > 2 && delete list[n >> 1], list))(Array.from({ length: n }, (_, at) => at))`],
];

// Each answers with the digest of what it was given. `F` is its name.
type Callee = readonly [name: string, text: string, isConstructor?: true, answer?: (call: string) => string];
const callees: readonly Callee[] = [
  ["a-rest-parameter", `function F(...rest: unknown[]): string {\n  return digest(rest);\n}`],
  ["a-rest-parameter-behind-two", `function F(a?: unknown, b?: unknown, ...rest: unknown[]): string {\n  return digest(arguments.length < 2 ? [a, b].slice(0, arguments.length) : [a, b, ...rest]);\n}`],
  ["arguments", `function F(): string {\n  return digest(arguments);\n}`],
  ["arguments-and-parameters", `function F(a?: unknown, b?: unknown, c?: unknown): string {\n  const n = arguments.length;\n  if (n > 0 && a !== arguments[0]) return "a";\n  if (n > 2 && c !== arguments[2]) return "c";\n  return digest(arguments);\n}`],
  ["default-values", `function F(a: unknown = "d", b: unknown = [a], ...rest: unknown[]): string {\n  return digest(Array.prototype.slice.call(arguments));\n}`],
  ["an-arrow", `const F = (...rest: unknown[]): string => digest(rest);`],
  ["a-method", `const holderF = {\n  tag: 1,\n  run(...rest: unknown[]): string {\n    return this.tag === 1 ? digest(rest) : "this";\n  },\n};\nconst F = holderF.run.bind(holderF);`],
  ["a-generator", `function* generatorF(...rest: unknown[]): Generator<string, void, unknown> {\n  yield digest(rest);\n}\nfunction F(...rest: unknown[]): string {\n  return generatorF(...rest).next().value as string;\n}`],
  ["a-generator-that-reads-arguments", `function* generatorF(): Generator<string, void, unknown> {\n  yield digest(arguments);\n}\nfunction F(): string {\n  return generatorF.apply(null, arguments as any).next().value as string;\n}`],
  ["a-bound-function", `const F = function (this: unknown, ...rest: unknown[]): string {\n  return digest(rest);\n}.bind(null);`],
  ["a-proxy", `const F: (...rest: unknown[]) => string = new Proxy(nothing as any, { apply: (_target, _self, given) => digest(given) });`],
  ["a-function-called-as-a-value", `(globalThis as any).valueF = function (...rest: unknown[]): string {\n  return digest(rest);\n};\nconst F: (...rest: unknown[]) => string = (globalThis as any)[Object.keys(globalThis).find(key => key === "valueF")!];`],
  ["text-at-run-time", `const F: (...rest: unknown[]) => string = new Function("digest", "return function () { return digest(arguments); }")(digest);`],
  ["hands-everything-on", `function innerF(...rest: unknown[]): string {\n  return digest(rest);\n}\nfunction F(...rest: unknown[]): string {\n  return innerF(...rest);\n}`],
  ["hands-its-arguments-on", `function innerF(): string {\n  return digest(arguments);\n}\nfunction F(): string {\n  return innerF.apply(null, arguments as any);\n}`],
  ["a-constructor", `class F {\n  answer: string;\n  constructor(...rest: unknown[]) {\n    this.answer = digest(rest);\n  }\n}`, true],
  ["a-derived-constructor", `class BaseF {\n  answer: string;\n  constructor(...rest: unknown[]) {\n    this.answer = digest(rest);\n  }\n}\nclass F extends BaseF {\n  constructor(...rest: unknown[]) {\n    super(...rest);\n  }\n}`, true],
  ["a-derived-class-without-a-constructor", `class BaseF {\n  answer: string;\n  constructor() {\n    this.answer = digest(arguments);\n  }\n}\nclass F extends BaseF {\n  extra = 1;\n}`, true],
  ["a-constructor-function", `const F: any = function (this: any) {\n  this.answer = digest(arguments);\n};`, true],
];

// An async callee answers later: the call itself must come back.
const asyncCallees: readonly Callee[] = [
  ["an-async-function", `async function F(...rest: unknown[]): Promise<string> {\n  return digest(rest);\n}`],
  ["an-async-function-that-reads-arguments", `async function F(): Promise<string> {\n  await null;\n  return digest(arguments);\n}`],
  ["an-async-generator", `async function* generatorF(...rest: unknown[]): AsyncGenerator<string, void, unknown> {\n  yield digest(rest);\n}\nasync function F(...rest: unknown[]): Promise<string> {\n  return (await generatorF(...rest).next()).value as string;\n}`],
];

// `L` is the list. What each answers depends on the list alone.
const builtIns: readonly (readonly [name: string, call: string, expected: string, from: string])[] = [
  ["math-max", `Math.max(...L)`, `L.length ? L.length - 1 : -Infinity`, "integers"],
  ["math-min-apply", `Math.min.apply(null, L)`, `L.length ? 0 : Infinity`, "integers"],
  ["from-char-code", `String.fromCharCode(...L).length`, `L.length`, "integers"],
  ["from-char-code-apply", `String.fromCharCode.apply(null, L).length`, `L.length`, "integers"],
  ["array-of", `digest(Array.of(...L))`, `digest(L)`, ""],
  ["push", `(() => { const grown: unknown[] = []; grown.push(...L); return digest(grown); })()`, `digest(L)`, ""],
  ["push-apply", `(() => { const grown: unknown[] = [1]; Array.prototype.push.apply(grown, L); return grown.length; })()`, `L.length + 1`, ""],
  ["unshift", `(() => { const grown: unknown[] = [1]; return grown.unshift(...L); })()`, `L.length + 1`, ""],
  ["concat", `([] as unknown[]).concat(...L).length >= 0`, `true`, ""],
  ["object-assign", `Object.keys(Object.assign({}, ...L)).length >= 0`, `true`, "objects"],
  ["path-join", `path.join(...L).length > 0`, `true`, "texts"],
  ["util-format", `typeof util.format(...L)`, `"string"`, ""],
  ["reflect-apply-of-a-built-in", `Reflect.apply(Math.max, null, L)`, `L.length ? L.length - 1 : -Infinity`, "integers"],
];

// `F` the callee, `L` the list.
const ways: readonly (readonly [name: string, call: string])[] = [
  ["a-spread", `F(...L)`],
  ["a-spread", `F(...L)`],
  ["apply", `F.apply(null, L)`],
  ["reflect-apply", `Reflect.apply(F, null, L)`],
  ["call-with-a-spread", `F.call(null, ...L)`],
  ["bind-with-a-spread", `F.bind(null, ...L)()`],
  ["a-spread-of-a-set-of-one-list", `F(...new Set([L]).values().next().value!)`],
  ["a-spread-of-a-generator", `F(...(function* () { yield* L; })())`],
  ["the-arguments-object", `(function () { return F.apply(null, arguments as any); } as any).apply(null, L)`],
];
const waysToConstruct: readonly (readonly [name: string, call: string])[] = [
  ["new-with-a-spread", `new F(...L).answer`],
  ["reflect-construct", `(Reflect.construct(F, L) as any).answer`],
  ["new-of-a-bound-constructor", `new (F.bind(null, ...L))().answer`],
];

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude];
  const names: string[] = [];
  const cases = random.between(2, 5);
  const runs: string[] = [];
  for (let id = 1; id <= cases; id++) {
    const kind = random.weighted([[5, "callee"], [2, "async"], [2, "built-in"]] as const);
    let [sourceName, make] = pick(sources);
    let call: string, expected: string, name: string;
    if (kind === "built-in") {
      const [builtIn, its, answer, from] = pick(builtIns);
      if (from) [sourceName, make] = sources.find(([each]) => each === from)!;
      [call, expected, name] = [its, answer, builtIn];
    } else {
      const [calleeName, callee, isConstructor] = pick(kind === "async" ? asyncCallees : callees);
      const [wayName, way] = pick(isConstructor ? waysToConstruct : ways);
      text.push(callee.replace(/F\b/g, `F${id}`));
      [call, expected, name] = [way.replace(/\bF\b/g, `(F${id} as any)`), "digest(L)", `${calleeName}--${wayName}`];
    }
    // A hole arrives as undefined, which is what the digest of the list reads there too.
    names.push(`${name}--${sourceName}`);
    const isAsync = kind === "async";
    text.push(`// ${id}: ${name}--${sourceName}
function list${id}(n: number): any[] {
  let list = lists.get(${id} * 10000000 + n);
  if (!list) lists.set(${id} * 10000000 + n, (list = ${make}));
  return list;
}
function call${id}(L: any[]): unknown {
  return ${call};
}
function try${id}(n: number): void {
  const L = list${id}(n);
  const expected = ${expected};
  try {
    const got = call${id}(L);
    ${isAsync ? `(got as Promise<unknown>).then(answer => void (answer === expected || wrong.add("${id} ${name} " + n)), error => note("${id} ${name}", error));` : `if (got !== expected) wrong.add("${id} ${name} " + n);`}
  } catch (error) {
    note("${id} ${name}", error);
  }
}`);
    const sizes = random.sample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 127, 129, 255, 257, 1000, 4095, 4097, 10000, 32767, 65535, 65536, 65537, 100000, 125000, 200000, 500000, 1000000, 3000000], random.between(6, 14)).sort((a, b) => a - b);
    runs.push(`for (const n of [${sizes.join(", ")}]) try${id}(n);`);
    // On the way up: each argument more takes eight bytes of what is left.
    const most = pick([16, 40, 40, 100]);
    const by = pick([1, 1, 2, 7]);
    text.push(`for (let n = 0; n <= ${most * by}; n += ${by}) list${id}(n);
let tried${id} = 0;
function down${id}(level: number): number {
  ${pick(["", "const kept = [level];", "const kept = level + 0.5, more = \"k\" + level;"])}
  try {
    return down${id}(level + 1) + 1;
  } ${pick(["catch (error) {\n    if (tried_ID++ < 400) for (let n = 0; n <= MOST; n += BY) try_ID(n);\n    throw error;\n  }", "finally {\n    if (tried_ID++ < 400) for (let n = 0; n <= MOST; n += BY) try_ID(n);\n  }", "catch (error) {\n    if (tried_ID++ < 4000) try_ID((tried_ID % COUNT) * BY);\n    throw error;\n  }"])
    .replaceAll("_ID", String(id))
    .replaceAll("MOST", String(most * by))
    .replaceAll("COUNT", String(most + 1))
    .replaceAll("BY", String(by))}
}`);
    runs.push(`try {\n  down${id}(0);\n  console.log("${id} came back");\n} catch (error) {\n  console.log("${id}", error instanceof RangeError ? "fine" : "thrown " + String(error));\n}\nfor (const n of [0, 1, 5, 64, 1000]) try${id}(n);`);
  }
  text.push(random.shuffled(runs.filter((_, at) => at % 2 === 0)).join("\n"), runs.filter((_, at) => at % 2 === 1).join("\n"));
  text.push(`await new Promise(resolve => setTimeout(resolve, 5));
console.log("strange: " + [...strange].sort().join(", "));
console.log("wrong: " + [...wrong].sort().join(", "));`);
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}

// One variable of type any holds a thing that one function takes apart, by a pattern, a spread, a loop or a built-in that walks it, and another
// function stores a thing of another kind under the same name. What is taken apart: texts and String objects, arrays, sets, maps, typed arrays,
// generators, array-likes, and each of them with the iterator of another. A program draws both kinds and one way to take the thing apart.
import type { Random } from "./random";

const kinds = [
  "new String('boxed')",
  "'plain'",
  "Object('made')",
  "new (class Word extends String { })('word')",
  "Object.assign(new String('own'), { *[Symbol.iterator]() { yield 'x'; yield 'y'; } })",
  "[1, seed, 3]",
  "[1, , 3]",
  "new Set([1, seed + 10])",
  "new Map([[1, seed], [2, 3]])",
  "new Uint8Array([7, 8, 9])",
  "(function (...all: number[]) { return arguments; })(4, 5, 6)",
  "(function* () { yield 1; yield seed; yield 3; })()",
  "{ *[Symbol.iterator]() { yield 'a'; yield 'b'; yield 'c'; } }",
  "{ 0: 'a', 1: 'b', length: 2 }",
  "new Number(5)",
  "5",
  "null",
  "{ length: 2, 0: 'a', 1: 'b', [Symbol.iterator]: Array.prototype[Symbol.iterator] }",
  "Object.assign(new String('ab'), { [Symbol.iterator]: Array.prototype.values })",
  "Object.assign([1, seed], { [Symbol.iterator]: String.prototype[Symbol.iterator] })",
  "Object.assign(new Set([1, 2]), { length: 1, 0: 'z', [Symbol.iterator]: Array.prototype.values })",
  "{ [Symbol.iterator]: Set.prototype.values }",
  "Object.assign(new Map([[1, 2], [seed + 5, 4]]), { [Symbol.iterator]: Map.prototype.keys })",
  "Object.assign(new Uint8Array([1, 2]), { [Symbol.iterator]: Array.prototype.values })",
  "Object.assign(new Number(12), { [Symbol.iterator]: String.prototype[Symbol.iterator] })",
  "Object.assign([1, 2], { [Symbol.iterator]: Uint8Array.prototype.values })",
  "new String('')",
  "new String('\\u{1F600}z')",
];

const storedBeside = [
  "new Set([1, seed + 10])",
  "new Map([[1, seed], [2, 3]])",
  "[1, seed, 3]",
  "new Uint8Array([7, 8, 9])",
  "'plain'",
  "(function* () { yield 1; yield seed; yield 3; })()",
  "{ *[Symbol.iterator]() { yield 'a'; yield 'b'; yield 'c'; } }",
  "new String('boxed')",
  "null",
  "{ length: 2, 0: 'a', 1: 'b', [Symbol.iterator]: Array.prototype[Symbol.iterator] }",
];

const uses = [
  "const [first, second] = made0; return [second, first];",
  "const [first, ...rest] = made0; return [first, rest];",
  "const [, second, , fourth] = made0; return [second, fourth];",
  "const [a = 'da', b = 'db', c = 'dc', d = 'dd', e = 'de', f = 'df'] = made0; return [a, b, c, d, e, f];",
  "const [[inner], second] = made0; return [inner, second];",
  "let a, b; [a, b] = made0; return [a, b];",
  "return [...made0];",
  "return list(...made0);",
  "const all = []; for (const part of made0) all.push(part); return all;",
  "return Array.from(made0);",
  "return [made0[0], made0[1], made0.length];",
  "return (([a, b]) => [a, b])(made0);",
  "const { 0: a, length } = made0; return [a, length];",
  "return [...(function* () { yield* made0; })()];",
  "return [...new Set(made0)];",
  "return Object.fromEntries([['k', 1]].concat([...made0].map((p, i) => ['p' + i, p])));",
];

export function generate(random: Random): string {
  const takenApart = random.pick(kinds);
  const storedElsewhere = random.pick(storedBeside);
  const use = random.pick(uses);
  return `function list(...all: unknown[]): unknown[] { return all; }
function show(value: unknown, depth = 0): string {
  if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
  return "{" + Object.keys(value).map(key => key + ":" + show((value as Record<string, unknown>)[key], depth + 1)).join() + "}";
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return "THROWS " + (error as Error).constructor.name;
  }
}
function handed(read: () => any, name: string): unknown {
  const found = read();
  return found;
}
(() => {
let made0: any;
function road0_0(seed: number, index: number): string {
  made0 = ${takenApart};
  return attempt(() => ({ ask() { return ((() => { ${use} })()); } }).ask());
}
function road0_2(seed: number, index: number): string {
  return "stored";
}
function road0_3(seed: number, index: number): string {
  made0 = ${storedElsewhere};
  return "stored";
}
{
  let answer = "";
  for (let turn = 0; turn < 3; turn++) answer = road0_0(turn, turn & 1);
  console.log("0 0 " + answer);
}
{
  let answer = "";
  for (let turn = 0; turn < 3; turn++) answer = road0_3(turn, turn & 1);
}
})();
(() => {
let made2: any;
function road2_0(seed: number, index: number): string {
  return [attempt(() => handed(() => (handed(() => made2[1], "a")), "a")), attempt(() => handed(() => ({ ...made2 }), "a")), attempt(() => handed(() => (made2(1, 2)), "a")), attempt(() => handed(() => (made2.size), "a"))].join(" | ");
}
function road2_1(seed: number, index: number): string {
  return [attempt(() => handed(() => (handed(() => made2[1], "a")), "a")), attempt(() => handed(() => ({ ...made2 }), "a")), attempt(() => handed(() => (made2(1, 2)), "a")), attempt(() => handed(() => (made2.size), "a"))].join(" | ");
}
let made3: any;
function road3_0(seed: number, index: number): string {
  return [attempt(() => handed(() => (made3.length), "a"))].join(" | ");
}
function road3_2(seed: number, index: number): string {
  return "stored";
}
})();
`;
}

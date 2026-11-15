// The same number in either box: as the engine's double out of a list that it turned into one of values, and as an int32. Both go through the same question (a case, an equality, a type test ..), into the same kind of list, by the
// same loop, and are read by compiled code and by the engine. The two lines must be equal: the program throws where they are not, so it needs no other run to be held against.
import type { Random } from "./random";

const numbers = [
  0, 1, 2, 3, 4, 7, 9, 15, 31, 63, 64, 100, 255, 256, 1000, 65535, 100000, 2147483647, -1, -3, -100, -2147483648,
];

const questions: ((n: number) => [string, string])[] = [
  n => [`switch (x) { case ${n}:`, `break; }`],
  n => [`switch (x) { case ${n}: case ${n + 1}:`, `break; }`],
  n => [`switch (x) { case ${n === 5 ? 6 : 5}: return to; case ${n}:`, `break; default: }`],
  n => [`if (x === ${n}) {`, `}`],
  n => [`if (${n} === x) {`, `}`],
  n => [`if (x == ${n}) {`, `}`],
  n => [`if (x !== ${n}) return to; {`, `}`],
  () => [`if (x === y) {`, `}`],
  () => [`if (typeof x === "number") {`, `}`],
  () => [`if (Number.isInteger(x)) {`, `}`],
  n => [`if (x >= ${n} && x <= ${n}) {`, `}`],
  () => [`{`, `}`],
];

const makers = [
  "new Array(7).fill(9)",
  "new Array(7).fill(9)",
  "[9, 8, 7, 6, 5, 4, 3].slice()",
  "[9, 9, 9, 9, 9, 9, 9].slice()",
  "Array.from({ length: 7 }, () => 9)",
  "[9, 9, 9, 9, 9, 9, 9].map(each => each)",
  "pushed(7)",
  "stored(7)",
  "[9, 9, 9, 9, 9, 9, 9].concat([8])",
  "[9, 9, 9, 9, 9, 9, 9].toReversed()",
  "JSON.parse('[9,9,9,9,9,9,9]')",
  "[0.5, 9, 9, 9, 9, 9, 9]",
  "['t', 9, 9, 9, 9, 9, 9]",
];

const stores = [
  "for (let i = 0; i < to.length; i++) to[i] = x;",
  "for (let i = 0; i < to.length; i++) to[i] = x;",
  "for (let i = 0; i < 7; i++) to[i] = x;",
  "for (let i = to.length - 1; i >= 0; i--) to[i] = x;",
  "for (let i = 0; i < to.length; i += 2) to[i] = x;",
  "let i = 0; while (i < to.length) { to[i] = x; i++; }",
  "for (let i = 0; i + 1 < to.length; i++) { to[i + 1] = to[i]; to[i] = x; }",
  "for (let i = 0; i < to.length; i++) { if (to[i] > 5) to[i] = x; }",
  "for (let i = 0; i < to.length; i++) { to[i] = x; to[i] = to[i]; }",
  "for (let i = 0; i < to.length; i++) { const kept = x; to[i] = kept; }",
  "to.fill(x);",
  "for (let i = 0; i < 3; i++) to.push(x);",
  "to[2] = x; to.splice(1, 1, x); to.unshift(x);",
  "const other = [x, 1, 2, x]; for (let i = 0; i < other.length; i++) to[i] = other[i];",
  "const copy = to.with(1, x).concat(x).toSpliced(0, 1, x); for (let i = 0; i < to.length; i++) to[i] = copy[i];",
  "const rows = [to, to.slice()]; for (const row of rows) for (let i = 0; i < row.length; i++) row[i] = x; to = rows[1];",
];

const roads = [
  "turned(n)",
  "turned(n)",
  "JSON.parse('[0.5,' + n + ']').pop()",
  "JSON.parse('[' + n + ',0.5]').shift()",
  "firstOf(JSON.parse('[' + n + ',0.5]'))",
  "lastOf(...JSON.parse('[0.5,' + n + ']'))",
  "lastOf.apply(null, JSON.parse('[0.5,' + n + ']'))",
  "structuredClone([0.5, n])[1]",
  "Array.from(new Float64Array([0.5, n])).pop()",
  "Object.entries(JSON.parse('[0.5,' + n + ']'))[1][1]",
  "Reflect.get(turnedList(n), 1)",
  "new Float64Array([n])[0]",
  "[...new Set(turnedList(n))][1]",
  "new Map([['k', turned(n)]]).get('k')",
  "({ v: turned(n) }).v",
];

const prelude = (typed: boolean) => {
  const of = (type: string) => (typed ? `: ${type}` : "");
  return `function turnedList(n${of("number")})${of("any[]")} {
  const list = JSON.parse("[0.5," + n + "]");
  list.push("x");
  return list;
}
const turned = (n${of("number")})${of("any")} => turnedList(n)[1];
function firstOf([first]${of("any[]")})${of("any")} {
  return first;
}
function lastOf(...all${of("any[]")})${of("any")} {
  return all[all.length - 1];
}
function pushed(count${of("number")})${of("number[]")} {
  const list${of("number[]")} = [];
  for (let i = 0; i < count; i++) list.push(9);
  return list;
}
function stored(count${of("number")})${of("number[]")} {
  const list${of("number[]")} = new Array(count);
  for (let i = 0; i < count; i++) list[i] = 9;
  return list;
}
function read(list${of("any[]")}, n${of("number")})${of("string")} {
  let ours = "", sum = 0;
  for (let i = 0; i < list.length; i++) ours += list[i] + ",";
  for (let i = 0; i < list.length; i++) sum = (sum * 3 + list[i]) | 0;
  for (const each of list) sum = (sum * 5 + each) | 0;
  return [ours, sum, list.join(), JSON.stringify(list), list.indexOf(n), list.includes(n), list.lastIndexOf(n), String(list.slice()), list.concat(list).join(), structuredClone(list).join(), list.toSorted().join(), new Set(list).size, Math.max(...list.filter(Number.isFinite)), [...list].join(), list.map(each => each).join()].join(" ");
}
let lines = 0;
function tell(label${of("string")}, boxed${of("string")}, plain${of("string")})${of("void")} {
  if (boxed !== plain) throw new Error(label + "\\n  in the box of a double " + boxed + "\\n  as an int32            " + plain);
  if (lines++ < 12) console.log(label, boxed);
}`;
};

function scene(random: Random, typed: boolean, index: number): string {
  const of = (type: string) => (typed ? `: ${type}` : "");
  const n = random.pick(numbers);
  const [open, close] = random.pick(questions)(n);
  const type = random.pick(["any", "any", "number", "unknown"]);
  const subject = type === "unknown" ? "any" : type;
  const maker = random.pick(makers);
  const name = `store${index}`;
  const calls = random
    .sample(roads, random.between(2, 5))
    .map(
      road =>
        `  tell(${JSON.stringify(`${index} ${road}`)}, read(${name}(make${index}(), ${typed ? `(${road.replace(/\bn\b/g, String(n))} as any)` : road.replace(/\bn\b/g, String(n))}, ${n}), ${n}), read(${name}(make${index}(), ${n}, ${n}), ${n}));`,
    );
  return `function make${index}()${of("any[]")} {
  return ${maker};
}
function ${name}(to${of(random.pick(["any[]", "number[]"]))}, x${of(subject)}, y${of("number")})${of("any[]")} {
  ${open} ${random.pick(stores)} ${close}
  return to;
}
for (let turn = 0; turn < ${random.pick([1, 3])}; turn++) {
${calls.join("\n")}
}`;
}

export function generate(random: Random, typed: boolean): string {
  const scenes = Array.from({ length: random.between(4, 9) }, (_, index) => scene(random, typed, index));
  return [prelude(typed), ...scenes, `console.log("lines", lines);`, "export {};"].join("\n") + "\n";
}

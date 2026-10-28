// Loops add up fields of objects that may lack them. The objects are spelled as Object.create with stores, Object.assign, a literal with a spread,
// a rest pattern, or stores behind a branch; the numbers are small, lie past 31 and 32 bits, are doubles, or are undefined. Other loops read and
// write members stored on functions; in a late turn a member becomes an accessor, is removed, is frozen, or the function gets another prototype.
import type { Random } from "./random";

const numbers = [
  `1`,
  `2`,
  `7`,
  `i`,
  `i * 3`,
  `-i`,
  `0`,
  `-0`,
  `0.5`,
  `i + 0.25`,
  `2147483647`,
  `2147483648`,
  `-2147483648`,
  `-2147483649`,
  `4294967295`,
  `4294967296`,
  `2 ** 31 + i`,
  `2 ** 32 - i`,
  `2 ** 53`,
  `1e300`,
  `NaN`,
  `Infinity`,
  `undefined`,
  `null`,
  `"3"`,
  `true`,
] as const;

const conditions = [`i % 2`, `i % 3 === 0`, `i > late`, `i === late`, `i & 4`, `nothing`, `!nothing`] as const;

function spell(random: Random): string {
  const a = random.pick(numbers);
  const b = random.pick(numbers);
  const c = random.pick(numbers);
  const when = random.pick(conditions);
  return random.pick([
    `const o = Object.create(null);\no.a = ${a};\nif (${when}) o.b = ${b};`,
    `const o = Object.create(parent);\no.a = ${a};\nif (${when}) o.b = ${b};`,
    `const o = Object.create(parent);\nif (${when}) o.a = ${a};\no.c = ${c};`,
    `const o = Object.assign({}, { a: ${a} }, ${when} ? { b: ${b} } : null);`,
    `const o = Object.assign({ a: ${a}, b: ${b} }, ${when} ? { b: undefined } : { c: ${c} });`,
    `const o = Object.assign(Object.create(parent), { a: ${a} });`,
    `const r = ${when} ? { b: ${b} } : { c: ${c} };\nconst o = { a: ${a}, ...r };`,
    `const r = { a: ${a}, b: ${b} };\nconst o = { g: i, ...r };`,
    `const r = ${when} ? { a: ${a}, b: ${b} } : {};\nconst o = { ...r, c: ${c} };`,
    `const { a: taken, ...o } = { a: ${a}, b: ${b}, c: ${c} };`,
    `const { b: taken, ...o } = ${when} ? { a: ${a}, b: ${b} } : { a: ${a}, c: ${c} };`,
    `const o = { a: ${a} };\nif (${when}) o.b = ${b};\nelse o.c = ${c};`,
    `const o = {};\nif (${when}) o.a = ${a};\nif (i % 5) o.b = ${b};`,
    `const o = { a: ${a}, b: ${b} };\nif (${when}) delete o.b;`,
    `const o = new Made(${a});\nif (${when}) o.b = ${b};`,
    `const o = ${when} ? { a: ${a}, b: ${b} } : { b: ${b}, a: ${a}, c: ${c} };`,
  ]);
}

const sums = [
  `total += o.a + o.b;`,
  `total += o.a;\ntotal += o.b;`,
  `total += (o.a ?? 0) + (o.b ?? 0) + (o.c ?? 0);`,
  `total += o.a + (o.b || 0);`,
  `total += o.b === undefined ? o.a : o.b;`,
  `total = (total + o.a + o.b) | 0;`,
  `total = (total + o.a) >>> 0;`,
  `total += (o.a | 0) + (o.b | 0);`,
  `total += "b" in o ? o.b : 1;`,
  `if (o.b !== undefined) total += o.b;\nelse missing++;`,
  `total += o.a * 2 - (o.c ?? 1);`,
  `total += Math.max(o.a ?? 0, o.b ?? 0);`,
  `for (const key in o) total += o[key];`,
  `total += Object.values(o).reduce((sum, value) => sum + value, 0);`,
  `const { a = 1, b = 2, c = 3 } = o;\ntotal += a + b + c;`,
  `total += o.g ?? o.a;`,
] as const;

const events = [
  `Object.defineProperty(f, "step", { get() {\ngets++;\nreturn 5;\n}, configurable: true });`,
  `Object.defineProperty(f, "count", { get() {\nreturn 100;\n}, set(value) {\nsets++;\n}, configurable: true });`,
  `Object.defineProperty(f, "step", { value: 9, writable: false });`,
  `Object.setPrototypeOf(f, { extra: 11, step: 13 });`,
  `Object.setPrototypeOf(f, null);`,
  `delete f.step;`,
  `delete f.count;`,
  `f.step = 0.5;`,
  `f.step = "s";`,
  `f.step = undefined;`,
  `f.count = 2147483647;`,
  `Object.freeze(f);`,
  `Object.defineProperty(f, "name", { value: "renamed" });`,
  `Object.defineProperty(f, "length", { value: 9 });`,
  `delete f.name;`,
  `f.extra = 29;`,
] as const;

const functions = [
  `function f(one, two) {\nreturn one;\n}`,
  `const f = function (one) {\nreturn one;\n};`,
  `const f = one => one;`,
  `const f = { method(one) {\nreturn one;\n} }.method;`,
  `class f {\nstatic own = 1;\n}`,
  `const f = function named() {}.bind(null);`,
  `async function f() {}`,
  `function* f() {}`,
] as const;

const uses = [
  `f.count += f.step;`,
  `f.count = f.count + f.step;`,
  `total += f.count;`,
  `total += f.step;`,
  `total += f.extra ?? 1;`,
  `text = f.name;`,
  `total += f.length;`,
  `text = typeof f.caller;`,
  `text = String(Object.hasOwn(f, "step"));`,
  `f.calls = (f.calls ?? 0) + 1;`,
  `total += f.missing === undefined ? 1 : 2;`,
  `text = Object.keys(f).join();`,
] as const;

export function generate(random: Random): string {
  const rows: string[] = [];
  const count = random.between(2, 5);
  for (let row = 0; row < count; row++) {
    const turns = random.pick([5, 300, 300, 2000]);
    const late = random.below(turns);
    if (random.chance(0.55)) {
      rows.push(
        `function sums${row}(late) {\nlet total = 0;\nlet missing = 0;\nfor (let i = 0; i < ${turns}; i++) {\n${spell(random)}\n${random.pick(sums)}\nif (i === late || i === ${turns - 1}) say("${row} at " + i + ": " + total + " " + missing);\n}\n}\nattempt("${row}", () => sums${row}(${late}));`,
      );
      continue;
    }
    const body = Array.from({ length: random.between(1, 4) }, () => random.pick(uses)).join("\n");
    const happens = Array.from({ length: random.between(1, 2) }, () => random.pick(events)).join("\n");
    rows.push(
      `function members${row}(late) {\n${random.pick(functions)}\nlet total = 0;\nlet text = "";\nattempt("${row} stores", () => {\nf.count = 0;\nf.step = ${random.pick(["1", "2", "0.5", "2147483647"])};\n});\nfor (let i = 0; i < ${turns}; i++) {\nif (i === late) attempt("${row} event", () => {\n${happens}\n});\ntry {\n${body}\n} catch (error) {\ntext = "threw " + error.constructor.name;\n}\nif (i === late - 1 || i === late || i === ${turns - 1}) say("${row} at " + i + ": " + total + " " + text + " " + String(Object.getOwnPropertyDescriptor(f, "count")?.value) + " " + gets + " " + sets);\n}\n}\nattempt("${row}", () => members${row}(${late}));`,
    );
  }
  return `const lines = [];
const nothing = globalThis[process.argv[2] ?? "nothing"];
const parent = { b: 40, c: 50 };
let gets = 0;
let sets = 0;
class Made {
constructor(a) {
this.a = a;
}
}
function say(line) {
lines.push(line);
}
function attempt(label, run) {
try {
run();
} catch (error) {
lines.push(label + " threw " + error.constructor.name);
}
}
${rows.join("\n")}
console.log(lines.join("\\n"));
`;
}

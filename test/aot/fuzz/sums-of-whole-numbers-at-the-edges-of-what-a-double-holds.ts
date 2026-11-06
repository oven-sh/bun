// Loops add and subtract whole numbers that come from counters, fields, methods, lists, lengths, shifts and products, and cut the sum to 32 bits,
// to a whole number, or not at all. The numbers stand at the edges of 31, 32, 52 and 53 bits. Now and then a field holds a fraction, -0, NaN,
// an infinity, undefined or a text, first seen in a late turn of the loop.
import type { Random } from "./random";

const edges = [
  `0`,
  `1`,
  `-1`,
  `7`,
  `2147483647`,
  `-2147483648`,
  `2147483648`,
  `4294967295`,
  `4294967296`,
  `-4294967297`,
  `1073741824`,
  `4503599627370495`,
  `4503599627370496`,
  `-4503599627370497`,
  `9007199254740991`,
  `-9007199254740991`,
  `9007199254740992`,
  `2251799813685248`,
] as const;
const odd = [`0.5`, `-0`, `NaN`, `Infinity`, `-Infinity`, `undefined`, `"3"`, `null`, `1e300`, `true`] as const;

const terms = [
  `i`,
  `i`,
  `holder.field`,
  `holder.get()`,
  `stored.get()`,
  `list[i % list.length]`,
  `text.length`,
  `(i >>> 0)`,
  `(holder.field >>> 0)`,
  `(holder.field | 0)`,
  `(i * 4096)`,
  `(i * holder.field)`,
  `Math.imul(i, 31)`,
  `(i << 20)`,
  `(holder.field & 0xffff)`,
  `edge`,
  `other.field`,
  `-i`,
  `(i % 7)`,
  `Math.floor(i / 3)`,
  `Math.trunc(holder.field / 2)`,
  `Math.max(i, holder.field)`,
  `Math.abs(holder.field)`,
] as const;

const cuts = [
  (text: string) => `(${text}) | 0`,
  (text: string) => `(${text}) | 0`,
  (text: string) => `(${text}) >>> 0`,
  (text: string) => `~~(${text})`,
  (text: string) => `Math.trunc(${text})`,
  (text: string) => `Math.floor(${text})`,
  (text: string) => `Math.round(${text})`,
  (text: string) => `Math.ceil(${text})`,
  (text: string) => `(${text}) & 0xfffff`,
  (text: string) => `(${text}) % 1000003`,
  (text: string) => `${text}`,
  (text: string) => `${text}`,
  (text: string) => `Math.trunc(${text}) | 0`,
  (text: string) => `((${text}) | 0) + ((${text}) >>> 0)`,
  (text: string) => `Number.isSafeInteger(${text}) ? ${text} : sum`,
] as const;

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

export function generate(random: Random): string {
  const lines = [
    `function Stored(field) {\nthis.field = field;\n}`,
    `Stored.prototype.get = function () {\nreturn this.field;\n};`,
    `class Holder {\nconstructor(field) {\nthis.field = field;\n}\nget() {\nreturn this.field;\n}\n}`,
    `const text = Date.now() > 0 ? "some text" : "";`,
    `const out = [];`,
    `function show(value) {\nreturn Object.is(value, -0) ? "-0" : typeof value + " " + String(value);\n}`,
  ];
  const count = random.between(2, 7);
  for (let index = 0; index < count; index++) {
    const sum = Array.from({ length: random.between(1, 4) }, () => pick(random, terms)).reduce(
      (text, term) => `${text} ${pick(random, [`+`, `+`, `+`, `-`])} ${term}`,
      `sum`,
    );
    const turns = pick(random, [3, 40, 1000, 20000]);
    lines.push(
      `function f${index}(holder, stored, other, list, edge, turns) {\nlet sum = ${pick(random, [`0`, `edge`, `holder.field`])};\nfor (let i = 0; i < turns; i++) {\n${random.chance(0.3) ? `if (i === turns - 2) holder = other;\n` : ``}sum = ${pick(random, cuts)(sum)};\n}\nreturn sum;\n}`,
    );
    for (let call = random.between(1, 4); call > 0; call--) {
      const value = () => (random.chance(0.15) ? pick(random, odd) : pick(random, edges));
      lines.push(
        `out.push("f${index} " + show(f${index}(new Holder(${value()}), new Stored(${value()}), new Holder(${value()}), [${value()}, ${value()}, ${value()}], ${pick(random, edges)}, ${turns})));`,
      );
    }
  }
  lines.push(`console.log(out.join("\\n"));`);
  return lines.join("\n") + "\n";
}

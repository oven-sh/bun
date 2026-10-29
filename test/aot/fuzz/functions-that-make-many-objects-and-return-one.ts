// One function makes 8 to 148 pairs of small objects, stores into some of them, and returns one of them, two of them in a holder or a
// list, or a new object made behind them all. The caller prints what it gets, asks whether two calls give the same object, adds a
// property and keeps it. A program draws what the objects are, how they are stored into, what is returned and how many there are.
import type { Random } from "./random";

type Made = { type: string; make: (name: string, value: string) => string; fresh: string };

const made: Made[] = [
  {
    type: `interface Box { f: number | string }`,
    make: (name, value) => `const ${name}: Box = { f: ${value} };`,
    fresh: `{ f: 0 } as Box`,
  },
  {
    type: `class Box { f: number | string; constructor(f: number | string) { this.f = f; } }`,
    make: (name, value) => `const ${name} = new Box(${value});`,
    fresh: `new Box(0)`,
  },
  {
    type: `interface Box { f: number | string; g?: Box }`,
    make: (name, value) => `const ${name}: Box = { f: ${value}, g: undefined };`,
    fresh: `{ f: 0, g: x0 } as Box`,
  },
];

const stores: ((i: number) => string)[] = [
  i => `((c & ${1 << i % 8}) ? x${i} : y${i}).f = "s${i}";`,
  i => `x${i}.f = "x${i}"; y${i}.f = c + ${i};`,
  i => `if (c > ${i}) x${i}.f = "s${i}"; else y${i}.f = "t${i}";`,
  i => (i ? `((c & 1) ? x${i} : y${i}).f = x${i - 1}.f;` : `x0.f = "first";`),
  () => ``,
];

const returns: ((n: number, fresh: string) => [type: string, end: string])[] = [
  n => [`Box`, `return y${n - 1};`],
  () => [`Box`, `return x0;`],
  n => [`Box`, `return c & 1 ? x${n - 1} : y${n - 1};`],
  n => [`Box`, `return c & 1 ? x0 : y${n - 1};`],
  n => [`{ first: Box; last: Box }`, `return { first: x0, last: y${n - 1} };`],
  n => [`Box[]`, `return [x0, y${n - 1}];`],
  n => [`Box`, `if (c === 3) return x${n >> 1}; total += 1; return y${n - 1};`],
  (n, fresh) => [`Box`, `const result = ${fresh}; result.f = String(x${n - 1}.f) + y0.f; return result;`],
  n => [`Box`, `try { if (c === 2) throw new Error("two"); return y${n - 1}; } catch { return x${n - 1}; }`],
];

export function generate(random: Random): string {
  const { type, make, fresh } = random.pick(made);
  const store = random.pick(stores);
  const n = 8 + 4 * random.below(36);
  const [resultType, end] = random.pick(returns)(n, fresh);
  const indexes = Array.from({ length: n }, (_, i) => i);
  const read = Math.min(n, 6);
  const lines = [
    ...indexes.map(i => `${make("x" + i, `a + ${i}`)} ${make("y" + i, `b + ${i}`)}`),
    ...indexes.map(store).filter(line => line),
    `total += ${Array.from({ length: read }, (_, i) => `String(x${i * Math.floor(n / read)}.f).length`).join(" + ")};`,
    end,
  ];
  return `${type}
let total = 0;
function make(a: number, b: number, c: number): ${resultType} {
${lines.map(line => "  " + line).join("\n")}
}
const kept: unknown[] = [];
for (let turn = 0; turn < 6; turn++) {
  const got = make(turn, turn * 10, turn);
  console.log(JSON.stringify(got));
  const again = make(turn, turn * 10, turn);
  console.log(got === again, JSON.stringify(again) === JSON.stringify(got));
  (got as any).added = turn;
  kept.push(got);
}
console.log(JSON.stringify(kept), total);
`;
}

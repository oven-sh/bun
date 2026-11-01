// An optional field of numbers answers with its default only where it is absent or undefined. Every number, every NaN among them, is the answer itself.
type Options = { factor?: number; amount: number };

function scale({ factor = 2, amount }: Options): number {
  return factor * amount;
}

function factorOf(options: Options): number {
  return options.factor ?? 10;
}

function describe(options: Options): string {
  return options.factor === undefined ? "none" : Object.is(options.factor, -0) ? "-0" : String(options.factor);
}

const bits = new BigUint64Array(1);
const numbers = new Float64Array(bits.buffer);
const patterns = [
  0x7ff8000000000000n,
  0xfff8000000000000n,
  0x7ff8000000000001n,
  0x7ff8000000000002n,
  0x7ffc000000000000n,
  0x7ffe000000000000n,
  0x7fff000000000000n,
  0x7fffffffffffffffn,
  0xffffffffffffffffn,
  0xfffe000000000000n,
  0xfffe00000000000an,
  0x7ff0000000000001n,
  0x7ff0000000000000n,
  0xfff0000000000000n,
  0x7fefffffffffffffn,
  0x8000000000000000n,
  0x0000000000000001n,
];

const made: Options[] = [
  { amount: 3 },
  { factor: undefined, amount: 3 },
  { factor: 0 / (+process.argv.length - process.argv.length), amount: 3 },
];
for (const pattern of patterns) {
  bits[0] = pattern;
  made.push({ factor: numbers[0], amount: 3 });
}
for (const value of [0, -0, 1, -1, 1.5, 2 ** 31, -(2 ** 31), 2 ** 53, Infinity, -Infinity, NaN, -NaN])
  made.push({ factor: value, amount: 3 });

for (let round = 0; round < 3; round++) {
  const lines: string[] = [];
  for (const options of made)
    lines.push(`${scale(options)} ${factorOf(options)} ${describe(options)} ${"factor" in options}`);
  console.log(lines.join(" | "));
}

const late: Options = { amount: 4 };
console.log(scale(late), factorOf(late), describe(late));
late.factor = NaN;
console.log(scale(late), factorOf(late), describe(late));
late.factor = undefined;
console.log(scale(late), factorOf(late), describe(late));
delete late.factor;
console.log(scale(late), factorOf(late), describe(late), "factor" in late);

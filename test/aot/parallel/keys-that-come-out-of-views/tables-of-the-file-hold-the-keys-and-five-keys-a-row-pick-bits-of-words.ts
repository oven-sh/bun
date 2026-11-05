// Nobody has written what the tables are: they are what a call gave.
const show = (value: any): string => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value));
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
function hidden<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
const ROWS = Array.from({ length: 12 }, (_, k) => ({ i: k % 8, a: k % 31, j: (k * 7) % 8, b: (k * 3) % 31, c: k & 1 }));
const MASKS = Int32Array.from(ROWS.map((_, k) => (k % 5 === 0 ? 1 << (k % 31) : 0)));
const PACKED = Int32Array.from(ROWS.flatMap(({ i, a, j, b, c }) => [i, a, j, b, c]));
function work(words: Int32Array): unknown {
  const packed = PACKED;
  let mask = -1;
  for (let row = 0, at = 0; at < packed.length && mask !== 0; row += 1, at += 5) {
    const isBroken = (((words[packed[at]!]! >>> packed[at + 1]!) ^ (words[packed[at + 2]!]! >>> packed[at + 3]!)) & 1) ^ packed[at + 4]!;
    mask &= ~(MASKS[row]! & -isBroken);
  }
  return mask;
}
for (const made of [[1, 2, 3, 4, 5, 6, 7, 8], [-1, -1, -1, -1, -1, -1, -1, -1], [9, 8], []]) console.log(attempt(() => work(hidden(new Int32Array(made)))));

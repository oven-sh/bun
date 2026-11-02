// `x ** n` with n an integer at run time, inside and outside the range that is multiplied out: the bits of the answer are those of plain Bun.
const bases: number[] = [
  0,
  -0,
  1,
  -1,
  0.5,
  1.0001,
  2,
  -2,
  3,
  1e300,
  -1e300,
  1e-300,
  NaN,
  Infinity,
  -Infinity,
  1.5,
  -1.5,
  10,
];
const exponents: number[] = [
  0, 1, 2, 3, 7, 8, 255, 256, 999, 1000, 1001, 1024, 100000, 2147483647, -1, -2, -1000, -1001, -2147483648,
];
const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);
const shown = (value: number) => {
  bits[0] = value;
  return Number.isNaN(value) ? "NaN" : `${words[1]!.toString(16)}:${words[0]!.toString(16)}`;
};
function power(base: number, exponent: number): number {
  return base ** (exponent | 0);
}
function powerByCall(base: number, exponent: number): number {
  return Math.pow(base, exponent | 0);
}
function masked(base: number, turn: number): number {
  return base ** (turn & 255);
}
const lines: string[] = [];
for (const base of bases) {
  const row: string[] = [];
  for (const exponent of exponents) row.push(shown(power(base, exponent)), shown(powerByCall(base, exponent)));
  lines.push(row.join(" "));
}
let sum = 0;
for (let turn = 0; turn < 100000; turn++) sum += masked(1.0001, turn) + power(-1.5, turn & 15);
lines.push(String(sum));
console.log(lines.join("\n"));

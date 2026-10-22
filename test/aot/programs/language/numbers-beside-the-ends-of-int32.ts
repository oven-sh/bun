// A number is taken for an int32 only if it is one: what lies outside, and has the low half of a small integer, is not.
const letters: string[] = ["a", "b", "c", "d", "e", "f", "g", "h"];

function letterAt(index: number): string {
  const letter = letters[index];
  return letter === undefined ? "-" : letter;
}

function isSmall(value: number): string {
  return (value | 0) === value ? "int32" : "other";
}

function half(value: number): number {
  return value / 2;
}

const doubled: number[] = [
  2, 10, 0, -0, -2, 1, 3,
  2 * 4294967296 + 2, 2 * 4294967297, -2 * 4294967296 + 4, 2 * 2147483647, 2 * 2147483648, -2 * 2147483648, -2 * 2147483649,
  2 * 9007199254740991, 1e300, -1e300, Infinity, -Infinity, NaN,
];

const lines: string[] = [];
for (const value of doubled) {
  const number = half(value);
  lines.push(`${Object.is(number, -0) ? "-0" : number}: ${letterAt(number)} ${isSmall(number)} ${letters.at(number) ?? "-"} ${"abcdefgh".charAt(number) || "-"}`);
}
console.log(lines.join("\n"));

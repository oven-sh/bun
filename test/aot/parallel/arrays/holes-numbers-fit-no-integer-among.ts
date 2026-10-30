// An element of a `number[]` that goes straight into `^`, `|`, `>>`, or is the index of the next read: whether it is there and whether it is whole or fits an integer is asked at once.
// A hole is read as undefined, NaN as NaN, and a number outside every integer is wrapped as ECMAScript says: none is taken for another.
function xorAll(numbers: number[]): number {
  let result = 0;
  for (let i = 0; i < numbers.length; i++) result ^= numbers[i]!;
  return result;
}
function orEach(numbers: number[]): string {
  let text = "";
  for (const each of numbers) text += (each | 0) + ",";
  return text;
}
function shifted(numbers: number[], index: number): number {
  return numbers[index]! >> 1;
}
function unsigned(numbers: number[], index: number): number {
  return numbers[index]! >>> 0;
}
function chase(numbers: number[], start: number): unknown {
  let at: number = start;
  at = numbers[at]!;
  at = numbers[at]!;
  at = numbers[at]!;
  return at;
}
function storeAndChase(numbers: number[], start: number): unknown {
  let at: number = start;
  numbers[at] = at;
  at = numbers[at + 1]!;
  numbers[at] = at;
  at = numbers[at + 1]!;
  return at;
}
function firstTwo(numbers: number[]): number {
  const [a, b] = numbers;
  return a! ^ b!;
}
function show(value: unknown): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function describe(numbers: number[]): string {
  let text = "";
  for (let i = 0; i < numbers.length && i < 8; i++) text += (i in numbers ? show(numbers[i]) : "hole") + ",";
  return text + numbers.length;
}

const kinds: [string, () => number[]][] = [
  ["whole", () => [1, 2, 3, 0, 2]],
  ["fractions", () => [1.5, 2, 0.25, 3, 1]],
  ["a hole", () => { const a: number[] = [1, 2, 3, 4, 0]; delete a[2]; return a; }],
  ["a hole at the start", () => { const a: number[] = [1, 2, 3, 4, 0]; delete a[0]; return a; }],
  ["only holes", () => { const a: number[] = [0.5]; a.length = 4; delete a[0]; return a; }],
  ["NaN", () => [1, NaN, 3, 1, 0]],
  ["infinite", () => [1, Infinity, -Infinity, 1, 0]],
  ["negative zero", () => [-0, 1, -0, 0, 2]],
  ["two to the 31", () => [2147483648, -2147483649, 4294967296, 4294967295.5, 1]],
  ["two to the 53", () => [9007199254740992, -9007199254740992, 9007199254740993, 1, 0]],
  ["the ends of int64", () => [9223372036854775807, -9223372036854775808, 9223372036854775808 * 2, -9223372036854777856, 18446744073709551616]],
  ["huge", () => [1e300, -1e300, 1.7976931348623157e308, 5e-324, 1e21]],
  ["negative", () => [-1, -2, -3.5, 4, 0]],
  ["past the end", () => [7, 100, 5, 4294967295, 4294967294]],
];
for (let round = 0; round < 3; round++) {
  for (const [what, make] of kinds) {
    const numbers = make();
    const answers = [xorAll(numbers), orEach(numbers), firstTwo(numbers)];
    for (let i = 0; i < 6; i++) answers.push(shifted(numbers, i), unsigned(numbers, i), show(chase(numbers, i)));
    console.log(what, "|", answers.join(" "), "|", describe(numbers));
    const stored = [];
    for (let i = 0; i < 4; i++) stored.push(show(storeAndChase(numbers, i)));
    console.log(what, "stores |", stored.join(" "), "|", describe(numbers));
  }
}

// Terms of keys that are no int32s: fractions, NaN, infinities and products past the int32s leave the keys as numbers.
const doubles: number[] = [];
const ints: number[] = [];
for (let i = 0; i < 16; i++) {
  doubles.push(((i * 7) % 13) / 4);
  ints.push(i);
}
function scaled(list: number[], x: number, y: number): number {
  let sum = 0;
  for (let i = 3; i >= 0; i--) sum = sum + list[x * i + y] * 2;
  return sum;
}
function squared(list: number[], x: number, width: number): number {
  let sum = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) sum += list[x * width + x];
  return sum;
}
let width = 2;
let height = 0;
function read(x: number, w: number, h: number): string {
  width = w;
  height = h;
  const seen: number[] = [];
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 4; i++) {
      seen.push(doubles[x * height + i]);
      if (seen.length > 20) width++;
    }
  return seen.join();
}
const numbers: number[] = [0, 1, 2, 3, 5, -0, -1, 0.5, 1.5, NaN, Infinity, 2 ** 20, 2 ** 20 + 1, 2 ** 31 - 1, 2 ** 31, 2 ** 32, 4294967295, 2 ** 53, 1e300, -(2 ** 31)];
const lines: string[] = [];
for (const x of numbers)
  for (const y of numbers) lines.push([x, y, scaled(doubles, x, y), scaled(ints, x, y), squared(doubles, x, y), squared(ints, x, y), read(x, 1, y)].join(" "));
console.log(lines.join("\n"));

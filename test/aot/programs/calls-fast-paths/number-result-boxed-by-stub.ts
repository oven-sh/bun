// A function that is only called through values returns its number boxed. It jumps to one stub that boxes it, with or without a frame and from every return.
// CALLS+ addOne BoxNumber
// CALLS+ half BoxNumber
// CALLS+ negate BoxNumber
// CALLS+ xOf BoxOptionalNumber
// CALLS+ firstOf BoxNumber
// CALLS+ pick BoxNumber
type Point = { x: number; y: number };
function addOne(a: number): number {
  return a + 1;
}
function half(a: number): number {
  return a / 2;
}
function negate(a: number): number {
  return -a;
}
function xOf(a: number): number {
  const point: Point = JSON.parse(`{ "x": ${Number.isFinite(a) ? a : 0}, "y": 2 }`);
  return point.x;
}
function pick(a: number): number {
  if (a > 1) return a * 2;
  if (a < -1) return a * 0.25;
  return a * a;
}
function firstOf(a: number): number | undefined | null {
  if (a > 2) return undefined;
  if (a < -2) return null;
  return a * 1.5;
}
function plusOneOrNaN(a?: number): number {
  return (a as number) + 1;
}
const table: Record<string, Function> = { addOne, half, negate, xOf, pick, firstOf, plusOneOrNaN };
const show = (value: unknown) => (Object.is(value, -0) ? "-0" : `${typeof value} ${value}`);
const numbers = [0, -0, 1, -1, 0.5, -0.5, 3, 2147483646, 2147483647, 2147483648, -2147483647, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 1e21, 5e-324, NaN, Infinity, -Infinity];
for (const name of Object.keys(table)) {
  console.log(name, numbers.map(number => show(table[name](number))).join(", "));
}
const never = Date.now() < 0;
console.log(show(table[never ? "addOne" : "plusOneOrNaN"]()));
const seen = new Map<unknown, number>();
for (const number of numbers) seen.set(table[never ? "half" : "addOne"](number), number);
console.log(seen.size, seen.get(1), seen.get(2), seen.get(NaN), seen.get(2147483648), [10, 20, 30][table[never ? "half" : "addOne"](0)]);

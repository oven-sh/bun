// Spreads into calls, arrays and objects.
const numbers = [1, 2, 3];
const more = [0, ...numbers, 4, ...new Set([5, 5, 6])];
console.log(more, Math.max(...more), [..."hi"]);
const base = { a: 1, b: 2 };
const nothing = null as { d: number } | null;
const merged = { ...base, b: 3, ...{ c: 4 }, ...nothing };
console.log(merged);
function sum(...values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
console.log(sum(), sum(...numbers), sum(1, ...numbers, 2));
class Pair {
  constructor(
    public left: number,
    public right: number,
  ) {}
}
const pair = new Pair(...([7, 8] as [number, number]));
console.log(pair.left, pair.right);

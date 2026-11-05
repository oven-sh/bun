// Literals of five to seventeen elements, made in hot loops: integers, fractions and any values, with elements computed in the literal from one variable, from two,
// from a call, and behind an await. Then the same in a realm where an object that others inherit from has an accessor under an index.
const kept: unknown[] = [];
function keep(list: unknown): void {
  kept[kept.length & 7] = list;
}
function integers(i: number): number[] {
  return [i & 1, i & 2, (i >> 1) & 3, i & 4, (i << 2) | 1, i ^ 6, i & 7, (i >>> 3) & 8];
}
function five(i: number): number[] {
  return [i & 15, 1, (i & 3) + 1, (i & 3) - 1, (i & 3) * 3];
}
function sixteen(i: number): number[] {
  return [i & 1, i & 2, i & 3, i & 4, i & 5, i & 6, i & 7, i & 8, i & 9, i & 10, i & 11, i & 12, i & 13, i & 14, i & 15, i & 16];
}
function seventeen(i: number): number[] {
  return [i & 1, i & 2, i & 3, i & 4, i & 5, i & 6, i & 7, i & 8, i & 9, i & 10, i & 11, i & 12, i & 13, i & 14, i & 15, i & 16, i & 17];
}
function twoVariables(i: number, j: number): number[] {
  return [i & j, i | j, i ^ j, (i & 7) + (j & 7), (i & 7) - (j & 7), (i & 7) * (j & 7)];
}
function fractions(i: number): number[] {
  return [i + 0.5, i * 0.25, i - 1.5, 2.5, i & 3, i / 4];
}
function withNaN(i: number): number[] {
  return [i + 0.5, i * 0.25, (i & 1) / (i & 1), 2.5, i & 3];
}
function values(i: number, text: string): unknown[] {
  return [i & 3, text, null, i + 0.5, undefined, { id: i & 1 }, [i & 1]];
}
let calls = 0;
function next(i: number): number {
  calls++;
  return (i + calls) & 255;
}
function withCalls(i: number): number[] {
  return [i & 1, next(i), i & 2, next(i), i & 3, calls & 7];
}
function usedTwice(i: number): number {
  const low = i & 7;
  const list = [low, i & 1, i & 2, i & 3, low, i & 4];
  keep(list);
  return low + list[4]! + list[5]!;
}
async function behindAwait(i: number): Promise<number[]> {
  return [i & 1, i & 2, await Promise.resolve(i & 3), i & 4, i & 5, await Promise.resolve(7)];
}
function* behindYield(i: number): Generator<number, number[], number> {
  return [i & 1, i & 2, yield i & 3, i & 4, i & 5, i & 6];
}
function sum(list: readonly unknown[]): number {
  let total = 0;
  for (let k = 0; k < list.length; k++) {
    const value = list[k];
    total += typeof value === "number" ? (value === value ? value : 1000) : typeof value === "string" ? value.length : value === null ? 3 : value === undefined ? 5 : 7;
  }
  return total + list.length * 10000;
}
function round(turns: number): string {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    const a = integers(i), b = five(i), c = sixteen(i), d = seventeen(i), e = twoVariables(i, i >> 2), f = fractions(i), g = withNaN(i), h = values(i, "ab"), w = withCalls(i);
    keep(a), keep(c), keep(f), keep(h);
    total = (total + sum(a) + sum(b) + sum(c) + sum(d) + sum(e) + sum(f) + sum(g) + sum(h) + sum(w) + usedTwice(i)) % 1000003;
  }
  return String(total);
}
console.log(round(30000));
console.log(JSON.stringify([integers(205), five(205), sixteen(205), seventeen(205), twoVariables(205, 77), fractions(205), withNaN(204), withNaN(205), values(205, "x"), withCalls(205)]));
console.log(JSON.stringify(await behindAwait(205)));
const steps = behindYield(205);
console.log(steps.next().value, JSON.stringify(steps.next(99).value));

// A longer list grows, shrinks and changes its storage like any other.
const grown = integers(9);
grown.push(1.5);
grown[12] = 4;
grown.length = 11;
console.log(JSON.stringify(grown), grown.length, 9 in grown);

// From here on the engine gives every new array the storage that asks the objects above it before a store into a hole.
const stored: string[] = [];
class Above extends Array<unknown> {}
Object.defineProperty(Above.prototype, 20, {
  configurable: true,
  get() {
    return "inherited";
  },
  set(value) {
    stored.push(String(value));
  },
});
console.log(round(2000));
for (const list of [integers(205), sixteen(205), fractions(205), values(205, "x"), five(205)] as unknown[][]) {
  list[18] = "own";
  console.log(list.length, list[20], Object.keys(list).length, JSON.stringify(list));
  Object.setPrototypeOf(list, Above.prototype);
  list[20] = list.length;
  console.log(list.length, list[20], Object.keys(list).length, Array.isArray(list));
}
console.log(stored.join());
console.log(round(2000), kept.length);

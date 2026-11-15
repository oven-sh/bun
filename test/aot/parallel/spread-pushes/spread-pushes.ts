function statement(out: number[], list: number[]): number[] {
  out.push(...list);
  return out;
}
function used(out: number[], list: number[]): number {
  return out.push(...list);
}
function named(out: number[], list: number[]): number {
  const length: number = out.push(...list);
  return length * 2;
}
function inLoop(lists: number[][]): [number[], number] {
  const out: number[] = [];
  let sum = 0;
  for (const list of lists) {
    out.push(...list);
    sum += out.length;
  }
  return [out, sum];
}
function itself(list: number[]): number[] {
  list.push(...list);
  return list;
}
function literal(out: any[], a: any, b: any[]): any[] {
  out.push(...[a, ...b]);
  return out;
}
const lists: any[][] = [[], [1], [1, 2, 3], [0.5, -0, NaN], ["a", null, undefined], [{ a: 1 }], Array.from({ length: 300 }, (_, i) => i), [1, , 3]];
class Other extends Array {
  push(...values: any[]): number {
    for (const value of values) super.push([value]);
    return -7;
  }
}
const odd: any[] = [new Other(), Object.assign([1, 2], { push: (...values: any[]) => "own" + values.length }), Object.freeze([1]), new Uint8Array(2), { push: (...values: any[]) => values.length, length: 5 }, "text", null, undefined];
const iterables: any[] = ["abc", new Set([1, 2]), new Map([[1, 2]]), { *[Symbol.iterator]() { yield 4; yield 5; } }, 7, null];
function show(run: () => unknown): string {
  try {
    const value = run();
    return JSON.stringify(value === undefined ? "undefined" : value)?.slice(0, 120);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
for (const list of lists) {
  console.log(show(() => statement([9], list)), show(() => used([9], list)), show(() => named([9], list)), show(() => itself(list.slice())), show(() => literal([8], 1, list)));
}
console.log(show(() => inLoop(lists.slice(0, 4))), show(() => inLoop(lists).slice(1)));
for (const out of odd) console.log(show(() => statement(out, [1, 2])), show(() => used(out, [3])), show(() => named(out, [])));
for (const list of iterables) console.log(show(() => statement([], list)), show(() => used([], list)), show(() => named([], list)));

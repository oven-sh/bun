// Array.prototype is an array: Array.isArray says so, and its length is 0. It has no room for elements, unlike every other array, so nothing may read its length or its elements where other arrays keep theirs.
function lengthOfTyped(list: unknown[]): number { return list.length; }
function lengthOfUntyped(list: any): number { return list.length; }
function lengthIfArray(value: unknown): number | string { return Array.isArray(value) ? value.length : typeof value; }
function sumOfTyped(list: number[]): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; }
function countByIteration(list: unknown[]): number { let count = 0; for (const _ of list) count++; return count; }
function lastOf(list: unknown[]): unknown { return list[list.length - 1]; }
function isEmpty(list: unknown[]): boolean { return list.length === 0; }
function describe(list: unknown[]): string {
  return [
    Array.isArray(list), list.length, list.join("-"), list.slice().length, list.concat([1]).length, [...list].length, list.indexOf(1), list.includes(undefined), String(list.at(0)), String(list.at(-1)),
    Array.from(list).length, JSON.stringify(list), list.map(x => x).length, list.filter(() => true).length, list.every(() => false), list.some(() => true), [...list.entries()].length, list.flat().length,
    String(list[0]), 0 in list, Object.keys(list).length, list.toString() === "", list.lastIndexOf(1), list.findIndex(() => true), list.reduce((sum: number) => sum + 1, 0),
  ].join();
}

const others: unknown[][] = [[1, 2, 3], [], ["a"], [1.5, 2.5], new Array(3)];
const mixed: unknown[][] = [others[0], Array.prototype, others[1], Array.prototype, others[2], others[3], Array.prototype, others[4]];
for (let round = 0; round < 3; round++) {
  const lines: string[] = [];
  for (const list of mixed) {
    lines.push([lengthOfTyped(list), lengthOfUntyped(list), lengthIfArray(list), countByIteration(list), String(lastOf(list)), isEmpty(list)].join());
  }
  console.log(lines.join(" | "));
}
console.log(sumOfTyped(Array.prototype), sumOfTyped([1, 2, 3]));
console.log(describe(Array.prototype));
console.log(describe([1, 2]));
console.log(lengthIfArray(Array.prototype), lengthIfArray("text"), lengthIfArray([0]), lengthIfArray({ length: 7 }), lengthIfArray(Object.create(Array.prototype)));

const [first = "none", ...rest] = Array.prototype;
console.log(first, rest.length, Math.max(...Array.prototype), String.fromCharCode(...(Array.prototype as number[])).length, new Set(Array.prototype).size, Object.assign([], Array.prototype).length);
console.log(Reflect.apply((...all: unknown[]) => all.length, null, Array.prototype), [1].concat(Array.prototype as number[]).length, Array.prototype.length);

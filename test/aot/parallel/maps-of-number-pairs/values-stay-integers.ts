import * as jsc from "bun:jsc";

const describe: (value: unknown) => string = (jsc as any).describe;
const kind = (value: unknown) => describe(value).split(":")[0].split(" ")[0];
const size = process.argv.length + 18;
const fromLength = new Map<number, number>(Array.from({ length: size }, (_, i) => [(i * 7919) | 0, i] as [number, number]));
const fractions = new Map<number, number>([[1, 0.5], [2, -0], [3, NaN], [-0, 4], [0.5, 2147483648]]);

function sum(list: number[], map: Map<number, number>): number {
  let total = 0;
  for (const key of list) if (map.has(key)) total += map.get(key)!;
  return total;
}

const keys = [...fromLength.keys()];
console.log(kind(keys[3]), kind(fromLength.get(7919 * 3)), sum(keys, fromLength) === (size * (size - 1)) / 2);
console.log([...fractions].map(([key, value]) => `${key}:${Object.is(value, -0) ? "-0" : value}`).join(" "));
console.log(sum([1, 2, 0, 9, -0, 0.5], fractions), fractions.has(undefined as never), fractions.get([1, 2][5]!));

/* Output:
Int32 Int32 true
1:0.5 2:-0 3:NaN 0:4 0.5:2147483648
2147483656.5 false undefined
*/

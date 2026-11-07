// Maps and Sets whose keys are numbers, strings, objects or a mix, made from lists of pairs, by set() and add(), and changed while they are walked: every walk sees the same entries in the same order as in plain Bun.
const show = (value: unknown): string =>
  typeof value === "object" && value !== null ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
function walk(label: string, map: Map<unknown, unknown>): void {
  const seen: string[] = [];
  for (const key of map.keys()) seen.push(show(key));
  for (const value of map.values()) seen.push(show(value));
  for (const [key, value] of map) seen.push(show(key) + "=" + show(value));
  for (const entry of map.entries()) seen.push(show(entry[0]) + ":" + show(entry[1]));
  map.forEach((value, key) => seen.push(show(key) + ">" + show(value)));
  console.log(label, map.size, seen.join(" "));
}
function walkSet(label: string, set: Set<unknown>): void {
  const seen: string[] = [];
  for (const key of set) seen.push(show(key));
  for (const key of set.keys()) seen.push(show(key));
  for (const [a, b] of set.entries()) seen.push(show(a) + "=" + show(b));
  set.forEach(key => seen.push(show(key)));
  console.log(label, set.size, seen.join(" "));
}
function sumOfKeys(map: Map<number, number>): number {
  let total = 0;
  for (const key of map.keys()) total += key;
  return total;
}
function sumOfPairs(map: Map<number, number>): number {
  let total = 0;
  for (const [key, value] of map) total += key * value;
  return total;
}

const numbers = [3, 1, 4, 1.5, -0, 9, 2 ** 31, -7, NaN, Infinity];
const fromPairs: Map<number, number> = new Map(numbers.map((x, j): [number, number] => [x, j]));
const bySet = new Map<number, number>();
numbers.forEach((x, j) => bySet.set(x, j));
for (let round = 0; round < 3; round++)
  console.log(sumOfKeys(fromPairs), sumOfKeys(bySet), sumOfPairs(fromPairs), sumOfPairs(bySet));
walk("from pairs", fromPairs);
walk("by set", bySet);

const point = { x: 1 };
const list = [1, 2];
walk(
  "objects and numbers",
  new Map<unknown, unknown>([
    [point, 1],
    [2, point],
    [list, list],
    [0.5, "half"],
  ]),
);
walk(
  "objects alone",
  new Map<unknown, unknown>([
    [point, 1],
    [list, 2],
  ]),
);
walk(
  "strings and numbers",
  new Map<unknown, unknown>([
    ["a", 1],
    [1, "a"],
    ["1", 2],
    [true, false],
    [null, undefined],
    [undefined, null],
  ]),
);
walk(
  "strings alone",
  new Map<unknown, unknown>([
    ["a", 1],
    ["b", 2],
  ]),
);
walk("empty", new Map());
walk(
  "pairs that are keys",
  new Map<unknown, unknown>([
    [
      [1, 2],
      [3, 4],
    ],
    [5, [6, 7]],
  ]),
);
walkSet("numbers", new Set(numbers));
walkSet("objects and numbers", new Set<unknown>([point, 1, list, 0.5]));
walkSet("strings and numbers", new Set<unknown>(["a", 1, "1", true, null, undefined]));
walkSet("lists", new Set<unknown>([[1, 2], [3]]));

const late = new Map<unknown, unknown>([[point, "object first"]]);
walk("narrow keys", late);
late.set(1.5, "then a number");
walk("wide keys", late);
late.delete(point);
walk("after a delete", late);

const changed = new Map<number, number>(numbers.slice(0, 4).map((x, j): [number, number] => [x, j]));
const order: string[] = [];
for (const [key, value] of changed) {
  order.push(key + "=" + value);
  if (order.length === 1) changed.delete(1);
  if (order.length === 2) for (let i = 100; i < 140; i++) changed.set(i, i);
  if (order.length === 10) changed.clear();
  if (order.length === 11) break;
}
console.log(order.join(" "), changed.size);

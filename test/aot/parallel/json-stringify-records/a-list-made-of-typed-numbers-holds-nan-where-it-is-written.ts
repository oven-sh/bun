type Holder = { id: number; list: number[]; tail: string };
const numbers: number[] = [1, 2.5, NaN, Infinity, -Infinity, -0, 0 / 0, 1e21, 2147483648];
const writeNumbers = (list: number[]): string => JSON.stringify(list);
const writeLists = (lists: number[][]): string => JSON.stringify(lists);
const writeHolder = (holder: Holder): string => JSON.stringify(holder);
const writeHolders = (holders: Holder[]): string => JSON.stringify(holders);
const writeUnknown = (value: unknown): string | undefined => JSON.stringify(value);
const forms: [string, (n: number) => string | undefined][] = [
  ["one", n => writeNumbers([n])],
  ["three", n => writeNumbers([0.5, n, 3])],
  ["lists", n => writeLists([[n]])],
  ["more lists", n => writeLists([[1.5], [n], [n, 2.5]])],
  ["holder", n => writeHolder({ id: 1, list: [n], tail: "t" })],
  ["holders", n => writeHolders([{ id: 1, list: [n], tail: "t" }, { id: 2, list: [n, n], tail: "u" }])],
  ["unknown", n => writeUnknown([n])],
  ["unknown holder", n => writeUnknown({ list: [n] })],
  ["in place", n => JSON.stringify([n]) + JSON.stringify([[n]]) + JSON.stringify({ list: [n] })],
];
for (const [name, form] of forms) console.log(name, numbers.map(n => String(form(n))).join(" "));
function largeDoubled(list: number[]): number[] { return list.filter(value => !(value <= 2)).map(value => value * 2); }
console.log(JSON.stringify(largeDoubled([1, NaN, 3, 0 / 0, 5, -0, Infinity, 8.25])), JSON.stringify(largeDoubled([NaN])), JSON.stringify(largeDoubled([1])));

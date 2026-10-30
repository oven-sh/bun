// `[3, 1, 4].map(x => x)`: all that is known of its elements is "a number, or what a hole reads as", and general code has made it with storage for any value.
// A reader of numbers gives it storage for numbers, once. A hole stays a hole. An array that really holds undefined keeps its storage; whoever reads either sees what plain Bun shows.
function sum(list: number[]): number {
  return list.reduce((total, x) => total + x, 0);
}
function sumOfPresent(list: (number | undefined)[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i] ?? 0.5;
  return total;
}
function withIndexes(list: number[]): number {
  let total = 0;
  for (const [i, x] of list.entries()) total += i * x;
  return total;
}
function describe(list: readonly unknown[]): string {
  const own: string[] = [];
  for (let i = 0; i < list.length; i++) own.push(i in list ? String(list[i]) : "hole");
  return `${list.length}: ${own.join(" ")} | ${Object.keys(list).join("")}`;
}
const opened = <T>(value: T): T => new Function("value", "return value")(value);

const mapped: number[] = [3, 1, 4, 1, 5, 9, 2, 6].map(x => x);
const filtered: number[] = [3, 1, 4, 1, 5, 9, 2, 6].filter(x => x > 2);
const made: number[] = Array.from({ length: 5 }, (_, i) => i * 1.5);
const sliced: number[] = opened([1, 2, 3, 4, 5]).slice(1, 4);
const joined: number[] = opened([1, 2]).concat([3.5], mapped);
for (let round = 0; round < 4; round++) {
  for (const list of [mapped, filtered, made, sliced, joined]) console.log(sum(list), sumOfPresent(list), withIndexes(list), describe(list));
  mapped.push(round + 0.25);
  filtered[filtered.length] = round;
}

const withHoles: (number | undefined)[] = opened([1, 2, 3, 4]).map((x: number) => x * 2);
delete withHoles[1];
withHoles[6] = 7;
const withUndefined: (number | undefined)[] = opened([1, 2, 3, 4]).map((x: number) => (x === 2 ? undefined : x));
const withBoth: (number | undefined)[] = opened([1, undefined, 3, 4]).map((x: number | undefined) => x);
delete withBoth[2];
const onlyUndefined: (number | undefined)[] = opened([undefined, undefined]).map((x: undefined) => x);
const onlyHoles: (number | undefined)[] = opened(new Array(3)).map((x: undefined) => x);
for (let round = 0; round < 4; round++) {
  for (const list of [withHoles, withUndefined, withBoth, onlyUndefined, onlyHoles]) console.log(sumOfPresent(list), describe(list), list.indexOf(undefined), list.includes(undefined), JSON.stringify(list));
  withHoles.push(undefined);
  withUndefined.push(round);
  onlyHoles[round] = round;
}
// What the type does not say comes in through a door that no type watches.
const lied = opened([1, "two", 3]).map((x: unknown) => x) as number[];
for (let round = 0; round < 3; round++) console.log(sum(lied), sumOfPresent(lied), describe(lied));

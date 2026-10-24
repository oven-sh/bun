// A reader of numbers gives an array that general code has made storage for numbers where that pays: an array that has lived through a collection, a long one, and the first few short young ones
// that a place in the code meets between two collections. Whichever of them an array is, converted or not, in whatever order they come, it reads as in plain Bun.
function sum(list: number[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}
function sumOfRest(...list: number[]): number {
  let total = 0;
  for (const x of list) total += x;
  return total;
}
function describe(list: number[]): string {
  return `${list.length} ${list[0]} ${list[list.length - 1]} ${0 in list} ${sum(list)}`;
}
const opened = <T>(value: T): T => new Function("value", "return value")(value);

const stays: number[][] = [];
for (let i = 0; i < 40; i++) stays.push(opened([i, i + 0.5, i * 2]).map((x: number) => x));
const long: number[] = opened(Array.from({ length: 100 }, (_, i) => i)).map((x: number) => x / 2);

let total = 0;
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 200; i++) {
    total += sum(new Array(8).fill(i & 3));
    total += sum(opened([i, 1, 2]).map((x: number) => x + 1));
    total += sum(Object.values({ a: i, b: 2, c: 3.5 }));
    total += sumOfRest(i, 2) + sumOfRest(...stays[i % 40]);
    total += sum(stays[i % 40]) + sum(long);
    if (i % 50 === 49) stays[i % 40].push(i + 0.25);
  }
  console.log(round, total, describe(stays[0]), describe(stays[9]), describe(stays[39]), describe(long));
  Bun.gc(true);
}
for (const list of stays) list[1] = -list[1];
stays[3][5] = 7;
delete stays[4][0];
(stays[5] as unknown[])[1] = "text";
console.log(stays.map(sum).join(" "));
console.log(describe(stays[3]), describe(stays[4]), describe(stays[5]), JSON.stringify(stays[3]), JSON.stringify(stays[4]), JSON.stringify(stays[5]));

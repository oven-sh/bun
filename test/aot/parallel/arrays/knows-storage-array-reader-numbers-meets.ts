// A reader of a `number[]` gives an array with storage for any value the storage of numbers where the array holds numbers and nothing else.
// Others know the storage of an array without asking: whoever made it in its frame, whoever reads an array of which all stores are known, a table of constants that is shared until the first store.
// Each of them meets such a reader here, with the array empty, full of holes, full of numbers for a while, and goes on as if nothing had happened.
function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i]! | 0;
  return total;
}
function first(numbers: number[]): number {
  return numbers[0]!;
}
function describe(values: unknown[]): string {
  let text = "";
  for (let i = 0; i < values.length; i++) text += (i in values ? (Object.is(values[i], -0) ? "-0" : typeof values[i] === "object" ? JSON.stringify(values[i]) : String(values[i])) : "hole") + ",";
  return text + values.length;
}

class Point {
  constructor(public x: number) {}
}
function xOf(points: Point[], index: number): number {
  return points[index]!.x;
}

// Arrays of objects, seen by the reader while no object lies in them.
const points: Point[] = [];
console.log("empty", sum(points as unknown as number[]), first(points as unknown as number[]));
points.push(new Point(1), new Point(2));
console.log(xOf(points, 0) + xOf(points, 1), points.length, describe(points));
const places: Point[] = new Array(4);
console.log("holes", sum(places as unknown as number[]), first(places as unknown as number[]));
places[2] = new Point(7);
console.log(xOf(places, 2), 0 in places, describe(places));
const emptied: Point[] = [new Point(3)];
emptied.pop();
console.log("emptied", sum(emptied as unknown as number[]));
emptied.push(new Point(4));
console.log(xOf(emptied, 0), describe(emptied));

// Texts and numbers: numbers alone for a while.
function join(parts: (string | number)[]): string {
  let text = "";
  for (const part of parts) text += typeof part === "string" ? part : part + 1;
  return text;
}
const parts: (string | number)[] = [1, 2];
console.log(join(parts), sum(parts as number[]), join(parts));
parts[0] = "one";
parts.push("three", 4);
console.log(join(parts), sum(parts as number[]), describe(parts));
const pair: [string | number, number] = [5, 6];
console.log(first(pair as number[]), pair[0], pair[1]);
pair[0] = "five";
console.log(first(pair as number[]), pair[0], pair[1], describe(pair));

// Arrays that may lie in the frame of whoever made them.
function ofLiteral(a: unknown, b: unknown): string {
  const list = [a, b];
  const total = sum(list as number[]);
  return total + ":" + String(list[0]) + ":" + String(list[1]) + ":" + list.length;
}
function ofRest(...rest: unknown[]): string {
  const total = sum(rest as number[]) + first(rest as number[]);
  return total + ":" + String(rest[0]) + ":" + String(rest[rest.length - 1]);
}
for (let i = 0; i < 3; i++) console.log(ofLiteral(i, i + 0.5), ofLiteral(i, "text"), ofLiteral({ i }, i), ofRest(i, 2, 3), ofRest(i, "two"), ofRest(1.5, i));

// An array that refuses is asked again and again; later it holds numbers alone.
const odd: unknown[] = [1, 2, "x", 4];
let asked = 0;
for (let i = 0; i < 20; i++) asked += sum(odd as number[]);
console.log(asked, describe(odd));
odd[2] = 3;
for (let i = 0; i < 20; i++) asked += sum(odd as number[]);
Bun.gc(true);
for (let i = 0; i < 20; i++) asked += sum(odd as number[]);
console.log(asked, describe(odd));
odd.push({ last: true });
console.log(sum(odd as number[]), describe(odd));
const many: unknown[][] = [];
for (let i = 0; i < 24; i++) many.push([i, i + 1, i % 3 ? i : NaN]);
let turns = 0;
for (let turn = 0; turn < 4; turn++) for (const each of many) turns += sum(each as number[]);
console.log(turns, describe(many[0]!), describe(many[1]!), describe(many[23]!));

// A table of constants is shared until somebody stores into it.
function table(): unknown[] {
  return [10, 20, 30];
}
const shared = table();
console.log(sum(shared as number[]), describe(shared), describe(table()));
shared[1] = "twenty";
console.log(sum(shared as number[]), describe(shared), describe(table()));

// An array that lies in the object that lists it.
class Holder {
  list: unknown[];
  name: string;
  constructor(seed: number) {
    this.list = [seed, seed + 1, seed + 2];
    this.name = "holder" + seed;
  }
}
const holders: Holder[] = [];
for (let i = 0; i < 50; i++) holders.push(new Holder(i));
let held = 0;
for (const holder of holders) held += sum(holder.list as number[]);
Bun.gc(true);
for (const holder of holders) holder.list.push(holder.name);
for (const holder of holders) held += sum(holder.list as number[]);
console.log(held, describe(holders[0]!.list), describe(holders[49]!.list), holders[49]!.name);

// Many arrays get new storage while the collector runs.
let kept: unknown[][] = [];
let checksum = 0;
for (let round = 0; round < 200; round++) {
  const numbers: unknown[] = [];
  for (let i = 0; i < 40; i++) numbers.push(round + i / 2);
  checksum += sum(numbers as number[]);
  kept.push(numbers);
  if (round % 50 === 49) {
    Bun.gc(true);
    for (const each of kept) checksum += first(each as number[]) + (each[39] as number);
    kept = kept.slice(-5);
  }
}
console.log(checksum, describe(kept[0]!.slice(0, 3)));

// A long one.
const long: unknown[] = [];
for (let i = 0; i < 100_000; i++) long.push(i & 255);
console.log(sum(long as number[]), first(long as number[]), long.length, long[99_999]);
long[50_000] = "middle";
console.log(sum(long as number[]), long[50_000], long[50_001]);

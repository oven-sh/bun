// `for (const key of Object.keys(record))` over records of one declared type: made in the order of the type, in another order, with a field left out, taken away or added,
// with a getter, frozen, and with the list of keys handed on, changed or read past its end.
type Point = { x: number; y: number; z: number };
function sum(point: Point): number {
  let total = 0;
  for (const key of Object.keys(point)) total += point[key as keyof Point];
  return total;
}
function names(point: Point): string {
  let text = "";
  for (const key of Object.keys(point)) text += key + "=" + point[key as keyof Point] + ";";
  return text;
}
const points: Point[] = [];
for (let k = 0; k < 8; k++) points.push({ x: k, y: k / 2, z: -k });
let total = 0;
for (let turn = 0; turn < 500; turn++) total += sum(points[turn & 7]!);
console.log("in order", total, names(points[3]!));

const reordered: Point = { z: 1, x: 2, y: 3 };
const built = {} as Point;
built.y = 5;
built.z = 6;
built.x = 7;
console.log("other orders", sum(reordered), names(reordered), sum(built), names(built));

const shorter = { x: 1, y: 2, z: 3 } as Point;
delete (shorter as Partial<Point>).y;
const longer = { x: 1, y: 2, z: 3 } as Point & Record<string, number>;
longer.w = 4;
longer[7] = 70;
console.log("taken away and added", names(shorter), names(longer), sum(longer));

const hidden = { x: 1, y: 2, z: 3 } as Point;
Object.defineProperty(hidden, "y", { enumerable: false });
const computed = { x: 1, y: 2, z: 3 } as Point;
let reads = 0;
Object.defineProperty(computed, "z", { get: () => ++reads, enumerable: true, configurable: true });
console.log("hidden and computed", names(hidden), names(computed), sum(computed), reads);
console.log("frozen", names(Object.freeze({ x: 4, y: 5, z: 6 })), sum(Object.create({ x: 1, y: 2, z: 3 })));

function changedInTheLoop(point: Point): string {
  let text = "";
  for (const key of Object.keys(point)) {
    text += key;
    if (key === "x") delete (point as Partial<Point>).y;
    text += String(point[key as keyof Point]);
  }
  return text;
}
for (let turn = 0; turn < 50; turn++) changedInTheLoop({ x: turn, y: 1, z: 2 });
console.log("changed in the loop", changedInTheLoop({ x: 1, y: 2, z: 3 }));

const lists: string[][] = [];
function keptNowAndThen(point: Point, keep: boolean): number {
  const keys = Object.keys(point);
  let count = 0;
  for (const key of keys) count += key.length;
  if (keep) lists.push(keys);
  return count;
}
let counted = 0;
for (let turn = 0; turn < 300; turn++) counted += keptNowAndThen(points[turn & 7]!, turn === 299);
lists[0]!.push("more");
console.log("kept", counted, lists[0]!.join(), Array.isArray(lists[0]), Object.keys(points[0]!).join());

function grownInTheLoop(point: Point): string {
  const keys = Object.keys(point);
  let text = "";
  for (const key of keys) {
    text += key;
    if (keys.length < 5) keys.push(key + key);
  }
  return text + keys.length + String(keys[9]);
}
for (let turn = 0; turn < 50; turn++) grownInTheLoop(points[turn & 7]!);
console.log("grown in the loop", grownInTheLoop(points[1]!));

// A copy and the names written behind it are made of a record of the program, and what comes out is read and stored into as an object of that record's type.
// Under: --aot-testing=CheckProofsAtRunTime: what Link says of the result of a CopyObject
type Point = { x: number; y: number };
function make(i: number): Point {
  return { x: i, y: i + 1 };
}
function deed(source: any, label: unknown) {
  return { ...source, label, size: 1 };
}
function sum(p: Point) {
  p.x += 10;
  return p.x + p.y;
}
const first = deed(make(1), "a");
console.log(sum(first), Object.keys(first).join(), JSON.stringify(first));
const kept = make(5);
const second = deed(kept, "b");
console.log(sum(second), sum(kept), JSON.stringify(second), JSON.stringify(kept), second === kept);
let total = 0;
for (let i = 0; i < 300; i++) total += sum(deed(make(i), i));
console.log(total);

// Object.create() twice below an instance that native code handed back: a method of the class runs on the lowest object.
// Flags: --aot-validate
class Point {
  constructor(x) { this.x = x; this.y = 2; }
  sum() { return this.x * 1000 + this.y; }
  set both(value) { this.x = value; this.y = value; }
}
function revived(value) { return JSON.parse("[0]", (key, each) => (key === "0" ? value : each))[0]; }
function run(round) {
  const low = Object.create(Object.create(revived(new Point(round))));
  low.x = 6;
  return low.sum();
}
let out = "";
for (let round = 0; round < 5; round++) out += run(round) + ",";
console.log(out);

// A store finds the setter of a class above an object that stands below an instance that native code handed back: the setter writes to that object.
// Flags: --aot-validate
class Point {
  constructor(x) { this.x = x; this.y = 2; }
  sum() { return this.x * 1000 + this.y; }
  set both(value) { this.x = value; this.y = value; }
}
function revived(value) { return JSON.parse("[0]", (key, each) => (key === "0" ? value : each))[0]; }
function run(round) {
  const below = Object.create(revived(new Point(round)));
  below.both = 5;
  return Object.keys(below).join("") + below.x;
}
let out = "";
for (let round = 0; round < 5; round++) out += run(round) + ",";
console.log(out);

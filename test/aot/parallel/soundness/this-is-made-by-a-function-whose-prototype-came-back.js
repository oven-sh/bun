// The prototype of a constructor function is an instance that native code handed back: a method of the class runs on what the function makes.
// Flags: --aot-validate
class Point {
  constructor(x) { this.x = x; this.y = 2; }
  sum() { return this.x * 1000 + this.y; }
}
function revived(value) { return JSON.parse("[0]", (key, each) => (key === "0" ? value : each))[0]; }
function Below() { this.x = 9; }
function run(round) {
  Below.prototype = revived(new Point(round));
  const below = new Below();
  return below.sum();
}
let out = "";
for (let round = 0; round < 5; round++) out += run(round) + ",";
console.log(out);

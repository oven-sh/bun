// A method and a getter of a class run on what Object.create() made below an instance that native code handed back: `this` is no instance of the class.
// Flags: --aot-validate
class Point {
  constructor(x) { this.x = x; this.y = 2; }
  sum() { return this.x * 1000 + this.y; }
  get twice() { return this.x * 2; }
}
function revived(value) { return JSON.parse("[0]", (key, each) => (key === "0" ? value : each))[0]; }
function run(round) {
  const below = Object.create(revived(new Point(round)));
  below.x = 7;
  return below.sum() + " " + below.twice;
}
let out = "";
for (let round = 0; round < 5; round++) out += run(round) + ",";
console.log(out);

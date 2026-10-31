// A literal that names an instance as its __proto__ goes through native code and comes back: a method of the class runs on the literal.
// Flags: --aot-validate
class Point {
  constructor(x) { this.x = x; this.y = 2; }
  sum() { return this.x * 1000 + this.y; }
}
function revived(value) { return JSON.parse("[0]", (key, each) => (key === "0" ? value : each))[0]; }
function run(round) {
  const below = revived({ __proto__: new Point(round), x: 3 });
  return below.sum();
}
let out = "";
for (let round = 0; round < 5; round++) out += run(round) + ",";
console.log(out);

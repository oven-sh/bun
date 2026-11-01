// The prototype object of a class is put below an instance that native code handed back: a method of the other class runs on its instances.
// Flags: --aot-validate
class Point {
  constructor(x) { this.x = x; this.y = 2; }
  sum() { return this.x * 1000 + this.y; }
  set both(value) { this.x = value; this.y = value; }
}
function revived(value) { return JSON.parse("[0]", (key, each) => (key === "0" ? value : each))[0]; }
function Base() {}
class Sub extends Base { constructor() { super(); this.x = 8; } }
function run(round) {
  Base.prototype = revived(new Point(round));
  Object.setPrototypeOf(Sub.prototype, Base.prototype);
  return new Sub().sum();
}
let out = "";
for (let round = 0; round < 5; round++) out += run(round) + ",";
console.log(out);

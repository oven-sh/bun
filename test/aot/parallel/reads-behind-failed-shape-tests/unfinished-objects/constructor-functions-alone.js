const seen = [];
function describe(x) {
  let s = "" + x.size;
  if (typeof x !== "number") s += "/" + x.size;
  return s;
}
function Box(v) { this.size = v; seen.push(describe(this)); this.lid = 1; }
function Bag(v) { this.weight = v; }
function Jar(v) { this.volume = v; }
console.log(describe(new Box(1)));
console.log(describe(new Bag(2)));
console.log(describe(new Jar(3)));
console.log(describe(4));
console.log(seen.join());

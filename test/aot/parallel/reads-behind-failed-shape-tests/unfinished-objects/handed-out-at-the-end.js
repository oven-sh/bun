const seen = [];
function describe(x) {
  let s = "" + x.size;
  if (typeof x !== "number") s += "/" + x.size;
  return s;
}
function Box(v) { this.size = v; this.lid = 1; seen.push(describe(this)); }
class Bag { constructor(v) { this.weight = v; } }
class Jar { constructor(v) { this.volume = v; } }
console.log(describe(new Box(1)));
console.log(describe(new Bag(2)));
console.log(describe(new Jar(3)));
console.log(describe(4));
console.log(seen.join());

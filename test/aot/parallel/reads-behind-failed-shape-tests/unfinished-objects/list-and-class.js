const seen = [];
function describe(x) {
  let s = "" + x.size;
  if (typeof x !== "number") s += "/" + x.size;
  return s;
}
class Box { constructor(v) { this.size = v; seen.push(describe(this)); this.lid = 1; } }
class Bag { constructor(v) { this.weight = v; } }
class Jar { constructor(v) { this.volume = v; } }
const all = [new Box(1), new Bag(2), new Jar(3), 4];
for (let i = 0; i < all.length; i++) console.log(describe(all[i]));
console.log(seen.join());

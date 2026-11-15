class Box { constructor(v) { this.size = v; this.lid = 1; } }
class Bag { constructor(v) { this.weight = v; } }
class Jar { constructor(v) { this.volume = v; } }
function describe(x) {
  let s = "";
  s += x.size;
  if (typeof x !== "number") s += "/" + x.size;
  return s;
}
const open = new Box(5);
const all = [new Box(1), new Bag(2), new Jar(3), open, 4];
for (let i = 0; i < all.length; i++) console.log(describe(all[i]));

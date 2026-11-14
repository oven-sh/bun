const seen = [];
function describe(x) { let s = "" + x.size; if (typeof x !== "number") s += "/" + x.size; return s; }
function Box(v) { this.size = v; seen.push(describe(this)); this.lid = 1;  }
class Other0 { constructor(v) { this.weight0 = v; } }
class Other1 { constructor(v) { this.weight1 = v; } }
console.log(describe(new Box(1)));
console.log(describe(new Other0(2)));
console.log(describe(new Other1(3)));
console.log(describe(4));
for (const v of [0, 1, 9]) console.log(describe(new Box(v)));
console.log(seen.join());

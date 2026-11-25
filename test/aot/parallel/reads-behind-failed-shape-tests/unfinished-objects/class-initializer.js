const seen = [];
function describe(x) { let s = "" + x.size; if (typeof x !== "number") s += "/" + x.size; return s; }
class Box { size = 1; shown = (() => { seen.push(describe(this)); return 0; })(); lid = 1; constructor(v) {  } }
class Other0 { constructor(v) { this.weight0 = v; } }
class Other1 { constructor(v) { this.weight1 = v; } }
console.log(describe(new Box(1)));
console.log(describe(new Other0(2)));
console.log(describe(new Other1(3)));
console.log(describe(4));
for (const v of [0, 1, 9]) console.log(describe(new Box(v)));
console.log(seen.join());

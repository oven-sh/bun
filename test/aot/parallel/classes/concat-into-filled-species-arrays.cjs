// concat() into arrays that the species constructor has filled: holes of the sources leave those elements alone.
function show(a) { let s = a.constructor.name + " " + a.length + ":"; for (let i = 0; i < a.length; i++) s += (i in a ? String(a[i]) : "hole") + ","; return s + Object.keys(a).join(); }
class Pushed extends Array { constructor(n) { super(n); this.push(n); this.push(n / 2); this.name = "n"; } }
class Filled extends Array { constructor() { super(); this.push(5); this.push(6); } }
class Halves extends Array { constructor(n) { super(n); this.push(0.5, 1.5, 2.5); } }
class Words extends Array { constructor() { super("a", "b", "c", "d"); } }
class Long extends Array { constructor(n) { super(n); this.length = 9; this[7] = "seven"; } }
const sources = [[], [1], [, 1], [1.5, , 2.5], ["x", , , "y"], [, , , ,], new Array(3)];
for (let round = 0; round < 80; round++) {
  for (const C of [Pushed, Filled, Halves, Words, Long]) {
    const c = new C(2);
    for (const source of sources) {
      const out = [show(c.concat(source)), show(c.concat(source, 7, source)), show(Array.prototype.concat.call(c, source))];
      if (round % 40 === 1) console.log(out.join(" ; "));
    }
    const holed = new C(0); holed.length = 0; holed[2] = round & 1 ? 1 : 1.5; holed[4] = "e";
    const text = show(holed.concat([, 1])) + show(holed.concat()) + show(holed.slice()) + show(holed.map((x) => x)) + show(holed.filter(() => false));
    if (round % 40 === 1) console.log(text);
  }
}

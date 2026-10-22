// A store under the name of a setter that has no getter runs the setter, also on an instance that a host function has seen.
let count = 0;
let last;

class InConstructor { constructor() { this.x = 1; } set x(v) { count++; last = v; } }
const a = new InConstructor();
console.log(a);
console.log(count, last, Object.keys(a).join(), "x" in a, a.x);

class Outside { set x(v) { count++; last = v; } }
const b = new Outside();
console.log(b);
console.log("x" in b, Object.hasOwn(b, "x"));
b.x = "stored";
console.log(count, last, Object.keys(b).join(), "x" in b, Object.hasOwn(b, "x"), b.x);

class Base { set x(v) { count++; last = v; } }
class Derived extends Base { constructor() { super(); this.x = 3; } }
const c = new Derived();
console.log(c);
console.log(count, last, Object.keys(c).join());

class Both { constructor() { this.x = 4; } get x() { return "from getter"; } set x(v) { count++; last = v; } }
const d = new Both();
console.log(d);
console.log(count, last, Object.keys(d).join(), d.x);

class NeverEscapes { constructor() { this.x = 5; } set x(v) { count++; last = v; } }
const e = new NeverEscapes();
console.log(count, last, Object.keys(e).join());

class Plain { constructor() { this.x = 6; } }
const f = new Plain();
console.log(f);
console.log(count, Object.keys(f).join(), f.x + 1);

setTimeout((o) => { o.x = "late"; console.log(count, last, Object.keys(o).join(), Object.keys(b).join()); }, 0, b);

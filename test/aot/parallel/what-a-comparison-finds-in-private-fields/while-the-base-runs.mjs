// Guards: while the base's constructor runs the object has none of the private fields of the class below.
const seen = [];
class Base { constructor(whole) { if (whole) seen.push(Bun.deepMatch(whole, this), Bun.deepMatch(this, whole)); } }
class Derived extends Base { #n = 0; #d = 0.5; #t = "x"; #o = null; }
const whole = new Derived(null);
for (let i = 0; i < 3; i++) new Derived(whole);
console.log(seen.join());

// a constructor that throws or leaks between the definitions and the stores
let leaked = null;
class A { constructor(seed) { this.n = seed; } }
class B extends A { x; t; constructor(seed) { super(seed); if (seed < 0) { leaked = this; throw new RangeError("no"); } this.x = seed + 0.5; this.t = "t" + seed; } }
let warm = 0; for (let i = 0; i < 300; i++) warm += new B(i).x; console.log(warm);
try { new B(-1); } catch (e) { console.log(e.name); }
console.log(Object.keys(leaked).join(), "x" in leaked, leaked.x, leaked.x + 1, String(leaked.t), leaked.t?.length, Object.hasOwn(leaked, "t"));

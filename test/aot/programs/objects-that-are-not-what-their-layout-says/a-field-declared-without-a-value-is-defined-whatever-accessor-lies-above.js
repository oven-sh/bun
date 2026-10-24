// `x;` defines an own property, whatever lies above; the store behind it finds that property.
const log = [];
class A { constructor(seed) { this.n = seed; } }
class B extends A { x; t; constructor(seed) { super(seed); this.x = seed + 0.5; this.t = "t" + seed; } }
function show(v) { return [v.n, v.x, v.t, Object.keys(v).join(), Object.getOwnPropertyDescriptor(v, "x")?.value].join(" "); }
let warm = 0; for (let i = 0; i < 300; i++) warm += new B(i).x; console.log(warm);
Object.defineProperty(A.prototype, "x", { configurable: true, get() { return "from above"; }, set(value) { log.push("set x " + value); } });
console.log(show(new B(3)), log.join());
Object.defineProperty(B.prototype, "t", { configurable: true, value: "fixed", writable: false });
try { console.log(show(new B(4)), log.join()); } catch (e) { console.log("threw", e.name); }

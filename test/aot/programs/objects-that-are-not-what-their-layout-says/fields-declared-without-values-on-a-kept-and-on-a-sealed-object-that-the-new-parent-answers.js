// the parent is replaced by one that answers an object that is there already, frozen or with the names taken
const log = [];
class A { constructor(seed) { this.n = seed; } }
class B extends A { x; t; constructor(seed) { super(seed); this.x = seed + 0.5; this.t = "t" + seed; } }
function show(v) { return [v.n, v.x, v.t, Object.keys(v).join()].join(" "); }
let warm = 0; for (let i = 0; i < 300; i++) warm += new B(i).x; console.log(warm);
const kept = { t: "kept", get x() { return "getter"; }, set x(value) { log.push("set x " + value); } };
Object.setPrototypeOf(B, function () { return kept; });
try { console.log(show(new B(3)), log.join(), Object.getOwnPropertyDescriptor(kept, "x").value); } catch (e) { console.log("threw", e.name); }
const sealed = Object.preventExtensions({ x: 0 });
Object.setPrototypeOf(B, function () { return sealed; });
try { console.log(show(new B(4)), log.join()); } catch (e) { console.log("threw", e.name, show(sealed)); }

// A get trap keeps the target, stores values of other types into its fields and gives it another prototype; other instances of the class keep theirs.
const log = [];
class Vec { constructor(x) { this.x = x; } twice() { return this.x * 2; } }
class Body { constructor() { this.pos = new Vec(1); this.hits = 0; } step() { this.hits += 1; return this.hits; } }
let kept;
const b = new Body();
const p = new Proxy(b, { get(target, key) { kept = target; target.hits = "text"; target.pos = { x: "o", twice() { return "replaced"; } }; Object.setPrototypeOf(target, { step() { return "other"; } }); return 1; } });
log.push(String(b.step()), String(b.pos.twice()));
p.anything;
log.push(String(b.step()), String(b.pos.twice()), typeof b.hits, String(kept === b), String(new Body().step()));
console.log(log.join("; "));

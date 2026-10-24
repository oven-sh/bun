// A spread and a rest pattern copy the fields of the target out of a proxy without traps: a store into the object that a copy holds is seen through the target.
const log = [];
class Vec { constructor(x) { this.x = x; } len() { return this.x * 2; } }
class Body { constructor() { this.pos = new Vec(2); this.n = 1; } }
const b = new Body(); const p = new Proxy(b, {});
const copy = { ...p }; copy.pos.x = "s";
log.push(typeof b.pos.x, String(b.pos.len()), String(copy.n));
const { pos, ...rest } = new Proxy(new Body(), {}); pos.x = null;
log.push(String(pos.len()), Object.keys(rest).join());
console.log(log.join("; "));

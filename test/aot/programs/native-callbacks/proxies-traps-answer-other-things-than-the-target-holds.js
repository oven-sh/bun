// Traps answer other things than the target holds: another object under a field, bound methods, keys and a prototype of their own. A method called through the proxy sees them, the same method called on the target does not.
const log = [];
class Vec { constructor(x) { this.x = x; } len() { return Math.abs(this.x); } }
class Body { constructor() { this.pos = new Vec(-2); } far() { return this.pos.len() > 1; } }
const b = new Body();
const p = new Proxy(b, {
  get(target, key, receiver) { if (key === "pos") return { x: "s", len() { return "fake"; } }; const found = Reflect.get(target, key, receiver); return typeof found === "function" ? found.bind(receiver) : found; },
  has() { return true; },
  ownKeys() { return ["pos", "made"]; },
  getOwnPropertyDescriptor(target, key) { return { value: key === "pos" ? target.pos : 1, enumerable: true, configurable: true, writable: true }; },
  getPrototypeOf() { return Vec.prototype; },
});
log.push(String(p.far()), String(b.far()), String("nothing" in p), Object.keys(p).join(), String(p instanceof Vec), String(p instanceof Body), JSON.stringify({ ...p }));
console.log(log.join("; "));

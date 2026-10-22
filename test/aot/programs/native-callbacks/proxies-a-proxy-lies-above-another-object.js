// A proxy without traps is the prototype of another object: reads through that object find what the target holds, and a getter of the target's class gets that object as this.
const log = [];
class Vec { constructor(x) { this.x = x; } }
class Body { constructor() { this.pos = new Vec(2); } get twice() { log.push(this === child ? "this is the child" : "this is another"); return 2; } }
const b = new Body(); const p = new Proxy(b, {});
const child = { __proto__: p };
child.pos.x = "s"; log.push(typeof b.pos.x, String(child.twice));
const made = Object.create(new Proxy(new Body(), {})); made.pos.x = true; log.push(typeof made.pos.x);
console.log(log.join("; "));

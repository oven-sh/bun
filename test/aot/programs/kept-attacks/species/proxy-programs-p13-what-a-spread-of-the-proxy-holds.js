// Species: proxy programs  what a spread of the proxy holds. It prints what plain Bun prints.
const log = [];
class Vec { constructor(x) { this.x = x; } len() { return this.x * 2; } }
class Body { constructor() { this.pos = new Vec(2); this.n = 1; } }
const b = new Body(); const p = new Proxy(b, {});
const copy = { ...p }; copy.pos.x = "s";
log.push(typeof b.pos.x, String(b.pos.len()), String(copy.n));
const { pos, ...rest } = new Proxy(new Body(), {}); pos.x = null;
log.push(String(pos.len()), Object.keys(rest).join());
console.log(log.join("; "));

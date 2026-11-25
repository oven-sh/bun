function later() { function P(n) { this.id = 1; this.n = n; } return P; }
const log = [], list = [later(), later(), later()]; let t = 0, s = "";
Object.defineProperty(list[1].prototype, "n", { set(v) { log.push(v); }, configurable: true });
function read(o) { return o.n; }
for (const C of list) { const o = new C("x"); s += String(read(o)) + ("n" in o) + Object.hasOwn(o, "n") + ";"; }
console.log(s, log.join());

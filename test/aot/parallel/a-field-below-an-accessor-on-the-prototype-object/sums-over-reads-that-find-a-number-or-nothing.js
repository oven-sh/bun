function later() { function P(n) { this.id = 1; this.n = n; } return P; }
const log = [], list = [later(), later(), later()]; let t = 0, s = "";
for (const C of list) t += new C(5).n;
Object.defineProperty(list[1].prototype, "n", { set(v) { log.push(v); }, configurable: true });
for (const C of list) { const o = new C(5); t += o.n; s += typeof o.n + ";"; }
console.log(t, s, log.join());

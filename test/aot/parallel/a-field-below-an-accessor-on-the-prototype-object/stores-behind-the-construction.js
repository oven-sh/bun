function later() { function P(n) { this.id = 1; this.n = n; } return P; }
const log = [], list = [later(), later(), later()]; let t = 0, s = "";
Object.defineProperty(list[1].prototype, "n", { set(v) { log.push(v); }, configurable: true });
const keep = list.map(C => new C(7)); for (const o of keep) { o.n = 8; t += o.n ?? 100; }
console.log(t, log.join(), JSON.stringify(keep));

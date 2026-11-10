function later() { function P(n) { this.id = 1; this.n = n; } return P; }
const log = [], list = [later(), later(), later()]; let t = 0, s = "";
Object.defineProperty(list[1].prototype, "n", { set(v) { log.push(v); }, configurable: true });
for (let i = 0; i < 300; i++) { const o = new list[i % 3](i); t = (t + (o.n === undefined ? 1 : o.n)) | 0; }
console.log(t, log.length);

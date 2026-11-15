let saved;
function P(a, b) { this.a = a; this.b = b; }
Object.defineProperty(P.prototype, "a", { set(v) { saved = this; if (v > 2) throw new Error("no"); }, configurable: true });
function read(p) { return p.b; }
let s = "";
for (let i = 0; i < 5; i++) {
    try { new P(i, i); } catch { }
    s += String(read(saved)) + ";";
}
console.log(s);

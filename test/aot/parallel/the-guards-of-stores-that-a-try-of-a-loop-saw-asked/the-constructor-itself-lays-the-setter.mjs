const log = [];
class P { constructor(x) { if (x === 2) Object.defineProperty(P.prototype, "y", { set(v) { log.push("y" + v); }, configurable: true }); this.x = x; this.y = x + 1; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = make(P, i); out.push(o.x + ":" + o.y + ":" + Object.keys(o).join("")); } return out.join(" "); }
console.log(run(Number("5")), log.join());

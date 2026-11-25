class Mark { constructor(n) { this.n = n; } m(z) { return z; } }
class Dot extends Mark { }
function extend(target, names) { for (const k in names) target[k] = names[k]; return target; }
extend(Dot.prototype, { m() { return 9; } });
function told(o) { const out = []; for (const q in o) out.push(q, typeof o[q]); return out.join(); }
console.log("extended", told(new Dot(1)), told(new Mark(2)));

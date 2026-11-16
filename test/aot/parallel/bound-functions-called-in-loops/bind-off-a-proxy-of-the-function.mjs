function f(a, b, c, d, e) { return "" + this + "|" + a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + arguments.length; }
const p = new Proxy(f, { get(t, k, r) { return k === "bind" ? function (a, b, c) { return t.bind(null, 5); } : Reflect.get(t, k, r); } });
function inTurns(turns) { let out = ""; for (let i = 0; i < turns; i++) { const g = p.bind(1, 2, 3); out = g(7, 8) + ";" + (i & 1); } return out; }
function madeInFront(turns) { const g = p.bind(1, 2, 3); let out = ""; for (let i = 0; i < turns; i++) { if (i & 1) out = g(7, i & 3); } return out; }
function noTurn(turns) { const g = p.bind(1, 2, 3); let out = "none"; for (let i = 0; i < turns; i++) out = g(7, 8); return out; }
console.log(inTurns(5)); console.log(madeInFront(6)); console.log(noTurn(0)); console.log(noTurn(3));

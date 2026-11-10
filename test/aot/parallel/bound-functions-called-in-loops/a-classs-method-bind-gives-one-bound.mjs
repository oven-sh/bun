function f(a, b, c, d, e) { return "" + this + "|" + a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + arguments.length; }
class Binder { bind(a, b, c, d) { return f.bind(null, 5); } }
const binder = new Binder();
function inTurns(turns) { let out = ""; for (let i = 0; i < turns; i++) { const g = binder.bind(1, 2, 3, 4); out = g(7, 8) + ";" + (i & 1); } return out; }
function madeInFront(turns) { const g = binder.bind(1, 2, 3, 4); let out = ""; for (let i = 0; i < turns; i++) { if (i & 1) out = g(7, i & 3); } return out; }
function noTurn(turns) { const g = binder.bind(1, 2, 3, 4); let out = "none"; for (let i = 0; i < turns; i++) out = g(7, 8); return out; }
console.log(inTurns(5)); console.log(madeInFront(6)); console.log(noTurn(0)); console.log(noTurn(3));

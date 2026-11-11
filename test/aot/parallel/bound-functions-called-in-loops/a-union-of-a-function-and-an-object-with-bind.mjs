function f(a, b, c, d, e) { return "" + this + "|" + a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + arguments.length; }
const o = { bind(x, y, z) { return f.bind(null, 5); } };
const either = JSON.parse("[0,1,0,1,1,0]").map(n => n ? f : o);
let at = 0;
function inTurns(turns) { let out = ""; for (let i = 0; i < turns; i++) { const g = either[at++ % 6].bind(null, 2, 3); out = g(7, 8) + ";" + (i & 1); } return out; }
function madeInFront(turns) { const g = either[at++ % 6].bind(null, 2, 3); let out = ""; for (let i = 0; i < turns; i++) { if (i & 1) out = g(7, i & 3); } return out; }
function noTurn(turns) { const g = either[at++ % 6].bind(null, 2, 3); let out = "none"; for (let i = 0; i < turns; i++) out = g(7, 8); return out; }
console.log(inTurns(5)); console.log(madeInFront(6)); console.log(noTurn(0)); console.log(noTurn(3));

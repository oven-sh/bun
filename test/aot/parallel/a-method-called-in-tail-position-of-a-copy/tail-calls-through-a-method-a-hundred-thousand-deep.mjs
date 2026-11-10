class Ping { constructor() { this.other = null; } hit(n, acc) { return n === 0 ? acc : this.other.hit(n - 1, acc + 1); } }
class Pong { constructor() { this.other = null; } hit(n, acc) { return !(n > 0) ? acc : this.other.hit(n - 1, acc + 1); } }
const [a, b] = JSON.parse("[0, 1]").map((which) => (which ? new Pong() : new Ping()));
a.other = b; b.other = a;
function viaCopy(o, n) { return o.hit(n, 0); }
function viaTwoCopies(o, n) { return viaCopy(o, n); }
function tail(o, n) { return viaTwoCopies(o, n); }
function goesOn(o, n) { const r = viaTwoCopies(o, n); return r + 1; }
function guarded(o, n) { try { return viaCopy(o, n) + 2; } finally { a.other = b; } }
const deep = JSON.parse("100001");
console.log(tail(a, deep), goesOn(a, deep), guarded(a, deep), goesOn(b, deep), guarded(b, deep));

// STATISTIC: UnrolledLoopStoresSunk >= 10
// The number that comes round is stored behind the turns that are laid out, and a turn has another arm: for an object whose shape code that nobody sees may have changed.
class Point { constructor() { this.m = 0.25; this.k = 1; } }
class Named { constructor() { this.m = "a"; } }
function down(p, m) { for (let i = m; i-- > 0;) p.m = i; }
function downNine(p, m) { for (let i = m; i-- > 0;) p.m = i; }
function downOnce(p, m) { for (let i = m; i-- > 0;) p.m = i; }
function downNever(p, m) { for (let i = m; i-- > 0;) p.m = i; }
function downNamed(p, m) { for (let i = m; i-- > 0;) p.m = i; return p.m; }
function downToOne(p, m) { for (let i = m; i-- > 1;) p.m = i; return p.m; }
function downAndReads(p, m) { let s = 0; for (let i = m; i-- > 0;) { p.m = i; s += i; } return s; }
function lessAndLess(p, m) { let s = 0; for (let i = 0; i < m; i++) { s -= i; p.m = s; } }
function sumsOfHalves(p, m) { let t = 0.25; for (let i = 0; i < m; i++) { t += 0.5; p.m = t; } return t; }
function negative(p, m) { let t = -0; for (let i = 0; i < m; i++) { t += -0; p.m = t; } return t; }
function twoFields(p, m) { let t = 0.5; for (let i = m; i-- > 0;) { t -= 1.25; p.m = t; p.k = i; } return t; }
function oneObjectByTwoNames(p, q, m) { for (let i = m; i-- > 0;) { p.m = i; q.k = i; } }
function breaks(p, m) { for (let i = m; i-- > 0;) { p.m = i; if (i === 7) break; } }
function inTry(p, m) { try { for (let i = m; i-- > 0;) p.m = i; } catch (e) { return e.constructor.name; } return p.m; }
function nested(p, m) { let t = 0.5; for (let o = 0; o < 3; o++) for (let i = m; i-- > 0;) { t += i; p.m = t; } return t; }
function farDown(p, m) { for (let i = 4294967290 + m; i-- > 4294967290;) p.m = i; return p.m; }
const text = v => Object.is(v, -0) ? "-0" : v !== null && typeof v === "object" ? Object.keys(v).map(key => `${key}:${text(v[key])}`).join() : String(v);
const show = (p, ...said) => console.log(text(p), Array.from(p).length, said.map(text).join(" "));
{ const p = new Point(); down(p, 40); show(p); }
{ const p = new Point(); downNine(p, 9); show(p); }
{ const p = new Point(); downOnce(p, 1); show(p); }
{ const p = new Point(); downNever(p, 0); show(p); }
{ const p = new Named(); const r = downNamed(p, 17); show(p, r); }
{ const p = new Point(); const r = downToOne(p, 40); show(p, r); }
{ const p = new Point(); const r = downAndReads(p, 41); show(p, r); }
{ const p = new Point(); lessAndLess(p, 40); show(p); }
{ const p = new Point(); const r = sumsOfHalves(p, 42); show(p, r); }
{ const p = new Point(); const r = negative(p, 40); show(p, r); }
{ const p = new Point(); const r = twoFields(p, 43); show(p, r); }
{ const p = new Point(); oneObjectByTwoNames(p, p, 40); show(p); }
{ const p = new Point(); breaks(p, 40); show(p); }
{ const p = new Point(); const r = inTry(p, 40); show(p, r); }
{ const p = new Point(); const r = nested(p, 40); show(p, r); }
{ const p = new Point(); const r = farDown(p, 40); show(p, r); }

// Stores under names of methods of Object.prototype in one function, in front of the freeze and behind it: what was asked in front says nothing of what comes behind.
const show = o => Object.keys(o).map(k => k + ":" + (typeof o[k] === "function" ? "f" : String(o[k]))).join() + "|" + Object.getOwnPropertyNames(o).length + (typeof o.toString === "function" ? "F" : String(o.toString));
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
class Point { constructor(y) { this.y = y; } }
let turns = 0, at = 5;
const freeze = () => { if (++turns === at) Object.freeze(Object.prototype); };
function one(i) { const a = {}; a.toString = i; let r = show(a); if (i === 4 && at === 0) Object.freeze(Object.prototype); const b = {}; r += attempt(() => { b.toString = i; return "-"; }); return r + show(b); }
function both(i, now) { const a = {}; a.toString = i; let r = show(a); if (now) Object.freeze(Object.prototype); const b = {}; try { b.toString = i; } catch (e) { r += e.name; } const c = { x: 1 }; try { c.valueOf = i; c.y = 1; } catch (e) { r += e.name; } return r + show(b) + show(c); }
function loop(n, when) { let r = ""; for (let j = 0; j < n; j++) { const a = {}; try { a.toString = j; a.k = 1; } catch (e) { r += e.name[0]; } r += show(a); if (j === when) Object.freeze(Object.prototype); const b = new Point(j); try { b.hasOwnProperty = j; } catch (e) { r += e.name[0]; } r += Object.keys(b); } return r; }
function inner(n, when) { let r = 0; for (let j = 0; j < n; j++) { for (let k = 0; k < 4; k++) { const a = { k }; try { a.toString = k; } catch { r += 1000; } r += Object.keys(a).length; } if (j === when) Object.freeze(Object.prototype); } return r; }
function sum(n, when) { let r = 0; for (let j = 0; j < n; j++) { if (j === when) Object.freeze(Object.prototype); const p = {}; try { p.toString = j; p.valueOf = 2; } catch { r += 10000; continue; } r += Object.keys(p).length * 10 + (typeof p.toString === "number" ? p.toString : 0); } return r; }
function args(i, now) { const o = {}; try { o.toString = (now && Object.freeze(Object.prototype), i); } catch (e) { return e.name + show(o); } return show(o); }
function callee(n) { let r = ""; for (let j = 0; j < n; j++) { const a = {}; try { a.toLocaleString = j; freeze(); a.toString = j; a.isPrototypeOf = j; } catch (e) { r += e.name[0]; } r += show(a); } return r; }
const kept = {}; function keep(i) { kept.toString = i; return show(kept); }
const kept2 = { valueOf: 0 }; function keep2(i) { kept2.valueOf = i; kept2.q = i; return show(kept2); }
for (let i = 0; i < 3; i++) console.log(callee(4)); console.log(attempt(() => keep(1)));
console.log(Object.isFrozen(Object.prototype));

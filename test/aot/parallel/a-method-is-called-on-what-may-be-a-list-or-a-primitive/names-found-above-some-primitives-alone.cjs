// Names found above some primitives alone, called on what a Map gives: a text, a number, a boolean, a list in sight.
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
const call = (x, y) => tell(() => x.slice(y)) + tell(() => x.padStart(y, "-"));
function f(r) { let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
const call = (x, y) => tell(() => x.toFixed(y)) + tell(() => x.toPrecision(y + 2));
function f(r) { let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
const call = (x, y) => tell(() => x.push(y)) + tell(() => x.sort().length);
function f(r) { let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
const call = (x, y) => tell(() => x.toString()) + tell(() => x.valueOf() === x) + tell(() => x.hasOwnProperty("x"));
function f(r) { let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
const call = (x, y) => tell(() => x.nowhere(y));
function f(r) { let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
const call = (x, y) => tell(() => x.replace("1", m => m + y)) + tell(() => x.map(v => v + y).length);
function f(r) { let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
let first = true; const call = (x, y) => { if (first) { first = false; return tell(() => J("{\"slice\":1}").slice(0)); } return tell(() => x.slice(y)) + tell(() => x.length); };
function f(r) { let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();
(() => {
const J = JSON.parse, T = v => typeof v + ":" + String(v);
const tell = f => { try { return T(f()); } catch (e) { return e.name; } };
const call = (x, y) => tell(() => x.late(y)); const lay = r => { if (r === 10) for (const p of [Number.prototype, Boolean.prototype]) try { p.late = function (y) { return "late" + y + typeof this; }; } catch {} };
function f(r) { lay(r); let s = ""; const m = new Map(J('["text",5,true,1.5,[1,2,3],{"x":1},null,"1,2"]').map((v, i) => [i, v])), own = [3, 1, r & 3]; m.set(8, own); for (let i = 0; i < 9; i++) { const x = m.get(i); s += x == null ? "-" : call(x, r & 1); } own.push(r & 1); return s + own.length + own.join(); }
let last = ""; for (let r = 0; r < 30; r++) { const v = f(r); if (r > 26) last += v + "\n"; }
console.log(last);
})();

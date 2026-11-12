const veil = v => JSON.parse("0", () => v);
const said = [];
function a(w, n) { const o = [w * 1]; const x = veil(o); let s = 0; for (let i = 1; i < n; i++) { o[i] = w * 0.5; s += x.length; } return s; }
function b(w, n) { const o = [w * 1]; const x = veil(o); let s = 0; for (let i = 1; i < n; i++) { o[i] = x[i - 1] * 0.5 + w; s += x.length; } return s; }
function c(w, n) { const o = [w * 1]; const x = veil(o); let s = 0; for (let i = 1; i < n; i++) { o[i] = x[i - 1] * 0.5 + w; if (x.length > 3) s += x[2]; } return s; }
function d(w, n) { const o = []; const x = veil(o); let s = 0; for (let i = 0; i < n; i++) { o[i] = i * w; s += x.length * x[i]; } return s; }
function e(w, n) { const o = []; const x = veil(o); let s = 0; for (let i = 0; i < n; i++) { o.push(i * w); s += x.length * x[i]; } return s; }
function f(w, n) { const o = [w * 1]; const x = veil({ list: o }).list; let s = 0; for (let i = 1; i < n; i++) { s += x[i - 1] * x.length; o[i] = s % 7; } return s; }
function g(w, n, x) { const o = [w * 1]; let s = 0; for (let i = 1; i < n; i++) { s += x[i - 1] * x.length; o[i] = s % 7; } return s + o.length; }
function h(w, n) { const o = [w * 1]; let s = 0; for (let i = 1; i < n; i++) { o[i] = o[i - 1] * 0.5 + w; s += o.length * o[i >> 1]; } return s; }
function k(w, n) { const o = [w * 1]; const x = veil(o); let s = 0; for (let i = 1; i < n; i++) { for (let j = 0; j < x.length; j++) s += x[j]; o[i] = s % 11; } return s; }
for (const w of JSON.parse("[1,0.5,3]")) for (const n of JSON.parse("[0,1,2,5,20,70]")) said.push(a(w, n), b(w, n), c(w, n), d(w, n), e(w, n), f(w, n), g(w, n, JSON.parse("[1,2.5,3]")), h(w, n), k(w, n));
console.log(said.length); for (let i = 0; i < said.length; i += 9) console.log(said.slice(i, i + 9).join());

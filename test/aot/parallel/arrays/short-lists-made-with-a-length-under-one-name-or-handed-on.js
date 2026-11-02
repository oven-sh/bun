// Short lists made with a length where one name may stand for either of two lists, where a list is put into itself or handed on, and where its length moves.
function either(c, x) { let r = new Array(3); if (c) r = new Array(1); r[0] = "a" + x; return r.length + ":" + r[2] + ":" + r[0]; }
function eitherRead(c, x) { let r = new Array(3); r[2] = "z" + x; if (c) r = new Array(1); return String(r[2]) + r.length; }
function eitherStore(c, x) { const a = new Array(3), b = new Array(1); const r = c ? a : b; r[2] = "s" + x; return a.length + ":" + b.length + ":" + a[2] + ":" + b[2]; }
function inLoop(n, x) { let r = new Array(2); for (let i = 0; i < n; i++) { if (i === 2) r = new Array(4); r[i & 1] = "v" + (x + i); } return r.length + ":" + r[0] + ":" + r[1]; }
function boundByOther(c, x) { const a = new Array(2), b = new Array(6); const r = c ? a : b; for (let k = 0; k < r.length; k++) a[k] = "k" + (x + k); return a.length + ":" + a[a.length - 1]; }
function itself(x) { const r = new Array(2); r[0] = r; r[1] = "e" + x; r[0].length = 1; return r.length + ":" + r[1]; }
function throughElement(x) { const r = new Array(2), holder = new Array(1); holder[0] = r; r[1] = "h" + x; holder[0].push("more"); return r.length + ":" + r[2]; }
function captured(x) { const r = new Array(2); const grow = () => { r.push("c" + x); }; r[0] = "f"; grow(); return r.length + ":" + r[2]; }
function shrunk(x) { const r = new Array(3); r[2] = "t" + x; r.length = 1; r[0] = "u"; return r.length + ":" + r[2]; }
function popped(x) { const r = new Array(2); r[1] = "p" + x; const got = r.pop(); r[0] = got; return r.length + ":" + r[0] + ":" + r[1]; }
function frozen(x) { const r = new Array(2); r[0] = "q" + x; Object.freeze(r); try { "use strict"; r[1] = "w"; } catch (e) { return "threw"; } return r.length + ":" + r[1]; }
function spread(x) { const r = new Array(2); r[1] = "y" + x; return [...r].length + ":" + JSON.stringify(r); }
function destructured(x) { const r = new Array(2); r[0] = "d" + x; const [first, second] = r; return first + ":" + second; }
function named(x) { const r = new Array(2); r[0] = "n" + x; r.extra = 5; return r.length + ":" + r.extra + ":" + Object.keys(r).join(); }
function text(x) { const r = new Array(2); r["1"] = "i" + x; r["2"] = "j"; return r.length + ":" + r[1] + r[2]; }
function fraction(x) { const r = new Array(2); r[0.5] = "g" + x; r[1] = "l"; return r.length + ":" + r[0.5] + r[1]; }
const out = [];
let all = "";
for (let i = 0; i < 3000; i++) { const t = either(i & 1, i & 3) + eitherRead(i & 1, 1) + eitherStore(i & 1, 1) + inLoop(i & 3, 1) + boundByOther(i & 1, 1) + itself(1) + shrunk(1) + popped(1); if ((i & 1023) === 0) all += t + ";"; }
out.push(all, either(true, 1), either(false, 1), eitherRead(true, 1), eitherRead(false, 1), eitherStore(true, 1), eitherStore(false, 1), inLoop(0, 1), inLoop(2, 1), inLoop(5, 1), boundByOther(true, 1), boundByOther(false, 1));
out.push(itself(1), throughElement(1), captured(1), shrunk(1), popped(1), frozen(1), spread(1), destructured(1), named(1), text(1), fraction(1));
console.log(out.join("\n"));

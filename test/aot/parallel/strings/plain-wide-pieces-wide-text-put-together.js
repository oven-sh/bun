// One wide character makes a whole text wide. Its plain pieces are put together into plain texts, its wide pieces stay what they are.
const t = "π" + "abc,def,".repeat(1000);
function pieces(text) {
  let r = "";
  for (let i = 1; i + 4 <= text.length; i += 4) { r += text.substring(i, i + 3); r += "|"; }
  return r;
}
let n = 0; const seen = new Map();
for (let k = 0; k < 200; k++) { const r = pieces(t); n += r.length; seen.set(r, k); }
console.log(n, seen.size, pieces(t).slice(0, 24));
const wide = "aπb" + "x→y,".repeat(10);
let w = ""; for (let i = 0; i + 2 <= wide.length; i += 2) { w += wide.substring(i, i + 2); w += "."; }
console.log(w, w.length);
let whole = ""; for (const part of ["π".slice(1), ("π" + "plain").slice(1), "π", ("π" + "tail").substring(1, 3)]) { whole += part; whole += "/"; }
console.log(whole, whole.length);

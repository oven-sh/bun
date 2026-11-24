function whole(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push(i & 7); return a; }
function halves(n) { const m = n | 0, a = []; for (let i = 0; i <= m; i++) a.push(i * 0.5); return a; }
function behindTwo(n) { const m = n | 0, a = [9, 8]; for (let i = 2; i < m; i++) a.push(i ^ 5); return a; }
function sumOf(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return "a hole at " + i; s += a[i] * (i + 1); } return a[a.length] === undefined && !(a.length in a) ? s : "something behind the end"; }
const said = [];
for (let n = -2; n <= 70; n++) said.push(whole(n).length + ":" + sumOf(whole(n)), halves(n).length + ":" + sumOf(halves(n)), behindTwo(n).length + ":" + sumOf(behindTwo(n)));
console.log(said.join(" "));

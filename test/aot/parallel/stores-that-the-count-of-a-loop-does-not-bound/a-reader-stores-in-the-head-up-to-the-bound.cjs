function below(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a[i] = i & 7; return a; }
function upTo(n) { const m = n | 0, a = []; for (let i = 0; (a[i] = i * 0.5, i <= m); i++); return a; }
function behindTwo(n) { const m = n | 0, a = [9, 8]; for (let i = 2; i < m; i++) a[i] = i ^ 5; return a; }
function sumOf(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return "a hole at " + i; s += a[i] * (i + 1); } return a[a.length] === undefined && !(a.length in a) ? s : "something behind the end"; }
const said = [];
for (let n = -2; n <= 70; n++) said.push(below(n).length + ":" + sumOf(below(n)), upTo(n).length + ":" + sumOf(upTo(n)), behindTwo(n).length + ":" + sumOf(behindTwo(n)));
console.log("SAID", said.join(" "));
const other = new Function("function below(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a[i] = i & 7; return a; }\nfunction upTo(n) { const m = n | 0, a = []; for (let i = 0; (a[i] = i * 0.5, i <= m); i++); return a; }\nfunction behindTwo(n) { const m = n | 0, a = [9, 8]; for (let i = 2; i < m; i++) a[i] = i ^ 5; return a; }\nfunction sumOf(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return \"a hole at \" + i; s += a[i] * (i + 1); } return a[a.length] === undefined && !(a.length in a) ? s : \"something behind the end\"; }\nconst said = [];\nfor (let n = -2; n <= 70; n++) said.push(below(n).length + \":\" + sumOf(below(n)), upTo(n).length + \":\" + sumOf(upTo(n)), behindTwo(n).length + \":\" + sumOf(behindTwo(n)));\nreturn said;\n")();
let wrong = 0;
for (let at = 0; at < said.length; at++) if (String(said[at]) !== String(other[at])) { if (wrong++ < 6) console.log("SAID apart at", at, said[at], "|", other[at]); }
console.log("SAID wrong", wrong, "of", said.length);

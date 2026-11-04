// the variable does not only grow: some turns give it another text, a written one, a parameter, a piece of itself, itself with something in front
const told: string[] = [];
function written(n: number) { let s = ""; for (let i = 0; i < n; i++) s = i % 3 === 2 ? "reset" : s + "k" + i; return s; }
function handed(n: number, other: string) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 4 === 3) s = other; } return s; }
function cut(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (s.length > 8) s = s.slice(4); } return s; }
function emptied(n: number) { let s = ""; let out = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 3 === 2) { out = out + s + "|"; s = ""; } } return out + s; }
function prefixed(n: number) { let s = ""; for (let i = 0; i < n; i++) { const t = s + "a" + i; told[told.length] = t; s = "<" + t; } return s; }
console.log(JSON.stringify(written(0)), written(1), written(2), written(3), written(5), written(9));
console.log(JSON.stringify(handed(0, "o")), handed(3, "o"), handed(4, "o"), handed(6, "o"), JSON.stringify(handed(8, "")));
console.log(JSON.stringify(cut(0)), cut(3), cut(5), cut(12));
console.log(JSON.stringify(emptied(0)), emptied(2), emptied(3), emptied(7));
console.log(JSON.stringify(prefixed(0)), prefixed(1), prefixed(3), told.join("|"));

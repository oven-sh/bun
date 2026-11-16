// Patterns are compiled anew, and the last match is read, by names that only run time knows.
const pick = (x) => [x][JSON.parse("0")];
const subjects = ["alpha-12", "abc", "2026-11-10", "cde", "", "b"];
const A = /(?<w>a)(b)?/, B = /(?<w>a)(b)?/g, C = /(\w)(\d)?/y, D = /(b)|(c)/;
function walk(re, list) { const o = []; for (let i = 0; i < list.length; i++) { re.lastIndex = 0; const m = re.exec(list[i]); if (m) { for (let j = 0; j < m.length; j++) o.push(m[j]); o.push(m.length, m.index); } if (re.test(list[i])) o.push("t"); } return o.join(); }
function constants(list) { const o = []; for (let i = 0; i < list.length; i++) { const s = list[i]; const m = A.exec(s); if (m) o.push(m[0], m.length, m.groups ? m.groups.w : "-"); B.lastIndex = 0; const n = B.exec(s); if (n) o.push(n[0], n.length, B.lastIndex); C.lastIndex = 0; const c = C.exec(s); if (c) o.push(c[1], c[2], C.lastIndex); if (D.test(s)) o.push("D"); } return o.join(); }
console.log(constants(subjects)); console.log([A, B, C, D].map(re => walk(re, subjects)).join("|"));
const names = Object.getOwnPropertyNames(RegExp.prototype).filter(name => name.length === 7 && name.startsWith("com"));
for (const name of names) { pick(A)[name]("(?<w>c)(d)?(e)?"); pick(B)[name]("(x)"); pick(C)[name](".(c)?", "g"); pick(D)[name]("a"); }
console.log(constants(subjects)); console.log([A, B, C, D].map(re => walk(re, subjects)).join("|"), names.length);
const statics = Object.getOwnPropertyNames(pick(A).constructor).filter(name => name === "$1" || name === "lastMatch" || name === "input");
D.test("cab"); console.log(statics.map(name => pick(A).constructor[name]).join("/"));

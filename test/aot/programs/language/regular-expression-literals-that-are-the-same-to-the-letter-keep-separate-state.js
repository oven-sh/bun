// literals that are the same to the letter are separate objects with separate state
const r1 = /a/g, r2 = /a/g; r1.test("aa"); console.log(r1.lastIndex, r2.lastIndex, r1 === r2);
r1.extra = 1; console.log(r2.extra);
function make() { return /x/g; } const m1 = make(), m2 = make(); m1.lastIndex = 3; console.log(m1 === m2, m2.lastIndex);
function count(s) { const r = /b/g; let n = 0; while (r.exec(s)) n++; return n + ":" + r.lastIndex; } console.log(count("bbb"), count("b"), count(""));
function once(s) { const r = /c/y; r.test(s); return r.lastIndex; } console.log(once("cc"), once("cc"), once("x"));
const list = []; for (let i = 0; i < 3; i++) list.push(/d/g); list[0].test("d"); console.log(list.map(r => r.lastIndex).join(), new Set(list).size);
function left(s) { return /e/g.test(s); } function right(s) { return /e/g.test(s); } console.log(left("e"), left("e"), right("e"), right("e"));
const kept = []; function keep() { const r = /f/g; kept.push(r); return r.test("ff"); } keep(); keep(); console.log(kept[0] === kept[1], kept[0].lastIndex, kept[1].lastIndex);

function make(i) { return i & 1 ? { a: i, b: i } : { b: i, a: i }; }
function grow(i) { const o = { a: i }; o.z = i; if (i & 1) o.b = i; return o; }
function cut(i) { const o = { a: i, b: i, c: i }; delete o.b; if (i & 1) o.b = "back"; return o; }
function copy(s) { return { ...s }; }
let out = "";
for (let i = 0; i < 4; i++) out += Object.keys(copy(make(i))) + " " + Object.keys(copy(grow(i))) + " " + Object.keys(copy(cut(i))) + "; ";
console.log(out);

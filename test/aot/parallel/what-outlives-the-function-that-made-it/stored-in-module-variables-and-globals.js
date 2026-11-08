let one; var two; globalThis.three = null; const table = {};
function put(i) { one = { v: i }; two = [i]; globalThis.three = { v: i + 2 }; table["k" + i] = { v: i + 3 }; return i; }
put(1);
console.log(one.v, two[0], three.v, table.k1.v);

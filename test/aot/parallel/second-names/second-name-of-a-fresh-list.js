// The elements and the length of a fresh list, stored through a name that goes round a loop or comes out of a join.
function element(n) { const list = [0, 0]; let k = list; for (let i = 0; i < n; i++) { k[0] = (k[0] + i) | 0; k = k; } return list[0]; }
function pushed(n) { const list = []; let k = list; for (let i = 0; i < n; i++) { k.push(i); k = k; } return list.length + ":" + list.join(); }
function shortened(n) { const list = [1, 2, 3]; let k = list; for (let i = 0; i < n; i++) { k.length = 1; k = k; } return list.length + ":" + list[2]; }
function chosen(c, v) { const list = [0], other = [100]; const k = c ? list : other; k[0] += v; return list[0] + ":" + other[0]; }
function doubles(n) { const list = [0.5, 1.5]; let k = list; for (let i = 0; i < n; i++) { k[1] = k[1] + 0.25; k = k; } return list[1]; }
function otherKind(n) { const list = [1, 2]; let k = list; for (let i = 0; i < n; i++) { k[0] = "text"; k = k; } return typeof list[0]; }
function inside(n) { const inner = { n: 0 }; const list = [inner]; let k = list; for (let i = 0; i < n; i++) { k[0].n += i; k = k; } return inner.n; }
console.log(element(0), element(6), pushed(0), pushed(4), shortened(0), shortened(2), chosen(true, 3), chosen(false, 3), doubles(4), otherKind(0), otherKind(1), inside(6));
let last = ""; for (let r = 0; r < 300; r++) last = [element(6), pushed(4), shortened(2), chosen(r & 1, 3), doubles(4), otherKind(1), inside(6)].join(" ");
console.log(last);

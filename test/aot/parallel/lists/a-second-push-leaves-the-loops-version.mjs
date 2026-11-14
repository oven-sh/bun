const q = []; let last = [];
const H2 = { l: [] };
function f2(xs) { const l2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; for (let t = 0; t < 3; t++) { const l3 = [0, 0, 0, 0]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; l3.push(x); l2.push(H2.l[i]); } q.push(l3); } last = H2.l; return [H2.l, l2]; }
f2([1, 2, 3, 0.5]); console.log(JSON.stringify(q)); q.length = 0; last.push(1); f2([1, 2, 3, 0.5]); console.log(JSON.stringify(q), H2);

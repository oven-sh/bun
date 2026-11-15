function look(o) { let n = 0; for (const k in o) n += o[k].length ?? 1; return n; }
function turn(i) { const o = { a: [i], b: "s" + i, c: [i, i] }; const list = [o.a, o.c]; return look(o) + list.length; }
let sum = 0; for (let i = 0; i < 20000; i++) { sum += turn(i); if (i % 5000 === 0) Bun.gc(true); }
console.log(sum);

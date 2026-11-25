const pool = { lid: 1, spout: "p" };
function get(i) { for (let k = 0; k < 1; k++) pool.lid += i; return pool; }
function use(i) { const o = get(i); o.spout = "q" + i; return o.lid; }
console.log(use(1), use(2), pool.lid, pool.spout);

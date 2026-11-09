function one(i) { return { lid: i, spout: [i] }; }
function two(i) { const o = one(i); o.lid++; return o; }
function three(i) { const o = two(i); for (let k = 0; k < 2; k++) o.spout.push(k); return o; }
const got = three(1);
console.log(got.lid, got.spout.join());

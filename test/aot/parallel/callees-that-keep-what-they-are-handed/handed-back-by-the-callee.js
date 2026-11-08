function same(o) { for (let k = 0; k < 1; k++) o.lid++; return o; }
function make(i) { const o = { lid: i }; const again = same(o); return again; }
const got = make(1);
console.log(got.lid, Object.keys(got).join());

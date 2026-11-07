let kept = null;
function keep(o) { for (let k = 0; k < 2; k++) kept = o; }
function make(i) { const o = { lid: i, spout: "s" + i }; keep(o); return i; }
let sum = 0; for (let i = 0; i < 5; i++) sum += make(i);
console.log(sum, kept.lid, kept.spout);

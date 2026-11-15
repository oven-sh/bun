let kept = null;
function keep(o) { for (let k = 0; k < 2; k++) kept = o; }
function change(v) { for (let k = 0; k < 2; k++) kept.lid = v; }
function make(i) { const o = { lid: i }; keep(o); change(7); return o.lid; }
console.log(make(1), kept.lid);

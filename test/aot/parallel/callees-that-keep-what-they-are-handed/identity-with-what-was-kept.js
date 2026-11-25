let kept = null;
function keep(o) { for (let k = 0; k < 2; k++) kept = o; }
function make(i) { const o = { lid: i }; keep(o); return kept === o; }
console.log(make(1), kept.lid);

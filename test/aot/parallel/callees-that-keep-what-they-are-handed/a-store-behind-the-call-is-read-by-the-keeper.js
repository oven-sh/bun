let kept = null;
function keep(o) { for (let k = 0; k < 2; k++) kept = o; }
function make(i) { const o = { lid: i }; keep(o); o.lid = i + 100; return i; }
make(1);
console.log(kept.lid);

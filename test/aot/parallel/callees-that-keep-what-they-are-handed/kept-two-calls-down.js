let kept = null;
function deepest(o) { for (let k = 0; k < 2; k++) kept = o; }
function middle(o) { for (let k = 0; k < 1; k++) deepest(o); }
function make(i) { const o = { lid: i }; middle(o); return i; }
make(8);
console.log(kept.lid, Object.keys(kept).join());

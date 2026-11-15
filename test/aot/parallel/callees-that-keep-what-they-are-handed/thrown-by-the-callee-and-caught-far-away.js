function fling(o) { for (let k = 0; k < 1; k++) if (o.lid > 0) throw o; }
function make(i) { const o = { lid: i }; fling(o); return i; }
let caught = null;
try { make(2); } catch (e) { caught = e; }
console.log(caught.lid);

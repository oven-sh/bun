const map = new Map(), set = new Set();
function keep(o, i) { for (let k = 0; k < 1; k++) { map.set(i, o); set.add(o); } }
function make(i) { const o = { lid: i }; keep(o, i); return i; }
make(1); make(2);
console.log([...map.values()].map(o => o.lid).join(), [...set].map(o => o.lid).join());

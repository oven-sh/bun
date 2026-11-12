function show(x) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return String(x) + " " + typeof x; }
function step(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return String.prototype[Symbol.iterator].call(v).next().value; }
let out = "";
for (let turn = 0; turn < 300; turn++) out = show(step([7, 8]));
console.log(out);

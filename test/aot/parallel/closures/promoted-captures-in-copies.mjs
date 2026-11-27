// A closure that a factory made once is copied in a loop and called by value beside it.
const N = process.argv.length * 3; const list = [4, 1, 3, 0, 2, 5];
const make = () => { const on = new Uint8Array([1, 2, 3, N]); const two = on.length; return k => on.length + two; };
let c;
function run(n) { let s = 0; for (const x of list) { if (n < 1) break; s += c(x); list.forEach(y => { s += c(y); }); } return s; }
c = make();
console.log(run(6), run(2));

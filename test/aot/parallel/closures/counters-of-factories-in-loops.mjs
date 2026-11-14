// STATISTIC: CopiedVariablesCarried >= 3
// Counters that factories make, stepped in loops of the file and of a function that takes one.
function counter() { let n = 0; const inc = () => { n++; }; const get = () => n; return { inc, get }; }
function run(c, turns) { for (let k = 0; k < turns; k++) c.inc(); return c.get(); }
console.log(run(counter(), 0), run(counter(), 7), run(counter(), 1000));
const a = counter(), b = counter();
for (let k = 0; k < 1000; k++) { a.inc(); b.inc(); }
for (let k = 0; k < 100; k++) { a.inc(); if (k & 1) b.inc(); }
console.log(a.get(), b.get(), run(a, 9), run(b, 9));

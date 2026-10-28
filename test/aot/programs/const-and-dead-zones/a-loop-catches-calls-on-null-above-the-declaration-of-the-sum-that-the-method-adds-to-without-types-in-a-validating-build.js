// In a validating build: every turn of the loop throws in front of the inlined method and catches it, before the variable that the method adds to is declared.
function drive(o, n) { let caught = 0, k = 0; do { try { o.step(k); } catch { caught++; } } while (++k < n); return caught; }
console.log(drive(null, 100000));
let total = JSON.parse("0");
class Loud { step(k) { total = total + k; } }
console.log(drive(new Loud(), 100000), total);

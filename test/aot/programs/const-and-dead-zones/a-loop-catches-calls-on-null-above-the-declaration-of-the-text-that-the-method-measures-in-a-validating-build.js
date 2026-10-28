// In a validating build: every turn of the loop throws in front of the inlined method and catches it, before the text that the method measures and once appends to is declared.
function drive(o, n) { let caught = 0; for (let k = 0; k < n; k++) { try { o.step(k); } catch { caught++; } } return caught; }
console.log(drive(null, 100000));
let text = "x".repeat(process.argv.length);
let total = JSON.parse("0");
class Loud { step(k) { total = total + text.length; if (k === 77) text = text + "y"; } }
console.log(drive(new Loud(), 100000), total > 0);

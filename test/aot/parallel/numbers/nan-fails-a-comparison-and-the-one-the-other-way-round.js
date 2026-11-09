// two numbers are compared, and where that fails they are compared the other way round, and one of them is NaN
function subject(a, b) { if (typeof a !== "number" || typeof b !== "number") return 0; if (a < b) return 1; if (a >= b) return 2; return 3; }
function deed() { return subject(NaN, 1) * 10 + subject(1, NaN); }
console.log(String(subject(1, 2)) + String(subject(2, 1)) + String(subject(2, 2)));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject(1, 2)) + String(subject(2, 1)) + String(subject(2, 2)));

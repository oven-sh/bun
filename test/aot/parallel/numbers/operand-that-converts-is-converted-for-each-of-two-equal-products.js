// one product is written twice, and an operand is an object whose valueOf counts its calls and answers differently each time
let calls = 0;
const counting = { valueOf() { calls++; return calls; } };
function subject(a, b) { return a * b + a * b; }
function deed() { return subject(counting, 10); }
console.log(String(subject(2, 10)));
console.log(String(deed()) + "," + String(calls));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total) + "," + String(calls));
console.log(String(subject(2, 10)));

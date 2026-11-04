// a function that `new` enters stores into a field of `this`, calls out, reads the field, stores into it again, calls out and reads it again: the object has not left, so both stores are part of its construction
var calls = 0;
function touch() { calls++; }
function Subject(n) { this.n = n; touch(); var before = this.n; this.n = n + 1; touch(); this.sum = before * 100 + this.n; }
function read(o) { var before = o.n; touch(); return before * 100 + o.n; }
function deed() { var made = new Subject(3); return made.sum * 10000 + read(made); }
console.log(String(read(new Subject(1))));
console.log(String(deed()));
var total = 0;
for (var i = 0; i < 300; i++) total += deed();
console.log(String(total) + "," + String(calls));
console.log(String(read(new Subject(1))));

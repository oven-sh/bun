// a field is read through one parameter, stored through the other and read again, and the two parameters are one object
class P { constructor() { this.c = 1; } }
function subject(p, o) { const before = o.c; p.c = before + 5; return before * 100 + o.c; }
function deed() { const one = new P(); return subject(one, one); }
console.log(String(subject(new P(), new P())));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject(new P(), new P())));

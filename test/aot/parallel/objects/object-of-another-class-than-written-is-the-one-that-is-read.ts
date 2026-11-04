// a field is stored through a parameter that is written as another class than the object that is read, and is that very object
class P { c = 1; }
class Q { c = 3; }
function subject(q: Q, o: P) { const before = o.c; q.c = before + 5; return before * 100 + o.c; }
function deed() { const one = new P(); return subject(JSON.parse("[0]").length ? (one as any) : new Q(), one); }
console.log(String(subject(new Q(), new P())));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject(new Q(), new P())));

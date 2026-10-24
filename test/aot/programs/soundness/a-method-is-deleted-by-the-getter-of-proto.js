// The getter of `__proto__` is kept in a field and called in a function: a method is deleted from what comes back, and the call of it on a new instance throws.
class A { m() { return 1; } }
new A().m();
const holder = { get: Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get };
function climb(x) { return holder.get.call(x); }
delete climb(new A()).m;
let answer;
try { answer = new A().m(); } catch (error) { answer = error.constructor.name; }
console.log(String(answer));

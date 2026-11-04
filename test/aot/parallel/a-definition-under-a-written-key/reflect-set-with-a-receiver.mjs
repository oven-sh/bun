class A { a = 1; set x(v) { this.a = v; } }
const target = new A, receiver = new A;
function act() { Reflect.set(target, "x", "text", receiver); Reflect.set(target, "a", "other", receiver); }
act();
console.log(typeof target.a, target.a, typeof receiver.a, receiver.a);

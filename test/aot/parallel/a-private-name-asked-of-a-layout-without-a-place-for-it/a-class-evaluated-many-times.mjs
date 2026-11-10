function make() { return class { #x = 1; static is(o) { return #x in o; } }; }
const A = make(), B = make(); class Q { y = 1; }
const a = new A(), b = new B(), q = new Q(); const out = [];
for (let i = 0; i < 3; i++) out.push(A.is(a), A.is(b), B.is(a), B.is(b), A.is(q), B.is(q));
console.log(out.join(" "));

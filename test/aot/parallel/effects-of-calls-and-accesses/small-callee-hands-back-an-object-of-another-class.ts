// a small callee hands back its parameter, which at one call is an object of another class with the same members than is written
class A { v = 1; tag() { return "A"; } }
class B { v = "text"; tag() { return "B"; } }
function same(value: A) { return value; }
function deed(value: A) { const got = same(value); return got.tag() + " " + typeof got.v + " " + String(got.v); }
console.log(deed(new A()));
console.log(deed(new B() as any));
console.log(deed({ v: null, tag() { return "literal"; } } as any));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 ? (new B() as any) : new A()) + ";";
console.log(all);

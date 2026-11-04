// Reflect set enters code that has an effect (closure of each entry), and a caller of the function that holds it looks at the state before and behind.
const made = [];
class C { set x(v) { { let n = 0; made.push(() => ++n); } } }
function make() { return new C(); }
function middle(c, k) { Reflect.set(c, "x", 1); }
function outer(c) { const before = made.map(f => f()).join(""); middle(c, "x"); const behind = made.map(f => f()).join(""); return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += made.map(f => f()).join("") + ","; } return s; }
console.log(outer(make()), looped(make()));

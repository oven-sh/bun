// Inherited setter enters code that has an effect (module variable), and a caller of the function that holds it looks at the state before and behind.
let count = 0;
class B { set x(v) { count++; } }
class C extends B { own = 1; }
function make() { return new C(); }
function middle(c, k) { c.x = 1; }
function outer(c) { const before = count; middle(c, "x"); const behind = count; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += count + ","; } return s; }
console.log(outer(make()), looped(make()));

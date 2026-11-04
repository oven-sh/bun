// Added to enters code that has an effect (shape of an object), and a caller of the function that holds it looks at the state before and behind.
const holder = { a: 1 };
class C { get x() { holder["k" + Object.keys(holder).length] = 1; return 1; } set x(v) {} }
function make() { return new C(); }
function middle(c, k) { c.x += 1; }
function outer(c) { const before = Object.keys(holder).length; middle(c, "x"); const behind = Object.keys(holder).length; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += Object.keys(holder).length + ","; } return s; }
console.log(outer(make()), looped(make()));

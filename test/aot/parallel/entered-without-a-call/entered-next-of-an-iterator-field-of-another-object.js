// Next of an iterator enters code that has an effect (field of another object), and a caller of the function that holds it looks at the state before and behind.
const holder = { n: 0 };
class C { [Symbol.iterator]() { return this; } next() { holder.n++; return { done: true, value: 1 }; } }
function make() { return new C(); }
function middle(c, k) { for (const v of c) return v; }
function outer(c) { const before = holder.n; middle(c, "x"); const behind = holder.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += holder.n + ","; } return s; }
console.log(outer(make()), looped(make()));

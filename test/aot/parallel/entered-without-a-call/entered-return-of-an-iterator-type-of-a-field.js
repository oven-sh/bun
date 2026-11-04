// Return of an iterator enters code that has an effect (type of a field), and a caller of the function that holds it looks at the state before and behind.
const holder = { v: 1 };
class C { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return() { holder.v = typeof holder.v === "number" ? "text" : 1; return {}; } }
function make() { return new C(); }
function middle(c, k) { for (const v of c) break; }
function outer(c) { const before = typeof holder.v; middle(c, "x"); const behind = typeof holder.v; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += typeof holder.v + ","; } return s; }
console.log(outer(make()), looped(make()));

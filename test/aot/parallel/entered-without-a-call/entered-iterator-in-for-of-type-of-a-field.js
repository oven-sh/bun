// Iterator in for of enters code that has an effect (type of a field), and a caller of the function that holds it looks at the state before and behind.
const holder = { v: 1 };
class C { [Symbol.iterator]() { holder.v = typeof holder.v === "number" ? "text" : 1; return [1].values(); } }
function make() { return new C(); }
function middle(c, k) { for (const v of c) return v; }
function outer(c) { const before = typeof holder.v; middle(c, "x"); const behind = typeof holder.v; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += typeof holder.v + ","; } return s; }
console.log(outer(make()), looped(make()));

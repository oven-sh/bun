// Return of an iterator enters code that has an effect (closure of each entry), and a caller of the function that holds it looks at the state before and behind.
const made = [];
class C { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return() { { let n = 0; made.push(() => ++n); } return {}; } }
function make() { return new C(); }
function middle(c, k) { for (const v of c) break; }
function outer(c) { const before = made.map(f => f()).join(""); middle(c, "x"); const behind = made.map(f => f()).join(""); return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += made.map(f => f()).join("") + ","; } return s; }
console.log(outer(make()), looped(make()));

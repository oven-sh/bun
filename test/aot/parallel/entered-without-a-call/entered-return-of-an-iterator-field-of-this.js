// Return of an iterator enters code that has an effect (field of this), and a caller of the function that holds it looks at the state before and behind.
class C { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return() { this.n = (this.n || 0) + 1; return {}; } }
function make() { return new C(); }
function middle(c, k) { for (const v of c) break; }
function outer(c) { const before = c.n; middle(c, "x"); const behind = c.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += c.n + ","; } return s; }
console.log(outer(make()), looped(make()));

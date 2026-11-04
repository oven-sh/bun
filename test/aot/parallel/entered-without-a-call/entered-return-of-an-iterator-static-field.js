// Return of an iterator enters code that has an effect (static field), and a caller of the function that holds it looks at the state before and behind.
class Counter { static n = 0; }
class C { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return() { Counter.n++; return {}; } }
function make() { return new C(); }
function middle(c, k) { for (const v of c) break; }
function outer(c) { const before = Counter.n; middle(c, "x"); const behind = Counter.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += Counter.n + ","; } return s; }
console.log(outer(make()), looped(make()));

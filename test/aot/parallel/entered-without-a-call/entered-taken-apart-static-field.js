// Taken apart enters code that has an effect (static field), and a caller of the function that holds it looks at the state before and behind.
class Counter { static n = 0; }
class C { get x() { Counter.n++; return 1; } }
function make() { return new C(); }
function middle(c, k) { const { x } = c; return x; }
function outer(c) { const before = Counter.n; middle(c, "x"); const behind = Counter.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += Counter.n + ","; } return s; }
console.log(outer(make()), looped(make()));

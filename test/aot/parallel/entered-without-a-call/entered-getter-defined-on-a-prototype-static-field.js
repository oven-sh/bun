// Getter defined on a prototype enters code that has an effect (static field), and a caller of the function that holds it looks at the state before and behind.
class Counter { static n = 0; }
class C { own = 1; }
Object.defineProperty(C.prototype, "x", { get() { Counter.n++; return 1; }, configurable: true });
function make() { return new C(); }
function middle(c, k) { return c.x; }
function outer(c) { const before = Counter.n; middle(c, "x"); const behind = Counter.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += Counter.n + ","; } return s; }
console.log(outer(make()), looped(make()));

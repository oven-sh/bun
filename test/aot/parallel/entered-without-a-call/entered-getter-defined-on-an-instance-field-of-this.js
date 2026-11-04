// Getter defined on an instance enters code that has an effect (field of this), and a caller of the function that holds it looks at the state before and behind.
class C { own = 1; }
function make() { return Object.defineProperty(new C(), "x", { get() { this.n = (this.n || 0) + 1; return 1; }, configurable: true }); }
function middle(c, k) { return c.x; }
function outer(c) { const before = c.n; middle(c, "x"); const behind = c.n; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += c.n + ","; } return s; }
console.log(outer(make()), looped(make()));
